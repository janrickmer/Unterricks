// ytplayer.js – eingebetteter YouTube-Player einer Videofolie (Nachtrag 38): im Beamerfenster, am Beamergerät oder – ohne getrennten Beamer – in der
// Präsentationsansicht der Lehrkraft. Nur youtube-nocookie.com, erst wenn die Lehrkraft das Video abspielt; gesteuert über postMessage (wie die IFrame-API
// von YouTube, deren Skript die CSP nicht erlaubt – Protokoll siehe videoslides.js). Nie bei den Schüler:innen.
// set({playing, pos, at, rev}) = gewünschter Stand; replay() führt ihn nach einer Bedienung an diesem Gerät noch einmal aus (pos Sekunden zum Zeitpunkt at = performance.now() beim Empfang); jeder neue rev wird genau einmal
// ausgeführt. Rückmeldung onChange({ready, state, time, dur, blocked, err, noapi, muted}):
//  • blocked: abspielen gewünscht, aber nach YT_BLOCK_MS weder „spielt“ noch „lädt“ – der Browser verlangt einen Tipp auf das Video (Ton ohne
//    Bedienung an diesem Gerät, z. B. iPad am Apple TV),
//  • noapi: der Player antwortet nicht (Steuerung nicht möglich – das Video lässt sich trotzdem direkt bedienen),
//  • err: Fehler von YouTube (z. B. 101/150 = Einbetten nicht erlaubt), muted: läuft ohne Ton.
import { h } from "./ui.js";
import { videoPlayerUrl, ytListen, ytCommand, ytRead, ytApply, YT_PLAYER_ORIGIN, YT_STATE } from "./videoslides.js";

export const YT_BLOCK_MS = 4000, YT_NOAPI_MS = 12000;
const SEEK_SLACK = 1.5;

export function ytPlayer(v, { label = "", onChange = () => {} } = {}) {
  const frame = h("iframe", { class: "ytp-frame", title: "YouTube-Video: " + (label || "Video"), referrerpolicy: "strict-origin-when-cross-origin",
    allow: "autoplay; encrypted-media; picture-in-picture; fullscreen", allowfullscreen: true,
    sandbox: "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox", src: videoPlayerUrl(v, location.origin) });
  const el = h("div", { class: "ytp" }, frame);
  const s = { ready: false, state: YT_STATE.unstarted, time: v.start || 0, dur: 0, err: null, muted: false };
  let timeAt = performance.now(), heard = false, alive = true, listenT = null, tries = 0, blockT = null, blocked = false, noapi = false;
  let want = null, done = -1, unmuted = false, lastKey = "", lastTime = null, lastAt = 0;
  const send = (msg) => { try { if (frame.contentWindow) frame.contentWindow.postMessage(msg, YT_PLAYER_ORIGIN); } catch {} };
  const snap = () => ({ ready: s.ready, state: s.state, time: timeNow(), dur: s.dur, blocked, err: s.err, noapi, muted: s.muted });
  // Rückmeldung nur, wenn sich etwas ändert (Zustand, blockiert, Fehler …), die Stelle springt (mehr als 2 s neben der erwarteten) oder 10 s vergangen
  // sind – der Empfänger rechnet die Zeit dazwischen selbst weiter (sonst ginge am Beamergerät jede Sekunde eine Nachricht über den Server)
  const tell = () => {
    const x = snap(), key = JSON.stringify({ ...x, time: 0 }), now = performance.now();
    const expect = lastTime === null ? null : lastTime + (x.state === YT_STATE.playing ? (now - lastAt) / 1000 : 0);
    if (key === lastKey && expect !== null && Math.abs(x.time - expect) <= 2 && now - lastAt < 10000) return;
    lastKey = key; lastTime = x.time; lastAt = now;
    try { onChange(x); } catch {}
  };
  const timeNow = () => (s.state === YT_STATE.playing ? s.time + (performance.now() - timeAt) / 1000 : s.time);

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
    const wasReady = s.ready, oldTime = s.time;
    if (m.event === "infoDelivery" && m.info && typeof m.info === "object" && typeof m.info.muted === "boolean") s.muted = m.info.muted;
    ytApply(s, m);
    if (s.time !== oldTime || m.event === "onStateChange") timeAt = performance.now();
    if (s.state === YT_STATE.playing || s.state === YT_STATE.buffering || s.err !== null) { if (blocked) blocked = false; clearTimeout(blockT); }
    // läuft ohne Ton (Rückfall des Browsers): einmal den Ton einschalten – nur nach einer Bedienung dieser Seite (sonst hielte der Browser das Video an)
    if (s.muted && s.state === YT_STATE.playing && !unmuted && navigator.userActivation && navigator.userActivation.hasBeenActive) { unmuted = true; send(ytCommand("unMute")); }
    if (!wasReady && s.ready) run();
    tell();
  }
  window.addEventListener("message", onMsg);

  // gewünschten Stand ausführen (erst, wenn der Player bereit ist)
  function run() {
    if (!alive || !want || !s.ready || want.rev === done) return;
    done = want.rev;
    const pos = want.playing ? want.pos + Math.max(0, performance.now() - want.at) / 1000 : want.pos;
    if (Math.abs(timeNow() - pos) > SEEK_SLACK) { send(ytCommand("seekTo", [Math.max(0, Math.round(pos * 10) / 10), true])); s.time = pos; timeAt = performance.now(); }
    send(ytCommand(want.playing ? "playVideo" : "pauseVideo"));
    clearTimeout(blockT);
    if (want.playing) {
      blockT = setTimeout(() => {
        if (!alive || !want || !want.playing || s.err !== null) return;
        if (s.state !== YT_STATE.playing && s.state !== YT_STATE.buffering) { blocked = true; tell(); }
      }, YT_BLOCK_MS);
    } else if (blocked) { blocked = false; tell(); }
  }
  return {
    el, frame,
    get video() { return v; },
    set(w) { if (!alive || !w || !Number.isInteger(w.rev)) return; want = { playing: !!w.playing, pos: Number(w.pos) || 0, at: Number.isFinite(w.at) ? w.at : performance.now(), rev: w.rev }; run(); },
    // „Abspielen“ direkt am Gerät (Knopf über dem Player des Beamers): derselbe Stand noch einmal, jetzt mit einer Bedienung dieser Seite
    replay() { if (!alive || !want) return; done = -1; run(); },
    snapshot: snap,
    destroy() { alive = false; clearInterval(listenT); clearTimeout(blockT); clearTimeout(noapiT); window.removeEventListener("message", onMsg); el.remove(); },
  };
}
