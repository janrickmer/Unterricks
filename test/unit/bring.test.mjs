// Nachtrag 28 (15.11.2026): „Gegenstände zum Mitbringen“ – Prüfung und Speicherform (public/bring.js), Worker (PATCH mit Stand, Sitzungsdatei, print-next
// ohne zusätzliche D1-Anweisung), Connector (update_lesson mitbringen, get_lesson beider Schulformen), Prompts beider Schulformen, Sitzungsdatei
// (Datum und Lerngruppe angepasst), der rote Kasten auf der Startseite (printnext.js) und die Karte der Sitzungsseite (bringcard.js). Nie für
// Schüler:innen oder Eltern. Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/lk" });
const B = await import("../../public/bring.js");
const S = await import("../../public/shared.js");
const P = await import("../../public/planning.js");
const SL = await import("../../public/selbstlern.js");
const G = await import("../../public/gsplanning.js");
const SF = await import("../../public/sessionfile.js");
const IO = await import("../../public/sessionio.js");
const F = await import("./stop-fixtures.mjs");
const { ApiError } = await import("../../public/ui.js");
const PN = await import("../../public/printnext.js");
const BC = await import("../../public/bringcard.js");
const { resetPrintQueue } = await import("../../public/designrender.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const L = await import("../../worker/lessons.js");
const ST = await import("../../worker/student.js");
const PA = await import("../../worker/parents.js");
const GS = await import("../../worker/gs.js");
const { routePrintNext } = await import("../../worker/printjobs.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting, COLUMNS } = await import("../../worker/db.js");

/* ---------- reine Funktionen (public/bring.js) ---------- */
test("Sätze zählen: Satzzeichen vor Großbuchstaben bzw. am Ende; Zahlen, einzelne Buchstaben, Abkürzungen und Kleinschreibung beenden keinen Satz", () => {
  const n = B.sentenceCount;
  assert.equal(n(""), 0); assert.equal(n("   "), 0);
  assert.equal(n("In Phase 2 (Erzählung) in der 2a zum Vorlesen."), 1);
  assert.equal(n("In Phase 2 (Erzählung). In der 2a/b."), 2);
  assert.equal(n("Für die Erzählung, z. B. Gen. 1 vorlesen. Kurs 8-K, 3. Phase."), 2, "z. B., Gen., 3. zählen nicht");
  assert.equal(n("Eins. Zwei. Drei."), 3);
  assert.equal(n("Eins! Zwei? Drei"), 3, "Text nach dem letzten Satzende zählt als Satz");
  assert.equal(n("ca. 10 Min. vor dem Ende in der 5c"), 1);
  assert.equal(n("Wir lesen Mt. 5,3 im Kurs E-K."), 1);
  assert.equal(n("„Sitzkreis.“ Dann im Kreis."), 2, "Anführungszeichen gehören zum Satz");
  assert.equal(n("8.30 Uhr: Einstieg"), 1, "Punkt mitten in einer Zahl");
  assert.equal(n("Klasse 8B. 5 Kinder lesen vor. Ende."), 3, "nach „8B.“ endet der Satz (keine reine Zahl)");
  assert.equal(n("Achtung! dann leise weiter."), 1, "klein weiter: kein Satzende");
  assert.equal(n("Im Einstieg am 10.11.2026. Danach im Kreis."), 2, "ein Datum am Satzende beendet den Satz");
  assert.equal(n("Zum Zeigen, z.B. Bilder. Im Kreis."), 2, "„z.B.“ ohne Leerzeichen zählt nicht");
  assert.equal(n("In Phase 2. In der 9D."), 1, "nach einer ein- oder zweistelligen Zahl im Zweifel kein Satzende");
  assert.equal(B.firstSentences("Eins. Zwei. Drei.", 2), "Eins. Zwei.");
  assert.equal(B.firstSentences("Nur einer.", 2), "Nur einer.");
});

test("validateBring: Liste, höchstens 10, Gegenstand Pflicht und ≤ 60 Zeichen, Hinweis ≤ 200 Zeichen und höchstens zwei Sätze, nicht doppelt", () => {
  assert.deepEqual(B.validateBring(null), []);
  assert.deepEqual(B.validateBring([{ item: "  Bibel ", note: " In Phase 2\n(Erzählung) im Kurs 8-K. " }, { item: "Beutel" }]),
    [{ item: "Bibel", note: "In Phase 2 (Erzählung) im Kurs 8-K." }, { item: "Beutel", note: "" }], "bereinigt, Hinweis freiwillig");
  const err = (raw, re) => assert.throws(() => B.validateBring(raw), re);
  err("Bibel", /müssen eine Liste sein/);
  err(Array.from({ length: 11 }, (_, i) => ({ item: "G" + i })), /Höchstens 10 Gegenstände/);
  err([{ note: "x" }], /Gegenstand 1: Bitte angeben/);
  err([{ item: "  " }], /Gegenstand 1: Bitte angeben/);
  err([{ item: "x".repeat(61) }], /Gegenstand 1 .* ist zu lang \(höchstens 60 Zeichen\)/);
  err([{ item: "Bibel", note: "x".repeat(201) }], /Der Hinweis zu „Bibel“ ist zu lang \(201 Zeichen, höchstens 200\)/);
  err([{ item: "Bibel", note: "Eins. Zwei. Drei." }], /Der Hinweis zu „Bibel“ hat mehr als zwei Sätze/);
  err([{ item: "Bibel" }, { item: "bibel" }], /„bibel“ steht doppelt/);
  err([{ item: "Bibel", note: 5 }], /muss ein Text sein/);
  err(["x"], /Gegenstand 1 ist ungültig/);
});

test("cleanBring (fremde Daten) kürzt statt abzulehnen; Speicherform mit Stand; packList fasst denselben Gegenstand mehrerer Sitzungen zusammen", () => {
  const xs = B.cleanBring([{ item: "Bibel", note: "Eins. Zwei. Drei." }, { item: "BIBEL" }, { item: 7 }, null, { item: "x".repeat(80), note: "y".repeat(300) }, ...Array.from({ length: 12 }, (_, i) => ({ item: "G" + i }))]);
  assert.equal(xs.length, 10);
  assert.deepEqual(xs[0], { item: "Bibel", note: "Eins. Zwei." }, "auf zwei Sätze gekürzt");
  assert.equal(xs[1].item.length, 60); assert.equal(xs[1].note.length, 200); assert.ok(xs[1].note.endsWith("…"));
  assert.deepEqual(B.cleanBring("kaputt"), []);
  assert.deepEqual(B.bringRead(null), { rev: 0, items: [] });
  assert.deepEqual(B.bringRead("{kaputt"), { rev: 0, items: [] });
  assert.deepEqual(B.bringRead(B.bringStore([{ item: "Bibel", note: "Phase 2." }])), { rev: 0, items: [{ item: "Bibel", note: "Phase 2." }] });
  assert.deepEqual(B.bringRead('{"v":1,"rev":4,"items":[{"t":"Beutel","w":""}]}'), { rev: 4, items: [{ item: "Beutel", note: "" }] });
  const list = B.packList([
    { id: "a", school: "gym", label: "Rel 8-K", startTime: "07:50", title: "Schöpfung", bring: [{ item: "Bibel", note: "In Phase 2 im Kurs 8-K." }, { item: "Beutel", note: "" }] },
    { id: "b", school: "gs", label: "Religion 2ab", startTime: "09:40", title: "Josef", bring: [{ item: "bibel", note: "Zum Vorlesen in der 2a/b." }] },
    { id: "c", school: "gym", label: "PoWi 9D", startTime: null, title: "Wahlen" },
  ]);
  assert.deepEqual(list.map((x) => [x.item, x.places.length]), [["Bibel", 2], ["Beutel", 1]]);
  assert.deepEqual(list[0].places.map(B.placeLabel), ["Rel 8-K, 07:50 Uhr", "Grundschule Religion 2ab, 09:40 Uhr"]);
  assert.deepEqual(list[0].places.map(B.placeText), ["In Phase 2 im Kurs 8-K.", "Zum Vorlesen in der 2a/b."]);
  assert.equal(B.placeText(list[1].places[0]), "Gebraucht in der Stunde „Schöpfung“.", "ohne Hinweis: der Titel der Sitzung");
  assert.deepEqual(B.packList(null), []);
});

test("Prompts beider Schulformen: genau ein Speicherschritt mitbringen; get_lesson-Abschnitt; MCP-Anweisungen unverändert ohne „mitbringen“", async () => {
  const s = F.sekCtx(P.unitContext), g = F.gsCtx(P.unitContext);
  for (const [p, gs] of [[P.claudeLessonPrompt(s), false], [P.claudeLessonPrompt({ ...s, klass: "6B" }), false], [G.claudeGsLessonPrompt(g), true]]) {
    assert.equal(p.split(B.bringSaveStep(gs)).length - 1, 1);
    assert.ok(p.includes("`update_lesson` ") && p.includes("`mitbringen`") && p.includes("in höchstens zwei Sätzen, an welcher Stelle der Stunde (Phase) und in welcher Lerngruppe"));
  }
  for (const p of [G.claudeGsUnitPrompt ? G.claudeGsUnitPrompt({ ...g, unit: { rows: [] } }) : "", SL.claudeSelbstlernPrompt({ ...s, row: null })]) assert.ok(!p.includes("mitbringen"), "andere Prompts unverändert (auch die Selbstlern-Phase – die Lehrkraft ist nicht da)");
  assert.deepEqual(B.bringSection([]).slice(0, 2), ["", "## Mitbringen (Gegenstände, die die Lehrkraft für diese Stunde mitbringen muss)"]);
  assert.ok(B.bringSection([]).join("\n").includes("trage es nach ihrer Freigabe mit update_lesson und mitbringen ein"));
  assert.deepEqual(B.bringSection([{ item: "Bibel", note: "Phase 2." }, { item: "Beutel", note: "" }]).slice(2, 4), ["- Bibel: Phase 2.", "- Beutel (ohne Hinweis)"]);
  const r = await mcp(await base(), "initialize", { protocolVersion: "2025-06-18" });
  assert.ok(!r.instructions.includes("mitbringen") && r.instructions.length <= 5724, "Server-Anweisungen nicht länger");
  const tl = (await mcp(await base(), "tools/list", {})).tools.find((t) => t.name === "update_lesson");
  assert.deepEqual(tl.inputSchema.properties.mitbringen.items.required, ["gegenstand", "wofuer"]);
  assert.equal(tl.inputSchema.properties.mitbringen.maxItems, 10);
});

/* ---------- Worker und Connector ---------- */
const TOKEN = "lehrkraft-token-bring", STOKEN = "schueler-token-bring", DEV = "eeeeeeeeeeeeeeee";
const callAs = (tok) => async (c, fn, method, path, body, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method, headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code, ...(e.extra || {}) } }; }
};
const call = callAs(TOKEN), scall = callAs(STOKEN), pub = callAs(null);
async function mcp(c, method, params) {
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
}
const tool = async (c, name, args) => { const r = await mcp(c, "tools/call", { name, arguments: args }); return { text: r.content[0].text, isError: !!r.isError, data: r.structuredContent }; };
// Dienstag, 17.11.2026, 10:00 Berlin → nächster Arbeitstag Mittwoch, 18.11.
const NOW = Date.UTC(2026, 10, 17, 9, 0);
async function base() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = NOW;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  return c;
}

test("Spalte lessons.bring (additiv); PATCH mit Stand: speichert, zählt rev hoch, 409 bei veraltetem Stand, 400 bei ungültiger Liste; nie bei einem Ausfall-Eintrag", async () => {
  assert.ok(COLUMNS.some(([t, c, d]) => t === "lessons" && c === "bring" && d === "TEXT"));
  const c = await base();
  const l = await L.createLesson(c.db, { subject: "evrel", klass: "8-K", title: "Schöpfung", date: "2026-11-18", startTime: "07:50" }, c.now);
  let r = await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id);
  assert.deepEqual([r.data.lesson.bring, r.data.lesson.bringRev], [[], 0]);
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [{ item: "Bibel", note: "In Phase 2 im Kurs 8-K." }], bringBase: 0 }, l.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.lesson.bring, r.data.lesson.bringRev], [[{ item: "Bibel", note: "In Phase 2 im Kurs 8-K." }], 1]);
  // ohne Stand (Connector): gespeichert, rev 2
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [{ item: "Bibel", note: "x" }, { item: "Beutel", note: "" }] }, l.id);
  assert.equal(r.data.lesson.bringRev, 2);
  // veralteter Stand (1): 409 mit der aktuellen Liste, nichts gespeichert
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [], bringBase: 1 }, l.id);
  assert.deepEqual([r.status, r.data.code, r.data.current.rev, r.data.current.items.length], [409, "bring_conflict", 2, 2]);
  assert.match(r.data.error, /Die Liste „Mitbringen“ wurde inzwischen an anderer Stelle geändert/);
  // Zusammenfassung mit eigenem Stand im selben Aufruf: beide Schutzprüfungen
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [], bringBase: 2, teacherSummary: "Neu.", teacherSummaryBase: 999 }, l.id);
  assert.deepEqual([r.status, r.data.code], [409, "summary_conflict"]);
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [], bringBase: 2, teacherSummary: "Neu.", teacherSummaryBase: null }, l.id);
  assert.deepEqual([r.status, r.data.lesson.bring, r.data.lesson.bringRev, r.data.lesson.teacherSummary], [200, [], 3, "Neu."]);
  // ungültig: 400 mit der Meldung; Stand fehlerhaft
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [{ item: "Bibel", note: "Eins. Zwei. Drei." }] }, l.id);
  assert.deepEqual([r.status, r.data.error], [400, "Der Hinweis zu „Bibel“ hat mehr als zwei Sätze – bitte in höchstens zwei Sätzen sagen, wo und in welcher Lerngruppe er gebraucht wird."]);
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [], bringBase: "x" }, l.id);
  assert.equal(r.status, 400);
  // Ausfall-Eintrag (Grundschule): nur der Hinweis für die Eltern
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/x", { grade: 2, classes: ["a", "b"], religion: true, weekdays: [{ day: 3, minutes: 45, time: "09:40" }] })).data.course;
  const g = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Josef", date: "2026-11-18", startTime: "09:40" }, c.now);
  c.db.raw.prepare("UPDATE lessons SET cancelled=1 WHERE id=?").run(g.id);
  r = await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [{ item: "Beutel" }] }, g.id);
  assert.deepEqual([r.status, r.data.error], [400, "Bei einem Ausfall-Eintrag lässt sich nur der Hinweis der Lehrkraft für die Eltern ändern."]);
});

test("Connector: update_lesson mitbringen (Gymnasium und Grundschule), Antwort, Fehler; get_lesson zeigt die Liste bzw. wie man sie anlegt; nie beim Ausfall-Eintrag", async () => {
  const c = await base();
  const l = await L.createLesson(c.db, { subject: "evrel", klass: "8-K", title: "Schöpfung", date: "2026-11-18", startTime: "07:50" }, c.now);
  let g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes("## Mitbringen (Gegenstände, die die Lehrkraft für diese Stunde mitbringen muss)\n(keine – braucht die Stunde etwas") && g.text.indexOf("## Mitbringen") < g.text.indexOf("## Planungsverlauf"));
  let r = await tool(c, "update_lesson", { lesson_id: l.id, mitbringen: [{ gegenstand: "Bibel", wofuer: "In Phase 2 (Erarbeitung) im Kurs 8-K zum Vorlesen von Gen 1." }, { gegenstand: "Beutel", wofuer: "Für das Fühlspiel im Einstieg." }] });
  assert.ok(!r.isError && r.text === "Gespeichert. Mitbringen (2 Gegenstände): Bibel, Beutel – Unterricks zeigt sie der Lehrkraft am Vortag auf der Startseite („Für den nächsten Arbeitstag einpacken“).", r.text);
  assert.deepEqual(r.data.lesson.bring.map((x) => x.item), ["Bibel", "Beutel"]);
  g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes("- Bibel: In Phase 2 (Erarbeitung) im Kurs 8-K zum Vorlesen von Gen 1.\n- Beutel: Für das Fühlspiel im Einstieg.\n(Unterricks zeigt sie der Lehrkraft am Vortag"));
  r = await tool(c, "update_lesson", { lesson_id: l.id, mitbringen: [{ gegenstand: "Bibel", wofuer: "Eins. Zwei. Drei." }] });
  assert.ok(r.isError && r.text.includes("hat mehr als zwei Sätze"), r.text);
  r = await tool(c, "update_lesson", { lesson_id: l.id, mitbringen: [{ gegenstand: "Bibel" }] });
  assert.ok(r.isError && r.text.startsWith("mitbringen, Eintrag 1: gegenstand und wofuer sind Pflicht"), r.text);
  r = await tool(c, "update_lesson", { lesson_id: l.id, mitbringen: "Bibel" });
  assert.ok(r.isError && r.text.startsWith("mitbringen ist eine Liste"));
  assert.equal((await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.lesson.bring.length, 2, "nach Fehlern unverändert");
  r = await tool(c, "update_lesson", { lesson_id: l.id, mitbringen: [] });
  assert.ok(!r.isError && r.text === "Gespeichert. Die Liste „Mitbringen“ ist leer.", r.text);
  r = await tool(c, "update_lesson", { lesson_id: l.id, titel: "Schöpfung 2" });
  assert.equal(r.text, "Gespeichert.", "ohne mitbringen: Antwort wie bisher");
  // Grundschule
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/x", { grade: 2, classes: ["a", "b"], religion: true, weekdays: [{ day: 3, minutes: 45, time: "09:40" }] })).data.course;
  const gl = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Josef", date: "2026-11-18", startTime: "09:40" }, c.now);
  r = await tool(c, "update_lesson", { lesson_id: gl.id, mitbringen: [{ gegenstand: "Bunter Mantel (Tuch)", wofuer: "In der Erzählung im Sitzkreis der 2a/b." }] });
  assert.ok(!r.isError && r.text.includes("Mitbringen (1 Gegenstand): Bunter Mantel (Tuch)"), r.text);
  g = await tool(c, "get_lesson", { lesson_id: gl.id });
  assert.ok(g.text.includes("## Mitbringen (Gegenstände, die die Lehrkraft für diese Stunde mitbringen muss)\n- Bunter Mantel (Tuch): In der Erzählung im Sitzkreis der 2a/b.")
    && g.text.indexOf("## Mitbringen") < g.text.indexOf("## Inhalt der Unterrichtsstunde (für die Eltern)"));
  c.db.raw.prepare("UPDATE lessons SET cancelled=1 WHERE id=?").run(gl.id);
  g = await tool(c, "get_lesson", { lesson_id: gl.id });
  assert.ok(!g.text.includes("## Mitbringen"), "Ausfall-Eintrag: kein Abschnitt");
  r = await tool(c, "update_lesson", { lesson_id: gl.id, mitbringen: [] });
  assert.ok(r.isError);
});

test("print-next: Gegenstände der Sitzungen des Tages in derselben Antwort (≤ 8 D1-Anweisungen), ohne Ausfall-Einträge und andere Tage; nie für Schüler:innen oder Eltern", async () => {
  const c = await base();
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/x", { grade: 2, classes: ["a", "b"], religion: true, weekdays: [{ day: 3, minutes: 45, time: "09:40" }] })).data.course;
  const gym = await L.createLesson(c.db, { subject: "evrel", klass: "8-K", title: "Schöpfung", date: "2026-11-18", startTime: "07:50" }, c.now);
  const gs = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Josef", date: "2026-11-18", startTime: "09:40" }, c.now);
  const off = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Ausfall", date: "2026-11-18", startTime: "11:00" }, c.now);
  const later = await L.createLesson(c.db, { subject: "powi", klass: "9D", title: "Wahlen", date: "2026-11-19", startTime: "08:00" }, c.now);
  for (const [id, items] of [[gym.id, [{ item: "Bibel", note: "In Phase 2 im Kurs 8-K." }]], [gs.id, [{ item: "Bibel", note: "Zum Vorlesen in der 2a/b." }, { item: "Beutel", note: "" }]],
    [off.id, [{ item: "Ausfall-Ding", note: "" }]], [later.id, [{ item: "Donnerstag-Ding", note: "" }]]]) assert.equal((await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: items }, id)).status, 200);
  c.db.raw.prepare("UPDATE lessons SET cancelled=1 WHERE id=?").run(off.id);
  c.db.counter.n = 0;
  const r = await call(c, routePrintNext, "GET", "/api/teacher/print-next");
  assert.equal(r.status, 200);
  assert.ok(c.db.counter.n <= 8, "D1-Anweisungen: " + c.db.counter.n);
  assert.deepEqual(r.data.sessions.map((s) => [s.title, (s.bring || []).map((x) => x.item)]), [["Schöpfung", ["Bibel"]], ["Josef", ["Bibel", "Beutel"]]]);
  assert.deepEqual(B.packList(r.data.sessions).map((x) => x.item + ":" + x.places.length), ["Bibel:2", "Beutel:1"]);
  // ohne Gegenstände: kein Feld bring (Antwort wie bisher)
  await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [] }, gym.id);
  assert.equal("bring" in (await call(c, routePrintNext, "GET", "/api/teacher/print-next")).data.sessions[0], false);
  // Schüleransicht und Elternansicht: nie
  const sl = await L.createLesson(c.db, { subject: "powi", klass: "9D", title: "Wahlen", date: "2026-11-17", startTime: "08:00", durationMin: 45 }, c.now - 864e5);
  await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [{ item: "GEHEIMDING", note: "LEHRKRAFTGEHEIM" }] }, sl.id);
  c.db.raw.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, '9D', 'powi', ?, ?, ?)").run(DEV, await sha256Hex(STOKEN), c.now, c.now, c.now + 3600e3);
  const join = await scall(c, ST.routeStudentJoin, "POST", "/api/student/join", { code: sl.code });
  const sv = await scall(c, ST.routeStudentLesson, "GET", "/x", undefined, sl.id);
  assert.equal(sv.status, 200, JSON.stringify(sv.data));
  assert.equal(join.status, 200);
  for (const x of [join.data, sv.data]) assert.ok(!JSON.stringify(x).includes("GEHEIMDING") && !JSON.stringify(x).includes("bring"), JSON.stringify(x).slice(0, 200));
  await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [{ item: "GEHEIMDING", note: "LEHRKRAFTGEHEIM" }] }, gs.id);
  const tok = (await call(c, PA.routeTeacherParentLink, "POST", "/x", {}, gs.id)).data.token;
  for (const fn of [PA.routeParentLesson, PA.routeParentPrevious]) { const p = await pub(c, fn, "POST", "/api/eltern/x", { token: tok }); assert.ok(!JSON.stringify(p.data).includes("GEHEIMDING")); }
  const pv = await call(c, PA.routeTeacherParentPreview, "GET", "/x", undefined, gs.id);
  assert.ok(!JSON.stringify(pv.data).includes("GEHEIMDING"));
  // im Quelltext: Schüler-, Eltern-, Beamer- und Live-Module kennen die Liste nicht
  const { readFileSync } = await import("node:fs");
  for (const f of ["worker/student.js", "worker/parents.js", "worker/beamer.js", "worker/live.js", "worker/livestate.js", "public/parents.js", "public/beamer.js", "public/presenter.js"])
    assert.ok(!/\bbring\b|bringRead|mitbringen/.test(readFileSync(new URL("../../" + f, import.meta.url), "utf8")), f);
});

test("Sitzungsdatei: Liste in der Datei (nur wenn vorhanden), geprüft beim Lesen; beim Laden Datum und Lerngruppe in den Hinweisen angepasst, ersetzt die Liste", async () => {
  const file = (lesson) => SF.cleanSessionFile({ kind: SF.SESSION_FILE.kind, v: SF.SESSION_FILE.v, source: { subject: "powi", klass: "8B", date: "2026-11-10", nextDate: "2026-11-17" }, lesson });
  assert.equal("bring" in file({ title: "T" }).lesson, false, "ältere Dateien unverändert");
  const d = file({ title: "T", bring: [{ item: "Zeitung", note: "Im Einstieg der 8b am 10.11.2026. Danach Q2-GK? Nein: 18B bleibt. Vierter Satz." }, { item: "zeitung" }, "kaputt"] });
  assert.deepEqual(d.lesson.bring, [{ item: "Zeitung", note: "Im Einstieg der 8b am 10.11.2026. Danach Q2-GK?" }], "auf zwei Sätze gekürzt, doppelt und Ungültiges entfernt");
  const plan = IO.planSessionImport(d, { date: "2026-11-24", nextDate: "2026-12-01", klass: "8C" });
  assert.deepEqual(plan.lesson.bring, [{ item: "Zeitung", note: "Im Einstieg der 8c am 24.11.2026. Danach Q2-GK?" }]);
  assert.deepEqual(plan.groupReplaced, [["8b", "8c"]]);
  assert.ok(plan.replaced.some(([a, b]) => a === "10.11.2026" && b === "24.11.2026"));
  // ohne Liste in der Datei: leere Liste (die Datei ersetzt die Planung der Sitzung)
  assert.deepEqual(IO.planSessionImport(file({ title: "T" }), { date: "2026-11-24", klass: "8C" }).lesson.bring, []);
  // Lerngruppe: nur ganze Bezeichnungen; Kurse und Q-Phase
  const ad = (note, from, to) => SF.adaptBringGroup([{ item: "x", note }], from, to).items[0].note;
  assert.equal(ad("In der 8B und 8b, nicht 18B oder 8Ba.", "8B", "9A"), "In der 9A und 9a, nicht 18B oder 8Ba.");
  assert.equal(ad("Im Kurs 8-K (Kurs Jg. 8), auch 8 K.", "8-K", "9-K"), "Im Kurs 9-K (Kurs Jg. 9), auch 9 K.");
  assert.equal(ad("Im Q2-GK und Q2 GK.", "Q2-GK", "Q3-LK"), "Im Q3-LK und Q3 LK.");
  assert.equal(ad("In der 8B.", "8B", "8B"), "In der 8B.");
  assert.equal(ad("In der 8B.", "8B", "gs12345678"), "In der 8B.", "Grundschule: keine Anpassung");
  // Server: ersetzt die Liste (bereinigt), Stand zählt weiter
  const c = await base();
  const l = await L.createLesson(c.db, { subject: "powi", klass: "8C", title: "Alt", date: "2026-11-24" }, c.now);
  await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [{ item: "Alt" }] }, l.id);
  let r = await call(c, L.routeLessonImport, "POST", "/x", { lesson: { ...plan.lesson, bring: [...plan.lesson.bring, { item: "y".repeat(90), note: "Eins. Zwei. Drei." }] }, chat: [] }, l.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  r = await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id);
  assert.deepEqual(r.data.lesson.bring, [{ item: "Zeitung", note: "Im Einstieg der 8c am 24.11.2026. Danach Q2-GK?" }, { item: "y".repeat(60), note: "Eins. Zwei." }]);
  assert.equal(r.data.lesson.bringRev, 2);
  // Datei herunterladen: die Liste steht in sitzung.json (nur wenn vorhanden)
  const zipOf = async (lesson) => {
    const z = await IO.buildSessionZip({ lesson: { subject: "powi", klass: "8C", title: "T", topic: "", date: "2026-11-24", portal: "", ...lesson }, files: [], drafts: [], sheets: [], messages: [] }, { fb: null });
    const { readZip } = await import("../../public/zip.js");
    return JSON.parse(new TextDecoder().decode((await readZip(z.bytes)).find((e) => e.name === "sitzung.json").data));
  };
  assert.deepEqual((await zipOf({ bring: [{ item: "Zeitung", note: "Im Einstieg." }] })).lesson.bring, [{ item: "Zeitung", note: "Im Einstieg." }]);
  assert.equal("bring" in (await zipOf({ bring: [] })).lesson, false);
});

/* ---------- Startseite: roter Kasten unter den Druckaufträgen (public/printnext.js) ---------- */
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
async function startPage(data) {
  if (globalThis.__leave) globalThis.__leave();
  resetPrintQueue();
  globalThis.__tapi = async (method, path) => { if (method + " " + path === "GET /api/teacher/print-next") { if (data instanceof Error) throw data; return data; } throw new ApiError("nicht nachgebildet", 404, {}); };
  const app = document.getElementById("app");
  while (app.firstChild) app.firstChild.remove();
  const { card, pack } = PN.printNextCards();
  app.append(card, pack);
  await D.sleep(5);
  return { card, pack };
}
const DAY = (sessions) => ({ ok: true, today: "2026-11-17", candidate: "2026-11-18", date: "2026-11-18", sessions });
const SES = (id, extra) => ({ id, subject: "evrel", klass: "8-K", title: "Schöpfung", date: "2026-11-18", startTime: "07:50", school: "gym", label: "Rel 8-K", subtitle: "", files: [], ...extra });

test("Startseite: roter Kasten direkt unter den Druckaufträgen nur mit Gegenständen; Stichpunkte als Knöpfe mit aria-expanded, aufgeklappt Lerngruppe und Hinweis (Maus und Tastatur)", async () => {
  // ohne Gegenstände (und ohne Unterricht bzw. bei einem Fehler): kein Kasten
  for (const d of [DAY([SES("aaaaaaaaaaaaaaaa")]), { ok: true, today: "2026-11-17", candidate: "2026-11-18", date: null, sessions: [] }, new ApiError("kaputt", 500, {})]) {
    const { pack } = await startPage(d);
    assert.ok(pack.classList.contains("hidden"), "verborgen");
  }
  const { card, pack } = await startPage(DAY([SES("aaaaaaaaaaaaaaaa", { bring: [{ item: "Bibel", note: "In Phase 2 im Kurs 8-K." }, { item: "Beutel", note: "" }] }),
    SES("bbbbbbbbbbbbbbbb", { subject: "gs", school: "gs", label: "Religion 2ab", startTime: "09:40", title: "Josef", bring: [{ item: "bibel", note: "Zum Vorlesen in der 2a/b." }] })]));
  assert.ok(!pack.classList.contains("hidden") && card.nextSibling === pack, "sichtbar, direkt unter dem Feld der Druckaufträge");
  assert.equal(pack.querySelector("h2").textContent, "Für den nächsten Arbeitstag einpacken");
  assert.equal(pack.querySelector("#pk-day").textContent, "für morgen, Mittwoch, 18.11.2026");
  assert.equal(pack.getAttribute("aria-labelledby"), "pk-h");
  const btns = $$("button.pk-item", pack);
  assert.deepEqual(btns.map((b) => b.textContent), ["Bibel · 2 Stunden", "Beutel"]);
  assert.ok(btns.every((b) => b.getAttribute("aria-expanded") === "false" && document.getElementById(b.getAttribute("aria-controls")).classList.contains("hidden")));
  // Klick: aufgeklappt, je Sitzung Lerngruppe (Link zur Sitzung) und Hinweis
  D.userClick(btns[0]);
  const note = document.getElementById(btns[0].getAttribute("aria-controls"));
  assert.equal(btns[0].getAttribute("aria-expanded"), "true"); assert.ok(!note.classList.contains("hidden"));
  assert.deepEqual($$(".pk-place", note).map((p) => p.textContent), ["Rel 8-K, 07:50 Uhr: In Phase 2 im Kurs 8-K.", "Grundschule Religion 2ab, 09:40 Uhr: Zum Vorlesen in der 2a/b."]);
  assert.deepEqual($$(".pk-place a", note).map((a) => a.getAttribute("href")), ["#/lk/s/aaaaaaaaaaaaaaaa", "#/lk/s/bbbbbbbbbbbbbbbb"]);
  D.userClick(btns[0]);
  assert.equal(btns[0].getAttribute("aria-expanded"), "false"); assert.ok(note.classList.contains("hidden"));
  // Tastatur: Enter und Leertaste
  btns[1].focus(); D.press("Enter");
  assert.equal(btns[1].getAttribute("aria-expanded"), "true");
  assert.equal(document.getElementById(btns[1].getAttribute("aria-controls")).textContent, "Rel 8-K, 07:50 Uhr: Gebraucht in der Stunde „Schöpfung“.");
  D.press(" ");
  assert.equal(btns[1].getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, btns[1], "Fokus bleibt auf dem Gegenstand");
});

/* ---------- Sitzungsseite: Karte „Mitbringen“ (public/bringcard.js) ---------- */
function mount(lesson = {}, routes = [], course = null) {
  const calls = [];
  globalThis.__tapi = async (method, path, o = {}) => {
    calls.push({ method, path, body: o.body });
    for (const [re, fn] of routes) { const m = re.exec(method + " " + path); if (m) return fn(m, o.body || {}); }
    throw new ApiError("nicht nachgebildet: " + method + " " + path, 404, { code: "not_found" });
  };
  const st = { lesson: { id: "l1", subject: "powi", klass: "8B", bring: [], bringRev: 0, ...lesson } };
  const card = BC.bringCard({ id: "l1", L: () => st.lesson, course });
  const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove(); app.append(card.el);
  const q = (s) => card.el.querySelector(s), visible = (el) => !!el && !el.classList.contains("hidden");
  const items = () => $$(".bring-item", card.el).map((x) => x.textContent);
  return { card, st, calls, q, visible, items };
}
// Server-Nachbildung: speichert mit Stand wie der Worker (409 bei veraltetem Stand)
function server(start = [], rev = 0) {
  const s = { items: start, rev };
  return { s, route: [/^PATCH \/api\/teacher\/lessons\/l1$/, (_, b) => {
    if (b.bringBase !== undefined && b.bringBase !== s.rev) throw new ApiError("Die Liste „Mitbringen“ wurde inzwischen an anderer Stelle geändert.", 409, { code: "bring_conflict", current: { items: s.items, rev: s.rev } });
    s.items = B.validateBring(b.bring); s.rev++;
    return { ok: true, lesson: { bring: s.items, bringRev: s.rev } };
  }] };
}

test("Karte „Mitbringen“: leer mit Hinweis; hinzufügen (Fokus ins Feld, Speichern mit Stand, Fokus zurück); Fehler am Feld (zwei Sätze, doppelt); bearbeiten; löschen mit Rückfrage", async () => {
  const srv = server();
  const m = mount({}, [srv.route]);
  assert.equal(m.q("#bring-h").tagName, "H2"); assert.equal(m.q("#bring-h").textContent, "Mitbringen");
  assert.ok(m.visible(m.q(".bring-empty")) && !m.visible(m.q("#bring-list")));
  assert.equal(m.q(".bring-intro").textContent, BC.BRING_INTRO);
  const add = m.q("#bring-add");
  D.userClick(add);
  assert.ok(m.visible(m.q("#bring-form")) && document.activeElement === m.q("#bring-item") && !m.visible(add));
  assert.equal(m.q("#bring-form-h").textContent, "Gegenstand hinzufügen");
  // ohne Gegenstand: Meldung am Feld
  D.fire(m.q("#bring-form"), "submit");
  assert.ok(m.visible(m.q("#bring-err")) && m.q("#bring-item").getAttribute("aria-invalid") === "true" && document.activeElement === m.q("#bring-item"));
  m.q("#bring-item").value = "Bibel"; m.q("#bring-note").value = "Eins. Zwei. Drei."; D.fire(m.q("#bring-note"), "input");
  assert.equal(m.q("#bring-count").textContent, "17 von 200 Zeichen");
  D.fire(m.q("#bring-form"), "submit");
  assert.ok(m.q("#bring-err").textContent.includes("mehr als zwei Sätze") && m.q("#bring-note").getAttribute("aria-invalid") === "true" && document.activeElement === m.q("#bring-note"));
  assert.equal(m.calls.length, 0, "nichts gesendet");
  m.q("#bring-note").value = "In Phase 2 im Kurs zum Vorlesen.";
  D.fire(m.q("#bring-form"), "submit"); await D.sleep(10);
  assert.deepEqual(m.calls[0].body, { bring: [{ item: "Bibel", note: "In Phase 2 im Kurs zum Vorlesen." }], bringBase: 0 });
  assert.deepEqual(m.items(), ["Bibel"]); assert.equal(m.st.lesson.bringRev, 1);
  assert.ok(!m.visible(m.q("#bring-form")) && document.activeElement === add, "Fokus zurück auf „Gegenstand hinzufügen“");
  assert.equal(m.q(".save-state").textContent, "„Bibel“ hinzugefügt");
  // doppelt
  D.userClick(add); m.q("#bring-item").value = "bibel"; D.fire(m.q("#bring-form"), "submit");
  assert.ok(m.q("#bring-err").textContent.includes("steht doppelt") && document.activeElement === m.q("#bring-item"));
  // Abbrechen mit Eingabe: Rückfrage
  D.userClick([...m.card.el.querySelectorAll("button")].find((b) => b.textContent === "Abbrechen")); await D.sleep(5);
  [...document.querySelector(".modal").querySelectorAll("button")].find((b) => b.textContent === "Verwerfen").click(); await D.sleep(5);
  assert.ok(!m.visible(m.q("#bring-form")) && document.activeElement === add);
  // bearbeiten: Fokus danach auf den Stift derselben Zeile
  const edit = m.q("button.bring-edit");
  assert.equal(edit.getAttribute("aria-label"), "„Bibel“ bearbeiten");
  D.userClick(edit);
  assert.equal(m.q("#bring-form-h").textContent, "„Bibel“ bearbeiten"); assert.equal(m.q("#bring-item").value, "Bibel");
  m.q("#bring-item").value = "Kinderbibel"; D.fire(m.q("#bring-form"), "submit"); await D.sleep(10);
  assert.deepEqual(m.items(), ["Kinderbibel"]);
  assert.equal(document.activeElement, m.q("button.bring-edit"));
  assert.equal(document.activeElement.getAttribute("aria-label"), "„Kinderbibel“ bearbeiten");
  // löschen: Rückfrage, danach Fokus auf „Gegenstand hinzufügen“
  D.userClick(m.q("button.bring-del")); await D.sleep(5);
  const dlg = document.querySelector(".modal");
  assert.ok(dlg.textContent.includes("„Kinderbibel“ löschen?"));
  [...dlg.querySelectorAll("button")].find((b) => b.textContent === "Löschen").click(); await D.sleep(15);
  assert.deepEqual(m.items(), []); assert.deepEqual(srv.s.items, []);
  assert.ok(m.visible(m.q(".bring-empty")) && document.activeElement === add);
});

test("Karte „Mitbringen“: inzwischen von Claude geändert (409) → dieselbe Änderung auf den neuen Stand; gelöschter Gegenstand beim Bearbeiten gemeldet; Stand von außen nie ins offene Formular; höchstens 10", async () => {
  const srv = server([{ item: "Bibel", note: "" }], 1);
  const m = mount({ bring: [{ item: "Bibel", note: "" }], bringRev: 1 }, [srv.route]);
  // Claude speichert im Hintergrund: Beutel dazu
  srv.s.items = [{ item: "Bibel", note: "" }, { item: "Beutel", note: "Fühlspiel." }]; srv.s.rev = 2;
  D.userClick(m.q("#bring-add")); m.q("#bring-item").value = "Kerze"; D.fire(m.q("#bring-form"), "submit"); await D.sleep(15);
  assert.deepEqual(srv.s.items.map((x) => x.item), ["Bibel", "Beutel", "Kerze"], "auf dem neuen Stand ergänzt");
  assert.deepEqual(m.items(), ["Bibel", "Beutel", "Kerze"]);
  assert.match(m.q(".save-state").textContent, /^„Kerze“ hinzugefügt – die Liste war inzwischen geändert worden/);
  assert.equal(m.calls.filter((c) => c.method === "PATCH").length, 2);
  // Bearbeiten eines inzwischen gelöschten Gegenstands
  D.userClick(m.q("button.bring-edit"));   // Bibel
  srv.s.items = srv.s.items.filter((x) => x.item !== "Bibel"); srv.s.rev++;
  m.q("#bring-note").value = "Neu."; D.fire(m.q("#bring-form"), "submit"); await D.sleep(15);
  assert.equal(m.q(".save-state").textContent, "„Bibel“ wurde inzwischen an anderer Stelle gelöscht – Ihre Änderung ist nicht gespeichert.");
  assert.deepEqual(m.items(), ["Beutel", "Kerze"]);
  // von außen während der Bearbeitung: erst nach dem Schließen
  D.userClick(m.q("#bring-add")); m.q("#bring-item").value = "Tuch";
  m.card.update({ bring: [{ item: "Beutel", note: "" }], bringRev: 99 });
  assert.equal(m.q("#bring-item").value, "Tuch"); assert.deepEqual(m.items(), ["Beutel", "Kerze"]);
  D.userClick([...m.card.el.querySelectorAll("button")].find((b) => b.textContent === "Abbrechen")); await D.sleep(5);
  [...document.querySelector(".modal").querySelectorAll("button")].find((b) => b.textContent === "Verwerfen").click(); await D.sleep(5);
  assert.deepEqual(m.items(), ["Beutel"]);
  m.card.update({ bring: [{ item: "Beutel", note: "" }, { item: "Seil", note: "" }], bringRev: 100 });
  assert.deepEqual(m.items(), ["Beutel", "Seil"]); assert.equal(m.q(".save-state").textContent, "Aktualisiert");
  // höchstens 10: „Gegenstand hinzufügen“ gesperrt (bleibt fokussierbar) mit Hinweis
  const ten = Array.from({ length: 10 }, (_, i) => ({ item: "G" + i, note: "" }));
  const f = mount({ bring: ten, bringRev: 3 }, [server(ten, 3).route]);
  const add = f.q("#bring-add");
  assert.equal(add.getAttribute("aria-disabled"), "true");
  D.userClick(add);
  assert.ok(!f.visible(f.q("#bring-form")) && f.q("#bring-full").textContent === BC.BRING_FULL && document.activeElement === add);
});

/* ---------- Prüfbefunde (16.11.2026) ---------- */
test("Prüfbefund: Abkürzung vor einer Nummer („1. Sam. 17“, „Aufg. 3“) beendet keinen Satz – solche Hinweise wurden als drei Sätze abgewiesen", () => {
  const n = B.sentenceCount;
  assert.equal(n("Zum Vorlesen von 1. Sam. 17 in Phase 2 im Kurs Religion 2ab. Danach im Sitzkreis herumgeben."), 2);
  assert.equal(n("Für Aufg. 3 in der 9D. Danach einsammeln."), 2);
  assert.equal(n("Kap. 2 und Abb. 4 im Einstieg der 8B. Röm. 8 lesen."), 2);
  assert.equal(n("Klasse 8B. 5 Kinder lesen vor. Ende."), 3, "nach einem Wort mit Ziffer endet der Satz weiter");
  assert.equal(n("Im Einstieg am 10.11.2026. 3 Kinder lesen vor."), 2, "Datum vor einer Zahl: Satzende");
  assert.equal(n("Im Einstieg. 2 Exemplare reichen. Für die 9D."), 2, "im Zweifel zu wenig (ein Satz beginnt selten mit einer Ziffer)");
  assert.deepEqual(B.validateBring([{ item: "Kinderbibel", note: "Zum Vorlesen von 1. Sam. 17 in Phase 2 im Kurs Religion 2ab. Danach im Sitzkreis herumgeben." }]).length, 1);
  assert.equal(B.firstSentences("Für Aufg. 3 in der 9D. Danach einsammeln. Dritter Satz.", 2), "Für Aufg. 3 in der 9D. Danach einsammeln.");
});

test("Prüfbefund: Löschen in der Mitte der Liste – der Fokus geht an den nächsten Gegenstand (nicht an „Gegenstand hinzufügen“); misslungen: zurück auf den Papierkorb", async () => {
  const start = [{ item: "Wahlurne", note: "" }, { item: "Beutel", note: "" }, { item: "Lautsprecher", note: "" }];
  const srv = server(start, 1);
  const m = mount({ bring: start, bringRev: 1 }, [srv.route]);
  const del = (name) => [...m.card.el.querySelectorAll("button.bring-del")].find((b) => b.getAttribute("aria-label") === "„" + name + "“ löschen");
  const yes = async () => { [...document.querySelector(".modal").querySelectorAll("button")].find((b) => b.textContent === "Löschen").click(); await D.sleep(15); };
  D.userClick(del("Beutel")); await D.sleep(5); await yes();
  assert.deepEqual(m.items(), ["Wahlurne", "Lautsprecher"]);
  assert.equal(document.activeElement.getAttribute("aria-label"), "„Lautsprecher“ bearbeiten", "nächster Gegenstand");
  D.userClick(del("Lautsprecher")); await D.sleep(5); await yes();
  assert.equal(document.activeElement.getAttribute("aria-label"), "„Wahlurne“ bearbeiten", "letzter gelöscht: der vorige");
  // Server lehnt ab: der Gegenstand bleibt, Fokus zurück auf seinen Papierkorb
  m.calls.length = 0;
  globalThis.__tapi = async () => { throw new ApiError("Keine Verbindung.", 0, { code: "network" }); };
  D.userClick(del("Wahlurne")); await D.sleep(5); await yes();
  assert.deepEqual(m.items(), ["Wahlurne"]);
  assert.equal(document.activeElement.getAttribute("aria-label"), "„Wahlurne“ löschen");
  assert.equal(m.q(".save-state").textContent, "Keine Verbindung.");
});

test("Prüfbefund: Gymnasium mit aktiver Krankheitsvertretung – die Lehrkraft kommt nicht, ihre Gegenstände stehen nicht im roten Kasten (dieselbe Anweisung)", async () => {
  const c = await base();
  const a = await L.createLesson(c.db, { subject: "evrel", klass: "8-K", title: "Schöpfung", date: "2026-11-18", startTime: "07:50" }, c.now);
  const b = await L.createLesson(c.db, { subject: "powi", klass: "9D", title: "Wahlen", date: "2026-11-18", startTime: "09:40" }, c.now);
  for (const id of [a.id, b.id]) await call(c, L.routeLessonPatch, "PATCH", "/x", { bring: [{ item: "Bibel", note: "" }] }, id);
  c.db.raw.prepare("INSERT INTO substitutes(lesson_id, status, proposal, created_at, updated_at) VALUES(?, 'aktiv', '{}', ?, ?)").run(a.id, c.now, c.now);
  c.db.raw.prepare("INSERT INTO substitutes(lesson_id, status, proposal, created_at, updated_at) VALUES(?, 'vorschlag', '{}', ?, ?)").run(b.id, c.now, c.now);
  c.db.counter.n = 0;
  const r = await call(c, routePrintNext, "GET", "/api/teacher/print-next");
  assert.ok(c.db.counter.n <= 8, "D1-Anweisungen: " + c.db.counter.n);
  assert.deepEqual(r.data.sessions.map((s) => [s.title, (s.bring || []).map((x) => x.item), "sub" in s]), [["Schöpfung", [], false], ["Wahlen", ["Bibel"], false]],
    "aktive Vertretung: keine Gegenstände; nur ein Vorschlag: wie bisher");
});
