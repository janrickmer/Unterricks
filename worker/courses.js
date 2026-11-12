// courses.js – Kurseinstellungen aller Kurse (Wunsch der Lehrkraft vom 12.11.2026): wann der Kurs stattfindet (Stundenplan wie in den
// Rahmendaten einer Einheit) und wie viele Schüler:innen dazugehören. Gymnasium: Fach|Klasse bzw. Kurs (powi|8A, evrel|8-K, powi|Q2-GK);
// Grundschule: gs|<Kurs-ID>. Neue Einheiten übernehmen den Stundenplan, Claude kennt die Schülerzahl (z. B. für die Zahl der Ausdrucke).
import { HttpError, bad, json, readJson } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { loadSubjectConfigs } from "./bases.js";
import { isValidSubject, classAllowed, GS_SUBJECT, isGsCourseId } from "../public/shared.js";
import { normalizeCourseSettings } from "../public/planning.js";
import { gsCourseOut } from "./gs.js";

const parseJ = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };
const GS_GONE = "Diesen Grundschulkurs gibt es nicht (mehr).";

/* Kurs prüfen: Gymnasium nur mit Fach und einer laut Fach-Einstellungen unterrichteten Klasse (wie bisher), Grundschule nur einen
   vorhandenen Kurs. → {gs:false, cfg} | {gs:true, course: gsCourseOut} */
export async function courseRef(db, subject, klass) {
  if (isValidSubject(subject)) {
    const cfg = (await loadSubjectConfigs(db))[subject];
    if (cfg && classAllowed(cfg, klass)) return { gs: false, cfg };
  } else if (subject === GS_SUBJECT && isGsCourseId(klass)) {
    const course = await db.prepare("SELECT * FROM gs_courses WHERE id=?1").bind(klass).first();
    if (!course) throw new HttpError(404, "not_found", GS_GONE);
    return { gs: true, course: gsCourseOut(course) };
  }
  throw bad("Fach oder Klasse ungültig.");
}

/* Zeile → {weekdays, classSize, updatedAt} (fremde bzw. alte Werte fallen still weg) */
export function courseSettingsOut(row) {
  if (!row) return null;
  let s;
  try { s = normalizeCourseSettings({ weekdays: parseJ(row.weekdays, []), classSize: row.class_size }); }
  catch { s = { weekdays: normalizeCourseSettings({ weekdays: parseJ(row.weekdays, []) }).weekdays, classSize: null }; }
  return { ...s, updatedAt: row.updated_at };
}
export const courseSettingsStmt = (db, subject, klass) => db.prepare("SELECT weekdays, class_size, updated_at FROM course_settings WHERE subject=?1 AND klass=?2").bind(subject, klass);
export async function getCourseSettings(db, subject, klass) {
  return courseSettingsOut(await courseSettingsStmt(db, subject, klass).first());
}
/* Kurs-Angaben für Einheit und Sitzung: {weekdays, classSize, gs} oder null (keine Einstellungen und kein Grundschulkurs).
   gs = Grundschulkurs (gsCourseOut) oder null. */
export async function courseInfo(db, subject, klass) {
  const gs = subject === GS_SUBJECT && isGsCourseId(klass);
  const res = await db.batch([courseSettingsStmt(db, subject, klass), ...(gs ? [db.prepare("SELECT * FROM gs_courses WHERE id=?1").bind(klass)] : [])]);
  const s = courseSettingsOut((res[0].results || [])[0]), course = gs ? gsCourseOut((res[1].results || [])[0]) : null;
  if (!s && !course) return null;
  return { weekdays: s ? s.weekdays : [], classSize: s ? s.classSize : null, gs: course };
}
/* Schülerzahl des Kurses einer Sitzung (Standard für die Zahl der Ausdrucke) – eine Abfrage */
export async function courseClassSize(db, lessonId) {
  const r = await db.prepare("SELECT cs.class_size AS n FROM lessons l JOIN course_settings cs ON cs.subject=l.subject AND cs.klass=l.klass WHERE l.id=?1").bind(lessonId).first();
  const n = r && r.n;
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : null;
}
/* Umzug einzelner Klassen in den Kurs eines Jahrgangs (Ev. Religion, Ethik): der Kurs übernimmt die Einstellungen der ersten Klasse,
   wenn er selbst noch keine hat (im Batch des Umzugs) */
export const courseSettingsCopyStmt = (db, subject, courseKlass, members, now) =>
  db.prepare("INSERT OR IGNORE INTO course_settings(subject, klass, weekdays, class_size, updated_at) SELECT ?1, ?2, weekdays, class_size, ?4 FROM course_settings " +
    "WHERE subject=?1 AND klass IN (SELECT value FROM json_each(?3)) ORDER BY klass LIMIT 1").bind(subject, courseKlass, JSON.stringify(members), now);

const courseParams = (u) => ({ subject: u.searchParams.get("subject"), klass: u.searchParams.get("klass") });
export async function routeCourseSettingsGet(c) {
  await requireTeacher(c);
  const { subject, klass } = courseParams(new URL(c.request.url));
  await courseRef(c.db, subject, klass);
  return json({ ok: true, settings: await getCourseSettings(c.db, subject, klass) });
}
export async function routeCourseSettingsPut(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 20000);
  const ref = await courseRef(c.db, body.subject, body.klass);
  let s;
  try { s = normalizeCourseSettings(body, { requireTime: ref.gs }); } catch (e) { throw bad(e.message); }
  await c.db.prepare("INSERT INTO course_settings(subject, klass, weekdays, class_size, updated_at) VALUES(?1, ?2, ?3, ?4, ?5) " +
    "ON CONFLICT(subject, klass) DO UPDATE SET weekdays=excluded.weekdays, class_size=excluded.class_size, updated_at=excluded.updated_at")
    .bind(body.subject, body.klass, JSON.stringify(s.weekdays), s.classSize, c.now).run();
  return json({ ok: true, settings: { ...s, updatedAt: c.now } });
}
