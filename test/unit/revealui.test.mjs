// Nachtrag 44 (Befund der Gegenprüfung vom 23.11.2026): „Jetzt freigeben“ am Material der Lehrkraft (public/revealui.js) – nach dem Freigeben zeichnet die Seite
// neu, der Knopf verschwindet; der Tastaturfokus geht nicht verloren (Nachtrag 25), sondern kommt auf den neuen Hinweis desselben Materials im selben Abschnitt.
// Mit der Nachbildung des DOM und einer Attrappe des Servers (globalThis.__tapi); frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/lk" });
const R = await import("../../public/reveal.js");
const U = await import("../../public/revealui.js");
const S = await import("../../public/shared.js");

const TIMES = S.lessonTimes({ date: "2026-11-24", startTime: "08:00", durationMin: 90 });
const CODE_SLIDES = [{ n: 3, lines: ["Feibeitsblatt: Gewaltenteilung"] }, { n: 5, lines: ["Lest M2 Karikatur"] }];
const FILES = [{ id: "1111111111111111", area: "student", kind: "file", name: "M2 Karikatur.pdf" }];
const SHEETS = [{ code: "GWT4KQ", title: "Gewaltenteilung" }];
const now = TIMES.start + 600e3;
const gateOf = (reveals) => R.materialGate({ klass: "Q2-GK", times: TIMES, codeSlides: CODE_SLIDES, files: FILES, sheets: SHEETS, reveals, now });

test("„Jetzt freigeben“: danach liegt der Fokus auf dem neuen Hinweis desselben Materials (der Knopf ist beim Neuzeichnen verschwunden)", async () => {
  const app = document.getElementById("app");
  // zwei Abschnitte wie auf der Sitzungsseite: Materialkasten und Feibeitsblätter
  const card = (id) => { const c = document.createElement("section"); c.className = "card"; c.id = id; const l = document.createElement("div"); l.className = "list"; c.append(l); app.append(c); return l; };
  const mats = card("mat"), sheets = card("fbcard");
  let reveals = null;
  const calls = [];
  const paint = () => {
    const g = gateOf(reveals);
    while (mats.firstChild) mats.firstChild.remove();
    while (sheets.firstChild) sheets.firstChild.remove();
    mats.append(U.revealBadge({ gate: g, ref: "f:1111111111111111", title: "M2 Karikatur.pdf", lessonId: "aaaaaaaaaaaaaaaa", onReleased, now }));
    sheets.append(U.revealBadge({ gate: g, ref: "s:GWT4KQ", title: "Gewaltenteilung", lessonId: "aaaaaaaaaaaaaaaa", onReleased, now }));
  };
  function onReleased(rv) { reveals = rv; paint(); }
  globalThis.__tapi = async (method, path, o) => { calls.push([method, path, o.body.ref]); return { reveals: { v: 1, seen: [], refs: [...((reveals && reveals.refs) || []), { r: o.body.ref, at: now }] } }; };
  paint();
  const note = sheets.querySelector(".reveal-note");
  assert.equal(note.dataset.reveal, "s:GWT4KQ"); assert.equal(note.getAttribute("tabindex"), "-1", "per Skript fokussierbar, nicht in der Tab-Reihenfolge");
  const btn = sheets.querySelector(".reveal-go");
  D.userClick(btn);
  await D.sleep(10);
  assert.deepEqual(calls, [["POST", "/api/teacher/lessons/aaaaaaaaaaaaaaaa/reveal", "s:GWT4KQ"]]);
  assert.ok(!btn.isConnected, "der Knopf ist weg");
  const a = document.activeElement;
  assert.ok(a.classList.contains("reveal-note") && a.dataset.reveal === "s:GWT4KQ" && sheets.contains(a), "Fokus auf dem neuen Hinweis im selben Abschnitt");
  assert.ok(a.textContent.endsWith(" – von Ihnen freigegeben"));
  // liegt der Fokus inzwischen woanders (die Lehrkraft arbeitet weiter), springt er nicht
  const other = document.createElement("button"); other.textContent = "anderes"; app.append(other);
  const btn2 = mats.querySelector(".reveal-go");
  D.userClick(btn2);
  other.focus();
  await D.sleep(10);
  assert.equal(document.activeElement, other);
  assert.equal(mats.querySelector(".reveal-note").dataset.reveal, "f:1111111111111111");
});

test("revealFocusAfter: Abschnitt neu gebaut → der sichtbare Hinweis im Dokument; nichts gefunden → kein Fehler", () => {
  const app = document.getElementById("app");
  while (app.firstChild) app.firstChild.remove();
  const hidden = document.createElement("div"); hidden.hidden = true;
  const mk = (ref) => { const n = document.createElement("div"); n.className = "reveal-note"; n.setAttribute("tabindex", "-1"); n.dataset.reveal = ref; return n; };
  const inHidden = mk("s:GWT4KQ"), visible = mk("s:GWT4KQ");
  hidden.append(inHidden); app.append(hidden, visible);
  const gone = document.createElement("section");   // nicht mehr im Dokument
  U.revealFocusAfter(null, gone, "s:GWT4KQ");
  assert.equal(document.activeElement, visible, "die volle Ansicht ist unter „Ich bin jetzt im Unterricht“ verborgen: der sichtbare Hinweis");
  document.activeElement.blur();
  U.revealFocusAfter(null, gone, "s:ZZZ999");
  assert.equal(document.activeElement, document.body);
});
