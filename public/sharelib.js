// sharelib.js – „Unterrichtseinheit mit KollegInnen teilen“ (Nachtrag 39 der Lehrkraft vom 18.11.2026): reine Funktionen ohne Netz und DOM.
// Absatz je Sitzung für das Leupold-Schema (schreibt Claude über den Connector, die Lehrkraft kann ihn ändern), welche Sitzungen schon geplant sind,
// welche Codefolien in der geteilten Präsentation wegfallen, Datei- und Ordnernamen, die Texte der Begleitdokumente und der Prompt für Claude.
// Den ZIP-Ordner baut der Browser (share.js); der Server prüft die Absätze mit denselben Regeln (lessons.js, mcp.js).
import { STOP_LINE, isStopLine, subjectName, gradeInfo, classShort, isGsCourseId, GS_SUBJECT, codeMarkLine, parsePortalMarkup, parsePlanMarkup } from "./shared.js";

export const SHARE_AUTHOR = "Jan-Rickmer Feindt";
export const SHARE_COPYRIGHT = "Copyright " + SHARE_AUTHOR;   // Fußzeile jeder Folie der geteilten Präsentation (Wortlaut der Lehrkraft)
export const SHARE_BUTTON = "Unterrichtseinheit mit KollegInnen teilen";   // Beschriftung wie gewünscht (Tippfehler „Untereichtseinheit“ berichtigt)
export const SHARE_TEXT_TITLE = "Absatz für die Weitergabe";
// Teile eines Absatzes: was in der Sitzung passiert, die zentrale Kompetenz (KCGO bzw. hinterlegte Planungsgrundlage) und das Ziel der Sitzung
export const SHARE_LIMITS = { passiert: 900, kompetenz: 500, ziel: 400 };
export const SHARE_PARTS = [["passiert", "Was passiert"], ["kompetenz", "Zentrale Kompetenz"], ["ziel", "Ziel der Sitzung"]];

const str = (v) => (typeof v === "string" ? v : v == null ? "" : String(v));
// ein Absatz: Steuerzeichen weg, Leerraum (auch Zeilenwechsel) zu einem Leerzeichen
const oneLine = (v) => str(v).normalize("NFC").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/g, " ").trim();

/* Absatz prüfen: {passiert, kompetenz, ziel} (Strings) → bereinigt; alle drei leer → null (= löschen). strict (Server, Connector): Fehler mit Meldung
   (zu lang, kein Objekt) statt still zu kürzen; sonst gekürzt. */
export function cleanShareText(raw, strict = false) {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { if (strict) throw new Error("Der Absatz für die Weitergabe ist ein Objekt {passiert, kompetenz, ziel}."); return null; }
  const out = {};
  for (const [k, label] of SHARE_PARTS) {
    if (raw[k] !== undefined && raw[k] !== null && typeof raw[k] !== "string") { if (strict) throw new Error(label + " ist ein Text."); }
    const t = oneLine(raw[k]);
    if (t.length > SHARE_LIMITS[k]) { if (strict) throw new Error(label + " ist zu lang (" + t.length + " Zeichen, höchstens " + SHARE_LIMITS[k] + ") – bitte kürzen."); out[k] = t.slice(0, SHARE_LIMITS[k]).trim(); }
    else out[k] = t;
  }
  return out.passiert || out.kompetenz || out.ziel ? out : null;
}
/* gespeichert (lessons.share_text, JSON {v:1, passiert, kompetenz, ziel, at}) tolerant gelesen → {passiert, kompetenz, ziel, at} | null */
export function shareTextOf(raw) {
  let o = null;
  try { o = typeof raw === "string" ? JSON.parse(raw) : raw; } catch {}
  const t = o && typeof o === "object" ? cleanShareText(o) : null;
  return t ? { ...t, at: Number.isFinite(o.at) ? o.at : null } : null;
}
export const shareTextStore = (t, at) => (t ? JSON.stringify({ v: 1, passiert: t.passiert, kompetenz: t.kompetenz, ziel: t.ziel, at }) : null);
// vollständig = alle drei Teile da (sonst zeigt die Karte „unvollständig“)
export const shareTextComplete = (t) => !!(t && t.passiert && t.kompetenz && t.ziel);

/* Geplant ist eine Sitzung, sobald ihr Verlaufsplan (Gymnasium: Schulportal-Eintrag) Inhalt hat – die interne Zeile „⏸ Zwischenstopp“ zählt nicht */
export const isPlannedText = (portal) => str(portal).split("\n").some((l) => l.trim() && !isStopLine(l));

/* Stunden der Einheit in der Reihenfolge der Tabelle (n = Nummer der Stunde wie in „Ablauf der Unterrichtseinheit“): rows = unit.rows, lessons =
   [{id, row, planned, cancelled?, …}] → [{n, row, lesson|null, planned}]. Ausfall-Einträge der Grundschule zählen nicht; Sitzungen ohne Zeile
   (sollte es nicht geben) kommen hinten dazu. */
export function shareSessions(rows, lessons) {
  const live = (lessons || []).filter((l) => l && !l.cancelled), used = new Set(), out = [];
  (rows || []).forEach((r, i) => {
    const l = live.find((x) => x.row && x.row === r.uid && !used.has(x.id)) || null;
    if (l) used.add(l.id);
    out.push({ n: i + 1, row: r, lesson: l, planned: !!(l && l.planned) });
  });
  for (const l of live) if (!used.has(l.id)) out.push({ n: out.length + 1, row: null, lesson: l, planned: !!l.planned });
  return out;
}

/* ---------- Präsentation: welche Codefolien wegfallen ----------
   Jede Materialfolie ist technisch eine Unterricks-Codefolie (Aufforderung + Titel des Materials; Unterricks zeigt dort live den Sitzungscode). Sie bleibt
   in der geteilten Präsentation – die kleine Zeile „Unterricks-Codefolie: …“ wird überdeckt (Entscheidung der Lehrkraft vom 18.11.2026). Es fallen nur reine
   Codefolien weg: ohne Überschrift (Unterricks zeigt dort den Titel der Sitzung) oder mit einem Hinweis auf Unterricks bzw. den Code und ohne Material,
   z. B. „Die Hausaufgabe und das Material findest du in Unterricks.“ */
export const normWords = (t) => " " + str(t).toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, " ").trim() + " ";
const UNTERRICKS_WORDS = /unterricks|sitzungscode|\bcode\b|qr/i;
/* lines = Überschrift der Codefolie (wie gespeichert), titles = Namen der Materialien und Feibeitsblätter der Sitzung → true = Materialfolie (bleibt) */
// allgemeine Wörter, die als Titel eines Materials allein nichts beweisen („Die Hausaufgabe und das Material findest du in Unterricks.“) – auch für „Material
// erscheint mit seiner Materialfolie“ (Nachtrag 44, public/reveal.js): Material mit einem solchen Titel wartet nie auf eine Folie
export const GENERIC_TITLES = new Set(["material", "materialien", "hausaufgabe", "hausaufgaben", "aufgabe", "aufgaben", "arbeitsauftrag", "text", "texte", "video", "link", "links", "unterricks", "code", "quellen", "tafelbild"]);
export function isMaterialSlide(lines, titles = []) {
  const head = (lines || []).map(str).join(" ").trim();
  if (!head) return false;
  const h = normWords(head);
  const words = new Set(h.trim().split(" "));
  // ein Feibeitsblatt bzw. Arbeitsblatt in der Überschrift: Aufforderung, damit zu arbeiten (bleibt, auch wenn der Titel nicht genau passt)
  if (/ (feibeitsblatt|feibeitsblätter|arbeitsblatt|arbeitsblätter) /.test(h)) return true;
  for (const t of titles || []) {
    const n = normWords(str(t).replace(/\.(pdf|docx?|pptx?|odt|png|jpe?g|txt|html?)$/i, "")).trim();
    if (GENERIC_TITLES.has(n)) continue;
    if (n.replace(/\s/g, "").length >= 4 && h.includes(" " + n + " ")) return true;   // Titel wörtlich
    const tok = n.split(" ").filter((w) => w.length >= 2);
    if (tok.length >= 2 && tok.every((w) => words.has(w))) return true;   // alle Wörter des Titels, in anderer Reihenfolge („Arbeitsblatt M1“)
  }
  // ohne erkennbares Material: mit Hinweis auf Unterricks bzw. den Code eine reine Codefolie, sonst lieber behalten (eine Aufforderung)
  return !UNTERRICKS_WORDS.test(head);
}
/* codeSlides = [{n, lines}] der Präsentation, pages = Zahl der Folien → {drop: [n], cover: [n]} (Folien, die wegfallen bzw. deren Unterricks-Zeile
   überdeckt wird), keep = übrige Nummern in Reihenfolge */
export function shareSlidePlan(codeSlides, pages, titles = []) {
  const drop = [], cover = [];
  for (const c of codeSlides || []) {
    if (!c || !Number.isInteger(c.n) || c.n < 1 || c.n > pages) continue;
    (isMaterialSlide(c.lines, titles) ? cover : drop).push(c.n);
  }
  const gone = new Set(drop);
  const keep = Array.from({ length: Math.max(0, pages | 0) }, (_, i) => i + 1).filter((n) => !gone.has(n));
  // nie eine leere Präsentation (nur Codefolien): dann bleibt alles, nur überdeckt
  if (!keep.length) return { drop: [], cover: [...cover, ...drop].sort((a, b) => a - b), keep: Array.from({ length: pages }, (_, i) => i + 1) };
  return { drop: drop.sort((a, b) => a - b), cover: cover.sort((a, b) => a - b), keep };
}
/* Zeilen einer Seite (slideTextLines, mit map je Zeichen) → Kästen der Unterricks-Zeile: die Marke selbst und umbrochene Stücke ihres Erklärsatzes
   direkt darunter bzw. darüber (ähnliche Schriftgröße) → [{x0, x1, top, bottom}] in denselben Koordinaten (y nach unten) */
export function markBoxes(lines) {
  const L = (lines || []).filter((l) => l && typeof l.text === "string" && Array.isArray(l.map));
  // eine Zeile in Abschnitte zerlegen, wo zwischen zwei Zeichen eine große Lücke ist (anderer Text auf derselben Grundlinie, z. B. eine Seitenzahl rechts)
  const segments = (l) => {
    const out = [];
    let cur = null, prev = null;
    for (let i = 0; i < l.text.length; i++) {
      const c = l.map[i];
      if (!c) { if (cur) { cur.text += l.text[i]; cur.map.push(null); } continue; }   // Text und Positionen bleiben deckungsgleich
      const hh = c.h || l.h || 0;
      if (!cur || (prev && c.x0 - prev.x1 > 2 * hh)) { cur = { text: "", map: [] }; out.push(cur); }
      cur.text += l.text[i]; cur.map.push(c); prev = c;
    }
    return out.map((sg) => ({ text: sg.text, map: sg.map, base: l.base, h: l.h }));
  };
  const box = (l) => {
    const m = l.map.filter((c, i) => c && /\S/.test(l.text[i] || "x"));   // Leerraum am Rand gehört nicht zum Kasten
    if (!m.length) return null;
    const h = Math.max(...m.map((c) => c.h || 0)) || l.h || 0;
    return { x0: Math.min(...m.map((c) => c.x0)), x1: Math.max(...m.map((c) => c.x1)), top: l.base - h * 1.0, bottom: l.base + h * 0.3, h, base: l.base };
  };
  const parts = L.flatMap(segments);
  const marks = parts.filter((p) => codeMarkLine(p.text) === "mark").map(box).filter(Boolean);
  const out = [...marks];
  for (const p of parts) {
    if (codeMarkLine(p.text) !== "explain") continue;
    const b = box(p);
    if (b && marks.some((m) => Math.abs(m.h - b.h) <= 0.25 * Math.max(m.h, b.h) && Math.abs(m.base - b.base) <= 2.6 * Math.max(m.h, b.h))) out.push(b);
  }
  return out;
}

/* ---------- Namen ---------- */
const clean = (s) => str(s).replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "");
export const namePart = (s, max = 60) => {
  const c = clean(s);
  let t = c.slice(0, max);
  if (c.length > max) { const i = t.lastIndexOf(" "); if (i > max * 0.5) t = t.slice(0, i); }
  return t.replace(/[\s.,;:–-]+$/, "");
};
export const shareFolder = (n) => "Sitzung " + n;
/* Dateiname im Ordner einer Sitzung (immer .pdf), eindeutig (used = Set der schon vergebenen Namen, ohne Groß-/Kleinschreibung) */
export function uniquePdfName(name, used) {
  const base = namePart(str(name).replace(/\.pdf$/i, ""), 90) || "Datei";
  let n = base + ".pdf", k = 2;
  while (used.has(n.toLowerCase())) n = base + " (" + k++ + ").pdf";
  used.add(n.toLowerCase());
  return n;
}
export const SHARE_DOCS = {
  leupold: (title) => "Leupold-Schema - " + (namePart(title, 60) || "Unterrichtseinheit") + ".pdf",
  feibeitsblatt: "Erklärung - Das ist ein Feibeitsblatt.pdf",
  missing: "Fehlende Sitzungen.pdf",
  plan: (n) => "Verlaufsplan - Sitzung " + n + ".pdf",
  pres: (n) => "Präsentation - Sitzung " + n + ".pdf",
  notes: (n) => "Notizen zu den Folien - Sitzung " + n + ".pdf",
  pptx: (n) => "Präsentation - Sitzung " + n + ".pptx",   // PowerPoint-Fassung (Folienbilder, Notizen der Lehrkraft in den Notizen der Folie)
};

/* ---------- Kompetenz: KCGO (Oberstufe), sonst die hinterlegte Planungsgrundlage ---------- */
export function competenceSource(subject, klass) {
  // basis: Nominativ („Für die Kompetenz gilt …“), from: Dativ („… aus …“)
  if (subject === GS_SUBJECT || isGsCourseId(klass)) return { label: "Zentrale Kompetenz", basis: "das hinterlegte Curriculum der Grundschule (Kerncurriculum für Hessen bzw. das Curriculum des Kurses)",
    from: "dem hinterlegten Curriculum der Grundschule", kcgo: false };
  const g = gradeInfo(klass), hj = g.halfYear === "E" ? "die Einführungsphase" : "das Kurshalbjahr " + g.halfYear;
  if (g.halfYear) return { label: "Zentrale Kompetenz (KCGO)", basis: "das KCGO (Kerncurriculum gymnasiale Oberstufe) für " + hj, from: "dem KCGO für " + hj, kcgo: true };
  return { label: "Zentrale Kompetenz", basis: "die hinterlegte Planungsgrundlage (Schulcurriculum bzw. Kerncurriculum für die Sekundarstufe I) – ein KCGO gibt es in dieser Jahrgangsstufe nicht",
    from: "der hinterlegten Planungsgrundlage (Schulcurriculum bzw. Kerncurriculum für die Sekundarstufe I)", kcgo: false };
}

/* ---------- Texte der Begleitdokumente (Blöcke für sharepdf.js: {t: "title"|"h"|"p"|"li"|"muted", text?|runs?}) ---------- */
const R = (text, f = {}) => ({ text, ...f });
/* „Erklärung – Das ist ein Feibeitsblatt“: Absprache-Variante (Entscheidung der Lehrkraft vom 18.11.2026: Abgaben gehen verschlüsselt an sie) */
export function fbExplainBlocks() {
  return [
    { t: "title", text: "Das ist ein Feibeitsblatt" },
    { t: "p", runs: [R("Liebe Kollegin, lieber Kollege,")] },
    { t: "p", runs: [R("in dieser Unterrichtseinheit arbeiten die Schüler:innen mit "), R("Feibeitsblättern", { b: true }), R(". Feibeitsblatt ist ein digitales Werkzeug, das ich, " + SHARE_AUTHOR +
      ", selbst für meinen Unterricht entwickelt habe. Es ist ein privates, nicht kommerzielles Angebot unter feibeitsblatt.janrickmer.de – kein Angebot einer Schule oder eines Verlags.")] },
    { t: "h", text: "So funktioniert ein Feibeitsblatt" },
    { t: "li", runs: [R("Die Lehrkraft legt Aufgaben mit Material an und hinterlegt zu jeder Aufgabe einen Auftrag an eine KI: worauf sie beim Feedback achten soll. Daraus entsteht ein Feibeitsblatt mit einem Code.")] },
    { t: "li", runs: [R("Die Schüler:innen öffnen feibeitsblatt.janrickmer.de auf ihrem Tablet, geben den Code ein und bearbeiten die Aufgaben allein oder in Partner- bzw. Gruppenarbeit direkt im Browser. Einfügen ist gesperrt – geschrieben wird selbst; eine Rechtschreibprüfung hilft beim Korrigieren.")] },
    { t: "li", runs: [R("Einmal können sie freiwillig ein KI-Feedback anfordern: Es nennt, was schon gelingt, und gibt Tipps zum Überarbeiten. An die KI gehen dabei nur die Antworten, nie Namen.")] },
    { t: "li", runs: [R("Danach überarbeiten sie ihre Antworten und geben ab. Die Abgabe ist verschlüsselt – lesen kann sie nur die Lehrkraft, die das Feibeitsblatt angelegt hat. Nach der Abgabe gibt es – wenn sie es nicht abwählen – eine abschließende KI-Rückmeldung, und die Schüler:innen laden ihre Lösungen als PDF-Datei herunter.")] },
    { t: "h", text: "Das Notfall-Feibeitsblatt" },
    { t: "p", runs: [R("Zu jedem Feibeitsblatt liegt im Ordner der Sitzung ein Notfall-Feibeitsblatt (PDF-Datei): dieselben Aufgaben und dasselbe Material als Arbeitsblatt, mit dem Code des Feibeitsblatts und – wenn ich eine Checkliste angelegt habe – einem QR-Code zu dieser Checkliste, mit der die Schüler:innen ihre Antworten selbst prüfen können.")] },
    { t: "p", runs: [R("Sie können das digitale Feibeitsblatt nach Absprache mit mir gern mit Ihrer Lerngruppe nutzen – den Code finden Sie auf dem Notfall-Feibeitsblatt. Wenn Sie sich das nicht zutrauen oder wir nichts abgesprochen haben, bearbeiten Ihre Schüler:innen einfach das Notfall-Feibeitsblatt auf ihrem Tablet als Dokument (z. B. in einer Notiz-App) und kommen zum gleichen Kompetenzerwerb.", { b: true })] },
    { t: "p", runs: [R("Warum nur nach Absprache? Die Fassungen nach dem KI-Feedback und die Abgaben gehen verschlüsselt an mich, weil ich die Feibeitsblätter angelegt habe – Sie sähen die Ergebnisse Ihrer Schüler:innen dort nicht. Sprechen Sie mich deshalb vorher an, damit wir klären, wie Sie zu den Ergebnissen kommen.")] },
    { t: "muted", text: "Viele Grüße, " + SHARE_AUTHOR },
  ];
}
/* „Fehlende Sitzungen“: list = shareSessions(…) ohne die geplanten; steps = Lernschritte des Leupold-Schemas */
export function missingBlocks(list, steps, { unitTitle = "", gs = false } = {}) {
  const out = [{ t: "title", text: "Fehlende Sitzungen" }];
  if (unitTitle) out.push({ t: "muted", text: "Unterrichtseinheit: " + unitTitle });
  out.push({ t: "p", runs: [R("Noch nicht alle Sitzungen dieser Unterrichtseinheit sind bisher geplant und mit Material ausgestattet. Die folgenden " + (list.length === 1 ? "Sitzung gibt" : list.length + " Sitzungen gibt") +
    " es bisher nur in der Reihenplanung – mit ihrer Stundenfrage und dem groben Ablauf laut Leupold-Schema; " + (gs ? "Verlaufsplan und Material fehlen" : "Präsentation, Verlaufsplan und Material fehlen") + " noch.")] });
  for (const s of list) {
    const r = s.row || {}, st = Number.isInteger(r.schritt) && steps && steps[r.schritt] ? steps[r.schritt] : null;
    out.push({ t: "h", text: shareFolder(s.n) + (r.stundenfrage ? ": " + r.stundenfrage : s.lesson && s.lesson.title ? ": " + s.lesson.title : "") });
    if (st) out.push({ t: "muted", text: "Lernschritt " + (r.schritt + 1) + ": " + (st.titel || "") + (st.beschreibung ? " – " + st.beschreibung : "") });
    const ab = Array.isArray(r.ablauf) ? r.ablauf.filter(Boolean) : [];
    if (ab.length) { out.push({ t: "p", runs: [R("Grober " + (gs ? "Ablauf" : "Stundenablauf") + ":", { b: true })] }); for (const a of ab) out.push({ t: "li", runs: [R(a)] }); }
    else out.push({ t: "p", runs: [R("Noch ohne groben Ablauf.", { i: true })] });
  }
  return out;
}
/* Kopfzeile einer Einheit für die Dokumente: „Politik und Wirtschaft · Jahrgangsstufe 8 (Sekundarstufe I)“ bzw. Grundschule mit Kursname */
export function unitMeta(unit, gsLabel = "") {
  if (unit.subject === GS_SUBJECT) return ["Grundschule", gsLabel].filter(Boolean).join(" · ");
  const g = gradeInfo(unit.klass);
  return [subjectName(unit.subject), g.text ? g.text.replace(/, Kurs mit Schüler:innen aus mehreren Klassen des Jahrgangs$/, "") : classShort(unit.klass)].filter(Boolean).join(" · ");
}
// Verlaufsplan: die interne Zeile „⏸ Zwischenstopp“ entfällt (wie beim Kopieren ins Schulportal)
export const planWithoutStop = (text) => str(text).replace(/\r\n?/g, "\n").split("\n").filter((l) => !isStopLine(l)).join("\n").replace(/^\n+|\n+$/g, "");
export { STOP_LINE };

/* ---------- Prompt für Claude: Absätze für die Weitergabe schreiben ----------
   ctx = {unitId, title, subject, klass, gs, sessions: [{n, lessonId, title, planned, has}]} */
/* src = competenceSource(…) (null = allgemein), gs = true (Grundschule: „Kinder“, Zeichen des Verlaufsplans), false (Gymnasium) oder "beide" (Beschreibung im
   Connector, der für beide Schulformen gilt) */
const kidsOf = (gs) => (gs === "beide" ? ["Schüler:innen bzw. Kinder", "Schüler:innen bzw. Kindern"] : gs ? ["Kinder", "Kindern"] : ["Schüler:innen", "Schüler:innen"]);
export const shareRules = (src = null, gs = false) => "Je Sitzung drei Teile, sachlich und für eine Kollegin bzw. einen Kollegen geschrieben, die bzw. der nicht an der Planung beteiligt war: " +
  "passiert = in zwei bis drei Sätzen, was in der Sitzung passiert (Einstieg, Arbeitsphase mit Material und Sozialform, Sicherung); kompetenz = die zentrale Kompetenz der Sitzung, möglichst " +
  "im Wortlaut der Planungsgrundlage mit dem Kompetenzbereich (" + (src ? "aus " + src.from : gs === "beide" ? "in der Oberstufe aus dem KCGO, sonst aus der hinterlegten Planungsgrundlage bzw. dem Curriculum der Grundschule"
    : "in der Oberstufe aus dem KCGO, sonst aus der hinterlegten Planungsgrundlage") + ") – nie eine erfundene; ziel = in einem Satz, was die " +
  "Lerngruppe am Ende der Sitzung kann („Die " + kidsOf(gs)[0] + " …“). Ohne Namen von " + kidsOf(gs)[1] + ", ohne Codes, ohne Hinweise auf Unterricks; kein Markdown, " +
  (gs === "beide" ? "keine Schulportal-Zeichen bzw. Zeichen des Verlaufsplans, keine Verweise [[pdf:…]]." : gs ? "keine Zeichen des Verlaufsplans, keine Verweise [[pdf:…]]." : "keine Schulportal-Zeichen.");
export const SHARE_RULES = shareRules(null, "beide");
export function claudeSharePrompt(ctx) {
  const src = competenceSource(ctx.subject, ctx.klass), planned = (ctx.sessions || []).filter((s) => s.planned), open = (ctx.sessions || []).filter((s) => !s.planned);
  const list = planned.map((s) => "- Sitzung " + s.n + ": „" + (s.title || "ohne Titel") + "“ (lesson_id " + s.lessonId + ")" + (s.has ? " – hat schon einen Absatz (prüfe und verbessere ihn nur, wenn nötig)" : "")).join("\n");
  return [
    "Du bist eine erfahrene Fachdidaktikerin bzw. ein erfahrener Fachdidaktiker. Ich möchte meine Unterrichtseinheit „" + (ctx.title || "ohne Titel") + "“ (" + (ctx.gs ? "Grundschule" : subjectName(ctx.subject) + ", " + classShort(ctx.klass)) +
      ") mit Kolleginnen und Kollegen teilen. Unterricks erstellt dafür eine PDF-Datei mit dem Leupold-Schema; darunter steht zu jeder geplanten Sitzung ein kurzer Absatz – den schreibst du mit mir.",
    "",
    "## Vorgehen",
    "1. Lies mit dem Connector „Unterricks“ die Einheit mit `get_unit` (unit_id " + ctx.unitId + ") und die Planungsgrundlagen mit `get_planning_basis` (unit_id " + ctx.unitId + "). Für die Kompetenz gilt " + src.basis + ".",
    "2. Lies jede der folgenden geplanten Sitzungen mit `get_lesson` (Verlaufsplan, Zusammenfassung für die Lehrkraft, Material):",
    list || "- (noch keine geplante Sitzung)",
    "3. Schreibe zu jeder dieser Sitzungen den Absatz: " + shareRules(src, !!ctx.gs),
    "4. Zeige mir alle Absätze im Chat. Wenn ich zustimme, speichere sie mit `save_weitergabe` (unit_id " + ctx.unitId + ", sitzungen: [{lesson_id, passiert, kompetenz, ziel}]) – alle in einem Aufruf. Ich prüfe sie danach in Unterricks und kann sie dort ändern.",
    open.length ? "\nNoch nicht geplant (" + open.map((s) => "Sitzung " + s.n).join(", ") + "): Dazu schreibst du nichts – Unterricks listet sie im Dokument „Fehlende Sitzungen“ mit Stundenfrage und grobem Ablauf aus der Einheit." : "",
    "",
    "Fehlt die Planungsgrundlage für die Kompetenz, sage es mir und formuliere die Kompetenz nur aus der Einheit (Ausgangslage, Lernschritte) mit dem Zusatz „(ohne Vorlage formuliert)“.",
    "Falls der Connector „Unterricks“ in diesem Chat nicht verfügbar ist, sage es mir sofort.",
  ].filter((l) => l !== "").join("\n").replace(/\n{3,}/g, "\n\n");
}
/* Schritt im Prompt „Stunde mit Claude planen“ (Gymnasium und Grundschule): den Absatz beim Planen gleich mit (Wunsch der Lehrkraft vom 18.11.2026) */
export const shareSaveStep = (subject, klass) => {
  const gs = subject === GS_SUBJECT || isGsCourseId(klass), k = kidsOf(gs);
  return "   - Außerdem den „" + SHARE_TEXT_TITLE + "“ (für das Leupold-Schema, wenn ich die Einheit mit Kolleg:innen teile) → `update_lesson` mit `weitergabe` " +
    "{passiert, kompetenz, ziel} – zusammen mit der Zusammenfassung. passiert: zwei bis drei Sätze, was in der Stunde passiert; kompetenz: die zentrale Kompetenz der Stunde aus " + competenceSource(subject, klass).from +
    " (möglichst im Wortlaut, nie erfunden – fehlt die Grundlage, aus der Einheit formuliert mit dem Zusatz „(ohne Vorlage formuliert)“); ziel: ein Satz, was die Lerngruppe am Ende kann. Ohne Namen von " + k[1] +
    ", ohne Codes, kein Markdown, " + (gs ? "keine Zeichen des Verlaufsplans, keine Verweise [[pdf:…]]." : "keine Schulportal-Zeichen.");
};

/* ---------- Verlaufsplan einer Sitzung als Blöcke ----------
   L = lesson (portal, homework, teacherSummary, title, durationMin), n = Nummer der Stunde, files = Dateien der Sitzung (Verweise [[pdf:…]] im Verlaufsplan
   der Grundschule werden zu ihrem Namen), names = Map id → Dateiname im Ordner der Sitzung, meta = Kopfzeile der Einheit */
const runsOf = (runs, names) => (runs || []).map((r) => (r.file ? { text: "„" + (names.get(r.file) || "Material") + "“", i: true } : r)).filter((r) => r.text);   // Verweis → Dateiname
function markupBlocks(text, gs, names) {
  const out = [];
  for (const ln of (gs ? parsePlanMarkup : parsePortalMarkup)(planWithoutStop(text))) {
    if (ln.type === "stop") continue;
    if (ln.type === "blank") { if (out.length && out[out.length - 1].t !== "gap") out.push({ t: "gap" }); continue; }
    const runs = runsOf(ln.runs, names);
    if (runs.length) out.push({ t: ln.type === "li" ? "li" : "p", runs });
  }
  while (out.length && out[out.length - 1].t === "gap") out.pop();
  return out;
}
/* head = eigene Überschrift statt „Verlaufsplan – Sitzung n“, when = Datum und Beginn für die Kopfzeile, extra = weitere Blöcke nach den Links (Unterlagen einer
   Sitzung, Nachtrag 41: Feibeitsblätter, Gegenstände zum Mitbringen) */
export function planBlocks({ L, n, gs = false, files = [], names = new Map(), meta = "", head = "", when = "", extra = [] }) {
  const out = [{ t: "title", text: head || "Verlaufsplan – " + shareFolder(n) }];
  if (L.title) out.push({ t: "sub", text: L.title });
  out.push({ t: "muted", text: [meta, when, L.durationMin ? L.durationMin + " Minuten" : ""].filter(Boolean).join(" · ") });
  out.push({ t: "h", text: gs ? "Verlaufsplan" : "Stundenverlauf" }, ...markupBlocks(L.portal, gs, names));
  const hw = str(L.homework).trim();
  if (hw) out.push({ t: "h", text: "Hausaufgabe" }, ...(gs ? hw.split(/\n+/).map((x) => ({ t: "p", runs: [R(x.trim())] })) : markupBlocks(hw, false, names)));
  const links = files.filter((f) => f.kind === "link" && f.url && f.area !== "archive");
  if (links.length) out.push({ t: "h", text: "Links" }, ...links.map((f) => ({ t: "li", runs: [R(f.name + ": "), R(f.url, { href: f.url })] })));
  out.push(...(extra || []));
  const sum = str(L.teacherSummary).trim();
  if (sum) out.push({ t: "h", text: "Zusammenfassung der Sitzung für die Lehrkraft" }, ...sum.split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean).map((x) => ({ t: "p", runs: [R(x)] })));
  return out;
}
