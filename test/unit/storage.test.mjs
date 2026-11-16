// Speicher in der Fußzeile der Lehrkraft (Nachtrag 30): Anzeige (public/storagefoot.js – knapperer Wert, Einzelheiten, Stufen, Zahlen auf Deutsch),
// Fußzeile im Browser-Ersatz (aufklappen, Tastatur, Fokus, gemerkter Stand) und GET /api/teacher/storage (worker/files.js) mit D1 auf SQLite.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
register("data:text/javascript," + encodeURIComponent('export async function resolve(s, c, n) { return s === "cloudflare:workers" ? { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true } : n(s, c); }'));
const D = installDom({ hash: "#/lk" });
const SF = await import("../../public/storagefoot.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const F = await import("../../worker/files.js");
const { sha256Hex } = await import("../../worker/lib.js");

const NB = "\u00a0", GiB = 1024 ** 3, MiB = 1024 ** 2;
const LIM = { files: 9 * GiB, db: 500e6 };
const view = (files, db) => SF.storageView({ files: { used: files, limit: LIM.files }, db: { used: db, limit: LIM.db }, at: 0 });

test("Anzeige: knapperer Wert in Prozent, Einzelheiten wie im Beispiel der Lehrkraft („Dateien: 1,1 von 9 GB · Datenbank: 40 von 500 MB“)", () => {
  const v = view(1.1 * GiB, 40e6);
  assert.equal(v.label, "Speicher: 12" + NB + "% belegt");
  assert.equal(v.files, "Dateien: 1,1 von 9" + NB + "GB");
  assert.equal(v.db, "Datenbank: 40 von 500" + NB + "MB");
  assert.equal(v.level, "ok"); assert.equal(v.tight, "files"); assert.equal(v.note, "");
  // die Datenbank ist knapper: ihr Wert zählt
  const w = view(1.1 * GiB, 120e6);
  assert.equal(w.label, "Speicher: 24" + NB + "% belegt"); assert.equal(w.tight, "db");
});

test("Anzeige: Stufen ab 80 % (Hinweis) und 95 % (fast voll), abgerundet wie die Farbe; voll; unter 1 %; nichts; Datenbank unbekannt", () => {
  const at = (r) => view(r * LIM.files, 0);
  assert.deepEqual([at(0.7999).level, at(0.8).level, at(0.9499).level, at(0.95).level, at(1).level], ["ok", "warn", "warn", "danger", "danger"]);
  assert.equal(at(0.7999).label, "Speicher: 79" + NB + "% belegt");
  assert.equal(at(0.8).label, "Speicher: 80" + NB + "% belegt");
  assert.equal(at(0.9499).label, "Speicher: 94" + NB + "% belegt");
  assert.equal(at(0.96).label, "Speicher: 96" + NB + "% belegt – fast voll");
  assert.equal(at(1.02).label, "Speicher: 102" + NB + "% belegt – voll");
  assert.equal(SF.pctText(0.57), "57" + NB + "%", "keine Rundungsfehler beim Abrunden (0,57 · 100 = 56,999…)");
  assert.equal(view(5 * MiB, 0).label, "Speicher: unter 1" + NB + "% belegt");
  assert.equal(view(0, 0).label, "Speicher: 0" + NB + "% belegt");
  // Hinweise: was knapp ist, was zu tun ist
  assert.match(at(0.85).note, /^Der Speicher wird knapp\. Löschen Sie bei Gelegenheit Dateien oder Sitzungen, die Sie nicht mehr brauchen\.$/);
  assert.match(view(0, 0.97 * LIM.db).note, /fast voll\. Bitte löschen Sie alte Sitzungen oder Einheiten, .* – sonst lässt sich bald nichts mehr speichern\.$/);
  assert.match(at(0.97).note, /sonst lassen sich bald keine Dateien mehr hochladen\.$/);
  assert.match(at(1).note, /^Der Speicher für Dateien ist voll: Neue Dateien lassen sich erst wieder hochladen/);
  assert.match(view(0, LIM.db).note, /^Die Datenbank ist voll/);
  // Größe der Datenbank unbekannt: nur die Dateien zählen
  const u = SF.storageView({ files: { used: 0.5 * LIM.files, limit: LIM.files }, db: { used: null, limit: LIM.db }, at: 0 });
  assert.equal(u.label, "Speicher: 50" + NB + "% belegt"); assert.equal(u.db, "Datenbank: Größe gerade nicht abrufbar");
});

test("Mengen auf Deutsch: MB unter 1000 MB, sonst GB mit einer Nachkommastelle; etwas mehr als nichts nie als 0", () => {
  assert.equal(SF.amountText(350 * MiB, 9 * GiB, 1024), "350" + NB + "MB von 9" + NB + "GB");
  assert.equal(SF.amountText(5.6 * MiB, 9 * GiB, 1024), "5,6" + NB + "MB von 9" + NB + "GB");
  assert.equal(SF.amountText(0, 9 * GiB, 1024), "0" + NB + "MB von 9" + NB + "GB");
  assert.equal(SF.amountText(8.94 * GiB, 9 * GiB, 1024), "8,9 von 9" + NB + "GB");
  assert.equal(SF.amountText(12 * GiB, 20 * GiB, 1024), "12 von 20" + NB + "GB");
  assert.equal(SF.amountText(12288, 500e6, 1000), "0,1 von 500" + NB + "MB", "eine fast leere Datenbank");
  assert.equal(SF.amountText(4.2e6, 500e6, 1000), "4,2 von 500" + NB + "MB");
  assert.equal(SF.amountText(499.6e6, 500e6, 1000), "500 von 500" + NB + "MB");
  assert.equal(SF.amountText(3e9, 10e9, 1000), "3 von 10" + NB + "GB", "bezahlter Plan (DB_LIMIT_BYTES)");
});

/* ---------- Fußzeile im Browser-Ersatz ---------- */
const $ = (s, root = document) => root.querySelector(s);
async function until(cond, what) { for (let i = 0; i < 1500; i++) { if (cond()) return; await D.sleep(2); } assert.fail("nicht eingetreten: " + what); }
const DATA = (files, db, at = Date.UTC(2026, 10, 17, 13, 5)) => ({ ok: true, files: { used: files, limit: LIM.files }, db: { used: db, limit: LIM.db }, at });

test("Fußzeile: erst nach dem Laden sichtbar, Knopf mit aria-expanded klappt die Einzelheiten auf und zu, der Fokus bleibt; gemerkter Stand", async () => {
  SF.resetStorageMemo();
  const calls = [];
  let answer = DATA(1.1 * GiB, 40e6);
  const load = async (fresh) => { calls.push(fresh); return answer; };
  const foot = SF.storageFoot(load);
  document.body.append(foot);
  const btn = $("#storage-btn", foot), more = $("#storage-more", foot);
  assert.equal(btn.hidden, true, "vor dem Laden kein Knopf");
  await until(() => !btn.hidden, "Knopf sichtbar");
  assert.equal(foot.tagName, "FOOTER");
  assert.equal($(".sf-label", btn).textContent, "Speicher: 12" + NB + "% belegt");
  assert.equal(btn.getAttribute("aria-expanded"), "false"); assert.equal(btn.getAttribute("aria-controls"), "storage-more"); assert.equal(more.hidden, true);
  assert.equal($(".sf", foot).dataset.level, "ok");
  // Tastatur: Fokus auf den Knopf, Enter klappt auf (der Stand ist frisch – keine neue Anfrage), der Fokus bleibt
  btn.focus(); D.press("Enter");
  assert.equal(btn.getAttribute("aria-expanded"), "true"); assert.equal(more.hidden, false); assert.equal(document.activeElement, btn);
  assert.equal($(".sf-vals", more).textContent, "Dateien: 1,1 von 9" + NB + "GB · Datenbank: 40 von 500" + NB + "MB");
  assert.match($(".sf-expl", more).textContent, /^Zu den Dateien zählen Material, .* Stand: \d\d:\d\d Uhr\.$/);
  assert.deepEqual(calls, [false]);
  D.press(" ");
  assert.equal(btn.getAttribute("aria-expanded"), "false"); assert.equal(more.hidden, true); assert.equal(document.activeElement, btn);
  // eine zweite Seite im selben Tab: derselbe Stand ohne neue Anfrage
  const foot2 = SF.storageFoot(load); document.body.append(foot2);
  await until(() => !$("#storage-btn", foot2).hidden, "zweite Fußzeile");
  assert.deepEqual(calls, [false], "gemerkter Stand – keine zweite Anfrage");
  foot.remove(); foot2.remove();
});

test("Fußzeile: Aufklappen mit älterem Stand fragt neu (fresh) und zeigt die neuen Werte an Ort und Stelle; Stufen als data-level und Hinweis", async () => {
  SF.resetStorageMemo();
  const calls = [];
  let answer = DATA(0.5 * GiB, 10e6);
  const realNow = performance.now;   // das Alter des gemerkten Stands misst die Fußzeile mit performance.now
  let shift = 0; performance.now = () => realNow.call(performance) + shift;
  try {
    const foot = SF.storageFoot(async (fresh) => { calls.push(fresh); return answer; });
    document.body.append(foot);
    const btn = $("#storage-btn", foot);
    await until(() => !btn.hidden, "Knopf sichtbar");
    shift = SF.STORAGE_FRESH_MS + 1000;   // der gemerkte Stand ist älter als 10 s
    answer = DATA(0.86 * LIM.files, 10e6);
    btn.click();
    await until(() => calls.length === 2, "neue Anfrage");
    assert.deepEqual(calls, [false, true]);
    await until(() => $(".sf", foot).dataset.level === "warn", "Hinweis-Stufe");
    assert.equal($(".sf-label", btn).textContent, "Speicher: 86" + NB + "% belegt");
    const note = $(".sf-note", foot);
    assert.ok(note.className.includes("warnc") && !note.className.includes("hidden"), note.className);
    assert.match(note.textContent, /^Der Speicher wird knapp\./);
    assert.equal(btn.getAttribute("aria-expanded"), "true", "bleibt aufgeklappt");
    // fast voll: rot (Klasse err) mit „– fast voll“ im Knopf
    shift += SF.STORAGE_MEMO_MS + 1000; answer = DATA(0.97 * LIM.files, 10e6);
    const foot2 = SF.storageFoot(async (fresh) => { calls.push(fresh); return answer; }); document.body.append(foot2);
    await until(() => $(".sf", foot2).dataset.level === "danger", "fast voll");
    assert.equal($(".sf-label", foot2).textContent, "Speicher: 97" + NB + "% belegt – fast voll");
    assert.ok($(".sf-note", foot2).className.includes("err"));
    // die Uhr läuft rückwärts (z. B. verstellt): der gemerkte Stand gilt dann nicht weiter, die nächste Seite fragt neu
    const n0 = calls.length;
    shift -= 3600e3;
    const foot3 = SF.storageFoot(async (fresh) => { calls.push(fresh); return answer; }); document.body.append(foot3);
    await until(() => !$("#storage-btn", foot3).hidden, "dritte Fußzeile");
    assert.equal(calls.length, n0 + 1, "neue Anfrage statt eines festgehaltenen Stands");
    foot.remove(); foot2.remove(); foot3.remove();
  } finally { performance.now = realNow; }
});

test("Fußzeile: scheitert die Anfrage, bleibt sie still leer; abgemeldet zählt eine späte Antwort nicht", async () => {
  SF.resetStorageMemo();
  const foot = SF.storageFoot(async () => { throw new Error("Keine Verbindung"); });
  document.body.append(foot);
  await D.sleep(10);
  assert.equal($("#storage-btn", foot).hidden, true);
  foot.remove();
  // eine unbrauchbare Antwort (ohne files): still leer, keine unbehandelte Ablehnung
  SF.resetStorageMemo();
  const rejections = [];
  const onRej = (e) => rejections.push(e);
  process.on("unhandledRejection", onRej);
  const bad = SF.storageFoot(async () => ({ ok: true }));
  document.body.append(bad);
  await D.sleep(20);
  process.off("unhandledRejection", onRej);
  assert.equal($("#storage-btn", bad).hidden, true); assert.deepEqual(rejections, []);
  bad.remove();
  SF.resetStorageMemo();
  // Antwort kommt erst nach dem Abmelden: der Stand wird nicht gemerkt
  let release; const late = new Promise((r) => (release = r));
  const calls = [];
  const f2 = SF.storageFoot(async (fresh) => { calls.push(fresh); await late; return DATA(GiB, 1e6); });
  document.body.append(f2);
  SF.resetStorageMemo();
  release(); await D.sleep(10);
  const f3 = SF.storageFoot(async (fresh) => { calls.push(fresh); return DATA(GiB, 1e6); }); document.body.append(f3);
  await until(() => !$("#storage-btn", f3).hidden, "neue Fußzeile");
  assert.equal(calls.length, 2, "nach dem Abmelden fragt die nächste Seite neu");
  f2.remove(); f3.remove();
});

/* ---------- GET /api/teacher/storage ---------- */
const TOKEN = "lehrkraft-token-speicher";
async function ctx(env = {}) {
  const c = fakeCtx(env);
  c.now = Date.UTC(2026, 10, 17, 9, 0);
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  return c;
}
const call = async (c, query = "", token = TOKEN) => {
  const req = new Request("https://unterricks.test/api/teacher/storage" + query, { headers: token ? { Authorization: "Bearer " + token } : {} });
  try { const res = await F.routeStorage({ ...c, request: req, waitUntil: () => {} }); return { status: res.status, cache: res.headers.get("cache-control"), data: await res.json() }; }
  catch (e) { return { status: e.status, data: { code: e.code } }; }
};
let seq = 0;
const hex = (n) => (++seq).toString(16).padStart(n, "0");
const addFile = (c, size, extra = {}) => c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, size, cut_size, clean_size, created_at, updated_at) VALUES(?1, 'l', 'student', 'file', 'x.pdf', ?2, ?3, ?4, 1, 1)")
  .bind(hex(16), size, extra.cut ?? null, extra.clean ?? null).run();

test("Server: Summe wie beim Hochladen (Dateien samt gekürzter/bereinigter Fassung, Folien, Planungsgrundlagen, Podcasts), Größe der Datenbank aus meta.size_after", async () => {
  const c = await ctx();
  await addFile(c, 1000, { cut: 200, clean: 30 });
  await addFile(c, 5000);
  await c.db.prepare("INSERT INTO slides(file_id, n, size) VALUES('f', 1, 700), ('f', 2, 300)").run();
  await c.db.prepare("INSERT INTO bases(id, subject, kind, title, pdf_size, created_at, updated_at) VALUES('b', 'powi', 'kcgo', 'K', 4000, 1, 1)").run();
  await c.db.prepare("INSERT INTO podcasts(id, day, r2_key, mime, size, created_at, delete_after) VALUES('p', '2026-11-18', 'podcast/p', 'audio/mpeg', 9000, 1, 2)").run();
  c.db.counter.n = 0;
  const r = await call(c);
  assert.equal(r.status, 200); assert.equal(r.cache, "no-store");
  assert.equal(r.data.files.used, 1000 + 200 + 30 + 5000 + 700 + 300 + 4000 + 9000);
  assert.equal(r.data.files.limit, 9 * GiB);
  assert.ok(r.data.db.used > 0, "Größe der Datenbank: " + r.data.db.used);
  assert.equal(r.data.db.limit, 500e6);
  assert.equal(r.data.at, c.now);
  assert.ok(c.db.counter.n <= 3, "Anmeldung + höchstens zwei Anweisungen: " + c.db.counter.n);
  // checkStorage rechnet mit derselben Summe (unverändert: 507 beim Überschreiten)
  await assert.rejects(F.checkStorage({ ...c, env: { ...c.env, STORAGE_LIMIT_BYTES: String(r.data.files.used + 10) } }, 11), (e) => e.status === 507 && e.code === "storage_full");
  await F.checkStorage({ ...c, env: { ...c.env, STORAGE_LIMIT_BYTES: String(r.data.files.used + 10) } }, 10);
});

test("Server: Stand für alle Geräte bis 5 Minuten gemerkt (eine Anweisung), ?fresh=1 rechnet ab 10 s neu; Grenzen aus der Umgebung; ohne Anmeldung 401", async () => {
  const c = await ctx({ STORAGE_LIMIT_BYTES: String(2 * GiB), DB_LIMIT_BYTES: String(10e9) });
  await addFile(c, 100);
  const a = await call(c);
  assert.equal(a.data.files.used, 100); assert.equal(a.data.files.limit, 2 * GiB); assert.equal(a.data.db.limit, 10e9);
  await addFile(c, 50);
  c.now += 60e3; c.db.counter.n = 0;
  const b = await call(c);
  assert.equal(b.data.files.used, 100, "gemerkter Stand"); assert.equal(b.data.at, a.data.at);
  assert.equal(c.db.counter.n, 2, "Anmeldung + Lesen des gemerkten Stands");
  assert.ok(b.data.db.used > 0, "die Größe der Datenbank ist trotzdem aktuell");
  // fresh: neu gerechnet, weil der Stand älter als 10 s ist
  const f = await call(c, "?fresh=1");
  assert.equal(f.data.files.used, 150); assert.equal(f.data.at, c.now);
  // fresh erneut innerhalb von 10 s: gemerkter Stand
  await addFile(c, 7); c.now += 5e3;
  assert.equal((await call(c, "?fresh=1")).data.files.used, 150);
  // nach 5 Minuten ohne fresh: neu
  c.now += F.USAGE_CACHE_MS;
  assert.equal((await call(c)).data.files.used, 157);
  // ein Stand aus der Zukunft (andere Uhr) gilt nicht
  await c.db.prepare("UPDATE settings SET value=?1 WHERE key='storage_used'").bind(JSON.stringify({ at: c.now + 3600e3, used: 1 })).run();
  assert.equal((await call(c)).data.files.used, 157);
  // beschädigter Stand: neu gerechnet
  await c.db.prepare("UPDATE settings SET value='kaputt' WHERE key='storage_used'").run();
  assert.equal((await call(c)).data.files.used, 157);
  assert.equal((await call(c, "", null)).status, 401);
  assert.equal((await call(c, "", "falsch")).status, 401);
});

test("Server: ohne size_after (ältere Laufzeit) ist die Größe der Datenbank null – die Fußzeile zeigt dann nur die Dateien", async () => {
  const c = await ctx();
  c.db.counter.sizeAfter = null;
  const r = await call(c);
  assert.equal(r.status, 200); assert.equal(r.data.db.used, null);
  c.db.counter.sizeAfter = 480e6;
  const s = await call(c);
  assert.equal(s.data.db.used, 480e6);
  assert.equal(SF.storageView(s.data).label, "Speicher: 96" + NB + "% belegt – fast voll");
  delete c.db.counter.sizeAfter;
});
