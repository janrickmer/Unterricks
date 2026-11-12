// Elternansicht der Grundschule (Slice S8): geheimer Link je Sitzung (nur Hash + verschlüsselte Kopie gespeichert), Zeitsperre bis zum Ende,
// Inhalt (Hinweis, Bildkarten, Inhalt, Hausaufgabe, Material bis zum Zwischenstopp), vorherige Sitzungen des Schuljahres, PDF-Links, Sperre je IP,
// Vorschau der Lehrkraft ohne Zeitsperre, Link erneuern – mit der D1-Nachbildung aus fake-d1.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const { fakeCtx } = await import("./fake-d1.mjs");
const GS = await import("../../worker/gs.js");
const L = await import("../../worker/lessons.js");
const F = await import("../../worker/files.js");
const CA = await import("../../worker/cards.js");
const PA = await import("../../worker/parents.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex, LOCKS } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");

const TOKEN = "lehrkraft-token-123";
const NOW = Date.parse("2026-11-12T10:00:00Z");
const PDF = (pages) => new TextEncoder().encode("%PDF-1.4\n1 0 obj << /Type /Pages /Count " + pages + " >> endobj\n%%EOF");
const IMG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const call = async (c, fn, method, path, body, ...args) => {
  const raw = body instanceof Uint8Array;
  const headers = { Authorization: "Bearer " + TOKEN, "Content-Type": raw ? "application/pdf" : "application/json" };
  if (raw) headers["Content-Length"] = String(body.length);
  const req = new Request("https://unterricks.test" + path, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: c.ip || "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, headers: res.headers, data: res.headers.get("content-type")?.includes("json") ? await res.json() : res }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code, ...(e.extra || {}) } }; }
};
// öffentlich: ohne Anmeldung
const pub = async (c, fn, body, ip = "9.8.7.6") => {
  const req = new Request("https://unterricks.test/api/eltern/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip, waitUntil: () => {} }); return { status: res.status, headers: res.headers, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code } }; }
};
const put = async (c, fn, path, bytes, ct, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method: "PUT", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": ct, "Content-Length": String(bytes.length) }, body: bytes });
  const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() };
};
const upload = (c, lessonId, name, area = "student") => call(c, F.routeFileUpload, "POST", "/api/teacher/lessons/" + lessonId + "/files?area=" + area + "&name=" + encodeURIComponent(name), PDF(1), lessonId);

async function setup() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = NOW;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", { grade: 2, classes: ["a", "b"], religion: true, weekdays: [{ day: 2, minutes: 45, time: "08:00" }], classSize: 22 })).data.course;
  const other = (await call(c, GS.routeGsCourseCreate, "POST", "/api/teacher/gs/courses", { grade: 3, classes: ["c"], religion: false, subjectName: "Sachunterricht", weekdays: [{ day: 3, minutes: 45, time: "09:00" }] })).data.course;
  const mk = (klass, title, date, extra = {}) => L.createLesson(c.db, { subject: "gs", klass, title, date, startTime: "08:00", durationMin: 45, ...extra }, c.now - 1000 + Math.floor(Math.random() * 100));
  const old = await mk(course.id, "Vorjahr: Abraham", "2026-06-02");            // anderes Schuljahr
  const l1 = await mk(course.id, "Josef und seine Brüder", "2026-11-03");
  const l2 = await mk(course.id, "Josef in Ägypten", "2026-11-10");
  const l3 = await mk(course.id, "Josef verzeiht", "2026-11-17");               // noch nicht stattgefunden
  const x = await mk(other.id, "Wasserkreislauf", "2026-11-04");
  const sek = await L.createLesson(c.db, { subject: "powi", klass: "8B", title: "Gewaltenteilung", date: "2026-11-10" }, c.now);
  return { c, course, other, old, l1, l2, l3, x, sek };
}
const link = async (c, id, body = {}) => (await call(c, PA.routeTeacherParentLink, "POST", "/api/teacher/lessons/" + id + "/parent-link", body, id));

test("Link: nur Grundschule, nur Hash + verschlüsselte Kopie gespeichert, derselbe Link erneut kopierbar, Erneuern macht den alten ungültig", async () => {
  const { c, l2, sek } = await setup();
  assert.equal((await link(c, sek.id)).status, 400);
  let r = await call(c, PA.routeTeacherParentLink, "GET", "/x", undefined, l2.id);
  assert.deepEqual([r.status, r.data.token], [200, null]);
  r = await link(c, l2.id);
  const tok = r.data.token;
  assert.ok(PA.TOKEN_RE.test(tok) && r.data.created === true && r.data.opensAt === Date.parse("2026-11-10T07:45:00Z"));
  const row = await c.db.prepare("SELECT parent_hash, parent_sealed FROM lessons WHERE id=?1").bind(l2.id).first();
  assert.equal(row.parent_hash, await PA.parentHash(tok));
  assert.ok(row.parent_sealed && !row.parent_sealed.includes(tok), "das Token steht nie im Klartext in D1");
  assert.equal((await link(c, l2.id)).data.token, tok, "noch einmal kopieren: derselbe Link");
  assert.equal((await call(c, PA.routeTeacherParentLink, "GET", "/x", undefined, l2.id)).data.token, tok);
  // nie in der Sitzung selbst (Lehrkraft) und nie im Connector
  const lg = (await call(c, L.routeLessonGet, "GET", "/x", undefined, l2.id)).data;
  assert.equal(lg.lesson.hasParentLink, true);
  assert.ok(!JSON.stringify(lg).includes(tok) && !JSON.stringify(lg).includes(row.parent_hash) && !JSON.stringify(lg).includes(row.parent_sealed));
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "get_lesson", arguments: { lesson_id: l2.id } } }) });
  const txt = JSON.stringify(await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json());
  assert.ok(!txt.includes(tok) && !txt.includes(row.parent_hash), "get_lesson ohne Token");
  // erneuern: neuer Link, der alte ist ungültig
  const t2 = (await link(c, l2.id, { renew: true })).data.token;
  assert.ok(t2 !== tok && PA.TOKEN_RE.test(t2));
  assert.equal((await pub(c, PA.routeParentLesson, { token: tok })).status, 404);
  assert.equal((await pub(c, PA.routeParentLesson, { token: t2 })).status, 200);
});

test("Elternansicht: Zeitsperre, Inhalt (Hinweis, Bildkarten, Inhalt, Hausaufgabe, Material bis zum Zwischenstopp), nie Ideen/Verlaufsplan/Code; ≤ 5 D1-Anweisungen", async () => {
  const { c, l1, l2, l3 } = await setup();
  // Material: Vorlesetext (nur Lehrkraft) in l1, Blatt der Kinder in l1 (Verweis aus l2), zwei Blätter der Kinder in l2, eins davon nach dem Zwischenstopp; ein Blatt einer späteren Sitzung
  const vor = (await upload(c, l1.id, "Vorlesetext.pdf", "teacher")).data.file;
  const ab1 = (await upload(c, l1.id, "Ausmalbild Josef.pdf")).data.file;
  const ab2 = (await upload(c, l2.id, "Arbeitsblatt Ägypten.pdf")).data.file;
  const rae = (await upload(c, l2.id, "Rätsel.pdf")).data.file;
  const later = (await upload(c, l3.id, "Später.pdf")).data.file;
  const cards = (await call(c, CA.routeCardsUpload, "POST", "/x?name=Josef.pdf&share=0", PDF(2), l2.id)).data.file;
  for (const n of [1, 2]) await put(c, F.routeSlideUpload, "/x?w=1600&h=1131", IMG, "image/jpeg", cards.id, String(n));
  await call(c, CA.routeCardsReady, "POST", "/x", { pages: 2, version: cards.cards.version }, cards.id);
  await call(c, CA.routeCardsPut, "PUT", "/x", { texts: ["Josef kommt nach Ägypten.", "Josef verzeiht."], share: true, rev: 0 }, cards.id);
  const plan = "**1) Erzählung**\n- __Lehrkraft liest [[pdf:" + vor.id + "]] vor.__\n- [[pdf:" + cards.id + "]]\n**2) Arbeit**\n- [[pdf:" + ab1.id + "]] und [[pdf:" + later.id + "]]\n- [[pdf:" + ab2.id + "]]\n⏸ Zwischenstopp\n- [[pdf:" + rae.id + "]]";
  await L.savePortal(c.db, l2.id, plan, 0, "claude", c.now);
  await L.updateLesson(c.db, l2.id, { parentSummary: "Wir haben gehört, wie Josef nach Ägypten kam.", parentNote: "Bitte Malstifte mitgeben.", homework: "Male ein Bild.", ideas: "GEHEIME IDEE" }, c.now);
  const tok = (await link(c, l2.id)).data.token;
  c.db.counter.n = 0;
  let r = await pub(c, PA.routeParentLesson, { token: tok });
  assert.ok(c.db.counter.n <= 5, "D1-Anweisungen: " + c.db.counter.n);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("X-Robots-Tag"), "noindex, nofollow"); assert.equal(r.headers.get("Cache-Control"), "no-store");
  const d = r.data;
  assert.equal(d.state, "open");
  assert.equal(d.note, "Bitte Malstifte mitgeben.");
  assert.equal(d.summary, "Wir haben gehört, wie Josef nach Ägypten kam.");
  assert.deepEqual(d.homework, { text: "Male ein Bild.", dueDate: "2026-11-17" });
  assert.deepEqual(d.course, { label: "Religion · Jahrgang 2 (Klassen 2a, 2b)" });
  assert.deepEqual(d.lesson, { id: l2.id, date: "2026-11-10", startTime: "08:00", title: "Josef in Ägypten" });
  assert.deepEqual(d.files.map((f) => f.name), ["Ausmalbild Josef.pdf", "Arbeitsblatt Ägypten.pdf"], "nur Blätter der Kinder vor dem Zwischenstopp, nie aus späteren Sitzungen, nie die der Lehrkraft");
  assert.equal(d.cards.length, 1);
  assert.deepEqual([d.cards[0].fileId, d.cards[0].pages, d.cards[0].w, d.cards[0].h, d.cards[0].texts], [cards.id, 2, 1600, 1131, ["Josef kommt nach Ägypten.", "Josef verzeiht."]]);
  assert.ok(d.cards[0].img.base === "/api/card/" + cards.id + "/" && /^\?e=\d+&s=/.test(d.cards[0].img.q));
  assert.equal(d.hasPrevious, true);
  const s = JSON.stringify(d);
  for (const bad of ["GEHEIME IDEE", "Zwischenstopp", "Lehrkraft liest", "ideas", "portal", "code", "description", "Vorlesetext", "Rätsel", "Später", tok]) assert.ok(!s.includes(bad), "nicht in der Nutzlast: " + bad);
  // Bildkarten nicht mehr freigegeben → nicht zu sehen
  await call(c, CA.routeCardsPut, "PUT", "/x", { share: false, rev: 1 }, cards.id);
  assert.equal((await pub(c, PA.routeParentLesson, { token: tok })).data.cards, undefined);
  // PDF: nur sichtbare Dateien dieser Sitzung
  r = await pub(c, PA.routeParentFile, { token: tok, lessonId: l2.id, fileId: ab2.id });
  assert.equal(r.status, 200); assert.ok(r.data.url.startsWith("/api/dl/" + ab2.id + "?d=i&"));
  for (const fid of [rae.id, vor.id, later.id]) assert.equal((await pub(c, PA.routeParentFile, { token: tok, lessonId: l2.id, fileId: fid })).status, 404, "nicht sichtbar: " + fid);
  // noch nicht stattgefunden: kein Inhalt
  const t3 = (await link(c, l3.id)).data.token;
  await L.updateLesson(c.db, l3.id, { parentSummary: "Geheim vorab", parentNote: "Hinweis vorab" }, c.now);
  r = await pub(c, PA.routeParentLesson, { token: t3 });
  assert.equal(r.data.state, "pending");
  assert.equal(r.data.opensAt, Date.parse("2026-11-17T07:45:00Z"));
  assert.ok(!JSON.stringify(r.data).includes("vorab") && !JSON.stringify(r.data).includes("Josef verzeiht") && r.data.cards === undefined && r.data.files === undefined);
  assert.equal((await pub(c, PA.routeParentFile, { token: t3, fileId: later.id })).status, 404, "PDF vor dem Ende: nein");
  // Vorschau der Lehrkraft: ohne Zeitsperre
  r = await call(c, PA.routeTeacherParentPreview, "GET", "/x", undefined, l3.id);
  assert.deepEqual([r.data.state, r.data.preview, r.data.summary, r.data.note], ["open", true, "Geheim vorab", "Hinweis vorab"]);
  assert.deepEqual(r.data.files.map((f) => f.name), ["Später.pdf"]);
  // ausgefallener Termin (Platzhalter): nie „krank“, kein Inhalt
  await c.db.prepare("UPDATE lessons SET cancelled=1 WHERE id=?1").bind(l1.id).run();
  r = await pub(c, PA.routeParentLesson, { token: tok, lessonId: l1.id });
  assert.equal(r.data.state, "cancelled");
  assert.ok(r.data.files === undefined && r.data.summary === undefined && !JSON.stringify(r.data).includes("krank"));
});

test("Vorherige Sitzungen: nur dieser Kurs, dieses Schuljahr, bis zum Link und nur freigeschaltete; fremde Sitzungen 403", async () => {
  const { c, old, l1, l2, l3, x } = await setup();
  const tok = (await link(c, l2.id)).data.token;
  let r = await pub(c, PA.routeParentPrevious, { token: tok });
  assert.equal(r.status, 200);
  assert.equal(r.data.schoolYear, "2026/27");
  assert.deepEqual(r.data.lessons.map((l) => [l.id, l.current]), [[l2.id, true], [l1.id, false]], "neueste zuerst, ohne Vorjahr, ohne spätere, ohne anderen Kurs");
  assert.equal((await pub(c, PA.routeParentLesson, { token: tok, lessonId: l1.id })).data.lesson.title, "Josef und seine Brüder");
  const a = (await pub(c, PA.routeParentLesson, { token: tok, lessonId: l1.id })).data.anchor;
  assert.deepEqual(a, { id: l2.id, date: "2026-11-10" }, "für „← Zur Sitzung vom …“");
  for (const id of [l3.id, old.id, x.id, "0123456789abcdef"]) assert.equal((await pub(c, PA.routeParentLesson, { token: tok, lessonId: id })).status, 403, "nicht im Link: " + id);
  // Vorschau der Lehrkraft: ohne Zeitsperre (auch eine künftige Sitzung als Anker)
  r = await call(c, PA.routeTeacherParentPrevious, "GET", "/x", undefined, l3.id);
  assert.deepEqual(r.data.lessons.map((l) => l.id), [l3.id, l2.id, l1.id]);
  // Link einer künftigen Sitzung: Liste nur mit den freigeschalteten
  const t3 = (await link(c, l3.id)).data.token;
  assert.deepEqual((await pub(c, PA.routeParentPrevious, { token: t3 })).data.lessons.map((l) => l.id), [l2.id, l1.id]);
});

test("Sperre je IP: ungültige Links zählen, nach 30 Fehlversuchen 429 – auch mit gültigem Link; andere IP nicht betroffen", async () => {
  const { c, l2 } = await setup();
  const tok = (await link(c, l2.id)).data.token;
  const bad = "A".repeat(32);
  let r;
  for (let i = 0; i < LOCKS.parentIp.max - 1; i++) {
    r = await pub(c, PA.routeParentLesson, { token: i % 2 ? bad : "kaputt" });
    assert.equal(r.status, 404); assert.equal(r.data.code, "invalid_link");
  }
  assert.equal(r.data.error, "Dieser Link ist ungültig oder wurde von der Lehrkraft erneuert. Bitte fragen Sie die Lehrkraft nach dem aktuellen Link.");
  assert.equal((await pub(c, PA.routeParentLesson, { token: tok })).status, 200, "gültige Links zählen nicht");
  r = await pub(c, PA.routeParentLesson, { token: bad });
  assert.equal(r.status, 429);
  c.db.counter.n = 0;
  r = await pub(c, PA.routeParentLesson, { token: tok });
  assert.deepEqual([r.status, r.data.code, r.data.error], [429, "locked", "Zu viele ungültige Links. Bitte warten Sie 10 Minuten."]);
  assert.equal(c.db.counter.n, 1, "gesperrt: nur die Sperre wird gelesen, kein Nachschlagen");
  assert.equal((await pub(c, PA.routeParentPrevious, { token: tok })).status, 429);
  assert.equal((await pub(c, PA.routeParentLesson, { token: tok }, "5.5.5.5")).status, 200);
});

test("Zwei Sitzungen am selben Tag: die frühere Startzeit zählt (auch wenn sie später angelegt wurde) – Liste und Verweise im Verlaufsplan gleich", async () => {
  const { c, course } = await setup();
  // b (10:00) zuerst angelegt, a (08:00) danach: a liegt trotzdem vor b
  const b = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Zweite Stunde", date: "2026-11-05", startTime: "10:00", durationMin: 45 }, c.now - 500);
  const a = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Erste Stunde", date: "2026-11-05", startTime: "08:00", durationMin: 45 }, c.now - 100);
  const blatt = (await upload(c, a.id, "Blatt der ersten Stunde.pdf")).data.file;
  await L.savePortal(c.db, b.id, "**1) Weiter**\n- [[pdf:" + blatt.id + "]]", 0, "claude", c.now);
  const tok = (await link(c, b.id)).data.token;
  assert.ok((await pub(c, PA.routeParentPrevious, { token: tok })).data.lessons.some((l) => l.id === a.id), "die Stunde um 08:00 gehört zu den vorherigen");
  assert.deepEqual(((await pub(c, PA.routeParentLesson, { token: tok })).data.files || []).map((f) => f.name), ["Blatt der ersten Stunde.pdf"], "Verweis auf die frühere Stunde desselben Tages zählt");
  // umgekehrt: a verweist auf ein Blatt von b (später am Tag) – zählt nicht
  const blattB = (await upload(c, b.id, "Blatt der zweiten Stunde.pdf")).data.file;
  await L.savePortal(c.db, a.id, "**1) Vorgriff**\n- [[pdf:" + blattB.id + "]]", 0, "claude", c.now);
  const ta = (await link(c, a.id)).data.token;
  assert.deepEqual(((await pub(c, PA.routeParentLesson, { token: ta })).data.files || []).map((f) => f.name), ["Blatt der ersten Stunde.pdf"], "kein Verweis auf eine spätere Stunde");
});
