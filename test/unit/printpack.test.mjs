// Nachtrag 42 (23.11.2026), Teil 1: „Sitzungspaket“ – Dateien einer Sitzung mit gleicher Anzahl, Farbe und Druckart stehen beim Drucken als EINE PDF da
// („1x - farbig - einseitig - Reli2 - Sitzungspaket.pdf“), in der Reihenfolge des Verlaufsplans (Grundschule: Verweise [[pdf:…]], Gymnasium: kursive Titel im
// Schulportal-Eintrag). Reine Bausteine (shared.js), Zusammenfügen mit echten pdf-lib-Dokumenten (printpack.js: Leerseiten beim beidseitigen Druck, nicht
// fertige und nicht lesbare Dateien), die Druckliste der Sitzung (materialbox.js, Browser-Ersatz fake-dom.mjs: Paketzeile, Dateien klein darunter, neu
// ordnen ohne Fokusverlust, ZIP-Datei, Herunterladen eines Pakets), das Feld „Druckaufträge …“ (printnext.js) und die kompakte Ansicht (inclasslib.js).
// Alle Inhalte frei erfunden.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "/vendor/pdf-lib.esm.min.js" ? n("pdf-lib", c) : n(s, c); }'));
const D = installDom({ hash: "#/lk" });
const lib = await import("pdf-lib");
const S = await import("../../public/shared.js");
const PP = await import("../../public/printpack.js");
const MB = await import("../../public/materialbox.js");
const DR = await import("../../public/designrender.js");
const PN = await import("../../public/printnext.js");
const IL = await import("../../public/inclasslib.js");
const { readZip } = await import("../../public/zip.js");
const { ApiError } = await import("../../public/ui.js");

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const button = (root, text) => $$("button", root).find((b) => b.textContent.trim() === text || b.getAttribute("aria-label") === text);
async function until(cond, what) { for (let i = 0; i < 1500; i++) { if (cond()) return; await D.sleep(2); } assert.fail("nicht eingetreten: " + what); }

/* echte PDF mit Seiten der Breiten ws (Höhe 842) – die Breite kennzeichnet die Seite im zusammengefügten Paket; jede Seite hat Inhalt (Rechteck) */
async function pdf(ws) {
  const d = await lib.PDFDocument.create();
  for (const w of ws) d.addPage([w, 842]).drawRectangle({ x: 20, y: 20, width: 50, height: 50, color: lib.rgb(0.2, 0.3, 0.8) });
  return d.save();
}
const pagesOf = async (bytes) => (await lib.PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), !!p.node.Contents()]);
const id = (n) => String(n).padStart(16, "d");
const pf = (n, name, print, extra = {}) => ({ id: id(n), area: "print", kind: "file", name, mime: "application/pdf", size: 2048, status: "ready", source: "upload", createdAt: n,
  print, printName: S.printFileName({ name, ...print, course: extra.course || "PoWi8" }), ...extra });
const ONE = { copies: 1, duplex: false, color: true }, CLASS = { copies: 28, duplex: true, color: false };

/* ---------- reine Bausteine (shared.js) ---------- */
test("printPacks: gleiche Anzahl, Farbe und Druckart ab zwei Dateien → Paket „<n>x - … - <Kurs> - Sitzungspaket.pdf“; die übrigen einzeln in ihrer Reihenfolge", () => {
  assert.equal(S.PACK_TITLE, "Sitzungspaket");
  const a = pf(1, "Erzählkarten.pdf", ONE), b = pf(2, "AB Wasser.pdf", CLASS), c = pf(3, "Bildkarten Arche.pdf", ONE), d = pf(4, "Tafelbild", { copies: 1, duplex: false, color: false }),
    e = pf(5, "Rätsel.pdf", CLASS), f = pf(6, "Lösung.pdf", { copies: 2, duplex: true, color: false });
  const r = S.printPacks([a, b, c, d, e, f], { course: "Reli2" });
  assert.deepEqual(r.packs.map((p) => [p.name, p.files.map((x) => x.name), p.key, p.print]), [
    ["1x - farbig - einseitig - Reli2 - Sitzungspaket.pdf", ["Erzählkarten.pdf", "Bildkarten Arche.pdf"], "1|farbig|einseitig", ONE],
    ["28x - sw - beidseitig - Reli2 - Sitzungspaket.pdf", ["AB Wasser.pdf", "Rätsel.pdf"], "28|sw|beidseitig", CLASS]]);
  assert.deepEqual(r.single.map((x) => x.name), ["Tafelbild", "Lösung.pdf"], "einzeln, wie bisher");
  // die Druckangaben wie im Druck-Namen: ohne Angabe 1x, sw, einseitig; Anzahl als Text zählt wie die Zahl
  assert.deepEqual(S.printSettingsOf({}), { copies: 1, color: false, duplex: false });
  assert.deepEqual(S.printSettingsOf({ print: { copies: "3", color: 1, duplex: 0 } }), { copies: 3, color: true, duplex: false });
  assert.equal(S.printPacks([pf(1, "A.pdf", ONE)]).packs.length, 0, "eine Datei allein ist kein Paket");
  assert.deepEqual(S.printPacks([pf(1, "A.pdf", ONE), pf(2, "B.pdf", ONE)]).packs[0].name, "1x - farbig - einseitig - Sitzungspaket.pdf", "ohne Kurs wie printFileName");
  assert.deepEqual(S.printPacks(null), { packs: [], single: [] });
});

test("Reihenfolge Grundschule: nach den Verweisen des Verlaufsplans (auch nach dem Zwischenstopp); nicht genannte zuletzt in ihrer bisherigen Reihenfolge", () => {
  const a = pf(1, "Konzentration.pdf", ONE), b = pf(2, "Bildkarten Josef.pdf", ONE), c = pf(3, "Erzähltext.pdf", ONE), d = pf(4, "Extra.pdf", ONE);
  const plan = "**1) Ankommen**\n- Konzentrationsaufgabe " + S.pdfRef(a.id) + "\n\n**2) Erzählung**\n- __Lehrkraft erzählt__ " + S.pdfRef(c.id) + " und legt " + S.pdfRef(b.id) + "\n⏸ Zwischenstopp\n**3) Ende**\n- " + S.pdfRef(a.id);
  const [p] = S.printPacks([d, b, a, c], { plan, gs: true }).packs;
  assert.deepEqual(p.files.map((x) => x.name), ["Konzentration.pdf", "Erzähltext.pdf", "Bildkarten Josef.pdf", "Extra.pdf"]);
  assert.equal(p.planned, 3);
  assert.equal(S.packMetaText(p), "Sitzungspaket · 4 Materialien in der Reihenfolge des Verlaufsplans (nicht darin genannte zuletzt)");
  const [q] = S.printPacks([d, b], { plan: "", gs: true }).packs;
  assert.deepEqual(q.files.map((x) => x.name), ["Extra.pdf", "Bildkarten Josef.pdf"], "ohne Verweise: Reihenfolge der Druckliste");
  assert.equal(S.packMetaText(q), "Sitzungspaket · 2 Materialien in der Reihenfolge der Druckliste (der Verlaufsplan nennt sie nicht)");
  const [r] = S.printPacks([b, c], { plan, gs: true }).packs;
  assert.equal(S.packMetaText(r), "Sitzungspaket · 2 Materialien in der Reihenfolge des Verlaufsplans");
});

test("Reihenfolge Gymnasium: kursive Titel im Schulportal-Eintrag (vereinheitlicht: Groß/klein, Striche, Anführungszeichen, NFC, „.pdf“, Druck-Präfix), sonst der Titel im Text", () => {
  const files = [
    pf(1, "Lösungsblatt.pdf", CLASS),                       // nirgends genannt → zuletzt
    pf(2, "AB – Das Bundesverfassungsgericht.pdf", CLASS),  // kursiv mit „-“ statt „–“ und anderer Schreibung
    pf(3, "28x - sw - beidseitig - PoWi8 - Karikatur „Macht“.pdf", CLASS),   // früher heruntergeladene Druckdatei: Präfix entfällt
    pf(4, "Rollenkarten.pdf", CLASS),                       // nur im Fließtext genannt
    pf(5, "Grüne Karte.pdf", CLASS),                  // „ü“ zerlegt (NFD)
  ];
  const portal = "**1) TOP 10**\n\n**2) Einstieg**\n- Karikatur ~~\"Macht\"~~ beschreiben\n\n**3) Partnerarbeit**\n- ~~ab - das bundesverfassungsgericht~~\n- Danach mit den Rollenkarten weiterarbeiten\n" +
    "\n**4) Abstimmung**\n- ~~Grüne Karte~~ hochhalten\n- Roll\n";
  const [p] = S.printPacks(files, { plan: portal, course: "PoWi8" }).packs;
  assert.deepEqual(p.files.map((f) => f.id), [id(3), id(2), id(4), id(5), id(1)]);
  assert.equal(p.planned, 4);
  // ganze Wörter: „Roll“ ist nicht „Rollenkarten“, „AB“ nicht in „Abstimmung“
  assert.deepEqual(S.printPlanOrder([pf(6, "Roll.pdf", CLASS), pf(7, "AB.pdf", CLASS)], "- Rollenkarten\n**4) Abstimmung**").map((x) => x.at), [-1, -1]);
  assert.equal(S.packTitleKey("1x - farbig - einseitig - Reli2 - „Josef“ in Ägypten.PDF"), "\"josef\" in ägypten");
});

/* ---------- Zusammenfügen mit pdf-lib (printpack.js) ---------- */
test("mergePrintPack: Reihenfolge der Teile; beidseitig nach jedem Material mit ungerader Seitenzahl eine Leerseite (auch am Ende → gerade Seitenzahl); einseitig ohne", async () => {
  const parts = [{ data: await pdf([500, 501, 502]), name: "A" }, { data: await pdf([510, 511]), name: "B" }, { data: await pdf([520]), name: "C" }];
  const two = await PP.mergePrintPack(parts, lib, { duplex: true, title: "1x - sw - beidseitig - Sitzungspaket.pdf" });
  assert.deepEqual(await pagesOf(two.bytes), [[500, true], [501, true], [502, true], [502, false], [510, true], [511, true], [520, true], [520, false]],
    "A (3) + Leerseite, B (2), C (1) + Leerseite – jedes Material und jede Kopie beginnt auf einem neuen Blatt");
  assert.deepEqual([two.pages, two.blanks, two.used.map((x) => x.name), two.bad], [8, 2, ["A", "B", "C"], []]);
  const meta = await lib.PDFDocument.load(two.bytes);
  assert.equal(meta.getTitle(), "1x - sw - beidseitig - Sitzungspaket.pdf");
  assert.equal(meta.getSubject(), "Sitzungspaket: Teil 1 „A“ (Seite 1–3); Teil 2 „B“ (Seite 5–6); Teil 3 „C“ (Seite 7)", "der Betreff nennt, welche Datei auf welchen Seiten steht (Leerseiten nicht)");
  const one = await PP.mergePrintPack(parts, lib, { duplex: false });
  assert.deepEqual((await pagesOf(one.bytes)).map((x) => x[0]), [500, 501, 502, 510, 511, 520]);
  assert.equal(one.blanks, 0);
  const even = await PP.mergePrintPack([{ data: await pdf([500, 501]), name: "A" }, { data: await pdf([510, 511]), name: "B" }], lib, { duplex: true });
  assert.deepEqual([even.pages, even.blanks], [4, 0], "gerade Seitenzahlen: keine Leerseite");
});

test("mergePrintPack: nicht lesbare Teile bleiben draußen (genannt); weniger als zwei lesbare → kein Paket", async () => {
  const bad = { data: new TextEncoder().encode("%PDF-1.7 kaputt"), name: "Kaputt" };
  const r = await PP.mergePrintPack([{ data: await pdf([500]), name: "A" }, bad, { data: await pdf([510, 511]), name: "B" }], lib, { duplex: true });
  assert.deepEqual([r.used.map((x) => x.name), r.bad.map((x) => x.part.name), r.pages, r.blanks], [["A", "B"], ["Kaputt"], 4, 1]);
  const lone = await PP.mergePrintPack([{ data: await pdf([500]), name: "A" }, bad], lib, {});
  assert.deepEqual([lone.bytes, lone.used.map((x) => x.name), lone.bad.length], [null, ["A"], 1]);
});

test("packEntries/packNotes: Pakete zuerst (eine PDF), ihre Dateien nicht noch einmal; nicht lesbare einzeln mit Hinweis; nur eine fertige → einzeln mit Hinweis", async () => {
  const a = pf(1, "A.pdf", ONE), b = pf(2, "B.pdf", ONE), c = pf(3, "C.pdf", ONE), x = pf(4, "X.pdf", CLASS), y = pf(5, "Y.pdf", CLASS, { status: "pending", source: "claude", design: { outdated: true, error: null } }), z = pf(6, "Z.pdf", { copies: 5, duplex: false, color: false });
  const packs = S.printPacks([a, b, c, x, y, z], { course: "PoWi8" }).packs;
  const entries = [{ f: a, name: a.printName, data: await pdf([500]) }, { f: b, name: b.printName, data: new TextEncoder().encode("%PDF-kaputt") }, { f: c, name: c.printName, data: await pdf([520, 521]) },
    { f: x, name: x.printName, data: await pdf([600]) }, { f: z, name: z.printName, data: await pdf([700]) }];   // y fehlt (noch nicht gedruckt)
  let loads = 0;
  const r = await PP.packEntries(entries, packs, async () => { loads++; return lib; });
  assert.equal(loads, 1, "pdf-lib nur, wenn ein Paket mindestens zwei fertige Dateien hat");
  assert.deepEqual(r.entries.map((e) => e.name), ["1x - farbig - einseitig - PoWi8 - Sitzungspaket.pdf", b.printName, x.printName, z.printName]);
  assert.deepEqual(r.entries[0].parts.map((p) => p.f.id), [a.id, c.id]);
  assert.deepEqual((await pagesOf(r.entries[0].data)).map((p) => p[0]), [500, 520, 521]);
  assert.deepEqual(PP.packNotes(r.info, "in der ZIP-Datei"), [
    "„1x - farbig - einseitig - PoWi8 - B.pdf“ ließ sich nicht in das Sitzungspaket „1x - farbig - einseitig - PoWi8 - Sitzungspaket.pdf“ einfügen (die PDF-Datei ist im Browser nicht lesbar) – sie liegt einzeln in der ZIP-Datei.",
    "Vom Sitzungspaket „28x - sw - beidseitig - PoWi8 - Sitzungspaket.pdf“ ist bisher nur „28x - sw - beidseitig - PoWi8 - X.pdf“ fertig – sie liegt einzeln in der ZIP-Datei."]);
  const none = await PP.packEntries(entries.slice(3), [], () => { throw new Error("nie"); });
  assert.deepEqual(none.entries.map((e) => e.name), [x.printName, z.printName]);
  // fehlt eine fertige Datei nur, weil sie sich nicht laden ließ, sagt das der Aufrufer („Nicht in der ZIP-Datei: …“) – kein „bisher nur … fertig“
  assert.deepEqual(PP.packNotes([{ pack: packs[1], made: false, parts: [{ f: x, name: x.printName }], bad: [], missing: [pf(7, "Geladen.pdf", CLASS)] }], "in der ZIP-Datei"), []);
});

test("buildPack/packDoneText: nur fertige Dateien; noch nicht gedruckte und nicht ladbare genannt; eine fertige → einzeln", async () => {
  const a = pf(1, "A.pdf", ONE), b = pf(2, "B.pdf", ONE, { design: { outdated: true, error: null }, status: "pending", source: "claude" }), c = pf(3, "C.pdf", ONE), d = pf(4, "D.pdf", ONE);
  const [pack] = S.printPacks([a, b, c, d], { course: "PoWi8" }).packs;
  const bytes = { [a.id]: await pdf([500]), [c.id]: await pdf([520]) };
  const nameOf = (f) => f.printName;
  const r = await PP.buildPack(pack, { nameOf, lib: async () => lib, bytesOf: async (f) => { if (!bytes[f.id]) throw new Error("„" + f.name + "“ ließ sich nicht laden (Fehler 404)."); return bytes[f.id]; } });
  assert.deepEqual([r.used.map((x) => x.f.id), r.wait.map((f) => f.id), r.failed.map((x) => x.f.id), r.pages, r.blanks], [[a.id, c.id], [b.id], [d.id], 2, 0]);
  const t = PP.packDoneText(pack, r, { nameOf });
  assert.equal(t.text, "„1x - farbig - einseitig - PoWi8 - Sitzungspaket.pdf“ ist heruntergeladen: 2 Materialien, 2 Seiten. Noch nicht dabei (wird gerade als PDF gedruckt): „1x - farbig - einseitig - PoWi8 - B.pdf“. " +
    "Nicht dabei, weil sie sich nicht laden ließ: „1x - farbig - einseitig - PoWi8 - D.pdf“ („D.pdf“ ließ sich nicht laden (Fehler 404)).");
  assert.equal(t.ok, false);
  // nur eine fertig: kein Paket, die Datei einzeln
  const s = await PP.buildPack(pack, { nameOf, lib: async () => { throw new Error("nie"); }, bytesOf: async (f) => { if (f.id !== a.id) throw new ApiError("noch nicht", 409, { code: "cards_not_printed" }); return bytes[a.id]; },
    wait: (f, e) => e.code === "cards_not_printed" });
  assert.deepEqual([s.bytes, s.single.f.id, s.wait.map((f) => f.id)], [null, a.id, [b.id, c.id, d.id]]);
  assert.match(PP.packDoneText(pack, s, { nameOf }).text, /^Kein Sitzungspaket: Nur „1x - farbig - einseitig - PoWi8 - A\.pdf“ ist fertig – die Datei ist einzeln heruntergeladen\. Noch nicht dabei/);
  // beidseitig mit Leerseiten: die Rückmeldung nennt sie
  const [dup] = S.printPacks([pf(7, "E.pdf", CLASS), pf(8, "F.pdf", CLASS)]).packs;
  const u = await PP.buildPack(dup, { nameOf, lib: async () => lib, bytesOf: async () => pdf([500]) });
  assert.equal(PP.packDoneText(dup, u, { nameOf }).text, "„28x - sw - beidseitig - Sitzungspaket.pdf“ ist heruntergeladen: 2 Materialien, 4 Seiten (davon 2 Leerseiten, damit beim beidseitigen Druck jedes Material auf einem neuen Blatt beginnt).");
});

/* ---------- Druckliste der Sitzung (materialbox.js) ---------- */
function server(routes) {
  const calls = [];
  globalThis.__tapi = async (method, path, o = {}) => {
    calls.push({ method, path, body: o.body });
    for (const [re, fn] of routes) { const m = re.exec(method + " " + path); if (m) return fn(m, o.body); }
    throw new Error("unerwartet: " + method + " " + path);
  };
  return calls;
}
function mount(st, opts, routes) {
  if (globalThis.__leave) globalThis.__leave();
  DR.resetPrintQueue();
  const calls = server(routes);
  const box = MB.materialBox({ lessonId: id(99), st, L: () => ({ subject: "powi", klass: "8B", date: "2026-11-24", portal: "" }), ...opts });
  const app = document.getElementById("app");
  while (app.firstChild) app.firstChild.remove();
  app.append(box.filesCard, box.printCard);
  return { calls, box };
}
const patchRoute = (st) => [/^PATCH \/api\/teacher\/files\/(\w+)$/, (m, b) => {
  const f = st.files.find((x) => x.id === m[1]), p = { ...f.print, ...b };
  return { file: { ...f, print: p, printName: S.printFileName({ name: f.name, ...p, course: "PoWi8" }) } };
}];
const linkRoute = [/^POST \/api\/teacher\/files\/(\w+)\/link$/, (m) => ({ url: "/api/dl/" + m[1] })];
const rowNames = () => $$("#printcard .printrow .name").map((x) => x.textContent);

test("Druckliste (Gymnasium): Paketzeile oben mit Namen, Reihenfolge des Schulportal-Eintrags und „Herunterladen“; die Dateien klein darunter; Hinweis; ändert sich der Eintrag, folgt die Reihenfolge", async () => {
  const st = { files: [pf(1, "Tafelbild.pdf", { copies: 1, duplex: false, color: false }), pf(2, "Rollenkarten.pdf", CLASS), pf(3, "AB Gewaltenteilung.pdf", CLASS), pf(4, "Quiz.pdf", CLASS)] };
  let portal = "**2) Erarbeitung**\n- ~~AB Gewaltenteilung~~ bearbeiten\n\n**3) Rollenspiel**\n- ~~Rollenkarten~~ verteilen";
  const { box } = mount(st, { plan: () => portal }, [patchRoute(st), linkRoute]);
  await D.sleep(5);
  const packEl = $("#printcard .printpack");
  assert.ok(packEl && packEl === $("#printcard .list").firstChild, "das Paket steht oben");
  assert.equal($(".packrow .name", packEl).textContent, "28x - sw - beidseitig - PoWi8 - Sitzungspaket.pdf");
  assert.equal($(".packrow .meta", packEl).textContent, "Sitzungspaket · 3 Materialien in der Reihenfolge des Verlaufsplans (nicht darin genannte zuletzt)");
  assert.deepEqual($$(".pack-order li", packEl).map((x) => x.textContent), ["AB Gewaltenteilung", "Rollenkarten", "Quiz"]);
  assert.ok(button(packEl, "Herunterladen – 28x - sw - beidseitig - PoWi8 - Sitzungspaket.pdf"));
  assert.deepEqual(rowNames(), ["28x - sw - beidseitig - PoWi8 - AB Gewaltenteilung.pdf", "28x - sw - beidseitig - PoWi8 - Rollenkarten.pdf", "28x - sw - beidseitig - PoWi8 - Quiz.pdf",
    "1x - sw - einseitig - PoWi8 - Tafelbild.pdf"], "die Dateien des Pakets klein darunter (mit ihren Einstellungen), dann die übrigen");
  assert.deepEqual($$(".printrow", packEl).map((r) => r.classList.contains("pack-member")), [true, true, true]);
  assert.ok(!$$("#printcard .printrow").at(-1).classList.contains("pack-member"));
  assert.ok($$(".printrow", packEl).every((r) => r.querySelector("input.pcopies") && r.querySelectorAll("select").length === 2), "Anzahl und Druckart bleiben änderbar");
  assert.ok(!$("#print-pack-hint").classList.contains("hidden"));
  assert.equal($("#print-pack-hint").textContent, PP.PACK_HINT);
  // der Schulportal-Eintrag nennt die Rollenkarten jetzt zuerst: die Zeilen wandern, ohne neu gebaut zu werden
  const roll = $$("#printcard .printrow").find((r) => r.textContent.includes("Rollenkarten"));
  portal = "- ~~Rollenkarten~~\n- ~~Quiz~~\n- ~~AB Gewaltenteilung~~";
  box.syncPacks();
  assert.deepEqual($$(".pack-order li", $("#printcard .printpack")).map((x) => x.textContent), ["Rollenkarten", "Quiz", "AB Gewaltenteilung"]);
  assert.equal($$("#printcard .printpack .printrow")[0], roll, "dieselbe Zeile");
  assert.equal($(".packrow .meta").textContent, "Sitzungspaket · 3 Materialien in der Reihenfolge des Verlaufsplans");
});

test("Druckliste: andere Anzahl bzw. Druckart in einer Datei des Pakets → sie wandert aus dem Paket (bzw. hinein), der Fokus bleibt im Feld; das letzte Paar löst das Paket auf", async () => {
  const st = { files: [pf(1, "A.pdf", CLASS), pf(2, "B.pdf", CLASS), pf(3, "C.pdf", CLASS), pf(4, "D.pdf", { copies: 28, duplex: false, color: false })] };
  const { calls } = mount(st, { plan: () => "" }, [patchRoute(st), linkRoute]);
  await D.sleep(5);
  assert.equal($$("#printcard .printpack .printrow").length, 3);
  // B: 28x → einseitig (wie D): B und D bilden ein zweites Paket; der Fokus bleibt auf dem Feld „Beidseitig oder einseitig – B.pdf“
  const sel = $$("#printcard select").find((x) => x.getAttribute("aria-label") === "Beidseitig oder einseitig – B.pdf");
  sel.focus(); sel.value = "0"; D.fire(sel, "change");
  await until(() => $$("#printcard .printpack").length === 2, "zweites Paket");
  assert.equal(document.activeElement, sel, "Fokus bleibt im verschobenen Feld");
  assert.deepEqual(calls.filter((x) => x.method === "PATCH").map((x) => x.body), [{ duplex: false }]);
  assert.deepEqual($$("#printcard .printpack .packrow .name").map((x) => x.textContent), ["28x - sw - beidseitig - PoWi8 - Sitzungspaket.pdf", "28x - sw - einseitig - PoWi8 - Sitzungspaket.pdf"]);
  assert.deepEqual($$("#printcard .printpack").map((g) => $$(".printrow .name", g).map((x) => x.textContent.replace("28x - sw - ", ""))), [["beidseitig - PoWi8 - A.pdf", "beidseitig - PoWi8 - C.pdf"], ["einseitig - PoWi8 - B.pdf", "einseitig - PoWi8 - D.pdf"]]);
  // C: Anzahl 30 → A bleibt allein: das erste Paket löst sich auf, A und C stehen einzeln unten
  const cp = $$("#printcard input.pcopies").find((x) => x.getAttribute("aria-label") === "Anzahl der Exemplare – C.pdf");
  cp.focus(); cp.value = "30"; D.fire(cp, "change");
  await until(() => $$("#printcard .printpack").length === 1, "erstes Paket aufgelöst");
  assert.equal(document.activeElement, cp);
  assert.deepEqual(rowNames(), ["28x - sw - einseitig - PoWi8 - B.pdf", "28x - sw - einseitig - PoWi8 - D.pdf", "28x - sw - beidseitig - PoWi8 - A.pdf", "30x - sw - beidseitig - PoWi8 - C.pdf"]);
  assert.ok(!$$("#printcard .printrow").at(-1).classList.contains("pack-member"));
});

test("„Alle herunterladen (ZIP)“: das Sitzungspaket statt seiner Dateien (eine PDF in der Reihenfolge des Plans), die übrigen einzeln; „Herunterladen“ des Pakets fügt zusammen", async () => {
  const st = { files: [pf(1, "Quiz.pdf", CLASS), pf(2, "AB.pdf", CLASS), pf(3, "Tafel.pdf", { copies: 1, duplex: false, color: false }), pf(4, "Neu gestaltet.pdf", CLASS, { status: "pending", source: "claude", design: { outdated: true, error: null, htmlAt: 9, pdfAt: null, text: "" } })] };
  const bytes = { [id(1)]: await pdf([501]), [id(2)]: await pdf([502, 503, 504]), [id(3)]: await pdf([505]) };
  const real = globalThis.fetch, orig = URL.createObjectURL, blobs = [], names = [];
  globalThis.fetch = async (u) => new Response(bytes[String(u).split("/").pop()]);
  URL.createObjectURL = (b) => { blobs.push(b); return "blob:x"; };
  const origAppend = document.body.append.bind(document.body);
  document.body.append = (...xs) => { for (const x of xs) if (x && x.tagName === "A") names.push(x.getAttribute("download")); return origAppend(...xs); };
  const { calls } = mount(st, { plan: () => "- ~~AB~~\n- ~~Quiz~~" }, [patchRoute(st), linkRoute, [/^POST \/api\/teacher\/files\/(\w+)\/render$/, () => new Promise(() => {})]]);
  try {
    await D.sleep(5);
    D.userClick(button($("#printcard"), "Alle herunterladen (ZIP)"));
    await until(() => blobs.length === 1, "ZIP");
    const entries = await readZip(new Uint8Array(await blobs[0].arrayBuffer()));
    assert.deepEqual(entries.map((e) => e.name), ["28x - sw - beidseitig - PoWi8 - Sitzungspaket.pdf", "1x - sw - einseitig - PoWi8 - Tafel.pdf"]);
    assert.deepEqual(await pagesOf(entries[0].data), [[502, true], [503, true], [504, true], [504, false], [501, true], [501, false]], "AB (3 Seiten + Leerseite), dann Quiz (1 + Leerseite)");
    await until(() => $("#toasts").textContent.includes("Gleiche Druckangaben"), "Rückmeldung");
    assert.ok($("#toasts").textContent.includes("Alle 2 Dateien sind als eine ZIP-Datei heruntergeladen. Gleiche Druckangaben sind zu einem Sitzungspaket zusammengefasst. Noch nicht dabei (wird gerade als PDF gedruckt): „Neu gestaltet.pdf“."), $("#toasts").textContent);
    // nur das Paket
    blobs.length = 0; names.length = 0;
    D.userClick(button($("#printcard .printpack"), "Herunterladen – 28x - sw - beidseitig - PoWi8 - Sitzungspaket.pdf"));
    await until(() => blobs.length === 1, "Paket");
    assert.deepEqual(names, ["28x - sw - beidseitig - PoWi8 - Sitzungspaket.pdf"]);
    assert.equal((await pagesOf(new Uint8Array(await blobs[0].arrayBuffer()))).length, 6);
    await until(() => $("#toasts").textContent.includes("ist heruntergeladen: 2 Materialien, 6 Seiten (davon 2 Leerseiten"), "Rückmeldung zum Paket");
    assert.ok(calls.some((x) => x.path === "/api/teacher/files/" + id(4) + "/render"), "die noch nicht gedruckte Vorlage druckt die Warteschlange");
  } finally { globalThis.fetch = real; URL.createObjectURL = orig; document.body.append = origAppend; }
});

test("Druckliste (Grundschule): Bildkarten und Konzentrationsaufgabe in der Reihenfolge der Verweise; wiederverwendete Bildkarten gehören dazu; „Nicht ausdrucken“ löst das Paket auf", async () => {
  const card = (n, name, extra = {}) => ({ id: id(n), area: "teacher", kind: "file", name, mime: "application/pdf", size: 4096, pages: 3, status: "ready", source: "upload", createdAt: n,
    cards: { texts: [], share: false, rev: 0, pages: 3, current: true, version: n }, print: { ...ONE }, printName: S.printFileName({ name, ...ONE, course: "Reli2" }), ...extra });
  const own = card(1, "Bildkarten Josef.pdf"), kid = { ...pf(2, "Ausmalbild.pdf", ONE, { course: "Reli2" }), area: "student" };
  const other = { ...card(3, "Bildkarten Arche.pdf"), lessonId: id(98), lessonTitle: "Arche Noah", date: "2026-11-17" };
  delete other.print; delete other.printName;
  const st = { files: [own, kid], courseCards: [other], cardPrints: {} };
  let plan = "- Malen " + S.pdfRef(kid.id) + "\n- Erzählen mit " + S.pdfRef(other.id) + " und " + S.pdfRef(own.id);
  const { box } = mount(st, { gs: true, refPlan: () => plan, exclude: (f) => f.cards != null, course: "Reli2" }, [patchRoute(st), linkRoute,
    [/^PUT \/api\/teacher\/lessons\/(\w+)\/card-prints$/, (m, b) => { st.cardPrints = { ...st.cardPrints, [b.fileId]: b.off ? { off: true } : { ...ONE, ...b } }; return { cardPrints: st.cardPrints }; }]]);
  await D.sleep(5);
  assert.equal($(".packrow .name").textContent, "1x - farbig - einseitig - Reli2 - Sitzungspaket.pdf");
  assert.deepEqual($$(".pack-order li").map((x) => x.textContent), ["Ausmalbild", "Bildkarten Arche", "Bildkarten Josef"]);
  assert.equal($(".packrow .meta").textContent, "Sitzungspaket · 3 Materialien in der Reihenfolge des Verlaufsplans");
  // der Verlaufsplan ändert die Reihenfolge – syncRefs (ruft die Seite bei jeder Änderung) ordnet das Paket neu
  plan = "- " + S.pdfRef(own.id) + " " + S.pdfRef(kid.id) + " " + S.pdfRef(other.id);
  box.syncRefs();
  assert.deepEqual($$(".pack-order li").map((x) => x.textContent), ["Bildkarten Josef", "Ausmalbild", "Bildkarten Arche"]);
  // die wiederverwendeten Bildkarten in dieser Sitzung abwählen, dann das Arbeitsblatt der Kinder 2x: kein Paket mehr – auch wenn der Materialkasten seine Zeile
  // inzwischen neu gebaut hat (beide Zeilen gehören zu derselben Datei; die Zeile der Druckliste bleibt dieselbe, der Fokus darin)
  D.userClick(button($("#printcard"), "Nicht ausdrucken – 1x - farbig - einseitig - Reli2 - Bildkarten Arche.pdf"));
  await until(() => $$(".pack-order li").length === 2, "Paket ohne die abgewählten");
  box.paintFiles();
  const cp = $$("#printcard input.pcopies").find((x) => x.getAttribute("aria-label") === "Anzahl der Exemplare – Ausmalbild.pdf");
  cp.focus(); cp.value = "2"; D.fire(cp, "change");
  await until(() => !$("#printcard .printpack"), "kein Paket mehr");
  assert.equal(document.activeElement, cp);
  assert.ok($("#print-pack-hint").classList.contains("hidden"));
  // kompakte Ansicht: Pakete aus der Druckliste
  assert.deepEqual(box.packs(), []);
});

/* ---------- Druckaufträge der Startseiten (printnext.js) ---------- */
test("„Druckaufträge …“: je Sitzung das Paket (vom Server: packs) oben, die Dateien klein darunter; „Herunterladen“ fügt zusammen; ZIP des Tages mit Paketen, gleiche Namen eindeutig", async () => {
  const a = pf(1, "AB.pdf", CLASS), b = pf(2, "Quiz.pdf", CLASS), c = pf(3, "Tafel.pdf", ONE);
  const a2 = { ...pf(4, "AB.pdf", CLASS) }, b2 = { ...pf(5, "Quiz.pdf", CLASS) };
  const pk = (ids) => [{ key: "28|sw|beidseitig", name: "28x - sw - beidseitig - PoWi8 - Sitzungspaket.pdf", print: CLASS, planned: 2, ids }];
  const data = { ok: true, today: "2026-11-23", candidate: "2026-11-24", date: "2026-11-24", sessions: [
    { id: id("s1"), subject: "powi", klass: "8A", title: "Gewaltenteilung", date: "2026-11-24", startTime: "08:00", school: "gym", label: "PoWi 8A", subtitle: "Politik und Wirtschaft · 8A", printCourse: "PoWi8", files: [a, b, c], packs: pk([b.id, a.id]) },
    { id: id("s2"), subject: "powi", klass: "8B", title: "Gewaltenteilung", date: "2026-11-24", startTime: "09:50", school: "gym", label: "PoWi 8B", subtitle: "Politik und Wirtschaft · 8B", printCourse: "PoWi8", files: [a2, b2], packs: pk([a2.id, b2.id]) },
  ] };
  if (globalThis.__leave) globalThis.__leave();
  DR.resetPrintQueue();
  const bytes = { [a.id]: await pdf([501]), [b.id]: await pdf([502, 503]), [c.id]: await pdf([504]), [a2.id]: await pdf([505]), [b2.id]: await pdf([506]) };
  const blobs = [];
  globalThis.__tapi = async (method, path) => {
    if (path === "/api/teacher/print-next") return data;
    const m = /^\/api\/teacher\/files\/(\w+)\/link$/.exec(path);
    if (m) return { url: "/api/dl/" + m[1] };
    throw new ApiError("nicht nachgebildet: " + path, 404, { code: "not_found" });
  };
  const io0 = { ...PN.io };
  Object.assign(PN.io, { blob: (bl, n) => blobs.push([bl, n]), url: () => assert.fail("Einzel-Download über den Link nicht erwartet"),
    fetch: async (u) => { const k = String(u).split("/").pop(), u8 = bytes[k]; return { ok: true, status: 200, arrayBuffer: async () => u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength) }; } });
  const app = document.getElementById("app");
  while (app.firstChild) app.firstChild.remove();
  const card = PN.printNextCard();
  app.append(card);
  try {
    await until(() => $$(".pn-pack", card).length === 2, "zwei Pakete");
    const g1 = $(".pn-group", card);
    assert.equal($(".pn-packrow .name", g1).textContent, "28x - sw - beidseitig - PoWi8 - Sitzungspaket.pdf");
    assert.equal($(".pn-packrow .meta", g1).textContent, "Sitzungspaket · 2 Materialien in der Reihenfolge des Verlaufsplans");
    assert.deepEqual($$(".pn-row .name", g1).map((x) => x.textContent), ["28x - sw - beidseitig - PoWi8 - Quiz.pdf", "28x - sw - beidseitig - PoWi8 - AB.pdf", "1x - farbig - einseitig - PoWi8 - Tafel.pdf"],
      "Dateien des Pakets in seiner Reihenfolge darunter, dann die übrigen");
    assert.deepEqual($$(".pn-row", g1).map((r) => r.classList.contains("pn-member")), [true, true, false]);
    // Paket einzeln
    D.userClick($(".pn-packdl", g1));
    await until(() => blobs.length === 1, "Paket");
    assert.equal(blobs[0][1], "28x - sw - beidseitig - PoWi8 - Sitzungspaket.pdf");
    assert.deepEqual(await pagesOf(new Uint8Array(await blobs[0][0].arrayBuffer())), [[502, true], [503, true], [501, true], [501, false]], "Quiz (2), AB (1) + Leerseite");
    assert.match($("#pn-status", card).textContent, /ist heruntergeladen: 2 Materialien, 4 Seiten \(davon eine Leerseite/);
    // alle Dateien des Tages: zwei gleich benannte Pakete (8A und 8B) → „(2)“
    blobs.length = 0;
    D.userClick($("button.pn-all", card));
    await until(() => blobs.length === 1 && /^Fertig/.test($("#pn-status", card).textContent), "ZIP");
    const entries = await readZip(new Uint8Array(await blobs[0][0].arrayBuffer()));
    assert.deepEqual(entries.map((e) => e.name), ["28x - sw - beidseitig - PoWi8 - Sitzungspaket.pdf", "1x - farbig - einseitig - PoWi8 - Tafel.pdf", "28x - sw - beidseitig - PoWi8 - Sitzungspaket (2).pdf"]);
    assert.deepEqual((await pagesOf(entries[2].data)).map((p) => p[0]), [505, 505, 506, 506]);
    assert.equal($("#pn-status", card).textContent, "Fertig: Alle 3 Dateien sind als eine ZIP-Datei „Druckaufträge - Dienstag, 24.11.2026.zip“ heruntergeladen. Gleiche Druckangaben sind zu 2 Sitzungspaketen zusammengefasst.");
  } finally { Object.assign(PN.io, io0); }
});

test("sessionPacks: nur Pakete mit mindestens zwei Dateien der Sitzung; ein älterer Server ohne packs → keine", () => {
  const a = pf(1, "A.pdf", CLASS), b = pf(2, "B.pdf", CLASS);
  assert.deepEqual(PN.sessionPacks({ files: [a, b] }), []);
  assert.deepEqual(PN.sessionPacks({ files: [a, b], packs: [{ key: "k", name: "N.pdf", print: CLASS, planned: 1, ids: [b.id, a.id] }] }).map((p) => [p.name, p.files.map((f) => f.id), p.planned]), [["N.pdf", [b.id, a.id], 1]]);
  assert.deepEqual(PN.sessionPacks({ files: [a], packs: [{ key: "k", name: "N.pdf", ids: [a.id, id(9)] }] }), [], "Dateien, die die Seite nicht kennt, zählen nicht");
});

/* ---------- „Ich bin jetzt im Unterricht“ (inclasslib.js) ---------- */
test("materialColumns/materialKey: das Paket steht vor den übrigen Druckdateien, seine Dateien darunter; der Schlüssel folgt Paket und Reihenfolge", () => {
  const a = pf(1, "A.pdf", CLASS), b = pf(2, "B.pdf", CLASS), c = pf(3, "C.pdf", ONE), t = { id: id(4), area: "teacher", kind: "file", name: "Lösung.pdf", status: "ready" };
  const packs = S.printPacks([a, b, c], { course: "PoWi8" }).packs;
  const cols = IL.materialColumns([a, t, b, c], [], { packs });
  assert.deepEqual(cols.teacher.map((e) => (e.type === "pack" ? "Paket: " + e.members.map((m) => m.file.name).join(", ") : e.file.name)), ["Lösung.pdf", "Paket: A.pdf, B.pdf", "C.pdf"]);
  assert.ok(cols.teacher[1].members.every((m) => m.member && m.print && m.tags.includes(IL.PRINT_TAG)));
  const k1 = IL.materialKey(cols), k2 = IL.materialKey(IL.materialColumns([a, t, b, c], [], { packs: S.printPacks([b, a, c], { course: "PoWi8" }).packs }));
  assert.notEqual(k1, k2, "andere Reihenfolge im Paket");
  assert.equal(IL.materialKey(IL.materialColumns([a, t, b, c], [], { packs })), k1);
  assert.deepEqual(IL.materialColumns([a, b], [], { packs: [{ name: "x", files: [a] }] }).teacher.map((e) => e.type), ["file", "file"], "ein Paket mit nur einer Datei gibt es nicht");
});

test("„Ich bin jetzt im Unterricht“ (Grundschule): das Sitzungspaket als Eintrag mit „Herunterladen“, seine Dateien klein darunter; Klick fügt zusammen", async () => {
  const IC = await import("../../public/inclass.js");
  const st = { files: [pf(1, "Konzentration.pdf", ONE, { course: "Reli2" }), pf(2, "Ausmalbild.pdf", ONE, { course: "Reli2" }), pf(3, "Lied.pdf", CLASS, { course: "Reli2" })], courseCards: [], cardPrints: {} };
  const plan = "- " + S.pdfRef(id(2)) + "\n- " + S.pdfRef(id(1));
  const bytes = { [id(1)]: await pdf([501]), [id(2)]: await pdf([502]), [id(3)]: await pdf([503]) };
  const real = globalThis.fetch, orig = URL.createObjectURL, blobs = [];
  globalThis.fetch = async (u) => new Response(bytes[String(u).split("/").pop()]);
  URL.createObjectURL = (b) => { blobs.push(b); return "blob:x"; };
  const { box } = mount(st, { gs: true, refPlan: () => plan, course: "Reli2" }, [linkRoute]);
  const on = { plan: new Set(), files: new Set() };
  const view = IC.inClassView({ kind: "gs", id: id(99), st, selbstlern: () => false, on: (k, fn) => { on[k].add(fn); return () => on[k].delete(fn); },
    planText: () => plan, paintPlan: () => {}, planState: null, stopMenu: () => {}, stopDialog: () => {}, dropStop: () => {}, stopNext: () => null,
    openActs: box.openActs, refCards: () => box.refEntries(), packs: () => box.packs(), packActs: box.packActs, homework: document.createElement("textarea"), homeworkWrap: true });
  document.getElementById("app").append(view.el);
  try {
    const col = $("#ic-col-t").parentNode;   // Abschnitt der Spalte (die Kennung trägt ihre Überschrift)
    const pack = $(".ic-pack", col);
    assert.ok(pack, "Paket in der Spalte „Nur für die Lehrkraft“");
    assert.equal($(".ic-name", pack).textContent, "1x - farbig - einseitig - Reli2 - Sitzungspaket.pdf");
    assert.equal($(".ic-main > .ic-meta", pack).textContent, "Sitzungspaket · 2 Materialien in der Reihenfolge des Verlaufsplans");
    assert.deepEqual($$(".ic-member .ic-name", pack).map((x) => x.textContent), ["1x - farbig - einseitig - Reli2 - Ausmalbild.pdf", "1x - farbig - einseitig - Reli2 - Konzentration.pdf"]);
    assert.deepEqual($$(".ic-item", col).filter((x) => !x.classList.contains("ic-member")).map((x) => $(".ic-name", x).textContent),
      ["1x - farbig - einseitig - Reli2 - Sitzungspaket.pdf", "28x - sw - beidseitig - Reli2 - Lied.pdf"], "das Paket vor den übrigen Druckdateien");
    D.userClick(button(pack, "Herunterladen – 1x - farbig - einseitig - Reli2 - Sitzungspaket.pdf"));
    await until(() => blobs.length === 1, "Paket heruntergeladen");
    assert.deepEqual((await pagesOf(new Uint8Array(await blobs[0].arrayBuffer()))).map((p) => p[0]), [502, 501], "Reihenfolge des Verlaufsplans");
  } finally { view.destroy(); globalThis.fetch = real; URL.createObjectURL = orig; }
});
