// printtoday.mjs – End-to-End-Prüfung „Druckaufträge bis zum Ende der jeweiligen Sitzung“ (Nachtrag 33): Das Feld „Druckaufträge“ zeigt neben dem
// nächsten Arbeitstag die Sitzungen von heute, bis ihr geplantes Ende (Beginn + Dauer) erreicht ist; der rote Kasten „… einpacken“ folgt derselben Regel.
// Der Server entscheidet mit seiner eigenen Uhr – deshalb hier mit echter Zeit: zwei Sitzungen von heute (Gymnasium PoWi 8A und Grundschule Religion 2ab),
// deren Ende erst in einigen Minuten liegt (zwei Tagesabschnitte, je Tag „Alle Dateien herunterladen“, Gegenstände je Tag, Bildschirmfotos), dann enden
// sie kurz nacheinander, während die Seite offen ist: ihre Einträge verschwinden ohne Neuladen der Seite, der Fokus bleibt auf einem Knopf von morgen
// bzw. geht von einem verschwundenen Eintrag an die Überschrift; danach nur noch der nächste Arbeitstag (wie bisher). Läuft nach dem Zurücksetzen (keine
// anderen Sitzungen); am Ende ist alles gelöscht. Frei erfundene Inhalte, ASCII-Dateinamen. Bildschirmfotos 1366/820/390 px, hell und dunkel, in OUT
// („druckauftraege-heute-*.png“, „einpacken-heute-*.png“).
// ctx = {tp (Seite der Lehrkraft, angemeldet), BASE, T (Fetch mit Anmeldung), token, ok, OUT, SHOT, gsId (Grundschulkurs Religion 2ab), horizontalIssues}
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { berlinToday, fmtClockBerlin, daysBetween } from "../../public/shared.js";
import { nextWorkday } from "../../public/planning.js";

const a4 = async (label) => { const d = await PDFDocument.create(); d.addPage([595.28, 841.89]).drawText(label, { x: 50, y: 760, size: 20 }); return Buffer.from(await d.save()); };
const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const longDay = (d) => DAYS[new Date(d + "T12:00:00Z").getUTCDay()] + ", " + d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function printTodayE2E({ tp, BASE, T, token, ok, OUT, SHOT, gsId, horizontalIssues }) {
  const today = berlinToday(), cand = nextWorkday(today), wd = new Date(cand + "T12:00:00Z").getUTCDay();
  // Beginn so, dass das Ende (Beginn + 45 Minuten) min Minuten nach jetzt liegt; null, wenn Beginn oder Ende nicht mehr heute wären (kurz nach Mitternacht bzw. spät abends)
  const slot = (min) => { const end = Math.ceil((Date.now() + min * 60e3) / 60e3) * 60e3, start = end - 45 * 60e3;
    return berlinToday(start) === today && berlinToday(end) === today ? { start: fmtClockBerlin(start), end } : null; };
  const a0 = slot(20), b0 = slot(21);
  if (!a0 || !b0) { console.log("  – übersprungen: zu nah an Mitternacht (Ende einer Sitzung von heute läge morgen)"); return; }
  const made = [];
  const oneLesson = async (subject, klass, title) => {
    const u = (await T("POST", "/api/teacher/units", { subject, klass, title, params: { start: cand, end: cand, weekdays: [{ day: wd, minutes: 45, time: "08:00" }] } })).data.unit;
    await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: title, lernaufgabe: "Lernaufgabe: " + title }, rows: [{ stundenfrage: title, ablauf: ["Einstieg"], date: cand, time: "08:00", minutes: 45 }] });
    const l = (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit.lessons[0].id;
    made.push({ u: u.id, l });
    return l;
  };
  const up = async (path, label) => (await fetch(BASE + path, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/pdf" }, body: await a4(label) })).json();
  // heute: PoWi 8A (Druckvorlage, Gegenstand „Bibel“) und Grundschule Religion 2ab (Druckvorlage + Arbeitsblatt mit „Auch ausdrucken“); morgen: Ethik 10C (Gegenstand „Beutel“)
  const A = await oneLesson("powi", "8A", "Heute zuerst"), B = await oneLesson("gs", gsId, "Heute danach"), C = await oneLesson("ethik", "10C", "Morgen");
  await T("PATCH", "/api/teacher/lessons/" + A, { date: today, startTime: a0.start, bring: [{ item: "Bibel", note: "Zum Vorlesen in Phase 2 der 8A." }] });
  await T("PATCH", "/api/teacher/lessons/" + B, { date: today, startTime: b0.start });
  await T("PATCH", "/api/teacher/lessons/" + C, { bring: [{ item: "Beutel", note: "Mit Losen im Einstieg der 10C." }] });
  await up("/api/teacher/lessons/" + A + "/print?copies=3&duplex=0&name=" + encodeURIComponent("AB Heute.pdf"), "AB Heute");
  await up("/api/teacher/lessons/" + B + "/print?copies=22&duplex=0&name=" + encodeURIComponent("Ausmalbild Heute.pdf"), "Ausmalbild Heute");
  const kid = (await up("/api/teacher/lessons/" + B + "/files?area=student&name=" + encodeURIComponent("Arbeitsblatt Heute.pdf"), "Arbeitsblatt Heute")).file;
  await T("PATCH", "/api/teacher/files/" + kid.id, { copies: 22 });
  await up("/api/teacher/lessons/" + C + "/print?copies=1&duplex=0&name=" + encodeURIComponent("Folie Morgen.pdf"), "Folie Morgen");
  const TODAY_NAMES = ["3x - sw - einseitig - PoWi8 - AB Heute.pdf", "22x - sw - einseitig - Reli2 - Ausmalbild Heute.pdf", "22x - sw - beidseitig - Reli2 - Arbeitsblatt Heute.pdf"];
  const NEXT_NAME = "1x - sw - einseitig - Eth10 - Folie Morgen.pdf";

  // Server: heute beide Sitzungen (mit geplantem Ende), daneben der nächste Arbeitstag; neu laden zum ersten Ende
  let pn = (await T("GET", "/api/teacher/print-next")).data;
  ok(pn.today === today && pn.date === cand && JSON.stringify(pn.todaySessions.map((s) => s.id)) === JSON.stringify([A, B]) && pn.todaySessions[0].endsAt === a0.end
    && pn.refreshAt === a0.end && JSON.stringify(pn.sessions.map((s) => s.id)) === JSON.stringify([C]) && Math.abs(pn.now - Date.now()) < 60e3,
    "GET /api/teacher/print-next: heute " + today + " beide Sitzungen bis zu ihrem Ende (" + a0.start + " + 45 Min.), daneben " + cand + "; refreshAt = erstes Ende");

  // Startseite: zwei Tagesabschnitte, Titel nennt heute, Sitzungen eine Ebene tiefer
  const card = tp.locator(".printnext"), pack = tp.locator("#packnext");
  const dayG = (d) => card.locator('.pn-dayg[data-day="' + d + '"]'), group = (l) => card.locator(".pn-group", { has: tp.locator('a[href="#/lk/s/' + l + '"]') });
  await tp.goto(BASE + "/#/lk"); await tp.reload();   // die Seite steht womöglich schon auf #/lk – derselbe Hash lädt nicht neu
  await dayG(today).waitFor({ timeout: 20000 });
  const nextHead = (daysBetween(today, cand) === 1 ? "Morgen, " : "") + longDay(cand);
  const want = (daysBetween(today, cand) === 1 ? "morgen, " : "") + longDay(cand);
  ok(await card.locator("#pn-h").textContent() === "Druckaufträge für heute und den nächsten Arbeitstag" && await card.locator("#pn-day").textContent() === "Heute bis zum Ende der jeweiligen Sitzung, dazu für " + want
    && JSON.stringify(await card.locator(".pn-dayg > .pn-dhead h3").allTextContents()) === JSON.stringify(["Heute, " + longDay(today), nextHead])
    && JSON.stringify(await dayG(today).locator(".pn-group h4").allTextContents()) === JSON.stringify([a0.start + "–" + fmtClockBerlin(a0.end) + " PoWi 8A – Heute zuerst", b0.start + "–" + fmtClockBerlin(b0.end) + " Grundschule Religion 2ab – Heute danach"])
    && await card.locator(".pn-head .pn-all").isHidden(),
    "Startseite: „Druckaufträge für heute und den nächsten Arbeitstag“, Abschnitte „Heute, " + longDay(today) + "“ und „" + nextHead + "“, heute mit geplantem Ende");
  const tNames = await dayG(today).locator(".pn-row .name").allTextContents();
  ok(JSON.stringify(tNames) === JSON.stringify(TODAY_NAMES) && JSON.stringify(await dayG(cand).locator(".pn-row .name").allTextContents()) === JSON.stringify([NEXT_NAME]),
    "je Tag die Druck-Namen (Nachtrag 32): " + tNames.join(" | ") + " || " + NEXT_NAME);
  // roter Kasten: je Tag beschriftet
  await pack.locator(".pk-dayg").first().waitFor({ timeout: 10000 });
  ok(await pack.locator("#pk-h").textContent() === "Für heute und den nächsten Arbeitstag einpacken"
    && JSON.stringify(await pack.locator(".pk-dayg h3").allTextContents()) === JSON.stringify(["Heute, " + longDay(today), nextHead])
    && JSON.stringify(await pack.locator('.pk-dayg[data-day="' + today + '"] button.pk-item').allTextContents()) === JSON.stringify(["Bibel"])
    && JSON.stringify(await pack.locator('.pk-dayg[data-day="' + cand + '"] button.pk-item').allTextContents()) === JSON.stringify(["Beutel"]),
    "roter Kasten „Für heute und den nächsten Arbeitstag einpacken“: „Bibel“ unter heute, „Beutel“ unter " + nextHead);
  // Bildschirmfotos: Feld und Kasten, Laptop, iPad hochkant, Handy – hell und dunkel; am Handy ohne seitliches Schieben
  await pack.getByRole("button", { name: "Bibel" }).click();
  const vp0 = tp.viewportSize();
  for (const [w, hh] of [[1366, 900], [820, 1180], [390, 844]]) for (const dark of [false, true]) {
    await tp.setViewportSize({ width: w, height: hh }); await tp.emulateMedia({ colorScheme: dark ? "dark" : "light" }); await tp.waitForTimeout(250);
    // ganze Seite, auf das Feld bzw. den Kasten zugeschnitten (ein Bildschirmfoto des Elements schöbe es unter die feste Kopfleiste)
    await tp.evaluate(() => window.scrollTo(0, 0));
    for (const [sel, name] of [[".printnext", "druckauftraege-heute"], ["#packnext", "einpacken-heute"]]) {
      const b = await tp.locator(sel).first().boundingBox();
      await tp.screenshot({ ...SHOT, fullPage: true, path: join(OUT, name + "-" + w + (dark ? "-dunkel" : "") + ".png"), clip: { x: 0, y: Math.max(0, b.y - 10), width: w, height: b.height + 20 } });
    }
    if (w < 400 && !dark) { const hi = (await horizontalIssues(tp)).issues; ok(!hi.length, "zwei Tage am Handy (390 px): ohne seitliches Schieben" + (hi.length ? " – " + JSON.stringify(hi).slice(0, 200) : "")); }
  }
  await tp.emulateMedia({ colorScheme: "light" }); await tp.setViewportSize(vp0);
  await pack.getByRole("button", { name: "Bibel" }).click();

  // „Alle Dateien herunterladen“ je Tag: heute genau die Dateien von heute (Grundschule: vorher neu geladen), mit den Druck-Namen; keine ZIP-Datei
  const got = [], onDl = (d) => got.push(d), reqs = [], onReq = (r) => { if (r.url().includes("/api/teacher/print-next")) reqs.push(r.url()); };
  tp.on("download", onDl); tp.on("request", onReq);
  const todayBtn = dayG(today).locator("button.pn-all");
  ok(await todayBtn.getAttribute("aria-label") === "Alle Dateien herunterladen – Heute, " + longDay(today) && (await todayBtn.textContent()).trim() === "Alle Dateien herunterladen",
    "Knopf je Tag: sichtbarer Text „Alle Dateien herunterladen“, Name mit dem Tag");
  await todayBtn.click();
  await dayG(today).locator(".pn-status", { hasText: /^Fertig/ }).waitFor({ timeout: 60000 });
  await sleep(500);
  tp.off("download", onDl); tp.off("request", onReq);
  const names = got.map((d) => d.suggestedFilename()), heads = await Promise.all(got.map(async (d) => readFileSync(await d.path()).subarray(0, 5).toString()));
  ok(JSON.stringify(names) === JSON.stringify(TODAY_NAMES) && heads.every((x) => x === "%PDF-") && reqs.length >= 1 && (await dayG(cand).locator(".pn-status").textContent()) === ""
    && (await dayG(today).locator(".pn-status").textContent()) === "Fertig: Alle 3 Dateien sind einzeln heruntergeladen.",
    "„Alle Dateien herunterladen“ (heute): nur die 3 Dateien von heute, einzeln (" + names.join(" | ") + "); Grundschule: vorher neu geladen (" + reqs.length + "×)");

  // live: die Sitzungen enden kurz nacheinander, während die Seite offen ist (Server-Uhr); Ende in gut einer bzw. zwei Minuten
  const a1 = slot(1.2), b1 = a1 && { start: fmtClockBerlin(a1.end + 60e3 - 45 * 60e3), end: a1.end + 60e3 };
  if (!a1 || berlinToday(b1.end) !== today) { console.log("  – übersprungen (live): zu nah an Mitternacht"); }
  else {
    await T("PATCH", "/api/teacher/lessons/" + A, { startTime: a1.start });
    await T("PATCH", "/api/teacher/lessons/" + B, { startTime: b1.start });
    await tp.reload();
    await group(A).waitFor({ timeout: 20000 });
    await tp.evaluate(() => { window.__pnMarker = 33; });
    // zweites Gerät, das „schläft“ (Prüfung von Nachtrag 33): Uhr angehalten, kein Zeitgeber läuft ab; beim Aufwachen ist das Netz noch nicht da
    const sctx = await tp.context().browser().newContext({ storageState: await tp.context().storageState(), viewport: { width: 1366, height: 900 } });
    const sp = await sctx.newPage(), sErr = [];
    sp.on("pageerror", (e) => sErr.push(e.message));
    await sp.clock.install();
    await sp.goto(BASE + "/#/lk");
    const sCard = sp.locator(".printnext"), sGroup = (l) => sCard.locator(".pn-group", { has: sp.locator('a[href="#/lk/s/' + l + '"]') });
    await sGroup(A).waitFor({ timeout: 20000 });
    await sp.clock.pauseAt(Date.now() + 1000);
    // Fokus auf „Herunterladen“ der Datei von morgen
    const cBtn = group(C).getByRole("button", { name: "Herunterladen – " + NEXT_NAME });
    await cBtn.focus();
    const left = a1.end - Date.now();
    await group(A).waitFor({ state: "detached", timeout: left + 60000 });
    const late = Date.now() - a1.end;
    ok(await tp.evaluate(() => window.__pnMarker) === 33 && await cBtn.evaluate((el) => el === document.activeElement) && await group(B).count() === 1
      && await card.locator("#pn-h").textContent() === "Druckaufträge für heute und den nächsten Arbeitstag" && late >= 0 && late < 15000,
      "um " + fmtClockBerlin(a1.end) + " Uhr (Ende der 8A) verschwindet ihr Eintrag ohne Neuladen der Seite (" + Math.round(late / 1000) + " s nach dem Ende); Fokus bleibt auf dem Knopf von morgen, die Grundschul-Stunde bleibt");
    // das „schlafende“ Gerät wacht auf (Uhr springt, ohne Zeitgeber), das Netz fehlt noch: die Druckaufträge bleiben stehen (keine Fehlermeldung statt der Liste);
    // sobald das Netz wieder da ist („online“), verschwindet die beendete Stunde
    const sAll = sp.locator('.pn-dayg[data-day="' + cand + '"] button.pn-all');
    await sAll.focus();
    const stillA = await sGroup(A).count() === 1;
    let aborted = 0;
    await sp.route("**/api/teacher/print-next", (rt) => { aborted++; return rt.abort("internetdisconnected"); });
    await sp.clock.setSystemTime(Date.now());
    await sp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    for (let i = 0; i < 40 && !aborted; i++) await sleep(100);
    await sleep(500);
    ok(stillA && aborted >= 1 && await sCard.locator(".pn-err").count() === 0 && await sGroup(A).count() === 1 && await sGroup(B).count() === 1
      && await sAll.evaluate((el) => el === document.activeElement) && await sp.locator("#packnext .pk-dayg").count() === 2,
      "Ruhezustand: beim Aufwachen ohne Netz (" + aborted + "× abgebrochen) bleiben Feld, roter Kasten und Fokus stehen – keine Fehlermeldung statt der Druckaufträge");
    await sp.unroute("**/api/teacher/print-next");
    await sp.evaluate(() => window.dispatchEvent(new Event("online")));
    await sGroup(A).waitFor({ state: "detached", timeout: 15000 });
    ok(await sGroup(B).count() === 1 && await sCard.locator(".pn-err").count() === 0 && await sAll.evaluate((el) => el === document.activeElement) && !sErr.length,
      "Netz wieder da („online“): die beendete 8A verschwindet ohne Neuladen, die Grundschul-Stunde bleibt, Fokus bleibt auf „Alle Dateien herunterladen“ von morgen" + (sErr.length ? " – " + sErr.join(" | ") : ""));
    await sctx.close();
    // roter Kasten: heute ohne Gegenstände → wie bisher nur der nächste Arbeitstag
    ok(await pack.locator("#pk-h").textContent() === "Für den nächsten Arbeitstag einpacken" && await pack.locator(".pk-dayg").count() === 0
      && JSON.stringify(await pack.locator("button.pk-item").allTextContents()) === JSON.stringify(["Beutel"]) && await pack.locator("#pk-day").textContent() === "für " + want,
      "roter Kasten folgt: „Bibel“ (8A, vorbei) weg, nur noch „Beutel“ für " + nextHead);
    // Fokus in der Zeile der Grundschul-Stunde – sie endet: Fokus an die Überschrift des Feldes; danach nur noch der nächste Arbeitstag (wie bisher)
    await group(B).locator(".pn-row button").first().focus();
    await group(B).waitFor({ state: "detached", timeout: b1.end - Date.now() + 60000 });
    await tp.waitForTimeout(300);
    ok(await tp.evaluate(() => window.__pnMarker) === 33 && await card.locator("#pn-h").evaluate((el) => el === document.activeElement)
      && await card.locator(".pn-dayg").count() === 0 && await card.locator("#pn-h").textContent() === "Druckaufträge für den nächsten Arbeitstag"
      && await card.locator("#pn-day").textContent() === "für " + want && JSON.stringify(await card.locator(".pn-group h3").allTextContents()) === JSON.stringify(["08:00 Ethik 10C – Morgen"])
      && await card.locator(".pn-head .pn-all").isVisible() && await card.locator(".pn-head .pn-all").getAttribute("data-day") === cand,
      "nach der letzten Stunde von heute: nur noch " + nextHead + " (Titel und Aufbau wie bisher), Fokus vom verschwundenen Eintrag an die Überschrift, Seite nicht neu geladen");
    pn = (await T("GET", "/api/teacher/print-next")).data;
    ok(pn.todaySessions.length === 0 && pn.date === cand, "Server: heute keine laufende Sitzung mehr");
    // morgen herunterladen (Knopf im Kopf)
    const [dl] = await Promise.all([tp.waitForEvent("download", { timeout: 30000 }), card.locator(".pn-head .pn-all").click()]);
    await card.locator("#pn-status", { hasText: /^Fertig/ }).waitFor({ timeout: 30000 });
    ok(dl.suggestedFilename() === NEXT_NAME, "„Alle Dateien herunterladen“ für " + nextHead + ": „" + dl.suggestedFilename() + "“");
  }
  // aufräumen: Sitzungen, dann Einheiten
  for (const m of made) { await T("DELETE", "/api/teacher/lessons/" + m.l); await T("DELETE", "/api/teacher/units/" + m.u); }
  pn = (await T("GET", "/api/teacher/print-next")).data;
  ok(pn.todaySessions.length === 0 && !pn.sessions.some((s) => made.some((m) => m.l === s.id)), "aufgeräumt: keine Sitzungen dieses Schritts mehr");
}
