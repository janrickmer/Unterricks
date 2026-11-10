// shared.js – gemeinsame Logik für Browser und Worker (ES-Modul, keine Abhängigkeiten, keine DOM-Zugriffe).
// Fächer, Klassen, Sitzungscodes, Schulportal-Format (Schulportal Hessen, Artikel 664) und die festen Prompt-Bausteine.

/* ---------- Fächer und Klassen ---------- */
export const SUBJECTS = [
  { id: "powi", name: "Politik und Wirtschaft", short: "PoWi" },
  { id: "evrel", name: "Evangelische Religion", short: "Ev. Religion" },
  { id: "ethik", name: "Ethik", short: "Ethik" },
];
const SUBJECT_IDS = new Set(SUBJECTS.map((s) => s.id));
export const isValidSubject = (id) => typeof id === "string" && SUBJECT_IDS.has(id);
export const subjectName = (id) => (SUBJECTS.find((s) => s.id === id) || {}).name || "";

const LETTERS = ["A", "B", "C", "D", "E", "F"];
export const CLASS_GROUPS = [
  ...[5, 6, 7, 8, 9, 10].map((n) => ({ label: "Jahrgangsstufe " + n, classes: LETTERS.map((l) => n + l) })),
  { label: "Einführungsphase (Jahrgangsstufe 11)", classes: LETTERS.map((l) => "E" + l) },
  { label: "Qualifikationsphase (Jahrgangsstufen 12 und 13)", classes: ["Q1", "Q2", "Q3", "Q4"] },
];
export const ALL_CLASSES = CLASS_GROUPS.flatMap((g) => g.classes);
const CLASS_SET = new Set(ALL_CLASSES);
export const isValidClass = (k) => typeof k === "string" && CLASS_SET.has(k);

/* Jahrgangsstufe zu einer Klasse – für die KI und die Prompts */
export function gradeInfo(k) {
  if (!isValidClass(k)) return { stufe: null, text: "" };
  const m = /^(\d+)[A-F]$/.exec(k);
  if (m) return { stufe: Number(m[1]), text: "Jahrgangsstufe " + m[1] + " (Sekundarstufe I)" };
  if (k[0] === "E") return { stufe: 11, text: "Einführungsphase der gymnasialen Oberstufe (Jahrgangsstufe 11)" };
  const q = Number(k[1]);
  const jg = q <= 2 ? 12 : 13, hj = q % 2 === 1 ? 1 : 2;
  return { stufe: jg, text: "Qualifikationsphase " + k + " der gymnasialen Oberstufe (Jahrgangsstufe " + jg + ", " + hj + ". Halbjahr)" };
}
export const classLabel = (k) => (isValidClass(k) ? "Klasse/Kurs " + k + " – " + gradeInfo(k).text : "");

/* ---------- Sitzungscodes (wie bei Feibeitsblatt: 6 Zeichen ohne I, L, O, 0, 1; Anzeige ABC-123) ---------- */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const normalizeCode = (s) => String(s == null ? "" : s).toUpperCase().replace(/[^A-Z0-9]/g, "");
export const isValidCode = (c) => typeof c === "string" && /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(c) && /[A-Z]/.test(c) && /[0-9]/.test(c);
export const formatCode = (c) => (c && c.length === 6 ? c.slice(0, 3) + "-" + c.slice(3) : String(c || ""));

/* ---------- Schulportal Hessen: Formatierung (support.schulportal.hessen.de, Artikel 664) ----------
 * **fett**  __unterstrichen__  ~~kursiv~~  --durchgestrichen--  `Quellcode`  Zeilen mit "- " = Aufzählung
 * ^1 / ^(123) hochgestellt, _1 / _(123) tiefgestellt, https://… wird anklickbar.
 * ACHTUNG: ~~…~~ ist im Schulportal KURSIV (nicht durchgestrichen wie in Markdown). */
export const PORTAL_RULES = [
  "**Text** = fett",
  "~~Text~~ = kursiv (nicht durchgestrichen!)",
  "__Text__ = unterstrichen",
  "--Text-- = durchgestrichen",
  "`Text` = Quellcode",
  "Zeilen, die mit \"- \" beginnen = Aufzählung",
  "Links mit https:// werden automatisch anklickbar",
];

/* Struktur nach dem Beispiel der Lehrkraft (verbindliche Vorlage) */
export const PORTAL_EXAMPLE = [
  "**1) TOP 10**",
  "",
  "**2) Blitzlicht ohne iPad**",
  "- Einstieg: ~~Wie kann man sich helfen, wenn Demokratiefeinde regieren?~~",
  "",
  "**3) Partnerarbeit**",
  "- Feibeitsblatt ~~Die wehrhafte Demokratie~~ mit dem Code ~~AEH-4VY~~",
  "- Aufgabe 4 besprechen",
  "",
  "**4) Video: Das Bundesverfassungsgericht**",
  "- ~~AB - Das Bundesverfassungsgericht~~",
  "- Video: https://www.youtube.com/watch?v=Fk1u8VKrJGA&feature=youtu.be",
  "",
  "--> Nächste Stunde",
  "",
  "**5) Diskussionsrunde**",
  "- Erst in Partnerarbeit Argumente zur Diskussionsfrage finden: ~~Ist das Bundesverfassungsgericht zu mächtig?~~ und auf der Argumentationswippe festhalten: https://argumentationswippe.de/",
  "- Während der Diskussion muss das weiter gefüllt werden.",
].join("\n");

/* Text aus der KI entschärfen: Zeichenfolgen, die im Schulportal ungewollt formatieren würden, ersetzen.
 * «…» bzw. »…« (Titel, Leitfragen, Codes) wird anschließend zu ~~…~~ (kursiv). */
export function portalSafe(s) {
  return String(s == null ? "" : s)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\*\*/g, "*")
    .replace(/~~/g, "~")
    .replace(/__/g, "_")
    .replace(/--+/g, "–")
    .replace(/`/g, "'")
    .replace(/\s{2,}/g, " ")
    .trim();
}
export function portalItalics(s) {
  // «x» oder »x« → ~~x~~ (Inhalt ohne äußere Leerzeichen)
  return s.replace(/«\s*([^«»]+?)\s*»/g, "~~$1~~").replace(/»\s*([^«»]+?)\s*«/g, "~~$1~~");
}
const portalItem = (s) => portalItalics(portalSafe(s));

/* Strukturierte Planung → fertiger Schulportal-Text.
 * data = { phasen: [{ titel, punkte: [string] }], naechsteStundeAb: Nummer der ersten Phase für die nächste Stunde | null } */
export function renderPortalEntry(data) {
  const phasen = Array.isArray(data && data.phasen) ? data.phasen : [];
  const next = Number(data && data.naechsteStundeAb) || 0;
  const out = [];
  phasen.forEach((p, i) => {
    const n = i + 1;
    if (next > 1 && n === next) out.push("--> Nächste Stunde", "");
    const titel = portalItem(p && p.titel) || "Phase " + n;
    out.push("**" + n + ") " + titel + "**");
    const punkte = Array.isArray(p && p.punkte) ? p.punkte : [];
    for (const pt of punkte) { const t = portalItem(pt); if (t) out.push("- " + t); }
    out.push("");
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/* JSON-Antwort der KI für den Schulportal-Eintrag prüfen (wirft Error mit deutscher Meldung) */
export function validatePortalData(obj) {
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.phasen) || !obj.phasen.length)
    throw new Error("Die KI hat keinen verwertbaren Stundenverlauf geliefert. Bitte noch einmal versuchen.");
  const phasen = obj.phasen.slice(0, 20).map((p) => ({
    titel: String((p && (p.titel || p.title)) || "").slice(0, 200),
    punkte: (Array.isArray(p && (p.punkte || p.items)) ? (p.punkte || p.items) : []).slice(0, 20).map((x) => String(typeof x === "string" ? x : (x && x.text) || "").slice(0, 600)),
  }));
  const next = Number(obj.naechsteStundeAb);
  return { phasen, naechsteStundeAb: Number.isInteger(next) && next > 1 && next <= phasen.length ? next : null };
}

/* Schulportal-Markup für die Vorschau zerlegen: Zeilen → {type: "li"|"p"|"blank", runs: [{text, b, i, u, s, code, sup, sub, href}]} */
export function parsePortalMarkup(text) {
  const lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
  return lines.map((line) => {
    if (!line.trim()) return { type: "blank", runs: [] };
    const li = /^- /.test(line);
    return { type: li ? "li" : "p", runs: parseRuns(li ? line.slice(2) : line) };
  });
}
const MARKS = [["**", "b"], ["__", "u"], ["~~", "i"], ["--", "s"]];
function parseRuns(s) {
  const runs = [], st = { b: false, u: false, i: false, s: false };
  let buf = "";
  const flush = (extra) => { if (buf) runs.push({ text: buf, ...st, ...(extra || {}) }); buf = ""; };
  for (let k = 0; k < s.length;) {
    const url = /^https?:\/\/[^\s<>"]+/.exec(s.slice(k));
    if (url) { flush(); runs.push({ text: url[0], ...st, href: url[0] }); k += url[0].length; continue; }
    if (s[k] === "`") {
      const end = s.indexOf("`", k + 1);
      if (end > k) { flush(); runs.push({ text: s.slice(k + 1, end), ...st, code: true }); k = end + 1; continue; }
    }
    if ((s[k] === "^" || s[k] === "_") && s[k + 1] !== "_") {
      const kind = s[k] === "^" ? "sup" : "sub";
      const paren = /^\(([^)]*)\)/.exec(s.slice(k + 1)), word = /^([^\s()]+) /.exec(s.slice(k + 1));
      if (paren) { flush(); runs.push({ text: paren[1], ...st, [kind]: true }); k += 1 + paren[0].length; continue; }
      if (word && k > 0 && s[k - 1] !== " ") { flush(); runs.push({ text: word[1], ...st, [kind]: true }); k += 1 + word[1].length; continue; }
    }
    let hit = null;
    for (const [m, key] of MARKS) {
      if (s.startsWith(m, k)) {
        // öffnen nur, wenn die Marke in derselben Zeile wieder geschlossen wird ("--> Nächste Stunde" bleibt Text)
        if (st[key] || s.indexOf(m, k + m.length) > k + m.length) { hit = [m, key]; break; }
      }
    }
    if (hit) { flush(); st[hit[1]] = !st[hit[1]]; k += hit[0].length; continue; }
    buf += s[k]; k++;
  }
  flush();
  return runs;
}

/* ---------- Feste Rolle des Chatbots (Vorgabe der Lehrkraft, wörtlich) ---------- */
export const SYSTEM_PROMPT_ROLE = "Du bist ein leistungsfähiger didaktischer Assistent, der eine Lehrkraft bei der Planung und Vorbereitung von Unterricht unterstützt. Du berücksichtigst das ausgewählte Unterrichtsfach sowie den jeweiligen Jahrgang und entwickelst fachlich fundierte, didaktisch sinnvolle und abwechslungsreiche Unterrichtskonzepte.\n\n" +
  "Zu Beginn der Planung fragst du die Lehrkraft, wie viele Minuten die Unterrichtssitzung dauert und ob bestimmte Ideen, Themen, Materialien oder didaktische Wünsche berücksichtigt werden sollen.\n\n" +
  "Anschließend begleitest du die Lehrkraft dialogisch durch den Planungsprozess. Du entwickelst konkrete Unterrichtsideen, schlägst passende Methoden und Sozialformen vor und hilfst bei der Erstellung geeigneter Unterrichtsmaterialien.";

/* Erste Nachricht jeder neuen Sitzung (ohne KI-Aufruf, damit die Planung immer mit diesen Fragen beginnt) */
export function greetingText(ctx) {
  const dauer = ctx && ctx.durationMin ? "Eingetragen sind " + ctx.durationMin + " Minuten – stimmt das? " : "Wie viele Minuten dauert die Unterrichtssitzung? ";
  return "Hallo! Ich unterstütze Sie bei der Planung dieser Sitzung (" + subjectName(ctx && ctx.subject) + ", " + ((ctx && ctx.klass) || "") + ").\n\n" +
    "1. " + dauer + "\n2. Sollen bestimmte Ideen, Themen, Materialien oder didaktische Wünsche berücksichtigt werden?";
}

export const FEIBEITSBLATT_INFO = "Feibeitsblatt ist das digitale Arbeitsblatt-Werkzeug der Lehrkraft: Die Lehrkraft legt Aufgaben (Aufgabenstellung, optional Material) " +
  "und je Aufgabe einen „Auftrag an die KI“ an (worauf die KI beim Feedback achten soll, z. B. erwartete Inhalte und Kriterien). Die Schüler:innen öffnen das Blatt mit einem Code, " +
  "schreiben ihre Antworten (Textfeld oder Tabelle), können einmal freiwillig KI-Feedback zu ihren Antworten erhalten, überarbeiten und geben verschlüsselt ab; " +
  "die Lehrkraft sieht alle Abgaben. Ein Feibeitsblatt ersetzt ein klassisches Arbeitsblatt, besonders bei Schreib-, Analyse- und Urteilsaufgaben.";

const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + " […gekürzt]" : s; };
const areaLabel = (a) => (a === "student" ? "für Schüler:innen" : a === "teacher" ? "nur Lehrkraft" : a === "presentation" ? "Präsentation" : a);

/* Kontextblock zur aktuellen Sitzung (für Chatbot, Schulportal-Prompt und Claude-Prompts)
 * ctx = { subject, klass, lesson: {title, topic, durationMin, date, ideas}, materials: [{name, area, kind, text?}], portal, sheets: [{title, code}], drafts } */
export function lessonContext(ctx, opt = {}) {
  const L = ctx.lesson || {};
  const lines = [
    "Unterrichtsfach: " + subjectName(ctx.subject),
    "Klasse/Kurs: " + ctx.klass + " – " + gradeInfo(ctx.klass).text,
    "Unterrichtssitzung: " + (L.title || "(noch ohne Titel)") + (L.date ? " am " + L.date : ""),
    "Thema: " + (L.topic || "(noch nicht festgelegt)"),
    "Dauer: " + (L.durationMin ? L.durationMin + " Minuten" : "(noch nicht angegeben – bitte erfragen)"),
  ];
  if (L.ideas) lines.push("Ideen und Wünsche der Lehrkraft (Notizfeld):\n" + clip(L.ideas, opt.ideasMax || 4000));
  const mats = (ctx.materials || []).filter((m) => m.area !== "presentation");
  if (mats.length) {
    lines.push("Vorhandene Materialien:");
    for (const m of mats) {
      lines.push("- " + m.name + " (" + areaLabel(m.area) + (m.kind === "text" ? ", Text" : "") + ")");
      if (opt.materialText && m.kind === "text" && m.text) lines.push("  Inhalt:\n" + clip(m.text, opt.materialMax || 3000).replace(/^/gm, "  "));
    }
  }
  const pres = (ctx.materials || []).find((m) => m.area === "presentation");
  if (pres) lines.push("Präsentation hochgeladen: " + pres.name + (pres.pages ? " (" + pres.pages + " Folien)" : ""));
  if ((ctx.sheets || []).length) {
    lines.push("Feibeitsblätter dieser Sitzung:");
    for (const s of ctx.sheets) lines.push("- „" + s.title + "“ mit dem Code " + formatCode(s.code));
  }
  if (opt.portal !== false && ctx.portal) lines.push("Aktueller Schulportal-Eintrag (Stundenverlauf):\n" + clip(ctx.portal, 6000));
  return lines.join("\n");
}

/* System-Prompt des Chatbots: feste Rolle + Werkzeug-Hinweise + Sitzungskontext */
export function planningSystemPrompt(ctx) {
  return SYSTEM_PROMPT_ROLE + "\n\n" +
    "Weitere feste Hinweise:\n" +
    "- Antworte auf Deutsch, siezend, klar gegliedert (Markdown erlaubt: Überschriften, Listen, Tabellen, **fett**).\n" +
    "- Plane mit Minutenangaben je Phase, die zusammen die Dauer der Sitzung ergeben, und nenne Methode und Sozialform.\n" +
    "- Formuliere Materialien (Arbeitsaufträge, Texte, Tafelbilder) vollständig aus, wenn die Lehrkraft das möchte, damit sie direkt übernommen werden können.\n" +
    "- Schlage bewusst auch vor, statt eines klassischen Arbeitsblatts ein Feibeitsblatt zu erstellen, wenn es didaktisch passt. " + FEIBEITSBLATT_INFO + " " +
    "Stimmt die Lehrkraft zu, entwirf die Aufgaben samt „Auftrag an die KI“; die Lehrkraft kann daraus in der Plattform mit „Feibeitsblatt-Entwurf aus dem Chat“ einen Entwurf erzeugen, prüfen und anlegen.\n" +
    "- Erfinde keine Quellen, Links oder Videos; kennzeichne Vorschläge, die die Lehrkraft prüfen sollte.\n\n" +
    "Aktuelle Unterrichtssitzung (automatisch übermittelt):\n" + lessonContext(ctx, { materialText: true, materialMax: 1500 });
}

/* Prompt für den Schulportal-Eintrag (die KI liefert JSON, die Plattform setzt das Format) */
export function portalMessages(ctx, chatText) {
  const system = "Du erstellst aus einer Unterrichtsplanung den Eintrag für das Schulportal Hessen („Mein Unterricht“). " +
    "Antworte ausschließlich mit einem JSON-Objekt der Form {\"phasen\": [{\"titel\": \"…\", \"punkte\": [\"…\"]}], \"naechsteStundeAb\": null}. " +
    "Regeln: Jede Phase ist ein Unterrichtsschritt in der geplanten Reihenfolge; „titel“ ist kurz und nennt Methode/Sozialform oder Inhalt " +
    "(z. B. „Blitzlicht ohne iPad“, „Partnerarbeit“, „Video: Das Bundesverfassungsgericht“). „punkte“ sind knappe Stichpunkte (0–4) mit dem, was passiert. " +
    "Setze Titel von Materialien und Arbeitsblättern, Leitfragen/Diskussionsfragen und Codes in «» (sie werden kursiv), z. B. „Einstieg: «Wie kann man sich helfen, wenn Demokratiefeinde regieren?»“ " +
    "oder „Feibeitsblatt «Die wehrhafte Demokratie» mit dem Code «AEH-4VY»“. Links nur, wenn sie in der Planung wörtlich stehen, als vollständige https://-Adresse. " +
    "Keine Minutenangaben, keine Markdown-Zeichen (*, _, ~, #), keine Nummerierung im Titel. " +
    "„naechsteStundeAb“: Nummer der ersten Phase, die laut Planung erst in der nächsten Stunde drankommt, sonst null.";
  const user = "Formatvorlage der Lehrkraft (so sieht der fertige Eintrag aus):\n<<<\n" + PORTAL_EXAMPLE + "\n>>>\n\n" +
    "Sitzung:\n" + lessonContext(ctx, { portal: false, materialText: false }) + "\n\n" +
    "Bisherige Planung (Chatverlauf, neueste Fassung zählt):\n<<<\n" + clip(chatText, 30000) + "\n>>>\n\nGib jetzt nur das JSON-Objekt aus.";
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/* Prompt für einen Feibeitsblatt-Entwurf aus dem Chat */
export function feibeitsblattMessages(ctx, chatText, wish) {
  const system = "Du entwirfst ein Feibeitsblatt für den Unterricht. " + FEIBEITSBLATT_INFO + " " +
    "Antworte ausschließlich mit einem JSON-Objekt der Form {\"title\": \"…\", \"tasks\": [{\"text\": \"Aufgabenstellung\", \"material\": \"optionaler Materialtext oder leer\", " +
    "\"ki_auftrag\": \"Auftrag an die KI für das Feedback\", \"antwort\": \"text\" oder {\"tabelle\": [\"Spalte 1\", \"Spalte 2\"], \"zeilen\": 3}}]}. " +
    "Regeln: 1–6 Aufgaben mit Operatoren passend zur Jahrgangsstufe; der „ki_auftrag“ beschreibt konkret, welche Inhalte, Kriterien und Fehler die KI beim Feedback beachten soll, " +
    "ohne den Schüler:innen die Lösung vorzusagen; Material nur als Text (keine Bilder, keine erfundenen Quellen). Antwortart „text“ ist der Normalfall; eine Tabelle nur, wenn sie didaktisch sinnvoll ist (höchstens 8 Spalten, 30 Zeilen).";
  const user = "Sitzung:\n" + lessonContext(ctx, { materialText: true, materialMax: 2000 }) + "\n\n" +
    (wish ? "Wunsch der Lehrkraft zum Feibeitsblatt: " + clip(wish, 2000) + "\n\n" : "") +
    "Bisherige Planung (Chatverlauf):\n<<<\n" + clip(chatText, 30000) + "\n>>>\n\nGib jetzt nur das JSON-Objekt aus.";
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

/* Prompt für Material aus einer Chat-Nachricht ist nicht nötig: Material wird direkt aus der Antwort übernommen. */

/* Chatverlauf als Text */
export function chatTranscript(messages, max = 40000) {
  const parts = [];
  for (const m of messages || []) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    parts.push((m.role === "user" ? "Lehrkraft: " : "Assistent: ") + String(m.content || "").trim());
  }
  let t = parts.join("\n\n");
  if (t.length > max) t = "[…ältere Nachrichten gekürzt…]\n\n" + t.slice(t.length - max);
  return t;
}
export function teacherWishes(messages, max = 8000) {
  const t = (messages || []).filter((m) => m.role === "user").map((m) => "- " + String(m.content || "").trim().replace(/\n+/g, " ")).join("\n");
  return t.length > max ? t.slice(0, max) + " […gekürzt]" : t;
}

/* ---------- Prompts für Claude (claude.ai, Pro-Abo – Kopieren & Einfügen) ---------- */
const connectorHint = (ctx) => ctx.lessonId
  ? "\n\nFalls in diesem Chat der Connector „Unterricks“ verfügbar ist: Rufe zuerst `get_lesson` mit der Sitzungs-ID " + ctx.lessonId +
    " auf (dort stehen alle aktuellen Daten), und speichere deine Ergebnisse auf Wunsch der Lehrkraft direkt mit `save_schulportal_entry`, `add_text_material` bzw. `propose_feibeitsblatt` in der Plattform."
  : "";

export function claudeIdeaPrompt(ctx, messages) {
  const L = ctx.lesson || {};
  const developed = (messages || []).filter((m) => m.role === "assistant").slice(-4).map((m) => String(m.content || "").trim()).join("\n\n---\n\n");
  return [
    "Du bist eine erfahrene Fachdidaktikerin bzw. ein erfahrener Fachdidaktiker und Unterrichtsplaner für das Fach " + subjectName(ctx.subject) +
      " an einer Schule in Hessen. Entwickle auf Grundlage der folgenden Informationen die bestmögliche, fachlich fundierte und didaktisch durchdachte Unterrichtsidee für diese konkrete Stunde. " +
      "Nutze dafür deine volle Leistungsfähigkeit: Denke gründlich nach, prüfe Alternativen und begründe deine Entscheidungen.",
    "",
    "## Rahmendaten",
    "- Fach: " + subjectName(ctx.subject),
    "- Klasse/Kurs: " + ctx.klass + " – " + gradeInfo(ctx.klass).text,
    "- Thema: " + (L.topic || L.title || "(bitte aus den Ideen ableiten)"),
    "- Dauer der Unterrichtssitzung: " + (L.durationMin ? L.durationMin + " Minuten" : "(nicht angegeben – bitte nachfragen oder 45 Minuten annehmen und das kennzeichnen)"),
    L.date ? "- Datum: " + L.date : "",
    "",
    "## Bisherige Ideen und Wünsche der Lehrkraft",
    (L.ideas ? L.ideas.trim() + "\n" : "") + (teacherWishes(messages) || "(keine weiteren Angaben)"),
    "",
    "## Bereits entwickelte Unterrichtsinhalte",
    developed ? clip(developed, 24000) : "(noch keine)",
    ctx.portal ? "\nAktueller Stundenverlauf (Schulportal-Eintrag):\n" + ctx.portal : "",
    "",
    "## Vorhandene Materialien",
    lessonContext({ ...ctx, sheets: ctx.sheets }, { portal: false, materialText: true, materialMax: 4000 }).split("\n").filter((l) => /^(- |  |Vorhandene|Feibeitsbl|Präsentation)/.test(l)).join("\n") || "(keine)",
    "",
    "## Deine Aufgabe",
    "1. Analysiere kurz die Lernvoraussetzungen der Jahrgangsstufe und den fachlichen Kern des Themas (mit Bezug zu den Kompetenzbereichen des hessischen Kerncurriculums bzw. Lehrplans des Fachs).",
    "2. Formuliere 2–4 überprüfbare Lernziele.",
    "3. Entwickle einen Stundenverlauf als Tabelle: Phase | Minuten | Inhalt/Lehrerimpuls | Schüleraktivität | Methode/Sozialform | Material. Die Minuten müssen die Gesamtdauer genau ergeben.",
    "4. Begründe die zentralen didaktischen und methodischen Entscheidungen (Problemorientierung, Aktivierung, Differenzierung, Sicherung).",
    "5. Formuliere alle benötigten Materialien vollständig aus (Arbeitsaufträge mit Operatoren, Texte, Tafelbild/Ergebnissicherung, Erwartungshorizont).",
    "6. Prüfe, ob statt eines klassischen Arbeitsblatts ein Feibeitsblatt sinnvoll ist. " + FEIBEITSBLATT_INFO + " Falls ja: Aufgaben und je Aufgabe den „Auftrag an die KI“ ausformulieren.",
    "7. Schließe mit dem fertigen Eintrag für das Schulportal Hessen in genau diesem Format (Schulportal-Zeichen: " + PORTAL_RULES.join("; ") + "):",
    "",
    PORTAL_EXAMPLE,
    "",
    "Wenn wichtige Informationen fehlen, triff begründete Annahmen und kennzeichne sie, statt die Planung abzubrechen." + connectorHint(ctx),
  ].filter((l) => l !== null && l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
}

export function claudePresentationPrompt(ctx, portalText, messages) {
  const L = ctx.lesson || {};
  const developed = (messages || []).filter((m) => m.role === "assistant").slice(-3).map((m) => String(m.content || "").trim()).join("\n\n---\n\n");
  return [
    "Erstelle eine vollständige PowerPoint-Präsentation (.pptx, 16:9) für die folgende Unterrichtsstunde. Die Präsentation läuft während des Unterrichts am Beamer und führt " +
      "die Lehrkraft und die Schülerinnen und Schüler Schritt für Schritt durch die gesamte Stunde. Exportiere die fertige Präsentation zusätzlich als PDF-Datei " +
      "(eine Seite je Folie, ohne Notizenseiten) – die PDF-Fassung wird in der Unterrichtsplattform live und synchron auf den Geräten der Schüler:innen angezeigt. Stelle mir beide Dateien zum Herunterladen bereit.",
    "",
    "## Rahmendaten",
    "- Fach: " + subjectName(ctx.subject),
    "- Klasse/Kurs: " + ctx.klass + " – " + gradeInfo(ctx.klass).text,
    "- Thema: " + (L.topic || L.title || "(siehe Stundenverlauf)"),
    "- Dauer: " + (L.durationMin ? L.durationMin + " Minuten" : "(nicht angegeben)"),
    L.date ? "- Datum: " + L.date : "",
    "",
    "## Verbindlicher Stundenverlauf (aktueller Schulportal-Eintrag der Lehrkraft – genau diese Fassung gilt, auch wenn ältere Planungen abweichen)",
    "Formatierung im Text: **…** = fett, ~~…~~ = kursiv (Titel, Leitfragen, Codes), Zeilen mit „- “ = Stichpunkte, „--> Nächste Stunde“ = ab hier folgt der Teil für die nächste Stunde.",
    "<<<",
    String(portalText || "").trim(),
    ">>>",
    "",
    "## Materialien und weitere Informationen",
    lessonContext(ctx, { portal: false, materialText: true, materialMax: 5000 }).split("\n").filter((l) => /^(- |  |Vorhandene|Feibeitsbl|Ideen|Präsentation)/.test(l)).join("\n") || "(keine)",
    "",
    "## Didaktische und methodische Überlegungen aus der Planung",
    developed ? clip(developed, 20000) : "(keine weiteren)",
    "",
    "## Anforderungen an die Präsentation",
    "- Aufbau genau entlang des verbindlichen Stundenverlaufs: Titelfolie, kurze Stundenübersicht (Agenda), dann für jede Phase mindestens eine Folie in derselben Reihenfolge und Nummerierung; Phasen nach „--> Nächste Stunde“ als eigener, klar markierter Abschnitt am Ende.",
    "- Jede Arbeitsphase bekommt eine Auftragsfolie: Arbeitsauftrag mit Operatoren, Sozialform (Einzel-, Partner-, Gruppenarbeit, Plenum) als Symbol und Wort, Zeitvorgabe in Minuten, benötigtes Material, erwartetes Ergebnis.",
    "- Leitfragen, Diskussionsfragen und Impulse groß und gut lesbar; Feibeitsblätter mit Titel und Code (groß, gut abschreibbar); Links als kurze Adresse und QR-Code.",
    "- Sicherungsfolien (Tafelbild/Ergebnis), die zunächst leer bzw. mit Platzhaltern beginnen und auf einer Folgefolie die Musterlösung zeigen – keine Lösungen vor den Arbeitsphasen.",
    "- Gestaltung für den Beamer: hoher Kontrast, Schrift mindestens 24 pt (Fließtext) bzw. 36 pt (Überschriften), höchstens 6 Zeilen pro Folie, ruhiges einheitliches Layout, keine Animationen, die für den Inhalt nötig sind (die PDF-Fassung zeigt keine Animationen).",
    "- Altersgerechte Sprache für " + gradeInfo(ctx.klass).text + "; fachlich korrekt; keine erfundenen Quellen, Zitate oder Statistiken (wo nötig: Platzhalter mit Hinweis für die Lehrkraft).",
    "- Sprechernotizen in jeder Folie mit Hinweisen für die Lehrkraft (Impulse, Zeit, Erwartungen).",
    "- Benenne die Dateien sinnvoll, z. B. „" + (ctx.klass || "Klasse") + "_" + subjectName(ctx.subject).replace(/\s+/g, "-") + "_" + (L.topic || L.title || "Stunde").replace(/[^\wÄÖÜäöüß-]+/g, "-").slice(0, 40) + ".pptx“ und dieselbe Bezeichnung als .pdf." +
      connectorHint(ctx).replace("speichere deine Ergebnisse auf Wunsch der Lehrkraft direkt mit `save_schulportal_entry`, `add_text_material` bzw. `propose_feibeitsblatt` in der Plattform", "verändere den Schulportal-Eintrag dabei nicht"),
  ].filter((l) => l !== null && l !== undefined).join("\n").replace(/\n{3,}/g, "\n\n");
}

/* ---------- JSON aus KI-Antworten herauslösen ---------- */
export function extractJsonObject(text) {
  const s = String(text == null ? "" : text);
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  const cand = fence ? fence[1] : s;
  const start = cand.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < cand.length; i++) {
    const ch = cand[i];
    if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === "\"") inStr = false; continue; }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { try { return JSON.parse(cand.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

/* Feibeitsblatt-Entwurf (aus KI oder Connector) in eine einheitliche Form bringen */
export function normalizeFbDraft(obj) {
  if (!obj || typeof obj !== "object") throw new Error("Der Entwurf ist leer.");
  const tasks = (Array.isArray(obj.tasks) ? obj.tasks : Array.isArray(obj.aufgaben) ? obj.aufgaben : []).slice(0, 20).map((t) => {
    const ans = t && (t.antwort || t.answer);
    let answer = { type: "text" };
    if (ans && typeof ans === "object") {
      const cols = (ans.tabelle || ans.columns || []).map((c) => String(c || "").slice(0, 60)).filter(Boolean).slice(0, 8);
      const rows = Math.min(30, Math.max(1, Number(ans.zeilen || ans.rows) || 3));
      if (cols.length) answer = { type: "table", columns: cols, rows };
    }
    return {
      text: String((t && (t.text || t.aufgabe)) || "").slice(0, 4000),
      material: String((t && t.material) || "").slice(0, 20000),
      solution: String((t && (t.ki_auftrag || t.solution || t.auftrag)) || "").slice(0, 4000),
      answer,
    };
  }).filter((t) => t.text.trim());
  if (!tasks.length) throw new Error("Der Entwurf enthält keine Aufgabe.");
  return { title: String(obj.title || obj.titel || "Feibeitsblatt").slice(0, 120), tasks };
}
