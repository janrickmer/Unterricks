// beamer.js – das Beamerfenster (#/beamer): ein zweites Fenster nur mit der aktuellen Folie der Live-Präsentation – für den Beamer als
// erweiterten Bildschirm. Das Präsentationsfenster der Lehrkraft (presenter.js) zeigt daneben die nächste Folie; gesteuert wird dort, Tasten
// (auch die eines Presenters) leitet dieses Fenster weiter. Verbunden nur im Browser (BroadcastChannel derselben Herkunft) – ohne Server und
// ohne Anmeldung: Es zeigt, was das Präsentationsfenster schickt (Folienbilder per signiertem Link, Codefolie als Text).
import { h, apiUrl, setFach, rand } from "./ui.js";
import { render, onLeave } from "./app.js";
import { BEAMER_CHANNEL, beamerFollow, cleanBeamerView, presenterKey, beamerScreen } from "./shared.js";
import { codeSlideDom } from "./codeslide.js";

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const BEAMER_WAIT = "Wartet auf die Präsentation – starten Sie sie in Unterricks. Dieses Fenster zeigt dann die aktuelle Folie.";
export const BEAMER_CLOSED = "Die Präsentation ist gerade nicht geöffnet. Öffnen Sie sie wieder in Unterricks – dieses Fenster zeigt dann die aktuelle Folie.";
export const BEAMER_STOPPED = "Die Präsentation ist beendet.";

export function beamerPage() {
  const bid = hex(rand(8)), slideBase = apiUrl("/api/slide/");
  const multi = !!(window.screen && window.screen.isExtended === true && typeof window.getScreenDetails === "function");
  let st = null, idleT = null, waitT = null;
  const img = h("img", { alt: "", draggable: "false" });
  const stage = h("div", { class: "bm-stage" });
  const wait = (text) => stage.replaceChildren(h("p", { class: "bm-wait", text }));
  const isFs = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  const note = h("p", { class: "bm-note", role: "status" });
  const fsLabel = () => (isFs() ? "Vollbild beenden" : multi ? "Vollbild auf dem Beamer" : "Vollbild");
  const fsBtn = h("button", { class: "btn small", type: "button", onclick: (e) => { e.currentTarget.blur(); toggleFs(); } }, fsLabel());   // ohne Fokus: Leertaste blättert, die Leiste blendet sich aus
  const hint = h("p", { class: "bm-hint", text: (multi ? "„Vollbild auf dem Beamer“ zeigt dieses Fenster im Vollbild auf dem zweiten Bildschirm – oder ziehen Sie es auf den Beamer und klicken Sie dort auf „Vollbild“."
    : "Ziehen Sie dieses Fenster auf den Beamer (als erweiterten Bildschirm eingerichtet) und klicken Sie dort auf „Vollbild“.") +
    " Gesteuert wird im Präsentationsfenster – Pfeiltasten und Presenter funktionieren auch hier." });
  const closeBtn = h("button", { class: "btn small", type: "button", onclick: () => window.close() }, "Fenster schließen");
  const root = h("main", { class: "beamer", "aria-label": "Beamerfenster von Unterricks" }, stage, h("div", { class: "bm-bar" }, hint, note, fsBtn, closeBtn));
  render(root);
  document.title = "Unterricks – Beamerfenster";
  wait("Verbinde mit der Präsentation …");
  waitT = setTimeout(() => { if (!st) wait(BEAMER_WAIT); }, 1500);

  function show(v) {
    if (v.kind === "code") { stage.replaceChildren(codeSlideDom(v)); return; }
    if (img.getAttribute("src") !== v.src) img.src = v.src;
    if (stage.firstChild !== img || stage.childNodes.length > 1) stage.replaceChildren(img);
    if (v.next) { const p = new Image(); p.src = v.next; }   // nächste Folie vorab laden
  }
  const ch = typeof BroadcastChannel === "function" ? new BroadcastChannel(BEAMER_CHANNEL) : null;
  const tell = () => ch && ch.postMessage({ t: "following", bid, id: st && !st.ended ? st.id : null });
  if (ch) ch.onmessage = (ev) => {
    const m = ev.data;
    if (!m || typeof m !== "object") return;
    if (m.t === "who") { tell(); return; }
    if (m.t !== "claim" && m.t !== "show" && m.t !== "end") return;
    const before = st;
    st = beamerFollow(st, m);
    if (!st || st.id !== m.id) return;   // gehört zu einem anderen Präsentationsfenster
    if (m.t === "end") {
      if (before && !before.ended) {
        setFach(null); wait(m.why === "stop" ? BEAMER_STOPPED : BEAMER_CLOSED); tell();
        // nur geschlossen (nicht für alle beendet): läuft noch eine andere Präsentation (z. B. in einem zweiten Tab), übernimmt das Fenster sie
        if (m.why !== "stop") ch.postMessage({ t: "hello", bid });
      }
      return;
    }
    if (st.ended) return;
    if (m.t === "claim" || st !== before) tell();   // übernommen bzw. neu beansprucht: das Präsentationsfenster schickt dann die Folie
    if (m.t === "show") { const v = cleanBeamerView(m.view, slideBase); if (v) { setFach(typeof m.fach === "string" ? m.fach : null); show(v); } }
  };
  if (ch) ch.postMessage({ t: "hello", bid });
  else wait("Dieser Browser kann das Beamerfenster nicht mit der Präsentation verbinden. Bitte einen aktuellen Browser verwenden.");

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
    else if (a !== "preview" && ch && st && !st.ended) ch.postMessage({ t: "cmd", bid, id: st.id, cmd: a });   // steuert das Präsentationsfenster
  };
  const wake = () => { root.classList.remove("idle"); clearTimeout(idleT); idleT = setTimeout(() => root.classList.add("idle"), 2500); };
  const bye = () => { if (ch) try { ch.postMessage({ t: "bye", bid }); } catch {} };
  document.addEventListener("keydown", onKey);
  document.addEventListener("fullscreenchange", onFs);
  document.addEventListener("webkitfullscreenchange", onFs);
  root.addEventListener("mousemove", wake);
  root.addEventListener("focusin", wake);
  window.addEventListener("pagehide", bye);
  wake();
  onLeave(() => {
    bye(); if (ch) ch.close();
    clearTimeout(idleT); clearTimeout(waitT);
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("fullscreenchange", onFs);
    document.removeEventListener("webkitfullscreenchange", onFs);
    window.removeEventListener("pagehide", bye);
    document.title = "Unterricks";
  });
}
