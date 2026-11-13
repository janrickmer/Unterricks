// beamer.js – das Beamerfenster (#/beamer): nur die aktuelle Folie der Live-Präsentation – für den Beamer. Zwei Quellen, eine Anzeige:
//  • lokal (wie bisher): ein Präsentationsfenster im selben Browser (presenter.js) – für den Beamer als erweiterten Bildschirm. Das
//    Präsentationsfenster zeigt daneben die nächste Folie; gesteuert wird dort, Tasten (auch die eines Presenters) leitet dieses Fenster
//    weiter. Verbunden nur im Browser (BroadcastChannel derselben Herkunft) – ohne Server und ohne Anmeldung: Es zeigt, was das
//    Präsentationsfenster schickt (Folienbilder per signiertem Link, Codefolie als Text). Hat Vorrang, solange es dieses Fenster beansprucht.
//  • Server (Nachtrag 15 der Lehrkraft vom 13.11.2026): Meldet sich binnen 1,5 s kein Präsentationsfenster, ist dies ein Beamergerät (z. B.
//    ein Schul-iPad, das an Apple TV spiegelt, oder ein PC am Beamer). Es zeigt groß einen Beamer-Code; die Lehrkraft gibt ihn in der
//    Präsentation unter „Beamer verbinden“ ein. Danach kommt die aktuelle Folie über das Durable Object der Sitzung (WebSocket, ersatzweise
//    alle 2 s abgefragt; worker/beamer.js). Gekoppelt bleibt es auch nach dem Neuladen (localStorage u.beamer), bis die Lehrkraft es trennt
//    oder der Schlüssel nach 6 Stunden abläuft. Ohne Präsentation zeigt es wieder einen Code – für die nächste Stunde in diesem Raum.
//    Den Code fragt es als lange Abfrage ab (der Server hält sie bis zu 12 s); hat zwei Stunden lang niemand einen Code eingegeben und niemand
//    das Gerät berührt, holt es keinen neuen mehr (ein vergessenes Gerät verbraucht sonst Tag und Nacht das Tageskontingent des Servers) –
//    Tippen, Klicken oder „Neuen Beamer-Code anzeigen“ holt wieder einen.
//  Timer (Nachtrag 16): steht oben über der Folie, wie bei den Schüler:innen – lokal vom Präsentationsfenster (show bzw. timer mit dem Stand
//  zum Sendezeitpunkt), am Beamergerät vom Server; nur solange eine Folie zu sehen ist (nicht über dem Beamer-Code).
import { h, api, apiUrl, wsUrl, setFach, rand, store } from "./ui.js";
import { render, onLeave } from "./app.js";
import { BEAMER_CHANNEL, beamerFollow, cleanBeamerView, presenterKey, beamerScreen, fmtBeamerCode, normBeamerCode, readBeamerLink, readBeamerPair } from "./shared.js";
import { codeSlideDom } from "./codeslide.js";
import { timerBand } from "./timerband.js";

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const BEAMER_WAIT = "Wartet auf die Präsentation – starten Sie sie in Unterricks. Dieses Fenster zeigt dann die aktuelle Folie.";
export const BEAMER_CLOSED = "Die Präsentation ist gerade nicht geöffnet. Öffnen Sie sie wieder in Unterricks – dieses Fenster zeigt dann die aktuelle Folie.";
export const BEAMER_STOPPED = "Die Präsentation ist beendet.";
// Beamergerät (über den Server)
export const BEAMER_PAIR_HOW = "Tippen Sie in der Präsentation auf Ihrem iPad auf „Beamer verbinden“ und geben Sie diesen Code ein.";
export const BEAMER_PAIR_TTL = "Der Code gilt 10 Minuten – danach erscheint hier von selbst ein neuer.";
export const BEAMER_LINKED = "Verbunden. Sobald die Präsentation läuft, erscheint hier die aktuelle Folie.";
export const BEAMER_CUT = "Getrennt – dieses Gerät zeigt keine Präsentation mehr.";
export const BEAMER_PAIR_IDLE = "Seit zwei Stunden hat hier niemand einen Beamer-Code eingegeben – dieses Gerät holt deshalb keinen neuen mehr.";
export const BEAMER_PAIR_AGAIN = "Neuen Beamer-Code anzeigen";
export const BEAMER_PAIR_IDLE_MS = 2 * 3600e3;
export const BEAMER_DEV_HINT = "Dieses Gerät zeigt am Beamer nur die aktuelle Folie. Gesteuert wird auf dem Gerät der Lehrkraft – Tasten und Presenter wirken hier nicht. " +
  "Am Beamer-iPad die „Automatische Sperre“ am besten auf „Nie“ stellen.";
const LINK_KEY = "u.beamer";
// noch nicht abgeholter Beamer-Code dieses Tabs: nach dem Neuladen bleibt er stehen (ein schon abgelesener Code koppelt sonst ein Gerät, das ihn
// nicht mehr abfragt – die Lehrkraft sähe „Beamer gekoppelt – verbindet sich …“, der Beamer aber weiter einen anderen Code)
const PAIR_KEY = "u.beamerpair";
const tabStore = {
  get() { try { return sessionStorage.getItem(PAIR_KEY); } catch { return null; } },
  set(p) { try { sessionStorage.setItem(PAIR_KEY, JSON.stringify(p)); } catch {} },
  del() { try { sessionStorage.removeItem(PAIR_KEY); } catch {} },
};

export function beamerPage() {
  const bid = hex(rand(8)), slideBase = apiUrl("/api/slide/");
  const multi = !!(window.screen && window.screen.isExtended === true && typeof window.getScreenDetails === "function");
  let st = null, idleT = null, waitT = null, alive = true, seq = 0;
  const img = h("img", { alt: "", draggable: "false" });
  const stage = h("div", { class: "bm-stage" });
  const wait = (text) => { seq++; stage.replaceChildren(h("p", { class: "bm-wait", text })); syncTimer(); };
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const note = h("p", { class: "bm-note", role: "status" });
  const fsLabel = () => (isFs() ? "Vollbild beenden" : multi ? "Vollbild auf dem Beamer" : "Vollbild");
  const fsBtn = h("button", { class: "btn small", type: "button", onclick: (e) => { e.currentTarget.blur(); toggleFs(); } }, fsLabel());   // ohne Fokus: Leertaste blättert, die Leiste blendet sich aus
  const hint = h("p", { class: "bm-hint", text: (multi ? "„Vollbild auf dem Beamer“ zeigt dieses Fenster im Vollbild auf dem zweiten Bildschirm – oder ziehen Sie es auf den Beamer und klicken Sie dort auf „Vollbild“."
    : "Ziehen Sie dieses Fenster auf den Beamer (als erweiterten Bildschirm eingerichtet) und klicken Sie dort auf „Vollbild“.") +
    " Gesteuert wird im Präsentationsfenster – Pfeiltasten und Presenter funktionieren auch hier." });
  const closeBtn = h("button", { class: "btn small", type: "button", onclick: () => window.close() }, "Fenster schließen");
  const tband = timerBand({ onPaint: (v) => root.classList.toggle("has-timer", !!v) });   // Raster: Band oben, Folie darunter eingepasst
  const root = h("main", { class: "beamer", "aria-label": "Beamerfenster von Unterricks" }, tband.el, stage, h("div", { class: "bm-bar" }, hint, note, fsBtn, closeBtn), tband.say);
  // Timer: je Quelle der zuletzt empfangene Stand mit seinem Empfangszeitpunkt; angezeigt nur über einer Folie
  let localTimer = null, srvTimer = null, tbSrc = null;
  function syncTimer() {
    const showing = stage.firstChild === img || !!(stage.firstChild && stage.firstChild.classList && stage.firstChild.classList.contains("codeslide"));
    const src = !alive || !showing ? null : localOn() ? localTimer : dev && srvLive && srvLive.active ? srvTimer : null;
    if (src === tbSrc) return;   // dieselbe Nachricht: das Band zählt selbst weiter
    tbSrc = src;
    tband.set(src ? src.raw : null, src ? src.at : undefined);
  }
  render(root);
  document.title = "Unterricks – Beamerfenster";
  wait("Verbinde mit der Präsentation …");
  waitT = setTimeout(() => { if (!st) enterDevice(); }, 1500);

  function show(v) {
    seq++;
    if (v.kind === "code") { stage.replaceChildren(codeSlideDom(v)); syncTimer(); return; }
    if (img.getAttribute("src") !== v.src) img.src = v.src;
    if (stage.firstChild !== img || stage.childNodes.length > 1) stage.replaceChildren(img);
    if (v.next) { const p = new Image(); p.src = v.next; }   // nächste Folie vorab laden
    syncTimer();
  }
  const localOn = () => !!(st && !st.ended);
  let localFach = null, localNote = "";
  const ch = typeof BroadcastChannel === "function" ? new BroadcastChannel(BEAMER_CHANNEL) : null;
  const tell = () => ch && ch.postMessage({ t: "following", bid, id: st && !st.ended ? st.id : null });
  if (ch) ch.onmessage = (ev) => {
    const m = ev.data;
    if (!m || typeof m !== "object") return;
    if (m.t === "who") { tell(); return; }
    if (m.t === "timer") {   // nur der Timer hat sich geändert (Präsentationsfenster, dem dieses Fenster folgt)
      if (st && !st.ended && st.id === m.id) { localTimer = { raw: m.timer || null, at: performance.now() }; syncTimer(); }
      return;
    }
    if (m.t !== "claim" && m.t !== "show" && m.t !== "end") return;
    const before = st;
    st = beamerFollow(st, m);
    if (!st || st.id !== m.id) return;   // gehört zu einem anderen Präsentationsfenster
    if (m.t === "end") {
      if (before && !before.ended) {
        localTimer = null;
        if (dev) { localNote = m.why === "stop" ? BEAMER_STOPPED : BEAMER_CLOSED; setFach(srvFach); paint(); }   // Beamergerät: wieder Server bzw. Code
        else { setFach(null); wait(m.why === "stop" ? BEAMER_STOPPED : BEAMER_CLOSED); }
        tell(); syncHold();
        // nur geschlossen (nicht für alle beendet): läuft noch eine andere Präsentation (z. B. in einem zweiten Tab), übernimmt das Fenster sie
        if (m.why !== "stop") ch.postMessage({ t: "hello", bid });
      }
      return;
    }
    if (st.ended) return;
    if (m.t === "claim" || st !== before) tell();   // übernommen bzw. neu beansprucht: das Präsentationsfenster schickt dann die Folie
    if (m.t === "show") {
      const v = cleanBeamerView(m.view, slideBase);
      if (v) { localFach = typeof m.fach === "string" ? m.fach : null; localNote = ""; localTimer = { raw: m.timer || null, at: performance.now() }; setFach(localFach); show(v); codeSince = null; stopPairing(); syncHold(); }
    }
  };

  /* ---------- Beamergerät: Beamer-Code, Kopplung und Live-Verbindung über den Server ---------- */
  let dev = false, link = null, srvLive = null, srvWas = false, srvNote = "", srvFach = null;
  const pairMsg = h("p", { class: "bm-msg", role: "status" });
  const pairCode = h("p", { class: "bm-code", "aria-live": "polite", "aria-atomic": "true" });
  const pairState = h("p", { class: "bm-ttl" });
  const pairAgain = h("button", { class: "btn bm-again", type: "button", hidden: true, onclick: () => attend() }, BEAMER_PAIR_AGAIN);
  const pairBox = h("div", { class: "bm-pair" }, pairMsg, h("p", { class: "bm-k", text: "Beamer-Code" }), pairCode,
    h("p", { class: "bm-how", text: BEAMER_PAIR_HOW }), pairState, pairAgain);
  function enterDevice() {
    if (dev || !alive) return;
    dev = true;
    root.classList.add("bm-device");
    root.setAttribute("aria-label", "Beamer von Unterricks");
    document.title = "Unterricks – Beamer";   // so heißt auch das Lesezeichen bzw. das Symbol auf dem Home-Bildschirm
    hint.textContent = BEAMER_DEV_HINT;
    // ein Tab aus einem Lesezeichen lässt sich nicht per Skript schließen – stattdessen zurück zur Startseite (wer „Dieses Gerät als Beamer
    // verwenden“ versehentlich angetippt hat, z. B. in der Web-App vom Home-Bildschirm ohne Zurück-Knopf, steckt sonst fest)
    if (!window.opener) closeBtn.replaceWith(h("a", { class: "btn small", href: "#/" }, "Zur Startseite"));
    link = readBeamerLink(store.get(LINK_KEY));
    if (!link) store.del(LINK_KEY);
    pair = link ? null : readBeamerPair(tabStore.get());   // nach dem Neuladen: derselbe Code, solange er gilt
    if (!pair) tabStore.del();
    syncHold();
    if (link) connect();
    paint();
  }
  function srvView(m) {
    if (!m || !m.active) return null;
    const v = m.view === "code" ? { kind: "code", code: m.code, title: m.title, lines: m.lines }
      : { kind: "img", src: typeof m.url === "string" ? apiUrl(m.url) : "", next: typeof m.next === "string" ? apiUrl(m.next) : null };
    return cleanBeamerView(v, slideBase);
  }
  // was das Beamergerät gerade zeigt: Folie vom Server, „Verbinde …“ oder den Beamer-Code (mit Hinweis, z. B. „Die Präsentation ist beendet.“)
  function paint() {
    if (!alive || !dev || localOn()) return;
    const v = srvView(srvLive);
    if (v) { codeSince = null; stopPairing(); setFach(srvFach); showSrv(v); syncTimer(); return; }
    if (link && !srvLive) { codeSince = null; stopPairing(); wait("Verbinde mit der Präsentation …"); return; }
    if (codeSince === null) codeSince = Date.now();
    seq++;
    pairMsg.textContent = srvNote || localNote || (link && srvLive && !srvWas ? BEAMER_LINKED : "");
    if (stage.firstChild !== pairBox) stage.replaceChildren(pairBox);
    syncTimer();
    paintCode();
    ensurePairing();
  }
  // Folie vom Server: erst geladen anzeigen – ein spät geladenes Bild überschreibt nie einen neueren Stand
  function showSrv(v) {
    const my = ++seq;
    if (v.kind === "code") stage.replaceChildren(codeSlideDom(v));
    else if (img.getAttribute("src") === v.src && img.complete && img.naturalWidth > 0) { if (stage.firstChild !== img || stage.childNodes.length > 1) stage.replaceChildren(img); }
    else {
      const pre = new Image();
      pre.onload = () => { if (my !== seq || !alive || localOn()) return; img.src = v.src; if (stage.firstChild !== img || stage.childNodes.length > 1) stage.replaceChildren(img); syncTimer(); };
      pre.src = v.src;
    }
    if (v.next) { const p = new Image(); p.src = v.next; }   // nächste Folie vorab laden
  }

  // Beamer-Code: nur solange er zu sehen ist (Seite sichtbar, keine Folie) und das Gerät nicht seit zwei Stunden unbeachtet Codes zeigt –
  // sonst fragt das Gerät nicht nach
  let pair = null, pairBusy = false, pairPolling = false, pairT = null, pairFails = 0, pairErr = "", codeSince = null;
  const pairIdle = () => codeSince !== null && Date.now() - codeSince >= BEAMER_PAIR_IDLE_MS;
  const wantPair = () => alive && dev && !localOn() && !srvView(srvLive) && !(link && !srvLive) && document.visibilityState === "visible" && !pairIdle();
  function paintCode() {
    const off = pairIdle();
    pairBox.classList.toggle("off", off);
    pairAgain.hidden = !off;
    pairCode.textContent = pair && !off ? fmtBeamerCode(pair.code) : "";
    pairCode.classList.toggle("wait", !pair || off);
    pairState.textContent = off ? BEAMER_PAIR_IDLE : pairErr || (pair ? BEAMER_PAIR_TTL : "Beamer-Code wird geholt …");
  }
  // jemand ist am Gerät (Tippen, Klicken, wieder sichtbar): die zwei Stunden beginnen neu, ein abgestelltes Gerät holt wieder einen Code
  function attend() {
    if (!alive || !dev || codeSince === null) return;
    const was = pairIdle();
    codeSince = Date.now();
    if (was) { paintCode(); syncHold(); ensurePairing(); }
  }
  function stopPairing() { clearTimeout(pairT); pairT = null; }
  function ensurePairing(delay = 2000) {
    if (!wantPair()) {
      stopPairing();
      if (pairIdle()) { pair = null; paintCode(); syncHold(); }   // abgestellt: der alte Code verschwindet, die Bildschirmsperre darf wieder greifen
      return;
    }
    if (!pair || Date.now() >= pair.until) { if (!pairBusy) newPair(); }
    else if (!pairT && !pairPolling) pairT = setTimeout(pollPair, delay);
  }
  async function newPair() {
    stopPairing(); pairBusy = true; pair = null; paintCode();
    try {
      const r = await api("POST", "/api/beamer/pair");
      if (!alive) return;
      if (!normBeamerCode(r.code) || typeof r.pairKey !== "string") throw new Error("Ungültige Antwort");
      pair = { code: r.code, pairKey: r.pairKey, until: Date.now() + Math.max(60e3, Math.min(600e3, Number(r.ttlMs) || 600e3)) };
      tabStore.set(pair);
      pairFails = 0; pairErr = "";
    } catch (e) {
      if (!alive) return;
      pairFails++;
      pairErr = e && e.status === 429 ? e.message : "Keine Verbindung zum Server – neuer Versuch in wenigen Sekunden.";
      pairT = setTimeout(() => { pairT = null; ensurePairing(); }, e && e.status === 429 && e.data && e.data.retryAfter ? Math.min(600e3, e.data.retryAfter * 1000) : Math.min(30e3, 3000 * pairFails));
    } finally { pairBusy = false; }
    if (!alive) return;
    paintCode();
    if (pair) ensurePairing();
  }
  async function pollPair() {
    pairT = null;
    if (!wantPair() || !pair) return ensurePairing();
    if (Date.now() >= pair.until) return newPair();
    const p = pair, t0 = Date.now();
    pairPolling = true;
    try {
      // lange Abfrage: der Server antwortet, sobald gekoppelt ist, sonst nach bis zu 12 s
      const r = await api("POST", "/api/beamer/pair/poll", { body: { code: p.code, pairKey: p.pairKey, wait: true } });
      pairPolling = false;
      if (!alive || pair !== p) return;
      if (r.paired === true) { pair = null; adopt({ lessonId: r.lessonId, key: r.key, exp: r.exp }); return; }
      if (pairErr) { pairErr = ""; paintCode(); }
    } catch (e) {
      pairPolling = false;
      if (!alive || pair !== p) return;
      if (e && e.status === 404) { pair = null; return ensurePairing(); }   // abgelaufen: neuer Code
      return ensurePairing();
    }
    ensurePairing(Math.max(250, 2000 - (Date.now() - t0)));   // gleich weiter – höchstens alle 2 s, falls der Server nicht wartet
  }
  // gekoppelt (auch an eine andere Sitzung): Schlüssel merken und verbinden
  function adopt(l) {
    tabStore.del();   // abgeholt: diesen Code gibt es nicht mehr
    const v = readBeamerLink(JSON.stringify(l));
    if (!v) { ensurePairing(); return; }
    closeLive();
    link = v; store.set(LINK_KEY, JSON.stringify(v));
    srvLive = null; srvWas = false; srvNote = ""; localNote = ""; srvTimer = null;
    connect(); paint();
  }
  function dropLink(why) {
    closeLive();
    link = null; store.del(LINK_KEY);
    srvLive = null; srvWas = false; srvNote = why || ""; srvFach = null; srvTimer = null;
    if (!localOn()) setFach(null);
    paint();
  }

  // Live-Verbindung wie die Schüler:innen-Seite: WebSocket mit Ping und Wiederverbindung, ersatzweise alle 2 s abfragen
  let ws = null, wsFails = 0, pingT = null, reT = null, pollT = null, run = 0;
  function closeLive() {
    run++; clearInterval(pingT); clearTimeout(reT); clearInterval(pollT); pollT = null; wsFails = 0;
    const w = ws; ws = null; if (w) try { w.close(); } catch {}
  }
  function onLive(m) {
    if (!m || typeof m !== "object" || m.t !== "state") return;   // die Zahl der Verbundenen ist nur für die Lehrkraft
    srvTimer = { raw: m.active ? m.timer || null : null, at: performance.now() };   // vor der Prüfung von v: der Timer ändert v nicht
    if (srvLive && m.v === srvLive.v && !!m.active === !!srvLive.active) { syncTimer(); return; }
    const was = !!(srvLive && srvLive.active);
    srvLive = m;
    if (m.active) { srvWas = true; srvNote = ""; localNote = ""; } else if (was) srvNote = BEAMER_STOPPED;
    paint();
  }
  const gone = (e) => !!e && (e.status === 403 || e.status === 404);
  function lost() { if (!link) return; dropLink(link.exp <= Date.now() ? "" : BEAMER_CUT); }
  async function livePoll() {
    const l = link; if (!l) return;
    try { const r = await api("POST", "/api/beamer/live", { body: { lessonId: l.lessonId, key: l.key } }); if (alive && link === l) onLive(r.live); }
    catch (e) { if (alive && link === l && gone(e)) lost(); }
  }
  const startPoll = () => { if (!pollT) { livePoll(); pollT = setInterval(livePoll, 2000); } };
  async function connect() {
    const my = ++run, l = link;
    if (!l || !alive) return;
    try {
      const t = await api("POST", "/api/beamer/live-ticket", { body: { lessonId: l.lessonId, key: l.key } });
      if (my !== run || !alive) return;
      srvFach = typeof t.fach === "string" ? t.fach : null;
      if (!localOn()) setFach(srvFach);
      const sock = new WebSocket(wsUrl(t.url));
      ws = sock;
      sock.onopen = () => { if (my !== run) return; wsFails = 0; clearInterval(pollT); pollT = null; clearInterval(pingT); pingT = setInterval(() => { try { sock.send("ping"); } catch {} }, 25000); };
      sock.onmessage = (ev) => { if (my !== run || ev.data === "pong") return; try { onLive(JSON.parse(ev.data)); } catch {} };
      sock.onclose = (ev) => {
        clearInterval(pingT);
        if (my !== run || !alive) return;
        if (ev.code === 4001) { lost(); return; }   // die Lehrkraft hat den Beamer getrennt
        wsFails++; if (wsFails >= 2) startPoll();
        reT = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(wsFails, 4)));
      };
    } catch (e) {
      if (my !== run || !alive) return;
      if (gone(e)) { lost(); return; }   // getrennt, abgelaufen oder Sitzung gelöscht: neuer Code
      wsFails++; if (wsFails >= 2) startPoll();
      reT = setTimeout(connect, 5000);
    }
  }

  // Bildschirmsperre verhindern, solange dieses Gerät als Beamer dient bzw. eine Folie zeigt – sonst sperrt sich ein spiegelndes iPad und
  // AirPlay bricht ab (ohne Unterstützung still)
  let lock = null, lockWant = false;
  async function syncHold() {
    lockWant = alive && ((dev && (!!link || !pairIdle())) || localOn());
    if (!lockWant) { const l = lock; lock = null; if (l) try { await l.release(); } catch {} return; }
    if (lock || !navigator.wakeLock || typeof navigator.wakeLock.request !== "function" || document.visibilityState !== "visible") return;
    try {
      const l = await navigator.wakeLock.request("screen");
      if (!lockWant || lock) { try { await l.release(); } catch {} return; }
      lock = l; l.addEventListener("release", () => { if (lock === l) lock = null; });
    } catch {}
  }
  const onVis = () => {
    if (document.visibilityState !== "visible") { stopPairing(); return; }
    attend();
    syncHold();
    if (!dev) return;
    if (link && (!ws || ws.readyState > 1)) { clearTimeout(reT); connect(); }
    if (link) livePoll();
    paint();
  };
  document.addEventListener("visibilitychange", onVis);

  async function toggleFs() {
    if (isFs()) { try { await (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch {} return; }
    const el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) { note.textContent = "Dieser Browser kann kein Vollbild öffnen."; wake(); return; }
    note.textContent = "";
    let screen = null;
    if (multi) { try { screen = beamerScreen(await window.getScreenDetails()); } catch {} }   // ohne Erlaubnis: Vollbild hier
    try { await req.call(el, screen ? { screen } : undefined); }
    catch {
      try { await req.call(el); }
      catch { note.textContent = "Das Vollbild ließ sich nicht öffnen – bitte noch einmal auf „" + fsLabel() + "“ klicken."; wake(); }
    }
  }
  const onFs = () => { fsBtn.textContent = fsLabel(); if (isFs()) note.textContent = ""; };
  const onControl = (t) => !!(t && t.closest && t.closest("button, a[href], input, select, textarea"));
  const onKey = (e) => {
    const a = presenterKey(e, onControl(e.target));   // Enter/Leertaste auf „Vollbild“ bzw. „Fenster schließen“ lösen den Knopf aus
    if (!a) return;
    if (a === "next" || a === "prev") e.preventDefault();
    if (a === "fs") toggleFs();
    else if (a !== "preview" && a !== "timer" && ch && st && !st.ended) ch.postMessage({ t: "cmd", bid, id: st.id, cmd: a });   // steuert das Präsentationsfenster
  };
  const wake = () => { root.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => root.classList.add("idle"), 2500); };
  const bye = () => { if (ch) try { ch.postMessage({ t: "bye", bid }); } catch {} };
  document.addEventListener("keydown", onKey);
  document.addEventListener("fullscreenchange", onFs);
  document.addEventListener("webkitfullscreenchange", onFs);
  root.addEventListener("mousemove", wake);
  root.addEventListener("pointerdown", wake);   // iPad: Tippen zeigt die Leiste
  root.addEventListener("pointerdown", () => attend());
  root.addEventListener("focusin", wake);
  window.addEventListener("pagehide", bye);
  wake();
  if (ch) ch.postMessage({ t: "hello", bid });
  else { clearTimeout(waitT); enterDevice(); }   // ohne BroadcastChannel geht es nur über den Server
  onLeave(() => {
    alive = false;
    tband.stop();
    bye(); if (ch) ch.close();
    clearTimeout(idleT); clearTimeout(waitT); stopPairing(); closeLive(); syncHold();
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("fullscreenchange", onFs);
    document.removeEventListener("webkitfullscreenchange", onFs);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("pagehide", bye);
    document.title = "Unterricks";
  });
}
