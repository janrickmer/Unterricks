import test from "node:test";
import assert from "node:assert/strict";
import {
  SUBJECTS, ALL_CLASSES, isValidClass, gradeInfo, classShort, gradeKey, subjectConfig, classAllowed, classGroupsFor, isAnalogClass, ANALOG_RULE,
  COURSE_CLASSES, isCourseClass, courseMembers, courseOf, classLabel, homeworkForPortal, PUBLIC_URL, groupShort, fmtLongDay, normalizeCode, isValidCode, formatCode, renderPortalEntry, parsePortalMarkup, portalSafe,
  validatePortalData, PORTAL_EXAMPLE, claudePresentationPrompt, QR_UNTERRICKS, planningSystemPrompt, SYSTEM_PROMPT_ROLE, extractJsonObject, normalizeFbDraft,
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

test("Präsentations-Prompt: erste Folie mit Sitzungscode und QR-Code zu Unterricks (genaues Modulmuster)", async () => {
  const p = claudePresentationPrompt({ ...ctx, code: "AEH4VY" }, "**1) Einstieg**", []);
  const first = p.slice(p.indexOf("## Erste Folie"), p.indexOf("## Rahmendaten"));
  assert.ok(first.includes("„AEH-4VY“") && first.includes(PUBLIC_URL) && first.includes("unterricks.janrickmer.de und gib den Sitzungscode ein"));
  assert.ok(first.includes(QR_UNTERRICKS.join("\n")), "das Muster steht vollständig und unverändert im Prompt");
  assert.ok(p.indexOf("## Erste Folie") < p.indexOf("## Anforderungen") && p.includes("Folie 1 wie oben (Sitzungscode und QR-Code)"));
  // dasselbe Muster wie qrMatrix(PUBLIC_URL) bzw. die Beamer-Folie public/qr-unterricks.svg
  const { qrMatrix } = await import("../../public/fbanalog.js");
  const q = qrMatrix(PUBLIC_URL);
  assert.equal(QR_UNTERRICKS.length, q.size);
  assert.deepEqual(QR_UNTERRICKS, Array.from({ length: q.size }, (_, y) => Array.from({ length: q.size }, (_, x) => (q.dark[y * q.size + x] ? "1" : "0")).join("")));
  const noCode = claudePresentationPrompt(ctx, "**1) Einstieg**", []);
  assert.ok(noCode.includes("bitte bei der Lehrkraft erfragen"), "ohne Code: Hinweis statt leerer Angabe");
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
