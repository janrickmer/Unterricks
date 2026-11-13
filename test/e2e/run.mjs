// End-to-End-Test: baut die Seite, startet den Worker lokal (wrangler dev: D1, R2, Durable Objects lokal), eine Mock-KI und einen
// Nachbau der Feibeitsblatt-Schnittstelle und spielt die Abläufe mit Chromium durch (Lehrkraft am Laptop, Schüler:in am iPad).
// Aufruf: npm run test:e2e   (Screenshots landen in test-results/)
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { createRequire } from "node:module";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { startMockAI, startMockFeibeitsblatt, startMockPrinter } from "./mocks.mjs";
import { readZip } from "../../public/zip.js";
import { horizontalIssues, strayTexts } from "./mobile-audit.mjs";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = 8787, AI_PORT = 8790, FB_PORT = 8788, BASE = "http://localhost:" + PORT, FB = "http://localhost:" + FB_PORT;
const PAGES_PORT = 8792, PAGES = "http://localhost:" + PAGES_PORT;   // Nachbau von GitHub Pages: andere Herkunft, keine eigenen Header
const PRINT_PORT = 8794;   // Drucker-Attrappe für Cloudflare Browser Run (Chromium von Playwright)
// ein von „Claude“ gestaltetes Arbeitsblatt (HTML mit eigenem CSS, SVG, Schreiblinien, Umlaute, Griechisch; versucht ein Bild aus dem Netz zu laden)
const SHEET_HTML = '<!doctype html><html lang="de"><head><meta charset="utf-8"><style>@page{size:A4;margin:16mm}body{font-family:"Atkinson Hyperlegible Next";font-size:12pt}' +
  'h1{font-size:20pt}.kopf{display:flex;gap:8mm}.kopf span{flex:1;border-bottom:.6pt solid #555}.aufgabe{break-inside:avoid;margin:5mm 0}' +
  '.linien{height:36mm;background:repeating-linear-gradient(transparent 0 8.8mm,#888 8.8mm 9mm)}</style></head><body>' +
  '<div class="kopf"><span>Name:</span><span>Klasse:</span><span>Datum:</span></div><h1>Gewaltenteilung – „Wer kontrolliert wen?“</h1>' +
  '<p><b>M1</b> Ἐν ἀρχῇ · Größe · Übung (Autorentext)</p><img src="https://example.org/fremd.png" alt="">' +
  '<svg width="160" height="60" viewBox="0 0 160 60"><rect x="5" y="5" width="150" height="50" fill="none" stroke="#000"/><text x="20" y="35">Legislative</text></svg>' +
  '<div class="aufgabe"><p><b>1. Erkläre</b> (AFB II) die Gewaltenteilung.</p><div class="linien"></div></div><script>document.body.innerHTML="kaputt"</script></body></html>';
const OUT = join(ROOT, "test-results"); mkdirSync(OUT, { recursive: true });
const FB_PW = "Feibeitsblatt-Testpasswort", T_PW = "Lehrkraft-Passwort-2026";
// Bildschirmfotos ohne kurzzeitige Meldungen (Toasts) und mit abgeschlossenen Einblendungen – sonst verdecken sie Teile der Seite
const SHOT = { style: "#toasts{display:none!important}", animations: "disabled" };

let failures = 0;
const ok = (cond, label) => { if (cond) console.log("  ✓ " + label); else { failures++; console.log("  ✗ " + label); } };
const step = (s) => console.log("\n▶ " + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Ortszeit der Schule (Europe/Berlin) zu einem Zeitpunkt: { date: "JJJJ-MM-TT", time: "HH:MM" }
const berlinAt = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return { date: p.year + "-" + p.month + "-" + p.day, time: p.hour + ":" + p.minute }; };
// Nach Anmeldung/Einrichtung: auf die Übersicht warten (Zustand der Seite statt Navigationsereignis) und die Dauer melden
async function waitTeacherHome(page, t0, label) {
  try { await page.waitForFunction(() => location.hash === "#/lk" && !!document.querySelector(".tiles .tile"), null, { timeout: 60000 }); }
  catch (e) { console.log("    " + label + ": Übersicht nicht erreicht. URL:", page.url(), "Meldung:", await page.locator(".err").allTextContents()); throw e; }
  const ms = Date.now() - t0;
  if (ms > 8000) console.log("    Hinweis: " + label + " dauerte " + ms + " ms");
}

// PDF mit echter Textebene (für die Planungsgrundlagen): pages = [[Zeile, …], …]
async function textPdf(pages) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) { const p = d.addPage([595, 842]); lines.forEach((l, i) => p.drawText(l, { x: 50, y: 780 - i * 22, size: 12, font: f })); }
  return Buffer.from(await d.save());
}
// Escape-Room wie ihn Claude liefert (alle sieben Rätseltypen) – für den Durchlauf im Test
function escapeFixture() {
  const sec = (k) => ({ ueberschrift: "Thema " + k, text: "Sachtext zum Thema " + k + ". Die Gewaltenteilung verteilt Macht auf Legislative, Exekutive und Judikative." });
  const station = (i, teile) => ({ titel: "Station" + i + " Prüfung", ort: "Saal " + i, bibliothek: { einleitung: "Lies genau.", abschnitte: [sec(1), sec(2), sec(3)] },
    raetsel: { auftrag: "Löse das Rätsel " + i + ".", teile, erfolg: "Raum " + i + " ist geschafft." }, erlaeuterung: "Erläuterung zu Station " + i + ": Die Lösung ergibt sich aus Abschnitt 1." });
  return { name: "Mission Gewaltenteilung", titel: "Mission Gewaltenteilung", untertitel: "Rette die Verfassung von Karlsruhe.", loesungswort: "GERICH",
    rahmen: { sprecher: "Präsidentin des Gerichts", auftrag: "Das Archiv wurde durcheinandergebracht. Hilf uns!", rolle: "Du bist die neue Archivarin." },
    stationen: [
      station(1, [{ typ: "einfachwahl", frage: "Wer beschließt Gesetze?", optionen: [{ text: "Der Bundestag", richtig: true }, { text: "Das Bundesverfassungsgericht" }, { text: "Die Bundesregierung" }], abschnitt: 1, anfang: "Der Bu", loesung: "Der Bundestag" },
        { typ: "koerbe", frage: "Sortiere die Organe.", koerbe: [{ name: "Legislative", anfang: "Leg" }, { name: "Judikative", anfang: "Jud" }], karten: [{ text: "Bundestag", korb: 1, abschnitt: 1 }, { text: "Bundesrat", korb: 1 }, { text: "Amtsgericht", korb: 2 }, { text: "Verfassungsgericht", korb: 2 }] }]),
      station(2, [{ typ: "zuordnung", frage: "Ordne zu.", optionen: ["prüft Gesetze", "beschließt Gesetze", "führt Gesetze aus"], zeilen: [{ text: "Das BVerfG", antwort: "prüft Gesetze", abschnitt: 2 }, { text: "Der Bundestag", antwort: "beschließt Gesetze" }, { text: "Die Verwaltung", antwort: "führt Gesetze aus" }] },
        { typ: "mehrfachwahl", frage: "Welche Aussagen stimmen?", optionen: [{ text: "Gerichte sind unabhängig.", richtig: true }, { text: "Richter sind weisungsgebunden.", erklaerung: "Nein, sie sind unabhängig." }, { text: "Gesetze binden die Verwaltung.", richtig: true }], abschnitt: 2 }]),
      station(3, [{ typ: "luecken", frage: "Ergänze.", text: "Die [[1]] ist die gesetzgebende Gewalt, die [[2]] die rechtsprechende.", luecken: [{ nr: 1, loesungen: ["Legislative"], abschnitt: 1 }, { nr: 2, loesungen: ["Judikative", "Rechtsprechung"], abschnitt: 1 }] },
        { typ: "zahl", frage: "Wie viele Richter:innen hat das BVerfG?", einheit: "Richter:innen", min: 16, max: 16, woerter: ["sechzehn"], abschnitt: 3, hinweis: "Zwei Senate zu je acht.", loesung: "16" }]),
      station(4, [{ typ: "luecken", frage: "Wähle aus.", text: "Das Grundgesetz trat [[1]] in Kraft.", luecken: [{ nr: 1, loesungen: ["1949"], abschnitt: 2 }], wortbank: ["1949", "1919", "1990"] },
        { typ: "einfachwahl", frage: "Wo sitzt das BVerfG?", optionen: [{ text: "Karlsruhe", richtig: true }, { text: "Berlin" }], abschnitt: 3, anfang: "Ka" }]),
      station(5, [{ typ: "koerbe", frage: "Verfahren oder Organ?", koerbe: [{ name: "Verfahren" }, { name: "Organ" }], karten: [{ text: "Normenkontrolle", korb: 1 }, { text: "Verfassungsbeschwerde", korb: 1 }, { text: "Bundesrat", korb: 2 }, { text: "Bundespräsident", korb: 2 }] },
        { typ: "zuordnung", frage: "Wer klagt?", optionen: ["Bürger:in", "Landesregierung"], zeilen: [{ text: "Verfassungsbeschwerde", antwort: "Bürger:in" }, { text: "Abstrakte Normenkontrolle", antwort: "Landesregierung" }] }]),
      station(6, [{ typ: "mehrfachwahl", frage: "Was schützt die Demokratie?", optionen: [{ text: "Gewaltenteilung", richtig: true }, { text: "Machtkonzentration" }, { text: "Grundrechte", richtig: true }] },
        { typ: "schlussstein", frage: "Wie lautet das Lösungswort?", loesungen: ["GERICH", "Gericht"], hinweis1: "Sieh dir die Buchstaben an.", hinweis2: "Es beginnt mit G.", loesung: "GERICH" }]),
    ],
    finale: { ueberschrift: "Das Archiv ist gerettet", text: "Du hast alle Räume gelöst.", warum: "GERICH steht für das Gericht, das die Verfassung hütet.", rueckblick: ["Gewaltenteilung", "Organe", "Verfahren", "Grundgesetz", "Karlsruhe", "Schutz"], schluss: "Weiter zum Finale!" },
    feibeitsblatt: { titel: "Finale: Mission Gewaltenteilung", aufgaben: [{ text: "Beurteile, ob das BVerfG zu mächtig ist.", ki_auftrag: "Pro/Contra, eigenes Urteil" }] } };
}
// holder = Nummer einer Unterricks-Codefolie (Platzhalter wie laut Prompt: Aufforderung, Materialtitel, die feste Zeile und eine kleine Fußzeile)
async function pdf(pages, label, oldCode, holder) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.HelveticaBold), mono = await d.embedFont(StandardFonts.CourierBold), reg = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = d.addPage([960, 540]); p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.12, 0.23, 0.37) });
    if (i === holder) {
      p.drawText("Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", { x: 60, y: 380, size: 30, font: reg, color: rgb(1, 1, 1) });
      p.drawText("Feibeitsblatt: Die wehrhafte Demokratie", { x: 60, y: 320, size: 36, font: f, color: rgb(1, 1, 1) });
      p.drawText("Unterricks-Codefolie: Hier zeigt Unterricks den QR-Code und den Sitzungscode.", { x: 60, y: 60, size: 12, font: reg, color: rgb(1, 1, 1) });
      p.drawText(label + " · " + i, { x: 60, y: 20, size: 9, font: reg, color: rgb(1, 1, 1) });
      continue;
    }
    p.drawText(label + " – Folie " + i, { x: 60, y: 260, size: 48, font: f, color: rgb(1, 1, 1) });
    // Präsentation aus einer früheren Sitzung: Folie 1 mit großem Sitzungscode, Folie 2 als Materialfolie mit kleinem
    if (oldCode && i === 1) { p.drawText(oldCode, { x: 60, y: 100, size: 96, font: mono, color: rgb(1, 0.85, 0.3) }); p.drawText("Sitzungscode (bleibt stehen)", { x: 60, y: 172, size: 24, font: f, color: rgb(1, 1, 1) }); }
    if (oldCode && i === 2) p.drawText("Sitzungscode " + oldCode, { x: 60, y: 120, size: 32, font: f, color: rgb(1, 1, 1) });
  }
  return Buffer.from(await d.save());
}

// Statischer Server wie GitHub Pages (nur Dateien, keine Sicherheits-Header)
function startStatic(dir, port) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".txt": "text/plain" };
  const srv = createServer((req, res) => {
    const u = new URL(req.url, "http://x"), f = join(dir, decodeURIComponent(u.pathname.endsWith("/") ? u.pathname + "index.html" : u.pathname));
    if (!f.startsWith(dir) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end("nicht gefunden"); }
    res.writeHead(200, { "content-type": types[extname(f)] || "application/octet-stream" }); res.end(readFileSync(f));
  });
  return new Promise((resolve) => srv.listen(port, () => resolve(srv)));
}

async function main() {
  step("Bauen und Dienste starten");
  execFileSync("node", ["scripts/build.mjs"], { cwd: ROOT, env: { ...process.env, FEIBEITSBLATT_API: FB }, stdio: "inherit" });
  const ai = await startMockAI(AI_PORT);
  const fbm = await startMockFeibeitsblatt(FB_PORT, FB_PW);
  // ein noch laufender Worker eines früheren Laufs würde mit altem Stand antworten: warten, bis der Port frei ist
  for (let i = 0; i < 20; i++) { try { await fetch(BASE + "/api/health"); await sleep(1000); } catch { break; } }
  const persist = mkdtempSync(join(process.env.E2E_TMP || tmpdir(), "unterricks-e2e-"));
  const wd = spawn("npx", ["wrangler", "dev", "--local", "--port", String(PORT), "--persist-to", persist, "--var", "SETTINGS_SECRET:e2e-geheimnis-1234567890",
    "--var", "DEV_ALLOW_HTTP_AI:1", "--var", "RENDER_MOCK_URL:http://127.0.0.1:" + PRINT_PORT + "/pdf", "--var", "RENDER_GAP_MS:0", "--var", "FEIBEITSBLATT_API:" + FB, "--var", "FEIBEITSBLATT_URL:" + FB + "/", "--var", "PAGES_ORIGINS:" + PAGES], { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const stopWrangler = () => { try { process.kill(-wd.pid, "SIGTERM"); } catch {} };
  process.on("exit", stopWrangler);
  let wlog = ""; wd.stdout.on("data", (d) => (wlog += d)); wd.stderr.on("data", (d) => (wlog += d));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch {} await sleep(1000); }
  const browser = await chromium.launch();
  const printer = await startMockPrinter(PRINT_PORT, browser);
  const pageErrors = [];
  const watch = (p, who) => { p.on("pageerror", (e) => pageErrors.push(who + ": " + e.message)); };
  try {
    /* ---------- Lehrkraft: Ersteinrichtung ---------- */
    step("Lehrkraft richtet den Zugang einmalig ein");
    const tctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    await tctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const tp = await tctx.newPage(); watch(tp, "Lehrkraft");
    await tp.goto(BASE + "/");
    ok(await tp.locator("#spw").isVisible(), "Startseite zeigt nur die Passwortabfrage");
    ok(await tp.getByRole("link", { name: "Lehrkräfte" }).isVisible(), "kleiner Link „Lehrkräfte“ in der Fußleiste");
    await tp.screenshot({ ...SHOT, path: join(OUT, "start-passwort.png") });
    await tp.getByRole("link", { name: "Lehrkräfte" }).click();
    await tp.locator("#tu").waitFor(); await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-einrichtung.png") });
    await tp.fill("#tu", "Feindt"); await tp.fill("#tp", T_PW); await tp.fill("#tp2", T_PW);
    let tLogin = Date.now();
    await tp.getByRole("button", { name: "Zugang einrichten" }).click();
    await waitTeacherHome(tp, tLogin, "Einrichtung");
    ok(true, "eingerichtet und angemeldet");
    // Druckaufträge für den nächsten Arbeitstag (Anforderung 14): ganz oben über dem Wochenkalender – noch ohne Unterricht
    const printTop = () => tp.evaluate(() => { const c = document.querySelector("main .printnext"), w = document.querySelector("main .weekcal");
      return !!c && !!w && !!c.previousElementSibling && c.previousElementSibling.matches("header.pagehead") && !!(c.compareDocumentPosition(w) & Node.DOCUMENT_POSITION_FOLLOWING); });
    await tp.locator(".printnext .pn-empty").waitFor({ timeout: 15000 });
    ok(await printTop() && await tp.locator(".printnext h2").textContent() === "Druckaufträge für den nächsten Arbeitstag"
      && await tp.locator(".printnext .pn-empty").textContent() === "In den nächsten Wochen ist kein Unterricht geplant." && await tp.locator(".printnext .pn-all").isHidden(),
      "Startseite: Feld „Druckaufträge für den nächsten Arbeitstag“ ganz oben (vor dem Wochenkalender) – noch ohne Unterricht");
    const token = await tp.evaluate(() => localStorage.getItem("u.ttoken"));
    const T = (method, path, body) => fetch(BASE + path, { method, headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
    const again = await fetch(BASE + "/api/teacher/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "x", salt: "a".repeat(22), iterations: 600000, authKey: "b".repeat(43), deviceId: "c".repeat(43) }) });
    ok(again.status === 409, "eine zweite Einrichtung ist nicht möglich (409)");

    step("KI auf die Mock-KI stellen (wie ein kostenloser OpenAI-kompatibler Dienst)");
    let r = await T("PUT", "/api/teacher/ai", { key: { provider: "custom", apiKey: "test-key-123456", base: "http://127.0.0.1:" + AI_PORT + "/v1" } });
    ok(r.status === 200, "Schlüssel gespeichert (verschlüsselt)");
    const tasks = Object.fromEntries(["planning", "ideas", "material", "portal", "feibeitsblatt"].map((k) => [k, { provider: "custom", model: "mock-1" }]));
    r = await T("PUT", "/api/teacher/ai", { tasks });
    ok(r.data.tasks.every((t) => t.choice.provider === "custom"), "Modell je Aufgabe gespeichert");
    r = await T("POST", "/api/teacher/ai/models", { provider: "custom" });
    ok(r.data && r.data.models.includes("mock-2"), "verfügbare Modelle abrufbar");

    const { addDays, fmtDay, lessonTimes, fmtClockBerlin } = await import("../../public/shared.js");
    const today = new Date().toLocaleDateString("sv-SE");
    // Connector früh einrichten: Claude (simuliert über MCP) plant Einheit und Vertretung
    const mc = (await T("POST", "/api/teacher/mcp")).data;
    const rpc = (body, url = mc.url) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }).then(async (x) => ({ status: x.status, data: x.status === 202 ? null : await x.json() }));
    const tool = (name, args) => rpc({ jsonrpc: "2.0", id: Date.now(), method: "tools/call", params: { name, arguments: args } }).then((x) => x.data.result);

    /* ---------- Planungsgrundlagen ---------- */
    step("Planungsgrundlagen: KCGO und Abiturerlass hochladen (Text per PDF.js im Browser, Abschnitte erkannt)");
    await tp.getByRole("link", { name: "Planungsgrundlagen" }).first().click();
    await tp.getByRole("link", { name: /Politik und Wirtschaft/ }).click();
    await tp.locator("h1", { hasText: "Planungsgrundlagen · Politik und Wirtschaft" }).waitFor();
    ok(await tp.locator(".unit-table tr", { hasText: "Q2 GK" }).locator(".warnc", { hasText: "KCGO Politik und Wirtschaft" }).count() === 1, "Status: für Q2 GK fehlt das KCGO");
    const kcgo = await textPdf([["Kerncurriculum gymnasiale Oberstufe", "Politik und Wirtschaft"], ["2 Bildungsbeitrag und didaktische Grundsätze", "Didaktische Prinzipien: Kontroversität und Problemorientierung."],
      ["3 Kompetenzorientierung", "Text"], ["3.2 Bildungsstandards", "Analysekompetenz und Urteilskompetenz"], ["3.3 Kurshalbjahre und Themenfelder", "In Q1 bis Q3 sind die Themenfelder 1 und 2 verbindlich."],
      ["E1 Gesellschaft", "Themenfeld E1.1 Sozialisation"], ["E2 Wirtschaft", "Themenfeld E2.1 Markt"], ["Q1 Politische Strukturen", "Themenfeld Q1.1 Verfassung"],
      ["Q2 Wirtschaftspolitik", "Themenfeld Q2.1 Konjunkturpolitik"], ["Q3 Internationale Beziehungen", "Themenfeld Q3.1"], ["Q4 Zukunftsfragen", "Themenfeld Q4.1"]]);
    await tp.locator('select[aria-label="Art der Planungsgrundlage"]').selectOption("kcgo");
    await tp.locator('input[aria-label="PDF-Datei"]').setInputFiles({ name: "KCGO_PoWi.pdf", mimeType: "application/pdf", buffer: kcgo });
    await tp.locator(".small", { hasText: "11 Seiten" }).first().waitFor({ timeout: 30000 });
    ok(await tp.locator('input[aria-label="Seiten für Q2"]').inputValue() === "9" && await tp.locator('input[aria-label="Seiten für Verbindliche Regelungen (3.3)"]').inputValue() === "5", "Kurshalbjahre und Regeln automatisch erkannt (korrigierbar)");
    await tp.getByRole("button", { name: "Hochladen" }).click();
    await tp.locator(".toast", { hasText: "(11 Seiten)" }).waitFor({ timeout: 20000 });
    // erst wenn die Seite neu gezeichnet ist (vorher fehlten KCGO und Erlass)
    await tp.waitForFunction(() => { const tr = [...document.querySelectorAll(".unit-table tr")].find((x) => x.textContent.startsWith("Q2 GK")); return !!tr && !tr.textContent.includes("KCGO Politik") && tr.textContent.includes("Abiturerlass für den Kurs Q2 GK"); }, null, { timeout: 15000 });
    ok(true, "KCGO gespeichert; für Q2 GK fehlt jetzt nur noch der Abiturerlass");
    const erlass = await textPdf([["Abiturerlass 2028", "Inhalt"], ["Ethik", "4.1 Kursart Grundkurs", "Text Ethik"], ["Politik und Wirtschaft", "5.1 Kursart Grundkurs", "Verbindlich: Themenfeld Q2.3 Europäische Wirtschaftspolitik"], ["Physik", "6.1 Kursart"]]);
    await tp.locator('select[aria-label="Art der Planungsgrundlage"]').selectOption("abiturerlass");
    await tp.getByLabel("Q2 GK", { exact: true }).check();
    await tp.locator('input[aria-label="PDF-Datei"]').setInputFiles({ name: "Abiturerlass_2028.pdf", mimeType: "application/pdf", buffer: erlass });
    await tp.locator(".small", { hasText: "4 Seiten" }).first().waitFor({ timeout: 30000 });
    ok(await tp.locator('input[aria-label="Seiten für Fachteil"]').inputValue() === "3–4", "Fachteil „Politik und Wirtschaft“ im Erlass gefunden");
    await tp.getByRole("button", { name: "Hochladen" }).click();
    await tp.locator(".toast", { hasText: "(4 Seiten)" }).waitFor({ timeout: 20000 });
    await tp.locator(".unit-table tr", { hasText: "Q2 GK" }).locator(".ok", { hasText: "vollständig" }).waitFor();
    ok(await tp.locator(".unit-table tr", { hasText: "Q2 LK" }).locator(".warnc", { hasText: "Abiturerlass für den Kurs Q2 LK" }).count() === 1, "Erlass gilt nur für den zugeordneten Kurs (Q2 GK ✓, Q2 LK fehlt)");
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-planungsgrundlagen.png"), fullPage: true });
    r = await T("GET", "/api/teacher/basis?subject=powi&klass=Q2-GK");
    ok(r.data.docs.length === 2 && !r.data.missing.length, "Planungsgrundlagen für Q2 GK vollständig");

    /* ---------- Unterrichtseinheit ---------- */
    step("Menü: Gymnasium · Grundschule · Planungsgrundlagen · Einstellungen · Abmelden; Bereich Grundschule mit Wochenkalender");
    {
      const navTexts = (await tp.locator(".topbar nav").first().locator("a, button").allTextContents()).map((t) => t.trim());
      ok(JSON.stringify(navTexts) === JSON.stringify(["Gymnasium", "Grundschule", "Planungsgrundlagen", "Einstellungen", "Abmelden"]), "Menü: " + navTexts.join(" · "));
      await tp.getByRole("link", { name: "Grundschule", exact: true }).click();
      await tp.waitForURL(/#\/lk\/grundschule$/);
      await tp.locator("h1", { hasText: "Grundschule" }).waitFor({ timeout: 10000 });
      await tp.locator(".weekcal .wk-body:not(.skeleton)").waitFor({ timeout: 15000 });
      await tp.locator(".printnext .pn-empty").waitFor({ timeout: 15000 });
      ok(await printTop() && await tp.locator(".printnext .pn-empty").textContent() === "In den nächsten Wochen ist kein Unterricht geplant.", "Grundschule: dasselbe Feld „Druckaufträge …“ ganz oben, vor dem Wochenkalender");
      ok((await tp.locator('.topbar nav a[aria-current="page"]').allTextContents()).join("|") === "Grundschule" && await tp.locator("html").getAttribute("data-fach") === "gs"
        && await tp.locator(".weekcal").count() === 1 && await tp.getByText("Noch keine Kurse – legen Sie mit „Neuen Kurs anlegen“ den ersten an.").count() === 1,
        "Grundschule: Menüpunkt markiert (aria-current), grüne Bereichsfarbe, Wochenkalender, noch keine Kurse");
    }

    step("Fach → Kurs → Unterrichtseinheit: Rahmendaten, Planung mit Claude (Connector), Leupold-Schema, Tabelle");
    await tp.getByRole("link", { name: "Gymnasium", exact: true }).click();
    await tp.getByRole("link", { name: /Politik und Wirtschaft/ }).click();
    await tp.locator(".class-btn").first().waitFor();
    ok(await tp.getByRole("link", { name: "7A", exact: true }).count() === 0 && await tp.getByRole("link", { name: "8A", exact: true }).count() === 1 && await tp.getByRole("link", { name: "6A", exact: true }).count() === 1, "PoWi: Jahrgänge laut Fach-Einstellungen (ohne Jahrgang 7)");
    ok(await tp.getByRole("link", { name: "Q2 GK", exact: true }).count() === 1 && await tp.getByRole("link", { name: "Q2 LK", exact: true }).count() === 1, "Q-Phase: Grund- und Leistungskurs je Kurshalbjahr");
    await tp.getByRole("link", { name: "Q2 GK", exact: true }).click();
    ok(await tp.locator("#nt").count() === 0, "keine Sitzung ohne Einheit: zuerst wird die Einheit geplant");
    await tp.fill("#ut", "Gewaltenteilung und BVerfG");
    await tp.getByRole("button", { name: "Einheit anlegen" }).click();
    await tp.waitForURL(/#\/lk\/u\/[a-f0-9]{16}$/);
    const unitId = tp.url().split("/").pop();
    await tp.locator('input[aria-label="Minuten"]').first().fill("90");
    await tp.getByRole("button", { name: "+ Sitzung pro Woche" }).click();
    await tp.locator('select[aria-label="Wochentag"]').nth(1).selectOption("3"); await tp.locator('input[aria-label="Minuten"]').nth(1).fill("90");
    await tp.getByRole("button", { name: "+ Sitzung pro Woche" }).click();
    await tp.locator('select[aria-label="Wochentag"]').nth(2).selectOption("5"); await tp.locator('input[aria-label="Minuten"]').nth(2).fill("90");
    await tp.locator('input[aria-label="Beginn"]').fill(today); await tp.locator('input[aria-label="Ende"]').fill(addDays(today, 13));
    await tp.getByRole("button", { name: "Speichern und Termine berechnen" }).click();
    await tp.locator(".toast", { hasText: "6 Sitzungen verfügbar." }).waitFor({ timeout: 10000 });
    ok(true, "Rahmendaten (Mo/Mi/Fr à 90 min, zwei Wochen) → 6 Termine");

    step("Wochenkalender auf der Startseite: Unterricht der Woche aus den Stundenplänen, Klick öffnet die Klasse");
    {
      const { berlinToday, isoWeek } = await import("../../public/shared.js");
      const { calendarWeek, weekRangeText, weekSchedule } = await import("../../public/planning.js");
      const mon = calendarWeek(berlinToday());
      // zwei Einheiten mit Uhrzeit (eine überschneidet sich am Montag), ein Ausfall am Mittwoch, Donnerstag ohne Uhrzeit
      const u9b = (await T("POST", "/api/teacher/units", { subject: "evrel", klass: "9B", title: "Propheten", params: { start: mon, end: addDays(mon, 11),
        weekdays: [{ day: 1, minutes: 90, time: "08:00" }, { day: 3, minutes: 45, time: "10:00" }], breaks: [{ from: addDays(mon, 2), to: addDays(mon, 2), label: "Ausfall" }] } })).data.unit;
      const u10 = (await T("POST", "/api/teacher/units", { subject: "ethik", klass: "10C", title: "Glück", params: { start: mon, end: addDays(mon, 11), weekdays: [{ day: 1, minutes: 45, time: "08:30" }, { day: 4, minutes: 45 }] } })).data.unit;
      ok(!!(u9b && u10), "Einheiten mit Stundenplan und Uhrzeit angelegt");
      const sch = await T("GET", "/api/teacher/schedule");
      const keys = new Set(sch.data.units.flatMap((x) => Object.keys(x))), pkeys = new Set(sch.data.units.flatMap((x) => Object.keys(x.params)));
      ok(sch.status === 200 && sch.data.units.some((x) => x.id === u9b.id) && sch.data.units.some((x) => x.id === unitId) && !keys.has("plan") && !keys.has("rows") && !pkeys.has("notes")
        && (await fetch(BASE + "/api/teacher/schedule")).status === 401, "GET /api/teacher/schedule: nur Rahmendaten (kein Plan, kein Ablauf, keine Notizen), nur angemeldet");
      await tp.goto(BASE + "/#/lk"); await tp.locator(".weekcal .wk-ev").first().waitFor({ timeout: 15000 });
      const want = weekSchedule(sch.data.units, mon).days.reduce((n, d) => n + d.timed.length + d.untimed.length, 0);
      ok((await tp.locator("#wk-range").textContent()) === weekRangeText(mon) + " · KW " + isoWeek(mon) && await tp.locator(".weekcal .wk-ev").count() === want
        && await tp.locator(".weekcal").evaluate((c) => c.compareDocumentPosition(document.querySelector(".tiles")) & Node.DOCUMENT_POSITION_FOLLOWING) > 0,
        "Startseite: Wochenkalender ganz oben (vor den Fächern), Woche " + weekRangeText(mon) + ", " + want + " Einträge");
      const monCol = tp.locator(".wk-day").nth(0);
      const ev9 = monCol.locator(".wk-ev", { hasText: "9B" }), ev10 = monCol.locator(".wk-ev", { hasText: "10C" });
      const [b9, b10, bc] = [await ev9.boundingBox(), await ev10.boundingBox(), await monCol.boundingBox()];
      ok((await ev9.textContent()).includes("08:00–09:30") && (await ev10.textContent()).includes("08:30–09:15") && b9.x + b9.width <= b10.x + 1 && b9.x >= bc.x - 1 && b10.x + b10.width <= bc.x + bc.width + 1
        && b10.y > b9.y && b10.y < b9.y + b9.height && await ev9.getAttribute("data-fach") === "evrel" && await ev10.getAttribute("data-fach") === "ethik",
        "Uhrzeit-Raster: Ev. Religion 9B und Ethik 10C am Montag nebeneinander (Überschneidung), Fachfarbe je Eintrag");
      ok((await tp.locator(".wk-day").nth(2).locator(".wk-off").textContent()).includes("Ev. Religion 9B (Ausfall)") && await tp.locator(".wk-day").nth(3).locator(".wk-untimed .wk-ev", { hasText: "10C" }).count() === 1,
        "Ausfall laut Einheit als „Entfällt“, Donnerstag ohne Uhrzeit in der eigenen Zeile");
      // Wochen blättern: Fokus bleibt auf dem Knopf, „Heute“ führt zurück
      await tp.getByRole("button", { name: "Nächste Woche" }).click();
      await tp.locator("#wk-range", { hasText: weekRangeText(addDays(mon, 7)) }).waitFor({ timeout: 5000 });
      ok(await tp.evaluate(() => document.activeElement && document.activeElement.getAttribute("aria-label")) === "Nächste Woche" && await tp.locator(".weekcal .wk-ev").count() === weekSchedule(sch.data.units, addDays(mon, 7)).days.reduce((n, d) => n + d.timed.length + d.untimed.length, 0)
        && await tp.locator(".weekcal").getByRole("button", { name: "Zur Woche von heute" }).getAttribute("aria-disabled") === "false", "„Nächste Woche“: neue Woche, Fokus bleibt auf dem Knopf");
      await tp.locator(".weekcal").getByRole("button", { name: "Zur Woche von heute" }).click();
      await tp.locator("#wk-range", { hasText: weekRangeText(mon) }).waitFor({ timeout: 5000 });
      ok(await tp.locator(".weekcal").getByRole("button", { name: /^Heute –/ }).getAttribute("aria-disabled") === "true", "„Heute“ führt zur Woche von heute zurück");
      await tp.locator(".weekcal").screenshot({ path: join(OUT, "lehrkraft-woche.png") });
      await tp.emulateMedia({ colorScheme: "dark" }); await tp.waitForTimeout(200); await tp.locator(".weekcal").screenshot({ path: join(OUT, "lehrkraft-woche-dunkel.png") }); await tp.emulateMedia({ colorScheme: "light" });
      // Klick öffnet die Klasse
      await ev9.click();
      await tp.waitForURL(/#\/lk\/f\/evrel\/9B$/);
      await tp.locator("h1", { hasText: "9B" }).waitFor({ timeout: 10000 });
      ok((await tp.locator("h1").textContent()).includes("Evangelische Religion"), "Klick auf den Eintrag öffnet die Klasse (Ev. Religion · 9B)");
      await tp.goto(BASE + "/#/lk"); await tp.locator(".weekcal .wk-ev").first().waitFor({ timeout: 15000 });
      await tp.locator(".weekcal .wk-ev", { hasText: "10C" }).first().focus(); await tp.keyboard.press("Enter");
      await tp.waitForURL(/#\/lk\/f\/ethik\/10C$/);
      ok(true, "… auch per Tastatur (Enter): Ethik · 10C");
      await tp.goto(BASE + "/#/lk/u/" + unitId); await tp.locator('input[aria-label="Beginn"]').waitFor({ timeout: 10000 });
    }
    await tp.getByRole("button", { name: "Einheit mit Claude planen" }).click();
    const um = tp.locator(".modal", { hasText: "Welches Sprachmodell?" });
    await um.waitFor();
    await um.getByRole("button", { name: "Prompt kopieren" }).click();
    const unitPrompt = await tp.evaluate(() => navigator.clipboard.readText());
    ok(["get_planning_basis", unitId, "**priorisierten**", "**sekundären**", "**drei** zentrale Lernaufgaben", "Leupold-Schema", "genau 6 Zeilen", "save_unit_plan", "Q2 GK", "Grundkurs"].every((x) => unitPrompt.includes(x)), "Prompt: Planungsgrundlage priorisiert/sekundär, drei Lernaufgaben, Leupold-Schema, Tabelle mit 6 Stunden");
    await um.getByRole("button", { name: "Schließen", exact: true }).getByText("Schließen").click();
    r = await tool("get_planning_basis", { unit_id: unitId });
    const basisText = r.content[0].text;
    ok(basisText.includes("Konjunkturpolitik") && basisText.includes("Europäische Wirtschaftspolitik") && basisText.includes("Kontroversität") && !basisText.includes("Sozialisation"), "Claude liest KCGO (Q2, Regeln, Grundlagen) und Fachteil des Erlasses – nicht E1");
    const stunden = [
      { stundenfrage: "Wer kontrolliert die Macht?", ablauf: ["Karikatur", "Gewaltenteilung erarbeiten"], schritt: 0 },
      { stundenfrage: "Wie arbeitet das Bundesverfassungsgericht?", ablauf: ["Verfahren"], schritt: 1 },
      { stundenfrage: "Ist das BVerfG zu mächtig?", ablauf: ["Urteil analysieren"], schritt: 1 },
      { stundenfrage: "Wie wehrhaft ist die Demokratie?", ablauf: ["Fallbeispiel"], schritt: 2 },
      { stundenfrage: "Positionspapier planen", ablauf: ["Gliederung"], schritt: 2 },
      { stundenfrage: "Positionspapier präsentieren", ablauf: ["Galeriegang"], schritt: 2 }];
    r = await tool("save_unit_plan", { unit_id: unitId, plan: { titel: "Gewaltenteilung und BVerfG", planungsgrundlage: { name: "Problemstudie", begruendung: "Kontroverse um die Macht des Gerichts", alternative: { name: "Fallanalyse", begruendung: "Urteil als Fall" } },
      lernaufgabe: "Positionspapier: Braucht Deutschland ein starkes Verfassungsgericht?", ausgangslage: "Grundkenntnisse über Verfassungsorgane",
      schritte: [{ titel: "Problem erschließen", beschreibung: "Karikatur analysieren, Fragen sammeln" }, { titel: "Problemstudie: Akteure", beschreibung: "Verfahren erarbeiten und vergleichen" }, { titel: "Urteilen", beschreibung: "Positionen beurteilen und begründen" }] }, stunden });
    ok(!r.isError, "Claude speichert Plan und Ablauf über den Connector (save_unit_plan)");
    await tp.reload();
    await tp.locator(".leupold").first().waitFor();
    ok(await tp.locator(".leupold .lp-row").count() === 3 && (await tp.locator(".leupold").first().textContent()).includes("Positionspapier: Braucht Deutschland"), "Leupold-Schema: Ausgangslage → 3 Lernschritte → Lernaufgabe");
    ok(await tp.locator(".unit-table tbody tr").count() === 6, "Tabelle mit 6 Stunden (Stundenfrage | grober Ablauf)");
    await tp.locator('textarea[aria-label="Stundenfrage 1"]').fill("Das Bundesverfassungsgericht");
    await tp.getByRole("button", { name: "Änderungen speichern" }).click();
    await tp.locator(".toast", { hasText: "Einheit gespeichert." }).waitFor({ timeout: 10000 });
    let unit = (await T("GET", "/api/teacher/units/" + unitId)).data.unit;
    ok(unit.rows[0].stundenfrage === "Das Bundesverfassungsgericht" && unit.rows.every((x) => x.date), "Tabelle bearbeitet und gespeichert; alle Stunden mit Termin");
    ok((await T("PATCH", "/api/teacher/units/" + unitId, { rows: unit.rows, baseVersion: 1 })).status === 409, "veraltete Fassung der Einheit überschreibt nie still (409)");
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-einheit.png"), fullPage: true });
    await tp.getByRole("button", { name: "Einheit festlegen und Sitzungen anlegen" }).click();
    await tp.locator(".toast", { hasText: "6 Sitzung(en) angelegt." }).waitFor({ timeout: 20000 });
    ok(await tp.getByRole("link", { name: "Sitzung öffnen" }).count() === 6, "je Stunde eine Sitzung mit Datum");
    unit = (await T("GET", "/api/teacher/units/" + unitId)).data.unit;
    const byRow = (i) => unit.lessons.find((x) => x.row === unit.rows[i].uid);
    const lessonId = byRow(0).id;
    if (byRow(0).date !== today) await T("PATCH", "/api/teacher/lessons/" + lessonId, { date: today });   // erste Stunde = heute (für den Zwischenstopp-Hinweis)
    await tp.goto(BASE + "/#/lk/s/" + lessonId);
    await tp.locator(".unitbox").waitFor();
    ok((await tp.locator(".unitbox").textContent()).includes("Stunde 1 von 6") && await tp.locator(".unitbox .lp-row.current").count() === 1, "Sitzung zeigt Einheit, Stunde 1 von 6 und den Lernschritt (fett im Leupold-Schema)");
    ok(await tp.locator(".msg.assistant").first().textContent().then((t) => /Wie viele Minuten|90 Minuten/.test(t)), "Chatbot fragt zu Beginn nach Dauer und Wünschen");
    const lesson0 = (await T("GET", "/api/teacher/lessons/" + lessonId)).data.lesson;
    ok(lesson0.title === "Das Bundesverfassungsgericht" && lesson0.topic === "Gewaltenteilung und BVerfG" && lesson0.durationMin === 90 && lesson0.date === today, "Stundenfrage als Titel, Einheit als Thema, Dauer aus dem Stundenplan");

    step("Planung im Chat (gestreamte Antwort, gespeichert)");
    await tp.fill("#chatin", "Bitte plane eine Stunde mit Karikatur und Partnerarbeit.");
    await tp.keyboard.press("Enter");
    await tp.locator(".msg.assistant", { hasText: "Ihre Nachricht war" }).waitFor({ timeout: 20000 });
    ok(true, "Antwort angezeigt");
    const sys = ai.calls[ai.calls.length - 1].messages[0].content;
    ok(sys.startsWith("Du bist ein leistungsfähiger didaktischer Assistent") && sys.includes("Unterrichtsfach: Politik und Wirtschaft") && sys.includes("Klasse/Kurs: Q2 GK") && sys.includes("Das Bundesverfassungsgericht"),
      "System-Prompt: feste Rolle + Fach + Kurs + Sitzung automatisch übermittelt");
    ok(sys.includes("Zentrale Lernaufgabe (Ziel der Einheit): Positionspapier") && sys.includes("Beziehe dich immer auf die in der Unterrichtseinheit festgelegten Aspekte"), "… und die Einheit (Lernaufgabe, Lernschritt; Ablauf nur als Inspiration)");
    await sleep(500);
    r = await T("GET", "/api/teacher/lessons/" + lessonId);
    ok(r.data.messages.filter((m) => m.role === "assistant").length === 2, "Antwort dauerhaft in der Sitzung gespeichert");
    await tp.fill("#chatin", "Bitte die Stundenfrage ändern."); await tp.keyboard.press("Enter");
    await tp.locator(".unit-change").waitFor({ timeout: 20000 });
    await tp.locator(".unit-change").getByRole("button", { name: "In die Einheit übernehmen" }).click();
    await tp.locator(".toast", { hasText: "In die Einheit übernommen" }).waitFor({ timeout: 10000 });
    unit = (await T("GET", "/api/teacher/units/" + unitId)).data.unit;
    ok(unit.rows[0].stundenfrage === "Ist das Bundesverfassungsgericht ein Ersatzgesetzgeber?" && unit.rows[0].ablauf.length === 3, "abgestimmte Abweichung mit einem Klick in der Tabelle der Einheit festgehalten");

    step("Schulportal-Eintrag erstellen, bearbeiten, speichern");
    await tp.getByRole("button", { name: "Schulportal-Eintrag erstellen" }).click();
    await tp.locator("#portal").waitFor({ timeout: 20000 });
    const generated = await tp.inputValue("#portal");
    ok(generated.startsWith("**1) TOP 10**") && generated.includes("- Einstieg: ~~Ist das Bundesverfassungsgericht zu mächtig?~~") && generated.includes("--> Nächste Stunde\n\n**4) Diskussionsrunde**"), "Format wie in der Vorlage (fett, ~~kursiv~~, „--> Nächste Stunde“)");
    ok(await tp.locator(".portal-preview em", { hasText: "Ist das Bundesverfassungsgericht zu mächtig?" }).count() === 1, "Vorschau zeigt ~~…~~ kursiv");
    ok(!(await tp.getByRole("button", { name: "Prompt für die Präsentation kopieren" }).isDisabled()), "Präsentations-Knopf erst mit Eintrag aktiv");
    await tp.locator("#portal").press("End");
    await tp.locator("#portal").evaluate((el) => { el.value += "\n- Manuell ergänzt: Hausaufgabe S. 12"; el.dispatchEvent(new Event("input")); });
    await tp.locator('.save-state[data-state="ok"]', { hasText: /^Gespeichert \d\d:\d\d/ }).waitFor({ timeout: 10000 });
    r = await T("GET", "/api/teacher/lessons/" + lessonId);
    ok(r.data.lesson.portal.endsWith("- Manuell ergänzt: Hausaufgabe S. 12"), "manuelle Änderung dauerhaft gespeichert");
    const stale = await T("PUT", "/api/teacher/lessons/" + lessonId + "/portal", { text: "alt", baseVersion: 1 });
    ok(stale.status === 409, "veraltete Fassung überschreibt nie still (409)");
    await tp.locator("#portal").evaluate((el) => { el.value += "\n- Noch nicht gespeichert"; el.dispatchEvent(new Event("input")); });
    await tp.getByRole("button", { name: "Prompt für die Präsentation kopieren" }).click();
    const presPrompt = await tp.evaluate(() => navigator.clipboard.readText());
    ok(presPrompt.includes("Manuell ergänzt: Hausaufgabe S. 12") && presPrompt.includes("Noch nicht gespeichert"), "Präsentations-Prompt nutzt exakt den aktuellen Textfeld-Inhalt");
    ok(presPrompt.includes("direkt als **PDF-Datei**") && !presPrompt.includes(".pptx") && presPrompt.includes("Politik und Wirtschaft") && presPrompt.includes("90 Minuten"), "Prompt fordert nur die PDF (keine PowerPoint) mit allen Rahmendaten an");
    ok(presPrompt.includes("## Folie 1: gestaltete Titelfolie – ohne Sitzungscode und ohne QR-Code") && presPrompt.includes("zeigt Unterricks vor Folie 1 automatisch seine Codefolie")
      && !presPrompt.includes(lesson0.code.slice(0, 3) + "-" + lesson0.code.slice(3)) && !presPrompt.includes("11111110111000011100001111111"),
      "Folie 1 ist eine Titelfolie: kein Sitzungscode und kein QR-Code im Prompt (die Codefolie zeigt Unterricks selbst)");
    const matPart = presPrompt.slice(presPrompt.indexOf("## Materialfolien"), presPrompt.indexOf("## Rahmendaten"));
    ok(presPrompt.includes("Unterricks-Codefolie: Hier zeigt Unterricks den QR-Code und den Sitzungscode.") && matPart.includes("die Materialfolie ist deshalb eine Unterricks-Codefolie")
      && matPart.includes("die Aufforderung, mit dem Material zu arbeiten") && matPart.includes("den Titel des Materials"),
      "Materialfolien: Unterricks-Codefolie mit Aufforderung und Titel des Materials (feste Zeile im Prompt)");
    ok(presPrompt.includes("## Zeitlos gestalten") && presPrompt.includes("„bis zur nächsten Unterrichtssitzung“") && !/^- Datum:/m.test(presPrompt), "zeitlos: keine Daten der Lerngruppe, Hausaufgabe bis zur nächsten Unterrichtssitzung");
    await tp.locator('.save-state[data-state="ok"]', { hasText: /^Gespeichert \d\d:\d\d/ }).waitFor({ timeout: 10000 });
    ok((await T("GET", "/api/teacher/lessons/" + lessonId)).data.lesson.portal.includes("Noch nicht gespeichert"), "… und speichert diesen Stand sofort");

    step("Hauptweg „Stunde mit Claude planen“: Prompt, Claude speichert über den Connector, Seite übernimmt es beim Zurückkehren");
    ok(await tp.locator(".claudeplan").evaluate((el) => el.compareDocumentPosition(document.querySelector("#backupchat")) & Node.DOCUMENT_POSITION_FOLLOWING) > 0
      && (await tp.locator("#backupchat h2").textContent()).startsWith("Backup"), "Claude-Karte steht vor dem Chat der Plattform (Backup)");
    await tp.locator("#backupchat .hint", { hasText: "Reihenfolge der kostenlosen KI: Anderer OpenAI-kompatibler Dienst → Cloudflare Workers AI" }).waitFor({ timeout: 10000 });
    ok(true, "Backup nennt die Reihenfolge der kostenlosen KI aus den Einstellungen");
    await tp.evaluate(() => window.scrollTo(0, 0)); await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-sitzung-oben.png") });
    {
      const mp = await tctx.newPage(); await mp.setViewportSize({ width: 390, height: 844 });
      await mp.goto(BASE + "/#/lk/s/" + lessonId); await mp.locator(".claudeplan").waitFor(); await mp.waitForTimeout(800);
      await mp.screenshot({ ...SHOT, path: join(OUT, "mobil-lehrkraft-sitzung.png") }); await mp.close();
      const mctx = await browser.newContext({ ...devices["iPhone 13"] }); const mq = await mctx.newPage();
      await mq.goto(BASE + "/"); await mq.locator("#spw").waitFor(); await mq.screenshot({ ...SHOT, path: join(OUT, "mobil-start.png") }); await mctx.close();
    }
    await tp.getByRole("button", { name: "Für den Beamer zeigen" }).click();
    await tp.locator(".codeshow").waitFor();
    await tp.waitForFunction(() => { const i = document.querySelector(".codeshow img.qr"); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => {});
    ok(await tp.locator(".codeshow img.qr").evaluate((i) => i.complete && i.naturalWidth > 0 && i.getAttribute("alt") === "QR-Code zu https://unterricks.janrickmer.de") && (await tp.locator(".codeshow figcaption").textContent()) === "unterricks.janrickmer.de",
      "Beamer-Folie mit QR-Code zu https://unterricks.janrickmer.de");
    await tp.waitForTimeout(300); await tp.screenshot({ ...SHOT, path: join(OUT, "beamer-code.png") });
    await tp.locator(".codeshow").getByRole("button", { name: "Schließen" }).click();
    await tp.getByRole("button", { name: "Stunde mit Claude planen" }).click();
    const lm = tp.locator(".modal", { hasText: "Welches Sprachmodell?" });
    await lm.waitFor();
    ok((await lm.textContent()).includes("Beim ersten Mal fragt claude.ai, ob der Connector verbunden werden"), "Hinweis: beim ersten Mal Connector verbinden und Zugriff erlauben");
    const chatName = "Q2 GK - PoWi - Sitzung 1 - " + lesson0.title;
    ok((await lm.locator(".notice", { hasText: "Name des Chats:" }).textContent()).includes(chatName), "Dialog nennt den Chat-Namen (" + chatName + ")");
    await lm.getByRole("button", { name: "Chat-Namen kopieren" }).click();
    ok(await tp.evaluate(() => navigator.clipboard.readText()) === chatName, "Chat-Name lässt sich einzeln kopieren");
    await lm.getByRole("button", { name: "Prompt kopieren" }).click();
    const lessonPrompt = await tp.evaluate(() => navigator.clipboard.readText());
    ok(lessonPrompt.startsWith("Chat-Name: " + chatName + "\n") && lessonPrompt.includes("Beginne deine erste Antwort mit der Zeile „Chat-Name: " + chatName + "“"), "Prompt beginnt mit dem Chat-Namen, Claude nennt ihn zuerst");
    ok(lessonPrompt.split("\n")[2].startsWith("Du bist ein leistungsfähiger didaktischer Assistent") && ["Q2 GK", "Politik und Wirtschaft", "Gewaltenteilung und BVerfG", "laut Plattform 90 Minuten", "Karikatur und Partnerarbeit", "Ihre Nachricht war",
      "`get_lesson` mit der Sitzungs-ID " + lessonId, "`get_unit` mit der ID " + unitId, "Zentrale Lernaufgabe (Ziel der Einheit): Positionspapier", "`save_schulportal_entry`", "`update_lesson` mit `hausaufgabe`", "`update_unit_row`", "Speichere nur, was ich freigebe"].every((s) => lessonPrompt.includes(s)),
      "Prompt: feste Rolle, Fach, Kurs, Thema, Dauer, Wünsche, bisheriger Stand, Einheit, Werkzeuge des Connectors");
    await lm.getByRole("button", { name: "Schließen", exact: true }).getByText("Schließen").click();
    r = await tool("update_lesson", { lesson_id: lessonId, hausaufgabe: "Lies M3 und notiere zwei Argumente (von Claude)." });
    ok(!r.isError, "Claude trägt die Hausaufgabe ein (update_lesson)");
    r = await tool("save_planning_result", { lesson_id: lessonId, text: "## Stundenentwurf von Claude\n- Einstieg mit Karikatur (10 min)" });
    ok(!r.isError, "Claude speichert den ausgearbeiteten Entwurf (save_planning_result)");
    await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await tp.waitForFunction(() => document.querySelector("#hw").value.includes("(von Claude)"), null, { timeout: 10000 }).then(() => ok(true, "beim Zurückkehren: Hausaufgabe übernommen"), () => ok(false, "beim Zurückkehren: Hausaufgabe übernommen"));
    await tp.locator(".msg.assistant", { hasText: "Stundenentwurf von Claude" }).waitFor({ timeout: 10000 });
    ok(true, "… und Claudes Entwurf erscheint im Planungsverlauf");

    step("Material hochladen (zwei getrennte Bereiche) und aus dem Chat übernehmen");
    await tp.locator(".zones input[type=file]").nth(0).setInputFiles({ name: "Arbeitsblatt BVerfG.pdf", mimeType: "application/pdf", buffer: await pdf(1, "Arbeitsblatt") });
    await tp.locator(".zones input[type=file]").nth(1).setInputFiles({ name: "Erwartungshorizont GEHEIM.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK geheim") });
    await tp.locator(".item", { hasText: "Arbeitsblatt BVerfG.pdf" }).waitFor(); await tp.locator(".item", { hasText: "Erwartungshorizont GEHEIM.docx" }).waitFor();
    ok(true, "PDF (Schüler:innen) und Word (nur Lehrkraft) hochgeladen");
    await tp.locator(".msg.assistant", { hasText: "Ihre Nachricht war" }).getByRole("button", { name: "Als Material übernehmen" }).click();
    await tp.locator(".modal input").first().fill("Ablauf aus dem Chat");
    await tp.locator(".modal").getByRole("button", { name: "Speichern" }).click();
    await tp.locator(".item", { hasText: "Ablauf aus dem Chat" }).waitFor();
    ok(true, "KI-Material mit einem Klick als Material (Schülerbereich) übernommen");
    await tp.locator(".zones > .stack").nth(0).getByRole("button", { name: "Link hinzufügen" }).click();
    await tp.locator(".modal #lk-t").fill("Erklärvideo der bpb"); await tp.locator(".modal #lk-u").fill("www.bpb.de/mediathek/video/bverfg");
    await tp.locator(".modal").getByRole("button", { name: "Hinzufügen" }).click();
    await tp.locator(".item", { hasText: "Erklärvideo der bpb" }).waitFor();
    await tp.locator(".zones > .stack").nth(1).getByRole("button", { name: "Link hinzufügen" }).click();
    await tp.locator(".modal #lk-t").fill("Interne Linkliste GEHEIM"); await tp.locator(".modal #lk-u").fill("javascript:alert(1)");
    await tp.locator(".modal").getByRole("button", { name: "Hinzufügen" }).click();
    ok(await tp.locator(".modal .err", { hasText: "gültige Internetadresse" }).count() === 1, "Link: unsichere Adresse (javascript:) wird abgelehnt");
    await tp.locator(".modal #lk-u").fill("https://example.org/linkliste");
    await tp.locator(".modal").getByRole("button", { name: "Hinzufügen" }).click();
    await tp.locator(".item", { hasText: "Interne Linkliste GEHEIM" }).waitFor();
    ok(await tp.locator(".item", { hasText: "Erklärvideo der bpb" }).getByRole("link", { name: /Öffnen/ }).getAttribute("href") === "https://www.bpb.de/mediathek/video/bverfg", "Links mit Titel in beiden Bereichen (ohne „https://“ eingegeben → ergänzt)");

    step("Von der Lehrkraft auszudrucken: nur PDF, A4, Name mit Anzahl/Druckart, einzeln und als ZIP");
    {
      const pc = tp.locator("#printcard");
      const letter = await (async () => { const d = await PDFDocument.create(); d.addPage([612, 792]).drawText("US Letter", { x: 50, y: 700, size: 20 }); return Buffer.from(await d.save()); })();
      const a4doc = await (async () => { const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); d.addPage([595.28, 841.89]); return Buffer.from(await d.save()); })();
      await pc.locator("input[type=file]").setInputFiles([{ name: "Kein PDF.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: Buffer.from("PK nicht pdf") }]);
      await tp.locator(".toast", { hasText: "ist keine PDF-Datei" }).waitFor({ timeout: 10000 });
      ok(true, "Druckliste: Word-Datei abgelehnt (nur PDF)");
      await pc.locator("input[type=file]").setInputFiles([{ name: "Arbeitsblatt Letter.pdf", mimeType: "application/pdf", buffer: letter }]);
      await tp.locator(".toast", { hasText: "nicht im Format A4 und wurde auf A4 umgerechnet" }).waitFor({ timeout: 20000 });
      await pc.locator(".printrow", { hasText: "1x - beidseitig - sw - Arbeitsblatt Letter.pdf" }).waitFor({ timeout: 10000 });
      ok(true, "US-Letter-PDF auf A4 umgerechnet (mit Hinweis), Name „1x - beidseitig - sw - …“ (Vorgabe: beidseitig, schwarz-weiß)");
      const row = pc.locator(".printrow", { hasText: "Arbeitsblatt Letter" });
      await row.locator("input.pcopies").fill("28"); await row.locator("input.pcopies").press("Tab");
      await pc.locator(".printrow .name", { hasText: "28x - beidseitig - sw - Arbeitsblatt Letter.pdf" }).waitFor({ timeout: 10000 });
      await row.locator('select[aria-label^="Beidseitig oder einseitig"]').selectOption("0");
      await row.locator('select[aria-label^="Schwarz-weiß oder Farbe"]').selectOption("1");
      await pc.locator(".printrow .name", { hasText: "28x - einseitig - Farbe - Arbeitsblatt Letter.pdf" }).waitFor({ timeout: 10000 });
      ok(true, "Anzahl, einseitig und Farbe ändern den Dateinamen („28x - einseitig - Farbe - …“)");
      await pc.locator("input[type=file]").setInputFiles([{ name: "Tafelbild.pdf", mimeType: "application/pdf", buffer: a4doc }]);
      await pc.locator(".printrow .name", { hasText: "28x - beidseitig - sw - Tafelbild.pdf" }).waitFor({ timeout: 10000 });
      ok(true, "neue Druckvorlage übernimmt die zuletzt verwendete Anzahl der Klasse (28)");
      const pfs = (await T("GET", "/api/teacher/lessons/" + lessonId)).data.files.filter((f) => f.area === "print");
      const lt = pfs.find((f) => f.name === "Arbeitsblatt Letter.pdf"), lres = await fetch(BASE + (await T("POST", "/api/teacher/files/" + lt.id + "/link", {})).data.url);
      const ldoc = await PDFDocument.load(new Uint8Array(await lres.arrayBuffer()));
      ok(ldoc.getPages().every((pg) => Math.round(pg.getWidth()) === 595 && Math.round(pg.getHeight()) === 842) && /28x%20-%20einseitig%20-%20Farbe%20-%20Arbeitsblatt%20Letter\.pdf|28x - einseitig - Farbe - Arbeitsblatt Letter\.pdf/.test(lres.headers.get("content-disposition") || ""),
        "gespeicherte Datei ist A4; Download heißt „28x - einseitig - Farbe - Arbeitsblatt Letter.pdf“");
      const fake = await fetch(BASE + "/api/teacher/lessons/" + lessonId + "/print?name=" + encodeURIComponent("Tarnung.pdf"), { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/pdf" }, body: Buffer.from("kein pdf, nur Text") });
      ok(fake.status === 400, "Server prüft den Inhalt: eine als PDF getarnte Datei wird abgelehnt");
      const [zdl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), pc.getByRole("button", { name: "Alle herunterladen (ZIP)" }).click()]);
      const zipEntries = await readZip(new Uint8Array(readFileSync(await zdl.path())));
      ok(/^Von der Lehrkraft auszudrucken - PoWi - Q2 GK - \d{4}-\d{2}-\d{2}\.zip$/.test(zdl.suggestedFilename()) && zipEntries.map((e) => e.name).sort().join(" | ") === "28x - beidseitig - sw - Tafelbild.pdf | 28x - einseitig - Farbe - Arbeitsblatt Letter.pdf"
        && zipEntries.every((e) => new TextDecoder().decode(e.data.subarray(0, 5)) === "%PDF-"), "„Alle herunterladen“: eine ZIP-Datei mit allen PDFs unter ihren Druck-Namen");
      await pc.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-druckliste.png") });
    }

    step("Präsentation (PDF) hochladen → Folienbilder");
    // Folie 3 ist eine Unterricks-Codefolie (Materialfolie); dazu der stille Rückfall für ältere Präsentationen: Sitzungscode ABC-234 einer
    // früheren Sitzung auf Folie 1 und 2 – Unterricks setzt den Code dieser Sitzung ein
    await tp.locator("section.card", { hasText: "Präsentation für den Unterricht" }).locator("input[type=file]").first().setInputFiles({ name: "BVerfG.pdf", mimeType: "application/pdf", buffer: await pdf(3, "BVerfG", "ABC-234", 3) });
    await tp.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).waitFor({ timeout: 40000 });
    ok(await tp.locator(".item", { hasText: "3 Folien" }).count() === 1, "3 Folien erzeugt, Start-Knopf unter der Präsentation");
    const swapToast = tp.locator(".toast", { hasText: "Den Sitzungscode ABC-234 einer früheren Sitzung hat Unterricks auf 2 Folien durch den Code dieser Sitzung " + lesson0.code.slice(0, 3) + "-" + lesson0.code.slice(3) + " ersetzt." });
    ok(await swapToast.waitFor({ timeout: 10000 }).then(() => true, () => false), "Präsentation aus einer früheren Sitzung: alter Sitzungscode auf Folie 1 und 2 durch den Code dieser Sitzung ersetzt");
    ok(await tp.locator(".toast", { hasText: "Präsentation bereit (3 Folien). Auf Folie 3 zeigt Unterricks live den Sitzungscode dieser Sitzung (Platzhalterfolie)." }).count() === 1
      && await tp.locator(".toast", { hasText: "keinen Sitzungscode als Text gefunden" }).count() === 0, "Meldung nennt die Unterricks-Codefolie (Folie 3)");
    {
      const pf = (await T("GET", "/api/teacher/lessons/" + lessonId)).data.files.find((f) => f.area === "presentation");
      const want = JSON.stringify([{ n: 3, lines: ["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", "Feibeitsblatt: Die wehrhafte Demokratie"] }]);
      const sl = await T("GET", "/api/teacher/files/" + pf.id + "/slides");
      if (JSON.stringify(pf.codeSlides) !== want) console.log("    codeSlides:", JSON.stringify(pf.codeSlides));
      ok(JSON.stringify(pf.codeSlides) === want && JSON.stringify(sl.data.codeSlides) === want, "Codefolie gespeichert: Folie 3 mit Aufforderung und Materialtitel als Überschrift (ohne Fußzeile und feste Zeile)");
      ok(await tp.locator(".thumbs .thumb").nth(2).locator(".badge", { hasText: "Code" }).count() === 1, "Vorschaubild der Codefolie ist gekennzeichnet");
      const bad = await T("POST", "/api/teacher/files/" + pf.id + "/ready", { pages: 3, codeSlides: [{ n: 9, lines: ["x"] }, { n: 2, lines: ["<b>ok</b>", "\u0000"] }] });
      const pf2 = (await T("GET", "/api/teacher/lessons/" + lessonId)).data.files.find((f) => f.area === "presentation");
      ok(bad.status === 200 && JSON.stringify(pf2.codeSlides) === JSON.stringify([{ n: 2, lines: ["<b>ok</b>"] }]), "Server prüft die Codefolien (nur Seiten der PDF, Zeilen nur als Text)");
      await T("POST", "/api/teacher/files/" + pf.id + "/ready", { pages: 3, codeSlides: JSON.parse(want) });
    }
    { // Folienbilder 1 und 2 zum Ansehen ablegen (die Textebene der hochgeladenen PDF bleibt unverändert)
      const presFile = (await T("GET", "/api/teacher/lessons/" + lessonId)).data.files.find((f) => f.area === "presentation");
      const sl = await T("GET", "/api/teacher/files/" + presFile.id + "/slides");
      for (const k of [0, 1]) { const u = sl.data.urls[k]; const r = await fetch(/^https?:/.test(u) ? u : BASE + u); writeFileSync(join(OUT, "folie-code-" + (k + 1) + ".jpg"), Buffer.from(await r.arrayBuffer())); }
    }
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-sitzung.png"), fullPage: true });

    /* ---------- Schüler:in am iPad ---------- */
    step("Schüler:in: Passwort, Klasse/Fach, Sitzungscode");
    const sctx = await browser.newContext({ ...devices["iPad (gen 7)"] });
    await sctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    const sp = await sctx.newPage(); watch(sp, "Schüler");
    await sp.goto(BASE + "/");
    await sp.fill("#spw", "falsch"); await sp.getByRole("button", { name: "Weiter" }).click();
    ok(await sp.locator(".err", { hasText: "falsch" }).waitFor({ timeout: 10000 }).then(() => true, () => false), "falsches Passwort wird abgelehnt");
    await sp.fill("#spw", "Feindt"); await sp.getByRole("button", { name: "Weiter" }).click();
    await sp.waitForURL(/#\/schueler$/);
    await sp.locator(".tiles .tile").first().waitFor();
    await sp.screenshot({ ...SHOT, path: join(OUT, "schueler-fachwahl.png") });
    ok(await sp.getByRole("button", { name: "Politik und Wirtschaft" }).isVisible() && await sp.getByRole("button", { name: "Evangelische Religion" }).isVisible() && await sp.getByRole("button", { name: "Ethik" }).isVisible() && (await sp.locator(".tiles .tile").count()) === 3, "genau drei Fächer zur Auswahl");
    await sp.getByRole("button", { name: "Politik und Wirtschaft" }).click();
    await sp.waitForFunction(() => document.querySelectorAll(".class-btn").length > 0 && ![...document.querySelectorAll(".class-btn")].some((b) => b.textContent === "7A"), null, { timeout: 10000 }).then(() => ok(true, "PoWi: Jahrgang 7 nicht wählbar"), () => ok(false, "PoWi: Jahrgang 7 nicht wählbar"));
    ok(await sp.getByRole("button", { name: "8H", exact: true }).count() === 1 && await sp.getByRole("button", { name: "EH", exact: true }).count() === 1 && await sp.getByRole("button", { name: "8I", exact: true }).count() === 0, "acht Klassen je Jahrgang (a–h), auch in der E-Phase");
    await sp.getByRole("button", { name: "Ethik" }).click();
    ok(await sp.getByRole("button", { name: "7A", exact: true }).count() === 1, "Ethik: Jahrgang 7 wählbar");
    await sp.getByRole("button", { name: "Q2 GK", exact: true }).click();
    await sp.getByRole("button", { name: "Speichern und weiter" }).click();
    await sp.fill("#code", lesson0.code.toLowerCase()); await sp.getByRole("button", { name: "Sitzung öffnen" }).click();
    ok(await sp.locator(".err", { hasText: "anderen Klasse oder einem anderen Fach" }).waitFor({ timeout: 10000 }).then(() => true, () => false), "Code einer anderen Klasse/eines anderen Fachs öffnet nichts");
    await sp.getByRole("button", { name: "Klasse/Fach ändern" }).click();
    await sp.getByRole("button", { name: "Politik und Wirtschaft" }).click(); await sp.getByRole("button", { name: "Q2 GK", exact: true }).click();
    await sp.getByRole("button", { name: "Speichern und weiter" }).click();
    await sp.locator("#code").waitFor(); await sp.screenshot({ ...SHOT, path: join(OUT, "schueler-start.png") });
    await sp.fill("#code", lesson0.code.slice(0, 3) + "-" + lesson0.code.slice(3)); await sp.getByRole("button", { name: "Sitzung öffnen" }).click();
    await sp.waitForURL(/#\/schueler\/s\//);
    ok(true, "Sitzungscode eingelöst");
    await sp.locator(".item", { hasText: "Arbeitsblatt BVerfG.pdf" }).waitFor({ timeout: 10000 }).catch(() => {});
    const sbody = await sp.locator("main").textContent();
    ok(sbody.includes("Arbeitsblatt BVerfG.pdf") && sbody.includes("Ablauf aus dem Chat"), "freigegebenes Material sichtbar");
    ok(!sbody.includes("Erwartungshorizont GEHEIM"), "Material „nur für Lehrkräfte“ ist nicht sichtbar");
    const slk = sp.locator(".item", { hasText: "Erklärvideo der bpb" }).getByRole("link", { name: /Öffnen/ });
    ok(await slk.getAttribute("href") === "https://www.bpb.de/mediathek/video/bverfg" && await slk.getAttribute("target") === "_blank" && /noopener/.test(await slk.getAttribute("rel") || "") && !sbody.includes("Interne Linkliste GEHEIM"),
      "Schüler:innen öffnen den Link in neuem Tab; der Link „nur für Lehrkräfte“ ist unsichtbar");
    const stoken = await sp.evaluate(() => localStorage.getItem("u.stoken"));
    const SA = (method, path, body) => fetch(BASE + path, { method, headers: { Authorization: "Bearer " + stoken, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (x) => ({ status: x.status, data: await x.json().catch(() => null) }));
    const tfiles = (await T("GET", "/api/teacher/lessons/" + lessonId)).data.files;
    const secret = tfiles.find((f) => f.name.includes("GEHEIM")), pub = tfiles.find((f) => f.name.includes("Arbeitsblatt"));
    ok((await SA("POST", "/api/student/files/" + secret.id + "/link")).status === 404, "Lehrkraft-Datei auch per direkter Anfrage unzugänglich");
    const link = await SA("POST", "/api/student/files/" + pub.id + "/link");
    const dl = await fetch(BASE + link.data.url);
    ok(dl.status === 200 && /attachment/.test(dl.headers.get("content-disposition")) && (await dl.arrayBuffer()).byteLength > 500, "Schüler-Material herunterladbar (Datei für GoodNotes)");
    ok((await SA("GET", "/api/teacher/lessons/" + lessonId)).status === 401, "Schüler-Zugang öffnet keine Lehrkraft-Schnittstelle");
    await sp.goto(BASE + "/");
    await sp.waitForURL(/#\/schueler$/);
    ok(await sp.locator(".item", { hasText: "Das Bundesverfassungsgericht" }).isVisible(), "beim nächsten Besuch: Sitzung ohne erneuten Code in der Liste");
    await sp.locator(".item", { hasText: "Das Bundesverfassungsgericht" }).click();
    await sp.locator(".live .placeholder").waitFor();
    ok(await sp.locator(".live .placeholder").isVisible(), "Live-Fenster ganz oben (wartet auf die Lehrkraft)");
    ok(await sp.locator("text=Die Präsentation kannst du nach dem Unterricht selbst öffnen.").count() === 1, "ohne Beginn der Sitzung: Präsentation nicht selbst zu öffnen (erst nach dem Unterricht)");
    ok((await SA("POST", "/api/student/lessons/" + lessonId + "/presentation-link", {})).status === 403, "… auch serverseitig gesperrt");

    step("Live-Präsentation: Lehrkraft startet, Schüler:in folgt");
    const codeF = lesson0.code.slice(0, 3) + "-" + lesson0.code.slice(3);
    await tp.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
    await tp.locator(".presenter").waitFor();
    await tp.locator(".presenter .stage .codeslide .c", { hasText: codeF }).waitFor({ timeout: 10000 });
    const markB = tp.locator(".presenter").getByRole("button", { name: /als letzte im Unterricht gezeigte Folie markieren/ });
    ok((await tp.locator(".presenter .counter").textContent()) === "Sitzungscode" && await markB.isDisabled() && await tp.locator(".presenter .stage > img").count() === 0,
      "Start: zuerst die Codefolie (vor Folie 1) – „Bis hier gezeigt“ gilt dort nicht");
    // Vorschau der nächsten Folie (nur im Präsentationsfenster): groß die aktuelle, kleiner daneben die nächste
    const npHead = () => tp.locator(".presenter .nextpane .np-head").textContent();
    const prevB = tp.locator(".presenter").getByRole("button", { name: "Vorschau der nächsten Folie" });
    await tp.waitForFunction(() => /\/1\?/.test((document.querySelector(".presenter .nextpane .np-frame > img") || {}).src || ""), null, { timeout: 10000 });
    const geo = await tp.evaluate(() => { const r = (q) => document.querySelector(q).getBoundingClientRect(); const a = r(".presenter .stage"), b = r(".presenter .nextpane .np-frame"); return { a: a.width, b: b.width, side: b.left >= a.right, h: b.height }; });
    ok(await npHead() === "Als Nächstes Folie 1 / 3" && (await prevB.getAttribute("aria-pressed")) === "true" && geo.side && geo.b < geo.a && geo.b > geo.a * 0.4 && geo.h > 200,
      "Vorschau: neben der Codefolie (groß) kleiner, aber lesbar die nächste Folie 1 (" + Math.round(geo.a) + " / " + Math.round(geo.b) + " px breit)");
    await sp.locator(".live .codeslide .c", { hasText: codeF }).waitFor({ timeout: 15000 });
    await sp.locator(".live .badge", { hasText: "Sitzungscode" }).waitFor({ timeout: 10000 });
    await sp.waitForFunction(() => { const i = document.querySelector(".live .codeslide img.qr"); return !!i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => {});
    ok((await sp.locator(".live .codeslide .cs-line").textContent()) === lesson0.title && await sp.locator(".live .codeslide img.qr").evaluate((i) => i.complete && i.naturalWidth > 0)
      && (await sp.locator(".live .codeslide figcaption").textContent()) === "unterricks.janrickmer.de", "… live auch auf dem iPad: Titel, Sitzungscode dieser Sitzung und QR-Code zu Unterricks");
    await sp.screenshot({ ...SHOT, path: join(OUT, "schueler-codefolie.png") });
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-codefolie.png") });
    await tp.keyboard.press("ArrowRight");
    await sp.locator(".live > img").waitFor({ timeout: 15000 });
    await sp.locator(".live .badge", { hasText: "Folie 1 / 3" }).waitFor({ timeout: 10000 });
    await sp.waitForFunction(() => !document.querySelector(".live .codeslide"), null, { timeout: 10000 });
    ok((await tp.locator(".presenter .counter").textContent()) === "1 / 3", "Folie 1 erscheint bei der Schülerin");
    const t0 = Date.now();
    await tp.keyboard.press("ArrowRight");
    await sp.locator(".live .badge", { hasText: "Folie 2 / 3" }).waitFor({ timeout: 10000 });
    ok(true, "Folienwechsel kommt an (" + (Date.now() - t0) + " ms)");
    await tp.locator(".presenter .nextpane .codeslide.cs-task").waitFor({ timeout: 10000 });
    ok(await npHead() === "Als Nächstes Folie 3 / 3 · Codefolie" && await tp.locator(".presenter .nextpane .codeslide .c", { hasText: codeF }).count() === 1,
      "… auf Folie 2 zeigt die Vorschau die Platzhalterfolie 3 als Codefolie");
    await markB.click();
    await tp.locator(".presenter .markstate", { hasText: "Bis Folie 2 markiert" }).waitFor({ timeout: 20000 });
    const presF = (await T("GET", "/api/teacher/lessons/" + lessonId)).data.files.find((f) => f.area === "presentation");
    ok(presF.shownUntil === 2 && presF.cut === true, "Vollbild „Bis hier gezeigt“: Folie 2 als letzte gezeigte Folie markiert, gekürzte PDF gespeichert");
    await tp.locator(".presenter .small", { hasText: "1 Schüler:in verbunden" }).waitFor({ timeout: 10000 });
    ok(true, "Lehrkraft sieht die Zahl der verbundenen Schüler:innen");
    await sp.waitForFunction(() => /\/2\?/.test((document.querySelector(".live > img") || {}).src || ""), null, { timeout: 10000 });
    const src = await sp.locator(".live > img").getAttribute("src");
    ok((await fetch(new URL(src, BASE).href)).status === 200 && (await fetch(new URL(src, BASE).href.replace(/\/(\d+)\?/, "/3?"))).status === 403, "Schüler:innen können nicht vorblättern (Folie 3 gesperrt)");
    await sp.screenshot({ ...SHOT, path: join(OUT, "schueler-live.png") });
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-praesentation.png") });
    // „Sitzungscode zeigen“: Codefolie über Folie 2 – bei allen; die nächste Taste kehrt zurück (nicht weiter)
    await tp.locator(".presenter").getByRole("button", { name: "Sitzungscode zeigen" }).click();
    await sp.locator(".live .badge", { hasText: "Sitzungscode" }).waitFor({ timeout: 10000 });
    ok(await sp.locator(".live .codeslide .c", { hasText: codeF }).count() === 1 && await tp.locator(".presenter").getByRole("button", { name: "Zurück zu Folie 2" }).count() === 1
      && (await tp.locator(".presenter .counter").textContent()) === "Sitzungscode" && await markB.isDisabled(), "„Sitzungscode zeigen“ blendet die Codefolie live bei allen ein");
    ok(await npHead() === "Als Nächstes Zurück zu Folie 2 / 3" && /\/2\?/.test(await tp.locator(".presenter .nextpane .np-frame > img").getAttribute("src")), "… die Vorschau zeigt die Folie darunter (Rückkehr)");
    ok(await tp.evaluate(() => !(document.activeElement && document.activeElement.closest(".presenter .bar"))), "nach dem Mausklick behält der Knopf den Fokus nicht (Leertaste und Presenter blättern weiter)");
    await tp.keyboard.press("Space");   // nach dem Mausklick auf den Knopf blättert die Leertaste (z. B. eines Presenters) weiter
    await sp.locator(".live .badge", { hasText: "Folie 2 / 3" }).waitFor({ timeout: 10000 });
    await sp.waitForFunction(() => !document.querySelector(".live .codeslide") && /\/2\?/.test((document.querySelector(".live > img") || {}).src || ""), null, { timeout: 10000 });
    ok((await tp.locator(".presenter .counter").textContent()) === "2 / 3", "… die nächste Taste (Leertaste nach dem Mausklick auf den Knopf) kehrt zu Folie 2 zurück");
    // Folie 3 ist eine Unterricks-Codefolie: bei allen die Codefolie mit Aufforderung und Materialtitel als Überschrift
    await tp.keyboard.press("ArrowRight");
    await sp.locator(".live .codeslide.cs-task").waitFor({ timeout: 10000 });
    const lines = async (pg, sel) => (await pg.locator(sel + " .codeslide .cs-line").allTextContents()).join(" | ");
    const head = "Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3. | Feibeitsblatt: Die wehrhafte Demokratie";
    ok(await lines(sp, ".live") === head && await lines(tp, ".presenter .stage") === head && await sp.locator(".live .badge", { hasText: "Folie 3 / 3" }).count() === 1
      && await sp.locator(".live .codeslide .c", { hasText: codeF }).count() === 1 && (await tp.locator(".presenter .counter").textContent()) === "3 / 3",
      "Unterricks-Codefolie (Folie 3): live die Codefolie mit Aufforderung und Materialtitel – beim Beamer und auf dem iPad");
    await sp.screenshot({ ...SHOT, path: join(OUT, "schueler-codefolie-material.png") });
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-codefolie-material.png") });
    ok(await npHead() === "Als Nächstes Ende der Präsentation" && (await tp.locator(".presenter .nextpane .np-end").textContent()) === "Keine weitere Folie", "letzte Folie: die Vorschau sagt, dass keine Folie mehr kommt");
    // Vorschau ausblenden (Knopf bzw. Taste V) – gemerkt; bei gespiegeltem Bildschirm sähe die Klasse sie sonst mit
    await prevB.click();
    ok((await prevB.getAttribute("aria-pressed")) === "false" && !(await tp.locator(".presenter .nextpane").isVisible()) && await tp.locator(".presenter.with-next").count() === 0, "„Vorschau“ blendet die nächste Folie aus");
    await tp.keyboard.press("v");
    await tp.locator(".presenter .nextpane").waitFor();
    ok((await prevB.getAttribute("aria-pressed")) === "true", "… Taste V blendet sie wieder ein");
    await prevB.focus(); await tp.keyboard.press("Enter");
    const viaEnter = await prevB.getAttribute("aria-pressed");
    await tp.keyboard.press("Enter");
    await tp.waitForTimeout(3000);   // länger als die Ruhezeit der Leiste
    const barShown = await tp.waitForFunction(() => getComputedStyle(document.querySelector(".presenter .bar")).opacity === "1", null, { timeout: 3000 }).then(() => true, () => false);
    ok(viaEnter === "false" && (await prevB.getAttribute("aria-pressed")) === "true" && barShown,
      "Tastatur: Enter auf dem fokussierten Knopf löst ihn aus (statt weiterzublättern), die Leiste bleibt dabei sichtbar");
    // Pop-up blockiert: die Meldung steht in der Leiste (Toasts sind im Vollbild nicht zu sehen)
    await tp.evaluate(() => { window.__open = window.open; window.open = () => null; });
    await tp.locator(".presenter").getByRole("button", { name: "Beamerfenster öffnen" }).click();
    ok(/Beamerfenster blockiert/.test(await tp.locator(".presenter .beamstate").textContent()), "Beamerfenster blockiert: Hinweis direkt in der Leiste");
    await tp.evaluate(() => { window.open = window.__open; });
    // Beamerfenster: zweites Fenster nur mit der aktuellen Folie (Beamer als erweiterter Bildschirm), Tasten dort steuern die Präsentation
    const [bw] = await Promise.all([tctx.waitForEvent("page"), tp.locator(".presenter").getByRole("button", { name: "Beamerfenster öffnen" }).click()]);
    watch(bw, "Beamerfenster");
    await bw.locator(".beamer .bm-stage .codeslide.cs-task").waitFor({ timeout: 10000 });
    await tp.locator(".presenter .beamstate", { hasText: "Beamerfenster verbunden" }).waitFor({ timeout: 10000 });
    ok(await lines(bw, ".beamer .bm-stage") === head && await bw.locator(".nextpane, .np-frame, .presenter").count() === 0 && new URL(bw.url()).hash === "#/beamer" && (await bw.title()) === "Unterricks – Beamerfenster",
      "Beamerfenster: dieselbe Codefolie wie im Präsentationsfenster, ohne Vorschau und ohne Steuerung");
    await bw.keyboard.press("ArrowLeft");
    await sp.locator(".live .badge", { hasText: "Folie 2 / 3" }).waitFor({ timeout: 10000 });
    await bw.waitForFunction(() => /\/2\?/.test((document.querySelector(".beamer .bm-stage > img") || {}).src || ""), null, { timeout: 10000 });
    ok((await tp.locator(".presenter .counter").textContent()) === "2 / 3" && await bw.locator(".beamer .codeslide").count() === 0, "Taste im Beamerfenster (z. B. Presenter) blättert die Präsentation – bei allen");
    const bwFs = bw.locator(".beamer .bm-bar button").first();
    await bwFs.focus(); await bw.keyboard.press("Enter"); await tp.waitForTimeout(500);
    ok((await tp.locator(".presenter .counter").textContent()) === "2 / 3" && /Vollbild/.test(await bwFs.textContent()) && await bw.evaluate(() => !(document.activeElement && document.activeElement.closest(".bm-bar"))),
      "Enter auf „Vollbild“ im Beamerfenster blättert nicht weiter; danach hat die Leiste keinen Fokus mehr (blendet sich über der Folie aus)");
    if (await bw.evaluate(() => !!document.fullscreenElement)) await bw.evaluate(() => document.exitFullscreen().catch(() => {}));
    await bw.mouse.move(300, 300);
    await bw.screenshot({ ...SHOT, path: join(OUT, "beamerfenster.png") });
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-praesentation-vorschau.png") });
    await tp.keyboard.press("ArrowRight");
    await bw.locator(".beamer .bm-stage .codeslide.cs-task").waitFor({ timeout: 10000 });
    ok((await tp.locator(".presenter .counter").textContent()) === "3 / 3", "… und folgt dem Präsentationsfenster");
    // Fenster schließen, Live-Anzeige läuft weiter; erneut öffnen → weiter an der laufenden Stelle (nicht wieder die Codefolie davor)
    await tp.locator(".presenter").getByRole("button", { name: "Schließen", exact: true }).click();
    await bw.locator(".beamer .bm-wait", { hasText: "Die Präsentation ist gerade nicht geöffnet." }).waitFor({ timeout: 10000 });
    ok(await tp.evaluate(() => (document.activeElement || {}).textContent) === "Ich bin im Unterricht und starte die Präsentation für alle.", "nach dem Schließen steht der Fokus wieder auf dem Start-Knopf");
    ok(await bw.locator(".beamer .codeslide, .beamer .bm-stage > img").count() === 0, "Präsentationsfenster geschlossen: das Beamerfenster zeigt keine Folie mehr");
    await tp.locator("section.card", { hasText: "Präsentation für den Unterricht" }).locator(".small", { hasText: "Folie 3 / 3" }).waitFor({ timeout: 10000 });
    await tp.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
    await tp.locator(".presenter .stage .codeslide.cs-task").waitFor({ timeout: 10000 });
    await tp.waitForTimeout(800);
    ok((await tp.locator(".presenter .counter").textContent()) === "3 / 3" && await sp.locator(".live .badge", { hasText: "Folie 3 / 3" }).count() === 1, "erneut geöffnet: es geht an der laufenden Stelle weiter");
    await bw.locator(".beamer .bm-stage .codeslide.cs-task").waitFor({ timeout: 10000 });
    await tp.locator(".presenter .beamstate", { hasText: "Beamerfenster verbunden" }).waitFor({ timeout: 10000 });
    ok((await prevB.getAttribute("aria-pressed")) === "true", "… das offene Beamerfenster übernimmt die Präsentation von selbst; die Vorschau bleibt wie gewählt");
    // … auch wenn die Seite den laufenden Stand nicht kennt (Abfrage gescheitert): das Live-Objekt bleibt an der laufenden Stelle
    await tp.locator(".presenter").getByRole("button", { name: "Schließen", exact: true }).click();
    const liveRe = /\/api\/teacher\/lessons\/[^/]+\/live$/;
    await tp.route(liveRe, (route) => (route.request().method() === "GET" ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "nicht erreichbar" }) }) : route.continue()));
    await tp.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
    await tp.locator(".presenter .counter", { hasText: "3 / 3" }).waitFor({ timeout: 10000 });
    await tp.waitForTimeout(1500);
    ok((await tp.locator(".presenter .counter").textContent()) === "3 / 3" && await sp.locator(".live .badge", { hasText: "Folie 3 / 3" }).count() === 1 && await sp.locator(".live .badge", { hasText: "Sitzungscode" }).count() === 0,
      "erneut geöffnet ohne bekannten Stand: das Live-Objekt setzt an der laufenden Stelle fort (kein Sprung zur Codefolie)");
    await tp.unroute(liveRe);
    await tp.getByRole("button", { name: "Präsentation für alle beenden" }).click();
    await sp.locator(".live .placeholder").waitFor({ timeout: 10000 });
    await bw.locator(".beamer .bm-wait", { hasText: "Die Präsentation ist beendet." }).waitFor({ timeout: 10000 });
    ok(true, "Beenden kommt bei allen an – auch im Beamerfenster");
    await bw.close();
    await tp.locator(".thumbs .thumb.mark").waitFor({ timeout: 10000 });
    ok(await tp.locator("#shown-sel").inputValue() === "2" && await tp.locator(".thumbs .thumb.after").count() === 1, "Sitzung zeigt die Markierung (Folie 3 für Schüler:innen nicht freigegeben)");

    step("Beamer über ein zweites Gerät (z. B. Schul-iPad an Apple TV): Beamer-Code, „Beamer verbinden“ am iPad der Lehrkraft, Trennen, Beenden");
    {
      // Gerät am Beamer ohne Anmeldung; die Bildschirmsperre-Schnittstelle wird mitgezählt (headless gibt es sie nicht zuverlässig)
      const bctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await bctx.addInitScript(() => { window.__wl = []; try { Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async (t) => { window.__wl.push(t); return { release: async () => {}, addEventListener() {} }; } } }); } catch {} });
      const bp = await bctx.newPage(); watch(bp, "Beamergerät");
      const slideReq = []; bp.on("request", (q) => { const m = /\/api\/slide\/[a-f0-9]{16}\/(\d+)\?/.exec(q.url()); if (m) slideReq.push(Number(m[1])); });
      await bp.goto(BASE + "/");
      await bp.getByRole("link", { name: "Dieses Gerät als Beamer verwenden" }).click();
      const codeEl = bp.locator(".beamer .bm-code", { hasText: /^\d{3} \d{3}$/ });
      await codeEl.waitFor({ timeout: 10000 });
      const bcode = (await codeEl.textContent()).replace(" ", "");
      ok(new URL(bp.url()).hash === "#/beamer" && (await bp.locator(".beamer .bm-how").textContent()) === "Tippen Sie in der Präsentation auf Ihrem iPad auf „Beamer verbinden“ und geben Sie diesen Code ein."
        && (await bp.evaluate(() => window.__wl)).includes("screen") && await bp.locator(".beamer .bm-bar").getByRole("button", { name: "Fenster schließen" }).count() === 0
        && await bp.locator(".beamer .bm-bar").getByRole("link", { name: "Zur Startseite" }).getAttribute("href") === "#/",
        "Startseite → „Dieses Gerät als Beamer verwenden“: großer Beamer-Code (" + bcode + "), Bildschirmsperre verhindert");
      // Neuladen, bevor jemand den Code eingegeben hat: derselbe Code bleibt stehen (sonst koppelte der schon abgelesene Code ein Gerät, das ihn
      // nicht mehr abfragt)
      await bp.reload();
      await codeEl.waitFor({ timeout: 10000 });
      ok((await codeEl.textContent()).replace(" ", "") === bcode && await bp.title() === "Unterricks – Beamer", "Neuladen vor dem Koppeln: derselbe Beamer-Code; Titel „Unterricks – Beamer“ (Lesezeichen, Home-Bildschirm)");
      await bp.mouse.move(300, 300);
      await bp.screenshot({ ...SHOT, path: join(OUT, "beamergeraet-code.png") });
      // Lehrkraft am iPad (Touch): kein Beamerfenster, aber „Beamer verbinden“
      const tStore0 = await tp.evaluate(() => JSON.stringify(localStorage));
      const ictx = await browser.newContext({ ...devices["iPad (gen 7)"] });
      await ictx.addInitScript((s) => { if (!sessionStorage.getItem("st")) { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); sessionStorage.setItem("st", "1"); } }, tStore0);
      const ip = await ictx.newPage(); watch(ip, "Lehrkraft (iPad)");
      await ip.goto(BASE + "/#/lk/s/" + lessonId);
      await ip.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
      const ipr = ip.locator(".presenter");
      await ipr.locator(".stage .codeslide").waitFor({ timeout: 15000 });
      ok(await ipr.getByRole("button", { name: "Beamerfenster öffnen" }).count() === 0 && await ipr.getByRole("button", { name: "Beamer verbinden" }).count() === 1, "iPad: kein Beamerfenster, aber „Beamer verbinden“");
      const devB = ipr.getByRole("button", { name: "Beamer verbinden" }), dlg = ipr.locator(".bmc");
      await devB.click(); await dlg.waitFor();
      ok(await dlg.getAttribute("role") === "dialog" && await ip.evaluate(() => (document.activeElement || {}).id) === "bmc-in" && await ip.locator("#bmc-in").getAttribute("inputmode") === "numeric"
        && await ip.locator("#bmc-in").getAttribute("autocomplete") === "off" && (await dlg.textContent()).includes("Spiegeln Sie dieses Gerät dann nicht auf den Beamer"),
        "„Beamer verbinden“: Eingabefeld in der Präsentation (Dialog, Fokus im Feld, Ziffernfeld) mit dem Hinweis zum Spiegeln");
      await ip.keyboard.press("Escape");
      ok(!(await dlg.isVisible()) && await ip.evaluate(() => (document.activeElement || {}).textContent) === "Beamer verbinden", "Esc schließt das Feld, der Fokus steht wieder auf „Beamer verbinden“");
      await devB.click(); await dlg.waitFor();
      await ip.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-ipad-beamer-verbinden.png") });
      await ip.locator("#bmc-in").fill(String((Number(bcode) + 1) % 1e6).padStart(6, "0"));
      await ip.locator("#bmc-in").press("ArrowRight"); await ip.locator("#bmc-in").press("Backspace"); await ip.locator("#bmc-in").pressSequentially(String((Number(bcode) + 1) % 10));
      await ip.keyboard.press("Enter");
      await ip.locator("#bmc-err", { hasText: "Diesen Beamer-Code gibt es nicht (mehr). Bitte geben Sie die Ziffern ein, die jetzt auf dem Beamer stehen." }).waitFor({ timeout: 10000 });
      ok(await dlg.isVisible() && (await ipr.locator(".counter").textContent()) === "Sitzungscode" && await ip.locator("#bmc-in").getAttribute("aria-invalid") === "true",
        "falscher Code: Meldung im Feld; Pfeiltaste und Rücktaste im Feld blättern nicht");
      await ip.locator("#bmc-in").fill(bcode.slice(0, 3) + " " + bcode.slice(3));
      await ip.keyboard.press("Enter");
      await bp.locator(".beamer .bm-stage .codeslide").waitFor({ timeout: 15000 });
      await ipr.getByRole("button", { name: "Beamer verbunden" }).waitFor({ timeout: 10000 });
      ok(!(await dlg.isVisible()) && await ip.evaluate(() => (document.activeElement || {}).getAttribute && document.activeElement.getAttribute("aria-haspopup")) === "dialog"
        && (await bp.locator(".beamer .codeslide .c").textContent()) === codeF && await bp.locator(".nextpane, .np-frame, .presenter, .bm-code").count() === 0
        && (await ipr.locator(".devstate").textContent()) === "Beamer verbunden" && await ipr.locator(".small", { hasText: "1 Schüler:in verbunden" }).count() === 1
        && (await ipr.locator(".nextpane .np-head").textContent()) === "Als Nächstes Folie 1 / 3",
        "gekoppelt: der Beamer zeigt nur die Codefolie, das iPad weiter die Vorschau; „Beamer verbunden“, die Schülerzahl bleibt 1");
      await ipr.getByRole("button", { name: "Nächste Folie" }).click();
      await bp.waitForFunction(() => /\/1\?/.test((document.querySelector(".beamer .bm-stage > img") || {}).src || ""), null, { timeout: 10000 });
      await sp.locator(".live .badge", { hasText: "Folie 1 / 3" }).waitFor({ timeout: 10000 });
      for (let i = 0; i < 30 && !slideReq.includes(2); i++) await sleep(100);
      ok(slideReq.includes(2) && !slideReq.includes(3) && (await ipr.locator(".nextpane .np-head").textContent()) === "Als Nächstes Folie 2 / 3",
        "weiter: Folie 1 am Beamer und bei der Schülerin; Folie 2 hat der Beamer schon vorgeladen (Folie 3 ist eine Codefolie – kein Bild)");
      const linkBefore = JSON.parse(await bp.evaluate(() => localStorage.getItem("u.beamer")));
      await bp.reload();
      await bp.waitForFunction(() => /\/1\?/.test((document.querySelector(".beamer .bm-stage > img") || {}).src || ""), null, { timeout: 20000 });
      ok(await bp.locator(".bm-code").count() === 0 && linkBefore.lessonId === lessonId, "Neuladen des Beamers: wieder verbunden (gespeicherter Schlüssel), ohne neuen Code");
      await bp.mouse.move(300, 300);
      await bp.screenshot({ ...SHOT, path: join(OUT, "beamergeraet-folie.png") });
      await ip.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-ipad-beamer-verbunden.png") });
      // „Beamer trennen“: der Schlüssel gilt nicht mehr, der Beamer zeigt einen neuen Code
      await ipr.getByRole("button", { name: "Beamer verbunden" }).click();
      const barRows = () => ip.evaluate(() => Math.round(document.querySelector(".presenter .bar").getBoundingClientRect().height));
      const bar0 = await barRows();
      await dlg.getByRole("button", { name: "Beamer trennen" }).click();
      await ipr.locator(".devstate", { hasText: "Beamer getrennt" }).waitFor({ timeout: 10000 });
      await bp.locator(".beamer .bm-msg", { hasText: "Getrennt – dieses Gerät zeigt keine Präsentation mehr." }).waitFor({ timeout: 10000 });
      await codeEl.waitFor({ timeout: 10000 });
      const code2 = (await codeEl.textContent()).replace(" ", "");
      const oldKey = await fetch(BASE + "/api/beamer/live-ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lessonId, key: linkBefore.key }) });
      ok(code2 !== bcode && await ipr.getByRole("button", { name: "Beamer verbinden" }).count() === 1
        && await bp.evaluate(() => localStorage.getItem("u.beamer")) === null && oldKey.status === 403, "„Beamer trennen“: der Beamer zeigt „Getrennt“ und einen neuen Code; der alte Schlüssel gilt nicht mehr (403)");
      await ip.waitForFunction(() => document.querySelector(".presenter .devstate").textContent === "", null, { timeout: 15000 });
      ok(await barRows() === bar0, "„Beamer getrennt“ steht nur kurz in der Leiste – danach ist sie am iPad wieder so hoch wie vorher (" + bar0 + " px)");
      await bp.screenshot({ ...SHOT, path: join(OUT, "beamergeraet-getrennt.png") });
      // neu koppeln, dann „Präsentation für alle beenden“: beendet + neuer Code, das Gerät bleibt mit der Sitzung verbunden
      await ipr.getByRole("button", { name: "Beamer verbinden" }).click();
      await ip.locator("#bmc-in").fill(code2); await dlg.getByRole("button", { name: "Verbinden" }).click();
      await bp.waitForFunction(() => /\/1\?/.test((document.querySelector(".beamer .bm-stage > img") || {}).src || ""), null, { timeout: 15000 });
      await ipr.getByRole("button", { name: "Präsentation für alle beenden" }).click();
      await bp.locator(".beamer .bm-msg", { hasText: "Die Präsentation ist beendet." }).waitFor({ timeout: 10000 });
      await codeEl.waitFor({ timeout: 10000 });
      ok(await bp.locator(".beamer .bm-stage > img, .beamer .codeslide").count() === 0 && !!(await bp.evaluate(() => localStorage.getItem("u.beamer"))),
        "„Präsentation für alle beenden“: der Beamer zeigt „Die Präsentation ist beendet.“ und einen neuen Code (für die nächste Stunde)");
      await bp.screenshot({ ...SHOT, path: join(OUT, "beamergeraet-beendet.png") });
      await ip.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
      await bp.locator(".beamer .bm-stage .codeslide").waitFor({ timeout: 15000 });
      ok(true, "dieselbe Sitzung neu gestartet: der Beamer ist noch verbunden und zeigt sie wieder");
      await ip.locator(".presenter").getByRole("button", { name: "Präsentation für alle beenden" }).click();
      await bp.locator(".beamer .bm-msg", { hasText: "Die Präsentation ist beendet." }).waitFor({ timeout: 10000 });
      await sp.locator(".live .placeholder").waitFor({ timeout: 10000 });
      await ictx.close(); await bctx.close();
      // Beamergerät ohne Kopplung: lange Abfrage (höchstens eine Abfrage je 12 s statt alle 2 s); nach zwei Stunden ohne Eingabe holt es keinen
      // Code mehr und gibt die Bildschirmsperre frei, Tippen holt wieder einen (Uhr der Seite per page.clock vorgestellt)
      const kctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
      await kctx.addInitScript(() => { window.__wl = []; window.__wlr = 0; try { Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async (t) => { window.__wl.push(t); return { release: async () => { window.__wlr++; }, addEventListener() {} }; } } }); } catch {} });
      const kp = await kctx.newPage(); watch(kp, "Beamergerät (unbeachtet)");
      const polls = []; kp.on("request", (q) => { if (q.url().includes("/api/beamer/pair/poll")) polls.push(JSON.parse(q.postData() || "{}")); });
      await kp.clock.install();
      await kp.goto(BASE + "/#/beamer");
      const kcode = kp.locator(".beamer .bm-code", { hasText: /^\d{3} \d{3}$/ });
      await kcode.waitFor({ timeout: 10000 });
      const n0 = polls.length; await sleep(9000);
      ok(polls.length - n0 <= 3 && polls.length > 0 && polls.every((b) => b.wait === true), "Beamer-Code als lange Abfrage: " + (polls.length - n0) + " Abfragen in 9 s (statt etwa 5)");
      await kp.clock.fastForward("02:00:30");
      await kp.locator(".beamer .bm-pair.off .bm-ttl", { hasText: "Seit zwei Stunden hat hier niemand einen Beamer-Code eingegeben – dieses Gerät holt deshalb keinen neuen mehr." }).waitFor({ timeout: 20000 });
      const nIdle = polls.length; await sleep(3000);
      ok(!(await kp.locator(".beamer .bm-code").isVisible()) && polls.length === nIdle && (await kp.evaluate(() => window.__wlr)) >= 1,
        "zwei Stunden unbeachtet: kein Code mehr, keine Abfragen, Bildschirmsperre freigegeben");
      await kp.screenshot({ ...SHOT, path: join(OUT, "beamergeraet-unbeachtet.png") });
      const wl0 = (await kp.evaluate(() => window.__wl)).length;
      await kp.getByRole("button", { name: "Neuen Beamer-Code anzeigen" }).click();
      await kcode.waitFor({ timeout: 10000 });
      ok(await kp.getByRole("button", { name: "Neuen Beamer-Code anzeigen" }).isHidden() && (await kp.evaluate(() => window.__wl)).length > wl0, "„Neuen Beamer-Code anzeigen“: wieder ein Code, Bildschirm wieder wach gehalten");
      await kctx.close();
    }

    step("Timer in der Live-Präsentation (Nachtrag 16): Lehrkraft am iPad stellt ihn, oben über der Folie bei der Schülerin, am Beamergerät, im Beamerfenster und bei der Lehrkraft");
    {
      // eigene Kontexte mit Uhr der Seite (page.clock): Ablauf ohne minutenlanges Warten – der Server zählt mit seiner Uhr, die Seiten ab dem Empfang
      const sStore = await sp.evaluate(() => JSON.stringify(localStorage)), tStore = await tp.evaluate(() => JSON.stringify(localStorage));
      const copy = (s) => { if (!sessionStorage.getItem("x")) { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); sessionStorage.setItem("x", "1"); } };
      const qctx = await browser.newContext({ ...devices["iPad (gen 7)"], reducedMotion: "reduce" }); await qctx.addInitScript(copy, sStore); await qctx.clock.install();
      const qp = await qctx.newPage(); watch(qp, "Schüler:in (Timer)");
      await qp.goto(BASE + "/#/schueler/s/" + lessonId);
      await qp.locator(".live .placeholder").waitFor({ timeout: 15000 });
      const gctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); await gctx.clock.install();
      const gp = await gctx.newPage(); watch(gp, "Beamergerät (Timer)");
      await gp.goto(BASE + "/#/beamer");
      const gcode = gp.locator(".beamer .bm-code", { hasText: /^\d{3} \d{3}$/ });
      await gcode.waitFor({ timeout: 10000 });
      const jctx = await browser.newContext({ ...devices["iPad (gen 7)"] }); await jctx.addInitScript(copy, tStore); await jctx.clock.install();
      const jp = await jctx.newPage(); watch(jp, "Lehrkraft (iPad, Timer)");
      await jp.goto(BASE + "/#/lk/s/" + lessonId);
      await jp.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
      const jpr = jp.locator(".presenter");
      await jpr.locator(".stage .codeslide").waitFor({ timeout: 15000 });
      await jpr.getByRole("button", { name: "Beamer verbinden" }).click();
      await jp.locator("#bmc-in").fill((await gcode.textContent()).replace(" ", "")); await jp.keyboard.press("Enter");
      await gp.locator(".beamer .bm-stage .codeslide").waitFor({ timeout: 15000 });
      await jpr.getByRole("button", { name: "Nächste Folie" }).click();
      await qp.locator(".live .badge", { hasText: "Folie 1 / 3" }).waitFor({ timeout: 10000 });
      await gp.waitForFunction(() => /\/1\?/.test((document.querySelector(".beamer .bm-stage > img") || {}).src || ""), null, { timeout: 10000 });
      const barH = () => jp.evaluate(() => Math.round(document.querySelector(".presenter .bar").getBoundingClientRect().height));
      const bar0 = await barH();
      const band = (pg, sel) => pg.evaluate((q) => { const b = document.querySelector(q + " .tband"); return b && !b.hidden ? { text: b.textContent, phase: b.className.replace("tband ", ""), bg: getComputedStyle(b).backgroundColor, anim: getComputedStyle(b).animationName } : null; }, sel);
      const secs = (t) => { const m = /(\d+):(\d\d)$/.exec(t || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
      const tmB = jpr.locator(".tmbtn"), tdlg = jpr.locator(".tmc");
      ok(await tmB.getAttribute("aria-haspopup") === "dialog" && (await tmB.evaluate((b) => b.textContent)) === "Timer" && await qp.locator(".live .tband").isHidden(), "„Timer“ in der Leiste; noch kein Timer bei der Schülerin");
      // Feld innerhalb der Präsentation: Dialog, Fokus hinein (Vorauswahl 5 Min), Ziele ≥ 44 px, Esc schließt, Fokus zurück
      await tmB.click(); await tdlg.waitFor();
      const tsz = await jp.evaluate(() => [...document.querySelectorAll(".tmc button, .tmc input")].filter((x) => x.getClientRects().length).map((x) => Math.round(x.getBoundingClientRect().height)));
      ok(await tdlg.getAttribute("role") === "dialog" && (await jp.evaluate(() => document.activeElement.textContent)) === "5 Min" && tsz.length >= 10 && tsz.every((x) => x >= 44)
        && (await tdlg.getByRole("button", { name: "5 Min", exact: true }).getAttribute("aria-pressed")) === "true", "Feld „Timer“ in der Präsentation: Schnellwahl, eigene Minuten, „Timer starten“ (Fokus im Feld, Ziele ≥ 44 px)");
      await jp.keyboard.press("Escape");
      ok(await tdlg.isHidden() && await jp.evaluate(() => document.activeElement.classList.contains("tmbtn")), "Esc schließt das Feld, der Fokus steht wieder auf „Timer“");
      await tmB.click(); await tdlg.waitFor();
      await jp.locator("#tmc-min").fill("0"); await tdlg.getByRole("button", { name: "Timer starten" }).click();
      ok((await jp.locator("#tmc-err").textContent()) === "Bitte geben Sie eine ganze Zahl von 1 bis 120 Minuten ein." && await qp.locator(".live .tband").isHidden(), "0 Minuten: Meldung, nichts gestartet");
      await tdlg.getByRole("button", { name: "3 Min", exact: true }).click();
      await tdlg.getByRole("button", { name: "Timer starten" }).click();
      await qp.locator(".live .tband:not([hidden])").waitFor({ timeout: 10000 });
      await gp.locator(".beamer .tband:not([hidden])").waitFor({ timeout: 10000 });
      const qb = await band(qp, ".live"), gb = await band(gp, ".beamer"), jb = await band(jp, ".presenter .stage");
      const geoQ = await qp.evaluate(() => { const b = document.querySelector(".live .tband").getBoundingClientRect(), i = document.querySelector(".live > img").getBoundingClientRect(), l = document.querySelector(".live").getBoundingClientRect(); return { top: Math.abs(b.top - l.top) < 1, under: i.top >= b.bottom - 0.5 }; });
      const geoG = await gp.evaluate(() => { const b = document.querySelector(".beamer .tband").getBoundingClientRect(), s = document.querySelector(".beamer .bm-stage").getBoundingClientRect(); return { top: Math.abs(b.top) < 1, under: s.top >= b.bottom - 0.5 }; });
      ok(/^Noch [23]:\d\d$/.test(qb && qb.text) && qb.phase === "tb-run" && /^Noch [23]:\d\d$/.test(gb && gb.text) && /^Noch [23]:\d\d$/.test(jb && jb.text) && geoQ.top && geoQ.under && geoG.top && geoG.under
        && await jpr.locator(".nextpane .tband").count() === 0 && await qp.locator(".live .tband").getAttribute("role") === "timer",
        "gestartet: oben über der Folie bei der Schülerin (" + qb.text + "), am Beamergerät und über der großen Folie der Lehrkraft – die Folie darunter, nicht verdeckt; die Vorschau ohne Timer");
      ok(await barH() === bar0 && /^Timer [23]:\d\d$/.test(await tmB.evaluate((b) => b.textContent)), "die Leiste am iPad bleibt so hoch wie vorher (" + bar0 + " px); der Knopf heißt „Timer m:ss“");
      await qp.screenshot({ ...SHOT, path: join(OUT, "timer-schueler.png") });
      await gp.screenshot({ ...SHOT, path: join(OUT, "timer-beamergeraet.png") });
      await jp.screenshot({ ...SHOT, path: join(OUT, "timer-lehrkraft-ipad.png") });
      // Folienwechsel behält ihn
      await jpr.getByRole("button", { name: "Nächste Folie" }).click();
      await qp.locator(".live .badge", { hasText: "Folie 2 / 3" }).waitFor({ timeout: 10000 });
      ok(/^Noch [23]:\d\d$/.test((await band(qp, ".live") || {}).text), "Folienwechsel: der Timer bleibt");
      // Pause und Weiter, +1 Min
      await tmB.click(); await tdlg.waitFor();
      await tdlg.getByRole("button", { name: "Pause" }).click();
      await qp.locator(".live .tband.tb-paused").waitFor({ timeout: 10000 });
      await gp.locator(".beamer .tband.tb-paused").waitFor({ timeout: 10000 });
      const pq = await band(qp, ".live");
      await qp.screenshot({ ...SHOT, path: join(OUT, "timer-schueler-pausiert.png") });
      await sleep(1500);
      ok(/^Pausiert – noch [23]:\d\d$/.test(pq.text) && (await band(qp, ".live")).text === pq.text && (await jp.locator(".tmc .tmc-now").textContent()) === pq.text, "Pause: „" + pq.text + "“ überall, die Zeit steht");
      await tdlg.getByRole("button", { name: "Weiter" }).click();
      await qp.locator(".live .tband.tb-run").waitFor({ timeout: 10000 });
      const s0 = secs((await band(qp, ".live")).text);
      await tdlg.getByRole("button", { name: "+1 Min" }).click();
      await qp.waitForFunction((x) => { const m = /(\d+):(\d\d)$/.exec(document.querySelector(".live .tband").textContent); return m && Number(m[1]) * 60 + Number(m[2]) >= x + 55; }, s0, { timeout: 10000 });
      ok(secs((await band(gp, ".beamer")).text) >= s0 + 55, "Weiter und „+1 Min“: eine Minute mehr – bei der Schülerin und am Beamergerät");
      await tdlg.getByRole("button", { name: "Fertig" }).click();
      // Lehrkraft am Laptop mit Beamerfenster: dieselbe Anzeige über der Folie und im Beamerfenster; Taste T öffnet das Feld
      await tp.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
      const tpr = tp.locator(".presenter");
      await tpr.locator(".stage .tband:not([hidden])").waitFor({ timeout: 10000 });
      const [bw2] = await Promise.all([tctx.waitForEvent("page"), tpr.getByRole("button", { name: "Beamerfenster öffnen" }).click()]);
      watch(bw2, "Beamerfenster (Timer)");
      await bw2.locator(".beamer .tband:not([hidden])").waitFor({ timeout: 10000 });
      ok(/^Noch [34]:\d\d$/.test((await band(bw2, ".beamer")).text) && await bw2.locator(".beamer .bm-stage > img").count() === 1 && /^Noch [34]:\d\d$/.test((await band(tp, ".presenter .stage")).text)
        && (await tpr.locator(".tmbtn .tm-lbl").isVisible()), "Beamerfenster: der Timer oben über der Folie (vom Präsentationsfenster); am Laptop steht die Restzeit auch im Knopf");
      await bw2.mouse.move(400, 300);
      await bw2.screenshot({ ...SHOT, path: join(OUT, "timer-beamerfenster.png") });
      await tp.keyboard.press("t");
      await tpr.locator(".tmc").waitFor();
      ok(await tp.evaluate(() => document.activeElement.textContent) === "Pause", "Taste T öffnet das Feld (Fokus auf „Pause“)");
      await tp.keyboard.press("Escape");
      await bw2.keyboard.press("t"); await sleep(500);
      ok(await tpr.locator(".tmc").isHidden(), "T im Beamerfenster öffnet nichts im Präsentationsfenster");
      await tpr.getByRole("button", { name: "Schließen", exact: true }).click();
      await bw2.locator(".beamer .bm-wait", { hasText: "Die Präsentation ist gerade nicht geöffnet." }).waitFor({ timeout: 10000 });
      ok(await bw2.locator(".beamer .tband").isHidden() && !!(await band(qp, ".live")), "Präsentationsfenster geschlossen: das Beamerfenster ohne Timer, bei der Schülerin läuft er weiter");
      await bw2.close();
      // letzte Minute orange, Ablauf rot „Die Zeit ist um!“ (Uhr der Seiten vorgestellt), bleibt bis „Timer schließen“
      await tmB.click(); await tdlg.waitFor();
      await tdlg.getByRole("button", { name: "Timer beenden" }).click();
      await qp.waitForFunction(() => document.querySelector(".live .tband").hidden, null, { timeout: 10000 });
      ok(await gp.locator(".beamer .tband").isHidden() && await jpr.locator(".stage .tband").isHidden() && (await tmB.evaluate((b) => b.textContent)) === "Timer", "„Timer beenden“: überall weg");
      await tmB.click(); await tdlg.waitFor();
      await jp.locator("#tmc-min").fill("1"); await jp.keyboard.press("Enter");
      await qp.locator(".live .tband.tb-last").waitFor({ timeout: 10000 });
      await gp.locator(".beamer .tband.tb-last").waitFor({ timeout: 10000 });
      const lq = await band(qp, ".live");
      ok(lq.bg === "rgb(255, 154, 69)" && /^Noch (1:00|0:5\d)$/.test(lq.text) && (await jpr.locator(".stage .tband").getAttribute("class")) === "tband tb-last", "letzte Minute: orange bei allen (" + lq.text + ")");
      await qp.screenshot({ ...SHOT, path: join(OUT, "timer-schueler-letzte-minute.png") });
      await sleep(1200);   // die Nachrichten zum Start sind angekommen – danach zählt nur noch die Uhr der Seiten
      for (const c of [qctx, gctx, jctx]) await c.clock.fastForward("01:05");
      await qp.locator(".live .tband.tb-over").waitFor({ timeout: 10000 });
      await gp.locator(".beamer .tband.tb-over").waitFor({ timeout: 10000 });
      await jpr.locator(".stage .tband.tb-over").waitFor({ timeout: 10000 });
      const oq = await band(qp, ".live"), og = await band(gp, ".beamer");
      await qp.waitForFunction(() => document.querySelector(".live .tb-say").textContent === "Die Zeit ist um!", null, { timeout: 5000 }).catch(() => {});
      ok(oq.text === "Die Zeit ist um!" && oq.bg === "rgb(200, 40, 30)" && og.text === "Die Zeit ist um!" && (await tmB.evaluate((b) => b.textContent)) === "Timer Zeit um"
        && (await qp.locator(".live .tb-say").textContent()) === "Die Zeit ist um!" && await qp.locator("audio, video").count() === 0, "abgelaufen: rot „Die Zeit ist um!“ bei allen, ruhig angesagt (kein Ton)");
      ok(oq.anim === "none" && og.anim === "tb-puls", "Pulsieren nur ohne „Bewegung reduzieren“ (Schülerin mit reduzierter Bewegung: ruhig rot)");
      await qp.screenshot({ ...SHOT, path: join(OUT, "timer-schueler-abgelaufen.png") });
      await gp.screenshot({ ...SHOT, path: join(OUT, "timer-beamergeraet-abgelaufen.png") });
      await qctx.clock.fastForward("05:00"); await sleep(300);
      ok((await band(qp, ".live")).text === "Die Zeit ist um!", "… und bleibt stehen, bis die Lehrkraft ihn schließt");
      await tmB.click(); await tdlg.waitFor();
      ok(await jp.evaluate(() => document.activeElement.textContent) === "Timer schließen" && await tdlg.getByRole("button", { name: "Pause" }).isHidden(), "nach Ablauf: „Timer schließen“ (Fokus), keine Pause");
      await jp.screenshot({ ...SHOT, path: join(OUT, "timer-lehrkraft-ipad-abgelaufen.png") });
      await tdlg.getByRole("button", { name: "Timer schließen" }).click();
      await qp.waitForFunction(() => document.querySelector(".live .tband").hidden, null, { timeout: 10000 });
      await gp.waitForFunction(() => document.querySelector(".beamer .tband").hidden, null, { timeout: 10000 });
      ok(await tdlg.isHidden() && await jpr.locator(".stage .tband").isHidden(), "„Timer schließen“ entfernt ihn überall");
      // „Präsentation für alle beenden“ entfernt einen laufenden Timer
      await tmB.click(); await tdlg.waitFor();
      await tdlg.getByRole("button", { name: "10 Min", exact: true }).click(); await tdlg.getByRole("button", { name: "Timer starten" }).click();
      await qp.locator(".live .tband:not([hidden])").waitFor({ timeout: 10000 });
      // Schüler:in am Laptop (Fenster 1440 px breit): das Band richtet sich nach dem Live-Kästchen, nicht nach dem Fenster (die Folie bleibt groß)
      await sp.setViewportSize({ width: 1440, height: 900 });
      await sp.locator(".live .tband:not([hidden])").waitFor({ timeout: 10000 }); await sleep(300);
      const pcB = await sp.evaluate(() => { const b = document.querySelector(".live .tband"), l = document.querySelector(".live").getBoundingClientRect(); return { h: b.getBoundingClientRect().height, fs: parseFloat(getComputedStyle(b).fontSize), lh: l.height, lw: l.width }; });
      ok(pcB.h <= pcB.lh * 0.12 && Math.abs(pcB.fs - Math.max(16, pcB.lw * 0.032)) < 1, "Schüler:in am Laptop: Band " + Math.round(pcB.h) + " px im " + Math.round(pcB.lh) + " px hohen Kästchen (Schrift nach der Breite des Kästchens)");
      await sp.setViewportSize(devices["iPad (gen 7)"].viewport);
      await jpr.getByRole("button", { name: "Präsentation für alle beenden" }).click();
      await qp.locator(".live .placeholder").waitFor({ timeout: 10000 });
      await gp.locator(".beamer .bm-msg", { hasText: "Die Präsentation ist beendet." }).waitFor({ timeout: 10000 });
      ok(await qp.locator(".live .tband").isHidden() && await gp.locator(".beamer .tband").isHidden() && await sp.locator(".live .tband").isHidden(), "„Präsentation für alle beenden“: kein Timer mehr");
      await qctx.close(); await gctx.close(); await jctx.close();
    }

    /* ---------- Claude-Connector (MCP) ---------- */
    step("Claude-Connector (MCP)");
    r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    ok(r.data.result.protocolVersion === "2025-06-18" && r.data.result.capabilities.tools, "älteres Protokoll: initialize");
    ok((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status === 202, "Benachrichtigung → 202");
    const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
    r = await rpc({ jsonrpc: "2.0", id: 2, method: "server/discover", params: { _meta: meta } });
    ok(r.data.result.resultType === "complete" && r.data.result.supportedVersions.includes("2026-07-28"), "aktuelles Protokoll 2026-07-28: server/discover");
    r = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "1999-01-01" } } });
    ok(r.data.error && r.data.error.code === -32022, "unbekannte Version → UnsupportedProtocolVersion");
    r = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: meta } });
    ok(["get_lesson", "save_schulportal_entry", "add_text_material", "propose_feibeitsblatt", "list_units", "get_unit", "get_planning_basis", "save_unit_plan", "update_unit_row", "save_substitute_plan"].every((n) => r.data.result.tools.some((t) => t.name === n)), "Werkzeuge gelistet");
    ok(!r.data.result.tools.some((t) => t.name === "create_lesson"), "keine Sitzungen am Plan vorbei (kein create_lesson)");
    r = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_lesson", arguments: { lesson_id: lessonId }, _meta: meta } });
    const dump = r.data.result.content[0].text;
    ok(dump.includes("Q2") && dump.includes("Manuell ergänzt") && dump.includes("Ablauf aus dem Chat"), "Claude liest die aktuelle Sitzung inkl. Schulportal-Eintrag");
    const ver = r.data.result.structuredContent.portal_version;
    r = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "add_text_material", arguments: { lesson_id: lessonId, bereich: "schueler", titel: "Von Claude: Arbeitsauftrag", markdown: "# Auftrag\n- Lies M1\n- Fasse zusammen" } } });
    ok(!r.data.result.isError, "Claude legt Material ab");
    r = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "save_schulportal_entry", arguments: { lesson_id: lessonId, text: "**1) Von Claude**", base_version: ver - 1 } } });
    ok(r.data.result.isError === true, "Claude überschreibt keine neuere Fassung der Lehrkraft");
    r = await rpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "propose_feibeitsblatt", arguments: { lesson_id: lessonId, titel: "Claude-Blatt", aufgaben: [{ text: "Nenne zwei Verfahren.", ki_auftrag: "Normenkontrolle, Verfassungsbeschwerde" }] } } });
    ok(!r.data.result.isError, "Claude schlägt ein Feibeitsblatt vor (Entwurf)");
    ok((await rpc({ jsonrpc: "2.0", id: 9, method: "tools/list" }, BASE + "/mcp/falsch")).status === 401, "falscher Connector-Schlüssel → 401");
    await sp.reload(); await sp.locator(".item", { hasText: "Von Claude: Arbeitsauftrag" }).waitFor();
    ok(true, "Material von Claude erscheint bei den Schüler:innen");
    r = await rpc({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "add_print_material", arguments: { lesson_id: lessonId, titel: "Kärtchen Gewaltenteilung", markdown: "# Kärtchen\n\n- Legislative\n- Exekutive\n- Judikative", anzahl: 14, beidseitig: false, farbe: false } } });
    ok(!r.data.result.isError && r.data.result.content[0].text.includes("14x - einseitig - sw - Kärtchen Gewaltenteilung.pdf"), "Claude legt eine Druckvorlage ab (add_print_material) mit Anzahl und Druckart");
    ok(!(await SA("GET", "/api/student/lessons/" + lessonId)).data.files.some((f) => /Kärtchen|Tafelbild|Arbeitsblatt Letter/.test(f.name)), "Druckvorlagen sind für Schüler:innen nie sichtbar");
    await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await tp.locator("#printcard .printrow .name", { hasText: "14x - einseitig - sw - Kärtchen Gewaltenteilung.pdf" }).waitFor({ timeout: 10000 });
    ok(true, "… erscheint beim Zurückkehren in der Druckliste der Sitzung");

    /* ---------- Von Claude gestaltetes Material: HTML → PDF (Server druckt) ---------- */
    step("Claude gestaltet Material als HTML, der Server druckt es als PDF (Chromium); Nachdrucken auf der Sitzungsseite; Testseite");
    r = await rpc({ jsonrpc: "2.0", id: 11, method: "tools/list" });
    const tAdd = r.data.result.tools.find((t) => t.name === "add_material_pdf");
    ok(tAdd && /Atkinson Hyperlegible Next/.test(tAdd.description) && r.data.result.tools.some((t) => t.name === "get_material") && /^RÜCKFALL/.test(r.data.result.tools.find((t) => t.name === "add_text_material").description),
      "Werkzeug add_material_pdf mit Gestaltungsregeln; Markdown-Werkzeuge nur als Rückfall");
    const nCalls = printer.calls.length;
    r = await tool("add_material_pdf", { lesson_id: lessonId, bereich: "schueler", titel: "Arbeitsblatt Gewaltenteilung", html: SHEET_HTML });
    ok(!r.isError && /gespeichert und als PDF gedruckt: 1 Seite, \d+ KB, für die Schüler:innen\./.test(r.content[0].text), "Claude legt das Material ab; die Antwort nennt Seitenzahl und Größe");
    const designId = r.structuredContent.file_id;
    const pjob = printer.calls[nCalls];
    ok(pjob && !pjob.html.includes("<script") && pjob.html.includes("@font-face{font-family:'Atkinson Hyperlegible Next'") && pjob.pdfOptions.format === "a4" && pjob.pdfOptions.preferCSSPageSize === true,
      "Druckauftrag: ohne Skripte, mit der Unterricks-Schrift, A4 (Claudes @page gilt)");
    ok(printer.blocked.some((u) => u.startsWith("https://example.org/")), "Netzzugriffe aus der Gestaltung werden beim Druck blockiert");
    await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const dRow = tp.locator("#app .item", { hasText: "Arbeitsblatt Gewaltenteilung.pdf" });
    await dRow.locator(".meta", { hasText: "PDF, von Claude gestaltet · 1 Seite" }).waitFor({ timeout: 10000 });
    ok(true, "Sitzungsseite: Material „PDF, von Claude gestaltet · 1 Seite“");
    let dlp = tp.waitForEvent("download");
    await dRow.getByRole("button", { name: "Herunterladen" }).click();
    const designPdf = readFileSync(await (await dlp).path());
    const dTxt = designPdf.toString("latin1");
    ok(dTxt.startsWith("%PDF-") && /AtkinsonHyperlegibleNext/.test(dTxt), "die PDF ist da und enthält die Schrift Atkinson Hyperlegible Next");
    writeFileSync(join(OUT, "claude-gestaltet.pdf"), designPdf);
    ok((await SA("GET", "/api/student/lessons/" + lessonId)).data.files.some((f) => f.name === "Arbeitsblatt Gewaltenteilung.pdf" && f.kind === "file" && !f.text), "Schüler:innen sehen die gedruckte PDF (ohne die Gestaltung)");
    r = await tool("get_material", { file_id: designId });
    ok(r.content[0].text.includes("Wer kontrolliert wen?") && !r.isError, "get_material liefert Claude die Gestaltung zum Überarbeiten");
    // Drucker gerade nicht erreichbar: gespeichert, die Sitzungsseite druckt nach, sobald es wieder geht
    printer.mode = "busy";
    r = await tool("add_material_pdf", { lesson_id: lessonId, bereich: "lehrkraft", titel: "Erwartungshorizont", html: "<h1>Erwartungshorizont</h1><p>Nur für die Lehrkraft</p>" });
    ok(/noch nicht als PDF gedruckt/.test(r.content[0].text) && /druckt es automatisch nach/.test(r.content[0].text), "Drucker gestört: gespeichert, Antwort kündigt den Nachdruck an");
    ok(!(await SA("GET", "/api/student/lessons/" + lessonId)).data.files.some((f) => f.name === "Erwartungshorizont.pdf"), "Material nur für die Lehrkraft ist für Schüler:innen nie sichtbar");
    await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const eRow = tp.locator("#app .item", { hasText: "Erwartungshorizont.pdf" });
    await eRow.waitFor({ timeout: 10000 });
    await eRow.locator(".meta", { hasText: /wartet auf den PDF-Drucker|wird als PDF gedruckt/ }).waitFor({ timeout: 15000 });
    ok(true, "… die Sitzungsseite zeigt „wartet auf den PDF-Drucker“ und versucht es erneut");
    printer.mode = "ok";
    await eRow.locator(".meta", { hasText: "PDF, von Claude gestaltet" }).waitFor({ timeout: 30000 });
    ok(true, "… und druckt es, sobald der Drucker wieder antwortet");
    // überarbeiten mit file_id: der Drucker lehnt ab → Fehler sichtbar, „Erneut drucken“
    printer.mode = "fail";
    r = await tool("add_material_pdf", { lesson_id: lessonId, titel: "Arbeitsblatt Gewaltenteilung", html: SHEET_HTML.replace("Wer kontrolliert wen?", "Wer kontrolliert die Macht?"), file_id: designId });
    ok(/Bitte die Gestaltung prüfen/.test(r.content[0].text), "Druckfehler nach dem Überarbeiten: Claude soll die Gestaltung korrigieren");
    ok((await SA("GET", "/api/student/lessons/" + lessonId)).data.files.some((f) => f.name === "Arbeitsblatt Gewaltenteilung.pdf"), "… die Schüler:innen sehen bis dahin die bisherige Fassung");
    await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await dRow.locator(".meta", { hasText: "Druck fehlgeschlagen" }).waitFor({ timeout: 10000 });
    printer.mode = "ok";
    await dRow.getByRole("button", { name: "Erneut drucken" }).click();
    await dRow.locator(".meta", { hasText: "PDF, von Claude gestaltet" }).waitFor({ timeout: 20000 });
    ok(true, "Sitzungsseite: „Druck fehlgeschlagen“ mit „Erneut drucken“ – danach gedruckt");
    await tp.locator("#app .item", { hasText: "Arbeitsblatt Gewaltenteilung.pdf" }).screenshot({ ...SHOT, path: join(OUT, "lehrkraft-material-claude.png") });
    // Druckliste
    r = await tool("add_material_pdf", { lesson_id: lessonId, bereich: "druck", titel: "Kärtchen Gewalten", html: "<div style='display:grid;grid-template-columns:1fr 1fr;gap:10mm'><div>Legislative</div><div>Exekutive</div></div>", anzahl: 28, beidseitig: false, farbe: false });
    ok(!r.isError && r.content[0].text.includes("„28x - einseitig - sw - Kärtchen Gewalten.pdf“"), "Druckvorlage gestaltet (bereich druck) mit Anzahl und Druckart");
    await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await tp.locator("#printcard .printrow", { hasText: "28x - einseitig - sw - Kärtchen Gewalten.pdf" }).locator(".meta", { hasText: "PDF, von Claude gestaltet" }).waitFor({ timeout: 10000 });
    ok(true, "… erscheint gedruckt in der Druckliste");
    // Prüfung nach dem Ausrollen: Testseite höchstens einmal je Stunde
    let hp = await (await fetch(BASE + "/api/health/pdf")).json();
    ok(hp.ok && hp.pages === 1 && hp.fonts === true, "Testseite /api/health/pdf: gedruckt, 1 Seite, mit Schrift");
    hp = await (await fetch(BASE + "/api/health/pdf")).json();
    ok(hp.ok && hp.skipped === true && hp.nextAt > Date.now(), "… ein zweiter Aufruf druckt nicht (höchstens einmal je Stunde)");
    // Prüfbefunde vom 11.11.2026: JavaScript beim Druck aus; Platzhalter nur für dasselbe Material; Startseite druckt ohne offene Sitzung nach
    ok(printer.calls.slice(nCalls).every((j) => j.setJavaScriptEnabled === false), "jeder Druckauftrag schaltet JavaScript ab");
    r = await tool("add_material_pdf", { lesson_id: lessonId, bereich: "schueler", titel: "Variante", html: "<img src=\"data:unterricks-bild,1\">" });
    ok(r.isError && /Bild-Platzhalter/.test(r.content[0].text), "Bild-Platzhalter aus get_material gelten nur für dasselbe Material");
    printer.mode = "busy";
    r = await tool("add_material_pdf", { lesson_id: lessonId, bereich: "lehrkraft", titel: "Tafelbild Gewaltenteilung", html: "<h1>Tafelbild</h1>" });
    const tafelId = r.structuredContent.file_id;
    printer.mode = "ok";
    await tp.goto(BASE + "/#/lk");
    await tp.locator(".toast", { hasText: "von Claude als PDF" }).waitFor({ timeout: 15000 });
    let tafel = null;
    for (let i = 0; i < 40 && !(tafel && tafel.status === "ready"); i++) { await sleep(500); tafel = (await T("GET", "/api/teacher/lessons/" + lessonId)).data.files.find((f) => f.id === tafelId); }
    ok(tafel && tafel.status === "ready" && tafel.design && !tafel.design.outdated, "Startseite: Unterricks druckt ausstehendes Material nach, ohne dass die Sitzung offen ist");
    await tp.goto(BASE + "/#/lk/s/" + lessonId); await tp.locator("#app .item", { hasText: "Tafelbild Gewaltenteilung.pdf" }).waitFor({ timeout: 15000 });
    const ppr = await tool("get_lesson", { lesson_id: lessonId });
    ok(ppr.content[0].text.includes("Tafelbild Gewaltenteilung.pdf") && ppr.content[0].text.includes("Wer kontrolliert die Macht?"), "get_lesson nennt gestaltetes Material mit seinem Inhalt");

    /* ---------- Feibeitsblatt ---------- */
    step("Feibeitsblatt: verbinden, Entwurf prüfen, anlegen, Abgaben einsehen");
    await tp.reload();
    const fbSec = tp.locator("section.card", { hasText: "Feibeitsblätter dieser Sitzung" });
    await fbSec.locator("input[inputmode=numeric]").fill("1104");
    await fbSec.locator("input[type=password]").fill(FB_PW);
    await fbSec.getByRole("button", { name: "Verbinden" }).click();
    await fbSec.locator(".badge.ok", { hasText: "verbunden" }).first().waitFor({ timeout: 20000 });
    ok(true, "mit Feibeitsblatt verbunden (Schlüssel im Browser abgeleitet)");
    const fl = await T("GET", "/api/teacher/fb-link");
    ok(!!fl.data.link && Object.keys(fl.data.link).sort().join() === "at,ct,iv,v" && !JSON.stringify(fl.data).includes(FB_PW), "Verbindung Ende-zu-Ende verschlüsselt im Benutzerkonto gespeichert (nur Umschlag, kein Passwort)");
    await tp.reload();
    await fbSec.locator(".badge.ok", { hasText: "verbunden" }).waitFor({ timeout: 20000 });
    ok(await fbSec.locator('input[aria-label="Feibeitsblatt-Passwort"]').count() === 0 && await fbSec.locator(".fblink", { hasText: "verschlüsselt in Ihrem Benutzerkonto gespeichert" }).count() === 1, "nach dem Neuladen automatisch verbunden – ohne erneute Eingabe");
    await fbSec.getByRole("button", { name: "Feibeitsblatt-Entwurf aus dem Chat" }).click();
    await tp.locator(".modal", { hasText: "Feibeitsblatt prüfen und anlegen" }).waitFor({ timeout: 20000 });
    ok(await tp.locator(".modal textarea").nth(2).inputValue().then((v) => v.includes("Normenkontrolle") && v.includes("Altersgemäße Erwartung (Q2, Grundkurs)")), "Entwurf mit „Auftrag an die KI“ zum Prüfen – sichtbar mit der altersgemäßen Erwartung");
    ok(await tp.locator(".modal .hint", { hasText: "Keine Musterlösung, sondern ein Auftrag an die korrigierende KI" }).count() >= 1, "Editor erklärt: Auftrag an die KI, keine Musterlösung");
    await tp.locator(".modal textarea").first().fill("Erkläre mit [dem Lexikon der bpb](https://www.bpb.de/kurz-knapp/lexika/politiklexikon/17561/gewaltenteilung/) zwei Aufgaben des Bundesverfassungsgerichts (geändert).");
    // Nr. 17: Links im Material und in der Aufgabenstellung – im Entwurf als Vorschau anklickbar (neuer Tab), im Feibeitsblatt als Link-Läufe
    await tp.locator(".modal textarea").nth(1).fill("Das BVerfG wacht über das **Grundgesetz**. Mehr: https://www.bundesverfassungsgericht.de/ und [Wikipedia](https://de.wikipedia.org/wiki/Bundesverfassungsgericht_(Deutschland)).");
    const prevLinks = await tp.locator(".modal .fblinks a").evaluateAll((as) => as.map((a) => [a.textContent, a.getAttribute("href"), a.target, a.rel].join(" | ")));
    if (prevLinks.length !== 3) console.log("    Vorschau:", JSON.stringify(prevLinks));
    ok(prevLinks.length === 3 && prevLinks[0] === "dem Lexikon der bpb (öffnet in neuem Tab) | https://www.bpb.de/kurz-knapp/lexika/politiklexikon/17561/gewaltenteilung/ | _blank | noopener noreferrer"
      && prevLinks[1].startsWith("https://www.bundesverfassungsgericht.de/ (öffnet in neuem Tab) | https://www.bundesverfassungsgericht.de/ | _blank")
      && prevLinks[2] === "Wikipedia (öffnet in neuem Tab) | https://de.wikipedia.org/wiki/Bundesverfassungsgericht_(Deutschland) | _blank | noopener noreferrer",
      "Entwurf: Links aus Aufgabenstellung und Material als Vorschau – anklickbar in neuem Tab (noopener, noreferrer)");
    await tp.locator(".modal").getByRole("button", { name: "Feibeitsblatt jetzt anlegen" }).click();
    await tp.locator(".modal", { hasText: "erhält einen Code" }).getByRole("button", { name: "Anlegen", exact: true }).click();
    await tp.locator(".modal", { hasText: "Feibeitsblatt angelegt" }).waitFor({ timeout: 20000 });
    const created = [...fbm.sheets.values()][0];
    if (fbm.sheets.size !== 1 || !created.tasks[0].text.endsWith("(geändert).")) console.log("    Blätter:", JSON.stringify([...fbm.sheets.values()]).slice(0, 800));
    ok(created && created.tasks[0].text.endsWith("(geändert).") && created.tasks[0].solution.includes("Normenkontrolle") && created.tasks[1].answer.type === "table", "Blatt angelegt – mit Änderung der Lehrkraft und KI-Einstellungen je Aufgabe");
    ok(created && created.tasks.every((t) => t.solution === "" || (t.solution.includes("Altersgemäße Erwartung (Q2, Grundkurs): Das legt nur das Anspruchsniveau fest") && t.solution.split("Altersgemäße Erwartung").length === 2)),
      "jeder Auftrag an die KI trägt die altersgemäße Erwartung der Lerngruppe (Q2, Grundkurs)");
    ok(Array.isArray(created.tasks[0].material) && created.tasks[0].material[0].some((x) => x.f === "b"), "Material im Feibeitsblatt-Format (Absätze/Läufe)");
    const linkRuns = (paras) => (paras || []).flat().filter((x) => x.h).map((x) => x.t + " → " + x.h);
    ok(JSON.stringify(linkRuns(created.tasks[0].material)) === JSON.stringify(["https://www.bundesverfassungsgericht.de/ → https://www.bundesverfassungsgericht.de/", "Wikipedia → https://de.wikipedia.org/wiki/Bundesverfassungsgericht_(Deutschland)"])
      && JSON.stringify(linkRuns(created.tasks[0].textFmt)) === JSON.stringify(["dem Lexikon der bpb → https://www.bpb.de/kurz-knapp/lexika/politiklexikon/17561/gewaltenteilung/"]) && !created.tasks[1].textFmt,
      "angelegtes Blatt: Links als Link-Läufe im Material und in der Aufgabenstellung (textFmt; ohne Link kein textFmt)");
    // Notfall-Feibeitsblatt: entsteht gleich nach dem Anlegen (noch ohne Checkliste → ohne QR-Code) im Material für Schüler:innen
    const notfallOf = async (code) => ((await T("GET", "/api/teacher/lessons/" + lessonId)).data.files || []).filter((f) => f.source === "notfall" && f.fbCode === code && f.area !== "archive");
    const waitNotfall = async (code, pred) => { for (let i = 0; i < 60; i++) { const fs = await notfallOf(code); if (fs.length && pred(fs)) return fs; await sleep(250); } return notfallOf(code); };
    const pdfOf = async (f) => { const l = await T("POST", "/api/teacher/files/" + f.id + "/link", {}); return Buffer.from(await (await fetch(BASE + l.data.url)).arrayBuffer()).toString("latin1"); };
    let nf = await waitNotfall(created.code, (fs) => fs[0].fbSig && !fs[0].fbSig.includes("-qr"));
    ok(nf.length === 1 && nf[0].area === "student" && nf[0].name === "Notfall-Feibeitsblatt – Mock-Blatt BVerfG.pdf" && nf[0].mime === "application/pdf", "Notfall-Feibeitsblatt automatisch im Material für Schüler:innen (" + (nf[0] && nf[0].name) + ")");
    let nfPdf = nf.length ? await pdfOf(nf[0]) : "";
    ok(nfPdf.startsWith("%PDF-1.7") && nfPdf.trim().endsWith("%%EOF") && !nfPdf.includes("#checkliste="), "… als PDF wie im Feibeitsblatt, ohne Checkliste noch ohne QR-Code");
    ok(nfPdf.includes("/URI (https://www.bundesverfassungsgericht.de/)") && nfPdf.includes("/URI (https://de.wikipedia.org/wiki/Bundesverfassungsgericht_\\(Deutschland\\))") && nfPdf.includes("/URI (https://www.bpb.de/kurz-knapp/"),
      "Notfall-Feibeitsblatt: die Links aus Material und Aufgabenstellung als Adresse mit Link (wie im analogen Arbeitsblatt)");
    await tp.getByRole("button", { name: "Checkliste vorschlagen lassen" }).click();
    await tp.getByRole("button", { name: "Checkliste bestätigen" }).click();
    await sleep(500);
    ok(!!created.checklist, "geführt: KI-Checkliste bestätigt");
    nf = await waitNotfall(created.code, (fs) => (fs[0].fbSig || "").includes("-qr"));
    nfPdf = nf.length ? await pdfOf(nf[0]) : "";
    ok(nf.length === 1 && nfPdf.includes("#checkliste=" + created.code) && nfPdf.includes("/Subtype /Link"), "nach der Checkliste ersetzt: Notfall-Feibeitsblatt mit QR-Code zur Checkliste (nur eine PDF)");
    await tp.locator(".modal").getByRole("button", { name: "Fertig" }).click();
    ok(await fbSec.locator(".notfall", { hasText: "Notfall-Feibeitsblatt im Material für Schüler:innen (mit QR-Code zur Checkliste)" }).count() === 1, "Feibeitsblatt-Abschnitt zeigt den Stand des Notfall-Feibeitsblatts");
    await sp.reload();
    const nfBox = sp.locator("section.notfallbox");
    // Nr. 18: beim Laden zugeklappt – sichtbar nur die Titelzeile (Überschrift, ≥ 44 px); erst aufgeklappt der rote Hinweis und die PDF
    const nfSum = nfBox.locator("details.nfdetails > summary");
    await nfSum.waitFor();
    const nfClosed = async () => await nfBox.locator("details").evaluate((d) => !d.open) && !(await nfBox.locator(".alarm").isVisible()) && !(await nfBox.locator(".item").first().isVisible());
    ok(await nfClosed() && (await nfSum.textContent()) === "Notfall-Feibeitsblätter (nur bei technischen Problemen)" && await nfSum.locator("h2#nf-h").count() === 1
      && (await nfSum.boundingBox()).height >= 44 && await nfBox.getAttribute("aria-labelledby") === "nf-h", "Schüler:innen: Notfall-Kästchen zugeklappt – nur die Titelzeile, kein roter Hinweis, keine Datei sichtbar");
    await nfBox.screenshot({ ...SHOT, path: join(OUT, "schueler-notfall-zu.png") });
    await nfSum.focus(); await sp.keyboard.press("Enter");   // per Tastatur aufklappen
    await nfBox.locator(".item", { hasText: "Notfall-Feibeitsblatt – Mock-Blatt BVerfG.pdf" }).waitFor();
    ok(await nfBox.locator("details").evaluate((d) => d.open) && await nfBox.locator(".alarm").isVisible(), "aufgeklappt (Tastatur): roter Hinweis und Notfall-Feibeitsblatt sichtbar");
    ok(await nfBox.locator(".item", { hasText: "Notfall-Feibeitsblatt – Mock-Blatt BVerfG.pdf" }).getByRole("button", { name: "Herunterladen" }).count() === 1
      && (await nfBox.locator(".alarm").textContent()).startsWith("Achtung! Eigentlich sollst du mit den digitalen Feibeitsblättern arbeiten, die du in dieser Sitzung aufrufen kannst.")
      && await nfBox.locator(".alarm").evaluate((el) => getComputedStyle(el).backgroundColor) === "rgb(200, 40, 30)"
      && await sp.locator("section.card:not(.notfallbox) .item", { hasText: "Notfall-Feibeitsblatt" }).count() === 0, "Schüler:innen: Notfall-Feibeitsblatt in eigenem Kästchen mit rotem Hinweis (nicht unter Material)");
    ok(await sp.evaluate(() => { const box = document.querySelector(".notfallbox"), mat = [...document.querySelectorAll("section.card")].find((s) => s.querySelector("h2") && s.querySelector("h2").textContent === "Material");
      return !!mat && parseFloat(getComputedStyle(box).fontSize) < parseFloat(getComputedStyle(mat).fontSize) && !!(mat.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING); }), "… unter dem Material und mit kleinerer Schrift");
    await nfBox.screenshot({ ...SHOT, path: join(OUT, "schueler-notfall.png") });
    const fbCard = sp.locator(".item", { hasText: "Feibeitsblatt · Code" }).filter({ hasText: "Mock-Blatt BVerfG" });
    await fbCard.waitFor();
    ok((await fbCard.textContent()).includes(created.code.slice(0, 3) + "-" + created.code.slice(3)), "Schüleransicht: Titel + Code des Feibeitsblatts (kein PDF)");
    const [popup] = await Promise.all([sctx.waitForEvent("page"), fbCard.getByRole("button", { name: "Code kopieren und Feibeitsblatt öffnen" }).click()]);
    ok(popup.url().startsWith(FB), "öffnet die Feibeitsblatt-Seite");
    ok((await sp.evaluate(() => navigator.clipboard.readText())).replace("-", "") === created.code, "Code in der Zwischenablage");
    await popup.close();
    await fbm.addSubmission(created.code, { vorname: "Max", nachname: "Mu", geburtsdatum: "--05-12", klasse: "Q2" }, ["Normenkontrolle prüft Gesetze.", "Pro | Contra\nSchutz | Macht"]);
    await fbSec.locator(".item", { hasText: "Mock-Blatt BVerfG" }).getByRole("button", { name: "Abgaben ansehen" }).click();
    await tp.locator(".modal .sub", { hasText: "Max Mu (Q2)" }).waitFor({ timeout: 20000 });
    const subTxt = await tp.locator(".modal .sub").first().textContent();
    ok(subTxt.includes("Normenkontrolle prüft Gesetze.") && subTxt.includes("Beispiel ergänzen") && subTxt.includes("Verfassungsbeschwerde fehlt"), "Abgabe entschlüsselt: Antworten, KI-Feedback und finale KI-Rückmeldung");
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-abgaben.png") });
    await tp.keyboard.press("Escape");
    // ein vorhandenes Blatt mit Bild (im Feibeitsblatt angelegt) verknüpfen → Notfall-Feibeitsblatt mit eingebettetem Bild; entfernen → PDF weg
    const png = (await tp.screenshot({ type: "png", clip: { x: 0, y: 0, width: 60, height: 40 } })).toString("base64");
    fbm.sheets.set("MCKB23", { code: "MCKB23", title: "Blatt mit Bild", createdAt: Date.now(), escape: null, tasks: [{ text: "Beschreibe das Bild.", solution: "", images: [{ id: "0123456789abcdef", mode: "inline", w: 60, h: 40, alt: "Testbild" }] }],
      imageData: { "0123456789abcdef": { mime: "image/png", w: 60, h: 40, data: png } } });
    await fbSec.locator("summary", { hasText: "Vorhandenes Feibeitsblatt verknüpfen" }).click();
    await fbSec.locator("details select").selectOption("MCKB23");
    await fbSec.getByRole("button", { name: "Verknüpfen" }).click();
    const nfImg = await waitNotfall("MCKB23", () => true);
    const imgPdf = nfImg.length ? await pdfOf(nfImg[0]) : "";
    ok(nfImg.length === 1 && imgPdf.includes("/Subtype /Image") && imgPdf.includes("/DCTDecode"), "verknüpftes Blatt mit Bild: Notfall-Feibeitsblatt mit eingebettetem Bild");
    await fbSec.locator(".item", { hasText: "Blatt mit Bild" }).getByRole("button", { name: "Aus der Sitzung entfernen" }).click();
    await tp.locator(".modal").getByRole("button", { name: "Entfernen" }).click();
    await fbSec.locator(".item", { hasText: "Blatt mit Bild" }).waitFor({ state: "detached" });
    ok((await notfallOf("MCKB23")).length === 0, "Blatt aus der Sitzung entfernt: sein Notfall-Feibeitsblatt ist auch weg");
    // bestehende Sitzungen: Blatt verknüpft, bevor es Notfall-Feibeitsblätter gab (wie damals ohne PDF) → wird im Hintergrund nachgeholt
    fbm.sheets.set("MCK7Q4", { code: "MCK7Q4", title: "Altes Blatt", createdAt: Date.now(), escape: null, tasks: [{ text: "Erkläre die Gewaltenteilung.", solution: "" }] });
    const oldIds = [lessonId, byRow(3).id];
    for (const lid of oldIds) await T("POST", "/api/teacher/lessons/" + lid + "/sheets", { code: "MCK7Q4", title: "Altes Blatt" });
    const nfOld = async (lid) => ((await T("GET", "/api/teacher/lessons/" + lid)).data.files || []).filter((f) => f.source === "notfall" && f.fbCode === "MCK7Q4" && f.area !== "archive");
    const nfMiss = (await T("GET", "/api/teacher/notfall")).data;
    ok(nfMiss.ok && oldIds.every((lid) => nfMiss.items.some((x) => x.lessonId === lid && x.code === "MCK7Q4" && !x.fileId && !x.sig)) && nfMiss.items.some((x) => x.lessonId === lessonId && x.code === created.code && x.fileId && x.sig),
      "Schnittstelle nennt alle verknüpften Blätter mit dem Stand ihres Notfall-Feibeitsblatts (fehlend / vorhanden)");
    await tp.goto(BASE + "/#/lk"); await tp.reload();   // neuer Seitenaufruf: Nachholen im Hintergrund
    await tp.locator(".toast", { hasText: /2 Notfall-Feibeitsblätter für bestehende Sitzungen ergänzt/ }).waitFor({ timeout: 30000 });
    let nfA = await nfOld(oldIds[0]), nfB = await nfOld(oldIds[1]);
    ok(nfA.length === 1 && nfB.length === 1 && nfA[0].area === "student" && nfA[0].name === "Notfall-Feibeitsblatt – Altes Blatt.pdf" && nfA[0].fbSig === nfB[0].fbSig && /^v\d/.test(nfA[0].fbSig || ""),
      "bestehende Sitzungen: Notfall-Feibeitsblatt automatisch nachgeholt (je Sitzung eine PDF, Meldung)");
    ok((await pdfOf(nfA[0])).includes("%PDF-"), "nachgeholtes Notfall-Feibeitsblatt ist eine PDF");
    await tp.goto(BASE + "/#/lk/einstellungen");
    const nfSet = tp.locator("#fbsettings");
    await nfSet.locator("[role=status]", { hasText: "Alle verknüpften Feibeitsblätter haben ein Notfall-Feibeitsblatt." }).waitFor();
    // veraltet (z. B. Checkliste inzwischen bestätigt): „Alle prüfen und aktualisieren“ erneuert es
    ok((await T("PATCH", "/api/teacher/files/" + nfB[0].id, { area: "teacher" })).status === 200, "Notfall-Feibeitsblatt „nur für Lehrkräfte“ gestellt");
    const oldPdf = Buffer.from("%PDF-1.4\n% veraltet\n");
    const upOld = (sig) => fetch(BASE + "/api/teacher/lessons/" + oldIds[1] + "/sheets/MCK7Q4/notfall?sig=" + sig, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/pdf" }, body: oldPdf });
    const [ra, rb] = await Promise.all([upOld("v0-a"), upOld("v0-b")]);   // zwei gleichzeitig: nur eine bleibt (die zuletzt angelegte)
    nfB = await nfOld(oldIds[1]);
    ok(ra.ok && rb.ok && nfB.length === 1 && /^v0-/.test(nfB[0].fbSig), "zwei gleichzeitige Uploads desselben Notfall-Feibeitsblatts: genau eines bleibt");
    await nfSet.getByRole("button", { name: "Alle prüfen und aktualisieren" }).click();
    await nfSet.locator("[role=status]", { hasText: "1 Notfall-Feibeitsblatt aktualisiert. Alle Notfall-Feibeitsblätter sind aktuell." }).waitFor({ timeout: 30000 });
    nfB = await nfOld(oldIds[1]); nfA = await nfOld(oldIds[0]);
    ok(nfB.length === 1 && nfB[0].fbSig === nfA[0].fbSig && nfB[0].size > oldPdf.length, "„Alle prüfen und aktualisieren“ erneuert ein veraltetes Notfall-Feibeitsblatt");
    ok(nfB[0].area === "teacher" && nfA[0].area === "student", "erneuert bleibt es „nur für Lehrkräfte“, wenn die Lehrkraft es dorthin gestellt hatte");
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-notfall-nachholen.png") });
    await sp.reload();
    await nfSum.waitFor();
    ok(await nfClosed(), "nach dem Neuladen wieder zugeklappt (nichts gemerkt)");
    await nfSum.click();
    await sp.locator("section.notfallbox .item", { hasText: "Notfall-Feibeitsblatt – Altes Blatt.pdf" }).waitFor();
    ok(await nfBox.locator(".alarm").isVisible(), "Schüler:innen sehen das nachgeholte Notfall-Feibeitsblatt im Kästchen mit dem roten Hinweis");
    for (const lid of oldIds) await T("DELETE", "/api/teacher/lessons/" + lid + "/sheets/MCK7Q4");
    ok((await nfOld(oldIds[0])).length === 0 && (await nfOld(oldIds[1])).length === 0, "Blatt entfernt: nachgeholte Notfall-Feibeitsblätter wieder weg");
    await tp.goto(BASE + "/#/lk/s/" + lessonId); await fbSec.waitFor();

    /* ---------- Datum, Hausaufgabe, Zwischenstopp ---------- */
    step("Datum (änderbar, ohne Verschieben), Hausaufgabe, Zwischenstopp");
    ok((await T("POST", "/api/teacher/lessons", { subject: "powi", klass: "Q2-GK", title: "Ohne Einheit", date: today })).status === 400, "Sitzung ohne Einheit wird abgelehnt");
    const l2 = (await T("GET", "/api/teacher/lessons/" + byRow(1).id)).data.lesson, l3 = (await T("GET", "/api/teacher/lessons/" + byRow(2).id)).data.lesson;
    await tp.goto(BASE + "/#/lk"); await tp.locator(".tiles .tile").first().waitFor(); await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-faecher.png") });
    await tp.goto(BASE + "/#/lk/einstellungen");
    await tp.locator("#ai-order li").first().waitFor({ timeout: 10000 });
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-einstellungen.png") });
    const order = await tp.locator("#ai-order li").allTextContents();
    ok(order.length === 3 && order[0].startsWith("Claude") && order[1].startsWith("Anderer OpenAI-kompatibler Dienst") && order[2].startsWith("Cloudflare Workers AI"), "Einstellungen: Reihenfolge Claude → kostenlose KI → Cloudflare Workers AI");
    await tp.goto(BASE + "/#/lk/s/" + lessonId);
    await tp.locator("#hw").fill("Lies **M2** und beantworte Aufgabe 3.");
    await tp.locator('.homework .save-state[data-state="ok"]', { hasText: /^Gespeichert$/ }).waitFor({ timeout: 10000 });
    ok(await tp.locator(".homework", { hasText: "Fällig zur nächsten Sitzung am " + fmtDay(l2.date) }).count() === 1, "Hausaufgabe gespeichert, fällig zur nächsten Sitzung derselben Klasse");
    ok(await tp.locator(".homework .hwwhen .warnc", { hasText: "dafür fehlt der Beginn (Uhrzeit)" }).count() === 1, "ohne Beginn der Sitzung: Hinweis, dass Schüler:innen die Hausaufgabe noch nicht sehen");
    await sp.reload(); await sp.locator(".live").waitFor(); await sleep(400);
    ok(await sp.locator(".homework").count() === 0 && (await SA("GET", "/api/student/lessons/" + lessonId)).data.homework === null, "… Schüler:innen sehen sie dann nicht (auch nicht per Schnittstelle)");
    // Beginn so, dass die Sitzung in 10 Minuten endet: Hausaufgabe (ab 15 Minuten vor dem Ende) sichtbar, Präsentation noch gesperrt
    const setWhen = async (ms) => {
      const w = berlinAt(ms), dIn = tp.locator('input[aria-label="Datum der Sitzung"]');
      if (await dIn.inputValue() !== w.date) { await dIn.fill(w.date); await tp.locator(".toast", { hasText: "Datum geändert" }).last().waitFor({ timeout: 10000 }); }
      await tp.locator('input[aria-label="Beginn der Sitzung (Uhrzeit)"]').fill(w.time);
      const t = lessonTimes({ date: w.date, startTime: w.time, durationMin: 90 });
      await tp.locator(".timesline", { hasText: fmtClockBerlin(t.homeworkAt) + " Uhr" }).waitFor({ timeout: 10000 });
      return t;
    };
    await setWhen(Date.now() - 80 * 60e3);
    await sp.reload();
    await sp.locator(".homework").waitFor();
    const hwTxt = await sp.locator(".homework").textContent();
    await sp.screenshot({ ...SHOT, path: join(OUT, "schueler-hausaufgabe.png") });
    ok(hwTxt.includes("Bis zur nächsten Sitzung am " + fmtDay(l2.date)) && hwTxt.includes("M2") && await sp.locator(".homework strong", { hasText: "M2" }).count() === 1, "Schüler:innen sehen die Hausaufgabe mit Fälligkeit");
    ok(!hwTxt.includes("unterricks.janrickmer.de"), "der Schulportal-Hinweis erscheint in Unterricks nicht");
    ok(/Die Präsentation kannst du ab (\S+ \S+, )?\d\d:\d\d Uhr selbst öffnen \(5 Minuten nach dem Unterricht\)\./.test(await sp.locator("main").textContent()) && (await SA("POST", "/api/student/lessons/" + lessonId + "/presentation-link", {})).status === 403,
      "während der Stunde: Hausaufgabe ab 15 Minuten vor dem Ende sichtbar, Präsentation erst 5 Minuten nach dem Ende (serverseitig gesperrt)");
    // KI-Begriffshilfe während der Stunde: Einwilligung, dann nur die Frage an die KI
    await sp.getByRole("button", { name: "KI-Begriffshilfe nutzen" }).click();
    const km = sp.locator(".modal", { hasText: "KI-Begriffshilfe nutzen?" });
    await km.waitFor();
    const kmTxt = await km.textContent();
    ok(kmTxt.includes("datenschutzrechtlich nicht für die Schule vorgesehen") && kmTxt.includes("freiwillig") && kmTxt.includes("Cloudflare (USA)") && kmTxt.includes("keine persönlichen Daten"), "Einwilligung: freiwillig, nicht für die Schule vorgesehen, Dienste genannt, keine persönlichen Daten");
    await km.getByRole("button", { name: "Einwilligen und starten" }).click();
    ok(await km.isVisible(), "ohne Haken keine Einwilligung");
    await km.locator("#ki-ok").check(); await km.getByRole("button", { name: "Einwilligen und starten" }).click();
    await sp.locator("#ki-q").fill("Was bedeutet Normenkontrolle?"); await sp.locator(".kihelp").getByRole("button", { name: "Fragen" }).click();
    await sp.locator(".kihelp .kiq .a", { hasText: "Normenkontrolle heißt" }).waitFor({ timeout: 20000 });
    const kcall = ai.calls[ai.calls.length - 1], ksys = kcall.messages[0].content;
    ok(ksys.includes("Du bist die KI-Begriffshilfe") && ksys.includes("Jahrgangsstufe 12") && kcall.messages[kcall.messages.length - 1].content === "Was bedeutet Normenkontrolle?" && !JSON.stringify(kcall).includes(stoken),
      "KI-Begriffshilfe antwortet; an die KI gehen nur Regeln, Fach, Lerngruppe, Thema und die Frage");
    ok((await SA("POST", "/api/student/lessons/" + lessonId + "/ask", { question: "Was ist das?" })).status === 400, "ohne Einwilligung beantwortet der Server nichts");
    await sp.locator(".kihelp").screenshot({ ...SHOT, path: join(OUT, "schueler-ki-begriffshilfe.png") });
    await tp.locator(".homework").getByRole("button", { name: "Für das Schulportal kopieren" }).click();
    const hwCopy = await tp.evaluate(() => navigator.clipboard.readText());
    const code0 = lesson0.code.slice(0, 3) + "-" + lesson0.code.slice(3);
    const longDay = (iso) => Number(iso.slice(8, 10)) + ". " + ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"][Number(iso.slice(5, 7)) - 1] + " " + iso.slice(0, 4);
    ok(hwCopy === "**Hausaufgabe zum " + longDay(l2.date) + ":**\n\n- Lies **M2** und beantworte Aufgabe 3.\n- Unter https://unterricks.janrickmer.de kannst du diese Sitzung mit dem Code ~~" + code0 + "~~ aufrufen, um alle Materialien zu sehen und Abgaben eines Feibeitsblattes zu erledigen.",
      "Hausaufgabe fürs Schulportal: fette Überschrift mit Datum, Stichpunkte, zuletzt der Weg zur Sitzung mit dem Code");
    await sp.goto(BASE + "/#/schueler");
    await sp.locator(".item", { hasText: "Das Bundesverfassungsgericht" }).waitFor();
    ok(await sp.locator(".item", { hasText: "Das Bundesverfassungsgericht" }).locator(".badge", { hasText: "Hausaufgabe" }).count() === 1, "… und in ihrer Sitzungsliste");
    // Sitzung vorbei (Beginn vor zwei Stunden): Präsentation frei – wegen der Markierung nur Folie 1–2; keine Begriffshilfe mehr
    await setWhen(Date.now() - 120 * 60e3);
    await sp.goto(BASE + "/#/schueler/s/" + lessonId);
    await sp.getByRole("button", { name: "Präsentation (Folie 1–2) selbst öffnen" }).waitFor({ timeout: 10000 });
    ok(await sp.locator(".kihelp").count() === 0 && (await SA("POST", "/api/student/lessons/" + lessonId + "/ask", { question: "Und jetzt?", consent: true })).status === 403, "nach der Stunde: keine KI-Begriffshilfe mehr (auch serverseitig)");
    const pl = await SA("POST", "/api/student/lessons/" + lessonId + "/presentation-link", { inline: false });
    const cutRes = await fetch(BASE + pl.data.url), cutDoc = await PDFDocument.load(new Uint8Array(await cutRes.arrayBuffer()));
    ok(pl.data.url.includes("p=cut") && cutRes.status === 200 && cutDoc.getPageCount() === 2 && /Folie%201%E2%80%932|Folie 1–2/.test(cutRes.headers.get("content-disposition") || ""), "5 Minuten nach dem Ende: Schüler:innen bekommen nur Folie 1–2 (gekürzte PDF)");
    ok((await fetch(BASE + pl.data.url.replace("&p=cut", ""))).status === 403, "… die vollständige PDF bleibt auch mit verändertem Link gesperrt");
    await tp.locator(".thumbs .thumb").first().click({ button: "right" });
    await tp.locator(".ctxmenu").getByRole("menuitem", { name: "Markierung aufheben (alle Folien)" }).click();
    await tp.locator(".toast", { hasText: "Markierung aufgehoben" }).waitFor({ timeout: 15000 });
    const pl2 = await SA("POST", "/api/student/lessons/" + lessonId + "/presentation-link", { inline: false });
    ok(!pl2.data.url.includes("p=cut") && (await PDFDocument.load(new Uint8Array(await (await fetch(BASE + pl2.data.url)).arrayBuffer()))).getPageCount() === 3, "Markierung aufgehoben (Rechtsklick auf eine Folie): alle 3 Folien");
    await tp.locator("#shown-sel").selectOption("1");
    await tp.locator(".toast", { hasText: "nur Folie 1." }).waitFor({ timeout: 15000 });
    await sp.reload(); await sp.getByRole("button", { name: "Präsentation (Folie 1) selbst öffnen" }).waitFor({ timeout: 10000 });
    ok(true, "Auswahl „Folie 1“: Schüler:innen bekommen nur die erste Folie");

    await tp.locator(".portal-preview p", { hasText: "3) Partnerarbeit" }).click({ button: "right" });
    await tp.locator(".ctxmenu").getByRole("menuitem", { name: "Zwischenstopp einfügen" }).click();
    ok((await tp.inputValue("#portal")).includes("⏸ Zwischenstopp\n**3) Partnerarbeit**"), "Rechtsklick in der Vorschau → Zwischenstopp vor der Zeile");
    ok(await tp.locator(".portal-preview .stopfield").count() === 1, "als kleines Feld in der Vorschau");
    ok(await tp.locator("#stop-next").isVisible() && (await tp.locator("#stop-next").textContent()).startsWith("Zwischenstopp gesetzt.")
      && (await tp.locator("#stop-next").textContent()).includes("ob der offene Teil übernommen oder darauf verzichtet wird."), "Hinweis: beim Planen der nächsten Sitzung fragt Claude nach dem offenen Teil (Anforderung 13)");
    await tp.locator("#portal").click({ button: "right" });
    ok(await tp.locator(".ctxmenu").getByRole("menuitem", { name: /Zwischenstopp/ }).first().isVisible(), "Rechtsklick im Textfeld bietet den Zwischenstopp an");
    await tp.keyboard.press("Escape");
    await tp.locator("#portal").evaluate((el) => { el.value = el.value.replace("**2) Blitzlicht ohne iPad**", "**2) Blitzlicht ohne iPad**"); el.setSelectionRange(0, 0); });
    await tp.locator("#portal").click({ button: "right", position: { x: 10, y: 8 } });
    await tp.locator(".ctxmenu").getByRole("menuitem", { name: "Zwischenstopp einfügen" }).click();
    ok((await tp.inputValue("#portal")).split("Zwischenstopp").length === 2, "höchstens ein Zwischenstopp (verschoben statt doppelt)");
    await tp.locator(".portal-preview p", { hasText: "3) Partnerarbeit" }).click({ button: "right" });
    await tp.locator(".ctxmenu").getByRole("menuitem", { name: "Zwischenstopp einfügen" }).click();
    await tp.locator('.save-state[data-state="ok"]', { hasText: /^Gespeichert \d\d:\d\d/ }).first().waitFor({ timeout: 10000 });
    await tp.getByRole("button", { name: "Eintrag kopieren" }).click();
    const copied = await tp.evaluate(() => navigator.clipboard.readText());
    ok(!copied.includes("Zwischenstopp") && copied.includes("**3) Partnerarbeit**"), "beim Kopieren ins Schulportal wird der Zwischenstopp weggelassen");
    await sleep(1500);
    r = await T("GET", "/api/teacher/lessons/" + lessonId);
    ok(r.data.lesson.portal.includes("⏸ Zwischenstopp\n**3) Partnerarbeit**"), "Zwischenstopp dauerhaft in der Sitzung gespeichert");
    await tp.locator(".portal-preview p", { hasText: "3) Partnerarbeit" }).click({ button: "right" });
    await tp.locator(".ctxmenu").waitFor();
    await tp.locator("section.card").filter({ has: tp.locator("h2", { hasText: /^Schulportal-Eintrag$/ }) }).screenshot({ ...SHOT, path: join(OUT, "lehrkraft-zwischenstopp.png") });
    await tp.keyboard.press("Escape");
    await tp.locator(".homework").screenshot({ ...SHOT, path: join(OUT, "lehrkraft-hausaufgabe.png") });

    await tp.goto(BASE + "/#/lk/s/" + l2.id);
    await tp.locator(".prevstop").waitFor({ timeout: 10000 });
    ok(await tp.locator(".prevstop .stopfield").count() === 1 && (await tp.locator(".prevstop").textContent()).includes("Das Bundesverfassungsgericht"), "nächste Sitzung: Hinweis + Schulportal-Eintrag der letzten Stunde mit Zwischenstopp");
    await tp.locator(".prevstop").screenshot({ ...SHOT, path: join(OUT, "lehrkraft-hinweis-folgestunde.png") });
    {
      // Anforderung 13 (S11): „Nicht geschafft“ und Stand; der Prompt erklärt den offenen Teil und fragt; Entscheidung per Connector; Einheit verlängern
      const open = await tp.locator("#prevstop-open").textContent(), state = await tp.locator("#prevstop-state").textContent();
      ok(open.startsWith("Nicht geschafft: 3) Partnerarbeit") && state === "Beim Planen mit Claude („Stunde mit Claude planen“) erklärt Claude, was offen geblieben ist, und fragt Sie, ob es in diese Stunde übernommen oder darauf verzichtet wird. Danach passt Claude die Unterrichtseinheit an.",
        "Karte: „" + open + "“ und was beim Planen mit Claude passiert");
      await tp.getByRole("button", { name: "Stunde mit Claude planen" }).click();
      const sm = tp.locator(".modal", { hasText: "Welches Sprachmodell?" });
      await sm.waitFor();
      await sm.getByRole("button", { name: "Prompt kopieren" }).click();
      const sp2 = await tp.evaluate(() => navigator.clipboard.readText());
      ok(sp2.includes("## Vorige Stunde nicht vollständig beendet") && sp2.includes("Nicht geschafft (nach dem Zwischenstopp):\n<<<\n**3) Partnerarbeit**") && sp2.includes("Geschafft (bis zum Zwischenstopp):\n<<<\n**1) ")
        && sp2.includes("Frage mich, ob du es in diese Stunde einbauen sollst oder ob wir darauf verzichten.") && sp2.includes("\n2. Zur vorigen Stunde (Zwischenstopp, siehe oben)") && sp2.includes("\n3. Frage mich dann nach der Dauer")
        && sp2.includes("genau drei Vorschläge") && sp2.includes("`extend_unit`"), "Prompt der nächsten Sitzung: Geschafft/Nicht geschafft, Frage übernehmen oder verzichten, Einheit danach anpassen");
      await sm.getByRole("button", { name: "Schließen", exact: true }).getByText("Schließen").click();
      const gl2 = await tool("get_lesson", { lesson_id: l2.id });
      ok(gl2.content[0].text.includes("## Vorige Stunde nicht vollständig beendet") && gl2.content[0].text.includes("Entscheidung der Lehrkraft: noch nicht entschieden"), "get_lesson: Abschnitt zum offenen Teil (auch für einen Prompt von vorher)");
      ok(!(await tool("update_lesson", { lesson_id: l2.id, zwischenstopp: "uebernehmen" })).isError, "Claude hält die Entscheidung fest (update_lesson zwischenstopp)");
      await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await tp.locator("#prevstop-state", { hasText: "Der offene Teil wird in dieser Stunde übernommen." }).waitFor({ timeout: 10000 });
      ok((await tp.locator("#prevstop-state").textContent()).startsWith("Entschieden am "), "beim Zurückkehren: Karte zeigt „Entschieden am …: Der offene Teil wird in dieser Stunde übernommen.“");
      // extend_unit in einer eigenen kleinen Einheit (8A, wird danach gelöscht): eine Zeile mehr mit Termin und Sitzung, sofort in der Einheit sichtbar
      const xEnd = addDays(today, 13);
      const xu = (await T("POST", "/api/teacher/units", { subject: "powi", klass: "8A", title: "Verlängern", params: { start: today, end: xEnd, weekdays: [1, 2, 3, 4, 5].map((day) => ({ day, minutes: 45, time: "08:00" })) } })).data.unit;
      await T("PATCH", "/api/teacher/units/" + xu.id, { plan: { lernaufgabe: "Plakat", schritte: [] }, rows: [{ stundenfrage: "Erste", ablauf: ["a"] }, { stundenfrage: "Zweite", ablauf: ["b"] }], assignDates: true });
      await T("POST", "/api/teacher/units/" + xu.id + "/sessions", {});
      let xv = (await T("GET", "/api/teacher/units/" + xu.id)).data.unit;
      r = await tool("extend_unit", { unit_id: xu.id, base_version: xv.version, termine: 1, stunden: [{ stundenfrage: "Puffer: Rest der Partnerarbeit", ablauf: ["Partnerarbeit beenden", "Sicherung"] }] });
      xv = (await T("GET", "/api/teacher/units/" + xu.id)).data.unit;
      const xl = xv.lessons.find((l) => xv.rows[2] && l.row === xv.rows[2].uid);
      ok(!r.isError && xv.rows.length === 3 && xv.rows[2].date > xEnd && xv.params.end === xv.rows[2].date && xl && xl.date === xv.rows[2].date && r.content[0].text.includes("Sitzung " + xl.id + " angelegt."),
        "extend_unit: Ende auf den nächsten Termin nach dem bisherigen Ende, Zeile mit Termin und Sitzung (" + (r.content[0].text || "").slice(0, 120) + ")");
      await tp.goto(BASE + "/#/lk/u/" + xu.id);
      await tp.locator(".unit-table tbody tr").nth(2).waitFor({ timeout: 15000 });
      ok(await tp.locator(".unit-table tbody tr").count() === 3 && await tp.locator('textarea[aria-label="Stundenfrage 3"]').inputValue() === "Puffer: Rest der Partnerarbeit", "… sofort in der Einheit sichtbar");
      for (const l of xv.lessons) await T("DELETE", "/api/teacher/lessons/" + l.id);
      ok((await T("DELETE", "/api/teacher/units/" + xu.id)).status === 200, "Test-Einheit wieder gelöscht");
      await tp.goto(BASE + "/#/lk/s/" + l2.id); await tp.locator(".prevstop").waitFor({ timeout: 10000 });
    }
    await tp.goto(BASE + "/#/lk/s/" + l3.id);
    await tp.locator("#chatin").waitFor();
    ok(await tp.locator(".prevstop").count() === 0, "übernächste Sitzung: kein Hinweis (die direkt vorige Stunde endete normal)");
    await tp.goto(BASE + "/#/lk/f/powi/Q2-GK");
    await tp.locator(".prevstop").waitFor({ timeout: 10000 });
    ok(await tp.locator(".prevstop .stopfield").count() === 1, "beim Planen einer neuen Stunde: Hinweis auf die zuletzt gehaltene Stunde");

    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-klasse.png"), fullPage: true });
    await tp.goto(BASE + "/#/lk/s/" + l3.id);
    await tp.locator('input[aria-label="Datum der Sitzung"]').fill(addDays(l3.date, 1));
    await tp.locator(".toast", { hasText: "Datum geändert – auch in der Unterrichtseinheit." }).waitFor({ timeout: 10000 });
    ok(await tp.locator(".modal").count() === 0, "kein Dialog zum Mitverschieben folgender Sitzungen");
    unit = (await T("GET", "/api/teacher/units/" + unitId)).data.unit;
    ok(unit.rows[2].date === addDays(l3.date, 1) && unit.rows[1].date === l2.date && (await T("GET", "/api/teacher/lessons/" + byRow(3).id)).data.lesson.date === byRow(3).date, "nur diese Sitzung geändert, Datum steht auch in der Einheit");

    /* ---------- Krankheit: Vertretung ---------- */
    step("Krankheit: Vertretungsstunde mit Claude, prüfen, bestätigen, Schüleransicht, übernehmen, wiederherstellen");
    await T("POST", "/api/teacher/lessons/" + l2.id + "/texts", { area: "student", title: "Original-Arbeitsblatt", text: "# Original\nText", source: "chat" });
    await tp.goto(BASE + "/#/lk/s/" + l2.id);
    await tp.getByRole("button", { name: "Lehrkraft ist zu dieser Sitzung krank – Alternative entwickeln" }).click();
    const hm = tp.locator(".modal", { hasText: "Welches Sprachmodell?" });
    await hm.waitFor();
    ok(await hm.getByLabel(/Claude Opus/).isChecked() && await hm.getByText("Mit welchem Aufwand?").isVisible(), "fragt vorher Sprachmodell und Aufwand ab (Vorgabe: Opus, gründlich)");
    await hm.getByLabel(/^Maximal/).check();
    await hm.getByRole("button", { name: "Prompt kopieren" }).click();
    const subPrompt = await tp.evaluate(() => navigator.clipboard.readText());
    ok(["Welche fachdidaktische Kompetenz", "Welche Stundenfrage", "Welche Lerninhalte", "ca. 72 Minuten", l2.id, "save_substitute_plan", "chronologische Anleitung"].every((x) => subPrompt.includes(x)), "Prompt: Analyse der geplanten Stunde, 80 % der Zeit, Abgabe, Anleitung");
    await hm.getByRole("button", { name: "Schließen", exact: true }).getByText("Schließen").click();
    ok(await tp.evaluate(() => localStorage.getItem("u.claude.effort")) === "max", "Wahl von Modell/Aufwand wird gemerkt");
    const plan = { lesson_id: l2.id, analyse: { kompetenz: "Urteilskompetenz: die Rolle des BVerfG beurteilen", stundenfrage: "Wie arbeitet das Bundesverfassungsgericht?", inhalte: ["Verfahrensarten", "Normenkontrolle"] },
      format: "Feibeitsblatt", bearbeitungszeit: 70, hinweis_schueler: "Eure Lehrkraft ist heute krank. Arbeitet bitte selbstständig.",
      schritte: [{ titel: "Material lesen", anleitung: "Lies **M1** gründlich.", minuten: 20 }, { titel: "Feibeitsblatt bearbeiten", anleitung: "Öffne das Feibeitsblatt und bearbeite die Aufgabe.", minuten: 50, abgabe: true }],
      abgabe: "Feibeitsblatt bis zum Ende der Stunde abgeben", schulportal: "**1) Vertretung**\n- Selbstlernphase mit Feibeitsblatt", materialien: [{ titel: "M1 Verfahren des BVerfG", bereich: "schueler", markdown: "# M1\nNormenkontrolle …" }, { titel: "M2 Schaubild Normenkontrolle", bereich: "schueler", html: SHEET_HTML }],
      hinweise_vertretung: "Bitte für eine ruhige Arbeitsatmosphäre sorgen." };
    r = await tool("save_substitute_plan", plan);
    ok(r.isError && /braucht eine Abgabe/.test(r.content[0].text), "ohne Abgabe (Feibeitsblatt) lehnt die Plattform den Vorschlag ab");
    r = await tool("save_substitute_plan", { ...plan, feibeitsblatt: { titel: "Vertretung: Verfahren des BVerfG", aufgaben: [{ text: "Erkläre die Normenkontrolle.", ki_auftrag: "abstrakt und konkret unterscheiden" },
      { text: "Fotografiere dein Schaubild zu den Verfahren.", antwort: "foto", ki_auftrag: "darf nicht an die KI" }] } });
    ok(!r.isError, "Claude legt den Vertretungsvorschlag ab (save_substitute_plan), mit Foto-Aufgabe für das Lernprodukt");
    await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    const prop = tp.locator(".substitute", { hasText: "Vertretungsvorschlag prüfen" });
    await prop.waitFor({ timeout: 10000 });
    const propTxt = await prop.textContent();
    ok(propTxt.includes("Urteilskompetenz") && propTxt.includes("Material lesen") && propTxt.includes("Vertretung: Verfahren des BVerfG") && propTxt.includes("Ziel: ca. 72 Minuten"), "Vorschlag mit Analyse, Anleitung, Material und Feibeitsblatt zur Prüfung");
    const m2 = prop.locator(".item", { hasText: "M2 Schaubild Normenkontrolle" });
    ok((await m2.textContent()).includes("von Claude gestaltet, PDF entsteht beim Bestätigen"), "gestaltetes Vertretungsmaterial: PDF entsteht beim Bestätigen");
    dlp = tp.waitForEvent("download");
    await m2.getByRole("button", { name: "Vorschau als PDF" }).click();
    ok(readFileSync(await (await dlp).path()).toString("latin1").startsWith("%PDF-"), "… „Vorschau als PDF“ druckt es zur Ansicht");
    await SA("POST", "/api/student/join", { code: l2.code });
    const before = (await SA("GET", "/api/student/lessons/" + l2.id)).data;
    ok(!before.substitute && before.files.some((f) => f.name === "Original-Arbeitsblatt") && !(await tp.locator(".item", { hasText: "Anleitung zur Vertretungsstunde" }).count()), "vor der Bestätigung ändert sich nichts (auch nicht für Schüler:innen)");
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-vertretung-vorschlag.png"), fullPage: true });
    await tp.locator("#fbcard .badge.ok", { hasText: "verbunden" }).first().waitFor({ timeout: 20000 });   // gespeicherte Verbindung (automatisch)
    const sheetsBefore = fbm.sheets.size;
    await prop.getByRole("button", { name: "Bestätigen: Sitzung auf Vertretung umstellen" }).click();
    await tp.locator(".modal").getByRole("button", { name: "Bestätigen und umstellen" }).click();
    await tp.locator(".substitute.active").waitFor({ timeout: 20000 });
    const subSheet = [...fbm.sheets.values()].find((x) => x.title === "Vertretung: Verfahren des BVerfG");
    ok(fbm.sheets.size === sheetsBefore + 1 && subSheet, "Feibeitsblatt der Vertretung angelegt");
    ok(subSheet && subSheet.tasks[1].answer && subSheet.tasks[1].answer.type === "photo" && subSheet.tasks[1].solution === "" && subSheet.tasks[0].solution.includes("abstrakt") && subSheet.tasks[0].solution.split("Altersgemäße Erwartung (Q2, Grundkurs)").length === 2, "Foto-Aufgabe als Antwortart „Foto“ angelegt – ohne Auftrag an die KI");
    const jpeg = "data:image/jpeg;base64," + (await tp.screenshot({ type: "jpeg", quality: 40, clip: { x: 0, y: 0, width: 48, height: 32 } })).toString("base64");
    await fbm.addSubmission(subSheet.code, { vorname: "Lea", nachname: "Sc", geburtsdatum: "--03-04", klasse: "Q2GK" }, ["Die Normenkontrolle prüft Gesetze.", ""], [null, jpeg]);
    await tp.locator("#fbcard .item", { hasText: "Vertretung: Verfahren des BVerfG" }).getByRole("button", { name: "Abgaben ansehen" }).click();
    await tp.locator(".modal .sub", { hasText: "Lea Sc" }).waitFor({ timeout: 20000 });
    ok(await tp.locator(".modal img.sub-photo").count() === 1 && (await tp.locator(".modal img.sub-photo").getAttribute("src")).startsWith("data:image/jpeg;base64,/9j/"), "Abgaben: Foto der Schülerin wird angezeigt (geprüftes JPEG)");
    await tp.locator(".modal .sub").first().screenshot({ ...SHOT, path: join(OUT, "lehrkraft-abgabe-foto.png") });
    await tp.keyboard.press("Escape");
    const tSub = (await T("GET", "/api/teacher/lessons/" + l2.id)).data;
    ok(tSub.files.some((f) => f.area === "archive" && f.name === "Original-Arbeitsblatt") && tSub.files.some((f) => f.area === "student" && f.name === "Anleitung zur Vertretungsstunde") &&
      tSub.files.some((f) => f.area === "teacher" && f.name === "Hinweise für die Vertretungslehrkraft") && tSub.lesson.portal.startsWith("**1) Vertretung**"), "ursprüngliche Planung archiviert, Material und Schulportal-Eintrag ausgetauscht");
    await sp.goto(BASE + "/#/schueler/s/" + l2.id);
    const sbox = sp.locator(".substitute.student");
    await sbox.waitFor({ timeout: 10000 });
    const sTxt = await sp.locator("main").textContent();
    ok(sTxt.includes("Heute ohne deine Lehrkraft") && sTxt.includes("Eure Lehrkraft ist heute krank.") && (await sbox.locator(".sub-steps > li").count()) === 2, "Schüler:innen: Hinweis auf die Abwesenheit und chronologische Anleitung ganz oben");
    ok(sTxt.includes("Anleitung zur Vertretungsstunde") && sTxt.includes("M1 Verfahren des BVerfG") && sTxt.includes("Vertretung: Verfahren des BVerfG") && !sTxt.includes("Original-Arbeitsblatt"), "… mit dem Vertretungsmaterial und Feibeitsblatt (ursprüngliches Material ausgeblendet)");
    await tp.locator("#app .item", { hasText: "M2 Schaubild Normenkontrolle.pdf" }).locator(".meta", { hasText: "PDF, von Claude gestaltet" }).waitFor({ timeout: 30000 });
    ok((await SA("GET", "/api/student/lessons/" + l2.id)).data.files.some((f) => f.name === "M2 Schaubild Normenkontrolle.pdf"), "gestaltetes Vertretungsmaterial: nach dem Bestätigen gedruckt und für Schüler:innen sichtbar");
    await sp.screenshot({ ...SHOT, path: join(OUT, "schueler-vertretung.png"), fullPage: true });
    await tp.locator(".substitute.active").getByRole("button", { name: "Ursprüngliche Planung in eine andere Sitzung übernehmen" }).click();
    await tp.locator(".modal", { hasText: "Ursprüngliche Planung übernehmen" }).getByRole("button", { name: "Übernehmen" }).click();
    await tp.locator(".toast", { hasText: "übernommen" }).waitFor({ timeout: 10000 });
    ok((await T("GET", "/api/teacher/lessons/" + l3.id)).data.files.some((f) => f.name === "Original-Arbeitsblatt"), "ursprüngliche Planung in die nächste Sitzung übernommen");
    await tp.locator(".substitute.active").getByRole("button", { name: "Ursprüngliche Planung wiederherstellen" }).click();
    await tp.locator(".modal").getByRole("button", { name: "Wiederherstellen" }).click();
    await tp.locator(".toast", { hasText: "wiederhergestellt" }).waitFor({ timeout: 20000 });
    await sp.reload(); await sp.locator(".item", { hasText: "Original-Arbeitsblatt" }).waitFor({ timeout: 10000 });
    ok(await sp.locator(".substitute.student").count() === 0 && !(await sp.locator("main").textContent()).includes("Anleitung zur Vertretungsstunde"), "wiederhergestellt: ursprüngliche Planung wieder sichtbar, Vertretung entfernt");
    ok(!(await T("GET", "/api/teacher/lessons/" + l2.id)).data.files.some((f) => f.name === "M2 Schaubild Normenkontrolle.pdf"), "… auch das gestaltete Vertretungsmaterial ist entfernt");

    step("Krankheit mit Escape-Room: Vorschau, Bestätigen, Schüler:in spielt alle 6 Stationen, Überblick-PDF, Tunnel ins Feibeitsblatt");
    const escRoom = escapeFixture();
    r = await tool("save_substitute_plan", { ...plan, lesson_id: l3.id, format: "Escape-Room", escape_room: { ...escRoom, stationen: escRoom.stationen.slice(0, 5) } });
    ok(r.isError && /genau 6 Stationen/.test(r.content[0].text), "unvollständiger Escape-Room wird mit genauer Fehlerliste abgelehnt");
    r = await tool("save_substitute_plan", { ...plan, lesson_id: l3.id, format: "Escape-Room", schritte: [{ titel: "Escape-Room starten", anleitung: "Öffne den Escape-Room in der Sitzung.", minuten: 60, abgabe: true }], abgabe: "Finale im Feibeitsblatt abgeben", escape_room: escRoom });
    ok(!r.isError && r.content[0].text.includes("Lösungswort GERICH"), "Claude legt Vertretung mit Escape-Room ab");
    await tp.goto(BASE + "/#/lk/s/" + l3.id);
    const eprop = tp.locator(".substitute", { hasText: "Vertretungsvorschlag prüfen" });
    await eprop.waitFor({ timeout: 10000 });
    ok((await eprop.textContent()).includes("Escape-Room „Mission Gewaltenteilung“") && (await eprop.locator(".escbox ol li").count()) === 6, "Vorschlag zeigt den Escape-Room mit 6 Stationen");
    await eprop.getByRole("button", { name: "Escape-Room ansehen (Vorschau)" }).click();
    await tp.locator(".er .er-title", { hasText: "Mission Gewaltenteilung" }).waitFor({ timeout: 10000 });
    await tp.locator(".er-previewnav").getByRole("button", { name: "Finale" }).click();
    ok(await tp.locator(".er-gate").isDisabled() && (await tp.locator(".er-gate").textContent()).includes("Vorschau"), "Vorschau der Lehrkraft: alle Stationen ansehen, Tunnel gesperrt");
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-escape-vorschau.png"), fullPage: true });
    await tp.getByRole("button", { name: "Vorschau schließen" }).click();
    await tp.locator("#fbcard .badge.ok", { hasText: "verbunden" }).first().waitFor({ timeout: 20000 });
    await tp.locator(".substitute", { hasText: "Vertretungsvorschlag prüfen" }).getByRole("button", { name: "Bestätigen: Sitzung auf Vertretung umstellen" }).click();
    await tp.locator(".modal").getByRole("button", { name: "Bestätigen und umstellen" }).click();
    await tp.locator(".substitute.active").waitFor({ timeout: 20000 });
    const escSheet = [...fbm.sheets.values()].find((x) => x.title === "Finale: Mission Gewaltenteilung");
    ok(escSheet && escSheet.escape && /^unterricks-[a-f0-9]{8}-[a-f0-9]{6}$/.test(escSheet.escape.id) && escSheet.escape.name === "Mission Gewaltenteilung", "Finale-Feibeitsblatt mit Escape-Kennung angelegt");
    await sleep(1500);
    const nfEsc = await fetch(BASE + "/api/teacher/lessons/" + l3.id + "/sheets/" + escSheet.code + "/notfall?sig=v1", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/pdf" }, body: Buffer.from("%PDF-1.4 test") });
    ok(!(await T("GET", "/api/teacher/lessons/" + l3.id)).data.files.some((f) => f.fbCode === escSheet.code) && nfEsc.status === 400
      && !(await T("GET", "/api/teacher/notfall")).data.items.some((x) => x.code === escSheet.code), "Finale eines Escape-Rooms: kein Notfall-Feibeitsblatt (auch nicht per Schnittstelle, nicht beim Nachholen)");
    await SA("POST", "/api/student/join", { code: l3.code });
    ok(!(await SA("GET", "/api/student/lessons/" + l3.id)).data.sheets.some((x) => x.code === escSheet.code), "Escape-Finale erscheint nicht als normales Feibeitsblatt (nur über den Tunnel)");
    await sp.goto(BASE + "/#/schueler/s/" + l3.id);
    await sp.getByRole("link", { name: "Escape-Room starten" }).click();
    await sp.locator(".er-title", { hasText: "Mission Gewaltenteilung" }).waitFor({ timeout: 10000 });
    await sp.fill("#er-fn", "Anna"); await sp.fill("#er-ln", "Muster"); await sp.fill("#er-bd", "07032009");
    ok(await sp.inputValue("#er-bd") === "07.03.2009" && await sp.inputValue("#er-kl") === "Q2 GK", "Geburtsdatum wird beim Tippen formatiert, Kurs vorausgefüllt");
    await sp.getByRole("button", { name: "Weiter zum Auftrag" }).click();
    await sp.locator(".er-title", { hasText: "Willkommen" }).waitFor({ timeout: 10000 }).catch(async (e) => {
      await sp.screenshot({ ...SHOT, path: join(OUT, "fehler-escape-anmeldung.png"), fullPage: true });
      console.log("    Anmeldung im Escape-Room:", JSON.stringify(await sp.locator(".er-err").allTextContents()), pageErrors.join(" | "));
      throw e;
    });
    await sp.getByRole("button", { name: "Erste Bibliothek betreten" }).click();
    const solve = async (i) => {
      const st = escRoom.stationen[i];
      await sp.locator(".er-warnbar").waitFor();
      if (i === 1) ok((await sp.locator(".er-sec").count()) === 3, "Bibliothek mit nummerierten Abschnitten und Warnung „kein Weg zurück“");
      await sp.getByRole("button", { name: "Zum Rätselraum: " + st.titel }).click();
      await sp.locator(".er-part").first().waitFor();
      for (const t of st.raetsel.teile) {
        if (t.typ === "einfachwahl") await sp.locator(".er-opt", { hasText: t.optionen.find((o) => o.richtig).text }).click();
        else if (t.typ === "mehrfachwahl") { for (const o of t.optionen.filter((x) => x.richtig)) await sp.locator(".er-opt", { hasText: o.text }).click(); }
        else if (t.typ === "zuordnung") { for (const z of t.zeilen) await sp.locator(".er-assign").filter({ has: sp.locator("span", { hasText: new RegExp("^" + z.text + "$") }) }).locator("select").selectOption(z.antwort); }
        else if (t.typ === "koerbe") { for (const c of t.karten) await sp.locator(".er-bcard").filter({ has: sp.locator("span", { hasText: new RegExp("^" + c.text + "$") }) }).getByRole("button", { name: t.koerbe[c.korb - 1].name, exact: true }).click(); }
        else if (t.typ === "luecken") { for (const [k, g] of t.luecken.entries()) { const el = sp.locator('[aria-label="Lücke ' + (k + 1) + '"]'); if (t.wortbank) await el.selectOption(g.loesungen[0]); else await el.fill(g.loesungen[0]); } }
        else await sp.locator(".er-in").fill(t.typ === "zahl" ? "ca. 16 Richter:innen" : "gericht");
      }
      await sp.getByRole("button", { name: "Prüfen" }).click();
      await sp.locator(".er-reveal").waitFor({ timeout: 10000 });
      if (i === 1) ok((await sp.locator(".er-letter").textContent()) === "E", "gelöster Raum verrät den nächsten Buchstaben des Lösungsworts");
      await sp.locator(".er-reveal").getByRole("button").click();
    };
    // Station 1: erst falsch (Fehler im ersten Versuch, Hilfe Stufe 1), dann unvollständig, dann richtig
    await sp.locator(".er-warnbar").waitFor();
    await sp.getByRole("button", { name: "Zum Rätselraum: " + escRoom.stationen[0].titel }).click();
    await sp.getByRole("button", { name: "Prüfen" }).click();
    ok((await sp.locator(".er-status").textContent()).includes("Noch unvollständig"), "unvollständig: kein Versuch, klare Meldung");
    await sp.locator(".er-opt", { hasText: "Die Bundesregierung" }).click();
    for (const c of escRoom.stationen[0].raetsel.teile[1].karten) await sp.locator(".er-bcard").filter({ has: sp.locator("span", { hasText: new RegExp("^" + c.text + "$") }) }).getByRole("button", { name: "Legislative", exact: true }).click();
    await sp.getByRole("button", { name: "Prüfen" }).click();
    await sp.locator(".er-help").waitFor();
    const help1 = await sp.locator(".er-help").textContent();
    ok(help1.includes("Stufe 1 von 3: Wo stand es?") && help1.includes("Abschnitt 1 – Thema 1") && (await sp.locator(".er-opt.bad").count()) === 1, "Hilfe Stufe 1 (wo es stand), falsche Antwort rot markiert");
    await sleep(800);   // ein zweiter Tipp innerhalb von 0,7 s auf denselben Stand zählt nicht
    await sp.getByRole("button", { name: "Prüfen" }).click();
    ok((await sp.locator(".er-help").textContent()).includes("Stufe 2 von 3") && (await sp.locator(".er-help").textContent()).includes("„Der Bu …“"), "Hilfe Stufe 2 (Anfang der Antwort)");
    await sp.screenshot({ ...SHOT, path: join(OUT, "schueler-escape-hilfe.png"), fullPage: true });
    await sp.locator(".er-opt", { hasText: "Der Bundestag" }).click();
    for (const c of escRoom.stationen[0].raetsel.teile[1].karten.filter((x) => x.korb === 2)) await sp.locator(".er-bcard").filter({ has: sp.locator("span", { hasText: new RegExp("^" + c.text + "$") }) }).getByRole("button", { name: "Judikative", exact: true }).click();
    await sp.getByRole("button", { name: "Prüfen" }).click();
    await sp.locator(".er-reveal").waitFor({ timeout: 10000 });
    await sp.locator(".er-reveal").getByRole("button").click();
    for (let i = 1; i < 6; i++) await solve(i);
    await sp.locator(".er-arena").waitFor({ timeout: 10000 });
    ok((await sp.locator(".er-tiles.big").textContent()) === "GERICH" && await sp.locator(".er-ci.on").count() === 6, "Finale: Lösungswort aus den sechs Buchstaben");
    await sp.screenshot({ ...SHOT, path: join(OUT, "schueler-escape-finale.png"), fullPage: true });
    const [dlo] = await Promise.all([sp.waitForEvent("download"), sp.getByRole("button", { name: "Überblick als PDF herunterladen" }).click()]);
    const ovPath = join(OUT, "escape-ueberblick.pdf"); await dlo.saveAs(ovPath);
    const ovBytes = (await import("node:fs")).readFileSync(ovPath).toString("latin1");
    ok(ovBytes.startsWith("%PDF-") && /\/FbEscape 1\b/.test(ovBytes) && ovBytes.includes('"kind":"feibeitsblatt-escape"') && ovBytes.includes("/EmbeddedFiles"), "Überblick-PDF mit eingebettetem Datensatz (/FbEscape 1) zum Fortsetzen im Feibeitsblatt");
    const [dls] = await Promise.all([sp.waitForEvent("download"), sp.getByRole("button", { name: "Zwischenstand als Datei speichern" }).last().click()]);
    ok(/^Zwischenstand zum Escape-Room Mission Gewaltenteilung vom .* von Anna Muster\.txt$/.test(dls.suggestedFilename()), "Zwischenstand als Datei");
    await sp.locator(".er-gate").click();
    await sp.waitForURL(/#escape=/, { timeout: 15000 });
    const hullTxt = Buffer.from(decodeURIComponent(sp.url().split("#escape=")[1]).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const hull = JSON.parse(hullTxt), rec = JSON.parse(hull.d);
    const { fbEscapeHash } = await import("../../public/escape-data.js");
    ok(sp.url().startsWith(FB + "/#escape=") && hull.kind === "feibeitsblatt-escape" && hull.v === 1 && hull.s === fbEscapeHash("FbEscape|v1|" + hull.d), "Tunnel: Hülle v1 mit gültiger Prüfsumme an die Feibeitsblatt-Adresse");
    ok(rec.code === escSheet.code && rec.room.id === escSheet.escape.id && rec.word === "GERICH" && rec.person.vorname === "Anna" && rec.person.geburtsdatum === "07.03.2009" && rec.person.klasse === "Q2GK" &&
      rec.stations.length === 6 && rec.stations[0].attempts === 3 && rec.stations[0].errors.length === 3 && rec.stations[1].attempts === 1 && rec.notes.length === 6 && /^\d+$/.test(rec.confirm), "Datensatz: Code, Raum, Person, Versuche und Fehler im ersten Versuch, Erläuterungen");

    step("Jahrgang 6: analog (keine Feibeitsblätter, kein digitales Arbeiten); PoWi nicht in Jahrgang 7");
    ok((await T("POST", "/api/teacher/units", { subject: "powi", klass: "7A" })).status === 400, "PoWi-Einheit in Jahrgang 7 abgelehnt");
    const u6 = (await T("POST", "/api/teacher/units", { subject: "powi", klass: "6A", title: "Kinderrechte", params: { start: today, end: addDays(today, 6), weekdays: [1, 2, 3, 4, 5].map((day) => ({ day, minutes: 45 })) } })).data.unit;
    await T("PATCH", "/api/teacher/units/" + u6.id, { plan: { lernaufgabe: "Plakat zu Kinderrechten", schritte: [{ titel: "Rechte kennen", beschreibung: "Bilder deuten" }] }, rows: [{ stundenfrage: "Welche Rechte haben Kinder?", ablauf: ["Bilder"] }], assignDates: true });
    const l6 = (await T("POST", "/api/teacher/units/" + u6.id + "/sessions")).data.unit.lessons[0];
    r = await tool("save_substitute_plan", { ...plan, lesson_id: l6.id, feibeitsblatt: { titel: "x", aufgaben: [{ text: "y" }] } });
    ok(r.isError && /Jahrgängen 5 und 6/.test(r.content[0].text), "Vertretung in Jg. 6 mit Feibeitsblatt abgelehnt");
    r = await tool("save_substitute_plan", { ...plan, lesson_id: l6.id, abgabe: "Arbeitsblatt bei der Vertretungslehrkraft abgeben" });
    ok(!r.isError, "analoge Vertretung (ausdruckbares Material) möglich");
    await tp.goto(BASE + "/#/lk/s/" + l6.id);
    await tp.locator("#fbcard").waitFor();
    ok((await tp.locator("#fbcard").textContent()).includes("keine iPads") && await tp.locator("#fbcard").getByRole("button", { name: "Verbinden" }).count() === 0, "Sitzungsansicht Jg. 6: kein Feibeitsblatt, Hinweis auf analoges Material");
    ok((await tp.locator(".substitute").textContent()).includes("Abgabe auf Papier"), "Vertretungsvorschlag Jg. 6 ohne Feibeitsblatt");
    const l6sys = ai.calls.length;
    await tp.fill("#chatin", "Bitte ein Arbeitsblatt."); await tp.keyboard.press("Enter");
    await tp.locator(".msg.assistant", { hasText: "Ihre Nachricht war: Bitte ein Arbeitsblatt" }).waitFor({ timeout: 20000 });
    ok(ai.calls.length > l6sys && ai.calls[ai.calls.length - 1].messages[0].content.includes("keine iPads"), "Planungsassistent plant für Jg. 6 nur analoge Materialien");

    /* ---------- Ev. Religion/Ethik: ein Kurs je Jahrgang mit Schüler:innen aus mehreren Klassen ---------- */
    step("Ethik: Kurs Jg. 7 über mehrere Klassen (Lehrkraft wählt die Klassen, Schüler:innen wählen ihre Klasse)");
    // wie bisher üblich: eine Einheit mit einer Stunde in der Klasse 7A (Sitzungen entstehen aus den Zeilen der Einheit)
    const u7a = (await T("POST", "/api/teacher/units", { subject: "ethik", klass: "7A", title: "Gerechtigkeit" })).data.unit;
    await T("PATCH", "/api/teacher/units/" + u7a.id, { plan: { lernaufgabe: "Ein gerechtes Klassenzimmer entwerfen", schritte: [{ titel: "Was ist gerecht?", beschreibung: "Beispiele sammeln" }] },
      rows: [{ stundenfrage: "Was ist gerecht?", date: today, minutes: 45, ablauf: ["Beispiele sammeln"], schritt: 0 }] });
    const made7a = await T("POST", "/api/teacher/units/" + u7a.id + "/sessions");
    const old7a = (made7a.data.unit.lessons || [])[0];
    ok(made7a.status === 200 && old7a && (await T("GET", "/api/teacher/lessons/" + old7a.id)).data.lesson.klass === "7A", "Vorbereitung: Sitzung einer Einheit in der Klasse 7A");
    await tp.goto(BASE + "/#/lk/f/ethik");
    const g7 = tp.locator(".class-group").filter({ has: tp.locator("h3", { hasText: /^Jahrgangsstufe 7$/ }) });
    await g7.getByRole("button", { name: "Kurs anlegen" }).waitFor();
    ok(await g7.locator(".class-btn").count() === 0 && await g7.locator("a", { hasText: "7A (1)" }).count() === 1, "Ethik Jg. 7: ein Kurs statt einzelner Klassen; die ältere Sitzung in 7A bleibt erreichbar");
    await g7.getByRole("button", { name: "Kurs anlegen" }).click();
    const cm = tp.locator(".modal");
    await cm.getByRole("button", { name: "Kurs anlegen" }).click();
    ok(await cm.locator(".err", { hasText: "mindestens eine Klasse" }).count() === 1, "ohne Klasse kein Kurs");
    await cm.getByRole("button", { name: "7A", exact: true }).click(); await cm.getByRole("button", { name: "7C", exact: true }).click();
    await cm.getByRole("button", { name: "Kurs anlegen" }).click();
    await tp.waitForURL(/#\/lk\/f\/ethik\/7-K$/);
    await tp.locator(".pagehead h1", { hasText: "Ethik · Kurs Jg. 7" }).waitFor();
    ok(await tp.locator(".pagehead .pagesub", { hasText: "Klassen 7A, 7C" }).count() === 1, "Kurs Jg. 7 mit den gewählten Klassen 7A, 7C angelegt");
    const moved7 = (await T("GET", "/api/teacher/lessons/" + old7a.id)).data.lesson;
    ok(moved7.klass === "7-K" && (await T("GET", "/api/teacher/units/" + u7a.id)).data.unit.klass === "7-K", "Sitzung und Einheit aus 7A sind in den Kurs umgezogen");
    const kursStudent = async (klass) => {
      const lg = await (await fetch(BASE + "/api/student/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "Feindt", deviceId: "e2e-kurs-" + klass + "-" + Math.random().toString(36).slice(2) }) })).json();
      await fetch(BASE + "/api/student/profile", { method: "PUT", headers: { Authorization: "Bearer " + lg.token, "Content-Type": "application/json" }, body: JSON.stringify({ klass, subject: "ethik" }) });
      return lg.token;
    };
    const kursJoin = async (tok, code) => { const x = await fetch(BASE + "/api/student/join", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ code }) }); return { status: x.status, data: await x.json() }; };
    ok((await kursJoin(await kursStudent("7C"), moved7.code)).status === 200, "Schüler:in aus 7C öffnet die Sitzung des Kurses");
    const j7b = await kursJoin(await kursStudent("7B"), moved7.code);
    ok(j7b.status === 403 && j7b.data.error.includes("Kurs Jg. 7") && j7b.data.error.includes("7B"), "7B gehört nicht zum Kurs: klare Meldung (" + j7b.data.error + ")");
    await tp.goto(BASE + "/#/lk/f/ethik");
    await g7.getByRole("button", { name: "Klassen ändern" }).click();
    await cm.getByRole("button", { name: "7B", exact: true }).click(); await cm.getByRole("button", { name: "Speichern" }).click();
    await g7.locator(".course-members", { hasText: "Klassen 7A, 7B, 7C" }).waitFor();
    ok((await kursJoin(await kursStudent("7B"), moved7.code)).status === 200, "nach dem Ändern: Schüler:in aus 7B kommt hinein");
    await tp.goto(BASE + "/#/lk/s/" + old7a.id);
    await tp.locator(".hint", { hasText: "eine der Klassen 7A, 7B, 7C und Ethik gewählt haben" }).waitFor({ timeout: 15000 });
    ok(await tp.locator(".pagehead .chip", { hasText: "Kurs Jg. 7" }).count() === 1, "Sitzungsseite: Kurs Jg. 7 und die Klassen beim Code");
    ok((await T("PUT", "/api/teacher/subjects/powi", { courses: { "8": ["8A"] } })).status === 400, "Politik und Wirtschaft: keine Kurse über mehrere Klassen");

    /* ---------- Kurseinstellungen (alle Kurse): Stundenplan und Schülerzahl ---------- */
    step("Kurseinstellungen (alle Kurse): Stundenplan und Schülerzahl; neue Einheit übernimmt den Stundenplan; Claude kennt die Schülerzahl");
    {
      await tp.goto(BASE + "/#/lk/f/ethik/7-K");
      const csCard = tp.locator("section.cs-card");
      await csCard.locator("h2", { hasText: "Kurseinstellungen" }).waitFor({ timeout: 15000 });
      ok(await csCard.locator("legend", { hasText: "Wann findet der Kurs statt?" }).count() === 1 && await csCard.getByLabel("Schülerzahl", { exact: true }).count() === 1, "Klassenseite 7-K: Karte „Kurseinstellungen“ mit Stundenplan und Schülerzahl");
      await csCard.getByRole("button", { name: "+ Termin pro Woche" }).click();
      await csCard.getByLabel("Wochentag des Termins 1").selectOption("1");
      await csCard.getByLabel("Beginn des Termins 1 (Uhrzeit)").fill("08:00");
      await csCard.getByLabel("Dauer des Termins 1 in Minuten").fill("45");
      await csCard.getByRole("button", { name: "+ Termin pro Woche" }).click();
      await csCard.getByLabel("Wochentag des Termins 2").selectOption("3");
      await csCard.getByLabel("Beginn des Termins 2 (Uhrzeit)").fill("09:50");
      await csCard.getByLabel("Dauer des Termins 2 in Minuten").fill("90");
      await csCard.getByLabel("Schülerzahl", { exact: true }).fill("24");
      await csCard.getByRole("button", { name: "Kurseinstellungen speichern" }).click();
      await tp.locator(".toast", { hasText: "Kurseinstellungen gespeichert." }).waitFor({ timeout: 10000 });
      const cs7 = (await T("GET", "/api/teacher/course-settings?subject=ethik&klass=7-K")).data.settings;
      const WD7 = [{ day: 1, minutes: 45, time: "08:00" }, { day: 3, minutes: 90, time: "09:50" }];
      ok(JSON.stringify(cs7.weekdays) === JSON.stringify(WD7) && cs7.classSize === 24, "gespeichert: Mo 08:00 (45 Min.), Mi 09:50 (90 Min.), 24 Schüler:innen");
      ok((await T("PUT", "/api/teacher/course-settings", { subject: "ethik", klass: "7-K", weekdays: WD7, classSize: 61 })).data.error === "Die Schülerzahl muss zwischen 1 und 60 liegen.", "Schülerzahl über 60 abgelehnt");
      await tp.reload();
      await csCard.getByLabel("Beginn des Termins 2 (Uhrzeit)").waitFor({ timeout: 15000 });
      ok(await csCard.getByLabel("Schülerzahl", { exact: true }).inputValue() === "24" && await csCard.getByLabel("Beginn des Termins 2 (Uhrzeit)").inputValue() === "09:50", "nach dem Neuladen wieder da");
      // ungültige Dauer: Hinweis statt still weggelassenem Termin, nichts gespeichert
      await csCard.getByLabel("Dauer des Termins 2 in Minuten").fill("10");
      await csCard.getByRole("button", { name: "Kurseinstellungen speichern" }).click();
      await csCard.getByText("Termin 2: Bitte eine Dauer zwischen 20 und 240 Minuten eintragen.").waitFor({ timeout: 10000 });
      ok(await tp.evaluate(() => document.activeElement && document.activeElement.getAttribute("aria-label")) === "Dauer des Termins 2 in Minuten"
        && JSON.stringify((await T("GET", "/api/teacher/course-settings?subject=ethik&klass=7-K")).data.settings.weekdays) === JSON.stringify(WD7), "Dauer 10 Minuten: Hinweis beim Termin, Fokus im Feld, nichts gespeichert");
      // neue Einheit: übernimmt den Stundenplan (der Knopf zum Übernehmen fehlt, weil beide gleich sind)
      await tp.fill("#ut", "Verantwortung");
      await tp.getByRole("button", { name: "Einheit anlegen" }).click();
      await tp.waitForURL(/#\/lk\/u\/[a-f0-9]{16}$/);
      await tp.locator('select[aria-label="Wochentag"]').first().waitFor({ timeout: 15000 });
      const dayVals = await tp.locator('select[aria-label="Wochentag"]').evaluateAll((els) => els.map((e) => e.value));
      const minVals = await tp.locator('input[aria-label="Minuten"]').evaluateAll((els) => els.map((e) => e.value));
      const timeVals = await tp.locator('input[aria-label="Uhrzeit (Beginn)"]').evaluateAll((els) => els.map((e) => e.value));
      ok(JSON.stringify([dayVals, minVals, timeVals]) === JSON.stringify([["1", "3"], ["45", "90"], ["08:00", "09:50"]]), "neue Einheit hat die zwei Termine aus den Kurseinstellungen");
      ok(await tp.getByRole("button", { name: "Stundenplan aus den Kurseinstellungen übernehmen" }).count() === 0, "Knopf „Stundenplan aus den Kurseinstellungen übernehmen“ fehlt, wenn der Stundenplan gleich ist");
      // ältere Einheit (vor den Kurseinstellungen angelegt): Übernehmen per Knopf
      await tp.goto(BASE + "/#/lk/u/" + u7a.id);
      const take = tp.getByRole("button", { name: "Stundenplan aus den Kurseinstellungen übernehmen" });
      await take.waitFor({ timeout: 15000 });
      await take.click();
      await tp.getByText("Übernommen – zum Speichern „Speichern und Termine berechnen“ wählen.").waitFor();
      ok(await tp.locator('select[aria-label="Wochentag"]').count() === 2 && await take.count() === 0, "ältere Einheit: Stundenplan übernommen (noch nicht gespeichert)");
      // Claude kennt die Schülerzahl
      const gl = await tool("get_lesson", { lesson_id: old7a.id });
      ok(gl.content[0].text.includes("\nSchülerzahl laut Kurseinstellungen: 24\n"), "get_lesson einer Sitzung des Kurses: „Schülerzahl laut Kurseinstellungen: 24“");
      const tl = (await rpc({ jsonrpc: "2.0", id: 31, method: "tools/list", params: {} })).data.result.tools;
      ok(tl.find((t) => t.name === "add_material_pdf").description.includes("Standard: Schülerzahl laut Kurseinstellungen (siehe get_lesson)"), "add_material_pdf: anzahl standardmäßig aus den Kurseinstellungen");
      const am = await tool("add_material_pdf", { lesson_id: old7a.id, bereich: "druck", titel: "Gerechtigkeitskärtchen", html: "<h1>Gerecht oder ungerecht?</h1><p>Kärtchen</p>" });
      ok(!am.isError && am.content[0].text.includes("„24x - beidseitig - sw - Gerechtigkeitskärtchen.pdf“"), "add_material_pdf (druck) ohne anzahl: " + am.content[0].text.slice(0, 160));
      const pf = (await T("GET", "/api/teacher/lessons/" + old7a.id)).data.files.find((f) => f.area === "print" && f.name.startsWith("Gerechtigkeitskärtchen"));
      ok(pf && pf.printName.startsWith("24x - "), "Druckliste: „" + (pf && pf.printName) + "“");
    }

    step("Planungsgrundlagen: Original-PDF in neuem Tab, ältere nur als Text; Ev. Religion Jg. 1–4");
    let txtBaseId = null;
    {
      // a) Einheit Q2 GK: die Planungsgrundlagen sind Links in einen neuen Tab; KCGO und Erlass wurden über die Oberfläche hochgeladen → Original-PDF
      await tp.goto(BASE + "/#/lk/u/" + unitId);
      const bl = tp.locator("section.card", { hasText: "2. Planungsgrundlagen" }).locator("a.baselink").first();
      await bl.waitFor({ timeout: 15000 });
      ok(await bl.getAttribute("target") === "_blank" && /^#\/lk\/grundlage\/[a-f0-9]{16}$/.test(await bl.getAttribute("href")) && /\(S\. [0-9–, ]+\)/.test(await bl.textContent())
        && (await bl.textContent()).includes("(öffnet in neuem Tab)"), "Einheit: Planungsgrundlage als Link in einen neuen Tab („" + (await bl.textContent()) + "“)");
      const baseReq = tctx.waitForEvent("request", { predicate: (q) => q.url().includes("/api/base/"), timeout: 20000 }).catch(() => null);
      const [np] = await Promise.all([tctx.waitForEvent("page"), bl.click()]);
      const q = await baseReq, res = q ? await fetch(q.url()) : null;
      ok(res && res.status === 200 && res.headers.get("content-type") === "application/pdf" && /^inline/.test(res.headers.get("content-disposition") || "")
        && Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString() === "%PDF-", "neuer Tab öffnet die Original-PDF (signierter Link /api/base/…)");
      await np.close().catch(() => {});
      // b) ältere Planungsgrundlagen (nur Text, z. B. vor dieser Erweiterung hochgeladen) – hier über die Schnittstelle angelegt
      const mk = async (title, scope, texts) => {
        const b = (await T("POST", "/api/teacher/bases", { subject: "ethik", kind: "sonstiges", title, scope, pages: texts.length, fileName: title + ".pdf" })).data.base;
        await T("PUT", "/api/teacher/bases/" + b.id + "/pages", { from: 1, texts });
        return b;
      };
      const txt = await mk("Fachkonferenzbeschluss Ethik", ["Q4-LK"], ["Beschluss der Fachkonferenz\nIn Q4 wird das Thema Verantwortung vertieft.", "Seite zwei:\nLeistungsbewertung"]);
      txtBaseId = txt.id;
      const tp2 = await tctx.newPage(); watch(tp2, "Lehrkraft (Textseite)");
      await tp2.goto(BASE + "/#/lk/grundlage/" + txt.id);
      await tp2.locator("section#seite-2 h2", { hasText: "Seite 2" }).waitFor({ timeout: 20000 });
      ok(await tp2.locator("h1", { hasText: "Fachkonferenzbeschluss Ethik" }).count() === 1 && await tp2.locator("section#seite-1 h2").textContent() === "Seite 1"
        && await tp2.locator("section#seite-1 .basetext").textContent() === "Beschluss der Fachkonferenz\nIn Q4 wird das Thema Verantwortung vertieft."
        && await tp2.getByText("Für diese Planungsgrundlage ist nur der Text gespeichert (so liest ihn auch die KI). Laden Sie unter „Planungsgrundlagen“ mit „Original-PDF hinzufügen“ dieselbe PDF hoch – dann öffnet sich hier das Original.").count() === 1
        && await tp2.getByText("Sonstige Vorgabe · 2 Seiten").count() === 1, "ältere Planungsgrundlage ohne PDF: Textseite mit „Seite 1“, „Seite 2“ und dem Hinweis");
      await tp2.getByLabel("Zu Seite springen").fill("2"); await tp2.getByLabel("Zu Seite springen").press("Enter");
      ok(await tp2.evaluate(() => document.activeElement && document.activeElement.id) === "seite-2", "„Zu Seite springen“ führt zu Seite 2");
      await tp2.close();
      // c) „Original-PDF hinzufügen“: nur dieselbe Datei (gleiche Seitenzahl); danach öffnet sich das Original
      const add = await mk("Fachkonferenzbeschluss Ethik (alt)", ["Q3-LK"], ["Alt eins", "Alt zwei"]);
      await tp.goto(BASE + "/#/lk/grundlagen/ethik");
      const item = tp.locator(".item", { hasText: "Fachkonferenzbeschluss Ethik (alt)" });
      await item.waitFor({ timeout: 15000 });
      ok(await tp.getByRole("button", { name: /hochladen/i }).count() === 1 && await item.getByText("nur Text gespeichert").count() === 1, "Dokumente: „nur Text gespeichert“; kein weiterer Knopf mit „Hochladen“");
      let [fc] = await Promise.all([tp.waitForEvent("filechooser"), item.getByRole("button", { name: /^Original-PDF hinzufügen/ }).click()]);
      await fc.setFiles({ name: "Beschluss.pdf", mimeType: "application/pdf", buffer: await textPdf([["Eins"], ["Zwei"], ["Drei"]]) });
      await tp.locator(".toast", { hasText: "Diese PDF hat 3 Seiten, gespeichert sind 2. Bitte dieselbe Datei wählen." }).waitFor({ timeout: 15000 });
      ok(!(await T("GET", "/api/teacher/bases/" + add.id)).data.base.pdf, "falsche Seitenzahl: abgelehnt, nichts gespeichert");
      const addPdf = await textPdf([["Alt eins"], ["Alt zwei"]]);
      [fc] = await Promise.all([tp.waitForEvent("filechooser"), item.getByRole("button", { name: /^Original-PDF hinzufügen/ }).click()]);
      await fc.setFiles({ name: "Beschluss.pdf", mimeType: "application/pdf", buffer: addPdf });
      await tp.locator(".toast", { hasText: "Original-PDF zu „Fachkonferenzbeschluss Ethik (alt)“ gespeichert." }).waitFor({ timeout: 15000 });
      await item.getByRole("button", { name: /^Original-PDF ersetzen/ }).waitFor({ timeout: 10000 });
      const lk = (await T("POST", "/api/teacher/bases/" + add.id + "/link", {})).data;
      const got = await fetch(BASE + lk.url);
      ok(got.status === 200 && Buffer.compare(Buffer.from(await got.arrayBuffer()), addPdf) === 0 && (await T("GET", "/api/teacher/bases/" + add.id)).data.base.pdfSize === addPdf.length,
        "richtige Datei: Original-PDF gespeichert, der Link liefert sie byte-genau; Knopf heißt jetzt „Original-PDF ersetzen“");
      ok((await T("DELETE", "/api/teacher/bases/" + add.id)).status === 200 && (await fetch(BASE + lk.url)).status === 404, "Löschen entfernt auch die Original-PDF");
      // d) Ev. Religion: Schulcurriculum der Grundschule (Jahrgänge 1–4)
      await tp.goto(BASE + "/#/lk/grundlagen/powi");
      await tp.locator('select[aria-label="Art der Planungsgrundlage"]').waitFor({ timeout: 15000 });
      ok(!(await tp.locator('select[aria-label="Art der Planungsgrundlage"] option').evaluateAll((o) => o.map((x) => x.value))).includes("gs-curriculum"), "Politik und Wirtschaft: keine Art „Schulcurriculum Grundschule“");
      await tp.goto(BASE + "/#/lk/grundlagen/evrel");
      await tp.locator('select[aria-label="Art der Planungsgrundlage"]').selectOption("gs-curriculum");
      await tp.getByText("Fachcurriculum der Grundschule für die Jahrgänge 1–4.", { exact: false }).waitFor();
      ok(await tp.getByLabel("Jg. 1", { exact: true }).count() === 1 && await tp.getByLabel("Jg. 4", { exact: true }).count() === 1 && await tp.getByText("Optional: nur für diese Jahrgänge (leer = nach den erkannten Abschnitten).").count() === 1, "Geltungsbereich „Jg. 1“ … „Jg. 4“");
      const gsPdf = await textPdf([["Schulcurriculum Evangelische Religion", "Grundschule"], ["Jahrgangsstufe 1/2", "Gott begleitet uns: Josef und seine Brueder"], ["Jahrgangsstufe 3/4", "Jesus erzaehlt Gleichnisse"]]);
      await tp.locator('input[aria-label="PDF-Datei"]').setInputFiles({ name: "Schulcurriculum_evRel_GS.pdf", mimeType: "application/pdf", buffer: gsPdf });
      await tp.locator(".small", { hasText: "3 Seiten" }).first().waitFor({ timeout: 30000 });
      const secVals = [];
      for (const g of [1, 2, 3, 4]) secVals.push(await tp.locator('input[aria-label="Seiten für Jahrgang ' + g + '"]').inputValue());
      ok(JSON.stringify(secVals) === JSON.stringify(["2", "2", "3", "3"]) && await tp.locator('input[aria-label="Seiten für Allgemein/Übersicht"]').inputValue() === "1", "Abschnitte erkannt: Jg. 1/2 → S. 2, Jg. 3/4 → S. 3, Übersicht S. 1");
      await tp.getByRole("button", { name: "Hochladen" }).click();
      await tp.locator(".toast", { hasText: "(3 Seiten)" }).waitFor({ timeout: 20000 });
      const gsRows = tp.locator(".gs-basis tbody tr");
      await gsRows.nth(3).waitFor({ timeout: 15000 });
      const rowTexts = (await gsRows.allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
      ok(await tp.locator(".gs-basis h3").textContent() === "Grundschule (Jahrgänge 1–4)" && rowTexts.length === 4
        && rowTexts[0].startsWith("Grundschule Jg. 1") && rowTexts[0].includes("(S. 1–2)") && rowTexts[3].startsWith("Grundschule Jg. 4") && rowTexts[3].includes("(S. 1, 3)")
        && rowTexts.every((t) => t.includes("Schulcurriculum evRel GS") && t.endsWith("vollständig")), "Status „Grundschule (Jahrgänge 1–4)“: " + rowTexts.join(" | "));
      const sekRows = (await tp.locator(".unit-table").first().locator("tbody tr").allTextContents()).join(" | ");
      ok(sekRows.length > 0 && !sekRows.includes("Schulcurriculum evRel GS"), "Tabelle des Gymnasiums (Ev. Religion) listet das Grundschul-Curriculum nicht");
      const gsBase = (await T("GET", "/api/teacher/bases?subject=evrel")).data.bases.find((b) => b.kind === "gs-curriculum");
      ok(gsBase && gsBase.pdf && gsBase.pdfSize === gsPdf.length && JSON.stringify(gsBase.sections) === JSON.stringify({ 1: [2], 2: [2], 3: [3], 4: [3], allgemein: [1] }),
        "gespeichert mit Original-PDF und Abschnitten 1–4");
      const evb = (await T("GET", "/api/teacher/basis?subject=evrel&klass=8-K")).data;
      ok(evb.docs.every((d) => d.kind !== "gs-curriculum"), "Planungsbasis eines Kurses des Gymnasiums ohne Grundschul-Curriculum");
    }

    /* ---------- Grundschule: Kurse, Einheit, Wochenkalender beider Schulformen ---------- */
    step("Grundschule: Menü, Kurse, Einheit, Wochenkalender beider Schulformen");
    let gsRelId = null, gsUnitId = null;
    {
      const { berlinToday } = await import("../../public/shared.js");
      const { calendarWeek } = await import("../../public/planning.js");
      const navCur = async () => (await tp.locator('.topbar nav a[aria-current="page"]').allTextContents()).join("|");
      // a) neuer Kurs Religion Jg. 2 (2a, 2b), Mo–Fr 08:00 je 45 Minuten, 22 Kinder – mit Fehlermeldungen
      await tp.goto(BASE + "/#/lk/grundschule");
      const nf = tp.locator("form.gs-new");
      await nf.waitFor({ timeout: 15000 });
      ok(await navCur() === "Grundschule" && await nf.locator("h2").textContent() === "Neuen Kurs anlegen" && await nf.getByLabel("Religion (evangelisch)").isChecked(), "Übersicht: Formular „Neuen Kurs anlegen“ (Religion vorgewählt)");
      // Wunsch der Lehrkraft vom 12.11.2026: Knopf „Neuen Kurs anlegen“ gleich oben; nur Jahrgang 1–4; Religion wählbar, sonst Name des Fachs
      const addBtn = tp.locator(".pagehead").getByRole("button", { name: "Neuen Kurs anlegen", exact: true });
      const gradeVals = await nf.locator('input[type="radio"][name="gsn-grade"]').evaluateAll((els) => els.map((e) => e.value));
      ok(await addBtn.count() === 1 && JSON.stringify(gradeVals) === JSON.stringify(["1", "2", "3", "4"]) && await nf.getByLabel("Anderes Fach").count() === 1
        && await tp.getByText("Noch keine Kurse – legen Sie mit „Neuen Kurs anlegen“ den ersten an.").count() === 1, "Knopf „Neuen Kurs anlegen“ im Kopf der Seite; Jahrgang nur 1–4; Fach Religion oder ein anderes");
      await addBtn.click();
      await tp.waitForFunction(() => { const f = document.querySelector("form.gs-new"), r = f && f.getBoundingClientRect(); return !!r && r.top >= 0 && r.top < innerHeight - 80; }, null, { timeout: 10000 });
      ok(await tp.evaluate(() => document.activeElement && document.activeElement.name === "gsn-grade" && document.activeElement.value === "1"), "Klick auf „Neuen Kurs anlegen“: Formular im Blick, Fokus auf „Jahrgang 1“");
      for (const bad of [0, 5]) ok((await T("POST", "/api/teacher/gs/courses", { grade: bad, classes: ["a"], religion: true, weekdays: [], classSize: null })).status === 400, "Server: Jahrgang " + bad + " abgelehnt");
      await nf.getByLabel("Jahrgang 2", { exact: true }).check();
      ok(await nf.getByLabel("2a", { exact: true }).count() === 1 && await nf.getByLabel("2c", { exact: true }).count() === 1, "Klassen folgen dem Jahrgang: 2a, 2b, 2c");
      await nf.getByRole("button", { name: "Kurs anlegen" }).click();
      await nf.getByText("Bitte mindestens eine Klasse wählen (höchstens drei: a, b, c).").waitFor({ timeout: 10000 });
      ok(await tp.evaluate(() => document.activeElement && document.activeElement.type) === "checkbox", "ohne Klasse: Hinweis, Fokus auf die Klassen");
      await nf.getByLabel("2a", { exact: true }).check(); await nf.getByLabel("2b", { exact: true }).check();
      for (let i = 0; i < 5; i++) await nf.getByRole("button", { name: "+ Termin pro Woche" }).click();
      for (let i = 1; i <= 4; i++) await nf.getByLabel("Beginn des Termins " + i + " (Uhrzeit)").fill("08:00");
      await nf.getByLabel("Zahl der Kinder im Kurs").fill("22");
      await nf.getByRole("button", { name: "Kurs anlegen" }).click();
      await nf.getByText("Bitte bei jedem Termin die Uhrzeit eintragen – daraus ergibt sich, ab wann Eltern eine Sitzung sehen können.").waitFor({ timeout: 10000 });
      ok(await tp.evaluate(() => document.activeElement && document.activeElement.getAttribute("aria-label")) === "Beginn des Termins 5 (Uhrzeit)"
        && ((await T("GET", "/api/teacher/gs/courses")).data.courses || []).length === 0, "Termin ohne Uhrzeit: Hinweis, Fokus ins Feld, nichts angelegt");
      await nf.getByLabel("Beginn des Termins 5 (Uhrzeit)").fill("08:00");
      await nf.getByRole("button", { name: "Kurs anlegen" }).click();
      await tp.waitForURL(/#\/lk\/grundschule\/k\/gs[a-f0-9]{8}$/, { timeout: 15000 });
      gsRelId = tp.url().split("/").pop();
      await tp.locator("h1", { hasText: "Religion · Jahrgang 2 (Klassen 2a, 2b)" }).waitFor({ timeout: 15000 });
      const WD5 = [1, 2, 3, 4, 5].map((d) => ({ day: d, minutes: 45, time: "08:00" }));
      const csRel = (await T("GET", "/api/teacher/course-settings?subject=gs&klass=" + gsRelId)).data.settings;
      ok(JSON.stringify(csRel.weekdays) === JSON.stringify(WD5) && csRel.classSize === 22, "Kurs angelegt, Kurseinstellungen gespeichert (Mo–Fr 08:00, 45 Minuten, 22 Kinder)");
      ok(await navCur() === "Grundschule" && (await tp.locator(".pagehead .pagesub").textContent()).includes("Jahrgang 2 · 22 Kinder · Mo 08:00–08:45, Di 08:00–08:45")
        && await tp.locator("section.cs-card").getByLabel("Zahl der Kinder im Kurs").inputValue() === "22" && await tp.locator("section.gs-edit h2").textContent() === "Fach, Klassen und Beschreibung",
        "Kursseite: Menüpunkt markiert, Kopfzeile mit Kindern und Stundenplan, Kurseinstellungen, Fach/Klassen/Beschreibung");
      ok((await tp.locator("section.gs-bases").textContent()).includes("Das Schulcurriculum Ev. Religion (Grundschule) für Jahrgang 2 liegt vor."), "Religion: Curriculum der Grundschule (Ev. Religion) liegt vor");
      // b) Ev. Religion: Stand der Jahrgänge 1–4 – „fehlt“ bei einem Religionskurs, dessen Jahrgang das Curriculum nicht abdeckt
      const gsCur = (await T("GET", "/api/teacher/bases?subject=evrel")).data.bases.find((b) => b.kind === "gs-curriculum");
      await T("PATCH", "/api/teacher/bases/" + gsCur.id, { scope: ["3", "4"] });
      await tp.goto(BASE + "/#/lk/grundlagen/evrel");
      await tp.locator(".gs-basis tbody tr").nth(3).waitFor({ timeout: 15000 });
      const st = (await tp.locator(".gs-basis tbody tr").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim());
      ok(st[1].endsWith("fehlt: Schulcurriculum Ev. Religion (Grundschule) für Jahrgang 2") && st[0].endsWith("–") && st[2].endsWith("vollständig"), "Planungsgrundlagen Ev. Religion: „fehlt“ nur beim Jahrgang des Religionskurses (" + st[1] + ")");
      await T("PATCH", "/api/teacher/bases/" + gsCur.id, { scope: [] });
      // c) zweiter Kurs: Sachunterricht Jg. 3 (3c) mit Beschreibung und Curriculum als PDF
      await tp.goto(BASE + "/#/lk/grundschule");
      await nf.waitFor({ timeout: 15000 });
      await nf.getByLabel("Jahrgang 3", { exact: true }).check(); await nf.getByLabel("3c", { exact: true }).check();
      await nf.getByLabel("Anderes Fach").check();
      await nf.getByRole("button", { name: "Kurs anlegen" }).click();
      await nf.getByText("Bitte den Namen des Fachs eintragen.").waitFor({ timeout: 10000 });
      ok(await tp.evaluate(() => document.activeElement && document.activeElement.id) === "gsn-name", "anderes Fach ohne Namen: Hinweis, Fokus auf „Name des Fachs“");
      await nf.getByLabel("Name des Fachs").fill("Sachunterricht");
      await nf.getByLabel("Beschreibung des Fachs (optional)").fill("Wir erkunden Natur und Technik in unserer Umgebung.");
      await nf.getByRole("button", { name: "+ Termin pro Woche" }).click();
      await nf.getByLabel("Wochentag des Termins 1").selectOption("3"); await nf.getByLabel("Beginn des Termins 1 (Uhrzeit)").fill("09:50");
      ok(await nf.getByLabel("Planungsgrundlage (optional)").isVisible(), "anderes Fach: Planungsgrundlage optional beim Anlegen");
      await nf.getByLabel("PDF-Datei (optional)").setInputFiles({ name: "Curriculum_Sachunterricht.pdf", mimeType: "application/pdf", buffer: await textPdf([["Schulcurriculum Sachunterricht"], ["Klasse 3", "Wasser im Alltag"], ["Klasse 4", "Strom und Magnetismus"]]) });
      await nf.getByRole("button", { name: "Kurs anlegen" }).click();
      await tp.waitForURL((u) => /#\/lk\/grundschule\/k\/gs[a-f0-9]{8}$/.test(u.href) && !u.href.endsWith(gsRelId), { timeout: 30000 });
      const sachId = tp.url().split("/").pop();
      await tp.locator("h1", { hasText: "Sachunterricht · Jahrgang 3 (Klasse 3c)" }).waitFor({ timeout: 15000 });
      await tp.locator("section.gs-bases a.baselink", { hasText: "Curriculum Sachunterricht" }).waitFor({ timeout: 15000 });
      const sb = (await T("GET", "/api/teacher/basis?subject=gs&klass=" + sachId)).data;
      const sk = (await T("GET", "/api/teacher/gs/courses/" + sachId)).data.course;
      ok(sk.description === "Wir erkunden Natur und Technik in unserer Umgebung." && sb.docs.length === 1 && sb.docs[0].kind === "gs-curriculum" && sb.docs[0].pdf && !sb.missing.length,
        "Sachunterricht 3c: Beschreibung gespeichert, Curriculum mit Original-PDF (Seiten des Jahrgangs 3: " + (sb.docs[0] && sb.docs[0].pages) + ")");
      await tp.goto(BASE + "/#/lk/grundschule");
      await tp.locator(".gs-courses .tile").nth(1).waitFor({ timeout: 15000 });
      const tiles = (await tp.locator(".gs-courses .tile").allTextContents()).join(" | ");
      ok(await tp.locator(".gs-courses h3", { hasText: "Jahrgang 2" }).count() === 1 && await tp.locator(".gs-courses h3", { hasText: "Jahrgang 3" }).count() === 1
        && tiles.includes("Religion 2ab") && tiles.includes("Mo 08:00, Di 08:00, Mi 08:00, Do 08:00, Fr 08:00 · 22 Kinder · 0 Sitzungen") && tiles.includes("Sachunterricht 3c"),
        "Übersicht: Kurse nach Jahrgang („" + tiles + "“)");
      // d) Einheit im Religionskurs: Stundenplan mit Uhrzeit aus den Kurseinstellungen, keine Klausur, Grundschul-Curriculum, eigener Prompt
      await tp.goto(BASE + "/#/lk/grundschule/k/" + gsRelId);
      await tp.getByLabel("Thema der neuen Einheit").fill("Josef und seine Brüder");
      await tp.getByRole("button", { name: "Einheit anlegen" }).click();
      await tp.waitForURL(/#\/lk\/u\/[a-f0-9]{16}$/);
      gsUnitId = tp.url().split("/").pop();
      await tp.locator('select[aria-label="Wochentag"]').first().waitFor({ timeout: 15000 });
      const tv = await tp.locator('input[aria-label="Uhrzeit (Beginn)"]').evaluateAll((els) => els.map((e) => e.value));
      ok(JSON.stringify(tv) === JSON.stringify(["08:00", "08:00", "08:00", "08:00", "08:00"]) && await tp.locator('input[aria-label="Klausurtermin"]').count() === 0 && await navCur() === "Grundschule"
        && (await tp.locator(".crumbs").textContent()).includes("Religion 2ab"), "Grundschul-Einheit: fünf Termine mit Uhrzeit aus den Kurseinstellungen, kein Klausurtermin, Menüpunkt Grundschule");
      const mon = calendarWeek(berlinToday());
      await tp.locator('input[aria-label="Beginn"]').fill(mon); await tp.locator('input[aria-label="Ende"]').fill(addDays(mon, 4));
      await tp.getByRole("button", { name: "Speichern und Termine berechnen" }).click();
      await tp.locator(".toast", { hasText: "5 Sitzungen verfügbar." }).waitFor({ timeout: 10000 });
      const gbl = tp.locator("section.card", { hasText: "2. Planungsgrundlagen" });
      await gbl.locator("a.baselink").first().waitFor({ timeout: 15000 });
      ok((await gbl.locator("a.baselink").first().textContent()).includes("Schulcurriculum evRel GS") && (await gbl.textContent()).includes("Grundschule: keine Tablets – die KI plant nur analoges, ausdruckbares Material.")
        && await gbl.getByRole("link", { name: "Verwalten" }).getAttribute("href") === "#/lk/grundlagen/evrel", "Planungsgrundlagen der Einheit: Curriculum der Grundschule (Ev. Religion), nur analoges Material");
      await tp.getByRole("button", { name: "Einheit mit Claude planen" }).click();
      const gm = tp.locator(".modal", { hasText: "Welches Sprachmodell?" });
      await gm.waitFor();
      await gm.getByRole("button", { name: "Prompt kopieren" }).click();
      const gsPrompt = await tp.evaluate(() => navigator.clipboard.readText());
      ok(gsPrompt.includes("an einer Grundschule in Hessen") && gsPrompt.includes("22 Kinder") && gsPrompt.includes(gsUnitId) && gsPrompt.includes("genau 5 Zeilen") && !gsPrompt.includes("Gymnasium") && !gsPrompt.includes("Klausur"),
        "Prompt der Grundschul-Einheit: Grundschule in Hessen, 22 Kinder, 5 Stunden – ohne Gymnasium und Klausur");
      await gm.getByRole("button", { name: "Schließen", exact: true }).getByText("Schließen").click();
      // e) Claude über den Connector: Kurse, Planungsgrundlage, Einheit (mit uid je Stunde), Plan speichern
      let g = await tool("list_gs_courses", {});
      ok(g.content[0].text.includes("- " + gsRelId + ": Religion · Jahrgang 2 (Klassen 2a, 2b)") && g.content[0].text.includes("; 22 Kinder") && g.content[0].text.includes("Sachunterricht · Jahrgang 3 (Klasse 3c)") && g.content[0].text.includes("Ziel: Wir erkunden"),
        "list_gs_courses: beide Kurse mit Stundenplan, Kindern und Ziel");
      g = await tool("get_planning_basis", { unit_id: gsUnitId });
      ok(g.content[0].text.startsWith("# Planungsgrundlagen für Religion · Jahrgang 2 (Klassen 2a, 2b) (Grundschule)") && g.content[0].text.includes("Josef und seine Brueder")
        && !g.content[0].text.includes("Jesus erzaehlt") && !g.content[0].text.includes("Konjunkturpolitik"), "get_planning_basis: Curriculum der Grundschule für Jahrgang 2 – kein KCGO, nicht Jg. 3/4");
      g = await tool("save_unit_plan", { unit_id: gsUnitId, plan: { titel: "Josef und seine Brüder", planungsgrundlage: { name: "Schulcurriculum Ev. Religion (Grundschule)" }, lernaufgabe: "Bodenbild zur Josefsgeschichte gestalten",
        ausgangslage: "Die Kinder kennen erste Geschichten aus der Bibel.", schritte: [{ titel: "Josef kennenlernen", beschreibung: "Geschichte hören und nacherzählen" }, { titel: "Versöhnung", beschreibung: "Gefühle der Brüder darstellen" }] },
        stunden: [{ stundenfrage: "Wer war Josef?", ablauf: ["Sitzkreis", "Erzählung"], schritt: 0 }, { stundenfrage: "Warum sind die Brüder neidisch?", ablauf: ["Rollenspiel"], schritt: 0 },
          { stundenfrage: "Josef in Ägypten", ablauf: ["Bildkarten"], schritt: 1 }, { stundenfrage: "Josef verzeiht", ablauf: ["Bodenbild"], schritt: 1 }] });
      ok(!g.isError, "save_unit_plan (4 Stunden) über den Connector");
      g = await tool("get_unit", { unit_id: gsUnitId });
      const gu = g.content[0].text;
      ok(gu.startsWith("# Unterrichtseinheit " + gsUnitId + " (Grundschule: Religion · Jahrgang 2 (Klassen 2a, 2b) – Jahrgangsstufe 2 der Grundschule, Kurs mit Kindern aus den Klassen 2a und 2b, 22 Kinder,")
        && (gu.match(/\n\d\. \[uid [a-f0-9]{8}\] /g) || []).length === 4 && !gu.includes("Klausur"), "get_unit: Kopf mit Kurs und 22 Kindern, jede Stunde mit uid, ohne Klausur");
      await tp.reload();
      await tp.locator(".unit-table tbody tr").nth(3).waitFor({ timeout: 15000 });
      await tp.getByRole("button", { name: "Einheit festlegen und Sitzungen anlegen" }).click();
      await tp.locator(".toast", { hasText: "4 Sitzung(en) angelegt." }).waitFor({ timeout: 20000 });
      const gsLessons = (await T("GET", "/api/teacher/lessons?subject=gs&klass=" + gsRelId)).data.lessons;
      const sekList = (await T("GET", "/api/teacher/lessons")).data.lessons;
      ok(gsLessons.length === 4 && gsLessons.every((l) => l.startTime === "08:00" && l.durationMin === 45) && sekList.length > 0 && sekList.every((l) => l.subject !== "gs"),
        "4 Sitzungen der Grundschule (08:00, 45 Minuten); die Sitzungsliste des Gymnasiums enthält sie nicht");
      ok((await SA("POST", "/api/student/join", { code: gsLessons[0].code })).status === 404, "Schüler:innen: der Code einer Grundschul-Sitzung gilt als unbekannt (404)");
      ok((await tool("propose_feibeitsblatt", { lesson_id: gsLessons[0].id, titel: "x", aufgaben: [{ text: "a" }] })).isError === true
        && (await tool("save_substitute_plan", { lesson_id: gsLessons[0].id, analyse: { kompetenz: "a", stundenfrage: "b", inhalte: [] }, schritte: [{ titel: "a", anleitung: "b" }], abgabe: "x" })).isError === true,
        "Connector: kein Feibeitsblatt und keine Vertretungsstunde in der Grundschule");
      // f) Kursseite: Einheit mit ihren Sitzungen (ohne Sitzungscode und Schüler:innen)
      await tp.goto(BASE + "/#/lk/grundschule/k/" + gsRelId);
      const uc = tp.locator(".unit-card", { hasText: "Josef und seine Brüder" });
      await uc.locator(".item").nth(3).waitFor({ timeout: 15000 });
      ok(await uc.locator(".item").count() === 4 && !(await uc.textContent()).includes("SuS") && await uc.locator(".item .badge", { hasText: "Inhalt für Eltern fehlt" }).count() === 4
        && await uc.locator('a.item[href="#/lk/s/' + gsLessons[0].id + '"]').count() === 1, "Kursseite: Einheit mit 4 Sitzungen (ohne Code und Schüler:innen, „Inhalt für Eltern fehlt“)");
      // Fach, Klassen und Beschreibung ändern: gespeichert, nach dem Neuaufbau der Seite bleibt der Fokus auf „Speichern“
      const ge = tp.locator("section.gs-edit");
      await ge.getByLabel("Beschreibung des Fachs (optional)").fill("Wir lernen Geschichten aus der Bibel kennen.");
      await ge.getByRole("button", { name: "Speichern", exact: true }).click();
      await tp.locator(".toast", { hasText: "Kurs gespeichert." }).waitFor({ timeout: 10000 });
      await tp.waitForFunction(() => !!document.activeElement && document.activeElement.classList.contains("gse-save"), null, { timeout: 10000 });
      ok((await T("GET", "/api/teacher/gs/courses/" + gsRelId)).data.course.description === "Wir lernen Geschichten aus der Bibel kennen.", "Kurs ändern: Beschreibung gespeichert, Fokus bleibt auf „Speichern“");
      // g) Wochenkalender auf beiden Startseiten: Termine beider Schulformen, Klick öffnet den Grundschulkurs
      for (const [hash, label] of [["#/lk", "Startseite Gymnasium"], ["#/lk/grundschule", "Grundschule"]]) {
        // der Wechsel #/lk → #/lk/grundschule lädt die Seite nicht neu: ohne das Entfernen fände waitFor noch den Kalender der vorigen Seite,
        // die danach ersetzt wird (Wettlauf, am 13.11.2026 einmal aufgetreten)
        await tp.evaluate(() => document.querySelectorAll(".weekcal").forEach((el) => el.remove()));
        await tp.goto(BASE + "/" + hash);
        await tp.waitForFunction(() => document.querySelectorAll('.weekcal .wk-ev[data-fach="gs"]').length === 5, null, { timeout: 15000 }).catch(() => {});
        const gev = tp.locator('.weekcal .wk-ev[data-fach="gs"]').first();
        const wk = { gs: await tp.locator('.weekcal .wk-ev[data-fach="gs"]').count(), tag: await gev.locator(".ftag").textContent(), tagFach: await gev.locator(".ftag").getAttribute("data-fach"),
          name: await gev.locator("strong").textContent(), title: await gev.getAttribute("title"), other: await tp.locator('.weekcal .wk-ev:not([data-fach="gs"])').count() };
        const wkOk = wk.gs === 5 && wk.tag === "Grundschule" && wk.tagFach === "gs" && wk.name === "Religion 2ab" && String(wk.title).startsWith("Grundschule, 08:00–08:45 Religion 2ab") && wk.other > 0;
        if (!wkOk) console.log("    Wochenkalender:", JSON.stringify(wk));
        ok(wkOk, label + ": Wochenkalender mit den Terminen beider Schulformen (Grundschule gekennzeichnet)");
      }
      await tp.locator('.weekcal .wk-ev[data-fach="gs"]').first().click();
      await tp.waitForURL(new RegExp("#/lk/grundschule/k/" + gsRelId + "$"));
      await tp.locator("h1", { hasText: "Religion · Jahrgang 2 (Klassen 2a, 2b)" }).waitFor({ timeout: 10000 });
      ok(true, "Klick auf den Grundschul-Eintrag öffnet den Kurs");
      await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-grundschulkurs.png"), fullPage: true });
      // iPad (quer und hoch): „Neuen Kurs anlegen“ ohne Scrollen sichtbar – auch mit Einträgen im Wochenkalender darüber
      const vp = tp.viewportSize();
      for (const [w, hh] of [[1024, 768], [768, 1024]]) {
        await tp.setViewportSize({ width: w, height: hh });
        await tp.goto(BASE + "/#/lk/grundschule");
        await tp.locator('.weekcal .wk-ev[data-fach="gs"]').first().waitFor({ timeout: 15000 });
        const bb = await tp.locator(".pagehead").getByRole("button", { name: "Neuen Kurs anlegen", exact: true }).boundingBox();
        ok(!!bb && await tp.evaluate(() => scrollY) === 0 && bb.y >= 0 && bb.y + bb.height <= hh && bb.height >= 44, "iPad " + w + "×" + hh + ": „Neuen Kurs anlegen“ ohne Scrollen sichtbar (≥ 44 px)");
      }
      await tp.setViewportSize(vp);
    }

    step("Grundschul-Sitzung: Verlaufsplan, PDF-Verweise, Zwischenstopp, Bildkarten (Connector)");
    {
      const gl = (await T("GET", "/api/teacher/lessons?subject=gs&klass=" + gsRelId)).data.lessons.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const [les1, les2] = gl;
      // a) Claude über den Connector: get_lesson ohne Sitzungscode, kein Schulportal-Eintrag, Material mit Anzahl, Verlaufsplan, Inhalt für die Eltern
      let g = await tool("get_lesson", { lesson_id: les2.id });
      ok(g.content[0].text.includes("## Verlaufsplan") && g.content[0].text.includes("Schülerzahl laut Kurseinstellungen: 22") && !g.content[0].text.includes("Sitzungscode"),
        "get_lesson (Grundschule): Verlaufsplan und 22 Kinder, kein Sitzungscode");
      ok((await tool("save_schulportal_entry", { lesson_id: les2.id, text: "**1) x**" })).isError === true, "save_schulportal_entry: in der Grundschule abgelehnt");
      g = await tool("add_material_pdf", { lesson_id: les1.id, bereich: "lehrkraft", titel: "Vorlesetext Josef", html: "<h1>Vorlesetext</h1><p>Josef hatte elf Brüder.</p>" });
      const vorId = g.structuredContent.file_id;
      g = await tool("add_material_pdf", { lesson_id: les2.id, bereich: "schueler", titel: "Arbeitsblatt Josef in Ägypten", html: "<h1>Josef in Ägypten</h1><p>Male ein Bild.</p>", anzahl: 22 });
      const abId = g.structuredContent.file_id;
      ok(!g.isError && g.content[0].text.includes("„22x - beidseitig - sw - Arbeitsblatt Josef in Ägypten.pdf“") && g.content[0].text.includes("Verweis im Verlaufsplan: [[pdf:" + abId + "]]"),
        "add_material_pdf (Kinder, anzahl 22): auch auf der Druckliste, Antwort nennt den Verweis");
      g = await tool("add_material_pdf", { lesson_id: les2.id, bereich: "schueler", titel: "Rätsel Pyramide", html: "<h1>Rätsel</h1>", anzahl: 22 });
      const raeId = g.structuredContent.file_id;
      const PLAN = (bad) => "**1) Ankommen im Sitzkreis (5 Min.)**\n- Begrüßungslied, Kerze anzünden\n**2) Erzählung (15 Min., Sitzkreis)**\n- __Lehrkraft liest [[pdf:" + vorId + "|Vorlesetext]] vor.__\n" +
        "**3) Arbeitsblatt (15 Min., Einzelarbeit)**\n- [[pdf:" + (bad || abId) + "]]\n**4) Rätsel (10 Min., Partnerarbeit)**\n- [[pdf:" + raeId + "]]";
      g = await tool("save_verlaufsplan", { lesson_id: les2.id, text: PLAN("0123456789abcdef"), base_version: 0 });
      ok(!g.isError && g.content[0].text.includes("Achtung: Diese Verweise gehören zu keiner PDF des Kurses: [[pdf:0123456789abcdef]]") && g.content[0].text.includes(abId + " („Arbeitsblatt Josef in Ägypten.pdf“)"),
        "save_verlaufsplan: unbekannter Verweis gespeichert, aber gemeldet (mit den gültigen file_id)");
      g = await tool("save_verlaufsplan", { lesson_id: les2.id, text: PLAN(), base_version: 1 });
      ok(!g.isError && g.content[0].text.startsWith("Verlaufsplan gespeichert (Version 2).") && g.content[0].text.includes("Eltern sehen nach der Stunde: „Arbeitsblatt Josef in Ägypten.pdf“, „Rätsel Pyramide.pdf“."),
        "save_verlaufsplan: gültig; Eltern sehen nach der Stunde die beiden Blätter der Kinder");
      ok(!(await tool("update_lesson", { lesson_id: les2.id, inhalt_eltern: "Wir haben gehört, wie Josef nach Ägypten kam." })).isError
        && (await tool("update_lesson", { lesson_id: lessonId, inhalt_eltern: "x" })).isError === true, "update_lesson inhalt_eltern: Grundschule ja, Gymnasium abgelehnt");
      // b) Sitzungsseite der Lehrkraft: Verlaufsplan ganz oben, PDF-Namen gelb markiert als Links in einen neuen Tab
      await tp.goto(BASE + "/#/lk/s/" + les2.id);
      const plan = tp.locator("#gsplan");
      await plan.locator("a.pdfref").nth(2).waitFor({ timeout: 15000 });
      ok(await tp.evaluate(() => { const s = document.querySelector(".gs-session > .stack"); return !!s && s.firstElementChild && s.firstElementChild.id === "gsplan"; })
        && await tp.locator('.topbar nav a[aria-current="page"]').textContent() === "Grundschule" && (await plan.locator(".save-state").textContent()).includes("Version 2 · zuletzt von Claude"),
        "Sitzungsseite: Verlaufsplan als erste Karte, Menüpunkt Grundschule, „Version 2 · zuletzt von Claude“");
      const refs = await plan.locator("a.pdfref").evaluateAll((els) => els.map((e) => ({ t: e.firstChild.textContent, bg: getComputedStyle(e).backgroundColor, u: getComputedStyle(e).textDecorationLine, tg: e.target, h: e.getAttribute("href") })));
      ok(refs.length === 3 && refs.map((r) => r.t).join("|") === "Vorlesetext Josef.pdf|Arbeitsblatt Josef in Ägypten.pdf|Rätsel Pyramide.pdf" && refs.every((r) => r.bg === "rgb(255, 212, 59)" && r.u.includes("underline") && r.tg === "_blank")
        && refs[1].h === "#/lk/datei/" + abId && await plan.locator("u a.pdfref").count() === 1, "PDF-Namen im Verlaufsplan: gelb markiert, unterstrichen, Link in einen neuen Tab (Aufforderung an die Lehrkraft unterstrichen)");
      const dlReq = tctx.waitForEvent("request", { predicate: (q) => q.url().includes("/api/dl/" + abId), timeout: 20000 }).catch(() => null);
      const [np] = await Promise.all([tctx.waitForEvent("page"), plan.locator("a.pdfref").nth(1).click()]);
      const q = await dlReq, res = q ? await fetch(q.url()) : null;
      ok(res && res.status === 200 && res.headers.get("content-type") === "application/pdf" && /^inline/.test(res.headers.get("content-disposition") || ""), "Klick auf den PDF-Namen: neuer Tab mit der PDF (signierter Link, inline)");
      await np.close().catch(() => {});
      ok(await tp.locator("#backupchat, #portal, #fbcard, .code-big, .presrel, .sessionio").count() === 0 && !(await tp.locator("#app main").textContent()).includes("Sitzungscode")
        && !(await tp.locator("#app main").textContent()).includes("Schulportal"), "keine Live-Präsentation, kein Chat, kein Schulportal-Eintrag, kein Sitzungscode, kein Feibeitsblatt");
      // c) Material: Hinweis, was Eltern sehen; Druckliste mit den Blättern der Kinder
      const mat = tp.locator("#gs-material");
      await mat.locator(".gs-parents-badge").nth(1).waitFor({ timeout: 10000 });
      ok(JSON.stringify(await mat.locator(".gs-parents-badge").allTextContents()) === JSON.stringify(["Eltern sehen sie", "Eltern sehen sie"]) && await mat.getByText("Material für die Kinder (Eltern sehen die PDF-Dateien nach der Stunde)").count() === 1
        && await mat.locator(".printtoggle input:checked").count() === 2 && (await mat.locator(".printtoggle").first().textContent()) === "Auch ausdrucken (22×)", "Materialkasten: „Eltern sehen sie“ und „Auch ausdrucken (22×)“");
      const prn = await tp.locator("#printcard .printrow .name").allTextContents();
      ok(prn.includes("22x - beidseitig - sw - Arbeitsblatt Josef in Ägypten.pdf") && prn.includes("22x - beidseitig - sw - Rätsel Pyramide.pdf"), "Druckliste: die Blätter der Kinder mit 22 Exemplaren");
      ok((await tp.locator("#gs-parents").textContent()).includes("Eltern sehen von dieser Sitzung: „Arbeitsblatt Josef in Ägypten.pdf“, „Rätsel Pyramide.pdf“")
        && await tp.locator("#gs-summary").inputValue() === "Wir haben gehört, wie Josef nach Ägypten kam.", "Elternansicht-Karte nennt das Material; Inhalt der Unterrichtsstunde von Claude");
      // d) Zwischenstopp per Tastatur (Dialog „Wo haben Sie aufgehört?“): vor „4) Rätsel“
      await plan.getByRole("button", { name: "Zwischenstopp eintragen …" }).focus();
      await tp.keyboard.press("Enter");
      const sd = tp.locator(".modal", { hasText: "Wo haben Sie aufgehört?" });
      await sd.waitFor();
      ok(await tp.evaluate(() => document.activeElement && document.activeElement.name === "gs-stop" && document.activeElement.checked), "Dialog: Fokus auf der gewählten Zeile");
      for (let i = 0; i < 6; i++) await tp.keyboard.press("ArrowDown");
      await tp.keyboard.press("Enter");
      await tp.locator(".toast", { hasText: "Zwischenstopp eingetragen" }).waitFor({ timeout: 10000 });
      let stopped = "";
      for (let i = 0; i < 30 && !stopped.includes("⏸"); i++) { await sleep(300); stopped = (await T("GET", "/api/teacher/lessons/" + les2.id)).data.lesson.portal; }
      ok(stopped.split("\n")[6] === "⏸ Zwischenstopp" && stopped.split("\n")[7] === "**4) Rätsel (10 Min., Partnerarbeit)**", "Zwischenstopp vor „4) Rätsel“ gespeichert");
      ok(JSON.stringify(await mat.locator(".gs-parents-badge").allTextContents()) === JSON.stringify(["Eltern sehen sie", "nach dem Zwischenstopp – Eltern sehen sie nicht"]) && await plan.locator(".stopfield").count() === 1
        && (await tp.locator("#gs-parents").textContent()).includes("Eltern sehen von dieser Sitzung: „Arbeitsblatt Josef in Ägypten.pdf““".slice(0, -1)) && !(await tp.locator("#gs-parents").textContent()).includes("Rätsel Pyramide")
        && await tp.locator("#gs-summary-stop").isVisible(), "nach dem Zwischenstopp: Rätsel „Eltern sehen sie nicht“, Hinweis beim Inhalt der Unterrichtsstunde");
      ok(await tp.locator("#gs-stop-next").isVisible() && (await tp.locator("#gs-stop-next").textContent()).startsWith("Zwischenstopp gesetzt."), "Hinweis nach dem Eintragen: Claude fragt beim Planen der nächsten Sitzung (Anforderung 13)");
      {
        // Anforderung 13 (S11): die nächste Sitzung zeigt den offenen Teil direkt unter dem Verlaufsplan, der Prompt fragt nach (mit der file_id des Rätsels)
        const les3 = gl[2];
        await tp.goto(BASE + "/#/lk/s/" + les3.id);
        await tp.locator("#gs-prevstop").waitFor({ timeout: 15000 });
        ok(await tp.evaluate(() => { const s = document.querySelector(".gs-session > .stack"); return !!s && s.firstElementChild.id === "gsplan" && s.firstElementChild.nextElementSibling.id === "gs-prevstop"; })
          && (await tp.locator("#gs-prevstop-open").textContent()) === "Nicht geschafft: 4) Rätsel (10 Min., Partnerarbeit)", "nächste Grundschul-Sitzung: Karte direkt unter dem Verlaufsplan, „Nicht geschafft: 4) Rätsel …“");
        await tp.getByRole("button", { name: "Stunde mit Claude planen" }).click();
        const gm = tp.locator(".modal", { hasText: "Welches Sprachmodell?" });
        await gm.waitFor();
        await gm.getByRole("button", { name: "Prompt kopieren" }).click();
        const gp = await tp.evaluate(() => navigator.clipboard.readText());
        ok(gp.includes("Nicht geschafft (nach dem Zwischenstopp):\n<<<\n**4) Rätsel (10 Min., Partnerarbeit)**") && gp.includes("„Rätsel Pyramide.pdf“ (file_id " + raeId + ")")
          && gp.includes("Frage mich, ob du es in diese Stunde einbauen sollst oder ob wir darauf verzichten."), "Prompt (Grundschule): offener Teil mit dem Rätsel und seiner file_id, Frage übernehmen oder verzichten");
        await gm.getByRole("button", { name: "Schließen", exact: true }).getByText("Schließen").click();
        await tp.goto(BASE + "/#/lk/s/" + les2.id);
        await plan.locator(".stopfield").waitFor({ timeout: 15000 });
      }
      // Kontextmenü auf einer Zeile der Vorschau
      await plan.locator('.portal-preview [data-line="1"]').click({ button: "right" });
      ok(await tp.locator(".ctxmenu").getByRole("menuitem", { name: "Zwischenstopp einfügen" }).count() === 1 && await tp.locator(".ctxmenu").getByRole("menuitem", { name: "Zwischenstopp entfernen" }).count() === 1,
        "Rechtsklick auf eine Zeile: „Zwischenstopp einfügen“ / „Zwischenstopp entfernen“");
      await tp.keyboard.press("Escape");
      // e) Bearbeiten: Textfeld mit Vorschau, PDF-Verweis aus der vorigen Sitzung an der Schreibmarke einfügen
      await plan.getByRole("button", { name: "Bearbeiten" }).click();
      const pta = tp.locator("#gsplan-text");
      await pta.waitFor();
      await pta.evaluate((e) => { e.focus(); e.setSelectionRange(e.value.length, e.value.length); });
      await plan.getByRole("button", { name: "PDF-Verweis einfügen …" }).click();
      await tp.locator(".ctxmenu").getByRole("menuitem", { name: "Vorlesetext Josef.pdf (vorige Sitzung)" }).click();
      ok((await pta.inputValue()).endsWith("[[pdf:" + vorId + "]]") && await plan.getByLabel("Verlaufsplan (wird automatisch gespeichert)").count() === 1, "Bearbeiten: Verweis an der Schreibmarke eingefügt");
      await plan.getByRole("button", { name: "Fertig" }).click();
      let saved = "";
      for (let i = 0; i < 30 && !saved.endsWith("[[pdf:" + vorId + "]]"); i++) { await sleep(300); saved = (await T("GET", "/api/teacher/lessons/" + les2.id)).data.lesson.portal; }
      ok(saved.endsWith("[[pdf:" + vorId + "]]") && await pta.count() === 0, "„Fertig“: gespeichert, wieder die feste Ansicht");
      // f) Hausaufgabe und Hinweis der Lehrkraft (für die Eltern) speichern automatisch
      await tp.locator("#gs-homework").fill("Male ein Bild von Josef.");
      await tp.locator("#gs-note").fill("Bitte Malstifte mitgeben.");
      await tp.locator("#gs-summary").focus();
      let gl2 = null;
      for (let i = 0; i < 30 && !(gl2 && gl2.parentNote && gl2.homework); i++) { await sleep(300); gl2 = (await T("GET", "/api/teacher/lessons/" + les2.id)).data.lesson; }
      ok(gl2.parentNote === "Bitte Malstifte mitgeben." && gl2.homework === "Male ein Bild von Josef." && gl2.parentSummary === "Wir haben gehört, wie Josef nach Ägypten kam.", "Hausaufgabe und Hinweis der Lehrkraft gespeichert");
      ok((await T("PATCH", "/api/teacher/lessons/" + lessonId, { parentNote: "x" })).status === 400, "Gymnasium: kein Hinweis für Eltern (400)");
      ok(await tp.locator("#gs-copy").textContent() === "Sitzungslink für Eltern kopieren" && await tp.locator("#gs-try").getAttribute("target") === "_blank", "Knöpfe „Sitzungslink für Eltern kopieren“ und „Elternansicht ausprobieren“ ganz unten");
      // g) Bildkarten: Claude gestaltet sie (eine Seite = eine Karte, ein Erzähltext je Karte), der Browser der Lehrkraft erstellt die Bilder,
      //    die Lehrkraft ändert einen Erzähltext; eine hochgeladene PDF ist für Eltern zunächst nicht freigegeben (Verlagskarten)
      const CARD = (k) => '<section style="width:297mm;height:200mm;overflow:hidden;display:grid;place-items:center' + (k < 3 ? ";break-after:page" : "") + '"><svg width="420" height="300" viewBox="0 0 420 300">' +
        '<circle cx="210" cy="150" r="' + (40 + k * 25) + '" fill="#2557c7"/></svg><h2 style="font-size:40pt">Karte ' + k + "</h2></section>";
      g = await tool("add_picture_cards", { lesson_id: les2.id, titel: "Bildkarten – Josef in Ägypten", erzaehltexte: ["Josef kommt nach Ägypten.", "Josef deutet die Träume des Pharao.", "Josef verzeiht seinen Brüdern."],
        html: '<!doctype html><html lang="de"><head><meta charset="utf-8"><style>@page{size:A4 landscape;margin:0}body{margin:0}</style></head><body>' + CARD(1) + CARD(2) + CARD(3) + "</body></html>" });
      const cardId = g.structuredContent && g.structuredContent.file_id;
      ok(!g.isError && g.content[0].text.includes("gespeichert und gedruckt: 3 Seiten = 3 Karten, 3 Erzähltexte.") && g.content[0].text.includes("Verweis: [[pdf:" + cardId + "]]"), "add_picture_cards: gedruckt, „3 Seiten = 3 Karten“, Antwort nennt den Verweis");
      ok((await tool("add_picture_cards", { lesson_id: lessonId, titel: "x", html: "<p>x</p>", erzaehltexte: ["a"] })).isError === true, "add_picture_cards: am Gymnasium abgelehnt");
      await tp.reload();
      const cbox = tp.locator("#gs-cards");
      await cbox.locator(".cs-state", { hasText: "3 Karten · Bilder bereit" }).waitFor({ timeout: 60000 });
      const sizes = await cbox.locator("img.cs-thumb").evaluateAll((els) => Promise.all(els.map((im) => Promise.resolve(im.complete && im.naturalWidth ? null : new Promise((r) => { im.onload = r; im.onerror = r; })).then(() => [im.naturalWidth, im.naturalHeight]))));
      ok(sizes.length === 3 && sizes.every(([w, hh]) => Math.max(w, hh) === 1600) && await cbox.locator("#cs-share-" + cardId).isChecked()
        && await tp.evaluate(() => { const ids = [...document.querySelectorAll(".gs-session > .stack > *")].map((x) => x.id); return ids.indexOf("gs-cards") > ids.indexOf("gs-claude") && ids.indexOf("gs-cards") < ids.indexOf("gs-material"); }),
        "Bildkarten-Karte nach „Stunde mit Claude planen“: Bilder im Browser erstellt (längste Seite 1600 px, signierter Link), Eltern dürfen sie sehen");
      // Betrachter (derselbe wie in der Elternansicht): der Reihe nach durchklicken, Pfeiltasten, Erzähltext darunter
      await cbox.locator("details.cs-preview > summary").first().click();
      const cv = cbox.locator("figure.cardview").first();
      await cv.locator(".cv-count", { hasText: "Karte 1 von 3" }).waitFor({ timeout: 10000 });
      ok(await cv.getByRole("button", { name: "Vorherige Karte" }).getAttribute("aria-disabled") === "true" && (await cv.locator("figcaption").textContent()) === "Josef kommt nach Ägypten."
        && await cv.locator("img").getAttribute("alt") === "Bildkarte 1 von 3", "Betrachter: Karte 1 von 3 mit Erzähltext, „Vorherige Karte“ am Anfang gesperrt");
      await cv.getByRole("button", { name: "Nächste Karte" }).focus();
      await tp.keyboard.press("ArrowRight");
      await cv.locator(".cv-count", { hasText: "Karte 2 von 3" }).waitFor({ timeout: 5000 });
      await cv.getByRole("button", { name: "Nächste Karte" }).click();
      ok((await cv.locator(".cv-count").textContent()) === "Karte 3 von 3" && await cv.getByRole("button", { name: "Nächste Karte" }).getAttribute("aria-disabled") === "true"
        && (await cv.locator("figcaption").textContent()) === "Josef verzeiht seinen Brüdern." && await cv.locator("img").evaluate((im) => (im.complete ? im.naturalWidth > 0 : new Promise((r) => { im.onload = () => r(im.naturalWidth > 0); im.onerror = () => r(false); }))),
        "Betrachter: Pfeiltaste und „Nächste Karte“, am Ende gesperrt, Bild geladen");
      const t2 = cbox.getByLabel("Erzähltext zu Karte 2 (für Eltern sichtbar – gekürzt zum Nacherzählen)");
      ok(await t2.inputValue() === "Josef deutet die Träume des Pharao.", "Erzähltext von Claude je Karte");
      await t2.fill("Josef erklärt dem Pharao seine Träume.");
      await cbox.getByLabel("Erzähltext zu Karte 3 (für Eltern sichtbar – gekürzt zum Nacherzählen)").focus();
      let cg = null;
      for (let i = 0; i < 30 && !(cg && cg.texts[1] === "Josef erklärt dem Pharao seine Träume."); i++) { await sleep(300); cg = (await T("GET", "/api/teacher/files/" + cardId + "/cards")).data; }
      ok(cg && cg.texts[1] === "Josef erklärt dem Pharao seine Träume." && cg.rev === 1 && cg.current && cg.pages === 3, "Erzähltext geändert und gespeichert (rev 1)");
      g = await tool("get_lesson", { lesson_id: les2.id });
      ok(g.content[0].text.includes("„Bildkarten – Josef in Ägypten.pdf“ (von dir gestaltet; 3 Karten, Bilder bereit; Eltern sehen sie: ja)") && g.content[0].text.includes("  2. Josef erklärt dem Pharao seine Träume."),
        "get_lesson: Abschnitt „Bildkarten“ mit den geänderten Texten");
      ok((await tool("set_picture_card_texts", { file_id: cardId, erzaehltexte: ["a", "b"] })).content[0].text.includes("Achtung: Die Bildkarten haben 3 Karten, du hast 2 Erzähltexte"), "set_picture_card_texts: Abweichung gemeldet");
      ok(!(await tool("set_picture_card_texts", { file_id: cardId, erzaehltexte: ["Josef kommt nach Ägypten.", "Josef erklärt dem Pharao seine Träume.", "Josef verzeiht seinen Brüdern."] })).isError, "set_picture_card_texts: drei Texte");
      // „In den Verlaufsplan einfügen“: Verweis als eigener Stichpunkt am Ende (Bearbeiten-Modus)
      await cbox.getByRole("button", { name: "In den Verlaufsplan einfügen" }).click();
      ok((await tp.locator("#gsplan-text").inputValue()).endsWith("\n- [[pdf:" + cardId + "]]"), "„In den Verlaufsplan einfügen“: Verweis am Ende des Verlaufsplans");
      await plan.getByRole("button", { name: "Fertig" }).click();
      for (let i = 0; i < 30 && !saved.endsWith("[[pdf:" + cardId + "]]"); i++) { await sleep(300); saved = (await T("GET", "/api/teacher/lessons/" + les2.id)).data.lesson.portal; }
      ok(saved.endsWith("- [[pdf:" + cardId + "]]") && (await plan.locator("a.pdfref").last().textContent()).startsWith("Bildkarten – Josef in Ägypten.pdf"), "Verlaufsplan: Bildkarten gelb markiert");
      // Hochladen: Freigabe aus, Hinweis auf Verlagskarten; Bilder entstehen sofort; nicht im Materialkasten
      ok(!(await cbox.locator("#gs-cards-share").isChecked()) && (await cbox.textContent()).includes("Bildkarten von Verlagen dürfen meist nicht online weitergegeben werden"), "Hochladen: „Eltern dürfen diese Bildkarten sehen“ zunächst aus, Hinweis auf Verlagskarten");
      await cbox.locator("#gs-cards-file").setInputFiles({ name: "Arche Noah.pdf", mimeType: "application/pdf", buffer: await textPdf([["Karte eins"], ["Karte zwei"]]) });
      const upSet = cbox.locator(".cardset", { hasText: "Arche Noah.pdf" });
      await upSet.locator(".cs-state", { hasText: "2 Karten · Bilder bereit" }).waitFor({ timeout: 60000 });
      const upl = (await T("GET", "/api/teacher/lessons/" + les2.id)).data.files.find((f) => f.name === "Arche Noah.pdf");
      ok(upl && upl.area === "teacher" && upl.status === "ready" && upl.cards.share === false && upl.cards.current && upl.cards.pages === 2 && await upSet.locator("img.cs-thumb").count() === 2
        && (await upSet.locator(".cs-warn").textContent()).includes("Zu Karte 1 fehlt der Erzähltext."), "hochgeladene Bildkarten: 2 Karten, für Eltern nicht freigegeben, fehlende Erzähltexte gemeldet");
      ok(await tp.locator("#gs-material").getByText("Arche Noah.pdf").count() === 0 && await tp.locator("#gs-material").getByText("Bildkarten – Josef").count() === 0
        && (await T("GET", "/api/teacher/cards/pending")).data.files.length === 0, "Bildkarten nicht im Materialkasten; keine Bilder mehr ausstehend");
      await upSet.getByRole("button", { name: "Löschen" }).click();
      await tp.locator(".modal").getByRole("button", { name: "Endgültig löschen" }).click();
      await upSet.waitFor({ state: "detached", timeout: 10000 });
      ok(!(await T("GET", "/api/teacher/lessons/" + les2.id)).data.files.some((f) => f.name === "Arche Noah.pdf"), "hochgeladene Bildkarten gelöscht");
      await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-grundschulsitzung.png"), fullPage: true });
    }

    /* ---------- Elternansicht (Grundschule) ---------- */
    step("Elternansicht: geheimer Link, erst nach dem Ende, Bildkarten, Material bis zum Zwischenstopp, vorherige Sitzungen");
    let parentToken = null, parentLessonId = null, parentCardId = null;
    {
      const gl = (await T("GET", "/api/teacher/lessons?subject=gs&klass=" + gsRelId)).data.lessons.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const [les1, les2] = gl;
      parentLessonId = les2.id;
      const g1 = (await T("GET", "/api/teacher/lessons/" + les1.id)).data, g2 = (await T("GET", "/api/teacher/lessons/" + les2.id)).data;
      const fileId = (d, name) => (d.files.find((f) => f.name === name) || {}).id;
      const vorId = fileId(g1, "Vorlesetext Josef.pdf"), abId = fileId(g2, "Arbeitsblatt Josef in Ägypten.pdf"), raeId = fileId(g2, "Rätsel Pyramide.pdf"), cardId = fileId(g2, "Bildkarten – Josef in Ägypten.pdf");
      parentCardId = cardId;
      ok(!!(vorId && abId && raeId && cardId), "Material und Bildkarten aus dem vorigen Schritt vorhanden");
      // Verlaufsplan: die Geschichte (Bildkarten) und das Arbeitsblatt vor dem Zwischenstopp, das Rätsel danach
      const plan = "**1) Ankommen im Sitzkreis (5 Min.)**\n- Begrüßungslied\n**2) Erzählung mit Bildkarten (15 Min., Sitzkreis)**\n- __Lehrkraft liest [[pdf:" + vorId + "]] vor.__\n- [[pdf:" + cardId + "]] Karten der Reihe nach zeigen\n" +
        "**3) Arbeitsblatt (15 Min., Einzelarbeit)**\n- [[pdf:" + abId + "]]\n⏸ Zwischenstopp\n**4) Rätsel (10 Min., Partnerarbeit)**\n- [[pdf:" + raeId + "]]";
      let g = await tool("save_verlaufsplan", { lesson_id: les2.id, text: plan, base_version: g2.lesson.portalVersion });
      ok(!g.isError && g.content[0].text.includes("Eltern sehen nach der Stunde: „Bildkarten – Josef in Ägypten.pdf“, „Arbeitsblatt Josef in Ägypten.pdf“."), "Verlaufsplan: Bildkarten und Arbeitsblatt vor dem Zwischenstopp");
      const day = (n) => berlinAt(Date.now() + n * 86400e3).date;
      await T("PATCH", "/api/teacher/lessons/" + les2.id, { date: day(1), startTime: "08:00" });   // noch nicht stattgefunden
      // a) Lehrkraft kopiert den Link (Zwischenablage), Rückfall: markiertes Feld zum Kopieren
      await tp.goto(BASE + "/#/lk/s/" + les2.id);
      await tp.locator("#gs-copy").waitFor({ timeout: 15000 });
      await tp.evaluate(() => navigator.clipboard.writeText(""));
      await tp.locator("#gs-copy").click();
      await tp.locator(".toast", { hasText: "Sitzungslink für Eltern kopiert." }).waitFor({ timeout: 10000 });
      const url = await tp.evaluate(() => navigator.clipboard.readText());
      ok(new RegExp("^" + BASE + "/#/eltern/[A-Za-z0-9_-]{32}$").test(url), "„Sitzungslink für Eltern kopieren“: geheimer Link in der Zwischenablage");
      parentToken = url.split("/").pop();
      const lrow = (await T("GET", "/api/teacher/lessons/" + les2.id)).data;
      ok(lrow.lesson.hasParentLink === true && !JSON.stringify(lrow).includes(parentToken), "Sitzung: hat einen Elternlink, das Token steht nie in der Antwort");
      ok((await tool("get_lesson", { lesson_id: les2.id })).content[0].text.includes(parentToken) === false, "get_lesson ohne Token");
      await tp.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("verweigert")); document.execCommand = () => false; });
      await tp.locator("#gs-copy").click();
      const lm = tp.locator(".modal", { hasText: "Die Zwischenablage ließ sich nicht verwenden" });
      await lm.waitFor({ timeout: 10000 });
      await tp.waitForFunction(() => { const i = document.getElementById("gs-link-input"); return i && document.activeElement === i && i.selectionStart === 0 && i.selectionEnd === i.value.length; }, null, { timeout: 5000 }).catch(() => {});
      ok(await lm.locator("#gs-link-input").inputValue() === url && await lm.locator("#gs-link-input").getAttribute("readonly") !== null
        && await tp.evaluate(() => { const i = document.getElementById("gs-link-input"); return document.activeElement === i && i.selectionEnd - i.selectionStart === i.value.length; }),
        "Zwischenablage gesperrt: Dialog „Sitzungslink für Eltern“ mit markiertem, schreibgeschütztem Link");
      await lm.locator("footer").getByRole("button", { name: "Schließen" }).click();
      await tp.reload();
      // b) Eltern: frischer Browser ohne gespeicherte Daten; vor dem Ende nur „noch nicht stattgefunden“
      const ectx = await browser.newContext({ viewport: { width: 1180, height: 900 } }); const ep = await ectx.newPage(); watch(ep, "Eltern");
      const ereq = []; ep.on("request", (r) => ereq.push(r.url()));
      await ep.goto(url);
      await ep.locator(".parents-view h1").waitFor({ timeout: 15000 });
      let etext = await ep.locator("main").textContent();
      ok(etext.includes("Diese Unterrichtssitzung hat noch nicht stattgefunden. Sie können sie hier ab 08:45 Uhr ansehen.") && (await ep.locator("h1").textContent()).startsWith("Unterrichtssitzung am ")
        && !etext.includes("Malstifte") && !etext.includes(g2.lesson.title) && await ep.locator(".cardview").count() === 0 && (await ep.locator(".topbar").textContent()).includes("Elternansicht")
        && await ep.locator(".topbar a").count() === 0, "vor dem Ende: „Diese Unterrichtssitzung hat noch nicht stattgefunden.“ – kein Inhalt, keine Links in andere Bereiche");
      // c) nach dem Ende (gestern): Hinweis rot ganz oben, Bildkarten, Inhalt, Hausaufgabe, nur das Material bis zum Zwischenstopp
      // gestern bzw. vorgestern – aber immer vor den übrigen Sitzungen der Einheit (sie liegen in der laufenden Woche ab Montag; ab Donnerstag
      // lägen Sitzung 3 und 4 sonst schon davor und gehörten zu den vorherigen Sitzungen des Links)
      const firstOther = gl.slice(2).map((l) => l.date).filter(Boolean).sort()[0];
      const dPrev = [day(-1), firstOther ? addDays(firstOther, -1) : null].filter(Boolean).sort()[0], dPrev1 = addDays(dPrev, -1);
      await T("PATCH", "/api/teacher/lessons/" + les1.id, { date: dPrev1, startTime: "08:00" });
      await T("PATCH", "/api/teacher/lessons/" + les2.id, { date: dPrev, startTime: "08:00" });
      await ep.reload();
      await ep.locator(".parents-view h1", { hasText: g2.lesson.title }).waitFor({ timeout: 15000 });
      const heads = await ep.locator(".parents-view h1, .parents-view h2").allTextContents();
      ok(JSON.stringify(heads) === JSON.stringify(["Hinweis der Lehrkraft", g2.lesson.title, "Die Geschichte zum Nacherzählen", "Inhalt der Unterrichtsstunde", "Hausaufgabe", "Material für die Schüler"])
        && await ep.evaluate(() => { const n = document.querySelector(".parents-view").firstElementChild; return n.matches("section.alarm") && n.getAttribute("role") === "note" && getComputedStyle(n).backgroundColor !== "rgba(0, 0, 0, 0)"; })
        && (await ep.locator(".parent-note").textContent()).includes("Bitte Malstifte mitgeben."), "Reihenfolge: Hinweis der Lehrkraft (rot) ganz oben, Titel, Bildkarten, Inhalt, Hausaufgabe, Material");
      ok((await ep.locator(".pv-meta").textContent()).startsWith("Religion · Jahrgang 2 (Klassen 2a, 2b) · ") && (await ep.locator(".pv-summary").textContent()).includes("Wir haben gehört, wie Josef nach Ägypten kam.")
        && (await ep.locator(".pv-homework").textContent()).includes("Male ein Bild von Josef.") && await ep.title() === "Unterricht am " + dPrev.split("-").reverse().join("."),
        "Kurs, Inhalt der Unterrichtsstunde, Hausaufgabe, Titel des Tabs");
      const cv = ep.locator(".pv-cards figure.cardview");
      await cv.locator(".cv-count", { hasText: "Karte 1 von 3" }).waitFor({ timeout: 10000 });
      ok(await ep.locator(".pv-cards").getAttribute("aria-label") === "Bildkarten: Bildkarten – Josef in Ägypten" && (await cv.locator("figcaption").textContent()) === "Josef kommt nach Ägypten."
        && await cv.getByRole("button", { name: "Vorherige Karte" }).getAttribute("aria-disabled") === "true", "Bildkarten: Karte 1 von 3 mit dem Erzähltext");
      await cv.getByRole("button", { name: "Nächste Karte" }).focus();
      await ep.keyboard.press("ArrowRight");
      await cv.locator(".cv-count", { hasText: "Karte 2 von 3" }).waitFor({ timeout: 5000 });
      ok((await cv.locator("figcaption").textContent()) === "Josef erklärt dem Pharao seine Träume." && await cv.locator("img").evaluate((im) => (im.complete ? im.naturalWidth > 0 : new Promise((r) => { im.onload = () => r(im.naturalWidth > 0); im.onerror = () => r(false); }))),
        "Pfeiltaste → Karte 2 von 3 mit Erzähltext, Bild geladen (signierter Link)");
      await ep.screenshot({ ...SHOT, path: join(OUT, "eltern-sitzung.png"), fullPage: true });
      const flinks = await ep.locator(".pv-files a").allTextContents();
      ok(flinks.length === 1 && flinks[0].startsWith("Arbeitsblatt Josef in Ägypten.pdf (PDF") && !etext.includes("Rätsel") && !(await ep.locator("main").textContent()).includes("Rätsel Pyramide")
        && !(await ep.locator("main").textContent()).includes("Vorlesetext") && await ep.locator(".pv-files a").getAttribute("target") === "_blank",
        "Material: nur das Arbeitsblatt vor dem Zwischenstopp (kein Rätsel danach, kein Material der Lehrkraft), Link in einen neuen Tab");
      const dlReq = ectx.waitForEvent("request", { predicate: (q) => q.url().includes("/api/dl/" + abId), timeout: 20000 }).catch(() => null);
      const [np] = await Promise.all([ectx.waitForEvent("page"), ep.locator(".pv-files a").first().click()]);
      const q = await dlReq, res = q ? await fetch(q.url()) : null;
      ok(res && res.status === 200 && res.headers.get("content-type") === "application/pdf" && /^inline/.test(res.headers.get("content-disposition") || ""), "PDF der Kinder öffnet sich im neuen Tab (signierter Link)");
      await np.close().catch(() => {});
      // Hausaufgabe nur, wenn eine eingetragen ist
      await T("PATCH", "/api/teacher/lessons/" + les2.id, { homework: "" });
      await ep.reload();
      await ep.locator(".parents-view h1", { hasText: g2.lesson.title }).waitFor({ timeout: 15000 });
      ok(await ep.locator(".pv-homework").count() === 0 && !(await ep.locator("main").textContent()).includes("Hausaufgabe"), "ohne Hausaufgabe: kein Abschnitt „Hausaufgabe“");
      await T("PATCH", "/api/teacher/lessons/" + les2.id, { homework: "Male ein Bild von Josef." });
      // d) vorherige Sitzungen dieses Schuljahres → eine andere Sitzung öffnen
      await ep.reload();
      await ep.getByRole("button", { name: "Vorherige Unterrichtssitzungen dieses Schuljahres ansehen" }).click();
      await ep.locator("h2", { hasText: "Unterrichtssitzungen dieses Schuljahres" }).waitFor({ timeout: 10000 });
      const items = await ep.locator(".pv-sessions li").allTextContents();
      ok(items.length === 2 && items[0].includes(g2.lesson.title) && items[0].includes("(diese Sitzung)") && items[1].includes(g1.lesson.title) && await ep.locator(".pv-sessions a").count() === 1,
        "Liste: diese und die vorige Sitzung (keine künftigen, kein anderer Kurs)");
      await ep.locator(".pv-sessions a").click();
      await ep.waitForURL(new RegExp("#/eltern/" + parentToken + "/s/" + les1.id + "$"));
      await ep.locator(".parents-view h1", { hasText: g1.lesson.title }).waitFor({ timeout: 15000 });
      ok(await ep.evaluate(() => document.activeElement && document.activeElement.tagName === "H1") && (await ep.locator(".pv-back").textContent()) === "← Zur Sitzung vom " + dPrev.split("-").reverse().join(".")
        && !(await ep.locator("main").textContent()).includes("Vorlesetext"), "andere Sitzung: Fokus auf der Überschrift, „← Zur Sitzung vom …“, kein Material der Lehrkraft");
      await ep.locator(".pv-back").click();
      await ep.locator(".parents-view h1", { hasText: g2.lesson.title }).waitFor({ timeout: 15000 });
      // e) Schutz: veränderter Link, fremde Sitzung, keine internen Felder, Kopfzeilen, nur eigene Herkunft, nichts gespeichert
      const P = (path, body, ip) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (x) => ({ status: x.status, headers: x.headers, data: await x.json().catch(() => null) }));
      const pj = await P("/api/eltern/sitzung", { token: parentToken });
      ok(pj.status === 200 && pj.headers.get("x-robots-tag") === "noindex, nofollow" && pj.headers.get("cache-control") === "no-store" && !("ideas" in pj.data) && !("portal" in pj.data)
        && !JSON.stringify(pj.data).includes("Zwischenstopp") && !JSON.stringify(pj.data).includes(g2.lesson.code || "§§"), "Antwort an Eltern: keine Ideen, kein Verlaufsplan, kein Code; no-store und X-Robots-Tag");
      ok((await P("/api/eltern/sitzung", { token: parentToken, lessonId })).status === 403 && (await P("/api/eltern/sitzung", { token: parentToken, lessonId: gl[2].id })).status === 403,
        "Sitzung eines anderen Kurses bzw. eine spätere: 403");
      ok((await P("/api/eltern/datei", { token: parentToken, lessonId: les2.id, fileId: raeId })).status === 404 && (await P("/api/eltern/datei", { token: parentToken, lessonId: les2.id, fileId: abId })).status === 200,
        "PDF-Link nur für sichtbares Material (nicht für das Rätsel nach dem Zwischenstopp)");
      ok(((await fetch(BASE + "/")).headers.get("x-robots-tag") || "") === "noindex, nofollow" && await ep.locator('meta[name="robots"][content="noindex, nofollow"]').count() === 1, "Seite: X-Robots-Tag und <meta robots> noindex");
      const bad = parentToken.slice(0, -1) + (parentToken.endsWith("A") ? "B" : "A");
      await ep.goto(BASE + "/#/eltern/" + bad);
      await ep.locator(".notice.err").waitFor({ timeout: 15000 });
      ok((await ep.locator(".notice.err").textContent()) === "Dieser Link ist ungültig oder wurde von der Lehrkraft erneuert. Bitte fragen Sie die Lehrkraft nach dem aktuellen Link.", "veränderter Link: Meldung „ungültig oder erneuert“");
      ok(ereq.every((u) => u.startsWith(BASE + "/") || u.startsWith("data:") || u.startsWith("blob:")) && ereq.some((u) => u.includes("/api/card/")), "Elternansicht: nur Anfragen an den eigenen Server (" + ereq.length + ")");
      ok(await ep.evaluate(() => localStorage.length === 0 && sessionStorage.length === 0) && (await ectx.cookies()).length === 0, "Elternansicht speichert nichts im Browser");
      await ectx.close();
      // f) Vorschau der Lehrkraft („Elternansicht ausprobieren“), Bildkarten ohne Freigabe sind für Eltern unsichtbar
      const [pv] = await Promise.all([tctx.waitForEvent("page"), tp.locator("#gs-try").click()]);
      watch(pv, "Vorschau Eltern");
      await pv.locator(".pv-banner").waitFor({ timeout: 15000 });
      ok((await pv.locator(".pv-banner").textContent()).startsWith("Vorschau: So sehen Eltern diese Sitzung nach dem Unterricht (freigeschaltet ab ") && await pv.locator(".pv-cards").count() === 1
        && await pv.locator('.topbar nav a[aria-current="page"]').textContent() === "Grundschule" && await pv.locator(".pv-files a").getAttribute("href") === "#/lk/datei/" + abId,
        "„Elternansicht ausprobieren“: Vorschau mit Hinweis, Bildkarten und Material (Dateien über die Lehrkraft)");
      let cg = (await T("GET", "/api/teacher/files/" + cardId + "/cards")).data;
      await T("PUT", "/api/teacher/files/" + cardId + "/cards", { share: false, rev: cg.rev });
      await pv.reload();
      await pv.locator(".pv-banner").waitFor({ timeout: 15000 });
      ok(await pv.locator(".pv-cards").count() === 0 && !(await P("/api/eltern/sitzung", { token: parentToken })).data.cards, "Bildkarten ohne Freigabe: Eltern sehen sie nicht");
      cg = (await T("GET", "/api/teacher/files/" + cardId + "/cards")).data;
      await T("PUT", "/api/teacher/files/" + cardId + "/cards", { share: true, rev: cg.rev });
      await pv.close();
      // g) „Link erneuern“: der bisherige Link funktioniert danach nicht mehr
      await tp.locator("#gs-parents details.gs-renew > summary").click();
      await tp.locator("#gs-renew").click();
      await tp.locator(".modal").getByRole("button", { name: "Neuen Link erzeugen" }).click();
      await tp.locator(".toast", { hasText: "Neuer Sitzungslink erzeugt" }).waitFor({ timeout: 10000 });
      const t2 = (await T("GET", "/api/teacher/lessons/" + les2.id + "/parent-link")).data.token;
      ok(t2 && t2 !== parentToken && (await P("/api/eltern/sitzung", { token: parentToken })).status === 404 && (await P("/api/eltern/sitzung", { token: t2 })).status === 200, "„Link erneuern“: neuer Link, der alte ist ungültig");
      parentToken = t2;
      await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-grundschulsitzung-eltern.png"), fullPage: false });
    }

    step("Grundschule: Krankmeldung verschiebt die Stunden, roter Kasten, Überarbeitung mit Claude, rückgängig");
    let gsNoah = null;   // Einheit „Noah“ (für die Mobil-Prüfung: roter Kasten, Ausfall-Eintrag)
    {
      const { berlinToday } = await import("../../public/shared.js");
      const { calendarWeek, computeSlots, lessonSlots } = await import("../../public/planning.js");
      const P = (path, body) => fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(async (x) => ({ status: x.status, data: await x.json().catch(() => null) }));
      const longDay = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
      // a) eigene Einheit im Religionskurs zwei Wochen voraus (Mo–Fr 08:00 aus den Kurseinstellungen); Ende = Tag des 4. Termins → 4 Stunden
      //    (die Einheit „Josef“ der Schritte davor liegt in der laufenden Woche, zum Teil schon in der Vergangenheit)
      const mon2 = addDays(calendarWeek(berlinToday()), 14);
      const nu = (await T("POST", "/api/teacher/units", { subject: "gs", klass: gsRelId, title: "Noah und die Arche" })).data.unit;
      const wd = nu.params.weekdays;
      const end4 = lessonSlots(computeSlots({ weekdays: wd, start: mon2, end: addDays(mon2, 13) }))[3].date;
      await T("PATCH", "/api/teacher/units/" + nu.id, { params: { weekdays: wd, start: mon2, end: end4 } });
      let g = await tool("save_unit_plan", { unit_id: nu.id, plan: { titel: "Noah und die Arche", lernaufgabe: "Die Arche als Bodenbild gestalten", schritte: [{ titel: "Noah", beschreibung: "Geschichte hören und nacherzählen" }] },
        stunden: ["Wer war Noah?", "Warum baut Noah eine Arche?", "Die Tiere kommen", "Der Regenbogen"].map((q) => ({ stundenfrage: q, ablauf: ["Sitzkreis"], schritt: 0 })) });
      const made = (await T("POST", "/api/teacher/units/" + nu.id + "/sessions")).data;
      const byRow = new Map(made.unit.lessons.map((l) => [l.row, l]));
      const nl = made.unit.rows.map((r) => byRow.get(r.uid)), old = nl.map((l) => l.date);
      ok(!g.isError && made.created === 4 && old.join() === lessonSlots(computeSlots({ weekdays: wd, start: mon2, end: end4 })).map((x) => x.date).join(), "Einheit „Noah“ mit 4 Sitzungen (" + old.join(", ") + ")");
      const tok2 = (await T("POST", "/api/teacher/lessons/" + nl[1].id + "/parent-link", {})).data.token;
      // b) Krankmeldung auf der Seite der 2. Sitzung: Vorschau im Dialog, ausführen
      await tp.goto(BASE + "/#/lk/s/" + nl[1].id);
      await tp.locator("#gs-sick-btn").waitFor({ timeout: 15000 });
      ok(await tp.locator("#gs-sick h2").textContent() === "Krankheit" && await tp.locator(".revisebox").count() === 0, "Sitzung: Karte „Krankheit“, noch kein roter Kasten");
      await tp.locator("#gs-sick-btn").click();
      const cm = tp.locator(".modal", { hasText: "Stunde ausfallen lassen?" });
      await cm.locator(".cancel-table tbody tr").nth(2).waitFor({ timeout: 15000 });
      const ctext = await cm.textContent(), trs = await cm.locator(".cancel-table tbody tr").allTextContents();
      ok(ctext.includes("Am " + longDay(old[1]) + ", fällt der Unterricht aus. Diese und alle folgenden Stunden der Einheit rücken um einen Termin nach hinten:")
        && trs.length === 3 && trs[0].includes("„Warum baut Noah eine Arche?“") && trs[0].includes(fmtDay(old[2]).slice(0, 10) + " 08:00") && trs[2].endsWith("ohne Termin")
        && ctext.includes("„Der Regenbogen“ hat danach keinen Termin – sie bleibt ohne Datum in der Einheit, bis Sie (oder Claude) die Einheit überarbeiten.")
        && ctext.includes("Eltern sehen für diesen Termin: „Der Unterricht konnte leider nicht stattfinden.“"), "Dialog „Stunde ausfallen lassen?“: Tabelle bisher/neu, letzte Stunde ohne Termin, was Eltern sehen");
      await cm.getByRole("button", { name: "Ausfallen lassen und verschieben" }).click();
      await tp.locator(".toast", { hasText: "Die Stunden sind verschoben." }).waitFor({ timeout: 15000 });
      await tp.locator(".revisebox").waitFor({ timeout: 15000 });
      const after = (await T("GET", "/api/teacher/units/" + nu.id)).data.unit;
      const ph = after.lessons.find((l) => l.cancelled), dl = (i) => after.lessons.find((l) => l.id === nl[i].id).date;
      ok([dl(0), dl(1), dl(2), dl(3)].join() === [old[0], old[2], old[3], null].join() && ph && ph.date === old[1] && after.revise.open && after.params.cancelled.length === 1,
        "verschoben: Sitzung 2 am alten Termin von 3, 3 am alten von 4, Sitzung 4 ohne Termin; Ausfall-Eintrag am " + old[1]);
      const rb = await tp.locator(".revisebox").textContent();
      ok(rb.includes("Die Einheit muss wegen der Ausfälle überarbeitet werden") && rb.includes("Ausgefallen: " + fmtDay(old[1]) + ". Unterricks hat diese und alle folgenden Stunden um je einen Termin verschoben.")
        && rb.includes("Ohne Termin: „Der Regenbogen“ (Ende der Einheit: " + fmtDay(end4) + ").") && await tp.locator(".revisebox").getAttribute("role") === "region"
        && await tp.evaluate(() => { const s = document.querySelector(".gs-session > .stack"); return !!s && s.firstElementChild.classList.contains("revisebox") && s.children[1].id === "gsplan"; })
        && (await tp.locator("h1").textContent()) === "Warum baut Noah eine Arche?" && (await tp.locator(".pagehead .chips").textContent()).includes(fmtDay(old[2])),
        "Sitzung (jetzt am " + old[2] + "): roter Kasten ganz oben mit Ausfall und Stunde ohne Termin");
      // roter Kasten auch in der Einheit und in jeder anderen Sitzung der Einheit
      await tp.goto(BASE + "/#/lk/u/" + nu.id);
      await tp.locator(".revisebox").waitFor({ timeout: 15000 });
      // erst prüfen, wenn die Einheit aufgebaut ist – der rote Kasten der Sitzung davor erfüllt das Warten sonst schon (selten: Zählung zu früh)
      await tp.locator(".unit-table .badge", { hasText: "ohne Termin" }).first().waitFor({ timeout: 15000 }).catch(() => {});
      ok(await tp.locator("main > .revisebox, main .revisebox").count() === 1 && (await tp.locator(".unit-cancelled").textContent()).includes("Ausgefallen: " + fmtDay(old[1]) + " – Inhalt verschoben auf die nächste Stunde")
        && await tp.locator(".unit-table .badge", { hasText: "ohne Termin" }).count() === 1 && (await tp.locator(".card", { hasText: "1. Rahmendaten der Einheit" }).textContent()).includes("Ausgefallen (Krankmeldung): " + fmtDay(old[1]) + ", 08:00 – die Stunden wurden verschoben."),
        "Einheit: roter Kasten, Ausfall unter der Tabelle, „ohne Termin“, Ausfall in den Rahmendaten");
      await tp.goto(BASE + "/#/lk/s/" + nl[3].id);
      await tp.locator(".revisebox").waitFor({ timeout: 15000 });
      ok(await tp.locator(".revisebox a", { hasText: "Zur Einheit" }).getAttribute("href") === "#/lk/u/" + nu.id && (await tp.locator(".pagehead .chips").textContent()).includes("ohne Termin"),
        "andere Sitzung der Einheit (ohne Termin): roter Kasten mit „Zur Einheit“");
      // c) Elternlink der ausgefallenen Sitzung gehört jetzt zum Ausfall-Eintrag (vor dem alten Termin: „noch nicht stattgefunden“)
      const pe = await P("/api/eltern/sitzung", { token: tok2 });
      ok(pe.status === 200 && pe.data.state === "pending" && pe.data.lesson.id === ph.id && pe.data.lesson.date === old[1], "alter Elternlink der 2. Sitzung → Ausfall-Eintrag (pending bis zum Ende des alten Termins)");
      await tp.goto(BASE + "/#/lk/eltern/" + ph.id);
      await tp.locator(".pv-banner").waitFor({ timeout: 15000 });
      const ptxt = await tp.locator("main").textContent();
      ok(ptxt.includes("Der Unterricht konnte an diesem Termin leider nicht stattfinden.") && !/krank/i.test(ptxt), "Vorschau der Elternansicht des Ausfall-Eintrags: „Der Unterricht konnte … nicht stattfinden“ – nie „krank“");
      await tp.goto(BASE + "/#/lk/s/" + ph.id);
      await tp.locator("#gs-cancelled .lead a").waitFor({ timeout: 15000 });
      ok((await tp.locator("h1").textContent()) === "Ausgefallen: " + longDay(old[1]) && (await tp.locator("#gs-cancelled").textContent()).includes("Die geplante Sitzung „Warum baut Noah eine Arche?“ findet jetzt am " + fmtDay(old[2]))
        && await tp.locator("#gs-copy").count() === 1 && await tp.locator("#gsplan").count() === 0 && await tp.locator("#gs-note").count() === 1 && await tp.locator(".revisebox").count() === 1,
        "Ausfall-Eintrag: schlanke Seite (verschobene Sitzung, Elternlink, Hinweis, roter Kasten – kein Verlaufsplan)");
      // d) Wochenkalender: „Unterricht ausgefallen“ am alten Termin
      await tp.goto(BASE + "/#/lk/grundschule");
      await tp.locator(".weekcal").waitFor({ timeout: 15000 });
      for (let i = 0; i < 2; i++) await tp.locator(".weekcal").getByRole("button", { name: "Nächste Woche" }).click();
      await tp.locator(".weekcal .wk-off", { hasText: "Unterricht ausgefallen" }).waitFor({ timeout: 15000 });
      ok((await tp.locator(".weekcal .wk-off", { hasText: "Unterricht ausgefallen" }).textContent()) === "Entfällt: Grundschule Religion 2ab (Unterricht ausgefallen)", "Wochenkalender: „Entfällt: Grundschule Religion 2ab (Unterricht ausgefallen)“");
      // e) „Einheit mit Claude überarbeiten“: Prompt mit uid jeder Stunde, ohne Termin, freien Terminen
      await tp.goto(BASE + "/#/lk/u/" + nu.id);
      await tp.locator(".revisebox").getByRole("button", { name: "Einheit mit Claude überarbeiten" }).click();
      const rm = tp.locator(".modal", { hasText: "Welches Sprachmodell?" });
      await rm.waitFor();
      await tp.waitForTimeout(300);   // der Kasten lädt die Sitzungen der Einheit für den Prompt nach (auf der Einheitsseite sind sie schon da)
      await rm.getByRole("button", { name: "Prompt kopieren" }).click();
      const rp = await tp.evaluate(() => navigator.clipboard.readText());
      ok(rp.includes("an einer Grundschule in Hessen") && after.rows.every((r) => rp.includes("[uid " + r.uid + "]")) && rp.includes("[uid " + after.rows[3].uid + "] ohne Termin") && rp.includes("save_unit_plan")
        && rp.includes("Noch freie Termine bis zum Ende der Einheit: keine") && rp.includes("Wegen Ausfällen (Lehrkraft krank: " + fmtDay(old[1])), "Prompt „Einheit nach Ausfällen überarbeiten“: uid jeder Stunde, ohne Termin, freie Termine");
      await rm.getByRole("button", { name: "Schließen", exact: true }).getByText("Schließen").click();
      // f) „Krankmeldung rückgängig machen“: Termine wie vorher, Ausfall-Eintrag weg, Elternlink zurück
      await tp.locator(".revisebox").getByRole("button", { name: "Krankmeldung rückgängig machen" }).click();
      await tp.locator(".modal").getByRole("button", { name: "Rückgängig machen" }).click();
      await tp.locator(".toast", { hasText: "Krankmeldung rückgängig gemacht" }).waitFor({ timeout: 15000 });
      await tp.locator(".revisebox").waitFor({ state: "detached", timeout: 15000 });
      const und = (await T("GET", "/api/teacher/units/" + nu.id)).data.unit;
      ok(await tp.locator(".revisebox").count() === 0 && !und.revise && !und.params.cancelled && !und.lessons.some((l) => l.cancelled) && nl.every((l, i) => und.lessons.find((x) => x.id === l.id).date === old[i])
        && (await P("/api/eltern/sitzung", { token: tok2 })).data.lesson.id === nl[1].id, "rückgängig: Termine wie vorher, Ausfall-Eintrag gelöscht, Elternlink wieder bei der Sitzung, kein roter Kasten");
      // g) noch einmal krank (über die API wie der Dialog), dann überarbeitet Claude: Ende um einen Tag verlängert, save_unit_plan mit uid
      const pv = (await T("POST", "/api/teacher/lessons/" + nl[1].id + "/cancel", { dryRun: true })).data;
      ok((await T("POST", "/api/teacher/lessons/" + nl[1].id + "/cancel", { version: pv.version })).status === 200, "erneut ausfallen lassen");
      await T("PATCH", "/api/teacher/units/" + nu.id, { params: { weekdays: wd, start: mon2, end: addDays(end4, 1) } });
      g = await tool("get_unit", { unit_id: nu.id });
      const gt = g.content[0].text;
      ok(gt.includes("## Ausfälle\n- " + fmtDay(old[1]) + " 08:00: Unterricht ausgefallen (Lehrkraft krank)") && gt.includes("Noch freie Termine bis zum Ende der Einheit: " + fmtDay(addDays(end4, 1)) + " 08:00 (45 min)")
        && gt.includes("Muss überarbeitet werden: ja") && gt.includes("[ohne Termin]") && gt.includes("Ausgefallene Termine (Krankmeldung): " + fmtDay(old[1]) + " 08:00"),
        "get_unit: Ausfälle, freier Termin nach dem Verlängern (der Ausfall bleibt in den Rahmendaten), „Muss überarbeitet werden: ja“");
      const cu = (await T("GET", "/api/teacher/units/" + nu.id)).data.unit;
      g = await tool("save_unit_plan", { unit_id: nu.id, base_version: cu.version, plan: cu.plan, stunden: cu.rows.map((r) => ({ uid: r.uid, stundenfrage: r.stundenfrage, ablauf: r.ablauf, schritt: r.schritt })) });
      const fin = (await T("GET", "/api/teacher/units/" + nu.id)).data.unit;
      ok(!g.isError && g.content[0].text.includes("Termine neu verteilt: Stunde 4 „Der Regenbogen“ → " + fmtDay(addDays(end4, 1)) + " 08:00") && g.content[0].text.includes("Ohne Termin: keine.")
        && g.content[0].text.includes("Der rote Hinweis in der Einheit ist entfernt.") && fin.revise.open === false && fin.lessons.find((l) => l.id === nl[3].id).date === addDays(end4, 1),
        "save_unit_plan mit uid: Termine neu verteilt, Sitzung 4 bekommt den freien Termin, der rote Hinweis ist weg");
      await tp.goto(BASE + "/#/lk/s/" + nl[3].id);
      await tp.locator("#gsplan").waitFor({ timeout: 15000 });
      ok(await tp.locator(".revisebox").count() === 0 && (await tp.locator(".pagehead .chips").textContent()).includes(fmtDay(addDays(end4, 1))), "Sitzung 4: neuer Termin, kein roter Kasten");
      ok((await tool("save_substitute_plan", { lesson_id: nl[0].id, analyse: { kompetenz: "a", stundenfrage: "b", inhalte: [] }, schritte: [{ titel: "a", anleitung: "b" }], abgabe: "x" })).isError === true,
        "Connector: keine Vertretungsstunde in der Grundschule");
      gsNoah = { unitId: nu.id, lessons: nl.map((l) => l.id) };
    }

    /* ---------- Druckaufträge für den nächsten Arbeitstag (Anforderung 14) ---------- */
    step("Druckaufträge für den nächsten Arbeitstag: ganz oben auf beiden Startseiten, beide Schulformen, Namen wie in der Druckliste, einzeln und alle nacheinander (keine ZIP-Datei)");
    {
      const { berlinToday, daysBetween } = await import("../../public/shared.js");
      const { nextWorkday } = await import("../../public/planning.js");
      const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
      const longDay = (d) => DAYS[new Date(d + "T12:00:00Z").getUTCDay()] + ", " + d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4);
      // je Schulform eine Einheit mit genau einer Stunde am nächsten Arbeitstag – er ist damit der Tag der Druckaufträge, an jedem Wochentag des Laufs
      const now0 = berlinToday(), cand = nextWorkday(now0), wd = new Date(cand + "T12:00:00Z").getUTCDay();
      const oneLesson = async (subject, klass, time, title) => {
        const u = (await T("POST", "/api/teacher/units", { subject, klass, title, params: { start: cand, end: cand, weekdays: [{ day: wd, minutes: 45, time }] } })).data.unit;
        await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: title, lernaufgabe: "Lernaufgabe: " + title }, rows: [{ stundenfrage: title, ablauf: ["Einstieg"], date: cand, time, minutes: 45 }] });
        return (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit.lessons[0].id;
      };
      const gymL = await oneLesson("powi", "9D", "07:50", "Wählen ab 16?"), gsL = await oneLesson("gs", gsRelId, "09:40", "Die Schöpfung");
      const a4 = async (label) => { const d = await PDFDocument.create(); d.addPage([595.28, 841.89]).drawText(label, { x: 50, y: 760, size: 20 }); return Buffer.from(await d.save()); };
      const up = (path, buf) => fetch(BASE + path, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/pdf" }, body: buf }).then((x) => x.json());
      await up("/api/teacher/lessons/" + gymL + "/print?copies=27&duplex=0&name=" + encodeURIComponent("Wahlplakat.pdf"), await a4("Wahlplakat"));
      r = await tool("add_print_material", { lesson_id: gymL, titel: "Kaertchen Wahlrecht", markdown: "# Kärtchen\n\n- aktives Wahlrecht\n- passives Wahlrecht", anzahl: 14, beidseitig: false, farbe: false });
      ok(!r.isError, "Gymnasium (PoWi 9D, nächster Arbeitstag): PDF und Textmaterial auf der Druckliste");
      const kid = (await up("/api/teacher/lessons/" + gsL + "/files?area=student&name=" + encodeURIComponent("Schoepfung Arbeitsblatt.pdf"), await a4("Schoepfung"))).file;
      await T("PATCH", "/api/teacher/files/" + kid.id, { copies: 22 });
      r = await tool("add_material_pdf", { lesson_id: gsL, bereich: "druck", titel: "Ausmalbild Schoepfung", html: "<h1>Ausmalbild</h1><p>Licht und Dunkel</p>", anzahl: 22, beidseitig: false, farbe: false });
      ok(!r.isError, "Grundschule (Religion 2ab): PDF der Kinder mit „Auch ausdrucken (22×)“ und eine von Claude gestaltete Druckvorlage");
      const pn = await T("GET", "/api/teacher/print-next");
      const pnFiles = pn.data.sessions.flatMap((x) => x.files), ready = pnFiles.filter((f) => !(f.design && f.status !== "ready")).map((f) => f.printName);
      ok(pn.status === 200 && pn.data.candidate === cand && pn.data.date === cand && (await fetch(BASE + "/api/teacher/print-next")).status === 401,
        "GET /api/teacher/print-next: Tag " + cand + " (heute " + now0 + "), nur angemeldet");
      // Startseite Gymnasium: ganz oben, Tag, beide Schulformen gruppiert, Namen wie in der Druckliste der Sitzung
      await tp.goto(BASE + "/#/lk");
      const card = tp.locator(".printnext"), gymG = card.locator(".pn-group", { has: tp.locator('a[href="#/lk/s/' + gymL + '"]') }), gsG = card.locator(".pn-group", { has: tp.locator('a[href="#/lk/s/' + gsL + '"]') });
      await gymG.waitFor({ timeout: 15000 });
      const dayWant = "für " + (daysBetween(now0, cand) === 1 ? "morgen, " : "") + longDay(cand);
      ok(await printTop() && await card.locator(".pn-ico svg").count() === 1 && (await card.locator("#pn-day").textContent()) === dayWant, "Startseite: Feld ganz oben mit Drucker-Symbol und Tag („" + dayWant + "“)");
      const gymNames = await gymG.locator(".pn-row .name").allTextContents(), gsNames = await gsG.locator(".pn-row .name").allTextContents();
      ok((await gymG.locator("h3").textContent()) === "07:50 PoWi 9D – Wählen ab 16?" && (await gsG.locator("h3").textContent()) === "09:40 Grundschule Religion 2ab – Die Schöpfung"
        && JSON.stringify(gymNames) === JSON.stringify(["27x - einseitig - sw - Wahlplakat.pdf", "14x - einseitig - sw - Kaertchen Wahlrecht.pdf"])
        && JSON.stringify(gsNames) === JSON.stringify(["22x - beidseitig - sw - Schoepfung Arbeitsblatt.pdf", "22x - einseitig - sw - Ausmalbild Schoepfung.pdf"]),
        "je Sitzung eine Gruppe (Beginn, Fach/Klasse bzw. Grundschulkurs, Titel) mit den Druck-Namen: " + gymNames.concat(gsNames).join(" | "));
      // einzeln herunterladen (PDF über den signierten Link, Textmaterial als A4-PDF) – Name wie in der Sitzung
      let [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), gymG.getByRole("button", { name: "Herunterladen – 27x - einseitig - sw - Wahlplakat.pdf" }).click()]);
      const one = readFileSync(await dl.path());
      ok(dl.suggestedFilename() === "27x - einseitig - sw - Wahlplakat.pdf" && one.subarray(0, 5).toString() === "%PDF-", "Einzel-Download: „" + dl.suggestedFilename() + "“");
      [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), gymG.getByRole("button", { name: "Herunterladen – 14x - einseitig - sw - Kaertchen Wahlrecht.pdf" }).click()]);
      ok(dl.suggestedFilename() === "14x - einseitig - sw - Kaertchen Wahlrecht.pdf" && readFileSync(await dl.path()).subarray(0, 5).toString() === "%PDF-", "Textmaterial als A4-PDF: „" + dl.suggestedFilename() + "“");
      // „Alle Dateien herunterladen“: nacheinander je eine Datei, keine ZIP-Datei, Fortschritt in der Statuszeile
      const got = [], onDl = (d) => got.push(d);
      tp.on("download", onDl);
      const allBtn = card.locator("button.pn-all");   // während des Laufs heißt der Knopf „Lade die Dateien …“
      await allBtn.click();
      await card.locator("#pn-status", { hasText: /^Lade 1 von / }).waitFor({ timeout: 10000 });
      const during = await allBtn.getAttribute("aria-disabled");
      await card.locator("#pn-status", { hasText: /^Fertig/ }).waitFor({ timeout: 90000 });
      await tp.waitForTimeout(500);
      tp.off("download", onDl);
      const allNames = got.map((d) => d.suggestedFilename()), heads = await Promise.all(got.map(async (d) => readFileSync(await d.path()).subarray(0, 5).toString()));
      // Chromium dieser Testumgebung (ohne UTF-8-Locale) speichert Namen mit Umlauten als „download“ – Dateien anderer Sitzungen dürfen so heißen
      const sameName = (n, want) => n === want || (n === "download" && /[^\x20-\x7e]/.test(want));
      ok(during === "true" && allNames.length === ready.length && allNames.every((n, i) => sameName(n, ready[i])) && ["27x - einseitig - sw - Wahlplakat.pdf", "14x - einseitig - sw - Kaertchen Wahlrecht.pdf",
        "22x - beidseitig - sw - Schoepfung Arbeitsblatt.pdf", "22x - einseitig - sw - Ausmalbild Schoepfung.pdf"].every((n) => allNames.includes(n)) && !allNames.some((n) => /\.zip$/i.test(n)) && heads.every((x) => x === "%PDF-")
        && (await card.locator("#pn-status").textContent()).startsWith("Fertig: Alle " + ready.length + " Dateien sind einzeln heruntergeladen."),
        "„Alle Dateien herunterladen“: " + allNames.length + " einzelne PDF-Dateien nacheinander (keine ZIP-Datei), währenddessen gesperrt (" + during + "), Abschlussmeldung – " + allNames.join(" | "));
      await tp.screenshot({ ...SHOT, path: join(OUT, "druckauftraege-gymnasium.png") });
      await tp.emulateMedia({ colorScheme: "dark" }); await tp.waitForTimeout(200);
      await tp.screenshot({ ...SHOT, path: join(OUT, "druckauftraege-gymnasium-dunkel.png") });
      await tp.setViewportSize({ width: 810, height: 1080 }); await tp.waitForTimeout(200);
      await tp.screenshot({ ...SHOT, path: join(OUT, "druckauftraege-gymnasium-ipad-dunkel.png") });
      await tp.emulateMedia({ colorScheme: "light" }); await tp.waitForTimeout(200);
      await tp.screenshot({ ...SHOT, path: join(OUT, "druckauftraege-gymnasium-ipad.png") });
      // Übersicht Grundschule: dasselbe Feld ganz oben, mit beiden Schulformen
      await tp.goto(BASE + "/#/lk/grundschule");
      await gymG.waitFor({ timeout: 15000 }); await gsG.waitFor({ timeout: 15000 });
      ok(await printTop() && JSON.stringify(await gsG.locator(".pn-row .name").allTextContents()) === JSON.stringify(gsNames) && JSON.stringify(await gymG.locator(".pn-row .name").allTextContents()) === JSON.stringify(gymNames),
        "Übersicht „Grundschule“: dasselbe Feld ganz oben (vor dem Wochenkalender), mit den Druckaufträgen beider Schulformen");
      await tp.screenshot({ ...SHOT, path: join(OUT, "druckauftraege-grundschule-ipad.png") });
      await tp.emulateMedia({ colorScheme: "dark" }); await tp.waitForTimeout(200);
      await tp.screenshot({ ...SHOT, path: join(OUT, "druckauftraege-grundschule-ipad-dunkel.png") });
      await tp.setViewportSize({ width: 1440, height: 950 }); await tp.waitForTimeout(200);
      await tp.screenshot({ ...SHOT, path: join(OUT, "druckauftraege-grundschule-dunkel.png") });
      await tp.emulateMedia({ colorScheme: "light" }); await tp.waitForTimeout(200);
      await tp.screenshot({ ...SHOT, path: join(OUT, "druckauftraege-grundschule.png") });
      // „In der Sitzung bearbeiten“: Sitzung mit ihrer Druckliste im Blick (Fokus auf deren Überschrift); dort dieselben Namen
      await gsG.getByRole("link", { name: /in der Sitzung bearbeiten$/ }).click();
      await tp.waitForURL(new RegExp("#/lk/s/" + gsL + "/druckliste$"));
      await tp.locator("#printcard .printrow").first().waitFor({ timeout: 15000 });
      await tp.waitForFunction(() => document.activeElement && document.activeElement.closest("#printcard") && document.activeElement.tagName === "H2", null, { timeout: 10000 });
      ok(JSON.stringify(await tp.locator("#printcard .printrow .name").allTextContents()) === JSON.stringify(gsNames)
        && await tp.locator("#printcard h2").evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }),
        "„In der Sitzung bearbeiten“: Grundschul-Sitzung mit der Druckliste im Blick (Fokus auf „Von der Lehrkraft auszudrucken“), dieselben Namen");
      await tp.goto(BASE + "/#/lk/s/" + gymL + "/druckliste");
      await tp.locator("#printcard .printrow").first().waitFor({ timeout: 15000 });
      ok(JSON.stringify(await tp.locator("#printcard .printrow .name").allTextContents()) === JSON.stringify(gymNames), "Gymnasium: Druckliste der Sitzung nennt dieselben Namen wie das Feld");
    }

    /* ---------- GitHub Pages: dieselbe Oberfläche von einer anderen Herkunft ---------- */
    step("GitHub Pages: Oberfläche von anderer Herkunft (CORS, Live-Verbindung, Links zum Worker, Schutz gegen Einbetten)");
    execFileSync("node", ["scripts/build.mjs"], { cwd: ROOT, env: { ...process.env, PAGES_API: BASE, FEIBEITSBLATT_API: FB }, stdio: "ignore" });
    const pagesSrv = await startStatic(join(ROOT, "dist-pages"), PAGES_PORT);
    try {
      const html = readFileSync(join(ROOT, "dist-pages/index.html"), "utf8");
      ok(html.includes('<meta name="unterricks-api" content="' + BASE + '">') && html.includes("connect-src 'self' " + BASE + " ws://localhost:" + PORT) && !existsSync(join(ROOT, "dist-pages/_headers")),
        "Pages-Build: Server-Adresse und Sicherheitsregeln als <meta>, keine _headers");
      const pre = await fetch(BASE + "/api/student/me", { method: "OPTIONS", headers: { Origin: PAGES, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
      const evil = await fetch(BASE + "/api/student/me", { method: "OPTIONS", headers: { Origin: "http://localhost:9999", "Access-Control-Request-Method": "GET" } });
      ok(pre.status === 204 && pre.headers.get("access-control-allow-origin") === PAGES && evil.status === 403 && !evil.headers.get("access-control-allow-origin"), "CORS nur für die eingetragene Pages-Adresse");
      const pctx = await browser.newContext({ ...devices["iPad (gen 7)"] }); const pp = await pctx.newPage(); watch(pp, "Pages-Schüler");
      const cspErr = []; pp.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|CORS|Access-Control/i.test(m.text())) cspErr.push(m.text()); });
      const sockets = []; pp.on("websocket", (w) => sockets.push(w.url()));
      const apiCalls = []; pp.on("request", (r) => { if (r.url().includes("/api/")) apiCalls.push(r.url()); });
      await pp.goto(PAGES + "/");
      await pp.fill("#spw", "Feindt"); await pp.getByRole("button", { name: "Weiter" }).click();
      await pp.waitForURL(/#\/schueler$/); await pp.locator(".tiles .tile").first().waitFor();
      await pp.getByRole("button", { name: "Politik und Wirtschaft" }).click(); await pp.getByRole("button", { name: "Q2 GK", exact: true }).click();
      await pp.getByRole("button", { name: "Speichern und weiter" }).click();
      await pp.fill("#code", lesson0.code); await pp.getByRole("button", { name: "Sitzung öffnen" }).click();
      await pp.waitForURL(/#\/schueler\/s\//); await pp.locator(".live").waitFor();
      await pp.waitForFunction(() => document.querySelector(".card h2") && [...document.querySelectorAll(".card h2")].some((x) => x.textContent === "Material"), null, { timeout: 15000 });
      ok(apiCalls.length > 0 && apiCalls.every((u) => u.startsWith(BASE + "/api/")), "Schüler:in auf Pages: alle Anfragen gehen an den Worker (" + apiCalls.length + ")");
      for (let i = 0; i < 40 && !sockets.length; i++) await sleep(250);
      ok(sockets.some((u) => u.startsWith("ws://localhost:" + PORT + "/api/live/")), "Live-Verbindung (WebSocket) geht an den Worker");
      const dlBtn = pp.locator(".card .item").filter({ has: pp.getByRole("button", { name: "Herunterladen" }) }).first();
      if (await dlBtn.count()) {
        const [req] = await Promise.all([pp.waitForRequest((r) => r.url().startsWith(BASE + "/api/dl/"), { timeout: 15000 }), dlBtn.getByRole("button", { name: "Herunterladen" }).click()]);
        ok(!!req, "Download-Link aus der Antwort zeigt auf den Worker");
      } else console.log("    (in dieser Sitzung gerade keine Datei zum Herunterladen – Download nicht geprüft)");
      const ptc = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const ptp = await ptc.newPage(); watch(ptp, "Pages-Lehrkraft");
      ptp.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|CORS|Access-Control/i.test(m.text())) cspErr.push(m.text()); });
      await ptp.goto(PAGES + "/#/lehrkraft"); await ptp.fill("#tu", "feindt"); await ptp.fill("#tp", T_PW);
      const tl = Date.now(); await ptp.getByRole("button", { name: "Anmelden" }).click(); await waitTeacherHome(ptp, tl, "Anmeldung auf Pages");
      { // Druckaufträge auf Pages: bei anderer Herkunft beachtet der Browser das download-Attribut nicht – trotzdem heißt jede Datei wie in der
        // Druckliste (Druckvorlage: Name vom Server; Arbeitsblatt der Kinder mit „Auch ausdrucken“: als Blob unter dem Druck-Namen)
        const want = ["27x - einseitig - sw - Wahlplakat.pdf", "22x - beidseitig - sw - Schoepfung Arbeitsblatt.pdf"], got = [];
        const pcard = ptp.locator(".printnext");
        await pcard.locator(".pn-row").first().waitFor({ timeout: 20000 });
        for (const n of want) {
          const b = pcard.getByRole("button", { name: "Herunterladen – " + n });
          if (!(await b.count())) { got.push("(fehlt)"); continue; }
          const [d] = await Promise.all([ptp.waitForEvent("download", { timeout: 30000 }), b.click()]);
          got.push(d.suggestedFilename() + (readFileSync(await d.path()).subarray(0, 5).toString() === "%PDF-" ? "" : " (keine PDF)"));
        }
        ok(JSON.stringify(got) === JSON.stringify(want), "Druckaufträge auf Pages: einzelne Downloads heißen wie in der Druckliste – " + got.join(" | "));
      }
      await ptp.goto(PAGES + "/#/lk/s/" + lessonId); await ptp.locator(".code-big").waitFor({ timeout: 20000 });
      ok(true, "Lehrkraft auf Pages: Anmeldung (mit Vorabanfrage) und Sitzung laden");
      { // Beamergerät auf Pages: der Beamer-Code kommt vom Worker (CORS), keine Anfrage an die Pages-Herkunft
        const bx = await browser.newContext({ viewport: { width: 1280, height: 720 } }); const bxp = await bx.newPage(); watch(bxp, "Pages-Beamer");
        bxp.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|CORS|Access-Control/i.test(m.text())) cspErr.push(m.text()); });
        const breq = []; bxp.on("request", (q) => { if (q.url().includes("/api/")) breq.push(q.url()); });
        await bxp.goto(PAGES + "/#/beamer");
        await bxp.locator(".beamer .bm-code", { hasText: /^\d{3} \d{3}$/ }).waitFor({ timeout: 15000 });
        ok(breq.length > 0 && breq.every((u) => u.startsWith(BASE + "/api/beamer/")), "Beamergerät auf Pages: Beamer-Code vom Worker");
        await bx.close();
      }
      { // „PDF ansehen“ öffnet den signierten Link beim Worker, nicht auf der Pages-Herkunft (dort gäbe es 404)
        const dlReq = ptc.waitForEvent("request", { predicate: (q) => q.url().includes("/api/dl/"), timeout: 15000 }).catch(() => null);
        await ptp.locator("section.card", { hasText: "Präsentation für den Unterricht" }).getByRole("button", { name: "PDF ansehen" }).click();
        const q = await dlReq, u = q ? q.url() : "";
        const res = u ? await fetch(u) : null;
        if (!(u.startsWith(BASE + "/api/dl/") && res && res.status === 200)) console.log("    PDF ansehen:", u, res && res.status);
        ok(u.startsWith(BASE + "/api/dl/") && res.status === 200 && res.headers.get("content-type") === "application/pdf" && /inline/.test(res.headers.get("content-disposition") || ""),
          "„PDF ansehen“ auf Pages: öffnet die PDF beim Worker (kein 404)");
        for (const pg of ptc.pages()) if (pg !== ptp) await pg.close().catch(() => {});
      }
      { // Elternansicht auf Pages: Seite von Pages, Daten, Kartenbilder und PDF vom Worker
        const ectx = await browser.newContext({ ...devices["iPad (gen 7)"] }); const ep = await ectx.newPage(); watch(ep, "Pages-Eltern");
        ep.on("console", (m) => { if (m.type() === "error" && /Content Security Policy|CORS|Access-Control/i.test(m.text())) cspErr.push(m.text()); });
        const ereq = []; ep.on("request", (r) => ereq.push(r.url()));
        await ep.goto(PAGES + "/#/eltern/" + parentToken);
        const cv = ep.locator(".pv-cards figure.cardview");
        await cv.locator(".cv-count", { hasText: "Karte 1 von 3" }).waitFor({ timeout: 20000 });
        const imgOk = await cv.locator("img").evaluate((im) => (im.complete ? im.naturalWidth > 0 : new Promise((r) => { im.onload = () => r(im.naturalWidth > 0); im.onerror = () => r(false); })));
        ok(imgOk && (await cv.locator("img").getAttribute("src")).startsWith(BASE + "/api/card/"), "Elternansicht auf Pages: Bildkarten vom Worker geladen");
        const dlReq = ectx.waitForEvent("request", { predicate: (q) => q.url().startsWith(BASE + "/api/dl/"), timeout: 20000 }).catch(() => null);
        const [np] = await Promise.all([ectx.waitForEvent("page"), ep.locator(".pv-files a").first().click()]);
        const q = await dlReq, res = q ? await fetch(q.url()) : null;
        ok(res && res.status === 200 && res.headers.get("content-type") === "application/pdf", "Elternansicht auf Pages: PDF beim Worker (kein 404)");
        await np.close().catch(() => {});
        ok(ereq.filter((u) => u.includes("/api/")).every((u) => u.startsWith(BASE + "/api/")) && ereq.every((u) => u.startsWith(PAGES + "/") || u.startsWith(BASE + "/") || /^(data|blob):/.test(u)),
          "Elternansicht auf Pages: nur Pages und der Worker, keine fremden Server");
        await ectx.close();
      }
      ok(cspErr.length === 0, "keine CSP- oder CORS-Fehler auf Pages" + (cspErr.length ? ": " + cspErr.slice(0, 3).join(" | ") : ""));
      const fctx = await browser.newContext(); const fp = await fctx.newPage();
      await fp.setContent('<iframe src="' + PAGES + '/" style="width:800px;height:600px"></iframe>');
      let hidden = null;
      for (let i = 0; i < 40 && hidden === null; i++) { await sleep(250); const fr = fp.frames().find((f) => f.url().startsWith(PAGES)); if (fr) hidden = await fr.evaluate(() => document.documentElement.hidden === true && !document.querySelector(".login-wrap, .topbar")).catch(() => null); }
      ok(hidden === true, "eingebettet in eine fremde Seite: Unterricks zeigt nichts");
      await fctx.close(); await ptc.close(); await pctx.close();
    } finally { pagesSrv.close(); }

    /* ---------- Sitzung als Datei ---------- */
    step("Sitzung als Datei herunterladen und in einer anderen Sitzung laden (Daten angepasst)");
    {
      const num = (iso) => iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4);
      let srcL = (await T("GET", "/api/teacher/lessons/" + lessonId)).data.lesson;
      await T("PATCH", "/api/teacher/lessons/" + lessonId, { homework: "Lies M2 bis " + num(srcL.nextDate) + ".", ideas: "Test am " + num(srcL.date) + ", Projekttag am 24.12.2030." });
      await tp.goto(BASE + "/#/lk/s/" + lessonId); await tp.reload();
      await tp.locator("#fbcard .badge.ok", { hasText: "verbunden" }).first().waitFor({ timeout: 20000 });
      const [sdl] = await Promise.all([tp.waitForEvent("download", { timeout: 60000 }), tp.locator(".sessionio").getByRole("button", { name: "Sitzung als Datei herunterladen" }).click()]);
      const sfile = await sdl.path(), sz = await readZip(new Uint8Array(readFileSync(sfile)));
      const sj = JSON.parse(new TextDecoder().decode(sz.find((x) => x.name === "sitzung.json").data));
      ok(/^Unterrickssitzung - PoWi - Q2 GK - .+ - Sitzung Nr\. 1\.zip$/.test(sdl.suggestedFilename()), "Dateiname „Unterrickssitzung - PoWi - Q2 GK - <Einheit> - Sitzung Nr. 1.zip“ (" + sdl.suggestedFilename() + ")");
      const okFiles = sj.kind === "unterricks-sitzung" && sj.lesson.homework.includes(num(srcL.nextDate)) && sj.files.some((f) => f.area === "presentation" && f.path) && sj.files.some((f) => f.kind === "link")
        && sj.files.some((f) => f.area === "print" && f.kind === "text") && !sj.files.some((f) => /Notfall-Feibeitsblatt/.test(f.name)) && sj.files.filter((f) => f.path).every((f) => sz.some((x) => x.name === f.path));
      if (!okFiles) console.log("    Inhalt:", JSON.stringify(sj.files.map((f) => f.area + ":" + f.kind + ":" + (f.path || f.name))), sz.map((x) => x.name).join(" | "));
      ok(okFiles, "Datei enthält Planung, Materialien, Links, Präsentation und Druckliste (ohne Notfall-Feibeitsblatt)");
      if (!sj.drafts.some((d) => d.title === "Mock-Blatt BVerfG")) console.log("    Entwürfe:", JSON.stringify(sj.drafts.map((d) => d.title)), "Hinweise:", JSON.stringify(sj.notes));
      ok(sj.drafts.some((d) => d.title === "Mock-Blatt BVerfG" && d.tasks.length === 2), "… und das verknüpfte Feibeitsblatt als Entwurf (Inhalt aus dem Feibeitsblatt)");
      const sDes = sj.files.find((f) => f.name === "Arbeitsblatt Gewaltenteilung.pdf");
      ok(sDes && sDes.design && sDes.rendered === true && sDes.path && new TextDecoder().decode(sz.find((x) => x.name === sDes.design).data).includes("Wer kontrolliert die Macht?"),
        "von Claude gestaltetes Material: Gestaltung als HTML-Datei (gestaltung/…) und die gedruckte PDF");
      const target = (await T("GET", "/api/teacher/lessons/" + byRow(4).id)).data.lesson;   // hat eine nächste Sitzung (Fälligkeit)
      await tp.goto(BASE + "/#/lk/s/" + target.id); await tp.locator(".sessionio").waitFor();
      await tp.locator(".sessionio input[type=file]").setInputFiles(sfile);
      const im = tp.locator(".modal", { hasText: "Sitzung aus Datei laden?" });
      await im.waitFor({ timeout: 20000 });
      ok((await im.textContent()).includes("Datum, Beginn und Dauer bleiben die dieser Sitzung"), "vor dem Übernehmen: Übersicht, was ersetzt wird und was bleibt");
      await im.getByRole("button", { name: "Übernehmen" }).click();
      await tp.locator(".modal", { hasText: "Sitzung übernommen" }).waitFor({ timeout: 120000 });
      ok((await tp.locator(".modal", { hasText: "Sitzung übernommen" }).textContent()).includes("24.12.2030"), "nicht zuordenbare Datumsangabe wird zum Prüfen genannt");
      await tp.locator(".modal").getByRole("button", { name: "Fertig" }).click();
      const tl = (await T("GET", "/api/teacher/lessons/" + target.id)).data;
      ok(tl.lesson.title === srcL.title && tl.lesson.date === target.date && tl.lesson.durationMin === target.durationMin && (tl.lesson.startTime || null) === (target.startTime || null), "Inhalte übernommen; Datum, Beginn und Dauer der geöffneten Sitzung bleiben");
      ok(!tl.lesson.homework.includes(num(srcL.nextDate)) && (!tl.lesson.nextDate || tl.lesson.homework.includes(num(tl.lesson.nextDate))) && tl.lesson.ideas.includes(num(target.date)) && tl.lesson.ideas.includes("24.12.2030"),
        "Datumsangaben an die neue Sitzung angepasst (Hausaufgabe bis zur nächsten Sitzung, Datum der Sitzung)");
      ok(tl.files.some((f) => f.area === "presentation" && f.status === "ready" && f.pages === 3 && JSON.stringify((f.codeSlides || []).map((c) => c.n)) === "[3]") && tl.files.some((f) => f.kind === "link" && f.url === "https://www.bpb.de/mediathek/video/bverfg")
        && tl.files.filter((f) => f.area === "print").length === 4 && tl.files.some((f) => f.name === "Erwartungshorizont GEHEIM.docx" && f.area === "teacher") && tl.drafts.some((d) => d.data && d.data.title === "Mock-Blatt BVerfG"),
        "Präsentation (mit Folien und erkannter Codefolie), Links, Druckliste, Lehrkraft-Material und Feibeitsblatt-Entwurf übernommen");
      const tDes = tl.files.find((f) => f.name === "Arbeitsblatt Gewaltenteilung.pdf"), tPrint = tl.files.find((f) => f.area === "print" && /Kärtchen Gewalten\.pdf$/.test(f.name));
      ok(tDes && tDes.status === "ready" && tDes.design && !tDes.design.outdated && tPrint && tPrint.design && tPrint.print.copies === 28,
        "gestaltetes Material übernommen: PDF und Gestaltung, ohne neuen Druck (auch in der Druckliste mit Anzahl)");
    }

    /* ---------- Einheit als Datei ---------- */
    step("Einheit als Datei: herunterladen (Einheit + Sitzungen) und in eine neue Einheit laden – die Sitzungen bekommen beim Anlegen ihren Inhalt");
    {
      const num = (iso) => iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4);
      const srcU = (await T("GET", "/api/teacher/units/" + unitId)).data.unit;
      await tp.goto(BASE + "/#/lk/u/" + unitId); await tp.locator("#unitio").waitFor({ timeout: 15000 });
      ok(await tp.locator("#unitio").getByRole("button", { name: "Einheit aus Datei laden" }).isDisabled(), "eine Einheit mit Sitzungen nimmt keine Datei an (nur herunterladen)");
      const [udl] = await Promise.all([tp.waitForEvent("download", { timeout: 120000 }), tp.locator("#unitio").getByRole("button", { name: "Einheit als Datei herunterladen" }).click()]);
      const ufile = await udl.path(), uz = await readZip(new Uint8Array(readFileSync(ufile)));
      const uj = uz.find((x) => /^Unterrichtseinheit - PoWi - Q2 GK - .+\.json$/.test(x.name)), ud = uj && JSON.parse(new TextDecoder().decode(uj.data));
      const folders = uz.filter((x) => /\.zip$/.test(x.name)).map((x) => x.name.split("/")[0]);
      const chrono = [...srcU.lessons].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
      ok(udl.suggestedFilename() === "Unterrichtseinheit - PoWi - Q2 GK - Gewaltenteilung und BVerfG.zip" && ud && ud.kind === "unterricks-einheit" && ud.unit.rows.length === srcU.rows.length,
        "Dateiname und Einheitsdatei („" + udl.suggestedFilename() + "“)");
      ok(folders.length === srcU.lessons.length && folders.every((f, i) => f.startsWith(String(i + 1).padStart(2, "0") + " - " + num(chrono[i].date))),
        "je Sitzung ein Ordner, chronologisch nummeriert: " + folders.slice(0, 2).join(" | ") + " …");
      ok(ud.unit.rows.every((r) => r.session && uz.some((x) => x.name === r.session)), "jede Zeile der Einheitsdatei verweist auf ihre Sitzungsdatei");
      const row0 = srcU.rows[0], s0id = srcU.lessons.find((l) => l.row === row0.uid).id;
      const inner = await readZip(uz.find((x) => x.name === ud.unit.rows[0].session).data);
      const ij = JSON.parse(new TextDecoder().decode(inner.find((x) => x.name === "sitzung.json").data));
      ok(ij.kind === "unterricks-sitzung" && ij.files.some((f) => f.area === "presentation" && inner.some((x) => x.name === f.path)), "die Sitzungsdatei darin ist eine vollständige Unterrickssitzung (mit Präsentation)");
      // neue Einheit mit anderen Terminen → Datei laden
      const start = berlinAt(Date.now() + 70 * 86400e3).date, end = berlinAt(Date.now() + 160 * 86400e3).date;
      const nu = (await T("POST", "/api/teacher/units", { subject: "powi", klass: "Q2-GK", title: "Wiederverwendet", params: { weekdays: [{ day: 3, minutes: 90, time: "09:45" }], start, end } })).data.unit;
      await tp.goto(BASE + "/#/lk/u/" + nu.id); await tp.locator("#unitio").waitFor({ timeout: 15000 });
      ok(await tp.getByRole("button", { name: "Gesicherte Einheit laden" }).count() === 1, "neue Einheit: in „Planung mit Claude“ auch „Gesicherte Einheit laden“");
      await tp.locator("#unitio input[type=file]").setInputFiles(ufile);
      const um = tp.locator(".modal", { hasText: "Einheit aus Datei laden?" }); await um.waitFor({ timeout: 20000 });
      ok((await um.textContent()).includes(srcU.lessons.length + " gesicherte Sitzungen") && (await um.textContent()).includes("Die Rahmendaten dieser Einheit bleiben"), "Übersicht vor dem Laden: Planung ersetzt, Rahmendaten bleiben, " + srcU.lessons.length + " gesicherte Sitzungen");
      await um.getByRole("button", { name: "Übernehmen" }).click();
      await tp.locator(".unit-table .badge", { hasText: "Inhalt aus Datei" }).first().waitFor({ timeout: 20000 });
      const lu = (await T("GET", "/api/teacher/units/" + nu.id)).data.unit;
      ok(lu.title === srcU.title && lu.plan.lernaufgabe === srcU.plan.lernaufgabe && lu.rows.length === srcU.rows.length && lu.rows.every((r, i) => r.stundenfrage === srcU.rows[i].stundenfrage && r.date && r.date >= start && r.minutes === 90)
        && JSON.stringify(lu.params.weekdays) === JSON.stringify([{ day: 3, minutes: 90, time: "09:45" }]) && await tp.locator(".unit-table .badge", { hasText: "Inhalt aus Datei" }).count() === srcU.rows.length,
        "Titel, Leupold-Schema und Ablauf übernommen; Rahmendaten bleiben, Termine neu verteilt; jede Stunde „Inhalt aus Datei“");
      await tp.reload(); await tp.locator(".unit-table .badge", { hasText: "Inhalt aus Datei" }).first().waitFor({ timeout: 20000 });
      ok(await tp.locator(".unit-table .badge", { hasText: "Inhalt aus Datei" }).count() === srcU.rows.length, "die gesicherten Sitzungen bleiben auf diesem Gerät auch nach dem Neuladen bereit");
      await tp.getByRole("button", { name: "Einheit festlegen und Sitzungen anlegen" }).click();
      const fm = tp.locator(".modal", { hasText: "Sitzungen gefüllt" }); await fm.waitFor({ timeout: 300000 });
      ok((await fm.textContent()).includes(srcU.lessons.length + " von " + srcU.lessons.length + " Sitzungen"), "Sitzungen angelegt und mit ihrem gesicherten Inhalt gefüllt");
      await fm.getByRole("button", { name: "Fertig" }).click();
      const nl = (await T("GET", "/api/teacher/units/" + nu.id)).data.unit, l0 = nl.lessons.find((l) => l.row === nl.rows[0].uid);
      const d0 = (await T("GET", "/api/teacher/lessons/" + l0.id)).data, s0 = (await T("GET", "/api/teacher/lessons/" + s0id)).data;
      const mat = (d) => d.files.filter((f) => f.area !== "archive" && f.source !== "notfall").map((f) => f.area + ":" + f.kind + ":" + f.name).sort().join("|");
      ok(d0.lesson.date === nl.rows[0].date && d0.lesson.title === s0.lesson.title && d0.files.some((f) => f.area === "presentation" && f.status === "ready" && f.pages === 3) && mat(d0) === mat(s0) && d0.lesson.code !== s0.lesson.code,
        "Sitzung 1 der neuen Einheit: Titel, Materialien und Präsentation (in Folien umgewandelt) aus der Datei, eigenes Datum und eigener Code");
      ok(!d0.lesson.nextDate || d0.lesson.homework.includes(num(d0.lesson.nextDate)), "Hausaufgabe: Datum an die nächste Sitzung der neuen Einheit angepasst (" + d0.lesson.homework + ")");
      ok(await tp.locator(".unit-table .badge", { hasText: "Inhalt aus Datei" }).count() === 0, "danach wartet nichts mehr auf diesem Gerät");
    }

    /* ---------- Gespeicherte Feibeitsblatt-Verbindung auf weiteren Geräten ---------- */
    step("Feibeitsblatt-Verbindung einmalig gespeichert: zweites Gerät, Gerät ohne Schlüssel, Passwortwechsel, löschen");
    {
      const d2 = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p2 = await d2.newPage(); watch(p2, "Lehrkraft Gerät 2");
      await p2.goto(BASE + "/#/lehrkraft"); await p2.fill("#tu", "feindt"); await p2.fill("#tp", T_PW);
      const t2 = Date.now(); await p2.getByRole("button", { name: "Anmelden" }).click(); await waitTeacherHome(p2, t2, "Anmeldung Gerät 2");
      await p2.goto(BASE + "/#/lk/s/" + lessonId);
      await p2.locator("#fbcard .badge.ok", { hasText: "verbunden" }).waitFor({ timeout: 20000 });
      ok(true, "zweites Gerät: nach der Anmeldung mit dem Unterricks-Passwort automatisch mit Feibeitsblatt verbunden");
      await p2.evaluate(() => new Promise((res) => { const r = indexedDB.deleteDatabase("unterricks"); r.onsuccess = r.onerror = r.onblocked = () => res(); }));
      await p2.reload();
      const upw = p2.locator("#fbcard").getByLabel("Ihr Unterricks-Passwort");
      await upw.waitFor({ timeout: 20000 });
      ok((await p2.locator("#fbcard").textContent()).includes("Entsperren Sie sie auf diesem Gerät einmal mit Ihrem Unterricks-Passwort"), "Gerät ohne Schlüssel (z. B. schon vorher angemeldet): Hinweis zum Entsperren");
      await upw.fill("falsches-passwort-1"); await p2.locator("#fbcard").getByRole("button", { name: "Entsperren" }).click();
      await p2.locator("#fbcard .err", { hasText: "falsch" }).waitFor({ timeout: 30000 });
      await upw.fill(T_PW); await p2.locator("#fbcard").getByRole("button", { name: "Entsperren" }).click();
      await p2.locator("#fbcard .badge.ok", { hasText: "verbunden" }).waitFor({ timeout: 30000 });
      await p2.reload(); await p2.locator("#fbcard .badge.ok", { hasText: "verbunden" }).waitFor({ timeout: 20000 });
      ok(true, "… falsches Passwort abgelehnt, mit dem richtigen entsperrt – danach auch nach dem Neuladen verbunden");
      const T_PW2 = T_PW + "-neu";
      const changePw = async (from, to) => {
        await p2.goto(BASE + "/#/lk/einstellungen"); await p2.locator("#co").waitFor();
        await p2.fill("#co", from); await p2.fill("#cn1", to); await p2.fill("#cn2", to);
        await p2.getByRole("button", { name: "Zugangsdaten ändern" }).click();
        await p2.locator(".toast", { hasText: "Die gespeicherte Feibeitsblatt-Verbindung bleibt erhalten" }).waitFor({ timeout: 40000 });
      };
      await changePw(T_PW, T_PW2);
      await p2.goto(BASE + "/#/lk/s/" + lessonId); await p2.reload();
      await p2.locator("#fbcard .badge.ok", { hasText: "verbunden" }).waitFor({ timeout: 20000 });
      ok(true, "Passwortwechsel: gespeicherte Verbindung neu verschlüsselt – Unterricks verbindet sich weiter automatisch");
      await changePw(T_PW2, T_PW);
      await p2.goto(BASE + "/#/lk/s/" + lessonId); await p2.reload(); await p2.locator("#fbcard .badge.ok", { hasText: "verbunden" }).waitFor({ timeout: 20000 });
      await p2.locator("#fbcard").getByRole("button", { name: "Gespeicherte Verbindung löschen" }).click();
      await p2.locator(".modal").getByRole("button", { name: "Löschen" }).click();
      await p2.locator("#fbcard .badge", { hasText: "nicht verbunden" }).waitFor({ timeout: 10000 });
      const tok2 = await p2.evaluate(() => localStorage.getItem("u.ttoken"));
      const gone = await (await fetch(BASE + "/api/teacher/fb-link", { headers: { Authorization: "Bearer " + tok2 } })).json();
      await p2.reload(); await p2.locator('#fbcard input[aria-label="Feibeitsblatt-Passwort"]').waitFor({ timeout: 20000 });
      ok(gone.link === null, "gespeicherte Verbindung gelöscht – danach sind Türcode und Feibeitsblatt-Passwort wieder nötig");
      await d2.close();
    }

    /* ---------- Schüler:innen: nach 90 Minuten abgemeldet ---------- */
    step("Schüler:innen: nach spätestens 90 Minuten abgemeldet – nach dem Passwort weiter, wo sie waren");
    {
      await sp.goto(BASE + "/#/schueler"); await sp.locator(".item").first().waitFor({ timeout: 15000 });
      const store0 = await sp.evaluate(() => JSON.stringify(localStorage)), tok0 = JSON.parse(store0)["u.stoken"];
      // die Anmeldung von sp ist schon einige Minuten alt: erst erneuern (dasselbe Gerät), damit die 90 Minuten ab jetzt zählen
      const relog = await (await fetch(BASE + "/api/student/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: "Feindt", deviceId: JSON.parse(store0)["u.dev"], token: tok0 }) })).json();
      ok(relog.ok && relog.token === tok0 && relog.authLeftMs === 90 * 60e3, "erneute Passworteingabe: dasselbe Gerät, Anmeldung wieder 90 Minuten");
      const ectx = await browser.newContext();
      await ectx.addInitScript((s) => { if (!sessionStorage.getItem("x")) { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); sessionStorage.setItem("x", "1"); } }, store0);
      const xp2 = await ectx.newPage(); watch(xp2, "Schüler:in nach 90 min");
      await xp2.clock.install();
      await xp2.goto(BASE + "/#/schueler/s/" + lessonId);
      await xp2.locator(".notfallbox, section.card h2", { hasText: /Material|Notfall/ }).first().waitFor({ timeout: 15000 });
      await xp2.clock.fastForward("01:29:00");
      ok(xp2.url().includes("#/schueler/s/" + lessonId) && await xp2.locator("#spw").count() === 0, "nach 89 Minuten noch angemeldet");
      await xp2.clock.fastForward("00:02:00");
      await xp2.locator("#spw").waitFor({ timeout: 10000 });
      ok((await xp2.locator("#spw-note").textContent()).includes("nach 90 Minuten abgemeldet") && await xp2.evaluate(() => localStorage.getItem("u.stoken")) === tok0,
        "nach 90 Minuten: Passwortabfrage mit Hinweis, das Gerät (Token) bleibt gespeichert");
      await xp2.fill("#spw", "Feindt"); await xp2.getByRole("button", { name: "Weiter" }).click();
      await xp2.waitForURL(/#\/schueler\/s\//, { timeout: 15000 });
      await xp2.locator(".notfallbox, section.card h2", { hasText: /Material|Notfall/ }).first().waitFor({ timeout: 15000 });
      ok(xp2.url().endsWith("#/schueler/s/" + lessonId) && await xp2.evaluate(() => localStorage.getItem("u.stoken")) === tok0, "nach dem Passwort zurück in derselben Sitzung – freigeschaltet bleibt freigeschaltet");
      // Escape-Room: der Stand wird beim Abmelden im Browser gesichert und danach wiederhergestellt
      await xp2.goto(BASE + "/#/schueler/escape/" + l3.id);
      await xp2.locator(".er-title", { hasText: "Mission Gewaltenteilung" }).waitFor({ timeout: 10000 });
      await xp2.fill("#er-fn", "Ben"); await xp2.fill("#er-ln", "Beispiel"); await xp2.fill("#er-bd", "01022010");
      await xp2.getByRole("button", { name: "Weiter zum Auftrag" }).click();
      await xp2.locator(".er-title", { hasText: "Willkommen" }).waitFor({ timeout: 10000 });
      await xp2.clock.fastForward("01:31:00");
      await xp2.locator("#spw").waitFor({ timeout: 10000 });
      ok(await xp2.evaluate((k) => !!localStorage.getItem(k), "u.esc." + l3.id), "Escape-Room-Stand beim Abmelden im Browser gesichert");
      await xp2.fill("#spw", "Feindt"); await xp2.getByRole("button", { name: "Weiter" }).click();
      const askBack = xp2.locator(".modal", { hasText: "Weiter im Escape-Room?" });
      await askBack.waitFor({ timeout: 15000 });
      ok((await askBack.textContent()).includes("Stand von Ben B."), "vor dem Wiederherstellen: Rückfrage, ob der Stand zu dieser Person gehört (geteilte iPads)");
      await askBack.getByRole("button", { name: "Ja, weiter" }).click();
      await xp2.locator(".er-title", { hasText: "Willkommen" }).waitFor({ timeout: 15000 });
      ok(xp2.url().endsWith("#/schueler/escape/" + l3.id) && await xp2.locator(".toast", { hasText: "Weiter geht es, wo du warst" }).count() === 1
        && !(await xp2.evaluate((k) => localStorage.getItem(k), "u.esc." + l3.id)), "Escape-Room: nach dem Passwort genau dort weiter (Stand wiederhergestellt, Sicherung gelöscht)");
      // Server: eine abgelaufene Anmeldung lehnt er ab (unbekannte Geräte weiter mit „unauthorized“)
      const bad = await fetch(BASE + "/api/student/me", { headers: { Authorization: "Bearer gibt-es-nicht" } });
      ok(bad.status === 401 && (await bad.json()).code === "unauthorized", "unbekanntes Gerät: 401 unauthorized");
      await ectx.close();
    }

    /* ---------- Sperren ---------- */
    step("Sperren");
    const ectx = await browser.newContext(); const ep = await ectx.newPage(); watch(ep, "Fremdgerät");
    await ep.goto(BASE + "/#/lehrkraft");
    for (let i = 0; i < 2; i++) { await ep.fill("#tu", "feindt"); await ep.fill("#tp", "falsch-" + i); await ep.getByRole("button", { name: "Anmelden" }).click(); await ep.locator(".err").filter({ hasText: /falsch|gesperrt/ }).waitFor(); }
    ok(await ep.locator(".err", { hasText: /gesperrt/ }).isVisible(), "Lehrkraft: nach 2 Fehlversuchen 30 Minuten gesperrt (dieses Gerät)");
    await ep.fill("#tp", T_PW); await ep.getByRole("button", { name: "Anmelden" }).click({ trial: false }).catch(() => {});
    await sleep(800);
    ok(!ep.url().includes("#/lk"), "… auch mit richtigem Passwort während der Sperre");
    // Das Token von tp ist seit dem Passwortwechsel auf Gerät 2 ungültig: Abmelden darf die Anmeldeseite trotzdem nur einmal aufbauen
    // (früher führte schon die 401 der Abmeldung dorthin und go() baute sie ein zweites Mal auf – das leerte das gerade ausgefüllte Formular)
    await tp.evaluate(() => { window.__loginForms = 0; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.matches("form.login") || n.querySelector("form.login"))) window.__loginForms++; }).observe(document.body, { childList: true, subtree: true }); });
    await tp.getByRole("button", { name: "Abmelden" }).click();
    await tp.fill("#tu", "feindt"); await tp.fill("#tp", T_PW);
    await sleep(1500);
    ok(await tp.inputValue("#tu") === "feindt" && await tp.inputValue("#tp") === T_PW && await tp.evaluate(() => window.__loginForms) === 1,
      "Abmelden mit schon ungültigem Token (Passwortwechsel auf einem anderen Gerät): Anmeldeseite nur einmal aufgebaut, Eingaben bleiben");
    tLogin = Date.now(); await tp.getByRole("button", { name: "Anmelden" }).click();
    await waitTeacherHome(tp, tLogin, "Anmeldung");
    ok(true, "eigenes, bekanntes Gerät bleibt nutzbar");
    const xctx = await browser.newContext(); const xp = await xctx.newPage(); watch(xp, "Schülergerät 2");
    await xp.goto(BASE + "/");
    for (let i = 0; i < 10; i++) { await xp.fill("#spw", "nein" + i); await xp.getByRole("button", { name: "Weiter" }).click(); await xp.locator(".err").waitFor(); await sleep(60); }
    ok(await xp.locator(".err", { hasText: /warte/ }).isVisible(), "Schüler:innen: nach 10 Fehlversuchen 1 Minute gesperrt");

    /* ---------- Mobil: nur senkrecht scrollen ---------- */
    step("Handy und iPad: alles ohne seitliches Schieben (nur senkrecht scrollen)");
    {
      // Anmeldungen übernehmen – die Schüler:in ist zuletzt durch den Tunnel zum Feibeitsblatt gegangen: erst zurück zu Unterricks
      await sp.goto(BASE + "/#/schueler"); await sp.locator(".item").first().waitFor({ timeout: 15000 });
      await tp.goto(BASE + "/#/lk"); await tp.locator("main").first().waitFor();
      const tStore = await tp.evaluate(() => JSON.stringify(localStorage)), sStore = await sp.evaluate(() => JSON.stringify(localStorage));
      ok(JSON.parse(sStore)["u.stoken"] && JSON.parse(tStore)["u.ttoken"], "Mobil-Prüfung: Anmeldung von Lehrkraft und Schüler:in übernommen");
      const tok = JSON.parse(tStore)["u.ttoken"];
      const TT = (method, path, body) => fetch(BASE + path, { method, headers: { Authorization: "Bearer " + tok, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then((x) => x.json().catch(() => null));
      const w = berlinAt(Date.now() - 30 * 60e3);   // Stunde läuft gerade: Hausaufgabe und KI-Begriffshilfe sichtbar
      await TT("PATCH", "/api/teacher/lessons/" + lessonId, { date: w.date, startTime: w.time });
      const report = [];
      mkdirSync(join(OUT, "mobil"), { recursive: true });
      const audit = async (dev, label, store, hash, prep, dark = false) => {
        const ctx = await browser.newContext({ ...devices[dev], ...(dark ? { colorScheme: "dark" } : {}) });
        if (store) await ctx.addInitScript((s) => { if (!sessionStorage.getItem("audit")) { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); sessionStorage.setItem("audit", "1"); } }, store);
        const p = await ctx.newPage(); watch(p, "Mobil " + dev + " " + label);
        try {
          await p.goto(BASE + "/" + hash);
          await p.locator("main").first().waitFor({ timeout: 15000 }).catch(() => {});
          await p.waitForFunction(() => !document.querySelector(".skeleton"), null, { timeout: 15000 }).catch(() => {});
          await p.waitForTimeout(800);
          if (store && await p.locator("#spw, #tu").count()) throw new Error("Anmeldung fehlt – es erscheint die Passwortabfrage");
          if (prep) await prep(p);
          await p.waitForTimeout(300);
          const r = await horizontalIssues(p), stray = await strayTexts(p);
          const who = dev + (dark ? " (dunkel)" : "");
          report.push({ dev: who, label, hash, ...r, stray });
          ok(r.issues.length === 0, who + ": " + label + " – nur senkrecht scrollbar" + (r.issues.length ? " (" + r.issues.length + " Stellen, siehe mobile-audit.json)" : ""));
          if (stray.length) ok(false, who + ": " + label + " – Textrest „" + stray[0].text + "“ sichtbar (" + stray[0].sel + ")");
          // Bildschirmfoto bei Fundstellen, mit MOBILE_SHOTS=1 von jeder Seite (zum Ansehen der Anpassungen)
          if (r.issues.length || process.env.MOBILE_SHOTS) await p.screenshot({ path: join(OUT, "mobil", (dev + (dark ? "-dunkel" : "") + "-" + label).replace(/[^A-Za-z0-9äöüÄÖÜß]+/g, "-") + ".png"), fullPage: true }).catch(() => {});
        } catch (e) { ok(false, dev + (dark ? " (dunkel)" : "") + ": " + label + " – Prüfung nicht möglich: " + e.message.split("\n")[0]); }
        await ctx.close();
      };
      const T_PAGES = [["Fächer", "#/lk"], ["Klassen PoWi", "#/lk/f/powi"], ["Kurse Ethik", "#/lk/f/ethik"], ["Sitzungen Q2 GK", "#/lk/f/powi/Q2-GK"], ["Unterrichtseinheit", "#/lk/u/" + unitId],
        ["Sitzung", "#/lk/s/" + lessonId], ["Sitzung mit Vertretung", "#/lk/s/" + l2.id], ["Sitzung mit Escape-Room", "#/lk/s/" + l3.id], ["Planungsgrundlagen", "#/lk/grundlagen"],
        ["Planungsgrundlagen PoWi", "#/lk/grundlagen/powi"], ["Einstellungen", "#/lk/einstellungen"], ["Escape-Room-Vorschau", "#/lk/escape/" + l3.id],
        ["Planungsgrundlagen Ev. Religion", "#/lk/grundlagen/evrel"], ["Planungsgrundlage (Text)", "#/lk/grundlage/" + txtBaseId], ["Elternansicht (Vorschau)", "#/lk/eltern/" + parentLessonId]];
      // Grundschule: Übersicht, Kurs, Einheit, Sitzung (Verlaufsplan, Bildkarten, Material, Elternkarte) und nach einer Krankmeldung roter Kasten und
      // Ausfall-Eintrag – dafür fällt die 3. Stunde der Einheit „Noah“ (Wochen voraus) noch einmal aus
      const npv = await TT("POST", "/api/teacher/lessons/" + gsNoah.lessons[2] + "/cancel", { dryRun: true });
      await TT("POST", "/api/teacher/lessons/" + gsNoah.lessons[2] + "/cancel", { version: npv.version });
      const noahU = (await TT("GET", "/api/teacher/units/" + gsNoah.unitId)).unit, noahPh = noahU.lessons.filter((l) => l.cancelled).pop();
      ok(noahU.revise && noahU.revise.open && !!noahPh, "Mobil-Prüfung: Einheit „Noah“ mit rotem Kasten und Ausfall-Eintrag");
      const GS_PAGES = [["Grundschule", "#/lk/grundschule"], ["Grundschulkurs", "#/lk/grundschule/k/" + gsRelId], ["Grundschul-Einheit", "#/lk/u/" + gsUnitId],
        ["Grundschul-Einheit mit rotem Kasten", "#/lk/u/" + gsNoah.unitId], ["Grundschul-Sitzung", "#/lk/s/" + parentLessonId], ["Grundschul-Sitzung mit rotem Kasten", "#/lk/s/" + gsNoah.lessons[2]],
        ["Ausfall-Eintrag", "#/lk/s/" + noahPh.id], ["Elternansicht (Vorschau)", "#/lk/eltern/" + parentLessonId], ["Elternansicht des Ausfall-Eintrags (Vorschau)", "#/lk/eltern/" + noahPh.id]];
      T_PAGES.push(...GS_PAGES.filter(([label]) => !T_PAGES.some((x) => x[0] === label)));
      const P_PAGES = [["Elternansicht", "#/eltern/" + parentToken]];
      const S_PAGES = [["Sitzungsliste", "#/schueler"], ["Sitzung (Schüler:in)", "#/schueler/s/" + lessonId], ["Vertretung (Schüler:in)", "#/schueler/s/" + l2.id], ["Escape-Room", "#/schueler/escape/" + l3.id]];
      for (const dev of ["iPhone SE", "iPhone 13", "iPad (gen 7)"]) {
        await audit(dev, "Startseite", null, "#/");
        await audit(dev, "Fach und Klasse wählen", null, "#/", async (p) => { await p.fill("#spw", "Feindt"); await p.getByRole("button", { name: "Weiter" }).click(); await p.locator(".tiles .tile").first().waitFor(); await p.getByRole("button", { name: "Politik und Wirtschaft" }).click(); await p.locator(".class-btn").first().waitFor(); });
        await audit(dev, "Anmeldung Lehrkraft", null, "#/lehrkraft");
        for (const [label, hash] of T_PAGES) await audit(dev, label, tStore, hash);
        for (const [label, hash] of S_PAGES) await audit(dev, label, sStore, hash);
        for (const [label, hash] of P_PAGES) await audit(dev, label, null, hash);   // Eltern: ohne gespeicherte Daten
        await audit(dev, "Beamergerät", null, "#/beamer", async (p) => { await p.locator(".beamer .bm-code", { hasText: /\d/ }).waitFor({ timeout: 10000 }); });
      }
      // MOBILE_SHOTS=1: Grundschule und Elternansicht zusätzlich am großen Bildschirm, hell und dunkel (zum Ansehen)
      if (process.env.MOBILE_SHOTS) for (const dark of [false, true]) for (const [label, hash, store] of [...GS_PAGES.map((x) => [...x, tStore]), ...P_PAGES.map((x) => [...x, null])]) {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, colorScheme: dark ? "dark" : "light" });
        if (store) await ctx.addInitScript((st) => { if (!sessionStorage.getItem("audit")) { for (const [k, v] of Object.entries(JSON.parse(st))) localStorage.setItem(k, v); sessionStorage.setItem("audit", "1"); } }, store);
        const p = await ctx.newPage(); watch(p, "Bildschirmfoto " + label);
        await p.goto(BASE + "/" + hash); await p.locator("main").first().waitFor({ timeout: 15000 }).catch(() => {});
        await p.waitForFunction(() => !document.querySelector(".skeleton"), null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(1200);
        await p.screenshot({ path: join(OUT, "mobil", ("Desktop" + (dark ? "-dunkel" : "") + "-" + label).replace(/[^A-Za-z0-9äöüÄÖÜß]+/g, "-") + ".png"), fullPage: true }).catch(() => {});
        await ctx.close();
      }
      // Grundschule und Elternansicht auch im dunklen Farbschema (Handy und iPad)
      for (const dev of ["iPhone SE", "iPad (gen 7)"]) {
        for (const [label, hash] of GS_PAGES) await audit(dev, label, tStore, hash, null, true);
        for (const [label, hash] of P_PAGES) await audit(dev, label, null, hash, null, true);
      }
      for (const dev of ["iPhone SE", "iPhone 13"]) {
        await audit(dev, "Dialog „Stunde mit Claude planen“", tStore, "#/lk/s/" + lessonId, async (p) => { await p.getByRole("button", { name: "Stunde mit Claude planen" }).first().click(); await p.locator(".modal").waitFor(); });
        await audit(dev, "Dialog „Link hinzufügen“", tStore, "#/lk/s/" + lessonId, async (p) => { await p.getByRole("button", { name: "Link hinzufügen" }).first().click(); await p.locator(".modal").waitFor(); });
        await audit(dev, "Beamer-Folie", tStore, "#/lk/s/" + lessonId, async (p) => { await p.getByRole("button", { name: "Für den Beamer zeigen" }).click(); await p.locator(".codeshow").waitFor(); });
        await audit(dev, "Einwilligung KI-Begriffshilfe", sStore, "#/schueler/s/" + lessonId, async (p) => {
          // die übernommene Anmeldung der Schüler:in hat schon eingewilligt: Einwilligung entfernen, damit der Dialog erscheint
          await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("u.kihelp.")) localStorage.removeItem(k); });
          await p.reload(); await p.locator("main").first().waitFor(); await p.waitForFunction(() => !document.querySelector(".skeleton"), null, { timeout: 15000 }).catch(() => {});
          await p.getByRole("button", { name: "KI-Begriffshilfe nutzen" }).click(); await p.locator(".modal").waitFor(); });
        await audit(dev, "Verlaufsplan bearbeiten (Grundschule)", tStore, "#/lk/s/" + parentLessonId, async (p) => { await p.locator("#gsplan").getByRole("button", { name: "Bearbeiten" }).click(); await p.locator("#gsplan-text").waitFor(); });
        await audit(dev, "Dialog „Wo haben Sie aufgehört?“", tStore, "#/lk/s/" + parentLessonId, async (p) => { await p.getByRole("button", { name: "Zwischenstopp eintragen …" }).click(); await p.locator(".modal").waitFor(); });
        await audit(dev, "Dialog „Stunde ausfallen lassen?“", tStore, "#/lk/s/" + gsNoah.lessons[0], async (p) => { await p.locator("#gs-sick-btn").click(); await p.locator(".modal .cancel-table").waitFor({ timeout: 15000 }); });
        await audit(dev, "Präsentationsmodus", tStore, "#/lk/s/" + lessonId, async (p) => {
          await p.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click(); await p.locator(".presenter").waitFor();
          await p.waitForTimeout(400); });
        await audit(dev, "Dialog „Beamer verbinden“", tStore, "#/lk/s/" + lessonId, async (p) => {
          await p.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click(); await p.locator(".presenter").waitFor();
          await p.locator(".presenter").getByRole("button", { name: /^Beamer verb/ }).click(); await p.locator(".presenter .bmc").waitFor(); });
        await audit(dev, "Feld „Timer“ im Präsentationsmodus", tStore, "#/lk/s/" + lessonId, async (p) => {
          await p.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click(); await p.locator(".presenter").waitFor();
          await p.locator(".presenter .tmbtn").click(); await p.locator(".presenter .tmc").waitFor(); });
      }
      writeFileSync(join(OUT, "mobile-audit.json"), JSON.stringify(report, null, 1));
    }

    /* ---------- Zurücksetzen (ganz am Ende: löscht alle Unterrichtsinhalte) ---------- */
    step("Einstellungen: „Alle Unterrichtsinhalte löschen und Unterricks zurücksetzen“ – Passwort, Sicherung (Fach / Einheit / Sitzungen), Löschen");
    {
      const tok = await tp.evaluate(() => localStorage.getItem("u.ttoken"));
      const TR = (method, path, body) => fetch(BASE + path, { method, headers: { Authorization: "Bearer " + tok, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
      const before = (await TR("GET", "/api/teacher/reset")).data, basesN = ((await TR("GET", "/api/teacher/bases")).data.bases || []).length;
      const subjBefore = JSON.stringify((await TR("GET", "/api/teacher/subjects")).data.subjects), spwBefore = (await TR("GET", "/api/teacher/student-settings")).data.password;
      ok(before.units > 2 && before.lessons > 5, "vorher: " + before.units + " Einheiten, " + before.lessons + " Sitzungen");
      await tp.goto(BASE + "/#/lk/einstellungen"); await tp.locator("#resetcard").waitFor({ timeout: 15000 });
      await tp.getByRole("button", { name: "Alle Unterrichtsinhalte löschen und Unterricks zurücksetzen" }).click();
      const pm = tp.locator(".modal", { hasText: "Zurücksetzen: Passwort bestätigen" }); await pm.waitFor();
      ok((await pm.textContent()).includes(before.units + " Unterrichtseinheiten und " + before.lessons + " Sitzungen"), "zuerst das Passwort – der Dialog nennt, was gelöscht wird");
      await pm.locator("#rs-pw").fill("ganz-falsch"); await pm.getByRole("button", { name: "Weiter" }).click();
      await pm.locator(".err", { hasText: "Das Passwort ist falsch. Noch 1 Versuch" }).waitFor({ timeout: 60000 });
      ok(await tp.locator(".modal", { hasText: "Vorher eine Sicherung herunterladen?" }).count() === 0, "falsches Passwort: nicht weiter, Hinweis auf die Sperre wie bei der Anmeldung");
      await pm.locator("#rs-pw").fill(T_PW); await pm.getByRole("button", { name: "Weiter" }).click();
      const bm = tp.locator(".modal", { hasText: "Vorher eine Sicherung herunterladen?" }); await bm.waitFor({ timeout: 60000 });
      const [bdl] = await Promise.all([tp.waitForEvent("download", { timeout: 300000 }), bm.getByRole("button", { name: "Sicherung herunterladen" }).click()]);
      const bz = await readZip(new Uint8Array(readFileSync(await bdl.path()))), names = bz.map((x) => x.name);
      const unitJsons = names.filter((n) => /\/Unterrichtseinheit - .+\.json$/.test(n)), sess = names.filter((n) => /\.zip$/.test(n));
      ok(/^Unterricks-Sicherung - \d{4}-\d{2}-\d{2}\.zip$/.test(bdl.suggestedFilename()) && names.includes("Lies mich.txt"), "Sicherung „" + bdl.suggestedFilename() + "“ mit „Lies mich.txt“");
      if (!(unitJsons.length === before.units && sess.length === before.lessons)) console.log("    Inhalt:", names.join(" | "));
      ok(unitJsons.length === before.units && unitJsons.every((n) => n.split("/").length === 3) && sess.length === before.lessons
        && sess.every((n) => n.split("/").length === 4 && /^\d{2,} - /.test(n.split("/")[2]) && n.endsWith("/Unterrickssitzung.zip") && n.length < 160),
        "1. Ebene Fächer, 2. Ebene Einheiten mit Einheitsdatei, 3. Ebene Sitzungen (chronologisch nummeriert, je eine Sitzungsdatei)");
      ok(names.some((n) => n.startsWith("Politik und Wirtschaft/Q2 GK - Gewaltenteilung und BVerfG/01 - ")) && names.some((n) => n.startsWith("Politik und Wirtschaft/Q2 GK - Gewaltenteilung und BVerfG (2)/") || n.startsWith("Politik und Wirtschaft/Q2 GK - Gewaltenteilung und BVerfG/"))
        && names.some((n) => n.startsWith("Ethik/")), "Ordner je Fach und Einheit, gleichnamige Einheiten getrennt (z. B. „Politik und Wirtschaft/Q2 GK - Gewaltenteilung und BVerfG/01 - …“)");
      ok(names.some((n) => n.startsWith("Grundschule/Religion 2ab - Josef und seine Brüder/Unterrichtseinheit - Grundschule - Religion 2ab - Josef und seine Brüder.json"))
        && names.filter((n) => n.startsWith("Grundschule/Religion 2ab - Josef und seine Brüder/") && n.endsWith("/Unterrickssitzung.zip")).length === 4, "Grundschule: „Grundschule/Religion 2ab - Josef und seine Brüder/…“ mit Einheitsdatei und 4 Sitzungen");
      const lies = new TextDecoder().decode(bz.find((x) => x.name === "Lies mich.txt").data);
      ok(lies.includes("Grundschule:") && /„Grundschule\/Religion 2ab - [^“/]+\/“/.test(lies) && lies.includes("Nicht in der Sicherung: die Elternlinks.")
        && lies.includes("Unterricht ausgefallen"), "„Lies mich.txt“ nennt die Grundschule (Ordner, Verlaufsplan, Eltern, Ausfall-Einträge, keine Elternlinks)");
      const gsSess = names.filter((n) => n.startsWith("Grundschule/Religion 2ab - Josef und seine Brüder/") && n.endsWith("/Unterrickssitzung.zip"));
      const gsData = [];
      for (const n of gsSess) { const z = await readZip(bz.find((x) => x.name === n).data); gsData.push(JSON.parse(new TextDecoder().decode(z.find((x) => x.name === "sitzung.json").data))); }
      ok(gsData.some((d) => d.lesson.portal.includes("[[pdf:") && d.lesson.parentSummary) && gsData.some((d) => d.files.some((f) => f.cards && f.cards.texts.length === 3))
        && gsData.every((d) => !JSON.stringify(d).includes(parentToken)), "Grundschul-Sitzungsdateien: Verlaufsplan, Inhalt für die Eltern, Bildkarten mit Erzähltexten – nie der Elternlink");
      ok(names.some((n) => /^Grundschule\/Religion 2ab - Noah und die Arche\/\d{2} - [^/]+ - Unterricht ausgefallen\/Unterrickssitzung\.zip$/.test(n)), "Ausfall-Eintrag als eigener Sitzungsordner „… - Unterricht ausgefallen“");
      const anyS = await readZip(bz.find((x) => x.name === sess[0]).data);
      ok(anyS.some((x) => x.name === "sitzung.json"), "jede Sitzung ist eine Sitzungsdatei, die sich mit „Sitzung aus Datei laden“ wieder laden lässt");
      const cm = tp.locator(".modal", { hasText: "Sicherung heruntergeladen – jetzt löschen?" }); await cm.waitFor({ timeout: 60000 });
      ok((await cm.textContent()).includes(bdl.suggestedFilename()) && await cm.getByRole("button", { name: "Sicherung erneut herunterladen" }).count() === 1, "vor dem Löschen: Name der Sicherung, erneut herunterladen, letzte Bestätigung");
      await cm.getByRole("button", { name: "Jetzt endgültig löschen" }).click();
      ok(await cm.isVisible() && (await TR("GET", "/api/teacher/reset")).data.lessons === before.lessons, "ohne bestätigtes Kästchen wird nichts gelöscht");
      await cm.locator("#rs-ok").check();
      await cm.getByRole("button", { name: "Jetzt endgültig löschen" }).click();
      await tp.locator("#resetcard [role=status]", { hasText: "Alle Unterrichtsinhalte sind gelöscht." }).waitFor({ timeout: 180000 });
      const after = (await TR("GET", "/api/teacher/reset")).data, all = (await TR("GET", "/api/teacher/lessons")).data;
      ok(after.units === 0 && after.lessons === 0 && after.files === 0 && after.pending === 0 && all.lessons.length === 0, "alle Einheiten, Sitzungen und Dateien gelöscht (keine offenen Aufräumrunden)");
      ok((await fetch(BASE + "/api/eltern/sitzung", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: parentToken }) })).status === 404, "Elternlink nach dem Zurücksetzen ungültig (404)");
      const slide = await fetch(new URL(src, BASE).href);
      ok(slide.status === 404 || slide.status === 410, "Folienbilder gelöscht (Link einer Folie: " + slide.status + ")");
      ok(((await TR("GET", "/api/teacher/bases")).data.bases || []).length === basesN && JSON.stringify((await TR("GET", "/api/teacher/subjects")).data.subjects) === subjBefore
        && (await TR("GET", "/api/teacher/student-settings")).data.password === spwBefore && (await TR("GET", "/api/teacher/me")).status === 200,
        "es bleiben: Zugang (weiter angemeldet), Planungsgrundlagen, Fach-Einstellungen mit Kursen, Schülerpasswort");
      const gsAfter = (await TR("GET", "/api/teacher/gs/courses")).data.courses || [];
      ok(gsAfter.length === 2 && gsAfter.every((k) => k.counts.units === 0 && k.counts.lessons === 0) && gsAfter.some((k) => k.settings && k.settings.classSize === 22),
        "Grundschulkurse und ihre Kurseinstellungen bleiben; ihre Einheiten und Sitzungen sind gelöscht");
      ok(((await TR("GET", "/api/teacher/course-settings?subject=ethik&klass=7-K")).data.settings || {}).classSize === 24, "Kurseinstellungen des Gymnasiums bleiben (Ethik 7-K: 24 Schüler:innen)");
      const kept = await tp.locator("#resetcard").textContent();
      ok(kept.includes("die Kurseinstellungen (Stundenplan und Schülerzahl), die Grundschulkurse") && kept.includes("die Planungsgrundlagen (mit ihren PDF-Dateien)")
        && kept.includes("sowie in der Grundschule Verlaufspläne, Bildkarten und Elternlinks."), "Einstellungen nennen, was bleibt und was gelöscht wird – auch für die Grundschule");
      await tp.goto(BASE + "/#/lk"); await tp.locator("main").first().waitFor();
      ok((await TR("POST", "/api/teacher/reset", { authKey: "x".repeat(43) })).status === 403, "der Server verlangt das Passwort auch selbst (ohne richtiges Passwort kein Zurücksetzen)");
    }
  } finally {
    await browser.close();
    ai.srv.close(); fbm.srv.close();
    stopWrangler();
    writeFileSync(join(OUT, "wrangler.log"), wlog);   // immer (auch bei einem Abbruch durch eine Ausnahme)
  }
  ok(pageErrors.length === 0, "keine JavaScript-Fehler in den Seiten" + (pageErrors.length ? ": " + pageErrors.join(" | ") : ""));
  console.log("\n" + (failures ? "✗ " + failures + " Prüfung(en) fehlgeschlagen" : "✓ alle Prüfungen bestanden"));
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
