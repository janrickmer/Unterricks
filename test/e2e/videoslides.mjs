// videoslides.mjs – End-to-End-Prüfung von Nachtrag 38: YouTube-Video an der Stelle einer Videofolie eingebettet abspielen. Eigener Test-Kurs PoWi 10G mit einer
// Sitzung in der Vergangenheit (danach gelöscht). Präsentation mit drei Videofolien (unsichtbare Zeile „Unterricks-Video: …“): eine normale (Ausschnitt), eine,
// deren Abspielen der Browser blockiert, eine, die YouTube nicht einbetten lässt. Geprüft: Erkennen beim Hochladen, „Videofolien“ der Sitzungsseite,
// Präsentations-Prompt, Abspielen hier (gespiegelt), im Beamerfenster und am Beamergerät samt Rückmeldung, Schüler:innen live nur mit der Folie (keine
// Nachricht und keine Anfrage zum Video) und nach der Stunde mit dem Link im Folienfenster. YouTube gibt es dabei nie: Der Player ist eine Attrappe
// (PLAYER_FAKE), die das Protokoll des echten Players nachspielt (listening → initialDelivery/onReady/infoDelivery, Befehle playVideo/pauseVideo/seekTo).
// ctx = {browser, tctx (Kontext der Lehrkraft), tp (Seite der Lehrkraft, angemeldet), BASE, T, ok, OUT, SHOT, devices, watch}
import { join } from "node:path";
import { PDFDocument, StandardFonts, rgb, setTextRenderingMode } from "pdf-lib";

export const VIDEO_OK = "Fk1u8VKrJGA", VIDEO_BLOCKED = "BLOCKEDvid1", VIDEO_NOEMBED = "NOEMBED0000";
/* Attrappe des Players von youtube-nocookie.com (nur für Adressen mit enablejsapi=1): antwortet wie der echte (JSON-Text an die Seite) – erst nach 1,5 s
   (Ladezeit), startet mit autoplay=1 von selbst –, spielt in Echtzeit (Stelle +0,25 s je 250 ms) und hält sich bewusst NICHT an das Ende des Ausschnitts
   (nach einem Sprung tut der echte Player das auch nicht verlässlich – das Ende hält Unterricks selbst ein). BLOCKEDvid1 startet erst nach einem Klick in den
   Player („Tippen“), NOEMBED0000 meldet Fehler 150. window.__cmds = empfangene Befehle, window.__t() = Stelle (Playwright liest beides aus dem Rahmen). */
export const PLAYER_FAKE = `<!doctype html><meta charset="utf-8"><title>Player-Attrappe</title>
<body style="margin:0;background:#111;color:#fff;font:16px sans-serif"><p id="s">Player-Attrappe</p><button id="tap" type="button">Tippen</button>
<script>
const q = new URLSearchParams(location.search), id = location.pathname.split("/").pop(), start = Number(q.get("start")) || 0, end = Number(q.get("end")) || 0;
let state = -1, t = start, timer = null, heard = false, pending = false, tapped = false;
window.__cmds = []; window.__t = () => t;
const post = (o) => { o.id = 1; o.channel = "widget"; parent.postMessage(JSON.stringify(o), "*"); };
const info = () => { post({ event: "infoDelivery", info: { playerState: state, currentTime: t, duration: 600 } }); document.getElementById("s").textContent = "Zustand " + state + " · " + t.toFixed(2); };
const setState = (s) => { state = s; post({ event: "onStateChange", info: s }); info(); };
function play() {
  if (id === "${VIDEO_NOEMBED}") return;
  if (id === "${VIDEO_BLOCKED}" && !tapped) return;   // Autoplay mit Ton blockiert: bleibt „nicht gestartet“
  setState(1); clearInterval(timer);
  timer = setInterval(() => { t = Math.round((t + 0.25) * 100) / 100; if (t >= 600) { t = 600; clearInterval(timer); setState(0); return; } info(); }, 250);
}
addEventListener("message", (e) => {
  let m; try { m = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
  if (!m || typeof m !== "object") return;
  if (m.event === "listening") {
    if (pending) return;
    if (heard) { post({ event: "alreadyInitialized" }); return; }
    pending = true;
    setTimeout(() => {   // Ladezeit des Players
      heard = true; pending = false;
      post({ event: "initialDelivery", info: { apiInterface: ["playVideo", "pauseVideo", "seekTo", "mute", "unMute"], playerState: state, currentTime: t, duration: 600, muted: q.get("mute") === "1" } });
      post({ event: "onReady" });
      if (id === "${VIDEO_NOEMBED}") post({ event: "onError", info: 150 });
      else if (q.get("autoplay") === "1") play();
    }, 1500);
    return;
  }
  if (m.event !== "command") return;
  window.__cmds.push(m.func + (Array.isArray(m.args) && m.args.length ? " " + JSON.stringify(m.args) : ""));
  if (m.func === "playVideo") play();
  else if (m.func === "pauseVideo") { clearInterval(timer); setState(2); }
  else if (m.func === "seekTo") { t = Number(m.args[0]) || 0; info(); }
});
document.getElementById("tap").onclick = () => { tapped = true; play(); };
</script>`;

const PORTAL = "**1) Einstieg**\n- Karikatur ~~Wer wählt?~~\n\n**2) Video: Wahlen einfach erklärt**\n- Video: https://www.youtube.com/watch?v=" + VIDEO_OK + "&feature=youtu.be (0:30–0:45)\n" +
  "- Beobachtungsauftrag ~~Wer darf wählen?~~\n\n**3) Diskussion**\n- Ist die Wahlpflicht sinnvoll?\n\n**4) Video: Das Wahlsystem**\n- https://youtu.be/" + VIDEO_BLOCKED;
// Folie → Phase: 1 Titel, 2 Videofolie, 3 Diskussion, 4 Videofolie (Titel nur auf der Folie), 5 Videofolie (Einbetten verboten)
async function videoDeck() {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), b = await d.embedFont(StandardFonts.HelveticaBold), bg = rgb(0.12, 0.23, 0.37), white = rgb(1, 1, 1);
  const hidden = (p, text) => { p.pushOperators(setTextRenderingMode(3)); p.drawText(text, { x: 20, y: 8, size: 8, font: f }); p.pushOperators(setTextRenderingMode(0)); };
  const slide = (phase, lines, mark) => {
    const p = d.addPage([960, 540]);
    p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: bg });
    lines.forEach(([t, y, s, bold]) => p.drawText(t, { x: 60, y, size: s, font: bold ? b : f, color: white }));
    if (mark) { p.drawCircle({ x: 480, y: 200, size: 60, borderColor: white, borderWidth: 4 }); p.drawSvgPath("M 0 0 L 0 60 L 52 30 Z", { x: 462, y: 230, color: white }); hidden(p, mark); }
    hidden(p, "Unterricks-Phase: " + phase);
  };
  slide(1, [["Wahlen in Deutschland", 300, 48, true]]);
  slide(2, [["Video: Wahlen einfach erklärt", 440, 40, true], ["https://www.youtube.com/watch?v=" + VIDEO_OK, 385, 22], ["Ausschnitt: 0:30–0:45", 350, 22]],
    "Unterricks-Video: https://www.youtube.com/watch?v=" + VIDEO_OK + " | Start: 0:30 | Ende: 0:45 | Titel: Wahlen einfach erklärt");
  slide(3, [["Diskussion: Ist die Wahlpflicht sinnvoll?", 300, 36, true]]);
  slide(4, [["Video: Das Wahlsystem", 440, 40, true], ["https://youtu.be/" + VIDEO_BLOCKED, 385, 22]], "Unterricks-Video: https://youtu.be/" + VIDEO_BLOCKED);
  slide(4, [["Video: Gesperrt", 440, 40, true], ["https://www.youtube.com/watch?v=" + VIDEO_NOEMBED, 385, 22]], "Unterricks-Video: https://www.youtube.com/watch?v=" + VIDEO_NOEMBED + " | Titel: Gesperrtes Video");
  return Buffer.from(await d.save());
}

export async function videoSlidesE2E({ browser, tctx, tp, BASE, T, ok, OUT, SHOT, devices, watch }) {
  const { berlinToday, addDays } = await import("../../public/shared.js");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const d0 = addDays(berlinToday(), -42), d1 = addDays(d0, 1), wd = (d) => new Date(d + "T12:00:00Z").getUTCDay();
  const u = (await T("POST", "/api/teacher/units", { subject: "powi", klass: "10G", title: "Wahlen (Videofolien)", params: { start: d0, end: d1,
    weekdays: [...new Set([d0, d1].map(wd))].map((day) => ({ day, minutes: 45, time: "10:00" })) } })).data.unit;
  await T("PATCH", "/api/teacher/units/" + u.id, { plan: { titel: "Wahlen (Videofolien)", lernaufgabe: "Wahlplakat" }, rows: [{ stundenfrage: "Wer wählt?", ablauf: ["Video"], date: d0, time: "10:00", minutes: 45 },
    { stundenfrage: "Wie wird gewählt?", ablauf: ["Video"], date: d1, time: "10:00", minutes: 45 }] });
  const ls = (await T("POST", "/api/teacher/units/" + u.id + "/sessions")).data.unit.lessons;
  const L0 = ls.find((l) => l.date === d0), L1 = ls.find((l) => l.date === d1);
  ok(!!L0 && !!L1, "Test-Kurs PoWi 10G: zwei Sitzungen in der Vergangenheit (die zweite für die Sitzungsdatei)");
  await T("PUT", "/api/teacher/lessons/" + L0.id + "/portal", { text: PORTAL, force: true });
  const lesson = (await T("GET", "/api/teacher/lessons/" + L0.id)).data.lesson;

  /* ---------- Präsentations-Prompt: wo das Video vorkommt, welcher Link, wie die Folie aufgebaut ist ---------- */
  await tp.goto(BASE + "/#/lk/s/" + L0.id);
  const card = tp.locator("section.card", { hasText: "Präsentation für den Unterricht" });
  await card.waitFor({ timeout: 15000 });
  await tp.getByRole("button", { name: "Prompt für die Präsentation kopieren" }).click();
  const prompt = await tp.evaluate(() => navigator.clipboard.readText());
  ok(prompt.includes("## Videofolien: YouTube-Videos eingebettet abspielen") && prompt.includes("- Video 1 – in Phase 2 („2) Video: Wahlen einfach erklärt“)")
    && prompt.includes("Unterricks-Video: https://www.youtube.com/watch?v=" + VIDEO_OK + " | Start: 0:30 | Ende: 0:45 | Titel: Wahlen einfach erklärt")
    && prompt.includes("- Video 2 – in Phase 4 („4) Video: Das Wahlsystem“)") && prompt.includes("Unterricks-Video: https://www.youtube.com/watch?v=" + VIDEO_BLOCKED + " | Titel: Das Wahlsystem")
    && prompt.includes("kein Vorschaubild, kein Screenshot und kein Logo von YouTube") && prompt.indexOf("## Videofolien") < prompt.indexOf("## Zeitlos gestalten"),
    "Präsentations-Prompt: je Video Phase, Link, Ausschnitt und die genaue unsichtbare Zeile samt Aufbau der Videofolie");

  /* ---------- Hochladen: Videofolien erkannt ---------- */
  await tp.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
  await card.locator("input[type=file]").first().setInputFiles({ name: "Wahlen.pdf", mimeType: "application/pdf", buffer: await videoDeck() });
  const toast = tp.locator(".toast", { hasText: "Präsentation bereit (5 Folien)." });
  await toast.waitFor({ timeout: 60000 });
  const tt = await toast.textContent();
  ok(tt.includes("Auf den Folien 2, 4, 5 spielt Unterricks im Unterricht die Videos eingebettet ab (siehe „Videofolien“)."), "Hochladen: die Meldung nennt die Videofolien – " + tt);
  const pres = (await T("GET", "/api/teacher/lessons/" + L0.id)).data.files.find((f) => f.area === "presentation");
  const PDF_VIDEOS = [{ n: 2, id: VIDEO_OK, start: 30, end: 45, title: "Wahlen einfach erklärt" }, { n: 4, id: VIDEO_BLOCKED, title: "Das Wahlsystem" }, { n: 5, id: VIDEO_NOEMBED, title: "Gesperrtes Video" }];
  ok(JSON.stringify(pres.videos) === JSON.stringify({ pdf: PDF_VIDEOS, hand: null }), "gespeichert: Folie, Kennung, Ausschnitt und Titel (bei Folie 4 aus der Überschrift) – " + JSON.stringify(pres.videos));
  await card.locator("#shown-sel").waitFor({ timeout: 15000 });
  const fig2 = card.locator('figure.thumb[data-n="2"]');
  ok(await card.locator("figure.thumb .badge.video").count() === 3 && (await fig2.getAttribute("aria-label")).includes("Videofolie: live spielt Unterricks hier das Video „Wahlen einfach erklärt“ ab"),
    "Vorschaubilder: „Video“ an den drei Videofolien, auch im Namen für Screenreader");

  /* ---------- „Videofolien“ prüfen und ändern ---------- */
  const vbox = card.locator("details#videos");
  ok((await vbox.locator("summary").textContent()) === "Videofolien – aus der PDF: Folien 2, 4, 5", "Feld „Videofolien“: zugeklappt mit Übersicht");
  await vbox.locator("summary").click();
  await vbox.locator("fieldset.videorow").first().waitFor();
  ok(await vbox.locator("fieldset.videorow").count() === 3 && await vbox.locator("#vid-url-1").inputValue() === "https://www.youtube.com/watch?v=" + VIDEO_OK
    && await vbox.locator("#vid-s-1").inputValue() === "0:30" && await vbox.locator("#vid-e-1").inputValue() === "0:45" && await vbox.locator("#vid-t-1").inputValue() === "Wahlen einfach erklärt",
    "aufgeklappt: je Videofolie Folie, Link, Start, Ende und Titel");
  await vbox.locator("#vid-url-2").fill("https://vimeo.com/123");
  await vbox.getByRole("button", { name: "Videofolien speichern" }).click();
  await vbox.locator("#video-err", { hasText: "Video 2: Das ist kein Link zu einem YouTube-Video." }).waitFor({ timeout: 5000 });
  ok(await tp.evaluate(() => document.activeElement && document.activeElement.id) === "vid-url-2", "ungültiger Link: Meldung, Fokus im Feld, nichts gespeichert");
  await vbox.locator("#vid-url-2").fill("https://youtu.be/" + VIDEO_BLOCKED);
  await vbox.locator("#vid-e-1").fill("0:50");
  await vbox.getByRole("button", { name: "Videofolien speichern" }).click();
  await vbox.locator(".save-state", { hasText: "Gespeichert – Unterricks folgt jetzt Ihren Videofolien." }).waitFor({ timeout: 10000 });
  let pv = (await T("GET", "/api/teacher/files/" + pres.id + "/slides")).data.videos;
  ok(pv.hand && pv.hand[0].end === 50 && (await vbox.locator("summary").textContent()) === "Videofolien – von Ihnen festgelegt: Folien 2, 4, 5", "geändertes Ende gespeichert (gilt vor der PDF)");
  for (const [w, scheme] of [[1366, "light"], [390, "light"], [1366, "dark"]]) {
    await tp.setViewportSize({ width: w, height: w <= 420 ? 844 : 900 }); await tp.emulateMedia({ colorScheme: scheme });
    await vbox.scrollIntoViewIfNeeded();
    await tp.screenshot({ ...SHOT, path: join(OUT, "nr38-videofolien-" + w + "-" + scheme + ".png") });
  }
  await tp.setViewportSize({ width: 1440, height: 950 }); await tp.emulateMedia({ colorScheme: null });
  // Sitzungsdatei: die Videofolien der Lehrkraft kommen mit (in die zweite Sitzung geladen)
  const moved = await tp.evaluate(async ([aId, bId]) => {
    const v = "/v/" + document.querySelector('meta[name="unterricks-build"]').content + "/";
    const IO = await import(v + "sessionio.js"), TT = await import(v + "teacher.js");
    const detail = await TT.tapi("GET", "/api/teacher/lessons/" + aId), target = (await TT.tapi("GET", "/api/teacher/lessons/" + bId)).lesson;
    const z = await IO.buildSessionZip(detail, { fb: null });
    const { data, byPath } = await IO.readSessionZip(z.bytes);
    await IO.applySessionImport(bId, IO.planSessionImport(data, target), data, byPath, { target });
    return { inFile: (data.files.find((f) => f.area === "presentation") || {}).slideVideos || null };
  }, [L0.id, L1.id]);
  const pB = (await T("GET", "/api/teacher/lessons/" + L1.id)).data.files.find((f) => f.area === "presentation");
  ok(moved.inFile && moved.inFile[0].end === 50 && pB && JSON.stringify(pB.videos.hand) === JSON.stringify(pv.hand) && JSON.stringify(pB.videos.pdf) === JSON.stringify(PDF_VIDEOS),
    "Sitzung als Datei: die Videofolien der Lehrkraft stehen in sitzung.json (slideVideos) und gelten nach dem Laden in einer anderen Sitzung");
  await vbox.getByRole("button", { name: "Videofolien aus der PDF übernehmen" }).click();
  await vbox.locator(".save-state", { hasText: "Gespeichert – es gelten wieder die Videofolien aus der PDF." }).waitFor({ timeout: 10000 });
  pv = (await T("GET", "/api/teacher/files/" + pres.id + "/slides")).data.videos;
  ok(pv.hand === null && await vbox.locator("fieldset.videorow").first().locator("input.vid-t").nth(1).inputValue() === "0:45" && (await vbox.locator("summary").textContent()) === "Videofolien – aus der PDF: Folien 2, 4, 5",
    "„aus der PDF übernehmen“: wieder die Videofolien der PDF");

  /* ---------- Schüler:in (iPad) tritt bei ---------- */
  const sctx = await browser.newContext({ ...devices["iPad (gen 7)"] });
  const sp = await sctx.newPage(); watch(sp, "Schüler (Videofolien)");
  const sFrames = [], sYt = [];
  sp.on("websocket", (ws) => ws.on("framereceived", (f) => sFrames.push(String(f.payload))));
  sp.on("request", (r) => { if (/youtube|youtu\.be|google/i.test(r.url())) sYt.push(r.url()); });
  await sp.goto(BASE + "/");
  await sp.fill("#spw", "Feindt"); await sp.getByRole("button", { name: "Weiter" }).click();
  await sp.waitForURL(/#\/schueler$/);
  await sp.getByRole("button", { name: "Politik und Wirtschaft" }).click();
  await sp.getByRole("button", { name: "10G", exact: true }).click();
  await sp.getByRole("button", { name: "Speichern und weiter" }).click();
  await sp.fill("#code", lesson.code); await sp.getByRole("button", { name: "Sitzung öffnen" }).click();
  await sp.waitForURL(/#\/schueler\/s\//);
  await sp.locator(".live").waitFor({ timeout: 15000 });

  /* ---------- Präsentation ohne getrennten Beamer (iPad bzw. Laptop gespiegelt): das Video spielt in der Präsentation selbst ---------- */
  await tp.getByRole("button", { name: "Ich bin im Unterricht und starte die Präsentation für alle." }).click();
  const pr = tp.locator(".presenter");
  await pr.waitFor();
  const counter = () => pr.locator(".counter").textContent();
  const msg = () => pr.locator(".videopane .pv-msg").textContent();
  const waitMsg = (text, timeout = 15000) => pr.locator(".videopane .pv-msg", { hasText: text }).waitFor({ timeout });
  await tp.keyboard.press("ArrowRight"); await tp.keyboard.press("ArrowRight");
  await sp.locator(".live .badge", { hasText: "Folie 2 / 5" }).waitFor({ timeout: 10000 });
  ok(await counter() === "2 / 5" && await pr.locator(".videopane").isVisible() && (await pr.locator(".videopane .pv-title").textContent()) === "Video: Wahlen einfach erklärt"
    && (await pr.locator(".videopane .pv-clip").textContent()) === "Ausschnitt 0:30–0:45" && (await msg()).startsWith("Das Video spielt hier in der Präsentation; die Schüler:innen sehen nur die Folie.")
    && await pr.locator(".stage iframe").count() === 0, "Videofolie: Feld mit Titel und Ausschnitt, „spielt hier“ – vor dem Abspielen nichts von YouTube");
  await tp.keyboard.press("ArrowRight");   // „Weiter“ startet das Video
  const frame = pr.locator(".stage iframe.ytp-frame");
  await frame.waitFor({ timeout: 10000 });
  const src = await frame.getAttribute("src");
  await waitMsg("Spielt hier in der Präsentation.");
  const cmdsOf = async (fr) => { const h = await fr.elementHandle(), c = await h.contentFrame(); return c ? c.evaluate(() => window.__cmds.slice()) : []; };
  // „Pausiert.“ zeigt die Präsentation schon nach dem gewünschten Stand (vor der Rückmeldung des Players) – der Befehl kann am Beamer(fenster) noch unterwegs sein
  const cmdsUntil = async (fr, cmd, ms = 10000) => { let c = []; for (const until = Date.now() + ms; !(c = await cmdsOf(fr)).includes(cmd) && Date.now() < until;) await sleep(100); return c; };
  const tOf = async (fr) => { const h = await fr.elementHandle(), c = await h.contentFrame(); return c ? c.evaluate(() => window.__t()) : NaN; };
  ok(await counter() === "2 / 5" && src === "https://www.youtube-nocookie.com/embed/" + VIDEO_OK + "?enablejsapi=1&autoplay=1&playsinline=1&rel=0&start=30&end=45&origin=" + encodeURIComponent(BASE)
    && await frame.getAttribute("sandbox") === "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox" && (await pr.locator(".pv-play").textContent()) === "Pause",
    "„Weiter“ auf der Videofolie startet das Video (bleibt auf Folie 2): eingebetteter Player mit Ausschnitt, Steuerung und Herkunft – " + src);
  const first = await cmdsOf(frame);
  ok(!first.some((c) => c.startsWith("seekTo")) && (await tOf(frame)) < 32, "kein Überspringen beim Start: trotz 1,5 s Ladezeit beginnt der Ausschnitt bei 0:30 (" + first.join(", ") + ")");
  ok(await sp.locator(".live iframe").count() === 0 && await sp.locator(".live > img").count() === 1, "Schüler:innen sehen dabei nur die Folie");
  await tp.screenshot({ ...SHOT, path: join(OUT, "nr38-praesentation-video-hier.png") });
  await pr.getByRole("button", { name: "Pause" }).click();
  await waitMsg("Pausiert.");
  ok((await cmdsOf(frame)).includes("pauseVideo") && (await pr.locator(".pv-play").textContent()) === "Weiter abspielen", "Pause: Befehl an den Player, Knopf „Weiter abspielen“");
  await pr.getByRole("button", { name: "10 Sekunden vor" }).click();
  await sleep(400);
  const seek = (await cmdsOf(frame)).filter((c) => c.startsWith("seekTo")).pop() || "";
  ok(/^seekTo \[4\d(\.\d)?,true\]$/.test(seek), "+10 s: springt im Video (" + seek + ")");
  await pr.getByRole("button", { name: "Weiter abspielen" }).click();
  await waitMsg("Ausschnitt zu Ende.", 15000);
  await sleep(1000);
  const atEnd = await tOf(frame), endCmds = await cmdsOf(frame);
  ok((await pr.locator(".pv-play").textContent()) === "Noch einmal abspielen" && endCmds[endCmds.length - 1] === "pauseVideo" && atEnd >= 44.5 && atEnd <= 45.5,
    "am Ende des Ausschnitts hält Unterricks das Video selbst an (der Player selbst liefe weiter): „Ausschnitt zu Ende.“, „Noch einmal abspielen“ (Stelle " + atEnd + ")");
  // Tippen ins Video: der Fokus wandert in den Player – er kommt gleich zurück, damit Pfeiltasten und Presenter weiter die Präsentation steuern
  await (await (await frame.elementHandle()).contentFrame()).locator("#s").click();
  await tp.waitForFunction(() => document.activeElement && document.activeElement.classList.contains("presenter"), null, { timeout: 5000 }).catch(() => {});
  ok(await tp.evaluate(() => !!document.activeElement && document.activeElement.classList.contains("presenter")), "nach einem Tipp ins Video liegt der Fokus wieder auf der Präsentation");
  await tp.keyboard.press("ArrowRight");   // schon gestartet: weiter zur nächsten Folie
  await sp.locator(".live .badge", { hasText: "Folie 3 / 5" }).waitFor({ timeout: 10000 });
  ok(await counter() === "3 / 5" && await pr.locator(".stage iframe").count() === 0 && !(await pr.locator(".videopane").isVisible()), "noch einmal „Weiter“: nächste Folie, der Player ist weg");

  /* ---------- Beamerfenster (Beamer als erweiterter Bildschirm) ---------- */
  const [bw] = await Promise.all([tctx.waitForEvent("page"), pr.getByRole("button", { name: "Beamerfenster öffnen" }).click()]);
  watch(bw, "Beamerfenster (Videofolien)");
  await pr.locator(".beamstate", { hasText: "Beamerfenster verbunden" }).waitFor({ timeout: 10000 });
  await tp.bringToFront();
  await tp.keyboard.press("ArrowLeft");
  await waitMsg("Das Video spielt im Beamerfenster");
  await tp.keyboard.press("ArrowRight");
  const bwFrame = bw.locator(".bm-video iframe.ytp-frame");
  await bwFrame.waitFor({ timeout: 10000 });
  await waitMsg("Spielt im Beamerfenster.");
  ok(await pr.locator(".stage iframe").count() === 0 && await pr.locator(".stage > img").count() === 1, "Beamerfenster: das Video spielt dort, die Präsentation zeigt weiter die Folie (kein Ton doppelt)");
  await bw.screenshot({ ...SHOT, path: join(OUT, "nr38-beamerfenster-video.png") });
  await pr.getByRole("button", { name: "Pause" }).click();
  await waitMsg("Pausiert.");
  ok((await cmdsUntil(bwFrame, "pauseVideo")).includes("pauseVideo"), "Pause in der Präsentation hält das Video im Beamerfenster an (Rückmeldung kommt zurück)");
  // Folie 4: der Browser blockiert das Abspielen mit Ton – Hinweis in der Präsentation, „Video abspielen“ im Beamerfenster; ein Tipp auf das Video startet es
  await tp.keyboard.press("ArrowRight"); await tp.keyboard.press("ArrowRight");
  await sp.locator(".live .badge", { hasText: "Folie 4 / 5" }).waitFor({ timeout: 10000 });
  ok(await bw.locator(".bm-video").count() === 0 && await bw.locator(".bm-stage > img").count() === 1, "Folienwechsel: der Player im Beamerfenster ist weg");
  await tp.keyboard.press("ArrowRight");
  await waitMsg("Der Browser hat das Abspielen im Beamerfenster blockiert", 15000);
  await bw.locator(".bm-vnote:not([hidden])").waitFor({ timeout: 5000 });
  ok((await bw.locator(".bm-vnote").textContent()).includes("Der Browser spielt das Video erst nach einer Bedienung an diesem Gerät ab.") && await bw.locator(".bm-vnote").getByRole("button", { name: "Video abspielen" }).count() === 1,
    "blockiert: Hinweis in der Präsentation, im Beamerfenster „Video abspielen“");
  await bw.screenshot({ ...SHOT, path: join(OUT, "nr38-beamerfenster-blockiert.png") });
  const bh = await bw.locator(".bm-video iframe.ytp-frame").elementHandle(), bf = await bh.contentFrame();
  await bf.locator("#tap").click();
  await waitMsg("Spielt im Beamerfenster.");
  ok(await bw.locator(".bm-vnote[hidden]").count() === 1, "ein Tipp auf das Video: es spielt, der Hinweis verschwindet");
  // Folie 5: YouTube erlaubt das Einbetten nicht – Meldung mit „Auf YouTube öffnen“
  await tp.keyboard.press("ArrowRight"); await tp.keyboard.press("ArrowRight");
  await waitMsg("Dieses Video darf laut YouTube nicht eingebettet werden – öffnen Sie es auf YouTube. Die Schüler:innen sehen weiter die Folie.", 15000);
  ok(await pr.locator(".videopane a.pv-yt").getAttribute("href") === "https://www.youtube.com/watch?v=" + VIDEO_NOEMBED && await counter() === "5 / 5",
    "Einbetten nicht erlaubt: Meldung und „Auf YouTube öffnen“ (Folie 5)");
  await bw.close();
  await waitMsg("Das Beamerfenster ist geschlossen – das Video wurde beendet.", 10000);
  ok(true, "Beamerfenster geschlossen, während das Video dort lief: beendet, mit Hinweis");

  /* ---------- Beamergerät (z. B. Schul-iPad an Apple TV) über den Server ---------- */
  const bctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  // WebSockets der Seite merken – so lässt sich unten ein kurzer Verbindungsabbruch (WLAN) nachstellen
  await bctx.addInitScript(() => { const W = window.WebSocket; window.__wss = []; window.WebSocket = class extends W { constructor(...a) { super(...a); window.__wss.push(this); } }; });
  const bp = await bctx.newPage(); watch(bp, "Beamergerät (Videofolien)");
  await bp.goto(BASE + "/#/beamer");
  const codeEl = bp.locator(".beamer .bm-code", { hasText: /^\d{3} \d{3}$/ });
  await codeEl.waitFor({ timeout: 15000 });
  const bcode = (await codeEl.textContent()).replace(" ", "");
  await tp.bringToFront();
  await pr.getByRole("button", { name: "Beamer verbinden" }).click();
  await tp.locator("#bmc-in").fill(bcode); await tp.keyboard.press("Enter");
  await pr.getByRole("button", { name: "Beamer verbunden" }).waitFor({ timeout: 15000 });
  for (let i = 0; i < 3; i++) await tp.keyboard.press("ArrowLeft");
  await bp.waitForFunction(() => /\/2\?/.test((document.querySelector(".beamer .bm-stage > img") || {}).src || ""), null, { timeout: 15000 });
  await waitMsg("Das Video spielt am Beamer");
  const sBefore = sFrames.length;
  await tp.keyboard.press("ArrowRight");
  const bpFrame = bp.locator(".bm-video iframe.ytp-frame");
  await bpFrame.waitFor({ timeout: 15000 });
  await waitMsg("Spielt am Beamer.", 15000);
  ok(await pr.locator(".stage iframe").count() === 0 && (await bpFrame.getAttribute("src")).includes("/embed/" + VIDEO_OK + "?enablejsapi=1&autoplay=1&playsinline=1&rel=0&start=30&end=45"),
    "Beamergerät: das Video spielt dort (über den Server), die Rückmeldung „spielt“ kommt in der Präsentation an");
  await bp.screenshot({ ...SHOT, path: join(OUT, "nr38-beamergeraet-video.png") });
  await tp.screenshot({ ...SHOT, path: join(OUT, "nr38-praesentation-video-beamer.png") });
  await pr.getByRole("button", { name: "Pause" }).click();
  await waitMsg("Pausiert.", 15000);
  ok((await cmdsUntil(bpFrame, "pauseVideo")).includes("pauseVideo"), "Pause erreicht das Beamergerät");
  await tp.keyboard.press("ArrowRight");
  await bp.waitForFunction(() => !document.querySelector(".beamer .bm-video") && /\/3\?/.test((document.querySelector(".beamer .bm-stage > img") || {}).src || ""), null, { timeout: 15000 });
  ok(true, "Folienwechsel: das Beamergerät zeigt wieder die Folie");
  // zurück zur Videofolie und abspielen; dann verliert der Beamer kurz die Verbindung: Hinweis, danach spielt das Video dort weiter (derselbe Player)
  await tp.keyboard.press("ArrowLeft");
  await bp.waitForFunction(() => /\/2\?/.test((document.querySelector(".beamer .bm-stage > img") || {}).src || ""), null, { timeout: 15000 });
  await waitMsg("Das Video spielt am Beamer");
  await tp.keyboard.press("ArrowRight");
  await bpFrame.waitFor({ timeout: 15000 });
  await waitMsg("Spielt am Beamer.", 15000);
  await (await bpFrame.elementHandle()).evaluate((el) => { el.dataset.e2e = "derselbe"; });
  await bp.evaluate(() => window.__wss.filter((w) => w.readyState === 1).forEach((w) => w.close()));
  await waitMsg("Die Verbindung zum Beamer ist unterbrochen – verbindet er sich gleich wieder, spielt das Video dort weiter.", 10000);
  await waitMsg("Spielt am Beamer.", 20000);
  ok(await bp.locator('.bm-video iframe.ytp-frame[data-e2e="derselbe"]').count() === 1 && !(await cmdsOf(bpFrame)).includes("pauseVideo"),
    "kurzer Verbindungsabbruch des Beamers: Hinweis in der Präsentation, danach läuft das Video dort weiter – derselbe Player, nicht angehalten");
  // „Beamer trennen“ (bewusst): das Video endet sofort
  await pr.getByRole("button", { name: "Beamer verbunden" }).click();
  await pr.getByRole("button", { name: "Beamer trennen" }).click();
  await waitMsg("Der Beamer ist nicht mehr verbunden – das Video wurde beendet.", 10000);
  ok(await counter() === "2 / 5" && (await pr.locator(".pv-play").textContent()) === "Video abspielen", "„Beamer trennen“: das Video endet sofort, „Video abspielen“ spielt es dann hier");
  await sleep(500);
  const sNew = sFrames.slice(sBefore).filter((x) => x !== "pong");   // „pong“ = Antwort auf das Ping der Seite alle 25 s
  ok(!sFrames.some((x) => x.includes('"video"') || x.includes("vstate")) && sNew.length === 2 && sYt.length === 0,
    "Schüler:innen: keine Nachricht zum Video (nur die beiden Folienwechsel), nie eine Anfrage an YouTube (" + sNew.length + " Nachrichten: " + sNew.map((x) => x.slice(0, 60)).join(" | ") + ")");
  await pr.getByRole("button", { name: "Präsentation für alle beenden" }).click();
  await bctx.close();

  /* ---------- nach der Stunde: Folienfenster mit dem Link zum Video ---------- */
  await sp.goto(BASE + "/#/schueler/s/" + L0.id);
  const sv = sp.locator("section.slideview");
  await sv.locator('.sv-frame > img[alt="Folie 1 von 5"]:not([hidden])').waitFor({ timeout: 15000 });
  ok(await sv.locator(".sv-video").isHidden(), "Folie 1: kein Link");
  await sv.locator(".sv-next").click();
  await sv.locator('.sv-frame:not(.loading) > img[alt="Folie 2 von 5"]:not([hidden])').waitFor({ timeout: 10000 });
  const link = sv.locator(".sv-video a.sv-vlink");
  ok(await sv.locator(".sv-video").isVisible() && await link.getAttribute("href") === "https://www.youtube.com/watch?v=" + VIDEO_OK + "&t=30s" && await link.getAttribute("target") === "_blank"
    && (await link.getAttribute("rel")) === "noopener noreferrer" && (await link.textContent()) === "Video auf YouTube ansehen: „Wahlen einfach erklärt“ (Ausschnitt 0:30–0:45) (öffnet in neuem Tab)"
    && (await sv.locator(".sv-vnote").textContent()) === "Der Link öffnet YouTube (Google) in einem neuen Tab.",
    "nach der Stunde: unter der Videofolie der Link zu YouTube (neuer Tab) – eingebettet wird nichts");
  await sp.screenshot({ ...SHOT, path: join(OUT, "nr38-folienfenster-link.png") });
  await link.focus(); await sp.keyboard.press("ArrowRight");   // vom Link aus weiterblättern: der Link verschwindet, der Fokus bleibt im Folienfenster
  await sv.locator('.sv-frame:not(.loading) > img[alt="Folie 3 von 5"]:not([hidden])').waitFor({ timeout: 10000 });
  ok(await sv.locator(".sv-video").isHidden() && sYt.length === 0 && await sp.evaluate(() => !!document.activeElement && document.activeElement.classList.contains("sv-frame")),
    "Folie 3: kein Link, der Fokus liegt im Folienfenster (nicht verloren); die Schüleransicht hat YouTube nie selbst aufgerufen");
  await sctx.close();
  for (const L of [L0, L1]) await T("DELETE", "/api/teacher/lessons/" + L.id);
  await T("DELETE", "/api/teacher/units/" + u.id);
  ok((await T("GET", "/api/teacher/units/" + u.id)).status === 404, "Test-Kurs PoWi 10G wieder gelöscht");
}
