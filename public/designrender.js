// designrender.js – von Claude gestaltetes Material (HTML, Unterricks druckt es auf dem Server als PDF, worker/render.js): Stand je Datei und
// eine Warteschlange, die ausstehende Materialien nacheinander drucken lässt (Cloudflare druckt kostenlos höchstens 1 Auftrag je 10 s).
// Genutzt von der Sitzungsseite und – für Materialien, deren Sitzung gerade niemand geöffnet hat – von der Startseite der Lehrkraft.
import { tapi } from "./teacher.js";

/* Stand einer Datei mit f.design → {need (sollte gedruckt werden), ok (PDF vorhanden), error, text (für die Zeile)} */
export function designState(f) {
  const d = f && f.design;
  if (!d) return null;
  const has = f.status === "ready";
  if (d.error && d.outdated) return { need: false, ok: has, error: true, text: "Druck fehlgeschlagen: " + d.error + (has ? " – zu sehen ist noch die bisherige Fassung." : "") };
  if (!has) return { need: true, ok: false, text: "wird als PDF gedruckt …" };
  if (d.outdated) return { need: true, ok: true, text: "neue Gestaltung wird gedruckt – bis dahin gilt die bisherige PDF" };
  return { need: false, ok: true, text: "PDF, von Claude gestaltet" + (f.pages ? " · " + f.pages + (f.pages === 1 ? " Seite" : " Seiten") : "") };
}

/* Warteschlange: add(f) druckt f (einmal je Datei und Stand). Rückmeldungen: onDone(file) mit der neuen Zeile, onNote(id, text|null) für
   Zwischenstände, onFail(f, err, quota), onBusy(n) mit der Zahl offener Aufträge. Bei „ausgelastet“ (429) wartet sie die vom Server
   genannte Zeit; beim Tageskontingent hört sie auf. Ein Fehlschlag bleibt gemerkt (failed(f) → Meldung), bis again(f) es neu versucht –
   so zeigt eine neu aufgebaute Zeile weiter die Meldung und „Erneut drucken“ statt „wird gedruckt …“. stop() beim Verlassen der Seite. */
export function renderQueue({ onDone = () => {}, onNote = () => {}, onFail = () => {}, onBusy = () => {} } = {}) {
  const queue = [], seen = new Set(), errors = new Map();
  let running = false, stopped = false, quota = null, current = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const keyOf = (f) => f.id + ":" + ((f.design && f.design.htmlAt) || 0);
  const busy = () => onBusy(queue.length + (current ? 1 : 0));
  async function run() {
    if (running) return;
    running = true;
    try {
      while (queue.length && !stopped) {
        const f = queue.shift(); current = f; busy();
        for (let tries = 1; !stopped; tries++) {
          onNote(f.id, "wird als PDF gedruckt …");
          try {
            const r = await tapi("POST", "/api/teacher/files/" + f.id + "/render", { body: {} });
            onNote(f.id, null); errors.delete(f.id);
            if (!stopped) onDone(r.file);
            break;
          } catch (e) {
            const code = e && e.data && e.data.code;
            if (code === "render_busy" && tries < 8) {
              const wait = Math.min(60, Math.max(5, Number(e.data.retryAfter) || 12));
              for (let s = wait; s > 0 && !stopped; s--) { onNote(f.id, "wartet auf den PDF-Drucker (noch " + s + " s) …"); await sleep(1000); }
              continue;
            }
            onNote(f.id, null);
            seen.delete(keyOf(f));
            if (stopped) break;
            if (code === "render_quota") {
              quota = e.message;
              for (const x of queue) seen.delete(keyOf(x));
              queue.length = 0; current = null; busy();
              onFail(f, e, true);
              return;
            }
            errors.set(f.id, (e && e.message) || "Der PDF-Druck ist fehlgeschlagen.");
            onFail(f, e, false);
            break;
          }
        }
        current = null; busy();
      }
    } finally { running = false; current = null; busy(); }
  }
  return {
    add(f) {
      if (stopped || quota || !f || !f.design || errors.has(f.id)) return;
      const key = keyOf(f);
      if (seen.has(key)) return;
      seen.add(key); queue.push(f); busy(); run();
    },
    again(f) { if (!f) return; seen.delete(keyOf(f)); errors.delete(f.id); quota = null; this.add(f); },
    failed: (f) => (f ? errors.get(f.id) || null : null),
    get quota() { return quota; },
    get pending() { return queue.length + (current ? 1 : 0); },
    stop() { stopped = true; queue.length = 0; busy(); },
  };
}

/* Eine Warteschlange für den ganzen Tab: Sie läuft weiter, wenn die Lehrkraft die Sitzungsseite verlässt (bis Abmelden oder Schließen;
   beim Schließen fragt der Browser nach, solange noch gedruckt wird). Seiten melden sich mit on({done, note, fail, busy}) an und ab. */
let G = null;
export function printQueue() {
  if (G) return G;
  const subs = new Set();
  const emit = (k, ...a) => { for (const s of subs) { try { if (s[k]) s[k](...a); } catch {} } };
  const warn = (e) => { e.preventDefault(); e.returnValue = ""; };
  let guarded = false;
  const guard = (n) => {
    if (typeof window === "undefined") return;
    if (n > 0 && !guarded) { window.addEventListener("beforeunload", warn); guarded = true; }
    else if (n === 0 && guarded) { window.removeEventListener("beforeunload", warn); guarded = false; }
  };
  const q = renderQueue({ onDone: (f) => emit("done", f), onNote: (id, t) => emit("note", id, t), onFail: (f, e, quota) => emit("fail", f, e, quota), onBusy: (n) => { guard(n); emit("busy", n); } });
  q.on = (handlers) => { subs.add(handlers); return () => subs.delete(handlers); };
  q.reset = () => { q.stop(); guard(0); subs.clear(); if (G === q) G = null; };
  G = q;
  return q;
}
export const resetPrintQueue = () => { if (G) G.reset(); };
