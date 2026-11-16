// cardsprint.mjs – End-to-End-Prüfung „Bildkarten auf der Druckliste“ (Nachtrag 31): Bildkarten der Grundschule gehören immer zu den Dateien, die die
// Lehrkraft für die Sitzung ausdruckt – 1x, einseitig, farbig („1x - farbig - einseitig - Reli2 - <Titel>.pdf“, Muster von Nachtrag 32), abwählbar, nur neue Bildkarten.
// Geprüft in der Grundschul-Sitzung am nächsten Arbeitstag (gsL): von Claude gestaltete Bildkarten (Connector, gedruckt vom Chromium der Drucker-Attrappe)
// → Druckliste der Sitzung (Zeile, Einzel-Download unter dem Druck-Namen, ZIP-Datei entpackt: alle Karten, A4 quer, eine Karte je Seite) und „Druckaufträge
// für den nächsten Arbeitstag“; herunternehmen und wieder aufnehmen (Bildkarten und Elternansicht bleiben); Claude gestaltet neu → die Einstellung der
// Lehrkraft bleibt; noch nicht gedruckt bzw. Druck fehlgeschlagen → nie stillschweigend weg (Zeile, ZIP-Hinweis, „Erneut drucken“); hochgeladene
// Bildkarten-PDF ebenso; ältere Bildkarten (ohne Druckangaben, wie vor der Änderung) bleiben herunter, lassen sich von Hand aufnehmen; get_lesson und
// save_verlaufsplan erinnern an Bildkarten zu einer Geschichte. Am Ende ist alles wie vorher (Bildkarten gelöscht, Verlaufsplan zurück).
// Bildschirmfotos 1366/820/390 px, hell und dunkel, in OUT („bildkarten-druck-*.png“). Frei erfundene Inhalte, ASCII-Titel (Chromium dieser Umgebung speichert
// Downloads mit Umlauten im Namen als „download“).
// ctx = {tp (Seite der Lehrkraft, angemeldet), BASE, T (Fetch mit Anmeldung), tool (Connector), ok, OUT, SHOT, gsL, printer (Attrappe: mode), d1 (SQL auf
// der lokalen D1), horizontalIssues}
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { PDFDocument, rgb } from "pdf-lib";
import { readZip } from "../../public/zip.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// n Bildkarten im Format A4 quer, eine Karte je Seite (wie laut Gestaltungsregeln) – farbig
export const cardsHtml = (n, label = "Karte") => '<!doctype html><html lang="de"><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:0}body{margin:0}' +
  "section{width:297mm;height:209mm;overflow:hidden;display:grid;place-items:center;break-after:page}section:last-child{break-after:auto}h2{font:700 40pt sans-serif;margin:0}</style></head><body>" +
  Array.from({ length: n }, (_, i) => '<section><svg width="420" height="300" viewBox="0 0 420 300" role="img" aria-label="' + label + " " + (i + 1) + '"><circle cx="210" cy="150" r="' + (50 + i * 20) +
    '" fill="' + ["#e05d00", "#2557c7", "#2f9e44", "#c92a2a"][i % 4] + '"/></svg><h2>' + label + " " + (i + 1) + "</h2></section>").join("") + "</body></html>";
// hochgeladene Bildkarten: eine PDF mit n Seiten A4 quer (bzw. im Format size, z. B. A5 quer)
async function cardsPdf(n, size = [841.89, 595.28]) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) { const p = d.addPage(size); p.drawRectangle({ x: size[0] * 0.24, y: size[1] * 0.25, width: size[0] * 0.52, height: size[1] * 0.5, color: rgb(0.2, 0.4, 0.8) }); p.drawText("Bild " + (i + 1), { x: size[0] * 0.43, y: 30, size: 24 }); }
  return Buffer.from(await d.save());
}
// alle Seiten A4 quer?
async function pdfInfo(buf) {
  const doc = await PDFDocument.load(buf), sizes = doc.getPages().map((p) => p.getSize());
  return { pages: doc.getPageCount(), landscape: sizes.every((s) => Math.abs(s.width - 841.89) < 2 && Math.abs(s.height - 595.28) < 2) };
}

export async function cardsPrintE2E({ tp, BASE, T, tool, ok, OUT, SHOT, gsL, printer, d1, horizontalIssues }) {
  const card = tp.locator("#printcard"), cbox = tp.locator("#gs-cards");
  // Zeile genau dieses Druck-Namens (die Druckliste der Sitzung hat noch andere Zeilen, z. B. „22x - sw - einseitig - Reli2 - …“)
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rowOf = (name) => card.locator(".printrow", { has: tp.locator(".name", { hasText: new RegExp("^" + esc(name) + "$") }) });
  const lessonFiles = async () => (await T("GET", "/api/teacher/lessons/" + gsL)).data.files;
  const pnFiles = async () => (await T("GET", "/api/teacher/print-next")).data.sessions.filter((s) => s.id === gsL).flatMap((s) => s.files);
  // „Alle Dateien herunterladen“ und Statuszeile des Tages der Sitzung (Nachtrag 33: laufen heute noch Sitzungen mit Druckaufträgen, hat jeder Tag einen eigenen Knopf)
  const gsDay = (await T("GET", "/api/teacher/lessons/" + gsL)).data.lesson.date;
  const allOfDay = () => tp.locator('.printnext button.pn-all[data-day="' + gsDay + '"]'), statusOfDay = () => tp.locator('.printnext .pn-status[data-day="' + gsDay + '"]');
  // „Alle Dateien herunterladen“ des Tages (Nachtrag 36: EINE ZIP-Datei) → {count: Zahl der Downloads, entries} – genau ein Download erwartet
  const dayZip = async () => {
    const got = [], onDl = (d) => got.push(d);
    tp.on("download", onDl);
    await allOfDay().click();
    await statusOfDay().filter({ hasText: /^Fertig/ }).waitFor({ timeout: 120000 });
    await sleep(500); tp.off("download", onDl);
    return { count: got.length, entries: got.length === 1 ? await readZip(new Uint8Array(readFileSync(await got[0].path()))) : [] };
  };
  // die Sitzung frisch laden (derselbe Hash lädt mit goto nicht neu)
  const openSession = async () => {
    const want = BASE + "/#/lk/s/" + gsL + "/druckliste";
    if (tp.url() === want) await tp.reload(); else await tp.goto(want);
    await card.locator(".printrow").first().waitFor({ timeout: 20000 }); await cbox.waitFor({ timeout: 15000 });
  };
  // ZIP-Datei der Druckliste herunterladen und entpacken → {names, entries}
  const zip = async () => {
    if (await card.getByRole("button", { name: "Alle herunterladen (ZIP)" }).isDisabled()) return { names: [], entries: [] };   // nichts auf der Liste
    const [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 60000 }), card.getByRole("button", { name: "Alle herunterladen (ZIP)" }).click()]);
    const entries = await readZip(new Uint8Array(readFileSync(await dl.path())));
    return { names: entries.map((e) => e.name), entries };
  };
  const plan0 = (await T("GET", "/api/teacher/lessons/" + gsL)).data.lesson;

  /* ---------- a) Claude gestaltet Bildkarten (Connector): auf der Druckliste, 1x einseitig farbig ---------- */
  const NAME = "1x - farbig - einseitig - Reli2 - Bildkarten Schoepfung.pdf";
  let r = await tool("add_picture_cards", { lesson_id: gsL, titel: "Bildkarten Schoepfung", html: cardsHtml(3), erzaehltexte: ["Gott macht das Licht.", "Gott macht das Land und das Meer.", "Gott macht die Tiere."] });
  const cid = r.structuredContent && r.structuredContent.file_id;
  ok(!r.isError && r.structuredContent.pages === 3 && r.structuredContent.druckliste === NAME && r.content[0].text.includes("Sie stehen auf der Druckliste der Lehrkraft als „" + NAME + "“ (1x, einseitig, farbig)."),
    "add_picture_cards (neu): gedruckt, 3 Karten, die Antwort nennt die Druckliste „" + NAME + "“ – " + (r.content ? r.content[0].text.slice(0, 90) : ""));
  let f = (await lessonFiles()).find((x) => x.id === cid);
  ok(f && f.area === "teacher" && f.cards && f.print && f.print.copies === 1 && f.print.duplex === false && f.print.color === true && f.printName === NAME,
    "Server: Bildkarten bleiben Dateien der Lehrkraft (area teacher) mit Druckangaben 1x, einseitig, Farbe (nie die Schülerzahl)");
  let pn = await pnFiles();
  ok(pn.some((x) => x.id === cid && x.printName === NAME && x.cards), "„Druckaufträge für den nächsten Arbeitstag“ (Server): die Bildkarten stehen im Eintrag der Sitzung");
  let g = await tool("get_lesson", { lesson_id: gsL });
  ok(g.content[0].text.includes("  Druckliste der Lehrkraft: „" + NAME + "“."), "get_lesson: Abschnitt „Bildkarten“ nennt die Druckliste");

  // Druckliste der Sitzung: Zeile mit 1 Exemplar, einseitig, Farbe; Karte „Bildkarten“ mit eingeschaltetem Schalter
  await openSession();
  const row = rowOf(NAME);
  await row.waitFor({ timeout: 15000 });
  await cbox.locator("#cs-print-" + cid).waitFor({ timeout: 15000 });
  await cbox.locator("#cs-" + cid + " .cs-state", { hasText: "3 Karten · Bilder bereit" }).waitFor({ timeout: 60000 });   // Bilder für die Elternansicht (Browser)
  ok(await row.locator("input.pcopies").inputValue() === "1" && await row.locator('select[aria-label^="Beidseitig oder einseitig"]').inputValue() === "0" && await row.locator('select[aria-label^="Schwarz-weiß oder farbig"]').inputValue() === "1"
    && (await row.locator(".meta").textContent()).includes("Bildkarten") && await row.getByRole("button", { name: "Nicht ausdrucken – " + NAME }).count() === 1 && await row.locator("button.danger").count() === 0,
    "Druckliste der Sitzung: „" + NAME + "“ – 1 Exemplar, einseitig, Farbe, „Nicht ausdrucken“ statt Löschen");
  ok(await cbox.locator("#cs-print-" + cid).isChecked() && (await cbox.locator("#cs-print-d-" + cid).textContent()).includes("„" + NAME + "“") && (await tp.locator("#print-cards-hint").textContent()).includes("Neue Bildkarten"),
    "Karte „Bildkarten“: Schalter „Auf der Druckliste“ eingeschaltet, Name darunter; Hinweis über der Druckliste");
  ok(await tp.locator("#gs-material").getByText("Bildkarten Schoepfung").count() === 0, "… nicht im Materialkasten (wie bisher)");
  // einzeln herunterladen: Name der Druckliste, alle Karten, A4 quer
  let [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), row.getByRole("button", { name: "Herunterladen" }).click()]);
  let info = await pdfInfo(readFileSync(await dl.path()));
  ok(dl.suggestedFilename() === NAME && info.pages === 3 && info.landscape, "Einzel-Download aus der Druckliste: „" + dl.suggestedFilename() + "“, " + info.pages + " Seiten A4 quer");
  // signierter Link der Druckliste: der Server nennt die Datei selbst so (auch wo der Browser das download-Attribut nicht beachtet, GitHub Pages)
  const link = (await T("POST", "/api/teacher/files/" + cid + "/link", { print: true })).data.url, plain = (await T("POST", "/api/teacher/files/" + cid + "/link", {})).data.url;
  const cd = async (u) => (await fetch(BASE + u)).headers.get("content-disposition") || "";
  ok((await cd(link)).includes('filename="' + NAME + '"'), "Link aus der Druckliste: Content-Disposition mit dem Druck-Namen");
  ok(!(await cd(plain)).includes("1x - farbig - einseitig"), "… ohne print (z. B. „Als PDF ansehen“): der Name der Bildkarten wie bisher");
  // ZIP-Datei: die vollständige PDF unter dem Namen der Druckliste
  let z = await zip();
  let ze = z.entries.find((e) => e.name === NAME);
  info = ze ? await pdfInfo(Buffer.from(ze.data)) : { pages: 0 };
  ok(!!ze && info.pages === 3 && info.landscape && await tp.locator("#print-zip-note").isHidden(), "ZIP-Datei der Druckliste: „" + NAME + "“ – " + info.pages + " Seiten = 3 Karten, A4 quer (" + z.names.length + " Dateien)");

  // Startseite: „Druckaufträge für den nächsten Arbeitstag“ – Zeile im Eintrag der Sitzung, Download unter dem Druck-Namen
  await tp.goto(BASE + "/#/lk");
  const pnRow = tp.locator(".printnext .pn-group", { has: tp.locator('a[href="#/lk/s/' + gsL + '"]') }).locator(".pn-row", { hasText: NAME });
  await pnRow.waitFor({ timeout: 20000 });
  ok((await pnRow.locator(".meta").textContent()).includes("Bildkarten"), "Startseite „Druckaufträge für den nächsten Arbeitstag“: „" + NAME + "“ im Eintrag der Grundschul-Sitzung");
  [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), pnRow.getByRole("button", { name: "Herunterladen – " + NAME }).click()]);
  info = await pdfInfo(readFileSync(await dl.path()));
  ok(dl.suggestedFilename() === NAME && info.pages === 3 && info.landscape, "… Download dort: „" + dl.suggestedFilename() + "“, " + info.pages + " Seiten A4 quer");
  // „Alle Dateien herunterladen“ nimmt sie mit (Nachtrag 36: in der ZIP-Datei des Tages)
  const dz = await dayZip(), mine = dz.entries.find((e) => e.name === NAME);
  info = mine ? await pdfInfo(mine.data) : { pages: 0 };
  ok(dz.count === 1 && !!mine && info.pages === 3 && info.landscape, "„Alle Dateien herunterladen“: eine ZIP-Datei (" + dz.count + " Download, " + dz.entries.length + " Dateien), die Bildkarten sind dabei („" + NAME + "“ mit 3 Seiten A4 quer)");
  await shots(tp, ".printnext", "druckauftraege", { OUT, SHOT, ok, horizontalIssues });

  /* ---------- b) herunternehmen (Druckliste) und wieder aufnehmen (Karte „Bildkarten“) – die Bildkarten und die Elternansicht bleiben ---------- */
  // Verlaufsplan verweist auf die Bildkarten (so sehen Eltern sie in der Vorschau der Lehrkraft); der bisherige Plan wird am Ende zurückgeschrieben
  r = await tool("save_verlaufsplan", { lesson_id: gsL, text: "**1) Erzählung: Die Schöpfung (15 Min., Sitzkreis)**\n- [[pdf:" + cid + "]] Karten der Reihe nach zeigen" });
  ok(!r.isError && !r.content[0].text.includes("noch keine Bildkarten"), "save_verlaufsplan mit Erzählung und Bildkarten: keine Erinnerung an Bildkarten");
  const parents = async () => { const v = (await T("GET", "/api/teacher/lessons/" + gsL + "/parents")).data; return JSON.stringify((v.cards || []).map((x) => [x.fileId, x.name, x.texts, x.pages])); };
  const parentsBefore = await parents();
  await openSession();
  await rowOf(NAME).getByRole("button", { name: "Nicht ausdrucken – " + NAME }).click();
  await rowOf(NAME).waitFor({ state: "detached", timeout: 10000 });
  await tp.waitForFunction((id) => !document.getElementById("cs-print-" + id).checked, cid, { timeout: 5000 });
  const focusHead = await tp.evaluate(() => document.activeElement && document.activeElement.closest("#printcard") && document.activeElement.tagName === "H2");
  f = (await lessonFiles()).find((x) => x.id === cid);
  ok(f && f.cards && !f.print && (await parents()) === parentsBefore && parentsBefore.includes(cid), "„Nicht ausdrucken“: nicht mehr auf der Liste – die Bildkarten bleiben, die Elternansicht ist unverändert");
  ok(focusHead && (await cbox.locator("#cs-print-d-" + cid).textContent()).startsWith("Steht nicht auf der Druckliste"), "… Fokus auf „Von der Lehrkraft auszudrucken“ (die Zeile ist weg), Schalter der Karte aus");
  ok(!(await pnFiles()).some((x) => x.id === cid), "… nicht mehr bei „Druckaufträge für den nächsten Arbeitstag“");
  z = await zip();
  ok(!z.names.includes(NAME), "… nicht mehr in der ZIP-Datei (" + z.names.length + " Dateien)");
  // wieder aufnehmen über den Schalter der Karte „Bildkarten“ (Tastatur) – 1x, einseitig, farbig
  await cbox.locator("#cs-print-" + cid).focus();
  await tp.keyboard.press("Space");
  await rowOf(NAME).waitFor({ timeout: 10000 });
  ok(await cbox.locator("#cs-print-" + cid).isChecked() && await tp.evaluate((id) => document.activeElement && document.activeElement.id === "cs-print-" + id, cid)
    && (await pnFiles()).some((x) => x.id === cid && x.printName === NAME), "Schalter (Leertaste): wieder auf der Druckliste als „" + NAME + "“, Fokus bleibt auf dem Schalter");
  // Anzahl und Farbe in der Druckliste ändern wie bei anderen Einträgen; die Karte „Bildkarten“ zeigt den neuen Namen
  const NAME2 = "2x - sw - einseitig - Reli2 - Bildkarten Schoepfung.pdf";
  const NAME1b = "2x - farbig - einseitig - Reli2 - Bildkarten Schoepfung.pdf";
  await rowOf(NAME).locator("input.pcopies").fill("2"); await rowOf(NAME).locator("input.pcopies").press("Tab");
  await rowOf(NAME1b).waitFor({ timeout: 10000 });
  await rowOf(NAME1b).locator('select[aria-label^="Schwarz-weiß oder farbig"]').selectOption("0");   // Nachtrag 32: Farbe vor einseitig/beidseitig
  await rowOf(NAME2).waitFor({ timeout: 10000 });
  await tp.waitForFunction(([id, n]) => (document.getElementById("cs-print-d-" + id) || {}).textContent.includes(n), [cid, NAME2], { timeout: 5000 });
  ok((await lessonFiles()).find((x) => x.id === cid).printName === NAME2, "Druckliste: 2 Exemplare, schwarz-weiß → „" + NAME2 + "“ (auch in der Karte „Bildkarten“)");
  // Claude gestaltet neu (file_id): die Einstellung der Lehrkraft bleibt
  r = await tool("add_picture_cards", { lesson_id: gsL, titel: "Bildkarten Schoepfung", html: cardsHtml(4), erzaehltexte: ["Licht.", "Land.", "Tiere.", "Menschen."], file_id: cid });
  ok(!r.isError && r.structuredContent.pages === 4 && r.structuredContent.druckliste === NAME2 && r.content[0].text.includes("(ihre Druckeinstellung bleibt)"), "add_picture_cards mit file_id: neu gedruckt (4 Karten), Druckeinstellung der Lehrkraft bleibt („" + NAME2 + "“)");
  await T("PATCH", "/api/teacher/files/" + cid, { copies: null });
  r = await tool("add_picture_cards", { lesson_id: gsL, titel: "Bildkarten Schoepfung", html: cardsHtml(4), erzaehltexte: ["Licht.", "Land.", "Tiere.", "Menschen."], file_id: cid });
  f = (await lessonFiles()).find((x) => x.id === cid);
  ok(!r.isError && !f.print && r.structuredContent.druckliste === null && r.content[0].text.includes("Sie stehen nicht auf der Druckliste der Lehrkraft"), "… heruntergenommen und neu gestaltet: bleibt herunter");
  r = await T("PATCH", "/api/teacher/files/" + cid, { copies: 1 });
  ok(r.status === 200 && r.data.file.printName === NAME, "wieder aufnehmen nur mit Anzahl: einseitig und Farbe wie für Bildkarten vorgesehen („" + NAME + "“)");
  // die aktuelle Gestaltung (4 Karten) steckt in der ZIP-Datei
  await openSession();
  z = await zip(); ze = z.entries.find((e) => e.name === NAME); info = ze ? await pdfInfo(Buffer.from(ze.data)) : { pages: 0 };
  ok(info.pages === 4 && info.landscape, "ZIP-Datei: die neue Gestaltung – " + info.pages + " Seiten = 4 Karten, A4 quer");
  await shots(tp, "#printcard", "druckliste", { OUT, SHOT, ok, horizontalIssues });
  await shots(tp, "#cs-" + cid, "karte", { OUT, SHOT, ok, horizontalIssues });

  /* ---------- c) noch nicht gedruckt bzw. Druck fehlgeschlagen: nie stillschweigend weg ---------- */
  const NAME3 = "1x - farbig - einseitig - Reli2 - Bildkarten Arche.pdf";
  printer.mode = "busy";
  r = await tool("add_picture_cards", { lesson_id: gsL, titel: "Bildkarten Arche", html: cardsHtml(2, "Arche"), erzaehltexte: ["Noah baut eine Arche.", "Die Tiere kommen."] });
  const aid = r.structuredContent && r.structuredContent.file_id;
  ok(!r.isError && r.content[0].text.includes("noch nicht als PDF gedruckt") && r.structuredContent.druckliste === NAME3, "Drucker ausgelastet: Bildkarten gespeichert, noch nicht gedruckt – stehen schon auf der Druckliste");
  await openSession();
  const arow = rowOf(NAME3);
  await arow.locator(".meta", { hasText: /wartet auf den PDF-Drucker|wird als PDF gedruckt/ }).waitFor({ timeout: 20000 });
  ok(await arow.getByRole("button", { name: "Herunterladen" }).count() === 0, "Druckliste: Zeile „" + NAME3 + "“ – „wird als PDF gedruckt“, (noch) ohne Download");
  z = await zip();
  const note = await tp.locator("#print-zip-note").textContent();
  ok(!z.names.includes(NAME3) && z.names.includes(NAME) && note.startsWith("Nicht in der ZIP-Datei – die Bildkarten „" + NAME3 + "“ (wird gerade als PDF gedruckt"),
    "ZIP-Datei ohne die noch nicht gedruckten Bildkarten – der Hinweis unter dem Knopf nennt sie: „" + note.slice(0, 110) + "…“");
  await shots(tp, "#printcard", "druckliste-wartet", { OUT, SHOT, ok, horizontalIssues });
  printer.mode = "ok";
  await arow.getByRole("button", { name: "Herunterladen" }).waitFor({ timeout: 60000 });
  await tp.locator("#print-zip-note", { hasText: "jetzt gedruckt" }).waitFor({ timeout: 10000 });
  z = await zip(); ze = z.entries.find((e) => e.name === NAME3); info = ze ? await pdfInfo(Buffer.from(ze.data)) : { pages: 0 };
  ok(info.pages === 2 && info.landscape && await tp.locator("#print-zip-note").isHidden(), "… sobald der Drucker wieder druckt: Hinweis „jetzt gedruckt“, danach in der ZIP-Datei (2 Seiten A4 quer)");
  // Druck der neuen Gestaltung schlägt fehl: die bisherige PDF zeigt alte Karten – nicht herunterladbar, „Erneut drucken“, im ZIP-Hinweis und auf der Startseite genannt
  printer.mode = "fail";
  r = await tool("add_picture_cards", { lesson_id: gsL, titel: "Bildkarten Arche", html: cardsHtml(3, "Arche"), erzaehltexte: ["Noah baut.", "Die Tiere.", "Der Regenbogen."], file_id: aid });
  ok(r.content[0].text.includes("noch nicht als PDF gedruckt") && r.content[0].text.includes("(ihre Druckeinstellung bleibt)"), "neue Gestaltung, Drucker lehnt ab: Antwort sagt es, Druckeinstellung bleibt");
  await openSession();
  await arow.locator(".meta", { hasText: "Druck fehlgeschlagen" }).waitFor({ timeout: 20000 });
  ok(await arow.getByRole("button", { name: "Herunterladen" }).count() === 0 && await arow.getByRole("button", { name: "Erneut drucken" }).count() === 1 && (await arow.getAttribute("class")).includes("design-err"),
    "Druckliste: „Druck fehlgeschlagen … die neue Gestaltung der Bildkarten ist noch nicht gedruckt“ – kein Download der alten Karten, „Erneut drucken“");
  z = await zip();
  ok(!z.names.includes(NAME3) && (await tp.locator("#print-zip-note").textContent()).includes("„" + NAME3 + "“ (der PDF-Druck hat nicht geklappt – bei der Datei „Erneut drucken“)"), "ZIP-Datei: ohne sie, der Hinweis nennt sie mit „Erneut drucken“");
  await shots(tp, "#printcard", "druckliste-fehlgeschlagen", { OUT, SHOT, ok, horizontalIssues });
  await tp.goto(BASE + "/#/lk");
  const apn = tp.locator(".printnext .pn-row", { hasText: NAME3 });
  await apn.waitFor({ timeout: 20000 });
  ok((await apn.locator(".meta").textContent()).includes("Druck fehlgeschlagen") && await apn.getByRole("button", { name: /^Herunterladen/ }).count() === 0, "Startseite: dieselbe Zeile „Druck fehlgeschlagen“, ohne Download");
  printer.mode = "ok";
  await openSession();
  await arow.getByRole("button", { name: "Erneut drucken" }).click();
  await arow.getByRole("button", { name: "Herunterladen" }).waitFor({ timeout: 60000 });
  z = await zip(); ze = z.entries.find((e) => e.name === NAME3); info = ze ? await pdfInfo(Buffer.from(ze.data)) : { pages: 0 };
  ok(info.pages === 3 && info.landscape, "„Erneut drucken“: gedruckt – in der ZIP-Datei mit der neuen Gestaltung (3 Seiten A4 quer)");

  /* ---------- c2) Prüfung: die Sitzung bleibt offen, Claude arbeitet im Fenster daneben (kein Wechsel des Tabs, kein Neuladen) ----------
     vorher: die ZIP-Datei nahm den Stand beim Öffnen – neue Bildkarten fehlten, neu gestaltete kamen mit den alten Karten hinein, beides ohne Hinweis */
  const NAME5 = "1x - farbig - einseitig - Reli2 - Bildkarten Rut.pdf";
  r = await tool("add_picture_cards", { lesson_id: gsL, titel: "Bildkarten Rut", html: cardsHtml(2, "Rut"), erzaehltexte: ["Rut geht mit Noomi.", "Rut sammelt Ähren."] });
  const rid = r.structuredContent && r.structuredContent.file_id;
  printer.mode = "busy";
  r = await tool("add_picture_cards", { lesson_id: gsL, titel: "Bildkarten Arche", html: cardsHtml(4, "Arche"), erzaehltexte: ["Noah baut.", "Die Tiere.", "Der Regen.", "Der Regenbogen."], file_id: aid });
  ok(!r.isError && r.content[0].text.includes("noch nicht als PDF gedruckt") && await rowOf(NAME5).count() === 0 && await rowOf(NAME3).getByRole("button", { name: "Herunterladen" }).count() === 1,
    "Seite offen geblieben: neue Bildkarten noch nicht in der Liste, die Zeile „" + NAME3 + "“ zeigt noch die alte Gestaltung");
  // Einzel-Download aus der veralteten Zeile: der Server gibt die alten Karten nicht heraus
  await rowOf(NAME3).getByRole("button", { name: "Herunterladen" }).click();
  await tp.locator("#toasts", { hasText: "„Bildkarten Arche“ sind in ihrer neuen Gestaltung noch nicht als PDF gedruckt" }).waitFor({ timeout: 10000 });
  ok(true, "… Einzel-Download der alten Karten abgelehnt: „Die Bildkarten „Bildkarten Arche“ sind in ihrer neuen Gestaltung noch nicht als PDF gedruckt – bitte die Seite neu laden …“");
  z = await zip();
  ze = z.entries.find((e) => e.name === NAME5); info = ze ? await pdfInfo(Buffer.from(ze.data)) : { pages: 0 };
  const note5 = await tp.locator("#print-zip-note").textContent();
  ok(info.pages === 2 && info.landscape && !z.names.includes(NAME3) && note5.startsWith("Nicht in der ZIP-Datei – die Bildkarten „" + NAME3 + "“ (wird gerade als PDF gedruckt") && await rowOf(NAME5).count() === 1,
    "ZIP-Datei ohne Neuladen: holt den Stand vom Server – die neuen Bildkarten sind dabei (2 Seiten A4 quer), die neu gestalteten nicht mit den alten Karten, sondern im Hinweis: „" + note5.slice(0, 100) + "…“");
  printer.mode = "ok";
  await rowOf(NAME3).getByRole("button", { name: "Herunterladen" }).waitFor({ timeout: 90000 });
  z = await zip(); ze = z.entries.find((e) => e.name === NAME3); info = ze ? await pdfInfo(Buffer.from(ze.data)) : { pages: 0 };
  ok(info.pages === 4 && info.landscape && z.names.includes(NAME5), "… gedruckt: die neue Gestaltung (4 Seiten A4 quer) in der ZIP-Datei");

  /* ---------- d) hochgeladene Bildkarten-PDF: ebenfalls auf der Druckliste ---------- */
  const NAME4 = "1x - farbig - einseitig - Reli2 - Josef Bilder.pdf";
  await cbox.locator("#gs-cards-file").setInputFiles({ name: "Josef Bilder.pdf", mimeType: "application/pdf", buffer: await cardsPdf(5) });
  const urow = rowOf(NAME4);
  await urow.waitFor({ timeout: 30000 });
  const uid = (await lessonFiles()).find((x) => x.name === "Josef Bilder.pdf").id;
  await cbox.locator("#cs-" + uid + " .cs-state", { hasText: "5 Karten · Bilder bereit" }).waitFor({ timeout: 60000 });
  ok(await cbox.locator("#cs-print-" + uid).isChecked() && (await pnFiles()).some((x) => x.id === uid && x.printName === NAME4), "Hochgeladene Bildkarten: sofort auf der Druckliste der Sitzung und bei den Druckaufträgen („" + NAME4 + "“)");
  [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), urow.getByRole("button", { name: "Herunterladen" }).click()]);
  info = await pdfInfo(readFileSync(await dl.path()));
  ok(dl.suggestedFilename() === NAME4 && info.pages === 5 && info.landscape, "… Einzel-Download: „" + dl.suggestedFilename() + "“, 5 Seiten A4 quer");
  z = await zip(); ze = z.entries.find((e) => e.name === NAME4); info = ze ? await pdfInfo(Buffer.from(ze.data)) : { pages: 0 };
  ok(info.pages === 5 && info.landscape, "… in der ZIP-Datei: 5 Seiten A4 quer");
  // Prüfung: eine hochgeladene Bildkarten-PDF in einem anderen Format (z. B. A5 quer vom Verlag) kommt in allen Druckdateien auf A4 (quer bleibt quer);
  // gespeichert bleibt sie, wie sie war (daraus entstehen die Kartenbilder der Elternansicht)
  const NAME6 = "1x - farbig - einseitig - Reli2 - Verlag A5.pdf", A5Q = [595.28, 419.53];
  await cbox.locator("#gs-cards-file").setInputFiles({ name: "Verlag A5.pdf", mimeType: "application/pdf", buffer: await cardsPdf(3, A5Q) });
  const vrow = rowOf(NAME6);
  await vrow.waitFor({ timeout: 30000 });
  const vid = (await lessonFiles()).find((x) => x.name === "Verlag A5.pdf").id;
  [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), vrow.getByRole("button", { name: "Herunterladen" }).click()]);
  info = await pdfInfo(readFileSync(await dl.path()));
  ok(dl.suggestedFilename() === NAME6 && info.pages === 3 && info.landscape, "Hochgeladen in A5 quer – Einzel-Download aus der Druckliste: „" + dl.suggestedFilename() + "“, " + info.pages + " Seiten A4 quer");
  z = await zip(); ze = z.entries.find((e) => e.name === NAME6); info = ze ? await pdfInfo(Buffer.from(ze.data)) : { pages: 0 };
  ok(info.pages === 3 && info.landscape, "… in der ZIP-Datei: 3 Seiten A4 quer");
  const stored = await PDFDocument.load(await (await fetch(BASE + (await T("POST", "/api/teacher/files/" + vid + "/link", {})).data.url)).arrayBuffer());
  ok(stored.getPages().every((p) => Math.abs(p.getWidth() - A5Q[0]) < 1 && Math.abs(p.getHeight() - A5Q[1]) < 1), "… gespeichert bleibt die PDF im Format der Lehrkraft (A5 quer)");
  // Startseite: Einzel-Download ebenfalls A4; „Alle Dateien herunterladen“ lädt in der Grundschule erst neu – Bildkarten, die Claude seit dem Öffnen der Startseite
  // angelegt hat, sind dabei
  await tp.goto(BASE + "/#/lk");
  const vpn = tp.locator(".printnext .pn-row", { hasText: NAME6 });
  await vpn.waitFor({ timeout: 20000 });
  [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), vpn.getByRole("button", { name: "Herunterladen – " + NAME6 }).click()]);
  info = await pdfInfo(readFileSync(await dl.path()));
  ok(dl.suggestedFilename() === NAME6 && info.pages === 3 && info.landscape, "Startseite: „" + NAME6 + "“ – " + info.pages + " Seiten A4 quer");
  const NAME7 = "1x - farbig - einseitig - Reli2 - Bildkarten Ester.pdf";
  r = await tool("add_picture_cards", { lesson_id: gsL, titel: "Bildkarten Ester", html: cardsHtml(2, "Ester"), erzaehltexte: ["Ester wird Königin.", "Ester bittet den König."] });
  const eid = r.structuredContent && r.structuredContent.file_id;
  ok(await tp.locator(".printnext .pn-row", { hasText: NAME7 }).count() === 0, "… Startseite offen geblieben: die neuen Bildkarten stehen noch nicht in der Liste");
  const dz2 = await dayZip(), est = dz2.entries.find((e) => e.name === NAME7);
  info = est ? await pdfInfo(est.data) : { pages: 0 };
  ok(dz2.count === 1 && !!est && info.pages === 2 && info.landscape && await tp.locator(".printnext .pn-row", { hasText: NAME7 }).count() === 1, "„Alle Dateien herunterladen“ ohne Neuladen der Seite: die neuen Bildkarten „" + NAME7 + "“ sind in der ZIP-Datei (2 Seiten A4 quer)");

  /* ---------- e) ältere Bildkarten (vor der Änderung angelegt, ohne Druckangaben): bleiben herunter, lassen sich von Hand aufnehmen ---------- */
  const up = await fetch(BASE + "/api/teacher/lessons/" + gsL + "/cards?name=" + encodeURIComponent("Alte Karten.pdf"), { method: "POST", headers: { Authorization: "Bearer " + (await tp.evaluate(() => localStorage.getItem("u.ttoken"))), "Content-Type": "application/pdf" }, body: await cardsPdf(2) }).then((x) => x.json());
  const oid = up.file.id;
  d1("UPDATE files SET print_copies=NULL, print_duplex=NULL, print_color=NULL WHERE id='" + oid + "'");   // so lag eine Zeile vor dem 16.11.2026 in D1
  ok(!(await pnFiles()).some((x) => x.id === oid) && !(await lessonFiles()).find((x) => x.id === oid).print, "Alte Bildkarten ohne Druckangaben: nicht bei den Druckaufträgen (keine Nachrüstung)");
  await openSession();
  await cbox.locator("#cs-print-" + oid).waitFor({ timeout: 15000 });
  ok(!(await cbox.locator("#cs-print-" + oid).isChecked()) && await card.locator(".printrow", { hasText: "Alte Karten" }).count() === 0 && (await cbox.locator("#cs-print-d-" + oid).textContent()).startsWith("Steht nicht auf der Druckliste"),
    "… nicht auf der Druckliste der Sitzung, Schalter aus");
  g = await tool("get_lesson", { lesson_id: gsL });
  ok(g.content[0].text.includes("„Alte Karten.pdf“") && g.content[0].text.includes("  Nicht auf der Druckliste der Lehrkraft (heruntergenommen oder vor dem 16.11.2026 angelegt)"), "get_lesson: „Nicht auf der Druckliste der Lehrkraft“");
  await cbox.locator("#cs-print-" + oid).check();
  await rowOf("1x - farbig - einseitig - Reli2 - Alte Karten.pdf").waitFor({ timeout: 10000 });
  ok((await pnFiles()).some((x) => x.id === oid), "… von Hand aufgenommen: auf der Druckliste und bei den Druckaufträgen");

  /* ---------- g) wiederverwendete Bildkarten (Nachtrag 31b): Verweis im Verlaufsplan auf Bildkarten einer anderen Sitzung des Kurses → auch auf dieser Druckliste ---------- */
  {
    const me = (await T("GET", "/api/teacher/lessons/" + gsL)).data.lesson;
    // eine frühere Sitzung desselben Kurses (Sitzungen entstehen sonst aus Zeilen einer Einheit – hier direkt in D1, wie in e))
    const prevL = "e31b" + Date.now().toString(16).slice(-12).padStart(12, "0");
    d1("INSERT INTO lessons(id, subject, klass, title, lesson_date, code, created_at, updated_at) VALUES('" + prevL + "', 'gs', '" + me.klass + "', 'Noah baut die Arche', '2026-10-05', 'E31B" + prevL.slice(-4).toUpperCase() + "', 1, 1)");
    const up2 = await fetch(BASE + "/api/teacher/lessons/" + prevL + "/cards?name=" + encodeURIComponent("Arche Karten.pdf"), { method: "POST",
      headers: { Authorization: "Bearer " + (await tp.evaluate(() => localStorage.getItem("u.ttoken"))), "Content-Type": "application/pdf" }, body: await cardsPdf(2, [595.28, 419.53]) }).then((x) => x.json());
    const aid2 = up2.file.id, NAMER = "1x - farbig - einseitig - Reli2 - Arche Karten.pdf";
    r = await tool("save_verlaufsplan", { lesson_id: gsL, text: "**1) Erzählung: Die Arche (15 Min., Sitzkreis)**\n- Lehrkraft erzählt mit den Bildkarten [[pdf:" + aid2 + "]]" });
    ok(!r.isError && r.content[0].text.includes("Wiederverwendete Bildkarten „Arche Karten.pdf“ stehen auch auf der Druckliste dieser Sitzung (1x, einseitig, farbig)."),
      "save_verlaufsplan: Verweis auf Bildkarten der früheren Sitzung – die Antwort sagt, dass sie auch auf dieser Druckliste stehen");
    await openSession();
    const rrow = rowOf(NAMER);
    await rrow.waitFor({ timeout: 20000 });
    ok((await rrow.locator(".meta").textContent()).includes("aus der Sitzung „Noah baut die Arche“") && (await pnFiles()).some((x) => x.id === aid2 && x.printName === NAMER && x.refFrom),
      "Druckliste dieser Sitzung und Druckaufträge: „" + NAMER + "“ (aus der Sitzung „Noah baut die Arche“)");
    // eigene Druckangaben dieser Sitzung: 2 Exemplare – Name folgt, die Sitzung, der die Bildkarten gehören, bleibt bei 1x
    await rrow.locator("input.pcopies").fill("2"); await rrow.locator("input.pcopies").dispatchEvent("change");
    const NAMER2 = "2x - farbig - einseitig - Reli2 - Arche Karten.pdf";
    await rowOf(NAMER2).waitFor({ timeout: 10000 });
    const prevPrint = (await T("GET", "/api/teacher/lessons/" + prevL)).data.files.find((x) => x.id === aid2).print;
    ok(prevPrint && prevPrint.copies === 1 && (await T("GET", "/api/teacher/lessons/" + gsL)).data.cardPrints[aid2].copies === 2, "2 Exemplare nur in dieser Sitzung (die frühere Sitzung bleibt bei 1x)");
    // in der ZIP-Datei der Sitzung: unter dem Namen dieser Sitzung und auf A4 (hochgeladen in A5 quer)
    z = await zip(); ze = z.entries.find((e) => e.name === NAMER2); info = ze ? await pdfInfo(Buffer.from(ze.data)) : { pages: 0 };
    ok(info.pages === 2 && info.landscape, "ZIP-Datei der Sitzung: „" + NAMER2 + "“ mit 2 Seiten A4 quer");
    [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), rowOf(NAMER2).getByRole("button", { name: "Herunterladen" }).click()]);
    ok(dl.suggestedFilename() === NAMER2, "Einzel-Download unter dem Namen dieser Sitzung: „" + dl.suggestedFilename() + "“");
    // nur in dieser Sitzung abwählen → darunter „Wieder ausdrucken“ (Fokus dort), nicht mehr bei den Druckaufträgen; wieder aufnehmen → 1x, einseitig, farbig
    await rowOf(NAMER2).getByRole("button", { name: "Nicht ausdrucken – " + NAMER2 }).click();
    const again = card.getByRole("button", { name: "Wieder ausdrucken – Arche Karten.pdf" });
    await again.waitFor({ timeout: 10000 });
    ok(await again.evaluate((el) => el === document.activeElement) && await rowOf(NAMER2).count() === 0 && !(await pnFiles()).some((x) => x.id === aid2)
      && (await T("GET", "/api/teacher/lessons/" + prevL)).data.files.find((x) => x.id === aid2).print.copies === 1,
      "„Nicht ausdrucken“: nur in dieser Sitzung – darunter „Wieder ausdrucken“ (Fokus dort), weg aus den Druckaufträgen, die frühere Sitzung unverändert");
    await again.click();
    await rowOf(NAMER).waitFor({ timeout: 10000 });
    ok((await pnFiles()).some((x) => x.id === aid2 && x.printName === NAMER), "„Wieder ausdrucken“: wieder auf der Liste (1x, einseitig, farbig)");
    await shots(tp, "#printcard", "wiederverwendet", { OUT, SHOT, ok, horizontalIssues });

    /* Zweitprüfung von Nachtrag 31b: von Claude GESTALTETE wiederverwendete Bildkarten. Vorher lief ihr Einzel-Download über den signierten Link – der Server nannte die
       Datei nach der Druckliste der Sitzung, der sie gehören („1x - …“ bzw., dort abgewählt, nur „Bildkarten Noah.pdf“; sein Content-Disposition geht dem
       download-Attribut vor), auch in der kompakten Ansicht; die kompakte Ansicht nannte nur den Dateinamen; save_verlaufsplan sagte immer „1x, einseitig, farbig“ */
    r = await tool("add_picture_cards", { lesson_id: prevL, titel: "Bildkarten Noah", html: cardsHtml(2, "Noah"), erzaehltexte: ["Noah baut eine Arche.", "Die Taube bringt einen Zweig."] });
    const did = r.structuredContent && r.structuredContent.file_id;
    const NAMED1 = "1x - farbig - einseitig - Reli2 - Bildkarten Noah.pdf", NAMED3 = "3x - farbig - einseitig - Reli2 - Bildkarten Noah.pdf";
    ok(!r.isError && r.structuredContent.pages === 2 && r.structuredContent.druckliste === NAMED1, "Claude gestaltet Bildkarten in der früheren Sitzung (dort „" + NAMED1 + "“)");
    const PLAN2 = "**1) Erzählung: Die Arche (15 Min., Sitzkreis)**\n- Lehrkraft erzählt mit den Bildkarten [[pdf:" + aid2 + "]]\n**2) Wiederholung (5 Min., Sitzkreis)**\n- Bildkarten [[pdf:" + did + "]]";
    r = await tool("save_verlaufsplan", { lesson_id: gsL, text: PLAN2 });
    ok(!r.isError && r.content[0].text.includes("Wiederverwendete Bildkarten „Arche Karten.pdf“, „Bildkarten Noah.pdf“ stehen auch auf der Druckliste dieser Sitzung (1x, einseitig, farbig)."),
      "save_verlaufsplan: beide wiederverwendeten Bildkarten in einem Satz (gleiche Druckangaben, wie bisher)");
    await openSession();
    await rowOf(NAMED1).getByRole("button", { name: "Herunterladen" }).waitFor({ timeout: 30000 });
    await rowOf(NAMED1).locator("input.pcopies").fill("3"); await rowOf(NAMED1).locator("input.pcopies").dispatchEvent("change");
    await rowOf(NAMED3).waitFor({ timeout: 10000 });
    ok(await rowOf(NAMED3).getByRole("button", { name: "Nicht ausdrucken – " + NAMED3 }).count() === 1, "3 Exemplare in dieser Sitzung – „Nicht ausdrucken“ nennt den neuen Namen");
    [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), rowOf(NAMED3).getByRole("button", { name: "Herunterladen" }).click()]);
    info = await pdfInfo(readFileSync(await dl.path()));
    ok(dl.suggestedFilename() === NAMED3 && info.pages === 2 && info.landscape, "gestaltete wiederverwendete Bildkarten: Einzel-Download unter dem Namen dieser Sitzung „" + dl.suggestedFilename() + "“ (" + info.pages + " Seiten A4 quer)");
    // die Sitzung, der sie gehören, nimmt sie von ihrer Liste (so stehen alle Bildkarten von vor dem 16.11.2026): der Name hier bleibt
    await T("PATCH", "/api/teacher/files/" + did, { copies: null });
    [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), rowOf(NAMED3).getByRole("button", { name: "Herunterladen" }).click()]);
    ok(dl.suggestedFilename() === NAMED3, "… auch wenn ihre eigene Sitzung sie abgewählt hat: „" + dl.suggestedFilename() + "“");
    r = await tool("save_verlaufsplan", { lesson_id: gsL, text: PLAN2 });
    ok(r.content[0].text.includes("Wiederverwendete Bildkarten stehen auch auf der Druckliste dieser Sitzung: „Arche Karten.pdf“ (1x, einseitig, farbig), „Bildkarten Noah.pdf“ (3x, einseitig, farbig)."),
      "save_verlaufsplan nennt die Druckangaben dieser Sitzung (vorher immer „1x, einseitig, farbig“)");
    // kompakte Ansicht „Ich bin jetzt im Unterricht“: Druck-Name dieser Sitzung, Download ebenso
    await tp.getByRole("button", { name: "Ich bin jetzt im Unterricht", exact: true }).click();
    const icItem = tp.locator("#ic-material .ic-print", { has: tp.locator(".ic-name", { hasText: new RegExp("^" + esc(NAMED3) + "$") }) });
    await icItem.waitFor({ timeout: 20000 });
    ok(await tp.locator("#ic-material .ic-print .ic-name", { hasText: new RegExp("^" + esc(NAMER) + "$") }).count() === 1, "kompakte Ansicht: wiederverwendete Bildkarten mit dem Druck-Namen dieser Sitzung (vorher nur der Dateiname)");
    [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), icItem.getByRole("button", { name: /^Herunterladen/ }).click()]);
    ok(dl.suggestedFilename() === NAMED3, "kompakte Ansicht: Einzel-Download „" + dl.suggestedFilename() + "“");
    await shots(tp, "#ic-material", "wiederverwendet-kompakt", { OUT, SHOT, ok, horizontalIssues }, SIZES4);
    await tp.locator("#inclass-back").click();
    // „Wieder ausdrucken“: am Handy mindestens 44px hoch, Beschriftung in einer Zeile
    await rowOf(NAMED3).getByRole("button", { name: "Nicht ausdrucken – " + NAMED3 }).click();
    const againD = card.getByRole("button", { name: "Wieder ausdrucken – Bildkarten Noah.pdf" });
    await againD.waitFor({ timeout: 10000 });
    await shots(tp, "#printcard", "wiederverwendet-abgewaehlt", { OUT, SHOT, ok, horizontalIssues }, SIZES4);
    const vp1 = tp.viewportSize(), heights = [];
    for (const [w, hh] of SIZES4) { await tp.setViewportSize({ width: w, height: hh }); await sleep(150); const bb = await againD.boundingBox(); heights.push(bb ? Math.round(bb.height) : 0); }
    await tp.setViewportSize(vp1);
    ok(heights.every((x) => x >= 44 && x <= 46), "„Wieder ausdrucken“ bei 1366/1180/820/390 px: " + heights.join("/") + " px hoch (mindestens 44, einzeilig – zweizeilig wären es 49)");
    await againD.click();
    await rowOf(NAMED1).waitFor({ timeout: 10000 });

    /* Startseite: dieselben Bildkarten in zwei Sitzungen eines Tages (diese und eine zweite Sitzung des Kurses am selben Tag) – je Sitzung eine eigene Zeile; druckt das
       Feld ihre neue Gestaltung, behält jede Zeile ihren Namen (vorher nach der Datei allein geschlüsselt: die eine Zeile bekam den Namen der anderen bzw. der Sitzung,
       der die Bildkarten gehören, die andere blieb ohne „Herunterladen“) */
    const twinL = "f31b" + Date.now().toString(16).slice(-12).padStart(12, "0");   // 16 Zeichen a–f/0–9 (isId) – sonst ließe sie sich nicht wieder löschen
    d1("INSERT INTO lessons(id, subject, klass, title, lesson_date, code, portal, created_at, updated_at) VALUES('" + twinL + "', 'gs', '" + me.klass + "', 'Die Taube kehrt zurueck', '" + me.date + "', 'T31B" +
      twinL.slice(-4).toUpperCase() + "', '- Bildkarten [[pdf:" + did + "]] zeigen', 2, 2)");
    await T("PUT", "/api/teacher/lessons/" + gsL + "/card-prints", { fileId: did, copies: 3 });
    await T("PATCH", "/api/teacher/files/" + did, { copies: 1 });   // wieder auf der Liste der Sitzung, der sie gehören – die Antwort des Druckers nennt dann „1x - …“
    printer.mode = "busy";
    r = await tool("add_picture_cards", { lesson_id: prevL, titel: "Bildkarten Noah", html: cardsHtml(3, "Noah"), erzaehltexte: ["Noah baut.", "Die Taube.", "Der Regenbogen."], file_id: did });
    ok(!r.isError && r.content[0].text.includes("noch nicht als PDF gedruckt"), "Drucker ausgelastet: neue Gestaltung der Bildkarten gespeichert, noch nicht gedruckt");
    await tp.goto(BASE + "/#/lk");
    const pnRowOf = (lid, name) => tp.locator(".printnext .pn-group", { has: tp.locator('a[href="#/lk/s/' + lid + '"]') }).locator(".pn-row", { has: tp.locator(".name", { hasText: new RegExp("^" + esc(name) + "$") }) });
    await pnRowOf(gsL, NAMED3).waitFor({ timeout: 20000 }); await pnRowOf(twinL, NAMED1).waitFor({ timeout: 20000 });
    ok(await pnRowOf(gsL, NAMED3).getByRole("button").count() === 0 && await pnRowOf(twinL, NAMED1).getByRole("button").count() === 0,
      "Startseite: dieselben Bildkarten in zwei Sitzungen – je eine Zeile mit eigenem Namen, beide warten auf den Druck");
    printer.mode = "ok";
    await pnRowOf(gsL, NAMED3).getByRole("button", { name: "Herunterladen – " + NAMED3 }).waitFor({ timeout: 90000 });
    await pnRowOf(twinL, NAMED1).getByRole("button", { name: "Herunterladen – " + NAMED1 }).waitFor({ timeout: 20000 });
    ok(true, "… gedruckt: beide Zeilen mit „Herunterladen“ unter ihrem eigenen Namen („" + NAMED3 + "“ bzw. „" + NAMED1 + "“)");
    [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), pnRowOf(gsL, NAMED3).getByRole("button", { name: "Herunterladen – " + NAMED3 }).click()]);
    info = await pdfInfo(readFileSync(await dl.path()));
    ok(dl.suggestedFilename() === NAMED3 && info.pages === 3 && info.landscape, "… Download dort: „" + dl.suggestedFilename() + "“ mit der neuen Gestaltung (" + info.pages + " Seiten A4 quer)");
    await shots(tp, ".printnext", "wiederverwendet-startseite", { OUT, SHOT, ok, horizontalIssues }, SIZES4);
    ok((await T("DELETE", "/api/teacher/lessons/" + twinL)).status === 200, "aufgeräumt: die zweite Sitzung desselben Tages ist wieder gelöscht");
    // Verweis aus dem Verlaufsplan entfernt → nicht mehr auf der Druckliste dieser Sitzung
    r = await tool("save_verlaufsplan", { lesson_id: gsL, text: "**1) Bewegungslied (5 Min.)**" });
    await openSession();
    ok(await rowOf(NAMER).count() === 0 && !(await pnFiles()).some((x) => x.id === aid2), "Verweis entfernt: nicht mehr auf der Druckliste dieser Sitzung");
    await T("DELETE", "/api/teacher/lessons/" + prevL);
  }

  /* ---------- f) Erinnerung: Geschichte im Verlaufsplan, aber keine Bildkarten ---------- */
  for (const id of [cid, aid, uid, oid, rid, vid, eid]) await T("DELETE", "/api/teacher/files/" + id);
  r = await tool("save_verlaufsplan", { lesson_id: gsL, text: "**1) Erzählung: Die Arche Noah (15 Min., Sitzkreis)**\n- Lehrkraft erzählt frei" });
  ok(!r.isError && r.structuredContent.bildkarten_fehlen === true && r.content[0].text.includes("Der Verlaufsplan erzählt eine Geschichte („1) Erzählung: Die Arche Noah (15 Min., Sitzkreis)“), aber diese Sitzung hat noch keine Bildkarten"),
    "save_verlaufsplan: Erzählung ohne Bildkarten → gespeichert, die Antwort erinnert an Bildkarten");
  g = await tool("get_lesson", { lesson_id: gsL });
  ok(g.content[0].text.includes("\n## Bildkarten\nAchtung: Der Verlaufsplan erzählt eine Geschichte"), "get_lesson: Abschnitt „Bildkarten“ mit der Erinnerung");
  r = await tool("save_verlaufsplan", { lesson_id: gsL, text: "**1) Bewegungslied (5 Min.)**\n**2) Arbeitsblatt (20 Min., Einzelarbeit)**" });
  ok(!r.isError && !r.structuredContent.bildkarten_fehlen && !r.content[0].text.includes("noch keine Bildkarten"), "… ohne Geschichte: keine Erinnerung");
  // aufräumen: der Verlaufsplan wie vorher, keine Bildkarten mehr in der Sitzung
  if (plan0.portal) await tool("save_verlaufsplan", { lesson_id: gsL, text: plan0.portal });
  ok(!(await lessonFiles()).some((x) => x.cards) && (await T("GET", "/api/teacher/lessons/" + gsL)).data.lesson.portal === (plan0.portal || "**1) Bewegungslied (5 Min.)**\n**2) Arbeitsblatt (20 Min., Einzelarbeit)**"),
    "aufgeräumt: keine Bildkarten mehr in der Sitzung, Verlaufsplan wie vorher");
}

/* Bildschirmfotos eines Bereichs (Laptop 1366, iPad hochkant 820, Handy 390; hell und dunkel; sizes z. B. mit iPad quer 1180) – am Handy ohne seitliches Schieben */
const SIZES4 = [[1366, 900], [1180, 820], [820, 1180], [390, 844]];
async function shots(tp, sel, name, { OUT, SHOT, ok, horizontalIssues }, sizes = [[1366, 900], [820, 1180], [390, 844]]) {
  const vp0 = tp.viewportSize();
  for (const [w, hh] of sizes) for (const dark of [false, true]) {
    await tp.setViewportSize({ width: w, height: hh }); await tp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await sleep(250);
    const el = tp.locator(sel).first(); await el.scrollIntoViewIfNeeded();
    // die Kopfleiste der Seite ist sticky – im Foto eines hohen Bereichs läge sie sonst darüber
    await el.screenshot({ ...SHOT, style: (SHOT.style || "") + ".topbar{position:static!important}", path: join(OUT, "bildkarten-druck-" + name + "-" + w + (dark ? "-dunkel" : "") + ".png") });
    if (w < 400 && !dark) { const hi = (await horizontalIssues(tp)).issues; ok(!hi.length, "Bildkarten „" + name + "“ am Handy (390 px): ohne seitliches Schieben" + (hi.length ? " – " + JSON.stringify(hi).slice(0, 200) : "")); }
  }
  await tp.emulateMedia({ colorScheme: "light" }); await tp.setViewportSize(vp0);
}
