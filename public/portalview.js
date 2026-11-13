// portalview.js – Vorschau eines Schulportal-Eintrags (Schulportal-Zeichen) samt internem Zwischenstopp-Feld.
import { h, icon } from "./ui.js";
import { parsePortalMarkup, parsePlanMarkup } from "./shared.js";

export function runsNodes(runs) {
  return runs.map((r) => {
    let n = r.href ? h("a", { href: r.href, target: "_blank", rel: "noopener noreferrer", text: r.text.length > 60 ? r.text.slice(0, 57) + "…" : r.text }) : document.createTextNode(r.text);
    if (r.code) n = h("code", null, n);
    if (r.sup) n = h("sup", null, n);
    if (r.sub) n = h("sub", null, n);
    if (r.i) n = h("em", null, n);
    if (r.u) n = h("u", null, n);
    if (r.s) n = h("s", null, n);
    if (r.b) n = h("strong", null, n);
    return n;
  });
}

export const stopField = () => h("div", { class: "stopfield", role: "note" }, h("span", { class: "stopicon" }, icon("pause")),
  h("span", null, h("strong", { text: "Zwischenstopp" }), " – bis hierher geschafft, ab hier weiterarbeiten"));

/* Vorschau in box schreiben; jede Zeile trägt data-line (Index im Text) für das Kontextmenü.
 * Ab dem Zwischenstopp liegt ein „Abdeckblatt“ auf dem Rest: noch nicht aufgedeckt, aber lesbar. */
export function paintPortalPreview(box, text) {
  while (box.firstChild) box.firstChild.remove();
  let ul = null, target = box;
  parsePortalMarkup(text).forEach((ln, i) => {
    if (ln.type === "li") {
      if (!ul) { ul = h("ul"); target.append(ul); }
      ul.append(h("li", { dataset: { line: String(i) } }, runsNodes(ln.runs)));
      return;
    }
    ul = null;
    if (ln.type === "stop") {
      box.append(h("div", { dataset: { line: String(i) } }, stopField()));
      target = h("div", { class: "covered", "aria-label": "Noch nicht aufgedeckt (nach dem Zwischenstopp)" });
      box.append(target);
    } else target.append(ln.type === "blank" ? h("div", { class: "pl", dataset: { line: String(i) } }) : h("p", { class: "pl", dataset: { line: String(i) } }, runsNodes(ln.runs)));
  });
  return box;
}
export const portalPreview = (text) => paintPortalPreview(h("div", { class: "portal-preview", "aria-label": "Schulportal-Eintrag" }), text);

/* „wird gedruckt …“ gilt nur für von Claude gestaltetes Material, dessen PDF noch fehlt (Dateien der Sitzung tragen design, die anderer Sitzungen
   designed). Hochgeladene Dateien öffnen immer – auch Bildkarten, deren Bilder noch entstehen oder sich nicht erstellen ließen: ihre PDF liegt vor. */
export const refPending = (f) => !!f && !!(f.design || f.designed) && f.status !== "ready";

/* Verlaufsplan (Grundschule): wie die Vorschau des Schulportal-Eintrags; jeder Verweis [[pdf:<id>]] wird zum gelb markierten Link mit dem
   aktuellen Namen der Datei, der sie in einem neuen Tab öffnet. opt = {fileOf(id) → Datei {name, status} oder null, href(id), onPending(datei)} */
export function paintPlanPreview(box, text, opt = {}) {
  const fileOf = opt.fileOf || (() => null), href = opt.href || ((id) => "#/lk/datei/" + id);
  const nodes = (runs) => runs.map((r) => {
    if (r.file === undefined) return runsNodes([r])[0];
    const f = fileOf(r.file);
    let n;
    if (!f) n = h("span", { class: "pdfref missing", title: "[[pdf:" + r.file + "]]", text: "PDF nicht gefunden" });
    else {
      const pending = refPending(f);
      n = h("a", { class: "pdfref", href: href(r.file), target: "_blank", rel: "noopener", dataset: { file: r.file } }, f.name + (pending ? " (wird gedruckt …)" : ""),
        h("span", { class: "sr-only", text: " (PDF, öffnet in neuem Tab)" }));
      // es zählt der Stand beim Klick: Ist die PDF inzwischen gedruckt, öffnet sie – auch wenn der Verlaufsplan noch nicht neu gezeichnet ist
      if (pending) n.addEventListener("click", (e) => { const cur = fileOf(r.file); if (!refPending(cur)) return; e.preventDefault(); if (opt.onPending) opt.onPending(cur); });
    }
    if (r.i) n = h("em", null, n);
    if (r.u) n = h("u", null, n);
    if (r.s) n = h("s", null, n);
    if (r.b) n = h("strong", null, n);
    return n;
  });
  while (box.firstChild) box.firstChild.remove();
  let ul = null, target = box;
  parsePlanMarkup(text).forEach((ln, i) => {
    if (ln.type === "li") {
      if (!ul) { ul = h("ul"); target.append(ul); }
      ul.append(h("li", { dataset: { line: String(i) } }, nodes(ln.runs)));
      return;
    }
    ul = null;
    if (ln.type === "stop") {
      box.append(h("div", { dataset: { line: String(i) } }, stopField()));
      target = h("div", { class: "covered", "aria-label": "Noch nicht geschafft (nach dem Zwischenstopp)" });
      box.append(target);
    } else target.append(ln.type === "blank" ? h("div", { class: "pl", dataset: { line: String(i) } }) : h("p", { class: "pl", dataset: { line: String(i) } }, nodes(ln.runs)));
  });
  return box;
}

/* kleines Kontextmenü an Mausposition. Beim Schließen (Esc, Auswahl, Tab, Klick daneben) geht der Fokus zurück an das Element, das ihn vorher
   hatte (z. B. „PDF-Verweis einfügen …“) – aber nur, wenn er noch im Menü liegt (sonst fiele er auf body). Tab schließt das Menü: Der Fokus geht
   an den Auslöser zurück, und Tab geht von dort aus weiter (das Menü hängt am Ende der Seite und bliebe sonst offen stehen). */
export function contextMenu(x, y, items) {
  document.querySelectorAll(".ctxmenu").forEach((m) => m.remove());
  const opener = document.activeElement;
  let closed = false;
  const menu = h("div", { class: "ctxmenu", role: "menu" }, items.map((it) => h("button", { type: "button", role: "menuitem", class: it.danger ? "danger" : "", onclick: () => { close(); it.onClick(); } }, it.label)));
  const close = (how) => {   // how = "away": der Fokus geht gerade woandershin – dann nicht zurückholen
    if (closed) return;
    closed = true;
    const a = document.activeElement, back = how !== "away" && (!a || a === document.body || menu.contains(a));
    menu.remove(); document.removeEventListener("mousedown", outside, true); document.removeEventListener("keydown", esc, true); window.removeEventListener("scroll", close, true);
    if (back && opener && opener !== document.body && opener.isConnected && typeof opener.focus === "function") opener.focus({ preventScroll: true });
  };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  menu.addEventListener("keydown", (e) => { if (e.key === "Tab") close(); });
  menu.addEventListener("focusout", (e) => { if (e.relatedTarget && !menu.contains(e.relatedTarget)) close("away"); });
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + "px";
  setTimeout(() => { document.addEventListener("mousedown", outside, true); document.addEventListener("keydown", esc, true); window.addEventListener("scroll", close, true); }, 0);
  const first = menu.querySelector("button"); if (first) first.focus();
  return close;
}
