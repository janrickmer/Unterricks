// inclasslib.js – „Ich bin jetzt im Unterricht“ (Nachtrag 35 der Lehrkraft vom 16.11.2026): reine Funktionen der kompakten Sitzungsansicht (ohne DOM, ohne
// Server) – die Phase der aktuellen Live-Folie (grüner Pfeil im Verlaufsplan), der Hinweis, warum gerade kein Pfeil zu sehen ist, und das Material in den zwei
// Spalten „Für Schüler:innen sichtbar“ / „Nur für die Lehrkraft“ (Gymnasium und Grundschule). Die Oberfläche steht in public/inclass.js.
import { portalPhases, slidePhasesOf } from "./shared.js";

export const INCLASS_LABEL = "Ich bin jetzt im Unterricht";
export const FULL_LABEL = "Vollständige Ansicht";
export const ARROW_NAME = "Aktuelle Phase laut Live-Präsentation";
export const PRINT_TAG = "zum Ausdrucken";
export const NOTFALL_TAG = "Notfall-Feibeitsblatt";
export const CARDS_TAG = "Bildkarten";
export const LIVE_POLL_MS = 3000;   // Rückfall ohne WebSocket: höchstens alle 3 Sekunden fragen

/* Phase einer Live-Folie: phases = Phase je Folie (Index 0 = Folie 1; Zahl oder null), slide = aktuelle Folie (0 = Codefolie vor Folie 1 → wie Folie 1).
   Eine Folie ohne Phase gehört zur Phase der nächsten Folie davor, die eine hat; gibt es keine → null. */
export function livePhase(phases, slide) {
  const P = Array.isArray(phases) ? phases : [];
  if (!Number.isInteger(slide) || slide < 0 || !P.length) return null;
  for (let k = Math.min(Math.max(slide, 1), P.length); k >= 1; k--) if (Number.isInteger(P[k - 1])) return P[k - 1];
  return null;
}

/* Wohin zeigt der grüne Pfeil? live = Stand der Live-Präsentation (Nachricht des Servers für die Lehrkraft: active, slide, pages, fileId, view …),
   pres = die Präsentation der Sitzung (fileOut: id, phases), portalText = Schulportal-Eintrag (Phasen „**3) Partnerarbeit**“).
   → {head: {n, line, title, label}, phase, slide, code} | {why: "nopres" | "idle" | "other" | "nomarks" | "nophase" | "noheads" | "missing" | "twice", phase?, slide?} */
export function liveArrow({ live, pres, portalText }) {
  if (!pres || !pres.id) return { why: "nopres" };
  if (!live || !live.active || !Number.isInteger(live.slide)) return { why: "idle" };
  if (live.fileId && live.fileId !== pres.id) return { why: "other" };
  const phases = slidePhasesOf(pres);
  if (!phases) return { why: "nomarks" };
  const slide = live.slide, phase = livePhase(phases, slide);
  if (phase === null) return { why: "nophase", slide };
  const heads = portalPhases(portalText);
  if (!heads.length) return { why: "noheads", phase, slide };
  const hs = heads.filter((x) => x.n === phase);
  if (!hs.length) return { why: "missing", phase, slide };
  if (hs.length > 1) return { why: "twice", phase, slide };
  return { head: hs[0], phase, slide, code: slide === 0 || live.codeShown === true };
}

/* Satz unter der Überschrift „Verlaufsplan“: wo der Pfeil steht bzw. ruhig, warum es gerade keinen gibt (Sie-Form) */
export function arrowText(r) {
  if (r && r.head) return "Der grüne Pfeil am rechten Rand zeigt die Phase, in der Sie laut Live-Präsentation gerade sind: „" + r.head.label + "“ (" +
    (r.slide === 0 ? "Codefolie vor Folie 1" : r.code ? "Folie " + r.slide + ", Sitzungscode eingeblendet" : "Folie " + r.slide) + ").";
  const why = r ? r.why : "idle";
  return "Kein Pfeil: " + ({
    nopres: "Zu dieser Sitzung gibt es keine Präsentation.",
    idle: "Die Präsentation läuft gerade nicht live. Sobald sie läuft – auch auf einem anderen Gerät –, zeigt ein grüner Pfeil am rechten Rand die Phase, in der Sie gerade sind.",
    other: "Live läuft gerade eine andere Präsentation als die dieser Sitzung.",
    nomarks: "Die Folien dieser Präsentation tragen keine Phasen. In der vollständigen Ansicht können Sie sie unter „Phasen der Folien“ zuordnen.",
    nophase: "Folie " + (r && r.slide) + " gehört zu keiner Phase des Schulportal-Eintrags.",
    noheads: "Im Schulportal-Eintrag stehen keine nummerierten Phasen wie „**3) Partnerarbeit**“.",
    missing: "Die Phase " + (r && r.phase) + " der Präsentation steht nicht im Schulportal-Eintrag.",
    twice: "Die Phase " + (r && r.phase) + " steht im Schulportal-Eintrag mehrmals.",
  }[why] || "Die Präsentation läuft gerade nicht live.");
}

/* Live-Zustand kurz (Präsentation): „Folie 5 / 12“ bzw. „Sitzungscode“ */
export const liveSlideText = (live) => (live.view === "code" && (live.slide === 0 || live.codeShown) ? "Sitzungscode" : "Folie " + live.slide + " / " + live.pages);

/* Material in zwei Spalten (wie die vollständige Ansicht und mit denselben Sichtbarkeitsregeln):
   student = für Schüler:innen sichtbar – Feibeitsblätter (wie die Schüler:innen sie öffnen; nicht das Finale eines Escape-Rooms, das erreichen sie nur über
     den Tunnel), Material „Für Schüler:innen“ (Dateien, Links, Texte; Material einer Selbstlern-Phase nur, solange sie läuft), zuletzt die
     Notfall-Feibeitsblätter (wie bei den Schüler:innen in einem eigenen Kästchen am Ende);
   teacher = nur für die Lehrkraft – Material „Nur für Lehrkräfte“ (auch Notfall-Feibeitsblätter für Lehrkräfte), danach alles, was die Lehrkraft ausdruckt
     (Druckliste; Grundschule zusätzlich die Arbeitsblätter der Kinder mit „Auch ausdrucken“ und die Bildkarten) in der Reihenfolge der Druckliste.
   Nie: Archiv (ursprüngliche Planung einer Selbstlern-Phase), die Präsentation selbst und ihre Anmerkungs-PDF (beide stehen unter „Präsentation“).
   Grundschule: Bildkarten stehen nie im Materialkasten, hier aber bei der Lehrkraft – auf der Druckliste „zum Ausdrucken“.
   → {student: [{type: "sheet", sheet} | {type: "file", file, tags}], teacher: [{type: "file", file, print, tags}]} */
export function materialColumns(files, sheets, { gs = false, selbstlern = false } = {}) {
  const fs = (Array.isArray(files) ? files : []).filter((f) => f && typeof f.id === "string");
  const student = [], notfall = [], teacher = [], print = [];
  for (const s of Array.isArray(sheets) ? sheets : []) if (s && s.code && s.kind !== "escape") student.push({ type: "sheet", sheet: s });
  for (const f of fs) {
    if (f.area === "archive" || f.area === "presentation" || f.notesOf) continue;
    const cards = gs && f.cards != null && f.area === "teacher";
    if (f.area === "student") {
      if (f.source === "selbstlern" && !selbstlern) continue;   // Schüler:innen sehen es erst in der Selbstlern-Phase (worker/student.js)
      (f.source === "notfall" ? notfall : student).push({ type: "file", file: f, tags: f.source === "notfall" ? [NOTFALL_TAG] : [] });
    } else if (f.area === "teacher" && !(cards && f.print)) {
      teacher.push({ type: "file", file: f, print: false, tags: cards ? [CARDS_TAG] : f.source === "notfall" ? [NOTFALL_TAG] : [] });
    }
    // Druckliste (materialbox.js printFiles): „Von der Lehrkraft auszudrucken“, in der Grundschule auch Arbeitsblätter der Kinder mit „Auch ausdrucken“ und Bildkarten
    if (f.area === "print" || (gs && f.area === "student" && f.print && !(f.source === "selbstlern" && !selbstlern)) || (cards && f.print))
      print.push({ type: "file", file: f, print: true, tags: cards ? [CARDS_TAG, PRINT_TAG] : [PRINT_TAG] });
  }
  return { student: [...student, ...notfall], teacher: [...teacher, ...print] };
}

/* Schlüssel des Materials: ändert er sich, baut die kompakte Ansicht die Spalten neu (sonst bleibt alles stehen – auch der Fokus) */
export function materialKey(cols) {
  const one = (e) => (e.type === "sheet" ? "s:" + e.sheet.code + ":" + e.sheet.title
    : [e.file.id, e.file.status, e.file.name, e.file.area, e.file.kind, e.print ? "p" + (e.file.printName || "") : "", e.file.url || "",
      e.file.design ? [e.file.design.htmlAt, e.file.design.pdfAt, e.file.design.error || "", e.file.design.outdated ? 1 : 0].join("/") : ""].join(":"));
  return [...cols.student.map(one), "|", ...cols.teacher.map(one)].join("\n");
}

/* Gespeicherter Zustand je Tab (sessionStorage): nur die ID der Sitzung, deren kompakte Ansicht offen ist */
export const INCLASS_KEY = "u.inclass";
export function inClassStored(storage, id) {
  try { const v = storage && storage.getItem(INCLASS_KEY); return !!v && v === id; } catch { return false; }
}
export function setInClassStored(storage, id, on) {
  try { if (!storage) return; if (on) storage.setItem(INCLASS_KEY, id); else if (storage.getItem(INCLASS_KEY) === id) storage.removeItem(INCLASS_KEY); } catch {}
}
