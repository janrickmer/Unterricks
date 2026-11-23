// inclass.mjs – End-to-End-Prüfung von Nachtrag 35: „Ich bin jetzt im Unterricht“ – die Sitzung in kompakter Form (Gymnasium und Grundschule).
// Eigene Sitzungen weit in der Vergangenheit (danach gelöscht – berührt weder Druckaufträge noch Kalender oder Podcast der übrigen Prüfungen): Gymnasium
// PoWi 9E mit Präsentation (Phasen unsichtbar auf den Folien, wie aus phasestop.mjs), Notizen samt Anmerkungs-PDF, Material in beiden Bereichen, Druckvorlage,
// Link, Text, zwei Feibeitsblättern samt Notfall-Feibeitsblättern; Grundschule mit Verlaufsplan, Material für die Kinder (auch zum Ausdrucken), Material nur für
// die Lehrkraft, Druckvorlage und hochgeladenen Bildkarten. Frei erfundene Inhalte.
// ctx = {browser, tp (Seite der Lehrkraft, angemeldet), BASE, T (Fetch mit Anmeldung), token, ok, OUT, SHOT, gsCourse (ID eines Grundschulkurses), horizontalIssues, devices}
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { phaseDeck } from "./phasestop.mjs";

const PORTAL = "**1) Einstieg**\n- Karikatur ~~Wer hat die Macht?~~\n\n**2) Partnerarbeit**\n- Feibeitsblatt ~~Gewaltenteilung~~\n\n**3) Sicherung**\n- Tafelbild\n\n" +
  "--> Nächste Stunde\n\n**4) Diskussion**\n- Ist das BVerfG zu mächtig?";
const GSPLAN = (ab, vor, cards) => "**1) Ankommen im Sitzkreis (5 Min.)**\n- Begrüßungslied\n**2) Erzählung (15 Min., Sitzkreis)**\n- __Lehrkraft liest [[pdf:" + vor + "|Vorlesetext]] vor.__\n- Bildkarten [[pdf:" + cards + "]] in die Mitte legen\n" +
  "**3) Arbeitsblatt (15 Min., Einzelarbeit)**\n- [[pdf:" + ab + "]]\n**4) Abschluss (5 Min.)**\n- Lied";
const a4 = async (label, pages = 1) => { const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica); for (let i = 0; i < pages; i++) d.addPage([595.28, 841.89]).drawText(label + (pages > 1 ? " " + (i + 1) : ""), { x: 50, y: 760, size: 20, font: f }); return Buffer.from(await d.save()); };
const SHEET1 = { code: "KQ4M7Z", title: "Gewaltenteilung" }, SHEET2 = { code: "PR3X8N", title: "Wehrhafte Demokratie" };

export async function inClassE2E({ browser, tp, BASE, T, token, ok, OUT, SHOT, gsCourse, horizontalIssues, devices, watch = () => {} }) {
  const { berlinToday, addDays, STOP_LINE } = await import("../../public/shared.js");
  const { INCLASS_LABEL, FULL_LABEL, ARROW_NAME, INCLASS_KEY } = await import("../../public/inclasslib.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const d0 = addDays(berlinToday(), -50), wd = new Date(d0 + "T12:00:00Z").getUTCDay();
  const made = [];
  const oneLesson = async (subject, klass, title) => {
    const u = (await T("POST", "/api/teacher/units", { subject, klass, title, params: { start: d0, end: d0, weekdays: [{ day: wd, minutes: 45, time: "10:00" }] } })).data.unit;
    await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: title, lernaufgabe: "Lernaufgabe: " + title }, rows: [{ stundenfrage: title, ablauf: ["Einstieg"], date: d0, time: "10:00", minutes: 45 }] });
    const l = (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit.lessons[0].id;
    made.push({ u: u.id, l });
    return l;
  };
  const raw = (method, path, buf, type = "application/pdf") => fetch(BASE + path, { method, headers: { Authorization: "Bearer " + token, "Content-Type": type }, body: buf }).then((x) => x.json());
  const up = (lessonId, q, name, buf) => raw("POST", "/api/teacher/lessons/" + lessonId + q + (q.includes("?") ? "&" : "?") + "name=" + encodeURIComponent(name), buf);
  const stopBefore = (text) => { const l = String(text).split("\n"), i = l.indexOf(STOP_LINE); return i < 0 ? null : l.slice(i + 1).find((x) => x.trim()); };
  const portalOf = async (L) => (await T("GET", "/api/teacher/lessons/" + L)).data.lesson.portal;
  const savedStop = async (L, want) => { for (let i = 0; i < 40; i++) { if (stopBefore(await portalOf(L)) === want) return true; await sleep(250); } return false; };
  const noToasts = (p = tp) => p.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  const vis = (sel, p = tp) => p.locator(sel).isVisible();
  const hiddenFull = (p = tp) => p.evaluate(() => { const g = document.querySelector(".session-grid"); return !!g && getComputedStyle(g).display === "none"; });
  const dlOf = async (p, btn) => { const [d] = await Promise.all([p.waitForEvent("download", { timeout: 30000 }), btn.click()]); return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) }; };

  /* ======================= Gymnasium ======================= */
  const A = await oneLesson("powi", "9E", "Gewaltenteilung im Unterricht");
  await T("PUT", "/api/teacher/lessons/" + A + "/portal", { text: PORTAL, force: true });
  await T("PATCH", "/api/teacher/lessons/" + A, { homework: "Lies M2." });
  // Präsentation (Phasen unsichtbar auf den Folien) über die Sitzungsseite hochladen – die Folienbilder entstehen im Browser
  await tp.goto(BASE + "/#/lk/s/" + A);
  const presCardFull = tp.locator("section.card", { hasText: "Präsentation für den Unterricht" });
  await presCardFull.waitFor({ timeout: 15000 });
  const deck = await phaseDeck("invisible");
  await presCardFull.locator("input[type=file]").first().setInputFiles({ name: "Gewaltenteilung.pdf", mimeType: "application/pdf", buffer: deck });
  await tp.locator(".toast", { hasText: "Präsentation bereit (8 Folien)." }).waitFor({ timeout: 60000 });
  const pres = (await T("GET", "/api/teacher/lessons/" + A)).data.files.find((f) => f.area === "presentation");
  // Notizen und Anmerkungs-PDF (Nachtrag 20) – nur über die Schnittstelle
  const nr = (await T("PUT", "/api/teacher/files/" + pres.id + "/notes", { rev: 0, notes: [{ n: 1, items: ["Impuls: Wer hat die Macht?"] }] })).data;
  const ann = await raw("PUT", "/api/teacher/files/" + pres.id + "/annotated?rev=" + nr.rev, await a4("Anmerkungen", 2));
  // Material: beide Bereiche, Druckliste, Link, Text, zwei Feibeitsblätter mit Notfall-Feibeitsblatt (eines nur für Lehrkräfte)
  const fS = (await up(A, "/files?area=student", "Arbeitsblatt Gewaltenteilung.pdf", await a4("Arbeitsblatt"))).file;
  const fT = (await up(A, "/files?area=teacher", "Loesung Gewaltenteilung.pdf", await a4("Loesung"))).file;
  const fP = (await up(A, "/print?copies=28&duplex=0", "Tafelbild.pdf", await a4("Tafelbild"))).file;
  await T("POST", "/api/teacher/lessons/" + A + "/links", { area: "student", title: "Erklärvideo Gewaltenteilung", url: "https://example.org/gewaltenteilung" });
  await T("POST", "/api/teacher/lessons/" + A + "/texts", { area: "teacher", title: "Tafelanschrieb", text: "# Tafelanschrieb\n\n- Legislative\n- Exekutive", source: "chat" });
  for (const s of [SHEET1, SHEET2]) await T("POST", "/api/teacher/lessons/" + A + "/sheets", s);
  const nf1 = (await raw("POST", "/api/teacher/lessons/" + A + "/sheets/" + SHEET1.code + "/notfall?sig=e2e", await a4("Notfall 1"))).file;
  const nf2 = (await raw("POST", "/api/teacher/lessons/" + A + "/sheets/" + SHEET2.code + "/notfall?sig=e2e", await a4("Notfall 2"))).file;
  await T("PATCH", "/api/teacher/files/" + nf2.id, { area: "teacher" });
  ok(!!(pres && ann.ok && fS && fT && fP && nf1 && nf2), "Gymnasium (PoWi 9E): Präsentation mit Phasen und Anmerkungs-PDF, Material, Druckvorlage, Link, Text, zwei Feibeitsblätter samt Notfall-Feibeitsblättern");

  await tp.reload();   // derselbe Hash: neu laden, damit die Seite das Material über die Schnittstelle kennt
  const go = tp.getByRole("button", { name: INCLASS_LABEL, exact: true });
  await go.waitFor({ timeout: 15000 });
  ok(await tp.evaluate(() => { const h = document.querySelector("main > header.pagehead"), bar = document.querySelector("#inclass-bar"), t = document.querySelector("#tsum");
    return !!h && h.nextElementSibling === bar && !!t && !!(bar.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING) && bar.querySelector("#inclass-go").textContent === "Ich bin jetzt im Unterricht"; }),
    "Knopf „" + INCLASS_LABEL + "“ ganz oben – direkt unter dem Kopfband, vor der Zusammenfassung der Sitzung für die Lehrkraft");
  // Tastatur: Fokus auf den Knopf, Enter → kompakte Ansicht; der Fokus steht auf „Vollständige Ansicht“
  await go.focus(); await tp.keyboard.press("Enter");
  const view = tp.locator("#inclass .inclass-view");
  await view.waitFor({ timeout: 15000 });
  ok(await hiddenFull() && await tp.evaluate(() => document.activeElement && document.activeElement.id === "inclass-back") && (await tp.locator("#inclass-back").textContent()).trim() === FULL_LABEL,
    "per Tastatur geöffnet: vollständige Ansicht ausgeblendet, Fokus auf „" + FULL_LABEL + "“");
  ok(JSON.stringify(await view.evaluate((v) => [...v.querySelectorAll(":scope > section, :scope > .ic-hwslot > section")].map((s) => s.querySelector("h2").textContent))) ===
    JSON.stringify(["Präsentation", "Verlaufsplan · Schulportal-Eintrag", "Material", "Hausaufgabe bis zur nächsten Sitzung"]), "kompakt in dieser Reihenfolge: Präsentation, Verlaufsplan, Material, Hausaufgabe");
  const pc = tp.locator("#ic-pres");
  await tp.locator("#ic-live", { hasText: "Gerade nicht live." }).waitFor({ timeout: 10000 });
  ok(await pc.getByRole("button", { name: "Präsentation live starten" }).count() === 1 && (await tp.locator("#ic-live").textContent()) === "Gerade nicht live." &&
    (await tp.locator("#ic-arrow-hint").textContent()).startsWith("Kein Pfeil: Die Präsentation läuft gerade nicht live.") && await tp.locator(".phasearrow").count() === 0,
    "Präsentation: „Präsentation live starten“, „Gerade nicht live.“; Verlaufsplan ohne Pfeil mit ruhigem Hinweis");
  // Herunterladen: die PDF wie hochgeladen und die Anmerkungs-PDF (am Worker; auf Pages prüft der Schritt „GitHub Pages“)
  let d = await dlOf(tp, pc.getByRole("button", { name: /^Präsentation als PDF-Datei herunterladen/ }));
  ok(d.name === "Gewaltenteilung.pdf" && Buffer.compare(d.bytes, deck) === 0, "„Präsentation als PDF-Datei herunterladen“: „" + d.name + "“, genau die hochgeladene Datei");
  d = await dlOf(tp, pc.getByRole("button", { name: /^Präsentation mit Anmerkungen herunterladen/ }));
  // (Chromium dieser Umgebung speichert Downloads mit Zeichen außerhalb von ASCII im Namen als „download“ – den Namen sagt dann der Server)
  const cdAnn = decodeURIComponent((await fetch(BASE + (await T("POST", "/api/teacher/files/" + ann.file.id + "/link", {})).data.url)).headers.get("content-disposition") || "");
  ok((d.name === ann.file.name || (/[^\x20-\x7e]/.test(ann.file.name) && d.name === "download")) && cdAnn.includes(ann.file.name) && /^attachment/.test(cdAnn) && d.bytes.subarray(0, 5).toString() === "%PDF-",
    "zweiter Download: die Präsentation mit Anmerkungen („" + ann.file.name + "“, als Anhang)");

  /* ---- Material in zwei Spalten ---- */
  const colS = tp.locator("#ic-material .ic-col").nth(0), colT = tp.locator("#ic-material .ic-col").nth(1);
  const names = async (c) => c.locator(".ic-name").allTextContents();
  ok((await colS.locator("h3").textContent()) === "Für Schüler:innen sichtbar" && (await colT.locator("h3").textContent()) === "Nur für die Lehrkraft", "Material: Spalte 1 „Für Schüler:innen sichtbar“, Spalte 2 „Nur für die Lehrkraft“");
  const sN = await names(colS), tN = await names(colT);
  ok(JSON.stringify(sN) === JSON.stringify(["Gewaltenteilung", "Wehrhafte Demokratie", "Arbeitsblatt Gewaltenteilung.pdf", "Erklärvideo Gewaltenteilung", nf1.name]),
    "Spalte 1: Feibeitsblätter, Material für Schüler:innen, Link, zuletzt das Notfall-Feibeitsblatt (" + sN.join(" | ") + ")");
  ok(JSON.stringify(tN) === JSON.stringify(["Loesung Gewaltenteilung.pdf", "Tafelanschrieb", nf2.name, fP.printName]) && !tN.includes(ann.file.name) && !tN.includes("Gewaltenteilung.pdf"),
    "Spalte 2: Material nur für Lehrkräfte, Text, Notfall-Feibeitsblatt für Lehrkräfte, Druckvorlage mit Druck-Namen – ohne Präsentation und Anmerkungs-PDF (" + tN.join(" | ") + ")");
  const printRow = colT.locator(".ic-item", { hasText: fP.printName });
  ok((await printRow.locator(".badge").allTextContents()).includes("zum Ausdrucken") && (await colS.locator(".ic-item", { hasText: nf1.name }).locator(".badge").textContent()) === "Notfall-Feibeitsblatt" &&
    (await colT.locator(".ic-item", { hasText: nf2.name }).locator(".badge").textContent()) === "Notfall-Feibeitsblatt", "Markierungen: „zum Ausdrucken“ an der Druckvorlage, „Notfall-Feibeitsblatt“ in beiden Spalten");
  d = await dlOf(tp, printRow.getByRole("button", { name: "Herunterladen – " + fP.printName }));
  ok(d.name === fP.printName, "Druckvorlage herunterladen: unter dem Namen der Druckliste („" + d.name + "“)");
  d = await dlOf(tp, colS.getByRole("button", { name: "Herunterladen – Arbeitsblatt Gewaltenteilung.pdf" }));
  ok(d.name === "Arbeitsblatt Gewaltenteilung.pdf", "Material für Schüler:innen herunterladen (signierter Link wie in der vollständigen Ansicht)");
  const link = colS.getByRole("link", { name: /^Öffnen/ });
  ok(await link.getAttribute("href") === "https://example.org/gewaltenteilung" && await link.getAttribute("target") === "_blank", "Link öffnet die Internetseite in einem neuen Tab");
  await noToasts();
  const [fbPage] = await Promise.all([tp.context().waitForEvent("page", { timeout: 15000 }), colS.getByRole("button", { name: "Code kopieren und Feibeitsblatt öffnen – Gewaltenteilung" }).click()]);
  await tp.locator(".toast", { hasText: "KQ4-M7Z" }).waitFor({ timeout: 10000 });
  ok(!!fbPage, "Feibeitsblatt wie bei den Schüler:innen: Code kopiert (Meldung mit KQ4-M7Z) und das Feibeitsblatt in einem neuen Tab");
  await fbPage.close().catch(() => {});

  /* ---- Live: zweites Gerät steuert, der Pfeil folgt ohne Neuladen ---- */
  const tStore = await tp.evaluate(() => JSON.stringify(localStorage));
  const c2 = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await c2.addInitScript((s) => { try { if (!sessionStorage.getItem("x")) { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); sessionStorage.setItem("x", "1"); } } catch {} }, tStore);
  const p2 = await c2.newPage(); watch(p2, "Lehrkraft (zweites Gerät)");
  await p2.goto(BASE + "/#/lk/s/" + A);
  await p2.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
  await p2.locator(".presenter").waitFor({ timeout: 15000 });
  const arrowAt = async () => tp.locator("#ic-plan .ic-now").evaluate((x) => x.textContent.replace("jetzt", "").trim()).catch(() => null);
  const waitArrow = async (label) => { for (let i = 0; i < 60; i++) { if ((await arrowAt()) === label) return true; await sleep(200); } return false; };
  ok(await waitArrow("1) Einstieg") && (await tp.locator(".phasearrow").getAttribute("aria-label")) === ARROW_NAME && (await tp.locator("#ic-live").textContent()).startsWith("LIVE Sitzungscode"),
    "Live (zweites Gerät, Codefolie vor Folie 1): grüner Pfeil an „1) Einstieg“ mit Namen „" + ARROW_NAME + "“, LIVE · Sitzungscode");
  const next = async (n) => { await p2.keyboard.press("ArrowRight"); await p2.locator(".presenter .counter", { hasText: n + " / 8" }).waitFor({ timeout: 10000 }); };
  await tp.locator("#ic-stop").focus();
  for (const n of [1, 2, 3]) await next(n);
  ok(await waitArrow("2) Partnerarbeit") && await tp.evaluate(() => document.activeElement && document.activeElement.id === "ic-stop") && (await tp.locator("#ic-arrow-hint").textContent()).includes("„2) Partnerarbeit“ (Folie 3)") && (await tp.locator("#ic-live").textContent()).includes("Folie 3 / 8"),
    "Folie 3 (Codefolie, Phase 2): der Pfeil wandert ohne Neuladen zu „2) Partnerarbeit“ – der Fokus bleibt, wo er war");
  for (const n of [4, 5, 6]) await next(n);
  ok(await waitArrow("3) Sicherung"), "Folie 6 (ohne Phase): Pfeil bei der Phase der Folie davor – „3) Sicherung“");
  await next(7);
  ok(await waitArrow("4) Diskussion"), "Folie 7: „4) Diskussion“ (nach „--> Nächste Stunde“)");
  // Rückfall ohne WebSocket (dritter Tab): alle Verbindungen schlagen fehl – der Stand kommt über die Abfrage (höchstens alle 3 s)
  const c3 = await browser.newContext({ viewport: { width: 1180, height: 560 } });
  await c3.addInitScript((s) => { try { if (!sessionStorage.getItem("x")) { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); sessionStorage.setItem("x", "1"); } } catch {} }, tStore);
  const p3 = await c3.newPage(); watch(p3, "Lehrkraft (ohne WebSocket)");
  await p3.routeWebSocket(/\/api\/live\//, (ws) => ws.close({ code: 1011, reason: "Test: keine Verbindung" }));
  let polls = null; p3.on("request", (q) => { if (polls && /\/api\/teacher\/lessons\/[a-f0-9]+\/live$/.test(q.url())) polls.push(Date.now()); });
  await p3.goto(BASE + "/#/lk/s/" + A);
  await p3.getByRole("button", { name: INCLASS_LABEL, exact: true }).click();
  await p3.locator("#ic-plan .ic-now", { hasText: "4) Diskussion" }).waitFor({ timeout: 20000 });
  await sleep(1200);
  // Prüfbefund: das Öffnen zählt als Handlung – die Seite rollt nicht gleich danach von selbst zur Phase (der Knopf stünde sonst nicht mehr unter dem Finger)
  const scr = await p3.evaluate(() => ({ y: window.scrollY, below: document.querySelector("#ic-plan .ic-now").getBoundingClientRect().top > window.innerHeight }));
  ok(scr.y === 0 && scr.below, "nach dem Öffnen rollt die Seite nicht von selbst (die Phase liegt unterhalb, scrollY " + scr.y + ")");
  polls = [];   // ab jetzt fragt nur noch die Ansicht für den Unterricht (die vollständige Ansicht fragt nur beim Aufbau ihrer Karte)
  await p2.keyboard.press("ArrowLeft"); await p2.locator(".presenter .counter", { hasText: "6 / 8" }).waitFor({ timeout: 10000 });
  await p3.locator("#ic-plan .ic-now", { hasText: "3) Sicherung" }).waitFor({ timeout: 20000 });
  await sleep(6500);
  const gaps = polls.slice(1).map((t, i) => t - polls[i]);
  ok(gaps.length >= 2 && gaps.every((g) => g >= 2500), "ohne WebSocket: der Pfeil folgt über die Abfrage – nie schneller als alle 3 s (Abstände " + gaps.map((g) => Math.round(g / 100) / 10 + " s").join(", ") + ")");
  // Bildschirmfotos (Pfeil steht): Laptop, iPad quer und hochkant, Handy – hell und dunkel
  await p2.keyboard.press("ArrowLeft"); await p2.locator(".presenter .counter", { hasText: "5 / 8" }).waitFor({ timeout: 10000 });
  await waitArrow("3) Sicherung");
  const vp0 = tp.viewportSize();
  for (const [w, hh] of [[1366, 900], [1180, 820], [820, 1180], [390, 844]]) for (const dark of [false, true]) {
    await tp.setViewportSize({ width: w, height: hh }); await tp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await sleep(250);
    await tp.evaluate(() => window.scrollTo(0, 0));
    await tp.screenshot({ ...SHOT, path: join(OUT, "unterricht-kompakt-" + w + (dark ? "-dunkel" : "") + ".png"), fullPage: true });
    if (!dark && w <= 820) { const hi = (await horizontalIssues(tp)).issues; ok(!hi.length, "Ansicht für den Unterricht bei " + w + " px: ohne seitliches Schieben" + (hi.length ? " – " + JSON.stringify(hi).slice(0, 200) : "")); }
  }
  await tp.emulateMedia({ colorScheme: "light" }); await tp.setViewportSize(vp0);
  // der Pfeil ist auch ohne Farbe zu erkennen (Form + Text) und liegt rechts in der Vorschau
  const geo = await tp.evaluate(() => { const a = document.querySelector(".phasearrow").getBoundingClientRect(), b = document.querySelector("#ic-plan").getBoundingClientRect(); return { right: b.right - a.right, text: document.querySelector(".phasearrow .pa-t").textContent }; });
  ok(geo.right >= 0 && geo.right < 20 && geo.text === "jetzt", "Pfeil am rechten Rand des Verlaufsplans, Pfeilform mit „jetzt“ (nicht nur Farbe)");

  /* ---- Prüfbefunde: ein anderes Gerät markiert („Bis hier gezeigt“) – die kompakte Ansicht folgt ohne Neuladen; ein veralteter Tab hebt die Markierung auf ---- */
  await p3.getByRole("button", { name: FULL_LABEL }).click();   // dritter Tab: vollständige Ansicht (fragt nicht nach), ab jetzt veraltet
  const stamps = []; tp.on("request", (q) => { if (/\/api\/teacher\/lessons\/[a-f0-9]+\/stamp$/.test(q.url())) stamps.push(Date.now()); });
  await p3.locator("#shown-sel").waitFor({ timeout: 15000 });
  await p2.locator(".presenter").getByRole("button", { name: /als letzte im Unterricht gezeigte Folie markieren/ }).click();
  await p2.locator(".presenter .markstate", { hasText: "Bis Folie 5 markiert · Zwischenstopp vor „4) Diskussion“" }).waitFor({ timeout: 30000 });
  ok(await savedStop(A, "**4) Diskussion**"), "zweites Gerät: „Bis hier gezeigt“ (Folie 5) trägt den Zwischenstopp vor „4) Diskussion“ ein");
  const t0 = Date.now();
  await tp.locator("#ic-plan .stopfield").waitFor({ timeout: 30000 });
  ok(await tp.evaluate(() => { const t = document.querySelector("#ic-plan").innerText, s = t.indexOf("Zwischenstopp"); return s > t.indexOf("3) Sicherung") && s < t.indexOf("4) Diskussion"); }) && stamps.length >= 1,
    "die kompakte Ansicht auf diesem Gerät zeigt ihn ohne Neuladen (Stand der Sitzung, nach " + Math.round((Date.now() - t0) / 1000) + " s)");
  // der dritte Tab kennt weder Markierung noch Zwischenstopp – „Letzte Folie: alle Folien freigeben“ entfernt trotzdem genau den, den Unterricks eingetragen hat
  await p3.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await p3.locator(".thumbs .thumb").last().click({ button: "right" });
  await p3.locator(".ctxmenu").getByRole("menuitem", { name: "Letzte Folie: alle Folien freigeben" }).click();
  await p3.locator(".toast", { hasText: "Den Zwischenstopp vor „4) Diskussion“, den Unterricks eingetragen hatte, hat es wieder entfernt." }).waitFor({ timeout: 30000 });
  const pA = (await T("GET", "/api/teacher/lessons/" + A)).data.files.find((f) => f.area === "presentation");
  ok(await savedStop(A, null) && pA.shownUntil === null && pA.phases.auto === null, "veralteter Tab hebt die Markierung auf: der automatische Zwischenstopp ist weg, kein Vermerk mehr (Stand des Servers statt des Tabs)");
  // die kompakte Ansicht holt den neuen Stand beim Zurückkehren ins Fenster sofort (sonst spätestens nach 20 s)
  const nStamps = stamps.length, tf = Date.now();
  await tp.evaluate(() => window.dispatchEvent(new Event("focus")));
  await tp.locator("#ic-plan .stopfield").waitFor({ state: "detached", timeout: 15000 });
  ok(stamps.length > nStamps && stamps[nStamps] - tf < 3500, "… und die kompakte Ansicht hier zeigt ihn nicht mehr (Rückkehr ins Fenster: Stand nach " + Math.round((stamps[nStamps] - tf) / 100) / 10 + " s abgefragt)");

  /* ---- Zwischenstopp von Hand in der kompakten Ansicht: Kontextmenü und per Tastatur ---- */
  await noToasts();
  await tp.locator("#ic-plan p", { hasText: "2) Partnerarbeit" }).click({ button: "right" });
  await tp.locator(".ctxmenu").getByRole("menuitem", { name: "Zwischenstopp einfügen" }).click();
  ok(await savedStop(A, "**2) Partnerarbeit**") && await tp.locator("#ic-plan .stopfield").count() === 1 && await vis("#ic-stop-next") && (await tp.locator("#ic-stop-next").textContent()).startsWith("Zwischenstopp gesetzt.") &&
    await tp.locator(".modal", { hasText: "Der Eintrag wurde inzwischen geändert" }).count() === 0,
    "Rechtsklick auf eine Zeile → „Zwischenstopp einfügen“: gespeichert (ohne Rückfrage zur Version – der Stand des anderen Geräts war schon da), das Feld steht in der Vorschau, dazu der Hinweis wie in der vollständigen Ansicht");
  await tp.locator("#ic-stop").focus(); await tp.keyboard.press("Enter");
  const dlg = tp.locator(".modal", { hasText: "Wo haben Sie aufgehört?" });
  await dlg.waitFor();
  await dlg.getByRole("radio", { name: "**3) Sicherung**".replace(/\*/g, "") }).check();
  await tp.keyboard.press("Enter");
  ok(await savedStop(A, "**3) Sicherung**") && (await portalOf(A)).split(STOP_LINE).length === 2, "per Tastatur „Zwischenstopp eintragen …“ → vor „3) Sicherung“ verschoben (nur einer)");
  // neu laden: der Hinweis „Zwischenstopp gesetzt“ ist weg; gleich setzt „Bis hier gezeigt“ den Zwischenstopp genau dorthin, wo er schon steht
  await tp.reload();
  await tp.locator("#inclass .inclass-view #ic-plan .stopfield").waitFor({ timeout: 15000 });
  ok(!(await vis("#ic-stop-next")), "nach dem Neuladen (kompakt): Zwischenstopp vor „3) Sicherung“, ohne den Hinweis");

  /* ---- in diesem Tab live starten: derselbe Präsentationsmodus, an der laufenden Stelle; „Bis hier gezeigt“ → Zwischenstopp ---- */
  await pc.getByRole("button", { name: "Präsentation live starten" }).click();
  await tp.locator(".presenter").waitFor({ timeout: 15000 });
  await tp.locator(".presenter .counter", { hasText: "5 / 8" }).waitFor({ timeout: 10000 });
  ok(true, "„Präsentation live starten“: derselbe Präsentationsmodus, er setzt an der laufenden Stelle fort (Folie 5 vom zweiten Gerät)");
  await tp.keyboard.press("ArrowLeft"); await tp.locator(".presenter .counter", { hasText: "4 / 8" }).waitFor({ timeout: 10000 });
  await tp.locator(".presenter").getByRole("button", { name: /als letzte im Unterricht gezeigte Folie markieren/ }).click();
  await tp.locator(".presenter .markstate", { hasText: "Bis Folie 4 markiert · Zwischenstopp vor „3) Sicherung“" }).waitFor({ timeout: 30000 });
  ok(await savedStop(A, "**3) Sicherung**") && await tp.locator("#ic-plan .stopfield").count() === 1 && await vis("#ic-stop-next") && (await tp.locator("#ic-stop-next").textContent()).startsWith("Zwischenstopp gesetzt."),
    "„Bis hier gezeigt“ (Folie 4): Zwischenstopp vor „3) Sicherung“ – stand schon dort; auch in der kompakten Ansicht darunter mit dem Hinweis wie von Hand (Prüfbefund), gespeichert (Nachtrag 34)");
  await tp.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : null)).catch(() => {});
  await tp.locator(".presenter").getByRole("button", { name: "Schließen", exact: true }).click();
  await tp.locator(".presenter").waitFor({ state: "detached", timeout: 10000 });
  ok(await tp.evaluate(() => document.activeElement && document.activeElement.id === "ic-start") && await waitArrow("2) Partnerarbeit") && await vis("#ic-plan") && await hiddenFull(),
    "Präsentationsmodus geschlossen (Live läuft weiter): Fokus zurück auf „Präsentation live starten“, Pfeil bei Folie 4 → „2) Partnerarbeit“, weiter kompakt");
  for (const [w, hh] of [[1366, 900], [390, 844]]) for (const dark of [false, true]) {
    await tp.setViewportSize({ width: w, height: hh }); await tp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await sleep(150);
    await tp.locator("#ic-plancard").screenshot({ ...SHOT, path: join(OUT, "unterricht-kompakt-hinweis-zwischenstopp-" + w + (dark ? "-dunkel" : "") + ".png") });
  }
  await tp.emulateMedia({ colorScheme: "light" }); await tp.setViewportSize(vp0);
  await tp.getByRole("button", { name: "Zwischenstopp entfernen" }).click();
  ok(await savedStop(A, null), "„Zwischenstopp entfernen“ in der kompakten Ansicht");

  /* ---- Hausaufgabe: dasselbe Feld, gleiches Speichern; Umschalten verliert nichts ---- */
  const hw = tp.locator("#inclass #hw");
  ok(await hw.count() === 1 && await tp.locator("#inclass").getByRole("button", { name: "Für das Schulportal kopieren" }).count() === 1 && (await tp.locator("#inclass .homework .hwwhen").textContent()).includes("Schüler:innen sehen die Hausaufgabe ab"),
    "Hausaufgabe in der kompakten Ansicht: dasselbe Feld mit den Hinweisen und „Für das Schulportal kopieren“");
  await hw.fill("Lies M2 und beantworte Aufgabe 3.");
  await tp.locator("#inclass .homework .save-state", { hasText: "Gespeichert" }).waitFor({ timeout: 10000 });
  ok((await T("GET", "/api/teacher/lessons/" + A)).data.lesson.homework === "Lies M2 und beantworte Aufgabe 3.", "Hausaufgabe gespeichert (Server)");
  await hw.fill("Lies M2 und beantworte Aufgabe 3 und 4.");   // noch nicht gespeichert – dann umschalten
  await tp.getByRole("button", { name: FULL_LABEL }).click();
  ok(!(await hiddenFull()) && await tp.evaluate(() => document.activeElement && document.activeElement.id === "inclass-go") && await tp.locator(".session-grid #hw").inputValue() === "Lies M2 und beantworte Aufgabe 3 und 4.",
    "„" + FULL_LABEL + "“: vollständige Ansicht, Fokus auf „" + INCLASS_LABEL + "“, die eben getippte Hausaufgabe steht im Feld");
  for (let i = 0; i < 30 && (await T("GET", "/api/teacher/lessons/" + A)).data.lesson.homework !== "Lies M2 und beantworte Aufgabe 3 und 4."; i++) await sleep(250);
  ok((await T("GET", "/api/teacher/lessons/" + A)).data.lesson.homework === "Lies M2 und beantworte Aufgabe 3 und 4." && !(await tp.evaluate((k) => sessionStorage.getItem(k), INCLASS_KEY)),
    "… und ist gespeichert; der Zustand für diesen Tab ist beendet");
  ok(await p2.locator(".presenter").isVisible(), "das Umschalten beendet die laufende Präsentation nicht (zweites Gerät zeigt weiter)");
  // Schulportal-Eintrag in der vollständigen Ansicht geändert und sofort umgeschaltet: die kompakte Ansicht zeigt den neuen Stand, gespeichert wird wie sonst
  const before = await tp.inputValue("#portal");
  await tp.fill("#portal", before + "\n- Zusatz: Argumentationswippe");
  await go.click();
  await view.waitFor();
  ok((await tp.locator("#ic-plan").textContent()).includes("Zusatz: Argumentationswippe") && await waitArrow("2) Partnerarbeit"), "Schulportal-Eintrag eben geändert, dann „" + INCLASS_LABEL + "“: der Verlaufsplan zeigt den neuen Stand (der Pfeil bleibt)");
  for (let i = 0; i < 30 && !(await portalOf(A)).includes("Zusatz: Argumentationswippe"); i++) await sleep(250);
  ok((await portalOf(A)).includes("Zusatz: Argumentationswippe"), "… und die Änderung ist gespeichert (nichts geht beim Umschalten verloren)");
  await tp.locator("#inclass-back").click();

  /* ---- Neuladen behält die kompakte Ansicht; Verlassen der Sitzung beendet sie ---- */
  await go.click(); await view.waitFor();
  await tp.reload();
  await tp.locator("#inclass .inclass-view").waitFor({ timeout: 15000 });
  ok(await hiddenFull() && await vis("#inclass-back") && !(await vis("#inclass-go")), "Neuladen dieses Tabs: die kompakte Ansicht bleibt");
  await tp.goto(BASE + "/#/lk"); await tp.locator(".tiles .tile").first().waitFor();
  await tp.goto(BASE + "/#/lk/s/" + A); await go.waitFor({ timeout: 15000 });
  ok(!(await hiddenFull()) && await tp.locator("#inclass .inclass-view").count() === 0, "Sitzung verlassen und wieder geöffnet: vollständige Ansicht (der Zustand endet beim Verlassen)");
  // iPad hochkant: Bildschirmfoto der kompakten Ansicht samt Material (eigener Kontext mit Touch)
  const ic = await browser.newContext({ ...devices["iPad (gen 7)"] });
  await ic.addInitScript((s) => { try { if (!sessionStorage.getItem("x")) { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); sessionStorage.setItem("x", "1"); } } catch {} }, tStore);
  const ip = await ic.newPage(); watch(ip, "Lehrkraft (iPad)");
  await ip.goto(BASE + "/#/lk/s/" + A);
  await ip.getByRole("button", { name: INCLASS_LABEL, exact: true }).tap();
  await ip.locator("#ic-plan .ic-now").waitFor({ timeout: 20000 });
  // am iPad (Touch): Antippen einer Zeile öffnet das Menü für den Zwischenstopp
  await ip.locator("#ic-plan p", { hasText: "4) Diskussion" }).tap();
  ok(await ip.locator(".ctxmenu").getByRole("menuitem", { name: "Zwischenstopp einfügen" }).count() === 1, "iPad: Antippen einer Zeile im Verlaufsplan öffnet das Menü „Zwischenstopp einfügen“");
  await ip.keyboard.press("Escape");
  await ip.evaluate(() => window.scrollTo(0, 0)); await sleep(300);
  await ip.screenshot({ ...SHOT, path: join(OUT, "unterricht-kompakt-ipad-hochkant.png"), fullPage: true });
  await ic.close();
  await p2.locator(".presenter").getByRole("button", { name: "Präsentation für alle beenden" }).click().catch(() => {});
  await c2.close(); await c3.close();

  /* ---- Prüfbefund: Präsentation, deren Folienbilder nicht fertig wurden – die kompakte Ansicht sagt es wie die vollständige ---- */
  const N = await oneLesson("powi", "9E", "Folienbilder fehlen");
  const np = await raw("POST", "/api/teacher/lessons/" + N + "/presentation?name=" + encodeURIComponent("Unfertig.pdf"), deck);
  await tp.goto(BASE + "/#/lk/s/" + N);
  await tp.getByRole("button", { name: INCLASS_LABEL, exact: true }).click();
  await tp.locator("#ic-pres .notice", { hasText: "wurden noch nicht vollständig erzeugt" }).waitFor({ timeout: 15000 });
  ok(np.file && np.file.status !== "ready" && await tp.locator("#ic-start").count() === 0 && (await tp.locator("#ic-arrow-hint").textContent()) === "Kein Pfeil: Die Folienbilder der Präsentation sind noch nicht fertig – laden Sie die PDF in der vollständigen Ansicht erneut hoch." &&
    !/noch keine Präsentation hochgeladen|Präsentation live starten|null/.test(await tp.locator("#ic-pres").textContent()),
    "Präsentation ohne fertige Folienbilder: kompakt der Hinweis zum erneuten Hochladen (nicht „keine Präsentation“), kein Start, ruhiger Grund statt Pfeil");
  for (const [w, hh] of [[1366, 900], [1180, 820], [820, 1180], [390, 844]]) for (const dark of [false, true]) {
    await tp.setViewportSize({ width: w, height: hh }); await tp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await sleep(150);
    await tp.evaluate(() => window.scrollTo(0, 0));
    await tp.screenshot({ ...SHOT, path: join(OUT, "unterricht-kompakt-unfertig-" + w + (dark ? "-dunkel" : "") + ".png") });
  }
  await tp.emulateMedia({ colorScheme: "light" }); await tp.setViewportSize(vp0);
  await tp.locator("#inclass-back").click();

  /* ======================= Grundschule ======================= */
  const G = await oneLesson("gs", gsCourse, "Wasser im Alltag (kompakt)");
  const gAb = (await up(G, "/files?area=student", "Arbeitsblatt Wasser.pdf", await a4("Arbeitsblatt Wasser"))).file;
  await T("PATCH", "/api/teacher/files/" + gAb.id, { copies: 22 });
  const gVor = (await up(G, "/files?area=teacher", "Vorlesetext Regentropfen.pdf", await a4("Vorlesetext"))).file;
  const gPr = (await up(G, "/print?copies=5&duplex=1", "Konzentrationsaufgabe - Wasser.pdf", await a4("Konzentration"))).file;
  const gCards = (await raw("POST", "/api/teacher/lessons/" + G + "/cards?name=" + encodeURIComponent("Bildkarten Regentropfen.pdf") + "&share=1", await a4("Karte", 3))).file;
  await T("PUT", "/api/teacher/lessons/" + G + "/portal", { text: GSPLAN(gAb.id, gVor.id, gCards.id), force: true });
  await T("PATCH", "/api/teacher/lessons/" + G, { homework: "Male einen Regentropfen." });
  await tp.goto(BASE + "/#/lk/s/" + G);
  await tp.locator("#gsplan a.pdfref").first().waitFor({ timeout: 15000 });
  ok(await tp.evaluate(() => document.querySelector("main > header.pagehead").nextElementSibling === document.querySelector("#inclass-bar")), "Grundschule: Knopf „" + INCLASS_LABEL + "“ ganz oben");
  await tp.getByRole("button", { name: INCLASS_LABEL, exact: true }).click();
  const gv = tp.locator("#inclass .inclass-view");
  await gv.locator("#ic-plan a.pdfref").first().waitFor({ timeout: 15000 });
  ok(JSON.stringify(await gv.evaluate((v) => [...v.querySelectorAll(":scope > section, :scope > .ic-hwslot > section")].map((s) => s.querySelector("h2").textContent))) === JSON.stringify(["Verlaufsplan", "Material", "Hausaufgabe"]) &&
    await tp.locator("#ic-pres, .phasearrow, #ic-arrow-hint").count() === 0, "Grundschule kompakt: Verlaufsplan, Material, Hausaufgabe – ohne Präsentation und Pfeil");
  ok(JSON.stringify(await gv.locator("#ic-plan a.pdfref").evaluateAll((xs) => xs.map((x) => x.firstChild.textContent))) === JSON.stringify(["Vorlesetext Regentropfen.pdf", "Bildkarten Regentropfen.pdf", "Arbeitsblatt Wasser.pdf"]),
    "Verlaufsplan mit anklickbaren PDF-Verweisen (gelb markiert)");
  const gS = tp.locator("#ic-material .ic-col").nth(0), gT = tp.locator("#ic-material .ic-col").nth(1);
  const gsN = await names(gS), gtN = await names(gT);
  const cardsRow = gT.locator(".ic-item", { hasText: "Bildkarten Regentropfen" });
  ok((await gS.locator("h3").textContent()) === "Für die Kinder sichtbar" && JSON.stringify(gsN) === JSON.stringify(["Arbeitsblatt Wasser.pdf"]) && (await gS.locator(".gs-parents-badge").textContent()).startsWith("Eltern sehen sie"),
    "Grundschule Spalte 1: Material für die Kinder mit dem Hinweis, ob Eltern es sehen");
  ok(gtN.length === 4 && gtN[0] === "Vorlesetext Regentropfen.pdf" && gtN.includes("22x - sw - beidseitig - Sach3 - Arbeitsblatt Wasser.pdf") && gtN.some((n) => /^5x - sw - beidseitig - Sach3 - Konzentrationsaufgabe/.test(n)) &&
    gtN.some((n) => /^1x - farbig - einseitig - Sach3 - Bildkarten Regentropfen\.pdf$/.test(n)) && JSON.stringify(await cardsRow.locator(".badge").allTextContents()) === JSON.stringify(["Bildkarten", "zum Ausdrucken"]),
    "Grundschule Spalte 2: Vorlesetext, Druckdateien „zum Ausdrucken“ samt Arbeitsblatt (22×), Konzentrationsaufgabe und Bildkarten (" + gtN.join(" | ") + ")");
  d = await dlOf(tp, gT.locator(".ic-item", { hasText: "22x - sw" }).getByRole("button", { name: /^Herunterladen – 22x/ }));
  ok(d.name === "22x - sw - beidseitig - Sach3 - Arbeitsblatt Wasser.pdf", "Druckdatei der Grundschule herunterladen: „" + d.name + "“");
  // Nachtrag 42: eine zweite Druckvorlage mit denselben Druckangaben wie die Konzentrationsaufgabe (5x, sw, beidseitig) → in der Spalte ein Sitzungspaket mit
  // „Herunterladen“ (eine PDF: beide Vorlagen, beidseitig je eine Leerseite), seine Dateien klein darunter; nach dem Neuladen bleibt die kompakte Ansicht offen
  await up(G, "/print?copies=5&duplex=1", "Ausmalbild Regentropfen.pdf", await a4("Ausmalbild"));
  await tp.reload();
  const gPack = tp.locator("#ic-material .ic-pack"), PACK_G = "5x - sw - beidseitig - Sach3 - Sitzungspaket.pdf";
  await gPack.waitFor({ timeout: 20000 });
  const gMembers = await gPack.locator(".ic-member .ic-name").allTextContents();
  ok((await gPack.locator(".ic-name").first().textContent()) === PACK_G && gMembers.length === 2 && gMembers.every((n) => n.startsWith("5x - sw - beidseitig - Sach3 - "))
    && (await gPack.locator(":scope > .ic-main > .ic-meta").textContent()).startsWith("Sitzungspaket · 2 Materialien") && await gPack.locator(".ic-member").getByRole("button", { name: /^Herunterladen – 5x/ }).count() === 2,
    "„Ich bin jetzt im Unterricht“: Sitzungspaket „" + PACK_G + "“ in der Spalte der Lehrkraft, darunter klein seine Dateien mit eigenem Download (" + gMembers.join(" | ") + ")");
  d = await dlOf(tp, gPack.getByRole("button", { name: "Herunterladen – " + PACK_G }));
  ok(d.name === PACK_G && (await PDFDocument.load(d.bytes)).getPageCount() === 4, "… „Herunterladen“ des Pakets: eine PDF „" + d.name + "“ mit beiden Vorlagen (4 Seiten mit Leerseiten für den beidseitigen Druck)");
  // Zwischenstopp per Dialog der Grundschule, gespeichert; Hausaufgabe dasselbe Feld
  await tp.locator("#ic-stop").click();
  const gd = tp.locator(".modal", { hasText: "Wo haben Sie aufgehört?" });
  await gd.getByRole("radio", { name: "3) Arbeitsblatt (15 Min., Einzelarbeit)" }).check();
  await gd.getByRole("button", { name: "Zwischenstopp eintragen" }).click();
  ok(await savedStop(G, "**3) Arbeitsblatt (15 Min., Einzelarbeit)**") && await tp.locator("#ic-plan .stopfield").count() === 1, "Grundschule: „Zwischenstopp eintragen …“ (Dialog der Grundschule) – gespeichert, in der kompakten Ansicht sichtbar");
  const ghw = tp.locator("#inclass #gs-homework");
  await ghw.fill("Male zwei Regentropfen.");
  await tp.locator("#inclass #gs-homework-field .save-state", { hasText: "Gespeichert" }).waitFor({ timeout: 10000 });
  ok((await T("GET", "/api/teacher/lessons/" + G)).data.lesson.homework === "Male zwei Regentropfen.", "Grundschule: Hausaufgabe im selben Feld gespeichert");
  for (const [w, hh] of [[1366, 900], [820, 1180], [390, 844]]) for (const dark of [false, true]) {
    await tp.setViewportSize({ width: w, height: hh }); await tp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await sleep(250);
    await tp.evaluate(() => window.scrollTo(0, 0));
    await tp.screenshot({ ...SHOT, path: join(OUT, "unterricht-kompakt-gs-" + w + (dark ? "-dunkel" : "") + ".png"), fullPage: true });
    if (!dark && w === 390) { const hi = (await horizontalIssues(tp)).issues; ok(!hi.length, "Grundschule kompakt am Handy: ohne seitliches Schieben" + (hi.length ? " – " + JSON.stringify(hi).slice(0, 200) : "")); }
  }
  await tp.emulateMedia({ colorScheme: "light" }); await tp.setViewportSize(vp0);
  await tp.getByRole("button", { name: FULL_LABEL }).click();
  ok(await tp.locator(".session-grid #gs-homework").inputValue() === "Male zwei Regentropfen." && await tp.locator("#gs-content #gs-homework").count() === 1, "zurück: das Feld steht wieder an seinem Platz in „Inhalt und Hausaufgabe“");

  // aufräumen
  for (const x of made) { await T("DELETE", "/api/teacher/lessons/" + x.l); await T("DELETE", "/api/teacher/units/" + x.u); }
  ok((await T("GET", "/api/teacher/lessons/" + A)).status === 404 && (await T("GET", "/api/teacher/lessons/" + G)).status === 404, "Test-Sitzungen und -Einheiten wieder gelöscht");
}
