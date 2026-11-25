// polls.js – anonyme Umfrage in der Live-Präsentation (Nachtrag 46, Wunsch der Lehrkraft vom 24.11.2026).
// Eine Umfragefolie stellt die Frage und die Antwortmöglichkeiten (genau eine wählbar). Abstimmen können die Schüler:innen nur live, solange die Präsentation
// genau diese Folie zeigt, und je Gerät nur einmal. Etwa 2 Minuten nach der ersten Antwort endet die Abstimmung (Antwort der Lehrkraft: so sieht niemand das
// Ergebnis vor der eigenen Stimme); ab dann steht das Ergebnis bei den Schüler:innen ganz unten unter „Abstimmungsergebnis“. Die Lehrkraft sieht live, wie
// viele abgestimmt haben, und die Verteilung; am Beamer steht nur die Zahl der Antworten, bis sie „Ergebnis am Beamer zeigen“ wählt.
// Erkannt wird eine Umfragefolie an einer unsichtbaren Zeile (wie „Unterricks-Video: …“), die Claude laut Präsentations-Prompt setzt:
//   Unterricks-Umfrage: Soll das Wahlalter auf 16 sinken? | Ja | Nein | Unentschieden
// Auf der Sitzungsseite prüft, ändert oder ergänzt die Lehrkraft die Umfragefolien (hand gilt vor der PDF; [] = bewusst keine).
// Anonym: Gezählt wird im Durable Object der Sitzung – je Umfrage die Zahl je Antwort und getrennt davon eine Liste von Prüfwerten der Geräte, die schon
// abgestimmt haben (HMAC aus Gerät und Umfrage; welche Antwort ein Gerät gewählt hat, wird nie gespeichert).
// Reine Funktionen (auch im Worker und in Unit-Tests) – die Anzeige steht in public/pollview.js und public/pollpanel.js.
import { cleanSlideLine } from "./shared.js";

export const POLL_MARK = "Unterricks-Umfrage";
export const POLL_LIMITS = { slides: 20, question: 240, option: 120, optionsMin: 2, optionsMax: 6, votes: 600, results: 40 };
export const POLL_RESULT_MS = 2 * 60e3;   // so lange nach der ersten Antwort läuft die Abstimmung; danach steht das Ergebnis bei den Schüler:innen
export const POLL_TITLE = "Abstimmungsergebnis";

const str = (v) => (typeof v === "string" ? v : "");
const lineText = (l) => (typeof l === "string" ? l : l && typeof l.text === "string" ? l.text : l && typeof l.str === "string" ? l.str : "");
const unquote = (s) => s.replace(/^[„“”"‚‘'«»\s]+|[„“”"‚‘'«»\s]+$/g, "");

/* ---------- eine Umfrage (geprüft) ---------- */
/* fremde Daten → {q, options: [2…6 verschiedene]} oder null. Frage und Antworten einzeilig; gleiche Antworten (ohne Groß-/Kleinschreibung) zählen einmal. */
export function cleanPollSpec(v) {
  if (!v || typeof v !== "object") return null;
  const q = cleanSlideLine(str(v.q), POLL_LIMITS.question);
  if (!q || !Array.isArray(v.options)) return null;
  const seen = new Set(), options = [];
  for (const o of v.options.slice(0, 40)) {
    const t = cleanSlideLine(str(o), POLL_LIMITS.option), k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k); options.push(t);
  }
  if (options.length < POLL_LIMITS.optionsMin || options.length > POLL_LIMITS.optionsMax) return null;
  return { q, options };
}
/* streng (Eingabe der Lehrkraft): nichts darf still wegfallen – gleiche bzw. leere Antworten, zu viele, zu lange Texte → null */
export function strictPollSpec(v) {
  const c = cleanPollSpec(v);
  if (!c || !v || !Array.isArray(v.options) || v.options.length !== c.options.length) return null;
  if (str(v.q).replace(/\s+/g, " ").trim() !== c.q || v.options.some((o, i) => str(o).replace(/\s+/g, " ").trim() !== c.options[i])) return null;
  return c;
}
/* die unsichtbare Zeile, wie sie laut Prompt auf der Folie steht */
export const pollMarkLine = (p) => POLL_MARK + ": " + p.q + " | " + p.options.join(" | ");

/* ---------- Erkennen auf der Folie (presenter.js, beim Hochladen) ---------- */
// Wort auch gesperrt gesetzt bzw. mit Gedankenstrich; Doppelpunkt freiwillig
const PMARK_RE = /u\s?n\s?t\s?e\s?r\s?r\s?i\s?c\s?k\s?s\s?[-‐‑–—]?\s?u\s?m\s?f\s?r\s?a\s?g\s?e\s*[:：]?/i;
const SEP_RE = /[|｜¦]/;
/* eine Zeile mit der Marke → {q, options} oder null (Marke ohne Frage bzw. mit weniger als zwei Antworten) */
export function parsePollMark(text) {
  const s = str(text), m = PMARK_RE.exec(s);
  if (!m) return null;
  const segs = s.slice(m.index + m[0].length).split(SEP_RE).map((x) => unquote(x.replace(/\s+/g, " ")));
  const q = segs.shift() || "";
  return cleanPollSpec({ q, options: segs.filter(Boolean) });
}
/* Umfragefolie aus den Zeilen einer Seite (Strings oder {text}) und ihren Textstücken (PDF.js). Kandidaten: jedes Textstück, jede Zeile und eine Zeile mit der
   Marke samt umbrochener Fortsetzung (die nächste Zeile beginnt mit „|“ oder die Zeile endet mit „|“) – es gilt der mit den meisten Antworten. Nur wenn
   keiner trägt: die Zeile mit den zwei folgenden. → {q, options} | null */
const SEP_END_RE = /[|｜¦]\s*$/, SEP_START_RE = /^[|｜¦]/;
export function pollMarkOf(lines, items = null) {
  const L = Array.isArray(lines) ? lines : [], texts = L.map(lineText);
  const cands = [...(Array.isArray(items) ? items : []).map(lineText), ...texts];
  texts.forEach((t, i) => {
    if (!PMARK_RE.test(t)) return;
    let s = t;
    for (let k = i + 1; k < Math.min(texts.length, i + 6); k++) {
      const next = texts[k].trim();
      if (/unterricks\s?[-‐‑–—]/i.test(next)) break;   // eine andere unsichtbare Zeile (z. B. „Unterricks-Phase: 3“) gehört nie zu den Antworten
      if (SEP_END_RE.test(s) || SEP_START_RE.test(next)) s += " " + next; else break;
    }
    if (s !== t) cands.push(s);
  });
  let v = null;
  for (const s of cands) { const x = parsePollMark(s); if (x && (!v || x.options.length > v.options.length)) v = x; }
  if (!v) for (let i = 0; i < texts.length && !v; i++) if (PMARK_RE.test(texts[i])) v = parsePollMark(texts.slice(i, i + 3).join(" "));
  return v;
}

/* ---------- Umfragefolien einer Präsentation ---------- */
/* fremde Daten (Browser → Server) → [{n (1…pages, eindeutig), q, options}] nach n sortiert; strict: ein ungültiger Eintrag → undefined */
export function cleanPollSlides(raw, pages, strict = false) {
  if (!Array.isArray(raw) || !Number.isInteger(pages) || pages < 1) return strict && raw !== undefined && raw !== null ? undefined : [];
  if (strict && raw.length > POLL_LIMITS.slides) return undefined;
  const seen = new Set(), out = [];
  for (const x of raw.slice(0, 300)) {
    const n = x && typeof x === "object" ? x.n : NaN, v = strict ? strictPollSpec(x) : cleanPollSpec(x);
    if (!Number.isInteger(n) || n < 1 || n > pages || seen.has(n) || !v) { if (strict) return undefined; continue; }
    seen.add(n); out.push({ n, ...v });
    if (out.length >= POLL_LIMITS.slides) break;
  }
  return out.sort((a, b) => a.n - b.n);
}
/* gespeichert (files.poll_slides = {v:1, pdf, hand}) tolerant gelesen: pdf = aus der PDF erkannt, hand = von der Lehrkraft festgelegt (gilt vor pdf; [] = bewusst keine) */
export function pollSlidesData(raw, pages) {
  let o = null;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch {}
  if (!o || typeof o !== "object") o = {};
  const pdf = cleanPollSlides(o.pdf, pages), hand = Array.isArray(o.hand) ? cleanPollSlides(o.hand, pages) : null;
  return { pdf: pdf.length ? pdf : null, hand };
}
export const pollSlidesStore = (o) => (o.pdf || o.hand ? JSON.stringify({ v: 1, pdf: o.pdf || null, hand: o.hand || null }) : null);
/* geltende Umfragefolien (p.polls = {pdf, hand} aus fileOut bzw. …/slides) */
export const pollSlidesOf = (p) => (p && p.polls ? (Array.isArray(p.polls.hand) ? p.polls.hand : p.polls.pdf || []) : []);
export const pollSlideAt = (list, n) => (Array.isArray(list) ? list.find((x) => x.n === n) || null : null);

/* ---------- Zählung (Durable Object, worker/live.js) ----------
   Kennung einer Umfrage: Präsentation (Datei) und Folie – eine neu hochgeladene Präsentation beginnt neu. Eintrag im Objekt:
   {k, n, q, options, counts, total, firstAt, saved, lid}; die Prüfwerte der Geräte stehen getrennt daneben (nie bei den Antworten). */
export const pollKey = (fileId, n) => String(fileId) + ":" + n;
export const POLL_KEY_RE = /^[a-f0-9]{16}:\d{1,3}$/;
export const pollFileOf = (k) => String(k).split(":")[0];
/* beendet: 2 Minuten nach der ersten Antwort (unabhängig davon, ob die Folie noch offen ist) */
export const pollClosesAt = (p) => (p && Number.isFinite(p.firstAt) && p.firstAt > 0 ? p.firstAt + POLL_RESULT_MS : null);
export const pollClosed = (p, now) => { const at = pollClosesAt(p); return at !== null && now >= at; };
export const newPoll = (k, spec, lid) => ({ k, n: spec.n, q: spec.q, options: spec.options.slice(), counts: spec.options.map(() => 0), total: 0, firstAt: 0, saved: false, lid: lid || null });
/* gespeicherten Eintrag tolerant lesen (ältere bzw. beschädigte Stände) → Eintrag oder null */
export function cleanPollEntry(p) {
  if (!p || typeof p !== "object" || !POLL_KEY_RE.test(str(p.k))) return null;
  const spec = cleanPollSpec(p);
  if (!spec) return null;
  const counts = spec.options.map((_, i) => (Array.isArray(p.counts) && Number.isInteger(p.counts[i]) && p.counts[i] > 0 ? p.counts[i] : 0));
  return { k: p.k, n: Number.isInteger(p.n) ? p.n : Number(p.k.split(":")[1]) || 0, ...spec, counts, total: counts.reduce((a, b) => a + b, 0),
    firstAt: Number.isFinite(p.firstAt) && p.firstAt > 0 ? p.firstAt : 0, saved: p.saved === true, lid: typeof p.lid === "string" ? p.lid : null };
}
/* Eine Stimme prüfen und zählen (verändert p und voters). → {ok:true} | {error: "choice" | "closed" | "voted" | "full"} */
export function pollVote(p, voters, voter, choice, now) {
  if (!Number.isInteger(choice) || choice < 0 || choice >= p.options.length) return { error: "choice" };
  if (pollClosed(p, now)) return { error: "closed" };
  if (voters.includes(voter)) return { error: "voted" };
  if (voters.length >= POLL_LIMITS.votes) return { error: "full" };
  voters.push(voter);
  p.counts[choice] += 1; p.total += 1;
  if (!p.firstAt) p.firstAt = now;
  return { ok: true };
}
/* Was eine Rolle über die Umfrage der aktuellen Folie bekommt (spec = {k, n, q, options} der Folie, p = Eintrag oder null, shown = „Ergebnis am Beamer zeigen“):
   Schüler:innen nie Zahlen; Beamer die Zahl der Antworten und die Verteilung nur bei shown; Lehrkraft alles samt Restzeit (ms, Uhr des Servers).
   r = Zeitpunkt, zu dem die Lehrkraft diese Umfrage zuletzt neu geöffnet hat („Ergebnis löschen und Umfrage neu öffnen“; 0 = nie): Die Seite der
   Schüler:innen merkt sich „schon abgestimmt“ je Umfrage und r – nach dem Löschen darf jedes Gerät wieder einmal. */
export function pollMessage(role, spec, p, shown, now, r = 0) {
  const src = p || spec, closed = pollClosed(p, now);
  const out = { k: spec.k, n: spec.n, q: src.q, options: src.options.slice(), open: !closed, ...(r > 0 ? { r } : {}) };
  if (role === "student") return out;
  out.total = p ? p.total : 0; out.shown = !!shown;
  if (role === "teacher" || shown) out.counts = p ? p.counts.slice() : src.options.map(() => 0);
  if (role === "teacher") { const at = pollClosesAt(p); out.left = at === null ? null : Math.max(0, at - now); }
  return out;
}
/* fremde Nachricht (Browser) → geprüfter Stand oder null */
export function cleanPollState(m) {
  if (!m || typeof m !== "object" || !POLL_KEY_RE.test(str(m.k))) return null;
  const spec = cleanPollSpec(m);
  if (!spec) return null;
  const out = { k: m.k, n: Number.isInteger(m.n) ? m.n : 0, ...spec, open: m.open === true, r: Number.isFinite(m.r) && m.r > 0 ? m.r : 0 };
  if (Number.isInteger(m.total) && m.total >= 0) out.total = m.total;
  if (m.shown !== undefined) out.shown = m.shown === true;
  if (Array.isArray(m.counts) && m.counts.length === spec.options.length && m.counts.every((x) => Number.isInteger(x) && x >= 0)) out.counts = m.counts.slice();
  if (m.left === null || (Number.isFinite(m.left) && m.left >= 0)) out.left = m.left;
  return out;
}

/* ---------- Ergebnis (D1, lessons.polls = {v:1, list}) ---------- */
/* ein beendetes Ergebnis, wie es in D1 steht und die Schüler:innen es bekommen: {k, n, q, options, counts, total, at} */
export const pollResultOf = (p, now) => ({ k: p.k, n: p.n, q: p.q, options: p.options.slice(), counts: p.counts.slice(), total: p.total, at: pollClosesAt(p) || now });
export function pollResultsData(raw) {
  let o = null;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch {}
  const list = o && typeof o === "object" && Array.isArray(o.list) ? o.list : [];
  const out = [], seen = new Set();
  for (const x of list.slice(0, 200)) {
    const e = cleanPollEntry(x);
    if (!e || seen.has(e.k)) continue;
    seen.add(e.k);
    out.push({ k: e.k, n: e.n, q: e.q, options: e.options, counts: e.counts, total: e.total, at: Number.isFinite(x.at) && x.at > 0 ? x.at : 0 });
  }
  return out;
}
/* Ergebnis eintragen bzw. ersetzen (dieselbe Kennung); die ältesten fallen bei mehr als POLL_LIMITS.results weg. → JSON-Text für lessons.polls */
export function pollResultsPut(raw, result) {
  const list = pollResultsData(raw).filter((x) => x.k !== result.k);
  list.push(result);
  list.sort((a, b) => a.at - b.at || a.n - b.n);
  return JSON.stringify({ v: 1, list: list.slice(-POLL_LIMITS.results) });
}
/* Ergebnisse entfernen: eine Kennung bzw. alle einer Präsentation (fileId). → JSON-Text oder null (keine mehr) */
export function pollResultsDrop(raw, { k = null, fileId = null } = {}) {
  const list = pollResultsData(raw).filter((x) => !(k !== null && x.k === k) && !(fileId !== null && pollFileOf(x.k) === fileId));
  return list.length ? JSON.stringify({ v: 1, list }) : null;
}
/* für die Schüler:innen: ohne Kennung der Datei – nur Frage, Antworten, Zahlen; sortiert nach dem Ende der Abstimmung */
export const pollResultsForStudents = (raw) => pollResultsData(raw).map((x) => ({ id: x.n + "-" + x.at, q: x.q, options: x.options, counts: x.counts, total: x.total }));

/* ---------- Texte und Zahlen ---------- */
export const votesText = (n) => (n === 1 ? "1 Antwort" : n + " Antworten");
/* ganze Prozent je Antwort, zusammen genau 100 (größte Reste zuerst); ohne Stimmen überall 0 */
export function pollPercents(counts) {
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return counts.map(() => 0);
  const raw = counts.map((c) => (c * 100) / total), out = raw.map(Math.floor);
  let rest = 100 - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let j = 0; rest > 0 && j < order.length; j++, rest--) out[order[j][1]] += 1;
  return out;
}
export const fmtLeft = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
export const POLL_STUDENT = {
  title: "Umfrage",
  hint: "Die Umfrage ist anonym: Gespeichert wird nur, wie oft jede Antwort gewählt wurde – nicht, wer was gewählt hat. Von jedem Gerät zählt eine Stimme.",
  go: "Abstimmen",
  pick: "Bitte wähle zuerst eine Antwort aus.",
  done: "Danke – deine Stimme ist gezählt. Das Ergebnis erscheint etwa 2 Minuten nach der ersten Antwort ganz unten unter „" + POLL_TITLE + "“.",
  closed: "Die Abstimmung ist beendet. Das Ergebnis steht ganz unten unter „" + POLL_TITLE + "“.",
  badge: "Umfrage – stimme unter der Präsentation ab",
};
export const POLL_ERRORS = {
  not_open: "Die Abstimmung ist gerade nicht geöffnet – abstimmen kannst du nur, solange deine Lehrkraft die Folie mit der Umfrage zeigt.",
  closed: "Die Abstimmung ist schon beendet.",
  voted: "Von diesem Gerät wurde schon abgestimmt – jede Stimme zählt nur einmal.",
  choice: "Bitte wähle eine der Antworten aus.",
  full: "Für diese Umfrage sind schon sehr viele Stimmen gezählt – mehr nimmt Unterricks nicht an.",
};

/* ---------- Präsentations-Prompt (claudePresentationPrompt, ctx.pollSection) ----------
   Nur für Klassen mit iPads (nicht Jg. 5/6). Die Lehrkraft legt die Umfrage fest (im Stundenverlauf oder im Chat) – Claude erfindet keine. */
export function pollPromptSection({ analog = false } = {}) {
  if (analog) return "";
  const ex = { q: "Soll das Wahlalter bei Bundestagswahlen auf 16 Jahre sinken?", options: ["Ja", "Nein", "Ich bin unentschieden"] };
  return [
    "## Umfragefolien: anonyme Umfrage während der Präsentation",
    "Unterricks kann an der Stelle einer Folie eine anonyme Umfrage durchführen: Die Schüler:innen stimmen auf ihren Geräten ab, solange genau diese Folie live gezeigt wird (je Gerät einmal, genau eine Antwort). " +
      "Etwa 2 Minuten nach der ersten Antwort endet die Abstimmung, und die Schüler:innen sehen das Ergebnis in Unterricks unter „" + POLL_TITLE + "“; ich sehe live, wie viele abgestimmt haben, und kann das Ergebnis am Beamer zeigen.",
    "Eine Umfragefolie legst du nur an, wenn ich sie festlege – im verbindlichen Stundenverlauf unten (z. B. „Umfrage: …“ oder „Abstimmung: …“) oder hier im Chat. Erfinde keine eigene Umfrage. " +
      "Nenne ich nur die Frage, schlage mir die Antwortmöglichkeiten im Chat vor und warte auf meine Zustimmung, bevor du die Folie baust. Wünsche ich keine Umfrage, entfällt dieser Abschnitt.",
    "So ist eine Umfragefolie aufgebaut – nur so erkennt Unterricks sie:",
    "- oben groß die Frage, genau so, wie ich sie festgelegt habe;",
    "- darunter die Antwortmöglichkeiten gut lesbar untereinander (" + POLL_LIMITS.optionsMin + " bis " + POLL_LIMITS.optionsMax + " verschiedene, kurz; genau eine ist wählbar – also keine Antworten, die sich überschneiden);",
    "- eine kurze Aufforderung an die Schüler:innen, z. B. „Stimme jetzt in Unterricks ab – unter der Präsentation.“; sonst nichts weiter (kein QR-Code, kein Sitzungscode, kein Ergebnis und keine Auswertung);",
    "- genau eine unsichtbare Zeile als echter Text in einer einzigen Zeile (wie die Zeile „Unterricks-Phase: …“: am besten Textdarstellungsmodus 3, sonst höchstens 2 pt in der Farbe des Hintergrunds, nie über anderem Inhalt) " +
      "mit der Frage und allen Antworten in derselben Reihenfolge und demselben Wortlaut wie auf der Folie, durch senkrechte Striche getrennt, z. B.: " + pollMarkLine(ex),
    "- Frage höchstens " + POLL_LIMITS.question + " Zeichen, jede Antwort höchstens " + POLL_LIMITS.option + " Zeichen; in Frage und Antworten kommt kein senkrechter Strich vor.",
    "Die Umfragefolie ist eine gewöhnliche Folie (keine Unterricks-Codefolie) und bekommt wie jede Folie die Zeile mit ihrer Phase und Notizen für die Lehrkraft – die Anweisung dort nennt, " +
      "dass die Abstimmung etwa 2 Minuten nach der ersten Antwort endet und was danach mit dem Ergebnis geschieht (z. B. „Lehrkraft: Lässt abstimmen, zeigt dann das Ergebnis am Beamer und fragt nach Gründen.“). " +
      "Soll das Ergebnis besprochen werden, folgt darauf eine eigene Folie mit dem Gesprächsimpuls – ohne Zahlen, die kennt vorher niemand.",
  ].join("\n");
}
