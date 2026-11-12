// gs.js – Grundschule: Kurse der Jahrgänge 1–4 (Wunsch der Lehrkraft vom 12.11.2026). Ein Kurs hat einen Jahrgang, eine bis drei Klassen
// (a–c), ein Fach (Religion oder ein frei benanntes Fach mit optionaler Beschreibung für Claude) und ein Schuljahr. Einheiten und Sitzungen
// des Kurses haben das Fach „gs“ und als „Klasse“ die Kennung des Kurses (gs + 8 Hex); kurseigene Planungsgrundlagen haben sie als Fach.
// Planungsgrundlage eines Religionskurses: das Schulcurriculum Ev. Religion (Grundschule) des Jahrgangs; sonst die Grundlagen des Kurses.
import { HttpError, bad, json, readJson, randomId } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { basisText, basePdfKey, rangeText } from "./bases.js";
import { courseSettingsOut } from "./courses.js";
import { GS_SUBJECT, isGsCourseId, normalizeGsCourse, gsCourseShort, gsCourseLabel, gsGradeText, schoolYearOf, berlinToday } from "../public/shared.js";
import { normalizeCourseSettings } from "../public/planning.js";
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
export { GS_SUBJECT };
