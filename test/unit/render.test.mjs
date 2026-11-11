// Druck von Claudes Gestaltung (worker/render.js, Dateiablage, Connector): HTML annehmen, Auftrag an den Drucker, Warteschlange (1 Auftrag
// je 10 s), Tageskontingent, Speichern/Ersetzen/Drucken von Material und das Werkzeug add_material_pdf – mit einer D1-Nachbildung auf SQLite.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import * as R from "../../worker/render.js";
import { SCHEMA, COLUMNS, INDEXES, setSetting } from "../../worker/db.js";
import { saveDesign, renderDesign, designOutdated } from "../../worker/files.js";
import { fileOut } from "../../worker/lessons.js";
// mcp.js zieht über student.js die Live-Präsentation (Durable Object aus „cloudflare:workers“) mit – hier eine leere Attrappe
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const { routeMcp } = await import("../../worker/mcp.js");
import { sha256Hex } from "../../worker/lib.js";
import { MATERIAL_DESIGN_RULES } from "../../public/shared.js";

/* ---------- D1 auf SQLite (nur, was der Worker braucht) ---------- */
function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const vals = (a) => a.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
  const plain = (r) => (r ? { ...r } : null);
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async (col) => { const r = plain(db.prepare(sql).get(...vals(args))); return r && col ? r[col] : r; },
    all: async () => ({ results: db.prepare(sql).all(...vals(args)).map(plain) }),
    run: async () => {
      if (/\bRETURNING\b/i.test(sql)) { const rows = db.prepare(sql).all(...vals(args)); return { results: rows.map(plain), meta: { changes: rows.length } }; }
      const r = db.prepare(sql).run(...vals(args)); return { meta: { changes: Number(r.changes) } };
    },
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => { const out = []; for (const s of list) out.push(await s.all()); return out; } };
}
function fakeR2() {
  const m = new Map();
  return { m, put: async (k, v) => { m.set(k, v instanceof Uint8Array ? v : new Uint8Array(await new Response(v).arrayBuffer())); }, get: async (k) => (m.has(k) ? { body: m.get(k) } : null),
    delete: async (k) => { for (const x of Array.isArray(k) ? k : [k]) m.delete(x); } };
}
const ASSETS = { fetch: async (req) => { const p = new URL(req.url).pathname; try { return new Response(readFileSync(new URL("../../public" + p, import.meta.url))); } catch { return new Response("", { status: 404 }); } } };
const PDF = (pages = 1) => new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count " + pages + " /Kids [] >> endobj\n%%EOF");

/* Drucker-Attrappe über RENDER_MOCK_URL: antwortet nach der Liste answers (Response-Fabriken), merkt sich die Aufträge */
function printer(answers) {
  const calls = [], orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (!String(url).startsWith("http://127.0.0.1:9/")) return orig(url, init);
    calls.push(JSON.parse(init.body));
    const a = answers.length > 1 ? answers.shift() : answers[0];
    return a();
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}
// je Test eine frische Datenbank (ensureSchema merkt sich das Anlegen je Isolate – hier deshalb direkt)
function schema(db) {
  for (const q of SCHEMA) db.raw.exec(q);
  for (const [t, col, def] of COLUMNS) db.raw.exec("ALTER TABLE " + t + " ADD COLUMN " + col + " " + def);
  for (const q of INDEXES) db.raw.exec(q);
}
async function ctx(extraEnv = {}) {
  const db = fakeD1();
  schema(db);
  return { db, now: Date.now(), env: { DB: db, FILES: fakeR2(), ASSETS, RENDER_MOCK_URL: "http://127.0.0.1:9/pdf", RENDER_GAP_MS: "0", ...extraEnv } };
}
async function lesson(c) {
  const id = "a1b2c3d4e5f60718";
  await c.db.prepare("INSERT INTO lessons(id, subject, klass, title, code, created_at, updated_at) VALUES(?1, 'powi', '8B', 'Test', 'ABC123', 1, 1)").bind(id).run();
  return id;
}

test("HTML annehmen: Skripte, Ereignis-Attribute, eingebettete Seiten und Weiterleitungen fallen weg; Bruchstücke werden eine Seite", () => {
  const h = R.cleanDesignHtml('<p onclick="x()" onmouseover=y>Hi</p><img src=x onerror="a(1)" onload=b><a href="javascript:alert(1)">l</a><script>bad()</script>' +
    '<svg><script>x</script><text>t</text></svg><iframe src="https://e.x"></iframe><object data=y>Ersatz</object><base href="https://e.x/"><meta http-equiv="refresh" content="0;url=https://e.x">');
  assert.ok(h.startsWith('<!doctype html><html lang="de">'));
  for (const bad of ["<script", "onclick", "onmouseover", "onerror", "onload", "javascript:", "<iframe", "<object", "<base", "refresh"]) assert.ok(!h.toLowerCase().includes(bad), bad);
  assert.ok(h.includes("<p>Hi</p>") && h.includes("Ersatz") && h.includes("<text>t</text>"));
  const full = '<!doctype html><html><head><style>@page{margin:1cm}</style></head><body><h1>„Größe“</h1></body></html>';
  assert.equal(R.cleanDesignHtml(full), full, "eine ganze Seite bleibt unverändert");
  assert.throws(() => R.cleanDesignHtml("   "), /HTML-Seite/);
  assert.throws(() => R.cleanDesignHtml("nur Text ohne Tags"), /HTML-Seite/);
  assert.throws(() => R.cleanDesignHtml("<p>" + "x".repeat(R.HTML_MAX) + "</p>"), /zu groß/);
});

test("HTML annehmen: bekannte Umgehungen (Prüfbefund vom 11.11.2026) – „/“ vor on…, verschachtelte script-Tags, Text im data:-Kopf", () => {
  const h = R.cleanDesignHtml('<svg/onload="for(;;);"></svg><img src=x/onerror=alert(1)><scr<script>ipt>a()</scr</script>ipt>' +
    '<scr<script>ipt>b()</script><p><img src="data:<script>for(;;);</script>;base64,' + "A".repeat(1600) + '"></p><a href=" javascript:x()">y</a>');
  for (const bad of ["onload", "onerror", "<script", "javascript:"]) assert.ok(!h.toLowerCase().includes(bad), bad + " in " + h.slice(0, 300));
  const img = "data:image/png;base64," + "QUFB".repeat(500);
  assert.ok(R.cleanDesignHtml('<img src="' + img + '">').includes(img), "echte eingebettete Bilder bleiben unverändert");
  assert.deepEqual(R.dataRanges("x data:<b>;base64," + "A".repeat(2000)), [], "nur eine schlichte Medienangabe gilt als Bild");
});

test("Auftrag an den Drucker: nur dokumentierte Felder, Netz gesperrt, Grundeinstellungen vor Claudes CSS (Claudes Regeln gehen vor)", () => {
  const body = R.pdfRequest(R.cleanDesignHtml('<html><head><style id="claude">@page{size:A4 landscape}</style></head><body>x</body></html>'), "@font-face{x}");
  assert.deepEqual(Object.keys(body).sort(), ["gotoOptions", "html", "pdfOptions", "rejectRequestPattern", "setJavaScriptEnabled"]);
  assert.equal(body.setJavaScriptEnabled, false, "JavaScript beim Druck aus");
  assert.ok(!("setJavaScriptEnabled" in R.pdfRequest("<p>x</p>", "", true)), "Rückfall ohne das Feld");
  assert.deepEqual(body.pdfOptions, { format: "a4", printBackground: true, preferCSSPageSize: true, timeout: 60000 });
  for (const u of ["https://e.x/a.png", "http://e.x", "wss://e.x", "ftp://e.x", "file:///etc/passwd"]) assert.ok(body.rejectRequestPattern.some((p) => new RegExp(p).test(u)), u);
  assert.ok(!body.rejectRequestPattern.some((p) => new RegExp(p).test("data:image/png;base64,AA")), "data:-Adressen bleiben erlaubt");
  const base = body.html.indexOf('id="unterricks-base"'), own = body.html.indexOf('id="claude"');
  assert.ok(base > 0 && own > base, "Grundeinstellungen stehen vor Claudes Stil");
  assert.ok(body.html.includes("@font-face{x}") && body.html.includes("@page{size:A4;margin:16mm 16mm 18mm}") && body.html.includes(R.PDF_FONT));
  assert.ok(R.pdfRequest("<html><body>y</body></html>").html.includes("<head><meta charset=\"utf-8\"><style"), "ohne <head> entsteht einer");
});

test("Schrift: Atkinson Hyperlegible Next (normal, latin-ext, kursiv) und Mono als data:-Adressen mit Zeichenbereichen", async () => {
  const css = await R.fontCss({ ASSETS });
  assert.equal((css.match(/@font-face/g) || []).length, 4);
  assert.ok(css.includes("font-family:'Atkinson Hyperlegible Next';font-style:italic") && css.includes("Atkinson Hyperlegible Mono"));
  assert.equal((css.match(/unicode-range/g) || []).length, 3);
  assert.ok(/src:url\(data:font\/woff2;base64,d09GMg/.test(css), "WOFF2-Daten (wOF2)");
});

test("Seitenzahl, Klartext und gekürzte Bilder für Claude (Platzhalter kommen beim Ändern wieder als Bild zurück)", () => {
  assert.equal(R.pdfPageCount(PDF(3)), 3);
  assert.equal(R.pdfPageCount(new TextEncoder().encode("%PDF-1.7 ohne Seitenbaum")), null);
  const img = "data:image/png;base64," + "QUFB".repeat(600);
  const h = "<html><head><style>p{}</style></head><body><h1>Titel &amp; mehr</h1><p>Zeile <b>fett</b></p><img src=\"" + img + "\"><svg><text>x</text></svg><ul><li>a</li><li>b</li></ul></body></html>";
  assert.equal(R.htmlText(h), "Titel & mehr\nZeile fett\na\nb");
  const s = R.shortImages(h);
  assert.ok(s.includes('src="data:unterricks-bild,1"') && !s.includes("QUFBQUFB"));
  assert.equal(R.keepImages(s.replace("Titel", "Neu"), h), h.replace("Titel", "Neu"));
  assert.equal(R.keepImages("<img src=\"data:unterricks-bild,7\">", h), "<img src=\"data:unterricks-bild,7\">", "unbekannte Nummer bleibt stehen");
});

test("Warteschlange: Aufträge im Abstand des Druckers, nie weiter als maxWait im Voraus", async () => {
  const c = await ctx();
  const t = 1_000_000;
  assert.deepEqual(await R.reserveSlot(c.db, t, 10500, 30000), { start: t });
  assert.deepEqual(await R.reserveSlot(c.db, t + 100, 10500, 30000), { start: t + 10500 });
  assert.deepEqual(await R.reserveSlot(c.db, t + 200, 10500, 30000), { start: t + 21000 });
  const full = await R.reserveSlot(c.db, t + 300, 10500, 20000);
  assert.equal(full.start, null); assert.equal(full.retryAt, t + 31500);
  assert.deepEqual(await R.reserveSlot(c.db, t + 100000, 10500, 0), { start: t + 100000 }, "später wieder frei");
});

test("Drucken: Erfolg mit Verbrauch; „ausgelastet“ wird über die Warteschlange erneut versucht; Tageskontingent sperrt bis 0 Uhr UTC", async () => {
  const c = await ctx();
  let p = printer([() => new Response(PDF(2), { headers: { "X-Browser-Ms-Used": "1234" } })]);
  try {
    const r = await R.renderPdf(c, "<html><body>x</body></html>");
    assert.equal(r.pages, 2); assert.equal(r.ms, 1234);
    assert.equal(p.calls.length, 1); assert.ok(p.calls[0].html.includes("unterricks-base"));
    const u = await R.renderUsage(c.db, Date.now());
    assert.equal(u.ms, 1234); assert.equal(u.n, 1); assert.equal(u.quotaUntil, null);
  } finally { p.restore(); }
  p = printer([() => new Response("Too many requests", { status: 429 }), () => new Response(PDF(1))]);
  try { assert.equal((await R.renderPdf(c, "<p>y</p>")).pages, 1); assert.equal(p.calls.length, 2); } finally { p.restore(); }
  p = printer([() => new Response("<html>kaputt</html>")]);
  try { await assert.rejects(R.renderPdf(c, "<p>y</p>"), (e) => e.code === "render_failed" && /keine PDF/.test(e.message)); } finally { p.restore(); }
  p = printer([() => new Response("Error processing the request: Unable to create new browser: code: 429: message: Browser time limit exceeded for today", { status: 429 })]);
  try {
    await assert.rejects(R.renderPdf(c, "<p>z</p>"), (e) => e.code === "render_quota" && e.status === 503);
    const q = await R.quotaUntil(c.db, Date.now());
    const d = new Date(); assert.equal(q, Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
    await assert.rejects(R.renderPdf(c, "<p>z</p>"), (e) => e.code === "render_quota");
    assert.equal(p.calls.length, 1, "nach dem Tageskontingent fragt Unterricks den Drucker nicht mehr");
  } finally { p.restore(); }
});

test("Drucken über die Bindung: lokal ohne Cloudflare „nicht eingerichtet“, ein geworfener 429 mit Tageskontingent wird erkannt", async () => {
  const c = await ctx({ RENDER_MOCK_URL: "" });
  c.env.BROWSER = { quickAction: async () => { throw new Error('The RPC receiver does not implement the method "quickAction"'); } };
  await assert.rejects(R.renderPdf(c, "<p>x</p>"), (e) => e.code === "render_config" && e.status === 503);
  let body = null;
  c.env.BROWSER = { quickAction: async (a, b) => { assert.equal(a, "pdf"); body = b; return new Response(PDF(1)); } };
  assert.equal((await R.renderPdf(c, "<p>x</p>")).pages, 1);
  assert.ok(body && body.html.includes("<p>x</p>"));
  c.env.BROWSER = { quickAction: async () => { throw new Error("Unable to create new browser: code: 429: message: Browser time limit exceeded for today"); } };
  await assert.rejects(R.renderPdf(c, "<p>x</p>"), (e) => e.code === "render_quota");
  delete c.env.BROWSER;
  await c.db.prepare("DELETE FROM render_gate").run();
  await assert.rejects(R.renderPdf(c, "<p>x</p>"), (e) => e.code === "render_config");
  c.env.RENDER_MOCK_URL = "https://fremd.example/pdf";
  await assert.rejects(R.renderPdf(c, "<p>x</p>"), (e) => e.code === "render_config", "RENDER_MOCK_URL nur lokal");
});

test("Drucken: lehnt der Drucker setJavaScriptEnabled ab, druckt Unterricks ohne das Feld (einmal je Instanz gemerkt)", async () => {
  const c = await ctx();
  const calls = [], orig = globalThis.fetch;
  // eine Ablehnung, die am Material liegt: einmal ohne das Feld versucht, dann Fehler – und nicht gemerkt
  globalThis.fetch = async (url, init) => { calls.push(JSON.parse(init.body)); return new Response("Bad Request: invalid html", { status: 400 }); };
  try {
    await assert.rejects(R.renderPdf(c, "<p>x</p>"), (e) => e.code === "render_failed");
    assert.equal(calls.length, 2); assert.ok("setJavaScriptEnabled" in calls[0] && !("setJavaScriptEnabled" in calls[1]));
  } finally { globalThis.fetch = orig; }
  calls.length = 0;
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body); calls.push(b);
    return "setJavaScriptEnabled" in b ? new Response('Unrecognized key(s) in object: "setJavaScriptEnabled"', { status: 400 }) : new Response(PDF(1));
  };
  try {
    assert.equal((await R.renderPdf(c, "<p>x</p>")).pages, 1);
    assert.equal(calls.length, 2); assert.ok("setJavaScriptEnabled" in calls[0] && !("setJavaScriptEnabled" in calls[1]));
    await R.renderPdf(c, "<p>y</p>");
    assert.equal(calls.length, 3, "danach gleich ohne das Feld");
  } finally { globalThis.fetch = orig; }
});

test("Material: anlegen (wartet auf den Druck), drucken (PDF in R2, sichtbar), ersetzen (bisherige PDF bleibt bis zum neuen Druck), Fehler merken", async () => {
  const c = await ctx(); const L = await lesson(c);
  const html = "<!doctype html><html><head><style>h1{}</style></head><body><h1>Gewaltenteilung</h1><img src=\"data:image/png;base64," + "QUFB".repeat(500) + "\"></body></html>";
  let f = await saveDesign(c, L, { area: "student", title: "Arbeitsblatt – Gewaltenteilung", html });
  assert.equal(f.status, "pending"); assert.equal(f.kind, "file"); assert.equal(f.mime, "application/pdf"); assert.equal(f.name, "Arbeitsblatt – Gewaltenteilung.pdf");
  assert.equal(f.text, "Gewaltenteilung"); assert.ok(designOutdated(f));
  assert.deepEqual(fileOut(f).design, { outdated: true, error: null, htmlAt: f.html_at, pdfAt: null, text: "Gewaltenteilung" });
  let p = printer([() => new Response(PDF(2))]);
  try {
    const r = await renderDesign(c, f);
    assert.equal(r.pages, 2); assert.ok(r.current);
    f = r.file; assert.equal(f.status, "ready"); assert.equal(f.pages, 2); assert.ok(!designOutdated(f));
    assert.ok(c.env.FILES.m.has("l/" + L + "/f/" + f.id));
  } finally { p.restore(); }
  // ersetzen: Bilder als Platzhalter bleiben erhalten, die alte PDF bleibt sichtbar, bis die neue gedruckt ist
  const g = await saveDesign(c, L, { title: "Neu", html: R.shortImages(html).replace("Gewaltenteilung", "Gewaltenteilung heute"), fileId: f.id });
  assert.equal(g.status, "ready"); assert.ok(designOutdated(g)); assert.equal(g.name, "Neu.pdf");
  assert.ok(g.html.includes("QUFBQUFB") && !g.html.includes("unterricks-bild"));
  // ein Druckfehler (Inhalt) wird gemerkt, „ausgelastet“ nicht
  p = printer([() => new Response("Navigation timeout", { status: 422 })]);
  try { await assert.rejects(renderDesign(c, g), (e) => e.code === "render_failed"); } finally { p.restore(); }
  let row = await c.db.prepare("SELECT render_error FROM files WHERE id=?1").bind(g.id).first();
  assert.match(row.render_error, /abgelehnt \(Fehler 422/);
  await c.db.prepare("UPDATE files SET render_error=NULL WHERE id=?1").bind(g.id).run();
  p = printer([() => new Response("busy", { status: 503 })]);
  try { await assert.rejects(renderDesign(c, await c.db.prepare("SELECT * FROM files WHERE id=?1").bind(g.id).first(), { waitMs: 0 }), (e) => e.code === "render_busy"); } finally { p.restore(); }
  row = await c.db.prepare("SELECT render_error FROM files WHERE id=?1").bind(g.id).first();
  assert.equal(row.render_error, null);
  // Druckliste mit Anzahl und Druckart, Verschieben zwischen Druckliste und Material nicht erlaubt
  const d = await saveDesign(c, L, { area: "print", title: "Kärtchen", html: "<p>Karte</p>", print: { copies: 28, duplex: false, color: true } });
  assert.deepEqual([d.print_copies, d.print_duplex, d.print_color], [28, 0, 1]);
  await assert.rejects(saveDesign(c, L, { area: "student", html: "<p>x</p>", fileId: d.id }), /nicht zwischen Druckliste/);
  await assert.rejects(saveDesign(c, L, { area: "nirgends", title: "x", html: "<p>x</p>" }), /Bereich/);
  await assert.rejects(saveDesign(c, "ffffffffffffffff", { html: "<p>x</p>", fileId: f.id }), /keinem gestalteten Material dieser Sitzung/);
  // Platzhalter aus get_material nur beim Überarbeiten desselben Materials
  await assert.rejects(saveDesign(c, L, { area: "student", title: "Variante", html: R.shortImages(html) }), /Bild-Platzhalter/);
  // Fehler unterwegs (kein Fehler des Druckers) werden nicht gemerkt und gelten als „gleich erneut versuchen“
  const brk = { ...c, db: { ...c.db, prepare: (q) => (/render_gate/.test(q) ? { bind: () => ({ first: async () => { throw new Error("D1 kurz weg"); }, run: async () => { throw new Error("D1 kurz weg"); } }), first: async () => { throw new Error("D1 kurz weg"); } } : c.db.prepare(q)) } };
  const g2 = await c.db.prepare("SELECT * FROM files WHERE id=?1").bind(g.id).first();
  await assert.rejects(renderDesign(brk, g2), (e) => e.code === "render_busy");
  assert.equal((await c.db.prepare("SELECT render_error FROM files WHERE id=?1").bind(g.id).first()).render_error, null);
});

test("Material: von „nur Lehrkraft“ zu den Schüler:innen erst mit neuer PDF; ein älterer Druck legt sich nie über einen neueren", async () => {
  const c = await ctx(); const L = await lesson(c);
  let p = printer([() => new Response(PDF(1))]);
  let t = await saveDesign(c, L, { area: "teacher", title: "Erwartungshorizont", html: "<p>Lösungen</p>" });
  try { t = (await renderDesign(c, t)).file; } finally { p.restore(); }
  assert.equal(t.status, "ready");
  const moved = await saveDesign(c, L, { area: "student", html: "<p>ohne Lösungen</p>", fileId: t.id });
  assert.equal(moved.area, "student"); assert.equal(moved.status, "pending", "die Lehrkraft-PDF ist für Schüler:innen nicht sichtbar");
  // älterer Auftrag: Gestaltung v1 wird gedruckt, inzwischen kommt v2 an → v1 landet nicht in R2
  const v1 = await c.db.prepare("SELECT * FROM files WHERE id=?1").bind(t.id).first();
  const key = "l/" + L + "/f/" + t.id, before = c.env.FILES.m.get(key);
  const orig = globalThis.fetch;
  globalThis.fetch = async () => { await saveDesign(c, L, { html: "<p>v2</p>", fileId: t.id }); return new Response(PDF(5)); };
  let r;
  try { r = await renderDesign(c, v1); } finally { globalThis.fetch = orig; }
  assert.equal(r.current, false); assert.equal(c.env.FILES.m.get(key), before, "R2 unverändert");
  const row = await c.db.prepare("SELECT status, pdf_at, html_at FROM files WHERE id=?1").bind(t.id).first();
  assert.ok(row.status === "pending" && row.html_at > (row.pdf_at || 0), "die neue Gestaltung bleibt zu drucken");
});

test("Connector: add_material_pdf legt an und druckt (Seitenzahl in der Antwort), get_material liefert die Gestaltung mit Platzhaltern, get_lesson nennt sie", async () => {
  const c = await ctx(); const L = await lesson(c);
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const call = async (method, params) => {
    const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    const res = await routeMcp({ ...c, request: req, ip: "1.2.3.4" }, "geheim");
    return (await res.json()).result;
  };
  const list = await call("tools/list", {});
  const tool = list.tools.find((t) => t.name === "add_material_pdf");
  assert.ok(tool && tool.description.includes(MATERIAL_DESIGN_RULES[0]) && tool.description.includes("Atkinson Hyperlegible Next"));
  assert.ok(list.tools.find((t) => t.name === "add_text_material").description.startsWith("RÜCKFALL"));
  assert.ok(list.tools.find((t) => t.name === "get_material"));
  const p = printer([() => new Response(PDF(3))]);
  let r;
  try { r = await call("tools/call", { name: "add_material_pdf", arguments: { lesson_id: L, bereich: "schueler", titel: "Arbeitsblatt BVerfG", html: "<html><body><h1>BVerfG</h1><img src=\"data:image/png;base64," + "QUFB".repeat(500) + "\"></body></html>" } }); }
  finally { p.restore(); }
  assert.ok(!r.isError, JSON.stringify(r));
  assert.match(r.content[0].text, /„Arbeitsblatt BVerfG\.pdf“ gespeichert und als PDF gedruckt: 3 Seiten, 1 KB, für die Schüler:innen\./);
  const fid = r.structuredContent.file_id;
  const m = await call("tools/call", { name: "get_material", arguments: { file_id: fid } });
  assert.ok(m.content[0].text.includes("data:unterricks-bild,1") && !m.content[0].text.includes("QUFBQUFB"));
  const l = await call("tools/call", { name: "get_lesson", arguments: { lesson_id: L } });
  assert.ok(l.content[0].text.includes("file_id " + fid + ": „Arbeitsblatt BVerfG.pdf“ (für Schüler:innen; gedruckt, 3 Seiten)"));
  // Drucker ausgelastet: gespeichert, aber mit Hinweis, dass die Sitzungsseite nachdruckt
  const p2 = printer([() => new Response("busy", { status: 503 })]);
  try { r = await call("tools/call", { name: "add_material_pdf", arguments: { lesson_id: L, bereich: "druck", titel: "Kärtchen", html: "<p>x</p>", anzahl: 14, beidseitig: false, farbe: false } }); }
  finally { p2.restore(); }
  assert.match(r.content[0].text, /noch nicht als PDF gedruckt/); assert.match(r.content[0].text, /druckt es automatisch nach/);
  assert.match(r.content[0].text, /„14x - einseitig - sw - Kärtchen\.pdf“/);
  r = await call("tools/call", { name: "add_material_pdf", arguments: { lesson_id: L, titel: "x", html: "<p>x</p>" } });
  assert.ok(r.isError && /bereich/.test(r.content[0].text));
});
