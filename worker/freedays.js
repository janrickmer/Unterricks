// freedays.js – Unterrichtsfreie Tage (Einstellungen, Nachtrag 24 vom 13.11.2026): Zeiträume mit Bezeichnung, je Eintrag für die Grundschule, das
// Gymnasium oder beide Schulen. An diesen Tagen hat die Schule keine Termine – alle Terminberechnungen (computeSlots über params.schoolBreaks)
// lassen sie aus. Gespeichert in free_days (wenige Zeilen, höchstens 200 – jede Abfrage liest alle, deshalb ohne Index), nie in units.params.
// Vor dem Speichern nennt die Vorschau die betroffenen Sitzungen (heute oder später, ohne Ausfall-Einträge) und Stunden ohne Sitzung; auf Wunsch
// rücken sie samt allen folgenden Stunden ihrer Einheit auf die nächsten freien Termine (Packlogik der Krankmeldung, ohne Ausfall-Eintrag) – je
// Einheit versionsgebunden, alles in einem Batch; danach der Hinweis zum Überarbeiten (units.revise, Eintrag kind "free"). Zurückverschoben wird nie.
import { HttpError, bad, json, readJson, randomId, isId } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { reviseData } from "./units.js";
import { gsCourseOut } from "./gs.js";
import { berlinToday, GS_SUBJECT, classShort, subjectShort, subjectName } from "../public/shared.js";
import { normalizeFreeDay, cleanFreeDays, withSchoolBreaks, planFreeShift, schoolOf, freeDayCovers, freeDayOn, freeDateError, FREE_DAYS_MAX } from "../public/planning.js";

const parseJ = (s, d) => { try { const v = JSON.parse(s); return v ?? d; } catch { return d; } };

/* ---------- Lesen (für alle Terminberechnungen) ---------- */
export const FREE_DAYS_SQL = "SELECT id, date_from, date_to, label, scope, created_at, updated_at FROM free_days ORDER BY date_from, date_to, label LIMIT " + FREE_DAYS_MAX;
export const freeDaysStmt = (db) => db.prepare(FREE_DAYS_SQL);
export const freeDaysOf = (res) => cleanFreeDays(((res && res.results) || []).map((x) => ({ id: x.id, from: x.date_from, to: x.date_to, label: x.label, scope: x.scope })));
export async function loadFreeDays(db) { return freeDaysOf(await freeDaysStmt(db).all()); }
const out = (x) => ({ id: x.id, from: x.date_from, to: x.date_to, label: x.label, scope: x.scope, createdAt: x.created_at, updatedAt: x.updated_at });
/* Rahmendaten einer Einheit (Zeile aus units bzw. unitOut) mit den unterrichtsfreien Tagen ihrer Schule – nur zum Rechnen und Ausliefern */
export const unitParamsFree = (u, fd) => withSchoolBreaks(typeof u.params === "string" ? parseJ(u.params, {}) : u.params || {}, fd, u.subject);

/* GET /api/teacher/free-days → {today, freeDays: [{id, from, to, label, scope, createdAt, updatedAt}]} (sortiert nach Beginn) */
export async function routeFreeDaysList(c) {
  await requireTeacher(c);
  const r = await c.db.prepare(FREE_DAYS_SQL).all();
  return json({ ok: true, today: berlinToday(c.now), freeDays: (r.results || []).map(out) });
}

/* ---------- Betroffene Sitzungen und Stunden ----------
 * Ein Batch (5 Anweisungen): alle Einträge, die Sitzungen der Schule im Zeitraum (heute oder später, ohne Ausfall-Einträge), die betroffenen
 * Einheiten (mit einer solchen Sitzung oder einer Zeile mit Datum im Zeitraum) samt ihrer Sitzungen und die Grundschulkurse (Namen).
 * entry = neuer Stand {from, to, label, scope}; old = bisheriger Stand beim Ändern (dessen Tage galten schon – die fragt die Vorschau nicht erneut). */
const SCHOOL = (alias, n) => "(?" + n + "='both' OR (?" + n + "='gs') = (" + alias + ".subject='" + GS_SUBJECT + "'))";
const IN_RANGE = "BETWEEN ?1 AND ?2 AND {d} >= ?3";
const UNIT_HIT = "u.id IN (SELECT l.unit_id FROM lessons l WHERE l.cancelled=0 AND l.unit_id IS NOT NULL AND l.lesson_date " + IN_RANGE.replace("{d}", "l.lesson_date") + ") " +
  "OR (json_valid(u.rows) AND EXISTS(SELECT 1 FROM json_each(u.rows) r WHERE json_extract(r.value,'$.date') " + IN_RANGE.replace("{d}", "json_extract(r.value,'$.date')") + "))";
async function affectedData(c, entry) {
  const today = berlinToday(c.now), args = [entry.from, entry.to, today, entry.scope];
  const units = "SELECT u.id FROM units u WHERE " + SCHOOL("u", 4) + " AND (" + UNIT_HIT + ")";
  const [fd, ls, us, ul, gc] = await c.db.batch([
    c.db.prepare(FREE_DAYS_SQL),
    c.db.prepare("SELECT l.id, l.subject, l.klass, l.title, l.lesson_date, l.start_time, l.duration_min, l.unit_id, l.unit_row, u.title AS unit_title FROM lessons l " +
      "LEFT JOIN units u ON u.id=l.unit_id WHERE l.cancelled=0 AND l.lesson_date " + IN_RANGE.replace("{d}", "l.lesson_date") + " AND " + SCHOOL("l", 4) +
      " ORDER BY l.lesson_date, COALESCE(l.start_time,'99:99'), l.created_at LIMIT 500").bind(...args),
    c.db.prepare("SELECT id, subject, klass, title, status, params, rows, version, revise FROM units WHERE id IN (" + units + ") LIMIT 200").bind(...args),
    c.db.prepare("SELECT id, title, lesson_date, start_time, duration_min, unit_id, unit_row, cancelled FROM lessons WHERE unit_id IN (" + units + ")").bind(...args),
    c.db.prepare("SELECT * FROM gs_courses"),
  ]);
  const gs = new Map((gc.results || []).map((x) => [x.id, gsCourseOut(x)]));
  const lessonsOf = new Map();
  for (const l of ul.results || []) {
    if (!lessonsOf.has(l.unit_id)) lessonsOf.set(l.unit_id, []);
    lessonsOf.get(l.unit_id).push({ id: l.id, title: l.title, date: l.lesson_date || null, time: l.start_time || null, row: l.unit_row, minutes: l.duration_min ?? null, cancelled: !!l.cancelled });
  }
  return { today, all: freeDaysOf(fd), lessons: ls.results || [], units: us.results || [], lessonsOf, gs };
}
// Kurs bzw. Klasse wie im Wochenkalender
const whoOf = (subject, klass, gs) => (subject === GS_SUBJECT ? { school: "gs", label: (gs.get(klass) || {}).short || "Grundschule", subject: "Grundschule", fach: GS_SUBJECT }
  : { school: "gym", label: classShort(klass), subject: subjectShort(subject) || subjectName(subject), fach: subject });
/* Für jede betroffene Einheit der Plan (planFreeShift) und – für die Vorschau – die Liste. after = alle Einträge nach dem Speichern (mit entry),
   hit(date, school) = Tag ist neu unterrichtsfrei. → {items, plans: [{u, plan|null, error|null}]} */
function analyse(c, data, entry, old, afterRaw) {
  const after = cleanFreeDays(afterRaw);   // einmal säubern – je Einheit nur noch nachschlagen (CPU)
  const hit = (d, school) => d >= entry.from && d <= entry.to && d >= data.today && freeDayCovers(entry, school) && !(old && freeDayCovers(old, school) && d >= old.from && d <= old.to);
  const plans = [], blocked = new Map(), unitById = new Map(data.units.map((u) => [u.id, u]));
  for (const u of data.units) {
    const school = schoolOf(u.subject), rows = parseJ(u.rows, []), lessons = data.lessonsOf.get(u.id) || [];
    let plan = null, error = null;
    try { plan = planFreeShift({ params: withSchoolBreaks(parseJ(u.params, {}), after, u.subject), rows, lessons, hit: (d) => hit(d, school), now: c.now }); }
    catch (e) { if (e && e.code === "already_held") error = e.message; else throw e; }
    if (error) blocked.set(u.id, error);
    if (plan || error) plans.push({ u, rows, lessons, plan, error });
  }
  const items = [];
  // Sitzungen: ohne Einheit bzw. ohne Zeile in ihr lassen sie sich nicht nachrücken (die Lehrkraft verschiebt sie selbst)
  for (const l of data.lessons) {
    const w = whoOf(l.subject, l.klass, data.gs), u = l.unit_id ? unitById.get(l.unit_id) : null;
    if (!hit(l.lesson_date, w.school)) continue;
    const inUnit = !!(u && l.unit_row && parseJ(u.rows, []).some((r) => r && r.uid === l.unit_row));
    items.push({ kind: "lesson", lessonId: l.id, date: l.lesson_date, time: l.start_time || null, school: w.school, fach: w.fach, subject: w.subject, label: w.label, title: l.title || "",
      unitId: inUnit ? u.id : null, unitTitle: inUnit ? u.title || "" : null, noUnit: !inUnit, blocked: inUnit ? blocked.get(u.id) || null : null });
  }
  // Stunden ohne Sitzung (Einheit noch nicht festgelegt bzw. Zeile ohne Sitzung) mit Datum im Zeitraum – sie rücken beim Verschieben mit
  for (const u of data.units) {
    const w = whoOf(u.subject, u.klass, data.gs), have = new Set((data.lessonsOf.get(u.id) || []).filter((l) => !l.cancelled).map((l) => l.row));
    parseJ(u.rows, []).forEach((r, i) => {
      if (!r || !r.date || have.has(r.uid) || !hit(r.date, w.school)) return;
      items.push({ kind: "row", n: i + 1, date: r.date, time: r.time || null, school: w.school, fach: w.fach, subject: w.subject, label: w.label, title: r.stundenfrage || "",
        unitId: u.id, unitTitle: u.title || "", noUnit: false, blocked: blocked.get(u.id) || null });
    });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time || "99:99").localeCompare(b.time || "99:99") || a.label.localeCompare(b.label, "de", { numeric: true })));
  return { items, plans };
}
async function readEntry(c, id) {
  if (!isId(id)) throw new HttpError(404, "not_found", "Diesen unterrichtsfreien Eintrag gibt es nicht (mehr).");
  const x = await c.db.prepare("SELECT * FROM free_days WHERE id=?1").bind(id).first();
  if (!x) throw new HttpError(404, "not_found", "Diesen unterrichtsfreien Eintrag gibt es nicht (mehr).");
  return { id: x.id, from: x.date_from, to: x.date_to, label: x.label, scope: x.scope };
}
function entryOf(body) {
  try { return normalizeFreeDay(body); }
  catch (e) { throw new HttpError(400, "bad_request", e.message, { field: e.field || null }); }
}

/* POST /api/teacher/free-days/preview {id?, from, to, label, scope} → {entry, items: [{kind "lesson"|"row", lessonId?, n?, date, time, school, subject,
   label, title, unitId, unitTitle, noUnit, blocked}]} – nichts gespeichert. Gibt es keine Einträge, speichert der Browser sofort. 6–7 D1-Anweisungen. */
export async function routeFreeDaysPreview(c) {
  await requireTeacher(c);
  const body = await readJson(c.request, 4000);
  const entry = entryOf(body), old = body.id != null ? await readEntry(c, body.id) : null;
  const data = await affectedData(c, entry);
  const after = [...data.all.filter((f) => !old || f.id !== old.id), entry];
  const { items } = analyse(c, data, entry, old, after);
  return json({ ok: true, entry, items });
}

/* POST /api/teacher/free-days {from, to, label, scope, shift} bzw. PUT /api/teacher/free-days/<id> – speichern; shift = betroffene Sitzungen und
   Stunden verschieben. Ein Batch: der Eintrag (neu: nur bei weniger als 200), die Termine der verschobenen Sitzungen (je an die Version ihrer Einheit
   gebunden) und die Einheiten (Zeilen, Überarbeitungshinweis; je Einheit WHERE version=…). Scheitert eine Einheit (inzwischen geändert), bleibt der
   Eintrag gespeichert und die Antwort nennt sie. → {freeDay, freeDays, shifted: [{unitId, title, school, label, moved, undated: [{n, title}]}],
   failed: [{unitId, title, reason}], noUnit: [Sitzungen ohne Einheit], kept (Zahl der betroffenen, die nicht verschoben wurden)}. 8–9 D1-Anweisungen. */
export async function routeFreeDayCreate(c) { return saveEntry(c, null); }
export async function routeFreeDayPut(c, id) { return saveEntry(c, id); }
async function saveEntry(c, id) {
  await requireTeacher(c);
  const body = await readJson(c.request, 4000);
  const entry = entryOf(body), old = id ? await readEntry(c, id) : null, shift = body.shift === true;
  const data = await affectedData(c, entry);
  if (!old && data.all.length >= FREE_DAYS_MAX) throw bad("Höchstens " + FREE_DAYS_MAX + " unterrichtsfreie Einträge – bitte zuerst vergangene löschen.");
  const fid = old ? old.id : randomId(8);
  const after = [...data.all.filter((f) => f.id !== fid), { id: fid, ...entry }];
  const { items, plans } = analyse(c, data, entry, old, after);
  const stmts = [];
  stmts.push(old
    ? c.db.prepare("UPDATE free_days SET date_from=?2, date_to=?3, label=?4, scope=?5, updated_at=?6 WHERE id=?1 RETURNING id").bind(fid, entry.from, entry.to, entry.label, entry.scope, c.now)
    : c.db.prepare("INSERT INTO free_days(id, date_from, date_to, label, scope, created_at, updated_at) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?6 WHERE (SELECT COUNT(*) FROM free_days) < ?7 RETURNING id")
      .bind(fid, entry.from, entry.to, entry.label, entry.scope, c.now, FREE_DAYS_MAX));
  const todo = shift ? plans.filter((x) => x.plan) : [];
  const unitsJ = [], lessonsJ = [];
  for (const { u, lessons, plan } of todo) {
    const byRow = new Map(lessons.filter((l) => l.row && !l.cancelled).map((l) => [l.row, l]));
    for (const r of plan.rows.slice(plan.s)) {
      const l = byRow.get(r.uid);
      if (l && (l.date !== (r.date || null) || (r.date && r.time && l.time !== r.time) || (r.date && r.minutes != null && l.minutes !== r.minutes)))
        lessonsJ.push({ id: l.id, d: r.date || null, t: r.time || null, m: r.minutes ?? null });
    }
    const rev = reviseData(u.revise) || { v: 1, open: false, items: [], undated: [], undo: null };
    const item = { id: randomId(4), kind: "free", label: entry.label, from: entry.from, to: entry.to, scope: entry.scope, date: plan.first.date, time: null, minutes: null,
      lessonId: null, placeholderId: null, title: plan.first.title, at: c.now, lengths: plan.lengthChanges.map(({ uid, n, from, to }) => ({ uid, n, from, to })) };
    // Hinweis zum Überarbeiten (roter Kasten der Grundschule, gleichwertiger Hinweis am Gymnasium); „Krankmeldung rückgängig“ gilt danach nicht mehr
    const revise = { v: 1, open: true, items: [...rev.items, item].slice(-30), undated: plan.rows.filter((r) => !r.date).map((r) => r.uid), undo: null };
    unitsJ.push({ id: u.id, v: u.version, rows: JSON.stringify(plan.rows), revise: JSON.stringify(revise) });
  }
  const versions = JSON.stringify(unitsJ.map((x) => ({ id: x.id, v: x.v })));
  /* verschoben wird nur, wenn der Eintrag in diesem Batch wirklich gespeichert ist (erste Anweisung): nicht angelegt (inzwischen 200 Einträge) bzw.
     inzwischen gelöscht → keine Sitzung und keine Einheit wird angefasst */
  const SAVED = "EXISTS(SELECT 1 FROM free_days WHERE id=?4)";
  if (lessonsJ.length) {
    const pick = (k) => "(SELECT json_extract(x.value,'$." + k + "') FROM json_each(?1) x WHERE json_extract(x.value,'$.id')=lessons.id)";
    // Datum, Beginn und Dauer wie die Zeile (ohne Termin: auch ohne Beginn); nur, solange die Einheit noch die gelesene Version hat
    stmts.push(c.db.prepare("UPDATE lessons SET lesson_date=" + pick("d") + ", start_time=CASE WHEN " + pick("d") + " IS NULL THEN NULL ELSE COALESCE(" + pick("t") + ", start_time) END, " +
      "duration_min=COALESCE(" + pick("m") + ", duration_min), updated_at=?2 WHERE id IN (SELECT json_extract(x.value,'$.id') FROM json_each(?1) x) AND cancelled=0 " +
      "AND EXISTS(SELECT 1 FROM units u, json_each(?3) y WHERE u.id=lessons.unit_id AND json_extract(y.value,'$.id')=u.id AND json_extract(y.value,'$.v')=u.version) AND " + SAVED)
      .bind(JSON.stringify(lessonsJ), c.now, versions, fid));
  }
  if (unitsJ.length) {
    const pick = (k) => "(SELECT json_extract(x.value,'$." + k + "') FROM json_each(?1) x WHERE json_extract(x.value,'$.id')=units.id)";
    stmts.push(c.db.prepare("UPDATE units SET rows=" + pick("rows") + ", revise=" + pick("revise") + ", version=version+1, updated_at=?2, source='lehrkraft' " +
      "WHERE EXISTS(SELECT 1 FROM json_each(?1) x WHERE json_extract(x.value,'$.id')=units.id AND json_extract(x.value,'$.v')=units.version) AND " + SAVED.replace("?4", "?3") + " RETURNING id, version")
      .bind(JSON.stringify(unitsJ), c.now, fid));
  }
  const res = await c.db.batch(stmts);
  if (!(res[0].results || []).length) {
    if (old) throw new HttpError(404, "not_found", "Diesen unterrichtsfreien Eintrag gibt es nicht (mehr).");
    throw bad("Höchstens " + FREE_DAYS_MAX + " unterrichtsfreie Einträge – bitte zuerst vergangene löschen.");
  }
  const done = new Set(unitsJ.length ? (res[res.length - 1].results || []).map((x) => x.id) : []);
  const shifted = [], failed = [];
  for (const { u, plan, error } of shift ? plans : []) {
    const w = whoOf(u.subject, u.klass, data.gs), base = { unitId: u.id, title: u.title || "", school: w.school, subject: w.subject, label: w.label };
    if (error) failed.push({ ...base, reason: error });
    else if (!done.has(u.id)) failed.push({ ...base, reason: "Die Einheit wurde inzwischen an anderer Stelle geändert – sie wurde nicht verschoben." });
    else shifted.push({ ...base, moved: plan.moves.length, undated: plan.undatedRows.map(({ n, title }) => ({ n, title })) });
  }
  const noUnit = items.filter((x) => x.kind === "lesson" && x.noUnit);
  const kept = shift ? items.filter((x) => !x.noUnit && !done.has(x.unitId)).length : items.length;
  const all = await c.db.prepare(FREE_DAYS_SQL).all();
  return json({ ok: true, freeDay: { id: fid, ...entry }, freeDays: (all.results || []).map(out), shifted, failed, noUnit, kept });
}

/* DELETE /api/teacher/free-days/<id> – danach sind die Tage wieder Unterrichtstage (für Termine ab jetzt); nichts wird zurückverschoben */
export async function routeFreeDayDelete(c, id) {
  await requireTeacher(c);
  if (!isId(id)) throw new HttpError(404, "not_found", "Diesen unterrichtsfreien Eintrag gibt es nicht (mehr).");
  const r = await c.db.prepare("DELETE FROM free_days WHERE id=?1 RETURNING id").bind(id).all();
  if (!(r.results || []).length) throw new HttpError(404, "not_found", "Diesen unterrichtsfreien Eintrag gibt es nicht (mehr).");
  return json({ ok: true });
}

/* Datum, das die Lehrkraft (bzw. Claude) direkt setzt: auf einem unterrichtsfreien Tag der Schule → 400 mit klarer Meldung. fd = Einträge
   (sonst geladen). Gibt die Einträge zurück (für weitere Prüfungen). */
export async function assertNotFree(db, date, subject, fd = null, prefix = "") {
  const list = fd || (await loadFreeDays(db));
  const msg = freeDateError(date, list, subject);
  if (msg) { const f = freeDayOn(date, list, schoolOf(subject)); throw new HttpError(400, "free_day", prefix + msg, { freeDay: { from: f.from, to: f.to, label: f.label, scope: f.scope } }); }
  return list;
}
