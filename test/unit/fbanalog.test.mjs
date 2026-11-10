// Notfall-Feibeitsblatt: das aus dem Feibeitsblatt übernommene analoge Arbeitsblatt (public/fbanalog.js) erzeugt eine gültige PDF
import test from "node:test";
import assert from "node:assert/strict";
import { makeAnalogPdf, checkUrlOf, setFeibeitsblattUrl, analogPdfName, qrMatrix } from "../../public/fbanalog.js";
import { notfallSig, NOTFALL_VERSION } from "../../public/notfall.js";

const tasks = [
  { text: "Beschreibe die Karikatur.", textFmt: [[{ t: "Beschreibe ", f: "" }, { t: "die Karikatur", f: "b" }, { t: ".", f: "" }]], answer: { type: "text" },
    material: [[{ t: "Quelle: ", f: "" }, { t: "Wikipedia", f: "", h: "https://de.wikipedia.org/wiki/B%C3%BCrger" }]], files: [{ id: "0123456789abcdef", name: "Text.pdf", bytes: 10 }],
    videos: [{ id: "Fk1u8VKrJGA", start: 90, title: "BVerfG erklärt" }], solution: "GEHEIMER AUFTRAG AN DIE KI" },
  { text: "Ordne zu.", answer: { type: "table", columns: ["Organ", "Aufgabe"], rows: 3 } },
  { text: "Wo liegt das Land?", answer: { type: "map", map: "world", items: [{ id: "a", label: "Kaffee", countries: [{ id: "076", name: "Brasilien" }] }] } },
  { text: "Fotografiere dein Plakat.", answer: { type: "photo" } },
];
const latin = (u8) => Buffer.from(u8).toString("latin1");

test("Notfall-Feibeitsblatt: PDF mit Querverweistabelle, Weltkarte, Video-Link, QR-Code zur Checkliste – nie der Auftrag an die KI", async () => {
  setFeibeitsblattUrl("https://feibeitsblatt.janrickmer.de/");
  const pdf = await makeAnalogPdf({ code: "K457A4", title: "Die wehrhafte Demokratie", tasks, shows: new Map(), aiNote: true, checkUrl: checkUrlOf("K457A4") });
  const s = latin(pdf);
  assert.ok(s.startsWith("%PDF-1.7") && s.trimEnd().endsWith("%%EOF"));
  // jede Objektnummer der xref-Tabelle zeigt genau auf „n 0 obj“
  const xref = Number(/startxref\n(\d+)\n%%EOF/.exec(s)[1]), table = s.slice(xref).split("\n");
  const count = Number(/^0 (\d+)$/.exec(table[1])[1]);
  for (let k = 1; k < count; k++) { const off = Number(table[2 + k].slice(0, 10)); assert.equal(s.slice(off, off + String(k).length + 6), k + " 0 obj", "Objekt " + k); }
  assert.ok(s.includes("/Wm") && s.includes("/Courier"), "Weltkarte als Form-XObject, Video-Adresse in Courier");
  assert.ok(s.includes("(https://feibeitsblatt.janrickmer.de/#checkliste=K457A4)") && s.includes("(https://www.youtube.com/watch?v=Fk1u8VKrJGA&t=90s)"), "Links als Annotationen");
  assert.ok(!s.includes("GEHEIMER"), "der Auftrag an die KI steht nie im Arbeitsblatt (Inhalte sind komprimiert, aber auch Info und Links nicht)");
  const plain = await makeAnalogPdf({ code: "K457A4", title: "Ohne Checkliste", tasks: tasks.slice(0, 1), shows: new Map(), aiNote: false, checkUrl: "" });
  assert.ok(!latin(plain).includes("#checkliste="), "ohne Checklistenpunkte kein QR-Code");
  assert.equal(analogPdfName("K457A4", "Über Gerechtigkeit"), "Feibeitsblatt-Arbeitsblatt-K45-7A4-Ueber Gerechtigkeit.pdf");
  assert.ok(qrMatrix(checkUrlOf("K457A4")).version <= 4);
});

test("Notfall-Feibeitsblatt: Stand (mit/ohne QR-Code, mit/ohne KI-Satz) bestimmt, wann es erneuert wird", () => {
  assert.equal(NOTFALL_VERSION, 1);
  assert.equal(notfallSig(false, false), "v1"); assert.equal(notfallSig(true, false), "v1-qr"); assert.equal(notfallSig(true, true), "v1-qr-ki"); assert.equal(notfallSig(false, true), "v1-ki");
  setFeibeitsblattUrl("javascript:alert(1)");
  assert.equal(checkUrlOf("K457A4"), "https://feibeitsblatt.janrickmer.de/#checkliste=K457A4", "nur https-Adressen werden übernommen");
});
