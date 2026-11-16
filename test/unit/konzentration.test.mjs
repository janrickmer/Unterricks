// Nachtrag 27 (15.11.2026): „Konzentrationsaufgabe“ in jeder geplanten Sitzung der Grundschule – für Kinder, die in Plenumsphasen den Sitzkreis
// verlassen und beim Zuhören ausmalen. Prompt „Stunde mit Claude planen“ (Grundschule) und Überarbeitung der Einheit, get_lesson (gibt es sie schon?),
// add_material_pdf (immer nur Druckliste: 5x, beidseitig, schwarz-weiß; mehr als zwei Seiten → Hinweis), save_verlaufsplan (Erinnerung), nie in der
// Elternansicht. Gymnasium bleibt unverändert; die MCP-Anweisungen werden nicht länger.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const { fakeCtx } = await import("./fake-d1.mjs");
const GS = await import("../../worker/gs.js");
const L = await import("../../worker/lessons.js");
const F = await import("../../worker/files.js");
const PA = await import("../../worker/parents.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");
const S = await import("../../public/shared.js");
const P = await import("../../public/planning.js");
const SL = await import("../../public/selbstlern.js");
const G = await import("../../public/gsplanning.js");
const FX = await import("./stop-fixtures.mjs");

/* ---------- reine Bausteine ---------- */
test("Name und Titel: erkennt die Konzentrationsaufgabe (auch Varianten), Titel einheitlich „Konzentrationsaufgabe – <Thema>“, Name auf der Druckliste", () => {
  for (const n of ["Konzentrationsaufgabe – Josef.pdf", "konzentrationsaufgabe", "  Konzentrations-Aufgabe: Josef", "KONZENTRATIONSAUFGABE Noah", "Konzentrations Aufgabe – x"]) assert.ok(G.isConcName(n), n);
  for (const n of ["Konzentrationsaufgaben.pdf", "Arbeitsblatt Konzentrationsaufgabe", "", null, undefined, 5, "Konzentration"]) assert.ok(!G.isConcName(n), String(n));
  assert.equal(G.concTitleOf("Konzentrationsaufgabe – Josef in Ägypten", "x"), "Konzentrationsaufgabe – Josef in Ägypten");
  assert.equal(G.concTitleOf("Konzentrations-Aufgabe: Josef  in Ägypten.pdf", "x"), "Konzentrationsaufgabe – Josef in Ägypten");
  assert.equal(G.concTitleOf("Konzentrationsaufgabe", "Die Schöpfung"), "Konzentrationsaufgabe – Die Schöpfung", "ohne Thema: das der Sitzung");
  assert.equal(G.concTitleOf("konzentrationsaufgabe -", ""), "Konzentrationsaufgabe");
  // Druckliste: der Gedankenstrich bleibt im Namen (printBase ersetzt nur unzulässige Zeichen)
  assert.equal(S.printFileName({ name: "Konzentrationsaufgabe – Josef in Ägypten.pdf", copies: G.CONC_PRINT.copies, duplex: G.CONC_PRINT.duplex, color: G.CONC_PRINT.color }),
    "5x - beidseitig - sw - Konzentrationsaufgabe – Josef in Ägypten.pdf");
  assert.deepEqual(G.CONC_PRINT, { copies: 5, duplex: true, color: false });
  assert.equal(G.CONC_PAGES_MAX, 2);
});

test("Regeln: höchstens zwei A4-Seiten, mindestens zwei Ausmalbilder zum Unterrichtsinhalt, rote Karte (SVG, kein Emoji), danach eine Aufgabe mit wenig Lesen", () => {
  const r = G.CONC_RULES.join("\n");
  for (const s of ["Höchstens zwei DIN-A4-Seiten", "@page { size: A4; margin: 12mm }", "height: 272mm, overflow: hidden und break-after: page (der letzte ohne)", "nichts darf auf eine dritte Seite laufen",
    "„Konzentrationsaufgabe – <Thema der Stunde>“", "Zuerst mindestens zwei Ausmalbilder, die den aktuellen Unterrichtsinhalt zeigen, in der Reihenfolge der Stunde", "Bilder zur Geschichte, die die Lehrkraft erzählt",
    "kräftigen schwarzen Konturen", "keine grauen oder farbigen Füllungen", "ohne Text verständlich", "Danach das Symbol einer roten Karte", "abgerundeten Ecken", "rot gefüllt", "aria-label=\"Rote Karte\"", "kein Emoji",
    "Erst nach der roten Karte eine weitere, altersgerechte Aufgabe, die den Inhalt dieser Stunde abfragt", "ankreuzen, verbinden, malen oder ein einzelnes Wort schreiben"]) assert.ok(r.includes(s), s);
  // Reihenfolge wie von der Lehrkraft vorgegeben: Seiten, Ausmalbilder, rote Karte, Aufgabe
  assert.ok(r.indexOf("Höchstens zwei") < r.indexOf("Ausmalbilder") && r.indexOf("Ausmalbilder") < r.indexOf("roten Karte") && r.indexOf("Danach das Symbol") < r.indexOf("Erst nach der roten Karte"));
  // Zweck im Wortlaut der Lehrkraft
  assert.ok(G.CONC_WHY.startsWith("In jeder Klasse gibt es Kinder, die ihre Aufmerksamkeit nur bündeln können, wenn sie in Plenumsphasen den Sitzkreis verlassen und während des Zuhörens etwas ausmalen."));
  assert.ok(G.concSaveArgs("Josef").includes("`bereich` \"druck\", `anzahl` 5, `beidseitig` true, `farbe` false") && G.concSaveArgs("Josef").includes("hier z. B. „Konzentrationsaufgabe – Josef“") && !G.concSaveArgs("").includes("hier z. B."));
  assert.ok(G.concWhere(true).includes("meiner Druckliste („5x - beidseitig - sw - Konzentrationsaufgabe – ….pdf“), nie bei Eltern oder Kindern.") && G.concWhere().includes("der Druckliste der Lehrkraft"));
});

test("Prompt „Stunde mit Claude planen“ (Grundschule): eigener Abschnitt mit Zweck und Regeln, Speicherschritt (druck, 5, beidseitig, sw) vor dem Verlaufsplan, im Verlaufsplan genannt", () => {
  const g = FX.gsCtx(P.unitContext), p = G.claudeGsLessonPrompt(g);
  const sec = p.slice(p.indexOf("## Konzentrationsaufgabe (gehört zu jeder Sitzung)"), p.indexOf("## Vorgehen"));
  assert.ok(sec.length > 200, "Abschnitt vor „## Vorgehen“");
  for (const s of [G.CONC_WHY, "Gestalte deshalb zusammen mit dem übrigen Material dieser Sitzung die „Konzentrationsaufgabe“", "stelle sie mir mit dem übrigen Material vor", "Ich drucke sie 5-mal beidseitig in Schwarz-Weiß aus; sie ist nur für mich.",
    "Hat die Sitzung schon eine (siehe `get_lesson`), passe sie an, statt eine zweite anzulegen.", ...G.CONC_RULES.map((r) => "- " + r)]) assert.ok(sec.includes(s), s);
  const v = p.slice(p.indexOf("## Vorgehen"));
  const step = v.slice(v.indexOf("   - Die Konzentrationsaufgabe speicherst du mit"), v.indexOf("   - Den Stundenverlauf speicherst du"));
  for (const s of ["`add_material_pdf` (`bereich` \"druck\", `anzahl` 5, `beidseitig` true, `farbe` false, `titel` „Konzentrationsaufgabe – <Thema der Stunde>“, hier z. B. „Konzentrationsaufgabe – Josef in Ägypten“)",
    "Dann steht sie nur auf meiner Druckliste („5x - beidseitig - sw - Konzentrationsaufgabe – ….pdf“), nie bei Eltern oder Kindern.", "Im Verlaufsplan steht sie in der ersten Plenumsphase als eigener Stichpunkt",
    "„- Konzentrationsaufgabe [[pdf:<file_id>]] für Kinder, die beim Zuhören am Platz ausmalen“"]) assert.ok(step.includes(s), s);
  assert.ok(v.indexOf("`add_picture_cards`") < v.indexOf("Die Konzentrationsaufgabe speicherst du") && v.indexOf("Die Konzentrationsaufgabe speicherst du") < v.indexOf("`save_verlaufsplan`"), "nach den Bildkarten, vor dem Verlaufsplan (file_id für den Verweis)");
  // Thema der Sitzung (topic) geht vor dem Titel; ohne beides nur der Platzhalter
  assert.ok(G.claudeGsLessonPrompt({ ...g, lesson: { ...g.lesson, topic: "Josef deutet Träume" } }).includes("hier z. B. „Konzentrationsaufgabe – Josef deutet Träume“"));
  assert.ok(!G.claudeGsLessonPrompt({ ...g, lesson: { ...g.lesson, title: "", topic: "" } }).includes("hier z. B. „Konzentrationsaufgabe"));
  // mit Zwischenstopp der vorigen Stunde: Abschnitt und Schritt bleiben (genau einmal)
  const ps = G.claudeGsLessonPrompt({ ...g, previousStop: { title: "Vorige", date: "2026-11-10", portal: "**1) A**\n" + S.STOP_LINE + "\n**2) B**" } });
  assert.equal(ps.split("## Konzentrationsaufgabe").length - 1, 1); assert.equal(ps.split("Die Konzentrationsaufgabe speicherst du").length - 1, 1);
});

test("Überarbeitung der Einheit (Grundschule): Schritt 5 nennt die Konzentrationsaufgabe; Gymnasium, Einheitsplanung und Selbstlern-Phase ohne sie", () => {
  const rev = G.claudeUnitRevisionPrompt({ unit: { id: "u".repeat(16), rows: [], plan: {}, params: {}, revise: { items: [] }, lessons: [] }, now: Date.parse("2026-11-02T10:00:00Z") });
  assert.equal(rev.split(G.CONC_REVISION).length - 1, 1);
  // Nachtrag 31: danach folgt der Satz zu Bildkarten (CARDS_REVISION) – Schritt 5 endet jetzt mit ihm
  assert.ok(rev.includes("„Zusammenfassung der Sitzung für die Lehrkraft“)." + G.CONC_REVISION + G.CARDS_REVISION + "\n"), "am Ende von Schritt 5");
  assert.ok(G.CONC_REVISION.includes("gehört auch ihre „Konzentrationsaufgabe“ dazu") && G.CONC_REVISION.includes("sagt `get_lesson` dieser Sitzung"));
  const s = FX.sekCtx(P.unitContext), u = { id: "u".repeat(16), subject: "powi", klass: "8B", rows: [], plan: {}, params: {}, revise: { items: [] }, lessons: [] };
  for (const [n, p] of [["Gymnasium", P.claudeLessonPrompt(s)], ["Jg. 6", P.claudeLessonPrompt({ ...s, klass: "6B", unit: null, row: null, unitText: "" })], ["Selbstlern-Phase", SL.claudeSelbstlernPrompt({ ...s, row: null })],
    ["Einheit Gymnasium", P.claudeUnitPrompt({ unitId: u.id, subject: "powi", klass: "8B", params: {}, slots: [], bases: [], missing: [] })], ["Überarbeitung Gymnasium", P.claudeGymRevisionPrompt({ unit: u, now: Date.now() })],
    ["Einheit Grundschule", G.claudeGsUnitPrompt({ unitId: u.id, course: { subjectName: "Religion" }, params: {}, slots: [] })]]) assert.ok(!/Konzentrationsaufgabe/.test(p), n);
});

test("get_lesson-Abschnitt: fehlt → Zweck, Ablage und Aufbau; vorhanden → Druckliste und Seiten; falscher Bereich, zu viele Seiten und mehrere gemeldet", () => {
  const miss = G.concSection([{ id: "a".repeat(16), name: "Arbeitsblatt.pdf", area: "student" }], "Josef", S.printFileName).join("\n");
  assert.ok(miss.startsWith("\n## Konzentrationsaufgabe (gehört zu jeder Sitzung der Grundschule; nur für die Lehrkraft)\nFehlt noch. " + G.CONC_WHY));
  for (const s of [G.concSaveArgs("Josef") + " ab. " + G.concWhere(), "Aufbau:", ...G.CONC_RULES.map((r) => "- " + r)]) assert.ok(miss.includes(s), s);
  const f = { id: "b".repeat(16), name: "Konzentrationsaufgabe – Josef.pdf", area: "print", status: "ready", pages: 2, designed: 1, print_copies: 5, print_duplex: 1, print_color: 0 };
  let t = G.concSection([f], "Josef", S.printFileName).join("\n");
  assert.ok(t.includes("- file_id " + f.id + ": „Konzentrationsaufgabe – Josef.pdf“ (auf der Druckliste als „5x - beidseitig - sw - Konzentrationsaufgabe – Josef.pdf“; 2 Seiten) → [[pdf:" + f.id + "]]"), t);
  assert.ok(!t.includes("Fehlt noch") && !t.includes("Achtung") && t.endsWith("Ändert sich der Inhalt der Stunde, passe sie an (add_material_pdf mit ihrer file_id)."));
  t = G.concSection([{ ...f, pages: 3 }, { ...f, id: "c".repeat(16), area: "student", designed: 0, status: "pending", pages: null }, { ...f, id: "d".repeat(16), area: "archive" }], "Josef", S.printFileName).join("\n");
  assert.ok(t.includes("  Achtung: 3 Seiten – höchstens 2 A4-Seiten; kürze sie (add_material_pdf mit file_id " + f.id + ")."), t);
  assert.ok(t.includes("Achtung: liegt nicht auf der Druckliste, sondern beim Material für die Kinder – Eltern sehen sie nach der Stunde; sie gehört nur auf die Druckliste – sag es der Lehrkraft; wartet auf den Druck"), t);
  assert.ok(t.includes("Es gibt 2 Konzentrationsaufgaben") && !t.includes("d".repeat(16)), "archivierte zählen nicht");
  // von der Lehrkraft hochgeladen (nicht gestaltet): kein Hinweis auf add_material_pdf
  t = G.concSection([{ ...f, designed: 0, pages: 4 }], "", S.printFileName).join("\n");
  assert.ok(t.includes("Achtung: 4 Seiten – höchstens 2 A4-Seiten (von der Lehrkraft hochgeladen).") && !t.includes("passe sie an"), t);
});

/* ---------- Connector mit der D1-Nachbildung ---------- */
const TOKEN = "lehrkraft-token-123";
const PDF = (pages) => new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Count " + pages + " /Kids [] >> endobj\n%%EOF");
let printerPages = 2;
async function setup() {
  const c = fakeCtx({ RENDER_MOCK_URL: "http://127.0.0.1:9/pdf", RENDER_GAP_MS: "0", PARENT_SECRET: "x" });
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const req = new Request("https://unterricks.test/x", { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ grade: 2, classes: ["a", "b"], religion: true, weekdays: [{ day: 2, minutes: 45, time: "08:00" }], classSize: 22 }) });
  const k = (await (await GS.routeGsCourseCreate({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} })).json()).course;
  const day = new Date(c.now - 3 * 864e5).toISOString().slice(0, 10);   // vorbei: Eltern sähen das Material
  const l = await L.createLesson(c.db, { subject: "gs", klass: k.id, title: "Josef in Ägypten", date: day, startTime: "08:00", durationMin: 45 }, c.now);
  const sek = await L.createLesson(c.db, { subject: "powi", klass: "8B", title: "Gewaltenteilung", date: day }, c.now + 1);
  const mcp = async (name, args) => {
    const r = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: name ? "tools/call" : name === null ? "tools/list" : "initialize",
      params: name ? { name, arguments: args } : name === null ? {} : { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }) });
    return (await (await routeMcp({ ...c, request: r, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
  };
  return { c, k, l, sek, mcp };
}
// Drucker-Attrappe (RENDER_MOCK_URL): liefert eine PDF mit printerPages Seiten
const orig = globalThis.fetch;
globalThis.fetch = async (url, init) => (String(url).startsWith("http://127.0.0.1:9/") ? new Response(PDF(printerPages)) : orig(url, init));
test.after(() => { globalThis.fetch = orig; });

test("add_material_pdf (Grundschule): Konzentrationsaufgabe immer nur auf der Druckliste – 5x, beidseitig, sw; Antwort mit Druck-Namen und Seiten; Abweichungen gemeldet", async () => {
  const { c, l, sek, mcp } = await setup();
  printerPages = 2;
  let r = await mcp("add_material_pdf", { lesson_id: l.id, bereich: "druck", titel: "Konzentrationsaufgabe – Josef in Ägypten", html: "<h1>x</h1>", anzahl: 5, beidseitig: true, farbe: false });
  const id = r.structuredContent.file_id;
  let f = await F.getFile(c.db, id);
  assert.deepEqual([f.area, f.name, f.print_copies, f.print_duplex, f.print_color, f.pages], ["print", "Konzentrationsaufgabe – Josef in Ägypten.pdf", 5, 1, 0, 2]);
  assert.equal(r.content[0].text, "„Konzentrationsaufgabe – Josef in Ägypten.pdf“ gespeichert und als PDF gedruckt: 2 Seiten, 1 KB, in der Liste „Von der Lehrkraft auszudrucken“ als " +
    "„5x - beidseitig - sw - Konzentrationsaufgabe – Josef in Ägypten.pdf“ – nie für Eltern oder Kinder. Ändern: add_material_pdf mit file_id " + id + ". Verweis im Verlaufsplan: [[pdf:" + id + "]].");
  assert.deepEqual([r.structuredContent.konzentrationsaufgabe, r.structuredContent.zu_lang], [true, false]);
  // Claude nimmt aus Gewohnheit die Schülerzahl und „für die Kinder“: Unterricks legt sie trotzdem nur auf die Druckliste (5x, beidseitig, sw), Titel einheitlich
  const { c: c2, l: l2, mcp: mcp2 } = await setup();
  r = await mcp2("add_material_pdf", { lesson_id: l2.id, bereich: "schueler", titel: "Konzentrations-Aufgabe: Josef", html: "<h1>x</h1>", anzahl: 22, farbe: true });
  f = await F.getFile(c2.db, r.structuredContent.file_id);
  assert.deepEqual([f.area, f.name, f.print_copies, f.print_duplex, f.print_color], ["print", "Konzentrationsaufgabe – Josef.pdf", 5, 1, 0]);
  assert.ok(r.content[0].text.includes("„5x - beidseitig - sw - Konzentrationsaufgabe – Josef.pdf“ – nie für Eltern oder Kinder") &&
    r.content[0].text.includes("(Die Konzentrationsaufgabe legt Unterricks immer so auf die Druckliste: 5x, beidseitig, schwarz-weiß – die Lehrkraft kann das in der Sitzung ändern.)"), r.content[0].text);
  // ohne bereich: Druckliste
  r = await mcp2("add_material_pdf", { lesson_id: l2.id, titel: "Konzentrationsaufgabe", html: "<h1>x</h1>" });
  f = await F.getFile(c2.db, r.structuredContent.file_id);
  assert.deepEqual([f.area, f.name, f.print_copies], ["print", "Konzentrationsaufgabe – Josef in Ägypten.pdf", 5], "Titel ohne Thema: das der Sitzung");
  assert.ok(r.content[0].text.includes("Achtung: Diese Sitzung hat jetzt 2 Konzentrationsaufgaben") && r.content[0].text.includes("überzählige kann nur die Lehrkraft in der Sitzung löschen"), r.content[0].text);
  // mehr als zwei Seiten: gespeichert, aber gemeldet
  printerPages = 3;
  r = await mcp("add_material_pdf", { lesson_id: l.id, titel: "Konzentrationsaufgabe – Josef in Ägypten", html: "<h1>lang</h1>", file_id: id });
  assert.ok(r.content[0].text.includes("überarbeitet und als PDF gedruckt: 3 Seiten") && r.content[0].text.includes("Achtung: Die Konzentrationsaufgabe hat 3 Seiten – sie soll auf höchstens 2 A4-Seiten passen (beidseitig gedruckt ein Blatt). " +
    "Bitte kürzen und mit add_material_pdf (file_id " + id + ") erneut senden."), r.content[0].text);
  assert.equal(r.structuredContent.zu_lang, true);
  // Überarbeiten behält die Druckeinstellung der Lehrkraft (sie hat 6 eingestellt), auch wenn Claude andere schickt; bereich wird ignoriert
  await c.db.prepare("UPDATE files SET print_copies=6 WHERE id=?1").bind(id).run();
  printerPages = 2;
  r = await mcp("add_material_pdf", { lesson_id: l.id, bereich: "schueler", titel: "Ausmalbilder Josef", html: "<h1>kurz</h1>", file_id: id, anzahl: 22 });
  f = await F.getFile(c.db, id);
  assert.ok(!r.isError, r.content[0].text);
  assert.deepEqual([f.area, f.print_copies, f.name, f.pages], ["print", 6, "Konzentrationsaufgabe – Ausmalbilder Josef.pdf", 2], "bleibt die Konzentrationsaufgabe (Titel), Einstellung der Lehrkraft bleibt");
  assert.ok(!r.content[0].text.includes("Achtung: Die Konzentrationsaufgabe hat"));
  // ein Arbeitsblatt der Kinder lässt sich nicht in die Konzentrationsaufgabe umbenennen (Eltern sähen es)
  const ab = (await mcp("add_material_pdf", { lesson_id: l.id, bereich: "schueler", titel: "Arbeitsblatt Josef", html: "<h1>AB</h1>", anzahl: 22 })).structuredContent.file_id;
  r = await mcp("add_material_pdf", { lesson_id: l.id, titel: "Konzentrationsaufgabe – Josef", html: "<h1>x</h1>", file_id: ab });
  assert.ok(r.isError && r.content[0].text.startsWith("Die Konzentrationsaufgabe gehört nur auf die Druckliste der Lehrkraft (nie für Eltern oder Kinder) – dieses Material liegt beim Material für die Kinder."), r.content[0].text);
  assert.equal((await F.getFile(c.db, ab)).name, "Arbeitsblatt Josef.pdf");
  // Gymnasium: unverändert (kein Sonderfall, kein Verweis)
  r = await mcp("add_material_pdf", { lesson_id: sek.id, bereich: "schueler", titel: "Konzentrationsaufgabe", html: "<h1>x</h1>", anzahl: 5 });
  f = await F.getFile(c.db, r.structuredContent.file_id);
  assert.deepEqual([f.area, f.print_copies, f.name], ["student", null, "Konzentrationsaufgabe.pdf"]);
  assert.ok(!r.content[0].text.includes("[[pdf:") && !r.content[0].text.includes("nie für Eltern") && r.structuredContent.konzentrationsaufgabe === undefined);
});

test("get_lesson, save_verlaufsplan und Elternansicht: fehlt → Erinnerung; vorhanden, aber nicht im Verlaufsplan → Hinweis; Eltern sehen sie nie (auch nicht verwiesen)", async () => {
  const { c, k, l, mcp } = await setup();
  printerPages = 2;
  let t = (await mcp("get_lesson", { lesson_id: l.id })).content[0].text;
  assert.ok(t.includes("\n## Konzentrationsaufgabe (gehört zu jeder Sitzung der Grundschule; nur für die Lehrkraft)\nFehlt noch. ") && t.includes(G.concSaveArgs("Josef in Ägypten")) && t.includes("- " + G.CONC_RULES[0]), t);
  const ab = (await mcp("add_material_pdf", { lesson_id: l.id, bereich: "schueler", titel: "Arbeitsblatt Josef", html: "<h1>AB</h1>", anzahl: 22 })).structuredContent.file_id;
  // Verlaufsplan ohne Konzentrationsaufgabe: Erinnerung (vor der an die Zusammenfassung)
  let r = await mcp("save_verlaufsplan", { lesson_id: l.id, text: "**1) Erzählung (15 Min., Sitzkreis)**\n**2) Arbeitsblatt (15 Min.)**\n- [[pdf:" + ab + "]]", base_version: 0 });
  // Nachtrag 31: „Erzählung“ ohne Bildkarten → zusätzlich die Erinnerung an Bildkarten (zwischen Konzentrationsaufgabe und Zusammenfassung)
  assert.ok(r.content[0].text.includes("Eltern sehen nach der Stunde: „Arbeitsblatt Josef.pdf“." + G.concMissingText("Josef in Ägypten") + G.cardsMissingText("1) Erzählung (15 Min., Sitzkreis)") + " Schreibe zum Schluss auch die „"), r.content[0].text);
  assert.equal(r.structuredContent.konzentrationsaufgabe, false);
  const cid = (await mcp("add_material_pdf", { lesson_id: l.id, bereich: "druck", titel: "Konzentrationsaufgabe – Josef in Ägypten", html: "<h1>x</h1>", anzahl: 5, beidseitig: true, farbe: false })).structuredContent.file_id;
  t = (await mcp("get_lesson", { lesson_id: l.id })).content[0].text;
  assert.ok(t.includes("- file_id " + cid + ": „Konzentrationsaufgabe – Josef in Ägypten.pdf“ (auf der Druckliste als „5x - beidseitig - sw - Konzentrationsaufgabe – Josef in Ägypten.pdf“; 2 Seiten) → [[pdf:" + cid + "]]") && !t.includes("Fehlt noch"), t);
  // vorhanden, aber nicht im Verlaufsplan
  r = await mcp("save_verlaufsplan", { lesson_id: l.id, text: "**1) Erzählung (15 Min., Sitzkreis)**\n**2) Arbeitsblatt (15 Min.)**\n- [[pdf:" + ab + "]]", base_version: 1 });
  assert.ok(r.content[0].text.includes("Eltern sehen nach der Stunde: „Arbeitsblatt Josef.pdf“." + G.concUnplannedText([cid])) && !r.content[0].text.includes("fehlt in dieser Sitzung noch (für Kinder"), r.content[0].text);
  // im Verlaufsplan verwiesen: keine Erinnerung; Eltern sehen nur das Arbeitsblatt
  const PLAN = "**1) Erzählung (15 Min., Sitzkreis)**\n- " + G.CONC_TITLE + " [[pdf:" + cid + "]] für Kinder, die beim Zuhören am Platz ausmalen\n**2) Arbeitsblatt (15 Min.)**\n- [[pdf:" + ab + "]]";
  r = await mcp("save_verlaufsplan", { lesson_id: l.id, text: PLAN, base_version: 2 });
  assert.ok(!r.isError && r.content[0].text.includes("Eltern sehen nach der Stunde: „Arbeitsblatt Josef.pdf“.") && !r.content[0].text.includes("Konzentrationsaufgabe"), r.content[0].text);
  assert.deepEqual([r.structuredContent.konzentrationsaufgabe, r.structuredContent.unknown_refs, r.structuredContent.later_refs], [true, [], []]);
  // Elternansicht (Prüfung parentFiles, Nutzlast und Vorschau der Lehrkraft): nie die Konzentrationsaufgabe
  const lesson = await L.getLesson(c.db, l.id), course = GS.gsCourseOut(await GS.getGsCourse(c.db, k.id));
  assert.deepEqual((await PA.parentFiles(c, lesson)).files.map((f) => f.id), [ab]);
  for (const preview of [false, true]) {
    const v = await PA.parentView(c, lesson, course, { preview });
    assert.equal(v.state, "open");
    assert.ok(!JSON.stringify(v).includes(cid) && !JSON.stringify(v).includes("Konzentrationsaufgabe"), JSON.stringify(v));
  }
  t = (await mcp("get_lesson", { lesson_id: l.id })).content[0].text;
  assert.ok(t.includes("Eltern sehen nach der Stunde: „Arbeitsblatt Josef.pdf“\n"), t);
  // Druckaufträge für den nächsten Arbeitstag und Druckliste: Name wie dort (lessonOut/fileOut)
  const o = L.fileOut(await F.getFile(c.db, cid));
  assert.equal(o.printName, "5x - beidseitig - sw - Konzentrationsaufgabe – Josef in Ägypten.pdf");
  // Ausfall-Eintrag: kein Abschnitt
  await c.db.prepare("UPDATE lessons SET cancelled=1 WHERE id=?1").bind(l.id).run();
  assert.ok(!(await mcp("get_lesson", { lesson_id: l.id })).content[0].text.includes("## Konzentrationsaufgabe"));
});

test("Werkzeuge und Anweisungen: Beschreibungen von add_material_pdf und save_verlaufsplan nennen sie; die MCP-Anweisungen werden nicht länger (gekürzte Clients)", async () => {
  const { mcp } = await setup();
  const tools = (await mcp(null)).tools, by = (n) => tools.find((t) => t.name === n).description;
  assert.ok(by("add_material_pdf").includes("Zu jeder Sitzung der Grundschule gehört die „Konzentrationsaufgabe“") && by("add_material_pdf").includes("5x, beidseitig, schwarz-weiß; nie für Eltern oder Kinder") &&
    by("add_material_pdf").includes("meldet, wenn sie mehr als 2 Seiten hat"));
  assert.ok(by("save_verlaufsplan").includes("Zu jeder Sitzung gehört die „Konzentrationsaufgabe“ (nur auf der Druckliste der Lehrkraft, siehe get_lesson): nenne sie in der ersten Plenumsphase als eigenen Stichpunkt."));
  const init = await mcp(undefined);
  assert.ok(!init.instructions.includes("Konzentration") && init.instructions.length <= 5724, "Anweisungen ohne neuen Text – höchstens so lang wie vor Nachtrag 27 (5724 Zeichen; jetzt " + init.instructions.length + ")");
});

/* ---------- Prüfbefunde (16.11.2026): weitere Wege, auf denen die Konzentrationsaufgabe bei Eltern landen oder anders auf der Druckliste stehen könnte ---------- */
test("Prüfbefund: als Bildkarten abgelehnt (die sähen Eltern); Rückfall add_print_material ebenfalls 5x, beidseitig, sw; Text-Rückfall in get_lesson ohne [[pdf:]]", async () => {
  const { c, l, sek, mcp } = await setup();
  printerPages = 2;
  // Bildkarten mit dem Titel der Konzentrationsaufgabe: nichts angelegt, Hinweis auf add_material_pdf (druck)
  let r = await mcp("add_picture_cards", { lesson_id: l.id, titel: "Konzentrationsaufgabe – Josef (Ausmalbilder)", html: "<h1>x</h1>", erzaehltexte: ["Josef träumt."] });
  assert.ok(r.isError && r.content[0].text.startsWith("Die Konzentrationsaufgabe legst du nicht als Bildkarten ab – Bildkarten sehen Eltern nach der Stunde") &&
    r.content[0].text.includes("`add_material_pdf` (`bereich` \"druck\", `anzahl` 5, `beidseitig` true, `farbe` false"), r.content[0].text);
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM files WHERE lesson_id=?1").bind(l.id).first()).n, 0, "nichts gespeichert");
  // andere Bildkarten bleiben möglich
  r = await mcp("add_picture_cards", { lesson_id: l.id, titel: "Bildkarten – Josef", html: "<h1>x</h1>", erzaehltexte: ["Josef träumt."] });
  assert.ok(!r.isError, r.content[0].text);
  // Rückfall add_print_material: wie add_material_pdf immer 5x, beidseitig, sw; einheitlicher Titel; Abweichung gemeldet
  r = await mcp("add_print_material", { lesson_id: l.id, titel: "Konzentrationsaufgabe Josef", markdown: "# Ausmalen", anzahl: 22, beidseitig: false });
  const pf = await F.getFile(c.db, r.structuredContent.file_id);
  assert.deepEqual([pf.area, pf.kind, pf.name, pf.print_copies, pf.print_duplex, pf.print_color], ["print", "text", "Konzentrationsaufgabe – Josef", 5, 1, 0]);
  assert.equal(r.content[0].text, "Druckvorlage gespeichert: „5x - beidseitig - sw - Konzentrationsaufgabe – Josef.pdf“ (Liste „Von der Lehrkraft auszudrucken“ – nie für Eltern oder Kinder). " +
    "(Die Konzentrationsaufgabe legt Unterricks immer so auf die Druckliste: 5x, beidseitig, schwarz-weiß – die Lehrkraft kann das in der Sitzung ändern.)");
  // get_lesson: der Text-Rückfall ist da, aber nicht als [[pdf:]] verweisbar
  const g = (await mcp("get_lesson", { lesson_id: l.id })).content[0].text;
  assert.ok(g.includes("- file_id " + pf.id + ": „Konzentrationsaufgabe – Josef“ (auf der Druckliste als „5x - beidseitig - sw - Konzentrationsaufgabe – Josef.pdf“; fertig) – Druckvorlage als Text (Rückfall, ohne Ausmalbilder; im Verlaufsplan nicht verweisbar)") &&
    !g.includes("[[pdf:" + pf.id + "]]"), g);
  // Gymnasium: add_print_material unverändert
  r = await mcp("add_print_material", { lesson_id: sek.id, titel: "Konzentrationsaufgabe", markdown: "# x", anzahl: 22, beidseitig: false });
  assert.equal(r.content[0].text, "Druckvorlage gespeichert: „22x - einseitig - sw - Konzentrationsaufgabe.pdf“ (Liste „Von der Lehrkraft auszudrucken“).");
  // Elternansicht: weder Druckvorlage noch Bildkarten-Versuch – nur die erlaubten Bildkarten, wenn der Verlaufsplan sie nennt
  const les = await L.getLesson(c.db, l.id), course = (await GS.gsCourseMap(c.db)).get(les.klass);
  const pv = await PA.parentView(c, { ...les, portal: "**1) Erzählung**\n- [[pdf:" + pf.id + "]]" }, course, { preview: true });
  assert.ok(!(pv.files || []).length && !(pv.cards || []).some((x) => /konzentration/i.test(x.name)), JSON.stringify(pv));
});
