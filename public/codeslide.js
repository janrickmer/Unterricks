// codeslide.js – die Codefolie: Sitzungscode und QR-Code zu Unterricks, wie „Für den Beamer zeigen“. Dieselbe Folie zeigt der
// Präsentationsmodus vor Folie 1 und an Platzhalterfolien der PDF (Überschrift = Aufforderung und Materialtitel von dort) und die
// Live-Ansicht der Schüler:innen. Größen relativ zur Fläche (Container-Einheiten, styles.css .codeslide) – Vollbild wie 16:9-Kästchen.
import { h } from "./ui.js";
import { PUBLIC_URL, formatCode } from "./shared.js";

export const CODE_SLIDE_HOW = (site) => "QR-Code scannen oder " + site + " öffnen → Passwort → Klasse und Fach → Code eingeben";

/* code = Sitzungscode (roh oder formatiert), title = Überschrift ohne Platzhalter (Titel der Sitzung), lines = Überschrift einer
   Platzhalterfolie (Aufforderung, Materialtitel); alles nur als Text eingesetzt */
export function codeSlideDom({ code, title = "", lines = [] }) {
  const site = PUBLIC_URL.replace(/^https:\/\//, "");
  const task = Array.isArray(lines) && lines.length > 0;
  const head = task ? lines : [title || "Sitzungscode"];
  return h("div", { class: "codeslide" + (task ? " cs-task" : "") },
    h("div", { class: "cs-in" },
      h("div", { class: "cs-head" }, ...head.map((t) => h("div", { class: "cs-line", text: String(t) }))),
      h("div", { class: "cs-grid" },
        h("div", { class: "c", text: formatCode(String(code || "")) }),
        h("figure", { class: "qrbox" },
          h("img", { class: "qr", src: "qr-unterricks.svg", alt: "QR-Code zu " + PUBLIC_URL, width: "296", height: "296" }),
          h("figcaption", { text: site }))),
      h("p", { class: "cs-how", text: CODE_SLIDE_HOW(site) })));
}
