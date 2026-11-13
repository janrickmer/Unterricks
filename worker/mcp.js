// mcp.js – Connector für claude.ai („Custom Connector“, Remote-MCP über Streamable HTTP, zustandslos, nur Werkzeuge).
// So nutzt die Lehrkraft Claude mit ihrem Pro-Abo erlaubt: Sie arbeitet in claude.ai, Claude liest und schreibt dort die Daten der
// Plattform. Unterstützt das aktuelle Protokoll (2026-07-28, ohne Handshake) und ältere Clients (initialize-Handshake).
// Zugang: geheimer Schlüssel in der Adresse (/mcp/<schlüssel>, für „Ohne Anmeldung“) oder als Authorization: Bearer.
import { HttpError, json, readJson, sha256Hex, timingSafeEqual, randomToken, LOCKS, lockedFor, registerFail, cleanText, cleanLine } from "./lib.js";
import { getSetting, setSetting } from "./db.js";
import { requireTeacher } from "./auth.js";
import { getLesson, lessonCtx, chatMessages, updateLesson, savePortal, insertDraft, lessonOut, fileOut, LIMITS, previousLesson, cardData, cardVersion, prevStopInfo, openFilesOf, stopDecisionJson } from "./lessons.js";
import { getUnit, unitFull, applyPlan, updateRow, updateRows, extendUnit, ROWS_MAX, EXTEND_MAX } from "./units.js";
import { planningBasis } from "./bases.js";
import { gsCourseMap, gsCourseOut, getGsCourse, planningBasisGs } from "./gs.js";
import { saveProposal, getSubstitute } from "./substitute.js";
import { paramsText, lessonSlots, WEEKDAYS, freeSlots, stopLessonLines, STOP_CHOICES, STOP_CHOICE_TEXT } from "../public/planning.js";
import { insertTextMaterial, insertPrintText, saveDesign, renderDesign, getFile } from "./files.js";
import { shortImages } from "./render.js";
import { ESCAPE_FORMAT_HINT, PART_TYPES } from "../public/escape-data.js";
import { SUBJECTS, ALL_CLASSES, subjectName, gradeInfo, formatCode, lessonContext, chatTranscript, PORTAL_RULES, PORTAL_EXAMPLE, PORTAL_TEACHER_RULE, SYSTEM_PROMPT_ROLE, FEIBEITSBLATT_INFO, FB_LINK_HINT, classShort, fmtDay, materialDesignText, printFileName, GS_SUBJECT,
  STOP_LINE, hasStop, planRefs, pdfRef, PLAN_REF_RE, NOTES_FILE } from "../public/shared.js";
import { gsLessonContext, GS_MATERIAL_RULES, CARD_DESIGN_RULES, VERLAUFSPLAN_EXAMPLE, VERLAUFSPLAN_RULES } from "../public/gsplanning.js";
import { saveCardSet, setCardTexts } from "./cards.js";
import { parentFiles, refCounts } from "./parents.js";

const MODERN = "2026-07-28";
const LEGACY = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "unterricks", title: "Unterricks – Unterrichtsplattform", version: "1.0.0" };
const INSTRUCTIONS = "Unterricks ist die Unterrichtsplattform der Lehrkraft (Fächer: Politik und Wirtschaft, Evangelische Religion, Ethik; Klassen 5A–10H, EA–EH (acht Klassen a–h je Jahrgang) und in der Qualifikationsphase je Kurshalbjahr Grund- und Leistungskurs, z. B. Q3-LK; in Ev. Religion und Ethik gibt es in den Jahrgängen 5–10 und in der E-Phase je Jahrgang einen Kurs mit Schüler:innen aus mehreren Klassen, z. B. 8-K oder E-K). " +
  "Geplant wird in Unterrichtseinheiten (Leupold-Schema: Ausgangslage → Lernschritte → zentrale Lernaufgabe; Ablauf als Tabelle mit Stundenfrage und grobem Stundenablauf); jede Sitzung gehört zu einer Zeile ihrer Einheit. " +
  "Planungsgrundlagen (Schulcurriculum, KCGO, E-Phasen-Curriculum, Abiturerlass je Kurs) liefert get_planning_basis. In den Jahrgängen 5 und 6 gibt es keine iPads: dort nur analoges, ausdruckbares Material. " +
  "Jede Unterrichtssitzung hat Fach, Klasse, Thema, Dauer, Ideen der Lehrkraft, einen Planungsverlauf (Chat), Materialien, Feibeitsblätter und einen Schulportal-Eintrag. " +
  "Lies vor dem Planen immer zuerst die Sitzung mit get_lesson. Speichere Ergebnisse nur, wenn die Lehrkraft das möchte. " +
  "Arbeitsblätter und alle anderen Materialien als Datei (für Schüler:innen, nur für die Lehrkraft oder zum Ausdrucken) gestaltest du selbst als HTML-Seite und legst sie mit add_material_pdf ab – Unterricks druckt sie unverändert als A4-PDF; add_text_material und add_print_material (Markdown) nur als Rückfall, wenn der PDF-Druck nicht funktioniert. " +
  "Ist die Lehrkraft krank, legst du mit save_substitute_plan einen Vertretungsvorschlag ab (mit Abgabe: Feibeitsblatt oder ein Escape-Room nach der Vorlage der Plattform mit Feibeitsblatt-Finale); die Lehrkraft prüft und bestätigt ihn in der Plattform. " +
  "Eine Zeile „⏸ Zwischenstopp“ im Schulportal-Eintrag ist eine interne Markierung der Lehrkraft: Bis dorthin wurde die Stunde geschafft, ab dort ist der Inhalt offen (sie wird beim Kopieren ins Schulportal entfernt). " +
  "Der Schulportal-Eintrag verwendet die Schulportal-Zeichen (" + PORTAL_RULES.join("; ") + ") und folgt dieser Vorlage:\n" + PORTAL_EXAMPLE + "\n" + PORTAL_TEACHER_RULE + "\n\n" +
  "Grundschule: Die Lehrkraft unterrichtet außerdem an einer Grundschule in Hessen. Dort gibt es Kurse (Kennung gs…, Liste mit list_gs_courses) der Jahrgänge 1–4 mit einer bis drei Klassen (a–c), Fach meist Religion, sonst ein frei benanntes Fach mit optionaler Beschreibung des Kursziels; ihre Einheiten und Sitzungen haben das Fach „gs“. " +
  "Die Kinder arbeiten nicht digital: nur ausdruckbares, analoges Material. Grundschul-Sitzungen haben keinen Schulportal-Eintrag, keine Präsentation, keine Feibeitsblätter, keinen Sitzungscode und keine Vertretungsstunde. " +
  "Stattdessen speicherst du mit save_verlaufsplan den Verlaufsplan (Phasen mit Minuten und Sozialform); jede PDF-Datei steht genau an der Stelle, an der sie benutzt wird, als [[pdf:<file_id>]] – lege das Material vorher an (add_material_pdf, Bildkarten mit add_picture_cards und einem gekürzten Erzähltext je Karte). " +
  "Muss die Lehrkraft dabei auf Material zurückgreifen, das nur sie hat (z. B. ein Vorlesetext), steht diese Aufforderung als eigener, unterstrichener Stichpunkt in der Phase: „- __Lehrkraft liest [[pdf:<file_id>|Vorlesetext – Die Arche Noah]] vor.__“. " +
  "Material der Grundschule legst du immer mit add_material_pdf ab (ist der Drucker ausgelastet, druckt Unterricks es später nach); add_text_material gibt es dort nicht, Rückfall nur für Druckvorlagen ist add_print_material. " +
  "Für die Eltern formulierst du mit update_lesson (inhalt_eltern) 2–3 Sätze zu Inhalt und Lernziel. Nenne in allem, was Eltern sehen, nie Namen von Kindern. " +
  "Ist die Lehrkraft krank, verschiebt Unterricks die Stunden; danach überarbeitest du auf Wunsch die Einheit (get_unit zeigt Ausfälle, Stunden ohne Termin und die uid jeder Stunde; save_unit_plan mit uid). " +
  "Die Schülerzahl jedes Kurses (auch am Gymnasium) steht – wenn eingetragen – in get_lesson und get_unit; nimm sie als anzahl beim Ausdrucken.";

const SUBJECT_ARG = { type: "string", description: "Fach: powi (Politik und Wirtschaft), evrel (Evangelische Religion), ethik oder gs (alle Kurse der Grundschule)", enum: [...SUBJECTS.map((s) => s.id), GS_SUBJECT] };
const KURS_ARG = { type: "string", description: "Grundschulkurs (Kennung gs…, aus list_gs_courses)", pattern: "^gs[a-f0-9]{8}$" };
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
    feibeitsblatt: { type: "object", description: "Finale im Feibeitsblatt", properties: { titel: T(""), aufgaben: { type: "array", minItems: 1, maxItems: 10, items: { type: "object", properties: { text: T(""), ki_auftrag: T("Auftrag an die korrigierende KI (keine Musterlösung): worauf sie bei der Rückmeldung achten soll, altersgemäß") }, required: ["text"] } } }, required: ["titel", "aufgaben"] } },
  required: ["name", "loesungswort", "rahmen", "stationen", "finale", "feibeitsblatt"] };

const TOOLS = [
  { name: "list_lessons", title: "Unterrichtssitzungen auflisten", annotations: ro,
    description: "Listet die Unterrichtssitzungen der Lehrkraft, optional gefiltert nach Fach und Klasse bzw. Grundschulkurs (neueste zuerst).",
    inputSchema: { type: "object", properties: { fach: SUBJECT_ARG, klasse: CLASS_ARG, kurs: KURS_ARG }, additionalProperties: false } },
  { name: "list_gs_courses", title: "Grundschulkurse auflisten", annotations: ro,
    description: "Listet die Kurse der Grundschule (Jahrgänge 1–4): Kennung, Fach, Jahrgang und Klassen, Schuljahr, Stundenplan, Zahl der Kinder und – falls beschrieben – das Ziel des Kurses.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "get_lesson", title: "Sitzung lesen", annotations: ro,
    description: "Liefert alle aktuellen Daten einer Sitzung: Fach, Klasse/Jahrgang, Thema, Dauer, Ideen, Planungsverlauf, Schulportal-Eintrag (mit Version), Materialien (Textmaterial im Wortlaut), Feibeitsblätter und Entwürfe.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG }, required: ["lesson_id"], additionalProperties: false } },
  { name: "update_lesson", title: "Sitzungsdaten ändern", annotations: wr,
    description: "Ändert Titel, Thema, Dauer, Datum, Beginn (Uhrzeit), das Notizfeld „Ideen und Wünsche“ oder die Hausaufgabe (bis zur nächsten Sitzung; Schüler:innen sehen sie ab 15 Minuten vor dem Ende der Sitzung) einer Sitzung (nur übergebene Felder). " +
      "Mit zwischenstopp hältst du die Entscheidung der Lehrkraft zum offenen Teil der vorigen Sitzung fest (get_lesson, Abschnitt „Vorige Stunde nicht vollständig beendet“).",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, titel: { type: "string", maxLength: 200 }, thema: { type: "string", maxLength: 500 },
      dauer_minuten: { type: "integer", minimum: 5, maximum: 600 }, datum: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      beginn: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: "Uhrzeit des Unterrichtsbeginns, z. B. 07:45" }, ideen: { type: "string", maxLength: 20000 },
      hausaufgabe: { type: "string", maxLength: 10000, description: "Schulportal-Zeichen erlaubt; leer = keine Hausaufgabe (Grundschule: schlichter Text für Eltern und Kinder, ohne Schulportal-Zeichen; Eltern sehen sie nach der Stunde)" },
      inhalt_eltern: { type: "string", maxLength: 800, description: "nur Grundschule: Inhalt der Unterrichtsstunde für die Eltern – 2–3 Sätze, elternverständlich: worum es ging und was die Kinder lernen sollten; nie Namen von Kindern" },
      zwischenstopp: { type: "string", enum: STOP_CHOICES, description: "Entscheidung der Lehrkraft zum offenen Teil der vorigen Sitzung nach ihrem Zwischenstopp: \"uebernehmen\" (in diese Stunde einbauen) oder \"verzichten\" – nur, was die Lehrkraft entschieden hat" } },
      required: ["lesson_id"], additionalProperties: false } },
  { name: "save_planning_result", title: "Planungsergebnis in der Sitzung speichern", annotations: wr,
    description: "Speichert ein Planungsergebnis (z. B. den ausgearbeiteten Stundenentwurf) als Nachricht „Claude“ im Planungsverlauf der Sitzung, damit Schulportal-Eintrag und Präsentations-Prompt der Plattform darauf aufbauen.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, text: { type: "string", description: "Markdown", maxLength: 100000 } }, required: ["lesson_id", "text"], additionalProperties: false } },
  { name: "save_schulportal_entry", title: "Schulportal-Eintrag speichern", annotations: { ...wr, destructiveHint: true },
    description: "Ersetzt den Schulportal-Eintrag der Sitzung. Format: Schulportal-Zeichen (**fett**, ~~kursiv~~, __unterstrichen__, --durchgestrichen--, Zeilen mit \"- \"), Struktur wie in der Vorlage (nummerierte fette Phasen, Stichpunkte, „--> Nächste Stunde“). " + PORTAL_TEACHER_RULE + " " +
      "Eine vorhandene Zeile „" + STOP_LINE + "“ lässt du unverändert an ihrer Stelle; setze selbst keine. " +
      "Übergib base_version aus get_lesson, damit keine neuere Änderung der Lehrkraft überschrieben wird.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, text: { type: "string", maxLength: 30000 }, base_version: { type: "integer", minimum: 0 } }, required: ["lesson_id", "text"], additionalProperties: false } },
  { name: "save_verlaufsplan", title: "Verlaufsplan speichern (Grundschule)", annotations: { ...wr, destructiveHint: true },
    description: "Nur für Sitzungen der Grundschule (statt des Schulportal-Eintrags): ersetzt den Verlaufsplan der Sitzung. Format: " + VERLAUFSPLAN_RULES + " " +
      "Lege das Material vorher an (add_material_pdf, Bildkarten mit add_picture_cards) und nimm seine file_id aus der Antwort oder aus get_lesson. " +
      "Eine Zeile „" + STOP_LINE + "“ setzt nur die Lehrkraft (bis dorthin wurde die Stunde geschafft): Eltern sehen nur das Material bis zum Zwischenstopp. Eine vorhandene Zeile „" + STOP_LINE + "“ lässt du unverändert an ihrer Stelle; setze selbst keine. " +
      "Übergib base_version aus get_lesson, damit keine neuere Änderung der Lehrkraft überschrieben wird. Beispiel:\n" + VERLAUFSPLAN_EXAMPLE,
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, text: { type: "string", maxLength: 30000 }, base_version: { type: "integer", minimum: 0 } }, required: ["lesson_id", "text"], additionalProperties: false } },
  { name: "add_material_pdf", title: "Material gestalten (PDF)", annotations: wr,
    description: "Legt ein von dir gestaltetes Material als PDF-Datei in der Sitzung ab: Arbeitsblätter, Texte und Quellen, Schaubilder, Tafelbilder, Kärtchen, Erwartungshorizonte – alles, was Schüler:innen oder die Lehrkraft als Datei bekommen. " +
      "Du gestaltest es als HTML-Seite; Unterricks druckt sie unverändert mit Chromium als A4-PDF und legt die PDF ab. bereich: \"schueler\" (für die Schüler:innen, sichtbar sobald die PDF gedruckt ist; sie laden sie z. B. in GoodNotes), " +
      "\"lehrkraft\" (nur für die Lehrkraft, z. B. Erwartungshorizont, Lösungen, Tafelbild) oder \"druck\" (Liste „Von der Lehrkraft auszudrucken“: in Jg. 5/6 alles Material für die Schüler:innen, sonst Kärtchen, Karten, Plakate; " +
      "dazu anzahl – Standard: Schülerzahl laut Kurseinstellungen (siehe get_lesson); fehlt sie, frag nach der Klassengröße –, beidseitig (false, wenn geschnitten wird) und farbe (nur, wenn Farbe unbedingt nötig ist; gedruckt wird fast immer schwarz-weiß)). " +
      "Mit file_id (aus get_lesson) ersetzt du die Gestaltung eines vorhandenen Materials – lies sie vorher mit get_material; eingebettete Bilder stehen dort als Platzhalter „data:unterricks-bild,n“ und bleiben erhalten, wenn du die Platzhalter stehen lässt. " +
      "Die Antwort nennt die Seitenzahl der gedruckten PDF oder die Meldung des Druckers. Ein Material = eine Datei (mehrere Materialien M1, M2 … für dieselbe Aufgabe dürfen in einer Datei stehen).\n\nGestaltungsregeln:\n" + materialDesignText() +
      "\n\nGrundschule: bereich \"schueler\" = Arbeitsblätter der Kinder (Eltern sehen sie nach der Stunde, wenn der Verlaufsplan sie vor einem Zwischenstopp nennt); gib dort anzahl an (und, wenn nötig, beidseitig und farbe), dann steht das Blatt auch auf der Druckliste. " +
      "bereich \"druck\" nur für Material, das Eltern nicht sehen sollen (Tafel- und Bodenbilder, Kärtchen). Zusätzliche Gestaltungsregeln Grundschule (gehen vor):\n" + GS_MATERIAL_RULES.map((r) => "- " + r).join("\n"),
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, bereich: { type: "string", enum: ["schueler", "lehrkraft", "druck"], description: "bei file_id nur angeben, wenn er sich ändert (schueler ↔ lehrkraft)" },
      titel: { type: "string", maxLength: 160, description: "Dateiname ohne Endung, z. B. „Arbeitsblatt – Gewaltenteilung“" }, html: { type: "string", maxLength: 1600000, description: "vollständige HTML-Seite mit <style>" },
      anzahl: { type: "integer", minimum: 1, maximum: 500, description: "nur bei bereich druck (Grundschule: auch bei schueler)" }, beidseitig: { type: "boolean", description: "nur bei bereich druck (Grundschule: auch bei schueler)" }, farbe: { type: "boolean", description: "nur bei bereich druck (Grundschule: auch bei schueler)" },
      file_id: { type: "string", pattern: "^[a-f0-9]{16}$", description: "Gestaltung eines vorhandenen Materials ersetzen" } },
      required: ["lesson_id", "titel", "html"], additionalProperties: false } },
  { name: "add_picture_cards", title: "Bildkarten gestalten (Grundschule)", annotations: wr,
    description: "Nur für Sitzungen der Grundschule: Legt Bildkarten zu einer Geschichte (z. B. einer biblischen Geschichte) als PDF ab – eine Seite = eine Karte. Du gestaltest sie als HTML-Seite; " +
      "Unterricks druckt sie wie bei add_material_pdf als PDF (Bereich „nur Lehrkraft“: die Lehrkraft zeigt sie im Sitzkreis). Zu jeder Karte schickst du genau einen gekürzten Erzähltext (erzaehltexte, gleiche Reihenfolge wie die Karten): " +
      "Eltern klicken sich nach der Stunde in der Elternansicht der Reihe nach durch die Karten und erzählen die Geschichte mit ihrem Kind nach; die Lehrkraft prüft und ändert die Texte. " +
      "fuer_eltern (Standard true): ob Eltern die Karten sehen dürfen. Die Antwort nennt die Seitenzahl und den Verweis [[pdf:<file_id>]] für den Verlaufsplan (save_verlaufsplan); mit file_id ersetzt du Gestaltung und Erzähltexte von Bildkarten, die du gestaltet hast " +
      "(Bildkarten, die die Lehrkraft hochgeladen hat, lassen sich nicht neu gestalten – ihre Erzähltexte änderst du mit set_picture_card_texts; eigene Karten legst du dann ohne file_id neu an). " +
      "Bildkarten von Verlagen dürfen meist nicht online weitergegeben werden – gestalte die Karten selbst.\n\nGestaltungsregeln für Bildkarten (gehen vor):\n" + CARD_DESIGN_RULES.map((r) => "- " + r).join("\n") +
      "\n\nAllgemeine Gestaltungsregeln (soweit passend):\n" + materialDesignText(),
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, titel: { type: "string", maxLength: 160, description: "Dateiname ohne Endung, z. B. „Bildkarten – Josef und seine Brüder“" },
      html: { type: "string", maxLength: 1600000, description: "vollständige HTML-Seite mit <style>, jede Karte genau eine Seite (A4 quer)" },
      erzaehltexte: { type: "array", minItems: 1, maxItems: 40, items: { type: "string", maxLength: 1200 }, description: "ein gekürzter Erzähltext je Karte (2–4 kurze Sätze, nie Namen von Kindern), in der Reihenfolge der Karten" },
      fuer_eltern: { type: "boolean", description: "Eltern dürfen die Bildkarten sehen (Standard: true)" },
      file_id: { type: "string", pattern: "^[a-f0-9]{16}$", description: "Gestaltung und Erzähltexte von dir gestalteter Bildkarten ersetzen (aus get_lesson)" } },
      required: ["lesson_id", "titel", "html", "erzaehltexte"], additionalProperties: false } },
  { name: "set_picture_card_texts", title: "Erzähltexte der Bildkarten setzen (Grundschule)", annotations: { ...wr, destructiveHint: true },
    description: "Ersetzt die gekürzten Erzähltexte von Bildkarten einer Grundschul-Sitzung (auch von Bildkarten, die die Lehrkraft als PDF hochgeladen hat; file_id aus get_lesson, Abschnitt „Bildkarten“): " +
      "genau ein Text je Karte, in der Reihenfolge der Karten, 2–4 kurze Sätze zum Nacherzählen für Eltern, nie Namen von Kindern. " +
      "Bilder hochgeladener Karten kannst du nicht sehen – frag die Lehrkraft nach der Geschichte und der Reihenfolge der Karten.",
    inputSchema: { type: "object", properties: { file_id: { type: "string", pattern: "^[a-f0-9]{16}$", description: "Bildkarten (aus get_lesson)" },
      erzaehltexte: { type: "array", minItems: 1, maxItems: 40, items: { type: "string", maxLength: 1200 }, description: "ein Erzähltext je Karte" } },
      required: ["file_id", "erzaehltexte"], additionalProperties: false } },
  { name: "get_material", title: "Gestaltetes Material lesen", annotations: ro,
    description: "Liefert die HTML-Gestaltung eines Materials, das mit add_material_pdf angelegt wurde (file_id aus get_lesson), damit du es überarbeiten kannst. Lange eingebettete Bilder stehen dort als Platzhalter „data:unterricks-bild,n“.",
    inputSchema: { type: "object", properties: { file_id: { type: "string", pattern: "^[a-f0-9]{16}$" } }, required: ["file_id"], additionalProperties: false } },
  { name: "add_text_material", title: "Textmaterial hinzufügen (Rückfall)", annotations: wr,
    description: "RÜCKFALL – nur verwenden, wenn add_material_pdf nicht funktioniert. Legt ein Unterrichtsmaterial als Text (Markdown: Überschriften, Listen, Tabellen, **fett**) in der Sitzung ab; Unterricks setzt daraus eine einfache PDF (ohne eigene Gestaltung). Schüler:innen laden es als PDF herunter. " +
      "bereich: \"schueler\" (für Schüler:innen sichtbar) oder \"lehrkraft\" (nur für die Lehrkraft, z. B. Erwartungshorizont). " +
      "Nicht in der Grundschule (dort sehen weder Kinder noch Eltern Textmaterial): dort immer add_material_pdf, als Rückfall für Druckvorlagen add_print_material.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, bereich: { type: "string", enum: ["schueler", "lehrkraft"] }, titel: { type: "string", maxLength: 200 }, markdown: { type: "string", maxLength: 200000 } },
      required: ["lesson_id", "bereich", "titel", "markdown"], additionalProperties: false } },
  { name: "add_print_material", title: "Druckvorlage hinzufügen (Rückfall)", annotations: wr,
    description: "RÜCKFALL – nur verwenden, wenn add_material_pdf (bereich \"druck\") nicht funktioniert. Legt eine Vorlage in die Liste „Von der Lehrkraft auszudrucken“ der Sitzung (Markdown; die Plattform erzeugt daraus eine einfache A4-PDF – gedruckt wird nur A4). Für alles, was vor der Stunde ausgedruckt " +
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
        text: { type: "string", description: "Aufgabenstellung. " + FB_LINK_HINT + ".", maxLength: 4000 }, material: { type: "string", description: "optionaler Materialtext (**fett** möglich). " + FB_LINK_HINT + ".", maxLength: 8000 },
        ki_auftrag: { type: "string", description: "Auftrag an die korrigierende KI – KEINE Musterlösung: worauf sie beim Lesen der Schülerantwort achten soll (erwartete Inhalte, Kriterien, typische Fehler; als Anweisung, z. B. „Achte darauf, ob …“), damit ihre Rückmeldung zeigt, was schon gut ist und was verbessert werden sollte. Erwartungen passend zur Jahrgangsstufe (Unterricks ergänzt beim Anlegen einen Satz zur altersgemäßen Erwartung). Pflicht bei Text- und Tabellenaufgaben (ohne Auftrag kein KI-Feedback); bei Foto-Aufgaben weglassen.", maxLength: 8000 },
        antwort: { description: "\"text\" (Normalfall), \"foto\" (Foto z. B. eines Lernprodukts; nie an die KI, ohne ki_auftrag; höchstens 3 je Blatt) oder Tabelle", oneOf: [{ type: "string", enum: ["text", "foto"] }, { type: "object", properties: { tabelle: { type: "array", items: { type: "string", maxLength: 60 }, minItems: 1, maxItems: 8 }, zeilen: { type: "integer", minimum: 1, maximum: 30 } }, required: ["tabelle"] }] } },
        required: ["text"] } } }, required: ["lesson_id", "titel", "aufgaben"], additionalProperties: false } },
  { name: "list_units", title: "Unterrichtseinheiten auflisten", annotations: ro,
    description: "Listet die Unterrichtseinheiten, optional nach Fach und Klasse/Kurs bzw. Grundschulkurs.",
    inputSchema: { type: "object", properties: { fach: SUBJECT_ARG, klasse: CLASS_ARG, kurs: KURS_ARG }, additionalProperties: false } },
  { name: "get_unit", title: "Unterrichtseinheit lesen", annotations: ro,
    description: "Liefert eine Unterrichtseinheit: Rahmendaten, verfügbare Termine, Plan (Planungsgrundlage, Lernaufgabe, Ausgangslage, Lernschritte), Ablauf-Zeilen und die angelegten Sitzungen.",
    inputSchema: { type: "object", properties: { unit_id: UNIT_ID }, required: ["unit_id"], additionalProperties: false } },
  { name: "get_planning_basis", title: "Planungsgrundlagen lesen", annotations: ro,
    description: "Liefert die für Fach und Klasse/Kurs einer Einheit (oder einer Sitzung) geltenden Planungsgrundlagen im Wortlaut: Schulcurriculum (Sek I), KCGO (Regeln, Kurshalbjahr, didaktische Grundlagen), schulinternes E-Phasen-Curriculum, Fachteil des Abiturerlasses des Kurses, dazu die Planungsregeln der Lehrkraft und fehlende Dokumente.",
    inputSchema: { type: "object", properties: { unit_id: UNIT_ID, lesson_id: ID_ARG, max_zeichen: { type: "integer", minimum: 10000, maximum: 400000 } }, additionalProperties: false } },
  { name: "save_unit_plan", title: "Plan der Unterrichtseinheit speichern", annotations: { ...wr, destructiveHint: true },
    description: "Speichert den mit der Lehrkraft abgestimmten Plan einer Einheit: Planungsgrundlage (gewählt + Begründung, optional Alternative), zentrale Lernaufgabe, Ausgangslage, Lernschritte des Leupold-Schemas (je Titel + Tätigkeitsbeschreibung mit Operatoren) und die Stunden in zeitlicher Reihenfolge (Stundenfrage, grober Ablauf in Stichpunkten, Nummer des Lernschritts ab 0). Termine verteilt die Plattform automatisch. Erst aufrufen, wenn die Lehrkraft zugestimmt hat. " +
      "Grundschule (get_unit nennt dort die uid jeder Stunde): Hat die Einheit schon Sitzungen (z. B. Überarbeitung nach Ausfällen), gib bei jeder Stunde, die bleibt, ihre uid an – sie behält ihre Sitzung samt Material; Stunden ohne uid sind dann neu; eine weggelassene Stunde mit schon geplanter Sitzung lehnt die Plattform ab (leere Sitzungen löscht sie), ebenso einen Plan ganz ohne uid. Danach verteilt die Plattform die Termine neu. " +
      "Am Gymnasium nennt get_unit keine uid: Lass sie dort weg – die Plattform ordnet die Stunden wie bisher nach ihrer Position den bestehenden Sitzungen zu.",
    inputSchema: { type: "object", properties: { unit_id: UNIT_ID, base_version: { type: "integer", minimum: 0 },
      plan: { type: "object", properties: { titel: { type: "string", maxLength: 200 }, thema: { type: "string", maxLength: 500 },
        planungsgrundlage: { type: "object", properties: { name: { type: "string" }, begruendung: { type: "string" }, alternative: { type: "object", properties: { name: { type: "string" }, begruendung: { type: "string" } } } }, required: ["name"] },
        lernaufgabe: { type: "string", maxLength: 4000 }, ausgangslage: { type: "string", maxLength: 4000 },
        schritte: { type: "array", maxItems: 15, items: { type: "object", properties: { titel: { type: "string", maxLength: 160 }, beschreibung: { type: "string", maxLength: 600 } }, required: ["titel", "beschreibung"] } } },
        required: ["lernaufgabe", "schritte"] },
      stunden: { type: "array", minItems: 1, maxItems: 150, items: { type: "object", properties: { uid: { type: "string", pattern: "^[a-f0-9]{8}$", description: "nur Grundschule: aus get_unit – behält die Stunde samt Sitzung" },
        stundenfrage: { type: "string", maxLength: 400 }, ablauf: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 15 }, schritt: { type: "integer", minimum: 0, maximum: 14 } }, required: ["stundenfrage", "ablauf"] } } },
      required: ["unit_id", "plan", "stunden"], additionalProperties: false } },
  { name: "update_unit_row", title: "Stunde in der Einheit anpassen", annotations: wr,
    description: "Hält eine mit der Lehrkraft abgestimmte Abweichung in der Tabelle der Einheit fest: neue Stundenfrage und/oder neuer grober Ablauf für die Stunde, zu der die Sitzung gehört. Nur nach Zustimmung der Lehrkraft aufrufen. Statt lesson_id geht auch unit_id mit der uid der Stunde aus get_unit. " +
      "Mehrere Stunden auf einmal (z. B. wenn nach einem Zwischenstopp Inhalte in die folgenden Stunden nachrücken): unit_id mit stunden [{uid bzw. nr, stundenfrage, ablauf}] (1–" + ROWS_MAX + ") und base_version aus get_unit – alles in einer Speicherung. " +
      "Die Grundschule nennt in get_unit die uid jeder Stunde; am Gymnasium nimmst du die Nummer nr der Stunde aus get_unit (dann ist base_version Pflicht).",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, unit_id: UNIT_ID, uid: { type: "string", pattern: "^[a-f0-9]{8}$", description: "uid der Stunde aus get_unit (mit unit_id, statt lesson_id – z. B. für eine Stunde ohne Sitzung)" },
      stundenfrage: { type: "string", maxLength: 400 }, ablauf: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 15 }, begruendung: { type: "string", maxLength: 1000 },
      stunden: { type: "array", minItems: 1, maxItems: ROWS_MAX, description: "nur mit unit_id: mehrere Stunden in einer Speicherung (statt uid/stundenfrage/ablauf)", items: { type: "object", properties: {
        uid: { type: "string", pattern: "^[a-f0-9]{8}$", description: "uid der Stunde aus get_unit (Grundschule)" }, nr: { type: "integer", minimum: 1, maximum: 150, description: "Nummer der Stunde in get_unit (statt uid; mit base_version)" },
        stundenfrage: { type: "string", maxLength: 400 }, ablauf: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 15 } }, additionalProperties: false } },
      base_version: { type: "integer", minimum: 0, description: "Version aus get_unit (bei stunden; Pflicht mit nr)" } }, required: [], additionalProperties: false } },
  { name: "extend_unit", title: "Unterrichtseinheit verlängern", annotations: wr,
    description: "Verlängert eine Unterrichtseinheit um 1–" + EXTEND_MAX + " Termine laut ihrem Stundenplan – NUR nach ausdrücklicher Zustimmung der Lehrkraft (z. B. wenn nach einem Zwischenstopp Inhalte nachrücken und am Ende etwas übrig bleibt, oder nach Ausfällen). " +
      "Die Plattform nimmt die nächsten termine Termine nach dem bisherigen Ende (Ferien und Ausfälle wie in den Rahmendaten), setzt das Ende der Einheit auf den letzten davon, gibt zuerst Stunden ohne Termin einen Termin und hängt dann die neuen stunden an (Datum, Beginn und Dauer aus dem Termin); übrige Termine bleiben frei. " +
      "Ist die Einheit schon festgelegt (Sitzungen angelegt), legt die Plattform die Sitzungen dieser Stunden gleich an. Bestehende Sitzungen behalten ihre Termine, Klausurtermine bleiben unverändert. " +
      "Übergib base_version aus get_unit; die Antwort nennt das neue Ende, die Stunden mit Datum und Sitzungs-ID und die neue Version (für update_unit_row).",
    inputSchema: { type: "object", properties: { unit_id: UNIT_ID, base_version: { type: "integer", minimum: 0 }, termine: { type: "integer", minimum: 1, maximum: EXTEND_MAX, description: "so viele Termine nach dem bisherigen Ende kommen dazu (meist 1)" },
      stunden: { type: "array", maxItems: EXTEND_MAX, description: "neue Stunden am Ende der Einheit (höchstens so viele, wie Termine übrig bleiben, nachdem Stunden ohne Termin einen bekommen haben)", items: { type: "object", properties: {
        stundenfrage: { type: "string", maxLength: 400 }, ablauf: { type: "array", items: { type: "string", maxLength: 400 }, maxItems: 15 }, schritt: { type: "integer", minimum: 0, maximum: 14, description: "Nummer des Lernschritts ab 0" } },
        required: ["stundenfrage", "ablauf"], additionalProperties: false } },
      begruendung: { type: "string", maxLength: 1000 } }, required: ["unit_id", "base_version", "termine"], additionalProperties: false } },
  { name: "save_substitute_plan", title: "Vertretungsstunde (Lehrkraft krank) vorschlagen", annotations: wr,
    description: "Legt für eine Sitzung, die wegen Krankheit der Lehrkraft ohne sie stattfindet, einen Vertretungsvorschlag ab. Die Lehrkraft prüft ihn in der Plattform; erst nach ihrer Bestätigung wird das Material ausgetauscht und den Schüler:innen der Vertretungshinweis gezeigt. " +
      "Pflicht: Analyse (Kompetenz, Stundenfrage, Inhalte), chronologische Schritte für die Schüler:innen, Abgabe. Ab Jahrgang 7 ist eine Abgabe in der Plattform Pflicht: ein Feibeitsblatt (bei Lernprodukten mit einer Aufgabe der Antwortart \"foto\" für das Foto des Produkts) oder ein Escape-Room (escape_room) mit Feibeitsblatt-Finale; in den Jahrgängen 5/6 nur analoge Materialien. Die Plattform prüft einen Escape-Room streng und meldet fehlende oder widersprüchliche Angaben mit genauer Stelle zurück.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG,
      analyse: { type: "object", properties: { kompetenz: { type: "string" }, stundenfrage: { type: "string" }, inhalte: { type: "array", items: { type: "string" } } }, required: ["kompetenz", "stundenfrage", "inhalte"] },
      format: { type: "string", description: "z. B. Feibeitsblatt, Lernprodukt, Escape-Room, analog" }, bearbeitungszeit: { type: "integer", description: "Minuten (ca. 80 % der Stunde)" },
      hinweis_schueler: { type: "string", maxLength: 1000, description: "Hinweis für die Schüler:innen, dass die Lehrkraft nicht da ist" },
      schritte: { type: "array", minItems: 1, maxItems: 20, items: { type: "object", properties: { titel: { type: "string" }, anleitung: { type: "string" }, minuten: { type: "integer" }, abgabe: { type: "boolean" } }, required: ["titel", "anleitung"] } },
      abgabe: { type: "string", description: "Was wird wie abgegeben?" }, schulportal: { type: "string", description: "Schulportal-Eintrag der Vertretungsstunde (Schulportal-Zeichen)" },
      materialien: { type: "array", maxItems: 12, description: "Materialien der Vertretung: gestaltet als HTML-Seite (html, Gestaltungsregeln wie bei add_material_pdf – Unterricks druckt sie nach der Bestätigung als PDF; zusammen höchstens 1,5 MB) oder nur als Rückfall in Markdown (markdown)",
        items: { type: "object", properties: { titel: { type: "string" }, bereich: { type: "string", enum: ["schueler", "lehrkraft", "druck"], description: "druck = Liste „Von der Lehrkraft auszudrucken“ (nur mit html)" },
          html: { type: "string", description: "vollständige HTML-Seite mit <style>" }, markdown: { type: "string", description: "Rückfall ohne eigene Gestaltung" },
          anzahl: { type: "integer", minimum: 1, maximum: 500 }, beidseitig: { type: "boolean" }, farbe: { type: "boolean" } }, required: ["titel", "bereich"] } },
      feibeitsblatt: { type: "object", properties: { titel: { type: "string" }, aufgaben: { type: "array", items: { type: "object", properties: { text: { type: "string", description: "Aufgabenstellung. " + FB_LINK_HINT + "." },
        material: { type: "string", description: "optionaler Materialtext (**fett** möglich). " + FB_LINK_HINT + "." }, ki_auftrag: { type: "string" },
        antwort: { description: "\"text\", \"foto\" (Foto z. B. eines Lernprodukts; nie an die KI, ohne ki_auftrag; höchstens 3 je Blatt) oder Tabelle {tabelle: [...], zeilen}" } }, required: ["text"] } } }, required: ["titel", "aufgaben"] },
      escape_room: ESCAPE_ROOM,
      hinweise_vertretung: { type: "string", description: "kurze Hinweise für die Vertretungslehrkraft" } },
      required: ["lesson_id", "analyse", "schritte", "abgabe"], additionalProperties: false } },
];

const toolText = (text, structured) => ({ content: [{ type: "text", text }], ...(structured ? { structuredContent: structured } : {}) });
const toolError = (text) => ({ content: [{ type: "text", text }], isError: true });

async function lessonDump(db, l, now = Date.now()) {
  const ctx = await lessonCtx(db, l);
  const [msgs, drafts, prev] = await Promise.all([chatMessages(db, l.id, 80), db.prepare("SELECT id, data, status, sheet_code FROM fb_drafts WHERE lesson_id=?1 ORDER BY created_at DESC LIMIT 10").bind(l.id).all(),
    previousLesson(db, l)]);
  // Zwischenstopp der vorigen Sitzung: Geschafft / Nicht geschafft, Stand der Entscheidung und die Regeln (Anforderung 13)
  const ps = await prevStopInfo(db, l, prev, ctx.unit);
  const parts = [
    "# Sitzung " + l.id, lessonContext(ctx, { portal: false, materialText: true, materialMax: 20000 }),
    "Sitzungscode für Schüler:innen: " + formatCode(l.code),
    "", "## Schulportal-Eintrag (Version " + l.portal_version + (l.portal_source ? ", zuletzt von " + l.portal_source : "") + ")", l.portal || "(noch leer)",
    ...(ps ? stopLessonLines(ps, { gs: false, unitId: ctx.unit ? ctx.unit.id : null, unit: ctx.unit, now }) : []),
    "", "## Planungsverlauf", chatTranscript(msgs, 60000) || "(leer)",
  ];
  const ds = (drafts.results || []);
  if (ds.length) {
    parts.push("", "## Feibeitsblatt-Entwürfe");
    for (const d of ds) parts.push("- " + d.id + " (" + d.status + (d.sheet_code ? ", Code " + formatCode(d.sheet_code) : "") + "): " + d.data.slice(0, 4000));
  }
  parts.push(...(await designedSection(db, l.id, (a) => (a === "student" ? "für Schüler:innen" : a === "teacher" ? "nur Lehrkraft" : "zum Ausdrucken"))));
  // Notizen der Lehrkraft zur Präsentation (Nachtrag 20): nur kurz (Zahl), nur in diesem Werkzeug der Lehrkraft
  const pn = await db.prepare("SELECT pages, CASE WHEN json_valid(notes) THEN json_array_length(notes, '$.slides') ELSE 0 END AS n FROM files WHERE lesson_id=?1 AND area='presentation' AND status='ready' LIMIT 1").bind(l.id).first();
  if (pn && pn.n > 0) parts.push("", "## Notizen der Lehrkraft zur Präsentation", "Zu " + pn.n + " von " + pn.pages + " Folien gibt es Notizen (nur für die Lehrkraft: in ihrer Präsentationsansicht und in der „Präsentation mit Anmerkungen“ unter „Material nur für die Lehrkraft“). " +
    "Neue Notizen gehören als Dateianhang " + NOTES_FILE + " in eine neue PDF der Präsentation.");
  const sub = await getSubstitute(db, l.id);
  if (sub) parts.push("", "## Krankheitsvertretung", "Status: " + sub.status + (sub.status === "aktiv" ? " (die ursprüngliche Planung ist archiviert)" : " (Vorschlag liegt der Lehrkraft vor)"));
  if (l.unit_id) parts.push("", "Unterrichtseinheit: " + l.unit_id + " (Details mit get_unit; Planungsgrundlagen mit get_planning_basis)");
  parts.push("", "## Rolle des Planungsassistenten der Plattform (zur Orientierung)", SYSTEM_PROMPT_ROLE);
  return parts.join("\n");
}

/* Abschnitt „Gestaltete Materialien“ von get_lesson (Gymnasium und Grundschule; areaText = Bezeichnung des Bereichs) */
async function designedSection(db, lessonId, areaText) {
  // Bildkarten (Grundschule) stehen in einem eigenen Abschnitt (ändern mit add_picture_cards)
  const des = await db.prepare("SELECT id, area, name, status, pages, html_at, pdf_at, render_error FROM files WHERE lesson_id=?1 AND html IS NOT NULL AND area<>'archive' AND cards IS NULL ORDER BY created_at").bind(lessonId).all();
  if (!(des.results || []).length) return [];
  const out = ["", "## Gestaltete Materialien (HTML → PDF; lesen mit get_material, ändern mit add_material_pdf und file_id)"];
  for (const f of des.results) {
    const state = f.render_error && (!f.pdf_at || f.html_at > f.pdf_at) ? "Druck fehlgeschlagen: " + f.render_error : f.status !== "ready" ? "wartet auf den Druck" : f.html_at > f.pdf_at ? "gedruckt, neue Gestaltung wartet auf den Druck" : "gedruckt" + (f.pages ? ", " + f.pages + (f.pages === 1 ? " Seite" : " Seiten") : "");
    out.push("- file_id " + f.id + ": „" + f.name + "“ (" + areaText(f.area) + "; " + state + ")");
  }
  return out;
}

/* get_lesson einer Grundschul-Sitzung: Kurs statt Klasse, Verlaufsplan statt Schulportal-Eintrag, Inhalt und Hinweis für die Eltern, die PDF-Dateien
   des Kurses für Verweise – ohne Sitzungscode, Feibeitsblätter und Vertretung, nie ein Elternlink */
const GS_AREA = { student: "für die Kinder – Eltern sehen sie nach der Stunde", teacher: "nur Lehrkraft", print: "zum Ausdrucken" };
function gsFileLine(f) {
  if (f.cards != null) return "- file_id " + f.id + ": „" + f.name + "“ (Bildkarten – " + (cardData(f).share ? "Eltern sehen sie nach der Stunde" : "Eltern dürfen sie nicht sehen") + "; siehe „Bildkarten“) → " + pdfRef(f.id);
  const st = f.status !== "ready" ? (f.render_error ? "Druck fehlgeschlagen: " + f.render_error : "wartet auf den Druck") : f.pages ? f.pages + (f.pages === 1 ? " Seite" : " Seiten") : "fertig";
  const pr = f.area === "student" && f.print_copies != null ? "; auch auf der Druckliste: " + printFileName({ name: f.name, copies: f.print_copies, duplex: f.print_duplex !== 0, color: f.print_color === 1 }) : "";
  return "- file_id " + f.id + ": „" + f.name + "“ (" + (GS_AREA[f.area] || f.area) + "; " + st + pr + ") → " + pdfRef(f.id);
}
// PDFs anderer Sitzungen des Kurses für get_lesson: die der vorigen Sitzung und alle, auf die der Verlaufsplan verweist – auch ältere als die vorige
// (Abschlussprüfung F19), mit Titel, Datum, Beginn und Anlegezeit ihrer Sitzung (refCounts)
const GS_OTHER_FILES = "SELECT f.id, f.lesson_id, f.name, f.area, f.kind, f.mime, f.pages, f.status, f.source, f.cards, f.card_pages, f.card_img_at, f.pdf_at, f.html_at, f.render_error, f.created_at, " +
  "f.print_copies, f.print_duplex, f.print_color, (f.html IS NOT NULL) AS designed, l.title AS lesson_title, l.lesson_date, l.start_time AS lesson_start, l.created_at AS lesson_created " +
  "FROM files f JOIN lessons l ON l.id = f.lesson_id WHERE l.subject='gs' AND l.klass=?1 AND f.lesson_id<>?2 AND f.kind='file' AND f.mime='application/pdf' AND f.area NOT IN ('archive','presentation') " +
  "AND (f.lesson_id=?3 OR f.id IN (SELECT value FROM json_each(?4))) ORDER BY l.lesson_date, f.created_at LIMIT 300";
const lessonOfRow = (f) => ({ lesson_date: f.lesson_date || null, start_time: f.lesson_start || null, created_at: f.lesson_created });
async function gsLessonDump(c, l) {
  const db = c.db;
  const ctx = await lessonCtx(db, l);
  const prev = await previousLesson(db, l);
  const refs = planRefs(l.portal).all.slice(0, 200);
  // Zwischenstopp der vorigen Sitzung (Anforderung 13): ihr Material nach dem Zwischenstopp steht in der Liste der vorigen Sitzung – oder, aus noch früheren
  // Sitzungen übernommen, über ihre Verweise in derselben Abfrage
  const ps = l.cancelled ? null : await prevStopInfo(db, l, prev, ctx.unit);
  const openRefs = ps ? planRefs(ps.open).all.slice(0, 100) : [];
  // was Eltern sehen: genau die Prüfung der Elternansicht (parentFiles) – ein Ausfall-Eintrag zeigt nie Material
  const [msgs, otherRes, pf] = await Promise.all([chatMessages(db, l.id, 40),
    prev || refs.length ? db.prepare(GS_OTHER_FILES).bind(l.klass, l.id, prev ? prev.id : "", JSON.stringify([...refs, ...openRefs])).all() : null,
    l.cancelled ? null : parentFiles(c, l)]);
  const own = ctx.files.filter((f) => f.kind === "file" && f.mime === "application/pdf");
  const others = (otherRes && otherRes.results) || [];
  const before = prev ? others.filter((f) => f.lesson_id === prev.id) : [];
  const refOthers = others.filter((f) => (!prev || f.lesson_id !== prev.id) && refs.includes(f.id));
  const results = msgs.filter((m) => m.mode === "claude" && m.role === "assistant");
  const parentsLine = l.cancelled ? "Eltern sehen zu diesem Termin nur, dass der Unterricht nicht stattfinden konnte" + (String(l.parent_note || "").trim() ? ", und den Hinweis der Lehrkraft." : ".")
    : "Eltern sehen nach der Stunde: " + ([...pf.cards, ...pf.files].map((f) => "„" + f.name + "“").join(", ") || "noch kein Material");
  const parts = [
    "# Sitzung " + l.id + " (Grundschule)", ...(l.cancelled ? ["Ausfall-Eintrag: An diesem Termin ist der Unterricht ausgefallen (Lehrkraft krank). Die geplante Stunde ist verschoben (siehe get_unit); hier gibt es weder Verlaufsplan noch Material."] : []),
    gsLessonContext(ctx, { materialText: true, materialMax: 20000 }),
    "", "## Verlaufsplan (Version " + l.portal_version + (l.portal_source ? ", zuletzt von " + l.portal_source : "") + ")",
    l.portal || (l.cancelled ? "(Ausfall-Eintrag – hier wird nichts geplant)" : "(noch leer – speichere ihn mit save_verlaufsplan)"),
    ...(hasStop(l.portal) ? ["(„" + STOP_LINE + "“ hat die Lehrkraft gesetzt: bis dorthin wurde die Stunde geschafft, alles danach ist noch offen.)"] : []),
    parentsLine,
    ...(ps ? stopLessonLines({ ...ps, openFiles: openFilesOf(ps, [...ctx.files, ...others]) }, { gs: true, unitId: ctx.unit ? ctx.unit.id : null, unit: ctx.unit, now: c.now }) : []),
    "", "## Inhalt der Unterrichtsstunde (für die Eltern)", l.parent_summary || (l.cancelled ? "(Ausfall-Eintrag – keiner)" : "(noch leer – formuliere ihn mit update_lesson und inhalt_eltern)"),
    "", "## Hinweis der Lehrkraft für die Eltern (nur lesen)", l.parent_note || "(keiner)",
  ];
  // Ausfall-Eintrag: nichts zu verweisen
  if (!l.cancelled) {
    parts.push("", "## PDF-Dateien des Kurses für Verweise ([[pdf:<file_id>]])", "Diese Sitzung:", ...(own.length ? own.map(gsFileLine) : ["(noch keine)"]));
    if (prev) parts.push("Vorige Sitzung „" + prev.title + "“" + (prev.lesson_date ? " (" + fmtDay(prev.lesson_date) + ")" : "") + ":", ...(before.length ? before.map(gsFileLine) : ["(keine)"]));
    // Verweise auf PDFs weiterer Sitzungen (z. B. aus einem früheren Zwischenstopp übernommen) – je Sitzung; Eltern sehen nur die früherer Sitzungen
    const groups = new Map();
    for (const f of refOthers) { if (!groups.has(f.lesson_id)) groups.set(f.lesson_id, []); groups.get(f.lesson_id).push(f); }
    if (groups.size) parts.push("Weitere Sitzungen, auf die der Verlaufsplan verweist:");
    for (const fs of groups.values()) {
      const f0 = fs[0], ok = refCounts(lessonOfRow(f0), l);
      parts.push("Sitzung „" + (f0.lesson_title || "") + "“ (" + (f0.lesson_date ? fmtDay(f0.lesson_date) : "ohne Termin") + ")" +
        (ok ? ":" : " – liegt nicht vor dieser Sitzung, deshalb sehen Eltern diese Dateien hier nicht:"), ...fs.map(gsFileLine));
    }
  }
  parts.push(...cardsSection(ctx.files));
  parts.push(...(await designedSection(db, l.id, (a) => (a === "student" ? "für die Kinder" : a === "teacher" ? "nur Lehrkraft" : "zum Ausdrucken"))));
  if (results.length) parts.push("", "## Gespeicherter Stundenentwurf (save_planning_result)", results[results.length - 1].content.slice(0, 20000));
  if (l.unit_id) parts.push("", "Unterrichtseinheit: " + l.unit_id + " (Details mit get_unit; Planungsgrundlagen mit get_planning_basis)");
  // Krankmeldungen in der Einheit: ausgefallene Termine und ob sie überarbeitet werden muss (Einzelheiten und uid jeder Stunde in get_unit)
  const rv = ctx.unit && ctx.unit.revise;
  if (rv && rv.items.length) parts.push("Ausgefallen (Lehrkraft krank): " + rv.items.map((x) => fmtDay(x.date) + (x.time ? " " + x.time : "")).join("; ") +
    " – die Stunden sind um je einen Termin nach hinten gerückt." + (rv.open ? " Die Einheit muss deshalb überarbeitet werden (roter Hinweis; nur nach Rücksprache mit der Lehrkraft, siehe get_unit)." : ""));
  return parts.join("\n");
}

/* Abschnitt „Bildkarten“ von get_lesson (Grundschule): Zahl der Karten, Stand der Bilder, Freigabe für Eltern und die Erzähltexte */
function cardsSection(files) {
  const sets = files.filter((f) => f.cards != null);
  if (!sets.length) return [];
  const out = ["", "## Bildkarten (eine Seite = eine Karte; Erzähltexte ändern mit set_picture_card_texts, die Gestaltung deiner eigenen Karten mit add_picture_cards und file_id – hochgeladene Karten lassen sich nicht neu gestalten)"];
  for (const f of sets) {
    // neu gestaltet, aber noch nicht gedruckt: Bilder und Seitenzahl gehören zur alten Gestaltung – Eltern sehen die Karten erst mit den neuen Bildern (F00)
    const redesign = !!f.designed && f.status === "ready" && f.html_at != null && (f.pdf_at == null || f.html_at > f.pdf_at);
    const d = cardData(f), current = !redesign && f.card_img_at != null && f.card_img_at === cardVersion(f) && (f.card_pages || 0) > 0;
    const n = current ? f.card_pages : f.status === "ready" && !redesign ? f.pages : null;
    const state = f.designed && (f.status !== "ready" || redesign) ? (f.render_error ? "Druck fehlgeschlagen: " + f.render_error : redesign ? "neue Gestaltung wartet auf den Druck – bis die neuen Bilder erstellt sind, sehen Eltern die Karten nicht" : "wartet auf den Druck")
      : current ? "Bilder bereit" : "Bilder werden erstellt, sobald die Lehrkraft Unterricks öffnet";
    out.push("- file_id " + f.id + ": „" + f.name + "“ (" + (f.designed ? "von dir gestaltet" : "von der Lehrkraft hochgeladen – die Bilder kannst du nicht sehen, die Gestaltung nicht ersetzen") + "; " + (n ? n + (n === 1 ? " Karte" : " Karten") + ", " : "") + state +
      "; Eltern sehen sie: " + (d.share ? "ja" : "nein") + ") → " + pdfRef(f.id));
    if (n && d.texts.length !== n) out.push("  Achtung: " + n + (n === 1 ? " Karte" : " Karten") + ", aber " + d.texts.length + " Erzähltext" + (d.texts.length === 1 ? "" : "e") + ".");
    out.push(...(d.texts.length ? d.texts.map((t, i) => "  " + (i + 1) + ". " + (t || "(kein Erzähltext)")) : ["  (noch keine Erzähltexte)"]));
  }
  return out;
}

/* Filter der Listen: fach (auch „gs“ = alle Kurse der Grundschule), klasse (Gymnasium), kurs (ein Grundschulkurs) */
function listFilter(a) {
  const where = [], args = [];
  if (a.fach) { args.push(a.fach); where.push("subject=?" + args.length); }
  if (a.klasse) { args.push(a.klasse); where.push("klass=?" + args.length); }
  if (a.kurs) { args.push(a.kurs); where.push("subject='gs' AND klass=?" + args.length); }
  return { where: where.length ? " WHERE " + where.join(" AND ") : "", args };
}
/* Stand der Sitzung einer Stunde (get_unit, Grundschule) – „nicht weglassen“ genau dann, wenn save_unit_plan die Stunde nicht wegfallen ließe (F21) */
function gsLessonState(l) {
  const has = [l.hasPlan ? "Verlaufsplan" : null, l.pdfs ? l.pdfs + (l.pdfs === 1 ? " PDF" : " PDFs") : null, l.cards ? "Bildkarten" : null].filter(Boolean);
  return has.length ? " – schon geplant: " + has.join(", ") + "; nicht weglassen" : l.hasContent ? " – hat schon Inhalte (z. B. Ideen, Hinweis oder Inhalt für die Eltern, Elternlink, Material, Planungsverlauf); nicht weglassen" : " – noch leer";
}
/* get_unit einer Grundschul-Einheit: Kurs im Kopf, ohne Klausur, jede Stunde mit uid und Sitzung (bzw. „[ohne Termin]“) */
function gsUnitText(u, now = Date.now()) {
  const g = (u.course && u.course.gs) || null, n = u.course && Number.isInteger(u.course.classSize) ? u.course.classSize : null;
  const byRow = new Map(u.lessons.map((l) => [l.row, l]));
  const slots = lessonSlots(u.slots);
  const lines = ["# Unterrichtseinheit " + u.id + " (Grundschule: " + (g ? g.label + " – " + g.gradeText : "Kurs " + u.klass) + (n ? ", " + n + " Kinder" : "") + ", Status: " + u.status + ", Version " + u.version + ")",
    "Titel: " + (u.title || "(offen)"), ...(n ? ["Schülerzahl laut Kurseinstellungen: " + n] : []), ...(g && g.description ? ["Ziel des Kurses: " + g.description] : []),
    paramsText(u.params, { exam: false }), "Verfügbare Sitzungen: " + slots.length, ...slots.map((x, i) => "  " + (i + 1) + ". " + fmtDay(x.date) + (x.time ? " " + x.time : "") + " (" + x.minutes + " min)"),
    "", "## Plan", JSON.stringify(u.plan, null, 1), "", "## Ablauf (Zeilen; uid = Kennung der Stunde)",
    ...u.rows.map((r, i) => { const l = byRow.get(r.uid);
      return (i + 1) + ". [uid " + r.uid + "] " + (r.date ? fmtDay(r.date) + (r.time ? " " + r.time : "") : "[ohne Termin]") + (r.minutes ? " (" + r.minutes + " min)" : "") + ": " + r.stundenfrage +
        (r.schritt != null ? " [Lernschritt " + (r.schritt + 1) + "]" : "") + (l ? " (Sitzung " + l.id + gsLessonState(l) + ")" : "") + (r.ablauf.length ? "\n   - " + r.ablauf.join("\n   - ") : ""); }),
    "", "## Sitzungen", ...(u.lessons.length ? u.lessons.map((l) => "- " + l.id + " " + (l.date ? fmtDay(l.date) : "[ohne Termin]") + ": " + l.title + (l.cancelled ? " (ausgefallen – Ausfall-Eintrag für die Eltern)" : "")) : ["(noch keine)"])];
  // Krankmeldungen: ausgefallene Termine, Stunden ohne Termin, freie Termine bis zum Ende, ob die Einheit überarbeitet werden muss
  const rv = u.revise || null, items = rv ? rv.items : [];
  if (items.length) {
    const at = (x) => fmtDay(x.date) + (x.time ? " " + x.time : "");
    lines.push("", "## Ausfälle", ...items.map((x) => "- " + at(x) + ": Unterricht ausgefallen (Lehrkraft krank) – „" + x.title + "“ und alle folgenden Stunden sind um einen Termin nach hinten gerückt" +
      (x.lengths && x.lengths.length ? "; geänderte Länge: " + x.lengths.map((g) => "Stunde " + g.n + " (" + g.from + " → " + g.to + " Min.)").join(", ") : "") + "."));
  }
  const undated = u.rows.map((r, i) => ({ r, i })).filter((x) => !x.r.date);
  if (items.length || undated.length) {
    const free = freeSlots(u.params, u.rows, now);
    lines.push("", "Stunden ohne Termin: " + (undated.length ? undated.map((x) => "Stunde " + (x.i + 1) + " „" + x.r.stundenfrage + "“ [uid " + x.r.uid + "]").join("; ") : "keine"),
      "Noch freie Termine bis zum Ende der Einheit: " + (free.length ? free.map((x) => fmtDay(x.date) + (x.time ? " " + x.time : "") + " (" + x.minutes + " min)").join("; ") : "keine"),
      "Muss überarbeitet werden: " + (rv && rv.open ? "ja (roter Hinweis in der Einheit – überarbeite sie nur nach Rücksprache mit der Lehrkraft; save_unit_plan mit der uid jeder Stunde, die bleibt)" : "nein"));
  }
  return lines.join("\n");
}

const NO_MATERIAL = "Diese Sitzung ist ein Ausfall-Eintrag (Unterricht ausgefallen) – dafür gibt es kein Material. Die verschobene Stunde hat eine eigene Sitzung (siehe get_unit).";
const NO_PLANNING = "Diese Sitzung ist ein Ausfall-Eintrag (Unterricht ausgefallen) – hier wird nichts geplant. Die verschobene Stunde hat eine eigene Sitzung (siehe get_unit).";
const NO_UPDATE = "Diese Sitzung ist ein Ausfall-Eintrag (Unterricht ausgefallen) – daran ändert nur die Lehrkraft ihren Hinweis für die Eltern, hier wird nichts geplant. " +
  "Die verschobene Stunde hat eine eigene Sitzung (siehe get_unit); dort trägst du z. B. den Inhalt für die Eltern ein.";
// Grundschule: Textmaterial sehen weder Kinder noch Eltern, und der Verlaufsplan kann nicht darauf verweisen (Abschlussprüfung F24)
const NO_GS_TEXT = "In der Grundschule gibt es kein Textmaterial: Es erschiene weder bei den Kindern noch bei den Eltern und ließe sich im Verlaufsplan nicht verweisen. " +
  "Gestalte das Material als HTML-Seite und lege es mit add_material_pdf ab – Unterricks speichert es auch, wenn der Drucker gerade ausgelastet ist, und druckt es dann automatisch nach. " +
  "Nur als Rückfall für eine Vorlage zum Ausdrucken: add_print_material.";
// Verweise im Verlaufsplan, die keine sind (z. B. der Platzhalter „[[pdf:<file_id>]]“ aus dem Beispiel oder eine file_id in Großbuchstaben): erscheinen nur als Text (F20)
// gültige Verweise (genau wie planRefs) zuerst heraus; was dann noch mit „[[pdf:“ beginnt, ist ungültig – bis „]]“ oder, wenn die Klammer nicht
// geschlossen ist (z. B. „[[pdf:<file_id>]“), bis zum nächsten „[[“ bzw. Zeilenende
function invalidPlanRefs(text) {
  const out = [];
  const rest = String(text == null ? "" : text).replace(PLAN_REF_RE, " ");
  for (const m of rest.matchAll(/\[\[\s*pdf\s*:(?:(?!\]\]|\[\[)[^\n])*(?:\]\])?/gi)) {
    const s = m[0].trim(), x = s.length > 60 ? s.slice(0, 57) + "…" : s;
    if (!out.includes(x) && out.length < 20) out.push(x);
  }
  return out;
}
async function callTool(c, name, a) {
  a = a && typeof a === "object" ? a : {};
  switch (name) {
    case "list_lessons": {
      const { where, args } = listFilter(a);
      const r = await c.db.prepare("SELECT id, subject, klass, title, topic, lesson_date, duration_min, updated_at, cancelled FROM lessons" + where + " ORDER BY updated_at DESC LIMIT 100").bind(...args).all();
      const list = r.results || [], gs = list.some((x) => x.subject === GS_SUBJECT) ? await gsCourseMap(c.db) : null;
      const rows = list.map((x) => {
        if (x.subject !== GS_SUBJECT) return { id: x.id, fach: subjectName(x.subject), klasse: x.klass, jahrgang: gradeInfo(x.klass).text, titel: x.title, thema: x.topic, datum: x.lesson_date, dauer_minuten: x.duration_min };
        const k = gs.get(x.klass);
        return { id: x.id, fach: "Grundschule", klasse: k ? k.short : x.klass, kurs: x.klass, jahrgang: k ? k.gradeText : "", titel: x.title, thema: x.topic, datum: x.lesson_date, dauer_minuten: x.duration_min, ausgefallen: !!x.cancelled };
      });
      return toolText(rows.length ? rows.map((x) => "- " + x.id + ": " + x.titel + " (" + (x.kurs ? "Grundschule: " + x.klasse : x.fach + ", " + x.klasse) + (x.datum ? ", " + x.datum : "") + ")" + (x.ausgefallen ? " (ausgefallen)" : "")).join("\n") : "Keine Sitzungen gefunden.", { lessons: rows });
    }
    case "list_gs_courses": {
      const r = await c.db.prepare("SELECT g.*, s.weekdays AS w, s.class_size AS n FROM gs_courses g LEFT JOIN course_settings s ON s.subject='gs' AND s.klass=g.id ORDER BY g.school_year DESC, g.grade, g.created_at LIMIT 200").all();
      const rows = (r.results || []).map((x) => {
        const k = gsCourseOut(x);
        let wd = []; try { wd = JSON.parse(x.w || "[]"); } catch {}
        const when = (Array.isArray(wd) ? wd : []).map((w) => (WEEKDAYS.find((d) => d.d === w.day) || { n: "?" }).n.slice(0, 2) + (w.time ? " " + w.time : "") + " (" + w.minutes + " Min.)");
        return { kurs: k.id, bezeichnung: k.label, kurz: k.short, jahrgang: k.grade, klassen: k.classes.map((y) => k.grade + y), fach: k.subjectName, religion: k.religion, schuljahr: k.schoolYear,
          termine: when, kinder: Number.isInteger(x.n) ? x.n : null, ziel: k.description || null };
      });
      return toolText(rows.length ? rows.map((x) => "- " + x.kurs + ": " + x.bezeichnung + (x.schuljahr ? ", Schuljahr " + x.schuljahr : "") + "; " + (x.termine.length ? x.termine.join(", ") : "kein Stundenplan eingetragen") +
        (x.kinder ? "; " + x.kinder + " Kinder" : "") + (x.ziel ? " – Ziel: " + x.ziel.replace(/\s*\n\s*/g, " ") : "")).join("\n") : "Es gibt noch keine Grundschulkurse.", { courses: rows });
    }
    case "get_lesson": {
      const l = await getLesson(c.db, a.lesson_id);
      if (l.subject === GS_SUBJECT) return toolText(await gsLessonDump(c, l), { lesson_id: l.id, portal_version: l.portal_version, verlaufsplan_version: l.portal_version });
      return toolText(await lessonDump(c.db, l, c.now), { lesson_id: l.id, portal_version: l.portal_version });
    }
    case "list_units": {
      const { where, args } = listFilter(a);
      const r = await c.db.prepare("SELECT id, subject, klass, title, status, rows FROM units" + where + " ORDER BY updated_at DESC LIMIT 100").bind(...args).all();
      const list = r.results || [], gs = list.some((x) => x.subject === GS_SUBJECT) ? await gsCourseMap(c.db) : null;
      const rows = list.map((x) => (x.subject !== GS_SUBJECT ? { id: x.id, fach: subjectName(x.subject), klasse: classShort(x.klass), titel: x.title, status: x.status, stunden: JSON.parse(x.rows || "[]").length }
        : { id: x.id, fach: "Grundschule", klasse: gs.get(x.klass) ? gs.get(x.klass).short : x.klass, kurs: x.klass, titel: x.title, status: x.status, stunden: JSON.parse(x.rows || "[]").length }));
      // Grundschule wie in list_lessons: „(Grundschule: Religion 2ab, …)“
      return toolText(rows.length ? rows.map((x) => "- " + x.id + ": " + (x.titel || "(ohne Titel)") + " (" + (x.kurs ? "Grundschule: " + x.klasse : x.fach + ", " + x.klasse) + ", " + x.status + ", " + x.stunden + " Stunden)").join("\n") : "Keine Einheiten gefunden.", { units: rows });
    }
    case "get_unit": {
      const u = await unitFull(c.db, await getUnit(c.db, a.unit_id));
      if (u.subject === GS_SUBJECT) return toolText(gsUnitText(u, c.now), { unit_id: u.id, version: u.version });
      const lines = ["# Unterrichtseinheit " + u.id + " (" + subjectName(u.subject) + ", " + classShort(u.klass) + " – " + gradeInfo(u.klass).text + ", Status: " + u.status + ", Version " + u.version + ")",
        "Titel: " + (u.title || "(offen)"), ...(u.course && Number.isInteger(u.course.classSize) ? ["Schülerzahl laut Kurseinstellungen: " + u.course.classSize] : []), paramsText(u.params), "Verfügbare Sitzungen: " + lessonSlots(u.slots).length, ...lessonSlots(u.slots).map((x, i) => "  " + (i + 1) + ". " + fmtDay(x.date) + " (" + x.minutes + " min)"),
        "", "## Plan", JSON.stringify(u.plan, null, 1), "", "## Ablauf (Zeilen)", ...u.rows.map((r, i) => (i + 1) + ". " + (r.date ? fmtDay(r.date) + ": " : "") + r.stundenfrage + (r.schritt != null ? " [Lernschritt " + (r.schritt + 1) + "]" : "") + "\n   - " + r.ablauf.join("\n   - ")),
        "", "## Sitzungen", ...(u.lessons.length ? u.lessons.map((l) => "- " + l.id + " " + (l.date ? fmtDay(l.date) : "") + ": " + l.title) : ["(noch keine)"])];
      return toolText(lines.join("\n"), { unit_id: u.id, version: u.version });
    }
    case "get_planning_basis": {
      let subject, klass;
      if (a.unit_id) { const u = await getUnit(c.db, a.unit_id); subject = u.subject; klass = u.klass; }
      else if (a.lesson_id) { const l = await getLesson(c.db, a.lesson_id); subject = l.subject; klass = l.klass; }
      else return toolError("Bitte unit_id oder lesson_id angeben.");
      if (subject === GS_SUBJECT) {   // Grundschulkurs: Curriculum des Jahrgangs (Religion) bzw. die Grundlagen des Kurses
        const course = gsCourseOut(await getGsCourse(c.db, klass));
        const b = await planningBasisGs(c.db, course, a.max_zeichen || 180000);
        const head = ["# Planungsgrundlagen für " + course.label + " (Grundschule)", "Lerngruppe: " + course.gradeText,
          course.description ? "## Ziel des Kurses\n" + course.description : "",
          b.missing.length ? "## Fehlende Planungsgrundlagen\n- " + b.missing.join("\n- ") : "", b.truncated ? "(Gekürzt – weitere Seiten über max_zeichen anfordern.)" : ""].filter(Boolean);
        return toolText(head.join("\n\n") + "\n\n" + (b.text || "(Es sind noch keine passenden Dokumente hochgeladen.)"), { docs: b.docs, missing: b.missing });
      }
      const b = await planningBasis(c.db, subject, klass, a.max_zeichen || 180000);
      const head = ["# Planungsgrundlagen für " + subjectName(subject) + ", " + classShort(klass) + " – " + gradeInfo(klass).text,
        b.rules ? "## Planungsregeln der Lehrkraft\n" + b.rules : "", b.gradeNote ? "Hinweis zum Jahrgang: " + b.gradeNote : "",
        b.missing.length ? "## Fehlende Planungsgrundlagen\n- " + b.missing.join("\n- ") : "", b.truncated ? "(Gekürzt – weitere Seiten über max_zeichen anfordern.)" : ""].filter(Boolean);
      return toolText(head.join("\n\n") + "\n\n" + (b.text || "(Es sind noch keine passenden Dokumente hochgeladen.)"), { docs: b.docs, missing: b.missing });
    }
    case "save_unit_plan": {
      const u = await getUnit(c.db, a.unit_id);
      try {
        const r = await applyPlan(c.db, u, a.plan, a.stunden, Number.isInteger(a.base_version) ? a.base_version : null, "claude", c.now);
        if (!r.uid) return toolText("Plan gespeichert (Version " + r.version + ", " + a.stunden.length + " Stunden). Die Lehrkraft prüft ihn in der Plattform und legt dort die Sitzungen an.", { version: r.version });
        // mit uid (Überarbeitung): Stunden samt Sitzungen bleiben; in der Grundschule verteilt die Plattform die Termine neu
        const when = (m) => (m.to ? fmtDay(m.to) + (m.time ? " " + m.time : "") : "ohne Termin");
        const t = ["Plan gespeichert (Version " + r.version + ", " + a.stunden.length + " Stunden; Stunden mit uid behalten ihre Sitzung)."];
        if (u.subject === GS_SUBJECT) t.push("Termine neu verteilt: " + (r.moves.length ? r.moves.map((m) => "Stunde " + m.n + " „" + m.title + "“ → " + when(m)).join("; ") : "keine Änderung") + ".",
          "Ohne Termin: " + (r.undated.length ? r.undated.map((x) => "Stunde " + x.n + " „" + x.title + "“").join("; ") : "keine") + ".");
        if (r.deleted) t.push(r.deleted === 1 ? "Eine leere Sitzung einer weggefallenen Stunde wurde gelöscht." : r.deleted + " leere Sitzungen weggefallener Stunden wurden gelöscht.");
        if (r.reviseClosed) t.push("Der rote Hinweis in der Einheit ist entfernt.");
        t.push("Für neue Stunden legt die Lehrkraft die Sitzungen in der Plattform an.");
        return toolText(t.join(" "), { version: r.version, moves: r.moves, undated: r.undated.map((x) => x.uid), deleted: r.deleted });
      } catch (e) {
        if (e instanceof HttpError && e.code === "unit_conflict") return toolError("Die Einheit wurde inzwischen geändert (Version " + e.extra.version + "). Bitte get_unit erneut aufrufen.");
        if (e instanceof HttpError && (e.code === "rows_with_lessons" || e.code === "uid_required")) return toolError(e.message);
        throw e;
      }
    }
    case "update_unit_row": {
      // mehrere Stunden in einer versionsgeprüften Speicherung (Inhalte rücken nach einem Zwischenstopp nach)
      if (a.stunden !== undefined) {
        if (!a.unit_id) return toolError("stunden geht nur mit unit_id (aus get_unit).");
        if (a.lesson_id || a.uid || a.stundenfrage !== undefined || a.ablauf !== undefined) return toolError("Mit stunden bitte weder lesson_id noch uid, stundenfrage oder ablauf angeben – jede Stunde steht mit ihren Angaben in stunden.");
        const u0 = await getUnit(c.db, a.unit_id), gsU = u0.subject === GS_SUBJECT;
        try {
          const r = await updateRows(c.db, u0.id, a.stunden, Number.isInteger(a.base_version) ? a.base_version : null, "claude", c.now);
          return toolText("In der Einheit festgehalten (Version " + r.version + ", " + r.rows.length + (r.rows.length === 1 ? " Stunde" : " Stunden") + "): " +
            r.rows.map((x) => "Stunde " + x.n + (gsU ? " [uid " + x.uid + "]" : "") + " „" + x.stundenfrage + "“").join("; ") + ".", { version: r.version, rows: r.rows.map((x) => ({ n: x.n, uid: x.uid })) });
        } catch (e) {
          if (e instanceof HttpError && e.code === "unit_conflict") return toolError("Die Einheit wurde inzwischen geändert (Version " + e.extra.version + "). Bitte get_unit erneut aufrufen – es wurde nichts gespeichert.");
          if (e instanceof HttpError) return toolError(e.message + " Es wurde nichts gespeichert.");
          throw e;
        }
      }
      let unitId, uid;
      if (a.lesson_id) {
        const l = await getLesson(c.db, a.lesson_id);
        if (l.cancelled) return toolError("Diese Sitzung ist ein Ausfall-Eintrag (Unterricht ausgefallen) – sie hat keine eigene Stunde in der Einheit. Die verschobene Stunde hat eine eigene Sitzung; " +
          "mit unit_id und der uid der Stunde aus get_unit passt du sie an.");
        if (!l.unit_id || !l.unit_row) return toolError("Diese Sitzung gehört zu keiner Unterrichtseinheit.");
        unitId = l.unit_id; uid = l.unit_row;
      } else if (a.unit_id && typeof a.uid === "string" && /^[a-f0-9]{8}$/.test(a.uid)) { unitId = a.unit_id; uid = a.uid; }
      else return toolError("Bitte lesson_id angeben – oder unit_id und uid der Stunde (aus get_unit).");
      const row = await updateRow(c.db, unitId, uid, { stundenfrage: a.stundenfrage, ablauf: a.ablauf }, "claude", c.now);
      return toolText("In der Einheit festgehalten: " + row.stundenfrage);
    }
    case "extend_unit": {
      const u = await getUnit(c.db, a.unit_id), gsU = u.subject === GS_SUBJECT;
      let r;
      try { r = await extendUnit(c.db, u, { baseVersion: a.base_version, termine: a.termine, stunden: a.stunden }, "claude", c.now); }
      catch (e) {
        if (e instanceof HttpError && e.code === "unit_conflict") return toolError("Die Einheit wurde inzwischen geändert (Version " + e.extra.version + "). Bitte get_unit erneut aufrufen – es wurde nichts verlängert.");
        if (e instanceof HttpError) return toolError(e.message + " Es wurde nichts verlängert.");
        throw e;
      }
      const when = (x) => fmtDay(x.date) + (x.time ? " " + x.time : "") + (x.minutes ? " (" + x.minutes + " Min.)" : "");
      const t = ["Einheit verlängert (Version " + r.version + "): Ende bisher " + fmtDay(r.oldEnd) + ", jetzt " + fmtDay(r.end) + "."];
      for (const x of r.rows) t.push("Stunde " + x.n + (gsU ? " [uid " + x.uid + "]" : "") + " „" + x.stundenfrage + "“" + (x.fresh ? " (neu)" : " (bisher ohne Termin)") + ": " + when(x) +
        (x.lessonId ? (x.created ? " – Sitzung " + x.lessonId + " angelegt." : " – Sitzung " + x.lessonId + (gsU ? " hat jetzt diesen Termin." : ".")) : u.status === "geplant" ? " – die Sitzung legt die Lehrkraft in der Einheit an." : "."));
      if (!r.rows.length) t.push("Es gab keine Stunde ohne Termin und keine neue Stunde – die Termine sind frei.");
      if (r.free.length) t.push("Frei geblieben: " + r.free.map(when).join("; ") + ".");
      if (u.status !== "geplant" && r.rows.length) t.push("Die Einheit ist noch nicht festgelegt – die Sitzungen entstehen, wenn die Lehrkraft sie festlegt.");
      t.push("Die Lehrkraft sieht die Änderung sofort in der Einheit. Für update_unit_row gilt jetzt base_version " + r.version + ".");
      return toolText(t.join(" "), { version: r.version, end: r.end, rows: r.rows, free: r.free });
    }
    case "save_substitute_plan": {
      if ((await getLesson(c.db, a.lesson_id)).subject === GS_SUBJECT) return toolError("In der Grundschule gibt es keine Vertretungsstunde – bei Krankheit verschiebt Unterricks die Stunden; danach überarbeitest du die Einheit.");
      const p = await saveProposal(c.db, a.lesson_id, a, c.now);
      return toolText("Vertretungsvorschlag gespeichert (" + p.schritte.length + " Schritte" + (p.escape_room ? ", Escape-Room „" + p.escape_room.name + "“ mit Lösungswort " + p.escape_room.wort + " und Feibeitsblatt-Finale" : p.draftId ? ", Feibeitsblatt-Entwurf" : "") +
        "). Die Lehrkraft prüft und bestätigt ihn in der Plattform" + (p.escape_room ? " (mit Vorschau des Escape-Rooms)." : "."));
    }
    case "update_lesson": {
      // Ausfall-Eintrag (Grundschule): dort ändert nur die Lehrkraft ihren Hinweis für die Eltern – den kann der Connector nicht setzen (F22)
      const l0 = await getLesson(c.db, a.lesson_id);
      if (l0.cancelled) return toolError(NO_UPDATE);
      // Entscheidung zum offenen Teil der vorigen Sitzung (Zwischenstopp): erst prüfen, dann alles speichern – nie halb
      let stopNote = "", stopPrev = null;
      if (a.zwischenstopp !== undefined) {
        if (!STOP_CHOICES.includes(a.zwischenstopp)) return toolError("zwischenstopp ist \"uebernehmen\" oder \"verzichten\".");
        // mit neuem Datum im selben Aufruf: die vorige Sitzung zum neuen Datum (sonst gälte die Entscheidung nach dem Speichern nicht)
        stopPrev = await previousLesson(c.db, a.datum !== undefined ? { ...l0, lesson_date: a.datum } : l0);
        if (!stopPrev || !hasStop(stopPrev.portal)) return toolError("Die vorige Sitzung hat keinen Zwischenstopp.");
      }
      const b = {};
      if (a.titel !== undefined) b.title = a.titel;
      if (a.thema !== undefined) b.topic = a.thema;
      if (a.dauer_minuten !== undefined) b.durationMin = a.dauer_minuten;
      if (a.datum !== undefined) b.date = a.datum;
      if (a.beginn !== undefined) b.startTime = a.beginn;
      if (a.ideen !== undefined) b.ideas = a.ideen;
      if (a.hausaufgabe !== undefined) b.homework = a.hausaufgabe;
      if (a.inhalt_eltern !== undefined) b.parentSummary = a.inhalt_eltern;
      let { lesson: l } = await updateLesson(c.db, a.lesson_id, b, c.now);
      if (stopPrev) {
        await c.db.prepare("UPDATE lessons SET stop_decision=?2, updated_at=?3 WHERE id=?1").bind(l.id, stopDecisionJson(a.zwischenstopp, stopPrev, c.now), c.now).run();
        l = await getLesson(c.db, l.id);
        stopNote = " Entscheidung zum offenen Teil der vorigen Sitzung „" + stopPrev.title + "“ festgehalten: " + STOP_CHOICE_TEXT[a.zwischenstopp] +
          (l.unit_id || stopPrev.unit_row ? " Passe die Einheit an, sobald die Lehrkraft die Planung dieser Stunde bestätigt hat (siehe get_lesson)." : "");
      }
      return toolText("Gespeichert." + stopNote, { lesson: lessonOut(l), ...(stopPrev ? { zwischenstopp: a.zwischenstopp } : {}) });
    }
    case "save_planning_result": {
      if ((await getLesson(c.db, a.lesson_id)).cancelled) return toolError(NO_PLANNING);
      const t = cleanText(a.text, LIMITS.answer).trim();
      if (!t) return toolError("Der Text ist leer.");
      await c.db.batch([
        c.db.prepare("INSERT INTO chat(lesson_id, role, content, model, mode, created_at) VALUES(?1, 'assistant', ?2, 'Claude (claude.ai, Connector)', 'claude', ?3)").bind(a.lesson_id, t, c.now),
        c.db.prepare("UPDATE lessons SET updated_at=?2 WHERE id=?1").bind(a.lesson_id, c.now),
      ]);
      return toolText("Im Planungsverlauf der Sitzung gespeichert.");
    }
    case "save_schulportal_entry": {
      if ((await getLesson(c.db, a.lesson_id)).subject === GS_SUBJECT) return toolError("In der Grundschule gibt es keinen Schulportal-Eintrag – speichere den Verlaufsplan mit save_verlaufsplan.");
      if (typeof a.text !== "string" || !a.text.trim()) return toolError("Der Eintrag ist leer.");
      try {
        const p = await savePortal(c.db, a.lesson_id, a.text, Number.isInteger(a.base_version) ? a.base_version : null, "claude", c.now);
        return toolText("Schulportal-Eintrag gespeichert (Version " + p.version + ").", { version: p.version });
      } catch (e) {
        if (e instanceof HttpError && e.code === "portal_conflict") return toolError("Der Eintrag wurde inzwischen geändert (aktuelle Version " + e.extra.current.version + "). Bitte get_lesson erneut aufrufen und die Änderungen der Lehrkraft berücksichtigen.");
        throw e;
      }
    }
    case "add_material_pdf": {
      const lx = await getLesson(c.db, a.lesson_id), gs = lx.subject === GS_SUBJECT;
      if (lx.cancelled) return toolError(NO_MATERIAL);
      const area = { schueler: "student", lehrkraft: "teacher", druck: "print" }[a.bereich] || "";
      if (!a.file_id && !area) return toolError("Bitte bereich angeben: schueler, lehrkraft oder druck.");
      const f = await saveDesign(c, a.lesson_id, { area, title: a.titel, html: a.html, print: { copies: a.anzahl, duplex: a.beidseitig, color: a.farbe }, source: "claude", fileId: a.file_id || null, gsPrint: gs });
      const pName = () => printFileName({ name: f.name, copies: f.print_copies, duplex: f.print_duplex !== 0, color: f.print_color === 1 });
      const where = gs && f.area === "student" ? "für die Kinder (Eltern sehen es nach der Stunde)" + (f.print_copies != null ? " und in der Liste „Von der Lehrkraft auszudrucken“ als „" + pName() + "“" : "")
        : f.area === "student" ? "für die Schüler:innen" : f.area === "teacher" ? "nur für die Lehrkraft" : "in der Liste „Von der Lehrkraft auszudrucken“ als „" + pName() + "“";
      const ref = gs ? " Verweis im Verlaufsplan: " + pdfRef(f.id) + "." : "";
      try {
        const r = await renderDesign(c, f, { waitMs: 30000 });
        const kb = Math.max(1, Math.round(r.bytes / 1024));
        return toolText("„" + r.file.name + "“ " + (a.file_id ? "überarbeitet" : "gespeichert") + " und als PDF gedruckt: " + (r.pages ? r.pages + (r.pages === 1 ? " Seite" : " Seiten") : "Seitenzahl unbekannt") + ", " + kb + " KB, " + where + "." +
          (r.current ? "" : " (Inzwischen kam eine neuere Gestaltung an – Unterricks druckt sie nach.)") + " Ändern: add_material_pdf mit file_id " + f.id + "." + ref, { file_id: f.id, pages: r.pages || null, bytes: r.bytes, status: "gedruckt" });
      } catch (e) {
        const code = e && e.code ? String(e.code) : "";
        const later = code === "render_busy" || code === "render_quota" || code === "render_config";
        return toolText("„" + f.name + "“ ist " + (a.file_id ? "überarbeitet" : "gespeichert") + " (" + where + "), aber noch nicht als PDF gedruckt: " + (e && e.message ? e.message : "Fehler beim Druck") + " " +
          (later ? "Unterricks druckt es automatisch nach, sobald die Lehrkraft Unterricks öffnet; bis dahin sehen die Schüler:innen " + (a.file_id && f.status === "ready" ? "die bisherige Fassung." : "es noch nicht.")
            : "Bitte die Gestaltung prüfen und mit add_material_pdf (file_id " + f.id + ") korrigiert erneut senden.") + ref, { file_id: f.id, status: later ? "wartet auf den Druck" : "Druckfehler", error: e && e.message ? e.message : null });
      }
    }
    case "get_material": {
      const f = await getFile(c.db, a.file_id);
      if (f.html == null || f.area === "archive") return toolError("Zu dieser file_id gibt es kein gestaltetes Material (siehe get_lesson).");
      return toolText("# " + f.name + " (" + (f.area === "student" ? "für Schüler:innen" : f.area === "teacher" ? "nur für die Lehrkraft" : "zum Ausdrucken") + ", Sitzung " + f.lesson_id + ")\n\n" + shortImages(f.html), { file_id: f.id, lesson_id: f.lesson_id });
    }
    case "add_picture_cards": {
      const n = Array.isArray(a.erzaehltexte) ? a.erzaehltexte.length : 0;
      const f = await saveCardSet(c, a.lesson_id, { title: a.titel, html: a.html, texts: a.erzaehltexte, fileId: a.file_id || null, share: a.fuer_eltern });
      const ref = " Verweis: " + pdfRef(f.id) + ".", kept = cardData(f).texts.length;
      const share = cardData(f).share ? "" : " Eltern sehen sie nicht (fuer_eltern: false).";
      const verb = a.file_id ? "überarbeitet" : "gespeichert";
      try {
        const r = await renderDesign(c, f, { waitMs: 30000 });
        const pages = r.pages || null;
        const head = "Bildkarten „" + r.file.name + "“ " + verb + " und gedruckt: ";
        if (!pages) return toolText(head + "Seitenzahl unbekannt, " + kept + " Erzähltexte." + ref + " Die Zahl der Karten prüft Unterricks beim Erstellen der Bilder; Abweichungen sieht die Lehrkraft auf der Sitzungsseite." + share,
          { file_id: f.id, pages: null, texts: kept, status: "gedruckt" });
        if (pages !== kept) return toolText(head + pages + (pages === 1 ? " Seite" : " Seiten") + "." + ref + " Achtung: Die PDF hat " + pages + (pages === 1 ? " Seite" : " Seiten") + ", du hast " + kept + " Erzähltext" + (kept === 1 ? "" : "e") +
          " geschickt – jede Karte muss genau eine Seite sein (break-after: page; overflow: hidden) und genau einen Text haben; bitte mit file_id " + f.id + " korrigieren." + share, { file_id: f.id, pages, texts: kept, status: "gedruckt", mismatch: true });
        return toolText(head + pages + (pages === 1 ? " Seite" : " Seiten") + " = " + pages + (pages === 1 ? " Karte" : " Karten") + ", " + kept + " Erzähltext" + (kept === 1 ? "" : "e") + "." + ref +
          " Die Bilder für die Elternansicht erstellt Unterricks, sobald die Lehrkraft Unterricks öffnet." + (r.current ? "" : " (Inzwischen kam eine neuere Gestaltung an – Unterricks druckt sie nach.)") + share, { file_id: f.id, pages, texts: kept, status: "gedruckt" });
      } catch (e) {
        const code = e && e.code ? String(e.code) : "";
        const later = code === "render_busy" || code === "render_quota" || code === "render_config";
        return toolText("Bildkarten „" + f.name + "“ " + verb + " (" + kept + " Erzähltexte), aber noch nicht als PDF gedruckt: " + (e && e.message ? e.message : "Fehler beim Druck") + " " +
          (later ? "Unterricks druckt sie automatisch nach, sobald die Lehrkraft Unterricks öffnet. Die Zahl der Karten prüft Unterricks nach dem Druck; Abweichungen sieht die Lehrkraft auf der Sitzungsseite."
            : "Bitte die Gestaltung prüfen und mit add_picture_cards (file_id " + f.id + ") korrigiert erneut senden.") + ref + share,
          { file_id: f.id, texts: kept, status: later ? "wartet auf den Druck" : "Druckfehler", error: e && e.message ? e.message : null, ...(n !== kept ? { sent: n } : {}) });
      }
    }
    case "set_picture_card_texts": {
      const f0 = await getFile(c.db, a.file_id);
      if (f0.cards == null || f0.area === "archive") return toolError("Zu dieser file_id gibt es keine Bildkarten (siehe get_lesson, Abschnitt „Bildkarten“).");
      if ((await getLesson(c.db, f0.lesson_id)).subject !== GS_SUBJECT) return toolError("Bildkarten gibt es nur in Sitzungen der Grundschule.");
      const { file: f, cards } = await setCardTexts(c, f0.id, a.erzaehltexte);
      const k = cards.texts.length, cardsN = f.card_pages || (f.status === "ready" ? f.pages : null) || null;
      const base = "Erzähltexte gespeichert: " + k + (k === 1 ? " Text" : " Texte");
      if (!cardsN) return toolText(base + " (wie viele Karten es sind, steht erst fest, wenn Unterricks die Bilder erstellt hat).", { file_id: f.id, texts: k, cards: null });
      if (cardsN !== k) return toolText(base + ". Achtung: Die Bildkarten haben " + cardsN + (cardsN === 1 ? " Karte" : " Karten") + ", du hast " + k + " Erzähltext" + (k === 1 ? "" : "e") +
        " geschickt – genau ein Text je Karte, in der Reihenfolge der Karten; bitte korrigieren.", { file_id: f.id, texts: k, cards: cardsN, mismatch: true });
      return toolText(base + " für " + cardsN + (cardsN === 1 ? " Karte" : " Karten") + ".", { file_id: f.id, texts: k, cards: cardsN });
    }
    case "save_verlaufsplan": {
      const l = await getLesson(c.db, a.lesson_id);
      if (l.subject !== GS_SUBJECT) return toolError("Nur für Grundschul-Sitzungen – sonst save_schulportal_entry.");
      if (typeof a.text !== "string" || !a.text.trim()) return toolError("Der Verlaufsplan ist leer.");
      // Verweise prüfen (eine Abfrage): PDFs aus Sitzungen dieses Kurses – diese Sitzung zuerst, dann die früheren (neueste zuerst)
      const fr = await c.db.prepare("SELECT f.id, f.lesson_id, f.name, l.title AS lesson_title, l.lesson_date, l.start_time AS lesson_start, l.created_at AS lesson_created " +
        "FROM files f JOIN lessons l ON l.id = f.lesson_id WHERE l.subject='gs' AND l.klass=?1 AND f.kind='file' AND f.mime='application/pdf' AND f.area NOT IN ('archive','presentation') " +
        "ORDER BY (f.lesson_id=?2) DESC, l.lesson_date DESC, f.created_at LIMIT 500").bind(l.klass, l.id).all();
      const files = fr.results || [], byId = new Map(files.map((f) => [f.id, f]));
      // für die Eltern zählen nur Verweise auf Dateien dieser oder einer früheren Sitzung (wie parentFiles – Abschlussprüfung F18)
      const counts = (f) => f.lesson_id === l.id || refCounts(lessonOfRow(f), l);
      let p;
      try { p = await savePortal(c.db, l.id, a.text, Number.isInteger(a.base_version) ? a.base_version : null, "claude", c.now); }
      catch (e) {
        if (e instanceof HttpError && e.code === "portal_conflict") return toolError("Der Verlaufsplan wurde inzwischen geändert (aktuelle Version " + e.extra.current.version + "). Bitte get_lesson erneut aufrufen und die Änderungen der Lehrkraft berücksichtigen.");
        throw e;
      }
      // geprüft wird der gespeicherte Text (bereinigt wie in savePortal) – genau das, was Verlaufsplan und Elternansicht lesen
      const refs = planRefs(p.text).all;
      const unknown = refs.filter((id) => !byId.has(id)), later = refs.filter((id) => byId.has(id) && !counts(byId.get(id)));
      const invalid = invalidPlanRefs(p.text);
      // was Eltern nach der Stunde sehen: genau die Prüfung der Elternansicht (F01/F18)
      const pf = await parentFiles(c, { ...l, portal: p.text });
      const parentsSee = [...pf.cards, ...pf.files].map((f) => "„" + f.name + "“").join(", ") || "noch kein Material";
      const valid = [...files.filter(counts), ...files.filter((f) => !counts(f))].slice(0, 20).map((f) => f.id + " („" + f.name + "“)").join(", ");
      const t = ["Verlaufsplan gespeichert (Version " + p.version + ")."];
      if (unknown.length) t.push("Achtung: Diese Verweise gehören zu keiner PDF des Kurses: " + unknown.map(pdfRef).join(", ") + ".");
      if (invalid.length) t.push("Achtung: Diese Verweise sind ungültig und erscheinen nur als Text: " + invalid.join(", ") + " – ein Verweis lautet genau [[pdf:<file_id>]] mit der file_id aus get_lesson " +
        "(16 Zeichen, Kleinbuchstaben a–f und Ziffern), optional mit „|Beschriftung“ (höchstens 200 Zeichen).");
      if (unknown.length || invalid.length) t.push("Gültige file_id: " + (valid || "(noch keine PDF-Dateien im Kurs)") + ". Bitte korrigieren (save_verlaufsplan mit base_version " + p.version + ").");
      if (later.length) t.push("Achtung: Eltern sehen " + (later.length === 1 ? "diesen Verweis" : "diese Verweise") + " zu dieser Stunde nicht, " +
        (l.lesson_date ? "weil die Datei nicht zu dieser oder einer früheren Sitzung gehört" : "weil diese Sitzung noch keinen Termin hat") + ": " +
        later.map((id) => { const f = byId.get(id); return "„" + f.name + "“ (Sitzung „" + (f.lesson_title || "") + "“, " + (f.lesson_date ? fmtDay(f.lesson_date) : "ohne Termin") + ")"; }).join(", ") +
        ". Für die Eltern nur Material dieser oder einer früheren Sitzung verweisen.");
      t.push("Eltern sehen nach der Stunde: " + parentsSee + ".");
      return toolText(t.join(" "), { version: p.version, unknown_refs: unknown, invalid_refs: invalid, later_refs: later });
    }
    case "add_text_material": {
      const lx = await getLesson(c.db, a.lesson_id);
      if (lx.cancelled) return toolError(NO_MATERIAL);
      if (lx.subject === GS_SUBJECT) return toolError(NO_GS_TEXT);
      const area = a.bereich === "schueler" ? "student" : a.bereich === "lehrkraft" ? "teacher" : "";
      const f = await insertTextMaterial(c.db, a.lesson_id, area, a.titel, a.markdown, "claude", c.now);
      return toolText("Material „" + f.name + "“ gespeichert (" + (area === "student" ? "für Schüler:innen sichtbar" : "nur für die Lehrkraft") + ").", { file_id: f.id });
    }
    case "add_print_material": {
      if ((await getLesson(c.db, a.lesson_id)).cancelled) return toolError(NO_MATERIAL);
      const f = await insertPrintText(c.db, a.lesson_id, a.titel, a.markdown, { copies: a.anzahl, duplex: a.beidseitig !== false, color: a.farbe === true }, "claude", c.now);
      const o = fileOut(f);
      return toolText("Druckvorlage gespeichert: „" + o.printName + "“ (Liste „Von der Lehrkraft auszudrucken“).", { file_id: f.id, file_name: o.printName });
    }
    case "propose_feibeitsblatt": {
      if ((await getLesson(c.db, a.lesson_id)).subject === GS_SUBJECT) return toolError("In der Grundschule gibt es keine Feibeitsblätter.");
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
