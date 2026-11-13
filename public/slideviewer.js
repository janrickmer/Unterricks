// slideviewer.js – Folienfenster der Schüleransicht nach der Sitzung (Nachtrag 19, Wunsch der Lehrkraft vom 13.11.2026): statt eines Knopfs
// zeigt die Seite die Präsentation selbst – zuerst Folie 1, „Vorherige Folie“/„Nächste Folie“, nur bis zur markierten letzten gezeigten Folie
// (wie die heruntergeladene PDF) – und darunter „Diese Präsentation herunterladen“.
// Die Folienbilder holt die Seite blockweise als kurzlebige, signierte Links (fetchSlides); der Server liefert nie eine Folie jenseits der
// Markierung. Ein spät geladenes Bild überschreibt nie eine neuere Auswahl; Nachbarfolien werden vorgeladen. Ohne Folienbilder (ältere
// Präsentation) bleibt nur der Hinweis mit dem Download.
import { h, icon, busy } from "./ui.js";
import { STUDENT_SLIDE_BLOCK } from "./shared.js";

export const SV_TEXT = {
  title: "Präsentation aus dem Unterricht",
  cut: "So weit, wie ihr im Unterricht gekommen seid.",
  prev: "Vorherige Folie", next: "Nächste Folie",
  download: "Diese Präsentation herunterladen",
  keys: "Mit den Pfeiltasten nach links und rechts blätterst du durch die Folien.",
  loadErr: "Diese Folie konnte gerade nicht geladen werden.",
  retry: "Erneut versuchen",
  noSlides: "Die Folien lassen sich hier nicht anzeigen. Lade dir die Präsentation herunter, um sie durchzusehen.",
  fsOn: "Vollbild", fsOff: "Vollbild beenden",
};
export const slideCount = (n, total) => "Folie " + n + " von " + total;
const SWIPE_PX = 40, LOADING_DELAY_MS = 250, EXP_MARGIN_MS = 60e3;

/* o: { total, cut, fetchSlides(from, to) → { total, slides: [{ n, url, w, h }], exp }, download() → Promise, now() (Uhr des Servers),
        image() → neues Bild (Tests), onStale() (Freigabe oder Präsentation hat sich geändert: Seite neu laden) } */
export function slideViewer(o) {
  const B = STUDENT_SLIDE_BLOCK, now = o.now || (() => Date.now()), makeImage = o.image || (() => new Image());
  let total = Math.max(1, Number(o.total) || 1), n = 1, seq = 0, alive = true, staleSaid = false, loadT = null, ratioSet = false;
  const blocks = new Map(), warm = new Map();   // Block → { p, exp, map }, vorgeladene Bilder (Verweis hält sie im Speicher)

  const img = h("img", { alt: "", draggable: "false", hidden: true });
  const spin = h("span", { class: "sv-spin", "aria-hidden": "true" });
  const errText = h("p", { class: "sv-errtext" });
  const retry = h("button", { class: "btn sv-retry", type: "button" }, SV_TEXT.retry);
  const err = h("div", { class: "sv-err", hidden: true }, errText, retry);
  const keysId = "sv-keys-" + Math.random().toString(36).slice(2, 8);
  const frame = h("div", { class: "sv-frame loading", tabindex: "0", role: "group", "aria-label": "Folienfenster", "aria-describedby": keysId }, img, spin, err);
  const lbl = (t) => h("span", { class: "sv-lbl", text: t });
  const prev = h("button", { class: "btn sv-prev", type: "button" }, icon("left"), lbl(SV_TEXT.prev));
  const next = h("button", { class: "btn sv-next", type: "button" }, lbl(SV_TEXT.next), icon("right"));
  const count = h("p", { class: "sv-count" });
  // Vollbild: der Knopf steht unter dem Fenster (nichts verdeckt die Folie); im Vollbild beendet ihn ein Knopf in der Leiste
  const fsBtn = h("button", { class: "btn sv-fs", type: "button" }, icon("expand"), SV_TEXT.fsOn);
  const exitBtn = h("button", { class: "btn sv-exit", type: "button", hidden: true }, icon("x"), lbl(SV_TEXT.fsOff));
  const bar = h("div", { class: "sv-bar" }, prev, count, next, exitBtn);
  const live = h("span", { class: "sr-only", role: "status" });
  // aria-live="off": die Seite (#app) ist eine Live-Region – Zähler und Bild sollen nicht doppelt angesagt werden (das macht live)
  const stage = h("div", { class: "sv-stage", "aria-live": "off" }, frame, bar, h("span", { class: "sr-only", id: keysId, text: SV_TEXT.keys }));
  const dl = h("button", { class: "btn primary sv-dl", type: "button" }, icon("download"), SV_TEXT.download);
  const dlMsg = h("p", { class: "sv-dlmsg small", role: "status" });
  const el = h("section", { class: "card slideview", "aria-labelledby": "sv-h" },
    h("h2", { id: "sv-h", text: SV_TEXT.title }),
    o.cut ? h("p", { class: "muted small sv-cut", text: SV_TEXT.cut }) : null,
    stage, live, h("div", { class: "sv-dlrow" }, dl, fsBtn), dlMsg);

  const paintBar = () => {
    count.textContent = slideCount(n, total);
    img.setAttribute("alt", slideCount(n, total));
    prev.setAttribute("aria-disabled", String(n <= 1));
    next.setAttribute("aria-disabled", String(n >= total));
  };
  const stale = () => { if (!staleSaid && o.onStale) { staleSaid = true; o.onStale(); } };
  const fresh = (b) => b && (b.exp === undefined || now() < b.exp - EXP_MARGIN_MS);
  // Links eines Blocks (Folie b·B+1 … b·B+B); force = neu holen (abgelaufen oder ein Bild ließ sich nicht laden)
  function block(b, force) {
    const have = blocks.get(b);
    if (have && !force && (have.p || fresh(have))) return have.p || Promise.resolve(have);
    const from = b * B + 1;
    const ent = { p: null, exp: 0, map: new Map() };
    ent.p = o.fetchSlides(from, Math.min(total, from + B - 1)).then((r) => {
      ent.p = null; ent.exp = Number(r && r.exp) || undefined;
      for (const s of (r && r.slides) || []) if (Number.isInteger(s.n) && s.url) ent.map.set(s.n, s);
      if (r && Number.isInteger(r.total) && r.total >= 1 && r.total !== total) { total = r.total; if (n > total) n = total; paintBar(); }
      ent.noSlides = !((r && r.slides) || []).length;
      return ent;
    }, (e) => { if (blocks.get(b) === ent) blocks.delete(b); throw e; });
    blocks.set(b, ent);
    return ent.p;
  }
  const slideOf = async (k, force) => (await block(Math.floor((k - 1) / B), force)).map.get(k) || null;

  function setRatio(s) {
    if (ratioSet || !s || !(s.w > 0) || !(s.h > 0)) return;
    ratioSet = true; frame.style.setProperty("--sv-ar", s.w + " / " + s.h);
  }
  function fail(e) {
    clearTimeout(loadT); frame.classList.remove("loading"); img.hidden = true;
    errText.textContent = e && typeof e.status === "number" && e.message ? e.message : SV_TEXT.loadErr;
    err.hidden = false;
    live.textContent = slideCount(n, total) + ": " + errText.textContent;
    if (e && (e.code === "not_yet" || e.code === "not_found" || e.code === "not_shown")) stale();
  }
  function noSlidesFallback() {
    if (!alive) return;
    stage.replaceWith(h("p", { class: "sv-none", text: SV_TEXT.noSlides }));
    fsBtn.remove();
    live.textContent = "";
  }
  async function show(k, { say = false, force = false } = {}) {
    n = Math.min(Math.max(1, k), total);
    paintBar();
    const my = ++seq;
    err.hidden = true;
    clearTimeout(loadT); loadT = setTimeout(() => { if (my === seq && alive) frame.classList.add("loading"); }, LOADING_DELAY_MS);
    if (say) live.textContent = slideCount(n, total);
    let s;
    try { s = await slideOf(n, force); }
    catch (e) {
      if (my !== seq || !alive) return;
      // Markierung inzwischen zurückgesetzt: bis zur neuen letzten Folie zeigen (und die Seite neu laden lassen)
      const t = e && e.code === "not_shown" && e.data ? Number(e.data.total) : NaN;
      if (Number.isInteger(t) && t >= 1 && t < n) { total = t; stale(); return show(t, { say: true }); }
      return fail(e);
    }
    if (my !== seq || !alive) return;
    if (!s) {
      const first = blocks.get(0);
      if (first && first.noSlides && n <= B) return noSlidesFallback();   // ältere Präsentation ohne Folienbilder
      return fail(null);
    }
    setRatio(s);
    const pre = makeImage();
    pre.onload = () => {
      if (my !== seq || !alive) return;   // inzwischen eine andere Folie gewählt: dieses Bild nicht mehr zeigen
      clearTimeout(loadT); frame.classList.remove("loading");
      img.src = pre.src; img.hidden = false; err.hidden = true;
      preload(n + 1); preload(n - 1);
    };
    pre.onerror = () => {
      if (my !== seq || !alive) return;
      if (!force) show(n, { force: true });   // Link abgelaufen bzw. Markierung geändert: Links einmal neu holen
      else fail(null);
    };
    pre.src = s.url;
  }
  function preload(k) {
    if (k < 1 || k > total) return;
    slideOf(k).then((s) => {
      if (!alive || !s || warm.get(k) === s.url) return;
      const p = makeImage(); p.src = s.url; warm.set(k, s.url);
      if (warm.size > 8) warm.delete(warm.keys().next().value);
    }, () => {});
  }
  const step = (d) => { const k = Math.min(Math.max(1, n + d), total); if (k !== n) show(k, { say: true }); };

  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  retry.addEventListener("click", () => {
    const had = err.contains(document.activeElement);   // der Knopf verschwindet gleich: den Fokus ins Fenster statt auf die Seite
    show(n, { say: true, force: true });
    if (had || document.activeElement === document.body) frame.focus();
  });
  // Pfeiltasten, solange das Fenster (oder ein Knopf darin) den Fokus hat
  stage.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const d = { ArrowRight: 1, ArrowLeft: -1, PageDown: 1, PageUp: -1 }[e.key];
    if (d) { e.preventDefault(); step(d); }
    else if (e.key === "Home" || e.key === "End") { e.preventDefault(); const k = e.key === "Home" ? 1 : total; if (k !== n) show(k, { say: true }); }
    else if (e.key === "Escape" && stage.classList.contains("max")) { e.preventDefault(); toggleFs(); }   // Ebene ohne Vollbild-Schnittstelle
  });
  // Wischen (iPad, Handy): waagerecht über das Fenster; senkrecht scrollt die Seite weiter (touch-action: pan-y)
  let sw = null;
  frame.addEventListener("pointerdown", (e) => { sw = e.pointerType === "mouse" ? null : { id: e.pointerId, x: e.clientX, y: e.clientY }; });
  frame.addEventListener("pointerup", (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x, dy = e.clientY - sw.y; sw = null;
    if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  });
  frame.addEventListener("pointercancel", () => { sw = null; });

  // Vollbild für das Fenster samt Knöpfen; ohne Vollbild-Schnittstelle (iPhone) als Ebene über der Seite
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  let wasFull = false;
  const paintFs = () => {
    const on = fsEl() === stage || stage.classList.contains("max");
    stage.classList.toggle("full", on);
    exitBtn.hidden = !on;
    // hinein: der Knopf „Vollbild“ liegt außerhalb – Fokus ins Fenster (Pfeiltasten); heraus: zurück auf „Vollbild“, wenn er im Fenster war
    if (on && !wasFull && (document.activeElement === fsBtn || document.activeElement === document.body)) frame.focus();
    if (!on && wasFull && (stage.contains(document.activeElement) || document.activeElement === document.body) && fsBtn.isConnected) fsBtn.focus();
    wasFull = on;
  };
  function toggleFs() {
    if (stage.classList.contains("max")) { stage.classList.remove("max"); paintFs(); return; }
    if (fsEl()) { const x = document.exitFullscreen || document.webkitExitFullscreen; if (x) x.call(document); return; }
    const fs = stage.requestFullscreen || stage.webkitRequestFullscreen;
    const max = () => { stage.classList.add("max"); paintFs(); };
    if (!fs) return max();
    try { const p = fs.call(stage); if (p && p.catch) p.catch(max); } catch { max(); }
  }
  fsBtn.addEventListener("click", toggleFs);
  exitBtn.addEventListener("click", toggleFs);
  document.addEventListener("fullscreenchange", paintFs);
  document.addEventListener("webkitfullscreenchange", paintFs);

  dl.addEventListener("click", () => busy(dl, async () => {
    dlMsg.textContent = "";
    try { await o.download(); }
    catch (e) { dlMsg.textContent = (e && e.message) || "Das Herunterladen hat nicht geklappt. Bitte versuch es noch einmal."; }
  }, "Lade …"));

  paintBar();
  show(1);
  return {
    el,
    get n() { return n; }, get total() { return total; },
    go: (k) => show(k, { say: true }),
    destroy() {
      alive = false; clearTimeout(loadT); warm.clear();
      document.removeEventListener("fullscreenchange", paintFs);
      document.removeEventListener("webkitfullscreenchange", paintFs);
      stage.classList.remove("max");
      if (fsEl() === stage) { const x = document.exitFullscreen || document.webkitExitFullscreen; try { const p = x && x.call(document); if (p && p.catch) p.catch(() => {}); } catch {} }
    },
  };
}
