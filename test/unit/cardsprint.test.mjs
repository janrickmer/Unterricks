// Nachtrag 31 (16.11.2026): Bildkarten der Grundschule gehören immer zu den Dateien, die die Lehrkraft für die Sitzung ausdruckt – 1x, einseitig, farbig
// („1x - farbig - einseitig - <Kurs> - <Titel>.pdf“, Nachtrag 32), abwählbar, nur neue Bildkarten (keine Nachrüstung); Claude gestaltet zu jeder Geschichte im Sitzkreis Bildkarten,
// Prompt und Rückmeldungen erinnern daran. Server mit der D1-Nachbildung (fake-d1.mjs), Oberfläche im Browser-Ersatz (fake-dom.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { createHash } from "node:crypto";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "/vendor/pdf-lib.esm.min.js" ? n("pdf-lib", c) : n(s, c); }'));
const D = installDom({ hash: "#/lk" });
const { fakeCtx } = await import("./fake-d1.mjs");
const GS = await import("../../worker/gs.js");
const L = await import("../../worker/lessons.js");
const F = await import("../../worker/files.js");
const CA = await import("../../worker/cards.js");
const PA = await import("../../worker/parents.js");
const { PRINT_FILES_SQL } = await import("../../worker/printjobs.js");
const { routeMcp, cardsSection } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");
const S = await import("../../public/shared.js");
const P = await import("../../public/planning.js");
const G = await import("../../public/gsplanning.js");
const DR = await import("../../public/designrender.js");
const PN = await import("../../public/printnext.js");
const SL = await import("../../public/selbstlern.js");
const FX = await import("./stop-fixtures.mjs");

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
async function setup() {
  const c = fakeCtx({ RENDER_GAP_MS: "0", SETTINGS_SECRET: "nur-test-geheimnis-1234", BROWSER: { quickAction: async () => new Response(PDF(pages.n)) } });
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const k = (await call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", { grade: 2, classes: ["a", "b"], religion: true, weekdays: [{ day: 2, minutes: 45, time: "08:00" }], classSize: 22 })).data.course;
  const l = await L.createLesson(c.db, { subject: "gs", klass: k.id, title: "Josef in Ägypten", date: "2026-11-24", startTime: "08:00", durationMin: 45 }, c.now);
  const sek = await L.createLesson(c.db, { subject: "powi", klass: "8B", title: "Gewaltenteilung", date: "2026-11-24" }, c.now + 1);
  const mcp = async (name, args) => {
    const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: name ? "tools/call" : name === null ? "tools/list" : "initialize",
      params: name ? { name, arguments: args } : name === null ? {} : { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
    return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
  };
  return { c, k, l, sek, mcp };
}
const pages = { n: 3 };
const upload = (c, lessonId, name = "Josef.pdf") => call(c, CA.routeCardsUpload, "POST", "/api/teacher/lessons/" + lessonId + "/cards?name=" + encodeURIComponent(name) + "&share=0", PDF(2), lessonId);
const patch = (c, id, body) => call(c, F.routeFilePatch, "PATCH", "/x", body, id);
const HTML = "<style>@page{size:A4 landscape;margin:0}</style><section>1</section><section>2</section><section>3</section>";
const TEXTS = ["Josef kommt nach Ägypten.", "Josef deutet die Träume.", "Josef verzeiht."];

/* ---------- reine Bausteine ---------- */
test("CARD_PRINT und der Name auf der Druckliste: 1x, einseitig, farbig – „1x - farbig - einseitig - <Kurs> - <Titel>.pdf“ (Nachtrag 32: geänderte Erwartung, vorher „1x - farbig - einseitig - Reli2 - <Titel>.pdf“)", () => {
  assert.deepEqual(S.CARD_PRINT, { copies: 1, duplex: false, color: true });
  assert.equal(S.printFileName({ name: "Bildkarten – Josef.pdf", ...S.CARD_PRINT, course: "Reli2" }), "1x - farbig - einseitig - Reli2 - Bildkarten – Josef.pdf");
  assert.equal(G.CARD_PRINT_NAME, "1x - farbig - einseitig - <Kurs> - <Titel>.pdf");
  assert.equal(G.CARD_PRINT_TEXT, "1x, einseitig, farbig");
});

test("printReady / cardsPrintState: Bildkarten erst mit der PDF ihrer aktuellen Gestaltung; hochgeladene sofort; anderes Material wie bisher", () => {
  const des = (o) => ({ outdated: false, error: null, htmlAt: 2, pdfAt: 3, text: "", ...o });
  const cards = { texts: [], share: true, rev: 0, pages: 3, current: true, version: 3 };
  // anderes Material: unverändert (gestaltet erst mit gedruckter PDF; eine ältere PDF zählt weiter als fertig)
  assert.equal(S.printReady({ status: "ready" }), true);
  assert.equal(S.printReady({ status: "pending", design: des({ outdated: true, pdfAt: null }) }), false);
  assert.equal(S.printReady({ status: "ready", design: des({ outdated: true }) }), true, "Material: bisherige PDF gilt (wie vorher)");
  // Bildkarten
  assert.equal(S.printReady({ status: "processing", cards }), true, "hochgeladen: die PDF liegt schon (die Kartenbilder entstehen noch)");
  assert.equal(S.printReady({ status: "pending", cards, design: des({ outdated: true, pdfAt: null }) }), false);
  assert.equal(S.printReady({ status: "ready", cards, design: des({ outdated: true }) }), false, "neu gestaltet: die bisherige PDF zeigt alte Karten");
  assert.equal(S.printReady({ status: "ready", cards, design: des() }), true);
  assert.equal(PN.readyForAll, S.printReady, "„Alle Dateien herunterladen“ nimmt dieselbe Regel");
  // Stand in der Druckliste
  const neu = DR.cardsPrintState({ status: "ready", cards, design: des({ outdated: true }) });
  assert.deepEqual([neu.need, neu.ok, neu.text], [true, false, "neue Gestaltung der Bildkarten wird als PDF gedruckt …"]);
  const err = DR.cardsPrintState({ status: "ready", cards, design: des({ outdated: true, error: "abgelehnt." }) });   // Meldung des Servers endet mit Punkt
  assert.deepEqual([err.error, err.ok, err.text], [true, false, "Druck fehlgeschlagen: abgelehnt – die neue Gestaltung der Bildkarten ist noch nicht gedruckt."]);
  assert.deepEqual(DR.cardsPrintState({ status: "ready", cards, design: des() }), DR.designState({ status: "ready", cards, design: des() }));
  assert.equal(DR.cardsPrintState({ status: "processing", cards }), null, "hochgeladen: kein Druck");
  // anderes Material in der Druckliste wie bisher
  const m = { status: "ready", design: des({ outdated: true }) };
  assert.deepEqual(DR.printDesignState(m), DR.designState(m));
});

test("storyInPlan: erkennt erzählte und vorgelesene Geschichten (großzügig), nicht die Erzählrunde der Kinder; Zeile ohne Zeichen und gekürzt", () => {
  const yes = [["**2) Erzählung mit Bildkarten (15 Min., Sitzkreis)**", "2) Erzählung mit Bildkarten (15 Min., Sitzkreis)"],
    ["- __Lehrkraft liest [[pdf:aaaaaaaaaaaaaaaa|Vorlesetext – Josef]] vor.__", "Lehrkraft liest Vorlesetext – Josef vor."],
    ["- Die Geschichte von Noah frei erzählen", "Die Geschichte von Noah frei erzählen"], ["- Lehrkraft erzählt von Josef", "Lehrkraft erzählt von Josef"],
    ["- Ich erzähle die Schöpfung", "Ich erzähle die Schöpfung"], ["- Bilderbuch „Die kleine Raupe“ zeigen", "Bilderbuch „Die kleine Raupe“ zeigen"],
    ["- Kamishibai: Sankt Martin", "Kamishibai: Sankt Martin"], ["- Legende vom heiligen Nikolaus", "Legende vom heiligen Nikolaus"], ["- Gleichnis vom verlorenen Schaf", "Gleichnis vom verlorenen Schaf"],
    ["- Kinder erzählen die Geschichte mit eigenen Worten nach", "Kinder erzählen die Geschichte mit eigenen Worten nach"], ["- Vorlesen aus der Kinderbibel", "Vorlesen aus der Kinderbibel"],
    ["- [[pdf:aaaaaaaaaaaaaaaa|Schöpfungsgeschichte]] zeigen", "Schöpfungsgeschichte zeigen"]];
  for (const [t, line] of yes) assert.equal(G.storyInPlan(t), line, t);
  const no = ["", null, undefined, "**1) Ankommen im Sitzkreis (5 Min.)**\n- Begrüßungslied", "**1) Erzählkreis (10 Min., Sitzkreis)**\n- Kinder erzählen von ihrem Wochenende",
    "- Die Kinder erzählen über ihre Haustiere", "- Erzählrunde: Was habe ich erlebt?", "**3) Arbeitsblatt (15 Min., Einzelarbeit)**\n- [[pdf:aaaaaaaaaaaaaaaa]]", "- Bewegungslied, Kerze anzünden",
    "⏸ Zwischenstopp", "- Partnerarbeit: Kinder erzählen einander von den Ferien"];
  for (const t of no) assert.equal(G.storyInPlan(t), null, String(t));
  // Prüfung: vorgetragene Bibeltexte und das Erzählen mit Egli-Figuren zählen auch; Kinder, die Ergebnisse vortragen, nicht
  for (const t of ["- __Lehrkraft trägt den Bibeltext (Lk 19,1–10) vor.__", "- Bodenbild mit Egli-Figuren legen", "**2) Bibeltext: Zachäus (10 Min., Sitzkreis)**", "- Psalm vorgetragen von der Lehrkraft"])
    assert.ok(G.storyInPlan(t), t);
  for (const t of ["- Die Kinder tragen ihre Ergebnisse vor", "- Rechnungen werden beglichen"]) assert.equal(G.storyInPlan(t), null, t);
  // die erste passende Zeile; lange Zeilen gekürzt
  assert.equal(G.storyInPlan("**1) Lied**\n**2) Erzählung: Josef (15 Min., Sitzkreis)**\n- Geschichte"), "2) Erzählung: Josef (15 Min., Sitzkreis)");
  const long = G.storyInPlan("- Geschichte " + "x".repeat(200));
  assert.ok(long.length === 120 && long.endsWith("…"));
});

test("Prompts: „Stunde mit Claude planen“ (Grundschule) macht Bildkarten zur Pflicht, Überarbeitung der Einheit nennt sie; Gymnasium, Einheitsplanung und Selbstlern-Phase ohne", () => {
  const g = FX.gsCtx(P.unitContext), p = G.claudeGsLessonPrompt(g);
  assert.ok(p.includes("Sitzkreis, Erzählung mit Bildkarten, Bodenbild") && !p.includes("gern mit Bildkarten"), "„Erzählung (gern mit Bildkarten)“ → „Erzählung mit Bildkarten“");
  assert.equal(p.split("- " + G.CARDS_ALWAYS).length - 1, 1, "Regel genau einmal");
  assert.ok(G.CARDS_ALWAYS.includes("gehören immer Bildkarten dazu") && G.CARDS_ALWAYS.includes("`add_picture_cards`") && G.CARDS_ALWAYS.includes("meiner Druckliste („1x - farbig - einseitig - <Kurs> - <Titel>.pdf“: 1x, einseitig, farbig)"));
  const step = G.cardsPromptStep();
  assert.equal(p.split(step).length - 1, 1);
  assert.ok(step.startsWith("   - Zu jeder Geschichte, die im Sitzkreis erzählt oder vorgelesen wird, gestaltest du Bildkarten") && step.includes("sie stehen dann von selbst auf meiner Druckliste (1x, einseitig, farbig)") && step.includes("[[pdf:<file_id>]]"));
  assert.ok(!p.includes("Erzählst du eine Geschichte mit Bildkarten, gestaltest du sie"), "der alte, freiwillige Satz ist ersetzt");
  const v = p.slice(p.indexOf("## Vorgehen"));
  assert.ok(v.indexOf(step) < v.indexOf("Die Konzentrationsaufgabe speicherst du") && v.indexOf("Die Konzentrationsaufgabe speicherst du") < v.indexOf("   - Den Stundenverlauf speicherst du"), "Bildkarten vor Konzentrationsaufgabe und Verlaufsplan");
  // die Konzentrationsaufgabe (Nachtrag 27) bleibt, wie sie war
  assert.ok(p.includes(G.concPromptSection()) && p.includes(G.concPromptStep(g.lesson)));
  const rev = G.claudeUnitRevisionPrompt({ unit: { id: "u".repeat(16), rows: [], plan: {}, params: {}, revise: { items: [] }, lessons: [] }, now: Date.parse("2026-11-02T10:00:00Z") });
  assert.equal(rev.split(G.CARDS_REVISION).length - 1, 1);
  assert.ok(G.CARDS_REVISION.includes("gehören Bildkarten dazu (`add_picture_cards`; sie stehen dann von selbst auf meiner Druckliste: 1x, einseitig, farbig)"));
  const s = FX.sekCtx(P.unitContext), u = { id: "u".repeat(16), subject: "powi", klass: "8B", rows: [], plan: {}, params: {}, revise: { items: [] }, lessons: [] };
  for (const [n, q] of [["Gymnasium", P.claudeLessonPrompt(s)], ["Jg. 6", P.claudeLessonPrompt({ ...s, klass: "6B", unit: null, row: null, unitText: "" })], ["Selbstlern-Phase", SL.claudeSelbstlernPrompt({ ...s, row: null })],
    ["Überarbeitung Gymnasium", P.claudeGymRevisionPrompt({ unit: u, now: Date.now() })], ["Einheit Grundschule", G.claudeGsUnitPrompt({ unitId: u.id, course: { subjectName: "Religion" }, params: {}, slots: [] })]])
    assert.ok(!q.includes(G.CARDS_ALWAYS) && !q.includes(G.CARDS_REVISION) && !q.includes("Druckliste („1x - farbig - einseitig"), n);
});

/* ---------- Server ---------- */
test("Neue Bildkarten auf der Druckliste: hochgeladen und von Claude gestaltet mit 1x, einseitig, farbig (nie die Schülerzahl); Name wie auf der Druckliste", async () => {
  const { c, l, mcp } = await setup();
  let r = await upload(c, l.id);
  let f = await F.getFile(c.db, r.data.file.id);
  assert.deepEqual([f.area, f.print_copies, f.print_duplex, f.print_color], ["teacher", 1, 0, 1]);
  assert.deepEqual([r.data.file.print, r.data.file.printName], [{ copies: 1, duplex: false, color: true }, "1x - farbig - einseitig - Reli2 - Josef.pdf"]);
  pages.n = 3;
  r = await mcp("add_picture_cards", { lesson_id: l.id, titel: "Bildkarten – Josef", html: HTML, erzaehltexte: TEXTS });
  f = await F.getFile(c.db, r.structuredContent.file_id);
  assert.deepEqual([f.area, f.print_copies, f.print_duplex, f.print_color], ["teacher", 1, 0, 1], "nie die Schülerzahl (22)");
  assert.equal(r.structuredContent.druckliste, "1x - farbig - einseitig - Reli2 - Bildkarten – Josef.pdf");
  assert.ok(r.content[0].text.endsWith(" Sie stehen auf der Druckliste der Lehrkraft als „1x - farbig - einseitig - Reli2 - Bildkarten – Josef.pdf“ (1x, einseitig, farbig)."), r.content[0].text);
  // ohne Drucker (wartet auf den Druck): steht schon auf der Liste, die Antwort sagt es
  const c2 = { ...c, env: { ...c.env, BROWSER: undefined } };
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_picture_cards", arguments: { lesson_id: l.id, titel: "Arche", html: HTML, erzaehltexte: ["a"] } } }) });
  r = (await (await routeMcp({ ...c2, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
  assert.ok(r.content[0].text.includes("noch nicht als PDF gedruckt") && r.content[0].text.includes("Sie stehen auf der Druckliste der Lehrkraft als „1x - farbig - einseitig - Reli2 - Arche.pdf“"), r.content[0].text);
  // die Startseite druckt ausstehende Gestaltungen nach, auch wenn niemand die Sitzung öffnet – Bildkarten gehören dazu
  const ru = await call(c, F.routeRenderUsage, "GET", "/api/teacher/render");
  assert.ok(ru.data.pending.some((x) => x.id === r.structuredContent.file_id), JSON.stringify(ru.data.pending));
});

test("Claude gestaltet neu (file_id): die Druckeinstellung der Lehrkraft bleibt – geänderte Anzahl/Druckart und auch „nicht auf der Liste“", async () => {
  const { c, l, mcp } = await setup();
  pages.n = 3;
  const id = (await mcp("add_picture_cards", { lesson_id: l.id, titel: "Bildkarten – Josef", html: HTML, erzaehltexte: TEXTS })).structuredContent.file_id;
  assert.equal((await patch(c, id, { copies: 3, duplex: true, color: false })).status, 200);
  let r = await mcp("add_picture_cards", { lesson_id: l.id, titel: "Bildkarten – Josef", html: HTML + "<section>4</section>", erzaehltexte: [...TEXTS, "Ende."], file_id: id });
  let f = await F.getFile(c.db, id);
  assert.deepEqual([f.print_copies, f.print_duplex, f.print_color], [3, 1, 0]);
  assert.ok(r.content[0].text.includes("Sie stehen auf der Druckliste der Lehrkraft als „3x - sw - beidseitig - Reli2 - Bildkarten – Josef.pdf“ (ihre Druckeinstellung bleibt)."), r.content[0].text);
  assert.equal((await patch(c, id, { copies: null })).status, 200);
  r = await mcp("add_picture_cards", { lesson_id: l.id, titel: "Bildkarten – Josef", html: HTML, erzaehltexte: TEXTS, file_id: id });
  f = await F.getFile(c.db, id);
  assert.deepEqual([f.print_copies, f.print_duplex, f.print_color, r.structuredContent.druckliste], [null, null, null, null]);
  assert.ok(r.content[0].text.includes("Sie stehen nicht auf der Druckliste der Lehrkraft (heruntergenommen oder vor dem 16.11.2026 angelegt) – das bleibt so"), r.content[0].text);
});

test("Abwählen und wieder aufnehmen (PATCH): nimmt nur von der Liste – Bildkarten, Erzähltexte und Freigabe bleiben; wieder auf = 1x, einseitig, farbig; Gymnasium unverändert", async () => {
  const { c, l, sek } = await setup();
  const id = (await upload(c, l.id)).data.file.id;
  const before = await F.getFile(c.db, id);
  let r = await patch(c, id, { copies: null });
  assert.equal(r.status, 200);
  assert.ok(!r.data.file.print && !r.data.file.printName && r.data.file.cards, "fileOut: keine Druckangaben mehr, Bildkarten bleiben");
  let f = await F.getFile(c.db, id);
  assert.deepEqual([f.print_copies, f.print_duplex, f.print_color, f.cards, f.area, f.name], [null, null, null, before.cards, "teacher", "Josef.pdf"]);
  assert.equal((await patch(c, id, { duplex: true })).data.error, "Bitte zuerst die Anzahl der Ausdrucke angeben.");
  r = await patch(c, id, { copies: 1 });
  assert.deepEqual([r.status, r.data.file.printName], [200, "1x - farbig - einseitig - Reli2 - Josef.pdf"], "ohne Angaben: wie für Bildkarten vorgesehen");
  r = await patch(c, id, { copies: 2, color: false });
  assert.equal(r.data.file.printName, "2x - sw - einseitig - Reli2 - Josef.pdf");
  assert.equal((await patch(c, id, { area: "student" })).status, 400, "Bildkarten wechseln nie den Bereich");
  // Gymnasium: eine Datei der Lehrkraft hat keine Druckangaben (wie bisher)
  const sf = await call(c, F.routeFileUpload, "POST", "/api/teacher/lessons/" + sek.id + "/files?area=teacher&name=x.pdf", PDF(1), sek.id);
  assert.equal(sf.status, 200);
  assert.equal((await patch(c, sf.data.file.id, { copies: 3 })).data.error, "Anzahl, beidseitig und Farbe gibt es nur bei Dateien zum Ausdrucken.");
  assert.ok(!sf.data.file.print);
});

test("Druckliste des Tages (PRINT_FILES_SQL, „Druckaufträge für den nächsten Arbeitstag“): Bildkarten mit Druckangaben ja, ältere/heruntergenommene nein, Ausfall-Einträge nie", async () => {
  const { c, k, l } = await setup();
  const on = (await upload(c, l.id, "Neu.pdf")).data.file.id, off = (await upload(c, l.id, "Ab.pdf")).data.file.id, old = (await upload(c, l.id, "Alt.pdf")).data.file.id;
  await patch(c, off, { copies: null });
  // so lag eine Zeile vor dem 16.11.2026 in D1 (ohne Druckangaben) – keine Nachrüstung
  await c.db.prepare("UPDATE files SET print_copies=NULL, print_duplex=NULL, print_color=NULL WHERE id=?1").bind(old).run();
  // eigene Druckliste der Sitzungen des Tages (ref_card = 0); seit Nachtrag 31b liefert dieselbe Anweisung dahinter (ref_card = 1) alle Bildkarten der Kurse des Tages –
  // ob ein Verlaufsplan auf sie verweist, entscheidet routePrintNext (refcards.test.mjs)
  const rows = async (d) => (await c.db.prepare(PRINT_FILES_SQL).bind(d).all()).results || [];
  const ids = async (d) => (await rows(d)).filter((x) => !x.ref_card).map((x) => x.id);
  assert.deepEqual(await ids("2026-11-24"), [on]);
  assert.deepEqual((await rows("2026-11-24")).filter((x) => x.ref_card).map((x) => [x.id, x.owner_klass]).sort(), [on, off, old].map((fid) => [fid, k.id]).sort(),
    "Nachtrag 31b: alle Bildkarten des Kurses (auch abgewählte und ältere – die Druckangaben gelten je Sitzung), mit dem Kurs ihrer Sitzung");
  const out = L.fileOut((await rows("2026-11-24")).filter((x) => !x.ref_card)[0], false);
  assert.deepEqual([out.printName, !!out.cards, out.design], ["1x - farbig - einseitig - Reli2 - Neu.pdf", true, undefined]);
  // ein Ausfall-Eintrag (Krankmeldung) zählt nie
  const x = await L.createLesson(c.db, { subject: "gs", klass: k.id, title: "Ausfall", date: "2026-11-25", startTime: "08:00", durationMin: 45 }, c.now + 5);
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, cards, print_copies, print_duplex, print_color, created_at, updated_at) " +
    "VALUES('ccccccccccccccc1', ?1, 'teacher', 'file', 'K.pdf', 'application/pdf', 5, 'ready', 'upload', '{}', 1, 0, 1, 1, 1)").bind(x.id).run();
  assert.deepEqual(await ids("2026-11-25"), ["ccccccccccccccc1"]);
  await c.db.prepare("UPDATE lessons SET cancelled=1 WHERE id=?1").bind(x.id).run();
  assert.deepEqual(await ids("2026-11-25"), []);
  // Gymnasium: eine Datei der Lehrkraft mit (fremden) Druckangaben zählt nicht (nur area print)
  const sek2 = await L.createLesson(c.db, { subject: "powi", klass: "9A", title: "x", date: "2026-11-26" }, c.now + 6);
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, cards, print_copies, created_at, updated_at) VALUES('ccccccccccccccc2', ?1, 'teacher', 'file', 'K.pdf', 'application/pdf', 5, 'ready', 'upload', '{}', 1, 1, 1)").bind(sek2.id).run();
  assert.deepEqual(await ids("2026-11-26"), []);
});

test("Download aus der Druckliste: Link mit print → Name der Druckliste (auch wo der Browser das download-Attribut nicht beachtet); sonst wie bisher", async () => {
  const { c, l, sek } = await setup();
  const id = (await upload(c, l.id, "Bildkarten Josef.pdf")).data.file.id;
  const link = async (fid, body) => (await call(c, F.routeTeacherFileLink, "POST", "/x", body, fid)).data.url;
  const dl = async (u) => { const r = await call(c, F.routeDownload, "GET", u, undefined, u.split("/")[3].split("?")[0]); return r.res.headers.get("content-disposition"); };
  const pr = await link(id, { print: true }), plain = await link(id, {});
  assert.ok(pr.includes("&p=pr&") && !plain.includes("p=pr"));
  assert.ok((await dl(pr)).includes('filename="1x - farbig - einseitig - Reli2 - Bildkarten Josef.pdf"'));
  assert.ok((await dl(plain)).includes('filename="Bildkarten Josef.pdf"'));
  // die Signatur gilt nur für die Variante
  assert.equal((await call(c, F.routeDownload, "GET", plain.replace("?d=a&", "?d=a&p=pr&"), undefined, id)).status, 403);
  // heruntergenommen: auch mit print der Name der Bildkarten (nicht mehr auf der Liste)
  await patch(c, id, { copies: null });
  assert.ok(!(await link(id, { print: true })).includes("p=pr"));
  // Gymnasium: eine Datei der Lehrkraft bleibt beim einfachen Namen
  const sf = (await call(c, F.routeFileUpload, "POST", "/api/teacher/lessons/" + sek.id + "/files?area=teacher&name=x.pdf", PDF(1), sek.id)).data.file;
  assert.ok(!(await link(sf.id, { print: true })).includes("p=pr"));
});

test("Elternansicht unverändert: keine Druckangaben in der Nutzlast; „Nicht ausdrucken“ ändert nicht, was Eltern sehen", async () => {
  const { c, k, l, mcp } = await setup();
  pages.n = 3;
  const id = (await mcp("add_picture_cards", { lesson_id: l.id, titel: "Bildkarten – Josef", html: HTML, erzaehltexte: TEXTS })).structuredContent.file_id;
  const f = await F.getFile(c.db, id);
  for (const n of [1, 2, 3]) await c.db.prepare("INSERT INTO slides(file_id, n, size, w, h) VALUES(?1, ?2, 10, 1600, 1131)").bind(id, n).run();
  await c.db.prepare("UPDATE files SET card_pages=3, card_img_at=?2 WHERE id=?1").bind(id, f.pdf_at).run();
  await L.savePortal(c.db, l.id, "**1) Erzählung (15 Min., Sitzkreis)**\n- [[pdf:" + id + "]]", null, "lehrkraft", c.now);
  const course = GS.gsCourseOut(await GS.getGsCourse(c.db, k.id));
  const view = async () => { const v = await PA.parentView(c, await L.getLesson(c.db, l.id), course, { preview: true }); return v.cards.map((x) => ({ ...x, img: null })); };
  const a = await view();
  assert.equal(a.length, 1);
  assert.ok(!/print|Druck|1x - farbig|Reli2 - /.test(JSON.stringify(await PA.parentView(c, await L.getLesson(c.db, l.id), course, { preview: true }))), "keine Druckangaben für Eltern");
  await patch(c, id, { copies: null });
  assert.deepEqual(await view(), a);
});

test("get_lesson und save_verlaufsplan: Druckliste je Satz; Geschichte ohne Bildkarten → Erinnerung (gespeichert wird trotzdem); keine bei Bildkarten, Verweis auf fremde Bildkarten, ohne Geschichte", async () => {
  const { c, k, l, mcp } = await setup();
  let t = (await mcp("get_lesson", { lesson_id: l.id })).content[0].text;
  assert.ok(t.includes("\n## Bildkarten\nNoch keine. Wird in dieser Stunde im Sitzkreis eine Geschichte erzählt oder vorgelesen, gehören immer Bildkarten dazu – gestalte sie mit add_picture_cards; " +
    "neue Bildkarten stehen von selbst auf der Druckliste der Lehrkraft (1x, einseitig, farbig)."), t);
  // Geschichte ohne Bildkarten
  let r = await mcp("save_verlaufsplan", { lesson_id: l.id, text: "**1) Erzählung: Josef (15 Min., Sitzkreis)**\n- Lehrkraft erzählt frei", base_version: 0 });
  assert.ok(!r.isError && r.content[0].text.includes(G.cardsMissingText("1) Erzählung: Josef (15 Min., Sitzkreis)")) && r.structuredContent.bildkarten_fehlen === true, r.content[0].text);
  assert.equal((await L.getLesson(c.db, l.id)).portal, "**1) Erzählung: Josef (15 Min., Sitzkreis)**\n- Lehrkraft erzählt frei", "gespeichert");
  assert.ok(G.cardsMissingText("x").includes("Wird in der Stunde keine Geschichte erzählt, gilt dieser Hinweis nicht."));
  t = (await mcp("get_lesson", { lesson_id: l.id })).content[0].text;
  assert.ok(t.includes("\n## Bildkarten\nAchtung:" + G.cardsMissingText("1) Erzählung: Josef (15 Min., Sitzkreis)")), t);
  // ohne Geschichte: keine Erinnerung
  r = await mcp("save_verlaufsplan", { lesson_id: l.id, text: "**1) Bewegungslied (5 Min.)**\n**2) Arbeitsblatt (20 Min., Einzelarbeit)**", base_version: 1 });
  assert.ok(!r.content[0].text.includes("noch keine Bildkarten") && r.structuredContent.bildkarten_fehlen === undefined, r.content[0].text);
  // mit Bildkarten: keine Erinnerung, je Satz die Druckliste
  pages.n = 3;
  const id = (await mcp("add_picture_cards", { lesson_id: l.id, titel: "Bildkarten – Josef", html: HTML, erzaehltexte: TEXTS })).structuredContent.file_id;
  r = await mcp("save_verlaufsplan", { lesson_id: l.id, text: "**1) Erzählung: Josef (15 Min., Sitzkreis)**\n- [[pdf:" + id + "]]", base_version: 2 });
  assert.ok(!r.content[0].text.includes("noch keine Bildkarten"), r.content[0].text);
  t = (await mcp("get_lesson", { lesson_id: l.id })).content[0].text;
  assert.ok(t.includes("  Druckliste der Lehrkraft: „1x - farbig - einseitig - Reli2 - Bildkarten – Josef.pdf“.") && !t.includes("Noch keine. Erzählst du"), t);
  await patch(c, id, { copies: null });
  t = (await mcp("get_lesson", { lesson_id: l.id })).content[0].text;
  assert.ok(t.includes("  Nicht auf der Druckliste der Lehrkraft (heruntergenommen oder vor dem 16.11.2026 angelegt) – nur sie nimmt die Bildkarten in der Sitzung wieder auf."), t);
  // nächste Sitzung erzählt die Geschichte mit den Bildkarten der vorigen weiter: keine Erinnerung
  const l2 = await L.createLesson(c.db, { subject: "gs", klass: k.id, title: "Josef verzeiht", date: "2026-12-01", startTime: "08:00", durationMin: 45 }, c.now + 9);
  r = await mcp("save_verlaufsplan", { lesson_id: l2.id, text: "**1) Erzählung (10 Min., Sitzkreis)**\n- [[pdf:" + id + "]] noch einmal zeigen", base_version: 0 });
  assert.ok(!r.content[0].text.includes("noch keine Bildkarten"), r.content[0].text);
  t = (await mcp("get_lesson", { lesson_id: l2.id })).content[0].text;
  // Nachtrag 31b: die wiederverwendeten Bildkarten stehen auch auf der Druckliste dieser Sitzung (1x, einseitig, farbig – auch wenn ihre eigene Sitzung sie abgewählt hat)
  assert.ok(t.includes("\n## Bildkarten\nDiese Sitzung hat keine eigenen Bildkarten; der Verlaufsplan verweist auf Bildkarten anderer Sitzungen:\n- „Bildkarten – Josef.pdf“ aus einer anderen Sitzung: " +
    "auch auf der Druckliste dieser Sitzung als „1x - farbig - einseitig - Reli2 - Bildkarten – Josef.pdf“."), t);
  // Ausfall-Eintrag: kein Abschnitt; reine Abschnitts-Funktion auch direkt
  await c.db.prepare("UPDATE lessons SET cancelled=1 WHERE id=?1").bind(l2.id).run();
  assert.ok(!(await mcp("get_lesson", { lesson_id: l2.id })).content[0].text.includes("## Bildkarten"));
  assert.deepEqual(cardsSection([], { cancelled: true, plan: "Geschichte" }), []);
});

test("Werkzeuge und Anweisungen: add_picture_cards nennt Pflicht und Druckliste in einem Satz; die MCP-Anweisungen bleiben byte-gleich (gekürzte Clients)", async () => {
  const { mcp } = await setup();
  const d = (await mcp(null)).tools.find((x) => x.name === "add_picture_cards").description;
  assert.ok(d.includes("Zu jeder Geschichte im Sitzkreis gehören Bildkarten; neue stehen von selbst auf der Druckliste der Lehrkraft (1x, einseitig, farbig)."));
  const init = await mcp(undefined);
  // SHA-256 der Anweisungen vor Nachtrag 31 (Commit 8a1416d, 5646 Zeichen)
  assert.equal(createHash("sha256").update(init.instructions).digest("hex"), "860d2d7906d462e281f49e4bbfb9e61e12041751e854ee8a2e813f4cdb862e1e");
  assert.equal(init.instructions.length, 5646);
});

/* ---------- Oberfläche (Browser-Ersatz) ---------- */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const button = (root, text) => $$("button", root).find((b) => b.textContent.trim() === text || b.getAttribute("aria-label") === text);
async function until(cond, what) { for (let i = 0; i < 1500; i++) { if (cond()) return; await D.sleep(2); } assert.fail("nicht eingetreten: " + what); }
const MB = await import("../../public/materialbox.js");
const CC = await import("../../public/cards.js");
const IO = await import("../../public/sessionio.js");
const fid = (n) => String(n).padStart(16, "c");
const cardFile = (n, name, extra = {}) => ({ id: fid(n), area: "teacher", kind: "file", name, mime: "application/pdf", size: 4096, pages: 3, status: "ready", source: "upload", createdAt: n,
  cards: { texts: ["a", "b", "c"], share: true, rev: 0, pages: 3, current: true, version: 7 }, print: { copies: 1, duplex: false, color: true }, printName: "1x - farbig - einseitig - Reli2 - " + name, ...extra });
function server(routes) {
  const calls = [];
  globalThis.__tapi = async (method, path, o = {}) => {
    calls.push({ method, path, body: o.body });
    for (const [re, fn] of routes) { const m = re.exec(method + " " + path); if (m) return fn(m, o.body); }
    throw new Error("unerwartet: " + method + " " + path);
  };
  return calls;
}
function mount(files, routes) {
  if (globalThis.__leave) globalThis.__leave();
  DR.resetPrintQueue();
  const calls = server(routes);
  const st = { files };
  let box = null;
  const cards = CC.cardsCard({ lessonId: fid(99), st, insertRef: () => {}, onChange: () => {}, onPrintChange: () => box.paintPrint() });
  box = MB.materialBox({ lessonId: fid(99), st, L: () => ({ subject: "gs", klass: "gsx", date: "2026-11-24" }), gs: true, exclude: (f) => f.cards != null, printCopies: () => 22, onPrintChange: (f) => cards.syncPrint(f.id),
    labels: { printHint: "Neue Bildkarten stehen hier von selbst." }, course: "Reli2" });
  const app = document.getElementById("app");
  while (app.firstChild) app.firstChild.remove();
  app.append(cards.el, box.filesCard, box.printCard);
  return { calls, st, box, cards };
}
const cardsRoutes = (srv) => [
  [/^GET \/api\/teacher\/files\/(\w+)\/cards$/, () => ({ img: { base: "/i/", q: "" }, w: 100, h: 70, pages: 3, texts: ["a", "b", "c"], share: true, rev: 0, current: true, version: 7, status: "ready", name: "x" })],
  [/^PATCH \/api\/teacher\/files\/(\w+)$/, (m, b) => { const f = srv.find((x) => x.id === m[1]); if (b.copies === null) { const { print, printName, ...rest } = f; return { file: rest }; }
    const p = { copies: b.copies, duplex: b.duplex ?? false, color: b.color ?? true }; return { file: { ...f, print: p, printName: S.printFileName({ name: f.name, ...p, course: "Reli2" }) } }; }]];

test("Sitzungsseite (Grundschule): Bildkarten mit Druckangaben in der Druckliste, ältere nicht; „Nicht ausdrucken“ und der Schalter der Karte bleiben gleich; Fokus", async () => {
  const on = cardFile(1, "Neu.pdf"), old = cardFile(2, "Alt.pdf"), kid = { id: fid(3), area: "student", kind: "file", name: "AB.pdf", mime: "application/pdf", size: 10, status: "ready", createdAt: 3, print: { copies: 22, duplex: true, color: false }, printName: "22x - sw - beidseitig - Reli2 - AB.pdf" };
  delete old.print; delete old.printName;
  const files = [on, old, kid];
  const { calls } = mount(files, cardsRoutes([cardFile(1, "Neu.pdf"), { ...cardFile(2, "Alt.pdf") }]));
  await D.sleep(10);
  const names = () => $$("#printcard .printrow .name").map((x) => x.textContent);
  assert.deepEqual(names(), ["1x - farbig - einseitig - Reli2 - Neu.pdf", "22x - sw - beidseitig - Reli2 - AB.pdf"], "neue Bildkarten auf der Liste, ältere nicht");
  assert.equal($("#print-cards-hint").textContent, "Neue Bildkarten stehen hier von selbst.");
  // Nachtrag 32: der Hinweis nennt das Muster mit dem Kurs der Sitzung; die Auswahlfelder stehen in der Reihenfolge des Namens
  assert.ok($("#print-name-hint").textContent.endsWith("Der Dateiname nennt Anzahl, schwarz-weiß/farbig, einseitig/beidseitig, den Kurs und den Titel, z. B. „23x - sw - einseitig - Reli2 - Die Arche Noah.pdf“."), $("#print-name-hint").textContent);
  assert.deepEqual([...$$("#printcard .printrow")[1].querySelector(".pset").children].map((x) => x.tagName + ":" + (x.getAttribute("aria-label") || x.textContent)),
    ["LABEL:Exemplare", "SELECT:Schwarz-weiß oder farbig – AB.pdf", "SELECT:Beidseitig oder einseitig – AB.pdf"]);
  assert.deepEqual([...$$("#printcard .printrow")[1].querySelectorAll("select")[0].querySelectorAll("option")].map((o) => o.textContent), ["schwarz-weiß", "farbig (nur wenn nötig)"]);
  assert.ok(!$("#gs-material").textContent.includes("Neu.pdf"), "nicht im Materialkasten");
  const row = $$("#printcard .printrow")[0];
  assert.ok(row.querySelector(".meta").textContent.startsWith("Bildkarten · ") && !button(row, "Umbenennen – Neu.pdf") && !row.querySelector("button.danger"), "Zeile: Bildkarten, ohne Umbenennen und Löschen");
  assert.ok($("#cs-print-" + on.id).checked && !$("#cs-print-" + old.id).checked);
  assert.ok($("#cs-print-d-" + old.id).textContent.startsWith("Steht nicht auf der Druckliste – eingeschaltet kommt sie dazu (1×, einseitig, farbig)."));
  // „Nicht ausdrucken“: PATCH copies null, Zeile weg, Fokus auf die Überschrift, Schalter der Karte aus
  const btn = button(row, "Nicht ausdrucken – 1x - farbig - einseitig - Reli2 - Neu.pdf");
  btn.focus(); D.userClick(btn);
  await until(() => names().length === 1, "Zeile weg");
  assert.deepEqual(calls.filter((x) => x.method === "PATCH").map((x) => x.body), [{ copies: null }]);
  assert.equal(document.activeElement, $("#printcard h2"), "Fokus auf „Von der Lehrkraft auszudrucken“");
  assert.ok(!$("#cs-print-" + on.id).checked && !on.print && on.cards, "Schalter aus, die Bildkarten bleiben");
  // wieder aufnehmen über den Schalter: 1x, einseitig, farbig; Zeile wieder da; Fokus bleibt auf dem Schalter
  const cb = $("#cs-print-" + on.id);
  cb.focus(); cb.checked = true; D.fire(cb, "change");
  await until(() => names().length === 2, "Zeile wieder da");
  assert.deepEqual(calls.filter((x) => x.method === "PATCH").pop().body, { copies: 1, duplex: false, color: true });
  assert.equal(document.activeElement, cb);
  assert.ok($("#cs-print-d-" + on.id).textContent.includes("„1x - farbig - einseitig - Reli2 - Neu.pdf“"));
  // ältere Bildkarten von Hand aufnehmen
  const cb2 = $("#cs-print-" + old.id); cb2.checked = true; D.fire(cb2, "change");
  await until(() => names().includes("1x - farbig - einseitig - Reli2 - Alt.pdf"), "alte Bildkarten von Hand aufgenommen");
});

test("Nachtrag 32: Einzel-Download aus der Druckliste fragt den Link immer mit print an – der Server nennt die Datei dann selbst mit dem Druck-Namen (GitHub Pages), auch Arbeitsblätter der Kinder", async () => {
  const kid = { id: fid(21), area: "student", kind: "file", name: "AB.pdf", mime: "application/pdf", size: 10, status: "ready", createdAt: 3, print: { copies: 22, duplex: true, color: false }, printName: "22x - sw - beidseitig - Reli2 - AB.pdf" };
  const tpl = { id: fid(22), area: "print", kind: "file", name: "Tafel.pdf", mime: "application/pdf", size: 10, status: "ready", createdAt: 4, print: { copies: 1, duplex: true, color: false }, printName: "1x - sw - beidseitig - Reli2 - Tafel.pdf" };
  const clicks = [];
  const { calls } = mount([kid, tpl], [[/^POST \/api\/teacher\/files\/(\w+)\/link$/, (m) => ({ url: "/api/dl/" + m[1] + "?d=a&p=pr&e=1&s=x" })]]);
  const origAppend = document.body.append.bind(document.body);
  document.body.append = (...xs) => { for (const x of xs) if (x && x.tagName === "A") clicks.push(x.getAttribute("download")); return origAppend(...xs); };
  try {
    await D.sleep(10);
    for (const name of ["22x - sw - beidseitig - Reli2 - AB.pdf", "1x - sw - beidseitig - Reli2 - Tafel.pdf"]) {
      const row = $$("#printcard .printrow").find((r) => r.querySelector(".name").textContent === name);
      D.userClick(button(row, "Herunterladen"));
      await until(() => clicks.includes(name), "Download „" + name + "“");
    }
    assert.deepEqual(calls.filter((x) => x.method === "POST").map((x) => [x.path, x.body]), [["/api/teacher/files/" + kid.id + "/link", { print: true }], ["/api/teacher/files/" + tpl.id + "/link", { print: true }]]);
  } finally { document.body.append = origAppend; }
});

test("ZIP-Datei der Druckliste: Bildkarten, deren aktuelle Gestaltung noch nicht gedruckt ist, fehlen nie stillschweigend – Hinweis unter dem Knopf mit Grund", async () => {
  const pending = cardFile(4, "Arche.pdf", { status: "ready", source: "claude", design: { outdated: true, error: null, htmlAt: 9, pdfAt: 8, text: "" } });
  const failed = cardFile(5, "Josef.pdf", { status: "ready", source: "claude", design: { outdated: true, error: "abgelehnt", htmlAt: 9, pdfAt: 8, text: "" } });
  const ready = cardFile(6, "Noah.pdf");
  let release; const printed = new Promise((r) => { release = r; });
  const zips = [];
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(PDF(3));
  const { calls } = mount([pending, failed, ready], [...cardsRoutes([{ ...pending }, { ...failed }, { ...ready }]),
    [/^POST \/api\/teacher\/files\/(\w+)\/link$/, (m) => ({ url: "/api/dl/" + m[1] })],
    [/^POST \/api\/teacher\/files\/(\w+)\/render$/, async (m) => { await printed; return { file: { ...pending, design: { ...pending.design, outdated: false, pdfAt: 9 } } }; }]]);
  const UI = await import("../../public/ui.js");
  const blobs = [];
  try {
    await D.sleep(10);
    const rowOf = (n) => $$("#printcard .printrow").find((r) => r.textContent.includes(n));
    assert.ok(!button(rowOf("Arche.pdf"), "Herunterladen") && /wird als PDF gedruckt/.test(rowOf("Arche.pdf").textContent), "neu gestaltet: kein Download der alten Karten – " + rowOf("Arche.pdf").textContent);
    assert.ok(button(rowOf("Josef.pdf"), "Erneut drucken") && rowOf("Josef.pdf").textContent.includes("Druck fehlgeschlagen: abgelehnt – die neue Gestaltung der Bildkarten ist noch nicht gedruckt."));
    assert.ok(calls.some((x) => x.path === "/api/teacher/files/" + pending.id + "/render"), "die Warteschlange druckt die neue Gestaltung");
    // ZIP: nur die fertigen Bildkarten, Hinweis nennt die beiden anderen
    const orig = URL.createObjectURL; URL.createObjectURL = (b) => { blobs.push(b); return "blob:x"; };
    D.userClick(button($("#printcard"), "Alle herunterladen (ZIP)"));
    await until(() => !$("#print-zip-note").classList.contains("hidden"), "Hinweis");
    assert.equal($("#print-zip-note").textContent, "Nicht in der ZIP-Datei – diese Bildkarten: „1x - farbig - einseitig - Reli2 - Arche.pdf“ (wird gerade als PDF gedruckt – bitte gleich noch einmal herunterladen); " +
      "„1x - farbig - einseitig - Reli2 - Josef.pdf“ (der PDF-Druck hat nicht geklappt – bei der Datei „Erneut drucken“).");
    await until(() => calls.filter((x) => x.path.endsWith("/link")).length >= 1, "ZIP gepackt");
    assert.deepEqual(calls.filter((x) => x.path.endsWith("/link")).map((x) => x.path), ["/api/teacher/files/" + ready.id + "/link"], "nur die fertigen Bildkarten in der ZIP-Datei");
    // gedruckt: der Hinweis sagt, dass die ZIP-Datei jetzt vollständig wäre (bis auf die fehlgeschlagene)
    release();
    await until(() => $("#print-zip-note").textContent.startsWith("Nicht in der ZIP-Datei – die Bildkarten „1x - farbig - einseitig - Reli2 - Josef.pdf“"), "Hinweis nach dem Druck");
    assert.ok(button(rowOf("Arche.pdf"), "Herunterladen"), "jetzt herunterladbar");
    // von der Liste genommen: der Hinweis nennt sie nicht mehr
    D.userClick(button(rowOf("Josef.pdf"), "Nicht ausdrucken – 1x - farbig - einseitig - Reli2 - Josef.pdf"));
    await until(() => $("#print-zip-note").classList.contains("hidden"), "Hinweis weg, wenn die fehlenden Bildkarten nicht mehr auf der Liste stehen");
    URL.createObjectURL = orig;
  } finally { globalThis.fetch = real; }
});

test("Sitzungsdatei und Sicherung: Bildkarten auf der Druckliste tragen „print“ in sitzung.json (wie andere Dateien der Druckliste), ältere nicht", async () => {
  const real = globalThis.fetch;
  globalThis.fetch = async () => new Response(PDF(2));
  server([[/^POST \/api\/teacher\/files\/(\w+)\/link$/, (m) => ({ url: "/api/dl/" + m[1] })]]);
  try {
    const on = cardFile(7, "Neu.pdf"), old = cardFile(8, "Alt.pdf"); delete old.print; delete old.printName;
    const z = await IO.buildSessionZip({ lesson: { subject: "gs", klass: "gsx", title: "T", topic: "", date: "2026-11-24", portal: "" }, files: [on, old], drafts: [], sheets: [], messages: [] }, { fb: null });
    const { readZip } = await import("../../public/zip.js");
    const data = JSON.parse(new TextDecoder().decode((await readZip(z.bytes)).find((e) => e.name === "sitzung.json").data));
    const byName = Object.fromEntries(data.files.map((f) => [f.name, f]));
    assert.deepEqual(byName["Neu.pdf"].print, { copies: 1, duplex: false, color: true });
    assert.ok(byName["Neu.pdf"].cards && !("print" in byName["Alt.pdf"]) && byName["Alt.pdf"].cards);
  } finally { globalThis.fetch = real; }
});

/* ---------- Prüfung von Nachtrag 31 (16.11.2026): weitere Wege, auf denen Bildkarten fehlen konnten ---------- */
test("Prüfung: aus der Druckliste (print) gibt der Server Bildkarten nur in ihrer aktuellen Gestaltung heraus – eine ältere Seite bekommt nie die alten Karten", async () => {
  const { c, l, mcp } = await setup();
  pages.n = 3;
  const id = (await mcp("add_picture_cards", { lesson_id: l.id, titel: "Bildkarten – Josef", html: HTML, erzaehltexte: TEXTS })).structuredContent.file_id;
  const link = (body) => call(c, F.routeTeacherFileLink, "POST", "/x", body, id);
  assert.equal((await link({ print: true })).status, 200, "gedruckt: herunterladbar");
  // neu gestaltet, der Drucker antwortet nicht – die gespeicherte PDF zeigt noch die alten Karten
  const c2 = { ...c, env: { ...c.env, BROWSER: undefined } };
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "add_picture_cards", arguments: { lesson_id: l.id, titel: "Bildkarten – Josef", html: HTML + "<section>4</section>", erzaehltexte: [...TEXTS, "Ende."], file_id: id } } }) });
  await routeMcp({ ...c2, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim");
  const r = await link({ print: true });
  assert.equal(r.status, 409);
  assert.equal(r.data.code, "cards_not_printed");
  assert.equal(r.data.error, "Die Bildkarten „Bildkarten – Josef“ sind in ihrer neuen Gestaltung noch nicht als PDF gedruckt – bitte die Seite neu laden, dann druckt Unterricks sie.");
  assert.equal((await link({})).status, 200, "ohne print (z. B. „Als PDF ansehen“, Sitzungsdatei) wie bisher");
  // gedruckt: wieder herunterladbar
  await F.renderDesign(c, id);
  assert.equal((await link({ print: true })).status, 200);
  // hochgeladene Bildkarten haben keine Gestaltung – immer herunterladbar
  const up = (await upload(c, l.id)).data.file.id;
  assert.equal((await call(c, F.routeTeacherFileLink, "POST", "/x", { print: true }, up)).status, 200);
});

test("Prüfung: cardsA4 – hochgeladene Bildkarten in einem anderen Format kommen für die Druckliste auf A4 (Ausrichtung bleibt); A4 und unlesbare PDFs unverändert", async () => {
  const lib = await import("pdf-lib");
  const { cardsA4 } = await import("../../public/a4.js");
  const d = await lib.PDFDocument.create();
  for (const size of [[595.28, 419.53], [595.28, 419.53], [300, 400]]) d.addPage(size).drawRectangle({ x: 20, y: 20, width: 100, height: 80, color: lib.rgb(0.8, 0.3, 0.2) });
  const out = await lib.PDFDocument.load(await cardsA4(await d.save(), lib));
  assert.deepEqual(out.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]), [[842, 595], [842, 595], [595, 842]], "A5 quer → A4 quer, hochkant → A4 hochkant, alle Karten");
  const a4 = await lib.PDFDocument.create(); a4.addPage([841.89, 595.28]);
  const raw = await a4.save();
  assert.equal(await cardsA4(raw, lib), raw, "A4 bleibt byte-gleich");
  const bad = new TextEncoder().encode("%PDF-kaputt");
  assert.equal(await cardsA4(bad, lib), bad, "unlesbar: unverändert (der Download scheitert nicht)");
});

test("Prüfung: ZIP-Datei der Grundschule – holt vorher den Stand vom Server (neue Bildkarten aus dem Chat daneben sind dabei); hochgeladene auf A4; neu gestaltete, noch nicht gedruckte genannt statt alt", async () => {
  const lib = await import("pdf-lib");
  const a5 = await lib.PDFDocument.create(); for (let i = 0; i < 4; i++) a5.addPage([595.28, 419.53]).drawRectangle({ x: 20, y: 20, width: 100, height: 80, color: lib.rgb(0.2, 0.4, 0.8) });
  const a5bytes = await a5.save(), a4 = await lib.PDFDocument.create(); a4.addPage([841.89, 595.28]); a4.addPage([841.89, 595.28]);
  const a4bytes = await a4.save();
  const uploaded = cardFile(7, "Verlag.pdf"), designed = cardFile(8, "Noah.pdf", { source: "claude", design: { outdated: false, error: null, htmlAt: 5, pdfAt: 5, text: "" } });
  // seit dem Öffnen der Seite angelegt (Claude im Fenster daneben); „Noah“ hat Claude inzwischen neu gestaltet (der Server sagt 409)
  const added = cardFile(9, "Arche.pdf", { source: "claude", design: { outdated: false, error: null, htmlAt: 6, pdfAt: 6, text: "" } });
  const real = globalThis.fetch;
  globalThis.fetch = async (u) => new Response(String(u).includes(uploaded.id) ? a5bytes : a4bytes);
  const blobs = [];
  let lessonGets = 0;
  const UI = await import("../../public/ui.js");
  const routes = [...cardsRoutes([{ ...uploaded }, { ...designed }, { ...added }]),
    [/^GET \/api\/teacher\/lessons\/(\w+)$/, () => { lessonGets++; return { files: [{ ...uploaded }, { ...designed }, { ...added }] }; }],
    [/^POST \/api\/teacher\/files\/(\w+)\/link$/, (m, b) => {
      if (m[1] === designed.id) throw new UI.ApiError("Die Bildkarten „Noah“ sind in ihrer neuen Gestaltung noch nicht als PDF gedruckt – bitte die Seite neu laden, dann druckt Unterricks sie.", 409, { code: "cards_not_printed" });
      return { url: "/api/dl/" + m[1] + (b && b.print ? "?p=pr" : "") };
    }],
    [/^POST \/api\/teacher\/files\/(\w+)\/render$/, () => new Promise(() => {})]];   // der Drucker druckt noch
  if (globalThis.__leave) globalThis.__leave();
  DR.resetPrintQueue();
  const calls = server(routes);
  const st = { files: [uploaded, designed] };
  let box = null;
  const sync = async () => { st.files = (await globalThis.__tapi("GET", "/api/teacher/lessons/" + fid(99))).files; box.paintPrint(); };
  // course wie auf der Sitzungsseite der Grundschule (gssession.js) – das Sitzungspaket (Nachtrag 42) trägt den Kurs im Namen wie seine Dateien
  box = MB.materialBox({ lessonId: fid(99), st, L: () => ({ subject: "gs", klass: "gsx", date: "2026-11-24" }), gs: true, exclude: (f) => f.cards != null, printCopies: () => 22, beforeZip: sync, groupLabel: "Grundschule - Religion 2ab", course: "Reli2" });
  const app = document.getElementById("app");
  for (const x of [...app.childNodes]) app.removeChild(x);
  app.append(box.filesCard, box.printCard);
  const orig = URL.createObjectURL; URL.createObjectURL = (b) => { blobs.push(b); return "blob:x"; };
  try {
    await D.sleep(10);
    assert.equal($$("#printcard .printrow").length, 2, "vor dem Packen: zwei Bildkarten");
    D.userClick(button($("#printcard"), "Alle herunterladen (ZIP)"));
    await until(() => blobs.length === 1, "ZIP heruntergeladen");
    assert.equal(lessonGets, 1, "Stand vom Server geholt");
    assert.equal($$("#printcard .printrow").length, 3, "die neuen Bildkarten stehen jetzt in der Liste");
    const links = calls.filter((x) => x.path.endsWith("/link"));
    assert.ok(links.length === 3 && links.every((x) => x.body && x.body.print === true), "Bildkarten immer mit print (der Server prüft die Gestaltung)");
    const { readZip } = await import("../../public/zip.js");
    const entries = await readZip(new Uint8Array(await blobs[0].arrayBuffer()));
    // Nachtrag 42 (geänderte Erwartung, vorher die beiden Dateien einzeln): gleiche Druckangaben (1x, farbig, einseitig) → EIN Sitzungspaket; die neuen Bildkarten
    // dabei, die alte Gestaltung nicht; ohne Verweise im Verlaufsplan in der Reihenfolge der Druckliste (Verlag, dann Arche)
    assert.deepEqual(entries.map((e) => e.name), ["1x - farbig - einseitig - Reli2 - Sitzungspaket.pdf"], "neue Bildkarten im Sitzungspaket, die alte Gestaltung nicht");
    const up = await lib.PDFDocument.load(entries[0].data);
    assert.deepEqual(up.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]), Array(6).fill([842, 595]), "hochgeladene A5-Karten: alle 4 auf A4 quer, dahinter die 2 Seiten von „Arche“ (einseitig: keine Leerseite)");
    assert.equal($("#print-zip-note").textContent, "Nicht in der ZIP-Datei – die Bildkarten „1x - farbig - einseitig - Reli2 - Noah.pdf“ (wird gerade als PDF gedruckt – bitte gleich noch einmal herunterladen).");
    assert.ok(!$("#print-zip-note").classList.contains("hidden"));
    const noah = $$("#printcard .printrow").find((r) => r.textContent.includes("Noah.pdf"));
    assert.ok(!button(noah, "Herunterladen") && /wird als PDF gedruckt/.test(noah.textContent), "Zeile: neue Gestaltung wird gedruckt, kein Download der alten Karten – " + noah.textContent);
    // Einzel-Download hochgeladener Bildkarten: ebenfalls auf A4, als Datei unter dem Namen der Druckliste
    blobs.length = 0;
    const verlag = $$("#printcard .printrow").find((r) => r.textContent.includes("Verlag.pdf"));
    D.userClick(button(verlag, "Herunterladen"));
    await until(() => blobs.length === 1, "Einzel-Download");
    const one = await lib.PDFDocument.load(new Uint8Array(await blobs[0].arrayBuffer()));
    assert.ok(one.getPageCount() === 4 && one.getPages().every((p) => Math.round(p.getWidth()) === 842 && Math.round(p.getHeight()) === 595), "Einzel-Download: 4 Seiten A4 quer");
  } finally { globalThis.fetch = real; URL.createObjectURL = orig; }
});

test("Prüfung: „Druckaufträge für den nächsten Arbeitstag“ – Bildkarten mit print (nie die alte Gestaltung, sonst genannt), hochgeladene auf A4, unter dem Namen der Druckliste", async () => {
  const lib = await import("pdf-lib");
  const UI = await import("../../public/ui.js");
  const a5 = await lib.PDFDocument.create(); for (let i = 0; i < 3; i++) a5.addPage([595.28, 419.53]).drawRectangle({ x: 20, y: 20, width: 100, height: 80, color: lib.rgb(0.2, 0.4, 0.8) });
  const a5bytes = await a5.save();
  const up = { ...cardFile(11, "Verlag.pdf"), lessonId: fid(98) }, des = { ...cardFile(12, "Noah.pdf", { source: "claude", design: { outdated: false, error: null, htmlAt: 5, pdfAt: 5, text: "" } }), lessonId: fid(98) };
  const sessions = [{ id: fid(98), school: "gs", subject: "gs", klass: "gsx", label: "Religion 2ab", course: { short: "Religion 2ab" }, title: "Noah", startTime: "08:00", files: [up, des] }];
  const bodies = [], blobs = [];
  let loads = 0, later = null;
  if (globalThis.__leave) globalThis.__leave();
  DR.resetPrintQueue();
  globalThis.__tapi = async (method, path, o = {}) => {
    if (method === "GET" && path === "/api/teacher/print-next") { loads++; return { today: "2026-11-23", candidate: "2026-11-24", date: "2026-11-24", sessions: later || sessions, freeDays: [] }; }
    const m = /^\/api\/teacher\/files\/(\w+)\/link$/.exec(path);
    if (method === "POST" && m) {
      bodies.push([m[1], o.body]);
      if (m[1] === des.id) throw new UI.ApiError("Die Bildkarten „Noah“ sind in ihrer neuen Gestaltung noch nicht als PDF gedruckt – bitte die Seite neu laden, dann druckt Unterricks sie.", 409, { code: "cards_not_printed" });
      return { url: "/api/dl/" + m[1] };
    }
    throw new UI.ApiError("nicht nachgebildet: " + method + " " + path, 404, { code: "not_found" });
  };
  const io0 = { ...PN.io };
  Object.assign(PN.io, { blob: (b, n) => blobs.push([b, n]), fetch: async () => ({ ok: true, status: 200, arrayBuffer: async () => a5bytes.buffer.slice(a5bytes.byteOffset, a5bytes.byteOffset + a5bytes.byteLength) }) });
  const app = document.getElementById("app");
  for (const x of [...app.childNodes]) app.removeChild(x);
  const card = PN.printNextCard();
  app.append(card);
  try {
    await until(() => $$(".pn-row", card).length === 2, "zwei Zeilen");
    const row = $$(".pn-row", card).find((r) => r.textContent.includes("Verlag.pdf"));
    D.userClick($("button.pn-dl", row));
    await until(() => blobs.length === 1, "Einzel-Download");
    assert.equal(blobs[0][1], "1x - farbig - einseitig - Reli2 - Verlag.pdf");
    const one = await lib.PDFDocument.load(new Uint8Array(await blobs[0][0].arrayBuffer()));
    assert.ok(one.getPageCount() === 3 && one.getPages().every((p) => Math.round(p.getWidth()) === 842 && Math.round(p.getHeight()) === 595), "hochgeladene A5-Karten: 3 Seiten A4 quer");
    // „Alle Dateien herunterladen“ lädt in der Grundschule zuerst neu: Bildkarten, die Claude seit dem Öffnen der Startseite angelegt hat, sind dabei;
    // die neu gestalteten (Server: noch nicht gedruckt) fehlen nicht stillschweigend
    later = [{ ...sessions[0], files: [up, des, { ...cardFile(13, "Arche.pdf"), lessonId: fid(98) }] }];
    blobs.length = 0;
    D.userClick($("button.pn-all", card));
    await until(() => /^Fertig|^Keine|Nicht heruntergeladen|Nicht in der ZIP-Datei/.test($("#pn-status", card).textContent) && blobs.length >= 1, "fertig");
    assert.equal(loads, 2, "vorher neu geladen");
    assert.equal($$(".pn-row", card).length, 3, "die neuen Bildkarten stehen jetzt auch in der Liste");
    assert.ok(bodies.every(([, b]) => b && b.print === true), "Bildkarten immer mit print");
    // Nachtrag 36: eine ZIP-Datei des Tages – die hochgeladenen Karten darin ebenfalls auf A4
    assert.equal(blobs.length, 1, "eine ZIP-Datei");
    assert.match(blobs[0][1], /^Druckaufträge - \S+, \d\d\.\d\d\.\d{4}\.zip$/);
    const { readZip } = await import("../../public/zip.js");
    const entries = await readZip(new Uint8Array(await blobs[0][0].arrayBuffer()));
    assert.deepEqual(entries.map((e) => e.name), ["1x - farbig - einseitig - Reli2 - Verlag.pdf", "1x - farbig - einseitig - Reli2 - Arche.pdf"]);
    const inZip = await lib.PDFDocument.load(entries[0].data);
    assert.ok(inZip.getPageCount() === 3 && inZip.getPages().every((p) => Math.round(p.getWidth()) === 842 && Math.round(p.getHeight()) === 595), "in der ZIP-Datei: 3 Seiten A4 quer");
    assert.ok($("#pn-status", card).textContent.includes("Nicht in der ZIP-Datei: „1x - farbig - einseitig - Reli2 - Noah.pdf“ (Die Bildkarten „Noah“ sind in ihrer neuen Gestaltung noch nicht als PDF gedruckt"), $("#pn-status", card).textContent);
  } finally { Object.assign(PN.io, io0); }
});
