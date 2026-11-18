// gsplanning.js – Prompts für Claude in der Grundschule (Wunsch der Lehrkraft vom 12.11.2026): Einheit planen. Gemeinsam für Browser und
// Worker (keine DOM-Zugriffe). Die Kinder arbeiten nicht digital: nur analoges, ausdruckbares Material.
import { fmtDay, SYSTEM_PROMPT_ROLE, UNIT_RULE_BASE, materialDesignText, summarySaveStep, SUMMARY_FALLBACK, berlinToday, CARD_PRINT, printFileName } from "./shared.js";
import { lessonSlots, paramsText, freeSlots, normalizeParams, stopCarrySection, stopCarryStep, stopFallbackText, freeShiftText, freeDaysInRange, freeBreakOf, freeRowNote } from "./planning.js";
import { bringSaveStep } from "./bring.js";
import { shareSaveStep } from "./sharelib.js";

export const GS_RULE = "In der Grundschule arbeiten die Kinder nicht digital: Plane ausschließlich analoges Material (ausdruckbare Arbeitsblätter, Bildkarten, Tafel- und Bodenbilder) – keine Feibeitsblätter, keine Escape-Rooms, keine Online-Aufgaben, keine Präsentation zum Mitverfolgen.";

/* ---------- Prompt für Claude: Unterrichtseinheit eines Grundschulkurses planen (claude.ai + Connector) ----------
 * ctx = {unitId, course (Kurs wie vom Server: subjectName, description, gradeText, …), title, params, slots, bases: [Titel], missing: [Text], classSize,
 * hasSessions (die Einheit hat schon Sitzungen → Claude speichert mit der uid jeder Stunde)} */
export function claudeGsUnitPrompt(ctx) {
  const c = ctx.course || {}, slots = lessonSlots(ctx.slots || []), fach = c.subjectName || "Religion";
  const list = slots.map((s, i) => (i + 1) + ". " + fmtDay(s.date) + (s.time ? " " + s.time : "") + " (" + s.minutes + " min)").join("\n");
  const steps = [
    "1. Rufe zuerst mit dem Connector „Unterricks“ `get_planning_basis` für die Einheit " + ctx.unitId + " auf und lies die Planungsgrundlagen gründlich. Beziehe dich bei allen Vorschlägen auf die Vorgaben zu den Unterrichtsinhalten dieses Jahrgangs.",
    "2. Kläre mit mir kurz Thema und Schwerpunkt der Einheit im Rahmen der Vorgaben und warte auf meine Entscheidung.",
    "3. Schlage mir **drei** zentrale Lernaufgaben vor (kompetenzorientiert, grundschulgerecht, mit einem Lernprodukt der Kinder, z. B. ein gestaltetes Bild, ein kleines Buch, ein Bodenbild oder ein Rollenspiel). Die zentrale Lernaufgabe ist das Ziel der Unterrichtseinheit. Warte, bis ich eine festlege – ohne festgelegte Lernaufgabe entwickelst du noch keinen Ablauf.",
    "4. Entwickle dann das **Leupold-Schema**: links die Ausgangslage der Lerngruppe (Lernvoraussetzungen und angestrebter Kompetenzschwerpunkt), in der Mitte die Lernschritte der Einheit als Abfolge von Paaren aus Tätigkeitsbeschreibung in kindgerechter Sprache und knappem Schritt-Titel, rechts die festgelegte Lernaufgabe. Die Lernschritte führen folgerichtig von der Ausgangslage zur Lernaufgabe.",
    "5. Stelle darauf aufbauend den Ablauf der Unterrichtseinheit **tabellarisch** dar: genau " + slots.length + " Zeilen, eine je verfügbarer Sitzung in zeitlicher Reihenfolge. Spalte 1: Stundenfrage, Spalte 2: grober Stundenablauf in Stichpunkten (kurze Phasen, Sitzkreis, Erzählung, Bewegung, Gestalten). Ordne jede Stunde einem Lernschritt zu; die letzten Stunden münden in die zentrale Lernaufgabe.",
    "6. Wenn ich zufrieden bin, speichere das Ergebnis mit `save_unit_plan` in der Einheit " + ctx.unitId + " (Planungsgrundlage, Lernaufgabe, Ausgangslage, Lernschritte und die Stunden mit Stundenfrage, Ablauf und Nummer des Lernschritts). Ich prüfe und bearbeite den Plan danach in der Plattform; die Sitzungen legt die Plattform mit den Terminen an." +
      // Einheit mit Sitzungen: ohne uid lehnt die Plattform den Plan ab (Abschlussprüfung F17)
      (ctx.hasSessions ? " Diese Einheit hat schon Sitzungen: Rufe vorher `get_unit` für die Einheit " + ctx.unitId + " auf und gib beim Speichern bei jeder Stunde, die bleibt, ihre `uid` von dort an – sie behält ihre Sitzung samt Verlaufsplan und Material; Stunden ohne `uid` sind neu. Eine Stunde, deren Sitzung schon geplant ist, darf nicht wegfallen; ganz ohne `uid` speichert die Plattform nicht." : ""),
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
/* ---------- Bildkarten bei jeder Geschichte im Sitzkreis (Nachtrag 31 vom 16.11.2026: „Ja, immer Bildkarten“) ----------
 * Erzählt die Lehrkraft im Sitzkreis eine Geschichte, gehören Bildkarten dazu; neue Bildkarten stehen von selbst auf ihrer Druckliste (CARD_PRINT: 1x, einseitig,
 * farbig – „1x - farbig - einseitig - <Kurs> - <Titel>.pdf“, Nachtrag 32). Prompt „Stunde mit Claude planen“, Überarbeitung der Einheit, get_lesson, add_picture_cards und
 * save_verlaufsplan nutzen dieselben Bausteine. Die Konzentrationsaufgabe (Nachtrag 27) bleibt davon unberührt. */
export const CARD_PRINT_TEXT = CARD_PRINT.copies + "x, einseitig, farbig";
/* Druckangaben in Worten wie CARD_PRINT_TEXT („1x, einseitig, farbig“, „3x, beidseitig, schwarz-weiß“) – für die Antwort von save_verlaufsplan zu wiederverwendeten
   Bildkarten: die Druckangaben DIESER Sitzung (Nachtrag 31b, Prüfung – vorher immer CARD_PRINT_TEXT, auch wenn die Lehrkraft sie geändert hatte) */
export const printSettingsText = (p) => p.copies + "x, " + (p.duplex ? "beidseitig" : "einseitig") + ", " + (p.color ? "farbig" : "schwarz-weiß");
// Name auf der Druckliste mit Platzhaltern für Kurs und Titel (Nachtrag 32): „1x - farbig - einseitig - <Kurs> - <Titel>.pdf“
export const printNamePattern = (p) => printFileName({ ...p, name: "Titel", course: "Kurs" }).replace(/ - Kurs - Titel\.pdf$/, " - <Kurs> - <Titel>.pdf");
export const CARD_PRINT_NAME = printNamePattern(CARD_PRINT);
// me: im Prompt spricht die Lehrkraft („meiner Druckliste“)
export const cardsWhere = (me = false) => "Neue Bildkarten stehen von selbst auf " + (me ? "meiner Druckliste" : "der Druckliste der Lehrkraft") + " („" + CARD_PRINT_NAME + "“: " + CARD_PRINT_TEXT + ").";
export const CARDS_METHOD = "Erzählung mit Bildkarten";   // vorher „Erzählung (gern mit Bildkarten)“
// Prüfung: ohne „du“ formuliert – erzählt bzw. vorgelesen wird in der Stunde von der Lehrkraft; „Erzählst du …“ konnte Claude als „nicht meine Aufgabe“ lesen
export const CARDS_ALWAYS = "Wird in der Stunde im Sitzkreis eine Geschichte erzählt oder vorgelesen (auch eine biblische Geschichte), gehören immer Bildkarten dazu: Du gestaltest sie selbst und legst sie mit `add_picture_cards` ab. " + cardsWhere(true);
export const cardsPromptStep = () => "   - Zu jeder Geschichte, die im Sitzkreis erzählt oder vorgelesen wird, gestaltest du Bildkarten und legst sie mit `add_picture_cards` ab – mit einem gekürzten Erzähltext je Karte " +
  "(zum Nacherzählen mit den Kindern zu Hause); sie stehen dann von selbst auf meiner Druckliste (" + CARD_PRINT_TEXT + "). Im Verlaufsplan stehen sie in der Erzählphase ([[pdf:<file_id>]]).";
// Überarbeitung der Einheit (Grundschule): plant Claude dabei eine Sitzung neu, gehören zu einer Geschichte im Sitzkreis Bildkarten
export const CARDS_REVISION = " Erzählt eine neu geplante oder geänderte Stunde im Sitzkreis eine Geschichte, gehören Bildkarten dazu (`add_picture_cards`; sie stehen dann von selbst auf meiner Druckliste: " + CARD_PRINT_TEXT + ").";
/* Erzählt der Verlaufsplan eine Geschichte? Bewusst großzügig (lieber einmal unnötig erinnern als eine Geschichte ohne Bildkarten): eine Zeile zählt, wenn sie
   ein deutliches Wort für eine erzählte oder vorgelesene Geschichte enthält (Geschichte, Erzählung, vorlesen, Bilderbuch, Kamishibai, Märchen, Legende, Gleichnis,
   Fabel, Kinderbibel, nacherzählen …) oder „erzähl…“ – außer die Kinder erzählen selbst von etwas (Erzählkreis, Erzählrunde, „Kinder erzählen von …“).
   Ein Sitzkreis wird nicht verlangt: Geschichten werden in der Grundschule fast immer im Kreis erzählt, und „Sitzkreis“ steht oft nur in der Überschrift der Phase.
   Verweise [[pdf:…]] zählen nur mit ihrer Beschriftung („[[pdf:…|Vorlesetext – Die Arche Noah]]“). → die erste passende Zeile (gekürzt, ohne Zeichen) oder null
   Prüfung: auch vorgetragene Texte („trägt … vor“, Vortrag), Bibeltexte und das Erzählen mit Egli- bzw. biblischen Erzählfiguren zählen. */
const STORY_STRONG = /geschicht|erzählung|vorles|vorgeles|\bliest\b.*\bvor\b|\blese\b.*\bvor\b|bilderbuch|kamishibai|erzähltheater|märchen|legende|gleichnis|fabel|kinderbibel|nacherzähl|vortrag|vorgetragen|\bträgt\b.*\bvor\b|bibeltext|\begli/;
const STORY_TELL = /erzähl/, STORY_KIDS = /erzählkreis|erzählrunde|erzählstein|kinder erzählen|erzählen (?:sie |die kinder |einander |sich )?(?:von|über)\b/;
export function storyInPlan(text) {
  const lines = String(text == null ? "" : text).replace(/\[\[pdf:[a-f0-9]{16}\|([^\]\n]*)\]\]/g, "$1").replace(/\[\[pdf:[^\]\n]*\]\]/g, "").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/\*\*|~~|__|--/g, "").replace(/^\s*-\s+/, "").replace(/\s+/g, " ").trim(), l = line.toLowerCase();
    if (!l || l.startsWith("⏸")) continue;
    if (STORY_STRONG.test(l) || (STORY_TELL.test(l) && !STORY_KIDS.test(l))) return line.length > 120 ? line.slice(0, 119) + "…" : line;
  }
  return null;
}
// Antwort von save_verlaufsplan und get_lesson: der Verlaufsplan erzählt eine Geschichte, aber die Sitzung hat keine Bildkarten
export const cardsMissingText = (line) => " Der Verlaufsplan erzählt eine Geschichte („" + line + "“), aber diese Sitzung hat noch keine Bildkarten – zu jeder Geschichte im Sitzkreis " +
  "gehören Bildkarten: gestalte sie mit der Lehrkraft, lege sie nach ihrer Freigabe mit add_picture_cards ab – sie stehen dann von selbst auf der Druckliste der Lehrkraft (" + CARD_PRINT_TEXT +
  ") – und nenne sie in der Erzählphase ([[pdf:<file_id>]]). Wird in der Stunde keine Geschichte erzählt, gilt dieser Hinweis nicht.";
export const VERLAUFSPLAN_EXAMPLE = "**1) Ankommen im Sitzkreis (5 Min.)**\n- Begrüßungslied, Kerze anzünden\n**2) Erzählung mit Bildkarten (15 Min., Sitzkreis)**\n" +
  "- [[pdf:<file_id>]] Karten der Reihe nach zeigen und frei erzählen\n- __Lehrkraft liest [[pdf:<file_id>|Vorlesetext – Josef und seine Brüder]] vor.__\n**3) Arbeitsblatt (15 Min., Einzelarbeit)**\n- [[pdf:<file_id>]]\n" +
  "**4) Abschluss (10 Min., Sitzkreis)**\n- Gesprächsrunde: Was hat Josef seinen Brüdern verziehen?";
// Regeln des Verlaufsplans (Werkzeug save_verlaufsplan und Prompt „Stunde mit Claude planen“)
export const VERLAUFSPLAN_RULES = "Nummerierte, fette Phasen mit Minuten und Sozialform (**1) Titel (10 Min., Sitzkreis)**), darunter Stichpunkte mit „- “; " +
  "jede PDF-Datei genau an der Stelle, an der sie benutzt wird, als [[pdf:<file_id>]] (Unterricks zeigt dort ihren Namen gelb markiert); weitere Zeichen: **fett**, ~~kursiv~~, __unterstrichen__. " +
  "Muss die Lehrkraft an einer Stelle auf Material zurückgreifen, das nur sie hat (bereich \"lehrkraft\", z. B. ein Vorlesetext, ein Erzähltext oder eine Lösung), steht diese Aufforderung als eigener Stichpunkt " +
  "in der passenden Phase und ist unterstrichen, z. B. „- __Lehrkraft liest [[pdf:<file_id>|Vorlesetext – Die Arche Noah]] vor.__“ – unterstrichen wird nur diese Aufforderung.";

/* ---------- Konzentrationsaufgabe (Nachtrag 27 vom 15.11.2026) ----------
 * Für Kinder, die ihre Aufmerksamkeit in Plenumsphasen nur bündeln können, wenn sie den Sitzkreis verlassen und beim Zuhören ausmalen: in jeder
 * geplanten Sitzung der Grundschule, nur auf der Druckliste der Lehrkraft (Bereich „druck“, 5x, beidseitig, schwarz-weiß) – nie für Eltern oder Kinder.
 * Prompt „Stunde mit Claude planen“, Überarbeitung der Einheit, get_lesson, add_material_pdf und save_verlaufsplan nutzen dieselben Bausteine. */
export const CONC_TITLE = "Konzentrationsaufgabe";
export const CONC_PRINT = { copies: 5, duplex: true, color: false };
export const CONC_PAGES_MAX = 2;
export const CONC_WHY = "In jeder Klasse gibt es Kinder, die ihre Aufmerksamkeit nur bündeln können, wenn sie in Plenumsphasen den Sitzkreis verlassen und während des Zuhörens etwas ausmalen. " +
  "Was sie ausmalen, zeigt den Unterrichtsinhalt – so verknüpfen sie das Gehörte mit dem Bild und können der Stunde inhaltlich folgen.";
export const CONC_RULES = [
  "Höchstens zwei DIN-A4-Seiten im PDF (hochkant): @page { size: A4; margin: 12mm }; jede Seite ein Block mit height: 272mm, overflow: hidden und break-after: page (der letzte ohne) – nichts darf auf eine dritte Seite laufen.",
  "Überschrift „Konzentrationsaufgabe – <Thema der Stunde>“, Kopf nur „Name:“ und „Datum:“.",
  "Zuerst mindestens zwei Ausmalbilder, die den aktuellen Unterrichtsinhalt zeigen, in der Reihenfolge der Stunde (z. B. Bilder zur Geschichte, die die Lehrkraft erzählt): " +
    "Inline-SVG mit kräftigen schwarzen Konturen und großen weißen Flächen zum Ausmalen, keine grauen oder farbigen Füllungen, kindgerecht und ohne Text verständlich.",
  "Danach das Symbol einer roten Karte: Inline-SVG einer hochkanten Karte mit abgerundeten Ecken, rot gefüllt mit dickem schwarzem Rand (auch schwarz-weiß gedruckt als Karte erkennbar), " +
    "mit role=\"img\" und aria-label=\"Rote Karte\" – kein Emoji.",
  "Erst nach der roten Karte eine weitere, altersgerechte Aufgabe, die den Inhalt dieser Stunde abfragt – mit wenig Lesen (z. B. ankreuzen, verbinden, malen oder ein einzelnes Wort schreiben).",
];
// Speicherangaben (Prompt, get_lesson): Bereich, Anzahl, Druckart und Titel
export const concSaveArgs = (topic) => "`add_material_pdf` (`bereich` \"druck\", `anzahl` " + CONC_PRINT.copies + ", `beidseitig` true, `farbe` false, `titel` „" + CONC_TITLE + " – <Thema der Stunde>“" +
  (topic ? ", hier z. B. „" + CONC_TITLE + " – " + topic + "“" : "") + ")";
// me: im Prompt spricht die Lehrkraft („meiner Druckliste“)
export const concWhere = (me = false) => "Dann steht sie nur auf " + (me ? "meiner Druckliste" : "der Druckliste der Lehrkraft") + " („" + printNamePattern(CONC_PRINT).replace(/<Titel>\.pdf$/, CONC_TITLE + " – ….pdf") +
  "“), nie bei Eltern oder Kindern.";
// Name einer Datei (mit oder ohne .pdf) bzw. Titel: ist das die Konzentrationsaufgabe? (auch „Konzentrations-Aufgabe: …“)
const CONC_RE = /^\s*konzentrations[\s-]*aufgabe(?![a-zäöüß])/i;
export const isConcName = (name) => CONC_RE.test(typeof name === "string" ? name : "");
// Titel einheitlich „Konzentrationsaufgabe – <Thema>“ (Name auf der Druckliste); ohne Thema das der Sitzung
export function concTitleOf(raw, topic) {
  const rest = String(raw == null ? "" : raw).replace(/\.pdf\s*$/i, "").replace(CONC_RE, "").replace(/^[\s\-–—:|,.]+/, "").replace(/\s+/g, " ").trim();
  const t = rest || String(topic == null ? "" : topic).replace(/\s+/g, " ").trim();
  return CONC_TITLE + (t ? " – " + t : "");
}
// Prompt „Stunde mit Claude planen“ (Grundschule): eigener Abschnitt vor „## Vorgehen“ und ein Speicherschritt nach den Bildkarten (vor dem Verlaufsplan)
export const concPromptSection = () => ["", "## " + CONC_TITLE + " (gehört zu jeder Sitzung)",
  CONC_WHY + " Gestalte deshalb zusammen mit dem übrigen Material dieser Sitzung die „" + CONC_TITLE + "“ für diese Kinder und stelle sie mir mit dem übrigen Material vor. " +
  "Ich drucke sie " + CONC_PRINT.copies + "-mal beidseitig in Schwarz-Weiß aus; sie ist nur für mich. Hat die Sitzung schon eine (siehe `get_lesson`), passe sie an, statt eine zweite anzulegen.",
  ...CONC_RULES.map((r) => "- " + r)].join("\n");
export const concPromptStep = (L) => "   - Die " + CONC_TITLE + " speicherst du mit " + concSaveArgs(gstr((L && (L.topic || L.title)) || "").replace(/\s+/g, " ").trim().slice(0, 120)) + ". " + concWhere(true) +
  " Im Verlaufsplan steht sie in der ersten Plenumsphase als eigener Stichpunkt, z. B. „- " + CONC_TITLE + " [[pdf:<file_id>]] für Kinder, die beim Zuhören am Platz ausmalen“.";
// Überarbeitung der Einheit (Grundschule): plant Claude dabei eine Sitzung neu, gehört ihre Konzentrationsaufgabe dazu
export const CONC_REVISION = " Planst du dabei eine Sitzung neu oder änderst ihren Inhalt, gehört auch ihre „" + CONC_TITLE + "“ dazu (für Kinder, die beim Zuhören ausmalen; nur auf meiner Druckliste) – " +
  "ob es sie schon gibt, wie sie aufgebaut ist und wie du sie ablegst, sagt `get_lesson` dieser Sitzung.";
// Antwort von save_verlaufsplan: fehlt die Konzentrationsaufgabe bzw. steht sie nicht im Verlaufsplan
export const concMissingText = (topic) => " Die „" + CONC_TITLE + "“ fehlt in dieser Sitzung noch (für Kinder, die beim Zuhören ausmalen; Zweck und Aufbau siehe get_lesson) – " +
  "gestalte sie mit der Lehrkraft und lege sie nach ihrer Freigabe mit " + concSaveArgs(topic) + " ab; nenne sie dann im Verlaufsplan.";
export const concUnplannedText = (ids) => " Die „" + CONC_TITLE + "“ steht noch nicht im Verlaufsplan – nenne sie in der ersten Plenumsphase als eigenen Stichpunkt (" + ids.map((id) => "[[pdf:" + id + "]]").join(" oder ") + ").";
const concPlural = (n) => n + (n === 1 ? " Seite" : " Seiten");
/* Abschnitt „Konzentrationsaufgabe“ von get_lesson (Grundschule): gibt es sie schon (Druckliste, Seiten) – sonst Zweck, Aufbau und Ablage.
 * files = Dateien der Sitzung (GS_CTX_FILES), topic = Thema bzw. Titel der Sitzung, printName = printFileName aus shared.js */
export function concSection(files, topic, printName) {
  const fs = (files || []).filter((f) => f && f.area !== "archive" && f.cards == null && isConcName(f.name));
  const out = ["", "## " + CONC_TITLE + " (gehört zu jeder Sitzung der Grundschule; nur für die Lehrkraft)"];
  if (!fs.length) return [...out, "Fehlt noch. " + CONC_WHY + " Gestalte sie zusammen mit dem übrigen Material dieser Sitzung, stelle sie der Lehrkraft vor und lege sie nach ihrer Freigabe mit " + concSaveArgs(topic) + " ab. " + concWhere(), "Aufbau:", ...CONC_RULES.map((r) => "- " + r)];
  for (const f of fs) {
    const st = f.status !== "ready" ? (f.render_error ? "Druck fehlgeschlagen: " + f.render_error : "wartet auf den Druck") : f.pages ? concPlural(f.pages) : "fertig";
    const where = f.area === "print" ? "auf der Druckliste als „" + printName({ name: f.name, copies: f.print_copies, duplex: f.print_duplex !== 0, color: f.print_color === 1 }) + "“"
      : "Achtung: liegt nicht auf der Druckliste, sondern " + (f.area === "student" ? "beim Material für die Kinder – Eltern sehen sie nach der Stunde" : "beim Material nur für die Lehrkraft") +
        "; sie gehört nur auf die Druckliste – sag es der Lehrkraft";
    // Rückfall add_print_material (Text-Druckvorlage ohne Bilder): kein PDF – im Verlaufsplan nicht verweisbar
    out.push("- file_id " + f.id + ": „" + f.name + "“ (" + where + "; " + st + ")" + (f.kind === "text" ? " – Druckvorlage als Text (Rückfall, ohne Ausmalbilder; im Verlaufsplan nicht verweisbar): " +
      "gestalte sie mit add_material_pdf neu, sobald der PDF-Druck wieder geht" : " → [[pdf:" + f.id + "]]"));
    if (f.status === "ready" && f.pages > CONC_PAGES_MAX) out.push("  Achtung: " + concPlural(f.pages) + " – höchstens " + CONC_PAGES_MAX + " A4-Seiten" +
      (f.designed ? "; kürze sie (add_material_pdf mit file_id " + f.id + ")." : " (von der Lehrkraft hochgeladen)."));
  }
  if (fs.length > 1) out.push("Es gibt " + fs.length + " Konzentrationsaufgaben – überarbeite die passende mit ihrer file_id, statt eine weitere anzulegen; überzählige löscht die Lehrkraft in der Sitzung.");
  if (fs.some((f) => f.designed)) out.push("Ändert sich der Inhalt der Stunde, passe sie an (add_material_pdf mit ihrer file_id).");
  return out;
}

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
  const stopOpt = { gs: true, unitId: ctx.unit && ctx.unit.id ? ctx.unit.id : null, unit: ctx.unit, now: ctx.now };
  const k = (x) => (ps && x >= 2 ? x + 1 : x) + ". ";   // mit Zwischenstopp der vorigen Stunde: eigener Schritt nach get_lesson
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
    ps ? stopCarrySection(ps, stopOpt) : null,
    "",
    "## Feste Vorgaben",
    "- Plane mit Minutenangaben je Phase, die zusammen die Dauer der Sitzung ergeben, und nenne die Sozialform.",
    "- Grundschulgerechte Methoden: Sitzkreis, " + CARDS_METHOD + ", Bodenbild, Bewegung, Gestalten; kurze Phasen mit Wechsel zwischen Ruhe und Aktivität.",
    "- " + CARDS_ALWAYS,
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
    concPromptSection(),
    "",
    "## Vorgehen",
    "0. Dieser Chat soll „" + chatName + "“ heißen. Beginne deine erste Antwort mit der Zeile „Chat-Name: " + chatName + "“ (umbenennen kann ich den Chat in claude.ai nur selbst).",
    "1. Rufe zuerst mit dem Connector „Unterricks“ `get_lesson` mit der Sitzungs-ID " + id + " auf: Dort stehen die aktuellen Daten, der Verlaufsplan mit seiner Version, die PDF-Dateien des Kurses mit ihrer file_id und der Inhalt für die Eltern." +
      (ctx.unit && ctx.unit.id ? " Die ganze Unterrichtseinheit liefert `get_unit` mit der ID " + ctx.unit.id + "." : "") + " Die Vorgaben im Wortlaut (Curriculum) liefert `get_planning_basis` mit der Sitzungs-ID.",
    ps ? stopCarryStep(ps, 2, stopOpt) : null,
    k(2) + "Frage mich dann nach der Dauer (" + (minutes ? "laut Plattform " + minutes + " Minuten – stimmt das?" : "in der Plattform noch nicht eingetragen") + ") und nach Ideen, Geschichten, Materialien oder Wünschen. Warte auf meine Antwort.",
    k(3) + "Plane mit mir dialogisch, bis ich zufrieden bin.",
    k(4) + "Speichere nur, was ich freigebe, direkt in der Plattform – in dieser Reihenfolge:",
    "   - Arbeitsblätter und anderes Material gestaltest du als HTML-Seite und legst es mit `add_material_pdf` ab: `bereich` \"schueler\" für Material, mit dem die Kinder arbeiten (Eltern sehen es nach der Stunde)" +
      (n ? ", mit `anzahl` " + n + " (laut Kurseinstellungen) – dann steht es auch auf meiner Druckliste" : ", mit `anzahl` (frag mich nach der Zahl der Kinder) – dann steht es auch auf meiner Druckliste") +
      "; \"druck\" nur für Material, das Eltern nicht sehen sollen (Tafel- und Bodenbilder, Kärtchen); \"lehrkraft\" nur für mich. Merke dir die file_id jeder Datei.",
    cardsPromptStep(),
    concPromptStep(L),
    "   - Den Stundenverlauf speicherst du mit `save_verlaufsplan` (übergib `base_version` aus `get_lesson`): " + VERLAUFSPLAN_RULES + " Setze selbst keinen Zwischenstopp – den trage ich ein, wenn wir nicht fertig werden.",
    "   - Den „Inhalt der Unterrichtsstunde“ für die Eltern speicherst du mit `update_lesson` und `inhalt_eltern`: 2–3 elternverständliche Sätze, worum es ging und was die Kinder lernen sollten. Eine Hausaufgabe nur, wenn wir eine vereinbart haben (`hausaufgabe`, schlichter Text ohne Zeichen).",
    bringSaveStep(true),   // Nachtrag 28: Gegenstände, die ich mitbringen muss
    "   - Den ausgearbeiteten Stundenentwurf (Verlauf mit Minuten, Begründung, Erwartungen) speicherst du mit `save_planning_result`.",
    unit ? "   - Eine abgestimmte Abweichung von der Einheit (Stundenfrage, grober Ablauf) hältst du mit `update_unit_row` fest." : null,
    summarySaveStep(true),
    shareSaveStep("gs", "gs"),   // Nachtrag 39: Absatz für die Weitergabe an Kolleg:innen
    k(5) + "Sage mir zum Schluss kurz, was du gespeichert hast.",
    "",
    "Vorlage für den Verlaufsplan (so sieht er aus; <file_id> durch die Kennungen deiner Dateien ersetzen):",
    VERLAUFSPLAN_EXAMPLE,
    "",
    "Falls der Connector „Unterricks“ in diesem Chat nicht verfügbar ist, sage es mir sofort (beim ersten Mal muss er im Chat verbunden und sein Zugriff erlaubt werden). Plane dann mit den Angaben oben und gib mir den Verlaufsplan am Ende zum Kopieren aus" + SUMMARY_FALLBACK + "." +
      (ps ? stopFallbackText(ps, stopOpt) : ""),
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ---------- Prompt für Claude: Einheit nach Ausfällen überarbeiten (roter Kasten „Die Einheit muss … überarbeitet werden“) ----------
 * ctx = {unit (wie GET /api/teacher/units/<id>: rows, plan, params, revise, lessons mit hasPlan/pdfs/cards, course), now} */
export function claudeUnitRevisionPrompt(ctx) {
  const u = ctx.unit || {}, rows = u.rows || [], plan = u.plan || {}, rv = u.revise || { items: [] }, now = ctx.now || Date.now();
  const c = (u.course && u.course.gs) || {}, n = u.course && Number.isInteger(u.course.classSize) ? u.course.classSize : null, fach = c.subjectName || "Religion";
  const p = normalizeParams(u.params), at = (d, t) => fmtDay(d) + (t ? " " + t : "");
  const byRow = new Map((u.lessons || []).filter((l) => l.row && !l.cancelled).map((l) => [l.row, l]));
  const all = rv.items || [], undated = rows.map((r, i) => ({ r, i })).filter((x) => !x.r.date);
  // Krankmeldungen und Verschiebungen wegen unterrichtsfreier Tage (Nachtrag 24) getrennt – ohne letztere bleibt der Prompt wie bisher
  const items = all.filter((x) => x.kind !== "free"), freeItems = all.filter((x) => x.kind === "free");
  const sb = freeDaysInRange(u.params);
  const lengths = all.flatMap((x) => x.lengths || []);
  const free = freeSlots(u.params, rows, now);
  // hasContent (Server: nicht leer wie beim Speichern geprüft – auch Ideen, Hinweis oder Inhalt für die Eltern, Elternlink, anderes Material, Planungsverlauf):
  // so nennt der Prompt nur Stunden „noch nicht geplant“, die die Plattform beim Speichern auch weglassen ließe (Abschlussprüfung F21)
  const state = (l) => { if (!l) return "noch keine Sitzung"; const has = [l.hasPlan ? "Verlaufsplan" : null, l.pdfs ? l.pdfs + (l.pdfs === 1 ? " PDF" : " PDFs") : null, l.cards ? "Bildkarten" : null].filter(Boolean);
    return "Sitzung " + l.id + (has.length ? " – schon geplant: " + has.join(", ") : l.hasContent === true ? " – hat schon Inhalte (z. B. Ideen, Hinweis oder Inhalt für die Eltern, Elternlink, Material, Planungsverlauf), nicht weglassen" : " – noch nicht geplant"); };
  // Stunden, die trotzdem an einem unterrichtsfreien Tag liegen („Nur speichern“, Nachtrag 24) – ohne solche bleibt der Prompt wie bisher
  const onFree = freeBreakOf(u.params), today = berlinToday(now);
  const rowLines = rows.map((r, i) => (i + 1) + ". [uid " + r.uid + "] " + (r.date ? at(r.date, r.time) : "ohne Termin") + (r.minutes ? " (" + r.minutes + " Min.)" : "") + ": „" + r.stundenfrage + "“" +
    (r.schritt != null && (plan.schritte || [])[r.schritt] ? " [Lernschritt " + (r.schritt + 1) + "]" : "") + " – " + state(byRow.get(r.uid)) + freeRowNote(onFree, r.date, today));
  const steps = (plan.schritte || []).map((x, i) => (i + 1) + ". " + x.titel + (x.beschreibung ? " – " + x.beschreibung : ""));
  return [
    "Du bist eine erfahrene Fachdidaktikerin bzw. ein erfahrener Fachdidaktiker für " + fach + " an einer Grundschule in Hessen und überarbeitest mit mir eine Unterrichtseinheit meiner Unterrichtsplattform „Unterricks“. Arbeite gründlich, kindgerecht und dialogisch: Warte an den markierten Stellen auf meine Entscheidung.",
    "",
    "## Was passiert ist",
    (items.length || !freeItems.length ? "Wegen Ausfällen (Lehrkraft krank: " + (items.length ? items.map((x) => at(x.date, x.time)).join("; ") : "–") + ") hat Unterricks die ausgefallene und alle folgenden Stunden der Einheit " + u.id +
      " („" + (u.title || plan.titel || "ohne Titel") + "“) um je einen Termin verschoben" : freeShiftText(freeItems, u.id, u.title || plan.titel || "ohne Titel")) +
      (items.length && freeItems.length ? ". " + freeShiftText(freeItems, null, null) : "") + (undated.length ? "; ohne Termin: " + undated.map((x) => "Stunde " + (x.i + 1) + " „" + x.r.stundenfrage + "“").join(", ") +
      " (Ende der Einheit am " + (p.end ? fmtDay(p.end) : "?") + ")" : "") + "." + (lengths.length ? " Geänderte Längen: " + lengths.map((g) => "Stunde " + g.n + " (" + g.from + " → " + g.to + " Min.)").join(", ") + "." : ""),
    "",
    "## Die Einheit jetzt",
    "- Kurs: " + (c.label || "Grundschule") + (c.gradeText ? " – " + c.gradeText : "") + (n ? ", " + n + " Kinder (laut Kurseinstellungen)" : ""),
    plan.lernaufgabe ? "- Zentrale Lernaufgabe (Ziel der Einheit): " + plan.lernaufgabe : null,
    steps.length ? "- Lernschritte:\n" + steps.map((x) => "  " + x).join("\n") : null,
    "- Stunden (uid = Kennung der Stunde):",
    ...rowLines.map((x) => "  " + x),
    "- Noch freie Termine bis zum Ende der Einheit: " + (free.length ? free.map((x) => at(x.date, x.time) + " (" + x.minutes + " Min.)").join("; ") : "keine"),
    sb.length ? "- Unterrichtsfreie Tage der Grundschule im Zeitraum (aus meinen Einstellungen, ohne Termine): " + sb.map((b) => b.label + " " + fmtDay(b.from) + (b.to !== b.from ? "–" + fmtDay(b.to) : "")).join("; ") : null,
    "",
    "## Vorgehen",
    "1. Rufe mit dem Connector „Unterricks“ `get_unit` mit der ID " + u.id + " auf (Ausfälle, Stunden ohne Termin, freie Termine und die uid jeder Stunde). Für einzelne Sitzungen liefert `get_lesson` Verlaufsplan und Material.",
    "2. Schlage mir zwei oder drei Möglichkeiten vor, wie die Einheit trotz der " + (items.length || !freeItems.length ? "Ausfälle" : "wegfallenden Termine") + " ihre zentrale Lernaufgabe erreicht – z. B. Stunden zusammenlegen oder kürzen, eine Stunde ohne Termin streichen oder mit einer anderen zusammenführen, oder die Einheit verlängern (stimme ich zu, trägst du das mit `extend_unit` ein: Die Plattform setzt das Ende auf den nächsten Termin laut Stundenplan, gibt zuerst den Stunden ohne Termin einen Termin und legt ihre Sitzungen an – sofort in der Einheit sichtbar). Nenne zu jeder Möglichkeit kurz Vor- und Nachteile.",
    "3. Warte auf meine Entscheidung.",
    "4. Soll verlängert werden, rufe zuerst `extend_unit` auf (mit `base_version` aus `get_unit` und `termine` – so viele Termine, wie gebraucht werden, höchstens 3; neue Stunden nur, wenn wir welche vereinbart haben). Speichere dann die überarbeitete Einheit mit `save_unit_plan` (mit `base_version` aus `get_unit` bzw. aus der Antwort von `extend_unit`) und gib bei jeder Stunde, die bleibt, ihre `uid` an. Stunden, deren Sitzung schon geplant ist oder schon Inhalte hat, lässt du nicht weg (Inhalt und Stundenfrage darfst du ändern); nur Stunden ohne Sitzung oder mit „noch nicht geplant“ dürfen wegfallen. Die Termine verteilt die Plattform neu.",
    "5. Passe betroffene Sitzungen nur nach meiner Zustimmung an (`save_verlaufsplan`, `update_lesson` mit `inhalt_eltern` und – für mich – `zusammenfassung_lehrkraft`, die „Zusammenfassung der Sitzung für die Lehrkraft“)." + CONC_REVISION + CARDS_REVISION,
    "",
    "Nenne nie Namen von Kindern.",
    "",
    "Falls der Connector „Unterricks“ in diesem Chat nicht verfügbar ist, sage es mir sofort (er muss in claude.ai unter „Connectors“ eingerichtet und im Chat aktiviert sein).",
  ].filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
}
