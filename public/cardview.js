// cardview.js – Betrachter der Bildkarten (Grundschule): der Reihe nach durch die Karten klicken, darunter der gekürzte Erzähltext. Eigenes
// Modul ohne die Module der Lehrkraft, weil die Elternansicht (parents.js) ihn ebenfalls nutzt.
import { h, apiUrl, icon } from "./ui.js";

/* ---------- Betrachter: der Reihe nach durch die Karten klicken, darunter der Erzähltext (auch in der Elternansicht) ----------
   images = {base, q} (Bild n = base + n + q), reload() → neue {images} (einmal bei einem Ladefehler, z. B. abgelaufene Signatur) */
export function cardViewer({ images, pages, w, h: ht, texts = [], pdfHref = null, reload = null }) {
  const n = Math.max(0, Number(pages) || 0);
  let img = images, cur = 1, reloaded = false;
  const url = (k) => apiUrl(img.base + k + img.q);
  const pic = h("img", { class: "cv-img", alt: "", decoding: "async", ...(w && ht ? { width: String(w), height: String(ht) } : {}) });
  const count = h("span", { class: "cv-count", "aria-live": "polite" });
  const text = h("figcaption", { class: "cv-text" });
  const prev = h("button", { class: "btn", type: "button" }, icon("left"), "Vorherige Karte");
  const next = h("button", { class: "btn", type: "button" }, "Nächste Karte", icon("right"));
  const root = h("figure", { class: "cardview" }, h("div", { class: "cv-stage" }, pic), h("div", { class: "cv-nav" }, prev, count, next), text,
    pdfHref ? h("p", { class: "small cv-pdf" }, h("a", { href: pdfHref, target: "_blank", rel: "noopener" }, "Bildkarten als PDF öffnen", h("span", { class: "sr-only", text: " (öffnet in neuem Tab)" }))) : null);
  function show(k) {
    cur = Math.min(Math.max(1, k), n);
    pic.src = url(cur);
    pic.alt = "Bildkarte " + cur + " von " + n;
    count.textContent = "Karte " + cur + " von " + n;
    const t = String(texts[cur - 1] || "").trim();
    text.textContent = t || "(Zu dieser Karte gibt es keinen Erzähltext.)";
    text.classList.toggle("muted", !t);
    prev.setAttribute("aria-disabled", cur <= 1 ? "true" : "false");
    next.setAttribute("aria-disabled", cur >= n ? "true" : "false");
    if (cur < n) { const pre = new Image(); pre.src = url(cur + 1); }   // nächste Karte vorladen
  }
  pic.addEventListener("error", async () => {
    if (reloaded || !reload) return;
    reloaded = true;
    try { const r = await reload(); if (r && r.images) { img = r.images; show(cur); } } catch {}
  });
  prev.addEventListener("click", () => { if (cur > 1) show(cur - 1); });
  next.addEventListener("click", () => { if (cur < n) show(cur + 1); });
  root.addEventListener("keydown", (e) => {
    if (e.target.closest("textarea, input, select") || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft" && cur > 1) { e.preventDefault(); show(cur - 1); }
    else if (e.key === "ArrowRight" && cur < n) { e.preventDefault(); show(cur + 1); }
  });
  if (n) show(1); else { count.textContent = "Noch keine Bilder"; prev.setAttribute("aria-disabled", "true"); next.setAttribute("aria-disabled", "true"); }
  return root;
}
