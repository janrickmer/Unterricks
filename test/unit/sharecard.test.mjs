// Karte „Mit Kolleg:innen teilen“ (Nachtrag 39, public/sharecard.js) im Browser-Ersatz (fake-dom.mjs) – Befunde der zweiten Prüfung:
// „Gespeicherte Fassung übernehmen“ beim Teilen bricht nicht still ab, ein Abruf von vor dem Speichern überschreibt den gespeicherten Stand nicht,
// die Karte lädt auch mit ungespeicherten Absätzen neu (sie bleiben), ein Neuaufbau der Seite behält sie, Fokus und Schreibmarke bleiben,
// alle Hinweise zum Ordner stehen im Dialog. share.js ist hier eine Attrappe (globalThis.__build). Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const SHARE_STUB = "data:text/javascript," + encodeURIComponent("export const buildShareZip = (...a) => globalThis.__build(...a);");
register("data:text/javascript," + encodeURIComponent("const STUB = " + JSON.stringify(SHARE_STUB) +
  '; export async function resolve(s, c, n) { const r = await n(s, c); if (r.url.endsWith("/public/share.js")) return { url: STUB, shortCircuit: true }; return r; }'));
const D = installDom({ hash: "#/lk" });
const { shareCard } = await import("../../public/sharecard.js");
const { ApiError } = await import("../../public/ui.js");

const T = (s) => ({ passiert: "Die Klasse " + s + ".", kompetenz: "Die Schüler:innen erklären " + s + ".", ziel: "Die Lerngruppe kann " + s + " nennen.", at: 1000 });
const UNIT = { id: "u".repeat(16), subject: "powi", klass: "Q3-LK", title: "Wahlen", rows: [{ uid: "r1", stundenfrage: "Warum wählen?" }, { uid: "r2", stundenfrage: "Wie zählen?" }] };
const until = async (fn, ms = 3000) => { for (let i = 0; i < ms / 5; i++) { if (fn()) return true; await D.sleep(5); } return false; };
const btn = (t, root = document) => [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === t);
const modalOf = (title) => [...document.querySelectorAll(".modal")].find((m) => m.getAttribute("aria-label") === title);
const clean = () => { const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove(); for (const m of document.querySelectorAll(".modal-back")) m.remove(); globalThis.__leave(); };

/* Server-Ersatz: share = Stand der Sitzungen (mit Zeitpunkt), patch(id, body) → Antwort oder Fehler; hold = GET der Karte anhalten */
function server(lessons) {
  const s = { lessons: structuredClone(lessons), patches: [], gets: 0, hold: null, conflictOnce: null };
  globalThis.__tapi = async (method, path, o = {}) => {
    if (method === "GET" && path.endsWith("/share")) {
      s.gets++;
      const snap = structuredClone(s.lessons);
      if (s.hold) await s.hold;
      return { ok: true, lessons: snap };
    }
    if (method === "GET" && path === "/api/teacher/units/" + UNIT.id) return { ok: true, unit: UNIT };
    const m = /\/api\/teacher\/lessons\/(\w+)$/.exec(path);
    if (method === "PATCH" && m) {
      const L = s.lessons.find((x) => x.id === m[1]);
      s.patches.push({ id: m[1], ...o.body });
      if (s.conflictOnce && s.conflictOnce.id === m[1]) {
        const c = s.conflictOnce; s.conflictOnce = null; L.shareText = c.current;
        throw new ApiError("Der Absatz wurde inzwischen an anderer Stelle geändert.", 409, { code: "share_conflict", current: c.current });
      }
      L.shareText = { ...o.body.shareText, at: (L.shareText ? L.shareText.at : 0) + 1 };
      return { ok: true, lesson: { id: L.id, shareText: L.shareText } };
    }
    throw new Error("unerwartet " + method + " " + path);
  };
  return s;
}
function mount(ctx = {}) {
  const card = shareCard({ getUnit: () => UNIT, gs: false, isDirty: () => false, saveUnit: async () => {}, ...ctx });
  document.getElementById("app").append(card.el);
  return card;
}
const field = (id, k) => document.getElementById("sh-" + id + "-" + k);
const type = (el, v) => { el.value = v; D.fire(el, "input"); };
const openDetails = () => { const d = document.querySelector("details.sharetexts"); d.open = true; };
const L1 = "a".repeat(16), L2 = "b".repeat(16);

test("Teilen mit ungespeichertem Absatz: Konflikt → „Gespeicherte Fassung übernehmen“ – danach wird der Ordner erstellt (nicht still abgebrochen); alle Hinweise, Fokus zurück", async () => {
  const s = server([{ id: L1, row: "r1", title: "Eins", planned: true, shareText: T("eins") }, { id: L2, row: "r2", title: "Zwei", planned: true, shareText: T("zwei") }]);
  const built = [];
  const notes = Array.from({ length: 75 }, (_, i) => "Sitzung 1: Hinweis " + (i + 1) + ".");
  globalThis.__build = async (unit) => { built.push(unit.id); return { blob: new Blob(["zip"]), name: "Wahlen - zum Teilen.zip", sessions: 2, missing: 0, notes }; };
  try {
    mount();
    assert.ok(await until(() => field(L1, "ziel")));
    openDetails();
    type(field(L1, "ziel"), "Meine Fassung.");
    s.conflictOnce = { id: L1, current: { ...T("eins"), ziel: "Von Claude.", at: 2000 } };
    const share = btn("Unterrichtseinheit mit KollegInnen teilen");
    D.userClick(share);
    assert.ok(await until(() => modalOf("Ungespeicherte Absätze")));
    assert.equal(modalOf("Ungespeicherte Absätze").querySelector("p").textContent,
      "Ihre Änderungen an den Absätzen sind noch nicht gespeichert. Jetzt speichern und danach den Ordner erstellen? Mit „Abbrechen“ wird der Ordner nicht erstellt.");
    D.userClick(btn("Speichern", modalOf("Ungespeicherte Absätze")));
    assert.ok(await until(() => modalOf("Absatz inzwischen geändert")));
    assert.ok(field(L1, "ziel").readOnly, "während der Rückfrage bleiben die Felder gesperrt (es wird noch gespeichert)");
    D.userClick(btn("Gespeicherte Fassung übernehmen", modalOf("Absatz inzwischen geändert")));
    assert.ok(await until(() => built.length === 1), "der Ordner wird danach erstellt");
    assert.ok(await until(() => modalOf("Hinweise zum Ordner")));
    const items = modalOf("Hinweise zum Ordner").querySelectorAll("li");
    assert.equal(items.length, 75, "alle Hinweise, nicht nur die ersten 60");
    assert.equal(items[74].textContent, "Sitzung 1: Hinweis 75.");
    assert.equal(field(L1, "ziel").value, "Von Claude.", "das Feld zeigt die übernommene gespeicherte Fassung");
    assert.equal(s.patches.length, 1, "nach „übernehmen“ nichts überschrieben");
    D.userClick(btn("Fertig", modalOf("Hinweise zum Ordner")));
    assert.ok(await until(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.k === "share"),
      "„Fertig“ gibt den Fokus an den (neu gezeichneten) Knopf zurück, nicht an body: " + (document.activeElement && document.activeElement.tagName));
  } finally { clean(); delete globalThis.__build; }
});

test("Ein Abruf, der vor dem Speichern begann, überschreibt den gespeicherten Stand nicht (kein falscher Konflikt beim nächsten Speichern)", async () => {
  const s = server([{ id: L1, row: "r1", title: "Eins", planned: true, shareText: T("eins") }]);
  try {
    const card = mount();
    assert.ok(await until(() => field(L1, "passiert")));
    openDetails();
    // langsamer Abruf (z. B. beim Zurückkehren in den Tab) – er liest den alten Stand
    let release; s.hold = new Promise((r) => { release = r; });
    const p = card.refresh();
    await D.sleep(5);
    type(field(L1, "passiert"), "Die Klasse zählt neu aus.");
    D.userClick(btn("Absätze speichern"));
    assert.ok(await until(() => s.patches.length === 1));
    s.hold = null; release();
    await p;
    assert.ok(await until(() => document.querySelector(".save-state").textContent === "Absätze gespeichert"));
    await D.sleep(20);
    assert.equal(field(L1, "passiert").value, "Die Klasse zählt neu aus.", "der gespeicherte Stand bleibt sichtbar");
    type(field(L1, "ziel"), "Neues Ziel.");
    D.userClick(btn("Absätze speichern"));
    assert.ok(await until(() => s.patches.length === 2));
    assert.equal(s.patches[1].shareTextBase, 1001, "die nächste Änderung beruht auf dem gespeicherten Stand (nicht auf dem alten Abruf)");
    assert.ok(!modalOf("Absatz inzwischen geändert"), "kein falscher Konflikt");
  } finally { clean(); }
});

test("Ungespeicherte Absätze: die Karte lädt trotzdem neu (ein von Claude geschriebener Absatz einer anderen Sitzung erscheint), die eigene Eingabe und die Schreibmarke bleiben", async () => {
  const s = server([{ id: L1, row: "r1", title: "Eins", planned: true, shareText: T("eins") }, { id: L2, row: "r2", title: "Zwei", planned: true, shareText: null }]);
  try {
    const card = mount();
    assert.ok(await until(() => field(L2, "passiert")));
    openDetails();
    const f = field(L1, "passiert");
    type(f, "Meine Änderung mitten im Text.");
    f.focus(); f.setSelectionRange(5, 5);
    s.lessons[1].shareText = T("zwei von Claude");
    await card.refresh();
    assert.equal(field(L2, "passiert").value, "Die Klasse zwei von Claude.", "neuer Absatz der anderen Sitzung");
    assert.equal(field(L1, "passiert").value, "Meine Änderung mitten im Text.", "die eigene Eingabe bleibt");
    assert.equal(document.activeElement, field(L1, "passiert"), "Fokus im neu gezeichneten Feld");
    assert.deepEqual([document.activeElement.selectionStart, document.activeElement.selectionEnd], [5, 5], "die Schreibmarke springt nicht ans Ende");
    // eine Anfrage während eines laufenden Abrufs: danach wird noch einmal geladen
    let release; s.hold = new Promise((r) => { release = r; });
    const g0 = s.gets, p1 = card.refresh();
    await D.sleep(5);
    const p2 = card.refresh();
    s.hold = null; release();
    await Promise.all([p1, p2]);
    assert.equal(s.gets - g0, 2, "noch ein Abruf nach dem laufenden");
  } finally { clean(); }
});

test("Neuaufbau der Einheitenseite (z. B. nach „Krankmeldung rückgängig machen“): keep() – die neue Karte derselben Einheit übernimmt die ungespeicherten Absätze", async () => {
  server([{ id: L1, row: "r1", title: "Eins", planned: true, shareText: T("eins") }]);
  try {
    const a = mount();
    assert.ok(await until(() => field(L1, "ziel")));
    openDetails();
    type(field(L1, "ziel"), "Ungespeichert.");
    assert.equal(a.dirty(), true);
    a.keep(); clean();
    const b = mount();
    assert.ok(await until(() => field(L1, "ziel")));
    assert.equal(field(L1, "ziel").value, "Ungespeichert.");
    assert.equal(b.dirty(), true);
    assert.ok(document.querySelector("details.sharetexts").open, "der Bereich ist aufgeklappt");
    assert.equal(document.querySelector(".save-state").textContent, "Ungespeicherte Absätze");
    assert.equal(btn("Absätze speichern").disabled, false);
    clean();
    const c = mount();   // ohne keep(): nichts übernommen
    assert.ok(await until(() => field(L1, "ziel")));
    assert.equal(c.dirty(), false);
  } finally { clean(); }
});

test("Erneut versuchen nach einem Ladefehler: danach Fokus in der Karte (nicht auf body); ein Fehler bei vorhandenem Stand lässt die Karte stehen", async () => {
  const s = server([{ id: L1, row: "r1", title: "Eins", planned: true, shareText: T("eins") }]);
  const real = globalThis.__tapi;
  let fail = true;
  globalThis.__tapi = async (m, p, o) => { if (fail && p.endsWith("/share")) throw new Error("Keine Verbindung"); return real(m, p, o); };
  try {
    const card = mount();
    assert.ok(await until(() => btn("Erneut versuchen")));
    fail = false;
    D.userClick(btn("Erneut versuchen"));
    assert.ok(await until(() => field(L1, "ziel")));
    const a = document.activeElement;
    assert.ok(a && a.closest && a.closest("#unitshare") && a.dataset.k, "Fokus auf einem Knopf bzw. der Überschrift der Karte: " + (a && a.tagName));
    fail = true;
    await card.refresh();
    assert.ok(field(L1, "ziel") && !btn("Erneut versuchen"), "Stand schon da: kein Fehlerblock beim stillen Neuladen");
    assert.ok(s.gets >= 1);
  } finally { clean(); }
});
