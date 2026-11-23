// lessondocs.js – Karte „Alle Unterlagen dieser Sitzung“ (Nachtrag 41) ganz unten auf den Sitzungsseiten (session.js, gssession.js). Leicht: der ZIP-Ordner
// selbst (lessonzip.js mit pdf-lib, PDF.js und PowerPoint) wird erst beim Klick geladen.
import { lazy } from "./update.js";
import { h, busy, modal, confirmDialog, downloadBlob, errToast, toast, fmtBytes, icon, stateLine } from "./ui.js";

export const LESSON_DOCS = {
  title: "Alle Unterlagen dieser Sitzung",
  button: "Alle Unterlagen herunterladen (ZIP)",
  gym: "Ein ZIP-Ordner mit allem, was Sie für diese Sitzung brauchen: der Verlaufsplan (mit Hausaufgabe, Links, Feibeitsblättern und Ihrer Zusammenfassung), " +
    "die Präsentation als PDF und als PowerPoint (Ihre Notizen stehen in der Referentenansicht) samt Notizen zu den Folien, alle Materialien und Arbeitsblätter " +
    "sowie die Druckvorlagen mit Anzahl und Druckart im Dateinamen.",
  gs: "Ein ZIP-Ordner mit allem, was Sie für diese Sitzung brauchen: der Verlaufsplan (mit Hausaufgabe und Ihrer Zusammenfassung), alle Materialien – " +
    "Vorlesetexte, Bildkarten und Arbeitsblätter – sowie die Druckvorlagen mit Anzahl und Druckart im Dateinamen.",
  hint: "„Sitzung als Datei“ darüber ist dagegen zum Wiederladen in Unterricks gedacht.",
  unsavedTitle: "Ungespeicherte Änderungen",
  unsaved: (parts) => "Ihre Änderungen an " + parts.join(", ").replace(/, ([^,]*)$/, " und $1") + " sind noch nicht gespeichert – im Ordner steht der zuletzt gespeicherte Stand. Trotzdem jetzt herunterladen?",
};

/* gs = Grundschule, st = Stand der Seite, before() = Verlaufsplan bzw. Schulportal-Eintrag und Hausaufgabe sichern → {portal, homework} (Stand der Felder),
   dirty() = Namen der übrigen Teile mit ungespeicherten Änderungen (Notizen, Zusammenfassung, Gegenstände), box = materialBox der Seite (packPrint,
   cardsMissingText, waitWhy), course = Kurs der Grundschule */
export function lessonDocsCard({ gs = false, st, before, dirty = () => [], box, course = null }) {
  const state = h("span", { class: "save-state", role: "status" });
  const btn = h("button", { class: "btn", type: "button", id: "lessondocs-btn" }, icon("download"), LESSON_DOCS.button);
  btn.addEventListener("click", async () => {
    if (btn.disabled) return;
    const open = dirty().filter(Boolean);
    if (open.length && !(await confirmDialog(LESSON_DOCS.unsavedTitle, LESSON_DOCS.unsaved(open), "Trotzdem herunterladen"))) return;
    const guard = (ev) => { ev.preventDefault(); ev.returnValue = ""; };
    window.addEventListener("beforeunload", guard);
    let r = null;
    try {
      r = await busy(btn, async () => {
        try {
          const cur = await before();
          const { buildLessonZip } = await lazy(import("./lessonzip.js"));
          const out = await buildLessonZip({ st, gs, course, portal: cur.portal, homework: cur.homework, packPrint: box.packPrint, cardsNote: box.cardsMissingText,
            waitWhy: box.waitWhy, onStep: (m) => stateLine(state, m) });
          downloadBlob(out.blob, out.name, 10 * 60e3);
          const n = out.paths.length;
          stateLine(state, "Heruntergeladen: " + out.name + " (" + fmtBytes(out.blob.size) + ", " + n + " Datei" + (n === 1 ? "" : "en") + ")", "ok");
          return out;
        } catch (e) { stateLine(state, ""); errToast(e); return null; }
      }, "Stelle den Ordner zusammen …");
    } finally { window.removeEventListener("beforeunload", guard); }
    if (!r || !r.notes.length) { if (btn.isConnected && (!document.activeElement || document.activeElement === document.body)) btn.focus(); return; }
    // inzwischen eine andere Seite: kein Dialog über fremdem Inhalt – die Hinweise als Meldung, mit dem Namen des Ordners
    if (!btn.isConnected) { toast("„" + r.name + "“: " + r.notes.join(" "), "", 15000); return; }
    // der Knopf war gesperrt (der Fokus fiel auf die Seite): zurück auf ihn, dann die Hinweise; „Fertig“ gibt den Fokus an ihn zurück
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) btn.focus();
    modal({ title: "Hinweise zum Ordner", wide: true, body: (el) => el.append(
      h("p", { class: "small", text: "Der Ordner „" + r.name + "“ ist heruntergeladen. Bitte beachten Sie:" }),
      h("ul", { class: "small" }, r.notes.map((x) => h("li", { text: x })))), actions: [{ label: "Fertig", class: "primary" }] });
  });
  return h("section", { class: "card lessondocs", id: "lessondocs" },
    h("div", { class: "section-title" }, h("h2", { text: LESSON_DOCS.title }), state),
    h("p", { class: "small", text: gs ? LESSON_DOCS.gs : LESSON_DOCS.gym }),
    h("div", { class: "row" }, btn),
    gs ? null : h("p", { class: "hint", text: LESSON_DOCS.hint }));
}
