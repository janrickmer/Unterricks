// livestate.js – der Zustand der Live-Präsentation als reine Funktionen (ohne Durable Object, deshalb auch in Unit-Tests prüfbar).
// Folie 0 = Codefolie vor Folie 1 (nur mit gültigem Sitzungscode), codeSlides = Platzhalterfolien der PDF, codeShown = „Sitzungscode zeigen“.
// timer (Nachtrag 16) = Timer der Lehrkraft für einen Arbeitsauftrag: null | {total, endsAt, paused: false} (läuft) | {total, left, paused: true}
// – alle Zeiten in ms, endsAt nach der Uhr des Servers.
// video (Nachtrag 38) = Video einer Videofolie, das gerade an einem Beamergerät läuft: null | {n, id, start?, end?, title?, playing, pos, at, rev} (siehe videoReduce);
// vrev zählt die Befehle (bleibt auch über „stop“ monoton).
import { cleanLine, isId } from "./lib.js";
import { isValidCode, cleanCodeSlides, nextSlideOf, TIMER_MAX_MIN, TIMER_TOTAL_MAX_MIN, TIMER_ADDS } from "../public/shared.js";
import { cleanVideoSpec, clampPos } from "../public/videoslides.js";

export const LIVE_IDLE = { active: false, fileId: null, pages: 0, slide: 1, startedAt: null, updatedAt: null, v: 0, code: null, title: "", codeSlides: [], codeShown: false, timer: null, video: null, vrev: 0 };

/* Nachricht der Lehrkraft auf den Zustand anwenden (verändert st). true = geändert (v zählt hoch, alle bekommen den neuen Stand). */
export function liveReduce(st, m, now) {
  if (!m || typeof m !== "object") return false;
  if (m.t === "start" && typeof m.fileId === "string" && isId(m.fileId) && Number.isInteger(m.pages) && m.pages >= 1 && m.pages <= 300) {
    const code = isValidCode(m.code) ? m.code : null, min = code ? 0 : 1;   // Folie 0 (Codefolie) nur mit Code
    // resume: Läuft diese Präsentation schon, geht es an der laufenden Stelle weiter (die Seite der Lehrkraft kennt sie nicht immer)
    const same = m.resume === true && st.active && st.fileId === m.fileId && st.pages === m.pages && st.code === code;
    const slide = same ? Math.min(Math.max(min, st.slide), m.pages) : Number.isInteger(m.slide) ? Math.min(Math.max(min, m.slide), m.pages) : min;
    const codeShown = !!code && slide >= 1 && (same ? !!st.codeShown : m.codeShown === true);
    // Video (Nachtrag 38): dieselbe Präsentation auf derselben Folie behält es – auch ohne resume (so meldet sich die Seite der Lehrkraft nach jeder
    // Wiederverbindung): sonst endete das Video am Beamer bei jedem kurzen WLAN-Aussetzer der Lehrkraft
    const samePres = st.active && st.fileId === m.fileId && st.pages === m.pages && st.code === code;
    Object.assign(st, { active: true, fileId: m.fileId, pages: m.pages, slide, startedAt: same ? st.startedAt : now, code, title: cleanLine(m.title, 200),
      codeSlides: code ? cleanCodeSlides(m.codeSlides, m.pages) : [], codeShown, video: samePres && st.video && st.video.n === slide && !codeShown ? st.video : null });
  } else if (m.t === "goto" && st.active && Number.isInteger(m.slide)) {
    st.slide = Math.min(Math.max(st.code ? 0 : 1, m.slide), st.pages);
    st.codeShown = false; st.video = null;   // eine andere Folie: das Video endet
  } else if (m.t === "code" && st.active && st.code) {   // „Sitzungscode zeigen“ über der aktuellen Folie
    const on = m.on === true && st.slide >= 1;
    if (on === !!st.codeShown) return false;
    st.codeShown = on;
    if (on) st.video = null;
  } else if (m.t === "stop") {
    Object.assign(st, { ...LIVE_IDLE, v: st.v, vrev: st.vrev || 0 });   // v (und vrev) bleiben monoton (die Schüler:innen-Seite überspringt bekannte Stände); der Timer endet mit
  } else if (m.t === "timer") {
    // v und updatedAt bleiben: v ist der Stand der Folie – die Seiten gleichen den Timer vor der Prüfung von v ab, das Folienbild lädt nicht neu
    return st.active ? timerReduce(st, m, now) : false;
  } else if (m.t === "video") {
    return videoReduce(st, m, now);   // wie der Timer: v bleibt (das Folienbild ändert sich nicht)
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

/* ---------- Videofolien (Nachtrag 38 der Lehrkraft vom 17.11.2026) ----------
   Die Präsentation der Lehrkraft entscheidet, wo ein Video spielt; nur wenn es an einem Beamergerät läuft, geht es über den Server. m = {t:"video", op, n, …}:
   "set" {video: {id, start?, end?, title?}, playing, pos (Sekunden im Video), rev} = der ganze gewünschte Stand (abspielen, pausieren, springen; rev zählt die
   Präsentation – jeder Befehl wird am Beamer genau einmal ausgeführt; fehlt er, zählt der Server weiter), "close" (zurück zur Folie). Nur auf der aktuellen
   Folie (n = slide, keine Codefolie); ein Folienwechsel, die Codefolie und „stop“ beenden das Video. Ungültig → false. */
const posAt = (cur, now) => (cur.playing ? cur.pos + Math.max(0, now - cur.at) / 1000 : cur.pos);
export function videoReduce(st, m, now) {
  const cur = st.video && typeof st.video === "object" && Number.isInteger(st.video.n) ? st.video : null;
  if (m.op === "close") { if (!cur) return false; st.video = null; return true; }
  if (m.op !== "set" || !st.active || !Number.isInteger(m.n) || m.n < 1 || m.n !== st.slide || liveView(st).code) return false;
  const v = cleanVideoSpec(m.video);
  if (!v || typeof m.playing !== "boolean") return false;
  const rev = Number.isInteger(m.rev) && m.rev > 0 && m.rev < 1e9 ? m.rev : (st.vrev || 0) + 1;
  st.vrev = Math.max(st.vrev || 0, rev);
  st.video = { n: m.n, ...v, playing: m.playing, pos: clampPos(v, Number.isFinite(m.pos) ? m.pos : v.start || 0), at: now, rev };
  return true;
}
/* Was Lehrkraft und Beamer über das Video bekommen (Schüler:innen nie): Stelle zum Zeitpunkt now nach der Uhr des Servers – die Geräte rechnen ab dem Empfang weiter */
export function liveVideo(st, now) {
  const v = st && st.active && st.video && typeof st.video === "object" ? st.video : null;
  if (!v || v.n !== st.slide) return null;
  const spec = cleanVideoSpec(v);
  if (!spec) return null;
  return { n: v.n, ...spec, playing: v.playing === true, pos: Math.round(clampPos(spec, posAt(v, now)) * 10) / 10, rev: Number.isInteger(v.rev) ? v.rev : 0 };
}
