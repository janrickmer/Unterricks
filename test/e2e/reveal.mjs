// reveal.mjs – End-to-End-Prüfung von Nachtrag 44 (Teil 1) und Nachtrag 45: Material erscheint live mit seiner Materialfolie (Schüler:in am iPad, Lehrkraft
// am Laptop und an einem zweiten Gerät, ohne Neuladen der Schülerseite) und ein Feibeitsblatt aus einer früheren Sitzung „wieder gebraucht“ – mit der Übergabe
// der Zwischenstand-PDF an eine Attrappe des Feibeitsblatts (context.route, Protokoll v1 aus public/fbagain.js) und dem Rückfall für ein älteres Feibeitsblatt.
// Eigener Kurs PoWi 9C mit zwei Sitzungen weit in der Zukunft (Beginn 10:00, 45 Minuten – die Freigabe nach der Stunde greift während der Prüfung nicht;
// danach gelöscht, berührt weder Druckaufträge noch Kalender oder Podcast der übrigen Prüfungen). Frei erfundene Inhalte.
// ctx = {browser, tp (Seite der Lehrkraft, angemeldet), BASE, FB (Adresse des Feibeitsblatts), T (Fetch mit Anmeldung), token, tool (Connector), ok, OUT, SHOT,
//        horizontalIssues, devices, watch}
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const SHEET = { code: "GWT4KQ", title: "Gewaltenteilung" };
const HEAD3 = ["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", "Feibeitsblatt: Gewaltenteilung"];
const HEAD5 = ["Lest M2 Karikatur und notiert eure Beobachtungen."];

/* Präsentation mit zwei Materialfolien (Unterricks-Codefolien wie laut Prompt): Folie 3 zum Feibeitsblatt, Folie 5 zu „M2 Karikatur“ */
async function revealDeck(CODE_SLIDE_LINE) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.HelveticaBold), reg = await d.embedFont(StandardFonts.Helvetica), bg = rgb(0.12, 0.23, 0.37), white = rgb(1, 1, 1);
  const pages = [["Gewaltenteilung"], ["Ablauf der Stunde"], HEAD3, ["Besprechung"], HEAD5, ["Hausaufgabe"]];
  pages.forEach((lines, i) => {
    const p = d.addPage([960, 540]);
    p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: bg });
    const code = i === 2 || i === 4;
    lines.forEach((t, k) => p.drawText(t, { x: 60, y: 380 - k * 60, size: code && k === 0 && lines.length > 1 ? 28 : 36, font: code && k === 0 && lines.length > 1 ? reg : f, color: white }));
    if (code) p.drawText(CODE_SLIDE_LINE, { x: 60, y: 60, size: 12, font: reg, color: white });
  });
  return Buffer.from(await d.save());
}
const a4 = async (label) => { const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica); d.addPage([595.28, 841.89]).drawText(label, { x: 50, y: 760, size: 20, font: f }); return Buffer.from(await d.save()); };

/* Attrappe des Feibeitsblatts (Startseite): „neu“ = mit der Übergabe nach Protokoll v1, „alt“ = ein älteres Feibeitsblatt ohne Übergabe (meldet nichts) */
function fbScript(U) {
  if (location.hash !== "#von-unterricks" || !window.opener) return;
  history.replaceState(null, "", location.pathname + location.search);
  let done = false;
  window.addEventListener("message", (e) => {
    if (e.source !== window.opener || e.origin !== U) return;
    const d = e.data;
    if (!d || d.kind !== "unterricks-zwischenstand" || d.v !== 1) return;
    const ok = !done && d.pdf instanceof ArrayBuffer && d.pdf.byteLength <= 5 * 1024 * 1024 && String.fromCharCode(...new Uint8Array(d.pdf, 0, 5)) === "%PDF-";
    if (ok) { done = true; window.__got = { name: d.name, size: d.pdf.byteLength }; document.getElementById("st").textContent = "Zwischenstand geladen: " + d.name; }
    e.source.postMessage({ kind: "feibeitsblatt-zwischenstand-angekommen", v: 1, ok, ...(ok ? {} : { grund: done ? "beschaeftigt" : "kein-pdf" }) }, e.origin);
  });
  window.opener.postMessage({ kind: "feibeitsblatt-bereit", v: 1 }, U);
}
const fakeFb = (mode, unterricks) => '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Feibeitsblatt (Attrappe)</title></head><body><h1>Feibeitsblatt</h1>' +
  '<p id="st">Startseite</p><script>' + (mode === "neu" ? "(" + fbScript.toString() + ")(" + JSON.stringify(unterricks) + ");" : "") + "</script></body></html>";

export async function revealE2E({ browser, tp, BASE, FB, T, token, tool, ok, OUT, SHOT, horizontalIssues, devices, watch = () => {} }) {
  const { berlinToday, addDays, CODE_SLIDE_LINE } = await import("../../public/shared.js");
  const { INCLASS_LABEL, FULL_LABEL } = await import("../../public/inclasslib.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const d0 = addDays(berlinToday(), 40), d1 = addDays(d0, 1), wd = (d) => new Date(d + "T12:00:00Z").getUTCDay();
  const u = (await T("POST", "/api/teacher/units", { subject: "powi", klass: "9C", title: "Gewaltenteilung (live)", params: { start: d0, end: d1, weekdays: [...new Set([d0, d1].map(wd))].map((day) => ({ day, minutes: 45, time: "10:00" })) } })).data.unit;
  await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: "Gewaltenteilung (live)", lernaufgabe: "Positionspapier" }, rows: [
    { stundenfrage: "Wer kontrolliert wen?", ablauf: ["Feibeitsblatt in Partnerarbeit"], date: d0, time: "10:00", minutes: 45 },
    { stundenfrage: "Weiter mit dem Feibeitsblatt", ablauf: ["Feibeitsblatt fertigstellen"], date: d1, time: "10:00", minutes: 45 }] });
  const ls = (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit.lessons;
  const A = ls.find((l) => l.date === d0), B = ls.find((l) => l.date === d1);
  ok(!!(A && B), "Kurs PoWi 9C: zwei Sitzungen (" + d0 + ", " + d1 + ", je 10:00, 45 Minuten)");
  const raw = (path, buf) => fetch(BASE + path, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/pdf" }, body: buf }).then((x) => x.json());
  const fAb = (await raw("/api/teacher/lessons/" + A.id + "/files?area=student&name=" + encodeURIComponent("Arbeitsblatt Ablauf.pdf"), await a4("Ablauf"))).file;
  const fM2 = (await raw("/api/teacher/lessons/" + A.id + "/files?area=student&name=" + encodeURIComponent("M2 Karikatur.pdf"), await a4("M2"))).file;
  await T("POST", "/api/teacher/lessons/" + A.id + "/sheets", SHEET);
  const nf = (await raw("/api/teacher/lessons/" + A.id + "/sheets/" + SHEET.code + "/notfall?sig=e2e", await a4("Notfall"))).file;
  ok(!!(fAb && fM2 && nf), "Sitzung A: Arbeitsblatt (ohne Materialfolie), „M2 Karikatur“ und das Feibeitsblatt „Gewaltenteilung“ samt Notfall-Feibeitsblatt");

  /* ---- Präsentation mit zwei Materialfolien hochladen (Folienbilder im Browser) ---- */
  await tp.goto(BASE + "/#/lk/s/" + A.id);
  const presCard = tp.locator("section.card", { hasText: "Präsentation für den Unterricht" });
  await presCard.waitFor({ timeout: 15000 });
  await tp.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await presCard.locator("input[type=file]").first().setInputFiles({ name: "Gewaltenteilung live.pdf", mimeType: "application/pdf", buffer: await revealDeck(CODE_SLIDE_LINE) });
  await tp.locator(".toast", { hasText: "Präsentation bereit (6 Folien)." }).waitFor({ timeout: 60000 });
  const pf = (await T("GET", "/api/teacher/lessons/" + A.id)).data.files.find((f) => f.area === "presentation");
  ok(JSON.stringify(pf.codeSlides) === JSON.stringify([{ n: 3, lines: HEAD3 }, { n: 5, lines: HEAD5 }]), "Materialfolien erkannt: Folie 3 (Feibeitsblatt) und Folie 5 (M2 Karikatur)");
  await tp.reload();
  const fbRow = tp.locator("#fbcard .item", { hasText: SHEET.title }), m2Row = tp.locator(".item", { hasText: "M2 Karikatur.pdf" }).first();
  await fbRow.locator(".reveal-note").waitFor({ timeout: 15000 });
  ok((await fbRow.locator(".reveal-text").textContent()) === "Erscheint bei den Schüler:innen erst, wenn Folie 3 (Materialfolie) live gezeigt wird"
    && (await m2Row.locator(".reveal-text").textContent()) === "Erscheint bei den Schüler:innen erst, wenn Folie 5 (Materialfolie) live gezeigt wird"
    && await tp.locator(".item", { hasText: "Arbeitsblatt Ablauf.pdf" }).locator(".reveal-note").count() === 0,
    "Lehrkraft (vollständige Sitzung): an Feibeitsblatt und „M2 Karikatur“ steht, ab welcher Folie die Schüler:innen sie sehen – am Arbeitsblatt ohne Materialfolie nichts");
  ok(await m2Row.getByRole("button", { name: "„M2 Karikatur.pdf“ jetzt für Schüler:innen freigeben" }).count() === 1 && (await m2Row.locator(".reveal-go").boundingBox()).height >= 44,
    "… dazu „Jetzt freigeben“ (≥ 44 px)");
  await fbRow.screenshot({ ...SHOT, path: join(OUT, "nr44-lehrkraft-wartet.png") });

  /* ---- Schüler:in (iPad): sieht nur das Arbeitsblatt – auch die Schnittstelle liefert nichts Wartendes ---- */
  const sctx = await browser.newContext({ ...devices["iPad (gen 7)"] });
  await sctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  const sp = await sctx.newPage(); watch(sp, "Schüler:in (Nachtrag 44/45)");
  const bodies = [];
  sp.on("response", async (x) => { if (/\/api\/student\/lessons\/[a-f0-9]{16}$/.test(x.url())) try { bodies.push(await x.text()); } catch {} });
  await sp.goto(BASE + "/"); await sp.fill("#spw", "Feindt"); await sp.getByRole("button", { name: "Weiter" }).click();
  await sp.getByRole("button", { name: "Politik und Wirtschaft" }).click(); await sp.getByRole("button", { name: "9C", exact: true }).click();
  await sp.getByRole("button", { name: "Speichern und weiter" }).click();
  await sp.fill("#code", A.code); await sp.getByRole("button", { name: "Sitzung öffnen" }).click();
  await sp.locator(".item", { hasText: "Arbeitsblatt Ablauf.pdf" }).waitFor({ timeout: 15000 });
  const stoken = await sp.evaluate(() => localStorage.getItem("u.stoken"));
  const SA = (path) => fetch(BASE + path, { method: "POST", headers: { Authorization: "Bearer " + stoken } }).then((x) => x.status);
  const names = () => sp.locator("section.card:not(.notfallbox) .item .name").allTextContents();
  ok(JSON.stringify(await names()) === JSON.stringify(["Arbeitsblatt Ablauf.pdf"]) && await sp.locator("section.notfallbox").count() === 0 && !bodies.join("").includes(SHEET.code)
    && !bodies.join("").includes("M2 Karikatur") && await SA("/api/student/files/" + nf.id + "/link") === 404 && await SA("/api/student/files/" + fM2.id + "/link") === 404,
    "Schüler:in: nur das Arbeitsblatt ohne Materialfolie – kein Feibeitsblatt, kein Code, kein Notfall-Feibeitsblatt, auch nicht über die Schnittstelle (404)");
  await sp.evaluate(() => { window.__same = 1; });
  const abBtn = sp.locator(".item", { hasText: "Arbeitsblatt Ablauf.pdf" }).getByRole("button", { name: "Herunterladen" });
  await abBtn.focus();
  const focusStays = () => sp.evaluate(() => { const a = document.activeElement; return !!a && a.textContent === "Herunterladen" && !!a.closest(".item") && a.closest(".item").textContent.includes("Arbeitsblatt Ablauf.pdf"); });

  /* ---- Freigabe von Hand (z. B. Beamer streikt): „M2 Karikatur“ erscheint ohne Neuladen ---- */
  await tp.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await m2Row.getByRole("button", { name: "„M2 Karikatur.pdf“ jetzt für Schüler:innen freigeben" }).click();
  await tp.locator(".toast", { hasText: "„M2 Karikatur.pdf“ ist jetzt für Schüler:innen sichtbar." }).waitFor({ timeout: 10000 });
  await sp.locator(".item.fresh", { hasText: "M2 Karikatur.pdf" }).waitFor({ timeout: 15000 });
  ok(await sp.evaluate(() => window.__same === 1) && await focusStays() && (await sp.locator("#mat-live").textContent()) === "Neues Material: „M2 Karikatur.pdf“."
    && (await sp.locator(".item", { hasText: "M2 Karikatur.pdf" }).locator(".badge.neu").textContent()) === "neu" && await SA("/api/student/files/" + fM2.id + "/link") === 200,
    "Freigabe von Hand: „M2 Karikatur“ erscheint bei der Schülerin ohne Neuladen – markiert „neu“, angesagt (Live-Region), der Fokus bleibt; jetzt auch über den Link");
  ok((await m2Row.locator(".reveal-text").textContent()).startsWith("Für Schüler:innen sichtbar seit ") && (await m2Row.locator(".reveal-text").textContent()).endsWith(" Uhr – von Ihnen freigegeben")
    && await m2Row.locator(".reveal-go").count() === 0, "Lehrkraft: „… – von Ihnen freigegeben“, kein Knopf mehr");

  /* ---- Live-Präsentation (zweites Gerät der Lehrkraft): Folie 3 → das Feibeitsblatt erscheint samt Notfall-Feibeitsblatt ---- */
  const tStore = await tp.evaluate(() => JSON.stringify(localStorage));
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await c2.addInitScript((s) => { try { if (!sessionStorage.getItem("x")) { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); sessionStorage.setItem("x", "1"); } } catch {} }, tStore);
  const p2 = await c2.newPage(); watch(p2, "Lehrkraft (Präsentation, Nachtrag 44)");
  await p2.goto(BASE + "/#/lk/s/" + A.id);
  await p2.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
  await p2.locator(".presenter").waitFor({ timeout: 15000 });
  const next = async (n) => { await p2.keyboard.press("ArrowRight"); await p2.locator(".presenter .counter", { hasText: n + " / 6" }).waitFor({ timeout: 10000 }); };
  await next(1); await next(2);
  await sleep(2500);
  ok(await sp.locator(".item", { hasText: "Feibeitsblatt · Code" }).count() === 0, "Folie 1 und 2: das Feibeitsblatt wartet noch");
  await next(3);
  await sp.locator(".live .codeslide.cs-task").waitFor({ timeout: 10000 });
  const fbItem = sp.locator(".item.fresh", { hasText: "Feibeitsblatt · Code" });
  await fbItem.waitFor({ timeout: 15000 });
  ok((await fbItem.textContent()).includes("GWT-4KQ") && await sp.evaluate(() => window.__same === 1) && await focusStays()
    && (await sp.locator("#mat-live").textContent()) === "Neues Material: „Gewaltenteilung“.",
    "Folie 3 (Materialfolie) live: das Feibeitsblatt erscheint ohne Neuladen (Code, „neu“, angesagt), der Fokus bleibt");
  await sp.locator("section.notfallbox").waitFor({ timeout: 10000 });
  ok(await sp.locator("section.notfallbox details").evaluate((d) => !d.open) && await SA("/api/student/files/" + nf.id + "/link") === 200
    && !!(await sp.evaluate(() => { const box = document.querySelector(".notfallbox"), mat = document.querySelector("#mat-h").closest("section"); return mat.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING; })),
    "… mit ihm das Notfall-Feibeitsblatt (zugeklappt, unter dem Material, jetzt auch über den Link)");
  for (const dark of [false, true]) {
    await sp.emulateMedia({ colorScheme: dark ? "dark" : "light", reducedMotion: "reduce" }); await sleep(150);
    await sp.locator("#mat-h").evaluate((e) => e.closest("section").scrollIntoView());
    await sp.locator("#mat-h").locator("xpath=ancestor::section[1]").screenshot({ ...SHOT, path: join(OUT, "nr44-schueler-material-neu" + (dark ? "-dunkel" : "") + ".png") });
  }
  await sp.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  // Lehrkraft: die kompakte Ansicht nennt den Stand am Material
  await tp.reload();
  await tp.getByRole("button", { name: INCLASS_LABEL, exact: true }).click();
  const colS = tp.locator("#ic-material .ic-col").nth(0);
  await colS.locator(".ic-item", { hasText: SHEET.title }).locator(".reveal-note").waitFor({ timeout: 15000 });
  ok((await colS.locator(".ic-item", { hasText: SHEET.title }).locator(".reveal-text").textContent()).endsWith(" Uhr – Materialfolie live gezeigt")
    && (await colS.locator(".ic-item", { hasText: "M2 Karikatur.pdf" }).locator(".reveal-text").textContent()).endsWith(" Uhr – von Ihnen freigegeben"),
    "„Ich bin jetzt im Unterricht“: Spalte „Für Schüler:innen sichtbar“ nennt, seit wann (live gezeigt bzw. von Hand freigegeben)");
  await tp.locator("#ic-material").screenshot({ ...SHOT, path: join(OUT, "nr44-lehrkraft-kompakt-material.png") });
  await tp.getByRole("button", { name: FULL_LABEL }).click();
  // beendet für alle: bleibt sichtbar – auch nach dem Neuladen
  await p2.locator(".presenter").getByRole("button", { name: "Präsentation für alle beenden" }).click();
  await sp.locator(".live.idle").waitFor({ timeout: 15000 });
  await sp.reload();
  await sp.locator(".item", { hasText: "Feibeitsblatt · Code" }).waitFor({ timeout: 15000 });
  ok(JSON.stringify(await names()) === JSON.stringify([SHEET.title, "Arbeitsblatt Ablauf.pdf", "M2 Karikatur.pdf"]) && await sp.locator(".item.fresh").count() === 0,
    "Präsentation beendet, Seite neu geladen: einmal freigegebenes Material bleibt sichtbar (ohne „neu“)");
  await c2.close();

  /* ---- Nachtrag 45: dasselbe Feibeitsblatt in der nächsten Sitzung – Claude verknüpft es über den Connector ---- */
  const r = await tool("link_feibeitsblatt", { lesson_id: B.id, code: "GWT-4KQ" });
  ok(!r.isError && r.content[0].text.includes("„Gewaltenteilung“ (Code GWT-4KQ) ist mit der Sitzung verknüpft.") && r.content[0].text.includes("„wieder gebraucht“"),
    "Connector link_feibeitsblatt: das Blatt der früheren Sitzung mit der nächsten verknüpft (Titel aus der früheren Sitzung, „wieder gebraucht“)");
  await tp.goto(BASE + "/#/lk/s/" + B.id);
  const bRow = tp.locator("#fbcard .item", { hasText: SHEET.title });
  await bRow.locator(".fbagain-t").waitFor({ timeout: 15000 });
  ok((await bRow.locator(".fbagain-t").textContent()).startsWith("Wieder gebraucht auch mit einer früheren Sitzung dieses Kurses verknüpft"), "Lehrkraft: „Wieder gebraucht“ am Feibeitsblatt der späteren Sitzung");
  // Schüler:in in einem eigenen Browser-Kontext mit der Attrappe des Feibeitsblatts
  const sStore = await sp.evaluate(() => JSON.stringify(localStorage));
  const rctx = await browser.newContext({ ...devices["iPad (gen 7)"] });
  await rctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await rctx.addInitScript((s) => { try { if (!sessionStorage.getItem("x")) { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); sessionStorage.setItem("x", "1"); } } catch {} }, sStore);
  const fbHost = new URL(FB), U = new URL(BASE).origin;
  let fbMode = "neu";
  await rctx.route((url) => url.origin === fbHost.origin && url.pathname === "/", (route) => route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: fakeFb(fbMode, U) }));
  const rp = await rctx.newPage(); watch(rp, "Schüler:in (Zwischenstand)");
  await rp.goto(BASE + "/#/schueler");
  await rp.fill("#code", B.code); await rp.getByRole("button", { name: "Sitzung öffnen" }).click();
  const again = rp.locator(".item.fbagain", { hasText: SHEET.title });
  await again.waitFor({ timeout: 15000 });
  const input = again.locator("input.fba-file"), go = again.getByRole("button", { name: "Im Feibeitsblatt weiterarbeiten" }), status = again.locator(".fba-status");
  ok((await again.locator(".badge.again").textContent()) === "Wieder gebraucht" && (await again.locator(".fba-pick").textContent()).trim() === "Zwischenstand-PDF auswählen"
    && (await again.locator(".fba-code").textContent()) === "Feibeitsblatt-Code GWT-4KQ" && !(await go.isVisible())
    && await again.getByRole("button", { name: /^Von vorn beginnen/ }).count() === 1 && (await again.locator(".fba-pick").boundingBox()).height >= 54
    && (await again.locator(".fba-restart").boundingBox()).height >= 44
    && parseFloat(await again.locator(".fba-code").evaluate((e) => getComputedStyle(e).fontSize)) < parseFloat(await again.locator(".name").evaluate((e) => getComputedStyle(e).fontSize)),
    "Schüler:in (Sitzung B): „Wieder gebraucht“, ein klares Feld für die Zwischenstand-PDF, darunter klein der Code und der kleine Knopf „Von vorn beginnen“ – noch kein „Im Feibeitsblatt weiterarbeiten“");
  for (const [w, hh] of [[820, 1180], [390, 844]]) for (const dark of [false, true]) {
    await rp.setViewportSize({ width: w, height: hh }); await rp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await sleep(150);
    await again.scrollIntoViewIfNeeded();
    await again.screenshot({ ...SHOT, path: join(OUT, "nr45-schueler-wieder-gebraucht-" + w + (dark ? "-dunkel" : "") + ".png") });
    if (!dark && w === 390) { const hi = (await horizontalIssues(rp)).issues; ok(!hi.length, "„Wieder gebraucht“ bei 390 px: ohne seitliches Schieben" + (hi.length ? " – " + JSON.stringify(hi).slice(0, 200) : "")); }
  }
  await rp.emulateMedia({ colorScheme: "light" }); await rp.setViewportSize(devices["iPad (gen 7)"].viewport);
  // Tastatur: das Dateifeld ist erreichbar, das Feld zeigt den Fokus
  await input.focus();
  ok(await again.locator(".fba-pick").evaluate((e) => getComputedStyle(e).outlineStyle !== "none"), "Tastatur: das Feld zeigt den Fokus (Dateiauswahl mit Enter bzw. Leertaste)");
  // falsche Datei: Meldung in du-Form, kein Knopf
  await input.setInputFiles({ name: "notiz.txt", mimeType: "text/plain", buffer: Buffer.from("Hallo, das ist keine PDF.") });
  await again.locator(".fba-err", { hasText: "Das ist keine PDF-Datei." }).waitFor({ timeout: 5000 });
  ok(!(await go.isVisible()), "keine PDF: „Das ist keine PDF-Datei. Wähle die Zwischenstand-PDF, die du im Feibeitsblatt gespeichert hast.“ – kein Knopf");
  // die Zwischenstand-PDF: Übergabe an das Feibeitsblatt (Attrappe mit Protokoll v1)
  const draft = await a4("Zwischenstand Gewaltenteilung");
  await input.setInputFiles({ name: "Zwischenstand Gewaltenteilung.pdf", mimeType: "application/pdf", buffer: draft });
  await go.waitFor({ timeout: 5000 });
  ok((await again.locator(".fba-err").textContent()) === "" && (await again.locator(".fba-chosen").textContent()).includes("Zwischenstand Gewaltenteilung.pdf"), "gültige PDF: gewählt, „Im Feibeitsblatt weiterarbeiten“ erscheint");
  const [fbp] = await Promise.all([rctx.waitForEvent("page", { timeout: 15000 }), go.click()]);
  watch(fbp, "Feibeitsblatt (Attrappe)");
  await fbp.locator("#st", { hasText: "Zwischenstand geladen: Zwischenstand Gewaltenteilung.pdf" }).waitFor({ timeout: 15000 });
  await status.filter({ hasText: "Dein Zwischenstand ist im Feibeitsblatt geöffnet." }).waitFor({ timeout: 10000 });
  ok((await fbp.evaluate(() => window.__got.size)) === draft.length && new URL(fbp.url()).hash === "" && !(await go.isVisible()),
    "Übergabe: das Feibeitsblatt bekommt genau die PDF (Bereitschaft → Übergabe → Antwort), entfernt die Marke aus der Adresse; Meldung „Dein Zwischenstand ist im Feibeitsblatt geöffnet.“");
  await again.screenshot({ ...SHOT, path: join(OUT, "nr45-schueler-uebergeben.png") });
  await fbp.close();
  // älteres Feibeitsblatt ohne Übergabe: nach 10 s ruhig die Anleitung (der Tab ist offen)
  fbMode = "alt";
  await input.setInputFiles({ name: "Zwischenstand Gewaltenteilung.pdf", mimeType: "application/pdf", buffer: draft });
  await go.waitFor({ timeout: 5000 });
  const t0 = Date.now();
  const [old] = await Promise.all([rctx.waitForEvent("page", { timeout: 15000 }), go.click()]);
  await status.filter({ hasText: "Tippe im Feibeitsblatt auf „Zwischenstand-PDF hochladen“ und wähle deine PDF-Datei." }).waitFor({ timeout: 20000 });
  ok(Date.now() - t0 >= 9000 && (await old.locator("#st").textContent()) === "Startseite", "älteres Feibeitsblatt (keine Bereitschaft): nach 10 s die Anleitung zum eigenen Hochladen");
  await old.close();
  // Von vorn beginnen: Code in die Zwischenablage, Feibeitsblatt in neuem Tab (ohne Zwischenstand)
  const [fresh] = await Promise.all([rctx.waitForEvent("page", { timeout: 15000 }), again.getByRole("button", { name: /^Von vorn beginnen/ }).click()]);
  await fresh.waitForLoadState();
  ok(fresh.url() === FB + "/" && (await rp.evaluate(() => navigator.clipboard.readText())) === "GWT-4KQ", "„Von vorn beginnen“: Code GWT-4KQ in der Zwischenablage, Feibeitsblatt in neuem Tab (ohne Übergabe)");
  await fresh.close();
  // die frühere Sitzung zeigt das Blatt wie bisher (nicht „wieder gebraucht“)
  await rp.goto(BASE + "/#/schueler/s/" + A.id);
  await rp.locator(".item", { hasText: "Feibeitsblatt · Code" }).waitFor({ timeout: 15000 });
  ok(await rp.locator(".item.fbagain").count() === 0 && await rp.getByRole("button", { name: "Code kopieren und Feibeitsblatt öffnen" }).count() === 1, "die frühere Sitzung zeigt das Blatt wie bisher");
  await rctx.close(); await sctx.close();
  await T("DELETE", "/api/teacher/lessons/" + A.id); await T("DELETE", "/api/teacher/lessons/" + B.id); await T("DELETE", "/api/teacher/units/" + u.id);
}
