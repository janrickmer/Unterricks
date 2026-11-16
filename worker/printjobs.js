// printjobs.js – „Druckaufträge“ (Anforderung 14, Feld ganz oben auf beiden Startseiten der Lehrkraft): der nächste Tag mit Unterricht
// (Europe/Berlin; Mo–Do der folgende Tag, Fr/Sa/So der Montag; ist dort laut Stundenplan kein Unterricht – Ferien, Feiertag, ausgefallener
// Termin –, der nächste Tag mit Unterricht) und – seit Nachtrag 33 – daneben die Sitzungen von heute, deren geplantes Ende (Beginn + Dauer)
// noch nicht erreicht ist; je Sitzung die Dateien ihrer Druckliste „Von der Lehrkraft auszudrucken“ – beide Schulformen, dieselbe Auswahl wie
// printFiles() in public/materialbox.js (Grundschule samt Bildkarten, Nachtrag 31).
import { json } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { fileOut, PRINT_COURSE_COL } from "./lessons.js";
import { loadSubjectConfigs } from "./bases.js";
import { scheduleUnit } from "./units.js";
import { gsCourseOut } from "./gs.js";
import { berlinToday, berlinTime, addDays, lessonTimes, subjectName, subjectShort, classShort, printCourse, printFileName, cardPrintsOf, refCardsOf, GS_SUBJECT } from "../public/shared.js";
import { nextWorkday, printTargetDay, PRINT_AHEAD_DAYS, withSchoolBreaks } from "../public/planning.js";
import { freeDaysStmt, freeDaysOf } from "./freedays.js";
import { bringRead } from "../public/bring.js";

/* Spalten wie FILE_COLS (lessons.js) für fileOut – ohne den Text von Textmaterial (holt der Browser bei Bedarf über die Sitzung) und ohne
   Claudes Gestaltung (nur das Kennzeichen „gestaltet“); mit dem Kurs der Sitzung für den Druck-Namen (Nachtrag 32, Spalte in derselben Anweisung) */
const PRINT_COLS = "id, lesson_id, area, kind, name, mime, size, pages, status, source, created_at, fb_code, fb_sig, print_copies, print_duplex, print_color, " +
  "html_at, pdf_at, render_error, CASE WHEN html IS NULL THEN NULL ELSE '' END AS html, '' AS design_text, cards, card_pages, card_img_at, " + PRINT_COURSE_COL;
/* Druckliste der Sitzungen zweier Tage (?1 = Tag der Druckaufträge, ?2 = heute – Nachtrag 33, dieselbe Anweisung; ein Tag allein: ?2 frei = NULL;
   Ausfall-Einträge der Grundschule zählen nie): alles im Bereich „print“, in der Grundschule
   zusätzlich PDFs der Kinder mit „Auch ausdrucken“ (print_copies) und – seit Nachtrag 31 – Bildkarten mit Druckangaben (Dateien der Lehrkraft mit cards
   und print_copies; heruntergenommene und ältere ohne print_copies nicht), wie in der Sitzung; Reihenfolge wie dort (created_at). Ohne html (PRINT_COLS). */
const DAY_LESSONS = "SELECT id FROM lessons WHERE lesson_date IN (?1, ?2) AND cancelled=0";
/* Nachtrag 31b: in derselben Anweisung (UNION ALL, ref_card = 1) die Bildkarten aller Sitzungen der Grundschulkurse, die an diesen Tagen Unterricht haben – ob der
   Verlaufsplan einer Sitzung auf sie verweist, entscheidet routePrintNext (refCardsOf in public/shared.js); owner_klass = Kurs der Sitzung, der sie gehören */
export const PRINT_FILES_SQL = "SELECT " + PRINT_COLS + ", 0 AS ref_card, NULL AS owner_klass FROM files WHERE lesson_id IN (" + DAY_LESSONS + ") AND (area='print' OR (print_copies IS NOT NULL " +
  "AND ((area='student' AND cards IS NULL) OR (area='teacher' AND cards IS NOT NULL)) AND lesson_id IN (" + DAY_LESSONS + " AND subject='" + GS_SUBJECT + "'))) " +
  "UNION ALL SELECT " + PRINT_COLS + ", 1 AS ref_card, (SELECT klass FROM lessons WHERE id=files.lesson_id) AS owner_klass FROM files WHERE cards IS NOT NULL AND area='teacher' " +
  "AND lesson_id IN (SELECT id FROM lessons WHERE subject='" + GS_SUBJECT + "' AND klass IN (SELECT klass FROM lessons WHERE lesson_date IN (?1, ?2) AND cancelled=0 AND subject='" + GS_SUBJECT + "')) " +
  "ORDER BY created_at";

// erster Tag mit einer (nicht ausgefallenen) Sitzung im Suchfenster und die Sitzungen des Zieltags – beide über den Index lessons_day
export const FIRST_DAY_SQL = "SELECT MIN(lesson_date) AS d FROM lessons WHERE lesson_date >= ?1 AND lesson_date <= ?2 AND cancelled=0";
// … samt den Gegenständen, die die Lehrkraft mitbringen muss (Nachtrag 28: roter Kasten „Für den nächsten Arbeitstag einpacken“ – dieselbe Anweisung) und
// ob eine Krankheitsvertretung bzw. Selbstlern-Phase aktiv ist (Gymnasium: dann kommt die Lehrkraft nicht und packt nichts ein – Prüfbefund; Suche über den Schlüssel von substitutes);
// ?1 und ?2 wie bei PRINT_FILES_SQL (Tag der Druckaufträge und heute)
// … in der Grundschule samt Verlaufsplan und den Druckangaben für wiederverwendete Bildkarten (Nachtrag 31b – die Verweise darin bestimmen sie)
export const DAY_SESSIONS_SQL = "SELECT id, subject, klass, title, lesson_date, start_time, duration_min, bring, (SELECT status FROM substitutes WHERE lesson_id=lessons.id) AS sub, " +
  "CASE WHEN subject='" + GS_SUBJECT + "' THEN portal END AS plan, CASE WHEN subject='" + GS_SUBJECT + "' THEN card_prints END AS card_prints " +
  "FROM lessons WHERE lesson_date IN (?1, ?2) AND cancelled=0";

/* Sitzungen nach Beginn (ohne Uhrzeit zuletzt), dann Kurs bzw. Klasse, dann Titel (auch für den Podcast, worker/podcast.js) */
export const sessionOrder = (a, b) => (a.startTime || "99:99").localeCompare(b.startTime || "99:99") || a.label.localeCompare(b.label, "de", { numeric: true }) || a.title.localeCompare(b.title, "de");

/* GET /api/teacher/print-next → {today, candidate (nomineller nächster Arbeitstag), date (Tag der Druckaufträge oder null), sessions: [{id, subject,
   klass, title, date, startTime, durationMin, school "gym"|"gs", label (wie im Wochenkalender), subtitle (Unterzeile einer Text-PDF wie in der Sitzung),
   printCourse (Kurs im Druck-Namen, Nachtrag 32: „PoWi8“, „Reli4“ – den Namen selbst trägt jede Datei als printName), course? {id, short, label}, files: [fileOut ohne Text], bring? [{item, note}] (Gegenstände zum Mitbringen, Nachtrag 28 – nur wenn es welche gibt und keine Krankheitsvertretung aktiv ist)}], freeDays? [{from, to, label, scope}] (unterrichtsfreie Einträge im übersprungenen Zeitraum,
   nur wenn es welche gibt – Nachtrag 24),
   seit Nachtrag 33 zusätzlich (eine ältere offene Seite liest nur die Felder davor und zeigt weiter den nächsten Arbeitstag):
   todaySessions: [wie sessions, dazu endsAt (geplantes Ende in ms = Beginn + Dauer, Europe/Berlin; null ohne Uhrzeit oder Dauer)] – die Sitzungen von heute,
   die noch nicht beendet sind (endsAt > now; ohne endsAt bis zum Ende des Tages), now (Uhr des Servers, ms) und refreshAt (ms: nächstes geplantes Ende einer
   dieser Sitzungen, spätestens Mitternacht in Berlin – dann ändert sich, was das Feld zeigt; der Browser lädt dann neu)} – auch Sitzungen ohne Druckaufträge
   (files leer). 8 D1-Anweisungen, auch ohne Tag der Druckaufträge (heute kann es trotzdem Sitzungen geben). */
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
/* Geplantes Ende einer Sitzung (ms) wie überall in Unterricks (lessonTimes: lessons.start_time = „Startzeit der Sitzung“ – aus dem Stundenplan ihrer
   Einheit bzw. von Hand – plus Dauer, Europe/Berlin); null ohne Uhrzeit oder Dauer */
export const lessonEnd = (l) => { const t = lessonTimes({ date: l.lesson_date, startTime: l.start_time, durationMin: l.duration_min }); return t ? t.end : null; };
/* Sitzungen von heute, die noch nicht beendet sind (Nachtrag 33): Ende nach now; ohne geplantes Ende bis zum Ende des Tages (gefragt wird nur nach
   Sitzungen des heutigen Datums – nach Mitternacht gehört keine mehr dazu, auch eine späte von 23:30 mit 45 Minuten nicht) → {keep, refreshAt}:
   refreshAt = das früheste dieser Enden, spätestens Mitternacht in Berlin (Beginn des nächsten Tages) */
export function todayOpen(rows, today, now) {
  const midnight = berlinTime(addDays(today, 1), "00:00");
  let refreshAt = midnight;
  const keep = [];
  for (const l of rows) {
    if (l.lesson_date !== today) continue;
    const end = lessonEnd(l);
    if (end !== null && end <= now) continue;   // vorbei: genau zum geplanten Ende
    keep.push({ l, end });
    if (end !== null && end < refreshAt) refreshAt = end;
  }
  return { keep, refreshAt };
}
export async function routePrintNext(c) {
  await requireTeacher(c);
  const today = berlinToday(c.now);
  const { candidate, date, gs, freeDays } = await nextTeachingDay(c, today);
  const skipped = date ? skippedFreeDays(freeDays, candidate, date) : [];
  // ein Batch für beide Tage (Nachtrag 33: heute dazu – dieselben zwei Anweisungen, nur ein zweites Datum)
  const [ls, fs] = await c.db.batch([
    c.db.prepare(DAY_SESSIONS_SQL).bind(date || today, today),
    c.db.prepare(PRINT_FILES_SQL).bind(date || today, today),
  ]);
  const byLesson = new Map(), courseCards = [];
  for (const f of fs.results || []) {
    if (f.ref_card) { courseCards.push(f); continue; }
    if (!byLesson.has(f.lesson_id)) byLesson.set(f.lesson_id, []); byLesson.get(f.lesson_id).push(fileOut(f, false));
  }
  // Nachtrag 31b: Bildkarten einer anderen Sitzung desselben Kurses, auf die der Verlaufsplan verweist – hinten an die Liste der Sitzung, mit ihren Druckangaben
  // (lessons.card_prints; ohne Eintrag 1x, einseitig, farbig) und ihrem Kurs im Druck-Namen; hier abgewählte nicht
  const refCards = (l, course) => refCardsOf(l.plan, courseCards.filter((f) => f.owner_klass === l.klass).map((f) => ({ ...f, lessonId: f.lesson_id })), l.id, cardPrintsOf(l.card_prints))
    .filter((x) => x.print).map(({ card, print }) => {
      const o = fileOut(card, false);
      return { ...o, print, printName: printFileName({ name: card.name, ...print, course: printCourse(l.subject, l.klass, course) }), refFrom: { lessonId: card.lesson_id } };
    });
  const out = (l) => {
    // Selbstlern-Phase (Nachtrag 29) wie eine aktive Vertretung: die Lehrkraft kommt nicht, packt also nichts ein – ihre Ausdrucke (z. B. analoge Stationen
    // in Jg. 5/6) bleiben auf der Liste und tragen den Hinweis „Selbstlern-Phase“ (für die Aufsicht); für heute genauso
    const isGs = l.subject === GS_SUBJECT, course = isGs ? gs.get(l.klass) || null : null, bring = l.sub === "aktiv" || l.sub === "selbstlern" ? [] : bringRead(l.bring).items;
    return { id: l.id, subject: l.subject, klass: l.klass, title: l.title || "", date: l.lesson_date, startTime: l.start_time || null, durationMin: l.duration_min ?? null,
      school: isGs ? "gs" : "gym", label: isGs ? (course ? course.short : "Grundschule") : subjectShort(l.subject) + " " + classShort(l.klass),
      subtitle: isGs ? (course ? course.label : "Grundschule") : subjectName(l.subject) + " · " + classShort(l.klass),
      printCourse: printCourse(l.subject, l.klass, course),
      ...(course ? { course: { id: course.id, short: course.short, label: course.label } } : {}), files: [...(byLesson.get(l.id) || []), ...(isGs ? refCards(l, course) : [])], ...(bring.length ? { bring } : {}),
      ...(l.sub === "selbstlern" ? { selbstlern: true } : {}) };
  };
  const rows = ls.results || [];
  const sessions = date ? rows.filter((l) => l.lesson_date === date).map(out).sort(sessionOrder) : [];
  const { keep, refreshAt } = todayOpen(rows, today, c.now);
  const todaySessions = keep.map(({ l, end }) => ({ ...out(l), endsAt: end })).sort(sessionOrder);
  return json({ ok: true, today, candidate, date: date || null, sessions, ...(skipped.length ? { freeDays: skipped } : {}), now: c.now, refreshAt, todaySessions });
}
