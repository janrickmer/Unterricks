// bringcard.js – Karte „Mitbringen“ auf der Sitzungsseite (Nachtrag 28, Gymnasium und Grundschule): Gegenstände, die die Lehrkraft für diese Sitzung
// mitbringen muss (z. B. eine Bibel), je mit einem Hinweis in höchstens zwei Sätzen, wo in der Stunde und in welcher Lerngruppe er gebraucht wird.
// Ansehen, hinzufügen, ändern, löschen (dieselbe Prüfung wie der Server, bring.js). Gespeichert wird die ganze Liste mit dem Stand, auf dem die Änderung
// beruht (bringBase): Hat inzwischen jemand anderes gespeichert (z. B. Claude über den Connector), meldet der Server 409 mit der aktuellen Liste – die
// Karte wendet dieselbe Änderung (hinzufügen, ändern, löschen) auf den neuen Stand an und speichert erneut; fehlt der geänderte Gegenstand inzwischen,
// sagt sie es. Am Tag davor stehen die Gegenstände auf der Startseite im roten Kasten „Für den nächsten Arbeitstag einpacken“ (printnext.js).
import { h, clear, icon, stateLine, confirmDialog } from "./ui.js";
import { onLeave } from "./app.js";
import { tapi } from "./teacher.js";
import { BRING_LIMITS, BRING_CARD_TITLE, BRING_BOX_TITLE, validateBring, bringKey, bringLine } from "./bring.js";
import { isCourseClass } from "./shared.js";

export const BRING_INTRO = "Gegenstände, die Sie für diese Stunde von zu Hause oder aus dem Lehrerzimmer mitbringen (z. B. eine Bibel oder einen Beutel). " +
  "Am Tag davor stehen sie auf der Startseite im roten Kasten „" + BRING_BOX_TITLE + "“.";
export const BRING_EMPTY = "Nichts mitzubringen. Claude trägt Gegenstände beim Planen ein – oder Sie fügen sie selbst hinzu.";
export const BRING_FULL = "Höchstens " + BRING_LIMITS.items + " Gegenstände je Sitzung.";

const afterDialog = () => new Promise((r) => setTimeout(r, 0));
/* Lerngruppe im Beispiel des Hinweises: „in der 9D“, „im Kurs 8-K“, „im Q2-GK“, Grundschule „im Kurs Religion 2ab“ */
const groupIn = (klass, course) => (course ? "im Kurs " + (course.short || "der Grundschule") : isCourseClass(klass) ? "im Kurs " + klass : /^Q/.test(klass || "") ? "im " + klass : klass ? "in der " + klass : "in der Lerngruppe");

/* Eine Änderung auf eine Liste anwenden: {kind: "add", entry} | {kind: "edit", key, entry} | {kind: "del", key} → neue Liste bzw. null, wenn der
   Gegenstand (edit) nicht mehr da ist; beim Löschen eines schon gelöschten bleibt die Liste (nichts zu tun) */
export function applyBringOp(list, op) {
  const xs = (list || []).map((x) => ({ item: x.item, note: x.note || "" }));
  if (op.kind === "add") return [...xs, op.entry];
  const i = xs.findIndex((x) => bringKey(x.item) === op.key);
  if (op.kind === "del") return i < 0 ? xs : xs.filter((_, k) => k !== i);
  if (i < 0) return null;
  xs[i] = op.entry;
  return xs;
}

/* id = Sitzung, L() = Sitzungsdaten (bring, bringRev – werden bei Änderungen mitgeführt), course = Grundschulkurs oder null */
export function bringCard({ id, L, course = null }) {
  let mode = null, saving = false, pending = null;   // mode: null | {kind: "add"} | {kind: "edit", key, entry}
  const items = () => (Array.isArray(L().bring) ? L().bring : []), rev = () => (Number.isInteger(L().bringRev) ? L().bringRev : 0);
  const state = h("span", { class: "save-state", role: "status" });
  const list = h("ul", { class: "bring-list", id: "bring-list", "aria-labelledby": "bring-h" });
  const empty = h("p", { class: "bring-empty muted small", text: BRING_EMPTY });
  const addBtn = h("button", { class: "btn bring-add", type: "button", id: "bring-add", "aria-describedby": "bring-full" }, icon("plus"), "Gegenstand hinzufügen");
  const full = h("p", { class: "hint bring-full", id: "bring-full", role: "status" });
  const fItem = h("input", { id: "bring-item", type: "text", maxlength: String(BRING_LIMITS.item), autocomplete: "off", spellcheck: "true", "aria-describedby": "bring-err" });
  const fNote = h("textarea", { id: "bring-note", rows: "3", maxlength: String(BRING_LIMITS.note), spellcheck: "true", "aria-describedby": "bring-note-h bring-count bring-err" });
  const count = h("span", { class: "bring-count", id: "bring-count" });
  const err = h("p", { class: "err bring-err hidden", id: "bring-err", role: "alert" });
  const formH = h("h3", { id: "bring-form-h", class: "bring-form-h" });
  const saveBtn = h("button", { class: "btn primary", type: "submit" }, "Speichern");
  const cancelBtn = h("button", { class: "btn", type: "button" }, "Abbrechen");
  const form = h("form", { class: "bring-form hidden", id: "bring-form", "aria-labelledby": "bring-form-h", novalidate: true }, formH,
    h("div", { class: "field" }, h("label", { for: "bring-item" }, "Gegenstand"), fItem),
    h("div", { class: "field" }, h("label", { for: "bring-note" }, "Wo und in welcher Lerngruppe? (höchstens zwei Sätze)"), fNote,
      h("p", { class: "hint", id: "bring-note-h", text: "Zum Beispiel: „In Phase 2 (" + (course ? "Erzählung im Sitzkreis" : "Erarbeitung") + ") " + groupIn(L().klass, course) + ".“" }), h("p", { class: "hint" }, count)),
    err, h("div", { class: "row" }, saveBtn, cancelBtn));
  const el = h("section", { class: "card bring", id: "bring", "aria-labelledby": "bring-h" },
    h("div", { class: "section-title" }, h("h2", { id: "bring-h" }, icon("bag"), h("span", { text: BRING_CARD_TITLE })), state),
    h("p", { class: "small muted bring-intro", text: BRING_INTRO }), list, empty, form, h("div", { class: "row bring-addrow" }, addBtn), full);

  const rowBtn = (key, cls) => Array.from(list.querySelectorAll("button." + cls)).find((b) => b.dataset.key === key) || null;
  function paint() {
    const xs = items(), a = document.activeElement, hadKey = a && list.contains(a) && a.dataset ? a.dataset.key : null, hadCls = a && a.classList ? (a.classList.contains("bring-del") ? "bring-del" : "bring-edit") : null;
    clear(list);
    for (const x of xs) {
      const key = bringKey(x.item);
      list.append(h("li", { class: "bring-row", dataset: { key } },
        h("div", { class: "bring-main" }, h("p", { class: "bring-item", text: x.item }), h("p", { class: "bring-note" + (x.note ? "" : " muted"), text: x.note || "Ohne Hinweis." })),
        h("div", { class: "bring-acts" },
          h("button", { class: "btn ghost iconbtn bring-edit", type: "button", "aria-label": "„" + x.item + "“ bearbeiten", title: "Bearbeiten", dataset: { key }, onclick: () => openForm({ kind: "edit", key, entry: x }) }, icon("edit")),
          h("button", { class: "btn ghost iconbtn danger bring-del", type: "button", "aria-label": "„" + x.item + "“ löschen", title: "Löschen", dataset: { key }, onclick: () => remove(x) }, icon("trash")))));
    }
    list.classList.toggle("hidden", !xs.length);
    empty.classList.toggle("hidden", !!xs.length || !!mode);
    const atMax = xs.length >= BRING_LIMITS.items;
    if (atMax) addBtn.setAttribute("aria-disabled", "true"); else addBtn.removeAttribute("aria-disabled");
    addBtn.classList.toggle("hidden", !!mode);
    if (!atMax) full.textContent = "";
    // lag der Fokus auf einem Knopf einer Zeile, die neu gebaut wurde: an denselben Knopf derselben Zeile (nur, wenn er sonst verloren wäre)
    if (hadKey && (!document.activeElement || document.activeElement === document.body)) { const b = rowBtn(hadKey, hadCls) || rowBtn(hadKey, "bring-edit"); (b || addBtn).focus({ preventScroll: true }); }
  }
  const paintCount = () => { count.textContent = fNote.value.length + " von " + BRING_LIMITS.note + " Zeichen"; };
  function showErr(msg, field) {
    err.textContent = msg || ""; err.classList.toggle("hidden", !msg);
    for (const f of [fItem, fNote]) { if (msg && f === field) f.setAttribute("aria-invalid", "true"); else f.removeAttribute("aria-invalid"); }
    if (msg && field) field.focus();
  }
  function openForm(m) {
    if (saving) return;
    if (m.kind === "add" && items().length >= BRING_LIMITS.items) { full.textContent = BRING_FULL; return; }
    mode = m; showErr("");
    formH.textContent = m.kind === "add" ? "Gegenstand hinzufügen" : "„" + m.entry.item + "“ bearbeiten";
    fItem.value = m.kind === "add" ? "" : m.entry.item; fNote.value = m.kind === "add" ? "" : m.entry.note || "";
    paintCount(); form.classList.remove("hidden"); paint();
    fItem.focus();   // im Klick selbst – nie verspätet
  }
  // Formular schließen; der Fokus geht an den Knopf, der es geöffnet hat (bzw. die geänderte Zeile) – nur aus der Karte bzw. von body
  function closeForm(focusKey) {
    const m = mode;
    mode = null; form.classList.add("hidden"); showErr("");
    flushPending();
    paint();
    const a = document.activeElement;
    if (!a || a === document.body || el.contains(a) || !a.isConnected) {
      const k = focusKey !== undefined ? focusKey : m && m.kind === "edit" ? m.key : null;
      ((k && rowBtn(k, "bring-edit")) || addBtn).focus({ preventScroll: true });
    }
  }
  // ein Stand von außen, der während der Bearbeitung kam: nur übernehmen, was neuer ist als das eben Gespeicherte
  const flushPending = () => { if (pending && (pending.bringRev ?? 0) > rev()) apply(pending); pending = null; };
  const apply = (l) => { L().bring = Array.isArray(l.bring) ? l.bring : []; L().bringRev = Number.isInteger(l.bringRev) ? l.bringRev : 0; };
  const dirty = () => !!mode && (mode.kind === "add" ? !!(fItem.value.trim() || fNote.value.trim()) : fItem.value !== mode.entry.item || fNote.value !== (mode.entry.note || ""));

  /* speichern: die Änderung auf die Liste anwenden, prüfen, mit Stand senden; bei 409 auf den neuen Stand anwenden und erneut (höchstens dreimal) */
  async function commit(op) {
    let merged = false;
    for (let tries = 0; tries < 3; tries++) {
      const next = applyBringOp(items(), op);
      if (next === null) return { gone: true };
      const clean = validateBring(next);   // wirft mit deutscher Meldung
      try {
        const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { bring: clean, bringBase: rev() } });
        apply(r.lesson);
        return { merged };
      } catch (e) {
        if (e && e.status === 409 && e.data && e.data.code === "bring_conflict" && e.data.current) { apply(e.data.current.items ? { bring: e.data.current.items, bringRev: e.data.current.rev } : {}); merged = true; continue; }
        throw e;
      }
    }
    throw new Error("Die Liste wurde gerade mehrfach an anderer Stelle geändert – bitte noch einmal versuchen.");
  }
  async function submit() {
    if (saving || !mode) return;
    const entry = { item: bringLine(fItem.value), note: bringLine(fNote.value) };
    if (!entry.item) { showErr("Bitte angeben, was mitgebracht werden soll.", fItem); return; }
    const m = mode, op = m.kind === "add" ? { kind: "add", entry } : { kind: "edit", key: m.key, entry };
    // erst hier prüfen (wie der Server): zu lang, mehr als zwei Sätze, doppelt
    try { validateBring(applyBringOp(items(), op) || []); }
    catch (e) { showErr(e.message, /Hinweis/.test(e.message) ? fNote : fItem); return; }
    saving = true; saveBtn.disabled = true; cancelBtn.disabled = true; stateLine(state, "Speichere …");
    try {
      const r = await commit(op);
      if (r.gone) { stateLine(state, "„" + m.entry.item + "“ wurde inzwischen an anderer Stelle gelöscht – Ihre Änderung ist nicht gespeichert.", "err"); closeForm(null); return; }
      stateLine(state, (m.kind === "add" ? "„" + entry.item + "“ hinzugefügt" : "Gespeichert") + (r.merged ? " – die Liste war inzwischen geändert worden (z. B. von Claude); Ihre Änderung ist dazugekommen." : ""), "ok");
      closeForm(m.kind === "add" ? null : bringKey(entry.item));
    } catch (e) {
      showErr(e && e.message ? e.message : "Nicht gespeichert.", null); stateLine(state, "Nicht gespeichert", "err"); paint();
    } finally { saving = false; saveBtn.disabled = false; cancelBtn.disabled = false; }
  }
  async function remove(x) {
    if (saving || mode) return;
    if (!(await confirmDialog("„" + x.item + "“ löschen?", "Der Gegenstand verschwindet aus der Liste dieser Sitzung und aus dem roten Kasten auf der Startseite.", "Löschen", true))) return;
    const key = bringKey(x.item), xs = items(), i = xs.findIndex((y) => bringKey(y.item) === key);
    saving = true; stateLine(state, "Lösche …");
    try {
      const r = await commit({ kind: "del", key });
      stateLine(state, "„" + x.item + "“ gelöscht" + (r.merged ? " – die Liste war inzwischen geändert worden (z. B. von Claude)." : ""), "ok");
    } catch (e) { stateLine(state, e && e.message ? e.message : "Nicht gelöscht.", "err"); }
    finally { saving = false; }
    flushPending(); paint();
    // Fokus an den nächsten Gegenstand (sonst den vorigen bzw. „Gegenstand hinzufügen“) – nur, wenn er sonst verloren wäre
    const a = document.activeElement;
    if (!a || a === document.body || !a.isConnected) {
      const after = items(), next = after[Math.min(Math.max(i, 0), after.length - 1)];
      ((next && rowBtn(bringKey(next.item), "bring-edit")) || addBtn).focus({ preventScroll: true });
    }
  }
  addBtn.addEventListener("click", () => openForm({ kind: "add" }));
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  fNote.addEventListener("input", paintCount);
  cancelBtn.addEventListener("click", async () => {
    if (dirty()) {
      if (!(await confirmDialog("Änderungen verwerfen?", "Ihre Eingaben zu diesem Gegenstand gehen verloren.", "Verwerfen", true))) return;
      await afterDialog();   // erst, wenn der Dialog ganz zu ist (er gibt den Fokus sonst an „Abbrechen“ zurück, das dann verborgen ist)
    }
    stateLine(state, ""); closeForm();
  });
  form.addEventListener("keydown", (e) => { if (e.key === "Escape" && !saving) { e.preventDefault(); e.stopPropagation(); cancelBtn.click(); } });
  const beforeUnload = (e) => { if (dirty()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  onLeave(() => window.removeEventListener("beforeunload", beforeUnload));
  paint();
  return {
    el, dirty,
    // Stand von außen (Claude über den Connector, beim Zurückkehren in den Tab): nie in ein offenes Formular – das übernimmt ihn erst danach
    update(l) {
      if (!l || !Array.isArray(l.bring)) return;
      if ((l.bringRev ?? 0) === rev() && JSON.stringify(l.bring) === JSON.stringify(items())) return;
      if (mode || saving) { pending = l; return; }
      apply(l); paint(); stateLine(state, "Aktualisiert");
    },
  };
}
