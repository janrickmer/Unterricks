// inclasslib.js – „Ich bin jetzt im Unterricht“ (Nachtrag 35 der Lehrkraft vom 16.11.2026): reine Funktionen der kompakten Sitzungsansicht (ohne DOM, ohne
// Server) – die Phase der aktuellen Live-Folie (grüner Pfeil im Verlaufsplan), der Hinweis, warum gerade kein Pfeil zu sehen ist, und das Material in den zwei
// Spalten „Für Schüler:innen sichtbar“ / „Nur für die Lehrkraft“ (Gymnasium und Grundschule) und – seit Nachtrag 42 – der Verlaufsplan kompakt (Kurzplan für
// die Lehrkraft bzw. automatisch gekürzt, compactPlan). Die Oberfläche steht in public/inclass.js.
import { portalPhases, slidePhasesOf, parsePortalMarkup, parsePlanMarkup } from "./shared.js";
import { teacherPlanFits, phaseList, filledPhases, isNextLine, lineHasContent } from "./teacherplan.js";

export const INCLASS_LABEL = "Ich bin jetzt im Unterricht";
export const FULL_LABEL = "Vollständige Ansicht";
export const ARROW_NAME = "Aktuelle Phase laut Live-Präsentation";
export const PRINT_TAG = "zum Ausdrucken";
export const NOTFALL_TAG = "Notfall-Feibeitsblatt";
export const CARDS_TAG = "Bildkarten";
export const LIVE_POLL_MS = 3000;   // Rückfall ohne WebSocket: höchstens alle 3 Sekunden fragen
export const STAMP_POLL_MS = 20000;   // Stand der Sitzung (Änderungen von einem anderen Gerät): alle 20 Sekunden eine kleine Abfrage

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
   → {head: {n, line, title, label}, phase, slide, code} | {why: "nopres" | "notready" | "idle" | "other" | "nomarks" | "nophase" | "noheads" | "missing" | "twice", phase?, slide?} */
export function liveArrow({ live, pres, portalText }) {
  if (!pres || !pres.id) return { why: "nopres" };
  if (pres.status && pres.status !== "ready") return { why: "notready" };
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
    notready: "Die Folienbilder der Präsentation sind noch nicht fertig – laden Sie die PDF in der vollständigen Ansicht erneut hoch.",
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
/* refCards (Grundschule, Nachtrag 31b): wiederverwendete Bildkarten einer anderen Sitzung, die auf der Druckliste dieser Sitzung stehen (materialbox refEntries,
   ohne die hier abgewählten) – hinten an „zum Ausdrucken“ */
/* packs (Nachtrag 42): Sitzungspakete der Druckliste (materialbox packs() – shared.js printPacks) – wie in der Druckliste stehen sie vor den übrigen Dateien
   zum Ausdrucken: {type: "pack", pack, members: [Einträge der Druckliste in der Reihenfolge des Pakets, member: true]} (nur mit mindestens zwei Dateien) */
export function materialColumns(files, sheets, { gs = false, selbstlern = false, refCards = [], packs = [] } = {}) {
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
  if (gs) for (const f of Array.isArray(refCards) ? refCards : []) if (f && typeof f.id === "string" && !f.refOff) print.push({ type: "file", file: f, print: true, tags: [CARDS_TAG, PRINT_TAG] });
  const inPack = new Set(), packed = [];
  for (const p of Array.isArray(packs) ? packs : []) {
    if (!p || !Array.isArray(p.files)) continue;
    const members = p.files.map((f) => f && print.find((e) => e.file.id === f.id && !inPack.has(e.file.id))).filter(Boolean);
    if (members.length < 2) continue;
    for (const e of members) inPack.add(e.file.id);
    packed.push({ type: "pack", pack: p, members: members.map((e) => ({ ...e, member: true })) });
  }
  return { student: [...student, ...notfall], teacher: [...teacher, ...packed, ...print.filter((e) => !inPack.has(e.file.id))] };
}

/* Schlüssel des Materials: ändert er sich, baut die kompakte Ansicht die Spalten neu (sonst bleibt alles stehen – auch der Fokus) */
export function materialKey(cols) {
  const one = (e) => (e.type === "sheet" ? "s:" + e.sheet.code + ":" + e.sheet.title
    : e.type === "pack" ? "k:" + e.pack.name + "=" + (e.pack.planned || 0) + "[" + e.members.map(one).join(";") + "]"
    : [e.file.id, e.file.status, e.file.name, e.file.area, e.file.kind, e.print ? "p" + (e.file.printName || JSON.stringify(e.file.print || "")) : "", e.file.url || "",
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

/* ---------- Kurzplan für die Lehrkraft (Nachtrag 42, Teil 2): der Verlaufsplan kompakt ----------
 * Nur in dieser Ansicht: je Phase die fette Überschrift und darunter, was die Lehrkraft tut. Mit einem Kurzplan von Claude, der noch passt (gleicher Fingerabdruck
 * der Planung, alle seine Phasen im Plan – teacherPlanFits), stehen dort seine Anweisungen (Grundschule: dazu die gelben Verweise [[pdf:…]] ihrer unterstrichenen
 * Aufforderungen als Zeile „Material:“ – Claude schreibt schlichten Text); sonst (ältere Sitzungen, Planung danach geändert) kürzt Unterricks selbst: die
 * unterstrichenen Aufforderungen an die Lehrkraft (__…__, in der Grundschule samt ihren Verweisen) bzw. – hat eine Phase keine – ihr erster Stichpunkt gekürzt.
 * „--> Nächste Stunde“ und der Zwischenstopp bleiben an ihrer Stelle; Text vor der ersten Phase und zwischen „--> Nächste Stunde“ und der nächsten Phase entfällt
 * (er steht im vollständigen Verlaufsplan).
 * Jede Phase trägt die Zeile ihrer Überschrift (line = Index wie portalPhases/insertStop): Pfeil, Kontextmenü und Einfügen des Zwischenstopps arbeiten damit
 * wie in der vollständigen Vorschau.
 * Zwischenstopp mitten in einer Phase (Befund der Gegenprüfung – nie Offenes über dem Zwischenstopp zeigen): ihr Rest nach dem Zwischenstopp steht als eigener
 * Block „(Fortsetzung)“ unter dem Abdeckblatt (cont, line = seine erste Zeile mit Inhalt), immer automatisch gekürzt aus genau diesen Zeilen; der Block über dem
 * Zwischenstopp nimmt nur die Zeilen davor. Die Anweisungen von Claude gelten für die ganze Phase und lassen sich nicht teilen: sie bleiben über dem
 * Zwischenstopp, der Block bekommt partial (Hinweis COMPACT_PARTIAL).
 * text = Schulportal-Eintrag bzw. Verlaufsplan, gs = Grundschule (Verweise [[pdf:…]]), teacherPlan = {phases:[{n, steps}], plan, at} | null
 * → {mode: "claude" | "auto" | "full", why, autoPhases: [n], items}
 *   mode "full": keine nummerierten Phasen – die Ansicht zeigt den vollständigen Verlaufsplan wie bisher (items leer)
 *   why (bei "auto"): "none" (kein Kurzplan) | "changed" (Planung danach geändert) | "phases" (seine Phasen fehlen im Plan)
 *   autoPhases (bei "claude"): Phasen mit Inhalt (filledPhases), zu denen Claude nichts geschrieben hat – eine leere Phase („**1) TOP 10**“), eine Fortsetzung
 *     und eine zweite Phase mit derselben Nummer zählen nicht
 *   items: {type: "phase", n, line, head: runs, steps: [{runs, kind: "claude" | "teacher" | "gist"}], auto, cont?, partial?, refs?: runs}
 *     | {type: "stop", line} | {type: "next", line, runs} */
export const COMPACT_GIST_MAX = 110;   // so viele Zeichen höchstens vom ersten Stichpunkt einer Phase ohne Aufforderung an die Lehrkraft
export const COMPACT_CONT = "(Fortsetzung)";   // hinter der Überschrift des Rests einer Phase nach dem Zwischenstopp
export const COMPACT_PARTIAL = "Der Zwischenstopp liegt mitten in dieser Phase – ihren offenen Teil zeigt die Fortsetzung unter dem Zwischenstopp.";
export const COMPACT_REFS = "Material:";   // Grundschule, Kurzplan von Claude: die Verweise der Aufforderungen an die Lehrkraft
// eine Aufforderung an die Lehrkraft: alle Läufe mit Inhalt (Text oder Verweis) unterstrichen
const isTeacherLine = (ln) => { const rs = ln.runs.filter((r) => r.file !== undefined || r.text.trim()); return rs.length > 0 && rs.every((r) => r.u) && rs.some((r) => r.file !== undefined || r.text.trim()); };
// im Kurzplan steht sie ohne Unterstreichung (dort ist jede Zeile eine Aufforderung an die Lehrkraft)
const plainRuns = (runs) => runs.map((r) => { const { u, ...rest } = r; return rest; });
/* Läufe auf höchstens max Zeichen kürzen (an einer Wortgrenze, mit „…“); ein Link wird nie zerschnitten (dann entfällt er), ein Verweis zählt wie 20 Zeichen */
export function shortRuns(runs, max = COMPACT_GIST_MAX) {
  const out = [];
  let used = 0;
  for (const r of runs) {
    const len = r.file !== undefined ? 20 : r.text.length;
    if (used + len <= max) { out.push(r); used += len; continue; }
    if (r.file === undefined && r.href === undefined) {
      let cut = r.text.slice(0, Math.max(0, max - used));
      const sp = cut.lastIndexOf(" ");
      if (sp > cut.length * 0.5) cut = cut.slice(0, sp);
      cut = cut.replace(/[\s,;:–-]+$/, "");
      if (cut) out.push({ ...r, text: cut });
    }
    out.push({ text: " …" });
    return out;
  }
  return out;
}
// automatisch gekürzt: die Aufforderungen an die Lehrkraft, sonst der erste Stichpunkt
function autoSteps(ls) {
  const teacher = ls.filter(isTeacherLine);
  return teacher.length ? teacher.map((ln) => ({ runs: plainRuns(ln.runs), kind: "teacher" })) : ls.length ? [{ runs: shortRuns(ls[0].runs), kind: "gist" }] : [];
}
// die Verweise der Aufforderungen an die Lehrkraft (ohne Doppelte, ohne Formatierung)
function teacherRefs(ls) {
  const out = [], seen = new Set();
  for (const ln of ls.filter(isTeacherLine)) for (const r of ln.runs) if (r.file !== undefined && !seen.has(r.file)) { seen.add(r.file); out.push({ text: "", file: r.file }); }
  return out;
}
export function compactPlan(text, { gs = false, teacherPlan = null } = {}) {
  const heads = portalPhases(text);
  if (!heads.length) return { mode: "full", why: null, autoPhases: [], items: [] };
  const lines = (gs ? parsePlanMarkup : parsePortalMarkup)(text);
  const fit = teacherPlanFits(teacherPlan, text);
  const byN = new Map(fit.fits ? teacherPlan.phases.map((p) => [p.n, p.steps]) : []);
  const headAt = new Map(heads.map((x) => [x.line, x]));
  const items = [], content = new Map(), origin = new Map();   // content: Block → seine Zeilen; origin: Fortsetzung → Block der Phase über dem Zwischenstopp
  let cur = null, stopped = false;   // stopped: seit der Überschrift (bzw. der letzten Fortsetzung) kam ein Zwischenstopp
  lines.forEach((ln, i) => {
    const h = headAt.get(i);
    if (h) { cur = { type: "phase", n: h.n, line: i, head: ln.runs, steps: [], auto: false }; items.push(cur); content.set(cur, []); stopped = false; return; }
    if (ln.type === "stop") { items.push({ type: "stop", line: i }); stopped = true; return; }
    // „--> Nächste Stunde“: was bis zur nächsten Phase folgt, gehört zu keiner Phase (nie der vorigen zugeschlagen)
    if (isNextLine(ln)) { items.push({ type: "next", line: i, runs: ln.runs }); cur = null; return; }
    if (!cur || !lineHasContent(ln)) return;
    if (stopped) {
      const cont = { type: "phase", n: cur.n, line: i, head: cur.head, steps: [], auto: true, cont: true };
      origin.set(cont, origin.get(cur) || cur);
      items.push(cont); content.set(cont, []); cur = cont; stopped = false;
    }
    content.get(cur).push(ln);
  });
  const filled = filledPhases(text), used = new Set(), autoPhases = [];
  for (const it of items) {
    if (it.type !== "phase") continue;
    const ls = content.get(it);
    // dieselbe Nummer zweimal im Plan: die Anweisungen von Claude stehen bei der ersten
    if (!it.cont && byN.has(it.n) && !used.has(it.n)) {
      used.add(it.n);
      it.steps = byN.get(it.n).map((t) => ({ runs: [{ text: t }], kind: "claude" }));
      const refs = teacherRefs(ls);
      if (refs.length) it.refs = refs;
      continue;
    }
    it.steps = autoSteps(ls);
    it.auto = true;
    if (fit.fits && !it.cont && !byN.has(it.n) && filled.has(it.n) && !autoPhases.includes(it.n)) autoPhases.push(it.n);
  }
  for (const [cont, base] of origin) if (!base.auto) base.partial = true;
  return { mode: fit.fits ? "claude" : "auto", why: fit.fits ? null : fit.why, autoPhases, items };
}
/* kleiner Satz über der kompakten Liste: welche Fassung zu sehen ist (Sie-Form) */
export function compactLabel(r, gs = false) {
  const plan = gs ? "Verlaufsplan" : "Schulportal-Eintrag";
  if (r.mode === "claude") return "Kurzplan von Claude" + (r.autoPhases.length ? " – " + phaseList(r.autoPhases) + " automatisch gekürzt (dazu hat Claude nichts geschrieben)" : "");
  return "Automatisch gekürzt – " + ({
    changed: "der Kurzplan von Claude passt nicht mehr zum geänderten " + plan + ".",
    phases: "der Kurzplan von Claude passt nicht zu den Phasen im " + plan + ".",
  }[r.why] || "die Phasen mit Ihren Aufgaben (unterstrichene Zeilen, sonst der erste Stichpunkt). Einen eigenen Kurzplan schreibt Claude beim Planen.");
}
export const FULL_PLAN_LABEL = "Vollständigen Verlaufsplan anzeigen";
