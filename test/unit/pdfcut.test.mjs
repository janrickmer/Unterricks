// Präsentation bis zur letzten gezeigten Folie kürzen (pdf-lib, im Browser der Lehrkraft)
import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { cutPdfBytes } from "../../public/pdfcut.js";

async function deck(n) {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica);
  d.setTitle("BVerfG");
  for (let i = 1; i <= n; i++) d.addPage([900 + i, 540]).drawText("Folie " + i, { x: 50, y: 270, size: 40, font: f });   // Breite = Foliennummer
  return d.save();
}

test("gekürzte Präsentation: genau die Folien 1 bis n, Text bleibt Text, spätere Folien (z. B. Musterlösung) fehlen", async () => {
  const cut = await cutPdfBytes(await deck(5), 3, PDFDocument);
  const doc = await PDFDocument.load(cut);
  assert.equal(doc.getPageCount(), 3);
  assert.equal(doc.getTitle(), "BVerfG");
  assert.deepEqual(doc.getPages().map((p) => p.getWidth()), [901, 902, 903], "Folie 1–3 in der richtigen Reihenfolge, Folie 4 und 5 fehlen");
});

test("gekürzte Präsentation: ungültige Folie und unlesbare Datei werden mit verständlicher Meldung abgelehnt", async () => {
  const pdf = await deck(3);
  await assert.rejects(cutPdfBytes(pdf, 3, PDFDocument), /zwischen 1 und 2/);
  await assert.rejects(cutPdfBytes(pdf, 0, PDFDocument), /zwischen 1 und 2/);
  await assert.rejects(cutPdfBytes(new Uint8Array([1, 2, 3]), 1, PDFDocument), /lässt sich im Browser nicht kürzen/);
});
