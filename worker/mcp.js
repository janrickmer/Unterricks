// mcp.js – Connector für claude.ai („Custom Connector“, Remote-MCP über Streamable HTTP, zustandslos, nur Werkzeuge).
// So nutzt die Lehrkraft Claude mit ihrem Pro-Abo erlaubt: Sie arbeitet in claude.ai, Claude liest und schreibt dort die Daten der
// Plattform. Unterstützt das aktuelle Protokoll (2026-07-28, ohne Handshake) und ältere Clients (initialize-Handshake).
// Zugang: geheimer Schlüssel in der Adresse (/mcp/<schlüssel>, für „Ohne Anmeldung“) oder als Authorization: Bearer.
import { HttpError, json, readJson, sha256Hex, timingSafeEqual, randomToken, LOCKS, lockedFor, registerFail, cleanText, cleanLine } from "./lib.js";
import { getSetting, setSetting } from "./db.js";
import { requireTeacher } from "./auth.js";
import { getLesson, lessonCtx, chatMessages, updateLesson, savePortal, insertDraft, lessonOut, fileOut, LIMITS, previousLesson, GS_CTX_FILES } from "./lessons.js";
import { getUnit, unitFull, applyPlan, updateRow } from "./units.js";
import { planningBasis } from "./bases.js";
import { gsCourseMap, gsCourseOut, getGsCourse, planningBasisGs } from "./gs.js";
import { saveProposal, getSubstitute } from "./substitute.js";
import { paramsText, lessonSlots, WEEKDAYS } from "../public/planning.js";
import { insertTextMaterial, insertPrintText, saveDesign, renderDesign, getFile } from "./files.js";
import { shortImages } from "./render.js";
import { ESCAPE_FORMAT_HINT, PART_TYPES } from "../public/escape-data.js";
import { SUBJECTS, ALL_CLASSES, subjectName, gradeInfo, formatCode, lessonContext, chatTranscript, PORTAL_RULES, PORTAL_EXAMPLE, PORTAL_TEACHER_RULE, SYSTEM_PROMPT_ROLE, FEIBEITSBLATT_INFO, classShort, fmtDay, materialDesignText, printFileName, GS_SUBJECT,
  STOP_LINE, hasStop, planRefs, parentMaterial, pdfRef } from "../public/shared.js";
import { gsLessonContext, GS_MATERIAL_RULES, VERLAUFSPLAN_EXAMPLE, VERLAUFSPLAN_RULES } from "../public/gsplanning.js";

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
    description: "Ändert Titel, Thema, Dauer, Datum, Beginn (Uhrzeit), das Notizfeld „Ideen und Wünsche“ oder die Hausaufgabe (bis zur nächsten Sitzung; Schüler:innen sehen sie ab 15 Minuten vor dem Ende der Sitzung) einer Sitzung (nur übergebene Felder).",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, titel: { type: "string", maxLength: 200 }, thema: { type: "string", maxLength: 500 },
      dauer_minuten: { type: "integer", minimum: 5, maximum: 600 }, datum: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      beginn: { type: "string", pattern: "^([01]\\d|2[0-3]):[0-5]\\d$", description: "Uhrzeit des Unterrichtsbeginns, z. B. 07:45" }, ideen: { type: "string", maxLength: 20000 },
      hausaufgabe: { type: "string", maxLength: 10000, description: "Schulportal-Zeichen erlaubt; leer = keine Hausaufgabe (Grundschule: schlichter Text für Eltern und Kinder, ohne Schulportal-Zeichen; Eltern sehen sie nach der Stunde)" },
      inhalt_eltern: { type: "string", maxLength: 800, description: "nur Grundschule: Inhalt der Unterrichtsstunde für die Eltern – 2–3 Sätze, elternverständlich: worum es ging und was die Kinder lernen sollten; nie Namen von Kindern" } }, required: ["lesson_id"], additionalProperties: false } },
  { name: "save_planning_result", title: "Planungsergebnis in der Sitzung speichern", annotations: wr,
    description: "Speichert ein Planungsergebnis (z. B. den ausgearbeiteten Stundenentwurf) als Nachricht „Claude“ im Planungsverlauf der Sitzung, damit Schulportal-Eintrag und Präsentations-Prompt der Plattform darauf aufbauen.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, text: { type: "string", description: "Markdown", maxLength: 100000 } }, required: ["lesson_id", "text"], additionalProperties: false } },
  { name: "save_schulportal_entry", title: "Schulportal-Eintrag speichern", annotations: { ...wr, destructiveHint: true },
    description: "Ersetzt den Schulportal-Eintrag der Sitzung. Format: Schulportal-Zeichen (**fett**, ~~kursiv~~, __unterstrichen__, --durchgestrichen--, Zeilen mit \"- \"), Struktur wie in der Vorlage (nummerierte fette Phasen, Stichpunkte, „--> Nächste Stunde“). " + PORTAL_TEACHER_RULE + " " +
      "Übergib base_version aus get_lesson, damit keine neuere Änderung der Lehrkraft überschrieben wird.",
    inputSchema: { type: "object", properties: { lesson_id: ID_ARG, text: { type: "string", maxLength: 30000 }, base_version: { type: "integer", minimum: 0 } }, required: ["lesson_id", "text"], additionalProperties: false } },
  { name: "save_verlaufsplan", title: "Verlaufsplan speichern (Grundschule)", annotations: { ...wr, destructiveHint: true },
    description: "Nur für Sitzungen der Grundschule (statt des Schulportal-Eintrags): ersetzt den Verlaufsplan der Sitzung. Format: " + VERLAUFSPLAN_RULES + " " +
      "Lege das Material vorher an (add_material_pdf, Bildkarten mit add_picture_cards) und nimm seine file_id aus der Antwort oder aus get_lesson. " +
      "Eine Zeile „" + STOP_LINE + "“ setzt nur die Lehrkraft (bis dorthin wurde die Stunde geschafft): Eltern sehen nur das Material bis zum Zwischenstopp – setze selbst keinen. " +
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
  { name: "get_material", title: "Gestaltetes Material lesen", annotations: ro,
    description: "Liefert die HTML-Gestaltung eines Materials, das mit add_material_pdf angelegt wurde (file_id aus get_lesson), damit du es überarbeiten kannst. Lange eingebettete Bilder stehen dort als Platzhalter „data:unterricks-bild,n“.",
    inputSchema: { type: "object", properties: { file_id: { type: "string", pattern: "^[a-f0-9]{16}$" } }, required: ["file_id"], additionalProperties: false } },
  { name: "add_text_material", title: "Textmaterial hinzufügen (Rückfall)", annotations: wr,
    description: "RÜCKFALL – nur verwenden, wenn add_material_pdf nicht funktioniert. Legt ein Unterrichtsmaterial als Text (Markdown: Überschriften, Listen, Tabellen, **fett**) in der Sitzung ab; Unterricks setzt daraus eine einfache PDF (ohne eigene Gestaltung). Schüler:innen laden es als PDF herunter. " +
      "bereich: \"schueler\" (für Schüler:innen sichtbar) oder \"lehrkraft\" (nur für die Lehrkraft, z. B. Erwartungshorizont).",
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
        text: { type: "string", description: "Aufgabenstellung", maxLength: 4000 }, material: { type: "string", description: "optionaler Materialtext", maxLength: 8000 },
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
      materialien: { type: "array", maxItems: 12, description: "Materialien der Vertretung: gestaltet als HTML-Seite (html, Gestaltungsregeln wie bei add_material_pdf – Unterricks druckt sie nach der Bestätigung als PDF; zusammen höchstens 1,5 MB) oder nur als Rückfall in Markdown (markdown)",
        items: { type: "object", properties: { titel: { type: "string" }, bereich: { type: "string", enum: ["schueler", "lehrkraft", "druck"], description: "druck = Liste „Von der Lehrkraft auszudrucken“ (nur mit html)" },
          html: { type: "string", description: "vollständige HTML-Seite mit <style>" }, markdown: { type: "string", description: "Rückfall ohne eigene Gestaltung" },
          anzahl: { type: "integer", minimum: 1, maximum: 500 }, beidseitig: { type: "boolean" }, farbe: { type: "boolean" } }, required: ["titel", "bereich"] } },
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
  parts.push(...(await designedSection(db, l.id, (a) => (a === "student" ? "für Schüler:innen" : a === "teacher" ? "nur Lehrkraft" : "zum Ausdrucken"))));
  const sub = await getSubstitute(db, l.id);
  if (sub) parts.push("", "## Krankheitsvertretung", "Status: " + sub.status + (sub.status === "aktiv" ? " (die ursprüngliche Planung ist archiviert)" : " (Vorschlag liegt der Lehrkraft vor)"));
  if (l.unit_id) parts.push("", "Unterrichtseinheit: " + l.unit_id + " (Details mit get_unit; Planungsgrundlagen mit get_planning_basis)");
  parts.push("", "## Rolle des Planungsassistenten der Plattform (zur Orientierung)", SYSTEM_PROMPT_ROLE);
  return parts.join("\n");
}

/* Abschnitt „Gestaltete Materialien“ von get_lesson (Gymnasium und Grundschule; areaText = Bezeichnung des Bereichs) */
async function designedSection(db, lessonId, areaText) {
  const des = await db.prepare("SELECT id, area, name, status, pages, html_at, pdf_at, render_error FROM files WHERE lesson_id=?1 AND html IS NOT NULL AND area<>'archive' ORDER BY created_at").bind(lessonId).all();
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
  const st = f.status !== "ready" ? (f.render_error ? "Druck fehlgeschlagen: " + f.render_error : "wartet auf den Druck") : f.pages ? f.pages + (f.pages === 1 ? " Seite" : " Seiten") : "fertig";
  const pr = f.area === "student" && f.print_copies != null ? "; auch auf der Druckliste: " + printFileName({ name: f.name, copies: f.print_copies, duplex: f.print_duplex !== 0, color: f.print_color === 1 }) : "";
  return "- file_id " + f.id + ": „" + f.name + "“ (" + (GS_AREA[f.area] || f.area) + "; " + st + pr + ") → " + pdfRef(f.id);
}
async function gsLessonDump(db, l) {
  const ctx = await lessonCtx(db, l);
  const prev = await previousLesson(db, l);
  const [msgs, prevFiles] = await Promise.all([chatMessages(db, l.id, 40),
    prev ? db.prepare(GS_CTX_FILES + " WHERE lesson_id=?1 AND kind='file' AND mime='application/pdf' AND area NOT IN ('archive','presentation') ORDER BY created_at").bind(prev.id).all() : null]);
  const own = ctx.files.filter((f) => f.kind === "file" && f.mime === "application/pdf");
  const before = (prevFiles && prevFiles.results) || [];
  const pm = parentMaterial(l.portal, [...ctx.files, ...before], l.id), name = new Map([...ctx.files, ...before].map((f) => [f.id, f.name]));
  const results = msgs.filter((m) => m.mode === "claude" && m.role === "assistant");
  const parts = [
    "# Sitzung " + l.id + " (Grundschule)", gsLessonContext(ctx, { materialText: true, materialMax: 20000 }),
    "", "## Verlaufsplan (Version " + l.portal_version + (l.portal_source ? ", zuletzt von " + l.portal_source : "") + ")", l.portal || "(noch leer – speichere ihn mit save_verlaufsplan)",
    ...(hasStop(l.portal) ? ["(„" + STOP_LINE + "“ hat die Lehrkraft gesetzt: bis dorthin wurde die Stunde geschafft, alles danach ist noch offen.)"] : []),
    "Eltern sehen nach der Stunde: " + ([...pm.cards, ...pm.files].map((id) => "„" + name.get(id) + "“").join(", ") || "noch kein Material"),
    "", "## Inhalt der Unterrichtsstunde (für die Eltern)", l.parent_summary || "(noch leer – formuliere ihn mit update_lesson und inhalt_eltern)",
    "", "## Hinweis der Lehrkraft für die Eltern (nur lesen)", l.parent_note || "(keiner)",
    "", "## PDF-Dateien des Kurses für Verweise ([[pdf:<file_id>]])", "Diese Sitzung:", ...(own.length ? own.map(gsFileLine) : ["(noch keine)"]),
  ];
  if (prev) parts.push("Vorige Sitzung „" + prev.title + "“" + (prev.lesson_date ? " (" + fmtDay(prev.lesson_date) + ")" : "") + ":", ...(before.length ? before.map(gsFileLine) : ["(keine)"]));
  parts.push(...(await designedSection(db, l.id, (a) => (a === "student" ? "für die Kinder" : a === "teacher" ? "nur Lehrkraft" : "zum Ausdrucken"))));
  if (results.length) parts.push("", "## Gespeicherter Stundenentwurf (save_planning_result)", results[results.length - 1].content.slice(0, 20000));
  if (l.unit_id) parts.push("", "Unterrichtseinheit: " + l.unit_id + " (Details mit get_unit; Planungsgrundlagen mit get_planning_basis)");
  return parts.join("\n");
}

/* Filter der Listen: fach (auch „gs“ = alle Kurse der Grundschule), klasse (Gymnasium), kurs (ein Grundschulkurs) */
function listFilter(a) {
  const where = [], args = [];
  if (a.fach) { args.push(a.fach); where.push("subject=?" + args.length); }
  if (a.klasse) { args.push(a.klasse); where.push("klass=?" + args.length); }
  if (a.kurs) { args.push(a.kurs); where.push("subject='gs' AND klass=?" + args.length); }
  return { where: where.length ? " WHERE " + where.join(" AND ") : "", args };
}
/* get_unit einer Grundschul-Einheit: Kurs im Kopf, ohne Klausur, jede Stunde mit uid und Sitzung (bzw. „[ohne Termin]“) */
function gsUnitText(u) {
  const g = (u.course && u.course.gs) || null, n = u.course && Number.isInteger(u.course.classSize) ? u.course.classSize : null;
  const byRow = new Map(u.lessons.map((l) => [l.row, l]));
  const slots = lessonSlots(u.slots);
  const lines = ["# Unterrichtseinheit " + u.id + " (Grundschule: " + (g ? g.label + " – " + g.gradeText : "Kurs " + u.klass) + (n ? ", " + n + " Kinder" : "") + ", Status: " + u.status + ", Version " + u.version + ")",
    "Titel: " + (u.title || "(offen)"), ...(n ? ["Schülerzahl laut Kurseinstellungen: " + n] : []), ...(g && g.description ? ["Ziel des Kurses: " + g.description] : []),
    paramsText(u.params, { exam: false }), "Verfügbare Sitzungen: " + slots.length, ...slots.map((x, i) => "  " + (i + 1) + ". " + fmtDay(x.date) + (x.time ? " " + x.time : "") + " (" + x.minutes + " min)"),
    "", "## Plan", JSON.stringify(u.plan, null, 1), "", "## Ablauf (Zeilen; uid = Kennung der Stunde)",
    ...u.rows.map((r, i) => { const l = byRow.get(r.uid);
      return (i + 1) + ". [uid " + r.uid + "] " + (r.date ? fmtDay(r.date) + (r.time ? " " + r.time : "") : "[ohne Termin]") + (r.minutes ? " (" + r.minutes + " min)" : "") + ": " + r.stundenfrage +
        (r.schritt != null ? " [Lernschritt " + (r.schritt + 1) + "]" : "") + (l ? " (Sitzung " + l.id + ")" : "") + (r.ablauf.length ? "\n   - " + r.ablauf.join("\n   - ") : ""); }),
    "", "## Sitzungen", ...(u.lessons.length ? u.lessons.map((l) => "- " + l.id + " " + (l.date ? fmtDay(l.date) : "[ohne Termin]") + ": " + l.title) : ["(noch keine)"])];
  return lines.join("\n");
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
      if (l.subject === GS_SUBJECT) return toolText(await gsLessonDump(c.db, l), { lesson_id: l.id, portal_version: l.portal_version, verlaufsplan_version: l.portal_version });
      return toolText(await lessonDump(c.db, l), { lesson_id: l.id, portal_version: l.portal_version });
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
      if (u.subject === GS_SUBJECT) return toolText(gsUnitText(u), { unit_id: u.id, version: u.version });
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
      if ((await getLesson(c.db, a.lesson_id)).subject === GS_SUBJECT) return toolError("In der Grundschule gibt es keine Vertretungsstunde – bei Krankheit verschiebt Unterricks die Stunden; danach überarbeitest du die Einheit.");
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
      if (a.inhalt_eltern !== undefined) b.parentSummary = a.inhalt_eltern;
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
      const gs = (await getLesson(c.db, a.lesson_id)).subject === GS_SUBJECT;
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
    case "save_verlaufsplan": {
      const l = await getLesson(c.db, a.lesson_id);
      if (l.subject !== GS_SUBJECT) return toolError("Nur für Grundschul-Sitzungen – sonst save_schulportal_entry.");
      if (typeof a.text !== "string" || !a.text.trim()) return toolError("Der Verlaufsplan ist leer.");
      // Verweise prüfen (eine Abfrage): PDFs aus Sitzungen dieses Kurses
      const fr = await c.db.prepare("SELECT f.id, f.lesson_id, f.name, f.area, f.kind, f.mime, f.status, f.source, f.cards, f.card_pages, f.card_img_at, f.pdf_at, f.created_at, l.lesson_date " +
        "FROM files f JOIN lessons l ON l.id = f.lesson_id WHERE l.subject='gs' AND l.klass=?1 AND f.kind='file' AND f.mime='application/pdf' AND f.area NOT IN ('archive','presentation') " +
        "ORDER BY (f.lesson_id=?2) DESC, l.lesson_date DESC, f.created_at LIMIT 500").bind(l.klass, l.id).all();
      const files = fr.results || [], known = new Set(files.map((f) => f.id));
      const unknown = planRefs(a.text).all.filter((id) => !known.has(id));
      let p;
      try { p = await savePortal(c.db, l.id, a.text, Number.isInteger(a.base_version) ? a.base_version : null, "claude", c.now); }
      catch (e) {
        if (e instanceof HttpError && e.code === "portal_conflict") return toolError("Der Verlaufsplan wurde inzwischen geändert (aktuelle Version " + e.extra.current.version + "). Bitte get_lesson erneut aufrufen und die Änderungen der Lehrkraft berücksichtigen.");
        throw e;
      }
      const pm = parentMaterial(p.text, files, l.id), byId = new Map(files.map((f) => [f.id, f.name]));
      const parentsSee = [...pm.cards, ...pm.files].map((id) => "„" + byId.get(id) + "“").join(", ") || "noch kein Material";
      const valid = files.slice(0, 20).map((f) => f.id + " („" + f.name + "“)").join(", ");
      return toolText("Verlaufsplan gespeichert (Version " + p.version + ")." +
        (unknown.length ? " Achtung: Diese Verweise gehören zu keiner PDF des Kurses: " + unknown.map(pdfRef).join(", ") + ". Gültige file_id: " + (valid || "(noch keine PDF-Dateien im Kurs)") +
          ". Bitte korrigieren (save_verlaufsplan mit base_version " + p.version + ")." : "") +
        " Eltern sehen nach der Stunde: " + parentsSee + ".", { version: p.version, unknown_refs: unknown });
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
