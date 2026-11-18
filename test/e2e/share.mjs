// share.mjs – End-to-End-Prüfung von Nachtrag 39: „Unterrichtseinheit mit KollegInnen teilen“. Eigene Einheiten (PoWi Q3-GK mit drei Stunden, davon zwei
// geplant; Grundschule mit zwei Stunden, davon eine geplant) weit in der Zukunft, danach gelöscht. Geprüft: Karte ganz unten (Stand, Prompt „Absätze mit
// Claude schreiben“, Absätze prüfen und bearbeiten samt Stand-Schutz gegen eine gleichzeitige Änderung von Claude), Rückfrage bei fehlenden Absätzen, der
// heruntergeladene ZIP-Ordner (Namen, Inhalt der PDF-Dateien, Präsentation ohne reine Codefolie, Unterricks-Zeile überdeckt – nachgemessen an den Pixeln –,
// Copyright auf jeder Folie, keine Notizen als Anhang, Notizen als eigene PDF, Verlaufsplan ohne Zwischenstopp, Fehlende Sitzungen, Erklärung zum
// Feibeitsblatt) und die Grundschule (ohne Präsentation und ohne Erklärung, Verweise im Verlaufsplan als Dateiname). Frei erfundene Inhalte.
// ctx = {tp (Seite der Lehrkraft, angemeldet), BASE, T, tool, d1, ok, OUT, SHOT}
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const BG = [0.12, 0.23, 0.37];
const NOTES = { v: 1, folien: [{ folie: 1, notizen: ["Begrüßen und die Karikatur zeigen"] }, { folie: 3, notizen: ["Diese Folie fällt weg"] }, { folie: 4, notizen: ["Pro und Contra sammeln"] }] };
/* Präsentation: 1 Titel, 2 Materialfolie (Codefolie mit Aufforderung und Feibeitsblatt-Titel), 3 reine Codefolie (Hinweis auf Unterricks), 4 Diskussion */
async function deck(CODE_SLIDE_LINE) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), b = await d.embedFont(StandardFonts.HelveticaBold), white = rgb(1, 1, 1);
  const slide = (lines, mark) => {
    const p = d.addPage([960, 540]);
    p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(...BG) });
    lines.forEach(([t, y, s]) => p.drawText(t, { x: 60, y, size: s, font: b, color: white }));
    if (mark) p.drawText(CODE_SLIDE_LINE, { x: 60, y: 14, size: 10, font: f, color: rgb(0.85, 0.85, 0.85) });
  };
  slide([["Wahlen in Deutschland", 300, 48]]);
  slide([["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", 330, 30], ["Arbeitsblatt „Wer darf wählen?“", 270, 36]], true);
  slide([["Die Hausaufgabe und das Material findest du in Unterricks.", 300, 28]], true);
  slide([["Diskussion: Ist die Wahlpflicht sinnvoll?", 300, 36]]);
  await d.attach(new TextEncoder().encode(JSON.stringify(NOTES)), "unterricks-notizen.json", { mimeType: "application/json", description: "Notizen" });
  return Buffer.from(await d.save());
}
const a4 = async (label) => { const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica); d.addPage([595.28, 841.89]).drawText(label, { x: 50, y: 760, size: 20, font: f }); return Buffer.from(await d.save()); };
/* PDF-Seite als Bild (pdftoppm, PPM) → {w, h, px(x, y) = [r, g, b]} */
function pageImage(pdfPath, page, dpi) {
  const buf = execFileSync("pdftoppm", ["-r", String(dpi), "-f", String(page), "-l", String(page), pdfPath], { maxBuffer: 64 * 1024 * 1024 });
  const head = buf.toString("latin1", 0, 64).split(/\s+/), w = Number(head[1]), h = Number(head[2]);
  const off = buf.indexOf(Buffer.from(head[3] + "\n", "latin1"), head[0].length + head[1].length + head[2].length) + head[3].length + 1;
  return { w, h, px: (x, y) => { const i = off + (y * w + x) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; } };
}

export async function shareE2E({ tp, BASE, T, tool, ok, OUT, SHOT }) {
  const { berlinToday, addDays, CODE_SLIDE_LINE, STOP_LINE, pdfRef } = await import("../../public/shared.js");
  const { readZip } = await import("../../public/zip.js");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const dir = join(OUT, "nr39"); mkdirSync(dir, { recursive: true });
  const token = await tp.evaluate(() => localStorage.getItem("u.ttoken"));
  const up = async (lessonId, name, area, buf) => (await (await fetch(BASE + "/api/teacher/lessons/" + lessonId + "/files?area=" + area + "&name=" + encodeURIComponent(name),
    { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/pdf" }, body: buf })).json()).file;
  const textOf = async (bytes) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 }).promise, pages = [];
    for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ").replace(/\s+/g, " "));
    const att = await doc.getAttachments(); await doc.destroy();
    return { pages, all: pages.join(" \n "), att: att ? Object.keys(att) : [] };
  };
  // drei Werktage weit in der Zukunft (unterrichtsfreie Tage dieses Laufs liegen davor)
  const days = []; for (let d = addDays(berlinToday(), 70); days.length < 3; d = addDays(d, 1)) { const w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 1 && w <= 5) days.push(d); }
  const wd = (d) => new Date(d + "T12:00:00Z").getUTCDay(), weekdays = [...new Set(days.map(wd))].map((day) => ({ day, minutes: 90, time: "08:00" }));
  const PLAN = { titel: "Wahlen in Deutschland", ausgangslage: "Viele junge Menschen gehen nicht wählen.", lernaufgabe: "Einen Aufruf zur Wahl schreiben",
    planungsgrundlage: { name: "KCGO Politik und Wirtschaft", begruendung: "Kurshalbjahr Q3" },
    schritte: [{ titel: "Problem erschließen", beschreibung: "Karikatur zur Wahlbeteiligung" }, { titel: "Wahlrecht verstehen", beschreibung: "Wahlgrundsätze und Auszählung" }] };
  const ROWS = [["Warum wählen so wenige?", ["Karikatur", "Gründe sammeln"], 0], ["Wer darf wählen?", ["Wahlgrundsätze", "Fallbeispiele"], 1], ["Wie wird ausgezählt?", ["Sitzverteilung"], 1]];
  const u = (await T("POST", "/api/teacher/units", { subject: "powi", klass: "Q3-GK", title: "Wahlen in Deutschland", params: { start: days[0], end: days[2], weekdays } })).data.unit;
  await T("PATCH", "/api/teacher/units/" + u.id, { plan: PLAN, rows: ROWS.map(([q, ab, s], i) => ({ stundenfrage: q, ablauf: ab, schritt: s, date: days[i], time: "08:00", minutes: 90 })) });
  const unit = (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit, rowLesson = (i) => unit.lessons.find((l) => l.row === unit.rows[i].uid);
  const [L1, L2, L3] = [0, 1, 2].map(rowLesson);
  ok(!!L1 && !!L2 && !!L3, "Einheit PoWi Q3-GK mit drei Sitzungen angelegt");
  // Sitzung 1: Schulportal-Eintrag mit Zwischenstopp, Hausaufgabe, Zusammenfassung, Präsentation, Material (auch Notfall-Feibeitsblatt, Text, Link)
  await T("PUT", "/api/teacher/lessons/" + L1.id + "/portal", { text: "**1) Einstieg**\n- Karikatur ~~Nichtwähler~~\n" + STOP_LINE + "\n\n**2) Partnerarbeit**\n- Arbeitsblatt ~~Wer darf wählen?~~", force: true });
  await T("PATCH", "/api/teacher/lessons/" + L1.id, { homework: "- Lies ~~M2~~ und notiere zwei Gründe.", teacherSummary: "Die Stunde beginnt mit einer Karikatur. Danach arbeiten alle mit dem Arbeitsblatt." });
  const m1 = await up(L1.id, "M1 Wer darf wählen.pdf", "student", await a4("Arbeitsblatt M1"));
  await up(L1.id, "Lösung M1.pdf", "teacher", await a4("Lösung M1"));
  await T("POST", "/api/teacher/lessons/" + L1.id + "/links", { area: "student", title: "Wahl-O-Mat", url: "https://www.wahl-o-mat.de/" });
  let r = await tool("add_text_material", { lesson_id: L1.id, bereich: "schueler", titel: "Tafelbild Wahlrecht", markdown: "# Tafelbild\n\n- aktives Wahlrecht\n- passives Wahlrecht" });
  ok(r && !r.isError, "Textmaterial über den Connector angelegt" + (r && r.isError ? ": " + r.content[0].text : ""));
  // Sitzung 3: geplant, ohne Material; Sitzung 2 bleibt ungeplant
  await T("PUT", "/api/teacher/lessons/" + L3.id + "/portal", { text: "**1) Auszählen**\n- Sitzverteilung an der Tafel", force: true });

  // Präsentation über die Oberfläche (Codefolien und Notizen erkennt der Browser)
  await tp.setViewportSize({ width: 1366, height: 900 }); await tp.emulateMedia({ colorScheme: "light" });
  await tp.goto(BASE + "/#/lk/s/" + L1.id);
  const card = tp.locator("section.card", { hasText: "Präsentation für den Unterricht" });
  await card.waitFor({ timeout: 15000 });
  await tp.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await card.locator("input[type=file]").first().setInputFiles({ name: "Wahlen.pdf", mimeType: "application/pdf", buffer: await deck(CODE_SLIDE_LINE) });
  const toast = tp.locator(".toast", { hasText: "Präsentation bereit (4 Folien)." });
  await toast.waitFor({ timeout: 60000 });
  const files1 = (await T("GET", "/api/teacher/lessons/" + L1.id)).data.files, pres = files1.find((f) => f.area === "presentation");
  ok(pres && JSON.stringify((pres.codeSlides || []).map((c) => c.n)) === "[2,3]" && pres.notes === 3, "Präsentation hochgeladen: Codefolien 2 und 3, Notizen zu 3 Folien – " + JSON.stringify(pres && { c: pres.codeSlides, n: pres.notes }));

  // Absatz zu Sitzung 1 von Claude (Connector); Sitzung 3 fehlt noch
  const TXT = { passiert: "Die Lerngruppe deutet eine Karikatur zur Wahlbeteiligung und erarbeitet mit dem Arbeitsblatt, wer wählen darf.",
    kompetenz: "Die Schülerinnen und Schüler analysieren politische Karikaturen (Analysekompetenz).", ziel: "Die Lerngruppe kann die Voraussetzungen des aktiven Wahlrechts erklären." };
  r = await tool("save_weitergabe", { unit_id: u.id, sitzungen: [{ lesson_id: L1.id, ...TXT }] });
  ok(!r.isError && r.content[0].text.includes("Noch ohne vollständigen Absatz, obwohl geplant: Sitzung 3."), "Claude speichert den Absatz zu Sitzung 1 (save_weitergabe) – " + r.content[0].text);

  /* ---------- Karte ganz unten ---------- */
  await tp.goto(BASE + "/#/lk/u/" + u.id);
  const sc = tp.locator("#unitshare");
  await sc.locator("button", { hasText: "Unterrichtseinheit mit KollegInnen teilen" }).waitFor({ timeout: 15000 });
  ok(await tp.evaluate(() => { const s = [...document.querySelectorAll("main section.card")]; return s.length > 3 && s[s.length - 1].id === "unitshare"; }), "die Karte steht ganz unten auf der Seite der Einheit");
  const st = await sc.textContent();
  ok(st.includes("2 von 3 Sitzungen geplant (noch nicht geplant: Sitzung 2 – sie steht im Dokument „Fehlende Sitzungen“).") && st.includes("Der Absatz für das Leupold-Schema fehlt noch bei Sitzung 3.")
    && st.includes("zentrale Kompetenz des KCGO") && !/\bnull\b|undefined/.test(st), "Stand: geplante und fehlende Sitzungen, fehlende Absätze – " + st.slice(0, 400));
  // Prompt
  await sc.getByRole("button", { name: "Absätze mit Claude schreiben" }).click();
  const hm = tp.locator(".modal", { hasText: "Absätze für die Weitergabe mit Claude schreiben" });
  await hm.waitFor();
  await hm.getByRole("button", { name: "Prompt kopieren" }).click();
  await tp.locator(".toast", { hasText: "Prompt kopiert" }).waitFor({ timeout: 5000 });
  const prompt = await tp.evaluate(() => navigator.clipboard.readText());
  ok(prompt.includes("`get_unit` (unit_id " + u.id + ")") && prompt.includes("- Sitzung 1: „Warum wählen so wenige?“ (lesson_id " + L1.id + ") – hat schon einen Absatz")
    && prompt.includes("- Sitzung 3: „Wie wird ausgezählt?“ (lesson_id " + L3.id + ")") && !prompt.includes(L2.id) && prompt.includes("Noch nicht geplant (Sitzung 2)") && prompt.includes("`save_weitergabe`")
    && prompt.includes("dem KCGO für das Kurshalbjahr Q3"), "Prompt: geplante Sitzungen mit lesson_id, nicht geplante nur genannt, KCGO des Kurshalbjahres");
  await hm.getByRole("button", { name: "Schließen", exact: true }).last().click();
  // Rückfrage bei fehlenden Absätzen → abbrechen
  await sc.getByRole("button", { name: "Unterrichtseinheit mit KollegInnen teilen" }).click();
  const miss = tp.locator(".modal", { hasText: "Absätze fehlen" });
  await miss.waitFor();
  ok((await miss.textContent()).includes("Zu Sitzung 3 gibt es noch keinen vollständigen Absatz – unter dem Leupold-Schema steht dort dann nur, was schon da ist, und der grobe Ablauf"), "Rückfrage nennt die Sitzung ohne Absatz");
  await miss.getByRole("button", { name: "Abbrechen" }).click();
  // Absätze bearbeiten: Sitzung 3 ergänzen; zu Sitzung 1 ändert Claude inzwischen → 409, die eigene Fassung bleibt in den Feldern
  await sc.locator("summary", { hasText: "Absätze prüfen und bearbeiten (1 von 2)" }).click();
  const k3 = sc.locator("#sh-" + L3.id + "-passiert");
  await k3.fill("Die Klasse zählt eine Probewahl aus und berechnet die Sitzverteilung.");
  await sc.locator("#sh-" + L3.id + "-kompetenz").fill("Die Schülerinnen und Schüler erklären Wahlsysteme (Urteilskompetenz).");
  await sc.locator("#sh-" + L3.id + "-ziel").fill("Die Lerngruppe kann eine Sitzverteilung nachvollziehen.");
  await sc.locator("#sh-" + L1.id + "-ziel").fill("Meine Fassung des Ziels.");
  ok(await sc.locator("label[for='sh-" + L1.id + "-kompetenz']").textContent() === "Zentrale Kompetenz (KCGO)", "Feld der Kompetenz heißt „Zentrale Kompetenz (KCGO)“");
  await tool("update_lesson", { lesson_id: L1.id, weitergabe: { ...TXT, ziel: "Ziel von Claude, inzwischen gespeichert." } });
  await sc.getByRole("button", { name: "Absätze speichern" }).click();
  // Claude hat inzwischen gespeichert: ein Dialog zeigt beide Fassungen – nichts wird still überschrieben
  const cd = tp.locator(".modal", { hasText: "Absatz inzwischen geändert" });
  await cd.waitFor({ timeout: 10000 });
  const cdt = await cd.textContent();
  ok(cdt.includes("Gespeicherte Fassung") && cdt.includes("Ziel von Claude, inzwischen gespeichert.") && cdt.includes("Ihre Fassung") && cdt.includes("Meine Fassung des Ziels."),
    "Konflikt: der Dialog zeigt die von Claude gespeicherte und die eigene Fassung");
  let ls = (await T("GET", "/api/teacher/units/" + u.id + "/share")).data.lessons;
  ok(ls.find((l) => l.id === L1.id).shareText.ziel === "Ziel von Claude, inzwischen gespeichert.", "Sitzung 1 nicht überschrieben (409), weil Claude inzwischen gespeichert hat");
  await cd.getByRole("button", { name: "Gespeicherte Fassung übernehmen" }).click();
  await sc.locator(".save-state", { hasText: "Absätze gespeichert" }).waitFor({ timeout: 10000 });
  ls = (await T("GET", "/api/teacher/units/" + u.id + "/share")).data.lessons;
  ok(ls.find((l) => l.id === L3.id).shareText && ls.find((l) => l.id === L3.id).shareText.passiert.startsWith("Die Klasse zählt"), "danach Sitzung 3 gespeichert (die Absätze werden nacheinander gespeichert)");
  ok(await sc.locator("#sh-" + L1.id + "-ziel").inputValue() === "Ziel von Claude, inzwischen gespeichert." && await sc.locator("details.sharetexts").evaluate((d) => d.open),
    "„Gespeicherte Fassung übernehmen“: die Felder zeigen Claudes Fassung, der Bereich bleibt aufgeklappt");
  await sc.locator("#sh-" + L1.id + "-ziel").fill(TXT.ziel);
  await sc.getByRole("button", { name: "Absätze speichern" }).click();
  await sc.locator(".save-state", { hasText: "Absätze gespeichert" }).waitFor({ timeout: 10000 });
  await tp.waitForFunction(() => !document.querySelector("#unitshare [data-k=save]") || document.querySelector("#unitshare [data-k=save]").disabled, null, { timeout: 5000 });
  ls = (await T("GET", "/api/teacher/units/" + u.id + "/share")).data.lessons;
  ok(ls.find((l) => l.id === L1.id).shareText.ziel === TXT.ziel, "danach die eigene Änderung gespeichert");
  ok(await tp.evaluate(() => { const a = document.activeElement; return !!a && !!a.closest("#unitshare") && a.matches("summary, textarea, button"); }), "nach dem Speichern bleibt der Fokus in der Karte (nicht auf der Seite)");
  // Meine Fassung gegen eine neue von Claude: „Meine Fassung speichern“ gewinnt bewusst
  await sc.locator("#sh-" + L1.id + "-ziel").fill("Ziel – meine Fassung gewinnt.");
  await tool("update_lesson", { lesson_id: L1.id, weitergabe: { ...TXT, ziel: "Claude noch einmal." } });
  await sc.getByRole("button", { name: "Absätze speichern" }).click();
  await cd.waitFor({ timeout: 10000 });
  await cd.getByRole("button", { name: "Meine Fassung speichern" }).click();
  await sc.locator(".save-state", { hasText: "Absätze gespeichert" }).waitFor({ timeout: 10000 });
  ls = (await T("GET", "/api/teacher/units/" + u.id + "/share")).data.lessons;
  ok(ls.find((l) => l.id === L1.id).shareText.ziel === "Ziel – meine Fassung gewinnt.", "„Meine Fassung speichern“ speichert nach dem Konflikt die eigene Fassung");
  await tool("update_lesson", { lesson_id: L1.id, weitergabe: TXT });
  await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  // Claude ändert einen Absatz, während die Seite offen ist (nichts ungespeichert): beim Zurückkehren zeigt die Karte den neuen Stand
  const P3 = "Die Klasse zählt eine Probewahl aus und vergleicht zwei Wahlsysteme.";
  r = await tool("update_lesson", { lesson_id: L3.id, weitergabe: { passiert: P3, kompetenz: "Die Schülerinnen und Schüler erklären Wahlsysteme (Urteilskompetenz).", ziel: "Die Lerngruppe kann eine Sitzverteilung nachvollziehen." } });
  ok(r && !r.isError, "Claude ändert den Absatz zu Sitzung 3");
  await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await tp.waitForFunction((id) => { const t = document.getElementById("sh-" + id + "-passiert"); return t && t.value.includes("vergleicht zwei Wahlsysteme"); }, L3.id, { timeout: 10000 }).catch(() => {});
  ok((await sc.locator("#sh-" + L3.id + "-passiert").inputValue()) === P3, "beim Zurückkehren zeigt die Karte den von Claude gespeicherten Absatz (keine veralteten Felder)");
  for (const [w, scheme] of [[1366, "light"], [390, "light"], [1366, "dark"]]) {
    await tp.setViewportSize({ width: w, height: w <= 420 ? 844 : 900 }); await tp.emulateMedia({ colorScheme: scheme });
    await sc.scrollIntoViewIfNeeded();
    ok(await tp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "kein seitliches Schieben (" + w + " px, " + scheme + ")");
    await sc.screenshot({ ...SHOT, path: join(OUT, "nr39-teilen-" + w + "-" + scheme + ".png") });
  }
  await tp.setViewportSize({ width: 1366, height: 900 }); await tp.emulateMedia({ colorScheme: "light" });

  /* ---------- Teilen: ZIP-Ordner ---------- */
  await tp.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  const [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 120000 }), sc.getByRole("button", { name: "Unterrichtseinheit mit KollegInnen teilen" }).click()]);
  const zipPath = join(dir, dl.suggestedFilename()); await dl.saveAs(zipPath);
  ok(dl.suggestedFilename().endsWith(" - zum Teilen.zip") && dl.suggestedFilename().includes("Wahlen in Deutschland"), "Download: " + dl.suggestedFilename());
  await sc.locator(".save-state", { hasText: "Heruntergeladen: " }).waitFor({ timeout: 10000 });
  ok((await sc.locator(".save-state").textContent()).includes("2 Sitzungen, 1 noch nicht geplant"), "Statuszeile nennt Sitzungen und noch nicht geplante");
  // Hinweise vollständig in einem Dialog (hier: Sitzung 3 hat keine Präsentation)
  const hm1 = tp.locator(".modal", { hasText: "Hinweise zum Ordner" });
  await hm1.waitFor({ timeout: 10000 });
  ok((await hm1.textContent()).includes("Sitzung 3: Zu dieser Sitzung gibt es keine Präsentation."), "Hinweise: Sitzung ohne Präsentation");
  await hm1.getByRole("button", { name: "Fertig" }).click();
  ok(await sc.getByRole("button", { name: "Unterrichtseinheit mit KollegInnen teilen" }).isEnabled(), "nach dem Herunterladen ist der Knopf wieder frei");
  const zip = await readZip(new Uint8Array(readFileSync(zipPath))), names = zip.map((e) => e.name).sort(), get = (n) => zip.find((e) => e.name === n).data;
  const EXPECT = ["Fehlende Sitzungen.pdf", "Leupold-Schema - Wahlen in Deutschland.pdf", "Sitzung 1/Lösung M1.pdf", "Sitzung 1/M1 Wer darf wählen.pdf",
    "Sitzung 1/Notizen zu den Folien - Sitzung 1.pdf", "Sitzung 1/Präsentation - Sitzung 1.pdf", "Sitzung 1/Präsentation - Sitzung 1.pptx", "Sitzung 1/Tafelbild Wahlrecht.pdf", "Sitzung 1/Verlaufsplan - Sitzung 1.pdf", "Sitzung 3/Verlaufsplan - Sitzung 3.pdf"];
  ok(JSON.stringify(names) === JSON.stringify(EXPECT.sort()), "Inhalt des Ordners (ohne Feibeitsblatt keine Erklärung; keine Anmerkungs-PDF, kein Archiv) – " + JSON.stringify(names));
  for (const e of zip) writeFileSync(join(dir, e.name.replace(/\//g, " – ")), e.data);
  // Präsentation: Folie 3 (reine Codefolie) weg, Copyright auf jeder Folie, keine Notizen als Anhang
  const pt = await textOf(get("Sitzung 1/Präsentation - Sitzung 1.pdf"));
  ok(pt.pages.length === 3 && pt.pages.every((p) => p.includes("Copyright Jan-Rickmer Feindt")) && pt.pages[1].includes("Arbeitsblatt „Wer darf wählen?“")
    && !pt.all.includes("Die Hausaufgabe und das Material findest du in Unterricks.") && pt.att.length === 0, "Präsentation: 3 Folien, reine Codefolie entfernt, Copyright, ohne Anhang – " + JSON.stringify(pt.pages));
  // Unterricks-Zeile überdeckt: Bereich der Zeile hat die Farbe des Hintergrunds (vorher hellgraue Schrift)
  const img = pageImage(join(dir, "Sitzung 1 – Präsentation - Sitzung 1.pdf"), 2, 72), bgPx = BG.map((c) => Math.round(c * 255));
  let light = 0, total = 0;
  for (let y = img.h - 22; y < img.h - 10; y++) for (let x = 62; x < 330; x++) { const p = img.px(x, y); total++; if (p[0] > 120) light++; }
  const near = img.px(40, img.h - 16).every((v, i) => Math.abs(v - bgPx[i]) <= 4);
  ok(total > 0 && light === 0 && near, "Unterricks-Zeile auf der Materialfolie überdeckt (" + light + " helle Pixel von " + total + ")");
  // Copyright klein und blass, an einer freien Stelle (rechts unten)
  const doc = await pdfjs.getDocument({ data: new Uint8Array(get("Sitzung 1/Präsentation - Sitzung 1.pdf")).slice(), verbosity: 0 }).promise;
  const cr = (await (await doc.getPage(2)).getTextContent()).items.find((x) => x.str.includes("Copyright"));
  ok(cr && Math.hypot(cr.transform[0], cr.transform[1]) <= 8 && cr.transform[4] > 700 && cr.transform[5] < 20, "Copyright: klein, rechts unten in der Fußzeile");
  await doc.destroy();
  // PowerPoint-Fassung: dieselben 3 Folien als Bild (≈ 1920 px breit), Notizen der Lehrkraft in den Notizen der Folien 1 und 3 (Folie 3 der PDF fiel weg)
  const px = await readZip(new Uint8Array(get("Sitzung 1/Präsentation - Sitzung 1.pptx"))), pxs = new Map(px.map((e) => [e.name, e.data])), pxt = (n) => new TextDecoder().decode(pxs.get(n));
  const media = px.filter((e) => e.name.startsWith("ppt/media/")), png = media[0] && media[0].data, pw = png && png[0] === 0x89 ? new DataView(png.buffer, png.byteOffset).getUint32(16) : 0;
  ok(px.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name)).length === 3 && media.length === 3 && pw >= 1900 && pw <= 1930
    && pxt("ppt/notesSlides/notesSlide1.xml").includes("<a:t>Begrüßen und die Karikatur zeigen</a:t>") && pxt("ppt/notesSlides/notesSlide3.xml").includes("<a:t>Pro und Contra sammeln</a:t>")
    && !pxs.has("ppt/notesSlides/notesSlide2.xml") && !px.some((e) => /Diese Folie fällt weg/.test(new TextDecoder().decode(e.data))),
    "PowerPoint: 3 Folien als Bild (" + pw + " px breit), Notizen der Lehrkraft in den Notizen der Folien 1 und 3, nichts von der entfernten Folie");
  const nt = await textOf(get("Sitzung 1/Notizen zu den Folien - Sitzung 1.pdf"));
  ok(nt.all.includes("Begrüßen und die Karikatur zeigen") && nt.all.includes("Pro und Contra sammeln") && !nt.all.includes("Diese Folie fällt weg"), "Notizen zu den Folien: nur gebliebene Folien");
  const lp = await textOf(get("Leupold-Schema - Wahlen in Deutschland.pdf"));
  ok(["Ausgangslage", "Problem erschließen", "Einen Aufruf zur Wahl schreiben", "Sitzung 1: Warum wählen so wenige?", TXT.passiert, "Zentrale Kompetenz (KCGO):", TXT.kompetenz, TXT.ziel,
    "Sitzung 2: Wer darf wählen?", "Noch nicht geplant", "Die Klasse zählt eine Probewahl aus"].every((s) => lp.all.includes(s)) && lp.pages.every((p) => p.includes("Copyright Jan-Rickmer Feindt")),
    "Leupold-Schema mit den Absätzen je Sitzung");
  const vp = await textOf(get("Sitzung 1/Verlaufsplan - Sitzung 1.pdf"));
  ok(vp.all.includes("Stundenverlauf") && vp.all.includes("Nichtwähler") && !vp.all.includes("Zwischenstopp") && vp.all.includes("Hausaufgabe") && vp.all.includes("Wahl-O-Mat") && vp.all.includes("https://www.wahl-o-mat.de/")
    && vp.all.includes("Zusammenfassung der Sitzung für die Lehrkraft"), "Verlaufsplan: Stundenverlauf ohne Zwischenstopp, Hausaufgabe, Links, Zusammenfassung");
  const ms = await textOf(get("Fehlende Sitzungen.pdf"));
  ok(ms.all.includes("Noch nicht alle Sitzungen dieser Unterrichtseinheit sind bisher geplant") && ms.all.includes("Sitzung 2: Wer darf wählen?") && ms.all.includes("Fallbeispiele") && !ms.all.includes("Sitzung 1:"),
    "Fehlende Sitzungen: Erklärung und nur die ungeplante Stunde mit grobem Ablauf");
  ok((await textOf(get("Sitzung 1/M1 Wer darf wählen.pdf"))).all.includes("Arbeitsblatt M1") && (await textOf(get("Sitzung 1/Tafelbild Wahlrecht.pdf"))).all.includes("passives Wahlrecht"),
    "Material als PDF (auch das Textmaterial)");
  return { unitId: u.id, lessons: [L1.id, L2.id, L3.id], m1Id: m1.id, zipPath, dir };
}

/* Zweiter Teil: mit Notfall-Feibeitsblatt (Erklärung) und Grundschule. markNotfall(fileId) setzt die Herkunft in D1. */
export async function shareE2Epart2({ tp, BASE, T, tool, ok, OUT, SHOT, first, markNotfall }) {
  const { berlinToday, addDays, pdfRef } = await import("../../public/shared.js");
  const { readZip } = await import("../../public/zip.js");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const textOf = async (bytes) => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 }).promise, pages = [];
    for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ").replace(/\s+/g, " "));
    await doc.destroy(); return { pages, all: pages.join(" \n ") };
  };
  const token = await tp.evaluate(() => localStorage.getItem("u.ttoken"));
  const download = async (label) => {
    const sc = tp.locator("#unitshare");
    await sc.locator("button", { hasText: "Unterrichtseinheit mit KollegInnen teilen" }).waitFor({ timeout: 15000 });
    await tp.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
    const click = sc.getByRole("button", { name: "Unterrichtseinheit mit KollegInnen teilen" }).click();
    const conf = tp.locator(".modal", { hasText: "Absätze fehlen" });
    const [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 120000 }), (async () => { await click; if (await conf.isVisible().catch(() => false)) await conf.getByRole("button", { name: "Trotzdem teilen" }).click(); })()]);
    const p = join(first.dir, label + "-" + dl.suggestedFilename()); await dl.saveAs(p);
    const hint = tp.locator(".modal", { hasText: "Hinweise zum Ordner" });
    await sc.locator(".save-state", { hasText: "Heruntergeladen: " }).waitFor({ timeout: 10000 });
    const hints = await hint.isVisible().catch(() => false) ? await hint.textContent() : "";
    if (hints) await hint.getByRole("button", { name: "Fertig" }).click();
    return { name: dl.suggestedFilename(), zip: await readZip(new Uint8Array(readFileSync(p))), hints };
  };
  // Notfall-Feibeitsblatt → Erklärung
  await markNotfall(first.m1Id);
  await tp.goto(BASE + "/#/lk/u/" + first.unitId);
  let z = await download("notfall");
  const fe = z.zip.find((e) => e.name === "Erklärung - Das ist ein Feibeitsblatt.pdf");
  ok(!!fe, "mit Notfall-Feibeitsblatt: die Erklärung „Das ist ein Feibeitsblatt“ liegt bei");
  if (fe) {
    const t = await textOf(fe.data);
    ok(t.all.includes("selbst für meinen Unterricht entwickelt") && t.all.includes("nach Absprache mit mir") && t.all.replace(/\s/g, "").includes("zumgleichenKompetenzerwerb") && t.pages.every((p) => p.includes("Copyright Jan-Rickmer Feindt")),
      "Erklärung: eigenes Werkzeug, Absprache, Notfall-Feibeitsblatt als Dokument");
    // fett: der Hinweis steht in Helvetica-Bold (Schrift des Textstücks nach dem Laden der Seite)
    const doc = await pdfjs.getDocument({ data: new Uint8Array(fe.data).slice(), verbosity: 0 }).promise;
    let font = "";
    for (let i = 1; i <= doc.numPages && !font; i++) {
      const pg = await doc.getPage(i), tc = await pg.getTextContent(), it = tc.items.find((x) => x.str.includes("Absprache mit mir"));
      if (it) { await pg.getOperatorList(); try { font = pg.commonObjs.get(it.fontName).name || "?"; } catch { font = "?"; } }
    }
    ok(/bold/i.test(font), "der Hinweis zur Absprache steht fett (" + font + ")");
    await doc.destroy();
  }
  /* ---------- Grundschule: ohne Präsentation und ohne Erklärung; Verweise im Verlaufsplan als Dateiname ---------- */
  const days = []; for (let d = addDays(berlinToday(), 70); days.length < 2; d = addDays(d, 1)) { const w = new Date(d + "T12:00:00Z").getUTCDay(); if (w >= 1 && w <= 5) days.push(d); }
  const wd = (d) => new Date(d + "T12:00:00Z").getUTCDay(), weekdays = [...new Set(days.map(wd))].map((day) => ({ day, minutes: 45, time: "08:00" }));
  const course = (await T("POST", "/api/teacher/gs/courses", { grade: 2, classes: ["c"], religion: true, weekdays })).data.course;
  ok(!!course, "Grundschul-Kurs für den Test angelegt");
  const gu = (await T("POST", "/api/teacher/units", { subject: "gs", klass: course.id, title: "Josef und seine Brüder", params: { start: days[0], end: days[1], weekdays } })).data.unit;
  await T("PATCH", "/api/teacher/units/" + gu.id, { plan: { titel: "Josef und seine Brüder", ausgangslage: "Die Kinder kennen Streit unter Geschwistern.", lernaufgabe: "Ein Bild zur Versöhnung malen", schritte: [{ titel: "Josef erzählen", beschreibung: "Erzählung im Sitzkreis" }] },
    rows: [{ stundenfrage: "Warum streiten Josef und seine Brüder?", ablauf: ["Erzählung", "Gespräch"], schritt: 0, date: days[0], time: "08:00", minutes: 45 }, { stundenfrage: "Wie versöhnen sie sich?", ablauf: ["Erzählung", "Bild malen"], schritt: 0, date: days[1], time: "08:00", minutes: 45 }] });
  const gunit = (await T("POST", "/api/teacher/units/" + gu.id + "/sessions")).data.unit, G1 = gunit.lessons.find((l) => l.row === gunit.rows[0].uid);
  // noch keine geplante Sitzung: Karte ohne Prompt und ohne Absätze – und ohne Textreste
  await tp.goto(BASE + "/#/lk/u/" + gu.id);
  await tp.locator("#unitshare button", { hasText: "Unterrichtseinheit mit KollegInnen teilen" }).waitFor({ timeout: 15000 });
  const g0 = await tp.locator("#unitshare").textContent();
  ok(g0.includes("0 von 2 Sitzungen geplant") && !/\bnull\b|undefined/.test(g0) && await tp.locator("#unitshare button", { hasText: "Absätze mit Claude schreiben" }).count() === 0,
    "Grundschule ohne geplante Sitzung: Stand ohne Textreste, kein Prompt – " + g0.slice(0, 200));
  const ab = (await (await fetch(BASE + "/api/teacher/lessons/" + G1.id + "/files?area=teacher&name=" + encodeURIComponent("Vorlesetext Josef.pdf"),
    { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/pdf" }, body: Buffer.from(await (await import("pdf-lib")).PDFDocument.create().then(async (d) => { d.addPage().drawText("Josef"); return d.save(); })) })).json()).file;
  let r = await tool("save_verlaufsplan", { lesson_id: G1.id, text: "**1) Sitzkreis**\n- __Lehrkraft liest " + pdfRef(ab.id) + " vor.__\n**2) Gespräch**\n- Warum ist Josef traurig?" });
  ok(r && !r.isError, "Verlaufsplan der Grundschul-Sitzung gespeichert" + (r && r.isError ? ": " + r.content[0].text : ""));
  await tp.reload();
  await tp.locator("#unitshare button", { hasText: "Unterrichtseinheit mit KollegInnen teilen" }).waitFor({ timeout: 15000 });
  const gst = await tp.locator("#unitshare").textContent();
  ok(gst.includes("1 von 2 Sitzungen geplant") && gst.includes("Verlaufsplan") && !gst.includes("Präsentation") && !gst.includes("KCGO"), "Grundschule: Karte ohne Präsentation und KCGO – " + gst.slice(0, 300));
  z = await download("grundschule");
  const gn = z.zip.map((e) => e.name).sort();
  ok(JSON.stringify(gn) === JSON.stringify(["Fehlende Sitzungen.pdf", "Leupold-Schema - Josef und seine Brüder.pdf", "Sitzung 1/Verlaufsplan - Sitzung 1.pdf", "Sitzung 1/Vorlesetext Josef.pdf"]),
    "Grundschule: Leupold-Schema, Fehlende Sitzungen, Verlaufsplan und Material – ohne Präsentation und ohne Erklärung – " + JSON.stringify(gn));
  const gv = await textOf(z.zip.find((e) => e.name === "Sitzung 1/Verlaufsplan - Sitzung 1.pdf").data);
  ok(gv.all.includes("Verlaufsplan") && gv.all.includes("„Vorlesetext Josef.pdf“") && !gv.all.includes("[[pdf"), "Verlaufsplan der Grundschule: der Verweis nennt den Dateinamen");
  const gl = await textOf(z.zip.find((e) => e.name.startsWith("Leupold-Schema")).data);
  ok(gl.all.includes("Grundschule") && gl.all.includes("Josef erzählen"), "Leupold-Schema der Grundschule");
  // aufräumen: Sitzungen, Einheiten, Kurs
  for (const id of [...first.lessons, ...gunit.lessons.map((l) => l.id)]) await T("DELETE", "/api/teacher/lessons/" + id);
  for (const id of [first.unitId, gu.id]) await T("DELETE", "/api/teacher/units/" + id);
  await T("DELETE", "/api/teacher/gs/courses/" + course.id).catch(() => {});
}
