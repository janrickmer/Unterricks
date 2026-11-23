// newer.mjs – End-to-End-Prüfung von Nachtrag 44 (Teil 2): Hinweis „Das ist nicht die aktuellste Sitzung“ in der Sitzung der Schüler:innen und der feste
// Text zur Eingabe des Sitzungscodes. Eigener Kurs PoWi 10D mit zwei Sitzungen – gestern 10:00 Uhr und heute später –, danach gelöscht (berührt weder
// Druckaufträge noch Kalender oder Podcast der übrigen Prüfungen). Geprüft: ohne spätere Sitzung kein Hinweis; die Lehrkraft startet die Live-Präsentation
// der späteren Sitzung (vor ihrem Beginn) → beim Aufwachen des Geräts erscheint der rote Hinweis ganz oben, ohne Neuladen der Seite; „Aktuellste Sitzung
// laden“ (Tastatur) → Eingabe des Sitzungscodes mit Fokus und festem Text; beginnt die spätere Sitzung in höchstens 30 Minuten, fragt die offene, sichtbare
// Seite jede Minute (newerSoon) – der Hinweis erscheint dann auch ohne Aufwachen; verschwindet er mit dem Fokus darin, geht der Fokus sichtbar auf die
// Überschrift (Gegenprüfung); laut Plan begonnen → Hinweis auch ohne Live-Präsentation; die Antwort des Servers nennt nie Code, Titel oder Kennung der
// späteren Sitzung; in der jüngsten Sitzung kein Hinweis. Kurz vor Mitternacht übersprungen (die spätere Sitzung muss heute liegen). Frei erfundene Inhalte.
// ctx = {browser, tp (Seite der Lehrkraft, angemeldet), BASE, T (Fetch mit Anmeldung), ok, OUT, SHOT, devices, watch}
import { join } from "node:path";

export async function newerE2E({ browser, tp, BASE, T, ok, OUT, SHOT, devices, watch = () => {} }) {
  const { berlinToday, addDays, plannedStart, CODE_WHERE_TEXT, NEWER_TITLE, NEWER_TEXT, NEWER_BUTTON, NEWER_RECHECK_MS, NEWER_POLL_MS } = await import("../../public/shared.js");
  const berlinAt = (ms) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value])); return { date: p.year + "-" + p.month + "-" + p.day, time: p.hour + ":" + p.minute }; };
  const today = berlinToday(), d1 = addDays(today, -1), wd = (d) => new Date(d + "T12:00:00Z").getUTCDay();
  // spätere Sitzung heute in 40 Minuten – sie muss heute liegen (sonst zählt ihre Live-Präsentation nicht) und darf während der Prüfung nicht beginnen:
  // weniger als eine Stunde vor Mitternacht (Berliner Zeit) wird übersprungen (Gegenprüfung: früher 23:59 Uhr als Rückfall – um 23:59 Uhr scheiterte „vor dem Beginn“)
  if (berlinAt(Date.now() + 60 * 60e3).date !== today) { console.log("  – übersprungen: zu nah an Mitternacht (die spätere Sitzung läge nicht mehr sicher heute)"); return; }
  const t2 = berlinAt(Date.now() + 40 * 60e3).time;
  const u = (await T("POST", "/api/teacher/units", { subject: "powi", klass: "10D", title: "Wahlen (aktuellste Sitzung)", params: { start: d1, end: today,
    weekdays: [...new Set([d1, today].map(wd))].map((day) => ({ day, minutes: 45, time: "10:00" })) } })).data.unit;
  await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: "Wahlen (aktuellste Sitzung)", lernaufgabe: "Wahlplakat" }, rows: [{ stundenfrage: "Wer darf wählen?", ablauf: ["Einstieg"], date: d1, time: "10:00", minutes: 45 },
    { stundenfrage: "Spätere Sitzung GEHEIMTITEL", ablauf: ["Einstieg"], date: today, time: t2, minutes: 45 }] });
  const ls = (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit.lessons;
  const L1 = ls.find((l) => l.date === d1), L2 = ls.find((l) => l.date === today);
  const l1 = (await T("GET", "/api/teacher/lessons/" + L1.id)).data.lesson, l2 = (await T("GET", "/api/teacher/lessons/" + L2.id)).data.lesson;
  ok(!!l1 && !!l2 && l2.startTime === t2, "Test-Kurs PoWi 10D: Sitzung 1 gestern 10:00 Uhr, Sitzung 2 heute " + t2 + " Uhr");

  /* ---------- Schüler:in am iPad (Uhr der Seite steuerbar, läuft normal weiter) ---------- */
  const sctx = await browser.newContext({ ...devices["iPad (gen 7)"] });
  await sctx.clock.install();
  const sp = await sctx.newPage(); watch(sp, "Schüler:in (aktuellste Sitzung)");
  await sp.goto(BASE + "/");
  await sp.fill("#spw", "Feindt"); await sp.getByRole("button", { name: "Weiter" }).click();
  await sp.waitForURL(/#\/schueler$/);
  await sp.getByRole("button", { name: "Politik und Wirtschaft" }).click();
  await sp.getByRole("button", { name: "10D", exact: true }).click();
  await sp.getByRole("button", { name: "Speichern und weiter" }).click();
  await sp.locator("#code").waitFor();
  ok((await sp.locator("#code-h").textContent()) === CODE_WHERE_TEXT && (await sp.locator("#code").getAttribute("aria-describedby")) === "code-h",
    "Code-Eingabe: fester Text unter dem Feld („" + CODE_WHERE_TEXT + "“), mit dem Feld verbunden");
  await sp.fill("#code", l1.code); await sp.getByRole("button", { name: "Sitzung öffnen" }).click();
  await sp.waitForURL(/#\/schueler\/s\//);
  await sp.locator(".live").waitFor({ timeout: 15000 });
  const stoken = await sp.evaluate(() => localStorage.getItem("u.stoken"));
  const SA = (method, path) => fetch(BASE + path, { method, headers: { Authorization: "Bearer " + stoken } }).then(async (x) => ({ status: x.status, data: await x.json().catch(() => null) }));
  let sv = (await SA("GET", "/api/student/lessons/" + l1.id)).data;
  const at2 = plannedStart(today, t2);
  ok(sv.newer === false && sv.newerSoon === false && sv.changesAt.includes(at2) && sv.changesAt.includes(at2 - NEWER_POLL_MS) && await sp.locator(".newer-note").count() === 0
    && await sp.locator("main > .newer-slot").count() === 1 && (await sp.locator("main > .newer-slot").textContent()) === "",
    "vor dem Beginn der späteren Sitzung (40 Minuten): kein Hinweis (leerer Platz unter dem Kopfband), noch keine Abfrage je Minute; ihr Beginn und die halbe Stunde davor stehen in changesAt");

  /* ---------- die Lehrkraft startet die Live-Präsentation der späteren Sitzung schon vor ihrem Beginn ---------- */
  // wie der Präsentationsmodus: „start“ über den WebSocket der Lehrkraft, dann schließen (die Präsentation läuft weiter – „Schließen“)
  const startLive = async () => {
    const tk = (await T("POST", "/api/teacher/lessons/" + l2.id + "/live-ticket")).data;
    return tp.evaluate(async (url) => new Promise((resolve) => {
      const ws = new WebSocket(url), stop = setTimeout(() => { try { ws.close(); } catch {} resolve(false); }, 10000);
      ws.onopen = () => ws.send(JSON.stringify({ t: "start", fileId: "0123456789abcdef", pages: 3, slide: 1 }));
      ws.onmessage = (ev) => { let m = null; try { m = JSON.parse(ev.data); } catch {} if (m && m.t === "state" && m.active) { clearTimeout(stop); ws.close(); resolve(true); } };
    }), BASE.replace(/^http/, "ws") + tk.url);
  };
  const started = await startLive();
  sv = (await SA("GET", "/api/student/lessons/" + l1.id)).data;
  const txt = JSON.stringify(sv);
  ok(started && sv.newer === true && ![l2.id, l2.code, "GEHEIMTITEL", t2].some((x) => txt.includes(x)),
    "Live-Präsentation der späteren Sitzung läuft (heute, vor ihrem Beginn): newer = true – die Antwort nennt weder Code noch Titel, Kennung oder Beginn");
  // das iPad „wacht auf“: höchstens einmal je Minute fragt die Seite neu – der Hinweis erscheint ohne Neuladen der Seite
  const marker = await sp.evaluate(() => { window.__newerMarker = 44; return 44; });
  await sp.clock.fastForward(NEWER_RECHECK_MS + 1000);
  await sp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const note = sp.locator("main > .newer-slot > section.alarm.newer-note");
  await note.waitFor({ timeout: 15000 });
  const geo = await sp.evaluate(() => {
    const head = document.querySelector("main > header.pagehead"), n = document.querySelector(".newer-note"), a = n.querySelector("a.newer-go");
    return { first: head.nextElementSibling === n.parentElement, live: n.parentElement.getAttribute("aria-live"), bg: getComputedStyle(n).backgroundColor, color: getComputedStyle(n).color,
      h: a.getBoundingClientRect().height, href: a.getAttribute("href"), lab: n.getAttribute("aria-labelledby"), marker: window.__newerMarker, liveWin: !!document.querySelector("main > .live") };
  });
  ok(geo.marker === marker && geo.first && geo.live === "polite" && geo.bg === "rgb(200, 40, 30)" && geo.color === "rgb(255, 255, 255)" && geo.h >= 44 && geo.href === "#/schueler"
    && geo.lab === "newer-h" && geo.liveWin, "ohne Neuladen: roter Hinweis ganz oben direkt unter dem Kopfband (Live-Region, Fläche #c8281e, weiße Schrift), Knopf ≥ 44px, Live-Fenster bleibt darunter (" + JSON.stringify(geo) + ")");
  ok((await note.locator("h2").textContent()) === NEWER_TITLE && (await note.locator("p").textContent()) === NEWER_TEXT
    && await note.getByRole("link", { name: NEWER_BUTTON }).count() === 1, "Hinweis: „" + NEWER_TITLE + "“, ein Satz, Knopf „" + NEWER_BUTTON + "“");
  await sp.screenshot({ ...SHOT, path: join(OUT, "nr44-nicht-aktuellste-sitzung.png") });
  await sp.emulateMedia({ colorScheme: "dark" });
  await sp.screenshot({ ...SHOT, path: join(OUT, "nr44-nicht-aktuellste-sitzung-dunkel.png") });
  await sp.emulateMedia({ colorScheme: "light" });
  // per Tastatur: „Aktuellste Sitzung laden“ → Eingabe des Sitzungscodes mit Fokus im Feld (die Sitzung wird verlassen, das Gerät bleibt angemeldet)
  await note.getByRole("link", { name: NEWER_BUTTON }).focus();
  await sp.keyboard.press("Enter");
  await sp.waitForURL(/#\/schueler$/);
  await sp.locator("#code").waitFor();
  await sp.waitForFunction(() => document.activeElement && document.activeElement.id === "code", null, { timeout: 5000 }).catch(() => {});
  ok(await sp.evaluate(() => document.activeElement && document.activeElement.id === "code") && (await sp.locator("#code-h").textContent()) === CODE_WHERE_TEXT
    && await sp.evaluate(() => localStorage.getItem("u.stoken")) === stoken && await sp.locator(".live").count() === 0 && await sp.locator(".item", { hasText: l1.title }).count() === 1,
    "„" + NEWER_BUTTON + "“: Eingabe des Sitzungscodes mit Fokus und dem festen Text; Gerät bleibt angemeldet, die bisherige Sitzung steht in der Liste");
  await sp.locator("form.card").screenshot({ ...SHOT, path: join(OUT, "nr44-code-eingabe.png") });

  /* ---------- Live-Präsentation beendet: vor dem Beginn kein Hinweis; laut Plan begonnen: Hinweis auch ohne Live-Präsentation ---------- */
  await T("POST", "/api/teacher/lessons/" + l2.id + "/live/stop");
  sv = (await SA("GET", "/api/student/lessons/" + l1.id)).data;
  ok(sv.newer === false, "Live-Präsentation beendet und Beginn noch nicht erreicht: kein Hinweis");

  /* ---------- Gegenprüfung: beginnt die spätere Sitzung in höchstens 30 Minuten, fragt die offene, sichtbare Seite jede Minute – ohne Aufwachen ---------- */
  const in20 = berlinAt(Date.now() + 20 * 60e3);
  ok(in20.date === today && (await T("PATCH", "/api/teacher/lessons/" + l2.id, { date: in20.date, startTime: in20.time })).status === 200, "spätere Sitzung für den Test: beginnt in 20 Minuten");
  await sp.goto(BASE + "/#/schueler/s/" + l1.id);
  await sp.locator(".live").waitFor({ timeout: 15000 });
  sv = (await SA("GET", "/api/student/lessons/" + l1.id)).data;
  ok(sv.newer === false && sv.newerSoon === true && await sp.locator(".newer-note").count() === 0 && !JSON.stringify(sv).includes(in20.time),
    "beginnt in 20 Minuten, noch nicht live: kein Hinweis, die Seite fragt jede Minute (newerSoon) – ohne den Beginn als Uhrzeit");
  const started2 = await startLive();
  await sp.clock.fastForward(NEWER_RECHECK_MS + 2000);   // kein visibilitychange: die Seite bleibt offen und sichtbar
  await note.waitFor({ timeout: 15000 });
  ok(started2 && await note.isVisible() && await sp.evaluate(() => document.visibilityState) === "visible",
    "Lehrkraft startet früher: der rote Hinweis erscheint bei offener, sichtbarer Seite nach höchstens einer Minute (ohne Aufwachen, ohne Neuladen)");
  // verschwindet der Hinweis, während der Fokus darin steht (Präsentation beendet, Beginn noch nicht erreicht): Fokus sichtbar auf der Überschrift der Sitzung
  await note.getByRole("link", { name: NEWER_BUTTON }).focus();
  await sp.keyboard.press("Shift+Tab"); await sp.keyboard.press("Tab");   // per Tastatur dort (Fokusring)
  const linkFocused = await sp.evaluate(() => !!document.activeElement && document.activeElement.classList.contains("newer-go"));
  await T("POST", "/api/teacher/lessons/" + l2.id + "/live/stop");
  await sp.clock.fastForward(NEWER_RECHECK_MS + 2000);
  await sp.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await sp.waitForFunction(() => !document.querySelector(".newer-note"), null, { timeout: 15000 });
  const fh = await sp.evaluate(() => {
    const a = document.activeElement, cs = a ? getComputedStyle(a) : null;
    return { h1: !!a && a.tagName === "H1" && !!a.closest("main > header.pagehead"), tab: a && a.getAttribute("tabindex"), fv: !!a && a.matches(":focus-visible"),
      outline: cs ? cs.outlineStyle + " " + cs.outlineWidth : "", slotEmpty: document.querySelector("main > .newer-slot").textContent === "" };
  });
  ok(linkFocused && fh.h1 && fh.tab === "-1" && fh.fv && fh.outline === "solid 3px" && fh.slotEmpty,
    "Hinweis verschwindet mit dem Fokus darin: Fokus auf der Überschrift der Sitzung (tabindex -1, sichtbarer Fokusring) statt auf dem leeren Platz (" + JSON.stringify(fh) + ")");
  // zur Code-Eingabe ohne „Aktuellste Sitzung laden“ (Adresse bzw. Brotkrume): kein Fokus-Sprung – der Wunsch galt nur einmal (Gerät mit Sitzungen)
  await sp.goto(BASE + "/#/schueler");
  await sp.locator("#code").waitFor();
  await sp.waitForTimeout(400);   // die Seite fokussiert die Code-Eingabe ggf. nach 50 ms
  ok(await sp.evaluate(() => document.activeElement && document.activeElement.id) !== "code" && (await sp.locator(".item").count()) >= 1,
    "Code-Eingabe ohne „" + NEWER_BUTTON + "“: kein Fokus-Sprung (der Wunsch gilt nur einmal)");
  const past = berlinAt(Date.now() - 5 * 60e3);
  ok((await T("PATCH", "/api/teacher/lessons/" + l2.id, { date: past.date, startTime: past.time })).status === 200, "spätere Sitzung für den Test: begann vor 5 Minuten");
  sv = (await SA("GET", "/api/student/lessons/" + l1.id)).data;
  await sp.goto(BASE + "/#/schueler/s/" + l1.id);
  await note.waitFor({ timeout: 15000 });
  ok(sv.newer === true && await note.isVisible(), "laut Plan begonnen: Hinweis gleich beim Öffnen der älteren Sitzung (auch ohne Live-Präsentation)");
  // die jüngste Sitzung (Code eingeben): kein Hinweis
  await sp.goto(BASE + "/#/schueler");
  await sp.fill("#code", l2.code); await sp.getByRole("button", { name: "Sitzung öffnen" }).click();
  await sp.waitForURL(new RegExp("#/schueler/s/" + l2.id + "$"));
  await sp.locator(".live").waitFor({ timeout: 15000 });
  ok(await sp.locator(".newer-note").count() === 0 && (await SA("GET", "/api/student/lessons/" + l2.id)).data.newer === false, "in der jüngsten Sitzung kein Hinweis");
  await sctx.close();
  for (const L of [L1, L2]) await T("DELETE", "/api/teacher/lessons/" + L.id);
  await T("DELETE", "/api/teacher/units/" + u.id);
  ok((await T("GET", "/api/teacher/units/" + u.id)).status === 404, "Test-Kurs PoWi 10D wieder gelöscht");
}
