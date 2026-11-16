// Nachtrag 35 (16.11.2026): „Ich bin jetzt im Unterricht“ – kompakte Sitzungsansicht. Reine Helfer (public/inclasslib.js): Phase der aktuellen Live-Folie
// (grüner Pfeil), Hinweise ohne Pfeil, Material in den zwei Spalten (Gymnasium und Grundschule, dieselben Sichtbarkeitsregeln wie die vollständige Ansicht);
// Knopf und Zustand je Tab (public/inclassbar.js); Live-Verbindung mit Rückfall (public/inclass.js liveFeed: nie öfter als alle 3 s abfragen).
// Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/lk/s/0123456789abcdef" });
const IL = await import("../../public/inclasslib.js");
const IB = await import("../../public/inclassbar.js");
const IC = await import("../../public/inclass.js");

const PORTAL = "**1) Einstieg**\n- Karikatur\n\n**2) Partnerarbeit**\n- Feibeitsblatt\n\n**3) Sicherung**\n- Tafelbild\n\n--> Nächste Stunde\n\n**4) Diskussion**\n- Wippe";
const PH = [1, 1, 2, 2, 3, null, 4, null];
const pres = (phases = { pdf: PH, hand: null, auto: null }) => ({ id: "aaaaaaaaaaaaaaaa", area: "presentation", status: "ready", pages: 8, phases });
const live = (slide, extra = {}) => ({ t: "state", active: true, slide, pages: 8, fileId: "aaaaaaaaaaaaaaaa", ...extra });

/* ---------- Phase der Live-Folie ---------- */
test("livePhase: Codefolie (0) wie Folie 1, Folie ohne Phase → Phase der Folie davor, keine davor → null", () => {
  assert.equal(IL.livePhase(PH, 0), 1);
  assert.equal(IL.livePhase(PH, 1), 1);
  assert.equal(IL.livePhase(PH, 3), 2);
  assert.equal(IL.livePhase(PH, 5), 3);
  assert.equal(IL.livePhase(PH, 6), 3);   // Quellen (ohne Phase) → Sicherung
  assert.equal(IL.livePhase(PH, 7), 4);
  assert.equal(IL.livePhase(PH, 8), 4);
  assert.equal(IL.livePhase(PH, 99), 4);  // jenseits der letzten Folie: wie die letzte
  assert.equal(IL.livePhase([null, 2, 2], 1), null);
  assert.equal(IL.livePhase([null, 2, 2], 0), null);
  assert.equal(IL.livePhase([null, 2, 2], 2), 2);
  assert.equal(IL.livePhase(null, 3), null);
  assert.equal(IL.livePhase(PH, -1), null);
  assert.equal(IL.livePhase(PH, "3"), null);
});

test("liveArrow: Pfeil an der Überschrift der Phase; ohne Pfeil ein ruhiger Grund (nicht live, andere Präsentation, ohne Phasen, Phase fehlt, doppelt)", () => {
  let r = IL.liveArrow({ live: live(3), pres: pres(), portalText: PORTAL });
  assert.deepEqual([r.head.label, r.head.line, r.phase, r.slide, r.code], ["2) Partnerarbeit", 3, 2, 3, false]);
  r = IL.liveArrow({ live: live(0, { view: "code" }), pres: pres(), portalText: PORTAL });
  assert.equal(r.head.label, "1) Einstieg"); assert.equal(r.code, true);
  r = IL.liveArrow({ live: live(5, { codeShown: true }), pres: pres(), portalText: PORTAL });
  assert.equal(r.head.label, "3) Sicherung"); assert.equal(r.code, true);
  assert.equal(IL.liveArrow({ live: live(7), pres: pres(), portalText: PORTAL }).head.label, "4) Diskussion");
  // von Hand zugeordnete Phasen gelten vor denen der PDF (Nachtrag 34)
  assert.equal(IL.liveArrow({ live: live(2), pres: pres({ pdf: PH, hand: [1, 2, 2, 2, 3, 3, 4, 4], auto: null }), portalText: PORTAL }).head.label, "2) Partnerarbeit");
  assert.deepEqual(IL.liveArrow({ live: live(3), pres: null, portalText: PORTAL }), { why: "nopres" });
  assert.deepEqual(IL.liveArrow({ live: null, pres: pres(), portalText: PORTAL }), { why: "idle" });
  assert.deepEqual(IL.liveArrow({ live: { t: "state", active: false, slide: 1, pages: 0 }, pres: pres(), portalText: PORTAL }), { why: "idle" });
  assert.deepEqual(IL.liveArrow({ live: live(3, { fileId: "bbbbbbbbbbbbbbbb" }), pres: pres(), portalText: PORTAL }), { why: "other" });
  assert.deepEqual(IL.liveArrow({ live: live(3), pres: pres({ pdf: null, hand: null, auto: null }), portalText: PORTAL }), { why: "nomarks" });
  assert.deepEqual(IL.liveArrow({ live: live(1), pres: pres({ pdf: [null, 2, 2, 3, 3, 3, 4, 4], hand: null, auto: null }), portalText: PORTAL }), { why: "nophase", slide: 1 });
  assert.deepEqual(IL.liveArrow({ live: live(3), pres: pres(), portalText: "Einstieg\n- ohne Nummern" }), { why: "noheads", phase: 2, slide: 3 });
  assert.deepEqual(IL.liveArrow({ live: live(7), pres: pres(), portalText: PORTAL.replace("**4) Diskussion**", "**5) Diskussion**") }), { why: "missing", phase: 4, slide: 7 });
  assert.deepEqual(IL.liveArrow({ live: live(3), pres: pres(), portalText: PORTAL + "\n\n**2) Noch einmal**" }), { why: "twice", phase: 2, slide: 3 });
  // ein älterer Stand ohne fileId gilt als diese Präsentation
  const { fileId, ...noFile } = live(5);
  assert.equal(IL.liveArrow({ live: noFile, pres: pres(), portalText: PORTAL }).phase, 3);
});

test("arrowText: Sie-Form, ruhig, nennt Phase und Folie bzw. den Grund", () => {
  assert.equal(IL.arrowText(IL.liveArrow({ live: live(3), pres: pres(), portalText: PORTAL })),
    "Der grüne Pfeil am rechten Rand zeigt die Phase, in der Sie laut Live-Präsentation gerade sind: „2) Partnerarbeit“ (Folie 3).");
  assert.equal(IL.arrowText(IL.liveArrow({ live: live(0), pres: pres(), portalText: PORTAL })),
    "Der grüne Pfeil am rechten Rand zeigt die Phase, in der Sie laut Live-Präsentation gerade sind: „1) Einstieg“ (Codefolie vor Folie 1).");
  assert.ok(IL.arrowText({ why: "idle" }).startsWith("Kein Pfeil: Die Präsentation läuft gerade nicht live. Sobald sie läuft – auch auf einem anderen Gerät –"));
  assert.equal(IL.arrowText({ why: "nomarks" }), "Kein Pfeil: Die Folien dieser Präsentation tragen keine Phasen. In der vollständigen Ansicht können Sie sie unter „Phasen der Folien“ zuordnen.");
  assert.equal(IL.arrowText({ why: "nophase", slide: 1 }), "Kein Pfeil: Folie 1 gehört zu keiner Phase des Schulportal-Eintrags.");
  assert.equal(IL.arrowText({ why: "missing", phase: 4 }), "Kein Pfeil: Die Phase 4 der Präsentation steht nicht im Schulportal-Eintrag.");
  for (const why of ["nopres", "idle", "other", "nomarks", "nophase", "noheads", "missing", "twice"]) assert.ok(!/\b(du|dein|krank)\b/i.test(IL.arrowText({ why, phase: 2, slide: 3 })), why);
  assert.equal(IL.liveSlideText({ slide: 0, pages: 8, view: "code" }), "Sitzungscode");
  assert.equal(IL.liveSlideText({ slide: 4, pages: 8, view: "code", codeShown: true }), "Sitzungscode");
  assert.equal(IL.liveSlideText({ slide: 4, pages: 8 }), "Folie 4 / 8");
});

/* ---------- Material in zwei Spalten ---------- */
const f = (id, area, extra = {}) => ({ id: id.padEnd(16, "0"), area, kind: "file", name: id + ".pdf", mime: "application/pdf", status: "ready", size: 900, createdAt: 1, ...extra });
test("materialColumns (Gymnasium): Spalte 1 = Feibeitsblätter, Material für Schüler:innen, Notfall-Feibeitsblätter zuletzt; Spalte 2 = nur Lehrkraft, dann „zum Ausdrucken“", () => {
  const files = [
    f("praes", "presentation"), f("anmerk", "teacher", { notesOf: "praes0000000000" }), f("archiv", "archive"),
    f("ab", "student"), f("notfall1", "student", { source: "notfall", fbCode: "KQ4M7Z" }), f("link", "student", { kind: "link", url: "https://example.org/" }),
    f("loesung", "teacher"), f("notfall2", "teacher", { source: "notfall" }), f("druck", "print", { print: { copies: 28, duplex: false, color: false }, printName: "28x - sw - einseitig - PoWi9 - druck.pdf" }),
    f("station", "student", { source: "selbstlern" }), f("text", "teacher", { kind: "text", mime: null }),
  ];
  const sheets = [{ code: "KQ4M7Z", title: "Gewaltenteilung" }, { code: "ESC4PE", title: "Finale", kind: "escape" }, { code: "PR3X8N", title: "Wehrhafte Demokratie" }];
  const c = IL.materialColumns(files, sheets);
  const lab = (e) => (e.type === "sheet" ? "FB:" + e.sheet.code : e.file.id.replace(/0+$/, "") + (e.print ? "(druck)" : "") + (e.tags.length ? "[" + e.tags.join(",") + "]" : ""));
  assert.deepEqual(c.student.map(lab), ["FB:KQ4M7Z", "FB:PR3X8N", "ab", "link", "notfall1[Notfall-Feibeitsblatt]"]);
  assert.deepEqual(c.teacher.map(lab), ["loesung", "notfall2[Notfall-Feibeitsblatt]", "text", "druck(druck)[zum Ausdrucken]"]);
  // Selbstlern-Phase: ihr Material sehen die Schüler:innen nur, solange sie läuft (worker/student.js)
  assert.ok(IL.materialColumns(files, [], { selbstlern: true }).student.some((e) => e.file && e.file.id.startsWith("station")));
  assert.deepEqual(IL.materialColumns([], []), { student: [], teacher: [] });
  assert.deepEqual(IL.materialColumns(null, null), { student: [], teacher: [] });
});

test("materialColumns (Grundschule): Arbeitsblatt der Kinder auch „zum Ausdrucken“, Bildkarten bei der Lehrkraft (auf der Druckliste zum Ausdrucken), Druckdateien und Konzentrationsaufgabe", () => {
  const files = [
    f("ab", "student", { print: { copies: 22 }, printName: "22x - sw - beidseitig - Reli2 - ab.pdf" }), f("raetsel", "student"),
    f("vorlese", "teacher"), f("karten", "teacher", { cards: { v: 1, share: true }, print: { copies: 1, duplex: false, color: true }, printName: "1x - farbig - einseitig - Reli2 - karten.pdf" }),
    f("altkarten", "teacher", { cards: { v: 1, share: false } }), f("konz", "print", { print: { copies: 5, duplex: true } }),
  ];
  const c = IL.materialColumns(files, [{ code: "KQ4M7Z", title: "nie in der Grundschule" }].slice(0, 0), { gs: true });
  const lab = (e) => e.file.id.replace(/0+$/, "") + (e.print ? "(druck)" : "") + (e.tags.length ? "[" + e.tags.join(",") + "]" : "");
  assert.deepEqual(c.student.map(lab), ["ab", "raetsel"]);
  assert.deepEqual(c.teacher.map(lab), ["vorlese", "altkarten[Bildkarten]", "ab(druck)[zum Ausdrucken]", "karten(druck)[Bildkarten,zum Ausdrucken]", "konz(druck)[zum Ausdrucken]"]);
  // Gymnasium: Dateien mit cards gibt es dort nicht – ein Feld cards zählt nicht als Bildkarten
  assert.deepEqual(IL.materialColumns([f("x", "teacher", { cards: {} })], []).teacher.map((e) => e.tags), [[]]);
});

test("materialKey: ändert sich mit Name, Stand, Bereich, Druck-Namen und Gestaltung – sonst bleibt er gleich (kein Neuaufbau, der Fokus bleibt)", () => {
  const base = [f("ab", "student"), f("druck", "print", { printName: "1x - sw - einseitig - PoWi9 - druck.pdf" })];
  const k = (files, sheets = []) => IL.materialKey(IL.materialColumns(files, sheets));
  const k0 = k(base);
  assert.equal(k(base.map((x) => ({ ...x }))), k0);
  assert.notEqual(k([{ ...base[0], name: "neu.pdf" }, base[1]]), k0);
  assert.notEqual(k([{ ...base[0], status: "processing" }, base[1]]), k0);
  assert.notEqual(k([{ ...base[0], area: "teacher" }, base[1]]), k0);
  assert.notEqual(k([base[0], { ...base[1], printName: "2x - sw - einseitig - PoWi9 - druck.pdf" }]), k0);
  assert.notEqual(k([{ ...base[0], design: { htmlAt: 2, pdfAt: 1 } }, base[1]]), k0);
  assert.notEqual(k(base, [{ code: "KQ4M7Z", title: "Neu" }]), k0);
});

test("Zustand je Tab (sessionStorage): nur die ID dieser Sitzung; eine andere Sitzung löscht ihn nicht; ohne Speicher nie ein Fehler", () => {
  const m = new Map(), st = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  IL.setInClassStored(st, "aaaaaaaaaaaaaaaa", true);
  assert.equal(m.get(IL.INCLASS_KEY), "aaaaaaaaaaaaaaaa");
  assert.equal(IL.inClassStored(st, "aaaaaaaaaaaaaaaa"), true);
  assert.equal(IL.inClassStored(st, "bbbbbbbbbbbbbbbb"), false);
  IL.setInClassStored(st, "bbbbbbbbbbbbbbbb", false);
  assert.equal(IL.inClassStored(st, "aaaaaaaaaaaaaaaa"), true);
  IL.setInClassStored(st, "aaaaaaaaaaaaaaaa", false);
  assert.equal(m.size, 0);
  const broken = { getItem() { throw new Error("verboten"); }, setItem() { throw new Error("verboten"); }, removeItem() { throw new Error("verboten"); } };
  assert.equal(IL.inClassStored(broken, "x"), false); IL.setInClassStored(broken, "x", true); IL.setInClassStored(null, "x", true);
  assert.equal(IL.inClassStored(null, "x"), false);
});

/* ---------- Knopf und Umschalten (inclassbar.js) ---------- */
test("inClassToggle: Knopf mit genau diesem Text; Umschalten blendet die vollständige Ansicht nur aus (dieselben Elemente), Fokus wandert mit; Neuladen behält den Zustand; nicht in einer Selbstlern-Phase", async () => {
  const m = new Map(); IB.io.storage = () => ({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) });
  const id = "0123456789abcdef";
  const make = (allowed = () => true) => {
    const full = document.createElement("div"); full.className = "session-grid"; const ta = document.createElement("textarea"); ta.value = "Lies M2."; full.append(ta);
    let mounts = 0, destroyed = 0;
    const t = IB.inClassToggle({ id, full: () => [full], allowed, mount: async () => { mounts++; const el = document.createElement("div"); el.className = "inclass-view"; return { el, destroy: () => { destroyed++; } }; } });
    const main = document.createElement("main"); main.append(...t.els, full);
    const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove(); app.append(main);
    return { t, full, ta, main, counts: () => [mounts, destroyed] };
  };
  let x = make();
  const go = document.getElementById("inclass-go"), back = document.getElementById("inclass-back");
  assert.equal(go.textContent, "Ich bin jetzt im Unterricht");
  assert.equal(back.textContent, "Vollständige Ansicht");
  assert.ok(back.classList.contains("ic-hide") && !go.classList.contains("ic-hide"));
  D.userClick(go); await D.sleep(5);
  assert.ok(x.full.classList.contains("ic-hide") && x.full.isConnected && x.ta.value === "Lies M2.", "vollständige Ansicht nur ausgeblendet");
  assert.ok(document.getElementById("inclass").querySelector(".inclass-view") && x.main.classList.contains("inclass-on"));
  assert.equal(document.activeElement, back);
  assert.equal(m.get(IL.INCLASS_KEY), id);
  D.userClick(back);
  assert.ok(!x.full.classList.contains("ic-hide") && !document.getElementById("inclass").querySelector(".inclass-view"));
  assert.equal(document.activeElement, go);
  assert.equal(m.has(IL.INCLASS_KEY), false);
  assert.deepEqual(x.counts(), [1, 1]);
  // Neuladen: gemerkter Zustand → gleich kompakt (ohne Fokus zu setzen)
  m.set(IL.INCLASS_KEY, id);
  x = make(); x.t.restore(); await D.sleep(5);
  assert.ok(x.full.classList.contains("ic-hide") && x.t.on());
  // Selbstlern-Phase: Knopf weg, eine offene kompakte Ansicht endet
  let allowed = true;
  x = make(() => allowed); x.t.restore(); await D.sleep(5);
  assert.ok(x.t.on());
  allowed = false; x.t.paint();
  assert.ok(!x.t.on() && document.getElementById("inclass-bar").classList.contains("ic-hide") && !x.full.classList.contains("ic-hide"));
  assert.equal(m.has(IL.INCLASS_KEY), false);
  m.set(IL.INCLASS_KEY, id); x = make(() => false); x.t.restore(); await D.sleep(5);
  assert.ok(!x.t.on(), "in einer Selbstlern-Phase nie kompakt – auch nicht nach dem Neuladen");
  // Sitzung verlassen (anderer Seitenwechsel): Zustand endet; derselbe Aufbau dieser Sitzung behält ihn
  IB.forgetInClass(id); m.set(IL.INCLASS_KEY, id);
  location.hash = "#/lk"; globalThis.__leave();
  assert.equal(m.has(IL.INCLASS_KEY), false);
  location.hash = "#/lk/s/" + id;
  x = make(); D.userClick(document.getElementById("inclass-go")); await D.sleep(5); globalThis.__leave();
  assert.equal(m.get(IL.INCLASS_KEY), id);
});

/* ---------- Live-Verbindung (inclass.js liveFeed) ---------- */
test("liveFeed: WebSocket mit Wiederverbindung; scheitert er, fragt es ersatzweise – nie öfter als alle 3 Sekunden; stop() beendet alles", async () => {
  const calls = [], sockets = [];
  class FakeWS { constructor(u) { this.url = u; sockets.push(this); } send() {} close() { this.closed = true; } }
  const net = { WebSocket: FakeWS, wsUrl: (u) => "ws://x" + u, tapi: async (m, p) => { calls.push([Date.now(), m, p]); return m === "POST" ? { url: "/api/live/x?t=1" } : { live: { t: "state", active: true, slide: 2, pages: 8 } }; } };
  const got = [];
  const feed = IC.liveFeed("0123456789abcdef", (m) => got.push(m), net);
  feed.begin(); feed.begin();   // zweimal: nur eine Verbindung
  await D.sleep(20);
  assert.equal(sockets.length, 1);
  assert.equal(calls.filter((c) => c[1] === "GET").length, 1, "beim Start einmal der Stand");
  sockets[0].onopen(); sockets[0].onmessage({ data: JSON.stringify({ t: "state", active: true, slide: 3, pages: 8 }) }); sockets[0].onmessage({ data: "pong" });
  assert.deepEqual(got.map((x) => x.slide), [2, 3]);
  sockets[0].onclose();   // 1. Fehlschlag: neu verbinden (nach 2 s), noch nicht fragen
  await D.sleep(2200);
  assert.equal(sockets.length, 2);
  sockets[1].onclose();   // 2. Fehlschlag: ersatzweise fragen – aber nicht schneller als alle 3 s
  await D.sleep(400);
  const gets = () => calls.filter((c) => c[1] === "GET").map((c) => c[0]);
  assert.equal(gets().length, 1, "kurz nach der letzten Abfrage noch keine neue");
  await D.sleep(3000);
  const g = gets();
  assert.ok(g.length >= 2 && g.slice(1).every((t, i) => t - g[i] >= 2900), "Abstände: " + g.slice(1).map((t, i) => t - g[i]).join(", "));
  feed.stop();
  const n = calls.length;
  await D.sleep(3200);
  assert.equal(calls.length, n, "nach stop() keine Anfrage mehr");
  assert.equal(feed.running(), false);
});

test("inclass.js wird erst bei Bedarf geladen (lazy), die Seiten bleiben schlank; Pfeil mit Namen, kein ständig sprechender Bereich", () => {
  const ses = readFileSync(new URL("../../public/session.js", import.meta.url), "utf8"), gs = readFileSync(new URL("../../public/gssession.js", import.meta.url), "utf8");
  const ic = readFileSync(new URL("../../public/inclass.js", import.meta.url), "utf8");
  for (const s of [ses, gs]) { assert.ok(s.includes('lazy(import("./inclass.js"))')); assert.ok(!/import\s*\{[^}]*\}\s*from\s*"\.\/inclass\.js"/.test(s)); }
  assert.equal(IL.ARROW_NAME, "Aktuelle Phase laut Live-Präsentation");
  assert.ok(ic.includes('role: "img", "aria-label": ARROW_NAME'));
  // der Hinweis zum Pfeil und der Live-Stand ändern sich mit jeder Folie: keine Live-Region (würde bei jeder Folie vorlesen)
  assert.ok(!/ic-arrow-hint"[^)]*aria-live/.test(ic) && !/ic-live"[^)]*aria-live/.test(ic));
});

/* ---------- Prüfbefunde (S33 check) ---------- */
test("liveFeed (Prüfbefund): stop() und begin(), während das Ticket noch unterwegs ist – nur eine Verbindung; eine verspätete öffnet nichts, eine verdrängte schließt sich und meldet nichts", async () => {
  const sockets = [], tickets = [];
  class FakeWS { constructor(u) { this.url = u; sockets.push(this); } send() {} close() { this.closed = true; } }
  const net = { WebSocket: FakeWS, wsUrl: (u) => "ws://x" + u, tapi: (m) => (m === "POST" ? new Promise((r) => tickets.push(() => r({ url: "/api/live/x?t=" + tickets.length }))) : Promise.resolve({ live: null })) };
  const got = [];
  const feed = IC.liveFeed("0123456789abcdef", (m) => got.push(m), net);
  feed.begin(); await D.sleep(5);
  feed.stop(); feed.begin(); await D.sleep(5);   // App-Wechsel am iPad: kurz weg und wieder da
  assert.equal(tickets.length, 2);
  tickets[1](); await D.sleep(5);   // das neue Ticket zuerst
  tickets[0](); await D.sleep(5);   // das alte kommt zu spät
  assert.equal(sockets.length, 1, "nur die neue Verbindung wird geöffnet");
  sockets[0].onopen(); sockets[0].onmessage({ data: JSON.stringify({ t: "state", active: true, slide: 2, pages: 8 }) });
  assert.deepEqual(got.map((x) => x.slide), [2]);
  feed.stop();
  assert.equal(sockets[0].closed, true, "stop() schließt sie");
  sockets[0].onmessage({ data: JSON.stringify({ t: "state", active: true, slide: 5, pages: 8 }) });
  assert.deepEqual(got.map((x) => x.slide), [2], "nach stop() kommt nichts mehr an");
  // zweiter Fall: das alte Ticket kommt zuerst – seine Verbindung wird gar nicht erst geöffnet
  const s2 = [], t2 = [];
  class WS2 { constructor() { s2.push(this); } send() {} close() { this.closed = true; } }
  const f2 = IC.liveFeed("0123456789abcdef", () => {}, { WebSocket: WS2, wsUrl: (u) => u, tapi: (m) => (m === "POST" ? new Promise((r) => t2.push(() => r({ url: "/x" }))) : Promise.resolve({ live: null })) });
  f2.begin(); await D.sleep(5); f2.stop(); f2.begin(); await D.sleep(5);
  t2[0](); await D.sleep(5); t2[1](); await D.sleep(5);
  assert.equal(s2.length, 1); f2.stop(); assert.equal(s2[0].closed, true);
});

test("stampWatch (Prüfbefund): fragt beim Start und dann im Takt; poke() sofort, kurz nach einer Abfrage erst nach 3 s (nie verworfen); stop() beendet; der Takt ist 20 s", async () => {
  assert.equal(IL.STAMP_POLL_MS, 20000);
  let n = 0;
  const w = IC.stampWatch(async () => { n++; }, 200);
  w.begin(); w.begin();
  await D.sleep(20);
  assert.equal(n, 1, "beim Start einmal (zweimal begin: einmal)");
  await D.sleep(450);
  assert.ok(n >= 2 && n <= 4, "im Takt: " + n);
  w.stop(); const k = n; await D.sleep(450);
  assert.equal(n, k, "nach stop() keine Abfrage mehr"); assert.equal(w.running(), false);
  // Anstoß (Rückkehr ins Fenster, Präsentation beginnt/endet): kurz nach einer Abfrage wartet er, statt verloren zu gehen
  let m = 0;
  const w2 = IC.stampWatch(async () => { m++; }, 60000);
  w2.begin(); await D.sleep(20);
  w2.poke(); w2.poke(); await D.sleep(50);
  assert.equal(m, 1, "direkt danach: noch nicht");
  await D.sleep(3100);
  assert.equal(m, 2, "nach 3 s genau einmal (zwei Anstöße zusammengefasst)");
  w2.poke(); w2.stop(); await D.sleep(3200);
  assert.equal(m, 2, "stop() verwirft einen wartenden Anstoß");
  // ein Fehler beim Fragen hält das Beobachten nicht an
  let e = 0; const w3 = IC.stampWatch(async () => { e++; throw new Error("Netz"); }, 100);
  w3.begin(); await D.sleep(250); w3.stop(); assert.ok(e >= 2);
});

test("liveArrow (Prüfbefund): Präsentation ohne fertige Folienbilder – eigener Grund statt „keine Präsentation“", () => {
  const r = IL.liveArrow({ live: live(3), pres: { ...pres(), status: "processing" }, portalText: PORTAL });
  assert.deepEqual(r, { why: "notready" });
  assert.equal(IL.arrowText(r), "Kein Pfeil: Die Folienbilder der Präsentation sind noch nicht fertig – laden Sie die PDF in der vollständigen Ansicht erneut hoch.");
});

test("Prüfbefunde im Quelltext: Öffnen zählt als Handlung (kein Rollen gleich danach), Hinweis nach automatischem Zwischenstopp auch ohne Textänderung, Vermerk des Servers beim Markieren, Stand der Sitzung", () => {
  const ic = readFileSync(new URL("../../public/inclass.js", import.meta.url), "utf8"), ses = readFileSync(new URL("../../public/session.js", import.meta.url), "utf8");
  assert.ok(/let arrowLine = null, lastUser = Date\.now\(\);/.test(ic), "lastUser beginnt beim Öffnen");
  assert.ok(ses.includes('if (text !== portalTA.value) applyPortalText(text); else { updateStopBtns(); icEmit("plan"); }'), "auch ohne Textänderung folgt die kompakte Ansicht");
  assert.ok(ses.includes("syncStop(p, n, (r.file && r.file.phases && r.file.phases.auto) || null)"), "prevAuto vom Server, nicht aus dem Zwischenspeicher des Tabs");
  assert.ok(/pres: \(\) => st\.files\.find\(\(f\) => f\.area === "presentation"\) \|\| null/.test(ses), "auch eine Präsentation ohne fertige Folienbilder");
  assert.ok(ses.includes('checkStamp: async () =>') && ses.includes('"/stamp"'), "Stand der Sitzung (…/stamp)");
});
