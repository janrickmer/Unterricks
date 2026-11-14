// update.js – Nach einem Update (S24, 14.11.2026): Eine Seite führt nie Programmteile zweier Stände zusammen aus.
// Fehler vom 14.11.2026: Ein vor dem Deploy geöffneter Tab hatte die alte portalview.js im Speicher und lud nach dem Deploy die neue session.js
// nach – „does not provide an export named 'keepFocusOn'“. Seitdem liegt jeder Stand in einem eigenen Ordner /v/<Stand>/ (scripts/build.mjs,
// public/boot.js); dieses Modul kennt seinen Stand aus der eigenen Adresse und
//   • fragt beim Seitenwechsel (Router in app.js; höchstens alle NAV_FRESH_MS) und beim Zurückkehren in den Tab nach dem aktuellen Stand
//     (/version.json, nie aus einem Zwischenspeicher). Ist ein neuer da und der Moment sicher, verlässt es die Seite wie bei jedem Seitenwechsel
//     (sie speichert dabei), wartet laufende Arbeiten ab und lädt an der neuen Adresse neu – bevor Module des alten Stands nachgeladen werden;
//   • lädt nie von selbst neu, solange etwas verloren gehen oder stören könnte: ein offener Dialog bzw. eine Ebene (Präsentationsmodus, Codefolie,
//     Vollbild), eine angemeldete Präsentation (Beamer, Live-Fenster der Schüler:innen – holdReload), laufende Arbeiten (Speichern, Hochladen,
//     Herunterladen, Folien erzeugen – ui.js) und ungespeicherte Eingaben (die eigenen Rückfragen der Seiten beim Verlassen: beforeunload);
//   • macht aus einem gescheiterten Nachladen (lazy(import(…))) einen ruhigen Hinweis mit „Neu laden“ statt der technischen Meldung – im Dialog
//     (Aktion auf der Seite) bzw. als Seite (Seitenwechsel); von selbst neu geladen wird höchstens einmal je Stand (Merker in sessionStorage,
//     gemeinsam mit boot.js) und nur, wenn tatsächlich ein neuer Stand ausgeliefert wird.
// Ohne Stand in der Adresse (Unit-Tests lesen public/) prüft es nichts.
import { h, nn, modal, openLayerCount, workPending } from "./ui.js";

export const BUILD_RE = /^[a-f0-9]{12}$/;
export const RELOAD_KEY = "u.reload";   // = boot.js
export const NAV_FRESH_MS = 15000;   // beim Seitenwechsel: so lange gilt eine Prüfung als frisch (Weiterleitungen, schnelles Klicken)
export const NAV_TIMEOUT_MS = 2500;   // so lange wartet ein Seitenwechsel höchstens auf die Antwort
export const VIS_FRESH_MS = 60000;   // beim Zurückkehren in den Tab höchstens einmal je Minute
export const SETTLE_MS = 8000;   // so lange warten auf laufende Arbeiten, bevor neu geladen wird
export const START_CHECK_MS = 3000;   // nach dem Start einmal im Hintergrund nachfragen (ein bis zu 10 Minuten altes index.html von Pages)

export const UPDATE_TEXT = {
  title: "Unterricks wurde aktualisiert",
  sie: "Seit Sie diese Seite geöffnet haben, gibt es eine neue Version von Unterricks. Laden Sie die Seite bitte neu – Sie kommen danach an dieselbe Stelle zurück.",
  du: "Seit du diese Seite geöffnet hast, gibt es eine neue Version von Unterricks. Lade die Seite bitte neu – du kommst danach an dieselbe Stelle zurück.",
  button: "Jetzt neu laden",
};
export const LOAD_TEXT = {
  title: "Ein Teil von Unterricks ließ sich nicht laden",
  sie: "Vermutlich ist die Internetverbindung kurz unterbrochen. Prüfen Sie die Verbindung und laden Sie die Seite neu – Sie kommen danach an dieselbe Stelle zurück.",
  du: "Vermutlich ist die Internetverbindung kurz unterbrochen. Prüfe die Verbindung und lade die Seite neu – du kommst danach an dieselbe Stelle zurück.",
  button: "Neu laden",
};
// kurze Fassung als Fehlermeldung (wo eine Seite die Meldung selbst anzeigt, z. B. in einer Statuszeile)
export const LOAD_SHORT = { sie: "Ein Teil von Unterricks ließ sich nicht laden. Bitte laden Sie die Seite neu.", du: "Ein Teil von Unterricks ließ sich nicht laden. Bitte lade die Seite neu." };
export const WAIT_TEXT = "Einen Moment bitte …";
export const RELOADING_TEXT = "Die Seite wird neu geladen …";
export const TECH_PREFIX = "Technische Angabe: ";

/* Stand dieses Moduls aus seiner Adresse (/v/<Stand>/update.js) – null ohne Stand */
export function buildOf(url) {
  const m = /\/v\/([a-f0-9]{12})\/[^/?#]+(?:[?#].*)?$/.exec(String(url || ""));
  return m ? m[1] : null;
}
export const BUILD = buildOf(import.meta.url);
/* Lehrkraft, Eltern und Beamer werden gesiezt, Schüler:innen geduzt (= boot.js) */
export const audienceOf = (hash) => (/^#\/(lk|lehrkraft|eltern|beamer)(\/|$)/.test(String(hash || "")) ? "sie" : "du");

/* Ein- und Ausgänge, die Unit-Tests ersetzen */
export const io = {
  fetch: (u, o) => fetch(u, o),
  now: () => Date.now(),
  reload: () => location.reload(),
  storage: () => { try { return sessionStorage; } catch { return null; } },
  hash: () => (typeof location !== "undefined" ? location.hash : ""),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  beforeUnload: () => new Event("beforeunload", { cancelable: true }),
};
// build: Stand dieser Seite; latest: zuletzt vom Server gemeldeter Stand; at: Zeitpunkt der letzten Prüfung (der Start zählt als Prüfung – index.html
// kam gerade vom Server; kurz danach fragt installUpdateChecks im Hintergrund nach)
export const versionState = { build: BUILD, latest: BUILD, at: BUILD ? Date.now() : 0, pending: null };
export const isOutdated = () => !!(versionState.build && versionState.latest && versionState.latest !== versionState.build);

/* ---------- Stand erfragen ---------- */
export async function fetchBuild(fetchFn, now, timeoutMs = NAV_TIMEOUT_MS) {   // wie boot.js
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetchFn("/version.json?t=" + now, { cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined });
    if (!r || !r.ok) return null;
    const d = await r.json();
    return d && typeof d.build === "string" && BUILD_RE.test(d.build) ? d.build : null;
  } catch { return null; } finally { if (t) clearTimeout(t); }
}
/* Prüft (höchstens eine Anfrage gleichzeitig); maxAge: eine so junge Prüfung genügt. Ergebnis: gemeldeter Stand oder null */
export function checkVersion({ maxAge = 0, timeout = NAV_TIMEOUT_MS } = {}) {
  if (!versionState.build) return Promise.resolve(null);
  if (versionState.pending) return versionState.pending;
  if (versionState.at && io.now() - versionState.at < maxAge) return Promise.resolve(versionState.latest);
  const q = fetchBuild(io.fetch, io.now(), timeout).then((b) => { if (b) versionState.latest = b; versionState.at = io.now(); return b; })
    .finally(() => { if (versionState.pending === q) versionState.pending = null; });
  versionState.pending = q;
  return q;
}
/* Muss ein Seitenwechsel erst prüfen? (sonst geht er sofort weiter – wie vor S24) */
export const navCheckDue = () => !!versionState.build && (isOutdated() || !!versionState.pending || !versionState.at || io.now() - versionState.at >= NAV_FRESH_MS);

/* ---------- Schutz vor einer Schleife: höchstens einmal je Ziel-Stand von selbst neu laden (= boot.js) ---------- */
export function mayAutoReload(to, storage = io.storage()) {
  if (!storage || !BUILD_RE.test(String(to || ""))) return false;
  let raw;
  try { raw = storage.getItem(RELOAD_KEY); } catch { return false; }
  let r = null;
  try { r = JSON.parse(raw); } catch {}
  return !(r && r.to === to);
}
export function noteAutoReload(to, storage = io.storage()) {
  try { storage.setItem(RELOAD_KEY, JSON.stringify({ to, at: io.now() })); return (JSON.parse(storage.getItem(RELOAD_KEY)) || {}).to === to; } catch { return false; }
}

/* ---------- Ist der Moment sicher? ---------- */
const holds = new Set();
/* Eine Seite meldet, dass gerade nicht neu geladen werden darf (fn() → true), z. B. solange eine Präsentation läuft; Rückgabe: abmelden */
export function holdReload(fn) { holds.add(fn); return () => { holds.delete(fn); }; }
/* Die eigenen Rückfragen der Seiten beim Verlassen (beforeunload: Schulportal-Eintrag, Verlaufsplan, Notizen, Zusammenfassung, Drucken, Escape-Room …) */
export function hasUnsaved(win = typeof window !== "undefined" ? window : null) {
  if (!win || typeof win.dispatchEvent !== "function") return false;
  try { const ev = io.beforeUnload(); win.dispatchEvent(ev); return ev.defaultPrevented; } catch { return true; }   // im Zweifel: nicht neu laden
}
/* Momentaufnahme: offene Ebenen, Vollbild, angemeldete Präsentation, laufende Arbeiten, (auf Wunsch) ungespeicherte Eingaben */
export function reloadSnapshot({ unsaved = false, doc = typeof document !== "undefined" ? document : null } = {}) {
  let held = false;
  for (const fn of holds) { try { if (fn()) held = true; } catch { held = true; } }
  return {
    layers: doc ? Math.max(openLayerCount(), doc.querySelectorAll('[aria-modal="true"]').length) : openLayerCount(),
    fullscreen: !!(doc && (doc.fullscreenElement || doc.webkitFullscreenElement)),
    held, working: workPending(), unsaved: unsaved ? hasUnsaved() : false,
  };
}
/* Was gegen ein Neuladen jetzt spricht (leer = sicher) */
export function blockersOf(s) {
  const r = [];
  if (s.layers > 0) r.push("dialog");
  if (s.fullscreen) r.push("fullscreen");
  if (s.held) r.push("presentation");
  if (s.working) r.push("working");
  if (s.unsaved) r.push("unsaved");
  return r;
}
/* laufende Arbeiten abwarten (höchstens ms); true = nichts läuft mehr */
export async function settle(ms = SETTLE_MS, step = 100) {
  const end = io.now() + ms;
  while (workPending() && io.now() < end) await io.sleep(step);
  return !workPending();
}

/* ---------- Seitenwechsel ---------- */
/* Was die bisherige Seite überdauert und gegen ein Neuladen spricht – vor dem Verlassen der Seite festgestellt (app.js, route): offene Dialoge und
   Ebenen (Präsentationsmodus), Vollbild, angemeldete Präsentation (Beamer, Live-Fenster). Laufende Arbeiten zählen hier nicht: Sie werden abgewartet. */
export const navBlockers = () => blockersOf(reloadSnapshot()).filter((b) => b !== "working");
let inflight = null;
/* Nach dem Verlassen der bisherigen Seite (app.js zeigt „Einen Moment bitte …“; die Seite speichert dabei wie bei jedem Seitenwechsel), bevor die
   neue geladen wird: true = die Seite lädt an der neuen Adresse neu (nichts weiter tun), false = wie gewohnt weiter. pre = navBlockers() von vorher. */
export function beforeRoute(pre = []) {
  if (!inflight) inflight = navUpdate(pre).then((r) => { if (!r) inflight = null; return r; }, () => { inflight = null; return false; });
  return inflight;
}
async function navUpdate(pre) {
  // ein Dialog, eine Präsentation …: diesmal nicht – der nächste Seitenwechsel versucht es wieder; bis dahin läuft der bisherige Stand weiter
  // (in sich stimmig). Ohne Warten weiter, nur im Hintergrund nachfragen.
  if (pre.length) { checkVersion({ maxAge: NAV_FRESH_MS }); return false; }
  await checkVersion({ maxAge: NAV_FRESH_MS });
  if (!isOutdated()) return false;
  const to = versionState.latest;
  if (!mayAutoReload(to)) return false;
  await settle();
  if (blockersOf(reloadSnapshot({ unsaved: true })).length || !noteAutoReload(to)) return false;
  io.reload();
  return true;
}

/* ---------- Gescheitertes Nachladen ---------- */
export class ModuleLoadError extends Error {
  constructor(cause) {
    super(LOAD_SHORT[audienceOf(io.hash())]);
    this.name = "ModuleLoadError"; this.moduleLoad = true; this.cause = cause;
  }
  report() { return reportModuleError(this); }
}
export const isModuleError = (e) => !!(e && e.moduleLoad === true);
/* Jedes Nachladen eines Programmteils: lazy(import("./x.js")). Scheitert es, wird daraus ModuleLoadError (Text ohne Technik) und – sofern nicht
   der Router die ganze Seite als Hinweis zeigt (pageFailed) – erscheint gleich danach der Dialog mit „Neu laden“, auch wo die Seite den Fehler
   nur in einer Statuszeile nennt oder still übergeht (der Programmteil fehlt bis zum Neuladen). */
export const lazy = (p) => Promise.resolve(p).catch((e) => {
  const err = isModuleError(e) ? e : new ModuleLoadError(e);
  setTimeout(() => { if (!err.reported) err.report(); }, 0);
  throw err;
});
/* Liegt es an einem neuen Stand? ("update") – sonst Netz o. Ä. ("error") */
export async function explain() {
  await checkVersion({ maxAge: 0, timeout: 3000 });
  return isOutdated() ? "update" : "error";
}
const techText = (e) => {
  const c = e && e.cause !== undefined ? e.cause : e;
  return String((c && c.message) || c || "").replace(/\s+/g, " ").trim().slice(0, 300);
};
const techLine = (e) => { const t = techText(e); return t ? h("p", { class: "small muted", text: TECH_PREFIX + t }) : null; };
let dialogUp = false;
/* Aktion auf der Seite (Knopf): ein ruhiger Dialog – nie von selbst neu laden (die Seite bleibt, wie sie ist) */
export async function reportModuleError(e) {
  if (!e || e.reported) return;
  e.reported = true;
  const kind = await explain();
  if (dialogUp) return;
  dialogUp = true;
  const aud = audienceOf(io.hash()), T = kind === "update" ? UPDATE_TEXT : LOAD_TEXT;
  modal({ title: T.title, onClose: () => { dialogUp = false; },
    body: (el) => el.append(...nn(h("p", { text: T[aud] }), kind === "update" ? null : techLine(e))),
    actions: [{ label: "Abbrechen" }, { label: T.button, class: "primary", onClick: () => { io.reload(); return false; } }] });
}
/* Seitenwechsel: Statt der Seite ein ruhiger Hinweis; liegt es an einem neuen Stand und ist der Moment sicher, einmal von selbst neu laden */
export async function pageFailed(e, show) {
  if (e) e.reported = true;   // die Seite selbst ist der Hinweis – kein Dialog dazu
  const hash = io.hash();
  const kind = await explain();
  if (io.hash() !== hash) return;   // inzwischen woanders
  const aud = audienceOf(hash), T = kind === "update" ? UPDATE_TEXT : LOAD_TEXT;
  const status = h("p", { class: "small muted", role: "status" });
  show(h("main", { class: "narrow loadfail" }, h("section", { class: "card" }, h("h1", { text: T.title }), h("p", { text: T[aud] }),
    h("p", null, h("button", { class: "btn primary", type: "button", onclick: () => io.reload() }, T.button)), status, kind === "update" ? null : techLine(e))));
  if (kind !== "update") return;
  const to = versionState.latest;
  if (!mayAutoReload(to)) return;
  await settle();
  if (io.hash() !== hash || blockersOf(reloadSnapshot({ unsaved: true })).length || !noteAutoReload(to)) return;
  status.textContent = RELOADING_TEXT;
  io.reload();
}
/* Stellvertreter während der Prüfung beim Seitenwechsel (app.js): die bisherige Seite verschwindet sofort wie bei jedem Seitenwechsel; der Text erscheint
   erst, wenn es länger dauert (styles.css), und wird nicht vorgelesen (die neue Seite kommt gleich) */
export const waitPage = () => h("main", { class: "narrow navwait" }, h("p", { class: "muted", "aria-hidden": "true", text: WAIT_TEXT }));

let installed = false;
/* Einmal beim Start (app.js): meldet der Startdatei, dass die Oberfläche läuft (<html data-unterricks>); fragt kurz nach dem Start und beim
   Zurückkehren in den Tab im Hintergrund nach dem Stand; nicht abgefangene Ladefehler als Hinweis statt nur in der Konsole */
export function installUpdateChecks() {
  if (installed || typeof window === "undefined" || typeof document === "undefined") return;
  installed = true;
  document.documentElement.setAttribute("data-unterricks", versionState.build || "");
  if (versionState.build) setTimeout(() => checkVersion(), START_CHECK_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkVersion({ maxAge: VIS_FRESH_MS }); });
  window.addEventListener("unhandledrejection", (ev) => { if (isModuleError(ev.reason)) { ev.preventDefault(); ev.reason.report(); } });
}
