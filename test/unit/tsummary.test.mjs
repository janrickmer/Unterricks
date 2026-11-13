// Nachtrag 21 (13.11.2026): „Zusammenfassung der Sitzung für die Lehrkraft“ – Kopfzeile automatisch aus den aktuellen Sitzungsdaten, Text von Claude
// (update_lesson, zusammenfassung_lehrkraft) oder der Lehrkraft, ganz oben in der Sitzung; nie für Schüler:innen, Eltern, Beamer oder Live.
// Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/lk/s/x" });
const S = await import("../../public/shared.js");
const P = await import("../../public/planning.js");
const G = await import("../../public/gsplanning.js");
const SF = await import("../../public/sessionfile.js");
const { ApiError } = await import("../../public/ui.js");
const TS = await import("../../public/tsummary.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const L = await import("../../worker/lessons.js");
const ST = await import("../../worker/student.js");
const PA = await import("../../worker/parents.js");
const GS = await import("../../worker/gs.js");
const U = await import("../../worker/units.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");

const STOP = S.STOP_LINE;
const TEXT = "Zu Beginn zeigt die Lehrkraft eine Karikatur und fragt, wer im Bild die Macht hat (etwa 10 Minuten, Plenum).\n\n" +
  "Danach lesen die Schüler:innen in Partnerarbeit den Text M1 und ordnen die drei Gewalten zu.\nDas Ergebnis wird an der Tafel gesichert.";

/* ---------- Kopfzeile und Fingerabdruck (public/shared.js) ---------- */
test("Kopfzeile: Fach · Jahrgang · Wochentag, Datum, Beginn – alle Lerngruppenarten, Grundschule, ohne Uhrzeit, ohne Termin", () => {
  const at = (klass, subject = "powi", date = "2026-11-17", startTime = "08:00") => S.summaryHead({ subject, klass, date, startTime });
  assert.equal(at("8B"), "Politik und Wirtschaft · Jahrgang 8 (Klasse 8b) · Dienstag, 17.11.2026, 8:00 Uhr");
  assert.equal(at("10H", "ethik"), "Ethik · Jahrgang 10 (Klasse 10h) · Dienstag, 17.11.2026, 8:00 Uhr");
  assert.equal(at("8-K", "evrel"), "Evangelische Religion · Jahrgang 8 (Kurs 8-K) · Dienstag, 17.11.2026, 8:00 Uhr");
  assert.equal(at("E-K", "ethik"), "Ethik · E-Phase (Kurs E-K) · Dienstag, 17.11.2026, 8:00 Uhr");
  assert.equal(at("EA"), "Politik und Wirtschaft · E-Phase (EA) · Dienstag, 17.11.2026, 8:00 Uhr");
  assert.equal(at("Q3-LK"), "Politik und Wirtschaft · Q3 Leistungskurs · Dienstag, 17.11.2026, 8:00 Uhr");
  assert.equal(at("Q2-GK", "powi", "2026-11-19", "13:35"), "Politik und Wirtschaft · Q2 Grundkurs · Donnerstag, 19.11.2026, 13:35 Uhr");
  assert.equal(at("8B", "powi", "2026-11-17", null), "Politik und Wirtschaft · Jahrgang 8 (Klasse 8b) · Dienstag, 17.11.2026, Beginn noch nicht eingetragen");
  const gs = { subjectName: "Religion", grade: 2, classes: ["a", "b"] }, gs1 = { subjectName: "Sachunterricht", grade: 3, classes: ["c"] };
  assert.equal(S.summaryHead({ subject: "gs", klass: "gs12345678", date: "2026-11-16", startTime: "09:50" }, gs), "Religion · Jahrgang 2 (Klassen 2a, 2b) · Montag, 16.11.2026, 9:50 Uhr");
  assert.equal(S.summaryHead({ subject: "gs", klass: "gs12345678", date: "2026-11-20", startTime: "07:45" }, gs1), "Sachunterricht · Jahrgang 3 (Klasse 3c) · Freitag, 20.11.2026, 7:45 Uhr");
  assert.equal(S.summaryHead({ subject: "gs", klass: "gs12345678", date: null }, gs), "Religion · Jahrgang 2 (Klassen 2a, 2b) · Termin noch nicht eingetragen");
});

test("Fingerabdruck der Planung: Zwischenstopp und Leerraum zählen nicht, jede andere Änderung schon; summaryOutdated nur mit Text und Fingerabdruck", () => {
  const plan = "**1) Einstieg**\n- Karikatur\n**2) Partnerarbeit**\n- ~~M1~~ lesen";
  const fp = S.planFingerprint(plan);
  assert.match(fp, /^p1:[0-9a-f]{8}$/);
  assert.equal(S.planFingerprint(S.insertStop(plan, 2).text), fp, "ein Zwischenstopp ändert die Planung nicht");
  assert.equal(S.planFingerprint("  **1) Einstieg**\n\n- Karikatur  \n**2) Partnerarbeit**\n- ~~M1~~ lesen\n"), fp);
  assert.notEqual(S.planFingerprint(plan.replace("Karikatur", "Bild")), fp);
  assert.equal(S.summaryOutdated(TEXT, fp, plan + "\n" + STOP), false);
  assert.equal(S.summaryOutdated(TEXT, fp, plan + "\n- Hausaufgabe"), true);
  assert.equal(S.summaryOutdated("", fp, "anders"), false, "ohne Zusammenfassung kein Hinweis");
  assert.equal(S.summaryOutdated(TEXT, null, "anders"), false, "ohne Fingerabdruck kein Hinweis");
  assert.equal(S.fmtStampBerlin(Date.parse("2026-11-13T13:05:00Z")), "13.11.2026, 14:05 Uhr");
});

/* ---------- Prompts ---------- */
test("Prompts: „Stunde mit Claude planen“ (Gymnasium, Jg. 5/6, Grundschule) mit letztem Speicherschritt und Rückfall; Überarbeitung nach Ausfällen; nicht Vertretung und Präsentation", () => {
  const sek = { lessonId: "a".repeat(16), subject: "powi", klass: "8B", lesson: { title: "Gewaltenteilung", topic: "Gewaltenteilung", durationMin: 45, date: "2026-11-17", startTime: "08:00" }, materials: [], sheets: [], messages: [] };
  for (const [p, gs, analog] of [[P.claudeLessonPrompt(sek), false, false], [P.claudeLessonPrompt({ ...sek, klass: "6B" }), false, true],
    [G.claudeGsLessonPrompt({ lessonId: "b".repeat(16), subject: "gs", klass: "gs12345678", course: { short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)", subjectName: "Religion", grade: 2, classes: ["a", "b"] }, lesson: { title: "Josef", durationMin: 45 }, materials: [] }), true]]) {
    const step = S.summarySaveStep(gs, analog);
    assert.equal(p.split(step).length - 1, 1);
    // Feibeitsblatt mit Code nur dort, wo es Feibeitsblätter gibt (nicht in Jg. 5/6 und nicht in der Grundschule)
    assert.equal(step.includes("(ein Feibeitsblatt mit seinem Code)"), !gs && !analog);
    assert.ok(p.indexOf(step) < p.indexOf("Sage mir zum Schluss kurz"), "letzter Speicherschritt vor dem Schluss");
    for (const s of ["`update_lesson` mit `zusammenfassung_lehrkraft`", "`update_lesson` und `zusammenfassung_lehrkraft`"].filter((x) => step.includes(x))) assert.ok(p.includes(s));
    assert.ok(step.includes(S.TEACHER_SUMMARY_TITLE) && step.includes("etwa 120 bis 300 Wörter") && step.includes("wiederhole sie nicht") && step.includes("nach einem Zwischenstopp"));
    assert.ok(step.includes(gs ? "Nenne nie Namen von Kindern." : "Nenne nie Namen von Schüler:innen."));
    assert.ok(p.includes("zum Kopieren aus" + S.SUMMARY_FALLBACK + "."), "Rückfall ohne Connector: Zusammenfassung zum Kopieren");
  }
  const rev = G.claudeUnitRevisionPrompt({ unit: { id: "u".repeat(16), rows: [], plan: {}, params: {}, revise: { items: [] }, lessons: [] }, now: Date.parse("2026-11-02T10:00:00Z") });
  assert.ok(rev.includes("`update_lesson` mit `inhalt_eltern` und – für mich – `zusammenfassung_lehrkraft`"));
  const sub = P.claudeSubstitutePrompt({ ...sek, row: null }), pres = S.claudePresentationPrompt(sek, "**1) Einstieg**", []);
  for (const p of [sub, pres]) assert.ok(!p.includes("zusammenfassung_lehrkraft") && !p.includes(S.TEACHER_SUMMARY_TITLE));
});

/* ---------- Worker, Connector ---------- */
const TOKEN = "lehrkraft-token-123", STOKEN = "schueler-token-123", DEV = "dddddddddddddddd", NOW = Date.parse("2026-11-12T10:00:00Z");
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
async function base() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = NOW;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  return c;
}
const row = (c, id) => ({ ...c.db.raw.prepare("SELECT teacher_summary AS t, teacher_summary_at AS at, teacher_summary_plan AS fp FROM lessons WHERE id=?").get(id) });

test("Connector: Werkzeugschema, Beschreibungen und Anweisungen nennen die Zusammenfassung", async () => {
  const c = await base();
  const tools = (await mcp(c, "tools/list", {})).tools, by = (n) => tools.find((t) => t.name === n);
  const p = by("update_lesson").inputSchema.properties.zusammenfassung_lehrkraft;
  assert.deepEqual([p.type, p.maxLength], ["string", 4000]);
  for (const s of [S.TEACHER_SUMMARY_TITLE, "nie für Schüler:innen oder Eltern sichtbar", "ungefähren Minuten und Sozialformen", "was die Lehrkraft jeweils tut und sagt", "Materialien mit ihrem Titel",
    "(ein Feibeitsblatt mit seinem Code)", "erwarteten Ergebnisse, die Hausaufgabe und mögliche Stolperstellen", "kein Markdown, keine Schulportal-Zeichen, keine Tabellen", "etwa 120 bis 300 Wörter",
    "Fach, Jahrgang, Wochentag und Beginn setzt Unterricks automatisch darüber", "Nenne nie Namen von Schüler:innen bzw. Kindern.", "Leer = löschen."]) assert.ok(p.description.includes(s), s);
  assert.ok(by("update_lesson").description.includes("immer, wenn du Unterrichtsinhalte der Sitzung ablegst, als letzten Speicherschritt"));
  for (const n of ["save_schulportal_entry", "save_verlaufsplan"]) assert.ok(by(n).description.includes("Schreibe danach auch die „" + S.TEACHER_SUMMARY_TITLE + "“ mit update_lesson (zusammenfassung_lehrkraft)"), n);
  const init = await mcp(c, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.ok(init.instructions.includes("Legst du Unterrichtsinhalte einer Sitzung ab (nach Freigabe der Lehrkraft), schreibe immer auch die „" + S.TEACHER_SUMMARY_TITLE + "“ mit update_lesson (zusammenfassung_lehrkraft) – " +
    "auch, wenn du die Planung später überarbeitest (z. B. nach einem Zwischenstopp); das gilt am Gymnasium und in der Grundschule."));
});

test("Gymnasium: update_lesson speichert (Zeitpunkt, Fingerabdruck), meldet Kopfzeile und Form, leer löscht, zu lang abgelehnt; get_lesson-Abschnitt mit Hinweisen", async () => {
  const c = await base();
  const l = await L.createLesson(c.db, { subject: "powi", klass: "8B", title: "Gewaltenteilung", date: "2026-11-17", startTime: "08:00", durationMin: 45 }, c.now);
  let g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes("\n## " + S.TEACHER_SUMMARY_TITLE + "\nKopfzeile (setzt Unterricks automatisch aus den aktuellen Sitzungsdaten): Politik und Wirtschaft · Jahrgang 8 (Klasse 8b) · Dienstag, 17.11.2026, 8:00 Uhr\n" +
    "(noch leer – schreibe sie mit update_lesson und zusammenfassung_lehrkraft)\n"));
  assert.ok(g.text.indexOf("## " + S.TEACHER_SUMMARY_TITLE) > g.text.indexOf("## Schulportal-Eintrag") && g.text.indexOf("## " + S.TEACHER_SUMMARY_TITLE) < g.text.indexOf("## Planungsverlauf"));
  await L.savePortal(c.db, l.id, "**1) Einstieg**\n- Karikatur\n**2) Partnerarbeit**\n- ~~M1~~ lesen", null, "claude", c.now);
  let r = await tool(c, "update_lesson", { lesson_id: l.id, hausaufgabe: "Lies M2.", zusammenfassung_lehrkraft: "  " + TEXT + "  " });
  assert.ok(!r.isError);
  assert.equal(r.text, "Gespeichert. " + S.TEACHER_SUMMARY_TITLE + " gespeichert (" + TEXT.split(/\s+/).length + " Wörter, beginnt mit „Zu Beginn zeigt die Lehrkraft eine Karikatur und fragt, wer im Bild die Macht …“). " +
    "Unterricks setzt darüber automatisch: „Politik und Wirtschaft · Jahrgang 8 (Klasse 8b) · Dienstag, 17.11.2026, 8:00 Uhr“.");
  assert.deepEqual(row(c, l.id), { t: TEXT, at: NOW, fp: S.planFingerprint("**1) Einstieg**\n- Karikatur\n**2) Partnerarbeit**\n- ~~M1~~ lesen") });
  assert.equal(r.data.lesson.teacherSummary, TEXT);
  g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes("Dienstag, 17.11.2026, 8:00 Uhr\n" + TEXT + "\n(Stand: 12.11.2026, 11:00 Uhr)\n"));
  assert.ok(!g.text.includes("wurde danach geändert"));
  // Zwischenstopp: kein Hinweis; geänderter Eintrag: Hinweis an Claude
  await L.savePortal(c.db, l.id, "**1) Einstieg**\n- Karikatur\n" + STOP + "\n**2) Partnerarbeit**\n- ~~M1~~ lesen", null, "lehrkraft", c.now);
  assert.ok(!(await tool(c, "get_lesson", { lesson_id: l.id })).text.includes("wurde danach geändert"));
  await L.savePortal(c.db, l.id, "**1) Einstieg**\n- Karikatur\n**2) Diskussion**", null, "lehrkraft", c.now);
  assert.ok((await tool(c, "get_lesson", { lesson_id: l.id })).text.includes("Achtung: Der Schulportal-Eintrag wurde danach geändert – passe die Zusammenfassung mit update_lesson (zusammenfassung_lehrkraft) an, wenn du die Planung überarbeitest."));
  // bestätigte Vertretung: Hinweis statt „danach geändert“
  c.db.raw.prepare("INSERT INTO substitutes(lesson_id, status, proposal, archive, created_at, updated_at) VALUES(?, 'aktiv', '{}', '{}', ?, ?)").run(l.id, c.now, c.now);
  g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes("Für diese Sitzung gilt die bestätigte Vertretungsstunde – die Zusammenfassung beschreibt die ursprüngliche Planung.") && !g.text.includes("wurde danach geändert"));
  c.db.raw.prepare("DELETE FROM substitutes").run();
  // Form: Markdown und Länge
  r = await tool(c, "update_lesson", { lesson_id: l.id, zusammenfassung_lehrkraft: "**Einstieg**\n- Karikatur (10 min)\n- Partnerarbeit" });
  assert.ok(!r.isError && r.text.includes("Achtung: Die Zusammenfassung erscheint als schlichter Text – schreibe sie ohne Markdown, Schulportal-Zeichen, Aufzählungszeichen und Tabellen."));
  r = await tool(c, "update_lesson", { lesson_id: l.id, zusammenfassung_lehrkraft: "Wort ".repeat(450) });
  assert.ok(r.text.includes("Sie ist länger als vorgesehen (etwa 120 bis 300 Wörter) – kürze sie, wenn möglich."));
  r = await tool(c, "update_lesson", { lesson_id: l.id, zusammenfassung_lehrkraft: "x".repeat(4001) });
  assert.deepEqual([r.isError, r.text], [true, "Die Zusammenfassung der Sitzung für die Lehrkraft ist zu lang (4001 Zeichen, höchstens 4000) – bitte kürzen."]);
  assert.equal(row(c, l.id).t, "Wort ".repeat(450).trim(), "zu lang: nichts geändert");
  // leer = löschen
  r = await tool(c, "update_lesson", { lesson_id: l.id, zusammenfassung_lehrkraft: "   " });
  assert.deepEqual([r.isError, r.text], [false, "Gespeichert. " + S.TEACHER_SUMMARY_TITLE + " gelöscht."]);
  assert.deepEqual(row(c, l.id), { t: "", at: null, fp: null });
  // andere Felder ohne zusammenfassung_lehrkraft: Text bleibt, Rückmeldung wie bisher
  await tool(c, "update_lesson", { lesson_id: l.id, zusammenfassung_lehrkraft: TEXT });
  r = await tool(c, "update_lesson", { lesson_id: l.id, thema: "Gewaltenteilung im GG" });
  assert.deepEqual([r.text, row(c, l.id).t], ["Gespeichert.", TEXT]);
  // Verschieben: die Kopfzeile folgt (sie wird nie gespeichert)
  await tool(c, "update_lesson", { lesson_id: l.id, datum: "2026-11-19", beginn: "13:35" });
  assert.ok((await tool(c, "get_lesson", { lesson_id: l.id })).text.includes("Kopfzeile (setzt Unterricks automatisch aus den aktuellen Sitzungsdaten): Politik und Wirtschaft · Jahrgang 8 (Klasse 8b) · Donnerstag, 19.11.2026, 13:35 Uhr"));
  assert.ok(!row(c, l.id).t.includes("Donnerstag"));
});

test("Grundschule: update_lesson mit Kopfzeile des Kurses, get_lesson-Abschnitt vor dem Inhalt für die Eltern; Ausfall-Eintrag ohne Abschnitt und abgelehnt", async () => {
  const c = await base();
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/x", { grade: 2, classes: ["a", "b"], religion: true, weekdays: [{ day: 1, minutes: 45, time: "09:50" }], classSize: 22 })).data.course;
  const l = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Josef", date: "2026-11-16", startTime: "09:50", durationMin: 45 }, c.now);
  let g = await tool(c, "get_lesson", { lesson_id: l.id });
  const head = "Religion · Jahrgang 2 (Klassen 2a, 2b) · Montag, 16.11.2026, 9:50 Uhr";
  assert.ok(g.text.includes("## " + S.TEACHER_SUMMARY_TITLE + "\nKopfzeile (setzt Unterricks automatisch aus den aktuellen Sitzungsdaten): " + head + "\n(noch leer – schreibe sie mit update_lesson und zusammenfassung_lehrkraft)"));
  assert.ok(g.text.indexOf("## " + S.TEACHER_SUMMARY_TITLE) < g.text.indexOf("## Inhalt der Unterrichtsstunde (für die Eltern)"));
  const t = "Im Sitzkreis erzählt die Lehrkraft mit Bildkarten, wie Josef nach Ägypten kommt. Danach malen die Kinder ihre Lieblingsszene.";
  const r = await tool(c, "update_lesson", { lesson_id: l.id, zusammenfassung_lehrkraft: t, inhalt_eltern: "Wir haben gehört, wie Josef nach Ägypten kam." });
  assert.ok(!r.isError && r.text.endsWith("Unterricks setzt darüber automatisch: „" + head + "“."), r.text);
  await L.savePortal(c.db, l.id, "**1) Sitzkreis** (10 Min.)\n- Erzählung", null, "claude", c.now);
  g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes(head + "\n" + t + "\n(Stand: 12.11.2026, 11:00 Uhr)\nAchtung: Der Verlaufsplan wurde danach geändert"));
  // Ausfall-Eintrag: weder Abschnitt noch Speichern
  c.db.raw.prepare("UPDATE lessons SET cancelled=1 WHERE id=?").run(l.id);
  g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(!g.text.includes(S.TEACHER_SUMMARY_TITLE));
  assert.equal((await tool(c, "update_lesson", { lesson_id: l.id, zusammenfassung_lehrkraft: "x" })).isError, true);
});

test("Sitzungsseite (PATCH): Zeitpunkt und Fingerabdruck, Rückfrage (409) bei inzwischen anders gespeicherter Fassung, „Meine Fassung“ ohne Stand; Liste der Sitzungen unverändert", async () => {
  const c = await base();
  const l = await L.createLesson(c.db, { subject: "evrel", klass: "8-K", title: "Psalmen", date: "2026-11-17", startTime: "08:00" }, c.now);
  await L.savePortal(c.db, l.id, "**1) Einstieg**", null, "lehrkraft", c.now);
  const patch = (body) => call(c, L.routeLessonPatch, "PATCH", "/api/teacher/lessons/" + l.id, body, l.id);
  let r = await patch({ teacherSummary: "Erste Fassung.", teacherSummaryBase: null });
  assert.deepEqual([r.status, r.data.lesson.teacherSummary, r.data.lesson.teacherSummaryAt, r.data.lesson.teacherSummaryPlan], [200, "Erste Fassung.", NOW, S.planFingerprint("**1) Einstieg**")]);
  // Claude speichert inzwischen eine neue Fassung → die Bearbeitung auf dem alten Stand bekommt 409 mit dem aktuellen Stand, nichts überschrieben
  c.now = NOW + 60e3;
  await tool(c, "update_lesson", { lesson_id: l.id, zusammenfassung_lehrkraft: "Fassung von Claude." });
  r = await patch({ teacherSummary: "Meine Fassung.", teacherSummaryBase: NOW });
  assert.deepEqual([r.status, r.data.code, r.data.current], [409, "summary_conflict", { text: "Fassung von Claude.", at: NOW + 60e3, plan: S.planFingerprint("**1) Einstieg**") }]);
  assert.equal(row(c, l.id).t, "Fassung von Claude.");
  r = await patch({ teacherSummary: "Meine Fassung.", teacherSummaryBase: NOW + 60e3 });
  assert.equal(r.status, 200);
  r = await patch({ teacherSummary: "Doch meine.", teacherSummaryBase: 1 });
  assert.equal(r.status, 409);
  r = await patch({ teacherSummary: "Doch meine." });
  assert.deepEqual([r.status, row(c, l.id).t], [200, "Doch meine."]);
  assert.equal((await patch({ teacherSummary: "x", teacherSummaryBase: "gestern" })).status, 400);
  assert.equal((await patch({ teacherSummary: "y".repeat(4001) })).status, 400);
  // GET liefert sie der Lehrkraft; die Liste der Sitzungen bleibt ohne (wie bisher)
  const d = await call(c, L.routeLessonGet, "GET", "/api/teacher/lessons/" + l.id, undefined, l.id);
  assert.equal(d.data.lesson.teacherSummary, "Doch meine.");
  const list = await call(c, L.routeLessonsList, "GET", "/api/teacher/lessons?subject=evrel&klass=8-K");
  assert.ok(!JSON.stringify(list.data).includes("Doch meine.") && !("teacherSummary" in list.data.lessons[0]));
});

test("Sitzung aus Datei laden: die Zusammenfassung kommt mit (Fingerabdruck des Eintrags aus der Datei), ohne Zusammenfassung in der Datei wird sie geleert", async () => {
  const c = await base();
  const l = await L.createLesson(c.db, { subject: "powi", klass: "9C", title: "Wahlen", date: "2026-11-17" }, c.now);
  await call(c, L.routeLessonPatch, "PATCH", "/x", { teacherSummary: "Alte Zusammenfassung." }, l.id);
  const file = SF.cleanSessionFile({ kind: SF.SESSION_FILE.kind, v: SF.SESSION_FILE.v, source: {}, lesson: { title: "Wahlrecht", portal: "**1) Wahlrecht**", teacherSummary: "Neue Zusammenfassung aus der Datei." } });
  assert.equal(file.lesson.teacherSummary, "Neue Zusammenfassung aus der Datei.");
  assert.equal(SF.cleanSessionFile({ kind: SF.SESSION_FILE.kind, v: SF.SESSION_FILE.v, source: {}, lesson: { teacherSummary: "z".repeat(5000) } }).lesson.teacherSummary.length, 4000);
  let r = await call(c, L.routeLessonImport, "POST", "/x", { lesson: file.lesson, chat: [] }, l.id);
  assert.equal(r.status, 200);
  assert.deepEqual(row(c, l.id), { t: "Neue Zusammenfassung aus der Datei.", at: NOW, fp: S.planFingerprint("**1) Wahlrecht**") });
  r = await call(c, L.routeLessonImport, "POST", "/x", { lesson: { ...file.lesson, teacherSummary: "" }, chat: [] }, l.id);
  assert.deepEqual(row(c, l.id), { t: "", at: null, fp: null });
});

test("Nie für Schüler:innen und Eltern: Code einlösen, Schüleransicht, Elternansicht und vorherige Sitzungen enthalten den Text nicht", async () => {
  const c = await base();
  const secret = "LEHRKRAFTGEHEIM Ablauf mit Stolperstellen";
  const day = new Date(c.now - 2 * 864e5).toISOString().slice(0, 10);
  const l = await L.createLesson(c.db, { subject: "powi", klass: "Q2-GK", title: "Gewaltenteilung", date: day, startTime: "08:00", durationMin: 90 }, c.now - 864e5);
  await call(c, L.routeLessonPatch, "PATCH", "/x", { teacherSummary: secret, homework: "Lies M3." }, l.id);
  c.db.raw.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, 'Q2-GK', 'powi', ?, ?, ?)").run(DEV, await sha256Hex(STOKEN), c.now, c.now, c.now + 3600e3);
  const join = await scall(c, ST.routeStudentJoin, "POST", "/api/student/join", { code: l.code });
  assert.equal(join.status, 200);
  const sv = await scall(c, ST.routeStudentLesson, "GET", "/api/student/lessons/" + l.id, undefined, l.id);
  assert.equal(sv.status, 200);
  for (const x of [join.data, sv.data]) assert.ok(!JSON.stringify(x).includes("LEHRKRAFTGEHEIM") && !JSON.stringify(x).includes("teacherSummary"));
  assert.equal(sv.data.homework.text, "Lies M3.", "die Schüleransicht selbst funktioniert");
  // Grundschule: Elternansicht (nach dem Ende), Liste der vorherigen Sitzungen
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/x", { grade: 2, classes: ["a"], religion: true, weekdays: [{ day: 2, minutes: 45, time: "08:00" }] })).data.course;
  const gl = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Josef", date: day, startTime: "08:00", durationMin: 45 }, c.now - 864e5);
  await call(c, L.routeLessonPatch, "PATCH", "/x", { teacherSummary: secret, parentSummary: "Wir haben von Josef gehört." }, gl.id);
  const tok = (await call(c, PA.routeTeacherParentLink, "POST", "/x", {}, gl.id)).data.token;
  const pv = await pub(c, PA.routeParentLesson, "POST", "/api/eltern/x", { token: tok });
  const pp = await pub(c, PA.routeParentPrevious, "POST", "/api/eltern/x", { token: tok });
  assert.deepEqual([pv.status, pv.data.summary], [200, "Wir haben von Josef gehört."]);
  assert.equal(pp.status, 200);
  for (const x of [pv.data, pp.data]) assert.ok(!JSON.stringify(x).includes("LEHRKRAFTGEHEIM"));
  // eine Sitzung mit Zusammenfassung ist nicht „leer“ (darf beim Überarbeiten der Einheit nicht wegfallen)
  const u = (await call(c, U.routeUnitCreate, "POST", "/x", { subject: "gs", klass: course.id, title: "Josef", params: { start: day, end: day, weekdays: [{ day: 2, minutes: 45, time: "08:00" }] } })).data.unit;
  const empty = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Leer", date: day, unitId: u.id, unitRow: "aaaaaaaa" }, c.now);
  c.db.raw.prepare("DELETE FROM chat WHERE lesson_id=?").run(empty.id);
  assert.equal((await U.linkedLessons(c.db, u.id, true))[0].hasContent, false);
  await call(c, L.routeLessonPatch, "PATCH", "/x", { teacherSummary: "Nur die Zusammenfassung." }, empty.id);
  assert.equal((await U.linkedLessons(c.db, u.id, true))[0].hasContent, true);
});

/* ---------- Oberfläche (public/tsummary.js) im Browser-Ersatz ---------- */
function mount({ lesson = {}, course = null, plan = "**1) Einstieg**", sub = false, routes = [] } = {}) {
  const calls = [];
  globalThis.__tapi = async (method, path, o = {}) => {
    calls.push({ method, path, body: o.body });
    for (const [re, fn] of routes) { const m = re.exec(method + " " + path); if (m) return fn(m, o.body || {}); }
    throw new ApiError("nicht nachgebildet: " + method + " " + path, 404, { code: "not_found" });
  };
  const st = { lesson: { id: "l1", subject: "powi", klass: "8B", date: "2026-11-17", startTime: "08:00", portal: plan, teacherSummary: "", teacherSummaryAt: null, teacherSummaryPlan: null, ...lesson } };
  const state = { plan, sub };
  const card = TS.summaryCard({ id: "l1", L: () => st.lesson, course, planText: () => state.plan, substituteActive: () => state.sub });
  const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove(); app.append(card.el);
  const $ = (s) => document.querySelector(s), visible = (el) => !!el && !el.classList.contains("hidden");
  const btn = (t) => [...card.el.querySelectorAll("button")].find((b) => b.textContent === t && visible(b));
  return { card, st, state, calls, $, visible, btn };
}

test("Karte: Überschrift (h2), Kopfzeile aus den aktuellen Daten, Absätze nur als Text, Stand, leer mit Hinweis; Hinweis bei geänderter Planung bzw. Vertretung", async () => {
  const m = mount({ lesson: { teacherSummary: "Absatz eins <b>nicht fett</b>\nmit Zeilenumbruch.\n\n\nAbsatz zwei.", teacherSummaryAt: Date.parse("2026-11-13T13:05:00Z"), teacherSummaryPlan: S.planFingerprint("**1) Einstieg**") } });
  assert.equal(m.$("#tsum-h").tagName, "H2");
  assert.equal(m.$("#tsum-h").textContent, "Zusammenfassung der Sitzung für die Lehrkraft");
  assert.equal(m.card.el.getAttribute("aria-labelledby"), "tsum-h");
  assert.equal(m.$("#tsum-head").textContent, "Politik und Wirtschaft · Jahrgang 8 (Klasse 8b) · Dienstag, 17.11.2026, 8:00 Uhr");
  assert.deepEqual([...m.$("#tsum-text").querySelectorAll("p")].map((p) => p.textContent), ["Absatz eins <b>nicht fett</b>\nmit Zeilenumbruch.", "Absatz zwei."]);
  assert.equal(m.$("#tsum-text").querySelectorAll("b").length, 0);
  assert.equal(m.card.el.querySelector(".tsum-meta").textContent, "Stand: 13.11.2026, 14:05 Uhr");
  assert.ok(!m.visible(m.card.el.querySelector(".tsum-note")));
  // verschoben: die Kopfzeile folgt
  Object.assign(m.st.lesson, { date: "2026-11-19", startTime: null }); m.card.paintHead();
  assert.equal(m.$("#tsum-head").textContent, "Politik und Wirtschaft · Jahrgang 8 (Klasse 8b) · Donnerstag, 19.11.2026, Beginn noch nicht eingetragen");
  // Planung geändert (auch ungespeichert) → Hinweis; Zwischenstopp → keiner; Vertretung → eigener Hinweis
  m.state.plan = "**1) Einstieg**\n" + STOP; m.card.paintNote();
  assert.ok(!m.visible(m.card.el.querySelector(".tsum-note")));
  m.state.plan = "**1) Einstieg**\n**2) Neu**"; m.card.paintNote();
  assert.ok(m.visible(m.card.el.querySelector(".tsum-note")) && m.card.el.querySelector(".tsum-note").textContent === TS.SUMMARY_STALE);
  assert.equal(TS.SUMMARY_STALE, "Die Planung wurde danach geändert – die Zusammenfassung ist vielleicht nicht mehr aktuell.");
  m.state.sub = true; m.card.paintNote();
  assert.equal(m.card.el.querySelector(".tsum-note").textContent, TS.SUMMARY_SUBSTITUTE);
  // leer
  const e = mount({ course: { subjectName: "Religion", grade: 2, classes: ["a", "b"] }, lesson: { subject: "gs", klass: "gs12345678", date: "2026-11-16", startTime: "09:50" } });
  assert.equal(e.$("#tsum-head").textContent, "Religion · Jahrgang 2 (Klassen 2a, 2b) · Montag, 16.11.2026, 9:50 Uhr");
  assert.ok(e.visible(e.card.el.querySelector(".tsum-empty")) && !e.visible(e.$("#tsum-text")) && !e.visible(e.card.el.querySelector(".tsum-meta")));
  assert.equal(e.card.el.querySelector(".tsum-empty").textContent, "Noch keine Zusammenfassung. Claude schreibt sie, wenn Sie die Planung im Chat ablegen lassen – oder Sie tragen sie selbst ein.");
});

test("Karte: Bearbeiten → Textfeld mit Fokus, Speichern mit Stand, Fokus zurück; Abbrechen fragt nur bei Änderungen; 409 → Rückfrage, „Meine Fassung speichern“ ohne Stand", async () => {
  let saved = null, conflictOnce = true;
  const m = mount({ lesson: { teacherSummary: "Alt.", teacherSummaryAt: 1000, teacherSummaryPlan: S.planFingerprint("**1) Einstieg**") }, routes: [[/^PATCH \/api\/teacher\/lessons\/l1$/, (_, b) => {
    if (b.teacherSummaryBase !== undefined && conflictOnce) { conflictOnce = false; throw new ApiError("Die Zusammenfassung der Sitzung für die Lehrkraft wurde inzwischen an anderer Stelle geändert.", 409, { code: "summary_conflict", current: { text: "Von Claude.", at: 2000, plan: "p1:00000000" } }); }
    saved = b; return { ok: true, lesson: { teacherSummary: String(b.teacherSummary).trim(), teacherSummaryAt: 3000, teacherSummaryPlan: S.planFingerprint("**1) Einstieg**") } };
  }]] });
  const edit = m.$("#tsum-edit-btn");
  D.userClick(edit);
  assert.ok(m.visible(m.$("#tsum-edit")) && !m.visible(edit) && document.activeElement === m.$("#tsum-ta"));
  assert.equal(m.$("#tsum-ta").value, "Alt.");
  assert.equal(m.$("#tsum-count").textContent, "4 von 4.000 Zeichen");
  // ohne Änderung abbrechen: keine Rückfrage, Fokus zurück auf „Bearbeiten“
  D.userClick(m.btn("Abbrechen"));
  await D.sleep(5);
  assert.ok(!document.querySelector(".modal") && !m.visible(m.$("#tsum-edit")) && document.activeElement === edit);
  // ändern und speichern → 409 → Rückfrage mit beiden Fassungen
  D.userClick(edit);
  m.$("#tsum-ta").value = "Neu von mir."; D.fire(m.$("#tsum-ta"), "input");
  D.userClick(m.btn("Speichern"));
  await D.sleep(10);
  const modal = document.querySelector(".modal");
  assert.ok(modal && modal.textContent.includes("Die Zusammenfassung wurde inzwischen geändert") && modal.textContent.includes("Neu von mir.") && modal.textContent.includes("Von Claude."));
  assert.equal(m.calls.filter((x) => x.method === "PATCH")[0].body.teacherSummaryBase, 1000);
  [...modal.querySelectorAll("button")].find((b) => b.textContent === "Meine Fassung speichern").click();
  await D.sleep(10);
  assert.deepEqual(saved, { teacherSummary: "Neu von mir." }, "ohne Stand: überschreibt bewusst");
  assert.ok(!m.visible(m.$("#tsum-edit")));
  assert.deepEqual([...m.$("#tsum-text").querySelectorAll("p")].map((p) => p.textContent), ["Neu von mir."]);
  assert.equal(m.st.lesson.teacherSummaryAt, 3000);
  assert.equal(m.card.el.querySelector(".save-state").textContent, "Gespeichert");
  assert.equal(document.activeElement, edit, "Fokus nach dem Speichern auf „Bearbeiten“ (nicht body)");
  // mit Änderung abbrechen: Rückfrage; „Abbrechen“ im Dialog lässt das Feld offen
  D.userClick(edit);
  m.$("#tsum-ta").value = "Entwurf"; D.fire(m.$("#tsum-ta"), "input");
  assert.equal(m.card.dirty(), true);
  D.userClick(m.btn("Abbrechen"));
  await D.sleep(5);
  const q = document.querySelector(".modal");
  assert.ok(q && q.textContent.includes("Änderungen verwerfen?"));
  [...q.querySelectorAll("button")].find((b) => b.textContent === "Abbrechen").click();
  await D.sleep(5);
  assert.ok(m.visible(m.$("#tsum-edit")) && m.$("#tsum-ta").value === "Entwurf");
  // von außen (Claude) während der Bearbeitung: nie ins Feld – erst nach dem Schließen
  m.card.update({ teacherSummary: "Neu von Claude.", teacherSummaryAt: 4000, teacherSummaryPlan: null });
  assert.equal(m.$("#tsum-ta").value, "Entwurf");
  D.userClick(m.btn("Abbrechen")); await D.sleep(5);
  [...document.querySelector(".modal").querySelectorAll("button")].find((b) => b.textContent === "Verwerfen").click();
  await D.sleep(5);
  assert.deepEqual([...m.$("#tsum-text").querySelectorAll("p")].map((p) => p.textContent), ["Neu von Claude."]);
  // leeren und speichern = löschen
  D.userClick(edit);
  m.$("#tsum-ta").value = "  "; D.userClick(m.btn("Speichern"));
  await D.sleep(10);
  assert.ok(m.visible(m.card.el.querySelector(".tsum-empty")) && m.card.el.querySelector(".save-state").textContent === "Gelöscht");
});
