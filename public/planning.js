// planning.js – Unterrichtseinheiten (Leupold-Schema + Ablaufplan), Terminberechnung, Krankheitsvertretung, Claude-Prompts.
// Gemeinsam für Browser und Worker (keine DOM-Zugriffe).
import { subjectName, gradeInfo, classShort, isAnalogClass, ANALOG_RULE, fmtDay, addDays, isIsoDate, isClockTime, PORTAL_RULES, PORTAL_EXAMPLE, FEIBEITSBLATT_INFO,
  SYSTEM_PROMPT_ROLE, UNIT_RULE_BASE, STOP_LINE, lessonContext, teacherWishes, groupShort, subjectShort } from "./shared.js";
import { ESCAPE_FORMAT_HINT } from "./escape-data.js";
export { UNIT_RULE } from "./shared.js";

export const WEEKDAYS = [{ d: 1, n: "Montag" }, { d: 2, n: "Dienstag" }, { d: 3, n: "Mittwoch" }, { d: 4, n: "Donnerstag" }, { d: 5, n: "Freitag" }];
const wdName = (d) => (WEEKDAYS.find((w) => w.d === d) || {}).n || "";
const str = (v, max) => { const s = typeof v === "string" ? v : v == null ? "" : String(v); return max && s.length > max ? s.slice(0, max) : s; };
const clip = (s, n) => { s = str(s); return s.length > n ? s.slice(0, n) + " […gekürzt]" : s; };

/* ---------- Rahmendaten und Termine ---------- */
// params = { start, end, exam, weekdays: [{day 1–5, minutes, time? „HH:MM“}], breaks: [{from, to, label}], notes }
export function normalizeParams(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const date = (v) => (isIsoDate(v) ? v : null);
  const weekdays = (Array.isArray(p.weekdays) ? p.weekdays : []).slice(0, 10)
    .map((w) => ({ day: Number(w && w.day), minutes: Number(w && w.minutes), time: isClockTime(w && w.time) ? w.time : null }))
    .filter((w) => Number.isInteger(w.day) && w.day >= 1 && w.day <= 5 && Number.isInteger(w.minutes) && w.minutes >= 20 && w.minutes <= 240);
  const breaks = (Array.isArray(p.breaks) ? p.breaks : []).slice(0, 30)
    .map((b) => ({ from: date(b && b.from), to: date(b && (b.to || b.from)), label: str(b && b.label, 80) }))
    .filter((b) => b.from && b.to && b.to >= b.from);
  return { start: date(p.start), end: date(p.end), exam: date(p.exam), weekdays, breaks, notes: str(p.notes, 2000) };
}
/* Alle Unterrichtstermine im Zeitraum nach Stundenplan, ohne Ferien/Ausfälle; der Klausurtag wird markiert */
export function computeSlots(raw) {
  const p = normalizeParams(raw), out = [];
  if (!p.start || !p.end || p.end < p.start || !p.weekdays.length) return out;
  for (let d = p.start, i = 0; d <= p.end && i < 400; d = addDays(d, 1), i++) {
    const wd = new Date(d + "T12:00:00Z").getUTCDay();
    const hits = p.weekdays.filter((w) => w.day === wd);
    if (!hits.length || p.breaks.some((b) => d >= b.from && d <= b.to)) continue;
    for (const w of hits) out.push({ date: d, minutes: w.minutes, time: w.time || null, kind: d === p.exam ? "klausur" : "stunde" });
  }
  return out;
}
export const lessonSlots = (slots) => slots.filter((s) => s.kind === "stunde");
export function paramsText(raw) {
  const p = normalizeParams(raw);
  const lines = [];
  if (p.weekdays.length) lines.push("Stundenplan: " + p.weekdays.map((w) => wdName(w.day) + (w.time ? " ab " + w.time + " Uhr" : "") + " (" + w.minutes + " Minuten)").join(", "));
  if (p.start || p.end) lines.push("Zeitraum der Einheit: " + (p.start ? fmtDay(p.start) : "?") + " bis " + (p.end ? fmtDay(p.end) : "?") + " (bis dahin soll die Einheit abgeschlossen sein)");
  lines.push("Klausurtermin: " + (p.exam ? fmtDay(p.exam) : "keiner angegeben"));
  if (p.breaks.length) lines.push("Ferien/Ausfälle: " + p.breaks.map((b) => (b.label ? b.label + " " : "") + fmtDay(b.from) + (b.to !== b.from ? "–" + fmtDay(b.to) : "")).join("; "));
  if (p.notes) lines.push("Hinweise der Lehrkraft: " + p.notes);
  return lines.join("\n");
}

/* ---------- Plan der Einheit (Leupold-Schema + Tabelle) ---------- */
// plan = { titel, thema, planungsgrundlage: {name, begruendung, alternative?: {name, begruendung}}, lernaufgabe, ausgangslage,
//          schritte: [{titel, beschreibung}] }, rows = [{uid, stundenfrage, ablauf: [..], schritt, date, minutes}]
export function normalizePlan(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const pg = p.planungsgrundlage && typeof p.planungsgrundlage === "object" ? p.planungsgrundlage : { name: str(p.planungsgrundlage) };
  const alt = pg.alternative && typeof pg.alternative === "object" ? { name: str(pg.alternative.name, 120), begruendung: str(pg.alternative.begruendung, 2000) } : null;
  return {
    titel: str(p.titel || p.title, 200).trim(), thema: str(p.thema, 500).trim(),
    planungsgrundlage: { name: str(pg.name, 120).trim(), begruendung: str(pg.begruendung, 3000).trim(), ...(alt && alt.name ? { alternative: alt } : {}) },
    lernaufgabe: str(p.lernaufgabe, 4000).trim(), ausgangslage: str(p.ausgangslage, 4000).trim(),
    schritte: (Array.isArray(p.schritte) ? p.schritte : []).slice(0, 15).map((x) => ({ titel: str(x && x.titel, 160).trim(), beschreibung: str(x && x.beschreibung, 600).trim() })).filter((x) => x.titel || x.beschreibung),
  };
}
export function normalizeRows(raw, newUid) {
  return (Array.isArray(raw) ? raw : []).slice(0, 150).map((r) => {
    const ablauf = Array.isArray(r && r.ablauf) ? r.ablauf : str(r && r.ablauf).split("\n");
    const sch = r && r.schritt !== null && r.schritt !== undefined && r.schritt !== "" ? Number(r.schritt) : NaN;
    return {
      uid: typeof (r && r.uid) === "string" && /^[a-f0-9]{8}$/.test(r.uid) ? r.uid : newUid(),
      stundenfrage: str(r && r.stundenfrage, 400).trim(),
      ablauf: ablauf.map((x) => str(x, 400).replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean).slice(0, 15),
      schritt: Number.isInteger(sch) && sch >= 0 && sch < 15 ? sch : null,
      date: isIsoDate(r && r.date) ? r.date : null,
      minutes: Number.isInteger(Number(r && r.minutes)) && Number(r.minutes) >= 20 && Number(r.minutes) <= 240 ? Number(r.minutes) : null,
      time: isClockTime(r && r.time) ? r.time : null,
    };
  }).filter((r) => r.stundenfrage || r.ablauf.length);
}
/* Termine der Reihe nach auf Zeilen ohne Datum verteilen (bereits gesetzte Daten bleiben) */
export function assignDates(rows, slots) {
  const free = lessonSlots(slots).filter((s) => !rows.some((r) => r.date === s.date));
  let k = 0;
  return rows.map((r) => { if (r.date) return r; const sl = free[k++]; return sl ? { ...r, date: sl.date, minutes: r.minutes || sl.minutes, time: r.time || sl.time || null } : r; });
}

/* ```einheit {…}``` in einer Antwort des Planungsassistenten: vorgeschlagene Änderung der Zeile dieser Stunde */
export function extractUnitChange(text) {
  const m = /```einheit\s*([\s\S]*?)```/i.exec(String(text || ""));
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]);
    const ablauf = Array.isArray(o.ablauf) ? o.ablauf.map((x) => str(x, 400).trim()).filter(Boolean).slice(0, 15) : [];
    const stundenfrage = str(o.stundenfrage, 400).trim();
    if (!stundenfrage && !ablauf.length) return null;
    return { stundenfrage, ablauf, begruendung: str(o.begruendung, 1000).trim() };
  } catch { return null; }
}
export const stripUnitBlock = (text) => String(text || "").replace(/```einheit\s*[\s\S]*?```/gi, "").trim();

/* Kontext der Einheit für eine Stunde (Chat, Prompts, Connector) */
export function unitContext(unit, rowUid) {
  if (!unit) return "";
  const plan = unit.plan || {}, rows = unit.rows || [];
  const idx = rows.findIndex((r) => r.uid === rowUid), row = idx >= 0 ? rows[idx] : null;
  const L = ["Unterrichtseinheit: " + (unit.title || plan.titel || "(ohne Titel)") + (plan.thema ? " – " + plan.thema : "")];
  if (plan.planungsgrundlage && plan.planungsgrundlage.name) L.push("Planungsgrundlage: " + plan.planungsgrundlage.name + (plan.planungsgrundlage.begruendung ? " (" + clip(plan.planungsgrundlage.begruendung, 600) + ")" : ""));
  if (plan.lernaufgabe) L.push("Zentrale Lernaufgabe (Ziel der Einheit): " + clip(plan.lernaufgabe, 1500));
  if (plan.ausgangslage) L.push("Ausgangslage der Lerngruppe: " + clip(plan.ausgangslage, 1200));
  if ((plan.schritte || []).length) {
    L.push("Lernschritte der Einheit (Leupold-Schema):");
    plan.schritte.forEach((s, i) => L.push((i + 1) + ". " + s.titel + (s.beschreibung ? " – " + s.beschreibung : "") + (row && row.schritt === i ? "   ← Lernschritt dieser Stunde" : "")));
  }
  if (row) {
    L.push("Diese Sitzung ist Stunde " + (idx + 1) + " von " + rows.length + (row.date ? " am " + fmtDay(row.date) : "") + (row.minutes ? " (" + row.minutes + " Minuten)" : "") + ":");
    L.push("  Stundenfrage: " + (row.stundenfrage || "(noch offen)"));
    if (row.ablauf.length) L.push("  Grober Ablauf laut Einheit (nur Inspiration):\n" + row.ablauf.map((a) => "  - " + a).join("\n"));
    if (idx > 0) L.push("  Vorige Stunde: " + rows[idx - 1].stundenfrage);
    if (idx < rows.length - 1) L.push("  Nächste Stunde: " + rows[idx + 1].stundenfrage);
  }
  return L.join("\n");
}
/* ---------- Prompt für Claude: Unterrichtseinheit planen (claude.ai + Connector) ---------- */
export function claudeUnitPrompt(ctx) {
  const g = gradeInfo(ctx.klass), slots = lessonSlots(ctx.slots || []), powi = ctx.subject === "powi";
  const list = slots.map((s, i) => (i + 1) + ". " + fmtDay(s.date) + " (" + s.minutes + " min)").join("\n");
  const exams = (ctx.slots || []).filter((s) => s.kind === "klausur").map((s) => fmtDay(s.date)).join(", ");
  const steps = [];
  let n = 1;
  steps.push(n++ + ". Rufe zuerst mit dem Connector „Unterricks“ `get_planning_basis` für die Einheit " + ctx.unitId + " auf und lies die Planungsgrundlagen gründlich. Beziehe dich bei allen Vorschlägen auf die fachdidaktischen Prinzipien und didaktischen Vorgaben dieses Schuljahres und vor allem auf die Vorgaben zu den Unterrichtsinhalten.");
  if (powi) steps.push(n++ + ". Frage mich, mit welcher Planungsgrundlage ich an die Einheit herangehen möchte (z. B. Konfliktanalyse, Problemstudie, Fallanalyse/Fallbeispiel, Systemanalyse, Zukunftswerkstatt, Planspiel). Mache unter Berücksichtigung des Alters der Schüler:innen und des Themas einen **priorisierten** und einen **sekundären** Vorschlag und begründe zu jedem kurz, wie man sich die Einheit damit vorstellen kann. Warte auf meine Entscheidung.");
  else steps.push(n++ + ". Kläre mit mir kurz Thema und Schwerpunkt der Einheit im Rahmen der Vorgaben und warte auf meine Entscheidung.");
  steps.push(n++ + ". Schlage mir **drei** zentrale Lernaufgaben vor (kompetenzorientiert, mit Lernprodukt, passend zur Jahrgangsstufe). Die zentrale Lernaufgabe ist das Ziel der Unterrichtseinheit. Warte, bis ich eine festlege – ohne festgelegte Lernaufgabe entwickelst du noch keinen Ablauf.");
  steps.push(n++ + ". Entwickle dann das **Leupold-Schema**: links die Ausgangslage der Lerngruppe (Lernvoraussetzungen und angestrebter Kompetenzschwerpunkt), in der Mitte die Lernschritte der Einheit als Abfolge von Paaren aus Tätigkeitsbeschreibung mit Operatoren (z. B. „Sachtext auswerten, Kategorien strukturieren und im Austausch erweitern“) und knappem Schritt-Titel (z. B. „Problemstudie: Akteure und Interessen“), rechts die festgelegte Lernaufgabe. Die Lernschritte führen folgerichtig von der Ausgangslage zur Lernaufgabe.");
  steps.push(n++ + ". Stelle darauf aufbauend den Ablauf der Unterrichtseinheit **tabellarisch** dar: genau " + slots.length + " Zeilen, eine je verfügbarer Sitzung in zeitlicher Reihenfolge. Spalte 1: Stundenfrage, Spalte 2: grober Stundenablauf in Stichpunkten. Ordne jede Stunde einem Lernschritt zu; die letzten Stunden münden in die zentrale Lernaufgabe." + (exams ? " Berücksichtige die Klausur am " + exams + "." : ""));
  steps.push(n++ + ". Wenn ich zufrieden bin, speichere das Ergebnis mit `save_unit_plan` in der Einheit " + ctx.unitId + " (Planungsgrundlage, Lernaufgabe, Ausgangslage, Lernschritte und die Stunden mit Stundenfrage, Ablauf und Nummer des Lernschritts). Ich prüfe und bearbeite den Plan danach in der Plattform; die Sitzungen legt die Plattform mit den Terminen an.");
  return [
    "Du bist eine erfahrene Fachdidaktikerin bzw. ein erfahrener Fachdidaktiker für " + subjectName(ctx.subject) + " an einem Gymnasium in Hessen und planst mit mir eine Unterrichtseinheit. Arbeite gründlich, fachlich korrekt und dialogisch: Gehe Schritt für Schritt vor und warte an den markierten Stellen auf meine Entscheidung.",
    "",
    "## Rahmendaten (von der Plattform erfasst)",
    "- Fach: " + subjectName(ctx.subject),
    "- Klasse/Kurs: " + classShort(ctx.klass) + " – " + g.text,
    ctx.title ? "- Thema/Arbeitstitel der Einheit: " + ctx.title : "- Thema: noch offen (aus den Vorgaben ableiten und mit mir abstimmen)",
    paramsText(ctx.params).split("\n").map((l) => "- " + l).join("\n"),
    "- Verfügbare Sitzungen bis zum Ende der Einheit: " + slots.length + (slots.length ? "\n" + list : ""),
    "",
    "## Vorgaben",
    ctx.rules ? ctx.rules.split("\n").map((l) => "- " + l).join("\n") : "- (keine fachspezifischen Hinweise hinterlegt)",
    ctx.gradeNote ? "- " + ctx.gradeNote : "",
    isAnalogClass(ctx.klass) ? "- " + ANALOG_RULE : "",
    ctx.bases && ctx.bases.length ? "- Hinterlegte Planungsgrundlagen: " + ctx.bases.join("; ") : "- Es sind noch keine Planungsgrundlagen hinterlegt – sage mir, welche Dateien fehlen, und plane bis dahin nur mit ausdrücklich gekennzeichneten Annahmen.",
    ctx.missing && ctx.missing.length ? "- Es fehlen noch: " + ctx.missing.join("; ") + " – kennzeichne, wo du deshalb ohne Vorgabe planst." : "",
    "",
    "## Vorgehen",
    ...steps,
    "",
    "Falls der Connector „Unterricks“ in diesem Chat nicht verfügbar ist, sage es mir sofort (er muss in claude.ai unter „Connectors“ eingerichtet und im Chat aktiviert sein).",
  ].filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ---------- Prompt für Claude: eine Stunde planen (Hauptweg der Lehrkraft; claude.ai + Connector) ----------
 * ctx wie in der Sitzungsansicht (lessonId, subject, klass, lesson, materials, sheets, portal, unit, row, unitText, gradeNote)
 * + messages (Planungsverlauf der Plattform) + previousStop ({title, date, portal} der vorigen Stunde mit Zwischenstopp) */
/* Name des Chats in claude.ai, z. B. „Jg. 8 - PoWi - Sitzung 1 - Das Bundesverfassungsgericht“: Lerngruppe, Fach, Stunde in der
 * Unterrichtseinheit (ohne Einheit entfällt sie), Titel der Sitzung */
export function lessonChatName(ctx) {
  const L = (ctx && ctx.lesson) || {}, rows = (ctx && ctx.unit && ctx.unit.rows) || [];
  const i = ctx && ctx.row ? rows.findIndex((r) => r && r.uid === ctx.row.uid) : -1;
  const title = str(L.title).replace(/\s+/g, " ").trim().slice(0, 90);
  return [groupShort(ctx && ctx.klass), subjectShort(ctx && ctx.subject), i >= 0 ? "Sitzung " + (i + 1) : null, title || null].filter(Boolean).join(" - ");
}

export function claudeLessonPrompt(ctx) {
  const L = ctx.lesson || {}, analog = isAnalogClass(ctx.klass), unit = !!ctx.unitText, id = ctx.lessonId, chatName = lessonChatName(ctx);
  const minutes = L.durationMin || (ctx.row && ctx.row.minutes) || null;
  const chat = (ctx.messages || []).filter((m) => (m.role === "user" || m.role === "assistant") && m.model !== "begruessung");
  const lastAnswers = chat.filter((m) => m.role === "assistant").slice(-2).map((m) => str(m.content).trim()).join("\n\n---\n\n");
  const ps = ctx.previousStop;
  const saves = [
    "   - Stundenverlauf → `save_schulportal_entry` (Schulportal-Zeichen: " + PORTAL_RULES.join("; ") + "; Aufbau genau wie in der Vorlage unten; übergib `base_version` aus `get_lesson` – meldet die Plattform eine neuere Fassung, rufe `get_lesson` erneut auf und berücksichtige meine Änderungen).",
    "   - Ausgearbeiteter Stundenentwurf (Verlauf mit Minuten, Begründung, Erwartungen) → `save_planning_result` (erscheint im Planungsverlauf der Sitzung; darauf bauen der Präsentations-Prompt und spätere Planungen auf).",
    "   - Materialien → `add_text_material` (`bereich` \"schueler\": für die Schüler:innen, als PDF herunterladbar" + (analog ? " bzw. von mir ausgedruckt" : "") + "; \"lehrkraft\": nur für mich, z. B. Erwartungshorizont oder Tafelbild).",
    "   - Alles, was ich vor der Stunde ausdrucken muss (z. B. Arbeitsblätter" + (analog ? " – in dieser Jahrgangsstufe alles Material für die Schüler:innen" : "") + ", Karten, Schaubilder oder Kärtchen für die Tafel) → `add_print_material` mit `anzahl` (frag mich nach der Klassengröße, wenn du sie nicht kennst), `beidseitig` (false, wenn geschnitten wird) und `farbe` (nur, wenn Farbe unbedingt nötig ist – an der Schule wird fast immer schwarz-weiß gedruckt). Gedruckt wird nur A4.",
    analog ? null : "   - Feibeitsblatt → `propose_feibeitsblatt` (nur ein Entwurf: Ich prüfe ihn in der Plattform und lege das Blatt dort an).",
    "   - Hausaufgabe bis zur nächsten Sitzung → `update_lesson` mit `hausaufgabe` (für die Schüler:innen sichtbar; Schulportal-Zeichen erlaubt). Geänderte Sitzungsdaten (Titel, Thema, Dauer) ebenfalls mit `update_lesson`.",
    unit ? "   - Abgestimmte Abweichung von der Einheit (Stundenfrage, grober Ablauf) → `update_unit_row`." : null,
  ];
  return [
    "Chat-Name: " + chatName,
    "",
    SYSTEM_PROMPT_ROLE,
    "",
    "Die Lehrkraft bin ich. Wir planen zusammen die folgende Unterrichtssitzung meiner Unterrichtsplattform „Unterricks“. Über den Connector „Unterricks“ liest du sie und speicherst Ergebnisse auf meinen Wunsch direkt dort. Arbeite gründlich und fachlich korrekt.",
    "",
    "## Die Sitzung (von der Plattform übermittelt)",
    "Sitzungs-ID: " + id,
    lessonContext(ctx, { materialText: false }),
    ps ? "\n## Vorige Stunde nicht vollständig beendet\nIn der vorigen Sitzung „" + str(ps.title) + "“" + (ps.date ? " (" + fmtDay(ps.date) + ")" : "") + " habe ich einen Zwischenstopp markiert. " +
      "Ihr Schulportal-Eintrag („" + STOP_LINE + "“ markiert, bis wohin die Stunde gekommen ist; alles danach ist noch offen):\n<<<\n" + clip(ps.portal, 4000) + "\n>>>\nFrage mich, ob und wie der offene Teil in diese Stunde übernommen werden soll." : null,
    chat.length ? "\n## Bisheriger Planungsverlauf in der Plattform (Auszug; vollständig über `get_lesson`)" +
      (chat.some((m) => m.role === "user") ? "\nWünsche, die ich dort geäußert habe:\n" + teacherWishes(chat, 4000) : "") +
      (lastAnswers ? "\nLetzter Stand:\n<<<\n" + clip(lastAnswers, 12000) + "\n>>>" : "") : null,
    "",
    "## Feste Vorgaben",
    "- Plane mit Minutenangaben je Phase, die zusammen die Dauer der Sitzung ergeben, und nenne Methode und Sozialform.",
    "- Formuliere Materialien (Arbeitsaufträge mit Operatoren, Texte, Tafelbild bzw. Ergebnissicherung, Erwartungshorizont) vollständig aus, wenn ich das möchte, damit ich sie direkt übernehmen kann.",
    unit ? "- " + UNIT_RULE_BASE + " Stimme ich einer geänderten Stundenfrage oder einem geänderten groben Ablauf zu, halte das mit `update_unit_row` in der Einheit fest." : null,
    analog ? "- " + ANALOG_RULE
      : "- Schlage bewusst auch vor, statt eines klassischen Arbeitsblatts ein Feibeitsblatt zu erstellen, wenn es didaktisch passt. " + FEIBEITSBLATT_INFO +
        " Für ein Lernprodukt (z. B. ein Plakat) kann eine Aufgabe die Antwortart „foto“ haben: Die Schüler:innen geben ein Foto ihres Produkts ab (nie an die KI, ohne „Auftrag an die KI“; höchstens 3 Foto-Aufgaben je Feibeitsblatt).",
    "- Erfinde keine Quellen, Links oder Videos; kennzeichne Vorschläge, die ich prüfen sollte.",
    "",
    "## Vorgehen",
    "0. Dieser Chat soll „" + chatName + "“ heißen. Beginne deine erste Antwort mit der Zeile „Chat-Name: " + chatName + "“ (umbenennen kann ich den Chat in claude.ai nur selbst).",
    "1. Rufe zuerst mit dem Connector „Unterricks“ `get_lesson` mit der Sitzungs-ID " + id + " auf: Dort stehen die aktuellen Daten, alle Materialien im Wortlaut, der bisherige Planungsverlauf und der Schulportal-Eintrag mit seiner Version." +
      (ctx.unit && ctx.unit.id ? " Die ganze Unterrichtseinheit (Leupold-Schema, alle Stunden) liefert `get_unit` mit der ID " + ctx.unit.id + "." : "") +
      " Brauchst du die Vorgaben im Wortlaut (Schulcurriculum, KCGO, Abiturerlass), liefert sie `get_planning_basis` mit der Sitzungs-ID.",
    "2. Frage mich dann nach der Dauer (" + (minutes ? "laut Plattform " + minutes + " Minuten – stimmt das?" : "in der Plattform noch nicht eingetragen") + ") und nach Ideen, Themen, Materialien oder didaktischen Wünschen. Warte auf meine Antwort.",
    "3. Plane mit mir dialogisch, bis ich zufrieden bin.",
    "4. Speichere nur, was ich freigebe, direkt in der Plattform:",
    ...saves,
    "5. Sage mir zum Schluss kurz, was du gespeichert hast. Die Präsentation erstelle ich danach in der Plattform mit „Präsentation mit Claude erstellen“ – deren Prompt baut auf dem gespeicherten Schulportal-Eintrag auf.",
    "",
    "Vorlage für den Schulportal-Eintrag (so sieht der fertige Eintrag aus):",
    PORTAL_EXAMPLE,
    "",
    "Falls der Connector „Unterricks“ in diesem Chat nicht verfügbar ist, sage es mir sofort (beim ersten Mal muss er im Chat verbunden und sein Zugriff erlaubt werden). Plane dann mit den Angaben oben und gib mir den Schulportal-Eintrag am Ende zum Kopieren aus.",
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ---------- Krankheitsvertretung ---------- */
export const SUBSTITUTE_SHARE = 0.8;   // Vorgabe: ca. 80 % der Unterrichtszeit für die Bearbeitung
export const DEFAULT_SUBSTITUTE_NOTICE = "Deine Lehrkraft kann heute nicht persönlich im Unterricht sein. Bitte bearbeite die folgenden Vertretungsaufgaben selbstständig der Reihe nach.";
export function claudeSubstitutePrompt(ctx) {
  const L = ctx.lesson || {}, minutes = L.durationMin || (ctx.row && ctx.row.minutes) || 45, work = Math.round(minutes * SUBSTITUTE_SHARE);
  const analog = isAnalogClass(ctx.klass);
  const formats = analog
    ? ["- " + ANALOG_RULE, "- Abgabe: ein ausgefülltes Arbeitsblatt (oder ein kleines Lernprodukt auf Papier), das die Vertretungslehrkraft einsammelt."]
    : ["- Kreative Selbstlern-Formate sind ausdrücklich erwünscht, z. B. ein Escape-Room" + (ctx.escape ? " (nach der Vorlage der Plattform – Inhalt im Feld `escape_room`, Finale ist automatisch ein Feibeitsblatt)" : " (zurzeit noch nicht über die Plattform verfügbar)") + ", ein Feibeitsblatt (" + FEIBEITSBLATT_INFO + ") oder ein Lernprodukt.",
      "- Entscheidest du dich für ein Lernprodukt (z. B. ein Plakat), führt ein Feibeitsblatt die Schüler:innen durch den Planungsprozess des Lernprodukts und enthält eine Aufgabe mit der Antwortart „Foto“ (`antwort: \"foto\"`), in der sie ein Foto ihres Lernprodukts abgeben. Fotos gehen nie an die KI (kein `ki_auftrag`); höchstens 3 Foto-Aufgaben je Feibeitsblatt.",
      "- Jede Vertretungsstunde enthält eine Abgabe in der Plattform: " + (ctx.escape ? "ein Feibeitsblatt, ein Escape-Room mit Feibeitsblatt-Finale oder ein Feibeitsblatt mit Foto-Abgabe." : "ein Feibeitsblatt (bei einem Lernprodukt mit Foto-Abgabe)."),
      ...(ctx.escape ? ["- Wählst du einen Escape-Room, liefere ihn vollständig im Feld `escape_room` (statt `feibeitsblatt`). Die Plattform hostet ihn in ihrer Vorlage. " + ESCAPE_FORMAT_HINT.replace(/\n/g, " ") +
        " Plane ihn so, dass er mit dem Finale in die Bearbeitungszeit passt (ca. 5–8 Minuten je Station). In der Anleitung für die Schüler:innen: Escape-Room in der Sitzung mit „Escape-Room starten“ öffnen, Stationen der Reihe nach bearbeiten (Notizen machen), am Ende durch den Tunnel ins Feibeitsblatt und dort abgeben."] : [])];
  return [
    "Ich bin krank und kann die folgende Unterrichtsstunde nicht selbst halten. Entwickle eine Vertretungsstunde, die die Schüler:innen ohne mich bearbeiten können. Arbeite gründlich und fachlich korrekt.",
    "",
    "## Die geplante Stunde",
    "- Fach: " + subjectName(ctx.subject),
    "- Klasse/Kurs: " + classShort(ctx.klass) + " – " + gradeInfo(ctx.klass).text,
    "- Sitzung: " + (L.title || "") + (L.date ? " am " + fmtDay(L.date) : "") + " (Sitzungs-ID " + ctx.lessonId + ")",
    "- Geplante Dauer: " + minutes + " Minuten → Bearbeitungszeit für die Schüler:innen: ca. " + work + " Minuten (80 %; der Rest geht für Organisation und Abgabe drauf).",
    ctx.unitText ? "\n" + ctx.unitText : "",
    "",
    "## Vorgehen",
    "1. Rufe mit dem Connector „Unterricks“ `get_lesson` mit der Sitzungs-ID " + ctx.lessonId + " auf: Dort stehen die eigentliche Planung, der Schulportal-Eintrag, die Materialien und die Unterrichtseinheit.",
    "2. Untersuche die eigentlich geplante Stunde: Welche fachdidaktische Kompetenz sollte erreicht werden? Welche Stundenfrage sollte am Ende beantwortet werden? Welche Lerninhalte sollten vermittelt werden?",
    "3. Entwickle mit diesen Antworten sowie Fach und Jahrgangsstufe etwas, das die Schüler:innen in der Vertretungsstunde ohne Lehrkraft bearbeiten können (ca. " + work + " Minuten).",
    ...formats,
    "4. Schreibe eine klare, chronologische Anleitung für die Schüler:innen: nummerierte Schritte mit Minutenangabe, was genau zu tun ist, welches Material, und wann bzw. wie abgegeben wird.",
    "5. Formuliere alle Materialien vollständig aus, dazu einen Schulportal-Eintrag für die Vertretungsstunde (Schulportal-Zeichen: " + PORTAL_RULES.join("; ") + "; Aufbau wie in diesem Beispiel:\n" + PORTAL_EXAMPLE + "\n) und kurze Hinweise für die Vertretungslehrkraft.",
    "6. Fasse mir den Vorschlag kurz zusammen und speichere ihn mit `save_substitute_plan` für die Sitzung " + ctx.lessonId + ". Ich prüfe ihn in der Plattform; erst wenn ich ihn bestätige, tauscht die Plattform das Material aus und zeigt den Schüler:innen den Vertretungshinweis.",
  ].filter((l) => l !== "").join("\n");
}
export function normalizeSubstitute(raw) {
  const p = raw && typeof raw === "object" ? raw : {};
  const a = p.analyse && typeof p.analyse === "object" ? p.analyse : {};
  const fb = p.feibeitsblatt && typeof p.feibeitsblatt === "object" && Array.isArray(p.feibeitsblatt.aufgaben || p.feibeitsblatt.tasks) ? p.feibeitsblatt : null;
  return {
    analyse: { kompetenz: str(a.kompetenz, 1500).trim(), stundenfrage: str(a.stundenfrage, 400).trim(), inhalte: (Array.isArray(a.inhalte) ? a.inhalte : str(a.inhalte).split("\n")).map((x) => str(x, 400).trim()).filter(Boolean).slice(0, 15) },
    format: str(p.format, 80).trim(),
    bearbeitungszeit: Number.isInteger(Number(p.bearbeitungszeit)) ? Number(p.bearbeitungszeit) : null,
    hinweis: str(p.hinweis_schueler || p.hinweis, 1000).trim() || DEFAULT_SUBSTITUTE_NOTICE,
    schritte: (Array.isArray(p.schritte) ? p.schritte : []).slice(0, 20).map((x, i) => ({
      titel: str(x && x.titel, 160).trim() || "Schritt " + (i + 1), anleitung: str(x && x.anleitung, 3000).trim(),
      minuten: Number.isInteger(Number(x && x.minuten)) ? Number(x.minuten) : null, abgabe: !!(x && x.abgabe) })).filter((x) => x.anleitung || x.titel),
    abgabe: str(p.abgabe, 1000).trim(),
    schulportal: str(p.schulportal, 30000).trim(),
    materialien: (Array.isArray(p.materialien) ? p.materialien : []).slice(0, 12).map((m) => ({
      titel: str(m && m.titel, 200).trim() || "Material", bereich: m && m.bereich === "lehrkraft" ? "teacher" : "student", markdown: str(m && m.markdown, 200000).trim() })).filter((m) => m.markdown),
    feibeitsblatt: fb,
    escape_room: p.escape_room && typeof p.escape_room === "object" ? p.escape_room : null,
    vertretung: str(p.hinweise_vertretung || p.vertretung, 4000).trim(),
  };
}
