// portalview.js – Vorschau eines Schulportal-Eintrags (Schulportal-Zeichen) samt internem Zwischenstopp-Feld.
import { h, icon } from "./ui.js";
import { parsePortalMarkup } from "./shared.js";

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

/* kleines Kontextmenü an Mausposition */
export function contextMenu(x, y, items) {
  document.querySelectorAll(".ctxmenu").forEach((m) => m.remove());
  const menu = h("div", { class: "ctxmenu", role: "menu" }, items.map((it) => h("button", { type: "button", role: "menuitem", class: it.danger ? "danger" : "", onclick: () => { close(); it.onClick(); } }, it.label)));
  const close = () => { menu.remove(); document.removeEventListener("mousedown", outside, true); document.removeEventListener("keydown", esc, true); window.removeEventListener("scroll", close, true); };
  const outside = (e) => { if (!menu.contains(e.target)) close(); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(x, window.innerWidth - r.width - 8)) + "px";
  menu.style.top = Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) + "px";
  setTimeout(() => { document.addEventListener("mousedown", outside, true); document.addEventListener("keydown", esc, true); window.addEventListener("scroll", close, true); }, 0);
  const first = menu.querySelector("button"); if (first) first.focus();
  return close;
}
