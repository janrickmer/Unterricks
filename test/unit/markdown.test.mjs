// Markdown-Rückfall (public/markdown.js, public/pdfmaker.js): die Fehler der alten PDFs vom 11.11.2026 – Zeilenumbruch als „?“, doppelter
// Titel, Unterstrich-Lücken als Fettdruck, Bilder als „!Text“, Links ohne Adresse, Name-Zeile bei Lehrkraft-Material, Listennummern.
import test from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { register } from "node:module";
import { parseBlocks, parseInline } from "../../public/markdown.js";

// pdfmaker.js lädt pdf-lib unter /vendor/… (so liefert es der Browser aus) – hier aus node_modules
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "/vendor/pdf-lib.esm.min.js" ? n("pdf-lib", c) : n(s, c); }'));
const { markdownToPdf } = await import("../../public/pdfmaker.js");

/* Zeilen einer pdf-lib-PDF (Standardschriften, WinAnsi als <hex> Tj; pdf-lib setzt jedes Wort einzeln) – Wörter mit derselben
   Grundlinie werden zu einer Zeile zusammengesetzt; Listennummern, Kästchen u. Ä. stehen als eigene Einträge in marks */
async function pdfText(blob) {
  const s = Buffer.from(await blob.arrayBuffer()).toString("latin1"), out = [];
  for (const m of s.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let t; try { t = inflateSync(Buffer.from(m[1], "latin1")).toString("latin1"); } catch { continue; }
    let cur = null;
    for (const x of t.matchAll(/1 0 0 1 ([\d.-]+) ([\d.-]+) Tm\s*<([0-9A-Fa-f]*)> Tj/g)) {
      const y = Math.round(Number(x[2]) * 10), txt = Buffer.from(x[3], "hex").toString("latin1");
      if (cur && cur.y === y) cur.t += txt; else { cur = { y, t: txt }; out.push(cur); }
    }
  }
  return out.map((l) => l.t);
}

test("Inline: Unterstrich-Lücken bleiben Text, Bilder werden ein Hinweis, Links und Hervorhebungen wie bisher", () => {
  assert.deepEqual(parseInline("Name: __________ Klasse: ________"), [{ text: "Name: " }, { text: "__________" }, { text: " Klasse: " }, { text: "________" }]);
  assert.deepEqual(parseInline("ein __fettes__ und *kursives* Wort"), [{ text: "ein " }, { text: "fettes", b: true }, { text: " und " }, { text: "kursives", i: true }, { text: " Wort" }]);
  assert.deepEqual(parseInline("![Karikatur: Waage](https://x.de/a.png)"), [{ text: "[Abbildung: Karikatur: Waage]", i: true, img: true }]);
  assert.deepEqual(parseInline("[bpb](https://www.bpb.de) und https://a.de/b."), [{ text: "bpb", href: "https://www.bpb.de" }, { text: " und " }, { text: "https://a.de/b", href: "https://a.de/b" }, { text: "." }]);
});

test("Blöcke: Schreiblinien ([[Linien: n]] und Unterstrich-Zeilen), Ankreuzkästchen, Trennlinie bleibt Trennlinie", () => {
  const b = parseBlocks("Text\n[[Linien: 5]]\n__________\n__________\n\n- [ ] ja\n- [x] nein\n\n---\n___");
  assert.deepEqual(b.map((x) => x.type), ["p", "write", "write", "list", "hr", "hr"]);
  assert.equal(b[1].n, 5); assert.equal(b[2].n, 2);
  assert.deepEqual(b[3].items.map((i) => [i.text, i.box]), [["ja", " "], ["nein", "x"]]);
  assert.equal(parseBlocks("[[Linien: 99]]")[0].n, 40, "höchstens 40 Linien");
});

test("PDF: kein doppelter Titel, Zeilenumbrüche ohne „?“, Lücken als Text, Link mit Adresse, Bild als Hinweis, Listennummern 9 bis 11", async () => {
  const md = "# Arbeitsblatt: Gewaltenteilung\n\nZeile eins\nZeile zwei\n\nName: __________ Datum: ______\n\n![Karikatur](https://x.de/a.png)\n\n" +
    "Mehr: [bpb](https://www.bpb.de/x)\n\n9. neun\n10. zehn\n11. elf\n\n[[Linien: 3]]";
  const lines = await pdfText(await markdownToPdf("Arbeitsblatt: Gewaltenteilung", md, { subtitle: "Politik und Wirtschaft · 8B" }));
  const all = lines.join("\n");
  assert.equal(lines.filter((l) => l.includes("Gewaltenteilung")).length, 1, "der Titel steht nur einmal da");
  assert.ok(lines.includes("Zeile eins") && lines.includes("Zeile zwei") && !all.includes("?"), "Zeilenumbruch ohne „?“");
  assert.ok(all.includes("__________"), "Lücke bleibt");
  assert.ok(all.includes("[Abbildung: Karikatur]") && !all.includes("!Karikatur"));
  assert.ok(all.includes("(https://www.bpb.de/x)"), "Link mit Adresse");
  assert.ok(["9.neun", "10.zehn", "11.elf"].every((n) => lines.includes(n)), "Nummern 9, 10, 11 vor ihrem Text");
  assert.ok(lines.includes("Name:Klasse:Datum:"), "Kopf mit Name, Klasse und Datum");
  const teacher = (await pdfText(await markdownToPdf("Erwartungshorizont", "Lösung", { nameLine: false }))).join("\n");
  assert.ok(!teacher.includes("Name:") && teacher.includes("Lösung".replace("ö", "ö")), "Material nur für die Lehrkraft ohne Name-Zeile");
});

test("PDF: Liste „1. 1. 1.“ zählt 1, 2, 3; verschachtelte Listen zählen je Ebene; lange Wörter in Tabellenzellen werden getrennt", async () => {
  const lines = await pdfText(await markdownToPdf("T", "1. a\n1. b\n   1. b1\n   1. b2\n1. c\n\n| Spalte | B | C | D |\n|---|---|---|---|\n| Donaudampfschifffahrtsgesellschaftskapitänsmütze |  |  |  |"));
  assert.deepEqual(lines.filter((l) => /^\d+\./.test(l)), ["1.a", "2.b", "1.b1", "2.b2", "3.c"]);
  const cell = lines.filter((l) => /^[A-Za-z\u00e4\u00f6\u00fc]+-?$/.test(l) && !/^(SpalteBCD|T)$/.test(l));
  assert.ok(cell.length >= 2 && cell[0].endsWith("-") && cell.join("").replace(/-/g, "") === "Donaudampfschifffahrtsgesellschaftskapit\u00e4nsm\u00fctze", "überlanges Wort mit Trennstrich umbrochen: " + cell.join(" | "));
});

test("Lücken in fettem Text bleiben fett (die Lücke als Text); eingerückte Schreiblinien unter einer Aufgabe werden Linien", () => {
  assert.deepEqual(parseInline("**Ergänze: Die ________ kontrolliert.**"), [{ text: "Ergänze: Die ", b: true }, { text: "________", b: true }, { text: " kontrolliert.", b: true }]);
  assert.deepEqual(parseInline("`a___b` [Lücke ___](https://x.de)"), [{ text: "a___b", code: true }, { text: " " }, { text: "Lücke ___", href: "https://x.de" }]);
  const b = parseBlocks("1. **Erkläre** die Gewaltenteilung.\n   [[Linien: 6]]\n2. Nenne ein Beispiel.\n   __________");
  assert.deepEqual(b.map((x) => x.type + (x.n ? ":" + x.n : "")), ["list", "write:6", "list", "write:1"]);
  assert.equal(b[2].items[0].num, 2, "die Nummerierung läuft weiter");
});
