// Nachtrag 42, Teil 2 (23.11.2026): „Kurzplan für die Lehrkraft“ in „Ich bin jetzt im Unterricht“ – Claude schreibt ihn beim Planen (update_lesson
// kurzplan_lehrkraft, je Phase 1–3 Anweisungen); nur die kompakte Ansicht zeigt ihn – passt er nicht (mehr) zur Planung, kürzt sie selbst (Phasen und
// unterstrichene Aufforderungen an die Lehrkraft, sonst der erste Stichpunkt). Speicherform, Prompts, Connector, Sitzungsdatei, nie für Schüler:innen,
// Eltern, Beamer oder Vertretung, und die kompakte Liste in der DOM-Nachbildung (Pfeil, Zeilen, Kontextmenü, Zwischenstopp, aufklappbarer Verlaufsplan).
// Frei erfundene Inhalte.
import test from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
const { installDom, stubs } = await import("./fake-dom.mjs");
register(stubs);
const LID = "d4".repeat(8), FV = "e4".repeat(8), FC = "e5".repeat(8), FA = "e6".repeat(8);
const D = installDom({ hash: "#/lk/s/" + LID });
const S = await import("../../public/shared.js");
const TP = await import("../../public/teacherplan.js");
const IL = await import("../../public/inclasslib.js");
const IC = await import("../../public/inclass.js");
const PV = await import("../../public/portalview.js");
const P = await import("../../public/planning.js");
const G = await import("../../public/gsplanning.js");
const SL = await import("../../public/selbstlern.js");
const SH = await import("../../public/sharelib.js");
const SF = await import("../../public/sessionfile.js");
const { ApiError } = await import("../../public/ui.js");
const GSS = await import("../../public/gssession.js");
const { resetPrintQueue } = await import("../../public/designrender.js");
const { fakeCtx } = await import("./fake-d1.mjs");
const L = await import("../../worker/lessons.js");
const ST = await import("../../worker/student.js");
const PA = await import("../../worker/parents.js");
const GS = await import("../../worker/gs.js");
const U = await import("../../worker/units.js");
const { routeMcp } = await import("../../worker/mcp.js");
const { sha256Hex } = await import("../../worker/lib.js");
const { setSetting } = await import("../../worker/db.js");

const STOP = S.STOP_LINE;
const PORTAL = "**1) Einstieg**\n- Karikatur ~~Wer hat die Macht?~~\n\n**2) Partnerarbeit**\n- Feibeitsblatt ~~Gewaltenteilung~~\n- __Lehrkraft geht herum und hilft bei Aufgabe 2.__\n\n" +
  "**3) Sicherung**\n- Tafelbild\n\n--> Nächste Stunde\n\n**4) Diskussion**\n- Ist das Bundesverfassungsgericht zu mächtig? Erst in Partnerarbeit Argumente finden, dann im Plenum auf der Argumentationswippe festhalten.";
const KP = [{ n: 1, steps: ["Lehrkraft zeigt die Karikatur und fragt: Wer hat hier die Macht?"] }, { n: 2, steps: ["Lehrkraft teilt den Code aus.", "Lehrkraft geht herum und hilft."] },
  { n: 3, steps: ["Lehrkraft schreibt das Tafelbild mit."] }, { n: 4, steps: ["Lehrkraft leitet die Diskussion."] }];
const tpOf = (phases, text = PORTAL) => ({ phases, plan: S.planFingerprint(text), at: Date.parse("2026-11-20T09:00:00Z") });
const textOf = (runs) => runs.map((r) => (r.file !== undefined ? "[" + r.file + "]" : r.text)).join("");

/* ---------- reine Funktionen (public/teacherplan.js) ---------- */
test("teacherPlanFromArgs: streng geprüft – Phasennummer, 1–3 Anweisungen, je höchstens 240 Zeichen, keine doppelte Phase; sortiert, Leerraum zusammengefasst; [] = löschen", () => {
  assert.deepEqual(TP.teacherPlanFromArgs([{ phase: 3, anweisungen: ["  Lehrkraft schreibt\n das Tafelbild.  "] }, { phase: 1, anweisungen: ["a", "b", "c"] }]),
    [{ n: 1, steps: ["a", "b", "c"] }, { n: 3, steps: ["Lehrkraft schreibt das Tafelbild."] }]);
  assert.deepEqual(TP.teacherPlanFromArgs([]), []);
  const err = (x) => { try { TP.teacherPlanFromArgs(x); return null; } catch (e) { return e.message; } };
  assert.equal(err("Phase 1"), "kurzplan_lehrkraft ist eine Liste [{phase, anweisungen}] ([] löscht den Kurzplan).");
  assert.equal(err(Array.from({ length: 21 }, (_, i) => ({ phase: i + 1, anweisungen: ["x"] }))), "Der Kurzplan hat zu viele Phasen (21, höchstens 20).");
  assert.equal(err([{ phase: 0, anweisungen: ["x"] }]), "Eintrag 1: phase ist die Nummer einer Phase (1–99) wie im Verlaufsplan, z. B. 3 für „**3) …**“.");
  assert.equal(err([{ phase: "2", anweisungen: ["x"] }]), "Eintrag 1: phase ist die Nummer einer Phase (1–99) wie im Verlaufsplan, z. B. 3 für „**3) …**“.");
  assert.equal(err([{ phase: 2, anweisungen: ["x"] }, { phase: 2, anweisungen: ["y"] }]), "Eintrag 2 (Phase 2): Diese Phase steht doppelt – fasse ihre Anweisungen in einem Eintrag zusammen.");
  assert.equal(err([{ phase: 2, anweisungen: [] }]), "Eintrag 1 (Phase 2): anweisungen sind 1 bis 3 kurze Anweisungen (eine Liste von Texten).");
  assert.equal(err([{ phase: 2, anweisungen: ["a", "b", "c", "d"] }]), "Eintrag 1 (Phase 2): anweisungen sind 1 bis 3 kurze Anweisungen (eine Liste von Texten).");
  assert.equal(err([{ phase: 2, anweisungen: ["a", "   "] }]), "Eintrag 1 (Phase 2): Anweisung 2 ist leer.");
  assert.equal(err([{ phase: 2, anweisungen: [7] }]), "Eintrag 1 (Phase 2): Anweisung 1 ist kein Text.");
  assert.equal(err([{ phase: 2, anweisungen: ["x".repeat(241)] }]), "Eintrag 1 (Phase 2): Anweisung 1 ist zu lang (241 Zeichen, höchstens 240) – bitte kürzen.");
  assert.equal(err([{ phase: 2, anweisungen: ["x".repeat(240)] }]), null, "genau 240 Zeichen gehen");
  // PATCH der Sitzung (Befund der Gegenprüfung): genauso streng, Felder {n, steps}
  assert.deepEqual(TP.teacherPlanFromBody([{ n: 3, steps: [" a\n b "] }, { n: 1, steps: ["c"] }]), [{ n: 1, steps: ["c"] }, { n: 3, steps: ["a b"] }]);
  const berr = (x) => { try { TP.teacherPlanFromBody(x); return null; } catch (e) { return e.message; } };
  assert.equal(berr({ n: 1 }), "Der Kurzplan für die Lehrkraft ist eine Liste [{n, steps}] ([] bzw. null löscht ihn).");
  assert.equal(berr([{ n: 1, steps: ["a", "b", "c", "d"] }]), "Eintrag 1 (Phase 1): steps sind 1 bis 3 kurze Anweisungen (eine Liste von Texten).");
  assert.equal(berr([{ n: 1, steps: ["x".repeat(241)] }]), "Eintrag 1 (Phase 1): Anweisung 1 ist zu lang (241 Zeichen, höchstens 240) – bitte kürzen.");
  assert.equal(berr([{ n: 1, steps: ["a", 5] }]), "Eintrag 1 (Phase 1): Anweisung 2 ist kein Text.");
  assert.equal(berr([{ n: 1, steps: [" "] }]), "Eintrag 1 (Phase 1): Anweisung 1 ist leer.");
  assert.equal(berr([{ phase: 1, steps: ["x"] }]), "Eintrag 1: n ist die Nummer einer Phase (1–99) wie im Verlaufsplan, z. B. 3 für „**3) …**“.");
  assert.equal(berr(["x"]), "Eintrag 1: ein Eintrag ist ein Objekt {n, steps}.");
});

test("Speicherform: teacherPlanStore/teacherPlanOf (tolerant gelesen, Grenzen gekappt); teacherPlanFits – Zwischenstopp zählt nicht, geänderte Planung und fehlende Phasen schon", () => {
  const raw = TP.teacherPlanStore(KP, S.planFingerprint(PORTAL), 5);
  assert.deepEqual(JSON.parse(raw), { v: 1, phases: KP, plan: S.planFingerprint(PORTAL), at: 5 });
  assert.deepEqual(TP.teacherPlanOf(raw), { phases: KP, plan: S.planFingerprint(PORTAL), at: 5 });
  assert.equal(TP.teacherPlanStore([], "p1:x", 1), null, "ohne Phasen: kein Kurzplan");
  assert.equal(TP.teacherPlanOf("kaputt"), null);
  assert.equal(TP.teacherPlanOf(JSON.stringify({ v: 1, phases: [] })), null);
  // fremde Daten: Ungültiges entfällt, Grenzen gekappt
  const messy = TP.cleanTeacherPlanPhases([{ n: 2, steps: ["a", "b", "c", "d"] }, { n: 2, steps: ["doppelt"] }, { n: 0, steps: ["x"] }, { n: 5, steps: [3, "", "y".repeat(300)] }, { n: 7 }, null]);
  assert.deepEqual(messy, [{ n: 2, steps: ["a", "b", "c"] }, { n: 5, steps: ["y".repeat(240)] }]);
  assert.equal(TP.cleanTeacherPlanPhases(Array.from({ length: 30 }, (_, i) => ({ n: i + 1, steps: ["x"] }))).length, 20);
  // passt er?
  assert.deepEqual(TP.teacherPlanFits(tpOf(KP), PORTAL), { fits: true, why: null, missing: [], uncovered: [] });
  assert.equal(TP.teacherPlanFits(tpOf(KP), S.insertStop(PORTAL, 3).text).fits, true, "ein Zwischenstopp ändert die Planung nicht");
  assert.equal(TP.teacherPlanFits(tpOf(KP), PORTAL + "\n- Zusatz").why, "changed");
  assert.equal(TP.teacherPlanFits({ ...tpOf(KP), plan: S.PLAN_FINGERPRINT_STALE }, PORTAL).why, "changed", "veraltet aus einer Sitzungsdatei");
  assert.deepEqual(TP.teacherPlanFits(tpOf([...KP, { n: 6, steps: ["x"] }]), PORTAL), { fits: false, why: "phases", missing: [6], uncovered: [] });
  assert.deepEqual(TP.teacherPlanFits(tpOf(KP.slice(0, 2)), PORTAL), { fits: true, why: null, missing: [], uncovered: [3, 4] });
  assert.equal(TP.teacherPlanFits(null, PORTAL).why, "none");
  // Phasen ohne Inhalt (z. B. „**1) TOP 10**“ der Vorlage) fehlen nicht; was nach „--> Nächste Stunde“ steht, gehört zu keiner Phase (Befund der Gegenprüfung)
  const TPL = "**1) TOP 10**\n\n**2) Blitzlicht ohne iPad**\n- Einstieg\n\n**3) Sicherung**\n\n--> Nächste Stunde\n- Hefte einsammeln\n\n**4) Diskussion**\n" + STOP + "\n- Argumente";
  assert.deepEqual([...TP.filledPhases(TPL)], [2, 4], "Zwischenstopp unterbricht nicht, „-->“ beendet die Phase");
  assert.deepEqual(TP.teacherPlanFits(tpOf([{ n: 2, steps: ["x"] }], TPL), TPL), { fits: true, why: null, missing: [], uncovered: [4] });
  assert.deepEqual(TP.teacherPlanFits(tpOf([{ n: 1, steps: ["x"] }], TPL), TPL).uncovered, [2, 4], "eine Phase ohne Inhalt darf Claude trotzdem beschreiben");
  assert.deepEqual([TP.phaseList([3]), TP.phaseList([3, 5]), TP.phaseList([2, 3, 5])], ["Phase 3", "Phasen 3 und 5", "Phasen 2, 3 und 5"]);
});

/* ---------- kompakter Verlaufsplan (public/inclasslib.js compactPlan) ---------- */
test("compactPlan: Kurzplan von Claude, der passt – je Phase seine Anweisungen an der Zeile der Überschrift; „--> Nächste Stunde“ an seiner Stelle", () => {
  const r = IL.compactPlan(PORTAL, { teacherPlan: tpOf(KP) });
  const heads = S.portalPhases(PORTAL);
  assert.deepEqual([r.mode, r.why, r.autoPhases], ["claude", null, []]);
  assert.deepEqual(r.items.map((x) => [x.type, x.line]), [["phase", 0], ["phase", 3], ["phase", 7], ["next", 10], ["phase", 12]]);
  assert.deepEqual(r.items.filter((x) => x.type === "phase").map((x) => x.line), heads.map((x) => x.line), "die Zeilen der Überschriften wie portalPhases");
  assert.deepEqual(r.items.filter((x) => x.type === "phase").map((x) => [textOf(x.head), x.steps.map((s) => s.kind + ":" + textOf(s.runs))]), [
    ["1) Einstieg", ["claude:Lehrkraft zeigt die Karikatur und fragt: Wer hat hier die Macht?"]], ["2) Partnerarbeit", ["claude:Lehrkraft teilt den Code aus.", "claude:Lehrkraft geht herum und hilft."]],
    ["3) Sicherung", ["claude:Lehrkraft schreibt das Tafelbild mit."]], ["4) Diskussion", ["claude:Lehrkraft leitet die Diskussion."]]]);
  assert.equal(r.items[0].head[0].b, true, "die Überschrift bleibt fett");
  assert.equal(IL.compactLabel(r), "Kurzplan von Claude");
  // eine Phase ohne Anweisungen von Claude: dort automatisch gekürzt – der Satz nennt sie
  const part = IL.compactPlan(PORTAL, { teacherPlan: tpOf(KP.slice(0, 2)) });
  assert.deepEqual([part.mode, part.autoPhases], ["claude", [3, 4]]);
  assert.equal(IL.compactLabel(part), "Kurzplan von Claude – Phasen 3 und 4 automatisch gekürzt (dazu hat Claude nichts geschrieben)");
});

test("compactPlan automatisch: unterstrichene Aufforderungen an die Lehrkraft (ohne Unterstreichung), sonst der erste Stichpunkt gekürzt; Grund im Satz darüber", () => {
  for (const [tp, why, label] of [[null, "none", "Automatisch gekürzt – die Phasen mit Ihren Aufgaben (unterstrichene Zeilen, sonst der erste Stichpunkt). Einen eigenen Kurzplan schreibt Claude beim Planen."],
    [tpOf(KP, "**1) Früher**"), "changed", "Automatisch gekürzt – der Kurzplan von Claude passt nicht mehr zum geänderten Schulportal-Eintrag."],
    [tpOf([{ n: 9, steps: ["x"] }]), "phases", "Automatisch gekürzt – der Kurzplan von Claude passt nicht zu den Phasen im Schulportal-Eintrag."]]) {
    const r = IL.compactPlan(PORTAL, { teacherPlan: tp });
    assert.deepEqual([r.mode, r.why], ["auto", why]);
    assert.equal(IL.compactLabel(r), label);
    const ph = r.items.filter((x) => x.type === "phase");
    assert.deepEqual(ph.map((x) => x.steps.map((s) => s.kind + ":" + textOf(s.runs))), [["gist:Karikatur Wer hat die Macht?"], ["teacher:Lehrkraft geht herum und hilft bei Aufgabe 2."], ["gist:Tafelbild"],
      ["gist:Ist das Bundesverfassungsgericht zu mächtig? Erst in Partnerarbeit Argumente finden, dann im Plenum auf der …"]]);
    assert.ok(ph[1].steps[0].runs.every((x) => !x.u), "im Kurzplan ohne Unterstreichung");
    assert.ok(ph.every((x) => x.auto));
  }
  assert.equal(IL.compactLabel(IL.compactPlan("**1) Sitzkreis**\n- Lied", { gs: true, teacherPlan: tpOf(KP, "x") }), true), "Automatisch gekürzt – der Kurzplan von Claude passt nicht mehr zum geänderten Verlaufsplan.");
  // ohne nummerierte Phasen: nichts zu kürzen – der vollständige Verlaufsplan bleibt
  assert.deepEqual(IL.compactPlan("Einstieg mit Karikatur\n- Gespräch"), { mode: "full", why: null, autoPhases: [], items: [] });
  // kürzen: an einer Wortgrenze mit „…“; ein Link wird nie zerschnitten, ein Verweis zählt wie 20 Zeichen
  assert.deepEqual(IL.shortRuns([{ text: "eins zwei drei vier" }], 12), [{ text: "eins zwei" }, { text: " …" }]);
  assert.deepEqual(IL.shortRuns([{ text: "Video: " }, { text: "https://example.org/" + "x".repeat(200), href: "https://example.org/x" }], 40), [{ text: "Video: " }, { text: " …" }]);
  assert.deepEqual(IL.shortRuns([{ text: "", file: FA }, { text: " austeilen" }], 40).length, 2);
});

test("compactPlan: der Zwischenstopp steht an seiner Stelle, Text vor der ersten Phase entfällt; Grundschule mit Verweisen in der Aufforderung", () => {
  const before3 = S.insertStop(PORTAL, 7).text;
  let r = IL.compactPlan(before3, { teacherPlan: tpOf(KP) });
  assert.equal(r.mode, "claude", "ein Zwischenstopp ändert nichts am Kurzplan");
  assert.deepEqual(r.items.map((x) => [x.type, x.line]), [["phase", 0], ["phase", 3], ["stop", 7], ["phase", 8], ["next", 11], ["phase", 13]]);
  assert.ok(r.items.every((x) => !x.cont && !x.partial), "vor einer Phase: keine Fortsetzung");
  r = IL.compactPlan("Thema: Macht\n" + STOP + "\n**1) Einstieg**\n- Karikatur");
  assert.deepEqual(r.items.map((x) => x.type), ["stop", "phase"]);
  // Grundschule: Aufforderung samt Verweis, Verweis allein als erster Stichpunkt
  const plan = "**1) Ankommen im Sitzkreis (5 Min.)**\n- Begrüßungslied\n**2) Erzählung (15 Min., Sitzkreis)**\n- __Lehrkraft liest [[pdf:" + FV + "|Vorlesetext]] vor.__\n- Bildkarten [[pdf:" + FC + "]] in die Mitte legen\n" +
    "**3) Arbeitsblatt (15 Min., Einzelarbeit)**\n- [[pdf:" + FA + "]]";
  r = IL.compactPlan(plan, { gs: true });
  assert.deepEqual(r.items.map((x) => x.steps.map((s) => s.kind + ":" + textOf(s.runs))), [["gist:Begrüßungslied"], ["teacher:Lehrkraft liest [" + FV + "] vor."], ["gist:[" + FA + "]"]]);
  assert.equal(IL.compactPlan(plan, { gs: false }).items[1].steps[0].kind, "teacher", "auch ohne gs ist die Zeile eine Aufforderung (der Verweis bleibt dann Text)");
  assert.ok(r.items.every((x) => !x.refs), "automatisch gekürzt: die Verweise stehen in den Aufforderungen selbst");
});

test("compactPlan, Befunde der Gegenprüfung: Zwischenstopp mitten in einer Phase – ihr Rest als Fortsetzung danach (nie Offenes darüber); Anweisungen von Claude mit Hinweis", () => {
  // automatisch: über dem Zwischenstopp nur die Zeilen davor, danach „2) Partnerarbeit“ als Fortsetzung mit der offenen Aufforderung an die Lehrkraft
  const mid = S.insertStop(PORTAL, 5).text;   // vor „- __Lehrkraft geht herum …__“
  let r = IL.compactPlan(mid);
  assert.deepEqual(r.items.map((x) => x.type + x.line + (x.cont ? "+" : "")), ["phase0", "phase3", "stop5", "phase6+", "phase8", "next11", "phase13"]);
  assert.deepEqual([r.items[1].steps.map((s) => s.kind + ":" + textOf(s.runs)), r.items[1].partial], [["gist:Feibeitsblatt Gewaltenteilung"], undefined]);
  const cont = r.items[3];
  assert.deepEqual([cont.n, textOf(cont.head), cont.auto, cont.steps.map((s) => s.kind + ":" + textOf(s.runs))], [2, "2) Partnerarbeit", true, ["teacher:Lehrkraft geht herum und hilft bei Aufgabe 2."]]);
  // Zwischenstopp direkt nach der Überschrift: die Phase darüber ohne Anweisungen, alles in der Fortsetzung
  r = IL.compactPlan(S.insertStop(PORTAL, 4).text);
  assert.deepEqual([r.items[1].steps, r.items[3].cont, r.items[3].line, r.items[3].steps.map((s) => s.kind)], [[], true, 5, ["teacher"]]);
  // Kurzplan von Claude: seine Anweisungen gelten für die ganze Phase – sie bleiben darüber, der Block bekommt den Hinweis; die Fortsetzung ist automatisch gekürzt
  r = IL.compactPlan(mid, { teacherPlan: tpOf(KP) });
  assert.deepEqual([r.mode, r.autoPhases], ["claude", []], "eine Fortsetzung zählt nicht als „automatisch gekürzt“");
  assert.deepEqual([r.items[1].partial, r.items[1].steps.map((s) => s.kind), r.items[3].cont, r.items[3].steps.map((s) => s.kind)], [true, ["claude", "claude"], true, ["teacher"]]);
  assert.ok(r.items.filter((x) => x !== r.items[1]).every((x) => !x.partial));
  assert.equal(IL.COMPACT_PARTIAL, "Der Zwischenstopp liegt mitten in dieser Phase – ihren offenen Teil zeigt die Fortsetzung unter dem Zwischenstopp.");
  // Zwischenstopp am Ende einer Phase (nach ihrem letzten Stichpunkt): keine Fortsetzung
  r = IL.compactPlan(S.insertStop(PORTAL, 6).text, { teacherPlan: tpOf(KP) });
  assert.ok(r.items.every((x) => !x.cont && !x.partial));
});

test("compactPlan, Befunde der Gegenprüfung: „--> Nächste Stunde“ beendet die Phase; leere und doppelte Phasen nicht „automatisch gekürzt“; Grundschule mit gelben Verweisen zum Kurzplan", () => {
  // was zwischen „--> Nächste Stunde“ und der nächsten Phase steht, gehört nicht zur Phase davor
  let r = IL.compactPlan("**1) A**\n- a\n\n--> Nächste Stunde\n- __Lehrkraft sammelt die Hefte ein.__\n\n**2) B**");
  assert.deepEqual(r.items.map((x) => [x.type, (x.steps || []).map((s) => s.kind + ":" + textOf(s.runs))]), [["phase", ["gist:a"]], ["next", []], ["phase", []]]);
  // eine Phase ohne Inhalt (Vorlage „**1) TOP 10**“): kein „automatisch gekürzt“, auch nicht in der Rückmeldung des Connectors (uncovered)
  const tpl = "**1) TOP 10**\n\n**2) Blitzlicht ohne iPad**\n- Einstieg: ~~Wie kann man sich helfen?~~";
  r = IL.compactPlan(tpl, { teacherPlan: tpOf([{ n: 2, steps: ["Lehrkraft stellt die Einstiegsfrage."] }], tpl) });
  assert.deepEqual([r.mode, r.autoPhases, IL.compactLabel(r)], ["claude", [], "Kurzplan von Claude"]);
  assert.deepEqual(r.items[0].steps, [], "die leere Phase steht nur als Überschrift da");
  // dieselbe Nummer zweimal: Claude hat sie beschrieben – die zweite ist automatisch gekürzt, aber nicht im Satz genannt
  const dup = "**1) A**\n- a\n**1) B**\n- b\n**2) C**\n- c";
  r = IL.compactPlan(dup, { teacherPlan: tpOf([{ n: 1, steps: ["x"] }], dup) });
  assert.deepEqual([r.autoPhases, IL.compactLabel(r)], [[2], "Kurzplan von Claude – Phase 2 automatisch gekürzt (dazu hat Claude nichts geschrieben)"]);
  assert.deepEqual(r.items.map((x) => x.steps.map((s) => s.kind + ":" + textOf(s.runs))), [["claude:x"], ["gist:b"], ["gist:c"]]);
  // Grundschule, Kurzplan von Claude: die Verweise der Aufforderungen an die Lehrkraft (ohne Doppelte, ohne Formatierung) bleiben als refs anklickbar
  const plan = "**1) Ankommen (5 Min.)**\n- Lied\n**2) Erzählung (15 Min.)**\n- __Lehrkraft liest [[pdf:" + FV + "|Vorlesetext]] vor und zeigt [[pdf:" + FC + "]].__\n- __Lehrkraft fragt nach ([[pdf:" + FV + "]]).__\n" +
    "- Bildkarten [[pdf:" + FA + "]] in die Mitte legen";
  r = IL.compactPlan(plan, { gs: true, teacherPlan: tpOf([{ n: 2, steps: ["Lehrkraft liest den Vorlesetext vor."] }], plan) });
  assert.deepEqual([r.items[1].steps.map((s) => s.kind), r.items[1].refs], [["claude"], [{ text: "", file: FV }, { text: "", file: FC }]]);
  assert.equal(r.items[0].refs, undefined, "ohne Aufforderung mit Verweis keine Zeile");
  assert.equal(IL.COMPACT_REFS, "Material:");
});

/* ---------- Prompts ---------- */
test("Prompts „Stunde mit Claude planen“ (Gymnasium, Jg. 5/6, Grundschule): ein Speicherschritt „Kurzplan für die Lehrkraft“ direkt nach dem Absatz für die Weitergabe; nicht Selbstlern- und Präsentations-Prompt", () => {
  const sek = { lessonId: "a".repeat(16), subject: "powi", klass: "8B", lesson: { title: "Gewaltenteilung", topic: "Gewaltenteilung", durationMin: 45 }, materials: [], sheets: [], messages: [] };
  const gsCtx = { lessonId: "b".repeat(16), subject: "gs", klass: "gs12345678", course: { short: "Religion 2ab", label: "Religion · Jahrgang 2 (Klassen 2a, 2b)", subjectName: "Religion", grade: 2, classes: ["a", "b"] }, lesson: { title: "Josef", durationMin: 45 }, materials: [] };
  for (const [p, gs, subject, klass] of [[P.claudeLessonPrompt(sek), false, "powi", "8B"], [P.claudeLessonPrompt({ ...sek, klass: "6B" }), false, "powi", "6B"], [G.claudeGsLessonPrompt(gsCtx), true, "gs", "gs"]]) {
    const step = TP.teacherPlanSaveStep(gs);
    assert.equal(p.split(step).length - 1, 1);
    assert.ok(p.includes(SH.shareSaveStep(subject, klass) + "\n" + step), "direkt nach dem Absatz für die Weitergabe");
    assert.ok(p.indexOf(step) < p.indexOf("Sage mir zum Schluss kurz"));
    for (const s of ["`update_lesson` mit `kurzplan_lehrkraft`", "{phase, anweisungen}", "(aus „**3) …**“ wird 3)", "1 bis 3 kurze, klare Anweisungen, was die Lehrkraft in dieser Phase tut",
      "„Lehrkraft liest den Erzähltext ‚Josef‘ bis Nr. 3 vor und legt dabei die Bildkarten 1–3 hin.“", "„Lehrkraft erklärt kurz, was Martin Luther am Ablasshandel kritisiert hat.“",
      "nur in „Ich bin jetzt im Unterricht“", gs ? "nachdem der Verlaufsplan gespeichert ist" : "nachdem der Schulportal-Eintrag gespeichert ist", gs ? "ohne Verweise [[pdf:…]]" : "ohne Schulportal-Zeichen",
      gs ? "nie Namen von Kindern." : "nie Namen von Schüler:innen."]) assert.ok(step.includes(s), s);
  }
  const sub = SL.claudeSelbstlernPrompt({ ...sek, row: null }), pres = S.claudePresentationPrompt(sek, "**1) Einstieg**", []);
  for (const p of [sub, pres]) assert.ok(!p.includes("kurzplan_lehrkraft") && !p.includes(TP.TEACHER_PLAN_TITLE));
  // Überarbeitung der Einheit: Gymnasium in Schritt 5, Grundschule als eigene Zeile direkt danach
  const gym = P.claudeGymRevisionPrompt({ unit: { id: "u".repeat(16), subject: "powi", klass: "8B", rows: [], plan: {}, params: {}, revise: { items: [] }, lessons: [] }, now: Date.parse("2026-11-02T10:00:00Z") });
  assert.ok(gym.includes("den „Absatz für die Weitergabe“ (`weitergabe`) und den „Kurzplan für die Lehrkraft“ (`kurzplan_lehrkraft`, je Phase 1–3 kurze Anweisungen, was ich tue))."));
  const rev = G.claudeUnitRevisionPrompt({ unit: { id: "u".repeat(16), rows: [], plan: {}, params: {}, revise: { items: [] }, lessons: [] }, now: Date.parse("2026-11-02T10:00:00Z") });
  assert.ok(rev.includes(G.CARDS_REVISION + "\n   Ändert sich dabei der Verlaufsplan einer Sitzung, schreibe auch ihren „Kurzplan für die Lehrkraft“ neu (`update_lesson` mit `kurzplan_lehrkraft`: je Phase 1–3 kurze Anweisungen, was ich tue).\n"));
});

/* ---------- Worker und Connector ---------- */
const TOKEN = "lehrkraft-token-42", STOKEN = "schueler-token-42", DEV = "dddddddddddddddd", NOW = Date.parse("2026-11-20T10:00:00Z");
const callAs = (tok) => async (c, fn, method, path, body, ...args) => {
  const req = new Request("https://unterricks.test" + path, { method, headers: { ...(tok ? { Authorization: "Bearer " + tok } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  try { const res = await fn({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, ...args); return { status: res.status, data: await res.json() }; }
  catch (e) { return { status: e.status || 500, data: { error: e.message, code: e.code, ...(e.extra || {}) } }; }
};
const call = callAs(TOKEN), scall = callAs(STOKEN), pub = callAs(null);
async function mcp(c, method, params) {
  const req = new Request("https://unterricks.test/mcp/geheim", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  return (await (await routeMcp({ ...c, request: req, ip: "1.2.3.4", waitUntil: () => {} }, "geheim")).json()).result;
}
const tool = async (c, name, args) => { const r = await mcp(c, "tools/call", { name, arguments: args }); return { text: r.content[0].text, isError: !!r.isError, data: r.structuredContent }; };
async function base() {
  const c = fakeCtx({ SETTINGS_SECRET: "nur-test-geheimnis-1234" });
  c.now = NOW;
  await c.db.prepare("INSERT INTO teacher_tokens(token_hash, device_hash, created_at, expires_at, last_used) VALUES(?1, 'd', ?2, ?3, ?2)").bind(await sha256Hex(TOKEN), c.now, c.now + 3600e3).run();
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|geheim"), createdAt: 1 });
  return c;
}
const stored = (c, id) => { const r = c.db.raw.prepare("SELECT teacher_plan AS t FROM lessons WHERE id=?").get(id); return r.t === null ? null : JSON.parse(r.t); };
const ARGS = KP.map((p) => ({ phase: p.n, anweisungen: p.steps }));

test("Connector: Parameter kurzplan_lehrkraft (Schema und Beschreibung), Hinweise in update_lesson, save_schulportal_entry/save_verlaufsplan und save_selbstlern; die Anweisungen bleiben unverändert", async () => {
  const c = await base();
  const tools = (await mcp(c, "tools/list", {})).tools, by = (n) => tools.find((t) => t.name === n);
  const p = by("update_lesson").inputSchema.properties.kurzplan_lehrkraft;
  assert.deepEqual([p.type, p.maxItems, p.items.required, p.items.properties.phase.type, p.items.properties.anweisungen.minItems, p.items.properties.anweisungen.maxItems,
    p.items.properties.anweisungen.items.maxLength, p.items.additionalProperties], ["array", 20, ["phase", "anweisungen"], "integer", 1, 3, 240, false]);
  for (const s of ["„Kurzplan für die Lehrkraft“ (nie für Schüler:innen oder Eltern sichtbar)", "phase = die Nummer der Phase, wie sie dort steht („**3) Partnerarbeit**“ → 3)",
    "anweisungen = 1 bis 3 kurze, klare Anweisungen", "in der dritten Person, konkret und knapp", "„Lehrkraft liest den Erzähltext ‚Josef‘ bis Nr. 3 vor und legt dabei die Bildkarten 1–3 hin.“",
    "„Lehrkraft erklärt kurz, was Martin Luther am Ablasshandel kritisiert hat.“", "Schlichter Text ohne Schulportal-Zeichen und ohne Verweise [[pdf:…]]", "[] löscht ihn"]) assert.ok(p.description.includes(s), s);
  assert.ok(by("update_lesson").description.includes("Mit kurzplan_lehrkraft speicherst du den „Kurzplan für die Lehrkraft“"));
  for (const n of ["save_schulportal_entry", "save_verlaufsplan"]) assert.ok(by(n).description.includes("und den „Kurzplan für die Lehrkraft“ (kurzplan_lehrkraft)."), n);
  assert.ok(by("save_selbstlern").description.includes("und den „Kurzplan für die Lehrkraft“ (kurzplan_lehrkraft) änderst du dabei nicht"));
  const init = await mcp(c, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.ok(!init.instructions.includes("Kurzplan"), "die Anweisungen werden nicht länger (gekürzte Clients)");
});

test("Gymnasium: update_lesson speichert (Fingerabdruck, Zeitpunkt) und meldet sich kurz; Fehler ohne Änderung; [] löscht; get_lesson-Abschnitt samt Hinweis nach geänderter Planung; Erinnerung beim Speichern", async () => {
  const c = await base();
  const l = await L.createLesson(c.db, { subject: "powi", klass: "8B", title: "Gewaltenteilung", date: "2026-11-24", startTime: "08:00", durationMin: 45 }, c.now);
  let g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes("\n## Kurzplan für die Lehrkraft (zeigt Unterricks nur in „Ich bin jetzt im Unterricht“)\n(noch keiner – schreibe ihn mit update_lesson und kurzplan_lehrkraft, sobald du die Planung dieser Sitzung ablegst: je Phase des Schulportal-Eintrags 1–3 kurze Anweisungen, was die Lehrkraft tut)\n"));
  assert.ok(g.text.indexOf("## Kurzplan für die Lehrkraft") > g.text.indexOf("## " + S.TEACHER_SUMMARY_TITLE) && g.text.indexOf("## Kurzplan für die Lehrkraft") < g.text.indexOf("## Planungsverlauf"));
  // vor dem Schulportal-Eintrag: gespeichert, aber mit Hinweis
  let r = await tool(c, "update_lesson", { lesson_id: l.id, kurzplan_lehrkraft: ARGS });
  assert.ok(!r.isError && r.text.includes("Achtung: Der Schulportal-Eintrag hat noch keine nummerierten Phasen („**1) …**“) – speichere zuerst den Schulportal-Eintrag (save_schulportal_entry) und danach den Kurzplan erneut."), r.text);
  await tool(c, "save_schulportal_entry", { lesson_id: l.id, text: PORTAL });
  r = await tool(c, "update_lesson", { lesson_id: l.id, kurzplan_lehrkraft: ARGS });
  assert.deepEqual([r.isError, r.text], [false, "Gespeichert. Kurzplan für die Lehrkraft gespeichert (4 Phasen, 5 Anweisungen) – Unterricks zeigt ihn der Lehrkraft nur in „Ich bin jetzt im Unterricht“."]);
  assert.deepEqual(stored(c, l.id), { v: 1, phases: KP, plan: S.planFingerprint(PORTAL), at: NOW });
  assert.deepEqual(r.data.lesson.teacherPlan, { phases: KP, plan: S.planFingerprint(PORTAL), at: NOW });
  g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes("- Phase 2: Lehrkraft teilt den Code aus. | Lehrkraft geht herum und hilft.\n- Phase 3: Lehrkraft schreibt das Tafelbild mit.\n- Phase 4: Lehrkraft leitet die Diskussion.\n(Stand: 20.11.2026, 11:00 Uhr)\n"), g.text);
  assert.ok(!g.text.includes("automatisch gekürzte Fassung"));
  // Zwischenstopp: keine Erinnerung; geänderter Eintrag: Erinnerung (vor der zur Zusammenfassung) und Hinweis in get_lesson
  r = await tool(c, "save_schulportal_entry", { lesson_id: l.id, text: S.insertStop(PORTAL, 7).text });
  assert.ok(!r.text.includes("Kurzplan"), r.text);
  r = await tool(c, "save_schulportal_entry", { lesson_id: l.id, text: PORTAL + "\n- Zusatz" });
  assert.ok(r.text.startsWith("Schulportal-Eintrag gespeichert (Version 3). Der „Kurzplan für die Lehrkraft“ passt nicht mehr zur neuen Planung – schreibe ihn zum Schluss mit update_lesson (kurzplan_lehrkraft) neu. Schreibe zum Schluss auch die „"), r.text);
  assert.ok((await tool(c, "get_lesson", { lesson_id: l.id })).text.includes("Achtung: Der Schulportal-Eintrag wurde danach geändert – Unterricks zeigt solange eine automatisch gekürzte Fassung. Schreibe den Kurzplan mit update_lesson (kurzplan_lehrkraft) neu, wenn du die Planung überarbeitest."));
  // Phasen, die es nicht gibt bzw. ohne Anweisungen; Zeichen im Text
  r = await tool(c, "update_lesson", { lesson_id: l.id, kurzplan_lehrkraft: [{ phase: 1, anweisungen: ["Lehrkraft zeigt die **Karikatur**."] }, { phase: 6, anweisungen: ["x"] }] });
  assert.ok(r.text.includes("Achtung: Phase 6 gibt es im Schulportal-Eintrag nicht (dort: 1, 2, 3, 4) – solange zeigt Unterricks eine automatisch gekürzte Fassung.") &&
    r.text.includes("Achtung: Der Kurzplan erscheint als schlichter Text – schreibe ihn ohne Schulportal-Zeichen und ohne Verweise [[pdf:…]] (Material mit seinem Titel)."), r.text);
  assert.ok((await tool(c, "get_lesson", { lesson_id: l.id })).text.includes("Achtung: Phase 6 gibt es im Schulportal-Eintrag nicht"));
  r = await tool(c, "update_lesson", { lesson_id: l.id, kurzplan_lehrkraft: ARGS.slice(0, 2) });
  assert.ok(r.text.endsWith("Ohne Anweisungen: Phasen 3 und 4 – dort zeigt Unterricks die unterstrichenen Aufforderungen an die Lehrkraft bzw. den ersten Stichpunkt."), r.text);
  // Fehler: nichts geändert
  const before = stored(c, l.id);
  for (const [args, msg] of [[[{ phase: 2, anweisungen: ["x".repeat(241)] }], "kurzplan_lehrkraft: Eintrag 1 (Phase 2): Anweisung 1 ist zu lang (241 Zeichen, höchstens 240) – bitte kürzen."],
    [[{ phase: 1, anweisungen: ["a"] }, { phase: 1, anweisungen: ["b"] }], "kurzplan_lehrkraft: Eintrag 2 (Phase 1): Diese Phase steht doppelt – fasse ihre Anweisungen in einem Eintrag zusammen."],
    ["Phase 1: Karikatur", "kurzplan_lehrkraft: kurzplan_lehrkraft ist eine Liste [{phase, anweisungen}] ([] löscht den Kurzplan)."]]) {
    r = await tool(c, "update_lesson", { lesson_id: l.id, thema: "Neu", kurzplan_lehrkraft: args });
    assert.deepEqual([r.isError, r.text], [true, msg]);
  }
  assert.deepEqual(stored(c, l.id), before);
  assert.equal((await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.lesson.topic, l.topic, "auch die übrigen Felder bleiben (nie halb gespeichert)");
  // andere Felder ohne kurzplan_lehrkraft: Rückmeldung wie bisher; [] löscht
  assert.equal((await tool(c, "update_lesson", { lesson_id: l.id, thema: "Gewaltenteilung im GG" })).text, "Gespeichert.");
  r = await tool(c, "update_lesson", { lesson_id: l.id, kurzplan_lehrkraft: [] });
  assert.deepEqual([r.isError, r.text, stored(c, l.id)], [false, "Gespeichert. Kurzplan für die Lehrkraft gelöscht.", null]);
  // Selbstlern-Phase: der Kurzplan beschreibt die ursprüngliche Planung (kein Hinweis „danach geändert“, keine Erinnerung)
  await tool(c, "update_lesson", { lesson_id: l.id, kurzplan_lehrkraft: ARGS });
  c.db.raw.prepare("INSERT INTO substitutes(lesson_id, status, proposal, archive, created_at, updated_at) VALUES(?, 'selbstlern', '{}', '{}', ?, ?)").run(l.id, c.now, c.now);
  g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes("Für diese Sitzung gilt die Selbstlern-Phase – der Kurzplan beschreibt die ursprüngliche Planung."));
  assert.ok(!(await tool(c, "save_schulportal_entry", { lesson_id: l.id, text: "**1) Stationen**" })).text.includes("Kurzplan"));
});

test("Connector, Befunde der Gegenprüfung: Phasen ohne Inhalt nicht unter „Ohne Anweisungen“; get_lesson fordert in einer Selbstlern-Phase bzw. bestätigten Vertretung keinen Kurzplan an", async () => {
  const c = await base();
  const l = await L.createLesson(c.db, { subject: "powi", klass: "9C", title: "Bundesverfassungsgericht", date: "2026-11-24", startTime: "08:00", durationMin: 45 }, c.now);
  const tpl = "**1) TOP 10**\n\n**2) Blitzlicht ohne iPad**\n- Einstieg: ~~Wie kann man sich helfen, wenn Demokratiefeinde regieren?~~\n\n**3) Partnerarbeit**\n- Aufgabe 4 besprechen";
  await tool(c, "save_schulportal_entry", { lesson_id: l.id, text: tpl });
  let r = await tool(c, "update_lesson", { lesson_id: l.id, kurzplan_lehrkraft: [{ phase: 2, anweisungen: ["Lehrkraft stellt die Einstiegsfrage."] }] });
  assert.ok(r.text.endsWith("Ohne Anweisungen: Phase 3 – dort zeigt Unterricks die unterstrichenen Aufforderungen an die Lehrkraft bzw. den ersten Stichpunkt."), r.text);
  r = await tool(c, "update_lesson", { lesson_id: l.id, kurzplan_lehrkraft: [{ phase: 2, anweisungen: ["Lehrkraft stellt die Einstiegsfrage."] }, { phase: 3, anweisungen: ["Lehrkraft bespricht Aufgabe 4."] }] });
  assert.equal(r.text, "Gespeichert. Kurzplan für die Lehrkraft gespeichert (2 Phasen, 2 Anweisungen) – Unterricks zeigt ihn der Lehrkraft nur in „Ich bin jetzt im Unterricht“.", "TOP 10 ohne Inhalt fehlt nicht");
  await tool(c, "update_lesson", { lesson_id: l.id, kurzplan_lehrkraft: [] });
  const head = "\n## Kurzplan für die Lehrkraft (zeigt Unterricks nur in „Ich bin jetzt im Unterricht“)\n";
  c.db.raw.prepare("INSERT INTO substitutes(lesson_id, status, proposal, created_at, updated_at) VALUES(?, 'selbstlern', '{}', ?, ?)").run(l.id, c.now, c.now);
  let g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes(head + "(keiner – für diese Sitzung gilt die Selbstlern-Phase; den Kurzplan schreibst du dabei nicht)\n"), g.text.slice(g.text.indexOf("## Kurzplan"), g.text.indexOf("## Kurzplan") + 200));
  c.db.raw.prepare("UPDATE substitutes SET status='aktiv' WHERE lesson_id=?").run(l.id);
  g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes(head + "(keiner – für diese Sitzung gilt die bestätigte Vertretungsstunde; den Kurzplan schreibst du dabei nicht)\n"));
  assert.ok(!g.text.includes("(noch keiner – schreibe ihn mit update_lesson und kurzplan_lehrkraft"));
});

test("Grundschule: get_lesson-Abschnitt (Verlaufsplan), Erinnerung von save_verlaufsplan nur bei unpassendem Kurzplan; Ausfall-Eintrag ohne Abschnitt und abgelehnt", async () => {
  const c = await base();
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/x", { grade: 2, classes: ["a", "b"], religion: true, weekdays: [{ day: 1, minutes: 45, time: "09:50" }], classSize: 22 })).data.course;
  const l = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Josef", date: "2026-11-23", startTime: "09:50", durationMin: 45 }, c.now);
  const plan = "**1) Ankommen im Sitzkreis (5 Min.)**\n- Lied\n**2) Erzählung (15 Min., Sitzkreis)**\n- Josef und seine Brüder";
  let g = await tool(c, "get_lesson", { lesson_id: l.id });
  assert.ok(g.text.includes("(noch keiner – schreibe ihn mit update_lesson und kurzplan_lehrkraft, sobald du die Planung dieser Sitzung ablegst: je Phase des Verlaufsplans 1–3 kurze Anweisungen, was die Lehrkraft tut)"));
  assert.ok(g.text.indexOf("## Kurzplan für die Lehrkraft") < g.text.indexOf("## Inhalt der Unterrichtsstunde (für die Eltern)"));
  let r = await tool(c, "save_verlaufsplan", { lesson_id: l.id, text: plan });
  assert.ok(!r.text.includes("Kurzplan"), "ohne Kurzplan: Antwort wie bisher");
  r = await tool(c, "update_lesson", { lesson_id: l.id, kurzplan_lehrkraft: [{ phase: 1, anweisungen: ["Lehrkraft stimmt das Begrüßungslied an."] }, { phase: 2, anweisungen: ["Lehrkraft erzählt bis Nr. 3 und legt die Bildkarten 1–3 hin."] }] });
  assert.equal(r.text, "Gespeichert. Kurzplan für die Lehrkraft gespeichert (2 Phasen, 2 Anweisungen) – Unterricks zeigt ihn der Lehrkraft nur in „Ich bin jetzt im Unterricht“.");
  r = await tool(c, "save_verlaufsplan", { lesson_id: l.id, text: plan });
  assert.ok(!r.text.includes("Kurzplan"), "passt: Antwort wie bisher");
  r = await tool(c, "save_verlaufsplan", { lesson_id: l.id, text: plan + "\n**3) Malen (20 Min.)**" });
  assert.ok(r.text.includes(" Der „Kurzplan für die Lehrkraft“ passt nicht mehr zur neuen Planung – schreibe ihn zum Schluss mit update_lesson (kurzplan_lehrkraft) neu."), r.text);
  assert.ok((await tool(c, "get_lesson", { lesson_id: l.id })).text.includes("Achtung: Der Verlaufsplan wurde danach geändert – Unterricks zeigt solange eine automatisch gekürzte Fassung."));
  c.db.raw.prepare("UPDATE lessons SET cancelled=1 WHERE id=?").run(l.id);
  assert.ok(!(await tool(c, "get_lesson", { lesson_id: l.id })).text.includes("Kurzplan"));
  assert.equal((await tool(c, "update_lesson", { lesson_id: l.id, kurzplan_lehrkraft: [] })).isError, true);
});

test("Sitzungsseite (PATCH): teacherPlan gespeichert bzw. abgelehnt; GET liefert ihn der Lehrkraft, die Liste der Sitzungen nicht; eine Sitzung nur mit Kurzplan ist nicht „leer“", async () => {
  const c = await base();
  const l = await L.createLesson(c.db, { subject: "evrel", klass: "8-K", title: "Psalmen", date: "2026-11-24", startTime: "08:00" }, c.now);
  await L.savePortal(c.db, l.id, "**1) Einstieg**\n- Psalm 23", null, "lehrkraft", c.now);
  const patch = (body) => call(c, L.routeLessonPatch, "PATCH", "/x", body, l.id);
  let r = await patch({ teacherPlan: [{ n: 1, steps: ["Lehrkraft liest Psalm 23 vor."] }] });
  assert.deepEqual([r.status, r.data.lesson.teacherPlan], [200, { phases: [{ n: 1, steps: ["Lehrkraft liest Psalm 23 vor."] }], plan: S.planFingerprint("**1) Einstieg**\n- Psalm 23"), at: NOW }]);
  for (const bad of [{ n: 1 }, [{ n: 1, steps: [] }], [{ n: 0, steps: ["x"] }], [{ n: 1, steps: ["x"] }, { n: 1, steps: ["y"] }], Array.from({ length: 21 }, (_, i) => ({ n: i + 1, steps: ["x"] })),
    // streng wie der Connector (Befund der Gegenprüfung): nie still auf 3 Anweisungen bzw. 240 Zeichen gekürzt, nichts still verworfen
    [{ n: 1, steps: ["a", "b", "c", "d"] }], [{ n: 1, steps: ["x".repeat(241)] }], [{ n: 1, steps: ["a", 7] }], [{ n: 1, steps: ["a", "  "] }], [{ n: 1, steps: ["a"] }, null]])
    assert.equal((await patch({ teacherPlan: bad })).status, 400, JSON.stringify(bad).slice(0, 60));
  assert.equal((await patch({ teacherPlan: [{ n: 1, steps: ["x".repeat(241)] }] })).data.error,
    "Der Kurzplan für die Lehrkraft ist ungültig: Eintrag 1 (Phase 1): Anweisung 1 ist zu lang (241 Zeichen, höchstens 240) – bitte kürzen.");
  assert.equal((await patch({ teacherPlan: [{ n: 1, steps: ["  Lehrkraft liest\n Psalm 23 vor. "] }] })).data.lesson.teacherPlan.phases[0].steps[0], "Lehrkraft liest Psalm 23 vor.", "Leerraum zusammengefasst");
  assert.equal(stored(c, l.id).phases[0].steps[0], "Lehrkraft liest Psalm 23 vor.");
  assert.deepEqual((await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.lesson.teacherPlan.phases, [{ n: 1, steps: ["Lehrkraft liest Psalm 23 vor."] }]);
  const list = await call(c, L.routeLessonsList, "GET", "/api/teacher/lessons?subject=evrel&klass=8-K");
  assert.ok(!JSON.stringify(list.data).includes("Psalm 23 vor") && !("teacherPlan" in list.data.lessons[0]));
  assert.equal((await patch({ teacherPlan: null })).data.lesson.teacherPlan, null);
  // „leer“ beim Überarbeiten einer Einheit (EMPTY_LESSON): eine Sitzung nur mit Kurzplan fällt nicht weg
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/x", { grade: 2, classes: ["a"], religion: true, weekdays: [{ day: 2, minutes: 45, time: "08:00" }] })).data.course;
  const u = (await call(c, U.routeUnitCreate, "POST", "/x", { subject: "gs", klass: course.id, title: "Josef", params: { start: "2026-11-24", end: "2026-11-24", weekdays: [{ day: 2, minutes: 45, time: "08:00" }] } })).data.unit;
  const empty = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Leer", date: "2026-11-24", unitId: u.id, unitRow: "aaaaaaaa" }, c.now);
  c.db.raw.prepare("DELETE FROM chat WHERE lesson_id=?").run(empty.id);
  assert.equal((await U.linkedLessons(c.db, u.id, true))[0].hasContent, false);
  await call(c, L.routeLessonPatch, "PATCH", "/x", { teacherPlan: [{ n: 1, steps: ["Nur der Kurzplan."] }] }, empty.id);
  assert.equal((await U.linkedLessons(c.db, u.id, true))[0].hasContent, true);
});

test("Nie für Schüler:innen, Eltern, Beamer oder Vertretung: Code einlösen, Schüleransicht (auch einer Selbstlern-Phase), Elternansicht samt Vorschau; nur bestimmte Module kennen den Kurzplan", async () => {
  const c = await base();
  const secret = [{ n: 1, steps: ["KURZPLANGEHEIM Lehrkraft verteilt die Lösung."] }];
  const day = new Date(c.now - 864e5).toISOString().slice(0, 10);
  const l = await L.createLesson(c.db, { subject: "powi", klass: "Q2-GK", title: "Gewaltenteilung", date: day, startTime: "08:00", durationMin: 90 }, c.now - 2 * 864e5);
  await call(c, L.routeLessonPatch, "PATCH", "/x", { teacherPlan: secret, homework: "Lies M3." }, l.id);
  c.db.raw.prepare("INSERT INTO student_devices(id, token_hash, klass, subject, created_at, last_seen, auth_until) VALUES(?, ?, 'Q2-GK', 'powi', ?, ?, ?)").run(DEV, await sha256Hex(STOKEN), c.now, c.now, c.now + 3600e3);
  const join = await scall(c, ST.routeStudentJoin, "POST", "/api/student/join", { code: l.code });
  const sv = await scall(c, ST.routeStudentLesson, "GET", "/x", undefined, l.id), me = await scall(c, ST.routeStudentMe, "GET", "/api/student/me");
  assert.deepEqual([join.status, sv.status, me.status], [200, 200, 200]);
  // Selbstlern-Phase (die Schüler:innen sehen dann Stationen statt der Sitzung)
  c.db.raw.prepare("INSERT INTO substitutes(lesson_id, status, proposal, archive, created_at, updated_at) VALUES(?, 'selbstlern', ?, '{}', ?, ?)")
    .run(l.id, JSON.stringify({ v: 1, stationen: [{ titel: "Lesen", typ: "aufgabe", anleitung: "Lies M1." }] }), c.now, c.now);
  const sl = await scall(c, ST.routeStudentLesson, "GET", "/x", undefined, l.id);
  for (const x of [join.data, sv.data, me.data, sl.data]) assert.ok(!JSON.stringify(x).includes("KURZPLANGEHEIM") && !JSON.stringify(x).includes("teacherPlan"));
  const course = (await call(c, GS.routeGsCourseCreate, "POST", "/x", { grade: 3, classes: ["b"], religion: true, weekdays: [{ day: 2, minutes: 45, time: "08:00" }] })).data.course;
  const gl = await L.createLesson(c.db, { subject: "gs", klass: course.id, title: "Mose", date: day, startTime: "08:00", durationMin: 45 }, c.now - 2 * 864e5);
  await call(c, L.routeLessonPatch, "PATCH", "/x", { teacherPlan: secret, parentSummary: "Wir haben von Mose gehört." }, gl.id);
  const tok = (await call(c, PA.routeTeacherParentLink, "POST", "/x", {}, gl.id)).data.token;
  const outs = [await pub(c, PA.routeParentLesson, "POST", "/x", { token: tok }), await pub(c, PA.routeParentPrevious, "POST", "/x", { token: tok }),
    await call(c, PA.routeTeacherParentPreview, "GET", "/x", undefined, gl.id), await call(c, PA.routeTeacherParentPrevious, "GET", "/x", undefined, gl.id)];
  assert.ok(outs.every((x) => x.status === 200) && JSON.stringify(outs[0].data).includes("Wir haben von Mose gehört."));
  for (const x of outs) assert.ok(!JSON.stringify(x.data).includes("KURZPLANGEHEIM"));
  // im Quelltext: nur diese Module kennen den Kurzplan – Schüler-, Eltern-, Beamer-, Live- und Vertretungsrouten bzw. -seiten nie; „Alle Unterlagen
  // dieser Sitzung“ (lessonzip.js) und der Podcast nehmen ihn nicht mit
  const { readdirSync, readFileSync } = await import("node:fs");
  const root = new URL("../../", import.meta.url), uses = [];
  for (const dir of ["worker", "public"]) for (const f of readdirSync(new URL(dir + "/", root)).filter((x) => x.endsWith(".js")).sort())
    if (/teacher_plan|teacherPlan|kurzplan_lehrkraft/.test(readFileSync(new URL(dir + "/" + f, root), "utf8"))) uses.push(dir + "/" + f);
  assert.deepEqual(uses, ["worker/db.js", "worker/lessons.js", "worker/mcp.js", "worker/units.js",
    "public/gsplanning.js", "public/gssession.js", "public/inclass.js", "public/inclasslib.js", "public/planning.js", "public/session.js", "public/sessionfile.js", "public/sessionio.js", "public/teacherplan.js"]);
});

test("Sitzungsdatei und Sicherung: der Kurzplan kommt mit (veraltet bleibt veraltet), ohne Kurzplan in der Datei wird ein bisheriger gelöscht", async () => {
  const IO = await import("../../public/sessionio.js");
  const detail = (lesson) => ({ lesson: { id: "l1", subject: "powi", klass: "8B", title: "Macht", topic: "Macht", date: "2026-11-17", nextDate: "2026-11-19", portal: PORTAL, ...lesson }, files: [], drafts: [], sheets: [], messages: [] });
  const read = async (lesson) => (await IO.readSessionZip((await IO.buildSessionZip(detail(lesson), { fb: null })).bytes)).data;
  let data = await read({});
  assert.ok(!("teacherPlan" in data.lesson), "ohne Kurzplan bleibt die Datei, wie sie war");
  data = await read({ teacherPlan: tpOf(KP) });
  assert.deepEqual([data.lesson.teacherPlan, data.lesson.teacherPlanOutdated], [KP, undefined]);
  data = await read({ teacherPlan: tpOf(KP, "**1) Früher**") });
  assert.equal(data.lesson.teacherPlanOutdated, true);
  assert.deepEqual(SF.cleanSessionFile({ kind: SF.SESSION_FILE.kind, v: SF.SESSION_FILE.v, source: {}, lesson: { teacherPlan: [{ n: 1, steps: ["a", "b", "c", "d"] }, { n: "x" }], teacherPlanOutdated: "ja" } }).lesson.teacherPlan,
    [{ n: 1, steps: ["a", "b", "c"] }]);
  // Laden: Datumsangaben angepasst, Fingerabdruck des Eintrags aus der Datei bzw. veraltet
  const c = await base();
  const l = await L.createLesson(c.db, { subject: "powi", klass: "9C", title: "Wahlen", date: "2026-11-24" }, c.now);
  const cur = (await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.lesson;
  const fresh = await read({ teacherPlan: tpOf([{ n: 1, steps: ["Lehrkraft sammelt die Hausaufgabe vom 17.11.2026 ein."] }]) });
  let p = IO.planSessionImport(fresh, cur);
  assert.deepEqual(p.lesson.teacherPlan, [{ n: 1, steps: ["Lehrkraft sammelt die Hausaufgabe vom 24.11.2026 ein."] }], "Datum an die Sitzung angepasst");
  await call(c, L.routeLessonImport, "POST", "/x", { lesson: p.lesson, chat: [] }, l.id);
  let imp = (await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.lesson;
  assert.deepEqual([imp.teacherPlan.plan, imp.teacherPlan.phases.length], [S.planFingerprint(PORTAL), 1]);
  assert.equal(TP.teacherPlanFits(imp.teacherPlan, imp.portal).fits, true);
  p = IO.planSessionImport(await read({ teacherPlan: tpOf(KP, "**1) Früher**") }), cur);
  await call(c, L.routeLessonImport, "POST", "/x", { lesson: p.lesson, chat: [] }, l.id);
  imp = (await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.lesson;
  assert.deepEqual([imp.teacherPlan.plan, TP.teacherPlanFits(imp.teacherPlan, imp.portal).why], [S.PLAN_FINGERPRINT_STALE, "changed"]);
  p = IO.planSessionImport(await read({}), cur);
  assert.deepEqual(p.lesson.teacherPlan, []);
  await call(c, L.routeLessonImport, "POST", "/x", { lesson: p.lesson, chat: [] }, l.id);
  assert.equal((await call(c, L.routeLessonGet, "GET", "/x", undefined, l.id)).data.lesson.teacherPlan, null, "ohne Kurzplan in der Datei: gelöscht");
});

/* ---------- Oberfläche: kompakte Liste in „Ich bin jetzt im Unterricht“ (DOM-Nachbildung) ---------- */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
async function until(cond, what) { for (let i = 0; i < 1500; i++) { if (cond()) return; await D.sleep(2); } assert.fail("nicht eingetreten: " + what); }
const PH = [1, 1, 2, 2, 3, null, 4, null];
const PRES = { id: "aaaaaaaaaaaaaaaa", area: "presentation", kind: "file", name: "Gewaltenteilung.pdf", status: "ready", pages: 8, phases: { pdf: PH, hand: null, auto: null } };

test("Gymnasium: kompakte Liste – je Phase ein Block mit der Zeile der Überschrift, Anweisungen darunter, Satz zur Fassung; Pfeil am Block; Kontextmenü vor die Phase; vollständiger Verlaufsplan zugeklappt", async () => {
  if (globalThis.__leave) globalThis.__leave();
  let text = PORTAL, plan = tpOf(KP);
  const menu = [], on = { plan: new Set(), files: new Set() };
  globalThis.__tapi = async (method, path) => {
    if (method === "GET" && /\/live$/.test(path)) return { live: { t: "state", active: true, slide: 3, pages: 8, fileId: PRES.id } };
    throw new ApiError("nicht nachgebildet: " + method + " " + path, 404, { code: "not_found" });
  };
  const api = { kind: "gym", id: "0123456789abcdef", st: { files: [PRES], sheets: [] }, selbstlern: () => false, on: (k, fn) => { on[k].add(fn); return () => on[k].delete(fn); },
    planText: () => text, paintPlan: (box) => PV.paintPortalPreview(box, text), planState: null, teacherPlan: () => plan,
    stopMenu: (line) => menu.push(line), insertStop: () => {}, dropStop: () => {}, stopNext: () => null, openActs: () => ({ acts: [], meta: "" }),
    homework: document.createElement("section"), annotated: () => null, pres: () => PRES, startLive: () => {} };
  const v = IC.inClassView(api);
  const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove(); app.append(v.el);
  const emit = () => { for (const f of on.plan) f(); };
  try {
    const box = $("#ic-plan"), blocks = () => $$("#ic-plan .icp-phase");
    assert.ok(box.classList.contains("ic-compact"));
    assert.deepEqual(blocks().map((b) => [b.dataset.line, $(".icp-head", b).textContent, $$(".icp-step", b).map((x) => x.textContent)]), [
      ["0", "1) Einstieg", ["Lehrkraft zeigt die Karikatur und fragt: Wer hat hier die Macht?"]], ["3", "2) Partnerarbeit", ["Lehrkraft teilt den Code aus.", "Lehrkraft geht herum und hilft."]],
      ["7", "3) Sicherung", ["Lehrkraft schreibt das Tafelbild mit."]], ["12", "4) Diskussion", ["Lehrkraft leitet die Diskussion."]]]);
    assert.equal($(".icp-head", blocks()[0]).tagName, "P", "die Überschrift ist ein Absatz …");
    assert.equal($(".icp-head strong", blocks()[0]).textContent, "1) Einstieg", "… fett wie im Eintrag");
    assert.deepEqual([$("#ic-plan .icp-next").dataset.line, $("#ic-plan .icp-next").textContent], ["10", "--> Nächste Stunde"]);
    assert.equal($("#ic-plan-src").textContent, "Kurzplan von Claude");
    assert.ok(!$("#ic-plan-src").classList.contains("hidden") && $("#ic-plan-src").classList.contains("ic-fromclaude"));
    // vollständiger Verlaufsplan: zugeklappt, mit eigenen Zeilen (Kontextmenü dort je Zeile)
    const more = $("#ic-plan-more");
    assert.deepEqual([more.tagName, more.hasAttribute("open"), more.classList.contains("hidden"), $("summary", more).textContent], ["DETAILS", false, false, IL.FULL_PLAN_LABEL]);
    assert.equal(IL.FULL_PLAN_LABEL, "Vollständigen Verlaufsplan anzeigen");
    assert.ok($$("#ic-plan-full li").some((li) => li.textContent === "Feibeitsblatt Gewaltenteilung") && $("#ic-plan-full .icp-phase") === null);
    D.fire($$("#ic-plan-full li").find((li) => li.textContent === "Tafelbild"), "contextmenu", { clientX: 5, clientY: 5 });
    assert.deepEqual(menu.splice(0), [8], "im vollständigen Verlaufsplan die Zeile selbst");
    // Kontextmenü in der kompakten Liste: auch auf einer Anweisung die Zeile der Überschrift (der Zwischenstopp kommt vor die Phase)
    D.fire($$(".icp-step", blocks()[1])[1], "contextmenu", { clientX: 5, clientY: 5 });
    D.fire($(".icp-head", blocks()[2]), "contextmenu", { clientX: 5, clientY: 5 });
    assert.deepEqual(menu.splice(0), [3, 7]);
    // Pfeil (Live-Stand Folie 3 → Phase 2): am Block der Phase, die ganze Phase hinterlegt
    await until(() => !!$("#ic-plan .ic-now"), "Pfeil");
    const now = $("#ic-plan .ic-now");
    assert.deepEqual([now.dataset.line, now.classList.contains("icp-phase"), now.firstChild.classList.contains("phasearrow"), $(".icp-head", now).textContent], ["3", true, true, "2) Partnerarbeit"]);
    // Zwischenstopp vor Phase 3: Feld an seiner Stelle, danach das Abdeckblatt; der Pfeil bleibt
    text = S.insertStop(PORTAL, 7).text; emit();
    assert.equal($$("#ic-plan .stopfield").length, 1);
    assert.equal($("#ic-plan .icp-stop").dataset.line, "7");
    assert.deepEqual($$("#ic-plan .covered .icp-phase").map((b) => b.dataset.line), ["8", "13"]);
    assert.equal($("#ic-plan .ic-now").dataset.line, "3");
    D.fire($("#ic-plan .icp-stop .stopfield"), "contextmenu", { clientX: 5, clientY: 5 });
    assert.deepEqual(menu.splice(0), [7], "auf dem Zwischenstopp: seine Zeile (→ „Zwischenstopp entfernen“)");
    // Zwischenstopp mitten in Phase 2 (Befund der Gegenprüfung): die Anweisungen von Claude bleiben mit Hinweis darüber, die offene Aufforderung an die
    // Lehrkraft steht als „(Fortsetzung)“ unter dem Abdeckblatt – nie offen über dem Zwischenstopp
    text = S.insertStop(PORTAL, 5).text; emit();
    const p2 = blocks().find((b) => b.dataset.line === "3");
    assert.ok(!p2.closest(".covered"));
    assert.deepEqual([$$(".icp-step", p2).map((x) => x.textContent), $(".icp-partial", p2).textContent], [["Lehrkraft teilt den Code aus.", "Lehrkraft geht herum und hilft."], IL.COMPACT_PARTIAL]);
    const cont = $("#ic-plan .covered .icp-cont");
    assert.deepEqual([cont.dataset.line, cont.dataset.phase, $(".icp-head", cont).textContent, $(".icp-head .icp-contmark", cont).textContent, $$(".icp-step", cont).map((x) => x.textContent)],
      ["6", "2", "2) Partnerarbeit (Fortsetzung)", " (Fortsetzung)", ["Lehrkraft geht herum und hilft bei Aufgabe 2."]]);
    assert.equal($$("#ic-plan .icp-partial").length, 1, "nur der Block der geteilten Phase");
    assert.equal($("#ic-plan .ic-now").dataset.line, "3", "der Pfeil bleibt am Block der Phase über dem Zwischenstopp");
    D.fire($(".icp-step", cont), "contextmenu", { clientX: 5, clientY: 5 });
    assert.deepEqual(menu.splice(0), [6], "in der Fortsetzung: ihre erste Zeile (der Zwischenstopp bleibt davor)");
    // Name und Beschreibung der Liste (Befund der Gegenprüfung): kompakt, beschrieben vom Satz darüber
    assert.deepEqual([box.getAttribute("aria-label"), box.getAttribute("aria-describedby")], ["Verlaufsplan kompakt (Schulportal-Eintrag)", "ic-plan-src"]);
    // Planung geändert: automatisch gekürzt (unterstrichene Aufforderung bzw. erster Stichpunkt), Satz nennt den Grund
    text = PORTAL + "\n- Zusatz: Argumentationswippe"; emit();
    assert.equal($("#ic-plan-src").textContent, "Automatisch gekürzt – der Kurzplan von Claude passt nicht mehr zum geänderten Schulportal-Eintrag.");
    assert.ok(!$("#ic-plan-src").classList.contains("ic-fromclaude"));
    assert.deepEqual(blocks().map((b) => $$(".icp-step", b).map((x) => x.textContent + (x.classList.contains("icp-gist") ? " (Stichpunkt)" : ""))), [["Karikatur Wer hat die Macht? (Stichpunkt)"],
      ["Lehrkraft geht herum und hilft bei Aufgabe 2."], ["Tafelbild (Stichpunkt)"], ["Ist das Bundesverfassungsgericht zu mächtig? Erst in Partnerarbeit Argumente finden, dann im Plenum auf der … (Stichpunkt)"]]);
    assert.equal($$("#ic-plan u").length, 0, "Aufforderungen ohne Unterstreichung");
    assert.ok($("#ic-plan-full").textContent.includes("Zusatz: Argumentationswippe"), "der vollständige Verlaufsplan hat den neuen Stand");
    // Kurzplan neu (Seite meldet „plan“): wieder von Claude
    plan = tpOf(KP, text); emit();
    assert.equal($("#ic-plan-src").textContent, "Kurzplan von Claude");
    // ohne nummerierte Phasen: wie bisher der vollständige Verlaufsplan, ohne Satz und ohne Aufklapper
    text = "Einstieg mit Karikatur\n- Gespräch"; emit();
    assert.ok(!box.classList.contains("ic-compact") && $("#ic-plan-src").classList.contains("hidden") && more.classList.contains("hidden"));
    assert.deepEqual($$("#ic-plan [data-line]").map((x) => x.dataset.line), ["0", "1"]);
    assert.equal($("#ic-plan-full").childNodes.length, 0);
    assert.deepEqual([box.getAttribute("aria-label"), box.hasAttribute("aria-describedby")], ["Verlaufsplan (Schulportal-Eintrag)", false]);
  } finally { v.destroy(); }
  assert.equal((globalThis.__domErrors || []).length, 0, (globalThis.__domErrors || []).join("\n"));
});

test("Grundschule (Sitzungsseite): automatisch gekürzt mit dem gelben Verweis der Aufforderung, alle Verweise im vollständigen Verlaufsplan; beim Zurückkehren in den Tab kommt der Kurzplan von Claude", async () => {
  if (globalThis.__leave) globalThis.__leave();
  document.querySelectorAll(".modal-back, .ctxmenu").forEach((x) => x.remove());
  resetPrintQueue();
  const plan = "**1) Ankommen im Sitzkreis (5 Min.)**\n- Begrüßungslied\n**2) Erzählung (15 Min., Sitzkreis)**\n- __Lehrkraft liest [[pdf:" + FV + "|Vorlesetext]] vor.__\n- Bildkarten [[pdf:" + FC + "]] in die Mitte legen\n" +
    "**3) Arbeitsblatt (15 Min., Einzelarbeit)**\n- [[pdf:" + FA + "]]\n**4) Abschluss (5 Min.)**\n- Lied";
  const pdf = (id, name, area) => ({ id, area, kind: "file", name, mime: "application/pdf", size: 2048, pages: 1, status: "ready", source: "upload", createdAt: 3 });
  const files = [pdf(FV, "Vorlesetext Regentropfen.pdf", "teacher"), pdf(FC, "Bildkarten Regentropfen.pdf", "teacher"), pdf(FA, "Arbeitsblatt Wasser.pdf", "student")];
  const lesson = { id: LID, subject: "gs", klass: "gs1", title: "Wasser", topic: "Wasser", date: "2026-11-24", startTime: "08:00", durationMin: 45, ideas: "", homework: "", portal: plan, portalVersion: 1, portalUpdatedAt: 1,
    portalSource: "lehrkraft", parentSummary: "", parentNote: "", createdAt: 1, unitId: null, unitRow: null, cancelled: false, teacherPlan: null };
  const kp = { phases: [{ n: 2, steps: ["Lehrkraft liest den Vorlesetext bis Nr. 3 vor und legt dabei die Bildkarten 1–3 hin."] }], plan: S.planFingerprint(plan), at: 7 };
  let served = lesson;
  globalThis.__tapi = async (method, path) => {
    if (method === "GET" && path === "/api/teacher/lessons/" + LID) return { lesson: served, files, refFiles: [], messages: [], unit: null, courseCards: [], cardPrints: {}, previousStop: null, nextLesson: null };
    if (/parent-link$/.test(path)) return { token: "tokA" };
    throw new ApiError("nicht nachgebildet: " + method + " " + path, 404, { code: "not_found" });
  };
  const course = { gs: { short: "Sach 3c", label: "Sachunterricht · Jahrgang 3 (Klasse 3c)", subjectName: "Sachunterricht", religion: false, grade: 3, classes: ["c"], gradeText: "Jahrgangsstufe 3" }, classSize: 22 };
  await GSS.gsSessionPage(LID, { lesson: { ...lesson }, course, messages: [], refFiles: [], files, unit: null, courseCards: [], cardPrints: {} });
  await D.sleep(5);
  D.userClick($("#inclass-go"));
  await until(() => $$("#ic-plan .icp-phase").length === 4, "kompakte Liste");
  assert.equal($("#ic-plan-src").textContent, "Automatisch gekürzt – die Phasen mit Ihren Aufgaben (unterstrichene Zeilen, sonst der erste Stichpunkt). Einen eigenen Kurzplan schreibt Claude beim Planen.");
  assert.deepEqual($$("#ic-plan a.pdfref").map((a) => a.firstChild.textContent), ["Vorlesetext Regentropfen.pdf", "Arbeitsblatt Wasser.pdf"], "die Aufforderung mit ihrem Verweis, die Phase 3 mit ihrem ersten Stichpunkt");
  assert.deepEqual($$("#ic-plan-full a.pdfref").map((a) => a.firstChild.textContent), ["Vorlesetext Regentropfen.pdf", "Bildkarten Regentropfen.pdf", "Arbeitsblatt Wasser.pdf"]);
  assert.equal($$(".icp-step", $$("#ic-plan .icp-phase")[1])[0].textContent, "Lehrkraft liest Vorlesetext Regentropfen.pdf (PDF, öffnet in neuem Tab) vor.");
  // Claude hat inzwischen den Kurzplan geschrieben: beim Zurückkehren in den Tab übernimmt die Seite ihn, die kompakte Ansicht zeichnet neu
  served = { ...lesson, teacherPlan: kp };
  D.fire(document, "visibilitychange");
  await until(() => $("#ic-plan-src").textContent.startsWith("Kurzplan von Claude"), "Kurzplan von Claude");
  assert.equal($("#ic-plan-src").textContent, "Kurzplan von Claude – Phasen 1, 3 und 4 automatisch gekürzt (dazu hat Claude nichts geschrieben)");
  assert.deepEqual($$(".icp-step", $$("#ic-plan .icp-phase")[1]).map((x) => x.textContent), ["Lehrkraft liest den Vorlesetext bis Nr. 3 vor und legt dabei die Bildkarten 1–3 hin."]);
  // Befund der Gegenprüfung: Claude schreibt schlichten Text – der gelbe Verweis der Aufforderung an die Lehrkraft bleibt als Zeile „Material:“ anklickbar
  const refs = $(".icp-refs", $$("#ic-plan .icp-phase")[1]);
  assert.deepEqual([refs.firstChild.textContent, $$("a.pdfref", refs).map((a) => a.firstChild.textContent)], ["Material: ", ["Vorlesetext Regentropfen.pdf"]]);
  assert.equal($$("#ic-plan .icp-refs").length, 1, "nur bei der Phase von Claude mit einer Aufforderung samt Verweis");
  assert.deepEqual([$("#ic-plan").getAttribute("aria-label"), $("#ic-plan").getAttribute("aria-describedby")], ["Verlaufsplan kompakt", "ic-plan-src"]);
  D.userClick($("#inclass-back"));
  assert.equal((globalThis.__domErrors || []).length, 0, (globalThis.__domErrors || []).join("\n"));
});
