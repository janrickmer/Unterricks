// Timer in der Live-Präsentation (Nachtrag 16 der Lehrkraft vom 13.11.2026): Zustand im Durable Object (worker/livestate.js – liveReduce mit
// {t:"timer"}, liveTimer), Nachrichten des LiveRoom mit der Restzeit zum Sendezeitpunkt (feste Uhr), die reinen Helfer in public/shared.js
// (timerText, timerAt, timerNote, normTimerMin, Taste T) und das Band (public/timerband.js) im Browser-Ersatz (fake-dom.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
// Durable Object aus „cloudflare:workers“: Attrappe, die ctx und env übernimmt (wie die echte Basisklasse)
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript," + encodeURIComponent("export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"), shortCircuit: true } : n(s, c); }'));

class FakeWs {
  constructor() { this.sent = []; this.closed = null; this.att = null; }
  serializeAttachment(v) { this.att = structuredClone(v); }
  deserializeAttachment() { return this.att === null ? null : structuredClone(this.att); }
  send(m) { if (this.closed) throw new Error("geschlossen"); this.sent.push(m); }
  close(code, reason) { if (!this.closed) this.closed = { code, reason }; }
  raw() { return this.sent.filter((x) => x !== "pong"); }
  last() { const m = this.raw(); return JSON.parse(m[m.length - 1]); }
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

const { LIVE_IDLE, liveReduce, liveTimer, timerReduce } = await import("../../worker/livestate.js");
const { LiveRoom } = await import("../../worker/live.js");
const S = await import("../../public/shared.js");
const { installDom } = await import("./fake-dom.mjs");
const D = installDom({ hash: "#/" });
const { timerBand } = await import("../../public/timerband.js");

const MIN = 60e3;
const FILE = "0123456789abcdef";
const fresh = () => ({ ...LIVE_IDLE });
const running = (now = 1000) => { const st = fresh(); liveReduce(st, { t: "start", fileId: FILE, pages: 3, slide: 1 }, now); return st; };
const T = (op, min) => (min === undefined ? { t: "timer", op } : { t: "timer", op, min });

test("Timer: Start (1–120 ganze Minuten) nur bei laufender Präsentation; v und updatedAt bleiben (das Folienbild lädt nicht neu)", () => {
  const idle = fresh();
  assert.equal(liveReduce(idle, T("start", 5), 0), false, "ohne Präsentation kein Timer");
  assert.equal(idle.timer, null);
  const st = running(1000), v = st.v, up = st.updatedAt;
  for (const min of [0, 121, 1.5, "5", null, undefined, -3, NaN]) assert.equal(liveReduce(st, T("start", min), 2000), false, "ungültig: " + String(min));
  assert.equal(st.timer, null);
  assert.equal(liveReduce(st, T("start", 5), 2000), true);
  assert.deepEqual(st.timer, { total: 5 * MIN, endsAt: 2000 + 5 * MIN, paused: false });
  assert.equal(st.v, v, "v bleibt"); assert.equal(st.updatedAt, up, "updatedAt bleibt");
  assert.equal(liveReduce(st, T("start", 120), 3000), true, "ein neuer Start ersetzt den laufenden");
  assert.equal(st.timer.total, 120 * MIN);
  for (const m of [{ t: "timer" }, T("hack"), T("add", 2), T("add", "1"), T("resume")]) assert.equal(liveReduce(st, m, 4000), false, JSON.stringify(m));
});

test("Timer: Pause und Weiter halten die Restzeit fest (Uhr des Servers)", () => {
  const st = running();
  liveReduce(st, T("start", 5), 0);
  assert.equal(liveReduce(st, T("pause"), 90e3), true);
  assert.deepEqual(st.timer, { total: 5 * MIN, left: 210e3, paused: true });
  assert.equal(liveReduce(st, T("pause"), 95e3), false, "schon pausiert");
  assert.deepEqual(liveTimer(st, 500e3), { left: 210e3, total: 5 * MIN, paused: true }, "pausiert zählt nichts herunter");
  assert.equal(liveReduce(st, T("resume"), 600e3), true);
  assert.deepEqual(st.timer, { total: 5 * MIN, endsAt: 810e3, paused: false });
  assert.deepEqual(liveTimer(st, 700e3), { left: 110e3, total: 5 * MIN, paused: false });
  assert.equal(liveReduce(st, T("pause"), 810e3), false, "abgelaufen lässt er sich nicht anhalten");
});

test("Timer: +1/+5 Min verlängern – laufend, pausiert, höchstens 180 Minuten insgesamt; nach Ablauf beginnt er mit dieser Zeit neu", () => {
  const st = running();
  liveReduce(st, T("start", 10), 0);
  assert.equal(liveReduce(st, T("add", 1), 60e3), true);
  assert.deepEqual(st.timer, { total: 11 * MIN, endsAt: 11 * MIN, paused: false });
  liveReduce(st, T("pause"), 2 * MIN);
  assert.equal(liveReduce(st, T("add", 5), 3 * MIN), true);
  assert.deepEqual(st.timer, { total: 16 * MIN, left: 14 * MIN, paused: true }, "pausiert: Restzeit und Gesamtzeit wachsen");
  // Grenze 180 Minuten
  liveReduce(st, T("start", 120), 0);
  for (let i = 0; i < 12; i++) assert.equal(liveReduce(st, T("add", 5), 1000), true, "Verlängerung " + (i + 1));
  assert.equal(st.timer.total, 180 * MIN);
  assert.equal(liveReduce(st, T("add", 1), 1000), false, "mehr als 180 Minuten nicht");
  liveReduce(st, T("start", 118), 0); liveReduce(st, T("add", 5), 0); liveReduce(st, T("add", 5), 0); liveReduce(st, T("add", 5), 0); liveReduce(st, T("add", 5), 0);
  assert.equal(st.timer.total, 138 * MIN);
  liveReduce(st, T("start", 120), 0);
  for (let i = 0; i < 11; i++) liveReduce(st, T("add", 5), 0);   // 175
  assert.equal(liveReduce(st, T("add", 5), 0), true);
  assert.equal(st.timer.total, 180 * MIN, "+5 bei 175 Minuten: gekappt auf 180");
  // nach Ablauf: „+1 Min“ = noch eine Minute
  liveReduce(st, T("start", 2), 0);
  assert.deepEqual(liveTimer(st, 5 * MIN), { left: 0, total: 2 * MIN, paused: false }, "abgelaufen: left 0, bleibt stehen");
  assert.equal(liveReduce(st, T("add", 1), 5 * MIN), true);
  assert.deepEqual(st.timer, { total: MIN, endsAt: 6 * MIN, paused: false });
});

test("Timer: beenden; „Präsentation für alle beenden“ löscht ihn, Folienwechsel, Codefolie und Wiederöffnen lassen ihn stehen", () => {
  const st = running();
  liveReduce(st, { t: "start", fileId: FILE, pages: 3, slide: 0, code: "K7QM4X", title: "X" }, 0);
  liveReduce(st, T("start", 5), 0);
  const t0 = structuredClone(st.timer);
  liveReduce(st, { t: "goto", slide: 2 }, 1000);
  liveReduce(st, { t: "code", on: true }, 2000);
  liveReduce(st, { t: "start", fileId: FILE, pages: 3, slide: 0, resume: true, code: "K7QM4X", title: "X" }, 3000);
  liveReduce(st, { t: "start", fileId: FILE, pages: 3, slide: 1, code: "K7QM4X", title: "X" }, 4000);   // Wiederverbindung der Lehrkraft
  assert.deepEqual(st.timer, t0);
  assert.equal(liveReduce(st, T("stop"), 5000), true);
  assert.equal(st.timer, null);
  assert.equal(liveReduce(st, T("stop"), 5000), false, "schon beendet: keine Nachricht");
  liveReduce(st, T("start", 5), 6000);
  const v = st.v;
  assert.equal(liveReduce(st, { t: "stop" }, 7000), true);
  assert.equal(st.timer, null, "Präsentation beendet: Timer weg");
  assert.equal(st.v, v + 1);
  assert.equal(liveTimer(st, 7000), null);
});

test("Timer: liveTimer berechnet die Restzeit beim Senden, nie negativ; beschädigte Stände gelten als kein Timer", () => {
  const st = running();
  assert.equal(liveTimer(st, 0), null);
  liveReduce(st, T("start", 3), 10e3);
  assert.deepEqual(liveTimer(st, 10e3), { left: 3 * MIN, total: 3 * MIN, paused: false });
  assert.deepEqual(liveTimer(st, 70e3 + 0.4), { left: 120e3, total: 3 * MIN, paused: false });
  assert.deepEqual(liveTimer(st, 999e3), { left: 0, total: 3 * MIN, paused: false });
  assert.deepEqual(liveTimer(st, 0), { left: 3 * MIN, total: 3 * MIN, paused: false }, "Server-Uhr zurück: höchstens die Gesamtzeit");
  st.active = false;
  assert.equal(liveTimer(st, 20e3), null, "ohne Präsentation kein Timer");
  for (const bad of [{ total: "x", endsAt: 1 }, { total: 5, paused: true, left: 0 }, { total: -1, endsAt: 5 }, { total: 5 }, "kaputt", 7]) {
    const s2 = { ...running(), timer: bad };
    assert.equal(liveTimer(s2, 0), null, JSON.stringify(bad));
    assert.equal(timerReduce(s2, T("pause"), 0), false);
  }
});

/* ---------- Durable Object: Nachrichten ---------- */
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
async function join(room, role) {
  const q = role === "beamer" ? "&gen=0&exp=4000000000000" : "";
  const res = await room.fetch(new Request("https://live/ws?role=" + role + q, UP));
  assert.equal(res.status, 101);
  return room.ctx.socks[room.ctx.socks.length - 1].ws;
}

test("Durable Object: alle bekommen timer {left, total, paused} mit der Restzeit nach der Uhr des Servers; ohne Timer bleibt die Nachricht wie bisher", async (t) => {
  let clock = 1_000_000;
  t.mock.method(Date, "now", () => clock);
  const room = new LiveRoom(roomCtx(), { SETTINGS_SECRET: "geheim-fuer-tests-1234567890" });
  const teacher = await join(room, "teacher"), student = await join(room, "student"), beamer = await join(room, "beamer");
  await room.webSocketMessage(teacher, JSON.stringify({ t: "start", fileId: FILE, pages: 3, slide: 1 }));
  const before = student.last();
  assert.equal("timer" in before, false, "ohne Timer kein Feld");
  const keys = Object.keys(before).sort();
  await room.webSocketMessage(student, JSON.stringify(T("start", 5)));
  assert.equal(student.raw().length, 2, "Schüler:innen steuern keinen Timer");
  await room.webSocketMessage(teacher, JSON.stringify(T("start", 5)));
  for (const [ws, who] of [[student, "Schüler:in"], [beamer, "Beamer"], [teacher, "Lehrkraft"]])
    assert.deepEqual(ws.last().timer, { left: 5 * MIN, total: 5 * MIN, paused: false }, who);
  assert.equal(student.last().v, before.v, "v bleibt – die Seiten laden die Folie nicht neu");
  assert.deepEqual(Object.keys(student.last()).filter((k) => k !== "timer").sort(), keys, "sonst dieselben Felder");
  // Rückfall-Abfrage: die Restzeit zum Zeitpunkt der Abfrage
  clock += 61_500;
  const polled = await (await room.fetch(new Request("https://live/state?role=student"))).json();
  assert.deepEqual(polled.timer, { left: 5 * MIN - 61_500, total: 5 * MIN, paused: false });
  const n = student.raw().length;
  clock += 10_000;
  assert.equal(student.raw().length, n, "kein Senden im Sekundentakt");
  await room.webSocketMessage(teacher, JSON.stringify(T("pause")));
  assert.deepEqual(student.last().timer, { left: 5 * MIN - 71_500, total: 5 * MIN, paused: true });
  await room.webSocketMessage(teacher, JSON.stringify(T("pause")));
  assert.equal(student.raw().length, n + 1, "ungültig (schon pausiert): keine Nachricht");
  // ein Gerät, das sich später verbindet, bekommt den laufenden Timer gleich mit
  await room.webSocketMessage(teacher, JSON.stringify(T("resume")));
  clock += 5000;
  const late = await join(room, "student");
  assert.deepEqual(late.last().timer, { left: 5 * MIN - 71_500 - 5000, total: 5 * MIN, paused: false });
  await room.webSocketMessage(teacher, JSON.stringify(T("stop")));
  assert.equal("timer" in student.last(), false, "geschlossen: kein Feld mehr");
  await room.webSocketMessage(teacher, JSON.stringify(T("start", 2)));
  await room.webSocketMessage(teacher, JSON.stringify({ t: "stop" }));
  assert.equal(student.last().active, false);
  assert.equal("timer" in student.last(), false, "„Präsentation für alle beenden“ entfernt ihn überall");
  // ein älterer gespeicherter Stand ohne timer-Feld
  room.ctx.data.set("state", { active: true, fileId: FILE, pages: 3, slide: 1, v: 9 });
  const old = await (await room.fetch(new Request("https://live/state?role=student"))).json();
  assert.equal("timer" in old, false);
});

/* ---------- reine Helfer (public/shared.js) ---------- */
test("timerText/timerSpoken: angefangene Sekunden zählen, ab einer Stunde mit Stunden", () => {
  assert.equal(S.timerText(5 * MIN), "5:00");
  assert.equal(S.timerText(299_001), "5:00");
  assert.equal(S.timerText(252_000), "4:12");
  assert.equal(S.timerText(59_999), "1:00");
  assert.equal(S.timerText(1), "0:01");
  assert.equal(S.timerText(0), "0:00"); assert.equal(S.timerText(-5), "0:00"); assert.equal(S.timerText(NaN), "0:00");
  assert.equal(S.timerText(3_852_000), "1:04:12");
  assert.equal(S.timerText(180 * MIN), "3:00:00");
  assert.equal(S.timerSpoken(252_000), "4 Minuten 12 Sekunden");
  assert.equal(S.timerSpoken(MIN), "1 Minute");
  assert.equal(S.timerSpoken(61_000), "1 Minute 1 Sekunde");
  assert.equal(S.timerSpoken(3_900_000), "1 Stunde 5 Minuten");
  assert.equal(S.timerSpoken(0), "0 Sekunden");
});

test("cleanTimer/timerAt: fremde Daten geprüft; Phasen normal, letzte Minute, pausiert, abgelaufen", () => {
  for (const bad of [null, "x", {}, { left: 5, total: 0 }, { left: -1, total: 5 }, { left: 1, total: 181 * MIN }, { left: "a", total: 5 }])
    assert.equal(S.cleanTimer(bad), null, JSON.stringify(bad));
  assert.deepEqual(S.cleanTimer({ left: 9e9, total: 5 * MIN, paused: "ja", x: 1 }), { left: 5 * MIN, total: 5 * MIN, paused: false }, "left höchstens total, nur bekannte Felder");
  const t = { left: 5 * MIN, total: 5 * MIN, paused: false };
  assert.deepEqual(S.timerAt(t, 0), { left: 5 * MIN, total: 5 * MIN, paused: false, phase: "run", text: "Noch 5:00", clock: "5:00", share: 1 });
  assert.equal(S.timerAt(t, 239_000).phase, "run", "4 Sekunden vor der letzten Minute (1:01)");
  assert.equal(S.timerAt(t, 239_000).text, "Noch 1:01");
  const last = S.timerAt(t, 240_001);
  assert.equal(last.phase, "last"); assert.equal(last.text, "Noch 1:00");
  const over = S.timerAt(t, 300_000);
  assert.equal(over.phase, "over"); assert.equal(over.text, "Die Zeit ist um!"); assert.equal(over.share, 0); assert.equal(over.left, 0);
  assert.equal(S.timerAt(t, 9e9).text, S.TIMER_OVER, "bleibt abgelaufen");
  assert.equal(S.timerAt(t, -50).left, 5 * MIN, "negative Zeit zählt nicht");
  const p = S.timerAt({ left: 30_000, total: 5 * MIN, paused: true }, 99_000);
  assert.equal(p.phase, "paused"); assert.equal(p.text, "Pausiert – noch 0:30"); assert.equal(p.left, 30_000);
  assert.equal(S.timerAt({ left: 3_852_000, total: 120 * MIN, paused: false }).text, "Noch 1:04:12");
  assert.equal(S.timerAt(null), null);
});

test("timerNote: nur Start, „Noch 1 Minute“, Ablauf, Pause und Weiter – nie jede Sekunde", () => {
  const at = (left, total = 5 * MIN, paused = false) => S.timerAt({ left, total, paused });
  assert.equal(S.timerNote(null, at(5 * MIN)), "Timer: 5 Minuten");
  assert.equal(S.timerNote(null, at(MIN, MIN)), "Timer: 1 Minute");
  assert.equal(S.timerNote(null, at(252_000)), "Timer: noch 4 Minuten 12 Sekunden", "später verbunden");
  assert.equal(S.timerNote(null, at(252_000, 5 * MIN, true)), "Timer: noch 4 Minuten 12 Sekunden – pausiert");
  assert.equal(S.timerNote(at(250_000), at(249_000)), "", "eine Sekunde später: nichts");
  assert.equal(S.timerNote(at(61_000), at(60_000)), "Noch 1 Minute");
  assert.equal(S.timerNote(at(60_000), at(59_000)), "");
  assert.equal(S.timerNote(at(1000), at(0)), "Die Zeit ist um!");
  assert.equal(S.timerNote(at(0), at(0)), "");
  assert.equal(S.timerNote(null, at(0)), "Die Zeit ist um!");
  assert.equal(S.timerNote(at(100_000), at(100_000, 5 * MIN, true)), "Timer pausiert");
  assert.equal(S.timerNote(at(100_000, 5 * MIN, true), at(100_000)), "Timer läuft weiter");
  assert.equal(S.timerNote(at(0), at(MIN, MIN)), "Timer: 1 Minute", "nach Ablauf verlängert");
  assert.equal(S.timerNote(at(100_000), at(160_000, 6 * MIN)), "", "+1 Min: nichts");
  assert.equal(S.timerNote(at(100_000), at(10 * MIN, 10 * MIN)), "Timer: 10 Minuten", "neu gestartet über einen laufenden");
  assert.equal(S.timerNote(at(100_000), null), "");
});

test("normTimerMin: ganze Minuten 1–120 aus dem Feld; Taste T öffnet den Timer (nicht beim Gedrückthalten, nicht mit Strg)", () => {
  for (const [v, n] of [["5", 5], [" 7 ", 7], ["15 min", 15], ["20 Minuten", 20], ["1 Minute", 1], ["120", 120], [12, 12]]) assert.equal(S.normTimerMin(v), n, String(v));
  for (const v of ["0", "121", "5,5", "5.5", "", "x", "-3", null, undefined, "1000"]) assert.equal(S.normTimerMin(v), null, String(v));
  assert.equal(S.presenterKey({ key: "t" }), "timer");
  assert.equal(S.presenterKey({ key: "T" }), "timer");
  assert.equal(S.presenterKey({ key: "t", repeat: true }), null);
  assert.equal(S.presenterKey({ key: "t", ctrlKey: true }), null);
  assert.deepEqual(S.TIMER_PICKS, [1, 2, 3, 5, 10, 15, 20]);
  assert.equal(S.TIMER_MAX_MIN, 120); assert.equal(S.TIMER_TOTAL_MAX_MIN, 180);
});

/* ---------- das Band (public/timerband.js) ---------- */
test("Band: zeigt die Restzeit ab dem Empfang mit der Uhr der Seite, Klassen je Phase, ruhige Ansagen, Platz über der Folie (has-timer)", async () => {
  let now = 50_000;
  const host = document.createElement("section");
  const paints = [];
  const b = timerBand({ host, now: () => now, onPaint: (v) => paints.push(v && v.phase) });
  document.body.append(host); host.append(b.el, b.say);
  assert.equal(b.el.getAttribute("role"), "timer");
  assert.equal(b.say.getAttribute("aria-live"), "polite");
  assert.equal(b.el.hidden, true);
  b.set({ left: 5 * MIN, total: 5 * MIN, paused: false });
  assert.equal(b.el.hidden, false);
  assert.equal(b.el.textContent, "Noch 5:00");
  assert.equal(b.el.className, "tband tb-run");
  assert.ok(host.classList.contains("has-timer"));
  assert.equal(b.el.querySelector(".tb-fill").style.width, "100%");
  await D.sleep(80);
  assert.equal(b.say.textContent, "Timer: 5 Minuten");
  now += 240_500; b.set({ left: 5 * MIN - 240_000, total: 5 * MIN, paused: false }, now - 500);   // Nachricht mit Restzeit, eben angekommen
  assert.equal(b.el.className, "tband tb-last");
  assert.equal(b.el.textContent, "Noch 1:00");
  await D.sleep(80);
  assert.equal(b.say.textContent, "Noch 1 Minute");
  assert.deepEqual(b.snapshot(), { left: 59_500, total: 5 * MIN, paused: false }, "Stand jetzt fürs Beamerfenster");
  // Uhr des Geräts egal: nur der Abstand zum Empfang zählt
  now += 60_000; b.set({ left: 59_500, total: 5 * MIN, paused: false }, now - 60_000);
  assert.equal(b.el.className, "tband tb-over");
  assert.equal(b.el.textContent, "Die Zeit ist um!");
  await D.sleep(80);
  assert.equal(b.say.textContent, "Die Zeit ist um!");
  b.set({ left: 40_000, total: 5 * MIN, paused: true });
  assert.equal(b.el.className, "tband tb-paused");
  assert.equal(b.el.textContent, "Pausiert – noch 0:40");
  now += 1e6; b.set({ left: 40_000, total: 5 * MIN, paused: true }, now);
  assert.equal(b.el.textContent, "Pausiert – noch 0:40", "pausiert zählt nicht");
  b.set(null);
  assert.equal(b.el.hidden, true);
  assert.ok(!host.classList.contains("has-timer"));
  assert.equal(b.snapshot(), null);
  b.set({ left: "kaputt", total: 5 });
  assert.equal(b.el.hidden, true, "unbrauchbare Daten: kein Band");
  assert.ok(paints.includes("run") && paints.includes("last") && paints.includes("over") && paints.includes("paused") && paints.includes(null));
  b.stop();
  b.set({ left: MIN, total: MIN, paused: false });
  assert.equal(b.el.hidden, true, "nach stop() nichts mehr");
});

test("Band: zählt von selbst weiter (Zeitgeber zum nächsten Sekundenwechsel), nur solange er läuft", async () => {
  let now = 0;
  const b = timerBand({ now: () => now });
  b.set({ left: 3000, total: MIN, paused: false });
  assert.equal(b.el.textContent, "Noch 0:03");
  now = 1500; await D.sleep(1100);
  assert.equal(b.el.textContent, "Noch 0:02");
  b.set({ left: 3000, total: MIN, paused: true });
  now = 9000; await D.sleep(1100);
  assert.equal(b.el.textContent, "Pausiert – noch 0:03");
  b.stop();
});

/* ---------- Ruhezustand (Prüfung vom 13.11.2026): performance.now() zählt auf manchen Geräten (iPad, Mac) im Ruhezustand nicht weiter ---------- */
test("Band: nach einem Ruhezustand (Geräteuhr weiter als performance.now) ruft es onStale – höchstens alle 10 s, nicht pausiert, nicht bei set()", async () => {
  let p = 0, w = 1.7e12;
  const stale = [];
  const b = timerBand({ now: () => p, wall: () => w, onStale: () => stale.push(p) });
  // Restzeit immer kurz nach einem Sekundenwechsel: das Band zeichnet nach wenigen Millisekunden wieder (echte Zeitgeber)
  b.set({ left: 20_005, total: MIN, paused: false });
  p += 4; w += 4; await D.sleep(40);
  assert.deepEqual(stale, [], "beide Uhren gleich weiter: nichts");
  w -= 3600e3; await D.sleep(20);
  assert.deepEqual(stale, [], "Geräteuhr zurückgestellt: nichts");
  w += 3600e3 + 30_000; p += 1000; await D.sleep(40);
  assert.deepEqual(stale, [1004], "31 s nach der Geräteuhr, 1 s gezählt: Stand neu holen");
  w += 30_000; p += 1000; await D.sleep(40);
  assert.equal(stale.length, 1, "höchstens alle 10 s");
  p += 10_000; w += 10_000 + 30_000; await D.sleep(40);
  assert.equal(stale.length, 2);
  assert.equal(b.el.textContent, "Noch 0:09", "läuft weiter");
  w += 60_000; b.set({ left: 60_000, total: MIN, paused: false });
  assert.equal(stale.length, 2, "eine neue Nachricht gleicht ohnehin ab");
  b.set({ left: 30_000, total: MIN, paused: true }); w += 60_000; await D.sleep(40);
  assert.equal(stale.length, 2, "pausiert: nichts");
  b.stop();
  const c = timerBand({ now: () => p, wall: () => w });   // ohne onStale: kein Fehler
  c.set({ left: 2005, total: MIN, paused: false }); w += 99_000; p += 10; await D.sleep(40);
  assert.equal(c.el.hidden, false);
  c.stop();
});

test("Präsentationsfenster: wieder sichtbar bzw. nach einem Ruhezustand fragt es den Stand neu ab (hello) – der Timer stimmt danach wieder", async (t) => {
  const socks = [], saved = { WebSocket: globalThis.WebSocket, Image: globalThis.Image, fetch: globalThis.fetch };
  globalThis.WebSocket = class { constructor(u) { this.url = u; this.readyState = 0; this.sent = []; socks.push(this); } send(m) { this.sent.push(m); } close() { this.readyState = 3; } };
  globalThis.Image = class { set src(v) { this._s = v; } get src() { return this._s || ""; } };
  globalThis.fetch = async () => new NativeResponse(JSON.stringify({ ok: true, url: "/api/live/l1?r=teacher&u=t&e=1&s=x" }), { headers: { "Content-Type": "application/json" } });
  let pres = null;
  try {
    const { startPresenter } = await import("../../public/presenter.js");
    pres = await startPresenter({ lessonId: "l1", file: { id: FILE }, token: "t", slides: { urls: ["/f/1", "/f/2", "/f/3"], pages: 3 } });
    for (let i = 0; i < 50 && !socks.length; i++) await D.sleep(5);
    const ws = socks[socks.length - 1];
    ws.readyState = 1; ws.onopen();
    const sent = () => ws.sent.filter((m) => m !== "ping").map((m) => JSON.parse(m));
    const state = (left) => ws.onmessage({ data: JSON.stringify({ t: "state", active: true, slide: 1, pages: 3, v: 1, fileId: FILE, students: 0, beamers: 0, timer: { left, total: 5 * MIN, paused: false } }) });
    state(4 * MIN);
    const band = document.querySelector(".presenter .stage .tband");
    assert.equal(band.textContent, "Noch 4:00");
    const n = sent().length;
    document.visibilityState = "hidden"; D.fire(document, "visibilitychange");
    assert.equal(sent().length, n, "verdeckt: nichts");
    document.visibilityState = "visible"; D.fire(document, "visibilitychange");
    assert.deepEqual(sent().slice(n), [{ t: "hello" }], "wieder sichtbar: Stand neu anfordern");
    state(2 * MIN);
    assert.equal(band.textContent, "Noch 2:00", "die Antwort gleicht die Restzeit ab");
    // Ruhezustand ohne Sichtbarkeitswechsel: die Geräteuhr springt, performance.now() nicht
    const real = Date.now.bind(Date);
    t.mock.method(Date, "now", () => real() + 30_000);
    for (let i = 0; i < 30 && sent().length < n + 2; i++) await D.sleep(50);
    assert.deepEqual(sent().slice(n + 1), [{ t: "hello" }], "nach dem Ruhezustand: Stand neu anfordern");
    t.mock.restoreAll();
    ws.readyState = 3;
    D.fire(document, "visibilitychange");
    assert.equal(sent().length, n + 2, "Verbindung zu: kein hello (der Stand kommt mit der Wiederverbindung)");
    ws.readyState = 1;
    pres.end(false); pres = null;
    D.fire(document, "visibilitychange");
    assert.equal(sent().length, n + 2, "Präsentationsfenster geschlossen: nichts mehr");
  } finally {
    if (pres) pres.end(false);
    Object.assign(globalThis, saved);
  }
});
