// phasestop.mjs – End-to-End-Prüfung von Nachtrag 34: den Zwischenstopp nur in der Präsentation setzen („letzte gezeigte Folie“), der Schulportal-Eintrag
// folgt von selbst. Eigener Test-Kurs PoWi 9F mit Sitzungen weit in der Vergangenheit (danach gelöscht – berührt weder Druckaufträge noch Kalender oder
// Podcast der übrigen Prüfungen). Präsentationen mit der unsichtbaren Zeile „Unterricks-Phase: n“ in beiden Varianten (Textdarstellungsmodus 3 bzw. winzig in
// der Farbe des Hintergrunds) und eine ohne; alle drei zeigen dasselbe Bild.
// ctx = {tp (Seite der Lehrkraft, angemeldet), BASE, T (Fetch mit Anmeldung), ok, OUT, SHOT}
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, setTextRenderingMode } from "pdf-lib";

const PORTAL = "**1) Einstieg**\n- Karikatur ~~Wer hat die Macht?~~\n\n**2) Partnerarbeit**\n- Feibeitsblatt ~~Gewaltenteilung~~\n\n**3) Sicherung**\n- Tafelbild\n\n" +
  "--> Nächste Stunde\n\n**4) Diskussion**\n- Ist das BVerfG zu mächtig?";
// Folie → Phase: Titel und Agenda (1), Codefolie und Besprechung (2), Sicherung (3), Quellen (keine), Diskussion (4), Hausaufgabe (keine)
const MARKS = [1, 1, 2, 2, 3, null, 4, null];
export async function phaseDeck(mode) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.HelveticaBold), reg = await d.embedFont(StandardFonts.Helvetica), bg = rgb(0.12, 0.23, 0.37), white = rgb(1, 1, 1);
  const texts = [[["Gewaltenteilung", 48]], [["Ablauf der Stunde", 40]], null, [["Partnerarbeit – Besprechung", 40]], [["Sicherung: Tafelbild", 40]], [["Quellen", 40]],
    [["Diskussion: Ist das BVerfG zu mächtig?", 34]], [["Hausaufgabe", 40]]];
  texts.forEach((lines, i) => {
    const p = d.addPage([960, 540]);
    p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: bg });
    if (!lines) {   // Unterricks-Codefolie (Materialfolie)
      p.drawText("Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", { x: 60, y: 380, size: 30, font: reg, color: white });
      p.drawText("Feibeitsblatt: Gewaltenteilung", { x: 60, y: 320, size: 36, font: f, color: white });
      p.drawText("Unterricks-Codefolie: Hier zeigt Unterricks den QR-Code und den Sitzungscode.", { x: 60, y: 60, size: 12, font: reg, color: white });
    } else lines.forEach(([t, s], k) => p.drawText(t, { x: 60, y: 300 - k * 60, size: s, font: f, color: white }));
    const n = MARKS[i];
    if (!n || mode === "none") return;
    const line = "Unterricks-Phase: " + n;
    if (mode === "invisible") { p.pushOperators(setTextRenderingMode(3)); p.drawText(line, { x: 60, y: 120, size: 20, font: reg }); p.pushOperators(setTextRenderingMode(0)); }
    else p.drawText(line, { x: 3, y: 2, size: 1.5, font: reg, color: bg });   // winzig am unteren Rand in der Farbe des Hintergrunds
  });
  return Buffer.from(await d.save());
}

export async function phaseStopE2E({ tp, BASE, T, ok, OUT, SHOT }) {
  const { berlinToday, addDays, STOP_LINE, PHASE_MARK } = await import("../../public/shared.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const d0 = addDays(berlinToday(), -40), d1 = addDays(d0, 1), d2 = addDays(d0, 2);
  const wd = (d) => new Date(d + "T12:00:00Z").getUTCDay();
  const u = (await T("POST", "/api/teacher/units", { subject: "powi", klass: "9F", title: "Gewaltenteilung (Phasen)", params: { start: d0, end: d2,
    weekdays: [...new Set([d0, d1, d2].map(wd))].map((day) => ({ day, minutes: 45, time: "10:00" })) } })).data.unit;
  await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: "Gewaltenteilung (Phasen)", lernaufgabe: "Positionspapier" }, rows: [
    { stundenfrage: "Wer hat die Macht?", ablauf: ["Karikatur"], date: d0, time: "10:00", minutes: 45 },
    { stundenfrage: "Wer kontrolliert die Macht?", ablauf: ["Partnerarbeit"], date: d1, time: "10:00", minutes: 45 },
    { stundenfrage: "Ist das Gericht zu mächtig?", ablauf: ["Diskussion"], date: d2, time: "10:00", minutes: 45 }] });
  const ls = (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit.lessons;
  const [A, B, C] = [d0, d1, d2].map((d) => ls.find((l) => l.date === d));
  ok(A && B && C, "Test-Kurs PoWi 9F: drei Sitzungen (A mit Phasen in der PDF, B ohne, C für die Sitzungsdatei)");
  for (const L of [A, B]) await T("PUT", "/api/teacher/lessons/" + L.id + "/portal", { text: PORTAL, force: true });
  const pres = async (L) => (await T("GET", "/api/teacher/lessons/" + L.id)).data.files.find((f) => f.area === "presentation");
  const portalOf = async (L) => (await T("GET", "/api/teacher/lessons/" + L.id)).data.lesson.portal;
  const stopBefore = (text) => { const l = String(text).split("\n"), i = l.indexOf(STOP_LINE); return i < 0 ? null : l.slice(i + 1).find((x) => x.trim()); };
  // gespeichert? (Zwischenstopp vor der Zeile want, null = keiner)
  const savedStop = async (L, want) => { for (let i = 0; i < 40; i++) { const p = await portalOf(L); if (stopBefore(p) === want) return true; await sleep(250); } return false; };
  const card = () => tp.locator("section.card", { hasText: "Präsentation für den Unterricht" });
  const upload = async (L, buf, name, replace = false) => {
    await tp.goto(BASE + "/#/lk/s/" + L.id);
    await card().waitFor({ timeout: 15000 });
    await tp.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));   // Meldungen eines früheren Hochladens
    if (replace) await card().locator("details", { hasText: "Andere Präsentation hochladen" }).locator("summary").click();
    await card().locator("input[type=file]").first().setInputFiles({ name, mimeType: "application/pdf", buffer: buf });
    await tp.locator(".toast", { hasText: "Präsentation bereit (8 Folien)." }).waitFor({ timeout: 60000 });
    await card().locator("#shown-sel").waitFor({ timeout: 15000 });
  };
  const noToasts = () => tp.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  // letzte gezeigte Folie über die Auswahl setzen und auf die Meldung warten (ältere Meldungen vorher weg)
  const mark = async (value, text) => { await noToasts(); await tp.locator("#shown-sel").selectOption(value); await tp.locator(".toast", { hasText: text }).waitFor({ timeout: 30000 }); };
  const urlsOf = async (f) => (await T("GET", "/api/teacher/files/" + f.id + "/slides")).data.urls;
  // Folienbilder Punkt für Punkt vergleichen (größte Abweichung eines Farbkanals; -1 = andere Größe)
  const maxDiff = (a, b) => tp.evaluate(async ([ua, ub]) => {
    const load = async (u) => createImageBitmap(await (await fetch(u)).blob());
    let max = 0;
    for (let i = 0; i < ua.length; i++) {
      const [ia, ib] = await Promise.all([load(ua[i]), load(ub[i])]);
      if (ia.width !== ib.width || ia.height !== ib.height) return -1;
      const c = new OffscreenCanvas(ia.width, ia.height), x = c.getContext("2d", { willReadFrequently: true });
      x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, ia.width, ia.height).data;
      x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, ib.width, ib.height).data;
      for (let k = 0; k < da.length; k++) { const dd = Math.abs(da[k] - db[k]); if (dd > max) max = dd; }
    }
    return max;
  }, [a, b]);

  /* ---------- Hochladen: B ohne Phasen, A mit Phasen (erst winzig in Hintergrundfarbe, dann unsichtbar) – gleiche Folienbilder ---------- */
  await upload(B, await phaseDeck("none"), "Gewaltenteilung ohne Phasen.pdf");
  const pB = await pres(B), urlsB = await urlsOf(pB);
  ok(pB.phases && pB.phases.pdf === null && pB.phases.hand === null, "Präsentation ohne die Zeile „" + PHASE_MARK + ": n“: keine Phasen");
  ok((await tp.locator("#shown-hint").textContent()).includes("Diese Präsentation trägt keine Phasen – den Zwischenstopp im Schulportal-Eintrag setzen Sie deshalb selbst, oder Sie ordnen die Folien unter „Phasen der Folien“ zu."),
    "B: ruhiger Hinweis an der Auswahl der letzten gezeigten Folie (keine Phasen)");
  for (const [mode, replace] of [["bg", false], ["invisible", true]]) {
    await upload(A, await phaseDeck(mode), "Gewaltenteilung.pdf", replace);
    const pA = await pres(A);
    ok(JSON.stringify(pA.phases.pdf) === JSON.stringify(MARKS) && pA.phases.hand === null,
      (mode === "bg" ? "winzig in Hintergrundfarbe" : "unsichtbar (Textdarstellungsmodus 3)") + ": Phasen je Folie aus der PDF gelesen (" + JSON.stringify(pA.phases.pdf) + ")");
    ok(await tp.locator(".toast", { hasText: "Auf 6 von 8 Folien steht die Phase des Schulportal-Eintrags – den Zwischenstopp trägt Unterricks beim Markieren der letzten gezeigten Folie selbst ein." }).count() >= 1,
      mode + ": die Meldung nach dem Hochladen nennt die Phasen");
    ok(JSON.stringify(pA.codeSlides) === JSON.stringify([{ n: 3, lines: ["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", "Feibeitsblatt: Gewaltenteilung"] }]),
      mode + ": Codefolie (Folie 3) – Überschrift ohne die Zeile „" + PHASE_MARK + ": 2“");
    const diff = await maxDiff(await urlsOf(pA), urlsB);
    // unsichtbar: Punkt für Punkt gleich; in Hintergrundfarbe: Kantenglättung rundet höchstens um 1–2 Stufen (nicht zu sehen)
    ok(mode === "invisible" ? diff === 0 : diff >= 0 && diff <= 3, mode + ": Folienbilder (Beamer, Schüler:innen) zeigen die Zeile nicht – größte Abweichung zu denselben Folien ohne Zeile: " + diff + " von 255");
  }

  /* ---------- A: Auswahl, Kontextmenü, „Bis hier gezeigt“ ---------- */
  ok((await tp.locator("#shown-hint").textContent()).includes("Den Zwischenstopp im Schulportal-Eintrag trägt Unterricks dabei selbst ein: vor die erste Phase, die nicht vollständig gezeigt wurde"), "A: Hinweis nennt den automatischen Zwischenstopp");
  await mark("4", "Schüler:innen sehen nach der Freigabe nur Folie 1–4. Zwischenstopp im Schulportal-Eintrag vor „3) Sicherung“ eingetragen.");
  ok(stopBefore(await tp.inputValue("#portal")) === "**3) Sicherung**" && await savedStop(A, "**3) Sicherung**"), "Auswahl „Folie 4“ (Ende von Phase 2): Zwischenstopp vor „3) Sicherung“ – im Eintrag und auf dem Server gespeichert");
  ok(await tp.locator("#stop-next").isVisible() && (await tp.locator("#stop-next").textContent()).startsWith("Zwischenstopp gesetzt."), "… mit demselben Hinweis zur nächsten Sitzung wie von Hand");
  ok((await tp.locator("#stop-sync").textContent()) === "Zwischenstopp im Schulportal-Eintrag vor „3) Sicherung“ eingetragen.", "… und der Rückmeldung unter der Auswahl");
  ok(JSON.stringify((await pres(A)).phases.auto) === JSON.stringify({ phase: 3, until: 4 }), "der Server vermerkt, wo Unterricks ihn eingetragen hat");
  await tp.locator(".shownbox").scrollIntoViewIfNeeded();
  await tp.screenshot({ ...SHOT, path: join(OUT, "phasen-zwischenstopp.png") });
  await tp.locator("section.card").filter({ has: tp.locator("h2", { hasText: /^Schulportal-Eintrag$/ }) }).screenshot({ ...SHOT, path: join(OUT, "phasen-schulportal.png") });
  // Kontextmenü einer Folie: Folie 3 (Phase 2, Folie 4 gehört auch dazu) → vor „2) Partnerarbeit“ (die angefangene Phase gilt als nicht geschafft)
  await noToasts();
  await tp.locator(".thumbs .thumb").nth(2).click({ button: "right" });
  await tp.locator(".ctxmenu").getByRole("menuitem", { name: "Bis hier gezeigt (Folie 3 als letzte gezeigte Folie markieren)" }).click();
  await tp.locator(".toast", { hasText: "Zwischenstopp im Schulportal-Eintrag vor „2) Partnerarbeit“ eingetragen." }).waitFor({ timeout: 30000 });
  ok(await savedStop(A, "**2) Partnerarbeit**") && (await tp.inputValue("#portal")).split(STOP_LINE).length === 2, "Kontextmenü „Bis hier gezeigt“ auf Folie 3 (mitten in Phase 2): Zwischenstopp vor „2) Partnerarbeit“ verschoben (nur einer)");
  // „Bis hier gezeigt“ in der Präsentation: Folie 6 (Quellen, ohne Phase) → vor „4) Diskussion“ (nach „--> Nächste Stunde“)
  await tp.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
  await tp.locator(".presenter").waitFor();
  for (let i = 0; i < 6; i++) { await tp.keyboard.press("ArrowRight"); await tp.locator(".presenter .counter", { hasText: (i + 1) + " / 8" }).waitFor({ timeout: 10000 }); }
  await tp.locator(".presenter").getByRole("button", { name: /als letzte im Unterricht gezeigte Folie markieren/ }).click();
  await tp.locator(".presenter .markstate", { hasText: "Bis Folie 6 markiert · Zwischenstopp vor „4) Diskussion“" }).waitFor({ timeout: 30000 });
  ok(stopBefore(await tp.inputValue("#portal")) === "**4) Diskussion**" && await savedStop(A, "**4) Diskussion**"),
    "„Bis hier gezeigt“ in der Präsentation (Folie 6, ohne Phase): die Seite darunter trägt den Zwischenstopp vor „4) Diskussion“ ein und speichert ihn – während die Präsentation offen ist");
  await tp.screenshot({ ...SHOT, path: join(OUT, "phasen-praesentation.png") });
  await tp.evaluate(() => (document.fullscreenElement ? document.exitFullscreen() : null)).catch(() => {});   // das Fenster lässt sich nur außerhalb des Vollbilds ändern
  await sleep(300);
  for (const [w, hh] of [[1180, 820], [820, 1180], [390, 844]]) { await tp.setViewportSize({ width: w, height: hh }); await tp.screenshot({ ...SHOT, path: join(OUT, "phasen-praesentation-" + w + ".png") }); }
  await tp.setViewportSize({ width: 1440, height: 950 });
  await tp.getByRole("button", { name: "Präsentation für alle beenden" }).click();
  await tp.locator(".presenter").waitFor({ state: "detached", timeout: 10000 });
  await tp.locator("#stop-sync:not(.hidden)", { hasText: "vor „4) Diskussion“" }).waitFor({ timeout: 10000 });
  ok(await tp.locator("#shown-sel").inputValue() === "6", "nach der Präsentation: Auswahl und Rückmeldung zeigen den Stand");

  /* ---------- Aufheben, Stunde geschafft, von Hand gesetzter Zwischenstopp bleibt ---------- */
  await mark("", "Den Zwischenstopp vor „4) Diskussion“, den Unterricks eingetragen hatte, hat es wieder entfernt.");
  ok(await savedStop(A, null) && (await portalOf(A)) === PORTAL, "Markierung aufgehoben: der von Unterricks eingetragene Zwischenstopp ist wieder weg (Eintrag wie vorher)");
  await mark("7", "Laut Präsentation ist die Stunde geschafft – im Schulportal-Eintrag ist kein Zwischenstopp nötig.");
  ok(await savedStop(A, null), "Folie 7 (letzte Phase): Stunde geschafft – kein Zwischenstopp");
  await mark("4", "vor „3) Sicherung“ eingetragen.");
  await mark("7", "Laut Präsentation ist die Stunde geschafft – den Zwischenstopp vor „3) Sicherung“, den Unterricks eingetragen hatte, hat es wieder entfernt.");
  ok(await savedStop(A, null), "Stunde geschafft nach einem automatischen Zwischenstopp: er wird entfernt");
  await mark("4", "vor „3) Sicherung“ eingetragen.");
  await savedStop(A, "**3) Sicherung**");
  // die Lehrkraft verschiebt ihn von Hand (Rechtsklick in der Vorschau) – Aufheben lässt ihn dann stehen
  await tp.locator(".portal-preview p", { hasText: "2) Partnerarbeit" }).click({ button: "right" });
  await tp.locator(".ctxmenu").getByRole("menuitem", { name: "Zwischenstopp einfügen" }).click();
  ok(await savedStop(A, "**2) Partnerarbeit**"), "von Hand vor „2) Partnerarbeit“ verschoben und gespeichert");
  await mark("", "Ihr Zwischenstopp im Schulportal-Eintrag bleibt stehen – Sie haben ihn selbst gesetzt bzw. verschoben.");
  await sleep(1500);
  ok(stopBefore(await portalOf(A)) === "**2) Partnerarbeit**", "Markierung aufgehoben: der von Hand verschobene Zwischenstopp bleibt stehen");
  // eine neue Markierung setzt ihn wieder neu (die letzte Handlung gilt)
  await mark("5", "vor „4) Diskussion“ eingetragen.");
  ok(await savedStop(A, "**4) Diskussion**"), "neue Markierung (Folie 5): der Zwischenstopp steht wieder dort, wo die Präsentation endet");
  // Überschriften passen nicht (Phase 4 im Eintrag umnummeriert in 5): Folie 7 (Phase 4) – nichts geändert, klarer Hinweis
  await tp.fill("#portal", PORTAL.replace("**4) Diskussion**", "**5) Diskussion**"));
  await tp.locator("#portal").blur();
  await savedStop(A, null);
  await mark("7", "Den Zwischenstopp hat Unterricks nicht eingetragen: Die Phase 4 der Präsentation steht nicht im Schulportal-Eintrag. Bitte setzen Sie ihn selbst oder passen Sie „Phasen der Folien“ an.");
  ok(await savedStop(A, null) && !(await tp.inputValue("#portal")).includes(STOP_LINE), "Phase fehlt im Eintrag: keine Änderung, klarer Hinweis");
  await tp.fill("#portal", PORTAL); await tp.locator("#portal").blur();
  await savedStop(A, null);

  /* ---------- B: ohne Phasen → von Hand zuordnen („Phasen der Folien“), danach folgt der Zwischenstopp ---------- */
  await tp.goto(BASE + "/#/lk/s/" + B.id);
  await card().locator("#shown-sel").waitFor({ timeout: 15000 });
  await mark("4", "Den Zwischenstopp im Schulportal-Eintrag setzen Sie bitte selbst: Diese Präsentation trägt keine Phasen.");
  await sleep(1000);
  ok((await portalOf(B)) === PORTAL, "B ohne Phasen: der Eintrag bleibt unverändert, ruhiger Hinweis");
  const box = tp.locator("details#phases");
  ok((await box.locator("summary").textContent()).includes("Phasen der Folien – keine: bitte zuordnen"), "„Phasen der Folien“: Zusammenfassung sagt, dass noch keine zugeordnet sind");
  await box.locator("summary").click();
  for (const [label, at] of [["1) Einstieg – beginnt bei", "1"], ["2) Partnerarbeit – beginnt bei", "3"], ["3) Sicherung – beginnt bei", "5"], ["4) Diskussion – beginnt bei", "7"]])
    await box.getByLabel(label).selectOption(at);
  ok((await box.locator("#phase-sum").textContent()) === "Folie 1–2: Phase 1 · Folie 3–4: Phase 2 · Folie 5–6: Phase 3 · Folie 7–8: Phase 4", "Übersicht folgt der Auswahl (noch nicht gespeichert)");
  // falsche Reihenfolge: Hinweis, nichts gespeichert
  await box.getByLabel("3) Sicherung – beginnt bei").selectOption("2");
  await box.getByRole("button", { name: "Zuordnung speichern" }).click();
  ok(await box.locator("#phase-err").isVisible() && (await box.locator("#phase-err").textContent()).startsWith("Die Phase 3 beginnt bei Folie 2"), "Reihenfolge falsch: Hinweis, nichts gespeichert");
  await box.getByLabel("3) Sicherung – beginnt bei").selectOption("5");
  // Tastatur: Fokus auf dem Knopf, Enter speichert, der Fokus bleibt
  await noToasts();
  await box.getByRole("button", { name: "Zuordnung speichern" }).focus();
  await tp.keyboard.press("Enter");
  await box.locator(".save-state", { hasText: "Gespeichert – Unterricks folgt jetzt Ihrer Zuordnung." }).waitFor({ timeout: 15000 });
  ok(await tp.evaluate(() => (document.activeElement || {}).textContent) === "Zuordnung speichern", "Speichern per Tastatur: der Fokus bleibt auf dem Knopf");
  const pB2 = await pres(B);
  ok(JSON.stringify(pB2.phases.hand) === JSON.stringify([1, 1, 2, 2, 3, 3, 4, 4]) && pB2.phases.pdf === null, "Zuordnung an der Präsentation gespeichert (je Folie)");
  // Prüfbefund: Folie 4 war schon markiert (die Auswahl derselben Folie löst nichts aus) – das Speichern trägt den Zwischenstopp selbst ein
  await tp.locator(".toast", { hasText: "Zwischenstopp im Schulportal-Eintrag vor „3) Sicherung“ eingetragen." }).waitFor({ timeout: 30000 });
  ok(await savedStop(B, "**3) Sicherung**") && stopBefore(await tp.inputValue("#portal")) === "**3) Sicherung**" && await tp.locator("#stop-next").isVisible(),
    "Zuordnung gespeichert, Folie 4 schon markiert: der Zwischenstopp folgt sofort (vor „3) Sicherung“, gespeichert, mit dem Hinweis zur nächsten Sitzung) – ohne erneutes Markieren");
  ok((await tp.locator("#shown-hint").textContent()).includes("Den Zwischenstopp im Schulportal-Eintrag trägt Unterricks dabei selbst ein") &&
    (await tp.locator("#stop-sync").textContent()) === "Zwischenstopp im Schulportal-Eintrag vor „3) Sicherung“ eingetragen." &&
    (await tp.locator(".thumbs .thumb").nth(3).getAttribute("aria-label")).startsWith("Folie 4 (Phase 2)") && (await box.locator("summary").textContent()).includes("von Ihnen zugeordnet, 8 von 8 Folien") &&
    await tp.evaluate(() => (document.activeElement || {}).textContent) === "Zuordnung speichern",
    "nach dem Speichern an Ort und Stelle angeglichen: Hinweis an der Auswahl, Rückmeldung zum Zwischenstopp, Namen der Vorschaubilder, Zusammenfassung; der Fokus bleibt");
  for (const [w, scheme] of [[1366, "light"], [1180, "light"], [820, "light"], [390, "light"], [1366, "dark"], [1180, "dark"], [820, "dark"], [390, "dark"]]) {
    await tp.setViewportSize({ width: w, height: w <= 420 ? 844 : w <= 820 ? 1180 : w === 1180 ? 820 : 900 });
    await tp.emulateMedia({ colorScheme: scheme });
    await tp.locator(".shownbox").scrollIntoViewIfNeeded();
    await tp.screenshot({ ...SHOT, path: join(OUT, "phasen-nach-zuordnung-" + w + "-" + scheme + ".png") });
  }
  await tp.setViewportSize({ width: 1440, height: 950 }); await tp.emulateMedia({ colorScheme: null });
  // ein von Hand verschobener Zwischenstopp bleibt, wenn die Zuordnung erneut gespeichert wird (keine neue Markierung)
  await tp.locator(".portal-preview p", { hasText: "2) Partnerarbeit" }).click({ button: "right" });
  await tp.locator(".ctxmenu").getByRole("menuitem", { name: "Zwischenstopp einfügen" }).click();
  await savedStop(B, "**2) Partnerarbeit**");
  await noToasts();
  await box.getByLabel("4) Diskussion – beginnt bei").selectOption("8");
  await box.getByRole("button", { name: "Zuordnung speichern" }).click();
  await tp.locator(".toast", { hasText: "Ihr Zwischenstopp im Schulportal-Eintrag bleibt stehen – Sie haben ihn selbst gesetzt bzw. verschoben." }).waitFor({ timeout: 30000 });
  await sleep(1000);
  ok(stopBefore(await portalOf(B)) === "**2) Partnerarbeit**", "Zuordnung erneut gespeichert: der von Hand verschobene Zwischenstopp bleibt stehen");
  await box.getByLabel("4) Diskussion – beginnt bei").selectOption("7");
  await noToasts();
  await box.getByRole("button", { name: "Zuordnung speichern" }).click();
  await box.locator(".save-state", { hasText: "Gespeichert – Unterricks folgt jetzt Ihrer Zuordnung." }).waitFor({ timeout: 15000 });
  await tp.locator(".toast", { hasText: "Ihr Zwischenstopp im Schulportal-Eintrag bleibt stehen" }).waitFor({ timeout: 30000 });
  for (const [w, scheme] of [[1366, "light"], [1180, "light"], [820, "light"], [390, "light"], [1366, "dark"], [1180, "dark"], [820, "dark"], [390, "dark"]]) {
    await tp.setViewportSize({ width: w, height: w <= 420 ? 844 : w <= 820 ? 1180 : w === 1180 ? 820 : 900 });
    await tp.emulateMedia({ colorScheme: scheme });
    await box.scrollIntoViewIfNeeded();
    await tp.screenshot({ ...SHOT, path: join(OUT, "phasen-zuordnung-" + w + "-" + scheme + ".png") });
  }
  await tp.setViewportSize({ width: 1440, height: 950 }); await tp.emulateMedia({ colorScheme: null });
  await mark("6", "Zwischenstopp im Schulportal-Eintrag vor „4) Diskussion“ eingetragen.");
  ok(await savedStop(B, "**4) Diskussion**"), "B mit Zuordnung von Hand: eine neue Markierung (Folie 6) setzt den Zwischenstopp neu – vor „4) Diskussion“");

  /* ---------- Sitzungsdatei: die Zuordnung von Hand kommt mit (C) ---------- */
  const moved = await tp.evaluate(async ([bId, cId]) => {
    const v = "/v/" + document.querySelector('meta[name="unterricks-build"]').content + "/";
    const IO = await import(v + "sessionio.js"), TT = await import(v + "teacher.js");
    const detail = await TT.tapi("GET", "/api/teacher/lessons/" + bId), target = (await TT.tapi("GET", "/api/teacher/lessons/" + cId)).lesson;
    const z = await IO.buildSessionZip(detail, { fb: null });
    const { data, byPath } = await IO.readSessionZip(z.bytes);
    const pf = data.files.find((f) => f.area === "presentation");
    await IO.applySessionImport(cId, IO.planSessionImport(data, target), data, byPath, { target });
    return { inFile: pf && pf.slidePhases };
  }, [B.id, C.id]);
  const pC = await pres(C);
  ok(JSON.stringify(moved.inFile) === JSON.stringify([1, 1, 2, 2, 3, 3, 4, 4]) && pC && JSON.stringify(pC.phases.hand) === JSON.stringify([1, 1, 2, 2, 3, 3, 4, 4]),
    "Sitzung als Datei: die Zuordnung von Hand steht in sitzung.json (slidePhases) und gilt nach dem Laden in einer anderen Sitzung");

  for (const L of [A, B, C]) await T("DELETE", "/api/teacher/lessons/" + L.id);
  await T("DELETE", "/api/teacher/units/" + u.id);
  ok((await T("GET", "/api/teacher/units/" + u.id)).status === 404, "Test-Kurs PoWi 9F wieder gelöscht");
}
