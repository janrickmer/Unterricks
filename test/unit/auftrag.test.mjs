// Auftrag an die KI (keine Musterlösung) und altersgemäße Erwartung je Jahrgang (Wunsch der Lehrkraft vom 10.11.2026)
import test from "node:test";
import assert from "node:assert/strict";
import { ageExpectation, withAgeExpectation, kiAuftragText, looksLikeSolution, AGE_MARK, KI_AUFTRAG_MAX, normalizeFbDraft, FEIBEITSBLATT_INFO, feibeitsblattMessages, gradeInfo, ALL_CLASSES } from "../../public/shared.js";

const count = (s) => s.split(AGE_MARK).length - 1;

test("altersgemäße Erwartung je Lerngruppe – nur Anspruchsniveau, keine zusätzliche Anforderung", () => {
  const j7 = ageExpectation("7B");
  assert.ok(j7.startsWith(AGE_MARK + " (Jahrgangsstufe 7)") && j7.includes("12 bis 13 Jahre") && j7.includes("keine vollständige, fachlich ausdifferenzierte Lösung"));
  assert.ok(ageExpectation("8-K").includes("Jahrgangsstufe 8") && ageExpectation("8-K").includes("13 bis 14"), "Kurse über mehrere Klassen: Jahrgang des Kurses");
  assert.ok(ageExpectation("9A").includes("14 bis 15") && ageExpectation("10C").includes("keine Maßstäbe der Oberstufe"));
  assert.ok(ageExpectation("EA").includes("Einführungsphase") && ageExpectation("EA").includes("noch nicht der Maßstab"));
  assert.ok(ageExpectation("Q2-GK").includes("Grundkurs") && ageExpectation("Q2-GK").includes("grundlegende Niveau"));
  assert.ok(ageExpectation("Q3-LK").includes("Leistungskurs") && ageExpectation("Q3-LK").includes("erhöhte Niveau"));
  for (const k of ALL_CLASSES) { const a = ageExpectation(k); assert.ok(a.includes("keine zusätzliche Anforderung") && a.includes("was Aufgabe und Operator verlangen"), k); }
  assert.ok(!/gern mit einem Beispiel|Erwarte zusammenhängende/.test(ageExpectation("7B") + ageExpectation("9A")), "keine Forderungen unabhängig vom Operator");
  assert.equal(ageExpectation("unbekannt"), "");
});

test("Auftrag bekommt genau einen passenden Absatz; leer bzw. nur der Absatz bleibt leer (= kein KI-Feedback)", () => {
  const a = withAgeExpectation("Achte darauf, ob zwei Aufgaben des BVerfG genannt werden.", "7B");
  assert.ok(a.startsWith("Achte darauf") && a.endsWith(ageExpectation("7B")) && count(a) === 1);
  assert.equal(withAgeExpectation(a, "7B"), a, "idempotent");
  const lk = withAgeExpectation(withAgeExpectation("Achte auf X.", "Q1-GK"), "Q1-LK");
  assert.ok(lk.includes("(Q1, Leistungskurs)") && !lk.includes("Grundkurs") && count(lk) === 1, "automatischer Absatz einer anderen Lerngruppe wird ersetzt (z. B. Sitzungsdatei GK → LK)");
  const own = "Achte auf X.\n\n" + AGE_MARK + " (selbst): kurze Antworten genügen.";
  assert.equal(withAgeExpectation(own, "Q3-LK"), own, "von der Lehrkraft geänderter Absatz bleibt");
  assert.equal(withAgeExpectation("", "7B"), ""); assert.equal(withAgeExpectation("  ", "7B"), "");
  assert.equal(withAgeExpectation(ageExpectation("7B"), "7B"), "", "nur der automatische Absatz = leer");
  const long = withAgeExpectation("x".repeat(KI_AUFTRAG_MAX), "7B");
  assert.ok(long.length <= KI_AUFTRAG_MAX && long.endsWith(ageExpectation("7B")), "zu lang: gekürzt wird der Text der Lehrkraft, nie der Absatz");
});

test("Musterlösung → Auftrag, nur bei Entwürfen von KI/Connector; keine falschen Treffer", () => {
  assert.ok(looksLikeSolution("Musterlösung: Legislative, Exekutive, Judikative") && looksLikeSolution("Mögliche Lösung: …") && looksLikeSolution("Antwort: A und B"));
  for (const ok0 of ["Achte darauf, ob die Lösung begründet ist.", "Erwartungshorizont: drei Gewalten", "Lösung – nicht verraten, nur Hinweise geben.", "Antwort-Kriterien: zwei Argumente",
    "Lösung: nicht verraten, nur Tipps geben."]) assert.ok(!looksLikeSolution(ok0), ok0);
  const t = kiAuftragText("Musterlösung: Legislative, Exekutive, Judikative");
  assert.ok(t.startsWith("Achte darauf, ob die Antwort diese Inhalte sinngemäß enthält") && t.endsWith("Legislative, Exekutive, Judikative"));
  assert.equal(kiAuftragText("Antwort-Kriterien: zwei Argumente"), "Antwort-Kriterien: zwei Argumente");
  const ai = normalizeFbDraft({ titel: "T", aufgaben: [{ text: "A", ki_auftrag: "Lösung: X und Y" }, { text: "B", ki_auftrag: "Lösung: geheim", antwort: "foto" }] }, { fromAi: true });
  assert.ok(ai.tasks[0].solution.startsWith("Achte darauf") && ai.tasks[0].solution.includes("X und Y"));
  assert.equal(ai.tasks[1].solution, "", "Fotos nie an die KI");
  const teacher = normalizeFbDraft({ title: "T", tasks: [{ text: "A", solution: "Lösung: so will ich es" }] });
  assert.equal(teacher.tasks[0].solution, "Lösung: so will ich es", "was die Lehrkraft speichert, wird nicht umgeschrieben");
  assert.equal(normalizeFbDraft({ title: "T", tasks: [{ text: "A", solution: "y".repeat(9000) }] }).tasks[0].solution.length, KI_AUFTRAG_MAX);
});

test("Prompts: Auftrag an die KI, keine Musterlösung, Lerngruppe im Kontext", () => {
  assert.ok(FEIBEITSBLATT_INFO.includes("KEINE Musterlösung") && FEIBEITSBLATT_INFO.includes("Jahrgang 7 und 8"));
  const [sys, user] = feibeitsblattMessages({ subject: "powi", klass: "Q3-LK", lesson: { title: "T" } }, "", "");
  assert.ok(sys.content.includes("keine Musterlösung") && sys.content.includes("Achte darauf"));
  assert.ok(user.content.includes(gradeInfo("Q3-LK").text), "die Lerngruppe (hier Leistungskurs) steht im Kontext");
});
