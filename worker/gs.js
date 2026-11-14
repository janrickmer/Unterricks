// gs.js – Grundschule: Kurse der Jahrgänge 1–4 (Wunsch der Lehrkraft vom 12.11.2026). Ein Kurs hat einen Jahrgang, eine bis drei Klassen
// (a–c), ein Fach (Religion oder ein frei benanntes Fach mit optionaler Beschreibung für Claude) und ein Schuljahr. Einheiten und Sitzungen
// des Kurses haben das Fach „gs“ und als „Klasse“ die Kennung des Kurses (gs + 8 Hex); kurseigene Planungsgrundlagen haben sie als Fach.
// Planungsgrundlage eines Religionskurses: das Schulcurriculum Ev. Religion (Grundschule) des Jahrgangs; sonst die Grundlagen des Kurses.
import { HttpError, bad, json, readJson, randomId, generateCode } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { basisText, basePdfKey, rangeText } from "./bases.js";
import { courseSettingsOut } from "./courses.js";
import { GS_SUBJECT, isGsCourseId, normalizeGsCourse, gsCourseShort, gsCourseLabel, gsGradeText, schoolYearOf, berlinToday } from "../public/shared.js";
import { normalizeCourseSettings, planCancellation, normalizeParams, withSchoolBreaks, storeParams } from "../public/planning.js";
import { loadFreeDays } from "./freedays.js";
import { getLesson } from "./lessons.js";
import { getUnit, linkedLessons, reviseData, unitFull } from "./units.js";
import { wantedGsSections, missingForGs } from "../public/bases-detect.js";

const parseJ = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };
const GS_GONE = "Diesen Grundschulkurs gibt es nicht (mehr).";

/* Zeile aus gs_courses → Kurs für Oberfläche, Prompts und Connector (Klassen geprüft, Bezeichnungen fertig) */
export function gsCourseOut(row) {
  if (!row) return null;
  const classes = [...new Set((Array.isArray(parseJ(row.classes, [])) ? parseJ(row.classes, []) : []).map(String).filter((x) => /^[abc]$/.test(x)))].sort();
  const c = { id: row.id, grade: Number(row.grade), classes: classes.length ? classes : ["a"], religion: !!row.religion,
    subjectName: row.religion ? "Religion" : String(row.subject_name || "Fach"), description: String(row.description || ""), schoolYear: row.school_year || null };
  return { ...c, label: gsCourseLabel(c), short: gsCourseShort(c), gradeText: gsGradeText(c) };
}
export const gsCourseStmt = (db, id) => db.prepare("SELECT * FROM gs_courses WHERE id=?1").bind(id);
export async function getGsCourse(db, id) {
  const r = isGsCourseId(id) ? await gsCourseStmt(db, id).first() : null;
  if (!r) throw new HttpError(404, "not_found", GS_GONE);
  return r;
}
/* alle Kurse: Map Kennung → gsCourseOut (Wochenkalender, Listen des Connectors, Sicherung) */
export async function gsCourseMap(db) {
  const r = await db.prepare("SELECT * FROM gs_courses").all();
  return new Map((r.results || []).map((x) => [x.id, gsCourseOut(x)]));
}

/* ---------- Routen ---------- */
// GET /api/teacher/gs/courses – zwei Anweisungen: Kurse mit Kurseinstellungen, Zahl der Einheiten/Sitzungen je Kurs
export async function routeGsCourses(c) {
  await requireTeacher(c);
  const [cs, n] = await c.db.batch([
    c.db.prepare("SELECT g.*, s.weekdays AS cs_weekdays, s.class_size AS cs_class_size, s.updated_at AS cs_updated_at FROM gs_courses g " +
      "LEFT JOIN course_settings s ON s.subject='gs' AND s.klass=g.id ORDER BY g.school_year DESC, g.grade, g.created_at LIMIT 500"),
    c.db.prepare("SELECT klass, SUM(u) AS units, SUM(l) AS lessons, SUM(r) AS revise FROM (" +
      "SELECT klass, 1 AS u, 0 AS l, CASE WHEN json_valid(revise) THEN COALESCE(json_extract(revise, '$.open'), 0) ELSE 0 END AS r FROM units WHERE subject='gs' " +
      "UNION ALL SELECT klass, 0, 1, 0 FROM lessons WHERE subject='gs' AND cancelled=0) GROUP BY klass"),
  ]);
  const counts = new Map((n.results || []).map((x) => [x.klass, x]));
  const courses = (cs.results || []).map((x) => {
    const k = counts.get(x.id) || {};
    const settings = x.cs_updated_at == null ? null : courseSettingsOut({ weekdays: x.cs_weekdays, class_size: x.cs_class_size, updated_at: x.cs_updated_at });
    return { ...gsCourseOut(x), settings, counts: { units: k.units || 0, lessons: k.lessons || 0 }, revise: k.revise || 0 };
  });
  return json({ ok: true, courses });
}
// POST /api/teacher/gs/courses – Kurs und Kurseinstellungen in einem Batch (die Einstellungen nur, wenn der Kurs neu angelegt wurde)
export async function routeGsCourseCreate(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 40000);
  let course, s;
  try { course = normalizeGsCourse(body); s = normalizeCourseSettings(body, { requireTime: true }); } catch (e) { throw bad(e.message); }
  const year = course.schoolYear || (schoolYearOf(berlinToday(c.now)) || {}).label;
  for (let i = 0; i < 3; i++) {
    const id = "gs" + randomId(4);
    const [ins] = await c.db.batch([
      c.db.prepare("INSERT INTO gs_courses(id, grade, classes, religion, subject_name, description, school_year, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) ON CONFLICT(id) DO NOTHING RETURNING id")
        .bind(id, course.grade, JSON.stringify(course.classes), course.religion ? 1 : 0, course.subjectName, course.description, year, c.now),
      c.db.prepare("INSERT INTO course_settings(subject, klass, weekdays, class_size, updated_at) SELECT 'gs', ?1, ?2, ?3, ?4 " +
        "WHERE EXISTS(SELECT 1 FROM gs_courses WHERE id=?1 AND created_at=?4 AND updated_at=?4) ON CONFLICT(subject, klass) DO UPDATE SET weekdays=excluded.weekdays, class_size=excluded.class_size, updated_at=excluded.updated_at")
        .bind(id, JSON.stringify(s.weekdays), s.classSize, c.now),
    ]);
    if ((ins.results || []).length) return json({ ok: true, course: gsCourseOut(await getGsCourse(c.db, id)), settings: { ...s, updatedAt: c.now } });
  }
  throw new Error("Keine freie Kurskennung gefunden");
}
export async function routeGsCourseGet(c, id) {
  await requireTeacher(c);
  const [g, s] = await c.db.batch([gsCourseStmt(c.db, id), c.db.prepare("SELECT weekdays, class_size, updated_at FROM course_settings WHERE subject='gs' AND klass=?1").bind(id)]);
  const row = (g.results || [])[0];
  if (!row) throw new HttpError(404, "not_found", GS_GONE);
  return json({ ok: true, course: gsCourseOut(row), settings: courseSettingsOut((s.results || [])[0]) });
}
// PATCH: nur die übergebenen Felder (Jahrgang, Klassen, Fach, Beschreibung, Schuljahr)
export async function routeGsCoursePatch(c, id) {
  await requireTeacher(c);
  const cur = gsCourseOut(await getGsCourse(c.db, id));
  const body = await readJson(c.request, 20000);
  let n;
  try { n = normalizeGsCourse(body, { partial: true, current: cur }); } catch (e) { throw bad(e.message); }
  await c.db.prepare("UPDATE gs_courses SET grade=?2, classes=?3, religion=?4, subject_name=?5, description=?6, school_year=?7, updated_at=?8 WHERE id=?1")
    .bind(id, n.grade, JSON.stringify(n.classes), n.religion ? 1 : 0, n.subjectName, n.description, n.schoolYear || cur.schoolYear, c.now).run();
  return json({ ok: true, course: gsCourseOut(await getGsCourse(c.db, id)) });
}
// DELETE: nur ohne Einheiten und Sitzungen; mit dem Kurs gehen seine Kurseinstellungen und seine eigenen Planungsgrundlagen (samt PDF)
export async function routeGsCourseDelete(c, id) {
  await requireTeacher(c);
  await getGsCourse(c.db, id);
  const [n, b] = await c.db.batch([
    c.db.prepare("SELECT (SELECT COUNT(*) FROM units WHERE subject='gs' AND klass=?1) + (SELECT COUNT(*) FROM lessons WHERE subject='gs' AND klass=?1) AS n").bind(id),
    c.db.prepare("SELECT id FROM bases WHERE subject=?1").bind(id),
  ]);
  if (((n.results || [])[0] || {}).n) throw new HttpError(409, "has_content", "Zu diesem Kurs gibt es noch Unterrichtseinheiten oder Sitzungen. Bitte zuerst diese löschen.");
  const baseIds = (b.results || []).map((x) => x.id);
  await c.db.batch([
    c.db.prepare("DELETE FROM base_pages WHERE base_id IN (SELECT id FROM bases WHERE subject=?1)").bind(id),
    c.db.prepare("DELETE FROM bases WHERE subject=?1").bind(id),
    c.db.prepare("DELETE FROM course_settings WHERE subject='gs' AND klass=?1").bind(id),
    c.db.prepare("DELETE FROM gs_courses WHERE id=?1").bind(id),
  ]);
  if (baseIds.length) await c.env.FILES.delete(baseIds.map(basePdfKey));
  return json({ ok: true });
}

/* ---------- Planungsgrundlagen eines Grundschulkurses ----------
 * Religion: das Schulcurriculum Ev. Religion (Grundschule) mit den Seiten des Jahrgangs, dazu die kurseigenen Grundlagen; anderes Fach: nur die
 * kurseigenen (Curriculum nach Jahrgang, sonst das ganze Dokument). course = gsCourseOut. Form wie planningBasis (rules/gradeNote leer). */
export async function planningBasisGs(db, course, maxChars = 180000) {
  const r = course.religion
    ? await db.prepare("SELECT * FROM bases WHERE (subject='evrel' AND kind='gs-curriculum') OR subject=?1 ORDER BY kind, created_at").bind(course.id).all()
    : await db.prepare("SELECT * FROM bases WHERE subject=?1 ORDER BY kind, created_at").bind(course.id).all();
  const bases = r.results || [], grade = String(course.grade), docs = [];
  for (const b of bases) {
    const want = b.kind === "gs-curriculum" ? wantedGsSections(b, grade)
      : Array.from({ length: b.pages || 0 }, (_, i) => ({ n: i + 1, part: "alle" }));
    if (want.length) docs.push({ base: b, want });
  }
  const { truncated, text } = await basisText(db, docs, maxChars);
  return {
    rules: "", gradeNote: "", complete: null,
    docs: docs.map((d) => ({ id: d.base.id, title: d.base.title, kind: d.base.kind, pages: rangeText([...new Set(d.want.map((w) => w.n))]), pdf: !!d.base.pdf_size })),
    missing: missingForGs(bases, course), truncated, text, description: course.description || "",
  };
}
/* ---------- Krankmeldung: die Stunde fällt aus, sie und alle folgenden Stunden der Einheit rücken um einen Termin nach hinten ----------
 * (Anforderung 9 der Lehrkraft; was hinter das Ende rutscht, bleibt ohne Datum in der Einheit). Die Sitzungen behalten Kennung, Material,
 * Verlaufsplan und Zeile – nur Datum, Beginn und Dauer wandern. Den ausgefallenen Termin hält ein Ausfall-Eintrag (cancelled=1) fest; er bekommt
 * den Elternlink der Sitzung, damit Eltern mit dem schon verteilten Link sehen, dass der Unterricht nicht stattfinden konnte. */
async function cancelContext(c, id) {
  const X = await getLesson(c.db, id);
  if (X.subject !== GS_SUBJECT) throw new HttpError(400, "not_gs", "Nur bei Sitzungen der Grundschule – am Gymnasium gibt es bei Krankheit die Vertretungsstunde.");
  if (X.cancelled) throw new HttpError(400, "already_cancelled", "Diese Sitzung ist bereits ausgefallen.");
  if (!X.unit_id || !X.unit_row) throw new HttpError(400, "no_unit", "Diese Sitzung gehört zu keiner Einheit – bitte das Datum von Hand ändern.");
  if (!X.lesson_date) throw new HttpError(400, "no_date", "Diese Sitzung hat keinen Termin.");
  const u = await getUnit(c.db, X.unit_id);
  const [lessons, fd] = await Promise.all([linkedLessons(c.db, u.id, true), loadFreeDays(c.db)]);
  let plan;
  // die Stunden rücken nur auf Tage, die für die Grundschule nicht unterrichtsfrei sind (Nachtrag 24); gespeichert werden die Rahmendaten ohne sie
  try { plan = planCancellation({ params: withSchoolBreaks(parseJ(u.params, {}), fd, u.subject), rows: parseJ(u.rows, []), lessons, lessonId: X.id, now: c.now }); }
  catch (e) { if (e && e.code) throw new HttpError(e.status || 400, e.code, e.message); throw e; }
  return { X, u, lessons, plan };
}
// POST /api/teacher/lessons/<id>/cancel – {dryRun:true} → Vorschau; {version} → ausführen (ein Batch, jede Anweisung an die Version gebunden)
export async function routeLessonCancel(c, id) {
  await requireTeacher(c);
  const body = await readJson(c.request, 4000);
  const { X, u, lessons, plan } = await cancelContext(c, id);
  const preview = { moves: plan.moves, undated: plan.undated, undatedRows: plan.undatedRows, cancelled: plan.cancelled, lengthChanges: plan.lengthChanges };
  if (body.dryRun) return json({ ok: true, plan: preview, version: u.version });
  if (body.version !== u.version) throw new HttpError(409, "unit_conflict", "Die Einheit wurde inzwischen geändert – die Vorschau wird neu geladen.", { version: u.version });
  const v = u.version, cid = randomId(4), P = randomId(8), oldRows = parseJ(u.rows, []);
  const byRow = new Map(lessons.filter((l) => l.row && !l.cancelled).map((l) => [l.row, l]));
  const moved = plan.rows.slice(plan.s).map((r) => ({ r, l: byRow.get(r.uid) })).filter((x) => x.l).map(({ r, l }) => ({ id: l.id, d: r.date || null, t: r.time || null, m: r.minutes ?? null }));
  const rev = reviseData(u.revise) || { v: 1, open: false, items: [], undated: [], undo: null };
  const item = { id: cid, date: X.lesson_date, time: X.start_time || null, minutes: X.duration_min ?? null, lessonId: X.id, placeholderId: P,
    title: (oldRows[plan.s] || {}).stundenfrage || X.title, at: c.now, lengths: plan.lengthChanges.map(({ uid, n, from, to }) => ({ uid, n, from, to })) };
  // slot: der ausgefallene Termin laut Stundenplan (wie in params.cancelled); prevOpen: war der rote Kasten vorher offen? (rückgängig stellt ihn so her)
  const undo = { id: cid, version: v + 1, rows: oldRows.slice(plan.s).map((r) => ({ uid: r.uid, date: r.date || null, time: r.time || null, minutes: r.minutes ?? null })),
    lessons: moved.map((m) => { const l = lessons.find((x) => x.id === m.id); return { id: l.id, d: l.date || null, t: l.time || null, m: l.minutes ?? null }; }),
    lessonId: X.id, placeholderId: P, slot: plan.slot, prevOpen: !!rev.open };
  const revise = { v: 1, open: true, items: [...rev.items, item].slice(-30), undated: plan.undated, undo };
  /* Elternlink: Hash und versiegelter Link wandern innerhalb des Batches von der Sitzung zum Ausfall-Eintrag – gelesen in der Datenbank, nie vorab
     gebunden, damit ein gleichzeitiges „Link erneuern“ nicht verloren geht und ein widerrufener Link nicht wieder gilt (Abschlussprüfung F02).
     Der eindeutige Index auf parent_hash lässt denselben Hash nie zweimal zu: erst „~“ davor (markX), dann in den Ausfall-Eintrag kopieren,
     dann bei der Sitzung leeren – bzw. zurücksetzen, falls der Ausfall-Eintrag nicht angelegt wurde (settleX). */
  const markX = (ver) => c.db.prepare("UPDATE lessons SET parent_hash='~'||parent_hash WHERE id=?1 AND parent_hash IS NOT NULL AND EXISTS(SELECT 1 FROM units WHERE id=?2 AND version=?3)").bind(X.id, u.id, ver);
  const G = "EXISTS(SELECT 1 FROM units WHERE id=?8 AND version=?9)", FROM_X = " FROM lessons x WHERE x.id=?10 AND substr(x.parent_hash,1,1)='~')";
  const insertP = (code, guardVer) => c.db.prepare("INSERT INTO lessons(id, subject, klass, title, topic, duration_min, lesson_date, start_time, ideas, homework, code, unit_id, unit_row, cancelled, parent_hash, parent_sealed, created_at, updated_at) " +
    "SELECT ?1, 'gs', ?2, 'Unterricht ausgefallen', ?3, ?4, ?5, ?6, '', '', ?7, ?8, NULL, 1, (SELECT substr(x.parent_hash,2)" + FROM_X + ", (SELECT x.parent_sealed" + FROM_X + ", ?11, ?11 WHERE " + G + " ON CONFLICT(code) DO NOTHING RETURNING id")
    .bind(P, X.klass, X.topic || "", X.duration_min ?? null, X.lesson_date, X.start_time || null, code, u.id, guardVer, X.id, c.now);
  const settleX = () => c.db.prepare("UPDATE lessons SET parent_hash=CASE WHEN EXISTS(SELECT 1 FROM lessons p WHERE p.id=?2) THEN NULL ELSE substr(parent_hash,2) END, " +
    "parent_sealed=CASE WHEN EXISTS(SELECT 1 FROM lessons p WHERE p.id=?2) THEN NULL ELSE parent_sealed END WHERE id=?1 AND substr(parent_hash,1,1)='~'").bind(X.id, P);
  const res = await c.db.batch([
    markX(v),
    insertP(generateCode(), v),
    settleX(),
    c.db.prepare("UPDATE lessons SET lesson_date=(SELECT json_extract(value,'$.d') FROM json_each(?1) WHERE json_extract(value,'$.id')=lessons.id), " +
      "start_time=(SELECT json_extract(value,'$.t') FROM json_each(?1) WHERE json_extract(value,'$.id')=lessons.id), " +
      "duration_min=COALESCE((SELECT json_extract(value,'$.m') FROM json_each(?1) WHERE json_extract(value,'$.id')=lessons.id), duration_min), updated_at=?2 " +
      "WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?1)) AND cancelled=0 AND EXISTS(SELECT 1 FROM units WHERE id=?3 AND version=?4)").bind(JSON.stringify(moved), c.now, u.id, v),
    c.db.prepare("UPDATE units SET params=?3, rows=?4, revise=?5, version=version+1, updated_at=?6, source='lehrkraft' WHERE id=?1 AND version=?2 RETURNING version")
      .bind(u.id, v, JSON.stringify(storeParams(plan.params)), JSON.stringify(plan.rows), JSON.stringify(revise), c.now),
  ]);
  if (!(res[4].results || []).length) throw new HttpError(409, "unit_conflict", "Die Einheit wurde inzwischen geändert – die Vorschau wird neu geladen.");
  // Sitzungscode zufällig schon vergeben (praktisch nie): Ausfall-Eintrag mit neuem Code nachtragen – an die neue Version gebunden
  for (let i = 0; i < 6 && !(res[1].results || []).length; i++) res[1] = (await c.db.batch([markX(v + 1), insertP(generateCode(), v + 1), settleX()]))[1];
  return json({ ok: true, placeholderId: P, moves: plan.moves, undated: plan.undated, unit: await unitFull(c.db, await getUnit(c.db, u.id)) });
}
// POST /api/teacher/units/<id>/cancel/undo – {undoId}: nur, solange die Einheit seit der Krankmeldung nicht geändert wurde
export async function routeCancelUndo(c, id) {
  await requireTeacher(c);
  const body = await readJson(c.request, 2000);
  const u = await getUnit(c.db, id), rev = reviseData(u.revise), undo = rev && rev.undo;
  const STALE = "Seit der Krankmeldung wurde die Einheit geändert – bitte die Termine von Hand anpassen.";
  if (!undo || undo.id !== body.undoId || undo.version !== u.version) throw new HttpError(409, "undo_stale", STALE);
  const lessons = await linkedLessons(c.db, u.id, true);
  const params = normalizeParams(parseJ(u.params, {})), list = params.cancelled || [], slot = undo.slot || {};
  // der ausgefallene Termin: genau dieser (Tag und Uhrzeit), sonst der letzte Ausfall desselben Tages
  let k = list.findIndex((x) => x.date === slot.date && (x.time || null) === (slot.time || null));
  if (k < 0) k = list.map((x) => x.date).lastIndexOf(slot.date);
  const cancelled = list.filter((_, i) => i !== k);
  const p2 = { ...params }; delete p2.cancelled; if (cancelled.length) p2.cancelled = cancelled;
  const snap = new Map((undo.rows || []).map((r) => [r.uid, r]));
  const rows = parseJ(u.rows, []).map((r) => (snap.has(r.uid) ? { ...r, date: snap.get(r.uid).date, time: snap.get(r.uid).time, minutes: snap.get(r.uid).minutes } : r));
  const items = rev.items.filter((x) => x.id !== undo.id);
  // der rote Kasten wie vor dieser Krankmeldung (ältere Schnappschüsse ohne prevOpen: offen)
  const revise = items.length ? { ...rev, open: typeof undo.prevOpen === "boolean" ? undo.prevOpen : true, items, undated: rows.filter((r) => !r.date).map((r) => r.uid), undo: null } : null;
  const G = "EXISTS(SELECT 1 FROM units WHERE id=?2 AND version=?3)";
  /* Termine der Sitzungen wie vor der Krankmeldung: die damals verschobenen genau aus ihrem Schnappschuss (wie bisher), Sitzungen, die erst danach
     für eine der verschobenen Zeilen angelegt wurden, aus ihrer Zeile (Abschlussprüfung F05); Sitzungen früherer Stunden bleiben unberührt */
  const snapL = new Map((undo.lessons || []).map((x) => [x.id, x]));
  const back = lessons.filter((l) => !l.cancelled && l.row && snap.has(l.row)).map((l) => {
    const r = snap.get(l.row);
    return snapL.get(l.id) || { id: l.id, d: r.date || null, t: r.time || null, m: r.minutes ?? null };
  });
  // Elternlink zurück zur Sitzung wie bei der Krankmeldung: der jetzige Hash des Ausfall-Eintrags (auch nach „Link erneuern“), in der Datenbank gelesen
  const res = await c.db.batch([
    c.db.prepare("UPDATE lessons SET parent_hash='~'||parent_hash WHERE id=?1 AND cancelled=1 AND parent_hash IS NOT NULL AND " + G).bind(undo.placeholderId, u.id, u.version),
    c.db.prepare("UPDATE lessons SET parent_hash=(SELECT substr(p.parent_hash,2) FROM lessons p WHERE p.id=?4), parent_sealed=(SELECT p.parent_sealed FROM lessons p WHERE p.id=?4) " +
      "WHERE id=?1 AND cancelled=0 AND EXISTS(SELECT 1 FROM lessons p WHERE p.id=?4 AND substr(p.parent_hash,1,1)='~') AND " + G).bind(undo.lessonId, u.id, u.version, undo.placeholderId),
    // Planungsverlauf eines Ausfall-Eintrags geht mit ihm (der Connector schreibt dort nichts mehr – ältere Zeilen blieben sonst verwaist, F22)
    c.db.prepare("DELETE FROM chat WHERE lesson_id=?1 AND EXISTS(SELECT 1 FROM lessons p WHERE p.id=?1 AND p.cancelled=1) AND " + G).bind(undo.placeholderId, u.id, u.version),
    c.db.prepare("DELETE FROM lessons WHERE id=?1 AND cancelled=1 AND " + G).bind(undo.placeholderId, u.id, u.version),
    c.db.prepare("UPDATE lessons SET lesson_date=(SELECT json_extract(value,'$.d') FROM json_each(?1) WHERE json_extract(value,'$.id')=lessons.id), " +
      "start_time=(SELECT json_extract(value,'$.t') FROM json_each(?1) WHERE json_extract(value,'$.id')=lessons.id), " +
      "duration_min=COALESCE((SELECT json_extract(value,'$.m') FROM json_each(?1) WHERE json_extract(value,'$.id')=lessons.id), duration_min), updated_at=?4 " +
      "WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?1)) AND cancelled=0 AND " + G).bind(JSON.stringify(back), u.id, u.version, c.now),
    c.db.prepare("UPDATE units SET params=?3, rows=?4, revise=?5, version=version+1, updated_at=?6, source='lehrkraft' WHERE id=?1 AND version=?2 RETURNING version")
      .bind(u.id, u.version, JSON.stringify(storeParams(p2)), JSON.stringify(rows), revise ? JSON.stringify(revise) : null, c.now),
  ]);
  if (!(res[res.length - 1].results || []).length) throw new HttpError(409, "undo_stale", STALE);
  return json({ ok: true, unit: await unitFull(c.db, await getUnit(c.db, u.id)) });
}
export { GS_SUBJECT };
