// Nachtrag 44, Teil 3 (23.11.2026): „Fachbegriffe dieser Sitzung“ – Karteikarten nur in der Oberstufe (E-Phase, Q1–Q4). Reine Funktionen (public/terms.js,
// isOberstufe und termsAt in public/shared.js), Prompt „Stunde mit Claude planen“, Worker (PATCH mit Stand, Schüler-Route mit Zeitprüfung, Sitzungsdatei,
// EMPTY_LESSON), Connector (update_lesson fachbegriffe, get_lesson), Karte der Lehrkraft (public/termsedit.js) und Karteikarten der Schüler:innen
// (public/termcards.js) im Browser-Ersatz, Gestaltung (styles.css). Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/lk" });
const S = await import("../../public/shared.js");
const TM = await import("../../public/terms.js");
const P = await import("../../public/planning.js");
const G = await import("../../public/gsplanning.js");
const SL = await import("../../public/selbstlern.js");
const SF = await import("../../public/sessionfile.js");
const IO = await import("../../public/sessionio.js");
const TE = await import("../../public/termsedit.js");
const TC = await import("../../public/termcards.js");
const { ApiError } = await import("../../public/ui.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const L = await import("../../worker/lessons.js");
const ST = await import("../../worker/student.js");
const GS = await import("../../worker/gs.js");
const U = await import("../../worker/units.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting, COLUMNS } = await import("../../worker/db.js");

const src = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const THREE = [{ term: "Gewaltenteilung", definition: "Aufteilung der Staatsgewalt auf Gesetzgebung, Regierung und Rechtsprechung." },
  { term: "Legislative", definition: "Die gesetzgebende Gewalt – in Deutschland vor allem Bundestag und Bundesrat." },
  { term: "Judikative", definition: "Die rechtsprechende Gewalt, also die unabhängigen Gerichte." }];

/* ---------- reine Funktionen ---------- */
test("isOberstufe: E-Phase (EA–EH, E-K) und Q1–Q4 (GK und LK) – nie Sek I, Kurse der Sek I, Grundschule oder Ungültiges; termsAt = 2 Minuten vor dem Ende", () => {
  for (const k of ["EA", "EH", "E-K", ...S.Q_COURSES]) assert.equal(S.isOberstufe(k), true, k);
  for (const k of ["5A", "6B", "8B", "10H", "8-K", "10-K", "gs12345678", "", null, undefined, "Q5-GK", "EI"]) assert.equal(S.isOberstufe(k), false, String(k));
  const t = S.lessonTimes({ date: "2026-11-17", startTime: "10:00", durationMin: 90 });
  assert.equal(S.TERMS_BEFORE_END_MIN, 2);
  assert.equal(t.termsAt, t.end - 2 * 60e3);
  assert.equal(t.termsAt, Date.UTC(2026, 10, 17, 10, 28), "Beginn 10:00 Uhr Berlin + 90 min − 2 min = 11:28 Uhr Berlin (10:28 UTC)");
});

test("validateTerms: [] bzw. null = löschen, sonst 3–8 Einträge; Begriff und Definition Pflicht, ≤ 60 bzw. ≤ 300 Zeichen, einzeilig, ohne Doppelte – Fehler statt Kürzen", () => {
  assert.deepEqual(TM.validateTerms(null), []); assert.deepEqual(TM.validateTerms(undefined), []); assert.deepEqual(TM.validateTerms([]), []);
  assert.deepEqual(TM.validateTerms([{ term: "  Gewalten\nteilung ", definition: " Aufteilung\n der  Staatsgewalt. " }, ...THREE.slice(1)])[0],
    { term: "Gewalten teilung", definition: "Aufteilung der Staatsgewalt." }, "Leerraum (auch Zeilenumbrüche) zu einem Leerzeichen");
  const err = (raw, re) => assert.throws(() => TM.validateTerms(raw), re);
  err("Gewaltenteilung", /müssen eine Liste sein/);
  err(THREE.slice(0, 2), /^Error: Bitte mindestens 3 Fachbegriffe angeben \(höchstens 8\) – oder die Liste ganz leeren\.$/);
  err(Array.from({ length: 9 }, (_, i) => ({ term: "B" + i, definition: "D" })), /Höchstens 8 Fachbegriffe je Sitzung/);
  err([...THREE.slice(0, 2), "kaputt"], /Fachbegriff 3 ist ungültig/);
  err([...THREE.slice(0, 2), { term: "  ", definition: "x" }], /Fachbegriff 3: Bitte den Begriff angeben/);
  err([...THREE.slice(0, 2), { term: "Exekutive", definition: "" }], /Fachbegriff 3 \(„Exekutive“\): Bitte die Definition angeben/);
  err([...THREE.slice(0, 2), { term: "x".repeat(61), definition: "y" }], /Fachbegriff 3 \(„x{40}…“\) ist zu lang \(höchstens 60 Zeichen\)/);
  err([...THREE.slice(0, 2), { term: "Exekutive", definition: "y".repeat(301) }], /Die Definition zu „Exekutive“ ist zu lang \(301 Zeichen, höchstens 300\)/);
  err([...THREE, { term: "gewaltenteilung", definition: "doppelt" }], /„gewaltenteilung“ steht doppelt in der Liste/);
  assert.equal(TM.validateTerms(Array.from({ length: 8 }, (_, i) => ({ term: "Begriff " + i, definition: "D" + i }))).length, 8);
  assert.equal(TM.validateTerms([{ term: "x".repeat(60), definition: "y".repeat(300) }, ...THREE.slice(1)])[0].definition.length, 300, "genau an der Grenze erlaubt");
});

test("cleanTerms (fremde Daten): nie ein Fehler – ohne Begriff oder Definition und Doppeltes entfällt, Zu-Langes gekürzt, höchstens 8, auch 1–2 bleiben", () => {
  const raw = [{ term: "x".repeat(70), definition: "y".repeat(320) }, { term: "Legislative", definition: "" }, { term: "Judikative", definition: "Gerichte." }, { term: "judikative", definition: "doppelt" },
    "kaputt", null, { term: 5, definition: "x" }];
  const c = TM.cleanTerms(raw);
  assert.deepEqual(c.map((x) => x.term), ["x".repeat(60), "Judikative"]);
  assert.equal(c[0].definition.length, 300); assert.ok(c[0].definition.endsWith("…"));
  assert.equal(TM.cleanTerms(Array.from({ length: 12 }, (_, i) => ({ term: "B" + i, definition: "D" }))).length, 8);
  assert.deepEqual(TM.cleanTerms("x"), []);
});

test("Speicherform: {v:1, rev, items:[{t, d}]}; lesen tolerant (kaputtes JSON, fremde Felder); NULL = leer", () => {
  const raw = TM.termsStore(THREE);
  assert.deepEqual(JSON.parse(raw), { v: 1, rev: 0, items: THREE.map((x) => ({ t: x.term, d: x.definition })) });
  assert.deepEqual(TM.termsRead(raw), { rev: 0, items: THREE });
  assert.deepEqual(TM.termsRead(JSON.stringify({ v: 1, rev: 4, items: [{ t: "A", d: "B" }, { t: "", d: "x" }, "x"] })), { rev: 4, items: [{ term: "A", definition: "B" }] });
  for (const x of [null, "", "{kaputt", "[]", JSON.stringify({ rev: -2 })]) assert.deepEqual(TM.termsRead(x), { rev: 0, items: [] }, String(x));
  assert.match(TM.TERMS_REV_SQL, /json_valid\(terms\)/);
  assert.ok(COLUMNS.some(([t, c, d]) => t === "lessons" && c === "terms" && d === "TEXT"), "Spalte lessons.terms (additiv)");
});

test("Bausteine: Speicherschritt des Prompts, get_lesson-Abschnitt (leer und gefüllt), Satz im Dialog „Sitzung aus Datei laden“", () => {
  const step = TM.termsSaveStep();
  for (const s of ["„Fachbegriffe dieser Sitzung“ → `update_lesson` mit `fachbegriffe`", "3 bis 8 zentrale Fachbegriffe, die in dieser Stunde eingeführt oder gebraucht werden",
    "`begriff` (höchstens 60 Zeichen)", "`definition`: eine kurze, fachlich korrekte Erklärung in ein bis zwei Sätzen (höchstens 300 Zeichen), verständlich für diese Lerngruppe",
    "ab 2 Minuten vor dem Ende der Sitzung als Karteikarten (vorne der Begriff, hinten die Definition)", "die Liste ersetzt die bisherige aus `get_lesson`"]) assert.ok(step.includes(s), s);
  assert.ok(step.startsWith("   - "));
  const e = TM.termsSection([]);
  assert.deepEqual(e.slice(0, 2), ["", "## Fachbegriffe dieser Sitzung (Karteikarten für die Schüler:innen, sichtbar ab 2 Minuten vor dem Ende der Sitzung)"]);
  assert.ok(e[2].startsWith("(noch keine – schreibe nach der Freigabe der Lehrkraft 3 bis 8 zentrale Fachbegriffe dieser Stunde mit update_lesson und fachbegriffe"));
  const f = TM.termsSection(THREE, "Die Schüler:innen sehen sie ab …");
  assert.deepEqual(f.slice(2), ["- Gewaltenteilung: Aufteilung der Staatsgewalt auf Gesetzgebung, Regierung und Rechtsprechung.", "- Legislative: Die gesetzgebende Gewalt – in Deutschland vor allem Bundestag und Bundesrat.",
    "- Judikative: Die rechtsprechende Gewalt, also die unabhängigen Gerichte.", "Die Schüler:innen sehen sie ab …", "(Ändern mit update_lesson und fachbegriffe – die Liste ersetzt die bisherige, [] leert sie.)"]);
  // Dialog „Sitzung aus Datei laden“
  assert.equal(TM.termsImportText({ lesson: { terms: THREE }, termsDropped: 0 }, { klass: "Q2-GK", terms: [] }), "Fachbegriffe dieser Sitzung (Gewaltenteilung, Legislative, Judikative) ersetzen die Liste dieser Sitzung.");
  assert.equal(TM.termsImportText({ lesson: { terms: [] }, termsDropped: 3 }, { klass: "8B" }), "Die 3 Fachbegriffe aus der Datei werden nicht übernommen – Karteikarten gibt es nur in der Oberstufe.");
  assert.equal(TM.termsImportText({ lesson: { terms: [] }, termsDropped: 0 }, { klass: "EA", terms: THREE }), "Die Datei enthält keine Fachbegriffe – die bisherigen dieser Sitzung werden gelöscht.");
  assert.equal(TM.termsImportText({ lesson: { terms: [] }, termsDropped: 0 }, { klass: "EA", terms: [] }), "");
  assert.equal(TM.termsImportText({ lesson: { terms: [] }, termsDropped: 0 }, { klass: "8B" }), "");
});

test("Prompt „Stunde mit Claude planen“: genau ein Schritt direkt nach der Hausaufgabe – nur Oberstufe; nie Sek I, Jg. 5/6, Grundschule, Selbstlern-, Präsentations- und Einheiten-Prompt", () => {
  const base = { lessonId: "a".repeat(16), subject: "powi", lesson: { title: "Gewaltenteilung", topic: "Gewaltenteilung", durationMin: 90 }, materials: [], sheets: [], messages: [] };
  const step = TM.termsSaveStep();
  for (const klass of ["EA", "E-K", "Q1-GK", "Q4-LK"]) {
    const p = P.claudeLessonPrompt({ ...base, subject: klass === "E-K" ? "evrel" : "powi", klass });
    assert.equal(p.split(step).length - 1, 1, klass);
    assert.ok(p.includes("Schulportal-Zeichen erlaubt). Geänderte Sitzungsdaten (Titel, Thema, Dauer) ebenfalls mit `update_lesson`.\n" + step), "direkt nach der Hausaufgabe: " + klass);
  }
  for (const klass of ["8B", "6B", "10H", "8-K"]) assert.ok(!P.claudeLessonPrompt({ ...base, subject: klass === "8-K" ? "ethik" : "powi", klass }).includes("fachbegriffe"), klass);
  const gl = G.claudeGsLessonPrompt({ lessonId: "b".repeat(16), subject: "gs", klass: "gs12345678", course: { short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)", subjectName: "Religion", grade: 2, classes: ["a", "b"] }, lesson: { title: "Josef", durationMin: 45 }, materials: [] });
  assert.ok(!gl.includes("fachbegriffe") && !gl.includes(TM.TERMS_TITLE));
  assert.ok(!SL.claudeSelbstlernPrompt({ ...base, klass: "Q2-GK", row: null }).includes("fachbegriffe"), "Selbstlern-Phase ohne den Schritt");
  assert.ok(!S.claudePresentationPrompt({ ...base, klass: "Q2-GK", code: "ABC123" }, "**1) Einstieg**", []).includes("fachbegriffe"), "Präsentations-Prompt ohne den Schritt");
});

/* ---------- Worker und Connector ---------- */
const TOKEN = "lehrkraft-token-terms", STOKEN = "schueler-token-terms", DEV = "abababababababab";
const callAs = (tok) => async (c, fn, method, path, body, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method, headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code, ...(e.extra || {}) } }; }
};
const call = callAs(TOKEN), scall = callAs(STOKEN);
async function mcp(c, method, params) {
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
}
const tool = async (c, name, args) => { const r = await mcp(c, "tools/call", { name, arguments: args }); return { text: r.content[0].text, isError: !!r.isError, data: r.structuredContent }; };
// Dienstag, 17.11.2026, 10:00 Uhr Berlin; die Sitzung 10:00–11:30 Uhr → Karteikarten ab 11:28 Uhr (10:28 UTC)
const NOW = Date.UTC(2026, 10, 17, 9, 0), TERMS_AT = Date.UTC(2026, 10, 17, 10, 28);
async function base() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = NOW;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3 * 24 * 30).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  return c;
}
const lesson = (c, klass, extra = {}) => L.createLesson(c.db, { subject: "powi", klass, title: "Gewaltenteilung", date: "2026-11-17", startTime: "10:00", durationMin: 90, ...extra }, c.now);

test("PATCH: nur Oberstufe; speichert 3–8 bzw. [] mit Stand (409 bei veraltetem Stand), 400 bei ungültiger Liste; lessonOut nur in der Oberstufe mit terms/termsRev", async () => {
  const c = await base();
  const q = await lesson(c, "Q2-GK"), s1 = await lesson(c, "8B");
  let r = await call(c, L.routeLessonGet, "GET", "/x", undefined, q.id);
  assert.deepEqual([r.data.lesson.terms, r.data.lesson.termsRev], [[], 0]);
  r = await call(c, L.routeLessonGet, "GET", "/x", undefined, s1.id);
  assert.ok(!("terms" in r.data.lesson) && !("termsRev" in r.data.lesson), "Sek I: Antwort wie bisher");
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { terms: THREE, termsBase: 0 }, q.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.lesson.terms, r.data.lesson.termsRev], [THREE, 1]);
  // ohne Stand (Connector): gespeichert, rev 2
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { terms: [...THREE, { term: "Exekutive", definition: "Die ausführende Gewalt." }] }, q.id);
  assert.equal(r.data.lesson.termsRev, 2);
  // veralteter Stand: 409 mit der aktuellen Liste, nichts gespeichert
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { terms: [], termsBase: 1 }, q.id);
  assert.deepEqual([r.status, r.data.code, r.data.current.rev, r.data.current.items.length], [409, "terms_conflict", 2, 4]);
  assert.equal(r.data.error, "Die Fachbegriffe dieser Sitzung wurden inzwischen an anderer Stelle geändert.");
  // leeren mit passendem Stand: bleibt als leere Liste stehen, der Stand zählt weiter
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { terms: [], termsBase: 2 }, q.id);
  assert.deepEqual([r.status, r.data.lesson.terms, r.data.lesson.termsRev], [200, [], 3]);
  // ungültig: 400 mit der Meldung, Stand fehlerhaft
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { terms: THREE.slice(0, 2) }, q.id);
  assert.deepEqual([r.status, r.data.error], [400, "Bitte mindestens 3 Fachbegriffe angeben (höchstens 8) – oder die Liste ganz leeren."]);
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { terms: THREE, termsBase: "x" }, q.id);
  assert.deepEqual([r.status, r.data.error], [400, "Stand der Fachbegriffe fehlt."]);
  // nicht Oberstufe: 400, nichts gespeichert (auch nicht die übrigen Felder)
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { terms: THREE, title: "Neu" }, s1.id);
  assert.deepEqual([r.status, r.data.error], [400, TM.TERMS_ONLY_OBERSTUFE]);
  assert.equal(c.db.raw.prepare("SELECT terms, title FROM lessons WHERE id=?").get(s1.id).terms, null);
  assert.equal(c.db.raw.prepare("SELECT title FROM lessons WHERE id=?").get(s1.id).title, "Gewaltenteilung");
  // E-Phase und der Kurs E-K gehören dazu
  for (const k of ["EA", "E-K"]) {
    const l = await L.createLesson(c.db, { subject: k === "E-K" ? "evrel" : "powi", klass: k, title: "T", date: "2026-11-17" }, c.now);
    assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { terms: THREE }, l.id)).status, 200, k);
  }
});

test("Schüler:innen: erst ab 2 Minuten vor dem Ende (Server), danach dauerhaft; ohne Beginn nie; Sek I nie; changesAt nur in der Oberstufe; nie in der Sitzungsliste oder beim Code einlösen; auch in der Selbstlern-Phase", async () => {
  const c = await base();
  const q = await lesson(c, "Q2-GK"), sek = await lesson(c, "9D");
  const secret = [{ term: "TERMGEHEIM", definition: "DEFGEHEIM – nur nach der Zeit." }, ...THREE.slice(1)];
  assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { terms: secret }, q.id)).status, 200);
  c.db.raw.prepare("UPDATE lessons SET terms=? WHERE id=?").run(TM.termsStore(secret), sek.id);   // Sek I (nur direkt in der Datenbank denkbar)
  for (const [dev, klass] of [[DEV, "Q2-GK"], ["cdcdcdcdcdcdcdcd", "9D"]])
    c.db.raw.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, ?, 'powi', ?, ?, ?)").run(dev, await sha256Hex(dev === DEV ? STOKEN : STOKEN + "9"), klass, c.now, c.now, c.now + 3600e3 * 24 * 30);
  const join = await scall(c, ST.routeStudentJoin, "POST", "/api/student/join", { code: q.code });
  assert.equal(join.status, 200, JSON.stringify(join.data));
  const view = async (id, tok = STOKEN) => (await callAs(tok)(c, ST.routeStudentLesson, "GET", "/x", undefined, id)).data;
  let v = await view(q.id);
  assert.equal(v.terms, null, "zu Beginn noch nicht");
  assert.ok(v.changesAt.includes(TERMS_AT), "die Seite lädt zur Zeit der Karteikarten neu");
  c.now = TERMS_AT - 1;
  assert.equal((await view(q.id)).terms, null, "eine Millisekunde vorher: nichts");
  c.now = TERMS_AT;
  v = await view(q.id);
  assert.deepEqual(v.terms, secret, "ab 2 Minuten vor dem Ende");
  assert.ok(!v.changesAt.includes(TERMS_AT), "vergangene Zeitpunkte entfallen");
  c.now = TERMS_AT + 3 * 864e5;
  assert.deepEqual((await view(q.id)).terms, secret, "danach dauerhaft (auch Tage später)");
  for (const x of [join.data, (await scall(c, ST.routeStudentMe, "GET", "/api/student/me")).data]) assert.ok(!JSON.stringify(x).includes("TERMGEHEIM") && !JSON.stringify(x).includes("DEFGEHEIM"));
  // Sek I: nie (auch nicht mit Begriffen in der Datenbank), kein Zeitpunkt der Karteikarten
  c.now = NOW;
  await callAs(STOKEN + "9")(c, ST.routeStudentJoin, "POST", "/api/student/join", { code: sek.code });
  assert.ok(!(await view(sek.id, STOKEN + "9")).changesAt.includes(TERMS_AT), "Sek I: kein Zeitpunkt für Karteikarten");
  c.now = TERMS_AT + 864e5;
  const sv = await view(sek.id, STOKEN + "9");
  assert.equal(sv.terms, null);
  assert.ok(!JSON.stringify(sv).includes("TERMGEHEIM"));
  // ohne Beginn: nie, auch kein Zeitpunkt
  await call(c, L.routeLessonPatch, "PATCH", "/x", { startTime: null }, q.id);
  v = await view(q.id);
  assert.equal(v.terms, null);
  assert.ok(!JSON.stringify(v).includes("TERMGEHEIM"));
  await call(c, L.routeLessonPatch, "PATCH", "/x", { startTime: "10:00" }, q.id);
  // Selbstlern-Phase: dieselbe Zeit (die Begriffe gehören zur Sitzung)
  c.db.raw.prepare("INSERT INTO substitutes(lesson_id, status, proposal, archive, created_at, updated_at) VALUES(?, 'selbstlern', ?, '{}', ?, ?)")
    .run(q.id, JSON.stringify({ v: 1, stationen: [{ titel: "Lesen", typ: "aufgabe", anleitung: "Lies M1." }] }), c.now, c.now);
  c.now = TERMS_AT - 60e3;
  assert.equal((await view(q.id)).terms, null, "Selbstlern-Phase: vor der Zeit nichts");
  c.now = TERMS_AT;
  assert.deepEqual((await view(q.id)).terms, secret);
});

test("Connector: update_lesson fachbegriffe (Antwort mit Zeitpunkt, [] löscht), Fehler ohne Speichern, nur Oberstufe; get_lesson-Abschnitt nur in der Oberstufe; Server-Anweisungen unverändert", async () => {
  const c = await base();
  const q = await lesson(c, "Q2-GK"), s1 = await lesson(c, "8B");
  let g = await tool(c, "get_lesson", { lesson_id: q.id });
  assert.ok(g.text.includes("## Fachbegriffe dieser Sitzung (Karteikarten für die Schüler:innen, sichtbar ab 2 Minuten vor dem Ende der Sitzung)\n(noch keine – schreibe nach der Freigabe"));
  assert.ok(g.text.indexOf("## Mitbringen") < g.text.indexOf("## Fachbegriffe") && g.text.indexOf("## Fachbegriffe") < g.text.indexOf("## Planungsverlauf"));
  assert.ok(!(await tool(c, "get_lesson", { lesson_id: s1.id })).text.includes("Fachbegriffe dieser Sitzung"), "Sek I: kein Abschnitt");
  const args = THREE.map((x) => ({ begriff: x.term, definition: x.definition }));
  let r = await tool(c, "update_lesson", { lesson_id: q.id, fachbegriffe: args });
  assert.equal(r.text, "Gespeichert. Fachbegriffe dieser Sitzung (3): Gewaltenteilung, Legislative, Judikative – die Schüler:innen sehen sie ab Di., 17.11.2026, 11:28 Uhr (2 Minuten vor dem Ende der Sitzung).");
  assert.deepEqual(r.data.lesson.terms, THREE);
  g = await tool(c, "get_lesson", { lesson_id: q.id });
  assert.ok(g.text.includes("- Gewaltenteilung: Aufteilung der Staatsgewalt auf Gesetzgebung, Regierung und Rechtsprechung.\n- Legislative:") &&
    g.text.includes("\nDie Schüler:innen sehen sie ab Di., 17.11.2026, 11:28 Uhr (2 Minuten vor dem Ende der Sitzung).\n(Ändern mit update_lesson und fachbegriffe"), g.text.slice(g.text.indexOf("## Fachbegriffe")));
  // Fehler: nichts gespeichert (auch nicht die übrigen Felder)
  for (const [a, re] of [[{ fachbegriffe: "Gewaltenteilung" }, /^fachbegriffe ist eine Liste/], [{ fachbegriffe: [{ begriff: "A" }], titel: "Neu" }, /^fachbegriffe, Eintrag 1: begriff und definition sind Pflicht/],
    [{ fachbegriffe: args.slice(0, 2), titel: "Neu" }, /^fachbegriffe: Bitte mindestens 3 Fachbegriffe angeben/], [{ fachbegriffe: [...args, args[0]] }, /^fachbegriffe: „Gewaltenteilung“ steht doppelt/]]) {
    r = await tool(c, "update_lesson", { lesson_id: q.id, ...a });
    assert.ok(r.isError && re.test(r.text), r.text);
  }
  const after = (await call(c, L.routeLessonGet, "GET", "/x", undefined, q.id)).data.lesson;
  assert.deepEqual([after.title, after.terms.length], ["Gewaltenteilung", 3], "nach Fehlern unverändert");
  r = await tool(c, "update_lesson", { lesson_id: s1.id, fachbegriffe: args });
  assert.ok(r.isError && r.text === TM.TERMS_ONLY_OBERSTUFE + " Lass fachbegriffe bei dieser Sitzung weg.", r.text);
  r = await tool(c, "update_lesson", { lesson_id: q.id, fachbegriffe: [] });
  assert.equal(r.text, "Gespeichert. Die „Fachbegriffe dieser Sitzung“ sind gelöscht.");
  r = await tool(c, "update_lesson", { lesson_id: q.id, titel: "Gewaltenteilung 2" });
  assert.equal(r.text, "Gespeichert.", "ohne fachbegriffe: Antwort wie bisher");
  // ohne Beginn: sagt, was fehlt
  await call(c, L.routeLessonPatch, "PATCH", "/x", { startTime: null }, q.id);
  r = await tool(c, "update_lesson", { lesson_id: q.id, fachbegriffe: args });
  assert.ok(r.text.endsWith("– solange der Beginn (Uhrzeit) der Sitzung fehlt, sehen die Schüler:innen sie nicht."), r.text);
  // Werkzeugbeschreibung, Schema, Anweisungen
  const tools = (await mcp(c, "tools/list", {})).tools, ul = tools.find((t) => t.name === "update_lesson");
  const p = ul.inputSchema.properties.fachbegriffe;
  assert.equal(p.maxItems, 8); assert.deepEqual(p.items.required, ["begriff", "definition"]);
  assert.deepEqual([p.items.properties.begriff.maxLength, p.items.properties.definition.maxLength], [60, 300]);
  assert.ok(p.description.startsWith("Nur Oberstufe (E-Phase, Q1–Q4): „Fachbegriffe dieser Sitzung“") && p.description.includes("[] leert sie") && p.description.includes("Nie Namen von Schüler:innen"));
  assert.ok(ul.description.includes("Mit fachbegriffe speicherst du – nur in der Oberstufe (E-Phase, Q1–Q4) – die „Fachbegriffe dieser Sitzung“"));
  const init = await mcp(c, "initialize", { protocolVersion: "2025-06-18" });
  assert.ok(!init.instructions.includes("fachbegriffe") && !init.instructions.includes("Fachbegriffe dieser Sitzung") && init.instructions.length === 5646, "Server-Anweisungen byte-gleich lang");
});

test("Sitzungsdatei und Sicherung: Begriffe in der Datei (nur wenn vorhanden), tolerant gelesen; Laden ersetzt sie in der Oberstufe, eine Sek-I-Sitzung lässt sie weg (Satz im Dialog)", async () => {
  const detail = (lesson) => ({ lesson: { id: "l1", subject: "powi", klass: "Q2-GK", title: "Macht", topic: "Macht", date: "2026-11-17", nextDate: "2026-11-19", portal: "", ...lesson }, files: [], drafts: [], sheets: [], messages: [] });
  const read = async (lesson) => (await IO.readSessionZip((await IO.buildSessionZip(detail(lesson), { fb: null })).bytes)).data;
  assert.ok(!("terms" in (await read({})).lesson), "ohne Begriffe bleibt die Datei, wie sie war");
  assert.ok(!("terms" in (await read({ terms: [] })).lesson));
  const data = await read({ terms: THREE });
  assert.deepEqual(data.lesson.terms, THREE);
  const file = (lesson) => SF.cleanSessionFile({ kind: SF.SESSION_FILE.kind, v: SF.SESSION_FILE.v, source: { subject: "powi", klass: "Q2-GK", date: "2026-11-10" }, lesson });
  assert.deepEqual(file({ title: "T", terms: [{ term: "A".repeat(80), definition: "x" }, { term: "a".repeat(80), definition: "doppelt" }, "kaputt"] }).lesson.terms, [{ term: "A".repeat(60), definition: "x" }]);
  // planen: Oberstufe ersetzt (ohne Begriffe in der Datei: leer), Sek I lässt sie weg
  let plan = IO.planSessionImport(data, { klass: "Q3-LK", date: "2026-11-24" });
  assert.deepEqual([plan.lesson.terms, plan.termsDropped], [THREE, 0]);
  plan = IO.planSessionImport(data, { klass: "8B", date: "2026-11-24" });
  assert.deepEqual([plan.lesson.terms, plan.termsDropped], [[], 3]);
  assert.deepEqual(IO.planSessionImport(await read({}), { klass: "EA", date: "2026-11-24" }).lesson.terms, []);
  // Server: Oberstufe ersetzt (bereinigt, Stand zählt), Sek I bleibt ohne Spalte
  const c = await base();
  const q = await lesson(c, "Q3-LK"), s1 = await lesson(c, "8B");
  await call(c, L.routeLessonPatch, "PATCH", "/x", { terms: [{ term: "Alt", definition: "a" }, { term: "Alt2", definition: "b" }, { term: "Alt3", definition: "c" }] }, q.id);
  let r = await call(c, L.routeLessonImport, "POST", "/x", { lesson: { title: "Neu", terms: [...THREE, { term: "z".repeat(90), definition: "y" }] }, chat: [] }, q.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await call(c, L.routeLessonGet, "GET", "/x", undefined, q.id);
  assert.deepEqual([r.data.lesson.terms.map((x) => x.term), r.data.lesson.termsRev], [[...THREE.map((x) => x.term), "z".repeat(60)], 2]);
  r = await call(c, L.routeLessonImport, "POST", "/x", { lesson: { title: "Neu", terms: THREE }, chat: [] }, s1.id);
  assert.equal(r.status, 200);
  assert.equal(c.db.raw.prepare("SELECT terms FROM lessons WHERE id=?").get(s1.id).terms, null, "Sek I: nichts gespeichert");
  // Lies-mich der Sicherung nennt sie; „Alle Unterlagen“ nimmt sie in den Verlaufsplan
  assert.ok(src("public/backup.js").includes("Fachbegriffen dieser Sitzung (Oberstufe)"));
});

test("EMPTY_LESSON: eine Sitzung nur mit Fachbegriffen ist nicht leer (fällt beim Überarbeiten einer Einheit nicht weg)", async () => {
  const c = await base();
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/x", { grade: 2, classes: ["a"], religion: true, weekdays: [{ day: 2, minutes: 45, time: "08:00" }] })).data.course;
  // hasContent (EMPTY_LESSON) berechnet linkedLessons nur für die Grundschule – dort gibt es nie Begriffe; die Spalte wird hier nur direkt gesetzt, um den
  // gemeinsamen Ausdruck zu prüfen (er gilt genauso beim Überarbeiten einer Einheit des Gymnasiums)
  const unitId = (await call(c, U.routeUnitCreate, "POST", "/x", { subject: "gs", klass: course.id, title: "Josef", params: { start: "2026-11-24", end: "2026-11-24", weekdays: [{ day: 2, minutes: 45, time: "08:00" }] } })).data.unit.id;
  const l = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Leer", date: "2026-11-24", unitId, unitRow: "aaaaaaaa" }, c.now);
  c.db.raw.prepare("DELETE FROM chat WHERE lesson_id=?").run(l.id);
  assert.equal((await U.linkedLessons(c.db, unitId, true))[0].hasContent, false);
  c.db.raw.prepare("UPDATE lessons SET terms=? WHERE id=?").run(TM.termsStore(THREE), l.id);
  assert.equal((await U.linkedLessons(c.db, unitId, true))[0].hasContent, true);
  c.db.raw.prepare("UPDATE lessons SET terms=? WHERE id=?").run(TM.termsStore([]), l.id);
  assert.equal((await U.linkedLessons(c.db, unitId, true))[0].hasContent, false, "geleerte Liste: wieder leer");
});

test("Nie an Eltern, Beamer, Live-Zustand oder in die Sitzungsliste: nur bestimmte Module kennen die Fachbegriffe", () => {
  for (const f of ["worker/parents.js", "worker/beamer.js", "worker/live.js", "worker/livestate.js", "public/parents.js", "public/beamer.js", "public/presenter.js", "public/inclass.js", "worker/podcast.js"])
    assert.ok(!/termsRead|fachbegriffe|termCards|TERMS_|\.terms\b/.test(src(f)), f);
  const st = src("worker/student.js");
  assert.ok(st.includes('" + LESSON_COLS + ", l.created_at, l.terms FROM student_access'), "nur die Abfrage einer Sitzung liest die Spalte");
  assert.ok(!/LESSON_COLS = [^\n]*terms/.test(st), "nicht in LESSON_COLS (Sitzungsliste und Code einlösen)");
});

/* ---------- Sitzungsseite: Karte „Fachbegriffe dieser Sitzung“ (public/termsedit.js) ---------- */
function mount(lesson = {}, routes = []) {
  const calls = [];
  globalThis.__tapi = async (method, path, o = {}) => {
    calls.push({ method, path, body: o.body });
    for (const [re, fn] of routes) { const m = re.exec(method + " " + path); if (m) return fn(m, o.body || {}); }
    throw new ApiError("nicht nachgebildet: " + method + " " + path, 404, { code: "not_found" });
  };
  const st = { lesson: { id: "l1", subject: "powi", klass: "Q2-GK", date: "2026-11-17", startTime: "10:00", durationMin: 90, terms: [], termsRev: 0, ...lesson } };
  const card = TE.termsCard({ id: "l1", L: () => st.lesson });
  const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove(); app.append(card.el);
  const q = (s) => card.el.querySelector(s), visible = (el) => !!el && !el.classList.contains("hidden");
  return { card, st, calls, q, visible, terms: () => $$(".terms-item dt", card.el).map((x) => x.textContent), rows: () => $$(".terms-row", card.el) };
}
function server(start = [], rev = 0) {
  const s = { items: start, rev };
  return { s, route: [/^PATCH \/api\/teacher\/lessons\/l1$/, (_, b) => {
    if (b.termsBase !== undefined && b.termsBase !== s.rev) throw new ApiError("Die Fachbegriffe dieser Sitzung wurden inzwischen an anderer Stelle geändert.", 409, { code: "terms_conflict", current: { items: s.items, rev: s.rev } });
    s.items = TM.validateTerms(b.terms); s.rev++;
    return { ok: true, lesson: { terms: s.items, termsRev: s.rev } };
  }] };
}
const fill = (row, term, def) => { const [t, d] = [row.querySelector("input.terms-t"), row.querySelector("textarea.terms-d")]; t.value = term; d.value = def; D.fire(d, "input"); };

test("Karte der Lehrkraft: leer mit Hinweis und Zeitpunkt; Bearbeiten (drei Zeilen, Fokus), Fehler am Feld, Speichern mit Stand, Fokus zurück; ohne Beginn der Hinweis, was fehlt", async () => {
  const srv = server();
  const m = mount({}, [srv.route]);
  assert.equal(m.q("#terms-h").tagName, "H2"); assert.equal(m.q("#terms-h").textContent, "Fachbegriffe dieser Sitzung");
  assert.equal(m.card.el.getAttribute("aria-labelledby"), "terms-h");
  assert.ok(m.visible(m.q(".terms-empty")) && !m.visible(m.q("#terms-list")));
  assert.equal(m.q(".terms-empty").textContent, TE.TERMS_EMPTY);
  assert.equal(m.q("#terms-when").textContent, "Schüler:innen sehen die Karteikarten ab 11:28 Uhr (2 Minuten vor dem Ende der Sitzung) unten in ihrer Ansicht der Sitzung – danach bleiben sie dort.");
  const edit = m.q("#terms-edit");
  assert.equal(edit.getAttribute("aria-expanded"), "false");
  D.userClick(edit);
  assert.ok(m.visible(m.q("#terms-form")) && !m.visible(edit) && edit.getAttribute("aria-expanded") === "true");
  assert.equal(m.rows().length, 3, "ohne Begriffe drei leere Zeilen");
  assert.equal(document.activeElement, m.rows()[0].querySelector("input.terms-t"));
  assert.deepEqual(m.rows().map((r) => r.querySelector("label").textContent), ["Begriff 1", "Begriff 2", "Begriff 3"]);
  assert.equal(m.rows()[1].querySelector(".terms-del").getAttribute("aria-label"), "Begriff 2 entfernen");
  // nur zwei ausgefüllt: Meldung, nichts gesendet
  fill(m.rows()[0], THREE[0].term, THREE[0].definition); fill(m.rows()[1], THREE[1].term, THREE[1].definition);
  D.fire(m.q("#terms-form"), "submit"); await D.sleep(5);
  assert.ok(m.visible(m.q("#terms-err")) && m.q("#terms-err").textContent.startsWith("Bitte mindestens 3 Fachbegriffe angeben"));
  assert.equal(document.activeElement, m.q("#terms-add"));
  // Begriff ohne Definition: Meldung am Feld
  fill(m.rows()[2], "Judikative", "");
  D.fire(m.q("#terms-form"), "submit"); await D.sleep(5);
  const d3 = m.rows()[2].querySelector("textarea.terms-d");
  assert.ok(m.q("#terms-err").textContent === "Begriff 3 („Judikative“): Bitte die Definition angeben." && d3.getAttribute("aria-invalid") === "true" && document.activeElement === d3);
  assert.equal(m.calls.length, 0, "nichts gesendet");
  fill(m.rows()[2], THREE[2].term, THREE[2].definition);
  assert.equal(m.rows()[2].querySelector(".terms-count").textContent, THREE[2].definition.length + " von 300 Zeichen");
  D.fire(m.q("#terms-form"), "submit"); await D.sleep(10);
  assert.deepEqual(m.calls[0].body, { terms: THREE, termsBase: 0 });
  assert.deepEqual(m.terms(), THREE.map((x) => x.term));
  assert.deepEqual($$(".terms-item dd", m.card.el).map((x) => x.textContent), THREE.map((x) => x.definition));
  assert.ok(!m.visible(m.q("#terms-form")) && document.activeElement === edit, "Fokus zurück auf „Bearbeiten“");
  assert.equal(m.q(".save-state").textContent, "Gespeichert");
  // ohne Beginn: der Hinweis sagt, was fehlt
  m.st.lesson.startTime = null; m.card.paintWhen();
  assert.equal(m.q("#terms-when").textContent, "Schüler:innen sehen die Karteikarten erst 2 Minuten vor dem Ende der Sitzung – dafür fehlt der Beginn (Uhrzeit) (bei den Sitzungsdaten).");
  assert.ok(m.q("#terms-when .warnc"));
});

test("Karte der Lehrkraft: hinzufügen bis 8 (aria-disabled + Hinweis), entfernen (Fokus auf den nächsten), doppelt, alle löschen mit Rückfrage, Abbrechen mit Rückfrage", async () => {
  const srv = server(THREE, 4);
  const m = mount({ terms: THREE, termsRev: 4 }, [srv.route]);
  D.userClick(m.q("#terms-edit"));
  assert.equal(m.rows().length, 3);
  const add = m.q("#terms-add");
  for (let i = 0; i < 5; i++) D.userClick(add);
  assert.equal(m.rows().length, 8);
  assert.equal(document.activeElement, m.rows()[7].querySelector("input.terms-t"), "Fokus ins neue Feld");
  assert.equal(add.getAttribute("aria-disabled"), "true");
  D.userClick(add);
  assert.equal(m.rows().length, 8); assert.equal(m.q("#terms-full").textContent, "Höchstens 8 Fachbegriffe je Sitzung.");
  // entfernen: Fokus auf den nächsten Begriff (am Ende: den vorigen)
  D.userClick(m.rows()[7].querySelector(".terms-del"));
  assert.equal(m.rows().length, 7); assert.ok(!add.hasAttribute("aria-disabled"));
  assert.equal(document.activeElement, m.rows()[6].querySelector("input.terms-t"));
  D.userClick(m.rows()[1].querySelector(".terms-del"));
  assert.equal(document.activeElement, m.rows()[1].querySelector("input.terms-t"));
  assert.deepEqual(m.rows().map((r) => r.querySelector("label").textContent).slice(0, 3), ["Begriff 1", "Begriff 2", "Begriff 3"], "neu nummeriert");
  // leere Zeilen zählen nicht; doppelt: Meldung am Begriff
  fill(m.rows()[2], "gewaltenteilung", "x");
  D.fire(m.q("#terms-form"), "submit"); await D.sleep(5);
  assert.ok(m.q("#terms-err").textContent === "„gewaltenteilung“ steht doppelt in der Liste." && document.activeElement === m.rows()[2].querySelector("input.terms-t"));
  // Abbrechen mit Änderung: Rückfrage
  D.userClick([...m.card.el.querySelectorAll("button")].find((b) => b.textContent === "Abbrechen")); await D.sleep(5);
  [...document.querySelector(".modal").querySelectorAll("button")].find((b) => b.textContent === "Verwerfen").click(); await D.sleep(5);
  assert.ok(!m.visible(m.q("#terms-form")) && document.activeElement === m.q("#terms-edit"));
  assert.deepEqual(m.terms(), THREE.map((x) => x.term), "unverändert");
  // alle entfernen und speichern: Rückfrage, dann gelöscht
  D.userClick(m.q("#terms-edit"));
  for (let i = 0; i < 3; i++) D.userClick(m.rows()[0].querySelector(".terms-del"));
  assert.equal(document.activeElement, add, "keine Zeile mehr: Fokus auf „Begriff hinzufügen“");
  D.fire(m.q("#terms-form"), "submit"); await D.sleep(5);
  const dlg = document.querySelector(".modal");
  assert.ok(dlg && dlg.textContent.includes("Alle Fachbegriffe löschen?"));
  [...dlg.querySelectorAll("button")].find((b) => b.textContent === "Löschen").click(); await D.sleep(15);
  assert.deepEqual(srv.s.items, []); assert.deepEqual(m.terms(), []);
  assert.ok(m.visible(m.q(".terms-empty")));
  assert.equal(m.q(".save-state").textContent, "Gelöscht");
});

test("Karte der Lehrkraft: inzwischen von Claude geändert (409) → Rückfrage, „Meine Fassung speichern“ ohne Stand; Stand von außen nie in die laufende Bearbeitung", async () => {
  const srv = server(THREE, 1);
  const m = mount({ terms: THREE, termsRev: 1 }, [srv.route]);
  srv.s.items = [...THREE, { term: "Exekutive", definition: "Die ausführende Gewalt." }]; srv.s.rev = 2;   // Claude speichert im Hintergrund
  D.userClick(m.q("#terms-edit"));
  fill(m.rows()[0], "Gewaltenteilung", "Neu von mir.");
  D.fire(m.q("#terms-form"), "submit"); await D.sleep(15);
  const modal = document.querySelector(".modal");
  assert.ok(modal && modal.textContent.includes("Die Fachbegriffe wurden inzwischen geändert") && modal.textContent.includes("Neu von mir.") && modal.textContent.includes("Exekutive: Die ausführende Gewalt."));
  [...modal.querySelectorAll("button")].find((b) => b.textContent === "Meine Fassung speichern").click(); await D.sleep(15);
  const patches = m.calls.filter((c) => c.method === "PATCH");
  assert.equal(patches.length, 2); assert.ok(!("termsBase" in patches[1].body), "ohne Stand");
  assert.equal(srv.s.items[0].definition, "Neu von mir."); assert.equal(srv.s.items.length, 3);
  assert.deepEqual(m.terms(), THREE.map((x) => x.term));
  // von außen während der Bearbeitung: erst nach dem Schließen
  D.userClick(m.q("#terms-edit"));
  m.card.update({ terms: [{ term: "A", definition: "a" }, { term: "B", definition: "b" }, { term: "C", definition: "c" }], termsRev: 9 });
  assert.equal(m.rows()[0].querySelector("input.terms-t").value, "Gewaltenteilung", "offenes Formular bleibt");
  assert.ok(!m.card.dirty());
  D.userClick([...m.card.el.querySelectorAll("button")].find((b) => b.textContent === "Abbrechen")); await D.sleep(5);
  assert.deepEqual(m.terms(), ["A", "B", "C"]); assert.equal(m.st.lesson.termsRev, 9);
  // gleiche Daten: keine Meldung „Aktualisiert“
  m.q(".save-state").textContent = "";
  m.card.update({ terms: m.st.lesson.terms, termsRev: 9 });
  assert.equal(m.q(".save-state").textContent, "");
  m.card.update({ terms: THREE, termsRev: 10 });
  assert.equal(m.q(".save-state").textContent, "Aktualisiert");
});

test("Sitzungsseite (Quelltext): Karte nur in der Oberstufe nach der Hausaufgabe, folgt Datum und Beginn, übernimmt Änderungen von außen, fragt vor „Alle Unterlagen“ nach; Dialog „Sitzung aus Datei laden“", () => {
  const s = src("public/session.js");
  for (const x of ["const terms = isOberstufe(L().klass) ? termsCard({ id, L }) : null;", "if (terms) onTimes.push(terms.paintWhen);", "portalCard, hwCard, terms ? terms.el : null, presPromptCard,",
    "if (terms) terms.update(r.lesson);", 'terms && terms.dirty() ? "den Fachbegriffen dieser Sitzung" : ""', "termsImportLine(plan, L())"]) assert.ok(s.includes(x), x);
  assert.equal(TE.termsImportLine({ lesson: { terms: [] }, termsDropped: 0 }, { klass: "8B" }), null);
  assert.equal(TE.termsImportLine({ lesson: { terms: [] }, termsDropped: 2 }, { klass: "8B" }).textContent, "Die 2 Fachbegriffe aus der Datei werden nicht übernommen – Karteikarten gibt es nur in der Oberstufe.");
});

/* ---------- Schüler:innen: Karteikarten (public/termcards.js) ---------- */
test("Karteikarten: leer ohne Begriffe; je Begriff ein Knopf (Name = Begriff, aria-expanded, aria-controls), Rückseite aria-hidden bis zum Umdrehen – Maus, Enter und Leertaste", async () => {
  const v = TC.termCards();
  const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove(); app.append(v.el);
  v.update(null);
  assert.equal(v.el.textContent, "", "ohne Begriffe nichts (ältere Sitzungen, vor der Zeit)");
  v.update(THREE);
  const sec = v.el.querySelector("section.termsbox");
  assert.equal(sec.getAttribute("aria-labelledby"), "terms-sh");
  assert.equal(sec.querySelector("h2").textContent, "Fachbegriffe dieser Sitzung");
  assert.equal(sec.querySelector(".hint").textContent, TC.TERMS_HINT);
  const cards = $$("li.tcard", sec), btns = $$("button.tcard-btn", sec);
  assert.equal(cards.length, 3);
  for (const [i, b] of btns.entries()) {
    const back = document.getElementById(b.getAttribute("aria-controls"));
    assert.equal(b.getAttribute("type"), "button");
    assert.equal(b.textContent, THREE[i].term, "Name des Knopfs = Begriff");
    assert.equal(b.getAttribute("aria-expanded"), "false");
    assert.ok(back && back.classList.contains("tback") && back.getAttribute("aria-hidden") === "true" && back.querySelector(".tdef").textContent === THREE[i].definition);
    assert.equal(cards[i].querySelector(".tfront").getAttribute("aria-hidden"), "true");
    assert.equal(cards[i].querySelector(".tterm").textContent, THREE[i].term);
  }
  // Maus
  D.userClick(btns[0]);
  assert.ok(cards[0].classList.contains("flipped") && btns[0].getAttribute("aria-expanded") === "true" && document.getElementById("tc-back-1").getAttribute("aria-hidden") === "false");
  D.userClick(btns[0]);
  assert.ok(!cards[0].classList.contains("flipped") && btns[0].getAttribute("aria-expanded") === "false" && document.getElementById("tc-back-1").getAttribute("aria-hidden") === "true");
  // Tastatur
  btns[1].focus(); D.press("Enter");
  assert.ok(cards[1].classList.contains("flipped"));
  D.press(" ");
  assert.ok(!cards[1].classList.contains("flipped"));
  D.press("Enter");
  assert.equal(document.activeElement, btns[1], "Fokus bleibt auf der Karte");
  // dieselben Begriffe beim Neuladen: nichts neu gezeichnet – umgedrehte Karte und Fokus bleiben
  v.update(THREE.map((x) => ({ ...x })));
  assert.ok(cards[1].isConnected && cards[1].classList.contains("flipped") && document.activeElement === btns[1]);
  // geänderte Begriffe: neu gezeichnet, der Fokus bleibt an derselben Stelle
  v.update([...THREE.slice(0, 2), { term: "Exekutive", definition: "Die ausführende Gewalt." }]);
  assert.ok(!cards[1].isConnected);
  assert.equal(document.activeElement, $$("button.tcard-btn", v.el)[1]);
  assert.deepEqual($$(".tterm", v.el).map((x) => x.textContent), ["Gewaltenteilung", "Legislative", "Exekutive"]);
  v.update([]);
  assert.equal(v.el.textContent, "");
});

test("Karteikarten: Gestaltung – Drehung nur ohne reduzierte Bewegung (3D, nur transform), sonst sofortiger Wechsel; Fachtönung, Fokusring, erzwungene Farben, Raster am Handy einspaltig", () => {
  const css = src("public/styles.css");
  const i = css.indexOf("/* Karteikarte umdrehen"), from = css.lastIndexOf("@media (prefers-reduced-motion: no-preference) {", i), to = css.indexOf("\n}", i), block = css.slice(from, to);
  for (const x of [".tcard-in { -webkit-transform-style: preserve-3d; transform-style: preserve-3d; transition: transform .4s var(--ease); }", ".tcard.flipped .tcard-in { transform: rotateY(180deg); }",
    ".tface { -webkit-backface-visibility: hidden; backface-visibility: hidden; }", ".tback { transform: rotateY(180deg); }"]) assert.ok(block.includes(x), x);
  const outside = css.slice(0, from) + css.slice(to);
  assert.ok(!/rotateY|preserve-3d|backface-visibility|\.tcard[^{]*\{[^}]*transition/.test(outside), "ohne Bewegung keine Drehung und kein Übergang – nur in diesem Block");
  assert.ok(css.slice(0, from).includes(".tcard:not(.flipped) .tback, .tcard.flipped .tfront { visibility: hidden; }"), "ohne Bewegung wechselt die Seite sofort");
  assert.match(css, /\.tfront \{[^}]*background: var\(--fach-t\); color: var\(--fach-text\);/);
  assert.match(css, /\.tback \{ background: var\(--surface\); color: var\(--text\); \}/);
  assert.match(css, /\.tcards \{[^}]*grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 14rem\), 1fr\)\);/);
  assert.match(css, /\.tcard-btn:focus-visible \{ outline: 3px solid var\(--ring, var\(--fach-text\)\);/);
  assert.match(css, /@media \(forced-colors: active\) \{ \.tface \{ border-color: CanvasText; \}/);
  assert.match(css, /\.tcard-in \{ display: grid; min-height: 8\.5rem;/, "mindestens 44 px hoch, Karte so hoch wie die längere Seite");
  assert.match(css, /\.tface \{ grid-area: 1 \/ 1;/);
});

test("Schüleransicht (Quelltext): Karteikarten ganz unten (Selbstlern-Phase über der KI-Begriffshilfe), beim Neuladen der Daten nachgezogen", () => {
  const app = src("public/app.js");
  assert.ok(app.includes("const termsView = termCards();\n  termsView.update(d.terms);"));
  assert.ok(app.includes("termsView.update(r.terms);"), "beim Neuladen (changesAt, Rückkehr in den Tab)");
  assert.ok(app.includes("  main.append(termsView.el);\n  // Selbstlern-Phase: die KI-Begriffshilfe ganz unten (Wortlaut der Lehrkraft)\n  if (selbst) main.append(kiBox);\n}"), "ganz unten, in der Selbstlern-Phase vor der KI-Begriffshilfe");
  assert.ok(!/\.innerHTML\b/.test(src("public/termcards.js")) && !/\.innerHTML\b/.test(src("public/termsedit.js")), "nur textContent");
});
