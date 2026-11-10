// fbanalog.js – AUTOMATISCH ERZEUGT von scripts/fbanalog-sync.mjs aus dem Feibeitsblatt (index.html, Stand 742004d vom 10.11.2026). Nicht von Hand ändern:
// Änderungen gehören ins Feibeitsblatt, danach das Skript erneut ausführen.
// Inhalt: das analoge Arbeitsblatt als PDF (makeAnalogPdf, ohne Bibliothek) mit allen Bausteinen – in Unterricks „Notfall-Feibeitsblatt“.
/* eslint-disable */
// Adresse der digitalen Fassung (Hinweiskasten, QR-Code zur Checkliste) – im Feibeitsblatt window.FEIBEITSBLATT_PUBLIC
let PUBLIC_URL = "https://feibeitsblatt.janrickmer.de/";
export function setFeibeitsblattUrl(u) { if (/^https:\/\/[^\s"<>]+$/.test(String(u || ""))) PUBLIC_URL = String(u).replace(/\/*$/, "/"); }
const checkUrlOf = (code) => PUBLIC_URL.replace(/#.*$/, "") + "#checkliste=" + normCode(code);   // Ziel des QR-Codes (wie im Feibeitsblatt)

const pad2 = (n) => String(n).padStart(2, "0");

function fmtCode(c) { c = String(c || ""); return c.length === 6 ? c.slice(0, 3) + "-" + c.slice(3) : c; }

function normCode(s) { return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }

const MAT_LIMITS = { chars: 8000, paragraphs: 200, runs: 600, links: 60, href: 1000 };   // wie LIMITS im Worker

function cleanHref(raw) {   // → http(s)-Adresse oder "" (javascript:, data: usw. werden verworfen)
  const s = String(raw == null ? "" : raw).trim();
  if (!s || s.length > MAT_LIMITS.href || /[\u0000-\u0020\u007f]/.test(s)) return "";
  let u; try { u = new URL(s); } catch (e) { return ""; }
  return (u.protocol === "http:" || u.protocol === "https:") && u.href.length <= MAT_LIMITS.href ? u.href : "";
}

function cleanMaterial(raw) {   // Daten vom Server prüfen, bevor daraus DOM wird
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAT_LIMITS.paragraphs).map((p) => (Array.isArray(p) ? p : []).map((r) => (r && typeof r.t === "string"
    ? { t: r.t.slice(0, MAT_LIMITS.chars), f: ["b", "i", "u"].filter((c) => String(r.f || "").includes(c)).join(""), h: cleanHref(r.h) } : null)).filter((r) => r && r.t));
}

const IMAGE_ID_RE = /^[0-9a-f]{16}$/, IMAGE_MIME_RE = /^image\/(jpeg|png|webp)$/;

const FILE_ID_RE = IMAGE_ID_RE, FILE_B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const FILE_MAX_BYTES = 6 * 1024 * 1024, FILES_PER_TASK = 3, FILE_SHEET_BYTES = 20 * 1024 * 1024, FILE_CHUNK = 512 * 1024;   // wie LIMITS im Worker

function safeFileName(name) {   // wie cleanFileName im Worker: keine Steuer-, Format- (Bidi, Nullbreite) und Pfadzeichen, endet auf .pdf
  let s = String(name == null ? "" : name).normalize("NFC").replace(/[\t\n\r\v\f\u0085\u2028\u2029]/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (!/\.pdf$/i.test(s)) s += ".pdf";
  if (s.length > 120) { s = s.slice(0, 116); if (/[\uD800-\uDBFF]$/.test(s)) s = s.slice(0, -1); s = s.trim() + ".pdf"; }
  s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
  return s === ".pdf" ? "Datei.pdf" : s;
}

function cleanFiles(list) {   // Metadaten vom Server prüfen (fremde Daten nie ungeprüft ins DOM)
  return (Array.isArray(list) ? list : []).filter((f) => f && typeof f.id === "string" && FILE_ID_RE.test(f.id)).slice(0, FILES_PER_TASK)
    .map((f) => ({ id: f.id, name: safeFileName(f.name), bytes: Number.isInteger(f.bytes) && f.bytes > 0 ? f.bytes : 0 }));
}

/* VIDEO:BEGIN – reine Funktionen ohne Abhängigkeiten (test/unit/video.test.mjs liest diesen Block) */
const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;   // nie kleinschreiben: YouTube unterscheidet Groß- und Kleinschreibung
const VIDEO_LIMITS = { perTask: 3, title: 120, start: 86400 };   // wie LIMITS.videosPerTask/videoTitle/videoStart im Worker (Startsekunde < start)
// Zustimmungstext unter jedem Platzhalter (wörtlich; im Schreibbereich auch bei Gruppenarbeit in der du-Form)
const YT_CONSENT = "Erst nach diesem Klick wird das Video von YouTube (Google) geladen. Dabei erhält Google unter anderem deine IP-Adresse und kann Cookies setzen; Daten können in die USA gelangen.";
const YT_HOSTS = ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "youtube-nocookie.com", "www.youtube-nocookie.com"];   // exakt verglichen
const YT_ERR_EMPTY = "Bitte den Link des YouTube-Videos eingeben.";
const YT_ERR_PLAYLIST = "Playlists lassen sich nicht einbetten – bitte den Link eines einzelnen Videos eingeben.";
const YT_ERR_OTHER = "Das ist kein Link zu einem YouTube-Video. Erlaubt sind Links von youtube.com und youtu.be, z. B. https://www.youtube.com/watch?v=…";
// Titel einzeilig wie cleanLine im Worker (ohne Steuer- und Formatzeichen wie Bidi-Steuerung), gekappt ohne halbes Ersatzzeichen-Paar
function videoTitle(v) {
  if (typeof v !== "string") return "";
  return v.slice(0, 4 * VIDEO_LIMITS.title + 100).normalize("NFC").replace(/[\t\n\r\v\f\u0085\u2028\u2029]/g, " ").replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ").trim().slice(0, VIDEO_LIMITS.title).replace(/[\uD800-\uDBFF]$/, "");
}
// Startzeit aus t= bzw. start=: „90“, „90s“, „1m30s“, „1h2m3s“ → Sekunden (1 … VIDEO_LIMITS.start − 1), sonst 0 (= von vorn)
function videoStartOf(raw) {
  const s = String(raw == null ? "" : raw).trim().toLowerCase();
  const m = /^(?:(\d{1,3})h)?(?:(\d{1,4})m)?(?:(\d{1,6})s?)?$/.exec(s);
  if (!s || !m) return 0;
  const sec = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return sec >= 1 && sec < VIDEO_LIMITS.start ? sec : 0;
}
/* Eingabe der Lehrkraft (Link oder eingefügter Einbettungscode <iframe … src="…">) → {id, start} (start 0 = von vorn) oder {error: Meldung}.
   Erlaubt: genau die Hosts aus YT_HOSTS mit /watch?v=ID, youtu.be/ID, /shorts/ID, /embed/ID, /live/ID, /v/ID; ohne Schema wird
   https:// ergänzt. Übernommen werden nur Kennung und Startzeit – si=, pp=, list=, feature= usw. fallen weg. Der Einbettungscode wird
   nur als Text gelesen (Regex), nie als HTML. */
function parseYouTube(input) {
  let s = String(input == null ? "" : input).trim();
  if (!s) return { error: YT_ERR_EMPTY };
  const tag = s.search(/<iframe\b/i);
  if (tag >= 0) {
    const m = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(s.slice(tag, tag + 4000));
    if (!m) return { error: YT_ERR_OTHER };
    s = (m[1] != null ? m[1] : m[2] != null ? m[2] : m[3]).replace(/&amp;/gi, "&").trim();
  }
  if (s.length > 2000 || /[\u0000- \u007f]/.test(s)) return { error: YT_ERR_OTHER };
  if (/^\/\//.test(s)) s = "https:" + s;   // //www.youtube.com/embed/… (ältere Einbettungscodes)
  else if (!/^https?:\/\//i.test(s)) s = "https://" + s;   // ohne Schema (auch javascript: & Co. scheitern so am Host)
  let u;
  try { u = new URL(s); } catch (e) { return { error: YT_ERR_OTHER }; }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || u.port || !YT_HOSTS.includes(u.hostname)) return { error: YT_ERR_OTHER };
  const parts = u.pathname.split("/").filter(Boolean), q = u.searchParams;
  let id = "";
  if (u.hostname === "youtu.be") id = parts.length === 1 ? parts[0] : "";
  else if (parts[0] === "watch" && parts.length === 1) { id = q.get("v") || ""; if (!id && q.get("list")) return { error: YT_ERR_PLAYLIST }; }
  else if (parts[0] === "playlist" || (parts[0] === "embed" && parts[1] === "videoseries")) return { error: YT_ERR_PLAYLIST };
  else if (["shorts", "embed", "live", "v"].includes(parts[0]) && parts.length === 2) id = parts[1];
  if (!YT_ID_RE.test(id)) return { error: YT_ERR_OTHER };
  const hash = /(?:^#|&)t=([^&]*)/.exec(u.hash);
  return { id, start: videoStartOf(q.has("t") ? q.get("t") : q.has("start") ? q.get("start") : hash ? hash[1] : "") };
}
/* Videos aus fremden Daten (Server, Sicherung) prüfen wie videosOut im Worker: nur gültige Kennungen, Startsekunde als Ganzzahl
   1 … VIDEO_LIMITS.start − 1 (sonst von vorn), Titel einzeilig und gekappt, dasselbe Video mit derselben Startzeit nur einmal, höchstens
   VIDEO_LIMITS.perTask → [{id, start?, title?}] */
function cleanVideos(list) {
  const out = [], seen = new Set();
  for (const v of Array.isArray(list) ? list : []) {
    if (out.length >= VIDEO_LIMITS.perTask) break;
    if (!v || typeof v !== "object" || typeof v.id !== "string" || !YT_ID_RE.test(v.id)) continue;
    const start = Number.isInteger(v.start) && v.start > 0 && v.start < VIDEO_LIMITS.start ? v.start : 0;
    if (seen.has(v.id + "|" + start)) continue;
    seen.add(v.id + "|" + start);
    const o = { id: v.id }, title = videoTitle(v.title);
    if (start) o.start = start;
    if (title) o.title = title;
    out.push(o);
  }
  return out;
}
const videoStartSec = (v) => (v && Number.isInteger(v.start) && v.start > 0 && v.start < VIDEO_LIMITS.start ? v.start : 0);
// Link zum Video auf youtube.com – überall derselbe (auch QR-Code und gedruckter Link des analogen Arbeitsblattes); v aus cleanVideos/parseYouTube
const youtubeUrl = (v) => "https://www.youtube.com/watch?v=" + v.id + (videoStartSec(v) ? "&t=" + videoStartSec(v) + "s" : "");
// Adresse des eingebetteten Players (nur im iframe nach dem Klick)
const youtubeEmbedUrl = (v) => "https://www.youtube-nocookie.com/embed/" + v.id + "?autoplay=1" + (videoStartSec(v) ? "&start=" + videoStartSec(v) : "");
// Startzeit lesbar: 90 → „1:30“, 3723 → „1:02:03“
function fmtVideoStart(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0)), hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  const p2 = (x) => String(x).padStart(2, "0");
  return hh ? `${hh}:${p2(mm)}:${p2(ss)}` : `${mm}:${p2(ss)}`;
}
/* VIDEO:END */

function cleanImages(list, cards) {   // Metadaten vom Server prüfen (fremde Daten nie ungeprüft ins DOM); cards = nur Kartenbilder (Weltkarte)
  return (Array.isArray(list) ? list : []).filter((m) => m && typeof m.id === "string" && IMAGE_ID_RE.test(m.id) && (m.mode === "card") === !!cards).slice(0, cards ? ANS_LIMITS.cards : 5)
    .map((m) => ({ id: m.id, mode: cards ? "card" : m.mode === "inline" ? "inline" : "thumb", w: Number.isInteger(m.w) && m.w > 0 ? m.w : 0, h: Number.isInteger(m.h) && m.h > 0 ? m.h : 0,
      alt: typeof m.alt === "string" ? m.alt.slice(0, 200) : "" }));
}

const ANS_LIMITS = { columns: 8, columnName: 60, rows: 30, items: 40, itemId: 40, label: 120, hint: 400, countries: 10, countryName: 80, checks: 400, cards: 40, photoTasks: 3 };   // wie LIMITS im Worker

const ITEM_ID_RE = /^[a-z0-9-]{1,40}$/, COUNTRY_ID_RE = /^\d{3}$/, CHECK_RE = /^[0-9a-f]{64}$/;

const oneLine = (v, n) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

function cleanAnswer(a, full, imageRe) {   // imageRe: Kennung eines Kartenbildes (Server: 16 Hex, Sicherung: Ref „<exportId>-<k>“)
  if (!a || typeof a !== "object") return { type: "text" };
  if (a.type === "photo") return { type: "photo" };
  if (a.type === "table") {
    const columns = (Array.isArray(a.columns) ? a.columns : []).slice(0, ANS_LIMITS.columns).map((c) => oneLine(c, ANS_LIMITS.columnName).replace(/\|/g, "/")).filter(Boolean);
    return columns.length ? { type: "table", columns, rows: Math.max(1, Math.min(ANS_LIMITS.rows, Number.isInteger(a.rows) ? a.rows : 1)) } : { type: "text" };
  }
  if (a.type !== "map") return { type: "text" };
  const ids = new Set(), items = [];
  for (const it of (Array.isArray(a.items) ? a.items : []).slice(0, ANS_LIMITS.items)) {
    if (!it || typeof it !== "object") continue;
    // Schüler:innen brauchen eine gültige, eindeutige Kennung (Prüfwerte); Lehrkraft und Sicherung nicht – beim Anlegen
    // entsteht sie neu aus der Bezeichnung
    const id = typeof it.id === "string" && ITEM_ID_RE.test(it.id) && !ids.has(it.id) ? it.id : "";
    if (!id && !full) continue;
    const label = oneLine(it.label, ANS_LIMITS.label);
    if (!label) continue;
    const o = { id, label, hint: oneLine(it.hint, ANS_LIMITS.hint), image: typeof it.image === "string" && (imageRe || IMAGE_ID_RE).test(it.image) ? it.image : "" };
    if (full) o.countries = (Array.isArray(it.countries) ? it.countries : []).filter((c) => c && typeof c.id === "string" && COUNTRY_ID_RE.test(c.id))
      .slice(0, ANS_LIMITS.countries).map((c) => ({ id: c.id, name: oneLine(c.name, ANS_LIMITS.countryName) || c.id }));
    else o.checks = (Array.isArray(it.checks) ? it.checks : []).filter((x) => typeof x === "string" && CHECK_RE.test(x)).slice(0, ANS_LIMITS.countries);
    if (id) ids.add(id);
    items.push(o);
  }
  return items.length ? { type: "map", map: "world", items } : { type: "text" };
}

const PDF_W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];

const PDF_W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

/* PDFPLAIN:BEGIN – Text für die WinAnsi-Schriften der PDF-Dateien (test/unit/escape.test.mjs liest diesen Block) */
const WINANSI = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8A, "‹": 0x8B, "Œ": 0x8C, "Ž": 0x8E, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9A, "›": 0x9B, "œ": 0x9C, "ž": 0x9E, "Ÿ": 0x9F };
const pdfWinAnsi = (ch) => { const c = ch.codePointAt(0); return c < 0x80 || (c >= 0xA0 && c <= 0xFF) || !!WINANSI[ch]; };
// Lateinische Buchstaben ohne Zerlegung in Grundbuchstabe + Akzent (z. B. in Namen: „Yılmaz“, „Łukasz“, „Đorđe“)
const PDF_LATIN = { "ı": "i", "ł": "l", "Ł": "L", "đ": "d", "Đ": "D", "ħ": "h", "Ħ": "H", "ŀ": "l", "Ŀ": "L", "ŧ": "t", "Ŧ": "T", "ĸ": "k", "ſ": "s",
  "ƀ": "b", "ƚ": "l", "ɨ": "i", "ʉ": "u", "ŋ": "n", "Ŋ": "N", "ǥ": "g", "Ǥ": "G" };
// Ein Zeichen außerhalb von WinAnsi: der Grundbuchstabe mit so vielen Akzenten, wie WinAnsi kennt („ş“ → „s“, „ễ“ → „ê“, „ř“ → „r“),
// sonst die Tabelle; ein allein stehendes Kombinationszeichen entfällt; alles andere bleibt (und wird als „?“ gedruckt, z. B. Kyrillisch)
function pdfLatin(ch) {
  if (pdfWinAnsi(ch)) return ch;
  if (PDF_LATIN[ch]) return PDF_LATIN[ch];
  const d = ch.normalize("NFD");
  for (let k = d.length - 1; k >= 1; k--) { const c = d.slice(0, k).normalize("NFC"); if (Array.from(c).length === 1 && pdfWinAnsi(c)) return c; }
  return /^\p{M}$/u.test(ch) ? "" : ch;
}
// Zeichen außerhalb von WinAnsi, die in Antworten vorkommen (Weltkarte „Kaffee → Brasilien“) oder in Daten aus einem Escape-Room
// („−23,8 %“, „≈ 81 %“ – sonst stünde dort „?23,8 %“), lesbar ersetzen, Buchstaben mit Akzenten außerhalb von WinAnsi per pdfLatin –
// vor Breite und Bytes
const pdfPlain = (str) => String(str).normalize("NFC").replace(/→/g, "->").replace(/✓/g, "").replace(/✗/g, "x")
  .replace(/[\u2212\u2010\u2011]/g, "-").replace(/\u2248/g, "~").replace(/[\u2009\u202F]/g, " ").replace(/[^\u0000-\u007F\u00A0-\u00FF]/gu, pdfLatin);
/* PDFPLAIN:END */

function pdfBytes(str) {   // Text → WinAnsi-Bytes (Zeichen außerhalb → „?“)
  const out = [];
  for (const ch of pdfPlain(str)) {
    const c = ch.codePointAt(0);
    out.push(c < 0x80 || (c >= 0xA0 && c <= 0xFF) ? c : WINANSI[ch] || 0x3F);
  }
  return out;
}

function pdfStr(str) {   // PDF-Zeichenkette in Klammern; Klammern/Backslash maskiert, Bytes außerhalb ASCII oktal
  return "(" + pdfBytes(str).map((b) => b === 0x28 || b === 0x29 || b === 0x5C ? "\\" + String.fromCharCode(b) : b < 0x20 || b > 0x7E ? "\\" + b.toString(8).padStart(3, "0") : String.fromCharCode(b)).join("") + ")";
}

const PDF_W_EXTRA = { "…": 1000, "—": 1000, "‰": 1000, "™": 1000, "Œ": 1000, "Æ": 1000, "œ": 944, "æ": 889, "¼": 834, "½": 834, "¾": 834,
  "©": 737, "®": 737, "Ø": 778, "Ð": 722, "Þ": 667, "ø": 611, "ð": 611, "þ": 611, "µ": 611, "¿": 611, "ß": 611, "±": 584, "×": 584, "÷": 584,
  "¬": 584, "€": 556, "–": 556, "«": 556, "»": 556, "¶": 556, "†": 556, "‡": 556, "¤": 556, "¢": 556, "£": 556, "¥": 556, "§": 556, "ƒ": 556,
  "°": 400, "ª": 370, "º": 365, "•": 350, "‹": 333, "›": 333, "¡": 333, "ˆ": 333, "˜": 333, "¨": 333, "¯": 333, "´": 333, "¸": 333, "¹": 333,
  "²": 333, "³": 333, "¦": 280, "·": 278, "\u00a0": 278 };

function pdfWidth(str, size, bold) {   // Textbreite in pt nach den Helvetica-Metriken (Umlaute über den Grundbuchstaben)
  const tab = bold ? PDF_W_BOLD : PDF_W_REG;
  let w = 0;
  for (const ch of pdfPlain(str)) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x20 && cp <= 0x7E) { w += tab[cp - 0x20]; continue; }
    if (!(cp >= 0xA0 && cp <= 0xFF) && !WINANSI[ch]) { w += tab[0x3F - 0x20]; continue; }   // nicht in WinAnsi: wird als „?“ gedruckt
    const base = ch.normalize("NFD").codePointAt(0);
    w += base >= 0x20 && base <= 0x7E ? tab[base - 0x20] : "„“”‚‘’".indexOf(ch) >= 0 ? (bold ? 500 : 333) : PDF_W_EXTRA[ch] || 611;
  }
  return w * size / 1000;
}

function pdfWrap(str, size, bold, maxW) {   // Zeilenumbruch an Leerzeichen; ein Wort länger als die Zeile (z. B. eine Adresse) wird hart getrennt
  const lines = [];
  for (const para of String(str).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + " " + word : word;
      if (!line || pdfWidth(t, size, bold) <= maxW) { line = t; if (pdfWidth(line, size, bold) <= maxW) continue; }
      else { lines.push(line); line = word; if (pdfWidth(word, size, bold) <= maxW) continue; }
      let part = "";   // überlanges Wort (steht allein in `line`) zeichenweise aufteilen
      for (const ch of line) { if (part && pdfWidth(part + ch, size, bold) > maxW) { lines.push(part); part = ch; } else part += ch; }
      line = part;
    }
    lines.push(line);
  }
  return lines;
}

const pdfUtf16 = (str) => { let x = "<FEFF"; for (let i = 0; i < str.length; i++) x += str.charCodeAt(i).toString(16).padStart(4, "0"); return x + ">"; };   // Info-Texte (PDFDocEncoding ≠ WinAnsi)

const latin1 = (str) => { const u = new Uint8Array(str.length); for (let i = 0; i < str.length; i++) u[i] = str.charCodeAt(i) & 0xFF; return u; };

async function deflateBytes(u8) {   // zlib-Format = FlateDecode; ohne CompressionStream bleibt der Datensatz unkomprimiert
  if (typeof CompressionStream !== "function") return null;
  try { return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer()); } catch (e) { return null; }
}

async function pdfJpeg(blob) {
  const src = await decodeImage(blob);
  try {
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    if (!(sw > 0 && sh > 0)) throw new Error("decode");
    const sc = Math.min(1, 1400 / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * sc)), hh = Math.max(1, Math.round(sh * sc));
    const cv = document.createElement("canvas"); cv.width = w; cv.height = hh;
    const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, hh); ctx.drawImage(src, 0, 0, w, hh);
    const out = await new Promise((res) => cv.toBlob(res, "image/jpeg", 0.85));
    if (!out) throw new Error("jpeg");
    return { data: new Uint8Array(await out.arrayBuffer()), w, h: hh, sw, sh };
  } finally {
    if (src.close) { try { src.close(); } catch (e) { /* egal */ } }
    if (src._url) URL.revokeObjectURL(src._url);
  }
}

async function decodeImage(file) {   // ImageBitmap (mit EXIF-Drehung) oder <img> als Rückfall (z. B. SVG)
  if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (e) { /* Rückfall */ } }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img._url = url;
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("decode")); }; img.src = url; });
  return img;
}

const UMLAUTS = { "ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss" };

const pdfAscii = (str) => String(str).normalize("NFC").replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c]).replace(/[–—]/g, "-")
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "_");

const ANALOG_LINES = 8, ANALOG_LINE_PT = 24;   // Schreiblinien je Textaufgabe: Abstand 24 pt ≈ 8,5 mm (Handschrift etwa in Schriftgröße 14)
const ANALOG_PHOTO_PT = 220;   // Foto-Aufgabe: Rahmen zum Zeichnen oder Einkleben (≈ 7,8 cm hoch)
const ANALOG_ROW_PT = 2 * ANALOG_LINE_PT;      // Tabellenzeile: Platz für zwei Zeilen Handschrift
const ANALOG_QR_PT = 90;                       // Kantenlänge des QR-Codes samt Ruhezone (4 Module) – Checkliste und Videos
const ANALOG_URL_PT = 10;                      // Adresse eines Videos unter seinem QR-Code (Courier: 52 Zeichen ≈ 312 pt)
const ANALOG_LINK_RGB = "0.05 0.25 0.6";
let worldPdfCache = "";
function worldPdfPath() {   // alle Gebiete der Weltkarte als PDF-Pfad in SVG-Koordinaten (M/L/Z → m/l/h), einmal je Seitenaufruf
  if (!worldPdfCache) worldPdfCache = WORLD_MAP.countries.map((c) => c[2].replace(/([ML])(-?[\d.]+),(-?[\d.]+)/g, (_, k, x, y) => `${x} ${y} ${k === "M" ? "m" : "l"}\n`).replace(/Z/g, "h\n")).join("");
  return worldPdfCache;
}
// Adresse für den Druck so, wie die Adresszeile des Browsers sie zeigt: prozentkodierte Nicht-ASCII-Zeichen (Umlaute in
// Wikipedia-Adressen, „B%C3%BCrger“ → „Bürger“) lesbar – nur, wenn sie sich in WinAnsi drucken lassen und weder Leer-, Steuer- noch
// Formatzeichen sind; sonst bleibt das Stück kodiert. Kodierte ASCII-Zeichen (%20, %2F …) und Punycode-Hosts bleiben, wie sie sind.
// Die Link-Annotation behält die kodierte Adresse.
function analogHrefText(href) {
  return href.replace(/(?:%[89a-fA-F][0-9a-fA-F])+/g, (enc) => {
    let dec;
    try { dec = decodeURIComponent(enc); } catch (e) { return enc; }
    for (const ch of dec) {
      const cp = ch.codePointAt(0);
      if (!((cp >= 0xA0 && cp <= 0xFF) || WINANSI[ch]) || /[\p{Z}\p{Cc}\p{Cf}]/u.test(ch)) return enc;
    }
    return dec.normalize("NFC") === dec ? dec : enc;
  });
}
// Läufe einer formatierten Zeile (Material, Aufgabenstellung) für den Druck: Links werden zur Adresse (aufeinanderfolgende Läufe
// desselben Links nur einmal); f → b/i/u. Stoßen zwei Adressen oder eine Adresse und ein Wort ohne Leerraum aneinander (digital
// zwei getrennt anklickbare Linktexte), kommt ein Leerzeichen dazwischen – sonst sähe man auf Papier nicht, wo die Adresse endet.
// Nach einer Adresse gilt das für jeden Text außer Satzzeichen am Ende („[Wikipedia]-Artikel“ → „https://… -Artikel“, nie
// „https://…-Artikel“: „-“, „/“, „_“, „#“ … könnten zur Adresse gehören, und schwarz-weiß gedruckt fehlt die blaue Farbe).
const ANALOG_AFTER_URL = /^[.,;:!?)\]}»«“”’'"…]/u;   // dürfen ohne Leerzeichen auf eine Adresse folgen
function analogRuns(runs) {
  const out = [];
  let prevH = "";
  for (const r of runs) {
    const href = r.h || "";
    if (href && href === prevH) continue;
    prevH = href;
    const t = href ? analogHrefText(href) : r.t, last = out[out.length - 1];
    const glued = last && t && (href || last.h) && !/\s$/.test(last.t) && !/^\s/.test(t);   // Adresse stößt ohne Leerraum an
    if (glued && ((href && last.h) || (href ? /[\p{L}\p{N}]$/u.test(last.t) : !ANALOG_AFTER_URL.test(t))))
      out.push({ t: " ", b: false, i: false, u: false, h: "" });
    out.push({ t, b: r.f.includes("b"), i: r.f.includes("i"), u: !href && r.f.includes("u"), h: href });
  }
  return out;
}
// Läufe → Zeilen [{segs:[{t, b, i, u, h}], ind}]: Umbruch an Leerraum (Wörter dürfen über Laufgrenzen gehen), überlange Wörter
// (Adressen) hart getrennt; Leerraum am Zeilenanfang (eingerückter Text) wird zum Einzug aller Zeilen des Absatzes
function analogLines(runs, size, maxW) {
  const lead = /^[ \t ]*/.exec(runs.length ? runs[0].t : "")[0].replace(/\t/g, "    ");
  const ind = Math.min(maxW / 2, pdfWidth(" ", size, false) * lead.length), w = maxW - ind;
  const groups = [];
  let sp = false;
  for (const r of runs) for (const piece of r.t.split(/(\s+)/)) {
    if (!piece) continue;
    if (/^\s+$/.test(piece)) { sp = true; continue; }
    if (!groups.length || sp) groups.push({ sp: sp && groups.length > 0, parts: [] });
    sp = false;
    groups[groups.length - 1].parts.push({ t: piece, b: r.b, i: r.i, u: r.u, h: r.h });
  }
  const lines = [];
  let cur = [], cw = 0;
  const same = (a, b) => a.b === b.b && a.i === b.i && a.u === b.u && a.h === b.h;
  const add = (p) => { const last = cur[cur.length - 1]; if (last && same(last, p)) last.t += p.t; else cur.push(Object.assign({}, p)); };
  const flush = () => { lines.push({ segs: cur, ind }); cur = []; cw = 0; };
  for (const g of groups) {
    const gw = g.parts.reduce((s, p) => s + pdfWidth(p.t, size, p.b), 0), first = g.parts[0];
    const spw = cur.length && g.sp ? pdfWidth(" ", size, first.b && cur[cur.length - 1].b) : 0;
    if (cur.length && cw + spw + gw > w) flush();
    if (cur.length && g.sp) {   // Leerzeichen: fett, kursiv, unterstrichen bzw. verlinkt nur innerhalb einer durchgehenden Hervorhebung
      const prev = cur[cur.length - 1];
      add({ t: " ", b: prev.b && first.b, i: prev.i && first.i, u: prev.u && first.u, h: prev.h && prev.h === first.h ? prev.h : "" }); cw += spw;
    }
    if (cw + gw <= w) { g.parts.forEach(add); cw += gw; continue; }
    for (const p of g.parts) for (const ch of p.t) {   // zu lang für eine Zeile: zeichenweise
      const cwid = pdfWidth(ch, size, p.b);
      if (cur.length && cw + cwid > w) flush();
      add(Object.assign({}, p, { t: ch })); cw += cwid;
    }
  }
  if (cur.length || !lines.length) flush();
  return lines;
}
async function makeAnalogPdf(o) {
  const W = 595.28, H = 841.89, ML = 50, TW = W - 2 * ML, TOP = 56, BOTTOM = 60, MAXY = H - BOTTOM;
  const f2 = (v) => v.toFixed(2), code = normCode(o.code), title = String(o.title || "").trim() || "Feibeitsblatt";
  const pages = [];
  let pg = null, y = TOP, bar = null;   // bar: graue Linie links neben dem Material, solange es läuft {x, y0}
  const barDraw = (yEnd) => { if (bar && yEnd > bar.y0) pg.ops.push(`q 0.72 G 1.5 w ${f2(bar.x)} ${f2(H - bar.y0)} m ${f2(bar.x)} ${f2(H - yEnd)} l S Q`); };
  const newPage = () => {
    if (pg && bar) barDraw(Math.min(MAXY, y + 4));
    pg = { ops: [], ims: new Set(), links: [] }; pages.push(pg); y = TOP;
    if (bar) bar.y0 = y;
  };
  newPage();
  const fits = (need) => y + need <= MAXY;
  // /F5 = Courier (s.m): nur für die Adressen der Videos – YouTube-Kennungen unterscheiden Groß- und Kleinschreibung, in Helvetica sehen
  // „I“ und „l“ gleich aus; die Seite bekommt die Schrift nur, wenn sie sie nutzt (pg.mono)
  const font = (s) => (s.m ? "F5" : s.b ? (s.i ? "F4" : "F2") : s.i ? "F3" : "F1");
  const text = (x, base, str, size, s, color) => {
    if (s && s.m) pg.mono = true;
    pg.ops.push(`BT ${color || "0 0 0"} rg /${font(s || {})} ${size} Tf ${f2(x)} ${f2(H - base)} Td ${pdfStr(str)} Tj ET`);
  };
  const monoW = (str, size) => str.length * 0.6 * size;   // Courier: jedes Zeichen 600/1000 em (die Adressen sind reines ASCII)
  const link = (x0, base, x1, size, url) => pg.links.push({ r: [x0 - 1, H - base - size * 0.28, x1 + 1, H - base + size * 0.9], url });
  const drawLine = (line, x, base, size, color) => {
    let cx = x + line.ind;
    for (const s of line.segs) {
      const w = pdfWidth(s.t, size, s.b), col = s.h ? ANALOG_LINK_RGB : color || "0 0 0";
      text(cx, base, s.t, size, s, col);
      if (s.u && s.t.trim()) pg.ops.push(`q ${col} RG ${f2(size * 0.055)} w ${f2(cx)} ${f2(H - base - size * 0.13)} m ${f2(cx + w)} ${f2(H - base - size * 0.13)} l S Q`);
      if (s.h && s.t.trim()) link(cx, base, cx + w, size, s.h);
      cx += w;
    }
  };
  // Absätze aus Läufen setzen (Seitenumbruch zeilenweise); leere Absätze = halbe bzw. ganze Leerzeile
  const flow = (paras, size, opts = {}) => {
    const lh = opts.lh || Math.round(size * 1.38 * 10) / 10, x = ML + (opts.indent || 0), maxW = TW - (opts.indent || 0);
    for (const runs of paras) {
      if (!runs.some((r) => r.t.trim())) { y += opts.emptyGap != null ? opts.emptyGap : lh; if (y > MAXY) newPage(); continue; }
      for (const l of analogLines(runs, size, maxW)) {
        if (y + lh > MAXY) newPage();
        y += lh; drawLine(l, x, y, size, opts.color);
      }
    }
  };
  const plain = (str, size, opts = {}) => flow(String(str).split("\n").map((l) => [{ t: l, b: !!opts.bold, i: false, u: false, h: "" }]), size, opts);
  const hline = (x0, x1, yy, gray, lw) => pg.ops.push(`q ${gray} G ${lw} w ${f2(x0)} ${f2(H - yy)} m ${f2(x1)} ${f2(H - yy)} l S Q`);
  const image = (sh, x, top, dw, dh) => {
    const name = "Im" + sh.n;
    pg.ims.add(sh);
    pg.ops.push(`q ${f2(dw)} 0 0 ${f2(dh)} ${f2(x)} ${f2(H - top - dh)} cm /${name} Do Q`);
    pg.ops.push(`q 0.78 0.78 0.78 RG 0.5 w ${f2(x)} ${f2(H - top - dh)} ${f2(dw)} ${f2(dh)} re S Q`);
  };
  let imgNo = 0;
  const shown = (id) => { const sh = o.shows && o.shows.get(id); if (sh && !sh.n) sh.n = ++imgNo; return sh || null; };
  const sizeOf = (sh, maxW, maxH) => { const pw = sh.sw * 0.75, ph = sh.sh * 0.75, sc = Math.min(1, maxW / pw, maxH / ph); return [pw * sc, ph * sc]; };   // 96 dpi → pt
  // QR-Code q (aus qrMatrix) bei x (linke Kante der Ruhezone), top, Kantenlänge side samt Ruhezone: Module als Rechtecke in
  // Modul-Einheiten, Ruhezone 4 Module; dazu ein Link über die ganze Fläche – für die Checkliste und die Videos dasselbe Format
  const qrDraw = (q, url, x, top, side) => {
    const mod = side / (q.size + 8), rects = [];
    for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) {
      if (!q.dark[r * q.size + c] || (c > 0 && q.dark[r * q.size + c - 1])) continue;
      let len = 1; while (c + len < q.size && q.dark[r * q.size + c + len]) len++;
      rects.push(`${c + 4} ${r + 4} ${len} 1 re`);
    }
    pg.ops.push(`q 0 g ${mod.toFixed(5)} 0 0 ${(-mod).toFixed(5)} ${f2(x)} ${f2(H - top)} cm\n${rects.join("\n")}\nf\nQ`);
    pg.links.push({ r: [x, H - top - side, x + side, H - top], url });
  };
  // YouTube-Video (aus cleanVideos) → Block zum Zeichnen: QR-Code (ANALOG_QR_PT) zum kanonischen Link youtubeUrl(v) – nie die Eingabe der
  // Lehrkraft, so bleibt es bei Version 4 –, die Ruhezone links im Seitenrand; rechts daneben fett „Video auf YouTube (Google)“, der Titel,
  // die Startzeit und ein Satz; unter dem QR-Code (unterhalb der Ruhezone) die Adresse in Courier. need = Höhe des ganzen Blocks (unteilbar)
  const run1 = (t, b) => [{ t, b: !!b, i: false, u: false, h: "" }];
  const analogVideo = (v) => {
    const url = youtubeUrl(v), q = qrMatrix(url), mod = ANALOG_QR_PT / (q.size + 8), qx = ML - 4 * mod, tx = qx + ANALOG_QR_PT + 10, tw = ML + TW - tx;
    const lines = (str, size, lh, color, b) => analogLines(run1(str, b), size, tw).map((l) => ({ l, size, lh, color }));
    const start = videoStartSec(v), right = [...lines("Video auf YouTube (Google)", 10.5, 14.5, "0.1 0.1 0.1", true),
      ...(v.title ? lines(v.title, 10.5, 14.5, "0.1 0.1 0.1") : []), ...(start ? lines("ab " + fmtVideoStart(start), 10, 14, "0.35 0.35 0.35") : []),
      ...lines("Scanne den QR-Code oder gib die Adresse unter dem Code ein.", 9.5, 13, "0.35 0.35 0.35")];
    const rightTop = 4 * mod - 6.5, rightEnd = rightTop + right.reduce((s, r) => s + r.lh, 0);   // erste Grundlinie rechts ≈ Oberkante der dunklen Module
    // Adresse unter dem QR-Code; reicht die rechte Spalte tiefer (sehr breiter Titel), rückt sie darunter – nie über den Text rechts
    const urlBase = Math.max(ANALOG_QR_PT + 11, rightEnd + 13);
    const urlPt = Math.min(ANALOG_URL_PT, TW / Math.max(1, monoW(url, 1)));   // passt immer (≤ 52 Zeichen); nur zur Sicherheit
    return { url, q, qx, tx, right, rightTop, urlBase, urlPt, need: urlBase + 4 };
  };
  const drawVideo = (vb) => {
    const top = y;
    qrDraw(vb.q, vb.url, vb.qx, top, ANALOG_QR_PT);
    let yy = top + vb.rightTop;
    vb.right.forEach((r) => { yy += r.lh; drawLine(r.l, vb.tx, yy, r.size, r.color); });
    text(ML, top + vb.urlBase, vb.url, vb.urlPt, { m: true }, ANALOG_LINK_RGB);
    link(ML, top + vb.urlBase, ML + monoW(vb.url, vb.urlPt), vb.urlPt, vb.url);
    y = top + vb.need;
  };

  // Kopf: Titel, Hinweiskasten, Name/Klasse/Datum
  plain(title, 18, { bold: true, lh: 23 });
  y += 14;
  {
    const pad = 12, bsz = 10.5, blh = 14.5, url = PUBLIC_URL;
    const runs = [{ t: "Du kannst dieses Arbeitsblatt mit dem Code ", b: false, i: false, u: false, h: "" }, { t: fmtCode(code), b: true, i: false, u: false, h: "" },
      { t: " auch digital auf ", b: false, i: false, u: false, h: "" }, { t: url, b: false, i: false, u: false, h: url }, { t: " aufrufen.", b: false, i: false, u: false, h: "" }];
    if (o.aiNote) runs.push({ t: " Dort steht dir eine KI-Rückmeldung zu deinen Antworten zur Verfügung, die es auf dem Papier nicht gibt.", b: false, i: false, u: false, h: "" });
    const lines = analogLines(runs, bsz, TW - 2 * pad), bh = lines.length * blh + 2 * pad - 3;
    pg.ops.push(`0.93 0.96 1 rg 0 0.29 0.6 RG 1 w ${f2(ML)} ${f2(H - y - bh)} ${f2(TW)} ${f2(bh)} re B`);
    lines.forEach((l, k) => drawLine(l, ML + pad, y + pad + 8 + k * blh, bsz, "0.1 0.15 0.25"));
    y += bh + 30;
    // Name ________  Klasse ______  Datum ________ (Linien gezeichnet; die Namenslinie füllt den Rest)
    const fs = 11, items = [["Name:", 0], ["Klasse:", 80], ["Datum:", 100]], gapX = 22;
    const fixed = items.reduce((s, [l, w]) => s + pdfWidth(l, fs, true) + 6 + w, 0) + 2 * gapX;
    let x = ML;
    items.forEach(([label, w], k) => {
      const lw = w || TW - fixed;
      text(x, y, label, fs, { b: true });
      x += pdfWidth(label, fs, true) + 6;
      hline(x, x + lw, y + 2, "0.35", 0.6);
      x += lw + (k < items.length - 1 ? gapX : 0);
    });
    y += 8;
  }

  const tasks = Array.isArray(o.tasks) ? o.tasks : [];
  tasks.forEach((t, i) => {
    const n = i + 1, spec = cleanAnswer(t.answer, true);
    const fmt = cleanMaterial(t.textFmt);
    const paras = fmt.length ? fmt.map(analogRuns) : String(t.text || "").replace(/\r/g, "").split("\n").map((l) => [{ t: l, b: false, i: false, u: false, h: "" }]);
    const imgs = cleanImages(t.images), thumbs = imgs.filter((m) => m.mode !== "inline").map((m) => shown(m.id)).filter(Boolean);
    const figs = imgs.filter((m) => m.mode === "inline").map((m) => shown(m.id)).filter(Boolean);
    const mat = cleanMaterial(t.material).map(analogRuns), files = cleanFiles(t.files), vids = cleanVideos(t.videos).map(analogVideo);
    const filesLine = `Material zum Herunterladen (nur digital): ${files.map((f) => f.name).join(", ")}`;
    // Überschrift und Aufgabenstellung bleiben mit dem ersten Block danach zusammen, der sich nicht teilen lässt (erste Bilderreihe, großes
    // Bild, Anfang des Materials, erstes Video, Dateinamen oder Anfang des Antwortbereichs): passt das nicht mehr auf die Seite, wohl aber auf eine neue,
    // beginnt die Aufgabe auf einer neuen Seite – sonst stünde z. B. die Überschrift allein über einer Lücke, weil die Karte nicht mehr passt
    const parasH = (ps, size, lh, maxW) => ps.reduce((sum, runs) => sum + (runs.some((r) => r.t.trim()) ? analogLines(runs, size, maxW).length * lh : lh), 0);
    let firstRow = 0;
    for (const [k, sh] of thumbs.entries()) { const [dw, dh] = sizeOf(sh, Math.min(TW, 220), 190); if (k && thumbs.slice(0, k).reduce((x, s2) => x + sizeOf(s2, Math.min(TW, 220), 190)[0] + 10, 0) + dw > TW) break; firstRow = Math.max(firstRow, dh); }
    const firstBlock = thumbs.length ? 10 + firstRow : figs.length ? 10 + sizeOf(figs[0], TW, 330)[1] : mat.length ? 12 + 13 + 14.5
      : vids.length ? 12 + vids[0].need : files.length ? 10 + 13.5 : spec.type === "table" ? 10 + tableHead(spec).hh + ANALOG_ROW_PT : spec.type === "map" ? 10 + TW * WORLD_MAP.h / WORLD_MAP.w : spec.type === "photo" ? 10 + ANALOG_PHOTO_PT : 6 + 3 * ANALOG_LINE_PT + 4;
    const est = 20 + parasH(paras, 11, 15.2, TW) + firstBlock;
    y += 18;
    if (y + est > MAXY && TOP + est <= MAXY) newPage();
    else if (!fits(18 + 15.2 + 4)) newPage();   // mindestens: Überschrift und erste Zeile der Aufgabenstellung zusammen
    plain("Aufgabe " + n, 13, { bold: true, lh: 18 });
    y += 2;
    flow(paras, 11, { lh: 15.2, color: "0.08 0.08 0.08" });
    // Bilder: Miniaturen nebeneinander (≤ 220 × 190 pt), große Bilder einzeln (≤ Breite × 330 pt) – Größen wie in der Sicherung
    if (thumbs.length) {
      y += 10;
      let x = ML, rowH = 0;
      for (const sh of thumbs) {
        const [dw, dh] = sizeOf(sh, Math.min(TW, 220), 190);
        if (x > ML && x + dw > ML + TW) { y += rowH + 10; x = ML; rowH = 0; }
        if (!fits(dh)) { newPage(); x = ML; rowH = 0; }
        image(sh, x, y, dw, dh);
        x += dw + 10; rowH = Math.max(rowH, dh);
      }
      y += rowH;
    }
    for (const sh of figs) {
      const [dw, dh] = sizeOf(sh, TW, 330);
      y += 10;
      if (!fits(dh)) newPage();
      image(sh, ML, y, dw, dh);
      y += dh;
    }
    // Material: Beschriftung, graue Linie links, Text mit Formatierung (Links als Adresse)
    if (mat.length) {
      y += 12;
      if (!fits(14 + 14.5)) newPage();
      bar = { x: ML + 1, y0: y + 2 };
      flow([[{ t: "Material", b: true, i: false, u: false, h: "" }]], 10, { lh: 13, indent: 12, color: "0.35 0.35 0.35" });
      flow(mat, 10.5, { lh: 14.5, indent: 12, color: "0.15 0.15 0.15", emptyGap: 7 });
      barDraw(y + 4); bar = null;
    }
    // YouTube-Videos: nach dem Material, aber nicht mehr neben seiner grauen Linie (sie schnitte durch die Ruhezone im Rand); je Video unteilbar
    for (const vb of vids) {
      y += 12;
      if (!fits(vb.need)) newPage();
      drawVideo(vb);
    }
    if (files.length) {
      y += 10;
      plain(filesLine, 10, { lh: 13.5, color: "0.35 0.35 0.35" });
    }
    // Platz für die Antwort
    if (spec.type === "table") analogTable(spec);
    else if (spec.type === "map") analogMap(spec, t);
    else if (spec.type === "photo") analogPhoto();
    else {
      y += 6;
      if (!fits(3 * ANALOG_LINE_PT + 4)) newPage();   // mindestens 3 Linien auf dieser Seite, die übrigen dürfen weitergehen
      for (let k = 0; k < ANALOG_LINES; k++) {
        if (y + ANALOG_LINE_PT > MAXY + 4) newPage();
        y += ANALOG_LINE_PT;
        hline(ML, ML + TW, y, "0.6", 0.5);
      }
    }
  });

  // Tabelle: Gitter über die volle Breite, gleiche Spalten, grauer Kopf (auf jeder Seite wiederholt), je Zeile zwei Schreibzeilen
  // Kopf: fett 10 pt; passt ein Wort nicht in seine Spalte, wird die Schrift schrittweise kleiner (bis 7 pt) – erst darunter wird ein
  // Wort getrennt, dann mit „-“ am Zeilenende. Umbrochen wird an Leerraum und nach „-“ bzw. „/“ in einem Wort.
  function tableHead(spec) {
    const cols = spec.columns, cw = TW / cols.length, pad = 5, maxW = cw - 2 * pad;
    const words = cols.map((c) => String(c).split(/\s+/).filter(Boolean).map((w) => w.split(/(?<=[-\/])(?=.)/)));
    const widest = (hs) => Math.max(0, ...words.flat(2).map((p) => pdfWidth(p, hs, true)));
    let hs = 10;
    while (hs > 7 && widest(hs) > maxW) hs -= 0.5;
    const W = (str) => pdfWidth(str, hs, true);
    const lines = words.map((ws) => {
      const out = [];
      let line = "";
      ws.forEach((parts) => parts.forEach((p, j) => {
        const t = line ? line + (j ? "" : " ") + p : p;
        if (W(t) <= maxW) { line = t; return; }
        if (line) out.push(line);
        let chars = Array.from(p);
        while (chars.length > 1 && W(chars.join("")) > maxW) {   // auch in 7 pt zu breit: mit „-“ trennen
          let k = 1;
          while (k < chars.length - 1 && W(chars.slice(0, k + 1).join("") + "-") <= maxW) k++;
          out.push(chars.slice(0, k).join("") + "-"); chars = chars.slice(k);
        }
        line = chars.join("");
      }));
      out.push(line);
      return out;
    });
    const lh = Math.round(hs * 1.25 * 10) / 10;
    return { cw, pad, hs, lh, lines, hh: Math.max(22, Math.max(...lines.map((l) => l.length)) * lh + 8) };
  }
  function analogTable(spec) {
    const cols = spec.columns, { cw, pad, hs, lh: hlh, lines: heads, hh } = tableHead(spec);
    y += 10;
    if (!fits(hh + ANALOG_ROW_PT)) newPage();
    let top = y, bottoms = [];
    const head = () => {
      pg.ops.push(`q 0.92 g ${f2(ML)} ${f2(H - y - hh)} ${f2(TW)} ${f2(hh)} re f Q`);
      heads.forEach((ls, k) => ls.forEach((l, j) => text(ML + k * cw + pad, y + pad + hs * 0.8 + j * hlh, l, hs, { b: true }, "0.1 0.1 0.1")));
      y += hh; bottoms = [y];
    };
    const grid = () => {   // Rahmen, Spaltenlinien, Linie unter dem Kopf und unter jeder Zeile
      const ops = [`q 0.35 G 0.6 w ${f2(ML)} ${f2(H - y)} ${f2(TW)} ${f2(y - top)} re S`];
      for (let k = 1; k < cols.length; k++) ops.push(`${f2(ML + k * cw)} ${f2(H - top)} m ${f2(ML + k * cw)} ${f2(H - y)} l S`);
      for (const b of bottoms.slice(0, -1)) ops.push(`${f2(ML)} ${f2(H - b)} m ${f2(ML + TW)} ${f2(H - b)} l S`);
      pg.ops.push(ops.join(" ") + " Q");
    };
    head();
    for (let r = 0; r < spec.rows; r++) {
      if (y + ANALOG_ROW_PT > MAXY) { grid(); newPage(); top = y; head(); }
      hline(ML, ML + TW, y + ANALOG_LINE_PT, "0.8", 0.4);   // helle Hilfslinie zwischen den beiden Schreibzeilen
      y += ANALOG_ROW_PT; bottoms.push(y);
    }
    grid();
  }
  // Foto: auf Papier ein Rahmen über die volle Breite – digital nehmen die Schüler:innen ein Foto auf
  function analogPhoto() {
    y += 10;
    if (!fits(ANALOG_PHOTO_PT)) newPage();
    pg.ops.push(`q 0.35 G 0.6 w ${f2(ML)} ${f2(H - y - ANALOG_PHOTO_PT)} ${f2(TW)} ${f2(ANALOG_PHOTO_PT)} re S Q`);
    text(ML + 8, y + 15, "Hier kannst du zeichnen oder ein Foto einkleben.", 9.5, {}, "0.42 0.42 0.42");
    y += ANALOG_PHOTO_PT;
  }
  // Weltkarte: Umrisskarte (alle Gebiete, ohne Beschriftung) über die volle Breite, darunter die Karten mit Linie für das Land
  function analogMap(spec, t) {
    const s = TW / WORLD_MAP.w, mh = WORLD_MAP.h * s;
    y += 10;
    if (!fits(mh)) newPage();
    pg.wm = true;   // die Umrisse stehen einmal im PDF (Form-XObject /Wm in SVG-Koordinaten), jede Karte verweist darauf
    pg.ops.push(`q ${s.toFixed(5)} 0 0 ${s.toFixed(5)} ${f2(ML)} ${f2(H - y - mh)} cm /Wm Do Q`);
    pg.ops.push(`q 0.35 G 0.6 w ${f2(ML)} ${f2(H - y - mh)} ${f2(TW)} ${f2(mh)} re S Q`);
    y += mh + 4;
    const known = new Set(cleanImages(t.images, true).map((m) => m.id)), colW = (TW - 24) / 2;
    // zwei Spalten; je Zeile stehen die Linien „Land:“ auf gleicher Höhe, und jede Karte bleibt auf einer Seite zusammen
    const LAND = 24;
    const item = (it, k, x, top, landY) => {   // landY = null: nur messen → Höhe ohne die Zeile „Land:“
      let yy = top;
      const numW = pdfWidth(`${k + 1}. `, 11, true), lw = colW - numW, draw = landY != null;
      pdfWrap(it.label, 11, true, lw).forEach((l, j) => { yy += 15; if (draw) { if (!j) text(x, yy, `${k + 1}.`, 11, { b: true }); text(x + numW, yy, l, 11, { b: true }); } });
      if (it.hint) pdfWrap(it.hint, 9.5, false, lw).forEach((l) => { yy += 12.5; if (draw) text(x + numW, yy, l, 9.5, {}, "0.42 0.42 0.42"); });
      const sh = it.image && known.has(it.image) ? shown(it.image) : null;
      if (sh) { const [dw, dh] = sizeOf(sh, lw, 60); yy += 6; if (draw) image(sh, x + numW, yy, dw, dh); yy += dh; }
      if (draw) {
        const lab = "Land:", lx = x + numW + pdfWidth(lab, 10.5, false) + 6;
        text(x + numW, landY, lab, 10.5, {}, "0.25 0.25 0.25");
        hline(lx, x + colW, landY + 2, "0.6", 0.5);
      }
      return yy - top;
    };
    const pairH = (k) => Math.max(...spec.items.slice(k, k + 2).map((it, j) => item(it, k + j, 0, 0, null))) + LAND + 8;
    // der Satz bleibt mit dem ersten Kartenpaar zusammen – nie allein unten auf der Seite, während die Liste erst auf der nächsten beginnt
    if (!fits(16 + 4 + pairH(0))) newPage();
    plain("Schreibe zu jeder Karte das passende Land.", 10.5, { lh: 16, color: "0.2 0.2 0.2" });
    y += 4;
    for (let k = 0; k < spec.items.length; k += 2) {
      const pair = spec.items.slice(k, k + 2), hgt = pairH(k), body = hgt - LAND - 8;
      if (!fits(hgt)) newPage();
      pair.forEach((it, j) => item(it, k + j, ML + j * (colW + 24), y, y + body + LAND));
      y += hgt + 6;
    }
  }

  // Checkliste: QR-Code (Module als Rechtecke in Modul-Einheiten, Ruhezone 4 Module) mit Erklärung und Adresse – zusammen auf einer Seite
  if (o.checkUrl) {
    // die Ruhezone links liegt im Seitenrand: die dunklen Module fluchten mit dem Text darüber
    const q = qrMatrix(o.checkUrl), mod = ANALOG_QR_PT / (q.size + 8), qx = ML - 4 * mod, tx = qx + ANALOG_QR_PT + 10, tw = ML + TW - tx;
    const expl = analogLines([{ t: "Scanne den QR-Code. Dort kannst du für jede Aufgabe abhaken, ob deine Antwort die Erwartungen erfüllt.", b: false, i: false, u: false, h: "" }], 10.5, tw);
    const addr = analogLines([{ t: o.checkUrl, b: false, i: false, u: false, h: o.checkUrl }], 9, tw);
    const need = 18 + 6 + Math.max(ANALOG_QR_PT, 12 + expl.length * 14.5 + 6 + addr.length * 12);
    y += 26;
    if (!fits(need)) newPage();
    plain("Checkliste", 13, { bold: true, lh: 18 });
    y += 6;
    const top = y;
    qrDraw(q, o.checkUrl, qx, top, ANALOG_QR_PT);
    let yy = top + 4;
    expl.forEach((l) => { yy += 14.5; drawLine(l, tx, yy, 10.5, "0.1 0.1 0.1"); });
    yy += 6;
    addr.forEach((l) => { yy += 12; drawLine(l, tx, yy, 9, "0.3 0.3 0.3"); });
    y = Math.max(top + ANALOG_QR_PT, yy + 4);
  }

  while (pages.length > 1 && !pages[pages.length - 1].ops.length) pages.pop();   // kein leeres Blatt am Ende
  // Fußzeile: links Code und Titel (nach Breite gekürzt), rechts „Seite n von N“
  const total = pages.length, fs = 8.5, left = (tt) => `Feibeitsblatt ${fmtCode(code)} · ${tt}`;
  const room = TW - pdfWidth(`Seite ${total} von ${total}`, fs, false) - 20;
  let short = title;
  if (pdfWidth(left(short), fs, false) > room) { while (short.length > 1 && pdfWidth(left(short + "…"), fs, false) > room) short = short.slice(0, -1); short = short.trimEnd() + "…"; }
  pages.forEach((p, k) => {
    const right = `Seite ${k + 1} von ${total}`;
    p.ops.push(`BT 0.45 0.45 0.45 rg /F1 ${fs} Tf ${f2(ML)} 34 Td ${pdfStr(left(short))} Tj ET`);
    p.ops.push(`BT 0.45 0.45 0.45 rg /F1 ${fs} Tf ${f2(W - ML - pdfWidth(right, fs, false))} 34 Td ${pdfStr(right)} Tj ET`);
  });
  // Objekte: 1 Katalog, 2 Seitenbaum, 3–6 Schriften, 7 Info, dann Courier (nur mit Videos – nach Info, die Nummern davor bleiben),
  // die Bilder, je Seite Seite + Inhalt + Links
  const ims = [...new Set(pages.flatMap((p) => [...p.ims]))];
  let next = 8;
  const monoObj = pages.some((p) => p.mono) ? next++ : 0;
  const imObj = new Map(ims.map((sh) => [sh, next++])), wmObj = pages.some((p) => p.wm) ? next++ : 0;
  const pgs = pages.map((p) => ({ ...p, obj: next++, content: next++, annots: p.links.map(() => next++) }));
  const count = next, parts = [], offsets = [];
  let pos = 0;
  const push = (x) => { const b = typeof x === "string" ? latin1(x) : x; parts.push(b); pos += b.length; };
  const obj = (num, body) => { offsets[num] = pos; push(`${num} 0 obj\n`); (Array.isArray(body) ? body : [body]).forEach(push); push("\nendobj\n"); };
  const t0 = new Date(), stamp = `${t0.getFullYear()}${pad2(t0.getMonth() + 1)}${pad2(t0.getDate())}${pad2(t0.getHours())}${pad2(t0.getMinutes())}${pad2(t0.getSeconds())}`;
  push("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pgs.map((p) => p.obj + " 0 R").join(" ")}] /Count ${pgs.length} >>`);
  ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique"].forEach((f, k) => obj(3 + k, `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`));
  obj(7, `<< /Title ${pdfUtf16(title + " – Arbeitsblatt")} /Subject ${pdfUtf16("Feibeitsblatt " + fmtCode(code) + " zum Ausdrucken")} /Producer (Feibeitsblatt) /CreationDate (D:${stamp}) >>`);
  if (monoObj) obj(monoObj, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
  for (const sh of ims) obj(imObj.get(sh), [`<< /Type /XObject /Subtype /Image /Width ${sh.w} /Height ${sh.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${sh.data.length} >>\nstream\n`, sh.data, "\nendstream"]);
  if (wmObj) {   // Weltkarte: y gespiegelt (SVG zählt nach unten), Gebiete weiß gefüllt, Grenzen 0,3 pt grau (bei der Breite TW)
    const raw = latin1(`1 0 0 -1 0 ${WORLD_MAP.h} cm 1 g 0.5 G ${(0.3 * WORLD_MAP.w / TW).toFixed(3)} w 1 j\n${worldPdfPath()}B`), packed = await deflateBytes(raw), data = packed || raw;
    obj(wmObj, [`<< /Type /XObject /Subtype /Form /BBox [0 0 ${WORLD_MAP.w} ${WORLD_MAP.h}]${packed ? " /Filter /FlateDecode" : ""} /Length ${data.length} >>\nstream\n`, data, "\nendstream"]);
  }
  for (const p of pgs) {
    const xs = [...p.ims].map((sh) => `/Im${sh.n} ${imObj.get(sh)} 0 R`).concat(p.wm ? [`/Wm ${wmObj} 0 R`] : []).join(" ");
    obj(p.obj, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R${p.mono ? ` /F5 ${monoObj} 0 R` : ""} >>${xs ? ` /XObject << ${xs} >>` : ""} >> /Contents ${p.content} 0 R` +
      (p.annots.length ? ` /Annots [${p.annots.map((a) => a + " 0 R").join(" ")}]` : "") + " >>");
    const raw = latin1(p.ops.join("\n")), packed = await deflateBytes(raw), data = packed || raw;
    obj(p.content, [`<<${packed ? " /Filter /FlateDecode" : ""} /Length ${data.length} >>\nstream\n`, data, "\nendstream"]);
    p.links.forEach((l, k) => obj(p.annots[k], `<< /Type /Annot /Subtype /Link /Rect [${l.r.map(f2).join(" ")}] /Border [0 0 0] /A << /S /URI /URI ${pdfStr(l.url)} >> >>`));
  }
  const xref = pos;
  let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let k = 1; k < count; k++) x += String(offsets[k]).padStart(10, "0") + " 00000 n \n";
  push(x + `trailer\n<< /Size ${count} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(pos); let off = 0;
  for (const b of parts) { out.set(b, off); off += b.length; }
  return out;
}

const analogPdfName = (code, title) => {   // „Feibeitsblatt-Arbeitsblatt-K7Q-M4X-Titel.pdf“ – Titel nur ASCII wie bei der Sicherung
  const t = pdfAscii(title || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 60).trim().replace(/^\.+/, "");
  return `Feibeitsblatt-Arbeitsblatt-${fmtCode(code)}${t ? "-" + t : ""}.pdf`;
};

/* QR:BEGIN – reine Funktionen ohne Abhängigkeiten (test/unit/qr.test.mjs liest diesen Block) */
const QR_MAX_VERSION = 10;
// Stufe M je Version (Index = Version): Codewörter insgesamt und [Fehlerkorrektur-Codewörter je Block, Zahl der Blöcke]
// (ISO/IEC 18004, Tabelle 9); bei ungleicher Teilung haben die letzten Blöcke ein Datencodewort mehr
const QR_TOTAL = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
const QR_EC_M = [null, [10, 1], [16, 1], [26, 1], [18, 2], [24, 2], [16, 4], [18, 4], [22, 4], [22, 5], [26, 5]];
// Mittelpunkte der Ausrichtungsmuster (Zeilen wie Spalten; Anhang E), außer dort, wo ein Suchmuster liegt
const QR_ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
// Masken 0–7 (i = Zeile, j = Spalte): true = Datenmodul umkehren
const QR_MASKS = [
  (i, j) => (i + j) % 2 === 0,
  (i) => i % 2 === 0,
  (i, j) => j % 3 === 0,
  (i, j) => (i + j) % 3 === 0,
  (i, j) => (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0,
  (i, j) => (i * j) % 2 + (i * j) % 3 === 0,
  (i, j) => ((i * j) % 2 + (i * j) % 3) % 2 === 0,
  (i, j) => ((i + j) % 2 + (i * j) % 3) % 2 === 0,
];
function qrDataCodewords(v) { return QR_TOTAL[v] - QR_EC_M[v][0] * QR_EC_M[v][1]; }
/* so viele Bytes passen in Version v: davor 4 Bit Modus und die Zeichenzahl (8 Bit bis Version 9, dann 16) */
function qrCapacity(v) { return Math.floor((qrDataCodewords(v) * 8 - 4 - (v < 10 ? 8 : 16)) / 8); }
/* Multiplikation in GF(256) mit dem Polynom x^8 + x^4 + x^3 + x^2 + 1 (0x11D) */
function qrMul(a, b) {
  let r = 0;
  for (let i = 7; i >= 0; i--) { r = (r << 1) ^ ((r >>> 7) * 0x11d); if ((b >>> i) & 1) r ^= a; }
  return r;
}
/* n Fehlerkorrektur-Codewörter (Reed-Solomon): Rest von data · x^n geteilt durch den Generator (x − α^0) … (x − α^(n−1)), α = 2 */
function qrRsEcc(data, n) {
  const g = new Uint8Array(n);   // Generator ohne die führende 1, höchste Potenz zuerst; anfangs das Polynom 1
  g[n - 1] = 1;
  for (let i = 0, root = 1; i < n; i++, root = qrMul(root, 2))
    for (let j = 0; j < n; j++) g[j] = qrMul(g[j], root) ^ (j + 1 < n ? g[j + 1] : 0);
  const r = new Uint8Array(n);
  for (const b of data) {
    const f = b ^ r[0];
    r.copyWithin(0, 1); r[n - 1] = 0;
    for (let j = 0; j < n; j++) r[j] ^= qrMul(g[j], f);
  }
  return r;
}
/* Format-Info (15 Bit): Stufe M (00) und Maske, BCH(15,5) mit dem Generator 0x537, dann XOR 0x5412 */
function qrFormatBits(mask) {
  const d = mask & 7; let r = d << 10;
  for (let i = 14; i >= 10; i--) if ((r >>> i) & 1) r ^= 0x537 << (i - 10);
  return ((d << 10) | r) ^ 0x5412;
}
/* Versions-Info ab Version 7 (18 Bit): Version (6 Bit), BCH(18,6) mit dem Generator 0x1F25 */
function qrVersionBits(v) {
  let r = v << 12;
  for (let i = 17; i >= 12; i--) if ((r >>> i) & 1) r ^= 0x1f25 << (i - 12);
  return (v << 12) | r;
}
/* beide Stellen [x, y] von Bit i (0 = niederwertigstes) der Format-Info: um das Suchmuster oben links (Spalte 8 von oben, dann
   Zeile 8 nach links, Taktmuster ausgelassen) und geteilt – Bits 0–7 unter dem oben rechts, Bits 8–14 neben dem unten links */
function qrFormatCells(size, i) {
  return [i < 6 ? [8, i] : i < 8 ? [8, i + 1] : i === 8 ? [7, 8] : [14 - i, 8], i < 8 ? [size - 1 - i, 8] : [8, size - 15 + i]];
}
/* Funktionsmuster der Version v: dark (1 = dunkel) und fn (1 = kein Datenmodul); die Format-Info wird nur freigehalten */
function qrBase(v) {
  const size = 17 + 4 * v, dark = new Uint8Array(size * size), fn = new Uint8Array(size * size);
  const set = (x, y, d) => { dark[y * size + x] = d ? 1 : 0; fn[y * size + x] = 1; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }   // Taktmuster in Zeile und Spalte 6
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]])                          // Suchmuster 7 × 7 mit hellem Rand (Separator)
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  const al = QR_ALIGN[v], last = al.length - 1;                                             // Ausrichtungsmuster 5 × 5
  for (let a = 0; a <= last; a++) for (let b = 0; b <= last; b++) {
    if ((a === 0 && b === 0) || (a === 0 && b === last) || (a === last && b === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(al[b] + dx, al[a] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  for (let i = 0; i < 15; i++) for (const [x, y] of qrFormatCells(size, i)) set(x, y, 0);
  set(8, size - 8, 1);                                                                      // dunkles Modul
  if (v >= 7) {                                                                             // Versions-Info oben rechts und unten links (6 × 3)
    const bits = qrVersionBits(v);
    for (let i = 0; i < 18; i++) { const a = size - 11 + i % 3, b = Math.floor(i / 3), d = (bits >>> i) & 1; set(a, b, d); set(b, a, d); }
  }
  return { size, dark, fn };
}
/* Bytes → Codewörter der Version v in Sendereihenfolge: Modus 0100 (Byte), Zeichenzahl, Daten, Endmarke (bis 4 Nullbits),
   auffüllen bis zur Bytegrenze, Füllbytes 0xEC/0x11; auf die Blöcke verteilt, je Block die Fehlerkorrektur, dann verschränkt
   (erst die Datencodewörter aller Blöcke reihum, dann ebenso die Fehlerkorrektur) */
function qrCodewords(bytes, v) {
  const [ec, nb] = QR_EC_M[v], total = QR_TOTAL[v], nData = total - ec * nb, data = new Uint8Array(nData);
  let bit = 0;
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--, bit++) if ((val >>> i) & 1) data[bit >>> 3] |= 0x80 >>> (bit & 7); };
  put(4, 4); put(bytes.length, v < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  bit += Math.min(4, nData * 8 - bit);
  for (let k = (bit + 7) >>> 3, p = 0xec; k < nData; k++, p ^= 0xec ^ 0x11) data[k] = p;
  const short = Math.floor(total / nb) - ec, nShort = nb - total % nb, blocks = [], ecs = [];
  for (let b = 0, o = 0; b < nb; b++) {
    const len = short + (b < nShort ? 0 : 1), blk = data.subarray(o, o + len);
    blocks.push(blk); ecs.push(qrRsEcc(blk, ec)); o += len;
  }
  const out = new Uint8Array(total); let n = 0;
  for (let i = 0; i <= short; i++) for (const blk of blocks) if (i < blk.length) out[n++] = blk[i];
  for (let i = 0; i < ec; i++) for (const e of ecs) out[n++] = e[i];
  return out;
}
/* Strafpunkte (ISO/IEC 18004, 7.8.3) – kleiner = besser lesbar: N1 je Folge ab 5 gleichen Modulen 3 + (Länge − 5), N2 je 2 × 2
   gleiche Module 3, N3 je 1:1:3:1:1 (dunkel-hell-dunkel-hell-dunkel) mit 4 hellen Modulen davor oder danach 40 (außerhalb des
   Symbols = hell, die Ruhezone), N4 je volle 5 % Abweichung vom Anteil 50 % dunkel 10 */
function qrPenalty(dark, size) {
  let p = 0, n = 0;
  for (let t = 0; t < 2; t++) for (let a = 0; a < size; a++) {   // t = 0: Zeile a, t = 1: Spalte a
    const m = (b) => (b < 0 || b >= size ? 0 : t ? dark[b * size + a] : dark[a * size + b]);
    for (let b = 1, run = 1; b <= size; b++) {
      if (b < size && m(b) === m(b - 1)) run++;
      else { if (run >= 5) p += run - 2; run = 1; }
    }
    for (let b = 0; b + 7 <= size; b++)
      if (m(b) && !m(b + 1) && m(b + 2) && m(b + 3) && m(b + 4) && !m(b + 5) && m(b + 6) &&
          (!(m(b - 4) | m(b - 3) | m(b - 2) | m(b - 1)) || !(m(b + 7) | m(b + 8) | m(b + 9) | m(b + 10)))) p += 40;
  }
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) {
    const c = dark[y * size + x];
    if (c === dark[y * size + x + 1] && c === dark[(y + 1) * size + x] && c === dark[(y + 1) * size + x + 1]) p += 3;
  }
  for (let i = 0; i < dark.length; i++) n += dark[i];
  return p + 10 * Math.floor(Math.abs(20 * n - 10 * dark.length) / dark.length);
}
/* Text → QR-Code: Stufe M, kleinste passende Version, die Maske mit den wenigsten Strafpunkten (bei Gleichstand die kleinere
   Nummer) oder forceMask 0–7 */
function qrMatrix(text, forceMask) {
  if (forceMask != null && !(Number.isInteger(forceMask) && forceMask >= 0 && forceMask <= 7)) throw new RangeError("Die QR-Maske muss 0 bis 7 sein.");
  const bytes = new TextEncoder().encode(String(text == null ? "" : text));
  let v = 1;
  while (v <= QR_MAX_VERSION && bytes.length > qrCapacity(v)) v++;
  if (v > QR_MAX_VERSION) throw new RangeError(`Zu lang für einen QR-Code (${bytes.length} Bytes, höchstens ${qrCapacity(QR_MAX_VERSION)}).`);
  const { size, dark: base, fn } = qrBase(v), cw = qrCodewords(bytes, v), nBits = cw.length * 8;
  // Datenbits im Zickzack: Spaltenpaare von rechts nach links, abwechselnd aufwärts und abwärts, die Taktspalte 6 ausgelassen;
  // frei bleibende Module (Restbits: 7 bei Version 2–6) bleiben 0 und werden mit maskiert
  let k = 0, up = true;
  for (let right = size - 1; right >= 1; right -= 2, up = !up) {
    if (right === 6) right = 5;
    for (let n = 0; n < size; n++) {
      const y = up ? size - 1 - n : n;
      for (let x = right; x >= right - 1; x--) {
        const idx = y * size + x;
        if (!fn[idx] && k < nBits) { base[idx] = (cw[k >>> 3] >>> (7 - (k & 7))) & 1; k++; }
      }
    }
  }
  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    if (forceMask != null && mask !== forceMask) continue;
    const dark = base.slice(), f = QR_MASKS[mask], bits = qrFormatBits(mask);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y * size + x] && f(y, x)) dark[y * size + x] ^= 1;
    for (let i = 0; i < 15; i++) for (const [x, y] of qrFormatCells(size, i)) dark[y * size + x] = (bits >>> i) & 1;
    const penalty = forceMask != null ? 0 : qrPenalty(dark, size);
    if (!best || penalty < best.penalty) best = { mask, dark, penalty };
  }
  return { size, version: v, mask: best.mask, dark: best.dark };
}
/* QR:END */

/* WORLDMAP:BEGIN – erzeugt von scripts/worldmap.mjs, nicht von Hand ändern */
// Natural Earth 1:110m (gemeinfrei) über world-atlas@2 (ISC); Equal-Earth-Projektion, viewBox 0 0 1000 520; je Eintrag [ISO-Kennung ("" = nicht anklickbar), deutscher Name, SVG-Pfad, Anker x, Anker y]
const WORLD_MAP = { w: 1000, h: 520, aliases: {"104":["Birma"],"112":["Weißrussland"],"203":["Tschechische Republik"],"275":["Palästina"],"384":["Côte d’Ivoire","Côte d'Ivoire"],"498":["Moldawien","Republik Moldau"],"626":["Timor-Leste"],"748":["Swasiland"],"807":["Mazedonien"],"826":["Großbritannien"],"840":["Vereinigte Staaten","Vereinigte Staaten von Amerika"]}, countries: [
["004","Afghanistan","M665.1,126.6L666.4,126.6L668.5,127.3L669.4,127.7L670.9,126.7L671.9,127.3L672.3,125.8L673.8,125.9L674,125.4L673.8,124.1L674.5,122.9L676.1,123.7L676.2,124.7L677,124.8L677.6,127.6L678.9,128.7L679.6,128L680.6,127.6L681.6,126.2L683.4,126.4L686,126.4L686.7,127.4L685.4,127.7L684.3,128.3L681.6,128.7L679.2,129.4L678.1,130.8L679.1,132.2L679.9,133.9L679.1,135.3L679.5,136.6L679.2,137.8L676.7,137.7L678.3,139.9L677,140.8L676.4,142.8L677.1,144.8L676.3,145.8L675.3,145.5L673.4,145.9L673.4,146.9L671.5,146.9L670.5,148.8L671.1,151.7L668.1,153.2L666.2,152.9L665.8,153.6L664.2,153.2L661.7,153.7L657,151.9L658.7,148.8L658,146.6L655.9,146L655.3,143.9L653.8,141.2L654.5,139.3L653.3,138.8L653.4,136.4L653.4,132.3L656.2,133.5L658,133.1L658.1,131.6L660,131.1L661.1,130.1L660.9,127.4L662.8,126.8L662.9,125.6L664.3,126.5Z",666.9,138.2],
["008","Albanien","M551.1,115.4L551.1,116.2L550.4,116.7L550.3,117.7L549.3,119.3L548.9,119L548.8,118.3L547.3,117.2L547,115.7L547,113.6L547.2,112.6L546.7,112.1L546.5,111.1L547.4,109.5L547.6,110.1L548.2,109.8L548.8,110.7L549.4,111L549.7,112.1L549.5,113.2L550,114.6Z",548.8,115.9],
["010","Antarktis","M415.9,493.8L416.8,493.8L419.2,493.6L422,493.8L424.4,494.4L425.5,495.1L426,495.6L426.3,496.1L423.9,496.4L421.3,496.7L418.2,496.9L414.8,497.1L410.8,497L408.3,496.7L408.3,496.3L411.8,496L413,495.7L413.8,495.2L414.3,494.8L415.1,494.3ZM387.5,496.3L391.3,496.4L395.1,496.5L396,496L396.6,495.7L398.7,496.1L398.6,496.6L398.4,497.1L394.8,496.9L391.1,497L388.7,496.7L388.7,496.6ZM363.6,483.6L364.7,483.4L366.9,483.5L366.7,482.5L366.3,481.9L365.1,480.3L365.5,479.4L367.1,479.1L368.6,479.9L369.5,480.6L371,481.4L372.2,482.2L373.3,483L374.1,483.8L374.3,484.5L374.3,485.2L372.3,485.4L370.5,485.7L368.1,485.7L368.5,485L366.5,485.3L364.7,485.5L362.8,485L362.2,484.3ZM312.4,484.7L313.2,484.4L315.8,484.6L318.6,484.8L320.9,485L322.7,484.8L324.8,485.8L323.2,485.6L321.1,485.7L318.8,485.6L316.4,485.7L314.2,485.4ZM279.2,487.6L278.9,487.1L281.4,487.4L284.1,487.6L285.9,487.3L285.6,487.9L284.5,488.3L281.8,488.2ZM270.4,487.3L271.2,487L273.5,487.3L277.2,488L276,487.9L273.5,487.8ZM218.5,494.5L218.6,494.1L222.2,494.3L224.7,494.6L226.8,495L228.2,495.5L225.2,495.7L222.2,495.3L220.4,494.9L220.2,494.8ZM202.6,499.9L202.6,499.9L202.6,499.9L202.7,499.9L203.4,499.5L206.8,499.7L206.9,499.7L208.2,499.5L208.5,499.5L208.7,499.5L211.6,499.8L213.2,499.5L213.5,499.5L218.1,499.4L220,499.5L220.9,499.6L223.9,499.8L228.9,500L232.9,500.1L239.5,500.2L244,500.1L251.2,500.2L255.5,500.4L259.6,500.2L263.9,500.1L263.8,499.8L257.2,499.8L251.6,499.6L249.7,499.4L245,499.3L244.7,498.9L244.7,498.6L244.7,498.3L243.7,498L240.5,497.8L238.6,497.5L235.4,497.2L239.6,497.2L243.3,497.1L246.3,497.4L248.8,497.1L250.9,496.7L251.7,496.4L250.3,496L247.5,495.7L244.5,495.4L240.8,495.3L237.5,495.2L233.9,495.1L232,494.6L229.1,494.3L226.9,493.8L223.6,492.4L224.7,492.5L227,492.9L229.7,492.8L232.1,492.6L234.5,493.2L237.1,493L238.9,492.8L240.4,492.4L241.6,491.9L244,491.8L243.1,491.3L241.6,490.8L241.2,490.3L243.1,490L244.9,490.5L247.1,490.2L248.6,489.8L251.1,489.8L253.2,489.7L255.1,489.3L256.5,489L258.1,488.6L259.7,488.7L261.1,488.9L263.4,488.6L266.2,488.9L268.6,488.9L270.6,488.7L273.3,488.8L276.2,489L278.5,488.9L281.2,488.9L283.9,489L286.2,488.9L287.4,488.5L289.3,488.2L292,488.6L293.8,488.3L295,487.7L296.8,488.2L298.1,488.8L299.9,489.3L301.2,488.8L304.1,489.4L306.7,489.6L309.2,490L311.6,489.9L313.6,489.6L316.3,489.7L319,489.9L321.7,490.2L321.9,489.5L320.2,489L318.7,488.5L316.2,488.3L314.5,487.8L313.4,487.2L311.3,485.9L313,486.2L315.5,486.3L317.7,486.2L320.2,486.4L322.5,486.9L323.9,487.5L326.5,487.6L328.6,487.3L330.7,487L332.7,486.8L335,487.2L337.3,487.1L337.6,485.8L339.8,486.6L342.1,486.9L344.2,486.7L346.3,487.3L348.8,487.4L351.1,487.6L353.6,487.9L354.5,487.3L354.7,486.8L357,487.4L359.4,487.3L361.5,487.6L363.2,488.1L365.5,488L367,487.6L368.5,487.2L370.5,487L372.9,486.8L375.1,486.6L376.6,486.2L377.2,485.7L377.1,485L376.4,484.2L375.3,483.6L374.1,482.8L373,482.1L372.1,481.5L371.4,480.7L371.1,480L371.5,479.3L371.6,478.5L371.4,477.7L370.4,476.8L369.7,476L370,475.1L370.7,474.5L371.4,473.7L372.3,473L373.5,472.4L373.7,471.5L374.4,470.9L375.3,470.3L377.1,470.2L378,469.5L379.1,469L380.6,468.8L381.7,468.2L382.5,467.5L383.9,467.2L385.4,467.8L385.1,468.6L383.4,469.2L382.8,469.7L381.1,469.3L379.6,469.6L378.5,470.1L377.4,470.7L376.8,471.3L377.1,472.1L377.7,473L379,473.7L378,474.2L376.3,474.3L375.7,475L374.9,475.7L374.3,476.6L374.5,477.3L375.7,478.1L377.1,478.7L379,479.2L380.9,479.8L382.1,480.6L383,481.3L384,482L385.3,482.6L386.3,483.3L387.6,484.9L388.6,485.5L389.2,486.2L390.2,486.8L390.5,487.7L390,488.3L389.3,488.9L387.1,489.1L386.7,489.6L386,490.1L383.7,490.6L381.5,490.9L379.6,491.2L377.4,491.5L376.5,492L373.7,492.1L370.6,492L367.9,492.1L365,492.1L366,492.7L368.9,492.9L371.1,493.2L372.6,493.7L371,494.1L367.9,493.9L365.8,494.3L366.1,494.7L366.5,495.2L368.8,495.6L369.6,496L372.1,496.3L375.8,496.5L379.1,496.8L381.8,497.1L385.1,497.4L389.4,497.5L393.8,497.7L396.8,498L400.1,498.3L402.1,498.6L403.1,498.9L404.9,498.7L407.5,498.4L410.2,498.2L413.6,498L416.4,497.7L420.6,497.7L424.8,497.8L428.3,498L429.1,497.7L431.3,497.4L435.6,497.4L438.8,497.2L441.9,497L445.4,496.8L449,496.7L451.6,496.4L450.2,496.1L449.4,495.7L449.2,495.3L445.9,495.3L442.5,495.5L439.1,495.5L438.5,495.1L438.3,494.2L439,493.9L441.4,493.7L444.2,493.4L446.1,493L448.1,492.6L449.5,492.1L451.8,491.8L454.1,491.7L455.3,491.5L458,491.5L460.5,491.3L462.6,491L464.7,490.7L466.5,490.4L468.9,489.9L470.4,489.4L472,488.9L472.4,488.3L470.4,488L470.9,487.3L472,486.8L473.9,486.5L475.8,486.1L477.6,485.6L478.9,484.9L479.7,484.1L481,483.6L483.2,483.7L484.2,484.3L486.4,484.3L486.4,483.7L487.3,483L489.3,483.2L489.8,483.8L492,483.9L494.4,483.6L496.7,483.4L498.8,483.5L499.6,484.2L501.6,483.7L503.5,483.3L505.6,483.1L507.7,482.8L509.6,482.4L511.7,482.1L513.3,481.7L514.5,481.1L515.8,481.6L517.8,481.3L519.1,482.2L520,482.8L522.2,482.5L523.1,481.7L525.1,481.2L527.5,481.3L528.2,482L529.8,481.3L531.9,481.1L534.1,481L536.1,481.1L538.1,481.3L540.1,481.4L540.8,482L541.9,482.6L544,482.2L546.2,482.2L548.3,482.2L550.4,482.1L552.4,481.9L554.4,481.7L556.2,481.1L558.1,480.8L560,480.6L561.7,480.1L563,479.1L564.4,478.4L566.2,478.7L566.7,479.4L568.2,479.8L570.2,479.7L571.2,480.4L572.4,480.9L574.5,480.4L575.5,479.6L577.4,479.2L579.6,478.6L581.6,478.3L584,477.9L585.7,477.5L587.5,477L589.2,476.6L590.9,476.8L593,476.1L594.5,475.5L596.3,475.6L598.1,475.1L598.9,474.4L600.8,473.8L602.6,473.4L604.7,473L606.6,472.9L608.3,473L610,473.2L611.2,473.8L610.9,474.7L612.2,475.4L613.1,476L615.2,476.2L616.2,476.8L617.4,477.3L619.2,477.4L620.9,477L623.1,476.2L624.6,476.6L626.4,476.9L628,477.1L629.8,477.3L631.7,477.3L631.8,479.3L631.4,479.8L630.5,480.7L628.4,481.1L626.4,481.8L626.1,482.6L628.2,482.5L627.4,483.2L626,483.9L624.6,484.6L625.6,485.2L627.6,485.3L629.9,485L631.5,484.3L632.6,483.7L634.1,483.1L635.6,482.6L636.6,482L638.3,481L639.6,480.9L641.8,480.8L643.9,480.6L646,480.3L647.6,479.5L648.7,478.8L650.6,478L652.9,477.5L654.8,477.1L656.4,476.5L657.8,476.1L659.5,475.8L661.2,476L663.1,475.8L665.2,475.5L667.2,475.7L669.1,475.1L671.3,473.7L671.5,474.3L671.6,475.3L672.8,475.7L674.5,475.8L676.6,475.6L678.4,475.7L680.2,475.8L681.6,475.6L683.1,475.7L684.2,476.2L686.2,475.9L688.2,475.9L690.3,475.6L692,475.9L694,475.2L695.6,474.5L697.6,473.9L701.6,472.3L702.5,472.6L703.4,473.2L704,474L705.1,475.2L707,475.3L708.8,475.3L711.1,475L713.5,474.7L715.7,474.2L717.7,473.5L720,473.5L722,473L723,473.4L723.3,474.1L723.9,474.7L726.1,474.7L726.8,475.2L728.5,475.7L730.7,475.9L732.9,475.7L735.2,475.1L737.3,474.4L739.2,474.3L740.6,474.6L742.4,474.8L744.6,474.4L746.3,474.4L747.8,474.7L749.3,474.9L751.5,474.5L754,474.2L756.1,474.1L758.3,474.1L760.4,473.9L762.4,473.7L764.3,472.7L765.5,471.8L765.9,472.4L765,473.3L764.5,474.2L764.4,474.9L765.5,475.3L767.9,475.1L770.5,475.1L772.4,475L774.9,475L776.8,474.9L779.2,475L781.1,475.2L781.6,475.8L780.1,476.6L780.4,477.2L781.8,477.7L783.1,478.2L785.1,478.5L787.2,478.8L788.6,479.1L790.7,479.2L792.9,478.5L793.8,479.1L794.2,479.7L795.2,480.1L797.1,480.3L798.9,480.5L798.6,481.3L800,481.7L800.3,482.3L801.9,482.6L804.1,482.6L805.9,482.7L808.2,482.7L810.1,482.8L811.7,483.1L812.9,483.5L814.2,483.8L814.5,484.3L813,485L810.9,485.6L808.7,486.4L806.9,487L804.8,487.6L801.9,487.9L799.8,488.4L796.9,488.8L794.9,489.4L792.7,489.9L790.5,490.4L788.6,491L787.2,491.5L785.8,492.1L784.9,492.6L784.9,493.1L784.3,493.6L784.3,494L787.2,494.2L786.8,494.7L783.3,494.9L780.2,495.1L776.9,495.2L774.2,495.8L772.9,496.3L771.5,496.7L769.8,497L771.5,497.3L771.6,497.7L772.4,498L773.8,498.3L775.6,498.5L777.6,498.8L781,499L781.1,499.3L785.6,499.5L785.8,499.5L786.6,499.7L791.5,499.6L794.9,499.8L797.4,499.9L797.4,499.9L793.9,501.4L500,501.4L206.1,501.4Z",718.9,487.6],
["012","Algerien","M477.4,160.4L477.4,159.7L477.4,159.4L477.5,155.3L481.8,152.8L484.4,152.3L486.5,151.3L487.5,149.6L490.5,148.3L490.7,145.7L492.2,145.4L493.3,144.2L496.7,143.6L497.1,142.3L496.5,141.6L495.6,138L495.5,136L494.6,133.8L497,132L499.7,131.5L501.3,130.1L503.7,129.1L507.9,128.5L512,128.2L513.2,128.7L515.6,127.4L518.2,127.4L519.3,128.2L520.9,128L520.5,129.7L521,132.8L520.5,135.6L519,137.4L519.3,140L521.4,142L521.5,142.8L523.1,144.2L524.4,150.3L525.3,153.3L525.5,154.9L525.2,157.8L525.4,159.3L525.1,161.2L525.4,163.4L524.4,164.9L526,167.5L526.2,169L527.2,170.9L528.4,170.3L530.5,171.9L531.8,174.2L522.8,180.9L515.2,188L511.4,189.6L508.5,189.9L508.4,187.6L507.2,187.1L505.5,186L504.9,184.4L495.9,176.6L487,168.8Z",506,160.1],
["024","Angola","M535.7,277.7L534.7,278.5L534.3,279.5L534.2,281.1L533.5,281.5L532.8,278.7L533.9,277.1L534.7,276.5ZM533.9,282.6L535,282.1L535.8,282.2L536.8,281.7L544.9,281.8L545.5,284.6L546.3,286.8L546.9,288L547.9,289.9L549.7,289.6L550.6,289.1L552.2,289.6L552.6,288.7L553.3,286.5L555,286.4L555.2,285.7L556.6,285.7L556.3,287.1L559.6,287L559.6,289.4L560.2,290.8L559.7,293L559.9,295.3L560.8,296.6L560.5,301L561.2,300.7L562.4,300.8L564.1,300.2L565.3,300.4L565.6,301.6L565.2,303.4L565.6,305.1L565.2,306.5L565.4,307.7L559.7,307.7L559.2,319.3L560.9,322.3L562.5,324.5L557.5,326L551,325.5L549.2,323.7L538.3,323.9L537.9,324.2L536.3,322.5L534.6,322.4L532.9,323L531.6,323.7L531.4,321.4L531.9,318.2L532.9,314.9L533,313.3L534,310.1L534.7,308.5L536.3,306.2L537.2,304.5L537.5,301.8L537.4,299.7L536.6,298.4L535.9,296.2L535.3,294L535.4,293.2L536.3,291.7L535.5,288.2L535,285.7L533.6,283.3Z",547.2,311.5],
["031","Aserbaidschan","M612,112.1L612.7,112.2L614.8,114.2L615.9,114.4L616.1,113.6L617.3,112.3L619,114L620.7,116.2L621.9,116.4L622.9,117.2L620.9,117.5L621.1,120L620.9,121.1L620.2,121.9L620.6,123.5L620,123.6L618.1,121.9L618.6,120.3L617.7,119.4L616.8,119.6L614.4,122L613.9,119.8L612.7,119.2L611.5,118.4L611.9,117.3L610.4,116.3L610.7,115.5L609.7,114.9L609,114.1L609.4,113.5L611.5,114.5L612.8,114.7L613,114.3L611.5,112.6ZM613.6,122.1L611.8,121.7L610.2,120.2L609.6,119L610.1,118.9L611,119.7L612.1,119.7L612.2,120.2Z",615.2,117.2],
["032","Argentinien","M347.4,440L348.9,441.3L351,443.4L354.6,445L358,445.7L357.7,447.1L355.7,447.2L354.1,446.2L352.7,446.2L350.4,446.2ZM351.6,369.4L351.5,372.1L351.6,375.6L352.3,379L351.9,379.8L352.2,381.9L352.5,383.7L356.3,386.5L356.5,388.8L358.4,390.3L358.7,391.9L357.4,396.1L354.2,397.8L349.4,398.5L346.7,398.2L347.7,400.1L347.9,402.5L348.9,404.1L347.8,405.2L345.4,405.7L342.7,404.5L342,405.4L343.4,408.5L345.3,409.4L346.3,408.5L347.6,410.1L345.7,411.1L344.4,413L345.2,416.1L345.2,417.8L343,417.8L341.7,419.3L341.9,421.6L345.1,423.8L347.5,424.4L347.8,427.1L345.7,428.7L345.7,432.2L344.1,433.3L343.8,434.6L345.9,437.6L348.1,439.2L347.1,439.1L344.8,438.7L339.2,438.3L337.5,436.6L336.6,434.5L335.1,434.7L333.8,433.6L332.2,430.6L333.4,429.3L333.3,427.4L332.4,425.9L332.5,423.4L331.7,419.4L330.7,417.6L331.5,417L330.8,415.8L329.5,415.2L329.8,413.9L328.2,412.7L326.3,409.1L327.1,408.5L325.3,404.6L324.7,401.3L324.4,398.5L325.5,397.3L323.8,394.1L322.8,391.1L324.1,388.9L323.2,386.2L323.7,382.9L322.9,379.8L322,379.2L319.4,373.3L320.1,369.8L319,366.5L319.2,363.3L320.2,360.1L321.6,357.9L320.6,356.5L320.9,355.4L319.6,349.5L322.2,347.8L322.5,344.1L322,343.2L323.7,340L327.3,340.9L329.3,343.5L329.8,340.6L332.9,340.7L333.4,341.5L339.2,347.3L341.5,347.8L345.1,350.4L348.1,351.8L348.7,353.4L347,358.7L349.8,359.6L352.8,360.2L354.8,359.6L356.7,356.9L356.7,353.9L357.9,353.2L359.5,355.2L359.9,358L358,359.9L356.5,361.3L354.2,364.7Z",335.8,370.4],
["036","Australien","M858.9,404.5L860.2,404.7L857.5,408.5L855.9,409.6L853.7,412.1L853.5,411.3L850.2,413.4L849.8,413.3L848.5,413.2L849,410.5L850.2,408.4L850.8,405.7L851.9,404.2L853.3,404.5L854.9,405.6L856.5,405.1ZM821.8,376.2L818.2,378L815.7,378.7L814.3,380.5L812.8,381.9L810.6,382L808.8,382.3L806.9,381.6L804.9,382L803.1,382.2L800.7,384L800.1,383.8L798.4,384.7L796.7,385.8L794.9,385.7L793.2,385.7L791.5,383.5L790.5,382.9L791.4,381L792.8,380.5L793.6,379.8L794,378.5L795.4,376.2L795.9,374.2L796,370.7L796.4,368.8L797.2,366.8L797.1,364.6L797.4,363.5L796.7,362.2L797.4,359.4L796.8,356.7L797,355.2L797.6,356.7L797.8,353.4L798.8,354.5L799.1,355.8L799.7,354L799.2,351.2L799.3,350.1L799.1,349.1L800,347L800.8,346.2L801.7,344.4L802,342.3L803.8,339.7L803.2,342.5L805,340L807.5,338.8L809.2,337.3L811.6,336L812.9,335.7L813.5,336.1L816,334.8L817.7,334.4L818.3,333.6L819.1,333.3L820.6,333.4L823.7,332.3L825.6,330.7L826.7,328.8L828.8,327L829.2,325.5L829.8,323.5L832.4,320.5L832.8,323.6L834.1,322.9L833.5,321.2L834.8,319.4L835.8,320.2L836.7,317.4L838.6,315.6L839.5,314.2L841,313.6L841.2,312.5L842.4,313L842.6,312.1L843.9,311.5L845.3,311L847,312.7L848,314.9L849.7,314.9L851.4,315.2L851.2,313.2L853.1,310.3L854.5,309.4L854.3,308.4L855.8,306.3L857.7,305.1L859,305.5L861.4,304.8L861.7,302.9L859.9,301.7L861.4,301.2L863.1,302.1L864.3,303.6L866.4,304.5L867.3,304.2L868.8,305.3L870.5,304.2L871.5,304.6L872.3,303.9L873.2,305.7L872.1,307.6L870.8,309.1L869.8,309.2L869.8,310.7L868.7,312.5L867.3,314.3L867.3,315.3L869,317.4L870.8,318.5L871.9,319.8L873.3,321.9L874.1,321.9L875.2,322.8L875.4,324L877.6,325.2L879.7,324L880.8,322L881.7,320.4L882.5,318.4L884.1,315.5L884.1,313.7L884.5,312.7L884.7,310.6L885.6,307.8L886.3,307.1L886.1,305.9L887.1,303.9L888,301.9L888.2,300.9L889.5,299.5L889.9,301.3L889.7,303.6L890.3,304L890.1,305.6L890.8,307.4L890.5,309.5L890.2,310.8L890.5,313.7L892.6,312.3L893.1,313.9L894.1,315.3L893.4,316.9L893.2,320L893.1,321.8L893.7,322.3L893.5,325.4L892.7,327.3L892.9,329.7L895.2,331.6L896.6,333.3L897.8,334.9L897.2,335.7L897.9,338L897.6,341.8L898.9,341.1L899.4,342.6L900.3,342L899.3,345.8L900.3,348L901,349.3L901.8,352.2L901.3,355L900.5,357L899.3,359.2L899.1,362.1L897.4,365.2L896.2,366.8L893.9,369.9L892.9,371.8L891.1,374.3L888.2,377.4L885.4,379L882.9,381.6L881.1,383.3L878.6,386.2L876.6,387.8L874.4,390.3L872.6,392.6L872.1,393.6L869.9,394.7L867,394.9L863.9,396.2L861.9,397.5L859.5,398.8L858.4,397.4L857.3,396.8L858.8,395.1L857,395.8L853.3,398.1L851.8,397.2L850.7,396.7L849.4,396.5L847.6,395.5L847.3,393.5L848.3,391L848.8,389.4L848.3,388L846.1,387.6L847.9,386L848.6,383.5L846.1,385.8L843.5,386.5L845.9,384.6L847.3,382.7L849.2,381L850.3,378.5L846.7,381.4L844.5,382.6L842.1,385.2L840.9,383.8L841.9,382.1L841.6,379.6L840.9,378.4L841.8,377.6L839.5,375.5L837.8,375.4L836.1,373.8L831.4,374.1L827.5,375.3L824.1,376.4Z",854.1,347.3],
["040","Österreich","M539.2,93L539.1,94.2L537.8,94.2L538.3,94.8L537.7,96.7L537.3,97.2L535.3,97.3L534.2,98L532.3,97.8L528.8,97L528.3,96L526,96.5L525.8,97L524.3,96.6L523.1,96.5L522,96L522.4,95.3L522.2,94.7L522.9,94.6L524.2,95.4L524.4,94.6L526.5,94.7L528.1,94.2L529.2,94.3L530,94.9L530.2,94.4L529.7,92.5L530.5,92.1L531.2,90.7L533,91.7L534.2,90.5L534.9,90.3L536.8,91.1L537.9,91L539,91.6L538.8,91.9Z",533.5,94.8],
["044","Bahamas","M293.6,162.5L294.9,162.2L296.6,162.3L296.5,163.2L293.5,163.8ZM296.9,161.6L298.6,163.2L297.6,165.7L297.2,165.2L297.7,163.4L296.8,162ZM294.4,168L295.2,168.2L295.5,171.1L295,173.1L294.4,173.3L294.1,171.3L293.4,170.3Z",294.4,170.1],
["050","Bangladesch","M746.4,179.2L746.9,181.8L745.9,181.3L746.7,184.1L745.5,182.3L745,180.5L744.1,178.7L742.5,176.7L740,176.5L740.6,178L740.2,180L738.9,179.2L738.6,179.9L737.8,179.5L736.7,179.2L735.6,176.3L734.1,173.6L734.1,171.5L732.2,170.5L732.5,169.2L733.8,167.9L731.4,166L731.7,163.7L734.2,165.2L735.5,165.4L736.4,167.8L739,168.3L741.4,168.2L743.1,168.8L742.6,171.8L741.5,172L741.2,174L743.1,175.9L743,173.6L743.7,173.6Z",737.8,171.8],
["051","Armenien","M614.4,122L613.6,122.1L612.2,120.2L612.1,119.7L611,119.7L610.1,118.9L609.6,119L608.4,118L606.4,117.2L606.4,115.7L605.7,114.6L609,114.1L609.7,114.9L610.7,115.5L610.4,116.3L611.9,117.3L611.5,118.4L612.7,119.2L613.9,119.8Z",608.2,116],
["056","Belgien","M513.9,85.1L513.7,87.1L513.1,87.2L512.9,88.8L510.9,87.5L509.7,87.7L508.1,86.4L507.1,85.2L506,85.2L505.7,84.2L507.4,83.6L509.1,83.8L511.2,83.2L512.6,84.5Z",510.7,85.5],
["064","Bhutan","M738.7,159L740,160.2L740.5,162.3L738.3,162.4L736.1,162.2L734.6,162.7L731.9,161.4L731.6,160.7L732.6,158.1L733.8,157.2L735.8,158L737.2,158.1Z",734.7,160.1],
["068","Bolivien","M310.1,300.5L312.1,300.8L313.5,300.8L314,299.6L316.3,298.2L317.7,296.8L321.2,296.1L321.1,298.9L321.6,300.3L321.5,302.8L324.8,306.1L327.9,306.7L329.1,308L331,308.8L332.2,309.8L333.9,309.8L335.6,310.9L335.9,313L336.5,314.1L336.7,315.6L335.9,315.7L337.4,319.9L342.6,320.1L342.4,322.2L342.9,323.6L344.5,324.6L345.4,326.9L345.2,329.7L344.7,331.3L345.2,333.3L344.4,334.1L344.3,333L341.5,331.1L339,331.1L334.5,332.1L333.6,335.3L333.9,337.2L333.4,341.5L332.9,340.7L329.8,340.6L329.3,343.5L327.3,340.9L323.7,340L322,343.2L320.2,343.7L318.3,338.8L316.2,334.8L316.5,331.3L314.9,329.8L314.2,327.2L312.5,324.7L313.7,320.8L312.2,317.8L312.7,316.5L312,315.2L312.9,313.4L312.6,310.2L312.5,307.7L313,306.4Z",325.7,323.2],
["070","Bosnien und Herzegowina","M544.6,109.6L542.3,108.5L541.3,107.2L540.3,106.5L539.1,105.3L538.5,104.4L537.2,102.9L537.6,101.6L538.5,102.3L539,101.7L540.1,101.6L542.2,102.2L543.8,102.1L544.9,102.8L545.8,102.8L545.3,104.1L546.6,105.3L546.4,106.8L545.9,106.9L545.4,107.2L544.7,107.9Z",542.7,104.8],
["072","Botsuana","M578.2,340.9L574.3,343.6L571.7,346.2L570.7,348.6L569.8,349.9L568.3,350.2L567.8,351.9L567.4,353L565.7,353.8L563.5,353.6L562.4,352.6L561.3,352.2L560,353L559.2,354.7L557.9,355.7L556.5,357.3L554.6,357.7L554.1,356.4L554.4,354.3L553.1,351L552.4,350.4L552.9,340.1L555.6,340L556.2,327.2L558.2,327L562.4,325.8L563.4,327.3L565.2,325.8L566,325.8L567.6,325L568,325.3L568.9,328.2L569.4,328.8L570.2,330.9L573,334.9L574.1,335.2L574,336.5L574.6,338.8L576.7,339.3Z",565,339.8],
["076","Brasilien","M364.9,381.5L363.8,379.6L364.6,378L362.7,375.7L360.3,373.8L357.3,371.6L356.3,371.7L353.2,369L351.6,369.4L354.2,364.7L356.5,361.3L358,359.9L359.9,358L359.5,355.2L357.9,353.2L356.7,353.9L356.9,351.8L356.9,349.7L356.6,347.8L355.6,347.1L354.7,347.7L353.7,347.6L353.2,346.2L352.4,342.9L351.8,341.9L349.9,340.9L348.9,341.6L346,340.9L345.5,336.1L344.4,334.1L345.2,333.3L344.7,331.3L345.2,329.7L345.4,326.9L344.5,324.6L342.9,323.6L342.4,322.2L342.6,320.1L337.4,319.9L335.9,315.7L336.7,315.6L336.5,314.1L335.9,313L335.6,310.9L333.9,309.8L332.2,309.8L331,308.8L329.1,308L327.9,306.7L324.8,306.1L321.5,302.8L321.6,300.3L321.1,298.9L321.2,296.1L317.7,296.8L316.3,298.2L314,299.6L313.5,300.8L312.1,300.8L310.1,300.5L308.6,301.2L307.3,300.7L307.1,295.1L305,297.3L302.5,297.2L301.4,295.3L299.5,295L300,293.5L298.3,291.2L297,287.9L297.6,287.2L297.6,285.7L299.2,284.6L298.8,282.6L299.4,281.3L299.5,279.6L302.6,277L304.8,276.3L305.2,275.8L307.7,275.9L308.7,265.8L308.7,264.2L308.3,262L307.1,260.7L307.1,258L308.6,257.4L309.2,257.8L309.3,256.3L307.7,256L307.7,253.6L313,253.7L314,252.4L314.7,253.6L315.2,255.8L315.7,255.3L317.2,257.3L319.4,257.1L319.9,255.9L322,255.1L323.1,254.5L323.5,252.9L325.4,251.8L325.3,251.1L323,250.7L322.6,248.4L322.8,245.9L321.6,244.9L322.1,244.6L324.2,245.1L326.3,246L327.1,245.1L329.1,244.6L332.2,243.2L333.3,241.8L333,240.7L334.4,240.5L335,241.4L334.6,243L335.5,243.6L336.1,245.3L335.3,246.6L334.8,249.8L335.5,251.6L335.7,253.4L337.4,255.1L338.7,255.3L339,254.6L339.9,254.4L341.1,253.8L342.1,252.8L343.6,253.1L344.2,252.9L345.7,253.3L346,252.5L345.5,251.8L345.8,250.7L346.9,251L348.2,250.6L349.8,251.4L351,252.2L351.9,251.2L352.5,251.3L352.8,252.4L354.2,252.1L355.2,250.7L356.1,248L357.8,244.6L358.8,244.4L359.4,246.5L360.9,252.9L362.3,253.6L362.4,256.1L360.3,259.2L361.2,260.3L366,260.9L366.1,264.6L368.2,262.2L371.7,263.5L376.3,265.8L377.6,267.9L377.2,270L380.4,268.8L385.8,270.8L389.9,270.7L394,273.7L397.6,277.9L399.7,279L402.1,279.1L403.1,280.3L404.2,285L404.7,287.2L403.8,293.3L402.5,295.7L398.8,300.9L397.3,305L395.4,308.2L394.8,308.3L394.1,310.9L394.8,317.8L394.4,323.4L394.3,325.8L393.6,327.2L393.5,332L391.2,336.7L391.1,340.4L389.1,341.9L388.7,344.1L385.8,344.1L381.8,345.4L380.1,347L377.3,348L374.6,350.8L372.8,354.3L372.8,356.9L373.5,358.9L373.6,362.4L373.3,364.1L371.7,366L369.9,372L368.2,374.7L366.7,376.3L366.2,379.5Z",365.1,298.7],
["084","Belize","M260,194.5L260.1,193.9L260.4,193.8L260.8,194.2L262.2,192L262.7,191.9L262.6,192.5L263.1,192.5L262.9,193.5L262.2,195L262.3,195.6L261.8,196.9L262,197.2L261.4,199.1L260.7,200L260.2,200.2L259.4,201.4L258.6,201.4L259.5,197.3Z",261.1,195.5],
["090","Salomonen","M943.2,298.8L943.7,300.1L941.8,300L941.2,297.8L942.6,298.7ZM942.5,295.6L942,296.2L940.5,293L940.3,290.8L941.2,290.8L941.7,293.8ZM940.1,296.6L939,296.6L937.4,296.3L936.9,295.7L937.3,294.2L939,294.8L939.8,295.6ZM937.8,289.7L938.3,290.9L938.3,291.6L936.4,290.1L935.1,288.7L934.2,287.5L934.7,287.1L935.8,288ZM931.5,286L932.4,287.2L931.8,287.4L930.7,286.6L929.8,285.1L930,284.5Z",936.8,289.6],
["096","Brunei","M817.4,239.8L817.4,241.6L817.4,244L816.1,243.9L815.6,245.1L814.2,243.2L815.2,241.8Z",816.2,242.6],
["100","Bulgarien","M553.8,104.7L554.6,106L555.5,105.8L557.4,106.2L560.9,106.4L562,105.6L564.7,104.9L566.6,106L568.1,106.3L567,107.6L566.5,109.9L567.5,111.7L565.4,111.2L563,112.2L563.2,113.8L561.1,114.1L559.2,113L557.4,113.9L555.6,113.8L555.2,111.7L553.8,110.7L554.2,110.2L553.9,109.9L554.2,108.9L555,107.9L553.6,106.5L553.3,105.4Z",558,109.7],
["104","Myanmar","M767.6,185L766.2,185.9L765,187.4L763.1,187.6L762.7,191.5L761.7,192.1L763.6,195.3L765.8,198L767.4,200.4L766.9,203.5L766.1,204.2L767,206L769.3,208.9L769.9,211L770.1,212.7L771.6,216L770.5,219.4L769.6,223.2L769.1,220.5L769.6,217.7L768.4,215.5L768.1,211.5L766.7,209.6L765.1,205.2L763.9,200.6L762.2,197.6L760.7,199.5L758.1,202L756.5,201.7L754.7,200.9L754.9,196.4L753.7,193L750.8,188.8L750.8,187.5L749.2,187.1L746.7,184.1L745.9,181.3L746.9,181.8L746.4,179.2L747.5,178.4L746.9,176.9L747.2,175.7L746.4,172L748.7,172.8L749.1,169.9L748.8,168.2L749.4,165.2L748.8,163.2L751.5,160.8L753.5,161.4L752.7,159.3L753.4,158.7L752.8,157.3L754.2,157.1L755.7,159.1L757.1,160L758,162.6L758.7,165.5L757.1,168.5L757.9,172.6L760.5,172.1L762,175.3L763.8,176L763.8,179L766.1,180.3L767.4,181L769.1,179.9L769.5,181.4L767.8,183.7Z",755.6,180.6],
["108","Burundi","M583.9,269L584.1,270.4L584.7,271.3L584.7,272.5L584,273.2L582.9,275.2L581.9,276.5L580.7,276.7L580.6,272.2L579.9,270.5L581.6,270.8L582.5,268.7Z",582.4,272.4],
["112","Belarus","M560.7,70.4L563.1,71L563.6,71.7L564.6,71.4L566.9,72L567.4,73.3L567.1,74L568.8,75.8L569.9,76.3L569.8,76.8L571.4,77.2L572.2,78L571.5,78.6L569.7,78.5L569.3,78.7L570.1,79.7L571,81.5L569.1,81.6L568.6,82.2L568.7,83.7L567.7,83.4L565.8,83.5L565,82.9L564.3,83.4L563.4,83L561.6,82.9L559,82.2L556.7,82L554.9,82.1L553.8,82.8L552.8,82.9L552.5,81.7L551.6,80.4L552.9,79.8L552.7,78.7L551.9,77.6L551.6,76.4L553.8,76.5L556,75.4L556.2,73.9L557.8,73L557.4,71.8L558.6,71.4Z",561.8,77.1],
["116","Kambodscha","M779.6,214.9L778.4,210.5L779.6,207.5L783,206.8L785.7,207.3L788.1,208.7L788.9,206.2L791.6,207.6L792.6,210L792.9,214.4L788.7,217.2L790.2,219.4L787.4,219.7L785.2,221.2L782.8,220.6L781.5,218.7Z",784.9,213.2],
["120","Kamerun","M539.5,212.5L540.6,214.8L540.8,217.3L540.8,219.7L542.3,223L540.8,223L540,223.3L538.8,222.9L538.2,224.6L539.8,226.8L541.1,227.4L541.5,228.9L542.3,231.5L541.9,232.5L540.6,236.2L539.9,236.9L539.8,239.8L540,241.3L539.8,242.4L541.2,244.4L541.4,245.7L542.4,247.6L543.7,248.8L543.8,250.5L544.1,251.6L543.9,253.6L541.7,252.7L539.5,251.7L536,251.6L535.7,251.4L534,251.9L532.4,251.4L531.1,251.6L526.6,251.5L527,248.6L525.9,246.1L524.6,245.5L524.1,243.9L523.4,243.3L523.4,242.3L524.1,239.7L525.4,236.1L526.2,236.1L527.8,233.9L528.8,233.8L530.4,235.4L532.2,234.1L532.5,232.6L533.1,231.1L533.5,229.2L534.9,227.7L535.5,225.1L536,224.3L536.4,222.4L537.1,220L539.3,217.2L539.5,216L539.7,215.3L538.6,213.8L538.7,212.7Z",532.4,242.5],
["124","Kanada","M218.5,90.4L218.2,90.4L216.1,87.5L215.4,86.3L212.3,85.1L213.2,82.6L215,80.8L213.2,79.6L214.8,77.4L214,75.4L215.3,74L217.7,72.7L219.3,71L217.3,69.3L218.2,66.4L218.8,64.5L218.1,63.4L217.8,62.4L218.2,61.1L215.2,61.9L211.6,63.3L211.6,61.6L211.4,60.6L210.1,59.9L208.2,59.8L224.9,46.7L235.6,39.3L238.4,39.7L240,40.7L241.7,40.8L244.5,40L247.7,39.4L250.1,39.7L254.1,38.8L257.8,38.4L258,39.1L260,38.7L261.6,37.8L262.6,38L263.5,39.7L267.7,38.4L266.1,39.9L268.8,39.5L270.2,39L272.4,39.1L274.2,39.9L277.8,40.6L280,40.9L282,40.8L283.4,41.8L279.5,42.8L282.5,43.2L287.9,43L289.9,42.6L290.6,43.9L293.9,42.8L292.8,42L294.8,41.3L297.2,41.2L299,41L300,41.5L300.7,42.6L303,42.4L305.5,43.3L308.8,43L311.5,43L312.5,41.8L314.6,41.5L316.9,42.1L315,44L317.8,42.4L319.3,42.5L322,40.5L321.2,39.3L319.8,38.6L322,36.5L325.5,35.3L327.6,35.5L328.7,36.3L329.2,38.4L326.7,39.3L329.8,39.7L327.9,41.7L331.9,40.1L333,41.4L331.1,42.9L331.7,44.2L335,42.8L337.9,41L339.9,38.9L342.4,39.1L344.9,39.4L346.7,40.3L346,41.3L343.7,42.3L344.1,43.4L343.1,44.4L338.1,45.9L335.1,46.2L333.6,45.6L332.2,46.6L328.8,48.4L327.4,49.4L323.9,50.9L320.9,51.1L318.5,52L317.2,53.5L314.6,53.8L310.5,55.7L306.1,58.4L303.8,60.3L301.4,63.2L304.2,63.6L303.3,66L302.9,67.9L306.3,67.4L309.4,68.6L310.9,69.6L311.6,70.8L313.8,71.5L315.4,72.7L318.9,72.8L321.1,73.1L319.4,75.4L318.4,78.2L318.3,81.3L320.2,84L322.4,83.1L325.1,80.2L326.4,75.8L325.7,74.4L329.9,73.1L333.4,71.2L335.7,69.4L336.5,67.6L336.4,65.5L335.1,63.5L339.2,60.9L339.8,58.7L341.6,55L343.4,54.4L346.4,55.1L348.4,55.3L350.5,54.7L351.8,55.5L353.5,56.9L353.5,57.8L357.1,58L355.8,60L354.7,63.2L356.4,63.6L357.1,65L360.9,63.6L364.4,60.9L366.4,59.7L366.8,61.9L367.9,65.2L368.7,68.3L367.1,69.9L369.3,71.4L370.5,72.9L373.7,73.6L374.8,74.5L374.7,76.8L376.2,77.2L376.7,78.2L375.7,81.3L373.7,82.4L371.7,83.4L367.6,84.4L363.8,86.8L359.8,87.2L355.2,86.6L351.8,86.6L349.4,86.8L346.6,88.9L343.1,90.2L338.1,94.1L334.3,96.8L336.5,96.3L341.8,92.4L347.7,90L351.2,89.7L352.7,91.1L349.7,93.1L349.2,96.3L349.1,98.6L351.6,100.1L355.6,99.7L359.2,96.3L358.6,98.5L359.7,99.6L356.1,101.5L350.3,103.4L347.5,104.6L344,106.8L342.3,106.6L343.2,104L348.2,101.5L344.4,101.6L341.6,101.9L340.7,100.2L342.3,96.1L341.6,95.2L339.9,95.7L339.4,95L336.7,97.2L335.1,99.6L333.7,101L332.5,101.4L331.7,101.6L331.1,102.3L326.8,102.3L323.2,102.4L321.9,102.9L318.5,105.1L318.1,105.4L316.8,106.6L314.6,106.6L312.3,106.6L311,107.1L311.1,107.7L310.9,108.7L310.8,109L307,110.5L304.3,111L300.8,112.7L300.2,112.7L299.6,112.2L299.5,111.8L299.7,111.4L300.7,110.3L302.6,108.6L304.1,106.8L304.8,104.1L305.5,101.3L303.7,99.9L304.3,99.3L304.1,99L303.5,99L303.2,98.5L303.5,97.8L302.9,98.1L302.3,98L302.6,97.7L302.2,97.4L302.3,96.6L301,95.6L299.6,94.6L298,93.5L296.4,92.4L293.9,93.3L293.1,93.3L290.7,92.5L288.6,92.9L286.9,92L284.8,91.5L283.3,91.3L282.9,90.8L283.4,89.2L282.6,89.2L282,90.4L277.2,90.4L269.4,90.4L261.6,90.4L254.7,90.4L247.8,90.4L241.1,90.4L234.1,90.4L231.8,90.4L225,90.4ZM329.9,54.7L332.2,53.6L335,53.6L334.6,54.1L331.3,55.4L329.9,55.3ZM355.1,33.8L353.9,32.9L354.5,32.3L355.5,32.2L359.4,32.4L361.8,33.3L361.6,33.7L359.7,33.7L357.7,33.6L355.6,33.9ZM336.7,55.5L338,54.8L338.8,54.9L339,55.4L337.3,56.6L336.6,56.4L336.5,55.7ZM333.6,30.3L332,30.9L329.6,30.8L327.9,30.4L329.6,29.7L332.5,29.3L333.5,29.9ZM337.1,26.8L336.3,26.8L333.1,26.8L333.1,26.4L336.6,26.4L337.5,26.7ZM333.9,25.3L335.4,25.7L334.5,26.1L331.6,26.4L330.5,26.1L330.3,25.7L330.8,25.2L332.9,25.2ZM342.5,31.2L339.8,31L335.5,30.5L335.8,29.7L336.4,29L335.3,28.4L331.8,28.2L330.3,27.8L331.6,27.3L335.1,27.4L336.5,27.8L340,27.8L341,28.2L340,28.7L341.7,29.1L342.5,29.4L344.8,29.5L347.2,29.6L350.4,29.3L354.1,29.2L356.8,29.3L358.2,29.8L358.1,30.4L356.6,30.8L353.6,31.1L351.5,31L346.2,31.2ZM308,26L310.1,26.2L309.1,26.6L305.3,26.9L303.3,26.5L305.3,26.1ZM309.5,25.2L311.4,25.5L309,25.7L306.2,25.7L306.4,25.5L308.7,25.2ZM375,83.7L373.1,85.5L370.7,88L372.5,87L373.8,87.6L372.7,88.7L374.4,89.5L375.7,88.7L377.7,89.6L376.3,91.8L378.1,91.3L377.8,92.9L378,94.7L376.2,97.3L375.1,97.4L373.7,96.9L375,94.4L374.5,94.1L371,96.6L369.6,96.5L371.7,95.1L369.7,94.4L367.2,94.6L362.7,94.5L362.7,93.6L364.5,92.6L363.8,91.8L366.3,90L370.4,85.4L372.4,83.8L374.7,82.8L375.7,82.9ZM334.8,48.7L336.3,49.4L338.1,50.1L337.4,51.2L339,51L339.9,51.7L337.6,52.5L334.9,51.9L334.6,50.9L331.7,52.1L327.9,53.3L328.2,51.9L325.3,52.2L328,51L329.6,49.3L332,47.3L333.2,47.5L332.8,48.4L334.1,48.1ZM356.3,34.5L358.6,33.9L361.9,34.7L363.7,35.5L363.4,36.3L367.1,35.9L368.1,37L372.1,37.8L373.2,38.5L373.7,40.3L369.6,41.2L373.2,42.5L375.9,42.9L377.5,44.8L380.4,44.9L378.9,46.4L374,48.9L372.1,48L370.3,45.9L367.7,46.2L366.6,47.4L367.9,48.7L369.9,49.7L370.4,50.3L370.3,52.5L368.6,54.2L366.5,53.5L362.6,51.7L364.2,53.7L365.4,55.1L365.3,55.9L360.3,55L356.9,53.6L355.1,52.5L356.3,51.9L354.1,50.7L351.9,49.6L351.5,50.3L345.5,50.6L344.4,49.8L346.9,48.2L350.6,48.2L354.9,47.9L354.8,47.1L356.2,46.1L360.2,44.1L360.3,43.2L360.1,42.5L357.9,41.5L354.6,40.8L356.2,40.3L355.1,39.2L353.6,39L352.6,38.4L351.1,39L347.5,39.2L341.1,38.8L337.6,38.2L334.9,38L334,37.3L336.7,36.5L334.1,36.5L335.2,34.7L338.1,33.2L340.6,32.6L345.7,32.1L343.4,33.2L343.8,34.2L346.7,32.9L351.9,32.2L353.5,33.9L352.2,35ZM330.7,31.6L334.3,31.7L337.4,32.1L333.2,33.5L330.7,33.8L327.4,35.1L325.4,35L325.8,33.5L326.7,32.7L328.4,32ZM284,28.7L288.5,27.7L293.3,26.8L295.9,26.8L298.6,26.6L296.9,27.6L294.9,28.1L293.2,28.2L289.1,28.8L286,29ZM208.6,76.1L210.9,75.9L207.3,79L207.2,81.2L206.3,81.2L206.1,80L206.5,78.7L206.2,77.8L206.9,76.6L207.9,75.7ZM319.6,24.7L322.8,24.8L326.9,25.3L327.5,25.8L327.6,26.3L324.9,26.2L322.6,25.8L318.8,25.7L320.9,25.4L319.2,25.1ZM215.9,91.8L214.4,92.2L211.7,90.9L211.8,89.8L210.6,88.8L210.8,88L208.9,87.5L209.3,85.9L210.1,85.2L211.9,85.9L213,86.3L214.8,86.6L214.8,87.6L214.9,89L216.2,90.2ZM282.9,31.1L285,31.4L289.5,31.5L290.6,32L291.6,32.7L288.8,33.1L282.9,34.2L279,35.4L278,36.2L272,37.1L272.1,36.3L269.1,35.4L270.9,34.6L273.8,33.4L276.9,32.3L276.5,31.4ZM310,29.1L311.9,28.8L313.6,28.9L313.1,29.6L311.1,30.3L304.8,30.5L299.5,31.2L296.7,31.2L297.1,30.7L301.7,30.1L293.4,30.2L291.3,30L295.6,28.6L297.8,28.2L302.1,28.6L304.2,29.5L307.1,29.6L306.3,28.2L308.6,27.8L310.2,27.9L309.9,28.6ZM307.1,33.3L308.3,34L307.5,35.6L306.7,36.9L308.8,37.8L311.2,38.7L310.1,39.5L306.9,39.7L307.3,40.4L305.9,41.1L302.8,40.8L300.1,40.3L297.8,40.4L293.5,41.1L288.4,41.4L284.8,41.5L284.8,40.6L282.9,40.1L281,40.3L280.5,38.8L282,38.6L285.2,38.3L287.8,38.4L290.6,38L287.5,37.6L283.4,37.8L280.8,37.7L280.6,37.1L285.8,36.3L283,36.4L280.4,35.9L283.6,34.6L285.7,33.9L291.9,32.9L293.3,33.2L291.4,34L296.1,33.5L297.6,34.4L300.7,33.5L301.7,34L301.2,35.7L302.9,35L303.7,33.3L305.6,33ZM317.4,33.9L316.6,32.8L319.7,32.1L321.4,32.4L324.9,32.2L324.8,32.7L322.3,33.5L324.2,34.2L322.3,35.7L318.5,36.4L316.9,36.3L316.4,35.6L313.3,34.3L313.9,33.7ZM308,32.5L310.5,32.4L311.4,32.7L308.5,33.8L307.1,32.7ZM327.8,27.9L328.4,28.5L327.7,29.2L325.6,30.3L322.5,30.4L320.9,30.2L321.9,29.4L318.9,29.5L320.1,28.4L321.9,28.4L325.1,28L327.5,28ZM337.5,23.3L339,23L340.8,23L340.3,22.7L344.3,22.7L345.9,23.2L348.5,23.4L351,23.6L351.6,24.3L353.3,24.6L350.6,25L346.5,25.9L343.3,25.9L340,25.8L338.6,25.3L339.1,24.9L340.8,24.6L337.7,24.6L336.3,24.2L335.7,23.8ZM346.3,22.1L349,22L351,21.9L354.4,21.8L357.2,21.5L359.2,21.5L360.8,21.8L362.5,21.3L364.8,21.2L367.9,21.1L373,21.1L373.8,21.2L378.8,21.1L382.3,21.1L385.9,21.2L390.3,21.2L393.8,21.3L396.7,21.5L396.5,21.7L392.1,22.1L387.9,22.3L386.2,22.5L389.8,22.5L385.4,23L382.4,23.3L378.8,24.1L375.1,24.3L373.8,24.5L368.5,24.7L370.8,24.8L369.4,25L370.3,25.6L368.3,26L365.3,26.3L364,26.8L361.2,27.2L361.2,27.5L364.2,27.5L363.9,27.8L358.5,28.6L354.3,28.2L348.9,28.4L346.4,28.3L343.2,28.2L343.7,27.5L347.2,27.2L347.3,26.3L348.5,26.2L352.5,26.8L351,26L348.5,25.8L350.3,25.3L353.7,25L354.6,24.6L352.6,24.2L352.5,23.7L357,23.7L358.3,23.8L361.3,23.5L357.6,23.3L351.6,23.4L349,23.1L348,22.7L346.3,22.4ZM355.5,43.7L353.8,44.3L351.5,44.4L351.8,43.4L353.5,42.3L355.5,42L356.5,42.6L355.9,43.4ZM319,39.7L319.4,40.4L317.6,41.1L315.6,40.5L313.9,40.7L312.2,39.9L314.5,39.3L316.6,38.5L318.1,39L318.8,39.3ZM353.2,87.8L354.1,87.6L356.8,88.3L358.6,89.5L358.5,90.1L357.4,90.1L354.8,89.2ZM351.1,96.2L351.3,97.7L352.9,98.1L355.1,98L353.5,99.2L352.6,99.4L350,98.1L349.8,97.1Z",255.9,64.7],
["140","Zentralafrikanische Republik","M575.3,240.6L574.4,241L572.6,240.9L570.5,240.5L569.5,240.8L569.1,241.7L568.2,241.8L567.1,241L564.1,242.9L562.8,242.5L562.5,242.8L561.7,245L559.6,244.3L557.6,244L555.8,242.6L553.5,241.3L552.1,242.5L551,244.4L550.8,247L549,246.8L547.2,246.2L545.5,248.1L544.1,251.6L543.8,250.5L543.7,248.8L542.4,247.6L541.4,245.7L541.2,244.4L539.8,242.4L540,241.3L539.8,239.8L539.9,236.9L540.6,236.2L541.9,232.5L544.2,232.2L544.7,231.3L545.2,231.3L545.8,232.2L549.3,230.8L550.4,229.3L551.8,228L551.5,226.7L552.3,226.4L555,226.6L557.5,224.9L559.4,220.9L560.7,219.4L562.4,218.8L562.8,220.3L564.4,222.6L564.5,224.1L564.1,225.7L564.3,226.8L565.2,227.9L567.4,229.5L568.9,231L568.9,232.2L570.8,234.1L572,235.7L572.7,237.9L574.8,239.4Z",559.2,234.4],
["144","Sri Lanka","M724.4,232.1L724.3,236L723.2,237L720.8,237.9L719.4,234.9L718.5,229.6L719.3,223.6L721.4,225.7L722.8,228.3Z",721.7,232.6],
["148","Tschad","M563.9,188.1L564.7,202.4L562.3,202.2L561.2,204.9L560.5,207.1L561.1,208L560.3,209.1L560.6,210.6L560,212.1L559.8,213.5L560.7,213.3L561.3,214.7L561.4,216.8L562.4,217.9L562.4,218.8L560.7,219.4L559.4,220.9L557.5,224.9L555,226.6L552.3,226.4L551.5,226.7L551.8,228L550.4,229.3L549.3,230.8L545.8,232.2L545.2,231.3L544.7,231.3L544.2,232.2L541.9,232.5L542.3,231.5L541.5,228.9L541.1,227.4L539.8,226.8L538.2,224.6L538.8,222.9L540,223.3L540.8,223L542.3,223L540.8,219.7L540.8,217.3L540.6,214.8L539.5,212.5L539.7,210.7L538,210.7L537.9,208.3L536.8,207L537.8,202.2L541.2,198.7L541.2,194L542,186.7L542.5,185.2L541.3,183.9L541.3,182.8L540.2,181.9L539.4,176.3L542,174.4L552.9,181.2Z",552.7,195.7],
["152","Chile","M347.4,440L350.4,446.2L352.7,446.2L354.1,446.2L353.9,447.3L352.5,448.2L351.3,448.1L350,447.9L348,447.1L345.5,446.7L341.9,445.2L338.9,443.7L334.3,440.6L336.4,441.2L340.5,443L343.9,444L344.4,442.8L344.2,440.9L345.7,439.7ZM312.5,324.7L314.2,327.2L314.9,329.8L316.5,331.3L316.2,334.8L318.3,338.8L320.2,343.7L322,343.2L322.5,344.1L322.2,347.8L319.6,349.5L320.9,355.4L320.6,356.5L321.6,357.9L320.2,360.1L319.2,363.3L319,366.5L320.1,369.8L319.4,373.3L322,379.2L322.9,379.8L323.7,382.9L323.2,386.2L324.1,388.9L322.8,391.1L323.8,394.1L325.5,397.3L324.4,398.5L324.7,401.3L325.3,404.6L327.1,408.5L326.3,409.1L328.2,412.7L329.8,413.9L329.5,415.2L330.8,415.8L331.5,417L330.7,417.6L331.7,419.4L332.5,423.4L332.4,425.9L333.3,427.4L333.4,429.3L332.2,430.6L333.8,433.6L335.1,434.7L336.6,434.5L337.5,436.6L339.2,438.3L344.8,438.7L347.1,439.1L345.1,439.1L344.4,439.8L342.9,440.8L343.8,443.3L342.9,443.4L339.9,442.5L336.4,440.6L332.8,439L331.2,437.2L331,435.5L329,433.6L326.3,428.7L326,425.8L327.4,423.5L323.5,422.6L324.6,420L323.3,414.9L326.4,416L325.1,409.5L323.2,408.7L323.9,412.6L322.3,412.2L321.3,407.7L320,401.8L320.4,399.6L318.6,396.4L317.2,392.7L318.2,392.6L318.1,387.3L318.3,381.9L318,376.9L316.1,371.8L316.1,369L314.8,364.7L315.4,360.5L314.4,353.7L313.8,346.4L313.3,338.4L312.1,332.6L310.8,327.5L312.1,326.6Z",317.6,346.4],
["156","China","M794.4,193L792,191.9L791.2,188.8L792.1,187.2L794.8,186.2L796.4,186.3L797.3,187.6L796.5,189.2L796.4,191.3ZM693.1,110.6L692.1,108.8L693.4,108L689,102.6L693.1,101.4L694,100.7L693.1,95.3L698.2,96.3L698.8,94.9L697.4,92L699.1,91.7L699.8,89.7L700.6,89.5L702.3,91.5L705.1,93.1L709,94.2L711.9,96.6L712.8,100.2L714.3,101.5L717.4,102L720.8,102.4L724.7,104.3L726.3,104.7L728.8,107.5L731.2,109.4L733.8,109.3L739.1,110L742.1,109.6L744.7,110.1L749.2,112L752.2,112L753.7,113L755.7,111.3L758.9,110.2L762.5,110.1L764.7,108.9L765.4,107.3L766.5,106.2L765.5,105.2L764,104L764,102L765.5,102.3L768.3,102.9L769.7,101.3L772.5,100.1L772.9,98.1L773.9,97.3L777,96.9L779.1,97.2L778.6,96.2L775,94.1L772.5,93.1L771.5,94.2L768.9,93.8L767.9,94.1L766.4,92.9L766,90L765.4,87.8L769,88.9L770.8,87L769.8,85.8L769.5,82.8L770,81.9L768.7,80.3L766.9,79.6L767.6,78.3L769.9,77.8L772.8,77.7L776.8,78.5L779.6,79.5L783.4,82.4L785.3,83.6L787.6,85.3L790.7,88.2L795.5,89.1L799.8,91.2L803,93.9L806.5,93.9L807.6,92.8L810.7,91.9L811.6,94.6L811.6,95.7L813.4,99L814,101.9L810.7,101.4L809.5,102.5L812,105.1L814.2,108.8L813.1,108.8L814.1,110.4L811.4,108.6L811.6,110.3L808.7,111.7L810.2,113.4L808,113.3L806.3,112.3L806,114.5L804.4,116.2L803.6,118.3L800.8,119.2L799.8,120.7L797.7,121.6L798.1,120.1L796.9,118.8L797.6,116.7L795.3,115L793.8,116.1L792.4,118.4L792,120.5L789.7,120.6L789.3,122.1L791.8,124.3L794.1,124.9L794.9,126.3L797.4,127.3L798.9,124.9L801.8,126.2L803.4,126.3L804.8,128L801.7,128.9L801.5,130.7L799.9,132.4L799.7,134.7L803.3,136.5L805.9,139.9L808.8,142.9L811.7,145.6L812.8,148.1L811.6,149L813,150.8L814.9,151.9L815.7,154.7L816.1,157.5L814.8,157.8L814.3,161.6L813.8,166.1L812.8,170.3L810.2,173.6L807.4,176.6L804.5,177L803.3,178.6L802.1,177.4L801.1,179.2L797.8,181L795.2,181.5L795.2,185.3L793.8,185.5L792.4,182.9L792.7,181.5L788.8,180.4L787.7,181L784.8,180.1L783.2,178.6L783.1,176.6L780.5,175.9L778.8,174.6L777.1,176.5L774.6,176.9L772.5,176.9L771.3,177.7L770,178.3L771.4,182.3L770,182.2L769.5,181.4L769.1,179.9L767.4,181L766.1,180.3L763.8,179L763.8,176L762,175.3L760.5,172.1L757.9,172.6L757.1,168.5L758.7,165.5L758,162.6L757.1,160L755.7,159.1L754.2,157.1L752.8,157.3L749.8,156.8L750.2,155.4L748.4,153.2L747,154.7L744.5,153.8L742.2,156L740.6,158.6L738.7,159L737.2,158.1L735.8,158L733.8,157.2L732.6,158.1L731.6,160.7L730.6,158L729.2,158.7L726.1,158.3L723,157.5L720.4,156L718.2,155.3L716.9,153.7L715.3,153.2L712.1,150.9L709.7,149.9L708.9,150.7L704.6,148.3L701.5,146.2L699.7,142.4L701.7,142.9L701.3,141.1L699.7,139.4L699.1,136.7L695.2,132.8L690.6,131.4L689.1,128.9L686.7,127.4L686,126.4L685,124.6L684.7,123.3L682.9,122.5L682.2,122.9L680.6,119.9L681,119.1L680.4,118.4L682.2,116.9L683.7,116.2L686.4,116.7L686.6,114.6L689.5,114.3L689.9,113L693,111.3Z",767.3,135.1],
["158","Taiwan","M821.2,170.9L821.4,176.6L821.1,179.5L818.8,176.5L817.7,173.9L818.1,170.4L819.3,167.7L820.9,168.8Z",819.5,173.6],
["170","Kolumbien","M315.7,255.3L315.2,255.8L314.7,253.6L314,252.4L313,253.7L307.7,253.6L307.7,256L309.3,256.3L309.2,257.8L308.6,257.4L307.1,258L307.1,260.7L308.3,262L308.7,264.2L308.7,265.8L307.7,275.9L306.2,274L305.4,273.9L307.1,270.1L304.9,268.4L303.3,268.7L302.3,268.1L300.8,269L298.7,268.6L297.1,264.7L295.8,263.7L294.9,262L293,260.2L292.3,260.6L291.1,259.7L289.8,258.5L289,259L286.7,258.5L286,256.9L285.5,257L282.7,254.9L282.4,253.7L283.4,253.4L283.3,251.6L284,250.2L285.4,250L286.6,247.7L287.7,245.7L286.7,244.8L287.3,242.7L286.8,239.3L287.5,238.3L287.2,235.2L286.2,233.2L286.7,231.4L287.5,231.7L288.1,230.6L287.6,228.4L288,227.9L289.4,228L291.7,225.4L292.8,225L293,223.8L293.7,220.7L295.4,219L297.2,218.9L297.4,218.2L299.6,218.5L301.9,216.6L303,215.8L304.5,214L305.4,214.2L306.1,215.2L305.4,216.4L303.6,217.1L302.8,218.9L301.6,219.9L300.7,221.3L300.2,223.9L299.2,226.1L300.6,226.3L300.9,228L301.4,228.9L301.5,230.3L301.1,231.7L301.2,232.5L301.8,232.8L302.4,234.1L306,233.7L307.5,234.2L309.3,237.4L310.4,237L312.4,237.2L314,236.8L314.9,237.4L314.4,239.4L313.7,240.6L313.4,243.3L313.9,245.8L314.6,246.9L314.7,247.7L313.3,249.5L314.2,250.3L314.9,251.6Z",299.4,245.4],
["178","Republik Kongo","M550.8,247L550.7,249.2L549.8,251.2L549.3,253.5L549,256.8L549.1,258.9L548.7,260.2L548.6,261.6L548.3,262.8L546.5,264.6L545.2,266.5L544,270.1L544.1,273.1L543.4,274.3L541.8,276.1L540.1,278.4L539.1,277.8L538.9,276.7L537.4,276.7L536.5,278.1L535.7,277.7L534.7,276.5L533.9,277.1L532.8,278.7L530.5,274.8L532.6,272.7L531.6,270.3L532.6,269.3L534.4,268.9L534.6,267.2L536.1,269L538.5,269.2L539.4,267.4L539.7,264.9L539.4,262.1L538.1,259.9L539.3,255.6L538.6,254.8L536.6,255.1L535.8,253.2L536,251.6L539.5,251.7L541.7,252.7L543.9,253.6L544.1,251.6L545.5,248.1L547.2,246.2L549,246.8Z",543.7,259.1],
["180","Demokratische Republik Kongo","M580.7,276.7L581.2,280.1L580.9,282L581.4,284.2L582.9,286.2L584.3,290.9L583.2,290.5L579.5,291.1L578.8,291.6L577.9,293.9L578.5,295.6L577.9,299.9L577.4,303.6L578.1,304.3L580,305.7L580.7,305L580.8,309L578.7,309L577.7,306.9L576.7,305.4L574.7,304.9L574.1,302.9L572.4,304.1L570.2,303.6L569.4,301.9L567.7,301.6L566.4,301.7L566.3,300.5L565.3,300.4L564.1,300.2L562.4,300.8L561.2,300.7L560.5,301L560.8,296.6L559.9,295.3L559.7,293L560.2,290.8L559.6,289.4L559.6,287L556.3,287.1L556.6,285.7L555.2,285.7L555,286.4L553.3,286.5L552.6,288.7L552.2,289.6L550.6,289.1L549.7,289.6L547.9,289.9L546.9,288L546.3,286.8L545.5,284.6L544.9,281.8L536.8,281.7L535.8,282.2L535,282.1L533.9,282.6L533.5,281.5L534.2,281.1L534.3,279.5L534.7,278.5L535.7,277.7L536.5,278.1L537.4,276.7L538.9,276.7L539.1,277.8L540.1,278.4L541.8,276.1L543.4,274.3L544.1,273.1L544,270.1L545.2,266.5L546.5,264.6L548.3,262.8L548.6,261.6L548.7,260.2L549.1,258.9L549,256.8L549.3,253.5L549.8,251.2L550.7,249.2L550.8,247L551,244.4L552.1,242.5L553.5,241.3L555.8,242.6L557.6,244L559.6,244.3L561.7,245L562.5,242.8L562.8,242.5L564.1,242.9L567.1,241L568.2,241.8L569.1,241.7L569.5,240.8L570.5,240.5L572.6,240.9L574.4,241L575.3,240.6L577,243.6L578.2,244.1L579,243.5L580.2,243.7L581.8,242.9L582.4,244.5L584.9,247L584.8,251.3L585.9,251.8L585,253.1L583.9,254.1L582.9,256.1L582.3,257.8L582.2,260.8L581.5,262.2L581.5,265L580.7,266L580.6,268.2L580.2,268.5L579.9,270.5L580.6,272.2Z",563.2,270.4],
["188","Costa Rica","M274,224.6L273,224.9L272.9,226.4L273.4,226.9L272.9,227.4L273,228L272.7,228.8L272.5,229.5L271.1,228.7L270.6,227.9L271,227.3L270.9,226.5L270.2,225.6L269.2,224.9L268.3,224.4L268.2,223.3L267.6,222.7L267.7,223.7L267,224.6L266.5,223.6L265.6,223.2L265.3,222.5L265.5,221.4L265.9,220.2L265.2,219.7L265.9,219L266.4,218.5L268.1,219.5L268.8,219L269.6,219.3L270,220.1L270.8,220.3L271.5,219.5L272,221.5L272.9,223Z",270.4,223],
["191","Kroatien","M538.7,97.8L539.5,98.2L541.4,99.5L543.3,100L544.2,99.6L544.9,100.8L545.7,101.6L544.9,102.8L543.8,102.1L542.2,102.2L540.1,101.6L539,101.7L538.5,102.3L537.6,101.6L537.2,102.9L538.5,104.4L539.1,105.3L540.3,106.5L541.3,107.2L542.3,108.5L544.6,109.6L544.3,110.2L542,109L540.5,107.9L538.2,107L536,104.7L536.5,104.5L535.3,103.2L535.2,102.1L533.6,101.6L533,103L532.2,101.9L532.2,100.9L532.3,100.8L533.9,100.9L534.3,100.4L535.2,100.9L536.1,101L536,100.1L536.8,99.8L536.9,98.6Z",538.7,99.9],
["192","Kuba","M282.1,175.2L284.3,175.4L286.4,175.5L288.7,176.7L289.5,178L292,177.6L292.8,178.4L294.6,180.6L296,182.2L296.9,182.2L298.3,182.9L298,183.9L299.9,184.1L301.7,185.5L301.2,186.4L299.4,186.8L297.5,187L295.7,186.7L291.9,187.1L294,185.1L293.1,184.1L291.4,183.9L290.7,182.9L290.4,180.8L288.9,181L286.6,180L285.9,179.3L282.6,178.7L281.8,178L283,177.1L280.4,176.9L278.1,178.8L277,178.8L276.4,179.7L275,180.1L274,179.8L275.6,178.7L276.4,177.4L277.8,176.6L279.3,175.9L281.4,175.5Z",292.8,181.8],
["196","Zypern","M582.2,133.9L582.7,134.1L583.4,133.8L583.9,133.9L584.1,134.1L584.2,134.4L584.3,134.3L584.7,134.4L585.1,134.1L585.4,134.2L585.5,134.5L583.1,135.8L581.8,135.4L581.1,134.1Z",583,134.9],
["203","Tschechien","M533.8,84.3L535,85.2L536.7,85.4L536.6,86.2L537.9,86.8L538.2,86.1L539.8,86.4L540.1,87.3L541.8,87.5L543,88.9L542.4,88.9L542.1,89.4L541.5,89.6L541.5,90.2L541,90.4L541,90.7L540.3,91L539.2,90.9L539,91.6L537.9,91L536.8,91.1L534.9,90.3L534.2,90.5L533,91.7L531.2,90.7L529.8,89.5L528.6,88.8L528.2,87.6L527.8,86.7L529.4,86.1L530.1,85.3L531.7,84.8L532.2,84.2L532.8,84.6Z",532.6,87.8],
["204","Benin","M507.4,236.8L505.1,237.2L504.4,234.7L504.6,226.2L504,225.4L503.9,223.6L502.9,222.3L502.1,221.2L502.5,219.3L503.4,218.9L503.9,217.3L505.3,216.9L505.9,215.8L506.8,214.8L507.8,214.8L509.9,216.9L509.8,218.1L510.4,220.3L509.8,221.8L510.1,222.7L508.8,225L508,226.2L507.5,228.5L507.5,230.8Z",506.4,220.9],
["208","Dänemark","M521.6,73.5L520.2,73.9L518.6,73.6L517.6,72.1L517.4,69.4L517.7,68.7L518.2,67.9L520.1,67.7L520.8,67L522.5,66.3L522.5,67.6L521.9,68.5L522.2,69.2L523.4,69.6L523,70.6L522.3,70.3L520.9,72.2ZM526.7,70.5L527.5,71.8L526.4,74L524,72.5L523.6,71.4Z",519.7,70],
["214","Dominikanische Republik","M307.1,193.6L307.3,192.6L306.7,191.5L307.5,190.9L307.9,189.5L308,187.6L308.4,187L310.5,187L311.9,187.9L312.6,187.8L312.9,189.1L314.4,189L314.2,190.1L315.3,190.2L316.5,191.5L315.3,193L314.1,192.2L312.8,192.4L312,192.2L311.4,192.9L310.3,193.1L310.1,192.2L309.1,192.7L307.7,195.2L307.1,194.6Z",310.3,189.8],
["218","Ecuador","M292.3,260.6L292.7,263.4L291.9,265.8L288.9,269.7L285.7,271.1L284.1,274.4L283.6,276.9L282.1,278.4L280.9,276.5L279.8,276.1L278.7,276.4L278.5,275.1L279.3,274.2L278.9,272.6L280.3,269.9L279.7,268.2L278.7,270L277,268.3L277.5,267.3L277,263.9L278,263.4L278.5,261.1L279.5,258.7L279.3,257.1L280.8,256.4L282.7,254.9L285.5,257L286,256.9L286.7,258.5L289,259L289.8,258.5L291.1,259.7Z",284.8,264.6],
["222","El Salvador","M257.5,206.7L258.3,207.1L258.7,207.8L259.5,208.4L259.5,208.9L260.8,208.4L261.3,208.7L261.6,209.1L261.2,210.6L260.8,211.4L259.2,211.4L258.3,211L257.3,210.3L255.8,210.1L255.1,209.3L255.3,208.7L256.3,207.8L256.9,207.4L256.8,207Z",257.6,208.8],
["226","Äquatorialguinea","M526.6,251.5L531.1,251.6L531.1,256.1L527.1,256L526.2,256.3L525.6,255.7Z",528.4,253.8],
["231","Äthiopien","M631.1,230.3L623.7,241.4L620.1,241.6L617.7,244.2L615.9,244.3L615.2,245.5L613.3,245.5L612.2,244.2L609.7,245.8L608.9,247.3L607.1,247L606.5,246.6L605.8,246.7L604.9,246.6L601.4,243.5L599.5,243.5L598.5,242.3L598.5,240.2L597,239.6L595.3,235.5L594.1,234.7L593.5,233.2L592.1,231.4L590.4,231.1L591.3,229L592.7,229L593.1,227.8L593,224.5L593.6,220.7L594.9,219.6L595.1,218.1L596.1,215.3L597.7,213.5L598.6,209.9L598.9,206.8L602.1,207.5L602.8,204.8L604.5,206.5L606,205.6L606.7,206.4L608.6,206.4L611.1,207.9L611.8,209.1L613.1,210.3L614.4,212.4L615.4,213.6L614.5,215.3L613.7,217L613.9,218L614,219.1L615.6,219.2L616.2,218.9L616.9,219.6L616.3,220.9L617.4,222.9L618.5,224.7L619.6,226L628.8,230.4Z",607.3,230.9],
["232","Eritrea","M598.9,206.8L598.5,205.3L599.3,199.9L599.4,197.5L600.2,196.4L602.1,195.8L603.4,193.8L605.2,198L606.2,201.3L607.8,203.1L611.7,206.5L613.4,208.6L615,210.7L615.9,212L617.3,213.1L616.6,213.9L615.4,213.6L614.4,212.4L613.1,210.3L611.8,209.1L611.1,207.9L608.6,206.4L606.7,206.4L606,205.6L604.5,206.5L602.8,204.8L602.1,207.5Z",602.6,201.3],
["233","Estland","M558.4,61.9L558.8,62.3L557.6,63.7L558.8,66.1L558.1,66.9L556.3,66.9L554.3,66L553.3,65.7L551.6,66.1L551.5,64.6L550.8,64.9L549.3,64L548.8,62.6L551.3,61.9L553.9,61.5L556.2,61.9Z",555.4,64.1],
["238","Falklandinseln","M363,437.8L365,436.1L367.2,436.8L368.1,435.7L370.4,437L370.1,438L367.4,438.8L366,437.8L364.7,439.1Z",368.4,437.2],
["242","Fidschi","M979.9,324.5L980.8,323.9L981.4,324.9L980.3,326.8L978.4,327.3L977.1,326.8L977.4,325.2L978.9,324ZM986.1,321L984.1,321.9L982.2,322.7L982.3,321.3L983.8,320.6L984.8,320.4L986.7,319.2L986.7,319.2L986.1,321ZM13.3,319.2L13.3,319.2L13.3,319.2L13.8,319.1L14,320.8L13.9,321L13.9,321L13.3,319.2Z",979.1,325.6],
["246","Finnland","M554,40.5L554.1,41.9L557.4,43.2L556.1,44.8L559.1,47.2L558.3,49L560.5,50.7L560.1,52.1L563.5,53.7L563.1,54.9L561.6,56.3L558,59.3L554.3,59.5L550.8,60.4L547.5,60.9L546.1,59.6L543.9,58.8L544,56.4L542.6,54.3L543.3,53L544.8,51.5L548.8,49.1L550,48.7L549.6,47.7L546.6,46.7L545.8,45.9L545,42.7L541.7,41.4L539,40.4L540,39.9L542.3,40.9L544.8,40.8L546.9,41.3L548.5,40.5L549,39.1L551.8,38.4L554.4,39.2Z",553.9,53.4],
["250","Frankreich","M357.8,244.6L356.1,248L355.2,250.7L354.2,252.1L352.8,252.4L352.5,251.3L351.9,251.2L351,252.2L349.8,251.4L350.5,249.9L350.8,248.2L351.3,246.6L350.3,244.4L350.1,241.8L351.7,238.6L352.6,239.1L354.6,239.9L357.4,243.1ZM514.1,89L515.2,89.8L518.6,90.3L517.5,92.3L517.3,94.4L516.7,95L515.6,94.7L515.7,95.4L514.1,97.1L514.1,98.5L515.2,98L516,99.3L516,100.2L516.7,101.3L515.9,102.3L516.6,104.7L517.9,105L517.7,106.4L515.6,108.1L510.9,107.3L507.4,108.3L507.2,110.2L504.4,110.6L501.7,109.2L500.8,109.9L496.4,108.4L495.5,107.2L496.7,105.4L497.2,99.3L494.8,96.1L493.1,94.6L489.6,93.5L489.5,91.3L492.4,90.7L496.3,91.4L495.6,88.1L497.7,89.4L503,87.1L503.7,84.7L505.7,84.2L506,85.2L507.1,85.2L508.1,86.4L509.7,87.7L510.9,87.5L512.9,88.8L513.5,89.1ZM521,109.7L522.5,108.5L523,111.2L522.3,113.6L521.2,113L520.6,110.9Z",505.3,95.7],
["260","Französische Süd- und Antarktisgebiete","M658.4,428.5L659.5,429.5L661.5,429.8L661.3,430.4L660.1,431.7L656.5,431.9L657.2,430.3L658,429.1Z",658.7,430.5],
["262","Dschibuti","M615.4,213.6L616.6,213.9L617.3,213.1L618,214.2L618,215.7L616.5,216.6L617.8,217.6L616.9,219.6L616.2,218.9L615.6,219.2L614,219.1L613.9,218L613.7,217L614.5,215.3Z",615.4,217.6],
["266","Gabun","M531.1,251.6L532.4,251.4L534,251.9L535.7,251.4L536,251.6L535.8,253.2L536.6,255.1L538.6,254.8L539.3,255.6L538.1,259.9L539.4,262.1L539.7,264.9L539.4,267.4L538.5,269.2L536.1,269L534.6,267.2L534.4,268.9L532.6,269.3L531.6,270.3L532.6,272.7L530.5,274.8L527.7,271L525.9,268L524.2,264.1L524.3,262.9L524.9,261.7L525.6,259L526.2,256.3L527.1,256L531.1,256.1Z",531.1,262.2],
["268","Georgien","M595.4,107.2L595.6,106.8L597.8,107.4L601.4,107.9L605,109.4L605.5,109.9L606.9,109.4L609.3,110.1L610.3,111.4L612,112.1L611.5,112.6L613,114.3L612.8,114.7L611.5,114.5L609.4,113.5L609,114.1L605.7,114.6L603,113L600.5,113.2L600.6,111.8L599.5,109.7L597.9,108.5L596.5,108.1Z",607,112],
["270","Gambia","M454.6,209.8L457.5,209.7L458.2,208.8L459,208.8L460.1,209.6L460.9,209.7L461.8,209.1L462.4,210.1L461.2,210.9L460,210.9L458.8,210.1L457.8,210.9L457.3,211L456.6,211.5L454.2,211.4Z",456.4,210.6],
["275","Palästinensische Gebiete","M590.6,146.2L589.5,146.7L589.5,145.8L590,145.3L589.4,145L589.6,142.7L590.6,143.2L590.9,145.2Z",590.1,144.6],
["276","Deutschland","M531.1,76.9L531.7,78.3L531.2,79L532.1,80L532.8,81.5L532.7,82.5L533.8,84.3L532.8,84.6L532.2,84.2L531.7,84.8L530.1,85.3L529.4,86.1L527.8,86.7L528.2,87.6L528.6,88.8L529.8,89.5L531.2,90.7L530.5,92.1L529.7,92.5L530.2,94.4L530,94.9L529.2,94.3L528.1,94.2L526.5,94.7L524.4,94.6L524.2,95.4L522.9,94.6L522.2,94.7L519.7,93.8L519.3,94.5L517.3,94.4L517.5,92.3L518.6,90.3L515.2,89.8L514.1,89L514.2,87.7L513.7,87.1L513.9,85.1L513.4,82.2L514.7,82.2L515.3,81.1L515.7,78.6L515.2,77.6L515.6,77L517.5,76.9L517.9,77.5L519.3,76.1L518.8,75.1L518.6,73.6L520.2,73.9L521.6,73.5L521.7,74.6L524,75.2L524,76.2L526.2,75.7L527.4,74.9L530,76Z",521.8,83.2],
["288","Ghana","M500.1,219.2L499.9,220.4L501,222.3L501,224.9L501.3,227.9L501.9,229.2L501.3,232.5L501.6,234.4L502.3,236.7L502.9,238L498.6,240.2L497.1,241.4L494.6,242.5L492.1,241.5L492.3,240L491.1,236.8L491.8,232.6L493,229.5L492.3,224.3L491.9,221.5L492,219.4L496.7,219.3L497.9,219.5L498.8,218.9Z",496.5,235.4],
["300","Griechenland","M566,133.4L565.8,134.4L562.2,134.7L562.2,134.1L559,133.5L559.4,132.1L560.8,133.2L562.8,133L564.7,133.2L564.7,133.8ZM555.6,113.8L557.4,113.9L559.2,113L561.1,114.1L563.2,113.8L563,112.2L564.3,113.1L563.8,115.1L563.3,115.4L561.8,115.3L560.5,115L557.7,115.9L559.6,117.6L558.4,118.2L557,118.2L555.6,116.5L555.2,117.2L555.9,119.1L557.3,120.7L556.5,121.4L558,122.9L559.3,123.8L559.5,125.6L557.2,124.8L558.1,126.4L556.5,126.8L557.8,129.7L556.1,129.7L553.9,128.3L552.8,125.7L552.1,123.5L551,122L549.6,120.2L549.3,119.3L550.3,117.7L550.4,116.7L551.1,116.2L551.1,115.4L552.6,115.1L553.5,114.4L554.8,114.4L555.1,113.9Z",552.8,119.4],
["304","Grönland","M421.9,21.5L427.7,21.1L433.6,21.1L435.8,20.8L441.7,20.8L455,20.9L465.2,21.4L462,21.8L455.6,21.8L446.6,21.9L447.4,22L453.3,21.9L458.3,22.2L461.6,22L462.9,22.3L460.9,22.8L465.3,22.5L473.5,22.1L478.5,22.3L479.4,22.7L472.4,23.3L471.4,23.6L466,23.7L469.9,23.8L467.7,24.6L466.2,25.3L465.9,26.7L467.8,27.5L465,27.6L462.1,28L465.1,28.7L465.3,29.9L463.3,30.1L465.3,31.4L461.3,31.5L463.3,32.1L462.5,32.7L459.9,32.9L457.4,32.9L459.4,34.1L459.2,34.8L455.8,34.1L454.8,34.6L457.1,35L459.3,36.1L459.6,37.5L456.2,37.9L455,37.1L452.9,36.1L453.2,37.3L450.8,38.3L455.7,38.4L458.3,38.5L452.8,40.1L447.3,41.7L441.5,42.4L439.4,42.4L437.1,43.1L433.7,45.3L429.1,46.8L427.7,46.9L424.9,47.4L421.9,47.9L419.7,49.3L419,50.8L417.5,52.3L413.5,54.1L413.6,56L412,57.9L410,60.3L407.1,60.5L404.8,58.5L400.7,58.5L399.2,57.1L398.9,54.8L396.7,52L396.4,50.5L397.1,48.5L395.4,46.5L396.9,45L396,44.3L399.2,41.9L402.4,41.2L403.6,40.3L404.8,38.9L402.3,39.5L401.1,39.8L399.3,40.1L397.3,39.5L397.9,38.2L399.2,37.2L401,37.2L404.5,37.7L401.9,36.5L400.6,35.9L398.7,36.2L397.4,35.7L400.4,34.1L399.7,33.5L399,32.4L397.9,30.7L396,30.1L396.4,29.5L392.3,28.7L388.6,28.6L383.9,28.7L379.5,28.8L377.8,28.3L375.5,27.5L380.4,27.1L384,27L376.8,26.7L373.4,26.2L374,25.7L381,25.1L387.7,24.6L388.7,24.2L384.4,23.8L386.3,23.4L392.6,22.7L395.2,22.6L394.8,22.2L398.9,22L404.2,21.9L409.3,21.9L411,22.1L415.7,21.7L419.5,22L421.9,22L425.2,22.3L421.5,21.9Z",417.8,35.2],
["320","Guatemala","M249.8,206.3L250,205.3L250.4,204.4L250.1,203.7L251.9,200.8L255.4,200.8L255.7,199.5L255.3,199.3L255.1,198.5L254.2,197.7L253.4,196.5L254.6,196.5L255,194.4L257.5,194.4L260,194.5L259.5,197.3L258.6,201.4L259.4,201.4L260.2,202.1L260.5,201.5L261.3,202L259.8,203.4L258.4,204.4L258.1,205.1L258.2,205.8L257.5,206.7L256.8,207L256.9,207.4L256.3,207.8L255.3,208.7L255.1,209.3L253.8,208.6L252.1,208.6L251,207.8Z",254.1,204.5],
["324","Guinea","M462.7,213.5L464,213.5L465.9,214.4L466.5,214.3L466.8,213.9L468.2,214.2L468.6,214L468.8,215.3L469.2,215.3L469.9,214.8L470.4,215L471.1,215.9L472.3,216.2L473,215.4L473.9,214.9L474.6,214.4L475.1,214.5L475.7,215.3L476,216.3L477.1,217.9L476.6,218.8L476.4,220L477,219.6L477.4,220.1L477.2,221.2L478,222.2L477.5,222.5L477.3,223.7L477.9,225.3L478.5,228.2L477.5,228.7L477.2,229.2L477.5,229.9L477.3,231.5L476.8,231.5L476.1,231.4L475.5,232.9L474.7,232.9L474.2,232.1L474.4,230.6L473.3,228.4L472.5,228.8L472,228.9L471.2,229.1L471.2,227.7L470.8,226.7L470.9,225.7L470.3,224.1L469.6,222.8L467.4,222.8L466.8,223.5L466,223.6L465.5,224.4L465.2,225.4L463.7,227L462.5,224.8L461.5,223.4L460.8,222.9L460.1,222.2L459.8,220.6L459.5,219.7L458.7,219.1L459.9,217.4L460.7,217.4L461.5,216.8L462.1,216.8L462.5,216.3L462.3,215.1L462.6,214.7Z",466.1,218.7],
["328","Guyana","M344.2,252.9L343.6,253.1L342.1,252.8L341.1,253.8L339.9,254.4L339,254.6L338.7,255.3L337.4,255.1L335.7,253.4L335.5,251.6L334.8,249.8L335.3,246.6L336.1,245.3L335.5,243.6L334.6,243L335,241.4L334.4,240.5L333,240.7L331.2,237.9L332,236.9L332,235.2L333.7,234.6L334.5,233.9L333.6,232.5L333.9,231.2L336.2,229L337.9,230.4L339.5,232.8L339.5,234.7L340.5,234.8L341.9,236.6L342.9,237.8L342.4,241.2L340.7,242.1L340.8,243L340.2,244.9L341.4,247.6L342.3,247.6L342.6,249.7Z",338.2,238.7],
["332","Haiti","M308,187.6L307.9,189.5L307.5,190.9L306.7,191.5L307.3,192.6L307.1,193.6L305.4,193L304.1,193.2L302.5,193L301.1,193.6L299.8,192.5L300.2,191.4L302.6,191.9L304.6,192.1L305.7,191.3L304.7,189.8L304.9,188.4L303.4,187.8L304.1,186.9L305.7,187Z",306.4,189.3],
["340","Honduras","M274.6,204.7L273.7,204.6L273.3,205.1L272.3,205.6L271.6,205.6L270.9,206L270.4,205.9L270,205.3L269.7,205.4L269.2,206.3L269,206.3L268.8,207L267.8,208L267.2,208.4L266.9,208.9L266.1,208.2L265.4,209.1L264.9,209.1L264.2,209.2L264.1,211L263.6,211L263.2,211.9L262.3,212L262,210.9L261.2,210.6L261.6,209.1L261.3,208.7L260.8,208.4L259.5,208.9L259.5,208.4L258.7,207.8L258.3,207.1L257.5,206.7L258.2,205.8L258.1,205.1L258.4,204.4L259.8,203.4L261.3,202L261.5,202.1L262.2,201.5L263,201.4L263.2,201.7L263.6,201.6L264.8,201.9L266.1,201.8L267,201.4L267.4,201L268.3,201.2L268.9,201.4L269.6,201.3L270.2,201L271.3,201.5L271.7,201.6L272.5,202.3L273.1,203.1L274,203.7Z",263.4,205.5],
["348","Ungarn","M550.8,92.1L552.2,92.9L552.5,93.7L551.2,94.3L550.3,96.3L549.2,98.4L547.4,98.9L545.9,98.8L544.2,99.6L543.3,100L541.4,99.5L539.5,98.2L538.7,97.8L538.1,96.8L537.7,96.7L538.3,94.8L537.8,94.2L539.1,94.2L539.2,93L540.4,93.7L541.3,94L543.2,93.7L543.3,93.1L544.2,93L545.3,92.5L545.6,92.7L546.6,92.3L547.1,91.7L547.8,91.5L550.4,92.4Z",547,95.7],
["352","Island","M471.8,45.8L471.2,47.2L473.2,48.6L470.4,50.3L464.4,51.9L462.6,52.3L460.1,51.9L454.6,51.2L456.8,50.2L452.7,49.1L456.3,48.7L456.3,48.1L452.3,47.6L454,46.2L457,45.9L459.7,47.3L462.9,46.2L465.3,46.8L468.6,45.6Z",463.1,49.2],
["356","Indien","M752.8,157.3L753.4,158.7L752.7,159.3L753.5,161.4L751.5,160.8L748.8,163.2L749.4,165.2L748.8,168.2L749.1,169.9L748.7,172.8L746.4,172L747.2,175.7L746.9,176.9L747.5,178.4L746.4,179.2L743.7,173.6L743,173.6L743.1,175.9L741.2,174L741.5,172L742.6,171.8L743.1,168.8L741.4,168.2L739,168.3L736.4,167.8L735.5,165.4L734.2,165.2L731.7,163.7L731.4,166L733.8,167.9L732.5,169.2L732.2,170.5L734.1,171.5L734.1,173.6L735.6,176.3L736.7,179.2L736.6,180.5L734.8,180.4L731.7,181.2L732.4,183.9L731.4,186L728,188.4L725.7,192.7L724,194.9L721.7,197.3L722,199L720.8,199.9L718.5,201.2L717.3,201.4L716.8,204.1L718,208.9L718.5,211.9L717.7,215.4L718.3,221.7L716.9,221.8L715.9,224.6L716.9,225.9L714.4,226.9L713.7,229.4L712.7,230.5L709.8,227L708.2,221.9L706.8,218.2L705.7,216.4L703.9,212.9L702.7,208.3L702,206L698.9,201L696.8,194L695.3,189.4L694.6,185L693.5,181.7L690,183.8L688.1,183.4L683.9,179.1L684.9,177.8L683.9,176.4L680.3,173.4L681.6,171L687.4,171L686.3,168L684.4,166.2L683.6,163.5L681.5,161.9L683.6,158.3L686.7,158.6L688.6,154.9L689.3,151.4L691,148L690.3,145.6L691.9,143.6L689.4,141.9L687.9,139.6L686.1,136.7L686.9,135.2L691,136.1L693.6,135.6L695.2,132.8L699.1,136.7L699.7,139.4L701.3,141.1L701.7,142.9L699.7,142.4L701.5,146.2L704.6,148.3L708.9,150.7L707.7,152.3L707.5,155.5L710.4,156.8L713.3,158.5L717.2,160.5L720.9,160.9L722.8,162.7L724.9,163L728.3,163.8L730.5,163.8L730.4,162.4L729.5,160.2L729.2,158.7L730.6,158L731.6,160.7L731.9,161.4L734.6,162.7L736.1,162.2L738.3,162.4L740.5,162.3L740,160.2L738.7,159L740.6,158.6L742.2,156L744.5,153.8L747,154.7L748.4,153.2L750.2,155.4L749.8,156.8Z",712.1,178.4],
["360","Indonesien","M888.3,269.7L887.6,281.7L886.3,293.8L884.2,290.7L881.6,290L880.7,291.1L877.3,291.2L878.8,288.2L880.6,287.1L880.3,283.1L879.3,280L874.2,276.9L871.9,276.6L868,273.1L867.1,274.9L866,275.3L865.4,273.9L865.5,272.3L863.5,270.5L866.5,269.1L868.5,269.2L868.3,268.2L864.2,268.2L863.2,266L860.8,265.3L859.6,263.5L863.4,262.6L864.8,261.4L869.2,262.9L869.6,264.3L870.2,270.3L873,272.5L875.4,268.6L878.6,266.3L881.1,266.3L883.4,267.6L885.4,268.9ZM842.4,292.9L842.6,293.7L842.5,294.8L840.3,297.5L837.9,298.3L837.6,297.9L838,296.7L839.5,294.4ZM868.5,285.6L868.5,282.8L869.1,281.4L869.8,280.2L870.4,281.3L870.2,283ZM824.4,244.6L823,248L825.2,251.5L824.7,253.2L827.9,256.6L824.6,257.1L823.7,259.6L823.8,263L821.1,265.5L821,269.2L819.7,274.9L819.3,273.6L816.1,275.2L815.1,273L813.2,272.8L811.9,271.6L808.5,272.9L807.6,271.1L805.8,271.3L803.5,270.9L803.2,265.9L801.9,264.9L800.6,261.7L800.2,258.5L800.5,255L802.1,252.6L802.6,255L804.5,257.1L806.3,256.4L808,256.6L809.6,254.8L810.9,254.4L813.6,255.5L815.8,254.7L817.1,249.5L818.1,248.2L818.8,244L822,244ZM856.3,270.4L859.3,271.5L860.1,274.3L857.9,272.8L855.6,272.5L854,272.7L852.1,272.6L852.9,270.6ZM849.2,274.1L847.4,273.4L846.9,271.8L849.7,271.6L850.3,272.8ZM852.4,251.9L852.7,254L854.3,254.3L854.6,255.8L854.5,259L853,258.7L852.6,260.9L853.7,262.9L853,263.3L851.9,261L851,256.2L851.5,253.3ZM838.7,256.7L841.9,256.6L844.6,253.9L845.1,254.7L842.9,258.4L840.8,259.1L838.2,258.4L833.6,258.6L831.2,259.1L830.8,261.9L833.2,265.2L834.7,263.5L839.9,262.3L839.6,264L838.4,263.5L837.2,265.6L834.7,267.1L837.2,271.8L836.6,273.1L838.9,277.4L838.7,279.8L837.1,280.9L836.1,279.6L837.7,276.6L834.9,278L834.3,277L834.7,275.5L832.8,273.4L833.2,269.8L831.3,270.9L831.3,275.2L831.1,280.5L829.3,281L828.2,280L829.2,276.5L829,273L827.8,272.9L827.1,270.4L828.3,268L828.8,265L830.2,259.4L830.8,257.9L833.1,255.1L835.2,256.2ZM828.9,298L825.6,295.4L828.3,294.7L829.6,295.8L830.4,296.9L830.1,297.9ZM832.6,291.6L834.4,291.3L837.1,290L836.4,292L832.2,293.1L828.6,292.6L828.7,291.3L831,290.5ZM824.2,291L825.9,290.7L826.5,292.3L823.2,293L821.2,293.5L819.8,293.5L820.9,291.3L822.5,291.3L823.3,290ZM798,283.8L798.3,285.1L803.6,285.5L804.3,284L809.2,285.8L810,288.1L814.1,288.8L817.2,291L813.9,292.4L811.1,290.9L808.6,291L805.8,290.8L803.3,290.1L800.2,288.7L798.2,288.3L797.1,288.8L792.2,287.3L791.8,285.7L789.3,285.4L791.5,281.9L794.8,282.1L796.9,283.5ZM787.6,264L788,266.6L788.9,268.7L790.9,269L792.2,271.4L791.3,276L790.9,281.7L787.8,281.8L785.7,278.7L782.3,275.7L781.2,273.4L779.3,270.4L778,267.6L775.9,262.4L773.5,259.3L772.7,256.1L771.6,253.2L769.1,250.9L767.6,247.7L765.4,245.6L762.4,241.6L762,239.7L763.8,239.8L768.1,240.5L770.7,244.2L772.9,246.7L774.5,248.2L777.2,252.2L780,252.3L782.4,254.8L784,257.9L786.1,259.6L785,262.6L786.6,263.9Z",813.2,263.6],
["364","Iran","M625.2,151.6L623.5,149.8L623.2,148L622.3,148L622.3,145.5L620.6,142.9L617.1,141.1L614.8,137.9L614.9,135.2L616,134.1L615.4,132.2L613.6,131.2L611.2,127.2L609.3,124.6L609.6,123.6L608.1,119.9L609.6,119L610.2,120.2L611.8,121.7L613.6,122.1L614.4,122L616.8,119.6L617.7,119.4L618.6,120.3L618.1,121.9L620,123.6L620.6,123.5L621.9,125.9L624.4,126.6L626.5,128.2L630.2,128.8L633.9,127.9L633.9,127.1L636,126.5L637.3,124.6L638.9,124.7L639.9,124.1L641.7,124.4L644.9,126.1L646.9,126.4L650.5,129.3L652.4,129.5L653.4,132.3L653.4,136.4L653.3,138.8L654.5,139.3L653.8,141.2L655.3,143.9L655.9,146L658,146.6L658.7,148.8L657,151.9L658.7,153.7L660.1,155.8L662.9,157.4L663.6,160.4L665,161L665.5,162.6L662,164.4L661.8,168.5L656.6,167.4L653.6,166.6L650.6,166.2L648.8,161.9L647.4,161.2L645.5,161.9L643.2,163.6L639.8,162.4L636.7,159.7L634,158.7L631.8,155.4L629.1,150.8L627.8,151.4L626,150.3Z",639.3,141],
["368","Irak","M600,144L598.4,139.8L603.4,136.4L603.7,132.3L603,129.9L604.3,129.1L605.2,127L606.1,126.5L609.1,127L610.1,127.8L611.2,127.2L613.6,131.2L615.4,132.2L616,134.1L614.9,135.2L614.8,137.9L617.1,141.1L620.6,142.9L622.3,145.5L622.3,148L623.2,148L623.5,149.8L625.2,151.6L623.7,151.4L621.9,151.1L620.5,154.4L615.7,154.2L607.4,147.3L603.2,144.9Z",608.7,140.4],
["372","Irland","M486.4,76.6L486.6,78.5L484.9,81L480.8,82.7L477.7,82.3L479.7,79.3L478.7,76.5L481.8,74.4L483.5,73.1L483.9,74.6L483.4,76L484.7,76Z",482.5,78.8],
["376","Israel","M590.9,142.1L590.6,143.2L589.6,142.7L589.4,145L590,145.3L589.5,145.8L589.5,146.7L590.6,146.2L590.8,147.6L590.2,153.1L589.9,152.2L587.8,147.2L588.4,146L588.2,145.8L588.7,144.3L588.9,141.7L589.1,140.8L589.2,140.8L590.1,140.8L590.2,140.2L590.9,140.2L591.1,141.6L590.8,142.1Z",589.5,148],
["380","Italien","M524.3,96.6L525.8,97L526,96.5L528.3,96L528.8,97L532.3,97.8L532.1,99.3L532.8,100.6L530.9,100.1L529,101.2L529.3,102.7L529,103.6L529.9,105.2L532.3,106.7L533.7,109.3L536.5,111.8L538.4,111.8L539.1,112.5L538.4,113.1L540.7,114.3L542.6,115.2L544.8,116.9L545.1,117.5L544.7,118.7L543.2,117.2L541.1,116.6L540.2,118.7L542.1,119.9L541.9,121.6L540.9,121.8L539.8,124.6L538.8,124.8L538.7,123.8L539.1,122.1L539.6,121.4L538.5,119.5L537.6,117.9L536.6,117.5L535.8,116.1L534.2,115.5L533,114.3L531.2,114L529.2,112.6L526.9,110.6L525.2,108.8L524.3,105.7L523.1,105.3L521.1,104.3L520,104.7L518.7,106.2L517.7,106.4L517.9,105L516.6,104.7L515.9,102.3L516.7,101.3L516,100.2L516,99.3L517.1,100L518.2,99.8L519.5,98.8L519.9,99.3L521,99.2L521.5,98L523.2,98.4L524.2,97.9ZM536.5,124L538.3,123.8L537.6,126.3L538,127.4L537.6,129L535.6,127.8L534.4,127.4L530.8,125.8L531.1,124.1L534,124.4ZM521.2,115.2L522.3,114.2L523.9,116.4L523.7,120.7L522.6,120.5L521.7,121.6L520.7,120.7L520.4,116.8L519.8,115Z",525.1,101.8],
["384","Elfenbeinküste","M478,222.2L478.4,221.9L479.2,222.4L481.3,222.5L481.8,221.4L482.2,221.5L483,221L483.5,222.6L484.1,222.2L485.2,221.6L486.4,222.4L486.9,223.6L488.2,224.4L489.1,223.5L490.4,223.3L492.3,224.3L493,229.5L491.8,232.6L491.1,236.8L492.3,240L492.1,241.5L490.9,241.5L489,240.8L487.2,240.8L484,241.5L482,242.5L479.3,243.9L478.8,243.8L479,240.8L479.3,240.3L479.2,238.8L478,237.3L477.2,237L476.4,236L477,234.4L476.7,232.6L476.8,231.5L477.3,231.5L477.5,229.9L477.2,229.2L477.5,228.7L478.5,228.2L477.9,225.3L477.3,223.7L477.5,222.5Z",484.4,233.1],
["388","Jamaika","M291.5,192L293.3,192.3L294.6,193.2L294.9,194.2L293,194.2L292.1,194.8L290.7,194.3L289.3,192.9L289.8,192.1L290.9,191.9Z",291.9,193.4],
["392","Japan","M848.3,120.7L848.1,123.9L850.3,127.3L850.9,130L852.3,131.6L852.4,133.9L850,135.5L845.7,135.7L844.2,139.6L841.8,138.3L840.4,135.8L836.4,136.5L834.2,138.1L831.3,138.1L835.1,140.6L836.2,146.4L835.2,147.8L833.4,146.5L832.6,143.4L830.5,142.4L828.3,140.1L830.2,139.1L830.4,137L832,135.2L832.7,133L837.1,132L840.2,132.7L839.4,126.8L842,128.4L843.6,125.1L844.2,123.8L843.2,119.9L840.4,116.2L840.1,114.2L842.2,113.7L846.6,118.1ZM844,105.6L844.7,104.3L847.9,107.7L845,108.6L845.2,111.7L839.9,109.6L841,113L838.4,113L835.8,109.9L835.3,107.5L837.7,107.3L835.1,103.1L833.9,100.7L839.2,103.9L841.9,104.9ZM835.5,139.6L835.9,137.6L837.5,137.9L837.8,136.5L840.1,137.3L841,138.4L840.6,140.4L839,139.4L838.1,140.1L838.5,142.1L836.3,141.2Z",846.1,130.8],
["398","Kasachstan","M699.8,89.7L699.1,91.7L697.4,92L698.8,94.9L698.2,96.3L693.1,95.3L694,100.7L693.1,101.4L689,102.6L693.4,108L692.1,108.8L693.1,110.6L691.4,110.1L689.7,109L686,108.7L682,108.6L681.3,108.9L677.4,107.6L676.3,108.3L676.6,110.1L672.2,109L670.8,109.5L670.8,110.8L669.6,111.4L667.2,113.6L666.9,115.9L666,115.9L664.8,114.4L661.7,114.3L660.4,111.7L659.2,111.7L658.3,108.6L654.7,106.3L650.6,106.5L648,107L644.8,104.2L642.5,103L638.1,100.8L637.6,100.6L632.1,102.4L635.6,113.9L634.4,114L632,111.5L630.1,110.7L627.6,111.3L626.8,112.4L626.4,111.6L626.7,110.3L625.9,109.2L622.8,108.1L621,105.3L619.5,104.6L619.1,103.6L621.5,103.8L621,101.6L622.8,101.1L625,101.6L624.6,98.6L623.6,96.7L621.3,96.9L619.1,96.2L616.8,97.5L614.8,98.1L613.5,97.6L613.3,96.1L611.2,94.1L609.5,94.2L607,92.2L607.7,89.9L606.8,89.3L607.7,86.1L610.5,87.8L610.2,85.7L613.8,82.6L617.3,82.5L622.9,84.5L626,85.7L628,84.5L631.5,84.4L635,85.9L635.3,85L638.5,85.2L638.5,83.8L634.1,81.9L635.7,80.5L634.9,79.7L636.8,79L634.4,77.1L635,76.2L642.7,75.2L643.5,74.6L648.5,73.6L649.9,72.4L654,73L656.2,75.8L658.1,75.2L661.4,76.1L662,77.6L664.1,77.4L668.2,74.9L667.8,75.7L671.8,77.8L680.6,85L681,83.5L685,85.1L687.9,84.4L689.4,84.9L691.4,86.6L693.3,87.1L694.9,88.4L697.6,88Z",665.5,93.8],
["400","Jordanien","M590.6,143.2L590.9,142.1L593.9,143.4L598.4,139.8L600,144L599.6,144.5L594.7,146.2L597.7,149.6L596.9,150.2L596.7,151.3L594.8,151.8L594.3,153L593.3,154.1L590.4,153.6L590.2,153.1L590.8,147.6L590.6,146.2L590.9,145.2Z",593.5,149.2],
["404","Kenia","M607.9,277.3L604,273.6L603.8,271.5L593.9,263.9L593.4,263.5L593.4,259.6L594.2,258.1L595.5,255.6L596.5,252.9L595.3,248.7L594.9,246.8L593.6,244.2L595.2,242L597,239.6L598.5,240.2L598.5,242.3L599.5,243.5L601.4,243.5L604.9,246.6L605.8,246.7L606.5,246.6L607.1,247L608.9,247.3L609.7,245.8L612.2,244.2L613.3,245.5L615.2,245.5L612.9,249.7L612.9,263.2L614.6,266.2L612.6,267.7L611.9,269.3L610.9,269.6L610.5,272.2L609.6,273.7L609,276.1Z",603.7,259.8],
["408","Nordkorea","M814.9,111L814.9,111L814.9,111ZM814.1,110.4L814.9,111L813.8,110.8L813.5,111.9L813.5,112.9L815,115.2L814.2,115.9L814.1,116.5L813.8,117.4L812.5,118L811.9,118.8L812.7,120.2L812.6,120.6L813.9,121.1L816.1,122.5L816.2,123.3L815.3,123.5L813.7,123.7L813.5,125.2L812.4,125L812.4,125.3L810.8,124.7L810.9,125.3L810.3,125.6L809.9,125L809.1,124.7L808.1,124.2L808,122.7L808.3,122.4L807.8,121.8L807.4,120L806.9,119.5L805.3,119.1L803.6,118.3L804.4,116.2L806,114.5L806.3,112.3L808,113.3L810.2,113.4L808.7,111.7L811.6,110.3L811.4,108.6Z",809.1,116.8],
["410","Südkorea","M812.4,125.3L812.4,125L813.5,125.2L813.7,123.7L815.3,123.5L816.2,123.3L816.1,122.5L820.5,126.4L822.3,128.5L824.4,132.3L824.4,134.1L822.5,134.8L821.2,136.2L819.1,136.4L817.9,134.6L817,132.1L814.1,128.7L815.6,128.1Z",820.5,132.1],
["414","Kuwait","M623.7,151.4L624.5,152.9L624.3,153.7L625.6,156.3L623.8,156.4L622.9,154.8L620.5,154.4L621.9,151.1Z",622.8,153.2],
["417","Kirgisistan","M670.8,110.8L670.8,109.5L672.2,109L676.6,110.1L676.3,108.3L677.4,107.6L681.3,108.9L682,108.6L686,108.7L689.7,109L691.4,110.1L693.1,110.6L693,111.3L689.9,113L689.5,114.3L686.6,114.6L686.4,116.7L683.7,116.2L682.2,116.9L680.4,118.4L681,119.1L680.6,119.9L676.1,120.4L672.7,119.3L670.2,119.6L669.8,117.7L672.6,118.3L673.2,117.3L675.1,117.6L677.4,115.3L674,113.6L672.5,114.4L670.3,113.2L671.6,111.2Z",680.9,113],
["418","Laos","M791.6,207.6L788.9,206.2L788.1,208.7L785.7,207.3L786.3,205.7L785.8,202.6L783.1,199.4L782.2,195.8L779.6,192.9L777.5,192.6L777.2,193.9L775.6,194L774.7,193.4L772.3,195.5L771.6,192.3L771.4,188.5L769.6,188.3L769,186.2L767.6,185L767.8,183.7L769.5,181.4L770,182.2L771.4,182.3L770,178.3L771.3,177.7L773.5,180.5L775.5,183.8L778.8,183.8L780.6,187L779.1,187.9L778.6,189.2L782.3,191.3L785.4,195.6L787.8,198.8L790.3,201.3L791.4,203.9Z",775.1,187.6],
["422","Libanon","M590.9,140.2L590.2,140.2L590.1,140.8L589.2,140.8L589.7,138.1L590.7,135.7L590.7,135.6L591.8,135.8L592.4,137.1L591.2,138.3Z",591.3,136.9],
["426","Lesotho","M575,365.1L575.8,366.1L574.9,367.8L574.3,368.9L572.8,369.4L572.3,370.5L571.3,370.9L569.6,368.2L571.2,366.1L572.7,364.7L574,364Z",572.9,367.3],
["428","Lettland","M558.1,66.9L559.2,67.5L559.7,68.8L560.7,70.4L558.6,71.4L557.4,71.8L555,70.5L553.9,70.4L553.4,69.8L551.4,70.1L547.7,69.9L545.4,70.7L545.2,68.7L545.9,67.1L547.8,66.2L549.8,68.2L551.5,68.1L551.6,66.1L553.3,65.7L554.3,66L556.3,66.9Z",557.4,69.2],
["430","Liberia","M476.8,231.5L476.7,232.6L477,234.4L476.4,236L477.2,237L478,237.3L479.2,238.8L479.3,240.3L479,240.8L478.8,243.8L478.1,243.8L475.2,242.1L472.7,239.3L470.4,237.2L468.6,234.8L469.2,233.7L469.4,232.6L470.7,230.6L472,228.9L472.5,228.8L473.3,228.4L474.4,230.6L474.2,232.1L474.7,232.9L475.5,232.9L476.1,231.4Z",473.3,235.6],
["434","Libyen","M566.5,179.4L566.9,186.5L563.8,186.5L563.9,188.1L552.9,181.2L542,174.4L539.4,176.3L537.5,177.6L536,175.7L531.8,174.2L530.5,171.9L528.4,170.3L527.2,170.9L526.2,169L526,167.5L524.4,164.9L525.4,163.4L525.1,161.2L525.4,159.3L525.2,157.8L525.5,154.9L525.3,153.3L524.4,150.3L525.6,149.5L525.8,148L525.5,146.6L527.2,145.3L527.9,144.2L529.1,143.3L529.2,140.7L532.2,141.8L533.3,141.5L535.4,142.1L538.9,143.6L540.2,146.6L542.6,147.3L546.3,148.7L549.1,150.4L550.3,149.5L551.5,148L550.7,145.4L551.3,143.7L553.1,142.1L554.8,141.7L558.3,142.3L559.3,143.9L560.2,143.9L561.1,144.4L563.7,144.9L564.4,146L563.6,147.6L564.1,149.1L563.7,151.2L564.7,154L565.6,166.4Z",539.2,160.8],
["440","Litauen","M557.4,71.8L557.8,73L556.2,73.9L556,75.4L553.8,76.5L551.6,76.4L551,75.6L549.8,75.3L549.5,74.6L549.6,73.9L548.6,73.4L546.2,73L545.4,70.7L547.7,69.9L551.4,70.1L553.4,69.8L553.9,70.4L555,70.5Z",553.1,73.4],
["442","Luxemburg","M513.7,87.1L514.2,87.7L514.1,89L513.5,89.1L512.9,88.8L513.1,87.2Z",513.6,88.5],
["450","Madagaskar","M635,306.1L635.6,307.7L636.1,310.1L636.2,314.5L636.8,316.2L636.3,317.9L635.8,319L635,316.9L634.4,317.9L634.7,320.6L634.3,322.2L633.5,323L633,326.1L631.6,330.3L629.7,335.2L627.3,342L625.7,346.9L624,351L621.7,351.9L619.2,353.4L617.8,352.5L615.9,351.2L615.4,349.3L615.6,346.2L615,343.4L615,340.8L615.7,338.2L617,337.6L617.2,336.4L618.7,333.7L619.2,331.4L618.7,329.7L618.4,327.4L618.5,324.1L619.6,322.1L620.1,319.8L621.5,319.6L623.1,318.9L624.1,318.2L625.3,318.2L627,316.1L629.4,313.9L630.4,312L630.1,310.5L631.2,310.9L632.9,308.4L633.1,306.2L634.1,304.5Z",625.6,326],
["454","Malawi","M589.7,294.2L592.4,294.9L592.9,295.9L593.8,297.6L594.3,302.6L593.4,305.4L594,310.2L594.9,310.1L595.8,311.3L596.8,313.9L596.8,318.6L595.5,319.4L594.6,321.9L592.9,319.7L592.9,317.1L593.6,315.4L593.5,313.9L592.5,313L591.7,313.4L590.2,311.6L588.8,310.7L589.8,307.3L590.7,306L590.4,302.9L591,300L591.5,299L590.9,295.8Z",591.6,309.6],
["458","Malaysia","M775,236L775.4,235.4L777.7,237L778.1,238.9L779.9,238.4L780.7,236.9L781.3,237.3L783.1,239.5L784.4,242L784.7,244.5L784.5,246.2L784.8,247.4L785,249.6L786,250.7L787.2,253.9L787.2,255.2L785.2,255.4L782.6,252.7L779.2,249.8L778.9,247.9L777.2,245.4L776.6,242.3L775.5,240.3L775.7,237.6ZM824.4,244.6L822,244L818.8,244L818.1,248.2L817.1,249.5L815.8,254.7L813.6,255.5L810.9,254.4L809.6,254.8L808,256.6L806.3,256.4L804.5,257.1L802.6,255L802.1,252.6L804.1,253.8L806.3,253.1L806.7,250L807.9,249.3L811.1,248.5L813,245.6L814.2,243.2L815.6,245.1L816.1,243.9L817.4,244L817.4,241.6L817.4,239.8L819.4,237.2L820.5,234.3L821.6,234.3L823.2,236.2L823.5,237.8L825.3,238.8L827.7,239.9L827.6,241.4L825.8,241.6L826.4,243.4Z",813,251.5],
["466","Mali","M468.6,214L468.8,212.9L468.6,211.4L467.6,210.4L467.1,208.3L467,206L467.9,205.4L468.4,203.2L469.3,203.1L471.1,204.2L472.7,203.4L473.7,203.7L474.1,202.9L485,202.8L485.6,200.3L485.2,199.8L484.1,184.2L483,168.9L487,168.8L495.9,176.6L504.9,184.4L505.5,186L507.2,187.1L508.4,187.6L508.5,189.9L511.4,189.6L511.5,197.9L510.1,200.3L509.8,202.6L507.4,203.2L503.7,203.5L502.8,204.8L501,204.9L499.3,204.9L498.6,204.2L497.1,204.7L494.6,206.3L494.1,207.4L491.9,209L491.6,210L490.4,210.7L489.1,210.2L488.4,211.1L487.9,213.6L485.8,216.7L485.8,217.9L485.1,219.5L485.2,221.6L484.1,222.2L483.5,222.6L483,221L482.2,221.5L481.8,221.4L481.3,222.5L479.2,222.4L478.4,221.9L478,222.2L477.2,221.2L477.4,220.1L477,219.6L476.4,220L476.6,218.8L477.1,217.9L476,216.3L475.7,215.3L475.1,214.5L474.6,214.4L473.9,214.9L473,215.4L472.3,216.2L471.1,215.9L470.4,215L469.9,214.8L469.2,215.3L468.8,215.3Z",496.2,192.9],
["478","Mauretanien","M454.5,183L455.1,181.8L465.5,181.8L465.2,176.6L465.9,174.8L468.4,174.5L468.6,165.5L477.2,165.7L477.4,160.4L487,168.8L483,168.9L484.1,184.2L485.2,199.8L485.6,200.3L485,202.8L474.1,202.9L473.7,203.7L472.7,203.4L471.1,204.2L469.3,203.1L468.4,203.2L467.9,205.4L467,206L465.2,203.5L463.7,200.9L461.9,199.9L460.6,198.8L459.1,198.9L457.8,199.7L456.5,199.4L455.5,200.5L455.3,198.6L456.1,196.8L456.6,193.4L456.4,189.8L456.1,188L456.5,186.2L455.8,184.5Z",472.6,191.2],
["484","Mexiko","M201.7,142.7L204.7,142.4L208.1,142.1L207.6,142.7L210.8,144.4L215.6,146.8L220.7,146.7L222.8,146.7L223.3,145.3L227.7,145.3L228.2,146.6L229.1,147.6L230.1,149.1L230.3,150.9L230.2,152.8L231.2,153.9L233,154.9L235.6,152.2L237.7,152.1L239.1,153.5L239.6,155.8L239.8,157.9L240.7,159.9L240.6,162.3L240.8,163.9L242.5,165L244.2,165.8L245.2,165.7L243.4,168.8L242.2,171.3L240.8,176.1L240.1,177.8L240.1,179.7L240.5,181.5L240.4,184.3L241.6,186.9L241.8,189L242.5,190.8L245.2,191.7L246,193.2L248.6,192.2L250.7,191.9L252.8,191.2L254.6,190.6L256.6,189.1L257.7,187L258.5,184L259.2,183L261.2,182L264.2,181.2L266.5,181.3L268.2,181L268.7,181.8L268.2,183.5L266.4,185.6L265.3,187.8L265.7,188.4L265,190L263.8,192.8L263.3,191.9L262.7,191.9L262.2,192L260.8,194.2L260.4,193.8L260.1,193.9L260,194.5L257.5,194.4L255,194.4L254.6,196.5L253.4,196.5L254.2,197.7L255.1,198.5L255.3,199.3L255.7,199.5L255.4,200.8L251.9,200.8L250.1,203.7L250.4,204.4L250,205.3L249.8,206.3L247.3,202.4L246.1,201.2L244,200.3L242.5,200.5L240.1,201.9L238.7,202.3L236.9,201.3L235,200.6L232.8,199L230.8,198.4L228.1,196.8L226.2,195L225.7,194.1L224.2,193.8L221.7,192.7L220.9,191.1L218.5,189L217.7,186.7L217.5,185L218.4,184.6L218.4,183.6L219.2,182.7L219.6,181.5L219.1,179.8L219.2,178.4L218.8,176.6L217.4,173.1L215.6,170.3L214.9,168.1L213.1,166.7L212.9,165.8L214,163.7L212.9,162.9L212,161.2L212.1,158.7L210.8,158.5L210,156.6L209.4,154.9L209.7,153.9L209.3,151.3L209.4,148.6L209.9,147.3L208.6,146L207.7,146.1L206.7,145.2L205.7,146.6L205.4,148.2L204.7,150.8L205,152.2L206,154.6L206.1,155.4L206.4,155.6L206.3,156.8L206.8,156.8L206.5,159L207,159.9L207.1,161.1L208.2,162.9L208,166.2L208.3,167.7L208.5,169.4L208.1,171.2L209.3,171.3L209.9,172.9L210.4,174.5L210.2,175.2L208.7,176.5L208.2,176.5L208.1,174.3L207,172.3L205.6,170.6L204.5,169.7L205.4,167.1L205.6,165.2L204.7,164.1L203.5,162.5L203,163L202.6,162.1L201.3,161.2L200.5,159.2L200.8,159L201.8,159.2L203.2,157.9L203.9,156.3L202.8,153.8L201.7,152.9L201.6,150.7L201.5,148.5L201.4,145.7Z",228.4,166.8],
["496","Mongolei","M700.6,89.5L702.7,89L705.6,86.5L708.3,85.1L710.8,86L713.2,86.1L715.5,87.4L717.8,87.5L721.6,88.3L722.5,86.2L720.5,84.6L720.9,81.6L724.2,82.8L726.5,83.1L729.6,83.8L731.5,86L735.5,87.2L737.3,86.7L739.9,86.3L742.4,86.7L745.6,88.1L748,89.5L750.1,89.5L753.3,90L754.9,89.3L757.6,88.8L759.4,86.7L761,87.1L762.9,88L765.4,87.8L766,90L766.4,92.9L767.9,94.1L768.9,93.8L771.5,94.2L772.5,93.1L775,94.1L778.6,96.2L779.1,97.2L777,96.9L773.9,97.3L772.9,98.1L772.5,100.1L769.7,101.3L768.3,102.9L765.5,102.3L764,102L764,104L765.5,105.2L766.5,106.2L765.4,107.3L764.7,108.9L762.5,110.1L758.9,110.2L755.7,111.3L753.7,113L752.2,112L749.2,112L744.7,110.1L742.1,109.6L739.1,110L733.8,109.3L731.2,109.4L728.8,107.5L726.3,104.7L724.7,104.3L720.8,102.4L717.4,102L714.3,101.5L712.8,100.2L711.9,96.6L709,94.2L705.1,93.1L702.3,91.5Z",739.6,98.2],
["498","Moldau","M561.4,92.7L561.8,92.2L563.3,91.9L565.2,92.9L566.2,93L567.3,93.8L567.3,94.8L568.3,95.3L568.8,96.5L569.8,97.3L569.7,97.7L570.2,98L569.6,98.3L568.2,98.2L567.9,97.7L567.5,98L567.7,98.5L567.2,99.5L567,100.5L566.4,100.9L565.8,99.5L565.8,98.2L565.6,96.9L563.9,95.1L563,93.8L562.1,93Z",565.7,94.6],
["499","Montenegro","M548.2,109.8L547.6,110.1L547.4,109.5L546.5,111.1L546.7,112.1L546.2,111.8L545.4,110.8L544.3,110.2L544.6,109.6L544.7,107.9L545.4,107.2L545.9,106.9L546.6,107.4L546.9,107.9L547.8,108.2L548.7,108.9L548.6,109.1Z",546.1,109],
["504","Marokko","M494.6,133.8L495.5,136L495.6,138L496.5,141.6L497.1,142.3L496.7,143.6L493.3,144.2L492.2,145.4L490.7,145.7L490.5,148.3L487.5,149.6L486.5,151.3L484.4,152.3L481.8,152.8L477.5,155.3L477.4,159.4L477,159.4L477.1,161.3L475.4,161.4L474.6,162.2L473.4,162.2L472.5,161.8L470.2,162.1L469.3,164.9L468.5,165.1L467.1,169.6L463.3,173.4L462.2,178.3L461.1,179.9L460.7,181.2L454.7,181.5L454.7,181.5L454.9,179.8L455.9,178.8L456.9,177L456.7,175.8L457.7,173.3L459.3,171L460.2,170.4L461,168.4L461.1,166.5L462.2,164.3L464,163.1L465.8,159.5L465.8,159.5L467.2,158.1L469.6,157.7L471.8,155.4L473.1,154.4L475.3,151.6L474.8,147.3L475.9,144.4L476.3,142.6L478,140.3L480.6,138.8L482.5,137.4L484.3,133.9L485.1,131.9L487,131.9L488.5,133.3L490.9,133.1L493.5,133.8Z",482.5,145.4],
["508","Mosambik","M594.3,302.6L596.4,302.3L599.6,303.4L600.3,302.9L602.2,302.8L603.3,301.7L604.9,301.8L608,300.3L610.2,298.2L610.6,299.8L610.3,303.5L610.5,306.7L610.2,312.4L610.6,314.2L609.6,316.8L608.4,319.4L606.5,321.6L603.9,323L600.8,324.7L597.5,328.6L596.4,329.3L594.3,331.8L593.1,332.7L592.7,335.2L593.8,337.9L594.1,340L594.1,341.1L594.5,340.9L594.2,344.4L593.6,346.1L594.1,346.7L593.6,348.1L592.4,349.4L590.1,350.6L586.8,352.5L585.5,353.8L585.6,355.3L586.2,355.5L585.8,357.4L583.8,357.3L583.7,355.8L583.5,354.2L583.4,353L584.2,349L583.7,346.5L582.9,341.5L586,337.5L586.9,334.9L587.3,334.5L587.8,332.4L587.4,331.4L587.7,328.7L588.4,326.2L588.7,321.6L587.3,320.4L586.1,320.2L585.5,319.3L584.3,318.5L582.1,318.6L582,317.2L581.8,314.6L590.2,311.6L591.7,313.4L592.5,313L593.5,313.9L593.6,315.4L592.9,317.1L592.9,319.7L594.6,321.9L595.5,319.4L596.8,318.6L596.8,313.9L595.8,311.3L594.9,310.1L594,310.2L593.4,305.4Z",603.1,310],
["512","Oman","M646.5,176.9L646.3,175.4L646.9,174L646.7,172.5L647.8,171.8L647.2,171.3L647.1,169L648.4,169L650,171.4L651.7,172.7L653.7,173.2L655.3,173.8L656.8,175.9L657.7,177L658.8,177.5L658.9,178.3L658.2,180.4L657.9,181.4L657,182.6L656.3,185L655.1,184.8L654.6,185.7L654.4,187.5L655.1,189.9L654.9,190.3L653.6,190.3L652.1,191.7L652,193.4L651.5,194.2L649.8,194.2L648.9,195.1L649,196.5L647.8,197.6L646.3,197.2L644.6,198.4L643.4,198.6L642.3,196.1L639.5,190.1L647.2,186.5L648,179.4ZM647.6,166.2L647,165L647.5,163.8L647.9,164.1L647.9,165.6Z",653.1,179.3],
["516","Namibia","M552.4,350.4L551.6,363.3L549.2,365.1L547.8,365.4L546.2,364.7L545.1,364.5L544.7,363L543.7,362L542.4,363.7L540.6,361.1L539.7,358.6L539.3,355.2L538.7,352.6L538.1,347.2L538.2,342.9L537.9,341L536.9,339.5L535.6,336.6L534.4,332.3L533.8,330L531.7,326.5L531.6,323.7L532.9,323L534.6,322.4L536.3,322.5L537.9,324.2L538.3,323.9L549.2,323.7L551,325.5L557.5,326L562.5,324.5L564.8,323.7L566.5,323.9L567.6,324.7L567.6,325L566,325.8L565.2,325.8L563.4,327.3L562.4,325.8L558.2,327L556.2,327.2L555.6,340L552.9,340.1Z",545.3,333.8],
["524","Nepal","M729.2,158.7L729.5,160.2L730.4,162.4L730.5,163.8L728.3,163.8L724.9,163L722.8,162.7L720.9,160.9L717.2,160.5L713.3,158.5L710.4,156.8L707.5,155.5L707.7,152.3L708.9,150.7L709.7,149.9L712.1,150.9L715.3,153.2L716.9,153.7L718.2,155.3L720.4,156L723,157.5L726.1,158.3Z",710.6,153.6],
["528","Niederlande","M515.2,77.6L515.7,78.6L515.3,81.1L514.7,82.2L513.4,82.2L513.9,85.1L512.6,84.5L511.2,83.2L509.1,83.8L507.4,83.6L508.6,82.8L510.4,78.7L513.4,77.5Z",513.2,80],
["540","Neukaledonien","M942.1,337.3L943.5,339.5L944.2,341.2L942.8,342L941.7,341.1L940.5,339.5L939.5,337.6L938.7,335.1L938.8,333.8L939.9,333.9L941,335.1L941.7,336.3Z",941.6,338.8],
["548","Vanuatu","M952.3,318.6L953.4,320.7L952.4,321.2L952,319.6ZM951.4,317.8L951.3,316.8L952,314L953,315.1L952.6,318L952,317.6Z",952.1,316.8],
["554","Neuseeland","M931.8,402.2L929.4,403.9L926.3,406.1L923.4,407.3L923.7,406.5L923.1,406L926.7,403.4L927.4,401.7L925.8,400.4L926.8,399.2L929.5,398.1L931.9,395.6L933.4,393.5L934.1,391.3L934.6,390.7L934.4,389.3L934.6,386.4L935.2,384L936.3,383.8L936.4,385.6L937.7,386.5L936.3,389.4L935.5,392.9L937.2,390.7L937.7,391.5L936.1,394L937.3,395.1L938.8,395.4L941.2,394.1L942.1,394.5L939.2,397.4L936.9,399.3L935.1,399.2L933.6,400.2L932.7,401.6ZM904.8,413.2L908.3,411.6L911.2,409.9L914.3,407.6L915.9,406.8L917.8,405L920.7,403.5L920.1,404.9L919.5,406.2L922.4,404.9L921.9,406.3L920.8,407.6L918.6,409.1L914.9,411.4L912.6,412.6L912.1,414.1L910.2,414.1L907.1,415.3L904.6,417.3L900.3,420.4L897.1,421.8L895.1,422.6L893,422.6L892.5,421.6L890.1,421.4L890.8,420.2L894.2,418L899.9,414.9L902,414.4Z",899.1,418.2],
["558","Nicaragua","M271.5,219.5L270.8,220.3L270,220.1L269.6,219.3L268.8,219L268.1,219.5L266.4,218.5L265.9,219L265.1,217.8L264,216.3L263.5,215.1L262.5,213.9L261.3,212.3L261.7,211.7L262.1,212.3L262.3,212L263.2,211.9L263.6,211L264.1,211L264.2,209.2L264.9,209.1L265.4,209.1L266.1,208.2L266.9,208.9L267.2,208.4L267.8,208L268.8,207L269,206.3L269.2,206.3L269.7,205.4L270,205.3L270.4,205.9L270.9,206L271.6,205.6L272.3,205.6L273.3,205.1L273.7,204.6L274.6,204.7L274.3,205L274.1,205.8L274.2,207.2L273.4,208.4L272.9,209.9L272.6,211.5L272.7,212.4L272.6,214.1L272.1,214.4L271.7,216L271.8,217L271.1,217.9L271.1,218.9Z",267.7,213.5],
["562","Niger","M539.4,176.3L540.2,181.9L541.3,182.8L541.3,183.9L542.5,185.2L542,186.7L541.2,194L541.2,198.7L537.8,202.2L536.8,207L537.9,208.3L538,210.7L539.7,210.7L539.5,212.5L538.7,212.7L538.6,213.8L538.1,213.9L536.2,209.9L535.6,209.8L533.5,211.8L531.4,210.8L529.9,210.5L529.1,211.1L527.5,210.9L525.9,212.5L524.5,212.6L521.2,210.7L520,211.6L518.6,211.5L517.5,210.2L514.8,208.8L511.9,209.2L511.2,210L510.8,212.1L510,213.6L509.9,216.9L507.8,214.8L506.8,214.8L505.9,215.8L505.9,213.3L502.8,212.5L502.7,210.7L501.2,208.3L500.8,206.7L501,204.9L502.8,204.8L503.7,203.5L507.4,203.2L509.8,202.6L510.1,200.3L511.5,197.9L511.4,189.6L515.2,188L522.8,180.9L531.8,174.2L536,175.7L537.5,177.6Z",525.1,197.4],
["566","Nigeria","M507.4,236.8L507.5,230.8L507.5,228.5L508,226.2L508.8,225L510.1,222.7L509.8,221.8L510.4,220.3L509.8,218.1L509.9,216.9L510,213.6L510.8,212.1L511.2,210L511.9,209.2L514.8,208.8L517.5,210.2L518.6,211.5L520,211.6L521.2,210.7L524.5,212.6L525.9,212.5L527.5,210.9L529.1,211.1L529.9,210.5L531.4,210.8L533.5,211.8L535.6,209.8L536.2,209.9L538.1,213.9L538.6,213.8L539.7,215.3L539.5,216L539.3,217.2L537.1,220L536.4,222.4L536,224.3L535.5,225.1L534.9,227.7L533.5,229.2L533.1,231.1L532.5,232.6L532.2,234.1L530.4,235.4L528.8,233.8L527.8,233.9L526.2,236.1L525.4,236.1L524.1,239.7L523.4,242.3L520.5,243.6L519.5,243.4L518.4,244.3L516.2,244.2L514.8,241.9L513.8,239.2L511.9,236.7L509.8,236.8Z",521.7,223.9],
["578","Norwegen","M525.8,24.3L526.4,23.9L528.9,23.9L531.1,24.2L536.9,25.1L532.7,25.5L532,26.4L530.5,26.7L529.9,27.7L527.8,27.8L523.9,27L525.4,26.5L522.8,26.2L519.3,25.2L517.8,24.3L522.4,23.9L523.4,24.3ZM558.4,39.6L555.5,40.3L554,40.5L554.4,39.2L551.8,38.4L549,39.1L548.5,40.5L546.9,41.3L544.8,40.8L542.3,40.9L540,39.9L539,40.4L537.8,40.5L537.8,41.8L534.2,41.5L533.9,42.6L532,42.6L531,44L529.4,46.3L526.8,49.4L527.6,50.1L527,51L525.1,51L524,53.1L524.4,56.2L525.9,57.4L525.5,60.3L523.9,62L523.2,63.4L521.6,61.9L517.7,64.8L514.9,65.4L511.9,64.1L511.1,61.4L510.2,55.8L512,54.3L517.1,52.4L520.9,50L524.1,47L528.3,43L531.2,41.5L535.9,39.1L539.9,38.2L543,38.3L545.4,36.8L548.8,36.9L552,36.6L558.2,37.9L556,38.4ZM546.6,23.9L544.3,24.4L539.3,24.6L534.3,24.4L533.9,24.1L531.4,24.1L529.5,23.6L534.6,23.3L537.2,23.6L538.8,23.3L543.1,23.5ZM542.8,26.4L539.1,26.9L535.9,26.6L537,26.3L535.9,25.9L539.4,25.7L540.2,26.1Z",516.4,58.7],
["586","Pakistan","M695.2,132.8L693.6,135.6L691,136.1L686.9,135.2L686.1,136.7L687.9,139.6L689.4,141.9L691.9,143.6L690.3,145.6L691,148L689.3,151.4L688.6,154.9L686.7,158.6L683.6,158.3L681.5,161.9L683.6,163.5L684.4,166.2L686.3,168L687.4,171L681.6,171L680.3,173.4L678.2,172.5L676.9,169.9L674.4,167.3L669.6,167.9L665.4,168L661.8,168.5L662,164.4L665.5,162.6L665,161L663.6,160.4L662.9,157.4L660.1,155.8L658.7,153.7L657,151.9L661.7,153.7L664.2,153.2L665.8,153.6L666.2,152.9L668.1,153.2L671.1,151.7L670.5,148.8L671.5,146.9L673.4,146.9L673.4,145.9L675.3,145.5L676.3,145.8L677.1,144.8L676.4,142.8L677,140.8L678.3,139.9L676.7,137.7L679.2,137.8L679.5,136.6L679.1,135.3L679.9,133.9L679.1,132.2L678.1,130.8L679.2,129.4L681.6,128.7L684.3,128.3L685.4,127.7L686.7,127.4L689.1,128.9L690.6,131.4Z",674,159.2],
["591","Panama","M288,227.9L287.6,228.4L288.1,230.6L287.5,231.7L286.7,231.4L286.2,233.2L285.4,232.2L284.9,230.2L285.6,229.2L285,228.9L284.5,227.7L283.3,226.7L282,226.9L281.4,228.2L280.2,229.1L279.6,229.2L279.3,230L280.5,232L279.7,232.5L279.3,233L278,233.2L277.6,231L277.2,231.7L276.3,231.4L275.9,229.9L274.8,229.7L274.1,229.3L272.9,229.3L272.8,230.1L272.5,229.5L272.7,228.8L273,228L272.9,227.4L273.4,226.9L272.9,226.4L273,224.9L274,224.6L274.9,225.9L274.8,226.7L275.9,226.8L276.2,226.5L276.9,227.4L278.2,227.2L279.5,226.2L281.2,225.5L282.2,224.4L283.7,224.6L283.6,225L285.1,225.1L286.3,225.7L287.1,226.9Z",277.6,229.2],
["598","Papua-Neuguinea","M888.3,269.7L893,272.2L898,274.3L899.8,276.2L901.1,278.1L901.4,280.3L905.8,282.6L906.2,284.5L903.7,284.9L904,287.4L906.1,289.8L907.4,293.7L909,293.6L908.6,295.2L910.6,295.9L909.7,296.6L912.3,298.1L911.9,299.2L910,299.4L909.5,298.5L907.2,298.1L904.5,297.5L902.8,295.2L901.5,293.1L900.5,289.9L897.2,288.3L894.7,289.3L892.9,290.6L892.9,293.3L890.5,294.5L889.1,293.9L886.3,293.8L887.6,281.7ZM920.2,273.6L921.2,274.8L921.4,276.7L920.4,277.7L920.1,275.5L919.5,274.1L918.3,272.8L916.9,271.3L914.9,270.2L915.7,269.3L917.2,270.3L918.1,271.1L919.2,272ZM915.9,281.7L914.3,282.6L912.8,283.4L911.3,283.4L909.2,282.4L907.7,281.3L908.1,280.2L910.5,280.7L912,280.4L912.6,278.6L913,278.6L913.1,280.5L914.7,280.2L915.5,279L917.2,277.6L917,275.5L918.7,275.4L919.2,276L919,278.1L917.9,280.3L916.4,280.6ZM925.6,279.8L926.3,280.6L927.4,283L928.6,284.2L928.1,285.3L927.3,285.7L926.2,284.2L925.3,281.9L925,279.1L925.4,278.7Z",894.6,281.8],
["600","Paraguay","M344.4,334.1L345.5,336.1L346,340.9L348.9,341.6L349.9,340.9L351.8,341.9L352.4,342.9L353.2,346.2L353.7,347.6L354.7,347.7L355.6,347.1L356.6,347.8L356.9,349.7L356.9,351.8L356.7,353.9L356.7,356.9L354.8,359.6L352.8,360.2L349.8,359.6L347,358.7L348.7,353.4L348.1,351.8L345.1,350.4L341.5,347.8L339.2,347.3L333.4,341.5L333.9,337.2L333.6,335.3L334.5,332.1L339,331.1L341.5,331.1L344.3,333Z",339.7,339.3],
["604","Peru","M307.7,275.9L305.2,275.8L304.8,276.3L302.6,277L299.5,279.6L299.4,281.3L298.8,282.6L299.2,284.6L297.6,285.7L297.6,287.2L297,287.9L298.3,291.2L300,293.5L299.5,295L301.4,295.3L302.5,297.2L305,297.3L307.1,295.1L307.3,300.7L308.6,301.2L310.1,300.5L313,306.4L312.5,307.7L312.6,310.2L312.9,313.4L312,315.2L312.7,316.5L312.2,317.8L313.7,320.8L312.5,324.7L312.1,326.6L310.8,327.5L307.8,325.4L307.4,323.9L301.5,320.3L296.2,316.3L293.8,314.1L292.3,311.1L292.7,310L289.8,305.2L286.5,298.4L283.3,291.1L282.1,289.4L281,286.7L278.8,284.3L276.7,282.8L277.5,281.1L276,277.6L276.8,275L278.9,272.6L279.3,274.2L278.5,275.1L278.7,276.4L279.8,276.1L280.9,276.5L282.1,278.4L283.6,276.9L284.1,274.4L285.7,271.1L288.9,269.7L291.9,265.8L292.7,263.4L292.3,260.6L293,260.2L294.9,262L295.8,263.7L297.1,264.7L298.7,268.6L300.8,269L302.3,268.1L303.3,268.7L304.9,268.4L307.1,270.1L305.4,273.9L306.2,274Z",302.9,309.3],
["608","Philippinen","M829.1,213L827.2,210.2L829.5,210.4L830.7,211.7L830.5,214.9ZM835.3,223L835.9,222L835.9,219.7L837.3,219.5L837.3,222L838.8,218.4L839,221.9L838.2,223.2L837.6,225.5L836.9,226.6L834.9,224ZM846.4,228.8L847,231.3L847.4,233.3L846.7,236.7L845.4,233L844.3,234.8L845.4,237.6L844.8,239.3L841.4,237.1L840.3,234.5L841,232.7L839.1,231L838.4,232.5L837.1,232.4L835.3,234.4L834.7,233.3L835.5,230.2L837.1,229.2L838.4,227.8L839.6,229.5L841.5,228.5L841.8,226.8L843.7,226.7L843.2,223.9L845.6,225.6L846.1,227.5ZM824.5,225.5L821.2,229L822.3,226.4L824,224.1L825.3,221.6L826.2,217.9L827.1,220.9L825.6,223ZM829,192.9L828.9,194.4L830.4,197L830.4,200.1L829.1,201.3L829.3,204.2L830.4,207.1L832,207.5L833.1,207.1L836.8,209.1L836.9,211.1L838,212L838,213.7L835.6,211.9L834.2,209.9L833.8,211.3L831.6,209.1L829.3,209.6L827.8,208.8L827.6,207.3L828.3,206.4L827.3,205.5L827.2,206.9L825.5,204.8L824.8,203.2L823.9,199.7L825.3,200.9L824.3,195.2L824.4,191.9L826,191.9L827.9,193L828.5,192ZM833.1,217.8L832.4,216L834.2,217.2L836,217.1L836.1,218.7L835.1,220.2L833.5,221.4L833.2,219.6ZM842.1,215L843.5,219.1L841.3,218.1L841.5,219.4L842.5,221.7L841.3,222.5L840.9,219.9L840,219.7L839.2,217.5L840.9,217.8L840.6,216.4L838.5,213.6L841.1,213.7Z",827.6,197.8],
["616","Polen","M551.6,76.4L551.9,77.6L552.7,78.7L552.9,79.8L551.6,80.4L552.5,81.7L552.8,82.9L554.3,85.4L554.2,86.2L553.1,86.6L551.4,89L552.2,90.3L551.7,90.1L549.3,89L547.7,89.4L546.6,89.1L545.3,89.7L544.1,88.7L543.2,89.1L543,88.9L541.8,87.5L540.1,87.3L539.8,86.4L538.2,86.1L537.9,86.8L536.6,86.2L536.7,85.4L535,85.2L533.8,84.3L532.7,82.5L532.8,81.5L532.1,80L531.2,79L531.7,78.3L531.1,76.9L532.5,76.1L535.8,74.8L538.4,73.9L540.7,74.3L540.9,75L543,75L545.8,75.3L549.8,75.3L551,75.6Z",545.2,81.9],
["620","Portugal","M478.2,112.1L479.1,111.3L480.1,110.8L480.7,112.3L482.1,112.3L482.5,111.9L483.9,112.1L484.5,113.6L483.4,114.5L483.3,117L482.9,117.5L482.7,119L481.6,119.2L482.6,121.2L481.8,123.3L482.6,124.3L482.3,125.2L481.3,126.4L481.5,127.5L480.4,128.3L479.2,127.9L477.9,128.2L478.3,125.7L478.2,123.7L477.1,123.3L476.6,122.1L476.8,120L477.9,118.8L478.1,117.5L478.7,115.6L478.7,114.3L478.3,113.1Z",479.5,121.2],
["624","Guinea-Bissau","M454.6,214.2L456,213.6L456.9,213.7L457.7,213.3L462.7,213.5L462.6,214.7L462.3,215.1L462.5,216.3L462.1,216.8L461.5,216.8L460.7,217.4L459.9,217.4L458.7,219.1L457.2,217.6L456.1,217.4L455.5,216.3L455.5,215.8L454.7,215Z",458.4,215.6],
["626","Osttimor","M842.4,292.9L842.8,292.1L845.3,291.2L847.2,291.1L848.1,290.7L849.1,291.1L848,292.1L844.9,293.7L842.5,294.8L842.6,293.7Z",843.6,293],
["630","Puerto Rico","M321.9,191.9L323.2,192.2L323.6,192.9L322.8,193.8L320.8,193.8L319.2,193.9L319.2,192.4L319.7,191.9Z",320.2,192.9],
["634","Katar","M633.8,169.6L633.3,167.1L633.7,165.2L634.4,164.8L635.3,165.9L635.7,168L635.4,170.1L634.7,170.3Z",634.4,167.1],
["642","Rumänien","M566.4,100.9L567.6,101.4L568.6,100.9L569.8,101.5L569.9,102.2L568.9,102.9L568.1,102.6L568.1,106.3L566.6,106L564.7,104.9L562,105.6L560.9,106.4L557.4,106.2L555.5,105.8L554.6,106L553.8,104.7L553.3,104.2L553.8,103.7L553.2,103.3L552.5,104L551,103.1L550.7,101.8L549.2,101.1L548.8,100.1L547.4,98.9L549.2,98.4L550.3,96.3L551.2,94.3L552.5,93.7L553.4,93L554.9,93.4L556.4,93.4L557.5,94.1L558.3,93.6L559.9,93.4L560.4,92.7L561.4,92.7L562.1,93L563,93.8L563.9,95.1L565.6,96.9L565.8,98.2L565.8,99.5Z",559.2,100.1],
["643","Russland","M658.3,22.9L661.7,22.7L665.5,23.2L670.7,24.2L671.5,25.2L667.9,25.3L662.7,25L659.4,24.5L657.2,23.8L654.7,23.6ZM675.9,24.7L681,25.4L681.1,25.8L672,26.3L673.2,24.8L674.5,24.6ZM744,28.7L748.7,28.7L756.4,29.5L756.8,30.6L750.2,30.5L747.8,30.9L742.7,29.9L742.1,28.9ZM762.5,29.8L767.6,30.2L766.6,30.8L763.5,30.6L759.2,30L758.8,29.6ZM752.5,32.8L753.2,32.2L755.3,32.1L758.8,32.7L759.7,33.1L757,33.1L753,32.9ZM575.9,23.3L579.1,23.2L581.7,23.1L582.2,23.4L583,23.2L584.5,23L587.2,23.2L586.6,23.4L584.4,23.5L582.9,23.6L582.8,23.7L580.9,23.9L578.9,23.7L579.7,23.4ZM549.8,75.3L545.8,75.3L543,75L543.4,73.8L546.2,73L548.6,73.4L549.6,73.9L549.5,74.6ZM596.2,32.2L599.7,30.9L598.8,30.2L602.2,29.4L607.4,28.5L613,28.2L615.6,27.7L618.9,27.6L620.6,28.1L619.7,28.5L614,29.2L609.1,29.9L604.6,31.3L602.9,32.9L601.1,34.5L602.3,35.9L606.8,37.4L605.8,37.6L599.6,37.3L598.6,36.5L595,36L594.2,35.1L595.9,34.7L595.3,33.8L598,32.4ZM814.8,77L818.2,79.7L820.9,82.4L824.5,85.3L831.5,90.4L827.3,89.5L829.6,93.7L834.4,96.8L836.1,98.9L832.8,97.1L833.2,99.4L830.7,96.9L828.5,94L825.5,90.8L824.1,88.6L820.7,84.7L816.7,81.9L813.2,78.1L814,76.8L811.8,75.6L812.4,75.2ZM159.7,40.7L159.7,40.7L161.6,42.2L163,44.2L160.6,45.5L161,46L163.2,44.5L167.9,44.8L168.4,46.8L164.9,47.7L161.3,48L157.8,50.1L156.3,50.6L154.5,50.5L154.2,49.7L152.7,49.1L153.8,48.1L152.4,47.8L149.7,48.1L150,47.3L151.8,46.5L148.5,47L147.7,48L145,49L145,49L159.7,40.7ZM855,49L855,49L854.1,49.9L851.3,49.8L855.1,51L859.3,52.8L861.2,53.4L863,54.4L863.5,55L858.9,54.5L856,56.3L854.6,56.6L854,58.2L853.2,59.7L854,60.9L848.6,59.2L845.9,61.1L843.7,60.2L843.2,61.2L839.9,60.9L841.5,62.5L842.2,65L843.6,66L846.7,66.6L851.2,70.4L849.4,70.5L851.1,72.7L853.4,73.9L851.2,75.3L854,78.4L851.5,79.1L853.9,81.9L853.4,84.6L850.6,82.6L845.2,78.5L837.2,72.5L834,68.8L833.9,67.2L832.5,66L835.1,65.4L834.7,62.3L834.9,59.7L835.9,57.8L832.7,54.4L830.6,54.6L832.1,56.6L830.6,59.2L824.8,56.3L820.7,57.1L820.9,61.2L824.6,62.7L820.7,63.3L817.8,63.6L815.7,61.8L812,61.4L810.9,62.6L804,62.2L798,63L796.7,67.9L794.9,74.2L798.7,74.5L801.5,76.3L804.2,76.9L804.2,75.5L806.8,75.7L813,78.7L815.4,81.1L816.3,83.9L819.3,87.3L822.3,92L822.4,96.3L823.3,98.4L822.9,101.9L822.3,105.5L822.1,107.3L820.2,109.1L818.7,109.2L816.2,107.7L814.5,109.9L814.9,111L814.9,111L814.1,110.4L813.1,108.8L814.2,108.8L812,105.1L809.5,102.5L810.7,101.4L814,101.9L813.4,99L811.6,95.7L811.6,94.6L810.7,91.9L807.6,92.8L806.5,93.9L803,93.9L799.8,91.2L795.5,89.1L790.7,88.2L787.6,85.3L785.3,83.6L783.4,82.4L779.6,79.5L776.8,78.5L772.8,77.7L769.9,77.8L767.6,78.3L766.9,79.6L768.7,80.3L770,81.9L769.5,82.8L769.8,85.8L770.8,87L769,88.9L765.4,87.8L762.9,88L761,87.1L759.4,86.7L757.6,88.8L754.9,89.3L753.3,90L750.1,89.5L748,89.5L745.6,88.1L742.4,86.7L739.9,86.3L737.3,86.7L735.5,87.2L731.5,86L729.6,83.8L726.5,83.1L724.2,82.8L720.9,81.6L720.5,84.6L722.5,86.2L721.6,88.3L717.8,87.5L715.5,87.4L713.2,86.1L710.8,86L708.3,85.1L705.6,86.5L702.7,89L700.6,89.5L699.8,89.7L697.6,88L694.9,88.4L693.3,87.1L691.4,86.6L689.4,84.9L687.9,84.4L685,85.1L681,83.5L680.6,85L671.8,77.8L667.8,75.7L668.2,74.9L664.1,77.4L662,77.6L661.4,76.1L658.1,75.2L656.2,75.8L654,73L649.9,72.4L648.5,73.6L643.5,74.6L642.7,75.2L635,76.2L634.4,77.1L636.8,79L634.9,79.7L635.7,80.5L634.1,81.9L638.5,83.8L638.5,85.2L635.3,85L635,85.9L631.5,84.4L628,84.5L626,85.7L622.9,84.5L617.3,82.5L613.8,82.6L610.2,85.7L610.5,87.8L607.7,86.1L606.8,89.3L607.7,89.9L607,92.2L609.5,94.2L611.2,94.1L613.3,96.1L613.5,97.6L614.8,98.1L614.2,99.9L612.1,100.4L610.6,103.6L613.5,106.5L613.8,108.6L617.3,112.3L616.1,113.6L615.9,114.4L614.8,114.2L612.7,112.2L612,112.1L610.3,111.4L609.3,110.1L606.9,109.4L605.5,109.9L605,109.4L601.4,107.9L597.8,107.4L595.6,106.8L595.4,107.2L591.8,104.6L588.9,103.4L586.5,101.6L588.1,101.1L589.5,98.6L587.9,97.4L591.1,96.2L590.9,95.5L588.9,96L588.7,94.7L589.7,93.8L591.8,93.6L592,92.6L591.1,91L591.6,89.5L591.4,88.6L587.8,87.7L586.5,87.7L584.7,86.3L583.1,86.8L580,85.8L579.9,85.2L578.8,84L577,83.9L576.6,83L577,82.4L575.2,80.8L573,81.1L572.3,80.9L571.9,81.6L571,81.5L570.1,79.7L569.3,78.7L569.7,78.5L571.5,78.6L572.2,78L571.4,77.2L569.8,76.8L569.9,76.3L568.8,75.8L567.1,74L567.4,73.3L566.9,72L564.6,71.4L563.6,71.7L563.1,71L560.7,70.4L559.7,68.8L559.2,67.5L558.1,66.9L558.8,66.1L557.6,63.7L558.8,62.3L558.4,61.9L560.4,60.5L558,59.3L561.6,56.3L563.1,54.9L563.5,53.7L560.1,52.1L560.5,50.7L558.3,49L559.1,47.2L556.1,44.8L557.4,43.2L554.1,41.9L554,40.5L555.5,40.3L558.4,39.6L560.1,38.9L563.6,40L569,40.5L577,42.7L578.9,43.7L579.6,45.1L577.9,46.2L574.9,46.7L565.6,45.1L564.3,45.4L568,47L568.5,48L569.3,50.2L572.1,50.9L573.9,51.5L573.8,50.4L572.2,49.4L573.2,48.6L578.5,50L579.9,49.4L578,47.8L581.7,45.7L583.6,45.9L585.7,46.6L586.2,45.1L584,43.9L584.5,42.7L582.5,41.5L588.1,42.1L589.7,43.2L587.4,43.5L587.9,44.6L589.8,45.3L592.6,44.9L592.4,43.6L595.9,42.6L601.7,40.9L603.2,41L602,42.2L604.4,42.4L605.4,41.7L608.9,41.7L611.3,40.9L614.2,42L615.5,40.7L612.8,39.6L613.4,39L619.3,39.6L622.3,40.2L630.7,42.4L631.3,41.4L628.6,40.3L628.3,39.9L625.9,39.8L625.9,38.9L623.8,37.4L623.4,36.8L625.6,35.2L625.6,33.7L626.7,33.4L631.9,33.8L633,34.7L632.4,36.2L634,36.7L635.6,38L637.1,40.6L640.1,41.8L640.3,43.1L638.6,46.1L641.1,46.4L641.3,45.6L643,45.1L642.8,44.1L643.7,43.1L641.7,41.9L641.6,40.7L639.4,40.5L638.2,39.4L638.2,37.6L634.6,36.1L637,34.9L635.5,33.7L636.4,33.7L638.2,34.6L638.8,36.3L641.1,36.6L639.2,35.3L641.7,34.7L645.4,34.6L649.6,35.6L646.7,34.1L645,32.4L647.8,32.1L652.2,32.1L655.9,31.9L653.6,31.1L654.7,30.1L656.7,30.1L659.4,29.4L663.8,29.2L664,28.8L668.5,28.6L670.3,29L673.4,28.2L676.6,28.2L676.4,27.7L677.4,27.1L680.8,26.6L684.3,27L682.4,27.3L686.6,27.5L687.9,28.2L689.1,27.9L694.2,27.9L699,28.5L701.1,29.1L701.7,29.8L700.3,30.2L696.7,31.1L695.9,31.5L698.4,31.8L701.6,32.2L702.8,31.9L705.1,32.9L705.3,32.5L707.9,32.2L714,32.5L715.4,33.2L723.4,33.5L721.7,32.2L726,32.5L728.8,32.5L733,33.4L735.3,34.4L735.3,35.2L739.5,36.5L743.5,37.3L742.6,35.4L746.7,36.2L749.1,35.7L753.5,36.3L754.1,35.8L757.5,36L753.7,34.4L755,33.7L773.2,34.8L776.4,35.8L783.5,37.2L790.4,36.8L794.6,37.1L797.4,37.9L799.5,39.2L802.8,39.8L804.6,39.4L807.9,39.3L812,39.7L815.2,39.5L821.5,41.2L822.8,40.6L819.1,39.4L818.4,38.5L825.3,39.1L829,39L836.1,39.9L840.3,40.7L855,49ZM833.6,37.2L831.8,37.3L830.4,36.7L831.3,36L833.6,37.2ZM168.7,36L168.7,36L168.7,36L169.1,35.9L170.7,35.9L172.3,36.4L171.7,36.7L169,37.1L166.4,37.2L166.4,37.2L168.7,36Z",699.1,59.5],
["646","Ruanda","M583.8,264.2L584.9,266.3L584.7,268.5L583.9,269L582.5,268.7L581.6,270.8L579.9,270.5L580.2,268.5L580.6,268.2L580.7,266L581.5,265L582.2,265.4Z",583,267],
["682","Saudi-Arabien","M590.4,153.6L593.3,154.1L594.3,153L594.8,151.8L596.7,151.3L596.9,150.2L597.7,149.6L594.7,146.2L599.6,144.5L600,144L603.2,144.9L607.4,147.3L615.7,154.2L620.5,154.4L622.9,154.8L623.8,156.4L625.6,156.3L627.1,159.3L628.5,160.1L629.1,161.4L631.1,162.8L631.5,164.3L631.4,165.4L631.9,166.6L632.8,167.6L633.3,168.8L633.8,169.6L634.7,170.3L635.4,170.1L636.1,171.4L636.3,172.2L637.8,175.8L646,177.6L646.5,176.9L648,179.4L647.2,186.5L639.5,190.1L631.9,191.5L629.6,193.2L628,197L626.8,197.6L626,196.3L625,196.5L622.4,196.2L621.9,195.8L618.8,195.9L618.1,196.2L616.9,195.3L616.3,197.1L616.7,198.6L615.6,199.7L615.1,198.2L614.2,197.1L613.9,195.7L612.4,194.4L610.7,191.3L609.7,188.4L607.6,185.9L606.4,185.3L604.3,181.9L603.8,179.4L603.7,177.3L601.8,173.4L600.4,172L598.9,171.3L597.8,169.2L597.9,168.5L597,166.6L596.1,165.8L594.8,163.2L592.9,160.4L591.3,158L590,158.1L590.2,156.1L590.2,154.9Z",619.1,175.4],
["686","Senegal","M454.6,209.8L453.5,206.9L452.2,205.6L453.4,204.9L454.8,202.4L455.5,200.5L456.5,199.4L457.8,199.7L459.1,198.9L460.6,198.8L461.9,199.9L463.7,200.9L465.2,203.5L467,206L467.1,208.3L467.6,210.4L468.6,211.4L468.8,212.9L468.6,214L468.2,214.2L466.8,213.9L466.5,214.3L465.9,214.4L464,213.5L462.7,213.5L457.7,213.3L456.9,213.7L456,213.6L454.6,214.2L454.2,211.4L456.6,211.5L457.3,211L457.8,210.9L458.8,210.1L460,210.9L461.2,210.9L462.4,210.1L461.8,209.1L460.9,209.7L460.1,209.6L459,208.8L458.2,208.8L457.5,209.7Z",459.6,204],
["688","Serbien","M544.2,99.6L545.9,98.8L547.4,98.9L548.8,100.1L549.2,101.1L550.7,101.8L551,103.1L552.5,104L553.2,103.3L553.8,103.7L553.3,104.2L553.8,104.7L553.3,105.4L553.6,106.5L555,107.9L554.2,108.9L553.9,109.9L554.2,110.2L553.8,110.7L552.7,110.7L551.9,110.9L551.8,110.7L552.1,110.3L552.3,109.5L551.9,109.6L551.4,109L551,108.8L550.6,108.3L550.1,108.1L549.8,107.7L549.3,107.9L549.1,108.9L548.6,109.1L548.7,108.9L547.8,108.2L546.9,107.9L546.6,107.4L545.9,106.9L546.4,106.8L546.6,105.3L545.3,104.1L545.8,102.8L544.9,102.8L545.7,101.6L544.9,100.8Z",549.3,105.1],
["694","Sierra Leone","M463.7,227L465.2,225.4L465.5,224.4L466,223.6L466.8,223.5L467.4,222.8L469.6,222.8L470.3,224.1L470.9,225.7L470.8,226.7L471.2,227.7L471.2,229.1L472,228.9L470.7,230.6L469.4,232.6L469.2,233.7L468.6,234.8L467.8,234.6L465.9,233.1L464.5,231.1L464,229.7Z",467.5,228.4],
["703","Slowakei","M551.7,90.1L551.1,90.9L550.8,92.1L550.4,92.4L547.8,91.5L547.1,91.7L546.6,92.3L545.6,92.7L545.3,92.5L544.2,93L543.3,93.1L543.2,93.7L541.3,94L540.4,93.7L539.2,93L538.8,91.9L539,91.6L539.2,90.9L540.3,91L541,90.7L541,90.4L541.5,90.2L541.5,89.6L542.1,89.4L542.4,88.9L543,88.9L543.2,89.1L544.1,88.7L545.3,89.7L546.6,89.1L547.7,89.4L549.3,89Z",543.7,91],
["704","Vietnam","M785.2,221.2L787.4,219.7L790.2,219.4L788.7,217.2L792.9,214.4L792.6,210L791.6,207.6L791.4,203.9L790.3,201.3L787.8,198.8L785.4,195.6L782.3,191.3L778.6,189.2L779.1,187.9L780.6,187L778.8,183.8L775.5,183.8L773.5,180.5L771.3,177.7L772.5,176.9L774.6,176.9L777.1,176.5L778.8,174.6L780.5,175.9L783.1,176.6L783.2,178.6L784.8,180.1L787.7,181L784.9,184L783.5,187.4L783.5,189.9L786.4,193.7L789.9,198.5L792.8,200.7L794.9,203.6L797.3,210.4L797.9,216.8L796,219.3L793.1,221.6L791.3,224.7L788.2,228.1L787,225.8L787.5,223.3Z",779.4,179.8],
["705","Slowenien","M532.3,97.8L534.2,98L535.3,97.3L537.3,97.2L537.7,96.7L538.1,96.8L538.7,97.8L536.9,98.6L536.8,99.8L536,100.1L536.1,101L535.2,100.9L534.3,100.4L533.9,100.9L532.3,100.8L532.8,100.6L532.1,99.3Z",535,99.2],
["706","Somalia","M614.6,266.2L612.9,263.2L612.9,249.7L615.2,245.5L615.9,244.3L617.7,244.2L620.1,241.6L623.7,241.4L631.1,230.3L632.9,227.3L634,225L633.9,223.1L633.7,219.4L633.6,217.8L633.6,217.8L634.5,217.7L635.7,217.2L637.1,216.8L638.3,215.5L639.4,215.5L639.5,216.5L639.4,218.7L639.5,220.6L639,221.9L638.4,225.9L637.3,230L635.8,234.8L633.6,240.2L631.4,244.3L628.2,249.4L625.5,252.4L621.4,256.1L618.9,258.9L615.8,263.4L615.2,265.4Z",619.5,249.8],
["710","Südafrika","M542.4,363.7L543.7,362L544.7,363L545.1,364.5L546.2,364.7L547.8,365.4L549.2,365.1L551.6,363.3L552.4,350.4L553.1,351L554.4,354.3L554.1,356.4L554.6,357.7L556.5,357.3L557.9,355.7L559.2,354.7L560,353L561.3,352.2L562.4,352.6L563.5,353.6L565.7,353.8L567.4,353L567.8,351.9L568.3,350.2L569.8,349.9L570.7,348.6L571.7,346.2L574.3,343.6L578.2,340.9L579.3,341L580.6,341.6L581.5,341.2L582.9,341.5L583.7,346.5L584.2,349L583.4,353L583.5,354.2L582.2,353.6L581.5,353.8L581.1,354.8L580.3,356.2L580.2,357.4L581.6,359.3L583.1,358.9L583.8,357.3L585.8,357.4L584.9,359.9L584.3,362.8L583.5,364.4L581.5,366.1L581,366.6L579.7,368.3L578.8,370.1L577.1,372.6L573.8,376.1L571.8,378.1L569.7,379.6L566.9,381L565.6,381.1L565.2,382.1L563.7,381.6L562.4,382.2L559.7,381.6L558.1,382L557.1,381.8L554.4,383.1L552.2,383.6L550.5,384.9L549.4,385L548.4,383.8L547.5,383.7L546.6,382.2L546.4,382.7L546.1,381.8L546.3,379.8L545.6,377.6L546.5,376.9L546.6,374.3L545.1,371.1L544,368.2L544,368.2ZM575,365.1L574,364L572.7,364.7L571.2,366.1L569.6,368.2L571.3,370.9L572.3,370.5L572.8,369.4L574.3,368.9L574.9,367.8L575.8,366.1Z",559.2,370.9],
["716","Simbabwe","M582.9,341.5L581.5,341.2L580.6,341.6L579.3,341L578.2,340.9L576.7,339.3L574.6,338.8L574,336.5L574.1,335.2L573,334.9L570.2,330.9L569.4,328.8L568.9,328.2L568,325.3L571,325.7L571.9,326.1L572.8,326L574.4,323.7L576.9,320.7L577.9,320.4L578.3,319.1L579.9,317.7L582,317.2L582.1,318.6L584.3,318.5L585.5,319.3L586.1,320.2L587.3,320.4L588.7,321.6L588.4,326.2L587.7,328.7L587.4,331.4L587.8,332.4L587.3,334.5L586.9,334.9L586,337.5Z",579.7,329.8],
["724","Spanien","M481.5,127.5L481.3,126.4L482.3,125.2L482.6,124.3L481.8,123.3L482.6,121.2L481.6,119.2L482.7,119L482.9,117.5L483.3,117L483.4,114.5L484.5,113.6L483.9,112.1L482.5,111.9L482.1,112.3L480.7,112.3L480.1,110.8L479.1,111.3L478.2,112.1L478.4,109.8L477.5,108.5L481,106.2L483.9,106.8L487.1,106.8L489.6,107.3L491.6,107.1L495.5,107.2L496.4,108.4L500.8,109.9L501.7,109.2L504.4,110.6L507.2,110.2L507.3,112L505.1,114.1L502,114.8L501.8,115.9L500.3,117.6L499.3,120.3L500.3,122.1L498.8,123.6L498.3,125.7L496.4,126.3L494.7,128.9L491.5,128.9L489.1,128.8L487.5,130L486.6,131.3L485.3,131L484.4,129.9L483.8,128Z",491,120],
["728","Südsudan","M584.9,247L582.4,244.5L581.8,242.9L580.2,243.7L579,243.5L578.2,244.1L577,243.6L575.3,240.6L574.8,239.4L572.7,237.9L572,235.7L570.8,234.1L568.9,232.2L568.9,231L567.4,229.5L565.5,228.1L566.3,227.7L567.2,227L567.8,223.7L568.5,222L570.5,221.5L571,222.5L572.5,224.6L573.2,224.9L574.2,224.3L576.2,224.4L576.6,225.2L579.3,225.2L579.4,224.4L580.8,223.7L581,222.7L582,221.9L584.4,224.1L585.8,223.7L587.1,221L588.5,219L588.2,216.8L587.5,215.7L589.1,215.5L589.2,214.7L590.5,215L590.3,217.7L590.7,220.3L592.2,221.8L592.6,223L592.6,224.9L593,225L593.1,227.8L592.7,229L591.3,229L590.4,231.1L592.1,231.4L593.5,233.2L594.1,234.7L595.3,235.5L597,239.6L595.2,242L593.6,244.2L591.9,245.9L590,245.9L587.8,246.8L586,246Z",581.9,233.8],
["729","Sudan","M567.4,229.5L565.2,227.9L564.3,226.8L564.1,225.7L564.5,224.1L564.4,222.6L562.8,220.3L562.4,218.8L562.4,217.9L561.4,216.8L561.3,214.7L560.7,213.3L559.8,213.5L560,212.1L560.6,210.6L560.3,209.1L561.1,208L560.5,207.1L561.2,204.9L562.3,202.2L564.7,202.4L563.9,188.1L563.8,186.5L566.9,186.5L566.5,179.4L577.2,179.4L587.5,179.4L598,179.4L599.2,182.9L598.7,183.5L599.4,187.2L600.7,191.5L601.8,192.4L603.4,193.8L602.1,195.8L600.2,196.4L599.4,197.5L599.3,199.9L598.5,205.3L598.9,206.8L598.6,209.9L597.7,213.5L596.1,215.3L595.1,218.1L594.9,219.6L593.6,220.7L593,224.5L593.1,227.8L593,225L592.6,224.9L592.6,223L592.2,221.8L590.7,220.3L590.3,217.7L590.5,215L589.2,214.7L589.1,215.5L587.5,215.7L588.2,216.8L588.5,219L587.1,221L585.8,223.7L584.4,224.1L582,221.9L581,222.7L580.8,223.7L579.4,224.4L579.3,225.2L576.6,225.2L576.2,224.4L574.2,224.3L573.2,224.9L572.5,224.6L571,222.5L570.5,221.5L568.5,222L567.8,223.7L567.2,227L566.3,227.7L565.5,228.1Z",581.9,196.9],
["732","Westsahara","M477.4,159.4L477.4,159.7L477.4,160.4L477.2,165.7L468.6,165.5L468.4,174.5L465.9,174.8L465.2,176.6L465.5,181.8L455.1,181.8L454.5,183L454.7,181.5L454.7,181.5L460.7,181.2L461.1,179.9L462.2,178.3L463.3,173.4L467.1,169.6L468.5,165.1L469.3,164.9L470.2,162.1L472.5,161.8L473.4,162.2L474.6,162.2L475.4,161.4L477.1,161.3L477,159.4Z",463.5,179.8],
["740","Suriname","M349.8,251.4L348.2,250.6L346.9,251L345.8,250.7L345.5,251.8L346,252.5L345.7,253.3L344.2,252.9L342.6,249.7L342.3,247.6L341.4,247.6L340.2,244.9L340.8,243L340.7,242.1L342.4,241.2L342.9,237.8L346.2,238.6L346.5,237.9L348.8,237.7L351.7,238.6L350.1,241.8L350.3,244.4L351.3,246.6L350.8,248.2L350.5,249.9Z",345.7,244.5],
["748","Eswatini","M583.8,357.3L583.1,358.9L581.6,359.3L580.2,357.4L580.3,356.2L581.1,354.8L581.5,353.8L582.2,353.6L583.5,354.2L583.7,355.8Z",582,356.9],
["752","Schweden","M523.2,63.4L523.9,62L525.5,60.3L525.9,57.4L524.4,56.2L524,53.1L525.1,51L527,51L527.6,50.1L526.8,49.4L529.4,46.3L531,44L532,42.6L533.9,42.6L534.2,41.5L537.8,41.8L537.8,40.5L539,40.4L541.7,41.4L545,42.7L545.8,45.9L546.6,46.7L543.4,47.3L541.8,48.9L542.4,50.2L539.6,52L536,54L535.1,57.3L536.8,59L539,60.4L537.5,63.2L535.4,63.8L535.1,68.1L534.2,70.5L531.6,70.3L530.6,72.4L528.1,72.5L527.2,70L525.1,67Z",535,48.1],
["756","Schweiz","M522.2,94.7L522.4,95.3L522,96L523.1,96.5L524.3,96.6L524.2,97.9L523.2,98.4L521.5,98L521,99.2L519.9,99.3L519.5,98.8L518.2,99.8L517.1,100L516,99.3L515.2,98L514.1,98.5L514.1,97.1L515.7,95.4L515.6,94.7L516.7,95L517.3,94.4L519.3,94.5L519.7,93.8Z",517.6,97.2],
["760","Syrien","M590.9,142.1L590.8,142.1L591.1,141.6L590.9,140.2L591.2,138.3L592.4,137.1L591.8,135.8L590.7,135.6L590.1,133L590.5,131.7L591,131L591.6,130.2L591.5,128.4L592.4,129L595,128.1L596.4,128.7L598.4,128.7L601.1,127.5L602.4,127.5L605.2,127L604.3,129.1L603,129.9L603.7,132.3L603.4,136.4L598.4,139.8L593.9,143.4Z",597.1,134.2],
["762","Tadschikistan","M668.5,127.3L668.9,124L667.6,121.6L665.6,120.8L665.8,119.4L667.9,119.5L668.5,117.8L668.5,115.7L671.5,115L671.5,116.5L672.2,117.3L673.2,117.3L672.6,118.3L669.8,117.7L670.2,119.6L672.7,119.3L676.1,120.4L680.6,119.9L682.2,122.9L682.9,122.5L684.7,123.3L685,124.6L686,126.4L683.4,126.4L681.6,126.2L680.6,127.6L679.6,128L678.9,128.7L677.6,127.6L677,124.8L676.2,124.7L676.1,123.7L674.5,122.9L673.8,124.1L674,125.4L673.8,125.9L672.3,125.8L671.9,127.3L670.9,126.7L669.4,127.7Z",679.7,124.1],
["764","Thailand","M785.7,207.3L783,206.8L779.6,207.5L778.4,210.5L779.6,214.9L777,213.3L774.6,213.3L774.6,210.4L772.2,210.5L772.6,214.5L771.8,219.9L771.3,223.1L771.7,225.8L773.5,225.9L774.9,229.3L775.7,232.5L777.4,234.6L779.1,235L780.7,236.9L779.9,238.4L778.1,238.9L777.7,237L775.4,235.4L775,236L773.8,234.6L773.2,232.8L771.5,230.7L770,228.9L769.8,231.1L769.1,229.1L769.2,226.8L769.6,223.2L770.5,219.4L771.6,216L770.1,212.7L769.9,211L769.3,208.9L767,206L766.1,204.2L766.9,203.5L767.4,200.4L765.8,198L763.6,195.3L761.7,192.1L762.7,191.5L763.1,187.6L765,187.4L766.2,185.9L767.6,185L769,186.2L769.6,188.3L771.4,188.5L771.6,192.3L772.3,195.5L774.7,193.4L775.6,194L777.2,193.9L777.5,192.6L779.6,192.9L782.2,195.8L783.1,199.4L785.8,202.6L786.3,205.7Z",774.4,202.5],
["768","Togo","M502.5,219.3L502.1,221.2L502.9,222.3L503.9,223.6L504,225.4L504.6,226.2L504.4,234.7L505.1,237.2L502.9,238L502.3,236.7L501.6,234.4L501.3,232.5L501.9,229.2L501.3,227.9L501,224.9L501,222.3L499.9,220.4L500.1,219.2Z",502.9,226.7],
["780","Trinidad und Tobago","M331.5,220.2L333.1,219.7L333.6,219.8L333.3,222.6L331,223L330.6,222.6L331.4,221.6Z",332.5,221],
["784","Vereinigte Arabische Emirate","M636.1,171.4L636.5,171.2L636.8,172.2L638.8,171.7L641,171.7L642.6,171.9L644,169.5L645.6,167.2L647,165L647.6,166.2L648.4,169L647.1,169L647.2,171.3L647.8,171.8L646.7,172.5L646.9,174L646.3,175.4L646.5,176.9L646,177.6L637.8,175.8L636.3,172.2Z",643.8,174.3],
["788","Tunesien","M524.4,150.3L523.1,144.2L521.5,142.8L521.4,142L519.3,140L519,137.4L520.5,135.6L521,132.8L520.5,129.7L520.9,128L523.6,126.6L525.4,127L525.4,128.7L527.4,127.5L527.6,128.1L526.4,129.7L526.5,131.3L527.4,132.1L527.2,135L525.6,136.6L526.2,138.5L527.5,138.5L528.2,140.1L529.2,140.7L529.1,143.3L527.9,144.2L527.2,145.3L525.5,146.6L525.8,148L525.6,149.5Z",522.6,138.4],
["792","Türkei","M611.2,127.2L610.1,127.8L609.1,127L606.1,126.5L605.2,127L602.4,127.5L601.1,127.5L598.4,128.7L596.4,128.7L595,128.1L592.4,129L591.5,128.4L591.6,130.2L591,131L590.5,131.7L589.3,130.2L590.1,128.9L588.6,129.2L586.4,128.5L585,130.4L581.2,130.7L579,129L576.3,128.8L575.9,130.2L574.2,130.6L571.6,128.9L568.9,128.9L567,125.6L565,123.8L565.9,121.3L564.1,119.8L566.4,116.7L570.2,116.6L570.9,114.2L575.5,114.6L578.1,112.5L580.8,111.6L584.8,111.6L589.4,113.8L593.1,115L595.8,114.5L598,114.8L600.5,113.2L603,113L605.7,114.6L606.4,115.7L606.4,117.2L608.4,118L609.6,119L608.1,119.9L609.6,123.6L609.3,124.6ZM563,112.2L565.4,111.2L567.5,111.7L568,112.9L570.2,113.9L569.9,114.7L567,114.9L566.1,115.8L564.3,117.6L563.4,116.1L563.3,115.4L563.8,115.1L564.3,113.1Z",582.4,120.5],
["795","Turkmenistan","M626.8,112.4L627.6,111.3L630.1,110.7L632,111.5L634.4,114L635.6,113.9L638.3,113.8L637.4,112.2L639.2,111.1L640.6,109.3L644.4,111L645.4,113.5L646.5,114.1L649.1,114L650.1,114.6L652.3,117.9L655.7,120.1L657.8,121.6L660.8,123.2L664.5,124.6L665.1,126.6L664.3,126.5L662.9,125.6L662.8,126.8L660.9,127.4L661.1,130.1L660,131.1L658.1,131.6L658,133.1L656.2,133.5L653.4,132.3L652.4,129.5L650.5,129.3L646.9,126.4L644.9,126.1L641.7,124.4L639.9,124.1L638.9,124.7L637.3,124.6L636,126.5L633.9,127.1L632.9,124.8L632.4,121.4L630.3,120.3L630.3,118.1L628.7,117.9L628.5,115.2L631,116L632.9,115L630.6,113.1L629.4,111.3L627.7,112.1L628.1,114.4Z",646.6,120.2],
["800","Uganda","M593.4,263.5L587.8,263.8L584.8,263.8L583.8,264.2L582.2,265.4L581.5,265L581.5,262.2L582.2,260.8L582.3,257.8L582.9,256.1L583.9,254.1L585,253.1L585.9,251.8L584.8,251.3L584.9,247L586,246L587.8,246.8L590,245.9L591.9,245.9L593.6,244.2L594.9,246.8L595.3,248.7L596.5,252.9L595.5,255.6L594.2,258.1L593.4,259.6Z",588,258.2],
["804","Ukraine","M578.4,99.4L578,99.1L574.2,98.3L573.9,97.2L571.8,97.6L571.2,99.2L569.8,101.5L568.6,100.9L567.6,101.4L566.4,100.9L567,100.5L567.2,99.5L567.7,98.5L567.5,98L567.9,97.7L568.2,98.2L569.6,98.3L570.2,98L569.7,97.7L569.8,97.3L568.8,96.5L568.3,95.3L567.3,94.8L567.3,93.8L566.2,93L565.2,92.9L563.3,91.9L561.8,92.2L561.4,92.7L560.4,92.7L559.9,93.4L558.3,93.6L557.5,94.1L556.4,93.4L554.9,93.4L553.4,93L552.5,93.7L552.2,92.9L550.8,92.1L551.1,90.9L551.7,90.1L552.2,90.3L551.4,89L553.1,86.6L554.2,86.2L554.3,85.4L552.8,82.9L553.8,82.8L554.9,82.1L556.7,82L559,82.2L561.6,82.9L563.4,83L564.3,83.4L565,82.9L565.8,83.5L567.7,83.4L568.7,83.7L568.6,82.2L569.1,81.6L571,81.5L571.9,81.6L572.3,80.9L573,81.1L575.2,80.8L577,82.4L576.6,83L577,83.9L578.8,84L579.9,85.2L580,85.8L583.1,86.8L584.7,86.3L586.5,87.7L587.8,87.7L591.4,88.6L591.6,89.5L591.1,91L592,92.6L591.8,93.6L589.7,93.8L588.7,94.7L588.9,96L587.1,96.2L585.7,97.2L583.6,97.4L581.8,98.5L582.2,100.1L582.3,100.4L583.6,101.1L586,100.9L585.7,102L583.3,102.5L580.4,104.3L579,103.7L579.2,102.3L576.5,101.4L576.8,100.8L578.8,99.8Z",573.5,90.1],
["807","Nordmazedonien","M553.8,110.7L555.2,111.7L555.6,113.8L555.1,113.9L554.8,114.4L553.5,114.4L552.6,115.1L551.1,115.4L550,114.6L549.5,113.2L549.7,112.1L550,112.2L550,111.5L551.4,111L551.9,110.9L552.7,110.7Z",551.8,113.1],
["818","Ägypten","M598,179.4L587.5,179.4L577.2,179.4L566.5,179.4L565.6,166.4L564.7,154L563.7,151.2L564.1,149.1L563.6,147.6L564.4,146L567.8,145.9L570.3,146.8L573,147.8L574.2,148.4L576.1,147.3L577,146.3L579.3,146L581.1,146.4L582,148.1L582.5,147L584.6,147.8L586.7,148L587.8,147.2L589.9,152.2L590.2,153.1L589.6,154.4L589.4,157.1L588.9,158.9L588.3,159.5L587.3,158.4L586,156.8L583.6,151.9L583.4,152.2L584.9,155.8L586.8,159.3L589.4,164.7L590.5,166.6L591.6,168.6L594.3,172.5L593.8,173.2L594.1,175.5L597.5,178.7Z",577.6,167.5],
["826","Vereinigtes Königreich","M486.4,76.6L484.7,76L483.4,76L483.9,74.6L483.5,73.1L485.4,73L487.6,74.7ZM493.2,77.8L493.2,77.8L493.5,76.2L492.1,74.6L492.1,74.5L489.4,74L488.9,73.3L489.8,72.1L489.1,71.4L487.9,72.6L487.8,70.1L486.8,68.7L487.7,66.1L489.5,64L491.1,64.2L493.7,64L491.3,66.7L493.5,66.4L495.8,66.4L495.3,68.5L493.3,70.9L495.5,71L495.7,71.3L497.6,74.5L499.1,74.9L500.4,78.1L501,79.1L503.7,79.7L503.5,81.5L502.3,82.3L503.3,83.8L501.2,85.3L498.2,85.2L494.4,86L493.3,85.5L491.8,86.8L489.7,86.5L488.1,87.6L486.9,87L490.3,84L492.3,83.4L492.3,83.4L488.8,82.9L488.2,81.8L490.6,80.9L489.4,79.4L489.9,77.6Z",496.7,80.8],
["834","Tansania","M593.4,263.5L593.9,263.9L603.8,271.5L604,273.6L607.9,277.3L606.5,281.9L606.6,284L608.3,285.4L608.4,286.3L607.5,288.6L607.7,289.7L607.4,291.4L608.3,293.8L609.3,297.4L610.2,298.2L608,300.3L604.9,301.8L603.3,301.7L602.2,302.8L600.3,302.9L599.6,303.4L596.4,302.3L594.3,302.6L593.8,297.6L592.9,295.9L592.4,294.9L589.7,294.2L588.2,293.1L586.5,292.5L585.4,291.8L584.3,290.9L582.9,286.2L581.4,284.2L580.9,282L581.2,280.1L580.7,276.7L581.9,276.5L582.9,275.2L584,273.2L584.7,272.5L584.7,271.3L584.1,270.4L583.9,269L584.7,268.5L584.9,266.3L583.8,264.2L584.8,263.8L587.8,263.8Z",594.1,281.1],
["840","USA","M218.5,90.4L225,90.4L231.8,90.4L234.1,90.4L241.1,90.4L247.8,90.4L254.7,90.4L261.6,90.4L269.4,90.4L277.2,90.4L282,90.4L282.6,89.2L283.4,89.2L282.9,90.8L283.3,91.3L284.8,91.5L286.9,92L288.6,92.9L290.7,92.5L293.1,93.3L293.9,93.3L296.4,92.4L298,93.5L299.6,94.6L301,95.6L302.3,96.6L302.2,97.4L302.6,97.7L302.3,98L302.9,98.1L303.5,97.8L303.2,98.5L303.5,99L304.1,99L304.3,99.3L303.7,99.9L305.5,101.3L304.8,104.1L304.1,106.8L302.6,108.6L300.7,110.3L299.7,111.4L299.5,111.8L299.6,112.2L300.2,112.7L300.8,112.7L304.3,111L307,110.5L310.8,109L310.9,108.7L311.1,107.7L311,107.1L312.3,106.6L314.6,106.6L316.8,106.6L318.1,105.4L318.5,105.1L321.9,102.9L323.2,102.4L326.8,102.3L331.1,102.3L331.7,101.6L332.5,101.4L333.7,101L335.1,99.6L336.7,97.2L339.4,95L339.9,95.7L341.6,95.2L342.3,96.1L340.7,100.2L341.6,101.9L341.6,102.9L338.6,104.4L335.7,105.5L332.9,106.4L330.9,108.3L330.3,109L329.6,110.6L329.8,112.3L330.8,112.4L330.9,111.2L331.4,111.9L330.9,112.8L329.1,113.3L328,113.3L326,113.8L324.9,114L323.4,114.1L321,115.1L324.8,114.5L325.3,115.1L321.6,116L320,116L320.2,115.6L319.2,116.5L319.9,116.7L318.5,119L315.9,121.5L316,120.6L315.5,120.5L315,119.7L314.9,121.4L315.3,122L314.9,123.2L313.7,124.5L311.4,127.1L311.2,126.9L312.7,124.7L311.9,123.5L312.5,120.8L311.6,122.2L311.4,124.2L309.9,123.7L311.3,124.8L310.3,127.9L311,128.1L310.9,129.3L310.2,132.6L307.8,135L304.9,136L302.6,138L301.3,138.2L299.6,139.5L298.9,140.6L295.5,142.8L293.6,144.4L291.8,146.4L290.7,148.8L290.5,151.2L290.5,154.2L291,156.6L290.6,158.1L290.9,162.2L290.2,164.5L289.8,165.9L288.7,168L287.8,168.5L286.6,168L286.5,166.5L285.7,165.7L285,162.7L284.5,160L284.5,158.7L285.6,156.3L285.4,154.4L284.2,151.6L283.3,151L280.3,152.6L279.9,152.4L279.1,150.8L277.7,150L274.7,150.4L272.5,150L270.5,150.3L269.2,150.8L269.4,151.7L269,153.1L269.3,153.8L268.7,154.2L267.9,153.7L266.7,154.4L264.9,154.3L263.5,152.5L261.1,152.9L259.5,152.1L257.8,152.3L255.4,153.1L252.2,155.7L249.2,157.2L247.2,158.8L246.2,160.4L245.4,162.8L245.1,164.5L245.2,165.7L244.2,165.8L242.5,165L240.8,163.9L240.6,162.3L240.7,159.9L239.8,157.9L239.6,155.8L239.1,153.5L237.7,152.1L235.6,152.2L233,154.9L231.2,153.9L230.2,152.8L230.3,150.9L230.1,149.1L229.1,147.6L228.2,146.6L227.7,145.3L223.3,145.3L222.8,146.7L220.7,146.7L215.6,146.8L210.8,144.4L207.6,142.7L208.1,142.1L204.7,142.4L201.7,142.7L202.1,141L201.3,139L200.3,138.6L200.5,137.7L199.1,137.5L198.6,136.6L196.5,136.3L196.1,135.7L196.7,133.9L195.9,130.6L196.2,126L196.7,125.2L196.2,124.1L195.9,121.4L197.1,118.8L196.8,117L198.9,114.4L200.5,111.7L201.3,109.3L204.1,106.3L206.3,103.5L208.5,100.8L211,96.7L212.1,94.1L212.5,92.8L213.2,92.2L215.8,93.2L214.9,96L216.1,95.2L217.5,92.8ZM84.3,186.3L84.6,186.6L84.9,187.1L85.2,188.3L85,188.5L83.7,189.3L82.7,189.8L82.1,190.4L81.6,189.9L82,188.9L82,187.6L82.3,187.2L82.9,186.6L83,185.9L83.3,185.6L83.5,185.7ZM83.5,183.8L83.2,184.2L82.2,184.5L82,183.7L81.8,183.4L81.8,183.2L82.2,182.9L83,183.3ZM82,182.3L81.8,182.7L80.4,182.6L80.8,182.2ZM79.4,180.4L79.5,180.6L79.9,181.8L79.6,182L79.5,182L78.6,181.8L78.5,181L78.5,180.9ZM76.5,178.6L76.2,179.5L75.8,179.8L75.2,179.2L75.4,178.9L75.9,178.5ZM155.7,59.6L157.1,59.8L156,60.8L154.2,61.2L153.4,60.7L153.1,60ZM175.5,65.7L176.7,65.8L176.7,66.6L173.3,67.9L170,68.9L169.7,68.2L170.9,67L173.9,66.1ZM235.6,39.3L224.9,46.7L208.2,59.8L210.1,59.9L211.4,60.6L211.6,61.6L211.6,63.3L215.2,61.9L218.2,61.1L217.8,62.4L218.1,63.4L218.8,64.5L218.2,66.4L217.3,69.3L219.3,71L217.7,72.7L215.3,74L215.1,73L214,72.1L215.7,69.8L215.1,67.7L216.5,65.3L214.6,65.1L211.4,65L209.7,64.3L208.3,61.7L206.9,61.2L204.3,60.4L201.1,60.6L198.5,59.4L197.3,58.4L194.4,58.9L192.7,60.6L191.3,60.8L188.3,61.3L185.4,62.1L182.4,62.7L184,61.2L188,58.8L191.1,58L191.3,57.4L187,58.8L183.5,60.4L178.2,62.2L178.2,63.4L174,65.2L170.4,66.3L167.3,67.1L165.3,68.2L160.4,69.6L158.2,70.8L154.3,72L153.1,71.8L150.1,72.5L146.9,73.4L144,74.3L139.3,75.1L139.5,74.6L143.4,73.4L146.5,72.5L150.6,71.1L153.6,70.8L156,69.7L160.9,68.1L162,67.6L164.7,66.7L167.5,64.8L170.5,63.3L167.1,64L167,63.6L164.7,64.5L164.9,63.2L163.2,64.1L164,62.9L160.6,63.9L159.3,63.9L161.1,62.4L162.7,61.5L162.6,60.6L159.2,61.1L159.1,59.9L158.5,59.3L160.4,57.9L160.3,56.9L163.1,55.6L166.7,54.3L169.1,53.1L171,52.9L171.9,53.3L175.1,52.2L176.3,52.4L178.8,51.7L180,50.6L179.5,50.2L182.2,49.4L181,49.4L178.2,49.9L176.8,50.4L176,49.9L172.8,50.1L170.7,49.6L171.3,48.7L170.8,47.4L175,46.6L181,45.5L182.6,45.5L180.7,46.6L184.9,46.5L185.4,45.2L184.3,44.4L184.6,43.4L184.2,42.5L182.7,41.9L185.5,40.9L189,40.8L192.8,39.9L194.9,39L198.3,38.1L200.5,37.9L205.4,37.1L206.9,37.2L211.4,36.3L213.5,36.6L213.5,37.4L214.9,37.1L217.9,37.2L217.1,37.6L219.4,37.9L221.6,37.7L224.6,38.3L227.9,38.5L229,38.7L231.9,38.4L233.9,39ZM157,51.6L157.6,52.1L159.2,51.8L159.8,52.4L161.4,52.7L160.8,53L158.5,53.5L157.8,53L157.7,52.5L155.7,52.7L155.5,52.5Z",249,121.9],
["854","Burkina Faso","M485.2,221.6L485.1,219.5L485.8,217.9L485.8,216.7L487.9,213.6L488.4,211.1L489.1,210.2L490.4,210.7L491.6,210L491.9,209L494.1,207.4L494.6,206.3L497.1,204.7L498.6,204.2L499.3,204.9L501,204.9L500.8,206.7L501.2,208.3L502.7,210.7L502.8,212.5L505.9,213.3L505.9,215.8L505.3,216.9L503.9,217.3L503.4,218.9L502.5,219.3L500.1,219.2L498.8,218.9L497.9,219.5L496.7,219.3L492,219.4L491.9,221.5L492.3,224.3L490.4,223.3L489.1,223.5L488.2,224.4L486.9,223.6L486.4,222.4Z",496.7,213.2],
["858","Uruguay","M351.6,369.4L353.2,369L356.3,371.7L357.3,371.6L360.3,373.8L362.7,375.7L364.6,378L363.8,379.6L364.9,381.5L364.3,383.6L361.8,385.4L359.8,384.8L358.5,385.1L355.9,383.7L354.2,383.8L352.2,381.9L351.9,379.8L352.3,379L351.6,375.6L351.5,372.1Z",357.7,378.6],
["860","Usbekistan","M635.6,113.9L632.1,102.4L637.6,100.6L638.1,100.8L642.5,103L644.8,104.2L648,107L650.6,106.5L654.7,106.3L658.3,108.6L659.2,111.7L660.4,111.7L661.7,114.3L664.8,114.4L666,115.9L666.9,115.9L667.2,113.6L669.6,111.4L670.8,110.8L671.6,111.2L670.3,113.2L672.5,114.4L674,113.6L677.4,115.3L675.1,117.6L673.2,117.3L672.2,117.3L671.5,116.5L671.5,115L668.5,115.7L668.5,117.8L667.9,119.5L665.8,119.4L665.6,120.8L667.6,121.6L668.9,124L668.5,127.3L666.4,126.6L665.1,126.6L664.5,124.6L660.8,123.2L657.8,121.6L655.7,120.1L652.3,117.9L650.1,114.6L649.1,114L646.5,114.1L645.4,113.5L644.4,111L640.6,109.3L639.2,111.1L637.4,112.2L638.3,113.8Z",654.1,111.7],
["862","Venezuela","M333,240.7L333.3,241.8L332.2,243.2L329.1,244.6L327.1,245.1L326.3,246L324.2,245.1L322.1,244.6L321.6,244.9L322.8,245.9L322.6,248.4L323,250.7L325.3,251.1L325.4,251.8L323.5,252.9L323.1,254.5L322,255.1L319.9,255.9L319.4,257.1L317.2,257.3L315.7,255.3L314.9,251.6L314.2,250.3L313.3,249.5L314.7,247.7L314.6,246.9L313.9,245.8L313.4,243.3L313.7,240.6L314.4,239.4L314.9,237.4L314,236.8L312.4,237.2L310.4,237L309.3,237.4L307.5,234.2L306,233.7L302.4,234.1L301.8,232.8L301.2,232.5L301.1,231.7L301.5,230.3L301.4,228.9L300.9,228L300.6,226.3L299.2,226.1L300.2,223.9L300.7,221.3L301.6,219.9L302.8,218.9L303.6,217.1L305.4,216.4L305.3,217.3L303.6,217.7L304.4,219.4L304.2,221.3L302.8,223.5L303.6,226.4L304.8,226.2L305.6,223.5L304.9,222.2L305,219.4L308.5,217.9L308.3,216.2L309.3,215L310.1,217.6L312,217.7L313.6,219.7L313.6,220.9L316.1,221L319,220.6L320.5,222.2L322.5,222.7L324.1,221.5L324.2,220.6L327.6,220.4L330.9,220.3L328.5,221.4L329.3,223.2L331.5,223.4L333.4,225.3L333.7,228.2L335.1,228.1L336.2,229L333.9,231.2L333.6,232.5L334.5,233.9L333.7,234.6L332,235.2L332,236.9L331.2,237.9Z",323,232.2],
["887","Jemen","M639.5,190.1L642.3,196.1L643.4,198.6L641.5,199.6L641.2,201.2L641.2,202.5L638.7,204L634.5,205.7L632.2,208.3L631,208.5L630.2,208.3L628.7,209.8L627.1,210.5L624.8,210.7L624.1,210.9L623.6,211.9L622.9,212.1L622.5,213.1L621.2,213L620.3,213.5L618.4,213.3L617.6,211.1L617.5,209.1L617,208.1L616.3,205.4L615.4,203.9L616,203.7L615.6,202L615.8,201.3L615.6,199.7L616.7,198.6L616.3,197.1L616.9,195.3L618.1,196.2L618.8,195.9L621.9,195.8L622.4,196.2L625,196.5L626,196.3L626.8,197.6L628,197L629.6,193.2L631.9,191.5Z",623.3,203.7],
["894","Sambia","M584.3,290.9L585.4,291.8L586.5,292.5L588.2,293.1L589.7,294.2L590.9,295.8L591.5,299L591,300L590.4,302.9L590.7,306L589.8,307.3L588.8,310.7L590.2,311.6L581.8,314.6L582,317.2L579.9,317.7L578.3,319.1L577.9,320.4L576.9,320.7L574.4,323.7L572.8,326L571.9,326.1L571,325.7L568,325.3L567.6,325L567.6,324.7L566.5,323.9L564.8,323.7L562.5,324.5L560.9,322.3L559.2,319.3L559.7,307.7L565.4,307.7L565.2,306.5L565.6,305.1L565.2,303.4L565.6,301.6L565.3,300.4L566.3,300.5L566.4,301.7L567.7,301.6L569.4,301.9L570.2,303.6L572.4,304.1L574.1,302.9L574.7,304.9L576.7,305.4L577.7,306.9L578.7,309L580.8,309L580.7,305L580,305.7L578.1,304.3L577.4,303.6L577.9,299.9L578.5,295.6L577.9,293.9L578.8,291.6L579.5,291.1L583.2,290.5Z",569.6,315.5],
["","Kosovo","M549.7,112.1L549.4,111L548.8,110.7L548.2,109.8L548.6,109.1L549.1,108.9L549.3,107.9L549.8,107.7L550.1,108.1L550.6,108.3L551,108.8L551.4,109L551.9,109.6L552.3,109.5L552.1,110.3L551.8,110.7L551.9,110.9L551.4,111L550,111.5L550,112.2Z",550.1,109.8],
["","Nordzypern","M582.2,133.9L582.4,133.9L582.7,133.1L584.5,133.2L586.6,132.2L585.1,133.6L585.4,134.2L585.1,134.1L584.7,134.4L584.3,134.3L584.2,134.4L584.1,134.1L583.9,133.9L583.4,133.8L582.7,134.1Z",584.6,133.7],
["","Somaliland","M633.6,217.8L633.6,217.8L633.7,219.4L633.9,223.1L634,225L632.9,227.3L631.1,230.3L628.8,230.4L619.6,226L618.5,224.7L617.4,222.9L616.3,220.9L616.9,219.6L617.8,217.6L618.7,218.3L619.3,219.8L620.6,221.3L622,221.3L624.5,220.4L627.4,220L629.8,218.8L631.1,218.6L632.1,217.9Z",628.6,224.8]
] };
/* WORLDMAP:END */

export { makeAnalogPdf, pdfJpeg, analogPdfName, cleanImages, cleanAnswer, cleanVideos, checkUrlOf, fmtCode, normCode, qrMatrix, WORLD_MAP };
