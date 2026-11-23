// revealui.js – Material erscheint mit seiner Materialfolie (Nachtrag 44, Teil 1): kleiner Hinweis an Material mit eigener Materialfolie auf den Seiten der
// Lehrkraft (vollständige Sitzung: Materialkasten und Feibeitsblätter; „Ich bin jetzt im Unterricht“: Spalte „Für Schüler:innen sichtbar“) – ob die
// Schüler:innen es schon sehen oder ab welcher Folie, dazu „Jetzt freigeben“ (z. B. wenn der Beamer streikt oder die Präsentation nicht live läuft).
// Die Zuordnung rechnet public/reveal.js mit denselben Daten wie der Server für die Schüler:innen; ohne Materialfolie kein Hinweis.
import { h, busy, errToast, toast } from "./ui.js";
import { tapi } from "./teacher.js";
import { revealNote, REVEAL_RELEASE } from "./reveal.js";

/* gate = teacherGate(…) (reveal.js), ref = „f:<Datei>“ bzw. „s:<Code>“, title = Name des Materials, lessonId; onReleased(reveals) nach dem Freigeben
   (die Seite übernimmt den neuen Stand). now = Uhr (Tests). → Element (div.reveal-note) oder null */
export function revealBadge({ gate, ref, title, lessonId, onReleased = () => {}, now = Date.now() }) {
  const x = gate && gate.on ? gate.items.get(ref) : null;
  const note = revealNote(x, now);
  if (!note) return null;
  const el = h("div", { class: "reveal-note" + (note.waiting ? " waiting" : "") }, h("span", { class: "reveal-text", text: note.text }));
  if (note.waiting) el.append(h("button", { class: "btn small reveal-go", type: "button", "aria-label": "„" + title + "“ jetzt für Schüler:innen freigeben",
    onclick: (e) => busy(e.currentTarget, async () => {
      try {
        const r = await tapi("POST", "/api/teacher/lessons/" + lessonId + "/reveal", { body: { ref } });
        toast("„" + title + "“ ist jetzt für Schüler:innen sichtbar.", "ok");
        onReleased(r.reveals);
      } catch (err) { errToast(err); }
    }, "Gebe frei …") }, REVEAL_RELEASE));
  return el;
}
