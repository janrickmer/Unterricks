// tsummary.js – Karte „Zusammenfassung der Sitzung für die Lehrkraft“ (Nachtrag 21) ganz oben auf der Sitzungsseite (Gymnasium und Grundschule).
// Kopfzeile (Fach · Jahrgang · Wochentag, Datum, Beginn) immer aus den aktuellen Sitzungsdaten (summaryHead), darunter der Text von Claude bzw. der
// Lehrkraft (nur textContent, Absätze bleiben), „Stand: …“ und – wurde die Planung danach geändert – ein Hinweis. „Bearbeiten“ öffnet ein Textfeld;
// gespeichert wird mit dem Stand, auf dem die Bearbeitung beruht (teacherSummaryBase): Hat inzwischen jemand anderes gespeichert (z. B. Claude über
// den Connector), fragt die Seite wie beim Schulportal-Eintrag, welche Fassung gelten soll. Nie für Schüler:innen oder Eltern.
import { h, clear, modal, confirmDialog, stateLine, icon } from "./ui.js";
import { onLeave } from "./app.js";
import { tapi } from "./teacher.js";
import { summaryHead, summaryOutdated, fmtStampBerlin, TEACHER_SUMMARY_TITLE, TEACHER_SUMMARY_MAX } from "./shared.js";

export const SUMMARY_EMPTY = "Noch keine Zusammenfassung. Claude schreibt sie, wenn Sie die Planung im Chat ablegen lassen – oder Sie tragen sie selbst ein.";
export const SUMMARY_STALE = "Die Planung wurde danach geändert – die Zusammenfassung ist vielleicht nicht mehr aktuell.";
export const SUMMARY_SUBSTITUTE = "Für diese Sitzung gilt die bestätigte Vertretungsstunde – die Zusammenfassung beschreibt die ursprüngliche Planung.";
/* Text in Absätze (Leerzeile = neuer Absatz; einzelne Zeilenumbrüche bleiben über white-space: pre-line) */
export const summaryParagraphs = (text) => String(text || "").replace(/\r\n?/g, "\n").trim().split(/\n[ \t]*\n\s*/).map((p) => p.trim()).filter(Boolean);

/* id = Sitzung, L() = Sitzungsdaten (wird bei Änderungen mitgeführt), course = Grundschulkurs (gsCourseOut) oder null, planText() = aktueller
   Schulportal-Eintrag bzw. Verlaufsplan (auch ungespeichert im Editor), substituteActive() = bestätigte Vertretung (Gymnasium) */
export function summaryCard({ id, L, course = null, planText = () => L().portal || "", substituteActive = () => false }) {
  let editing = false, saving = false, pending = null;
  const state = h("span", { class: "save-state", role: "status" });
  const editBtn = h("button", { class: "btn", type: "button", id: "tsum-edit-btn", "aria-expanded": "false", "aria-controls": "tsum-edit", "aria-describedby": "tsum-h" }, icon("edit"), h("span", { text: "Bearbeiten" }));
  const head = h("p", { class: "tsum-head", id: "tsum-head" });
  const body = h("div", { class: "tsum-text", id: "tsum-text" });
  const empty = h("p", { class: "tsum-empty muted", text: SUMMARY_EMPTY });
  const meta = h("p", { class: "tsum-meta" });
  const note = h("p", { class: "notice warn tsum-note hidden" });
  const ta = h("textarea", { id: "tsum-ta", rows: "10", maxlength: String(TEACHER_SUMMARY_MAX), spellcheck: "true", "aria-describedby": "tsum-ta-h tsum-count" });
  const count = h("span", { class: "tsum-count", id: "tsum-count" });
  const saveBtn = h("button", { class: "btn primary", type: "button" }, "Speichern");
  const cancelBtn = h("button", { class: "btn", type: "button" }, "Abbrechen");
  const edit = h("div", { class: "tsum-edit hidden", id: "tsum-edit" },
    h("div", { class: "field" }, h("label", { for: "tsum-ta" }, "Zusammenfassung (ohne Kopfzeile)"), ta,
      h("p", { class: "hint", id: "tsum-ta-h", text: "In schlichten Sätzen der Ablauf der Stunde – so, dass eine Lehrkraft ihn versteht, die nicht mitgeplant hat. Fach, Jahrgang, Wochentag und Beginn setzt Unterricks automatisch darüber. " +
        "Bitte keine Namen von " + (course ? "Kindern" : "Schüler:innen") + ". Zum Löschen das Feld leeren und speichern." }),
      h("p", { class: "hint" }, count)),
    h("div", { class: "row" }, saveBtn, cancelBtn));
  const el = h("section", { class: "card tsum", id: "tsum", "aria-labelledby": "tsum-h" },
    h("div", { class: "section-title" }, h("h2", { id: "tsum-h", text: TEACHER_SUMMARY_TITLE }), h("div", { class: "row" }, editBtn, state)),
    head, body, empty, meta, note, edit);

  const text = () => String(L().teacherSummary || "");
  const paintHead = () => { const t = summaryHead({ subject: L().subject, klass: L().klass, date: L().date, startTime: L().startTime }, course); if (head.textContent !== t) head.textContent = t; };
  function paintNote() {
    const t = text().trim();
    const msg = !t ? "" : substituteActive() ? SUMMARY_SUBSTITUTE : summaryOutdated(t, L().teacherSummaryPlan, planText()) ? SUMMARY_STALE : "";
    if (note.textContent !== msg) { note.textContent = ""; if (msg) note.append(msg); }
    note.classList.toggle("hidden", !msg);
  }
  function paintBody() {
    const ps = summaryParagraphs(text());
    clear(body).append(...ps.map((p) => h("p", { text: p })));
    body.classList.toggle("hidden", editing || !ps.length);
    empty.classList.toggle("hidden", editing || !!ps.length);
    meta.textContent = ps.length && L().teacherSummaryAt ? "Stand: " + fmtStampBerlin(L().teacherSummaryAt) : "";
    meta.classList.toggle("hidden", editing || !meta.textContent);
  }
  const paint = () => { paintHead(); paintBody(); paintNote(); };
  // das Textfeld wächst mit dem Text (bis gut zwei Drittel der Fensterhöhe) – am iPad bleibt so der ganze Text ohne inneres Rollen sichtbar
  const grow = () => {
    if (!ta.scrollHeight || !ta.style) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight + 2, Math.max(240, Math.round((window.innerHeight || 800) * 0.68))) + "px";
  };
  const paintCount = () => { count.textContent = ta.value.length.toLocaleString("de-DE") + " von " + TEACHER_SUMMARY_MAX.toLocaleString("de-DE") + " Zeichen"; };
  const apply = (l) => { Object.assign(L(), { teacherSummary: l.teacherSummary || "", teacherSummaryAt: l.teacherSummaryAt ?? null, teacherSummaryPlan: l.teacherSummaryPlan || null }); };
  const dirty = () => editing && ta.value !== text();
  // Fokus nach dem Schließen zurück auf „Bearbeiten“ – nur, wenn er im Textfeld bzw. in der Karte lag oder (verborgenes Feld) auf body gefallen ist
  const focusBack = () => { const a = document.activeElement; if (!a || a === document.body || el.contains(a)) editBtn.focus(); };
  function setEditing(on) {
    editing = on;
    edit.classList.toggle("hidden", !on);
    editBtn.classList.toggle("hidden", on);
    editBtn.setAttribute("aria-expanded", on ? "true" : "false");
    if (!on && pending) { apply(pending); pending = null; }
    paintBody(); paintNote();
  }
  editBtn.addEventListener("click", () => {
    ta.value = text(); paintCount(); stateLine(state, "");
    setEditing(true); grow();
    // Schreibmarke an den Anfang, ohne zu springen: Kopfzeile und Textanfang bleiben im Blick (am Handy sonst ans Ende des langen Felds gerollt)
    ta.focus({ preventScroll: true });
    if (typeof ta.setSelectionRange === "function") ta.setSelectionRange(0, 0);
  });
  ta.addEventListener("input", () => { paintCount(); grow(); });
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(false); } });
  async function save(force) {
    if (saving) return;
    saving = true; saveBtn.disabled = true; cancelBtn.disabled = true; stateLine(state, "Speichere …");
    const value = ta.value;
    let other = null;
    try {
      const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: force ? { teacherSummary: value } : { teacherSummary: value, teacherSummaryBase: L().teacherSummaryAt ?? null } });
      pending = null; apply(r.lesson); setEditing(false); paintHead();
      stateLine(state, text().trim() ? "Gespeichert" : "Gelöscht", "ok");
      focusBack();
    } catch (e) {
      if (e && e.status === 409 && e.data && e.data.current) { other = e.data.current; stateLine(state, ""); }
      else stateLine(state, e && e.message ? e.message : "Nicht gespeichert.", "err");
    } finally { saving = false; saveBtn.disabled = false; cancelBtn.disabled = false; }
    // erst nach dem Speichern fragen – „Meine Fassung speichern“ speichert dann erneut
    if (other) await conflict(other, value);
  }
  // gleiche Rückfrage wie beim Schulportal-Eintrag: Ihre Fassung oder die inzwischen gespeicherte
  function conflict(cur, mine) {
    return new Promise((resolve) => {
      modal({ title: "Die Zusammenfassung wurde inzwischen geändert", wide: true, onClose: () => resolve(),
        body: (m) => m.append(h("p", { text: "Die Zusammenfassung der Sitzung wurde an anderer Stelle geändert (z. B. von Claude über den Connector" + (cur.at ? ", Stand " + fmtStampBerlin(cur.at) : "") + "). Welche Fassung soll gelten?" }),
          h("div", { class: "portal-wrap" }, h("div", null, h("h3", { text: "Ihre Fassung" }), h("pre", { class: "portal-preview tsum-pre", text: mine || "(leer)" })),
            h("div", null, h("h3", { text: "Gespeicherte Fassung" }), h("pre", { class: "portal-preview tsum-pre", text: cur.text || "(leer)" })))),
        actions: [
          { label: "Gespeicherte Fassung übernehmen", onClick: () => {
            pending = null; apply({ teacherSummary: cur.text, teacherSummaryAt: cur.at, teacherSummaryPlan: cur.plan }); setEditing(false); stateLine(state, "Gespeicherte Fassung übernommen", "ok");
            setTimeout(focusBack, 0);
          } },
          { label: "Meine Fassung speichern", class: "primary", onClick: () => { save(true); } },
        ] });
    });
  }
  saveBtn.addEventListener("click", () => save(false));
  cancelBtn.addEventListener("click", async () => {
    if (dirty() && !(await confirmDialog("Änderungen verwerfen?", "Ihre Änderungen an der Zusammenfassung gehen verloren.", "Verwerfen", true))) return;
    setEditing(false); stateLine(state, ""); focusBack();
  });
  // Seite schließen mit ungespeicherter Bearbeitung: wie bei Schulportal-Eintrag und Notizen nachfragen
  const beforeUnload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  onLeave(() => window.removeEventListener("beforeunload", beforeUnload));
  paint();
  return {
    el, paint, paintHead, paintNote, dirty,
    // Stand von außen (z. B. Claude über den Connector, beim Zurückkehren in den Tab): nie in eine laufende Bearbeitung – die übernimmt ihn erst danach
    // (Speichern meldet dann die Rückfrage), sonst sofort
    update(l) {
      if (!l) return;
      const changed = (l.teacherSummary || "") !== text() || (l.teacherSummaryAt ?? null) !== (L().teacherSummaryAt ?? null) || (l.teacherSummaryPlan || null) !== (L().teacherSummaryPlan || null);
      if (!changed) return;
      if (editing || saving) { pending = l; return; }
      apply(l); paint(); stateLine(state, "Aktualisiert");
    },
  };
}
