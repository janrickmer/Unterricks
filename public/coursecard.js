// coursecard.js – Kurseinstellungen eines Kurses (Gymnasium und Grundschule): wann der Kurs stattfindet und wie viele Schüler:innen
// dazugehören. Neue Unterrichtseinheiten übernehmen den Stundenplan (in der Einheit änderbar); Claude kennt die Schülerzahl.
import { h, clear, toast, errToast, busy, icon, stateLine, fmtTime } from "./ui.js";
import { tapi } from "./teacher.js";
import { WEEKDAYS, CLASS_SIZE_MAX } from "./planning.js";

/* Termine pro Woche bearbeiten (list wird verändert): Wochentag, Beginn, Dauer; requireTime = Uhrzeit Pflicht (Grundschule) */
export function weekdayRows(list, { requireTime = false } = {}) {
  const box = h("div", { class: "stack cs-rows" });
  const paint = () => {
    clear(box).append(...(list.length ? [] : [h("p", { class: "small muted", text: "Noch kein Termin eingetragen." })]), ...list.map((w, i) => {
      const n = i + 1;
      return h("div", { class: "row cs-row" },
        h("select", { class: "cs-day", "aria-label": "Wochentag des Termins " + n, onchange: (e) => { w.day = Number(e.target.value); } },
          WEEKDAYS.map((d) => h("option", { value: d.d, selected: d.d === w.day ? true : null }, d.n))),
        h("input", { type: "time", step: "300", class: "cs-time", value: w.time || "", required: requireTime ? true : null, "aria-label": "Beginn des Termins " + n + " (Uhrzeit)",
          oninput: (e) => { w.time = e.target.value || null; } }),
        h("span", { class: "small", text: "Uhr," }),
        h("input", { type: "number", min: "20", max: "240", step: "5", class: "cs-min", value: w.minutes, "aria-label": "Dauer des Termins " + n + " in Minuten",
          oninput: (e) => { w.minutes = Number(e.target.value); } }),
        h("span", { class: "small", text: "Minuten" }),
        h("button", { class: "btn small ghost iconbtn", type: "button", "aria-label": "Termin " + n + " entfernen", onclick: () => { list.splice(i, 1); paint(); box.querySelector("button.cs-add")?.focus(); } }, icon("x")));
    }), h("button", { class: "btn small cs-add", type: "button", onclick: () => {
      const last = list[list.length - 1];
      list.push({ day: last ? (last.day % 5) + 1 : 1, minutes: last ? last.minutes : 45, time: null });
      paint();
      const days = box.querySelectorAll("select.cs-day");
      if (days.length) days[days.length - 1].focus();
    } }, "+ Termin pro Woche"));
  };
  paint();
  box.repaint = paint;
  return box;
}

/* Karte „Kurseinstellungen“ (settings = {weekdays, classSize, updatedAt} | null aus GET /api/teacher/course-settings) */
export function courseSettingsCard({ subject, klass, settings, gs = false, onSaved }) {
  const list = ((settings && settings.weekdays) || []).map((w) => ({ ...w }));
  const rows = weekdayRows(list, { requireTime: gs });
  const size = h("input", { id: "cs-size", type: "number", min: "1", max: String(CLASS_SIZE_MAX), step: "1", inputmode: "numeric",
    value: settings && Number.isInteger(settings.classSize) ? String(settings.classSize) : "" });
  const state = h("p", { class: "small muted", role: "status" });
  if (settings && settings.updatedAt) stateLine(state, "Zuletzt gespeichert: " + fmtTime(settings.updatedAt));
  const save = h("button", { class: "btn primary", type: "button" }, "Kurseinstellungen speichern");
  save.addEventListener("click", () => busy(save, async () => {
    try {
      const r = await tapi("PUT", "/api/teacher/course-settings", { body: { subject, klass, weekdays: list, classSize: size.value.trim() === "" ? null : size.value.trim() } });
      list.splice(0, list.length, ...r.settings.weekdays.map((w) => ({ ...w })));
      rows.repaint();
      size.value = Number.isInteger(r.settings.classSize) ? String(r.settings.classSize) : "";
      stateLine(state, "Gespeichert: " + fmtTime(r.settings.updatedAt), "ok");
      toast("Kurseinstellungen gespeichert.", "ok");
      if (onSaved) onSaved(r.settings);
    } catch (e) { stateLine(state, e.message, "err"); errToast(e); }
  }, "Speichere …"));
  return h("section", { class: "card cs-card", "aria-labelledby": "cs-h" },
    h("h2", { id: "cs-h", text: "Kurseinstellungen" }),
    h("p", { class: "small", text: "Wann der Kurs stattfindet und wie viele Schüler:innen dazugehören. Neue Unterrichtseinheiten übernehmen den Stundenplan (in der Einheit änderbar); Claude kennt die Schülerzahl, z. B. für die Zahl der Ausdrucke." }),
    h("fieldset", { class: "cs-when" }, h("legend", { text: "Wann findet der Kurs statt?" }), rows),
    h("div", { class: "field" }, h("label", { for: "cs-size", text: gs ? "Zahl der Kinder im Kurs" : "Schülerzahl" }), size),
    h("div", { class: "row between" }, state, save));
}
