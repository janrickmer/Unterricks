// freedays.js – Unterrichtsfreie Tage (Einstellungen, Nachtrag 24 vom 13.11.2026): Karte in den Einstellungen (Liste, Formular mit Pflichtwahl der
// Schule, Rückfrage mit den betroffenen Sitzungen „Speichern und verschieben“ / „Nur speichern“) und die Prüfung eines Datums, das die Lehrkraft
// in einer Sitzung setzt. Rechnen und Prüfen in planning.js (gemeinsam mit dem Worker), Speichern in worker/freedays.js.
import { h, clear, toast, errToast, busy, modal, confirmDialog, nn } from "./ui.js";
import { tapi } from "./teacher.js";
import { berlinToday, fmtDay } from "./shared.js";
import { normalizeFreeDay, cleanFreeDays, freeRangeText, freeDateError, freeScopeText, FREE_DAY_SCOPES, FREE_DAY_LABEL_MAX } from "./planning.js";

/* ---------- Liste für Datumsprüfungen (Sitzungsseiten): einmal je Seite geladen, nach Änderungen neu ---------- */
let cache = null;
export const invalidateFreeDays = () => { cache = null; };
export function loadFreeDays() {
  if (!cache) cache = tapi("GET", "/api/teacher/free-days").then((r) => cleanFreeDays(r.freeDays), (e) => { cache = null; throw e; });
  return cache;
}
/* Meldung, wenn date für das Fach (subject; „gs“ = Grundschule) unterrichtsfrei ist – sonst null. Lässt sich die Liste nicht laden, prüft der Server. */
export async function freeDateMessage(date, subject) {
  try { return freeDateError(date, await loadFreeDays(), subject); } catch { return null; }
}

/* ---------- Karte „Unterrichtsfreie Tage“ (Einstellungen) ---------- */
const SCOPE_ORDER = ["gs", "gym", "both"];
export const FREE_INTRO = "An diesen Tagen gibt es für die gewählte Schule keine Unterrichtssitzungen: Der Wochenkalender zeigt sie als unterrichtsfrei, " +
  "Unterricks legt keine Termine darauf, und Claude plant alle Unterrichtseinheiten drumherum. Ferien und Feiertage tragen Sie bitte selbst ein – " +
  "Unterricks kennt keine automatisch.";
export function freeDaysCard() {
  let list = null, editing = null, saving = false;
  const listBox = h("div", { class: "fd-listbox", "aria-live": "polite" }, h("p", { class: "small muted", text: "Lade …" }));
  const status = h("p", { class: "small fd-status", role: "status" });
  // Formular
  const err = h("p", { class: "err fd-err", id: "fd-err", role: "alert" });
  const formH = h("h3", { id: "fd-form-h", text: "Unterrichtsfreien Tag eintragen" });
  const label = h("input", { id: "fd-label", maxlength: String(FREE_DAY_LABEL_MAX), autocomplete: "off", placeholder: "z. B. Herbstferien oder Pädagogischer Tag" });
  const from = h("input", { id: "fd-from", type: "date" }), to = h("input", { id: "fd-to", type: "date" });
  const radios = SCOPE_ORDER.map((k) => h("input", { type: "radio", name: "fd-scope", id: "fd-scope-" + k, value: k }));
  const scope = h("fieldset", { class: "fd-scope", id: "fd-scope" }, h("legend", { text: "Betrifft" }),
    h("div", { class: "fd-radios" }, SCOPE_ORDER.map((k, i) => h("label", { class: "checkrow fd-radio", for: "fd-scope-" + k }, radios[i], h("span", { text: FREE_DAY_SCOPES[k] })))));
  const fields = { label, from, to, scope };
  // „Bis“ folgt „Von“: leer oder früher → derselbe Tag; nie früher als „Von“
  from.addEventListener("change", () => { if (from.value) { to.min = from.value; if (!to.value || to.value < from.value) to.value = from.value; } else to.removeAttribute("min"); });
  const saveBtn = h("button", { class: "btn primary", type: "button", id: "fd-save" }, "Eintragen");
  const cancelBtn = h("button", { class: "btn hidden", type: "button", id: "fd-cancel" }, "Abbrechen");
  const form = h("div", { class: "fd-form", role: "group", "aria-labelledby": "fd-form-h" }, formH,
    h("div", { class: "field" }, h("label", { for: "fd-label" }, "Bezeichnung"), label),
    h("div", { class: "meta-grid fd-dates" }, h("div", { class: "field" }, h("label", { for: "fd-from" }, "Von"), from),
      h("div", { class: "field" }, h("label", { for: "fd-to" }, "Bis (bei einem einzelnen Tag wie „Von“)"), to)),
    scope, err, h("div", { class: "row" }, saveBtn, cancelBtn));
  const clearErr = () => {
    err.textContent = "";
    for (const el of Object.values(fields)) { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); }
  };
  const showErr = (msg, field) => {
    clearErr();
    err.textContent = msg;
    const el = fields[field] || null;
    if (el) { el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", "fd-err"); }
    const target = field === "scope" ? radios[0] : el;
    if (target) target.focus(); else saveBtn.focus();
  };
  for (const el of [label, from, to]) el.addEventListener("input", () => { if (el.getAttribute("aria-invalid")) { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); if (!form.querySelector("[aria-invalid]")) err.textContent = ""; } });
  for (const r of radios) r.addEventListener("change", () => { if (scope.getAttribute("aria-invalid")) { scope.removeAttribute("aria-invalid"); scope.removeAttribute("aria-describedby"); if (!form.querySelector("[aria-invalid]")) err.textContent = ""; } });
  const reset = () => {
    editing = null; label.value = from.value = to.value = ""; to.removeAttribute("min"); for (const r of radios) r.checked = false;
    formH.textContent = "Unterrichtsfreien Tag eintragen"; saveBtn.textContent = "Eintragen"; cancelBtn.classList.add("hidden"); clearErr();
  };
  cancelBtn.addEventListener("click", () => { reset(); label.focus(); });
  const edit = (f) => {
    editing = f; label.value = f.label; from.value = f.from; to.value = f.to; to.min = f.from;
    for (const r of radios) r.checked = r.value === f.scope;
    formH.textContent = "Eintrag bearbeiten: " + f.label; saveBtn.textContent = "Änderungen speichern"; cancelBtn.classList.remove("hidden"); clearErr();
    label.focus(); form.scrollIntoView({ block: "nearest" });
  };

  const itemOf = (f) => h("li", { class: "item fd-item" },
    h("div", { class: "main" }, h("div", { class: "name", text: f.label }),
      h("div", { class: "meta" }, h("span", { text: freeRangeText(f) }), " · ", h("span", { class: "fd-scopetag", dataset: { scope: f.scope }, text: FREE_DAY_SCOPES[f.scope] }))),
    h("div", { class: "acts" },
      h("button", { class: "btn small", type: "button", "aria-label": "„" + f.label + "“ bearbeiten", onclick: () => edit(f) }, "Bearbeiten"),
      h("button", { class: "btn small danger", type: "button", "aria-label": "„" + f.label + "“ löschen", onclick: (e) => remove(f, e.currentTarget) }, "Löschen")));
  const paint = () => {
    clear(listBox);
    if (!list) return;
    const today = berlinToday(), cur = list.filter((f) => f.to >= today), past = list.filter((f) => f.to < today);
    listBox.append(...nn(
      cur.length ? h("ul", { class: "list fd-list", "aria-label": "Unterrichtsfreie Tage" }, cur.map(itemOf))
        : h("p", { class: "small muted fd-empty", text: past.length ? "Keine kommenden unterrichtsfreien Tage eingetragen." : "Noch keine unterrichtsfreien Tage eingetragen." }),
      past.length ? h("details", { class: "fd-past" }, h("summary", { text: "Vergangene anzeigen (" + past.length + ")" }),
        h("ul", { class: "list fd-list", "aria-label": "Vergangene unterrichtsfreie Tage" }, past.map(itemOf))) : null));
  };
  const load = async () => {
    try { list = cleanFreeDays((await tapi("GET", "/api/teacher/free-days")).freeDays); paint(); }
    catch (e) { clear(listBox).append(h("p", { class: "err", text: "Die unterrichtsfreien Tage ließen sich nicht laden: " + e.message })); }
  };
  async function remove(f, btn) {
    if (!(await confirmDialog("Unterrichtsfreien Eintrag löschen", "„" + f.label + "“ (" + freeRangeText(f) + ", " + FREE_DAY_SCOPES[f.scope] + ") löschen? Danach sind diese Tage wieder Unterrichtstage – " +
      "für Termine ab jetzt. Schon verschobene Sitzungen bleiben, wo sie sind.", "Löschen", true))) return;
    await busy(btn, async () => {
      try {
        await tapi("DELETE", "/api/teacher/free-days/" + f.id); invalidateFreeDays();
        if (editing && editing.id === f.id) reset();
        list = list.filter((x) => x.id !== f.id); paint();
        status.textContent = "„" + f.label + "“ gelöscht."; toast("Gelöscht.", "ok");
        // der Knopf ist mit seiner Zeile verschwunden: Fokus auf die Überschrift der Karte (nur, wenn er sonst auf body fiele)
        setTimeout(() => { const a = document.activeElement; if (!a || a === document.body) { const hh = card.querySelector("#fd-h"); if (hh) hh.focus(); } }, 0);
      } catch (e) { errToast(e); }
    });
  }
  saveBtn.addEventListener("click", () => {
    if (saving) return;
    let entry;
    const checked = radios.find((r) => r.checked);
    try { entry = normalizeFreeDay({ label: label.value, from: from.value, to: to.value || from.value, scope: checked ? checked.value : null }); }
    catch (e) { showErr(e.message, e.field); return; }
    clearErr();
    saving = true;
    let back = null;   // wohin der Fokus nach dem Speichern bzw. Abbrechen gehört (nur, wenn er auf body gefallen ist – der gesperrte Knopf verliert ihn)
    busy(saveBtn, async () => {
      try {
        const id = editing ? editing.id : null, wasEdit = !!editing;
        const pre = await tapi("POST", "/api/teacher/free-days/preview", { body: { ...entry, ...(id ? { id } : {}) } });
        let shift = false;
        if (pre.items.length) {
          const choice = await askShift(entry, pre.items);
          if (!choice) { back = saveBtn; return; }
          shift = choice === "shift";
        }
        const r = await tapi(id ? "PUT" : "POST", "/api/teacher/free-days" + (id ? "/" + id : ""), { body: { ...entry, shift } });
        invalidateFreeDays();
        list = cleanFreeDays(r.freeDays); reset(); paint();
        report(r, entry, shift, pre.items.length, wasEdit);
        back = label;
      } catch (e) {
        if (e && e.data && e.data.field) setTimeout(() => showErr(e.message, e.data.field), 0); else { errToast(e); back = saveBtn; }
      } finally { saving = false; }
    }, "Prüfe …").then(() => { const a = document.activeElement; if (back && back.isConnected && (!a || a === document.body)) back.focus(); });
  });
  // Ergebnis nach dem Speichern: in der Statuszeile und – bei Verschiebungen – als Liste mit Links zu den Einheiten
  const result = h("div", { class: "fd-result" });
  function report(r, entry, shift, n, wasEdit) {
    clear(result);
    const shifted = r.shifted || [], failed = r.failed || [], noUnit = r.noUnit || [];
    const moved = shifted.reduce((a, x) => a + x.moved, 0);
    const head = "„" + entry.label + "“ " + (wasEdit ? "geändert" : "eingetragen") + "." +
      (shift && shifted.length ? " " + moved + (moved === 1 ? " Stunde" : " Stunden") + " in " + shifted.length + (shifted.length === 1 ? " Einheit" : " Einheiten") + " verschoben." : "") +
      (!shift && n ? " Die betroffenen Sitzungen bleiben, wo sie sind – sie sind als „unterrichtsfrei“ markiert." : "");
    status.textContent = head;
    toast(head, failed.length ? "err" : "ok", failed.length ? 9000 : 5000);
    const lines = [];
    if (shift && shifted.length) lines.push(h("div", { class: "notice ok" }, h("p", { text: "Verschoben – bitte jede dieser Einheiten mit Claude überarbeiten (dort steht ein Hinweis mit „Einheit mit Claude überarbeiten“):" }),
      h("ul", null, shifted.map((x) => h("li", null, h("a", { href: "#/lk/u/" + x.unitId, text: (x.title || "Einheit ohne Titel") + " (" + x.subject + " " + x.label + ")" }),
        ": " + x.moved + (x.moved === 1 ? " Stunde verschoben" : " Stunden verschoben") + (x.undated.length ? "; ohne Termin: " + x.undated.map((u) => "Stunde " + u.n).join(", ") : ""))))));
    if (failed.length) lines.push(h("div", { class: "notice err" }, h("p", { text: "Nicht verschoben (der Eintrag ist trotzdem gespeichert):" }),
      h("ul", null, failed.map((x) => h("li", null, h("a", { href: "#/lk/u/" + x.unitId, text: (x.title || "Einheit ohne Titel") + " (" + x.subject + " " + x.label + ")" }), ": " + x.reason)))));
    if (noUnit.length) lines.push(h("div", { class: "notice warn" }, h("p", { text: "Ohne Einheit – bitte selbst verschieben:" }),
      h("ul", null, noUnit.map((x) => h("li", null, h("a", { href: "#/lk/s/" + x.lessonId, text: fmtDay(x.date) + (x.time ? ", " + x.time + " Uhr" : "") + " – " + x.subject + " " + x.label + ": " + (x.title || "Sitzung") }))))));
    result.append(...lines);
  }
  const card = h("section", { class: "card freedays", id: "freedays", "aria-labelledby": "fd-h" },
    h("h2", { id: "fd-h", tabindex: "-1", text: "Unterrichtsfreie Tage" }),
    h("p", { class: "small", text: FREE_INTRO }),
    listBox, status, result, form);
  load();
  return card;
}

/* Rückfrage vor dem Speichern: welche Sitzungen (und Stunden ohne Sitzung) an den neuen unterrichtsfreien Tagen liegen → "shift" | "keep" | null */
function askShift(entry, items) {
  return new Promise((resolve) => {
    let done = false;
    const lessons = items.filter((x) => x.kind === "lesson").length, rows = items.length - lessons;
    const what = [lessons ? lessons + (lessons === 1 ? " Sitzung" : " Sitzungen") : null, rows ? rows + (rows === 1 ? " Stunde ohne Sitzung" : " Stunden ohne Sitzung") : null].filter(Boolean).join(" und ");
    const tbody = h("tbody", null, items.map((x) => h("tr", null,
      h("td", { "data-label": "Datum", text: fmtDay(x.date) }), h("td", { "data-label": "Uhrzeit", text: x.time ? x.time + " Uhr" : "–" }),
      h("td", { "data-label": "Fach/Kurs" }, h("span", { class: "ftag", dataset: { fach: x.fach || (x.school === "gs" ? "gs" : "") }, text: x.subject })),
      h("td", { "data-label": "Klasse", text: x.label }),
      h("td", { "data-label": "Titel" }, h("span", { text: x.title || (x.kind === "row" ? "Stunde " + x.n : "Sitzung") }),
        x.kind === "row" ? h("div", { class: "small muted", text: "Stunde " + x.n + " der Einheit, noch ohne Sitzung" }) : null,
        x.noUnit ? h("div", { class: "small warnc", text: "ohne Einheit – bitte selbst verschieben" }) : null,
        x.blocked ? h("div", { class: "small err", text: "wird nicht verschoben: " + x.blocked }) : null))));
    modal({ title: "Sitzungen an unterrichtsfreien Tagen", wide: true, onClose: () => { if (!done) resolve(null); }, body: (el) => el.append(
      h("p", { text: "Im neuen unterrichtsfreien Zeitraum „" + entry.label + "“ (" + freeRangeText(entry) + ", " + freeScopeText(entry.scope) + ") " + (items.length === 1 ? "liegt" : "liegen") +
        " schon " + what + " (heute oder später):" }),
      h("div", { class: "table-wrap" }, h("table", { class: "fd-table" }, h("thead", null, h("tr", null, ["Datum", "Uhrzeit", "Fach/Kurs", "Klasse", "Titel"].map((t) => h("th", { scope: "col", text: t })))), tbody)),
      h("p", { class: "small", text: "„Speichern und verschieben“ (empfohlen): Diese Stunden und alle folgenden Stunden ihrer Unterrichtseinheit rücken auf die nächsten freien Termine " +
        "laut Stundenplan der Einheit (wie bei einer Krankmeldung, aber ohne Ausfall-Eintrag). Was hinter das Ende der Einheit rutscht, bleibt ohne Termin; " +
        "danach erscheint in jeder betroffenen Einheit ein Hinweis, sie mit Claude zu überarbeiten." }),
      h("p", { class: "small", text: "„Nur speichern – Sitzungen bleiben“: Die Sitzungen behalten ihr Datum und werden als „unterrichtsfrei“ markiert." }),
      h("p", { class: "small", text: "Wird der unterrichtsfreie Eintrag später gelöscht, rücken verschobene Sitzungen nicht zurück." })),
      actions: [
        { label: "Abbrechen", onClick: () => { done = true; resolve(null); } },
        { label: "Nur speichern – Sitzungen bleiben", onClick: () => { done = true; resolve("keep"); } },
        { label: "Speichern und verschieben (empfohlen)", class: "primary", onClick: () => { done = true; resolve("shift"); } },
      ] });
  });
}
