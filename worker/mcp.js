// mcp.js – Connector für claude.ai („Custom Connector“, Remote-MCP über Streamable HTTP, zustandslos, nur Werkzeuge).
// So nutzt die Lehrkraft Claude mit ihrem Pro-Abo erlaubt: Sie arbeitet in claude.ai, Claude liest und schreibt dort die Daten der
// Plattform. Unterstützt das aktuelle Protokoll (2026-07-28, ohne Handshake) und ältere Clients (initialize-Handshake).
// Zugang: geheimer Schlüssel in der Adresse (/mcp/<schlüssel>, für „Ohne Anmeldung“) oder als Authorization: Bearer.
import { HttpError, json, readJson, sha256Hex, timingSafeEqual, randomToken, LOCKS, lockedFor, registerFail, cleanText, cleanLine } from "./lib.js";
import { getSetting, setSetting } from "./db.js";
import { requireTeacher } from "./auth.js";
import { getLesson, lessonCtx, chatMessages, updateLesson, savePortal, insertDraft, lessonOut, fileOut, LIMITS } from "./lessons.js";
import { getUnit, unitFull, applyPlan, updateRow } from "./units.js";
import { planningBasis } from "./bases.js";
import { saveProposal, getSubstitute } from "./substitute.js";
import { paramsText, lessonSlots } from "../public/planning.js";
import { insertTextMaterial, insertPrintText } from "./files.js";
import { ESCAPE_FORMAT_HINT, PART_TYPES } from "../public/escape-data.js";
import { SUBJECTS, ALL_CLASSES, subjectName, gradeInfo, formatCode, lessonContext, chatTranscript, PORTAL_RULES, PORTAL_EXAMPLE, SYSTEM_PROMPT_ROLE, FEIBEITSBLATT_INFO, classShort, fmtDay } from "../public/shared.js";

const MODERN = "2026-07-28";
const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "unterricks", title: "Unterricks – Unterrichtsplattform", version: "1.0.0" };
const INSTRUCTIONS = "Unterricks ist die Unterrichtsplattform der Lehrkraft (Fächer: Politik und Wirtschaft, Evangelische Religion, Ethik; Klassen 5A–10H, EA–EH (acht Klassen a–h je Jahrgang) und in der Qualifikationsphase je Kurshalbjahr Grund- und Leistungskurs, z. B. Q3-LK; in Ev. Religion und Ethik gibt es in den Jahrgängen 5–10 und in der E-Phase je Jahrgang einen Kurs mit Schüler:innen aus mehreren Klassen, z. B. 8-K oder E-K). " +
  "Geplant wird in Unterrichtseinheiten (Leupold-Schema: Ausgangslage → Lernschritte → zentrale Lernaufgabe; Ablauf als Tabelle mit Stundenfrage und grobem Stundenablauf); jede Sitzung gehört zu einer Zeile ihrer Einheit. " +
  "Planungsgrundlagen (Schulcurriculum, KCGO, E-Phasen-Curriculum, Abiturerlass je Kurs) liefert get_planning_basis. In den Jahrgängen 5 und 6 gibt es keine iPads: dort nur analoges, ausdruckbares Material. " +
  "Jede Unterrichtssitzung hat Fach, Klasse, Thema, Dauer, Ideen der Lehrkraft, einen Planungsverlauf (Chat), Materialien, Feibeitsblätter und einen Schulportal-Eintrag. " +
  "Lies vor dem Planen immer zuerst die Sitzung mit get_lesson. Speichere Ergebnisse nur, wenn die Lehrkraft das möchte. " +
  "Ist die Lehrkraft krank, legst du mit save_substitute_plan einen Vertretungsvorschlag ab (mit Abgabe: Feibeitsblatt oder ein Escape-Room nach der Vorlage der Plattform mit Feibeitsblatt-Finale); die Lehrkraft prüft und bestätigt ihn in der Plattform. " +
  "Eine Zeile „⏸ Zwischenstopp“ im Schulportal-Eintrag ist eine interne Markierung der Lehrkraft: Bis dorthin wurde die Stunde geschafft, ab dort ist der Inhalt offen (sie wird beim Kopieren ins Schulportal entfernt). " +
  "Der Schulportal-Eintrag verwendet die Schulportal-Zeichen (" + PORTAL_RULES.join("; ") + ") und folgt dieser Vorlage:\n" + PORTAL_EXAMPLE;

const SUBJECT_ARG = { type: "string", description: "Fach: powi (Politik und Wirtschaft), evrel (Evangelische Religion) oder ethik", enum: SUBJECTS.map((s) => s.id) };
const CLASS_ARG = { type: "string", description: "Klasse/Kurs, z. B. 7B, EA, Q2-GK oder 8-K (Kurs Jg. 8 in Ev. Religion/Ethik)", enum: ALL_CLASSES };
const UNIT_ID = { type: "string", description: "ID der Unterrichtseinheit (16 Hex-Zeichen, aus list_units)", pattern: "^[a-f0-9]{16}$" };
const ID_ARG = { type: "string", description: "Sitzungs-ID (16 Hex-Zeichen, aus list_lessons)", pattern: "^[a-f0-9]{16}$" };
const ro = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const wr = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

const T = (d) => ({ type: "string", description: d }), I = (d) => ({ type: "integer", description: d });
const ESCAPE_PART = { type: "object", description: "Rätselteil; Felder je typ siehe Beschreibung des Escape-Rooms", properties: {
  typ: { type: "string", enum: PART_TYPES }, frage: T("Frage bzw. Anweisung"), abschnitt: I("Nummer des Bibliotheksabschnitts (ab 1), in dem die Antwort steht"),
  anfang: T("Anfang der richtigen Antwort (Hilfe Stufe 2)"), loesung: T("Lösung im Klartext (Hilfe Stufe 3)"), hinweis: T("Hinweis (Stufe 2)"),
  optionen: { type: "array", description: "einfachwahl/mehrfachwahl: [{text, richtig, erklaerung}]; zuordnung: [Text]" },
  zeilen: { type: "array", items: { type: "object", properties: { text: T(""), antwort: T("wörtlich aus optionen"), abschnitt: I(""), anfang: T("") }, required: ["text", "antwort"] } },
  koerbe: { type: "array", items: { type: "object", properties: { name: T(""), anfang: T("") }, required: ["name"] } },
  karten: { type: "array", items: { type: "object", properties: { text: T(""), korb: { type: "integer", enum: [1, 2] }, abschnitt: I("") }, required: ["text", "korb"] } },
  text: T("luecken: Text mit Platzhaltern [[1]], [[2]] …"), luecken: { type: "array", items: { type: "object", properties: { nr: I(""), loesungen: { type: "array", items: { type: "string" } }, abschnitt: I(""), hinweis: T(""), loesung: T("") }, required: ["nr", "loesungen"] } },
  wortbank: { type: "array", items: { type: "string" }, description: "optional: Auswahlliste inkl. Ablenker (sonst freie Eingabe)" },
  einheit: T("zahl: Einheit"), min: { type: "number" }, max: { type: "number" }, loesungen: { type: "array", items: { type: "string" }, description: "schlussstein: akzeptierte Antworten" },
  hinweis1: T("schlussstein: Hilfe Stufe 1"), hinweis2: T("schlussstein: Hilfe Stufe 2") }, required: ["typ"] };
const ESCAPE_ROOM = { type: "object", description: "Escape-Room nach der Vorlage der Plattform (statt eines einzelnen Feibeitsblatts; das Finale ist ein Feibeitsblatt). " + ESCAPE_FORMAT_HINT,
  properties: { name: T("Name des Raums (≤ 80 Zeichen)"), titel: T("Überschrift der Startseite"), untertitel: T("1–2 Sätze"), loesungswort: T("genau 6 Buchstaben A–Z, ohne Umlaute"),
    rahmen: { type: "object", properties: { sprecher: T("Stimme der Geschichte"), auftrag: T("Briefing (2–4 Sätze)"), rolle: T("Rolle der Schüler:innen") } },
    stationen: { type: "array", minItems: 6, maxItems: 6, items: { type: "object", properties: { titel: T(""), ort: T("Ort in der Geschichte"),
      bibliothek: { type: "object", properties: { einleitung: T(""), abschnitte: { type: "array", minItems: 2, maxItems: 6, items: { type: "object", properties: { ueberschrift: T(""), text: T("Sachtext"), liste: { type: "array", items: { type: "string" } } }, required: ["ueberschrift", "text"] } } }, required: ["abschnitte"] },
      raetsel: { type: "object", properties: { auftrag: T("ein Satz in der Stimme der Geschichte"), teile: { type: "array", minItems: 1, maxItems: 3, items: ESCAPE_PART }, erfolg: T("ein Satz") }, required: ["teile"] },
      erlaeuterung: T("Lösungserläuterung (400–1200 Zeichen)") }, required: ["titel", "bibliothek", "raetsel", "erlaeuterung"] } },
    finale: { type: "object", properties: { ueberschrift: T(""), text: T(""), warum: T("Warum dieses Lösungswort?"), rueckblick: { type: "array", items: { type: "string" } }, schluss: T("") } },
    feibeitsblatt: { type: "object", description: "Finale im Feibeitsblatt", properties: { titel: T(""), aufgaben: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", properties: { text: T(""), ki_auftrag: T("Auftrag an die KI für die Rückmeldung") }, required: ["text"] } } }, required: ["titel", "aufgaben"] } },
  required: ["name", "loesungswort", "rahmen", "stationen", "finale", "feibeitsblatt"] };

const TOOLS = [
  { name: "list_lessons", title: "Unterrichtssitzungen auflisten", annotations: ro,
    description: "Listet die Unterrichtssitzungen der Lehrkraft, optional gefiltert nach Fach und Klasse (neueste zuerst).",
    inputSchema: { type: "object", properties: { fach: SUBJECT_ARG, klasse: CLASS_ARG }, additionalProperties: false } },
  { name: "get_lesson", title: "Sitzung lesen", annotations: ro,
    description: "Liefert alle aktuellen Daten einer Sitzung: Fach, Klasse/Jahrgang, Thema, Dauer, Ideen, Planungsverlauf, Schulportal-Eintrag (mit Version), Materialien (Textmaterial im Wortlaut), Feibeitsblätter und Entwürfe.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG }, required: ["lesson_id"], additionalProperties: false } },
  { name: "update_lesson", title: "Sitzungsdaten ändern", annotations: wr,
    description: "Ändert Titel, Thema, Dauer, Datum, Beginn (Uhrzeit), das Notizfeld „Ideen und Wünsche“ oder die Hausaufgabe (bis zur nächsten Sitzung; Schüler:innen sehen sie ab 15 Minuten vor dem Ende der Sitzung) einer Sitzung (nur übergebene Felder).",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, titel: { type: "string", maxLength: 200 }, thema: { type: "string", maxLength: 500 },
      dauer_minuten: { type: "integer", minimum: 5, maximum: 600 }, datum: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      beginn: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: "Uhrzeit des Unterrichtsbeginns, z. B. 07:45" }, ideen: { type: "string", maxLength: 20000 },
      hausaufgabe: { type: "string", maxLength: 10000, description: "Schulportal-Zeichen erlaubt; leer = keine Hausaufgabe" } }, required: ["lesson_id"], additionalProperties: false } },
  { name: "save_planning_result", title: "Planungsergebnis in der Sitzung speichern", annotations: wr,
    description: "Speichert ein Planungsergebnis (z. B. den ausgearbeiteten Stundenentwurf) als Nachricht „Claude“ im Planungsverlauf der Sitzung, damit Schulportal-Eintrag und Präsentations-Prompt der Plattform darauf aufbauen.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, text: { type: "string", description: "Markdown", maxLength: 100000 } }, required: ["lesson_id", "text"], additionalProperties: false } },
  { name: "save_schulportal_entry", title: "Schulportal-Eintrag speichern", annotations: { ...wr, destructiveHint: true },
    description: "Ersetzt den Schulportal-Eintrag der Sitzung. Format: Schulportal-Zeichen (**fett**, ~~kursiv~~, __unterstrichen__, --durchgestrichen--, Zeilen mit \"- \"), Struktur wie in der Vorlage (nummerierte fette Phasen, Stichpunkte, „--> Nächste Stunde“). " +
      "Übergib base_version aus get_lesson, damit keine neuere Änderung der Lehrkraft überschrieben wird.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, text: { type: "string", maxLength: 30000 }, base_version: { type: "integer", minimum: 0 } }, required: ["lesson_id", "text"], additionalProperties: false } },
  { name: "add_text_material", title: "Textmaterial hinzufügen", annotations: wr,
    description: "Legt ein Unterrichtsmaterial als Text (Markdown: Überschriften, Listen, Tabellen, **fett**) in der Sitzung ab. Schüler:innen laden es als PDF herunter (z. B. für GoodNotes). " +
      "bereich: \"schueler\" (für Schüler:innen sichtbar) oder \"lehrkraft\" (nur für die Lehrkraft, z. B. Erwartungshorizont).",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, bereich: { type: "string", enum: ["schueler", "lehrkraft"] }, titel: { type: "string", maxLength: 200 }, markdown: { type: "string", maxLength: 200000 } },
      required: ["lesson_id", "bereich", "titel", "markdown"], additionalProperties: false } },
  { name: "add_print_material", title: "Druckvorlage für die Lehrkraft hinzufügen", annotations: wr,
    description: "Legt eine Vorlage in die Liste „Von der Lehrkraft auszudrucken“ der Sitzung (Markdown; die Plattform erzeugt daraus eine A4-PDF – gedruckt wird nur A4). Für alles, was vor der Stunde ausgedruckt " +
      "werden muss: Arbeitsblätter in Jg. 5/6, Karten, Schaubilder oder Kärtchen für die Tafel. anzahl: wie oft (z. B. Zahl der Schüler:innen – frag die Lehrkraft, wenn du sie nicht kennst); " +
      "beidseitig: false, wenn geschnitten wird oder Rückseiten stören; farbe: nur true, wenn Farbe unbedingt nötig ist (an der Schule wird fast immer schwarz-weiß gedruckt). " +
      "Der Dateiname entsteht automatisch, z. B. „28x - beidseitig - sw - Titel.pdf“.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, titel: { type: "string", maxLength: 160 }, markdown: { type: "string", maxLength: 200000 },
      anzahl: { type: "integer", minimum: 1, maximum: 500 }, beidseitig: { type: "boolean" }, farbe: { type: "boolean" } },
      required: ["lesson_id", "titel", "markdown", "anzahl", "beidseitig", "farbe"], additionalProperties: false } },
  { name: "propose_feibeitsblatt", title: "Feibeitsblatt vorschlagen", annotations: wr,
    description: "Legt einen Feibeitsblatt-ENTWURF in der Sitzung ab. " + FEIBEITSBLATT_INFO + " Die Lehrkraft prüft und ändert den Entwurf in der Plattform und legt das Blatt dort selbst an (das Anlegen braucht ihr Feibeitsblatt-Passwort im Browser).",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, titel: { type: "string", maxLength: 120 },
      aufgaben: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", properties: {
        text: { type: "string", description: "Aufgabenstellung", maxLength: 4000 }, material: { type: "string", description: "optionaler Materialtext", maxLength: 8000 },
        ki_auftrag: { type: "string", description: "Auftrag an die KI: worauf sie beim Feedback achten soll. Pflicht bei Text- und Tabellenaufgaben (ohne Auftrag kein KI-Feedback); bei Foto-Aufgaben weglassen.", maxLength: 8000 },
        antwort: { description: "\"text\" (Normalfall), \"foto\" (Foto z. B. eines Lernprodukts; nie an die KI, ohne ki_auftrag; höchstens 3 je Blatt) oder Tabelle", oneOf: [{ type: "string", enum: ["text", "foto"] }, { type: "object", properties: { tabelle: { type: "array", items: { type: "string", maxLength: 60 }, minItems: 1, maxItems: 8 }, zeilen: { type: "integer", minimum: 1, maximum: 30 } }, required: ["tabelle"] }] } },
        required: ["text"] } } }, required: ["lesson_id", "titel", "aufgaben"], additionalProperties: false } },
  { name: "list_units", title: "Unterrichtseinheiten auflisten", annotations: ro,
    description: "Listet die Unterrichtseinheiten, optional nach Fach und Klasse/Kurs.",
    inputSchema: { type: "object", properties: { fach: SUBJECT_ARG, klasse: CLASS_ARG }, additionalProperties: false } },
  { name: "get_unit", title: "Unterrichtseinheit lesen", annotations: ro,
    description: "Liefert eine Unterrichtseinheit: Rahmendaten, verfügbare Termine, Plan (Planungsgrundlage, Lernaufgabe, Ausgangslage, Lernschritte), Ablauf-Zeilen und die angelegten Sitzungen.",
    inputSchema: { type: "object", properties: { unit_id: UNIT_ID }, required: ["unit_id"], additionalProperties: false } },
  { name: "get_planning_basis", title: "Planungsgrundlagen lesen", annotations: ro,
    description: "Liefert die für Fach und Klasse/Kurs einer Einheit (oder einer Sitzung) geltenden Planungsgrundlagen im Wortlaut: Schulcurriculum (Sek I), KCGO (Regeln, Kurshalbjahr, didaktische Grundlagen), schulinternes E-Phasen-Curriculum, Fachteil des Abiturerlasses des Kurses, dazu die Planungsregeln der Lehrkraft und fehlende Dokumente.",
    inputSchema: { type: "object", properties: { unit_id: UNIT_ID, lesson_id: ID_ARG, max_zeichen: { type: "integer", minimum: 10000, maximum: 400000 } }, additionalProperties: false } },
  { name: "save_unit_plan", title: "Plan der Unterrichtseinheit speichern", annotations: { ...wr, destructiveHint: true },
    description: "Speichert den mit der Lehrkraft abgestimmten Plan einer Einheit: Planungsgrundlage (gewählt + Begründung, optional Alternative), zentrale Lernaufgabe, Ausgangslage, Lernschritte des Leupold-Schemas (je Titel + Tätigkeitsbeschreibung mit Operatoren) und die Stunden in zeitlicher Reihenfolge (Stundenfrage, grober Ablauf in Stichpunkten, Nummer des Lernschritts ab 0). Termine verteilt die Plattform automatisch. Erst aufrufen, wenn die Lehrkraft zugestimmt hat.",
    inputSchema: { type: "object", properties: { unit_id: UNIT_ID, base_version: { type: "integer", minimum: 0 },
      plan: { type: "object", properties: { titel: { type: "string", maxLength: 200 }, thema: { type: "string", maxLength: 500 },
        planungsgrundlage: { type: "object", properties: { name: { type: "string" }, begruendung: { type: "string" }, alternative: { type: "object", properties: { name: { type: "string" }, begruendung: { type: "string" } } } }, required: ["name"] },
        lernaufgabe: { type: "string", maxLength: 4000 }, ausgangslage: { type: "string", maxLength: 4000 },
        schritte: { type: "array", maxItems: 15, items: { type: "object", properties: { titel: { type: "string", maxLength: 160 }, beschreibung: { type: "string", maxLength: 600 } }, required: ["titel", "beschreibung"] } } },
        required: ["lernaufgabe", "schritte"] },
      stunden: { type: "array", minItems: 1, maxItems: 150, items: { type: "object", properties: { stundenfrage: { type: "string", maxLength: 400 }, ablauf: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 15 }, schritt: { type: "integer", minimum: 0, maximum: 14 } }, required: ["stundenfrage", "ablauf"] } } },
      required: ["unit_id", "plan", "stunden"], additionalProperties: false } },
  { name: "update_unit_row", title: "Stunde in der Einheit anpassen", annotations: wr,
    description: "Hält eine mit der Lehrkraft abgestimmte Abweichung in der Tabelle der Einheit fest: neue Stundenfrage und/oder neuer grober Ablauf für die Stunde, zu der die Sitzung gehört. Nur nach Zustimmung der Lehrkraft aufrufen.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, stundenfrage: { type: "string", maxLength: 400 }, ablauf: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 15 }, begruendung: { type: "string", maxLength: 1000 } }, required: ["lesson_id"], additionalProperties: false } },
  { name: "save_substitute_plan", title: "Vertretungsstunde (Lehrkraft krank) vorschlagen", annotations: wr,
    description: "Legt für eine Sitzung, die wegen Krankheit der Lehrkraft ohne sie stattfindet, einen Vertretungsvorschlag ab. Die Lehrkraft prüft ihn in der Plattform; erst nach ihrer Bestätigung wird das Material ausgetauscht und den Schüler:innen der Vertretungshinweis gezeigt. " +
      "Pflicht: Analyse (Kompetenz, Stundenfrage, Inhalte), chronologische Schritte für die Schüler:innen, Abgabe. Ab Jahrgang 7 ist eine Abgabe in der Plattform Pflicht: ein Feibeitsblatt (bei Lernprodukten mit einer Aufgabe der Antwortart \"foto\" für das Foto des Produkts) oder ein Escape-Room (escape_room) mit Feibeitsblatt-Finale; in den Jahrgängen 5/6 nur analoge Materialien. Die Plattform prüft einen Escape-Room streng und meldet fehlende oder widersprüchliche Angaben mit genauer Stelle zurück.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG,
      analyse: { type: "object", properties: { kompetenz: { type: "string" }, stundenfrage: { type: "string" }, inhalte: { type: "array", items: { type: "string" } } }, required: ["kompetenz", "stundenfrage", "inhalte"] },
      format: { type: "string", description: "z. B. Feibeitsblatt, Lernprodukt, Escape-Room, analog" }, bearbeitungszeit: { type: "integer", description: "Minuten (ca. 80 % der Stunde)" },
      hinweis_schueler: { type: "string", maxLength: 1000, description: "Hinweis für die Schüler:innen, dass die Lehrkraft nicht da ist" },
      schritte: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", properties: { titel: { type: "string" }, anleitung: { type: "string" }, minuten: { type: "integer" }, abgabe: { type: "boolean" } }, required: ["titel", "anleitung"] } },
      abgabe: { type: "string", description: "Was wird wie abgegeben?" }, schulportal: { type: "string", description: "Schulportal-Eintrag der Vertretungsstunde (Schulportal-Zeichen)" },
      materialien: { type: "array", maxItems: 12, items: { type: "object", properties: { titel: { type: "string" }, bereich: { type: "string", enum: ["schueler", "lehrkraft"] }, markdown: { type: "string" } }, required: ["titel", "bereich", "markdown"] } },
      feibeitsblatt: { type: "object", properties: { titel: { type: "string" }, aufgaben: { type: "array", items: { type: "object", properties: { text: { type: "string" }, material: { type: "string" }, ki_auftrag: { type: "string" },
        antwort: { description: "\"text\", \"foto\" (Foto z. B. eines Lernprodukts; nie an die KI, ohne ki_auftrag; höchstens 3 je Blatt) oder Tabelle {tabelle: [...], zeilen}" } }, required: ["text"] } } }, required: ["titel", "aufgaben"] },
      escape_room: ESCAPE_ROOM,
      hinweise_vertretung: { type: "string", description: "kurze Hinweise für die Vertretungslehrkraft" } },
      required: ["lesson_id", "analyse", "schritte", "abgabe"], additionalProperties: false } },
];

const toolText = (text, structured) => ({ content: [{ type: "text", text }], ...(structured ? { structuredContent: structured } : {}) });
const toolError = (text) => ({ content: [{ type: "text", text }], isError: true });

async function lessonDump(db, l) {
  const ctx = await lessonCtx(db, l);
  const [msgs, drafts] = await Promise.all([chatMessages(db, l.id, 80), db.prepare("SELECT id, data, status, sheet_code FROM fb_drafts WHERE lesson_id=?1 ORDER BY created_at DESC LIMIT 10").bind(l.id).all()]);
  const parts = [
    "# Sitzung " + l.id, lessonContext(ctx, { portal: false, materialText: true, materialMax: 20000 }),
    "Sitzungscode für Schüler:innen: " + formatCode(l.code),
    "", "## Schulportal-Eintrag (Version " + l.portal_version + (l.portal_source ? ", zuletzt von " + l.portal_source : "") + ")", l.portal || "(noch leer)",
    "", "## Planungsverlauf", chatTranscript(msgs, 60000) || "(leer)",
  ];
  const ds = (drafts.results || []);
  if (ds.length) {
    parts.push("", "## Feibeitsblatt-Entwürfe");
    for (const d of ds) parts.push("- " + d.id + " (" + d.status + (d.sheet_code ? ", Code " + formatCode(d.sheet_code) : "") + "): " + d.data.slice(0, 4000));
  }
  const sub = await getSubstitute(db, l.id);
  if (sub) parts.push("", "## Krankheitsvertretung", "Status: " + sub.status + (sub.status === "aktiv" ? " (die ursprüngliche Planung ist archiviert)" : " (Vorschlag liegt der Lehrkraft vor)"));
  if (l.unit_id) parts.push("", "Unterrichtseinheit: " + l.unit_id + " (Details mit get_unit; Planungsgrundlagen mit get_planning_basis)");
  parts.push("", "## Rolle des Planungsassistenten der Plattform (zur Orientierung)", SYSTEM_PROMPT_ROLE);
  return parts.join("\n");
}

async function callTool(c, name, a) {
  a = a && typeof a === "object" ? a : {};
  switch (name) {
    case "list_lessons": {
      let q = "SELECT id, subject, klass, title, topic, lesson_date, duration_min, updated_at FROM lessons", args = [];
      if (a.fach) { args.push(a.fach); q += " WHERE subject=?1"; }
      if (a.klasse) { args.push(a.klasse); q += (args.length > 1 ? " AND" : " WHERE") + " klass=?" + args.length; }
      const r = await c.db.prepare(q + " ORDER BY updated_at DESC LIMIT 100").bind(...args).all();
      const rows = (r.results || []).map((x) => ({ id: x.id, fach: subjectName(x.subject), klasse: x.klass, jahrgang: gradeInfo(x.klass).text, titel: x.title, thema: x.topic, datum: x.lesson_date, dauer_minuten: x.duration_min }));
      return toolText(rows.length ? rows.map((x) => "- " + x.id + ": " + x.titel + " (" + x.fach + ", " + x.klasse + (x.datum ? ", " + x.datum : "") + ")").join("\n") : "Keine Sitzungen gefunden.", { lessons: rows });
    }
    case "get_lesson": {
      const l = await getLesson(c.db, a.lesson_id);
      return toolText(await lessonDump(c.db, l), { lesson_id: l.id, portal_version: l.portal_version });
    }
    case "list_units": {
      let q = "SELECT id, subject, klass, title, status, rows FROM units", args = [];
      if (a.fach) { args.push(a.fach); q += " WHERE subject=?1"; }
      if (a.klasse) { args.push(a.klasse); q += (args.length > 1 ? " AND" : " WHERE") + " klass=?" + args.length; }
      const r = await c.db.prepare(q + " ORDER BY updated_at DESC LIMIT 100").bind(...args).all();
      const rows = (r.results || []).map((x) => ({ id: x.id, fach: subjectName(x.subject), klasse: classShort(x.klass), titel: x.title, status: x.status, stunden: JSON.parse(x.rows || "[]").length }));
      return toolText(rows.length ? rows.map((x) => "- " + x.id + ": " + (x.titel || "(ohne Titel)") + " (" + x.fach + ", " + x.klasse + ", " + x.status + ", " + x.stunden + " Stunden)").join("\n") : "Keine Einheiten gefunden.", { units: rows });
    }
    case "get_unit": {
      const u = await unitFull(c.db, await getUnit(c.db, a.unit_id));
      const lines = ["# Unterrichtseinheit " + u.id + " (" + subjectName(u.subject) + ", " + classShort(u.klass) + " – " + gradeInfo(u.klass).text + ", Status: " + u.status + ", Version " + u.version + ")",
        "Titel: " + (u.title || "(offen)"), paramsText(u.params), "Verfügbare Sitzungen: " + lessonSlots(u.slots).length, ...lessonSlots(u.slots).map((x, i) => "  " + (i + 1) + ". " + fmtDay(x.date) + " (" + x.minutes + " min)"),
        "", "## Plan", JSON.stringify(u.plan, null, 1), "", "## Ablauf (Zeilen)", ...u.rows.map((r, i) => (i + 1) + ". " + (r.date ? fmtDay(r.date) + ": " : "") + r.stundenfrage + (r.schritt != null ? " [Lernschritt " + (r.schritt + 1) + "]" : "") + "\n   - " + r.ablauf.join("\n   - ")),
        "", "## Sitzungen", ...(u.lessons.length ? u.lessons.map((l) => "- " + l.id + " " + (l.date ? fmtDay(l.date) : "") + ": " + l.title) : ["(noch keine)"])];
      return toolText(lines.join("\n"), { unit_id: u.id, version: u.version });
    }
    case "get_planning_basis": {
      let subject, klass;
      if (a.unit_id) { const u = await getUnit(c.db, a.unit_id); subject = u.subject; klass = u.klass; }
      else if (a.lesson_id) { const l = await getLesson(c.db, a.lesson_id); subject = l.subject; klass = l.klass; }
      else return toolError("Bitte unit_id oder lesson_id angeben.");
      const b = await planningBasis(c.db, subject, klass, a.max_zeichen || 180000);
      const head = ["# Planungsgrundlagen für " + subjectName(subject) + ", " + classShort(klass) + " – " + gradeInfo(klass).text,
        b.rules ? "## Planungsregeln der Lehrkraft\n" + b.rules : "", b.gradeNote ? "Hinweis zum Jahrgang: " + b.gradeNote : "",
        b.missing.length ? "## Fehlende Planungsgrundlagen\n- " + b.missing.join("\n- ") : "", b.truncated ? "(Gekürzt – weitere Seiten über max_zeichen anfordern.)" : ""].filter(Boolean);
      return toolText(head.join("\n\n") + "\n\n" + (b.text || "(Es sind noch keine passenden Dokumente hochgeladen.)"), { docs: b.docs, missing: b.missing });
    }
    case "save_unit_plan": {
      const u = await getUnit(c.db, a.unit_id);
      try {
        const v = await applyPlan(c.db, u, a.plan, a.stunden, Number.isInteger(a.base_version) ? a.base_version : null, "claude", c.now);
        return toolText("Plan gespeichert (Version " + v + ", " + a.stunden.length + " Stunden). Die Lehrkraft prüft ihn in der Plattform und legt dort die Sitzungen an.", { version: v });
      } catch (e) {
        if (e instanceof HttpError && e.code === "unit_conflict") return toolError("Die Einheit wurde inzwischen geändert (Version " + e.extra.version + "). Bitte get_unit erneut aufrufen.");
        throw e;
      }
    }
    case "update_unit_row": {
      const l = await getLesson(c.db, a.lesson_id);
      if (!l.unit_id || !l.unit_row) return toolError("Diese Sitzung gehört zu keiner Unterrichtseinheit.");
      const row = await updateRow(c.db, l.unit_id, l.unit_row, { stundenfrage: a.stundenfrage, ablauf: a.ablauf }, "claude", c.now);
      return toolText("In der Einheit festgehalten: " + row.stundenfrage);
    }
    case "save_substitute_plan": {
      const p = await saveProposal(c.db, a.lesson_id, a, c.now);
      return toolText("Vertretungsvorschlag gespeichert (" + p.schritte.length + " Schritte" + (p.escape_room ? ", Escape-Room „" + p.escape_room.name + "“ mit Lösungswort " + p.escape_room.wort + " und Feibeitsblatt-Finale" : p.draftId ? ", Feibeitsblatt-Entwurf" : "") +
        "). Die Lehrkraft prüft und bestätigt ihn in der Plattform" + (p.escape_room ? " (mit Vorschau des Escape-Rooms)." : "."));
    }
    case "update_lesson": {
      await getLesson(c.db, a.lesson_id);
      const b = {};
      if (a.titel !== undefined) b.title = a.titel;
      if (a.thema !== undefined) b.topic = a.thema;
      if (a.dauer_minuten !== undefined) b.durationMin = a.dauer_minuten;
      if (a.datum !== undefined) b.date = a.datum;
      if (a.beginn !== undefined) b.startTime = a.beginn;
      if (a.ideen !== undefined) b.ideas = a.ideen;
      if (a.hausaufgabe !== undefined) b.homework = a.hausaufgabe;
      const { lesson: l } = await updateLesson(c.db, a.lesson_id, b, c.now);
      return toolText("Gespeichert.", { lesson: lessonOut(l) });
    }
    case "save_planning_result": {
      await getLesson(c.db, a.lesson_id);
      const t = cleanText(a.text, LIMITS.answer).trim();
      if (!t) return toolError("Der Text ist leer.");
      await c.db.batch([
        c.db.prepare("INSERT INTO chat(lesson_id, role, content, model, mode, created_at) VALUES(?1, 'assistant', ?2, 'Claude (claude.ai, Connector)', 'claude', ?3)").bind(a.lesson_id, t, c.now),
        c.db.prepare("UPDATE lessons SET updated_at=?2 WHERE id=?1").bind(a.lesson_id, c.now),
      ]);
      return toolText("Im Planungsverlauf der Sitzung gespeichert.");
    }
    case "save_schulportal_entry": {
      await getLesson(c.db, a.lesson_id);
      if (typeof a.text !== "string" || !a.text.trim()) return toolError("Der Eintrag ist leer.");
      try {
        const p = await savePortal(c.db, a.lesson_id, a.text, Number.isInteger(a.base_version) ? a.base_version : null, "claude", c.now);
        return toolText("Schulportal-Eintrag gespeichert (Version " + p.version + ").", { version: p.version });
      } catch (e) {
        if (e instanceof HttpError && e.code === "portal_conflict") return toolError("Der Eintrag wurde inzwischen geändert (aktuelle Version " + e.extra.current.version + "). Bitte get_lesson erneut aufrufen und die Änderungen der Lehrkraft berücksichtigen.");
        throw e;
      }
    }
    case "add_text_material": {
      await getLesson(c.db, a.lesson_id);
      const area = a.bereich === "schueler" ? "student" : a.bereich === "lehrkraft" ? "teacher" : "";
      const f = await insertTextMaterial(c.db, a.lesson_id, area, a.titel, a.markdown, "claude", c.now);
      return toolText("Material „" + f.name + "“ gespeichert (" + (area === "student" ? "für Schüler:innen sichtbar" : "nur für die Lehrkraft") + ").", { file_id: f.id });
    }
    case "add_print_material": {
      await getLesson(c.db, a.lesson_id);
      const f = await insertPrintText(c.db, a.lesson_id, a.titel, a.markdown, { copies: a.anzahl, duplex: a.beidseitig !== false, color: a.farbe === true }, "claude", c.now);
      const o = fileOut(f);
      return toolText("Druckvorlage gespeichert: „" + o.printName + "“ (Liste „Von der Lehrkraft auszudrucken“).", { file_id: f.id, file_name: o.printName });
    }
    case "propose_feibeitsblatt": {
      await getLesson(c.db, a.lesson_id);
      const d = await insertDraft(c.db, a.lesson_id, { title: a.titel, tasks: a.aufgaben }, "claude", c.now);
      return toolText("Entwurf gespeichert (" + d.data.tasks.length + " Aufgaben). Die Lehrkraft prüft ihn in der Plattform unter „Feibeitsblatt“ und legt das Blatt dort an.", { draft_id: d.id });
    }
  }
  return null;
}

/* ---------- Transport ---------- */
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

async function handleRpc(c, msg) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg && msg.id, -32600, "Invalid Request");
  const isNote = msg.id === undefined || msg.id === null;
  const params = msg.params && typeof msg.params === "object" ? msg.params : {};
  const meta = params._meta && typeof params._meta === "object" ? params._meta : null;
  const reqVersion = meta && meta["io.modelcontextprotocol/protocolVersion"];
  const modern = typeof reqVersion === "string";
  if (modern && reqVersion !== MODERN) return rpcError(msg.id, -32022, "Unsupported protocol version", { supported: [MODERN, ...LEGACY], requested: reqVersion });
  const done = (result) => (isNote ? null : rpcResult(msg.id, modern ? { resultType: "complete", ...result, _meta: { "io.modelcontextprotocol/serverInfo": SERVER_INFO } } : result));
  switch (msg.method) {
    case "initialize": {
      const v = LEGACY.includes(params.protocolVersion) ? params.protocolVersion : LEGACY[0];
      return done({ protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
    }
    case "server/discover":
      return done({ supportedVersions: [MODERN, ...LEGACY], capabilities: { tools: {} }, instructions: INSTRUCTIONS, ttlMs: 3600000, cacheScope: "private" });
    case "notifications/initialized": case "notifications/cancelled": return null;
    case "ping": return done({});
    case "tools/list": return done({ tools: TOOLS, ...(modern ? { ttlMs: 600000, cacheScope: "private" } : {}) });
    case "tools/call": {
      if (!TOOLS.some((t) => t.name === params.name)) return rpcError(msg.id, -32602, "Unbekanntes Werkzeug: " + String(params.name).slice(0, 60));
      try { return done(await callTool(c, params.name, params.arguments)); }
      catch (e) { return done(toolError(e instanceof HttpError || e instanceof Error ? e.message : "Fehler")); }
    }
    default:
      if (isNote) return null;
      return rpcError(msg.id, -32601, "Method not found");
  }
}

async function checkToken(c, token) {
  const key = "mcp:" + (await sha256Hex("mcpip|" + c.ip));
  if (await lockedFor(c.db, key, c.now)) throw new HttpError(429, "locked", "Zu viele ungültige Zugriffe.");
  const s = await getSetting(c.db, "mcp");
  if (!token || !s || !s.hash || !timingSafeEqual(await sha256Hex("mcp|" + token), s.hash)) {
    await registerFail(c.db, key, LOCKS.mcp, c.now);
    throw new HttpError(401, "unauthorized", "Ungültiger Connector-Schlüssel.");
  }
}

export async function routeMcp(c, pathToken) {
  const h = /^Bearer\s+(\S+)\s*$/i.exec(c.request.headers.get("authorization") || "");
  const token = pathToken || (h && h[1]) || "";
  if (c.request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
  try { await checkToken(c, token); }
  catch (e) { return new Response(JSON.stringify(rpcError(null, -32001, e.message)), { status: e.status || 401, headers: { "Content-Type": "application/json" } }); }
  let body;
  try { body = JSON.parse(await c.request.text()); } catch { return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 }); }
  const out = Array.isArray(body) ? (await Promise.all(body.slice(0, 20).map((m) => handleRpc(c, m)))).filter(Boolean) : await handleRpc(c, body);
  if (!out || (Array.isArray(out) && !out.length)) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

/* ---------- Verwaltung des Connector-Schlüssels (Lehrkraft) ---------- */
export async function routeMcpGet(c) {
  await requireTeacher(c);
  const s = await getSetting(c.db, "mcp");
  return json({ ok: true, active: !!(s && s.hash), createdAt: (s && s.createdAt) || null });
}
export async function routeMcpCreate(c) {
  await requireTeacher(c);
  const token = randomToken(32);
  await setSetting(c.db, "mcp", { hash: await sha256Hex("mcp|" + token), createdAt: c.now });
  const origin = new URL(c.request.url).origin;
  return json({ ok: true, token, url: origin + "/mcp/" + token, headerUrl: origin + "/mcp" });
}
export async function routeMcpDelete(c) {
  await requireTeacher(c);
  await setSetting(c.db, "mcp", {});
  return json({ ok: true });
}
export { cleanLine };
