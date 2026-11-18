// Nachtrag 39 (18.11.2026): „Unterrichtseinheit mit KollegInnen teilen“ – ZIP-Ordner mit Leupold-Schema (darunter je Sitzung ein Absatz: was passiert,
// zentrale Kompetenz, Ziel), Erklärung „Das ist ein Feibeitsblatt“, „Fehlende Sitzungen“ und je geplanter Sitzung einem Ordner mit Präsentation (ohne
// reine Codefolien, mit Copyright), Notizen zu den Folien, Verlaufsplan und allen PDF-Dateien. Die Absätze schreibt Claude (save_weitergabe,
// update_lesson weitergabe), die Lehrkraft prüft sie in Unterricks. Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
// pdf-lib und PDF.js wie im Browser über /vendor/… (share.js lädt sie selbst); der Worker von PDF.js aus dem Paket
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { if (s === "/vendor/pdf-lib.esm.min.js") return n("pdf-lib", c); ' +
  'if (s === "/vendor/pdf.min.mjs") return n("pdfjs-dist/legacy/build/pdf.mjs", c); if (s.endsWith("/vendor/pdf.worker.min.mjs")) return n("pdfjs-dist/legacy/build/pdf.worker.mjs", c); return n(s, c); }'));
const D = installDom({ hash: "#/lk" });
const PL = await import("pdf-lib");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const S = await import("../../public/shared.js");
const SH = await import("../../public/sharelib.js");
const SP = await import("../../public/sharepdf.js");
const SR = await import("../../public/sharepres.js");
const SZ = await import("../../public/share.js");
const PX = await import("../../public/sharepptx.js");
const SF = await import("../../public/sessionfile.js");
const P = await import("../../public/planning.js");
const G = await import("../../public/gsplanning.js");
const { readZip } = await import("../../public/zip.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const L = await import("../../worker/lessons.js");
const U = await import("../../worker/units.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");

const LS = String.fromCharCode(0x2028), ZW = String.fromCharCode(0x200b);
const TEXT = { passiert: "Die Klasse deutet eine Karikatur zur Wahlbeteiligung und sammelt Gründe für das Nichtwählen.", kompetenz: "Die Schüler:innen analysieren politische Karikaturen.",
  ziel: "Die Lerngruppe kann zwei Gründe für niedrige Wahlbeteiligung erklären." };
async function pdfText(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 }).promise, pages = [];
  for (let i = 1; i <= doc.numPages; i++) pages.push((await (await doc.getPage(i)).getTextContent()).items.map((x) => x.str).join(" ").replace(/\s+/g, " "));
  const att = await doc.getAttachments();
  await doc.destroy();
  return { pages, all: pages.join(" \n "), attachments: att ? Object.keys(att) : [] };
}

/* ---------- Absatz für die Weitergabe (sharelib.js) ---------- */
test("Absatz: drei Teile bereinigt (Leerraum, Steuer- und Formatzeichen), alle leer = löschen, streng mit Meldung statt still zu kürzen; Speicherform mit Zeitpunkt", () => {
  assert.deepEqual(SH.cleanShareText({ passiert: "  Die Klasse\n liest" + LS + "M1. ", kompetenz: "Kompe" + ZW + "tenz", ziel: "" }), { passiert: "Die Klasse liest M1.", kompetenz: "Kompe tenz", ziel: "" });
  assert.equal(SH.cleanShareText({ passiert: " ", kompetenz: "", ziel: "\n" }), null, "alle drei leer = löschen");
  assert.equal(SH.cleanShareText(null, true), null);
  assert.equal(SH.cleanShareText("Text"), null);
  assert.throws(() => SH.cleanShareText("Text", true), /ein Objekt \{passiert, kompetenz, ziel\}/);
  assert.throws(() => SH.cleanShareText({ passiert: 5 }, true), /^Error: Was passiert ist ein Text\.$/);
  assert.throws(() => SH.cleanShareText({ passiert: "x".repeat(901) }, true), /Was passiert ist zu lang \(901 Zeichen, höchstens 900\) – bitte kürzen\./);
  assert.throws(() => SH.cleanShareText({ ziel: "x".repeat(401) }, true), /Ziel der Sitzung ist zu lang \(401 Zeichen, höchstens 400\)/);
  assert.equal(SH.cleanShareText({ kompetenz: "k".repeat(600) }).kompetenz.length, 500, "ohne streng: gekürzt");
  const stored = SH.shareTextStore(TEXT, 1234);
  assert.deepEqual(JSON.parse(stored), { v: 1, ...TEXT, at: 1234 });
  assert.deepEqual(SH.shareTextOf(stored), { ...TEXT, at: 1234 });
  assert.deepEqual(SH.shareTextOf({ ...TEXT }), { ...TEXT, at: null });
  for (const x of [null, "", "kaputt", "[]", '{"passiert":""}']) assert.equal(SH.shareTextOf(x), null, String(x));
  assert.equal(SH.shareTextStore(null, 1), null);
  assert.equal(SH.shareTextComplete(TEXT), true);
  assert.equal(SH.shareTextComplete({ ...TEXT, ziel: "" }), false);
  assert.equal(SH.SHARE_BUTTON, "Unterrichtseinheit mit KollegInnen teilen", "Wortlaut der Lehrkraft (Tippfehler „Untereichtseinheit“ berichtigt)");
  assert.equal(SH.SHARE_COPYRIGHT, "Copyright Jan-Rickmer Feindt");
});

test("Sitzungen der Einheit: Nummer wie in der Tabelle, geplant = Verlaufsplan mit Inhalt (Zwischenstopp zählt nicht), Ausfall-Einträge zählen nicht", () => {
  assert.equal(SH.isPlannedText(""), false);
  assert.equal(SH.isPlannedText(S.STOP_LINE), false);
  assert.equal(SH.isPlannedText("\n  \n" + S.STOP_LINE + "\n"), false);
  assert.equal(SH.isPlannedText("**1) Einstieg**\n" + S.STOP_LINE), true);
  const rows = [{ uid: "r1", stundenfrage: "Warum wählen?" }, { uid: "r2", stundenfrage: "Wer darf wählen?" }, { uid: "r3", stundenfrage: "Wie wird gezählt?" }];
  const list = SH.shareSessions(rows, [{ id: "a", row: "r2", planned: true }, { id: "b", row: "r1", planned: false }, { id: "c", row: "r3", planned: true, cancelled: true }, { id: "d", row: null, planned: true }]);
  assert.deepEqual(list.map((s) => [s.n, s.row && s.row.uid, s.lesson && s.lesson.id, s.planned]), [[1, "r1", "b", false], [2, "r2", "a", true], [3, "r3", null, false], [4, null, "d", true]]);
  assert.deepEqual(SH.shareSessions([], null), []);
});

test("Präsentation: Materialfolien bleiben (Titel wörtlich oder alle Wörter), reine Codefolien fallen weg, nie eine leere Präsentation", () => {
  const titles = ["Wer darf wählen?", "M1 Arbeitsblatt.pdf", "Quellen"];
  assert.equal(SH.isMaterialSlide(["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", "Feibeitsblatt „Wer darf wählen?“"], titles), true);
  assert.equal(SH.isMaterialSlide(["Öffnet das Arbeitsblatt M1 in Unterricks"], titles), true, "alle Wörter des Titels in anderer Reihenfolge");
  assert.equal(SH.isMaterialSlide(["Die Hausaufgabe und das Material findest du in Unterricks."], titles), false);
  assert.equal(SH.isMaterialSlide(["Scannt den QR-Code"], titles), false);
  assert.equal(SH.isMaterialSlide(["Gebt den Code ein"], []), false);
  assert.equal(SH.isMaterialSlide([], titles), false, "ohne Überschrift: Unterricks zeigt dort den Titel der Sitzung");
  assert.equal(SH.isMaterialSlide(["Lest den Text und markiert Schlüsselbegriffe."], []), true, "eine Aufforderung ohne Hinweis auf Unterricks bleibt lieber");
  assert.equal(SH.isMaterialSlide(["Wir besprechen M1"], ["M1"]), true, "ohne Hinweis auf Unterricks bleibt sie (der kurze Titel allein zählt nicht)");
  const plan = SH.shareSlidePlan([{ n: 2, lines: ["Feibeitsblatt „Wer darf wählen?“"] }, { n: 3, lines: [] }, { n: 9, lines: [] }, { n: 0 }, null], 4, titles);
  assert.deepEqual(plan, { drop: [3], cover: [2], keep: [1, 2, 4] });
  assert.deepEqual(SH.shareSlidePlan([{ n: 1, lines: [] }], 1, []), { drop: [], cover: [1], keep: [1] });
  assert.deepEqual(SH.shareSlidePlan([], 3, []), { drop: [], cover: [], keep: [1, 2, 3] });
});

test("Unterricks-Zeile finden: die Marke und umbrochene Stücke ihres Erklärsatzes in gleicher Schriftgröße, sonst nichts", () => {
  const line = (text, base, h = 9, x0 = 60) => ({ text, base, h, map: Array.from(text, (_, i) => ({ x0: x0 + i * 4, x1: x0 + i * 4 + 4, h })) });
  assert.equal(S.codeMarkLine(S.CODE_SLIDE_LINE), "mark");
  const one = SH.markBoxes([line("Wahlen in Deutschland", 300, 40), line(S.CODE_SLIDE_LINE, 526)]);
  assert.equal(one.length, 1);
  assert.deepEqual([one[0].x0, one[0].x1, one[0].base], [60, 60 + S.CODE_SLIDE_LINE.length * 4, 526]);
  const parts = S.CODE_SLIDE_LINE.split(": ");
  const two = SH.markBoxes([line(parts[0] + ":", 514), line(parts[1], 526), line(parts[1], 300, 30)]);
  assert.equal(two.length, 2, "der Erklärsatz direkt darunter gehört dazu, derselbe Satz groß in der Folienmitte nicht");
  assert.deepEqual(SH.markBoxes([line("Bearbeitet M1", 300)]), []);
});

test("Namen im Ordner: eindeutig ohne Groß-/Kleinschreibung, nie Zeichen, die Dateisysteme verbieten; feste Namen der Begleitdokumente", () => {
  const used = new Set();
  assert.equal(SH.uniquePdfName("M1 Arbeitsblatt.pdf", used), "M1 Arbeitsblatt.pdf");
  assert.equal(SH.uniquePdfName("M1 Arbeitsblatt", used), "M1 Arbeitsblatt (2).pdf");
  assert.equal(SH.uniquePdfName("m1 arbeitsblatt.PDF", used), "m1 arbeitsblatt (3).pdf");
  assert.equal(SH.uniquePdfName('a/b:c*?"<>|d', used), "a b c d.pdf");
  assert.equal(SH.uniquePdfName("...", used), "Datei.pdf");
  assert.equal(SH.shareFolder(3), "Sitzung 3");
  assert.equal(SH.SHARE_DOCS.leupold("Wahlen: in Deutschland?"), "Leupold-Schema - Wahlen in Deutschland.pdf");
  assert.equal(SH.SHARE_DOCS.leupold(""), "Leupold-Schema - Unterrichtseinheit.pdf");
  assert.deepEqual([SH.SHARE_DOCS.feibeitsblatt, SH.SHARE_DOCS.missing, SH.SHARE_DOCS.plan(2), SH.SHARE_DOCS.pres(2), SH.SHARE_DOCS.notes(2)],
    ["Erklärung - Das ist ein Feibeitsblatt.pdf", "Fehlende Sitzungen.pdf", "Verlaufsplan - Sitzung 2.pdf", "Präsentation - Sitzung 2.pdf", "Notizen zu den Folien - Sitzung 2.pdf"]);
});

test("Kompetenz: KCGO nur in der Oberstufe (E-Phase und Q-Phase), sonst die hinterlegte Planungsgrundlage bzw. das Curriculum der Grundschule – grammatisch passend", () => {
  const q = SH.competenceSource("powi", "Q2-GK"), e = SH.competenceSource("ethik", "EA"), s1 = SH.competenceSource("powi", "8B"), gs = SH.competenceSource("gs", "gs12345678");
  assert.deepEqual([q.kcgo, q.label, q.from], [true, "Zentrale Kompetenz (KCGO)", "dem KCGO für das Kurshalbjahr Q2"]);
  assert.ok(q.basis.startsWith("das KCGO (Kerncurriculum gymnasiale Oberstufe) für das Kurshalbjahr Q2"));
  assert.deepEqual([e.kcgo, e.from], [true, "dem KCGO für die Einführungsphase"]);
  assert.deepEqual([s1.kcgo, s1.label], [false, "Zentrale Kompetenz"]);
  assert.ok(s1.basis.includes("ein KCGO gibt es in dieser Jahrgangsstufe nicht") && s1.from.startsWith("der hinterlegten Planungsgrundlage"));
  assert.deepEqual([gs.kcgo, gs.from], [false, "dem hinterlegten Curriculum der Grundschule"]);
  assert.deepEqual(SH.competenceSource("evrel", "gs12345678"), gs, "Kurse der Grundschule erkennt es auch an der Kennung");
});

test("Begleitdokumente: Erklärung zum Feibeitsblatt (Sie-Form, fetter Hinweis zur Absprache und zum Notfall-Feibeitsblatt), Fehlende Sitzungen, Verlaufsplan ohne Zwischenstopp", () => {
  const fb = SH.fbExplainBlocks(), text = JSON.stringify(fb);
  const bold = fb.filter((b) => b.runs && b.runs.some((r) => r.b)).flatMap((b) => b.runs.filter((r) => r.b).map((r) => r.text)).join(" ");
  for (const s of ["nach Absprache mit mir", "Wenn Sie sich das nicht zutrauen", "Notfall-Feibeitsblatt auf ihrem Tablet als Dokument", "zum gleichen Kompetenzerwerb"]) assert.ok(bold.includes(s), s);
  for (const s of ["selbst für meinen Unterricht entwickelt", "Jan-Rickmer Feindt", "Code", "verschlüsselt", "Warum nur nach Absprache?"]) assert.ok(text.includes(s), s);
  assert.ok(!/\b(du|dein|deine)\b/i.test(text), "die Kollegin bzw. der Kollege wird gesiezt");
  const rows = [{ uid: "r1", stundenfrage: "Warum wählen?", ablauf: ["Karikatur", "Gründe sammeln"], schritt: 0 }, { uid: "r2", stundenfrage: "Wer darf wählen?", ablauf: [], schritt: 9 }];
  const open = SH.shareSessions(rows, []);
  const m = SH.missingBlocks(open, [{ titel: "Problem erschließen", beschreibung: "Karikatur" }], { unitTitle: "Wahlen" });
  assert.deepEqual(m.map((b) => b.t), ["title", "muted", "p", "h", "muted", "p", "li", "li", "h", "p"]);
  assert.ok(JSON.stringify(m).includes("Noch nicht alle Sitzungen dieser Unterrichtseinheit sind bisher geplant und mit Material ausgestattet. Die folgenden 2 Sitzungen gibt es bisher nur in der Reihenplanung"));
  assert.deepEqual(m.filter((b) => b.t === "h").map((b) => b.text), ["Sitzung 1: Warum wählen?", "Sitzung 2: Wer darf wählen?"]);
  assert.equal(m[4].text, "Lernschritt 1: Problem erschließen – Karikatur");
  assert.ok(JSON.stringify(m).includes("Noch ohne groben Ablauf."));
  const L0 = { title: "Warum wählen?", durationMin: 90, portal: "**1) Einstieg**\n- Karikatur ~~Nichtwähler~~\n" + S.STOP_LINE + "\n\n**2) Partnerarbeit**\n- __Lehrkraft liest vor.__",
    homework: "- Lies ~~M2~~", teacherSummary: "Erst die Karikatur.\n\nDann M1." };
  const pb = SH.planBlocks({ L: L0, n: 1, meta: "Politik und Wirtschaft · Jahrgang 8", files: [{ kind: "link", name: "Wahlomat", url: "https://example.org/w" }, { kind: "link", name: "Alt", url: "https://example.org/a", area: "archive" }] });
  const pj = JSON.stringify(pb);
  assert.ok(!pj.includes("Zwischenstopp"), "die interne Zeile entfällt");
  assert.deepEqual(pb.filter((b) => b.t === "h").map((b) => b.text), ["Stundenverlauf", "Hausaufgabe", "Links", "Zusammenfassung der Sitzung für die Lehrkraft"]);
  assert.equal(pb[0].text, "Verlaufsplan – Sitzung 1");
  assert.equal(pb[2].text, "Politik und Wirtschaft · Jahrgang 8 · 90 Minuten");
  assert.ok(pb.some((b) => b.t === "li" && b.runs.some((r) => r.text === "Nichtwähler" && r.i)), "Schulportal-Zeichen werden zu Formatierung");
  assert.ok(pj.includes('"href":"https://example.org/w"') && !pj.includes("example.org/a"));
  // Grundschule: Verweise [[pdf:…]] werden zum Namen der Datei im Ordner
  const F1 = "f".repeat(16), F2 = "e".repeat(16);
  const gb = SH.planBlocks({ L: { title: "Josef", portal: "**Einstieg**\n- Bildkarten " + S.pdfRef(F1) + " zeigen\n- __Lehrkraft liest [[pdf:" + F2 + "|Vorlesetext]] vor.__", homework: "" }, n: 2, gs: true, names: new Map([[F1, "Bildkarten Josef.pdf"]]) });
  assert.equal(gb[3].text, "Verlaufsplan");
  const gj = JSON.stringify(gb);
  assert.ok(gj.includes("„Bildkarten Josef.pdf“") && gj.includes("„Material“") && !gj.includes("[[pdf"), gj);
});

test("Prompt „Absätze mit Claude schreiben“: Einheit, Planungsgrundlagen und jede geplante Sitzung lesen, im Chat zeigen, nach Zustimmung alle mit save_weitergabe speichern", () => {
  const ctx = { unitId: "u".repeat(16), title: "Wahlen", subject: "powi", klass: "Q2-GK", gs: false,
    sessions: [{ n: 1, lessonId: "a".repeat(16), title: "Warum wählen?", planned: true, has: false }, { n: 2, lessonId: "b".repeat(16), title: "Wer darf wählen?", planned: true, has: true }, { n: 3, lessonId: null, title: "Zählen", planned: false }] };
  const p = SH.claudeSharePrompt(ctx);
  for (const s of ["`get_unit` (unit_id " + ctx.unitId + ")", "`get_planning_basis`", "Für die Kompetenz gilt das KCGO", "- Sitzung 1: „Warum wählen?“ (lesson_id " + "a".repeat(16) + ")",
    "(lesson_id " + "b".repeat(16) + ") – hat schon einen Absatz", "`save_weitergabe` (unit_id " + ctx.unitId + ", sitzungen: [{lesson_id, passiert, kompetenz, ziel}]) – alle in einem Aufruf",
    "Noch nicht geplant (Sitzung 3)", "„Fehlende Sitzungen“", "Falls der Connector „Unterricks“ in diesem Chat nicht verfügbar ist"]) assert.ok(p.includes(s), s);
  assert.ok(p.indexOf("Zeige mir alle Absätze im Chat. Wenn ich zustimme, speichere sie") > 0, "erst zeigen, dann nach Zustimmung speichern");
  const gp = SH.claudeSharePrompt({ ...ctx, subject: "gs", klass: "gs12345678", gs: true });
  assert.ok(gp.includes("(Grundschule)") && gp.includes("das hinterlegte Curriculum der Grundschule") && gp.includes("Kinder") && !gp.includes("KCGO"));
  // „Stunde mit Claude planen“: der Absatz gleich mit, direkt nach der Zusammenfassung (Gymnasium und Grundschule)
  const step = SH.shareSaveStep("powi", "Q2-GK");
  assert.ok(step.includes("`update_lesson` mit `weitergabe`") && step.includes("aus dem KCGO für das Kurshalbjahr Q2") && step.includes("nie erfunden"));
  const sek = { lessonId: "a".repeat(16), subject: "powi", klass: "Q2-GK", lesson: { title: "Wahlen", topic: "Wahlen", durationMin: 90, date: "2026-11-17", startTime: "08:00" }, materials: [], sheets: [], messages: [] };
  const lp = P.claudeLessonPrompt(sek), sum = S.summarySaveStep(false, false);
  assert.ok(lp.includes(sum + "\n" + step), "direkt nach dem Schritt zur Zusammenfassung");
  const gl = G.claudeGsLessonPrompt({ lessonId: "b".repeat(16), subject: "gs", klass: "gs12345678", course: { short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)", subjectName: "Religion", grade: 2, classes: ["a", "b"] }, lesson: { title: "Josef", durationMin: 45 }, materials: [] });
  assert.ok(gl.includes(S.summarySaveStep(true) + "\n" + SH.shareSaveStep("gs", "gs")));
});

/* ---------- PDF-Dateien (sharepdf.js) ---------- */
const UNIT = { id: "u".repeat(16), subject: "powi", klass: "Q2-GK", title: "Wahlen in Deutschland",
  plan: { titel: "Wahlen in Deutschland", ausgangslage: "Viele junge Menschen wählen nicht.", lernaufgabe: "Einen Aufruf zur Wahl schreiben",
    planungsgrundlage: { name: "KCGO PoWi Q2", begruendung: "Kurshalbjahr Q2" }, schritte: [{ titel: "Problem erschließen", beschreibung: "Karikatur zur Wahlbeteiligung" }, { titel: "Wahlrecht verstehen", beschreibung: "Grundsätze der Wahl" }] },
  rows: [{ uid: "r1", stundenfrage: "Warum wählen so wenige?", ablauf: ["Karikatur", "Gründe sammeln"], schritt: 0 }, { uid: "r2", stundenfrage: "Wer darf wählen?", ablauf: ["Wahlgrundsätze"], schritt: 1 },
    { uid: "r3", stundenfrage: "Wie wird gezählt?", ablauf: ["Sitzverteilung"], schritt: 1 }] };
test("Leupold-Schema-PDF: Schema im Querformat, darunter je Sitzung der Absatz (bzw. der grobe Ablauf), Copyright und Seitenzahl auf jeder Seite", async () => {
  const sessions = SH.shareSessions(UNIT.rows, [{ id: "a", row: "r1", planned: true, shareText: TEXT }, { id: "b", row: "r2", planned: true, shareText: null }]);
  const bytes = await SP.leupoldPdf(UNIT, sessions, { title: UNIT.title, meta: SH.unitMeta(UNIT) }, { lib: PL });
  const doc = await PL.PDFDocument.load(bytes), first = doc.getPage(0).getSize();
  assert.ok(first.width > first.height, "das Schema steht im Querformat");
  const t = await pdfText(bytes);
  for (const s of ["Ausgangslage", "Viele junge Menschen wählen nicht.", "Problem erschließen", "Wahlrecht verstehen", "Einen Aufruf zur Wahl schreiben", "Die Sitzungen der Einheit",
    "Sitzung 1: Warum wählen so wenige?", "Was passiert:", TEXT.passiert, "Zentrale Kompetenz (KCGO):", TEXT.kompetenz, "Ziel:", TEXT.ziel,
    "Sitzung 2: Wer darf wählen?", "Grober Ablauf:", "Wahlgrundsätze", "Sitzung 3: Wie wird gezählt?", "Noch nicht geplant – siehe „Fehlende Sitzungen“."]) assert.ok(t.all.includes(s), s);
  t.pages.forEach((p, i) => { assert.ok(p.includes("Copyright Jan-Rickmer Feindt"), "Seite " + (i + 1)); assert.ok(p.includes("Seite " + (i + 1) + " von " + t.pages.length)); });
  assert.equal(doc.getAuthor(), "Jan-Rickmer Feindt");
  // sehr viele Lernschritte passen nicht auf eine Seite → als Fließtext, nichts geht verloren
  const many = { ...UNIT, plan: { ...UNIT.plan, schritte: Array.from({ length: 40 }, (_, i) => ({ titel: "Schritt " + (i + 1), beschreibung: "Beschreibung ".repeat(12) + (i + 1) })) } };
  const mt = await pdfText(await SP.leupoldPdf(many, sessions, { title: many.title }, { lib: PL }));
  for (const s of ["Lernschritte", "40. Schritt 40", "Zentrale Lernaufgabe", "Sitzung 1: Warum wählen so wenige?"]) assert.ok(mt.all.includes(s), s);
  // ohne Leupold-Schema
  const empty = await pdfText(await SP.leupoldPdf({ ...UNIT, plan: {} }, sessions, { title: "Leer" }, { lib: PL }));
  assert.ok(empty.all.includes("Leupold-Schema: Leer") && empty.all.includes("Sitzung 1: Warum wählen so wenige?"));
});

test("Textdokumente: Titel, Überschriften, fette Teile, Aufzählung, lange Absätze umbrochen, Zeichen außerhalb von WinAnsi ersetzt", async () => {
  const blocks = [...SH.fbExplainBlocks(), { t: "p", runs: [{ text: "Lang ".repeat(400) }] }, { t: "li", runs: [{ text: "Emoji 🎉 und ő" }] }];
  const bytes = await SP.blocksPdf("Das ist ein Feibeitsblatt", blocks, { lib: PL });
  const t = await pdfText(bytes);
  assert.ok(t.pages.length >= 2);
  for (const s of ["Das ist ein Feibeitsblatt", "So funktioniert ein Feibeitsblatt", "Das Notfall-Feibeitsblatt", "Viele Grüße, Jan-Rickmer Feindt"]) assert.ok(t.all.includes(s), s);
  assert.ok(t.all.replace(/\s/g, "").includes("zumgleichenKompetenzerwerb"));
  t.pages.forEach((p) => assert.ok(p.includes("Copyright Jan-Rickmer Feindt")));
  assert.equal((await PL.PDFDocument.load(bytes)).getTitle(), "Das ist ein Feibeitsblatt");
});

/* ---------- Präsentation (sharepres.js) ---------- */
async function deck() {
  const d = await PL.PDFDocument.create(), f = await d.embedFont(PL.StandardFonts.Helvetica), b = await d.embedFont(PL.StandardFonts.HelveticaBold);
  const slide = (lines, mark) => {
    const p = d.addPage([960, 540]);
    p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: PL.rgb(0.12, 0.23, 0.37) });
    lines.forEach(([t, y, s]) => p.drawText(t, { x: 60, y, size: s, font: b, color: PL.rgb(1, 1, 1) }));
    if (mark) p.drawText(S.CODE_SLIDE_LINE, { x: 60, y: 14, size: 9, font: f, color: PL.rgb(0.8, 0.8, 0.8) });
  };
  slide([["Wahlen in Deutschland", 300, 48]]);
  slide([["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", 330, 30], ["Feibeitsblatt „Wer darf wählen?“", 270, 36]], true);
  slide([["Die Hausaufgabe und das Material findest du in Unterricks.", 300, 28]], true);
  slide([["Diskussion", 300, 40], ["Rechts unten steht etwas", 14, 9]]);
  const ctx = d.context, link = ctx.register(ctx.obj({ Type: "Annot", Subtype: "Link", Rect: [60, 290, 360, 340], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PL.PDFString.of("https://example.org/wahl") } }));
  d.getPage(3).node.set(PL.PDFName.of("Annots"), ctx.obj([link]));
  await d.attach(new TextEncoder().encode('{"folien":[{"folie":1,"notizen":["Begrüßen"]}]}'), "unterricks-notizen.json", { mimeType: "application/json" });
  return d.save();
}
/* PowerPoint-Datei lesen und prüfen: jedes XML wohlgeformt (Tags geschachtelt, & nur als Entität), jedes Ziel einer Beziehung vorhanden, jeder Teil mit Inhaltstyp */
const PNG1 = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137]);
function wellFormed(xml, name) {
  const stack = [];
  assert.ok(!/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(xml), name + ": & nur als Entität");
  for (const m of xml.replace(/^<\?xml[^>]*\?>\s*/, "").matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>|<[^>]*>/g)) {
    assert.ok(m[2], name + ": unbekanntes Tag " + m[0].slice(0, 60));
    if (m[1]) assert.equal(stack.pop(), m[2], name + ": schließendes Tag " + m[2]);
    else if (!m[4]) stack.push(m[2]);
  }
  assert.deepEqual(stack, [], name + ": alle Tags geschlossen");
}
async function readPptx(bytes) {
  const z = await readZip(new Uint8Array(bytes)), by = new Map(z.map((e) => [e.name, e.data])), txt = (n) => new TextDecoder().decode(by.get(n));
  const ct = txt("[Content_Types].xml");
  for (const [n, d] of by) if (/\.(xml|rels)$/.test(n)) wellFormed(new TextDecoder().decode(d), n);
  for (const [n] of by) if (!n.endsWith(".rels") && n !== "[Content_Types].xml") assert.ok(ct.includes('PartName="/' + n + '"') || ct.includes('Extension="' + n.split(".").pop() + '"'), "Inhaltstyp für " + n);
  for (const m of ct.matchAll(/PartName="\/([^"]+)"/g)) assert.ok(by.has(m[1]), "Teil vorhanden: " + m[1]);
  for (const [n, d] of by) {
    if (!n.endsWith(".rels")) continue;
    const dir = n.replace(/_rels\/[^/]+$/, "");
    for (const m of new TextDecoder().decode(d).matchAll(/Target="([^"]+)"(\s+TargetMode="External")?/g)) {
      if (m[2]) continue;
      const parts = (dir + m[1]).split("/"), out = [];
      for (const p of parts) { if (p === "..") out.pop(); else if (p && p !== ".") out.push(p); }
      assert.ok(by.has(out.join("/")), n + " → " + m[1]);
    }
  }
  return { by, txt, slides: [...by.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length };
}
test("PowerPoint-Datei (sharepptx.js): vollständiges Paket, Folienbild über die ganze Folie, Link-Flächen, Notizen als Aufzählung, Maskierung, Foliengröße", async () => {
  const bytes = PX.buildPptx({ title: "Wahlen & Co <Test>", author: "Jan-Rickmer Feindt", when: new Date("2026-11-18T10:00:00Z"), slides: [
    { image: { data: PNG1, mime: "image/png" }, w: 960, h: 540, notes: ["Begrüßen und die „Karikatur“ zeigen", "A & B < C\nzweite Zeile", " "], alt: "Wahlen in Deutschland" },
    { image: { data: PNG1, mime: "image/jpeg" }, w: 960, h: 540, links: [{ x: 60, y: 200, w: 300, h: 40, url: "https://www.youtube.com/watch?v=Fk1u8VKrJGA&t=30s" }, { x: 0, y: 0, w: 10, h: 10, url: "javascript:alert(1)" }], notes: [] },
    { image: { data: PNG1, mime: "image/png" }, w: 595, h: 842, notes: ["Hochformat"] }] });
  const p = await readPptx(bytes);
  assert.equal(p.slides, 3);
  assert.ok(p.by.has("ppt/media/image1.png") && p.by.has("ppt/media/image2.jpeg") && p.by.has("ppt/notesSlides/notesSlide1.xml") && !p.by.has("ppt/notesSlides/notesSlide2.xml") && p.by.has("ppt/notesSlides/notesSlide3.xml"),
    "Notizenseite nur zu Folien mit Notizen");
  const pres = p.txt("ppt/presentation.xml");
  assert.ok(pres.includes('<p:sldSz cx="12192000" cy="6858000"/>'), "16:9 wie in PowerPoint (13,33 × 7,5 Zoll)");
  assert.ok(pres.indexOf("<p:sldMasterIdLst>") < pres.indexOf("<p:notesMasterIdLst>") && pres.indexOf("<p:notesMasterIdLst>") < pres.indexOf("<p:sldIdLst>"), "Reihenfolge nach Schema");
  const s1 = p.txt("ppt/slides/slide1.xml"), n1 = p.txt("ppt/notesSlides/notesSlide1.xml");
  assert.ok(s1.includes('<a:off x="0" y="0"/><a:ext cx="12192000" cy="6858000"/>') && s1.includes('descr="Wahlen in Deutschland"'), "Bild über die ganze Folie, Bildbeschreibung");
  assert.ok(n1.includes('<p:ph type="body" sz="quarter" idx="3"/>') && n1.includes("<a:t>Begrüßen und die „Karikatur“ zeigen</a:t>") && n1.includes("<a:t>A &amp; B &lt; C</a:t><" ) && n1.includes("<a:br>"));
  assert.equal((n1.match(/<a:buChar char="•"\/>/g) || []).length, 2, "je Notiz ein Aufzählungspunkt, leere entfallen");
  const r2 = p.txt("ppt/slides/_rels/slide2.xml.rels"), s2 = p.txt("ppt/slides/slide2.xml");
  assert.ok(r2.includes('Target="https://www.youtube.com/watch?v=Fk1u8VKrJGA&amp;t=30s" TargetMode="External"') && !r2.includes("javascript"), "nur sichere Links");
  assert.ok(s2.includes('<a:hlinkClick r:id="rId10"/>') && s2.includes('<a:alpha val="0"/>') && s2.includes('<a:off x="762000" y="2540000"/><a:ext cx="3810000" cy="508000"/>'), "Link-Fläche an der Stelle des Links, durchsichtig");
  const s3 = p.txt("ppt/slides/slide3.xml"), k = 6858000 / (842 * 12700), w3 = Math.round(595 * 12700 * k);
  assert.ok(s3.includes('<a:ext cx="' + w3 + '" cy="6858000"/>') && s3.includes('<a:off x="' + Math.round((12192000 - w3) / 2) + '" y="0"/>'), "andere Seitengröße: mittig eingepasst");
  assert.ok(p.txt("docProps/core.xml").includes("<dc:title>Wahlen &amp; Co &lt;Test&gt;</dc:title>") && p.txt("docProps/core.xml").includes("2026-11-18T10:00:00Z"));
  assert.ok(p.txt("ppt/notesMasters/notesMaster1.xml").includes("<p:notesStyle>") && (p.txt("ppt/theme/theme1.xml").match(/<a:effectStyle>/g) || []).length === 3);
  assert.deepEqual(PX.slideSize(960, 540), { cx: 12192000, cy: 6858000 });
  assert.deepEqual(PX.slideSize(20, 10), { cx: 1828800, cy: 914400 }, "zu klein → auf die Mindestgröße");
  assert.ok(PX.slideSize(10000, 5000).cx <= 51206400, "zu groß → auf die Höchstgröße");
  assert.throws(() => PX.buildPptx({ slides: [] }), /Keine Folien/);
  assert.equal(PX.xmlText("a" + String.fromCharCode(1) + "b\tc"), "ab\tc", "Steuerzeichen außer Tab entfallen");
});
const CODE_SLIDES = [{ n: 2, lines: ["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", "Feibeitsblatt „Wer darf wählen?“"] }, { n: 3, lines: ["Die Hausaufgabe und das Material findest du in Unterricks."] }];
test("Präsentation teilen: reine Codefolie entfernt, Materialfolie bleibt mit überdeckter Unterricks-Zeile, Copyright auf jeder Folie, ohne Anhänge; Notizen als eigene PDF", async () => {
  const colors = [];
  const r = await SR.sharePresentation(await deck(), { codeSlides: CODE_SLIDES, titles: ["Wer darf wählen?"], notes: [{ n: 1, items: ["Begrüßen"] }, { n: 3, items: ["Weg"] }, { n: 4, items: ["Pro und Contra"] }],
    title: "Wahlen", libs: { pdfLib: PL, pdfjs, raster: async (page, i) => ({ data: PNG1, mime: "image/png", n: i }), color: (n, b) => { colors.push([n, Math.round(b.x0), Math.round(b.base)]); return [0.12, 0.23, 0.37]; } } });
  assert.deepEqual([r.kept, r.dropped, r.covered, r.uncovered], [[1, 2, 4], [3], [2], []]);
  assert.deepEqual(colors, [[2, 60, 526]], "die Farbe wird für die Zeile der Materialfolie bestimmt");
  const t = await pdfText(r.bytes);
  assert.equal(t.pages.length, 3);
  t.pages.forEach((p, i) => assert.ok(p.includes("Copyright Jan-Rickmer Feindt"), "Folie " + (i + 1)));
  assert.ok(t.pages[1].includes("Feibeitsblatt „Wer darf wählen?“"), "die Materialfolie bleibt");
  assert.ok(!t.all.includes("Die Hausaufgabe und das Material findest du in Unterricks."), "die reine Codefolie ist weg");
  assert.deepEqual(t.attachments, [], "die Notizen der Lehrkraft stecken nicht mehr als Anhang in der Präsentation");
  // überdeckt: ein Rechteck in der Farbe des Hintergrunds über der Zeile (der Text selbst bleibt unsichtbar darunter)
  const out = await PL.PDFDocument.load(r.bytes);
  assert.equal(out.getAuthor(), "Jan-Rickmer Feindt");
  // Copyright auf Folie 4 nicht über dem Text rechts unten: dann links
  const doc = await pdfjs.getDocument({ data: new Uint8Array(r.bytes).slice(), verbosity: 0 }).promise;
  const items = (await (await doc.getPage(3)).getTextContent()).items, c = items.find((x) => x.str.includes("Copyright"));
  assert.ok(c.transform[4] > 400, "rechts unten, wenn dort frei ist (der Text „Rechts unten …“ steht links)");
  await doc.destroy();
  // Notizen: nur zu den gebliebenen Folien, mit neuen Nummern
  const nt = await pdfText(r.notesBytes);
  assert.ok(nt.all.includes("Begrüßen") && nt.all.includes("Pro und Contra") && !nt.all.includes("Weg"));
  assert.ok(nt.all.includes("Präsentation mit Anmerkungen · für die Lehrkraft"));
  // PowerPoint-Fassung: dieselben drei Folien, Notizen an Folie 1 und 3 (ursprünglich 1 und 4), der Link der Diskussionsfolie als Fläche
  const pp = await readPptx(r.pptxBytes);
  assert.equal(pp.slides, 3);
  assert.deepEqual([...pp.by.keys()].filter((x) => x.startsWith("ppt/notesSlides/notesSlide")).sort(), ["ppt/notesSlides/notesSlide1.xml", "ppt/notesSlides/notesSlide3.xml"]);
  assert.ok(pp.txt("ppt/notesSlides/notesSlide1.xml").includes("<a:t>Begrüßen</a:t>") && pp.txt("ppt/notesSlides/notesSlide3.xml").includes("<a:t>Pro und Contra</a:t>"));
  assert.ok(pp.txt("ppt/slides/_rels/slide3.xml.rels").includes('Target="https://example.org/wahl" TargetMode="External"'), "Link der Folie bleibt anklickbar");
  assert.ok(pp.txt("ppt/slides/slide3.xml").includes('<a:off x="762000" y="2540000"/><a:ext cx="3810000" cy="635000"/>'), "Fläche genau über dem Link (umgerechnet von unten nach oben)");
  assert.ok(pp.txt("ppt/slides/slide2.xml").includes('descr="Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3. Feibeitsblatt „Wer darf wählen?“'), "Bildbeschreibung = sichtbarer Text");
  assert.ok(!pp.txt("ppt/slides/slide2.xml").includes("Unterricks-Codefolie"), "ohne die überdeckte Unterricks-Zeile");
  assert.ok(pp.txt("docProps/core.xml").includes("<dc:creator>Jan-Rickmer Feindt</dc:creator>"));
  // ohne Notizen keine zweite Datei; ohne Canvas (und ohne Farbe) wird nichts überdeckt – lieber die Zeile stehen lassen als ein heller Kasten
  const r2 = await SR.sharePresentation(await deck(), { codeSlides: CODE_SLIDES, titles: ["Wer darf wählen?"], libs: { pdfLib: PL, pdfjs } });
  assert.deepEqual([r2.notesBytes, r2.covered, r2.uncovered], [null, [], [2]]);
  assert.equal(r2.pptxBytes, null, "ohne Zeichnen keine PowerPoint-Fassung – die PDF bleibt");
  assert.ok(r2.pptxError.length > 0);
  // nur Codefolien → alles bleibt (überdeckt)
  const only = await SR.sharePresentation(await deck(), { codeSlides: [1, 2, 3, 4].map((n) => ({ n, lines: [] })), libs: { pdfLib: PL, pdfjs, color: () => [1, 1, 1] } });
  assert.deepEqual(only.kept, [1, 2, 3, 4]);
  await assert.rejects(() => SR.sharePresentation(new TextEncoder().encode("kein PDF"), { libs: { pdfLib: PL, pdfjs } }), /Die Präsentation lässt sich im Browser nicht aufbereiten/);
});

test("Freie Stelle für das Copyright: rechts unten, sonst links, sonst Mitte, sonst ganz am Rand", () => {
  const ln = (x0, x1, base, h = 10) => ({ base, h, map: [{ x0, x1 }] });
  assert.deepEqual(SR.footerSpot([], 960, 540, 100, 7), { x: 960 - 540 * 0.018 - 100, base: 540 - 540 * 0.018 });
  const m = 540 * 0.018;
  assert.equal(SR.footerSpot([ln(800, 950, 530)], 960, 540, 100, 7).x, m, "rechts belegt → links");
  assert.equal(SR.footerSpot([ln(800, 950, 530), ln(0, 200, 530)], 960, 540, 100, 7).x, (960 - 100) / 2, "rechts und links belegt → Mitte");
  assert.deepEqual(SR.footerSpot([ln(0, 960, 530)], 960, 540, 100, 7), { x: 960 - m - 100, base: 540 - 2.1 }, "überall Text → ganz unten am Rand");
});

/* ---------- Server und Connector ---------- */
const TOKEN = "lehrkraft-token-share", NOW = Date.parse("2026-11-18T10:00:00Z");
const callAs = (tok) => async (c, fn, method, path, body, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method, headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code, ...(e.extra || {}) } }; }
};
const call = callAs(TOKEN), pub = callAs(null);
async function mcp(c, method, params) {
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
}
const tool = async (c, name, args) => { const r = await mcp(c, "tools/call", { name, arguments: args }); return { text: r.content[0].text, isError: !!r.isError, data: r.structuredContent }; };
async function base() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = NOW;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  return c;
}
async function unitWithSessions(c) {
  const unit = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "powi", klass: "Q2-GK", title: "Wahlen", params: { start: "2026-11-24", end: "2026-12-18", weekdays: [{ day: 2, minutes: 90, time: "08:00" }] } })).data.unit;
  await call(c, U.routeUnitPatch, "PATCH", "/x", { plan: UNIT.plan, rows: UNIT.rows.map(({ uid, ...r }) => r), assignDates: true }, unit.id);
  const u = (await call(c, U.routeUnitSessions, "POST", "/x", undefined, unit.id)).data.unit;
  const ids = u.rows.map((r) => u.lessons.find((l) => l.row === r.uid).id);
  c.db.raw.prepare("UPDATE lessons SET portal=? WHERE id=?").run("**1) Einstieg**\n- Karikatur", ids[0]);
  c.db.raw.prepare("UPDATE lessons SET portal=? WHERE id=?").run(S.STOP_LINE, ids[1]);
  c.db.raw.prepare("UPDATE lessons SET portal=? WHERE id=?").run("**1) Auszählen**", ids[2]);
  return { u, ids };
}
test("Server: Stand für die Karte (geplant, Absatz), Absatz speichern mit Stand-Schutz (409 statt still überschreiben), strenge Prüfung, Löschen", async () => {
  const c = await base(), { u, ids } = await unitWithSessions(c);
  const st = await call(c, U.routeUnitShare, "GET", "/x", undefined, u.id);
  assert.equal(st.status, 200);
  assert.deepEqual(st.data.lessons.map((l) => [l.id, l.planned, l.shareText]).sort(), ids.map((id, i) => [id, i !== 1, null]).sort(), "geplant = Verlaufsplan mit Inhalt; nur Zwischenstopp zählt nicht");
  assert.equal((await pub(c, U.routeUnitShare, "GET", "/x", undefined, u.id)).status, 401);
  // speichern (Karte der Einheit, mit Stand) → Zeitpunkt
  const ok = await call(c, L.routeLessonPatch, "PATCH", "/x", { shareText: TEXT, shareTextBase: null }, ids[0]);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.data.lesson.shareText, { ...TEXT, at: NOW });
  // inzwischen hat Claude gespeichert (anderer Zeitpunkt): die Karte mit dem alten Stand bekommt 409 mit dem neuen Absatz
  c.now = NOW + 5000;
  await tool(c, "update_lesson", { lesson_id: ids[0], weitergabe: { ...TEXT, ziel: "Neues Ziel von Claude." } });
  const conflict = await call(c, L.routeLessonPatch, "PATCH", "/x", { shareText: { ...TEXT, passiert: "Meine Fassung." }, shareTextBase: NOW }, ids[0]);
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.code, "share_conflict");
  assert.deepEqual(conflict.data.current, { ...TEXT, ziel: "Neues Ziel von Claude.", at: NOW + 5000 });
  assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { shareText: { ...TEXT, passiert: "Meine Fassung." }, shareTextBase: NOW + 5000 }, ids[0])).status, 200);
  const base0 = await call(c, L.routeLessonPatch, "PATCH", "/x", { shareText: TEXT, shareTextBase: null }, ids[2]);
  assert.equal(base0.status, 200, "noch kein Absatz: Stand null passt");
  assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { shareText: TEXT, shareTextBase: null }, ids[2])).status, 409, "jetzt gibt es einen – null passt nicht mehr");
  // streng: zu lang, falsche Form, falscher Stand
  const long = await call(c, L.routeLessonPatch, "PATCH", "/x", { shareText: { passiert: "x".repeat(901) } }, ids[1]);
  assert.deepEqual([long.status, long.data.error], [400, "Was passiert ist zu lang (901 Zeichen, höchstens 900) – bitte kürzen."]);
  assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { shareText: "Text" }, ids[1])).status, 400);
  assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { shareText: TEXT, shareTextBase: "gestern" }, ids[1])).status, 400);
  // löschen: alle drei leer
  const del = await call(c, L.routeLessonPatch, "PATCH", "/x", { shareText: { passiert: "", kompetenz: "", ziel: "" } }, ids[2]);
  assert.equal(del.data.lesson.shareText, null);
  assert.equal(c.db.raw.prepare("SELECT share_text FROM lessons WHERE id=?").get(ids[2]).share_text, null);
  // Sitzungsdatei: Absatz bereinigt in der Datei, beim Laden ersetzt er den bisherigen; eine Datei ohne Absatz (auch eine ältere) löscht ihn
  const IO = await import("../../public/sessionio.js");
  const file = (lesson) => SF.cleanSessionFile({ kind: SF.SESSION_FILE.kind, v: SF.SESSION_FILE.v, source: { subject: "powi", klass: "Q2-GK", date: "2026-11-24", nextDate: "2026-12-01" }, lesson });
  const withText = file({ title: "Mit Absatz", shareText: { ...TEXT, passiert: "  " + TEXT.passiert + " " } }), without = file({ title: "Ohne Absatz" });
  assert.deepEqual(withText.lesson.shareText, TEXT);
  const pw = IO.planSessionImport(withText, { date: "2026-11-24", klass: "Q2-GK" }), po = IO.planSessionImport(without, { date: "2026-11-24", klass: "Q2-GK" });
  assert.deepEqual([pw.lesson.shareText, po.lesson.shareText], [TEXT, null], "die Datei ersetzt den Absatz (ohne Absatz: null)");
  c.now = NOW + 9000;
  let im = await call(c, L.routeLessonImport, "POST", "/x", { lesson: pw.lesson, chat: [] }, ids[1]);
  assert.equal(im.status, 200, JSON.stringify(im.data));
  assert.deepEqual(JSON.parse(c.db.raw.prepare("SELECT share_text FROM lessons WHERE id=?").get(ids[1]).share_text), { v: 1, ...TEXT, at: NOW + 9000 });
  im = await call(c, L.routeLessonImport, "POST", "/x", { lesson: po.lesson, chat: [] }, ids[1]);
  assert.equal(im.status, 200);
  assert.equal(c.db.raw.prepare("SELECT share_text FROM lessons WHERE id=?").get(ids[1]).share_text, null, "Datei ohne Absatz: der bisherige passt nicht mehr und ist weg");
  await call(c, L.routeLessonPatch, "PATCH", "/x", { shareText: TEXT }, ids[1]);
  im = await call(c, L.routeLessonImport, "POST", "/x", { lesson: { title: "Ohne Feld" }, chat: [] }, ids[1]);
  assert.ok(c.db.raw.prepare("SELECT share_text FROM lessons WHERE id=?").get(ids[1]).share_text, "ohne das Feld (ältere Seite) bleibt er");
});

test("Connector: save_weitergabe (alle Sitzungen einer Einheit auf einmal, streng geprüft), update_lesson weitergabe, get_lesson und get_unit nennen den Absatz", async () => {
  const c = await base(), { u, ids } = await unitWithSessions(c);
  const tools = (await mcp(c, "tools/list", {})).tools, sw = tools.find((t) => t.name === "save_weitergabe"), ul = tools.find((t) => t.name === "update_lesson");
  assert.ok(sw && sw.inputSchema.properties.sitzungen && ul.inputSchema.properties.weitergabe);
  assert.deepEqual(sw.inputSchema.required.sort(), ["sitzungen", "unit_id"]);
  // vorher: get_unit listet die Sitzungen mit Stand, get_lesson nennt den fehlenden Absatz und die Quelle der Kompetenz
  const gu0 = await tool(c, "get_unit", { unit_id: u.id });
  assert.ok(gu0.text.includes("## Absatz für die Weitergabe (für „Unterrichtseinheit mit KollegInnen teilen“; speichern mit save_weitergabe)"));
  assert.ok(gu0.text.includes("- Sitzung 1 (lesson_id " + ids[0] + "): geplant, Absatz fehlt") && gu0.text.includes("- Sitzung 2 (lesson_id " + ids[1] + "): noch nicht geplant, Absatz fehlt"));
  const gl0 = await tool(c, "get_lesson", { lesson_id: ids[0] });
  assert.ok(gl0.text.includes("## Absatz für die Weitergabe\n(noch keiner – schreibe ihn mit update_lesson und weitergabe, zusammen mit der Zusammenfassung; die zentrale Kompetenz aus dem KCGO für das Kurshalbjahr Q2)"));
  // Fehler: fremde Sitzung, doppelt, zu lang, leer – nichts gespeichert
  const other = await L.createLesson(c.db, { subject: "powi", klass: "Q2-GK", title: "Fremd", date: "2026-12-01" }, c.now);
  for (const [args, msg] of [[{ unit_id: u.id, sitzungen: [] }, "sitzungen ist eine Liste"], [{ unit_id: u.id, sitzungen: [{ lesson_id: other.id, ...TEXT }] }, "gehört nicht (mehr) zu dieser Einheit"],
    [{ unit_id: u.id, sitzungen: [{ lesson_id: ids[0], ...TEXT }, { lesson_id: ids[0], ...TEXT }] }, "steht doppelt in der Liste"],
    [{ unit_id: u.id, sitzungen: [{ lesson_id: ids[0], ...TEXT }, { lesson_id: ids[1], ...TEXT, kompetenz: "k".repeat(501) }] }, "Eintrag 2 (Wer darf wählen?): Zentrale Kompetenz ist zu lang"]]) {
    const r = await tool(c, "save_weitergabe", args);
    assert.ok(r.isError && r.text.includes(msg), r.text);
  }
  assert.equal(c.db.raw.prepare("SELECT COUNT(*) AS n FROM lessons WHERE share_text IS NOT NULL").get().n, 0, "bei einem Fehler wird nichts gespeichert");
  const ok = await tool(c, "save_weitergabe", { unit_id: u.id, sitzungen: [{ lesson_id: ids[0], ...TEXT }, { lesson_id: ids[2], ...TEXT, passiert: "Auszählen im Wahllokal." }] });
  assert.ok(!ok.isError, ok.text);
  assert.ok(ok.text.startsWith("Gespeichert: 2 Absätze für die Weitergabe („Warum wählen so wenige?“, „Wie wird gezählt?“).") && ok.text.includes("Alle geplanten Sitzungen haben jetzt einen Absatz.") && ok.text.includes("Karte „Mit Kolleg:innen teilen“"));
  assert.deepEqual(JSON.parse(c.db.raw.prepare("SELECT share_text FROM lessons WHERE id=?").get(ids[0]).share_text), { v: 1, ...TEXT, at: NOW });
  const gl = await tool(c, "get_lesson", { lesson_id: ids[0] });
  assert.ok(gl.text.includes("## Absatz für die Weitergabe\nWas passiert: " + TEXT.passiert + "\nZentrale Kompetenz (KCGO): " + TEXT.kompetenz + "\nZiel: " + TEXT.ziel + "\n(Stand: "));
  const gu = await tool(c, "get_unit", { unit_id: u.id });
  assert.ok(gu.text.includes("- Sitzung 1 (lesson_id " + ids[0] + "): geplant, Absatz vorhanden"));
  // update_lesson: streng, löschen mit drei leeren Teilen
  const bad = await tool(c, "update_lesson", { lesson_id: ids[0], weitergabe: { passiert: "x".repeat(901) } });
  assert.ok(bad.isError && bad.text.startsWith("weitergabe: Was passiert ist zu lang"));
  assert.ok(!(await tool(c, "update_lesson", { lesson_id: ids[0], weitergabe: { passiert: "", kompetenz: "", ziel: "" } })).isError);
  assert.equal(c.db.raw.prepare("SELECT share_text FROM lessons WHERE id=?").get(ids[0]).share_text, null);
  const miss = await tool(c, "save_weitergabe", { unit_id: u.id, sitzungen: [{ lesson_id: ids[2], ...TEXT }] });
  assert.ok(miss.text.includes("Noch ohne vollständigen Absatz, obwohl geplant: Sitzung 1."));
  // unvollständig zählt nicht als vorhanden (wie in der Karte)
  await tool(c, "update_lesson", { lesson_id: ids[0], weitergabe: { passiert: TEXT.passiert, kompetenz: "", ziel: "" } });
  const gu2 = await tool(c, "get_unit", { unit_id: u.id });
  assert.ok(gu2.text.includes("- Sitzung 1 (lesson_id " + ids[0] + "): geplant, Absatz unvollständig (es fehlt ein Teil)"), gu2.text.slice(-400));
});

/* ---------- ZIP-Ordner (share.js) im Browser-Ersatz ---------- */
test("ZIP-Ordner: Leupold-Schema, Erklärung, Fehlende Sitzungen, je geplanter Sitzung Präsentation (aufbereitet), Notizen, Verlaufsplan und alle PDF-Dateien – nichts anderes", async () => {
  const pres = await deck(), ab = await (async () => { const d = await PL.PDFDocument.create(); d.addPage().drawText("Arbeitsblatt M1"); return d.save(); })();
  const notfall = await (async () => { const d = await PL.PDFDocument.create(); d.addPage().drawText("Notfall-Feibeitsblatt"); return d.save(); })();
  const blobs = { p1: pres, m1: ab, n1: notfall, t1: ab, k1: ab, o1: ab };
  const files = [
    { id: "p1", kind: "file", area: "presentation", name: "Wahlen.pdf", mime: "application/pdf", status: "ready", codeSlides: CODE_SLIDES, notes: 1 },
    { id: "m1", kind: "file", area: "student", name: "M1 Arbeitsblatt.pdf", mime: "application/pdf", status: "ready" },
    { id: "n1", kind: "file", area: "student", name: "Notfall-Feibeitsblatt Wer darf wählen.pdf", mime: "application/pdf", status: "ready", source: "notfall" },
    { id: "t1", kind: "file", area: "teacher", name: "Lösung M1.pdf", mime: "application/pdf", status: "ready" },
    { id: "k1", kind: "file", area: "print", name: "28x - sw - beidseitig - PoWiQ2 - M1.pdf", mime: "application/pdf", status: "ready", design: { outdated: true } },
    { id: "o1", kind: "file", area: "teacher", name: "Präsentation mit Anmerkungen.pdf", mime: "application/pdf", status: "ready", notesOf: "p1" },
    { id: "w1", kind: "file", area: "student", name: "Tabelle.docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", status: "ready" },
    { id: "x1", kind: "file", area: "archive", name: "Vertretung.pdf", mime: "application/pdf", status: "ready" },
    { id: "q1", kind: "file", area: "print", name: "Noch nicht gedruckt.pdf", mime: "application/pdf", status: "rendering" },
    { id: "l1", kind: "link", area: "student", name: "Wahl-O-Mat", url: "https://example.org/wahl" },
    { id: "s1", kind: "text", area: "student", name: "Tafelbild", text: "# Tafelbild\n\n- Wahlrecht" },
  ];
  const lessons = [{ id: "A".repeat(16), row: "r1", title: "Warum wählen so wenige?", planned: true, shareText: { ...TEXT, at: NOW } }, { id: "B".repeat(16), row: "r2", title: "Wer darf wählen?", planned: false, shareText: null },
    { id: "C".repeat(16), row: "r3", title: "Wie wird gezählt?", planned: true, shareText: null }];
  const calls = [];
  globalThis.__tapi = async (method, path) => {
    calls.push(method + " " + path);
    if (path === "/api/teacher/units/" + UNIT.id + "/share") return { lessons };
    const m = /^\/api\/teacher\/lessons\/(\w+)\?full=1$/.exec(path);
    if (m) {
      const L0 = lessons.find((x) => x.id === m[1]);
      return { lesson: { ...L0, portal: "**1) Einstieg**\n- Karikatur", homework: "", teacherSummary: "Kurz.", durationMin: 90 }, files: m[1] === "A".repeat(16) ? files : [], sheets: m[1] === "A".repeat(16) ? [{ title: "Wer darf wählen?", kind: "normal" }] : [] };
    }
    if (path === "/api/teacher/files/p1/notes") return { notes: [{ n: 1, items: ["Begrüßen"] }] };
    const f = /^\/api\/teacher\/files\/(\w+)\/link$/.exec(path);
    if (f) return { url: "/dl/" + f[1] };
    throw new Error("unerwartet: " + method + " " + path);
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { const id = String(url).split("/dl/")[1]; return blobs[id] ? new Response(blobs[id]) : new Response("nein", { status: 404 }); };
  const steps = [];
  let r;
  try { r = await SZ.buildShareZip(UNIT, { onStep: (m) => steps.push(m), presLibs: { raster: async () => ({ data: PNG1, mime: "image/png" }) } }); }
  finally { globalThis.fetch = realFetch; delete globalThis.__tapi; }
  assert.equal(r.name, SZ.shareZipName(UNIT));
  assert.ok(r.name.endsWith(" - zum Teilen.zip") && r.name.includes("Wahlen in Deutschland"), r.name);
  assert.deepEqual([r.sessions, r.missing, r.noText, r.fb], [2, 1, [3], true]);
  const zip = await readZip(new Uint8Array(await r.blob.arrayBuffer())), names = zip.map((e) => e.name).sort();
  assert.deepEqual(names, ["Erklärung - Das ist ein Feibeitsblatt.pdf", "Fehlende Sitzungen.pdf", "Leupold-Schema - Wahlen in Deutschland.pdf",
    "Sitzung 1/28x - sw - beidseitig - PoWiQ2 - M1.pdf", "Sitzung 1/Lösung M1.pdf", "Sitzung 1/M1 Arbeitsblatt.pdf", "Sitzung 1/Notfall-Feibeitsblatt Wer darf wählen.pdf",
    "Sitzung 1/Notizen zu den Folien - Sitzung 1.pdf", "Sitzung 1/Präsentation - Sitzung 1.pdf", "Sitzung 1/Präsentation - Sitzung 1.pptx", "Sitzung 1/Tafelbild.pdf", "Sitzung 1/Verlaufsplan - Sitzung 1.pdf",
    "Sitzung 3/Verlaufsplan - Sitzung 3.pdf"].sort());
  const get = (n) => zip.find((e) => e.name === n).data;
  assert.deepEqual([...get("Sitzung 1/M1 Arbeitsblatt.pdf")], [...ab], "PDF-Dateien unverändert");
  const pt = await pdfText(get("Sitzung 1/Präsentation - Sitzung 1.pdf"));
  assert.equal(pt.pages.length, 3);
  assert.ok(pt.pages.every((p) => p.includes("Copyright Jan-Rickmer Feindt")));
  const zp = await readPptx(get("Sitzung 1/Präsentation - Sitzung 1.pptx"));
  assert.equal(zp.slides, 3, "PowerPoint mit denselben Folien wie die PDF");
  assert.ok(zp.txt("ppt/notesSlides/notesSlide1.xml").includes("<a:t>Begrüßen</a:t>"), "Notizen der Lehrkraft in den Notizen der Folie");
  const lp = await pdfText(get("Leupold-Schema - Wahlen in Deutschland.pdf"));
  assert.ok(lp.all.includes(TEXT.kompetenz) && lp.all.includes("Sitzung 2: Wer darf wählen?"));
  const mt = await pdfText(get("Fehlende Sitzungen.pdf"));
  assert.ok(mt.all.includes("Sitzung 2: Wer darf wählen?") && !mt.all.includes("Sitzung 1:") && mt.all.includes("Wahlgrundsätze"));
  const vp = await pdfText(get("Sitzung 1/Verlaufsplan - Sitzung 1.pdf"));
  assert.ok(vp.all.includes("Stundenverlauf") && vp.all.includes("Wahl-O-Mat") && vp.all.includes("https://example.org/wahl") && vp.all.includes("Zusammenfassung der Sitzung für die Lehrkraft"));
  // Hinweise: Codefolie entfernt, Zeile nicht überdeckt (kein Canvas im Test), andere Dateiart, nicht fertig, nach dem Druck geändert
  const n = r.notes.join(" ");
  for (const s of ["Sitzung 1: eine Codefolie ohne Material entfernt (Folie 3).", "Sitzung 1: Auf Folie 2 ließ sich die Zeile „Unterricks-Codefolie …“ nicht finden bzw. überdecken.",
    "„Tabelle.docx“ ist keine PDF-Datei", "„Noch nicht gedruckt.pdf“ ist noch nicht fertig", "„28x - sw - beidseitig - PoWiQ2 - M1.pdf“ wurde nach dem letzten Druck noch geändert"]) assert.ok(n.includes(s), s);
  assert.ok(!calls.some((x) => x.includes("/files/o1/") || x.includes("/files/x1/") || x.includes("/files/q1/")), "Anmerkungs-PDF, Archiv und nicht fertige Dateien werden nicht geladen");
  assert.ok(!calls.some((x) => x.includes("B".repeat(16))), "nicht geplante Sitzungen werden nicht gelesen");
  assert.ok(steps.includes("Leupold-Schema …"));
  // Grundschule: keine Erklärung zum Feibeitsblatt; abgebrochen → nichts
  globalThis.__tapi = async (method, path) => (path.endsWith("/share") ? { lessons: [] } : { lesson: {}, files: [], sheets: [] });
  try {
    const g = await SZ.buildShareZip({ ...UNIT, subject: "gs", klass: "gs12345678", course: { gs: { short: "Religion 2ab", label: "Religion", gradeText: "Jahrgang 2" } } });
    const gz = (await readZip(new Uint8Array(await g.blob.arrayBuffer()))).map((e) => e.name).sort();
    assert.deepEqual(gz, ["Fehlende Sitzungen.pdf", "Leupold-Schema - Wahlen in Deutschland.pdf"]);
    assert.ok(g.name.includes("Religion 2ab"));
    await assert.rejects(() => SZ.buildShareZip(UNIT, { cancelled: () => true }), (e) => e.cancelled === true);
  } finally { delete globalThis.__tapi; }
});

/* ---------- Schema (Prüfung Nachtrag 39): eine frische Datenbank bleibt unter 50 D1-Aufrufen ---------- */
test("Schema: frische Datenbank mit wenigen Aufrufen (Spalten je Tabelle in einem Batch), Indizes angelegt; gleichzeitig angelegte Spalte stört nicht", async () => {
  const { fakeD1 } = await import("./fake-d1.mjs");
  const count = (db, race = null) => {
    const c = { calls: 0, inBatch: false }, prep = db.prepare.bind(db), batch = db.batch.bind(db);
    db.prepare = (sql) => { const s = prep(sql); for (const k of ["run", "all", "first"]) { const f = s[k]; s[k] = (...a) => { if (!c.inBatch) c.calls++; return f(...a); }; } return s; };
    db.batch = async (list) => { c.calls++; if (race) { const r = race; race = null; r(db); } c.inBatch = true; try { return await batch(list); } finally { c.inBatch = false; } };   // ein Batch = ein Aufruf
    return c;
  };
  const fresh = fakeD1(), c = count(fresh);
  const D = await import("../../worker/db.js?schema39a");
  await D.ensureSchema(fresh);
  assert.ok(c.calls <= 20, "höchstens 20 Aufrufe, waren " + c.calls);
  const cols = (t) => new Set(fresh.raw.prepare("PRAGMA table_info(" + t + ")").all().map((r) => r.name));
  for (const [t, col] of D.COLUMNS) assert.ok(cols(t).has(col), t + "." + col);
  const idx = new Set(fresh.raw.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => r.name));
  for (const name of ["lessons_unit_row", "lessons_parent_hash", "lessons_date", "files_cards", "lessons_day"]) assert.ok(idx.has(name), "Index " + name);
  // eine andere Instanz legt die erste nachträgliche Spalte von „lessons“ gerade an: der Batch scheitert, danach einzeln ergänzt
  const raced = fakeD1(), first = D.COLUMNS.find((x) => x[0] === "lessons");
  let n = 0;
  count(raced, () => {});   // der Schema-Batch selbst läuft unverändert
  const keep = raced.batch;
  raced.batch = async (list) => { if (++n === 2) raced.raw.exec("ALTER TABLE " + first[0] + " ADD COLUMN " + first[1] + " " + first[2]); return keep(list); };
  const D2 = await import("../../worker/db.js?schema39b");
  await D2.ensureSchema(raced);
  for (const [t, col] of D2.COLUMNS) assert.ok(new Set(raced.raw.prepare("PRAGMA table_info(" + t + ")").all().map((r) => r.name)).has(col), "nach dem Wettlauf: " + t + "." + col);
});

/* ---------- Befunde der Prüfung (Nachtrag 39) ---------- */
test("Prüfung: Materialfolien mit „Feibeitsblatt“/„Arbeitsblatt“ bleiben, allgemeine Einzelwörter retten keine Codefolie; die Überdeckung trifft nur den Abschnitt der Unterricks-Zeile", () => {
  assert.equal(SH.isMaterialSlide(["Öffnet das Feibeitsblatt in Unterricks"], ["Wer darf wählen?"]), true, "Feibeitsblatt in der Überschrift: bleibt");
  assert.equal(SH.isMaterialSlide(["Die Hausaufgabe und das Material findest du in Unterricks."], ["Hausaufgabe", "Material"]), false, "allgemeine Titel zählen nicht");
  assert.equal(SH.isMaterialSlide(["Bearbeitet die Quelle Grundgesetz in Unterricks"], ["Grundgesetz Artikel 38"]), false, "Titel nur zum Teil: weiterhin Codefolie");
  const line = (text, base, h = 9, x0 = 60, gapAt = -1, gap = 0) => ({ text, base, h, map: Array.from(text, (_, i) => ({ x0: x0 + i * 4 + (gapAt >= 0 && i >= gapAt ? gap : 0), x1: x0 + i * 4 + 4 + (gapAt >= 0 && i >= gapAt ? gap : 0), h })) });
  const t = S.CODE_SLIDE_LINE + "   Seite 2", b = SH.markBoxes([line(t, 526, 9, 60, S.CODE_SLIDE_LINE.length + 3, 500)]);
  assert.equal(b.length, 1);
  assert.ok(b[0].x1 <= 60 + S.CODE_SLIDE_LINE.length * 4 + 4, "die Seitenzahl rechts auf derselben Grundlinie bleibt sichtbar");
});

test("Prüfung: unvollständiger Absatz – vorhandene Teile und grober Ablauf; „Fehlende Sitzungen“ der Grundschule ohne Präsentation; Regeln der Grundschule; langer Titel umbrochen", async () => {
  const rows = [{ uid: "r1", stundenfrage: "Warum?", ablauf: ["Karikatur"], schritt: 0 }];
  const part = SP.sessionBlocks(SH.shareSessions(rows, [{ id: "a", row: "r1", planned: true, shareText: { passiert: "Nur dieser Teil.", kompetenz: "", ziel: "" } }]), [], UNIT);
  const pj = JSON.stringify(part);
  assert.ok(pj.includes("Nur dieser Teil.") && pj.includes("Grober Ablauf: ") && pj.includes("Karikatur"), "vorhandene Teile und der grobe Ablauf");
  const full = JSON.stringify(SP.sessionBlocks(SH.shareSessions(rows, [{ id: "a", row: "r1", planned: true, shareText: TEXT }]), [], UNIT));
  assert.ok(!full.includes("Grober Ablauf"), "vollständig: nur der Absatz");
  const gm = JSON.stringify(SH.missingBlocks(SH.shareSessions(rows, []), [], { gs: true })), ym = JSON.stringify(SH.missingBlocks(SH.shareSessions(rows, []), []));
  assert.ok(gm.includes("Verlaufsplan und Material fehlen noch.") && !gm.includes("Präsentation") && ym.includes("Präsentation, Verlaufsplan und Material fehlen noch."));
  const gstep = SH.shareSaveStep("gs", "gs12345678");
  assert.ok(gstep.includes("Ohne Namen von Kindern") && gstep.includes("keine Verweise [[pdf:…]]") && gstep.includes("(ohne Vorlage formuliert)"));
  assert.ok(SH.shareSaveStep("powi", "8B").includes("Ohne Namen von Schüler:innen") && SH.shareSaveStep("powi", "8B").includes("keine Schulportal-Zeichen"));
  assert.ok(SH.SHARE_RULES.includes("Schüler:innen bzw. Kinder") && SH.SHARE_RULES.includes("keine Verweise [[pdf:…]]"), "Connector: Regeln für beide Schulformen");
  // langer Titel: umbrochen bzw. kleiner, nichts über den rechten Rand
  const long = { ...UNIT, title: "Wahlen in Deutschland – Beteiligung, Wahlrecht, Wahlsysteme und die Frage, ob eine Wahlpflicht die Demokratie stärken würde" };
  const bytes = await SP.leupoldPdf(long, [], { title: long.title, meta: SH.unitMeta(long) }, { lib: PL });
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes).slice(), verbosity: 0 }).promise, pg = await doc.getPage(1), W = pg.getViewport({ scale: 1 }).width;
  const items = (await pg.getTextContent()).items.filter((x) => x.str.trim());
  assert.ok(items.every((x) => x.transform[4] + x.width <= W - 30), "kein Text über den rechten Rand");
  assert.ok(items.map((x) => x.str).join(" ").replace(/\s+/g, " ").includes("die Demokratie stärken würde"), "der ganze Titel steht da");
  await doc.destroy();
});

test("Prüfung: ältere Präsentation mit aufgedrucktem Sitzungscode – auf allen Folien überdeckt, Feibeitsblatt-Codes bleiben, Hinweis", async () => {
  const d = await PL.PDFDocument.create(), f = await d.embedFont(PL.StandardFonts.HelveticaBold);
  const slide = (lines) => { const p = d.addPage([960, 540]); p.drawRectangle({ x: 0, y: 0, width: 960, height: 540, color: PL.rgb(1, 1, 1) }); lines.forEach(([t, y, s]) => p.drawText(t, { x: 60, y, size: s, font: f, color: PL.rgb(0, 0, 0) })); };
  slide([["Wahlen", 420, 40], ["AEH-4VY", 250, 96]]);
  slide([["Bearbeitet das Feibeitsblatt KLM-3PQ", 330, 30], ["Code: AEH-4VY", 200, 30]]);
  slide([["Diskussion", 300, 40]]);
  const colored = [];
  const r = await SR.sharePresentation(await d.save(), { excludeCodes: ["KLM3PQ"], pptx: false, libs: { pdfLib: PL, pdfjs, color: (n, b) => { colored.push([n, Math.round(b.h)]); return [1, 1, 1]; } } });
  assert.deepEqual(r.legacy, { code: "AEH-4VY", slides: [1, 2], missed: [] });
  assert.ok(colored.some(([n]) => n === 1) && colored.some(([n]) => n === 2) && !colored.some(([n]) => n === 3));
  const t = await pdfText(r.bytes);
  assert.ok(t.pages[1].includes("KLM-3PQ"), "der Code des Feibeitsblatts bleibt (Text ohnehin; überdeckt wird nur der Sitzungscode)");
  // ohne Farbe/Canvas: gemeldet statt überdeckt
  const r2 = await SR.sharePresentation(await d.save(), { pptx: false, libs: { pdfLib: PL, pdfjs } });
  assert.deepEqual([r2.legacy.slides, r2.legacy.missed], [[], [1, 2]]);
  // neue Präsentation ohne großen Code: kein Hinweis
  assert.equal((await SR.sharePresentation(await deck(), { codeSlides: CODE_SLIDES, pptx: false, libs: { pdfLib: PL, pdfjs, color: () => [0, 0, 0] } })).legacy, null);
});

test("Prüfung: ZIP – Verweise auf Dateien anderer Einheiten werden mitgenommen, auf Dateien anderer Ordner mit dem echten Namen genannt; fehlendes Notfall-Feibeitsblatt, Sitzung ohne Präsentation, Selbstlern-Phase (ursprüngliche Planung)", async () => {
  const A = "a".repeat(16), B = "b".repeat(16), F1 = "1".repeat(16), F2 = "2".repeat(16), F3 = "3".repeat(16), F4 = "4".repeat(16);
  const pdf = async (label) => { const d = await PL.PDFDocument.create(); d.addPage().drawText(label); return d.save(); };
  const blobs = { [F1]: await pdf("Karten aus Sitzung 1"), [F2]: await pdf("Karten anderer Einheit"), [F3]: await pdf("Archiviertes Blatt"), [F4]: await pdf("Selbstlern-Station") };
  const GSU = { ...UNIT, subject: "gs", klass: "gs12345678", rows: UNIT.rows.slice(0, 2), course: { gs: { short: "Religion 2c", label: "Religion", gradeText: "Jahrgang 2" } } };
  const lessons = [{ id: A, row: "r1", title: "Eins", planned: true, shareText: TEXT }, { id: B, row: "r2", title: "Zwei", planned: true, shareText: TEXT }];
  const det = {
    [A]: { lesson: { title: "Eins", portal: "**Sitzkreis**\n- " + S.pdfRef(F1) + " zeigen", homework: "" }, files: [{ id: F1, kind: "file", area: "teacher", name: "Bildkarten: Josef?.pdf", mime: "application/pdf", status: "ready" }], sheets: [] },
    [B]: { lesson: { title: "Zwei", portal: "**Erzählung**\n- " + S.pdfRef(F1) + " und " + S.pdfRef(F2) + " zeigen", homework: "" }, files: [], sheets: [],
      courseCards: [{ id: F1, name: "Bildkarten: Josef?.pdf", lessonId: A, mime: "application/pdf", kind: "file" }, { id: F2, name: "Arche Noah.pdf", lessonId: "x".repeat(16), mime: "application/pdf", kind: "file" }] },
  };
  globalThis.__tapi = async (m, path) => {
    if (path.endsWith("/share")) return { lessons };
    const x = /lessons\/(\w+)\?full=1$/.exec(path); if (x) return det[x[1]];
    const f = /files\/(\w+)\/link$/.exec(path); if (f) return { url: "/dl/" + f[1] };
    throw new Error("unerwartet " + path);
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => new Response(blobs[String(url).split("/dl/")[1]]);
  try {
    const r = await SZ.buildShareZip(GSU);
    const z = await readZip(new Uint8Array(await r.blob.arrayBuffer())), names = z.map((e) => e.name).sort();
    assert.deepEqual(names, ["Leupold-Schema - Wahlen in Deutschland.pdf", "Sitzung 1/Bildkarten Josef.pdf", "Sitzung 1/Verlaufsplan - Sitzung 1.pdf", "Sitzung 2/Arche Noah.pdf", "Sitzung 2/Verlaufsplan - Sitzung 2.pdf"]);
    const vp2 = (await pdfText(z.find((e) => e.name === "Sitzung 2/Verlaufsplan - Sitzung 2.pdf").data)).all;
    assert.ok(vp2.includes("„Bildkarten Josef.pdf (im Ordner „Sitzung 1“)“") && vp2.includes("„Arche Noah.pdf“"), "echter Name im anderen Ordner; Datei einer anderen Einheit liegt im eigenen Ordner – " + vp2);
    // Gymnasium: Feibeitsblatt ohne Notfall-Feibeitsblatt, Sitzung ohne Präsentation, Selbstlern-Phase mit Archiv
    det[A] = { lesson: { title: "Eins", portal: "**Selbstlern-Stationen**", homework: "" }, sheets: [{ code: "KLM-3PQ", title: "Wer darf wählen?", kind: "" }],
      files: [{ id: F3, kind: "file", area: "archive", name: "M1 Original.pdf", mime: "application/pdf", status: "ready" }, { id: F4, kind: "file", area: "student", name: "Station 1.pdf", mime: "application/pdf", status: "ready" }],
      substitute: { status: "selbstlern", archive: { portal: "**1) Einstieg**\n- Original geplant", homework: "", sheets: [{ code: "KLM-3PQ", title: "Wer darf wählen?", kind: "" }], files: [F3], fileAreas: { [F3]: "student" } } } };
    det[B] = { lesson: { title: "Zwei", portal: "**1) Einstieg**", homework: "" }, files: [], sheets: [] };
    const g = await SZ.buildShareZip({ ...UNIT, rows: UNIT.rows.slice(0, 2) });
    const gz = await readZip(new Uint8Array(await g.blob.arrayBuffer())), gn = gz.map((e) => e.name).sort();
    assert.ok(gn.includes("Sitzung 1/M1 Original.pdf") && !gn.includes("Sitzung 1/Station 1.pdf"), "Selbstlern-Phase: ursprüngliches Material, nicht die Stationen – " + gn.join(", "));
    const v1 = (await pdfText(gz.find((e) => e.name === "Sitzung 1/Verlaufsplan - Sitzung 1.pdf").data)).all;
    assert.ok(v1.includes("Original geplant") && !v1.includes("Selbstlern-Stationen"), "Verlaufsplan aus der ursprünglichen Planung");
    const n = g.notes.join(" ");
    for (const s of ["Sitzung 1: Für diese Sitzung gilt eine Selbstlern-Phase – im Ordner steht die ursprüngliche Planung.", "Sitzung 1: Zum Feibeitsblatt „Wer darf wählen?“ fehlt das Notfall-Feibeitsblatt",
      "Sitzung 2: Zu dieser Sitzung gibt es keine Präsentation."]) assert.ok(n.includes(s), s);
    assert.ok(gn.includes("Erklärung - Das ist ein Feibeitsblatt.pdf"));
  } finally { globalThis.fetch = realFetch; delete globalThis.__tapi; }
});
