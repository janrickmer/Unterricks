// Nachtrag 45 (23.11.2026): Feibeitsblatt aus einer früheren Sitzung wieder gebraucht – Zeile in der Schüleransicht (public/fbagain.js) und Übergabe der
// Zwischenstand-PDF an das Feibeitsblatt nach dem Protokoll v1 (postMessage von Tab zu Tab: Bereitschaft, genau einmal senden, Antwort; Rückfall nach 10 s).
// Mit einem nachgebildeten Fenster (open, postMessage) und der Nachbildung des DOM; frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/schueler" });
const A = await import("../../public/fbagain.js");

const FB = "https://feibeitsblatt.example/", ORIGIN = "https://feibeitsblatt.example";
const pdf = (n = 200) => { const b = new Uint8Array(n); b.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); return b.buffer; };
/* nachgebildetes Fenster: open → Tab (zeichnet postMessage auf), message-Ereignisse von außen */
function fakeWin({ block = false } = {}) {
  const ls = new Set(), opened = [];
  const win = {
    opened,
    open(url, target, feat) { if (block) return null; const tab = { url, target, feat, posted: [], postMessage(data, origin, transfer) { this.posted.push({ data, origin, transfer }); } }; opened.push(tab); return tab; },
    addEventListener(t, fn) { if (t === "message") ls.add(fn); },
    removeEventListener(t, fn) { if (t === "message") ls.delete(fn); },
    say(source, data, origin = ORIGIN) { for (const fn of [...ls]) fn({ origin, source, data }); },
    listeners: () => ls.size,
  };
  return win;
}

test("Datei prüfen: höchstens 5 MB, beginnt mit „%PDF-“; Adresse mit der Marke #von-unterricks", () => {
  assert.equal(A.draftPdfIssue(200, new Uint8Array(pdf())), "");
  assert.equal(A.draftPdfIssue(A.FB_AGAIN.maxBytes + 1, null), A.AGAIN_TEXT.tooBig);
  assert.equal(A.draftPdfIssue(0, null), A.AGAIN_TEXT.notPdf);
  assert.equal(A.draftPdfIssue(10, new TextEncoder().encode("Hallo Welt")), A.AGAIN_TEXT.notPdf);
  assert.equal(A.FB_AGAIN.maxBytes, 5 * 1024 * 1024, "= PDF_MAX_BYTES im Feibeitsblatt");
  assert.deepEqual(A.handoverTarget("https://feibeitsblatt.janrickmer.de/"), { href: "https://feibeitsblatt.janrickmer.de/#von-unterricks", origin: "https://feibeitsblatt.janrickmer.de" });
  assert.deepEqual(A.handoverTarget("http://localhost:8788/#alt"), { href: "http://localhost:8788/#von-unterricks", origin: "http://localhost:8788" });
  for (const u of ["", "javascript:alert(1)", "kaputt", null]) assert.equal(A.handoverTarget(u), null);
  assert.equal(A.AGAIN_TEXT.ok, "Dein Zwischenstand ist im Feibeitsblatt geöffnet.");
  assert.equal(A.AGAIN_TEXT.fallback, "Tippe im Feibeitsblatt auf „Zwischenstand-PDF hochladen“ und wähle deine PDF-Datei.");
});

test("Übergabe: neuer Tab ohne noopener, Bereitschaft nur aus diesem Tab und von seiner Herkunft, genau einmal gesendet (übertragen), Antwort ok", () => {
  const win = fakeWin(), states = [], buf = pdf();
  const run = A.fbHandover({ url: FB, name: "Zwischenstand – Wehrhafte Demokratie.pdf", buf, win, onStatus: (s) => states.push(s), readyMs: 60000 });
  assert.ok(run);
  const tab = win.opened[0];
  assert.deepEqual([tab.url, tab.target, tab.feat], [FB + "#von-unterricks", "_blank", undefined], "ohne noopener – das Feibeitsblatt antwortet über window.opener");
  assert.deepEqual(states, ["opening"]);
  win.say({ other: true }, { kind: "feibeitsblatt-bereit", v: 1 });                      // anderer Tab
  win.say(tab, { kind: "feibeitsblatt-bereit", v: 1 }, "https://boese.example");         // andere Herkunft
  win.say(tab, { kind: "feibeitsblatt-bereit", v: 2 });                                   // andere Fassung
  win.say(tab, "feibeitsblatt-bereit");
  assert.equal(tab.posted.length, 0);
  win.say(tab, { kind: "feibeitsblatt-bereit", v: 1 });
  win.say(tab, { kind: "feibeitsblatt-bereit", v: 1 });
  assert.equal(tab.posted.length, 1, "genau einmal");
  const p = tab.posted[0];
  assert.deepEqual([p.data.kind, p.data.v, p.data.name, p.origin], ["unterricks-zwischenstand", 1, "Zwischenstand – Wehrhafte Demokratie.pdf", ORIGIN]);
  assert.equal(p.data.pdf, buf); assert.deepEqual(p.transfer, [buf], "übertragen, nicht kopiert");
  assert.deepEqual(states, ["opening", "sending"]);
  win.say(tab, { kind: "feibeitsblatt-zwischenstand-angekommen", v: 1, ok: true }, "https://boese.example");
  assert.deepEqual(states, ["opening", "sending"]);
  win.say(tab, { kind: "feibeitsblatt-zwischenstand-angekommen", v: 1, ok: true });
  assert.deepEqual(states, ["opening", "sending", "ok"]);
  assert.equal(win.listeners(), 0, "danach hört die Seite nicht mehr zu");
});

test("Übergabe: ok:false (z. B. beschäftigt) und keine Bereitschaft binnen 10 s → Anleitung; eine verspätete Bereitschaft wird noch übergeben; blockierter Tab", async () => {
  let win = fakeWin(), states = [];
  A.fbHandover({ url: FB, name: "a.pdf", buf: pdf(), win, onStatus: (s, g) => states.push(g ? s + ":" + g : s) });
  win.say(win.opened[0], { kind: "feibeitsblatt-bereit", v: 1 });
  win.say(win.opened[0], { kind: "feibeitsblatt-zwischenstand-angekommen", v: 1, ok: false, grund: "beschaeftigt" });
  assert.deepEqual(states, ["opening", "sending", "fallback:beschaeftigt"]);
  // älteres Feibeitsblatt ohne Übergabe: nach readyMs die Anleitung (der Tab ist schon offen)
  win = fakeWin(); states = [];
  A.fbHandover({ url: FB, name: "a.pdf", buf: pdf(), win, onStatus: (s) => states.push(s), readyMs: 20, listenMs: 2000 });
  await D.sleep(60);
  assert.deepEqual(states, ["opening", "fallback"]);
  win.say(win.opened[0], { kind: "feibeitsblatt-bereit", v: 1 });
  assert.equal(win.opened[0].posted.length, 1, "kommt die Bereitschaft doch noch, wird übergeben");
  win.say(win.opened[0], { kind: "feibeitsblatt-zwischenstand-angekommen", v: 1, ok: true });
  assert.deepEqual(states, ["opening", "fallback", "sending", "ok"]);
  // Antwort ohne vorheriges Senden zählt nicht
  win = fakeWin(); states = [];
  A.fbHandover({ url: FB, name: "a.pdf", buf: pdf(), win, onStatus: (s) => states.push(s) });
  win.say(win.opened[0], { kind: "feibeitsblatt-zwischenstand-angekommen", v: 1, ok: true });
  assert.deepEqual(states, ["opening"]);
  // Pop-up blockiert: nichts gesendet, nichts zugehört
  win = fakeWin({ block: true }); states = [];
  assert.equal(A.fbHandover({ url: FB, name: "a.pdf", buf: pdf(), win, onStatus: (s) => states.push(s) }), null);
  assert.deepEqual(states, ["blocked"]); assert.equal(win.listeners(), 0);
});

test("Zeile der Schüleransicht: Feld für die PDF, Knopf erst mit gültiger Datei, Übergabe mit Meldungen, klein der Code und „Von vorn beginnen“", async () => {
  const win = fakeWin(), leaves = [];
  const el = A.fbAgainItem({ code: "WHD4KT", title: "Die wehrhafte Demokratie", again: true }, FB, { leave: (fn) => leaves.push(fn), win });
  document.getElementById("app").append(el);
  const $ = (s) => el.querySelector(s);
  assert.equal($(".name").textContent, "Die wehrhafte Demokratie");
  assert.equal($(".badge.again").textContent, "Wieder gebraucht");
  assert.ok($(".fba-intro").textContent.startsWith("Dieses Feibeitsblatt kennst du schon aus einer früheren Sitzung."));
  const input = $("input.fba-file");
  assert.equal(input.getAttribute("type"), "file"); assert.equal(input.getAttribute("accept"), "application/pdf,.pdf");
  assert.equal(input.closest("label.fba-pick").textContent, "Zwischenstand-PDF auswählen", "das Feld nennt sich selbst (Name des Dateifelds)");
  assert.equal($(".fba-go").hidden, true, "ohne Datei kein Knopf");
  assert.equal($(".fba-code").textContent, "Feibeitsblatt-Code WHD-4KT");
  // falsche Datei per Ablegen
  const drop = (file) => D.fire($(".fba-pick"), "drop", { dataTransfer: { files: [file] } });
  drop({ name: "foto.jpg", size: 30, arrayBuffer: async () => new TextEncoder().encode("JFIF und mehr").buffer });
  await D.sleep(5);
  assert.equal($(".fba-err").textContent, A.AGAIN_TEXT.notPdf); assert.equal($(".fba-go").hidden, true);
  drop({ name: "riesig.pdf", size: 6 * 1024 * 1024, arrayBuffer: async () => { throw new Error("nicht lesen"); } });
  await D.sleep(5);
  assert.equal($(".fba-err").textContent, A.AGAIN_TEXT.tooBig);
  // richtige Datei
  drop({ name: "Zwischenstand.pdf", size: 200, arrayBuffer: async () => pdf() });
  await D.sleep(5);
  assert.equal($(".fba-err").textContent, ""); assert.equal($(".fba-go").hidden, false);
  assert.ok($(".fba-chosen").textContent.includes("Zwischenstand.pdf") && $(".fba-picktext").textContent === "Andere Datei wählen");
  assert.equal($(".fba-go").textContent, "Im Feibeitsblatt weiterarbeiten");
  $(".fba-go").click();
  const tab = win.opened[0];
  assert.equal(tab.url, FB + "#von-unterricks");
  assert.equal($(".fba-status").textContent, A.AGAIN_TEXT.opening);
  win.say(tab, { kind: "feibeitsblatt-bereit", v: 1 });
  assert.equal(tab.posted[0].data.name, "Zwischenstand.pdf");
  assert.equal($(".fba-status").textContent, A.AGAIN_TEXT.sending);
  assert.equal($(".fba-go").hidden, true, "übergeben: die Datei ist weg (für einen neuen Versuch wieder wählen)");
  win.say(tab, { kind: "feibeitsblatt-zwischenstand-angekommen", v: 1, ok: true });
  assert.equal($(".fba-status").textContent, "Dein Zwischenstand ist im Feibeitsblatt geöffnet.");
  assert.equal($(".fba-status").getAttribute("role"), "status");
  // Von vorn beginnen: Code kopieren, Feibeitsblatt in neuem Tab (noopener) – wie „Code kopieren und Feibeitsblatt öffnen“
  const restart = $(".fba-restart");
  assert.ok(restart.textContent.startsWith("Von vorn beginnen") && restart.querySelector(".sr-only"));
  restart.click();
  await D.sleep(5);
  assert.equal(D.clip.text, "WHD-4KT");
  assert.deepEqual([win.opened[1].url, win.opened[1].feat], [FB, "noopener"]);
  assert.equal(leaves.length, 1, "beim Verlassen der Seite: Übergabe beenden, Datei vergessen");
});
