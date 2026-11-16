// Nachtrag 31b (16.11.2026): wiederverwendete Bildkarten – verweist der Verlaufsplan einer Grundschul-Sitzung auf Bildkarten einer ANDEREN Sitzung desselben
// Kurses, stehen sie auch auf der Druckliste dieser Sitzung (1x, einseitig, farbig; je Sitzung abwählbar und mit eigenen Druckangaben), in allen Druckwegen
// (Sitzung, Druckaufträge der Startseite, get_lesson/save_verlaufsplan); die Druckliste der Sitzung, der sie gehören, bleibt unberührt. Server mit der D1-Nachbildung.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const { fakeCtx } = await import("./fake-d1.mjs");
const GS = await import("../../worker/gs.js");
const L = await import("../../worker/lessons.js");
const F = await import("../../worker/files.js");
const CA = await import("../../worker/cards.js");
const PJ = await import("../../worker/printjobs.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");
const S = await import("../../public/shared.js");

const TOKEN = "lehrkraft-token-123";
const PDF = (pages) => new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Pages /Count " + pages + " >> endobj\n%%EOF");
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
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234", RENDER_GAP_MS: "0", BROWSER: { quickAction: async () => new Response(PDF(3)) } });
  c.now = NOW;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const mcp = async (name, args) => {
    const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
  };
  const course = async (body) => (await call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", { classes: ["a", "b"], weekdays: [], ...body })).data.course;
  const k = await course({ grade: 2, religion: true }), k2 = await course({ grade: 3, religion: true });
  // A: frühere Sitzung mit den Bildkarten „Josef“; B: die Sitzung am Mittwoch, die sie wiederverwendet; X: Bildkarten eines anderen Kurses
  const A = await L.createLesson(c.db, { subject: "gs", klass: k.id, title: "Josef in Ägypten", date: "2026-11-10" }, c.now - 10);
  const B = await L.createLesson(c.db, { subject: "gs", klass: k.id, title: "Josef verzeiht", date: "2026-11-18", startTime: "08:00", durationMin: 45 }, c.now);
  const X = await L.createLesson(c.db, { subject: "gs", klass: k2.id, title: "Arche", date: "2026-11-11" }, c.now - 5);
  const cards = async (lessonId, name) => (await call(c, CA.routeCardsUpload, "POST", "/api/teacher/lessons/" + lessonId + "/cards?name=" + encodeURIComponent(name) + "&share=0", PDF(3), lessonId)).data.file;
  const josef = await cards(A.id, "Josef.pdf"), arche = await cards(X.id, "Arche.pdf"), ownB = await cards(B.id, "Brüder.pdf");
  const plan = async (lessonId, text) => c.db.prepare("UPDATE lessons SET portal=?2 WHERE id=?1").bind(lessonId, text).run();
  await plan(B.id, "**1) Sitzkreis**\n- Lehrkraft erzählt die Geschichte mit den Bildkarten [[pdf:" + josef.id + "]] und [[pdf:" + ownB.id + "]]\n- falsch: [[pdf:" + arche.id + "]]");
  return { c, mcp, k, A, B, X, josef, arche, ownB, plan };
}
const printNext = async (c) => (await call(c, PJ.routePrintNext, "GET", "/api/teacher/print-next")).data;
const sessionOf = (pn, id) => pn.sessions.find((s) => s.id === id);
const put = (c, lessonId, body) => call(c, L.routeCardPrints, "PUT", "/api/teacher/lessons/" + lessonId + "/card-prints", body, lessonId);

test("Bausteine: cardPrintsOf liest nur gültige Einträge, refCardsOf in der Reihenfolge des Verlaufsplans – eigene Bildkarten nicht, abgewählte ohne Druckangaben", () => {
  const a = "a".repeat(16), b = "b".repeat(16), c = "c".repeat(16);
  assert.deepEqual(S.cardPrintsOf(null), {});
  assert.deepEqual(S.cardPrintsOf("kaputt"), {});
  assert.deepEqual(S.cardPrintsOf({ [a]: { copies: 3, duplex: true }, [b]: { off: true }, xyz: { copies: 2 }, [c]: [1] }), { [a]: { copies: 3, duplex: true, color: true }, [b]: { off: true } });
  assert.deepEqual(S.cardPrintsOf(JSON.stringify({ [a]: { copies: 999 } })), { [a]: { copies: 1, duplex: false, color: true } }, "ungültige Anzahl → 1");
  const cards = [{ id: a, lessonId: "L1" }, { id: b, lessonId: "L2" }, { id: c, lessonId: "ME" }];
  const plan = "- [[pdf:" + b + "]] dann [[pdf:" + c + "]] und [[pdf:" + a + "]]\n⏸ Zwischenstopp\n- [[pdf:" + b + "]]";
  const r = S.refCardsOf(plan, cards, "ME", S.cardPrintsOf({ [b]: { off: true }, [a]: { copies: 2 } }));
  assert.deepEqual(r.map((x) => [x.card.id, x.print]), [[b, null], [a, { copies: 2, duplex: false, color: true }]], "Reihenfolge des Plans, eigene (ME) nicht, abgewählt = null");
  assert.deepEqual(S.refCardsOf("- [[pdf:" + a + "]]", cards, "ME", {})[0].print, S.CARD_PRINT, "ohne Eintrag 1x, einseitig, farbig");
  assert.deepEqual(S.refCardsOf("", cards, "ME", {}), []);
});

test("Sitzung (GET): Bildkarten des Kurses aus anderen Sitzungen samt Druckangaben dieser Sitzung – nie die eines anderen Kurses", async () => {
  const { c, B, josef, arche, ownB } = await setup();
  const d = (await call(c, L.routeLessonGet, "GET", "/api/teacher/lessons/" + B.id, undefined, B.id)).data;
  assert.deepEqual(d.courseCards.map((x) => [x.id, x.lessonTitle]), [[josef.id, "Josef in Ägypten"]], "nur Bildkarten desselben Kurses aus anderen Sitzungen");
  assert.ok(!d.courseCards.some((x) => x.id === arche.id || x.id === ownB.id));
  assert.equal(d.courseCards[0].print, undefined, "ohne die Druckangaben der eigenen Sitzung");
  assert.deepEqual(d.cardPrints, {});
  assert.ok(d.refFiles.some((x) => x.id === josef.id), "refFiles wie bisher (Namen im Verlaufsplan)");
  // die Seite rechnet daraus die Druckliste: Josef mit 1x, einseitig, farbig
  assert.deepEqual(S.refCardsOf(d.lesson.portal, d.courseCards, B.id, d.cardPrints).map((x) => [x.card.name, x.print]), [["Josef.pdf", S.CARD_PRINT]]);
});

test("Druckaufträge der Startseite: die wiederverwendeten Bildkarten in der Sitzung, die sie braucht – mit deren Druckangaben und Kurs; abwählbar; höchstens 8 D1-Anweisungen", async () => {
  const { c, A, B, josef, arche, ownB } = await setup();
  c.db.counter.n = 0;
  let pn = await printNext(c);
  assert.ok(c.db.counter.n <= 8, "D1-Anweisungen wie bisher: " + c.db.counter.n);
  let s = sessionOf(pn, B.id);
  assert.deepEqual(s.files.map((f) => [f.id, f.printName]), [[ownB.id, "1x - farbig - einseitig - Reli2 - Brüder.pdf"], [josef.id, "1x - farbig - einseitig - Reli2 - Josef.pdf"]],
    "eigene Bildkarten wie bisher, dahinter die wiederverwendeten – nie die eines anderen Kurses");
  const j = s.files[1];
  assert.deepEqual([j.print, j.refFrom, !!j.cards], [S.CARD_PRINT, { lessonId: A.id }, true]);
  assert.ok(!s.files.some((f) => f.id === arche.id));
  // eigene Druckangaben dieser Sitzung
  let r = await put(c, B.id, { fileId: josef.id, copies: 3, color: false });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.cardPrints, { [josef.id]: { copies: 3, duplex: false, color: false } });
  s = sessionOf(await printNext(c), B.id);
  assert.equal(s.files[1].printName, "3x - sw - einseitig - Reli2 - Josef.pdf");
  // abgewählt: nicht mehr in den Druckaufträgen; wieder aufgenommen: 1x, einseitig, farbig
  r = await put(c, B.id, { fileId: josef.id, off: true });
  assert.deepEqual(r.data.cardPrints, { [josef.id]: { off: true } });
  assert.deepEqual(sessionOf(await printNext(c), B.id).files.map((f) => f.id), [ownB.id]);
  r = await put(c, B.id, { fileId: josef.id, off: false });
  assert.deepEqual(r.data.cardPrints[josef.id], S.CARD_PRINT);
  assert.equal(sessionOf(await printNext(c), B.id).files[1].printName, "1x - farbig - einseitig - Reli2 - Josef.pdf");
  // die Sitzung, der die Bildkarten gehören, bleibt unberührt (eigene Druckangaben, eigene Liste)
  const a = (await call(c, L.routeLessonGet, "GET", "/api/teacher/lessons/" + A.id, undefined, A.id)).data.files.find((f) => f.id === josef.id);
  assert.deepEqual(a.print, S.CARD_PRINT);
  // Verweis aus dem Verlaufsplan entfernt → nicht mehr auf der Liste
  await c.db.prepare("UPDATE lessons SET portal=?2 WHERE id=?1").bind(B.id, "**1) Sitzkreis**\n- Erzählung [[pdf:" + ownB.id + "]]").run();
  assert.deepEqual(sessionOf(await printNext(c), B.id).files.map((f) => f.id), [ownB.id]);
});

test("PUT …/card-prints prüft: nur Bildkarten desselben Kurses aus einer anderen Sitzung, nur Grundschule, gültige Angaben", async () => {
  const { c, B, josef, arche, ownB } = await setup();
  const sek = await L.createLesson(c.db, { subject: "powi", klass: "8B", title: "Wahlen", date: "2026-11-18" }, c.now + 1);
  assert.equal((await put(c, B.id, { fileId: arche.id, off: true })).status, 404, "Bildkarten eines anderen Kurses");
  assert.equal((await put(c, B.id, { fileId: ownB.id, off: true })).status, 404, "eigene Bildkarten: dafür gibt es „Nicht ausdrucken“ der Datei");
  assert.equal((await put(c, B.id, { fileId: "f".repeat(16), off: true })).status, 404);
  assert.equal((await put(c, B.id, { fileId: "kaputt" })).status, 400);
  assert.equal((await put(c, B.id, { fileId: josef.id, copies: 0 })).status, 400);
  assert.equal((await put(c, B.id, { fileId: josef.id, duplex: "ja" })).status, 400);
  assert.equal((await put(c, sek.id, { fileId: josef.id, off: true })).status, 400, "Gymnasium");
  const plain = await c.db.prepare("SELECT id FROM files WHERE lesson_id=?1 AND cards IS NULL").bind(B.id).first();
  if (plain) assert.equal((await put(c, B.id, { fileId: plain.id, off: true })).status, 404, "keine Bildkarten");
});

test("Herunterladen für den Druck: auch wiederverwendete Bildkarten nur mit der PDF ihrer aktuellen Gestaltung – selbst wenn ihre eigene Sitzung sie abgewählt hat", async () => {
  const { c, A, B, mcp, plan } = await setup();
  const id = (await mcp("add_picture_cards", { lesson_id: A.id, titel: "Bildkarten – Mose", html: "<section>1</section><section>2</section><section>3</section>", erzaehltexte: ["a", "b", "c"] })).structuredContent.file_id;
  await plan(B.id, "**1) Sitzkreis**\n- Erzählung [[pdf:" + id + "]]");
  // die eigene Sitzung nimmt sie von ihrer Liste; die Gestaltung ändert sich, die PDF ist noch nicht neu gedruckt
  await call(c, F.routeFilePatch, "PATCH", "/x", { copies: null }, id);
  await c.db.prepare("UPDATE files SET html_at=pdf_at+1000 WHERE id=?1").bind(id).run();
  const r = await call(c, F.routeTeacherFileLink, "POST", "/x", { print: true }, id);
  assert.equal(r.status, 409);
  assert.equal(r.data.code, "cards_not_printed");
  assert.equal((await call(c, F.routeTeacherFileLink, "POST", "/x", {}, id)).status, 200, "ohne print (Ansehen) wie bisher");
});

test("Connector: get_lesson nennt wiederverwendete Bildkarten mit dem Druck-Namen dieser Sitzung bzw. „von der Druckliste genommen“; save_verlaufsplan sagt es", async () => {
  const { c, mcp, B, josef, ownB } = await setup();
  let t = (await mcp("get_lesson", { lesson_id: B.id })).content[0].text;
  assert.ok(t.includes("Dazu verweist der Verlaufsplan auf Bildkarten anderer Sitzungen:\n- „Josef.pdf“ aus einer anderen Sitzung: auch auf der Druckliste dieser Sitzung als „1x - farbig - einseitig - Reli2 - Josef.pdf“."), t.slice(t.indexOf("## Bildkarten"), t.indexOf("## Bildkarten") + 900));
  await put(c, B.id, { fileId: josef.id, off: true });
  t = (await mcp("get_lesson", { lesson_id: B.id })).content[0].text;
  assert.ok(t.includes("- „Josef.pdf“ aus einer anderen Sitzung: die Lehrkraft hat sie für diese Sitzung von der Druckliste genommen."));
  await put(c, B.id, { fileId: josef.id, off: false });
  // ohne eigene Bildkarten: der Abschnitt nennt die wiederverwendeten
  await c.db.prepare("DELETE FROM files WHERE id=?1").bind(ownB.id).run();
  t = (await mcp("get_lesson", { lesson_id: B.id })).content[0].text;
  assert.ok(t.includes("## Bildkarten\nDiese Sitzung hat keine eigenen Bildkarten; der Verlaufsplan verweist auf Bildkarten anderer Sitzungen:\n- „Josef.pdf“ aus einer anderen Sitzung: auch auf der Druckliste dieser Sitzung als „1x - farbig - einseitig - Reli2 - Josef.pdf“."));
  const v = (await call(c, L.routeLessonGet, "GET", "/api/teacher/lessons/" + B.id, undefined, B.id)).data.lesson.portalVersion;
  const r = await mcp("save_verlaufsplan", { lesson_id: B.id, base_version: v, text: "**1) Sitzkreis (10 Min., Plenum)**\n- Lehrkraft erzählt mit den Bildkarten [[pdf:" + josef.id + "]]" });
  assert.ok(!r.isError, JSON.stringify(r).slice(0, 400));
  assert.ok(r.content[0].text.includes("Wiederverwendete Bildkarten „Josef.pdf“ stehen auch auf der Druckliste dieser Sitzung (1x, einseitig, farbig)."), r.content[0].text);
});

test("Kompakte Ansicht (Nachtrag 35): wiederverwendete Bildkarten stehen in Spalte 2 „zum Ausdrucken“ – abgewählte nicht", async () => {
  const IL = await import("../../public/inclasslib.js");
  const own = { id: "a".repeat(16), area: "print", kind: "file", name: "AB.pdf", print: { copies: 22 } };
  const ref = { id: "b".repeat(16), area: "teacher", kind: "file", name: "Josef.pdf", cards: {}, ref: true, refOff: false, print: { ...S.CARD_PRINT } };
  const off = { ...ref, id: "c".repeat(16), name: "Noah.pdf", refOff: true };
  const cols = IL.materialColumns([own], [], { gs: true, refCards: [ref, off] });
  assert.deepEqual(cols.teacher.map((e) => [e.file.name, e.print, e.tags]), [["AB.pdf", true, [IL.PRINT_TAG]], ["Josef.pdf", true, [IL.CARDS_TAG, IL.PRINT_TAG]]]);
  assert.deepEqual(IL.materialColumns([own], [], { gs: false, refCards: [ref] }).teacher.map((e) => e.file.name), ["AB.pdf"], "nur Grundschule");
  // ändern sich die Druckangaben dieser Sitzung, baut die Ansicht die Spalten neu
  const k1 = IL.materialKey(cols);
  const cols2 = IL.materialColumns([own], [], { gs: true, refCards: [{ ...ref, print: { ...S.CARD_PRINT, copies: 2 } }] });
  assert.notEqual(IL.materialKey(cols2), k1);
});
