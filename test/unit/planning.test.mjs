import test from "node:test";
import assert from "node:assert/strict";
import { normalizeParams, computeSlots, lessonSlots, normalizePlan, normalizeRows, assignDates, extractUnitChange, stripUnitBlock, unitContext,
  claudeUnitPrompt, claudeSubstitutePrompt, claudeLessonPrompt, lessonChatName, normalizeSubstitute, SUBSTITUTE_SHARE } from "../../public/planning.js";
import { SYSTEM_PROMPT_ROLE, UNIT_RULE_BASE, ANALOG_RULE, PORTAL_EXAMPLE } from "../../public/shared.js";
import { detectKcgo, detectErlass, detectCurriculum, detectECurriculum, parseRanges, formatRanges, pageText, wantedSections, missingFor,
  detectGsCurriculum, detectSections, wantedGsSections, missingForGs, gsReligionCourseIn, BASE_KINDS } from "../../public/bases-detect.js";

let n = 0;
const uid = () => (n++).toString(16).padStart(8, "0");

test("Termine: Stundenplan im Zeitraum, ohne Ferien, Klausurtag markiert", () => {
  // 2026-11-09 ist ein Montag
  const params = { start: "2026-11-09", end: "2026-11-27", exam: "2026-11-19", weekdays: [{ day: 1, minutes: 90 }, { day: 4, minutes: 45 }], breaks: [{ from: "2026-11-16", to: "2026-11-16", label: "Studientag" }] };
  const slots = computeSlots(params);
  assert.deepEqual(slots.map((s) => s.date + ":" + s.kind), ["2026-11-09:stunde", "2026-11-12:stunde", "2026-11-19:klausur", "2026-11-23:stunde", "2026-11-26:stunde"]);
  assert.equal(lessonSlots(slots).length, 4);
  assert.equal(slots[0].minutes, 90);
  assert.deepEqual(computeSlots({ start: "2026-11-09" }), []);
  const p = normalizeParams({ weekdays: [{ day: 6, minutes: 45 }, { day: 2, minutes: 10 }, { day: 3, minutes: 60 }], start: "2026-02-30" });
  assert.deepEqual(p.weekdays, [{ day: 3, minutes: 60, time: null }]);
  assert.equal(p.start, null);
  // Beginn je Wochentag (freiwillig): geht in die Termine und von dort in die Zeilen/Sitzungen
  const withTime = computeSlots({ start: "2026-11-09", end: "2026-11-12", weekdays: [{ day: 1, minutes: 90, time: "07:45" }, { day: 4, minutes: 45, time: "25:00" }] });
  assert.deepEqual(withTime.map((s) => s.date + " " + s.time), ["2026-11-09 07:45", "2026-11-12 null"]);
  const rows = assignDates([{ uid: "a", stundenfrage: "x", ablauf: [], date: null, minutes: null, time: null }], withTime);
  assert.equal(rows[0].time, "07:45");
});

test("Zeilen und Termine: Lernschritt bleibt leer, gesetzte Daten bleiben, Rest der Reihe nach", () => {
  const rows = normalizeRows([{ stundenfrage: "Warum?", ablauf: "- Einstieg\n- Arbeit", schritt: null }, { stundenfrage: "Wie?", ablauf: ["a"], schritt: 1, date: "2026-11-12" }, { stundenfrage: "", ablauf: [] }, { stundenfrage: "Was?", schritt: "0" }], uid);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].schritt, null);
  assert.deepEqual(rows[0].ablauf, ["Einstieg", "Arbeit"]);
  assert.equal(rows[2].schritt, 0);
  const slots = computeSlots({ start: "2026-11-09", end: "2026-11-27", weekdays: [{ day: 1, minutes: 90 }, { day: 4, minutes: 45 }] });
  const dated = assignDates(rows, slots);
  assert.deepEqual(dated.map((r) => r.date), ["2026-11-09", "2026-11-12", "2026-11-16"]);
  assert.equal(dated[2].minutes, 90);
});

test("Plan normalisieren und Einheitskontext für die Stunde", () => {
  const plan = normalizePlan({ titel: "Soziale Ungleichheit", planungsgrundlage: { name: "Problemstudie", begruendung: "weil", alternative: { name: "Fallanalyse", begruendung: "auch" } },
    lernaufgabe: "Positionspapier verfassen", ausgangslage: "Vorwissen gering", schritte: [{ titel: "Problem erschließen", beschreibung: "Karikatur analysieren" }, { titel: "Ursachen", beschreibung: "Statistik auswerten" }] });
  assert.equal(plan.planungsgrundlage.alternative.name, "Fallanalyse");
  const rows = normalizeRows([{ stundenfrage: "Ist Ungleichheit gerecht?", ablauf: ["Karikatur"], schritt: 0 }, { stundenfrage: "Woher kommt sie?", ablauf: ["Statistik"], schritt: 1, date: "2026-11-12", minutes: 45 }], uid);
  const t = unitContext({ title: "Ungleichheit", plan, rows }, rows[1].uid);
  assert.match(t, /Zentrale Lernaufgabe \(Ziel der Einheit\): Positionspapier verfassen/);
  assert.match(t, /2\. Ursachen – Statistik auswerten {3}← Lernschritt dieser Stunde/);
  assert.match(t, /Stunde 2 von 2 am Do, 12\.11\.2026 \(45 Minuten\)/);
  assert.match(t, /Vorige Stunde: Ist Ungleichheit gerecht\?/);
});

test("Änderungsvorschlag ```einheit``` aus einer Chat-Antwort", () => {
  const text = "Ich schlage vor …\n```einheit\n{\"stundenfrage\": \"Neu?\", \"ablauf\": [\"A\", \"B\"], \"begruendung\": \"passt besser\"}\n```\nFertig.";
  assert.deepEqual(extractUnitChange(text), { stundenfrage: "Neu?", ablauf: ["A", "B"], begruendung: "passt besser" });
  assert.equal(stripUnitBlock(text), "Ich schlage vor …\n\nFertig.");
  assert.equal(extractUnitChange("```einheit\nkein json\n```"), null);
  assert.equal(extractUnitChange("ohne Block"), null);
});

test("Prompt Einheitenplanung: Planungsgrundlage (PoWi), drei Lernaufgaben, Leupold, Tabelle mit allen Terminen", () => {
  const slots = computeSlots({ start: "2026-11-09", end: "2026-11-27", weekdays: [{ day: 1, minutes: 90 }] });
  const p = claudeUnitPrompt({ unitId: "0123456789abcdef", subject: "powi", klass: "Q2-LK", title: "Wirtschaftspolitik", params: { start: "2026-11-09", end: "2026-11-27", weekdays: [{ day: 1, minutes: 90 }] }, slots, rules: "Regel A", bases: ["KCGO PoWi"], missing: [] });
  for (const s of ["get_planning_basis", "0123456789abcdef", "Konfliktanalyse", "**priorisierten**", "**sekundären**", "**drei** zentrale Lernaufgaben", "Leupold-Schema", "genau 3 Zeilen", "Spalte 1: Stundenfrage", "save_unit_plan", "Q2 LK", "Leistungskurs", "Regel A"]) assert.ok(p.includes(s), s);
  const e = claudeUnitPrompt({ unitId: "0123456789abcdef", subject: "ethik", klass: "7A", params: {}, slots: [], rules: "", bases: [], missing: ["Schulcurriculum Ethik für Jahrgang 7"] });
  assert.ok(!e.includes("Konfliktanalyse") && e.includes("Es fehlen noch: Schulcurriculum Ethik für Jahrgang 7"));
});

test("Prompt Krankheitsvertretung: Analysefragen, 80 % der Zeit, Abgabe; Jahrgang 5/6 analog", () => {
  const ctx = { lessonId: "0123456789abcdef", subject: "powi", klass: "9B", lesson: { title: "Wahlen", durationMin: 90, date: "2026-11-12" }, unitText: "Unterrichtseinheit: Demokratie" };
  const p = claudeSubstitutePrompt(ctx);
  assert.equal(SUBSTITUTE_SHARE, 0.8);
  for (const s of ["Welche fachdidaktische Kompetenz", "Welche Stundenfrage", "Welche Lerninhalte", "ca. 72 Minuten", "get_lesson", "save_substitute_plan", "Feibeitsblatt", "„Foto“", "chronologische Anleitung", "Unterrichtseinheit: Demokratie"]) assert.ok(p.includes(s), s);
  assert.ok(p.includes("zurzeit noch nicht über die Plattform verfügbar"), "Escape-Room ehrlich als nicht verfügbar gekennzeichnet");
  const a = claudeSubstitutePrompt({ ...ctx, klass: "6A" });
  assert.ok(a.includes("keine iPads") && !a.includes("z. B. ein Escape-Room") && !a.includes("Antwortart „Foto“"));
});

test("Prompt „Stunde mit Claude planen“: feste Rolle, Sitzung, Einheit, Vorgehen mit dem Connector, Speichern nur auf Wunsch", () => {
  const unit = { id: "fedcba9876543210", title: "Gewaltenteilung", plan: { lernaufgabe: "Positionspapier schreiben", schritte: [{ titel: "Problem erschließen", beschreibung: "Karikatur" }] },
    rows: [{ uid: "r1", stundenfrage: "Wer kontrolliert die Macht?", ablauf: ["Karikatur"], schritt: 0, date: "2026-11-12", minutes: 90 }] };
  const base = { lessonId: "0123456789abcdef", subject: "powi", klass: "Q2-GK", unit, row: unit.rows[0], unitText: unitContext(unit, "r1"),
    lesson: { title: "Wer kontrolliert die Macht?", topic: "Gewaltenteilung", durationMin: 90, date: "2026-11-12", ideas: "Mit Karikatur einsteigen", homework: "" },
    materials: [{ name: "AB Gewaltenteilung", area: "student", kind: "text", text: "geheimer Langtext" }], sheets: [], portal: "**1) Einstieg**\n⏸ Zwischenstopp\n**2) Rest**",
    messages: [{ role: "assistant", content: "Hallo! …", model: "begruessung" }, { role: "user", content: "Bitte mit Rollenspiel" }, { role: "assistant", content: "Vorschlag: Rollenspiel …", model: "mock" }],
    previousStop: { title: "Vorige Stunde", date: "2026-11-10", portal: "**1) A**\n⏸ Zwischenstopp\n**2) Offen geblieben**" } };
  const p = claudeLessonPrompt(base);
  assert.ok(p.startsWith("Chat-Name: Q2 GK - PoWi - Sitzung 1 - Wer kontrolliert die Macht?\n\n" + SYSTEM_PROMPT_ROLE), "beginnt mit dem Chat-Namen, dann die feste Rolle (wörtlich)");
  assert.ok(p.includes("Beginne deine erste Antwort mit der Zeile „Chat-Name: Q2 GK - PoWi - Sitzung 1 - Wer kontrolliert die Macht?“"), "Claude nennt den Chat-Namen zuerst");
  for (const s of ["Sitzungs-ID: 0123456789abcdef", "`get_lesson` mit der Sitzungs-ID 0123456789abcdef", "`get_unit` mit der ID fedcba9876543210", "`get_planning_basis`", "Q2 GK", "Grundkurs",
    "Wer kontrolliert die Macht?", "laut Plattform 90 Minuten", "Mit Karikatur einsteigen", "AB Gewaltenteilung", "Zentrale Lernaufgabe (Ziel der Einheit): Positionspapier schreiben",
    UNIT_RULE_BASE, "`update_unit_row`", "`save_schulportal_entry`", "`base_version`", "`save_planning_result`", "`add_text_material`", "`propose_feibeitsblatt`", "`hausaufgabe`",
    "Speichere nur, was ich freigebe", "Feibeitsblatt", "„foto“", "Offen geblieben", "Bitte mit Rollenspiel", "Vorschlag: Rollenspiel", PORTAL_EXAMPLE, "Connector „Unterricks“ in diesem Chat nicht verfügbar"])
    assert.ok(p.includes(s), s);
  assert.ok(!p.includes("geheimer Langtext"), "Materialtexte liest Claude über get_lesson, nicht im Prompt");
  assert.ok(!p.includes("Hallo! …"), "Begrüßung des Chatbots gehört nicht dazu");
  assert.ok(!p.includes("```einheit"), "kein Übernahme-Block: mit dem Connector speichert Claude die Abweichung selbst");
  // Jahrgang 6: analog, ohne Feibeitsblatt, ohne Einheit
  const q = claudeLessonPrompt({ ...base, klass: "6B", unit: null, row: null, unitText: "", previousStop: null, messages: [], lesson: { ...base.lesson, durationMin: null } });
  assert.ok(q.includes(ANALOG_RULE) && !q.includes("`propose_feibeitsblatt`") && !q.includes("`update_unit_row`") && !q.includes("get_unit") && q.includes("in der Plattform noch nicht eingetragen"));
  assert.ok(!q.includes("Vorige Stunde") && !q.includes("Bisheriger Planungsverlauf"));
  assert.ok(q.startsWith("Chat-Name: Jg. 6 - PoWi - Wer kontrolliert die Macht?\n"), "ohne Einheit keine Sitzungsnummer");
});

test("Chat-Name: Jahrgang bzw. E-Phase/Q-Kurs, Fach kurz, Stunde in der Einheit, Titel der Sitzung", () => {
  const unit = { id: "u", rows: [{ uid: "a" }, { uid: "b" }, { uid: "c" }] };
  assert.equal(lessonChatName({ klass: "8B", subject: "powi", unit, row: { uid: "a" }, lesson: { title: "Das  Bundesverfassungsgericht " } }), "Jg. 8 - PoWi - Sitzung 1 - Das Bundesverfassungsgericht");
  assert.equal(lessonChatName({ klass: "10F", subject: "evrel", unit, row: { uid: "c" }, lesson: { title: "Bergpredigt" } }), "Jg. 10 - Ev. Religion - Sitzung 3 - Bergpredigt");
  assert.equal(lessonChatName({ klass: "7-K", subject: "ethik", unit, row: { uid: "b" }, lesson: { title: "Gerechtigkeit" } }), "Jg. 7 - Ethik - Sitzung 2 - Gerechtigkeit", "Kurs über mehrere Klassen: Jahrgang");
  assert.equal(lessonChatName({ klass: "EB", subject: "powi", lesson: { title: "Wahlen" } }), "E-Phase - PoWi - Wahlen");
  assert.equal(lessonChatName({ klass: "E-K", subject: "ethik", lesson: { title: "" } }), "E-Phase - Ethik");
  assert.equal(lessonChatName({ klass: "Q3-LK", subject: "powi", unit, row: { uid: "zz" }, lesson: { title: "Europa" } }), "Q3 LK - PoWi - Europa", "Zeile nicht in der Einheit: keine Nummer");
  assert.ok(lessonChatName({ klass: "8A", subject: "powi", lesson: { title: "x".repeat(300) } }).length <= 110, "langer Titel gekürzt");
});

test("Vertretungsvorschlag normalisieren", () => {
  const p = normalizeSubstitute({ analyse: { kompetenz: "Urteilen", stundenfrage: "Soll …?", inhalte: "A\nB" }, schritte: [{ titel: "Lesen", anleitung: "Lies M1", minuten: "10" }, { anleitung: "" }],
    materialien: [{ titel: "M1", bereich: "schueler", markdown: "# M1" }, { titel: "Lösung", bereich: "lehrkraft", markdown: "x" }, { titel: "leer", markdown: "" }], feibeitsblatt: { titel: "FB", aufgaben: [{ text: "A" }] } });
  assert.deepEqual(p.analyse.inhalte, ["A", "B"]);
  assert.equal(p.schritte.length, 2);
  assert.equal(p.schritte[0].minuten, 10);
  assert.equal(p.schritte[1].titel, "Schritt 2");
  assert.deepEqual(p.materialien.map((m) => m.bereich), ["student", "teacher"]);
  assert.match(p.hinweis, /nicht persönlich im Unterricht/);
  assert.equal(p.feibeitsblatt.titel, "FB");
});

/* ---------- Planungsgrundlagen ---------- */
const kcgoPages = [
  "Kerncurriculum gymnasiale Oberstufe\nInhalt\n2 Bildungsbeitrag ........ 5\n3 Kompetenzen ........ 9\n3.3 Kurshalbjahre ........ 12",
  "2 Bildungsbeitrag und didaktische Grundsätze\nText", "Weiter Grundlagen", "3 Kompetenzorientierung\nText", "3.2 Bildungsstandards\nText",
  "3.3 Kurshalbjahre und Themenfelder\nVerbindlich sind TF 1 und 2", "Übersicht\nE1 Gesellschaft\nE2 Wirtschaft\nQ1 Politik\nQ2 Wirtschaftspolitik",
  "E1 Gesellschaft und Wirtschaft\nTF 1", "E2 Wirtschaft im Wandel\nTF", "Q1 Politische Strukturen\nTF", "Q2 Wirtschaftspolitik\nTF", "noch Q2", "Q3 Internationale Beziehungen\nTF", "Q4 Zukunftsfragen\nTF",
];
test("KCGO: Grundlagen, Standards, Regeln und Kurshalbjahre erkennen (Inhaltsverzeichnis und Übersicht übersprungen)", () => {
  const s = detectKcgo(kcgoPages);
  assert.deepEqual(s.grundlagen, [2, 3]);
  assert.deepEqual(s.standards, [5]);
  assert.deepEqual(s.regeln, [6]);
  assert.deepEqual(s.E1, [8]); assert.deepEqual(s.Q2, [11, 12]); assert.deepEqual(s.Q4, [14]);
  const b = { kind: "kcgo", pages: kcgoPages.length, sections: s, scope: [] };
  assert.deepEqual(wantedSections(b, "Q2-GK").map((w) => w.n), [6, 11, 12, 2, 3, 5]);
  assert.deepEqual(wantedSections(b, "EC").map((w) => w.n), [6, 8, 9, 2, 3, 5]);
  assert.deepEqual(wantedSections(b, "9A"), []);
});

test("Abiturerlass: Fachteil finden, gilt nur für die zugeordneten Kurse", () => {
  const pages = ["Inhalt\nEthik\n4.1 Kursart\nPolitik und Wirtschaft\n5.1 Kursart\nPhysik\n6.1 Kursart", "Ethik\n4.1 Kursart Grundkurs", "Text Ethik", "Politik und Wirtschaft\n5.1 Kursart Grundkurs\nQ2.3 verbindlich", "PoWi weiter", "Physik\n6.1 Kursart", "Physik weiter"];
  const s = detectErlass(pages, "Politik und Wirtschaft");
  assert.deepEqual(s.fach, [4, 5, 6]);
  assert.deepEqual(detectErlass(pages, "Ethik").fach, [2, 3, 4]);
  assert.deepEqual(detectErlass(pages, "Evangelische Religion"), {});
  const b = { kind: "abiturerlass", pages: 7, sections: JSON.stringify(s), scope: JSON.stringify(["Q1-GK", "Q2-GK"]) };
  assert.deepEqual(wantedSections(b, "Q2-GK").map((w) => w.n), [4, 5, 6]);
  assert.deepEqual(wantedSections(b, "Q2-LK"), []);
  assert.deepEqual(missingFor([b], "powi", "Politik und Wirtschaft", "Q2-LK"), ["KCGO Politik und Wirtschaft", "Abiturerlass für den Kurs Q2 LK"]);
  assert.deepEqual(missingFor([b, { kind: "kcgo", pages: 1, sections: {}, scope: [] }], "powi", "Politik und Wirtschaft", "Q2-GK"), []);
});

test("Schulcurriculum und E-Phasen-Curriculum: Seiten je Jahrgang", () => {
  const s = detectCurriculum(["Übersicht Jahrgang 7 und Jahrgang 8", "(7_1) Unterrichtseinheit Familie", "weiter", "(8_1) Unterrichtseinheit Medien", "weiter 8", "(9_1) Wahlen"]);
  assert.deepEqual(s, { allgemein: [1], 7: [2, 3], 8: [4, 5], 9: [6] });
  const b = { kind: "schulcurriculum", pages: 6, sections: s, scope: [] };
  assert.deepEqual(wantedSections(b, "8C").map((w) => w.n + w.part), ["4" + "8", "5" + "8", "1allgemein"]);
  assert.deepEqual(wantedSections(b, "10A"), []);
  assert.deepEqual(missingFor([b], "ethik", "Ethik", "10A"), ["Schulcurriculum Ethik für Jahrgang 10"]);
  assert.deepEqual(detectCurriculum(["Klasse 6\nThema", "weiter"]), { 6: [1, 2] });
  assert.deepEqual(detectECurriculum(["Vorwort", "E1.1 Soziale Ungleichheit", "E2.1 Markt"]), { alle: [1], E1: [2], E2: [3] });
  assert.deepEqual(missingFor([], "powi", "Politik und Wirtschaft", "EB"), ["KCGO Politik und Wirtschaft", "schulinternes E-Phasen-Curriculum"]);
  assert.deepEqual(missingFor([], "ethik", "Ethik", "EB"), ["KCGO Ethik"]);
});

test("Seitenbereiche und Seitentext", () => {
  assert.deepEqual(parseRanges("12–14, 31; 2-1, x, 99", 40), [1, 2, 12, 13, 14, 31]);
  assert.equal(formatRanges([5, 1, 2, 3, 9]), "1–3, 5, 9");
  const items = [{ str: "Kapitel", transform: [0, 0, 0, 0, 0, 700] }, { str: " 3  ", transform: [0, 0, 0, 0, 0, 700] }, { str: "Text", transform: [0, 0, 0, 0, 0, 680] }, { str: "", transform: [0, 0, 0, 0, 0, 660] }];
  assert.equal(pageText(items), "Kapitel 3\nText");
});

import { weekSchedule, assignLanes, calendarWeek, weekRangeText, dayMonthText } from "../../public/planning.js";
import { mondayOf, isoWeek, berlinToday, clockMinutes, minutesClock } from "../../public/shared.js";
const unit = (id, subject, klass, params, title = "Einheit " + id) => ({ id, subject, klass, title, params });

test("Wochenkalender: Woche, KW, Heute an der Schule, Uhrzeiten", () => {
  assert.equal(mondayOf("2026-11-09"), "2026-11-09"); assert.equal(mondayOf("2026-11-15"), "2026-11-09"); assert.equal(mondayOf("2027-01-01"), "2026-12-28");
  assert.deepEqual(["2026-11-11", "2026-12-28", "2027-01-01", "2027-01-04", "2026-01-01"].map(isoWeek), [46, 53, 53, 1, 1]);
  assert.equal(berlinToday(Date.parse("2026-07-01T22:30:00Z")), "2026-07-02", "Sommerzeit: 00:30 Uhr in Berlin");
  assert.equal(berlinToday(Date.parse("2026-12-31T22:59:00Z")), "2026-12-31"); assert.equal(berlinToday(Date.parse("2026-12-31T23:01:00Z")), "2027-01-01");
  assert.equal(clockMinutes("07:45"), 465); assert.equal(clockMinutes("7:45"), null); assert.equal(minutesClock(555), "09:15");
  assert.equal(calendarWeek("2026-11-11"), "2026-11-09"); assert.equal(calendarWeek("2026-11-14"), "2026-11-16", "Samstag: die kommende Woche"); assert.equal(calendarWeek("2026-11-15"), "2026-11-16");
  assert.equal(weekRangeText("2026-11-09"), "9.–13. November 2026"); assert.equal(weekRangeText("2026-11-30"), "30. November – 4. Dezember 2026");
  assert.equal(weekRangeText("2026-12-28"), "28. Dezember 2026 – 1. Januar 2027"); assert.equal(dayMonthText("2026-03-02"), "2. März");
});

test("Wochenkalender: Zeitraum der Einheit (einschließlich), Wochentage, Uhrzeit oder „ohne Uhrzeit“, Klausur, Ausfall", () => {
  const u = [unit("a", "powi", "Q2-GK", { start: "2026-11-11", end: "2026-11-27", exam: "2026-11-12", weekdays: [{ day: 1, minutes: 90, time: "07:45" }, { day: 3, minutes: 90, time: "09:35" }, { day: 4, minutes: 45 }],
    breaks: [{ from: "2026-11-18", to: "2026-11-18", label: "Studientag" }] }, "Gewaltenteilung")];
  let w = weekSchedule(u, "2026-11-09");
  assert.deepEqual(w.days.map((d) => d.date), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
  assert.deepEqual(w.days[0].timed, [], "vor dem Beginn (Mi) kein Montag");
  const mi = w.days[2].timed[0];
  assert.deepEqual([mi.time, mi.endTime, mi.start, mi.end, mi.label, mi.subjectShort, mi.href, mi.kind, mi.title], ["09:35", "11:05", 575, 665, "Q2 GK", "PoWi", "#/lk/f/powi/Q2-GK", "stunde", "Gewaltenteilung"]);
  assert.deepEqual(w.days[3].untimed.map((e) => [e.minutes, e.kind]), [[45, "klausur"]], "Do ohne Uhrzeit, Klausurtag markiert");
  w = weekSchedule(u, "2026-11-16");
  assert.deepEqual([w.days[0].timed.length, w.days[2].timed.length, w.days[2].off], [1, 0, [{ subject: "powi", subjectShort: "PoWi", klass: "Q2-GK", label: "Q2 GK", reason: "Studientag" }]]);
  w = weekSchedule(u, "2026-11-23");
  assert.equal(w.days[0].timed.length + w.days[2].timed.length + w.days[3].untimed.length, 3, "letzte Woche: Ende (Fr 27.11.) einschließlich");
  assert.equal(weekSchedule(u, "2026-11-30").days.flatMap((d) => [...d.timed, ...d.untimed]).length, 0, "nach dem Ende nichts");
  // ohne Zeitraum oder ohne Stundenplan, ungültige Fächer/Klassen: nichts
  for (const p of [{ weekdays: [{ day: 1, minutes: 45 }] }, { start: "2026-11-01", weekdays: [{ day: 1, minutes: 45 }] }, { start: "2026-11-01", end: "2026-12-01", weekdays: [] }, { start: "2026-12-01", end: "2026-11-01", weekdays: [{ day: 1, minutes: 45 }] }])
    assert.equal(weekSchedule([unit("x", "powi", "8C", p)], "2026-11-09").days.flatMap((d) => [...d.timed, ...d.untimed]).length, 0, JSON.stringify(p));
  assert.equal(weekSchedule([unit("x", "mathe", "8C", u[0].params), unit("y", "powi", "8Z", u[0].params), null, {}], "2026-11-16").days.flatMap((d) => [...d.timed, ...d.untimed]).length, 0);
  // sehr lange Einheit: auch spät im Zeitraum (computeSlots rechnet höchstens 400 Tage)
  assert.equal(weekSchedule([unit("l", "ethik", "E-K", { start: "2025-01-06", end: "2027-07-01", weekdays: [{ day: 5, minutes: 45, time: "11:40" }] })], "2027-06-21").days[4].timed[0].label, "Kurs E-Phase");
});

test("Wochenkalender: überlappende Einheiten derselben Klasse einmal, Sortierung, Ausfall nur wenn wirklich nichts stattfindet", () => {
  const base = { start: "2026-11-02", end: "2026-11-30", weekdays: [{ day: 1, minutes: 45, time: "07:45" }] };
  const w = weekSchedule([unit("a", "powi", "Q2-GK", { ...base, breaks: [{ from: "2026-11-09", to: "2026-11-09", label: "Ausfall" }] }), unit("b", "powi", "Q2-GK", { ...base, weekdays: [{ day: 1, minutes: 90, time: "07:45" }] }),
    unit("c", "ethik", "7-K", { ...base, weekdays: [{ day: 1, minutes: 45, time: "07:45" }, { day: 1, minutes: 45, time: "07:45" }] }), unit("d", "evrel", "9B", { ...base, weekdays: [{ day: 1, minutes: 45, time: "07:00" }] })], "2026-11-09");
  const mo = w.days[0];
  assert.deepEqual(mo.timed.map((e) => [e.time, e.subjectShort, e.label, e.unitIds.join(",")]), [["07:00", "Ev. Religion", "9B", "d"], ["07:45", "Ethik", "Kurs Jg. 7", "c"], ["07:45", "Ethik", "Kurs Jg. 7", "c"], ["07:45", "PoWi", "Q2 GK", "b"]],
    "zweimal dieselbe Zeit in einer Einheit bleibt zweimal (so zählt sie auch die Einheit) – überlappende Einheiten derselben Klasse einmal");
  assert.deepEqual(mo.off, [], "Q2 GK findet über die zweite Einheit statt – kein „Entfällt“");
  const w2 = weekSchedule([unit("a", "powi", "Q2-GK", base), unit("b", "powi", "Q2-GK", { ...base, weekdays: [{ day: 1, minutes: 90, time: "07:45" }] })], "2026-11-09");
  assert.deepEqual(w2.days[0].timed.map((e) => [e.unitIds.join(","), e.minutes, e.endTime]), [["a,b", 90, "09:15"]], "gleiche Klasse, gleiche Zeit: ein Eintrag mit der längeren Dauer");
});

test("Wochenkalender: Überschneidungen in Spuren nebeneinander (mit Mindesthöhe)", () => {
  const e = (start, end) => ({ start, end });
  const a = assignLanes([e(465, 555), e(510, 555), e(560, 605), e(600, 645)], 40);
  assert.deepEqual(a.map((x) => [x.lane, x.lanes]), [[0, 2], [1, 2], [0, 2], [1, 2]], "kurz hintereinander: Mindesthöhe überlappt → zweite Spur");
  assert.deepEqual(assignLanes([e(465, 510), e(515, 560)], 40).map((x) => [x.lane, x.lanes]), [[0, 1], [0, 1]]);
  assert.deepEqual(assignLanes([e(480, 600), e(480, 525), e(490, 535), e(540, 585)], 0).map((x) => [x.lane, x.lanes]), [[0, 3], [1, 3], [2, 3], [1, 3]]);
  assert.deepEqual(assignLanes([]), []);
});

test("Wochenkalender: zwei Stunden derselben Einheit am selben Tag ohne Uhrzeit bleiben zwei Einträge (wie in der Einheit gezählt)", () => {
  const p = { start: "2026-11-02", end: "2026-11-30", weekdays: [{ day: 2, minutes: 45 }, { day: 2, minutes: 90 }, { day: 4, minutes: 45, time: "08:00" }, { day: 4, minutes: 45 }] };
  const w = weekSchedule([unit("a", "powi", "8C", p)], "2026-11-09");
  assert.deepEqual(w.days[1].untimed.map((e) => e.minutes), [45, 90]);
  assert.deepEqual([w.days[3].timed.length, w.days[3].untimed.length], [1, 1]);
  assert.equal(w.days.reduce((n, d) => n + d.timed.length + d.untimed.length, 0), computeSlots({ ...p, start: "2026-11-09", end: "2026-11-13" }).length);
  // dieselbe Einheit zweimal (z. B. eine Kopie): die k-te Stunde fällt mit der k-ten zusammen
  const w2 = weekSchedule([unit("a", "powi", "8C", p), unit("b", "powi", "8C", p)], "2026-11-09");
  assert.deepEqual(w2.days[1].untimed.map((e) => [e.minutes, e.unitIds.join(",")]), [[45, "a,b"], [90, "a,b"]]);
});

/* ---------- Kurseinstellungen: Schülerzahl in den Prompts (nur wenn eingetragen) ---------- */
import { normalizeCourseSettings } from "../../public/planning.js";
test("Prompts: Schülerzahl laut Kurseinstellungen nur mit Angabe – sonst wörtlich wie bisher", () => {
  const unit = { unitId: "0123456789abcdef", subject: "ethik", klass: "7-K", title: "Gerechtigkeit", params: {}, slots: [], rules: "", bases: [], missing: [] };
  const u0 = claudeUnitPrompt(unit), u1 = claudeUnitPrompt({ ...unit, classSize: 24 });
  assert.ok(!u0.includes("Schülerzahl"));
  assert.equal(u1, u0.replace(/(\n- Klasse\/Kurs: [^\n]*\n)/, "$1- Schülerzahl: 24 (laut Kurseinstellungen)\n"));
  assert.equal(claudeUnitPrompt({ ...unit, classSize: null }), u0);
  const lesson = { lessonId: "0123456789abcdef", subject: "ethik", klass: "7-K", lesson: { title: "Was ist gerecht?", durationMin: 45 }, materials: [], sheets: [], portal: "", unitText: "", messages: [] };
  const l0 = claudeLessonPrompt(lesson), l1 = claudeLessonPrompt({ ...lesson, classSize: 24 });
  assert.ok(l0.includes("`anzahl` (frag mich nach der Klassengröße, wenn du sie nicht kennst)") && !l0.includes("Schülerzahl"));
  assert.equal(l1, l0.replace("`anzahl` (frag mich nach der Klassengröße, wenn du sie nicht kennst)", "`anzahl` (laut Kurseinstellungen 24 Schüler:innen)")
    .replace(/(\nKlasse\/Kurs: [^\n]*\n)/, "$1Schülerzahl laut Kurseinstellungen: 24\n"));
});
test("normalizeCourseSettings: Stundenplan wie die Rahmendaten, Schülerzahl 1–60, Grundschule mit Uhrzeit", () => {
  assert.deepEqual(normalizeCourseSettings({}), { weekdays: [], classSize: null });
  assert.deepEqual(normalizeCourseSettings({ weekdays: [{ day: 1, minutes: 45, time: "08:00" }, { day: 6, minutes: 45 }, { day: 3, minutes: 10 }], classSize: "24" }),
    { weekdays: [{ day: 1, minutes: 45, time: "08:00" }], classSize: 24 });
  for (const v of [0, 61, 1.5, "abc", true, [3]]) assert.throws(() => normalizeCourseSettings({ classSize: v }), /^Error: Die Schülerzahl muss zwischen 1 und 60 liegen\.$/);
  assert.equal(normalizeCourseSettings({ classSize: "" }).classSize, null);
  assert.throws(() => normalizeCourseSettings({ weekdays: [{ day: 2, minutes: 45 }] }, { requireTime: true }), /Bitte bei jedem Termin die Uhrzeit eintragen/);
  assert.deepEqual(normalizeCourseSettings({ weekdays: [{ day: 2, minutes: 45, time: "08:00" }] }, { requireTime: true }).weekdays, [{ day: 2, minutes: 45, time: "08:00" }]);
});

test("Schulcurriculum Grundschule (Ev. Religion Jg. 1–4): Jahrgänge erkennen, Seiten je Jahrgang, nie für das Gymnasium", () => {
  const pages = ["Schulcurriculum Ev. Religion\nGrundschule", "Jahrgangsstufe 1/2\nGott begleitet uns", "weiter", "Jahrgangsstufe 3/4\nJesus erzählt", "Klasse 3\nSchöpfung",
    "Übersicht Jahrgang 1, Jahrgang 2 und Jahrgang 3", "Klasse 12 – kein Jahrgang der Grundschule", "(2_1) Einheit Freundschaft", "Jg. 4 und 1"];
  const s = detectGsCurriculum(pages);
  assert.deepEqual(s, { allgemein: [1, 6, 7], 1: [2, 3, 9], 2: [2, 3, 8], 3: [4, 5], 4: [4, 9] });
  assert.deepEqual(detectSections("gs-curriculum", "Evangelische Religion", pages), s);
  assert.deepEqual(detectGsCurriculum(["Klasse 3\nThema", "weiter"]), { 3: [1, 2] });
  assert.equal(BASE_KINDS["gs-curriculum"].label, "Schulcurriculum Grundschule (Jahrgänge 1–4)");
  const b = { kind: "gs-curriculum", pages: 9, sections: s, scope: [] };
  assert.deepEqual(wantedGsSections(b, "3").map((w) => w.n + w.part), ["43", "53", "1allgemein", "6allgemein", "7allgemein"]);
  assert.deepEqual(wantedGsSections({ ...b, scope: ["1", "2"] }, "3"), [], "Geltungsbereich");
  assert.deepEqual(wantedGsSections({ ...b, sections: { 1: [2] } }, "4"), [], "andere Jahrgänge erkannt, dieser nicht");
  assert.deepEqual(wantedGsSections({ ...b, pages: 2, sections: {} }, 4).map((w) => w.n), [1, 2], "ohne Abschnitte: alles");
  for (const k of ["5A", "8C", "EA", "Q2-GK", "7-K"]) assert.deepEqual(wantedSections(b, k), []);
  // fehlt: nur für Religionskurse, nur das Curriculum von Ev. Religion zählt
  assert.deepEqual(missingForGs([b], { religion: true, grade: 3 }), []);
  assert.deepEqual(missingForGs([{ ...b, scope: ["1"] }], { religion: true, grade: 2 }), ["Schulcurriculum Ev. Religion (Grundschule) für Jahrgang 2"]);
  assert.deepEqual(missingForGs([{ ...b, subject: "gs1a2b3c4d" }], { religion: true, grade: 3 }), ["Schulcurriculum Ev. Religion (Grundschule) für Jahrgang 3"]);
  assert.deepEqual(missingForGs([], { religion: false, grade: 3 }), []);
  // „fehlt“ in der Status-Tabelle nur bei einem Religionskurs dieses Jahrgangs im laufenden Schuljahr (frühere Schuljahre zählen nicht)
  const ks = [{ religion: true, grade: 2, schoolYear: "2025/26" }, { religion: false, grade: 3, schoolYear: "2026/27" }, { religion: true, grade: 4, schoolYear: null }];
  assert.equal(gsReligionCourseIn(ks, "2", "2026/27"), false, "Kurs aus dem Vorjahr");
  assert.equal(gsReligionCourseIn(ks, "2", "2025/26"), true);
  assert.equal(gsReligionCourseIn(ks, "3", "2026/27"), false, "kein Religionskurs");
  assert.equal(gsReligionCourseIn(ks, 4, "2026/27"), true, "ohne Schuljahr zählt er als laufend");
  assert.equal(gsReligionCourseIn(null, "1", "2026/27"), false);
  // das Gymnasium bleibt, wie es war: ein Grundschul-Curriculum ersetzt kein Schulcurriculum der Sek I
  assert.deepEqual(missingFor([b], "evrel", "Evangelische Religion", "5A"), ["Schulcurriculum Evangelische Religion für Jahrgang 5"]);
});

/* ---------- Grundschule: Wochenkalender beider Schulformen, Prompt der Einheit ---------- */
import { claudeGsUnitPrompt, GS_RULE } from "../../public/gsplanning.js";
import { paramsText } from "../../public/planning.js";
test("Wochenkalender: Grundschul-Einheiten mit Kurs (Kennzeichnung „Grundschule“, Klick öffnet den Kurs); ohne Kurs nichts; Gymnasium unverändert", () => {
  const P = { start: "2026-11-02", end: "2026-11-30", weekdays: [{ day: 2, minutes: 45, time: "08:00" }], breaks: [{ from: "2026-11-17", to: "2026-11-17", label: "Studientag" }] };
  const gs = { ...unit("g", "gs", "gs1a2b3c4d", P, "Josef"), course: { id: "gs1a2b3c4d", short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)" } };
  const sek = unit("s", "powi", "8C", P, "Wahlen");
  const before = weekSchedule([sek], "2026-11-09");
  const w = weekSchedule([gs, sek, unit("x", "gs", "gs1a2b3c4d", P), { ...unit("y", "gs", "4A", P), course: { short: "x" } }], "2026-11-09");
  const di = w.days[1].timed;
  assert.equal(di.length, 2);
  const g = di.find((e) => e.subject === "gs");
  assert.deepEqual([g.subjectShort, g.label, g.href, g.gs, g.title, g.time, g.endTime], ["Grundschule", "Religion 2ab", "#/lk/grundschule/k/gs1a2b3c4d", true, "Josef", "08:00", "08:45"]);
  assert.deepEqual(di.find((e) => e.subject === "powi"), before.days[1].timed[0], "Eintrag des Gymnasiums unverändert");
  assert.equal(before.days[1].timed[0].gs, undefined);
  assert.deepEqual(weekSchedule([gs], "2026-11-16").days[1].off, [{ subject: "gs", subjectShort: "Grundschule", klass: "gs1a2b3c4d", label: "Religion 2ab", reason: "Studientag" }]);
});
test("Prompt „Einheit mit Claude planen“ (Grundschule): Hessen, Kurs, Schülerzahl, keine Klausur, kein Gymnasium; paramsText ohne Klausur", () => {
  const P = { start: "2026-11-09", end: "2026-11-13", exam: "2026-11-12", weekdays: [{ day: 2, minutes: 45, time: "08:00" }, { day: 4, minutes: 45, time: "09:50" }] };
  const course = { id: "gs1a2b3c4d", subjectName: "Religion", description: "Wir lernen Geschichten aus der Bibel kennen.", gradeText: "Jahrgangsstufe 2 der Grundschule, Kurs mit Kindern aus den Klassen 2a und 2b" };
  const p = claudeGsUnitPrompt({ unitId: "0123456789abcdef", course, title: "Josef", params: P, slots: computeSlots({ ...P, exam: null }), bases: ["Schulcurriculum evRel GS"], missing: [], classSize: 22 });
  for (const x of ["für Religion an einer Grundschule in Hessen", "- Lerngruppe: Jahrgangsstufe 2 der Grundschule, Kurs mit Kindern aus den Klassen 2a und 2b", "- Schülerzahl: 22 Kinder (laut Kurseinstellungen)",
    "- Ziel des Unterrichts in diesem Kurs (Beschreibung der Lehrkraft): Wir lernen Geschichten aus der Bibel kennen.", "get_planning_basis", "**drei** zentrale Lernaufgaben", "genau 2 Zeilen", "save_unit_plan",
    "- " + GS_RULE, "Leupold-Schema", "1. Di, 10.11.2026 08:00 (45 min)"]) assert.ok(p.includes(x), x);
  for (const x of ["Klausur", "Gymnasium", "Feibeitsblatt-", "Schulportal", "PoWi"]) assert.ok(!p.includes(x), x);
  assert.ok(!claudeGsUnitPrompt({ unitId: "0123456789abcdef", course: { ...course, description: "" }, params: P, slots: [] }).includes("Schülerzahl"));
  assert.ok(!paramsText(P, { exam: false }).includes("Klausur"));
  assert.equal(paramsText(P), paramsText(P, { exam: true }), "Vorgabe wie bisher");
  assert.ok(paramsText(P).includes("Klausurtermin: "));
});
