// Worker-Tests der Erweiterung „Grundschule und Kurseinstellungen“ (D1 auf SQLite, fake-d1.mjs). Kurseinstellungen gelten für alle Kurse.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
// mcp.js zieht über student.js die Live-Präsentation (Durable Object aus „cloudflare:workers“) mit – hier eine leere Attrappe
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const { fakeCtx } = await import("./fake-d1.mjs");
const CS = await import("../../worker/courses.js");
const U = await import("../../worker/units.js");
const B = await import("../../worker/bases.js");
const { saveDesign, insertPrintText } = await import("../../worker/files.js");
const { lessonCtx, getLesson } = await import("../../worker/lessons.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");
const { lessonContext } = await import("../../public/shared.js");

const TOKEN = "lehrkraft-token-123";
async function ctx() {
  const c = fakeCtx();
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  return c;
}
const call = async (c, fn, method, path, body, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method, headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code } }; }
};
const put = (c, body) => call(c, CS.routeCourseSettingsPut, "PUT", "/api/teacher/course-settings", body);
const get = (c, subject, klass) => call(c, CS.routeCourseSettingsGet, "GET", "/api/teacher/course-settings?subject=" + subject + "&klass=" + klass);
const WD = [{ day: 1, minutes: 45, time: "08:00" }, { day: 3, minutes: 90, time: "09:50" }];
const gsCourse = async (c, id = "gs1a2b3c4d") => {
  await c.db.prepare("INSERT INTO gs_courses(id, grade, classes, religion, subject_name, description, school_year, created_at, updated_at) VALUES(?1, 2, '[\"a\",\"b\"]', 1, 'Religion', '', '2026/27', 1, 1)").bind(id).run();
  return id;
};

test("Kurseinstellungen (Gymnasium): speichern, lesen, Grenzen; nur unterrichtete Klassen", async () => {
  const c = await ctx();
  assert.deepEqual((await get(c, "powi", "8A")).data, { ok: true, settings: null });
  let r = await put(c, { subject: "powi", klass: "8A", weekdays: [...WD, { day: 9, minutes: 45 }], classSize: 24 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.settings.weekdays, WD, "ungültige Termine fallen weg");
  assert.equal(r.data.settings.classSize, 24);
  r = await get(c, "powi", "8A");
  assert.deepEqual(r.data.settings.weekdays, WD); assert.equal(r.data.settings.classSize, 24);
  // Termine ohne Uhrzeit sind am Gymnasium erlaubt, Schülerzahl darf fehlen
  r = await put(c, { subject: "powi", klass: "8A", weekdays: [{ day: 2, minutes: 45 }], classSize: null });
  assert.equal(r.status, 200); assert.deepEqual(r.data.settings, { weekdays: [{ day: 2, minutes: 45, time: null }], classSize: null, updatedAt: c.now });
  for (const bad of [0, 61, 2.5, "x", true]) {
    r = await put(c, { subject: "powi", klass: "8A", weekdays: [], classSize: bad });
    assert.equal(r.status, 400); assert.equal(r.data.error, "Die Schülerzahl muss zwischen 1 und 60 liegen.");
  }
  assert.equal((await put(c, { subject: "powi", klass: "8A", weekdays: [], classSize: "28" })).data.settings.classSize, 28, "Zahl als Text");
  // PoWi wird laut Fach-Einstellungen in Jg. 7 nicht unterrichtet; unbekanntes Fach/Klasse
  for (const [s, k] of [["powi", "7A"], ["mathe", "8A"], ["powi", "8Z"], ["gs", "8A"]]) {
    assert.equal((await put(c, { subject: s, klass: k, weekdays: [], classSize: 20 })).data.error, "Fach oder Klasse ungültig.");
    assert.equal((await get(c, s, k)).status, 400);
  }
});

test("Kurseinstellungen (Grundschule): Kurs muss existieren, jeder Termin braucht eine Uhrzeit", async () => {
  const c = await ctx();
  assert.equal((await get(c, "gs", "gs00000000")).status, 404);
  const id = await gsCourse(c);
  let r = await put(c, { subject: "gs", klass: id, weekdays: [{ day: 2, minutes: 45 }], classSize: 22 });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "Bitte bei jedem Termin die Uhrzeit eintragen – daraus ergibt sich, ab wann Eltern eine Sitzung sehen können.");
  r = await put(c, { subject: "gs", klass: id, weekdays: [{ day: 2, minutes: 45, time: "08:00" }], classSize: 22 });
  assert.equal(r.status, 200);
  const info = await CS.courseInfo(c.db, "gs", id);
  assert.deepEqual(info.weekdays, [{ day: 2, minutes: 45, time: "08:00" }]); assert.equal(info.classSize, 22); assert.equal(info.gs.id, id);
  assert.equal(await CS.courseInfo(c.db, "powi", "8A"), null, "ohne Einstellungen: null");
});

test("Neue Einheit übernimmt den Stundenplan der Kurseinstellungen; ohne Einstellungen wie bisher; unitFull nennt den Kurs", async () => {
  const c = await ctx();
  const mk = (klass, params) => call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "powi", klass, title: "T", ...(params ? { params } : {}) });
  let r = await mk("8A");
  assert.deepEqual(r.data.unit.params.weekdays, [], "ohne Kurseinstellungen: leerer Stundenplan (die Seite zeigt eine Vorgabezeile)");
  assert.equal(r.data.unit.course, null);
  await put(c, { subject: "powi", klass: "8A", weekdays: WD, classSize: 24 });
  r = await mk("8A");
  assert.deepEqual(r.data.unit.params.weekdays, WD);
  assert.deepEqual(r.data.unit.course, { weekdays: WD, classSize: 24, gs: null });
  r = await mk("8A", { weekdays: [{ day: 5, minutes: 90 }] });
  assert.deepEqual(r.data.unit.params.weekdays, [{ day: 5, minutes: 90, time: null }], "eigener Stundenplan gewinnt");
  r = await mk("8B");
  assert.deepEqual(r.data.unit.params.weekdays, [], "andere Klasse: eigene Einstellungen");
});

async function lessonIn(c, subject, klass) {
  const id = "ab12cd34ef56ab78";
  await c.db.prepare("INSERT INTO lessons(id, subject, klass, title, code, created_at, updated_at) VALUES(?1, ?2, ?3, 'Stunde', 'ABC123', 1, 1)").bind(id, subject, klass).run();
  return id;
}

test("Claude kennt die Schülerzahl: lessonCtx/lessonContext, Standard für die Zahl der Ausdrucke; ohne Einstellungen unverändert", async () => {
  const c = await ctx();
  const L = await lessonIn(c, "ethik", "8A");
  const before = await lessonCtx(c.db, await getLesson(c.db, L));
  assert.equal(before.classSize, null);
  const textBefore = lessonContext(before);
  assert.ok(!textBefore.includes("Schülerzahl"));
  await put(c, { subject: "ethik", klass: "8A", weekdays: [], classSize: 24 });
  const after = await lessonCtx(c.db, await getLesson(c.db, L));
  assert.equal(after.classSize, 24);
  const textAfter = lessonContext(after);
  assert.equal(textAfter, textBefore.replace(/(Klasse\/Kurs: [^\n]*\n)/, "$1Schülerzahl laut Kurseinstellungen: 24\n"), "nur die eine Zeile kommt dazu");
  // Druckliste ohne Anzahl: Schülerzahl laut Kurseinstellungen (vor der zuletzt verwendeten Anzahl)
  const f = await saveDesign(c, L, { area: "print", title: "Kärtchen", html: "<p>x</p>" });
  assert.equal(f.print_copies, 24);
  const g = await saveDesign(c, L, { area: "print", title: "Kärtchen 2", html: "<p>x</p>", print: { copies: 3 } });
  assert.equal(g.print_copies, 3);
  const t = await insertPrintText(c.db, L, "Vorlage", "# x", {}, "claude", c.now);
  assert.equal(t.print_copies, 24);
  assert.equal(await CS.courseClassSize(c.db, L), 24);
  // ohne Schülerzahl: wie bisher die zuletzt verwendete Anzahl dieser Klasse
  await put(c, { subject: "ethik", klass: "8A", weekdays: [], classSize: null });
  await insertPrintText(c.db, L, "Vorlage 2", "# x", { copies: 7 }, "claude", c.now + 1);
  const t3 = await insertPrintText(c.db, L, "Vorlage 3", "# x", {}, "claude", c.now + 2);
  assert.equal(t3.print_copies, 7, "zuletzt verwendete Anzahl");
});

test("Connector: get_lesson und get_unit nennen die Schülerzahl, add_material_pdf ohne anzahl nimmt sie", async () => {
  const c = await ctx();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const mcp = async (name, args) => {
    const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: name ? "tools/call" : "tools/list", params: name ? { name, arguments: args } : {} }) });
    return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
  };
  const desc = (await mcp(null)).tools.find((t) => t.name === "add_material_pdf").description;
  assert.ok(desc.includes("anzahl – Standard: Schülerzahl laut Kurseinstellungen (siehe get_lesson); fehlt sie, frag nach der Klassengröße –"));
  const L = await lessonIn(c, "ethik", "8A");
  const u = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "ethik", klass: "8A", title: "Gerechtigkeit" })).data.unit;
  let r = await mcp("get_lesson", { lesson_id: L });
  assert.ok(!r.content[0].text.includes("Schülerzahl"));
  const unitBefore = (await mcp("get_unit", { unit_id: u.id })).content[0].text;
  assert.ok(!unitBefore.includes("Schülerzahl"));
  await put(c, { subject: "ethik", klass: "8A", weekdays: [], classSize: 24 });
  r = await mcp("get_lesson", { lesson_id: L });
  assert.ok(r.content[0].text.includes("\nSchülerzahl laut Kurseinstellungen: 24\n"));
  const unitAfter = (await mcp("get_unit", { unit_id: u.id })).content[0].text;
  assert.equal(unitAfter, unitBefore.replace(/(\nTitel: [^\n]*\n)/, "$1Schülerzahl laut Kurseinstellungen: 24\n"));
  const orig = globalThis.fetch;
  globalThis.fetch = async () => new Response("busy", { status: 503 });   // Drucker ausgelastet – gespeichert wird trotzdem
  try { r = await mcp("add_material_pdf", { lesson_id: L, bereich: "druck", titel: "Kärtchen", html: "<p>x</p>" }); } finally { globalThis.fetch = orig; }
  assert.match(r.content[0].text, /„24x - beidseitig - sw - Kärtchen\.pdf“/);
});

test("Umzug in einen Kurs (Ethik Jg. 7): der Kurs übernimmt die Kurseinstellungen der ersten Klasse, eigene bleiben", async () => {
  const c = await ctx();
  const subj = (courses) => call(c, B.routeSubjectPut, "PUT", "/api/teacher/subjects/ethik", { courses }, "ethik");
  await put(c, { subject: "ethik", klass: "7C", weekdays: WD, classSize: 18 });
  await put(c, { subject: "ethik", klass: "8B", weekdays: [{ day: 4, minutes: 45 }], classSize: 27 });
  const r = await subj({ 7: ["7A", "7C"], 8: ["8B"] });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.moved, { lessons: 0, units: 0 });
  const k7 = await CS.getCourseSettings(c.db, "ethik", "7-K"), k8 = await CS.getCourseSettings(c.db, "ethik", "8-K");
  assert.deepEqual([k7.weekdays, k7.classSize], [WD, 18]);
  assert.deepEqual([k8.weekdays, k8.classSize], [[{ day: 4, minutes: 45, time: null }], 27]);
  await put(c, { subject: "ethik", klass: "7-K", weekdays: [], classSize: 25 });
  await subj({ 7: ["7A", "7B", "7C"] });
  assert.equal((await CS.getCourseSettings(c.db, "ethik", "7-K")).classSize, 25, "vorhandene Kurseinstellungen bleiben");
});

test("D1-Anweisungen: Kurseinstellungen lesen 1 + Fach-Einstellungen, courseInfo 1 (Grundschule 2 in einem Batch)", async () => {
  const c = await ctx();
  const id = await gsCourse(c);
  c.db.counter.n = 0; await CS.courseInfo(c.db, "powi", "8A"); assert.equal(c.db.counter.n, 1);
  c.db.counter.n = 0; await CS.courseInfo(c.db, "gs", id); assert.equal(c.db.counter.n, 2);
  c.db.counter.n = 0; await CS.courseClassSize(c.db, "ab12cd34ef56ab78"); assert.equal(c.db.counter.n, 1);
});

/* ---------- Planungsgrundlagen: Original-PDF in R2, Grundschul-Curriculum bei Ev. Religion ---------- */
const PDF = new TextEncoder().encode("%PDF-1.7\n1 0 obj<<>>endobj\n%%EOF\n");
const rawCall = async (c, fn, path, bytes, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/pdf", "Content-Length": String(bytes.length) }, body: bytes });
  try { const res = await fn({ ...c, request: req, waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code } }; }
};
const newBase = async (c, body) => {
  const r = await call(c, B.routeBaseCreate, "POST", "/api/teacher/bases", { pages: 2, title: "Dokument", ...body });
  if (r.status === 200) await call(c, B.routeBasePages, "PUT", "/api/teacher/bases/x/pages", { from: 1, texts: ["Seite eins", "Seite zwei"] }, r.data.base.id);
  return r;
};

test("Planungsgrundlage: Original-PDF hochladen, signierter Link, Ausliefern, Speichergrenze, Löschen entfernt die PDF", async () => {
  const c = await ctx();
  c.env.SETTINGS_SECRET = "geheimnis-fuer-signierte-links";
  const b = (await newBase(c, { subject: "powi", kind: "kcgo", fileName: "KCGO.pdf", sections: { regeln: [1], Q2: [2] } })).data.base;
  assert.equal(b.pdf, false); assert.equal(b.pdfSize, null);
  let r = await call(c, B.routeBaseGet, "GET", "/api/teacher/bases/" + b.id, undefined, b.id);
  assert.equal(r.data.base.id, b.id); assert.equal(r.data.base.pdf, false);
  assert.equal((await call(c, B.routeBaseLink, "POST", "/api/teacher/bases/" + b.id + "/link", {}, b.id)).status, 404, "ohne PDF kein Link");
  // keine PDF → abgelehnt, nichts gespeichert
  r = await rawCall(c, B.routeBasePdf, "/api/teacher/bases/" + b.id + "/pdf", new TextEncoder().encode("<html>nein</html>"), b.id);
  assert.equal(r.status, 400); assert.equal(c.env.FILES.m.has("b/" + b.id + ".pdf"), false);
  r = await rawCall(c, B.routeBasePdf, "/api/teacher/bases/" + b.id + "/pdf?name=KCGO_neu.pdf", PDF, b.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.base.pdf, true); assert.equal(r.data.base.pdfSize, PDF.length); assert.equal(r.data.base.fileName, "KCGO_neu.pdf");
  assert.deepEqual([...c.env.FILES.m.get("b/" + b.id + ".pdf")], [...PDF]);
  // Planungsbasis: docs mit pdf (Text unverändert)
  const pb = await B.planningBasis(c.db, "powi", "Q2-GK");
  assert.equal(pb.docs[0].pdf, true);
  // Link → Ausliefern (inline, Kopfzeilen wie /api/dl)
  r = await call(c, B.routeBaseLink, "POST", "/api/teacher/bases/" + b.id + "/link", {}, b.id);
  assert.match(r.data.url, new RegExp("^/api/base/" + b.id + "\\?e=\\d+&s="));
  const res = await B.routeBaseFile({ ...c, request: new Request("https://unterricks.test" + r.data.url) }, b.id);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  assert.match(res.headers.get("content-disposition"), /^inline; filename="KCGO_neu\.pdf"/);
  assert.match(res.headers.get("content-security-policy"), /^sandbox;/);
  assert.equal(res.headers.get("cache-control"), "private, max-age=300");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), PDF);
  // falsche Signatur bzw. abgelaufen
  await assert.rejects(B.routeBaseFile({ ...c, request: new Request("https://unterricks.test" + r.data.url.replace(/s=[^&]+/, "s=falsch")) }, b.id), (e) => e.status === 403);
  await assert.rejects(B.routeBaseFile({ ...c, now: c.now + 11 * 60e3, request: new Request("https://unterricks.test" + r.data.url) }, b.id), (e) => e.status === 403);
  // Speichergrenze zählt die PDFs der Planungsgrundlagen
  const F = await import("../../worker/files.js");
  await F.checkStorage({ ...c, env: { ...c.env, STORAGE_LIMIT_BYTES: String(PDF.length) } }, 0);
  await assert.rejects(F.checkStorage({ ...c, env: { ...c.env, STORAGE_LIMIT_BYTES: String(PDF.length) } }, 1), (e) => e.status === 507);
  // Löschen entfernt auch die PDF
  assert.equal((await call(c, B.routeBaseDelete, "DELETE", "/api/teacher/bases/" + b.id, undefined, b.id)).status, 200);
  assert.equal(c.env.FILES.m.has("b/" + b.id + ".pdf"), false);
});

test("Ev. Religion Jg. 1–4: Schulcurriculum der Grundschule nur bei evrel (oder einem Grundschulkurs); das Gymnasium sieht es nie", async () => {
  const c = await ctx();
  const sek = (await newBase(c, { subject: "evrel", kind: "schulcurriculum", sections: { 7: [1], 8: [2] } })).data.base;
  const before = await B.planningBasis(c.db, "evrel", "8A");
  for (const subject of ["powi", "ethik"]) {
    const r = await newBase(c, { subject, kind: "gs-curriculum" });
    assert.equal(r.status, 400); assert.equal(r.data.error, "Das Schulcurriculum der Grundschule gehört zu Ev. Religion oder zu einem Grundschulkurs.");
  }
  const r = await newBase(c, { subject: "evrel", kind: "gs-curriculum", scope: ["2", "5", "Q1-GK", 3], sections: { 1: [1], 2: [1], 3: [2], 4: [2] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.base.scope, ["2", "3"], "Geltungsbereich nur Jahrgänge 1–4");
  assert.deepEqual(await B.planningBasis(c.db, "evrel", "8A"), before, "Planungsbasis des Gymnasiums unverändert");
  for (const k of ["5A", "EA", "Q1-GK", "8-K"]) assert.equal((await B.planningBasis(c.db, "evrel", k)).docs.some((d) => d.kind === "gs-curriculum"), false);
  // Grundschulkurs: nur das Curriculum oder Sonstiges; unbekannter Kurs → 404
  const id = await gsCourse(c);
  assert.equal((await newBase(c, { subject: id, kind: "gs-curriculum" })).status, 200);
  assert.equal((await newBase(c, { subject: id, kind: "sonstiges", scope: ["1"] })).status, 200);
  assert.equal((await newBase(c, { subject: id, kind: "kcgo" })).status, 400);
  assert.equal((await newBase(c, { subject: "gs0000ffff", kind: "gs-curriculum" })).status, 404);
  assert.ok(sek.id);
});
