// grundschule.js – Bereich „Grundschule“ der Lehrkraft: Übersicht mit dem Wochenkalender beider Schulformen und den Kursen der
// Jahrgänge 1–4 (gruppiert nach Jahrgang, aktuelles Schuljahr zuerst), Kursseite. Fach der Einheiten und Sitzungen: „gs“, Klasse = Kurs-ID.
import { h, clear, nn, pageHead } from "./ui.js";
import { render } from "./app.js";
import { tapi, teacherBar, printPending } from "./teacher.js";
import { berlinToday, schoolYearOf, gsCourseShort } from "./shared.js";
import { weekCard } from "./weekcal.js";

/* ---------- Übersicht #/lk/grundschule ---------- */
export async function gsOverviewPage() {
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("primary"), main);
  // derselbe Wochenkalender wie auf der Startseite: immer alle Termine beider Schulformen (lädt eigenständig)
  const week = weekCard(() => tapi("GET", "/api/teacher/schedule").then((r) => r.units));
  printPending();
  const courses = [];   // Kurse kommen mit der Kursverwaltung (GET /api/teacher/gs/courses)
  clear(main).append(...nn(pageHead({ fach: "gs", title: "Grundschule", sub: "Kurse der Jahrgänge 1–4: Unterrichtseinheiten, Sitzungen mit Verlaufsplan und Elternansicht." }),
    week, gsCourseList(courses)));
}

/* Kurse des aktuellen Schuljahres nach Jahrgang; frühere Schuljahre eingeklappt */
function gsCourseList(courses) {
  const year = (schoolYearOf(berlinToday()) || {}).label;
  const cur = courses.filter((c) => !c.schoolYear || c.schoolYear >= year), old = courses.filter((c) => c.schoolYear && c.schoolYear < year);
  const tiles = (list) => h("div", { class: "tiles" }, list.map((c) => h("a", { class: "tile", href: "#/lk/grundschule/k/" + c.id, dataset: { fach: "gs" } },
    h("div", { class: "t", text: gsCourseShort(c) }), h("div", { class: "s", text: c.label || "" }))));
  const byGrade = (list) => [1, 2, 3, 4].flatMap((g) => { const xs = list.filter((c) => c.grade === g); return xs.length ? [h("h3", { text: "Jahrgang " + g }), tiles(xs)] : []; });
  return h("section", { class: "gs-courses", "aria-labelledby": "gs-courses-h" }, h("h2", { id: "gs-courses-h", text: "Ihre Kurse" }),
    ...(cur.length ? byGrade(cur) : [h("p", { class: "muted", text: "Noch keine Kurse – legen Sie unten den ersten an." })]),
    old.length ? h("details", { class: "box" }, h("summary", null, "Frühere Schuljahre"), ...byGrade(old)) : null);
}

/* ---------- Kursseite #/lk/grundschule/k/<id> ---------- */
// (Platzhalter: Kurse und ihre Seite – geladen über id – kommen mit der Kursverwaltung; bis dahin nur der Rückweg)
export async function gsCoursePage(id) {
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade den Kurs …" }));
  render(teacherBar("primary"), main);
  clear(main).append(pageHead({ fach: "gs", crumbs: [["#/lk/grundschule", "Grundschule"], "Kurs"], title: "Grundschulkurs" }),
    h("div", { class: "card" }, h("p", { class: "muted", text: "Diesen Grundschulkurs gibt es nicht (mehr)." }), h("a", { class: "btn", href: "#/lk/grundschule" }, "Zur Übersicht Grundschule")));
}
