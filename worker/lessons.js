// lessons.js – Unterrichtssitzungen (Lehrkraft): anlegen, planen (Chat), Schulportal-Eintrag, Feibeitsblatt-Entwürfe und -Verknüpfungen.
import { HttpError, bad, json, readJson, randomId, generateCode, cleanText, cleanLine, isId, isDate, isObj } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { callTask, PROVIDERS } from "./ai.js";
import {
  isValidClass, isValidSubject, isValidCode, normalizeCode, greetingText, planningSystemPrompt, portalMessages, feibeitsblattMessages,
  chatTranscript, extractJsonObject, validatePortalData, renderPortalEntry, normalizeFbDraft, isIsoDate, daysBetween, hasStop,
} from "../public/shared.js";

export const LIMITS = { title: 200, topic: 500, ideas: 20000, homework: 10000, portal: 30000, message: 30000, answer: 100000, textMaterial: 200000 };

export const lessonOut = (r, extra = {}) => ({
  id: r.id, subject: r.subject, klass: r.klass, title: r.title, topic: r.topic, durationMin: r.duration_min ?? null, date: r.lesson_date || null,
  ideas: r.ideas, homework: r.homework || "", code: r.code, portal: r.portal, portalVersion: r.portal_version, portalUpdatedAt: r.portal_updated_at ?? null, portalSource: r.portal_source || null,
  createdAt: r.created_at, updatedAt: r.updated_at, ...extra,
});
export const fileOut = (f, withText = true) => ({
  id: f.id, area: f.area, kind: f.kind, name: f.name, mime: f.mime, size: f.size, pages: f.pages ?? null, status: f.status, source: f.source || null,
  createdAt: f.created_at, ...(withText && f.kind === "text" ? { text: f.text || "" } : {}),
});
const msgOut = (m) => ({ id: m.id, role: m.role, content: m.content, model: m.model || null, mode: m.mode || null, createdAt: m.created_at });
const draftOut = (d) => { let data = null; try { data = JSON.parse(d.data); } catch {} return { id: d.id, data, source: d.source, status: d.status, sheetCode: d.sheet_code || null, createdAt: d.created_at, updatedAt: d.updated_at }; };

export async function getLesson(db, id) {
  if (!isId(id)) throw new HttpError(404, "not_found", "Diese Sitzung gibt es nicht (mehr).");
  const r = await db.prepare("SELECT * FROM lessons WHERE id=?1").bind(id).first();
  if (!r) throw new HttpError(404, "not_found", "Diese Sitzung gibt es nicht (mehr).");
  return r;
}

/* Kontext für KI und Prompts aus der Datenbank */
export async function lessonCtx(db, lesson) {
  const [files, sheets] = await db.batch([
    db.prepare("SELECT name, area, kind, pages, substr(text, 1, 6000) AS text FROM files WHERE lesson_id=?1 AND status='ready' ORDER BY created_at").bind(lesson.id),
    db.prepare("SELECT code, title FROM fb_sheets WHERE lesson_id=?1 ORDER BY created_at").bind(lesson.id),
  ]);
  return {
    lessonId: lesson.id, subject: lesson.subject, klass: lesson.klass,
    lesson: { title: lesson.title, topic: lesson.topic, durationMin: lesson.duration_min, date: lesson.lesson_date, ideas: lesson.ideas, homework: lesson.homework || "" },
    materials: (files.results || []).map((f) => ({ name: f.name, area: f.area, kind: f.kind, pages: f.pages, text: f.text || "" })),
    sheets: sheets.results || [], portal: lesson.portal,
  };
}
export async function chatMessages(db, lessonId, limit = 200) {
  const r = await db.prepare("SELECT * FROM (SELECT id, role, content, model, mode, created_at FROM chat WHERE lesson_id=?1 ORDER BY id DESC LIMIT ?2) ORDER BY id").bind(lessonId, limit).all();
  return r.results || [];
}

function lessonFields(body, partial) {
  const f = {};
  if (!partial || body.title !== undefined) f.title = cleanLine(body.title, LIMITS.title);
  if (!partial || body.topic !== undefined) f.topic = cleanLine(body.topic, LIMITS.topic);
  if (!partial || body.ideas !== undefined) f.ideas = cleanText(body.ideas, LIMITS.ideas);
  if (!partial || body.homework !== undefined) f.homework = cleanText(body.homework, LIMITS.homework).trim();
  if (!partial || body.durationMin !== undefined) {
    const d = body.durationMin === null || body.durationMin === "" || body.durationMin === undefined ? null : Number(body.durationMin);
    if (d !== null && (!Number.isInteger(d) || d < 5 || d > 600)) throw bad("Die Dauer muss zwischen 5 und 600 Minuten liegen.");
    f.duration_min = d;
  }
  // Datum ist Pflicht (Vorgabe der Lehrkraft) und bleibt änderbar, z. B. bei Krankheit
  if (!partial || body.date !== undefined) {
    if (!body.date) throw bad("Bitte das Datum wählen, an dem die Sitzung stattfindet.");
    if (!isDate(body.date) || !isIsoDate(body.date)) throw bad("Ungültiges Datum.");
    f.lesson_date = body.date;
  }
  return f;
}

export async function createLesson(db, body, now) {
  if (!isValidSubject(body.subject)) throw bad("Bitte eines der drei Fächer wählen.");
  if (!isValidClass(body.klass)) throw bad("Bitte eine gültige Klasse wählen.");
  const f = lessonFields(body, false);
  if (!f.title) f.title = f.topic || "Sitzung vom " + new Date(now).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
  const id = randomId(8);
  for (let i = 0; i < 8; i++) {
    const code = generateCode();
    const r = await db.prepare("INSERT INTO lessons(id, subject, klass, title, topic, duration_min, lesson_date, ideas, homework, code, created_at, updated_at) " +
      "VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11) ON CONFLICT(code) DO NOTHING")
      .bind(id, body.subject, body.klass, f.title, f.topic, f.duration_min, f.lesson_date, f.ideas, f.homework, code, now).run();
    if (r.meta && r.meta.changes) {
      await db.prepare("INSERT INTO chat(lesson_id, role, content, model, created_at) VALUES(?1, 'assistant', ?2, 'begruessung', ?3)")
        .bind(id, greetingText({ subject: body.subject, klass: body.klass, durationMin: f.duration_min }), now).run();
      return getLesson(db, id);
    }
  }
  throw new Error("Kein freier Sitzungscode gefunden");
}

export async function routeLessonsList(c) {
  await requireTeacher(c);
  const u = new URL(c.request.url);
  const subject = u.searchParams.get("subject"), klass = u.searchParams.get("klass");
  let q = "SELECT l.id, l.subject, l.klass, l.title, l.topic, l.lesson_date, l.duration_min, l.code, l.created_at, l.updated_at, length(l.portal) > 0 AS has_portal, " +
    "(instr(l.portal, '⏸') > 0 AND instr(l.portal, 'Zwischenstopp') > 0) AS has_stop, length(l.homework) > 0 AS has_homework, " +
    "(SELECT COUNT(*) FROM student_access a WHERE a.lesson_id = l.id) AS students FROM lessons l";
  const args = [];
  if (subject) { if (!isValidSubject(subject)) throw bad("Unbekanntes Fach."); args.push(subject); q += " WHERE l.subject=?" + args.length; }
  if (klass) { if (!isValidClass(klass)) throw bad("Unbekannte Klasse."); args.push(klass); q += (args.length > 1 ? " AND" : " WHERE") + " l.klass=?" + args.length; }
  q += " ORDER BY COALESCE(l.lesson_date, '') DESC, l.created_at DESC LIMIT 2000";
  const r = await c.db.prepare(q).bind(...args).all();
  return json({ ok: true, lessons: (r.results || []).map((x) => ({ id: x.id, subject: x.subject, klass: x.klass, title: x.title, topic: x.topic, date: x.lesson_date, durationMin: x.duration_min,
    code: x.code, createdAt: x.created_at, updatedAt: x.updated_at, hasPortal: !!x.has_portal,
    hasStop: !!x.has_stop, hasHomework: !!x.has_homework, studentCount: x.students || 0 })) });
}

export async function routeLessonCreate(c) {
  await requireTeacher(c);
  const l = await createLesson(c.db, await readJson(c.request, 50000), c.now);
  return json({ ok: true, lesson: lessonOut(l) });
}

export async function routeLessonGet(c, id) {
  await requireTeacher(c);
  const l = await getLesson(c.db, id);
  const [files, sheets, drafts, students] = await c.db.batch([
    c.db.prepare("SELECT * FROM files WHERE lesson_id=?1 ORDER BY created_at").bind(id),
    c.db.prepare("SELECT code, title, created_at FROM fb_sheets WHERE lesson_id=?1 ORDER BY created_at").bind(id),
    c.db.prepare("SELECT * FROM fb_drafts WHERE lesson_id=?1 ORDER BY created_at DESC LIMIT 50").bind(id),
    c.db.prepare("SELECT COUNT(*) AS n FROM student_access WHERE lesson_id=?1").bind(id),
  ]);
  const messages = await chatMessages(c.db, id);
  const [prev, nextDate] = await Promise.all([previousLesson(c.db, l), nextLessonDate(c.db, l)]);
  const previousStop = prev && hasStop(prev.portal) ? { id: prev.id, title: prev.title, date: prev.lesson_date, portal: prev.portal } : null;
  return json({ ok: true, lesson: lessonOut(l, { studentCount: (students.results[0] || {}).n || 0, nextDate }), previousStop, messages: messages.map(msgOut),
    files: (files.results || []).map((f) => fileOut(f)), sheets: (sheets.results || []).map((s) => ({ code: s.code, title: s.title, createdAt: s.created_at })),
    drafts: (drafts.results || []).map(draftOut) });
}

/* Nachbarsitzungen derselben Klasse im selben Fach (nach Datum, bei gleichem Datum nach Anlegezeit) */
export function previousLesson(db, l) {
  if (!l.lesson_date) return null;
  return db.prepare("SELECT id, title, lesson_date, portal FROM lessons WHERE subject=?1 AND klass=?2 AND id<>?3 AND lesson_date IS NOT NULL " +
    "AND (lesson_date < ?4 OR (lesson_date = ?4 AND created_at < ?5)) ORDER BY lesson_date DESC, created_at DESC LIMIT 1").bind(l.subject, l.klass, l.id, l.lesson_date, l.created_at).first();
}
// Fälligkeit der Hausaufgabe: Datum der nächsten Sitzung (ändert sich mit, wenn Sitzungen verschoben werden)
export async function nextLessonDate(db, l) {
  if (!l.lesson_date) return null;
  const r = await db.prepare("SELECT lesson_date FROM lessons WHERE subject=?1 AND klass=?2 AND id<>?3 AND lesson_date > ?4 ORDER BY lesson_date LIMIT 1")
    .bind(l.subject, l.klass, l.id, l.lesson_date).first();
  return r ? r.lesson_date : null;
}

/* Ändern; shiftFollowing: alle späteren Sitzungen derselben Klasse im Fach um denselben Abstand (Tage) mitverschieben */
export async function updateLesson(db, id, body, now, shiftFollowing = false) {
  const f = lessonFields(body, true), keys = Object.keys(f);
  if (!keys.length) return { lesson: await getLesson(db, id), shifted: 0 };
  if (f.title !== undefined && !f.title) throw bad("Der Titel darf nicht leer sein.");
  const old = await getLesson(db, id);
  const sets = keys.map((k, i) => k + "=?" + (i + 2)).join(", ");
  const stmts = [db.prepare("UPDATE lessons SET " + sets + ", updated_at=?" + (keys.length + 2) + " WHERE id=?1").bind(id, ...keys.map((k) => f[k]), now)];
  const offset = shiftFollowing && f.lesson_date && old.lesson_date ? daysBetween(old.lesson_date, f.lesson_date) : 0;
  if (offset) stmts.push(db.prepare("UPDATE lessons SET lesson_date=date(lesson_date, ?1), updated_at=?2 WHERE subject=?3 AND klass=?4 AND id<>?5 AND lesson_date > ?6")
    .bind((offset > 0 ? "+" : "") + offset + " days", now, old.subject, old.klass, id, old.lesson_date));
  const res = await db.batch(stmts);   // eine Transaktion: entweder alles oder nichts
  return { lesson: await getLesson(db, id), shifted: offset ? (res[1].meta && res[1].meta.changes) || 0 : 0 };
}
export async function routeLessonPatch(c, id) {
  await requireTeacher(c);
  await getLesson(c.db, id);
  const body = await readJson(c.request, 100000);
  const r = await updateLesson(c.db, id, body, c.now, body.shiftFollowing === true);
  return json({ ok: true, lesson: lessonOut(r.lesson, { nextDate: await nextLessonDate(c.db, r.lesson) }), shifted: r.shifted });
}

export async function routeLessonDelete(c, id) {
  await requireTeacher(c);
  await getLesson(c.db, id);
  // Dateien in R2 löschen (Präfix der Sitzung), dann die Datensätze
  let cursor;
  do {
    const list = await c.env.FILES.list({ prefix: "l/" + id + "/", cursor, limit: 1000 });
    if (list.objects.length) await c.env.FILES.delete(list.objects.map((o) => o.key));
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  await c.db.batch([
    c.db.prepare("DELETE FROM slides WHERE file_id IN (SELECT id FROM files WHERE lesson_id=?1)").bind(id),
    c.db.prepare("DELETE FROM files WHERE lesson_id=?1").bind(id),
    c.db.prepare("DELETE FROM chat WHERE lesson_id=?1").bind(id),
    c.db.prepare("DELETE FROM student_access WHERE lesson_id=?1").bind(id),
    c.db.prepare("DELETE FROM fb_sheets WHERE lesson_id=?1").bind(id),
    c.db.prepare("DELETE FROM fb_drafts WHERE lesson_id=?1").bind(id),
    c.db.prepare("DELETE FROM lessons WHERE id=?1").bind(id),
  ]);
  try { await c.env.LIVE.get(c.env.LIVE.idFromName(id)).fetch("https://live/reset", { method: "POST" }); } catch {}
  return json({ ok: true });
}

/* ---------- Schulportal-Eintrag ---------- */
// Speichern mit Versionsprüfung: wurde der Eintrag inzwischen anderswo geändert (z. B. von Claude über den Connector), meldet
// der Server 409 – nie stillschweigend überschreiben.
export async function savePortal(db, id, text, baseVersion, source, now) {
  const t = cleanText(text, LIMITS.portal);
  const q = baseVersion == null
    ? db.prepare("UPDATE lessons SET portal=?2, portal_version=portal_version+1, portal_updated_at=?3, portal_source=?4, updated_at=?3 WHERE id=?1 RETURNING portal_version").bind(id, t, now, source)
    : db.prepare("UPDATE lessons SET portal=?2, portal_version=portal_version+1, portal_updated_at=?3, portal_source=?4, updated_at=?3 WHERE id=?1 AND portal_version=?5 RETURNING portal_version").bind(id, t, now, source, Number(baseVersion));
  const r = await q.first();
  if (!r) {
    const cur = await db.prepare("SELECT portal, portal_version, portal_updated_at, portal_source FROM lessons WHERE id=?1").bind(id).first();
    if (!cur) throw new HttpError(404, "not_found", "Diese Sitzung gibt es nicht (mehr).");
    throw new HttpError(409, "portal_conflict", "Der Schulportal-Eintrag wurde inzwischen an anderer Stelle geändert.", { current: { text: cur.portal, version: cur.portal_version, updatedAt: cur.portal_updated_at, source: cur.portal_source } });
  }
  return { text: t, version: r.portal_version, updatedAt: now, source };
}
export async function routePortalPut(c, id) {
  await requireTeacher(c);
  const body = await readJson(c.request, 200000);
  if (typeof body.text !== "string") throw bad("Text fehlt.");
  const base = body.force ? null : body.baseVersion;
  if (!body.force && !Number.isInteger(base)) throw bad("Version fehlt.");
  return json({ ok: true, portal: await savePortal(c.db, id, body.text, base, "lehrkraft", c.now) });
}
export async function routePortalGenerate(c, id) {
  await requireTeacher(c);
  const body = await readJson(c.request, 10000);
  const l = await getLesson(c.db, id);
  const ctx = await lessonCtx(c.db, l);
  const msgs = await chatMessages(c.db, id);
  if (!msgs.some((m) => m.role === "user")) throw bad("Bitte planen Sie die Stunde zuerst im Chat – der Eintrag entsteht aus der Planung.");
  const r = await callTask(c.env, c.db, "portal", portalMessages(ctx, chatTranscript(msgs, 30000)));
  const data = validatePortalData(extractJsonObject(r.text));
  const text = renderPortalEntry(data);
  const saved = await savePortal(c.db, id, text, Number.isInteger(body.baseVersion) ? body.baseVersion : null, "ki", c.now);
  return json({ ok: true, portal: saved, model: r.model });
}

/* ---------- Chat ---------- */
const MODE_HINT = {
  planning: "",
  ideas: "\n\nModus der aktuellen Anfrage: Unterrichtsidee weiterentwickeln. Prüfe die bisherige Idee kritisch (Stimmigkeit, Zeit, Aktivierung, Differenzierung, Sicherung), " +
    "schlage 2–3 überzeugende Alternativen bzw. Verbesserungen vor und begründe sie knapp.",
  material: "\n\nModus der aktuellen Anfrage: Unterrichtsmaterial erstellen. Formuliere das gewünschte Material vollständig und druckfertig aus (Markdown: Überschrift, " +
    "Arbeitsaufträge mit Operatoren, ggf. Texte, Tabellen, Platz für Antworten). Gib nur das Material aus, ohne Vorrede, damit es direkt als Datei übernommen werden kann.",
};
export async function routeChatPost(c, id) {
  await requireTeacher(c);
  const body = await readJson(c.request, 100000);
  const mode = MODE_HINT[body.mode] !== undefined ? body.mode : "planning";
  const text = cleanText(body.message, LIMITS.message).trim();
  if (!text) throw bad("Bitte eine Nachricht eingeben.");
  const l = await getLesson(c.db, id);
  const ctx = await lessonCtx(c.db, l);
  const um = await c.db.prepare("INSERT INTO chat(lesson_id, role, content, mode, created_at) VALUES(?1, 'user', ?2, ?3, ?4) RETURNING id").bind(id, text, mode, c.now).first();
  const history = (await chatMessages(c.db, id, 60)).filter((m) => m.role === "user" || m.role === "assistant");
  const messages = [{ role: "system", content: planningSystemPrompt(ctx) + MODE_HINT[mode] }, ...history.map((m) => ({ role: m.role, content: m.content }))];
  let r;
  try { r = await callTask(c.env, c.db, mode, messages, { stream: true }); }
  catch (e) { await c.db.prepare("DELETE FROM chat WHERE id=?1").bind(um.id).run(); throw e; }
  const label = (PROVIDERS[r.provider] || {}).label || r.provider;
  if (r.stream) {
    return new Response(r.stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "X-Model": encodeURIComponent(r.model), "X-Provider": encodeURIComponent(label), "X-User-Message": String(um.id), "X-Mode": mode } });
  }
  const am = await c.db.prepare("INSERT INTO chat(lesson_id, role, content, model, mode, created_at) VALUES(?1, 'assistant', ?2, ?3, ?4, ?5) RETURNING *")
    .bind(id, cleanText(r.text, LIMITS.answer), label + " · " + r.model, mode, Date.now()).first();
  c.waitUntil(c.db.prepare("UPDATE lessons SET updated_at=?2 WHERE id=?1").bind(id, Date.now()).run());
  return json({ ok: true, userMessageId: um.id, message: msgOut(am) });
}
// Der Browser hat die gestreamte Antwort zusammengesetzt und legt sie hier ab
export async function routeChatAnswer(c, id) {
  await requireTeacher(c);
  const body = await readJson(c.request, 400000);
  await getLesson(c.db, id);
  const content = cleanText(body.content, LIMITS.answer).trim();
  if (!content) throw bad("Leere Antwort.");
  const mode = MODE_HINT[body.mode] !== undefined ? body.mode : "planning";
  const am = await c.db.prepare("INSERT INTO chat(lesson_id, role, content, model, mode, created_at) VALUES(?1, 'assistant', ?2, ?3, ?4, ?5) RETURNING *")
    .bind(id, content, cleanLine(body.model, 200), mode, c.now).first();
  c.waitUntil(c.db.prepare("UPDATE lessons SET updated_at=?2 WHERE id=?1").bind(id, c.now).run());
  return json({ ok: true, message: msgOut(am) });
}
export async function routeChatDeleteOne(c, id, msgId) {
  await requireTeacher(c);
  const r = await c.db.prepare("DELETE FROM chat WHERE lesson_id=?1 AND id=?2").bind(id, Number(msgId)).run();
  if (!r.meta || !r.meta.changes) throw new HttpError(404, "not_found", "Nachricht nicht gefunden.");
  return json({ ok: true });
}
export async function routeChatClear(c, id) {
  await requireTeacher(c);
  const l = await getLesson(c.db, id);
  await c.db.batch([
    c.db.prepare("DELETE FROM chat WHERE lesson_id=?1").bind(id),
    c.db.prepare("INSERT INTO chat(lesson_id, role, content, model, created_at) VALUES(?1, 'assistant', ?2, 'begruessung', ?3)")
      .bind(id, greetingText({ subject: l.subject, klass: l.klass, durationMin: l.duration_min }), c.now),
  ]);
  return json({ ok: true, messages: (await chatMessages(c.db, id)).map(msgOut) });
}

/* ---------- Feibeitsblatt: Entwürfe und Verknüpfungen ---------- */
export async function insertDraft(db, lessonId, data, source, now) {
  const d = normalizeFbDraft(data), id = randomId(8);
  await db.prepare("INSERT INTO fb_drafts(id, lesson_id, data, source, status, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, 'draft', ?5, ?5)")
    .bind(id, lessonId, JSON.stringify(d), source, now).run();
  return { id, data: d, source, status: "draft", sheetCode: null, createdAt: now, updatedAt: now };
}
export async function routeDraftGenerate(c, id) {
  await requireTeacher(c);
  const body = await readJson(c.request, 20000);
  const l = await getLesson(c.db, id);
  const ctx = await lessonCtx(c.db, l);
  const msgs = await chatMessages(c.db, id);
  const r = await callTask(c.env, c.db, "feibeitsblatt", feibeitsblattMessages(ctx, chatTranscript(msgs, 30000), cleanText(body.wish, 2000)));
  const obj = extractJsonObject(r.text);
  if (!obj) throw new HttpError(502, "ai_error", "Die KI hat keinen verwertbaren Entwurf geliefert. Bitte noch einmal versuchen.");
  let draft;
  try { draft = await insertDraft(c.db, id, obj, "chat", c.now); } catch (e) { throw new HttpError(502, "ai_error", e.message); }
  return json({ ok: true, draft, model: r.model });
}
async function getDraft(db, draftId) {
  if (!isId(draftId)) throw new HttpError(404, "not_found", "Entwurf nicht gefunden.");
  const d = await db.prepare("SELECT * FROM fb_drafts WHERE id=?1").bind(draftId).first();
  if (!d) throw new HttpError(404, "not_found", "Entwurf nicht gefunden.");
  return d;
}
export async function routeDraftPut(c, draftId) {
  await requireTeacher(c);
  const body = await readJson(c.request, 400000);
  await getDraft(c.db, draftId);
  let d; try { d = normalizeFbDraft(body.data); } catch (e) { throw bad(e.message); }
  await c.db.prepare("UPDATE fb_drafts SET data=?2, updated_at=?3 WHERE id=?1").bind(draftId, JSON.stringify(d), c.now).run();
  return json({ ok: true, draft: draftOut(await getDraft(c.db, draftId)) });
}
export async function routeDraftDelete(c, draftId) {
  await requireTeacher(c);
  await c.db.prepare("DELETE FROM fb_drafts WHERE id=?1").bind(draftId).run();
  return json({ ok: true });
}
// Nach dem Anlegen im Feibeitsblatt (aus dem Browser der Lehrkraft): Entwurf abschließen und Blatt mit der Sitzung verknüpfen
export async function routeDraftCreated(c, draftId) {
  await requireTeacher(c);
  const body = await readJson(c.request, 10000);
  const d = await getDraft(c.db, draftId), code = normalizeCode(body.code);
  if (!isValidCode(code)) throw bad("Ungültiger Feibeitsblatt-Code.");
  await c.db.batch([
    c.db.prepare("UPDATE fb_drafts SET status='created', sheet_code=?2, updated_at=?3 WHERE id=?1").bind(draftId, code, c.now),
    c.db.prepare("INSERT INTO fb_sheets(lesson_id, code, title, created_at) VALUES(?1, ?2, ?3, ?4) ON CONFLICT(lesson_id, code) DO UPDATE SET title=excluded.title")
      .bind(d.lesson_id, code, cleanLine(body.title, 200) || "Feibeitsblatt", c.now),
  ]);
  return json({ ok: true });
}
export async function routeSheetLink(c, id) {
  await requireTeacher(c);
  await getLesson(c.db, id);
  const body = await readJson(c.request, 10000);
  const code = normalizeCode(body.code);
  if (!isValidCode(code)) throw bad("Bitte einen gültigen Feibeitsblatt-Code eingeben (6 Zeichen, z. B. AEH-4VY).");
  const title = cleanLine(body.title, 200) || "Feibeitsblatt";
  await c.db.prepare("INSERT INTO fb_sheets(lesson_id, code, title, created_at) VALUES(?1, ?2, ?3, ?4) ON CONFLICT(lesson_id, code) DO UPDATE SET title=excluded.title").bind(id, code, title, c.now).run();
  return json({ ok: true, sheet: { code, title, createdAt: c.now } });
}
export async function routeSheetUnlink(c, id, codeRaw) {
  await requireTeacher(c);
  let raw = codeRaw; try { raw = decodeURIComponent(codeRaw); } catch {}
  await c.db.prepare("DELETE FROM fb_sheets WHERE lesson_id=?1 AND code=?2").bind(id, normalizeCode(raw)).run();
  return json({ ok: true });
}
export { isObj };
