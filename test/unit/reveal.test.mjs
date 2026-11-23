// Nachtrag 44, Teil 1 (23.11.2026): Material erscheint live mit seiner Materialfolie – Zuordnung Überschrift → Material (public/reveal.js), Speicherform in D1,
// Schüleransicht und Datei-Link auf dem Server (worker/student.js), Durable Object (worker/live.js: gezeigte Materialfolie vermerken, revealAt an alle),
// Freigabe von Hand (worker/lessons.js), Hinweise der Lehrkraft. Dazu Nachtrag 45: „wieder gebraucht“ (again) und link_feibeitsblatt im Connector.
// Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
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

const R = await import("../../public/reveal.js");
const { GENERIC_TITLES } = await import("../../public/sharelib.js");
const S = await import("../../public/shared.js");
const P = await import("../../public/planning.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const { routeStudentLesson, routeStudentFileLink, routeStudentLiveState } = await import("../../worker/student.js");
const L = await import("../../worker/lessons.js");
const { LiveRoom, routeLiveSocket } = await import("../../worker/live.js");
const { liveReduce, LIVE_IDLE } = await import("../../worker/livestate.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");
const F = await import("../../worker/files.js");

const HEAD_FB = ["Bearbeitet in Partnerarbeit die Aufgaben 1 bis 3.", "Feibeitsblatt: Die wehrhafte Demokratie"];
const HEAD_M2 = ["Lest M2 Karikatur und notiert eure Beobachtungen."];
const HEAD_HW = ["Die Hausaufgabe und das Material findest du in Unterricks."];
const CODE_SLIDES = [{ n: 3, lines: HEAD_FB }, { n: 5, lines: HEAD_M2 }, { n: 6, lines: HEAD_HW }];

/* ---------- reine Funktionen ---------- */
test("Schlüssel der Überschrift: klein, ohne Satzzeichen, gekürzt – Zeilen oder Text", () => {
  assert.equal(R.revealKeyOf(HEAD_FB), "bearbeitet in partnerarbeit die aufgaben 1 bis 3 feibeitsblatt die wehrhafte demokratie");
  assert.equal(R.revealKeyOf("Feibeitsblatt: „Größe“!"), "feibeitsblatt größe");
  assert.equal(R.revealKeyOf([]), ""); assert.equal(R.revealKeyOf(null), ""); assert.equal(R.revealKeyOf([1, null]), "");
  assert.ok(R.revealKeyOf(["x ".repeat(2000)]).length <= R.REVEAL_LIMITS.key);
});

test("lessons.reveals tolerant lesen: ungültige und doppelte Einträge entfallen, der frühere gilt; revealLast", () => {
  const raw = JSON.stringify({ v: 1, seen: [{ k: "a b", at: 5 }, { k: "A, b!", at: 9 }, { k: "", at: 1 }, { k: "c", at: "x" }, "kaputt"],
    refs: [{ r: "f:0123456789abcdef", at: 7 }, { r: "s:ABC123", at: 3 }, { r: "s:abc123", at: 4 }, { r: "x:1", at: 1 }, { r: "f:0123456789abcdef", at: 11 }] });
  assert.deepEqual(R.revealsOf(raw), { seen: [{ k: "a b", at: 5 }], refs: [{ r: "f:0123456789abcdef", at: 7 }, { r: "s:ABC123", at: 3 }] });
  assert.equal(R.revealLast(raw), 7);
  for (const x of [null, undefined, "", "kaputt", "[]", "{}", 42, { seen: "x" }]) assert.deepEqual(R.revealsOf(x), { seen: [], refs: [] });
  assert.equal(R.revealLast(null), 0);
});

test("Material zu einer Überschrift: Titel wörtlich oder alle Wörter, ohne Dateiendung; allgemeine Titel nie; der längste gewinnt; gleiche Titel beide", () => {
  const items = R.revealItems([
    { id: "1111111111111111", area: "student", kind: "file", name: "M2 Karikatur.pdf", status: "ready" },
    { id: "2222222222222222", area: "student", kind: "file", name: "Quelle.pdf" },
    { id: "3333333333333333", area: "student", kind: "file", name: "Quelle 2.pdf" },
    { id: "4444444444444444", area: "student", kind: "text", name: "Material" },
    { id: "5555555555555555", area: "teacher", kind: "file", name: "Lösung Quelle 2.pdf" },
    { id: "6666666666666666", area: "student", kind: "file", name: "Notfall-Feibeitsblatt – Die wehrhafte Demokratie.pdf", source: "notfall", fb_code: "WHD4KT" },
    { id: "7777777777777777", area: "student", kind: "file", name: "Station.pdf", source: "selbstlern" },
    { id: "8888888888888888", area: "student", kind: "file", name: "Noch im Druck", status: "pending" },
    { id: "9999999999999999", area: "student", kind: "file", name: "Anmerkungen", notesOf: "x" },
    { id: "aaaaaaaaaaaaaaab", area: "student", kind: "file", name: "Die wehrhafte Demokratie.pdf" },
  ], [{ code: "WHD4KT", title: "Die wehrhafte Demokratie" }, { code: "ESC4PE", title: "Finale", kind: "escape" }]);
  assert.deepEqual(items.map((x) => x.ref), ["s:WHD4KT", "f:1111111111111111", "f:2222222222222222", "f:3333333333333333", "f:4444444444444444", "f:aaaaaaaaaaaaaaab"],
    "nur Material für Schüler:innen, fertig, ohne Notfall-Feibeitsblatt, Selbstlern-Material, Anmerkungs-PDF und Finale");
  const refs = (k) => R.revealMatches(k, items).map((x) => x.ref).sort();
  assert.deepEqual(refs(R.revealKeyOf(HEAD_FB)), ["f:aaaaaaaaaaaaaaab", "s:WHD4KT"], "Feibeitsblatt und Datei gleichen Titels: beide");
  assert.deepEqual(refs(R.revealKeyOf(HEAD_M2)), ["f:1111111111111111"]);
  assert.deepEqual(refs(R.revealKeyOf(["Karikatur M2 auswerten"])), ["f:1111111111111111"], "alle Wörter in anderer Reihenfolge");
  assert.deepEqual(refs(R.revealKeyOf(["Lest Quelle 2"])), ["f:3333333333333333"], "„Quelle 2“ ist nicht auch „Quelle“");
  assert.deepEqual(refs(R.revealKeyOf(["Lest die Quelle"])), ["f:2222222222222222"]);
  assert.deepEqual(refs(R.revealKeyOf(HEAD_HW)), [], "allgemeine Titel („Material“) nennt keine Überschrift");
  assert.deepEqual(refs(""), []);
  assert.equal(R.revealRefOf({ source: "notfall", fb_code: "WHD4KT" }), "s:WHD4KT");
  assert.equal(R.revealRefOf({ source: "notfall", fbCode: "WHD4KT" }), "s:WHD4KT");
  assert.equal(R.revealRefOf({ id: "1111111111111111" }), "f:1111111111111111");
});

test("Befund der Gegenprüfung: ein Feibeitsblatt ohne eigenen Titel („Feibeitsblatt“) bzw. ein „Arbeitsblatt“ nennt nicht jede Materialfolie", () => {
  const items = R.revealItems([{ id: "1111111111111111", area: "student", kind: "file", name: "Arbeitsblatt.pdf" }],
    [{ code: "ABC234", title: "Feibeitsblatt" }, { code: "GWT4KQ", title: "Gewaltenteilung" }, { code: "FBG234", title: "Feibeitsblätter" }]);
  assert.deepEqual(R.revealMatches(R.revealKeyOf(["Bearbeitet das Arbeitsblatt.", "Feibeitsblatt: Gewaltenteilung"]), items).map((x) => x.ref), ["s:GWT4KQ"]);
  for (const t of ["feibeitsblatt", "feibeitsblätter", "arbeitsblatt", "arbeitsblätter", "material", "aufgaben"]) assert.ok(R.REVEAL_GENERIC.has(t), t);
  // in sharelib (isMaterialSlide) bleibt die Liste, wie sie ist
  assert.ok(!GENERIC_TITLES.has("feibeitsblatt"));
  // ein Titel aus zwei Wörtern mit „Feibeitsblatt“ darin zählt weiter
  assert.deepEqual(R.revealMatches(R.revealKeyOf(["Feibeitsblatt Gewaltenteilung öffnen"]), R.revealItems([], [{ code: "GWT4KQ", title: "Feibeitsblatt Gewaltenteilung" }])).map((x) => x.ref), ["s:GWT4KQ"]);
});

test("Befund der Gegenprüfung: die KI-Begriffshilfe bekommt den Schulportal-Eintrag ohne Codes (sonst verriete sie den Code eines wartenden Feibeitsblatts)", () => {
  assert.equal(S.hideCodes("- Feibeitsblatt ~~Die wehrhafte Demokratie~~ mit dem Code ~~WHD-4KT~~"), "- Feibeitsblatt ~~Die wehrhafte Demokratie~~ mit dem Code ~~(Code)~~");
  assert.equal(S.hideCodes("Code WHD4KT, gesperrt W H D – 4 K T, Gedankenstrich WHD–4KT."), "Code (Code), gesperrt (Code), Gedankenstrich (Code).");
  assert.equal(S.hideCodes("Q3-LK, MP3, 2026, ABCDEF, Seite 12, G7-Gipfel"), "Q3-LK, MP3, 2026, ABCDEF, Seite 12, G7-Gipfel", "nur gültige Codes (Buchstaben und Ziffern)");
  const portal = "**3) Partnerarbeit**\n- Feibeitsblatt ~~Die wehrhafte Demokratie~~ mit dem Code ~~WHD-4KT~~\n- Aufgabe 4 besprechen";
  const p = S.studentHelpPrompt({ subject: "powi", klass: "Q2-GK", title: "Wehrhafte Demokratie", portal });
  assert.ok(p.includes("mit dem Code ~~(Code)~~") && !p.includes("WHD-4KT") && !p.includes("WHD4KT") && p.includes("Aufgabe 4 besprechen"), p);
});

const TIMES = S.lessonTimes({ date: "2026-11-24", startTime: "08:00", durationMin: 90 });
const FILES = [{ id: "1111111111111111", area: "student", kind: "file", name: "M2 Karikatur.pdf" }, { id: "2222222222222222", area: "student", kind: "link", name: "Erklärvideo" },
  { id: "3333333333333333", area: "student", kind: "file", name: "Notfall-Feibeitsblatt – Die wehrhafte Demokratie.pdf", source: "notfall", fb_code: "WHD4KT" }];
const SHEETS = [{ code: "WHD4KT", title: "Die wehrhafte Demokratie" }];
const gate = (o = {}) => R.materialGate({ klass: "Q2-GK", times: TIMES, codeSlides: CODE_SLIDES, files: FILES, sheets: SHEETS, now: TIMES.start + 600e3, ...o });

test("materialGate: wartet bis zur gezeigten Materialfolie bzw. Freigabe von Hand; Notfall-Feibeitsblatt folgt seinem Blatt; Material ohne Folie sofort", () => {
  let g = gate();
  assert.equal(g.on, true);
  assert.deepEqual([...g.hidden].sort(), ["f:1111111111111111", "s:WHD4KT"]);
  assert.deepEqual(R.revealFilterFiles(FILES, g).map((f) => f.id), ["2222222222222222"], "Link ohne Materialfolie sofort; Notfall-Feibeitsblatt wartet mit seinem Blatt");
  assert.deepEqual(R.revealFilterSheets(SHEETS, g), []);
  assert.deepEqual(g.items.get("s:WHD4KT"), { slides: [3], at: null, how: null, late: false });
  // Folie 3 live gezeigt
  g = gate({ reveals: { v: 1, seen: [{ k: R.revealKeyOf(HEAD_FB), at: TIMES.start + 300e3 }] } });
  assert.deepEqual([...g.hidden], ["f:1111111111111111"]);
  assert.deepEqual(R.revealFilterFiles(FILES, g).map((f) => f.id), ["2222222222222222", "3333333333333333"]);
  assert.equal(g.items.get("s:WHD4KT").how, "live"); assert.equal(g.revealAt, TIMES.start + 300e3);
  // von Hand freigegeben
  g = gate({ reveals: { v: 1, refs: [{ r: "f:1111111111111111", at: TIMES.start + 400e3 }] } });
  assert.deepEqual([...g.hidden], ["s:WHD4KT"]); assert.equal(g.items.get("f:1111111111111111").how, "hand");
  // nach der Freigabe der Präsentation: ohne Markierung alles, mit Markierung nur bis dorthin
  g = gate({ now: TIMES.presentationAt });
  assert.equal(g.hidden.size, 0); assert.equal(g.items.get("s:WHD4KT").how, "end");
  g = gate({ now: TIMES.presentationAt, upTo: 4 });
  assert.deepEqual([...g.hidden], ["f:1111111111111111"], "Folie 5 liegt hinter der letzten gezeigten Folie (4)");
  assert.equal(g.items.get("f:1111111111111111").late, true);
  assert.equal(R.revealNote(g.items.get("f:1111111111111111")).text, "Für Schüler:innen verborgen: Folie 5 (Materialfolie) wurde nicht live gezeigt und liegt hinter der letzten gezeigten Folie");
});

test("Befund der Gegenprüfung: festgehaltene Freigabe nach der Stunde (refs mit e:1) gilt wie „end“, auch hinter einer später gesetzten Markierung; revealEndRefs", () => {
  const after = TIMES.presentationAt + 864e5;
  let g = gate({ now: after });
  assert.deepEqual(R.revealEndRefs(g, null).sort(), ["f:1111111111111111", "s:WHD4KT"], "ohne gezeigte Folie nach der Stunde frei: festzuhalten");
  const kept = { v: 1, refs: [{ r: "f:1111111111111111", at: TIMES.presentationAt, e: 1 }, { r: "s:WHD4KT", at: TIMES.presentationAt, e: 1 }] };
  assert.deepEqual(R.revealsOf(JSON.stringify(kept)).refs, kept.refs, "e:1 bleibt beim Lesen erhalten");
  assert.deepEqual(R.revealsOf({ refs: [{ r: "s:WHD4KT", at: 5, e: 2 }] }).refs, [{ r: "s:WHD4KT", at: 5 }], "nur e:1");
  // die Probe der Gegenprüfung: Markierung danach auf Folie 2 – ohne Festhalten verborgen, mit Festhalten bleibt es sichtbar
  assert.deepEqual([...gate({ now: after, upTo: 2 }).hidden].sort(), ["f:1111111111111111", "s:WHD4KT"]);
  g = gate({ now: after, upTo: 2, reveals: kept });
  assert.equal(g.hidden.size, 0); assert.equal(g.items.get("s:WHD4KT").how, "end");
  assert.equal(R.revealNote(g.items.get("s:WHD4KT")).text, "Für Schüler:innen sichtbar seit der Freigabe der Präsentation – die Materialfolie wurde nicht live gezeigt");
  assert.deepEqual(R.revealEndRefs(g, kept), [], "schon festgehalten");
  // live gezeigt bzw. von Hand freigegeben: nichts festzuhalten; vor der Freigabe der Präsentation auch nicht
  assert.deepEqual(R.revealEndRefs(gate({ now: after, reveals: { refs: [{ r: "s:WHD4KT", at: 1 }], seen: [{ k: R.revealKeyOf(HEAD_M2), at: 2 }] } }), null), []);
  assert.deepEqual(R.revealEndRefs(gate(), null), []);
  assert.deepEqual(R.revealEndRefs({ on: false }, null), []);
});

test("materialGate aus: Lehrkraft nicht da, Jg. 5/6, ohne Beginn oder Dauer, ohne Codefolien mit Überschrift bzw. ohne Material dazu – alles wie bisher", () => {
  for (const o of [{ absent: true }, { klass: "6B" }, { times: null }, { codeSlides: [] }, { codeSlides: [{ n: 2, lines: [] }] }, { codeSlides: [{ n: 6, lines: HEAD_HW }] }, { files: [], sheets: [] }]) {
    const g = gate(o);
    assert.equal(g.on, false, JSON.stringify(o)); assert.equal(g.hidden.size, 0);
  }
  assert.equal(gate({ absent: true, reveals: { seen: [{ k: "x", at: 9 }] } }).revealAt, 9, "revealAt auch ohne Warten");
});

test("Hinweise für die Lehrkraft (teacherGate aus GET …/lessons/:id) und Schlüssel des Stands", () => {
  const lesson = { klass: "Q2-GK", date: "2026-11-24", startTime: "08:00", durationMin: 90, reveals: { seen: [{ k: R.revealKeyOf(HEAD_FB), at: TIMES.start + 300e3 }], refs: [] } };
  const files = [{ id: "pppppppppppppppp", area: "presentation", status: "ready", pages: 6, shownUntil: null, codeSlides: CODE_SLIDES }, ...FILES.map((f) => ({ ...f, fbCode: f.fb_code }))];
  const g = R.teacherGate({ lesson, files, sheets: SHEETS, now: TIMES.start + 600e3 });
  assert.equal(g.on, true);
  assert.deepEqual(R.revealNote(g.items.get("f:1111111111111111"), TIMES.start + 600e3), { text: "Erscheint bei den Schüler:innen erst, wenn Folie 5 (Materialfolie) live gezeigt wird", waiting: true });
  assert.deepEqual(R.revealNote(g.items.get("s:WHD4KT"), TIMES.start + 600e3), { text: "Für Schüler:innen sichtbar seit 08:05 Uhr – Materialfolie live gezeigt", waiting: false });
  assert.equal(R.revealNote(g.items.get("f:2222222222222222")), null, "ohne Materialfolie kein Hinweis");
  assert.equal(R.revealNote({ slides: [3, 7, 9], at: null }).text, "Erscheint bei den Schüler:innen erst, wenn Folie 3, 7 oder 9 (Materialfolie) live gezeigt wird");
  assert.match(R.revealNote({ slides: [3], at: TIMES.start, how: "hand" }, TIMES.start + 864e5 * 2).text, /^Für Schüler:innen sichtbar seit \w+\.?, 24\.11\.2026, 08:00 Uhr – von Ihnen freigegeben$/);
  assert.equal(R.teacherGate({ lesson, files, sheets: SHEETS, sub: { status: "selbstlern" } }).on, false);
  assert.equal(R.teacherGate({ lesson: { ...lesson, startTime: null }, files, sheets: SHEETS }).on, false);
  assert.notEqual(R.revealStateKey(g), R.revealStateKey(R.teacherGate({ lesson: { ...lesson, reveals: null }, files, sheets: SHEETS, now: TIMES.start + 600e3 })));
  assert.equal(R.revealStateKey({ on: false }), "");
});

test("D1: Einträge anhängen – nur einmal, höchstens so viele, der andere Teil bleibt; kaputter Wert wird ersetzt", async () => {
  const c = fakeCtx();
  c.db.raw.exec("INSERT INTO lessons(id, subject, klass, title, code, created_at, updated_at, reveals) VALUES('aaaaaaaaaaaaaaaa','powi','Q2-GK','x','K7QM4X',1,1,NULL), ('bbbbbbbbbbbbbbbb','powi','Q2-GK','y','K7QM4Y',1,1,'kaputt')");
  const add = (id, sql, e, key, max = 200) => c.db.prepare(sql).bind(id, JSON.stringify(e), key, max).run();
  assert.equal((await add("aaaaaaaaaaaaaaaa", R.REVEAL_SEEN_SQL, { k: "a", at: 1 }, "a")).results.length, 1);
  assert.equal((await add("aaaaaaaaaaaaaaaa", R.REVEAL_SEEN_SQL, { k: "a", at: 2 }, "a")).results.length, 0, "schon da");
  assert.equal((await add("aaaaaaaaaaaaaaaa", R.REVEAL_REF_SQL, { r: "s:ABC123", at: 3 }, "s:ABC123")).results.length, 1);
  assert.equal((await add("aaaaaaaaaaaaaaaa", R.REVEAL_SEEN_SQL, { k: "b", at: 4 }, "b", 1)).results.length, 0, "voll");
  assert.equal((await add("bbbbbbbbbbbbbbbb", R.REVEAL_SEEN_SQL, { k: "c", at: 5 }, "c")).results.length, 1);
  const row = (id) => c.db.raw.prepare("SELECT reveals FROM lessons WHERE id=?").get(id).reveals;
  assert.deepEqual(R.revealsOf(row("aaaaaaaaaaaaaaaa")), { seen: [{ k: "a", at: 1 }], refs: [{ r: "s:ABC123", at: 3 }] });
  assert.deepEqual(R.revealsOf(row("bbbbbbbbbbbbbbbb")), { seen: [{ k: "c", at: 5 }], refs: [] });
});

/* ---------- Schüleransicht und Datei-Link (worker/student.js) ---------- */
const LESSON = "aaaaaaaaaaaaaaaa", PRES = "0123456789abcdef", F_M2 = "1111111111111111", F_LINK = "2222222222222222", F_NF = "3333333333333333", TOKEN = "schueler-token-44", DEV = "dddddddddddddddd";
const SECRET = "nur-test-geheimnis-44";
async function setup({ klass = "Q2-GK", start = "08:00", date = "2026-11-24", sub = null, now = TIMES.start + 600e3 } = {}) {
  const c = fakeCtx({ SETTINGS_SECRET: SECRET }), db = c.db.raw;
  db.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, ?, 'powi', ?, ?, ?)").run(DEV, await sha256Hex(TOKEN), klass, now, now, now + 3600e3);
  db.prepare("INSERT INTO lessons(id, subject, klass, title, duration_min, lesson_date, start_time, code, student_ai, created_at, updated_at) VALUES(?, 'powi', ?, 'Wehrhafte Demokratie', 90, ?, ?, 'K7QM4X', 0, ?, ?)")
    .run(LESSON, klass, date, start, now, now);
  db.prepare("INSERT INTO student_access(device_id, lesson_id, joined_at) VALUES(?, ?, ?)").run(DEV, LESSON, now - 60e3);
  db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, pages, status, code_slides, created_at, updated_at) VALUES(?, ?, 'presentation', 'file', 'Wehrhafte Demokratie.pdf', 'application/pdf', 1000, 6, 'ready', ?, 1, 1)")
    .run(PRES, LESSON, JSON.stringify(CODE_SLIDES));
  db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, created_at, updated_at) VALUES(?, ?, 'student', 'file', 'M2 Karikatur.pdf', 'application/pdf', 500, 'ready', 2, 2)").run(F_M2, LESSON);
  db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, text, status, created_at, updated_at) VALUES(?, ?, 'student', 'link', 'Erklärvideo', 'https://example.org/video', 'ready', 3, 3)").run(F_LINK, LESSON);
  db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, fb_code, created_at, updated_at) VALUES(?, ?, 'student', 'file', 'Notfall-Feibeitsblatt – Die wehrhafte Demokratie.pdf', 'application/pdf', 400, 'ready', 'notfall', 'WHD4KT', 4, 4)").run(F_NF, LESSON);
  db.prepare("INSERT INTO fb_sheets(lesson_id, code, title, created_at) VALUES(?, 'WHD4KT', 'Die wehrhafte Demokratie', 5)").run(LESSON);
  if (sub) db.prepare("INSERT INTO substitutes(lesson_id, status, proposal, created_at, updated_at) VALUES(?, ?, '{}', 1, 1)").run(LESSON, sub);
  return { ...c, now, ip: "1.2.3.4", waitUntil: () => {} };
}
const get = (c, path = "") => ({ ...c, request: new Request("https://x/api/student/lessons/" + LESSON + path, { headers: { Authorization: "Bearer " + TOKEN } }) });
const post = (c, path) => ({ ...c, request: new Request("https://x" + path, { method: "POST", headers: { Authorization: "Bearer " + TOKEN } }) });
const lessonData = async (c) => (await routeStudentLesson(get(c), LESSON)).json();
const seeHead = (c, lines, at) => c.db.prepare(R.REVEAL_SEEN_SQL).bind(LESSON, JSON.stringify({ k: R.revealKeyOf(lines), at }), R.revealKeyOf(lines), 200).run();

test("Schüleransicht: Material mit Materialfolie fehlt (samt Notfall-Feibeitsblatt, ohne Titel und Code), bis die Folie live gezeigt wurde – dann da", async () => {
  const c = await setup();
  let d = await lessonData(c);
  assert.deepEqual(d.files.map((f) => f.id), [F_LINK], "nur der Link ohne Materialfolie");
  assert.deepEqual(d.sheets, []);
  assert.equal(d.revealAt, 0);
  const body = JSON.stringify(d);
  for (const s of ["WHD4KT", "wehrhafte Demokratie\"", "M2 Karikatur", F_M2, F_NF]) assert.ok(!body.includes(s), "nicht in der Antwort: " + s);
  assert.ok(!/notes/i.test(body), "kein „notes“ in den Daten der Schüler:innen");
  await seeHead(c, HEAD_FB, c.now - 1000);
  d = await lessonData(c);
  assert.deepEqual(d.sheets, [{ code: "WHD4KT", title: "Die wehrhafte Demokratie" }]);
  assert.deepEqual(d.files.map((f) => f.id), [F_LINK, F_NF]);
  assert.equal(d.files[1].notfall, true); assert.equal(d.revealAt, c.now - 1000);
  await seeHead(c, HEAD_M2, c.now);
  d = await lessonData(c);
  assert.deepEqual(d.files.map((f) => f.id), [F_M2, F_LINK, F_NF]);
});

test("Schüleransicht: nach der Freigabe der Präsentation ist alles da (bis zur letzten gezeigten Folie); ohne Beginn, in Jg. 5/6 und in der Selbstlern-Phase wie bisher", async () => {
  let c = await setup({ now: TIMES.presentationAt + 1 });
  assert.equal((await lessonData(c)).files.length, 3);
  c.db.raw.prepare("UPDATE files SET shown_until=4 WHERE id=?").run(PRES);
  assert.deepEqual((await lessonData(c)).files.map((f) => f.id), [F_LINK, F_NF], "Folie 5 (M2) liegt hinter der Markierung");
  c = await setup({ start: null });
  let d = await lessonData(c);
  assert.equal(d.files.length, 3); assert.equal(d.sheets.length, 1);
  c = await setup({ klass: "6B" });
  assert.equal((await lessonData(c)).files.length, 3);
  c = await setup({ sub: "aktiv" });
  assert.equal((await lessonData(c)).sheets.length, 1, "ältere Vertretung: die Lehrkraft zeigt nichts live");
});

test("Datei-Link: eine wartende Datei gibt es auch nicht über den Link (404) – nach der gezeigten Folie schon", async () => {
  const c = await setup();
  const link = (id) => routeStudentFileLink(post(c, "/api/student/files/" + id + "/link"), id);
  await assert.rejects(link(F_M2), (e) => e.status === 404);
  await assert.rejects(link(F_NF), (e) => e.status === 404, "Notfall-Feibeitsblatt wartet mit seinem Blatt");
  await seeHead(c, HEAD_M2, c.now);
  assert.match((await (await link(F_M2)).json()).url, /^\/api\/dl\/1111111111111111\?/);
  await seeHead(c, HEAD_FB, c.now);
  assert.equal((await link(F_NF)).status, 200);
  // ohne Präsentation: kein Warten
  const c2 = await setup();
  c2.db.raw.prepare("DELETE FROM files WHERE id=?").run(PRES);
  assert.equal((await routeStudentFileLink(post(c2, "/api/student/files/" + F_M2 + "/link"), F_M2)).status, 200);
});

test("Nachtrag 45: again – dasselbe Blatt ist auch mit einer früheren Sitzung desselben Kurses verknüpft (Datum bzw. Beginn); nie mit späteren, anderen Kursen oder als Finale", async () => {
  const c = await setup({ now: TIMES.presentationAt + 1 });
  const db = c.db.raw, ins = (id, klass, date, start, code, kind = "") => {
    db.prepare("INSERT INTO lessons(id, subject, klass, title, duration_min, lesson_date, start_time, code, created_at, updated_at) VALUES(?, 'powi', ?, 'x', 45, ?, ?, ?, 1, 1)").run(id, klass, date, start, "C" + id.slice(0, 5).toUpperCase().replace(/[^A-Z0-9]/g, "Z"));
    db.prepare("INSERT INTO fb_sheets(lesson_id, code, title, created_at, kind) VALUES(?, ?, 'Die wehrhafte Demokratie', 1, ?)").run(id, code, kind);
  };
  const again = async () => (await lessonData(c)).sheets.map((s) => !!s.again);
  assert.deepEqual(await again(), [false]);
  ins("bbbbbbbbbbbbbbbb", "Q2-GK", "2026-11-25", "08:00", "WHD4KT");   // später
  ins("cccccccccccccccc", "Q3-GK", "2026-11-20", "08:00", "WHD4KT");   // anderer Kurs
  ins("dddddddddddddddd", "Q2-GK", "2026-11-24", null, "WHD4KT");      // gleicher Tag ohne Beginn: unbekannte Reihenfolge
  assert.deepEqual(await again(), [false]);
  ins("eeeeeeeeeeeeeeee", "Q2-GK", "2026-11-24", "07:00", "WHD4KT", "escape");
  assert.deepEqual(await again(), [false], "als Finale eines Escape-Rooms zählt es nicht");
  ins("ffffffffffffffff", "Q2-GK", "2026-11-24", "07:00", "WHD4KT");
  assert.deepEqual(await again(), [true], "am selben Tag früher begonnen");
  db.prepare("DELETE FROM fb_sheets WHERE lesson_id='ffffffffffffffff'").run();
  ins("abababababababab", "Q2-GK", "2026-11-17", "10:00", "WHD4KT");
  const d = await lessonData(c);
  assert.deepEqual(d.sheets, [{ code: "WHD4KT", title: "Die wehrhafte Demokratie", again: true }]);
});

/* ---------- Durable Object: gezeigte Materialfolie vermerken, revealAt an alle ---------- */
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
async function join(room, role, extra = "") {
  const res = await room.fetch(new Request("https://live/ws?role=" + role + extra, UP));
  assert.equal(res.status, 101);
  return room.ctx.socks[room.ctx.socks.length - 1].ws;
}
const startMsg = { t: "start", fileId: PRES, pages: 6, slide: 0, code: "K7QM4X", title: "Wehrhafte Demokratie", codeSlides: CODE_SLIDES };

test("Durable Object: Materialfolie live → Überschrift in D1, allen der Stand noch einmal mit revealAt (dasselbe v); einmal je Überschrift; bleibt über stop und reset", async () => {
  const c = await setup();
  const room = new LiveRoom(roomCtx(), c.env);
  const t = await join(room, "teacher", "&lid=" + LESSON), s = await join(room, "student");
  assert.deepEqual(t.att, { lid: LESSON }, "die Verbindung der Lehrkraft kennt ihre Sitzung");
  await room.webSocketMessage(t, JSON.stringify(startMsg));
  await room.webSocketMessage(t, JSON.stringify({ t: "goto", slide: 1 }));
  assert.equal(s.last().revealAt, undefined, "Folie 1: nichts freigegeben");
  const n0 = s.msgs().length;
  await room.webSocketMessage(t, JSON.stringify({ t: "goto", slide: 3 }));
  const ms = s.msgs().slice(n0);
  assert.equal(ms.length, 2, "erst die Folie, dann der Stand mit revealAt");
  assert.equal(ms[0].revealAt, undefined); assert.ok(ms[1].revealAt > 0); assert.equal(ms[1].v, ms[0].v, "dasselbe v – ältere Seiten überspringen ihn");
  assert.equal(ms[1].view, "code"); assert.ok(!JSON.stringify(ms[1]).includes("Karikatur"));
  assert.equal(t.last().revealAt, ms[1].revealAt, "auch die Lehrkraft");
  const rv = R.revealsOf(c.db.raw.prepare("SELECT reveals FROM lessons WHERE id=?").get(LESSON).reveals);
  assert.deepEqual(rv.seen.map((x) => x.k), [R.revealKeyOf(HEAD_FB)]);
  assert.deepEqual((await lessonData(c)).sheets.map((x) => x.code), ["WHD4KT"], "die Schüleransicht zeigt das Feibeitsblatt jetzt");
  // dieselbe Folie noch einmal: kein zweiter Stand
  await room.webSocketMessage(t, JSON.stringify({ t: "goto", slide: 4 }));
  const n1 = s.msgs().length;
  await room.webSocketMessage(t, JSON.stringify({ t: "goto", slide: 3 }));
  assert.equal(s.msgs().length - n1, 1);
  // stop und reset: revealAt bleibt (auch im Stand per HTTP)
  const at = ms[1].revealAt;
  await room.webSocketMessage(t, JSON.stringify({ t: "stop" }));
  assert.equal(s.last().active, false); assert.equal(s.last().revealAt, at);
  await room.fetch(new Request("https://live/reset", { method: "POST" }));
  assert.equal((await (await room.fetch(new Request("https://live/state?role=student"))).json()).revealAt, at);
  // Freigabe von Hand: /reveal rückt nur vor
  await room.fetch(new Request("https://live/reveal?at=" + (at - 5), { method: "POST" }));
  assert.equal((await room.state()).revealAt, at);
  const n2 = s.msgs().length;
  await room.fetch(new Request("https://live/reveal?at=" + (at + 5), { method: "POST" }));
  assert.equal(s.msgs().length - n2, 1); assert.equal(s.last().revealAt, at + 5);
});

test("Durable Object: ohne Datenbank, ohne Kennung der Sitzung oder bei „Sitzungscode zeigen“ kein Vermerk – die Folie kommt trotzdem", async () => {
  const c = await setup();
  for (const [env, extra] of [[{ SETTINGS_SECRET: SECRET }, "&lid=" + LESSON], [c.env, ""], [c.env, "&lid=kaputt"]]) {
    const room = new LiveRoom(roomCtx(), env);
    const t = await join(room, "teacher", extra), s = await join(room, "student");
    await room.webSocketMessage(t, JSON.stringify({ ...startMsg, slide: 3 }));
    assert.equal(s.last().slide, 3); assert.equal(s.last().revealAt, undefined);
  }
  assert.equal(c.db.raw.prepare("SELECT reveals FROM lessons WHERE id=?").get(LESSON).reveals, null);
  // „Sitzungscode zeigen“ über Folie 5: keine Materialfolie
  const room = new LiveRoom(roomCtx(), c.env);
  const t = await join(room, "teacher", "&lid=" + LESSON);
  await room.webSocketMessage(t, JSON.stringify({ ...startMsg, slide: 2 }));
  await room.webSocketMessage(t, JSON.stringify({ t: "code", on: true }));
  assert.equal(c.db.raw.prepare("SELECT reveals FROM lessons WHERE id=?").get(LESSON).reveals, null);
  // ein Fehler in D1 hält nichts auf
  const broken = new LiveRoom(roomCtx(), { ...c.env, DB: { prepare: () => { throw new Error("D1 weg"); } } });
  const bt = await join(broken, "teacher", "&lid=" + LESSON), bs = await join(broken, "student");
  await broken.webSocketMessage(bt, JSON.stringify({ ...startMsg, slide: 3 }));
  assert.equal(bs.last().slide, 3);
});

test("stop behält revealAt (livestate); routeLiveSocket gibt der Lehrkraft die Sitzung mit", async () => {
  const st = { ...LIVE_IDLE, revealAt: 77 };
  liveReduce(st, startMsg, 1); liveReduce(st, { t: "stop" }, 2);
  assert.equal(st.revealAt, 77); assert.equal(st.active, false);
  assert.equal(LIVE_IDLE.revealAt, 0);
  const seen = [];
  const c = fakeCtx({ SETTINGS_SECRET: SECRET });
  c.env.LIVE = { idFromName: (n) => n, get: () => ({ fetch: async (req) => { seen.push(req.url); return new NativeResponse(null); } }) };
  const { liveTicket } = await import("../../worker/live.js");
  for (const role of ["teacher", "student"]) {
    const t = await liveTicket({ ...c, now: Date.now() }, LESSON, role, role === "teacher" ? "t" : DEV);
    await routeLiveSocket({ ...c, now: Date.now(), request: new Request("https://x" + t.url, UP) }, LESSON);
  }
  assert.ok(seen[0].includes("role=teacher&lid=" + LESSON), seen[0]);
  assert.ok(!seen[1].includes("lid="), "Schüler:innen nicht");
});

/* ---------- Lehrkraft: Freigabe von Hand, lessonOut, Stand ---------- */
const TTOKEN = "lehrkraft-token-44";
async function teacherCtx(c) {
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TTOKEN), c.now, c.now + 3600e3).run();
  const pokes = [];
  c.env.LIVE = { idFromName: (n) => n, get: (id) => ({ fetch: async (u, init) => { pokes.push([id, String(u), init && init.method]); return new NativeResponse("{}"); } }) };
  return { pokes, call: (fn, path, body, args = []) => fn({ ...c, request: new Request("https://x" + path, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + TTOKEN, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }) }, ...args) };
}

test("Freigabe von Hand: nur Material dieser Sitzung, gespeichert (einmal), das Durable Object meldet es allen; GET …/lessons/:id und der Stand zeigen es", async () => {
  const c = await setup();
  const { pokes, call } = await teacherCtx(c);
  const P0 = "/api/teacher/lessons/" + LESSON + "/reveal";
  const before = await (await call(L.routeLessonStamp, "/api/teacher/lessons/" + LESSON + "/stamp", null, [LESSON])).json();
  for (const ref of ["x", "f:123", "s:abc123", "", null]) await assert.rejects(call(L.routeLessonReveal, P0, { ref }, [LESSON]), (e) => e.status === 400, String(ref));
  await assert.rejects(call(L.routeLessonReveal, P0, { ref: "f:ffffffffffffffff" }, [LESSON]), (e) => e.status === 404);
  await assert.rejects(call(L.routeLessonReveal, P0, { ref: "s:ZZZ999" }, [LESSON]), (e) => e.status === 404);
  const r = await (await call(L.routeLessonReveal, P0, { ref: "f:" + F_M2 }, [LESSON])).json();
  assert.deepEqual(r.reveals, { seen: [], refs: [{ r: "f:" + F_M2, at: c.now }] });
  assert.deepEqual(pokes, [[LESSON, "https://live/reveal?at=" + c.now, "POST"]]);
  await call(L.routeLessonReveal, P0, { ref: "f:" + F_M2 }, [LESSON]);
  assert.equal(R.revealsOf(c.db.raw.prepare("SELECT reveals FROM lessons WHERE id=?").get(LESSON).reveals).refs.length, 1, "nur einmal");
  assert.deepEqual((await lessonData(c)).files.map((f) => f.id), [F_M2, F_LINK]);
  const g = await (await call(L.routeLessonGet, "/api/teacher/lessons/" + LESSON, null, [LESSON])).json();
  assert.deepEqual(g.lesson.reveals.refs, [{ r: "f:" + F_M2, at: c.now }]);
  assert.equal(g.sheets[0].code, "WHD4KT"); assert.equal(g.sheets[0].again, undefined);
  const after = await (await call(L.routeLessonStamp, "/api/teacher/lessons/" + LESSON + "/stamp", null, [LESSON])).json();
  assert.notEqual(after.stamp, before.stamp, "der Stand ändert sich – die Ansicht für den Unterricht lädt neu");
  assert.equal(after.stamp, g.stamp);
  assert.ok(!before.stamp.includes("~"), "ohne Freigaben bleibt der Stand wie bisher");
});

test("Befund der Gegenprüfung: Freigabe von Hand bei voller Liste → 409 (nie „sichtbar“), nichts gemeldet; eine zweite Freigabe meldet den gespeicherten Zeitpunkt", async () => {
  const c = await setup();
  const { pokes, call } = await teacherCtx(c);
  const P0 = "/api/teacher/lessons/" + LESSON + "/reveal";
  const full = { v: 1, refs: Array.from({ length: R.REVEAL_LIMITS.refs }, (_, i) => ({ r: "s:A" + String(i).padStart(3, "0") + "2B", at: i + 1 })) };
  c.db.raw.prepare("UPDATE lessons SET reveals=? WHERE id=?").run(JSON.stringify(full), LESSON);
  await assert.rejects(call(L.routeLessonReveal, P0, { ref: "f:" + F_M2 }, [LESSON]), (e) => e.status === 409 && e.code === "reveal_full" && /200 Freigaben von Hand/.test(e.message));
  assert.deepEqual(pokes, [], "nichts an die Schüler:innen gemeldet");
  assert.deepEqual((await lessonData(c)).files.map((f) => f.id), [F_LINK], "M2 wartet weiter");
  // eine Freigabe, die schon gespeichert ist (z. B. von einem zweiten Gerät): ok, gemeldet wird der gespeicherte (frühere) Zeitpunkt
  c.db.raw.prepare("UPDATE lessons SET reveals=? WHERE id=?").run(JSON.stringify({ v: 1, refs: [{ r: "f:" + F_M2, at: c.now - 5000 }] }), LESSON);
  const r = await (await call(L.routeLessonReveal, P0, { ref: "f:" + F_M2 }, [LESSON])).json();
  assert.deepEqual(r.reveals.refs, [{ r: "f:" + F_M2, at: c.now - 5000 }]);
  assert.deepEqual(pokes, [[LESSON, "https://live/reveal?at=" + (c.now - 5000), "POST"]], "die Seiten laden neu, bis ihre Daten diesen Zeitpunkt erreichen – er steht in D1");
});

test("Befund der Gegenprüfung: „Bis hier gezeigt“ nach der Freigabe der Präsentation nimmt kein sichtbares Material zurück (festgehalten); vor der Freigabe wie bisher", async () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 gekürzt");
  const put = async (c, until) => {
    const req = new Request("https://x/api/teacher/files/" + PRES + "/shown?until=" + until, { method: "PUT", body: pdf, headers: { Authorization: "Bearer " + TTOKEN, "Content-Type": "application/pdf", "Content-Length": String(pdf.length) } });
    return (await F.routeShownPut({ ...c, request: req }, PRES)).json();
  };
  // einen Tag nach der Stunde, Folien 3 und 5 nie live gezeigt: alles frei; die Lehrkraft markiert danach Folie 2 als letzte gezeigte
  let c = await setup({ now: TIMES.presentationAt + 864e5 });
  const { call } = await teacherCtx(c);
  assert.equal((await lessonData(c)).files.length, 3);
  let r = await put(c, 2);
  assert.equal(r.file.shownUntil, 2);
  assert.deepEqual(r.reveals.refs.map((x) => [x.r, x.at, x.e]).sort(), [["f:" + F_M2, TIMES.presentationAt, 1], ["s:WHD4KT", TIMES.presentationAt, 1]], "festgehalten (Zeitpunkt: Freigabe der Präsentation)");
  let d = await lessonData(c);
  assert.deepEqual(d.files.map((f) => f.id), [F_M2, F_LINK, F_NF], "bleibt sichtbar – samt Notfall-Feibeitsblatt");
  assert.deepEqual(d.sheets.map((x) => x.code), ["WHD4KT"]);
  assert.equal((await routeStudentFileLink(post(c, "/api/student/files/" + F_M2 + "/link"), F_M2)).status, 200);
  // noch einmal verschieben: nichts mehr festzuhalten
  r = await put(c, 4);
  assert.equal(r.reveals, undefined);
  // Lehrkraft: „seit der Freigabe der Präsentation“, kein „verborgen“
  const g = await (await call(L.routeLessonGet, "/api/teacher/lessons/" + LESSON, null, [LESSON])).json();
  const tg = R.teacherGate({ lesson: g.lesson, files: g.files, sheets: g.sheets, now: c.now });
  assert.equal(tg.hidden.size, 0); assert.equal(tg.items.get("f:" + F_M2).how, "end");
  // markiert vor der Freigabe der Präsentation (z. B. am Ende der Stunde): nichts festgehalten – Folie 5 bleibt danach verborgen (wie die Folie selbst)
  c = await setup({ now: TIMES.end + 60e3 });
  await teacherCtx(c);
  r = await put(c, 4);
  assert.equal(r.reveals, undefined);
  assert.equal(R.revealsOf(c.db.raw.prepare("SELECT reveals FROM lessons WHERE id=?").get(LESSON).reveals).refs.length, 0);
  c.now = TIMES.presentationAt + 60e3;
  assert.deepEqual((await lessonData(c)).files.map((f) => f.id), [F_LINK, F_NF]);
});

/* ---------- Connector: link_feibeitsblatt, Feibeitsblätter früherer Sitzungen in get_lesson ---------- */
async function mcp(c, name, args) {
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: name ? "tools/call" : "tools/list", params: name ? { name, arguments: args } : {} }) });
  return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
}
test("Connector link_feibeitsblatt: verknüpft ein vorhandenes Blatt (Titel aus der früheren Sitzung), again in der Antwort; Fehler bei Grundschule, ungültigem, unbekanntem Code und Finale", async () => {
  const c = await setup();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const db = c.db.raw;
  db.prepare("INSERT INTO lessons(id, subject, klass, title, duration_min, lesson_date, start_time, code, created_at, updated_at) VALUES('bbbbbbbbbbbbbbbb', 'powi', 'Q2-GK', 'Weiter mit der Demokratie', 90, '2026-11-26', '08:00', 'K7QM4Z', 1, 1)").run();
  db.prepare("INSERT INTO lessons(id, subject, klass, title, code, created_at, updated_at) VALUES('cccccccccccccccc', 'gs', 'gs1a2b3c4d', 'GS', 'G7QM4X', 1, 1)").run();
  db.prepare("INSERT INTO fb_sheets(lesson_id, code, title, created_at, kind) VALUES(?, 'ESC4PE', 'Finale', 1, 'escape')").run(LESSON);
  const tools = (await mcp(c, null)).tools, t = tools.find((x) => x.name === "link_feibeitsblatt");
  assert.ok(t && t.description.includes("Zwischenstopp") && t.description.includes("„wieder gebraucht“") && t.description.includes("nie erfinden") && t.inputSchema.required.join() === "lesson_id,code");
  // get_lesson der späteren Sitzung nennt das Blatt der früheren
  let tx = (await mcp(c, "get_lesson", { lesson_id: "bbbbbbbbbbbbbbbb" })).content[0].text;
  assert.ok(tx.includes("## Feibeitsblätter früherer Sitzungen dieses Kurses (wieder brauchen: link_feibeitsblatt mit dem Code)") && tx.includes("- „Die wehrhafte Demokratie“ (Code WHD-4KT) aus „Wehrhafte Demokratie“ vom Di, 24.11.2026") && !tx.includes("ESC-4PE"), tx.slice(tx.indexOf("## Feibeitsblätter früherer")));
  let r = await mcp(c, "link_feibeitsblatt", { lesson_id: "cccccccccccccccc", code: "WHD-4KT" });
  assert.ok(r.isError && r.content[0].text.includes("Grundschule"));
  r = await mcp(c, "link_feibeitsblatt", { lesson_id: "bbbbbbbbbbbbbbbb", code: "WH" });
  assert.ok(r.isError && r.content[0].text.includes("kein gültiger Feibeitsblatt-Code"));
  r = await mcp(c, "link_feibeitsblatt", { lesson_id: "bbbbbbbbbbbbbbbb", code: "QQQ777" });
  assert.ok(r.isError && r.content[0].text.includes("kennt Unterricks aus keiner Sitzung"));
  r = await mcp(c, "link_feibeitsblatt", { lesson_id: "bbbbbbbbbbbbbbbb", code: "ESC-4PE" });
  assert.ok(r.isError && r.content[0].text.includes("Finale eines Escape-Rooms"));
  r = await mcp(c, "link_feibeitsblatt", { lesson_id: "bbbbbbbbbbbbbbbb", code: "whd-4kt" });
  assert.ok(!r.isError && r.content[0].text.startsWith("Feibeitsblatt „Die wehrhafte Demokratie“ (Code WHD-4KT) ist mit der Sitzung verknüpft. Es ist auch mit einer früheren Sitzung dieses Kurses verknüpft"), r.content[0].text);
  assert.deepEqual(r.structuredContent, { code: "WHD4KT", title: "Die wehrhafte Demokratie", again: true });
  assert.deepEqual(db.prepare("SELECT code, title, kind FROM fb_sheets WHERE lesson_id='bbbbbbbbbbbbbbbb'").all().map((x) => ({ ...x })), [{ code: "WHD4KT", title: "Die wehrhafte Demokratie", kind: "" }]);
  tx = (await mcp(c, "get_lesson", { lesson_id: "bbbbbbbbbbbbbbbb" })).content[0].text;
  assert.ok(tx.includes("vom Di, 24.11.2026 – schon mit dieser Sitzung verknüpft"));
  // ein unbekannter Code mit Titel (die Lehrkraft hat ihn genannt); in der früheren Sitzung: nicht „wieder gebraucht“
  r = await mcp(c, "link_feibeitsblatt", { lesson_id: LESSON, code: "NEU2AB", titel: "Neues Blatt" });
  assert.ok(!r.isError && r.content[0].text.includes("Mit einer früheren Sitzung dieses Kurses ist es nicht verknüpft") && r.structuredContent.again === false);
});

test("Prompts: Materialfolie erscheint erst live (nicht Jg. 5/6); Zwischenstopp – Feibeitsblatt im offenen Teil mit link_feibeitsblatt (nur Gymnasium)", () => {
  const ctx = { subject: "powi", klass: "Q2-GK", lesson: { title: "T", durationMin: 90, topic: "x", ideas: "" }, materials: [], sheets: [{ code: "WHD4KT", title: "Die wehrhafte Demokratie" }] };
  const p = S.claudePresentationPrompt(ctx, "**1) Einstieg**", []);
  const mat = p.slice(p.indexOf("## Materialfolien"), p.indexOf("## Zeitlos gestalten"));
  assert.ok(mat.includes(S.MATERIAL_SLIDE_REVEAL) && S.MATERIAL_SLIDE_REVEAL.includes("erst, wenn diese Folie live gezeigt wird"));
  assert.ok(!S.claudePresentationPrompt({ ...ctx, klass: "6B" }, "**1) Einstieg**", []).includes(S.MATERIAL_SLIDE_REVEAL), "Jg. 5/6: Material auf Papier");
  const prev = { id: "abcdefabcdefabcd", title: "Vorige", date: "2026-11-17", portal: "**1) A**\n⏸ Zwischenstopp\n**2) B**", done: "**1) A**", open: "**2) B**", row: null };
  const ich = P.stopRules(prev, {}).join("\n"), lk = P.stopRules(prev, { who: "lk", save: true }).join("\n"), chat = P.stopRules(prev, { who: "lk", save: false }).join("\n");
  assert.ok(ich.includes("Feibeitsblatt im offenen Teil: Arbeiten die Schüler:innen dabei mit einem Feibeitsblatt der vorigen Stunde weiter, verknüpfe es mit `link_feibeitsblatt` mit dieser Sitzung"));
  assert.ok(lk.includes("`link_feibeitsblatt`") && lk.includes("„wieder gebraucht“"));
  assert.ok(chat.includes("weise die Lehrkraft darauf hin, es in dieser Sitzung unter „Vorhandenes Feibeitsblatt verknüpfen“ zu verknüpfen") && !chat.includes("link_feibeitsblatt"));
  assert.ok(!P.stopRules(prev, { gs: true }).join("\n").includes("Feibeitsblatt im offenen Teil"), "Grundschule: keine Feibeitsblätter");
  assert.ok(!P.stopRules({ ...prev, decision: { choice: "verzichten", at: 1 } }, {}).join("\n").includes("Feibeitsblatt im offenen Teil"), "verzichtet: nichts wieder gebraucht");
});

test("Schüler:innen-Seite: revealAt vor der Prüfung von v, Neuladen der Daten verzögert, Material neu gezeichnet, wieder gebrauchtes Feibeitsblatt", async () => {
  const { readFileSync } = await import("node:fs");
  const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
  const i = app.indexOf("rw.want(st.revealAt);");
  assert.ok(i > 0 && i < app.indexOf("if (st.v !== undefined && st.v === lastV && st.active) return;"), "vor der Prüfung von v (dasselbe v)");
  assert.ok(app.includes("const rw = revealWatch({ seen: d.revealAt, reload: () => refresh() });") && app.includes("paintMats(r);") && app.includes("if (s.again) return fbAgainItem(s, url, { leave: onLeave });"));
  assert.ok(app.includes('"Neues Material: "') && app.includes('"aria-live": "polite", id: "mat-live"'));
  // Befunde der Gegenprüfung: nur eine geglückte Antwort rückt den Stand vor, danach weitere Versuche; Antworten in der Reihenfolge der Anfragen; sichtbar → nachholen
  const r = app.slice(app.indexOf("const refresh = async () => {"), app.indexOf("let chT = null;"));
  assert.ok(r.includes("const my = order.start();") && r.includes("if (gone || !order.take(my)) return;") && r.indexOf("rw.seen(r.revealAt);") < r.indexOf("paintMats(r);"));
  assert.ok(r.includes("finally { rw.after(); }"), "nach jedem Neuladen – auch einem gescheiterten – prüft die Seite, ob noch etwas fehlt");
  assert.ok(app.includes("if (rw.visible() || pending.some((t) => Date.now() + offset >= t) || Date.now() - loadedAt >= NEWER_RECHECK_MS) refresh(); else if (soon) plan();"));
  assert.ok(app.includes("onLeave(() => { gone = true; rw.stop(); });"));
  // „neu“ nur für das zuletzt Erschienene
  assert.ok(app.includes("for (const row of freshRows) if (!fresh.some((x) => x.row === row)) { row.classList.remove(\"fresh\"); const b = row.querySelector(\".badge.neu\"); if (b) b.remove(); }"));
});

test("revealWatch: neuer Stand → Neuladen nach 0–2 s; erst eine geglückte Antwort zählt; scheitert es, weitere Versuche (2, 4, 8, 16, 32, 60 s), danach erst beim Sichtbarwerden", () => {
  const timers = [], loads = [];
  let rnd = 0.5;
  const set = (fn, ms) => { const t = { fn, ms, on: true }; timers.push(t); return t; }, clear = (t) => { t.on = false; };
  const fire = () => { const t = timers.filter((x) => x.on).pop(); assert.ok(t, "ein Zeitgeber läuft"); t.on = false; t.fn(); return t.ms; };
  const w = R.revealWatch({ seen: 100, reload: () => loads.push(1), random: () => rnd, setT: set, clearT: clear });
  w.want(undefined); w.want(90); w.want(100);
  assert.equal(timers.length, 0, "kein neuerer Stand: nichts");
  w.want(200);
  assert.equal(fire(), 1000, "zufällig 0–2 s später"); assert.equal(loads.length, 1);
  // Neuladen gescheitert (keine Antwort): weitere Versuche mit wachsendem Abstand
  const gaps = [];
  for (let k = 0; k < 6; k++) { w.after(); gaps.push(fire()); }
  assert.deepEqual(gaps, R.REVEAL_RETRY_MS.map((x) => x + 1000));
  w.after();
  assert.equal(timers.filter((x) => x.on).length, 0, "nach sechs Versuchen keine weiteren");
  assert.deepEqual(w.state, { want: 200, seen: 100, tries: 6, pending: false });
  assert.equal(w.visible(), true, "die Seite wird wieder sichtbar: jetzt neu laden");
  w.after(); assert.equal(timers.filter((x) => x.on).length, 1, "… und wieder von vorn versuchen");
  // eine Antwort mit älterem Stand (die Anfrage begann vor der Freigabe) genügt nicht; eine mit dem Stand schon
  w.seen(150); w.after(); assert.equal(w.state.seen, 150); assert.equal(w.state.pending, true);
  w.seen(200); w.after();
  assert.deepEqual(w.state, { want: 200, seen: 200, tries: 0, pending: false }, "erreicht: kein weiterer Versuch");
  assert.equal(w.visible(), false);
  // läuft schon ein Zeitgeber (zwei Anfragen gleichzeitig), zählt kein Versuch; ein neuer Stand während eines langen Wartens: sofort wieder kurz
  w.want(300); w.after(); w.after();
  assert.equal(w.state.tries, 0); assert.equal(timers.filter((x) => x.on).length, 1);
  fire(); w.after(); w.after(); fire(); w.after();
  assert.equal(w.state.tries, 2);
  rnd = 0; w.want(400);
  assert.equal(timers.filter((x) => x.on).length, 1); assert.equal(fire(), 0);
  // nach dem Verlassen der Seite nichts mehr
  w.stop(); w.want(500); w.after();
  assert.equal(timers.filter((x) => x.on).length, 0);
});

test("latestOnly: die Antwort einer früher gestellten Anfrage gilt nicht mehr, wenn eine spätere schon angewendet ist", () => {
  const o = R.latestOnly();
  const a = o.start(), b = o.start(), c2 = o.start();
  assert.equal(o.take(b), true, "B kommt zuerst an"); assert.equal(o.take(a), false, "A (früher gestellt) danach: verworfen");
  assert.equal(o.take(c2), true);
  const d = o.start(), e = o.start();
  assert.equal(o.take(d), true, "in Reihenfolge: beide"); assert.equal(o.take(e), true);
  const f = o.start(); o.start();
  assert.equal(o.take(f), true, "die spätere scheitert: die frühere gilt trotzdem (sie ist neuer als das Gezeigte)");
});
