// Nachtrag 41 (23.11.2026): „Alle Unterlagen dieser Sitzung“ – ZIP-Ordner je Sitzung (Gymnasium und Grundschule) mit Verlaufsplan, Präsentation als
// Original-PDF und PowerPoint (Notizen in der Referentenansicht), Notizen zu den Folien, Druckliste mit Druck-Namen, Material für Schüler:innen bzw.
// Kinder und für die Lehrkraft, Verweisen auf andere Sitzungen und der ursprünglichen Planung einer Selbstlern-Phase. Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { if (s === "/vendor/pdf-lib.esm.min.js") return n("pdf-lib", c); ' +
  'if (s === "/vendor/pdf.min.mjs") return n("pdfjs-dist/legacy/build/pdf.mjs", c); if (s.endsWith("/vendor/pdf.worker.min.mjs")) return n("pdfjs-dist/legacy/build/pdf.worker.mjs", c); return n(s, c); }'));
const D = installDom({ hash: "#/lk" });
const PL = await import("pdf-lib");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const S = await import("../../public/shared.js");
const SH = await import("../../public/sharelib.js");
const SP = await import("../../public/sharepdf.js");
const LZ = await import("../../public/lessonzip.js");
const LD = await import("../../public/lessondocs.js");
const { readZip } = await import("../../public/zip.js");
const src = (f) => readFileSync(new URL("../../public/" + f, import.meta.url), "utf8");

const PNG1 = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137]);
const libs = { raster: async () => ({ data: PNG1, mime: "image/png" }) };
async function pdfOf(lines, pages = 1) {
  const d = await PL.PDFDocument.create(), f = await d.embedFont(PL.StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) { const p = d.addPage([960, 540]); lines.forEach((t, k) => p.drawText(t + (pages > 1 ? " " + (i + 1) : ""), { x: 60, y: 400 - k * 40, size: 24, font: f })); }
  return d.save();
}
async function pdfText(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 }).promise, pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ").replace(/\s+/g, " "));
  await doc.destroy();
  return pages.join(" \n ");
}
/* Server und Dateien: __tapi beantwortet Link und Notizen, fetch liefert die Bytes; calls zählt, was geladen wurde */
function serve(blobs, notes = {}) {
  const calls = [];
  globalThis.__tapi = async (method, path) => {
    calls.push(method + " " + path);
    let m;
    if ((m = /^\/api\/teacher\/files\/([a-z0-9]+)\/link$/.exec(path))) return { url: "/dl/" + m[1] };
    if ((m = /^\/api\/teacher\/files\/([a-z0-9]+)\/notes$/.exec(path))) return { notes: notes[m[1]] || [] };
    throw Object.assign(new Error("unbekannt: " + path), { status: 404 });
  };
  const old = globalThis.fetch;
  globalThis.fetch = async (url) => { const id = String(url).split("/dl/")[1]; return blobs[id] ? new Response(blobs[id]) : new Response("weg", { status: 404 }); };
  return { calls, restore: () => { globalThis.fetch = old; } };
}

test("Verlaufsplan-Bausteine: eigene Überschrift, Datum und Zusatzblöcke (planBlocks), PDF ohne Copyright (blocksPdf) – der Teilen-Ordner bleibt wie er ist", async () => {
  const L = { title: "Wahlen", durationMin: 45, portal: "**1) Einstieg**\n- Karikatur", homework: "", teacherSummary: "" };
  const pb = SH.planBlocks({ L, n: 1, meta: "PoWi" });
  assert.equal(pb[0].text, "Verlaufsplan – Sitzung 1", "Teilen-Ordner unverändert");
  const own = SH.planBlocks({ L, meta: "PoWi", head: "Verlaufsplan – Di, 24.11.2026", when: "08:00 Uhr", extra: [{ t: "h", text: "Gegenstände zum Mitbringen" }] });
  assert.equal(own[0].text, "Verlaufsplan – Di, 24.11.2026");
  assert.equal(own[2].text, "PoWi · 08:00 Uhr · 45 Minuten");
  assert.ok(own.some((b) => b.t === "h" && b.text === "Gegenstände zum Mitbringen"));
  const withC = await pdfText(await SP.blocksPdf("T", own)), without = await pdfText(await SP.blocksPdf("T", own, { copyright: false }));
  assert.ok(withC.includes("Copyright Jan-Rickmer Feindt") && withC.includes("Seite 1 von 1"));
  assert.ok(!without.includes("Copyright") && without.includes("Seite 1 von 1"), "eigene Unterlagen: nur die Seitenzahl");
});

test("Name des Ordners: Fach, Klasse bzw. Kurs, Datum, Titel – ohne verbotene Zeichen; Grundschule mit dem Kurs", () => {
  assert.equal(LZ.lessonZipName({ subject: "powi", klass: "8B", date: "2026-11-24", title: "Wahlen: Wer darf?" }), "Unterlagen - PoWi - 8B - 2026-11-24 - Wahlen Wer darf.zip");
  assert.equal(LZ.lessonZipName({ subject: "ethik", klass: "Q3-GK", title: "" }), "Unterlagen - Ethik - Q3 GK - Sitzung.zip");
  assert.equal(LZ.lessonZipName({ subject: S.GS_SUBJECT, klass: "gs1234abcd", date: "2026-11-24", title: "Josef" }, "Religion 2c"), "Unterlagen - Grundschule - Religion 2c - 2026-11-24 - Josef.zip");
});

test("Gymnasium: Präsentation unverändert + PowerPoint mit Notizen + Notizen-PDF, Druckliste mit Druck-Namen, Material nach Bereich, Verlaufsplan mit allem; was fehlt, steht in den Hinweisen", async () => {
  const pres = await pdfOf(["Wahlen in Deutschland", "Folie"], 3), ann = await pdfOf(["Anmerkungen"]), m1 = await pdfOf(["M1 Karikatur"]), nf = await pdfOf(["Notfall-Feibeitsblatt"]);
  const docx = new TextEncoder().encode("PK-docx"), print = await pdfOf(["Druckvorlage"]);
  const files = [
    { id: "p1", area: "presentation", kind: "file", name: "Wahlen.pdf", mime: "application/pdf", status: "ready", notes: 1, notesRev: 1, codeSlides: [] },
    { id: "a1", area: "teacher", kind: "file", name: "Wahlen - Anmerkungen.pdf", mime: "application/pdf", status: "ready", notesOf: "p1", source: "anmerkungen" },
    { id: "s1", area: "student", kind: "file", name: "M1 Karikatur.pdf", mime: "application/pdf", status: "ready" },
    { id: "n1", area: "student", kind: "file", name: "Notfall-Feibeitsblatt - Wer darf wählen.pdf", mime: "application/pdf", status: "ready", source: "notfall", fbCode: "AEH4VY" },
    { id: "s2", area: "student", kind: "file", name: "M2 Tabelle.pdf", mime: "application/pdf", status: "pending", design: { outdated: false } },
    { id: "t1", area: "teacher", kind: "file", name: "Erwartungshorizont.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", status: "ready" },
    { id: "t2", area: "teacher", kind: "text", name: "Tafelbild", text: "# Tafelbild\n- Wahlrecht ab 18" },
    { id: "l1", area: "student", kind: "link", name: "Bundeswahlleiterin", url: "https://example.org/wahl" },
    { id: "r1", area: "print", kind: "file", name: "M3 Arbeitsblatt.pdf", mime: "application/pdf", status: "ready", print: { copies: 28, duplex: true, color: false } },
    { id: "r2", area: "print", kind: "file", name: "M4 Rätsel.pdf", mime: "application/pdf", status: "pending" },
  ];
  const st = { lesson: { id: "l", subject: "powi", klass: "8B", title: "Wahlen in Deutschland", date: "2026-11-24", startTime: "08:00", durationMin: 45,
    portal: "**1) Einstieg**\n- Karikatur M1\n⏸ Zwischenstopp\n**2) Arbeitsphase**", homework: "alt", teacherSummary: "Die Klasse kennt das Wahlrecht.", bring: [{ item: "Wahlurne", note: "aus dem Fachraum" }] },
    files, sheets: [{ code: "AEH4VY", title: "Wer darf wählen?" }, { code: "BBB222", title: "Ohne Notfall" }] };
  const packPrint = async () => ({ all: [files[8], files[9]], entries: [{ f: files[8], name: "28x - sw - beidseitig - PoWi8 - M3 Arbeitsblatt.pdf", data: print }], wait: [files[9]], cardsWait: [] });
  const srv = serve({ p1: pres, a1: ann, s1: m1, n1: nf, t1: docx }, { p1: [{ n: 2, items: ["Partnerarbeit erklären"] }] });
  let r;
  const steps = [];
  try { r = await LZ.buildLessonZip({ st, portal: st.lesson.portal, homework: "Lies M2 und beantworte Aufgabe 3.", packPrint, onStep: (m) => steps.push(m), libs }); }
  finally { srv.restore(); }
  assert.equal(r.name, "Unterlagen - PoWi - 8B - 2026-11-24 - Wahlen in Deutschland.zip");
  const z = await readZip(new Uint8Array(await r.blob.arrayBuffer())), by = new Map(z.map((e) => [e.name, e.data]));
  assert.deepEqual([...by.keys()].sort(), [
    "Material für Schülerinnen und Schüler/M1 Karikatur.pdf", "Material für Schülerinnen und Schüler/Notfall-Feibeitsblatt - Wer darf wählen.pdf",
    "Material für die Lehrkraft/Erwartungshorizont.docx", "Material für die Lehrkraft/Tafelbild.pdf",
    "Notizen zu den Folien - Wahlen in Deutschland.pdf", "Präsentation - Wahlen in Deutschland.pdf", "Präsentation - Wahlen in Deutschland.pptx",
    "Verlaufsplan - Wahlen in Deutschland.pdf", "Zum Ausdrucken/28x - sw - beidseitig - PoWi8 - M3 Arbeitsblatt.pdf"].sort());
  assert.deepEqual([...by.get("Präsentation - Wahlen in Deutschland.pdf")], [...pres], "Präsentation unverändert (wie hochgeladen)");
  const notesPdf = await pdfText(by.get("Notizen zu den Folien - Wahlen in Deutschland.pdf"));
  assert.ok(notesPdf.includes("Anmerkungen zu Folie 2") && notesPdf.includes("Partnerarbeit erklären"), "Notizen-PDF frisch aus den Notizen von eben (wie die PowerPoint), nicht die gespeicherte: " + notesPdf.slice(0, 200));
  assert.deepEqual([...by.get("Material für die Lehrkraft/Erwartungshorizont.docx")], [...docx], "andere Dateiarten unverändert");
  // PowerPoint: alle drei Folien (auch Codefolien – es ist die eigene Fassung), Notizen der Folie 2 in der Referentenansicht
  const px = await readZip(new Uint8Array(by.get("Präsentation - Wahlen in Deutschland.pptx"))), pn = new Map(px.map((e) => [e.name, e.data]));
  assert.equal([...pn.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length, 3);
  assert.ok(new TextDecoder().decode(pn.get("ppt/notesSlides/notesSlide2.xml")).includes("Partnerarbeit erklären"));
  // Verlaufsplan: ohne Zwischenstopp, Hausaufgabe aus dem Feld (ungespeichert), Links, Feibeitsblätter, Gegenstände, Liste des Ordners, ohne Copyright
  const plan = await pdfText(by.get("Verlaufsplan - Wahlen in Deutschland.pdf"));
  for (const t of ["Verlaufsplan – Di, 24.11.2026", "Di, 24.11.2026, 08:00 Uhr", "45 Minuten", "Karikatur M1", "Arbeitsphase", "Lies M2 und beantworte Aufgabe 3.", "Bundeswahlleiterin",
    "Wer darf wählen? – Code AEH-4VY", "Ohne Notfall – Code BBB-222", "Wahlurne – aus dem Fachraum", "In diesem Ordner", "Die Klasse kennt das Wahlrecht."]) assert.ok(plan.includes(t), "Verlaufsplan: " + t);
  assert.ok(!/Zwischenstopp/.test(plan) && !plan.includes("alt") && !plan.includes("Copyright"), plan.slice(0, 300));
  assert.ok(plan.includes("Material für Schülerinnen und Schüler/Notfall-Feibeitsblatt"), "Feibeitsblatt nennt sein Notfall-Feibeitsblatt im Ordner");
  // Hinweise: Druckvorlage noch nicht gedruckt, Material noch nicht fertig, Feibeitsblatt ohne Notfall-Feibeitsblatt
  assert.ok(r.notes.some((x) => x.includes("„M4 Rätsel.pdf“") && x.includes("Zum Ausdrucken")), r.notes.join(" | "));
  assert.ok(r.notes.some((x) => x.includes("„M2 Tabelle.pdf“ ist noch nicht fertig")));
  assert.ok(r.notes.some((x) => x.includes("„Ohne Notfall“") && x.includes("Notfall-Feibeitsblatt")));
  assert.equal(r.notes.length, 3, r.notes.join(" | "));
  assert.ok(!srv.calls.some((c) => /\/(s2|l1|r1|r2|t2|a1)\/link/.test(c)), "nicht fertige Dateien, Links, Texte, die Druckliste (packPrint) und die gespeicherte Anmerkungs-PDF lädt der Ordner nicht selbst: " + srv.calls.join(", "));
  assert.ok(steps.includes("Erstelle die PowerPoint-Fassung …") && steps.at(-1) === "Packe den Ordner …");
});

test("ohne gespeicherte Anmerkungs-PDF entsteht die Notizen-PDF aus den Notizen; lässt sich die PowerPoint nicht zeichnen, fehlt nur sie (Hinweis)", async () => {
  const pres = await pdfOf(["Folie"], 2);
  const st = { lesson: { id: "l", subject: "ethik", klass: "9A", title: "Glück", portal: "" }, files: [{ id: "p1", area: "presentation", kind: "file", name: "Glück.pdf", mime: "application/pdf", status: "ready", notes: 1 }], sheets: [] };
  const srv = serve({ p1: pres }, { p1: [{ n: 1, items: ["Frage an die Klasse"] }] });
  let r;
  try { r = await LZ.buildLessonZip({ st, libs: { raster: async () => null } }); } finally { srv.restore(); }
  const z = await readZip(new Uint8Array(await r.blob.arrayBuffer())), names = z.map((e) => e.name);
  assert.ok(names.includes("Notizen zu den Folien - Glück.pdf") && names.includes("Präsentation - Glück.pdf") && !names.some((n) => n.endsWith(".pptx")), names.join(", "));
  const notesPdf = await pdfText(z.find((e) => e.name.startsWith("Notizen")).data);
  assert.ok(notesPdf.includes("Frage an die Klasse"));
  assert.ok(r.notes.some((x) => x.startsWith("Die PowerPoint-Fassung von „Glück.pdf“ fehlt")), r.notes.join(" | "));
  const plan = await pdfText(z.find((e) => e.name.startsWith("Verlaufsplan")).data);
  assert.ok(plan.includes("Noch kein Stundenverlauf eingetragen."), "noch nicht geplant: der Plan sagt es");
});

test("Grundschule: Material für die Kinder, Bildkarten über die Druckliste, Verweise auf andere Sitzungen in eigenem Ordner und im Verlaufsplan mit Pfad", async () => {
  const v = await pdfOf(["Vorlesetext Josef"]), ab = await pdfOf(["Arbeitsblatt Josef"]), prev = await pdfOf(["Lied der Vorwoche"]), cards = await pdfOf(["Bildkarten"]);
  const files = [
    { id: "a000000000000001", area: "teacher", kind: "file", name: "Vorlesetext Josef.pdf", mime: "application/pdf", status: "ready" },
    { id: "a000000000000002", area: "student", kind: "file", name: "Arbeitsblatt Josef.pdf", mime: "application/pdf", status: "ready" },
    { id: "a000000000000003", area: "teacher", kind: "file", name: "Bildkarten Josef.pdf", mime: "application/pdf", status: "ready", cards: { texts: [] }, print: { copies: 1, duplex: false, color: true } },
  ];
  const portal = "**1) Sitzkreis**\n- __Lehrkraft liest " + S.pdfRef("a000000000000001") + " vor.__\n- Lied " + S.pdfRef("b000000000000001") + "\n- Bildkarten " + S.pdfRef("a000000000000003");
  const st = { lesson: { id: "g", subject: S.GS_SUBJECT, klass: "gs1234abcd", title: "Josef und seine Brüder", date: "2026-11-24", durationMin: 45, portal: "", homework: "" },
    files, sheets: [], refFiles: [{ id: "b000000000000001", area: "teacher", kind: "file", name: "Lied.pdf", mime: "application/pdf", status: "ready", lessonId: "x" }], courseCards: [] };
  const packPrint = async () => ({ all: [files[2]], entries: [{ f: files[2], name: "1x - farbig - einseitig - Reli2 - Bildkarten Josef.pdf", data: cards }], wait: [], cardsWait: [] });
  const srv = serve({ a000000000000001: v, a000000000000002: ab, b000000000000001: prev });
  let r;
  try { r = await LZ.buildLessonZip({ st, gs: true, course: { label: "Religion 2c", short: "Religion 2c", gradeText: "Jahrgang 2" }, portal, homework: "Male Josef.", packPrint, libs }); }
  finally { srv.restore(); }
  assert.equal(r.name, "Unterlagen - Grundschule - Religion 2c - 2026-11-24 - Josef und seine Brüder.zip");
  const z = await readZip(new Uint8Array(await r.blob.arrayBuffer())), names = z.map((e) => e.name).sort();
  assert.deepEqual(names, ["Aus anderen Sitzungen/Lied.pdf", "Material für die Kinder/Arbeitsblatt Josef.pdf", "Material für die Lehrkraft/Vorlesetext Josef.pdf",
    "Verlaufsplan - Josef und seine Brüder.pdf", "Zum Ausdrucken/1x - farbig - einseitig - Reli2 - Bildkarten Josef.pdf"]);
  const plan = await pdfText(z.find((e) => e.name.startsWith("Verlaufsplan")).data);
  for (const t of ["Grundschule · Religion 2c · Jahrgang 2", "„Material für die Lehrkraft/Vorlesetext Josef.pdf“", "„Aus anderen Sitzungen/Lied.pdf“",
    "„Zum Ausdrucken/1x - farbig - einseitig - Reli2 - Bildkarten Josef.pdf“", "Male Josef."]) assert.ok(plan.includes(t), "Verlaufsplan: " + t + " – " + plan.slice(0, 400));
  assert.deepEqual(r.notes, []);
});

test("Selbstlern-Phase: aktuelles Material wie auf der Seite, dazu die ursprüngliche Planung (archiviertes Material und Verlaufsplan) im eigenen Ordner", async () => {
  const st0 = await pdfOf(["Station 1"]), orig = await pdfOf(["Ursprüngliches Arbeitsblatt"]);
  const st = { lesson: { id: "l", subject: "powi", klass: "8B", title: "Wahlen", portal: "**Selbstlern-Phase**\n- Station 1" },
    files: [{ id: "x1", area: "student", kind: "file", name: "Station 1.pdf", mime: "application/pdf", status: "ready", source: "selbstlern" },
      { id: "o1", area: "archive", kind: "file", name: "M1 Karikatur.pdf", mime: "application/pdf", status: "ready" }],
    sheets: [], sub: { status: "selbstlern", archive: { portal: "**1) Einstieg**\n- Karikatur (ursprünglich)", homework: "Lies M2.", fileAreas: { o1: "student" }, files: ["o1"] } } };
  const srv = serve({ x1: st0, o1: orig });
  let r;
  try { r = await LZ.buildLessonZip({ st, libs }); } finally { srv.restore(); }
  const z = await readZip(new Uint8Array(await r.blob.arrayBuffer())), names = z.map((e) => e.name).sort();
  assert.deepEqual(names, ["Material für Schülerinnen und Schüler/Station 1.pdf", "Ursprüngliche Planung (archiviert)/M1 Karikatur.pdf",
    "Ursprüngliche Planung (archiviert)/Verlaufsplan (ursprünglich) - Wahlen.pdf", "Verlaufsplan - Wahlen.pdf"]);
  const orPlan = await pdfText(z.find((e) => e.name.includes("(ursprünglich)")).data);
  assert.ok(orPlan.includes("Karikatur (ursprünglich)") && orPlan.includes("Lies M2."));
  assert.ok(r.notes.some((x) => x.includes("Selbstlern-Phase") && x.includes("Ursprüngliche Planung (archiviert)")));
});

test("Fehler je Datei werden Hinweise statt eines Abbruchs: Druckliste scheitert ganz bzw. je Datei, nach dem Druck geändert, Datei fehlt, Notizen nicht ladbar, lange Namen behalten die Endung", async () => {
  const pres = await pdfOf(["Folie"], 2), ann = await pdfOf(["Gespeicherte Anmerkungen"]), p3 = await pdfOf(["Vorlage"]);
  const long = "Ein sehr langer Titel für ein Tabellenblatt mit Wahlergebnissen aller Bundesländer seit neunzehnhundertneunundvierzig und mehr Daten.xlsx";
  const files = [
    { id: "p1", area: "presentation", kind: "file", name: "Glück.pdf", mime: "application/pdf", status: "ready", notes: 2 },
    { id: "a1", area: "teacher", kind: "file", name: "Anmerkungen.pdf", mime: "application/pdf", status: "ready", notesOf: "p1" },
    { id: "x1", area: "teacher", kind: "file", name: long, mime: "application/vnd.ms-excel", status: "ready" },
    { id: "g1", area: "student", kind: "file", name: "Fehlt.pdf", mime: "application/pdf", status: "ready" },
    { id: "r1", area: "print", kind: "file", name: "Vorlage.pdf", mime: "application/pdf", status: "ready", design: { outdated: true } },
    { id: "r2", area: "print", kind: "file", name: "Weg.pdf", mime: "application/pdf", status: "ready" },
  ];
  const st = { lesson: { id: "l", subject: "ethik", klass: "9A", title: "Glück", portal: "**1) Einstieg**", teacherSummary: "Alt.", teacherSummaryPlan: "anderer-stand" }, files, sheets: [] };
  const packPrint = async ({ tolerant } = {}) => { assert.equal(tolerant, true, "der Ordner packt die Druckliste nachsichtig");
    return { all: [files[4], files[5]], entries: [{ f: files[4], name: "1x - sw - einseitig - Eth9 - Vorlage.pdf", data: p3 }], wait: [], cardsWait: [], failed: [{ f: files[5], error: new Error("„Weg.pdf“ ließ sich nicht laden (Fehler 404).") }] }; };
  const srv = serve({ p1: pres, a1: ann, x1: new Uint8Array([1, 2, 3]) });
  globalThis.__tapi = ((orig) => async (m, path) => { if (path.endsWith("/notes")) throw Object.assign(new Error("weg"), { status: 404 });
    if (path.includes("/g1/")) throw Object.assign(new Error("„Fehlt.pdf“ ließ sich nicht laden (Fehler 404)."), { status: 404 });   // 4xx: ohne Wiederholung
    return orig(m, path); })(globalThis.__tapi);
  let r;
  try { r = await LZ.buildLessonZip({ st, packPrint, libs }); } finally { srv.restore(); }
  const z = await readZip(new Uint8Array(await r.blob.arrayBuffer())), names = z.map((e) => e.name);
  assert.ok(names.includes("Zum Ausdrucken/1x - sw - einseitig - Eth9 - Vorlage.pdf") && names.includes("Präsentation - Glück.pdf") && names.includes("Verlaufsplan - Glück.pdf"), names.join(" | "));
  const x = names.find((n) => n.startsWith("Material für die Lehrkraft/Ein sehr langer"));
  assert.ok(x && x.endsWith(".xlsx") && x.length <= "Material für die Lehrkraft/".length + 110, "gekürzt mit Endung: " + x);
  assert.deepEqual([...z.find((e) => e.name.startsWith("Notizen")).data], [...ann], "Notizen nicht ladbar: die gespeicherte Anmerkungs-PDF");
  const want = ["„1x - sw - einseitig - Eth9 - Vorlage.pdf“ (Ordner „Zum Ausdrucken“) wurde nach dem letzten Druck noch geändert", "„Weg.pdf“ von der Druckliste ließ sich nicht laden",
    "„Fehlt.pdf“ ließ sich nicht laden", "Die Notizen zu „Glück.pdf“ ließen sich nicht laden – die PowerPoint ist ohne sie, die Notizen-PDF ist die zuletzt gespeicherte."];
  for (const w of want) assert.ok(r.notes.some((n) => n.includes(w)), "Hinweis: " + w + " – " + r.notes.join(" | "));
  const plan = await pdfText(z.find((e) => e.name.startsWith("Verlaufsplan")).data);
  assert.ok(plan.includes("Die Planung wurde danach geändert"), "veraltete Zusammenfassung: der Hinweis wie auf der Seite");
  // die ganze Druckliste scheitert: der Ordner entsteht trotzdem
  const srv2 = serve({ p1: pres });
  let r2;
  try { r2 = await LZ.buildLessonZip({ st: { ...st, files: [files[0]] }, packPrint: async () => { throw new Error("Keine Verbindung zum Server"); }, libs }); } finally { srv2.restore(); }
  assert.ok(r2.notes.some((n) => n.startsWith("Die Druckliste ließ sich nicht laden – Keine Verbindung zum Server")) && r2.paths.includes("Präsentation - Glück.pdf"), r2.notes.join(" | "));
});

test("Grundschule: Bildkarten des Kurses, die noch gedruckt werden, stehen nur im Hinweis (nicht in „Aus anderen Sitzungen“); abgewählte kommen mit ihrer Gestaltung", async () => {
  const card = { id: "c000000000000001", area: "teacher", kind: "file", name: "Bildkarten Josef.pdf", mime: "application/pdf", status: "ready", cards: { texts: [] }, design: { outdated: true } };
  const off = { id: "c000000000000002", area: "teacher", kind: "file", name: "Bildkarten Ruth.pdf", mime: "application/pdf", status: "ready", cards: { texts: [] }, design: { outdated: true } };
  const portal = "- Bildkarten " + S.pdfRef(card.id) + "\n- Ruth " + S.pdfRef(off.id);
  const st = { lesson: { id: "g", subject: S.GS_SUBJECT, klass: "gs1234abcd", title: "Josef", portal: "" }, files: [], sheets: [],
    refFiles: [{ ...off, design: undefined, designed: true, htmlAt: 1, pdfAt: 2 }], courseCards: [card, off] };
  const packPrint = async () => ({ all: [card], entries: [], wait: [], cardsWait: [card], failed: [] });
  const srv = serve({ c000000000000002: await pdfOf(["Ruth"]) });
  let r;
  try { r = await LZ.buildLessonZip({ st, gs: true, portal, packPrint, cardsNote: (l) => "Nicht in der ZIP-Datei – die Bildkarten „" + l[0].name + "“ (noch nicht gedruckt).", libs }); } finally { srv.restore(); }
  assert.deepEqual(r.paths.filter((p) => p.includes("/")).sort(), ["Aus anderen Sitzungen/Bildkarten Ruth.pdf"], r.paths.join(" | "));
  assert.ok(!srv.calls.some((c) => c.includes(card.id)), "die noch nicht gedruckten Karten lädt der Ordner nicht selbst");
  assert.ok(r.notes.some((n) => n.includes("„Bildkarten Josef.pdf“ (noch nicht gedruckt)")) && r.notes.some((n) => n.includes("„Bildkarten Ruth.pdf“ wurde nach dem letzten Druck noch geändert")), r.notes.join(" | "));
});

test("Selbstlern-Phase: Zusammenfassung, archivierte Links und ursprüngliche Feibeitsblätter im ursprünglichen Verlaufsplan; ohne Archiviertes sagt der Hinweis das", async () => {
  const nfb = await pdfOf(["Notfall"]);
  const st = { lesson: { id: "l", subject: "powi", klass: "8B", title: "Wahlen", portal: "**Selbstlern-Phase**", teacherSummary: "Die Stunde beginnt mit einer Karikatur." },
    files: [{ id: "k1", area: "archive", kind: "link", name: "Wahl-O-Mat", url: "https://www.wahl-o-mat.de/" },
      { id: "n1", area: "archive", kind: "file", name: "Notfall-Feibeitsblatt.pdf", mime: "application/pdf", status: "ready", source: "notfall", fbCode: "AEH4VY" }],
    sheets: [], sub: { status: "selbstlern", archive: { portal: "**1) Einstieg**", homework: "", fileAreas: { k1: "student", n1: "student" }, sheets: [{ code: "AEH4VY", title: "Wer darf wählen?" }] } } };
  const srv = serve({ n1: nfb });
  let r;
  try { r = await LZ.buildLessonZip({ st, libs }); } finally { srv.restore(); }
  const z = await readZip(new Uint8Array(await r.blob.arrayBuffer()));
  const orig = await pdfText(z.find((e) => e.name.includes("(ursprünglich)")).data), cur = await pdfText(z.find((e) => e.name === "Verlaufsplan - Wahlen.pdf").data);
  for (const t of ["Wahl-O-Mat", "https://www.wahl-o-mat.de/", "Wer darf wählen? – Code AEH-4VY", "Ursprüngliche Planung (archiviert)/Notfall-Feibeitsblatt.pdf", "Die Stunde beginnt mit einer Karikatur."])
    assert.ok(orig.includes(t), "ursprünglicher Verlaufsplan: " + t + " – " + orig.slice(0, 300));
  assert.ok(!cur.includes("Die Stunde beginnt mit einer Karikatur."), "die Zusammenfassung beschreibt die ursprüngliche Planung – nicht im Plan der Selbstlern-Phase");
  // nichts archiviert
  const srv2 = serve({});
  let r2;
  try { r2 = await LZ.buildLessonZip({ st: { ...st, lesson: { ...st.lesson, teacherSummary: "" }, files: [], sub: { status: "aktiv", archive: { fileAreas: {} } } }, libs }); } finally { srv2.restore(); }
  assert.ok(r2.notes.includes("Für diese Sitzung gilt eine Vertretung – zur ursprünglichen Planung gab es nichts zum Herunterladen."), r2.notes.join(" | "));
});

test("Karte ganz unten (session.js, gssession.js): nach „Sitzung als Datei“, auch in „Ich bin jetzt im Unterricht“ ausgeblendet; der Ordner lädt erst beim Klick", () => {
  const s = src("session.js"), g = src("gssession.js");
  assert.ok(s.includes("main.append(...inClass.els, tsum.el, grid, ioCard, docsCard);") && s.includes("full: () => [tsum.el, grid, ioCard, docsCard]"));
  assert.ok(g.includes("main.append(...inClass.els, tsum.el, grid, docsCard);") && g.includes("full: () => [tsum.el, grid, docsCard]"));
  assert.ok(s.includes("await flushPortal(); return { portal: portalTA ? portalTA.value : L().portal || \"\", homework: hwTA.value || \"\" }"), "ungespeicherte Felder zuerst (abgewartet)");
  assert.ok(g.includes("await flushPlan(); hwF.flush(); return { portal: ta.value, homework: hwTA.value || \"\" }"));
  assert.ok(s.includes('notesDirtyNow() ? "den Notizen zu den Folien"') && s.includes('tsum.dirty() ? "der Zusammenfassung für die Lehrkraft"') && s.includes('bring.dirty() ? "den Gegenständen zum Mitbringen"'), "ungespeicherte Notizen, Zusammenfassung und Gegenstände: Rückfrage");
  assert.ok(g.includes('tsum && tsum.dirty() ? "der Zusammenfassung für die Lehrkraft"') && g.includes('bring.dirty() ? "den Gegenständen zum Mitbringen"'));
  const d = src("lessondocs.js");
  assert.ok(d.includes('lazy(import("./lessonzip.js"))') && !/^import .*lessonzip/m.test(d), "lessonzip.js (pdf-lib, PDF.js) erst beim Klick");
  assert.ok(src("materialbox.js").includes("packPrint, printName: (f) => nameOf(f), cardsMissingText, waitWhy: cardWhy };"), "die Druckliste packt wie „Alle herunterladen (ZIP)“");
});

test("Karte im Browser-Ersatz: Rückfrage bei ungespeicherten Teilen, Knopf, Fortschritt, Hinweise im Dialog mit dem Ordnernamen, Fokus zurück auf den Knopf", async () => {
  const blobs = [], orig = URL.createObjectURL; URL.createObjectURL = (b) => { blobs.push(b); return "blob:x"; };
  const srv = serve({});
  const st = { lesson: { id: "l", subject: "powi", klass: "8B", title: "Wahlen", portal: "**1) Einstieg**" }, files: [], sheets: [] };
  let dirtyParts = ["den Notizen zu den Folien"], befores = 0;
  const box = { packPrint: async () => ({ all: [{ id: "r1", name: "M4.pdf" }], entries: [], wait: [{ id: "r1", name: "M4.pdf" }], cardsWait: [], failed: [] }), waitWhy: () => "wird gerade als PDF gedruckt" };
  const card = LD.lessonDocsCard({ st, box, before: async () => { befores++; return { portal: st.lesson.portal, homework: "" }; }, dirty: () => dirtyParts });
  document.getElementById("app").append(card);
  const btn = card.querySelector("#lessondocs-btn");
  const until = async (fn) => { for (let i = 0; i < 400; i++) { if (fn()) return true; await D.sleep(10); } return false; };
  const modalOf = (t) => [...document.querySelectorAll(".modal")].find((m) => (m.getAttribute("aria-label") || "") === t);
  try {
    assert.equal(card.querySelector("h2").textContent, "Alle Unterlagen dieser Sitzung");
    assert.ok(card.textContent.includes("PowerPoint") && card.textContent.includes(LD.LESSON_DOCS.hint));
    // ungespeicherte Notizen: Rückfrage, „Abbrechen“ lädt nichts
    btn.focus(); D.userClick(btn);
    assert.ok(await until(() => modalOf("Ungespeicherte Änderungen")), "Rückfrage");
    assert.ok(modalOf("Ungespeicherte Änderungen").textContent.includes("Ihre Änderungen an den Notizen zu den Folien sind noch nicht gespeichert"));
    D.userClick([...modalOf("Ungespeicherte Änderungen").querySelectorAll("button")].find((b) => b.textContent.trim() === "Abbrechen"));
    await D.sleep(20);
    assert.equal(befores, 0); assert.equal(blobs.length, 0);
    // ohne Ungespeichertes: lädt herunter, die Hinweise kommen im Dialog mit dem Namen des Ordners
    dirtyParts = [];
    D.userClick(btn);
    assert.ok(await until(() => modalOf("Hinweise zum Ordner")), "Hinweise");
    const st0 = card.querySelector(".save-state").textContent;
    assert.ok(/^Heruntergeladen: Unterlagen - PoWi - 8B - Wahlen\.zip \(.+, 1 Datei\)$/.test(st0), st0);
    assert.equal(blobs.length, 1);
    const m = modalOf("Hinweise zum Ordner");
    assert.ok(m.textContent.includes("Der Ordner „Unterlagen - PoWi - 8B - Wahlen.zip“ ist heruntergeladen.") && m.textContent.includes("„M4.pdf“ – wird gerade als PDF gedruckt"), m.textContent);
    D.userClick([...m.querySelectorAll("button")].find((b) => b.textContent.trim() === "Fertig"));
    await D.sleep(20);
    assert.equal(document.activeElement, btn, "Fokus zurück auf den Knopf");
  } finally { URL.createObjectURL = orig; srv.restore(); card.remove(); for (const x of document.querySelectorAll(".modal-back")) x.remove(); }
  const gsCard = LD.lessonDocsCard({ gs: true, st: { lesson: {}, files: [] }, box: {}, before: async () => ({}) });
  assert.ok(!gsCard.textContent.includes("PowerPoint") && gsCard.textContent.includes("Bildkarten") && !gsCard.textContent.includes(LD.LESSON_DOCS.hint));
});
