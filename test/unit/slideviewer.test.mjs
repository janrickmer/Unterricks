// Folienfenster der Schüler:innen nach der Sitzung (Nachtrag 19, public/slideviewer.js) im Browser-Ersatz (fake-dom.mjs): Folie 1 zuerst,
// weiter/zurück mit gesperrten Enden, nie ein Abruf jenseits der Freigabe, ein spät geladenes Bild überschreibt keine neuere Auswahl,
// Nachbarfolien vorgeladen, Ansage der Live-Region, Pfeiltasten, Fehler mit „Erneut versuchen“, Rückfall ohne Folienbilder, Download.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/schueler/s/aaaaaaaaaaaaaaaa" });
const { ApiError } = await import("../../public/ui.js");
const { slideViewer, SV_TEXT, slideCount } = await import("../../public/slideviewer.js");
const { STUDENT_SLIDE_BLOCK } = await import("../../public/shared.js");

/* Bilder, die erst laden, wenn der Test es sagt (Reihenfolge frei wählbar) */
function images() {
  const made = [];
  const image = () => { const im = { onload: null, onerror: null, _src: "" }; Object.defineProperty(im, "src", { get: () => im._src, set: (v) => { im._src = v; made.push(im); } }); return im; };
  const find = (n) => made.filter((im) => im._src.endsWith("/" + n + ".jpg"));
  return { image, made, load: (n) => { for (const im of find(n)) if (im.onload) im.onload(); }, fail: (n) => { for (const im of find(n)) if (im.onerror) im.onerror(); }, srcs: () => made.map((im) => im._src) };
}
/* Server-Attrappe: liefert Links nur bis allowed; calls zeichnet die Abfragen auf */
function server({ total, allowed = total, noSlides = false, exp = Date.now() + 20 * 60e3, gate = null }) {
  const calls = [];
  const fetchSlides = async (from, to) => {
    calls.push([from, to]);
    if (gate) await gate();
    if (from > allowed) throw new ApiError("So weit seid ihr im Unterricht nicht gekommen.", 403, { code: "not_shown", total: allowed });
    const last = Math.min(to, allowed, from + STUDENT_SLIDE_BLOCK - 1), slides = [];
    if (!noSlides) for (let n = from; n <= last; n++) slides.push({ n, w: 1920, h: 1080, url: "https://api.test/api/slide/f/" + n + ".jpg" });
    return { total: allowed, from, to: last, exp, slides };
  };
  return { calls, fetchSlides };
}
const tick = () => D.sleep(0);
async function until(fn, label) { for (let i = 0; i < 200; i++) { if (fn()) return; await D.sleep(2); } assert.fail("nicht eingetreten: " + label); }
function mount(o) {
  document.querySelectorAll(".slideview").forEach((x) => x.remove());
  const v = slideViewer(o);
  document.getElementById("app").append(v.el);
  const q = (s) => v.el.querySelector(s);
  return { v, q, img: q(".sv-frame > img"), prev: q(".sv-prev"), next: q(".sv-next"), count: q(".sv-count"), live: v.el.querySelector('[role="status"].sr-only'), frame: q(".sv-frame") };
}

test("zeigt zuerst Folie 1; am Anfang „Vorherige Folie“, am Ende „Nächste Folie“ gesperrt – nie ein Abruf jenseits der Freigabe", async () => {
  const im = images(), srv = server({ total: 7 });
  const m = mount({ total: 7, cut: true, fetchSlides: srv.fetchSlides, image: im.image, download: async () => {} });
  assert.equal(m.count.textContent, "Folie 1 von 7");
  assert.equal(m.v.el.querySelector(".sv-cut").textContent, SV_TEXT.cut, "gekürzt: der Satz der Lehrkraft");
  assert.equal(m.prev.getAttribute("aria-disabled"), "true"); assert.equal(m.next.getAttribute("aria-disabled"), "false");
  await until(() => im.made.length >= 1, "Bild für Folie 1 angefordert");
  assert.equal(m.img.hidden, true, "bis zum Laden kein (leeres) Bild");
  im.load(1);
  assert.equal(m.img.src, "https://api.test/api/slide/f/1.jpg"); assert.equal(m.img.hidden, false);
  assert.equal(m.img.getAttribute("alt"), "Folie 1 von 7");
  assert.ok(!m.frame.classList.contains("loading"));
  assert.equal(m.frame.style["--sv-ar"], "1920 / 1080", "Rahmen im Seitenverhältnis der Folien");
  m.prev.click(); await tick();
  assert.equal(m.v.n, 1, "am Anfang bleibt es bei Folie 1");
  for (let k = 2; k <= 7; k++) { m.next.click(); await tick(); }
  assert.equal(m.count.textContent, "Folie 7 von 7");
  assert.equal(m.next.getAttribute("aria-disabled"), "true"); assert.equal(m.prev.getAttribute("aria-disabled"), "false");
  m.next.click(); D.press("End"); await tick();
  assert.equal(m.v.n, 7);
  assert.ok(srv.calls.every(([from, to]) => from >= 1 && to <= 7), JSON.stringify(srv.calls));
  assert.ok(im.srcs().every((s) => Number(/\/(\d+)\.jpg$/.exec(s)[1]) <= 7), "kein Bild jenseits der Freigabe – auch nicht beim Vorladen");
  assert.equal(srv.calls.length, 1, "ein Block für sieben Folien");
  m.v.destroy();
});

test("ein spät geladenes Bild überschreibt nie eine neuere Auswahl; Live-Region sagt den Wechsel an", async () => {
  const im = images(), srv = server({ total: 12 });
  const m = mount({ total: 12, cut: false, fetchSlides: srv.fetchSlides, image: im.image, download: async () => {} });
  assert.equal(m.v.el.querySelector(".sv-cut"), null, "ohne Markierung kein Satz zur Kürzung");
  await until(() => im.made.length >= 1, "Folie 1"); im.load(1);
  m.next.click(); await tick();
  m.next.click(); await tick();
  assert.equal(m.count.textContent, "Folie 3 von 12");
  assert.equal(m.live.textContent, "Folie 3 von 12");
  im.load(3);
  assert.equal(m.img.src, "https://api.test/api/slide/f/3.jpg");
  im.load(2);   // die Antwort für Folie 2 kommt zu spät
  assert.equal(m.img.src, "https://api.test/api/slide/f/3.jpg", "Folie 2 kommt zu spät und wird nicht gezeigt");
  assert.equal(m.img.getAttribute("alt"), "Folie 3 von 12");
  m.v.destroy();
});

test("Nachbarfolien vorladen – auch über die Grenze eines Blocks (nur bis zur Freigabe)", async () => {
  const im = images(), srv = server({ total: 25 });
  const m = mount({ total: 25, fetchSlides: srv.fetchSlides, image: im.image, download: async () => {} });
  await until(() => im.made.length >= 1, "Folie 1"); im.load(1);
  await until(() => im.srcs().some((s) => s.endsWith("/2.jpg")), "Folie 2 vorgeladen");
  m.v.go(10); await until(() => im.srcs().filter((s) => s.endsWith("/10.jpg")).length >= 1, "Folie 10"); im.load(10);
  await until(() => im.srcs().some((s) => s.endsWith("/11.jpg")), "Folie 11 vorgeladen (nächster Block)");
  assert.deepEqual(srv.calls, [[1, 10], [11, 20]]);
  assert.ok(im.srcs().some((s) => s.endsWith("/9.jpg")), "Folie 9 vorgeladen");
  m.v.destroy();
});

test("Pfeiltasten, wenn das Fenster den Fokus hat; Wischen nach links = nächste Folie", async () => {
  const im = images(), srv = server({ total: 5 });
  const m = mount({ total: 5, fetchSlides: srv.fetchSlides, image: im.image, download: async () => {} });
  await until(() => im.made.length >= 1, "Folie 1"); im.load(1);
  m.frame.focus();
  assert.equal(document.activeElement, m.frame, "das Fenster ist per Tab erreichbar (tabindex 0)");
  D.press("ArrowRight"); await tick();
  assert.equal(m.v.n, 2);
  D.press("ArrowLeft"); D.press("ArrowLeft"); await tick();
  assert.equal(m.v.n, 1);
  D.press("End"); await tick(); assert.equal(m.v.n, 5);
  D.press("Home"); await tick(); assert.equal(m.v.n, 1);
  m.next.focus(); D.press("ArrowRight"); await tick();
  assert.equal(m.v.n, 2, "auch mit dem Fokus auf einem Knopf des Fensters");
  D.fire(m.frame, "pointerdown", { pointerType: "touch", pointerId: 3, clientX: 300, clientY: 100 });
  D.fire(m.frame, "pointerup", { pointerType: "touch", pointerId: 3, clientX: 180, clientY: 112 });
  await tick(); assert.equal(m.v.n, 3, "nach links gewischt");
  D.fire(m.frame, "pointerdown", { pointerType: "touch", pointerId: 4, clientX: 100, clientY: 100 });
  D.fire(m.frame, "pointerup", { pointerType: "touch", pointerId: 4, clientX: 130, clientY: 260 });
  await tick(); assert.equal(m.v.n, 3, "senkrecht gezogen (scrollen) blättert nicht");
  m.v.destroy();
});

test("Bild lädt nicht: einmal mit frischen Links, dann ruhig „Erneut versuchen“ im Fenster (Fokus bleibt im Fenster)", async () => {
  const im = images(), srv = server({ total: 4 });
  const m = mount({ total: 4, fetchSlides: srv.fetchSlides, image: im.image, download: async () => {} });
  await until(() => im.made.length >= 1, "Folie 1");
  im.fail(1);
  await until(() => srv.calls.length === 2, "Links neu geholt");
  await until(() => im.made.filter((x) => x._src.endsWith("/1.jpg")).length >= 2, "zweiter Versuch");
  im.fail(1);
  const err = m.v.el.querySelector(".sv-err");
  assert.equal(err.hidden, false);
  assert.equal(err.querySelector("p").textContent, SV_TEXT.loadErr);
  assert.match(m.live.textContent, /^Folie 1 von 4: /);
  const retry = err.querySelector(".sv-retry");
  retry.focus(); retry.click();
  assert.equal(document.activeElement, m.frame, "der Fokus geht ins Fenster, nicht auf die Seite");
  assert.equal(err.hidden, true);
  await until(() => im.made.filter((x) => x._src.endsWith("/1.jpg")).length >= 3, "dritter Versuch");
  im.load(1);
  assert.equal(m.img.hidden, false); assert.equal(m.img.src, "https://api.test/api/slide/f/1.jpg");
  m.v.destroy();
});

test("Markierung inzwischen zurückgesetzt (403 not_shown): bis zur neuen letzten Folie, die Seite lädt neu", async () => {
  const im = images(); let stale = 0;
  const before = server({ total: 12 }), after = server({ total: 12, allowed: 4 });   // ab Folie 11 antwortet schon der neue Stand
  const m = mount({ total: 12, fetchSlides: (f, t) => (f > 10 ? after : before).fetchSlides(f, t), image: im.image, download: async () => {}, onStale: () => stale++ });
  await until(() => im.made.length >= 1, "Folie 1"); im.load(1);
  m.v.go(11);
  await until(() => m.v.n === 4, "zurück auf die neue letzte Folie");
  assert.equal(m.v.total, 4); assert.equal(m.count.textContent, "Folie 4 von 4");
  assert.equal(m.next.getAttribute("aria-disabled"), "true");
  assert.equal(stale, 1, "die Seite holt die Daten der Sitzung neu");
  m.v.destroy();
});

test("ältere Präsentation ohne Folienbilder: kein leeres Fenster, nur Hinweis und Download", async () => {
  const im = images(), srv = server({ total: 6, noSlides: true });
  const m = mount({ total: 6, fetchSlides: srv.fetchSlides, image: im.image, download: async () => {} });
  await until(() => !m.v.el.querySelector(".sv-stage"), "Fenster entfernt");
  assert.equal(m.v.el.querySelector(".sv-none").textContent, SV_TEXT.noSlides);
  assert.equal(m.v.el.querySelector(".sv-dl").textContent, SV_TEXT.download);
  assert.equal(im.made.length, 0);
  m.v.destroy();
});

test("„Diese Präsentation herunterladen“: ruft den Download; „wird vorbereitet“ (409) ruhig unter dem Knopf", async () => {
  const im = images(), srv = server({ total: 3 }); let calls = 0, fail = true;
  const m = mount({ total: 3, fetchSlides: srv.fetchSlides, image: im.image, download: async () => { calls++; if (fail) throw new ApiError("Die Präsentation wird gerade vorbereitet. Bitte versuch es gleich noch einmal.", 409, { code: "not_ready" }); } });
  const dl = m.v.el.querySelector(".sv-dl"), msg = m.v.el.querySelector(".sv-dlmsg");
  assert.equal(dl.textContent, SV_TEXT.download);
  assert.equal(msg.getAttribute("role"), "status");
  dl.click(); await until(() => msg.textContent !== "", "Meldung");
  assert.equal(calls, 1); assert.match(msg.textContent, /wird gerade vorbereitet/);
  assert.equal(document.querySelectorAll("#toasts .toast").length, 0, "keine rote Meldung");
  fail = false; dl.click(); await until(() => calls === 2 && !dl.disabled, "zweiter Versuch");
  assert.equal(msg.textContent, "");
  m.v.destroy();
});

test("Vollbild ohne Vollbild-Schnittstelle (iPhone): Ebene über der Seite, Fokus ins Fenster, Esc bzw. „Vollbild beenden“ zurück", async () => {
  const im = images(), srv = server({ total: 3 });
  const m = mount({ total: 3, fetchSlides: srv.fetchSlides, image: im.image, download: async () => {} });
  const fs = m.q(".sv-fs"), exit = m.q(".sv-exit"), stage = m.q(".sv-stage");
  assert.ok(!m.frame.contains(fs), "der Knopf verdeckt die Folie nicht (unter dem Fenster)");
  assert.equal(exit.hidden, true);
  fs.focus(); fs.click();
  assert.ok(stage.classList.contains("max") && stage.classList.contains("full"));
  assert.equal(exit.hidden, false); assert.equal(document.activeElement, m.frame, "Pfeiltasten wirken gleich");
  D.press("ArrowRight"); await tick(); assert.equal(m.v.n, 2);
  D.press("Escape");
  assert.ok(!stage.classList.contains("max") && !stage.classList.contains("full")); assert.equal(exit.hidden, true);
  assert.equal(document.activeElement, fs, "Fokus zurück auf „Vollbild“");
  fs.click(); exit.focus(); exit.click();
  assert.ok(!stage.classList.contains("full")); assert.equal(document.activeElement, fs);
  m.v.destroy();
});

test("Wortlaut", () => {
  assert.equal(slideCount(3, 12), "Folie 3 von 12");
  assert.equal(SV_TEXT.download, "Diese Präsentation herunterladen");
  assert.equal(SV_TEXT.cut, "So weit, wie ihr im Unterricht gekommen seid.");
  assert.deepEqual([SV_TEXT.prev, SV_TEXT.next], ["Vorherige Folie", "Nächste Folie"]);
});
