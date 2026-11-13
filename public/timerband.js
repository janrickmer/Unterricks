// timerband.js – der Timer der Live-Präsentation (Nachtrag 16 der Lehrkraft vom 13.11.2026) als Band am oberen Rand der Präsentationsfläche:
// Live-Ansicht der Schüler:innen (app.js), Beamerfenster und Beamergerät (beamer.js) und die große aktuelle Folie der Lehrkraft (presenter.js).
// Restzeit groß („Noch 4:12“), darunter ein schmaler Balken (Anteil der Restzeit); letzte Minute orange, abgelaufen rot „Die Zeit ist um!“ (bleibt,
// bis die Lehrkraft den Timer schließt), pausiert „Pausiert – noch 4:12“. Keine Töne. Die Seite zählt ab dem Empfang einer Nachricht mit
// performance.now() weiter und gleicht bei jeder Nachricht neu ab – die Uhr des Geräts zählt nicht.
// Barrierefreiheit: das Band hat role="timer" (nicht live); eine getrennte, ruhige Live-Region sagt nur Start, „Noch 1 Minute“, den Ablauf
// sowie Pause und Weiter an (timerNote) – nie jede Sekunde.
import { h } from "./ui.js";
import { cleanTimer, timerAt, timerNote } from "./shared.js";

const realNow = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

/* host = Element, das während des Timers die Klasse has-timer bekommt (Raster: Band oben, Folie darunter eingepasst);
   onPaint(view) nach jedem Zeichnen (view aus timerAt oder null) – z. B. für die Knöpfe der Lehrkraft */
export function timerBand({ host = null, onPaint = null, now = realNow } = {}) {
  const text = h("span", { class: "tb-text" }), fill = h("span", { class: "tb-fill" });
  const el = h("div", { class: "tband", role: "timer", hidden: true }, text, h("span", { class: "tb-bar", "aria-hidden": "true" }, fill));
  const say = h("p", { class: "sr-only tb-say", role: "status", "aria-live": "polite" });
  let t = null, at = 0, shown = null, tick = null, sayT = null, alive = true;
  const view = (x = now()) => (t ? timerAt(t, x - at) : null);
  function paint() {
    const v = view();
    if (!v) {
      el.hidden = true; el.className = "tband"; text.textContent = "";
      if (host) host.classList.remove("has-timer");
    } else {
      el.hidden = false; el.className = "tband tb-" + v.phase;
      if (text.textContent !== v.text) text.textContent = v.text;
      fill.style.width = (Math.round(v.share * 1000) / 10) + "%";
      if (host) host.classList.add("has-timer");
    }
    const note = timerNote(shown, v);
    shown = v;
    if (note) announce(note);
    if (onPaint) onPaint(v);
    schedule(v);
  }
  // Ansage: erst leeren, dann setzen – derselbe Text („Timer: 5 Minuten“ zweimal) wird sonst nicht noch einmal vorgelesen
  function announce(msg) {
    clearTimeout(sayT); say.textContent = "";
    sayT = setTimeout(() => { if (alive) say.textContent = msg; }, 60);
  }
  // nur, solange er läuft: zum nächsten Wechsel der angezeigten Sekunde
  function schedule(v) {
    clearTimeout(tick); tick = null;
    if (!alive || !v || v.paused || v.phase === "over") return;
    tick = setTimeout(paint, ((v.left - 1) % 1000) + 5);
  }
  return {
    el, say,
    /* Timer aus einer Nachricht (null bzw. fehlend = kein Timer); x = Empfangszeitpunkt */
    set(raw, x = now()) { if (!alive) return; t = cleanTimer(raw); at = x; paint(); },
    view: () => view(),
    /* Stand jetzt – zum Weitergeben an das Beamerfenster: {left, total, paused} oder null */
    snapshot() { const v = view(); return v ? { left: Math.round(v.left), total: v.total, paused: v.paused } : null; },
    stop() { alive = false; clearTimeout(tick); clearTimeout(sayT); },
  };
}
