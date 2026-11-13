// units.js – Unterrichtseinheiten: Rahmendaten (Stundenplan, Zeitraum, Klausur, Ferien) → Termine, Plan (Leupold-Schema) und Ablauf
// (Zeilen: Stundenfrage, grober Ablauf, Lernschritt, Datum). Die Planung macht Claude in claude.ai über den Connector; die Lehrkraft prüft
// und bearbeitet hier. Erst eine festgelegte Einheit erzeugt die Sitzungen (je Zeile eine Sitzung mit Datum).
import { HttpError, bad, json, readJson, randomId, cleanLine, isId, isObj } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { createLessonsBulk, lessonOut } from "./lessons.js";
import { loadSubjectConfigs } from "./bases.js";
import { courseInfo, getCourseSettings, courseRef } from "./courses.js";
import { gsCourseOut } from "./gs.js";
import { isValidSubject, isValidClass, classAllowed, subjectName, classShort, GS_SUBJECT } from "../public/shared.js";
import { normalizeParams, computeSlots, normalizePlan, normalizeRows, assignDates, lessonSlots, repackFuture } from "../public/planning.js";

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
/* Sitzungen der Einheit. gs: zusätzlich Dauer, Ausfall-Eintrag und was schon geplant ist (Verlaufsplan, PDFs, Bildkarten) – nur in der Grundschule,
   damit die Ausgabe am Gymnasium gleich bleibt */
export async function linkedLessons(db, unitId, gs = false) {
  const r = await db.prepare("SELECT id, title, lesson_date, start_time, unit_row, code" + (gs ? ", duration_min, cancelled, length(portal) > 0 AS has_plan, " +
    "(SELECT COUNT(*) FROM files f WHERE f.lesson_id=lessons.id AND f.kind='file' AND f.mime='application/pdf' AND f.area NOT IN ('archive','presentation') AND f.cards IS NULL) AS pdfs, " +
    "(SELECT COUNT(*) FROM files f WHERE f.lesson_id=lessons.id AND f.cards IS NOT NULL) AS cardsets" : "") + " FROM lessons WHERE unit_id=?1").bind(unitId).all();
  return (r.results || []).map((l) => ({ id: l.id, title: l.title, date: l.lesson_date, time: l.start_time || null, row: l.unit_row, code: l.code,
    ...(gs ? { minutes: l.duration_min ?? null, cancelled: !!l.cancelled, hasPlan: !!l.has_plan, pdfs: l.pdfs || 0, cards: l.cardsets || 0 } : {}) }));
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
export async function routeSchedule(c) {
  await requireTeacher(c);
  const cfgs = await loadSubjectConfigs(c.db);
  const [r, g] = await c.db.batch([
    c.db.prepare("SELECT id, subject, klass, title, params FROM units ORDER BY created_at DESC LIMIT 2000"),   // die neuesten zuerst
    c.db.prepare("SELECT * FROM gs_courses"),
  ]);
  const gs = new Map((g.results || []).map((x) => [x.id, gsCourseOut(x)]));
  const units = [];
  for (const x of r.results || []) {
    const course = x.subject === GS_SUBJECT ? gs.get(x.klass) : null;
    if (course === undefined) continue;
    if (!course && (!isValidSubject(x.subject) || !classAllowed(cfgs[x.subject], x.klass))) continue;
    const p = normalizeParams(parseJ(x.params, {}));
    if (!p.start || !p.end || p.end < p.start || !p.weekdays.length) continue;
    units.push({ id: x.id, subject: x.subject, klass: x.klass, title: x.title, params: { start: p.start, end: p.end, exam: p.exam, weekdays: p.weekdays, breaks: p.breaks, ...(p.cancelled ? { cancelled: p.cancelled } : {}) },
      ...(course ? { course: { id: course.id, short: course.short, label: course.label } } : {}) });
  }
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
  await getUnit(c.db, id);
  const n = await c.db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE unit_id=?1 AND cancelled=0").bind(id).first();
  if ((n || {}).n) throw new HttpError(409, "has_lessons", "Zu dieser Einheit gibt es schon Sitzungen. Bitte zuerst die Sitzungen löschen.");
  // Ausfall-Einträge (Grundschule) gehen mit der Einheit
  await c.db.batch([c.db.prepare("DELETE FROM lessons WHERE unit_id=?1 AND cancelled=1").bind(id), c.db.prepare("DELETE FROM units WHERE id=?1").bind(id)]);
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
export async function updateRow(db, unitId, rowUid, change, source, now) {
  const u = await getUnit(db, unitId), rows = parseJ(u.rows, []);
  const i = rows.findIndex((r) => r.uid === rowUid);
  if (i < 0) throw new HttpError(404, "not_found", "Diese Stunde steht nicht (mehr) in der Einheit.");
  const next = { ...rows[i] };
  if (typeof change.stundenfrage === "string" && change.stundenfrage.trim()) next.stundenfrage = change.stundenfrage.trim().slice(0, 400);
  if (Array.isArray(change.ablauf) && change.ablauf.length) next.ablauf = change.ablauf.map((x) => String(x).trim().slice(0, 400)).filter(Boolean).slice(0, 15);
  rows[i] = next;
  await saveUnit(db, unitId, { rows: JSON.stringify(rows) }, null, source, now);
  return next;
}
export async function routeUnitRowPut(c, id, uid) {
  await requireTeacher(c);
  const body = await readJson(c.request, 50000);
  if (!/^[a-f0-9]{8}$/.test(uid)) throw bad("Ungültige Zeile.");
  const row = await updateRow(c.db, id, uid, body, "lehrkraft", c.now);
  return json({ ok: true, row, unit: await unitFull(c.db, await getUnit(c.db, id)) });
}
export { lessonOut, isObj };
