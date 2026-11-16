// printnames.mjs – End-to-End-Prüfung „Dateinamen der Druckliste mit Kurs“ (Nachtrag 32): „<n>x - <sw|farbig> - <einseitig|beidseitig> - <Kurs> - <Titel>.pdf“.
// Geprüft in einer eigenen Sitzung des Grundschulkurses „Sachunterricht 3c“ (aus dem Schritt „Grundschule“; anderes Fach als Religion → „Sach3“): Zeilen der
// Druckliste, Hinweis mit Beispiel, Reihenfolge der Auswahlfelder, Einzel-Download (Name des Browsers und des Servers), ZIP-Datei mit zwei gleich benannten
// Vorlagen (nichts überschrieben), Änderung des Kurses (neuer Name ohne Umstellung); Gymnasium: Ethik-Kurs 7-K → „Eth7“, PoWi E-Phase (EA) → „PoWiE“ über die API.
// Bildschirmfotos 1366/820/390 px, hell und dunkel, in OUT („druckliste-namen-*.png“). Am Ende ist alles gelöscht. Frei erfundene Inhalte, ASCII-Titel
// (Chromium dieser Umgebung speichert Downloads mit Umlauten im Namen als „download“).
// ctx = {tp (Seite der Lehrkraft, angemeldet), BASE, T (Fetch mit Anmeldung), token, ok, OUT, SHOT, cand (nächster Arbeitstag), horizontalIssues, gym? [[Fach, Klasse, Kurs]]}
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { readZip } from "../../public/zip.js";
import { addDays } from "../../public/shared.js";

const a4 = async (label) => { const d = await PDFDocument.create(); d.addPage([595.28, 841.89]).drawText(label, { x: 50, y: 760, size: 20 }); return Buffer.from(await d.save()); };

export async function printNamesE2E({ tp, BASE, T, token, ok, OUT, SHOT, cand, horizontalIssues, gym = [["ethik", "7-K", "Eth7"], ["powi", "EA", "PoWiE"]] }) {
  const day = addDays(cand, 28), wd = new Date(day + "T12:00:00Z").getUTCDay();   // vier Wochen später: stört die Druckaufträge der anderen Schritte nicht
  const made = [];
  const oneLesson = async (subject, klass, title) => {
    const u = (await T("POST", "/api/teacher/units", { subject, klass, title, params: { start: day, end: day, weekdays: [{ day: wd, minutes: 45, time: "10:00" }] } })).data.unit;
    await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: title, lernaufgabe: "Lernaufgabe: " + title }, rows: [{ stundenfrage: title, ablauf: ["Einstieg"], date: day, time: "10:00", minutes: 45 }] });
    const l = (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit.lessons[0].id;
    made.push({ u: u.id, l });
    return l;
  };
  const upPdf = async (lessonId, name, q, label) => (await fetch(BASE + "/api/teacher/lessons/" + lessonId + "/print?name=" + encodeURIComponent(name) + "&" + q,
    { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/pdf" }, body: await a4(label) })).json();

  // Gymnasium über die API: Kurs aus Fach und Jahrgang (Ethik-Kurs 7-K → Eth7, PoWi EA → PoWiE)
  for (const [subject, klass, want] of gym) {
    const l = await oneLesson(subject, klass, "Druckname " + want);
    const f = (await upPdf(l, "Plakat.pdf", "copies=3&duplex=1&color=1", want)).file;
    ok(f && f.printName === "3x - farbig - beidseitig - " + want + " - Plakat.pdf", "Gymnasium " + subject + " " + klass + ": „" + (f && f.printName) + "“");
  }

  // Grundschule: Sachunterricht 3c → „Sach3“
  const sach = (await T("GET", "/api/teacher/gs/courses")).data.courses.find((c) => c.subjectName === "Sachunterricht" && c.grade === 3);
  ok(!!sach, "Grundschulkurs Sachunterricht 3c vorhanden (aus dem Schritt „Grundschule“)");
  const sl = await oneLesson("gs", sach.id, "Wasser im Alltag");
  const f1 = (await upPdf(sl, "Wasser.pdf", "copies=21&duplex=0&color=1", "Wasser 1")).file, f2 = (await upPdf(sl, "Wasser.pdf", "copies=21&duplex=0&color=1", "Wasser 2")).file;
  const NAME = "21x - farbig - einseitig - Sach3 - Wasser.pdf";
  ok(f1.printName === NAME && f2.printName === NAME, "Grundschule (Sachunterricht, Jahrgang 3): „" + f1.printName + "“ – zweimal derselbe Titel");
  const cd = async (id, body) => decodeURIComponent((await fetch(BASE + (await T("POST", "/api/teacher/files/" + id + "/link", body)).data.url)).headers.get("content-disposition") || "");
  ok((await cd(f1.id, {})).includes(NAME) && (await cd(f1.id, { print: true })).includes(NAME), "Server: Content-Disposition mit dem Druck-Namen (mit und ohne print)");

  // Sitzungsseite: Druckliste mit den neuen Namen, Hinweis mit Beispiel des Kurses, Auswahlfelder in der Reihenfolge des Namens
  await tp.goto(BASE + "/#/lk/s/" + sl + "/druckliste");
  const card = tp.locator("#printcard");
  await card.locator(".printrow").nth(1).waitFor({ timeout: 20000 });
  const names = await card.locator(".printrow .name").allTextContents();
  ok(JSON.stringify(names) === JSON.stringify([NAME, NAME]), "Druckliste der Sitzung: " + names.join(" | "));
  const hint = await card.locator("#print-name-hint").textContent();
  ok(hint.endsWith("Der Dateiname nennt Anzahl, schwarz-weiß/farbig, einseitig/beidseitig, den Kurs und den Titel, z. B. „23x - sw - einseitig - Sach3 - Die Arche Noah.pdf“."),
    "Hinweis der Druckliste mit dem Kurs dieser Sitzung: " + hint.slice(-90));
  const row = card.locator(".printrow").first();
  const order = await row.locator(".pset > *").evaluateAll((xs) => xs.map((x) => (x.getAttribute("aria-label") || x.textContent).split(" – ")[0]));
  ok(JSON.stringify(order) === JSON.stringify(["Exemplare", "Schwarz-weiß oder farbig", "Beidseitig oder einseitig"]) && await row.locator('select[aria-label^="Schwarz-weiß oder farbig"] option:checked').textContent() === "farbig (nur wenn nötig)",
    "Zeile: Anzahl, schwarz-weiß/farbig, einseitig/beidseitig (wie im Namen), „farbig“ gewählt");
  // Einzel-Download unter dem Druck-Namen
  let [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), row.getByRole("button", { name: "Herunterladen" }).click()]);
  ok(dl.suggestedFilename() === NAME && readFileSync(await dl.path()).subarray(0, 5).toString() === "%PDF-", "Einzel-Download: „" + dl.suggestedFilename() + "“");
  // ZIP-Datei: zwei gleich benannte Vorlagen – nichts überschrieben
  [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), card.getByRole("button", { name: "Alle herunterladen (ZIP)" }).click()]);
  const entries = await readZip(new Uint8Array(readFileSync(await dl.path())));
  const texts = await Promise.all(entries.map(async (e) => (await PDFDocument.load(e.data)).getPageCount()));
  ok(JSON.stringify(entries.map((e) => e.name)) === JSON.stringify([NAME, "21x - farbig - einseitig - Sach3 - Wasser (2).pdf"]) && texts.every((n) => n === 1)
    && Buffer.compare(Buffer.from(entries[0].data), Buffer.from(entries[1].data)) !== 0,
    "ZIP-Datei: beide Vorlagen, die zweite als „… (2).pdf“ (" + entries.map((e) => e.name).join(" | ") + ")");
  // Druckart ändern: farbig → schwarz-weiß, einseitig → beidseitig
  await row.locator('select[aria-label^="Schwarz-weiß oder farbig"]').selectOption("0");
  await card.locator(".printrow .name", { hasText: "21x - sw - einseitig - Sach3 - Wasser.pdf" }).waitFor({ timeout: 10000 });
  await row.locator('select[aria-label^="Beidseitig oder einseitig"]').selectOption("1");
  await card.locator(".printrow .name", { hasText: "21x - sw - beidseitig - Sach3 - Wasser.pdf" }).waitFor({ timeout: 10000 });
  ok(true, "Druckart geändert: „21x - sw - beidseitig - Sach3 - Wasser.pdf“");

  // Bildschirmfotos der Druckliste: Laptop, iPad hochkant, Handy – hell und dunkel; am Handy ohne seitliches Schieben
  const vp0 = tp.viewportSize();
  for (const [w, hh] of [[1366, 900], [820, 1180], [390, 844]]) for (const dark of [false, true]) {
    await tp.setViewportSize({ width: w, height: hh }); await tp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await tp.waitForTimeout(250);
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ ...SHOT, style: SHOT.style + " header.top,.topbar{visibility:hidden!important}", path: join(OUT, "druckliste-namen-" + w + (dark ? "-dunkel" : "") + ".png") });
    if (w < 400 && !dark) { const hi = (await horizontalIssues(tp)).issues; ok(!hi.length, "Druckliste mit langen Namen am Handy (390 px): ohne seitliches Schieben" + (hi.length ? " – " + JSON.stringify(hi).slice(0, 200) : "")); }
  }
  await tp.emulateMedia({ colorScheme: "light" }); await tp.setViewportSize(vp0);

  // Kurs geändert (anderes Fach): der Name folgt ohne Umstellung – auch für schon vorhandene Dateien
  ok((await T("PATCH", "/api/teacher/gs/courses/" + sach.id, { subjectName: "Werken" })).status === 200, "Kurs umbenannt: Werken");
  const after = (await T("GET", "/api/teacher/lessons/" + sl)).data.files.filter((f) => f.area === "print").map((f) => f.printName);
  await tp.reload();
  await card.locator(".printrow .name", { hasText: "21x - farbig - einseitig - Werk3 - Wasser.pdf" }).waitFor({ timeout: 15000 });
  ok(JSON.stringify(after) === JSON.stringify(["21x - sw - beidseitig - Werk3 - Wasser.pdf", "21x - farbig - einseitig - Werk3 - Wasser.pdf"]), "… vorhandene Dateien heißen jetzt „… - Werk3 - …“ (" + after.join(" | ") + ")");
  ok((await T("PATCH", "/api/teacher/gs/courses/" + sach.id, { subjectName: "Sachunterricht" })).status === 200, "Kurs wieder Sachunterricht");

  // aufräumen
  for (const x of made) { await T("DELETE", "/api/teacher/lessons/" + x.l); await T("DELETE", "/api/teacher/units/" + x.u); }
  ok(!(await T("GET", "/api/teacher/lessons?subject=gs&klass=" + sach.id)).data.lessons.some((l) => l.id === sl), "Test-Sitzungen und -Einheiten wieder gelöscht");
}
