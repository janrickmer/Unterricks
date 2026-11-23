// teacherplan.js – „Kurzplan für die Lehrkraft“ (Nachtrag 42, Teil 2 vom 23.11.2026): Claude schreibt beim Planen je Phase des Verlaufsplans (Gymnasium:
// Schulportal-Eintrag) 1–3 kurze, klare Anweisungen, was die Lehrkraft dort tut; Unterricks zeigt sie NUR in „Ich bin jetzt im Unterricht“ (public/inclass.js,
// compactPlan in public/inclasslib.js) – der lange Verlaufsplan bleibt aufklappbar darunter. Reine Funktionen ohne DOM und Netz: Prüfung (Connector, Sitzungsseite,
// Sitzungsdatei), Speicherform (lessons.teacher_plan = JSON {v:1, phases:[{n, steps}], plan, at}), ob er noch zur Planung passt, und der Speicherschritt der Prompts.
// Nur für die Lehrkraft: nie in Schüler-, Eltern-, Beamer-, Live- oder Vertretungsrouten (die bauen ihre Antworten aus einzeln gewählten Feldern).
import { planFingerprint, portalPhases, PHASE_MAX } from "./shared.js";

export const TEACHER_PLAN_TITLE = "Kurzplan für die Lehrkraft";
// höchstens 20 Phasen, je Phase 1–3 Anweisungen mit je höchstens 240 Zeichen
export const TEACHER_PLAN_LIMITS = { phases: 20, steps: 3, chars: 240 };

// eine Zeile: Steuer- und Zeilenumbruchzeichen werden Leerzeichen, Leerraum zusammengefasst
const oneLine = (s) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
const isPhaseNo = (n) => Number.isInteger(n) && n >= 1 && n <= PHASE_MAX;

/* Was Claude je Phase schreibt (Werkzeugbeschreibung von update_lesson und Speicherschritt der Prompts) – gs: true = Grundschule, false = Gymnasium,
   "beide" = Connector */
export function teacherPlanRules(gs) {
  const both = gs === "beide";
  const kids = both ? "Schüler:innen bzw. Kindern" : gs ? "Kindern" : "Schüler:innen";
  const signs = both ? "ohne Schulportal-Zeichen und ohne Verweise [[pdf:…]]" : gs ? "ohne die Zeichen des Verlaufsplans (**, ~~, __) und ohne Verweise [[pdf:…]]" : "ohne Schulportal-Zeichen";
  return "1 bis " + TEACHER_PLAN_LIMITS.steps + " kurze, klare Anweisungen, was die Lehrkraft in dieser Phase tut – in der dritten Person, konkret und knapp " +
    "(höchstens " + TEACHER_PLAN_LIMITS.chars + " Zeichen je Anweisung), z. B. „Lehrkraft liest den Erzähltext ‚Josef‘ bis Nr. 3 vor und legt dabei die Bildkarten 1–3 hin.“ oder " +
    "„Lehrkraft erklärt kurz, was Martin Luther am Ablasshandel kritisiert hat.“ Schlichter Text " + signs + " – Material nennst du mit seinem Titel; nie Namen von " + kids + ".";
}

/* Eingabe des Connectors (kurzplan_lehrkraft: [{phase, anweisungen}]) streng prüfen → [{n, steps}] in der Reihenfolge der Phasen ([] = löschen).
   Fehler als Error mit deutscher Meldung – nie still gekürzt (Claude soll selbst kürzen). */
export function teacherPlanFromArgs(list) {
  if (!Array.isArray(list)) throw new Error("kurzplan_lehrkraft ist eine Liste [{phase, anweisungen}] ([] löscht den Kurzplan).");
  if (list.length > TEACHER_PLAN_LIMITS.phases) throw new Error("Der Kurzplan hat zu viele Phasen (" + list.length + ", höchstens " + TEACHER_PLAN_LIMITS.phases + ").");
  const out = [], seen = new Set();
  list.forEach((x, i) => {
    const at = "Eintrag " + (i + 1);
    if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error(at + ": ein Eintrag ist ein Objekt {phase, anweisungen}.");
    if (!isPhaseNo(x.phase)) throw new Error(at + ": phase ist die Nummer einer Phase (1–" + PHASE_MAX + ") wie im Verlaufsplan, z. B. 3 für „**3) …**“.");
    const where = at + " (Phase " + x.phase + ")";
    if (seen.has(x.phase)) throw new Error(where + ": Diese Phase steht doppelt – fasse ihre Anweisungen in einem Eintrag zusammen.");
    seen.add(x.phase);
    const a = x.anweisungen;
    if (!Array.isArray(a) || !a.length || a.length > TEACHER_PLAN_LIMITS.steps) throw new Error(where + ": anweisungen sind 1 bis " + TEACHER_PLAN_LIMITS.steps + " kurze Anweisungen (eine Liste von Texten).");
    const steps = a.map((s, k) => {
      if (typeof s !== "string") throw new Error(where + ": Anweisung " + (k + 1) + " ist kein Text.");
      const t = oneLine(s);
      if (!t) throw new Error(where + ": Anweisung " + (k + 1) + " ist leer.");
      if (t.length > TEACHER_PLAN_LIMITS.chars) throw new Error(where + ": Anweisung " + (k + 1) + " ist zu lang (" + t.length + " Zeichen, höchstens " + TEACHER_PLAN_LIMITS.chars + ") – bitte kürzen.");
      return t;
    });
    out.push({ n: x.phase, steps });
  });
  return out.sort((p, q) => p.n - q.n);
}

/* Phasen eines gespeicherten bzw. fremden Kurzplans ([{n, steps}], z. B. aus einer Sitzungsdatei) tolerant lesen: Ungültiges entfällt, Grenzen gekappt */
export function cleanTeacherPlanPhases(raw) {
  const out = [], seen = new Set();
  for (const p of (Array.isArray(raw) ? raw : []).slice(0, 60)) {
    if (!p || typeof p !== "object" || !isPhaseNo(p.n) || seen.has(p.n)) continue;
    const steps = (Array.isArray(p.steps) ? p.steps : []).filter((s) => typeof s === "string").map((s) => oneLine(s).slice(0, TEACHER_PLAN_LIMITS.chars).trim()).filter(Boolean)
      .slice(0, TEACHER_PLAN_LIMITS.steps);
    if (!steps.length) continue;
    seen.add(p.n);
    out.push({ n: p.n, steps });
    if (out.length >= TEACHER_PLAN_LIMITS.phases) break;
  }
  return out.sort((p, q) => p.n - q.n);
}

/* Speicherform: plan = Fingerabdruck der Planung beim Speichern (planFingerprint), at = Zeitpunkt (ms); ohne Phasen null (= kein Kurzplan) */
export const teacherPlanStore = (phases, plan, at) => {
  const ps = cleanTeacherPlanPhases(phases);
  return ps.length ? JSON.stringify({ v: 1, phases: ps, plan: typeof plan === "string" && plan ? plan.slice(0, 40) : null, at: Number.isFinite(at) ? at : null }) : null;
};
/* gespeichert (lessons.teacher_plan) tolerant gelesen → {phases, plan, at} | null */
export function teacherPlanOf(raw) {
  let o = null;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch {}
  if (!o || typeof o !== "object" || Array.isArray(o)) return null;
  const phases = cleanTeacherPlanPhases(o.phases);
  if (!phases.length) return null;
  return { phases, plan: typeof o.plan === "string" && o.plan ? o.plan.slice(0, 40) : null, at: Number.isFinite(o.at) ? o.at : null };
}

/* Passt der Kurzplan noch zur Planung (text = Schulportal-Eintrag bzw. Verlaufsplan)? Nur, wenn sich die Planung seit dem Speichern nicht geändert hat (gleicher
   Fingerabdruck – ein Zwischenstopp zählt nicht) und es jede seiner Phasen im Plan gibt.
   → {fits, why: null | "none" (kein Kurzplan) | "changed" (Planung danach geändert) | "phases" (Phasen fehlen im Plan), missing: [n], uncovered: [n] (Phasen des Plans ohne Anweisungen)} */
export function teacherPlanFits(tp, text) {
  if (!tp || !Array.isArray(tp.phases) || !tp.phases.length) return { fits: false, why: "none", missing: [], uncovered: [] };
  const heads = portalPhases(text), have = new Set(heads.map((h) => h.n)), mine = new Set(tp.phases.map((p) => p.n));
  const missing = tp.phases.map((p) => p.n).filter((n) => !have.has(n));
  const uncovered = [...new Set(heads.map((h) => h.n))].filter((n) => !mine.has(n));
  if (typeof tp.plan === "string" && tp.plan && tp.plan !== planFingerprint(text)) return { fits: false, why: "changed", missing, uncovered };
  if (missing.length) return { fits: false, why: "phases", missing, uncovered };
  return { fits: true, why: null, missing, uncovered };
}

/* „Phase 3“, „Phasen 3 und 5“, „Phasen 2, 3 und 5“ */
export function phaseList(ns) {
  const l = [...ns];
  if (l.length <= 1) return "Phase " + (l[0] ?? "");
  return "Phasen " + l.slice(0, -1).join(", ") + " und " + l[l.length - 1];
}

/* Prompt „Stunde mit Claude planen“ (Gymnasium und Grundschule): Speicherschritt direkt nach dem Absatz für die Weitergabe – genau einmal im Prompt; ohne ihn
   ist der Prompt byte-gleich zum Stand davor (Test in zwischenstopp.test.mjs). Nicht im Selbstlern- und nicht im Präsentations-Prompt. */
export const teacherPlanSaveStep = (gs) => "   - Außerdem den „" + TEACHER_PLAN_TITLE + "“ → `update_lesson` mit `kurzplan_lehrkraft` – zusammen mit der Zusammenfassung, " +
  "nachdem " + (gs ? "der Verlaufsplan" : "der Schulportal-Eintrag") + " gespeichert ist: für jede seiner Phasen ein Eintrag {phase, anweisungen} – `phase` = ihre Nummer " +
  "(aus „**3) …**“ wird 3), `anweisungen` = " + teacherPlanRules(!!gs) + " Unterricks zeigt ihn mir nur in „Ich bin jetzt im Unterricht“ – so sehe ich in der Stunde mit einem Blick, was ich gerade tun muss. " +
  "Ändern wir " + (gs ? "den Verlaufsplan" : "den Schulportal-Eintrag") + " später, schreibe auch den Kurzplan neu.";
