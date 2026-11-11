import test from "node:test";
import assert from "node:assert/strict";
import { LIVE_IDLE, liveReduce, liveView } from "../../worker/livestate.js";

const fresh = () => ({ ...LIVE_IDLE });
const FILE = "0123456789abcdef";
const start = (extra = {}) => ({ t: "start", fileId: FILE, pages: 3, slide: 0, code: "K7QM4X", title: "Das Bundesverfassungsgericht", codeSlides: [{ n: 3, lines: ["Bearbeitet die Aufgaben.", "Feibeitsblatt: X"] }], ...extra });

test("Live: Start mit der Codefolie (Folie 0) – ohne Folienbild, mit Code, Titel und QR-Code für alle", () => {
  const st = fresh();
  assert.equal(liveReduce(st, start(), 1000), true);
  assert.equal(st.slide, 0); assert.equal(st.v, 1); assert.equal(st.startedAt, 1000);
  assert.deepEqual(liveView(st), { slide: null, code: { code: "K7QM4X", title: "Das Bundesverfassungsgericht", lines: [], codeShown: false } });
  liveReduce(st, { t: "goto", slide: 1 }, 2000);
  assert.deepEqual(liveView(st), { slide: 1, code: null }, "Folie 1: das Folienbild");
  liveReduce(st, { t: "goto", slide: 3 }, 3000);
  assert.deepEqual(liveView(st), { slide: 3, code: { code: "K7QM4X", title: "Das Bundesverfassungsgericht", lines: ["Bearbeitet die Aufgaben.", "Feibeitsblatt: X"], codeShown: false } },
    "Platzhalterfolie: Codefolie mit ihrer Überschrift (Folienbild als Rückfall für ältere Seiten)");
  liveReduce(st, { t: "goto", slide: -5 }, 4000);
  assert.equal(st.slide, 0, "zurück bis zur Codefolie, nicht weiter");
  liveReduce(st, { t: "goto", slide: 99 }, 5000);
  assert.equal(st.slide, 3, "nicht über die letzte Folie hinaus");
});

test("Live: ohne gültigen Code (ältere Seite der Lehrkraft) keine Codefolie – Folie 0 wird zu Folie 1", () => {
  for (const code of [undefined, "", "K7Q-M4X", "AAAAAA", 123]) {
    const st = fresh();
    liveReduce(st, start({ code }), 1);
    assert.equal(st.slide, 1, String(code));
    assert.deepEqual(liveView(st), { slide: 1, code: null });
    liveReduce(st, { t: "goto", slide: 3 }, 2);
    assert.equal(liveView(st).code, null, "ohne Code auch keine Platzhalterfolie");
    assert.equal(liveReduce(st, { t: "code", on: true }, 3), false, "ohne Code kein „Sitzungscode zeigen“");
  }
  const st = fresh();
  liveReduce(st, { t: "start", fileId: FILE, pages: 3 }, 1);
  assert.equal(st.slide, 1, "älterer Start ohne Folie: Folie 1");
});

test("Live: „Sitzungscode zeigen“ über der aktuellen Folie, die nächste Bewegung schaltet es aus; nach Wiederverbindung bleibt es", () => {
  const st = fresh();
  liveReduce(st, start({ slide: 2 }), 1);
  assert.equal(liveReduce(st, { t: "code", on: true }, 2), true);
  assert.deepEqual(liveView(st), { slide: 2, code: { code: "K7QM4X", title: "Das Bundesverfassungsgericht", lines: [], codeShown: true } });
  assert.equal(liveReduce(st, { t: "code", on: true }, 3), false, "unverändert: kein neuer Stand");
  const v = st.v;
  liveReduce(st, { t: "goto", slide: 2 }, 4);
  assert.equal(st.codeShown, false); assert.equal(st.v, v + 1);
  // Wiederverbindung: die Lehrkraft schickt ihren Stand als start mit codeShown
  liveReduce(st, start({ slide: 2, codeShown: true }), 5);
  assert.equal(st.codeShown, true);
  liveReduce(st, start({ slide: 0, codeShown: true }), 6);
  assert.equal(st.codeShown, false, "auf Folie 0 ist die Codefolie ohnehin zu sehen");
  assert.equal(liveReduce(st, { t: "code", on: true }, 7), false, "… und lässt sich dort nicht zusätzlich einblenden");
  liveReduce(st, { t: "goto", slide: 1 }, 8);
  liveReduce(st, { t: "code", on: "ja" }, 9);
  assert.equal(st.codeShown, false, "nur on === true schaltet ein");
});

test("Live: Beenden setzt zurück, v bleibt monoton; fremde Nachrichten ändern nichts", () => {
  const st = fresh();
  liveReduce(st, start(), 1); liveReduce(st, { t: "goto", slide: 2 }, 2);
  const v = st.v;
  assert.equal(liveReduce(st, { t: "stop" }, 3), true);
  assert.equal(st.active, false); assert.equal(st.code, null); assert.deepEqual(st.codeSlides, []); assert.equal(st.v, v + 1);
  assert.deepEqual(liveView(st), { slide: null, code: null });
  for (const m of [null, "x", {}, { t: "goto", slide: 1 }, { t: "code", on: true }, { t: "start", fileId: "x", pages: 3 }, { t: "start", fileId: FILE, pages: 0 }, { t: "start", fileId: FILE, pages: 301 }, { t: "hack" }])
    assert.equal(liveReduce(st, m, 4), false, JSON.stringify(m));
  assert.equal(st.v, v + 1);
});

test("Live: Daten der Lehrkraft werden geprüft (Titel einzeilig und gekürzt, Platzhalter nur echte Seiten)", () => {
  const st = fresh();
  liveReduce(st, start({ title: "Titel\nmit\u0000Umbruch " + "x".repeat(300), codeSlides: [{ n: 9, lines: ["x"] }, { n: 2, lines: ["<b>fett</b>", 7] }, "x"] }), 1);
  assert.ok(!/[\n\u0000]/.test(st.title) && st.title.length === 200 && st.title.startsWith("Titel mit"));
  assert.deepEqual(st.codeSlides, [{ n: 2, lines: ["<b>fett</b>"] }]);
});
