// Unterrickssitzung als Datei: Name, Datumsangaben, Feibeitsblatt → Entwurf, Prüfung fremder Dateien
import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionFileName, adaptDates, sheetToDraft, cleanSessionFile, SESSION_FILE } from "../../public/sessionfile.js";

test("Dateiname: „Unterrickssitzung - Fach - Jahrgang - Einheit - Sitzung Nr. n“", () => {
  assert.equal(sessionFileName({ subject: "powi", klass: "8C", unitTitle: "Gewaltenteilung: Wer kontrolliert wen?", sessionNo: 3 }), "Unterrickssitzung - PoWi - Jg. 8 - Gewaltenteilung Wer kontrolliert wen - Sitzung Nr. 3.zip");
  assert.equal(sessionFileName({ subject: "ethik", klass: "Q2-GK", unitTitle: "Gerechtigkeit", sessionNo: 1 }), "Unterrickssitzung - Ethik - Q2 GK - Gerechtigkeit - Sitzung Nr. 1.zip");
  assert.equal(sessionFileName({ subject: "evrel", klass: "E-K", unitTitle: "", sessionNo: null }), "Unterrickssitzung - Ev. Religion - E-Phase - ohne Einheit - Sitzung Nr. ?.zip");
});

test("Datumsangaben: Datum der Sitzung und der nächsten Sitzung werden ersetzt (Schreibweise und Wochentag passend), andere gemeldet", () => {
  const pairs = [["2026-11-03", "2026-11-11"], ["2026-11-05", "2026-11-13"]];
  const r = adaptDates("Bis Do., 05.11.2026: Text lesen (Stand 03.11.). Abgabe am 5. November 2026, Klausur am 24.12.2026. ISO 2026-11-03. Version 1.2.3 bleibt.", pairs);
  assert.equal(r.text, "Bis Fr., 13.11.2026: Text lesen (Stand 11.11.). Abgabe am 13. November 2026, Klausur am 24.12.2026. ISO 2026-11-11. Version 1.2.3 bleibt.");
  assert.deepEqual(r.unknown, ["24.12.2026"]);
  assert.equal(r.replaced.length, 4);
  assert.equal(adaptDates("Mittwoch, 3. November", pairs).text, "Mittwoch, 11. November");
  assert.equal(adaptDates("am 3.11.26", pairs).text, "am 11.11.26");
  assert.equal(adaptDates("ohne Datum", pairs).text, "ohne Datum");
  assert.equal(adaptDates("05.11.2025 ist ein anderes Jahr", pairs).text, "05.11.2025 ist ein anderes Jahr");
});

test("Feibeitsblatt → Entwurf: Text, Material (fett, Links), Auftrag an die KI, Tabelle und Foto; Weltkarte als Textaufgabe mit Hinweis", () => {
  const { draft, notes } = sheetToDraft({ title: "Gewaltenteilung", tasks: [
    { text: "Erkläre die Gewaltenteilung.", solution: "Legislative, Exekutive, Judikative", material: [[{ t: "Das " }, { t: "Grundgesetz", f: "b" }, { t: " regelt das." }], [{ t: "Quelle", h: "https://www.bpb.de/x" }]], answer: { type: "text" } },
    { text: "Ordne zu.", solution: "", answer: { type: "table", columns: ["Gewalt", "Organ"], rows: 3 } },
    { text: "Fotografiere dein Plakat.", solution: "nie an die KI", answer: { type: "photo" } },
    { text: "Wo liegt Karlsruhe?", answer: { type: "map", items: [] }, images: [{ id: "x" }] }] });
  assert.equal(draft.title, "Gewaltenteilung");
  assert.equal(draft.tasks[0].material, "Das **Grundgesetz** regelt das.\n[Quelle](https://www.bpb.de/x)", "Links als [Linktext](Adresse) – beim erneuten Anlegen wieder anklickbar (Nr. 17)");
  assert.equal(draft.tasks[0].solution, "Legislative, Exekutive, Judikative");
  assert.deepEqual(draft.tasks[1].answer, { type: "table", columns: ["Gewalt", "Organ"], rows: 3 });
  assert.deepEqual(draft.tasks[2].answer, { type: "photo" }); assert.equal(draft.tasks[2].solution, "", "Fotos nie an die KI");
  assert.deepEqual(draft.tasks[3].answer, { type: "text" });
  assert.ok(notes.some((n) => /Weltkarte/.test(n)) && notes.some((n) => /Bilder/.test(n)));
});

test("Datei prüfen: nur Unterrickssitzungen, Bereiche und Druckangaben bereinigt, unsichere Links verworfen", () => {
  assert.throws(() => cleanSessionFile({ kind: "etwas-anderes" }), /keine Unterrickssitzung/);
  assert.throws(() => cleanSessionFile({ kind: SESSION_FILE.kind, v: 2 }), /neueren Fassung/);
  const d = cleanSessionFile({ kind: SESSION_FILE.kind, v: 1, source: { subject: "powi", klass: "8C", date: "2026-11-03", startTime: "7:45", sessionNo: 2 }, lesson: { title: "T", homework: "H" },
    chat: [{ role: "user", content: "Hallo" }, { role: "system", content: "x" }, { role: "assistant", content: " " }],
    files: [{ area: "print", kind: "file", name: "A.pdf", path: "dateien/1 - A.pdf", print: { copies: 900, duplex: false, color: true } }, { area: "student", kind: "link", name: "X", url: "javascript:alert(1)" },
      { area: "geheim", kind: "text", name: "T", text: "Inhalt" }, { area: "presentation", kind: "text", name: "P", text: "x" }],
    drafts: [{ title: "Entwurf", tasks: [{ text: "Aufgabe" }] }, { tasks: [] }], sheets: [{ code: "ABC234", title: "Blatt" }, { code: "x", title: "kaputt" }] });
  assert.equal(d.source.startTime, null, "nur HH:MM"); assert.equal(d.source.sessionNo, 2);
  assert.deepEqual(d.chat.map((m) => m.role), ["user"]);
  assert.deepEqual(d.files.map((f) => f.area + ":" + f.kind), ["print:file", "student:text"]);
  assert.deepEqual(d.files[0].print, { copies: 1, duplex: false, color: true });
  assert.equal(d.drafts.length, 1); assert.deepEqual(d.sheets.map((s) => s.code), ["ABC234"]);
});

test("Sitzungsdatei: gestaltetes Material (Claude, HTML → PDF) mit und ohne gedruckte PDF; Präsentation nie als Gestaltung", () => {
  const d = cleanSessionFile({ kind: "unterricks-sitzung", v: 1, source: {}, lesson: {}, files: [
    { area: "student", kind: "file", name: "AB.pdf", mime: "application/pdf", path: "dateien/1 - AB.pdf", design: "gestaltung/1 - AB.html", rendered: true },
    { area: "print", kind: "file", name: "Kärtchen.pdf", mime: "application/pdf", design: "gestaltung/2 - Kärtchen.html", rendered: true, print: { copies: 28, duplex: false } },
    { area: "presentation", kind: "file", name: "P.pdf", design: "gestaltung/3 - P.html" },
    { area: "teacher", kind: "file", name: "ohne alles" },
  ] });
  assert.equal(d.files.length, 2);
  assert.deepEqual(d.files[0], { area: "student", kind: "file", name: "AB.pdf", mime: "application/pdf", path: "dateien/1 - AB.pdf", design: "gestaltung/1 - AB.html", rendered: true });
  assert.equal(d.files[1].path, ""); assert.equal(d.files[1].rendered, false, "ohne PDF nie „gedruckt“");
  assert.deepEqual(d.files[1].print, { copies: 28, duplex: false, color: false });
});
