// units.js – Unterrichtseinheiten: Rahmendaten (Stundenplan, Zeitraum, Klausur, Ferien) → Termine, Plan (Leupold-Schema) und Ablauf
// (Zeilen: Stundenfrage, grober Ablauf, Lernschritt, Datum). Die Planung macht Claude in claude.ai über den Connector; die Lehrkraft prüft
// und bearbeitet hier. Erst eine festgelegte Einheit erzeugt die Sitzungen (je Zeile eine Sitzung mit Datum).
import { HttpError, bad, json, readJson, randomId, cleanLine, isId, isObj } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { createLesson, lessonOut } from "./lessons.js";
import { loadSubjectConfigs } from "./bases.js";
import { isValidSubject, isValidClass, classAllowed, subjectName, classShort } from "../public/shared.js";
import { normalizeParams, computeSlots, normalizePlan, normalizeRows, assignDates, lessonSlots } from "../public/planning.js";

const newUid = () => randomId(4);
const parseJ = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };
export const unitOut = (u, extra = {}) => ({
  id: u.id, subject: u.subject, klass: u.klass, title: u.title, status: u.status, params: parseJ(u.params, {}), plan: parseJ(u.plan, {}), rows: parseJ(u.rows, []),
  version: u.version, source: u.source || null, createdAt: u.created_at, updatedAt: u.updated_at, ...extra,
});
export async function getUnit(db, id) {
  if (!isId(id)) throw new HttpError(404, "not_found", "Diese Unterrichtseinheit gibt es nicht (mehr).");
  const u = await db.prepare("SELECT * FROM units WHERE id=?1").bind(id).first();
  if (!u) throw new HttpError(404, "not_found", "Diese Unterrichtseinheit gibt es nicht (mehr).");
  return u;
}
async function linkedLessons(db, unitId) {
  const r = await db.prepare("SELECT id, title, lesson_date, unit_row, code FROM lessons WHERE unit_id=?1").bind(unitId).all();
  return (r.results || []).map((l) => ({ id: l.id, title: l.title, date: l.lesson_date, row: l.unit_row, code: l.code }));
}
export async function unitFull(db, u) {
  const lessons = await linkedLessons(db, u.id);
  const params = parseJ(u.params, {});
  return unitOut(u, { slots: computeSlots(params), lessons });
}

/* Speichern mit Versionsprüfung (Claude über den Connector und die Lehrkraft im Browser schreiben dieselbe Einheit) */
export async function saveUnit(db, id, fields, baseVersion, source, now) {
  const sets = [], args = [];
  for (const [k, v] of Object.entries(fields)) { args.push(v); sets.push(k + "=?" + (args.length + 1)); }
  args.push(now); sets.push("updated_at=?" + (args.length + 1));
  args.push(source); sets.push("source=?" + (args.length + 1));
  const cond = baseVersion == null ? "" : " AND version=?" + (args.length + 2);
  const r = await db.prepare("UPDATE units SET " + sets.join(", ") + ", version=version+1 WHERE id=?1" + cond + " RETURNING version")
    .bind(id, ...args, ...(baseVersion == null ? [] : [Number(baseVersion)])).first();
  if (!r) {
    const cur = await db.prepare("SELECT version FROM units WHERE id=?1").bind(id).first();
    if (!cur) throw new HttpError(404, "not_found", "Diese Unterrichtseinheit gibt es nicht (mehr).");
    throw new HttpError(409, "unit_conflict", "Die Einheit wurde inzwischen an anderer Stelle geändert. Bitte neu laden.", { version: cur.version });
  }
  return r.version;
}
/* Plan (z. B. von Claude) übernehmen: Zeilen bekommen der Reihe nach die Termine der Einheit */
export async function applyPlan(db, u, planRaw, rowsRaw, baseVersion, source, now) {
  const plan = normalizePlan(planRaw), oldRows = parseJ(u.rows, []);
  let rows = normalizeRows(rowsRaw, newUid);
  // bestehende Zeilen mit Sitzung behalten ihre Kennung (gleiche Position), damit die Verknüpfung erhalten bleibt
  rows = rows.map((r, i) => (oldRows[i] && !rowsRaw[i]?.uid ? { ...r, uid: oldRows[i].uid, date: r.date || oldRows[i].date, minutes: r.minutes || oldRows[i].minutes } : r));
  rows = assignDates(rows, computeSlots(parseJ(u.params, {})));
  const fields = { plan: JSON.stringify(plan), rows: JSON.stringify(rows) };
  if (plan.titel && !u.title) fields.title = plan.titel;
  return saveUnit(db, u.id, fields, baseVersion, source, now);
}

export async function routeUnitsList(c) {
  await requireTeacher(c);
  const u = new URL(c.request.url), subject = u.searchParams.get("subject"), klass = u.searchParams.get("klass");
  if (!isValidSubject(subject) || !isValidClass(klass)) throw bad("Fach oder Klasse ungültig.");
  const r = await c.db.prepare("SELECT u.*, (SELECT COUNT(*) FROM lessons l WHERE l.unit_id=u.id) AS n FROM units u WHERE subject=?1 AND klass=?2 ORDER BY created_at DESC").bind(subject, klass).all();
  return json({ ok: true, units: (r.results || []).map((x) => { const o = unitOut(x, { lessonCount: x.n || 0 }); return { ...o, slotCount: lessonSlots(computeSlots(o.params)).length }; }) });
}
export async function routeUnitCreate(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 50000);
  if (!isValidSubject(body.subject)) throw bad("Bitte eines der drei Fächer wählen.");
  const cfg = (await loadSubjectConfigs(c.db))[body.subject];
  if (!classAllowed(cfg, body.klass)) throw bad(subjectName(body.subject) + " wird in " + classShort(body.klass) + " laut Fach-Einstellungen nicht unterrichtet.");
  const id = randomId(8);
  await c.db.prepare("INSERT INTO units(id, subject, klass, title, params, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?6)")
    .bind(id, body.subject, body.klass, cleanLine(body.title, 200), JSON.stringify(normalizeParams(body.params)), c.now).run();
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
  const fields = {};
  if (body.title !== undefined) fields.title = cleanLine(body.title, 200);
  if (body.params !== undefined) fields.params = JSON.stringify(normalizeParams(body.params));
  if (body.plan !== undefined) fields.plan = JSON.stringify(normalizePlan(body.plan));
  if (body.rows !== undefined) {
    let rows = normalizeRows(body.rows, newUid);
    if (body.assignDates) rows = assignDates(rows.map((r) => ({ ...r, date: null })), computeSlots(body.params !== undefined ? normalizeParams(body.params) : parseJ(u.params, {})));
    fields.rows = JSON.stringify(rows);
    // Datum/Dauer verknüpfter Sitzungen mitführen
    const lessons = await linkedLessons(c.db, id);
    const stmts = [];
    for (const l of lessons) {
      const r = rows.find((x) => x.uid === l.row);
      if (r && r.date && r.date !== l.date) stmts.push(c.db.prepare("UPDATE lessons SET lesson_date=?2, updated_at=?3 WHERE id=?1").bind(l.id, r.date, c.now));
    }
    if (stmts.length) await c.db.batch(stmts.slice(0, 40));
  }
  if (!Object.keys(fields).length) return json({ ok: true, unit: await unitFull(c.db, u) });
  await saveUnit(c.db, id, fields, Number.isInteger(body.baseVersion) ? body.baseVersion : null, "lehrkraft", c.now);
  return json({ ok: true, unit: await unitFull(c.db, await getUnit(c.db, id)) });
}
export async function routeUnitDelete(c, id) {
  await requireTeacher(c);
  await getUnit(c.db, id);
  const n = await c.db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE unit_id=?1").bind(id).first();
  if ((n || {}).n) throw new HttpError(409, "has_lessons", "Zu dieser Einheit gibt es schon Sitzungen. Bitte zuerst die Sitzungen löschen.");
  await c.db.prepare("DELETE FROM units WHERE id=?1").bind(id).run();
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
  if (missingDate.length) throw bad(missingDate.length + " Zeile(n) haben noch kein Datum. Bitte Termine berechnen oder Datum eintragen.");
  let created = 0;
  for (const r of rows) {
    if (have.has(r.uid)) continue;
    if (created >= 40) break;   // Anfrage-Grenzen des Free-Plans; Rest beim nächsten Klick
    await createLesson(c.db, { subject: u.subject, klass: u.klass, title: r.stundenfrage || plan.titel || u.title, topic: u.title || plan.titel || "", date: r.date,
      durationMin: r.minutes, unitId: u.id, unitRow: r.uid }, c.now);
    created++;
  }
  if (u.status !== "geplant") await c.db.prepare("UPDATE units SET status='geplant', updated_at=?2 WHERE id=?1").bind(id, c.now).run();
  return json({ ok: true, created, unit: await unitFull(c.db, await getUnit(c.db, id)) });
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
