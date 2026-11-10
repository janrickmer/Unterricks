// student.js – Schüleransicht: Sitzungscode einlösen (dauerhaft je Gerät), freigeschaltete Sitzungen, Material, Präsentation nach 90 Minuten.
// Material „nur für die Lehrkraft“ wird hier nie ausgeliefert: jede Abfrage filtert ausdrücklich auf area = 'student'.
import { HttpError, bad, json, readJson, isId, requireSecret, sha256Hex, LOCKS, lockedFor, registerFail, lockedError, fmtWait, cleanLine, cleanText } from "./lib.js";
import { callTask, taskProviders, TASKS } from "./ai.js";
import { requireStudent } from "./auth.js";
import { getFile, downloadUrl } from "./files.js";
import { nextLessonDate } from "./lessons.js";
import { getSubstitute, substituteForStudents } from "./substitute.js";
import { liveTicket, liveState } from "./live.js";
import { normalizeCode, isValidCode, subjectName, classShort, isCourseClass, courseMembers, cleanWebUrl, lessonTimes, fmtClockBerlin, studentHelpPrompt, STUDENT_HELP_LIMITS } from "../public/shared.js";
import { loadSubjectConfigs } from "./bases.js";

/* Zeitpunkte der Sitzung (Vorgabe der Lehrkraft vom 10.11.2026): die Hausaufgabe erst ab 15 Minuten vor dem Ende, die ganze Präsentation
   erst 5 Minuten nach dem Ende – berechnet aus Datum, Beginn (Uhrzeit) und Dauer; ohne Beginn oder Dauer bleibt beides verborgen. */
const timesOf = (l) => lessonTimes({ date: l.lesson_date, startTime: l.start_time, durationMin: l.duration_min });
const homeworkShown = (l, now) => { const t = timesOf(l); return !!t && now >= t.homeworkAt && !!String(l.homework || "").trim(); };
const LESSON_COLS = "l.id, l.subject, l.klass, l.title, l.lesson_date, l.start_time, l.duration_min, l.homework, l.student_ai";
const lessonCard = (l, joinedAt, now) => ({ id: l.id, subject: l.subject, subjectName: subjectName(l.subject), klass: l.klass, title: l.title, date: l.lesson_date || null, joinedAt,
  hasHomework: homeworkShown(l, now) });

export async function routeStudentMe(c) {
  const s = await requireStudent(c);
  const r = await c.db.prepare("SELECT " + LESSON_COLS + ", a.joined_at FROM student_access a JOIN lessons l ON l.id = a.lesson_id " +
    "WHERE a.device_id=?1 ORDER BY COALESCE(l.lesson_date, '') DESC, a.joined_at DESC LIMIT 500").bind(s.id).all();
  return json({ ok: true, profile: { klass: s.klass, subject: s.subject }, lessons: (r.results || []).map((x) => lessonCard(x, x.joined_at, c.now)), authLeftMs: c.authLeftMs });
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
  const l = isValidCode(code) ? await c.db.prepare("SELECT " + LESSON_COLS + " FROM lessons l WHERE l.code=?1").bind(code).first() : null;
  if (!l) {
    await registerFail(c.db, devKey, LOCKS.joinDevice, c.now);
    await registerFail(c.db, ipKey, LOCKS.joinIp, c.now);
    throw new HttpError(404, "unknown_code", "Diesen Sitzungscode gibt es nicht. Bitte prüfe die Eingabe.");
  }
  // Ein Code öffnet nur seine eigene Sitzung – und nur, wenn Klasse und Fach passen. Kurse (Ev. Religion, Ethik): die eigene Klasse
  // muss zu den Klassen gehören, die die Lehrkraft für den Kurs des Jahrgangs eingetragen hat.
  let fits = l.subject === s.subject && l.klass === s.klass;
  if (!fits && l.subject === s.subject && isCourseClass(l.klass)) {
    fits = courseMembers((await loadSubjectConfigs(c.db))[l.subject], l.klass).includes(s.klass);
    if (!fits) throw new HttpError(403, "wrong_class", "Dieser Code gehört zum " + classShort(l.klass) + " in " + subjectName(l.subject) + ", für den deine Klasse " + classShort(s.klass) + " nicht eingetragen ist. Prüfe deine Auswahl.");
  }
  if (!fits)
    throw new HttpError(403, "wrong_class", "Dieser Code gehört zu einer anderen Klasse oder einem anderen Fach. Prüfe deine Auswahl (" + classShort(s.klass) + ", " + subjectName(s.subject) + ").");
  await c.db.prepare("INSERT INTO student_access(device_id, lesson_id, joined_at) VALUES(?1, ?2, ?3) ON CONFLICT(device_id, lesson_id) DO NOTHING").bind(s.id, l.id, c.now).run();
  const a = await c.db.prepare("SELECT joined_at FROM student_access WHERE device_id=?1 AND lesson_id=?2").bind(s.id, l.id).first();
  return json({ ok: true, lesson: lessonCard(l, a.joined_at, c.now) });
}

export async function requireAccess(c, lessonId) {
  const s = await requireStudent(c);
  if (!isId(lessonId)) throw new HttpError(404, "not_found", "Diese Sitzung gibt es nicht.");
  const a = await c.db.prepare("SELECT a.joined_at, " + LESSON_COLS + ", l.created_at FROM student_access a JOIN lessons l ON l.id = a.lesson_id WHERE a.device_id=?1 AND a.lesson_id=?2")
    .bind(s.id, lessonId).first();
  if (!a) throw new HttpError(403, "no_access", "Für diese Sitzung bist du nicht freigeschaltet. Bitte gib den Sitzungscode ein.");
  return { student: s, lesson: a, joinedAt: a.joined_at };
}

export async function routeStudentLesson(c, lessonId) {
  const { lesson, joinedAt } = await requireAccess(c, lessonId);
  const [files, sheets, pres] = await c.db.batch([
    c.db.prepare("SELECT id, kind, name, mime, size, text, source, created_at FROM files WHERE lesson_id=?1 AND area='student' AND status='ready' ORDER BY created_at").bind(lessonId),
    c.db.prepare("SELECT code, title, kind FROM fb_sheets WHERE lesson_id=?1 ORDER BY created_at").bind(lessonId),
    c.db.prepare("SELECT id, name, pages, shown_until, cut_size FROM files WHERE lesson_id=?1 AND area='presentation' AND status='ready' LIMIT 1").bind(lessonId),
  ]);
  const p = (pres.results || [])[0] || null, times = timesOf(lesson), unlockAt = times ? times.presentationAt : null;
  const hw = homeworkShown(lesson, c.now) ? String(lesson.homework).trim() : "";
  const upTo = p && p.shown_until && p.shown_until < p.pages ? p.shown_until : null;
  return json({ ok: true, authLeftMs: c.authLeftMs, lesson: lessonCard(lesson, joinedAt, c.now),
    files: (files.results || []).map((f) => ({ id: f.id, kind: f.kind, name: f.name, mime: f.mime, size: f.size, createdAt: f.created_at, ...(f.kind === "text" ? { text: f.text || "" } : {}),
      ...(f.kind === "link" ? { url: cleanWebUrl(f.text) || "" } : {}), ...(f.source === "notfall" ? { notfall: true } : {}) })),
    sheets: (sheets.results || []).filter((s) => s.kind !== "escape").map((s) => ({ code: s.code, title: s.title })),   // Escape-Finale nur über den Tunnel
    presentation: p ? { name: p.name, pages: p.pages, unlockAt, unlocked: unlockAt !== null && c.now >= unlockAt, upTo } : null,
    homework: hw ? { text: hw, dueDate: await nextLessonDate(c.db, lesson) } : null,
    // wann sich die Ansicht ändert (Begriffshilfe beginnt/endet, Hausaufgabe erscheint, Präsentation wird frei) – unabhängig davon, ob es eine Hausaufgabe gibt
    changesAt: times ? [times.start, times.end + 1000, times.homeworkAt, times.presentationAt].filter((t) => t > c.now) : [],
    // KI-Begriffshilfe: nur zwischen Beginn und Ende der Stunde; die Dienste stehen im Einwilligungstext
    aiHelp: times && lesson.student_ai !== 0 && c.now <= times.end ? { start: times.start, end: times.end, providers: await taskProviders(c.db, "erklaeren") } : null,
    substitute: substituteForStudents(await getSubstitute(c.db, lessonId)),
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
  const { lesson } = await requireAccess(c, lessonId);
  const times = timesOf(lesson);
  if (!times) throw new HttpError(403, "not_yet", "Die Präsentation kannst du nach dem Unterricht selbst öffnen – deine Lehrkraft hat die Uhrzeit der Sitzung noch nicht eingetragen.");
  if (c.now < times.presentationAt) throw new HttpError(403, "not_yet", "Die Präsentation kannst du ab " + fmtClockBerlin(times.presentationAt) + " Uhr selbst öffnen (5 Minuten nach dem Unterricht).", { unlockAt: times.presentationAt });
  const f = await c.db.prepare("SELECT * FROM files WHERE lesson_id=?1 AND area='presentation' AND status='ready' LIMIT 1").bind(lessonId).first();
  if (!f) throw new HttpError(404, "not_found", "Zu dieser Sitzung gibt es noch keine Präsentation.");
  const body = await readJson(c.request, 1000);
  // letzte gezeigte Folie markiert: nur die gekürzte PDF (Folie 1 bis zur Markierung), nie die vollständige
  const cut = f.shown_until && f.shown_until < f.pages;
  if (cut && !f.cut_size) throw new HttpError(409, "not_ready", "Die Präsentation wird gerade vorbereitet. Bitte versuch es gleich noch einmal.");
  return json({ ok: true, url: await downloadUrl(requireSecret(c.env), f, body.inline !== false, 10 * 60e3, c.now, !!cut) });
}

/* KI-Begriffshilfe (Wunsch der Lehrkraft vom 10.11.2026): nur mit Einwilligung, nur während der Stunde, nur Fachbegriffe und Unterrichtsinhalt.
   Gesendet wird nur die Frage (und die letzten Fragen und Antworten dieses Gesprächs aus dem Browser) – nie eine Kennung des Geräts.
   Nichts davon wird gespeichert oder protokolliert. */
export async function routeStudentAsk(c, lessonId) {
  const { student, lesson } = await requireAccess(c, lessonId);
  const t = timesOf(lesson);
  if (lesson.student_ai === 0) throw new HttpError(403, "ai_off", "Deine Lehrkraft hat die KI-Begriffshilfe für diese Sitzung ausgeschaltet.");
  if (!t || c.now < t.start || c.now > t.end) throw new HttpError(403, "not_now", "Die KI-Begriffshilfe gibt es nur während der Unterrichtsstunde.");
  const body = await readJson(c.request, 20000);
  if (body.consent !== true) throw bad("Bitte willige zuerst ein, dass du die KI-Begriffshilfe nutzen möchtest.");
  const q = cleanLine(body.question, STUDENT_HELP_LIMITS.question);
  if (q.length < 2) throw bad("Bitte gib deine Frage ein.");
  const devKey = "ask:dev:" + student.id, lesKey = "ask:l:" + lessonId;
  let ms = await lockedFor(c.db, devKey, c.now);
  if (ms) throw lockedError(ms, "Du hast gerade sehr viele Fragen gestellt. Bitte warte " + fmtWait(ms) + " – oder frag deine Lehrkraft.");
  ms = await lockedFor(c.db, lesKey, c.now);
  if (ms) throw lockedError(ms, "Die KI-Begriffshilfe ist für diese Sitzung gerade ausgelastet. Bitte versuch es in " + fmtWait(ms) + " noch einmal.");
  await registerFail(c.db, devKey, LOCKS.askDevice, c.now);
  await registerFail(c.db, lesKey, LOCKS.askLesson, c.now);
  const hist = (Array.isArray(body.history) ? body.history : []).slice(-STUDENT_HELP_LIMITS.history)
    .map((x) => ({ q: cleanLine(x && x.q, STUDENT_HELP_LIMITS.question), a: cleanText(x && x.a, STUDENT_HELP_LIMITS.answer).trim() })).filter((x) => x.q && x.a);
  const extra = await c.db.prepare("SELECT topic, portal FROM lessons WHERE id=?1").bind(lessonId).first();
  const messages = [{ role: "system", content: studentHelpPrompt({ ...lesson, topic: extra && extra.topic, portal: extra && extra.portal }) },
    ...hist.flatMap((x) => [{ role: "user", content: x.q }, { role: "assistant", content: x.a }]), { role: "user", content: q }];
  let r;
  try { r = await callTask(c.env, c.db, "erklaeren", messages, { maxTokens: TASKS.erklaeren.maxTokens }); }
  catch { throw new HttpError(502, "ai_error", "Die KI-Begriffshilfe antwortet gerade nicht. Versuch es gleich noch einmal oder frag deine Lehrkraft."); }
  const answer = cleanText(r && r.text, STUDENT_HELP_LIMITS.answer).trim();
  return json({ ok: true, answer: answer || "Dazu kann ich gerade nichts sagen. Frag bitte deine Lehrkraft." });
}

export async function routeStudentLiveTicket(c, lessonId) {
  const { student } = await requireAccess(c, lessonId);
  return json({ ok: true, ...(await liveTicket(c, lessonId, "student", student.id)) });
}
export async function routeStudentLiveState(c, lessonId) {
  await requireAccess(c, lessonId);
  return json({ ok: true, live: await liveState(c, lessonId, "student") });
}
