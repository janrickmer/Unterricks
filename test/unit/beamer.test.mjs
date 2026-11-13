// Beamer über ein zweites Gerät (Nachtrag 15): Beamer-Code, Kopplung und Schlüssel (worker/beamer.js mit D1 auf SQLite), Rolle „beamer“ im
// Durable Object (worker/live.js mit einer Nachbildung von ctx, WebSocketPair und der Antwort 101) und die reinen Helfer in public/shared.js.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
// Durable Object aus „cloudflare:workers“: Attrappe, die ctx und env übernimmt (wie die echte Basisklasse)
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript," + encodeURIComponent("export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"), shortCircuit: true } : n(s, c); }'));

class FakeWs {
  constructor() { this.sent = []; this.closed = null; }
  send(m) { if (this.closed) throw new Error("geschlossen"); this.sent.push(m); }
  close(code, reason) { if (!this.closed) this.closed = { code, reason }; }
  msgs() { return this.sent.filter((x) => x !== "pong").map((x) => JSON.parse(x)); }
  last() { const m = this.msgs(); return m[m.length - 1]; }
}
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeWs(); this[1] = new FakeWs(); } };
globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.a = a; this.b = b; } };
const NativeResponse = globalThis.Response;
globalThis.Response = class extends NativeResponse {   // Node kennt keine Antwort 101 mit webSocket (Cloudflare schon)
  constructor(body, init) {
    if (init && init.status === 101) { super(null, { status: 200 }); Object.defineProperty(this, "status", { value: 101 }); this.webSocket = init.webSocket; }
    else super(body, init);
  }
};

const { fakeCtx } = await import("./fake-d1.mjs");
const { LiveRoom } = await import("../../worker/live.js");
const BM = await import("../../worker/beamer.js");
const { routeLiveSocket } = await import("../../worker/live.js");
const { liveNext, LIVE_IDLE, liveReduce } = await import("../../worker/livestate.js");
const { sha256Hex, hitLimit } = await import("../../worker/lib.js");
const { normBeamerCode, fmtBeamerCode, readBeamerLink, nextSlideOf } = await import("../../public/shared.js");
const { BEAMER_PAIR_TTL_MS, BEAMER_PAIR_KEEP_MS, cleanupStatements } = await import("../../worker/db.js");

/* ctx des Durable Objects: Speicher, Verbindungen mit Tags; webSocketClose entfernt sie (wie die Laufzeit), ws.close allein nicht */
function roomCtx() {
  const data = new Map(), socks = [];
  return { socks, data,
    storage: { get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : undefined), put: async (k, v) => { data.set(k, structuredClone(v)); } },
    acceptWebSocket(ws, tags) { socks.push({ ws, tags, gone: false }); },
    getWebSockets(tag) { return socks.filter((s) => !s.gone && (!tag || s.tags.includes(tag))).map((s) => s.ws); },
    getTags(ws) { const s = socks.find((x) => x.ws === ws); return s ? s.tags : []; },
    setWebSocketAutoResponse() {} };
}
const UP = { headers: { Upgrade: "websocket" } };
async function join(room, role, gen) {
  const res = await room.fetch(new Request("https://live/ws?role=" + role + (gen !== undefined ? "&gen=" + gen : ""), UP));
  if (res.status !== 101) return { status: res.status };
  const server = room.ctx.socks[room.ctx.socks.length - 1].ws;
  return { status: 101, ws: server };
}
const drop = async (room, ws) => { const s = room.ctx.socks.find((x) => x.ws === ws); s.gone = true; await room.webSocketClose(ws, 1000, ""); };
const FILE = "0123456789abcdef", LESSON = "aaaaaaaaaaaaaaaa";
const startMsg = (extra = {}) => ({ t: "start", fileId: FILE, pages: 4, slide: 0, code: "K7QM4X", title: "Gewaltenteilung", codeSlides: [{ n: 3, lines: ["Bearbeitet die Aufgaben."] }], ...extra });

test("Beamer-Code: 6 Ziffern, Anzeige „482 913“, Eingabe mit Leerzeichen und Bindestrichen", () => {
  assert.equal(normBeamerCode("482 913"), "482913"); assert.equal(normBeamerCode(" 482-913 "), "482913"); assert.equal(normBeamerCode("482.913"), "482913");
  assert.equal(normBeamerCode("012345"), "012345", "führende Null bleibt");
  for (const x of ["48291", "4829134", "48a913", "", null, undefined, 482913, "４８２９１３"]) assert.equal(normBeamerCode(x), typeof x === "number" ? "482913" : null, String(x));
  assert.equal(fmtBeamerCode("482913"), "482 913"); assert.equal(fmtBeamerCode("012345"), "012 345");
});

test("Beamer-Code: Zufall ohne Modulo-Verzerrung (Werte über dem größten Vielfachen von 10^6 werden verworfen)", () => {
  const lim = Math.floor(2 ** 32 / 1e6) * 1e6, seq = [2 ** 32 - 1, lim, lim - 1];
  assert.equal(BM.pairCode(() => seq.shift()), String((lim - 1) % 1e6).padStart(6, "0"));
  assert.equal(BM.pairCode(() => 7), "000007");
  const seen = new Set(); for (let i = 0; i < 200; i++) { const c = BM.pairCode(); assert.match(c, /^\d{6}$/); seen.add(c); }
  assert.ok(seen.size > 190, "echte Zufallswerte");
});

test("Beamer-Schlüssel: signiert mit Sitzung und Generation, 6 Stunden gültig", async () => {
  const now = 1_800_000_000_000, sec = "nur-test-geheimnis";
  const k = await BM.beamerKey(sec, LESSON, 3, now);
  assert.equal(k.exp, now + 6 * 3600e3); assert.match(k.key, /^3\.\d+\.[A-Za-z0-9_-]+$/);
  assert.equal(await BM.checkBeamerKey(sec, LESSON, k.key, now + 1000), 3);
  assert.equal(await BM.checkBeamerKey(sec, "bbbbbbbbbbbbbbbb", k.key, now), null, "andere Sitzung");
  assert.equal(await BM.checkBeamerKey(sec, LESSON, k.key.replace(/^3\./, "4."), now), null, "Generation verändert");
  assert.equal(await BM.checkBeamerKey(sec, LESSON, k.key, now + 6 * 3600e3 + 1), null, "abgelaufen");
  assert.equal(await BM.checkBeamerKey("anderes-geheimnis", LESSON, k.key, now), null);
  for (const bad of [null, 5, "", "x.y.z", k.key + "!"]) assert.equal(await BM.checkBeamerKey(sec, LESSON, bad, now), null, String(bad));
  // gespeicherte Kopplung im Browser
  assert.deepEqual(readBeamerLink(JSON.stringify({ lessonId: LESSON, ...k, extra: 1 }), now), { lessonId: LESSON, key: k.key, exp: k.exp });
  assert.equal(readBeamerLink(JSON.stringify({ lessonId: LESSON, ...k }), k.exp), null, "abgelaufen");
  for (const bad of ["{", "null", JSON.stringify({ lessonId: "x", ...k }), JSON.stringify({ lessonId: LESSON, key: "<b>", exp: k.exp }), null])
    assert.equal(readBeamerLink(bad, now), null);
});

test("nächste Folie zum Vorladen: wie die Vorschau der Lehrkraft, nur Folienbilder", () => {
  const st = { ...LIVE_IDLE };
  assert.equal(liveNext(st), null, "nichts läuft");
  liveReduce(st, startMsg(), 1);
  assert.equal(liveNext(st), 1, "Codefolie → Folie 1");
  liveReduce(st, { t: "goto", slide: 2 }, 2);
  assert.equal(liveNext(st), null, "Folie 3 ist eine Codefolie (kein Bild)");
  liveReduce(st, { t: "goto", slide: 3 }, 3); assert.equal(liveNext(st), 4);
  liveReduce(st, { t: "goto", slide: 4 }, 4); assert.equal(liveNext(st), null, "letzte Folie");
  liveReduce(st, { t: "goto", slide: 1 }, 5); liveReduce(st, { t: "code", on: true }, 6);
  assert.equal(liveNext(st), 1, "„Sitzungscode zeigen“: die Folie darunter");
  // dieselbe Regel wie im Präsentationsmodus
  for (const cur of [0, 1, 2, 3, 4]) {
    const s2 = { ...st, slide: cur, codeShown: false }, x = nextSlideOf({ cur, n: 4, holders: [3], withCode: true });
    assert.equal(liveNext(s2), x.end || x.code ? null : x.k, "Folie " + cur);
  }
  const noCode = { ...LIVE_IDLE }; liveReduce(noCode, startMsg({ code: undefined, slide: 2 }), 1);
  assert.equal(liveNext(noCode), 3, "ohne Sitzungscode gibt es keine Platzhalter – Folie 3 als Bild");
});

test("Durable Object: Beamer zählen nicht als Schüler:innen, bekommen die nächste Folie, steuern nichts; Trennen schließt sie (4001)", async () => {
  const room = new LiveRoom(roomCtx(), { SETTINGS_SECRET: "nur-test-geheimnis" });
  const t = await join(room, "teacher"), s = await join(room, "student");
  assert.equal(t.status, 101); assert.equal(s.status, 101);
  assert.equal((await join(room, "beamer", 1)).status, 403, "falsche Generation");
  assert.equal((await join(room, "beamer")).status, 403, "ohne Generation");
  const b = await join(room, "beamer", 0);
  assert.equal(b.status, 101);
  assert.deepEqual(t.ws.last(), { t: "count", students: 1, beamers: 1 }, "die Lehrkraft sieht die Zahl der Beamer getrennt");
  await room.webSocketMessage(t.ws, JSON.stringify(startMsg()));
  const tm = t.ws.last(), bm = b.ws.last(), sm = s.ws.last();
  assert.equal(tm.students, 1); assert.equal(tm.beamers, 1);
  assert.equal(bm.view, "code"); assert.equal(bm.code, "K7QM4X"); assert.match(bm.next, /^\/api\/slide\/0123456789abcdef\/1\?e=\d+&s=/, "Beamer: Folie 1 vorladen");
  assert.equal(sm.next, undefined, "Schüler:innen bekommen die nächste Folie nie");
  assert.deepEqual(Object.keys(sm).sort(), Object.keys(bm).filter((k) => k !== "next").sort(), "sonst dieselbe Nachricht wie die Schüler:innen");
  assert.equal(bm.students, undefined); assert.equal(bm.beamers, undefined);
  await room.webSocketMessage(t.ws, JSON.stringify({ t: "goto", slide: 2 }));
  assert.match(b.ws.last().url, /\/2\?/); assert.equal(b.ws.last().next, undefined, "nächste ist eine Codefolie: kein Bild");
  // Beamer können nichts steuern
  const v = b.ws.last().v;
  await room.webSocketMessage(b.ws, JSON.stringify({ t: "goto", slide: 4 }));
  await room.webSocketMessage(b.ws, JSON.stringify({ t: "stop" }));
  assert.equal(b.ws.last().v, v); assert.equal((await room.state()).slide, 2);
  // Stand per HTTP (Rückfall) nur mit der aktuellen Generation
  assert.equal((await room.fetch(new Request("https://live/state?role=beamer&gen=5"))).status, 403);
  const polled = await (await room.fetch(new Request("https://live/state?role=beamer&gen=0"))).json();
  assert.equal(polled.slide, 2); assert.equal(polled.students, undefined);
  assert.deepEqual(await (await room.fetch(new Request("https://live/beamer-gen"))).json(), { gen: 0 });
  // „Beamer trennen“: neue Generation, Verbindungen mit 4001 geschlossen, die Lehrkraft sieht 0 Beamer
  const b2 = await join(room, "beamer", 0);
  assert.deepEqual(t.ws.last(), { t: "count", students: 1, beamers: 2 });
  await room.fetch(new Request("https://live/beamer-reset", { method: "POST" }));
  assert.deepEqual([b.ws.closed, b2.ws.closed], [{ code: 4001, reason: "getrennt" }, { code: 4001, reason: "getrennt" }]);
  assert.deepEqual(t.ws.last(), { t: "count", students: 1, beamers: 0 }, "noch nicht abgemeldete Verbindungen zählen nicht mehr");
  assert.deepEqual(await (await room.fetch(new Request("https://live/beamer-gen"))).json(), { gen: 1 });
  assert.equal((await join(room, "beamer", 0)).status, 403, "alter Schlüssel abgelehnt");
  assert.equal(s.ws.closed, null, "Schüler:innen bleiben verbunden");
  await drop(room, b.ws); await drop(room, b2.ws);
  assert.deepEqual(t.ws.last(), { t: "count", students: 1, beamers: 0 });
  // Beenden für alle: Beamer bleiben mit der Sitzung verbunden (sie zeigen „beendet“ und einen neuen Code)
  const b3 = await join(room, "beamer", 1);
  await room.webSocketMessage(t.ws, JSON.stringify({ t: "stop" }));
  assert.equal(b3.ws.last().active, false); assert.equal(b3.ws.closed, null);
  await room.fetch(new Request("https://live/reset", { method: "POST" }));
  assert.equal(b3.ws.closed, null, "Präsentation gelöscht: Beamer bleiben");
  await room.fetch(new Request("https://live/reset?beamers=1", { method: "POST" }));
  assert.equal(b3.ws.closed.code, 4001, "Sitzung gelöscht: auch die Beamer getrennt");
  // Schüler:in geht: die Zahl der Beamer bleibt in der Nachricht
  await drop(room, b3.ws); await drop(room, s.ws);
  assert.deepEqual(t.ws.last(), { t: "count", students: 0, beamers: 0 });
});

/* ---------- Routen mit D1 (SQLite) und Durable Objects (je Sitzung eine LiveRoom) ---------- */
const TOKEN = "lehrkraft-token-beamer", SECRET = "nur-test-geheimnis-beamer";
async function setup(now = 1_800_000_000_000) {
  const c = fakeCtx({ SETTINGS_SECRET: SECRET });
  c.now = now; c.ip = "203.0.113.7";
  const rooms = new Map();
  c.env.LIVE = { idFromName: (n) => n, get: (id) => {
    if (!rooms.has(id)) rooms.set(id, new LiveRoom(roomCtx(), c.env));
    const room = rooms.get(id);
    return { fetch: (u, init) => room.fetch(typeof u === "string" ? new Request(u, init) : u) };
  } };
  c.rooms = rooms;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), now, now + 3600e3).run();
  for (const [id, subject, klass, code] of [[LESSON, "powi", "Q2-GK", "K7QM4X"], ["cccccccccccccccc", "gs", "gs1a2b3c4d", "G7QM4X"], ["dddddddddddddddd", "ethik", "8-K", "E7QM4X"]])
    await c.db.prepare("INSERT INTO lessons(id, subject, klass, title, code, created_at, updated_at) VALUES(?1, ?2, ?3, 'Stunde', ?4, 1, 1)").bind(id, subject, klass, code).run();
  return c;
}
async function call(c, fn, path, body, { teacher = false, args = [] } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (teacher) headers.Authorization = "Bearer " + TOKEN;
  const req = new Request("https://unterricks.test" + path, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
  c.db.counter.n = 0;
  try { const res = await fn({ ...c, request: req, waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json(), d1: c.db.counter.n }; }
  catch (e) { if (!e.status) throw e; return { status: e.status, data: { code: e.code, error: e.message, ...e.extra }, d1: c.db.counter.n }; }
}
const pair = (c) => call(c, BM.routeBeamerPair, "/api/beamer/pair", {});
const poll = (c, p) => call(c, BM.routeBeamerPoll, "/api/beamer/pair/poll", { code: p.code, pairKey: p.pairKey });
const tpair = (c, code, lessonId = LESSON) => call(c, BM.routeTeacherBeamerPair, "/api/teacher/lessons/" + lessonId + "/beamer", { code }, { teacher: true, args: [lessonId] });

test("Kopplung: Code holen, Lehrkraft gibt ihn ein, das Gerät holt den Schlüssel genau einmal ab – je Anfrage höchstens 3 D1-Anweisungen", async () => {
  const c = await setup();
  const p = await pair(c);
  assert.equal(p.status, 200); assert.match(p.data.code, /^\d{6}$/); assert.match(p.data.pairKey, /^[a-f0-9]{32}$/);
  assert.equal(p.data.ttlMs, 10 * 60e3); assert.equal(p.data.expiresAt, c.now + 10 * 60e3);
  assert.equal(p.d1, 3, "Zähler je IP, abgelaufene Codes löschen, neuer Code");
  const row = await c.db.prepare("SELECT * FROM beamer_pairs WHERE code=?1").bind(p.data.code).first();
  assert.equal(row.key_hash, await sha256Hex("beamer-pair|v1|" + p.data.pairKey), "nur der Hash des geheimen Schlüssels");
  assert.ok(!JSON.stringify(row).includes(p.data.pairKey));
  let r = await poll(c, p.data);
  assert.deepEqual([r.status, r.data.paired, r.d1], [200, false, 1]);
  // falscher pairKey: 404 wie ein unbekannter Code
  r = await poll(c, { code: p.data.code, pairKey: "0".repeat(32) });
  assert.deepEqual([r.status, r.data.code], [404, "pair_gone"]);
  // Lehrkraft: Code mit Leerzeichen eingeben
  r = await tpair(c, p.data.code.slice(0, 3) + " " + p.data.code.slice(3));
  assert.deepEqual([r.status, r.data.ok], [200, true]); assert.ok(r.d1 <= 3, "Anmeldung, Sitzung, eine bedingte Anweisung: " + r.d1);
  r = await tpair(c, p.data.code);
  assert.deepEqual([r.status, r.data.code, r.data.error], [404, "beamer_code", "Diesen Beamer-Code gibt es nicht (mehr). Auf dem Beamer steht nach dem Neuladen ein neuer."], "schon gekoppelt");
  r = await poll(c, { code: p.data.code, pairKey: "f".repeat(32) });
  assert.equal(r.status, 404, "fremder pairKey bekommt die Kopplung nicht");
  r = await poll(c, p.data);
  assert.equal(r.status, 200); assert.equal(r.data.paired, true); assert.equal(r.data.lessonId, LESSON); assert.ok(r.d1 <= 2);
  assert.equal(await BM.checkBeamerKey(SECRET, LESSON, r.data.key, c.now), 0, "Schlüssel mit Generation 0"); assert.equal(r.data.exp, c.now + 6 * 3600e3);
  const key = r.data.key;
  r = await poll(c, p.data);
  assert.deepEqual([r.status, r.data.code], [404, "pair_gone"], "einmalige Abholung");
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM beamer_pairs").first()).n, 0);
  // Live-Ticket und Stand mit dem Schlüssel
  r = await call(c, BM.routeBeamerTicket, "/api/beamer/live-ticket", { lessonId: LESSON, key });
  assert.equal(r.status, 200); assert.equal(r.data.fach, "powi"); assert.match(r.data.url, /^\/api\/live\/aaaaaaaaaaaaaaaa\?r=beamer&u=0&e=\d+&s=/); assert.equal(r.d1, 1);
  const ws = await routeLiveSocket({ ...c, request: new Request("https://unterricks.test" + r.data.url, UP) }, LESSON);
  assert.equal(ws.status, 101, "WebSocket mit dem Ticket");
  const forged = r.data.url.replace("r=beamer", "r=student");
  await assert.rejects(routeLiveSocket({ ...c, request: new Request("https://unterricks.test" + forged, UP) }, LESSON), (e) => e.status === 403, "Ticket gilt nur für seine Rolle");
  r = await call(c, BM.routeBeamerLive, "/api/beamer/live", { lessonId: LESSON, key });
  assert.equal(r.status, 200); assert.equal(r.data.live.active, false); assert.equal(r.d1, 0, "Rückfall ohne D1");
  for (const body of [{ lessonId: LESSON, key: key.replace(/^0\./, "1.") }, { lessonId: "dddddddddddddddd", key }, { lessonId: LESSON }, {}]) {
    r = await call(c, BM.routeBeamerTicket, "/api/beamer/live-ticket", body);
    assert.deepEqual([r.status, r.data.code], [403, "beamer_gone"], JSON.stringify(body));
  }
  // „Beamer trennen“: der Schlüssel gilt nicht mehr
  r = await call(c, BM.routeTeacherBeamerDisconnect, "/api/teacher/lessons/" + LESSON + "/beamer/disconnect", undefined, { teacher: true, args: [LESSON] });
  assert.deepEqual([r.status, r.data.ok], [200, true]); assert.ok(r.d1 <= 1, "nur die Anmeldung");
  r = await call(c, BM.routeBeamerTicket, "/api/beamer/live-ticket", { lessonId: LESSON, key });
  assert.deepEqual([r.status, r.data.code], [403, "beamer_gone"]);
  r = await call(c, BM.routeBeamerLive, "/api/beamer/live", { lessonId: LESSON, key });
  assert.equal(r.status, 403);
  // Neu koppeln: Generation 1
  const p2 = await pair(c);
  await tpair(c, p2.data.code);
  r = await poll(c, p2.data);
  assert.equal(await BM.checkBeamerKey(SECRET, LESSON, r.data.key, c.now), 1);
  assert.equal((await call(c, BM.routeBeamerTicket, "/api/beamer/live-ticket", { lessonId: LESSON, key: r.data.key })).status, 200);
});

test("Kopplung: Ablauf nach 10 Minuten, Grundschule, falsche Eingaben, ohne Anmeldung, Trennen vor dem Abholen", async () => {
  const c = await setup();
  const p = await pair(c);
  c.now += 10 * 60e3 + 1;
  let r = await tpair(c, p.data.code);
  assert.deepEqual([r.status, r.data.code], [404, "beamer_code"], "nach 10 Minuten ungültig");
  r = await poll(c, p.data);
  assert.deepEqual([r.status, r.data.code], [404, "pair_gone"], "das Gerät holt dann einen neuen");
  // Grundschule hat keine Präsentation
  const p2 = await pair(c);
  r = await tpair(c, p2.data.code, "cccccccccccccccc");
  assert.equal(r.status, 400); assert.match(r.data.error, /Grundschule/);
  for (const code of ["12345", "abcdef", "", null, "1234567"]) {
    r = await tpair(c, code);
    assert.deepEqual([r.status, r.data.code], [400, "bad_code"], String(code));
  }
  r = await call(c, BM.routeTeacherBeamerPair, "/api/teacher/lessons/" + LESSON + "/beamer", { code: p2.data.code }, { args: [LESSON] });
  assert.equal(r.status, 401, "nur angemeldet");
  r = await tpair(c, p2.data.code, "eeeeeeeeeeeeeeee");
  assert.equal(r.status, 404, "unbekannte Sitzung");
  // gekoppelt, dann sofort getrennt: der abgeholte Schlüssel gilt nicht
  r = await tpair(c, p2.data.code);
  assert.equal(r.status, 200);
  await call(c, BM.routeTeacherBeamerDisconnect, "/api/teacher/lessons/" + LESSON + "/beamer/disconnect", undefined, { teacher: true, args: [LESSON] });
  r = await poll(c, p2.data);
  assert.equal(r.data.paired, true);
  assert.equal((await call(c, BM.routeBeamerTicket, "/api/beamer/live-ticket", { lessonId: LESSON, key: r.data.key })).status, 403);
  // eine Kopplung kurz vor dem Ablauf holt das Gerät noch ab (bis 12 Minuten nach dem Erzeugen), danach nicht mehr
  const p3 = await pair(c);
  c.now += 9 * 60e3; assert.equal((await tpair(c, p3.data.code)).status, 200);
  c.now += 2 * 60e3; assert.equal((await poll(c, p3.data)).data.paired, true);
  const p4 = await pair(c);
  c.now += 9 * 60e3; await tpair(c, p4.data.code);
  c.now += 3 * 60e3 + 1; assert.equal((await poll(c, p4.data)).status, 404);
  // Aufräumen: abgelaufene Codes verschwinden (beim nächsten Code bzw. im allgemeinen Aufräumen)
  assert.equal(BEAMER_PAIR_TTL_MS, 10 * 60e3); assert.equal(BEAMER_PAIR_KEEP_MS, 12 * 60e3);
  await c.db.batch(cleanupStatements(c.db, c.now + 13 * 60e3));
  assert.equal((await c.db.prepare("SELECT COUNT(*) AS n FROM beamer_pairs").first()).n, 0);
  // Poll mit beschädigten Daten
  for (const body of [{}, { code: "123456" }, { code: "x", pairKey: "0".repeat(32) }, { code: "123456", pairKey: "XYZ" }])
    assert.equal((await call(c, BM.routeBeamerPoll, "/api/beamer/pair/poll", body)).status, 404, JSON.stringify(body));
});

test("Beamer-Codes je IP begrenzt (Schulnetz: großzügig), andere IPs unberührt", async () => {
  const c = await setup();
  assert.ok(BM.PAIR_LIMIT.max >= 120, "mindestens 120 je Stunde");
  const rule = { max: 3, windowMs: 3600e3 };
  for (let i = 0; i < 3; i++) await hitLimit(c.db, "bp:ip:x", rule, c.now + i);
  await assert.rejects(hitLimit(c.db, "bp:ip:x", rule, c.now + 10, (ms) => "warten " + Math.round(ms / 60e3)), (e) => e.status === 429 && e.extra.retryAfter > 3500 && e.message === "warten 60");
  await hitLimit(c.db, "bp:ip:y", rule, c.now + 10);
  await hitLimit(c.db, "bp:ip:x", rule, c.now + 3600e3 + 1);   // neues Fenster
  // die Route zählt je IP (gehasht, keine Klartext-IP)
  await pair(c);
  const rows = (await c.db.prepare("SELECT k FROM locks WHERE k LIKE 'bp:ip:%'").all()).results.map((x) => x.k);
  assert.ok(rows.some((k) => /^bp:ip:[a-f0-9]{64}$/.test(k)) && rows.every((k) => !k.includes("203.0.113.7")));
});
