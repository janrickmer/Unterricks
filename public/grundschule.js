// grundschule.js – Bereich „Grundschule“ der Lehrkraft: Übersicht mit dem Wochenkalender beider Schulformen und den Kursen der
// Jahrgänge 1–4 (gruppiert nach Jahrgang, aktuelles Schuljahr zuerst), neuen Kurs anlegen, Kursseite (Einheiten mit ihren Sitzungen,
// Kurseinstellungen, Fach/Klassen/Beschreibung, Planungsgrundlagen, neue Einheit). Fach der Einheiten und Sitzungen: „gs“, Klasse = Kurs-ID.
import { h, clear, nn, pageHead, toast, errToast, busy, confirmDialog, icon, stateLine, setFach } from "./ui.js";
import { render, go } from "./app.js";
import { tapi, teacherBar, markNav, printPending, cardsPendingRun } from "./teacher.js";
import { fmtClockBerlin, berlinToday, schoolYearOf, gsCourseShort, normalizeGsCourse, GS_CLASS_LETTERS, GS_LIMITS, fmtDay, clockMinutes, minutesClock, addDays } from "./shared.js";
import { WEEKDAYS, normalizeCourseSettings } from "./planning.js";
import { weekCard } from "./weekcal.js";
import { weekdayRows, courseSettingsCard } from "./coursecard.js";
import { baseLink, uploadBaseFile, editBase } from "./bases.js";
import { parentViewDom } from "./parents.js";

const GS_GONE = "Diesen Grundschulkurs gibt es nicht (mehr).";
const wdShort = (d) => ((WEEKDAYS.find((w) => w.d === d) || {}).n || "").slice(0, 2);
/* „Di 08:00, Do 09:50“ bzw. mit Ende „Di 08:00–08:45“ */
const whenText = (weekdays, withEnd = false) => (weekdays || []).map((w) => wdShort(w.day) + (w.time ? " " + w.time + (withEnd && clockMinutes(w.time) != null ? "–" + minutesClock(Math.min(24 * 60 - 1, clockMinutes(w.time) + w.minutes)) : "") : "")).join(", ");
const kids = (n) => n + (n === 1 ? " Kind" : " Kinder");
const sessions = (n) => n + (n === 1 ? " Sitzung" : " Sitzungen");

/* ---------- Übersicht #/lk/grundschule ---------- */
export async function gsOverviewPage() {
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("primary"), main);
  // derselbe Wochenkalender wie auf der Startseite: immer alle Termine beider Schulformen (lädt eigenständig)
  const week = weekCard(() => tapi("GET", "/api/teacher/schedule").then((r) => r.units));
  printPending();
  cardsPendingRun();
  let courses, lessons;
  try {
    [courses, lessons] = await Promise.all([tapi("GET", "/api/teacher/gs/courses").then((r) => r.courses || []), tapi("GET", "/api/teacher/lessons?school=gs").then((r) => r.lessons || [])]);
  } catch (e) { clear(main).append(pageHead({ fach: "gs", title: "Grundschule" }), week, h("p", { class: "err", role: "alert", text: e.message })); return; }
  const byId = new Map(courses.map((c) => [c.id, c]));
  const recent = lessons.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
  // Knopf „Neuen Kurs anlegen“ ganz oben (Wunsch der Lehrkraft vom 12.11.2026): sofort sichtbar, auch wenn der Wochenkalender darunter die
  // Kursliste aus dem Bildschirm schiebt (iPad); er führt zum Formular – Fokus im Klick selbst, also nie verspätet
  const form = newCourseCard();
  const add = h("button", { class: "btn gs-add", type: "button", onclick: () => {
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    form.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    const first = form.querySelector('input[name="gsn-grade"]:checked') || form.querySelector('input[name="gsn-grade"]');
    if (first) first.focus({ preventScroll: true });
  } }, icon("plus"), "Neuen Kurs anlegen");
  clear(main).append(...nn(pageHead({ fach: "gs", title: "Grundschule", aside: add, sub: "Kurse der Jahrgänge 1–4: Unterrichtseinheiten, Sitzungen mit Verlaufsplan und Elternansicht." }),
    week, gsCourseList(courses), form,
    recent.length ? h("section", { class: "card gs-recent", "aria-labelledby": "gs-recent-h" }, h("h2", { id: "gs-recent-h", text: "Zuletzt bearbeitet" }), gsLessonList(recent, byId)) : null));
}

/* Kurse des aktuellen Schuljahres nach Jahrgang; frühere Schuljahre eingeklappt */
function gsCourseList(courses) {
  const year = (schoolYearOf(berlinToday()) || {}).label;
  const cur = courses.filter((c) => !c.schoolYear || c.schoolYear >= year), old = courses.filter((c) => c.schoolYear && c.schoolYear < year);
  const tile = (c) => {
    const s = c.settings || {};
    const info = [whenText(s.weekdays) || null, Number.isInteger(s.classSize) ? kids(s.classSize) : null, sessions((c.counts || {}).lessons || 0)].filter(Boolean).join(" · ");
    return h("a", { class: "tile", href: "#/lk/grundschule/k/" + c.id, dataset: { fach: "gs" } },
      h("div", { class: "t", text: gsCourseShort(c) }), h("div", { class: "s", text: info }),
      c.revise ? h("div", { class: "s" }, h("span", { class: "badge stop", text: "überarbeiten" })) : null);
  };
  const byGrade = (list) => [1, 2, 3, 4].flatMap((g) => { const xs = list.filter((c) => c.grade === g); return xs.length ? [h("h3", { text: "Jahrgang " + g }), h("div", { class: "tiles" }, xs.map(tile))] : []; });
  return h("section", { class: "gs-courses", "aria-labelledby": "gs-courses-h" }, h("h2", { id: "gs-courses-h", text: "Ihre Kurse" }),
    ...(cur.length ? byGrade(cur) : [h("p", { class: "muted", text: "Noch keine Kurse – legen Sie mit „Neuen Kurs anlegen“ den ersten an." })]),
    old.length ? h("details", { class: "box" }, h("summary", null, "Frühere Schuljahre"), ...byGrade(old)) : null);
}

/* Sitzungen eines Grundschulkurses (ohne Sitzungscode, ohne Schüler:innen, ohne Schulportal); byId = Kurse (für die Übersicht) */
export function gsLessonList(lessons, byId = null) {
  const list = h("div", { class: "list" });
  if (!lessons.length) list.append(h("p", { class: "muted", text: "Noch keine Sitzungen." }));
  for (const l of lessons) {
    const k = byId ? byId.get(l.klass) : null;
    list.append(h("a", { class: "item", href: "#/lk/s/" + l.id },
      h("div", { class: "main" }, h("div", { class: "name", text: l.title }),
        h("div", { class: "meta", text: [k ? gsCourseShort(k) : null, l.date ? fmtDay(l.date) + (l.startTime ? ", " + l.startTime : "") : "ohne Termin", l.durationMin ? l.durationMin + " min" : null].filter(Boolean).join(" · ") })),
      h("div", { class: "row" },
        l.cancelled ? h("span", { class: "badge stop", text: "ausgefallen" }) : null,
        !l.date && !l.cancelled ? h("span", { class: "badge", text: "ohne Termin" }) : null,
        l.hasStop ? h("span", { class: "badge stop" }, icon("pause"), "Zwischenstopp") : null,
        l.hasHomework ? h("span", { class: "badge", text: "Hausaufgabe" }) : null,
        l.hasParentLink ? h("span", { class: "badge ok", text: "Elternlink" }) : null,
        !l.cancelled && !l.hasSummary ? h("span", { class: "badge hw", text: "Inhalt für Eltern fehlt" }) : null)));
  }
  return list;
}

/* Eingaben eines Kurses: Jahrgang, Klassen, Fach (Religion oder anderes), Beschreibung. cur = bisheriger Kurs (Bearbeiten) oder null.
   → {el, read() → Rohdaten für normalizeGsCourse, focusFor(meldung), other() (anderes Fach gewählt?), onSubject(fn)} */
function courseFields(cur, idp) {
  let grade = cur ? cur.grade : null;
  const classes = new Set(cur ? cur.classes : []);
  const subjectListeners = [];
  const gradeBox = h("div", { class: "row gs-radios" }, [1, 2, 3, 4].map((g) => h("label", { class: "chk" },
    h("input", { type: "radio", name: idp + "-grade", value: String(g), checked: grade === g ? true : null, onchange: () => { grade = g; paintClasses(); } }), "Jahrgang " + g)));
  const classBox = h("div", { class: "row gs-radios" });
  const paintClasses = () => clear(classBox).append(...GS_CLASS_LETTERS.map((x) => h("label", { class: "chk" },
    h("input", { type: "checkbox", value: x, checked: classes.has(x) ? true : null, onchange: (e) => { if (e.target.checked) classes.add(x); else classes.delete(x); } }), (grade || "") + x)));
  paintClasses();
  const relig = h("input", { type: "radio", name: idp + "-subj", value: "religion", checked: !cur || cur.religion ? true : null });
  const other = h("input", { type: "radio", name: idp + "-subj", value: "other", checked: cur && !cur.religion ? true : null });
  const name = h("input", { id: idp + "-name", maxlength: String(GS_LIMITS.subjectName), value: cur && !cur.religion ? cur.subjectName : "", placeholder: "z. B. Sachunterricht" });
  const nameField = h("div", { class: "field" + (other.checked ? "" : " hidden") }, h("label", { for: idp + "-name" }, "Name des Fachs"), name);
  const sync = () => { nameField.classList.toggle("hidden", !other.checked); for (const fn of subjectListeners) fn(other.checked); };
  relig.addEventListener("change", sync); other.addEventListener("change", sync);
  const desc = h("textarea", { id: idp + "-desc", rows: "3", maxlength: String(GS_LIMITS.description), value: cur ? cur.description || "" : "", "aria-describedby": idp + "-desc-h" });
  const el = h("div", { class: "stack" },
    h("fieldset", null, h("legend", { text: "Jahrgang" }), gradeBox),
    h("fieldset", { "aria-describedby": idp + "-cls-h" }, h("legend", { text: "Klassen im Kurs (höchstens drei)" }), classBox,
      h("p", { class: "hint", id: idp + "-cls-h", text: "Alle Kinder aus einer Klasse oder gemischt aus bis zu drei Klassen." })),
    h("fieldset", null, h("legend", { text: "Fach" }), h("div", { class: "row gs-radios" }, h("label", { class: "chk" }, relig, "Religion (evangelisch)"), h("label", { class: "chk" }, other, "Anderes Fach")), nameField),
    h("div", { class: "field" }, h("label", { for: idp + "-desc" }, "Beschreibung des Fachs (optional)"), desc,
      h("p", { class: "hint", id: idp + "-desc-h", text: "Damit Claude das Ziel des Unterrichts in diesem Kurs kennt, z. B. „Wir lernen Geschichten aus der Bibel kennen und …“. Nur für die Planung, nicht für Eltern." })));
  const read = () => ({ grade, classes: [...classes], religion: !other.checked, subjectName: other.checked ? name.value : undefined, description: desc.value });
  const focusFor = (msg) => {
    const t = /Jahrgang/.test(msg) ? gradeBox.querySelector("input") : /Klasse/.test(msg) ? classBox.querySelector("input") : /Namen? des Fachs/.test(msg) ? name : /Beschreibung/.test(msg) ? desc : null;
    if (t) t.focus();
  };
  return { el, read, focusFor, other: () => other.checked, onSubject: (fn) => subjectListeners.push(fn) };
}
/* erste ungültige Dauer der Termine (wie die Karte „Kurseinstellungen“) */
const badDuration = (list) => list.findIndex((w) => !Number.isInteger(w.minutes) || w.minutes < 20 || w.minutes > 240);

/* Karte „Neuen Kurs anlegen“ (Übersicht): Kurs, Stundenplan, Zahl der Kinder, Schuljahr; bei einem anderen Fach optional eine Planungsgrundlage */
function newCourseCard() {
  const f = courseFields(null, "gsn");
  const list = [], rows = weekdayRows(list, { requireTime: true });
  const size = h("input", { id: "gsn-size", type: "number", min: "1", max: "60", step: "1", inputmode: "numeric" });
  const sy = schoolYearOf(berlinToday()), next = schoolYearOf(addDays(sy.to, 1));
  const year = h("select", { id: "gsn-year" }, [sy, next].map((y, i) => h("option", { value: y.label, selected: i === 0 ? true : null }, y.label)));
  const kind = h("select", { id: "gsn-kind" }, h("option", { value: "gs-curriculum" }, "Curriculum (Jahrgänge 1–4)"), h("option", { value: "sonstiges" }, "Andere Planungsgrundlage"));
  const file = h("input", { id: "gsn-file", type: "file", accept: "application/pdf,.pdf" });
  const basis = h("div", { class: "stack hidden gsn-basis" },
    h("div", { class: "field" }, h("label", { for: "gsn-kind" }, "Planungsgrundlage (optional)"), kind),
    h("div", { class: "field" }, h("label", { for: "gsn-file" }, "PDF-Datei (optional)"), file,
      h("p", { class: "hint", text: "Ihr Browser liest den Text Seite für Seite aus; die KI arbeitet nur mit diesem Text. Die Original-PDF speichert Unterricks dazu (nur für Sie sichtbar)." })));
  f.onSubject((otherSubject) => basis.classList.toggle("hidden", !otherSubject));
  const err = h("p", { class: "err", role: "alert", id: "gsn-err" }), status = h("p", { class: "small", role: "status" });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Kurs anlegen");
  const fail = (msg, el) => { stateLine(err, msg, "err"); if (el) el.focus(); else f.focusFor(msg); };
  const form = h("form", { class: "card gs-form gs-new", "aria-labelledby": "gsn-h", novalidate: true, onsubmit: (e) => {
    e.preventDefault();
    busy(btn, async () => {
      clear(err);
      const raw = { ...f.read(), weekdays: list, classSize: size.value.trim() === "" ? null : size.value.trim(), schoolYear: year.value };
      try { normalizeGsCourse(raw); } catch (x) { fail(x.message); return; }
      const bad = badDuration(list);
      if (bad >= 0) { fail("Termin " + (bad + 1) + ": Bitte eine Dauer zwischen 20 und 240 Minuten eintragen.", rows.querySelectorAll("input.cs-min")[bad]); return; }
      try { normalizeCourseSettings(raw, { requireTime: true }); }
      catch (x) { fail(x.message, /Uhrzeit/.test(x.message) ? [...rows.querySelectorAll("input.cs-time")].find((i) => !i.value) : size); return; }
      const pdf = f.other() ? file.files[0] || null : null;
      if (pdf && !/\.pdf$/i.test(pdf.name) && pdf.type !== "application/pdf") { fail("Bitte eine PDF-Datei wählen.", file); return; }
      let course;
      try { course = (await tapi("POST", "/api/teacher/gs/courses", { body: raw })).course; }
      catch (x) { fail(x.message); return; }
      if (pdf) {
        try {
          const r = await uploadBaseFile({ subject: course.id, kind: kind.value, title: pdf.name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").slice(0, 200), file: pdf, onStatus: (t) => { status.textContent = t; } });
          if (r.pdfError) toast("Der Kurs ist angelegt; die Original-PDF der Planungsgrundlage ließ sich nicht speichern (" + String(r.pdfError).replace(/\.$/, "") + "). Sie können sie auf der Kursseite ergänzen.", "err", 9000);
        } catch (x) { toast("Der Kurs ist angelegt; die Planungsgrundlage ließ sich nicht speichern (" + String(x.message || x).replace(/\.$/, "") + "). Sie können sie auf der Kursseite hinzufügen.", "err", 9000); }
      }
      toast("Kurs „" + course.short + "“ angelegt.", "ok");
      go("#/lk/grundschule/k/" + course.id);
    }, "Lege an …");
  } },
    h("h2", { id: "gsn-h", text: "Neuen Kurs anlegen" }),
    f.el,
    h("fieldset", null, h("legend", { text: "Wann findet der Kurs statt?" }), rows),
    h("div", { class: "meta-grid" },
      h("div", { class: "field" }, h("label", { for: "gsn-size" }, "Zahl der Kinder im Kurs"), size),
      h("div", { class: "field" }, h("label", { for: "gsn-year" }, "Schuljahr"), year)),
    basis, err, status, h("div", { class: "row end" }, btn));
  return form;
}

/* ---------- Kursseite #/lk/grundschule/k/<id> ---------- */
export async function gsCoursePage(id) {
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade den Kurs …" }));
  render(teacherBar("primary"), main);
  let course, settings, units, lessons, bases, basis;
  const load = async () => {
    const r = await tapi("GET", "/api/teacher/gs/courses/" + id);
    course = r.course; settings = r.settings;
    [units, lessons, bases, basis] = await Promise.all([
      tapi("GET", "/api/teacher/units?subject=gs&klass=" + id).then((x) => x.units),
      tapi("GET", "/api/teacher/lessons?subject=gs&klass=" + id).then((x) => x.lessons),
      tapi("GET", "/api/teacher/bases?subject=" + id).then((x) => x.bases),
      tapi("GET", "/api/teacher/basis?subject=gs&klass=" + id).catch(() => null)]);
  };
  try { await load(); }
  catch (e) {
    clear(main).append(pageHead({ fach: "gs", crumbs: [["#/lk/grundschule", "Grundschule"], "Kurs"], title: "Grundschulkurs" }),
      h("div", { class: "card" }, h("p", { class: e.status === 404 ? "muted" : "err", text: e.status === 404 ? GS_GONE : e.message }), h("a", { class: "btn", href: "#/lk/grundschule" }, "Zur Übersicht Grundschule")));
    return;
  }
  // neu aufbauen; focus = Selektor für das Element, das danach den Fokus bekommt – nur, wenn der Fokus mit dem alten Aufbau verloren ging
  // (also nicht, wenn Nutzer:in oder Test ihn inzwischen woanders hingesetzt haben)
  const reload = async (focus = null) => {
    try {
      await load(); paint();
      const a = document.activeElement;
      if (focus && (!a || a === document.body || !a.isConnected)) { const t = main.querySelector(focus); if (t) t.focus(); }
    } catch (e) { errToast(e); }
  };
  const subText = () => ["Jahrgang " + course.grade, settings && Number.isInteger(settings.classSize) ? kids(settings.classSize) : null,
    settings && settings.weekdays.length ? whenText(settings.weekdays, true) : null, course.schoolYear ? "Schuljahr " + course.schoolYear : null].filter(Boolean).join(" · ");
  function paint() {
    const byDateAsc = (a, b) => (a.date === b.date ? a.createdAt - b.createdAt : (a.date || "￿") < (b.date || "￿") ? -1 : 1);
    const unitBox = h("div", { class: "stack" });
    if (!units.length) unitBox.append(h("p", { class: "muted", text: "Noch keine Unterrichtseinheit. Legen Sie rechts die erste an." }));
    for (const u of units) {
      const ls = lessons.filter((l) => l.unitId === u.id).sort(byDateAsc), dates = ls.map((l) => l.date).filter(Boolean).sort();
      unitBox.append(h("section", { class: "card unit-card" },
        h("div", { class: "section-title" }, h("h2", null, h("a", { href: "#/lk/u/" + u.id, text: u.title || "Unterrichtseinheit ohne Titel" })),
          h("span", { class: "badge " + (u.status === "geplant" ? "ok" : ""), text: u.status === "geplant" ? "festgelegt" : "in Planung" })),
        h("p", { class: "small muted", text: [u.plan && u.plan.lernaufgabe ? "Lernaufgabe: " + u.plan.lernaufgabe.slice(0, 160) + (u.plan.lernaufgabe.length > 160 ? " …" : "") : "Lernaufgabe noch offen",
          u.rows.length ? u.rows.length + " Stunden geplant" : null, dates.length ? fmtDay(dates[0]) + " – " + fmtDay(dates[dates.length - 1]) : null].filter(Boolean).join(" · ") }),
        ls.length ? gsLessonList(ls) : h("p", { class: "small" }, u.status === "geplant" ? "Noch keine Sitzungen." : "Sitzungen entstehen, sobald die Einheit festgelegt ist. ", h("a", { href: "#/lk/u/" + u.id }, "Einheit öffnen"))));
    }
    const loose = lessons.filter((l) => !l.unitId || !units.some((u) => u.id === l.unitId)).sort(byDateAsc);
    if (loose.length) unitBox.append(h("section", { class: "card" }, h("h2", { text: "Sitzungen ohne Einheit" }), gsLessonList(loose)));
    clear(main).append(pageHead({ fach: "gs", crumbs: [["#/lk/grundschule", "Grundschule"], course.short], title: course.label, sub: subText() }),
      h("div", { class: "session-grid" }, unitBox, h("div", { class: "side gs-side" },
        courseSettingsCard({ subject: "gs", klass: id, settings, gs: true, onSaved: (s) => { settings = s; const sub = main.querySelector(".pagehead .pagesub"); if (sub) sub.textContent = subText(); } }),
        courseCard(), basesCard(), newUnitCard())));
  }
  /* Fach, Klassen und Beschreibung ändern; löschen nur ohne Einheiten und Sitzungen */
  function courseCard() {
    const f = courseFields(course, "gse");
    const err = h("p", { class: "err", role: "alert" }), state = h("p", { class: "small muted", role: "status" });
    const save = h("button", { class: "btn primary gse-save", type: "button" }, "Speichern");
    save.addEventListener("click", () => busy(save, async () => {
      clear(err);
      const raw = f.read();
      try { normalizeGsCourse(raw, { partial: true, current: course }); } catch (x) { stateLine(err, x.message, "err"); f.focusFor(x.message); return; }
      try { course = (await tapi("PATCH", "/api/teacher/gs/courses/" + id, { body: raw })).course; toast("Kurs gespeichert.", "ok"); await reload("section.gs-edit button.gse-save"); }
      catch (x) { stateLine(err, x.message, "err"); }
    }, "Speichere …"));
    const empty = !units.length && !lessons.length;
    const del = empty ? h("button", { class: "btn ghost danger", type: "button", onclick: async () => {
      if (!(await confirmDialog("Kurs löschen?", "„" + course.label + "“ mit seinen Kurseinstellungen und seinen eigenen Planungsgrundlagen löschen?", "Kurs löschen", true))) return;
      try { await tapi("DELETE", "/api/teacher/gs/courses/" + id); toast("Kurs gelöscht.", "ok"); go("#/lk/grundschule"); } catch (x) { errToast(x); }
    } }, icon("trash"), "Kurs löschen") : null;
    return h("section", { class: "card gs-form gs-edit", "aria-labelledby": "gse-h" }, h("h2", { id: "gse-h", text: "Fach, Klassen und Beschreibung" }), f.el, err,
      h("div", { class: "row between" }, state, h("div", { class: "row" }, del, save)),
      empty ? null : h("p", { class: "hint", text: "Löschen lässt sich ein Kurs erst, wenn er keine Unterrichtseinheiten und Sitzungen mehr hat." }));
  }
  /* Planungsgrundlagen: Religion → Stand des Curriculums bei Ev. Religion; alle → eigene Grundlagen des Kurses (hochladen, bearbeiten, löschen) */
  function basesCard() {
    // ohne geladenen Stand (Fehler beim Abruf) keine Aussage, ob das Curriculum vorliegt
    const status = !basis ? null : basis.missing.length ? h("div", { class: "notice warn" }, "Es fehlt noch: " + basis.missing.join("; ") + ".")
      : course.religion ? h("p", { class: "small ok" }, icon("check"), "Das Schulcurriculum Ev. Religion (Grundschule) für Jahrgang " + course.grade + " liegt vor.") : null;
    const kind = h("select", { "aria-label": "Art der Planungsgrundlage des Kurses" }, h("option", { value: "gs-curriculum" }, "Curriculum (Jahrgänge 1–4)"), h("option", { value: "sonstiges" }, "Andere Planungsgrundlage"));
    const st = h("p", { class: "small", role: "status" });
    const inp = h("input", { type: "file", accept: "application/pdf,.pdf", class: "sr-only", tabindex: "-1", "aria-hidden": "true" });
    const pick = h("button", { class: "btn small gsb-pick", type: "button", onclick: () => inp.click() }, icon("up"), "PDF auswählen …");
    inp.addEventListener("change", () => {
      const file = inp.files[0]; inp.value = "";
      if (!file) return;
      busy(pick, async () => {
        if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { stateLine(st, "Bitte eine PDF-Datei wählen.", "err"); return; }
        try {
          const r = await uploadBaseFile({ subject: id, kind: kind.value, title: file.name.replace(/\.pdf$/i, "").replace(/[_]+/g, " ").slice(0, 200), file, onStatus: (t) => stateLine(st, t) });
          if (r.pdfError) toast("Der Text ist gespeichert, die Original-PDF nicht (" + String(r.pdfError).replace(/\.$/, "") + ").", "err", 9000);
          else toast("„" + r.base.title + "“ gespeichert (" + r.pages + " Seiten).", "ok");
          await reload("section.gs-bases button.gsb-pick");
        } catch (x) { stateLine(st, ""); errToast(x); }
      }, "Speichere …");
    });
    const own = h("div", { class: "list" }, bases.length ? bases.map((b) => h("div", { class: "item", dataset: { base: b.id } },
      h("div", { class: "main" }, h("div", { class: "name" }, baseLink({ id: b.id, title: b.title })), h("div", { class: "meta", text: [b.kindLabel, b.pages + " Seiten", b.pdf ? "Original-PDF gespeichert" : "nur Text gespeichert"].join(" · ") })),
      h("div", { class: "acts" },
        h("button", { class: "btn small gsb-edit", type: "button", "aria-label": "„" + b.title + "“ bearbeiten", onclick: () => editBase(b, { onSaved: () => reload('[data-base="' + b.id + '"] button.gsb-edit') }) }, "Bearbeiten"),
        h("button", { class: "btn small ghost danger", type: "button", "aria-label": "„" + b.title + "“ löschen", onclick: async () => {
          if (!(await confirmDialog("Planungsgrundlage löschen", "„" + b.title + "“ mit allen Seitentexten löschen? Bereits geplante Einheiten bleiben erhalten.", "Löschen", true))) return;
          try { await tapi("DELETE", "/api/teacher/bases/" + b.id); toast("Gelöscht.", "ok"); await reload("section.gs-bases button.gsb-pick"); } catch (x) { errToast(x); }
        } }, icon("trash"))))) : [h("p", { class: "small muted", text: "Noch keine eigenen Planungsgrundlagen." })]);
    return h("section", { class: "card gs-bases", "aria-labelledby": "gsb-h" }, h("h2", { id: "gsb-h", text: "Planungsgrundlagen" }),
      ...nn(status, course.religion ? h("p", { class: "small" }, "Das Schulcurriculum der Grundschule liegt bei ", h("a", { href: "#/lk/grundlagen/evrel" }, "Planungsgrundlagen Ev. Religion"), ".") : null),
      h("h3", { text: "Eigene Planungsgrundlagen des Kurses" }), own,
      h("div", { class: "row" }, kind, pick, inp), st);
  }
  function newUnitCard() {
    const title = h("input", { id: "gs-ut", maxlength: "200", placeholder: "z. B. Josef und seine Brüder" });
    const btn = h("button", { class: "btn primary", type: "submit" }, "Einheit anlegen");
    return h("form", { class: "card", onsubmit: (e) => {
      e.preventDefault();
      busy(btn, async () => {
        try { const r = await tapi("POST", "/api/teacher/units", { body: { subject: "gs", klass: id, title: title.value } }); go("#/lk/u/" + r.unit.id); }
        catch (x) { errToast(x); }
      }, "Lege an …");
    } }, h("h2", { text: "Neue Unterrichtseinheit planen" }),
      h("p", { class: "small", text: "Zuerst wird die Einheit geplant (Rahmendaten, dann mit Claude Lernaufgabe, Leupold-Schema und Ablauf); aus der festgelegten Einheit entstehen die Sitzungen mit Datum. Den Stundenplan übernimmt die Einheit aus den Kurseinstellungen." }),
      h("div", { class: "field" }, h("label", { for: "gs-ut" }, "Thema der neuen Einheit"), title), btn);
  }
  paint();
}

/* ---------- Vorschau der Elternansicht #/lk/eltern/<Sitzung>[/<vorherige Sitzung>] ----------
   Zeigt der Lehrkraft, was Eltern nach dem Unterricht sehen – ohne Zeitsperre und ohne Link (Dateien öffnen über #/lk/datei/<id>). */
const longWhen = (ms) => new Date(ms).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" }) + ", " + fmtClockBerlin(ms) + " Uhr";
export async function parentsPreviewPage(id, other = null) {
  const main = h("main", { class: "narrow parents parents-preview" }, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("primary"), main);
  markNav("primary");
  const target = other && other !== id ? other : id;
  const load = () => tapi("GET", "/api/teacher/lessons/" + target + "/parents" + (target !== id ? "?anchor=" + id : ""));
  let d;
  try { d = await load(); }
  catch (e) {
    clear(main).append(pageHead({ fach: "gs", title: "Elternansicht (Vorschau)" }), h("p", { class: "notice err", role: "alert", text: e.message }),
      h("p", null, h("a", { class: "btn", href: "#/lk/s/" + id }, "Zur Sitzung")));
    return;
  }
  if (!main.isConnected) return;
  const when = d.opensAt ? "freigeschaltet ab " + longWhen(d.opensAt) : "freigeschaltet erst, wenn ein Termin eingetragen ist";
  const view = parentViewDom(d, {
    isAnchor: target === id,
    openFileHref: (fid) => "#/lk/datei/" + fid,
    sessionHref: (lid) => "#/lk/eltern/" + id + (lid && lid !== id ? "/" + lid : ""),
    loadPrevious: () => tapi("GET", "/api/teacher/lessons/" + id + "/parents/previous"),
    reload: load,
  });
  clear(main).append(
    h("div", { class: "notice pv-banner", role: "note", text: "Vorschau: So sehen Eltern diese Sitzung nach dem Unterricht (" + when + "). Den Link bekommen Sie mit „Sitzungslink für Eltern kopieren“." }),
    view,
    h("p", { class: "small" }, h("a", { href: "#/lk/s/" + target }, "Zur Sitzung (Lehreransicht)")));
  setFach("gs");
  if (other && (!document.activeElement || document.activeElement === document.body)) view.focusHeading();
}

