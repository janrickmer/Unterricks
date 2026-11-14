// freedays.mjs – End-to-End-Prüfung „Unterrichtsfreie Tage“ (Nachtrag 24): Einstellungen (Pflichtwahl der Schule, Fehler), Rückfrage mit den
// betroffenen Sitzungen, „Nur speichern“ (Markierung in Sitzung und Kalender) und „Speichern und verschieben“ (Gymnasium und Grundschule neu datiert,
// Hinweis zum Überarbeiten), Kalender für eine bzw. beide Schulen blockiert, Rahmendaten der Einheit, ein Datum auf einem freien Tag wird abgelehnt,
// Löschen. Läuft auf einer leeren Unterricks-Instanz (nach dem Zurücksetzen bzw. frisch) mit einem Grundschulkurs; die Daten liegen zwei Wochen voraus,
// die Seiten sehen per page.clock immer dieselbe Uhrzeit (unabhängig vom Wochentag des Testlaufs).
// ctx = {browser, BASE, T (Fetch mit Anmeldung), storage (Anmeldung der Lehrkraft als storageState), ok, step, OUT, tool (Connector) | null, shots: Ordner
// für die Bildschirmfotos aller Ansichten (sonst nur wenige in OUT), watch(page, label)}
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { berlinToday, berlinTime, addDays, mondayOf, fmtDay } from "../../public/shared.js";
import { freeRangeText, weekRangeText, nextWorkday } from "../../public/planning.js";

export async function freeDaysE2E({ browser, BASE, T, storage, ok, OUT, tool = null, shots = null, watch = () => {} }) {
  const today = berlinToday(), M = addDays(mondayOf(today), 14), D = (n) => addDays(M, n);
  if (shots) mkdirSync(shots, { recursive: true });
  ok((await T("GET", "/api/teacher/free-days")).data.freeDays.length === 0, "noch keine unterrichtsfreien Tage");
  // Grundschulkurs (Di 08:00, Do 09:00) und je eine Einheit mit 6 Sitzungen: Gymnasium PoWi 8A (Mo 08:00, Mi 10:00), Grundschule Religion 2ab
  const course = (await T("POST", "/api/teacher/gs/courses", { grade: 2, classes: ["a", "b"], religion: true, weekdays: [{ day: 2, minutes: 45, time: "08:00" }, { day: 4, minutes: 45, time: "09:00" }], classSize: 22 })).data.course;
  const unitWith = async (subject, klass, title, weekdays) => {
    const u = (await T("POST", "/api/teacher/units", { subject, klass, title, params: { start: M, end: D(18), weekdays } })).data.unit;
    const rows = ["Einstieg", "Erarbeitung", "Vertiefung", "Anwendung", "Übung", "Abschluss"].map((x, i) => ({ stundenfrage: x + " " + (i + 1), ablauf: ["Ablauf " + (i + 1)] }));
    await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: title, lernaufgabe: "Lernprodukt" }, rows, assignDates: true });
    await T("POST", "/api/teacher/units/" + u.id + "/sessions");
    return (await T("GET", "/api/teacher/units/" + u.id)).data.unit;
  };
  const gym = await unitWith("powi", "8A", "Wahlen in Deutschland", [{ day: 1, minutes: 45, time: "08:00" }, { day: 3, minutes: 45, time: "10:00" }]);
  const gs = await unitWith("gs", course.id, "Josef und seine Brüder", [{ day: 2, minutes: 45, time: "08:00" }, { day: 4, minutes: 45, time: "09:00" }]);
  const dates = (u) => u.rows.map((r) => r.date).join(",");
  ok(dates(gym) === [M, D(2), D(7), D(9), D(14), D(16)].join(",") && dates(gs) === [D(1), D(3), D(8), D(10), D(15), D(17)].join(",") && gym.lessons.length === 6 && gs.lessons.length === 6,
    "Gymnasium (Mo/Mi) und Grundschule (Di/Do): je 6 Sitzungen ab " + fmtDay(M));
  const lessonOn = (u, d) => u.lessons.find((l) => l.date === d);

  const ctxFor = async (vp = { width: 1440, height: 950 }, scheme = "light", extra = {}) => {
    const c = await browser.newContext({ viewport: vp, colorScheme: scheme, storageState: storage, ...extra });
    await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    await c.clock.install({ time: berlinTime(M, "07:00") });   // Montag der ersten Woche, früh – der Kalender zeigt diese Woche
    return c;
  };
  const ctx = await ctxFor(), p = await ctx.newPage(); watch(p, "Unterrichtsfreie Tage");
  await p.goto(BASE + "/#/lk/einstellungen");
  const card = p.locator("#freedays");
  await card.locator(".fd-empty").waitFor({ timeout: 20000 });
  ok(await p.locator("main .card").first().getAttribute("id") === "freedays" && (await card.locator("h2").textContent()) === "Unterrichtsfreie Tage"
    && (await card.textContent()).includes("Unterricks kennt keine automatisch") && (await card.locator(".fd-empty").textContent()) === "Noch keine unterrichtsfreien Tage eingetragen.",
    "Einstellungen: Karte „Unterrichtsfreie Tage“ ganz oben, Satz zum Zweck, noch leer");
  // Pflichtangaben: ohne Bezeichnung, ohne Schule (keine Vorauswahl)
  ok(await card.locator('input[name="fd-scope"]:checked').count() === 0 && await card.getByRole("radio").count() === 3, "„Betrifft“: drei Radioknöpfe ohne Vorauswahl");
  await card.getByRole("button", { name: "Eintragen" }).click();
  await card.locator("#fd-err", { hasText: "Bitte eine Bezeichnung eintragen" }).waitFor({ timeout: 5000 });
  ok(await p.evaluate(() => document.activeElement.id) === "fd-label" && await card.locator("#fd-label").getAttribute("aria-invalid") === "true"
    && await card.locator("#fd-label").getAttribute("aria-describedby") === "fd-err", "ohne Bezeichnung: Meldung, Feld markiert (aria-invalid, aria-describedby), Fokus im Feld");
  await card.locator("#fd-label").fill("Pädagogischer Tag");
  await card.locator("#fd-from").fill(D(2)); await card.locator("#fd-from").dispatchEvent("change");
  ok(await card.locator("#fd-to").inputValue() === D(2) && await card.locator("#fd-to").getAttribute("min") === D(2), "„Bis“ mit „Von“ vorbelegt, nie früher");
  await card.getByRole("button", { name: "Eintragen" }).click();
  await card.locator("#fd-err", { hasText: "Bitte wählen, ob der Eintrag die Grundschule, das Gymnasium oder beide Schulen betrifft." }).waitFor({ timeout: 5000 });
  ok(await p.evaluate(() => document.activeElement.id) === "fd-scope-gs" && await card.locator("#fd-scope").getAttribute("aria-invalid") === "true", "ohne Wahl der Schule: Meldung, Fokus auf dem ersten Radioknopf");
  if (shots) for (const scheme of ["light", "dark"]) {
    await p.emulateMedia({ colorScheme: scheme }); await p.waitForTimeout(100);
    await card.screenshot({ path: join(shots, "einstellungen-fehler-laptop-" + scheme + ".png") });
  }
  await p.emulateMedia({ colorScheme: "light" });
  // 1) Pädagogischer Tag nur fürs Gymnasium – betrifft die Mittwochsstunde der 8A → Rückfrage → „Nur speichern“
  await card.locator("#fd-scope-gym").check();
  ok(await card.locator("#fd-err").textContent() === "" && await card.locator("#fd-scope").getAttribute("aria-invalid") === null, "Auswahl der Schule nimmt die Meldung weg");
  await card.getByRole("button", { name: "Eintragen" }).click();
  const dlg = p.locator(".modal", { hasText: "Sitzungen an unterrichtsfreien Tagen" });
  await dlg.waitFor({ timeout: 15000 });
  const rows1 = await dlg.locator("tbody tr").allTextContents();
  ok(rows1.length === 1 && rows1[0].includes(fmtDay(D(2))) && rows1[0].includes("10:00 Uhr") && rows1[0].includes("8A") && rows1[0].includes("Erarbeitung 2"),
    "Rückfrage nennt die betroffene Sitzung (Datum, Uhrzeit, Fach, Klasse, Titel) – nur die des Gymnasiums");
  ok(await dlg.getByRole("button", { name: "Speichern und verschieben (empfohlen)" }).count() === 1 && await dlg.getByRole("button", { name: "Nur speichern – Sitzungen bleiben" }).count() === 1
    && await dlg.getByRole("button", { name: "Abbrechen" }).count() === 1 && (await dlg.textContent()).includes("rücken verschobene Sitzungen nicht zurück"),
    "drei Antworten: verschieben (empfohlen), nur speichern, abbrechen; Hinweis: Löschen schiebt nicht zurück");
  if (shots) await p.screenshot({ path: join(shots, "dialog-ein-tag-laptop-light.png") });
  await dlg.getByRole("button", { name: "Abbrechen" }).click();
  ok((await T("GET", "/api/teacher/free-days")).data.freeDays.length === 0 && await p.evaluate(() => document.activeElement.id) === "fd-save", "Abbrechen: nichts gespeichert, Fokus zurück auf „Eintragen“");
  await card.getByRole("button", { name: "Eintragen" }).click();
  await dlg.waitFor({ timeout: 15000 });
  await dlg.getByRole("button", { name: "Nur speichern – Sitzungen bleiben" }).click();
  await card.locator(".fd-status", { hasText: "„Pädagogischer Tag“ eingetragen." }).waitFor({ timeout: 15000 });
  let fd = (await T("GET", "/api/teacher/free-days")).data.freeDays;
  let g1 = (await T("GET", "/api/teacher/units/" + gym.id)).data.unit;
  ok(fd.length === 1 && fd[0].scope === "gym" && fd[0].from === D(2) && fd[0].to === D(2) && dates(g1) === dates(gym) && !g1.revise && (await card.locator(".fd-item").first().textContent()).includes("Gymnasium"),
    "„Nur speichern“: Eintrag (Gymnasium) gespeichert, die Sitzung bleibt am " + fmtDay(D(2)) + ", kein Hinweis zum Überarbeiten");
  ok((g1.params.schoolBreaks || []).length === 1 && g1.params.schoolBreaks[0].label === "Pädagogischer Tag" && g1.slots.every((s) => s.date !== D(2)),
    "die Einheit rechnet ab jetzt ohne den Tag (Termine ohne " + fmtDay(D(2)) + ")");
  // eine Sitzung auf dem freien Tag: ruhiger Hinweis in der Sitzung und in der Tabelle der Einheit
  const wed = lessonOn(gym, D(2));
  await p.goto(BASE + "/#/lk/s/" + wed.id); await p.locator(".chip.freechip").waitFor({ timeout: 15000 });
  ok((await p.locator(".chip.freechip").textContent()) === "Liegt auf einem unterrichtsfreien Tag (Pädagogischer Tag)", "Sitzung: „Liegt auf einem unterrichtsfreien Tag (Pädagogischer Tag)“");

  // 2) Herbstferien für beide Schulen – betrifft je zwei Sitzungen → „Speichern und verschieben“
  await p.goto(BASE + "/#/lk/einstellungen"); await card.locator(".fd-item").first().waitFor({ timeout: 15000 });
  await card.locator("#fd-label").fill("Herbstferien");
  await card.locator("#fd-from").fill(D(7)); await card.locator("#fd-from").dispatchEvent("change"); await card.locator("#fd-to").fill(D(11));
  await card.locator("#fd-scope-both").check();
  await card.getByRole("button", { name: "Eintragen" }).click();
  await dlg.waitFor({ timeout: 15000 });
  const rows2 = await dlg.locator("tbody tr").allTextContents();
  ok(rows2.length === 4 && rows2[0].includes(fmtDay(D(7))) && rows2[1].includes(fmtDay(D(8))) && rows2[1].includes("Grundschule") && rows2[1].includes("Religion 2ab") && rows2[3].includes(fmtDay(D(10))),
    "Rückfrage: vier Sitzungen beider Schulen nach Datum (Gymnasium Mo/Mi, Grundschule Di/Do)");
  if (shots) {
    await p.screenshot({ path: join(shots, "dialog-herbstferien-laptop-light.png") });
    await p.emulateMedia({ colorScheme: "dark" }); await p.waitForTimeout(150); await p.screenshot({ path: join(shots, "dialog-herbstferien-laptop-dark.png") }); await p.emulateMedia({ colorScheme: "light" });
  }
  await dlg.getByRole("button", { name: "Speichern und verschieben (empfohlen)" }).click();
  await card.locator(".fd-status", { hasText: "„Herbstferien“ eingetragen. 8 Stunden in 2 Einheiten verschoben." }).waitFor({ timeout: 20000 });
  ok((await card.locator(".fd-result").textContent()).includes("Verschoben – bitte jede dieser Einheiten mit Claude überarbeiten") && await card.locator(".fd-result a", { hasText: "Wahlen in Deutschland" }).count() === 1
    && await card.locator(".fd-result a", { hasText: "Josef und seine Brüder" }).count() === 1, "Ergebnis: beide Einheiten verschoben, mit Link und Hinweis zum Überarbeiten");
  if (shots) await card.screenshot({ path: join(shots, "einstellungen-liste-laptop-light.png") });
  g1 = (await T("GET", "/api/teacher/units/" + gym.id)).data.unit;
  const s1 = (await T("GET", "/api/teacher/units/" + gs.id)).data.unit;
  ok(dates(g1) === [M, D(2), D(14), D(16), "", ""].join(",") && dates(s1) === [D(1), D(3), D(15), D(17), "", ""].join(","),
    "verschoben wie bei der Krankmeldung: ab der ersten betroffenen Stunde auf die nächsten freien Termine, die letzten zwei ohne Termin");
  const byRow = (u, i) => u.lessons.find((l) => l.row === u.rows[i].uid);
  ok(byRow(g1, 2).date === D(14) && byRow(g1, 2).time === "08:00" && byRow(g1, 4).date === null && byRow(s1, 2).date === D(15) && byRow(s1, 2).time === "08:00" && byRow(s1, 5).date === null
    && byRow(g1, 1).date === D(2), "Sitzungen mit Datum und Beginn mitgeführt (ohne Termin auch ohne Datum); die Mittwochsstunde am Pädagogischen Tag bleibt");
  ok(g1.revise && g1.revise.open && g1.revise.items[0].kind === "free" && g1.revise.items[0].label === "Herbstferien" && s1.revise && s1.revise.open && !s1.lessons.some((l) => l.cancelled),
    "Hinweis zum Überarbeiten in beiden Einheiten (Grund „unterrichtsfreie Tage“), kein Ausfall-Eintrag");
  if (tool) {
    const gu = await tool("get_unit", { unit_id: gym.id }), su = await tool("get_unit", { unit_id: gs.id });
    ok(gu.content[0].text.includes("## Unterrichtsfreie Tage (Gymnasium) – aus den Einstellungen der Lehrkraft") && gu.content[0].text.includes("- Herbstferien: " + freeRangeText({ from: D(7), to: D(11) }))
      && gu.content[0].text.includes("## Verschoben wegen unterrichtsfreier Tage") && gu.content[0].text.includes("Unterrichtsfreie Tage: Pädagogischer Tag"),
      "Connector get_unit (Gymnasium): Abschnitt „Unterrichtsfreie Tage (Gymnasium)“, Rahmendaten mit „Unterrichtsfreie Tage: …“, was verschoben wurde");
    ok(su.content[0].text.includes("## Unterrichtsfreie Tage (Grundschule)") && !su.content[0].text.includes("Pädagogischer Tag") && !su.content[0].text.includes("## Ausfälle")
      && su.content[0].text.includes("Muss überarbeitet werden: ja"), "get_unit (Grundschule): nur die Tage der Grundschule, keine „Ausfälle“ (nicht krank), muss überarbeitet werden");
    // Prüfung der Abläufe: die Stunde, die nach „Nur speichern“ am Pädagogischen Tag liegt, und Sitzungen ohne Termin nennt der Connector ausdrücklich
    ok(gu.content[0].text.includes("Trotzdem an einem dieser Tage (die Lehrkraft hat die Sitzungen beim Eintragen dort gelassen): Stunde 2 „Erarbeitung 2“ am " + fmtDay(D(2)) + " (Pädagogischer Tag)")
      && gu.content[0].text.includes("- " + byRow(g1, 4).id + " [ohne Termin]: Übung 5") && gu.content[0].text.includes("Inhalte und Stundenfragen mit update_unit_row"),
      "get_unit (Gymnasium): Stunde am freien Tag benannt, Sitzungen „[ohne Termin]“, Überarbeiten wie im Prompt (update_unit_row)");
    const gl = (await tool("get_lesson", { lesson_id: wed.id })).content[0].text, gl5 = (await tool("get_lesson", { lesson_id: byRow(g1, 4).id })).content[0].text;
    ok(gl.includes("Achtung: Am " + fmtDay(D(2)) + " ist laut den Einstellungen der Lehrkraft unterrichtsfrei (Pädagogischer Tag) – diese Sitzung liegt trotzdem dort")
      && gl5.includes("Diese Sitzung hat noch keinen Termin – sie ist beim Verschieben hinter das Ende der Einheit gerutscht") && gl5.includes("Wegen unterrichtsfreier Tage verschoben (Herbstferien)"),
      "get_lesson (Gymnasium): Sitzung am freien Tag mit Hinweis, Sitzung ohne Termin mit Grund und Verschiebung");
  }

  // Kalender: Woche 1 – Mittwoch nur fürs Gymnasium frei (die Sitzung dort markiert), Woche 2 – für beide Schulen frei
  await p.goto(BASE + "/#/lk"); await p.locator(".weekcal .wk-ev").first().waitFor({ timeout: 20000 });
  const day = (i) => p.locator(".weekcal .wk-day").nth(i);
  ok((await day(2).locator(".wk-free").textContent()) === "Pädagogischer Tag – unterrichtsfrei (Gymnasium)" && await day(2).getAttribute("class").then((c) => c.includes("free-part"))
    && await day(2).locator(".wk-ev.onfree", { hasText: "8A" }).count() === 1 && (await day(2).locator(".wk-ev.onfree .sr-only").textContent()).includes("liegt auf einem unterrichtsfreien Tag (Pädagogischer Tag)")
    && await day(1).locator(".wk-ev", { hasText: "Religion 2ab" }).count() === 1 && await day(1).locator(".wk-free").count() === 0,
    "Wochenkalender: Mittwoch „Pädagogischer Tag – unterrichtsfrei (Gymnasium)“ mit der markierten Sitzung (auch für Screenreader), Dienstag Grundschule wie immer");
  const shotWeek = async (name) => { if (!shots) return; await p.locator(".weekcal").screenshot({ path: join(shots, name + "-laptop-light.png") });
    await p.emulateMedia({ colorScheme: "dark" }); await p.waitForTimeout(150); await p.locator(".weekcal").screenshot({ path: join(shots, name + "-laptop-dark.png") }); await p.emulateMedia({ colorScheme: "light" }); };
  await shotWeek("kalender-eine-schule");
  if (!shots) await p.locator(".weekcal").screenshot({ path: join(OUT, "lehrkraft-woche-unterrichtsfrei.png") });
  // Zeitachse und Band: die Einträge stehen unter dem Band, die Uhrzeiten passen zur Achse
  const [axisTop, trackTop] = await p.evaluate(() => [document.querySelector(".wk-ax-m").getBoundingClientRect().top, document.querySelector(".wk-day .wk-track").getBoundingClientRect().top]);
  ok(Math.abs(axisTop - trackTop) <= 2, "Raster: das Band verschiebt Zeitachse und Spuren gleich (Achse " + Math.round(axisTop) + " / Spur " + Math.round(trackTop) + ")");
  await p.locator(".weekcal").getByRole("button", { name: "Nächste Woche" }).click();
  await p.locator("#wk-range", { hasText: weekRangeText(D(7)) }).waitFor({ timeout: 5000 });
  const w2 = await p.locator(".weekcal .wk-day").evaluateAll((els) => els.map((e) => [e.className, e.querySelector(".wk-free") ? e.querySelector(".wk-free").textContent : "", e.querySelectorAll(".wk-ev").length]));
  ok(w2.every(([c, t, n]) => c.includes("free-all") && t === "Herbstferien – unterrichtsfrei (Grundschule und Gymnasium)" && n === 0) && await p.locator(".weekcal .wk-empty").count() === 0,
    "zweite Woche: jeder Tag „Herbstferien – unterrichtsfrei (Grundschule und Gymnasium)“, ganz schraffiert, ohne Einträge");
  await shotWeek("kalender-beide-schulen");
  // derselbe Kalender auf der Startseite der Grundschule (Woche 1): Mittwoch frei fürs Gymnasium, die Stunden der Grundschule wie immer
  await p.goto(BASE + "/#/lk/grundschule"); await p.locator(".weekcal .wk-ev").first().waitFor({ timeout: 20000 });
  ok((await day(2).locator(".wk-free").textContent()) === "Pädagogischer Tag – unterrichtsfrei (Gymnasium)" && await day(1).locator(".wk-ev", { hasText: "Religion 2ab" }).count() === 1
    && await day(3).locator(".wk-ev", { hasText: "Religion 2ab" }).count() === 1 && await day(2).locator(".wk-ev.onfree", { hasText: "8A" }).count() === 1,
    "Startseite Grundschule: derselbe Wochenkalender mit dem Band am Mittwoch, Grundschule Di/Do wie immer");
  const print = (await T("GET", "/api/teacher/print-next")).data;
  ok(print.date !== D(7) && print.date !== D(8), "Druckaufträge: der nächste Arbeitstag überspringt unterrichtsfreie Tage (" + print.date + ")");
  // Feld „Druckaufträge“: ist der nominelle nächste Arbeitstag (Uhr des Servers) unterrichtsfrei, nennt die Zeile den Eintrag und die Schule
  const cand = nextWorkday(berlinToday()), dmy = (iso) => iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4);
  const bt = (await T("POST", "/api/teacher/free-days", { label: "Brückentag", from: cand, to: cand, scope: "both", shift: false })).data.freeDay;
  const pn = (await T("GET", "/api/teacher/print-next")).data;
  await p.goto(BASE + "/#/lk"); await p.locator("#pn-day", { hasText: "unterrichtsfrei" }).waitFor({ timeout: 20000 });
  const pnDay = await p.locator("#pn-day").textContent();
  ok(pn.candidate === cand && pn.date === M && JSON.stringify(pn.freeDays) === JSON.stringify([{ from: cand, to: cand, label: "Brückentag", scope: "both" }])
    && pnDay.includes(dmy(cand)) && pnDay.includes(" ist laut Stundenplan kein Unterricht (darin unterrichtsfrei: Brückentag, beide Schulen) – deshalb die Druckaufträge für ") && pnDay.endsWith(dmy(M) + "."),
    "Druckaufträge: „… ist laut Stundenplan kein Unterricht (darin unterrichtsfrei: Brückentag, beide Schulen) – deshalb …“ (" + pnDay + ")");
  await T("DELETE", "/api/teacher/free-days/" + bt.id);

  // Rahmendaten der Einheit: die geltenden Tage zur Ansicht; Tabelle: Zeile auf dem freien Tag markiert; neues Datum auf freiem Tag → Meldung
  await p.goto(BASE + "/#/lk/u/" + gym.id); await p.locator(".fd-unit").waitFor({ timeout: 15000 });
  const fu = await p.locator(".fd-unit").textContent();
  ok(fu.includes("Unterrichtsfreie Tage des Gymnasiums") && fu.includes("Pädagogischer Tag: " + fmtDay(D(2))) && fu.includes("Herbstferien: " + freeRangeText({ from: D(7), to: D(11) }))
    && await p.locator(".fd-unit a", { hasText: "In den Einstellungen bearbeiten" }).getAttribute("href") === "#/lk/einstellungen"
    && (await p.locator(".card", { hasText: "1. Rahmendaten der Einheit" }).textContent()).includes("3 Sitzungen verfügbar"),
    "Rahmendaten: unterrichtsfreie Tage des Gymnasiums zur Ansicht mit Link in die Einstellungen; „3 Sitzungen verfügbar“ zählt sie nicht mit");
  ok(await p.locator('input[aria-label="Beginn"]').inputValue() === M && await p.locator(".unit-table .fd-row", { hasText: "Pädagogischer Tag" }).count() === 1,
    "Tabelle: Stunde 2 „Liegt auf einem unterrichtsfreien Tag (Pädagogischer Tag)“");
  const rv = p.locator(".revisebox");
  ok((await rv.locator("h2").textContent()) === "Die Einheit muss wegen unterrichtsfreier Tage überarbeitet werden" && (await rv.textContent()).includes("Unterrichtsfrei: Herbstferien (" + freeRangeText({ from: D(7), to: D(11) }) + ")")
    && !(await rv.textContent()).includes("krank") && await rv.getByRole("button", { name: "Einheit mit Claude überarbeiten" }).count() === 1 && await rv.getByRole("button", { name: /rückgängig/ }).count() === 0,
    "Gymnasium: Hinweis „… wegen unterrichtsfreier Tage überarbeitet werden“ mit „Einheit mit Claude überarbeiten“ (ohne „krank“, ohne Rückgängig)");
  const shotUnit = async (name) => { if (!shots) return; await p.locator(".revisebox").scrollIntoViewIfNeeded(); await p.screenshot({ path: join(shots, name + "-laptop-light.png"), fullPage: false });
    await p.locator(".fd-unit").scrollIntoViewIfNeeded(); await p.locator(".card", { hasText: "1. Rahmendaten der Einheit" }).screenshot({ path: join(shots, name + "-rahmendaten-laptop-light.png") }); };
  await shotUnit("einheit-gym");
  await rv.getByRole("button", { name: "Einheit mit Claude überarbeiten" }).click();
  const cm = p.locator(".modal", { hasText: "Einheit nach unterrichtsfreien Tagen überarbeiten" }); await cm.waitFor({ timeout: 10000 });
  await cm.getByRole("button", { name: "Prompt kopieren" }).click();
  const prompt = await p.evaluate(() => navigator.clipboard.readText());
  ok(prompt.includes("an einem Gymnasium in Hessen") && prompt.includes("Wegen unterrichtsfreier Tage (Herbstferien: " + fmtDay(D(7)) + "–" + fmtDay(D(11)) + ") hat Unterricks die betroffenen und alle folgenden Stunden der Einheit " + gym.id)
    && prompt.includes("ohne Termin: Stunde 5 „Übung 5“, Stunde 6 „Abschluss 6“") && prompt.includes("extend_unit") && prompt.includes("update_unit_row") && !prompt.includes("krank"),
    "Prompt fürs Gymnasium: welche Tage frei wurden, Stunden ohne Termin, Möglichkeiten (Zusammenlegen, Kürzen, extend_unit nur nach Zustimmung)");
  await p.keyboard.press("Escape"); await cm.waitFor({ state: "detached", timeout: 5000 });
  // Sitzungen des Gymnasiums nach dem Verschieben: neues Datum, derselbe Hinweis zum Überarbeiten mit „Zur Einheit“; ohne Termin als Chip; Liste der Klasse mit ihnen am Ende
  await p.goto(BASE + "/#/lk/s/" + byRow(g1, 2).id); await p.locator(".revisebox").waitFor({ timeout: 15000 });
  ok((await p.locator(".pagehead .chip").allTextContents()).includes(fmtDay(D(14))) && (await p.locator(".revisebox h2").textContent()) === "Die Einheit muss wegen unterrichtsfreier Tage überarbeitet werden"
    && await p.locator(".revisebox").getByRole("link", { name: "Zur Einheit" }).getAttribute("href") === "#/lk/u/" + gym.id
    && await p.evaluate(() => document.querySelector(".revisebox").nextElementSibling.classList.contains("claudeplan")),
    "Sitzung (Gymnasium, verschoben): neues Datum " + fmtDay(D(14)) + ", Hinweis zum Überarbeiten vor „Stunde mit Claude planen“ mit „Zur Einheit“");
  await p.goto(BASE + "/#/lk/s/" + byRow(g1, 4).id); await p.locator(".revisebox").waitFor({ timeout: 15000 });
  ok((await p.locator(".pagehead .chip").allTextContents()).includes("ohne Termin") && await p.locator('input[aria-label="Datum der Sitzung"]').inputValue() === "", "Sitzung (Gymnasium) ohne Termin: Chip „ohne Termin“");
  await p.goto(BASE + "/#/lk/f/powi/8A"); await p.locator(".unit-card .item").first().waitFor({ timeout: 15000 });
  ok(JSON.stringify(await p.locator(".unit-card .item .name").allTextContents()) === JSON.stringify(gym.rows.map((r) => r.stundenfrage)) && await p.locator(".unit-card .badge", { hasText: "überarbeiten" }).count() === 1,
    "Klasse 8A: Sitzungen in der Reihenfolge der Einheit (ohne Termin am Ende), Abzeichen „überarbeiten“");
  await p.goto(BASE + "/#/lk/u/" + gym.id); await p.locator(".revisebox").waitFor({ timeout: 15000 });
  // Datum in der Tabelle auf einen freien Tag → Meldung, Datum bleibt; Server lehnt ebenfalls ab
  const di = p.locator('input[aria-label="Datum Stunde 1"]');
  await di.fill(D(8)); await di.dispatchEvent("change");
  await p.locator(".toast", { hasText: "Stunde 1: Am " + fmtDay(D(8)) + " ist unterrichtsfrei (Herbstferien, beide Schulen). Bitte einen anderen Tag wählen." }).waitFor({ timeout: 10000 });
  ok(await di.inputValue() === M, "Tabelle: ein Datum auf einem unterrichtsfreien Tag wird mit Meldung abgelehnt (Datum bleibt)");
  const patchRows = (await T("PATCH", "/api/teacher/units/" + gym.id, { rows: g1.rows.map((r, i) => (i === 0 ? { ...r, date: D(9) } : r)) }));
  ok(patchRows.status === 400 && patchRows.data.error === "Stunde 1: Am " + fmtDay(D(9)) + " ist unterrichtsfrei (Herbstferien, beide Schulen). Bitte einen anderen Tag wählen.", "Server: Tabelle mit neuem Datum auf einem freien Tag → 400 mit derselben Meldung");
  // Sitzung: Datum auf einen freien Tag → Meldung (Browser und Server); für die Grundschule ist der Pädagogische Tag (nur Gymnasium) erlaubt
  await p.goto(BASE + "/#/lk/s/" + lessonOn(gym, M).id); await p.locator('input[aria-label="Datum der Sitzung"]').waitFor({ timeout: 15000 });
  await p.locator('input[aria-label="Datum der Sitzung"]').fill(D(2)); await p.locator('input[aria-label="Datum der Sitzung"]').dispatchEvent("change");
  await p.locator(".toast", { hasText: "Am " + fmtDay(D(2)) + " ist unterrichtsfrei (Pädagogischer Tag, Gymnasium). Bitte einen anderen Tag wählen." }).waitFor({ timeout: 10000 });
  ok(await p.locator('input[aria-label="Datum der Sitzung"]').inputValue() === M, "Sitzung (Gymnasium): Datum am Pädagogischen Tag abgelehnt, Datum bleibt");
  const gsL = byRow(s1, 0);
  const okGs = await T("PATCH", "/api/teacher/lessons/" + gsL.id, { date: D(2) }), badGs = await T("PATCH", "/api/teacher/lessons/" + gsL.id, { date: D(9) });
  ok(okGs.status === 200 && badGs.status === 400 && badGs.data.code === "free_day" && badGs.data.error.includes("Herbstferien, beide Schulen"),
    "Server: Grundschul-Sitzung am Pädagogischen Tag des Gymnasiums erlaubt, in den Herbstferien abgelehnt");
  await T("PATCH", "/api/teacher/lessons/" + gsL.id, { date: D(1) });
  // Grundschule: roter Kasten mit dem Grund „unterrichtsfrei“
  await p.goto(BASE + "/#/lk/u/" + gs.id); await p.locator(".revisebox").waitFor({ timeout: 15000 });
  const rvs = await p.locator(".revisebox").textContent();
  ok(rvs.includes("Die Einheit muss wegen unterrichtsfreier Tage überarbeitet werden") && rvs.includes("Unterrichtsfrei: Herbstferien") && !rvs.includes("Ausgefallen") && !rvs.includes("krank")
    && (await p.locator(".fd-unit").textContent()).includes("Unterrichtsfreie Tage der Grundschule") && !(await p.locator(".fd-unit").textContent()).includes("Pädagogischer Tag"),
    "Grundschule: roter Kasten „… wegen unterrichtsfreier Tage …“ (nicht „Ausgefallen“), Rahmendaten nur mit den Tagen der Grundschule");
  await shotUnit("einheit-gs");
  // Bearbeiten: die Rückfrage nennt nur, was neu dazukommt (Donnerstag für beide Schulen → die Grundschulstunde); nur die Bezeichnung → sofort gespeichert
  await p.goto(BASE + "/#/lk/einstellungen"); await card.locator(".fd-item").first().waitFor({ timeout: 15000 });
  await card.getByRole("button", { name: "„Pädagogischer Tag“ bearbeiten" }).click();
  ok(await p.evaluate(() => document.activeElement.id) === "fd-label" && (await card.locator("#fd-form-h").textContent()) === "Eintrag bearbeiten: Pädagogischer Tag"
    && await card.locator("#fd-from").inputValue() === D(2) && await card.locator("#fd-scope-gym").isChecked(), "Bearbeiten: Formular mit dem Eintrag, Fokus in der Bezeichnung");
  await card.locator("#fd-to").fill(D(3)); await card.locator("#fd-scope-both").check();
  await card.getByRole("button", { name: "Änderungen speichern" }).click();
  await dlg.waitFor({ timeout: 15000 });
  const rowsE = await dlg.locator("tbody tr").allTextContents();
  ok(rowsE.length === 1 && rowsE[0].includes(fmtDay(D(3))) && rowsE[0].includes("Religion 2ab") && (await dlg.locator("p").first().textContent()).includes("beide Schulen"),
    "Bearbeiten (Zeitraum und Schule erweitert): Rückfrage nur zur neu betroffenen Grundschulstunde am " + fmtDay(D(3)));
  await dlg.getByRole("button", { name: "Abbrechen" }).click();
  ok((await card.locator("#fd-form-h").textContent()) === "Eintrag bearbeiten: Pädagogischer Tag" && (await T("GET", "/api/teacher/free-days")).data.freeDays.find((f) => f.label === "Pädagogischer Tag").to === D(2),
    "Abbrechen: nichts geändert, das Formular bleibt beim Bearbeiten");
  await card.locator("#fd-cancel").click();
  ok((await card.locator("#fd-form-h").textContent()) === "Unterrichtsfreien Tag eintragen" && await card.locator("#fd-label").inputValue() === "", "„Abbrechen“ im Formular: zurück zum leeren Formular");
  for (const [from, to] of [["Pädagogischer Tag", "Pädagogischer Tag (Fortbildung)"], ["Pädagogischer Tag (Fortbildung)", "Pädagogischer Tag"]]) {
    await card.getByRole("button", { name: "„" + from + "“ bearbeiten" }).click();
    await card.locator("#fd-label").fill(to);
    await card.getByRole("button", { name: "Änderungen speichern" }).click();
    await card.locator(".fd-status", { hasText: "„" + to + "“ geändert." }).waitFor({ timeout: 15000 });
  }
  ok(await dlg.count() === 0 && (await T("GET", "/api/teacher/free-days")).data.freeDays.some((f) => f.label === "Pädagogischer Tag" && f.scope === "gym"), "nur die Bezeichnung geändert: ohne Rückfrage gespeichert");
  // Löschen: Bestätigung, danach wieder Unterrichtstag – nichts rückt zurück
  await card.getByRole("button", { name: "„Pädagogischer Tag“ löschen" }).click();
  const del = p.locator(".modal", { hasText: "Unterrichtsfreien Eintrag löschen" }); await del.waitFor();
  ok((await del.textContent()).includes("Schon verschobene Sitzungen bleiben, wo sie sind."), "Löschen fragt nach – verschobene Sitzungen bleiben");
  await del.getByRole("button", { name: "Löschen" }).click();
  await card.locator(".fd-status", { hasText: "„Pädagogischer Tag“ gelöscht." }).waitFor({ timeout: 10000 });
  fd = (await T("GET", "/api/teacher/free-days")).data.freeDays;
  const g2 = (await T("GET", "/api/teacher/units/" + gym.id)).data.unit, wedL = (await T("GET", "/api/teacher/lessons/" + wed.id)).data.lesson;
  ok(fd.length === 1 && fd[0].label === "Herbstferien" && dates(g2) === dates(g1) && wedL.date === D(2) && wedL.freeDay === null && g2.slots.some((s) => s.date === D(2)),
    "gelöscht: der Tag ist wieder ein Unterrichtstag, keine Sitzung rückt zurück, die Markierung ist weg");
  ok((await T("POST", "/api/teacher/free-days", { label: "x", from: D(3), to: D(2), scope: "gs" })).data.error === "„Bis“ darf nicht vor „Von“ liegen."
    && (await T("POST", "/api/teacher/free-days", { label: "Ferien", from: D(3), scope: "alle" })).status === 400, "Server prüft Zeitraum und Schule");
  // Bildschirmfotos: Einstellungen, Kalender, Einheit – iPad hochkant und Handy, hell und dunkel
  if (shots) {
    await T("POST", "/api/teacher/free-days", { label: "Pädagogischer Tag", from: D(2), to: D(2), scope: "gym", shift: false });
    for (const scheme of ["light", "dark"]) for (const [vn, vp, touch] of [["laptop", { width: 1440, height: 950 }, false], ["ipad", { width: 810, height: 1080 }, true], ["handy", { width: 390, height: 844 }, true], ["handy-se", { width: 320, height: 568 }, true]]) {
      const c = await ctxFor(vp, scheme, { hasTouch: touch }), q = await c.newPage(); watch(q, "Bildschirmfotos " + vn);
      const over = async (what) => { if (await q.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) ok(false, vn + " " + scheme + ": seitliches Scrollen auf " + what); };
      await q.goto(BASE + "/#/lk/einstellungen"); await q.locator("#freedays .fd-item").first().waitFor({ timeout: 15000 });
      await q.locator("#freedays").screenshot({ path: join(shots, "einstellungen-" + vn + "-" + scheme + ".png") }); await over("Einstellungen");
      await q.locator("#freedays").getByRole("button", { name: "Eintragen" }).click(); await q.waitForTimeout(150);
      await q.locator("#freedays .fd-form").screenshot({ path: join(shots, "formular-fehler-" + vn + "-" + scheme + ".png") });
      await q.locator("#fd-label").fill("Brückentag"); await q.locator("#fd-from").fill(D(16)); await q.locator("#fd-from").dispatchEvent("change"); await q.locator("#fd-scope-both").check();
      await q.locator("#freedays").getByRole("button", { name: "Eintragen" }).click(); await q.locator(".modal", { hasText: "Sitzungen an unterrichtsfreien Tagen" }).waitFor({ timeout: 15000 });
      await q.waitForTimeout(200); await q.screenshot({ path: join(shots, "dialog-" + vn + "-" + scheme + ".png") }); await over("Rückfrage");
      await q.locator(".modal").getByRole("button", { name: "Abbrechen" }).click();
      await q.goto(BASE + "/#/lk"); await q.locator(".weekcal .wk-ev").first().waitFor({ timeout: 20000 }); await q.waitForTimeout(300);
      await q.locator(".weekcal").screenshot({ path: join(shots, "kalender-eine-schule-" + vn + "-" + scheme + ".png") }); await over("Kalender");
      await q.locator(".weekcal").getByRole("button", { name: "Nächste Woche" }).click(); await q.waitForTimeout(300);
      await q.locator(".weekcal").screenshot({ path: join(shots, "kalender-beide-schulen-" + vn + "-" + scheme + ".png") });
      for (const [u, n] of [[gym, "gym"], [gs, "gs"]]) {
        await q.goto(BASE + "/#/lk/u/" + u.id); await q.locator(".revisebox").waitFor({ timeout: 15000 }); await q.waitForTimeout(200);
        await q.locator(".revisebox").screenshot({ path: join(shots, "hinweis-" + n + "-" + vn + "-" + scheme + ".png") });
        await q.locator(".card", { hasText: "1. Rahmendaten der Einheit" }).screenshot({ path: join(shots, "rahmendaten-" + n + "-" + vn + "-" + scheme + ".png") }); await over("Einheit " + n);
      }
      await q.goto(BASE + "/#/lk/s/" + wed.id); await q.locator(".chip.freechip").waitFor({ timeout: 15000 });
      await q.screenshot({ path: join(shots, "sitzung-" + vn + "-" + scheme + ".png") });
      await c.close();
    }
  }
  await ctx.close();
  return { gym, gs, course };
}
