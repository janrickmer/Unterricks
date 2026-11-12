// gsplanning.js – Prompts für Claude in der Grundschule (Wunsch der Lehrkraft vom 12.11.2026): Einheit planen. Gemeinsam für Browser und
// Worker (keine DOM-Zugriffe). Die Kinder arbeiten nicht digital: nur analoges, ausdruckbares Material.
import { fmtDay } from "./shared.js";
import { lessonSlots, paramsText } from "./planning.js";

export const GS_RULE = "In der Grundschule arbeiten die Kinder nicht digital: Plane ausschließlich analoges Material (ausdruckbare Arbeitsblätter, Bildkarten, Tafel- und Bodenbilder) – keine Feibeitsblätter, keine Escape-Rooms, keine Online-Aufgaben, keine Präsentation zum Mitverfolgen.";

/* ---------- Prompt für Claude: Unterrichtseinheit eines Grundschulkurses planen (claude.ai + Connector) ----------
 * ctx = {unitId, course (Kurs wie vom Server: subjectName, description, gradeText, …), title, params, slots, bases: [Titel], missing: [Text], classSize} */
export function claudeGsUnitPrompt(ctx) {
  const c = ctx.course || {}, slots = lessonSlots(ctx.slots || []), fach = c.subjectName || "Religion";
  const list = slots.map((s, i) => (i + 1) + ". " + fmtDay(s.date) + (s.time ? " " + s.time : "") + " (" + s.minutes + " min)").join("\n");
  const steps = [
    "1. Rufe zuerst mit dem Connector „Unterricks“ `get_planning_basis` für die Einheit " + ctx.unitId + " auf und lies die Planungsgrundlagen gründlich. Beziehe dich bei allen Vorschlägen auf die Vorgaben zu den Unterrichtsinhalten dieses Jahrgangs.",
    "2. Kläre mit mir kurz Thema und Schwerpunkt der Einheit im Rahmen der Vorgaben und warte auf meine Entscheidung.",
    "3. Schlage mir **drei** zentrale Lernaufgaben vor (kompetenzorientiert, grundschulgerecht, mit einem Lernprodukt der Kinder, z. B. ein gestaltetes Bild, ein kleines Buch, ein Bodenbild oder ein Rollenspiel). Die zentrale Lernaufgabe ist das Ziel der Unterrichtseinheit. Warte, bis ich eine festlege – ohne festgelegte Lernaufgabe entwickelst du noch keinen Ablauf.",
    "4. Entwickle dann das **Leupold-Schema**: links die Ausgangslage der Lerngruppe (Lernvoraussetzungen und angestrebter Kompetenzschwerpunkt), in der Mitte die Lernschritte der Einheit als Abfolge von Paaren aus Tätigkeitsbeschreibung in kindgerechter Sprache und knappem Schritt-Titel, rechts die festgelegte Lernaufgabe. Die Lernschritte führen folgerichtig von der Ausgangslage zur Lernaufgabe.",
    "5. Stelle darauf aufbauend den Ablauf der Unterrichtseinheit **tabellarisch** dar: genau " + slots.length + " Zeilen, eine je verfügbarer Sitzung in zeitlicher Reihenfolge. Spalte 1: Stundenfrage, Spalte 2: grober Stundenablauf in Stichpunkten (kurze Phasen, Sitzkreis, Erzählung, Bewegung, Gestalten). Ordne jede Stunde einem Lernschritt zu; die letzten Stunden münden in die zentrale Lernaufgabe.",
    "6. Wenn ich zufrieden bin, speichere das Ergebnis mit `save_unit_plan` in der Einheit " + ctx.unitId + " (Planungsgrundlage, Lernaufgabe, Ausgangslage, Lernschritte und die Stunden mit Stundenfrage, Ablauf und Nummer des Lernschritts). Ich prüfe und bearbeite den Plan danach in der Plattform; die Sitzungen legt die Plattform mit den Terminen an.",
  ];
  return [
    "Du bist eine erfahrene Fachdidaktikerin bzw. ein erfahrener Fachdidaktiker für " + fach + " an einer Grundschule in Hessen und planst mit mir eine Unterrichtseinheit. Arbeite gründlich, fachlich korrekt, kindgerecht und dialogisch: Gehe Schritt für Schritt vor und warte an den markierten Stellen auf meine Entscheidung.",
    "",
    "## Rahmendaten (von der Plattform erfasst)",
    "- Fach: " + fach + " (Grundschule)",
    c.description ? "- Ziel des Unterrichts in diesem Kurs (Beschreibung der Lehrkraft): " + c.description.replace(/\s*\n\s*/g, " ") : "",
    "- Lerngruppe: " + (c.gradeText || "Grundschule"),
    Number.isInteger(ctx.classSize) ? "- Schülerzahl: " + ctx.classSize + " Kinder (laut Kurseinstellungen)" : "",
    ctx.title ? "- Thema/Arbeitstitel der Einheit: " + ctx.title : "- Thema: noch offen (aus den Vorgaben ableiten und mit mir abstimmen)",
    paramsText(ctx.params, { exam: false }).split("\n").filter(Boolean).map((l) => "- " + l).join("\n"),
    "- Verfügbare Sitzungen bis zum Ende der Einheit: " + slots.length + (slots.length ? "\n" + list : ""),
    "",
    "## Vorgaben",
    "- " + GS_RULE,
    ctx.bases && ctx.bases.length ? "- Hinterlegte Planungsgrundlagen: " + ctx.bases.join("; ") : "- Es sind noch keine Planungsgrundlagen hinterlegt – sage mir, welche Dateien fehlen, und plane bis dahin nur mit ausdrücklich gekennzeichneten Annahmen.",
    ctx.missing && ctx.missing.length ? "- Es fehlen noch: " + ctx.missing.join("; ") + " – kennzeichne, wo du deshalb ohne Vorgabe planst." : "",
    "- Nenne nie Namen von Kindern.",
    "",
    "## Vorgehen",
    ...steps,
    "",
    "Falls der Connector „Unterricks“ in diesem Chat nicht verfügbar ist, sage es mir sofort (er muss in claude.ai unter „Connectors“ eingerichtet und im Chat aktiviert sein).",
  ].filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");
}
