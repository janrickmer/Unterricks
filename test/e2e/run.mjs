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
import { startMockAI, startMockFeibeitsblatt } from "./mocks.mjs";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = 8787, AI_PORT = 8790, FB_PORT = 8788, BASE = "http://localhost:" + PORT, FB = "http://localhost:" + FB_PORT;
const PAGES_PORT = 8792, PAGES = "http://localhost:" + PAGES_PORT;   // Nachbau von GitHub Pages: andere Herkunft, keine eigenen Header
const OUT = join(ROOT, "test-results"); mkdirSync(OUT, { recursive: true });
const FB_PW = "Feibeitsblatt-Testpasswort", T_PW = "Lehrkraft-Passwort-2026";
// Bildschirmfotos ohne kurzzeitige Meldungen (Toasts) und mit abgeschlossenen Einblendungen – sonst verdecken sie Teile der Seite
const SHOT = { style: "#toasts{display:none!important}", animations: "disabled" };

let failures = 0;
const ok = (cond, label) => { if (cond) console.log("  ✓ " + label); else { failures++; console.log("  ✗ " + label); } };
const step = (s) => console.log("\n▶ " + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
async function pdf(pages, label) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) { const p = d.addPage([960, 540]); p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.12, 0.23, 0.37) }); p.drawText(label + " – Folie " + i, { x: 60, y: 260, size: 48, font: f, color: rgb(1, 1, 1) }); }
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
    "--var", "DEV_ALLOW_HTTP_AI:1", "--var", "FEIBEITSBLATT_API:" + FB, "--var", "FEIBEITSBLATT_URL:" + FB + "/", "--var", "PAGES_ORIGINS:" + PAGES], { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const stopWrangler = () => { try { process.kill(-wd.pid, "SIGTERM"); } catch {} };
  process.on("exit", stopWrangler);
  let wlog = ""; wd.stdout.on("data", (d) => (wlog += d)); wd.stderr.on("data", (d) => (wlog += d));
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + "/api/health")).ok) break; } catch {} await sleep(1000); }
  const browser = await chromium.launch();
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

    const { addDays, fmtDay } = await import("../../public/shared.js");
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
    step("Fach → Kurs → Unterrichtseinheit: Rahmendaten, Planung mit Claude (Connector), Leupold-Schema, Tabelle");
    await tp.getByRole("link", { name: "Unterricht" }).click();
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
    ok(/PowerPoint-Präsentation \(\.pptx/.test(presPrompt) && presPrompt.includes("Politik und Wirtschaft") && presPrompt.includes("90 Minuten"), "Prompt fordert PPTX + PDF mit allen Rahmendaten an");
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
    await tp.locator(".codeshow").waitFor(); await tp.waitForTimeout(300); await tp.screenshot({ ...SHOT, path: join(OUT, "beamer-code.png") });
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

    step("Präsentation (PDF) hochladen → Folienbilder");
    await tp.locator("section.card", { hasText: "Präsentation für den Unterricht" }).locator("input[type=file]").first().setInputFiles({ name: "BVerfG.pdf", mimeType: "application/pdf", buffer: await pdf(3, "BVerfG") });
    await tp.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).waitFor({ timeout: 40000 });
    ok(await tp.locator(".item", { hasText: "3 Folien" }).count() === 1, "3 Folien erzeugt, Start-Knopf unter der Präsentation");
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
    ok(await sp.locator("text=selbst öffnen (90 Minuten").count() === 1, "Präsentationsdatei erst 90 Minuten nach dem Betreten");
    ok((await SA("POST", "/api/student/lessons/" + lessonId + "/presentation-link", {})).status === 403, "… auch serverseitig gesperrt");

    step("Live-Präsentation: Lehrkraft startet, Schüler:in folgt");
    await tp.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
    await tp.locator(".presenter").waitFor();
    await sp.locator(".live img").waitFor({ timeout: 15000 });
    await sp.locator(".live .badge", { hasText: "Folie 1 / 3" }).waitFor({ timeout: 10000 });
    ok(true, "Folie 1 erscheint bei der Schülerin");
    const t0 = Date.now();
    await tp.keyboard.press("ArrowRight");
    await sp.locator(".live .badge", { hasText: "Folie 2 / 3" }).waitFor({ timeout: 10000 });
    ok(true, "Folienwechsel kommt an (" + (Date.now() - t0) + " ms)");
    await tp.locator(".presenter .small", { hasText: "1 Schüler:in verbunden" }).waitFor({ timeout: 10000 });
    ok(true, "Lehrkraft sieht die Zahl der verbundenen Schüler:innen");
    await sp.waitForFunction(() => /\/2\?/.test((document.querySelector(".live img") || {}).src || ""), null, { timeout: 10000 });
    const src = await sp.locator(".live img").getAttribute("src");
    ok((await fetch(new URL(src, BASE).href)).status === 200 && (await fetch(new URL(src, BASE).href.replace(/\/(\d+)\?/, "/3?"))).status === 403, "Schüler:innen können nicht vorblättern (Folie 3 gesperrt)");
    await sp.screenshot({ ...SHOT, path: join(OUT, "schueler-live.png") });
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-praesentation.png") });
    await tp.getByRole("button", { name: "Präsentation für alle beenden" }).click();
    await sp.locator(".live .placeholder").waitFor({ timeout: 10000 });
    ok(true, "Beenden kommt bei allen an");

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

    /* ---------- Feibeitsblatt ---------- */
    step("Feibeitsblatt: verbinden, Entwurf prüfen, anlegen, Abgaben einsehen");
    await tp.reload();
    const fbSec = tp.locator("section.card", { hasText: "Feibeitsblätter dieser Sitzung" });
    await fbSec.locator("input[inputmode=numeric]").fill("1104");
    await fbSec.locator("input[type=password]").fill(FB_PW);
    await fbSec.getByRole("button", { name: "Verbinden" }).click();
    await fbSec.locator(".badge", { hasText: "verbunden" }).first().waitFor({ timeout: 20000 });
    ok(true, "mit Feibeitsblatt verbunden (Schlüssel im Browser abgeleitet)");
    await fbSec.getByRole("button", { name: "Feibeitsblatt-Entwurf aus dem Chat" }).click();
    await tp.locator(".modal", { hasText: "Feibeitsblatt prüfen und anlegen" }).waitFor({ timeout: 20000 });
    ok(await tp.locator(".modal textarea").nth(2).inputValue().then((v) => v.includes("Normenkontrolle")), "Entwurf mit „Auftrag an die KI“ zum Prüfen");
    await tp.locator(".modal textarea").first().fill("Erkläre zwei Aufgaben des Bundesverfassungsgerichts (geändert).");
    await tp.locator(".modal").getByRole("button", { name: "Feibeitsblatt jetzt anlegen" }).click();
    await tp.locator(".modal", { hasText: "erhält einen Code" }).getByRole("button", { name: "Anlegen", exact: true }).click();
    await tp.locator(".modal", { hasText: "Feibeitsblatt angelegt" }).waitFor({ timeout: 20000 });
    const created = [...fbm.sheets.values()][0];
    if (fbm.sheets.size !== 1 || !created.tasks[0].text.endsWith("(geändert).")) console.log("    Blätter:", JSON.stringify([...fbm.sheets.values()]).slice(0, 800));
    ok(created && created.tasks[0].text.endsWith("(geändert).") && created.tasks[0].solution.includes("Normenkontrolle") && created.tasks[1].answer.type === "table", "Blatt angelegt – mit Änderung der Lehrkraft und KI-Einstellungen je Aufgabe");
    ok(Array.isArray(created.tasks[0].material) && created.tasks[0].material[0].some((x) => x.f === "b"), "Material im Feibeitsblatt-Format (Absätze/Läufe)");
    await tp.getByRole("button", { name: "Checkliste vorschlagen lassen" }).click();
    await tp.getByRole("button", { name: "Checkliste bestätigen" }).click();
    await sleep(500);
    ok(!!created.checklist, "geführt: KI-Checkliste bestätigt");
    await tp.locator(".modal").getByRole("button", { name: "Fertig" }).click();
    await sp.reload();
    const fbCard = sp.locator(".item", { hasText: "Mock-Blatt BVerfG" });
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
    await sp.reload();
    await sp.locator(".homework").waitFor();
    const hwTxt = await sp.locator(".homework").textContent();
    await sp.screenshot({ ...SHOT, path: join(OUT, "schueler-hausaufgabe.png") });
    ok(hwTxt.includes("Bis zur nächsten Sitzung am " + fmtDay(l2.date)) && hwTxt.includes("M2") && await sp.locator(".homework strong", { hasText: "M2" }).count() === 1, "Schüler:innen sehen die Hausaufgabe mit Fälligkeit");
    ok(!hwTxt.includes("unterricks.janrickmer.de"), "der Schulportal-Hinweis erscheint in Unterricks nicht");
    await tp.locator(".homework").getByRole("button", { name: "Für das Schulportal kopieren" }).click();
    const hwCopy = await tp.evaluate(() => navigator.clipboard.readText());
    const code0 = lesson0.code.slice(0, 3) + "-" + lesson0.code.slice(3);
    const longDay = (iso) => Number(iso.slice(8, 10)) + ". " + ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"][Number(iso.slice(5, 7)) - 1] + " " + iso.slice(0, 4);
    ok(hwCopy === "**Hausaufgabe zum " + longDay(l2.date) + ":**\n\n- Lies **M2** und beantworte Aufgabe 3.\n- Unter https://unterricks.janrickmer.de kannst du diese Sitzung mit dem Code ~~" + code0 + "~~ aufrufen, um alle Materialien zu sehen und Abgaben eines Feibeitsblattes zu erledigen.",
      "Hausaufgabe fürs Schulportal: fette Überschrift mit Datum, Stichpunkte, zuletzt der Weg zur Sitzung mit dem Code");
    await sp.goto(BASE + "/#/schueler");
    await sp.locator(".item", { hasText: "Das Bundesverfassungsgericht" }).waitFor();
    ok(await sp.locator(".item", { hasText: "Das Bundesverfassungsgericht" }).locator(".badge", { hasText: "Hausaufgabe" }).count() === 1, "… und in ihrer Sitzungsliste");

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
      abgabe: "Feibeitsblatt bis zum Ende der Stunde abgeben", schulportal: "**1) Vertretung**\n- Selbstlernphase mit Feibeitsblatt", materialien: [{ titel: "M1 Verfahren des BVerfG", bereich: "schueler", markdown: "# M1\nNormenkontrolle …" }],
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
    await SA("POST", "/api/student/join", { code: l2.code });
    const before = (await SA("GET", "/api/student/lessons/" + l2.id)).data;
    ok(!before.substitute && before.files.some((f) => f.name === "Original-Arbeitsblatt") && !(await tp.locator(".item", { hasText: "Anleitung zur Vertretungsstunde" }).count()), "vor der Bestätigung ändert sich nichts (auch nicht für Schüler:innen)");
    await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-vertretung-vorschlag.png"), fullPage: true });
    if (await tp.locator("#fbcard .badge", { hasText: "nicht verbunden" }).count()) {
      await tp.locator("#fbcard input[inputmode=numeric]").fill("1104"); await tp.locator("#fbcard input[type=password]").fill(FB_PW);
      await tp.locator("#fbcard").getByRole("button", { name: "Verbinden" }).click(); await tp.locator("#fbcard .badge", { hasText: "verbunden" }).first().waitFor({ timeout: 20000 });
    }
    const sheetsBefore = fbm.sheets.size;
    await prop.getByRole("button", { name: "Bestätigen: Sitzung auf Vertretung umstellen" }).click();
    await tp.locator(".modal").getByRole("button", { name: "Bestätigen und umstellen" }).click();
    await tp.locator(".substitute.active").waitFor({ timeout: 20000 });
    const subSheet = [...fbm.sheets.values()].find((x) => x.title === "Vertretung: Verfahren des BVerfG");
    ok(fbm.sheets.size === sheetsBefore + 1 && subSheet, "Feibeitsblatt der Vertretung angelegt");
    ok(subSheet && subSheet.tasks[1].answer && subSheet.tasks[1].answer.type === "photo" && subSheet.tasks[1].solution === "" && subSheet.tasks[0].solution.includes("abstrakt"), "Foto-Aufgabe als Antwortart „Foto“ angelegt – ohne Auftrag an die KI");
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
    await tp.locator(".substitute", { hasText: "Vertretungsvorschlag prüfen" }).getByRole("button", { name: "Bestätigen: Sitzung auf Vertretung umstellen" }).click();
    await tp.locator(".modal").getByRole("button", { name: "Bestätigen und umstellen" }).click();
    await tp.locator(".substitute.active").waitFor({ timeout: 20000 });
    const escSheet = [...fbm.sheets.values()].find((x) => x.title === "Finale: Mission Gewaltenteilung");
    ok(escSheet && escSheet.escape && /^unterricks-[a-f0-9]{8}-[a-f0-9]{6}$/.test(escSheet.escape.id) && escSheet.escape.name === "Mission Gewaltenteilung", "Finale-Feibeitsblatt mit Escape-Kennung angelegt");
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
      ok(cspErr.length === 0, "keine CSP- oder CORS-Fehler auf Pages" + (cspErr.length ? ": " + cspErr.slice(0, 3).join(" | ") : ""));
      const fctx = await browser.newContext(); const fp = await fctx.newPage();
      await fp.setContent('<iframe src="' + PAGES + '/" style="width:800px;height:600px"></iframe>');
      let hidden = null;
      for (let i = 0; i < 40 && hidden === null; i++) { await sleep(250); const fr = fp.frames().find((f) => f.url().startsWith(PAGES)); if (fr) hidden = await fr.evaluate(() => document.documentElement.hidden === true && !document.querySelector(".login-wrap, .topbar")).catch(() => null); }
      ok(hidden === true, "eingebettet in eine fremde Seite: Unterricks zeigt nichts");
      await fctx.close(); await ptc.close(); await pctx.close();
    } finally { pagesSrv.close(); }

    /* ---------- Sperren ---------- */
    step("Sperren");
    const ectx = await browser.newContext(); const ep = await ectx.newPage(); watch(ep, "Fremdgerät");
    await ep.goto(BASE + "/#/lehrkraft");
    for (let i = 0; i < 2; i++) { await ep.fill("#tu", "feindt"); await ep.fill("#tp", "falsch-" + i); await ep.getByRole("button", { name: "Anmelden" }).click(); await ep.locator(".err").filter({ hasText: /falsch|gesperrt/ }).waitFor(); }
    ok(await ep.locator(".err", { hasText: /gesperrt/ }).isVisible(), "Lehrkraft: nach 2 Fehlversuchen 30 Minuten gesperrt (dieses Gerät)");
    await ep.fill("#tp", T_PW); await ep.getByRole("button", { name: "Anmelden" }).click({ trial: false }).catch(() => {});
    await sleep(800);
    ok(!ep.url().includes("#/lk"), "… auch mit richtigem Passwort während der Sperre");
    await tp.getByRole("button", { name: "Abmelden" }).click();
    await tp.fill("#tu", "feindt"); await tp.fill("#tp", T_PW);
    tLogin = Date.now(); await tp.getByRole("button", { name: "Anmelden" }).click();
    await waitTeacherHome(tp, tLogin, "Anmeldung");
    ok(true, "eigenes, bekanntes Gerät bleibt nutzbar");
    const xctx = await browser.newContext(); const xp = await xctx.newPage(); watch(xp, "Schülergerät 2");
    await xp.goto(BASE + "/");
    for (let i = 0; i < 10; i++) { await xp.fill("#spw", "nein" + i); await xp.getByRole("button", { name: "Weiter" }).click(); await xp.locator(".err").waitFor(); await sleep(60); }
    ok(await xp.locator(".err", { hasText: /warte/ }).isVisible(), "Schüler:innen: nach 10 Fehlversuchen 1 Minute gesperrt");
  } finally {
    await browser.close();
    ai.srv.close(); fbm.srv.close();
    stopWrangler();
    if (failures) writeFileSync(join(OUT, "wrangler.log"), wlog);
  }
  ok(pageErrors.length === 0, "keine JavaScript-Fehler in den Seiten" + (pageErrors.length ? ": " + pageErrors.join(" | ") : ""));
  console.log("\n" + (failures ? "✗ " + failures + " Prüfung(en) fehlgeschlagen" : "✓ alle Prüfungen bestanden"));
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
