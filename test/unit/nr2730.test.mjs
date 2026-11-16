// Abschlussprüfung Nr. 27–30 (16.11.2026): Zusammenspiel der Selbstlern-Phase (Nachtrag 29) mit dem Zwischenstopp (Anforderung 13, Nachtrag 26),
// der Hausaufgabe bis zur nächsten Stunde mit der Lehrkraft und den Gegenständen zum Mitbringen (Nachtrag 28). Je Befund ein Test:
// 1) save_selbstlern speichert die Planung der Sitzung: mit einer Entscheidung zum Zwischenstopp der vorigen Stunde ist der Hinweis erledigt;
//    „Wiederherstellen“ setzt den Stand der ursprünglichen Planung zurück (der Hinweis gilt dann wieder)
// 2) der Selbstlern-Prompt fragt nach dem offenen Teil der vorigen Stunde (nur, wenn er noch nicht erledigt ist)
// 3) get_lesson der nächsten Stunde MIT der Lehrkraft nennt die Selbstlern-Phase(n) davor und ihre jetzt fällige Hausaufgabe
// 4) Karte „Mitbringen“ einer Selbstlern-Sitzung sagt, warum die Gegenstände nicht im roten Kasten der Startseite stehen (ebenso update_lesson)
// 5) get_lesson einer Selbstlern-Sitzung nennt die Hausaufgabe mit dem aktuellen Termin der nächsten Stunde mit der Lehrkraft
// 6) Sitzungsdatei einer Selbstlern-Sitzung: Hinweis, welche Fassung darin steht
// Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
installDom({ hash: "#/lk" });
const SL = await import("../../public/selbstlern.js");
const P = await import("../../public/planning.js");
const F = await import("./stop-fixtures.mjs");
const BC = await import("../../public/bringcard.js");
const IO = await import("../../public/sessionio.js");
const PV = await import("../../public/portalview.js");
const { STOP_LINE } = await import("../../public/shared.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const L = await import("../../worker/lessons.js");
const SUB = await import("../../worker/substitute.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");

const TOKEN = "lehrkraft-token-123";
const call = async (c, fn, method, body, ...args) => {
  const req = new Request("https://unterricks.test/x", { method, headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code } }; }
};
async function tool(c, name, args) {
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const r = (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
  return { text: r.content[0].text, isError: !!r.isError };
}
async function base() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = Date.parse("2026-11-16T07:00:00Z");
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 30 * 86400e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  return c;
}
const HEFT = [{ titel: "Gewaltenteilung im Schaubild", typ: "aufgabe", anleitung: "Zeichne das Schaubild in dein Heft.", minuten: 20 },
  { titel: "Drei Sätze", typ: "aufgabe", anleitung: "Schreibe drei Sätze dazu.", minuten: 25 }];
const settled = async (c, id) => (await call(c, L.routeLessonGet, "GET", undefined, id)).data.previousStop;
const tick = (c) => { c.now += 60e3; };

test("Zwischenstopp + Selbstlern-Phase: save_selbstlern erledigt den Hinweis nach der Entscheidung (Nachtrag 26); „Wiederherstellen“ setzt ihn zurück", async () => {
  const c = await base();
  const a = await L.createLesson(c.db, { subject: "powi", klass: "8B", title: "Was ist Macht?", date: "2026-11-12", startTime: "08:00", durationMin: 45 }, c.now);
  const b = await L.createLesson(c.db, { subject: "powi", klass: "8B", title: "Wer kontrolliert die Macht?", date: "2026-11-17", startTime: "08:00", durationMin: 45 }, c.now);
  assert.ok(!(await tool(c, "save_schulportal_entry", { lesson_id: a.id, text: "**1) Einstieg**\n- Karikatur\n" + STOP_LINE + "\n**2) Text M1**\n- lesen" })).isError);
  tick(c);
  assert.ok(!(await tool(c, "save_schulportal_entry", { lesson_id: b.id, text: "**1) Rollenspiel**\n- Gerichte" })).isError, "ursprüngliche Planung von b");
  const t0 = (await L.getLesson(c.db, b.id)).plan_saved_at;
  assert.ok(Number.isFinite(t0));
  let ps = await settled(c, b.id);
  assert.ok(ps && !ps.settled, "Hinweis offen");
  // im Selbstlern-Chat entschieden, danach umgestellt
  tick(c);
  assert.ok(!(await tool(c, "update_lesson", { lesson_id: b.id, zwischenstopp: "uebernehmen" })).isError);
  ps = await settled(c, b.id);
  assert.ok(ps.decision && !ps.settled, "Entscheidung allein erledigt den Hinweis nicht");
  tick(c);
  const r = await tool(c, "save_selbstlern", { lesson_id: b.id, schulportal: "**1) Selbstlern-Phase**\n- Text M1 als Station", stationen: HEFT });
  assert.ok(!r.isError, r.text);
  assert.equal((await L.getLesson(c.db, b.id)).plan_saved_at, c.now, "der Eintrag der Selbstlern-Phase ist die Planung dieser Sitzung");
  ps = await settled(c, b.id);
  assert.ok(ps.settled, "Entscheidung + Speichern (save_selbstlern) → Hinweis erledigt");
  assert.equal(JSON.parse((await SUB.getSubstitute(c.db, b.id)).archive).planSavedAt, t0, "Archiv merkt sich den Stand der ursprünglichen Planung");
  // erneutes Speichern ohne Schulportal ändert den Stand nicht, das Archiv bleibt
  tick(c);
  const savedAt = (await L.getLesson(c.db, b.id)).plan_saved_at;
  assert.ok(!(await tool(c, "save_selbstlern", { lesson_id: b.id, stationen: HEFT.slice(0, 1) })).isError);
  assert.equal((await L.getLesson(c.db, b.id)).plan_saved_at, savedAt);
  assert.equal(JSON.parse((await SUB.getSubstitute(c.db, b.id)).archive).planSavedAt, t0);
  // Wiederherstellen: die ursprüngliche Planung (vor der Entscheidung gespeichert) – der Hinweis gilt wieder
  tick(c);
  assert.equal((await call(c, SUB.routeSubstituteRestore, "POST", {}, b.id)).status, 200);
  assert.equal((await L.getLesson(c.db, b.id)).plan_saved_at, t0);
  ps = await settled(c, b.id);
  assert.ok(ps.decision && !ps.settled, "nach „Wiederherstellen“ wieder offen (Entscheidung bleibt)");
});

test("Wiederherstellen eines älteren Archivs (ohne planSavedAt): plan_saved_at bleibt unverändert", async () => {
  const c = await base();
  const b = await L.createLesson(c.db, { subject: "powi", klass: "8C", title: "Alt", date: "2026-11-17", startTime: "08:00", durationMin: 45 }, c.now);
  assert.ok(!(await tool(c, "save_selbstlern", { lesson_id: b.id, schulportal: "**1) Selbstlern-Phase**", stationen: HEFT })).isError);
  const s = await SUB.getSubstitute(c.db, b.id), arch = JSON.parse(s.archive);
  delete arch.planSavedAt;
  c.db.raw.prepare("UPDATE substitutes SET archive=? WHERE lesson_id=?").run(JSON.stringify(arch), b.id);
  const before = (await L.getLesson(c.db, b.id)).plan_saved_at;
  tick(c);
  assert.equal((await call(c, SUB.routeSubstituteRestore, "POST", {}, b.id)).status, 200);
  assert.equal((await L.getLesson(c.db, b.id)).plan_saved_at, before);
});

test("Selbstlern-Prompt: fragt nach dem offenen Teil der vorigen Stunde – nur, solange der Hinweis nicht erledigt ist", () => {
  const s = { ...F.sekCtx(P.unitContext), klass: "9D" };
  const plain = SL.claudeSelbstlernPrompt(s);
  assert.equal(SL.claudeSelbstlernPrompt({ ...s, previousStop: null }), plain);
  assert.equal(SL.claudeSelbstlernPrompt({ ...s, previousStop: { title: "Was ist Macht?", settled: true, decision: { choice: "verzichten", at: 1 } } }), plain, "erledigt → wie ohne");
  const open = SL.claudeSelbstlernPrompt({ ...s, previousStop: { title: "Was ist Macht?", settled: false, decision: null } });
  const step2of = (t) => t.split("\n").find((x) => x.startsWith("2. Nenne mir")), step2 = step2of(open);
  assert.match(step2, /Die vorige Sitzung „Was ist Macht\?“ wurde nicht vollständig beendet \(Zwischenstopp/);
  assert.match(step2, /als Station in diese Selbstlern-Phase kommt \(`zwischenstopp` "uebernehmen"\) oder nicht \("verzichten"\)/);
  assert.match(step2, /mit `update_lesson` fest, bevor du die Ideen entwickelst/);
  assert.equal(open.replace(step2, ""), plain.replace(step2of(plain), ""), "sonst unverändert");
  const decided = SL.claudeSelbstlernPrompt({ ...s, previousStop: { title: "Was ist Macht?", settled: false, decision: { choice: "uebernehmen", at: 1 } } });
  assert.match(decided, /Zum offenen Teil der vorigen Sitzung „Was ist Macht\?“ \(Zwischenstopp\) habe ich schon entschieden/);
  assert.doesNotMatch(decided, /frage mich, ob es als Station/);
  // Jg. 5/6 ebenso
  assert.match(SL.claudeSelbstlernPrompt({ ...s, klass: "6B", previousStop: { title: "X", settled: false, decision: null } }), /als Station in diese Selbstlern-Phase/);
});

test("get_lesson der nächsten Stunde mit der Lehrkraft nennt die Selbstlern-Phase(n) davor samt jetzt fälliger Hausaufgabe – sonst nichts", async () => {
  const c = await base();
  const mk = (title, date) => L.createLesson(c.db, { subject: "powi", klass: "9A", title, date, startTime: "08:00", durationMin: 45 }, c.now);
  const a = await mk("Normal davor", "2026-11-16"), b = await mk("Ohne mich 1", "2026-11-17"), b2 = await mk("Ohne mich 2", "2026-11-18"), d = await mk("Wieder da", "2026-11-19");
  const head = "## Vorher ohne Lehrkraft: Selbstlern-Phase";
  const gl = async (id) => (await tool(c, "get_lesson", { lesson_id: id })).text;
  assert.ok(!(await gl(d.id)).includes(head), "ohne Selbstlern-Phase nichts");
  assert.ok(!(await tool(c, "save_selbstlern", { lesson_id: b.id, schulportal: "**1) Selbstlern-Phase**", stationen: HEFT })).isError);
  // b2 noch normal: nur die Sitzung direkt davor zählt → für d nichts, für b2 die Selbstlern-Phase b
  assert.ok(!(await gl(d.id)).includes(head));
  let t = await gl(b2.id);
  assert.ok(t.includes(head + "\n"), t.slice(0, 400));
  assert.ok(t.includes("„Ohne mich 1“ am Di, 17.11.2026 (Sitzungs-ID " + b.id + "): Stationen 1. Gewaltenteilung im Schaubild (Arbeitsauftrag); 2. Drei Sätze (Arbeitsauftrag)"), t);
  assert.ok(t.includes("Hausaufgabe: „" + SL.selbstlernHomework("2026-11-18") + "“"), "Hausaufgabe mit dem Datum DIESER Sitzung");
  assert.ok(t.includes("Frage die Lehrkraft, ob diese Stunde mit einer kurzen Besprechung"));
  // zwei Tage ohne Lehrkraft: d nennt beide (in zeitlicher Reihenfolge), b2 selbst nichts (ist ohne Lehrkraft)
  assert.ok(!(await tool(c, "save_selbstlern", { lesson_id: b2.id, schulportal: "**1) Selbstlern-Phase**", stationen: HEFT.slice(1) })).isError);
  assert.ok(!(await gl(b2.id)).includes(head));
  t = await gl(d.id);
  assert.ok(t.includes(head + "n\nDie Sitzungen direkt vor dieser waren Selbstlern-Phasen"));
  assert.ok(t.indexOf("„Ohne mich 1“") < t.indexOf("„Ohne mich 2“"));
  assert.ok(t.includes("Hausaufgabe: „" + SL.selbstlernHomework("2026-11-19") + "“"));
  assert.ok(!(await gl(a.id)).includes(head), "die Sitzung davor: nichts");
  // Grundschule: nie (dort gibt es keine Selbstlern-Phase)
  assert.deepEqual(await SUB.selbstlernBeforeLines(c.db, { subject: "gs", klass: "gs1", lesson_date: "2026-11-19", id: "x", created_at: 0 }, null), []);
});

test("Karte „Mitbringen“ einer Sitzung ohne Lehrkraft: Hinweis, warum die Gegenstände nicht im roten Kasten stehen; folgt dem Stand", () => {
  let status = "selbstlern";
  const card = BC.bringCard({ id: "l1", L: () => ({ id: "l1", subject: "powi", klass: "8B", bring: [{ item: "Bibel", note: "In Phase 2 in der 8B." }], bringRev: 1 }), absent: () => status });
  const hint = card.el.querySelector("#bring-absent");
  assert.ok(hint && !hint.classList.contains("hidden"));
  assert.equal(hint.textContent, BC.BRING_ABSENT);
  assert.match(BC.BRING_ABSENT, /nicht im roten Kasten der Startseite/);
  status = "aktiv"; card.paintAbsent();
  assert.equal(hint.textContent, BC.BRING_ABSENT_OLD);
  status = null; card.paintAbsent();
  assert.ok(hint.classList.contains("hidden"));
  // ohne absent (Grundschule, ältere Aufrufer): kein Hinweis
  const gs = BC.bringCard({ id: "l2", L: () => ({ id: "l2", subject: "gs", klass: "gs1", bring: [], bringRev: 0 }) });
  assert.ok(gs.el.querySelector("#bring-absent").classList.contains("hidden"));
});

test("Hinweis „letzte Stunde nicht vollständig beendet“ auf einer Selbstlern-Sitzung nennt den Weg über die Selbstlern-Phase", () => {
  const ps = { id: "p1", title: "Was ist Macht?", date: "2026-11-12", open: "**2) Text M1**", decision: null };
  const normal = PV.prevStopCard(ps, { gs: false, unit: false }).querySelector(".stopstate").textContent;
  assert.match(normal, /^Beim Planen mit Claude \(„Stunde mit Claude planen“\)/, "normale Sitzung unverändert");
  const sl = PV.prevStopCard(ps, { gs: false, unit: true, selbstlern: SL.SELBSTLERN_BUTTON }).querySelector(".stopstate").textContent;
  assert.equal(sl, "Beim Überarbeiten der Selbstlern-Phase mit Claude (Knopf „" + SL.SELBSTLERN_BUTTON + "“) erklärt Claude, was offen geblieben ist, und fragt Sie, ob es als Station übernommen oder darauf verzichtet wird. Danach passt Claude die Unterrichtseinheit an.");
});

test("get_lesson einer Selbstlern-Sitzung: Hausaufgabe mit dem aktuellen Termin der nächsten Stunde mit der Lehrkraft; update_lesson mit mitbringen sagt, dass die Startseite sie nicht zeigt", async () => {
  const c = await base();
  const mk = (title, date) => L.createLesson(c.db, { subject: "powi", klass: "9B", title, date, startTime: "08:00", durationMin: 45 }, c.now);
  const b1 = await mk("Ohne mich 1", "2026-11-17"), b2 = await mk("Ohne mich 2", "2026-11-18");
  await mk("Wieder da", "2026-11-19");
  assert.ok(!(await tool(c, "save_selbstlern", { lesson_id: b1.id, schulportal: "**1) Selbstlern-Phase**", stationen: HEFT })).isError);
  const hwLine = async (id) => (await tool(c, "get_lesson", { lesson_id: id })).text.split("\n").find((x) => x.startsWith("Hausaufgabe aus dieser Sitzung"));
  assert.equal(await hwLine(b1.id), "Hausaufgabe aus dieser Sitzung (bis zur nächsten Sitzung): " + SL.selbstlernHomework("2026-11-18"));
  // am Tag danach fehlt die Lehrkraft auch: der gespeicherte Text nennt den 18., get_lesson den aktuellen Termin (19.) – wie der Abschnitt darunter
  assert.ok(!(await tool(c, "save_selbstlern", { lesson_id: b2.id, schulportal: "**1) Selbstlern-Phase**", stationen: HEFT })).isError);
  assert.equal((await L.getLesson(c.db, b1.id)).homework, SL.selbstlernHomework("2026-11-18"));
  const t = (await tool(c, "get_lesson", { lesson_id: b1.id })).text;
  assert.ok(t.includes("Hausaufgabe aus dieser Sitzung (bis zur nächsten Sitzung): " + SL.selbstlernHomework("2026-11-19")), "Hausaufgabe mit dem 19.");
  assert.ok(t.includes("bis zur nächsten Sitzung mit der Lehrkraft am Do, 19.11.2026"), "Abschnitt Selbstlern-Phase nennt denselben Termin");
  // ein eigener Text bleibt
  c.db.raw.prepare("UPDATE lessons SET homework='Bearbeite alle Stationen bis Mittwoch.' WHERE id=?").run(b1.id);
  assert.equal(await hwLine(b1.id), "Hausaufgabe aus dieser Sitzung (bis zur nächsten Sitzung): Bearbeite alle Stationen bis Mittwoch.");
  // mitbringen: gespeichert, aber die Antwort sagt, dass die Startseite sie in der Selbstlern-Phase nicht zeigt
  const r = await tool(c, "update_lesson", { lesson_id: b1.id, mitbringen: [{ gegenstand: "Grundgesetz", wofuer: "In Phase 1 in der 9B." }] });
  assert.ok(!r.isError && r.text.includes("Mitbringen (1 Gegenstand): Grundgesetz – gespeichert; solange für diese Sitzung eine Selbstlern-Phase gilt"), r.text);
  const n = await mk("Normal", "2026-11-20");
  const rn = await tool(c, "update_lesson", { lesson_id: n.id, mitbringen: [{ gegenstand: "Bibel", wofuer: "In Phase 2 in der 9B." }] });
  assert.ok(rn.text.includes("Mitbringen (1 Gegenstand): Bibel – Unterricks zeigt sie der Lehrkraft am Vortag auf der Startseite"), "normale Sitzung unverändert");
});

test("Sitzungsdatei einer Sitzung ohne Lehrkraft: Hinweis, welche Fassung darin steht (normale Sitzungen und Sicherung unverändert)", async () => {
  const detail = (substitute) => ({ lesson: { subject: "powi", klass: "8C", title: "T", topic: "", date: "2026-11-24", portal: "" }, files: [], drafts: [], sheets: [], messages: [], substitute });
  const notesOf = async (sub, full = false) => (await IO.buildSessionZip(detail(sub), { fb: null, full })).notes;
  assert.deepEqual(await notesOf(null), []);
  const sl = await notesOf({ status: "selbstlern", proposal: null });
  assert.equal(sl.length, 1);
  assert.match(sl[0], /^Diese Sitzung ist eine Selbstlern-Phase: Die Datei enthält ihre jetzige Fassung .* Die ursprüngliche Planung kehrt mit „Wiederherstellen“ in der Sitzung zurück und steht in der großen Sicherung\.$/);
  assert.match((await notesOf({ status: "aktiv" }))[0], /^Für diese Sitzung gilt eine ältere Vertretung: Die Datei enthält die Vertretungsstunde/);
  assert.deepEqual(await notesOf({ status: "vorschlag" }), [], "ein älterer, nicht bestätigter Vorschlag ändert die Sitzung nicht");
  // die Sitzungsseite übergibt ihren Zustand (st.sub statt substitute)
  const fromPage = (await IO.buildSessionZip({ ...detail(undefined), sub: { status: "selbstlern" } }, { fb: null })).notes;
  assert.match(fromPage[0], /^Diese Sitzung ist eine Selbstlern-Phase/);
  assert.ok(!(await notesOf({ status: "selbstlern", archive: { portal: "x", files: [], sheets: [] } }, true)).some((x) => x.includes("jetzige Fassung")), "Sicherung: der bisherige Hinweis zum Archiv");
});
