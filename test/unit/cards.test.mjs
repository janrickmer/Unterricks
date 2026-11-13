// Bildkarten der Grundschule (Slice S7): Hochladen (Freigabe für Eltern zunächst aus), Kartenbilder (slides) mit Stand der PDF, Erzähltexte mit
// rev-Schutz, signierte Bilder, Nachholen, Löschen samt Bildern und der Connector (add_picture_cards, set_picture_card_texts, get_lesson) –
// mit der D1-Nachbildung aus fake-d1.mjs und einem Drucker-Stub (BROWSER.quickAction).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const { fakeCtx } = await import("./fake-d1.mjs");
const GS = await import("../../worker/gs.js");
const L = await import("../../worker/lessons.js");
const F = await import("../../worker/files.js");
const CA = await import("../../worker/cards.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");
const { parentMaterial } = await import("../../public/shared.js");
const P = await import("../../public/gsplanning.js");

const TOKEN = "lehrkraft-token-123";
const PDF = (pages) => new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Pages /Count " + pages + " >> endobj\n%%EOF");
const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const call = async (c, fn, method, path, body, ...args) => {
  const raw = body instanceof Uint8Array;
  const headers = { Authorization: "Bearer " + TOKEN, "Content-Type": raw ? (args.ct || "application/pdf") : "application/json" };
  if (raw) headers["Content-Length"] = String(body.length);
  const req = new Request("https://unterricks.test" + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: res.headers.get("content-type")?.includes("json") ? await res.json() : res }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code, ...(e.extra || {}) } }; }
};
const put = async (c, fn, path, bytes, ct, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method: "PUT", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": ct, "Content-Length": String(bytes.length) }, body: bytes });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code } }; }
};
const mcpOf = async (c) => {
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  return async (name, args) => {
    const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: name ? "tools/call" : "tools/list", params: name ? { name, arguments: args } : {} }) });
    return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
  };
};
async function setup(extraEnv = {}) {
  const c = fakeCtx({ RENDER_GAP_MS: "0", SETTINGS_SECRET: "nur-test-geheimnis-1234", ...extraEnv });
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  const k = (await call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", { grade: 2, classes: ["a", "b"], religion: true, weekdays: [{ day: 2, minutes: 45, time: "08:00" }], classSize: 22 })).data.course;
  const l = await L.createLesson(c.db, { subject: "gs", klass: k.id, title: "Josef und seine Brüder", date: "2026-11-03", startTime: "08:00", durationMin: 45 }, c.now);
  const sek = await L.createLesson(c.db, { subject: "powi", klass: "8B", title: "Gewaltenteilung", date: "2026-11-10" }, c.now + 1);
  return { c, k, l, sek };
}
const uploadCards = (c, lessonId, bytes, q = "name=Josef.pdf&share=0") => call(c, CA.routeCardsUpload, "POST", "/api/teacher/lessons/" + lessonId + "/cards?" + q, bytes, lessonId);
const slide = (c, fid, n) => put(c, F.routeSlideUpload, "/api/teacher/files/" + fid + "/slides/" + n + "?w=1600&h=1131", IMG, "image/jpeg", fid, String(n));

test("Bildkarten hochladen: nur Grundschule, nur PDF; Lehrkraft-Datei mit Freigabe aus, Bilder mit Stand der PDF, überzählige Bilder gelöscht", async () => {
  const { c, l, sek } = await setup();
  let r = await uploadCards(c, sek.id, PDF(3));
  assert.equal(r.status, 400); assert.equal(r.data.error, "Bildkarten gibt es nur in Sitzungen der Grundschule.");
  r = await uploadCards(c, l.id, new TextEncoder().encode("kein pdf"));
  assert.equal(r.status, 400); assert.equal(c.env.FILES.m.size, 0, "keine PDF bleibt nicht liegen");
  r = await uploadCards(c, l.id, PDF(3));
  assert.equal(r.status, 200);
  const f = r.data.file;
  assert.deepEqual([f.area, f.kind, f.mime, f.status, f.source, f.name], ["teacher", "file", "application/pdf", "processing", "upload", "Josef.pdf"]);
  assert.deepEqual(f.cards, { texts: [], share: false, rev: 0, pages: 0, current: false, version: f.createdAt });
  // nachzuholen (auch vor dem ersten Erstellen)
  r = await call(c, CA.routeCardsPending, "GET", "/api/teacher/cards/pending");
  assert.deepEqual(r.data.files, [{ id: f.id, lessonId: l.id, name: "Josef.pdf", version: f.createdAt }]);
  // Kartenbilder (höchstens 40), dann fertig melden
  for (const n of [1, 2, 3, 4]) assert.equal((await slide(c, f.id, n)).status, 200);
  assert.equal((await slide(c, f.id, 41)).status, 400);
  // Bild einer älteren Fassung (Stand v passt nicht mehr) überschreibt nie die Bilder der neueren (Prüfung)
  let sv = await put(c, F.routeSlideUpload, "/api/teacher/files/" + f.id + "/slides/1?w=1600&h=1131&v=" + (f.createdAt - 5), IMG, "image/jpeg", f.id, "1");
  assert.equal(sv.status, 409); assert.equal(sv.data.code, "stale");
  sv = await put(c, F.routeSlideUpload, "/api/teacher/files/" + f.id + "/slides/1?w=1600&h=1131&v=" + f.createdAt, IMG, "image/jpeg", f.id, "1");
  assert.equal(sv.status, 200);
  r = await call(c, CA.routeCardsReady, "POST", "/api/teacher/files/" + f.id + "/cards/ready", { pages: 3, version: f.createdAt + 1 }, f.id);
  assert.equal(r.status, 409); assert.equal(r.data.code, "stale");
  r = await call(c, CA.routeCardsReady, "POST", "/api/teacher/files/" + f.id + "/cards/ready", { pages: 5, version: f.createdAt }, f.id);
  assert.equal(r.status, 400, "es fehlen Bilder");
  r = await call(c, CA.routeCardsReady, "POST", "/api/teacher/files/" + f.id + "/cards/ready", { pages: 3, version: f.createdAt }, f.id);
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.file.status, r.data.file.pages, r.data.file.cards.pages, r.data.file.cards.current], ["ready", 3, 3, true]);
  assert.ok(!c.env.FILES.m.has(F.slideKey(l.id, f.id, 4)) && c.env.FILES.m.has(F.slideKey(l.id, f.id, 3)), "Bild 4 gelöscht");
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM slides WHERE file_id=?1").bind(f.id).first()).n, 3);
  assert.deepEqual((await call(c, CA.routeCardsPending, "GET", "/api/teacher/cards/pending")).data.files, []);
  // eine Präsentation bleibt unverändert: Folienbilder nur für Präsentationen und Bildkarten
  const other = await F.saveDesign(c, l.id, { area: "student", title: "AB", html: "<h1>x</h1>" });
  assert.equal((await slide(c, other.id, 1)).status, 400);
});

test("Erzähltexte und Freigabe: rev schützt vor dem Überschreiben; signierte Bilder; Eltern sehen sie nur freigegeben und aktuell; Löschen samt Bildern", async () => {
  const { c, l } = await setup();
  const f = (await uploadCards(c, l.id, PDF(2), "name=Arche&share=0")).data.file;
  assert.equal(f.name, "Arche.pdf");
  await slide(c, f.id, 1); await slide(c, f.id, 2);
  await call(c, CA.routeCardsReady, "POST", "/x", { pages: 2, version: f.cards.version }, f.id);
  let r = await call(c, CA.routeCardsGet, "GET", "/api/teacher/files/" + f.id + "/cards", undefined, f.id);
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.pages, r.data.w, r.data.h, r.data.texts, r.data.share, r.data.rev, r.data.current], [2, 1600, 1131, [], false, 0, true]);
  assert.ok(r.data.img.base === "/api/card/" + f.id + "/" && /^\?e=\d+&s=/.test(r.data.img.q));
  // Bild über den signierten Link (auch für Eltern), fremde Nummer bzw. kaputte Signatur nicht
  const img = (n, q) => call(c, CA.routeCardImage, "GET", "/api/card/" + f.id + "/" + n + q, undefined, f.id, String(n));
  let im = await img(2, r.data.img.q);
  assert.equal(im.status, 200); assert.equal(im.data.headers.get("content-type"), "image/jpeg");
  assert.equal((await img(3, r.data.img.q)).status, 404);
  assert.equal((await img(1, r.data.img.q.replace(/s=[^&]+/, "s=falsch"))).status, 403);
  // Texte ändern (leere am Ende fallen weg), dann ein veralteter Stand → 409 mit dem aktuellen
  r = await call(c, CA.routeCardsPut, "PUT", "/x", { texts: ["Noah baut eine Arche.", "Die Tiere kommen.", ""], rev: 0 }, f.id);
  assert.equal(r.status, 200); assert.deepEqual(r.data.cards, { texts: ["Noah baut eine Arche.", "Die Tiere kommen."], share: false, rev: 1 });
  r = await call(c, CA.routeCardsPut, "PUT", "/x", { texts: ["alt"], rev: 0 }, f.id);
  assert.equal(r.status, 409); assert.equal(r.data.code, "cards_conflict"); assert.equal(r.data.cards.rev, 1);
  const pm = (file) => parentMaterial("**1)**\n- [[pdf:" + f.id + "]]", [{ ...file, lessonId: l.id }], l.id);
  let lf = (await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.files.find((x) => x.id === f.id);
  assert.deepEqual([pm(lf).cards, pm(lf).hidden], [[], [{ id: f.id, reason: "Eltern dürfen diese Bildkarten nicht sehen" }]]);
  r = await call(c, CA.routeCardsPut, "PUT", "/x", { share: true, rev: 1 }, f.id);
  assert.deepEqual(r.data.cards, { texts: ["Noah baut eine Arche.", "Die Tiere kommen."], share: true, rev: 2 });
  lf = (await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.files.find((x) => x.id === f.id);
  assert.deepEqual(pm(lf).cards, [f.id], "freigegeben und aktuell → Eltern sehen sie");
  // 40 volle Texte in mehrbytiger Schrift passen in eine Anfrage (Prüfung: vorher 120 000 Bytes zu wenig)
  const long = Array.from({ length: 40 }, () => "漢".repeat(1200));
  r = await call(c, CA.routeCardsPut, "PUT", "/x", { texts: long, rev: 2 }, f.id);
  assert.equal(r.status, 200); assert.equal(r.data.cards.texts.length, 40); assert.equal(r.data.cards.rev, 3);
  // nie im Materialbereich der Kinder; Bereich nicht änderbar
  assert.equal((await call(c, F.routeFilePatch, "PATCH", "/x", { area: "student" }, f.id)).status, 400);
  // Löschen entfernt PDF und Bilder
  r = await call(c, F.routeFileDelete, "DELETE", "/x", undefined, f.id);
  assert.equal(r.status, 200);
  assert.equal(c.env.FILES.m.size, 0);
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM slides").first()).n, 0);
});

test("Connector: add_picture_cards (gedruckt, Abweichung, nur Grundschule), set_picture_card_texts, get_lesson „## Bildkarten“", async () => {
  let pages = 3;
  const { c, l, sek } = await setup({ BROWSER: { quickAction: async () => new Response(PDF(pages)) } });
  const mcp = await mcpOf(c);
  const tools = (await mcp(null)).tools;
  const apc = tools.find((t) => t.name === "add_picture_cards"), spt = tools.find((t) => t.name === "set_picture_card_texts");
  assert.ok(apc && apc.description.includes(P.CARD_DESIGN_RULES[0]) && apc.description.includes("Verlagen") && apc.inputSchema.required.includes("erzaehltexte"));
  assert.ok(spt && spt.description.includes("Bilder hochgeladener Karten kannst du nicht sehen"));
  const html = "<style>@page{size:A4 landscape;margin:0}</style><section>1</section><section>2</section><section>3</section>";
  let r = await mcp("add_picture_cards", { lesson_id: l.id, titel: "Bildkarten – Josef", html, erzaehltexte: ["Josef bekommt einen bunten Mantel.", "Die Brüder sind neidisch.", "Josef kommt nach Ägypten."] });
  assert.ok(!r.isError, JSON.stringify(r));
  const id = r.structuredContent.file_id;
  assert.equal(r.content[0].text, "Bildkarten „Bildkarten – Josef.pdf“ gespeichert und gedruckt: 3 Seiten = 3 Karten, 3 Erzähltexte. Verweis: [[pdf:" + id + "]]. Die Bilder für die Elternansicht erstellt Unterricks, sobald die Lehrkraft Unterricks öffnet.");
  let f = await F.getFile(c.db, id);
  assert.deepEqual([f.area, f.status, f.pages, JSON.parse(f.cards).share, JSON.parse(f.cards).rev], ["teacher", "ready", 3, true, 0]);
  // gedruckt, aber noch ohne Bilder → nachzuholen
  assert.deepEqual((await call(c, CA.routeCardsPending, "GET", "/x")).data.files.map((x) => [x.id, x.version]), [[id, f.pdf_at]]);
  // get_lesson: eigener Abschnitt mit den Texten, nicht unter „Gestaltete Materialien“
  let t = (await mcp("get_lesson", { lesson_id: l.id })).content[0].text;
  assert.ok(t.includes("## Bildkarten (eine Seite = eine Karte;") && t.includes("- file_id " + id + ": „Bildkarten – Josef.pdf“ (von dir gestaltet; 3 Karten, Bilder werden erstellt, sobald die Lehrkraft Unterricks öffnet; Eltern sehen sie: ja) → [[pdf:" + id + "]]")
    && t.includes("  2. Die Brüder sind neidisch.") && !t.includes("## Gestaltete Materialien"), t);
  assert.ok(t.includes("(Bildkarten – Eltern sehen sie nach der Stunde; siehe „Bildkarten“)"));
  // Abweichung Seiten ↔ Texte; Gestaltung mit file_id ersetzen (rev zählt weiter)
  pages = 4;
  r = await mcp("add_picture_cards", { lesson_id: l.id, titel: "Bildkarten – Josef", html: html + "<section>4</section>", erzaehltexte: ["a", "b", "c"], file_id: id, fuer_eltern: false });
  assert.ok(!r.isError && r.content[0].text.includes("Achtung: Die PDF hat 4 Seiten, du hast 3 Erzähltexte geschickt – jede Karte muss genau eine Seite sein (break-after: page; overflow: hidden) und genau einen Text haben; bitte mit file_id " + id + " korrigieren.")
    && r.content[0].text.includes("Eltern sehen sie nicht (fuer_eltern: false)."), r.content[0].text);
  f = await F.getFile(c.db, id);
  assert.deepEqual(JSON.parse(f.cards), { v: 1, texts: ["a", "b", "c"], share: false, rev: 1 });
  // set_picture_card_texts: Texte ersetzen, Abweichung zur Zahl der Karten melden
  r = await mcp("set_picture_card_texts", { file_id: id, erzaehltexte: ["1", "2", "3", "4"] });
  assert.ok(!r.isError && r.content[0].text === "Erzähltexte gespeichert: 4 Texte für 4 Karten.", r.content[0].text);
  r = await mcp("set_picture_card_texts", { file_id: id, erzaehltexte: ["1"] });
  assert.ok(r.content[0].text.startsWith("Erzähltexte gespeichert: 1 Text. Achtung: Die Bildkarten haben 4 Karten"), r.content[0].text);
  assert.equal(JSON.parse((await F.getFile(c.db, id)).cards).rev, 3);
  // Abgrenzungen: Gymnasium, andere Materialien, add_material_pdf mit der file_id der Bildkarten
  r = await mcp("add_picture_cards", { lesson_id: sek.id, titel: "x", html, erzaehltexte: ["a"] });
  assert.ok(r.isError && r.content[0].text === "Bildkarten gibt es nur in Sitzungen der Grundschule.");
  r = await mcp("add_material_pdf", { lesson_id: l.id, titel: "x", html: "<h1>x</h1>", file_id: id });
  assert.ok(r.isError && /add_picture_cards/.test(r.content[0].text));
  const ab = (await mcp("add_material_pdf", { lesson_id: l.id, bereich: "schueler", titel: "AB", html: "<h1>x</h1>" })).structuredContent.file_id;
  assert.ok((await mcp("set_picture_card_texts", { file_id: ab, erzaehltexte: ["a"] })).isError);
  assert.ok((await mcp("add_picture_cards", { lesson_id: l.id, titel: "x", html, erzaehltexte: ["a"], file_id: ab })).isError);
  // ohne Drucker: gespeichert, Druck folgt
  delete c.env.BROWSER;
  r = await mcp("add_picture_cards", { lesson_id: l.id, titel: "Arche", html, erzaehltexte: ["x"] });
  assert.ok(!r.isError && r.content[0].text.includes("noch nicht als PDF gedruckt") && r.content[0].text.includes("Die Zahl der Karten prüft Unterricks nach dem Druck"), r.content[0].text);
  // Gymnasium: get_lesson ohne Bildkarten-Abschnitt
  assert.ok(!(await mcp("get_lesson", { lesson_id: sek.id })).content[0].text.includes("Bildkarten"));
});

/* Abschlussprüfung Gruppe B */
test("F00: neu gestaltete Bildkarten sehen Eltern erst mit den neuen Bildern – nie neue Erzähltexte zu alten Bildern (Server, Browser, get_lesson)", async () => {
  const PA = await import("../../worker/parents.js");
  const { c, l } = await setup({ BROWSER: { quickAction: async () => new Response(PDF(3)) } });
  const mcp = await mcpOf(c);
  const html = "<style>@page{size:A4 landscape;margin:0}</style><section>1</section><section>2</section><section>3</section>";
  const id = (await mcp("add_picture_cards", { lesson_id: l.id, titel: "Josef", html, erzaehltexte: ["Alt 1", "Alt 2", "Alt 3"] })).structuredContent.file_id;
  let f = await F.getFile(c.db, id);
  for (const n of [1, 2, 3]) assert.equal((await slide(c, id, n)).status, 200);
  assert.equal((await call(c, CA.routeCardsReady, "POST", "/x", { pages: 3, version: f.pdf_at }, id)).status, 200);
  const lesson = await L.getLesson(c.db, l.id);
  assert.deepEqual((await PA.parentFiles(c, lesson)).cards.map((x) => x.id), [id], "aktuell → Eltern sehen sie");
  assert.ok((await mcp("get_lesson", { lesson_id: l.id })).content[0].text.includes("3 Karten, Bilder bereit"));
  // neu gestaltet, der Drucker ist nicht erreichbar: html_at > pdf_at, die Bilder stammen aus der alten Gestaltung
  delete c.env.BROWSER;
  const r = await mcp("add_picture_cards", { lesson_id: l.id, titel: "Josef", html: html.replace("<section>3</section>", ""), erzaehltexte: ["Neu 1", "Neu 2"], file_id: id });
  assert.ok(!r.isError && r.content[0].text.includes("noch nicht als PDF gedruckt"), r.content[0].text);
  f = await F.getFile(c.db, id);
  assert.ok(f.status === "ready" && f.html_at > f.pdf_at && f.card_img_at === f.pdf_at, "Ausgangslage wie im Befund");
  // Elternansicht (Server): nicht mehr zu sehen
  assert.deepEqual((await PA.parentFiles(c, lesson)).cards, []);
  // Browser der Lehrkraft: fileOut (design.outdated) und refFiles einer anderen Sitzung (htmlAt) – dieselbe Regel
  const plan = "- [[pdf:" + id + "]]";
  const lf = (await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.files.find((x) => x.id === id);
  assert.deepEqual(parentMaterial(plan, [{ ...lf, lessonId: l.id }], l.id).cards, []);
  const later = await L.createLesson(c.db, { subject: "gs", klass: lesson.klass, title: "Josef verzeiht", date: "2026-11-10", startTime: "08:00", durationMin: 45 }, c.now + 5);
  await L.savePortal(c.db, later.id, plan, null, "lehrkraft", c.now);
  const ref = (await call(c, L.routeLessonGet, "GET", "/x", undefined, later.id)).data.refFiles.find((x) => x.id === id);
  assert.ok(ref && ref.htmlAt === f.html_at, "refFiles tragen htmlAt");
  assert.deepEqual(parentMaterial(plan, [ref], later.id).cards, []);
  assert.deepEqual((await PA.parentFiles(c, await L.getLesson(c.db, later.id))).cards, [], "auch als Verweis einer späteren Sitzung nicht");
  // get_lesson: nicht „Bilder bereit“, keine alte Seitenzahl
  const t = (await mcp("get_lesson", { lesson_id: l.id })).content[0].text;
  assert.ok(t.includes("„Josef.pdf“ (von dir gestaltet; neue Gestaltung wartet auf den Druck – bis die neuen Bilder erstellt sind, sehen Eltern die Karten nicht; Eltern sehen sie: ja)") && !t.includes("Bilder bereit"), t);
  assert.ok(t.includes("Eltern sehen nach der Stunde: noch kein Material"), t);
  // hochgeladene Bildkarten (ohne Gestaltung) bleiben sichtbar, solange ihre Bilder aktuell sind
  const up = (await uploadCards(c, l.id, PDF(2), "name=Arche&share=1")).data.file;
  await slide(c, up.id, 1); await slide(c, up.id, 2);
  await call(c, CA.routeCardsReady, "POST", "/x", { pages: 2, version: up.cards.version }, up.id);
  assert.deepEqual((await PA.parentFiles(c, lesson)).cards.map((x) => x.id), [up.id]);
});

test("F23: add_picture_cards mit der file_id hochgeladener Bildkarten – klare Auskunft statt „kein gestaltetes Material“; Beschreibung nennt set_picture_card_texts", async () => {
  const { c, l } = await setup();
  const mcp = await mcpOf(c);
  const up = (await uploadCards(c, l.id, PDF(2), "name=Verlag&share=0")).data.file;
  const r = await mcp("add_picture_cards", { lesson_id: l.id, titel: "Eigene Karten", html: "<section>1</section>", erzaehltexte: ["a"], file_id: up.id });
  assert.ok(r.isError && r.content[0].text.startsWith("Diese Bildkarten hat die Lehrkraft hochgeladen – ihre Gestaltung lässt sich nicht ersetzen.") && r.content[0].text.includes("set_picture_card_texts"), r.content[0].text);
  assert.equal((await F.getFile(c.db, up.id)).cards, JSON.stringify({ v: 1, texts: [], share: false, rev: 0 }), "nichts geändert");
  const apc = (await mcp(null)).tools.find((t) => t.name === "add_picture_cards");
  assert.ok(apc.description.includes("Bildkarten, die die Lehrkraft hochgeladen hat, lassen sich nicht neu gestalten – ihre Erzähltexte änderst du mit set_picture_card_texts"));
  const t = (await mcp("get_lesson", { lesson_id: l.id })).content[0].text;
  assert.ok(t.includes("hochgeladene Karten lassen sich nicht neu gestalten") && t.includes("die Gestaltung nicht ersetzen"), t);
});
