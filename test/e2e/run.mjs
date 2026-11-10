// End-to-End-Test: baut die Seite, startet den Worker lokal (wrangler dev: D1, R2, Durable Objects lokal), eine Mock-KI und einen
// Nachbau der Feibeitsblatt-Schnittstelle und spielt die Abläufe mit Chromium durch (Lehrkraft am Laptop, Schüler:in am iPad).
// Aufruf: npm run test:e2e   (Screenshots landen in test-results/)
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { startMockAI, startMockFeibeitsblatt } from "./mocks.mjs";

const require = createRequire(import.meta.url);
const { chromium, devices } = require("playwright");
const ROOT = new URL("../..", import.meta.url).pathname;
const PORT = 8787, AI_PORT = 8790, FB_PORT = 8788, BASE = "http://localhost:" + PORT, FB = "http://localhost:" + FB_PORT;
const OUT = join(ROOT, "test-results"); mkdirSync(OUT, { recursive: true });
const FB_PW = "Feibeitsblatt-Testpasswort", T_PW = "Lehrkraft-Passwort-2026";

let failures = 0;
const ok = (cond, label) => { if (cond) console.log("  ✓ " + label); else { failures++; console.log("  ✗ " + label); } };
const step = (s) => console.log("\n▶ " + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pdf(pages, label) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) { const p = d.addPage([960, 540]); p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: rgb(0.12, 0.23, 0.37) }); p.drawText(label + " – Folie " + i, { x: 60, y: 260, size: 48, font: f, color: rgb(1, 1, 1) }); }
  return Buffer.from(await d.save());
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
    "--var", "DEV_ALLOW_HTTP_AI:1", "--var", "FEIBEITSBLATT_API:" + FB, "--var", "FEIBEITSBLATT_URL:" + FB + "/"], { cwd: ROOT, env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, stdio: ["ignore", "pipe", "pipe"], detached: true });
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
    await tp.getByRole("link", { name: "Lehrkräfte" }).click();
    await tp.fill("#tu", "Feindt"); await tp.fill("#tp", T_PW); await tp.fill("#tp2", T_PW);
    await tp.getByRole("button", { name: "Zugang einrichten" }).click();
    await tp.waitForURL(/#\/lk$/, { timeout: 40000 }).catch(async (e) => { console.log("    Meldung:", await tp.locator(".err").allTextContents(), "URL:", tp.url(), "Knopf:", await tp.locator("form button").allTextContents()); await tp.screenshot({ path: join(OUT, "fehler-einrichtung.png") }); throw e; });
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

    /* ---------- Sitzung anlegen und planen ---------- */
    step("Fach → Klasse → neue Sitzung");
    await tp.getByRole("link", { name: /Politik und Wirtschaft/ }).click();
    await tp.getByRole("link", { name: "Q2", exact: true }).click();
    await tp.fill("#nt", "Das Bundesverfassungsgericht"); await tp.fill("#ntp", "Gewaltenteilung und BVerfG"); await tp.fill("#ndu", "90");
    await tp.getByRole("button", { name: "Sitzung anlegen" }).click();
    await tp.waitForURL(/#\/lk\/s\/[a-f0-9]{16}$/);
    const lessonId = tp.url().split("/").pop();
    ok(await tp.locator(".msg.assistant").first().textContent().then((t) => /Wie viele Minuten|90 Minuten/.test(t)), "Chatbot fragt zu Beginn nach Dauer und Wünschen");
    const lesson0 = (await T("GET", "/api/teacher/lessons/" + lessonId)).data.lesson;

    step("Planung im Chat (gestreamte Antwort, gespeichert)");
    await tp.fill("#chatin", "Bitte plane eine Stunde mit Karikatur und Partnerarbeit.");
    await tp.keyboard.press("Enter");
    await tp.locator(".msg.assistant", { hasText: "Ihre Nachricht war" }).waitFor({ timeout: 20000 });
    ok(true, "Antwort angezeigt");
    const sys = ai.calls[ai.calls.length - 1].messages[0].content;
    ok(sys.startsWith("Du bist ein leistungsfähiger didaktischer Assistent") && sys.includes("Unterrichtsfach: Politik und Wirtschaft") && sys.includes("Klasse/Kurs: Q2") && sys.includes("Das Bundesverfassungsgericht"),
      "System-Prompt: feste Rolle + Fach + Klasse + Sitzung automatisch übermittelt");
    await sleep(500);
    r = await T("GET", "/api/teacher/lessons/" + lessonId);
    ok(r.data.messages.filter((m) => m.role === "assistant").length === 2, "Antwort dauerhaft in der Sitzung gespeichert");

    step("Schulportal-Eintrag erstellen, bearbeiten, speichern");
    await tp.getByRole("button", { name: "Schulportal-Eintrag erstellen" }).click();
    await tp.locator("#portal").waitFor({ timeout: 20000 });
    const generated = await tp.inputValue("#portal");
    ok(generated.startsWith("**1) TOP 10**") && generated.includes("- Einstieg: ~~Ist das Bundesverfassungsgericht zu mächtig?~~") && generated.includes("--> Nächste Stunde\n\n**4) Diskussionsrunde**"), "Format wie in der Vorlage (fett, ~~kursiv~~, „--> Nächste Stunde“)");
    ok(await tp.locator(".portal-preview em", { hasText: "Ist das Bundesverfassungsgericht zu mächtig?" }).count() === 1, "Vorschau zeigt ~~…~~ kursiv");
    ok(!(await tp.getByRole("button", { name: "Prompt für die Präsentation kopieren" }).isDisabled()), "Präsentations-Knopf erst mit Eintrag aktiv");
    await tp.locator("#portal").press("End");
    await tp.locator("#portal").evaluate((el) => { el.value += "\n- Manuell ergänzt: Hausaufgabe S. 12"; el.dispatchEvent(new Event("input")); });
    await tp.locator(".save-state", { hasText: "Gespeichert ✓" }).waitFor({ timeout: 10000 });
    r = await T("GET", "/api/teacher/lessons/" + lessonId);
    ok(r.data.lesson.portal.endsWith("- Manuell ergänzt: Hausaufgabe S. 12"), "manuelle Änderung dauerhaft gespeichert");
    const stale = await T("PUT", "/api/teacher/lessons/" + lessonId + "/portal", { text: "alt", baseVersion: 1 });
    ok(stale.status === 409, "veraltete Fassung überschreibt nie still (409)");
    await tp.locator("#portal").evaluate((el) => { el.value += "\n- Noch nicht gespeichert"; el.dispatchEvent(new Event("input")); });
    await tp.getByRole("button", { name: "Prompt für die Präsentation kopieren" }).click();
    const presPrompt = await tp.evaluate(() => navigator.clipboard.readText());
    ok(presPrompt.includes("Manuell ergänzt: Hausaufgabe S. 12") && presPrompt.includes("Noch nicht gespeichert"), "Präsentations-Prompt nutzt exakt den aktuellen Textfeld-Inhalt");
    ok(/PowerPoint-Präsentation \(\.pptx/.test(presPrompt) && presPrompt.includes("Politik und Wirtschaft") && presPrompt.includes("90 Minuten"), "Prompt fordert PPTX + PDF mit allen Rahmendaten an");
    await tp.locator(".save-state", { hasText: "Gespeichert ✓" }).waitFor({ timeout: 10000 });
    ok((await T("GET", "/api/teacher/lessons/" + lessonId)).data.lesson.portal.includes("Noch nicht gespeichert"), "… und speichert diesen Stand sofort");

    step("Claude-Prompt „Unterrichtsidee weiterentwickeln“");
    await tp.getByRole("button", { name: "Prompt für Claude erzeugen und kopieren" }).click();
    const idea = await tp.evaluate(() => navigator.clipboard.readText());
    ok(["Q2", "Politik und Wirtschaft", "Gewaltenteilung und BVerfG", "90 Minuten", "Karikatur und Partnerarbeit", "Ihre Nachricht war", lessonId].every((s) => idea.includes(s)), "enthält Klasse, Fach, Thema, Dauer, Wünsche, Inhalte und Sitzungs-ID");

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
    await tp.screenshot({ path: join(OUT, "lehrkraft-sitzung.png"), fullPage: true });

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
    ok(await sp.getByRole("button", { name: "Politik und Wirtschaft" }).isVisible() && await sp.getByRole("button", { name: "Evangelische Religion" }).isVisible() && await sp.getByRole("button", { name: "Ethik" }).isVisible() && (await sp.locator(".tiles .tile").count()) === 3, "genau drei Fächer zur Auswahl");
    await sp.getByRole("button", { name: "Ethik" }).click(); await sp.getByRole("button", { name: "Q2", exact: true }).click();
    await sp.getByRole("button", { name: "Speichern und weiter" }).click();
    await sp.fill("#code", lesson0.code.toLowerCase()); await sp.getByRole("button", { name: "Sitzung öffnen" }).click();
    ok(await sp.locator(".err", { hasText: "anderen Klasse oder einem anderen Fach" }).waitFor({ timeout: 10000 }).then(() => true, () => false), "Code einer anderen Klasse/eines anderen Fachs öffnet nichts");
    await sp.getByRole("button", { name: "Klasse/Fach ändern" }).click();
    await sp.getByRole("button", { name: "Politik und Wirtschaft" }).click(); await sp.getByRole("button", { name: "Q2", exact: true }).click();
    await sp.getByRole("button", { name: "Speichern und weiter" }).click();
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
    await sp.screenshot({ path: join(OUT, "schueler-live.png") });
    await tp.screenshot({ path: join(OUT, "lehrkraft-praesentation.png") });
    await tp.getByRole("button", { name: "Präsentation für alle beenden" }).click();
    await sp.locator(".live .placeholder").waitFor({ timeout: 10000 });
    ok(true, "Beenden kommt bei allen an");

    /* ---------- Claude-Connector (MCP) ---------- */
    step("Claude-Connector (MCP)");
    const mc = (await T("POST", "/api/teacher/mcp")).data;
    const rpc = (body, url = mc.url) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify(body) }).then(async (x) => ({ status: x.status, data: x.status === 202 ? null : await x.json() }));
    r = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    ok(r.data.result.protocolVersion === "2025-06-18" && r.data.result.capabilities.tools, "älteres Protokoll: initialize");
    ok((await rpc({ jsonrpc: "2.0", method: "notifications/initialized" })).status === 202, "Benachrichtigung → 202");
    const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} };
    r = await rpc({ jsonrpc: "2.0", id: 2, method: "server/discover", params: { _meta: meta } });
    ok(r.data.result.resultType === "complete" && r.data.result.supportedVersions.includes("2026-07-28"), "aktuelles Protokoll 2026-07-28: server/discover");
    r = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: { ...meta, "io.modelcontextprotocol/protocolVersion": "1999-01-01" } } });
    ok(r.data.error && r.data.error.code === -32022, "unbekannte Version → UnsupportedProtocolVersion");
    r = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: meta } });
    ok(["get_lesson", "save_schulportal_entry", "add_text_material", "propose_feibeitsblatt"].every((n) => r.data.result.tools.some((t) => t.name === n)), "Werkzeuge gelistet");
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
    await tp.screenshot({ path: join(OUT, "lehrkraft-abgaben.png") });
    await tp.keyboard.press("Escape");

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
    await tp.fill("#tu", "feindt"); await tp.fill("#tp", T_PW); await tp.getByRole("button", { name: "Anmelden" }).click();
    await tp.waitForURL(/#\/lk$/, { timeout: 20000 });
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
