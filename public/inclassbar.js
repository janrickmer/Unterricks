// inclassbar.js – Knopf „Ich bin jetzt im Unterricht“ ganz oben auf der Sitzungsseite (Nachtrag 35 der Lehrkraft vom 16.11.2026; Gymnasium und Grundschule).
// Klein und fest geladen: Er blendet die vollständige Ansicht aus (sie bleibt samt Eingaben, Zeitgebern und laufender Präsentation bestehen – nichts geht
// verloren) und zeigt an ihrer Stelle die kompakte Ansicht, die erst bei Bedarf geladen wird (public/inclass.js über lazy()). „Vollständige Ansicht“ kehrt
// zurück. Der Zustand gilt je Tab für diese Sitzung (sessionStorage): Er übersteht das Neuladen und endet, sobald die Lehrkraft die Sitzung verlässt.
import { h, clear, errToast, icon } from "./ui.js";
import { onLeave } from "./app.js";
import { INCLASS_LABEL, FULL_LABEL, inClassStored, setInClassStored } from "./inclasslib.js";

export const io = { storage: () => { try { return sessionStorage; } catch { return null; } } };
export const INCLASS_LEAD = "Kompakte Ansicht für den Unterricht – Präsentation, Verlaufsplan, Material und Hausaufgabe.";
export const INCLASS_LEAD_GS = "Kompakte Ansicht für den Unterricht – Verlaufsplan, Material und Hausaufgabe.";
/* Ausfall-Eintrag (Grundschule) u. ä.: keine kompakte Ansicht – ein gemerkter Zustand dieser Sitzung gilt nicht mehr */
export const forgetInClass = (id) => setInClassStored(io.storage(), id, false);

/* id = Sitzung; full() = Elemente der vollständigen Ansicht (werden ausgeblendet); allowed() = gibt es die Ansicht gerade (nicht in einer Selbstlern-Phase
   bzw. laufenden Vertretung – die Lehrkraft ist dann nicht im Unterricht); mount(slot) → Promise<{el, destroy()}> (lädt inclass.js); gs = Grundschule.
   → {els: [Leiste, Platz der kompakten Ansicht], paint() (allowed() neu prüfen), restore() (nach dem Aufbau: gemerkten Zustand übernehmen), on()} */
export function inClassToggle({ id, full, allowed = () => true, mount, gs = false }) {
  const go = h("button", { class: "btn primary big inclass-go", type: "button", id: "inclass-go" }, INCLASS_LABEL);
  const back = h("button", { class: "btn inclass-back", type: "button", id: "inclass-back", "aria-describedby": "inclass-lead" }, icon("left"), FULL_LABEL);
  const lead = h("p", { class: "small muted inclass-lead", id: "inclass-lead", text: gs ? INCLASS_LEAD_GS : INCLASS_LEAD });
  const bar = h("div", { class: "inclass-bar", id: "inclass-bar" }, go, back, lead);
  const slot = h("div", { class: "inclass", id: "inclass" });
  let on = false, run = 0, view = null;
  const show = () => {
    bar.classList.toggle("ic-hide", !on && !allowed());
    go.classList.toggle("ic-hide", on); back.classList.toggle("ic-hide", !on); lead.classList.toggle("ic-hide", !on);
    slot.classList.toggle("ic-hide", !on);
    for (const el of full()) if (el) el.classList.toggle("ic-hide", on);
    const m = bar.closest("main"); if (m) m.classList.toggle("inclass-on", on);
  };
  async function enter(focus) {
    if (on || !allowed()) return;
    on = true; const my = ++run;
    setInClassStored(io.storage(), id, true);
    clear(slot).append(h("div", { class: "skeleton", text: "Lade die Ansicht für den Unterricht …" }));
    show();
    window.scrollTo(0, 0);
    if (focus) back.focus({ preventScroll: true });
    try {
      const v = await mount(slot);
      if (my !== run || !on) { if (v) v.destroy(); return; }
      view = v; clear(slot).append(v.el);
    } catch (e) { if (my === run) { exit(false); errToast(e); } }
  }
  function exit(focus) {
    if (!on) return;
    on = false; run++;
    const v = view; view = null;
    if (v) v.destroy();
    clear(slot);
    setInClassStored(io.storage(), id, false);
    show();
    if (focus) go.focus({ preventScroll: true });
  }
  go.addEventListener("click", () => enter(true));
  back.addEventListener("click", () => { exit(true); window.scrollTo(0, 0); });
  // die Sitzung verlassen (anderer Seitenwechsel): der Zustand endet; derselbe Aufbau dieser Sitzung (z. B. nach „Erneut laden“) behält ihn
  onLeave(() => {
    const v = view; view = null; run++;
    if (v) v.destroy();
    if ((location.hash || "") !== "#/lk/s/" + id) setInClassStored(io.storage(), id, false);
  });
  show();
  return {
    els: [bar, slot],
    on: () => on,
    // z. B. Claude hat die Sitzung inzwischen in eine Selbstlern-Phase umgebaut: zurück zur vollständigen Ansicht, Knopf weg
    paint() { if (on && !allowed()) exit(bar.contains(document.activeElement) || slot.contains(document.activeElement)); show(); },
    // gemerkter Zustand (Neuladen dieses Tabs) – nicht beim Sprung zur Druckliste (#/lk/s/<id>/druckliste)
    restore() { if ((location.hash || "") === "#/lk/s/" + id && inClassStored(io.storage(), id) && allowed()) enter(false); },
  };
}
