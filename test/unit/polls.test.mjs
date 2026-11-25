// Nachtrag 46 (24.11.2026): anonyme Umfrage in der Live-Präsentation – Umfragefolie erkennen (public/polls.js), Zustand der Präsentation (worker/livestate.js),
// Zählung im Durable Object (worker/live.js: nur bei offener Folie, je Gerät einmal, Ende 2 Minuten nach der ersten Antwort, Ergebnis nach D1), Wege der
// Schüler:innen (worker/student.js) und der Lehrkraft (worker/files.js, worker/live.js), Präsentations-Prompt. Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript," + encodeURIComponent("export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"), shortCircuit: true } : n(s, c); }'));

class FakeWs {
  constructor() { this.sent = []; this.closed = null; this.att = null; }
  serializeAttachment(v) { this.att = structuredClone(v); }
  deserializeAttachment() { return this.att === null ? null : structuredClone(this.att); }
  send(m) { if (this.closed) throw new Error("geschlossen"); this.sent.push(m); }
  close(code, reason) { if (!this.closed) this.closed = { code, reason }; }
  msgs() { return this.sent.filter((x) => x !== "pong").map((x) => JSON.parse(x)); }
  last() { const m = this.msgs(); return m[m.length - 1]; }
}
globalThis.WebSocketPair = class { constructor() { this[0] = new FakeWs(); this[1] = new FakeWs(); } };
globalThis.WebSocketRequestResponsePair = class { constructor(a, b) { this.a = a; this.b = b; } };
const NativeResponse = globalThis.Response;
globalThis.Response = class extends NativeResponse {
  constructor(body, init) {
    if (init && init.status === 101) { super(null, { status: 200 }); Object.defineProperty(this, "status", { value: 101 }); this.webSocket = init.webSocket; }
    else super(body, init);
  }
};
// die Uhr des Durable Objects (Date.now) lässt sich stellen
const realNow = Date.now;
let CLOCK = 1_800_000_000_000;
Date.now = () => CLOCK;
test.after(() => { Date.now = realNow; });

const P = await import("../../public/polls.js");
const { LIVE_IDLE, liveReduce, livePoll, pollReduce } = await import("../../worker/livestate.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const { LiveRoom, routeTeacherPolls, routeTeacherPollReset } = await import("../../worker/live.js");
const { routeStudentLesson, routeStudentPollVote } = await import("../../worker/student.js");
const F = await import("../../worker/files.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { claudePresentationPrompt } = await import("../../public/shared.js");
const src = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");

const FILE = "0123456789abcdef", LESSON = "aaaaaaaaaaaaaaaa", SECRET = "nur-test-geheimnis-umfrage", TT = "lehrkraft-token-umfrage";
const Q = "Soll das Wahlalter bei Bundestagswahlen auf 16 Jahre sinken?", OPTS = ["Ja", "Nein", "Ich bin unentschieden"];
const SLIDES = [{ n: 2, q: Q, options: OPTS }, { n: 4, q: "Wie sicher fühlst du dich beim Thema?", options: ["sicher", "unsicher"] }];
const K2 = P.pollKey(FILE, 2), K4 = P.pollKey(FILE, 4);

/* ---------- Umfragefolie erkennen ---------- */
test("Unsichtbare Zeile: Frage und 2–6 Antworten, durch senkrechte Striche getrennt – auch gesperrt gesetzt, umbrochen und in Textstücken", () => {
  assert.equal(P.pollMarkLine({ q: Q, options: OPTS }), "Unterricks-Umfrage: " + Q + " | Ja | Nein | Ich bin unentschieden");
  assert.deepEqual(P.parsePollMark(P.pollMarkLine({ q: Q, options: OPTS })), { q: Q, options: OPTS });
  assert.deepEqual(P.parsePollMark("U n t e r r i c k s - U m f r a g e : Bist du dafür? ｜ „Ja“ ¦ Nein"), { q: "Bist du dafür?", options: ["Ja", "Nein"] });
  assert.equal(P.parsePollMark("Unterricks-Umfrage: Nur eine Antwort? | Ja"), null, "weniger als zwei Antworten");
  assert.equal(P.parsePollMark("Unterricks-Umfrage: | Ja | Nein"), null, "ohne Frage");
  assert.equal(P.parsePollMark("Umfrage: Ja | Nein"), null, "ohne die Marke");
  assert.equal(P.parsePollMark("Unterricks-Umfrage: Zu viele? | 1 | 2 | 3 | 4 | 5 | 6 | 7"), null, "mehr als sechs Antworten");
  assert.deepEqual(P.parsePollMark("Unterricks-Umfrage: Doppelt? | Ja | ja | Nein").options, ["Ja", "Nein"], "gleiche Antworten zählen einmal");
  // umbrochen: die nächste Zeile beginnt mit „|“ bzw. die Zeile endet damit
  assert.deepEqual(P.pollMarkOf(["Wahlalter 16?", "Unterricks-Umfrage: " + Q + " | Ja |", "Nein | Ich bin unentschieden", "Unterricks-Phase: 3"]), { q: Q, options: OPTS });
  assert.deepEqual(P.pollMarkOf([{ text: "Unterricks-Umfrage: " + Q }, { text: "| Ja | Nein" }, { text: "| Ich bin unentschieden" }]), { q: Q, options: OPTS });
  // Textstücke (PDF.js) tragen die ganze Zeile, die Zeilen nur einen Teil: es gilt der Kandidat mit den meisten Antworten
  assert.deepEqual(P.pollMarkOf(["Unterricks-Umfrage: " + Q + " | Ja | Nein"], [{ str: "Unterricks-Umfrage: " + Q + " | Ja | Nein | Ich bin unentschieden" }]), { q: Q, options: OPTS });
  assert.equal(P.pollMarkOf(["Stimme jetzt in Unterricks ab.", "Ja", "Nein"]), null, "eine Folie ohne Marke ist keine Umfragefolie");
  // endet die Zeile mit „|“, gehört eine folgende andere unsichtbare Zeile trotzdem nie zu den Antworten (Befund der Gegenprüfung)
  assert.deepEqual(P.pollMarkOf(["Unterricks-Umfrage: " + Q + " | Ja | Nein |", "Unterricks-Phase: 3"]), { q: Q, options: ["Ja", "Nein"] });
});

test("Umfragefolien einer Präsentation: geprüft, je Folie eine, sortiert; von der Lehrkraft streng (nichts fällt still weg); hand gilt vor der PDF", () => {
  assert.deepEqual(P.cleanPollSlides([{ n: 4, q: " A? ", options: ["x", "y"] }, { n: 2, q: Q, options: OPTS }, { n: 2, q: "doppelt", options: ["a", "b"] }, { n: 9, q: "zu weit", options: ["a", "b"] }, null], 5),
    [{ n: 2, q: Q, options: OPTS }, { n: 4, q: "A?", options: ["x", "y"] }]);
  assert.equal(P.cleanPollSlides([{ n: 2, q: Q, options: ["Ja", "ja"] }], 5, true), undefined, "streng: gleiche Antworten → ungültig");
  assert.equal(P.cleanPollSlides([{ n: 2, q: Q, options: ["Ja", "Nein", ""] }], 5, true), undefined, "streng: leere Antwort → ungültig");
  assert.equal(P.cleanPollSlides([{ n: 7, q: Q, options: OPTS }], 5, true), undefined);
  assert.deepEqual(P.cleanPollSlides([], 5, true), [], "bewusst keine");
  assert.equal(P.cleanPollSlides(Array.from({ length: P.POLL_LIMITS.slides + 1 }, (_, i) => ({ n: i + 1, q: "F?", options: ["a", "b"] })), 50, true), undefined, "zu viele");
  const d = P.pollSlidesData(JSON.stringify({ v: 1, pdf: SLIDES, hand: [] }), 5);
  assert.deepEqual(d, { pdf: SLIDES, hand: [] });
  assert.deepEqual(P.pollSlidesOf({ polls: d }), [], "[] der Lehrkraft = bewusst keine");
  assert.deepEqual(P.pollSlidesOf({ polls: { pdf: SLIDES, hand: null } }), SLIDES);
  assert.equal(P.pollSlidesStore({ pdf: null, hand: null }), null);
  assert.deepEqual(P.pollSlidesData("kaputt", 5), { pdf: null, hand: null });
});

/* ---------- Regeln der Abstimmung ---------- */
test("Eine Stimme: nur gültige Antwort, je Gerät einmal, nicht mehr 2 Minuten nach der ersten Antwort; gezählt wird nie, was ein Gerät gewählt hat", () => {
  const p = P.newPoll(K2, { n: 2, q: Q, options: OPTS }, LESSON), voters = [];
  assert.deepEqual(P.pollVote(p, voters, "geraet-a", 3, 1000), { error: "choice" });
  assert.deepEqual(P.pollVote(p, voters, "geraet-a", "0", 1000), { error: "choice" });
  assert.deepEqual(P.pollVote(p, voters, "geraet-a", 0, 1000), { ok: true });
  assert.equal(p.firstAt, 1000); assert.deepEqual(p.counts, [1, 0, 0]); assert.equal(p.total, 1);
  assert.deepEqual(P.pollVote(p, voters, "geraet-a", 1, 2000), { error: "voted" }, "dasselbe Gerät");
  assert.deepEqual(P.pollVote(p, voters, "geraet-b", 1, 1000 + P.POLL_RESULT_MS - 1), { ok: true }, "bis kurz vor dem Ende");
  assert.deepEqual(P.pollVote(p, voters, "geraet-c", 1, 1000 + P.POLL_RESULT_MS), { error: "closed" }, "genau 2 Minuten nach der ersten Antwort ist Schluss");
  assert.deepEqual(p.counts, [1, 1, 0]);
  assert.deepEqual(voters, ["geraet-a", "geraet-b"]);
  assert.ok(!JSON.stringify(p).includes("geraet"), "der Eintrag der Umfrage kennt keine Geräte");
  assert.equal(P.POLL_RESULT_MS, 120000);
});

test("Was jede Rolle bekommt: Schüler:innen nie Zahlen, der Beamer nur die Zahl der Antworten (die Verteilung erst nach „Ergebnis am Beamer zeigen“), die Lehrkraft alles", () => {
  const spec = { k: K2, n: 2, q: Q, options: OPTS }, p = { ...P.newPoll(K2, spec, LESSON), counts: [3, 1, 0], total: 4, firstAt: 1000 };
  assert.deepEqual(P.pollMessage("student", spec, p, false, 5000), { k: K2, n: 2, q: Q, options: OPTS, open: true });
  assert.deepEqual(P.pollMessage("student", spec, p, true, 5000), { k: K2, n: 2, q: Q, options: OPTS, open: true }, "auch nicht, wenn das Ergebnis am Beamer steht");
  assert.deepEqual(P.pollMessage("beamer", spec, p, false, 5000), { k: K2, n: 2, q: Q, options: OPTS, open: true, total: 4, shown: false });
  assert.deepEqual(P.pollMessage("beamer", spec, p, true, 5000).counts, [3, 1, 0]);
  const t = P.pollMessage("teacher", spec, p, false, 5000);
  assert.deepEqual(t.counts, [3, 1, 0]); assert.equal(t.left, 1000 + P.POLL_RESULT_MS - 5000);
  assert.equal(P.pollMessage("teacher", spec, null, false, 5000).left, null, "noch keine Antwort: die Uhr läuft nicht");
  assert.equal(P.pollMessage("student", spec, p, false, 1000 + P.POLL_RESULT_MS).open, false);
  assert.deepEqual(P.pollPercents([3, 1, 0]), [75, 25, 0]);
  assert.deepEqual(P.pollPercents([1, 1, 1]), [34, 33, 33], "zusammen genau 100");
  assert.deepEqual(P.pollPercents([0, 0]), [0, 0]);
  assert.equal(P.votesText(1), "1 Antwort"); assert.equal(P.votesText(12), "12 Antworten");
  assert.equal(P.fmtLeft(119001), "2:00"); assert.equal(P.fmtLeft(61000), "1:01"); assert.equal(P.fmtLeft(0), "0:00");
});

test("Ergebnisse in D1: eintragen bzw. ersetzen, entfernen (eine Umfrage bzw. alle einer Präsentation); die Schüler:innen bekommen keine Kennung der Datei", () => {
  const r1 = { k: K2, n: 2, q: Q, options: OPTS, counts: [3, 1, 0], total: 4, at: 5000 }, r2 = { k: K4, n: 4, q: "B?", options: ["a", "b"], counts: [0, 2], total: 2, at: 9000 };
  let raw = P.pollResultsPut(null, r1);
  raw = P.pollResultsPut(raw, r2);
  raw = P.pollResultsPut(raw, { ...r1, counts: [4, 1, 0], total: 5 });
  assert.deepEqual(P.pollResultsData(raw).map((x) => [x.k, x.total]), [[K2, 5], [K4, 2]]);
  const forS = P.pollResultsForStudents(raw);
  assert.deepEqual(forS[0], { id: "2-5000", q: Q, options: OPTS, counts: [4, 1, 0], total: 5 });
  assert.ok(!JSON.stringify(forS).includes(FILE));
  assert.deepEqual(P.pollResultsData(P.pollResultsDrop(raw, { k: K2 })).map((x) => x.k), [K4]);
  assert.equal(P.pollResultsDrop(raw, { fileId: FILE }), null);
  assert.deepEqual(P.pollResultsData(P.pollResultsDrop(raw, { fileId: "ffffffffffffffff" })).length, 2);
  assert.deepEqual(P.pollResultsData("kaputt"), []);
});

/* ---------- Zustand der Präsentation ---------- */
const start = (extra = {}) => ({ t: "start", fileId: FILE, pages: 5, slide: 1, code: "K7QM4X", title: "Wahlalter", codeSlides: [{ n: 3, lines: ["Bearbeitet das Material."] }], pollSlides: SLIDES, ...extra });
test("Live-Zustand: die Umfrage der aktuellen Folie – nur bei laufender Präsentation, nicht auf einer Codefolie und nicht unter „Sitzungscode zeigen“", () => {
  const st = { ...LIVE_IDLE };
  assert.equal(livePoll(st), null);
  liveReduce(st, start(), 1);
  assert.equal(livePoll(st), null, "Folie 1 hat keine Umfrage");
  liveReduce(st, { t: "goto", slide: 2 }, 2);
  assert.deepEqual(livePoll(st), { k: K2, n: 2, q: Q, options: OPTS });
  liveReduce(st, { t: "code", on: true }, 3);
  assert.equal(livePoll(st), null, "unter „Sitzungscode zeigen“ ist die Umfrage zu");
  liveReduce(st, { t: "code", on: false }, 4);
  assert.ok(livePoll(st));
  // „Ergebnis am Beamer zeigen“: nur auf einer Umfragefolie; v bleibt; der Folienwechsel blendet es aus
  const v = st.v;
  assert.equal(liveReduce(st, { t: "poll", op: "show", on: true }, 5), true);
  assert.equal(st.pollShown, 2); assert.equal(st.v, v, "v bleibt – das Folienbild lädt nicht neu");
  assert.equal(liveReduce(st, { t: "poll", op: "show", on: true }, 6), false, "unverändert");
  liveReduce(st, { t: "goto", slide: 1 }, 7);
  assert.equal(st.pollShown, null);
  assert.equal(pollReduce(st, { op: "show", on: true }), false, "ohne Umfrage auf der Folie");
  // eine Umfrage auf einer Platzhalterfolie (Codefolie) gilt nicht
  liveReduce(st, start({ pollSlides: [{ n: 3, q: "Auf der Codefolie?", options: ["a", "b"] }], slide: 3 }), 8);
  assert.equal(livePoll(st), null);
  // erneuter Start ohne pollSlides (ältere, gecachte Seite der Lehrkraft): die der laufenden Präsentation bleiben
  const st2 = { ...LIVE_IDLE };
  liveReduce(st2, start({ slide: 2 }), 1);
  const older = start({ slide: 2 }); delete older.pollSlides;
  liveReduce(st2, older, 2);
  assert.equal(st2.pollSlides.length, 2);
  liveReduce(st2, { t: "stop" }, 3);
  assert.deepEqual(st2.pollSlides, []); assert.equal(livePoll(st2), null);
});

/* ---------- Durable Object ---------- */
function roomCtx() {
  const data = new Map(), socks = [], alarms = [];
  const put = async (k, v) => { if (k && typeof k === "object") { for (const [a, b] of Object.entries(k)) data.set(a, structuredClone(b)); } else data.set(k, structuredClone(v)); };
  return { socks, data, alarms,
    storage: { get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : undefined), put, delete: async (k) => { for (const x of Array.isArray(k) ? k : [k]) data.delete(x); }, setAlarm: async (at) => { alarms.push(at); } },
    acceptWebSocket(ws, tags) { socks.push({ ws, tags, gone: false }); },
    getWebSockets(tag) { return socks.filter((s) => !s.gone && (!tag || s.tags.includes(tag))).map((s) => s.ws); },
    getTags(ws) { const s = socks.find((x) => x.ws === ws); return s ? s.tags : []; },
    setWebSocketAutoResponse() {} };
}
const UP = { headers: { Upgrade: "websocket" } };
async function join(room, role, extra = "") {
  const res = await room.fetch(new Request("https://live/ws?role=" + role + extra, UP));
  assert.equal(res.status, 101);
  return room.ctx.socks[room.ctx.socks.length - 1].ws;
}
const voteAt = async (room, k, choice, voter, lid = LESSON) => (await room.fetch(new Request("https://live/poll-vote?lid=" + lid, { method: "POST", body: JSON.stringify({ k, choice, voter }) }))).json();
const DEV = "dev00001", TOKEN = "schueler-token-umfrage";
async function setup({ now = CLOCK } = {}) {
  const c = fakeCtx({ SETTINGS_SECRET: SECRET }), db = c.db.raw;
  db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?, 'd', ?, ?, ?)").run(await sha256Hex(TT), now, now + 3600e3, now);
  db.prepare("INSERT INTO lessons(id, subject, klass, title, duration_min, lesson_date, start_time, code, student_ai, created_at, updated_at) VALUES(?, 'powi', 'Q2-GK', 'Wahlalter', 90, '2026-11-24', '08:00', 'K7QM4X', 0, 1, 1)").run(LESSON);
  for (const [id, tok] of [[DEV, TOKEN], ["dev00002", TOKEN + "-2"]]) {
    db.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, 'Q2-GK', 'powi', ?, ?, ?)").run(id, await sha256Hex(tok), now, now, now + 3600e3);
    db.prepare("INSERT INTO student_access(device_id, lesson_id, joined_at) VALUES(?, ?, ?)").run(id, LESSON, now - 60e3);
  }
  db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, pages, status, created_at, updated_at) VALUES(?, ?, 'presentation', 'file', 'Wahlalter.pdf', 'application/pdf', 1000, 5, 'ready', 1, 1)").run(FILE, LESSON);
  const rooms = new Map();
  c.env.LIVE = { idFromName: (n) => n, get: (id) => {
    if (!rooms.has(id)) rooms.set(id, new LiveRoom(roomCtx(), c.env));
    const room = rooms.get(id);
    return { fetch: (u, init) => room.fetch(typeof u === "string" ? new Request(u, init) : u) };
  } };
  c.env.FILES = { delete: async () => {}, put: async () => {} };
  const ctx = { ...c, now, ip: "1.2.3.4", waitUntil: () => {} };
  ctx.room = () => c.env.LIVE.get(LESSON) && rooms.get(LESSON);
  return ctx;
}
const polRow = (c) => c.db.raw.prepare("SELECT polls FROM lessons WHERE id=?").get(LESSON).polls;

test("Durable Object: abstimmen nur bei offener Umfragefolie und je Gerät einmal; Lehrkraft und Beamer bekommen jede Stimme, die Schüler:innen nicht", async () => {
  CLOCK = 1_800_000_000_000;
  const c = await setup(), room = c.room();
  const t = await join(room, "teacher", "&lid=" + LESSON), s = await join(room, "student"), b = await join(room, "beamer", "&gen=0&exp=4000000000000");
  await room.webSocketMessage(t, JSON.stringify(start()));
  assert.equal(s.last().poll, undefined, "Folie 1: keine Umfrage");
  assert.deepEqual(await voteAt(room, K2, 0, "pruefwert-geraet-eins-xxxxxxxx"), { ok: false, code: "not_open" }, "die Umfragefolie ist nicht offen");
  await room.webSocketMessage(t, JSON.stringify({ t: "goto", slide: 2 }));
  assert.deepEqual(s.last().poll, { k: K2, n: 2, q: Q, options: OPTS, open: true }, "Schüler:innen: Frage und Antworten, keine Zahlen");
  assert.deepEqual(b.last().poll, { k: K2, n: 2, q: Q, options: OPTS, open: true, total: 0, shown: false });
  assert.deepEqual(t.last().poll.counts, [0, 0, 0]); assert.equal(t.last().poll.left, null);
  const ns = s.msgs().length, nt = t.msgs().length;
  assert.deepEqual(await voteAt(room, K4, 0, "pruefwert-geraet-eins-xxxxxxxx"), { ok: false, code: "not_open" }, "eine andere Umfrage als die der gezeigten Folie");
  assert.deepEqual(await voteAt(room, K2, 7, "pruefwert-geraet-eins-xxxxxxxx"), { ok: false, code: "choice" });
  assert.deepEqual(await voteAt(room, K2, 0, "kurz"), { ok: false, code: "not_open" }, "ohne brauchbaren Prüfwert");
  assert.deepEqual(await voteAt(room, K2, 0, "pruefwert-geraet-eins-xxxxxxxx"), { ok: true });
  assert.equal(s.msgs().length, ns, "die Schüler:innen bekommen keine Nachricht je Stimme");
  assert.equal(t.msgs().length, nt + 1);
  assert.deepEqual(t.last().poll.counts, [1, 0, 0]); assert.equal(t.last().poll.left, P.POLL_RESULT_MS);
  assert.equal(b.last().poll.total, 1); assert.equal(b.last().poll.counts, undefined, "der Beamer nur die Zahl der Antworten");
  assert.deepEqual(room.ctx.alarms, [CLOCK + P.POLL_RESULT_MS], "Wecker auf das Ende");
  assert.deepEqual(await voteAt(room, K2, 1, "pruefwert-geraet-eins-xxxxxxxx"), { ok: false, code: "voted" }, "dasselbe Gerät");
  assert.deepEqual(await voteAt(room, K2, 1, "pruefwert-geraet-zwei-xxxxxxxx"), { ok: true });
  // Speicher: Zahlen und Prüfwerte getrennt; nirgends, welches Gerät was gewählt hat
  assert.deepEqual(room.ctx.data.get("polls")[K2].counts, [1, 1, 0]);
  assert.deepEqual(room.ctx.data.get("pv:" + K2), ["pruefwert-geraet-eins-xxxxxxxx", "pruefwert-geraet-zwei-xxxxxxxx"]);
  assert.ok(!JSON.stringify(room.ctx.data.get("polls")).includes("pruefwert"));
  // „Ergebnis am Beamer zeigen“ während noch abgestimmt wird: ohne Wirkung (die Klasse sähe das Ergebnis vor der eigenen Stimme)
  const ns2 = s.msgs().length, nb2 = b.msgs().length;
  await room.webSocketMessage(t, JSON.stringify({ t: "poll", op: "show", on: true }));
  assert.equal(b.msgs().length, nb2); assert.equal(b.last().poll.shown, false); assert.equal((await room.state()).pollShown, null);
  assert.equal(s.msgs().length, ns2);
  // andere Folie: zu; zurück: wieder offen (noch keine 2 Minuten)
  await room.webSocketMessage(t, JSON.stringify({ t: "goto", slide: 1 }));
  assert.equal(s.last().poll, undefined);
  assert.deepEqual(await voteAt(room, K2, 2, "pruefwert-geraet-drei-xxxxxxxx"), { ok: false, code: "not_open" });
  CLOCK += 40e3;
  await room.webSocketMessage(t, JSON.stringify({ t: "goto", slide: 2 }));
  assert.equal(b.last().poll.shown, false);
  assert.equal(t.last().poll.left, P.POLL_RESULT_MS - 40e3, "die Restzeit läuft weiter, auch während eine andere Folie gezeigt wird");
  CLOCK += 20e3;
  assert.deepEqual(await voteAt(room, K2, 2, "pruefwert-geraet-drei-xxxxxxxx"), { ok: true });
  // unter „Sitzungscode zeigen“ und nach „Präsentation für alle beenden“: zu
  await room.webSocketMessage(t, JSON.stringify({ t: "code", on: true }));
  assert.deepEqual(await voteAt(room, K2, 0, "pruefwert-geraet-vier-xxxxxxxx"), { ok: false, code: "not_open" });
  await room.webSocketMessage(t, JSON.stringify({ t: "stop" }));
  assert.deepEqual(await voteAt(room, K2, 0, "pruefwert-geraet-vier-xxxxxxxx"), { ok: false, code: "not_open" });
  assert.equal(polRow(c), null, "vor dem Ende steht nichts in D1");
});

test("Durable Object: 2 Minuten nach der ersten Antwort endet die Umfrage – Ergebnis nach D1, alle bekommen den Stand mit pollAt; danach keine Stimme mehr, auch bei erneut gezeigter Folie", async () => {
  CLOCK = 1_800_000_100_000;
  const c = await setup(), room = c.room();
  const t = await join(room, "teacher", "&lid=" + LESSON), s = await join(room, "student");
  await room.webSocketMessage(t, JSON.stringify(start({ slide: 2 })));
  const first = CLOCK;
  await voteAt(room, K2, 0, "pruefwert-geraet-eins-xxxxxxxx");
  CLOCK += 30e3;
  await voteAt(room, K2, 0, "pruefwert-geraet-zwei-xxxxxxxx");
  await voteAt(room, K2, 1, "pruefwert-geraet-drei-xxxxxxxx");
  // der Wecker kommt zu früh (z. B. neu gestellt): nichts geschieht – er wird aber wieder auf das Ende gestellt (sonst bliebe das Ergebnis aus)
  const na = room.ctx.alarms.length;
  await room.alarm();
  assert.equal(polRow(c), null); assert.equal(s.last().pollAt, undefined);
  assert.equal(room.ctx.alarms.length, na + 1); assert.equal(room.ctx.alarms[na], first + P.POLL_RESULT_MS);
  CLOCK = first + P.POLL_RESULT_MS + 7;   // der Wecker kommt einige Millisekunden nach dem Ende
  const ns = s.msgs().length;
  await room.alarm();
  assert.equal(s.msgs().length, ns + 1, "alle bekommen den Stand");
  assert.equal(s.last().poll.open, false); assert.ok(s.last().pollAt >= CLOCK); assert.equal(s.last().poll.counts, undefined);
  assert.equal(t.last().poll.open, false); assert.equal(t.last().pollAt, s.last().pollAt);
  const res = P.pollResultsData(polRow(c));
  assert.deepEqual(res, [{ k: K2, n: 2, q: Q, options: OPTS, counts: [2, 1, 0], total: 3, at: first + P.POLL_RESULT_MS }]);
  assert.ok(!polRow(c).includes("pruefwert"), "in D1 stehen nur Zahlen");
  assert.equal(room.ctx.data.get("polls")[K2].saved, true);
  assert.deepEqual(await voteAt(room, K2, 2, "pruefwert-geraet-vier-xxxxxxxx"), { ok: false, code: "closed" });
  // nach dem Ende: „Ergebnis am Beamer zeigen“ – die Verteilung am Beamer, die Schüler:innen bekommen dazu keine Nachricht
  const bm = await join(room, "beamer", "&gen=0&exp=4000000000000"), ns1 = s.msgs().length;
  assert.equal(bm.last().poll.counts, undefined); assert.equal(bm.last().poll.total, 3);
  await room.webSocketMessage(t, JSON.stringify({ t: "poll", op: "show", on: true }));
  assert.deepEqual(bm.last().poll.counts, [2, 1, 0]); assert.equal(bm.last().poll.shown, true); assert.equal(t.last().poll.shown, true);
  assert.equal(s.msgs().length, ns1);
  await room.webSocketMessage(t, JSON.stringify({ t: "poll", op: "show", on: false }));
  assert.equal(bm.last().poll.counts, undefined);
  await room.webSocketMessage(t, JSON.stringify({ t: "poll", op: "show", on: true }));
  await room.webSocketMessage(t, JSON.stringify({ t: "goto", slide: 1 }));
  await room.webSocketMessage(t, JSON.stringify({ t: "goto", slide: 2 }));
  assert.equal(bm.last().poll.shown, false, "nach dem Folienwechsel steht das Ergebnis nicht mehr am Beamer");
  assert.equal(s.last().poll.open, false, "erneut gezeigt: bleibt beendet");
  assert.deepEqual(await voteAt(room, K2, 2, "pruefwert-geraet-vier-xxxxxxxx"), { ok: false, code: "closed" });
  // ein zweiter Wecker ändert nichts mehr
  const at = s.last().pollAt, n2 = s.msgs().length;
  await room.alarm();
  assert.equal(s.msgs().length, n2); assert.equal((await room.state()).pollAt, at);
  // pollAt bleibt über stop und reset (wie revealAt)
  await room.webSocketMessage(t, JSON.stringify({ t: "stop" }));
  assert.equal(s.last().pollAt, at);
  await room.fetch(new Request("https://live/reset", { method: "POST" }));
  assert.equal((await (await room.fetch(new Request("https://live/state?role=student"))).json()).pollAt, at);
  assert.equal(P.pollResultsData(polRow(c)).length, 1, "das Ergebnis bleibt nach „Präsentation für alle beenden“");
});

test("Durable Object: scheitert D1, ist die Umfrage trotzdem beendet und der Wecker versucht es erneut; ohne Datenbank bzw. Sitzung wird nichts gespeichert", async () => {
  CLOCK = 1_800_000_200_000;
  const c = await setup();
  let fail = true;
  const env = { ...c.env, DB: { prepare: (sql) => { if (fail) throw new Error("D1 nicht erreichbar"); return c.env.DB.prepare(sql); } } };
  const room = new LiveRoom(roomCtx(), env);
  const t = await join(room, "teacher", "&lid=" + LESSON), s = await join(room, "student");
  await room.webSocketMessage(t, JSON.stringify(start({ slide: 2 })));
  await voteAt(room, K2, 1, "pruefwert-geraet-eins-xxxxxxxx");
  CLOCK += P.POLL_RESULT_MS;
  await room.alarm();
  assert.equal(s.last().poll.open, false, "beendet – auch ohne gespeichertes Ergebnis");
  assert.equal(s.last().pollAt, undefined, "noch kein Ergebnis zum Laden");
  assert.equal(room.ctx.data.get("polls")[K2].saved, false);
  assert.equal(room.ctx.alarms[room.ctx.alarms.length - 1], CLOCK + 20000, "neuer Versuch in 20 s");
  fail = false; CLOCK += 20000;
  await room.alarm();
  assert.ok(s.last().pollAt > 0);
  assert.deepEqual(P.pollResultsData(polRow(c))[0].counts, [0, 1, 0]);
  // ohne Datenbank: beendet und abgeschlossen, nichts zu speichern
  const room2 = new LiveRoom(roomCtx(), { SETTINGS_SECRET: SECRET });
  const t2 = await join(room2, "teacher");
  await room2.webSocketMessage(t2, JSON.stringify(start({ slide: 2 })));
  await voteAt(room2, K2, 0, "pruefwert-geraet-eins-xxxxxxxx", "");
  CLOCK += P.POLL_RESULT_MS;
  await room2.alarm();
  assert.equal(room2.ctx.data.get("polls")[K2].saved, true);
});

test("Durable Object: zwei Umfragen überschneiden sich – jede endet zu ihrer Zeit; Ergebnisse einer gelöschten Präsentation bzw. Sitzung verschwinden", async () => {
  CLOCK = 1_800_000_300_000;
  const c = await setup(), room = c.room();
  const t = await join(room, "teacher", "&lid=" + LESSON);
  await room.webSocketMessage(t, JSON.stringify(start({ slide: 2 })));
  const a = CLOCK;
  await voteAt(room, K2, 0, "pruefwert-geraet-eins-xxxxxxxx");
  CLOCK += 50e3;
  await room.webSocketMessage(t, JSON.stringify({ t: "goto", slide: 4 }));
  await voteAt(room, K4, 1, "pruefwert-geraet-eins-xxxxxxxx");
  assert.equal(room.ctx.alarms[room.ctx.alarms.length - 1], a + P.POLL_RESULT_MS, "der Wecker bleibt auf dem früheren Ende");
  CLOCK = a + P.POLL_RESULT_MS;
  await room.alarm();
  assert.deepEqual(P.pollResultsData(polRow(c)).map((x) => x.k), [K2]);
  assert.equal(room.ctx.alarms[room.ctx.alarms.length - 1], a + 50e3 + P.POLL_RESULT_MS, "… und danach auf dem nächsten");
  assert.equal(t.last().poll.open, true, "die zweite Umfrage läuft noch");
  CLOCK = a + 50e3 + P.POLL_RESULT_MS;
  await room.alarm();
  assert.deepEqual(P.pollResultsData(polRow(c)).map((x) => x.k), [K2, K4]);
  // Stand für die Sitzungsseite
  const st = await (await room.fetch(new Request("https://live/polls"))).json();
  assert.deepEqual(st.polls.map((x) => [x.n, x.total, x.open]), [[2, 1, false], [4, 1, false]]);
  // Präsentation gelöscht bzw. ersetzt: Zählung und Prüfwerte weg, pollAt rückt vor (die Schüler:innen-Seiten laden neu)
  const at = (await room.state()).pollAt;
  await room.fetch(new Request("https://live/reset?pollsFile=" + FILE, { method: "POST" }));
  assert.deepEqual(room.ctx.data.get("polls"), {}); assert.equal(room.ctx.data.has("pv:" + K2), false); assert.equal(room.ctx.data.has("pv:" + K4), false);
  assert.ok((await room.state()).pollAt > at);
});

test("Durable Object: nur während der Live-Präsentation – ohne verbundene Lehrkraft (Präsentation nur geschlossen, Folie blieb stehen) nimmt die Umfrage nach 90 s keine Stimme mehr an", async () => {
  CLOCK = 1_800_000_350_000;
  const c = await setup(), room = c.room();
  const t = await join(room, "teacher", "&lid=" + LESSON);
  await room.webSocketMessage(t, JSON.stringify(start({ slide: 2 })));
  assert.deepEqual(await voteAt(room, K2, 0, "pruefwert-geraet-eins-xxxxxxxx"), { ok: true });
  // die Verbindung der Lehrkraft endet (Fenster geschlossen bzw. WLAN): kurz danach zählt eine Stimme noch, später nicht mehr
  room.ctx.socks.find((x) => x.ws === t).gone = true;
  await room.webSocketClose(t, 1000, "");
  CLOCK += 30e3;
  assert.deepEqual(await voteAt(room, K2, 1, "pruefwert-geraet-zwei-xxxxxxxx"), { ok: true }, "kurzer Verbindungsabbruch: zählt");
  CLOCK += 61e3;
  assert.deepEqual(await voteAt(room, K2, 1, "pruefwert-geraet-drei-xxxxxxxx"), { ok: false, code: "not_open" }, "90 s ohne Lehrkraft: zu");
  const t2 = await join(room, "teacher", "&lid=" + LESSON);
  assert.deepEqual(await voteAt(room, K2, 1, "pruefwert-geraet-drei-xxxxxxxx"), { ok: true }, "die Lehrkraft ist wieder verbunden");
  assert.ok(t2.last().poll.total === 3);
  // nie verbunden gewesen (z. B. nach einem Neustart des Objekts ohne Lehrkraft): zu
  const room2 = new LiveRoom(roomCtx(), c.env);
  await room2.ctx.storage.put("state", await room.state());
  assert.deepEqual(await voteAt(room2, K2, 0, "pruefwert-geraet-vier-xxxxxxxx"), { ok: false, code: "not_open" });
});

test("Durable Object: wird die Umfrage, auf deren Ende der Wecker steht, gelöscht, bekommt die andere laufende Umfrage trotzdem ihr Ergebnis", async () => {
  CLOCK = 1_800_000_370_000;
  const c = await setup(), room = c.room();
  const t = await join(room, "teacher", "&lid=" + LESSON);
  await room.webSocketMessage(t, JSON.stringify(start({ slide: 2 })));
  const a = CLOCK;
  await voteAt(room, K2, 0, "pruefwert-geraet-eins-xxxxxxxx");
  CLOCK += 50e3;
  await room.webSocketMessage(t, JSON.stringify({ t: "goto", slide: 4 }));
  await voteAt(room, K4, 1, "pruefwert-geraet-eins-xxxxxxxx");
  await room.fetch(new Request("https://live/poll-reset?k=" + encodeURIComponent(K2), { method: "POST" }));
  CLOCK = a + P.POLL_RESULT_MS;
  await room.alarm();   // der Wecker stand noch auf dem Ende der gelöschten Umfrage
  assert.equal(room.ctx.alarms[room.ctx.alarms.length - 1], a + 50e3 + P.POLL_RESULT_MS, "neu gestellt auf das Ende der zweiten Umfrage");
  CLOCK = a + 50e3 + P.POLL_RESULT_MS + 3;
  await room.alarm();
  assert.deepEqual(P.pollResultsData(polRow(c)).map((x) => x.k), [K4]);
});

/* ---------- Wege der Schüler:innen und der Lehrkraft ---------- */
const sreq = (c, path, body, token = TOKEN) => ({ ...c, request: new Request("https://x" + path, { method: body === undefined ? "GET" : "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }) });
const treq = (c, path, method, body) => ({ ...c, request: new Request("https://x" + path, { method, headers: { Authorization: "Bearer " + TT, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }) });
const tryRoute = async (fn) => { try { const r = await fn(); return { status: r.status, data: await r.json() }; } catch (e) { if (!e.status) throw e; return { status: e.status, code: e.code, error: e.message }; } };
const svote = (c, k, choice, token = TOKEN) => tryRoute(() => routeStudentPollVote(sreq(c, "/api/student/lessons/" + LESSON + "/poll", { k, choice }, token), LESSON));
const sdata = async (c) => (await routeStudentLesson(sreq(c, "/api/student/lessons/" + LESSON), LESSON)).json();

test("Schüler:in: Stimme über den Server – der Prüfwert des Geräts ist ein HMAC (nie die Gerätekennung); je Gerät einmal; das Ergebnis steht erst nach dem Ende in den Daten der Sitzung", async () => {
  CLOCK = 1_800_000_400_000;
  const c = await setup(), room = c.room();
  const t = await join(room, "teacher", "&lid=" + LESSON);
  assert.deepEqual((await svote(c, K2, 0)).code, "poll_not_open", "ohne laufende Präsentation");
  await room.webSocketMessage(t, JSON.stringify(start({ slide: 2 })));
  const first = CLOCK;
  assert.deepEqual(await svote(c, K2, 0), { status: 200, data: { ok: true, authLeftMs: 3600e3 } });
  const r2 = await svote(c, K2, 1);
  assert.equal(r2.status, 409); assert.equal(r2.code, "poll_voted"); assert.equal(r2.error, P.POLL_ERRORS.voted);
  assert.equal((await svote(c, K2, 1, TOKEN + "-2")).status, 200, "ein anderes Gerät");
  assert.equal((await svote(c, K2, 9, TOKEN + "-2")).status, 409);
  assert.equal((await svote(c, "kaputt", 0)).code, "poll_choice");
  assert.equal((await svote(c, K2, "0")).code, "poll_choice");
  assert.equal((await svote(c, K2, 0, "unbekannt")).status, 401, "nur angemeldete Geräte mit Zugang zur Sitzung");
  const pv = room.ctx.data.get("pv:" + K2);
  assert.equal(pv.length, 2); assert.ok(pv.every((x) => x.length >= 40 && !x.includes(DEV) && !x.includes("dev0000")), "nur Prüfwerte, keine Gerätekennung");
  let d = await sdata(c);
  assert.deepEqual(d.polls, []); assert.equal(d.pollAt, undefined);
  assert.ok(!JSON.stringify(d).includes(Q), "vor dem Ende steht die Umfrage nicht in den Daten der Sitzung");
  CLOCK = first + P.POLL_RESULT_MS;
  await room.alarm();
  assert.equal((await svote(c, K2, 2, TOKEN + "-2")).code, "poll_closed");
  d = await sdata(c);
  assert.deepEqual(d.polls, [{ id: "2-" + (first + P.POLL_RESULT_MS), q: Q, options: OPTS, counts: [1, 1, 0], total: 2 }]);
  // die Seite vergleicht pollAt des Durable Objects mit dem Zeitpunkt ihrer Daten (now): das Ergebnis steht in D1, bevor pollAt vorrückt
  assert.ok((await room.state()).pollAt >= first + P.POLL_RESULT_MS && typeof d.now === "number");
  assert.ok(!JSON.stringify(d.polls).includes(FILE));
});

test("Lehrkraft: Stand der Umfragen, „Ergebnis löschen und Umfrage neu öffnen“ (Zählung, Prüfwerte und Ergebnis weg; danach zählt jedes Gerät wieder einmal)", async () => {
  CLOCK = 1_800_000_500_000;
  const c = await setup(), room = c.room();
  const t = await join(room, "teacher", "&lid=" + LESSON), s = await join(room, "student");
  await room.webSocketMessage(t, JSON.stringify(start({ slide: 2 })));
  await svote(c, K2, 0);
  let st = await tryRoute(() => routeTeacherPolls(treq(c, "/api/teacher/lessons/" + LESSON + "/polls", "GET"), LESSON));
  assert.equal(st.status, 200);
  assert.deepEqual(st.data.polls.map((x) => [x.k, x.counts, x.open, x.left]), [[K2, [1, 0, 0], true, P.POLL_RESULT_MS]]);
  CLOCK += P.POLL_RESULT_MS + 5000;
  // überfällig (der Wecker kam nicht): der Abruf schließt ab
  st = await tryRoute(() => routeTeacherPolls(treq(c, "/api/teacher/lessons/" + LESSON + "/polls", "GET"), LESSON));
  assert.equal(st.data.polls[0].open, false);
  assert.equal(P.pollResultsData(polRow(c)).length, 1);
  const at = s.last().pollAt;
  const rs = await tryRoute(() => routeTeacherPollReset(treq(c, "/api/teacher/lessons/" + LESSON + "/polls/reset", "POST", { k: K2 }), LESSON));
  assert.deepEqual(rs, { status: 200, data: { ok: true } });
  assert.equal(polRow(c), null, "das Ergebnis ist aus D1 weg");
  assert.deepEqual(room.ctx.data.get("polls"), {}); assert.equal(room.ctx.data.has("pv:" + K2), false);
  assert.equal(s.last().poll.open, true, "die Umfrage ist wieder offen"); assert.ok(s.last().pollAt > at, "die Schüler:innen-Seiten laden ihr Ergebnis neu");
  assert.ok(s.last().poll.r > 0, "… mit dem Zeitpunkt des Neuöffnens: die Seiten der Schüler:innen vergessen ihr „schon abgestimmt“");
  assert.equal((await svote(c, K2, 1)).status, 200, "dasselbe Gerät darf wieder einmal");
  assert.equal((await tryRoute(() => routeTeacherPollReset(treq(c, "/api/teacher/lessons/" + LESSON + "/polls/reset", "POST", { k: "kaputt" }), LESSON))).status, 400);
  const noAuth = { ...c, request: new Request("https://x/api/teacher/lessons/" + LESSON + "/polls") };
  assert.equal((await tryRoute(() => routeTeacherPolls(noAuth, LESSON))).status, 401);
});

test("Lehrkraft: Umfragefolien speichern (aus der PDF nachsichtig, von Hand streng), in fileOut und …/slides; Präsentation löschen entfernt Zählung und Ergebnisse", async () => {
  CLOCK = 1_800_000_600_000;
  const c = await setup(), db = c.db.raw;
  for (let n = 1; n <= 5; n++) db.prepare("INSERT INTO slides(file_id, n, w, h, size) VALUES(?, ?, 1920, 1080, 10)").run(FILE, n);
  db.prepare("UPDATE files SET status='processing' WHERE id=?").run(FILE);
  let r = await tryRoute(() => F.routePresentationReady(treq(c, "/api/teacher/files/" + FILE + "/ready", "POST", { pages: 5, polls: [...SLIDES, { n: 5, q: "ungültig", options: ["nur eine"] }] }), FILE));
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.file.polls, { pdf: SLIDES, hand: null }, "Ungültiges aus der PDF entfällt");
  r = await tryRoute(() => F.routePollsPut(treq(c, "/api/teacher/files/" + FILE + "/polls", "PUT", { hand: [{ n: 3, q: "Von Hand?", options: ["a", "b"] }] }), FILE));
  assert.deepEqual(r.data.file.polls, { pdf: SLIDES, hand: [{ n: 3, q: "Von Hand?", options: ["a", "b"] }] });
  r = await tryRoute(() => F.routePollsPut(treq(c, "/api/teacher/files/" + FILE + "/polls", "PUT", { hand: [{ n: 3, q: "Gleich?", options: ["a", "A"] }] }), FILE));
  assert.equal(r.status, 400); assert.match(r.error, /Ungültige Umfragefolien/);
  r = await tryRoute(() => F.routePollsPut(treq(c, "/api/teacher/files/" + FILE + "/polls", "PUT", {}), FILE));
  assert.equal(r.status, 400);
  r = await tryRoute(() => F.routePollsPut(treq(c, "/api/teacher/files/" + FILE + "/polls", "PUT", { hand: [] }), FILE));
  assert.deepEqual(r.data.file.polls, { pdf: SLIDES, hand: [] }, "[] = bewusst keine");
  r = await tryRoute(() => F.routePollsPut(treq(c, "/api/teacher/files/" + FILE + "/polls", "PUT", { hand: null }), FILE));
  assert.deepEqual(r.data.file.polls, { pdf: SLIDES, hand: null });
  // ein erneutes …/ready ohne polls (ältere, gecachte Seite) lässt die Spalte, wie sie ist
  db.prepare("UPDATE files SET status='processing' WHERE id=?").run(FILE);
  r = await tryRoute(() => F.routePresentationReady(treq(c, "/api/teacher/files/" + FILE + "/ready", "POST", { pages: 5 }), FILE));
  assert.deepEqual(r.data.file.polls, { pdf: SLIDES, hand: null });
  r = await tryRoute(() => F.routeTeacherSlides(treq(c, "/api/teacher/files/" + FILE + "/slides", "GET"), FILE));
  assert.deepEqual(r.data.polls, { pdf: SLIDES, hand: null });
  // Umfrage gelaufen und beendet, dann Präsentation gelöscht
  const room = c.room(), t = await join(room, "teacher", "&lid=" + LESSON);
  await room.webSocketMessage(t, JSON.stringify(start({ slide: 2 })));
  await svote(c, K2, 0);
  CLOCK += P.POLL_RESULT_MS;
  await room.alarm();
  assert.equal(P.pollResultsData(polRow(c)).length, 1);
  r = await tryRoute(() => F.routeFileDelete(treq(c, "/api/teacher/files/" + FILE, "DELETE"), FILE));
  assert.equal(r.status, 200);
  assert.equal(polRow(c), null, "mit der Präsentation verschwinden ihre Ergebnisse");
  assert.deepEqual(room.ctx.data.get("polls"), {});
  assert.deepEqual((await sdata(c)).polls, []);
});

/* ---------- Prompt und Quelltext ---------- */
test("Präsentations-Prompt: Abschnitt „Umfragefolien“ – nur auf Wunsch der Lehrkraft, mit genauem Aufbau und der unsichtbaren Zeile; nicht in Jg. 5/6", () => {
  const sec = P.pollPromptSection();
  assert.match(sec, /^## Umfragefolien: anonyme Umfrage während der Präsentation/);
  assert.ok(sec.includes("Erfinde keine eigene Umfrage") && sec.includes("nur an, wenn ich sie festlege"));
  assert.ok(sec.includes("Unterricks-Umfrage: Soll das Wahlalter bei Bundestagswahlen auf 16 Jahre sinken? | Ja | Nein | Ich bin unentschieden"));
  assert.ok(sec.includes("2 bis 6 verschiedene") && sec.includes("Etwa 2 Minuten nach der ersten Antwort"));
  assert.equal(P.pollPromptSection({ analog: true }), "", "Jg. 5/6 arbeitet ohne iPads");
  const ctx = { subject: "powi", klass: "8A", lesson: { title: "Wahlalter", topic: "Wahlalter", durationMin: 90 }, materials: [], sheets: [], drafts: [] };
  const withP = claudePresentationPrompt({ ...ctx, pollSection: sec }, "**1) Einstieg**\n- Umfrage: ~~Soll das Wahlalter sinken?~~", []);
  assert.ok(withP.includes("## Umfragefolien: anonyme Umfrage während der Präsentation"));
  assert.ok(withP.indexOf("## Umfragefolien") < withP.indexOf("## Zeitlos gestalten"));
  assert.ok(!claudePresentationPrompt(ctx, "**1) Einstieg**", []).includes("Umfragefolien"));
  assert.ok(src("public/session.js").includes("pollSection: pollPromptSection({ analog: isAnalogClass(c.klass) })"));
});

test("Quelltext: Stimme und Ergebnis nur über die vorgesehenen Wege – die Live-Nachricht der Schüler:innen trägt nie Zahlen, die Eltern- und Sitzungslisten kennen die Umfrage nicht", () => {
  const live = src("worker/live.js");
  assert.ok(live.includes('out.poll = pollMessage(role, spec, (await this.polls())[spec.k] || null, st.pollShown === spec.n, Date.now(),'));
  assert.ok(live.includes('await this.broadcast(st, { students: false });'), "eine Stimme geht nur an Lehrkraft und Beamer");
  assert.ok(live.includes('students: m.t !== "video" && m.t !== "poll"'), "„Ergebnis am Beamer zeigen“ ebenso");
  assert.ok(live.includes('if (m.t === "poll" && m.on === true) { const spec = livePoll(st), p = spec ? (await this.polls())[spec.k] : null; if (!p || !pollClosed(p, now)) return; }'), "… und erst nach dem Ende der Abstimmung");
  const app = src("public/app.js");
  assert.ok(app.includes("const pw = revealWatch({ seen: (d.now || 0) - POLL_SKEW_MS, reload: () => refresh() });") && app.includes("pw.seen(Math.max(pollWant, (r.now || 0) - POLL_SKEW_MS));"),
    "die Seite der Schüler:innen lädt nach einer beendeten Umfrage einmal neu (nicht wiederholt): der gewünschte Stand gilt nach einer geglückten Antwort als erreicht");
  assert.ok(src("worker/files.js").indexOf("await dropFilePollResults(c.db, lessonId, fileId)") < src("worker/files.js").indexOf('fetch("https://live/reset" + (fileId'), "Präsentation gelöscht: erst D1, dann die Nachricht des Durable Objects");
  const st = src("worker/student.js");
  assert.ok(st.includes('const voter = await hmac(requireSecret(c.env), "poll|" + lessonId + "|" + body.k + "|" + student.id);'));
  assert.ok(!/LESSON_COLS = [^\n]*polls/.test(st), "nicht in der Sitzungsliste");
  for (const f of ["worker/parents.js", "public/parents.js", "worker/podcast.js", "worker/printjobs.js"]) assert.ok(!/pollResults|\.polls\b|poll_slides/.test(src(f)), f);
  for (const f of ["public/pollview.js", "public/pollpanel.js", "public/polls.js"]) assert.ok(!/\.innerHTML\b/.test(src(f)), f + ": nur textContent");
  assert.ok(src("worker/index.js").includes('["POST", "/api/student/lessons/" + ID + "/poll", S.routeStudentPollVote]'));
});
