// gsplanning.js – Prompts für Claude in der Grundschule (Wunsch der Lehrkraft vom 12.11.2026): Einheit planen. Gemeinsam für Browser und
// Worker (keine DOM-Zugriffe). Die Kinder arbeiten nicht digital: nur analoges, ausdruckbares Material.
import { fmtDay, SYSTEM_PROMPT_ROLE, UNIT_RULE_BASE, STOP_LINE, materialDesignText, hasStop } from "./shared.js";
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

/* ---------- Sitzungen der Grundschule (Verlaufsplan statt Schulportal-Eintrag) ---------- */
// Zusätzliche Gestaltungsregeln für Material der Grundschule (gehen den allgemeinen Regeln vor)
export const GS_MATERIAL_RULES = [
  "Grundschule: gut lesbare Druckschrift ab 16 pt (Jahrgang 1/2: 18–22 pt), kurze Sätze, viel Weißraum, große Abbildungen als Inline-SVG.",
  "Arbeitsanweisungen in einfacher Sprache mit Symbolen (Stift = schreiben, Schere = ausschneiden, Auge = ansehen); keine Operatoren-Fachsprache, keine Anforderungsbereiche.",
  "Schreiblinien: Jahrgang 1/2 Grundschul-Lineatur mit Hilfslinien (Zeilenhöhe etwa 15–16 mm), Jahrgang 3/4 Linien mit 10–12 mm Abstand.",
  "Kopf nur „Name:“ und „Datum:“; Ausmal- und Schneidevorlagen mit klaren, dicken Konturen, schwarz-weiß druckbar.",
  "Nie Namen von Kindern.",
];
// Bildkarten zu einer Geschichte (eine Seite = eine Karte; Erzähltext je Karte für die Elternansicht)
export const CARD_DESIGN_RULES = [
  "Eine Bildkarte = eine Seite: @page { size: A4 landscape; margin: 0 }; jede Karte ein Block von 297 × 210 mm mit break-after: page und overflow: hidden – nichts darf auf eine zweite Seite laufen.",
  "Großes, kindgerechtes Bild als Inline-SVG (klare Formen, freundliche Figuren, im Sitzkreis gut erkennbar); höchstens eine kurze Überschrift; kein Kopf mit Name oder Datum.",
  "4–12 Karten in der Reihenfolge der Geschichte; Farbe erlaubt, aber kontrastreich.",
  "Zu jeder Karte genau ein Erzähltext (gleiche Reihenfolge): 2–4 kurze Sätze, mit denen Eltern die Geschichte mit ihrem Kind nacherzählen können; nie Namen von Kindern.",
];
export const VERLAUFSPLAN_EXAMPLE = "**1) Ankommen im Sitzkreis (5 Min.)**\n- Begrüßungslied, Kerze anzünden\n**2) Erzählung mit Bildkarten (15 Min., Sitzkreis)**\n" +
  "- [[pdf:<file_id>]] Karten der Reihe nach zeigen und frei erzählen\n- __Lehrkraft liest [[pdf:<file_id>|Vorlesetext – Josef und seine Brüder]] vor.__\n**3) Arbeitsblatt (15 Min., Einzelarbeit)**\n- [[pdf:<file_id>]]\n" +
  "**4) Abschluss (10 Min., Sitzkreis)**\n- Gesprächsrunde: Was hat Josef seinen Brüdern verziehen?";
// Regeln des Verlaufsplans (Werkzeug save_verlaufsplan und Prompt „Stunde mit Claude planen“)
export const VERLAUFSPLAN_RULES = "Nummerierte, fette Phasen mit Minuten und Sozialform (**1) Titel (10 Min., Sitzkreis)**), darunter Stichpunkte mit „- “; " +
  "jede PDF-Datei genau an der Stelle, an der sie benutzt wird, als [[pdf:<file_id>]] (Unterricks zeigt dort ihren Namen gelb markiert); weitere Zeichen: **fett**, ~~kursiv~~, __unterstrichen__. " +
  "Muss die Lehrkraft an einer Stelle auf Material zurückgreifen, das nur sie hat (bereich \"lehrkraft\", z. B. ein Vorlesetext, ein Erzähltext oder eine Lösung), steht diese Aufforderung als eigener Stichpunkt " +
  "in der passenden Phase und ist unterstrichen, z. B. „- __Lehrkraft liest [[pdf:<file_id>|Vorlesetext – Die Arche Noah]] vor.__“ – unterstrichen wird nur diese Aufforderung.";

const gstr = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
const gclip = (s, n) => { s = gstr(s); return s.length > n ? s.slice(0, n) + " […gekürzt]" : s; };
const gsArea = (a) => (a === "student" ? "für die Kinder" : a === "teacher" ? "nur für die Lehrkraft" : a === "print" ? "zum Ausdrucken" : a);

/* Kontextblock einer Grundschul-Sitzung (Prompt und get_lesson). ctx = {course (gsCourseOut), classSize, lesson: {title, topic, durationMin, date,
   startTime, ideas, homework}, materials: [{id?, name, area, kind, text?}], unitText} */
export function gsLessonContext(ctx, opt = {}) {
  const c = ctx.course || {}, L = ctx.lesson || {};
  const lines = [
    "Schulform: Grundschule in Hessen (die Kinder arbeiten nicht digital)",
    "Fach: " + (c.subjectName || "Religion"),
    ...(c.description ? ["Ziel des Kurses (Beschreibung der Lehrkraft): " + gclip(c.description, 2000).replace(/\s*\n\s*/g, " ")] : []),
    "Lerngruppe: " + (c.label ? c.label + " – " + c.gradeText : "Grundschule"),
    ...(Number.isInteger(ctx.classSize) ? ["Schülerzahl laut Kurseinstellungen: " + ctx.classSize] : []),
    "Unterrichtssitzung: " + (L.title || "(noch ohne Titel)"),
    "Thema: " + (L.topic || "(noch nicht festgelegt)"),
    "Dauer: " + (L.durationMin ? L.durationMin + " Minuten" : "(noch nicht angegeben – bitte erfragen)"),
    L.date ? "Datum: " + fmtDay(L.date) + (L.startTime ? ", Beginn " + L.startTime + " Uhr" : "") : "Datum: noch ohne Termin",
  ];
  if (L.ideas) lines.push("Ideen und Wünsche der Lehrkraft (Notizfeld):\n" + gclip(L.ideas, opt.ideasMax || 4000));
  const mats = (ctx.materials || []).filter((m) => m.area === "student" || m.area === "teacher" || m.area === "print");
  if (mats.length) {
    lines.push("Vorhandene Materialien dieser Sitzung:");
    for (const m of mats) {
      lines.push("- " + m.name + " (" + gsArea(m.area) + (m.kind === "text" ? ", Text – erscheint nicht in der Elternansicht" : m.kind === "link" ? ", Link: " + gclip(m.text, 300) : m.kind === "file" && m.mime === "application/pdf" ? ", PDF" : "") +
        (m.id && m.kind === "file" ? ", file_id " + m.id : "") + ")");
      if (opt.materialText && (m.kind === "text" || m.kind === "file") && m.text) lines.push("  Inhalt:\n" + gclip(m.text, opt.materialMax || 3000).replace(/^/gm, "  "));
    }
  }
  if (ctx.unitText) lines.push(ctx.unitText);
  if (L.homework) lines.push("Hausaufgabe (für Eltern und Kinder sichtbar): " + gclip(L.homework, 3000));
  return lines.join("\n");
}

/* Name des Chats in claude.ai, z. B. „GS Religion 2ab - Sitzung 3 - Josef in Ägypten“ */
export function gsChatName(ctx) {
  const L = (ctx && ctx.lesson) || {}, rows = (ctx && ctx.unit && ctx.unit.rows) || [], c = (ctx && ctx.course) || {};
  const i = ctx && ctx.row ? rows.findIndex((r) => r && r.uid === ctx.row.uid) : -1;
  const title = gstr(L.title).replace(/\s+/g, " ").trim().slice(0, 90);
  return ["GS " + (c.short || "Grundschule"), i >= 0 ? "Sitzung " + (i + 1) : null, title || null].filter(Boolean).join(" - ");
}

/* ---------- Prompt für Claude: eine Stunde der Grundschule planen (claude.ai + Connector) ----------
 * ctx wie gsLessonContext + lessonId, unit, row, previousStop ({title, date, portal} der vorigen Stunde mit Zwischenstopp) */
export function claudeGsLessonPrompt(ctx) {
  const L = ctx.lesson || {}, id = ctx.lessonId, chatName = gsChatName(ctx), unit = !!ctx.unitText, ps = ctx.previousStop;
  const minutes = L.durationMin || (ctx.row && ctx.row.minutes) || null, n = Number.isInteger(ctx.classSize) ? ctx.classSize : null;
  return [
    "Chat-Name: " + chatName,
    "",
    SYSTEM_PROMPT_ROLE,
    "",
    "Die Lehrkraft bin ich. Wir planen zusammen die folgende Unterrichtssitzung an einer Grundschule in Hessen auf meiner Unterrichtsplattform „Unterricks“. Über den Connector „Unterricks“ liest du sie und speicherst Ergebnisse auf meinen Wunsch direkt dort. Arbeite gründlich, fachlich korrekt und kindgerecht.",
    "",
    "## Die Sitzung (von der Plattform übermittelt)",
    "Sitzungs-ID: " + id,
    gsLessonContext(ctx),
    ps ? "\n## Vorige Stunde nicht vollständig beendet\nIm Verlaufsplan der vorigen Stunde „" + gstr(ps.title) + "“" + (ps.date ? " (" + fmtDay(ps.date) + ")" : "") + " habe ich einen Zwischenstopp markiert („" + STOP_LINE +
      "“: bis dorthin geschafft, alles danach ist noch offen):\n<<<\n" + gclip(ps.portal, 4000) + "\n>>>\nFrage mich, ob und wie der offene Teil in diese Stunde übernommen werden soll. Material daraus verweist du weiter mit seiner file_id." : null,
    "",
    "## Feste Vorgaben",
    "- Plane mit Minutenangaben je Phase, die zusammen die Dauer der Sitzung ergeben, und nenne die Sozialform.",
    "- Grundschulgerechte Methoden: Sitzkreis, Erzählung (gern mit Bildkarten), Bodenbild, Bewegung, Gestalten; kurze Phasen mit Wechsel zwischen Ruhe und Aktivität.",
    unit ? "- " + UNIT_RULE_BASE + " Stimme ich einer geänderten Stundenfrage oder einem geänderten groben Ablauf zu, halte das mit `update_unit_row` in der Einheit fest." : null,
    "- " + GS_RULE,
    "- In der Grundschule gibt es keinen Schulportal-Eintrag, keine Präsentation, keine Feibeitsblätter und keinen Sitzungscode: Der Stundenverlauf steht im Verlaufsplan.",
    "- Was Eltern sehen (Inhalt der Unterrichtsstunde, Hausaufgabe, Material für die Kinder, Bildkarten mit Erzähltexten), enthält nie Namen von Kindern.",
    "- Erfinde keine Quellen, Links oder Videos; kennzeichne Vorschläge, die ich prüfen sollte.",
    "",
    "## Gestaltungsregeln für Materialien (add_material_pdf)",
    materialDesignText(),
    "Zusätzlich für die Grundschule (gehen vor):",
    GS_MATERIAL_RULES.map((r) => "- " + r).join("\n"),
    "",
    "## Gestaltungsregeln für Bildkarten (add_picture_cards)",
    CARD_DESIGN_RULES.map((r) => "- " + r).join("\n"),
    "- Bildkarten von Verlagen dürfen meist nicht online weitergegeben werden – gestalte die Karten selbst.",
    "",
    "## Vorgehen",
    "0. Dieser Chat soll „" + chatName + "“ heißen. Beginne deine erste Antwort mit der Zeile „Chat-Name: " + chatName + "“ (umbenennen kann ich den Chat in claude.ai nur selbst).",
    "1. Rufe zuerst mit dem Connector „Unterricks“ `get_lesson` mit der Sitzungs-ID " + id + " auf: Dort stehen die aktuellen Daten, der Verlaufsplan mit seiner Version, die PDF-Dateien des Kurses mit ihrer file_id und der Inhalt für die Eltern." +
      (ctx.unit && ctx.unit.id ? " Die ganze Unterrichtseinheit liefert `get_unit` mit der ID " + ctx.unit.id + "." : "") + " Die Vorgaben im Wortlaut (Curriculum) liefert `get_planning_basis` mit der Sitzungs-ID.",
    "2. Frage mich dann nach der Dauer (" + (minutes ? "laut Plattform " + minutes + " Minuten – stimmt das?" : "in der Plattform noch nicht eingetragen") + ") und nach Ideen, Geschichten, Materialien oder Wünschen. Warte auf meine Antwort.",
    "3. Plane mit mir dialogisch, bis ich zufrieden bin.",
    "4. Speichere nur, was ich freigebe, direkt in der Plattform – in dieser Reihenfolge:",
    "   - Arbeitsblätter und anderes Material gestaltest du als HTML-Seite und legst es mit `add_material_pdf` ab: `bereich` \"schueler\" für Material, mit dem die Kinder arbeiten (Eltern sehen es nach der Stunde)" +
      (n ? ", mit `anzahl` " + n + " (laut Kurseinstellungen) – dann steht es auch auf meiner Druckliste" : ", mit `anzahl` (frag mich nach der Zahl der Kinder) – dann steht es auch auf meiner Druckliste") +
      "; \"druck\" nur für Material, das Eltern nicht sehen sollen (Tafel- und Bodenbilder, Kärtchen); \"lehrkraft\" nur für mich. Merke dir die file_id jeder Datei.",
    "   - Erzählst du eine Geschichte mit Bildkarten, gestaltest du sie und legst sie mit `add_picture_cards` ab – mit einem gekürzten Erzähltext je Karte (zum Nacherzählen mit den Kindern zu Hause).",
    "   - Den Stundenverlauf speicherst du mit `save_verlaufsplan` (übergib `base_version` aus `get_lesson`): " + VERLAUFSPLAN_RULES + " Setze selbst keinen Zwischenstopp – den trage ich ein, wenn wir nicht fertig werden.",
    "   - Den „Inhalt der Unterrichtsstunde“ für die Eltern speicherst du mit `update_lesson` und `inhalt_eltern`: 2–3 elternverständliche Sätze, worum es ging und was die Kinder lernen sollten. Eine Hausaufgabe nur, wenn wir eine vereinbart haben (`hausaufgabe`, schlichter Text ohne Zeichen).",
    "   - Den ausgearbeiteten Stundenentwurf (Verlauf mit Minuten, Begründung, Erwartungen) speicherst du mit `save_planning_result`.",
    unit ? "   - Eine abgestimmte Abweichung von der Einheit (Stundenfrage, grober Ablauf) hältst du mit `update_unit_row` fest." : null,
    "5. Sage mir zum Schluss kurz, was du gespeichert hast.",
    "",
    "Vorlage für den Verlaufsplan (so sieht er aus; <file_id> durch die Kennungen deiner Dateien ersetzen):",
    VERLAUFSPLAN_EXAMPLE,
    "",
    "Falls der Connector „Unterricks“ in diesem Chat nicht verfügbar ist, sage es mir sofort (beim ersten Mal muss er im Chat verbunden und sein Zugriff erlaubt werden). Plane dann mit den Angaben oben und gib mir den Verlaufsplan am Ende zum Kopieren aus.",
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}
