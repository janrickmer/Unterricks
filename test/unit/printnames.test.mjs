// Nachtrag 32 (16.11.2026): Dateinamen aller Dateien, die die Lehrkraft ausdruckt – „23x - sw - einseitig - Reli4 - Titel.pdf“ (Anzahl, schwarz-weiß/farbig,
// einseitig/beidseitig, Kurs, Titel). Der Worker kennt den Kurs überall, wo er einen Druck-Namen baut (eine Spalte in derselben Anweisung, keine weitere je
// Datei); der Name entsteht beim Ausliefern – auch ältere Dateien und nach einer Änderung des Grundschulkurses. Server mit der D1-Nachbildung.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const { fakeCtx } = await import("./fake-d1.mjs");
const GS = await import("../../worker/gs.js");
const L = await import("../../worker/lessons.js");
const F = await import("../../worker/files.js");
const PJ = await import("../../worker/printjobs.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");
const S = await import("../../public/shared.js");

const TOKEN = "lehrkraft-token-123";
const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Pages /Count 1 >> endobj\n%%EOF");
const call = async (c, fn, method, path, body, ...args) => {
  const raw = body instanceof Uint8Array;
  const headers = { Authorization: "Bearer " + TOKEN, "Content-Type": raw ? "application/pdf" : "application/json" };
  if (raw) headers["Content-Length"] = String(body.length);
  const req = new Request("https://unterricks.test" + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, res, data: res.headers.get("content-type")?.includes("json") ? await res.json() : null }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code } }; }
};
// Dienstag, 17.11.2026, 10:00 Uhr in Berlin – Druckaufträge für Mittwoch, 18.11.2026
const NOW = Date.UTC(2026, 10, 17, 9, 0);
async function setup() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = NOW;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const mcp = async (name, args) => {
    const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
  };
  return { c, mcp };
}
const course = async (c, body) => (await call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", { classes: ["a"], weekdays: [], ...body })).data.course;
const upload = async (c, lessonId, name, q = "copies=23&duplex=0&color=0") =>
  (await call(c, F.routePrintUpload, "POST", "/api/teacher/lessons/" + lessonId + "/print?name=" + encodeURIComponent(name) + "&" + q, PDF, lessonId)).data.file;
const disposition = async (c, fileId, body) => {
  const u = (await call(c, F.routeTeacherFileLink, "POST", "/x", body, fileId)).data.url;
  return decodeURIComponent((await call(c, F.routeDownload, "GET", u, undefined, fileId)).res.headers.get("content-disposition"));
};

test("Druckliste: Name mit dem Kurs der Sitzung – Gymnasium (Klasse, Kurs, E-Phase, Qualifikationsphase) und Grundschule (Religion, anderes Fach)", async () => {
  const { c } = await setup();
  const rel4 = await course(c, { grade: 4, religion: true }), sach3 = await course(c, { grade: 3, religion: false, subjectName: "Sachunterricht" });
  const cases = [["powi", "8B", "PoWi8"], ["evrel", "8-K", "Reli8"], ["ethik", "8-K", "Eth8"], ["powi", "EA", "PoWiE"], ["evrel", "E-K", "ReliE"], ["powi", "Q3-LK", "PoWiQ3LK"],
    ["evrel", "Q1-GK", "ReliQ1GK"], ["ethik", "10C", "Eth10"], ["gs", rel4.id, "Reli4"], ["gs", sach3.id, "Sach3"]];
  let i = 0;
  for (const [subject, klass, want] of cases) {
    const l = await L.createLesson(c.db, { subject, klass, title: "Stunde " + i, date: "2026-11-18" }, c.now + i++);
    const f = await upload(c, l.id, "Die Arche Noah.pdf");
    assert.equal(f.printName, "23x - sw - einseitig - " + want + " - Die Arche Noah.pdf", subject + " " + klass + ": Antwort des Hochladens");
    // Sitzung laden (FILE_COLS), Herunterladen (Druckvorlage: Name des Servers – zählt auf GitHub Pages), Link mit print
    const got = (await call(c, L.routeLessonGet, "GET", "/api/teacher/lessons/" + l.id, undefined, l.id)).data.files.find((x) => x.id === f.id);
    assert.equal(got.printName, f.printName, "Sitzung");
    assert.ok((await disposition(c, f.id, {})).includes("23x - sw - einseitig - " + want + " - Die Arche Noah.pdf"), "Download");
    assert.ok((await disposition(c, f.id, { print: true })).includes("23x - sw - einseitig - " + want + " - Die Arche Noah.pdf"), "Download mit print");
    // Änderung der Druckangaben (PATCH): farbig vor beidseitig
    const p = (await call(c, F.routeFilePatch, "PATCH", "/x", { copies: 2, duplex: true, color: true }, f.id)).data.file;
    assert.equal(p.printName, "2x - farbig - beidseitig - " + want + " - Die Arche Noah.pdf");
  }
});

test("Prüfung: eine wieder hochgeladene Druckdatei („23x - sw - einseitig - Reli4 - …“ bzw. altes Muster) bekommt den Namen der neuen Sitzung – nie doppelt", async () => {
  const { c } = await setup();
  const rel3 = await course(c, { grade: 3, religion: true });
  const gl = await L.createLesson(c.db, { subject: "gs", klass: rel3.id, title: "Arche", date: "2026-11-18" }, c.now);
  const pl = await L.createLesson(c.db, { subject: "powi", klass: "8C", title: "AB", date: "2026-11-18" }, c.now + 1);
  let f = await upload(c, gl.id, "23x - sw - einseitig - Reli4 - Die Arche Noah.pdf", "copies=21&duplex=0&color=0");
  assert.deepEqual([f.name, f.printName], ["Die Arche Noah.pdf", "21x - sw - einseitig - Reli3 - Die Arche Noah.pdf"]);
  f = await upload(c, pl.id, "28x - beidseitig - sw - Arbeitsblatt.pdf", "copies=27&duplex=1&color=0");
  assert.deepEqual([f.name, f.printName], ["Arbeitsblatt.pdf", "27x - sw - beidseitig - PoWi8 - Arbeitsblatt.pdf"]);
  f = await upload(c, pl.id, "Quiz - Runde 1.pdf", "copies=27&duplex=1&color=0");
  assert.equal(f.printName, "27x - sw - beidseitig - PoWi8 - Quiz - Runde 1.pdf", "ein gewöhnlicher Titel bleibt");
});

test("Druckaufträge für den nächsten Arbeitstag: jede Datei mit dem Kurs ihrer Sitzung, ohne zusätzliche D1-Anweisung; der Kurs auch je Sitzung (printCourse)", async () => {
  const { c } = await setup();
  const rel2 = await course(c, { grade: 2, religion: true }), mus1 = await course(c, { grade: 1, religion: false, subjectName: "musik" });
  const ls = [];
  for (const [subject, klass, t] of [["powi", "8A", "08:00"], ["powi", "8B", "09:00"], ["gs", rel2.id, "10:00"], ["gs", mus1.id, "11:00"], ["evrel", "Q2-LK", "12:00"]])
    ls.push(await L.createLesson(c.db, { subject, klass, title: "x", date: "2026-11-18", startTime: t, durationMin: 45 }, c.now + ls.length));
  for (const l of ls) await upload(c, l.id, "Arbeitsblatt.pdf", "copies=28&duplex=1&color=0");
  // Arbeitsblatt der Kinder mit „Auch ausdrucken“ (Grundschule)
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, print_copies, print_duplex, print_color, created_at, updated_at) " +
    "VALUES('aaaaaaaaaaaaaaa1', ?1, 'student', 'file', 'Kinder.pdf', 'application/pdf', 5, 'ready', 'upload', 22, 1, 0, 9, 9)").bind(ls[2].id).run();
  c.db.counter.n = 0;
  const r = await call(c, PJ.routePrintNext, "GET", "/api/teacher/print-next");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(c.db.counter.n <= 8, "D1-Anweisungen wie bisher (höchstens 8): " + c.db.counter.n);
  assert.deepEqual(r.data.sessions.map((s) => [s.printCourse, s.files.map((f) => f.printName)]), [
    ["PoWi8", ["28x - sw - beidseitig - PoWi8 - Arbeitsblatt.pdf"]],
    ["PoWi8", ["28x - sw - beidseitig - PoWi8 - Arbeitsblatt.pdf"]],   // 8A und 8B: derselbe Name – eindeutig macht ihn erst der Download (uniqueNames)
    ["Reli2", ["22x - sw - beidseitig - Reli2 - Kinder.pdf", "28x - sw - beidseitig - Reli2 - Arbeitsblatt.pdf"]],
    ["Musi1", ["28x - sw - beidseitig - Musi1 - Arbeitsblatt.pdf"]],
    ["ReliQ2LK", ["28x - sw - beidseitig - ReliQ2LK - Arbeitsblatt.pdf"]],
  ]);
});

test("Kein Umzug nötig: ältere Dateien bekommen den neuen Namen beim Ausliefern; eine Änderung des Grundschulkurses ändert ihn sofort; Arbeitsblatt der Kinder mit print", async () => {
  const { c } = await setup();
  const k = await course(c, { grade: 3, religion: false, subjectName: "Sachunterricht" });
  const l = await L.createLesson(c.db, { subject: "gs", klass: k.id, title: "Wasser", date: "2026-11-18" }, c.now);
  // so lag eine Datei schon vor Nachtrag 32 in D1 (nichts gespeichert, was den Namen betrifft)
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, print_copies, print_duplex, print_color, created_at, updated_at) " +
    "VALUES('bbbbbbbbbbbbbbb1', ?1, 'student', 'file', 'Wasserkreislauf.pdf', 'application/pdf', 5, 'ready', 'upload', 22, 1, 0, 1, 1)").bind(l.id).run();
  await c.env.FILES.put(F.fileKey(l.id, "bbbbbbbbbbbbbbb1"), PDF);
  const one = async () => L.fileOut(await F.getFile(c.db, "bbbbbbbbbbbbbbb1")).printName;
  assert.equal(await one(), "22x - sw - beidseitig - Sach3 - Wasserkreislauf.pdf");
  // Arbeitsblatt der Kinder: mit print der Druck-Name (GitHub Pages beachtet das download-Attribut nicht), ohne print wie im Material
  assert.ok((await disposition(c, "bbbbbbbbbbbbbbb1", { print: true })).includes("22x - sw - beidseitig - Sach3 - Wasserkreislauf.pdf"));
  assert.ok((await disposition(c, "bbbbbbbbbbbbbbb1", {})).includes('"Wasserkreislauf.pdf"'));
  // Kurs geändert (anderer Jahrgang, anderes Fach, dann Religion): der Name folgt ohne Umstellung
  await call(c, GS.routeGsCoursePatch, "PATCH", "/x", { grade: 4, subjectName: "Werken" }, k.id);
  assert.equal(await one(), "22x - sw - beidseitig - Werk4 - Wasserkreislauf.pdf");
  await call(c, GS.routeGsCoursePatch, "PATCH", "/x", { religion: true }, k.id);
  assert.equal(await one(), "22x - sw - beidseitig - Reli4 - Wasserkreislauf.pdf");
  // getFile bleibt EINE Anweisung (der Kurs kommt als Spalte mit)
  c.db.counter.n = 0; await F.getFile(c.db, "bbbbbbbbbbbbbbb1"); assert.equal(c.db.counter.n, 1);
  // eine Zeile ohne die Spalte (älterer Aufrufer): Name ohne Kurs statt eines falschen Kurses
  const raw = await c.db.prepare("SELECT * FROM files WHERE id='bbbbbbbbbbbbbbb1'").first();
  assert.equal(L.fileOut(raw).printName, "22x - sw - beidseitig - Wasserkreislauf.pdf");
  assert.equal(L.rowCourse({ print_course: "kaputt" }), "");
  assert.equal(L.printNameOf(raw, "Reli4"), "22x - sw - beidseitig - Reli4 - Wasserkreislauf.pdf");
});

test("Connector: add_material_pdf, add_print_material und get_lesson nennen den Druck-Namen mit Kurs; Beschreibungen mit dem neuen Muster (die MCP-Anweisungen bleiben unverändert – SHA-Test)", async () => {
  const { c, mcp } = await setup();
  const k = await course(c, { grade: 3, religion: false, subjectName: "Sachunterricht" });
  const gl = await L.createLesson(c.db, { subject: "gs", klass: k.id, title: "Wasser", date: "2026-11-18" }, c.now);
  const sek = await L.createLesson(c.db, { subject: "ethik", klass: "Q4-GK", title: "Gerechtigkeit", date: "2026-11-18" }, c.now + 1);
  let r = await mcp("add_print_material", { lesson_id: sek.id, titel: "Kärtchen Rawls", markdown: "# x", anzahl: 12, beidseitig: false, farbe: true });
  assert.equal(r.content[0].text, "Druckvorlage gespeichert: „12x - farbig - einseitig - EthQ4GK - Kärtchen Rawls.pdf“ (Liste „Von der Lehrkraft auszudrucken“).");
  assert.equal(r.structuredContent.file_name, "12x - farbig - einseitig - EthQ4GK - Kärtchen Rawls.pdf");
  r = await mcp("add_material_pdf", { lesson_id: gl.id, bereich: "schueler", titel: "Wasserkreislauf", html: "<h1>x</h1>", anzahl: 21 });
  assert.ok(r.content[0].text.includes("„21x - sw - beidseitig - Sach3 - Wasserkreislauf.pdf“"), r.content[0].text);
  const t = (await mcp("get_lesson", { lesson_id: gl.id })).content[0].text;
  assert.ok(t.includes("auch auf der Druckliste: 21x - sw - beidseitig - Sach3 - Wasserkreislauf.pdf"), t);
  assert.ok(t.includes("(„5x - sw - beidseitig - <Kurs> - Konzentrationsaufgabe – ….pdf“)"), "Konzentrationsaufgabe: Muster mit Kurs");
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
  const tools = (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result.tools;
  const desc = (n) => tools.find((x) => x.name === n).description;
  assert.ok(desc("add_material_pdf").includes("z. B. „23x - sw - einseitig - Reli4 - Die Arche Noah.pdf“ – schreib Anzahl, Druckart, Kurs und Klasse deshalb nicht in den titel."));
  assert.ok(desc("add_print_material").includes("z. B. „28x - sw - beidseitig - PoWi8 - Titel.pdf“"));
  assert.ok(desc("add_picture_cards").includes("1x, einseitig, farbig"));
  for (const x of tools) assert.ok(!/\d+x - (beidseitig|einseitig) - |- Farbe -/.test(x.description), "altes Muster in " + x.name);
});
