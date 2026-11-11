import test from "node:test";
import assert from "node:assert/strict";
import {
  SUBJECTS, ALL_CLASSES, isValidClass, gradeInfo, classShort, gradeKey, subjectConfig, classAllowed, classGroupsFor, isAnalogClass, ANALOG_RULE,
  COURSE_CLASSES, isCourseClass, courseMembers, courseOf, classLabel, homeworkForPortal, PUBLIC_URL, groupShort, fmtLongDay, normalizeCode, isValidCode, formatCode, renderPortalEntry, parsePortalMarkup, portalSafe,
  validatePortalData, PORTAL_EXAMPLE, claudePresentationPrompt, CODE_SLIDE_LINE, CODE_SLIDE_MARK, planningSystemPrompt, SYSTEM_PROMPT_ROLE, extractJsonObject, normalizeFbDraft,
} from "../../public/shared.js";

test("genau drei Fächer", () => {
  assert.deepEqual(SUBJECTS.map((s) => s.name), ["Politik und Wirtschaft", "Evangelische Religion", "Ethik"]);
});

test("Klassen: 5A–10H, EA–EH (acht je Jahrgang), Q1–Q4 je als Grund- und Leistungskurs, Kurse 5-K–10-K und E-K – und sonst nichts", () => {
  assert.equal(ALL_CLASSES.length, 6 * 8 + 8 + 8 + 7);
  assert.deepEqual(COURSE_CLASSES, ["5-K", "6-K", "7-K", "8-K", "9-K", "10-K", "E-K"]);
  for (const k of ["5A", "5F", "5H", "7B", "7G", "10C", "10F", "10H", "EA", "EF", "EG", "EH", "Q1-GK", "Q1-LK", "Q4-GK", "Q4-LK"]) assert.ok(isValidClass(k), k);
  for (const k of ["4A", "11A", "10I", "5I", "E1", "EI", "Q1", "Q4", "Q5-GK", "Q2-XK", "Q", "12A", "5a", "Q-K", "4-K", "11-K", "8-k", "8K"]) assert.ok(!isValidClass(k), k);
  assert.equal(gradeInfo("7B").stufe, 7);
  assert.equal(gradeInfo("EC").stufe, 11);
  assert.match(gradeInfo("Q2-GK").text, /Jahrgangsstufe 12, 2\. Halbjahr\), Grundkurs \(grundlegendes Niveau\)/);
  assert.match(gradeInfo("Q3-LK").text, /Jahrgangsstufe 13, 1\. Halbjahr\), Leistungskurs \(erhöhtes Niveau\)/);
  assert.equal(gradeInfo("Q3-LK").halfYear, "Q3");
  assert.equal(classShort("Q3-LK"), "Q3 LK");
  assert.equal(gradeKey("10C"), "10"); assert.equal(gradeKey("EB"), "E"); assert.equal(gradeKey("Q1-GK"), "Q");
});

test("Fach-Einstellungen: PoWi nur in 6, 8, 9, 10, E, Q; Jahrgang 5/6 analog", () => {
  const powi = subjectConfig({}, "powi");
  assert.deepEqual(powi.grades, ["6", "8", "9", "10", "E", "Q"]);
  assert.ok(!classAllowed(powi, "7A") && !classAllowed(powi, "5B") && classAllowed(powi, "6C") && classAllowed(powi, "Q2-LK"));
  assert.match(powi.gradeNotes["10"], /nur im ersten Schulhalbjahr/);
  assert.match(powi.rules, /Jahrgangs 7 entfallen/);
  assert.deepEqual(classGroupsFor(powi).map((g) => g.key), ["6", "8", "9", "10", "E", "Q"]);
  assert.ok(classAllowed(subjectConfig({}, "ethik"), "7A"));
  assert.deepEqual(subjectConfig({ ethik: { grades: ["E", "Q", "x"] } }, "ethik").grades, ["E", "Q"]);
  assert.ok(isAnalogClass("5A") && isAnalogClass("6F") && !isAnalogClass("7A") && !isAnalogClass("Q1-GK"));
  const p = planningSystemPrompt({ ...ctx, klass: "6B" });
  assert.ok(p.includes(ANALOG_RULE) && !p.includes("Schlage bewusst auch vor, statt eines klassischen Arbeitsblatts ein Feibeitsblatt"));
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
  lessonId: "0123456789abcdef", subject: "powi", klass: "Q2-GK",
  lesson: { title: "BVerfG", topic: "Das Bundesverfassungsgericht", durationMin: 90, date: "2026-11-12", ideas: "Mit Karikatur einsteigen" },
  materials: [{ name: "AB BVerfG", area: "student", kind: "text", text: "# AB\nText" }, { name: "Erwartungshorizont.docx", area: "teacher", kind: "file" }],
  sheets: [{ title: "Die wehrhafte Demokratie", code: "AEH4VY" }], portal: "**1) Einstieg**",
};
const messages = [{ role: "user", content: "Bitte mit Rollenspiel" }, { role: "assistant", content: "Vorschlag: Rollenspiel …" }];

test("Chatbot-System-Prompt: feste Rolle wörtlich + Fach, Klasse, Sitzung", () => {
  const p = planningSystemPrompt(ctx);
  assert.ok(p.startsWith(SYSTEM_PROMPT_ROLE));
  assert.match(p, /Unterrichtsfach: Politik und Wirtschaft/);
  assert.match(p, /Klasse\/Kurs: Q2 GK – Qualifikationsphase Q2/);
  assert.match(p, /Unterrichtssitzung: BVerfG/);
  assert.match(p, /Feibeitsblatt/);
});

test("Präsentations-Prompt basiert auf genau dem übergebenen Schulportal-Eintrag", () => {
  const edited = "**1) Einstieg – manuell geändert**\n- Karikatur";
  const p = claudePresentationPrompt(ctx, edited, messages);
  assert.ok(p.includes(edited));
  assert.ok(!p.includes("**1) Einstieg**\n"), "ältere Fassung aus ctx.portal darf nicht vorkommen");
  for (const s of ["PDF-Datei", "PowerPoint-Datei brauche ich nicht", "Q2 GK", "Politik und Wirtschaft", "90 Minuten", "AB BVerfG", "Erwartungshorizont.docx"]) assert.ok(p.includes(s), s);
  assert.ok(!/\.pptx|PowerPoint-Präsentation|Sprechernotizen in jeder Folie/.test(p), "keine PowerPoint-Datei mehr");
});

test("Präsentations-Prompt: Folie 1 ist eine Titelfolie ohne Code – den Sitzungscode zeigt Unterricks selbst (zeitlos)", () => {
  const p = claudePresentationPrompt({ ...ctx, code: "K7QM4X" }, "**1) Einstieg**", []);
  const first = p.slice(p.indexOf("## Folie 1: gestaltete Titelfolie"), p.indexOf("## Sitzungscode noch einmal zeigen"));
  assert.ok(p.indexOf("## Folie 1: gestaltete Titelfolie") > 0 && first.length > 100);
  for (const t of ["zeigt Unterricks vor Folie 1 automatisch seine Codefolie", "dem Sitzungscode der aktuellen Sitzung und dem QR-Code zu Unterricks", "am Beamer und live auf den Geräten der Schüler:innen",
    "Lege dafür keine eigene Folie an", "das Thema bzw. die Leitfrage der Stunde groß, darunter klein das Fach (ohne Klasse und ohne Datum",
    "kein Sitzungscode, kein QR-Code, keine Adresse von Unterricks"]) assert.ok(first.includes(t), t);
  assert.ok(p.includes("Sitzungscode und QR-Code zu Unterricks gehören nicht in die PDF"), "schon in der Einleitung");
  assert.ok(p.includes("Folie 1 ist die Titelfolie (siehe oben; die Codefolie davor zeigt Unterricks), dann eine kurze Stundenübersicht (Agenda)"));
  // der Code der Sitzung steht nie im Prompt: derselbe Prompt in jeder Sitzung, keine QR-Muster mehr
  assert.ok(!p.includes("K7Q-M4X") && !p.includes("K7QM4X") && !p.includes("11111110111000011100001111111") && !p.includes("bitte bei der Lehrkraft erfragen"));
  assert.equal(claudePresentationPrompt({ ...ctx, code: "P3T9RW" }, "**1) Einstieg**", []), p, "der Sitzungscode ändert den Prompt nicht");
});

test("Präsentations-Prompt: Unterricks-Codefolie als Platzhalter (feste Zeile), Code nie selbst schreiben", () => {
  const p = claudePresentationPrompt({ ...ctx, code: "K7QM4X" }, "**1) Einstieg**", []);
  const cs = p.slice(p.indexOf("## Sitzungscode noch einmal zeigen: Unterricks-Codefolie"), p.indexOf("## Materialfolien"));
  assert.equal(CODE_SLIDE_LINE, "Unterricks-Codefolie: Hier zeigt Unterricks den QR-Code und den Sitzungscode.");
  assert.ok(CODE_SLIDE_LINE.startsWith(CODE_SLIDE_MARK));
  for (const t of ["Schreibe den Sitzungscode deshalb auf keine Folie – auch nicht, wenn du ihn kennst (z. B. aus `get_lesson`)", "zeichne keinen QR-Code zu Unterricks",
    "Unterricks erkennt sie beim Hochladen und zeigt im Unterricht an ihrer Stelle – am Beamer und live auf den Geräten der Schüler:innen – seine Codefolie",
    "genau diese Zeile als echten Text – unverändert, ohne Anführungszeichen und in einer einzigen Zeile", ": " + CODE_SLIDE_LINE,
    "höchstens drei kurze Zeilen, die Unterricks wörtlich als Überschrift", "keine Fußzeile, keine Foliennummer, keinen Code und keinen QR-Code",
    "Vor Folie 1 brauchst du keine", "Jede Materialfolie mit Material aus Unterricks ist eine Unterricks-Codefolie"]) assert.ok(cs.includes(t), t);
  assert.ok(!/Platzhalter/.test(p), "„Platzhalter“ nur intern – im Prompt heißt sie Unterricks-Codefolie (Sicherungsfolien haben „Lücken“)");
  assert.ok(p.includes("mit Lücken beginnen") && p.includes("(die Zeile „Unterricks-Codefolie: …“ zählt nicht mit und darf kleiner sein)"));
  assert.ok(p.includes("nie auf einer Unterricks-Codefolie –, damit ihn niemand mit dem QR-Code zu Unterricks verwechselt"));
});

test("Präsentations-Prompt: Materialfolien sind Unterricks-Codefolien mit Aufforderung und Titel des Materials", () => {
  const portal = "**3) Partnerarbeit**\n- Feibeitsblatt ~~Die wehrhafte Demokratie~~ mit dem Code ~~AEH-4VY~~";
  const p = claudePresentationPrompt({ ...ctx, code: "K7QM4X" }, portal, []);
  const mat = p.slice(p.indexOf("## Materialfolien"), p.indexOf("## Zeitlos gestalten"));
  assert.ok(p.indexOf("## Folie 1: gestaltete Titelfolie") < p.indexOf("## Sitzungscode noch einmal zeigen") && p.indexOf("## Sitzungscode noch einmal zeigen") < p.indexOf("## Materialfolien") && p.indexOf("## Materialfolien") < p.indexOf("## Rahmendaten"));
  assert.ok(p.includes("## Materialfolien: Unterricks-Codefolie mit Aufforderung und Titel des Materials"));
  for (const s of ["Feibeitsblatt, Arbeitsblatt", "die Materialfolie ist deshalb eine Unterricks-Codefolie (siehe oben) und enthält außer der Zeile „Unterricks-Codefolie: …“ nur:",
    "die Aufforderung, mit dem Material zu arbeiten", "den Titel des Materials", "genau so, wie das Material in Unterricks heißt", "„Feibeitsblatt: Die wehrhafte Demokratie“.",
    "Unterricks zeigt Aufforderung und Titel dann als Überschrift über dem Sitzungscode und dem QR-Code der aktuellen Sitzung.",
    "Inhalte des Materials", "auch nicht der Code eines Feibeitsblatts, auch wenn der Stundenverlauf ihn nennt", "neben dem Sitzungscode, den Unterricks auf der Codefolie zeigt", "Notfall-Feibeitsblätter"]) assert.ok(mat.includes(s), s);
  assert.ok(!mat.includes("K7Q-M4X") && !mat.includes("denselben QR-Code") && !mat.includes("Du findest das Material in Unterricks: QR-Code scannen"));
  assert.ok(p.includes("Arbeiten die Schüler:innen dabei mit Material, ist das die Materialfolie"), "Arbeitsphasen mit Material: Materialfolie statt ausführlicher Auftragsfolie");
  assert.ok(!p.includes("Feibeitsblätter mit Titel und Code"), "der Code eines Feibeitsblatts kommt nicht auf Folien");
  // Beispieltitel: ohne Feibeitsblatt ein Material für Schüler:innen (nie ein Notfall-Feibeitsblatt), sonst ein Platzhalter
  const nf = { name: "Notfall-Feibeitsblatt – X.pdf", area: "student", kind: "file" };
  assert.ok(claudePresentationPrompt({ ...ctx, sheets: [], materials: [nf, { name: "M1 Karikatur.pdf", area: "student", kind: "file" }] }, portal, []).includes("z. B. „M1 Karikatur“"), "Beispiel ohne Dateiendung");
  assert.ok(claudePresentationPrompt({ ...ctx, sheets: [], materials: [nf] }, portal, []).includes("z. B. „Arbeitsblatt: <Titel des Arbeitsblatts>“"));
  // Druckmaterial („von der Lehrkraft auszudrucken“) sehen die Schüler:innen in Unterricks nicht: gewöhnliche Folie mit „(auf Papier)“
  assert.ok(mat.includes("„von der Lehrkraft auszudrucken“") && mat.includes("ist die Materialfolie eine gewöhnliche Folie (keine Unterricks-Codefolie): Aufforderung und Titel mit „(auf Papier)“ dahinter, ohne Hinweis auf Unterricks"));
  assert.ok(mat.includes("bleibt es eine Unterricks-Codefolie, und nur beim ausgedruckten Material steht „(auf Papier)“"));
  assert.ok(mat.includes("unten gar nicht oder nur als Material „nur Lehrkraft“"), "Druckmaterial gilt nicht als fehlend");
});

test("Präsentations-Prompt: zeitlos – keine Daten der Lerngruppe, keine Klasse, kein Sitzungscode, Hausaufgabe bis zur nächsten Unterrichtssitzung", () => {
  const p = claudePresentationPrompt({ ...ctx, klass: "8C", lesson: { ...ctx.lesson, date: "2026-11-12", homework: "Lies M2 bis zum 19.11." } }, "**1) Einstieg**", []);
  const z = p.slice(p.indexOf("## Zeitlos gestalten"), p.indexOf("## Rahmendaten"));
  assert.ok(p.indexOf("## Materialfolien") < p.indexOf("## Zeitlos gestalten") && p.indexOf("## Zeitlos gestalten") < p.indexOf("## Rahmendaten"));
  for (const t of ["in ein paar Jahren noch passen, wenn eine andere Klasse dieses Jahrgangs das Thema lernt", "kein Datum, das sich auf diese Lerngruppe bezieht",
    "„bis zur nächsten Unterrichtssitzung“ zu erledigen, auch wenn im Stundenverlauf oder bei der Hausaufgabe ein Datum steht", "nicht die Klasse (z. B. „8C“)", "(„Jg. 8“)",
    "nicht als „aktuell“ oder „derzeit“, sondern mit Jahreszahl und Quelle", "kein Sitzungscode und kein QR-Code zu Unterricks: Beides gehört zu einer einzigen Sitzung",
    "immer mit dem Code der aktuellen Sitzung –, so passt die Präsentation unverändert in jede spätere Sitzung"]) assert.ok(z.includes(t), t);
  assert.ok(!z.includes("Ausnahme"), "keine Ausnahme mehr für den Sitzungscode");
  assert.ok(!p.includes("12.11.2026") && !/^- Datum:/m.test(p), "das Datum der Stunde steht nicht im Prompt");
  assert.ok(p.includes("Hausaufgabe (als letzte Inhaltsfolie zeigen – zu erledigen „bis zur nächsten Unterrichtssitzung“, ohne Datum; danach darf eine Unterricks-Codefolie folgen): Lies M2"));
  assert.ok(p.includes("„Jg-8_Politik-und-Wirtschaft_") && !p.includes("„8C_"), "Dateiname ohne Klasse");
  assert.ok(claudePresentationPrompt(ctx, "x", []).includes("„Q2-GK_Politik-und-Wirtschaft_"), "Oberstufe: Kurs als Lerngruppe");
});

test("Präsentations-Prompt Jahrgang 5/6 (keine iPads): Materialfolien sind gewöhnliche Folien, die Codefolie vor Folie 1 zeigt Unterricks trotzdem", () => {
  const p = claudePresentationPrompt({ ...ctx, klass: "6B", code: "K7QM4X", sheets: [], materials: [{ name: "AB Kinderrechte.pdf", area: "print", kind: "file" }] }, "**1) Einstieg**", []);
  const mat = p.slice(p.indexOf("## Materialfolien"), p.indexOf("## Rahmendaten"));
  assert.ok(p.includes("## Materialfolien: Aufforderung und Titel des Materials (auf Papier)"));
  assert.ok(mat.includes("keine iPads und bekommen das Material auf Papier – die Materialfolie ist deshalb eine gewöhnliche Folie (keine Unterricks-Codefolie)") && mat.includes("z. B. „AB Kinderrechte (auf Papier)“ – ohne QR-Code, ohne Sitzungscode und ohne Hinweis auf Unterricks"));
  assert.ok(!mat.includes("Unterricks zeigt Aufforderung und Titel") && !p.includes("K7Q-M4X") && mat.includes("lege ich es zum Ausdrucken an"));
  assert.ok(!p.includes("synchron auf den Geräten der Schüler:innen") && !p.includes("live auf den Geräten der Schüler:innen") && p.includes("die Schüler:innen dieser Jahrgangsstufe haben im Unterricht keine iPads"));
  const first = p.slice(p.indexOf("## Folie 1: gestaltete Titelfolie"), p.indexOf("## Materialfolien"));
  assert.ok(first.includes("zeigt Unterricks vor Folie 1 automatisch seine Codefolie") && first.includes("– am Beamer (in dieser Jahrgangsstufe, damit die Schüler:innen die Sitzung zu Hause finden)"), "die Codefolie gibt es auch hier (für zu Hause)");
  assert.ok(first.includes("Setze höchstens nach der Hausaufgabe eine Unterricks-Codefolie mit der Überschrift „Zu Hause findest du diese Sitzung in Unterricks.“ ein – Materialfolien sind hier gewöhnliche Folien."));
  assert.ok(mat.includes("unten nicht als „von der Lehrkraft auszudrucken“, nenne es mir zusätzlich im Chat – dann lege ich es zum Ausdrucken an"), "Material ohne Druckvorlage wird gemeldet");
});

test("Feibeitsblatt-Entwurf normalisieren", () => {
  const d = normalizeFbDraft({ titel: "T", aufgaben: [{ text: "A1", ki_auftrag: "K1" }, { text: "A2", ki_auftrag: "K2", antwort: { tabelle: ["Pro", "Contra"], zeilen: 4 } }, { text: "" }, { text: "Foto deines Plakats", antwort: "foto" }] });
  assert.equal(d.title, "T");
  assert.equal(d.tasks.length, 3);
  assert.deepEqual(d.tasks[2].answer, { type: "photo" });
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

test("Kurse in Ev. Religion und Ethik: ein Kurs je Jahrgang (5–10, E-Phase) mit Klassen, die die Lehrkraft wählt", () => {
  assert.equal(classShort("8-K"), "Kurs Jg. 8"); assert.equal(classShort("E-K"), "Kurs E-Phase"); assert.equal(classShort("10-K"), "Kurs Jg. 10");
  assert.equal(gradeKey("8-K"), "8"); assert.equal(gradeKey("10-K"), "10"); assert.equal(gradeKey("E-K"), "E");
  assert.equal(gradeInfo("8-K").stufe, 8); assert.equal(gradeInfo("E-K").stufe, 11); assert.equal(gradeInfo("E-K").halfYear, "E");
  assert.match(gradeInfo("8-K").text, /^Jahrgangsstufe 8 \(Sekundarstufe I\), Kurs mit Schüler:innen aus mehreren Klassen/);
  assert.ok(isAnalogClass("5-K") && isAnalogClass("6-K") && !isAnalogClass("7-K"), "Jg. 5/6 bleiben analog");
  assert.equal(classLabel("8-K"), "Kurs Jg. 8 – " + gradeInfo("8-K").text);
  // Zuordnung: nur echte Klassen genau dieses Jahrgangs, ohne Doppelte, sortiert; nur Ev. Religion und Ethik
  const all = { ethik: { courses: { "8": ["8D", "8A", "8A", "7B", "8-K", "x", 3], E: ["EB"], Q: ["Q1-GK"], "11": ["EA"] } }, powi: { courses: { "8": ["8A"] } } };
  const ethik = subjectConfig(all, "ethik"), powi = subjectConfig(all, "powi");
  assert.deepEqual(ethik.courses, { "8": ["8A", "8D"], E: ["EB"] });
  assert.ok(ethik.courseMode && !powi.courseMode); assert.deepEqual(powi.courses, {});
  assert.ok(classAllowed(ethik, "8-K") && classAllowed(ethik, "8B"), "Kurs für die Lehrkraft, eigene Klasse für die Schüler:innen");
  assert.ok(!classAllowed(powi, "8-K"), "Politik und Wirtschaft kennt keine Kurse über mehrere Klassen");
  assert.ok(!classAllowed(subjectConfig({ ethik: { grades: ["9", "E", "Q"] } }, "ethik"), "8-K"), "nur in Jahrgängen, in denen das Fach unterrichtet wird");
  assert.deepEqual(courseMembers(ethik, "8-K"), ["8A", "8D"]); assert.deepEqual(courseMembers(ethik, "9-K"), []); assert.deepEqual(courseMembers(ethik, "8A"), []);
  assert.equal(courseOf(ethik, "8D"), "8-K"); assert.equal(courseOf(ethik, "8B"), null); assert.equal(courseOf(powi, "8A"), null);
  assert.ok(isCourseClass("E-K") && !isCourseClass("EA") && !isCourseClass("Q2-GK"));
  // acht Klassen je Jahrgang: auch 8G, 8H und EH gehören in einen Kurs, 8I gibt es nicht
  assert.deepEqual(subjectConfig({ ethik: { courses: { "8": ["8H", "8G", "8I", "7H"], E: ["EH", "EI"] } } }, "ethik").courses, { "8": ["8G", "8H"], E: ["EH"] });
});

test("Hausaufgabe fürs Schulportal: fette Überschrift mit Datum, Stichpunkte, zuletzt der Weg zur Sitzung (Code kursiv)", () => {
  const line = "- Unter https://unterricks.janrickmer.de kannst du diese Sitzung mit dem Code ~~K45-7A4~~ aufrufen, um alle Materialien zu sehen und Abgaben eines Feibeitsblattes zu erledigen.";
  assert.equal(PUBLIC_URL, "https://unterricks.janrickmer.de");
  assert.equal(fmtLongDay("2026-11-25"), "25. November 2026"); assert.equal(fmtLongDay("2027-03-01"), "1. März 2027"); assert.equal(fmtLongDay("kein Datum"), "");
  assert.equal(homeworkForPortal("Lies **M2** und beantworte Aufgabe 3.", "K457A4", "2026-11-25"),
    "**Hausaufgabe zum 25. November 2026:**\n\n- Lies **M2** und beantworte Aufgabe 3.\n" + line);
  assert.equal(homeworkForPortal("- Aufgabe 1\n* Aufgabe 2\n\n  Aufgabe 3  \n--alt--", "K457A4", "2026-11-25"),
    "**Hausaufgabe zum 25. November 2026:**\n\n- Aufgabe 1\n- Aufgabe 2\n- Aufgabe 3\n- --alt--\n" + line, "jede Zeile ein Stichpunkt; Durchgestrichenes bleibt");
  assert.equal(homeworkForPortal("Lies M2", "K457A4", null), "**Hausaufgabe zur nächsten Sitzung:**\n\n- Lies M2\n" + line, "ohne spätere Sitzung kein Datum");
  assert.equal(homeworkForPortal("", "K457A4", "2026-11-25"), line, "ohne Hausaufgabe nur der Hinweis");
  assert.equal(homeworkForPortal(null, "K457A4"), line);
  const parsed = parsePortalMarkup(homeworkForPortal("Lies M2.", "K457A4", "2026-11-25"));
  assert.ok(parsed[0].type === "p" && parsed[0].runs.every((r) => r.b) && parsed[1].type === "blank", "Überschrift fett, dann eine Leerzeile");
  // im Schulportal: ein Aufzählungspunkt mit anklickbarer Adresse und kursivem Code (nicht durchgestrichen)
  const li = parsed[3];
  assert.equal(li.type, "li");
  assert.ok(li.runs.some((r) => r.href === "https://unterricks.janrickmer.de") && li.runs.some((r) => r.text === "K45-7A4" && r.i && !r.s));
  assert.equal(groupShort("8B"), "Jg. 8"); assert.equal(groupShort("8-K"), "Jg. 8"); assert.equal(groupShort("EA"), "E-Phase"); assert.equal(groupShort("Q2-GK"), "Q2 GK"); assert.equal(groupShort("x"), "");
});

test("Beamer-Folie: QR-Code-Datei passt zur Adresse von Unterricks (sonst node scripts/qr-unterricks.mjs)", async () => {
  const { readFileSync } = await import("node:fs");
  const { qrSvg, QR_FILE } = await import("../../scripts/qr-unterricks.mjs");
  const svg = readFileSync(QR_FILE, "utf8");
  assert.equal(svg, qrSvg(PUBLIC_URL));
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 37 37"/);
  assert.ok(!/<script|on\w+=/i.test(svg), "reines SVG ohne Skript");
});

test("Zeitpunkte der Sitzung (Europe/Berlin): Hausaufgabe 15 min vor dem Ende, Präsentation 5 min nach dem Ende, ohne Beginn/Dauer gesperrt", async () => {
  const { berlinTime, lessonTimes, isClockTime, fmtClockBerlin } = await import("../../public/shared.js");
  assert.equal(new Date(berlinTime("2026-11-10", "07:45")).toISOString(), "2026-11-10T06:45:00.000Z", "Winterzeit (MEZ)");
  assert.equal(new Date(berlinTime("2026-07-01", "07:45")).toISOString(), "2026-07-01T05:45:00.000Z", "Sommerzeit (MESZ)");
  assert.equal(new Date(berlinTime("2026-10-25", "01:30")).toISOString(), "2026-10-24T23:30:00.000Z", "Tag der Zeitumstellung");
  const t = lessonTimes({ date: "2026-11-10", startTime: "10:00", durationMin: 90 });
  assert.equal(fmtClockBerlin(t.homeworkAt), "11:15"); assert.equal(fmtClockBerlin(t.end), "11:30"); assert.equal(fmtClockBerlin(t.presentationAt), "11:35");
  assert.equal(lessonTimes({ date: "2026-11-10", startTime: null, durationMin: 90 }), null);
  assert.equal(lessonTimes({ date: "2026-11-10", startTime: "10:00", durationMin: null }), null);
  assert.equal(lessonTimes({ date: null, startTime: "10:00", durationMin: 45 }), null);
  assert.ok(isClockTime("07:45") && isClockTime("23:59") && !isClockTime("7:45") && !isClockTime("24:00") && !isClockTime("07:45:00"));
});

test("Links als Material: nur http(s) ohne Zugangsdaten, ohne Schema wird https ergänzt; im Kontext für die KI mit Adresse", async () => {
  const { cleanWebUrl, webUrlLabel, lessonContext } = await import("../../public/shared.js");
  assert.equal(cleanWebUrl("www.bpb.de/themen"), "https://www.bpb.de/themen");
  assert.equal(cleanWebUrl(" https://de.wikipedia.org/wiki/Bundesverfassungsgericht_(Deutschland) "), "https://de.wikipedia.org/wiki/Bundesverfassungsgericht_(Deutschland)");
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://x.de", "https://user:pw@x.de", "https://x .de", "intranet", "", null, "https://" + "a".repeat(2000) + ".de"]) assert.equal(cleanWebUrl(bad), null, String(bad));
  assert.equal(webUrlLabel("https://www.bpb.de/themen/"), "www.bpb.de/themen");
  const txt = lessonContext({ subject: "powi", klass: "8A", lesson: { title: "T" }, materials: [{ name: "Erklärvideo", area: "student", kind: "link", text: "https://www.bpb.de/x" }] });
  assert.match(txt, /- Erklärvideo \(für Schüler:innen, Link: https:\/\/www\.bpb\.de\/x\)/);
});

import { codesInText, slideCodeBoxes, slideSessionCode } from "../../public/shared.js";

test("Sitzungscode auf Folien: Codes im Text finden (mit Bindestrich, nicht mitten in Wörtern, nur gültige Codes)", () => {
  assert.deepEqual(codesInText("AEH-4VY"), [{ start: 0, end: 7, code: "AEH4VY" }]);
  assert.deepEqual(codesInText("Sitzungscode: K7Q–M4X.").map((c) => c.code), ["K7QM4X"]);   // Gedankenstrich
  assert.deepEqual(codesInText("AAA-222 BBB-333").map((c) => c.code), ["AAA222", "BBB333"]);
  for (const t of ["AEH4VY", "AEH 4VY", "XAEH-4VY", "AEH-4VYZ", "ABC-DEF", "234-567", "ABI-123", "aeh-4vy"]) assert.equal(codesInText(t).length, 0, t);
});

test("Sitzungscode auf Folien: Kästen aus Textstücken (auch über mehrere Stücke) und der Code von Folie 1", () => {
  const big = { str: "AEH-4VY", x: 100, base: 300, w: 700, h: 120, eol: true, family: "monospace" };
  const small = [{ str: "Sitzungscode ", x: 50, base: 900, w: 260, h: 40 }, { str: "AEH-", x: 312, base: 900, w: 80, h: 40 }, { str: "4VY", x: 392, base: 900, w: 60, h: 40, eol: true }];
  const fb = { str: "Feibeitsblatt K7Q-M4X", x: 50, base: 600, w: 420, h: 40, eol: true };
  const boxes = slideCodeBoxes([fb, ...small, big]);
  assert.deepEqual(boxes.map((b) => b.code), ["K7QM4X", "AEH4VY", "AEH4VY"]);
  const s = boxes[1];
  assert.ok(Math.abs(s.x0 - 312) < 0.01 && Math.abs(s.x1 - 452) < 0.01 && s.base === 900 && s.h === 40, "Kasten über zwei Stücke");
  assert.equal(boxes[2].family, "monospace");
  assert.equal(slideSessionCode(boxes), "AEH4VY", "der größte Code auf Folie 1 ist der Sitzungscode");
  assert.equal(slideSessionCode([]), "");
  // andere Zeile (andere Grundlinie) wird nicht verbunden; ungültige Stücke stören nicht
  assert.deepEqual(slideCodeBoxes([{ str: "AEH-", x: 0, base: 100, w: 80, h: 40 }, { str: "4VY", x: 80, base: 200, w: 60, h: 40 }, null, { str: "x" }]), []);
});

test("Sitzungscode auf Folien: mit gemessenen Zeichenbreiten liegt der Kasten auch in Proportionalschrift richtig", () => {
  // „Sitzungscode “ (13 Zeichen) ist breit, der Code schmaler: mit gleich breiten Zeichen läge der Kasten zu weit rechts
  const item = { str: "Sitzungscode ABC-234", x: 0, base: 100, w: 400, h: 40, eol: true };
  const adv = (ch) => (ch === " " ? 1 : /[A-Z0-9]/.test(ch) ? 3 : 2);   // „S“ 3 + 11·2 + „ “ 1 = 26 vor dem Code, Code 6·3 + „-“ 2 = 20 → Summe 46
  const [even] = slideCodeBoxes([item]), [real] = slideCodeBoxes([item], adv);
  assert.ok(Math.abs(even.x0 - 260) < 0.01, "ohne Messung: 13/20 der Breite");
  assert.ok(Math.abs(real.x0 - (400 * 26) / 46) < 0.01 && Math.abs(real.x1 - 400) < 0.01, "mit Messung: genau dort, wo der Code steht");
  assert.equal(slideCodeBoxes([item], () => 0)[0].x0, even.x0, "unbrauchbare Messung: wie ohne");
});

import { codeCover, coverFill, codeFontStyle } from "../../public/shared.js";

test("Sitzungscode auf Folien: gesperrt gesetzter Code (PDF.js fügt Leerzeichen ein), Feibeitsblatt-Codes und kleine Codes ausgenommen", () => {
  assert.deepEqual(codesInText("A E H - 4 V Y"), [{ start: 0, end: 13, code: "AEH4VY" }]);
  assert.deepEqual(codesInText("Code: A E H – 4 V Y!").map((c) => c.code), ["AEH4VY"]);
  assert.equal(codesInText("A E H 4 V Y").length + codesInText("A  E H - 4 V Y").length + codesInText("XA E H - 4 V Y").length, 0);
  const spaced = slideCodeBoxes([{ str: "A E H - 4 V Y", x: 100, base: 300, w: 1300, h: 120, eol: true }]);
  assert.ok(spaced.length === 1 && spaced[0].x0 === 100 && Math.abs(spaced[0].x1 - 1400) < 0.01, "Kasten vom ersten bis zum letzten Zeichen");
  const boxes = [{ code: "K7QM4X", h: 200 }, { code: "AEH4VY", h: 150 }, { code: "BCD234", h: 20 }];
  assert.equal(slideSessionCode(boxes, { exclude: ["K7QM4X"] }), "AEH4VY", "Code eines verknüpften Feibeitsblatts ist nie der Sitzungscode");
  assert.equal(slideSessionCode([{ code: "BCD234", h: 20 }], { minH: 64 }), "", "kleiner Code auf Folie 1 ist nicht der Sitzungscode");
});

test("Sitzungscode auf Folien: codeCover findet die Buchstaben des Codes – Umgebung bleibt stehen", () => {
  // Bild 200 × 140, Schriftgröße 60, Grundlinie 90; „Buchstaben“ = senkrechte Balken (40 % der Fläche) von y 50 bis 90 zwischen x 40 und 160
  const rw = 200, rh = 140;
  const img = (paint) => { const d = new Uint8ClampedArray(rw * rh * 4); const set = (x, y, c) => { const i = (y * rw + x) * 4; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; }; paint(set); return d; };
  const fill = (set, x0, y0, x1, y1, c) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, c); };
  const glyphs = (set, c, y0 = 50) => { for (let y = y0; y <= 90; y++) for (let x = 40; x <= 160; x++) if ((x - 40) % 20 < 8) set(x, y, c); };
  const BLUE = [32, 59, 94], YEL = [255, 217, 77], WHITE = [255, 255, 255], DARK = [17, 24, 39];
  const box = { x0: 40, x1: 160, base: 90, h: 60 };
  const masked = (c, x, y) => x >= c.x && y >= c.y && x < c.x + c.w && y < c.y + c.h && c.mask[(y - c.y) * c.w + (x - c.x)] === 1;
  // 1) einfarbiger Grund, weiße Zeile weit darüber: Farben, Maske = Buchstaben samt 2 px Rand, nicht die Lücken dazwischen
  let c = codeCover(img((set) => { fill(set, 0, 0, rw - 1, rh - 1, BLUE); glyphs(set, YEL); fill(set, 40, 20, 160, 28, WHITE); }), rw, rh, box);
  assert.deepEqual(c.bg.map(Math.round), BLUE); assert.deepEqual(c.fg, YEL);
  assert.ok(c.inkX === 40 && c.inkX + c.inkW === 161, "Schriftfläche genau (" + c.inkX + "/" + c.inkW + ")");
  assert.ok(masked(c, 44, 70) && masked(c, 49, 70) && !masked(c, 54, 70) && !masked(c, 44, 24), "Buchstaben ja, Lücke und Zeile darüber nein");
  // 2) Text dicht über dem Code (weiß, y 46–52), Zeile mit „Umlautpunkten“ 3 px unter der Grundlinie und ein unterschnittener Punkt
  //    direkt am letzten Buchstaben (unten rechts, 2 px Abstand): alles bleibt stehen
  c = codeCover(img((set) => { fill(set, 0, 0, rw - 1, rh - 1, BLUE); glyphs(set, YEL, 60); fill(set, 40, 46, 160, 52, WHITE); fill(set, 45, 94, 48, 96, WHITE); fill(set, 52, 94, 55, 96, WHITE); fill(set, 170, 84, 175, 90, YEL); }), rw, rh, box);
  assert.deepEqual(c.fg, YEL, "Schriftfarbe des Codes, nicht die der Zeile darüber");
  assert.ok(!masked(c, 60, 49) && !masked(c, 46, 95) && !masked(c, 172, 88), "Zeile darüber, Punkte darunter und der Punkt daneben bleiben");
  assert.ok(c.inkX + c.inkW === 161, "der Punkt gehört nicht zum Code");
  // 3) knappes farbiges Kästchen (gelb, endet 3 px unter der Grundlinie) auf weißer Folie, dunkle Schrift: Hintergrund = Kästchen
  c = codeCover(img((set) => { fill(set, 0, 0, rw - 1, rh - 1, WHITE); fill(set, 30, 40, 170, 93, YEL); glyphs(set, DARK); }), rw, rh, box);
  assert.deepEqual(c.bg.map(Math.round), YEL, "Hintergrund ist das Kästchen, nicht die Folie"); assert.deepEqual(c.fg, DARK);
  assert.ok(c.x >= 30 && c.x + c.w <= 171 && c.y >= 40 && c.y + c.h <= 94, "die Maske bleibt im Kästchen");
  // 4) unterstrichener Code (Strich in Schriftfarbe 4–6 px unter der Grundlinie über die ganze Breite): Strich bleibt
  c = codeCover(img((set) => { fill(set, 0, 0, rw - 1, rh - 1, WHITE); glyphs(set, DARK); fill(set, 38, 94, 162, 96, DARK); }), rw, rh, box);
  assert.deepEqual(c.bg.map(Math.round), WHITE); assert.deepEqual(c.fg, DARK);
  assert.ok(!masked(c, 100, 95), "der Unterstrich wird nicht übermalt");
  // 5) weißer fetter Code auf einem waagerechten Farbverlauf (typische Titelfolie): Hintergrund = Verlauf, nicht die Schrift
  c = codeCover(img((set) => { for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) set(x, y, [102 + x * 0.08, 126 - x * 0.25, 234 - x * 0.36]); for (let y = 50; y <= 90; y++) for (let x = 40; x <= 160; x++) if ((x - 40) % 20 < 9) set(x, y, WHITE); }), rw, rh, box);
  assert.ok(c && Math.min(...c.bg) < 200 && c.fg.join() === WHITE.join(), "Farben nicht vertauscht " + JSON.stringify(c && [c.bg.map(Math.round), c.fg]));
  // 6) weiße Schrift in einem knappen blauen Kästchen auf weißer Folie (Kästchen endet oben schon an der Schrift, seitlich nach 6 px):
  //    Hintergrund = Kästchen, nicht die weiße Folie
  c = codeCover(img((set) => { fill(set, 0, 0, rw - 1, rh - 1, WHITE); fill(set, 34, 49, 166, 96, [30, 58, 138]); glyphs(set, WHITE); }), rw, rh, box);
  assert.ok(c && c.bg.map(Math.round).join() === "30,58,138" && c.fg.join() === WHITE.join(), "Kästchen ist Hintergrund " + JSON.stringify(c && [c.bg.map(Math.round), c.fg]));
  assert.ok(c.x >= 34 && c.x + c.w <= 167, "die Maske bleibt im Kästchen");
  // 7) ohne Schrift an der Stelle (Code nur in der Textebene) bzw. vollflächig (kein Text auf ruhigem Grund): nichts übermalen
  assert.equal(codeCover(img((set) => fill(set, 0, 0, rw - 1, rh - 1, [200, 200, 200])), rw, rh, box), null);
  assert.equal(codeCover(img((set) => { fill(set, 0, 0, rw - 1, rh - 1, WHITE); fill(set, 40, 40, 160, 90, DARK); fill(set, 60, 60, 61, 61, WHITE); }), rw, rh, box), null);
});

test("Sitzungscode auf Folien: coverFill füllt nur die Maske, wie der Hintergrund (auch Verlauf), ohne Schrift am Rand", () => {
  const rw = 100, rh = 60, d = new Uint8ClampedArray(rw * rh * 4);
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const i = (y * rw + x) * 4; d[i] = x; d[i + 1] = 100; d[i + 2] = 50 + y; d[i + 3] = 255; }   // sanfter Verlauf
  const i0 = (6 * rw + 50) * 4; d[i0] = 255; d[i0 + 1] = 255; d[i0 + 2] = 255;   // ein „Schrift“-Pixel über der Fläche
  const c = { x: 20, y: 10, w: 60, h: 30, bg: [50, 100, 80], thr: 200, mask: new Uint8Array(60 * 30).fill(1) };
  c.mask[0] = 0;
  const out = coverFill(d, rw, rh, c), px = (x, y) => Array.from(out.slice((y * c.w + x) * 4, (y * c.w + x) * 4 + 3));
  const near = (a, b2, t = 6) => a.every((v, k) => Math.abs(v - b2[k]) <= t);
  assert.deepEqual(px(0, 0), [20, 100, 60], "außerhalb der Maske bleibt das Bild");
  assert.ok(near(px(1, 0), [21, 100, 60]) && near(px(59, 29), [79, 100, 89]), "waagerecht und senkrecht wie der Verlauf " + JSON.stringify([px(1, 0), px(59, 29)]));
  assert.ok(near(px(30, 0), [50, 100, 60]), "das Schrift-Pixel darüber zählt nicht " + JSON.stringify(px(30, 0)));
});

test("Sitzungscode auf Folien: Schrift des alten Codes aus den Angaben von PDF.js", () => {
  assert.deepEqual(codeFontStyle({ name: "BCDEEE+DejaVuSansMono-Bold", bold: true }), { mono: true, serif: false, bold: true, italic: false });
  assert.deepEqual(codeFontStyle({ name: "Courier" }), { mono: true, serif: false, bold: false, italic: false });
  assert.deepEqual(codeFontStyle({ name: "Times-BoldItalic", bold: true, italic: true }), { mono: false, serif: true, bold: true, italic: true });
  assert.deepEqual(codeFontStyle({ name: "Helvetica-Oblique" }), { mono: false, serif: false, bold: false, italic: true });
  assert.deepEqual(codeFontStyle({ name: "ABCDEF+Caladea-Italic", italic: true }), { mono: false, serif: true, bold: false, italic: true });
  assert.deepEqual(codeFontStyle({ name: "LiberationSans-Bold", fallbackName: "sans-serif", bold: true }), { mono: false, serif: false, bold: true, italic: false });
  assert.equal(codeFontStyle(null).bold, null, "ohne Angaben: Schnitt unbekannt (dann misst paintCode)");
});

import { slideTextLines, codeSlideLines, cleanCodeSlides, CODE_SLIDE_LIMITS } from "../../public/shared.js";
// Textstücke wie aus presenter.js (Gerätekoordinaten: base = Grundlinie von oben, h = Schriftgröße)
const piece = (str, x, base, h, extra = {}) => ({ str, x, base, w: str.length * h * 0.5, h, eol: false, ...extra });

test("Codefolie: Platzhalterfolie an der Zeile „Unterricks-Codefolie“ erkennen – Überschrift = großer übriger Text von oben nach unten", () => {
  const items = [
    piece("Politik und Wirtschaft · Die wehrhafte Demokratie", 60, 1050, 14), piece("4", 1840, 1050, 14),   // Fußzeile und Seitenzahl: klein
    piece("Feibeitsblatt: Die wehrhafte Demokratie", 120, 420, 56),
    piece("Bearbeitet in Partnerarbeit die", 120, 260, 40), piece("Aufgaben 1 bis 3.", 760, 260, 40),   // eine Zeile in zwei Stücken
    piece(CODE_SLIDE_LINE, 120, 980, 18),
  ];
  assert.deepEqual(codeSlideLines(slideTextLines(items)), ["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", "Feibeitsblatt: Die wehrhafte Demokratie"]);
  // ohne die Zeile: gewöhnliche Folie
  assert.equal(codeSlideLines(slideTextLines(items.filter((it) => it.str !== CODE_SLIDE_LINE))), null);
  // nur die Zeile: Codefolie ohne Überschrift (Unterricks zeigt den Titel der Sitzung)
  assert.deepEqual(codeSlideLines(slideTextLines([piece(CODE_SLIDE_LINE, 120, 980, 18)])), []);
});

test("Codefolie: Erkennung tolerant – gesperrt, anderer Strich, klein geschrieben, umbrochener Erklärsatz, Anführungszeichen, Codes", () => {
  const spaced = "U n t e r r i c k s ‐ C o d e f o l i e : Hier zeigt Unterricks den QR-Code und den";
  assert.deepEqual(codeSlideLines(slideTextLines([piece("Die Hausaufgabe und das Material findest du in Unterricks.", 100, 300, 44), piece(spaced, 100, 950, 16), piece("Sitzungscode.", 100, 975, 16)])),
    ["Die Hausaufgabe und das Material findest du in Unterricks."], "Erklärsatz (auch umbrochen) entfällt, „Unterricks“ in der Überschrift bleibt");
  assert.deepEqual(codeSlideLines([{ text: "unterricks – codefolie", base: 900, h: 14 }, { text: "„Feibeitsblatt: Kinderrechte“", base: 300, h: 40 }]), ["Feibeitsblatt: Kinderrechte"], "ganz in Anführungszeichen → ohne");
  assert.deepEqual(codeSlideLines([{ text: "Feibeitsblatt: „Kinderrechte“", base: 300, h: 40 }, { text: CODE_SLIDE_MARK, base: 900, h: 14 }]), ["Feibeitsblatt: „Kinderrechte“"], "Anführungszeichen im Titel bleiben");
  assert.deepEqual(codeSlideLines([{ text: "Sitzungscode: K7Q-M4X", base: 300, h: 80 }, { text: "Code AEH-4VY", base: 400, h: 60 }, { text: "Bearbeitet die Aufgaben.", base: 500, h: 40 }, { text: CODE_SLIDE_MARK, base: 900, h: 14 }]),
    ["Bearbeitet die Aufgaben."], "Codes gehören nie in die Überschrift");
  assert.deepEqual(codeSlideLines([{ text: "• " + CODE_SLIDE_MARK + " –", base: 300, h: 40 }]), [], "Marke mit Zeichen davor: ganze Zeile entfällt");
  assert.deepEqual(codeSlideLines([{ text: "Lies den Text " + CODE_SLIDE_MARK, base: 300, h: 40 }]), ["Lies den Text"], "steht die Marke hinter Text, bleibt der Text");
  const many = Array.from({ length: 7 }, (_, i) => ({ text: "Satz " + (i + 1) + " mit Text.", base: 100 + i * 60, h: 40 }));
  assert.deepEqual(codeSlideLines([...many, { text: CODE_SLIDE_MARK, base: 950, h: 14 }]), many.slice(0, CODE_SLIDE_LIMITS.lines).map((l) => l.text), "höchstens vier Zeilen");
  assert.equal(codeSlideLines([{ text: "x".repeat(400) + " lang", base: 100, h: 40 }, { text: CODE_SLIDE_MARK, base: 900, h: 14 }])[0].length, CODE_SLIDE_LIMITS.line);
  assert.equal(codeSlideLines([]), null);
  assert.equal(codeSlideLines(null), null);
});

test("Codefolie: Daten von außen (Browser → Server → Live) prüfen", () => {
  assert.deepEqual(cleanCodeSlides([{ n: 3, lines: ["a\u0000b", "  ", " x  y ", 5, "‮umgedreht"] }, { n: 3 }, { n: 0 }, { n: 2.5 }, { n: 6 }, { n: 2, lines: "x" }, null, "x"], 5),
    [{ n: 2, lines: [] }, { n: 3, lines: ["a b", "x y", "umgedreht"] }]);
  assert.deepEqual(cleanCodeSlides({ n: 1 }, 5), []);
  assert.deepEqual(cleanCodeSlides([{ n: 1, lines: ["a"] }], 0), []);
  const big = Array.from({ length: 100 }, (_, i) => ({ n: i + 1, lines: Array.from({ length: 9 }, () => "y".repeat(500)) }));
  const c = cleanCodeSlides(big, 300);
  assert.equal(c.length, CODE_SLIDE_LIMITS.slides);
  assert.ok(c.every((x) => x.lines.length === CODE_SLIDE_LIMITS.lines && x.lines.every((l) => l.length === CODE_SLIDE_LIMITS.line)));
  assert.ok(JSON.stringify(c).length < 64000, "passt in die Anfrage an …/ready (readJson 64 000)");
  assert.equal(cleanCodeSlides([{ n: 1, lines: ["a".repeat(159) + "😀"] }], 1)[0].lines[0].length, 159, "kein halbes Ersatzzeichenpaar am Ende");
});

test("Codefolie: Zeilenbildung bleibt für den Code-Ersatz dieselbe (slideTextLines liefert die Schriftgröße mit)", () => {
  const l = slideTextLines([piece("Sitzungscode", 100, 200, 30), piece("AEH-4VY", 520, 200, 60), { str: "", eol: true }, piece("Zweite", 100, 300, 30)]);
  assert.deepEqual(l.map((x) => [x.text, x.h]), [["Sitzungscode AEH-4VY", 60], ["Zweite", 30]]);
  assert.deepEqual(slideCodeBoxes([piece("Sitzungscode", 100, 200, 30), piece("AEH-4VY", 520, 200, 60)]).map((b) => b.code), ["AEH4VY"]);
});

test("Codefolie: die Beispiel-Überschriften des Prompts übersteht die Erkennung unverändert", () => {
  for (const head of ["Zu Hause findest du diese Sitzung in Unterricks.", "Die Hausaufgabe und das Material findest du in Unterricks."]) {
    const p = claudePresentationPrompt({ ...ctx, klass: head.startsWith("Zu Hause") ? "6B" : "8C" }, "**1) Einstieg**", []);
    assert.ok(p.includes("„" + head + "“"), head);
    assert.deepEqual(codeSlideLines(slideTextLines([piece(head, 100, 300, 44), piece(CODE_SLIDE_LINE, 100, 980, 16)])), [head]);
  }
});

test("Codefolie: Aufforderung bleibt neben einem sehr großen Materialtitel; Fußzeile entfällt an der Seitenhöhe gemessen", () => {
  // 16:9-Folie 540 pt hoch: Fließtext ≥ 24 pt (4,4 %), Fußzeile 10–14 pt
  for (const [instr, title] of [[24, 48], [24, 44], [28, 54], [26, 52], [30, 36]]) {
    const lines = [{ text: "Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", base: 260, h: instr }, { text: "Feibeitsblatt: Die wehrhafte Demokratie", base: 340, h: title },
      { text: "Politik und Wirtschaft · Die wehrhafte Demokratie", base: 525, h: 14 }, { text: CODE_SLIDE_LINE, base: 505, h: 12 }];
    assert.deepEqual(codeSlideLines(lines, 540), ["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", "Feibeitsblatt: Die wehrhafte Demokratie"], instr + "/" + title);
  }
  // in Gerätepixeln (1920 × 1080) gilt dasselbe
  assert.deepEqual(codeSlideLines([{ text: "Lest M1.", base: 500, h: 48 }, { text: "Arbeitsblatt: Karikatur", base: 680, h: 108 }, { text: "Seite 4", base: 1050, h: 24 }, { text: CODE_SLIDE_MARK, base: 1020, h: 24 }], 1080),
    ["Lest M1.", "Arbeitsblatt: Karikatur"]);
});

test("Codefolie: Schatten (doppelt gezeichnet), gesperrte Schrift, „QR-Code“ in der Aufforderung", () => {
  const twice = [{ text: "Bearbeitet die Aufgaben.", base: 300, h: 40 }, { text: "Bearbeitet die Aufgaben.", base: 302, h: 40 }, { text: "Feibeitsblatt: X", base: 380, h: 48 }, { text: "Feibeitsblatt: X", base: 383, h: 48 }, { text: CODE_SLIDE_MARK, base: 520, h: 12 }];
  assert.deepEqual(codeSlideLines(twice, 540), ["Bearbeitet die Aufgaben.", "Feibeitsblatt: X"], "Schatten nur einmal");
  assert.deepEqual(codeSlideLines([{ text: "B E A R B E I T E T  I N  P A R T N E R A R B E I T", base: 300, h: 40 }, { text: "F E I B E I T S B L A T T", base: 380, h: 48 }, { text: CODE_SLIDE_MARK, base: 520, h: 12 }], 540),
    ["BEARBEITET IN PARTNERARBEIT", "F E I B E I T S B L A T T"], "gesperrt: mit Wortlücken zusammengezogen, sonst bleibt die Sperrung – nie verworfen");
  assert.deepEqual(codeSlideLines([{ text: "Scannt den QR-Code und bearbeitet die Aufgaben 1 bis 3.", base: 300, h: 30 }, { text: "Gebt den Sitzungscode ein.", base: 340, h: 30 },
    { text: "Unterricks-Codefolie: Hier zeigt Unterricks den QR-Code und", base: 505, h: 12 }, { text: "den Sitzungscode.", base: 522, h: 12 }], 540),
    ["Scannt den QR-Code und bearbeitet die Aufgaben 1 bis 3.", "Gebt den Sitzungscode ein."], "nur Stücke des festen Erklärsatzes entfallen");
});

test("Codefolie: umbrochene Zeilen werden wieder eine; ohne Überschrift wird keine Fußzeile zur Überschrift", () => {
  const M = { text: CODE_SLIDE_LINE, base: 505, h: 12 };
  assert.deepEqual(codeSlideLines([{ text: "Feibeitsblatt: Die wehrhafte", base: 300, h: 48 }, { text: "Demokratie", base: 358, h: 48 }, { text: "Bearbeitet die Aufgaben 1", base: 180, h: 26 },
    { text: "bis 3.", base: 212, h: 26 }, M], 540), ["Bearbeitet die Aufgaben 1 bis 3.", "Feibeitsblatt: Die wehrhafte Demokratie"]);
  assert.deepEqual(codeSlideLines([{ text: "Bearbeitet die Aufgaben 1 bis 3.", base: 300, h: 40 }, { text: "Feibeitsblatt: X", base: 345, h: 40 }, M], 540),
    ["Bearbeitet die Aufgaben 1 bis 3.", "Feibeitsblatt: X"], "nach einem Satzende kein Zusammenfügen");
  assert.deepEqual(codeSlideLines([{ text: "3) Partnerarbeit 20 min", base: 40, h: 28 }, { text: "Arbeitsblatt: Karikatur", base: 300, h: 48 }, M], 540),
    ["3) Partnerarbeit 20 min", "Arbeitsblatt: Karikatur"], "weit auseinander: zwei Zeilen");
  assert.deepEqual(codeSlideLines([{ text: "Politik und Wirtschaft · Die wehrhafte Demokratie 4", base: 525, h: 11 }, M], 540), [], "nur Fußzeile und Marke: Codefolie ohne Überschrift");
});

test("Präsentationsmodus: Vorschau der nächsten Folie (Codefolie, Platzhalter, eingeblendeter Sitzungscode, Ende)", async () => {
  const { nextSlideOf, nextSlideLabel } = await import("../../public/shared.js");
  const holders = new Map([[3, ["Arbeitsauftrag"]]]);
  const nx = (cur, peek = false, withCode = true) => nextSlideOf({ cur, n: 4, peek, holders, withCode });
  assert.deepEqual(nx(0), { k: 1, back: false, code: false, end: false }, "nach der Codefolie vor Folie 1 kommt Folie 1");
  assert.deepEqual(nx(2), { k: 3, back: false, code: true, end: false }, "Platzhalterfolie erscheint als Codefolie");
  assert.deepEqual(nx(4), { k: null, back: false, code: false, end: true }, "nach der letzten Folie kommt nichts mehr");
  assert.deepEqual(nx(2, true), { k: 2, back: true, code: false, end: false }, "eingeblendeter Sitzungscode: zurück zur Folie darunter");
  assert.deepEqual(nx(3, true), { k: 3, back: true, code: true, end: false });
  assert.deepEqual(nx(2, false, false), { k: 3, back: false, code: false, end: false }, "ohne Sitzungscode keine Codefolien");
  assert.deepEqual(nextSlideOf({ cur: 1, n: 2, holders: [2], withCode: true }), { k: 2, back: false, code: true, end: false }, "holders auch als Array");
  assert.equal(nextSlideLabel(nx(0), 4), "Folie 1 / 4");
  assert.equal(nextSlideLabel(nx(2), 4), "Folie 3 / 4 · Codefolie");
  assert.equal(nextSlideLabel(nx(2, true), 4), "Zurück zu Folie 2 / 4");
  assert.equal(nextSlideLabel(nx(4), 4), "Ende der Präsentation");
});

test("Beamerfenster: folgt dem zuletzt gestarteten Präsentationsfenster, ein beendetes gibt es frei", async () => {
  const { beamerFollow } = await import("../../public/shared.js");
  const A = "a".repeat(16), B = "b".repeat(16);
  let st = beamerFollow(null, { t: "claim", id: A, at: 100 });
  assert.deepEqual(st, { id: A, at: 100, ended: false });
  assert.equal(beamerFollow(st, { t: "show", id: B, at: 50 }), st, "älteres Fenster übernimmt nicht");
  assert.equal(beamerFollow(st, { t: "end", id: B }), st, "Ende eines anderen Fensters ändert nichts");
  assert.deepEqual(beamerFollow(st, { t: "claim", id: A, at: 300 }), { id: A, at: 300, ended: false }, "dasselbe Fenster beansprucht neu");
  st = beamerFollow(st, { t: "claim", id: B, at: 200 });
  assert.equal(st.id, B, "neueres Fenster gewinnt");
  st = beamerFollow(st, { t: "end", id: B });
  assert.deepEqual(st, { id: B, at: 200, ended: true });
  assert.equal(beamerFollow(st, { t: "end", id: B }), st, "zweites Ende: unverändert");
  assert.equal(beamerFollow(st, { t: "show", id: B, at: 900 }), st, "beendetes Fenster kommt mit einer Folie nicht zurück");
  assert.equal(beamerFollow(st, { t: "claim", id: B, at: 200 }), st, "… und nicht mit einem alten Anspruch");
  assert.deepEqual(beamerFollow(st, { t: "claim", id: B, at: 900 }), { id: B, at: 900, ended: false }, "… aber mit einem neuen (aus dem Verlauf zurück)");
  assert.deepEqual(beamerFollow(st, { t: "claim", id: A, at: 10 }), { id: A, at: 10, ended: false }, "nach dem Ende übernimmt jedes Fenster");
  for (const bad of [null, "x", { t: "claim", id: "zz", at: 1 }, { t: "claim", id: A }, { t: "claim", id: A, at: "x" }, { t: "cmd", id: A, at: 5 }])
    assert.equal(beamerFollow(null, bad), null, "ungültig: " + JSON.stringify(bad));
  assert.equal(beamerFollow({ id: A, at: 5, ended: false }, { t: "claim", id: B, at: 5 }).id, B, "Gleichstand: feste Reihenfolge");
});

test("Beamerfenster: Ansicht nur mit Folienbildern vom Server und Codefolie als Text", async () => {
  const { cleanBeamerView } = await import("../../public/shared.js");
  const base = "https://unterricks.example.workers.dev/api/slide/";
  const src = base + "0123456789abcdef/2?e=1&s=abc%2B";
  assert.deepEqual(cleanBeamerView({ kind: "img", src, next: base + "0123456789abcdef/3?e=1&s=x", extra: 1 }, base), { kind: "img", src, next: base + "0123456789abcdef/3?e=1&s=x" });
  assert.deepEqual(cleanBeamerView({ kind: "img", src, next: "https://evil.example/x.jpg" }, base), { kind: "img", src, next: null });
  for (const bad of ["https://evil.example/api/slide/1", "javascript:alert(1)", base + "x\" onerror=\"", 5, null])
    assert.equal(cleanBeamerView({ kind: "img", src: bad }, base), null);
  assert.deepEqual(cleanBeamerView({ kind: "code", code: "ABC234", title: "  Die\u0000 Wahl  ", lines: ["Arbeitsauftrag", 7, "", "M1", "a", "b", "c"] }, base),
    { kind: "code", code: "ABC234", title: "Die Wahl", lines: ["Arbeitsauftrag", "M1", "a", "b"] });
  assert.equal(cleanBeamerView({ kind: "code", code: "ABC-234" }, base), null, "nur gültige Codes");
  assert.equal(cleanBeamerView({ kind: "html", html: "<b>x</b>" }, base), null);
  assert.equal(cleanBeamerView({ kind: "img", src }, ""), null);
});

test("Präsentationsmodus: Tasten (auch Presenter) – Buchstaben nur ohne Strg/Cmd/Alt", async () => {
  const { presenterKey } = await import("../../public/shared.js");
  const k = (key, o = {}) => presenterKey({ key, ...o });
  for (const key of ["ArrowRight", "ArrowDown", "PageDown", " ", "Enter", "n", "N"]) assert.equal(k(key), "next", key);
  for (const key of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace", "p"]) assert.equal(k(key), "prev", key);
  assert.equal(k("Home"), "first"); assert.equal(k("End"), "last");
  assert.equal(k("f"), "fs"); assert.equal(k("c"), "code"); assert.equal(k("V"), "preview");
  assert.equal(k("c", { repeat: true }), null); assert.equal(k("v", { repeat: true }), null);
  assert.equal(k("p", { ctrlKey: true }), null, "Strg+P druckt"); assert.equal(k("c", { metaKey: true }), null, "Cmd+C kopiert"); assert.equal(k("f", { altKey: true }), null);
  assert.equal(k("x"), null); assert.equal(k("Escape"), null); assert.equal(presenterKey(null), null);
  // auf einem Knopf: Enter und Leertaste lösen ihn aus (Tastatur), alle anderen Tasten blättern weiter
  assert.equal(presenterKey({ key: "Enter" }, true), null); assert.equal(presenterKey({ key: " " }, true), null);
  assert.equal(presenterKey({ key: "PageDown" }, true), "next"); assert.equal(presenterKey({ key: "ArrowLeft" }, true), "prev");
});

test("Beamerfenster: Bildschirm für „Vollbild auf dem Beamer“", async () => {
  const { beamerScreen } = await import("../../public/shared.js");
  const lap = { isInternal: true, isPrimary: true }, ext = { isInternal: false, isPrimary: false };
  assert.equal(beamerScreen({ screens: [lap, ext], currentScreen: lap }), ext, "vom Laptop auf den Beamer");
  assert.equal(beamerScreen({ screens: [lap, ext], currentScreen: ext }), null, "schon auf dem Beamer: Vollbild hier");
  assert.equal(beamerScreen({ screens: [lap], currentScreen: lap }), null, "nur ein Bildschirm");
  const m1 = { isPrimary: true }, m2 = { isPrimary: false };
  assert.equal(beamerScreen({ screens: [m1, m2], currentScreen: m1 }), m2, "zwei Monitore ohne Angabe: vom Hauptbildschirm weg");
  assert.equal(beamerScreen({ screens: [m1, m2], currentScreen: m2 }), null);
  assert.equal(beamerScreen(null), null); assert.equal(beamerScreen({ screens: [lap, ext] }), null);
});
