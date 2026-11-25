// termsedit.js – Karte „Fachbegriffe dieser Sitzung“ auf der Sitzungsseite der Lehrkraft (Nachtrag 44, Teil 3; seit Nachtrag 47 am Gymnasium ab Jahrgang 5).
// Zeigt die 3 bis 8 Fachbegriffe mit ihrer Definition, die Claude beim Planen schreibt, und ab wann die Schüler:innen sie als Karteikarten sehen
// (2 Minuten vor dem Ende der Sitzung). „Bearbeiten“ öffnet je Begriff zwei Felder (Begriff, Definition), dieselbe Prüfung wie der Server (terms.js).
// Gespeichert wird die ganze Liste mit dem Stand, auf dem die Bearbeitung beruht (termsBase): Hat inzwischen jemand anderes gespeichert (z. B. Claude über
// den Connector), fragt die Karte wie die Zusammenfassung, welche Fassung gelten soll. Keine Dreh-Animation auf der Sitzungsseite (sie bleibt ruhig).
import { h, clear, icon, stateLine, confirmDialog, modal } from "./ui.js";
import { onLeave } from "./app.js";
import { tapi } from "./teacher.js";
import { lessonTimes, fmtClockBerlin, fmtDayBerlin, TERMS_BEFORE_END_MIN } from "./shared.js";
import { TERMS_LIMITS, TERMS_TITLE, validateTerms, termsLine, termsKey, termsImportText } from "./terms.js";

export const TERMS_INTRO = "Karteikarten für die Schüler:innen: vorne der Begriff, hinten die Definition. Claude schreibt sie beim Planen – Sie können sie hier ändern.";
export const TERMS_EMPTY = "Noch keine Fachbegriffe. Claude schreibt sie beim Planen – oder Sie tragen sie selbst ein.";
export const TERMS_FULL = "Höchstens " + TERMS_LIMITS.max + " Fachbegriffe je Sitzung.";
export const TERMS_FORM_HINT = TERMS_LIMITS.min + " bis " + TERMS_LIMITS.max + " Begriffe, je höchstens " + TERMS_LIMITS.term + " Zeichen, mit einer kurzen Definition (höchstens " +
  TERMS_LIMITS.def + " Zeichen). Zum Löschen alle Begriffe entfernen und speichern. Bitte keine Namen von Schüler:innen.";
const afterDialog = () => new Promise((r) => setTimeout(r, 0));
/* Zeile im Dialog „Sitzung aus Datei laden?“ (session.js) – null, wenn es zu den Fachbegriffen nichts zu sagen gibt */
export const termsImportLine = (plan, target) => { const t = termsImportText(plan, target); return t ? h("li", { text: t }) : null; };

/* id = Sitzung, L() = Sitzungsdaten (terms, termsRev, date, startTime, durationMin – werden bei Änderungen mitgeführt) */
export function termsCard({ id, L }) {
  let editing = false, saving = false, pending = null, rows = [];   // rows: [{el, t, d, count}]
  const items = () => (Array.isArray(L().terms) ? L().terms : []), rev = () => (Number.isInteger(L().termsRev) ? L().termsRev : 0);
  const state = h("span", { class: "save-state", role: "status" });
  const editBtn = h("button", { class: "btn", type: "button", id: "terms-edit", "aria-expanded": "false", "aria-controls": "terms-form", "aria-describedby": "terms-h" }, icon("edit"), h("span", { text: "Bearbeiten" }));
  const when = h("p", { class: "small termswhen", id: "terms-when" });
  const list = h("dl", { class: "terms-list", id: "terms-list" });
  const empty = h("p", { class: "terms-empty muted small", text: TERMS_EMPTY });
  const fields = h("div", { class: "terms-fields" });
  const addBtn = h("button", { class: "btn terms-add", type: "button", id: "terms-add", "aria-describedby": "terms-full" }, icon("plus"), "Begriff hinzufügen");
  const full = h("p", { class: "hint terms-full", id: "terms-full", role: "status" });
  const err = h("p", { class: "err terms-err hidden", id: "terms-err", role: "alert" });
  const saveBtn = h("button", { class: "btn primary", type: "submit" }, "Speichern");
  const cancelBtn = h("button", { class: "btn", type: "button" }, "Abbrechen");
  const form = h("form", { class: "terms-form hidden", id: "terms-form", "aria-label": TERMS_TITLE + " bearbeiten", novalidate: true },
    h("p", { class: "hint", id: "terms-form-h", text: TERMS_FORM_HINT }), fields, h("div", { class: "row terms-addrow" }, addBtn), full, err, h("div", { class: "row" }, saveBtn, cancelBtn));
  const el = h("section", { class: "card terms", id: "terms", "aria-labelledby": "terms-h" },
    h("div", { class: "section-title" }, h("h2", { id: "terms-h", text: TERMS_TITLE }), h("div", { class: "row" }, editBtn, state)),
    h("p", { class: "small muted terms-intro", text: TERMS_INTRO }), when, list, empty, form);

  /* ab wann die Schüler:innen die Karteikarten sehen – aus Datum, Beginn und Dauer (wie die Hausaufgabe) */
  function paintWhen() {
    const t = lessonTimes({ date: L().date, startTime: L().startTime, durationMin: L().durationMin });
    const miss = [!L().startTime ? "der Beginn (Uhrzeit)" : null, !L().durationMin ? "die Dauer" : null].filter(Boolean).join(" und ") || "eine Angabe";
    const sameDay = t && fmtDayBerlin(t.termsAt) === fmtDayBerlin(t.start);
    clear(when).append(t ? "Schüler:innen sehen die Karteikarten ab " + (sameDay ? "" : fmtDayBerlin(t.termsAt) + ", ") + fmtClockBerlin(t.termsAt) + " Uhr (" + TERMS_BEFORE_END_MIN +
        " Minuten vor dem Ende der Sitzung) unten in ihrer Ansicht der Sitzung – danach bleiben sie dort."
      : h("span", { class: "warnc", text: "Schüler:innen sehen die Karteikarten erst " + TERMS_BEFORE_END_MIN + " Minuten vor dem Ende der Sitzung – dafür fehlt " + miss + " (bei den Sitzungsdaten)." }));
  }
  function paintList() {
    const xs = items();
    clear(list);
    for (const x of xs) list.append(h("div", { class: "terms-item" }, h("dt", { text: x.term }), h("dd", { text: x.definition })));
    list.classList.toggle("hidden", editing || !xs.length);
    empty.classList.toggle("hidden", editing || !!xs.length);
  }
  const paint = () => { paintWhen(); paintList(); };

  /* ---------- Bearbeiten ---------- */
  const paintCount = (r) => { r.count.textContent = r.d.value.length + " von " + TERMS_LIMITS.def + " Zeichen"; };
  function renumber() {
    rows.forEach((r, i) => {
      const n = i + 1;
      r.lbl.textContent = "Begriff " + n; r.dlbl.textContent = "Definition zu Begriff " + n;
      r.del.setAttribute("aria-label", "Begriff " + n + " entfernen");
      r.del.title = "Begriff " + n + " entfernen";
    });
    const atMax = rows.length >= TERMS_LIMITS.max;
    if (atMax) addBtn.setAttribute("aria-disabled", "true"); else { addBtn.removeAttribute("aria-disabled"); full.textContent = ""; }
  }
  let seq = 0;
  function addRow(x, focus = false) {
    const k = ++seq;
    const t = h("input", { id: "terms-t-" + k, class: "terms-t", type: "text", maxlength: String(TERMS_LIMITS.term), autocomplete: "off", spellcheck: "true", value: x ? x.term : "", "aria-describedby": "terms-err" });
    const d = h("textarea", { id: "terms-d-" + k, class: "terms-d", rows: "3", maxlength: String(TERMS_LIMITS.def), spellcheck: "true", value: x ? x.definition : "", "aria-describedby": "terms-c-" + k + " terms-err" });
    const count = h("span", { class: "terms-count", id: "terms-c-" + k });
    const lbl = h("label", { for: t.id }), dlbl = h("label", { for: d.id });
    const del = h("button", { class: "btn ghost iconbtn danger terms-del", type: "button" }, icon("trash"));
    const r = { t, d, count, lbl, dlbl, del };
    r.el = h("div", { class: "terms-row" }, h("div", { class: "terms-row-main" }, h("div", { class: "field" }, lbl, t), h("div", { class: "field" }, dlbl, d, h("p", { class: "hint" }, count))),
      h("div", { class: "terms-row-acts" }, del));
    d.addEventListener("input", () => paintCount(r));
    del.addEventListener("click", () => removeRow(r));
    paintCount(r);
    rows.push(r); fields.append(r.el); renumber();
    if (focus) t.focus();
    return r;
  }
  function removeRow(r) {
    if (saving) return;
    const i = rows.indexOf(r);
    if (i < 0) return;
    rows.splice(i, 1); r.el.remove(); renumber(); showErr("");
    const next = rows[Math.min(i, rows.length - 1)];
    (next ? next.t : addBtn).focus();   // Fokus an den nächsten Begriff (sonst den vorigen bzw. „Begriff hinzufügen“)
  }
  function showErr(msg, field) {
    err.textContent = msg || ""; err.classList.toggle("hidden", !msg);
    for (const r of rows) for (const f of [r.t, r.d]) { if (msg && f === field) f.setAttribute("aria-invalid", "true"); else f.removeAttribute("aria-invalid"); }
    if (msg && field) field.focus();
  }
  const formItems = () => rows.map((r) => ({ term: termsLine(r.t.value), definition: termsLine(r.d.value), r })).filter((x) => x.term || x.definition);
  function setEditing(on) {
    editing = on;
    form.classList.toggle("hidden", !on);
    editBtn.classList.toggle("hidden", on);
    editBtn.setAttribute("aria-expanded", on ? "true" : "false");
    if (!on) { clear(fields); rows = []; showErr(""); if (pending) { apply(pending); pending = null; } }
    paintList();
  }
  const apply = (l) => { L().terms = Array.isArray(l.terms) ? l.terms : []; L().termsRev = Number.isInteger(l.termsRev) ? l.termsRev : 0; };
  const same = (a, b) => JSON.stringify(a.map((x) => [x.term, x.definition])) === JSON.stringify(b.map((x) => [x.term, x.definition]));
  const dirty = () => editing && !same(formItems(), items());
  const focusBack = () => { const a = document.activeElement; if (!a || a === document.body || el.contains(a) || !a.isConnected) editBtn.focus(); };

  editBtn.addEventListener("click", () => {
    if (saving) return;
    stateLine(state, "");
    setEditing(true);
    const xs = items();
    for (const x of xs) addRow(x);
    // ohne Begriffe: gleich drei leere Zeilen (mindestens drei sind nötig)
    for (let i = xs.length; i < TERMS_LIMITS.min; i++) addRow(null);
    rows[0].t.focus();   // im Klick selbst – nie verspätet
  });
  addBtn.addEventListener("click", () => {
    if (rows.length >= TERMS_LIMITS.max) { full.textContent = TERMS_FULL; return; }
    addRow(null, true);
  });
  // prüfen wie der Server (terms.js), aber mit dem Feld, das die Meldung betrifft → bereinigte Liste oder null (Meldung steht dann da);
  // die Nummer in der Meldung ist die der Zeile („Begriff n“ wie ihre Beschriftung) – leere Zeilen davor zählen mit, auch wenn sie nicht gespeichert werden
  function check() {
    const xs = formItems(), seen = new Map();
    for (const x of xs) {
      const n = rows.indexOf(x.r) + 1;
      if (!x.term) { showErr("Begriff " + n + ": Bitte den Begriff angeben.", x.r.t); return null; }
      if (!x.definition) { showErr("Begriff " + n + " („" + x.term + "“): Bitte die Definition angeben.", x.r.d); return null; }
      if (x.term.length > TERMS_LIMITS.term) { showErr("Begriff " + n + " ist zu lang (höchstens " + TERMS_LIMITS.term + " Zeichen).", x.r.t); return null; }
      if (x.definition.length > TERMS_LIMITS.def) { showErr("Die Definition zu „" + x.term + "“ ist zu lang (höchstens " + TERMS_LIMITS.def + " Zeichen).", x.r.d); return null; }
      if (seen.has(termsKey(x.term))) { showErr("„" + x.term + "“ steht doppelt in der Liste.", x.r.t); return null; }
      seen.set(termsKey(x.term), true);
    }
    if (xs.length && xs.length < TERMS_LIMITS.min) { showErr("Bitte mindestens " + TERMS_LIMITS.min + " Fachbegriffe angeben – oder alle entfernen, um die Liste zu leeren.", null); addBtn.focus(); return null; }
    try { return validateTerms(xs.map((x) => ({ term: x.term, definition: x.definition }))); }
    catch (e) { showErr(e.message, null); return null; }
  }
  async function save(list0, force) {
    if (saving) return;
    saving = true; saveBtn.disabled = true; cancelBtn.disabled = true; stateLine(state, "Speichere …");
    let other = null;
    try {
      const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: force ? { terms: list0 } : { terms: list0, termsBase: rev() } });
      pending = null; apply(r.lesson); setEditing(false);
      stateLine(state, items().length ? "Gespeichert" : "Gelöscht", "ok");
      focusBack();
    } catch (e) {
      if (e && e.status === 409 && e.data && e.data.code === "terms_conflict" && e.data.current) { other = e.data.current; stateLine(state, ""); }
      else { showErr(e && e.message ? e.message : "Nicht gespeichert.", null); stateLine(state, "Nicht gespeichert", "err"); }
    } finally { saving = false; saveBtn.disabled = false; cancelBtn.disabled = false; }
    // erst nach dem Speichern fragen – „Meine Fassung speichern“ speichert dann erneut (ohne Stand)
    if (other) await conflict(other, list0);
  }
  const pre = (xs) => (xs.length ? xs.map((x) => x.term + ": " + x.definition).join("\n") : "(keine)");
  function conflict(cur, mine) {
    return new Promise((resolve) => {
      modal({ title: "Die Fachbegriffe wurden inzwischen geändert", wide: true, onClose: () => resolve(),
        body: (m) => m.append(h("p", { text: "Die Fachbegriffe dieser Sitzung wurden an anderer Stelle geändert (z. B. von Claude über den Connector). Welche Fassung soll gelten?" }),
          h("div", { class: "portal-wrap" }, h("div", null, h("h3", { text: "Ihre Fassung" }), h("pre", { class: "portal-preview terms-pre", text: pre(mine) })),
            h("div", null, h("h3", { text: "Gespeicherte Fassung" }), h("pre", { class: "portal-preview terms-pre", text: pre(cur.items || []) })))),
        actions: [
          { label: "Gespeicherte Fassung übernehmen", onClick: () => {
            pending = null; apply({ terms: cur.items || [], termsRev: cur.rev }); setEditing(false); stateLine(state, "Gespeicherte Fassung übernommen", "ok");
            setTimeout(focusBack, 0);
          } },
          { label: "Meine Fassung speichern", class: "primary", onClick: () => { save(mine, true); } },
        ] });
    });
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (saving) return;
    const list0 = check();
    if (!list0) return;
    showErr("");
    if (!list0.length && !items().length) { setEditing(false); stateLine(state, ""); focusBack(); return; }   // nichts eingetragen, nichts gespeichert
    if (!list0.length && items().length && !(await confirmDialog("Alle Fachbegriffe löschen?", "Die Schüler:innen sehen dann am Ende der Sitzung keine Karteikarten.", "Löschen", true))) return;
    save(list0, false);
  });
  cancelBtn.addEventListener("click", async () => {
    if (dirty()) {
      if (!(await confirmDialog("Änderungen verwerfen?", "Ihre Änderungen an den Fachbegriffen gehen verloren.", "Verwerfen", true))) return;
      await afterDialog();   // erst, wenn der Dialog ganz zu ist (er gibt den Fokus sonst an „Abbrechen“ zurück, das dann verborgen ist)
    }
    setEditing(false); stateLine(state, ""); focusBack();
  });
  form.addEventListener("keydown", (e) => { if (e.key === "Escape" && !saving) { e.preventDefault(); e.stopPropagation(); cancelBtn.click(); } });
  const beforeUnload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  onLeave(() => window.removeEventListener("beforeunload", beforeUnload));
  paint();
  return {
    el, dirty, paintWhen,
    // Stand von außen (Claude über den Connector, beim Zurückkehren in den Tab): nie in eine laufende Bearbeitung – die übernimmt ihn erst danach
    update(l) {
      if (!l || !Array.isArray(l.terms)) return;
      if ((l.termsRev ?? 0) === rev() && same(l.terms, items())) return;
      if (editing || saving) { pending = l; return; }
      apply(l); paintList(); stateLine(state, "Aktualisiert");
    },
  };
}
