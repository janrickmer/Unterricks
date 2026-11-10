// Druckliste: Umrechnung auf A4, Dateinamen, ZIP-Datei für „Alle herunterladen“
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { toA4, isA4Size, A4 } from "../../public/a4.js";
import { makeZip, readZip, crc32, uniqueNames } from "../../public/zip.js";
import { printFileName, printBase, cleanCopies } from "../../public/shared.js";

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

test("Dateiname der Druckvorlage: „28x - beidseitig - sw - Name.pdf“, ohne verbotene Zeichen; Anzahl 1–500", () => {
  assert.equal(printFileName({ name: "AB Gewaltenteilung.pdf", copies: 28, duplex: true, color: false }), "28x - beidseitig - sw - AB Gewaltenteilung.pdf");
  assert.equal(printFileName({ name: "Karte: Europa/Welt?", copies: 2, duplex: false, color: true }), "2x - einseitig - Farbe - Karte Europa Welt.pdf");
  assert.equal(printBase(""), "Druckvorlage");
  assert.equal(cleanCopies("28"), 28); assert.equal(cleanCopies(0), null); assert.equal(cleanCopies(501), null); assert.equal(cleanCopies(2.5), null);
});

test("ZIP: Namen in UTF-8 und eindeutig, Inhalt unverändert (Prüfsumme wie zlib), wieder lesbar", async () => {
  const a = new TextEncoder().encode("%PDF-1.4 Erste"), b = new Uint8Array(70000).map((_, i) => i % 251);
  const zip = makeZip([{ name: "28x - beidseitig - sw - Größe.pdf", data: a }, { name: "28x - beidseitig - sw - Größe.pdf", data: b }]);
  assert.equal(crc32(a), zlib.crc32(a)); assert.equal(crc32(b), zlib.crc32(b));
  const back = await readZip(zip);
  assert.deepEqual(back.map((x) => x.name), ["28x - beidseitig - sw - Größe.pdf", "28x - beidseitig - sw - Größe (2).pdf"]);
  assert.deepEqual([...back[0].data], [...a]); assert.equal(back[1].data.length, 70000); assert.equal(zlib.crc32(back[1].data), zlib.crc32(b));
  const dv = new DataView(zip.buffer); assert.equal(dv.getUint32(0, true), 0x04034b50); assert.equal(dv.getUint16(6, true) & 0x0800, 0x0800, "UTF-8-Kennzeichen");
  assert.deepEqual(uniqueNames(["a.pdf", "A.pdf", "a.pdf"]), ["a.pdf", "A (2).pdf", "a (3).pdf"]);
  const withDirs = await readZip(makeZip([{ name: "sitzung.json", data: a }, { name: "dateien/1 - A.pdf", data: a }, { name: "../../böse\\x.pdf", data: a }, { name: "/abs.pdf", data: a }]));
  assert.deepEqual(withDirs.map((x) => x.name), ["sitzung.json", "dateien/1 - A.pdf", "böse/x.pdf", "abs.pdf"], "Ordner bleiben, nie „..“ oder absolute Pfade");
  await assert.rejects(readZip(new Uint8Array(30)), /keine ZIP-Datei/);
});
