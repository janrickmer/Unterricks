// sessionfile.js – Unterrickssitzung als Datei (Wunsch der Lehrkraft vom 10.11.2026): eine ZIP-Datei mit sitzung.json und allen Dateien,
// um eine schon gehaltene Sitzung in einer anderen Lerngruppe erneut durchzuführen oder leicht abzuändern. Beim Laden kommen Datum, Beginn,
// Dauer und Fälligkeit aus der geöffneten Sitzung; Datumsangaben in den Texten werden an sie angepasst (adaptDates).
// Hier nur reine Funktionen (ohne Netz und DOM) – das Herunterladen und Hochladen steuert session.js.
import { subjectName, subjectShort, groupShort, isIsoDate, isClockTime, cleanWebUrl, cleanCopies, normalizeFbDraft } from "./shared.js";

export const SESSION_FILE = { kind: "unterricks-sitzung", v: 1, json: "sitzung.json" };
export const SESSION_LIMITS = { files: 60, chat: 200, drafts: 20, text: 200000 };

const clean = (s) => String(s == null ? "" : s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
/* „Unterrickssitzung - PoWi - Jg. 8 - Gewaltenteilung - Sitzung Nr. 3.zip“ */
export function sessionFileName({ subject, klass, unitTitle, sessionNo }) {
  return ["Unterrickssitzung", subjectShort(subject) || subjectName(subject) || "Fach", groupShort(klass) || "Lerngruppe", clean(unitTitle).slice(0, 80) || "ohne Einheit",
    "Sitzung Nr. " + (Number.isInteger(sessionNo) && sessionNo > 0 ? sessionNo : "?")].join(" - ") + ".zip";
}

/* ---------- Feibeitsblatt (Lehrkraft-Schnittstelle) → Entwurf der Plattform ----------
 * Material: Läufe → Text mit **fett** und „Text (Adresse)“ bei Links; Antwortarten Text, Tabelle, Foto (Weltkarte wird Textaufgabe). */
export function sheetToDraft(sheet) {
  const notes = [];
  const runsText = (paras) => (Array.isArray(paras) ? paras : []).map((p) => (Array.isArray(p) ? p : []).map((r) => {
    const t = String((r && r.t) || ""); if (!t) return "";
    const b = /b/.test(String((r && r.f) || "")) ? "**" + t + "**" : t;
    return r && r.h ? b + " (" + r.h + ")" : b;
  }).join("")).join("\n");
  const tasks = (Array.isArray(sheet && sheet.tasks) ? sheet.tasks : []).slice(0, 20).map((t, i) => {
    const a = (t && t.answer) || {};
    let antwort = "text";
    if (a.type === "table" && Array.isArray(a.columns)) antwort = { tabelle: a.columns.slice(0, 8), zeilen: a.rows || 3 };
    else if (a.type === "photo") antwort = "foto";
    else if (a.type === "map") notes.push("Aufgabe " + (i + 1) + " (Weltkarte) kommt als Textaufgabe – die Karte bitte im Feibeitsblatt selbst neu anlegen.");
    if (Array.isArray(t && t.images) && t.images.length) notes.push("Aufgabe " + (i + 1) + ": Bilder werden nicht übernommen.");
    return { text: String((t && t.text) || ""), material: runsText(t && t.material), ki_auftrag: String((t && t.solution) || ""), antwort };
  }).filter((t) => t.text.trim());
  return { draft: tasks.length ? normalizeFbDraft({ title: (sheet && sheet.title) || "Feibeitsblatt", tasks }) : null, notes };
}

/* ---------- Datumsangaben in Texten anpassen ----------
 * pairs: [[altISO, neuISO], …] (z. B. Datum der Sitzung und der nächsten Sitzung). Erkannt werden 25.11.2026, 25.11.26, 25.11., 2026-11-25 und
 * 25. November 2026 / 25. November, jeweils mit Wochentag davor („Mi., 25.11.2026“, „Mittwoch, 25. November“). Andere Daten bleiben und werden gemeldet. */
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WD_SHORT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"], WD_LONG = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const wdOf = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
const WD = "(?:(" + WD_LONG.join("|") + "|" + WD_SHORT.join("|") + ")(\\.?),?\\s+)?";
const DATE_RE = new RegExp(WD + "(?:(\\d{4})-(\\d{2})-(\\d{2})|(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4}|\\d{2})?(?!\\d)|(\\d{1,2})\\.\\s?(" + MONTHS.join("|") + "|Maerz)(?:\\s(\\d{4}))?)", "g");
export function adaptDates(text, pairs) {
  const src = String(text == null ? "" : text), list = (pairs || []).filter(([a, b]) => isIsoDate(a) && isIsoDate(b));
  const replaced = [], unknown = [];
  const out = src.replace(DATE_RE, (all, wd, wdDot, iy, im, id, nd, nm, ny, ld, lm, ly, offset) => {
    // keine Uhrzeit- oder Versionsangabe mitnehmen (z. B. „1.2.3“): nur echte Kalenderdaten
    let y, m, d, style;
    if (iy) { y = +iy; m = +im; d = +id; style = "iso"; }
    else if (nd) { d = +nd; m = +nm; y = ny ? (ny.length === 2 ? 2000 + +ny : +ny) : null; style = "num"; }
    else { d = +ld; m = lm === "Maerz" ? 3 : MONTHS.indexOf(lm) + 1; y = ly ? +ly : null; style = "long"; }
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return all;
    if (style === "num" && !ny && src[offset + all.length] && /\d/.test(src[offset + all.length])) return all;
    const md = String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
    const hit = list.find(([a]) => a.slice(5) === md && (y === null || +a.slice(0, 4) === y));
    if (!hit) { if (unknown.length < 12) unknown.push(all.trim()); return all; }
    const [, to] = hit, ny2 = +to.slice(0, 4), nm2 = +to.slice(5, 7), nd2 = +to.slice(8, 10), w = wdOf(to);
    const pad = (n, orig) => (String(orig).length === 2 ? String(n).padStart(2, "0") : String(n));
    let body;
    if (style === "iso") body = to;
    else if (style === "num") body = pad(nd2, nd) + "." + pad(nm2, nm) + "." + (ny ? (ny.length === 2 ? String(ny2).slice(2) : String(ny2)) : "");
    else body = pad(nd2, ld) + ". " + MONTHS[nm2 - 1] + (ly ? " " + ny2 : "");
    const wdText = wd ? (WD_LONG.includes(wd) ? WD_LONG[w] : WD_SHORT[w]) + (wdDot || "") + all.slice(wd.length + (wdDot || "").length, all.length - (all.length - all.search(/\d/))) : "";
    const res = wdText + body;
    if (res !== all) replaced.push([all.trim(), res.trim()]);
    return res;
  });
  return { text: out, replaced, unknown };
}

/* ---------- Inhalt der Datei prüfen (fremde Daten) ---------- */
const str = (v, max) => (typeof v === "string" ? v : v == null ? "" : String(v)).slice(0, max);
export function cleanSessionFile(raw) {
  if (!raw || typeof raw !== "object" || raw.kind !== SESSION_FILE.kind) throw new Error("Diese Datei ist keine Unterrickssitzung.");
  if (raw.v !== SESSION_FILE.v) throw new Error("Diese Unterrickssitzung stammt aus einer neueren Fassung von Unterricks.");
  const s = raw.source || {}, l = raw.lesson || {};
  const area = (a) => (a === "teacher" || a === "print" || a === "presentation" ? a : "student");
  const files = (Array.isArray(raw.files) ? raw.files : []).slice(0, SESSION_LIMITS.files).map((f) => {
    const kind = f && (f.kind === "text" || f.kind === "link") ? f.kind : "file";
    const o = { area: area(f && f.area), kind, name: str(f && f.name, 200).trim() || "Datei", mime: str(f && f.mime, 120) };
    if (kind === "file") {
      o.path = str(f && f.path, 300);
      // von Claude gestaltet: Pfad der HTML-Gestaltung in der Datei (fehlt path, war die PDF beim Sichern noch nicht gedruckt)
      const d = o.area !== "presentation" ? str(f && f.design, 300) : "";
      if (d) { o.design = d; o.rendered = !!(f && f.rendered === true && o.path); }
    }
    if (kind === "text") o.text = str(f && f.text, SESSION_LIMITS.text);
    if (kind === "link") o.url = cleanWebUrl(f && f.url) || "";
    if (o.area === "print") o.print = { copies: cleanCopies(f && f.print && f.print.copies) || 1, duplex: !(f && f.print && f.print.duplex === false), color: !!(f && f.print && f.print.color === true) };
    return o;
  }).filter((f) => (f.kind === "file" ? !!(f.path || f.design) : f.kind === "text" ? !!f.text.trim() : !!f.url) && !(f.area === "presentation" && (f.kind !== "file" || !f.path)));
  const drafts = [];
  for (const d of (Array.isArray(raw.drafts) ? raw.drafts : []).slice(0, SESSION_LIMITS.drafts)) { try { drafts.push(normalizeFbDraft(d)); } catch {} }
  return {
    source: { subject: str(s.subject, 20), klass: str(s.klass, 10), unitTitle: str(s.unitTitle, 200), sessionNo: Number.isInteger(s.sessionNo) ? s.sessionNo : null,
      date: isIsoDate(s.date) ? s.date : null, nextDate: isIsoDate(s.nextDate) ? s.nextDate : null, startTime: isClockTime(s.startTime) ? s.startTime : null,
      durationMin: Number.isInteger(s.durationMin) ? s.durationMin : null, title: str(s.title, 200) },
    lesson: { title: str(l.title, 200), topic: str(l.topic, 500), ideas: str(l.ideas, 20000), homework: str(l.homework, 10000), portal: str(l.portal, 30000) },
    chat: (Array.isArray(raw.chat) ? raw.chat : []).slice(-SESSION_LIMITS.chat).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
      .map((m) => ({ role: m.role, content: m.content.slice(0, 100000), model: str(m.model, 200) || null, mode: str(m.mode, 20) || null })),
    files, drafts,
    sheets: (Array.isArray(raw.sheets) ? raw.sheets : []).slice(0, 20).map((x) => ({ code: str(x && x.code, 10), title: str(x && x.title, 200) })).filter((x) => /^[A-Z0-9]{6}$/.test(x.code)),
    notes: (Array.isArray(raw.notes) ? raw.notes : []).slice(0, 20).map((x) => str(x, 300)),
  };
}
