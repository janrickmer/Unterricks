// polls.mjs – End-to-End-Prüfung von Nachtrag 46: anonyme Umfrage in der Live-Präsentation. Die Lehrkraft lädt eine Präsentation mit einer Umfragefolie hoch
// (unsichtbare Zeile „Unterricks-Umfrage: …“), prüft sie auf der Sitzungsseite („Umfragefolien“), präsentiert an einem zweiten Gerät mit Beamerfenster; zwei
// Schülergeräte (iPad, Handy) stimmen ab – nur solange die Folie offen ist, je Gerät einmal. Etwa 2 Minuten nach der ersten Antwort endet die Abstimmung von
// selbst (Wecker des Durable Objects – die Prüfung wartet diese Zeit wirklich ab): das Ergebnis erscheint bei den Schüler:innen ganz unten unter
// „Abstimmungsergebnis“ – ohne Neuladen der Seite. Dazu: „Ergebnis am Beamer zeigen“, Stand und „Ergebnis löschen und Umfrage neu öffnen“ auf der Sitzungsseite.
// Eigener Kurs PoWi 8C mit einer Sitzung weit in der Zukunft (danach gelöscht). Bildschirmfotos in OUT („umfrage-*.png“). Frei erfundene Inhalte.
// ctx = {browser, tp (Seite der Lehrkraft, angemeldet), BASE, T (Fetch mit Anmeldung), ok, OUT, SHOT, horizontalIssues, devices, watch}
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const Q = "Soll das Wahlalter bei Bundestagswahlen auf 16 Jahre sinken?", OPTS = ["Ja", "Nein", "Ich bin unentschieden"];

/* Präsentation mit vier Folien: Folie 2 ist die Umfragefolie – Frage und Antworten sichtbar, dazu die unsichtbare Zeile (klein, in der Farbe des Hintergrunds) */
async function pollDeck(markLine) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.HelveticaBold), reg = await d.embedFont(StandardFonts.Helvetica), bg = rgb(0.12, 0.23, 0.37), white = rgb(1, 1, 1);
  const pages = [["Wahlalter 16?"], [Q, ...OPTS.map((o, i) => "ABC"[i] + ")  " + o), "Stimme jetzt in Unterricks ab – unter der Präsentation."], ["Besprechung: Was spricht dafür, was dagegen?"], ["Hausaufgabe"]];
  pages.forEach((lines, i) => {
    const p = d.addPage([960, 540]);
    p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: bg });
    lines.forEach((t, k) => p.drawText(t, { x: 60, y: 440 - k * 62, size: k === 0 ? 30 : 26, font: k === 0 ? f : reg, color: white }));
    if (i === 1) p.drawText(markLine, { x: 20, y: 8, size: 2, font: reg, color: bg });
    p.drawText("Unterricks-Phase: " + (i + 1), { x: 20, y: 3, size: 2, font: reg, color: bg });
  });
  return Buffer.from(await d.save());
}

export async function pollsE2E({ browser, tp, BASE, T, ok, OUT, SHOT, horizontalIssues, devices, watch = () => {} }) {
  const { berlinToday, addDays } = await import("../../public/shared.js");
  const P = await import("../../public/polls.js");
  const { POLLS_HINT, POLL_RESET_TEXT } = await import("../../public/pollpanel.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const d0 = addDays(berlinToday(), 47), wd = new Date(d0 + "T12:00:00Z").getUTCDay();
  const u = (await T("POST", "/api/teacher/units", { subject: "powi", klass: "8C", title: "Wahlen (Umfrage)", params: { start: d0, end: d0, weekdays: [{ day: wd, minutes: 45, time: "10:00" }] } })).data.unit;
  await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: "Wahlen (Umfrage)", lernaufgabe: "Leserbrief" }, rows: [{ stundenfrage: "Wahlalter 16?", ablauf: ["Umfrage", "Diskussion"], date: d0, time: "10:00", minutes: 45 }] });
  const A = (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit.lessons.find((l) => l.date === d0);
  ok(!!A, "Kurs PoWi 8C: eine Sitzung (" + d0 + ", 10:00, 45 Minuten)");

  /* ---- Präsentation mit Umfragefolie hochladen: erkannt, Meldung, Kennzeichen am Vorschaubild, Feld „Umfragefolien“ ---- */
  await tp.goto(BASE + "/#/lk/s/" + A.id);
  const presCard = tp.locator("section.card", { hasText: "Präsentation für den Unterricht" });
  await presCard.waitFor({ timeout: 15000 });
  await tp.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await presCard.locator("input[type=file]").first().setInputFiles({ name: "Wahlalter.pdf", mimeType: "application/pdf", buffer: await pollDeck(P.pollMarkLine({ q: Q, options: OPTS })) });
  const toast = tp.locator(".toast", { hasText: "Präsentation bereit (4 Folien)." });
  await toast.waitFor({ timeout: 60000 });
  ok((await toast.textContent()).includes("Auf Folie 2 stimmen die Schüler:innen im Unterricht anonym ab (siehe „Umfragefolien“)."), "Hochladen: „Auf Folie 2 stimmen die Schüler:innen im Unterricht anonym ab (siehe „Umfragefolien“).“");
  let pf = (await T("GET", "/api/teacher/lessons/" + A.id)).data.files.find((f) => f.area === "presentation");
  ok(JSON.stringify(pf.polls) === JSON.stringify({ pdf: [{ n: 2, q: Q, options: OPTS }], hand: null }), "Umfragefolie aus der unsichtbaren Zeile erkannt: Folie 2 mit Frage und drei Antworten");
  // Nachtrag 47: auch diese Sitzung in Jg. 8 hat die Karte „Fachbegriffe dieser Sitzung“ (Karteikarten am ganzen Gymnasium ab Jg. 5)
  await tp.locator("#terms").waitFor({ timeout: 15000 });
  const tr = await T("PATCH", "/api/teacher/lessons/" + A.id, { terms: [{ term: "Wahlalter", definition: "Das Alter, ab dem man wählen darf." }, { term: "Wahlrecht", definition: "Das Recht, bei Wahlen abzustimmen." },
    { term: "Bundestag", definition: "Das Parlament, das in Berlin die Gesetze beschließt." }], termsBase: 0 });
  ok(tr.status === 200 && tr.data.lesson.terms.length === 3 && (await tp.locator("#terms-h").textContent()) === "Fachbegriffe dieser Sitzung",
    "Jg. 8 (Nachtrag 47): Karte „Fachbegriffe dieser Sitzung“ auf der Sitzungsseite, drei Begriffe gespeichert");
  const K = P.pollKey(pf.id, 2);
  await tp.reload();
  const box = tp.locator("details#polls");
  await box.waitFor({ timeout: 15000 });
  ok((await box.locator("summary").textContent()) === "Umfragefolien – aus der PDF: Folie 2" && await tp.locator('figure.thumb[data-n="2"] .badge.poll').count() === 1
    && (await tp.locator('figure.thumb[data-n="2"]').getAttribute("aria-label")).includes("Umfragefolie: live stimmen die Schüler:innen hier anonym ab"),
    "Sitzungsseite: Feld „Umfragefolien – aus der PDF: Folie 2“, Kennzeichen „Umfrage“ am Vorschaubild von Folie 2");
  await box.locator("summary").click();
  await box.locator(".pollrow").first().waitFor({ timeout: 10000 });
  await box.locator(".pollstatus-list", { hasText: "Noch keine Antworten in dieser Sitzung." }).waitFor({ timeout: 10000 });
  ok((await box.locator(".hint").first().textContent()) === POLLS_HINT && (await box.locator(".pollrow select").inputValue()) === "2" && (await box.locator(".pollrow .pol-q input").inputValue()) === Q
    && (await box.locator(".pollrow textarea").inputValue()) === OPTS.join("\n"), "aufgeklappt: Hinweis, Folie, Frage und die Antworten (eine je Zeile); Stand: „Noch keine Antworten in dieser Sitzung.“");
  // von Hand ändern: gleiche Antworten → Meldung am Feld; dann eine vierte Antwort speichern und wieder die aus der PDF übernehmen
  await box.locator(".pollrow textarea").fill("Ja\nja");
  await box.getByRole("button", { name: "Umfragefolien speichern" }).click();
  ok((await box.locator("#poll-edit-err").textContent()) === "Umfrage 1: Zwei Antworten sind gleich – jede Antwort darf nur einmal vorkommen." && await tp.evaluate(() => document.activeElement && document.activeElement.tagName === "TEXTAREA"),
    "gleiche Antworten: Meldung, Fokus im Feld „Antworten“ – nichts gespeichert");
  await box.locator(".pollrow textarea").fill(OPTS.join("\n") + "\nKommt darauf an");
  await box.getByRole("button", { name: "Umfragefolien speichern" }).click();
  await box.locator('.save-state[data-state="ok"]', { hasText: "Gespeichert – Unterricks folgt jetzt Ihren Umfragefolien." }).waitFor({ timeout: 10000 });
  pf = (await T("GET", "/api/teacher/lessons/" + A.id)).data.files.find((f) => f.area === "presentation");
  ok(pf.polls.hand.length === 1 && pf.polls.hand[0].options.length === 4 && (await box.locator("summary").textContent()) === "Umfragefolien – von Ihnen festgelegt: Folie 2", "von Hand: vierte Antwort gespeichert – „von Ihnen festgelegt: Folie 2“");
  await box.scrollIntoViewIfNeeded(); await box.screenshot({ ...SHOT, path: join(OUT, "umfrage-sitzungsseite.png") });
  await box.getByRole("button", { name: "Umfragefolien aus der PDF übernehmen" }).click();
  await box.locator('.save-state[data-state="ok"]', { hasText: "es gelten wieder die Umfragefolien aus der PDF" }).waitFor({ timeout: 10000 });
  pf = (await T("GET", "/api/teacher/lessons/" + A.id)).data.files.find((f) => f.area === "presentation");
  ok(pf.polls.hand === null && (await box.locator(".pollrow textarea").inputValue()) === OPTS.join("\n"), "„Umfragefolien aus der PDF übernehmen“: wieder die drei Antworten der PDF");

  /* ---- zwei Schülergeräte (iPad und Handy) öffnen die Sitzung ---- */
  const join1 = async (ctx, who) => {
    const sp = await ctx.newPage(); watch(sp, who);
    await sp.goto(BASE + "/"); await sp.fill("#spw", "Feindt"); await sp.getByRole("button", { name: "Weiter" }).click();
    await sp.getByRole("button", { name: "Politik und Wirtschaft" }).click(); await sp.getByRole("button", { name: "8C", exact: true }).click();
    await sp.getByRole("button", { name: "Speichern und weiter" }).click();
    await sp.fill("#code", A.code); await sp.getByRole("button", { name: "Sitzung öffnen" }).click();
    await sp.locator("section.live").waitFor({ timeout: 15000 });
    return sp;
  };
  const c1 = await browser.newContext({ ...devices["iPad (gen 7)"] }), c2 = await browser.newContext({ ...devices["iPhone 13"] });
  const s1 = await join1(c1, "Schüler:in 1 (Nachtrag 46)"), s2 = await join1(c2, "Schüler:in 2 (Nachtrag 46)");
  const tok1 = await s1.evaluate(() => localStorage.getItem("u.stoken"));
  const voteApi = (tok, choice, k = K) => fetch(BASE + "/api/student/lessons/" + A.id + "/poll", { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json" }, body: JSON.stringify({ k, choice }) })
    .then(async (x) => ({ status: x.status, data: await x.json() }));
  await s1.evaluate(() => { window.__same = 1; }); await s2.evaluate(() => { window.__same = 1; });
  ok(await s1.locator(".pollbox").count() === 0 && await s1.locator(".pollresbox").count() === 0, "Schüler:in vor der Präsentation: weder ein Feld zum Abstimmen noch ein „Abstimmungsergebnis“");
  let r = await voteApi(tok1, 0);
  ok(r.status === 409 && r.data.code === "poll_not_open" && r.data.error === P.POLL_ERRORS.not_open, "ohne Live-Präsentation nimmt der Server keine Stimme an (409)");

  /* ---- Lehrkraft präsentiert (zweites Gerät) mit Beamerfenster ---- */
  const tStore = await tp.evaluate(() => JSON.stringify(localStorage));
  const pc = await browser.newContext({ viewport: { width: 1366, height: 820 } });
  await pc.addInitScript((s) => { try { if (!sessionStorage.getItem("x")) { for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); sessionStorage.setItem("x", "1"); } } catch {} }, tStore);
  // Laptop mit Beamer als erweitertem Bildschirm (headless kennt nur einen) – wie bei den Notizen der Lehrkraft
  await pc.addInitScript(() => { try { Object.defineProperty(Screen.prototype, "isExtended", { configurable: true, get() { return true; } }); } catch {} });
  const p2 = await pc.newPage(); watch(p2, "Lehrkraft (Präsentation, Nachtrag 46)");
  await p2.goto(BASE + "/#/lk/s/" + A.id);
  await p2.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
  const pr = p2.locator(".presenter");
  await pr.waitFor({ timeout: 15000 });
  const next = async (n) => { await p2.keyboard.press("ArrowRight"); await pr.locator(".counter", { hasText: n + " / 4" }).waitFor({ timeout: 10000 }); };
  await next(1);
  await s1.locator("section.live:not(.idle) img").waitFor({ timeout: 15000 });
  await sleep(800);
  ok(await s1.locator(".pollbox").count() === 0 && !(await pr.evaluate((el) => el.classList.contains("with-poll"))), "Folie 1: keine Umfrage – weder bei den Schüler:innen noch in der Präsentationsansicht");
  r = await voteApi(tok1, 0);
  ok(r.status === 409 && r.data.code === "poll_not_open", "… und der Server nimmt für Folie 2 noch keine Stimme an");
  await next(2);
  await s1.locator(".pollbox form").waitFor({ timeout: 10000 }); await s2.locator(".pollbox form").waitFor({ timeout: 10000 });
  ok((await s1.locator(".pollbox h2").textContent()) === "Umfrage" && (await s1.locator(".pollbox .poll-q").textContent()) === Q
    && JSON.stringify(await s1.locator(".pollbox label.poll-opt").allTextContents()) === JSON.stringify(OPTS) && await s1.locator('.pollbox input[type="radio"]').count() === 3
    && (await s1.locator("#poll-hint").textContent()) === P.POLL_STUDENT.hint && (await s1.locator(".live .status .pollbadge").textContent()) === P.POLL_STUDENT.badge
    && await s1.evaluate(() => { const live = document.querySelector("section.live"), b = document.querySelector(".pollbox-wrap"); return !!live && live.nextElementSibling === b && window.__same === 1; }),
    "Folie 2 live: direkt unter der Präsentation erscheint – ohne Neuladen – die Umfrage (Frage, drei Antworten als Optionsfelder, Hinweis zur Anonymität); im Live-Fenster der Hinweis „Umfrage – stimme unter der Präsentation ab“");
  const optBox = await s2.locator(".pollbox label.poll-opt").first().boundingBox();
  const hi2 = (await horizontalIssues(s2)).issues, goBox = await s2.locator(".pollbox button[type=submit]").boundingBox();
  ok(optBox.height >= 44 && goBox.height >= 44 && hi2.length === 0, "Handy: Antworten und „Abstimmen“ mindestens 44 px hoch, kein seitliches Schieben" + (hi2.length ? " – " + JSON.stringify(hi2).slice(0, 400) : " (" + Math.round(optBox.height) + " / " + Math.round(goBox.height) + " px)"));
  await s1.locator(".pollbox").screenshot({ ...SHOT, path: join(OUT, "umfrage-schueler-abstimmen.png") });
  // Präsentationsansicht: Feld unter der Folie – ohne getrennten Beamer keine Verteilung
  ok(await pr.evaluate((el) => el.classList.contains("with-poll")) && (await pr.locator(".pollpane .pp-q").textContent()) === Q && (await pr.locator(".pollpane .pp-count").textContent()) === "0 Antworten"
    && (await pr.locator(".pollpane .pp-left").textContent()) === "wartet auf die erste Antwort" && await pr.locator(".pollpane .pollbars").count() === 0
    && (await pr.locator(".pollpane .pp-show").textContent()) === "Ergebnis zeigen",
    "Präsentationsansicht: Feld „Umfrage“ unter der Folie – „0 Antworten“, „wartet auf die erste Antwort“; ohne getrennten Beamer keine Verteilung (der Bildschirm wäre für die Klasse zu sehen), Knopf „Ergebnis zeigen“");
  const [bw] = await Promise.all([pc.waitForEvent("page"), pr.getByRole("button", { name: "Beamerfenster öffnen" }).click()]);
  watch(bw, "Beamerfenster (Nachtrag 46)");
  await bw.locator(".beamer .bm-poll .bmp-badge").waitFor({ timeout: 15000 });
  ok((await bw.locator(".bm-poll").textContent()) === "Umfrage · 0 Antworten" && await bw.locator(".bm-poll .pollbars").count() === 0, "Beamerfenster: über der Folie nur „Umfrage · 0 Antworten“");

  /* ---- abstimmen: ohne Auswahl eine Meldung; je Gerät einmal ---- */
  await s1.locator(".pollbox button[type=submit]").click();
  ok((await s1.locator("#poll-err").textContent()) === P.POLL_STUDENT.pick, "„Abstimmen“ ohne Auswahl: „Bitte wähle zuerst eine Antwort aus.“");
  await s1.locator('.pollbox label.poll-opt', { hasText: "Ja" }).first().click();
  const t0 = Date.now();
  await s1.locator(".pollbox button[type=submit]").click();
  await s1.locator(".pollbox .poll-state", { hasText: "deine Stimme ist gezählt" }).waitFor({ timeout: 10000 });
  ok((await s1.locator(".pollbox .poll-state").textContent()) === P.POLL_STUDENT.done && await s1.locator(".pollbox form").count() === 0 && await s1.locator(".live .status .pollbadge").count() === 0
    && await s1.evaluate(() => document.activeElement && document.activeElement.classList.contains("poll-state")),
    "Schüler:in 1 stimmt „Ja“: „Danke – deine Stimme ist gezählt …“, kein Formular mehr, der Hinweis im Live-Fenster verschwindet, der Fokus liegt auf der Meldung");
  await pr.locator(".pollpane .pp-count", { hasText: "1 Antwort" }).waitFor({ timeout: 10000 });
  await bw.locator(".bm-poll", { hasText: "Umfrage · 1 Antwort" }).waitFor({ timeout: 10000 });
  const left1 = await pr.locator(".pollpane .pp-left").textContent(), bars1 = await pr.locator(".pollpane .pb-num").allTextContents();
  ok(/^noch (2:00|1:5\d)$/.test(left1) && (await bw.locator(".bm-poll").textContent()) === "Umfrage · 1 Antwort" && JSON.stringify(bars1) === JSON.stringify(["1 · 100 %", "0 · 0 %", "0 · 0 %"]),
    "Lehrkraft: „1 Antwort“ und die Restzeit (" + left1 + "); mit Beamerfenster jetzt auch die Verteilung in der Präsentationsansicht (" + bars1.join(", ") + ") – am Beamer weiter nur die Zahl");
  r = await voteApi(tok1, 1);
  ok(r.status === 409 && r.data.code === "poll_voted" && r.data.error === P.POLL_ERRORS.voted, "dasselbe Gerät noch einmal (über die Schnittstelle): 409 „Von diesem Gerät wurde schon abgestimmt …“");
  await s1.reload();
  await s1.locator(".pollbox .poll-state").waitFor({ timeout: 15000 });
  ok((await s1.locator(".pollbox .poll-state").textContent()) === P.POLL_STUDENT.done, "nach dem Neuladen der Seite: weiter „gezählt“ – kein zweites Abstimmen");
  await s2.locator('.pollbox label.poll-opt', { hasText: "Nein" }).click();
  await s2.locator(".pollbox button[type=submit]").click();
  await s2.locator(".pollbox .poll-state", { hasText: "deine Stimme ist gezählt" }).waitFor({ timeout: 10000 });
  await pr.locator(".pollpane .pp-count", { hasText: "2 Antworten" }).waitFor({ timeout: 10000 });
  const sd = await fetch(BASE + "/api/student/lessons/" + A.id, { headers: { Authorization: "Bearer " + tok1 } }).then((x) => x.json());
  ok(JSON.stringify(sd.polls) === "[]" && await s1.locator(".pollresbox").count() === 0, "vor dem Ende: kein „Abstimmungsergebnis“ – auch nicht über die Schnittstelle");
  await pr.locator(".pollpane").screenshot({ ...SHOT, path: join(OUT, "umfrage-praesentation.png") });

  /* ---- „Ergebnis am Beamer zeigen“ geht erst nach dem Ende der Abstimmung ---- */
  const showBtn = pr.locator(".pollpane .pp-show");
  ok((await showBtn.textContent()) === "Ergebnis am Beamer zeigen" && (await showBtn.getAttribute("aria-pressed")) === "false" && (await showBtn.getAttribute("aria-disabled")) === "true"
    && (await showBtn.boundingBox()).height >= 44 && await pr.locator(".pollpane .pp-reset").isHidden(),
    "mit Beamerfenster heißt der Knopf „Ergebnis am Beamer zeigen“ (≥ 44 px) – solange abgestimmt wird, ist er ohne Wirkung (aria-disabled); „Ergebnis löschen …“ gibt es noch nicht");
  await showBtn.click({ force: true });   // Playwright klickt einen Knopf mit aria-disabled sonst nicht – eine Lehrkraft kann ihn trotzdem drücken
  await sleep(1200);
  ok(await bw.locator(".bm-poll.shown").count() === 0 && (await bw.locator(".bm-poll").textContent()) === "Umfrage · 2 Antworten" && (await showBtn.getAttribute("aria-pressed")) === "false"
    && (await pr.locator(".pollpane .pv-msg").textContent()).includes("dann sehen die Schüler:innen das Ergebnis in ihrer Sitzung, und Sie können es am Beamer zeigen."),
    "Klick während der Abstimmung: am Beamer bleibt es bei der Zahl der Antworten – die Statuszeile sagt, dass das Ergebnis nach dem Ende gezeigt werden kann");

  /* ---- andere Folie: zu; zurück: wieder offen (noch keine 2 Minuten) ---- */
  await next(3);
  await s1.locator(".pollbox").waitFor({ state: "detached", timeout: 10000 });
  ok(await bw.locator(".bm-poll").isHidden() && !(await pr.evaluate((el) => el.classList.contains("with-poll"))), "Folie 3: Umfrage zu – kein Feld bei den Schüler:innen, nichts am Beamer");
  await p2.keyboard.press("ArrowLeft");
  await pr.locator(".counter", { hasText: "2 / 4" }).waitFor({ timeout: 10000 });
  await s1.locator(".pollbox .poll-state").waitFor({ timeout: 10000 });
  await pr.locator(".pollpane .pp-count", { hasText: "2 Antworten" }).waitFor({ timeout: 10000 });
  const left2 = await pr.locator(".pollpane .pp-left").textContent();
  ok(/^noch (2:00|[01]:\d\d)$/.test(left2), "zurück auf Folie 2: die Abstimmung läuft weiter (Zahlen und Restzeit stehen wieder da: " + left2 + ")");

  /* ---- etwa 2 Minuten nach der ersten Antwort: beendet – Ergebnis bei den Schüler:innen ganz unten, ohne Neuladen ---- */
  await s1.evaluate(() => { window.__same = 2; });
  let reloads = 0;   // wie oft die Seite der Schülerin danach ihre Daten neu lädt (Befund der Gegenprüfung: einmal, nicht wiederholt)
  s1.on("request", (x) => { if (x.method() === "GET" && new URL(x.url()).pathname === "/api/student/lessons/" + A.id) reloads++; });
  await s2.locator(".pollresbox details.pollres").waitFor({ timeout: Math.max(20000, P.POLL_RESULT_MS - (Date.now() - t0) + 25000) });
  const took = Math.round((Date.now() - t0) / 1000);
  await s1.locator(".pollresbox details.pollres").waitFor({ timeout: 20000 });
  ok(took >= 115 && took <= 150, "das Ergebnis erscheint etwa 2 Minuten nach der ersten Antwort (gemessen: " + took + " s)");
  ok(await s1.evaluate(() => window.__same === 2) && (await s1.locator(".pollresbox h2").textContent()) === "Abstimmungsergebnis"
    && await s1.evaluate(() => { const m = document.querySelector("main"), b = document.querySelector(".pollres-wrap"); return !!b && m.lastElementChild === b; })
    && !(await s1.locator("details.pollres").evaluate((d) => d.open)) && (await s1.locator("details.pollres summary .pr-q").textContent()) === Q
    && (await s1.locator("details.pollres summary .pr-n").textContent()) === "2 Antworten",
    "Schüler:in: ganz unten der Bereich „Abstimmungsergebnis“ – ohne Neuladen –, zugeklappt mit Frage und „2 Antworten“");
  ok((await s1.locator(".pollbox .poll-state").textContent()) === P.POLL_STUDENT.closed, "unter der Präsentation steht jetzt: „Die Abstimmung ist beendet. Das Ergebnis steht ganz unten unter „Abstimmungsergebnis“.“");
  await s1.locator("details.pollres summary").click();
  const hi1 = (await horizontalIssues(s1)).issues;
  ok(JSON.stringify(await s1.locator("details.pollres .pollbar .pb-text").allTextContents()) === JSON.stringify(OPTS)
    && JSON.stringify(await s1.locator("details.pollres .pb-num").allTextContents()) === JSON.stringify(["1 · 50 %", "1 · 50 %", "0 · 0 %"]) && hi1.length === 0,
    "aufgeklappt: je Antwort Balken mit Zahl und Prozent" + (hi1.length ? " – " + JSON.stringify(hi1).slice(0, 400) : ""));
  await s1.locator(".pollresbox").scrollIntoViewIfNeeded(); await s1.locator(".pollresbox").screenshot({ ...SHOT, path: join(OUT, "umfrage-schueler-ergebnis.png") });
  await s2.locator("details.pollres summary").click();
  const hi3 = (await horizontalIssues(s2)).issues;
  ok(hi3.length === 0 && (await s2.locator("details.pollres summary").boundingBox()).height >= 44, "Handy: Ergebnis ohne seitliches Schieben, die Frage zum Aufklappen mindestens 44 px hoch" + (hi3.length ? " – " + JSON.stringify(hi3).slice(0, 400) : ""));
  await s2.locator(".pollresbox").screenshot({ ...SHOT, path: join(OUT, "umfrage-schueler-ergebnis-handy.png") });
  await pr.locator(".pollpane .pp-left", { hasText: "beendet" }).waitFor({ timeout: 10000 });
  await bw.locator(".bm-poll", { hasText: "Umfrage · 2 Antworten · beendet" }).waitFor({ timeout: 10000 });
  ok((await pr.locator(".pollpane .pv-msg").textContent()).startsWith("Die Abstimmung ist beendet"), "Lehrkraft und Beamer: „beendet“");
  // jetzt lässt sich das Ergebnis am Beamer zeigen
  ok((await showBtn.getAttribute("aria-disabled")) === null && await pr.locator(".pollpane .pp-reset").isVisible(), "nach dem Ende: „Ergebnis am Beamer zeigen“ ist frei, dazu „Ergebnis löschen und Umfrage neu öffnen“");
  await showBtn.click();
  await bw.locator(".bm-poll.shown .bmp-card").waitFor({ timeout: 10000 });
  ok((await bw.locator(".bm-poll .bmp-q").textContent()) === Q && JSON.stringify(await bw.locator(".bm-poll .pb-num").allTextContents()) === JSON.stringify(["1 · 50 %", "1 · 50 %", "0 · 0 %"])
    && (await bw.locator(".bm-poll .bmp-n").textContent()) === "2 Antworten · Abstimmung beendet" && (await showBtn.getAttribute("aria-pressed")) === "true" && (await showBtn.textContent()) === "Ergebnis am Beamer ausblenden",
    "„Ergebnis am Beamer zeigen“: das Beamerfenster zeigt die Verteilung (Frage, Balken mit Zahl und Prozent, „2 Antworten · Abstimmung beendet“)");
  await bw.screenshot({ ...SHOT, path: join(OUT, "umfrage-beamer-ergebnis.png") });
  await showBtn.click();
  await bw.locator(".bm-poll:not(.shown) .bmp-badge").waitFor({ timeout: 10000 });
  await sleep(4000);
  ok(reloads >= 1 && reloads <= 2, "die Seite der Schülerin hat ihre Daten nach dem Ende " + reloads + "-mal neu geladen (nicht wiederholt)");
  r = await voteApi(tok1, 2);
  ok(r.status === 409 && r.data.code === "poll_closed", "nach dem Ende nimmt der Server keine Stimme mehr an – auch bei offener Folie");
  // ein drittes Gerät, das erst jetzt dazukommt, kann nicht mehr abstimmen und sieht das Ergebnis
  const c3 = await browser.newContext({ ...devices["iPad (gen 7)"] }), s3 = await join1(c3, "Schüler:in 3 (Nachtrag 46)");
  await s3.locator(".pollresbox details.pollres").waitFor({ timeout: 15000 });
  ok((await s3.locator(".pollbox .poll-state").textContent()) === P.POLL_STUDENT.closed && await s3.locator(".pollbox form").count() === 0, "ein Gerät, das erst nach dem Ende dazukommt: kein Abstimmen mehr, das Ergebnis steht unten");
  await c3.close();

  /* ---- Sitzungsseite: Stand der Umfragen; „Ergebnis löschen und Umfrage neu öffnen“ ---- */
  await box.getByRole("button", { name: "Stand aktualisieren" }).click();
  const stRow = box.locator(".pollstatus", { hasText: "Folie 2" });
  await stRow.waitFor({ timeout: 10000 });
  ok((await stRow.locator(".ps-head").textContent()) === "Folie 2: " + Q && (await stRow.locator("p.small").textContent()) === "2 Antworten · beendet – die Schüler:innen sehen das Ergebnis"
    && JSON.stringify(await stRow.locator(".pb-num").allTextContents()) === JSON.stringify(["1 · 50 %", "1 · 50 %", "0 · 0 %"]),
    "Sitzungsseite („Stand der Umfragen in dieser Sitzung“): Folie 2 – 2 Antworten, beendet, mit der Verteilung");
  await stRow.getByRole("button", { name: "Ergebnis löschen und Umfrage neu öffnen – Folie 2" }).click();
  const dlg = tp.locator(".modal", { hasText: "Ergebnis löschen" });
  await dlg.waitFor({ timeout: 5000 });
  ok((await dlg.textContent()).includes(POLL_RESET_TEXT), "Rückfrage vor dem Löschen nennt die Folgen");
  await dlg.getByRole("button", { name: "Löschen", exact: true }).click();
  await box.locator(".pollstatus-list", { hasText: "Noch keine Antworten in dieser Sitzung." }).waitFor({ timeout: 10000 });
  await s1.locator(".pollresbox").waitFor({ state: "detached", timeout: 20000 });
  await s1.locator(".pollbox form").waitFor({ timeout: 10000 });
  ok(await s1.evaluate(() => window.__same === 2) && await s1.locator(".pollbox form").count() === 1, "gelöscht: bei den Schüler:innen verschwindet das Ergebnis ohne Neuladen, die Umfrage ist wieder offen (das Gerät darf wieder einmal abstimmen)");
  await pr.locator(".pollpane .pp-count", { hasText: "0 Antworten" }).waitFor({ timeout: 10000 });

  /* ---- zweiter Durchgang: dasselbe Gerät stimmt wieder ab; nach dem Ende löscht die Lehrkraft das Ergebnis direkt in der Präsentationsansicht (zweimal drücken) ---- */
  await s1.locator(".pollbox label.poll-opt", { hasText: "Nein" }).click();
  const t1 = Date.now();
  await s1.locator(".pollbox button[type=submit]").click();
  await s1.locator(".pollbox .poll-state", { hasText: "deine Stimme ist gezählt" }).waitFor({ timeout: 10000 });
  await pr.locator(".pollpane .pp-count", { hasText: "1 Antwort" }).waitFor({ timeout: 10000 });
  ok(true, "nach dem Neuöffnen zählt die Stimme desselben Geräts wieder");
  // die Präsentationsansicht ohne getrenntes Beamerbild (Beamerfenster zu – wie ein gespiegeltes iPad): keine Verteilung, der Knopf heißt „Ergebnis zeigen“
  await bw.close();
  await pr.locator(".pollpane .pp-show", { hasText: /^Ergebnis zeigen$/ }).waitFor({ timeout: 10000 });
  ok(await pr.locator(".pollpane .pollbars").count() === 0 && (await pr.locator(".pollpane .pv-msg").textContent()).includes("dieser Bildschirm ist für die Klasse mit zu sehen"),
    "Beamerfenster geschlossen (nur noch dieser Bildschirm): die Verteilung verschwindet aus der Präsentationsansicht, der Knopf heißt „Ergebnis zeigen“");
  await pr.locator(".pollpane .pp-left", { hasText: "beendet" }).waitFor({ timeout: Math.max(20000, P.POLL_RESULT_MS - (Date.now() - t1) + 25000) });
  await s1.locator(".pollresbox details.pollres").waitFor({ timeout: 20000 });
  await pr.locator(".pollpane .pp-show").click();
  await pr.locator(".pollpane .pollbars").waitFor({ timeout: 10000 });
  ok(JSON.stringify(await pr.locator(".pollpane .pb-num").allTextContents()) === JSON.stringify(["0 · 0 %", "1 · 100 %", "0 · 0 %"]) && (await pr.locator(".pollpane .pp-show").textContent()) === "Ergebnis ausblenden",
    "nach dem Ende: „Ergebnis zeigen“ blendet die Verteilung in der Präsentationsansicht ein");
  const resetBtn = pr.locator(".pollpane .pp-reset");
  await resetBtn.click();
  ok((await resetBtn.textContent()) === "Wirklich löschen? Noch einmal drücken" && (await pr.locator(".pollpane .pv-msg").textContent()).startsWith("Die gezählten Antworten und das Ergebnis werden gelöscht")
    && await s1.locator(".pollresbox").count() === 1, "„Ergebnis löschen und Umfrage neu öffnen“ in der Präsentationsansicht: erst eine Rückfrage am Knopf – noch nichts gelöscht");
  await resetBtn.click();
  await pr.locator(".pollpane .pp-count", { hasText: "0 Antworten" }).waitFor({ timeout: 10000 });
  await s1.locator(".pollresbox").waitFor({ state: "detached", timeout: 20000 });
  await s1.locator(".pollbox form").waitFor({ timeout: 10000 });
  ok(await resetBtn.isHidden() && (await pr.locator(".pollpane .pp-left").textContent()) === "wartet auf die erste Antwort", "zweiter Druck: gelöscht – die Umfrage ist wieder offen, bei der Schülerin ist das Ergebnis weg");

  /* ---- Präsentation beenden: Umfrage zu ---- */
  await pr.getByRole("button", { name: "Präsentation für alle beenden" }).click();
  await s1.locator(".pollbox").waitFor({ state: "detached", timeout: 10000 });
  r = await voteApi(tok1, 0);
  ok(r.status === 409 && r.data.code === "poll_not_open", "„Präsentation für alle beenden“: das Feld zum Abstimmen verschwindet, der Server nimmt nichts mehr an");

  await bw.close().catch(() => {}); await pc.close(); await c1.close(); await c2.close();
  await T("DELETE", "/api/teacher/lessons/" + A.id); await T("DELETE", "/api/teacher/units/" + u.id);
}
