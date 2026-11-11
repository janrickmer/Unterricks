// designrender.js – von Claude gestaltetes Material (HTML, Unterricks druckt es auf dem Server als PDF, worker/render.js): Stand je Datei und
// eine Warteschlange, die ausstehende Materialien nacheinander drucken lässt (Cloudflare druckt kostenlos höchstens 1 Auftrag je 10 s).
import { tapi } from "./teacher.js";

/* Stand einer Datei mit f.design → {need (sollte gedruckt werden), text (für die Zeile), ok (PDF vorhanden)} */
export function designState(f) {
  const d = f && f.design;
  if (!d) return null;
  const has = f.status === "ready";
  if (d.error && d.outdated) return { need: false, ok: has, error: true, text: "Druck fehlgeschlagen: " + d.error + (has ? " – zu sehen ist noch die bisherige Fassung." : "") };
  if (!has) return { need: true, ok: false, text: "wird als PDF gedruckt …" };
  if (d.outdated) return { need: true, ok: true, text: "neue Gestaltung wird gedruckt – bis dahin gilt die bisherige PDF" };
  return { need: false, ok: true, text: "PDF, von Claude gestaltet" + (f.pages ? " · " + f.pages + (f.pages === 1 ? " Seite" : " Seiten") : "") };
}

/* Warteschlange: add(f) druckt f (einmal je Datei und Stand), onDone(file) mit der neuen Zeile, onNote(id, text|null) für Zwischenstände.
   Bei „ausgelastet“ (429) wartet sie die vom Server genannte Zeit, beim Tageskontingent hört sie auf. stop() beim Verlassen der Seite. */
export function renderQueue({ onDone = () => {}, onNote = () => {}, onFail = () => {} } = {}) {
  const queue = [], seen = new Set();
  let running = false, stopped = false, quota = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function run() {
    if (running) return;
    running = true;
    try {
      while (queue.length && !stopped) {
        const f = queue.shift();
        for (let tries = 1; !stopped; tries++) {
          onNote(f.id, "wird als PDF gedruckt …");
          try {
            const r = await tapi("POST", "/api/teacher/files/" + f.id + "/render", { body: {} });
            onNote(f.id, null);
            onDone(r.file);
            break;
          } catch (e) {
            const code = e && e.data && e.data.code;
            if (code === "render_busy" && tries < 8) {
              const wait = Math.min(60, Math.max(5, Number(e.data.retryAfter) || 12));
              for (let s = wait; s > 0 && !stopped; s--) { onNote(f.id, "wartet auf den PDF-Drucker (noch " + s + " s) …"); await sleep(1000); }
              continue;
            }
            onNote(f.id, null);
            if (code === "render_quota") { quota = e.message; onFail(f, e, true); queue.length = 0; return; }
            onFail(f, e, false);
            break;
          }
        }
      }
    } finally { running = false; }
  }
  return {
    add(f) {
      if (stopped || quota || !f || !f.design) return;
      const key = f.id + ":" + (f.design.htmlAt || 0);
      if (seen.has(key)) return;
      seen.add(key); queue.push(f); run();
    },
    again(f) { if (!f) return; seen.delete(f.id + ":" + ((f.design && f.design.htmlAt) || 0)); quota = null; this.add(f); },
    get quota() { return quota; },
    stop() { stopped = true; queue.length = 0; },
  };
}
