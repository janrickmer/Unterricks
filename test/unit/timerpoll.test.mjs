// Timer der Live-Präsentation (Nachtrag 16) – Befunde der Prüfung vom 13.11.2026:
//  • eine Abfrage (Rückfall bzw. nach dem Ruhezustand), während der WebSocket eine neuere Nachricht brachte, darf den Timer nicht zurücksetzen
//    (Beamergerät, public/beamer.js – die Schüler:innen-Seite in public/app.js macht es genauso)
//  • das Band bei den Schüler:innen richtet sich nach der Breite des Live-Kästchens (am Laptop sonst nach der Fensterbreite: Schrift 46 px,
//    die Folie ein Fünftel kleiner); Kontrast der Timer-Farben auch beim Aufblinken nach Ablauf (AA)
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { readFileSync } from "node:fs";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/beamer" });
const { store } = await import("../../public/ui.js");

const MIN = 60e3;
const css = readFileSync(new URL("../../public/styles.css", import.meta.url), "utf8");

test("Beamergerät: eine Abfrage, während der WebSocket eine neuere Nachricht brachte, setzt den Timer nicht zurück (Pause bleibt)", async () => {
  const socks = [], polls = [];
  const saved = { WebSocket: globalThis.WebSocket, fetch: globalThis.fetch, BroadcastChannel: globalThis.BroadcastChannel };
  globalThis.WebSocket = class { constructor(u) { this.url = u; this.readyState = 0; this.sent = []; socks.push(this); } send(m) { this.sent.push(m); } close() { this.readyState = 3; } };
  delete globalThis.BroadcastChannel;   // ohne Präsentationsfenster im selben Browser: gleich Beamergerät
  const json = (d) => new Response(JSON.stringify({ ok: true, ...d }), { headers: { "Content-Type": "application/json" } });
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith("/api/beamer/live-ticket")) return json({ url: "/api/live/0123456789abcdef?r=beamer&u=1.1&e=1&s=x", fach: "powi" });
    if (u.endsWith("/api/beamer/live")) return new Promise((res) => polls.push((d) => res(json({ live: d }))));
    throw new Error("nicht nachgebildet: " + u);
  };
  store.set("u.beamer", JSON.stringify({ lessonId: "0123456789abcdef", key: "1.1234567890123.abcdefghijklmnopqrstuv", exp: Date.now() + 3600e3 }));
  const state = (timer) => ({ t: "state", active: true, slide: 0, pages: 3, v: 4, view: "code", code: "K7Q4MX", title: "Gewaltenteilung", lines: [], codeShown: false, timer });
  document.visibilityState = "visible";
  try {
    const { beamerPage } = await import("../../public/beamer.js");
    beamerPage();
    for (let i = 0; i < 100 && !socks.length; i++) await D.sleep(5);
    const ws = socks[socks.length - 1];
    assert.ok(ws, "verbindet sich mit dem Server");
    ws.readyState = 1; ws.onopen();
    ws.onmessage({ data: JSON.stringify(state({ left: 4 * MIN, total: 5 * MIN, paused: false })) });
    const band = document.querySelector(".beamer .tband");
    assert.equal(band.hidden, false);
    assert.equal(band.textContent, "Noch 4:00");
    // wieder sichtbar: die Seite fragt den Stand ab – währenddessen pausiert die Lehrkraft (die Nachricht kommt über den WebSocket)
    D.fire(document, "visibilitychange");
    for (let i = 0; i < 100 && !polls.length; i++) await D.sleep(5);
    assert.equal(polls.length, 1, "Abfrage läuft");
    ws.onmessage({ data: JSON.stringify(state({ left: 3 * MIN + 50e3, total: 5 * MIN, paused: true })) });
    assert.equal(band.textContent, "Pausiert – noch 3:50");
    polls.shift()(state({ left: 3 * MIN + 51e3, total: 5 * MIN, paused: false }));   // Antwort von vor der Pause
    await D.sleep(20);
    assert.equal(band.textContent, "Pausiert – noch 3:50", "die überholte Antwort ändert nichts");
    // ohne Nachricht dazwischen gilt die Abfrage (Rückfall, wenn der WebSocket nichts bringt)
    D.fire(document, "visibilitychange");
    for (let i = 0; i < 100 && !polls.length; i++) await D.sleep(5);
    polls.shift()(state({ left: 2 * MIN, total: 5 * MIN, paused: false }));
    for (let i = 0; i < 100 && band.textContent !== "Noch 2:00"; i++) await D.sleep(5);
    assert.equal(band.textContent, "Noch 2:00", "die Abfrage gleicht ab");
  } finally {
    globalThis.__leave();
    store.del("u.beamer");
    Object.assign(globalThis, saved);
  }
});

test("Schüler:innen-Seite: die Abfrage verwirft ihre Antwort, wenn der WebSocket inzwischen etwas brachte", () => {
  const app = readFileSync(new URL("../../public/app.js", import.meta.url), "utf8");
  assert.match(app, /const poll = async \(\) => \{ const n = got; try \{ const r = await sapi\("GET", "\/api\/student\/lessons\/" \+ lessonId \+ "\/live"\); if \(n === got\) showState\(r\.live\); \} catch \{\} \};/);
  assert.match(app, /ws\.onmessage = \(ev\) => \{ if \(ev\.data === "pong"\) return; got\+\+;/);
});

const hex6 = (h) => (h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h);
const tokens = (block) => Object.fromEntries([...block.matchAll(/(--timer[\w-]*):\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/gi)].map((m) => [m[1], hex6(m[2])]));
const lum = (hex) => { const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("Band: Größe nach dem Live-Kästchen der Schüler:innen (Container), Schrift auf allen Timer-Farben AA – auch beim Aufblinken", () => {
  const live = /\n\.live \{([^}]*)\}/.exec(css)[1];
  assert.match(live, /container-type:\s*inline-size/, ".live ist ein Container: cqw der Schrift = Breite des Kästchens");
  assert.match(css, /\.tband \{[^}]*--tb-fs: clamp\(1rem, min\(3\.2cqw, 5\.6cqh\), 4\.5rem\)/);
  const t = tokens(/:root\s*\{([\s\S]*?)\n\}/.exec(css)[1]);
  for (const [ink, bg] of [["--timer-ink", "--timer-bg"], ["--timer-last-ink", "--timer-last"], ["--timer-over-ink", "--timer-over"], ["--timer-pause-ink", "--timer-pause"]])
    assert.ok(contrast(t[ink], t[bg]) >= 4.5, ink + " auf " + bg + ": " + contrast(t[ink], t[bg]).toFixed(2));
  const puls = /@keyframes tb-puls \{ 50% \{ background: (#[0-9a-f]{6}); \} \}/.exec(css)[1];
  assert.ok(contrast(t["--timer-over-ink"], puls) >= 4.5, "Aufblinken " + puls + ": " + contrast(t["--timer-over-ink"], puls).toFixed(2));
});
