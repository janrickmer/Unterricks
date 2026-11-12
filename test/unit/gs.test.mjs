// Grundschule (reine Hilfen aus public/shared.js): Kurs-Kennung, Kursangaben, Bezeichnungen, Schuljahr, Freischaltung für Eltern,
// Verlaufsplan mit PDF-Verweisen und Zwischenstopp, sichtbares Material für Eltern – dazu das additive Schema (worker/db.js).
import test from "node:test";
import assert from "node:assert/strict";
import * as S from "../../public/shared.js";
import { SCHEMA, COLUMNS, INDEXES, ensureSchema } from "../../worker/db.js";
import { fakeD1, fakeCtx } from "./fake-d1.mjs";

const A = "0123456789abcdef", B = "fedcba9876543210", C = "1111111111111111", D = "2222222222222222", E = "3333333333333333";

test("Kurs-Kennung der Grundschule: gs + 8 Hex – nie eine Klasse oder ein Kurs des Gymnasiums", () => {
  assert.equal(S.GS_SUBJECT, "gs");
  assert.ok(S.isGsCourseId("gs1a2b3c4d"));
  for (const k of ["4A", "8-K", "GS-1a2b3c4d", "gs12", "gs1a2b3c4dx", "gs1A2B3C4D", "", null, 7]) assert.equal(S.isGsCourseId(k), false, String(k));
  assert.equal(S.isValidClass("gs1a2b3c4d"), false);
  assert.equal(S.isValidSubject("gs"), false);
  assert.ok(!/^[A-Z0-9-]{2,5}$/.test("gs1a2b3c4d") && "gs1a2b3c4d".length === 10, "passt nicht in die Klassen-Route und in den 10-Zeichen-Schnitt der Sitzungsdatei");
  assert.ok(S.isGsLesson({ subject: "gs", klass: "gs1a2b3c4d" }));
  assert.equal(S.isGsLesson({ subject: "evrel", klass: "gs1a2b3c4d" }), false);
  assert.equal(S.isGsLesson({ subject: "gs", klass: "8A" }), false);
  assert.equal(S.isGsLesson(null), false);
});

test("normalizeGsCourse: Jahrgang 1–4, eine bis drei Klassen a–c (sortiert), Fach, Beschreibung, Grenzen", () => {
  assert.deepEqual(S.normalizeGsCourse({ grade: "2", classes: ["b", "A", "b"], religion: true, description: "  Geschichten aus der Bibel  " }),
    { grade: 2, classes: ["a", "b"], religion: true, subjectName: "Religion", description: "Geschichten aus der Bibel" });
  assert.deepEqual(S.normalizeGsCourse({ grade: 3, classes: ["c"], religion: false, subjectName: "  Sach   unterricht ", schoolYear: "2026/27" }),
    { grade: 3, classes: ["c"], religion: false, subjectName: "Sach unterricht", description: "", schoolYear: "2026/27" });
  assert.equal(S.normalizeGsCourse({ grade: 1, classes: ["a"], schoolYear: "2026/28" }).schoolYear, undefined, "Schuljahr nur als aufeinanderfolgende Jahre");
  const err = (raw, msg, opt) => assert.throws(() => S.normalizeGsCourse(raw, opt), (e) => e instanceof Error && e.message === msg);
  err({ grade: 5, classes: ["a"] }, "Bitte den Jahrgang 1–4 wählen.");
  err({ grade: 0, classes: ["a"] }, "Bitte den Jahrgang 1–4 wählen.");
  err({ classes: ["a"] }, "Bitte den Jahrgang 1–4 wählen.");
  err({ grade: 2, classes: [] }, "Bitte mindestens eine Klasse wählen (höchstens drei: a, b, c).");
  err({ grade: 2, classes: ["a", "d"] }, "Bitte mindestens eine Klasse wählen (höchstens drei: a, b, c).");
  err({ grade: 2 }, "Bitte mindestens eine Klasse wählen (höchstens drei: a, b, c).");
  err({ grade: 2, classes: ["a"], religion: false, subjectName: "   " }, "Bitte den Namen des Fachs eintragen.");
  err({ grade: 2, classes: ["a"], religion: false, subjectName: "x".repeat(61) }, "Der Name des Fachs ist zu lang (höchstens 60 Zeichen).");
  err({ grade: 2, classes: ["a"], description: "x".repeat(2001) }, "Die Beschreibung ist zu lang (höchstens 2000 Zeichen).");
  assert.equal(S.normalizeGsCourse({ grade: 2, classes: ["a"], religion: false, subjectName: "x".repeat(60) }).subjectName.length, 60);
  assert.equal(S.normalizeGsCourse({ grade: 2, classes: ["a"], description: "x".repeat(2000) }).description.length, 2000);
  // teilweise ändern: nur die übergebenen Felder, der Rest vom bisherigen Stand
  const cur = { grade: 2, classes: ["a", "b"], religion: false, subjectName: "Kunst", description: "Farben", schoolYear: "2026/27" };
  assert.deepEqual(S.normalizeGsCourse({ description: "Formen" }, { partial: true, current: cur }), { grade: 2, classes: ["a", "b"], religion: false, subjectName: "Kunst", description: "Formen" });
  assert.deepEqual(S.normalizeGsCourse({ religion: true }, { partial: true, current: cur }).subjectName, "Religion");
  err({ classes: ["a", "b", "c", "a", "d"] }, "Bitte mindestens eine Klasse wählen (höchstens drei: a, b, c).", { partial: true, current: cur });
  // aus Religion wird ein anderes Fach: ohne neuen Namen kein stilles „Religion“ als Fachname; Kurs als D1-Zeile (religion 0/1)
  const rel = { grade: 2, classes: ["a"], religion: true, subjectName: "Religion", description: "" };
  err({ religion: false }, "Bitte den Namen des Fachs eintragen.", { partial: true, current: rel });
  assert.equal(S.normalizeGsCourse({ religion: false, subjectName: "Kunst" }, { partial: true, current: rel }).subjectName, "Kunst");
  assert.deepEqual(S.normalizeGsCourse({ description: "x" }, { partial: true, current: { ...cur, religion: 0 } }).religion, false);
  // Jahrgang nur als Zahl oder Ziffernfolge (true ist kein Jahrgang 1)
  err({ grade: true, classes: ["a"] }, "Bitte den Jahrgang 1–4 wählen.");
  err({ grade: [2], classes: ["a"] }, "Bitte den Jahrgang 1–4 wählen.");
  err({ grade: 2.5, classes: ["a"] }, "Bitte den Jahrgang 1–4 wählen.");
});

test("Bezeichnungen eines Grundschulkurses", () => {
  const c2 = { grade: 2, classes: ["a", "b"], subjectName: "Religion" }, c3 = { grade: 3, classes: ["a", "b", "c"], subjectName: "Sachunterricht" }, c1 = { grade: 1, classes: ["c"], subjectName: "Religion" };
  assert.equal(S.gsClassList(c2), "2a, 2b");
  assert.equal(S.gsCourseShort(c2), "Religion 2ab");
  assert.equal(S.gsCourseLabel(c2), "Religion · Jahrgang 2 (Klassen 2a, 2b)");
  assert.equal(S.gsCourseLabel(c1), "Religion · Jahrgang 1 (Klasse 1c)");
  assert.equal(S.gsGradeText(c2), "Jahrgangsstufe 2 der Grundschule, Kurs mit Kindern aus den Klassen 2a und 2b");
  assert.equal(S.gsGradeText(c3), "Jahrgangsstufe 3 der Grundschule, Kurs mit Kindern aus den Klassen 3a, 3b und 3c");
  assert.equal(S.gsGradeText(c1), "Jahrgangsstufe 1 der Grundschule, Klasse 1c");
});

test("schoolYearOf: Schuljahr in Hessen vom 1. August bis 31. Juli", () => {
  assert.deepEqual(S.schoolYearOf("2026-11-12"), { from: "2026-08-01", to: "2027-07-31", label: "2026/27" });
  assert.deepEqual(S.schoolYearOf("2027-07-31"), { from: "2026-08-01", to: "2027-07-31", label: "2026/27" });
  assert.deepEqual(S.schoolYearOf("2027-08-01"), { from: "2027-08-01", to: "2028-07-31", label: "2027/28" });
  assert.deepEqual(S.schoolYearOf("2099-01-05"), { from: "2098-08-01", to: "2099-07-31", label: "2098/99" });
  assert.equal(S.schoolYearOf("2026-02-30"), null);
  assert.equal(S.schoolYearOf(null), null);
});

test("parentOpensAt: Ende der Sitzung (Ortszeit), ohne Beginn oder Dauer am Folgetag 0:00 Uhr, ohne Datum nie", () => {
  assert.equal(S.parentOpensAt({ date: "2026-11-10", startTime: "08:00", durationMin: 45 }), Date.parse("2026-11-10T07:45:00Z"));   // Winterzeit
  assert.equal(S.parentOpensAt({ date: "2026-06-10", startTime: "08:00", durationMin: 90 }), Date.parse("2026-06-10T07:30:00Z"));   // Sommerzeit
  assert.equal(S.parentOpensAt({ date: "2026-11-10", startTime: null, durationMin: 45 }), Date.parse("2026-11-10T23:00:00Z"));
  assert.equal(S.parentOpensAt({ date: "2026-11-10", startTime: "08:00" }), Date.parse("2026-11-10T23:00:00Z"));
  // Tage der Zeitumstellung (29.03.2026 und 25.10.2026): Mitternacht des Folgetags in der jeweils gültigen Zeit
  assert.equal(S.parentOpensAt({ date: "2026-03-28" }), Date.parse("2026-03-28T23:00:00Z"));
  assert.equal(S.parentOpensAt({ date: "2026-03-29" }), Date.parse("2026-03-29T22:00:00Z"));
  assert.equal(S.parentOpensAt({ date: "2026-10-24" }), Date.parse("2026-10-24T22:00:00Z"));
  assert.equal(S.parentOpensAt({ date: "2026-10-25" }), Date.parse("2026-10-25T23:00:00Z"));
  assert.equal(S.parentOpensAt({ date: null, startTime: "08:00", durationMin: 45 }), null);
  assert.equal(S.parentOpensAt({}), null);
  assert.equal(S.parentOpensAt(null), null);
});

test("parsePlanMarkup: PDF-Verweise als eigene Läufe mit der Formatierung an ihrer Stelle", () => {
  assert.equal(S.pdfRef(A), "[[pdf:" + A + "]]");
  const lines = S.parsePlanMarkup("**2) Erzählung [[pdf:" + A + "]] und [[pdf:" + B + "|Alte--Beschriftung__x]]**\n- [[pdf:xyz]] bleibt Text\n\n⏸ Zwischenstopp\n- Blatt [[pdf:" + C + "]]");
  assert.deepEqual(lines.map((l) => l.type), ["p", "li", "blank", "stop", "li"]);
  assert.deepEqual(lines[0].runs, [
    { text: "2) Erzählung ", b: true, u: false, i: false, s: false },
    { text: "", b: true, i: false, u: false, s: false, file: A },
    { text: " und ", b: true, u: false, i: false, s: false },
    { text: "", b: true, i: false, u: false, s: false, file: B },
  ], "Verweis innerhalb von **…**, mehrere je Zeile, „--“/„__“ in der Beschriftung bleiben ohne Wirkung");
  assert.deepEqual(lines[1].runs, [{ text: "[[pdf:xyz]] bleibt Text", b: false, u: false, i: false, s: false }], "ungültige Kennung bleibt Text");
  assert.deepEqual(lines[4].runs.map((r) => r.file || r.text), ["Blatt ", C]);
  // ohne Verweise genau wie der Schulportal-Eintrag
  const plain = "**1) TOP 10**\n- ~~Frage~~ mit https://example.org/x\n--> Nächste Stunde\n⏸ Zwischenstopp";
  assert.deepEqual(S.parsePlanMarkup(plain), S.parsePortalMarkup(plain));
  // ein Verweis direkt hinter einer Internetadresse beendet den Link (die Adresse enthält den Platzhalter nicht)
  const url = S.parsePlanMarkup("Siehe https://example.org/a[[pdf:" + A + "]]mehr")[0].runs;
  assert.deepEqual(url.map((r) => [r.text, r.file || null, r.href || null]), [["Siehe ", null, null], ["https://example.org/a", null, "https://example.org/a"], ["", A, null], ["mehr", null, null]]);
  assert.ok(url.every((r) => !String(r.href || "").includes("\uE000")));
  // das Platzhalterzeichen aus dem Text selbst stört nicht
  assert.deepEqual(S.parsePlanMarkup("ab").map((l) => l.runs.map((r) => r.text)), [["ab"]]);
});

test("planRefs: alle Verweise und die vor dem Zwischenstopp (Verweise auf der Stopp-Zeile zählen nicht)", () => {
  assert.deepEqual(S.planRefs("x [[pdf:" + A + "]] [[pdf:" + B + "]] [[pdf:" + A + "]]"), { all: [A, B], beforeStop: [A, B], hasStop: false });
  assert.deepEqual(S.planRefs("x [[pdf:" + A + "]]\n⏸ Zwischenstopp [[pdf:" + C + "]]\ny [[pdf:" + B + "]] [[pdf:" + A + "]]"), { all: [A, B], beforeStop: [A], hasStop: true });
  assert.deepEqual(S.planRefs(""), { all: [], beforeStop: [], hasStop: false });
  assert.deepEqual(S.planRefs(null), { all: [], beforeStop: [], hasStop: false });
  assert.deepEqual(S.planRefs("⏸ Zwischenstopp\n[[pdf:" + A + "|Name]]"), { all: [A], beforeStop: [], hasStop: true });
});

test("parentMaterial: was Eltern sehen – mit und ohne Zwischenstopp, über Sitzungen hinweg, Ausschlüsse, Bildkarten", () => {
  const L1 = "l000000000000001", L0 = "l000000000000000";
  const pdf = (id, o = {}) => ({ id, lessonId: L1, kind: "file", mime: "application/pdf", status: "ready", area: "student", source: "claude", createdAt: 10, cards: null, ...o });
  const files = [
    pdf(A, { createdAt: 3 }),                                             // Arbeitsblatt dieser Sitzung
    pdf(B, { createdAt: 1 }),                                             // weiteres Arbeitsblatt dieser Sitzung
    pdf(C, { lessonId: L0, createdAt: 0 }),                               // Blatt der vorigen Sitzung
    pdf(D, { area: "teacher", cards: { texts: ["a"], share: true, rev: 0, pages: 1, current: true }, createdAt: 4 }),   // Bildkarten (dürfen Eltern sehen)
    pdf(E, { area: "teacher", createdAt: 5 }),                            // nur für die Lehrkraft
    pdf("4444444444444444", { area: "print", createdAt: 6 }),
    { id: "5555555555555555", lessonId: L1, kind: "text", mime: "", status: "ready", area: "student", createdAt: 7 },
    { id: "6666666666666666", lessonId: L1, kind: "link", mime: "", status: "ready", area: "student", createdAt: 8 },
    pdf("7777777777777777", { source: "notfall", createdAt: 9 }),
    pdf("8888888888888888", { status: "processing", createdAt: 11 }),
    pdf("9999999999999999", { area: "teacher", cards: '{"v":1,"texts":[],"share":false,"rev":0}', card_pages: 3, card_img_at: 5, created_at: 5, createdAt: undefined, lessonId: undefined, lesson_id: L1 }),
    pdf("aaaaaaaaaaaaaaaa", { area: "teacher", cards: '{"v":1,"texts":[],"share":true,"rev":0}', card_pages: 3, card_img_at: 4, pdf_at: 6, created_at: 5, createdAt: undefined, lessonId: undefined, lesson_id: L1 }),
    pdf("bbbbbbbbbbbbbbbb", { area: "teacher", cards: '{"v":1,"texts":[],"share":true,"rev":0}', card_pages: 3, card_img_at: 6, pdf_at: 6, created_at: 5, createdAt: undefined, lessonId: undefined, lesson_id: L1 }),
  ];
  const reasons = (r) => Object.fromEntries(r.hidden.map((x) => [x.id, x.reason]));
  // ohne Zwischenstopp: Verweise in Plan-Reihenfolge (auch aus der vorigen Sitzung), dann die übrigen der Sitzung nach Anlage
  let r = S.parentMaterial("- [[pdf:" + C + "]]\n- [[pdf:" + A + "]] [[pdf:" + D + "]]", files, L1);
  assert.deepEqual(r.files, [C, A, B]);
  assert.deepEqual(r.cards, [D, "bbbbbbbbbbbbbbbb"]);
  assert.deepEqual(reasons(r), { [E]: "nur für Sie", "4444444444444444": "nur für Sie", "5555555555555555": "keine PDF-Datei", "6666666666666666": "keine PDF-Datei",
    "8888888888888888": "PDF wird noch erstellt", "9999999999999999": "Eltern dürfen diese Bildkarten nicht sehen", aaaaaaaaaaaaaaaa: "Bilder der Bildkarten werden noch erstellt" });
  // mit Zwischenstopp: genau die Verweise davor – eine Geschichte danach erscheint nicht
  r = S.parentMaterial("- [[pdf:" + A + "]]\n⏸ Zwischenstopp\n- [[pdf:" + D + "]] [[pdf:" + C + "]]", files, L1);
  assert.deepEqual(r.files, [A]);
  assert.deepEqual(r.cards, []);
  const h2 = reasons(r);
  assert.equal(h2[D], "nach dem Zwischenstopp");
  assert.equal(h2[C], "nach dem Zwischenstopp");
  assert.equal(h2[B], "nicht im Verlaufsplan genannt (wegen des Zwischenstopps)");
  assert.equal(h2.bbbbbbbbbbbbbbbb, "nicht im Verlaufsplan genannt (wegen des Zwischenstopps)");
  assert.equal(h2["7777777777777777"], undefined, "Notfall-Feibeitsblätter nie");
  // Verweis auf eine Datei, die Eltern nicht sehen dürfen, bleibt verborgen; unbekannte Kennungen werden übergangen
  r = S.parentMaterial("[[pdf:" + E + "]] [[pdf:cccccccccccccccc]]", files.filter((f) => f.id === E), L1);
  assert.deepEqual([r.files, r.cards, r.hidden], [[], [], [{ id: E, reason: "nur für Sie" }]]);
  assert.deepEqual(S.parentMaterial("", [], L1), { files: [], cards: [], hidden: [] });
  // Bildkarten (fileOut) ohne Kartenbilder gelten nie als aktuell
  r = S.parentMaterial("", [pdf(D, { area: "teacher", cards: { texts: [], share: true, rev: 0, pages: null, current: true } })], L1);
  assert.deepEqual([r.cards, r.hidden], [[], [{ id: D, reason: "Bilder der Bildkarten werden noch erstellt" }]]);
});

/* ---------- Schema (worker/db.js): neue Tabellen, Spalten und Indizes – nur additiv ---------- */
test("Schema: Kurseinstellungen, Grundschulkurse, neue Spalten und Indizes", () => {
  const c = fakeCtx();
  const cols = (t) => c.db.raw.prepare("PRAGMA table_info(" + t + ")").all().map((x) => x.name);
  assert.deepEqual(cols("course_settings"), ["subject", "klass", "weekdays", "class_size", "updated_at"]);
  assert.deepEqual(cols("gs_courses"), ["id", "grade", "classes", "religion", "subject_name", "description", "school_year", "created_at", "updated_at"]);
  for (const x of ["parent_summary", "parent_note", "parent_hash", "parent_sealed", "cancelled"]) assert.ok(cols("lessons").includes(x), x);
  assert.ok(cols("units").includes("revise"));
  for (const x of ["cards", "card_pages", "card_img_at"]) assert.ok(cols("files").includes(x), x);
  for (const x of ["pdf_size", "pdf_at"]) assert.ok(cols("bases").includes(x), x);
  const idx = c.db.raw.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((x) => x.name);
  assert.ok(idx.includes("lessons_parent_hash") && idx.includes("lessons_date"));
  // Vorgaben: bestehende Zeilen ändern sich nicht
  c.db.raw.exec("INSERT INTO lessons(id, subject, klass, code, created_at, updated_at) VALUES('x', 'powi', '8A', 'ABC234', 1, 1)");
  assert.deepEqual({ ...c.db.raw.prepare("SELECT parent_summary, parent_note, parent_hash, parent_sealed, cancelled FROM lessons").get() },
    { parent_summary: "", parent_note: "", parent_hash: null, parent_sealed: null, cancelled: 0 });
  // der Elternlink ist eindeutig
  c.db.raw.exec("UPDATE lessons SET parent_hash='h1'");
  c.db.raw.exec("INSERT INTO lessons(id, subject, klass, code, created_at, updated_at) VALUES('y', 'powi', '8A', 'ABC235', 1, 1)");
  assert.throws(() => c.db.raw.exec("UPDATE lessons SET parent_hash='h1' WHERE id='y'"), /UNIQUE/);
});

test("ensureSchema auf einer alten Datenbank: legt die neuen Tabellen und Spalten einmal an, Daten bleiben", async () => {
  const db = fakeD1();
  // Stand vor der Erweiterung: alle Tabellen ohne die neuen, alle Spalten ohne die neuen
  const NEW = new Set(["course_settings", "gs_courses"]), NEWCOLS = new Set(["lessons.parent_summary", "lessons.parent_note", "lessons.parent_hash", "lessons.parent_sealed", "lessons.cancelled", "units.revise",
    "files.cards", "files.card_pages", "files.card_img_at", "bases.pdf_size", "bases.pdf_at"]);
  for (const q of SCHEMA) if (![...NEW].some((t) => q.includes(" " + t + " "))) db.raw.exec(q);
  for (const [t, col, def] of COLUMNS) if (!NEWCOLS.has(t + "." + col)) db.raw.exec("ALTER TABLE " + t + " ADD COLUMN " + col + " " + def);
  db.raw.exec(INDEXES[0]);
  db.raw.exec("INSERT INTO lessons(id, subject, klass, title, code, created_at, updated_at) VALUES('old', 'evrel', '8-K', 'Alt', 'ABC236', 1, 1)");
  const alters = [];
  const orig = db.prepare;
  db.prepare = (sql) => { if (/^ALTER TABLE/.test(sql)) alters.push(sql); return orig(sql); };
  await ensureSchema(db);
  await ensureSchema(db);   // zweiter Aufruf im selben Isolate: nichts mehr
  assert.equal(alters.length, NEWCOLS.size, "jede neue Spalte genau einmal: " + alters.join("; "));
  const tables = db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x) => x.name);
  assert.ok(tables.includes("course_settings") && tables.includes("gs_courses"));
  assert.deepEqual({ ...db.raw.prepare("SELECT title, cancelled, parent_summary FROM lessons WHERE id='old'").get() }, { title: "Alt", cancelled: 0, parent_summary: "" });
});
