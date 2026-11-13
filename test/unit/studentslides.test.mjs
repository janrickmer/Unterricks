// Folienfenster der Schüler:innen nach der Sitzung (Nachtrag 19): Route POST /api/student/lessons/:id/presentation-slides (worker/student.js)
// und die Prüfung beim Ausliefern der Folienbilder (worker/files.js routeSlide) – mit D1 auf SQLite und R2 als Map.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
// worker/student.js bindet über live.js das Durable Object aus „cloudflare:workers“ ein: Attrappe der Basisklasse
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript," + encodeURIComponent("export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }"), shortCircuit: true } : n(s, c); }'));
const { fakeCtx } = await import("./fake-d1.mjs");
const { routeStudentPresentationSlides, routeStudentPresentationLink } = await import("../../worker/student.js");
const { routeSlide, slideKey, studentSlideExp, STUDENT_SLIDE_WINDOW_MS, slideUrl } = await import("../../worker/files.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { lessonTimes, STUDENT_SLIDE_BLOCK } = await import("../../public/shared.js");

const LESSON = "aaaaaaaaaaaaaaaa", FILE = "0123456789abcdef", TOKEN = "schueler-token-123", DEV = "dddddddddddddddd";
const DATE = "2026-11-13", START = "08:00", SECRET = "nur-test-geheimnis-16";
const T = lessonTimes({ date: DATE, startTime: START, durationMin: 90 });

async function setup({ pages = 12, shownUntil = 7, slides = pages, joined = true, presentation = true } = {}) {
  const c = fakeCtx({ SETTINGS_SECRET: SECRET }), now = T.presentationAt + 60e3;
  const db = c.db.raw;
  db.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, 'Q2G', 'powi', ?, ?, ?)")
    .run(DEV, await sha256Hex(TOKEN), now, now, now + 3600e3);
  db.prepare("INSERT INTO lessons(id, subject, klass, title, duration_min, lesson_date, start_time, code, created_at, updated_at) VALUES(?, 'powi', 'Q2G', 'Gewaltenteilung', 90, ?, ?, 'K7QM4X', ?, ?)")
    .run(LESSON, DATE, START, now, now);
  if (joined) db.prepare("INSERT INTO student_access(device_id, lesson_id, joined_at) VALUES(?, ?, ?)").run(DEV, LESSON, now - 7200e3);
  if (presentation) {
    db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, pages, status, shown_until, cut_size, created_at, updated_at) VALUES(?, ?, 'presentation', 'file', 'Gewaltenteilung.pdf', 'application/pdf', 1000, ?, 'ready', ?, ?, ?, ?)")
      .run(FILE, LESSON, pages, shownUntil, shownUntil ? 500 : null, now, now);
    for (let n = 1; n <= slides; n++) {
      db.prepare("INSERT INTO slides(file_id, n, size, w, h) VALUES(?, ?, 3, 1920, 1080)").run(FILE, n);
      await c.env.FILES.put(slideKey(LESSON, FILE, n), new Uint8Array([n, n, n]));
    }
  }
  return { ...c, now, ip: "1.2.3.4", waitUntil: () => {} };
}
const post = (c, body, path = "presentation-slides") => ({ ...c, request: new Request("https://x/api/student/lessons/" + LESSON + "/" + path, {
  method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
const slides = async (c, body) => (await routeStudentPresentationSlides(post(c, body), LESSON)).json();
const fetchSlide = (c, url) => { const u = new URL("https://x" + url), m = /^\/api\/slide\/([a-f0-9]{16})\/(\d+)$/.exec(u.pathname); return routeSlide({ ...c, request: new Request(u) }, m[1], m[2]); };
const rejects = (p, status, code) => assert.rejects(p, (e) => e.status === status && (!code || e.code === code));

test("vor der Freigabe (5 Minuten nach dem Ende) und ohne Beginn: 403 not_yet", async () => {
  const c = await setup();
  await rejects(routeStudentPresentationSlides(post({ ...c, now: T.presentationAt - 1 }, { from: 1, to: 10 }), LESSON), 403, "not_yet");
  c.db.raw.prepare("UPDATE lessons SET start_time=NULL").run();
  await rejects(routeStudentPresentationSlides(post(c, { from: 1 }), LESSON), 403, "not_yet");
});

test("nach der Freigabe: nur Folie 1 bis zur markierten letzten gezeigten Folie, höchstens ein Block je Anfrage", async () => {
  const c = await setup({ pages: 12, shownUntil: 7 });
  const r = await slides(c, { from: 1, to: 10 });
  assert.equal(r.total, 7);
  assert.deepEqual(r.slides.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7], "bis zur Markierung gekürzt");
  assert.deepEqual([r.slides[0].w, r.slides[0].h], [1920, 1080], "Maße für das Seitenverhältnis");
  for (const s of r.slides) {
    assert.match(s.url, /^\/api\/slide\/0123456789abcdef\/\d+\?p=st&e=\d+&s=/);
    const res = await fetchSlide(c, s.url);
    assert.equal(res.status, 200);
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], [s.n, s.n, s.n]);
  }
  // ohne Markierung alle, aber je Anfrage höchstens STUDENT_SLIDE_BLOCK Links (je Folie ein HMAC)
  const c2 = await setup({ pages: 30, shownUntil: null });
  const r2 = await slides(c2, { from: 1, to: 30 });
  assert.equal(r2.total, 30); assert.equal(r2.slides.length, STUDENT_SLIDE_BLOCK); assert.equal(r2.to, STUDENT_SLIDE_BLOCK);
  const r3 = await slides(c2, { from: 21, to: 40 });
  assert.deepEqual(r3.slides.map((s) => s.n), [21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
});

test("Nummern außerhalb: jenseits der Markierung 403 not_shown (mit total), ungültige 400 – auch kein Folienbild durch Raten", async () => {
  const c = await setup({ pages: 12, shownUntil: 7 });
  await rejects(routeStudentPresentationSlides(post(c, { from: 8, to: 10 }), LESSON), 403, "not_shown");
  await assert.rejects(routeStudentPresentationSlides(post(c, { from: 12 }), LESSON), (e) => e.status === 403 && e.extra && e.extra.total === 7 && /im Unterricht nicht gekommen/.test(e.message));
  for (const body of [{ from: 0, to: 3 }, { from: -1 }, { from: 2.5 }, { from: "x" }, { from: 5, to: 3 }, {}]) await rejects(routeStudentPresentationSlides(post(c, body), LESSON), 400);
  // ein gültiger Link für Folie 3 mit veränderter Nummer bzw. ohne p=st, oder mit Signatur der Lehrkraft-Scope-Folie: nichts
  const { slides: [, , s3] } = await slides(c, { from: 1 , to: 7 });
  await rejects(fetchSlide(c, s3.url.replace("/3?", "/9?")), 403);
  await rejects(fetchSlide(c, s3.url.replace("p=st&", "")), 403);
  await rejects(fetchSlide(c, s3.url.replace(/e=\d+/, "e=" + (c.now + 864e5))), 403);
});

test("Markierung nach dem Abruf zurückgesetzt: ein noch gültiger Link jenseits der neuen Markierung liefert nichts", async () => {
  const c = await setup({ pages: 12, shownUntil: 7 });
  const r = await slides(c, { from: 1, to: 7 });
  c.db.raw.prepare("UPDATE files SET shown_until=2").run();
  assert.equal((await fetchSlide(c, r.slides[1].url)).status, 200, "Folie 2 bleibt");
  await rejects(fetchSlide(c, r.slides[4].url), 403, "link_expired");
  // Markierung aufgehoben: wieder alle; Präsentation ersetzt (noch nicht bereit): nichts
  c.db.raw.prepare("UPDATE files SET shown_until=NULL").run();
  assert.equal((await fetchSlide(c, r.slides[4].url)).status, 200);
  c.db.raw.prepare("UPDATE files SET status='processing'").run();
  await rejects(fetchSlide(c, r.slides[0].url), 403);
  // die Live-Links der Lehrkraft bzw. der laufenden Präsentation (ohne p=st) prüfen keine Markierung (unverändert)
  c.db.raw.prepare("UPDATE files SET status='ready', shown_until=2").run();
  assert.equal((await fetchSlide(c, await slideUrl(SECRET, FILE, 9, 60e3, c.now))).status, 200);
});

test("ohne Freischaltung 403, ohne Präsentation 404, ältere Präsentation ohne Folienbilder: leere Liste", async () => {
  await rejects(routeStudentPresentationSlides(post(await setup({ joined: false }), { from: 1 }), LESSON), 403, "no_access");
  await rejects(routeStudentPresentationSlides(post(await setup({ presentation: false }), { from: 1 }), LESSON), 404, "not_found");
  const r = await slides(await setup({ pages: 5, shownUntil: null, slides: 0 }), { from: 1, to: 5 });
  assert.equal(r.total, 5); assert.deepEqual(r.slides, []);
});

test("ohne Anmeldung 401, abgelaufene Anmeldung 403; aus einer anderen Sitzung nichts – weder Links noch Folienbilder", async () => {
  const c = await setup({ pages: 12, shownUntil: 7 });
  const req = (headers, lesson = LESSON) => ({ ...c, request: new Request("https://x/api/student/lessons/" + lesson + "/presentation-slides", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ from: 1, to: 7 }) }) });
  await rejects(routeStudentPresentationSlides(req({}), LESSON), 401, "unauthorized");
  await rejects(routeStudentPresentationSlides(req({ Authorization: "Bearer falsch" }), LESSON), 401, "unauthorized");
  await rejects(routeStudentPresentationSlides({ ...req({ Authorization: "Bearer " + TOKEN }), now: c.now + 2 * 3600e3 }, LESSON), 403, "session_expired");
  // zweite Sitzung mit eigener Präsentation, für die dieses Gerät nicht freigeschaltet ist
  const L2 = "bbbbbbbbbbbbbbbb", F2 = "fedcba9876543210", db = c.db.raw;
  db.prepare("INSERT INTO lessons(id, subject, klass, title, duration_min, lesson_date, start_time, code, created_at, updated_at) VALUES(?, 'powi', 'Q2G', 'Andere', 90, ?, ?, 'P3RT7Z', ?, ?)").run(L2, DATE, START, c.now, c.now);
  db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, pages, status, created_at, updated_at) VALUES(?, ?, 'presentation', 'file', 'Andere.pdf', 'application/pdf', 1000, 5, 'ready', ?, ?)").run(F2, L2, c.now, c.now);
  for (let n = 1; n <= 5; n++) { db.prepare("INSERT INTO slides(file_id, n, size, w, h) VALUES(?, ?, 3, 1920, 1080)").run(F2, n); await c.env.FILES.put(slideKey(L2, F2, n), new Uint8Array([9, 9, n])); }
  await rejects(routeStudentPresentationSlides(req({ Authorization: "Bearer " + TOKEN }, L2), L2), 403, "no_access");
  // ein Link der eigenen Sitzung mit der Datei-Kennung der anderen: Signatur passt nicht
  const { slides: [s1] } = await slides(c, { from: 1, to: 1 });
  await rejects(fetchSlide(c, s1.url.replace(FILE, F2)), 403, "link_expired");
  await rejects(fetchSlide(c, "/api/slide/" + F2 + "/1?p=st&e=" + (c.now + 60e3) + "&s=AAAA"), 403);
  await rejects(fetchSlide(c, "/api/slide/" + F2 + "/1"), 403);
});

test("Ablauf auf Viertelstunden gerundet (15–30 Minuten): dieselben Folien bekommen innerhalb eines Fensters dieselben Adressen", async () => {
  const c = await setup({ pages: 12, shownUntil: null });
  const t0 = Math.ceil(c.now / STUDENT_SLIDE_WINDOW_MS) * STUDENT_SLIDE_WINDOW_MS + 1000;   // knapp nach Beginn eines Fensters
  const a = await slides({ ...c, now: t0 }, { from: 1, to: 3 }), b = await slides({ ...c, now: t0 + 10 * 60e3 }, { from: 1, to: 3 });
  assert.deepEqual(a.slides.map((s) => s.url), b.slides.map((s) => s.url));
  assert.equal(a.exp, studentSlideExp(t0));
  for (const t of [t0, t0 + 14 * 60e3]) { const left = studentSlideExp(t) - t; assert.ok(left >= 15 * 60e3 && left <= 30 * 60e3, String(left)); }
  await rejects(fetchSlide({ ...c, now: a.exp + 1 }, a.slides[0].url), 403, "link_expired");
});

test("D1: höchstens 5 Anweisungen je Abruf (Gerät, Freischaltung, Präsentation, Folien)", async () => {
  const c = await setup({ pages: 12, shownUntil: 7 });
  const before = c.db.counter.n;
  await slides(c, { from: 1, to: 10 });
  assert.ok(c.db.counter.n - before <= 5, String(c.db.counter.n - before));
});

test("„Diese Präsentation herunterladen“: weiter die gekürzte PDF als Anhang (presentation-link mit inline:false)", async () => {
  const c = await setup({ pages: 12, shownUntil: 7 });
  const r = await (await routeStudentPresentationLink(post(c, { inline: false }, "presentation-link"), LESSON)).json();
  assert.match(r.url, /\/api\/dl\/0123456789abcdef\?d=a&p=cut&e=/);
  c.db.raw.prepare("UPDATE files SET cut_size=NULL").run();
  await rejects(routeStudentPresentationLink(post(c, { inline: false }, "presentation-link"), LESSON), 409, "not_ready");
});
