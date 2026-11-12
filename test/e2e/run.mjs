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
      ok((await tp.locator('.topbar nav a[aria-current="page"]').allTextContents()).join("|") === "Grundschule" && await tp.locator("html").getAttribute("data-fach") === "gs"
        && await tp.locator(".weekcal").count() === 1 && await tp.getByText("Noch keine Kurse – legen Sie unten den ersten an.").count() === 1,
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
    await tp.locator(".modal textarea").first().fill("Erkläre zwei Aufgaben des Bundesverfassungsgerichts (geändert).");
    await tp.locator(".modal").getByRole("button", { name: "Feibeitsblatt jetzt anlegen" }).click();
    await tp.locator(".modal", { hasText: "erhält einen Code" }).getByRole("button", { name: "Anlegen", exact: true }).click();
    await tp.locator(".modal", { hasText: "Feibeitsblatt angelegt" }).waitFor({ timeout: 20000 });
    const created = [...fbm.sheets.values()][0];
    if (fbm.sheets.size !== 1 || !created.tasks[0].text.endsWith("(geändert).")) console.log("    Blätter:", JSON.stringify([...fbm.sheets.values()]).slice(0, 800));
    ok(created && created.tasks[0].text.endsWith("(geändert).") && created.tasks[0].solution.includes("Normenkontrolle") && created.tasks[1].answer.type === "table", "Blatt angelegt – mit Änderung der Lehrkraft und KI-Einstellungen je Aufgabe");
    ok(created && created.tasks.every((t) => t.solution === "" || (t.solution.includes("Altersgemäße Erwartung (Q2, Grundkurs): Das legt nur das Anspruchsniveau fest") && t.solution.split("Altersgemäße Erwartung").length === 2)),
      "jeder Auftrag an die KI trägt die altersgemäße Erwartung der Lerngruppe (Q2, Grundkurs)");
    ok(Array.isArray(created.tasks[0].material) && created.tasks[0].material[0].some((x) => x.f === "b"), "Material im Feibeitsblatt-Format (Absätze/Läufe)");
    // Notfall-Feibeitsblatt: entsteht gleich nach dem Anlegen (noch ohne Checkliste → ohne QR-Code) im Material für Schüler:innen
    const notfallOf = async (code) => ((await T("GET", "/api/teacher/lessons/" + lessonId)).data.files || []).filter((f) => f.source === "notfall" && f.fbCode === code && f.area !== "archive");
    const waitNotfall = async (code, pred) => { for (let i = 0; i < 60; i++) { const fs = await notfallOf(code); if (fs.length && pred(fs)) return fs; await sleep(250); } return notfallOf(code); };
    const pdfOf = async (f) => { const l = await T("POST", "/api/teacher/files/" + f.id + "/link", {}); return Buffer.from(await (await fetch(BASE + l.data.url)).arrayBuffer()).toString("latin1"); };
    let nf = await waitNotfall(created.code, (fs) => fs[0].fbSig && !fs[0].fbSig.includes("-qr"));
    ok(nf.length === 1 && nf[0].area === "student" && nf[0].name === "Notfall-Feibeitsblatt – Mock-Blatt BVerfG.pdf" && nf[0].mime === "application/pdf", "Notfall-Feibeitsblatt automatisch im Material für Schüler:innen (" + (nf[0] && nf[0].name) + ")");
    let nfPdf = nf.length ? await pdfOf(nf[0]) : "";
    ok(nfPdf.startsWith("%PDF-1.7") && nfPdf.trim().endsWith("%%EOF") && !nfPdf.includes("#checkliste="), "… als PDF wie im Feibeitsblatt, ohne Checkliste noch ohne QR-Code");
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
    await nfBox.locator(".item", { hasText: "Notfall-Feibeitsblatt – Mock-Blatt BVerfG.pdf" }).waitFor();
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
    await sp.locator("section.notfallbox .item", { hasText: "Notfall-Feibeitsblatt – Altes Blatt.pdf" }).waitFor();
    ok(true, "Schüler:innen sehen das nachgeholte Notfall-Feibeitsblatt im Kästchen mit dem roten Hinweis");
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
      await ptp.goto(PAGES + "/#/lk/s/" + lessonId); await ptp.locator(".code-big").waitFor({ timeout: 20000 });
      ok(true, "Lehrkraft auf Pages: Anmeldung (mit Vorabanfrage) und Sitzung laden");
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
      const audit = async (dev, label, store, hash, prep) => {
        const ctx = await browser.newContext({ ...devices[dev] });
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
          report.push({ dev, label, hash, ...r, stray });
          ok(r.issues.length === 0, dev + ": " + label + " – nur senkrecht scrollbar" + (r.issues.length ? " (" + r.issues.length + " Stellen, siehe mobile-audit.json)" : ""));
          if (stray.length) ok(false, dev + ": " + label + " – Textrest „" + stray[0].text + "“ sichtbar (" + stray[0].sel + ")");
          // Bildschirmfoto bei Fundstellen, mit MOBILE_SHOTS=1 von jeder Seite (zum Ansehen der Anpassungen)
          if (r.issues.length || process.env.MOBILE_SHOTS) await p.screenshot({ path: join(OUT, "mobil", (dev + "-" + label).replace(/[^A-Za-z0-9äöüÄÖÜß]+/g, "-") + ".png"), fullPage: true }).catch(() => {});
        } catch (e) { ok(false, dev + ": " + label + " – Prüfung nicht möglich: " + e.message.split("\n")[0]); }
        await ctx.close();
      };
      const T_PAGES = [["Fächer", "#/lk"], ["Klassen PoWi", "#/lk/f/powi"], ["Kurse Ethik", "#/lk/f/ethik"], ["Sitzungen Q2 GK", "#/lk/f/powi/Q2-GK"], ["Unterrichtseinheit", "#/lk/u/" + unitId],
        ["Sitzung", "#/lk/s/" + lessonId], ["Sitzung mit Vertretung", "#/lk/s/" + l2.id], ["Sitzung mit Escape-Room", "#/lk/s/" + l3.id], ["Planungsgrundlagen", "#/lk/grundlagen"],
        ["Planungsgrundlagen PoWi", "#/lk/grundlagen/powi"], ["Einstellungen", "#/lk/einstellungen"], ["Escape-Room-Vorschau", "#/lk/escape/" + l3.id]];
      const S_PAGES = [["Sitzungsliste", "#/schueler"], ["Sitzung (Schüler:in)", "#/schueler/s/" + lessonId], ["Vertretung (Schüler:in)", "#/schueler/s/" + l2.id], ["Escape-Room", "#/schueler/escape/" + l3.id]];
      for (const dev of ["iPhone SE", "iPhone 13", "iPad (gen 7)"]) {
        await audit(dev, "Startseite", null, "#/");
        await audit(dev, "Fach und Klasse wählen", null, "#/", async (p) => { await p.fill("#spw", "Feindt"); await p.getByRole("button", { name: "Weiter" }).click(); await p.locator(".tiles .tile").first().waitFor(); await p.getByRole("button", { name: "Politik und Wirtschaft" }).click(); await p.locator(".class-btn").first().waitFor(); });
        await audit(dev, "Anmeldung Lehrkraft", null, "#/lehrkraft");
        for (const [label, hash] of T_PAGES) await audit(dev, label, tStore, hash);
        for (const [label, hash] of S_PAGES) await audit(dev, label, sStore, hash);
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
        await audit(dev, "Präsentationsmodus", tStore, "#/lk/s/" + lessonId, async (p) => {
          await p.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click(); await p.locator(".presenter").waitFor();
          await p.waitForTimeout(400); });
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
      const slide = await fetch(new URL(src, BASE).href);
      ok(slide.status === 404 || slide.status === 410, "Folienbilder gelöscht (Link einer Folie: " + slide.status + ")");
      ok(((await TR("GET", "/api/teacher/bases")).data.bases || []).length === basesN && JSON.stringify((await TR("GET", "/api/teacher/subjects")).data.subjects) === subjBefore
        && (await TR("GET", "/api/teacher/student-settings")).data.password === spwBefore && (await TR("GET", "/api/teacher/me")).status === 200,
        "es bleiben: Zugang (weiter angemeldet), Planungsgrundlagen, Fach-Einstellungen mit Kursen, Schülerpasswort");
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
