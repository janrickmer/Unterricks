// selbstlernstop.mjs – End-to-End-Prüfung aus der Abschlussprüfung Nr. 27–30: Selbstlern-Phase (Nachtrag 29) im Zusammenspiel mit dem Zwischenstopp
// der vorigen Stunde (Anforderung 13, Nachtrag 26), der Hausaufgabe bis zur nächsten Stunde mit der Lehrkraft und den Gegenständen (Nachtrag 28).
// Eigener Test-Kurs PoWi 9G mit drei Sitzungen in der Vergangenheit (A mit Zwischenstopp → B wird Selbstlern-Phase → C wieder mit Lehrkraft), danach
// wieder gelöscht – so berührt der Schritt weder Druckaufträge noch Kalender oder Podcast der übrigen Prüfungen.
// ctx = {tp (Seite der Lehrkraft, angemeldet), BASE, T (Fetch mit Anmeldung), tool (Connector), ok, OUT, SHOT}
import { join } from "node:path";

export async function selbstlernStopE2E({ tp, BASE, T, tool, ok, OUT, SHOT }) {
  const { berlinToday, addDays, STOP_LINE } = await import("../../public/shared.js");
  const SL = await import("../../public/selbstlern.js");
  const t0 = berlinToday(), dA = addDays(t0, -30), dB = addDays(t0, -29), dC = addDays(t0, -28);
  const wd = (d) => new Date(d + "T12:00:00Z").getUTCDay();
  const u = (await T("POST", "/api/teacher/units", { subject: "powi", klass: "9G", title: "Gewaltenteilung (Test)", params: { start: dA, end: dC,
    weekdays: [...new Set([dA, dB, dC].map(wd))].map((day) => ({ day, minutes: 45, time: "10:00" })) } })).data.unit;
  await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: "Gewaltenteilung (Test)", lernaufgabe: "Positionspapier" }, rows: [
    { stundenfrage: "Was ist Macht?", ablauf: ["Karikatur", "Text M1"], date: dA, time: "10:00", minutes: 45 },
    { stundenfrage: "Wer kontrolliert die Macht?", ablauf: ["Rollenspiel"], date: dB, time: "10:00", minutes: 45 },
    { stundenfrage: "Ist das Gericht zu mächtig?", ablauf: ["Diskussion"], date: dC, time: "10:00", minutes: 45 }] });
  const ls = (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit.lessons;
  const [A, B, C] = [dA, dB, dC].map((d) => ls.find((l) => l.date === d));
  ok(A && B && C, "Test-Kurs PoWi 9G: drei Sitzungen (A, B, C)");
  await T("PUT", "/api/teacher/lessons/" + A.id + "/portal", { text: "**1) Karikatur**\n- Beschreiben\n" + STOP_LINE + "\n**2) Text M1**\n- ~~M1 Gewaltenteilung~~ lesen", force: true });
  await tool("save_schulportal_entry", { lesson_id: B.id, text: "**1) Rollenspiel**\n- Gerichte und Parlament" });
  await tool("update_lesson", { lesson_id: B.id, mitbringen: [{ gegenstand: "Grundgesetz", wofuer: "In Phase 1 (Rollenspiel) in der 9G." }] });

  // B (vor der Umstellung): Hinweis zum Zwischenstopp; der Selbstlern-Prompt fragt nach dem offenen Teil
  await tp.goto(BASE + "/#/lk/s/" + B.id);
  await tp.locator(".prevstop").waitFor({ timeout: 15000 });
  const state0 = await tp.locator("#prevstop-state").textContent();
  ok(state0.startsWith("Beim Planen mit Claude („Stunde mit Claude planen“)"), "B: Hinweis „letzte Stunde nicht vollständig beendet“ (noch normale Sitzung)");
  // die rechte Spalte (Sitzungscode, Sitzungsdaten, „Mitbringen“, „Ohne Lehrkraft“) ist höher als der Bildschirm: sie klebt nicht – sonst blieben
  // „Mitbringen“ und der Knopf zur Selbstlern-Phase bis zum Seitenende unsichtbar
  const sideH = await tp.evaluate(() => { const s = document.querySelector(".side"); return { pos: getComputedStyle(s).position, h: s.getBoundingClientRect().height }; });
  const vh = tp.viewportSize().height;
  await tp.getByRole("button", { name: SL.SELBSTLERN_BUTTON }).scrollIntoViewIfNeeded();
  const bb = await tp.getByRole("button", { name: SL.SELBSTLERN_BUTTON }).boundingBox();
  ok(sideH.pos === "static" && bb && bb.y >= 0 && bb.y + bb.height <= vh, "rechte Spalte der Sitzung (" + Math.round(sideH.h) + " px, Fenster " + vh + " px) klebt nicht: der Knopf zur Selbstlern-Phase lässt sich in den sichtbaren Bereich scrollen");
  await tp.getByRole("button", { name: SL.SELBSTLERN_BUTTON }).click();
  const hm = tp.locator(".modal", { hasText: "Welches Sprachmodell?" });
  await hm.waitFor();
  await hm.getByRole("button", { name: "Prompt kopieren" }).click();
  const prompt = await tp.evaluate(() => navigator.clipboard.readText());
  await hm.getByRole("button", { name: "Schließen", exact: true }).getByText("Schließen").click();
  ok(prompt.includes("Die vorige Sitzung „Was ist Macht?“ wurde nicht vollständig beendet (Zwischenstopp; Abschnitt „Vorige Stunde nicht vollständig beendet“ in `get_lesson`)") &&
    prompt.includes("frage mich, ob es als Station in diese Selbstlern-Phase kommt (`zwischenstopp` \"uebernehmen\") oder nicht (\"verzichten\")"),
    "Selbstlern-Prompt: Claude klärt zuerst den offenen Teil der vorigen Stunde (übernehmen als Station oder verzichten)");

  // Claude (simuliert): Entscheidung, dann Umstellung – beim Zurückkehren verschwindet der Hinweis (Entscheidung + Speichern, Nachtrag 26)
  ok(!(await tool("update_lesson", { lesson_id: B.id, zwischenstopp: "uebernehmen" })).isError, "Claude hält die Entscheidung fest (übernehmen)");
  const sv = await tool("save_selbstlern", { lesson_id: B.id, schulportal: "**1) Selbstlern-Phase**\n- Öffne die Sitzung in ~~Unterricks~~ und bearbeite die Stationen.",
    stationen: [{ titel: "Text M1 (offen aus der letzten Stunde)", typ: "aufgabe", anleitung: "Lies M1 und schreibe drei Sätze in dein Heft.", minuten: 20 },
      { titel: "Rollenspiel als Dialog", typ: "aufgabe", anleitung: "Schreibe einen kurzen Dialog zwischen Gericht und Parlament.", minuten: 25 }] });
  ok(!sv.isError, "save_selbstlern stellt B um");
  await tp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await tp.locator(".prevstop").waitFor({ state: "detached", timeout: 15000 });
  const bTeacher = (await T("GET", "/api/teacher/lessons/" + B.id)).data;
  ok(bTeacher.previousStop && bTeacher.previousStop.settled === true, "beim Zurückkehren: Hinweis weg – save_selbstlern gilt als Planung dieser Sitzung (settled)");
  const absent = tp.locator("#bring-absent");
  await absent.waitFor({ timeout: 10000 });
  ok(/^Für diese Sitzung gilt eine Selbstlern-Phase: Sie sind nicht da – deshalb stehen diese Gegenstände nicht im roten Kasten der Startseite/.test(await absent.textContent()) && (await tp.locator("#bring-list").textContent()).includes("Grundgesetz"),
    "Karte „Mitbringen“: Hinweis, dass die Gegenstände in der Selbstlern-Phase nicht im roten Kasten stehen (Liste bleibt)");
  await tp.locator("#bring").scrollIntoViewIfNeeded();
  await tp.screenshot({ ...SHOT, path: join(OUT, "lehrkraft-selbstlern-mitbringen.png") });
  const um = await tool("update_lesson", { lesson_id: B.id, mitbringen: [{ gegenstand: "Grundgesetz", wofuer: "In Phase 1 (Rollenspiel) in der 9G." }] });
  ok(!um.isError && um.content[0].text.includes("– gespeichert; solange für diese Sitzung eine Selbstlern-Phase gilt (die Lehrkraft kommt nicht), zeigt Unterricks sie nicht auf der Startseite"),
    "update_lesson mit mitbringen in der Selbstlern-Phase: die Antwort sagt, dass die Startseite sie nicht zeigt");
  // Sitzung als Datei: der Hinweis sagt, welche Fassung darin steht
  const [dl] = await Promise.all([tp.waitForEvent("download"), tp.getByRole("button", { name: "Sitzung als Datei herunterladen" }).click()]);
  const note = tp.locator(".toast", { hasText: "Diese Sitzung ist eine Selbstlern-Phase: Die Datei enthält ihre jetzige Fassung" });
  await note.waitFor({ timeout: 15000 });
  ok(/\.zip$/.test(dl.suggestedFilename()) && (await note.textContent()).includes("Die ursprüngliche Planung kehrt mit „Wiederherstellen“ in der Sitzung zurück"),
    "Sitzung als Datei (Selbstlern-Phase): heruntergeladen, Hinweis nennt die Fassung und den Weg zur ursprünglichen Planung");

  // C: get_lesson nennt die Selbstlern-Phase davor und ihre jetzt fällige Hausaufgabe
  const gc = (await tool("get_lesson", { lesson_id: C.id })).content[0].text;
  ok(gc.includes("## Vorher ohne Lehrkraft: Selbstlern-Phase\nDie Sitzung direkt vor dieser war eine Selbstlern-Phase") &&
    gc.includes("(Sitzungs-ID " + B.id + "): Stationen 1. Text M1 (offen aus der letzten Stunde) (Arbeitsauftrag); 2. Rollenspiel als Dialog (Arbeitsauftrag) – Hausaufgabe: „" + SL.selbstlernHomework(dC) + "“") &&
    gc.includes("Frage die Lehrkraft, ob diese Stunde mit einer kurzen Besprechung"), "get_lesson der nächsten Stunde mit der Lehrkraft (C): Selbstlern-Phase davor, Stationen, Hausaufgabe mit dem Datum von C");
  ok(!(await tool("get_lesson", { lesson_id: B.id })).content[0].text.includes("## Vorher ohne Lehrkraft"), "get_lesson der Selbstlern-Sitzung selbst: kein solcher Abschnitt");

  // Wiederherstellen: die ursprüngliche Planung (vor der Entscheidung gespeichert) – der Hinweis gilt wieder, die Entscheidung bleibt
  await tp.getByRole("button", { name: "Wiederherstellen – zurück zur normalen Sitzung" }).click();
  const rdlg = tp.locator(".modal", { hasText: "Zurück zur normalen Sitzung?" });
  await rdlg.waitFor();
  await rdlg.getByRole("button", { name: "Wiederherstellen" }).click();
  await tp.locator(".toast", { hasText: "Wiederhergestellt" }).waitFor({ timeout: 20000 });
  await tp.locator(".prevstop").waitFor({ timeout: 15000 });
  ok((await tp.locator("#prevstop-state").textContent()).startsWith("Entschieden am ") && await tp.locator("#bring-absent").isHidden(),
    "nach „Wiederherstellen“: Hinweis wieder da (die ursprüngliche Planung kennt den offenen Teil nicht), Entscheidung bleibt; „Mitbringen“ ohne Hinweis");

  await T("DELETE", "/api/teacher/lessons/" + A.id); await T("DELETE", "/api/teacher/lessons/" + B.id); await T("DELETE", "/api/teacher/lessons/" + C.id);
  await T("DELETE", "/api/teacher/units/" + u.id);
  ok((await T("GET", "/api/teacher/units/" + u.id)).status === 404, "Test-Kurs PoWi 9G wieder gelöscht");
}
