// newernote.js – roter Hinweis „Das ist nicht die aktuellste Sitzung“ ganz oben in der Sitzung der Schüler:innen (Nachtrag 44, Teil 2, Wunsch der
// Lehrkraft vom 23.11.2026). Ob eine spätere Sitzung des Kurses schon dran ist, sagt der Server (newer in GET /api/student/lessons/:id – nur ja/nein);
// diese Datei baut nur den Hinweis. Nur DOM-APIs, nie innerHTML.
import { h, clear, icon } from "./ui.js";
import { NEWER_TITLE, NEWER_TEXT, NEWER_BUTTON } from "./shared.js";

/* → { el, set(on), on }: el = Platz direkt unter dem Kopfband – leer, solange keine spätere Sitzung dran ist. Er ist eine Live-Region: erscheint der
   Hinweis erst beim Neuladen der Daten (geplanter Beginn der späteren Sitzung, Aufwachen des Geräts), wird er angesagt, ohne den Fokus zu verschieben.
   href = Ziel des Knopfs (Eingabe des Sitzungscodes), onGo() läuft vor dem Wechsel (z. B. „dort das Feld für den Code fokussieren“). */
export function newerNote({ href = "#/schueler", onGo = null } = {}) {
  const el = h("div", { class: "newer-slot", "aria-live": "polite" });
  let on = false;
  const set = (want) => {
    want = want === true;
    if (want === on) return;
    on = want;
    const hadFocus = el.contains(document.activeElement);
    clear(el);
    if (on) {
      el.append(h("section", { class: "alarm newer-note", "aria-labelledby": "newer-h" }, icon("alert"),
        h("div", { class: "newer-body" },
          h("h2", { id: "newer-h", text: NEWER_TITLE }),
          h("p", { text: NEWER_TEXT }),
          h("a", { class: "btn newer-go", href, onclick: () => { if (onGo) onGo(); } }, NEWER_BUTTON, icon("arrow")))));
    } else if (hadFocus) {
      // der Hinweis verschwindet (spätere Sitzung verschoben), während der Fokus darin stand: nicht auf der Seite verlieren
      el.setAttribute("tabindex", "-1");
      try { el.focus({ preventScroll: true }); } catch {}
    }
  };
  return { el, set, get on() { return on; } };
}
