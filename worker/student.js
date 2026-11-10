// student.js – Schüleransicht: Sitzungscode einlösen (dauerhaft je Gerät), freigeschaltete Sitzungen, Material, Präsentation nach 90 Minuten.
// Material „nur für die Lehrkraft“ wird hier nie ausgeliefert: jede Abfrage filtert ausdrücklich auf area = 'student'.
import { HttpError, bad, json, readJson, isId, requireSecret, sha256Hex, LOCKS, lockedFor, registerFail, lockedError, fmtWait } from "./lib.js";
import { requireStudent } from "./auth.js";
import { getFile, downloadUrl } from "./files.js";
import { nextLessonDate } from "./lessons.js";
import { liveTicket, liveState } from "./live.js";
import { normalizeCode, isValidCode, subjectName } from "../public/shared.js";

export const PRESENTATION_DELAY_MS = 90 * 60e3;   // Vorgabe: vollständige Datei erst 90 Minuten nach dem ersten Betreten

const lessonCard = (l, joinedAt) => ({ id: l.id, subject: l.subject, subjectName: subjectName(l.subject), klass: l.klass, title: l.title, date: l.lesson_date || null, joinedAt,
  hasHomework: !!(l.homework && String(l.homework).trim()) });

export async function routeStudentMe(c) {
  const s = await requireStudent(c);
  const r = await c.db.prepare("SELECT l.id, l.subject, l.klass, l.title, l.lesson_date, l.homework, a.joined_at FROM student_access a JOIN lessons l ON l.id = a.lesson_id " +
    "WHERE a.device_id=?1 ORDER BY COALESCE(l.lesson_date, '') DESC, a.joined_at DESC LIMIT 500").bind(s.id).all();
  return json({ ok: true, profile: { klass: s.klass, subject: s.subject }, lessons: (r.results || []).map((x) => lessonCard(x, x.joined_at)) });
}

export async function routeStudentJoin(c) {
  const s = await requireStudent(c);
  const body = await readJson(c.request, 10000);
  if (!s.klass || !s.subject) throw bad("Bitte wähle zuerst deine Klasse und dein Fach.");
  const devKey = "j:dev:" + s.id, ipKey = "j:ip:" + (await sha256Hex("jip|" + c.ip));
  let ms = await lockedFor(c.db, devKey, c.now);
  if (ms) throw lockedError(ms, "Zu viele falsche Codes. Bitte warte " + fmtWait(ms) + ".");
  ms = await lockedFor(c.db, ipKey, c.now);
  if (ms) throw lockedError(ms, "Gerade wurden sehr viele falsche Codes eingegeben. Bitte warte " + fmtWait(ms) + ".");
  const code = normalizeCode(body.code);
  const l = isValidCode(code) ? await c.db.prepare("SELECT id, subject, klass, title, lesson_date, homework FROM lessons WHERE code=?1").bind(code).first() : null;
  if (!l) {
    await registerFail(c.db, devKey, LOCKS.joinDevice, c.now);
    await registerFail(c.db, ipKey, LOCKS.joinIp, c.now);
    throw new HttpError(404, "unknown_code", "Diesen Sitzungscode gibt es nicht. Bitte prüfe die Eingabe.");
  }
  // Ein Code öffnet nur seine eigene Sitzung – und nur, wenn Klasse und Fach passen
  if (l.klass !== s.klass || l.subject !== s.subject)
    throw new HttpError(403, "wrong_class", "Dieser Code gehört zu einer anderen Klasse oder einem anderen Fach. Prüfe deine Auswahl (" + s.klass + ", " + subjectName(s.subject) + ").");
  await c.db.prepare("INSERT INTO student_access(device_id, lesson_id, joined_at) VALUES(?1, ?2, ?3) ON CONFLICT(device_id, lesson_id) DO NOTHING").bind(s.id, l.id, c.now).run();
  const a = await c.db.prepare("SELECT joined_at FROM student_access WHERE device_id=?1 AND lesson_id=?2").bind(s.id, l.id).first();
  return json({ ok: true, lesson: lessonCard(l, a.joined_at) });
}

export async function requireAccess(c, lessonId) {
  const s = await requireStudent(c);
  if (!isId(lessonId)) throw new HttpError(404, "not_found", "Diese Sitzung gibt es nicht.");
  const a = await c.db.prepare("SELECT a.joined_at, l.id, l.subject, l.klass, l.title, l.lesson_date, l.homework, l.created_at FROM student_access a JOIN lessons l ON l.id = a.lesson_id WHERE a.device_id=?1 AND a.lesson_id=?2")
    .bind(s.id, lessonId).first();
  if (!a) throw new HttpError(403, "no_access", "Für diese Sitzung bist du nicht freigeschaltet. Bitte gib den Sitzungscode ein.");
  return { student: s, lesson: a, joinedAt: a.joined_at };
}

export async function routeStudentLesson(c, lessonId) {
  const { lesson, joinedAt } = await requireAccess(c, lessonId);
  const [files, sheets, pres] = await c.db.batch([
    c.db.prepare("SELECT id, kind, name, mime, size, text, created_at FROM files WHERE lesson_id=?1 AND area='student' AND status='ready' ORDER BY created_at").bind(lessonId),
    c.db.prepare("SELECT code, title FROM fb_sheets WHERE lesson_id=?1 ORDER BY created_at").bind(lessonId),
    c.db.prepare("SELECT id, name, pages FROM files WHERE lesson_id=?1 AND area='presentation' AND status='ready' LIMIT 1").bind(lessonId),
  ]);
  const p = (pres.results || [])[0] || null, unlockAt = joinedAt + PRESENTATION_DELAY_MS;
  const hw = String(lesson.homework || "").trim();
  return json({ ok: true, lesson: lessonCard(lesson, joinedAt),
    files: (files.results || []).map((f) => ({ id: f.id, kind: f.kind, name: f.name, mime: f.mime, size: f.size, createdAt: f.created_at, ...(f.kind === "text" ? { text: f.text || "" } : {}) })),
    sheets: (sheets.results || []).map((s) => ({ code: s.code, title: s.title })),
    presentation: p ? { name: p.name, pages: p.pages, unlockAt, unlocked: c.now >= unlockAt } : null,
    homework: hw ? { text: hw, dueDate: await nextLessonDate(c.db, lesson) } : null,
    feibeitsblattUrl: c.env.FEIBEITSBLATT_URL || "https://feibeitsblatt.janrickmer.de/",
    now: c.now });
}

export async function routeStudentFileLink(c, fileId) {
  await requireStudent(c);
  const f = await getFile(c.db, fileId);
  if (f.area !== "student" || f.kind !== "file") throw new HttpError(404, "not_found", "Datei nicht gefunden.");
  await requireAccess(c, f.lesson_id);
  return json({ ok: true, url: await downloadUrl(requireSecret(c.env), f, false, 10 * 60e3, c.now) });
}

export async function routeStudentPresentationLink(c, lessonId) {
  const { joinedAt } = await requireAccess(c, lessonId);
  const unlockAt = joinedAt + PRESENTATION_DELAY_MS;
  if (c.now < unlockAt) throw new HttpError(403, "not_yet", "Die Präsentation kannst du ab " + new Date(unlockAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) + " Uhr selbst öffnen.", { unlockAt });
  const f = await c.db.prepare("SELECT * FROM files WHERE lesson_id=?1 AND area='presentation' AND status='ready' LIMIT 1").bind(lessonId).first();
  if (!f) throw new HttpError(404, "not_found", "Zu dieser Sitzung gibt es noch keine Präsentation.");
  const body = await readJson(c.request, 1000);
  return json({ ok: true, url: await downloadUrl(requireSecret(c.env), f, body.inline !== false, 10 * 60e3, c.now) });
}

export async function routeStudentLiveTicket(c, lessonId) {
  const { student } = await requireAccess(c, lessonId);
  return json({ ok: true, ...(await liveTicket(c, lessonId, "student", student.id)) });
}
export async function routeStudentLiveState(c, lessonId) {
  await requireAccess(c, lessonId);
  return json({ ok: true, live: await liveState(c, lessonId, "student") });
}
