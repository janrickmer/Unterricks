// ytplayer.js – eingebetteter YouTube-Player einer Videofolie (Nachtrag 38): im Beamerfenster, am Beamergerät oder – ohne getrennten Beamer – in der
// Präsentationsansicht der Lehrkraft. Nur youtube-nocookie.com, erst wenn die Lehrkraft das Video abspielt; gesteuert über postMessage (wie die IFrame-API
// von YouTube, deren Skript die CSP nicht erlaubt – Protokoll siehe videoslides.js). Nie bei den Schüler:innen.
// set({playing, pos, at, rev, mute?}) = gewünschter Stand (pos Sekunden zum Zeitpunkt at = performance.now() beim Empfang); jeder neue rev wird genau einmal
// ausgeführt; replay() führt ihn nach einer Bedienung an diesem Gerät noch einmal aus. mute = dieses Gerät bleibt stumm (ein weiteres Beamergerät bzw.
// Beamerfenster – den Ton gibt nur eines); autoplay = soll gleich spielen (sonst lädt der Player angehalten). Rückmeldung onChange({ready, state, time, dur,
// blocked, err, noapi, muted}):
//  • blocked: abspielen gewünscht, aber nach YT_BLOCK_MS weder „spielt“ noch „lädt“ – der Browser verlangt einen Tipp auf das Video (Ton ohne
//    Bedienung an diesem Gerät, z. B. iPad am Apple TV),
//  • noapi: der Player antwortet nicht (Steuerung nicht möglich – das Video lässt sich trotzdem direkt bedienen),
//  • err: Fehler von YouTube (z. B. 101/150 = Einbetten nicht erlaubt), muted: läuft ohne Ton,
//  • state 0 (zu Ende) auch am Ende des Ausschnitts: Das Ende hält der Player selbst ein (pauseVideo) – auf den Parameter end der Einbettung allein ist
//    nach einem Sprung (seekTo) kein Verlass.
// Aufholen (pos + Zeit seit dem Befehl) erst ab dem zweiten Befehl: Beim ersten (Ladezeit des Players) und nach replay() (blockiert und dann angetippt)
// beginnt es an der gewünschten Stelle – sonst fehlte der Anfang des Ausschnitts. Die Präsentation übernimmt die echte Stelle aus der Rückmeldung.
import { h } from "./ui.js";
import { videoPlayerUrl, ytListen, ytCommand, ytRead, ytApply, clampPos, YT_PLAYER_ORIGIN, YT_STATE } from "./videoslides.js";

export const YT_BLOCK_MS = 4000, YT_NOAPI_MS = 12000;
const SEEK_SLACK = 1.5, END_SLACK = 0.25;

export function ytPlayer(v, { label = "", mute = false, autoplay = true, onChange = () => {} } = {}) {
  const frame = h("iframe", { class: "ytp-frame", title: "YouTube-Video: " + (label || "Video"), referrerpolicy: "strict-origin-when-cross-origin",
    allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true,
    sandbox: "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox", src: videoPlayerUrl(v, location.origin, { mute: !!mute, autoplay: !!autoplay }) });
  const el = h("div", { class: "ytp" }, frame);
  const s = { ready: false, state: YT_STATE.unstarted, time: v.start || 0, dur: 0, err: null, muted: false };
  let timeAt = performance.now(), heard = false, alive = true, listenT = null, tries = 0, blockT = null, blocked = false, noapi = false;
  let want = null, done = -1, unmuted = false, lastKey = "", lastTime = null, lastAt = 0, atEnd = false, endAt = 0, endT = null, muteNow = !!mute;
  const send = (msg) => { try { if (frame.contentWindow) frame.contentWindow.postMessage(msg, YT_PLAYER_ORIGIN); } catch {} };
  const timeNow = () => (s.state === YT_STATE.playing ? s.time + (performance.now() - timeAt) / 1000 : s.time);
  // am Ende des Ausschnitts angehalten: gilt als „zu Ende“ (YouTube meldet dann „pausiert“)
  const snap = () => ({ ready: s.ready, state: atEnd && s.state !== YT_STATE.playing ? YT_STATE.ended : s.state,
    time: v.end ? Math.min(timeNow(), v.end) : timeNow(), dur: s.dur, blocked, err: s.err, noapi, muted: s.muted });
  // Rückmeldung nur, wenn sich etwas ändert (Zustand, blockiert, Fehler …), die Stelle springt (mehr als 2 s neben der erwarteten) oder 10 s vergangen
  // sind – der Empfänger rechnet die Zeit dazwischen selbst weiter (sonst ginge am Beamergerät jede Sekunde eine Nachricht über den Server)
  const tell = () => {
    const x = snap(), key = JSON.stringify({ ...x, time: 0 }), now = performance.now();
    const expect = lastTime === null ? null : lastTime + (x.state === YT_STATE.playing ? (now - lastAt) / 1000 : 0);
    if (key === lastKey && expect !== null && Math.abs(x.time - expect) <= 2 && now - lastAt < 10000) return;
    lastKey = key; lastTime = x.time; lastAt = now;
    try { onChange(x); } catch {}
  };
  // Ende des Ausschnitts: solange es spielt, alle 250 ms nachsehen (die Rückmeldungen des Players kommen nicht genau zur rechten Zeit)
  function checkEnd() {
    if (!alive || !v.end || s.state !== YT_STATE.playing || atEnd) return;
    if (timeNow() >= v.end - END_SLACK) {
      atEnd = true; endAt = performance.now(); send(ytCommand("pauseVideo"));
      s.time = v.end; s.state = YT_STATE.paused; timeAt = performance.now();
      syncEndTimer(); tell();
    }
  }
  function syncEndTimer() {
    const need = alive && !!v.end && s.state === YT_STATE.playing && !atEnd;
    if (need && !endT) endT = setInterval(checkEnd, 250);
    else if (!need && endT) { clearInterval(endT); endT = null; }
  }

  // anmelden wie die IFrame-API: „listening“ alle 250 ms, bis der Player antwortet (höchstens 15 s)
  const listen = () => { if (heard || !alive || ++tries > 60) { clearInterval(listenT); return; } send(ytListen()); };
  frame.addEventListener("load", () => { if (!alive) return; clearInterval(listenT); tries = 0; listenT = setInterval(listen, 250); listen(); });
  const noapiT = setTimeout(() => { if (alive && !heard) { noapi = true; tell(); } }, YT_NOAPI_MS);

  function onMsg(e) {
    if (!alive || e.source !== frame.contentWindow || e.origin !== YT_PLAYER_ORIGIN) return;
    const m = ytRead(e.data);
    if (!m) return;
    if (!heard) {
      heard = true; clearInterval(listenT); clearTimeout(noapiT);
      if (noapi) noapi = false;
      send(ytCommand("addEventListener", ["onStateChange"])); send(ytCommand("addEventListener", ["onError"]));
    }
    const wasReady = s.ready, oldTime = s.time, oldState = s.state;
    if (m.event === "infoDelivery" && m.info && typeof m.info === "object" && typeof m.info.muted === "boolean") s.muted = m.info.muted;
    ytApply(s, m);
    // gerade am Ende angehalten: eine Meldung „spielt“, die noch vor dem Anhalten abgeschickt wurde, ändert nichts (sonst stünde kurz „Spielt …“ da)
    if (atEnd && s.state === YT_STATE.playing && performance.now() - endAt < 1500) { s.state = YT_STATE.paused; s.time = v.end; }
    if (s.time !== oldTime || s.state !== oldState) timeAt = performance.now();
    // nach dem Ende am Player selbst zurückgespult und wieder gestartet: zählt nicht mehr als „zu Ende“
    if (atEnd && s.state === YT_STATE.playing && s.time < v.end - 2 * END_SLACK) atEnd = false;
    if (s.state === YT_STATE.playing || s.state === YT_STATE.buffering || s.err !== null) { if (blocked) blocked = false; clearTimeout(blockT); }
    // läuft ohne Ton (Rückfall des Browsers): einmal den Ton einschalten – nur nach einer Bedienung dieser Seite (sonst hielte der Browser das Video an)
    // und nie an einem Gerät, das stumm bleiben soll
    if (!muteNow && s.muted && s.state === YT_STATE.playing && !unmuted && navigator.userActivation && navigator.userActivation.hasBeenActive) { unmuted = true; send(ytCommand("unMute")); }
    if (!wasReady && s.ready) { if (muteNow) send(ytCommand("mute")); run(); }
    checkEnd(); syncEndTimer();
    tell();
  }
  window.addEventListener("message", onMsg);

  // gewünschten Stand ausführen (erst, wenn der Player bereit ist)
  function run() {
    if (!alive || !want || !s.ready || want.rev === done) return;
    const first = done === -1;
    done = want.rev;
    const target = clampPos(v, want.playing && !first ? want.pos + Math.max(0, performance.now() - want.at) / 1000 : want.pos);
    atEnd = false;
    if (Math.abs(timeNow() - target) > SEEK_SLACK) { send(ytCommand("seekTo", [Math.max(0, Math.round(target * 10) / 10), true])); s.time = target; timeAt = performance.now(); }
    // am Ende des Ausschnitts „abspielen“ (z. B. ein Beamer, der neu dazukommt, wenn der Ausschnitt schon durch ist): nicht über das Ende hinaus
    const play = want.playing && !(v.end && target >= v.end - END_SLACK);
    if (want.playing && !play) { atEnd = true; endAt = performance.now(); if (s.state === YT_STATE.playing) s.state = YT_STATE.paused; }
    send(ytCommand(play ? "playVideo" : "pauseVideo"));
    clearTimeout(blockT);
    if (play) {
      blockT = setTimeout(() => {
        if (!alive || !want || !want.playing || s.err !== null || atEnd) return;
        if (s.state !== YT_STATE.playing && s.state !== YT_STATE.buffering) { blocked = true; tell(); }
      }, YT_BLOCK_MS);
    } else if (blocked) blocked = false;
    syncEndTimer(); tell();
  }
  return {
    el, frame,
    get video() { return v; },
    set(w) {
      if (!alive || !w || !Number.isInteger(w.rev)) return;
      // stumm (ein weiteres Gerät gibt den Ton) bzw. wieder mit Ton (es ist jetzt das erste): den Ton schaltet onMsg ein – nur nach einer Bedienung
      // dieses Geräts, ohne sie hielte der Browser das Video an
      if (typeof w.mute === "boolean" && w.mute !== muteNow) { muteNow = w.mute; unmuted = false; if (muteNow && s.ready) send(ytCommand("mute")); }
      want = { playing: !!w.playing, pos: Number(w.pos) || 0, at: Number.isFinite(w.at) ? w.at : performance.now(), rev: w.rev };
      run();
    },
    // „Video abspielen“ direkt am Gerät (Knopf über dem Player des Beamers): derselbe Stand noch einmal, jetzt mit einer Bedienung dieser Seite
    replay() { if (!alive || !want) return; done = -1; run(); },
    snapshot: snap,
    destroy() { alive = false; clearInterval(listenT); clearTimeout(blockT); clearTimeout(noapiT); clearInterval(endT); endT = null; window.removeEventListener("message", onMsg); el.remove(); },
  };
}
