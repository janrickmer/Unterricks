// livestate.js – der Zustand der Live-Präsentation als reine Funktionen (ohne Durable Object, deshalb auch in Unit-Tests prüfbar).
// Folie 0 = Codefolie vor Folie 1 (nur mit gültigem Sitzungscode), codeSlides = Platzhalterfolien der PDF, codeShown = „Sitzungscode zeigen“.
import { cleanLine, isId } from "./lib.js";
import { isValidCode, cleanCodeSlides } from "../public/shared.js";

export const LIVE_IDLE = { active: false, fileId: null, pages: 0, slide: 1, startedAt: null, updatedAt: null, v: 0, code: null, title: "", codeSlides: [], codeShown: false };

/* Nachricht der Lehrkraft auf den Zustand anwenden (verändert st). true = geändert (v zählt hoch, alle bekommen den neuen Stand). */
export function liveReduce(st, m, now) {
  if (!m || typeof m !== "object") return false;
  if (m.t === "start" && typeof m.fileId === "string" && isId(m.fileId) && Number.isInteger(m.pages) && m.pages >= 1 && m.pages <= 300) {
    const code = isValidCode(m.code) ? m.code : null, min = code ? 0 : 1;   // Folie 0 (Codefolie) nur mit Code
    // resume: Läuft diese Präsentation schon, geht es an der laufenden Stelle weiter (die Seite der Lehrkraft kennt sie nicht immer)
    const same = m.resume === true && st.active && st.fileId === m.fileId && st.pages === m.pages && st.code === code;
    const slide = same ? Math.min(Math.max(min, st.slide), m.pages) : Number.isInteger(m.slide) ? Math.min(Math.max(min, m.slide), m.pages) : min;
    const codeShown = !!code && slide >= 1 && (same ? !!st.codeShown : m.codeShown === true);
    Object.assign(st, { active: true, fileId: m.fileId, pages: m.pages, slide, startedAt: same ? st.startedAt : now, code, title: cleanLine(m.title, 200),
      codeSlides: code ? cleanCodeSlides(m.codeSlides, m.pages) : [], codeShown });
  } else if (m.t === "goto" && st.active && Number.isInteger(m.slide)) {
    st.slide = Math.min(Math.max(st.code ? 0 : 1, m.slide), st.pages);
    st.codeShown = false;
  } else if (m.t === "code" && st.active && st.code) {   // „Sitzungscode zeigen“ über der aktuellen Folie
    const on = m.on === true && st.slide >= 1;
    if (on === !!st.codeShown) return false;
    st.codeShown = on;
  } else if (m.t === "stop") {
    Object.assign(st, { ...LIVE_IDLE, v: st.v });   // v bleibt monoton (die Schüler:innen-Seite überspringt bekannte Stände)
  } else return false;
  st.v = (st.v || 0) + 1; st.updatedAt = now;
  return true;
}

/* Was alle sehen: {slide (für das Folienbild, null = keins), code (Codefolie {code, title, lines, codeShown} oder null)}.
   Folie 0 hat kein Folienbild; an Platzhalterfolien bleibt es als Rückfall für ältere, gecachte Seiten. */
export function liveView(st) {
  const slide = st.active && st.fileId && st.slide >= 1 ? st.slide : null;
  const cs = st.active && isValidCode(st.code) ? (st.slide === 0 || st.codeShown ? { lines: [] } : (st.codeSlides || []).find((x) => x.n === st.slide)) : null;
  return { slide, code: cs ? { code: st.code, title: st.title || "", lines: cs.lines || [], codeShown: !!st.codeShown } : null };
}
