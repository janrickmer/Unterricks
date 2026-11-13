// livestate.js – der Zustand der Live-Präsentation als reine Funktionen (ohne Durable Object, deshalb auch in Unit-Tests prüfbar).
// Folie 0 = Codefolie vor Folie 1 (nur mit gültigem Sitzungscode), codeSlides = Platzhalterfolien der PDF, codeShown = „Sitzungscode zeigen“.
// timer (Nachtrag 16) = Timer der Lehrkraft für einen Arbeitsauftrag: null | {total, endsAt, paused: false} (läuft) | {total, left, paused: true}
// – alle Zeiten in ms, endsAt nach der Uhr des Servers.
import { cleanLine, isId } from "./lib.js";
import { isValidCode, cleanCodeSlides, nextSlideOf, TIMER_MAX_MIN, TIMER_TOTAL_MAX_MIN, TIMER_ADDS } from "../public/shared.js";

export const LIVE_IDLE = { active: false, fileId: null, pages: 0, slide: 1, startedAt: null, updatedAt: null, v: 0, code: null, title: "", codeSlides: [], codeShown: false, timer: null };

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
    Object.assign(st, { ...LIVE_IDLE, v: st.v });   // v bleibt monoton (die Schüler:innen-Seite überspringt bekannte Stände); der Timer endet mit
  } else if (m.t === "timer") {
    // v und updatedAt bleiben: v ist der Stand der Folie – die Seiten gleichen den Timer vor der Prüfung von v ab, das Folienbild lädt nicht neu
    return st.active ? timerReduce(st, m, now) : false;
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

/* Beamergerät (Nachtrag 15): die nächste Folie als Folienbild zum Vorladen – wie die Vorschau der Lehrkraft (nextSlideOf). null, wenn keine
   Folie mehr kommt oder die nächste eine Codefolie ist (kein Bild); bei „Sitzungscode zeigen“ die Folie darunter. */
export function liveNext(st) {
  if (!st || !st.active || !st.fileId || !Number.isInteger(st.slide) || !Number.isInteger(st.pages)) return null;
  const withCode = isValidCode(st.code);
  const x = nextSlideOf({ cur: st.slide, n: st.pages, peek: withCode && !!st.codeShown, holders: (st.codeSlides || []).map((c) => c.n), withCode });
  return x.end || x.code || !Number.isInteger(x.k) || x.k < 1 || x.k > st.pages ? null : x.k;
}

/* ---------- Timer (Nachtrag 16 der Lehrkraft vom 13.11.2026) ----------
   op "start" {min 1–120} startet neu (auch über einen laufenden), "pause"/"resume", "add" {min 1|5} verlängert (insgesamt höchstens 180 Minuten;
   nach Ablauf beginnt er mit dieser Zeit neu – „+1 Min“ heißt dann: noch eine Minute), "stop" schließt ihn. Folienwechsel, Codefolie und
   „Sitzungscode zeigen“ lassen ihn stehen, „Präsentation für alle beenden“ (stop) löscht ihn. Ungültig → false (keine Änderung). */
const MIN_MS = 60e3;
export const timerOf = (st) => {
  const t = st && st.timer;
  if (!t || typeof t !== "object" || !Number.isFinite(t.total) || t.total <= 0) return null;
  if (t.paused === true) return Number.isFinite(t.left) && t.left > 0 ? t : null;
  return Number.isFinite(t.endsAt) ? t : null;
};
export function timerReduce(st, m, now) {
  const cur = timerOf(st), left = cur ? (cur.paused ? cur.left : cur.endsAt - now) : 0;
  const min = m.min;
  if (m.op === "start") {
    if (!Number.isInteger(min) || min < 1 || min > TIMER_MAX_MIN) return false;
    st.timer = { total: min * MIN_MS, endsAt: now + min * MIN_MS, paused: false };
  } else if (m.op === "pause") {
    if (!cur || cur.paused || left <= 0) return false;
    st.timer = { total: cur.total, left, paused: true };
  } else if (m.op === "resume") {
    if (!cur || !cur.paused) return false;
    st.timer = { total: cur.total, endsAt: now + cur.left, paused: false };
  } else if (m.op === "add") {
    if (!cur || !TIMER_ADDS.includes(min)) return false;
    if (left <= 0) { st.timer = { total: min * MIN_MS, endsAt: now + min * MIN_MS, paused: false }; return true; }   // abgelaufen: neu
    const total = Math.min(TIMER_TOTAL_MAX_MIN * MIN_MS, cur.total + min * MIN_MS), d = total - cur.total;
    if (d <= 0) return false;
    st.timer = cur.paused ? { total, left: cur.left + d, paused: true } : { total, endsAt: cur.endsAt + d, paused: false };
  } else if (m.op === "stop") {
    if (!st.timer) return false;
    st.timer = null;
  } else return false;
  return true;
}
/* Was alle über den Timer bekommen: {left (ms zum Zeitpunkt now, ≥ 0), total, paused} oder null. Berechnet beim Senden mit der Uhr des Servers –
   die Seiten zählen ab dem Empfang selbst weiter (falsch gehende Uhren der Geräte zählen so nicht). */
export function liveTimer(st, now) {
  const t = st && st.active ? timerOf(st) : null;
  if (!t) return null;
  const left = t.paused ? t.left : t.endsAt - now;
  return { left: Math.max(0, Math.min(t.total, Math.round(left))), total: Math.round(t.total), paused: t.paused === true };
}
