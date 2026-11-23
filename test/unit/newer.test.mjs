// Nachtrag 44, Teil 2 (23.11.2026): Hinweis „Das ist nicht die aktuellste Sitzung“ in der Sitzung der Schüler:innen und der feste Text zur Eingabe des
// Sitzungscodes. Geprüft: der reine Helfer (geplanter Beginn, Stand der nächsten späteren Sitzung), die Schüler-Route (gleicher Kurs, Reihenfolge, laut
// Plan bzw. schon live, nur ja/nein – nie Code, Titel oder Kennung der späteren Sitzung, keine zusätzliche D1-Anfrage), der Hinweis im nachgebildeten
// DOM und die Einbindung in public/app.js (Quelltext – app.js lässt sich ohne Router nicht laden). Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
const { stubs, installDom } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/schueler/s/0123456789abcdef" });
const S = await import("../../public/shared.js");
const NN = await import("../../public/newernote.js");
const { newerNote } = NN;
const { fakeCtx } = await import("./fake-d1.mjs");
const L = await import("../../worker/lessons.js");
const ST = await import("../../worker/student.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");

const STOKEN = "schueler-token-newer", DEV = "eeeeeeeeeeeeeeee";
const at = (iso) => Date.parse(iso);
// Di, 17.11.2026, 8:00 Uhr in Berlin = 07:00 UTC (Winterzeit)
const L1_START = at("2026-11-17T07:00:00Z"), L2_START = at("2026-11-19T08:45:00Z");   // Do, 19.11.2026, 9:45 Uhr in Berlin

const scall = async (c, fn, method, body, ...args) => {
  const req = new Request("https://unterricks.test/x", { method, headers: { Authorization: "Bearer " + STOKEN, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code } }; }
};
const lesson = (c, subject, klass, title, date, startTime, durationMin = 90) => L.createLesson(c.db, { subject, klass, title, date, startTime, durationMin }, c.now);
const device = async (c, klass, subject = "powi") => c.db.raw.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, ?, ?, ?, ?, ?)")
  .run(DEV, await sha256Hex(STOKEN), klass, subject, c.now, c.now, c.now + 30 * 86400e3);
const grant = (c, l) => c.db.raw.prepare("INSERT OR IGNORE INTO student_access(device_id, lesson_id, joined_at) VALUES(?, ?, ?)").run(DEV, l.id, c.now);
const view = async (c, l, now) => (await scall({ ...c, now }, ST.routeStudentLesson, "GET", undefined, l.id)).data;
// Durable Objects der Live-Präsentation (env.LIVE) nachgebildet: active = Map Sitzung → updatedAt (zuletzt gestartet bzw. weitergeschaltet, wie die Nachricht
// des Durable Objects für Schüler:innen), jede Anfrage wird mitgeschrieben; fail = nicht erreichbar, hang = antwortet nie
const fakeLive = (active = new Map(), { fail = false, hang = false } = {}) => {
  const calls = [];
  return { calls, active, idFromName: (n) => n, get: (id) => ({ fetch: async (url) => {
    calls.push([id, String(url)]);
    if (fail) throw new Error("nicht erreichbar");
    if (hang) return new Promise(() => {});
    return Response.json({ t: "state", active: active.has(id), slide: 1, pages: 3, v: 2, updatedAt: active.has(id) ? active.get(id) : null });
  } }) };
};

/* ---------- reiner Helfer (shared.js) ---------- */
test("plannedStart/laterLessonState: Datum + Beginn in Berliner Zeit, ohne Beginn ab 0:00 Uhr; heute nur am Tag selbst", () => {
  assert.equal(S.plannedStart("2026-11-19", "09:45"), L2_START);
  assert.equal(S.plannedStart("2026-11-19", null), at("2026-11-18T23:00:00Z"), "ohne Beginn: 0:00 Uhr Berliner Zeit");
  assert.equal(S.plannedStart("2026-07-01", "08:00"), at("2026-07-01T06:00:00Z"), "Sommerzeit");
  assert.equal(S.plannedStart("2026-11-19", "9:45"), at("2026-11-18T23:00:00Z"), "ungültiger Beginn zählt wie keiner");
  assert.equal(S.plannedStart("19.11.2026", "09:45"), null);
  assert.equal(S.plannedStart(null, "09:45"), null);
  const next = { date: "2026-11-19", startTime: "09:45" };
  assert.deepEqual(S.laterLessonState(next, L2_START - 1), { begun: false, at: L2_START, today: true, soon: true });
  assert.deepEqual(S.laterLessonState(next, L2_START), { begun: true, at: L2_START, today: true, soon: false });
  assert.deepEqual(S.laterLessonState(next, at("2026-11-18T22:59:59Z")), { begun: false, at: L2_START, today: false, soon: false }, "am Vortag (Berlin) nicht „heute“");
  assert.deepEqual(S.laterLessonState({ date: "2026-11-19", startTime: null }, at("2026-11-18T23:00:00Z")).begun, true);
  assert.deepEqual(S.laterLessonState(null, L2_START), { begun: false, at: null, today: false, soon: false });
  assert.deepEqual(S.laterLessonState({ date: "kaputt", startTime: "09:45" }, L2_START), { begun: false, at: null, today: false, soon: false });
  // soon: heute, noch nicht begonnen, höchstens 30 Minuten bis zum Beginn (dann fragt die Seite jede Minute)
  assert.equal(S.NEWER_POLL_MS, 30 * 60e3);
  assert.equal(S.laterLessonState(next, L2_START - S.NEWER_POLL_MS).soon, true);
  assert.equal(S.laterLessonState(next, L2_START - S.NEWER_POLL_MS - 1).soon, false);
  // ohne Beginn (0:00 Uhr): die halbe Stunde davor liegt am Vortag – dort gibt es keine Live-Präsentation, die zählt
  assert.equal(S.laterLessonState({ date: "2026-11-19", startTime: null }, at("2026-11-18T22:45:00Z")).soon, false);
});

test("laterLiveCounts: nur eine laufende Live-Präsentation, die an ihrem eigenen Tag (Berliner Zeit) gestartet bzw. weitergeschaltet wurde", () => {
  const day = "2026-11-19";
  assert.equal(S.laterLiveCounts({ active: true, updatedAt: L2_START - 20 * 60e3 }, day), true);
  assert.equal(S.laterLiveCounts({ active: true, updatedAt: at("2026-11-18T23:00:00Z") }, day), true, "0:00 Uhr Berliner Zeit gehört schon zum Tag");
  assert.equal(S.laterLiveCounts({ active: true, updatedAt: at("2026-11-18T22:59:59Z") }, day), false, "am Vorabend gestartet und mit „Schließen“ offen gelassen");
  assert.equal(S.laterLiveCounts({ active: true, updatedAt: at("2026-11-16T17:00:00Z") }, day), false, "Vorschau am Montag");
  assert.equal(S.laterLiveCounts({ active: false, updatedAt: L2_START - 60e3 }, day), false, "beendet");
  assert.equal(S.laterLiveCounts({ active: true, updatedAt: null }, day), false, "ohne Zeitpunkt (älterer Stand)");
  assert.equal(S.laterLiveCounts({ active: true }, day), false);
  assert.equal(S.laterLiveCounts({ active: "ja", updatedAt: L2_START }, day), false);
  assert.equal(S.laterLiveCounts(null, day), false);
  assert.equal(S.laterLiveCounts(undefined, day), false);
});

test("Texte: Wortlaut der Lehrkraft („Aktuellste Sitzung laden“), Code-Eingabe mit Beginn der Stunde und Schulportal (wie der Hinweis der Lehrkraft)", () => {
  assert.equal(S.NEWER_BUTTON, "Aktuellste Sitzung laden");
  assert.equal(S.NEWER_TITLE, "Das ist nicht die aktuellste Sitzung");
  assert.equal(S.CODE_WHERE_TEXT, "Den Sitzungscode hat deine Lehrkraft zu Beginn der Unterrichtsstunde gezeigt. Er steht auch im Schulportal im Feld „Hausaufgabe“.");
  // dasselbe Feld nennt die Sitzungsseite der Lehrkraft beim Kopieren der Hausaufgabe
  assert.ok(readFileSync(new URL("../../public/session.js", import.meta.url), "utf8").includes("im Schulportal in das Feld „Hausaufgabe“ einfügen."));
  for (const t of [S.NEWER_TITLE, S.NEWER_TEXT, S.CODE_WHERE_TEXT]) assert.ok(!/["']|\bSie\b|Ihr(e|en)?\b/.test(t), "du-Form, typografische Anführungszeichen: " + t);
  assert.equal(S.NEWER_RECHECK_MS, 60e3);
});

/* ---------- Schüler-Route ---------- */
async function base() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = L1_START - 3600e3;
  const l1 = await lesson(c, "powi", "8B", "Gewaltenteilung", "2026-11-17", "08:00", 45);
  const l2 = await lesson(c, "powi", "8B", "Spätere GEHEIM-TITEL", "2026-11-19", "09:45", 45);
  await device(c, "8B");
  assert.equal((await scall(c, ST.routeStudentJoin, "POST", { code: l1.code })).status, 200);
  return { c, l1, l2 };
}

test("Route: spätere Sitzung noch nicht begonnen → newer false, ihr Beginn steht in changesAt; ab dem geplanten Beginn newer true – nie ihr Code, Titel oder ihre Kennung", async () => {
  const { c, l1, l2 } = await base();
  let sv = await view(c, l1, L1_START + 10 * 60e3);
  assert.equal(sv.newer, false);
  assert.ok(sv.changesAt.includes(L2_START), "zum geplanten Beginn lädt die Seite neu (ohne Neuladen der Seite)");
  sv = await view(c, l1, L2_START - 1);
  assert.equal(sv.newer, false);
  sv = await view(c, l1, L2_START);
  assert.equal(sv.newer, true);
  assert.ok(!sv.changesAt.includes(L2_START));
  sv = await view(c, l1, L2_START + 7 * 86400e3);
  assert.equal(sv.newer, true, "bleibt danach");
  const txt = JSON.stringify(sv);
  for (const x of [l2.id, l2.code, "Spätere GEHEIM-TITEL", "2026-11-19", "09:45"]) assert.ok(!txt.includes(x), "nichts über die spätere Sitzung: " + x);
  // die jüngste Sitzung selbst: kein Hinweis
  grant(c, l2);
  assert.equal((await view(c, l2, L2_START + 60e3)).newer, false);
});

test("Route: nur derselbe Kurs (Fach + Klasse bzw. Kurs, GK/LK getrennt), nur spätere, nicht ausgefallene Sitzungen; derselbe Tag nur mit beiden Uhrzeiten", async () => {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = L1_START;
  const l1 = await lesson(c, "powi", "8B", "Heute", "2026-11-17", "08:00", 45);
  await device(c, "8B"); grant(c, l1);
  const later = L1_START + 2 * 86400e3;
  // andere Klasse, anderes Fach, frühere Sitzung, früher am selben Tag – alle schon begonnen, keine zählt
  await lesson(c, "powi", "8C", "Andere Klasse", "2026-11-18", "08:00");
  await lesson(c, "ethik", "8B", "Anderes Fach", "2026-11-18", "08:00");
  await lesson(c, "powi", "8B", "Früher", "2026-11-16", "08:00");
  await lesson(c, "powi", "8B", "Früher am Tag", "2026-11-17", "07:00");
  const sameDayNoTime = await lesson(c, "powi", "8B", "Gleicher Tag ohne Uhrzeit", "2026-11-17", null);
  assert.equal((await view(c, l1, later)).newer, false, "derselbe Tag ohne Uhrzeit lässt sich nicht einordnen");
  // ausgefallen (Ausfall-Eintrag) zählt nicht
  const off = await lesson(c, "powi", "8B", "Ausgefallen", "2026-11-18", "08:00");
  c.db.raw.prepare("UPDATE lessons SET cancelled=1 WHERE id=?").run(off.id);
  assert.equal((await view(c, l1, later)).newer, false);
  // später am selben Tag (beide mit Uhrzeit) zählt
  const sameDay = await lesson(c, "powi", "8B", "Später am Tag", "2026-11-17", "11:30");
  assert.equal((await view(c, l1, L1_START + 3 * 3600e3)).newer, false, "11:30 Uhr noch nicht erreicht");
  assert.equal((await view(c, l1, at("2026-11-17T10:30:00Z"))).newer, true, "ab 11:30 Uhr");
  c.db.raw.prepare("DELETE FROM lessons WHERE id IN (?, ?)").run(sameDay.id, sameDayNoTime.id);
  // spätere Sitzung ohne Uhrzeit: ab 0:00 Uhr ihres Tages
  await lesson(c, "powi", "8B", "Morgen ohne Uhrzeit", "2026-11-18", null);
  assert.equal((await view(c, l1, at("2026-11-17T22:59:00Z"))).newer, false);
  assert.equal((await view(c, l1, at("2026-11-17T23:00:00Z"))).newer, true);
  // geöffnete Sitzung ohne Uhrzeit, spätere am selben Tag mit Uhrzeit: nicht einzuordnen
  const noTime = await lesson(c, "powi", "8B", "Ohne Uhrzeit", "2026-11-20", null);
  await lesson(c, "powi", "8B", "Am 20. mit Uhrzeit", "2026-11-20", "10:00");
  grant(c, noTime);
  assert.equal((await view(c, noTime, at("2026-11-20T12:00:00Z"))).newer, false);
  // Q-Phase: GK und LK getrennt
  const gk = await lesson(c, "powi", "Q2-GK", "Grundkurs", "2026-11-17", "08:00");
  await lesson(c, "powi", "Q2-LK", "Leistungskurs", "2026-11-18", "08:00");
  grant(c, gk);
  assert.equal((await view(c, gk, later)).newer, false);
});

test("Route: Kurs in Religion/Ethik (8-K) – nur die Sitzungen des Kurses, nicht die der eigenen Klasse", async () => {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = L1_START;
  await setSetting(c.db, "subjects", { evrel: { grades: ["8"], courses: { "8": ["8A", "8B"] } } });
  const k1 = await lesson(c, "evrel", "8-K", "Kurs 1", "2026-11-17", "08:00");
  await lesson(c, "evrel", "8A", "Klasse 8A", "2026-11-18", "08:00");
  await device(c, "8A", "evrel");
  const j = await scall(c, ST.routeStudentJoin, "POST", { code: k1.code });
  assert.equal(j.status, 200, JSON.stringify(j.data));
  assert.equal((await view(c, k1, L1_START + 3 * 86400e3)).newer, false, "eine Sitzung der Klasse 8A zählt für den Kurs 8-K nicht");
  await lesson(c, "evrel", "8-K", "Kurs 2", "2026-11-19", "09:45");
  assert.equal((await view(c, k1, L2_START)).newer, true);
});

test("Route: schon live gezeigt – nur am Tag der späteren Sitzung (Durable Object), Fehler zählt als nicht live; keine zusätzliche D1-Anfrage", async () => {
  const { c, l1, l2 } = await base();
  const live = fakeLive(new Map([[l2.id, L2_START - 25 * 60e3]]));   // heute 9:20 Uhr gestartet
  const lc = { ...c, env: { ...c.env, LIVE: live } };
  // am Tag davor: die Live-Präsentation wird gar nicht erst gefragt (eine Vorschau an einem früheren Tag zählt nicht)
  assert.equal((await view(lc, l1, at("2026-11-18T12:00:00Z"))).newer, false);
  assert.equal(live.calls.length, 0);
  // am Tag selbst vor dem Beginn: live → newer
  assert.equal((await view(lc, l1, L2_START - 20 * 60e3)).newer, true);
  assert.deepEqual(live.calls, [[l2.id, "https://live/state?role=student"]]);
  live.active.clear();
  const sv = await view(lc, l1, L2_START - 20 * 60e3);
  assert.equal(sv.newer, false, "nicht (mehr) live");
  assert.ok(sv.changesAt.includes(L2_START));
  // ab dem Beginn ohne Anfrage an die Live-Präsentation
  const n = live.calls.length;
  assert.equal((await view(lc, l1, L2_START + 60e3)).newer, true);
  assert.equal(live.calls.length, n);
  // nicht erreichbar → nicht live, die Seite lädt trotzdem
  const broken = { ...c, env: { ...c.env, LIVE: fakeLive(new Map([[l2.id, L2_START - 60e3]]), { fail: true }) } };
  const r = await scall({ ...broken, now: L2_START - 60e3 }, ST.routeStudentLesson, "GET", undefined, l1.id);
  assert.equal(r.status, 200); assert.equal(r.data.newer, false);
  // D1: mit und ohne spätere Sitzung gleich viele Anweisungen (eine Anweisung im bestehenden Batch)
  const count = async (cc, l, now) => { const before = cc.db.counter.n; await view(cc, l, now); return cc.db.counter.n - before; };
  const withLater = await count(lc, l1, L2_START + 60e3);
  c.db.raw.prepare("DELETE FROM lessons WHERE id=?").run(l2.id);
  assert.equal(await count(lc, l1, L2_START + 60e3), withLater);
});

test("Route: Vorschau an einem früheren Tag, mit „Schließen“ offen gelassen (active bleibt) – zählt am Tag der späteren Sitzung nicht als live (Gegenprüfung)", async () => {
  const { c, l1, l2 } = await base();
  // Montag, 16.11.2026, 18:00 Uhr: die Lehrkraft sieht sich die Präsentation der Sitzung vom Donnerstag an und schließt den Präsentationsmodus nur
  const live = fakeLive(new Map([[l2.id, at("2026-11-16T17:00:00Z")]]));
  const lc = { ...c, env: { ...c.env, LIVE: live } };
  // Donnerstag vor dem Beginn (z. B. Hausaufgabe vor der Schule): kein Hinweis, obwohl das Durable Object noch „active“ meldet
  assert.equal((await view(lc, l1, at("2026-11-19T06:30:00Z"))).newer, false);
  assert.equal((await view(lc, l1, L2_START - 10 * 60e3)).newer, false);
  assert.equal(live.calls.length, 2, "gefragt wird (heute), gezählt wird es nicht");
  // am Vorabend gestartet (22:59 Uhr Berliner Zeit) → auch nicht
  live.active.set(l2.id, at("2026-11-18T21:59:00Z"));
  assert.equal((await view(lc, l1, L2_START - 10 * 60e3)).newer, false);
  // heute erneut geöffnet (der Präsentationsmodus meldet sich mit „start“ – updatedAt = jetzt): zählt
  live.active.set(l2.id, L2_START - 12 * 60e3);
  assert.equal((await view(lc, l1, L2_START - 10 * 60e3)).newer, true);
  // älterer Stand des Durable Objects ohne Zeitpunkt: nicht live
  live.active.set(l2.id, null);
  assert.equal((await view(lc, l1, L2_START - 10 * 60e3)).newer, false);
});

test("Route: Live-Abfrage höchstens LIVE_CHECK_MS – ein hängendes Durable Object hält die Sitzungsseite nicht auf (Gegenprüfung)", async () => {
  const { c, l1, l2 } = await base();
  assert.equal(ST.LIVE_CHECK_MS, 1500);
  const live = fakeLive(new Map([[l2.id, L2_START - 60e3]]), { hang: true });
  // fake-dom.mjs löst Zeitgeber vom Prozess (unref) – dieser hält ihn am Leben, solange die Route wartet
  const keep = globalThis.__realSetTimeout(() => {}, 10000);
  const t0 = Date.now();
  let r;
  try { r = await scall({ ...c, env: { ...c.env, LIVE: live }, now: L2_START - 30e3 }, ST.routeStudentLesson, "GET", undefined, l1.id); }
  finally { clearTimeout(keep); }
  const took = Date.now() - t0;
  assert.equal(r.status, 200); assert.equal(r.data.newer, false, "Zeitüberschreitung zählt als nicht live");
  assert.equal(live.calls.length, 1);
  assert.ok(took >= ST.LIVE_CHECK_MS - 50 && took < ST.LIVE_CHECK_MS + 1500, "nach etwa LIVE_CHECK_MS: " + took + " ms");
  assert.ok(r.data.changesAt.includes(L2_START) && r.data.newerSoon === true, "die Seite fragt weiter jede Minute");
});

test("Route: newerSoon – in der halben Stunde vor dem Beginn der späteren Sitzung (an ihrem Tag, noch nicht live) fragt die Seite jede Minute; changesAt weckt sie dorthin", async () => {
  const { c, l1, l2 } = await base();
  const live = fakeLive();
  const lc = { ...c, env: { ...c.env, LIVE: live } };
  // Tage vorher: nicht bald, aber beide Zeitpunkte (30 Minuten vorher, Beginn) in changesAt
  let sv = await view(lc, l1, L1_START + 10 * 60e3);
  assert.equal(sv.newerSoon, false);
  assert.ok(sv.changesAt.includes(L2_START - S.NEWER_POLL_MS) && sv.changesAt.includes(L2_START));
  // heute, 31 Minuten vorher: noch nicht
  sv = await view(lc, l1, L2_START - 31 * 60e3);
  assert.equal(sv.newerSoon, false); assert.ok(sv.changesAt.includes(L2_START - S.NEWER_POLL_MS));
  // 30 bzw. 20 Minuten vorher: bald (der Zeitpunkt „30 Minuten vorher“ ist vorbei und fehlt in changesAt)
  sv = await view(lc, l1, L2_START - S.NEWER_POLL_MS);
  assert.equal(sv.newerSoon, true); assert.equal(sv.newer, false);
  sv = await view(lc, l1, L2_START - 20 * 60e3);
  assert.equal(sv.newerSoon, true); assert.ok(!sv.changesAt.includes(L2_START - S.NEWER_POLL_MS) && sv.changesAt.includes(L2_START));
  // die Lehrkraft startet heute: newer, nicht mehr „bald“ (die Seite hört auf zu fragen)
  live.active.set(l2.id, L2_START - 19 * 60e3);
  sv = await view(lc, l1, L2_START - 18 * 60e3);
  assert.equal(sv.newer, true); assert.equal(sv.newerSoon, false);
  // laut Plan begonnen: newer, nicht bald, kein Zeitpunkt der späteren Sitzung mehr
  live.active.clear();
  sv = await view(lc, l1, L2_START);
  assert.equal(sv.newer, true); assert.equal(sv.newerSoon, false); assert.ok(!sv.changesAt.includes(L2_START));
  // ohne Durable Object (env.LIVE fehlt) gilt „bald“ trotzdem (die Seite fragt, der Plan entscheidet)
  assert.equal((await view(c, l1, L2_START - 5 * 60e3)).newerSoon, true);
  // die jüngste Sitzung: nie
  grant(c, l2);
  assert.equal((await view(c, l2, L2_START - 5 * 60e3)).newerSoon, false);
  // nichts über die spätere Sitzung außer Zeitpunkten in changesAt
  const txt = JSON.stringify(await view(lc, l1, L2_START - 5 * 60e3));
  for (const x of [l2.id, l2.code, "Spätere GEHEIM-TITEL", "2026-11-19", "09:45"]) assert.ok(!txt.includes(x), "nichts über die spätere Sitzung: " + x);
});

test("Route: Selbstlern-Phase – der Hinweis gilt dort genauso (spätere Sitzung des Kurses), Erklär-Chatbot und Hausaufgabe unverändert", async () => {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234", AI: { run: async () => ({ response: "Antwort" }) } });
  c.now = L1_START - 3600e3;
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const l1 = await lesson(c, "powi", "8B", "Selbstlern", "2026-11-17", "08:00", 45);
  await lesson(c, "powi", "8B", "Nächste mit der Lehrkraft", "2026-11-19", "09:45", 45);
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "save_selbstlern",
    arguments: { lesson_id: l1.id, schulportal: "**1) Selbstlern-Phase**", stationen: [{ titel: "Heft", typ: "aufgabe", anleitung: "Schreibe drei Sätze.", minuten: 20 }] } } }) });
  const tr = (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
  assert.ok(!tr.isError, tr.content[0].text);
  await device(c, "8B"); grant(c, l1);
  let sv = await view(c, l1, L1_START + 60e3);
  assert.ok(sv.selbstlern && sv.newer === false && sv.changesAt.includes(L2_START));
  sv = await view(c, l1, L2_START);
  assert.ok(sv.selbstlern && sv.newer === true && sv.homework && sv.homework.dueDate === "2026-11-19");
});

test("ältere Daten ohne Datum der geöffneten Sitzung: kein Hinweis, kein Fehler", async () => {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = L1_START;
  const l1 = await lesson(c, "powi", "8B", "Mit Datum", "2026-11-17", "08:00");
  c.db.raw.prepare("UPDATE lessons SET lesson_date=NULL WHERE id=?").run(l1.id);
  await lesson(c, "powi", "8B", "Später", "2026-11-18", "08:00");
  await device(c, "8B"); grant(c, l1);
  const sv = await view(c, l1, L1_START + 3 * 86400e3);
  assert.equal(sv.newer, false);
});

/* ---------- Hinweis im DOM (public/newernote.js) ---------- */
test("Hinweis: leer ohne spätere Sitzung; roter Kasten mit h2, Satz und „Aktuellste Sitzung laden“ (Link zur Code-Eingabe), Live-Region, Fokus bleibt nicht hängen", async () => {
  const main = document.createElement("main");
  document.getElementById("app").append(main);
  let went = 0;
  const n = newerNote({ onGo: () => { went++; } });
  main.append(n.el);
  assert.equal(n.el.getAttribute("aria-live"), "polite");
  assert.equal(n.el.textContent, ""); assert.equal(n.el.children.length, 0);
  n.set(undefined); n.set(false); n.set("ja");
  assert.equal(n.el.children.length, 0, "nur true zeigt den Hinweis");
  n.set(true);
  const box = n.el.querySelector("section.alarm.newer-note");
  assert.ok(box && box.getAttribute("aria-labelledby") === "newer-h");
  assert.equal(box.querySelector("h2#newer-h").textContent, S.NEWER_TITLE);
  assert.equal(box.querySelector("p").textContent, S.NEWER_TEXT);
  const a = box.querySelector("a.btn.newer-go");
  assert.equal(a.getAttribute("href"), "#/schueler");
  assert.equal(a.textContent, S.NEWER_BUTTON);
  assert.ok(box.querySelector("svg") || box.querySelector(".ico"), "Warnsymbol");
  n.set(true);
  assert.equal(n.el.querySelector("section"), box, "unverändert: derselbe Kasten (keine zweite Ansage)");
  a.focus();
  assert.equal(document.activeElement, a);
  D.press("Enter");
  assert.equal(went, 1, "vor dem Wechsel: onGo (Fokus auf die Code-Eingabe vormerken)");
  n.set(false);
  assert.equal(n.el.children.length, 0);
  assert.equal(document.activeElement, n.el, "ohne Überschrift davor: der Fokus fällt nicht auf body, wenn der Hinweis verschwindet");
  assert.equal(n.el.getAttribute("tabindex"), "-1", "nicht in der Tab-Reihenfolge");
  assert.equal(n.on, false);
  main.remove();
});

test("Hinweis verschwindet mit dem Fokus darin: der Fokus geht auf die Überschrift im Kopfband davor (sichtbar, nicht auf den leeren Platz) – Gegenprüfung", () => {
  const main = document.createElement("main");
  document.getElementById("app").append(main);
  const head = document.createElement("header"); head.className = "pagehead";
  const row = document.createElement("div"); row.className = "row between";
  const h1 = document.createElement("h1"); h1.textContent = "Gewaltenteilung";
  row.append(h1); head.append(row); main.append(head);
  const n = newerNote();
  main.append(n.el);
  n.set(true);
  n.el.querySelector("a.newer-go").focus();
  n.set(false);
  assert.equal(document.activeElement, h1, "Fokus auf der Überschrift der Sitzung");
  assert.equal(h1.getAttribute("tabindex"), "-1", "nur per Skript fokussierbar, nicht in der Tab-Reihenfolge");
  assert.equal(n.el.hasAttribute("tabindex"), false);
  // ohne Fokus im Hinweis: der Fokus bleibt, wo er ist
  n.set(true); const other = document.createElement("button"); main.append(other); other.focus(); n.set(false);
  assert.equal(document.activeElement, other);
  main.remove();
});

test("Wunsch „Fokus in die Code-Eingabe“: einmal, höchstens 10 Minuten, übersteht ein Neuladen (sessionStorage), verworfen beim Zurück in eine Sitzung (Gegenprüfung)", async () => {
  const mem = new Map();
  globalThis.sessionStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  try {
    const t = at("2026-11-19T08:40:00Z");
    assert.equal(NN.takeCodeFocus(t), false, "ohne Wunsch nichts");
    NN.wantCodeFocus(t);
    assert.equal(mem.get(NN.CODE_FOCUS_KEY), String(t));
    assert.equal(NN.takeCodeFocus(t + 500), true);
    assert.equal(NN.takeCodeFocus(t + 600), false, "nur einmal");
    assert.equal(mem.has(NN.CODE_FOCUS_KEY), false);
    // Neuladen beim Seitenwechsel (neuer Stand): frisches Modul, der Wunsch steht noch in sessionStorage
    NN.wantCodeFocus(t);
    const fresh = await import("../../public/newernote.js?neu-geladen");
    assert.equal(fresh.takeCodeFocus(t + 2000), true, "nach dem Neuladen");
    assert.equal(NN.takeCodeFocus(t + 2000), true, "… und im alten Modul nur noch aus dem Arbeitsspeicher (dort einmal)");
    // zu alt (z. B. zurück, bevor das Formular gezeichnet war, und erst viel später wieder dort)
    NN.wantCodeFocus(t);
    assert.equal(NN.takeCodeFocus(t + NN.CODE_FOCUS_MS), false);
    assert.equal(NN.CODE_FOCUS_MS, 10 * 60e3);
    // zurück in eine Sitzung: verworfen
    NN.wantCodeFocus(t); NN.dropCodeFocus();
    assert.equal(NN.takeCodeFocus(t + 1000), false);
    assert.equal(mem.has(NN.CODE_FOCUS_KEY), false);
    // sessionStorage gesperrt: im Arbeitsspeicher
    globalThis.sessionStorage = { getItem: () => { throw new Error("gesperrt"); }, setItem: () => { throw new Error("gesperrt"); }, removeItem: () => { throw new Error("gesperrt"); } };
    NN.wantCodeFocus(t);
    assert.equal(NN.takeCodeFocus(t + 1000), true);
    assert.equal(NN.takeCodeFocus(t + 1000), false);
  } finally { delete globalThis.sessionStorage; }
});

test("Quelltext: newernote.js baut nur über DOM-APIs; CSS – Knopf ≥ 44px, weiß auf Rot mit Fokusring, kein Abstand ohne Hinweis", () => {
  const src = readFileSync(new URL("../../public/newernote.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src));
  const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");
  const rule = (sel) => { const m = new RegExp("\\n" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + " \\{([^}]*)\\}").exec(css); return m ? m[1] : null; };
  assert.match(rule(".newer-note .btn.newer-go"), /min-height: 44px/);
  assert.match(rule(".newer-note .btn.newer-go"), /background: #fff;.*color: #13213b/);
  assert.match(rule(".newer-note .btn.newer-go:focus-visible"), /outline: 3px solid #fff/);
  assert.match(rule(".newer-note"), /margin: 0 0 1\.15rem/);
  assert.equal(rule(".newer-slot"), null, "der leere Platz hat keine eigene Größe");
  assert.match(css, /\n\.alarm \{[^}]*background: var\(--rot\); color: #fff;/, "dieselbe rote Fläche wie der Hinweis der Notfall-Feibeitsblätter");
});

/* ---------- Einbindung in public/app.js (Quelltext) ---------- */
test("app.js: Hinweis direkt unter dem Kopfband (vor Vertretung, Live-Fenster und Selbstlern-Ansicht), aktualisiert ohne Neuladen; Code-Eingabe mit festem Text und Fokus", () => {
  const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
  const room = app.slice(app.indexOf("async function studentRoom("), app.indexOf("/* Zeile einer Datei im Material"));
  const iHead = room.indexOf("main.append(pageHead({ fach: d.lesson.subject"), iBox = room.indexOf("main.append(newerBox.el);"), iSub = room.indexOf("if (d.substitute && !selbst)");
  assert.ok(iHead > 0 && iBox > iHead && iSub > iBox, "Reihenfolge: Kopfband → Hinweis → Vertretung …");
  assert.ok(room.indexOf("slv = SV.selbstlernView(") > iBox && room.indexOf("main.append(live, presRow, kiBox, hwBox);") > iBox, "… vor Selbstlern-Ansicht und Live-Fenster");
  assert.ok(room.includes("const newerBox = newerNote({ onGo: () => wantCodeFocus() });") && room.includes("newerBox.set(d.newer);"));
  // Neuladen der Daten (geplanter Beginn in changesAt, Aufwachen): der Hinweis folgt
  assert.ok(room.includes("loadedAt = Date.now(); newerBox.set(r.newer); soon = r.newerSoon === true;"));
  assert.ok(room.includes("Date.now() - loadedAt >= NEWER_RECHECK_MS) refresh(); else if (soon) plan();"), "beim Aufwachen höchstens einmal je Minute neu fragen, sonst die Abfrage wieder einplanen");
  // Gegenprüfung: bald (newerSoon) fragt die sichtbare Seite jede Minute – auch ohne Aufwachen; nach dem Verlassen plant eine späte Antwort nichts mehr ein
  assert.ok(room.includes("let soon = d.newerSoon === true, gone = false;"));
  assert.ok(room.includes('const poll = soon && document.visibilityState === "visible" ? loadedAt + offset + NEWER_RECHECK_MS : Infinity;')
    && room.includes("const next = Math.min(...pending, poll);"));
  assert.ok(room.includes("if (gone) return;") && room.includes("onLeave(() => { gone = true; clearTimeout(chT);"));
  assert.ok(room.includes("if (soon && !gone) { clearTimeout(chT); chT = setTimeout(refresh, NEWER_RECHECK_MS); }"), "gescheiterte Abfrage: in einer Minute noch einmal");
  // zurück in eine Sitzung: der Wunsch „Fokus in die Code-Eingabe“ gilt nicht mehr
  assert.ok(/async function studentRoom\(lessonId\) \{\n  dropCodeFocus\(\);/.test(app));
  // der Satz der Live-Abfrage und die Nachricht des WebSockets bleiben unverändert (timerpoll.test.mjs) – keine neue Nachrichtenart
  assert.ok(!/t: "newer"|t === "newer"/.test(app));
  const home = app.slice(app.indexOf("async function studentHome("), app.indexOf("/* ---------- Sitzungsraum der Schüler:innen"));
  assert.ok(home.includes('"aria-describedby": "code-h"') && home.includes('h("p", { class: "hint", id: "code-h", text: CODE_WHERE_TEXT })'), "fester Text unter dem Feld, mit dem Feld verbunden");
  // der Wunsch „Fokus in die Code-Eingabe“ gilt bis zum nächsten Zeichnen des Formulars (auch über Anmeldung bzw. Wahl von Fach und Klasse hinweg)
  const iWant = home.indexOf("const focusCode = takeCodeFocus();");
  assert.ok(!app.includes("codeFocusWanted"), "kein Merker mehr nur im Arbeitsspeicher von app.js");
  assert.ok(iWant > home.indexOf("chooser(profile,") && iWant < home.indexOf('const code = h("input", { id: "code"'), "erst, wenn das Formular gezeichnet wird");
  assert.ok(home.includes("if (!lessons.length || focusCode) setTimeout(() => code.focus(), 50);"));
  assert.ok(home.includes('h("label", { for: "code" }, "Sitzungscode deiner Lehrkraft")') && home.includes('"Sitzung öffnen"'), "Feld, Beschriftung und Knopf wie bisher");
});
