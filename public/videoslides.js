// videoslides.js – Videofolien der Präsentation (Nachtrag 38, Wunsch der Lehrkraft vom 17.11.2026): An der Stelle einer Videofolie spielt Unterricks im
// Unterricht ein YouTube-Video eingebettet ab – am Beamer (Beamergerät bzw. Beamerfenster) oder, ohne getrennten Beamer, in der Präsentationsansicht selbst
// (iPad gespiegelt). Die Schüler:innen sehen live nur die Folie (Titel und Link stehen auf ihr); nach der Stunde steht im Folienfenster unter der Folie ein
// anklickbarer Link zu YouTube.
// Erkannt wird eine Videofolie an einer unsichtbaren Zeile (wie „Unterricks-Phase: n“, Nachtrag 34), die Claude laut Präsentations-Prompt setzt:
//   Unterricks-Video: https://www.youtube.com/watch?v=ID | Start: 1:30 | Ende: 4:05 | Titel: Das Bundesverfassungsgericht
// Start, Ende und Titel sind freiwillig. Gespeichert wird nie eine Adresse, nur Kennung, Start, Ende und Titel (Regeln wie public/selbstlern.js); alle
// Adressen baut Unterricks selbst aus der geprüften Kennung (youtube.com zum Öffnen, youtube-nocookie.com für den Player).
// Reine Funktionen (auch im Worker und in Unit-Tests) – das Abspielen selbst steht in public/ytplayer.js.
import { parseYouTube, YT_ID_RE, YT_START_MAX, fmtVideoStart } from "./selbstlern.js";
import { cleanSlideLine, stripPhaseMarks, portalPhases } from "./shared.js";

export const VIDEO_MARK = "Unterricks-Video";
export const VIDEO_LIMITS = { slides: 60, title: 160 };
export const VIDEO_WATCH = "https://www.youtube.com/watch?v=";
export const YT_PLAYER_ORIGIN = "https://www.youtube-nocookie.com";

const str = (v) => (typeof v === "string" ? v : "");
const lineText = (l) => (typeof l === "string" ? l : l && typeof l.text === "string" ? l.text : l && typeof l.str === "string" ? l.str : "");

/* Zeitangabe → Sekunden (0 ≤ s < 24 h) oder null: „1:30“, „01:02:03“, „90“, „90s“, „90 Sek.“, „1m30s“, „1h2m3s“, „1:30 min“ */
export function parseClock(raw) {
  let s = str(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return null;
  s = s.replace(/\s*(min(?:uten?)?|sek(?:unden)?|sec|uhr)\.?$/, "").trim();
  let m = /^(\d{1,2}):([0-5]?\d):([0-5]\d)$/.exec(s), sec = null;
  if (m) sec = +m[1] * 3600 + +m[2] * 60 + +m[3];
  else if ((m = /^(\d{1,4}):([0-5]\d)$/.exec(s))) sec = +m[1] * 60 + +m[2];
  else if ((m = /^(\d{1,5}) ?s?$/.exec(s))) sec = +m[1];
  else if ((m = /^(?:(\d{1,2})h)?(?:(\d{1,4})m)?(?:(\d{1,5})s)?$/.exec(s.replace(/ /g, ""))) && /\d/.test(s)) sec = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return Number.isInteger(sec) && sec >= 0 && sec < YT_START_MAX ? sec : null;
}
export const fmtClock = (sec) => fmtVideoStart(sec);

/* ---------- eine Videofolie (geprüft) ---------- */
/* fremde Daten → {id, start?, end?, title?} oder null; start 1…86399 (0 = von vorn, entfällt), end > start, title einzeilig ≤ 160 Zeichen */
export function cleanVideoSpec(v) {
  if (!v || typeof v !== "object" || typeof v.id !== "string" || !YT_ID_RE.test(v.id)) return null;
  const out = { id: v.id };
  const start = Number.isInteger(v.start) && v.start > 0 && v.start < YT_START_MAX ? v.start : 0;
  if (start) out.start = start;
  if (Number.isInteger(v.end) && v.end > start && v.end < YT_START_MAX) out.end = v.end;
  const title = cleanSlideLine(str(v.title), VIDEO_LIMITS.title);
  if (title) out.title = title;
  return out;
}
export const videoWatchUrl = (v) => VIDEO_WATCH + v.id + (v.start ? "&t=" + v.start + "s" : "");
/* Adresse des eingebetteten Players (nur dort, wo das Video abgespielt wird): Steuerung per postMessage (enablejsapi), Start und Ende als Ausschnitt */
export function videoPlayerUrl(v, origin) {
  const q = ["enablejsapi=1", "autoplay=1", "playsinline=1", "rel=0"];
  if (v.start) q.push("start=" + v.start);
  if (v.end) q.push("end=" + v.end);
  if (typeof origin === "string" && /^https?:\/\/[^/\s]+$/.test(origin)) q.push("origin=" + encodeURIComponent(origin));
  return YT_PLAYER_ORIGIN + "/embed/" + v.id + "?" + q.join("&");
}
// „Ausschnitt 1:30–4:05“, „ab 1:30“, „bis 4:05“ bzw. ""
export const videoClipText = (v) => (v.start && v.end ? "Ausschnitt " + fmtClock(v.start) + "–" + fmtClock(v.end) : v.start ? "ab " + fmtClock(v.start) : v.end ? "bis " + fmtClock(v.end) : "");
export const videoName = (v, n) => (v && v.title ? v.title : "Video" + (n ? " auf Folie " + n : ""));
/* die unsichtbare Zeile, wie sie laut Prompt auf der Folie steht */
export const videoMarkLine = (v) => VIDEO_MARK + ": " + VIDEO_WATCH + v.id + (v.start ? " | Start: " + fmtClock(v.start) : "") + (v.end ? " | Ende: " + fmtClock(v.end) : "") + (v.title ? " | Titel: " + v.title : "");

/* ---------- Erkennen auf der Folie (presenter.js, beim Hochladen) ---------- */
// Wort auch gesperrt gesetzt bzw. mit Gedankenstrich; Doppelpunkt freiwillig
const VMARK_RE = /u\s?n\s?t\s?e\s?r\s?r\s?i\s?c\s?k\s?s\s?[-‐‑–—]?\s?v\s?i\s?d\s?e\s?o\s*[:：]?/i;
const KEY_RE = /^(start|beginn|ab|ende|end|bis|titel|title)\b\s*[:=：]?\s*(.*)$/i;
/* eine Zeile mit der Marke → {id, start?, end?, title?} oder null (Marke ohne gültigen Link) */
export function parseVideoMark(text) {
  const s = str(text), m = VMARK_RE.exec(s);
  if (!m) return null;
  const segs = s.slice(m.index + m[0].length).split(/[|｜¦]/);
  const head = segs.shift().trim();
  let link = null;
  for (const tok of head.split(/\s+/)) { const r = parseYouTube(tok.replace(/[)\].,;]+$/, "")); if (r.id) { link = r; break; } }
  if (!link) { const r = parseYouTube(head.replace(/\s+/g, "")); if (r.id) link = r; }   // von PDF.js mit Leerzeichen zerlegt
  if (!link) return null;
  const v = { id: link.id, start: link.start || 0 };
  for (const seg of segs) {
    const k = KEY_RE.exec(seg.trim());
    if (!k) continue;
    const key = k[1].toLowerCase(), val = k[2].trim();
    if (key === "titel" || key === "title") { if (!v.title) v.title = val.replace(/^[„“”"‚‘'«»]+|[„“”"‚‘'«»]+$/g, ""); }
    else { const t = parseClock(val); if (t === null) continue; if (key === "ende" || key === "end" || key === "bis") v.end = t; else v.start = t; }
  }
  return cleanVideoSpec(v);
}
const isMarkOrLink = (t) => VMARK_RE.test(t) || /https?:\/\/|www\.|youtu\.?be/i.test(t);
/* sichtbare Überschrift der Folie (größte Schrift, umbrochen zusammengefügt), ohne die unsichtbaren Zeilen und ohne Links; „Video:“ davor entfällt */
export function slideTitleOf(lines) {
  const all = (Array.isArray(lines) ? lines : []).map((l) => ({ text: cleanSlideLine(stripPhaseMarks(lineText(l)), 300), h: Number(l && l.h) || 0, base: Number(l && l.base) || 0 }))
    .filter((l) => l.text && !isMarkOrLink(l.text) && (l.text.match(/\p{L}/gu) || []).length >= 2);
  if (!all.length) return "";
  const maxH = Math.max(...all.map((l) => l.h));
  const big = all.filter((l) => !(maxH > 0) || l.h >= maxH * 0.85).sort((a, b) => a.base - b.base);
  let t = big[0].text;
  for (let i = 1; i < big.length; i++) { const p = big[i - 1], l = big[i]; if (l.base - p.base > 0 && l.base - p.base <= 1.6 * Math.max(p.h, l.h, 1) && !/[.!?:]$/.test(t)) t += " " + l.text; else break; }
  t = t.replace(/^\s*(?:video|film|clip)\s*[:–—-]\s*/i, "").replace(/^[„“”"‚‘'«»]+|[„“”"‚‘'«»]+$/g, "");
  return cleanSlideLine(t, VIDEO_LIMITS.title);
}
/* Videofolie aus den Zeilen einer Seite (Strings oder {text, h, base}) und ihren Textstücken (PDF.js): Textstücke und Zeilen für sich, dann eine Zeile
   mit der Marke zusammen mit den zwei folgenden (umbrochen). Ohne Titel in der Marke gilt die Überschrift der Folie. → {id, start?, end?, title?} | null */
export function videoMarkOf(lines, items = null) {
  const L = Array.isArray(lines) ? lines : [], texts = L.map(lineText);
  let v = null;
  for (const list of [(Array.isArray(items) ? items : []).map(lineText), texts]) { for (const s of list) if ((v = parseVideoMark(s))) break; if (v) break; }
  if (!v) for (let i = 0; i < texts.length && !v; i++) if (VMARK_RE.test(texts[i])) v = parseVideoMark(texts.slice(i, i + 3).join(" "));
  if (!v) return null;
  if (!v.title) { const t = slideTitleOf(L); if (t) v.title = t; }
  return v;
}

/* ---------- Videofolien einer Präsentation ---------- */
/* fremde Daten (Browser → Server) → [{n (1…pages, eindeutig), id, start?, end?, title?}] nach n sortiert; strict: ein ungültiger Eintrag → undefined */
export function cleanVideoSlides(raw, pages, strict = false) {
  if (!Array.isArray(raw) || !Number.isInteger(pages) || pages < 1) return strict && raw !== undefined && raw !== null ? undefined : [];
  if (strict && raw.length > VIDEO_LIMITS.slides) return undefined;
  const seen = new Set(), out = [];
  for (const x of raw.slice(0, 300)) {
    const n = x && typeof x === "object" ? x.n : NaN, v = cleanVideoSpec(x);
    // streng: auch Start und Ende müssen gelten, wie angegeben (sonst fiele z. B. ein Ende vor dem Start still weg)
    const lost = !!v && ((x.start !== undefined && x.start !== null && x.start !== 0 && v.start !== x.start) || (x.end !== undefined && x.end !== null && v.end !== x.end));
    if (!Number.isInteger(n) || n < 1 || n > pages || seen.has(n) || !v || (strict && lost)) { if (strict) return undefined; continue; }
    seen.add(n); out.push({ n, ...v });
    if (out.length >= VIDEO_LIMITS.slides) break;
  }
  return out.sort((a, b) => a.n - b.n);
}
/* gespeichert (files.video_slides = {v:1, pdf, hand}) tolerant gelesen: pdf = aus der PDF erkannt, hand = von der Lehrkraft festgelegt (gilt vor pdf;
   [] = bewusst keine) */
export function videoSlidesData(raw, pages) {
  let o = null;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch {}
  if (!o || typeof o !== "object") o = {};
  const pdf = cleanVideoSlides(o.pdf, pages), hand = Array.isArray(o.hand) ? cleanVideoSlides(o.hand, pages) : null;
  return { pdf: pdf.length ? pdf : null, hand };
}
export const videoSlidesStore = (o) => (o.pdf || o.hand ? JSON.stringify({ v: 1, pdf: o.pdf || null, hand: o.hand || null }) : null);
/* geltende Videofolien (p.videos = {pdf, hand} aus fileOut bzw. …/slides) */
export const videoSlidesOf = (p) => (p && p.videos ? (Array.isArray(p.videos.hand) ? p.videos.hand : p.videos.pdf || []) : []);
export const videoAt = (list, n) => (Array.isArray(list) ? list.find((x) => x.n === n) || null : null);

/* ---------- Abspielen: gemeinsamer Stand (Lehrkraft → Beamer) ----------
   {n (Folie), id, start?, end?, title?, playing, pos (Sekunden im Video zum Zeitpunkt at), rev} – rev zählt jeden Befehl, damit ein Beamer ihn genau
   einmal ausführt (z. B. zweimal „+10 s“). at ist die Uhr des Empfängers (performance.now bzw. Date.now). */
export function cleanVideoState(raw) {
  if (!raw || typeof raw !== "object") return null;
  const v = cleanVideoSpec(raw);
  if (!v || !Number.isInteger(raw.n) || raw.n < 1 || raw.n > 300 || !Number.isInteger(raw.rev) || raw.rev < 0) return null;
  const pos = Number(raw.pos);
  return { n: raw.n, ...v, playing: raw.playing === true, pos: Number.isFinite(pos) ? clampPos(v, pos) : v.start || 0, rev: raw.rev };
}
export const clampPos = (v, pos) => Math.min(Math.max(Number(pos) || 0, 0), v && v.end ? v.end : YT_START_MAX);
export const videoPosNow = (vs, now) => (!vs ? 0 : clampPos(vs, vs.playing ? vs.pos + Math.max(0, now - vs.at) / 1000 : vs.pos));
export const videoKey = (vs) => (vs ? vs.n + "|" + vs.id + "|" + vs.rev : "");

/* ---------- YouTube-Player über postMessage (wie die IFrame-API von YouTube, ohne ihr Skript: CSP) ----------
   Die Seite meldet sich mit „listening“, der Player antwortet (initialDelivery, onReady, infoDelivery {playerState, currentTime, duration}, onStateChange,
   onError) als JSON-Text; Befehle gehen als {event:"command", func, args}. playerState: -1 nicht gestartet, 0 zu Ende, 1 spielt, 2 pausiert, 3 lädt, 5 bereit. */
export const YT_STATE = { unstarted: -1, ended: 0, playing: 1, paused: 2, buffering: 3, cued: 5 };
export const ytListen = () => JSON.stringify({ event: "listening", id: 1, channel: "widget" });
export const ytCommand = (func, args = []) => JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" });
export function ytRead(data) {
  let m = data;
  if (typeof m === "string") { if (m.length > 200000) return null; try { m = JSON.parse(m); } catch { return null; } }
  return m && typeof m === "object" && typeof m.event === "string" ? { event: m.event, info: m.info } : null;
}
/* Nachricht des Players auf seinen Stand anwenden (verändert s = {ready, state, time, dur, err}); true = geändert */
export function ytApply(s, m) {
  if (!m) return false;
  const before = JSON.stringify(s), i = m.info;
  if (m.event === "onReady" || m.event === "initialDelivery") s.ready = true;
  if ((m.event === "infoDelivery" || m.event === "initialDelivery") && i && typeof i === "object") {
    if (Number.isInteger(i.playerState) && i.playerState >= -1 && i.playerState <= 5) s.state = i.playerState;
    if (Number.isFinite(i.currentTime) && i.currentTime >= 0) s.time = i.currentTime;
    if (Number.isFinite(i.duration) && i.duration > 0) s.dur = i.duration;
  }
  if (m.event === "onStateChange" && Number.isInteger(i) && i >= -1 && i <= 5) s.state = i;
  if (m.event === "onError" && Number.isInteger(i)) s.err = i;
  return JSON.stringify(s) !== before;
}
/* Meldung zu einem Fehler des Players (Lehrkraft) */
export function ytErrorText(code) {
  if (code === 101 || code === 150 || code === 153) return code === 153 ? "YouTube hat die Einbettung abgelehnt (fehlende Herkunftsangabe)." : "Dieses Video darf laut YouTube nicht eingebettet werden – öffnen Sie es auf YouTube.";
  if (code === 100) return "Dieses Video gibt es auf YouTube nicht (mehr), oder es ist privat.";
  if (code === 2) return "Der Link zu diesem Video ist ungültig.";
  if (code === 5) return "Dieses Video lässt sich in diesem Browser nicht abspielen.";
  return "Das Video lässt sich gerade nicht abspielen (Fehler " + code + ").";
}
/* Rückmeldung eines Beamers (fremde Daten) → {n, id, rev, state, time, dur, blocked, err, noapi, muted} oder null */
export function cleanVideoReport(m) {
  if (!m || typeof m !== "object" || !Number.isInteger(m.n) || m.n < 1 || m.n > 300 || typeof m.id !== "string" || !YT_ID_RE.test(m.id) || !Number.isInteger(m.rev) || m.rev < 0) return null;
  const num = (x, max) => (Number.isFinite(x) && x >= 0 && x <= max ? Math.round(x * 10) / 10 : null);
  return { n: m.n, id: m.id, rev: m.rev, state: Number.isInteger(m.state) && m.state >= -1 && m.state <= 5 ? m.state : -1, time: num(m.time, YT_START_MAX), dur: num(m.dur, 10 * YT_START_MAX),
    blocked: m.blocked === true, err: Number.isInteger(m.err) && m.err > 0 && m.err < 1000 ? m.err : null, noapi: m.noapi === true, muted: m.muted === true };
}

/* ---------- Präsentations-Prompt: Videos aus dem Schulportal-Eintrag (mit Phase) und den Links der Sitzung ---------- */
const URL_RE = /(?:https?:\/\/|\/\/|\bwww\.|\byoutu\.be\/|\byoutube(?:-nocookie)?\.com\/)[^\s<>"'„“”«»)\]]+/gi;
const CLIP_RE = /(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:–|—|-|bis)\s*(\d{1,2}:\d{2}(?::\d{2})?)/;
const plainPortal = (t) => t.replace(/\*\*|~~|__|`/g, "").replace(/\s+/g, " ").trim();
const dropVideoWord = (t) => t.replace(/^\s*-\s*/, "").replace(/^\s*(?:video|film|clip)\s*[:–—-]?\s*/i, "").replace(/[:–—-]\s*$/, "").trim();
/* portalText = Schulportal-Eintrag (Stundenverlauf), materials = Material der Sitzung ({kind, name, text}) →
   [{id, start?, end?, title, phase (Nummer oder null), phaseLabel, source: "portal"|"link"}] – jedes Video einmal (Kennung + Start) */
export function lessonVideos(portalText, materials) {
  const out = [], seen = new Set();
  const add = (v) => { const k = v.id + "|" + (v.start || 0); if (!seen.has(k)) { seen.add(k); out.push(v); } };
  const lines = str(portalText).replace(/\r\n?/g, "\n").split("\n"), heads = portalPhases(portalText);
  let head = null;
  lines.forEach((line, i) => {
    const hd = heads.find((x) => x.line === i);
    if (hd) head = hd;
    for (const m of line.matchAll(URL_RE)) {
      const r = parseYouTube(m[0].replace(/[.,;:!?]+$/, ""));
      if (!r.id) continue;
      const clip = CLIP_RE.exec(line);
      const start = clip ? parseClock(clip[1]) : r.start || 0, end = clip ? parseClock(clip[2]) : null;
      const kursiv = /~~([^~]{3,})~~/.exec(line);
      const rest = dropVideoWord(plainPortal(line.replace(URL_RE, " ").replace(CLIP_RE, " ").replace(/\(\s*(?:Ausschnitt|ab|bis)?\s*\)/gi, " ")));
      const title = kursiv ? kursiv[1].trim() : (rest.match(/\p{L}/gu) || []).length >= 3 && !hd ? rest : head ? dropVideoWord(head.title) : "";
      const spec = cleanVideoSpec({ id: r.id, start: start || 0, end: end || undefined, title });
      if (spec) add({ ...spec, title: spec.title || "", phase: head ? head.n : null, phaseLabel: head ? head.label.replace(/\s+/g, " ") : "", source: "portal" });
    }
  });
  for (const f of Array.isArray(materials) ? materials : []) {
    if (!f || f.kind !== "link") continue;
    const r = parseYouTube(str(f.text).trim());
    if (!r.id) continue;
    const spec = cleanVideoSpec({ id: r.id, start: r.start || 0, title: str(f.name) });
    if (spec) add({ ...spec, title: spec.title || "", phase: null, phaseLabel: "", source: "link" });
  }
  return out;
}
/* Abschnitt „Videofolien“ des Präsentations-Prompts (claudePresentationPrompt, ctx.videoSection): wo jedes Video vorkommt, sein Link und genau der Aufbau der
   Folie samt der unsichtbaren Zeile, an der Unterricks sie erkennt. list = lessonVideos(…); ohne Videos kein Abschnitt (""). analog = Jg. 5/6 (keine iPads). */
export function videoPromptSection(list, { analog = false } = {}) {
  const vids = Array.isArray(list) ? list.filter((v) => v && YT_ID_RE.test(v.id)) : [];
  if (!vids.length) return "";
  const where = (v) => (v.phase ? "in Phase " + v.phase + (v.phaseLabel ? " („" + v.phaseLabel + "“)" : "") + " – als Folie an der Stelle, an der es laut Stundenverlauf gezeigt wird (nach einem Beobachtungsauftrag, falls es einen gibt)"
    : "ohne festen Platz im Stundenverlauf (Link der Sitzung" + (v.title ? " „" + v.title + "“" : "") + ") – nur, wenn die Planung es vorsieht, an der Stelle, an der es gezeigt wird; sonst lässt du es weg");
  const items = vids.map((v, i) => {
    const spec = { id: v.id, ...(v.start ? { start: v.start } : {}), ...(v.end ? { end: v.end } : {}), title: v.title || "" };
    return "- Video " + (i + 1) + " – " + where(v) + ": " + (v.title ? "„" + v.title + "“, " : "") + VIDEO_WATCH + v.id + (videoClipText(v) ? ", " + videoClipText(v) : ", ganzes Video") + "\n" +
      "  unsichtbare Zeile auf dieser Folie: " + videoMarkLine(spec.title ? spec : { ...spec, title: "<Titel des Videos>" });
  });
  return [
    "## Videofolien: YouTube-Videos eingebettet abspielen",
    "Im Stundenverlauf bzw. bei den Links der Sitzung stehen diese YouTube-Videos. Unterricks spielt jedes im Unterricht an der Stelle seiner Videofolie eingebettet am Beamer ab – gesteuert von der Lehrkraft" +
      (analog ? "." : "; auf den Geräten der Schüler:innen erscheint dabei nur die Folie selbst.") + " Nach der Stunde sehen die Schüler:innen die Folie in Unterricks mit einem Link zum Video. " +
      "Lege für jedes Video genau eine Videofolie an, an genau dieser Stelle:",
    ...items,
    "So ist eine Videofolie aufgebaut – nur so erkennt Unterricks sie:",
    "- oben groß „Video: <Titel des Videos>“ (der Titel wie oben; fehlt er, ein kurzer, sachlicher Titel aus dem Stundenverlauf – keinen erfundenen Inhalt);",
    "- darunter die Adresse des Videos als echter Text, genau wie oben (https://www.youtube.com/watch?v=…), zusätzlich als anklickbarer Link (Link-Anmerkung auf dieselbe Adresse) – damit öffnen die Schüler:innen das Video nach der Stunde;",
    "- bei einem Ausschnitt darunter „Ausschnitt: 1:30–4:05“ (mit den Zeiten des Videos);",
    "- nennt die Planung einen Beobachtungsauftrag, ihn in höchstens zwei kurzen Zeilen – sonst nichts weiter;",
    "- als Bild nur ein schlichtes, selbst gezeichnetes Abspielsymbol (z. B. ein Dreieck in einem Kreis) – kein Vorschaubild, kein Screenshot und kein Logo von YouTube, kein QR-Code;",
    "- genau eine unsichtbare Zeile als echter Text in einer einzigen Zeile, unverändert wie oben angegeben (wie die Zeile „" + "Unterricks-Phase" + ": …“: am besten Textdarstellungsmodus 3, sonst höchstens 2 pt in der Farbe des Hintergrunds, nie über anderem Inhalt) – " +
      "mit „|“ getrennt: der Link, „Start: m:ss“ und „Ende: m:ss“ nur bei einem Ausschnitt, „Titel: …“;",
    "- dazu wie auf jeder Folie die unsichtbare Zeile „Unterricks-Phase: n“.",
    "Nennt die Planung (siehe „Didaktische und methodische Überlegungen“) für ein Video einen Ausschnitt, der oben fehlt, übernimm ihn mit „Start: m:ss“ und „Ende: m:ss“ in die unsichtbare Zeile und auf die Folie; sonst lass beides weg (ganzes Video). " +
      "Eine Videofolie ist keine Unterricks-Codefolie und keine Materialfolie; bespricht die Klasse das Video danach, folgt eine eigene Folie (z. B. mit den Fragen). Weitere Videos als die oben genannten bettest du nicht ein – erfinde keine Videos und keine Links.",
  ].join("\n");
}
