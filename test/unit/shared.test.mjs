import test from "node:test";
import assert from "node:assert/strict";
import {
  SUBJECTS, ALL_CLASSES, isValidClass, gradeInfo, normalizeCode, isValidCode, formatCode, renderPortalEntry, parsePortalMarkup, portalSafe,
  validatePortalData, PORTAL_EXAMPLE, claudeIdeaPrompt, claudePresentationPrompt, planningSystemPrompt, SYSTEM_PROMPT_ROLE, extractJsonObject, normalizeFbDraft,
} from "../../public/shared.js";

test("genau drei Fächer", () => {
  assert.deepEqual(SUBJECTS.map((s) => s.name), ["Politik und Wirtschaft", "Evangelische Religion", "Ethik"]);
});

test("Klassen: 5A–10F, EA–EF, Q1–Q4 und sonst nichts", () => {
  assert.equal(ALL_CLASSES.length, 6 * 6 + 6 + 4);
  for (const k of ["5A", "5F", "7B", "10C", "10F", "EA", "EF", "Q1", "Q4"]) assert.ok(isValidClass(k), k);
  for (const k of ["4A", "11A", "10G", "E1", "EG", "Q5", "Q", "12A", "5a"]) assert.ok(!isValidClass(k), k);
  assert.equal(gradeInfo("7B").stufe, 7);
  assert.equal(gradeInfo("EC").stufe, 11);
  assert.match(gradeInfo("Q2").text, /Jahrgangsstufe 12, 2\. Halbjahr/);
  assert.match(gradeInfo("Q3").text, /Jahrgangsstufe 13, 1\. Halbjahr/);
});

test("Sitzungscodes", () => {
  assert.equal(normalizeCode(" k7q-m4x "), "K7QM4X");
  assert.ok(isValidCode("K7QM4X"));
  assert.ok(!isValidCode("KKKKKK"));   // keine Ziffer
  assert.ok(!isValidCode("K7QM4O"));   // O ist nicht im Alphabet
  assert.equal(formatCode("K7QM4X"), "K7Q-M4X");
});

test("Schulportal: Struktur wie in der Vorlage der Lehrkraft", () => {
  const text = renderPortalEntry({
    phasen: [
      { titel: "TOP 10", punkte: [] },
      { titel: "Blitzlicht ohne iPad", punkte: ["Einstieg: «Wie kann man sich helfen, wenn Demokratiefeinde regieren?»"] },
      { titel: "Partnerarbeit", punkte: ["Feibeitsblatt «Die wehrhafte Demokratie» mit dem Code «AEH-4VY»", "Aufgabe 4 besprechen"] },
      { titel: "Video: Das Bundesverfassungsgericht", punkte: ["«AB - Das Bundesverfassungsgericht»", "Video: https://www.youtube.com/watch?v=Fk1u8VKrJGA&feature=youtu.be"] },
      { titel: "Diskussionsrunde", punkte: ["Erst in Partnerarbeit Argumente zur Diskussionsfrage finden: «Ist das Bundesverfassungsgericht zu mächtig?» und auf der Argumentationswippe festhalten: https://argumentationswippe.de/", "Während der Diskussion muss das weiter gefüllt werden."] },
    ],
    naechsteStundeAb: 5,
  });
  assert.equal(text, PORTAL_EXAMPLE);
});

test("Schulportal: KI-Text kann keine ungewollte Formatierung erzeugen", () => {
  assert.equal(portalSafe("Pro--Contra **wichtig** ~~x~~ __u__ `c`"), "Pro–Contra *wichtig* ~x~ _u_ 'c'");
  const t = renderPortalEntry({ phasen: [{ titel: "**Fett**", punkte: ["a --b-- c"] }] });
  assert.equal(t, "**1) *Fett***\n- a –b– c");
});

test("Schulportal: Vorschau-Parser (~~ = kursiv, -- = durchgestrichen, --> bleibt Text)", () => {
  const lines = parsePortalMarkup(PORTAL_EXAMPLE);
  assert.equal(lines[0].type, "p");
  assert.deepEqual(lines[0].runs, [{ text: "1) TOP 10", b: true, u: false, i: false, s: false }]);
  const einstieg = lines[3];
  assert.equal(einstieg.type, "li");
  assert.ok(einstieg.runs.some((r) => r.i && r.text.startsWith("Wie kann")));
  const next = lines.find((l) => l.runs.some((r) => r.text.includes("Nächste Stunde")));
  assert.equal(next.runs.map((r) => r.text).join(""), "--> Nächste Stunde");
  assert.ok(next.runs.every((r) => !r.s));
  const link = lines.flatMap((l) => l.runs).find((r) => r.href);
  assert.match(link.href, /^https:\/\/www\.youtube\.com/);
  const strike = parsePortalMarkup("a --weg-- b")[0].runs;
  assert.ok(strike.some((r) => r.s && r.text === "weg"));
});

test("Schulportal: JSON der KI prüfen", () => {
  assert.throws(() => validatePortalData({}), /keinen verwertbaren/);
  const d = validatePortalData({ phasen: [{ title: "A", items: ["x"] }, { titel: "B", punkte: [] }], naechsteStundeAb: 2 });
  assert.deepEqual(d, { phasen: [{ titel: "A", punkte: ["x"] }, { titel: "B", punkte: [] }], naechsteStundeAb: 2 });
  assert.equal(validatePortalData({ phasen: [{ titel: "A" }], naechsteStundeAb: 1 }).naechsteStundeAb, null);
  assert.deepEqual(extractJsonObject("Hier:\n```json\n{\"a\": {\"b\": \"}\"}}\n```"), { a: { b: "}" } });
});

const ctx = {
  lessonId: "0123456789abcdef", subject: "powi", klass: "Q2",
  lesson: { title: "BVerfG", topic: "Das Bundesverfassungsgericht", durationMin: 90, date: "2026-11-12", ideas: "Mit Karikatur einsteigen" },
  materials: [{ name: "AB BVerfG", area: "student", kind: "text", text: "# AB\nText" }, { name: "Erwartungshorizont.docx", area: "teacher", kind: "file" }],
  sheets: [{ title: "Die wehrhafte Demokratie", code: "AEH4VY" }], portal: "**1) Einstieg**",
};
const messages = [{ role: "user", content: "Bitte mit Rollenspiel" }, { role: "assistant", content: "Vorschlag: Rollenspiel …" }];

test("Chatbot-System-Prompt: feste Rolle wörtlich + Fach, Klasse, Sitzung", () => {
  const p = planningSystemPrompt(ctx);
  assert.ok(p.startsWith(SYSTEM_PROMPT_ROLE));
  assert.match(p, /Unterrichtsfach: Politik und Wirtschaft/);
  assert.match(p, /Klasse\/Kurs: Q2 – Qualifikationsphase/);
  assert.match(p, /Unterrichtssitzung: BVerfG/);
  assert.match(p, /Feibeitsblatt/);
});

test("Claude-Prompt Unterrichtsidee enthält alle geforderten Angaben", () => {
  const p = claudeIdeaPrompt(ctx, messages);
  for (const s of ["Q2", "Politik und Wirtschaft", "Das Bundesverfassungsgericht", "90 Minuten", "Mit Karikatur einsteigen", "Bitte mit Rollenspiel", "Vorschlag: Rollenspiel", "AB BVerfG", "AEH-4VY", "get_lesson"]) assert.ok(p.includes(s), s);
});

test("Präsentations-Prompt basiert auf genau dem übergebenen Schulportal-Eintrag", () => {
  const edited = "**1) Einstieg – manuell geändert**\n- Karikatur";
  const p = claudePresentationPrompt(ctx, edited, messages);
  assert.ok(p.includes(edited));
  assert.ok(!p.includes("**1) Einstieg**\n"), "ältere Fassung aus ctx.portal darf nicht vorkommen");
  for (const s of ["PowerPoint", ".pptx", "PDF", "Q2", "Politik und Wirtschaft", "90 Minuten", "AB BVerfG", "Erwartungshorizont.docx"]) assert.ok(p.includes(s), s);
});

test("Feibeitsblatt-Entwurf normalisieren", () => {
  const d = normalizeFbDraft({ titel: "T", aufgaben: [{ text: "A1", ki_auftrag: "K1" }, { text: "A2", ki_auftrag: "K2", antwort: { tabelle: ["Pro", "Contra"], zeilen: 4 } }, { text: "" }] });
  assert.equal(d.title, "T");
  assert.equal(d.tasks.length, 2);
  assert.deepEqual(d.tasks[1].answer, { type: "table", columns: ["Pro", "Contra"], rows: 4 });
  assert.equal(d.tasks[0].solution, "K1");
  assert.throws(() => normalizeFbDraft({ tasks: [] }), /keine Aufgabe/);
});

import { insertStop, removeStops, portalForCopy, hasStop, STOP_LINE, addDays, daysBetween, fmtDay, isIsoDate, isWeekend, lessonContext } from "../../public/shared.js";

test("Zwischenstopp: vor der angeklickten Zeile, höchstens einer, beim Kopieren entfernt", () => {
  const t = "**1) Einstieg**\n- A\n\n**2) Partnerarbeit**\n- B";
  const r = insertStop(t, 3);
  assert.equal(r.text, "**1) Einstieg**\n- A\n\n" + STOP_LINE + "\n**2) Partnerarbeit**\n- B");
  assert.equal(r.line, 3);
  assert.ok(hasStop(r.text));
  const moved = insertStop(r.text, 1);   // neuer Stopp verschiebt den alten
  assert.equal(moved.text, "**1) Einstieg**\n" + STOP_LINE + "\n- A\n\n**2) Partnerarbeit**\n- B");
  assert.equal(moved.text.split(STOP_LINE).length, 2);
  assert.equal(portalForCopy(r.text), t);
  assert.equal(removeStops("a\n\n" + STOP_LINE + "\n\nb"), "a\n\nb");
  const lines = parsePortalMarkup(r.text);
  assert.equal(lines[3].type, "stop");
  assert.equal(insertStop(t, 99).text, t + "\n" + STOP_LINE);
});

test("Präsentations-Prompt ohne Zwischenstopp, mit Hausaufgabe", () => {
  const p = claudePresentationPrompt({ ...ctx, lesson: { ...ctx.lesson, homework: "Lies M2." } }, "**1) A**\n" + STOP_LINE + "\n**2) B**", []);
  assert.ok(!p.includes("Zwischenstopp"));
  assert.ok(p.includes("**1) A**\n**2) B**"));
  assert.ok(p.includes("Lies M2."));
  assert.match(lessonContext({ ...ctx, lesson: { ...ctx.lesson, homework: "Lies M2." }, portal: "x\n" + STOP_LINE }), /Hausaufgabe aus dieser Sitzung.*Lies M2\.[\s\S]*markiert, bis wohin/);
});

test("Datumshilfen", () => {
  assert.equal(addDays("2026-11-12", 3), "2026-11-15");
  assert.equal(addDays("2026-03-28", 2), "2026-03-30");   // Zeitumstellung egal
  assert.equal(daysBetween("2026-11-12", "2026-11-10"), -2);
  assert.equal(fmtDay("2026-11-12"), "Do, 12.11.2026");
  assert.ok(isIsoDate("2026-02-28") && !isIsoDate("2026-02-30") && !isIsoDate("12.11.2026"));
  assert.ok(isWeekend("2026-11-15") && !isWeekend("2026-11-16"));
});
