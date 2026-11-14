// Feld „Podcast für den kommenden Unterricht“ (public/podcast.js, Nachtrag 22) im Browser-Ersatz (fake-dom.mjs): Knopf, Dialog „heute oder nächster
// Schultag?“, Karte mit Sitzungen, Auftrag in der Zwischenablage, Ablagefeld (Prüfung vor dem Hochladen, Fortschritt), Player (Abspielen/Pause,
// Spulen per Tastatur, Zeitangabe), Löschen mit Rückfrage, Fokus. Der Server über globalThis.__tapi, Audio und Hochladen über PC.io.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const D = installDom({ hash: "#/lk" });
const { ApiError } = await import("../../public/ui.js");
const PC = await import("../../public/podcast.js");
const P = await import("../../public/podcastlib.js");

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const button = (root, text) => $$("button", root).find((b) => b.textContent.trim() === text);
async function until(cond, what) { for (let i = 0; i < 1500; i++) { if (cond()) return; await D.sleep(2); } assert.fail("nicht eingetreten: " + what); }
const desc = (el) => (el ? el.tagName + (el.id ? "#" + el.id : "") + " „" + el.textContent.trim().slice(0, 40) + "“" : String(el));
// Dienstag, 17.11.2026, 10:00 Uhr (MEZ)
const NOW = Date.UTC(2026, 10, 17, 9, 0);
const sess = (o) => ({ id: "a".repeat(15) + o.n, subject: "powi", klass: "8A", school: "gym", label: "PoWi 8A", title: "", topic: "", summary: "", fallback: "", summaryOutdated: false, ...o });
const PLAN = () => ({ ok: true, today: "2026-11-17", candidate: "2026-11-18", next: "2026-11-18", plans: [
  { date: "2026-11-17", sessions: [sess({ n: 1, startTime: "11:30", head: "Politik und Wirtschaft · Jahrgang 8 (Klasse 8a) · Dienstag, 17.11.2026, 11:30 Uhr", summary: "Heute." })] },
  { date: "2026-11-18", sessions: [
    sess({ n: 2, startTime: "08:00", head: "Politik und Wirtschaft · Jahrgang 9 (Klasse 9b) · Mittwoch, 18.11.2026, 8:00 Uhr", title: "Wahlen", label: "PoWi 9B", summary: "Die Stunde beginnt mit einem Blitzlicht.", summaryOutdated: true }),
    sess({ n: 3, subject: "gs", school: "gs", label: "Religion 2ab", startTime: "09:40", head: "Religion · Jahrgang 2 (Klassen 2a, 2b) · Mittwoch, 18.11.2026, 9:40 Uhr", title: "Josef", fallback: "Einstieg\nErzählung" }),
    sess({ n: 4, startTime: "11:30", label: "Ethik 10C", subject: "ethik", head: "Ethik · Jahrgang 10 (Klasse 10c) · Mittwoch, 18.11.2026, 11:30 Uhr", substitute: true }),
  ] }] });
const POD = (o = {}) => ({ id: "c".repeat(16), day: "2026-11-18", mime: "audio/wav", size: 8044, createdAt: NOW, deleteAfter: Date.UTC(2026, 10, 19, 23), url: "/api/podcast/" + "c".repeat(16) + "?e=1&s=x", urlExpires: NOW + 12 * 3600e3, ...o });

/* Audio-Ersatz: Ereignisse wie im Browser (play → playing, pause; Metadaten nach dem Setzen der Quelle) */
function fakeAudio(rec) {
  const ls = {}, a = { paused: true, currentTime: 0, duration: NaN, preload: "", _src: "",
    addEventListener: (t, f) => (ls[t] = ls[t] || []).push(f), removeEventListener: (t, f) => { ls[t] = (ls[t] || []).filter((x) => x !== f); },
    emit: (t) => { for (const f of [...(ls[t] || [])]) f({ type: t }); },
    get src() { return a._src; }, set src(v) { a._src = v; rec.srcs.push(v); setTimeout(() => { a.duration = 785; a.emit("loadedmetadata"); }, 1); },
    getAttribute: (k) => (k === "src" ? a._src || null : null), removeAttribute: () => { a._src = ""; }, load: () => {},
    play: () => { rec.plays++; a.paused = false; a.emit("play"); a.emit("playing"); return Promise.resolve(); },
    pause: () => { a.paused = true; a.emit("pause"); } };
  rec.audios.push(a);
  return a;
}
let rec;
async function mount(routes, list = { ok: true, today: "2026-11-17", podcasts: [] }) {
  if (globalThis.__leave) globalThis.__leave();
  rec = { calls: [], copies: [], uploads: [], audios: [], srcs: [], plays: 0 };
  globalThis.__tapi = async (method, path, o = {}) => {
    rec.calls.push(method + " " + path);
    if (method === "GET" && path === "/api/teacher/podcast") return typeof list === "function" ? list() : list;
    for (const [re, fn] of routes) { const m = re.exec(method + " " + path); if (m) return fn(m, o.body || {}); }
    throw new ApiError("nicht nachgebildet: " + method + " " + path, 404, { code: "not_found" });
  };
  Object.assign(PC.io, { now: () => NOW, copy: async (t) => { rec.copies.push(t); return true; }, audio: () => fakeAudio(rec), head: async (f) => f._head });
  const app = document.getElementById("app");
  while (app.firstChild) app.firstChild.remove();
  const card = PC.podcastCard();
  app.append(card);
  await D.sleep(5);
  return card;
}

test("Knopf → Dialog „heute oder nächster Schultag?“ → Karte: Sitzungen, Ersatz und Vertretung genannt, Auftrag in der Zwischenablage", async () => {
  const card = await mount([[/^GET \/api\/teacher\/podcast\/plan$/, () => PLAN()]]);
  const go = button(card, PC.GO_LABEL);
  assert.ok(go && $("svg", go), "Knopf mit Kopfhörer-Symbol");
  assert.equal(PC.GO_LABEL, "Podcast für den kommenden Unterricht entwickeln");
  D.userClick(go);
  await until(() => $(".modal"), "Dialog");
  const dlg = $(".modal");
  assert.equal(dlg.getAttribute("aria-label"), "Für welchen Unterricht ist der Podcast gedacht?");
  const choices = $$(".pc-choice", dlg).map((b) => $(".pc-cl", b).textContent + " | " + $(".pc-cs", b).textContent);
  assert.deepEqual(choices, ["Heute, Dienstag, 17.11. | noch 1 Stunde", "Nächster Schultag, Mittwoch, 18.11. | 2 Stunden"]);
  await until(() => document.activeElement === $$(".pc-choice", dlg)[0], "Fokus auf „Heute“");
  D.userClick($$(".pc-choice", dlg)[1]);
  await until(() => $("#pc-h", card), "Karte");
  assert.equal($("#pc-h", card).textContent, "Podcast für den Unterricht am Mittwoch, 18. November 2026");
  assert.equal(document.activeElement, $("#pc-h", card), "Fokus auf der Überschrift der Karte – " + desc(document.activeElement));
  assert.equal(card.getAttribute("aria-labelledby"), "pc-h");
  const items = $$(".pc-sessions li", card).map((li) => li.textContent);
  assert.deepEqual(items, [
    "Politik und Wirtschaft · Jahrgang 9 (Klasse 9b) · Mittwoch, 18.11.2026, 8:00 Uhr – Wahlen ZusammenfassungDie Zusammenfassung beschreibt eine frühere Planung – bei Bedarf in der Sitzung anpassen.",
    "Religion · Jahrgang 2 (Klassen 2a, 2b) · Mittwoch, 18.11.2026, 9:40 Uhr – Josef Ersatz aus der Planung",
    "Ethik · Jahrgang 10 (Klasse 10c) · Mittwoch, 18.11.2026, 11:30 Uhr Vertretung – nicht im Podcast"]);
  assert.equal($$(".pc-sessions a", card)[0].getAttribute("href"), "#/lk/s/" + "a".repeat(15) + "2");
  assert.ok($$(".pc-note", card).some((p) => p.textContent === "Für 1 Sitzung gibt es noch keine Zusammenfassung – Unterricks nimmt dafür Thema und Verlaufsplan: 9:40 Grundschule Religion 2ab."));
  // Auftrag kopieren
  D.userClick(button(card, PC.COPY_LABEL));
  await until(() => rec.copies.length === 1, "kopiert");
  const plan = PLAN().plans[1];
  assert.equal(rec.copies[0], P.podcastTask("2026-11-18", P.podcastSource(plan).text));
  assert.match($(".pc-prep > .pc-status", card).textContent, /^Der Auftrag ist kopiert\./);
  assert.equal($$(".pc-steps li", card).length, 3);
  assert.match($$(".pc-steps li", card)[0].textContent, /Strg\+E \(Mac: Cmd\+E\)/);
  // ohne Claude: Quelltext und Steueranweisung einzeln
  assert.equal($("summary", $(".pc-manual", card)).textContent, "Ohne Claude (z. B. am iPad)");
  assert.equal($("#pc-src", card).value, P.podcastSource(plan).text); assert.equal($("#pc-steer", card).value, P.PODCAST_STEER);
  D.userClick(button(card, "Steueranweisung kopieren")); await until(() => rec.copies.length === 2, "Steueranweisung");
  assert.equal(rec.copies[1], P.PODCAST_STEER);
  // Abbrechen → wieder der Knopf (Fokus darauf)
  D.userClick(button(card, "Abbrechen"));
  await until(() => button(card, PC.GO_LABEL), "Knopf wieder da");
  assert.equal(document.activeElement, button(card, PC.GO_LABEL));
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("ohne Unterricht heute direkt der nächste Schultag; nichts in Sicht → Meldung; Tag nur laut Stundenplan → Hinweis ohne Ablagefeld", async () => {
  let card = await mount([[/^GET \/api\/teacher\/podcast\/plan$/, () => ({ ...PLAN(), plans: PLAN().plans.slice(1) })]]);
  D.userClick(button(card, PC.GO_LABEL));
  await until(() => $("#pc-h", card), "Karte ohne Dialog");
  assert.equal($(".modal"), null);
  card = await mount([[/^GET \/api\/teacher\/podcast\/plan$/, () => ({ ok: true, today: "2026-11-17", next: null, plans: [] })]]);
  D.userClick(button(card, PC.GO_LABEL));
  await until(() => $(".pc-status", card).textContent, "Meldung");
  assert.equal($(".pc-status", card).textContent, "In den nächsten Wochen ist kein Unterricht geplant – für einen Podcast braucht Unterricks einen Tag mit Unterricht.");
  card = await mount([[/^GET \/api\/teacher\/podcast\/plan$/, () => ({ ok: true, today: "2026-11-20", next: "2026-11-23", plans: [{ date: "2026-11-23", sessions: [] }] })]]);
  D.userClick(button(card, PC.GO_LABEL));
  await until(() => $(".pc-empty", card), "Hinweis");
  assert.match($(".pc-empty", card).textContent, /^Am Montag, 23\.11\.2026, ist laut Stundenplan Unterricht, aber noch keine Sitzung angelegt\./);
  assert.equal($("#pc-drop", card), null); assert.equal(button(card, PC.COPY_LABEL), undefined);
});

test("Ablagefeld: keine Audiodatei bzw. zu groß → Meldung ohne Hochladen; Audiodatei → Fortschritt, danach der Player (Fokus auf „Abspielen“)", async () => {
  const card = await mount([[/^GET \/api\/teacher\/podcast\/plan$/, () => ({ ...PLAN(), plans: PLAN().plans.slice(1) })]]);
  D.userClick(button(card, PC.GO_LABEL));
  await until(() => $("#pc-drop", card), "Ablagefeld");
  const zone = $("#pc-drop", card), inp = $("#pc-file", card);
  assert.equal(zone.getAttribute("aria-label"), "Podcast-Datei hier ablegen oder auswählen"); assert.equal(zone.getAttribute("role"), "button");
  const pick = (f) => { Object.defineProperty(inp, "files", { value: [f], configurable: true }); D.fire(inp, "change"); };
  pick({ name: "x.pdf", size: 1000, _head: new TextEncoder().encode("%PDF-1.7 aaaaaaaaaaaa") });
  await until(() => $(".pc-err", card).textContent, "Meldung");
  assert.match($(".pc-err", card).textContent, /^Das ist keine Audiodatei/);
  pick({ name: "lang.m4a", size: 96_000_000, _head: new Uint8Array([0, 0, 0, 32, 102, 116, 121, 112, 77, 52, 65, 32]) });
  await until(() => /zu groß/.test($(".pc-err", card).textContent), "zu groß");
  assert.equal(rec.uploads.length, 0);
  let progress, done;
  PC.io.upload = (path, file, type, onP) => { rec.uploads.push([path, file.name, type]); progress = onP; return { promise: new Promise((r) => { done = r; }), abort: () => {} }; };
  zone.focus();
  pick({ name: "Audio-Zusammenfassung.wav", size: 8044, _head: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]) });
  await until(() => rec.uploads.length === 1, "Hochladen");
  assert.deepEqual(rec.uploads[0], ["/api/teacher/podcast?day=2026-11-18", "Audio-Zusammenfassung.wav", "audio/wav"]);
  progress(4022, 8044);
  assert.equal($(".pc-prog", card).textContent, "Lade hoch … 50 % (4 KB von 8 KB)");
  assert.equal(Number($(".pc-bar", card).value), 50);
  assert.equal(zone.getAttribute("aria-disabled"), "true");
  done({ ok: true, podcast: POD() });
  await until(() => $(".pc-item", card), "Player");
  assert.equal($(".pc-item h2", card).textContent, "Podcast zum Unterricht am Mittwoch, 18. November 2026");
  assert.equal(document.activeElement, button(card, "Abspielen"), "Fokus auf „Abspielen“ – " + desc(document.activeElement));
  await until(() => $(".pc-player > .pc-status", card).textContent, "Ansage");
  assert.equal($(".pc-player > .pc-status", card).textContent, "Gespeichert: „Podcast zum Unterricht am Mittwoch, 18. November 2026“ – Sie können ihn jetzt abspielen.");
});

test("Player: Abspielen/Pause, Zeitangabe, Spulen mit Pfeilen (±5 s) und Bild auf/ab (±30 s), KI-Hinweis, Löschen mit Rückfrage", async () => {
  let pods = [POD()];
  const card = await mount([[/^DELETE \/api\/teacher\/podcast\/(\w+)$/, (m) => { pods = pods.filter((p) => p.id !== m[1]); return { ok: true }; }]], () => ({ ok: true, today: "2026-11-17", podcasts: pods }));
  await until(() => $(".pc-item", card), "Player");
  assert.equal(button(card, PC.GO_LABEL), undefined, "der Player ersetzt den Knopf");
  assert.equal($(".pc-ai", card).textContent, "KI-erzeugt mit Gemini Notebook");
  assert.equal($(".pc-meta", card).textContent, "8 KB · wird am Freitag, 20.11.2026 automatisch gelöscht");
  assert.ok(button(card, "Podcast für einen anderen Tag entwickeln") && button(card, "Podcast löschen"));
  const a = rec.audios[0], play = button(card, "Abspielen"), pause = button(card, "Pause"), range = $(".pc-range", card);
  assert.equal(a._src, "/api/podcast/" + "c".repeat(16) + "?e=1&s=x");
  await until(() => !range.disabled, "Metadaten");
  assert.equal($(".pc-time", card).textContent, "0:00 / 13:05");
  assert.equal(pause.getAttribute("aria-disabled"), "true");
  D.userClick(play);
  assert.equal(rec.plays, 1); assert.equal(play.getAttribute("aria-disabled"), "true"); assert.equal(pause.getAttribute("aria-disabled"), "false");
  a.currentTime = 252; a.emit("timeupdate");
  assert.equal($(".pc-time", card).textContent, "4:12 / 13:05"); assert.equal(range.getAttribute("aria-valuetext"), "4:12 von 13:05"); assert.equal(range.value, "252");
  range.focus();
  D.press("ArrowRight"); assert.equal(a.currentTime, 257);
  D.press("ArrowLeft"); D.press("ArrowLeft"); assert.equal(a.currentTime, 247);
  D.press("PageUp"); assert.equal(a.currentTime, 277);
  D.press("PageDown"); assert.equal(a.currentTime, 247);
  D.press("End"); assert.equal(a.currentTime, 785); D.press("Home"); assert.equal(a.currentTime, 0);
  range.value = "600"; D.fire(range, "change"); assert.equal(a.currentTime, 600);
  D.userClick(pause);
  assert.equal(a.paused, true); assert.equal(play.getAttribute("aria-disabled"), "false");
  // Löschen: erst Rückfrage (Abbrechen ändert nichts), dann gelöscht → wieder der Knopf mit Fokus
  D.userClick(button(card, "Podcast löschen"));
  await until(() => $(".modal"), "Rückfrage");
  assert.match($(".modal p").textContent, /„Podcast zum Unterricht am Mittwoch, 18\. November 2026“ wird gelöscht/);
  D.userClick(button($(".modal"), "Abbrechen")); await D.sleep(5);
  assert.ok(!rec.calls.some((x) => x.startsWith("DELETE")));
  D.userClick(button(card, "Podcast löschen"));
  await until(() => $(".modal"), "Rückfrage 2");
  D.userClick(button($(".modal"), "Löschen"));
  await until(() => button(card, PC.GO_LABEL), "Knopf");
  assert.ok(rec.calls.includes("DELETE /api/teacher/podcast/" + "c".repeat(16)));
  assert.equal(document.activeElement, button(card, PC.GO_LABEL), "Fokus auf dem Knopf – " + desc(document.activeElement));
  await until(() => $(".pc-status", card).textContent, "Ansage");
  assert.equal($(".pc-status", card).textContent, "Der Podcast ist gelöscht.");
  assert.equal(a._src, "", "Wiedergabe beendet, Quelle entfernt");
});

test("abgelaufener Link: „Abspielen“ holt erst einen neuen; ein Ladefehler erneuert ihn einmal; Verlassen der Seite hält an", async () => {
  const card = await mount([[/^POST \/api\/teacher\/podcast\/(\w+)\/link$/, () => ({ ok: true, podcast: POD({ url: "/api/podcast/" + "c".repeat(16) + "?e=2&s=neu", urlExpires: NOW + 24 * 3600e3 }) })]],
    { ok: true, today: "2026-11-17", podcasts: [POD({ urlExpires: NOW + 30e3 })] });
  await until(() => $(".pc-item", card), "Player");
  const a = rec.audios[0];
  D.userClick(button(card, "Abspielen"));
  await until(() => rec.calls.some((x) => x.endsWith("/link")), "neuer Link");
  await until(() => rec.plays === 1, "danach abgespielt");
  assert.equal(a._src, "/api/podcast/" + "c".repeat(16) + "?e=2&s=neu");
  a.emit("error");
  await until(() => rec.calls.filter((x) => x.endsWith("/link")).length === 2 && rec.plays === 2, "einmal erneuert, weiter abgespielt");
  a.emit("error");
  await D.sleep(10);
  assert.equal(rec.calls.filter((x) => x.endsWith("/link")).length, 2, "nicht endlos");
  assert.equal($(".pc-msg", card).textContent, "Der Podcast lässt sich gerade nicht abspielen. Bitte die Seite neu laden.");
  globalThis.__leave();
  assert.equal(a.paused, true); assert.equal(a._src, "");
});

test("Tastatur: Enter auf „Abspielen“ → Fokus auf „Pause“ (der gesperrte Knopf behält ihn nicht), Enter → zurück; am Ende ebenso; woanders gesetzter Fokus bleibt", async () => {
  const card = await mount([], { ok: true, today: "2026-11-17", podcasts: [POD()] });
  await until(() => $(".pc-item", card) && !$(".pc-range", card).disabled, "Player");
  const a = rec.audios[0], play = button(card, "Abspielen"), pause = button(card, "Pause"), range = $(".pc-range", card);
  play.focus(); D.press("Enter");
  assert.equal(rec.plays, 1); assert.equal(play.getAttribute("aria-disabled"), "true");
  assert.equal(document.activeElement, pause, "Fokus auf „Pause“ – " + desc(document.activeElement));
  D.press("Enter");
  assert.equal(a.paused, true); assert.equal(document.activeElement, play, "Fokus zurück auf „Abspielen“ – " + desc(document.activeElement));
  // die Folge endet, während der Fokus auf „Pause“ liegt → „Abspielen“
  D.press("Enter"); assert.equal(document.activeElement, pause);
  a.paused = true; a.emit("ended");
  assert.equal(document.activeElement, play, "am Ende: Fokus auf „Abspielen“ – " + desc(document.activeElement));
  // Fokus auf dem Schieberegler: Abspielen und das Ende ändern ihn nicht
  D.userClick(play); range.focus();
  a.paused = true; a.emit("pause"); a.emit("ended");
  assert.equal(document.activeElement, range, "der Fokus bleibt, wo die Lehrkraft ihn hingesetzt hat – " + desc(document.activeElement));
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});

test("Tag vorbei, Fenster blieb offen: beim Zurückkehren ins Fenster (focus) bzw. in den Tab neu geladen – wieder der Knopf; nie mitten in die Karte", async () => {
  let lists = 0;
  const card = await mount([[/^GET \/api\/teacher\/podcast\/plan$/, () => ({ ...PLAN(), plans: PLAN().plans.slice(1) })]],
    () => (++lists === 1 ? { ok: true, today: "2026-11-17", podcasts: [POD({ day: "2026-11-17" })] } : { ok: true, today: "2026-11-18", podcasts: [] }));
  await until(() => $(".pc-item", card), "Player für den 17.");
  D.fire(globalThis.window, "focus"); document.dispatchEvent(new D.Event("visibilitychange"));
  await D.sleep(10);
  assert.equal(lists, 1, "am selben Tag: kein Neuladen");
  PC.io.now = () => NOW + 22 * 3600e3;   // Mittwoch, 18.11., 8:00 Uhr
  D.fire(globalThis.window, "focus");
  await until(() => button(card, PC.GO_LABEL), "Knopf nach dem Tageswechsel");
  assert.equal(lists, 2); assert.equal($(".pc-item", card), null);
  D.fire(globalThis.window, "focus"); await D.sleep(10);
  assert.equal(lists, 2, "nur einmal je Tag");
  PC.io.now = () => NOW + 46 * 3600e3;   // Donnerstag
  // in der Karte (Claude arbeitet gerade in Gemini Notebook): kein Neuladen beim Hin- und Herwechseln
  D.userClick(button(card, PC.GO_LABEL));
  await until(() => $("#pc-drop", card), "Karte");
  D.fire(globalThis.window, "focus"); document.dispatchEvent(new D.Event("visibilitychange"));
  await D.sleep(10);
  assert.ok($("#pc-drop", card), "die Karte bleibt"); assert.equal(lists, 2);
});

test("nach dem Hochladen: Fokus auf „Abspielen“ genau des neuen Podcasts (auch wenn ein früherer Tag darüber steht); Karte nennt Download-Symbol und Auswahl", async () => {
  const todays = POD({ id: "d".repeat(16), day: "2026-11-17" });
  const card = await mount([[/^GET \/api\/teacher\/podcast\/plan$/, () => ({ ...PLAN(), plans: PLAN().plans.slice(1) })]], { ok: true, today: "2026-11-17", podcasts: [todays] });
  await until(() => $(".pc-item", card), "Player für heute");
  D.userClick(button(card, "Podcast für einen anderen Tag entwickeln"));
  await until(() => $("#pc-drop", card), "Karte für morgen");
  assert.equal($$(".pc-steps li", card)[2].textContent, "Ziehen Sie die heruntergeladene Datei aus den Downloads von Chrome (Download-Symbol oben rechts) auf das Feld „Podcast-Datei hier ablegen“ – oder klicken Sie auf das Feld und wählen Sie sie aus. Danach löscht Claude das Notizbuch in Gemini Notebook wieder – vorher fragt Claude Sie.");
  assert.match($("#pc-drop-h", card).textContent, /Klicken, antippen oder Enter: Datei auswählen\.$/);
  let done;
  PC.io.upload = (path, file, type) => { rec.uploads.push([path, file.name, type]); return { promise: new Promise((r) => { done = r; }), abort: () => {} }; };
  const zone = $("#pc-drop", card), inp = $("#pc-file", card);
  zone.focus();
  Object.defineProperty(inp, "files", { value: [{ name: "morgen.wav", size: 8044, _head: new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 65, 86, 69]) }], configurable: true });
  D.fire(inp, "change");
  await until(() => rec.uploads.length === 1, "Hochladen");
  done({ ok: true, podcast: POD() });
  await until(() => $$(".pc-item", card).length === 2, "zwei Player");
  assert.deepEqual($$(".pc-item h2", card).map((x) => x.textContent), ["Podcast zum Unterricht am Dienstag, 17. November 2026", "Podcast zum Unterricht am Mittwoch, 18. November 2026"]);
  const item = $$(".pc-item", card)[1];
  assert.equal(document.activeElement, button(item, "Abspielen"), "Fokus auf „Abspielen“ des neuen Podcasts – " + desc(document.activeElement));
  assert.equal(globalThis.__domErrors.length, 0, globalThis.__domErrors.join("\n"));
});
