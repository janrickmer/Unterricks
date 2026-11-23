// termcards.js – Karteikarten „Fachbegriffe dieser Sitzung“ in der Ansicht der Schüler:innen (Nachtrag 44, Teil 3; nur Oberstufe: E-Phase und Q1–Q4).
// Der Server liefert die Begriffe erst ab 2 Minuten vor dem Ende der Sitzung (worker/student.js); danach bleiben sie. Vorne steht der Begriff, ein Tippen,
// Klicken bzw. Enter oder Leertaste dreht die Karte, hinten steht die Definition. Barrierefrei als Aufklapp-Muster: ein echter Knopf je Karte (Name = Begriff,
// aria-expanded, aria-controls auf die Rückseite), die gerade nicht sichtbare Seite ist aria-hidden. Gedreht wird nur ohne „Bewegung reduzieren“ (3D, nur
// transform, styles.css); sonst wechselt die Seite sofort. Nur textContent – nie innerHTML. Kommen beim Neuladen dieselben Begriffe, bleibt alles stehen
// (umgedrehte Karten und Fokus gehen nicht verloren).
import { h, clear } from "./ui.js";
import { TERMS_TITLE } from "./terms.js";

export const TERMS_HINT = "Tippe auf eine Karte – auf der Rückseite steht die Erklärung.";
export const TERMS_TURN = "Umdrehen";

/* → {el, update(items)}: el ist leer, solange es keine Begriffe gibt; update nimmt [{term, definition}] (bzw. null) aus der Antwort des Servers */
export function termCards() {
  const box = h("div", { class: "termsbox-wrap" });
  let key = "", section = null;
  function card(x, k) {
    const backId = "tc-back-" + k;
    const back = h("div", { class: "tface tback", id: backId, "aria-hidden": "true" }, h("p", { class: "tback-term", text: x.term }), h("p", { class: "tdef", text: x.definition }));
    const btn = h("button", { class: "tcard-btn", type: "button", id: "tc-btn-" + k, "aria-expanded": "false", "aria-controls": backId }, h("span", { class: "sr-only", text: x.term }));
    const li = h("li", { class: "tcard" }, btn,
      h("div", { class: "tcard-in" }, h("div", { class: "tface tfront", "aria-hidden": "true" }, h("p", { class: "tterm", text: x.term }), h("p", { class: "tturn", text: TERMS_TURN })), back));
    btn.addEventListener("click", () => {
      const on = !li.classList.contains("flipped");
      li.classList.toggle("flipped", on);
      btn.setAttribute("aria-expanded", on ? "true" : "false");
      back.setAttribute("aria-hidden", on ? "false" : "true");
    });
    return li;
  }
  function update(items) {
    const xs = (Array.isArray(items) ? items : []).filter((x) => x && typeof x.term === "string" && x.term && typeof x.definition === "string");
    const k = JSON.stringify(xs.map((x) => [x.term, x.definition]));
    if (k === key) return;   // dieselben Begriffe: nichts neu zeichnen
    const had = section && section.contains(document.activeElement) ? [...section.querySelectorAll("button.tcard-btn")].indexOf(document.activeElement) : -1;
    key = k; clear(box); section = null;
    if (!xs.length) return;
    section = h("section", { class: "card termsbox", id: "terms-s", "aria-labelledby": "terms-sh" },
      h("h2", { id: "terms-sh", text: TERMS_TITLE }), h("p", { class: "hint", id: "terms-shint", text: TERMS_HINT }),
      h("ul", { class: "tcards", "aria-labelledby": "terms-sh" }, xs.map((x, i) => card(x, i + 1))));
    box.append(section);
    // geänderte Begriffe, während eine Karte den Fokus hatte: an dieselbe Stelle (sonst fiele er auf die Seite)
    if (had >= 0) { const b = section.querySelectorAll("button.tcard-btn"); (b[Math.min(had, b.length - 1)]).focus({ preventScroll: true }); }
  }
  return { el: box, update };
}
