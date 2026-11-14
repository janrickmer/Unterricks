// Unterrichtsfreie Tage (Nachtrag 24): Prüfung der Einträge, schoolBreaks/computeSlots je Schule, Kalender, Druckaufträge, Verschieben (reine
// Funktion und Routen mit der D1-Nachbildung), Ablehnung eines Datums auf einem freien Tag, Prompts mit und ohne freie Tage, Connector.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const P = await import("../../public/planning.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const GS = await import("../../worker/gs.js");
const U = await import("../../worker/units.js");
const L = await import("../../worker/lessons.js");
const FD = await import("../../worker/freedays.js");
const PJ = await import("../../worker/printjobs.js");
const R = await import("../../worker/reset.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");
const { claudeUnitRevisionPrompt, claudeGsUnitPrompt } = await import("../../public/gsplanning.js");
const UF = await import("../../public/unitfile.js");

const at = (s) => Date.parse(s);
const GYM_TT = [{ day: 1, minutes: 45, time: "08:00" }, { day: 3, minutes: 45, time: "10:00" }];   // Mo 08:00, Mi 10:00
const GS_TT = [{ day: 2, minutes: 45, time: "08:00" }, { day: 4, minutes: 45, time: "08:00" }];    // Di/Do 08:00
const HERBST = { id: "aaaaaaaaaaaaaaaa", from: "2026-11-09", to: "2026-11-13", label: "Herbstferien", scope: "both" };
const PTAG = { id: "bbbbbbbbbbbbbbbb", from: "2026-11-04", to: "2026-11-04", label: "Pädagogischer Tag", scope: "gym" };
const GSTAG = { id: "cccccccccccccccc", from: "2026-11-05", to: "2026-11-05", label: "Schulfest", scope: "gs" };

/* ---------- Prüfung der Einträge ---------- */
test("normalizeFreeDay: Bezeichnung, Zeitraum (ein Tag ohne „Bis“), höchstens 366 Tage, Schule ohne Vorauswahl – deutsche Meldungen mit Feld", () => {
  assert.deepEqual(P.normalizeFreeDay({ label: "  Pädagogischer\n Tag ", from: "2026-11-04", scope: "gym" }), { from: "2026-11-04", to: "2026-11-04", label: "Pädagogischer Tag", scope: "gym" });
  assert.deepEqual(P.normalizeFreeDay({ label: "Herbstferien", from: "2026-12-21", to: "2027-01-08", scope: "both" }).to, "2027-01-08", "über den Jahreswechsel");
  const err = (x) => { try { P.normalizeFreeDay(x); return null; } catch (e) { return [e.field, e.message]; } };
  assert.deepEqual(err({ from: "2026-11-04", scope: "gs" }), ["label", "Bitte eine Bezeichnung eintragen, z. B. „Herbstferien“ oder „Pädagogischer Tag“."]);
  assert.equal(err({ label: "x".repeat(81), from: "2026-11-04", scope: "gs" })[0], "label");
  assert.equal(P.normalizeFreeDay({ label: "x".repeat(80), from: "2026-11-04", scope: "gs" }).label.length, 80);
  assert.equal(err({ label: "A", from: "2026-02-30", scope: "gs" })[0], "from");
  assert.equal(err({ label: "A", from: "1999-12-31", scope: "gs" })[0], "from");
  assert.deepEqual(err({ label: "A", from: "2026-11-05", to: "2026-11-04", scope: "gs" }), ["to", "„Bis“ darf nicht vor „Von“ liegen."]);
  assert.equal(P.normalizeFreeDay({ label: "A", from: "2026-01-01", to: "2026-12-31", scope: "gs" }).to, "2026-12-31", "365 Tage gehen");
  assert.equal(P.normalizeFreeDay({ label: "A", from: "2028-01-01", to: "2028-12-31", scope: "gs" }).to, "2028-12-31", "366 Tage (Schaltjahr) gehen");
  assert.equal(P.normalizeFreeDay({ label: "A", from: "2026-01-01", to: "2027-01-01", scope: "gs" }).to, "2027-01-01", "366 Tage gehen");
  assert.equal(err({ label: "A", from: "2026-01-01", to: "2027-01-02", scope: "gs" })[0], "to", "367 Tage nicht");
  for (const scope of [undefined, null, "", "alle", "__proto__", "toString"]) assert.deepEqual(err({ label: "A", from: "2026-11-04", scope }), ["scope", "Bitte wählen, ob der Eintrag die Grundschule, das Gymnasium oder beide Schulen betrifft."]);
  assert.deepEqual(P.cleanFreeDays([HERBST, { label: "kaputt" }, PTAG, null]).map((f) => f.id), [PTAG.id, HERBST.id], "säubern und nach Beginn sortieren");
});

/* ---------- Termine je Schule ---------- */
test("schoolBreaks/computeSlots: Gymnasium, Grundschule, beide; zusammen mit den Ferien der Einheit; über Monats- und Jahresgrenze; nie gespeichert", () => {
  const fd = [HERBST, PTAG, GSTAG];
  assert.deepEqual(P.schoolBreaks(fd, "gym").map((b) => b.label), ["Pädagogischer Tag", "Herbstferien"]);
  assert.deepEqual(P.schoolBreaks(fd, "gs").map((b) => b.label), ["Schulfest", "Herbstferien"]);
  assert.deepEqual(P.schoolBreaks(fd, "gs", { from: "2026-11-06" }).map((b) => b.label), ["Herbstferien"], "nur Einträge, die nicht vor dem Beginn enden");
  const gymP = { start: "2026-11-02", end: "2026-11-18", weekdays: GYM_TT, breaks: [{ from: "2026-11-16", to: "2026-11-16", label: "Exkursion" }] };
  const gsP = { start: "2026-11-02", end: "2026-11-19", weekdays: GS_TT, breaks: [] };
  const d = (p) => P.computeSlots(p).map((s) => s.date);
  assert.deepEqual(d(gymP), ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-18"], "ohne freie Tage: nur die Exkursion fehlt");
  assert.deepEqual(d(P.withSchoolBreaks(gymP, fd, "powi")), ["2026-11-02", "2026-11-18"], "Gymnasium: Pädagogischer Tag und Herbstferien fallen weg (Exkursion bleibt weg)");
  assert.deepEqual(d(P.withSchoolBreaks(gsP, fd, "gs")), ["2026-11-03", "2026-11-17", "2026-11-19"], "Grundschule: Schulfest (nur GS) und Herbstferien fallen weg, der Pädagogische Tag nicht");
  assert.deepEqual(d(P.withSchoolBreaks({ ...gsP, start: "2026-12-28", end: "2027-01-14" }, [{ id: "dddddddddddddddd", from: "2026-12-21", to: "2027-01-08", label: "Weihnachtsferien", scope: "both" }], "gs")),
    ["2027-01-12", "2027-01-14"], "Zeitraum über den Jahreswechsel");
  // nie gespeichert: storeParams entfernt sie, normalizeParams kennt den Schlüssel nur, wenn es welche gibt
  const w = P.withSchoolBreaks(gymP, fd, "powi");
  assert.deepEqual(Object.keys(P.storeParams(w)), Object.keys(gymP));
  assert.equal(P.withSchoolBreaks(gymP, [], "powi"), gymP, "ohne Einträge dasselbe Objekt");
  assert.equal("schoolBreaks" in P.normalizeParams(gymP), false);
  assert.equal(P.normalizeParams(w).schoolBreaks.length, 2);
  assert.deepEqual(P.freeDayOn("2026-11-04", fd, "gs"), null);
  assert.equal(P.freeDateError("2026-11-04", fd, "powi"), "Am Mi, 04.11.2026 ist unterrichtsfrei (Pädagogischer Tag, Gymnasium). Bitte einen anderen Tag wählen.");
  assert.equal(P.freeDateError("2026-11-10", fd, "gs"), "Am Di, 10.11.2026 ist unterrichtsfrei (Herbstferien, beide Schulen). Bitte einen anderen Tag wählen.");
  assert.equal(P.freeDateError("2026-11-04", fd, "gs"), null);
});

test("paramsText und Prompts: ohne freie Tage byte-gleich, mit einer Zeile „Unterrichtsfreie Tage: …“ (nur die im Zeitraum)", () => {
  const p = { start: "2026-11-02", end: "2026-11-18", exam: "2026-11-18", weekdays: GYM_TT, breaks: [], notes: "" };
  const w = P.withSchoolBreaks(p, [HERBST, PTAG, { id: "eeeeeeeeeeeeeeee", from: "2027-02-01", to: "2027-02-05", label: "Später", scope: "both" }], "powi");
  assert.equal(P.paramsText(w), P.paramsText(p) + "\nUnterrichtsfreie Tage: Pädagogischer Tag Mi, 04.11.2026; Herbstferien Mo, 09.11.2026–Fr, 13.11.2026 (aus den Einstellungen; ohne Termine)");
  assert.equal(P.paramsText({ ...p, schoolBreaks: [] }), P.paramsText(p));
  const ctx = { unitId: "u1", subject: "powi", klass: "8A", title: "Wahlen", params: p, slots: P.computeSlots(p), rules: "", bases: [], missing: [] };
  assert.equal(P.claudeUnitPrompt({ ...ctx, params: { ...p, schoolBreaks: [] } }), P.claudeUnitPrompt(ctx), "Gymnasium: ohne freie Tage unverändert");
  const withFree = P.claudeUnitPrompt({ ...ctx, params: w, slots: P.computeSlots(w) });
  assert.ok(withFree.includes("- Unterrichtsfreie Tage: Pädagogischer Tag Mi, 04.11.2026") && withFree.includes("genau 2 Zeilen") && !withFree.includes("Später"));
  const gsP = { start: "2026-11-02", end: "2026-11-19", weekdays: GS_TT, breaks: [] }, gsW = P.withSchoolBreaks(gsP, [HERBST, PTAG], "gs");
  const gctx = { unitId: "u2", course: { subjectName: "Religion", label: "Religion 2ab", gradeText: "Jahrgang 2" }, title: "Josef", params: gsP, slots: P.computeSlots(gsP), bases: [], missing: [] };
  assert.equal(claudeGsUnitPrompt({ ...gctx, params: { ...gsP, schoolBreaks: [] } }), claudeGsUnitPrompt(gctx), "Grundschule: ohne freie Tage unverändert");
  const g2 = claudeGsUnitPrompt({ ...gctx, params: gsW, slots: P.computeSlots(gsW) });
  assert.ok(g2.includes("Unterrichtsfreie Tage: Herbstferien") && !g2.includes("Pädagogischer Tag"), "Grundschule: nur ihre Tage");
});

test("weekSchedule: Tag für eine bzw. beide Schulen frei (free, freeFor), Klassen nicht unter „Entfällt“, Sitzungen an freien Tagen markiert; ohne Einträge wie bisher", () => {
  const course = { id: "gs1a2b3c4d", short: "Religion 2ab", label: "Religion 2ab" };
  const units = [{ id: "g", subject: "powi", klass: "8A", title: "Wahlen", params: { start: "2026-11-02", end: "2026-11-20", weekdays: GYM_TT } },
    { id: "s", subject: "gs", klass: course.id, title: "Josef", course, params: { start: "2026-11-02", end: "2026-11-20", weekdays: GS_TT } }];
  const plain = P.weekSchedule(units, "2026-11-02");
  assert.deepEqual(plain.days.map((d) => d.timed.length), [1, 1, 1, 1, 0]);
  assert.ok(plain.days.every((d) => d.free.length === 0 && d.freeFor.gs === null && d.freeFor.gym === null));
  const w = P.weekSchedule(units, "2026-11-02", { freeDays: [PTAG, GSTAG], lessons: [{ id: "l1", subject: "powi", klass: "8A", title: "Erarbeitung", date: "2026-11-04", time: "10:00", minutes: 45 },
    { id: "l2", subject: "powi", klass: "8A", title: "kein freier Tag", date: "2026-11-02", time: "08:00", minutes: 45 }] });
  const wed = w.days[2], thu = w.days[3];
  assert.deepEqual([wed.free, wed.freeFor], [[{ label: "Pädagogischer Tag", scope: "gym" }], { gs: null, gym: "Pädagogischer Tag" }]);
  assert.deepEqual(wed.timed.map((e) => [e.href, e.onFree, e.time]), [["#/lk/s/l1", "Pädagogischer Tag", "10:00"]], "nur die Sitzung am freien Tag (markiert, führt zur Sitzung)");
  assert.deepEqual([thu.timed.length, thu.off.length, thu.freeFor.gs], [0, 0, "Schulfest"], "Grundschule frei: kein Termin, nicht unter „Entfällt“");
  assert.equal(w.days[0].timed.length, 1, "eine Sitzung an einem normalen Tag kommt nicht doppelt");
  const both = P.weekSchedule(units, "2026-11-09", { freeDays: [HERBST] });
  assert.ok(both.days.every((d) => d.timed.length === 0 && d.off.length === 0 && d.freeFor.gs === "Herbstferien" && d.freeFor.gym === "Herbstferien"));
});

test("Druckaufträge: nextWorkday nominell, printTargetDay überspringt die unterrichtsfreien Tage der Schule (beide frei → nächster Tag mit Unterricht)", () => {
  const units = [{ id: "g", subject: "powi", klass: "8A", params: { start: "2026-11-02", end: "2026-11-30", weekdays: GYM_TT } },
    { id: "s", subject: "gs", klass: "gs1a2b3c4d", params: { start: "2026-11-02", end: "2026-11-30", weekdays: GS_TT } }];
  const inj = (fd) => units.map((u) => ({ ...u, params: P.withSchoolBreaks(u.params, fd, u.subject) }));
  assert.equal(P.nextWorkday("2026-11-06"), "2026-11-09", "Freitag → Montag (nominell)");
  assert.equal(P.printTargetDay("2026-11-09", units), "2026-11-09");
  assert.equal(P.printTargetDay("2026-11-09", inj([HERBST])), "2026-11-16", "Herbstferien für beide: erst der Montag danach");
  assert.equal(P.printTargetDay("2026-11-04", inj([PTAG])), "2026-11-05", "Mittwoch nur fürs Gymnasium frei: Donnerstag (Grundschule)");
  assert.equal(P.printTargetDay("2026-11-03", inj([{ ...PTAG, from: "2026-11-03", to: "2026-11-03" }])), "2026-11-03", "nur Gymnasium frei, Grundschule hat Unterricht");
});

/* ---------- Verschieben (reine Funktion) ---------- */
const UIDS = ["a1a1a1a1", "b2b2b2b2", "c3c3c3c3", "d4d4d4d4", "e5e5e5e5", "f6f6f6f6"];
const gsBase = { start: "2026-11-02", end: "2026-11-19", weekdays: GS_TT, breaks: [] };
const rowsOf = (dates) => dates.map((d, i) => ({ uid: UIDS[i], stundenfrage: "Stunde " + (i + 1), ablauf: [], schritt: null, date: d, time: d ? "08:00" : null, minutes: 45 }));
const lessonsOf = (rows) => rows.map((r, i) => ({ id: "L" + (i + 1), title: r.stundenfrage, date: r.date, time: r.time, row: r.uid, minutes: r.minutes, cancelled: false }));
test("planFreeShift: ab der ersten betroffenen Stunde (heute oder später) auf die nächsten freien Termine, Rest ohne Termin; nichts betroffen → null; schon stattgefunden → Fehler", () => {
  const rows = rowsOf(["2026-11-03", "2026-11-05", "2026-11-10", "2026-11-12", "2026-11-17", "2026-11-19"]);
  const hit = (d) => d >= HERBST.from && d <= HERBST.to;
  const p = P.withSchoolBreaks(gsBase, [HERBST], "gs");
  const r = P.planFreeShift({ params: p, rows, lessons: lessonsOf(rows), hit, now: at("2026-11-02T10:00:00Z") });
  assert.deepEqual(r.rows.map((x) => x.date), ["2026-11-03", "2026-11-05", "2026-11-17", "2026-11-19", null, null]);
  assert.deepEqual([r.s, r.first, r.undatedRows.map((x) => x.n)], [2, { date: "2026-11-10", title: "Stunde 3" }, [5, 6]]);
  assert.deepEqual(r.moves.map((m) => [m.n, m.lessonId, m.to && m.to.date]), [[3, "L3", "2026-11-17"], [4, "L4", "2026-11-19"], [5, "L5", null], [6, "L6", null]]);
  assert.equal(P.planFreeShift({ params: p, rows, lessons: lessonsOf(rows), hit: () => false, now: at("2026-11-02T10:00:00Z") }), null);
  // die betroffene Stunde liegt schon in der Vergangenheit: nicht verschieben (heute oder später)
  assert.equal(P.planFreeShift({ params: p, rows, lessons: lessonsOf(rows), hit, now: at("2026-11-14T10:00:00Z") }), null);
  // nie früher als bisher: eine Lücke vor dem freien Tag wird nicht gefüllt
  const gap = rowsOf(["2026-11-03", "2026-11-10", "2026-11-12"]);
  assert.deepEqual(P.planFreeShift({ params: p, rows: gap, lessons: lessonsOf(gap), hit, now: at("2026-11-02T10:00:00Z") }).rows.map((x) => x.date), ["2026-11-03", "2026-11-17", "2026-11-19"]);
  // eine folgende Stunde hat schon stattgefunden (ungeordnet): already_held
  const odd = rowsOf(["2026-11-10", "2026-11-03"]);
  assert.throws(() => P.planFreeShift({ params: p, rows: odd, lessons: lessonsOf(odd), hit, now: at("2026-11-04T10:00:00Z") }), (e) => e.code === "already_held");
});

/* ---------- Worker: Routen ---------- */
const TOKEN = "lehrkraft-token-123";
const NOW = at("2026-11-02T10:00:00Z");
const call = async (c, fn, method, path, body, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method, headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code, ...(e.extra || {}) } }; }
};
async function mcp(c, name, args) {
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const r = await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json();
  return { text: r.result.content[0].text, isError: !!r.result.isError };
}
async function setup() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = NOW;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 30 * 86400e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", { grade: 2, classes: ["a", "b"], religion: true, weekdays: GS_TT, classSize: 22 })).data.course;
  const make = async (subject, klass, weekdays, end) => {
    const unit = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject, klass, title: subject === "gs" ? "Josef" : "Wahlen", params: { start: "2026-11-02", end, weekdays } })).data.unit;
    const rows = UIDS.map((uid, i) => ({ uid, stundenfrage: "Stunde " + (i + 1), ablauf: ["x"] }));
    await call(c, U.routeUnitPatch, "PATCH", "/x", { plan: { lernaufgabe: "Ziel" }, rows, assignDates: true }, unit.id);
    const u = (await call(c, U.routeUnitSessions, "POST", "/x", undefined, unit.id)).data.unit;
    const byRow = new Map(u.lessons.map((l) => [l.row, l.id]));
    return { id: unit.id, ids: u.rows.map((r) => byRow.get(r.uid)) };
  };
  const gs = await make("gs", course.id, GS_TT, "2026-11-19"), gym = await make("powi", "8A", GYM_TT, "2026-11-18");
  return { c, course, gs, gym };
}
const unitGet = async (c, id) => (await call(c, U.routeUnitGet, "GET", "/x", undefined, id)).data.unit;
const body = (f, extra = {}) => ({ label: f.label, from: f.from, to: f.to, scope: f.scope, ...extra });

test("Routen: Liste, Prüfung, Vorschau (nur heute und später, ohne Ausfall-Einträge, richtige Schule, ohne Einheit), höchstens 200, Löschen", async () => {
  const { c, course, gs, gym } = await setup();
  assert.deepEqual((await call(c, FD.routeFreeDaysList, "GET", "/x")).data.freeDays, []);
  const bad = await call(c, FD.routeFreeDayCreate, "POST", "/x", { label: "Ferien", from: "2026-11-09", scope: "alle" });
  assert.deepEqual([bad.status, bad.data.field], [400, "scope"]);
  // eine Sitzung ohne Einheit am Mittwoch und ein Ausfall-Eintrag (Grundschule) in den Ferien
  const loose = await L.createLesson(c.db, { subject: "ethik", klass: "10C", title: "Glück", date: "2026-11-11" }, c.now);
  await c.db.prepare("INSERT INTO lessons(id, subject, klass, title, topic, code, lesson_date, cancelled, created_at, updated_at) VALUES('ffffffffffffffff', 'gs', ?1, 'Unterricht ausgefallen', '', 'AUSF12', '2026-11-10', 1, 1, 1)").bind(course.id).run();
  c.db.counter.n = 0;
  const pre = await call(c, FD.routeFreeDaysPreview, "POST", "/x", body(HERBST));
  assert.equal(pre.status, 200);
  assert.ok(c.db.counter.n <= 8, "D1-Anweisungen der Vorschau: " + c.db.counter.n);
  const sum = pre.data.items.map((x) => [x.kind, x.date, x.school, x.label, x.noUnit]);
  assert.deepEqual(sum, [["lesson", "2026-11-09", "gym", "8A", false], ["lesson", "2026-11-10", "gs", "Religion 2ab", false], ["lesson", "2026-11-11", "gym", "8A", false],
    ["lesson", "2026-11-11", "gym", "10C", true], ["lesson", "2026-11-12", "gs", "Religion 2ab", false]], "beide Schulen, nach Datum; Sitzung ohne Einheit erkannt; kein Ausfall-Eintrag");
  assert.deepEqual((await call(c, FD.routeFreeDaysPreview, "POST", "/x", body({ ...HERBST, scope: "gs" }))).data.items.map((x) => x.school), ["gs", "gs"], "nur Grundschule");
  // heute oder später: am 10.11. ist der Montag vorbei
  c.now = at("2026-11-10T12:00:00Z");
  assert.deepEqual((await call(c, FD.routeFreeDaysPreview, "POST", "/x", body(HERBST))).data.items.map((x) => x.date), ["2026-11-10", "2026-11-11", "2026-11-11", "2026-11-12"]);
  c.now = NOW;
  // speichern ohne Verschieben, dann ändern: gefragt wird nur nach den neuen Tagen
  const saved = await call(c, FD.routeFreeDayCreate, "POST", "/x", body({ ...HERBST, to: "2026-11-10" }, { shift: false }));
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.data.shifted, saved.data.failed, saved.data.kept], [[], [], 2]);
  const id = saved.data.freeDay.id;
  assert.equal((await unitGet(c, gym.id)).rows[2].date, "2026-11-09", "nur speichern: Sitzungen bleiben");
  assert.deepEqual((await call(c, FD.routeFreeDaysPreview, "POST", "/x", body(HERBST, { id }))).data.items.map((x) => x.date), ["2026-11-11", "2026-11-11", "2026-11-12"], "beim Ändern nur die neuen Tage");
  assert.equal((await call(c, FD.routeFreeDayPut, "PUT", "/x", body(HERBST), "0000000000000000")).status, 404);
  // höchstens 200
  await c.db.prepare("INSERT INTO free_days(id, date_from, date_to, label, scope, created_at, updated_at) SELECT printf('%016x', value + 100), '2030-01-01', '2030-01-01', 'Tag', 'gs', 1, 1 FROM json_each(?1)")
    .bind(JSON.stringify(Array.from({ length: 199 }, (_, i) => i))).run();
  assert.equal((await call(c, FD.routeFreeDayCreate, "POST", "/x", body(PTAG))).data.error, "Höchstens 200 unterrichtsfreie Einträge – bitte zuerst vergangene löschen.");
  assert.equal((await call(c, FD.routeFreeDayPut, "PUT", "/x", body(HERBST, { shift: false }), id)).status, 200, "ändern geht auch bei 200");
  // löschen: nichts rückt zurück
  assert.equal((await call(c, FD.routeFreeDayDelete, "DELETE", "/x", undefined, id)).status, 200);
  assert.equal((await call(c, FD.routeFreeDayDelete, "DELETE", "/x", undefined, id)).status, 404);
  void loose;
});

test("Speichern und verschieben: beide Schulformen in einem Batch, Sitzungen mit Datum/Beginn, Hinweis (kind free, ohne Ausfall-Eintrag), Sitzung ohne Einheit unberührt, Versionskonflikt", async () => {
  const { c, gs, gym } = await setup();
  const loose = await L.createLesson(c.db, { subject: "ethik", klass: "10C", title: "Glück", date: "2026-11-11" }, c.now);
  // ein gleichzeitiges Speichern der Gymnasium-Einheit: die erste Anweisung des Batches läuft erst danach
  const orig = c.db.batch;
  let batches = 0;   // 1. Batch: lesen (affectedData), 2. Batch: schreiben – davor ändert „jemand anderes“ die Einheit
  c.db.batch = async (list) => { if (++batches === 2) { c.db.batch = orig; await c.db.prepare("UPDATE units SET version=version+1 WHERE id=?1").bind(gym.id).run(); } return orig(list); };
  c.db.counter.n = 0;
  const r = await call(c, FD.routeFreeDayCreate, "POST", "/x", body(HERBST, { shift: true }));
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(c.db.counter.n <= 12, "D1-Anweisungen beim Speichern mit Verschieben: " + c.db.counter.n);
  assert.deepEqual(r.data.shifted.map((x) => [x.unitId, x.moved, x.undated.map((u) => u.n)]), [[gs.id, 4, [5, 6]]]);
  assert.deepEqual(r.data.failed.map((x) => [x.unitId, x.reason]), [[gym.id, "Die Einheit wurde inzwischen an anderer Stelle geändert – sie wurde nicht verschoben."]]);
  assert.deepEqual(r.data.noUnit.map((x) => x.lessonId), [loose.id]);
  assert.equal(r.data.freeDays.length, 1, "der Eintrag ist trotzdem gespeichert");
  const s = await unitGet(c, gs.id), g = await unitGet(c, gym.id);
  assert.deepEqual(s.rows.map((x) => x.date), ["2026-11-03", "2026-11-05", "2026-11-17", "2026-11-19", null, null]);
  assert.deepEqual(g.rows.map((x) => x.date), ["2026-11-02", "2026-11-04", "2026-11-09", "2026-11-11", "2026-11-16", "2026-11-18"], "Gymnasium (Konflikt) unverändert");
  const les = async (id) => c.db.prepare("SELECT lesson_date, start_time, duration_min FROM lessons WHERE id=?1").bind(id).first();
  assert.deepEqual(await les(gs.ids[2]), { lesson_date: "2026-11-17", start_time: "08:00", duration_min: 45 });
  assert.deepEqual(await les(gs.ids[5]), { lesson_date: null, start_time: null, duration_min: 45 });
  assert.deepEqual(await les(gym.ids[2]), { lesson_date: "2026-11-09", start_time: "08:00", duration_min: 45 }, "Sitzung der Gymnasium-Einheit nicht angefasst (Versionsbindung)");
  assert.equal((await les(loose.id)).lesson_date, "2026-11-11", "Sitzung ohne Einheit unberührt");
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE cancelled=1").first()).n, 0, "kein Ausfall-Eintrag");
  assert.deepEqual([s.revise.open, s.revise.items.length, s.revise.items[0].kind, s.revise.items[0].label, s.revise.items[0].from, s.revise.canUndo, s.revise.undated.length], [true, 1, "free", "Herbstferien", "2026-11-09", false, 2]);
  assert.equal(g.revise, undefined);
  assert.equal(JSON.parse((await c.db.prepare("SELECT params FROM units WHERE id=?1").bind(gs.id).first()).params).schoolBreaks, undefined, "Rahmendaten der Einheit bleiben ohne die Schultage");
  assert.ok(s.params.schoolBreaks && s.slots.every((x) => x.date < "2026-11-09" || x.date > "2026-11-13"), "ausgeliefert mit den Schultagen, Termine ohne sie");
  // nochmal für das Gymnasium (Pädagogischer Tag; ohne Konflikt): Hinweis auch dort, Sitzungen rücken
  const r2 = await call(c, FD.routeFreeDayCreate, "POST", "/x", body(PTAG, { shift: true }));
  assert.deepEqual(r2.data.shifted.map((x) => [x.unitId, x.moved]), [[gym.id, 5]]);
  const g2 = await unitGet(c, gym.id);
  assert.deepEqual(g2.rows.map((x) => x.date), ["2026-11-02", "2026-11-16", "2026-11-18", null, null, null], "Pädagogischer Tag und Herbstferien: ab Stunde 2 auf Mo 16./Mi 18.");
  assert.deepEqual([g2.revise.open, g2.revise.items[0].kind, g2.revise.items[0].scope], [true, "free", "gym"]);
  assert.equal((await les(gym.ids[3])).lesson_date, null, "Gymnasium: Sitzung ohne Termin hat kein Datum");
  // Krankmeldung (Grundschule) danach: rückt nur auf Tage, die für die Grundschule nicht frei sind; der rote Kasten zählt beides
  const pre = await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, gs.ids[1]);
  assert.deepEqual(pre.data.plan.moves.map((m) => m.to && m.to.date), ["2026-11-17", "2026-11-19", null], "über die Herbstferien hinweg");
  await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.data.version }, gs.ids[1]);
  const s2 = await unitGet(c, gs.id);
  assert.deepEqual(s2.revise.items.map((x) => x.kind || "krank"), ["free", "krank"]);
  assert.equal(JSON.parse((await c.db.prepare("SELECT params FROM units WHERE id=?1").bind(gs.id).first()).params).schoolBreaks, undefined, "auch nach der Krankmeldung nicht gespeichert");
  // „Erledigt“ mit veralteter Liste: Meldung je nach Art des neuen Eintrags
  const done = await call(c, U.routeUnitPatch, "PATCH", "/x", { reviseDone: true, reviseSeen: [s2.revise.items[1].id] }, gs.id);
  assert.equal(done.data.error, "Inzwischen wurden wegen unterrichtsfreier Tage weitere Stunden verschoben – der Hinweis bleibt. Bitte neu laden.");
});

test("Datum auf einem freien Tag: Sitzung ändern/anlegen, Tabelle der Einheit, Sitzungen anlegen – abgelehnt; bisherige Daten bleiben speicherbar", async () => {
  const { c, gs, gym } = await setup();
  await call(c, FD.routeFreeDayCreate, "POST", "/x", body(PTAG, { shift: false }));
  const p = await call(c, L.routeLessonPatch, "PATCH", "/x", { date: "2026-11-04" }, gym.ids[0]);
  assert.deepEqual([p.status, p.data.code, p.data.error], [400, "free_day", "Am Mi, 04.11.2026 ist unterrichtsfrei (Pädagogischer Tag, Gymnasium). Bitte einen anderen Tag wählen."]);
  assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { date: "2026-11-04" }, gs.ids[0])).status, 200, "Grundschule: am Pädagogischen Tag des Gymnasiums erlaubt");
  assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { title: "Neu" }, gym.ids[1])).status, 200, "Sitzung, die schon am freien Tag liegt: Titel ändern geht");
  await assert.rejects(L.createLesson(c.db, { subject: "powi", klass: "8A", title: "x", date: "2026-11-04" }, c.now), (e) => e.code === "free_day");
  const g = await unitGet(c, gym.id);
  const t = await call(c, U.routeUnitPatch, "PATCH", "/x", { rows: g.rows.map((r, i) => (i === 0 ? { ...r, date: "2026-11-04" } : r)) }, gym.id);
  assert.deepEqual([t.status, t.data.error], [400, "Stunde 1: Am Mi, 04.11.2026 ist unterrichtsfrei (Pädagogischer Tag, Gymnasium). Bitte einen anderen Tag wählen."]);
  assert.equal((await call(c, U.routeUnitPatch, "PATCH", "/x", { rows: g.rows }, gym.id)).status, 200, "Stunde 2 liegt schon am freien Tag – unverändert speicherbar");
  const lesson = (await call(c, L.routeLessonGet, "GET", "/x", undefined, gym.ids[1])).data.lesson;
  assert.deepEqual(lesson.freeDay, { from: "2026-11-04", to: "2026-11-04", label: "Pädagogischer Tag", scope: "gym" });
  assert.equal((await call(c, L.routeLessonGet, "GET", "/x", undefined, gym.ids[0])).data.lesson.freeDay, null);
  // „Sitzungen anlegen“ für eine Zeile ohne Sitzung auf einem freien Tag
  const u = (await call(c, U.routeUnitCreate, "POST", "/x", { subject: "powi", klass: "9A", title: "Neu", params: { start: "2026-11-02", end: "2026-11-06", weekdays: GYM_TT } })).data.unit;
  await call(c, U.routeUnitPatch, "PATCH", "/x", { plan: { lernaufgabe: "Z" }, rows: [{ stundenfrage: "A", ablauf: ["x"], date: "2026-11-02" }, { stundenfrage: "B", ablauf: ["x"], date: "2026-11-02" }] }, u.id);
  await c.db.prepare("UPDATE units SET rows=json_set(rows, '$[1].date', '2026-11-04') WHERE id=?1").bind(u.id).run();
  const mk = await call(c, U.routeUnitSessions, "POST", "/x", undefined, u.id);
  assert.deepEqual([mk.status, mk.data.error], [400, "Stunde 2: Am Mi, 04.11.2026 ist unterrichtsfrei (Pädagogischer Tag, Gymnasium). Bitte „Termine neu verteilen“ oder in der Tabelle ein anderes Datum eintragen."]);
  // Termine neu verteilen und extend_unit wählen nur freie Termine
  const re = await call(c, U.routeUnitPatch, "PATCH", "/x", { rows: (await unitGet(c, u.id)).rows, assignDates: true }, u.id);
  assert.deepEqual(re.data.unit.rows.map((r) => r.date), ["2026-11-02", null], "Mi frei, Ende Fr: nur ein Termin");
  const ext = await U.extendUnit(c.db, await U.getUnit(c.db, u.id), { baseVersion: re.data.unit.version, termine: 1 }, "claude", c.now);
  assert.equal(ext.end, "2026-11-09", "extend_unit: nächster Termin nach dem Ende, den Pädagogischen Tag übersprungen");
  assert.equal(JSON.parse((await c.db.prepare("SELECT params FROM units WHERE id=?1").bind(u.id).first()).params).schoolBreaks, undefined, "extend_unit speichert die Schultage nicht");
});

test("Kalender, Druckaufträge, Podcast-Tag, Connector, Prompts der Überarbeitung, Sicherung", async () => {
  const { c, gs, gym } = await setup();
  await call(c, FD.routeFreeDayCreate, "POST", "/x", body(HERBST, { shift: true }));
  await call(c, FD.routeFreeDayCreate, "POST", "/x", body({ ...PTAG, from: "2026-11-16", to: "2026-11-16", label: "Brückentag" }, { shift: false }));
  // Kalender: Einträge und Sitzungen an freien Tagen in einem Batch
  c.db.counter.n = 0;
  const sch = (await call(c, U.routeSchedule, "GET", "/x")).data;
  assert.ok(c.db.counter.n <= 6, "D1-Anweisungen des Kalenders: " + c.db.counter.n);
  assert.deepEqual(sch.freeDays.map((f) => f.label), ["Herbstferien", "Brückentag"]);
  assert.deepEqual(sch.freeLessons.map((l) => [l.id, l.date]), [[gym.ids[2], "2026-11-16"]], "nur die Sitzung, die am freien Tag ihrer Schule liegt (Stunde 3 nach dem Verschieben)");
  // Druckaufträge/Podcast: der nächste Schultag überspringt die Herbstferien (heute Fr, 06.11.)
  c.now = at("2026-11-06T09:00:00Z");
  const pn = (await call(c, PJ.routePrintNext, "GET", "/x")).data;
  assert.deepEqual([pn.candidate, pn.date], ["2026-11-09", "2026-11-16"], "Montag (Herbstferien) → Montag danach (Sitzung am Brückentag bleibt eine Sitzung)");
  c.now = NOW;
  // Connector: Abschnitt in get_unit, Satz in get_planning_basis nur mit Einträgen der Schule, update_lesson lehnt ab
  const gu = await mcp(c, "get_unit", { unit_id: gym.id });
  assert.ok(gu.text.includes("## Unterrichtsfreie Tage (Gymnasium) – aus den Einstellungen der Lehrkraft\n- Herbstferien: Mo, 09.11.2026 – Fr, 13.11.2026\n- Brückentag: Mo, 16.11.2026"), gu.text);
  assert.ok(gu.text.includes("## Verschoben wegen unterrichtsfreier Tage\n- Herbstferien (Mo, 09.11.2026 – Fr, 13.11.2026): „Stunde 3“ und alle folgenden Stunden"));
  assert.ok(gu.text.includes("Muss überarbeitet werden: ja") && gu.text.includes("Stunden ohne Termin: Stunde 5 „Stunde 5“; Stunde 6 „Stunde 6“"));
  const su = await mcp(c, "get_unit", { unit_id: gs.id });
  assert.ok(su.text.includes("## Unterrichtsfreie Tage (Grundschule)") && su.text.includes("## Verschoben wegen unterrichtsfreier Tage") && !su.text.includes("## Ausfälle") && !su.text.includes("Brückentag"));
  const pb = await mcp(c, "get_planning_basis", { unit_id: gym.id });
  assert.ok(pb.text.includes("Unterrichtsfreie Tage: Die Lehrkraft hat in den Einstellungen unterrichtsfreie Tage für das Gymnasium eingetragen."));
  const ul = await mcp(c, "update_lesson", { lesson_id: gym.ids[0], datum: "2026-11-10" });
  assert.ok(ul.isError && ul.text.includes("Am Di, 10.11.2026 ist unterrichtsfrei (Herbstferien, beide Schulen)."));
  const gl = await mcp(c, "get_lesson", { lesson_id: gs.ids[2] });
  assert.ok(gl.text.includes("Wegen unterrichtsfreier Tage verschoben (Herbstferien)") && !gl.text.includes("krank"));
  // Prompts der Überarbeitung
  const sFull = await unitGet(c, gs.id), gFull = await unitGet(c, gym.id);
  const gsPrompt = claudeUnitRevisionPrompt({ unit: sFull, now: NOW });
  assert.ok(gsPrompt.includes("Wegen unterrichtsfreier Tage (Herbstferien: Mo, 09.11.2026–Fr, 13.11.2026) hat Unterricks die betroffenen und alle folgenden Stunden der Einheit " + gs.id) && !gsPrompt.includes("krank")
    && gsPrompt.includes("trotz der wegfallenden Termine") && gsPrompt.includes("- Unterrichtsfreie Tage der Grundschule im Zeitraum (aus meinen Einstellungen, ohne Termine): Herbstferien"));
  const gymPrompt = P.claudeGymRevisionPrompt({ unit: gFull, now: NOW });
  assert.ok(gymPrompt.includes("an einem Gymnasium in Hessen") && gymPrompt.includes("ohne Termin: Stunde 5 „Stunde 5“, Stunde 6 „Stunde 6“") && gymPrompt.includes("`extend_unit`") && gymPrompt.includes("`update_unit_row`"));
  // Sicherung: Übersicht nennt die Einträge; die Einheitsdatei enthält die Schultage nicht
  const idx = (await call(c, R.routeBackupIndex, "GET", "/x")).data;
  assert.deepEqual(idx.freeDays.map((f) => f.label), ["Herbstferien", "Brückentag"]);
  assert.equal(UF.unitFileData(gFull).source.params.schoolBreaks, undefined);
});

test("Krankmeldung ohne unterrichtsfreie Tage: Prompt und Kasten-Text wie bisher (Grundschule)", async () => {
  const { c, gs } = await setup();
  const pre = await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, gs.ids[2]);
  await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.data.version }, gs.ids[2]);
  const u = await unitGet(c, gs.id);
  const t = claudeUnitRevisionPrompt({ unit: u, now: NOW });
  assert.ok(t.includes("Wegen Ausfällen (Lehrkraft krank: Di, 10.11.2026 08:00) hat Unterricks die ausgefallene und alle folgenden Stunden der Einheit") && t.includes("trotz der Ausfälle ihre zentrale Lernaufgabe"));
  assert.ok(!t.includes("unterrichtsfrei") && !t.includes("Unterrichtsfreie"));
});

test("Gymnasium nach dem Verschieben: extend_unit gibt Sitzungen ohne Termin einen Termin; save_unit_plan (nach Position) datiert sie und nimmt den Hinweis weg", async () => {
  const { c, gym } = await setup();
  await call(c, FD.routeFreeDayCreate, "POST", "/x", body(HERBST, { shift: true }));
  let g = await unitGet(c, gym.id);
  assert.deepEqual(g.rows.map((r) => r.date), ["2026-11-02", "2026-11-04", "2026-11-16", "2026-11-18", null, null]);
  const ext = await U.extendUnit(c.db, await U.getUnit(c.db, gym.id), { baseVersion: g.version, termine: 1 }, "claude", c.now);
  assert.deepEqual([ext.end, ext.rows.map((r) => [r.n, r.date, r.lessonId])], ["2026-11-23", [[5, "2026-11-23", gym.ids[4]]]], "Stunde 5 (mit Sitzung ohne Termin) bekommt den neuen Termin");
  assert.equal((await c.db.prepare("SELECT lesson_date FROM lessons WHERE id=?1").bind(gym.ids[4]).first()).lesson_date, "2026-11-23", "… samt ihrer Sitzung");
  // Claude speichert den überarbeiteten Plan (Gymnasium: nach Position) – die Einheit endet jetzt später, Stunde 6 bekommt den nächsten Termin
  await c.db.prepare("UPDATE units SET params=json_set(params, '$.end', '2026-11-25') WHERE id=?1").bind(gym.id).run();
  g = await unitGet(c, gym.id);
  const r = await mcp(c, "save_unit_plan", { unit_id: gym.id, base_version: g.version, plan: { lernaufgabe: "Ziel", schritte: [{ titel: "A", beschreibung: "B" }] },
    stunden: g.rows.map((x) => ({ stundenfrage: x.stundenfrage + " (überarbeitet)", ablauf: ["neu"] })) });
  assert.ok(!r.isError && r.text.includes("Der Hinweis zum Überarbeiten in der Einheit ist entfernt."), r.text);
  g = await unitGet(c, gym.id);
  assert.deepEqual([g.rows[5].date, g.revise.open], ["2026-11-25", false]);
  assert.equal((await c.db.prepare("SELECT lesson_date, start_time FROM lessons WHERE id=?1").bind(gym.ids[5]).first()).lesson_date, "2026-11-25", "die Sitzung ohne Termin hat jetzt den ihrer Zeile");
  assert.equal((await c.db.prepare("SELECT lesson_date FROM lessons WHERE id=?1").bind(gym.ids[0]).first()).lesson_date, "2026-11-02", "andere Sitzungen unberührt");
});

/* ---------- Prüfung der Terminlogik (Befunde) ---------- */
test("CPU: gesäuberte Listen werden wiedererkannt (eingefroren, keine neue Prüfung je Datum); ohne Beginn und Ende keine Schultage in den Rahmendaten", () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ id: (i + 1).toString(16).padStart(16, "0"), from: "2026-11-04", to: "2026-11-04", label: "Tag " + i, scope: i % 2 ? "gs" : "gym" }));
  const clean = P.cleanFreeDays(many);
  assert.equal(P.cleanFreeDays(clean), clean, "dieselbe Liste ohne neue Prüfung");
  assert.ok(Object.isFrozen(clean) && clean.every((f) => Object.isFrozen(f)), "eingefroren – niemand ändert eine schon geprüfte Liste");
  assert.notEqual(P.cleanFreeDays([...clean]), clean, "eine neue (ungeprüfte) Liste wird geprüft");
  assert.deepEqual(P.cleanFreeDays([...clean]), clean);
  // je Zeile einer Einheit (Tabelle, Sitzungen anlegen): 150 Prüfungen gegen 200 Einträge ohne erneutes Säubern
  const t0 = performance.now();
  for (let i = 0; i < 150; i++) P.freeDateError(i % 2 ? "2026-11-04" : "2026-11-05", clean, "powi");
  assert.ok(performance.now() - t0 < 60, "150 Datumsprüfungen gegen 200 Einträge: " + (performance.now() - t0).toFixed(1) + " ms");
  // Rahmendaten ohne Beginn und Ende: keine Schultage (nichts rechnet damit); nur mit Ende: ab dem Ende (extend_unit)
  assert.deepEqual(P.withSchoolBreaks({ weekdays: GYM_TT }, [HERBST], "powi"), { weekdays: GYM_TT });
  assert.deepEqual(P.withSchoolBreaks({ weekdays: GYM_TT, schoolBreaks: [{ from: "2026-11-09", to: "2026-11-13", label: "x" }] }, [HERBST], "powi"), { weekdays: GYM_TT }, "auch keine mitgebrachten");
  assert.deepEqual(P.withSchoolBreaks({ end: "2026-11-06", weekdays: GYM_TT }, [HERBST, PTAG], "powi").schoolBreaks.map((b) => b.label), ["Herbstferien"], "ohne Beginn: ab dem Ende");
  assert.deepEqual(P.slotsAfterEnd(P.withSchoolBreaks({ end: "2026-11-06", weekdays: GYM_TT }, [HERBST], "powi"), 1, NOW).map((s) => s.date), ["2026-11-16"]);
});

test("Speichern und verschieben: Eintrag inzwischen gelöscht bzw. nicht angelegt – dann wird auch nichts verschoben", async () => {
  const { c, gs, gym } = await setup();
  const dates = async (id) => (await unitGet(c, id)).rows.map((r) => r.date);
  const gsBefore = await dates(gs.id), gymBefore = await dates(gym.id);
  const lessonDates = async () => (await c.db.prepare("SELECT id, lesson_date FROM lessons ORDER BY id").all()).results;
  const before = await lessonDates();
  // Ändern: zwischen dem Lesen und dem Schreiben löscht ein anderes Fenster den Eintrag
  const saved = await call(c, FD.routeFreeDayCreate, "POST", "/x", body({ ...HERBST, from: "2026-11-13", to: "2026-11-13" }, { shift: true }));
  assert.equal(saved.status, 200);
  const id = saved.data.freeDay.id, orig = c.db.batch;
  let n = 0;
  c.db.batch = async (list) => { if (++n === 2) { c.db.batch = orig; await c.db.prepare("DELETE FROM free_days WHERE id=?1").bind(id).run(); } return orig(list); };
  const put = await call(c, FD.routeFreeDayPut, "PUT", "/x", body(HERBST, { shift: true }), id);
  assert.deepEqual([put.status, put.data.error], [404, "Diesen unterrichtsfreien Eintrag gibt es nicht (mehr)."]);
  assert.deepEqual([await dates(gs.id), await dates(gym.id)], [gsBefore, gymBefore], "keine Einheit verschoben");
  assert.deepEqual(await lessonDates(), before, "keine Sitzung verschoben");
  assert.equal((await unitGet(c, gs.id)).revise, undefined, "kein Hinweis zum Überarbeiten");
  // Neu: inzwischen 200 Einträge (gleichzeitig angelegt) – der Eintrag wird nicht gespeichert, also auch nichts verschoben
  n = 0;
  c.db.batch = async (list) => {
    if (++n === 2) { c.db.batch = orig;
      await c.db.prepare("INSERT INTO free_days(id, date_from, date_to, label, scope, created_at, updated_at) SELECT printf('%016x', value + 100), '2030-01-01', '2030-01-01', 'Tag', 'gs', 1, 1 FROM json_each(?1)")
        .bind(JSON.stringify(Array.from({ length: 200 }, (_, i) => i))).run(); }
    return orig(list);
  };
  const add = await call(c, FD.routeFreeDayCreate, "POST", "/x", body(HERBST, { shift: true }));
  assert.deepEqual([add.status, add.data.error], [400, "Höchstens 200 unterrichtsfreie Einträge – bitte zuerst vergangene löschen."]);
  assert.deepEqual([await dates(gs.id), await dates(gym.id)], [gsBefore, gymBefore]);
  assert.deepEqual(await lessonDates(), before);
});

test("Krankmeldung rückgängig: nie zurück auf einen Tag, der inzwischen für die Grundschule unterrichtsfrei ist", async () => {
  const { c, gs } = await setup();
  const pre = await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, gs.ids[1]);
  const done = await call(c, GS.routeLessonCancel, "POST", "/x", { version: pre.data.version }, gs.ids[1]);
  assert.equal(done.status, 200);
  const after = await unitGet(c, gs.id);
  assert.deepEqual(after.rows.map((r) => r.date), ["2026-11-03", "2026-11-10", "2026-11-12", "2026-11-17", "2026-11-19", null]);
  // am Do, 05.11. (nur noch der Ausfall-Eintrag) ist inzwischen Schulfest – die Vorschau fragt nicht (keine Sitzung dort), die Einheit bleibt unverändert
  const p2 = await call(c, FD.routeFreeDaysPreview, "POST", "/x", body(GSTAG));
  assert.deepEqual(p2.data.items, []);
  await call(c, FD.routeFreeDayCreate, "POST", "/x", body(GSTAG, { shift: false }));
  const u = await unitGet(c, gs.id);
  assert.equal(u.revise.canUndo, true);
  const r = await call(c, GS.routeCancelUndo, "POST", "/x", { undoId: u.revise.undoId }, gs.id);
  assert.deepEqual([r.status, r.data.code, r.data.error], [409, "free_day", "Am Do, 05.11.2026 ist inzwischen unterrichtsfrei (Schulfest, Grundschule) – die Krankmeldung lässt sich deshalb nicht mehr rückgängig machen. Bitte die Termine von Hand anpassen."]);
  assert.deepEqual((await unitGet(c, gs.id)).rows.map((x) => x.date), after.rows.map((x) => x.date), "nichts zurückgelegt");
  assert.equal((await c.db.prepare("SELECT lesson_date FROM lessons WHERE id=?1").bind(gs.ids[1]).first()).lesson_date, "2026-11-10");
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM lessons WHERE cancelled=1").first()).n, 1, "der Ausfall-Eintrag bleibt");
  // ein unterrichtsfreier Tag nur des Gymnasiums hält „rückgängig“ nicht auf
  await c.db.prepare("UPDATE free_days SET scope='gym'").run();
  const ok = await call(c, GS.routeCancelUndo, "POST", "/x", { undoId: u.revise.undoId }, gs.id);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.deepEqual(ok.data.unit.rows.map((x) => x.date), ["2026-11-03", "2026-11-05", "2026-11-10", "2026-11-12", "2026-11-17", "2026-11-19"]);
});

test("D1: Tabelle des Gymnasiums mit 40 geänderten Sitzungsterminen bleibt bei höchstens 50 Anweisungen (unterrichtsfreie Tage einmal gelesen)", async () => {
  const { c } = await setup();
  await call(c, FD.routeFreeDayCreate, "POST", "/x", body({ ...HERBST, from: "2027-03-22", to: "2027-03-26", label: "Osterferien" }, { shift: false }));
  const unit = (await call(c, U.routeUnitCreate, "POST", "/x", { subject: "powi", klass: "9B", title: "Lang", params: { start: "2026-11-16", end: "2027-06-30", weekdays: GYM_TT } })).data.unit;
  const rows = Array.from({ length: 24 }, (_, i) => ({ stundenfrage: "S" + (i + 1), ablauf: ["x"] }));
  await call(c, U.routeUnitPatch, "PATCH", "/x", { plan: { lernaufgabe: "Z" }, rows, assignDates: true }, unit.id);
  const made = await call(c, U.routeUnitSessions, "POST", "/x", undefined, unit.id);
  assert.equal(made.data.created, 24);
  const u = made.data.unit;
  // jede Zeile eine Woche später und mit anderer Uhrzeit: je Sitzung zwei Anweisungen (höchstens 40); Anmeldung mit Auffrischen des Tokens
  await c.db.prepare("UPDATE teacher_tokens SET last_used=?1").bind(c.now - 2 * 3600e3).run();
  c.db.counter.n = 0;
  const r = await call(c, U.routeUnitPatch, "PATCH", "/x", { rows: u.rows.map((x) => ({ ...x, date: addDays7(x.date), time: "09:30" })), baseVersion: u.version }, unit.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(c.db.counter.n <= 49, "D1-Anweisungen: " + c.db.counter.n);
  assert.deepEqual(r.data.unit.rows.map((x) => x.date), u.rows.map((x) => addDays7(x.date)));
  assert.ok(r.data.unit.params.schoolBreaks && r.data.unit.params.schoolBreaks[0].label === "Osterferien", "Antwort mit den Schultagen");
});
const addDays7 = (d) => new Date(Date.parse(d + "T12:00:00Z") + 7 * 86400e3).toISOString().slice(0, 10);

/* ---------- Prüfung der Abläufe der Lehrkraft (Befunde) ---------- */
test("Connector und Prompts: Stunden, die nach „Nur speichern“ an einem freien Tag liegen, sind markiert; Gymnasium ohne Termin und Hinweis wie im Prompt; ohne freie Tage wie bisher", async () => {
  const { c, gs, gym } = await setup();
  // ohne unterrichtsfreie Tage: get_lesson und get_unit ohne die neuen Zeilen (byte-gleich zu vorher)
  const gl0 = await mcp(c, "get_lesson", { lesson_id: gym.ids[2] }), gu0 = await mcp(c, "get_unit", { unit_id: gym.id }), sl0 = await mcp(c, "get_lesson", { lesson_id: gs.ids[2] });
  for (const t of [gl0.text, gu0.text, sl0.text]) assert.ok(!/unterrichtsfrei|noch keinen Termin|\[ohne Termin\]|Trotzdem an einem/.test(t), t);
  const p0 = P.claudeGymRevisionPrompt({ unit: await unitGet(c, gym.id), now: NOW });
  assert.ok(!p0.includes("liegt auf einem unterrichtsfreien Tag"));
  // Herbstferien (verschieben) und ein Brückentag am Mo, 16.11. (nur speichern): Stunde 3 des Gymnasiums liegt danach dort
  await call(c, FD.routeFreeDayCreate, "POST", "/x", body(HERBST, { shift: true }));
  await call(c, FD.routeFreeDayCreate, "POST", "/x", body({ ...PTAG, from: "2026-11-16", to: "2026-11-16", label: "Brückentag", scope: "both" }, { shift: false }));
  const gu = (await mcp(c, "get_unit", { unit_id: gym.id })).text;
  assert.ok(gu.includes("Trotzdem an einem dieser Tage (die Lehrkraft hat die Sitzungen beim Eintragen dort gelassen): Stunde 3 „Stunde 3“ am Mo, 16.11.2026 (Brückentag). " +
    "Frage die Lehrkraft, ob sie einen anderen Termin bekommen sollen – verschiebe sie nur mit ihrer Zustimmung."), gu);
  assert.ok(gu.includes("- " + gym.ids[4] + " [ohne Termin]: Stunde 5") && gu.includes("- " + gym.ids[0] + " Mo, 02.11.2026: Stunde 1"), "Sitzungen ohne Termin als solche benannt");
  assert.ok(gu.includes("Inhalte und Stundenfragen mit update_unit_row und der Nummer nr jeder Stunde") && !gu.includes("zusammenlegen oder kürzen mit save_unit_plan"),
    "Gymnasium: wie der Prompt – save_unit_plan ordnet nach Position zu");
  const su = (await mcp(c, "get_unit", { unit_id: gs.id })).text;
  assert.ok(!su.includes("Trotzdem an einem dieser Tage"), "Grundschule: keine ihrer Stunden liegt am Brückentag (verschoben auf Di/Do)");
  const gl = (await mcp(c, "get_lesson", { lesson_id: gym.ids[2] })).text;
  assert.ok(gl.includes("Achtung: Am Mo, 16.11.2026 ist laut den Einstellungen der Lehrkraft unterrichtsfrei (Brückentag) – diese Sitzung liegt trotzdem dort") &&
    gl.includes("Wegen unterrichtsfreier Tage verschoben (Herbstferien): die Stunden sind auf die nächsten freien Termine gerückt. Die Einheit muss deshalb überarbeitet werden"), gl);
  const gl5 = (await mcp(c, "get_lesson", { lesson_id: gym.ids[4] })).text;
  assert.ok(gl5.includes("Diese Sitzung hat noch keinen Termin – sie ist beim Verschieben hinter das Ende der Einheit gerutscht; einen Termin bekommt sie mit extend_unit") && !gl5.includes("Achtung: Am"), gl5);
  const p = P.claudeGymRevisionPrompt({ unit: await unitGet(c, gym.id), now: NOW });
  assert.ok(p.includes("3. Mo, 16.11.2026 08:00 (45 Min.): „Stunde 3“ – Sitzung " + gym.ids[2] + " – liegt auf einem unterrichtsfreien Tag (Brückentag)"), p);
  assert.equal(p.match(/liegt auf einem unterrichtsfreien Tag/g).length, 1);
  // in der Vergangenheit nie markiert (dort wird nichts mehr geplant)
  assert.ok(!P.claudeGymRevisionPrompt({ unit: await unitGet(c, gym.id), now: at("2026-11-17T10:00:00Z") }).includes("liegt auf einem unterrichtsfreien Tag"));
  // Grundschule: eine Stunde an einem Tag, der danach nur für die Grundschule frei wird („Nur speichern“)
  await call(c, FD.routeFreeDayCreate, "POST", "/x", body({ ...GSTAG, from: "2026-11-17", to: "2026-11-17", label: "Schulfest" }, { shift: false }));
  const sp = claudeUnitRevisionPrompt({ unit: await unitGet(c, gs.id), now: NOW });
  assert.ok(/3\. \[uid [a-f0-9]{8}\] Di, 17\.11\.2026 08:00 \(45 Min\.\): „Stunde 3“ – Sitzung [a-f0-9]+ – noch nicht geplant – liegt auf einem unterrichtsfreien Tag \(Schulfest\)/.test(sp), sp);
  const sl = (await mcp(c, "get_lesson", { lesson_id: gs.ids[2] })).text;
  assert.ok(sl.includes("Achtung: Am Di, 17.11.2026 ist laut den Einstellungen der Lehrkraft unterrichtsfrei (Schulfest)"), sl);
  assert.ok((await mcp(c, "get_unit", { unit_id: gs.id })).text.includes("Stunde 3 „Stunde 3“ am Di, 17.11.2026 (Schulfest)"));
});

test("freeBreakOf/freeRowNote: Eintrag der Schule für einen Tag aus params.schoolBreaks; ohne Einträge null bzw. leer; nur heute oder später", () => {
  const params = P.withSchoolBreaks({ start: "2026-11-02", end: "2026-11-30", weekdays: GYM_TT }, [HERBST, PTAG, GSTAG], "powi");
  const on = P.freeBreakOf(params);
  assert.equal(on("2026-11-10").label, "Herbstferien");
  assert.equal(on("2026-11-04").label, "Pädagogischer Tag");
  assert.equal(on("2026-11-05"), null, "Tag der Grundschule zählt am Gymnasium nicht");
  assert.equal(on(null), null);
  assert.equal(P.freeBreakOf({ start: "2026-11-02", end: "2026-11-30" })("2026-11-10"), null);
  assert.equal(P.freeRowNote(on, "2026-11-10", "2026-11-02"), " – liegt auf einem unterrichtsfreien Tag (Herbstferien)");
  assert.equal(P.freeRowNote(on, "2026-11-10", "2026-11-11"), "", "vergangene Tage nicht markiert");
  assert.equal(P.freeRowNote(on, "2026-11-03", "2026-11-02"), "");
});
