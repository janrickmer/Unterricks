// Druckliste: Umrechnung auf A4, Dateinamen, ZIP-Datei für „Alle herunterladen“
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { toA4, isA4Size, A4 } from "../../public/a4.js";
import { makeZip, readZip, crc32, uniqueNames } from "../../public/zip.js";
import { printFileName, printBase, cleanCopies, printCourse, PRINT_SUBJECT_SHORT, CLASS_GROUPS, COURSE_CLASSES, ALL_CLASSES, isValidClass, gradeKey, classShort, groupShort, GS_SUBJECT, normalizeGsCourse } from "../../public/shared.js";

async function pdfWith(sizes, rotate = {}) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
  sizes.forEach(([w, h], i) => { const p = d.addPage([w, h]); p.drawText("Seite " + (i + 1), { x: 40, y: 40, size: 24, font: f }); if (rotate[i]) p.setRotation(degrees(rotate[i])); });
  return d.save();
}
const sizesOf = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);

test("A4: A4-Seiten bleiben unverändert, andere Formate werden auf A4 skaliert (Hoch- bzw. Querformat wie die Seite)", async () => {
  const onlyA4 = await pdfWith([[595.28, 841.89], [841.89, 595.28]]);
  const r0 = await toA4(onlyA4, { PDFDocument, degrees });
  assert.equal(r0.changed, 0); assert.equal(r0.bytes, onlyA4, "keine Änderung, dieselben Bytes");
  const mixed = await pdfWith([[595.28, 841.89], [612, 792], [960, 540], [420, 595]]);   // A4, US Letter, Folie 16:9, A5
  const r = await toA4(mixed, { PDFDocument, degrees });
  assert.equal(r.changed, 3); assert.equal(r.total, 4);
  assert.deepEqual(await sizesOf(r.bytes), [[595, 842], [595, 842], [842, 595], [595, 842]]);
  // Seite mit /Rotate 90 (angezeigt quer) → A4 quer
  const rot = await toA4(await pdfWith([[612, 792]], { 0: 90 }), { PDFDocument, degrees });
  assert.deepEqual(await sizesOf(rot.bytes), [[842, 595]]);
  assert.ok(isA4Size(A4.w, A4.h) && isA4Size(842, 595) && !isA4Size(612, 792));
  await assert.rejects(toA4(new Uint8Array([1, 2, 3]), { PDFDocument, degrees }), /nicht lesen/);
});

// Nachtrag 32 (16.11.2026): neue Reihenfolge (schwarz-weiß/farbig vor einseitig/beidseitig), „farbig“ statt „Farbe“, Kurs vor dem Titel – geänderte Erwartung
test("Dateiname der Druckvorlage (Nachtrag 32): „23x - sw - einseitig - Reli4 - Titel.pdf“, ohne verbotene Zeichen; ohne Kurs ohne diesen Teil; Anzahl 1–500", () => {
  // die drei Beispiele der Lehrkraft wörtlich
  assert.equal(printFileName({ name: "Die Arche Noah.pdf", copies: 23, duplex: false, color: false, course: "Reli4" }), "23x - sw - einseitig - Reli4 - Die Arche Noah.pdf");
  assert.equal(printFileName({ name: "Bildkarten Arche Noah", copies: 1, duplex: false, color: true, course: "Reli2" }), "1x - farbig - einseitig - Reli2 - Bildkarten Arche Noah.pdf");
  assert.equal(printFileName({ name: "Konzentrationsaufgabe – Schöpfung.pdf", copies: 5, duplex: true, color: false, course: "Reli2" }), "5x - sw - beidseitig - Reli2 - Konzentrationsaufgabe – Schöpfung.pdf");
  assert.equal(printFileName({ name: "AB Gewaltenteilung.pdf", copies: 28, duplex: true, color: false, course: printCourse("powi", "8A") }), "28x - sw - beidseitig - PoWi8 - AB Gewaltenteilung.pdf");
  assert.equal(printFileName({ name: "Karte: Europa/Welt?", copies: 2, duplex: false, color: true, course: "PoWiQ3LK" }), "2x - farbig - einseitig - PoWiQ3LK - Karte Europa Welt.pdf");
  // ohne Kurs (unbekannt): der Teil fällt weg; der Kurs selbst bekommt keine unzulässigen Zeichen
  assert.equal(printFileName({ name: "AB.pdf", copies: 3, duplex: true, color: false }), "3x - sw - beidseitig - AB.pdf");
  assert.equal(printFileName({ name: "AB.pdf", copies: 3, duplex: true, color: false, course: "" }), "3x - sw - beidseitig - AB.pdf");
  assert.equal(printFileName({ name: "AB.pdf", copies: 3, duplex: true, color: false, course: "Re/li: 4?" }), "3x - sw - beidseitig - Reli4 - AB.pdf");
  assert.equal(printFileName({ name: "", copies: 0, duplex: false, color: false, course: "Eth9" }), "1x - sw - einseitig - Eth9 - Druckvorlage.pdf");
  assert.equal(printBase(""), "Druckvorlage");
  assert.equal(cleanCopies("28"), 28); assert.equal(cleanCopies(0), null); assert.equal(cleanCopies(501), null); assert.equal(cleanCopies(2.5), null);
});

test("Kurs im Dateinamen (printCourse, Nachtrag 32): jedes Klassenformat des Gymnasiums in allen drei Fächern, Grundschulkurse, Unbekanntes leer", () => {
  assert.deepEqual(PRINT_SUBJECT_SHORT, { powi: "PoWi", evrel: "Reli", ethik: "Eth" });
  // alle Klassen und Kurse (isValidClass): Sek. I „5A“–„10H“, E-Phase „EA“–„EH“, Q-Phase „Q1-GK“–„Q4-LK“, Kurse „5-K“–„10-K“ und „E-K“
  const expect = (k) => { if (/^Q[1-4]-(GK|LK)$/.test(k)) return k.replace("-", ""); if (k === "E-K" || /^E[A-H]$/.test(k)) return "E"; return String(parseInt(k, 10)); };
  let n = 0;
  for (const g of CLASS_GROUPS) for (const k of g.classes) for (const [subj, short] of Object.entries(PRINT_SUBJECT_SHORT)) { assert.equal(printCourse(subj, k), short + expect(k), subj + " " + k); n++; }
  for (const k of COURSE_CLASSES) for (const [subj, short] of Object.entries(PRINT_SUBJECT_SHORT)) { assert.equal(printCourse(subj, k), short + expect(k), subj + " " + k); n++; }
  assert.equal(n, ALL_CLASSES.length * 3, "jede Klasse aus ALL_CLASSES geprüft");
  for (const k of ALL_CLASSES) assert.ok(isValidClass(k) && /^(PoWi|Reli|Eth)(\d{1,2}|E|Q[1-4](GK|LK))$/.test(printCourse("powi", k).replace(/^PoWi/, "Reli")), k);
  // Beispiele der Lehrkraft und Randfälle
  assert.deepEqual(["8A", "8-K", "EA", "E-K", "Q3-LK", "Q1-GK", "10H", "10-K", "5-K"].map((k) => printCourse("powi", k)), ["PoWi8", "PoWi8", "PoWiE", "PoWiE", "PoWiQ3LK", "PoWiQ1GK", "PoWi10", "PoWi10", "PoWi5"]);
  assert.deepEqual([printCourse("evrel", "8-K"), printCourse("ethik", "8-K"), printCourse("evrel", "E-K"), printCourse("evrel", "Q1-GK"), printCourse("ethik", "Q4-LK")], ["Reli8", "Eth8", "ReliE", "ReliQ1GK", "EthQ4LK"]);
  assert.equal(gradeKey("8-K"), "8"); assert.equal(classShort("Q3-LK"), "Q3 LK"); assert.equal(groupShort("E-K"), "E-Phase");   // die Formate, aus denen printCourse liest
  for (const [s, k] of [["powi", "8a"], ["powi", "11A"], ["powi", "Q5-LK"], ["powi", ""], ["powi", null], ["mathe", "8A"], ["", "8A"], ["gs", "8A"]]) assert.equal(printCourse(s, k), "", s + " " + k);
  // Grundschule: Kurs aus gsCourseOut (religion true/false, subjectName) oder als Zeile aus gs_courses (religion 1/0, subject_name)
  const gs = (o) => printCourse(GS_SUBJECT, "gs12345678", o);
  assert.equal(gs({ grade: 4, religion: true, subjectName: "Religion" }), "Reli4");
  assert.equal(gs({ grade: 2, religion: 1, subject_name: "Religion" }), "Reli2");
  assert.equal(gs({ grade: 1, religion: true, subjectName: "Sachunterricht" }), "Reli1", "Religion bleibt „Reli“");
  assert.equal(gs({ grade: 3, religion: false, subjectName: "Sachunterricht" }), "Sach3");
  assert.equal(gs({ grade: 3, religion: 0, subject_name: "Sachunterricht" }), "Sach3");
  assert.equal(gs({ grade: 2, religion: false, subjectName: "Ästhetische Erziehung" }), "Äst" + "h2", "Umlaut bleibt");
  assert.equal(gs({ grade: 2, religion: false, subjectName: "A\u0308rger" }), "Ärge2", "zerlegter Umlaut (NFD) zählt als ein Buchstabe");
  assert.equal(gs({ grade: 4, religion: false, subjectName: "musik" }), "Musi4", "erster Buchstabe groß");
  assert.equal(gs({ grade: 4, religion: false, subjectName: "DaZ" }), "DaZ4", "weniger als 4 Buchstaben: alle, sonst unverändert");
  assert.equal(gs({ grade: 4, religion: false, subjectName: "Mu" }), "Mu4");
  assert.equal(gs({ grade: 1, religion: false, subjectName: "Kunst & Werken" }), "Kuns1");
  assert.equal(gs({ grade: 1, religion: false, subjectName: "1. Fremd-sprache" }), "Frem1", "nur Buchstaben");
  assert.equal(gs({ grade: 3, religion: false, subjectName: "2 + 3 = 5" }), "Fach3", "ohne Buchstaben: „Fach“");
  assert.equal(gs({ grade: 3, religion: false, subjectName: "" }), "Fach3");
  assert.equal(gs({ grade: 3, religion: false }), "Fach3");
  assert.equal(gs(null), "", "ohne Kurs kein Kurs im Namen");
  assert.equal(gs({ grade: 5, religion: true }), "", "Jahrgang außerhalb 1–4");
  assert.equal(gs({ grade: "3", religion: "1" }), "Reli3", "Zahlen als Text (JSON aus D1)");
  // Kurs aus gsCourseOut (wie Oberfläche, Druckaufträge und get_lesson ihn bekommen)
  const c = normalizeGsCourse({ grade: 3, classes: ["a", "b"], religion: false, subjectName: "Sachunterricht" });
  assert.equal(printCourse(GS_SUBJECT, "gs12345678", c), "Sach3");
});

test("ZIP: Namen in UTF-8 und eindeutig, Inhalt unverändert (Prüfsumme wie zlib), wieder lesbar", async () => {
  const a = new TextEncoder().encode("%PDF-1.4 Erste"), b = new Uint8Array(70000).map((_, i) => i % 251);
  const zip = makeZip([{ name: "28x - sw - beidseitig - PoWi8 - Größe.pdf", data: a }, { name: "28x - sw - beidseitig - PoWi8 - Größe.pdf", data: b }]);
  assert.equal(crc32(a), zlib.crc32(a)); assert.equal(crc32(b), zlib.crc32(b));
  const back = await readZip(zip);
  assert.deepEqual(back.map((x) => x.name), ["28x - sw - beidseitig - PoWi8 - Größe.pdf", "28x - sw - beidseitig - PoWi8 - Größe (2).pdf"], "zwei Dateien desselben Kurses und Titels: nichts wird überschrieben");
  assert.deepEqual([...back[0].data], [...a]); assert.equal(back[1].data.length, 70000); assert.equal(zlib.crc32(back[1].data), zlib.crc32(b));
  const dv = new DataView(zip.buffer); assert.equal(dv.getUint32(0, true), 0x04034b50); assert.equal(dv.getUint16(6, true) & 0x0800, 0x0800, "UTF-8-Kennzeichen");
  assert.deepEqual(uniqueNames(["a.pdf", "A.pdf", "a.pdf"]), ["a.pdf", "A (2).pdf", "a (3).pdf"]);
  const withDirs = await readZip(makeZip([{ name: "sitzung.json", data: a }, { name: "dateien/1 - A.pdf", data: a }, { name: "../../böse\\x.pdf", data: a }, { name: "/abs.pdf", data: a }]));
  assert.deepEqual(withDirs.map((x) => x.name), ["sitzung.json", "dateien/1 - A.pdf", "böse/x.pdf", "abs.pdf"], "Ordner bleiben, nie „..“ oder absolute Pfade");
  await assert.rejects(readZip(new Uint8Array(30)), /keine ZIP-Datei/);
});
