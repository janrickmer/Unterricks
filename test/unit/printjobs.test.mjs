// Druckaufträge für den nächsten Arbeitstag (Anforderung 14): Zieltag (planning.js) und GET /api/teacher/print-next (worker/printjobs.js)
// mit D1 auf SQLite. Jede Prüfung legt „jetzt“ fest (c.now) – unabhängig vom Wochentag, an dem die Tests laufen.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const { fakeCtx } = await import("./fake-d1.mjs");
const { routePrintNext, PRINT_FILES_SQL, FIRST_DAY_SQL, DAY_SESSIONS_SQL } = await import("../../worker/printjobs.js");
const { routeSchedule } = await import("../../worker/units.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { nextWorkday, printTargetDay, PRINT_AHEAD_DAYS } = await import("../../public/planning.js");

const TOKEN = "lehrkraft-token-druck";
// Ortszeit Berlin im November (MEZ = UTC+1): berlin(17, 10, 0) = Dienstag, 17.11.2026, 10:00
const berlin = (day, hh = 10, mm = 0) => Date.UTC(2026, 10, day, hh - 1, mm);
async function ctx(now) {
  const c = fakeCtx();
  c.now = now;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), now, now + 3600e3).run();
  return c;
}
const call = async (c, fn = routePrintNext, path = "/api/teacher/print-next") => {
  const req = new Request("https://unterricks.test" + path, { headers: { Authorization: "Bearer " + TOKEN } });
  const res = await fn({ ...c, request: req, waitUntil: () => {} });
  return { status: res.status, data: await res.json() };
};
let seq = 0;
const hex = (n) => (++seq).toString(16).padStart(n, "0");
const unit = (c, subject, klass, params) => c.db.prepare("INSERT INTO units(id, subject, klass, title, params, created_at, updated_at) VALUES(?1, ?2, ?3, 'E', ?4, ?5, ?5)")
  .bind(hex(16), subject, klass, JSON.stringify({ breaks: [], ...params }), ++seq).run();
async function lesson(c, { subject = "powi", klass = "8A", date, time = null, title = "Stunde", cancelled = 0 }) {
  const id = hex(16);
  await c.db.prepare("INSERT INTO lessons(id, subject, klass, title, lesson_date, start_time, duration_min, code, cancelled, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, 45, ?7, ?8, 1, 1)")
    .bind(id, subject, klass, title, date, time, "C" + hex(5), cancelled).run();
  return id;
}
async function file(c, lessonId, { area = "print", kind = "file", name, copies = null, duplex = 1, color = 0, html = null, status = "ready", pdfAt = null, cards = null, text = null }) {
  const id = hex(16);
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, text, status, source, created_at, updated_at, print_copies, print_duplex, print_color, html, html_at, pdf_at, cards) " +
    "VALUES(?1, ?2, ?3, ?4, ?5, 'application/pdf', 1234, ?6, ?7, 'upload', ?8, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)")
    .bind(id, lessonId, area, kind, name, text, status, ++seq, copies, duplex, color, html, html ? 5 : null, pdfAt, cards).run();
  return id;
}
const gsCourse = (c, id = "gs1a2b3c4d") => c.db.prepare("INSERT INTO gs_courses(id, grade, classes, religion, subject_name, description, school_year, created_at, updated_at) VALUES(?1, 2, '[\"a\",\"b\"]', 1, 'Religion', '', '2026/27', 1, 1)").bind(id).run().then(() => id);
const WED = [{ day: 3, minutes: 45, time: "08:00" }], MON = [{ day: 1, minutes: 90, time: "09:50" }];

test("nächster Arbeitstag: Montag bis Donnerstag der folgende Tag, Freitag, Samstag und Sonntag der Montag", () => {
  // 16.11.2026 ist ein Montag
  const want = { "2026-11-16": "2026-11-17", "2026-11-17": "2026-11-18", "2026-11-18": "2026-11-19", "2026-11-19": "2026-11-20",
    "2026-11-20": "2026-11-23", "2026-11-21": "2026-11-23", "2026-11-22": "2026-11-23", "2026-12-31": "2027-01-01", "2027-01-01": "2027-01-04" };
  for (const [d, n] of Object.entries(want)) assert.equal(nextWorkday(d), n, d);
  assert.equal(nextWorkday("2026-13-01"), null); assert.equal(nextWorkday(""), null);
});

test("Zieltag: nächster Tag mit Unterricht laut Stundenplan (Ferien, Ausfälle) oder mit Sitzung; nichts in 70 Tagen → null", () => {
  const u = (params) => ({ params: { start: "2026-11-02", end: "2026-12-18", breaks: [], ...params } });
  assert.equal(printTargetDay("2026-11-18", [u({ weekdays: WED })]), "2026-11-18", "Mittwoch hat Unterricht");
  assert.equal(printTargetDay("2026-11-17", [u({ weekdays: WED })]), "2026-11-18", "Dienstag ohne Unterricht → Mittwoch");
  // Ferien: Herbstwoche 23.–27.11. (nur Montags-Unterricht) → Montag nach den Ferien
  assert.equal(printTargetDay("2026-11-23", [u({ weekdays: MON, breaks: [{ from: "2026-11-23", to: "2026-11-27", label: "Ferien" }] })]), "2026-11-30");
  // ausgefallener Termin (Krankmeldung, Grundschule) zählt nicht
  assert.equal(printTargetDay("2026-11-18", [u({ weekdays: WED, cancelled: [{ date: "2026-11-18", time: "08:00" }] })]), "2026-11-25");
  // nur eine Sitzung (ohne Einheit) – früher als der Stundenplan
  assert.equal(printTargetDay("2026-11-17", [u({ weekdays: WED })], ["2026-11-17"]), "2026-11-17");
  assert.equal(printTargetDay("2026-11-17", [], ["2026-11-19", "2026-11-16"]), "2026-11-19", "Sitzungen vor dem Kandidaten zählen nicht");
  // mehrere Einheiten: die früheste gewinnt; Einheit vorbei bzw. noch nicht begonnen
  assert.equal(printTargetDay("2026-11-17", [u({ weekdays: MON }), u({ weekdays: [{ day: 4, minutes: 45, time: null }] })]), "2026-11-19");
  assert.equal(printTargetDay("2026-11-17", [{ params: { start: "2026-09-01", end: "2026-11-13", weekdays: WED } }]), null, "Einheit schon vorbei");
  assert.equal(printTargetDay("2026-11-17", [{ params: { start: "2026-12-01", end: "2027-01-31", weekdays: WED, breaks: [] } }]), "2026-12-02");
  // Suchfenster: höchstens 70 Tage
  assert.equal(PRINT_AHEAD_DAYS, 70);
  assert.equal(printTargetDay("2026-11-17", [], ["2027-01-26"]), "2027-01-26", "70 Tage nach dem 17.11.");
  assert.equal(printTargetDay("2026-11-17", [], ["2027-01-27"]), null, "71 Tage: zu weit");
  assert.equal(printTargetDay("2026-11-17", [{ params: { start: "2026-11-01", end: "2027-03-01", weekdays: [] } }]), null, "ohne Stundenplan");
  assert.equal(printTargetDay("x", [u({ weekdays: WED })]), null);
});

test("GET /api/teacher/print-next: Dateien beider Schulformen wie in der Druckliste der Sitzung, nach Beginn sortiert, ohne Text, 8 D1-Anweisungen", async () => {
  const c = await ctx(berlin(17));   // Dienstag → Mittwoch, 18.11.
  const gs = await gsCourse(c);
  await unit(c, "powi", "8A", { start: "2026-11-02", end: "2026-12-18", weekdays: WED });
  const L1 = await lesson(c, { date: "2026-11-18", time: "08:00", title: "Gewaltenteilung" });
  const L2 = await lesson(c, { subject: "gs", klass: gs, date: "2026-11-18", time: "07:55", title: "Josef" });
  const L3 = await lesson(c, { subject: "ethik", klass: "10C", date: "2026-11-18", time: "11:30", title: "Glück" });
  const L4 = await lesson(c, { subject: "gs", klass: gs, date: "2026-11-18", time: "09:50", title: "Ausfall", cancelled: 1 });
  const L5 = await lesson(c, { date: "2026-11-19", time: "08:00" });
  const L6 = await lesson(c, { subject: "evrel", klass: "9B", date: "2026-11-18", title: "Ohne Uhrzeit" });
  const pdf = await file(c, L1, { name: "AB Gewaltenteilung.pdf", copies: 28 });
  const txt = await file(c, L1, { kind: "text", name: "Tafelbild", copies: 1, duplex: 0, text: "# Tafelbild\nLang " + "x".repeat(5000) });
  const des = await file(c, L1, { name: "Gestaltet.pdf", copies: 2, color: 1, html: "<p>x</p>", status: "pending" });
  await file(c, L1, { area: "student", name: "Schueler mit Anzahl.pdf", copies: 5 });   // Gymnasium: Schülermaterial nie auf der Druckliste
  await file(c, L1, { area: "archive", name: "Archiv.pdf", copies: 3 });
  await file(c, L1, { area: "presentation", name: "Folien.pdf" });
  const kid = await file(c, L2, { area: "student", name: "Arbeitsblatt Josef.pdf", copies: 22 });
  await file(c, L2, { area: "student", name: "Bildkarten.pdf", copies: 22, cards: '{"v":1}' });   // Bildkarten nie
  await file(c, L2, { area: "student", name: "Nur ansehen.pdf" });
  await file(c, L2, { area: "teacher", name: "Vorlesetext.pdf", copies: 1 });
  const color = await file(c, L2, { name: "Ausmalbild.pdf", copies: 22, duplex: 0 });
  await file(c, L4, { name: "Ausfall.pdf", copies: 1 });   // Ausfall-Eintrag
  await file(c, L5, { name: "Donnerstag.pdf", copies: 1 });
  c.db.counter.n = 0;
  const r = await call(c);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(c.db.counter.n <= 8, "D1-Anweisungen: " + c.db.counter.n);
  assert.deepEqual([r.data.today, r.data.candidate, r.data.date], ["2026-11-17", "2026-11-18", "2026-11-18"]);
  assert.deepEqual(r.data.sessions.map((s) => s.id), [L2, L1, L3, L6], "nach Beginn (ohne Uhrzeit zuletzt); Ausfall-Eintrag und anderer Tag fehlen");
  const [g, y, e, n] = r.data.sessions;
  assert.deepEqual([g.school, g.label, g.subtitle, g.course.short, g.startTime], ["gs", "Religion 2ab", g.course.label, "Religion 2ab", "07:55"]);
  assert.match(g.subtitle, /Religion/);
  assert.deepEqual([y.school, y.label, y.subtitle, y.title, y.course], ["gym", "PoWi 8A", "Politik und Wirtschaft · 8A", "Gewaltenteilung", undefined]);
  assert.deepEqual(e.files, []); assert.deepEqual(n.files, []); assert.equal(n.startTime, null);
  assert.deepEqual(y.files.map((f) => [f.id, f.printName]), [[pdf, "28x - beidseitig - sw - AB Gewaltenteilung.pdf"], [txt, "1x - einseitig - sw - Tafelbild.pdf"], [des, "2x - beidseitig - Farbe - Gestaltet.pdf"]],
    "Reihenfolge und Namen wie in der Sitzung");
  assert.deepEqual(g.files.map((f) => [f.id, f.area, f.printName]), [[kid, "student", "22x - beidseitig - sw - Arbeitsblatt Josef.pdf"], [color, "print", "22x - einseitig - sw - Ausmalbild.pdf"]]);
  const t = y.files[1], d = y.files[2];
  assert.equal(t.kind, "text"); assert.equal("text" in t, false, "kein Text des Textmaterials");
  assert.deepEqual([d.status, d.design.outdated, d.design.error, d.design.text], ["pending", true, null, ""], "Stand der Gestaltung, ohne Claudes HTML");
  assert.ok(JSON.stringify(r.data).length < 4000, "kleine Antwort: " + JSON.stringify(r.data).length);
  // nur angemeldet
  await assert.rejects(routePrintNext({ ...c, request: new Request("https://unterricks.test/api/teacher/print-next"), waitUntil: () => {} }), (x) => x.status === 401);
});

test("print-next: Mitternacht in Berlin, Freitag → Montag, freier Tag übersprungen, nur Sitzung ohne Einheit, nichts gefunden", async () => {
  // Donnerstag 23:30 in Berlin (UTC schon 22:30): Kandidat Freitag – ohne Unterricht → Montag (Stundenplan der Ethik-Einheit)
  let c = await ctx(berlin(19, 23, 30));
  await unit(c, "ethik", "10C", { start: "2026-11-02", end: "2026-12-18", weekdays: MON });
  let r = await call(c);
  assert.deepEqual([r.data.today, r.data.candidate, r.data.date, r.data.sessions.length], ["2026-11-19", "2026-11-20", "2026-11-23", 0], "Tag ohne Sitzungen: leer");
  // Freitag 00:30 in Berlin (in UTC noch Donnerstag): Kandidat Montag
  c = await ctx(berlin(20, 0, 30));
  await unit(c, "ethik", "10C", { start: "2026-11-02", end: "2026-12-18", weekdays: MON });
  r = await call(c);
  assert.deepEqual([r.data.today, r.data.candidate, r.data.date], ["2026-11-20", "2026-11-23", "2026-11-23"]);
  // Sommerzeit (MESZ = UTC+2): Freitag, 19.06.2026, 00:30 in Berlin ist in UTC noch Donnerstag 22:30 – zählt als Freitag → Montag, 22.06.
  c = await ctx(Date.UTC(2026, 5, 18, 22, 30));
  r = await call(c);
  assert.deepEqual([r.data.today, r.data.candidate], ["2026-06-19", "2026-06-22"], "Mitternacht in der Sommerzeit");
  c = await ctx(Date.UTC(2026, 5, 18, 21, 59));   // Donnerstag 23:59 MESZ → Freitag
  r = await call(c);
  assert.deepEqual([r.data.today, r.data.candidate], ["2026-06-18", "2026-06-19"]);
  // Samstag und Sonntag → Montag; Ferienwoche ab Montag → Montag danach
  c = await ctx(berlin(22, 12));
  await unit(c, "ethik", "10C", { start: "2026-11-02", end: "2026-12-18", weekdays: MON, breaks: [{ from: "2026-11-23", to: "2026-11-27", label: "Ferien" }] });
  r = await call(c);
  assert.deepEqual([r.data.candidate, r.data.date], ["2026-11-23", "2026-11-30"]);
  // nur eine Sitzung (keine Einheit mit Stundenplan) zählt; ein Ausfall-Eintrag nicht
  c = await ctx(berlin(17));
  const id = await gsCourse(c);
  await lesson(c, { subject: "gs", klass: id, date: "2026-11-18", cancelled: 1 });
  const only = await lesson(c, { date: "2026-11-24", time: "10:00" });
  await file(c, only, { name: "Folie.pdf", copies: 1 });
  c.db.counter.n = 0;
  r = await call(c);
  assert.deepEqual([r.data.date, r.data.sessions.map((s) => s.id), r.data.sessions[0].files.length], ["2026-11-24", [only], 1]);
  assert.ok(c.db.counter.n <= 8);
  // Einheit einer Klasse, die laut Fach-Einstellungen nicht unterrichtet wird (PoWi in Jg. 7), und ohne Termine in 70 Tagen: nichts
  c = await ctx(berlin(17));
  await unit(c, "powi", "7A", { start: "2026-11-02", end: "2026-12-18", weekdays: WED });
  await unit(c, "ethik", "10C", { start: "2027-02-01", end: "2027-03-18", weekdays: MON });
  c.db.counter.n = 0;
  r = await call(c);
  assert.deepEqual([r.data.date, r.data.sessions], [null, []]);
  assert.ok(c.db.counter.n <= 6, "ohne Zieltag keine zweite Abfrage: " + c.db.counter.n);
  // der Wochenkalender nimmt dieselben Einheiten (gemeinsame Auswahl scheduleUnit) – PoWi 7A auch dort nicht
  assert.deepEqual((await call(c, routeSchedule, "/api/teacher/schedule")).data.units.map((u) => u.klass), ["10C"]);
});

test("Auswahl der Druckliste: dieselbe Regel wie printFiles() in der Sitzung (Druckliste; Grundschule auch „Auch ausdrucken“, ohne Bildkarten)", () => {
  assert.match(PRINT_FILES_SQL, /area='print' OR \(area='student' AND print_copies IS NOT NULL AND cards IS NULL AND lesson_id IN \(SELECT id FROM lessons WHERE lesson_date=\?1 AND cancelled=0 AND subject='gs'\)\)/);
  const cols = PRINT_FILES_SQL.slice("SELECT ".length, PRINT_FILES_SQL.indexOf(" FROM files")).split(", ").map((x) => x.trim());
  assert.ok(!cols.includes("text") && !cols.includes("html") && !cols.some((x) => x.includes("substr(")), "weder Text noch Claudes Gestaltung: " + cols.join(", "));
});

test("print-next liest nur die Sitzungen des Tages (Index lessons_day) – nie alle Sitzungen bei jedem Aufruf einer Startseite", () => {
  const c = fakeCtx();
  const plan = (sql, ...args) => c.db.raw.prepare("EXPLAIN QUERY PLAN " + sql).all(...args).map((r) => r.detail).join(" | ");
  for (const [sql, args] of [[PRINT_FILES_SQL, ["2026-11-18"]], [DAY_SESSIONS_SQL, ["2026-11-18"]], [FIRST_DAY_SQL, ["2026-11-18", "2027-01-27"]]]) {
    const p = plan(sql, ...args);
    assert.doesNotMatch(p, /SCAN lessons/, p);
    assert.match(p, /lessons_day/, p);
  }
});
