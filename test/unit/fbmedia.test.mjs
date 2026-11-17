// Nachtrag 37 (17.11.2026): Bilder, YouTube-Videos und PDF-Dateien als Material in Feibeitsblatt-Entwürfen. Claude verweist mit propose_feibeitsblatt
// auf Dateien DIESER Sitzung (Rückfrage: „Dateien der Sitzung“; „Nur für die Lehrkraft“ erlaubt, mit Warnhinweis), Unterricks überträgt sie beim Anlegen
// ins Feibeitsblatt (Bilder verkleinert, PDF in Teilen zu 512 KB, Kennungen fest je Blatt/Aufgabe/Art/Datei → „Erneut versuchen“ ohne Doppelte).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const S = await import("../../public/shared.js");
const M = await import("../../public/fbmedia.js");
const { FbClient } = await import("../../public/fbclient.js");
const { sheetToDraft } = await import("../../public/sessionfile.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");
const L = await import("../../worker/lessons.js");

const A = "a".repeat(16), B = "b".repeat(16), Cc = "c".repeat(16), YT = "dQw4w9WgXcQ";

test("Entwurf: Bilder, PDF-Dateien und Videos je Aufgabe – Format, Doppelte, Grenzen wie im Feibeitsblatt (5/3/3 je Aufgabe, 24 Bilder je Blatt)", () => {
  const d = S.normalizeFbDraft({ titel: "T", aufgaben: [
    { text: "Eins", images: [{ file: A, mode: "thumb", alt: " Karikatur\n zur  Wahl " }, { file: A }, { file: "zz" }, { file: B, mode: "quer" }], files: [{ file: Cc }, { file: Cc }],
      videos: [{ id: YT, start: 90, title: "Erklärvideo" }, { id: YT, start: 90 }, { id: YT }, { id: "kurz" }, { id: YT, start: 86400 }] },
    { text: "Zwei", images: Array.from({ length: 9 }, (_, i) => ({ file: String(i).padStart(16, "d") })) }] });
  const [a, b] = d.tasks;
  assert.deepEqual(a.images, [{ file: A, mode: "thumb", alt: "Karikatur zur Wahl" }, { file: B, mode: "inline" }], "doppelte und ungültige Kennungen entfallen, Anzeige sonst groß");
  assert.deepEqual(a.files, [{ file: Cc }]);
  assert.deepEqual(a.videos, [{ id: YT, start: 90, title: "Erklärvideo" }, { id: YT }], "gleiche Startzeit nur einmal, ungültige Kennung/Startzeit fallen weg (≥ 24 h = von vorn)");
  assert.equal(b.images.length, S.FB_MEDIA.imagesPerTask);
  // ohne Medien: kein neues Feld (alte Entwürfe bleiben byte-gleich)
  assert.deepEqual(Object.keys(S.normalizeFbDraft({ tasks: [{ text: "x" }] }).tasks[0]), ["text", "material", "solution", "answer"]);
  // 24 Bilder je Blatt: spätere entfallen
  const many = S.normalizeFbDraft({ tasks: Array.from({ length: 6 }, (_, i) => ({ text: "A" + i, images: Array.from({ length: 5 }, (_, k) => ({ file: (i * 5 + k).toString(16).padStart(16, "e") })) })) });
  assert.equal(many.tasks.reduce((n, t) => n + (t.images || []).length, 0), 24);
  assert.ok(!("images" in many.tasks[5]) && many.tasks[4].images.length === 4);
  assert.equal(S.fbMediaCount(d.tasks), 2 + 1 + 2 + 5);
});

test("Sitzungsdatei: Videos eines Feibeitsblatts kommen in den Entwurf, Bilder und PDF-Dateien nicht (mit Hinweis)", () => {
  const r = sheetToDraft({ title: "T", tasks: [{ text: "A", material: [], solution: "", images: [{ id: "x" }], files: [{ id: "y", name: "M1.pdf" }], videos: [{ id: YT, start: 30, title: "V" }] }] });
  assert.deepEqual(r.draft.tasks[0].videos, [{ id: YT, start: 30, title: "V" }]);
  assert.ok(!r.draft.tasks[0].images && !r.draft.tasks[0].files);
  assert.deepEqual(r.notes, ["Aufgabe 1: Bilder werden nicht übernommen.", "Aufgabe 1: PDF-Dateien werden nicht übernommen."]);
});

/* ---------- Connector ---------- */
async function mcp(c, method, params) {
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
}
const tool = async (c, name, args) => { const r = await mcp(c, "tools/call", { name, arguments: args }); return { text: r.content[0].text, isError: !!r.isError, data: r.structuredContent }; };
async function base() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = Date.UTC(2026, 10, 17, 9, 0);
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  return c;
}
let seq = 0;
async function addFile(c, lessonId, o) {
  const id = (++seq).toString(16).padStart(16, "f");
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, html, html_at, pdf_at, created_at, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)")
    .bind(id, lessonId, o.area || "student", o.kind || "file", o.name, o.mime || "application/pdf", o.size ?? 1000, o.status || "ready", o.source || "upload", o.html ?? null, o.htmlAt ?? null, o.pdfAt ?? null, c.now).run();
  return id;
}
const draftsOf = async (c, lessonId) => ((await c.db.prepare("SELECT data FROM fb_drafts WHERE lesson_id=?1 ORDER BY created_at").bind(lessonId).all()).results || []).map((r) => JSON.parse(r.data));

test("Connector: propose_feibeitsblatt mit Bildern, PDF-Dateien und YouTube-Videos – geprüft gegen die Dateien der Sitzung, Warnhinweis bei „Nur für die Lehrkraft“", async () => {
  const c = await base();
  const l = await L.createLesson(c.db, { subject: "powi", klass: "8A", title: "Wahlen", date: "2026-11-18", startTime: "07:50" }, c.now);
  const img = await addFile(c, l.id, { name: "Karikatur.jpg", mime: "image/jpeg" });
  const pdf = await addFile(c, l.id, { name: "M2 Wahlsysteme.pdf", area: "teacher", size: 2 * 1024 * 1024 });
  const des = await addFile(c, l.id, { name: "Arbeitsblatt.pdf", html: "<p>x</p>", htmlAt: 5, pdfAt: 4, status: "ready" });   // neue Gestaltung wartet auf den Druck
  const link = await addFile(c, l.id, { name: "bpb", kind: "link", mime: "text/uri-list" });
  const notfall = await addFile(c, l.id, { name: "Notfall.pdf", source: "notfall" });
  const pres = await addFile(c, l.id, { name: "Folien.pdf", area: "presentation" });
  const big = await addFile(c, l.id, { name: "Riesig.pdf", size: 7 * 1024 * 1024 });
  const ok = await tool(c, "propose_feibeitsblatt", { lesson_id: l.id, titel: "Wahlen", aufgaben: [
    { text: "Beschreibe die Karikatur.", ki_auftrag: "Achte darauf, ob …", bilder: [{ file_id: img, anzeige: "klein", beschreibung: "Karikatur: Wahlurne" }],
      pdfs: [pdf, des], videos: [{ url: "https://youtu.be/" + YT + "?t=1m30s", titel: "Wahlen erklärt" }] },
    { text: "Vergleiche.", ki_auftrag: "Achte darauf, ob …" }] });
  assert.equal(ok.isError, false, ok.text);
  const [d] = await draftsOf(c, l.id);
  assert.deepEqual(d.tasks[0].images, [{ file: img, mode: "thumb", alt: "Karikatur: Wahlurne" }]);
  assert.deepEqual(d.tasks[0].files, [{ file: pdf }, { file: des }]);
  assert.deepEqual(d.tasks[0].videos, [{ id: YT, start: 90, title: "Wahlen erklärt" }]);
  assert.ok(!("images" in d.tasks[1]) && !("bilder" in d.tasks[0]) && !("pdfs" in d.tasks[0]), "nur das Format des Entwurfs");
  assert.ok(ok.text.includes("Material außer Text: 1 Bild, 2 PDF-Dateien, 1 YouTube-Video – Unterricks überträgt die Dateien beim Anlegen ins Feibeitsblatt."), ok.text);
  assert.ok(ok.text.includes("Achtung: „M2 Wahlsysteme.pdf“ liegt bei „Nur für die Lehrkraft“ – im Feibeitsblatt sehen sie alle Schüler:innen mit dem Code."), ok.text);
  assert.ok(ok.text.includes("„Arbeitsblatt.pdf“ wird noch als PDF gedruckt"), ok.text);
  // Fehler: nie ein Entwurf mit falschen Verweisen
  const fails = [
    [{ bilder: [{ file_id: "9".repeat(16) }] }, "ist keine Datei dieser Sitzung"],
    [{ bilder: [{ file_id: pdf }] }, "ist kein Bild – PDF-Dateien gehören in pdfs"],
    [{ pdfs: [img] }, "ist keine PDF-Datei – Bilder gehören in bilder"],
    [{ pdfs: [link] }, "ein Link – setze ihn als Link ins Material"],
    [{ pdfs: [notfall] }, "(Notfall-Feibeitsblatt)"],
    [{ pdfs: [pres] }, "(Präsentation der Sitzung)"],
    [{ pdfs: [big] }, "zu groß für das Feibeitsblatt (höchstens 6 MB je PDF-Datei)"],
    [{ videos: [{ url: "https://vimeo.com/123" }] }, "Videos anderer Seiten setzt du als Link ins Material"],
    [{ videos: [{ url: "https://www.youtube.com/playlist?list=PL1" }] }, "Playlists lassen sich nicht einbetten"],
  ];
  for (const [extra, msg] of fails) {
    const r = await tool(c, "propose_feibeitsblatt", { lesson_id: l.id, titel: "X", aufgaben: [{ text: "A", ...extra }] });
    assert.ok(r.isError && r.text.includes(msg), JSON.stringify(extra) + " → " + r.text);
  }
  assert.equal((await draftsOf(c, l.id)).length, 1, "kein weiterer Entwurf");
  // Datei einer anderen Sitzung: nicht erlaubt
  const l2 = await L.createLesson(c.db, { subject: "powi", klass: "8A", title: "Andere", date: "2026-11-19", startTime: "07:50" }, c.now);
  const other = await addFile(c, l2.id, { name: "Fremd.jpg", mime: "image/jpeg" });
  assert.ok((await tool(c, "propose_feibeitsblatt", { lesson_id: l.id, titel: "X", aufgaben: [{ text: "A", bilder: [{ file_id: other }] }] })).text.includes("ist keine Datei dieser Sitzung"));
  // 24 Bilder je Blatt
  const imgs = [];
  for (let i = 0; i < 25; i++) imgs.push(await addFile(c, l.id, { name: "B" + i + ".png", mime: "image/png" }));
  const tooMany = await tool(c, "propose_feibeitsblatt", { lesson_id: l.id, titel: "X", aufgaben: Array.from({ length: 5 }, (_, i) => ({ text: "A" + i, bilder: imgs.slice(i * 5, i * 5 + 5).map((id) => ({ file_id: id })) })) });
  assert.ok(tooMany.isError && tooMany.text.includes("Höchstens 24 Bilder je Feibeitsblatt"), tooMany.text);
  // ohne Medien: dieselbe Antwort wie bisher
  const plain = await tool(c, "propose_feibeitsblatt", { lesson_id: l.id, titel: "Ohne", aufgaben: [{ text: "A" }] });
  assert.ok(/^Entwurf gespeichert \(1 Aufgabe, entwurf_id [a-f0-9]{16}\)\. Die Lehrkraft prüft ihn in der Plattform unter „Feibeitsblatt“ und legt das Blatt dort an\.$/.test(plain.text), plain.text);
});

test("Connector: Schema und Beschreibung von propose_feibeitsblatt; get_lesson nennt Bilder und PDF-Dateien als solche", async () => {
  const c = await base();
  const tools = (await mcp(c, "tools/list", {})).tools, pf = tools.find((t) => t.name === "propose_feibeitsblatt");
  const task = pf.inputSchema.properties.aufgaben.items.properties;
  assert.deepEqual([task.bilder.maxItems, task.pdfs.maxItems, task.videos.maxItems], [5, 3, 3]);
  assert.deepEqual(task.bilder.items.properties.anzeige.enum, ["gross", "klein"]);
  assert.ok(pf.description.includes("nie Lösungen, Vorlesetexte") && pf.description.includes("im Bereich „lehrkraft“") && pf.description.includes("Videos nur von YouTube"));
  const l = await L.createLesson(c.db, { subject: "powi", klass: "8A", title: "Wahlen", date: "2026-11-18", startTime: "07:50" }, c.now);
  const img = await addFile(c, l.id, { name: "Karikatur.jpg", mime: "image/jpeg" }), pdf = await addFile(c, l.id, { name: "M1.pdf", area: "teacher" });
  const g = (await tool(c, "get_lesson", { lesson_id: l.id })).text;
  assert.ok(g.includes("- file_id " + img + ": „Karikatur.jpg“ (für Schüler:innen; Bild)") && g.includes("- file_id " + pdf + ": „M1.pdf“ (nur Lehrkraft; PDF)"), g);
  assert.ok(g.includes("baust du mit propose_feibeitsblatt (bilder, pdfs) als Material in Aufgaben eines Feibeitsblatts ein."));
});

/* ---------- Browser: Prüfen, Kennungen, Übertragen ---------- */
test("Browser: Probleme je Datei (fehlt, kein Bild, wartet auf den Druck, zu groß) – sonst in Ordnung", () => {
  const f = (o) => ({ id: A, kind: "file", area: "student", name: "x", mime: "image/png", size: 10, status: "ready", ...o });
  assert.equal(M.problemOf("image", f({})), "");
  assert.equal(M.problemOf("image", null), "Diese Datei gibt es in der Sitzung nicht mehr.");
  assert.equal(M.problemOf("image", f({ area: "archive" })), "Diese Datei gibt es in der Sitzung nicht mehr.");
  assert.equal(M.problemOf("image", f({ mime: "application/pdf" })), "Das ist kein Bild.");
  assert.equal(M.problemOf("file", f({ mime: "application/pdf" })), "");
  assert.equal(M.problemOf("file", f({ mime: "application/pdf", area: "teacher" })), "", "„Nur für die Lehrkraft“ ist erlaubt (Hinweis im Entwurf)");
  assert.equal(M.problemOf("file", f({ mime: "application/pdf", area: "presentation" })), "Diese Datei lässt sich nicht ins Feibeitsblatt übernehmen.");
  assert.equal(M.problemOf("file", f({ mime: "application/pdf", design: { outdated: true } })), "Wird noch als PDF gedruckt – bitte einen Moment warten.");
  assert.ok(M.problemOf("file", f({ mime: "application/pdf", design: { outdated: true, error: "kaputt" } })).startsWith("Der Druck als PDF ist fehlgeschlagen"));
  assert.equal(M.problemOf("file", f({ mime: "application/pdf", size: 7 * 1024 * 1024 })), "Zu groß für das Feibeitsblatt (höchstens 6 MB je PDF-Datei).");
  const items = M.mediaItems([{ images: [{ file: A }], files: [{ file: B }] }, { files: [{ file: Cc }] }], [f({}), f({ id: B, mime: "application/pdf" })]);
  assert.deepEqual(items.map((x) => [x.task, x.kind, x.file && x.file.id, x.problem]), [[1, "image", A, ""], [1, "file", B, ""], [2, "file", null, "Diese Datei gibt es in der Sitzung nicht mehr."]]);
});

test("Browser: Kennungen fest je Blatt, Aufgabe, Art und Datei; PDF-Teile genau 512 KB (der letzte kürzer)", async () => {
  const id1 = await M.uploadIdOf("ABC234", 1, "image", A);
  assert.match(id1, /^[a-f0-9]{16}$/);
  assert.equal(await M.uploadIdOf("ABC234", 1, "image", A), id1, "Wiederholung → dieselbe Kennung");
  const others = await Promise.all([["ABC235", 1, "image", A], ["ABC234", 2, "image", A], ["ABC234", 1, "file", A], ["ABC234", 1, "image", B]].map((x) => M.uploadIdOf(...x)));
  assert.equal(new Set([id1, ...others]).size, 5);
  const u8 = new Uint8Array(M.FB_CHUNK * 2 + 10); u8.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  assert.equal(M.chunksOf(u8.length), 3);
  assert.deepEqual([0, 1, 2].map((n) => M.partOf(u8, n).length), [M.FB_CHUNK, M.FB_CHUNK, 10]);
  assert.ok(M.isPdfBytes(u8) && !M.isPdfBytes(new Uint8Array([1, 2, 3, 4, 5, 6])));
  assert.equal(M.b64Of(new Uint8Array([104, 105])), "aGk=");
});

test("Browser: Vorbereiten scheitert vor dem Anlegen (Problem, keine PDF, zu groß); Übertragen nacheinander, Fehler je Datei, Wiederholung ab dem fehlenden Teil", async () => {
  const pdfFile = { id: B, kind: "file", area: "student", name: "M1.pdf", mime: "application/pdf", size: 10, status: "ready" };
  await assert.rejects(M.prepareMedia([{ task: 1, kind: "file", ref: { file: B }, file: null, problem: "Diese Datei gibt es in der Sitzung nicht mehr." }], { blobOf: async () => new Blob([]) }),
    /So lässt sich das Feibeitsblatt noch nicht anlegen: „PDF-Datei“ \(Aufgabe 1\): Diese Datei gibt es in der Sitzung nicht mehr\./);
  await assert.rejects(M.prepareMedia([{ task: 1, kind: "file", ref: { file: B }, file: pdfFile, problem: "" }], { blobOf: async () => new Blob(["kein pdf"]) }), /keine lesbare PDF-Datei/);
  const big = new Uint8Array(M.FB_CHUNK * 2 + 10); big.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const steps = [];
  const prepared = await M.prepareMedia([{ task: 2, kind: "file", ref: { file: B }, file: pdfFile, problem: "" }], { blobOf: async () => new Blob([big]), onStep: (m) => steps.push(m) });
  assert.deepEqual(steps, ["Bereite 1 von 1 vor: „M1.pdf“ …"]);
  // Übertragen: Teil 2 scheitert einmal → Wiederholung beginnt bei Teil 2; ein Bild dazwischen
  const sent = [];
  let failOnce = true;
  const fb = {
    uploadImage: async (code, body) => { sent.push(["img", body.task, body.mode, body.alt, body.id]); return { ok: true }; },
    uploadFilePart: async (code, body) => {
      if (body.n === 1 && failOnce) { failOnce = false; throw new Error("Feibeitsblatt ist nicht erreichbar"); }
      sent.push(["pdf", body.task, body.n, body.chunks, body.bytes, Buffer.from(body.data, "base64").length, body.name]);
      return { ok: true, file: { complete: body.n === body.chunks - 1 } };
    },
  };
  const imgItem = { task: 1, kind: "image", ref: { file: A, mode: "thumb", alt: "Karikatur" }, file: { id: A, name: "K.jpg" }, prep: { data: "AAAA" } };
  const up = await M.uploadMedia(fb, "ABC234", [imgItem, ...prepared]);
  assert.equal(up.done, 1);
  assert.deepEqual(up.failed.map((f) => [f.item.file.name, f.error]), [["M1.pdf", "Feibeitsblatt ist nicht erreichbar"]]);
  assert.deepEqual(sent.map((x) => x.slice(0, 4)), [["img", 1, "thumb", "Karikatur"], ["pdf", 2, 0, 3]]);
  const again = await M.uploadMedia(fb, "ABC234", up.failed.map((f) => f.item));
  assert.deepEqual([again.done, again.failed.length], [1, 0]);
  assert.deepEqual(sent.slice(2).map((x) => x.slice(0, 7)), [["pdf", 2, 1, 3, big.length, M.FB_CHUNK, "M1.pdf"], ["pdf", 2, 2, 3, big.length, 10, "M1.pdf"]], "ab Teil 2 weiter, Teile mit genau der erwarteten Größe");
  // kam die Datei unvollständig an: nächste Wiederholung beginnt bei Teil 1
  const x = { ...prepared[0], next: 0 }, fb2 = { uploadFilePart: async (code, body) => ({ ok: true, file: { complete: false } }) };
  const r = await M.uploadMedia(fb2, "ABC234", [x]);
  assert.equal(r.failed[0].error, "Die Datei kam nicht vollständig an.");
  assert.equal(x.next, 0);
});

test("createSheet: YouTube-Videos gehen mit dem Blatt (Kennung, Start, Titel), Bilder und PDF-Dateien nicht (die lädt Unterricks danach hoch)", async () => {
  const sent = [], orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, code: "ABC234", title: "T", videoCount: 1 })); };
  try {
    const fb = new FbClient("https://fb.test"); fb.authKey = "x";
    const r = await fb.createSheet({ title: "T", tasks: [{ text: "A", material: "", solution: "", answer: { type: "text" }, images: [{ file: A, mode: "inline" }], files: [{ file: B }], videos: [{ id: YT, start: 30, title: "V" }] }] }, { klass: "8A" });
    assert.equal(r.videoCount, 1);
  } finally { globalThis.fetch = orig; }
  const t = sent[0].tasks[0];
  assert.deepEqual(t.videos, [{ id: YT, start: 30, title: "V" }]);
  assert.ok(!("images" in t) && !("files" in t));
});

test("Sitzungsdatei laden: Entwürfe verlieren Bilder und PDF-Dateien (Dateien kommen nicht mit), Videos bleiben", async () => {
  const c = await base(), TOKEN = "lehrkraft-token-fbmedia";
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  const l = await L.createLesson(c.db, { subject: "powi", klass: "8A", title: "Neu", date: "2026-11-18", startTime: "07:50" }, c.now);
  const fn = L.routeLessonImport || L.routeSessionImport;
  assert.ok(typeof fn === "function", "Import-Route vorhanden");
  const req = new Request("https://unterricks.test/x", { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ drafts: [{ title: "T", tasks: [{ text: "A", images: [{ file: A }], files: [{ file: B }], videos: [{ id: YT }] }] }] }) });
  const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, l.id);
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const [d] = await draftsOf(c, l.id);
  assert.deepEqual(d.tasks[0].videos, [{ id: YT }]);
  assert.ok(!("images" in d.tasks[0]) && !("files" in d.tasks[0]));
});

// Gegen die echte Prüfung des Feibeitsblatts – nur, wenn sein Quelltext daneben liegt (../feibeitsblatt oder FEIBEITSBLATT_DIR); nur gelesen
const { existsSync } = await import("node:fs");
const { pathToFileURL, fileURLToPath } = await import("node:url");
const REAL_LIB = process.env.FEIBEITSBLATT_DIR ? process.env.FEIBEITSBLATT_DIR.replace(/\/$/, "") + "/worker/lib.js" : fileURLToPath(new URL("../../../feibeitsblatt/worker/lib.js", import.meta.url));
test("echte Prüfung des Feibeitsblatts (falls vorhanden): Blatt mit Videos, Bild-Upload und PDF-Teile so, wie Unterricks sie schickt, werden angenommen", { skip: !existsSync(REAL_LIB) && "Quelltext des Feibeitsblatts nicht vorhanden" }, async () => {
  const real = await import(pathToFileURL(REAL_LIB).href);
  // Blatt: Videos aus dem Entwurf
  const sent = [], orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, code: "ABC234", title: "T" })); };
  try {
    const fb = new FbClient("https://fb.test"); fb.authKey = "x";
    await fb.createSheet(S.normalizeFbDraft({ titel: "T", aufgaben: [{ text: "Sieh dir das Video an.", ki_auftrag: "Achte darauf, ob …", videos: [{ id: YT, start: 90, title: "Wahlen erklärt" }, { id: "abcdefghijk" }] }] }, { fromAi: true }), { klass: "8A" });
  } finally { globalThis.fetch = orig; }
  const out = real.validateSheetInput(sent[0]);
  assert.deepEqual(out.tasks[0].videos, [{ id: YT, start: 90, title: "Wahlen erklärt" }, { id: "abcdefghijk" }]);
  // Bild: PNG-Kopf (wie canvas.toBlob) als Base64 mit Kennung, Aufgabe, Anzeige und Beschreibung
  const png = new Uint8Array(64); png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 2, 0, 0, 0, 1, 0x80]);
  const img = real.validateImageUpload({ id: await M.uploadIdOf("ABC234", 1, "image", A), task: 1, mode: "thumb", alt: "Karikatur", data: M.b64Of(png) });
  assert.deepEqual([img.info.mime, img.info.w, img.info.h, img.mode, img.alt], ["image/png", 512, 384, "thumb", "Karikatur"]);
  // PDF: jeder Teil, wie uploadMedia ihn schickt
  const u8 = new Uint8Array(M.FB_CHUNK + 1234); u8.set([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const id = await M.uploadIdOf("ABC234", 1, "file", B);
  for (let n = 0; n < M.chunksOf(u8.length); n++) {
    const v = real.validateFileUpload({ id, task: 1, name: "M2 Wahlsysteme.pdf", bytes: u8.length, chunks: M.chunksOf(u8.length), n, data: M.b64Of(M.partOf(u8, n)) });
    assert.deepEqual([v.n, v.chunks, v.name], [n, 2, "M2 Wahlsysteme.pdf"]);
  }
});
