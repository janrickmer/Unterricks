// printjobs.js – „Druckaufträge für den nächsten Arbeitstag“ (Anforderung 14, Feld ganz oben auf beiden Startseiten der Lehrkraft):
// der nächste Tag mit Unterricht (Europe/Berlin; Mo–Do der folgende Tag, Fr/Sa/So der Montag; ist dort laut Stundenplan kein Unterricht –
// Ferien, Feiertag, ausgefallener Termin –, der nächste Tag mit Unterricht) und je Sitzung dieses Tages die Dateien ihrer Druckliste
// „Von der Lehrkraft auszudrucken“ – beide Schulformen, dieselbe Auswahl wie printFiles() in public/materialbox.js.
import { json } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { fileOut } from "./lessons.js";
import { loadSubjectConfigs } from "./bases.js";
import { scheduleUnit } from "./units.js";
import { gsCourseOut } from "./gs.js";
import { berlinToday, addDays, subjectName, subjectShort, classShort, GS_SUBJECT } from "../public/shared.js";
import { nextWorkday, printTargetDay, PRINT_AHEAD_DAYS, withSchoolBreaks } from "../public/planning.js";
import { freeDaysStmt, freeDaysOf } from "./freedays.js";

/* Spalten wie FILE_COLS (lessons.js) für fileOut – ohne den Text von Textmaterial (holt der Browser bei Bedarf über die Sitzung) und ohne
   Claudes Gestaltung (nur das Kennzeichen „gestaltet“) */
const PRINT_COLS = "id, lesson_id, area, kind, name, mime, size, pages, status, source, created_at, fb_code, fb_sig, print_copies, print_duplex, print_color, " +
  "html_at, pdf_at, render_error, CASE WHEN html IS NULL THEN NULL ELSE '' END AS html, '' AS design_text, cards, card_pages, card_img_at";
/* Druckliste der Sitzungen eines Tages (?1 = Datum; Ausfall-Einträge der Grundschule zählen nie): alles im Bereich „print“, in der Grundschule
   zusätzlich PDFs der Kinder mit „Auch ausdrucken“ (print_copies) – ohne Bildkarten, wie in der Sitzung; Reihenfolge wie dort (created_at) */
const DAY_LESSONS = "SELECT id FROM lessons WHERE lesson_date=?1 AND cancelled=0";
export const PRINT_FILES_SQL = "SELECT " + PRINT_COLS + " FROM files WHERE lesson_id IN (" + DAY_LESSONS + ") AND (area='print' OR (area='student' AND print_copies IS NOT NULL " +
  "AND cards IS NULL AND lesson_id IN (" + DAY_LESSONS + " AND subject='" + GS_SUBJECT + "'))) ORDER BY created_at";

// erster Tag mit einer (nicht ausgefallenen) Sitzung im Suchfenster und die Sitzungen des Zieltags – beide über den Index lessons_day
export const FIRST_DAY_SQL = "SELECT MIN(lesson_date) AS d FROM lessons WHERE lesson_date >= ?1 AND lesson_date <= ?2 AND cancelled=0";
export const DAY_SESSIONS_SQL = "SELECT id, subject, klass, title, lesson_date, start_time, duration_min FROM lessons WHERE lesson_date=?1 AND cancelled=0";

/* Sitzungen nach Beginn (ohne Uhrzeit zuletzt), dann Kurs bzw. Klasse, dann Titel (auch für den Podcast, worker/podcast.js) */
export const sessionOrder = (a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99") || a.label.localeCompare(b.label, "de", { numeric: true }) || a.title.localeCompare(b.title, "de");

/* GET /api/teacher/print-next → {today, candidate (nomineller nächster Arbeitstag), date (Tag der Druckaufträge oder null), sessions: [{id, subject,
   klass, title, date, startTime, durationMin, school "gym"|"gs", label (wie im Wochenkalender), subtitle (Unterzeile einer Text-PDF wie in der Sitzung),
   course? {id, short, label}, files: [fileOut ohne Text]}], freeDays? [{from, to, label, scope}] (unterrichtsfreie Einträge im übersprungenen Zeitraum,
   nur wenn es welche gibt – Nachtrag 24)} – auch Sitzungen ohne Druckaufträge (files leer). 8 D1-Anweisungen. */
/* Nächster Tag mit Unterricht nach heute (today, Europe/Berlin): nominell nextWorkday, dann der früheste Tag mit Sitzung oder Termin laut Stundenplan
   (printTargetDay; unterrichtsfreie Tage der Einstellungen zählen für ihre Schule nicht – Nachtrag 24) → {candidate, date (null = nichts in Sicht),
   gs (Grundschulkurse: Map id → gsCourseOut), freeDays}. 5 D1-Anweisungen (Fach-Einstellungen, ein Batch mit Einheiten, Kursen, frühester Sitzung und
   den unterrichtsfreien Tagen). Auch für den Podcast (worker/podcast.js). */
export async function nextTeachingDay(c, today) {
  const candidate = nextWorkday(today), last = addDays(candidate, PRINT_AHEAD_DAYS);
  const cfgs = await loadSubjectConfigs(c.db);
  const [ur, gr, lr, fr] = await c.db.batch([
    // nur Einheiten, deren Zeitraum das Suchfenster berührt (gespeichert sind die Rahmendaten normalisiert: ISO-Daten)
    c.db.prepare("SELECT id, subject, klass, title, params FROM units WHERE json_valid(params) AND json_extract(params, '$.end') >= ?1 AND json_extract(params, '$.start') <= ?2 " +
      "ORDER BY created_at DESC LIMIT 2000").bind(candidate, last),
    c.db.prepare("SELECT * FROM gs_courses"),
    c.db.prepare(FIRST_DAY_SQL).bind(candidate, last),
    freeDaysStmt(c.db),
  ]);
  const gs = new Map((gr.results || []).map((x) => [x.id, gsCourseOut(x)])), freeDays = freeDaysOf(fr);
  const units = (ur.results || []).map((x) => scheduleUnit(x, gs, cfgs)).filter(Boolean).map((u) => ({ ...u, params: withSchoolBreaks(u.params, freeDays, u.subject) }));
  const first = ((lr.results || [])[0] || {}).d || null;
  return { candidate, date: printTargetDay(candidate, units, first ? [first] : []), gs, freeDays };
}
/* Unterrichtsfreie Einträge (Einstellungen) im übersprungenen Zeitraum vom nominellen Arbeitstag bis vor den Tag der Druckaufträge – damit das Feld
   den Grund nennen kann („Herbstferien, beide Schulen“) statt nur „laut Stundenplan kein Unterricht“; ohne solche Einträge kein Feld (wie bisher) */
export function skippedFreeDays(freeDays, candidate, date) {
  if (!candidate || !date || date <= candidate) return [];
  const until = addDays(date, -1);
  return (freeDays || []).filter((f) => f.to >= candidate && f.from <= until).slice(0, 10).map((f) => ({ from: f.from, to: f.to, label: f.label, scope: f.scope }));
}
export async function routePrintNext(c) {
  await requireTeacher(c);
  const today = berlinToday(c.now);
  const { candidate, date, gs, freeDays } = await nextTeachingDay(c, today);
  if (!date) return json({ ok: true, today, candidate, date: null, sessions: [] });
  const skipped = skippedFreeDays(freeDays, candidate, date);
  const [ls, fs] = await c.db.batch([
    c.db.prepare(DAY_SESSIONS_SQL).bind(date),
    c.db.prepare(PRINT_FILES_SQL).bind(date),
  ]);
  const byLesson = new Map();
  for (const f of fs.results || []) { if (!byLesson.has(f.lesson_id)) byLesson.set(f.lesson_id, []); byLesson.get(f.lesson_id).push(fileOut(f, false)); }
  const sessions = (ls.results || []).map((l) => {
    const isGs = l.subject === GS_SUBJECT, course = isGs ? gs.get(l.klass) || null : null;
    return { id: l.id, subject: l.subject, klass: l.klass, title: l.title || "", date: l.lesson_date, startTime: l.start_time || null, durationMin: l.duration_min ?? null,
      school: isGs ? "gs" : "gym", label: isGs ? (course ? course.short : "Grundschule") : subjectShort(l.subject) + " " + classShort(l.klass),
      subtitle: isGs ? (course ? course.label : "Grundschule") : subjectName(l.subject) + " · " + classShort(l.klass),
      ...(course ? { course: { id: course.id, short: course.short, label: course.label } } : {}), files: byLesson.get(l.id) || [] };
  }).sort(sessionOrder);
  return json({ ok: true, today, candidate, date, sessions, ...(skipped.length ? { freeDays: skipped } : {}) });
}
