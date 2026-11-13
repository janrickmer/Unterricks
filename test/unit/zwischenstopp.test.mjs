// Anforderung 13 (S11): Zwischenstopp → nächste Sitzung → Unterrichtseinheit, beide Schulformen. Der offene Teil der vorigen Sitzung steht im Prompt
// „Stunde mit Claude planen“, in get_lesson und im Backup-Chat; Claude fragt „übernehmen oder verzichten“ (update_lesson zwischenstopp), passt die
// Einheit an (update_unit_row mit stunden – eine Speicherung) und verlängert sie nach Zustimmung (extend_unit). Ohne Zwischenstopp bleiben die
// Prompts byte-gleich zum Stand vor S11.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const P = await import("../../public/planning.js");
const G = await import("../../public/gsplanning.js");
const S = await import("../../public/shared.js");
const F = await import("./stop-fixtures.mjs");
const { fakeCtx } = await import("./fake-d1.mjs");
const GS = await import("../../worker/gs.js");
const U = await import("../../worker/units.js");
const L = await import("../../worker/lessons.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");

const sha = (s) => createHash("sha256").update(s).digest("hex");
const at = (s) => Date.parse(s);
const STOP = S.STOP_LINE;

/* ---------- reine Funktionen ---------- */
test("stopParts: Text vor und nach dem Zwischenstopp, ohne die Stopp-Zeile, getrimmt", () => {
  assert.deepEqual(S.stopParts("**1) A**\n- x\n\n" + STOP + "\n\n**2) B**\n- y\n"), { done: "**1) A**\n- x", open: "**2) B**\n- y" });
  assert.deepEqual(S.stopParts("**1) A**\n**2) B**"), { done: "**1) A**\n**2) B**", open: "" }, "ohne Zwischenstopp: alles geschafft");
  assert.deepEqual(S.stopParts(STOP + "\n**1) A**"), { done: "", open: "**1) A**" }, "am Anfang: nichts geschafft");
  assert.deepEqual(S.stopParts("**1) A**\n  ⏸  Zwischenstopp  \n**2) B**\n" + STOP + "\n**3) C**"), { done: "**1) A**", open: "**2) B**\n**3) C**" }, "der erste zählt, weitere fallen weg");
  assert.deepEqual(S.stopParts("a\r\n" + STOP + "\r\nb"), { done: "a", open: "b" });
  assert.deepEqual(S.stopParts(null), { done: "", open: "" });
});

test("slotsAfterEnd: die nächsten Termine laut Stundenplan nach dem Ende – Ferien und Ausfälle übersprungen, nur kommende", () => {
  const p = { start: "2026-11-03", end: "2026-11-12", weekdays: [{ day: 2, minutes: 45, time: "08:00" }, { day: 4, minutes: 90, time: "10:00" }],
    breaks: [{ from: "2026-11-16", to: "2026-11-20", label: "Ferien" }], cancelled: [{ date: "2026-11-24", time: "08:00" }] };
  assert.deepEqual(P.slotsAfterEnd(p, 3, at("2026-11-02T10:00:00Z")).map((s) => [s.date, s.time, s.minutes]), [["2026-11-26", "10:00", 90], ["2026-12-01", "08:00", 45], ["2026-12-03", "10:00", 90]]);
  assert.deepEqual(P.slotsAfterEnd({ ...p, exam: "2026-11-26" }, 1, at("2026-11-02T10:00:00Z")).map((s) => s.date), ["2026-12-01"], "kein Klausurtag");
  assert.deepEqual(P.slotsAfterEnd(p, 1, at("2026-11-27T10:00:00Z")).map((s) => s.date), ["2026-12-01"], "nur Termine, die noch nicht vorbei sind");
  assert.deepEqual(P.slotsAfterEnd({ ...p, end: null }, 1), []);
});

/* ---------- Prompt „Stunde mit Claude planen“ ---------- */
// SHA-256 der Prompts ohne Zwischenstopp mit dem Code vor S11 (Commit 6ba46f7) – sie dürfen sich nicht ändern
const BEFORE = { sek: "f2c21230cad34f85d878845ceaaf4452ed56590e00fa034835b44d706f6c958a", sek6: "a66cd53454419b2ce70b5ec285786cbef72efafa73b769208e24bba66bfe50e3",
  gs: "1df9dc0a92044b6170c2e8c034439accb0e77474611ae40b944986ef19e058ec", gs0: "c0423aaee510abe36cb8a218d19ff2f6bc78b4e8b62015555339557d620acfe0" };
// Nr. 17 (13.11.2026): der Gymnasium-Prompt bekommt genau einen Satz zu Links in Feibeitsblättern (FB_LINK_RULE in FEIBEITSBLATT_INFO) – ohne ihn
// bleibt er byte-gleich; Jg. 5/6 (keine Feibeitsblätter) und die Grundschule bleiben ganz unverändert
const withoutLinkRule = (p) => { assert.equal(p.split(" " + S.FB_LINK_RULE).length - 1, 1, "der Satz zu Links steht genau einmal im Prompt"); return p.replace(" " + S.FB_LINK_RULE, ""); };
// Nr. 21 (13.11.2026): beide Prompts bekommen genau einen letzten Speicherschritt (Zusammenfassung der Sitzung für die Lehrkraft) und den Zusatz für den
// Rückfall ohne Connector – ohne beide bleiben sie byte-gleich
const withoutSummary = (p, gs, analog = false) => {
  const step = "\n" + S.summarySaveStep(gs, analog);
  assert.equal(p.split(step).length - 1, 1, "der Schritt zur Zusammenfassung steht genau einmal im Prompt");
  assert.equal(p.split(S.SUMMARY_FALLBACK).length - 1, 1, "der Zusatz für den Rückfall steht genau einmal im Prompt");
  return p.replace(step, "").replace(S.SUMMARY_FALLBACK, "");
};
test("ohne Zwischenstopp: beide Prompts byte-gleich zum Stand vor S11 (Gymnasium: bis auf den Satz zu Links in Feibeitsblättern; beide bis auf die Zusammenfassung)", () => {
  const s = F.sekCtx(P.unitContext), g = F.gsCtx(P.unitContext);
  assert.equal(sha(withoutLinkRule(withoutSummary(P.claudeLessonPrompt(s), false))), BEFORE.sek);
  const sek6 = P.claudeLessonPrompt({ ...s, klass: "6B", unit: null, row: null, unitText: "", messages: [] }), gs = G.claudeGsLessonPrompt(g), gs0 = G.claudeGsLessonPrompt({ ...g, unit: null, row: null, unitText: "" });
  for (const p of [sek6, gs, gs0]) assert.ok(!p.includes(S.FB_LINK_RULE) && !p.includes("[Linktext](https://…)"));
  assert.equal(sha(withoutSummary(sek6, false, true)), BEFORE.sek6);
  assert.equal(sha(withoutSummary(gs, true)), BEFORE.gs);
  assert.equal(sha(withoutSummary(gs0, true)), BEFORE.gs0);
});

const PREV = { id: "abcdefabcdefabcd", title: "Was ist Macht?", date: "2026-11-10", portal: "**1) Einstieg**\n- Karikatur\n" + STOP + "\n**2) Partnerarbeit**\n- ~~M1~~ lesen", portalVersion: 4,
  done: "**1) Einstieg**\n- Karikatur", open: "**2) Partnerarbeit**\n- ~~M1~~ lesen", unitId: "fedcba9876543210", unitRow: "a0a0a0a0", sameUnit: true, unitTitle: null,
  row: { uid: "a0a0a0a0", n: 1, total: 3, stundenfrage: "Was ist Macht?", ablauf: ["Einstieg Karikatur", "Text M1"] }, decision: null };
const NOW = at("2026-11-11T10:00:00Z");
test("Gymnasium mit Zwischenstopp: Geschafft/Nicht geschafft, eigener Schritt nach get_lesson, Übernehmen/Verzichten, Einheit erst nach der bestätigten Stunde", () => {
  const ctx = { ...F.sekCtx(P.unitContext), previousStop: PREV, now: NOW };
  const p = P.claudeLessonPrompt(ctx);
  const sec = p.slice(p.indexOf("## Vorige Stunde nicht vollständig beendet"), p.indexOf("## Bisheriger Planungsverlauf"));
  for (const s of ["„Was ist Macht?“ (Di, 10.11.2026; Sitzungs-ID abcdefabcdefabcd)", "in ihrem Schulportal-Eintrag", "In der Einheit ist sie Stunde 1: geplante Stundenfrage „Was ist Macht?“; geplanter grober Ablauf: Einstieg Karikatur; Text M1.",
    "Geschafft (bis zum Zwischenstopp):\n<<<\n**1) Einstieg**\n- Karikatur\n>>>", "Nicht geschafft (nach dem Zwischenstopp):\n<<<\n**2) Partnerarbeit**\n- ~~M1~~ lesen\n>>>", "Stand: Ich habe noch nicht entschieden"])
    assert.ok(sec.includes(s), s);
  assert.ok(!sec.includes("[uid"), "am Gymnasium keine uid (get_unit nennt dort keine)");
  // Vorgehen: 0, 1 (get_lesson), 2 (Zwischenstopp), 3 (Dauer) …
  const v = p.slice(p.indexOf("## Vorgehen"));
  assert.ok(v.indexOf("\n1. Rufe zuerst") < v.indexOf("\n2. Zur vorigen Stunde (Zwischenstopp, siehe oben) – bevor du nach Dauer und Wünschen fragst:") &&
    v.indexOf("\n2. Zur vorigen Stunde") < v.indexOf("\n3. Frage mich dann nach der Dauer") && v.includes("\n4. Plane mit mir dialogisch") && v.includes("\n5. Speichere nur") && v.includes("\n6. Sage mir zum Schluss"));
  for (const s of ["Erkläre mir zuerst in wenigen Stichpunkten, was in der vorigen Stunde nicht geschafft wurde (Inhalte, Aufgaben, Material nach dem Zwischenstopp). Frage mich, ob du es in diese Stunde einbauen sollst oder ob wir darauf verzichten.",
    "`update_lesson` fest (`zwischenstopp`: \"uebernehmen\" oder \"verzichten\")", "rückt in die nächste Stunde der Einheit, deren Überhang in die übernächste usw. – die Termine bleiben (keine Stunde einschieben, keine Sitzung verschieben)",
    // Entscheidung b: am Ende wird immer verlängert oder gekürzt (keine Bedingung „bleibt etwas übrig“); die Frage nennt das neue Ende (Entscheidung c)
    "Am Ende der Einheit bleibt so ein Überhang: Frage mich, ob die Einheit um eine Stunde verlängert werden kann (neues Ende laut Stundenplan: Di, 08.12.2026) oder ob an einer Stelle gekürzt werden soll.", "genau drei Vorschläge", "nenne einen davon als Favoriten mit Begründung", "Verzichten: Plane die Stunde ohne den offenen Teil.",
    "Erst wenn ich die Planung dieser Stunde bestätigt habe und du sie gespeichert hast, passt du die Einheit an", "`extend_unit` (Einheit fedcba9876543210", "`update_unit_row` mit `unit_id` fedcba9876543210",
    "die Zeile der vorigen Stunde (Ablauf = was tatsächlich behandelt wurde)", "je Stunde ihre Nummer `nr` aus `get_unit`", "Verzichten → `update_unit_row` mit `lesson_id` abcdefabcdefabcd", "„Verzichtet: …“",
    "die folgenden Stunden bleiben unverändert", "Sage mir danach, was sich in der Einheit geändert hat."])
    assert.ok(v.includes(s), s);
  // Rückfall ohne Connector: Tabelle zum Übertragen und das neue Ende (nächster Termin nach dem 26.11. laut Stundenplan; Projektwoche übersprungen)
  assert.ok(p.endsWith("Ändert sich wegen des offenen Teils der vorigen Stunde die Einheit, gib mir die geänderten Zeilen als Tabelle (Stunde, Stundenfrage, grober Ablauf) zum Übertragen aus " +
    "und sage mir bei einer Verlängerung, welches neue Ende ich in den Rahmendaten eintrage (laut Stundenplan der nächste Termin nach dem bisherigen Ende: Di, 08.12.2026)."), p.slice(-400));
  // ohne Zwischenstopp sind die Teile davor und danach gleich
  const q = P.claudeLessonPrompt({ ...ctx, previousStop: null });
  assert.equal(p.slice(0, p.indexOf("\n## Vorige Stunde")), q.slice(0, q.indexOf("\n## Bisheriger Planungsverlauf")));
});

test("schon entschieden: nicht erneut fragen, nur die gewählte Regel; ohne Einheit keine Einheits-Schritte; knappe Objekte gehen auch", () => {
  const base = { ...F.sekCtx(P.unitContext), now: NOW };
  const d = P.claudeLessonPrompt({ ...base, previousStop: { ...PREV, decision: { choice: "verzichten", at: at("2026-11-11T09:00:00Z") } } });
  assert.ok(d.includes("Stand: Ich habe am Mi, 11.11.2026 entschieden: Auf den offenen Teil wird verzichtet.") && d.includes("Ich habe schon entschieden: Auf den offenen Teil wird verzichtet. (am Mi, 11.11.2026). Frage nicht erneut, außer ich möchte es ändern"));
  assert.ok(!d.includes("Übernehmen:") && !d.includes("extend_unit") && d.includes("Verzichten → `update_unit_row` mit `lesson_id` abcdefabcdefabcd") && !d.includes("Erkläre mir zuerst"));
  assert.ok(d.endsWith("gib mir die geänderten Zeilen als Tabelle (Stunde, Stundenfrage, grober Ablauf) zum Übertragen aus."), "Verzicht: keine Verlängerung");
  const u = P.claudeLessonPrompt({ ...base, previousStop: { ...PREV, decision: { choice: "uebernehmen", at: at("2026-11-11T09:00:00Z") } } });
  assert.ok(u.includes("Übernehmen: Plane den offenen Teil") && !u.includes("Verzichten: Plane") && u.includes("`extend_unit`"));
  // Sitzung ohne Einheit, vorige ohne Zeile: nur erklären/fragen und einbauen bzw. weglassen
  const o = P.claudeLessonPrompt({ ...base, unit: null, row: null, unitText: "", previousStop: { ...PREV, row: null, unitId: null, unitRow: null, sameUnit: false } });
  assert.ok(o.includes("es rückt nichts nach") && !o.includes("extend_unit") && !o.includes("update_unit_row") && !o.includes("Erst wenn ich die Planung") && !o.includes("Ändert sich wegen des offenen Teils"));
  // diese Sitzung ohne Einheit, die vorige Stunde in einer Einheit: Übernehmen passt trotzdem deren Zeile an (was tatsächlich behandelt wurde) – nicht „andere“ Einheit
  const n = P.claudeLessonPrompt({ ...base, unit: null, row: null, unitText: "", previousStop: { ...PREV, sameUnit: false, unitRow: null, unitTitle: "Gewaltenteilung" } });
  assert.ok(n.includes("Sie gehört zur Unterrichtseinheit „Gewaltenteilung“ (ID fedcba9876543210), dort ist sie Stunde 1") && !n.includes("anderen Unterrichtseinheit")
    && n.includes("Übernehmen → `update_unit_row` mit `lesson_id` abcdefabcdefabcd (Zeile der vorigen Stunde): Ablauf = was tatsächlich behandelt wurde (der offene Teil steht dann in dieser Sitzung).")
    && n.includes("Verzichten → `update_unit_row` mit `lesson_id` abcdefabcdefabcd") && !n.includes("extend_unit") && n.includes("es rückt nichts nach"), n.slice(n.indexOf("## Vorige"), n.indexOf("## Vorige") + 3000));
  assert.ok(n.endsWith("gib mir die geänderten Zeilen als Tabelle (Stunde, Stundenfrage, grober Ablauf) zum Übertragen aus."), "Rückfall: Tabelle auch beim Übernehmen ohne Einheit");
  const nu = P.claudeLessonPrompt({ ...base, unit: null, row: null, unitText: "", previousStop: { ...PREV, sameUnit: false, unitRow: null, unitTitle: "Gewaltenteilung", decision: { choice: "uebernehmen", at: at("2026-11-11T09:00:00Z") } } });
  assert.ok(nu.includes("Übernehmen → `update_unit_row` mit `lesson_id` abcdefabcdefabcd") && !nu.includes("Verzichten") && nu.endsWith("zum Übertragen aus."), "schon übernommen: nur die Zeile der vorigen Stunde");
  const sec = P.stopLessonLines({ ...PREV, sameUnit: false, unitRow: null, unitTitle: "Gewaltenteilung" }, { gs: false, unitId: null }).join("\n");
  assert.ok(sec.includes("Zeile der Einheit (Einheit „Gewaltenteilung“, unit_id fedcba9876543210): Stunde 1") && !sec.includes("andere Einheit"), sec);
  // vorige Stunde in einer anderen Einheit: genannt; Verzicht über ihre lesson_id
  const f = P.claudeLessonPrompt({ ...base, previousStop: { ...PREV, sameUnit: false, unitRow: null, unitId: "9".repeat(16), unitTitle: "Wahlen" } });
  assert.ok(f.includes("Sie gehört zu einer anderen Unterrichtseinheit („Wahlen“, ID " + "9".repeat(16) + "), dort ist sie Stunde 1") && !f.includes("in einer Speicherung die Zeile der vorigen Stunde")
    && f.includes("Die Zeile der vorigen Stunde (andere Einheit) passt du mit `update_unit_row` und `lesson_id` abcdefabcdefabcd an"));
  // ältere Form {title, date, portal}: Teile aus dem Eintrag
  const k = P.claudeLessonPrompt({ ...base, previousStop: { title: "Vorige", date: "2026-11-10", portal: "**1) A**\n" + STOP + "\n**2) Offen geblieben**" } });
  assert.ok(k.includes("Geschafft (bis zum Zwischenstopp):\n<<<\n**1) A**\n>>>") && k.includes("Nicht geschafft (nach dem Zwischenstopp):\n<<<\n**2) Offen geblieben**\n>>>"));
});

test("Grundschule mit Zwischenstopp: Verlaufsplan, uid, Material nach dem Zwischenstopp mit file_id", () => {
  const g = F.gsCtx(P.unitContext);
  const ps = { ...PREV, id: "e".repeat(16), title: "Josef und seine Brüder", portal: "**1) Erzählung**\n" + STOP + "\n**2) Arbeitsblatt**\n- [[pdf:" + "3".repeat(16) + "]]", done: "**1) Erzählung**",
    open: "**2) Arbeitsblatt**\n- [[pdf:" + "3".repeat(16) + "]]", unitId: g.unit.id, unitRow: "aaaaaaaa", row: { uid: "aaaaaaaa", n: 1, total: 2, stundenfrage: "Josef und seine Brüder", ablauf: ["Erzählung"] },
    openFiles: [{ id: "3".repeat(16), name: "Arbeitsblatt Josef.pdf" }] };
  const p = G.claudeGsLessonPrompt({ ...g, previousStop: ps, now: NOW });
  for (const s of ["in ihrem Verlaufsplan", "Stunde 1 [uid aaaaaaaa]", "Material nach dem Zwischenstopp (schon angelegt – verweise es mit seiner file_id weiter): „Arbeitsblatt Josef.pdf“ (file_id " + "3".repeat(16) + ")",
    "\n2. Zur vorigen Stunde (Zwischenstopp, siehe oben)", "\n3. Frage mich dann nach der Dauer", "\n6. Sage mir zum Schluss", "je Stunde ihre `uid` aus `get_unit`", "`extend_unit` (Einheit " + "1".repeat(16)])
    assert.ok(p.includes(s), s);
  const sec = p.slice(p.indexOf("## Vorige Stunde"), p.indexOf("## Feste Vorgaben"));
  assert.ok(!sec.includes("Schulportal-Eintrag") && !p.includes("ihre Nummer `nr`"));
  assert.ok(p.includes("Plane dann mit den Angaben oben und gib mir den Verlaufsplan am Ende zum Kopieren aus" + S.SUMMARY_FALLBACK + ". Ändert sich wegen des offenen Teils"));
});

test("Prompt „Einheit nach Ausfällen überarbeiten“: Verlängern über extend_unit statt „trage ich in den Rahmendaten ein“", () => {
  const unit = { id: "u".repeat(16), rows: [{ uid: "aaaaaaaa", stundenfrage: "A", ablauf: [], date: null }], plan: {}, params: { start: "2026-11-03", end: "2026-11-19", weekdays: [{ day: 2, minutes: 45, time: "08:00" }] },
    revise: { items: [{ date: "2026-11-10", time: "08:00" }] }, lessons: [], course: null };
  const p = G.claudeUnitRevisionPrompt({ unit, now: at("2026-11-02T10:00:00Z") });
  assert.ok(p.includes("oder die Einheit verlängern (stimme ich zu, trägst du das mit `extend_unit` ein") && !p.includes("das trage ich dann in den Rahmendaten ein"));
  assert.ok(p.includes("4. Soll verlängert werden, rufe zuerst `extend_unit` auf") && p.includes("`save_unit_plan`"));
});

test("Backup-Chat: Abschnitt über die Lehrkraft gesprochen, ohne Speichern – Änderungen zum Übertragen und das neue Ende", () => {
  const unit = F.sekCtx(P.unitContext).unit;
  const t = P.stopChatSection(PREV, { gs: false, unitId: unit.id, unit, now: NOW });
  for (const s of ["Vorige Stunde nicht vollständig beendet (automatisch übermittelt):", "Vorige Sitzung: „Was ist Macht?“ (Di, 10.11.2026), Sitzungs-ID abcdefabcdefabcd", "Zeile der Einheit: Stunde 1 – geplante Stundenfrage: „Was ist Macht?“",
    "Nicht geschafft (nach dem Zwischenstopp):\n<<<\n**2) Partnerarbeit**", "Erkläre der Lehrkraft zuerst", "Frage sie, ob du es in diese Stunde einbauen sollst oder ob darauf verzichtet wird.", "genau drei Vorschläge",
    "Du kannst in der Plattform nichts speichern: Nenne der Lehrkraft am Ende, was sie in der Einheit ändern muss, als Tabelle zum Übertragen", "(laut Stundenplan der nächste Termin nach dem bisherigen Ende: Di, 08.12.2026)"])
    assert.ok(t.includes(s), s);
  assert.ok(!t.includes("update_lesson") && !t.includes("extend_unit") && !t.includes("Erkläre mir"));
});

/* ---------- Worker und Connector ---------- */
const TOKEN = "lehrkraft-token-123", T0 = at("2026-11-02T10:00:00Z");
const call = async (c, fn, method, path, body, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method, headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code, ...(e.extra || {}) } }; }
};
async function mcp(c, name, args) {
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  const r = await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json();
  return { text: r.result.content[0].text, isError: !!r.result.isError, data: r.result.structuredContent };
}
const TT = [{ day: 2, minutes: 45, time: "08:00" }, { day: 4, minutes: 45, time: "08:00" }];   // Di/Do 08:00
async function base(env = {}) {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234", ...env });
  c.now = T0;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 30 * 86400e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  return c;
}
// Einheit mit n Stunden (Di/Do 08:00), festgelegt (Sitzungen angelegt), wenn sessions
async function unitWith(c, { subject, klass, end, n, breaks = [], sessions = true }) {
  const unit = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject, klass, title: "Einheit", params: { start: "2026-11-03", end, weekdays: TT, breaks } })).data.unit;
  const rows = Array.from({ length: n }, (_, i) => ({ stundenfrage: "Stunde " + (i + 1), ablauf: ["Ablauf " + (i + 1)] }));
  let u = (await call(c, U.routeUnitPatch, "PATCH", "/x", { plan: { lernaufgabe: "Lernprodukt", schritte: [{ titel: "A", beschreibung: "B" }] }, rows, assignDates: true }, unit.id)).data.unit;
  if (sessions) u = (await call(c, U.routeUnitSessions, "POST", "/x", undefined, unit.id)).data.unit;
  const byRow = new Map(u.lessons.map((l) => [l.row, l.id]));
  return { u, ids: u.rows.map((r) => byRow.get(r.uid)), uids: u.rows.map((r) => r.uid) };
}
const getLesson = async (c, id) => (await call(c, L.routeLessonGet, "GET", "/api/teacher/lessons/" + id, undefined, id)).data;
const unitGet = async (c, id) => (await call(c, U.routeUnitGet, "GET", "/x", undefined, id)).data.unit;

test("Gymnasium: previousStop mit Teilen und Zeile, get_lesson-Abschnitt, Entscheidung festhalten, veraltet nach Änderung der vorigen Sitzung", async () => {
  const c = await base();
  const { u, ids } = await unitWith(c, { subject: "powi", klass: "8B", end: "2026-11-12", n: 4 });
  await L.savePortal(c.db, ids[0], "**1) Einstieg**\n- Karikatur\n" + STOP + "\n**2) Partnerarbeit**\n- ~~M1~~ lesen", null, "lehrkraft", c.now);
  const d = await getLesson(c, ids[1]);
  const ps = d.previousStop;
  assert.deepEqual([ps.id, ps.done, ps.open, ps.portalVersion, ps.unitId, ps.unitRow, ps.sameUnit, ps.decision], [ids[0], "**1) Einstieg**\n- Karikatur", "**2) Partnerarbeit**\n- ~~M1~~ lesen", 1, u.id, u.rows[0].uid, true, null]);
  assert.deepEqual(ps.row, { uid: u.rows[0].uid, n: 1, total: 4, stundenfrage: "Stunde 1", ablauf: ["Ablauf 1"] });
  assert.equal((await getLesson(c, ids[2])).previousStop, null, "übernächste Sitzung: kein Hinweis");
  // die folgende Sitzung (für den Hinweis nach dem Setzen): noch nicht geplant, nach einem Eintrag geplant
  assert.deepEqual((await getLesson(c, ids[0])).nextLesson, { id: ids[1], title: "Stunde 2", date: "2026-11-05", planned: false });
  await L.savePortal(c.db, ids[1], "**1) Weiter**", null, "claude", c.now);
  assert.equal((await getLesson(c, ids[0])).nextLesson.planned, true);
  // get_lesson: Abschnitt mit Fakten, Stand und Regeln (über die Lehrkraft gesprochen)
  let g = await mcp(c, "get_lesson", { lesson_id: ids[1] });
  const sec = g.text.slice(g.text.indexOf("## Vorige Stunde nicht vollständig beendet"), g.text.indexOf("## Planungsverlauf"));
  for (const s of ["Vorige Sitzung: „Stunde 1“ (Di, 03.11.2026), Sitzungs-ID " + ids[0] + " – die Lehrkraft hat dort einen Zwischenstopp gesetzt (Schulportal-Eintrag, Version 1).",
    "Zeile der Einheit: Stunde 1 – geplante Stundenfrage: „Stunde 1“", "Geplanter grober Ablauf:\n- Ablauf 1", "Geschafft (bis zum Zwischenstopp):\n<<<\n**1) Einstieg**\n- Karikatur\n>>>",
    "Nicht geschafft (nach dem Zwischenstopp):\n<<<\n**2) Partnerarbeit**\n- ~~M1~~ lesen\n>>>", "Entscheidung der Lehrkraft: noch nicht entschieden", "So gehst du vor (auch wenn dein Prompt diesen Abschnitt nicht enthält):",
    "- Erkläre der Lehrkraft zuerst", "`update_lesson` fest (`zwischenstopp`", "`update_unit_row` mit `unit_id` " + u.id, "ihre Nummer `nr`", "`lesson_id` " + ids[0], "Erst wenn die Lehrkraft die Planung dieser Stunde bestätigt hat"])
    assert.ok(sec.includes(s), s);
  assert.ok(!sec.includes("[uid") && g.text.indexOf("## Schulportal-Eintrag") < g.text.indexOf("## Vorige Stunde"));
  assert.ok(!(await mcp(c, "get_lesson", { lesson_id: ids[2] })).text.includes("## Vorige Stunde"), "ohne Zwischenstopp der vorigen Sitzung kein Abschnitt");
  // update_lesson zwischenstopp: ohne Zwischenstopp der vorigen Sitzung abgelehnt (nichts gespeichert), ungültiger Wert abgelehnt
  let r = await mcp(c, "update_lesson", { lesson_id: ids[2], zwischenstopp: "uebernehmen", titel: "Neu" });
  assert.ok(r.isError && r.text === "Die vorige Sitzung hat keinen Zwischenstopp.", r.text);
  assert.equal((await L.getLesson(c.db, ids[2])).title, "Stunde 3", "nichts halb gespeichert");
  assert.ok((await mcp(c, "update_lesson", { lesson_id: ids[1], zwischenstopp: "vielleicht" })).isError);
  c.now = at("2026-11-04T09:00:00Z");
  r = await mcp(c, "update_lesson", { lesson_id: ids[1], zwischenstopp: "uebernehmen", hausaufgabe: "Lies M1." });
  assert.ok(!r.isError && r.text.startsWith("Gespeichert. Entscheidung zum offenen Teil der vorigen Sitzung „Stunde 1“ festgehalten: Der offene Teil wird in dieser Stunde übernommen.") && r.data.zwischenstopp === "uebernehmen", r.text);
  const row = await L.getLesson(c.db, ids[1]);
  assert.equal(row.homework, "Lies M1.");
  assert.deepEqual(JSON.parse(row.stop_decision), { v: 1, choice: "uebernehmen", prevId: ids[0], prevVersion: 1, at: c.now });
  assert.deepEqual((await getLesson(c, ids[1])).previousStop.decision, { choice: "uebernehmen", at: c.now });
  g = await mcp(c, "get_lesson", { lesson_id: ids[1] });
  assert.ok(g.text.includes("Entscheidung der Lehrkraft: entschieden am Mi, 04.11.2026: übernehmen – Der offene Teil wird in dieser Stunde übernommen.") && g.text.includes("- Die Lehrkraft hat schon entschieden:") && !g.text.includes("Verzichten: Plane"));
  // die vorige Sitzung ändert sich (Zwischenstopp verschoben) → wieder „noch nicht entschieden“
  await L.savePortal(c.db, ids[0], STOP + "\n**1) Einstieg**\n- Karikatur\n**2) Partnerarbeit**", null, "lehrkraft", c.now);
  const ps2 = (await getLesson(c, ids[1])).previousStop;
  assert.equal(ps2.decision, null);
  assert.equal(ps2.done, "");
  // Ausfall-Einträge nehmen keine Entscheidung an (Grundschule: siehe unten); Gymnasium: Ausfall gibt es nicht
});

test("update_lesson zwischenstopp mit neuem datum: es zählt die vorige Sitzung zum neuen Datum", async () => {
  const c = await base();
  const { ids } = await unitWith(c, { subject: "powi", klass: "8B", end: "2026-11-12", n: 4 });   // Di 03.11., Do 05.11., Di 10.11., Do 12.11.
  await L.savePortal(c.db, ids[0], "**1) A**\n" + STOP + "\n**2) Offen**", null, "lehrkraft", c.now);
  // Sitzung 3 rückt auf den 04.11. – direkt hinter die Sitzung mit dem Zwischenstopp
  let r = await mcp(c, "update_lesson", { lesson_id: ids[2], datum: "2026-11-04", zwischenstopp: "verzichten" });
  assert.ok(!r.isError && r.text.includes("„Stunde 1“ festgehalten: Auf den offenen Teil wird verzichtet."), r.text);
  const d = (await getLesson(c, ids[2])).previousStop;
  assert.ok(d && d.id === ids[0] && d.decision && d.decision.choice === "verzichten", JSON.stringify(d && d.decision));
  // Sitzung 2 rückt hinter Sitzung 4: ihre vorige Sitzung hat dann keinen Zwischenstopp – abgelehnt, nichts gespeichert
  r = await mcp(c, "update_lesson", { lesson_id: ids[1], datum: "2026-11-13", zwischenstopp: "uebernehmen" });
  assert.ok(r.isError && r.text === "Die vorige Sitzung hat keinen Zwischenstopp.", r.text);
  const l2 = await L.getLesson(c.db, ids[1]);
  assert.deepEqual([l2.lesson_date, l2.stop_decision ?? null], ["2026-11-05", null]);
});

test("Gymnasium: update_unit_row mit stunden – eine Speicherung, Version, Nummern nur mit base_version, nichts halb gespeichert", async () => {
  const c = await base();
  const { u } = await unitWith(c, { subject: "powi", klass: "8B", end: "2026-11-12", n: 4 });
  let r = await mcp(c, "update_unit_row", { unit_id: u.id, stunden: [{ nr: 1, ablauf: ["Einstieg"] }] });
  assert.ok(r.isError && r.text.includes("base_version"), r.text);
  r = await mcp(c, "update_unit_row", { unit_id: u.id, base_version: u.version - 1, stunden: [{ nr: 1, ablauf: ["Einstieg"] }] });
  assert.ok(r.isError && r.text.includes("Die Einheit wurde inzwischen geändert (Version " + u.version + ")"), r.text);
  r = await mcp(c, "update_unit_row", { unit_id: u.id, base_version: u.version, stunden: [{ nr: 2, stundenfrage: "Neu 2" }, { nr: 9, stundenfrage: "x" }] });
  assert.ok(r.isError && r.text.includes("nr 9") && r.text.includes("Es wurde nichts gespeichert."), r.text);
  r = await mcp(c, "update_unit_row", { unit_id: u.id, base_version: u.version, stunden: [{ nr: 2, stundenfrage: "Neu 2" }, { nr: 2, ablauf: ["x"] }] });
  assert.ok(r.isError && r.text.includes("doppelt"), r.text);
  r = await mcp(c, "update_unit_row", { unit_id: u.id, base_version: u.version, stunden: [{ nr: 3 }] });
  assert.ok(r.isError && r.text.includes("stundenfrage und/oder ablauf"), r.text);
  assert.ok((await mcp(c, "update_unit_row", { unit_id: u.id, uid: u.rows[0].uid, stunden: [{ nr: 1, ablauf: ["x"] }] })).isError, "stunden nicht zusammen mit uid");
  assert.ok((await mcp(c, "update_unit_row", { lesson_id: u.lessons[0].id, stunden: [{ nr: 1, ablauf: ["x"] }] })).isError, "stunden nur mit unit_id");
  assert.equal((await unitGet(c, u.id)).version, u.version, "nichts gespeichert");
  c.db.counter.n = 0;
  r = await mcp(c, "update_unit_row", { unit_id: u.id, base_version: u.version, stunden: [{ nr: 3, stundenfrage: "Neu 3", ablauf: ["Rest aus Stunde 2", "Diskussion"] }, { nr: 2, stundenfrage: "Neu 2" }] });
  assert.ok(!r.isError && r.text === "In der Einheit festgehalten (Version " + (u.version + 1) + ", 2 Stunden): Stunde 2 „Neu 2“; Stunde 3 „Neu 3“.", r.text);
  assert.ok(c.db.counter.n <= 8, "D1-Anweisungen: " + c.db.counter.n);
  const after = await unitGet(c, u.id);
  assert.equal(after.version, u.version + 1, "eine Speicherung");
  assert.deepEqual(after.rows.map((x) => [x.stundenfrage, x.ablauf, x.date]), [["Stunde 1", ["Ablauf 1"], "2026-11-03"], ["Neu 2", ["Ablauf 2"], "2026-11-05"], ["Neu 3", ["Rest aus Stunde 2", "Diskussion"], "2026-11-10"], ["Stunde 4", ["Ablauf 4"], "2026-11-12"]]);
  // die bisherige Ein-Zeilen-Form bleibt
  r = await mcp(c, "update_unit_row", { unit_id: u.id, uid: after.rows[3].uid, stundenfrage: "Abschluss" });
  assert.equal(r.text, "In der Einheit festgehalten: Abschluss");
});

test("Gymnasium: extend_unit – nächster Termin nach dem Ende (Ferien übersprungen), Sitzung angelegt, Version, zu viele Stunden, Anweisungen", async () => {
  const c = await base();
  const { u, ids } = await unitWith(c, { subject: "powi", klass: "8B", end: "2026-11-12", n: 4, breaks: [{ from: "2026-11-16", to: "2026-11-20", label: "Ferien" }] });
  let r = await mcp(c, "extend_unit", { unit_id: u.id, base_version: u.version, termine: 1, stunden: [{ stundenfrage: "a", ablauf: ["x"] }, { stundenfrage: "b", ablauf: ["y"] }] });
  assert.ok(r.isError && r.text.startsWith("Mehr neue Stunden (2) als Termine (1)") && r.text.endsWith("Es wurde nichts verlängert."), r.text);
  r = await mcp(c, "extend_unit", { unit_id: u.id, base_version: u.version + 5, termine: 1 });
  assert.ok(r.isError && r.text.includes("Version " + u.version), r.text);
  assert.ok((await mcp(c, "extend_unit", { unit_id: u.id, base_version: u.version, termine: 4 })).isError);
  assert.equal((await unitGet(c, u.id)).version, u.version, "nichts geändert");
  c.db.counter.n = 0;
  r = await mcp(c, "extend_unit", { unit_id: u.id, base_version: u.version, termine: 1, stunden: [{ stundenfrage: "Puffer: Diskussion", ablauf: ["Rest aus Stunde 3", "Sicherung"], schritt: 0 }], begruendung: "Zwischenstopp" });
  assert.ok(c.db.counter.n <= 12, "D1-Anweisungen: " + c.db.counter.n);
  const after = await unitGet(c, u.id);
  const nl = after.lessons.find((l) => l.row === after.rows[4].uid);
  assert.ok(!r.isError && r.text.startsWith("Einheit verlängert (Version " + after.version + "): Ende bisher Do, 12.11.2026, jetzt Di, 24.11.2026. Stunde 5 „Puffer: Diskussion“ (neu): Di, 24.11.2026 08:00 (45 Min.) – Sitzung " + nl.id + " angelegt."), r.text);
  assert.ok(r.text.endsWith("Für update_unit_row gilt jetzt base_version " + after.version + "."));
  assert.equal(after.version, u.version + 1);
  assert.equal(after.params.end, "2026-11-24");
  assert.deepEqual(after.params.breaks, [{ from: "2026-11-16", to: "2026-11-20", label: "Ferien" }]);
  assert.deepEqual([after.rows.length, after.rows[4].stundenfrage, after.rows[4].ablauf, after.rows[4].schritt, after.rows[4].date, after.rows[4].time, after.rows[4].minutes], [5, "Puffer: Diskussion", ["Rest aus Stunde 3", "Sicherung"], 0, "2026-11-24", "08:00", 45]);
  const l5 = await L.getLesson(c.db, nl.id);
  assert.deepEqual([l5.subject, l5.klass, l5.lesson_date, l5.start_time, l5.duration_min, l5.unit_id, l5.title, l5.cancelled], ["powi", "8B", "2026-11-24", "08:00", 45, u.id, "Puffer: Diskussion", 0]);
  assert.ok(/^[A-Z0-9]{6}$/.test(l5.code), "Sitzungscode");
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM chat WHERE lesson_id=?1 AND model='begruessung'").bind(nl.id).first()).n, 1, "Begrüßung des Planungschats wie beim Festlegen");
  // bestehende Sitzungen behalten ihre Termine
  for (let i = 0; i < 4; i++) assert.equal((await L.getLesson(c.db, ids[i])).lesson_date, u.rows[i].date);
  // zwei Termine, eine Stunde: der zweite bleibt frei
  r = await mcp(c, "extend_unit", { unit_id: u.id, base_version: after.version, termine: 2, stunden: [{ stundenfrage: "Noch eine", ablauf: ["x"] }] });
  assert.ok(!r.isError && r.text.includes("jetzt Di, 01.12.2026") && r.text.includes("Stunde 6 „Noch eine“ (neu): Do, 26.11.2026 08:00 (45 Min.)") && r.text.includes("Frei geblieben: Di, 01.12.2026 08:00 (45 Min.)."), r.text);
  // noch nicht festgelegte Einheit: keine Sitzungen
  const { u: u2 } = await unitWith(c, { subject: "powi", klass: "8C", end: "2026-11-12", n: 2, sessions: false });
  r = await mcp(c, "extend_unit", { unit_id: u2.id, base_version: u2.version, termine: 1, stunden: [{ stundenfrage: "Neu", ablauf: ["x"] }] });
  assert.ok(!r.isError && r.text.includes("Die Einheit ist noch nicht festgelegt") && (await unitGet(c, u2.id)).lessons.length === 0, r.text);
  // ohne Ende in den Rahmendaten: klare Meldung
  const u3 = (await call(c, U.routeUnitCreate, "POST", "/api/teacher/units", { subject: "powi", klass: "8D", title: "Ohne Ende", params: { start: "2026-11-03", weekdays: TT } })).data.unit;
  r = await mcp(c, "extend_unit", { unit_id: u3.id, base_version: u3.version, termine: 1 });
  assert.ok(r.isError && r.text.includes("noch kein Ende"), r.text);
});

test("Grundschule: extend_unit nach einer Krankmeldung – erst die Stunde ohne Termin (ihre Sitzung bekommt Datum, Beginn, Dauer), dann neue Stunden", async () => {
  const c = await base();
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", { grade: 2, classes: ["a"], religion: true, weekdays: TT, classSize: 20 })).data.course;
  const { u, ids, uids } = await unitWith(c, { subject: "gs", klass: course.id, end: "2026-11-19", n: 6 });
  const v = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  assert.equal((await call(c, GS.routeLessonCancel, "POST", "/x", { version: v }, ids[2])).status, 200);
  let cur = await unitGet(c, u.id);
  assert.deepEqual(cur.revise.undated, [uids[5]]);
  assert.equal((await L.getLesson(c.db, ids[5])).lesson_date, null);
  // ein Termin geht an die Stunde ohne Termin – für eine neue Stunde reicht er nicht
  let r = await mcp(c, "extend_unit", { unit_id: u.id, base_version: cur.version, termine: 1, stunden: [{ stundenfrage: "Fest", ablauf: ["Feier"] }] });
  assert.ok(r.isError && r.text.startsWith("Für 1 neue Stunde reichen die Termine nicht: 1 von 1 Termin geht zuerst an Stunden ohne Termin (Stunde 6 „Stunde 6“)."), r.text);
  r = await mcp(c, "extend_unit", { unit_id: u.id, base_version: cur.version, termine: 2, stunden: [{ stundenfrage: "Fest", ablauf: ["Feier"] }] });
  cur = await unitGet(c, u.id);
  const fest = cur.lessons.find((l) => l.row === cur.rows[6].uid);
  assert.ok(!r.isError && r.text.includes("Ende bisher Do, 19.11.2026, jetzt Do, 26.11.2026.") && r.text.includes("Stunde 6 [uid " + uids[5] + "] „Stunde 6“ (bisher ohne Termin): Di, 24.11.2026 08:00 (45 Min.) – Sitzung " + ids[5] + " hat jetzt diesen Termin.")
    && r.text.includes("Stunde 7 [uid " + cur.rows[6].uid + "] „Fest“ (neu): Do, 26.11.2026 08:00 (45 Min.) – Sitzung " + fest.id + " angelegt."), r.text);
  const l6 = await L.getLesson(c.db, ids[5]);
  assert.deepEqual([l6.lesson_date, l6.start_time, l6.duration_min], ["2026-11-24", "08:00", 45]);
  assert.deepEqual(cur.revise.undated, [], "keine Stunde mehr ohne Termin");
  assert.equal(cur.revise.open, true, "der rote Hinweis bleibt, bis die Lehrkraft ihn entfernt");
  assert.equal(cur.revise.canUndo, false, "die Krankmeldung lässt sich danach nicht mehr rückgängig machen");
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM chat WHERE lesson_id=?1").bind(fest.id).first()).n, 0, "Grundschule: kein Planungschat");
  assert.ok(cur.lessons.find((l) => l.cancelled), "der Ausfall-Eintrag bleibt");
});

test("Grundschule: get_lesson mit Material nach dem Zwischenstopp, update_unit_row mit uid, Entscheidung; Ausfall-Eintrag abgelehnt", async () => {
  const c = await base();
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", { grade: 2, classes: ["a"], religion: true, weekdays: TT, classSize: 20 })).data.course;
  const { u, ids, uids } = await unitWith(c, { subject: "gs", klass: course.id, end: "2026-11-12", n: 4 });
  const fid = "3".repeat(16);
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, created_at, updated_at) VALUES(?1, ?2, 'student', 'file', 'Arbeitsblatt Josef.pdf', 'application/pdf', 10, 'ready', 'upload', ?3, ?3)").bind(fid, ids[0], c.now).run();
  await L.savePortal(c.db, ids[0], "**1) Erzählung (10 Min., Sitzkreis)**\n" + STOP + "\n**2) Arbeitsblatt (15 Min.)**\n- [[pdf:" + fid + "]]", null, "lehrkraft", c.now);
  const d = await getLesson(c, ids[1]);
  assert.deepEqual(d.previousStop.openFiles, [{ id: fid, name: "Arbeitsblatt Josef.pdf" }]);
  const g = await mcp(c, "get_lesson", { lesson_id: ids[1] });
  for (const s of ["## Vorige Stunde nicht vollständig beendet", "(Verlaufsplan, Version 1)", "Zeile der Einheit: Stunde 1 [uid " + uids[0] + "]", "Material nach dem Zwischenstopp:\n- file_id " + fid + ": „Arbeitsblatt Josef.pdf“ → [[pdf:" + fid + "]]",
    "je Stunde ihre `uid` aus `get_unit`"]) assert.ok(g.text.includes(s), s);
  assert.ok(g.text.indexOf("Eltern sehen nach der Stunde") < g.text.indexOf("## Vorige Stunde") && g.text.indexOf("## Vorige Stunde") < g.text.indexOf("## Inhalt der Unterrichtsstunde"));
  // Verzichten festhalten und die Zeile der vorigen Stunde anpassen
  let r = await mcp(c, "update_lesson", { lesson_id: ids[1], zwischenstopp: "verzichten" });
  assert.ok(!r.isError && r.text.includes("Auf den offenen Teil wird verzichtet."), r.text);
  r = await mcp(c, "update_unit_row", { lesson_id: ids[0], ablauf: ["Erzählung", "Verzichtet: Arbeitsblatt"] });
  assert.ok(!r.isError);
  // mehrere Stunden mit uid in einer Speicherung (Grundschule ohne base_version: die gelesene Version)
  const v0 = (await unitGet(c, u.id)).version;
  r = await mcp(c, "update_unit_row", { unit_id: u.id, stunden: [{ uid: uids[1], stundenfrage: "Neu 2" }, { uid: uids[2], ablauf: ["Neu"] }] });
  assert.ok(!r.isError && r.text === "In der Einheit festgehalten (Version " + (v0 + 1) + ", 2 Stunden): Stunde 2 [uid " + uids[1] + "] „Neu 2“; Stunde 3 [uid " + uids[2] + "] „Stunde 3“.", r.text);
  assert.ok((await mcp(c, "update_unit_row", { unit_id: u.id, stunden: [{ uid: "0badc0de", ablauf: ["x"] }] })).text.includes("uid 0badc0de"));
  // Krankmeldung: der Ausfall-Eintrag nimmt keine Entscheidung an
  const cv = (await call(c, GS.routeLessonCancel, "POST", "/x", { dryRun: true }, ids[2])).data.version;
  const ph = (await call(c, GS.routeLessonCancel, "POST", "/x", { version: cv }, ids[2])).data.placeholderId;
  assert.ok((await mcp(c, "update_lesson", { lesson_id: ph, zwischenstopp: "verzichten" })).isError);
});

test("Backup-Chat: der System-Prompt der kostenlosen KI enthält den Abschnitt (nur mit Zwischenstopp der vorigen Sitzung)", async () => {
  const seen = [];
  const c = await base({ AI: { run: async (m, inputs) => { seen.push(inputs.messages); return { response: "Antwort" }; } } });
  const { ids } = await unitWith(c, { subject: "powi", klass: "8B", end: "2026-11-12", n: 3 });
  const chat = (id) => call(c, L.routeChatPost, "POST", "/x", { message: "Hallo" }, id);
  assert.equal((await chat(ids[1])).status, 200);
  assert.ok(!seen[0][0].content.includes("Vorige Stunde nicht vollständig beendet"));
  await L.savePortal(c.db, ids[0], "**1) A**\n" + STOP + "\n**2) Offen**", null, "lehrkraft", c.now);
  assert.equal((await chat(ids[1])).status, 200);
  const sys = seen[1][0].content;
  assert.ok(sys.includes("\n\nVorige Stunde nicht vollständig beendet (automatisch übermittelt):\nVorige Sitzung: „Stunde 1“") && sys.includes("Du kannst in der Plattform nichts speichern") && sys.includes("Nicht geschafft (nach dem Zwischenstopp):\n<<<\n**2) Offen**"), sys.slice(-1500));
  assert.ok(sys.startsWith(seen[0][0].content.slice(0, seen[0][0].content.indexOf("Aktuelle Unterrichtssitzung"))), "der übrige System-Prompt bleibt gleich");
});

test("Connector: neue Werkzeuge in tools/list, Beschreibungen zum Zwischenstopp", async () => {
  const c = await base();
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  const tools = (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result.tools;
  const t = (n) => tools.find((x) => x.name === n);
  assert.deepEqual(t("update_lesson").inputSchema.properties.zwischenstopp.enum, ["uebernehmen", "verzichten"]);
  assert.equal(t("update_unit_row").inputSchema.properties.stunden.maxItems, 30);
  assert.deepEqual(t("extend_unit").inputSchema.required, ["unit_id", "base_version", "termine"]);
  assert.equal(t("extend_unit").inputSchema.properties.termine.maximum, 3);
  assert.ok(t("extend_unit").description.includes("NUR nach ausdrücklicher Zustimmung der Lehrkraft"));
  for (const n of ["save_schulportal_entry", "save_verlaufsplan"]) assert.ok(t(n).description.includes("Eine vorhandene Zeile „" + STOP + "“ lässt du unverändert an ihrer Stelle; setze selbst keine."), n);
});

// Abschlussprüfung (Zusammenspiel Nr. 13 + Nr. 14): „Inhalte rücken nach“ ändert nur die Zeilen der Einheit – eine schon geplante spätere Sitzung
// behält ihren Eintrag, ihr Material und ihre Druckliste (die Druckaufträge für den nächsten Arbeitstag zeigten sonst unbemerkt das alte Material).
// Claude weist darauf hin; nur beim Übernehmen mit Einheit, in beiden Schulformen, in get_lesson und im Backup-Chat sinngemäß.
test("Übernehmen: Hinweis auf schon geplante spätere Sitzungen (Material und Druckliste passen sich nicht von selbst an)", () => {
  const sek = P.claudeLessonPrompt({ ...F.sekCtx(P.unitContext), previousStop: PREV, now: NOW });
  assert.ok(sek.includes("Ist eine der Stunden, in die Inhalte nachrücken, schon geplant (Schulportal-Eintrag, Material – siehe `get_lesson` ihrer Sitzung), sage es mir: " +
    "Die Sitzung dieser Stunde passt sich samt Material und Druckliste nicht von selbst an – ich plane sie dort mit „Stunde mit Claude planen“ neu."));
  const g = F.gsCtx(P.unitContext);
  const gs = G.claudeGsLessonPrompt({ ...g, previousStop: { ...PREV, unitId: g.unit.id }, now: NOW });
  assert.ok(gs.includes("schon geplant (Verlaufsplan, PDFs – siehe `get_unit`), sage es mir: Die Sitzung dieser Stunde passt sich samt Material und Druckliste nicht von selbst an"));
  const lk = P.stopRules(PREV, { unitId: PREV.unitId, who: "lk", save: true }).join("\n");
  assert.ok(lk.includes("sage es ihr: Die Sitzung dieser Stunde passt sich samt Material und Druckliste nicht von selbst an – die Lehrkraft plant sie dort mit „Stunde mit Claude planen“ neu."));
  const chat = P.stopRules(PREV, { unitId: PREV.unitId, who: "lk", save: false }).join("\n");
  assert.ok(chat.includes("Weise sie darauf hin: Ist eine der Stunden, in die Inhalte nachrücken, schon geplant, passt sich ihre Sitzung samt Material und Druckliste nicht von selbst an") && !chat.includes("get_lesson"));
  // nicht beim Verzichten (die folgenden Stunden bleiben unverändert) und nicht ohne Einheit (es rückt nichts nach)
  const d = P.claudeLessonPrompt({ ...F.sekCtx(P.unitContext), previousStop: { ...PREV, decision: { choice: "verzichten", at: at("2026-11-11T09:00:00Z") } }, now: NOW });
  const o = P.claudeLessonPrompt({ ...F.sekCtx(P.unitContext), unit: null, row: null, unitText: "", previousStop: { ...PREV, row: null, unitId: null, unitRow: null, sameUnit: false }, now: NOW });
  assert.ok(!d.includes("in die Inhalte nachrücken") && !o.includes("in die Inhalte nachrücken"));
});
