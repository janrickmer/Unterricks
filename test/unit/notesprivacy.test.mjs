// Datenschutzprüfung zu Nachtrag 20: Notizen der Lehrkraft erreichen Schüler:innen nie – auch nicht, wenn die KI sie entgegen dem Prompt nicht als
// Dateianhang, sondern als Anmerkungen, XMP-Metadaten, Dokumenteigenschaften oder eigene Seiteneinträge in die PDF schreibt, und auch nicht über
// einen Link auf eine spätere Folie in der gekürzten Fassung („Bis hier gezeigt“). Dazu alle Wege, auf denen Präsentation, Folien und Dateien an
// Schüler:innen, Eltern, die Druckliste oder eine andere Sitzung gehen. Gesucht wird in den Bytes, in entpackten Streams und in Hex-Zeichenketten.
// Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript," + encodeURIComponent("export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"), shortCircuit: true } : n(s, c); }'));
const PL = await import("pdf-lib");
const { PDFDocument, StandardFonts, PDFName, PDFString, PDFHexString, PDFDict, PDFArray, PDFRef } = PL;
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const { cleanPdfBytes, cutPdfBytes, pdfCarriers } = await import("../../public/pdfcut.js");
const { annotatedPdfBytes, scanPdfNotes } = await import("../../public/pdfnotes.js");
const S = await import("../../public/shared.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const F = await import("../../worker/files.js");
const L = await import("../../worker/lessons.js");
const ST = await import("../../worker/student.js");
const PA = await import("../../worker/parents.js");
const GS = await import("../../worker/gs.js");
const SUB = await import("../../worker/substitute.js");
const { PRINT_FILES_SQL } = await import("../../worker/printjobs.js");
const { sha256Hex } = await import("../../worker/lib.js");

const te = new TextEncoder();
const LEAK = /LEAK[A-Z0-9]+|MUSTERLOESUNG\d/g;
// alle Bytes, entpackte Streams und PDF-Zeichenketten in Hex-Form (<FEFF…> als UTF-16, sonst Latin-1) als Text
function allText(bytes) {
  const raw = Buffer.from(bytes), parts = [raw.toString("latin1")];
  for (let i = 0; ;) {
    const s = raw.indexOf("stream", i); if (s < 0) break;
    let a = s + 6; if (raw[a] === 13) a++; if (raw[a] === 10) a++;
    const e = raw.indexOf("endstream", a); if (e < 0) break;
    try { parts.push(inflateSync(raw.subarray(a, e)).toString("latin1")); } catch {}
    i = e + 9;
  }
  const hex = [];
  for (const p of parts) for (const m of p.matchAll(/<([0-9A-Fa-f\s]{4,})>/g)) {
    const b = Buffer.from(m[1].replace(/\s+/g, ""), "hex");
    hex.push(b[0] === 0xfe && b[1] === 0xff ? new TextDecoder("utf-16be").decode(b.subarray(2)) : b.toString("latin1"));
  }
  return parts.concat(hex).join("\n");
}
const leaks = (bytes) => [...new Set(allText(bytes).match(LEAK) || [])];
async function deck(fn, pages = 3) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) d.addPage([960, 540]).drawText("Folie " + i, { x: 50, y: 270, size: 40, font: f });
  await fn(d, f);
  return d.save();
}
const annot = (d, page, o) => { const ctx = d.context, ref = ctx.register(ctx.obj({ Type: "Annot", Rect: [10, 10, 30, 30], ...o })); const pg = d.getPage(page).node;
  const cur = pg.lookupMaybe(PDFName.of("Annots"), PDFArray); if (cur) cur.push(ref); else pg.set(PDFName.of("Annots"), ctx.obj([ref])); return ref; };
const xmpOf = (inner) => '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/">' + inner + "</rdf:Description></rdf:RDF></x:xmpmeta>";
const setXmp = (d, xml, flate = true) => d.catalog.set(PDFName.of("Metadata"), d.context.register(flate ? d.context.flateStream(te.encode(xml), { Type: "Metadata", Subtype: "XML" }) : d.context.stream(te.encode(xml), { Type: "Metadata", Subtype: "XML" })));
const scan = async (bytes, withLib = true) => {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 }).promise;
  try { return await scanPdfNotes(doc, withLib ? { bytes, lib: PL } : {}); } finally { await doc.destroy(); }
};

// Wo die KI Notizen statt im Anhang ablegen könnte – jeweils ohne unterricks-notizen.json
const CARRIERS = {
  "Kommentar (Text)": (d) => annot(d, 0, { Subtype: "Text", Contents: PDFString.of("LEAKTEXT") }),
  "Rechteck mit Kommentar": (d) => annot(d, 1, { Subtype: "Square", Contents: PDFString.of("LEAKSQUARE") }),
  "Freitext": (d) => annot(d, 0, { Subtype: "FreeText", DA: PDFString.of("/Helv 12 Tf"), Contents: PDFString.of("LEAKFREE") }),
  "Hervorhebung": (d) => annot(d, 2, { Subtype: "Highlight", QuadPoints: [10, 30, 30, 30, 10, 10, 30, 10], Contents: PDFHexString.fromText("LEAKHIGHLIGHT") }),
  "Kommentar ohne Seite": (d) => d.context.register(d.context.obj({ Type: "Annot", Subtype: "Text", Rect: [0, 0, 1, 1], Contents: PDFString.of("LEAKORPHAN") })),
  "XMP-Metadaten": (d) => setXmp(d, xmpOf('<dc:description><rdf:Alt><rdf:li xml:lang="x-default">LEAKXMP Notizen zu Folie 1: Impuls geben</rdf:li></rdf:Alt></dc:description>')),
  "XMP mit viel Text": (d) => setXmp(d, xmpOf("<dc:description><rdf:Alt><rdf:li>LEAKXMPLONG " + "Erwartung Machtmissbrauch Zeit fuenf Minuten ".repeat(40) + "</rdf:li></rdf:Alt></dc:description>"), false),
  "Betreff": (d) => d.setSubject("Notizen: LEAKSUBJECT Impuls"),
  "Stichwörter (viel Text)": (d) => d.setKeywords(["LEAKKEYWORDS " + "Impuls Erwartung ".repeat(30)]),
  "eigene Dokumenteigenschaft": (d) => d.getInfoDict().set(PDFName.of("Folien"), PDFHexString.fromText("LEAKCUSTOM")),
  "eigener Seiteneintrag": (d) => d.getPage(1).node.set(PDFName.of("UnterricksNotizen"), PDFHexString.fromText("LEAKPAGEKEY")),
  "Seiten-PieceInfo": (d) => d.getPage(0).node.set(PDFName.of("PieceInfo"), d.context.obj({ Claude: { Private: PDFHexString.fromText("LEAKPIECE"), LastModified: PDFString.of("D:2026") } })),
  "Seiten-XMP": (d) => d.getPage(0).node.set(PDFName.of("Metadata"), d.context.register(d.context.flateStream(te.encode("<x>LEAKPAGEXMP</x>"), { Type: "Metadata", Subtype: "XML" }))),
  "Anhang nur über /AF": (d) => { const ctx = d.context, ef = ctx.register(ctx.flateStream(te.encode('{"folien":[{"folie":1,"notizen":["LEAKAFONLY"]}]}'), { Type: "EmbeddedFile" }));
    d.catalog.set(PDFName.of("AF"), ctx.obj([ctx.register(ctx.obj({ Type: "Filespec", F: PDFString.of("unterricks-notizen.json"), EF: { F: ef }, AFRelationship: "Supplement" }))])); },
};

test("Notizen außerhalb des Anhangs: jede Fundstelle verlangt die bereinigte Fassung, und weder sie noch die gekürzte enthält den Text", async () => {
  for (const [what, add] of Object.entries(CARRIERS)) {
    const pdf = await deck(add);
    assert.ok(leaks(pdf).length > 0, what + ": die Testdatei trägt den Text wirklich");
    const s = await scan(pdf);
    assert.equal(s.needsClean, true, what + ": bereinigte Fassung nötig");
    assert.equal(s.raw, null, what + ": keine Notizen für die Präsentationsansicht (sie kamen nicht als Anhang)");
    assert.deepEqual(leaks(await cleanPdfBytes(pdf, PL)), [], what + ": Fassung für Schüler:innen");
    assert.deepEqual(leaks(await cutPdfBytes(pdf, 2, PDFDocument, { clean: true, lib: PL })), [], what + ": gekürzte Fassung");
    assert.equal((await PDFDocument.load(await cleanPdfBytes(pdf, PL))).getPageCount(), 3, what + ": alle Folien");
  }
  // Anmerkungen erkennt schon PDF.js allein (ohne pdf-lib, z. B. wenn es nicht lädt)
  for (const what of ["Rechteck mit Kommentar", "Freitext", "Hervorhebung"]) assert.equal((await scan(await deck(CARRIERS[what]), false)).needsClean, true, what + " (nur PDF.js)");
});

test("gewöhnliche Präsentation (PowerPoint-ähnlich: XMP, Titel, Autor, Link, gängige Seiteneinträge): keine bereinigte Fassung – wie bisher", async () => {
  const pdf = await deck((d) => {
    d.setTitle("Gewaltenteilung"); d.setAuthor("Muster"); d.setCreator("Microsoft® PowerPoint® für Microsoft 365"); d.setProducer("Microsoft® PowerPoint® für Microsoft 365");
    setXmp(d, xmpOf('<pdf:Producer>Microsoft® PowerPoint® für Microsoft 365</pdf:Producer><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Gewaltenteilung</rdf:li></rdf:Alt></dc:title>'), false);
    annot(d, 0, { Subtype: "Link", Border: [0, 0, 0], A: { S: "URI", URI: PDFString.of("https://example.org/") } });
    for (const p of d.getPages()) { p.node.set(PDFName.of("StructParents"), d.context.obj(0)); p.node.set(PDFName.of("Tabs"), PDFName.of("S")); }
  });
  const s = await scan(pdf);
  assert.deepEqual([s.needsClean, s.carriers], [false, undefined]);
  assert.deepEqual(pdfCarriers(await PDFDocument.load(pdf), PL), []);
});

test("„Bis hier gezeigt“: ein Link auf eine spätere Folie bringt deren Seite nicht mit (weder Inhalt noch Notizen); Links innerhalb zeigen auf die Kopie", async () => {
  const pdf = await deck(async (d, f) => {
    await d.attach(te.encode('{"v":1,"folien":[{"folie":4,"notizen":["LEAKATT"]}]}'), S.NOTES_FILE, { mimeType: "application/json" });
    d.getPage(3).drawText("MUSTERLOESUNG4", { x: 50, y: 100, size: 30, font: f });
    annot(d, 3, { Subtype: "Text", Contents: PDFString.of("LEAKNOTE4") });
    d.getPage(3).node.set(PDFName.of("AF"), d.context.obj([]));
    annot(d, 0, { Subtype: "Link", Dest: [d.getPage(3).ref, PDFName.of("Fit")] });                       // Inhaltsverzeichnis → Folie 4
    annot(d, 0, { Subtype: "Link", A: { S: "GoTo", D: [d.getPage(1).ref, PDFName.of("Fit")] } });         // → Folie 2
    annot(d, 0, { Subtype: "Link", P: d.getPage(3).ref, A: { S: "URI", URI: PDFString.of("https://example.org/") } });
  }, 4);
  assert.ok(leaks(pdf).includes("LEAKNOTE4") && leaks(pdf).includes("MUSTERLOESUNG4"));
  const pageObjs = (doc) => [...doc.context.enumerateIndirectObjects()].filter(([, o]) => o instanceof PDFDict && o.get(PDFName.of("Type")) === PDFName.of("Page")).length;
  for (const clean of [true, false]) {
    const cut = await cutPdfBytes(pdf, 2, PDFDocument, { clean, lib: PL }), doc = await PDFDocument.load(cut);
    assert.deepEqual(leaks(cut), [], "gekürzt " + (clean ? "und bereinigt" : "(ältere Präsentation)") + ": nichts von Folie 4");
    assert.equal(pageObjs(doc), 2, "genau zwei Seiten in der Datei – keine verwaiste Kopie");
    const links = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).asArray().map((r) => doc.context.lookup(r, PDFDict));
    assert.equal(doc.context.lookup(links[0].lookup(PDFName.of("Dest"), PDFArray).get(0)), PL.PDFNull, "Link auf Folie 4 führt ins Leere");
    assert.equal(links[1].lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("D"), PDFArray).get(0), doc.getPage(1).ref, "Link auf Folie 2 zeigt auf die Kopie");
  }
  // vollständig bereinigt und Anmerkungs-PDF (Lehrkraft): Links auf die eigenen Folien, keine doppelten Seiten
  const full = await PDFDocument.load(await cleanPdfBytes(pdf, PL));
  assert.equal(pageObjs(full), 4);
  const l0 = full.context.lookup(full.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).get(0), PDFDict);
  assert.equal(l0.lookup(PDFName.of("Dest"), PDFArray).get(0), full.getPage(3).ref);
  const ann = await PDFDocument.load(await annotatedPdfBytes(pdf, [{ n: 4, items: ["x"] }], PL));
  assert.equal(pageObjs(ann), 8, "4 Folien + 4 Anmerkungsfolien");
  // PDF.js liest die Kopie (Link auf Folie 2 = Seite 2)
  const pj = await pdfjs.getDocument({ data: await cutPdfBytes(pdf, 2, PDFDocument, { clean: true, lib: PL }), isEvalSupported: false, verbosity: 0 }).promise;
  const a = (await (await pj.getPage(1)).getAnnotations()).find((x) => Array.isArray(x.dest) && x.dest[0] && x.dest[0].num !== undefined && x.dest[0].num !== null && !x.url);
  assert.ok(a);
  await pj.destroy();
});

test("ausgeblendete Ebenen bleiben in der bereinigten und der gekürzten Fassung ausgeblendet (sonst stünde verborgener Inhalt auf Folie und Beamer)", async () => {
  const pdf = await deck(async (d) => {
    const ctx = d.context, ocg = ctx.register(ctx.obj({ Type: "OCG", Name: PDFString.of("Verborgen") }));
    d.catalog.set(PDFName.of("OCProperties"), ctx.obj({ OCGs: [ocg], D: { Order: [ocg], OFF: [ocg] } }));
    await d.attach(te.encode("{}"), S.NOTES_FILE, {});
    const p = d.getPage(0);
    p.node.Resources().set(PDFName.of("Properties"), ctx.obj({ oc1: ocg }));
    p.pushOperators(PL.pushGraphicsState(), PL.PDFOperator.of("BDC", [PDFName.of("OC"), PDFName.of("oc1")]), PL.PDFOperator.of("EMC"), PL.popGraphicsState());
  });
  for (const out of [await cleanPdfBytes(pdf, PL), await cutPdfBytes(pdf, 2, PDFDocument, { clean: true, lib: PL })]) {
    const doc = await pdfjs.getDocument({ data: out, isEvalSupported: false, verbosity: 0 }).promise;
    const cfg = await doc.getOptionalContentConfig(), groups = [...cfg];
    assert.equal(groups.length, 1); assert.equal(groups[0][1].visible, false, "die Ebene bleibt aus");
    await doc.destroy();
  }
});

test("Durchsicht scheitert (Anhänge oder Anmerkungen nicht lesbar): lieber bereinigen", async () => {
  const doc = { numPages: 1, getAttachments: async () => { throw new Error("kaputt"); }, getPage: async () => ({ getAnnotations: async () => [] }) };
  assert.equal((await scanPdfNotes(doc)).needsClean, true);
  const doc2 = { numPages: 1, getAttachments: async () => null, getPage: async () => ({ getAnnotations: async () => { throw new Error("kaputt"); } }) };
  assert.equal((await scanPdfNotes(doc2)).needsClean, true);
  const ok = { numPages: 1, getAttachments: async () => null, getPage: async () => ({ getAnnotations: async () => [{ subtype: "Link" }] }) };
  assert.equal((await scanPdfNotes(ok)).needsClean, false);
});

/* ---------- Worker: alle Wege an Schüler:innen, Eltern, Druckliste und andere Sitzungen ---------- */
const TOKEN = "lehrkraft-token-123", STOKEN = "schueler-token-123", DEV = "dddddddddddddddd", SECRET = "GEHEIMNOTIZ Impuls zur Gewaltenteilung";
const callAs = (tok) => async (c, fn, method, path, body, ...args) => {
  const raw = body instanceof Uint8Array;
  const headers = { Authorization: "Bearer " + tok, "Content-Type": raw ? (/\/slides\//.test(path) ? "image/jpeg" : "application/pdf") : "application/json" };
  if (raw) headers["Content-Length"] = String(body.length);
  const req = new Request("https://unterricks.test" + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: res.headers.get("content-type")?.includes("json") ? await res.json() : res }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code, ...(e.extra || {}) } }; }
};
const call = callAs(TOKEN), scall = callAs(STOKEN);
async function presentation(c, l, notesPdf) {
  const up = await call(c, F.routePresentationUpload, "POST", "/api/teacher/lessons/" + l.id + "/presentation?name=BVerfG.pdf", notesPdf, l.id);
  const fid = up.data.file.id;
  for (let n = 1; n <= 3; n++) await call(c, F.routeSlideUpload, "PUT", "/api/teacher/files/" + fid + "/slides/" + n + "?w=1920&h=1080", new Uint8Array([0xff, 0xd8, n]), fid, String(n));
  const notes = { v: 1, folien: [{ folie: 1, notizen: [SECRET] }] };
  const r = await call(c, F.routePresentationReady, "POST", "/api/teacher/files/" + fid + "/ready", { pages: 3, codeSlides: [], notes, clean: true }, fid);
  assert.equal(r.status, 200);
  await call(c, F.routeCleanPut, "PUT", "/api/teacher/files/" + fid + "/clean", await cleanPdfBytes(notesPdf, PL), fid);
  const ann = await call(c, F.routeAnnotatedPut, "PUT", "/api/teacher/files/" + fid + "/annotated?rev=1", await annotatedPdfBytes(notesPdf, S.cleanSlideNotes(notes, 3), PL), fid);
  assert.equal(ann.status, 200);
  return { fid, aid: ann.data.file.id };
}
const hasSecret = (x) => JSON.stringify(x).includes("GEHEIMNOTIZ");

test("Worker: Präsentation mit Notizen – Schüleransicht, Folienfenster, Download (ganz und gekürzt), erratene Kennung, Eltern, Druckliste, Vertretung", async () => {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  const day = new Date(c.now - 2 * 864e5).toISOString().slice(0, 10);
  const l = await L.createLesson(c.db, { subject: "powi", klass: "Q2-GK", title: "Gewaltenteilung", date: day, startTime: "08:00", durationMin: 90 }, c.now - 864e5);
  c.db.raw.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, 'Q2-GK', 'powi', ?, ?, ?)").run(DEV, await sha256Hex(STOKEN), c.now, c.now, c.now + 3600e3);
  c.db.raw.prepare("INSERT INTO student_access(device_id, lesson_id, joined_at) VALUES(?, ?, ?)").run(DEV, l.id, c.now - 600e3);
  const notesPdf = await deck(async (d) => {
    await d.attach(te.encode(JSON.stringify({ v: 1, folien: [{ folie: 1, notizen: [SECRET] }] })), S.NOTES_FILE, { mimeType: "application/json" });
    annot(d, 2, { Subtype: "Text", Contents: PDFString.of("GEHEIMNOTIZ Folie 3") });
    annot(d, 0, { Subtype: "Link", Dest: [d.getPage(2).ref, PDFName.of("Fit")] });
  });
  assert.ok(allText(notesPdf).includes("GEHEIMNOTIZ"));
  const { fid, aid } = await presentation(c, l, notesPdf);
  const fetchDl = async (url) => new Uint8Array(await (await F.routeDownload({ ...c, request: new Request("https://unterricks.test" + url) }, url.split("/")[3].split("?")[0])).arrayBuffer());
  // Schüleransicht und Folienfenster (Nachtrag 19): nur Zahlen/Links, keine Notizen, keine Anmerkungs-PDF
  const sv = await scall(c, ST.routeStudentLesson, "GET", "/api/student/lessons/" + l.id, undefined, l.id);
  assert.equal(sv.status, 200); assert.ok(!hasSecret(sv.data) && !sv.data.files.some((f) => f.id === aid || /Anmerkungen/.test(f.name)));
  const sl = await scall(c, ST.routeStudentPresentationSlides, "POST", "/x", { from: 1, to: 3 }, l.id);
  assert.equal(sl.status, 200); assert.ok(!hasSecret(sl.data) && !JSON.stringify(sl.data).includes("notes"));
  // Download ganz: nur die bereinigte Fassung
  const pl = await scall(c, ST.routeStudentPresentationLink, "POST", "/x", { inline: false }, l.id);
  assert.match(pl.data.url, /&p=clean&/);
  assert.ok(!allText(await fetchDl(pl.data.url)).includes("GEHEIMNOTIZ"));
  // gekürzt bis Folie 2 (Link auf Folie 3 mit ihrem Kommentar): auch dort nichts
  const cut = await cutPdfBytes(notesPdf, 2, PDFDocument, { clean: true, lib: PL });
  assert.equal((await call(c, F.routeShownPut, "PUT", "/api/teacher/files/" + fid + "/shown?until=2&clean=1", cut, fid)).status, 200);
  const pl2 = await scall(c, ST.routeStudentPresentationLink, "POST", "/x", { inline: true }, l.id);
  assert.match(pl2.data.url, /&p=cut&/);
  assert.ok(!allText(await fetchDl(pl2.data.url)).includes("GEHEIMNOTIZ"));
  const sl2 = await scall(c, ST.routeStudentPresentationSlides, "POST", "/x", { from: 3 }, l.id);
  assert.equal(sl2.status, 403, "Folienfenster: nichts jenseits der markierten Folie");
  // erratene Kennung der Anmerkungs-PDF bzw. der Präsentation: kein Link für Schüler:innen, ohne gültige Signatur kein Download
  for (const id of [aid, fid]) assert.equal((await scall(c, ST.routeStudentFileLink, "POST", "/api/student/files/" + id + "/link", {}, id)).status, 404);
  for (const p of ["", "&p=clean", "&p=cut"]) await assert.rejects(F.routeDownload({ ...c, request: new Request("https://unterricks.test/api/dl/" + aid + "?d=a" + p + "&e=" + (c.now + 6e5) + "&s=AAAA") }, aid), (e) => e.status === 403);
  assert.equal((await scall(c, F.routeTeacherFileLink, "POST", "/x", {}, aid)).status, 401, "Lehrkraft-Link nur angemeldet");
  // Druckliste: weder Anmerkungs-PDF noch Präsentation
  const pr = c.db.raw.prepare(PRINT_FILES_SQL.replace(/\?1/g, "'" + day + "'")).all();
  assert.ok(!pr.some((f) => f.id === aid || f.id === fid));
  // Eltern (Grundschule): eine Präsentation mit Anmerkungs-PDF in einer GS-Sitzung, im Verlaufsplan sogar verlinkt – Eltern sehen keine von beiden
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/x", { grade: 2, classes: ["a"], religion: true, weekdays: [{ day: 2, minutes: 45, time: "08:00" }], classSize: 22 })).data.course;
  const gl = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Josef", date: day, startTime: "08:00", durationMin: 45 }, c.now - 864e5);
  const g = await presentation(c, gl, notesPdf);
  c.db.raw.prepare("UPDATE lessons SET portal=? WHERE id=?").run("1. Einstieg [[pdf:" + g.aid + "|Anmerkungen]] [[pdf:" + g.fid + "|Präsentation]]", gl.id);
  const pf = await PA.parentFiles(c, await L.getLesson(c.db, gl.id));
  assert.deepEqual([pf.files.length, pf.cards.length], [0, 0]);
  // Vertretung: archiviert (nie bei Schüler:innen), beim Übernehmen in eine andere Sitzung nicht kopiert, beim Wiederherstellen wieder „nur Lehrkraft“
  c.db.raw.prepare("UPDATE files SET area='archive' WHERE id=?").run(aid);
  c.db.raw.prepare("INSERT INTO substitutes(lesson_id, status, proposal, archive, created_at, updated_at) VALUES(?, 'aktiv', '{}', ?, ?, ?)").run(l.id, JSON.stringify({ files: [{ id: aid, area: "teacher" }] }), c.now, c.now);
  const sv2 = await scall(c, ST.routeStudentLesson, "GET", "/api/student/lessons/" + l.id, undefined, l.id);
  assert.ok(!sv2.data.files.some((f) => f.id === aid));
  const t = await L.createLesson(c.db, { subject: "powi", klass: "Q2-GK", title: "Ziel", date: day }, c.now);
  const tr = await call(c, SUB.routeSubstituteTransfer, "POST", "/x", { targetLessonId: t.id, portal: false }, l.id);
  assert.deepEqual([tr.status, tr.data.copied], [200, 0]);
  assert.equal(c.db.raw.prepare("SELECT COUNT(*) AS n FROM files WHERE lesson_id=?").get(t.id).n, 0);
  assert.equal((await call(c, SUB.routeSubstituteRestore, "POST", "/x", {}, l.id)).status, 200);
  assert.equal(c.db.raw.prepare("SELECT area FROM files WHERE id=?").get(aid).area, "teacher");
});
