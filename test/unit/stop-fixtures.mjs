// Feste Sitzungen für die Prompt-Tests zum Zwischenstopp (Anforderung 13) – keine *.test-Datei. Ohne Zwischenstopp müssen die Prompts
// byte-gleich zum Stand vor S11 bleiben (SHA-256 in zwischenstopp.test.mjs, erzeugt mit dem Code vor der Änderung).
export function sekCtx(unitContext) {
  const unit = { id: "fedcba9876543210", title: "Gewaltenteilung", params: { start: "2026-11-02", end: "2026-11-26", weekdays: [{ day: 2, minutes: 90, time: "08:00" }, { day: 4, minutes: 45, time: "10:00" }],
      breaks: [{ from: "2026-12-01", to: "2026-12-04", label: "Projektwoche" }] },
    plan: { lernaufgabe: "Positionspapier schreiben", schritte: [{ titel: "Problem erschließen", beschreibung: "Karikatur" }, { titel: "Urteilen", beschreibung: "Positionen" }] },
    rows: [{ uid: "a0a0a0a0", stundenfrage: "Was ist Macht?", ablauf: ["Einstieg Karikatur", "Text M1"], schritt: 0, date: "2026-11-10", minutes: 90, time: "08:00" },
      { uid: "b1b1b1b1", stundenfrage: "Wer kontrolliert die Macht?", ablauf: ["Rollenspiel"], schritt: 0, date: "2026-11-12", minutes: 45, time: "10:00" },
      { uid: "c2c2c2c2", stundenfrage: "Ist das Gericht zu mächtig?", ablauf: ["Diskussion"], schritt: 1, date: "2026-11-17", minutes: 90, time: "08:00" }] };
  return { lessonId: "0123456789abcdef", subject: "powi", klass: "Q2-GK", unit, row: unit.rows[1], unitText: unitContext(unit, "b1b1b1b1"), classSize: 24,
    lesson: { title: "Wer kontrolliert die Macht?", topic: "Gewaltenteilung", durationMin: 45, date: "2026-11-12", startTime: "10:00", ideas: "Mit Karikatur einsteigen", homework: "" },
    materials: [{ name: "AB Gewaltenteilung", area: "student", kind: "text", text: "Langtext" }], sheets: [], portal: "",
    messages: [{ role: "user", content: "Bitte mit Rollenspiel" }, { role: "assistant", content: "Vorschlag: Rollenspiel …", model: "mock" }], previousStop: null };
}
export function gsCtx(unitContext) {
  const course = { short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)", gradeText: "Jahrgangsstufe 2 der Grundschule", subjectName: "Religion", description: "Bibel" };
  const unit = { id: "1".repeat(16), title: "Josef", params: { start: "2026-11-02", end: "2026-11-19", weekdays: [{ day: 2, minutes: 45, time: "08:00" }, { day: 4, minutes: 45, time: "08:00" }], breaks: [] },
    plan: { lernaufgabe: "Bodenbild" }, rows: [{ uid: "aaaaaaaa", stundenfrage: "Josef und seine Brüder", ablauf: ["Erzählung"], date: "2026-11-10", time: "08:00", minutes: 45 },
      { uid: "bbbbbbbb", stundenfrage: "Josef in Ägypten", ablauf: ["Bildkarten"], date: "2026-11-12", time: "08:00", minutes: 45 }] };
  return { lessonId: "f".repeat(16), subject: "gs", klass: "gs12345678", course, classSize: 22, lesson: { title: "Josef in Ägypten", durationMin: 45, date: "2026-11-12", startTime: "08:00", homework: "" },
    materials: [{ id: "2".repeat(16), name: "Arbeitsblatt.pdf", area: "student", kind: "file", mime: "application/pdf" }], unit, row: unit.rows[1], unitText: unitContext(unit, "bbbbbbbb"), previousStop: null };
}
