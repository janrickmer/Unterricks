// lessonzip.mjs – End-to-End-Prüfung von Nachtrag 41: „Alle Unterlagen dieser Sitzung“. Eigene Sitzungen (PoWi 8B und Grundschule) weit in der Zukunft,
// danach gelöscht. Geprüft: Karte ganz unten (Gymnasium unter „Sitzung als Datei“), der heruntergeladene ZIP-Ordner (Präsentation wie hochgeladen, PowerPoint
// mit Folienbildern und Notizen, Notizen-PDF, Druckliste mit Druck-Namen, Material nach Bereich, Text als PDF, Verlaufsplan ohne Zwischenstopp mit
// Hausaufgabe, Link und Ordnerliste, ungespeicherte Hausaufgabe), in der kompakten Ansicht „Ich bin jetzt im Unterricht“ ausgeblendet; Grundschule mit
// Vorlesetext, Arbeitsblatt für die Kinder und Verweis im Verlaufsplan als Pfad. Frei erfundene Inhalte.
// ctx = {tp (Seite der Lehrkraft, angemeldet), BASE, T, tool, ok, OUT, SHOT}
import { join } from "node:path";
import { mkdirSync, readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const NOTES = { v: 1, folien: [{ folie: 1, notizen: ["Begrüßen und das Thema nennen"] }, { folie: 2, notizen: ["Partnerarbeit erklären"] }] };
async function deck() {
  const d = await PDFDocument.create(), b = await d.embedFont(StandardFonts.HelveticaBold);
  for (const t of ["Wahlen in Deutschland", "Wer darf wählen?", "Diskussion"]) {
    const p = d.addPage([960, 540]);
    p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.12, 0.23, 0.37) });
    p.drawText(t, { x: 60, y: 300, size: 44, font: b, color: rgb(1, 1, 1) });
  }
  await d.attach(new TextEncoder().encode(JSON.stringify(NOTES)), "unterricks-notizen.json", { mimeType: "application/json", description: "Notizen" });
  return Buffer.from(await d.save());
}
const a4 = async (label) => { const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica); d.addPage([595.28, 841.89]).drawText(label, { x: 50, y: 760, size: 20, font: f }); return Buffer.from(await d.save()); };

export async function lessonZipE2E({ tp, BASE, T, tool, ok, OUT, SHOT }) {
  const { berlinToday, addDays, STOP_LINE, pdfRef } = await import("../../public/shared.js");
  const { readZip } = await import("../../public/zip.js");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const dir = join(OUT, "nr41"); mkdirSync(dir, { recursive: true });
  const token = await tp.evaluate(() => localStorage.getItem("u.ttoken"));
  const post = async (path, buf, type = "application/pdf") => (await (await fetch(BASE + path, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": type }, body: buf })).json()).file;
  const up = (lessonId, name, area, buf) => post("/api/teacher/lessons/" + lessonId + "/files?area=" + area + "&name=" + encodeURIComponent(name), buf);
  const textOf = async (bytes) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 }).promise, pages = [];
    for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ").replace(/\s+/g, " "));
    await doc.destroy();
    return pages.join(" \n ");
  };
  let day = addDays(berlinToday(), 80); while ([0, 6].includes(new Date(day + "T12:00:00Z").getUTCDay())) day = addDays(day, 1);
  const wd = new Date(day + "T12:00:00Z").getUTCDay(), made = [];
  const oneLesson = async (subject, klass, title) => {
    const u = (await T("POST", "/api/teacher/units", { subject, klass, title, params: { start: day, end: day, weekdays: [{ day: wd, minutes: 45, time: "08:00" }] } })).data.unit;
    await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: title, lernaufgabe: "Lernaufgabe" }, rows: [{ stundenfrage: title, ablauf: ["Einstieg"], date: day, time: "08:00", minutes: 45 }] });
    const l = (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit.lessons[0].id;
    made.push({ u: u.id, l });
    return l;
  };
  const download = async (label) => {
    const card = tp.locator("#lessondocs");
    await card.getByRole("button", { name: "Alle Unterlagen herunterladen (ZIP)" }).waitFor({ timeout: 15000 });
    await tp.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
    const [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 120000 }), card.getByRole("button", { name: "Alle Unterlagen herunterladen (ZIP)" }).click()]);
    const p = join(dir, label + "-" + dl.suggestedFilename()); await dl.saveAs(p);
    await card.locator(".save-state", { hasText: "Heruntergeladen: " }).waitFor({ timeout: 15000 });
    const hint = tp.locator(".modal", { hasText: "Hinweise zum Ordner" });
    const hints = await hint.isVisible().catch(() => false) ? await hint.textContent() : "";
    if (hints) await hint.getByRole("button", { name: "Fertig" }).click();
    const zip = await readZip(new Uint8Array(readFileSync(p)));
    return { name: dl.suggestedFilename(), zip, by: new Map(zip.map((e) => [e.name, e.data])), hints, state: await card.locator(".save-state").textContent() };
  };

  /* ---------- Gymnasium ---------- */
  const G = await oneLesson("powi", "8B", "Wahlen in Deutschland");
  await T("PUT", "/api/teacher/lessons/" + G + "/portal", { text: "**1) Einstieg**\n- Karikatur ~~Nichtwähler~~\n" + STOP_LINE + "\n\n**2) Partnerarbeit**\n- Arbeitsblatt ~~M1~~", force: true });
  await T("PATCH", "/api/teacher/lessons/" + G, { homework: "- Lies M2.", teacherSummary: "Die Stunde beginnt mit einer Karikatur." });
  const m1 = await up(G, "M1 Wer darf wählen.pdf", "student", await a4("Arbeitsblatt M1"));
  await up(G, "Lösung M1.pdf", "teacher", await a4("Lösung M1"));
  await T("POST", "/api/teacher/lessons/" + G + "/links", { area: "student", title: "Wahl-O-Mat", url: "https://www.wahl-o-mat.de/" });
  let r = await tool("add_text_material", { lesson_id: G, bereich: "lehrkraft", titel: "Tafelbild Wahlrecht", markdown: "# Tafelbild\n\n- aktives Wahlrecht\n- passives Wahlrecht" });
  ok(r && !r.isError, "Textmaterial (Lehrkraft) über den Connector angelegt" + (r && r.isError ? ": " + r.content[0].text : ""));
  const pr = await post("/api/teacher/lessons/" + G + "/print?copies=28&duplex=1&name=" + encodeURIComponent("Arbeitsblatt Wahlrecht.pdf"), await a4("Druckvorlage"));
  ok(pr && pr.printName === "28x - sw - beidseitig - PoWi8 - Arbeitsblatt Wahlrecht.pdf", "Druckvorlage auf der Druckliste: " + (pr && pr.printName));
  await tp.setViewportSize({ width: 1366, height: 900 });
  await tp.goto(BASE + "/#/lk/s/" + G);
  const presCard = tp.locator("section.card", { hasText: "Präsentation für den Unterricht" });
  await presCard.waitFor({ timeout: 15000 });
  await tp.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  const deckBytes = await deck();
  await presCard.locator("input[type=file]").first().setInputFiles({ name: "Wahlen.pdf", mimeType: "application/pdf", buffer: deckBytes });
  await tp.locator(".toast", { hasText: "Präsentation bereit (3 Folien)." }).waitFor({ timeout: 60000 });
  // Karte ganz unten, unter „Sitzung als Datei“
  ok(await tp.evaluate(() => { const s = [...document.querySelectorAll("main > section.card")]; return s.length >= 2 && s[s.length - 1].id === "lessondocs" && s[s.length - 2].classList.contains("sessionio"); }),
    "Gymnasium: die Karte „Alle Unterlagen dieser Sitzung“ steht ganz unten, direkt unter „Sitzung als Datei“");
  ok((await tp.locator("#lessondocs").textContent()).includes("zum Wiederladen in Unterricks"), "… mit dem Hinweis, wofür „Sitzung als Datei“ da ist");
  // ungespeicherte Hausaufgabe kommt mit (das Feld zählt, nicht nur der gespeicherte Stand)
  await tp.locator("#hw").fill("- Lies M2 und notiere zwei Gründe.");
  await tp.screenshot({ ...SHOT, path: join(OUT, "nr41-karte.png"), clip: await tp.locator("#lessondocs").boundingBox().then((b) => ({ x: 0, y: Math.max(0, b.y - 20), width: 1366, height: b.height + 40 })) }).catch(() => {});
  const g = await download("gym");
  const names = [...g.by.keys()].sort();
  const want = ["Material für Schülerinnen und Schüler/M1 Wer darf wählen.pdf", "Material für die Lehrkraft/Lösung M1.pdf", "Material für die Lehrkraft/Tafelbild Wahlrecht.pdf",
    "Notizen zu den Folien - Wahlen in Deutschland.pdf", "Präsentation - Wahlen in Deutschland.pdf", "Präsentation - Wahlen in Deutschland.pptx", "Verlaufsplan - Wahlen in Deutschland.pdf",
    "Zum Ausdrucken/28x - sw - beidseitig - PoWi8 - Arbeitsblatt Wahlrecht.pdf"];
  ok(JSON.stringify(names) === JSON.stringify(want.sort()), "ZIP-Ordner der Sitzung: " + names.join(" | "));
  ok(g.name === "Unterlagen - PoWi - 8B - " + day + " - Wahlen in Deutschland.zip" && /Heruntergeladen: .*8 Dateien/.test(g.state), "Name des Ordners und Rückmeldung: " + g.name + " – " + g.state);
  const presFile = (await T("GET", "/api/teacher/lessons/" + G)).data.files.find((f) => f.area === "presentation");
  const link = (await T("POST", "/api/teacher/files/" + presFile.id + "/link", {})).data.url, orig = new Uint8Array(await (await fetch(new URL(link, BASE))).arrayBuffer());
  ok(Buffer.compare(Buffer.from(g.by.get("Präsentation - Wahlen in Deutschland.pdf")), Buffer.from(orig)) === 0, "Präsentation genau wie in Unterricks gespeichert");
  const px = await readZip(new Uint8Array(g.by.get("Präsentation - Wahlen in Deutschland.pptx"))), pn = new Map(px.map((e) => [e.name, e.data]));
  const slides = [...pn.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, img = [...pn.keys()].find((n) => /^ppt\/media\/.*\.png$/.test(n));
  const pngW = img ? new DataView(pn.get(img).buffer, pn.get(img).byteOffset).getUint32(16) : 0;
  ok(slides === 3 && pngW >= 1900 && new TextDecoder().decode(pn.get("ppt/notesSlides/notesSlide2.xml")).includes("Partnerarbeit erklären"),
    "PowerPoint: alle 3 Folien als Bild (" + pngW + " px breit), Notizen der Folie 2 in der Referentenansicht");
  const notesPdf = await textOf(g.by.get("Notizen zu den Folien - Wahlen in Deutschland.pdf"));
  ok(notesPdf.includes("Begrüßen und das Thema nennen"), "Notizen zu den Folien als PDF");
  const plan = await textOf(g.by.get("Verlaufsplan - Wahlen in Deutschland.pdf"));
  ok(["Karikatur", "Partnerarbeit", "Lies M2 und notiere zwei Gründe.", "Wahl-O-Mat", "https://www.wahl-o-mat.de/", "Die Stunde beginnt mit einer Karikatur.", "In diesem Ordner",
    "Zum Ausdrucken/28x - sw - beidseitig - PoWi8 - Arbeitsblatt Wahlrecht.pdf", "08:00 Uhr"].every((t) => plan.includes(t)) && !plan.includes("Zwischenstopp") && !plan.includes("Copyright"),
    "Verlaufsplan: ohne Zwischenstopp, mit der ungespeicherten Hausaufgabe, Link, Zusammenfassung und Ordnerliste, ohne Copyright – " + plan.slice(0, 200));
  ok((await textOf(g.by.get("Material für die Lehrkraft/Tafelbild Wahlrecht.pdf"))).includes("passives Wahlrecht"), "Textmaterial als PDF");
  ok(!g.hints, "keine Hinweise, wenn alles im Ordner ist" + (g.hints ? ": " + g.hints : ""));
  await tp.screenshot({ ...SHOT, path: join(OUT, "nr41-heruntergeladen.png"), clip: await tp.locator("#lessondocs").boundingBox().then((b) => ({ x: 0, y: Math.max(0, b.y - 20), width: 1366, height: b.height + 40 })) }).catch(() => {});
  // „Ich bin jetzt im Unterricht“: die Karte gehört zur vollen Seite und verschwindet in der kompakten Ansicht
  await tp.locator("#inclass-go").click();
  await tp.waitForFunction(() => document.getElementById("lessondocs").classList.contains("ic-hide"), null, { timeout: 10000 })
    .then(() => ok(true, "„Ich bin jetzt im Unterricht“: die Karte ist ausgeblendet"), () => ok(false, "„Ich bin jetzt im Unterricht“: die Karte ist noch zu sehen"));
  await tp.locator("#inclass-back").click();
  await tp.waitForFunction(() => !document.getElementById("lessondocs").classList.contains("ic-hide"), null, { timeout: 10000 })
    .then(() => ok(true, "zurück zur vollständigen Seite: die Karte ist wieder da"), () => ok(false, "zurück zur vollständigen Seite: die Karte fehlt"));

  /* ---------- Grundschule ---------- */
  const { course } = (await T("POST", "/api/teacher/gs/courses", { grade: 2, classes: ["c"], religion: true, weekdays: [{ day: wd, minutes: 45, time: "08:00" }] })).data;
  ok(!!course, "Grundschul-Kurs für den Test angelegt");
  const GS = await oneLesson("gs", course.id, "Josef und seine Brüder");
  const vt = await up(GS, "Vorlesetext Josef.pdf", "teacher", await a4("Vorlesetext Josef"));
  await up(GS, "Arbeitsblatt Josef.pdf", "student", await a4("Arbeitsblatt Josef"));
  await T("PUT", "/api/teacher/lessons/" + GS + "/portal", { text: "**1) Sitzkreis**\n- __Lehrkraft liest " + pdfRef(vt.id) + " vor.__\n**2) Malen**\n- Ein Bild zur Versöhnung", force: true });
  await tp.goto(BASE + "/#/lk/s/" + GS);
  await tp.locator("#lessondocs").waitFor({ timeout: 15000 });
  ok(await tp.evaluate(() => { const s = [...document.querySelectorAll("main > section.card")]; return s.length && s[s.length - 1].id === "lessondocs"; }), "Grundschule: die Karte steht ganz unten");
  const gz = await download("gs");
  const gnames = [...gz.by.keys()].sort();
  ok(JSON.stringify(gnames) === JSON.stringify(["Material für die Kinder/Arbeitsblatt Josef.pdf", "Material für die Lehrkraft/Vorlesetext Josef.pdf", "Verlaufsplan - Josef und seine Brüder.pdf"]),
    "Grundschule: Ordner " + gnames.join(" | "));
  const gplan = await textOf(gz.by.get("Verlaufsplan - Josef und seine Brüder.pdf"));
  ok(gplan.includes("„Material für die Lehrkraft/Vorlesetext Josef.pdf“"), "Grundschule: der Verweis im Verlaufsplan nennt den Pfad im Ordner");
  ok(!!course.label && gplan.includes("Grundschule · " + course.label), "Grundschule: der Verlaufsplan nennt den Kurs („Grundschule · " + course.label + "“)");
  // gewünschter Name laut Rückmeldung der Seite (das Chromium dieser Testumgebung ersetzt Namen mit Umlauten durch „download“ – wie bei anderen Downloads)
  const gWant = "Unterlagen - Grundschule - " + course.short + " - ";
  ok(!!course.short && gz.state.startsWith("Heruntergeladen: " + gWant) && /- Josef und seine Brüder\.zip \(/.test(gz.state) && (gz.name === "download" || gz.name.startsWith(gWant)),
    "Grundschule: Name des Ordners – " + gz.state + " (im Browser „" + gz.name + "“)");

  // aufräumen
  const gone = [];
  for (const m of made) gone.push((await T("DELETE", "/api/teacher/lessons/" + m.l)).status, (await T("DELETE", "/api/teacher/units/" + m.u)).status);
  gone.push((await T("DELETE", "/api/teacher/gs/courses/" + course.id)).status);
  ok(gone.length >= 5 && gone.every((x) => x === 200), "eigene Sitzungen, Einheiten und Kurs der Prüfung gelöscht (" + gone.join(", ") + ")");
  return { m1 };
}
