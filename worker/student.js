// student.js – Schüleransicht: Sitzungscode einlösen (dauerhaft je Gerät), freigeschaltete Sitzungen, Material, Präsentation nach 90 Minuten.
// Material „nur für die Lehrkraft“ wird hier nie ausgeliefert: jede Abfrage filtert ausdrücklich auf area = 'student'.
import { HttpError, bad, json, readJson, isId, requireSecret, sha256Hex, LOCKS, lockedFor, registerFail, lockedError, fmtWait, cleanLine, cleanText, hmac, hmacOk } from "./lib.js";
import { callTask, taskProviders, TASKS } from "./ai.js";
import { requireStudent } from "./auth.js";
import { getFile, downloadUrl, studentSlideUrl, studentSlideExp, studentSlideLimit } from "./files.js";
import { nextLessonDate, nextTeacherLesson } from "./lessons.js";
import { getSubstitute, studentSubstitute } from "./substitute.js";
import { SELBSTLERN, readSelbstlern, selbstlernAiWindow, selbstlernHelpPrompt, explainBotPrompt, explainSigText, helpSigText, selbstlernHomeworkNow, EXPLAIN_BOT_LIMITS, EXPLAIN_FINISH_MESSAGE } from "../public/selbstlern.js";
import { liveTicket, liveState } from "./live.js";
import { normalizeCode, isValidCode, subjectName, classShort, isCourseClass, courseMembers, cleanWebUrl, lessonTimes, fmtClockBerlin, fmtDayBerlin, studentHelpPrompt, STUDENT_HELP_LIMITS, GS_SUBJECT, STUDENT_SLIDE_BLOCK,
  isAnalogClass } from "../public/shared.js";
import { loadSubjectConfigs } from "./bases.js";
import { videoSlidesData, videoSlidesOf, videoAt, videoWatchUrl, videoClipText } from "../public/videoslides.js";

/* Zeitpunkte der Sitzung (Vorgabe der Lehrkraft vom 10.11.2026): die Hausaufgabe erst ab 15 Minuten vor dem Ende, die ganze Präsentation
   erst 5 Minuten nach dem Ende – berechnet aus Datum, Beginn (Uhrzeit) und Dauer; ohne Beginn oder Dauer bleibt beides verborgen. */
const timesOf = (l) => lessonTimes({ date: l.lesson_date, startTime: l.start_time, durationMin: l.duration_min });
// Selbstlern-Phase (Nachtrag 29): die Hausaufgabe – alle Stationen bis zur nächsten Sitzung mit der Lehrkraft – sehen die Schüler:innen von Anfang an
const homeworkShown = (l, now) => { if (!String(l.homework || "").trim()) return false; if (l.sub_status === SELBSTLERN) return true; const t = timesOf(l); return !!t && now >= t.homeworkAt; };
const LESSON_COLS = "l.id, l.subject, l.klass, l.title, l.lesson_date, l.start_time, l.duration_min, l.homework, l.student_ai, (SELECT s.status FROM substitutes s WHERE s.lesson_id=l.id) AS sub_status";
// Material der Selbstlern-Phase (source 'selbstlern') sehen Schüler:innen nur, solange die Sitzung eine Selbstlern-Phase ist (vorher legt Claude es an, „Wiederherstellen“ löscht es)
const SELBSTLERN_FILE_OK = "(source IS NOT 'selbstlern' OR EXISTS (SELECT 1 FROM substitutes s WHERE s.lesson_id=files.lesson_id AND s.status='selbstlern'))";
/* Selbstlern-Phase mit iPads (Nachtrag 29 Teil B, ab Jahrgang 7): eigene Schüleransicht ohne Live-Fenster und ohne die Präsentation der ursprünglichen
   Planung; Erklär-Chatbot und KI-Begriffshilfe ab dem Beginn der Sitzung bis zum Beginn der nächsten Sitzung mit der Lehrkraft (selbstlernAiWindow).
   Jahrgang 5/6 (analog, auf Papier): die Ansicht bleibt wie bisher. */
const selbstDigital = (l) => l.sub_status === SELBSTLERN && !isAnalogClass(l.klass);
const selbstWindow = (l, next) => selbstlernAiWindow({ date: l.lesson_date, startTime: l.start_time, durationMin: l.duration_min }, next);
const whenBerlin = (ms) => fmtDayBerlin(ms) + ", " + fmtClockBerlin(ms) + " Uhr";
// warum ein KI-Chatbot der Selbstlern-Phase gerade nicht antwortet (who = „Den Erklär-Chatbot“ bzw. „Die KI-Begriffshilfe“)
function selbstNotNow(win, now, who, gone) {
  if (!win) return who + " gibt es, sobald deine Lehrkraft das Datum der Sitzung eingetragen hat.";
  if (now < win.start) return who + " kannst du ab dem Beginn der Sitzung nutzen (" + whenBerlin(win.start) + ").";
  return gone + (win.untilNext ? " – die nächste Stunde mit deiner Lehrkraft hat begonnen." : " – die Selbstlern-Phase ist vorbei.");
}
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
  // Sitzungen der Grundschule haben keinen Schülerzugang: ihr Code gilt wie ein unbekannter (kein Hinweis auf eine andere Klasse)
  if (!l || l.subject === GS_SUBJECT) {
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
    c.db.prepare("SELECT id, kind, name, mime, size, CASE WHEN kind IN ('text','link') THEN text END AS text, source, created_at FROM files WHERE lesson_id=?1 AND area='student' AND status='ready' AND " + SELBSTLERN_FILE_OK + " ORDER BY created_at").bind(lessonId),
    c.db.prepare("SELECT code, title, kind FROM fb_sheets WHERE lesson_id=?1 ORDER BY created_at").bind(lessonId),
    c.db.prepare("SELECT id, name, pages, shown_until, cut_size FROM files WHERE lesson_id=?1 AND area='presentation' AND status='ready' LIMIT 1").bind(lessonId),
  ]);
  const sd = selbstDigital(lesson), selbst = lesson.sub_status === SELBSTLERN;
  // Selbstlern-Phase (auch Jg. 5/6): keine Präsentation der ursprünglichen Planung – sie ist mit ihr archiviert, die Stationen ersetzen den Unterricht
  // mit der Lehrkraft (Prüfbefund: in Jg. 5/6 wurde sie sonst nach der Sitzung freigegeben)
  const p = selbst ? null : (pres.results || [])[0] || null, times = timesOf(lesson), unlockAt = times ? times.presentationAt : null;
  const hw0 = homeworkShown(lesson, c.now) ? String(lesson.homework).trim() : "";
  // Selbstlern-Phase bzw. ältere Vertretung: die Ansicht der Stationen (Feibeitsblätter aus Entwürfen über ihren Code) – sonst keine Abfrage mehr
  const sub = lesson.sub_status === "aktiv" || selbst ? await getSubstitute(c.db, lessonId) : null;
  const drafts = selbst ? ((await c.db.prepare("SELECT id, status, sheet_code FROM fb_drafts WHERE lesson_id=?1").bind(lessonId).all()).results || []) : [];
  const shown = studentSubstitute(sub, drafts);
  const upTo = p && p.shown_until && p.shown_until < p.pages ? p.shown_until : null;
  // nächste Sitzung mit der Lehrkraft: Fälligkeit der Hausaufgabe und Ende der KI-Chatbots (eine Abfrage)
  const nextT = selbst ? await nextTeacherLesson(c.db, lesson) : null;
  // der Standardtext der Hausaufgabe nennt immer den aktuellen Termin der nächsten Stunde mit der Lehrkraft
  const hw = selbst && hw0 ? selbstlernHomeworkNow(hw0, nextT ? nextT.date : null) : hw0;
  const win = sd ? selbstWindow(lesson, nextT) : null;
  const hasBot = sd && !!shown.selbstlern && shown.selbstlern.stationen.some((x) => x.typ === "erklaer_chatbot");
  const aiOn = sd ? !!win && lesson.student_ai !== 0 && c.now <= win.end : !!times && lesson.student_ai !== 0 && c.now <= times.end;
  const providers = aiOn || hasBot ? await taskProviders(c.db, "erklaeren") : null;
  return json({ ok: true, authLeftMs: c.authLeftMs, lesson: lessonCard(lesson, joinedAt, c.now),
    files: (files.results || []).map((f) => ({ id: f.id, kind: f.kind, name: f.name, mime: f.mime, size: f.size, createdAt: f.created_at, ...(f.kind === "text" ? { text: f.text || "" } : {}),
      ...(f.kind === "link" ? { url: cleanWebUrl(f.text) || "" } : {}), ...(f.source === "notfall" ? { notfall: true } : {}) })),
    sheets: (sheets.results || []).filter((s) => s.kind !== "escape").map((s) => ({ code: s.code, title: s.title })),   // Escape-Finale nur über den Tunnel
    presentation: p ? { name: p.name, pages: p.pages, unlockAt, unlocked: unlockAt !== null && c.now >= unlockAt, upTo } : null,
    homework: hw ? { text: hw, dueDate: selbst ? (nextT ? nextT.date : null) : await nextLessonDate(c.db, lesson) } : null,
    // wann sich die Ansicht ändert (Begriffshilfe beginnt/endet, Hausaufgabe erscheint, Präsentation wird frei) – unabhängig davon, ob es eine Hausaufgabe gibt
    changesAt: [...(times ? [times.start, times.end + 1000, times.homeworkAt, times.presentationAt] : []), ...(win ? [win.start, win.end + 1000] : [])].filter((t) => t > c.now),
    // KI-Begriffshilfe: nur zwischen Beginn und Ende der Stunde (Selbstlern-Phase: bis zur nächsten Stunde mit der Lehrkraft); die Dienste stehen im Einwilligungstext
    aiHelp: aiOn ? { start: sd ? win.start : times.start, end: sd ? win.end : times.end, providers, ...(sd ? { selbstlern: true, untilNext: win.untilNext } : {}) } : null,
    // Erklär-Chatbot der Stationen (nur Selbstlern-Phase mit iPads): Zeitraum wie die Begriffshilfe (unabhängig von ihrem Schalter in der Sitzung)
    ...(hasBot ? { explain: win ? { start: win.start, end: win.end, untilNext: win.untilNext, providers } : { start: null, end: null, untilNext: false, providers } } : {}),
    substitute: shown.substitute, ...(shown.selbstlern ? { selbstlern: shown.selbstlern } : {}),
    feibeitsblattUrl: c.env.FEIBEITSBLATT_URL || "https://feibeitsblatt.janrickmer.de/",
    now: c.now });
}

export async function routeStudentFileLink(c, fileId) {
  await requireStudent(c);
  const f = await getFile(c.db, fileId);
  if (f.area !== "student" || f.kind !== "file" || f.status !== "ready") throw new HttpError(404, "not_found", "Datei nicht gefunden.");
  const { lesson } = await requireAccess(c, f.lesson_id);
  if (f.source === SELBSTLERN && lesson.sub_status !== SELBSTLERN) throw new HttpError(404, "not_found", "Datei nicht gefunden.");
  return json({ ok: true, url: await downloadUrl(requireSecret(c.env), f, false, 10 * 60e3, c.now) });
}

// Präsentation frei? Erst 5 Minuten nach dem Ende der Sitzung (ohne Beginn oder Dauer nie) – für die PDF und für das Folienfenster
async function releasedPresentation(c, lessonId, cols) {
  const { lesson } = await requireAccess(c, lessonId);
  if (lesson.sub_status === SELBSTLERN) throw new HttpError(404, "not_found", "In dieser Selbstlern-Phase gibt es keine Präsentation aus dem Unterricht – die Stationen findest du im Ablaufplan.");
  const times = timesOf(lesson);
  if (!times) throw new HttpError(403, "not_yet", "Die Präsentation kannst du nach dem Unterricht selbst öffnen – deine Lehrkraft hat die Uhrzeit der Sitzung noch nicht eingetragen.");
  if (c.now < times.presentationAt) throw new HttpError(403, "not_yet", "Die Präsentation kannst du ab " + fmtClockBerlin(times.presentationAt) + " Uhr selbst öffnen (5 Minuten nach dem Unterricht).", { unlockAt: times.presentationAt });
  const f = await c.db.prepare("SELECT " + cols + " FROM files WHERE lesson_id=?1 AND area='presentation' AND status='ready' LIMIT 1").bind(lessonId).first();
  if (!f) throw new HttpError(404, "not_found", "Zu dieser Sitzung gibt es noch keine Präsentation.");
  return f;
}

export async function routeStudentPresentationLink(c, lessonId) {
  const f = await releasedPresentation(c, lessonId, "*");
  const body = await readJson(c.request, 1000);
  // letzte gezeigte Folie markiert: nur die gekürzte PDF (Folie 1 bis zur Markierung), nie die vollständige
  const cut = f.shown_until && f.shown_until < f.pages;
  if (cut && !f.cut_size) throw new HttpError(409, "not_ready", "Die Präsentation wird gerade vorbereitet. Bitte versuch es gleich noch einmal.");
  // trägt die hochgeladene PDF Notizen der Lehrkraft bzw. Anhänge (Nachtrag 20): nur die bereinigte Fassung, nie die hochgeladene
  if (!cut && f.clean_size != null && !(f.clean_size > 0)) throw new HttpError(409, "not_ready", "Die Präsentation wird gerade vorbereitet. Bitte versuch es gleich noch einmal.");
  return json({ ok: true, url: await downloadUrl(requireSecret(c.env), f, body.inline !== false, 10 * 60e3, c.now, cut ? "cut" : f.clean_size > 0 ? "clean" : "") });
}

/* Folienfenster nach der Sitzung (Nachtrag 19): signierte, kurzlebige Links auf die Folienbilder from…to – höchstens STUDENT_SLIDE_BLOCK
   auf einmal (je Folie ein HMAC) und nie jenseits der markierten letzten gezeigten Folie (wie die heruntergeladene PDF). Ohne Folienbilder
   (ältere Präsentation) ist slides leer – die Seite bietet dann nur die PDF an. */
export async function routeStudentPresentationSlides(c, lessonId) {
  const f = await releasedPresentation(c, lessonId, "id, pages, shown_until, video_slides");
  const body = await readJson(c.request, 1000);
  const total = studentSlideLimit(f), from = Number(body.from), to = body.to === undefined ? from : Number(body.to);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) throw bad("Ungültige Foliennummer.");
  if (from > total) throw new HttpError(403, "not_shown", total < f.pages ? "So weit seid ihr im Unterricht nicht gekommen – freigegeben " + (total === 1 ? "ist nur Folie 1." : "sind Folie 1 bis " + total + ".")
    : "Diese Folie gibt es in der Präsentation nicht.", { total });
  const last = Math.min(to, total, from + STUDENT_SLIDE_BLOCK - 1);
  const rows = await c.db.prepare("SELECT n, w, h FROM slides WHERE file_id=?1 AND n BETWEEN ?2 AND ?3 ORDER BY n").bind(f.id, from, last).all();
  const secret = requireSecret(c.env), exp = studentSlideExp(c.now), slides = [];
  // Videofolien (Nachtrag 38): nach der Stunde unter der Folie der Link zu YouTube (live sehen die Schüler:innen nur die Folie)
  const videos = videoSlidesOf({ videos: videoSlidesData(f.video_slides, f.pages) });
  for (const r of rows.results || []) {
    const v = videoAt(videos, r.n);
    slides.push({ n: r.n, w: r.w || null, h: r.h || null, url: await studentSlideUrl(secret, f.id, r.n, exp, c.now),
      ...(v ? { video: { url: videoWatchUrl(v), title: v.title || "", clip: videoClipText(v) } } : {}) });
  }
  return json({ ok: true, authLeftMs: c.authLeftMs, total, from, to: last, exp, slides });
}

/* KI-Begriffshilfe (Wunsch der Lehrkraft vom 10.11.2026): nur mit Einwilligung, nur während der Stunde, nur Fachbegriffe und Unterrichtsinhalt.
   Gesendet wird nur die Frage (und die letzten Fragen und Antworten dieses Gesprächs aus dem Browser) – nie eine Kennung des Geräts.
   Nichts davon wird gespeichert oder protokolliert. */
export async function routeStudentAsk(c, lessonId) {
  const { student, lesson } = await requireAccess(c, lessonId);
  const t = timesOf(lesson), sd = selbstDigital(lesson);
  if (lesson.student_ai === 0) throw new HttpError(403, "ai_off", "Deine Lehrkraft hat die KI-Begriffshilfe für diese Sitzung ausgeschaltet.");
  if (sd) {
    // Selbstlern-Phase: ab dem Beginn der Sitzung bis zur nächsten Stunde mit der Lehrkraft (die Stationen sind bis dahin Hausaufgabe)
    const win = selbstWindow(lesson, await nextTeacherLesson(c.db, lesson));
    if (!win || c.now < win.start || c.now > win.end) throw new HttpError(403, "not_now", selbstNotNow(win, c.now, "Die KI-Begriffshilfe", "Die KI-Begriffshilfe gibt es nicht mehr"));
  } else if (!t || c.now < t.start || c.now > t.end) throw new HttpError(403, "not_now", "Die KI-Begriffshilfe gibt es nur während der Unterrichtsstunde.");
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
  let hist = (Array.isArray(body.history) ? body.history : []).slice(-STUDENT_HELP_LIMITS.history)
    .map((x) => ({ q: cleanLine(x && x.q, STUDENT_HELP_LIMITS.question), a: cleanText(x && x.a, STUDENT_HELP_LIMITS.answer).trim(), sig: x && x.sig })).filter((x) => x.q && x.a);
  // Selbstlern-Phase (ohne Aufsicht, bis zur nächsten Stunde mit der Lehrkraft): nur unterschriebene frühere Antworten zählen – wie beim Erklär-Chatbot
  const secret = sd ? requireSecret(c.env) : null;
  if (sd) { const okH = []; for (const x of hist) if (await hmacOk(secret, helpSigText(lessonId, x.q, x.a), x.sig)) okH.push(x); hist = okH; }
  const extra = await c.db.prepare("SELECT topic, portal FROM lessons WHERE id=?1").bind(lessonId).first();
  // Selbstlern-Phase: eigene Regeln (Verständnisfragen, keine Stationen oder Hausaufgaben erledigen) – aus gespeicherten Daten, nie aus dem Browser
  const sp = sd ? readSelbstlern((await getSubstitute(c.db, lessonId) || {}).proposal) : null;
  const system = sd ? selbstlernHelpPrompt({ ...lesson, topic: extra && extra.topic }, sp ? sp.stationen : []) : studentHelpPrompt({ ...lesson, topic: extra && extra.topic, portal: extra && extra.portal });
  const messages = [{ role: "system", content: system },
    ...hist.flatMap((x) => [{ role: "user", content: x.q }, { role: "assistant", content: x.a }]), { role: "user", content: q }];
  let r;
  try { r = await callTask(c.env, c.db, "erklaeren", messages, { maxTokens: TASKS.erklaeren.maxTokens }); }
  catch { throw new HttpError(502, "ai_error", "Die KI-Begriffshilfe antwortet gerade nicht. Versuch es gleich noch einmal oder frag deine Lehrkraft."); }
  const answer = cleanText(r && r.text, STUDENT_HELP_LIMITS.answer).trim() || "Dazu kann ich gerade nichts sagen. Frag bitte deine Lehrkraft.";
  return json({ ok: true, answer, ...(sd ? { q, sig: await hmac(secret, helpSigText(lessonId, q, answer)) } : {}) });
}

/* Erklär-Chatbot einer Station (Selbstlern-Phase, Nachtrag 29 Teil B): die Schülerin bzw. der Schüler erklärt, der Chatbot fragt kritisch nach.
   Den System-Prompt baut der Worker aus der gespeicherten Station (Auftrag, Kernpunkte, Fehlvorstellungen – die Kernpunkte sieht der Browser nie) und der
   Lerngruppe; vom Browser kommen nur die Kennung der Station, die Nachricht und der bisherige Verlauf – frühere Antworten des Chatbots gelten nur mit
   ihrer Unterschrift (HMAC), sonst entfallen sie. Dieselbe Einwilligung, dieselben Grenzen und dieselbe Kette der kostenlosen KI-Dienste wie die
   KI-Begriffshilfe (Aufgabe „erklaeren“); nichts wird gespeichert oder protokolliert, nie eine Kennung des Geräts an die KI. */
export async function routeStudentExplain(c, lessonId) {
  const { student, lesson } = await requireAccess(c, lessonId);
  if (!selbstDigital(lesson)) throw new HttpError(404, "not_found", "In dieser Sitzung gibt es keinen Erklär-Chatbot.");
  const win = selbstWindow(lesson, await nextTeacherLesson(c.db, lesson));
  if (!win || c.now < win.start || c.now > win.end) throw new HttpError(403, "not_now", selbstNotNow(win, c.now, "Den Erklär-Chatbot", "Den Erklär-Chatbot gibt es nicht mehr"));
  const body = await readJson(c.request, 40000);
  if (body.consent !== true) throw bad("Bitte willige zuerst ein, dass du die KI-Chatbots nutzen möchtest.");
  const p = readSelbstlern((await getSubstitute(c.db, lessonId) || {}).proposal);
  const station = p && typeof body.station === "string" ? p.stationen.find((x) => x.id && x.id === body.station && x.typ === "erklaer_chatbot" && x.bot) : null;
  if (!station) throw new HttpError(404, "not_found", "Diese Station gibt es nicht mehr – deine Lehrkraft hat die Selbstlern-Phase geändert. Lade die Seite neu.");
  const L = EXPLAIN_BOT_LIMITS, msg = cleanText(body.message, L.message).trim();
  if (body.finish !== true && msg.length < 2) throw bad("Bitte schreib zuerst deine Erklärung.");
  // dieselben Grenzen wie die KI-Begriffshilfe (gemeinsame Zähler je Gerät und je Sitzung)
  const devKey = "ask:dev:" + student.id, lesKey = "ask:l:" + lessonId;
  let ms = await lockedFor(c.db, devKey, c.now);
  if (ms) throw lockedError(ms, "Du hast gerade sehr viele Nachrichten geschrieben. Bitte warte " + fmtWait(ms) + " – oder schreib deine Erklärung so lange in dein Heft.");
  ms = await lockedFor(c.db, lesKey, c.now);
  if (ms) throw lockedError(ms, "Der Erklär-Chatbot ist für diese Sitzung gerade ausgelastet. Bitte versuch es in " + fmtWait(ms) + " noch einmal.");
  await registerFail(c.db, devKey, LOCKS.askDevice, c.now);
  await registerFail(c.db, lesKey, LOCKS.askLesson, c.now);
  const secret = requireSecret(c.env), hist = [];
  for (const x of (Array.isArray(body.history) ? body.history : []).slice(-L.history)) {
    const q = cleanText(x && x.q, L.message).trim(), a = cleanText(x && x.a, L.answer).trim();
    if (q && a && (await hmacOk(secret, explainSigText(lessonId, station.id, q, a), x && x.sig))) hist.push({ q, a });
  }
  // beenden: auf Wunsch oder spätestens mit der letzten Nachricht eines Gesprächs – dann Rückmeldung statt Rückfrage
  const done = body.finish === true || hist.length >= L.history - 1;
  const extra = await c.db.prepare("SELECT topic FROM lessons WHERE id=?1").bind(lessonId).first();
  const q = msg || EXPLAIN_FINISH_MESSAGE;
  const messages = [{ role: "system", content: explainBotPrompt({ ...lesson, topic: extra && extra.topic }, station.bot, { finish: done }) },
    ...hist.flatMap((x) => [{ role: "user", content: x.q }, { role: "assistant", content: x.a }]), { role: "user", content: q }];
  let r;
  try { r = await callTask(c.env, c.db, "erklaeren", messages, { maxTokens: TASKS.erklaeren.maxTokens }); }
  catch { throw new HttpError(502, "ai_error", "Der Erklär-Chatbot antwortet gerade nicht. Versuch es gleich noch einmal – oder schreib deine Erklärung so lange in dein Heft."); }
  const answer = cleanText(r && r.text, L.answer).trim() || "Dazu kann ich gerade nichts sagen. Erklär es mir bitte noch einmal mit anderen Worten.";
  return json({ ok: true, q, answer, done, ...(done ? {} : { sig: await hmac(secret, explainSigText(lessonId, station.id, q, answer)) }) });
}

export async function routeStudentLiveTicket(c, lessonId) {
  const { student } = await requireAccess(c, lessonId);
  return json({ ok: true, ...(await liveTicket(c, lessonId, "student", student.id)) });
}
export async function routeStudentLiveState(c, lessonId) {
  await requireAccess(c, lessonId);
  return json({ ok: true, live: await liveState(c, lessonId, "student") });
}
