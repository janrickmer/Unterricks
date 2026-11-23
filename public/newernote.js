// newernote.js – roter Hinweis „Das ist nicht die aktuellste Sitzung“ ganz oben in der Sitzung der Schüler:innen (Nachtrag 44, Teil 2, Wunsch der
// Lehrkraft vom 23.11.2026). Ob eine spätere Sitzung des Kurses schon dran ist, sagt der Server (newer in GET /api/student/lessons/:id – nur ja/nein);
// diese Datei baut nur den Hinweis und merkt sich den Wunsch „danach die Eingabe des Sitzungscodes fokussieren“. Nur DOM-APIs, nie innerHTML.
import { h, clear, icon } from "./ui.js";
import { NEWER_TITLE, NEWER_TEXT, NEWER_BUTTON } from "./shared.js";

/* → { el, set(on), on }: el = Platz direkt unter dem Kopfband – leer, solange keine spätere Sitzung dran ist. Er ist eine Live-Region: erscheint der
   Hinweis erst beim Neuladen der Daten (geplanter Beginn der späteren Sitzung, Abfrage in der halben Stunde davor, Aufwachen des Geräts), wird er
   angesagt, ohne den Fokus zu verschieben. href = Ziel des Knopfs (Eingabe des Sitzungscodes), onGo() läuft vor dem Wechsel (z. B. wantCodeFocus).
   Verschwindet der Hinweis, während der Fokus darin steht (spätere Sitzung verschoben), geht der Fokus auf die Überschrift der Seite (h1 im Kopfband
   direkt davor, tabindex="-1" – mit sichtbarem Fokusring, Gegenprüfung); ohne Überschrift auf den leeren Platz selbst. */
export function newerNote({ href = "#/schueler", onGo = null } = {}) {
  const el = h("div", { class: "newer-slot", "aria-live": "polite" });
  let on = false;
  const heading = () => { const p = el.previousElementSibling; return p ? (p.tagName === "H1" ? p : p.querySelector("h1")) : null; };
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
      // der Hinweis verschwindet, während der Fokus darin stand: nicht auf der Seite verlieren und sichtbar lassen
      const to = heading() || el;
      if (!to.hasAttribute("tabindex")) to.setAttribute("tabindex", "-1");
      try { to.focus({ preventScroll: true }); } catch {}
    }
  };
  return { el, set, get on() { return on; } };
}

/* „Aktuellste Sitzung laden“ → die Eingabe des Sitzungscodes bekommt danach den Fokus – auch mit schon freigeschalteten Sitzungen. Der Wunsch steht in
   sessionStorage (dieser Tab), damit er ein Neuladen beim Seitenwechsel übersteht (neuer Stand der Seite, update.js), gilt nur einmal (takeCodeFocus beim
   Zeichnen des Formulars, auch nach einer Anmeldung bzw. der Wahl von Fach und Klasse dazwischen) und höchstens CODE_FOCUS_MS; dropCodeFocus verwirft ihn
   (zurück in eine Sitzung, bevor das Formular gezeichnet war). Ohne sessionStorage (gesperrt) nur im Arbeitsspeicher. */
export const CODE_FOCUS_KEY = "u.codefocus", CODE_FOCUS_MS = 10 * 60e3;
let wantAt = 0;
const session = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };
export function wantCodeFocus(now = Date.now()) {
  wantAt = now;
  try { const s = session(); if (s) s.setItem(CODE_FOCUS_KEY, String(now)); } catch {}
}
export function takeCodeFocus(now = Date.now()) {
  let at = wantAt;
  try { const s = session(); if (s) { const v = Number(s.getItem(CODE_FOCUS_KEY)); if (Number.isFinite(v) && v > at) at = v; s.removeItem(CODE_FOCUS_KEY); } } catch {}
  wantAt = 0;
  return at > 0 && now >= at && now - at < CODE_FOCUS_MS;
}
export function dropCodeFocus() {
  wantAt = 0;
  try { const s = session(); if (s) s.removeItem(CODE_FOCUS_KEY); } catch {}
}
