// units.js – Unterrichtseinheiten: Rahmendaten (Stundenplan, Zeitraum, Klausur, Ferien) → Termine, Plan (Leupold-Schema) und Ablauf
// (Zeilen: Stundenfrage, grober Ablauf, Lernschritt, Datum). Die Planung macht Claude in claude.ai über den Connector; die Lehrkraft prüft
// und bearbeitet hier. Erst eine festgelegte Einheit erzeugt die Sitzungen (je Zeile eine Sitzung mit Datum).
import { HttpError, bad, json, readJson, randomId, generateCode, cleanLine, isId, isObj } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { createLessonsBulk, lessonOut } from "./lessons.js";
import { loadSubjectConfigs } from "./bases.js";
import { courseInfo, getCourseSettings, courseRef } from "./courses.js";
import { gsCourseOut } from "./gs.js";
import { isValidSubject, isValidClass, classAllowed, subjectName, classShort, GS_SUBJECT, greetingText, fmtDay } from "../public/shared.js";
import { normalizeParams, computeSlots, normalizePlan, normalizeRows, assignDates, lessonSlots, repackFuture, slotsAfterEnd, occupy } from "../public/planning.js";

const newUid = () => randomId(4);
const parseJ = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };
/* units.revise (Grundschule, Krankmeldung): {v, open, items: [{id, date, time, minutes, lessonId, placeholderId, title, at, lengths}], undated: [uid],
   undo: {id, version, rows, lessons, lessonId, placeholderId, slot (Termin laut Stundenplan wie in params.cancelled), prevOpen} | null}.
   Nach außen nie der Schnappschuss – nur, ob er noch gilt. */
export const reviseData = (raw) => {
  const r = parseJ(raw, null);
  if (!r || typeof r !== "object") return null;
  return { v: 1, open: !!r.open, items: Array.isArray(r.items) ? r.items.slice(-30) : [], undated: Array.isArray(r.undated) ? r.undated.filter((x) => typeof x === "string") : [],
    undo: r.undo && typeof r.undo === "object" ? r.undo : null };
};
export const reviseOut = (u) => {
  const r = reviseData(u.revise);
  if (!r) return null;
  return { open: r.open, items: r.items.map((x) => ({ id: x.id, date: x.date || null, time: x.time || null, minutes: x.minutes ?? null, lessonId: x.lessonId || null, placeholderId: x.placeholderId || null,
    title: x.title || "", at: x.at ?? null, lengths: Array.isArray(x.lengths) ? x.lengths : [] })), undated: r.undated, undoId: r.undo ? r.undo.id : null, canUndo: !!r.undo && r.undo.version === u.version };
};
export const unitOut = (u, extra = {}) => ({
  id: u.id, subject: u.subject, klass: u.klass, title: u.title, status: u.status, params: parseJ(u.params, {}), plan: parseJ(u.plan, {}), rows: parseJ(u.rows, []),
  version: u.version, source: u.source || null, createdAt: u.created_at, updatedAt: u.updated_at, ...(u.revise != null && reviseOut(u) ? { revise: reviseOut(u) } : {}), ...extra,
});
export async function getUnit(db, id) {
  if (!isId(id)) throw new HttpError(404, "not_found", "Diese Unterrichtseinheit gibt es nicht (mehr).");
  const u = await db.prepare("SELECT * FROM units WHERE id=?1").bind(id).first();
  if (!u) throw new HttpError(404, "not_found", "Diese Unterrichtseinheit gibt es nicht (mehr).");
  return u;
}
/* Sitzungen der Einheit. gs: zusätzlich Dauer, Ausfall-Eintrag und was schon geplant ist (Verlaufsplan, PDFs, Bildkarten) und ob die Sitzung
   überhaupt Inhalte hat (hasContent = nicht leer im Sinne von EMPTY_LESSON: dann darf ihre Stunde beim Überarbeiten nicht wegfallen – Abschlussprüfung F21)
   – nur in der Grundschule, damit die Ausgabe am Gymnasium gleich bleibt */
export async function linkedLessons(db, unitId, gs = false) {
  const r = await db.prepare("SELECT id, title, lesson_date, start_time, unit_row, code" + (gs ? ", duration_min, cancelled, length(portal) > 0 AS has_plan, " +
    "(SELECT COUNT(*) FROM files f WHERE f.lesson_id=lessons.id AND f.kind='file' AND f.mime='application/pdf' AND f.area NOT IN ('archive','presentation') AND f.cards IS NULL) AS pdfs, " +
    "(SELECT COUNT(*) FROM files f WHERE f.lesson_id=lessons.id AND f.cards IS NOT NULL) AS cardsets, COALESCE(" + EMPTY_LESSON + ", 0) = 0 AS has_content" : "") + " FROM lessons WHERE unit_id=?1").bind(unitId).all();
  return (r.results || []).map((l) => ({ id: l.id, title: l.title, date: l.lesson_date, time: l.start_time || null, row: l.unit_row, code: l.code,
    ...(gs ? { minutes: l.duration_min ?? null, cancelled: !!l.cancelled, hasPlan: !!l.has_plan, pdfs: l.pdfs || 0, cards: l.cardsets || 0, hasContent: !!l.has_content } : {}) }));
}
export async function unitFull(db, u) {
  const lessons = await linkedLessons(db, u.id, u.subject === GS_SUBJECT);
  const params = parseJ(u.params, {});
  return unitOut(u, { slots: computeSlots(params), lessons, course: await courseInfo(db, u.subject, u.klass) });
}

/* Speichern mit Versionsprüfung (Claude über den Connector und die Lehrkraft im Browser schreiben dieselbe Einheit). before: Anweisungen, die im
   selben Batch davor laufen (sie prüfen die Version selbst – z. B. die Termine der Sitzungen in der Grundschule) */
export async function saveUnit(db, id, fields, baseVersion, source, now, before = []) {
  const sets = [], args = [];
  for (const [k, v] of Object.entries(fields)) { args.push(v); sets.push(k + "=?" + (args.length + 1)); }
  args.push(now); sets.push("updated_at=?" + (args.length + 1));
  args.push(source); sets.push("source=?" + (args.length + 1));
  const cond = baseVersion == null ? "" : " AND version=?" + (args.length + 2);
  const st = db.prepare("UPDATE units SET " + sets.join(", ") + ", version=version+1 WHERE id=?1" + cond + " RETURNING version")
    .bind(id, ...args, ...(baseVersion == null ? [] : [Number(baseVersion)]));
  const r = before.length ? ((await db.batch([...before, st])).pop().results || [])[0] : await st.first();
  if (!r) {
    const cur = await db.prepare("SELECT version FROM units WHERE id=?1").bind(id).first();
    if (!cur) throw new HttpError(404, "not_found", "Diese Unterrichtseinheit gibt es nicht (mehr).");
    throw new HttpError(409, "unit_conflict", "Die Einheit wurde inzwischen an anderer Stelle geändert. Bitte neu laden.", { version: cur.version });
  }
  return r.version;
}
/* Plan (z. B. von Claude) übernehmen: Zeilen bekommen der Reihe nach die Termine der Einheit. Mit uid (aus get_unit) bleiben Stunden samt
   Sitzung erhalten (Überarbeitung nach Ausfällen); ohne uid wie bisher nach Position. → {version, uid, moves, undated, deleted}
   Grundschule: get_unit nennt die uid jeder Stunde – jede uid-Angabe wählt den Weg über die uid; hat die Einheit schon Sitzungen, lehnt die
   Plattform einen Plan ganz ohne uid ab (nach Position kämen Sitzungen samt Verlaufsplan an fremde Stunden; Abschlussprüfung F17).
   Gymnasium (get_unit ohne uid): nur die echte uid einer gespeicherten Zeile wählt diesen Weg; eine leere oder erfundene uid bleibt beim Weg nach
   Position wie vor der Grundschul-Erweiterung – dort wird nie eine Sitzung gelöscht (Abschlussprüfung F08). */
export async function applyPlan(db, u, planRaw, rowsRaw, baseVersion, source, now) {
  const gs = u.subject === GS_SUBJECT, list = Array.isArray(rowsRaw) ? rowsRaw : [];
  const known = new Set(parseJ(u.rows, []).map((r) => r && r.uid));
  const byUid = gs ? list.some((r) => r && typeof r.uid === "string") : list.some((r) => r && typeof r.uid === "string" && /^[a-f0-9]{8}$/.test(r.uid) && known.has(r.uid));
  if (byUid) return applyPlanByUid(db, u, planRaw, rowsRaw, baseVersion, source, now);
  if (gs && (await db.prepare("SELECT 1 AS x FROM lessons WHERE unit_id=?1 AND cancelled=0 LIMIT 1").bind(u.id).first()))
    throw new HttpError(409, "uid_required", "Diese Einheit hat schon Sitzungen: Gib bei jeder Stunde, die bleibt, ihre uid aus get_unit an (Stunden ohne uid sind dann neu). " +
      "Ohne uid kämen Sitzungen samt Verlaufsplan und Material an andere Stunden – der Plan wurde nicht gespeichert.");
  return { version: await applyPlanByPosition(db, u, planRaw, rowsRaw, baseVersion, source, now), uid: false };
}
async function applyPlanByPosition(db, u, planRaw, rowsRaw, baseVersion, source, now) {
  const plan = normalizePlan(planRaw), oldRows = parseJ(u.rows, []);
  let rows = normalizeRows(rowsRaw, newUid);
  // bestehende Zeilen mit Sitzung behalten ihre Kennung (gleiche Position), damit die Verknüpfung erhalten bleibt
  rows = rows.map((r, i) => (oldRows[i] && !rowsRaw[i]?.uid ? { ...r, uid: oldRows[i].uid, date: r.date || oldRows[i].date, minutes: r.minutes || oldRows[i].minutes, time: r.time || oldRows[i].time || null } : r));
  rows = assignDates(rows, computeSlots(parseJ(u.params, {})));
  const fields = { plan: JSON.stringify(plan), rows: JSON.stringify(rows) };
  if (plan.titel && !u.title) fields.title = plan.titel;
  return saveUnit(db, u.id, fields, baseVersion, source, now);
}

/* leere Sitzung (darf beim Überarbeiten mit ihrer Zeile wegfallen): nichts geplant, kein Material, kein Chat außer der Begrüßung, kein Elternlink */
const EMPTY_LESSON = "(lessons.portal='' AND lessons.parent_summary='' AND lessons.parent_note='' AND lessons.homework='' AND lessons.ideas='' AND lessons.parent_hash IS NULL AND lessons.cancelled=0 " +
  "AND NOT EXISTS(SELECT 1 FROM files f WHERE f.lesson_id=lessons.id) AND NOT EXISTS(SELECT 1 FROM chat ch WHERE ch.lesson_id=lessons.id AND COALESCE(ch.model,'')<>'begruessung') " +
  "AND NOT EXISTS(SELECT 1 FROM fb_sheets x WHERE x.lesson_id=lessons.id) AND NOT EXISTS(SELECT 1 FROM fb_drafts x WHERE x.lesson_id=lessons.id) AND NOT EXISTS(SELECT 1 FROM substitutes x WHERE x.lesson_id=lessons.id))";
async function applyPlanByUid(db, u, planRaw, rowsRaw, baseVersion, source, now) {
  const gs = u.subject === GS_SUBJECT, plan = normalizePlan(planRaw), oldRows = parseJ(u.rows, []);
  const ver = baseVersion == null ? u.version : Number(baseVersion);
  if (ver !== u.version) throw new HttpError(409, "unit_conflict", "Die Einheit wurde inzwischen an anderer Stelle geändert. Bitte neu laden.", { version: u.version });
  const oldBy = new Map(oldRows.map((r) => [r.uid, r])), seen = new Set();
  // bekannte uid: Termin und Länge aus der gespeicherten Zeile; unbekannte bzw. doppelte uid: neue Stunde
  let rows = normalizeRows(rowsRaw, newUid).map((r) => {
    const o = oldBy.get(r.uid);
    if (!o || seen.has(r.uid)) return { ...r, uid: newUid(), date: null, time: null };
    seen.add(r.uid);
    return { ...r, date: o.date || null, time: o.time || null, minutes: o.minutes ?? r.minutes };
  });
  const lessons = await linkedLessons(db, u.id, true);
  const dropped = new Set(oldRows.filter((r) => !seen.has(r.uid)).map((r) => r.uid));
  const dropLessons = lessons.filter((l) => !l.cancelled && l.row && dropped.has(l.row));
  if (dropLessons.length) {
    const r = await db.prepare("SELECT id, " + EMPTY_LESSON + " AS empty FROM lessons WHERE id IN (SELECT value FROM json_each(?1))").bind(JSON.stringify(dropLessons.map((l) => l.id))).all();
    const full = new Set((r.results || []).filter((x) => !x.empty).map((x) => x.id));
    const keep = dropLessons.filter((l) => full.has(l.id));
    if (keep.length) throw new HttpError(409, "rows_with_lessons", "Diese Stunden haben schon geplante Sitzungen und müssen mit ihrer uid erhalten bleiben (Inhalt darfst du ändern): " +
      keep.map((l) => "„" + (oldBy.get(l.row) || {}).stundenfrage + "“ (uid " + l.row + ", Sitzung " + l.id + ")").join(", "), { uids: keep.map((l) => l.row) });
  }
  const before = new Map(rows.map((r) => [r.uid, r]));
  rows = gs ? repackFuture({ params: parseJ(u.params, {}), rows, lessons, now }) : assignDates(rows, computeSlots(parseJ(u.params, {})));
  const byRow = new Map(lessons.filter((l) => l.row && !l.cancelled).map((l) => [l.row, l]));
  const moves = [];
  rows.forEach((r, i) => {
    const l = byRow.get(r.uid), b = before.get(r.uid);
    if (l && b && (b.date !== r.date || (b.time || null) !== (r.time || null) || (b.minutes ?? null) !== (r.minutes ?? null))) moves.push({ n: i + 1, uid: r.uid, title: r.stundenfrage, lessonId: l.id, from: b.date || null, to: r.date || null, time: r.time || null });
  });
  const undated = rows.map((r, i) => ({ n: i + 1, uid: r.uid, title: r.stundenfrage, date: r.date })).filter((r) => !r.date);
  const fields = { plan: JSON.stringify(plan), rows: JSON.stringify(rows) };
  if (plan.titel && !u.title) fields.title = plan.titel;
  const rev = reviseData(u.revise);
  if (gs && rev) fields.revise = JSON.stringify({ ...rev, open: false, undated: undated.map((r) => r.uid), undo: null });
  // ein Batch: leere Sitzungen weggefallener Stunden löschen, Termine der Sitzungen mitführen (Grundschule), Einheit mit Versionsprüfung zuletzt
  const G = "EXISTS(SELECT 1 FROM units WHERE id=?3 AND version=?4)", GD = "EXISTS(SELECT 1 FROM units WHERE id=?2 AND version=?3)", dropIds = JSON.stringify(dropLessons.map((l) => l.id));
  const stmts = [];
  if (dropLessons.length) {
    stmts.push(db.prepare("DELETE FROM chat WHERE lesson_id IN (SELECT id FROM lessons WHERE id IN (SELECT value FROM json_each(?1)) AND " + EMPTY_LESSON + ") AND " + GD).bind(dropIds, u.id, ver));
    stmts.push(db.prepare("DELETE FROM student_access WHERE lesson_id IN (SELECT id FROM lessons WHERE id IN (SELECT value FROM json_each(?1)) AND " + EMPTY_LESSON + ") AND " + GD).bind(dropIds, u.id, ver));
    stmts.push(db.prepare("DELETE FROM lessons WHERE id IN (SELECT value FROM json_each(?1)) AND " + EMPTY_LESSON + " AND " + GD).bind(dropIds, u.id, ver));
  }
  if (gs) stmts.push(mirrorStmt(db, rows, lessons, now, G, u.id, ver));
  const sets = Object.keys(fields).map((k, i) => k + "=?" + (i + 4));
  stmts.push(db.prepare("UPDATE units SET " + sets.join(", ") + ", updated_at=?2, source=?3, version=version+1 WHERE id=?1 AND version=?" + (Object.keys(fields).length + 4) + " RETURNING version")
    .bind(u.id, now, source, ...Object.values(fields), ver));
  const res = await db.batch(stmts);
  const last = (res[res.length - 1].results || [])[0];
  if (!last) {
    const cur = await db.prepare("SELECT version FROM units WHERE id=?1").bind(u.id).first();
    throw new HttpError(409, "unit_conflict", "Die Einheit wurde inzwischen an anderer Stelle geändert. Bitte neu laden.", { version: cur ? cur.version : null });
  }
  return { version: last.version, uid: true, moves, undated, deleted: dropLessons.length, reviseClosed: !!(gs && rev && rev.open) };
}
/* Grundschule: Datum, Beginn und Dauer der Sitzungen aus den Zeilen übernehmen – eine Anweisung (auch „ohne Termin“), nie für Ausfall-Einträge.
   guard = optionale SQL-Bedingung mit ?3 (Einheit) und ?4 (Version) */
export function mirrorStmt(db, rows, lessons, now, guard = null, unitId = null, ver = null) {
  const byRow = new Map(rows.map((r) => [r.uid, r]));
  const list = lessons.filter((l) => !l.cancelled && l.row && byRow.has(l.row)).map((l) => { const r = byRow.get(l.row); return { id: l.id, d: r.date || null, t: r.time || null, m: r.minutes ?? null }; });
  const pick = (k) => "(SELECT json_extract(value,'$." + k + "') FROM json_each(?1) WHERE json_extract(value,'$.id')=lessons.id)";
  const st = db.prepare("UPDATE lessons SET lesson_date=" + pick("d") + ", start_time=" + pick("t") + ", duration_min=COALESCE(" + pick("m") + ", duration_min), updated_at=?2 " +
    "WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?1)) AND cancelled=0" + (guard ? " AND " + guard : ""));
  return guard ? st.bind(JSON.stringify(list), now, unitId, ver) : st.bind(JSON.stringify(list), now);
}

export async function routeUnitsList(c) {
  await requireTeacher(c);
  const u = new URL(c.request.url), subject = u.searchParams.get("subject"), klass = u.searchParams.get("klass");
  if (subject === GS_SUBJECT) await courseRef(c.db, subject, klass);   // Grundschule: der Kurs muss existieren
  else if (!isValidSubject(subject) || !isValidClass(klass)) throw bad("Fach oder Klasse ungültig.");
  const r = await c.db.prepare("SELECT u.*, (SELECT COUNT(*) FROM lessons l WHERE l.unit_id=u.id) AS n FROM units u WHERE subject=?1 AND klass=?2 ORDER BY created_at DESC").bind(subject, klass).all();
  return json({ ok: true, units: (r.results || []).map((x) => { const o = unitOut(x, { lessonCount: x.n || 0 }); return { ...o, slotCount: lessonSlots(computeSlots(o.params)).length }; }) });
}
/* Wochenkalender der Startseite (beider Schulformen): alle Einheiten mit Stundenplan und Zeitraum (nur Rahmendaten – nie Plan, Ablauf oder
   Notizen), am Gymnasium nur Klassen, die laut Fach-Einstellungen unterrichtet werden, in der Grundschule nur vorhandene Kurse (mit ihrem
   Namen in course). Die Wochen rechnet der Browser (weekSchedule in public/planning.js). */
/* Einheit (Zeile aus units) für den Wochenkalender und die Druckaufträge (printjobs.js): nur Klassen, die laut Fach-Einstellungen unterrichtet
   werden, bzw. bestehende Grundschulkurse (gs = Map Kennung → gsCourseOut), mit Zeitraum und Stundenplan – sonst null */
export function scheduleUnit(x, gs, cfgs) {
  const course = x.subject === GS_SUBJECT ? gs.get(x.klass) : null;
  if (course === undefined) return null;
  if (!course && (!isValidSubject(x.subject) || !classAllowed(cfgs[x.subject], x.klass))) return null;
  const p = normalizeParams(parseJ(x.params, {}));
  if (!p.start || !p.end || p.end < p.start || !p.weekdays.length) return null;
  return { id: x.id, subject: x.subject, klass: x.klass, title: x.title, params: { start: p.start, end: p.end, exam: p.exam, weekdays: p.weekdays, breaks: p.breaks, ...(p.cancelled ? { cancelled: p.cancelled } : {}) },
    ...(course ? { course: { id: course.id, short: course.short, label: course.label } } : {}) };
}
export async function routeSchedule(c) {
  await requireTeacher(c);
  const cfgs = await loadSubjectConfigs(c.db);
  const [r, g] = await c.db.batch([
    c.db.prepare("SELECT id, subject, klass, title, params FROM units ORDER BY created_at DESC LIMIT 2000"),   // die neuesten zuerst
    c.db.prepare("SELECT * FROM gs_courses"),
  ]);
  const gs = new Map((g.results || []).map((x) => [x.id, gsCourseOut(x)]));
  const units = [];
  for (const x of r.results || []) { const u = scheduleUnit(x, gs, cfgs); if (u) units.push(u); }
  return json({ ok: true, units });
}
export async function routeUnitCreate(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 50000);
  const gs = body.subject === GS_SUBJECT;
  if (gs) await courseRef(c.db, body.subject, body.klass);   // Grundschulkurs muss existieren
  else {
    if (!isValidSubject(body.subject)) throw bad("Bitte eines der drei Fächer wählen.");
    const cfg = (await loadSubjectConfigs(c.db))[body.subject];
    if (!classAllowed(cfg, body.klass)) throw bad(subjectName(body.subject) + " wird in " + classShort(body.klass) + " laut Fach-Einstellungen nicht unterrichtet.");
  }
  const id = randomId(8), params = normalizeParams(body.params);
  if (gs) params.exam = null;   // in der Grundschule gibt es keine Klausuren
  // ohne eigenen Stundenplan übernimmt die neue Einheit den aus den Kurseinstellungen (in der Einheit änderbar)
  if (!params.weekdays.length) { const cs = await getCourseSettings(c.db, body.subject, body.klass); if (cs && cs.weekdays.length) params.weekdays = cs.weekdays; }
  await c.db.prepare("INSERT INTO units(id, subject, klass, title, params, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?6)")
    .bind(id, body.subject, body.klass, cleanLine(body.title, 200), JSON.stringify(params), c.now).run();
  return json({ ok: true, unit: await unitFull(c.db, await getUnit(c.db, id)) });
}
export async function routeUnitGet(c, id) {
  await requireTeacher(c);
  return json({ ok: true, unit: await unitFull(c.db, await getUnit(c.db, id)) });
}
export async function routeUnitPatch(c, id) {
  await requireTeacher(c);
  const u = await getUnit(c.db, id);
  const body = await readJson(c.request, 400000);
  const fields = {}, gs = u.subject === GS_SUBJECT;
  let params = null;
  if (body.title !== undefined) fields.title = cleanLine(body.title, 200);
  if (body.params !== undefined) {
    params = gs ? { ...normalizeParams(body.params), exam: null } : normalizeParams(body.params);
    // ausgefallene Termine (Krankmeldung) verwaltet nur die Plattform: fehlen sie im Rumpf, bleiben die gespeicherten
    const old = normalizeParams(parseJ(u.params, {}));
    if (!(body.params && typeof body.params === "object" && "cancelled" in body.params) && old.cancelled) params.cancelled = old.cancelled;
    fields.params = JSON.stringify(params);
  }
  if (body.plan !== undefined) fields.plan = JSON.stringify(normalizePlan(body.plan));
  let ver = Number.isInteger(body.baseVersion) ? body.baseVersion : null;
  // Grundschule: „Erledigt – Hinweis entfernen“ (roter Kasten nach Ausfällen). reviseSeen = Kennungen der Ausfälle, die der Kasten zeigte: ist
  // inzwischen eine weitere Krankmeldung dazugekommen, bleibt der Hinweis (samt ihrem „rückgängig“); geprüft an der gelesenen Version (F07)
  if (body.reviseDone === true && u.revise != null) {
    const r = reviseData(u.revise);
    if (r && Array.isArray(body.reviseSeen)) {
      const seen = new Set(body.reviseSeen.filter((x) => typeof x === "string"));
      if (r.items.some((x) => !seen.has(x.id))) throw new HttpError(409, "revise_changed", "Inzwischen ist eine weitere Krankmeldung dazugekommen – der Hinweis bleibt. Bitte neu laden.", { version: u.version });
      if (ver == null) ver = u.version;
    }
    if (r) fields.revise = JSON.stringify({ ...r, open: false, undo: null });
  }
  const before = [];
  if (body.rows !== undefined) {
    let rows = normalizeRows(body.rows, newUid);
    if (body.assignDates) rows = assignDates(rows.map((r) => ({ ...r, date: null, time: null })), computeSlots(params || parseJ(u.params, {})));
    fields.rows = JSON.stringify(rows);
    // Datum/Dauer verknüpfter Sitzungen mitführen. Grundschule: eine Anweisung (auch „ohne Termin“ und die Dauer) im selben Batch wie die Einheit
    // und an deren Version gebunden – eine veraltete Seite schreibt nie alte Termine in die Sitzungen (Abschlussprüfung F03)
    const lessons = await linkedLessons(c.db, id, gs);
    if (gs) before.push(ver == null ? mirrorStmt(c.db, rows, lessons, c.now) : mirrorStmt(c.db, rows, lessons, c.now, "EXISTS(SELECT 1 FROM units WHERE id=?3 AND version=?4)", id, ver));
    else {
      const stmts = [];
      for (const l of lessons) {
        const r = rows.find((x) => x.uid === l.row);
        if (r && r.date && r.date !== l.date) stmts.push(c.db.prepare("UPDATE lessons SET lesson_date=?2, updated_at=?3 WHERE id=?1").bind(l.id, r.date, c.now));
        if (r && r.time && r.time !== l.time) stmts.push(c.db.prepare("UPDATE lessons SET start_time=?2, updated_at=?3 WHERE id=?1").bind(l.id, r.time, c.now));
      }
      if (stmts.length) await c.db.batch(stmts.slice(0, 40));
    }
  }
  if (!Object.keys(fields).length) return json({ ok: true, unit: await unitFull(c.db, u) });
  await saveUnit(c.db, id, fields, ver, "lehrkraft", c.now, before);
  return json({ ok: true, unit: await unitFull(c.db, await getUnit(c.db, id)) });
}
export async function routeUnitDelete(c, id) {
  await requireTeacher(c);
  const u = await getUnit(c.db, id);
  const n = await c.db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE unit_id=?1 AND cancelled=0").bind(id).first();
  if ((n || {}).n) throw new HttpError(409, "has_lessons", "Zu dieser Einheit gibt es schon Sitzungen. Bitte zuerst die Sitzungen löschen.");
  // Ausfall-Einträge (Grundschule) gehen mit der Einheit – samt einem etwaigen Planungsverlauf (F22)
  await c.db.batch([...(u.subject === GS_SUBJECT ? [c.db.prepare("DELETE FROM chat WHERE lesson_id IN (SELECT id FROM lessons WHERE unit_id=?1 AND cancelled=1)").bind(id)] : []),
    c.db.prepare("DELETE FROM lessons WHERE unit_id=?1 AND cancelled=1").bind(id), c.db.prepare("DELETE FROM units WHERE id=?1").bind(id)]);
  return json({ ok: true });
}
/* Einheit festlegen: je Zeile ohne Sitzung eine Sitzung mit Datum, Dauer, Stundenfrage als Titel */
export async function routeUnitSessions(c, id) {
  await requireTeacher(c);
  const u = await getUnit(c.db, id), rows = parseJ(u.rows, []), plan = parseJ(u.plan, {});
  if (!rows.length) throw bad("Die Einheit hat noch keinen Ablauf. Bitte zuerst den Plan erstellen (mit Claude oder von Hand).");
  if (!plan.lernaufgabe) throw bad("Bitte zuerst eine zentrale Lernaufgabe festlegen – sie ist das Ziel der Einheit.");
  const have = new Set((await linkedLessons(c.db, id)).map((l) => l.row));
  const missingDate = rows.filter((r) => !have.has(r.uid) && !r.date);
  // Grundschule: Stunden ohne Termin (z. B. nach einer Krankmeldung) bekommen noch keine Sitzung
  const skipped = u.subject === GS_SUBJECT ? missingDate.length : 0;
  if (missingDate.length && !skipped) throw bad(missingDate.length + " Zeile(n) haben noch kein Datum. Bitte Termine berechnen oder Datum eintragen.");
  const todo = rows.filter((r) => !have.has(r.uid) && r.date).slice(0, 150);
  const created = await createLessonsBulk(c.db, { subject: u.subject, klass: u.klass, topic: u.title || plan.titel || "", unitId: u.id },
    todo.map((r) => ({ title: r.stundenfrage || plan.titel || u.title, date: r.date, durationMin: r.minutes, startTime: r.time || null, unitRow: r.uid })), c.now);
  if (u.status !== "geplant") await c.db.prepare("UPDATE units SET status='geplant', updated_at=?2 WHERE id=?1").bind(id, c.now).run();
  return json({ ok: true, created, ...(skipped ? { skipped } : {}), unit: await unitFull(c.db, await getUnit(c.db, id)) });
}
/* Zeile einer Stunde ändern (Abweichung im Stunden-Chat übernommen; auch per Connector) */
function rowChange(row, change) {
  const next = { ...row };
  if (typeof change.stundenfrage === "string" && change.stundenfrage.trim()) next.stundenfrage = change.stundenfrage.trim().slice(0, 400);
  if (Array.isArray(change.ablauf) && change.ablauf.length) next.ablauf = change.ablauf.map((x) => String(x).trim().slice(0, 400)).filter(Boolean).slice(0, 15);
  return next;
}
export async function updateRow(db, unitId, rowUid, change, source, now) {
  const u = await getUnit(db, unitId), rows = parseJ(u.rows, []);
  const i = rows.findIndex((r) => r.uid === rowUid);
  if (i < 0) throw new HttpError(404, "not_found", "Diese Stunde steht nicht (mehr) in der Einheit.");
  const next = rowChange(rows[i], change);
  rows[i] = next;
  await saveUnit(db, unitId, { rows: JSON.stringify(rows) }, null, source, now);
  return next;
}
/* Mehrere Stunden in EINER versionsgeprüften Speicherung (Inhalte rücken nach einem Zwischenstopp nach; update_unit_row mit stunden). changes =
   [{uid | nr (Nummer der Stunde, 1-basiert), stundenfrage?, ablauf?}] (1–30). Ohne baseVersion gilt die gerade gelesene Version; wer Nummern nennt,
   muss die Version angeben, zu der sie gehören. → {version, rows: [{n, uid, stundenfrage, ablauf, date}]} */
export const ROWS_MAX = 30;
export async function updateRows(db, unitId, changes, baseVersion, source, now) {
  const u = await getUnit(db, unitId), rows = parseJ(u.rows, []), list = Array.isArray(changes) ? changes : [];
  if (!list.length || list.length > ROWS_MAX) throw bad("Bitte 1 bis " + ROWS_MAX + " Stunden angeben.");
  if (baseVersion == null && list.some((c) => c && c.uid === undefined && c.nr !== undefined))
    throw bad("Wer Stunden mit ihrer Nummer (nr) angibt, übergibt base_version aus get_unit – die Nummern gelten für diese Version.");
  const ver = baseVersion == null ? u.version : Number(baseVersion);
  if (ver !== u.version) throw new HttpError(409, "unit_conflict", "Die Einheit wurde inzwischen an anderer Stelle geändert. Bitte neu laden.", { version: u.version });
  const seen = new Set(), out = [];
  list.forEach((c, k) => {
    const x = c && typeof c === "object" ? c : {}, tag = "Eintrag " + (k + 1) + " von stunden";
    let i = -1;
    if (typeof x.uid === "string" && /^[a-f0-9]{8}$/.test(x.uid)) i = rows.findIndex((r) => r.uid === x.uid);
    else if (x.uid === undefined && Number.isInteger(x.nr) && x.nr >= 1 && x.nr <= rows.length) i = x.nr - 1;
    else if (x.uid === undefined && x.nr === undefined) throw bad(tag + ": Bitte uid oder nr der Stunde (aus get_unit) angeben.");
    if (i < 0) throw new HttpError(404, "not_found", tag + ": Diese Stunde steht nicht (mehr) in der Einheit (" + (x.uid !== undefined ? "uid " + String(x.uid).slice(0, 20) : "nr " + String(x.nr).slice(0, 10)) + ").");
    if (seen.has(i)) throw bad(tag + ": Stunde " + (i + 1) + " steht doppelt in der Liste.");
    seen.add(i);
    const hasQ = typeof x.stundenfrage === "string" && x.stundenfrage.trim(), hasA = Array.isArray(x.ablauf) && x.ablauf.some((y) => String(y).trim());
    if (!hasQ && !hasA) throw bad(tag + " (Stunde " + (i + 1) + "): Bitte stundenfrage und/oder ablauf angeben.");
    rows[i] = rowChange(rows[i], x);
    out.push({ n: i + 1, uid: rows[i].uid, stundenfrage: rows[i].stundenfrage, ablauf: rows[i].ablauf, date: rows[i].date || null });
  });
  const version = await saveUnit(db, unitId, { rows: JSON.stringify(rows) }, ver, source, now);
  return { version, rows: out.sort((a, b) => a.n - b.n) };
}

/* ---------- Einheit verlängern (Anforderung 13 c; extend_unit, nur nach Zustimmung der Lehrkraft) ----------
 * Die nächsten `termine` (1–3) Termine laut Stundenplan nach dem bisherigen Ende (Ferien, Ausfälle, Klausurtag wie computeSlots; nur Termine, die noch
 * nicht vorbei sind): das Ende rückt auf den letzten davon; zuerst bekommen Zeilen ohne Termin (Grundschule nach einer Krankmeldung; am Gymnasium nur
 * Zeilen ohne Sitzung) diese Termine, dann die neuen Stunden. Übrige Termine bleiben frei; bestehende Sitzungen behalten ihre Termine. Hat die Einheit
 * schon Sitzungen (Status „geplant“), entstehen sie für die neuen bzw. jetzt datierten Zeilen gleich mit (Grundschule: Sitzungen ohne Termin bekommen
 * Datum, Beginn und Dauer). Ein Batch, an die Version gebunden. → {version, oldEnd, end, rows: [{n, uid, stundenfrage, date, time, minutes, lessonId,
 * created, fresh}], free: [Termin], pending (Sitzungen, die noch fehlen)} */
export const EXTEND_MAX = 3;
export async function extendUnit(db, u, opts, source, now) {
  const gs = u.subject === GS_SUBJECT, ver = Number(opts.baseVersion), n = Number(opts.termine);
  if (!Number.isInteger(ver)) throw bad("Bitte base_version aus get_unit angeben.");
  if (ver !== u.version) throw new HttpError(409, "unit_conflict", "Die Einheit wurde inzwischen an anderer Stelle geändert. Bitte neu laden.", { version: u.version });
  if (!Number.isInteger(n) || n < 1 || n > EXTEND_MAX) throw bad("termine muss 1, 2 oder 3 sein (so viele Termine laut Stundenplan kommen nach dem bisherigen Ende dazu).");
  const params = normalizeParams(parseJ(u.params, {}));
  if (!params.end || !params.weekdays.length) throw bad("Die Einheit hat in den Rahmendaten noch kein Ende oder keinen Stundenplan – das trägt die Lehrkraft in der Plattform ein.");
  const raw = Array.isArray(opts.stunden) ? opts.stunden : [];
  if (raw.length > n) throw bad("Mehr neue Stunden (" + raw.length + ") als Termine (" + n + "): Jede neue Stunde braucht einen Termin – erhöhe termine (höchstens " + EXTEND_MAX + ") oder schicke weniger Stunden.");
  const fresh = raw.map((r, k) => {
    const x = normalizeRows([r && typeof r === "object" ? { stundenfrage: r.stundenfrage, ablauf: r.ablauf, schritt: r.schritt } : {}], newUid)[0];
    if (!x || !x.stundenfrage) throw bad("Neue Stunde " + (k + 1) + ": Bitte stundenfrage und ablauf angeben.");
    return x;
  });
  const rows = parseJ(u.rows, []), lessons = await linkedLessons(db, u.id, gs);
  // Termine nach dem Ende, die keine Zeile schon belegt (z. B. von Hand dahinter eingetragen)
  const after = slotsAfterEnd(params, n + rows.length, now), used = occupy(after, rows), slots = after.filter((s, i) => !used.has(i)).slice(0, n);
  if (slots.length < n) throw bad("Nach dem Ende der Einheit (" + fmtDay(params.end) + ") gibt es laut Stundenplan " + (slots.length ? "nur " + slots.length + (slots.length === 1 ? " weiteren Termin" : " weitere Termine") : "keinen weiteren Termin") + ".");
  const byRow = new Map(lessons.filter((l) => l.row && !l.cancelled).map((l) => [l.row, l]));
  // Zeilen ohne Termin: Grundschule alle (ihre Sitzungen stehen dann „ohne Termin“), Gymnasium nur ohne Sitzung (Sitzungen behalten ihre Termine)
  const undated = rows.map((r, i) => ({ r, i })).filter((x) => !x.r.date && (gs || !byRow.has(x.r.uid)));
  const room = n - Math.min(undated.length, n);
  if (fresh.length > room) throw bad("Für " + fresh.length + (fresh.length === 1 ? " neue Stunde" : " neue Stunden") + " reichen die Termine nicht: " + Math.min(undated.length, n) + " von " + n +
    (n === 1 ? " Termin geht" : " Terminen gehen") + " zuerst an Stunden ohne Termin (" + undated.slice(0, n).map((x) => "Stunde " + (x.i + 1) + " „" + x.r.stundenfrage + "“").join(", ") + "). Erhöhe termine (höchstens " + EXTEND_MAX + ") oder schicke weniger Stunden.");
  let k = 0;
  const changed = [];
  for (const x of undated) {
    if (k >= n) break;
    const s = slots[k++];
    rows[x.i] = { ...x.r, date: s.date, time: s.time || null, minutes: s.minutes };
    changed.push({ i: x.i, fresh: false });
  }
  for (const r of fresh) { const s = slots[k++]; rows.push({ ...r, date: s.date, time: s.time || null, minutes: s.minutes }); changed.push({ i: rows.length - 1, fresh: true }); }
  const free = slots.slice(k), end = slots[n - 1].date, uids = new Set(changed.map((c) => rows[c.i].uid));
  const fields = { params: JSON.stringify({ ...params, end }), rows: JSON.stringify(rows) };
  const rev = reviseData(u.revise);
  if (gs && rev) fields.revise = JSON.stringify({ ...rev, undated: rows.filter((r) => !r.date).map((r) => r.uid), undo: null });
  // Sitzungen: nur, wenn die Einheit schon festgelegt ist
  const planned = u.status === "geplant";
  const toCreate = planned ? changed.map((c) => rows[c.i]).filter((r) => !byRow.has(r.uid)) : [];
  const newLessons = toCreate.map((r) => ({ id: randomId(8), code: generateCode(), title: cleanLine(r.stundenfrage, 200) || u.title || "Sitzung", date: r.date, min: r.minutes ?? null, row: r.uid, time: r.time || null }));
  const G = "EXISTS(SELECT 1 FROM units WHERE id=?3 AND version=?4)", stmts = [];
  if (gs) { const dated = lessons.filter((l) => !l.cancelled && l.row && uids.has(l.row)); if (dated.length) stmts.push(mirrorStmt(db, rows, dated, now, G, u.id, ver)); }
  if (newLessons.length) {
    stmts.push(db.prepare("INSERT INTO lessons(id, subject, klass, title, topic, duration_min, lesson_date, ideas, homework, code, unit_id, unit_row, created_at, updated_at, start_time) " +
      "SELECT json_extract(value,'$.id'), ?1, ?2, json_extract(value,'$.title'), ?5, json_extract(value,'$.min'), json_extract(value,'$.date'), '', '', json_extract(value,'$.code'), ?3, json_extract(value,'$.row'), ?6, ?6, json_extract(value,'$.time') " +
      "FROM json_each(?7) WHERE EXISTS(SELECT 1 FROM units WHERE id=?3 AND version=?4) ON CONFLICT DO NOTHING")
      .bind(u.subject, u.klass, u.id, ver, cleanLine(u.title || parseJ(u.plan, {}).titel || "", 500), now, JSON.stringify(newLessons)));
    // Begrüßung des Planungschats wie createLessonsBulk – in der Grundschule gibt es keinen Planungschat
    if (!gs) stmts.push(db.prepare("INSERT INTO chat(lesson_id, role, content, model, created_at) SELECT json_extract(value,'$.id'), 'assistant', json_extract(value,'$.g'), 'begruessung', ?2 FROM json_each(?1) " +
      "WHERE EXISTS(SELECT 1 FROM lessons l WHERE l.id=json_extract(value,'$.id'))")
      .bind(JSON.stringify(newLessons.map((x) => ({ id: x.id, g: greetingText({ subject: u.subject, klass: u.klass, durationMin: x.min }) }))), now));
  }
  const sets = Object.keys(fields).map((f, i) => f + "=?" + (i + 4));
  stmts.push(db.prepare("UPDATE units SET " + sets.join(", ") + ", updated_at=?2, source=?3, version=version+1 WHERE id=?1 AND version=?" + (Object.keys(fields).length + 4) + " RETURNING version")
    .bind(u.id, now, source, ...Object.values(fields), ver));
  stmts.push(db.prepare("SELECT id, unit_row FROM lessons WHERE unit_id=?1 AND cancelled=0").bind(u.id));
  const res = await db.batch(stmts);
  const last = (res[res.length - 2].results || [])[0];
  if (!last) {
    const cur = await db.prepare("SELECT version FROM units WHERE id=?1").bind(u.id).first();
    throw new HttpError(409, "unit_conflict", "Die Einheit wurde inzwischen an anderer Stelle geändert. Bitte neu laden.", { version: cur ? cur.version : null });
  }
  const lessonOf = new Map((res[res.length - 1].results || []).map((x) => [x.unit_row, x.id]));
  const made = new Set(newLessons.filter((x) => lessonOf.get(x.row) === x.id).map((x) => x.row));
  const out = changed.map((c) => { const r = rows[c.i]; return { n: c.i + 1, uid: r.uid, stundenfrage: r.stundenfrage, date: r.date, time: r.time || null, minutes: r.minutes ?? null,
    lessonId: lessonOf.get(r.uid) || null, created: made.has(r.uid), fresh: c.fresh }; });
  return { version: last.version, oldEnd: params.end, end, rows: out, free, pending: planned ? out.filter((r) => !r.lessonId).length : 0 };
}
export async function routeUnitRowPut(c, id, uid) {
  await requireTeacher(c);
  const body = await readJson(c.request, 50000);
  if (!/^[a-f0-9]{8}$/.test(uid)) throw bad("Ungültige Zeile.");
  const row = await updateRow(c.db, id, uid, body, "lehrkraft", c.now);
  return json({ ok: true, row, unit: await unitFull(c.db, await getUnit(c.db, id)) });
}
export { lessonOut, isObj };
