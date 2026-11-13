// lessons.js – Unterrichtssitzungen (Lehrkraft): anlegen, planen (Chat), Schulportal-Eintrag, Feibeitsblatt-Entwürfe und -Verknüpfungen.
import { HttpError, bad, json, readJson, randomId, generateCode, cleanText, cleanLine, isId, isDate, isObj } from "./lib.js";
import { cleanWebUrl, cleanCopies, cleanCodeSlides } from "../public/shared.js";
import { requireTeacher } from "./auth.js";
import { callTask, PROVIDERS } from "./ai.js";
import { getUnit, unitOut } from "./units.js";
import { loadSubjectConfigs } from "./bases.js";
import { deleteNotfallFiles } from "./files.js";
import { courseSettingsStmt, courseSettingsOut, courseInfo, courseRef } from "./courses.js";
import { gsCourseStmt, gsCourseOut } from "./gs.js";
import {
  isValidClass, isValidSubject, isValidCode, normalizeCode, greetingText, planningSystemPrompt, portalMessages, feibeitsblattMessages,
  chatTranscript, extractJsonObject, validatePortalData, renderPortalEntry, normalizeFbDraft, isIsoDate, hasStop, gradeKey, isClockTime, printFileName, GS_SUBJECT,
  planRefs, parentOpensAt,
} from "../public/shared.js";
import { unitContext } from "../public/planning.js";

export const LIMITS = { title: 200, topic: 500, ideas: 20000, homework: 10000, portal: 30000, message: 30000, answer: 100000, textMaterial: 200000, parentSummary: 800, parentNote: 2000 };

export const lessonOut = (r, extra = {}) => ({
  id: r.id, subject: r.subject, klass: r.klass, title: r.title, topic: r.topic, durationMin: r.duration_min ?? null, date: r.lesson_date || null, startTime: r.start_time || null, studentAi: r.student_ai === undefined || r.student_ai === null ? true : !!r.student_ai,
  ideas: r.ideas, homework: r.homework || "", code: r.code, unitId: r.unit_id || null, unitRow: r.unit_row || null, portal: r.portal, portalVersion: r.portal_version, portalUpdatedAt: r.portal_updated_at ?? null, portalSource: r.portal_source || null,
  createdAt: r.created_at, updatedAt: r.updated_at,
  // Grundschule: Inhalt und Hinweis für die Eltern, Ausfall-Eintrag, ob es einen Elternlink gibt (nie der Link selbst)
  ...(r.subject === GS_SUBJECT ? { parentSummary: r.parent_summary || "", parentNote: r.parent_note || "", cancelled: !!r.cancelled, hasParentLink: !!r.parent_hash } : {}), ...extra,
});
export const printProps = (f) => ({ copies: f.print_copies || 1, duplex: f.print_duplex !== 0, color: f.print_color === 1 });
export const codeSlidesOf = (f) => { try { return cleanCodeSlides(JSON.parse(f.code_slides || "[]"), f.pages || 0); } catch { return []; } };
/* Spalten einer Dateiliste ohne Claudes Gestaltung (html bis 1,5 MB je Material – nur '' als Kennzeichen „gestaltet“) */
export const FILE_COLS = "id, lesson_id, area, kind, name, mime, size, CASE WHEN kind IN ('text','link') THEN text END AS text, pages, status, source, created_at, updated_at, " +
  "fb_code, fb_sig, shown_until, cut_size, code_slides, print_copies, print_duplex, print_color, html_at, pdf_at, render_error, CASE WHEN html IS NULL THEN NULL ELSE '' END AS html, " +
  "CASE WHEN html IS NOT NULL THEN substr(text, 1, 6000) END AS design_text, cards, card_pages, card_img_at";
/* Bildkarten (Grundschule): files.cards als JSON {v:1, texts, share, rev} – gelesen tolerant (null = keine Bildkarten) */
export const MAX_CARD_TEXT = 1200;
export function cardData(f) {
  if (!f || f.cards == null) return null;
  let o = null;
  try { o = typeof f.cards === "string" ? JSON.parse(f.cards) : f.cards; } catch {}
  if (!o || typeof o !== "object") o = {};
  return { v: 1, texts: Array.isArray(o.texts) ? o.texts.slice(0, 40).map((t) => String(t == null ? "" : t).slice(0, MAX_CARD_TEXT)) : [], share: o.share === true, rev: Number.isInteger(o.rev) && o.rev >= 0 ? o.rev : 0 };
}
// Stand der PDF, aus dem die Kartenbilder stammen müssen (gestaltet: Zeitpunkt des Drucks; hochgeladen: Anlegezeit)
export const cardVersion = (f) => (f.pdf_at != null ? f.pdf_at : f.created_at);
const cardsOut = (f) => { const d = cardData(f), v = cardVersion(f);
  return { texts: d.texts, share: d.share, rev: d.rev, pages: f.card_pages || 0, current: f.card_img_at != null && f.card_img_at === v && (f.card_pages || 0) > 0, version: v }; };
export const fileOut = (f, withText = true) => ({
  id: f.id, area: f.area, kind: f.kind, name: f.name, mime: f.mime, size: f.size, pages: f.pages ?? null, status: f.status, source: f.source || null,
  fbCode: f.fb_code || null, fbSig: f.fb_sig || null, ...(f.area === "presentation" ? { shownUntil: f.shown_until ?? null, cut: !!f.cut_size, codeSlides: codeSlidesOf(f) } : {}),
  ...(f.area === "print" || (f.area === "student" && f.print_copies != null) ? { print: printProps(f), printName: printFileName({ name: f.name, ...printProps(f) }) } : {}),
  createdAt: f.created_at, ...(withText && f.kind === "text" ? { text: f.text || "" } : {}), ...(f.kind === "link" ? { url: f.text || "" } : {}),
  // von Claude gestaltet (HTML → PDF): ob die PDF zur aktuellen Gestaltung passt und die letzte Meldung des Druckers
  // text = Klartext der Gestaltung (gekürzt) für die Prompts (z. B. Präsentation)
  ...(f.cards != null ? { cards: cardsOut(f) } : {}),
  ...(f.html != null ? { design: { outdated: !f.pdf_at || (f.html_at || 0) > f.pdf_at, error: f.render_error || null, htmlAt: f.html_at || null, pdfAt: f.pdf_at || null,
    text: String(f.design_text != null ? f.design_text : f.text || "").slice(0, 6000) } } : {}),
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
  const gs = lesson.subject === GS_SUBJECT;
  const [files, sheets, cs, gc] = await db.batch([
    gs ? db.prepare(GS_CTX_FILES + " WHERE lesson_id=?1 AND area NOT IN ('archive','presentation') ORDER BY created_at").bind(lesson.id)
      : db.prepare("SELECT name, area, kind, pages, substr(text, 1, 6000) AS text FROM files WHERE lesson_id=?1 AND status='ready' ORDER BY created_at").bind(lesson.id),
    db.prepare("SELECT code, title FROM fb_sheets WHERE lesson_id=?1 ORDER BY created_at").bind(lesson.id),
    courseSettingsStmt(db, lesson.subject, lesson.klass),
    ...(gs ? [gsCourseStmt(db, lesson.klass)] : []),
  ]);
  const settings = courseSettingsOut((cs.results || [])[0]);
  if (gs) return gsLessonCtx(db, lesson, files.results || [], settings, gsCourseOut((gc.results || [])[0]));
  let unit = null;
  if (lesson.unit_id) { try { unit = unitOut(await getUnit(db, lesson.unit_id)); } catch {} }
  const cfg = (await loadSubjectConfigs(db))[lesson.subject] || { gradeNotes: {} };
  return {
    lessonId: lesson.id, subject: lesson.subject, klass: lesson.klass,
    lesson: { title: lesson.title, topic: lesson.topic, durationMin: lesson.duration_min, date: lesson.lesson_date, startTime: lesson.start_time || null, ideas: lesson.ideas, homework: lesson.homework || "" },
    materials: (files.results || []).filter((f) => f.area !== "archive").map((f) => ({ name: f.name, area: f.area, kind: f.kind, pages: f.pages, text: f.text || "" })),
    sheets: sheets.results || [], portal: lesson.portal,
    unit, unitText: unit ? unitContext(unit, lesson.unit_row) : "", gradeNote: (cfg.gradeNotes || {})[gradeKey(lesson.klass)] || "",
    classSize: settings ? settings.classSize : null,
  };
}
/* Grundschule: alle Dateien der Sitzung (auch noch nicht gedruckte) mit Kennung – für Verweise im Verlaufsplan und die Elternansicht */
export const GS_CTX_FILES = "SELECT id, lesson_id, name, area, kind, mime, pages, status, source, cards, card_pages, card_img_at, pdf_at, html_at, render_error, created_at, " +
  "print_copies, print_duplex, print_color, (html IS NOT NULL) AS designed, substr(text, 1, 6000) AS text FROM files";
async function gsLessonCtx(db, lesson, files, settings, course) {
  let unit = null;
  if (lesson.unit_id) { try { unit = unitOut(await getUnit(db, lesson.unit_id)); } catch {} }
  return {
    lessonId: lesson.id, subject: lesson.subject, klass: lesson.klass, course,
    lesson: { title: lesson.title, topic: lesson.topic, durationMin: lesson.duration_min, date: lesson.lesson_date, startTime: lesson.start_time || null, ideas: lesson.ideas,
      homework: lesson.homework || "", parentSummary: lesson.parent_summary || "", parentNote: lesson.parent_note || "" },
    materials: files.map((f) => ({ id: f.id, name: f.name, area: f.area, kind: f.kind, mime: f.mime, pages: f.pages, status: f.status, text: f.text || "" })), files,
    sheets: [], portal: lesson.portal, unit, unitText: unit ? unitContext(unit, lesson.unit_row) : "", gradeNote: "",
    classSize: settings ? settings.classSize : null,
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
  if (partial && body.studentAi !== undefined) f.student_ai = body.studentAi ? 1 : 0;
  // Grundschule: „Inhalt der Unterrichtsstunde“ und „Hinweis der Lehrkraft“ für die Elternansicht
  if (partial && body.parentSummary !== undefined) f.parent_summary = cleanText(body.parentSummary, LIMITS.parentSummary).trim();
  if (partial && body.parentNote !== undefined) f.parent_note = cleanText(body.parentNote, LIMITS.parentNote).trim();
  // Beginn (Uhrzeit, freiwillig): ohne ihn sehen Schüler:innen weder Hausaufgabe noch Präsentation (siehe lessonTimes)
  if (!partial || body.startTime !== undefined) {
    const t = body.startTime === undefined || body.startTime === null ? "" : String(body.startTime).trim();
    if (t && !isClockTime(t)) throw bad("Bitte die Uhrzeit im Format 07:45 angeben.");
    f.start_time = t || null;
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
  const gs = body.subject === GS_SUBJECT;
  if (gs) await courseRef(db, body.subject, body.klass);   // Grundschulkurs muss existieren
  else {
    if (!isValidSubject(body.subject)) throw bad("Bitte eines der drei Fächer wählen.");
    if (!isValidClass(body.klass)) throw bad("Bitte eine gültige Klasse wählen.");
  }
  const f = lessonFields(body, false);
  if (!f.title) f.title = f.topic || "Sitzung vom " + new Date(now).toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" });
  const id = randomId(8);
  for (let i = 0; i < 8; i++) {
    const code = generateCode();
    const r = await db.prepare("INSERT INTO lessons(id, subject, klass, title, topic, duration_min, lesson_date, ideas, homework, code, unit_id, unit_row, created_at, updated_at, start_time) " +
      "VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?14) ON CONFLICT(code) DO NOTHING")
      .bind(id, body.subject, body.klass, f.title, f.topic, f.duration_min, f.lesson_date, f.ideas, f.homework, code, body.unitId || null, body.unitRow || null, now, f.start_time).run();
    if (r.meta && r.meta.changes) {
      // Begrüßung des Planungschats – in der Grundschule gibt es keinen Chat (geplant wird mit Claude)
      if (!gs) await db.prepare("INSERT INTO chat(lesson_id, role, content, model, created_at) VALUES(?1, 'assistant', ?2, 'begruessung', ?3)")
        .bind(id, greetingText({ subject: body.subject, klass: body.klass, durationMin: f.duration_min }), now).run();
      return getLesson(db, id);
    }
  }
  throw new Error("Kein freier Sitzungscode gefunden");
}

/* Viele Sitzungen auf einmal (aus einer Unterrichtseinheit): wenige Datenbankaufrufe statt zwei je Sitzung (Free-Plan: höchstens
   50 Abfragen je Aufruf; ein db.batch zählt als eine). base = {subject, klass, topic, unitId}; items = [{title, date, durationMin, startTime, unitRow}] */
export async function createLessonsBulk(db, base, items, now) {
  let pending = items.map((it) => ({ ...it, id: randomId(8) }));
  const done = [];
  for (let attempt = 0; attempt < 4 && pending.length; attempt++) {
    const rows = pending.map((it) => ({ id: it.id, code: generateCode(), title: cleanLine(it.title, LIMITS.title) || "Sitzung", date: it.date, min: it.durationMin ?? null, row: it.unitRow || null, time: isClockTime(it.startTime) ? it.startTime : null }));
    const [, sel] = await db.batch([
      db.prepare("INSERT INTO lessons(id, subject, klass, title, topic, duration_min, lesson_date, ideas, homework, code, unit_id, unit_row, created_at, updated_at, start_time) " +
        "SELECT json_extract(value,'$.id'), ?1, ?2, json_extract(value,'$.title'), ?3, json_extract(value,'$.min'), json_extract(value,'$.date'), '', '', json_extract(value,'$.code'), ?4, json_extract(value,'$.row'), ?5, ?5, json_extract(value,'$.time') " +
        "FROM json_each(?6) WHERE true ON CONFLICT DO NOTHING").bind(base.subject, base.klass, cleanLine(base.topic, LIMITS.topic), base.unitId || null, now, JSON.stringify(rows)),
      db.prepare("SELECT id FROM lessons WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?1))").bind(JSON.stringify(rows.map((r) => ({ id: r.id })))),
    ]);
    const ok = new Set((sel.results || []).map((r) => r.id));
    done.push(...pending.filter((x) => ok.has(x.id)));
    // nicht eingefügt: Code zufällig schon vergeben (neuer Versuch mit neuem Code) oder Zeile hat schon eine Sitzung (eindeutiger Index)
    pending = pending.filter((x) => !ok.has(x.id)).map((x) => ({ ...x, id: randomId(8) }));
  }
  if (done.length && base.subject !== GS_SUBJECT) {   // Grundschule: kein Planungschat, also keine Begrüßung
    await db.prepare("INSERT INTO chat(lesson_id, role, content, model, created_at) SELECT json_extract(value,'$.id'), 'assistant', json_extract(value,'$.g'), 'begruessung', ?2 FROM json_each(?1)")
      .bind(JSON.stringify(done.map((x) => ({ id: x.id, g: greetingText({ subject: base.subject, klass: base.klass, durationMin: x.durationMin ?? null }) }))), now).run();
  }
  return done.length;
}

export async function routeLessonsList(c) {
  await requireTeacher(c);
  const u = new URL(c.request.url);
  const subject = u.searchParams.get("subject"), klass = u.searchParams.get("klass"), school = u.searchParams.get("school");
  let q = "SELECT l.id, l.subject, l.klass, l.title, l.topic, l.lesson_date, l.duration_min, l.code, l.unit_id, l.created_at, l.updated_at, length(l.portal) > 0 AS has_portal, " +
    "(SELECT s.status FROM substitutes s WHERE s.lesson_id = l.id) AS sub_status, " +
    "(instr(l.portal, '⏸') > 0 AND instr(l.portal, 'Zwischenstopp') > 0) AS has_stop, length(l.homework) > 0 AS has_homework, " +
    "(SELECT COUNT(*) FROM student_access a WHERE a.lesson_id = l.id) AS students, l.start_time, l.cancelled, l.parent_hash IS NOT NULL AS has_link, length(l.parent_summary) > 0 AS has_summary FROM lessons l";
  const args = [], where = [];
  if (subject === GS_SUBJECT) {   // Sitzungen eines Grundschulkurses
    await courseRef(c.db, subject, klass);
    args.push(klass); where.push("l.subject='gs' AND l.klass=?" + args.length);
  } else if (school === "gs" && !subject) where.push("l.subject='gs'");   // alle Sitzungen der Grundschule
  else {
    // ohne Fach: nur das Gymnasium (Startseite, „Zuletzt bearbeitet“) – die Grundschule hat ihren eigenen Bereich
    if (subject) { if (!isValidSubject(subject)) throw bad("Unbekanntes Fach."); args.push(subject); where.push("l.subject=?" + args.length); }
    else where.push("l.subject <> 'gs'");
    if (klass) { if (!isValidClass(klass)) throw bad("Unbekannte Klasse."); args.push(klass); where.push("l.klass=?" + args.length); }
  }
  q += " WHERE " + where.join(" AND ") + " ORDER BY COALESCE(l.lesson_date, '') DESC, l.created_at DESC LIMIT 2000";
  const r = await c.db.prepare(q).bind(...args).all();
  return json({ ok: true, lessons: (r.results || []).map((x) => ({ id: x.id, subject: x.subject, klass: x.klass, title: x.title, topic: x.topic, date: x.lesson_date, durationMin: x.duration_min,
    code: x.code, unitId: x.unit_id || null, substitute: x.sub_status || null, createdAt: x.created_at, updatedAt: x.updated_at, hasPortal: !!x.has_portal,
    hasStop: !!x.has_stop, hasHomework: !!x.has_homework, studentCount: x.students || 0,
    ...(x.subject === GS_SUBJECT ? { startTime: x.start_time || null, cancelled: !!x.cancelled, hasParentLink: !!x.has_link, hasSummary: !!x.has_summary } : {}) })) });
}

// Sitzungen entstehen aus einer Unterrichtseinheit („Erst wenn die Einheit geplant ist, kann die Stundenplanung beginnen“)
export async function routeLessonCreate(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 50000);
  if (!body.unitId) throw bad("Bitte zuerst die Unterrichtseinheit planen; Sitzungen entstehen aus ihren Zeilen.");
  const u = await getUnit(c.db, body.unitId);
  const rows = JSON.parse(u.rows || "[]"), row = rows.find((r) => r.uid === body.unitRow);
  if (!row) throw bad("Diese Zeile gibt es in der Einheit nicht (mehr).");
  const dup = await c.db.prepare("SELECT id FROM lessons WHERE unit_id=?1 AND unit_row=?2").bind(u.id, row.uid).first();
  if (dup) throw new HttpError(409, "exists", "Zu dieser Zeile gibt es schon eine Sitzung.");
  const l = await createLesson(c.db, { subject: u.subject, klass: u.klass, title: body.title || row.stundenfrage || u.title, topic: u.title, date: body.date || row.date,
    durationMin: body.durationMin ?? row.minutes, startTime: body.startTime ?? row.time ?? null, unitId: u.id, unitRow: row.uid }, c.now);
  return json({ ok: true, lesson: lessonOut(l) });
}

export async function routeLessonGet(c, id) {
  await requireTeacher(c);
  const l = await getLesson(c.db, id);
  const full = new URL(c.request.url).searchParams.get("full") === "1";   // Sicherung: ganzer Planungsverlauf und alle Entwürfe
  const [files, sheets, drafts, students] = await c.db.batch([
    c.db.prepare("SELECT " + FILE_COLS + " FROM files WHERE lesson_id=?1 ORDER BY created_at").bind(id),
    c.db.prepare("SELECT code, title, kind, created_at FROM fb_sheets WHERE lesson_id=?1 ORDER BY created_at").bind(id),
    c.db.prepare("SELECT * FROM fb_drafts WHERE lesson_id=?1 ORDER BY created_at DESC LIMIT ?2").bind(id, full ? 500 : 50),
    c.db.prepare("SELECT COUNT(*) AS n FROM student_access WHERE lesson_id=?1").bind(id),
  ]);
  const messages = await chatMessages(c.db, id, full ? 5000 : 200);
  const [prev, nextDate, course] = await Promise.all([previousLesson(c.db, l), nextLessonDate(c.db, l), courseInfo(c.db, l.subject, l.klass)]);
  const previousStop = prev && hasStop(prev.portal) ? { id: prev.id, title: prev.title, date: prev.lesson_date, portal: prev.portal } : null;
  // Grundschule: PDFs anderer Sitzungen des Kurses, auf die der Verlaufsplan (oder der der vorigen Sitzung) verweist, und die der vorigen Sitzung
  const gs = l.subject === GS_SUBJECT ? { refFiles: await gsRefFiles(c.db, l, prev), opensAt: parentOpensAt({ date: l.lesson_date, startTime: l.start_time, durationMin: l.duration_min }) } : {};
  let unit = null;
  if (l.unit_id) { try { unit = unitOut(await getUnit(c.db, l.unit_id)); } catch {} }
  const sub = await c.db.prepare("SELECT status, proposal, archive, created_at, updated_at, confirmed_at FROM substitutes WHERE lesson_id=?1").bind(id).first();
  let proposal = null, archive = null;
  if (sub) { try { proposal = JSON.parse(sub.proposal); } catch {} try { archive = sub.archive ? JSON.parse(sub.archive) : null; } catch {} }
  const substitute = sub ? { status: sub.status, proposal, createdAt: sub.created_at, updatedAt: sub.updated_at, confirmedAt: sub.confirmed_at ?? null,
    archive: archive ? { portal: archive.portal || "", homework: archive.homework || "", sheets: archive.sheets || [], files: (archive.files || []).map((f) => f.id), at: archive.at || null } : null } : null;
  return json({ ok: true, lesson: lessonOut(l, { studentCount: (students.results[0] || {}).n || 0, nextDate }), previousStop, unit, course, substitute, ...gs, messages: messages.map(msgOut),
    files: (files.results || []).map((f) => fileOut(f)), sheets: (sheets.results || []).map((s) => ({ code: s.code, title: s.title, kind: s.kind || "", createdAt: s.created_at })),
    drafts: (drafts.results || []).map(draftOut) });
}

/* PDF-Dateien des Kurses aus anderen Sitzungen (eine Abfrage): die der vorigen Sitzung und alle, auf die der Verlaufsplan dieser oder der
   vorigen Sitzung verweist – für die Namen im Verlaufsplan, „PDF-Verweis einfügen …“ und die Elternansicht */
export async function gsRefFiles(db, l, prev) {
  const ids = [...new Set([...planRefs(l.portal).all, ...(prev ? planRefs(prev.portal).all : [])])].slice(0, 200);
  const r = await db.prepare("SELECT f.id, f.lesson_id, f.name, f.area, f.kind, f.mime, f.status, f.source, f.pages, f.cards, f.card_pages, f.card_img_at, f.pdf_at, f.html_at, f.created_at, " +
    "(f.html IS NOT NULL) AS designed, l.lesson_date, l.start_time AS lesson_start, l.created_at AS lesson_created, l.title AS lesson_title FROM files f JOIN lessons l ON l.id = f.lesson_id " +
    "WHERE l.subject='gs' AND l.klass=?1 AND f.lesson_id<>?2 AND f.kind='file' AND f.mime='application/pdf' AND f.area NOT IN ('archive','presentation') " +
    "AND (f.lesson_id=?3 OR f.id IN (SELECT value FROM json_each(?4))) ORDER BY l.lesson_date, f.created_at LIMIT 300").bind(l.klass, l.id, prev ? prev.id : "", JSON.stringify(ids)).all();
  return (r.results || []).map((f) => ({ id: f.id, name: f.name, lessonId: f.lesson_id, lessonTitle: f.lesson_title || "", date: f.lesson_date || null, lessonStart: f.lesson_start || null, lessonCreatedAt: f.lesson_created ?? null, area: f.area, kind: f.kind, mime: f.mime,
    status: f.status, source: f.source || null, pages: f.pages ?? null, designed: !!f.designed, cards: f.cards, cardPages: f.card_pages ?? null, cardImgAt: f.card_img_at ?? null,
    pdfAt: f.pdf_at ?? null, htmlAt: f.html_at ?? null, createdAt: f.created_at, previous: !!prev && f.lesson_id === prev.id }));
}

/* Nachbarsitzungen derselben Klasse im selben Fach (nach Datum, bei gleichem Datum nach Anlegezeit) */
export function previousLesson(db, l) {
  if (!l.lesson_date) return null;
  return db.prepare("SELECT id, title, lesson_date, portal FROM lessons WHERE subject=?1 AND klass=?2 AND id<>?3 AND lesson_date IS NOT NULL AND cancelled=0 " +
    "AND (lesson_date < ?4 OR (lesson_date = ?4 AND created_at < ?5)) ORDER BY lesson_date DESC, created_at DESC LIMIT 1").bind(l.subject, l.klass, l.id, l.lesson_date, l.created_at).first();
}
// Fälligkeit der Hausaufgabe: Datum der nächsten Sitzung (ändert sich mit, wenn Sitzungen verschoben werden)
export async function nextLessonDate(db, l) {
  if (!l.lesson_date) return null;
  const r = await db.prepare("SELECT lesson_date FROM lessons WHERE subject=?1 AND klass=?2 AND id<>?3 AND lesson_date > ?4 AND cancelled=0 ORDER BY lesson_date LIMIT 1")
    .bind(l.subject, l.klass, l.id, l.lesson_date).first();
  return r ? r.lesson_date : null;
}

/* Ändern. Folgende Sitzungen werden nie mitverschoben (Entscheidung der Lehrkraft: bei Krankheit gibt es stattdessen die
   Vertretungsalternative); ein neues Datum bzw. eine neue Dauer steht auch in der Zeile der Unterrichtseinheit. */
export async function updateLesson(db, id, body, now) {
  const f = lessonFields(body, true), keys = Object.keys(f);
  if (!keys.length) return { lesson: await getLesson(db, id) };
  if (f.title !== undefined && !f.title) throw bad("Der Titel darf nicht leer sein.");
  const old = await getLesson(db, id);
  if ((f.parent_summary !== undefined || f.parent_note !== undefined) && old.subject !== GS_SUBJECT) throw bad("Nur bei Sitzungen der Grundschule.");
  // Ausfall-Eintrag (Krankmeldung, Grundschule): nur der Hinweis für die Eltern lässt sich ändern
  if (old.cancelled && keys.some((k) => k !== "parent_note")) throw bad("Bei einem Ausfall-Eintrag lässt sich nur der Hinweis der Lehrkraft für die Eltern ändern.");
  const sets = keys.map((k, i) => k + "=?" + (i + 2)).join(", ");
  await db.prepare("UPDATE lessons SET " + sets + ", updated_at=?" + (keys.length + 2) + " WHERE id=?1").bind(id, ...keys.map((k) => f[k]), now).run();
  if (old.unit_id && old.unit_row && ((f.lesson_date && f.lesson_date !== old.lesson_date) || (f.duration_min !== undefined && f.duration_min !== old.duration_min) ||
      (f.start_time !== undefined && f.start_time !== (old.start_time || null)))) {
    try {
      const u = await getUnit(db, old.unit_id);
      const rows = JSON.parse(u.rows || "[]").map((r) => (r.uid === old.unit_row ? { ...r, ...(f.lesson_date ? { date: f.lesson_date } : {}), ...(f.duration_min ? { minutes: f.duration_min } : {}),
        ...(f.start_time !== undefined ? { time: f.start_time } : {}) } : r));
      await db.prepare("UPDATE units SET rows=?2, version=version+1, updated_at=?3 WHERE id=?1").bind(u.id, JSON.stringify(rows), now).run();
    } catch {}
  }
  return { lesson: await getLesson(db, id) };
}
export async function routeLessonPatch(c, id) {
  await requireTeacher(c);
  await getLesson(c.db, id);
  const body = await readJson(c.request, 100000);
  const r = await updateLesson(c.db, id, body, c.now);
  return json({ ok: true, lesson: lessonOut(r.lesson, { nextDate: await nextLessonDate(c.db, r.lesson) }) });
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
    c.db.prepare("DELETE FROM substitutes WHERE lesson_id=?1").bind(id),
    c.db.prepare("DELETE FROM lessons WHERE id=?1").bind(id),
  ]);
  try { await c.env.LIVE.get(c.env.LIVE.idFromName(id)).fetch("https://live/reset", { method: "POST" }); } catch {}
  return json({ ok: true });
}

/* ---------- Sitzung aus einer Datei übernehmen (public/sessionfile.js) ----------
 * Der Browser hat die Datei gelesen und die Datumsangaben in den Texten schon an diese Sitzung angepasst. Hier: Titel, Thema, Ideen,
 * Hausaufgabe, Schulportal-Eintrag und Planungsverlauf ersetzen; Textmaterial, Links, Druckvorlagen (Text) und Feibeitsblatt-Entwürfe
 * kommen dazu. Datum, Beginn, Dauer, Klasse und Code dieser Sitzung bleiben. Dateien lädt der Browser danach einzeln hoch. */
export async function routeLessonImport(c, id) {
  await requireTeacher(c);
  const l = await getLesson(c.db, id);
  const body = await readJson(c.request, 4_000_000);
  const les = isObj(body.lesson) ? body.lesson : {}, f = {};
  if (cleanLine(les.title, LIMITS.title)) f.title = cleanLine(les.title, LIMITS.title);
  if (typeof les.topic === "string") f.topic = cleanLine(les.topic, LIMITS.topic);
  if (typeof les.ideas === "string") f.ideas = cleanText(les.ideas, LIMITS.ideas);
  if (typeof les.homework === "string") f.homework = cleanText(les.homework, LIMITS.homework).trim();
  const keys = Object.keys(f), stmts = [];
  if (keys.length) stmts.push(c.db.prepare("UPDATE lessons SET " + keys.map((k, i) => k + "=?" + (i + 2)).join(", ") + ", updated_at=?" + (keys.length + 2) + " WHERE id=?1").bind(id, ...keys.map((k) => f[k]), c.now));
  // Planungsverlauf ersetzen (Reihenfolge bleibt: json_each in der Reihenfolge der Liste)
  const chat = (Array.isArray(body.chat) ? body.chat : []).slice(-200).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ r: m.role, c: cleanText(m.content, LIMITS.answer), m: cleanLine(m.model, 200) || null, o: MODE_HINT[m.mode] !== undefined ? m.mode : null }));
  stmts.push(c.db.prepare("DELETE FROM chat WHERE lesson_id=?1").bind(id));
  if (chat.length) stmts.push(c.db.prepare("INSERT INTO chat(lesson_id, role, content, model, mode, created_at) SELECT ?1, json_extract(value,'$.r'), json_extract(value,'$.c'), json_extract(value,'$.m'), json_extract(value,'$.o'), ?2 FROM json_each(?3)")
    .bind(id, c.now, JSON.stringify(chat)));
  else stmts.push(c.db.prepare("INSERT INTO chat(lesson_id, role, content, model, created_at) VALUES(?1, 'assistant', ?2, 'begruessung', ?3)").bind(id, greetingText({ subject: l.subject, klass: l.klass, durationMin: l.duration_min }), c.now));
  const area = (a) => (a === "teacher" ? "teacher" : "student"), list = (x, n) => (Array.isArray(x) ? x : []).slice(0, n);
  const texts = list(body.texts, 60).map((t) => ({ a: area(t && t.area), n: cleanLine(t && t.title, 200) || "Material", t: cleanText(t && t.text, LIMITS.textMaterial).trim() })).filter((t) => t.t)
    .map((t) => ({ ...t, s: new TextEncoder().encode(t.t).length }));
  const links = list(body.links, 60).map((t) => ({ a: area(t && t.area), n: cleanLine(t && t.title, 200), u: cleanWebUrl(t && t.url) })).filter((t) => t.u).map((t) => ({ ...t, n: t.n || new URL(t.u).hostname }));
  const prints = list(body.prints, 60).map((t) => ({ n: cleanLine(t && t.title, 200) || "Druckvorlage", t: cleanText(t && t.text, LIMITS.textMaterial).trim(), k: cleanCopies(t && t.copies) || 1, d: t && t.duplex === false ? 0 : 1, co: t && t.color === true ? 1 : 0 }))
    .filter((t) => t.t).map((t) => ({ ...t, s: new TextEncoder().encode(t.t).length }));
  const drafts = [];
  for (const d of list(body.drafts, 20)) { try { drafts.push({ d: JSON.stringify(normalizeFbDraft(d)) }); } catch {} }
  const ins = "INSERT INTO files(id, lesson_id, area, kind, name, mime, size, text, status, source, print_copies, print_duplex, print_color, created_at, updated_at) ";
  if (texts.length) stmts.push(c.db.prepare(ins + "SELECT lower(hex(randomblob(8))), ?1, json_extract(value,'$.a'), 'text', json_extract(value,'$.n'), 'text/markdown', json_extract(value,'$.s'), json_extract(value,'$.t'), 'ready', 'uebernommen', NULL, NULL, NULL, ?2, ?2 FROM json_each(?3)")
    .bind(id, c.now, JSON.stringify(texts)));
  if (links.length) stmts.push(c.db.prepare(ins + "SELECT lower(hex(randomblob(8))), ?1, json_extract(value,'$.a'), 'link', json_extract(value,'$.n'), 'text/uri-list', 0, json_extract(value,'$.u'), 'ready', 'uebernommen', NULL, NULL, NULL, ?2, ?2 FROM json_each(?3)")
    .bind(id, c.now, JSON.stringify(links)));
  if (prints.length) stmts.push(c.db.prepare(ins + "SELECT lower(hex(randomblob(8))), ?1, 'print', 'text', json_extract(value,'$.n'), 'text/markdown', json_extract(value,'$.s'), json_extract(value,'$.t'), 'ready', 'uebernommen', json_extract(value,'$.k'), json_extract(value,'$.d'), json_extract(value,'$.co'), ?2, ?2 FROM json_each(?3)")
    .bind(id, c.now, JSON.stringify(prints)));
  if (drafts.length) stmts.push(c.db.prepare("INSERT INTO fb_drafts(id, lesson_id, data, source, status, created_at, updated_at) SELECT lower(hex(randomblob(8))), ?1, json_extract(value,'$.d'), 'uebernommen', 'draft', ?2, ?2 FROM json_each(?3)")
    .bind(id, c.now, JSON.stringify(drafts)));
  await c.db.batch(stmts);
  if (typeof les.portal === "string") await savePortal(c.db, id, les.portal, null, "lehrkraft", c.now);
  return json({ ok: true, lesson: lessonOut(await getLesson(c.db, id)), counts: { chat: chat.length, texts: texts.length, links: links.length, prints: prints.length, drafts: drafts.length } });
}

/* ---------- Schulportal-Eintrag ---------- */
// Speichern mit Versionsprüfung: wurde der Eintrag inzwischen anderswo geändert (z. B. von Claude über den Connector), meldet
// der Server 409 – nie stillschweigend überschreiben.
export async function savePortal(db, id, text, baseVersion, source, now) {
  const t = cleanText(text, LIMITS.portal);
  const q = baseVersion == null
    ? db.prepare("UPDATE lessons SET portal=?2, portal_version=portal_version+1, portal_updated_at=?3, portal_source=?4, updated_at=?3 WHERE id=?1 AND cancelled=0 RETURNING portal_version").bind(id, t, now, source)
    : db.prepare("UPDATE lessons SET portal=?2, portal_version=portal_version+1, portal_updated_at=?3, portal_source=?4, updated_at=?3 WHERE id=?1 AND portal_version=?5 AND cancelled=0 RETURNING portal_version").bind(id, t, now, source, Number(baseVersion));
  const r = await q.first();
  if (!r) {
    const cur = await db.prepare("SELECT portal, portal_version, portal_updated_at, portal_source, cancelled FROM lessons WHERE id=?1").bind(id).first();
    if (!cur) throw new HttpError(404, "not_found", "Diese Sitzung gibt es nicht (mehr).");
    if (cur.cancelled) throw bad("Ein Ausfall-Eintrag hat keinen Verlaufsplan.");
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
  if (l.subject === GS_SUBJECT) throw bad("In der Grundschule gibt es keinen Schulportal-Eintrag.");
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
  material: "\n\nModus der aktuellen Anfrage: Unterrichtsmaterial erstellen. Formuliere das gewünschte Material vollständig und druckfertig aus – Material für Schüler:innen duzt sie (du bzw. ihr). " +
    "Markdown: eine Überschrift mit # (der Titel), Abschnitte mit ##, Arbeitsaufträge als nummerierte Liste mit Operator in **fett** und Anforderungsbereich (AFB I–III), ggf. Texte mit Quellenangabe, Tabellen. " +
    "Platz für Antworten als eigene Zeile [[Linien: n]] (n = Zahl der Schreiblinien, z. B. [[Linien: 6]]); Ankreuzkästchen als „[ ]“ am Zeilenanfang. Links mit voller Adresse. " +
    "Gib nur das Material aus, ohne Vorrede, damit es direkt als Datei übernommen werden kann.",
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
  const d = normalizeFbDraft(data, { fromAi: true }), id = randomId(8);   // Entwürfe von KI, Connector und Vertretung
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
  const code = normalizeCode(raw);
  // erst die Verknüpfung, dann sein Notfall-Feibeitsblatt (ein gleichzeitiges Hochladen sieht so die fehlende Verknüpfung, siehe routeNotfallUpload)
  await c.db.prepare("DELETE FROM fb_sheets WHERE lesson_id=?1 AND code=?2").bind(id, code).run();
  const removedFiles = await deleteNotfallFiles(c, id, code);
  return json({ ok: true, removedFiles });
}
export { isObj };
