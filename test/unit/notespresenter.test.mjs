// Notizen der Lehrkraft im Präsentationsmodus (Nachtrag 20) im Browser-Ersatz (fake-dom.mjs): nur mit Vorschau und getrennt laufendem Beamerbild
// (Beamerfenster per BroadcastChannel bzw. Beamergerät laut Durable Object) unter der aktuellen Folie; ein einzeln gespiegeltes Gerät zeigt sie
// nie. Notizen stehen nie in Nachrichten an das Beamerfenster oder an den Server (WebSocket).
import test from "node:test";
import assert from "node:assert/strict";
const { installDom } = await import("./fake-dom.mjs");
const D = installDom({ hash: "#/" });
const NativeResponse = globalThis.Response;
const FILE = "0123456789abcdef";
const SECRET = "GEHEIMNOTIZ";
const NOTES = [{ n: 1, items: [SECRET + " Einstieg mit Karikatur", "Erwartung: Machtmissbrauch"] }, { n: 3, items: ["Partnerarbeit ankündigen"] }];

async function open({ notes = NOTES, beamers = 0 } = {}) {
  const socks = [], posts = [], chans = [];
  globalThis.WebSocket = class { constructor(u) { this.url = u; this.readyState = 0; this.sent = []; socks.push(this); } send(m) { this.sent.push(m); } close() { this.readyState = 3; } };
  globalThis.Image = class { set src(v) { this._s = v; } get src() { return this._s || ""; } };
  globalThis.fetch = async () => new NativeResponse(JSON.stringify({ ok: true, url: "/api/live/l1?r=teacher&u=t&e=1&s=x" }), { headers: { "Content-Type": "application/json" } });
  globalThis.BroadcastChannel = class { constructor() { chans.push(this); } postMessage(m) { posts.push(structuredClone(m)); } close() {} };
  const { startPresenter, NOTES_HINT } = await import("../../public/presenter.js");
  const pres = await startPresenter({ lessonId: "l1", file: { id: FILE }, token: "t", code: "K7QM4X", title: "Gewaltenteilung",
    slides: { urls: ["/f/1", "/f/2", "/f/3"], pages: 3, codeSlides: [{ n: 3, lines: ["Partnerarbeit"] }], notes } });
  for (let i = 0; i < 50 && !socks.length; i++) await D.sleep(5);
  const ws = socks[socks.length - 1];
  ws.readyState = 1; ws.onopen();
  const state = (o = {}) => ws.onmessage({ data: JSON.stringify({ t: "state", active: true, slide: 0, pages: 3, v: 1, fileId: FILE, students: 0, beamers, ...o }) });
  state();
  const root = document.querySelector(".presenter"), box = document.querySelector(".presenter .notespane");
  const bc = chans[0], pid = (posts.find((m) => m.t === "claim") || {}).id;
  return { pres, ws, posts, bc, pid, root, box, state, NOTES_HINT, shown: () => root.classList.contains("with-notes"), text: () => box.textContent,
    hint: () => document.querySelector(".presenter .notehint").textContent, sent: () => ws.sent.filter((m) => m !== "ping").join("\n") };
}
const right = () => D.press("ArrowRight");

test("ohne getrenntes Beamerbild (einzeln gespiegelt): keine Notizen, nur der kurze Hinweis in der Leiste", async () => {
  const P = await open();
  try {
    right();
    assert.equal(P.shown(), false, "keine Notizen – die Klasse sähe sie sonst mit");
    assert.equal(P.hint(), P.NOTES_HINT);
    assert.ok(P.NOTES_HINT.includes("Beamerfenster oder Beamergerät") && P.NOTES_HINT.includes("„Material nur für die Lehrkraft“"));
  } finally { P.pres.end(false); }
});

test("Beamergerät verbunden (Zahl aus dem Durable Object): Notizen unter der aktuellen Folie, Folienwechsel wechselt sie; Taste V blendet sie mit aus", async () => {
  const P = await open();
  try {
    P.state({ beamers: 1 });
    assert.equal(P.shown(), true);
    assert.equal(P.hint(), "", "der Hinweis verschwindet");
    assert.match(P.text(), /^Codefolie vor Folie 1/, "Codefolie vor Folie 1: keine Notizen");
    assert.match(P.text(), /Keine Notizen zu dieser Folie\./);
    right();
    assert.ok(P.text().startsWith("Notizen zu Folie 1") && P.text().includes(SECRET + " Einstieg mit Karikatur") && P.text().includes("Erwartung: Machtmissbrauch"));
    assert.equal(P.box.querySelectorAll("li").length, 2);
    right();
    assert.ok(P.text().startsWith("Notizen zu Folie 2") && P.text().includes("Keine Notizen zu dieser Folie."));
    right();
    assert.ok(P.text().startsWith("Notizen zu Folie 3 (Codefolie)") && P.text().includes("Partnerarbeit ankündigen"));
    // „Sitzungscode zeigen“ (Taste C): die Notizen der aktuellen Folie bleiben
    D.press("c");
    assert.ok(P.text().startsWith("Notizen zu Folie 3"));
    D.press("v");
    assert.equal(P.shown(), false, "Vorschau aus = Notizen aus");
    assert.equal(P.hint(), "", "dann kein Hinweis (bewusst ausgeblendet)");
    D.press("v");
    assert.equal(P.shown(), true);
    // Pfeil runter in den Notizen rollt dort (blättert nicht weiter)
    P.box.focus(); D.press("ArrowDown");
    assert.ok(P.text().startsWith("Notizen zu Folie 3"));
    // Beamer getrennt: Notizen weg, der Hinweis erscheint wieder
    P.state({ beamers: 0 });
    assert.equal(P.shown(), false);
    assert.equal(P.hint(), P.NOTES_HINT);
    assert.ok(!P.sent().includes(SECRET) && !P.sent().includes("Erwartung"), "nie an den Server (WebSocket)");
  } finally { P.pres.end(false); }
});

test("Beamerfenster (BroadcastChannel) verbunden: Notizen hier – das Beamerfenster bekommt nie welche", async () => {
  const P = await open();
  try {
    assert.ok(P.pid, "Präsentationsfenster meldet sich (claim)");
    P.bc.onmessage({ data: { t: "following", id: P.pid, bid: "b1" } });
    assert.equal(P.shown(), true);
    right(); right();
    assert.ok(P.text().startsWith("Notizen zu Folie 2"));
    const shows = P.posts.filter((m) => m.t === "show");
    assert.ok(shows.length >= 2);
    assert.ok(!JSON.stringify(P.posts).includes(SECRET) && !JSON.stringify(P.posts).includes("Erwartung") && !JSON.stringify(P.posts).includes("notes"), "keine Notizen im BroadcastChannel");
    P.bc.onmessage({ data: { t: "bye", bid: "b1" } });
    assert.equal(P.shown(), false);
  } finally { P.pres.end(false); }
});

test("Präsentation ohne Notizen: mit Beamer bleibt alles wie bisher (kein Notizfeld, kein Hinweis)", async () => {
  const P = await open({ notes: [] });
  try {
    assert.equal(P.hint(), "");
    P.state({ beamers: 1 }); right();
    assert.equal(P.shown(), false);
    assert.equal(document.querySelectorAll(".presenter .bmc-notes").length, 0);
  } finally { P.pres.end(false); }
});

// Datenschutzprüfung: Ein Beamerfenster auf demselben Bildschirm ist kein getrenntes Beamerbild – gespiegelt sähe die Klasse die Notizen, sobald das
// Präsentationsfenster vorn ist (Laptop gespiegelt; am iPad ein zweiter Tab mit dem Beamerfenster)
test("Beamerfenster nur auf einem Bildschirm (screen.isExtended false) bzw. gerade nicht zu sehen: keine Notizen; dieses Fenster zurück im Vordergrund: erst nach neuer Meldung", async () => {
  const scr = new EventTarget(); scr.isExtended = false;
  window.screen = scr;
  const P = await open();
  try {
    const { NOTES_SCREEN_HINT } = await import("../../public/presenter.js");
    right();
    P.bc.onmessage({ data: { t: "following", id: P.pid, bid: "b1", vis: true } });
    assert.equal(P.shown(), false, "nur ein Bildschirm: das Beamerfenster liegt auf dem gespiegelten Bildschirm");
    assert.equal(P.hint(), NOTES_SCREEN_HINT);
    assert.ok(P.posts.some((m) => m.t === "show"), "das Beamerfenster bekommt die Folie trotzdem");
    scr.isExtended = true; scr.dispatchEvent(new Event("change"));
    assert.equal(P.shown(), true, "Beamer als erweiterter Bildschirm: Notizen");
    assert.ok(P.text().includes(SECRET));
    P.bc.onmessage({ data: { t: "following", id: P.pid, bid: "b1", vis: false } });
    assert.equal(P.shown(), false, "Beamerfenster gerade nicht zu sehen (z. B. Tab hinter diesem): keine Notizen");
    P.bc.onmessage({ data: { t: "following", id: P.pid, bid: "b1", vis: true } });
    assert.equal(P.shown(), true);
    // dieses Fenster im Hintergrund und zurück: keine Notizen, bis das Beamerfenster auf „who“ meldet, dass es zu sehen ist
    document.visibilityState = "hidden"; document.dispatchEvent(new D.Event("visibilitychange"));
    assert.equal(P.shown(), false);
    const before = P.posts.length;
    document.visibilityState = "visible"; document.dispatchEvent(new D.Event("visibilitychange"));
    assert.equal(P.shown(), false, "nicht schon beim ersten Bild nach der Rückkehr");
    assert.ok(P.posts.slice(before).some((m) => m.t === "who"), "fragt die Beamerfenster neu");
    P.bc.onmessage({ data: { t: "following", id: P.pid, bid: "b1", vis: true } });
    assert.equal(P.shown(), true);
    // ein Beamergerät (eigenes Gerät am Beamer) zählt auch bei nur einem Bildschirm hier
    scr.isExtended = false; scr.dispatchEvent(new Event("change"));
    assert.equal(P.shown(), false);
    P.state({ beamers: 1 });
    assert.equal(P.shown(), true);
    assert.ok(!JSON.stringify(P.posts).includes(SECRET), "nie im BroadcastChannel");
  } finally { P.pres.end(false); delete window.screen; }
});
