// bring.mjs – End-to-End-Prüfung „Für den nächsten Arbeitstag einpacken“ (Nachtrag 28): Claude trägt über den Connector (lokaler Worker) für je eine Sitzung
// des Gymnasiums und der Grundschule am nächsten Arbeitstag Gegenstände ein (update_lesson mitbringen) → roter Kasten direkt unter „Druckaufträge für den
// nächsten Arbeitstag“ auf beiden Startseiten, Stichpunkte, Aufklappen mit Maus und Tastatur, Farben; von Hand auf der Sitzungsseite hinzufügen, ändern,
// löschen; leer → kein Kasten. Bildschirmfotos 1366/820/390 px, hell und dunkel, in OUT („einpacken-*.png“). Frei erfundene Inhalte.
// ctx = {tp (Seite der Lehrkraft, angemeldet), BASE, T (Fetch mit Anmeldung), tool (Connector), ok, OUT, SHOT, gymL, gsL (Sitzungen am nächsten Arbeitstag:
// PoWi 9D 07:50, Grundschule Religion 2ab 09:40), horizontalIssues}
import { join } from "node:path";

export async function bringE2E({ tp, BASE, T, tool, ok, OUT, SHOT, gymL, gsL, horizontalIssues }) {
  // Claude legt die Gegenstände an (Gymnasium und Grundschule); derselbe „Beutel“ in beiden Sitzungen
  let r = await tool("update_lesson", { lesson_id: gymL, mitbringen: [
    { gegenstand: "Wahlurne", wofuer: "Für die Probeabstimmung in Phase 3 der 9D." },
    { gegenstand: "Beutel", wofuer: "Mit Losen für die Gruppeneinteilung im Einstieg der 9D." }] });
  ok(!r.isError && r.content[0].text.includes("Mitbringen (2 Gegenstände): Wahlurne, Beutel"), "Connector (Gymnasium): update_lesson mit mitbringen – " + r.content[0].text.slice(0, 120));
  r = await tool("update_lesson", { lesson_id: gsL, mitbringen: [
    { gegenstand: "Kinderbibel", wofuer: "Zum Vorlesen der Schöpfungsgeschichte im Sitzkreis (Phase 2) der Religion 2ab." },
    { gegenstand: "Beutel", wofuer: "Als Fühlbeutel mit Naturmaterial im Einstieg der 2a/b." }] });
  ok(!r.isError && r.content[0].text.includes("Mitbringen (2 Gegenstände): Kinderbibel, Beutel"), "Connector (Grundschule): update_lesson mit mitbringen");
  r = await tool("update_lesson", { lesson_id: gsL, mitbringen: [{ gegenstand: "Kerze", wofuer: "Eins. Zwei. Drei." }] });
  ok(r.isError && r.content[0].text.includes("hat mehr als zwei Sätze"), "Connector: mehr als zwei Sätze werden abgelehnt (die Liste bleibt)");
  const gg = await tool("get_lesson", { lesson_id: gymL }), gs = await tool("get_lesson", { lesson_id: gsL });
  ok(gg.content[0].text.includes("## Mitbringen (Gegenstände, die die Lehrkraft für diese Stunde mitbringen muss)\n- Wahlurne: Für die Probeabstimmung in Phase 3 der 9D.")
    && gs.content[0].text.includes("- Kinderbibel: Zum Vorlesen der Schöpfungsgeschichte im Sitzkreis (Phase 2) der Religion 2ab."), "get_lesson zeigt die Gegenstände (beide Schulformen)");

  // Startseite Gymnasium: roter Kasten direkt unter dem Feld der Druckaufträge
  const pack = tp.locator("#packnext");
  const under = () => tp.evaluate(() => { const c = document.querySelector("main .printnext"), p = document.querySelector("main #packnext"); return !!c && !!p && c.nextElementSibling === p && !p.classList.contains("hidden"); });
  // zuerst die Übersicht „Grundschule“ (die Seite steht womöglich schon auf #/lk – derselbe Hash lädt nicht neu)
  for (const [hash, label] of [["#/lk/grundschule", "Übersicht Grundschule"], ["#/lk", "Startseite Gymnasium"]]) {
    await tp.goto(BASE + "/" + hash);
    await pack.locator("button.pk-item").first().waitFor({ timeout: 15000 });
    const names = await pack.locator("button.pk-item").allTextContents();
    ok(await under() && (await pack.locator("h2").textContent()) === "Für den nächsten Arbeitstag einpacken" && JSON.stringify(names) === JSON.stringify(["Wahlurne", "Beutel · 2 Stunden", "Kinderbibel"])
      && await pack.locator(".pk-note:visible").count() === 0,
      label + ": roter Kasten direkt unter den Druckaufträgen, Stichpunkte " + names.join(" | ") + " (zugeklappt)");
  }
  // Farben: rote Fläche und Kante (hell), Hinweis in kleinerer Schrift
  const look = () => pack.evaluate((el) => { const cs = getComputedStyle(el), b = el.querySelector("button.pk-item"), n = el.querySelector(".pk-note");
    return { bg: cs.backgroundColor, border: cs.borderTopColor, item: parseFloat(getComputedStyle(b).fontSize), note: n ? parseFloat(getComputedStyle(n).fontSize) : 0 }; });
  // Maus: „Beutel“ aufklappen – je Sitzung Lerngruppe (Link) und Hinweis
  const beutel = pack.getByRole("button", { name: "Beutel · 2 Stunden" });
  await beutel.click();
  const note = tp.locator("#" + await beutel.getAttribute("aria-controls"));
  const places = await note.locator(".pk-place").allTextContents(), l1 = await look();
  ok(await beutel.getAttribute("aria-expanded") === "true" && await note.isVisible() && JSON.stringify(places) === JSON.stringify([
    "PoWi 9D, 07:50 Uhr: Mit Losen für die Gruppeneinteilung im Einstieg der 9D.", "Grundschule Religion 2ab, 09:40 Uhr: Als Fühlbeutel mit Naturmaterial im Einstieg der 2a/b."])
    && l1.bg === "rgb(251, 233, 231)" && l1.border === "rgb(200, 40, 30)" && l1.note < l1.item,
    "Klick auf „Beutel“: aufgeklappt mit beiden Sitzungen, kleinere Schrift (" + l1.note + " < " + l1.item + " px), rot (" + l1.bg + ", Kante " + l1.border + ")");
  // Tastatur: Tab bis „Kinderbibel“, Enter klappt auf, Leertaste zu – der Fokus bleibt
  const bibel = pack.getByRole("button", { name: "Kinderbibel" });
  await bibel.focus(); await tp.keyboard.press("Enter");
  const bn = tp.locator("#" + await bibel.getAttribute("aria-controls"));
  const opened = await bibel.getAttribute("aria-expanded") === "true" && await bn.isVisible() && (await bn.textContent()).includes("Zum Vorlesen der Schöpfungsgeschichte");
  await tp.keyboard.press(" ");
  ok(opened && await bibel.getAttribute("aria-expanded") === "false" && !(await bn.isVisible()) && await bibel.evaluate((el) => el === document.activeElement),
    "Tastatur: Enter klappt „Kinderbibel“ auf, Leertaste wieder zu, der Fokus bleibt auf dem Gegenstand");
  await beutel.click();   // wieder zu – dann „Kinderbibel“ offen für die Bildschirmfotos
  await bibel.click();
  // Bildschirmfotos: Laptop, iPad hochkant, Handy – hell und dunkel; am Handy ohne seitliches Schieben
  const vp0 = tp.viewportSize();
  const shots = async (name, sel) => {
    for (const [w, hh] of [[1366, 900], [820, 1180], [390, 844]]) for (const dark of [false, true]) {
      await tp.setViewportSize({ width: w, height: hh }); await tp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await tp.waitForTimeout(250);
      const el = tp.locator(sel).first(); await el.scrollIntoViewIfNeeded();
      await el.screenshot({ ...SHOT, path: join(OUT, "einpacken-" + name + "-" + w + (dark ? "-dunkel" : "") + ".png") });
      if (w < 400 && !dark) { const hi = await horizontalIssues(tp); ok(!hi.length, "„" + name + "“ am Handy (390 px): ohne seitliches Schieben" + (hi.length ? " – " + JSON.stringify(hi).slice(0, 200) : "")); }
      if (dark && w === 1366 && sel === "#packnext") { const d = await look(); ok(d.bg === "rgb(61, 26, 26)" && d.border === "rgb(255, 138, 128)", "dunkel: Fläche " + d.bg + ", Kante " + d.border); }
    }
    await tp.emulateMedia({ colorScheme: "light" }); await tp.setViewportSize(vp0);
  };
  await shots("startseite", "#packnext");
  await tp.goto(BASE + "/#/lk/grundschule");
  await pack.locator("button.pk-item").first().waitFor({ timeout: 15000 });
  await pack.getByRole("button", { name: "Beutel · 2 Stunden" }).click();
  await shots("startseite-grundschule", "#packnext");
  await tp.goto(BASE + "/#/lk");
  await pack.locator("button.pk-item").first().waitFor({ timeout: 15000 });
  await tp.setViewportSize({ width: 1366, height: 900 });
  await tp.screenshot({ ...SHOT, path: join(OUT, "einpacken-startseite-ganz.png") });
  await tp.setViewportSize(vp0);

  // Sitzungsseite (Gymnasium): von Hand hinzufügen – Prüfung wie beim Server (zwei Sätze), dann gespeichert
  await tp.goto(BASE + "/#/lk/s/" + gymL);
  const card = tp.locator("#bring");
  await card.locator(".bring-row").first().waitFor({ timeout: 15000 });
  ok(JSON.stringify(await card.locator(".bring-item").allTextContents()) === JSON.stringify(["Wahlurne", "Beutel"]) && (await card.locator("h2").textContent()) === "Mitbringen",
    "Sitzungsseite (Gymnasium): Karte „Mitbringen“ mit den Gegenständen von Claude");
  await card.getByRole("button", { name: "Gegenstand hinzufügen" }).click();
  ok(await tp.locator("#bring-item").evaluate((el) => el === document.activeElement), "„Gegenstand hinzufügen“: Fokus im Feld „Gegenstand“");
  await tp.fill("#bring-item", "Lautsprecher"); await tp.fill("#bring-note", "Für das Erklärvideo im Einstieg. In der 9D. Und noch ein dritter Satz.");
  await card.getByRole("button", { name: "Speichern" }).click();
  await card.locator("#bring-err:visible").waitFor({ timeout: 5000 });
  ok((await card.locator("#bring-err").textContent()).includes("mehr als zwei Sätze") && await tp.locator("#bring-note").getAttribute("aria-invalid") === "true"
    && await tp.locator("#bring-note").evaluate((el) => el === document.activeElement), "drei Sätze: Meldung am Feld, Fokus dort, nichts gespeichert");
  for (const [w, hh, dark] of [[1366, 900, false], [1366, 900, true], [390, 844, false]]) {   // das offene Formular mit der Meldung
    await tp.setViewportSize({ width: w, height: hh }); await tp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await tp.waitForTimeout(250);
    await card.scrollIntoViewIfNeeded(); await card.screenshot({ ...SHOT, path: join(OUT, "einpacken-formular-" + w + (dark ? "-dunkel" : "") + ".png") });
  }
  await tp.emulateMedia({ colorScheme: "light" }); await tp.setViewportSize(vp0);
  await tp.fill("#bring-note", "Für das Erklärvideo in Phase 2 der 9D.");
  await tp.keyboard.press("Tab"); await tp.keyboard.press("Enter");   // Tab auf „Speichern“, Enter
  await card.locator(".bring-item", { hasText: "Lautsprecher" }).waitFor({ timeout: 10000 });
  ok((await card.locator(".save-state").textContent()).includes("„Lautsprecher“ hinzugefügt") && await card.getByRole("button", { name: "Gegenstand hinzufügen" }).evaluate((el) => el === document.activeElement),
    "per Tastatur gespeichert, Fokus zurück auf „Gegenstand hinzufügen“");
  await shots("sitzung", "#bring");
  // Grundschule: ändern und löschen von Hand
  await tp.goto(BASE + "/#/lk/s/" + gsL);
  const gcard = tp.locator("#bring");
  await gcard.locator(".bring-row").first().waitFor({ timeout: 15000 });
  await gcard.getByRole("button", { name: "„Kinderbibel“ bearbeiten" }).click();
  await tp.fill("#bring-note", "Zum Vorlesen im Sitzkreis (Phase 2) der 2a/b.");
  await gcard.getByRole("button", { name: "Speichern" }).click();
  await gcard.locator(".bring-note", { hasText: "Zum Vorlesen im Sitzkreis (Phase 2) der 2a/b." }).waitFor({ timeout: 10000 });
  ok(await gcard.getByRole("button", { name: "„Kinderbibel“ bearbeiten" }).evaluate((el) => el === document.activeElement), "Grundschule: Hinweis geändert, Fokus wieder auf dem Stift");
  await gcard.getByRole("button", { name: "„Beutel“ löschen" }).click();
  await tp.locator(".modal").getByRole("button", { name: "Löschen" }).click();
  await gcard.locator(".bring-item", { hasText: "Beutel" }).waitFor({ state: "detached", timeout: 10000 });
  ok(JSON.stringify(await gcard.locator(".bring-item").allTextContents()) === JSON.stringify(["Kinderbibel"]), "Grundschule: „Beutel“ gelöscht (mit Rückfrage)");
  await shots("sitzung-grundschule", "#bring");
  // Startseite folgt den Änderungen
  await tp.goto(BASE + "/#/lk");
  await pack.locator("button.pk-item").first().waitFor({ timeout: 15000 });
  const now = await pack.locator("button.pk-item").allTextContents();
  await pack.getByRole("button", { name: "Kinderbibel" }).click();
  ok(JSON.stringify(now) === JSON.stringify(["Wahlurne", "Beutel", "Lautsprecher", "Kinderbibel"])
    && (await pack.locator(".pk-note:visible").textContent()) === "Grundschule Religion 2ab, 09:40 Uhr: Zum Vorlesen im Sitzkreis (Phase 2) der 2a/b.",
    "Startseite: die Änderungen von Hand sind da (" + now.join(" | ") + ")");
  // alles leeren (Grundschule von Hand, Gymnasium über den Connector) → kein Kasten
  await tp.goto(BASE + "/#/lk/s/" + gsL);
  await gcard.locator(".bring-row").first().waitFor({ timeout: 15000 });
  await gcard.getByRole("button", { name: "„Kinderbibel“ löschen" }).click();
  await tp.locator(".modal").getByRole("button", { name: "Löschen" }).click();
  await gcard.locator(".bring-empty:visible").waitFor({ timeout: 10000 });
  ok(await gcard.getByRole("button", { name: "Gegenstand hinzufügen" }).evaluate((el) => el === document.activeElement), "letzter Gegenstand gelöscht: Fokus auf „Gegenstand hinzufügen“");
  r = await tool("update_lesson", { lesson_id: gymL, mitbringen: [] });
  ok(!r.isError && r.content[0].text.includes("Die Liste „Mitbringen“ ist leer."), "Connector: [] leert die Liste");
  await tp.goto(BASE + "/#/lk");
  await tp.locator(".printnext .pn-row").first().waitFor({ timeout: 15000 });
  await tp.waitForTimeout(300);
  ok(await pack.count() === 1 && await pack.isHidden() && (await T("GET", "/api/teacher/print-next")).data.sessions.every((s) => !("bring" in s)), "ohne Gegenstände: kein roter Kasten");
}
