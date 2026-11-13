// Notizen der Lehrkraft zu den Folien (Nachtrag 20): Helfer in public/shared.js (Prüfen/Kappen, JSON aus dem Chat, Präsentations-Prompt),
// bereinigte Fassung für Schüler:innen (public/pdfcut.js, pdf-lib), Notizen aus dem Anhang (public/pdfnotes.js, PDF.js), Anmerkungs-PDF,
// Routen des Workers (Lehrkraft ja, Schüler:innen nie) und der Präsentationsmodus im Browser-Ersatz (Notizen nur mit getrenntem Beamerbild,
// nie in Nachrichten an Beamerfenster oder Server). Die Test-PDFs entstehen hier mit pdf-lib – frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript," + encodeURIComponent("export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"), shortCircuit: true } : n(s, c); }'));
const PL = await import("pdf-lib");
const { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString } = PL;
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const S = await import("../../public/shared.js");
const { cleanPdfBytes, cutPdfBytes } = await import("../../public/pdfcut.js");
const { annotatedPdfBytes, scanPdfNotes, pickNotes } = await import("../../public/pdfnotes.js");
const { cleanSessionFile } = await import("../../public/sessionfile.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const F = await import("../../worker/files.js");
const L = await import("../../worker/lessons.js");
const ST = await import("../../worker/student.js");
const { sha256Hex } = await import("../../worker/lib.js");

const te = new TextEncoder();
const SECRET_NOTE = "GEHEIMNOTIZ Impuls: Was wäre ohne Gewaltenteilung?";
const NOTES = { v: 1, folien: [{ folie: 1, notizen: [SECRET_NOTE, "Erwartung: Machtmissbrauch", "Zeit: 5 Minuten"] }, { folie: 3, notizen: ["Codefolie: Partnerarbeit ankündigen"] }] };

// Präsentation wie von Claude (pypdf add_attachment): Notizen als Dateianhang; auf Folie 1 zusätzlich eine Notiz-Anmerkung (Text), eine
// Dateianhang-Anmerkung und ein Link, der für Schüler:innen bleiben soll
async function deckPdf({ pages = 3, notes = NOTES, annots = true } = {}) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) d.addPage([960, 540]).drawText("Folie " + i + " Gewaltenteilung", { x: 50, y: 270, size: 40, font: f });
  if (notes) await d.attach(te.encode(JSON.stringify(notes)), S.NOTES_FILE, { mimeType: "application/json", description: "Notizen" });
  if (annots) {
    const ctx = d.context, page = d.getPage(0);
    const textA = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Text", Rect: [10, 10, 30, 30], Contents: PDFString.of("GEHEIMKOMMENTAR") }));
    const ef = ctx.register(ctx.flateStream(te.encode("GEHEIMANHANG Inhalt"), { Type: "EmbeddedFile" }));
    const fs = ctx.register(ctx.obj({ Type: "Filespec", F: PDFString.of("x.txt"), UF: PDFHexString.fromText("x.txt"), EF: { F: ef } }));
    const fa = ctx.register(ctx.obj({ Type: "Annot", Subtype: "FileAttachment", Rect: [40, 10, 60, 30], FS: fs, Contents: PDFString.of("GEHEIMDATEI") }));
    const link = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [100, 100, 300, 140], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of("https://example.org/quelle") } }));
    page.node.set(PDFName.of("Annots"), ctx.obj([textA, fa, link]));
    page.node.set(PDFName.of("AF"), ctx.obj([fs]));
  }
  return d.save();
}
// alle Bytes samt entpackter Streams (Objekt-Streams, Inhalte, Anhänge) als Text – so findet die Suche auch komprimierte Notizen
function allText(bytes) {
  const raw = Buffer.from(bytes), parts = [raw.toString("latin1")];
  let i = 0;
  for (;;) {
    const s = raw.indexOf("stream", i); if (s < 0) break;
    let a = s + 6; if (raw[a] === 13) a++; if (raw[a] === 10) a++;
    const e = raw.indexOf("endstream", a); if (e < 0) break;
    try { parts.push(inflateSync(raw.subarray(a, e)).toString("utf8")); } catch {}
    i = e + 9;
  }
  return parts.join("\n");
}
const pdfText = async (bytes) => {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) out.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ").replace(/\s+/g, " "));
  await doc.destroy();
  return out;
};

test("Notizen prüfen und kappen: Format der PDF, intern, als Text; nur Folien der PDF, höchstens 12 × 300 Zeichen, einzeilig", () => {
  assert.deepEqual(S.cleanSlideNotes(NOTES, 3), [{ n: 1, items: NOTES.folien[0].notizen }, { n: 3, items: ["Codefolie: Partnerarbeit ankündigen"] }]);
  assert.deepEqual(S.cleanSlideNotes(NOTES, 2), [{ n: 1, items: NOTES.folien[0].notizen }], "Folie 3 gibt es nicht");
  assert.deepEqual(S.cleanSlideNotes([{ n: 2, items: "- erster\n\n• zweiter\r\n3) dritter" }], 5), [{ n: 2, items: ["erster", "zweiter", "dritter"] }], "Text: eine Zeile = ein Stichpunkt, Aufzählungszeichen weg");
  assert.deepEqual(S.cleanSlideNotes({ slides: [{ n: 1, items: ["a\u0000b‮c", "  ", 42, null, { x: 1 }] }] }, 1), [{ n: 1, items: ["a b c", "42"] }], "Steuerzeichen, leere und fremde Einträge");
  const many = S.cleanSlideNotes({ folien: [{ folie: 1, notizen: Array.from({ length: 30 }, (_, i) => "Punkt " + i + " " + "ä".repeat(400)) }] }, 1);
  assert.equal(many[0].items.length, S.NOTES_LIMITS.items);
  assert.ok(many[0].items.every((t) => Array.from(t).length <= S.NOTES_LIMITS.chars));
  assert.deepEqual(S.cleanSlideNotes({ folien: [{ folie: 2, notizen: ["x"] }, { folie: 2, notizen: ["y"] }, { folie: 0, notizen: ["z"] }, { folie: 1.5, notizen: ["q"] }] }, 9), [{ n: 2, items: ["x", "y"] }]);
  for (const bad of [null, "x", 3, { folien: "x" }, {}]) assert.deepEqual(S.cleanSlideNotes(bad, 3), []);
  // Gesamtgrenze: nie mehr als NOTES_LIMITS.total Zeichen
  const huge = S.cleanSlideNotes({ folien: Array.from({ length: 300 }, (_, i) => ({ folie: i + 1, notizen: Array.from({ length: 12 }, () => "x".repeat(300)) })) }, 300);
  assert.ok(huge.reduce((n, x) => n + x.items.join("").length, 0) <= S.NOTES_LIMITS.total);
  assert.ok(S.isNotesFileName("Unterricks-Notizen.JSON") && S.isNotesFileName("unterricks_notizen.json") && !S.isNotesFileName("notizen.json"));
  assert.equal(S.annotatedName("BVerfG.pdf"), "Präsentation mit Anmerkungen – BVerfG.pdf");
});

test("JSON aus dem Chat einfügen: Block mit ```json, roher Text, Folien außerhalb der PDF und Fehler mit verständlicher Meldung", () => {
  const r = S.parseNotesJson("Hier die Notizen:\n```json\n" + JSON.stringify({ v: 1, folien: [{ folie: 1, notizen: ["a"] }, { folie: 7, notizen: ["b"] }] }) + "\n```\nViel Erfolg!", 5);
  assert.deepEqual(r, { notes: [{ n: 1, items: ["a"] }], slides: 1, dropped: [7] });
  assert.equal(S.parseNotesJson('{"folien":[{"folie":2,"notizen":["x"]}]}', 3).slides, 1);
  assert.throws(() => S.parseNotesJson("", 3), /zuerst den JSON-Block/);
  assert.throws(() => S.parseNotesJson("keine Notizen", 3), /kein JSON-Block/);
  assert.throws(() => S.parseNotesJson('{"folien": [ {"folie": 1, ', 3), /unvollständig oder fehlerhaft/);
  assert.throws(() => S.parseNotesJson('{"foo": 1}', 3), /erwarteten Format/);
  // Ablaufprüfung: die ganze Antwort aus dem Chat kopiert, vor dem JSON-Block steht ein anderer Code-Block (das Python-Skript, mit dem Claude es versuchte)
  const chat = "Das Einbetten ging hier nicht:\n```python\nimport json\nnotizen = {\"v\": 1}\n```\nHier die Notizen:\n```json\n" +
    JSON.stringify({ v: 1, folien: [{ folie: 2, notizen: ["Impuls"] }] }, null, 2) + "\n```\nViel Erfolg!";
  assert.deepEqual(S.parseNotesJson(chat, 3), { notes: [{ n: 2, items: ["Impuls"] }], slides: 1, dropped: [] });
  assert.equal(S.parseNotesJson('```json {"folien":[{"folie":1,"notizen":["a"]}]}```', 3).slides, 1, "Block in einer Zeile");
  assert.throws(() => S.parseNotesJson("```python\nnotizen = {\"v\": 1}\n```", 3), /erwarteten Format/);
});

test("Präsentations-Prompt erklärt die Notizen: Dateianhang unterricks-notizen.json, Format, pypdf, Rückfall im Chat – nicht mehr nur im Chat", () => {
  const ctx = { subject: "powi", klass: "Q2-GK", lessonId: "abc", lesson: { title: "BVerfG", topic: "Das BVerfG" }, materials: [], sheets: [] };
  for (const p of [S.claudePresentationPrompt(ctx, "**1) Einstieg**", []), S.claudePresentationPrompt({ ...ctx, klass: "6A" }, "**1) Einstieg**", [])]) {
    const sec = p.slice(p.indexOf("## Notizen für die Lehrkraft: unsichtbar in der PDF"), p.indexOf("## Rahmendaten"));
    assert.ok(sec.length > 300);
    for (const t of ["zu jeder Folie Notizen für die Lehrkraft in Stichpunkten", "erwartete Antworten der Schüler:innen, Zeit", "die Schüler:innen sehen sie nie",
      "Dateianhang (eingebettete Datei, EmbeddedFile) namens unterricks-notizen.json", '{"v":1,"folien":[{"folie":1,"notizen":["…","…"]}', "Seitenzahl in der PDF (die Titelfolie ist 1",
      "auch Unterricks-Codefolien, die ebenfalls Notizen bekommen", "0 bis 12 Stichpunkte mit je höchstens 300 Zeichen", "writer.add_attachment(\"unterricks-notizen.json\"",
      "Keine Notizen als Kommentare, Anmerkungen oder Sprechblasen", "JSON-Block in genau diesem Format", "„JSON aus dem Chat einfügen“"]) assert.ok(sec.includes(t), t);
    assert.ok(!p.includes("gibst du mir zusätzlich hier im Chat als kurze Liste") && !p.includes("eine PDF hat keine Sprechernotizen"), "die alte Anweisung (nur im Chat) ist ersetzt");
    assert.ok(p.includes("die Notizen für die Lehrkraft gehören in die PDF (Dateianhang unterricks-notizen.json), nicht als eigenes Material in die Sitzung"));
  }
});

test("bereinigte Fassung für Schüler:innen: gleiche Seiten, ohne Anhänge, ohne Notiz-Anmerkungen und ohne /AF – der Link bleibt", async () => {
  const pdf = await deckPdf();
  const before = allText(pdf);
  assert.ok(before.includes("GEHEIMNOTIZ") && before.includes("GEHEIMANHANG") && before.includes("GEHEIMKOMMENTAR"), "die Testdatei trägt die Notizen wirklich");
  const clean = await cleanPdfBytes(pdf, PL);
  const t = allText(clean), doc = await PDFDocument.load(clean);
  assert.equal(doc.getPageCount(), 3);
  for (const s of ["GEHEIM", "EmbeddedFile", "/AF", "FileAttachment", "unterricks-notizen", "/Subtype /Text"]) assert.ok(!t.includes(s), s);
  assert.ok(t.includes("https://example.org/quelle") && t.includes("/Link"), "Link bleibt anklickbar");
  assert.deepEqual((await pdfText(clean)).map((x) => x.trim()), ["Folie 1 Gewaltenteilung", "Folie 2 Gewaltenteilung", "Folie 3 Gewaltenteilung"], "sichtbarer Inhalt unverändert");
  // gekürzt (Bis hier gezeigt) mit clean: dasselbe; ohne clean (ältere Präsentation) bleibt es wie bisher
  const cut = await cutPdfBytes(pdf, 2, PDFDocument, { clean: true, lib: PL });
  assert.equal((await PDFDocument.load(cut)).getPageCount(), 2);
  assert.ok(!allText(cut).includes("GEHEIM"));
  assert.ok(allText(await cutPdfBytes(pdf, 2, PDFDocument)).includes("GEHEIMKOMMENTAR"), "ohne clean: Seiten unverändert kopiert (wie bisher)");
});

test("Notizen aus der PDF lesen (PDF.js): Anhang unterricks-notizen.json, Anhänge/Anmerkungen → bereinigte Fassung nötig; ohne beides nicht", async () => {
  const doc = await pdfjs.getDocument({ data: (await deckPdf()).slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const scan = await scanPdfNotes(doc);
  assert.equal(scan.needsClean, true);
  assert.deepEqual(S.cleanSlideNotes(scan.raw, doc.numPages), S.cleanSlideNotes(NOTES, 3));
  await doc.destroy();
  const plain = await pdfjs.getDocument({ data: (await deckPdf({ notes: null, annots: false })).slice(), isEvalSupported: false, verbosity: 0 }).promise;
  assert.deepEqual(await scanPdfNotes(plain), { attachments: 0, needsClean: false, raw: null }, "ältere Präsentation ohne Notizen: unverändert");
  await plain.destroy();
  // nur eine Notiz-Anmerkung (ohne Anhang): trotzdem bereinigen
  const ann = await pdfjs.getDocument({ data: (await deckPdf({ notes: null })).slice(), isEvalSupported: false, verbosity: 0 }).promise;
  assert.equal((await scanPdfNotes(ann)).needsClean, true);
  await ann.destroy();
  // tolerant: anderer Name in Groß-/Kleinschreibung, sonst eine JSON-Datei mit „folien“; kaputte Dateien zählen nicht
  const j = (o) => te.encode(JSON.stringify(o));
  assert.deepEqual(pickNotes([{ name: "UNTERRICKS-NOTIZEN.JSON", content: j(NOTES) }]), NOTES);
  assert.deepEqual(pickNotes([{ name: "kaputt.json", content: te.encode("{") }, { name: "notes.json", content: j(NOTES) }]), NOTES);
  assert.equal(pickNotes([{ name: "bild.png", content: j(NOTES) }, { name: "andere.json", content: j({ x: 1 }) }]), null);
  // Ablaufprüfung: Anhang unterricks-notizen.json vorhanden, aber nicht lesbar (kein gültiges JSON) – notesFile, damit die Meldung nach dem
  // Hochladen es sagt (sonst blieben die Notizen still aus)
  const bad = await PDFDocument.create(); bad.addPage([960, 540]);
  await bad.attach(te.encode('{"v":1,"folien":[{"folie":1,"notizen":["a"]},]'), S.NOTES_FILE, { mimeType: "application/json" });
  const bdoc = await pdfjs.getDocument({ data: (await bad.save()).slice(), isEvalSupported: false, verbosity: 0 }).promise;
  const bscan = await scanPdfNotes(bdoc);
  assert.ok(bscan.notesFile === true && bscan.raw === null && bscan.needsClean === true, JSON.stringify(bscan));
  await bdoc.destroy();
  assert.equal((await scanPdfNotes(await pdfjs.getDocument({ data: (await deckPdf()).slice(), isEvalSupported: false, verbosity: 0 }).promise)).notesFile, true);
});

test("Anmerkungs-PDF: hinter jeder Folie eine Anmerkungsfolie im selben Format, Codefolie gekennzeichnet, Fortsetzung bei langen Notizen", async () => {
  const pdf = await deckPdf();
  const out = await annotatedPdfBytes(pdf, S.cleanSlideNotes(NOTES, 3), PL, { codeSlides: [{ n: 3, lines: [] }], title: "BVerfG" });
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 6, "2 × 3 Seiten");
  assert.deepEqual(doc.getPages().map((p) => [p.getWidth(), p.getHeight()]), Array(6).fill([960, 540]));
  assert.equal(doc.getTitle(), "Präsentation mit Anmerkungen – BVerfG");
  const txt = await pdfText(out);
  assert.match(txt[0], /Folie 1 Gewaltenteilung/);
  assert.ok(txt[1].includes("Anmerkungen zu Folie 1") && txt[1].includes("GEHEIMNOTIZ Impuls: Was wäre ohne Gewaltenteilung?") && txt[1].includes("Zeit: 5 Minuten") && txt[1].includes("nur für die Lehrkraft"));
  assert.ok(txt[3].includes("Anmerkungen zu Folie 2") && txt[3].includes("Keine Anmerkungen zu dieser Folie."));
  assert.ok(txt[5].includes("Anmerkungen zu Folie 3 (Codefolie)") && txt[5].includes("Partnerarbeit ankündigen"));
  assert.ok(!allText(out).includes("GEHEIMANHANG") && !allText(out).includes("EmbeddedFile"), "Anhänge der Präsentation kommen nicht mit");
  // lange Notizen und Zeichen außerhalb von WinAnsi: Fortsetzung statt abgeschnittenem Text, kein Absturz
  const long = [{ n: 1, items: Array.from({ length: 12 }, (_, i) => "Stichpunkt " + (i + 1) + " → Ἐν ἀρχῇ 😀 " + "Wort ".repeat(56)) }];
  const out2 = await annotatedPdfBytes(pdf, long, PL);
  const d2 = await PDFDocument.load(out2), t2 = await pdfText(out2);
  assert.ok(d2.getPageCount() >= 7, "mindestens eine Fortsetzung (" + d2.getPageCount() + " Seiten)");
  assert.ok(t2[2].includes("Anmerkungen zu Folie 1 (Fortsetzung)") && t2.join(" ").includes("Stichpunkt 12 ->"));
});

/* ---------- Worker: Routen ---------- */
const TOKEN = "lehrkraft-token-123", STOKEN = "schueler-token-123", DEV = "dddddddddddddddd";
const callAs = (tok) => async (c, fn, method, path, body, ...args) => {
  const raw = body instanceof Uint8Array;
  const headers = { Authorization: "Bearer " + tok, "Content-Type": raw ? (/\/slides\//.test(path) ? "image/jpeg" : "application/pdf") : "application/json" };
  if (raw) headers["Content-Length"] = String(body.length);
  const req = new Request("https://unterricks.test" + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: res.headers.get("content-type")?.includes("json") ? await res.json() : res }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code, ...(e.extra || {}) } }; }
};
const call = callAs(TOKEN), scall = callAs(STOKEN);   // Lehrkraft bzw. Schüler:in
async function setup() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  // Sitzung vor zwei Tagen: die Präsentation ist für Schüler:innen freigegeben (5 Minuten nach dem Ende)
  const l = await L.createLesson(c.db, { subject: "powi", klass: "Q2-GK", title: "Gewaltenteilung", date: new Date(c.now - 2 * 864e5).toISOString().slice(0, 10), startTime: "08:00", durationMin: 90 }, c.now - 864e5);
  c.db.raw.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, 'Q2-GK', 'powi', ?, ?, ?)").run(DEV, await sha256Hex(STOKEN), c.now, c.now, c.now + 3600e3);
  c.db.raw.prepare("INSERT INTO student_access(device_id, lesson_id, joined_at) VALUES(?, ?, ?)").run(DEV, l.id, c.now - 600e3);
  const pdf = await deckPdf();
  const up = await call(c, F.routePresentationUpload, "POST", "/api/teacher/lessons/" + l.id + "/presentation?name=BVerfG.pdf", pdf, l.id);
  const fid = up.data.file.id;
  for (let n = 1; n <= 3; n++) await call(c, F.routeSlideUpload, "PUT", "/api/teacher/files/" + fid + "/slides/" + n + "?w=1920&h=1080", new Uint8Array([0xff, 0xd8, n]), fid, String(n)).then((r) => assert.equal(r.status, 200));
  return { c, l, fid, pdf };
}
const ready = (c, fid, body) => call(c, F.routePresentationReady, "POST", "/api/teacher/files/" + fid + "/ready", body, fid);

test("Server: Notizen mit …/ready gespeichert (nur Lehrkraft-Routen); Schüler:innen bekommen ohne bereinigte Fassung keine PDF, danach nur sie", async () => {
  const { c, l, fid, pdf } = await setup();
  const r = await ready(c, fid, { pages: 3, codeSlides: [], notes: NOTES, clean: true });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.file.notes, r.data.file.notesRev, r.data.file.cleanNeeded, r.data.file.cleanReady], [2, 1, true, false]);
  assert.ok(!JSON.stringify(r.data.file).includes("GEHEIMNOTIZ"), "fileOut nennt nur die Zahl");
  const sl = await call(c, F.routeTeacherSlides, "GET", "/api/teacher/files/" + fid + "/slides", undefined, fid);
  assert.deepEqual(sl.data.notes, S.cleanSlideNotes(NOTES, 3)); assert.equal(sl.data.notesRev, 1);
  const ng = await call(c, F.routeNotesGet, "GET", "/api/teacher/files/" + fid + "/notes", undefined, fid);
  assert.deepEqual([ng.data.rev, ng.data.pages, ng.data.notes.length], [1, 3, 2]);
  // Schüler:in: weder mit dem eigenen Token an Lehrkraft-Routen noch in der Schüleransicht
  assert.equal((await scall(c, F.routeNotesGet, "GET", "/api/teacher/files/" + fid + "/notes", undefined, fid)).status, 401);
  assert.equal((await scall(c, F.routeTeacherSlides, "GET", "/api/teacher/files/" + fid + "/slides", undefined, fid)).status, 401);
  const sv = await scall(c, ST.routeStudentLesson, "GET", "/api/student/lessons/" + l.id, undefined, l.id);
  assert.equal(sv.status, 200); assert.ok(!JSON.stringify(sv.data).includes("GEHEIM") && !JSON.stringify(sv.data).includes("notes"));
  // nach der Freigabe: ohne bereinigte Fassung 409 (nie die hochgeladene PDF mit den Notizen)
  const late = c;
  const pl0 = await scall(late, ST.routeStudentPresentationLink, "POST", "/api/student/lessons/" + l.id + "/presentation-link", { inline: false }, l.id);
  assert.deepEqual([pl0.status, pl0.data.code], [409, "not_ready"]);
  const cleanBytes = await cleanPdfBytes(pdf, PL);
  const cp = await call(c, F.routeCleanPut, "PUT", "/api/teacher/files/" + fid + "/clean", cleanBytes, fid);
  assert.deepEqual([cp.status, cp.data.file.cleanReady], [200, true]);
  const pl = await scall(late, ST.routeStudentPresentationLink, "POST", "/api/student/lessons/" + l.id + "/presentation-link", { inline: false }, l.id);
  assert.equal(pl.status, 200); assert.match(pl.data.url, /&p=clean&/);
  const dl = await F.routeDownload({ ...late, request: new Request("https://unterricks.test" + pl.data.url) }, fid);
  const got = new Uint8Array(await dl.arrayBuffer());
  assert.deepEqual(got, new Uint8Array(cleanBytes)); assert.ok(!allText(got).includes("GEHEIM"));
  assert.match(dl.headers.get("content-disposition"), /BVerfG\.pdf/);
  // der Link ohne p=clean (die hochgeladene PDF) passt nicht zur Signatur
  await assert.rejects(F.routeDownload({ ...late, request: new Request("https://unterricks.test" + pl.data.url.replace("&p=clean", "")) }, fid), (e) => e.status === 403);
  // ein erneutes …/ready ohne clean hebt die Pflicht nie auf
  await ready(c, fid, { pages: 3, codeSlides: [] });
  assert.equal(c.db.raw.prepare("SELECT clean_size FROM files WHERE id=?").get(fid).clean_size, cleanBytes.length);
  // „Bis hier gezeigt“: eine ältere Seite (ohne clean=1) darf nicht kürzen; mit clean=1 schon
  const cut = await cutPdfBytes(pdf, 2, PDFDocument, { clean: true, lib: PL });
  assert.equal((await call(c, F.routeShownPut, "PUT", "/api/teacher/files/" + fid + "/shown?until=2", cut, fid)).status, 409);
  assert.equal((await call(c, F.routeShownPut, "PUT", "/api/teacher/files/" + fid + "/shown?until=2&clean=1", cut, fid)).status, 200);
  const pl2 = await scall(late, ST.routeStudentPresentationLink, "POST", "/api/student/lessons/" + l.id + "/presentation-link", { inline: false }, l.id);
  assert.match(pl2.data.url, /&p=cut&/);
});

test("Server: ältere Präsentation ohne Notizen bleibt, wie sie war (die hochgeladene PDF, keine Pflicht zur Bereinigung)", async () => {
  const { c, l, fid } = await setup();
  const r = await ready(c, fid, { pages: 3, codeSlides: [] });
  assert.deepEqual([r.data.file.notes, r.data.file.notesRev, r.data.file.cleanNeeded], [0, 0, false]);
  const pl = await scall(c, ST.routeStudentPresentationLink, "POST", "/api/student/lessons/" + l.id + "/presentation-link", { inline: false }, l.id);
  assert.equal(pl.status, 200); assert.ok(!pl.data.url.includes("p="));
  assert.equal((await call(c, F.routeAnnotatedPut, "PUT", "/api/teacher/files/" + fid + "/annotated?rev=0", new Uint8Array([37, 80, 68, 70]), fid)).status, 400, "ohne Notizen keine Anmerkungs-PDF");
});

test("Server: Notizen bearbeiten mit Versionsschutz; Anmerkungs-PDF nur unter „Material nur für die Lehrkraft“, ersetzt, entfernt, mit der Präsentation gelöscht", async () => {
  const { c, l, fid, pdf } = await setup();
  await ready(c, fid, { pages: 3, codeSlides: [], notes: NOTES, clean: true });
  // 409 bei veraltetem Stand – mit dem aktuellen Stand, nichts überschrieben
  const stale = await call(c, F.routeNotesPut, "PUT", "/api/teacher/files/" + fid + "/notes", { notes: [{ n: 2, items: ["neu"] }], rev: 0 }, fid);
  assert.deepEqual([stale.status, stale.data.code, stale.data.current.rev], [409, "notes_conflict", 1]);
  const ok = await call(c, F.routeNotesPut, "PUT", "/api/teacher/files/" + fid + "/notes", { notes: [{ n: 2, items: ["neu", "", "zweiter"] }, { n: 9, items: ["weg"] }], rev: 1 }, fid);
  assert.deepEqual([ok.status, ok.data.rev, ok.data.notes], [200, 2, [{ n: 2, items: ["neu", "zweiter"] }]]);
  assert.equal((await call(c, F.routeNotesPut, "PUT", "/api/teacher/files/" + fid + "/notes", { notes: [], rev: 1 }, fid)).status, 409, "zweiter Tab mit altem Stand");
  // Anmerkungs-PDF: nur mit dem aktuellen Stand
  const ann = await annotatedPdfBytes(pdf, ok.data.notes, PL, { title: "BVerfG" });
  assert.equal((await call(c, F.routeAnnotatedPut, "PUT", "/api/teacher/files/" + fid + "/annotated?rev=1", ann, fid)).status, 409);
  const a1 = await call(c, F.routeAnnotatedPut, "PUT", "/api/teacher/files/" + fid + "/annotated?rev=2", ann, fid);
  assert.equal(a1.status, 200);
  assert.deepEqual([a1.data.file.area, a1.data.file.notesOf, a1.data.file.name, a1.data.file.source], ["teacher", fid, "Präsentation mit Anmerkungen – BVerfG.pdf", "anmerkungen"]);
  const a2 = await call(c, F.routeAnnotatedPut, "PUT", "/api/teacher/files/" + fid + "/annotated?rev=2", ann, fid);
  assert.deepEqual(a2.data.removed, [a1.data.file.id], "ersetzt die vorige Fassung");
  const files = () => c.db.raw.prepare("SELECT id, area, notes_of FROM files WHERE lesson_id=? AND notes_of IS NOT NULL").all(l.id);
  assert.equal(files().length, 1);
  // nie für Schüler:innen: nicht in der Schüleransicht, kein Link, nicht verschiebbar, nicht im KI-Kontext/Prompt
  const aid = a2.data.file.id;
  const sv = await scall(c, ST.routeStudentLesson, "GET", "/api/student/lessons/" + l.id, undefined, l.id);
  assert.ok(!sv.data.files.some((f) => f.id === aid));
  assert.equal((await scall(c, ST.routeStudentFileLink, "POST", "/api/student/files/" + aid + "/link", {}, aid)).status, 404);
  const mv = await call(c, F.routeFilePatch, "PATCH", "/api/teacher/files/" + aid, { area: "student" }, aid);
  assert.equal(mv.status, 400); assert.equal(files()[0].area, "teacher");
  const ctx = await L.lessonCtx(c.db, await L.getLesson(c.db, l.id));
  assert.ok(!ctx.materials.some((m) => /Anmerkungen/.test(m.name)), "nicht in den Materialien für KI und Prompts");
  const detail = await call(c, L.routeLessonGet, "GET", "/api/teacher/lessons/" + l.id, undefined, l.id);
  assert.ok(detail.data.files.some((f) => f.id === aid && f.notesOf === fid && f.area === "teacher"), "die Lehrkraft sieht sie unter ihrem Material");
  // Notizen geleert → Anmerkungs-PDF entfernt
  const empty = await call(c, F.routeNotesPut, "PUT", "/api/teacher/files/" + fid + "/notes", { notes: [], rev: 2 }, fid);
  assert.deepEqual([empty.status, empty.data.rev, empty.data.removed], [200, 3, [aid]]);
  assert.equal(files().length, 0); assert.ok(!c.env.FILES.m.has(F.fileKey(l.id, aid)));
  // erneut mit Notizen, dann Präsentation löschen: Anmerkungs-PDF und bereinigte Fassung gehen mit
  await call(c, F.routeNotesPut, "PUT", "/api/teacher/files/" + fid + "/notes", { notes: [{ n: 1, items: ["x"] }], rev: 3 }, fid);
  const a3 = await call(c, F.routeAnnotatedPut, "PUT", "/api/teacher/files/" + fid + "/annotated?rev=4", ann, fid);
  await call(c, F.routeCleanPut, "PUT", "/api/teacher/files/" + fid + "/clean", new Uint8Array([37, 80, 68, 70, 45]), fid);
  assert.ok(c.env.FILES.m.has(F.cleanKey(l.id, fid)));
  assert.equal((await call(c, F.routeFileDelete, "DELETE", "/api/teacher/files/" + fid, undefined, fid)).status, 200);
  assert.equal(c.db.raw.prepare("SELECT COUNT(*) AS n FROM files WHERE lesson_id=?").get(l.id).n, 0);
  assert.ok(!c.env.FILES.m.has(F.fileKey(l.id, a3.data.file.id)) && !c.env.FILES.m.has(F.cleanKey(l.id, fid)));
});

test("Sitzungsdatei trägt die Notizen an der Präsentation (geprüft); ältere Dateien ohne Feld lassen die PDF entscheiden", () => {
  const base = { kind: "unterricks-sitzung", v: 1, source: {}, lesson: {}, chat: [], drafts: [], sheets: [], notes: [] };
  const d = cleanSessionFile({ ...base, files: [{ area: "presentation", kind: "file", name: "P.pdf", path: "dateien/1 - P.pdf", slideNotes: [{ n: 1, items: ["a", "\u0000b"] }, { n: 0, items: ["x"] }] },
    { area: "student", kind: "file", name: "A.pdf", path: "dateien/2 - A.pdf", slideNotes: [{ n: 1, items: ["nein"] }] }, { area: "presentation", kind: "file", name: "Q.pdf", path: "dateien/3 - Q.pdf" }] });
  assert.deepEqual(d.files[0].slideNotes, [{ n: 1, items: ["a", "b"] }]);
  assert.equal(d.files[1].slideNotes, undefined, "nur an der Präsentation");
  assert.equal(d.files[2].slideNotes, undefined, "ohne Feld: die Notizen der PDF gelten");
});
