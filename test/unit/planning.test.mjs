import test from "node:test";
import assert from "node:assert/strict";
import { normalizeParams, computeSlots, lessonSlots, normalizePlan, normalizeRows, assignDates, extractUnitChange, stripUnitBlock, unitContext,
  claudeUnitPrompt, claudeSubstitutePrompt, claudeLessonPrompt, lessonChatName, normalizeSubstitute, SUBSTITUTE_SHARE } from "../../public/planning.js";
import { SYSTEM_PROMPT_ROLE, UNIT_RULE_BASE, ANALOG_RULE, PORTAL_EXAMPLE } from "../../public/shared.js";
import { detectKcgo, detectErlass, detectCurriculum, detectECurriculum, parseRanges, formatRanges, pageText, wantedSections, missingFor } from "../../public/bases-detect.js";

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
  assert.deepEqual(p.weekdays, [{ day: 3, minutes: 60 }]);
  assert.equal(p.start, null);
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
