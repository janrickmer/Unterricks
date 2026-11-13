// Krankmeldung in der Grundschule (Slice S9, Anforderung 9): Stunden rücken um einen Termin nach hinten, die letzte bleibt ohne Datum,
// Ausfall-Eintrag mit dem Elternlink, roter Kasten, Rückgängig, Überarbeitung mit Claude (save_unit_plan mit uid) – Beispiele aus §8.2
// der Spezifikation als reine Funktionen, dazu die Routen des Workers mit der D1-Nachbildung aus fake-d1.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const P = await import("../../public/planning.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const GS = await import("../../worker/gs.js");
const U = await import("../../worker/units.js");
const L = await import("../../worker/lessons.js");
const F = await import("../../worker/files.js");
const PA = await import("../../worker/parents.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");
const { claudeUnitRevisionPrompt } = await import("../../public/gsplanning.js");

/* ---------- reine Funktionen (public/planning.js) ---------- */
const TT = [{ day: 2, minutes: 45, time: "08:00" }, { day: 4, minutes: 45, time: "08:00" }];   // Di/Do 08:00
const DATES = ["2026-11-03", "2026-11-05", "2026-11-10", "2026-11-12", "2026-11-17", "2026-11-19"];
const UIDS = ["a1a1a1a1", "b2b2b2b2", "c3c3c3c3", "d4d4d4d4", "e5e5e5e5", "f6f6f6f6"];
const base = (end = "2026-11-19", extra = {}) => ({ start: "2026-11-03", end, weekdays: TT, breaks: [], ...extra });
const mkRows = (dates = DATES) => dates.map((d, i) => ({ uid: UIDS[i], stundenfrage: "Stunde " + (i + 1), ablauf: [], schritt: null, date: d, time: d ? "08:00" : null, minutes: 45 }));
const mkLessons = (rows) => rows.map((r, i) => ({ id: "L" + (i + 1), title: r.stundenfrage, date: r.date, time: r.time, row: r.uid, minutes: r.minutes, cancelled: false }));
const at = (s) => Date.parse(s);
const dates = (rows) => rows.map((r) => r.date);

test("normalizeParams: ausgefallene Termine nur, wenn es welche gibt (Gymnasium unverändert); computeSlots lässt sie aus; paramsText", () => {
  const p = { start: "2026-11-02", end: "2026-11-06", exam: null, weekdays: [{ day: 1, minutes: 45, time: null }], breaks: [], notes: "" };
  assert.deepEqual(P.normalizeParams(p), p, "ohne cancelled: kein Schlüssel");
  assert.deepEqual(P.normalizeParams({ ...p, cancelled: [] }), p, "leere Liste: kein Schlüssel");
  const c = P.normalizeParams({ ...p, cancelled: [{ date: "2026-11-02", time: "08:00" }, { date: "kaputt" }, { date: "2026-11-03", time: "25:00" }, null] });
  assert.deepEqual(c.cancelled, [{ date: "2026-11-02", time: "08:00" }, { date: "2026-11-03", time: null }]);
  assert.equal(P.normalizeParams({ ...p, cancelled: Array.from({ length: 80 }, () => ({ date: "2026-11-02" })) }).cancelled.length, 60);
  // computeSlots: nur der ausgefallene Termin (gleicher Tag, gleiche Uhrzeit bzw. ohne Uhrzeit der ganze Tag)
  const two = { start: "2026-11-02", end: "2026-11-09", weekdays: [{ day: 1, minutes: 45, time: "08:00" }, { day: 1, minutes: 45, time: "10:00" }] };
  assert.deepEqual(P.computeSlots({ ...two, cancelled: [{ date: "2026-11-02", time: "08:00" }] }).map((s) => s.date + " " + s.time), ["2026-11-02 10:00", "2026-11-09 08:00", "2026-11-09 10:00"]);
  assert.deepEqual(P.computeSlots({ ...two, cancelled: [{ date: "2026-11-02", time: null }] }).map((s) => s.date + " " + s.time), ["2026-11-09 08:00", "2026-11-09 10:00"]);
  // paramsText: ohne Ausfälle unverändert, mit einer Zeile
  const txt = P.paramsText(base());
  assert.ok(txt.includes("Klausurtermin: keiner angegeben") && !txt.includes("Ausgefallene"));
  assert.ok(P.paramsText(base("2026-11-19", { cancelled: [{ date: "2026-11-10", time: "08:00" }] }), { exam: false }).endsWith("Ausgefallene Termine (Krankmeldung): Di, 10.11.2026 08:00"));
});

test("weekSchedule: ausgefallener Termin als „Unterricht ausgefallen“ (Grundschule), sonst unverändert", () => {
  const course = { id: "gs1a2b3c4d", short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)" };
  const u = { id: "u1", subject: "gs", klass: course.id, title: "Josef", course, params: base("2026-11-19", { cancelled: [{ date: "2026-11-10", time: "08:00" }] }) };
  const w = P.weekSchedule([u], "2026-11-09");
  const tue = w.days[1], thu = w.days[3];
  assert.equal(tue.timed.length, 0);
  assert.deepEqual(tue.off.map((o) => o.subjectShort + " " + o.label + " (" + o.reason + ")"), ["Grundschule Religion 2ab (Unterricht ausgefallen)"]);
  assert.equal(thu.timed.length, 1);
  assert.equal(thu.off.length, 0);
  // ohne Ausfall: wie bisher
  const w2 = P.weekSchedule([{ ...u, params: base() }], "2026-11-09");
  assert.equal(w2.days[1].timed.length, 1);
  assert.equal(w2.days[1].off.length, 0);
});

test("packFrom/occupy: Zeilen ohne Uhrzeit belegen einen Termin des Tages; freie Termine nach dem Drehpunkt", () => {
  const slots = P.sortSlots([{ date: "2026-11-05", time: "10:00", minutes: 45 }, { date: "2026-11-05", time: "08:00", minutes: 90 }, { date: "2026-11-03", time: null, minutes: 45 }]);
  assert.deepEqual(slots.map((s) => s.date + (s.time || "")), ["2026-11-03", "2026-11-0508:00", "2026-11-0510:00"]);
  const rows = [{ uid: "a", date: "2026-11-05", time: null, minutes: 45 }, { uid: "b", date: null, time: null, minutes: 45 }, { uid: "c", date: null, time: null, minutes: 30 }];
  assert.deepEqual([...P.occupy(slots, rows.slice(0, 1))], [1], "ohne Uhrzeit: der erste Termin des Tages");
  const out = P.packFrom(rows, slots, 1, null);
  assert.deepEqual(out.map((r) => [r.date, r.time, r.minutes]), [["2026-11-05", null, 45], ["2026-11-03", null, 45], ["2026-11-05", "10:00", 45]]);
  const out2 = P.packFrom(rows, slots, 1, { date: "2026-11-05", time: "08:00" });
  assert.deepEqual(out2.map((r) => [r.date, r.time, r.minutes]), [["2026-11-05", null, 45], ["2026-11-05", "10:00", 45], [null, null, 30]], "nach dem Drehpunkt; fehlt ein Termin: ohne Datum, Länge bleibt");
});

test("§8.2 Beispiel 1: Krankmeldung Di 10.11. – R3→Do 12., R4→Di 17., R5→Do 19., R6 ohne Termin", () => {
  const rows = mkRows(), lessons = mkLessons(rows);
  const r = P.planCancellation({ params: base(), rows, lessons, lessonId: "L3", now: at("2026-11-09T12:00:00Z") });
  assert.deepEqual(dates(r.rows), ["2026-11-03", "2026-11-05", "2026-11-12", "2026-11-17", "2026-11-19", null]);
  assert.deepEqual(r.undated, ["f6f6f6f6"]);
  assert.deepEqual(r.params.cancelled, [{ date: "2026-11-10", time: "08:00" }]);
  assert.deepEqual(r.cancelled, { date: "2026-11-10", time: "08:00", minutes: 45 });
  assert.deepEqual(r.moves.map((m) => [m.n, m.lessonId, m.from.date, m.to && m.to.date]), [[3, "L3", "2026-11-10", "2026-11-12"], [4, "L4", "2026-11-12", "2026-11-17"], [5, "L5", "2026-11-17", "2026-11-19"], [6, "L6", "2026-11-19", null]]);
  assert.deepEqual(r.lengthChanges, []);
  assert.equal(r.s, 2);
  // die ausgefallene Stunde darf schon vorbei sein (Krankmeldung im Nachhinein), solange die folgenden noch ausstehen
  assert.deepEqual(dates(P.planCancellation({ params: base(), rows, lessons, lessonId: "L3", now: at("2026-11-11T12:00:00Z") }).rows), dates(r.rows));
});

test("§8.2 Beispiel 2: zweite Krankmeldung Di 17.11. – R4→Do 19., R5 und R6 ohne Termin", () => {
  const rows0 = mkRows(), lessons0 = mkLessons(rows0);
  const r1 = P.planCancellation({ params: base(), rows: rows0, lessons: lessons0, lessonId: "L3", now: at("2026-11-09T12:00:00Z") });
  const lessons1 = lessons0.map((l) => { const x = r1.rows.find((y) => y.uid === l.row); return { ...l, date: x.date, time: x.time, minutes: x.minutes }; });
  assert.equal(lessons1.find((l) => l.id === "L4").date, "2026-11-17");
  const r2 = P.planCancellation({ params: r1.params, rows: r1.rows, lessons: lessons1, lessonId: "L4", now: at("2026-11-13T12:00:00Z") });
  assert.deepEqual(dates(r2.rows), ["2026-11-03", "2026-11-05", "2026-11-12", "2026-11-19", null, null]);
  assert.deepEqual(r2.undated, ["e5e5e5e5", "f6f6f6f6"]);
  assert.deepEqual(r2.params.cancelled, [{ date: "2026-11-10", time: "08:00" }, { date: "2026-11-17", time: "08:00" }]);
  assert.deepEqual(r2.undatedRows.map((x) => x.n), [5, 6]);
  assert.ok(!r2.moves.some((m) => m.uid === "f6f6f6f6"), "R6 war schon ohne Termin – keine Änderung");
});

test("§8.2 Beispiel 3: freier Termin am Ende (bis 24.11.) – nichts bleibt ohne Termin", () => {
  const rows = mkRows(), lessons = mkLessons(rows);
  const r = P.planCancellation({ params: base("2026-11-24"), rows, lessons, lessonId: "L3", now: at("2026-11-09T12:00:00Z") });
  assert.deepEqual(dates(r.rows), ["2026-11-03", "2026-11-05", "2026-11-12", "2026-11-17", "2026-11-19", "2026-11-24"]);
  assert.deepEqual(r.undated, []);
});

test("§8.2 Beispiel 4: unterschiedliche Längen (Mo 90, Mi 45) – die Stunde nimmt die Länge des neuen Termins an", () => {
  const params = { start: "2026-11-02", end: "2026-11-16", weekdays: [{ day: 1, minutes: 90, time: "08:00" }, { day: 3, minutes: 45, time: "10:00" }] };
  const rows = [["2026-11-02", "08:00", 90], ["2026-11-04", "10:00", 45], ["2026-11-09", "08:00", 90], ["2026-11-11", "10:00", 45]]
    .map(([date, time, minutes], i) => ({ uid: UIDS[i], stundenfrage: "S" + (i + 1), ablauf: [], schritt: null, date, time, minutes }));
  const r = P.planCancellation({ params, rows, lessons: mkLessons(rows), lessonId: "L3", now: at("2026-11-08T12:00:00Z") });
  assert.deepEqual(r.rows.slice(2).map((x) => [x.date, x.time, x.minutes]), [["2026-11-11", "10:00", 45], ["2026-11-16", "08:00", 90]]);
  assert.deepEqual(r.lengthChanges.map((g) => [g.uid, g.n, g.from, g.to]), [["c3c3c3c3", 3, 90, 45], ["d4d4d4d4", 4, 45, 90]]);
});

test("§8.2 Beispiel 5: zwei Stunden am selben Tag – nur 08:00 fällt aus, die nächste Stunde rückt auf 10:00 desselben Tages", () => {
  const params = { start: "2026-11-02", end: "2026-11-16", weekdays: [{ day: 1, minutes: 45, time: "08:00" }, { day: 1, minutes: 45, time: "10:00" }] };
  const rows = [["2026-11-02", "08:00"], ["2026-11-02", "10:00"], ["2026-11-09", "08:00"], ["2026-11-09", "10:00"]]
    .map(([date, time], i) => ({ uid: UIDS[i], stundenfrage: "S" + (i + 1), ablauf: [], schritt: null, date, time, minutes: 45 }));
  const r = P.planCancellation({ params, rows, lessons: mkLessons(rows), lessonId: "L3", now: at("2026-11-08T12:00:00Z") });
  assert.deepEqual(r.rows.slice(2).map((x) => x.date + " " + x.time), ["2026-11-09 10:00", "2026-11-16 08:00"]);
  assert.deepEqual(r.params.cancelled, [{ date: "2026-11-09", time: "08:00" }]);
});

test("§8.2 Beispiel 6: Krankmeldung für den 03.11. erst am 12.11. – L2 (05.11.) hat schon stattgefunden → already_held", () => {
  const rows = mkRows(), lessons = mkLessons(rows);
  assert.throws(() => P.planCancellation({ params: base(), rows, lessons, lessonId: "L1", now: at("2026-11-12T10:00:00Z") }),
    (e) => e.code === "already_held" && e.status === 409 && e.message === "Die Stunde „Stunde 2“ am Do, 05.11.2026 hat schon stattgefunden – verschieben lässt sich nur, solange die folgenden Stunden noch ausstehen.");
  assert.throws(() => P.planCancellation({ params: base(), rows, lessons: lessons.map((l) => (l.id === "L3" ? { ...l, cancelled: true } : l)), lessonId: "L3" }), (e) => e.code === "already_cancelled");
  assert.throws(() => P.planCancellation({ params: base(), rows, lessons: lessons.map((l) => (l.id === "L3" ? { ...l, date: null } : l)), lessonId: "L3" }), (e) => e.code === "no_date");
  assert.throws(() => P.planCancellation({ params: base("2026-11-19", { cancelled: Array.from({ length: 60 }, (_, i) => ({ date: "2026-12-" + String(i % 28 + 1).padStart(2, "0") })) }), rows, lessons, lessonId: "L3", now: 0 }),
    (e) => e.code === "too_many");
});

test("repackFuture und freeSlots: alles nach der letzten gehaltenen Stunde neu verteilt", () => {
  const params = base("2026-11-24", { cancelled: [{ date: "2026-11-10", time: "08:00" }] });
  // nach Beispiel 1 mit verlängertem Ende: R6 ohne Termin; Claude hat R5 gestrichen (Zeilen R1–R4, R6)
  const rows = mkRows(["2026-11-03", "2026-11-05", "2026-11-12", "2026-11-17", "2026-11-19", null]).filter((r) => r.uid !== "e5e5e5e5");
  const lessons = mkLessons(rows);
  const out = P.repackFuture({ params, rows, lessons, now: at("2026-11-13T12:00:00Z") });
  assert.deepEqual(dates(out), ["2026-11-03", "2026-11-05", "2026-11-12", "2026-11-17", "2026-11-19"], "R1–R3 gehalten, R4 bleibt, R6 rückt auf den 19.");
  assert.deepEqual(P.freeSlots(params, out, at("2026-11-13T12:00:00Z")).map((s) => s.date), ["2026-11-24"]);
  // eine Zeile ohne Sitzung, deren Datum vor heute liegt, gilt als gehalten
  const noL = P.repackFuture({ params, rows, lessons: [], now: at("2026-11-13T12:00:00Z") });
  assert.deepEqual(dates(noL).slice(0, 3), ["2026-11-03", "2026-11-05", "2026-11-12"]);
});

test("Verschieben nie in die Vergangenheit: freie Termine, die schon vorbei sind, bleiben leer (Prüfung S9)", () => {
  // Überarbeitung: L1 gehalten, L2 von Hand vom 05.11. auf den 12.11. gelegt – der freie 05.11. und der 10.11. (schon vorbei) werden nicht vergeben
  const params = base("2026-11-19");
  const rows = mkRows(["2026-11-03", "2026-11-12", "2026-11-17", "2026-11-19"]);
  const out = P.repackFuture({ params, rows, lessons: mkLessons(rows), now: at("2026-11-10T11:00:00Z") });
  assert.deepEqual(dates(out), ["2026-11-03", "2026-11-12", "2026-11-17", "2026-11-19"]);
  assert.deepEqual(P.freeSlots(params, out, at("2026-11-10T11:00:00Z")).map((x) => x.date), [], "der 10.11. 08:00 ist vorbei, der 05.11. auch");
  assert.deepEqual(P.freeSlots(params, out, at("2026-11-10T06:00:00Z")).map((x) => x.date), ["2026-11-10"], "vor dem Ende des Termins noch frei");
  // Krankmeldung im Nachhinein (Mo 08:00, gemeldet um 12:00): die zweite Stunde desselben Tages (10:00) ist schon vorbei
  const two = { start: "2026-11-02", end: "2026-11-16", weekdays: [{ day: 1, minutes: 45, time: "08:00" }, { day: 1, minutes: 45, time: "10:00" }] };
  const r4 = [["2026-11-02", "08:00"], ["2026-11-02", "10:00"], ["2026-11-09", "08:00"], ["2026-11-09", "10:00"]]
    .map(([date, time], i) => ({ uid: UIDS[i], stundenfrage: "S" + (i + 1), ablauf: [], schritt: null, date, time, minutes: 45 }));
  const r = P.planCancellation({ params: two, rows: r4, lessons: mkLessons(r4).slice(0, 3), lessonId: "L3", now: at("2026-11-09T11:00:00Z") });
  assert.deepEqual(r.rows.slice(2).map((x) => x.date + " " + x.time), ["2026-11-16 08:00", "2026-11-16 10:00"]);
});

/* ---------- Worker: Routen, Ausfall-Eintrag, Elternlink, Rückgängig, Connector ---------- */
const TOKEN = "lehrkraft-token-123";
const NOW = at("2026-11-02T10:00:00Z");   // Montag vor der Einheit
const call = async (c, fn, method, path, body, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method, headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code, ...(e.extra || {}) } }; }
};
const pub = async (c, fn, body) => {
  const req = new Request("https://unterricks.test/api/eltern/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "9.8.7.6", waitUntil: () => {} }); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code } }; }
};
async function mcp(c, name, args) {
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const r = await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json();
  return { text: r.result.content[0].text, isError: !!r.result.isError, data: r.result.structuredContent };
}
async function setup({ end = "2026-11-19" } = {}) {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = NOW;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 30 * 86400e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", { grade: 2, classes: ["a", "b"], religion: true, weekdays: TT, classSize: 22 })).data.course;
  const unit = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "gs", klass: course.id, title: "Josef", params: base(end) })).data.unit;
  const rows = mkRows().map((r) => ({ ...r, date: null, time: null, minutes: null }));
  let u = (await call(c, U.routeUnitPatch, "PATCH", "/x", { plan: { lernaufgabe: "Bodenbild", schritte: [{ titel: "A", beschreibung: "B" }] }, rows, assignDates: true }, unit.id)).data.unit;
  const made = await call(c, U.routeUnitSessions, "POST", "/x", undefined, unit.id);
  assert.equal(made.data.created, 6);
  u = made.data.unit;
  const byRow = new Map(u.lessons.map((l) => [l.row, l.id]));
  return { c, course, unitId: unit.id, ids: u.rows.map((r) => byRow.get(r.uid)), uids: u.rows.map((r) => r.uid) };
}
const lessonRow = (c, id) => c.db.prepare("SELECT * FROM lessons WHERE id=?1").bind(id).first();
const unitGet = async (c, id) => (await call(c, U.routeUnitGet, "GET", "/x", undefined, id)).data.unit;

test("Route Krankmeldung: Vorschau, ausführen (ein Batch), Ausfall-Eintrag mit dem Elternlink, roter Kasten, Kalender, Eltern", async () => {
  const { c, course, unitId, ids, uids } = await setup();
  const tok = (await call(c, PA.routeTeacherParentLink, "POST", "/x", {}, ids[2])).data.token;
  const sek = await L.createLesson(c.db, { subject: "powi", klass: "8B", title: "Gewaltenteilung", date: "2026-11-10" }, c.now);
  assert.equal((await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, sek.id)).data.code, "not_gs");
  const pre = await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2]);
  assert.equal(pre.status, 200);
  assert.deepEqual(pre.data.plan.moves.map((m) => [m.n, m.lessonId, m.to && m.to.date]), [[3, ids[2], "2026-11-12"], [4, ids[3], "2026-11-17"], [5, ids[4], "2026-11-19"], [6, ids[5], null]]);
  assert.deepEqual(pre.data.plan.undatedRows.map((x) => x.title), ["Stunde 6"]);
  assert.equal((await unitGet(c, unitId)).version, pre.data.version, "die Vorschau ändert nichts");
  // veraltete Version → 409, nichts geändert
  assert.equal((await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.data.version - 1 }, ids[2])).data.code, "unit_conflict");
  c.db.counter.n = 0;
  const r = await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.data.version }, ids[2]);
  assert.equal(r.status, 200);
  assert.ok(c.db.counter.n <= 13, "D1-Anweisungen der Krankmeldung: " + c.db.counter.n);   // Batch mit 5 Anweisungen (der Elternlink wandert in der Datenbank, F02)
  const P1 = r.data.placeholderId;
  // Sitzungen: Datum wandert mit, die letzte ohne Termin; Ausfall-Eintrag am alten Termin
  const got = await Promise.all(ids.map((id) => lessonRow(c, id)));
  assert.deepEqual(got.map((l) => l.lesson_date), ["2026-11-03", "2026-11-05", "2026-11-12", "2026-11-17", "2026-11-19", null]);
  const ph = await lessonRow(c, P1);
  assert.deepEqual([ph.cancelled, ph.unit_id, ph.unit_row, ph.lesson_date, ph.start_time, ph.duration_min, ph.title, ph.subject, ph.klass], [1, unitId, null, "2026-11-10", "08:00", 45, "Unterricht ausgefallen", "gs", course.id]);
  // Elternlink: gehört jetzt zum Ausfall-Eintrag; die verschobene Sitzung hat keinen mehr
  assert.equal(got[2].parent_hash, null);
  assert.equal(ph.parent_hash, await PA.parentHash(tok));
  const u = r.data.unit;
  assert.deepEqual(u.params.cancelled, [{ date: "2026-11-10", time: "08:00" }]);
  assert.equal(u.revise.open, true);
  assert.equal(u.revise.canUndo, true);
  assert.deepEqual(u.revise.undated, [uids[5]]);
  assert.deepEqual([u.revise.items[0].date, u.revise.items[0].lessonId, u.revise.items[0].placeholderId, u.revise.items[0].title], ["2026-11-10", ids[2], P1, "Stunde 3"]);
  assert.ok(!JSON.stringify(u).includes('"rows":[{"uid"' + "x") && !("undo" in u.revise), "nie der Schnappschuss nach außen");
  assert.ok(u.lessons.find((l) => l.id === P1).cancelled);
  // Eltern: nach dem alten Termin „ausgefallen“, vorher „noch nicht stattgefunden“
  c.now = at("2026-11-10T07:00:00Z");
  assert.equal((await pub(c, PA.routeParentLesson, { token: tok })).data.state, "pending");
  c.now = at("2026-11-10T09:00:00Z");
  const pv = (await pub(c, PA.routeParentLesson, { token: tok })).data;
  assert.equal(pv.state, "cancelled");
  assert.ok(!JSON.stringify(pv).includes("krank"));
  // Kalender: ausgefallener Termin bleibt in den Rahmendaten
  const sch = (await call(c, U.routeSchedule, "GET", "/x")).data.units.find((x) => x.id === unitId);
  assert.deepEqual(sch.params.cancelled, [{ date: "2026-11-10", time: "08:00" }]);
  // vorige Sitzung / nächster Termin ignorieren Ausfall-Einträge
  assert.equal((await L.previousLesson(c.db, got[3])).id, ids[2], "vor dem 17.11. liegt die verschobene Stunde (12.11.), nicht der Ausfall-Eintrag");
  assert.equal(await L.nextLessonDate(c.db, got[1]), "2026-11-12");
  // Ausfall-Eintrag: kein Material, nur der Hinweis für die Eltern
  assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { title: "x" }, P1)).status, 400);
  assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { parentNote: "Bitte üben." }, P1)).status, 200);
  assert.equal((await call(c, F.routeLinkCreate, "POST", "/x", { area: "student", title: "a", url: "https://example.org" }, P1)).data.error, "Für einen Ausfall-Eintrag gibt es kein Material.");
  assert.equal((await mcp(c, "add_text_material", { lesson_id: P1, bereich: "schueler", titel: "x", markdown: "y" })).isError, true);
  assert.equal((await mcp(c, "save_verlaufsplan", { lesson_id: P1, text: "**1) x**" })).isError, true);
  // nochmals ausfallen lassen: der Ausfall-Eintrag selbst nicht, eine Sitzung ohne Termin auch nicht
  assert.equal((await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, P1)).data.code, "already_cancelled");
  assert.equal((await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[5])).data.code, "no_date");
  // Rahmendaten speichern (ohne cancelled im Rumpf): der Ausfall bleibt
  const pp = await call(c, U.routeUnitPatch, "PATCH", "/x", { params: base("2026-11-24") }, unitId);
  assert.deepEqual(pp.data.unit.params.cancelled, [{ date: "2026-11-10", time: "08:00" }]);
  assert.equal(pp.data.unit.revise.canUndo, false, "nach einer Änderung lässt sich die Krankmeldung nicht mehr zurücknehmen");
  assert.equal((await call(c, GS.routeCancelUndo, "POST", "/x", { undoId: u.revise.undoId }, unitId)).data.code, "undo_stale");
  // „Erledigt – Hinweis entfernen“
  const done = await call(c, U.routeUnitPatch, "PATCH", "/x", { reviseDone: true }, unitId);
  assert.equal(done.data.unit.revise.open, false);
  // Einheit mit Ausfall-Eintrag: zählt nicht als Sitzung beim Löschen
  await c.db.prepare("DELETE FROM lessons WHERE unit_id=?1 AND cancelled=0").bind(unitId).run();
  const del = await call(c, U.routeUnitDelete, "DELETE", "/x", undefined, unitId);
  assert.equal(del.status, 200);
  assert.equal(await lessonRow(c, P1), null, "Ausfall-Eintrag mit der Einheit gelöscht");
});

test("Krankmeldung rückgängig: Termine wie vorher, Ausfall-Eintrag weg, Elternlink zurück; zweite Krankmeldung", async () => {
  const { c, unitId, ids } = await setup();
  const tok = (await call(c, PA.routeTeacherParentLink, "POST", "/x", {}, ids[2])).data.token;
  const before = await unitGet(c, unitId);
  const v = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  const r = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: v }, ids[2])).data;
  assert.equal((await call(c, GS.routeCancelUndo, "POST", "/x", { undoId: "ffffffff" }, unitId)).data.code, "undo_stale");
  const und = await call(c, GS.routeCancelUndo, "POST", "/x", { undoId: r.unit.revise.undoId }, unitId);
  assert.equal(und.status, 200);
  assert.deepEqual(und.data.unit.rows.map((x) => [x.date, x.time, x.minutes]), before.rows.map((x) => [x.date, x.time, x.minutes]));
  assert.ok(!("cancelled" in und.data.unit.params) && !("revise" in und.data.unit), "keine Ausfälle, kein Kasten");
  assert.equal(await lessonRow(c, r.placeholderId), null);
  assert.deepEqual((await Promise.all(ids.map((id) => lessonRow(c, id)))).map((l) => l.lesson_date), DATES);
  assert.equal((await lessonRow(c, ids[2])).parent_hash, await PA.parentHash(tok), "der Elternlink gehört wieder zur Sitzung");
  // zweimal krank (Beispiel 2): 10.11. und – nach dem Verschieben – 17.11.
  let pre = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data;
  await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.version }, ids[2]);
  pre = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[3])).data;
  const r2 = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.version }, ids[3])).data;
  assert.deepEqual((await Promise.all(ids.map((id) => lessonRow(c, id)))).map((l) => l.lesson_date), ["2026-11-03", "2026-11-05", "2026-11-12", "2026-11-19", null, null]);
  assert.equal(r2.unit.revise.items.length, 2);
  assert.equal(r2.unit.lessons.filter((l) => l.cancelled).length, 2);
  // rückgängig nur die letzte: der erste Ausfall bleibt, der Kasten auch
  const u2 = (await call(c, GS.routeCancelUndo, "POST", "/x", { undoId: r2.unit.revise.undoId }, unitId)).data.unit;
  assert.deepEqual(u2.params.cancelled, [{ date: "2026-11-10", time: "08:00" }]);
  assert.equal(u2.revise.open, true);
  assert.equal(u2.revise.items.length, 1);
  assert.equal(u2.revise.canUndo, false);
});

test("Connector: get_unit mit Ausfällen, freien Terminen, „Muss überarbeitet werden“; save_unit_plan mit uid; update_unit_row per uid; Prompt", async () => {
  const { c, unitId, ids, uids } = await setup();
  const v = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  await call(c, GS.routeLessonCancel, "POST", "/x", { version: v }, ids[2]);
  // Ende verlängern: ein Termin frei (24.11.)
  await call(c, U.routeUnitPatch, "PATCH", "/x", { params: base("2026-11-24") }, unitId);
  let g = await mcp(c, "get_unit", { unit_id: unitId });
  assert.ok(g.text.includes("## Ausfälle\n- Di, 10.11.2026 08:00: Unterricht ausgefallen (Lehrkraft krank) – „Stunde 3“ und alle folgenden Stunden sind um einen Termin nach hinten gerückt."), g.text);
  assert.ok(g.text.includes("6. [uid " + uids[5] + "] [ohne Termin]") && g.text.includes("Stunden ohne Termin: Stunde 6 „Stunde 6“ [uid " + uids[5] + "]"));
  assert.ok(g.text.includes("Noch freie Termine bis zum Ende der Einheit: Di, 24.11.2026 08:00 (45 min)") && g.text.includes("Muss überarbeitet werden: ja"));
  assert.ok(g.text.includes("(ausgefallen – Ausfall-Eintrag für die Eltern)") && g.text.includes("Ausgefallene Termine (Krankmeldung): Di, 10.11.2026 08:00"));
  // get_lesson einer Sitzung der Einheit nennt die Ausfälle und den roten Hinweis (Prüfung S9)
  const gl = await mcp(c, "get_lesson", { lesson_id: ids[3] });
  assert.ok(gl.text.includes("Ausgefallen (Lehrkraft krank): Di, 10.11.2026 08:00 – die Stunden sind um je einen Termin nach hinten gerückt. Die Einheit muss deshalb überarbeitet werden"), gl.text);
  // Überarbeitung: Stunde 5 (leer) gestrichen, Stunde 4 bekommt Material → darf nicht wegfallen
  await call(c, L.routeLessonPatch, "PATCH", "/x", { parentSummary: "Wir haben gemalt." }, ids[3]);
  const unit = await unitGet(c, unitId);
  const stunden = unit.rows.map((r) => ({ uid: r.uid, stundenfrage: r.stundenfrage, ablauf: ["x"] }));
  let s = await mcp(c, "save_unit_plan", { unit_id: unitId, base_version: unit.version, plan: unit.plan, stunden: stunden.filter((x) => x.uid !== uids[3]) });
  assert.ok(s.isError && s.text.startsWith("Diese Stunden haben schon geplante Sitzungen und müssen mit ihrer uid erhalten bleiben") && s.text.includes(uids[3]), s.text);
  assert.equal((await unitGet(c, unitId)).version, unit.version, "abgelehnt: nichts geändert");
  s = await mcp(c, "save_unit_plan", { unit_id: unitId, base_version: unit.version, plan: unit.plan, stunden: stunden.filter((x) => x.uid !== uids[4]).concat([{ stundenfrage: "Neu: Fest", ablauf: ["Feier"] }]) });
  assert.ok(!s.isError, s.text);
  assert.ok(s.text.includes("Termine neu verteilt: Stunde 5 „Stunde 6“ → Do, 19.11.2026 08:00") && s.text.includes("Ohne Termin: keine.") && s.text.includes("Eine leere Sitzung einer weggefallenen Stunde wurde gelöscht.")
    && s.text.includes("Der rote Hinweis in der Einheit ist entfernt."), s.text);
  const u2 = await unitGet(c, unitId);
  assert.deepEqual(u2.rows.map((r) => r.date), ["2026-11-03", "2026-11-05", "2026-11-12", "2026-11-17", "2026-11-19", "2026-11-24"]);
  assert.equal(u2.rows[5].stundenfrage, "Neu: Fest");
  assert.equal(u2.revise.open, false);
  assert.equal(await lessonRow(c, ids[4]), null, "leere Sitzung der gestrichenen Stunde gelöscht");
  assert.equal((await lessonRow(c, ids[5])).lesson_date, "2026-11-19", "die Sitzung ohne Termin bekommt den freien Termin");
  assert.equal((await lessonRow(c, ids[3])).parent_summary, "Wir haben gemalt.");
  // update_unit_row per unit_id + uid (Stunde ohne Sitzung)
  const neu = u2.rows[5].uid;
  const up = await mcp(c, "update_unit_row", { unit_id: unitId, uid: neu, stundenfrage: "Abschlussfest" });
  assert.ok(!up.isError && up.text === "In der Einheit festgehalten: Abschlussfest");
  assert.ok((await mcp(c, "update_unit_row", { stundenfrage: "x" })).isError);
  // Gymnasium: ohne uid wie bisher (nach Position)
  const sek = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "powi", klass: "8B", title: "Wahlen" })).data.unit;
  const sp = await mcp(c, "save_unit_plan", { unit_id: sek.id, plan: { lernaufgabe: "x", schritte: [] }, stunden: [{ stundenfrage: "a", ablauf: ["b"] }] });
  assert.equal(sp.text, "Plan gespeichert (Version 1, 1 Stunden). Die Lehrkraft prüft ihn in der Plattform und legt dort die Sitzungen an.");
  // Prompt zum Überarbeiten (roter Kasten): uid, „ohne Termin“, freie Termine, geänderte Längen
  const { c: c2, unitId: u3, ids: i3 } = await setup();
  const v3 = (await call(c2, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, i3[2])).data.version;
  const full = (await call(c2, GS.routeLessonCancel, "POST", "/x", { version: v3 }, i3[2])).data.unit;
  const prompt = claudeUnitRevisionPrompt({ unit: full, now: NOW });
  assert.ok(prompt.includes("Wegen Ausfällen (Lehrkraft krank: Di, 10.11.2026 08:00)") && prompt.includes("[uid " + full.rows[5].uid + "] ohne Termin") && prompt.includes("Noch freie Termine bis zum Ende der Einheit: keine")
    && prompt.includes("`save_unit_plan`") && prompt.includes("`uid`") && prompt.includes("Ende der Einheit am Do, 19.11.2026") && prompt.includes("Sitzung " + i3[2]), prompt);
  assert.ok(!prompt.includes("Gymnasium"));
  void u3;
});

test("Krankmeldung: Guard already_held mit echter Uhr; Einheit festlegen überspringt Stunden ohne Termin", async () => {
  const { c, unitId, ids } = await setup();
  c.now = at("2026-11-12T10:00:00Z");
  const r = await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[0]);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, "already_held");
  c.now = NOW;
  // neue Stunde ohne Termin: „Einheit festlegen“ legt dafür keine Sitzung an (skipped)
  const u = await unitGet(c, unitId);
  await call(c, U.routeUnitPatch, "PATCH", "/x", { rows: [...u.rows, { stundenfrage: "Zusatz", ablauf: [] }] }, unitId);
  const s = await call(c, U.routeUnitSessions, "POST", "/x", undefined, unitId);
  assert.deepEqual([s.status, s.data.created, s.data.skipped], [200, 0, 1]);
});

/* ---------- Abschlussprüfung Gruppe A (F02–F08, F17) ---------- */
const NOW9 = at("2026-11-09T12:00:00Z");
test("F04: die Krankmeldung trifft den Termin laut Stundenplan – auch bei von Hand geändertem Beginn oder später geänderter Uhrzeit", () => {
  const withTime = (t) => mkRows().map((r, i) => (i === 2 ? { ...r, time: t } : r));
  // Beginn 07:50 statt 08:00: der Termin 08:00 fällt aus, die Stunde rückt auf den nächsten Termin (nicht auf 08:00 desselben Tages)
  let rows = withTime("07:50");
  const c1 = P.planCancellation({ params: base(), rows, lessons: mkLessons(rows), lessonId: "L3", now: NOW9 });
  assert.deepEqual(c1.params.cancelled, [{ date: "2026-11-10", time: "08:00" }]);
  assert.deepEqual(c1.slot, { date: "2026-11-10", time: "08:00" });
  assert.deepEqual(dates(c1.rows), ["2026-11-03", "2026-11-05", "2026-11-12", "2026-11-17", "2026-11-19", null]);
  assert.deepEqual(c1.cancelled, { date: "2026-11-10", time: "07:50", minutes: 45 }, "die Vorschau nennt die Sitzung selbst");
  // Beginn 08:15: der ausgefallene Termin taucht nicht als freier Termin auf, Claudes Überarbeitung belegt ihn nicht wieder
  rows = withTime("08:15");
  const c2 = P.planCancellation({ params: base(), rows, lessons: mkLessons(rows), lessonId: "L3", now: NOW9 });
  assert.deepEqual(c2.params.cancelled, [{ date: "2026-11-10", time: "08:00" }]);
  assert.ok(!P.freeSlots({ ...c2.params, end: "2026-11-24" }, c2.rows, NOW9).some((s) => s.date === "2026-11-10"));
  const rp = P.repackFuture({ params: { ...c2.params, end: "2026-11-24" }, rows: c2.rows, lessons: mkLessons(c2.rows), now: NOW9 });
  assert.ok(!rp.some((r) => r.date === "2026-11-10"), dates(rp).join());
  // Uhrzeit des Wochentags nach der Krankmeldung geändert (08:15): der Tag bleibt ausgefallen – in den Terminen und im Kalender
  rows = mkRows();
  const c3 = P.planCancellation({ params: base(), rows, lessons: mkLessons(rows), lessonId: "L3", now: NOW9 });
  const p3 = { ...c3.params, end: "2026-11-24", weekdays: [{ day: 2, minutes: 45, time: "08:15" }, { day: 4, minutes: 45, time: "08:00" }] };
  assert.ok(!P.computeSlots(p3).some((s) => s.date === "2026-11-10"));
  assert.ok(!P.repackFuture({ params: p3, rows: c3.rows, lessons: mkLessons(c3.rows), now: NOW9 }).some((r) => r.date === "2026-11-10"));
  const course = { id: "gs1a2b3c4d", short: "Religion 2ab", label: "Religion 2ab" };
  const tue = P.weekSchedule([{ id: "u1", subject: "gs", klass: course.id, title: "Josef", course, params: p3 }], "2026-11-09").days[1];
  assert.deepEqual([tue.timed.length, tue.off.map((o) => o.reason)], [0, ["Unterricht ausgefallen"]]);
  // zwei Termine am selben Wochentag: weiter nur der passende (Beginn 08:05 → der nächstgelegene Termin 08:00, nicht 10:00)
  const two = { start: "2026-11-02", end: "2026-11-16", weekdays: [{ day: 1, minutes: 45, time: "08:00" }, { day: 1, minutes: 45, time: "10:00" }], breaks: [] };
  const r4 = ["2026-11-02", "2026-11-02", "2026-11-09", "2026-11-09"].map((d, i) => ({ uid: UIDS[i], stundenfrage: "S" + (i + 1), ablauf: [], schritt: null, date: d, time: i % 2 ? "10:00" : i === 2 ? "08:05" : "08:00", minutes: 45 }));
  const c4 = P.planCancellation({ params: two, rows: r4, lessons: mkLessons(r4), lessonId: "L3", now: at("2026-11-08T12:00:00Z") });
  assert.deepEqual(c4.params.cancelled, [{ date: "2026-11-09", time: "08:00" }]);
  assert.deepEqual(c4.rows.slice(2).map((x) => x.date + " " + x.time), ["2026-11-09 10:00", "2026-11-16 08:00"]);
  assert.ok(P.computeSlots(c4.params).some((s) => s.date === "2026-11-09" && s.time === "10:00"), "der zweite Termin des Tages bleibt");
});

test("F02: Krankmeldung und „rückgängig“ übernehmen den Elternlink aus der Datenbank – ein gleichzeitiges „Link erneuern“ bleibt, der widerrufene Link gilt nicht wieder", async () => {
  const { c, unitId, ids } = await setup();
  const t1 = (await call(c, PA.routeTeacherParentLink, "POST", "/x", {}, ids[2])).data.token;
  const v = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  // zwischen dem Lesen der Sitzung und dem Batch erneuert ein zweiter Tab den Link
  const batch = c.db.batch;
  let t2 = null;
  c.db.batch = async (list) => { c.db.batch = batch; t2 = (await call(c, PA.routeTeacherParentLink, "POST", "/x", { renew: true }, ids[2])).data.token; return batch(list); };
  const r = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: v }, ids[2])).data;
  assert.ok(t2 && t2 !== t1 && r.placeholderId);
  assert.equal((await lessonRow(c, r.placeholderId)).parent_hash, await PA.parentHash(t2), "der erneuerte Link gehört zum Ausfall-Eintrag");
  assert.equal((await lessonRow(c, ids[2])).parent_hash, null);
  c.now = at("2026-11-10T09:00:00Z");
  assert.equal((await pub(c, PA.routeParentLesson, { token: t2 })).data.state, "cancelled");
  assert.equal((await pub(c, PA.routeParentLesson, { token: t1 })).status, 404, "der widerrufene Link bleibt ungültig");
  c.now = NOW;
  // rückgängig: zwischen Lesen und Batch wird der Link des Ausfall-Eintrags erneuert → genau dieser Link gehört danach wieder zur Sitzung
  let t3 = null;
  c.db.batch = async (list) => { c.db.batch = batch; t3 = (await call(c, PA.routeTeacherParentLink, "POST", "/x", { renew: true }, r.placeholderId)).data.token; return batch(list); };
  assert.equal((await call(c, GS.routeCancelUndo, "POST", "/x", { undoId: r.unit.revise.undoId }, unitId)).status, 200);
  assert.equal((await lessonRow(c, ids[2])).parent_hash, await PA.parentHash(t3));
  assert.equal(await lessonRow(c, r.placeholderId), null);
  assert.equal((await pub(c, PA.routeParentLesson, { token: t2 })).status, 404);
  // Sitzungscode zufällig schon vergeben: der Ausfall-Eintrag kommt mit neuem Code nach – samt Elternlink, die Sitzung behält ihn bis dahin nicht doppelt
  const taken = (await lessonRow(c, ids[0])).code, prep = c.db.prepare;
  let forced = false;
  c.db.prepare = (sql) => { const st = prep(sql); if (forced || !sql.startsWith("INSERT INTO lessons(id, subject, klass, title, topic")) return st;
    forced = true; return { ...st, bind: (...a) => st.bind(...a.map((x, i) => (i === 6 ? taken : x))) }; };
  const v2 = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  const r2 = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: v2 }, ids[2])).data;
  c.db.prepare = prep;
  const ph = await lessonRow(c, r2.placeholderId);
  assert.ok(forced && ph && ph.code !== taken);
  assert.equal(ph.parent_hash, await PA.parentHash(t3));
  assert.equal((await lessonRow(c, ids[2])).parent_hash, null);
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE substr(parent_hash,1,1)='~'").first()).n, 0, "keine Zwischenmarke bleibt stehen");
});

test("F03: eine veraltete Tabelle speichern (Grundschule) → 409, die Termine der Sitzungen bleiben; mit aktueller Version laufen sie mit", async () => {
  const { c, unitId, ids } = await setup();
  const stale = await unitGet(c, unitId);
  const v = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  await call(c, GS.routeLessonCancel, "POST", "/x", { version: v }, ids[2]);
  const shifted = ["2026-11-03", "2026-11-05", "2026-11-12", "2026-11-17", "2026-11-19", null];
  const r = await call(c, U.routeUnitPatch, "PATCH", "/x", { plan: stale.plan, rows: stale.rows, baseVersion: stale.version }, unitId);
  assert.deepEqual([r.status, r.data.code], [409, "unit_conflict"]);
  assert.deepEqual((await Promise.all(ids.map((id) => lessonRow(c, id)))).map((l) => l.lesson_date), shifted, "nichts in die Sitzungen geschrieben");
  const cur = await unitGet(c, unitId);
  const ok2 = await call(c, U.routeUnitPatch, "PATCH", "/x", { plan: cur.plan, rows: cur.rows.map((x, i) => (i === 5 ? { ...x, date: "2026-11-24", time: "08:00" } : x)), baseVersion: cur.version }, unitId);
  assert.equal(ok2.status, 200);
  assert.equal((await lessonRow(c, ids[5])).lesson_date, "2026-11-24");
  // ohne baseVersion wie bisher (ungeprüft)
  const cur2 = await unitGet(c, unitId);
  assert.equal((await call(c, U.routeUnitPatch, "PATCH", "/x", { rows: cur2.rows.map((x, i) => (i === 5 ? { ...x, date: "2026-11-26" } : x)) }, unitId)).status, 200);
  assert.equal((await lessonRow(c, ids[5])).lesson_date, "2026-11-26");
});

test("F05/F06: rückgängig führt auch später angelegte Sitzungen mit und stellt den roten Kasten wie vorher her", async () => {
  const { c, unitId, ids } = await setup({ end: "2026-11-26" });
  let u = await unitGet(c, unitId);
  await call(c, U.routeUnitPatch, "PATCH", "/x", { rows: [...u.rows, { stundenfrage: "Stunde 7", ablauf: [], date: "2026-11-24", time: "08:00", minutes: 45 }], baseVersion: u.version }, unitId);
  const v = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  const r = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: v }, ids[2])).data;
  assert.equal(r.unit.rows[6].date, "2026-11-26");
  const made = await call(c, U.routeUnitSessions, "POST", "/x", undefined, unitId);
  assert.equal(made.data.created, 1);
  const l7 = made.data.unit.lessons.find((l) => l.row === r.unit.rows[6].uid);
  assert.ok(l7 && l7.date === "2026-11-26" && made.data.unit.revise.canUndo);
  const und = await call(c, GS.routeCancelUndo, "POST", "/x", { undoId: r.unit.revise.undoId }, unitId);
  assert.equal(und.status, 200);
  assert.equal(und.data.unit.rows[6].date, "2026-11-24");
  assert.equal((await lessonRow(c, l7.id)).lesson_date, "2026-11-24", "die später angelegte Sitzung wandert mit ihrer Zeile zurück");
  assert.deepEqual((await Promise.all(ids.map((id) => lessonRow(c, id)))).map((l) => l.lesson_date), DATES);
  // F06: erste Krankmeldung erledigt, zweite rückgängig → der Kasten bleibt geschlossen
  let pre = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data;
  const a = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.version }, ids[2])).data;
  assert.equal((await call(c, U.routeUnitPatch, "PATCH", "/x", { reviseDone: true, reviseSeen: a.unit.revise.items.map((x) => x.id) }, unitId)).data.unit.revise.open, false);
  pre = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[3])).data;
  const b = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.version }, ids[3])).data;
  assert.equal(b.unit.revise.open, true);
  u = (await call(c, GS.routeCancelUndo, "POST", "/x", { undoId: b.unit.revise.undoId }, unitId)).data.unit;
  assert.deepEqual([u.revise.open, u.revise.items.length, u.params.cancelled.length], [false, 1, 1], "wie vor der zweiten Krankmeldung: geschlossen, der erste Ausfall bleibt");
  // offen vor der zweiten Krankmeldung → nach rückgängig weiter offen (wie bisher)
  pre = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[3])).data;
  await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.version }, ids[3]);
  pre = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[4])).data;
  const d = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.version }, ids[4])).data;
  u = (await call(c, GS.routeCancelUndo, "POST", "/x", { undoId: d.unit.revise.undoId }, unitId)).data.unit;
  assert.equal(u.revise.open, true);
});

test("F07: „Erledigt – Hinweis entfernen“ aus einem veralteten Kasten schließt keine neuere Krankmeldung", async () => {
  const { c, unitId, ids } = await setup();
  let pre = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data;
  const a = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.version }, ids[2])).data;
  const seen = a.unit.revise.items.map((x) => x.id);
  pre = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[3])).data;
  await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.version }, ids[3]);
  const r = await call(c, U.routeUnitPatch, "PATCH", "/x", { reviseDone: true, reviseSeen: seen }, unitId);
  assert.deepEqual([r.status, r.data.code], [409, "revise_changed"]);
  let u = await unitGet(c, unitId);
  assert.deepEqual([u.revise.open, u.revise.items.length, u.revise.canUndo], [true, 2, true], "der Hinweis und „rückgängig“ der neueren Krankmeldung bleiben");
  u = (await call(c, U.routeUnitPatch, "PATCH", "/x", { reviseDone: true, reviseSeen: u.revise.items.map((x) => x.id) }, unitId)).data.unit;
  assert.equal(u.revise.open, false);
});

test("F08: save_unit_plan am Gymnasium mit leerer oder erfundener uid – nach Position wie vor der Grundschul-Erweiterung, keine Sitzung gelöscht", async () => {
  const { c } = await setup();
  const sek = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "powi", klass: "8B", title: "Wahlen", params: base("2026-11-12") })).data.unit;
  await call(c, U.routeUnitPatch, "PATCH", "/x", { plan: { lernaufgabe: "Wahlplakat", schritte: [] }, rows: ["a", "b", "c"].map((q) => ({ stundenfrage: q, ablauf: ["x"] })), assignDates: true }, sek.id);
  const made = (await call(c, U.routeUnitSessions, "POST", "/x", undefined, sek.id)).data;
  assert.equal(made.created, 3);
  const linked = async () => { const u = await unitGet(c, sek.id); return { n: u.lessons.length, rows: u.lessons.filter((l) => u.rows.some((r) => r.uid === l.row)).length, uids: u.rows.map((r) => r.uid) }; };
  const before = await linked();
  for (const uid of ["", "neu"]) {
    const s = await mcp(c, "save_unit_plan", { unit_id: sek.id, plan: { lernaufgabe: "Wahlplakat", schritte: [] }, stunden: [1, 2, 3].map((i) => ({ uid, stundenfrage: "Neue Stunde " + i, ablauf: ["y"] })) });
    assert.ok(!s.isError && /^Plan gespeichert \(Version \d+, 3 Stunden\)\. Die Lehrkraft prüft ihn in der Plattform und legt dort die Sitzungen an\.$/.test(s.text), s.text);
    const now = await linked();
    assert.equal(now.n, 3, "keine Sitzung gelöscht (uid „" + uid + "“)");
    if (uid === "") assert.deepEqual([now.rows, now.uids], [3, before.uids], "leere uid: die Zeilen behalten ihre Kennung nach Position");
  }
  // eine erfundene uid im richtigen Format: ebenfalls nach Position (wie vor der Erweiterung: die Zeile bekommt diese Kennung, nichts wird gelöscht)
  const s = await mcp(c, "save_unit_plan", { unit_id: sek.id, plan: { lernaufgabe: "Wahlplakat", schritte: [] }, stunden: [{ uid: "abcdef12", stundenfrage: "x", ablauf: ["y"] }] });
  assert.ok(!s.isError && s.text.startsWith("Plan gespeichert (Version") && !s.text.includes("uid"), s.text);
  assert.equal((await linked()).n, 3);
  // mit echter uid aus den gespeicherten Zeilen: der Weg über die uid (Spezifikation §8.5)
  const cur = await unitGet(c, sek.id);
  const s2 = await mcp(c, "save_unit_plan", { unit_id: sek.id, base_version: cur.version, plan: cur.plan, stunden: cur.rows.map((r) => ({ uid: r.uid, stundenfrage: r.stundenfrage, ablauf: r.ablauf })) });
  assert.ok(!s2.isError && s2.text.includes("Stunden mit uid behalten ihre Sitzung"), s2.text);
});

test("F17: save_unit_plan ohne uid bei einer Grundschul-Einheit mit Sitzungen wird abgelehnt; Prompt und Beschreibung nennen die uid", async () => {
  const { c, unitId } = await setup();
  const u = await unitGet(c, unitId);
  const s = await mcp(c, "save_unit_plan", { unit_id: unitId, plan: u.plan, stunden: [1, 2, 3].map((i) => ({ stundenfrage: "Neu " + i, ablauf: ["x"] })) });
  assert.ok(s.isError && s.text.startsWith("Diese Einheit hat schon Sitzungen: Gib bei jeder Stunde, die bleibt, ihre uid aus get_unit an"), s.text);
  const after = await unitGet(c, unitId);
  assert.deepEqual([after.version, after.rows.map((r) => r.stundenfrage)], [u.version, u.rows.map((r) => r.stundenfrage)], "nichts gespeichert");
  // ohne Sitzungen weiter nach Position (erste Planung)
  const fresh = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "gs", klass: u.klass, title: "Noah", params: base() })).data.unit;
  assert.ok(!(await mcp(c, "save_unit_plan", { unit_id: fresh.id, plan: { lernaufgabe: "x", schritte: [] }, stunden: [{ stundenfrage: "a", ablauf: ["b"] }] })).isError);
  // Prompt „Einheit mit Claude planen“: mit Sitzungen uid aus get_unit, ohne wie bisher
  const { claudeGsUnitPrompt } = await import("../../public/gsplanning.js");
  const ctx = { unitId, course: { subjectName: "Religion", gradeText: "Jahrgang 2" }, params: base(), slots: P.computeSlots(base()) };
  assert.ok(claudeGsUnitPrompt({ ...ctx, hasSessions: true }).includes("Rufe vorher `get_unit` für die Einheit " + unitId + " auf und gib beim Speichern bei jeder Stunde, die bleibt, ihre `uid` von dort an"));
  assert.ok(!claudeGsUnitPrompt(ctx).includes("uid"));
  // Beschreibung des Werkzeugs: die uid-Regeln gelten, wo get_unit uids zeigt (Grundschule)
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const tools = (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result.tools;
  const d = tools.find((t) => t.name === "save_unit_plan").description;
  assert.ok(d.includes("Grundschule (get_unit nennt dort die uid jeder Stunde)") && d.includes("ebenso einen Plan ganz ohne uid") && d.includes("Am Gymnasium nennt get_unit keine uid"), d);
});

test("F05 (Kontrolle): rückgängig stellt die damals verschobenen Sitzungen genau aus ihrem Schnappschuss her und lässt frühere Sitzungen unberührt", async () => {
  const { c, unitId, ids } = await setup();
  // Stunde 4: Zeile ohne Länge, Sitzung mit 60 Minuten (der Termin hat 45) – nach rückgängig wieder 60 wie vor der Krankmeldung
  const u0 = await unitGet(c, unitId);
  await c.db.prepare("UPDATE units SET rows=?2 WHERE id=?1").bind(unitId, JSON.stringify(u0.rows.map((r, i) => (i === 3 ? { ...r, minutes: null } : r)))).run();
  await c.db.prepare("UPDATE lessons SET duration_min=60, updated_at=1 WHERE id=?1").bind(ids[3]).run();
  await c.db.prepare("UPDATE lessons SET updated_at=1 WHERE id IN (?1, ?2)").bind(ids[0], ids[1]).run();
  const v = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  const r = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: v }, ids[2])).data;
  assert.equal((await lessonRow(c, ids[3])).duration_min, 45, "am neuen Termin die Länge des Termins");
  assert.equal((await call(c, GS.routeCancelUndo, "POST", "/x", { undoId: r.unit.revise.undoId }, unitId)).status, 200);
  const l4 = await lessonRow(c, ids[3]);
  assert.deepEqual([l4.lesson_date, l4.start_time, l4.duration_min], ["2026-11-12", "08:00", 60]);
  assert.deepEqual((await Promise.all(ids.map((id) => lessonRow(c, id)))).map((l) => l.lesson_date), DATES);
  assert.deepEqual([(await lessonRow(c, ids[0])).updated_at, (await lessonRow(c, ids[1])).updated_at], [1, 1], "Sitzungen vor der ausgefallenen Stunde bleiben unberührt");
});

/* Abschlussprüfung Gruppe B */
test("F21: Prompt und get_unit nennen eine Sitzung mit Inhalten (z. B. nur Ideen) nicht „noch nicht geplant“ – genau die Stunden, die save_unit_plan nicht wegfallen ließe", async () => {
  const { c, unitId, ids, uids } = await setup();
  const v = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  await call(c, GS.routeLessonCancel, "POST", "/x", { version: v }, ids[2]);
  // Stunde 6 (ohne Termin): ihre Sitzung hat nur die Ideen der Lehrkraft
  assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { ideas: "Bodenbild mit Tüchern" }, ids[5])).status, 200);
  const unit = await unitGet(c, unitId);
  assert.deepEqual(unit.lessons.filter((l) => !l.cancelled).map((l) => [l.id, l.hasContent]).sort(), ids.map((id) => [id, id === ids[5]]).sort());
  const prompt = claudeUnitRevisionPrompt({ unit, now: NOW });
  const line = prompt.split("\n").find((x) => x.includes("[uid " + uids[5] + "]"));
  assert.ok(line.includes("Sitzung " + ids[5] + " – hat schon Inhalte") && line.includes("nicht weglassen") && !line.includes("noch nicht geplant"), line);
  assert.ok(prompt.split("\n").find((x) => x.includes("[uid " + uids[4] + "]")).endsWith("Sitzung " + ids[4] + " – noch nicht geplant"));
  const g = await mcp(c, "get_unit", { unit_id: unitId });
  assert.ok(g.text.includes("(Sitzung " + ids[5] + " – hat schon Inhalte") && g.text.includes("(Sitzung " + ids[4] + " – noch leer)"), g.text);
  // der Server sieht es genauso: Stunde 6 darf nicht wegfallen, Stunde 5 schon
  const stunden = unit.rows.map((r) => ({ uid: r.uid, stundenfrage: r.stundenfrage, ablauf: ["x"] }));
  const s = await mcp(c, "save_unit_plan", { unit_id: unitId, base_version: unit.version, plan: unit.plan, stunden: stunden.filter((x) => x.uid !== uids[5]) });
  assert.ok(s.isError && s.text.includes(uids[5]), s.text);
  const s2 = await mcp(c, "save_unit_plan", { unit_id: unitId, base_version: unit.version, plan: unit.plan, stunden: stunden.filter((x) => x.uid !== uids[4]) });
  assert.ok(!s2.isError, s2.text);
});

test("F22: Ausfall-Eintrag – get_lesson ohne „noch leer – …“-Aufforderungen, save_planning_result und update_unit_row mit klarer Ablehnung, Planungsverlauf geht mit ihm", async () => {
  const { c, unitId, ids } = await setup();
  let v = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  const P1 = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: v }, ids[2])).data.placeholderId;
  const g = await mcp(c, "get_lesson", { lesson_id: P1 });
  assert.ok(!g.text.includes("noch leer – speichere") && !g.text.includes("noch leer – formuliere") && !g.text.includes("## PDF-Dateien des Kurses"), g.text);
  assert.ok(g.text.includes("(Ausfall-Eintrag – hier wird nichts geplant)") && g.text.includes("Eltern sehen zu diesem Termin nur, dass der Unterricht nicht stattfinden konnte."), g.text);
  const sp = await mcp(c, "save_planning_result", { lesson_id: P1, text: "Entwurf" });
  assert.ok(sp.isError && sp.text.startsWith("Diese Sitzung ist ein Ausfall-Eintrag"), sp.text);
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM chat WHERE lesson_id=?1").bind(P1).first()).n, 0);
  const ur = await mcp(c, "update_unit_row", { lesson_id: P1, stundenfrage: "x" });
  assert.ok(ur.isError && ur.text.startsWith("Diese Sitzung ist ein Ausfall-Eintrag") && ur.text.includes("uid"), ur.text);
  // ältere Planungsverläufe eines Ausfall-Eintrags gehen mit ihm: rückgängig …
  const chat = (id) => c.db.prepare("INSERT INTO chat(lesson_id, role, content, model, mode, created_at) VALUES(?1, 'assistant', 'alt', 'x', 'claude', ?2)").bind(id, c.now).run();
  const left = async (id) => (await c.db.prepare("SELECT COUNT(*) AS n FROM chat WHERE lesson_id=?1").bind(id).first()).n;
  await chat(P1); await chat(ids[0]);
  const undoId = (await unitGet(c, unitId)).revise.undoId;
  assert.equal((await call(c, GS.routeCancelUndo, "POST", "/x", { undoId }, unitId)).status, 200);
  assert.deepEqual([await left(P1), await left(ids[0])], [0, 1], "nur der Verlauf des Ausfall-Eintrags");
  // … und Löschen der Einheit
  v = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  const P2 = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: v }, ids[2])).data.placeholderId;
  await chat(P2);
  await c.db.prepare("DELETE FROM lessons WHERE unit_id=?1 AND cancelled=0").bind(unitId).run();
  assert.equal((await call(c, U.routeUnitDelete, "DELETE", "/x", undefined, unitId)).status, 200);
  assert.equal(await left(P2), 0);
});

test("F22 (Kontrolle): update_lesson auf einem Ausfall-Eintrag – klare Ablehnung statt „nur der Hinweis der Lehrkraft“ (den der Connector nicht setzen kann)", async () => {
  const { c, ids } = await setup();
  const v = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  const P1 = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: v }, ids[2])).data.placeholderId;
  const before = await lessonRow(c, P1);
  for (const args of [{ inhalt_eltern: "Heute fiel der Unterricht aus." }, { titel: "x" }, {}]) {
    const r = await mcp(c, "update_lesson", { lesson_id: P1, ...args });
    assert.ok(r.isError && r.text.startsWith("Diese Sitzung ist ein Ausfall-Eintrag") && r.text.includes("siehe get_unit") && !r.text.includes("lässt sich nur der Hinweis"), r.text);
  }
  assert.deepEqual(await lessonRow(c, P1), before, "nichts geändert");
  // die verschobene Stunde selbst lässt sich weiter ändern
  assert.ok(!(await mcp(c, "update_lesson", { lesson_id: ids[2], inhalt_eltern: "Wir hören von Josef." })).isError);
});
