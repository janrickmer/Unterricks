// files.js – Dateiablage in R2: Material für Schüler:innen, Material nur für die Lehrkraft, Präsentation (PDF + Folienbilder).
// Downloads und Folienbilder laufen über kurzlebige signierte Links (funktionieren auch beim direkten Öffnen auf dem iPad).
import { HttpError, bad, json, readJson, randomId, cleanLine, cleanText, isId, requireSecret, signLink, checkLink, contentDisposition, INLINE_SAFE } from "./lib.js";
import { courseClassSize } from "./courses.js";
import { requireTeacher } from "./auth.js";
import { getLesson, fileOut, codeSlidesOf, LIMITS, printProps, cardVersion } from "./lessons.js";
import { normalizeCode, isValidCode, cleanWebUrl, slidesUpTo, printFileName, cleanCopies, isAnalogClass, cleanCodeSlides, GS_SUBJECT } from "../public/shared.js";
import { cleanDesignHtml, renderPdf, htmlText, keepImages, shortImages, HTML_MAX, RenderError, renderUsage, printerConfigured } from "./render.js";

export const MAX_FILE = 100 * 1024 * 1024;         // Grenze einer Anfrage im Cloudflare-Free-Plan
export const MAX_SLIDE = 4 * 1024 * 1024;
export const MAX_SLIDES = 300;
export const MAX_CARDS = 40;                       // Bildkarten (Grundschule): höchstens 40 Karten je PDF
const AREAS = new Set(["student", "teacher"]);
const EXT_MIME = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", heic: "image/heic", svg: "image/svg+xml",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  odt: "application/vnd.oasis.opendocument.text", odp: "application/vnd.oasis.opendocument.presentation", ods: "application/vnd.oasis.opendocument.spreadsheet",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", rtf: "application/rtf", zip: "application/zip", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "video/mp4", mov: "video/quicktime",
  key: "application/vnd.apple.keynote", pages: "application/vnd.apple.pages", numbers: "application/vnd.apple.numbers", goodnotes: "application/octet-stream", epub: "application/epub+zip",
};
export function mimeFor(name, given) {
  const g = String(given || "").split(";")[0].trim().toLowerCase();
  if (/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(g) && g !== "application/octet-stream") return g;
  const ext = (/\.([a-z0-9]+)$/i.exec(name || "") || [])[1];
  return (ext && EXT_MIME[ext.toLowerCase()]) || "application/octet-stream";
}
export const fileKey = (lessonId, fileId) => "l/" + lessonId + "/f/" + fileId;
export const cutKey = (lessonId, fileId) => fileKey(lessonId, fileId) + "-bis";   // Präsentation gekürzt bis zur letzten gezeigten Folie
export const slideKey = (lessonId, fileId, n) => "l/" + lessonId + "/p/" + fileId + "/" + n + ".img";

const storageLimit = (env) => Number(env.STORAGE_LIMIT_BYTES) || 9 * 1024 ** 3;   // unter den 10 GB des kostenlosen R2-Kontingents bleiben
export async function checkStorage(c, add) {
  const r = await c.db.prepare("SELECT (SELECT COALESCE(SUM(size),0) + COALESCE(SUM(cut_size),0) FROM files) + (SELECT COALESCE(SUM(size),0) FROM slides) + (SELECT COALESCE(SUM(pdf_size),0) FROM bases) AS used").first();
  const used = Number((r || {}).used) || 0, lim = storageLimit(c.env);
  if (used + add > lim) throw new HttpError(507, "storage_full", "Der Speicher ist voll (" + Math.round(used / 1024 ** 2) + " MB von " + Math.round(lim / 1024 ** 2) +
    " MB belegt). Bitte alte Dateien oder Sitzungen löschen – so bleibt die Ablage im kostenlosen Kontingent.");
}
export function uploadLength(c, max) {
  const len = Number(c.request.headers.get("content-length"));
  if (!Number.isFinite(len) || len <= 0) throw new HttpError(411, "length_required", "Die Dateigröße fehlt in der Anfrage.");
  if (len > max) throw new HttpError(413, "too_large", "Die Datei ist zu groß (höchstens " + Math.round(max / 1024 ** 2) + " MB).");
  return len;
}
export async function getFile(db, fileId) {
  if (!isId(fileId)) throw new HttpError(404, "not_found", "Datei nicht gefunden.");
  const f = await db.prepare("SELECT * FROM files WHERE id=?1").bind(fileId).first();
  if (!f) throw new HttpError(404, "not_found", "Datei nicht gefunden.");
  return f;
}
export async function deleteFileObjects(c, f) {
  const keys = [];
  if (f.kind === "file") keys.push(fileKey(f.lesson_id, f.id));
  if (f.area === "presentation" || f.cards != null) {   // Folienbilder bzw. Kartenbilder (Bildkarten der Grundschule)
    if (f.area === "presentation") keys.push(cutKey(f.lesson_id, f.id));
    const s = await c.db.prepare("SELECT n FROM slides WHERE file_id=?1").bind(f.id).all();
    for (const x of s.results || []) keys.push(slideKey(f.lesson_id, f.id, x.n));
  }
  for (let i = 0; i < keys.length; i += 1000) await c.env.FILES.delete(keys.slice(i, i + 1000));
  await c.db.batch([
    c.db.prepare("DELETE FROM slides WHERE file_id=?1").bind(f.id),
    c.db.prepare("DELETE FROM files WHERE id=?1").bind(f.id),
  ]);
}

/* Sitzung, zu der Material kommt – nie ein Ausfall-Eintrag (Krankmeldung in der Grundschule) */
export async function materialLesson(db, lessonId) {
  const l = await getLesson(db, lessonId);
  if (l.cancelled) throw bad("Für einen Ausfall-Eintrag gibt es kein Material.");
  return l;
}
/* ---------- Hochladen (Lehrkraft) ---------- */
export async function routeFileUpload(c, lessonId) {
  await requireTeacher(c);
  await materialLesson(c.db, lessonId);
  const u = new URL(c.request.url);
  const area = u.searchParams.get("area");
  if (!AREAS.has(area)) throw bad("Bitte den Bereich wählen (für Schüler:innen oder nur für die Lehrkraft).");
  const name = cleanLine(u.searchParams.get("name"), 200) || "Datei";
  const len = uploadLength(c, MAX_FILE);
  await checkStorage(c, len);
  const id = randomId(8), mime = mimeFor(name, c.request.headers.get("content-type"));
  await c.env.FILES.put(fileKey(lessonId, id), c.request.body, { httpMetadata: { contentType: mime } });
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, created_at, updated_at) VALUES(?1, ?2, ?3, 'file', ?4, ?5, ?6, 'ready', ?7, ?8, ?8)")
    .bind(id, lessonId, area, name, mime, len, cleanLine(u.searchParams.get("source"), 40) || "upload", c.now).run();
  return json({ ok: true, file: fileOut(await getFile(c.db, id)) });
}
/* ---------- Notfall-Feibeitsblatt (das analoge Arbeitsblatt eines verknüpften Feibeitsblatts) ----------
 * Der Browser der Lehrkraft erzeugt die PDF mit dem Code des Feibeitsblatts (public/fbanalog.js) und lädt sie hier hoch: Material für
 * Schüler:innen, zugeordnet über fb_code; eine neue PDF ersetzt die bisherige desselben Blattes (eine archivierte bleibt im Archiv). */
export const MAX_NOTFALL = 40 * 1024 * 1024;
export async function deleteNotfallFiles(c, lessonId, code, exceptId = "") {
  // mit exceptId (neue PDF): nur ältere löschen – laden zwei Browser gleichzeitig hoch (Sitzungsseite und Nachholen im Hintergrund),
  // bleibt so immer die zuletzt angelegte stehen (rowid wächst mit jedem Eintrag); sonst löschte jede Anfrage die der anderen
  const r = exceptId
    ? await c.db.prepare("SELECT * FROM files WHERE lesson_id=?1 AND fb_code=?2 AND id<>?3 AND area<>'archive' AND rowid < (SELECT rowid FROM files WHERE id=?3)").bind(lessonId, code, exceptId).all()
    : await c.db.prepare("SELECT * FROM files WHERE lesson_id=?1 AND fb_code=?2 AND area<>'archive'").bind(lessonId, code).all();
  for (const f of r.results || []) await deleteFileObjects(c, f);
  return (r.results || []).length;
}
/* Alle verknüpften Feibeitsblätter mit dem Stand ihres Notfall-Feibeitsblatts – zum Nachholen für bestehende Sitzungen (der Browser der
 * Lehrkraft erzeugt die fehlenden bzw. veralteten PDFs). Ohne Finale eines Escape-Rooms und ohne die analogen Jahrgänge 5 und 6. */
export async function routeNotfallList(c) {
  await requireTeacher(c);
  const r = await c.db.prepare("SELECT s.lesson_id, s.code, s.title, l.title AS lesson_title, l.subject, l.klass, l.lesson_date, " +
    "(SELECT f.id FROM files f WHERE f.lesson_id=s.lesson_id AND f.fb_code=s.code AND f.area<>'archive' ORDER BY f.rowid DESC LIMIT 1) AS file_id, " +
    "(SELECT f.fb_sig FROM files f WHERE f.lesson_id=s.lesson_id AND f.fb_code=s.code AND f.area<>'archive' ORDER BY f.rowid DESC LIMIT 1) AS file_sig " +
    "FROM fb_sheets s JOIN lessons l ON l.id = s.lesson_id WHERE s.kind<>'escape' AND l.subject<>'gs' ORDER BY COALESCE(l.lesson_date, '') DESC, s.created_at DESC LIMIT 3000").all();
  const items = (r.results || []).filter((x) => !isAnalogClass(x.klass)).map((x) => ({ lessonId: x.lesson_id, code: x.code, title: x.title, lessonTitle: x.lesson_title,
    subject: x.subject, klass: x.klass, date: x.lesson_date || null, fileId: x.file_id || null, sig: x.file_sig || null }));
  return json({ ok: true, items });
}
export async function routeNotfallUpload(c, lessonId, codeRaw) {
  await requireTeacher(c);
  await getLesson(c.db, lessonId);
  let raw = codeRaw; try { raw = decodeURIComponent(codeRaw); } catch {}
  const code = normalizeCode(raw);
  const sh = isValidCode(code) ? await c.db.prepare("SELECT code, title, kind FROM fb_sheets WHERE lesson_id=?1 AND code=?2").bind(lessonId, code).first() : null;
  if (!sh) throw new HttpError(404, "not_found", "Dieses Feibeitsblatt ist mit der Sitzung nicht verknüpft.");
  if (sh.kind === "escape") throw bad("Zum Finale eines Escape-Rooms gibt es kein Notfall-Feibeitsblatt.");
  if (String(c.request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/pdf") throw bad("Das Notfall-Feibeitsblatt muss eine PDF-Datei sein.");
  const len = uploadLength(c, MAX_NOTFALL);
  await checkStorage(c, len);
  const sig = cleanLine(new URL(c.request.url).searchParams.get("sig"), 60);
  const id = randomId(8), name = cleanLine("Notfall-Feibeitsblatt – " + (sh.title || "Feibeitsblatt"), 190) + ".pdf";
  // hat die Lehrkraft das bisherige „nur für Lehrkräfte“ gestellt, bleibt auch das erneuerte dort (sonst für Schüler:innen)
  const prev = await c.db.prepare("SELECT area FROM files WHERE lesson_id=?1 AND fb_code=?2 AND area<>'archive' ORDER BY rowid DESC LIMIT 1").bind(lessonId, code).first();
  const area = prev && prev.area === "teacher" ? "teacher" : "student";
  await c.env.FILES.put(fileKey(lessonId, id), c.request.body, { httpMetadata: { contentType: "application/pdf" } });
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, fb_code, fb_sig, created_at, updated_at) " +
    "VALUES(?1, ?2, ?8, 'file', ?3, 'application/pdf', ?4, 'ready', 'notfall', ?5, ?6, ?7, ?7)").bind(id, lessonId, name, len, code, sig, c.now, area).run();
  // während des Hochladens entfernt? Dann gehört die PDF nicht mehr zur Sitzung (sonst stünde sie verwaist im Kästchen der Schüler:innen).
  // Das Entfernen löscht erst die Verknüpfung, dann die PDFs – so sieht entweder diese Prüfung die fehlende Verknüpfung oder das Entfernen die neue PDF.
  if (!(await c.db.prepare("SELECT 1 AS x FROM fb_sheets WHERE lesson_id=?1 AND code=?2").bind(lessonId, code).first())) {
    await c.env.FILES.delete(fileKey(lessonId, id));
    await c.db.prepare("DELETE FROM files WHERE id=?1").bind(id).run();
    throw new HttpError(404, "not_found", "Dieses Feibeitsblatt ist mit der Sitzung nicht mehr verknüpft.");
  }
  const replaced = await deleteNotfallFiles(c, lessonId, code, id);
  // kam gleichzeitig eine neuere PDF desselben Blattes an (zweites Gerät), hat sie diese ersetzt: dann gilt die neuere
  const own = await c.db.prepare("SELECT * FROM files WHERE id=?1").bind(id).first();
  if (own) return json({ ok: true, file: fileOut(own), replaced });
  const newest = await c.db.prepare("SELECT * FROM files WHERE lesson_id=?1 AND fb_code=?2 AND area<>'archive' ORDER BY rowid DESC LIMIT 1").bind(lessonId, code).first();
  if (!newest) throw new HttpError(404, "not_found", "Dieses Feibeitsblatt ist mit der Sitzung nicht mehr verknüpft.");
  return json({ ok: true, file: fileOut(newest), replaced, superseded: true });
}
export async function insertTextMaterial(db, lessonId, area, title, text, source, now) {
  if (!AREAS.has(area)) throw bad("Bitte den Bereich wählen (für Schüler:innen oder nur für die Lehrkraft).");
  const t = cleanText(text, LIMITS.textMaterial).trim();
  if (!t) throw bad("Das Material ist leer.");
  const id = randomId(8), name = cleanLine(title, 200) || "Material";
  await db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, text, status, source, created_at, updated_at) VALUES(?1, ?2, ?3, 'text', ?4, 'text/markdown', ?5, ?6, 'ready', ?7, ?8, ?8)")
    .bind(id, lessonId, area, name, new TextEncoder().encode(t).length, t, source, now).run();
  return getFile(db, id);
}
/* ---------- Druckliste „Von der Lehrkraft auszudrucken“ (area = 'print'): nur PDF in A4 (der Browser rechnet andere Formate vorher um) ----------
 * Name beim Herunterladen „28x - beidseitig - sw - Name.pdf“; ohne Angabe gilt die Schülerzahl laut Kurseinstellungen, sonst die zuletzt verwendete
 * Anzahl dieser Klasse (sonst 1), beidseitig, schwarz-weiß. */
async function lastCopies(db, lessonId) {
  const r = await db.prepare("SELECT f.print_copies AS n FROM files f JOIN lessons l ON l.id = f.lesson_id WHERE f.area='print' AND f.print_copies IS NOT NULL " +
    "AND l.klass = (SELECT klass FROM lessons WHERE id=?1) ORDER BY f.created_at DESC LIMIT 1").bind(lessonId).first();
  return (r && r.n) || 1;
}
// Standard: Schülerzahl laut Kurseinstellungen, sonst die zuletzt verwendete Anzahl dieser Klasse
const defaultCopies = async (db, lessonId) => (await courseClassSize(db, lessonId)) || (await lastCopies(db, lessonId));
const boolParam = (v, dflt) => (v === "1" || v === "true" ? 1 : v === "0" || v === "false" ? 0 : dflt);
export async function routePrintUpload(c, lessonId) {
  await requireTeacher(c);
  await materialLesson(c.db, lessonId);
  const u = new URL(c.request.url), name = cleanLine(u.searchParams.get("name"), 200) || "Druckvorlage.pdf";
  if (mimeFor(name, c.request.headers.get("content-type")) !== "application/pdf") throw bad("Zum Ausdrucken sind nur PDF-Dateien erlaubt.");
  const len = uploadLength(c, MAX_FILE);
  await checkStorage(c, len);
  const id = randomId(8), key = fileKey(lessonId, id);
  await c.env.FILES.put(key, c.request.body, { httpMetadata: { contentType: "application/pdf" } });
  // wirklich eine PDF? (die ersten Bytes) – sonst gleich wieder weg
  const head = await c.env.FILES.get(key, { range: { offset: 0, length: 5 } });
  if (!head || (await head.text()) !== "%PDF-") { await c.env.FILES.delete(key); throw bad("Diese Datei ist keine PDF-Datei. Zum Ausdrucken sind nur PDF-Dateien erlaubt."); }
  const copies = cleanCopies(u.searchParams.get("copies")) || (await defaultCopies(c.db, lessonId));
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, print_copies, print_duplex, print_color, created_at, updated_at) " +
    "VALUES(?1, ?2, 'print', 'file', ?3, 'application/pdf', ?4, 'ready', ?5, ?6, ?7, ?8, ?9, ?9)")
    .bind(id, lessonId, name, len, cleanLine(u.searchParams.get("source"), 40) || "upload", copies, boolParam(u.searchParams.get("duplex"), 1), boolParam(u.searchParams.get("color"), 0), c.now).run();
  return json({ ok: true, file: fileOut(await getFile(c.db, id)) });
}
/* Druckvorlage als Text (Markdown; z. B. von Claude über den Connector) – der Browser erzeugt daraus die A4-PDF */
export async function insertPrintText(db, lessonId, title, text, p, source, now) {
  const t = cleanText(text, LIMITS.textMaterial).trim();
  if (!t) throw bad("Die Druckvorlage ist leer.");
  const id = randomId(8), name = cleanLine(title, 200) || "Druckvorlage";
  const copies = cleanCopies(p.copies) || (await defaultCopies(db, lessonId));
  await db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, text, status, source, print_copies, print_duplex, print_color, created_at, updated_at) " +
    "VALUES(?1, ?2, 'print', 'text', ?3, 'text/markdown', ?4, ?5, 'ready', ?6, ?7, ?8, ?9, ?10, ?10)")
    .bind(id, lessonId, name, new TextEncoder().encode(t).length, t, source, copies, p.duplex === false ? 0 : 1, p.color === true ? 1 : 0, now).run();
  return getFile(db, id);
}

/* ---------- Von Claude gestaltetes Material (HTML → PDF, render.js; Wunsch der Lehrkraft vom 11.11.2026) ----------
 * Eine normale PDF-Datei (kind 'file', PDF in R2) mit Claudes Gestaltung in html: status 'pending', bis sie zum ersten Mal gedruckt ist
 * (Schüler:innen sehen sie erst dann); html_at/pdf_at zeigen, ob die PDF zur aktuellen Gestaltung passt (eine geänderte Gestaltung
 * druckt Unterricks neu, bis dahin bleibt die bisherige PDF sichtbar). text = Klartext für die KI-Hilfe im Planungschat. */
export const DESIGN_AREAS = new Set(["student", "teacher", "print"]);
const pdfFileName = (t) => (cleanLine(t, 190).replace(/\.pdf$/i, "").trim() || "Material") + ".pdf";
export const designOutdated = (f) => !!f.html && (!f.pdf_at || (f.html_at || 0) > f.pdf_at);
export function designHtml(raw) {
  const html = cleanDesignHtml(raw);
  if (new TextEncoder().encode(html).length > HTML_MAX) throw bad("Das Material ist zu groß (höchstens 1,5 MB HTML). Bitte Grafiken als SVG statt als eingebettete Fotos anlegen oder das Material aufteilen.");
  // Platzhalter aus get_material gelten nur beim Überarbeiten desselben Materials (file_id) – sonst stünde ein kaputtes Bild in der PDF
  if (html.includes("data:unterricks-bild,")) throw bad("Die Gestaltung enthält Bild-Platzhalter („data:unterricks-bild,n“) aus get_material. Die gelten nur beim Überarbeiten desselben Materials mit seiner file_id – sonst die Bilder bitte wieder vollständig einbetten.");
  return html;
}
/* neu anlegen (fileId fehlt) oder die Gestaltung eines vorhandenen Materials dieser Sitzung ersetzen */
/* gsPrint: Grundschule – ein Arbeitsblatt der Kinder (area student) mit Anzahl steht zusätzlich auf der Druckliste */
/* cards: Bildkarten der Grundschule ({v, texts, share, rev}, nur über cards.js saveCardSet) – zwischen Bildkarten und anderem Material wird nie gewechselt */
export async function saveDesign(c, lessonId, { area, title, html, print = {}, source = "claude", fileId = null, gsPrint = false, cards = null }) {
  if (fileId) {
    const f = await getFile(c.db, fileId);
    if (f.lesson_id !== lessonId || f.html == null) throw bad("file_id gehört zu keinem gestalteten Material dieser Sitzung (siehe get_lesson).");
    if ((f.cards != null) !== !!cards) throw bad(f.cards != null ? "Diese file_id gehört zu Bildkarten – ändere sie mit add_picture_cards." : "Diese file_id gehört zu keinen Bildkarten – ein Material lässt sich nicht in Bildkarten umwandeln (bitte neu anlegen).");
    if (f.area === "archive") throw bad("Dieses Material gehört zur archivierten Planung (Krankheitsvertretung) und lässt sich nicht mehr ändern.");
    if (area && area !== f.area && (area === "print" || f.area === "print")) throw bad("Ein Material lässt sich nicht zwischen Druckliste und Material der Sitzung verschieben – bitte neu anlegen.");
    const h = designHtml(keepImages(html, f.html)), at = Math.max(c.now, (f.pdf_at || 0) + 1, (f.html_at || 0) + 1);
    const sets = ["html=?2", "html_at=?3", "text=?4", "render_error=NULL", "updated_at=?5"], args = [fileId, h, at, htmlText(h), c.now];
    if (title) { args.push(pdfFileName(title)); sets.push("name=?" + args.length); }
    if (cards) { args.push(JSON.stringify(cards)); sets.push("cards=?" + args.length); area = ""; }
    if (area && area !== f.area) {
      args.push(area); sets.push("area=?" + args.length);
      // für Schüler:innen erst mit der neuen PDF (die bisherige war nur für die Lehrkraft gedacht)
      if (area === "student") sets.push("status='pending'");
    }
    if (f.area === "print" || (gsPrint && (area || f.area) === "student" && (cleanCopies(print.copies) || f.print_copies != null))) {
      const n = cleanCopies(print.copies); if (n) { args.push(n); sets.push("print_copies=?" + args.length); }
      if (typeof print.duplex === "boolean") { args.push(print.duplex ? 1 : 0); sets.push("print_duplex=?" + args.length); }
      if (typeof print.color === "boolean") { args.push(print.color ? 1 : 0); sets.push("print_color=?" + args.length); }
    }
    await c.db.prepare("UPDATE files SET " + sets.join(", ") + " WHERE id=?1").bind(...args).run();
    return getFile(c.db, fileId);
  }
  if (!DESIGN_AREAS.has(area)) throw bad("Bitte den Bereich wählen: für Schüler:innen, nur für die Lehrkraft oder zum Ausdrucken.");
  const h = designHtml(html), id = randomId(8);
  const copies = area === "print" ? cleanCopies(print.copies) || (await defaultCopies(c.db, lessonId)) : gsPrint && area === "student" ? cleanCopies(print.copies) : null;
  const printed = area === "print" || !!copies;
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, text, status, source, html, html_at, print_copies, print_duplex, print_color, cards, created_at, updated_at) " +
    "VALUES(?1, ?2, ?3, 'file', ?4, 'application/pdf', 0, ?5, 'pending', ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?8, ?8)")
    .bind(id, lessonId, area, pdfFileName(title), htmlText(h), source, h, c.now, copies, printed ? (print.duplex === false ? 0 : 1) : null, printed ? (print.color === true ? 1 : 0) : null, cards ? JSON.stringify(cards) : null).run();
  return getFile(c.db, id);
}
/* Gestaltung drucken (PDF in R2) – Ergebnis die aktuelle Zeile; Fehler des Druckers bleiben in render_error stehen und werden geworfen */
export async function renderDesign(c, fileOrId, { waitMs = 25000 } = {}) {
  const f = typeof fileOrId === "string" ? await getFile(c.db, fileOrId) : fileOrId;
  if (f.html == null) throw bad("Diese Datei ist kein gestaltetes Material.");
  const at = f.html_at || 0;
  let out;
  try { out = await renderPdf(c, f.html, { waitMs }); }
  catch (e) {
    // gemerkt werden nur Ablehnungen des Druckers, bei denen ein neuer Versuch mit derselben Gestaltung nichts ändert – alles andere
    // (ausgelastet, Tageskontingent, nicht eingerichtet, Fehler unterwegs) druckt die Sitzungsseite später selbst nach
    if (e instanceof RenderError && e.renderCode === "failed") {
      try { await c.db.prepare("UPDATE files SET render_error=?2 WHERE id=?1 AND COALESCE(html_at,0)=?3").bind(f.id, e.message, at).run(); } catch {}
    }
    throw e instanceof HttpError ? e : new RenderError("busy", "Der PDF-Druck ist gerade fehlgeschlagen – Unterricks versucht es erneut.", 20);
  }
  await checkStorage(c, Math.max(0, out.bytes.length - (f.size || 0)));
  // inzwischen neu gestaltet oder schon von einem anderen Auftrag gedruckt? Dann diese (ältere) PDF nicht über die neuere legen
  const now = await c.db.prepare("SELECT html_at, pdf_at FROM files WHERE id=?1").bind(f.id).first();
  if (!now) throw new HttpError(404, "not_found", "Das Material wurde inzwischen gelöscht.");
  if ((now.html_at || 0) !== at || (now.pdf_at || 0) >= at) {
    const cur = await c.db.prepare("SELECT * FROM files WHERE id=?1").bind(f.id).first();
    return { file: cur, pages: cur.pages || out.pages, bytes: cur.size || out.bytes.length, current: (now.html_at || 0) === at };
  }
  const key = fileKey(f.lesson_id, f.id);
  await c.env.FILES.put(key, out.bytes, { httpMetadata: { contentType: "application/pdf" } });
  const done = await c.db.prepare("UPDATE files SET status='ready', size=?2, pages=?3, pdf_at=?4, render_error=NULL, updated_at=?5 WHERE id=?1 AND COALESCE(html_at,0)=?4")
    .bind(f.id, out.bytes.length, out.pages || null, at, Date.now()).run();
  const cur = await c.db.prepare("SELECT * FROM files WHERE id=?1").bind(f.id).first();
  if (!cur) { await c.env.FILES.delete(key); throw new HttpError(404, "not_found", "Das Material wurde inzwischen gelöscht."); }
  return { file: cur, pages: out.pages, bytes: out.bytes.length, current: !!(done.meta && done.meta.changes) };
}
/* Lehrkraft: (erneut) drucken – Sitzungsseite und Druckliste rufen das für ausstehende Materialien selbst auf */
export async function routeFileRender(c, fileId) {
  await requireTeacher(c);
  const f = await getFile(c.db, fileId);
  if (f.html == null) throw bad("Diese Datei ist kein gestaltetes Material.");
  const body = await readJson(c.request, 2000).catch(() => ({}));
  if (!designOutdated(f) && f.status === "ready" && !(body && body.force)) return json({ ok: true, file: fileOut(f), rendered: false });
  const r = await renderDesign(c, f, { waitMs: 25000 });
  return json({ ok: true, file: fileOut(r.file), rendered: true });
}

/* Lehrkraft: gestaltetes Material ohne PDF anlegen (Laden einer gesicherten Sitzung, deren PDF noch nicht gedruckt war) – druckt die Sitzungsseite */
export async function routeDesignCreate(c, lessonId) {
  await requireTeacher(c);
  await materialLesson(c.db, lessonId);
  const body = await readJson(c.request, 3_200_000);
  const f = await saveDesign(c, lessonId, { area: body.area, title: body.title, html: body.html, print: body.print && typeof body.print === "object" ? body.print : {}, source: cleanLine(body.source, 40) || "uebernommen" });
  return json({ ok: true, file: fileOut(f) });
}
/* Verbrauch des Druckers heute und Materialien, die noch (neu) gedruckt werden müssen – die Startseite der Lehrkraft druckt sie nach,
   auch wenn ihre Sitzung gerade niemand geöffnet hat (z. B. Vertretungsmaterial nach dem Bestätigen, Material von Claude bei vollem Drucker) */
export async function routeRenderUsage(c) {
  await requireTeacher(c);
  const r = await c.db.prepare("SELECT id, lesson_id, name, area, status, html_at, pdf_at FROM files WHERE html IS NOT NULL AND area<>'archive' AND render_error IS NULL " +
    "AND (pdf_at IS NULL OR COALESCE(html_at,0) > pdf_at) ORDER BY updated_at LIMIT 40").all();
  const pending = (r.results || []).map((f) => ({ id: f.id, lessonId: f.lesson_id, name: f.name, area: f.area, status: f.status, design: { outdated: true, error: null, htmlAt: f.html_at || null, pdfAt: f.pdf_at || null } }));
  return json({ ok: true, usage: await renderUsage(c.db, c.now), configured: printerConfigured(c.env), pending });
}
/* Claudes Gestaltung lesen (Sicherung der Sitzung; mit short=1 eingebettete Bilder als Platzhalter) */
export async function routeFileHtml(c, fileId) {
  await requireTeacher(c);
  const f = await getFile(c.db, fileId);
  if (f.html == null) throw new HttpError(404, "not_found", "Diese Datei ist kein gestaltetes Material.");
  const short = new URL(c.request.url).searchParams.get("short") === "1";
  return json({ ok: true, html: short ? shortImages(f.html) : f.html, htmlAt: f.html_at || null, pdfAt: f.pdf_at || null });
}

/* ---------- Links zu Internetseiten als Material (kind = 'link': Titel in name, Adresse in text) ---------- */
export async function insertLink(db, lessonId, area, title, url, source, now) {
  if (!AREAS.has(area)) throw bad("Bitte den Bereich wählen (für Schüler:innen oder nur für die Lehrkraft).");
  const href = cleanWebUrl(url);
  if (!href) throw bad("Bitte eine gültige Internetadresse eingeben (beginnend mit https://).");
  const id = randomId(8), name = cleanLine(title, 200) || new URL(href).hostname;
  await db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, text, status, source, created_at, updated_at) VALUES(?1, ?2, ?3, 'link', ?4, 'text/uri-list', 0, ?5, 'ready', ?6, ?7, ?7)")
    .bind(id, lessonId, area, name, href, source, now).run();
  return getFile(db, id);
}
export async function routeLinkCreate(c, lessonId) {
  await requireTeacher(c);
  await materialLesson(c.db, lessonId);
  const body = await readJson(c.request, 10000);
  return json({ ok: true, file: fileOut(await insertLink(c.db, lessonId, body.area, body.title, body.url, cleanLine(body.source, 40) || "lehrkraft", c.now)) });
}
export async function routeTextCreate(c, lessonId) {
  await requireTeacher(c);
  await materialLesson(c.db, lessonId);
  const body = await readJson(c.request, 600000);
  const f = await insertTextMaterial(c.db, lessonId, body.area, body.title, body.text, cleanLine(body.source, 40) || "chat", c.now);
  return json({ ok: true, file: fileOut(f) });
}
export async function routeFilePatch(c, fileId) {
  await requireTeacher(c);
  const f = await getFile(c.db, fileId);
  const body = await readJson(c.request, 3_200_000);
  const sets = [], args = [];
  if (body.area !== undefined) {
    if (f.area === "presentation" || f.area === "print" || f.cards != null || !AREAS.has(body.area)) throw bad("Ungültiger Bereich.");
    args.push(body.area); sets.push("area=?" + (args.length + 1));
  }
  if (body.name !== undefined) { const n = cleanLine(body.name, 200); if (!n) throw bad("Der Name darf nicht leer sein."); args.push(n); sets.push("name=?" + (args.length + 1)); }
  if (body.copies !== undefined || body.duplex !== undefined || body.color !== undefined) {
    // Grundschule: PDFs der Kinder stehen mit einer Anzahl zusätzlich auf der Druckliste (copies: null nimmt sie wieder herunter)
    const gsStudent = f.area === "student" && f.kind === "file" && f.mime === "application/pdf" && (await c.db.prepare("SELECT subject FROM lessons WHERE id=?1").bind(f.lesson_id).first() || {}).subject === GS_SUBJECT;
    if (f.area !== "print" && !gsStudent) throw bad("Anzahl, beidseitig und Farbe gibt es nur bei Dateien zum Ausdrucken.");
    if (gsStudent && body.copies === null) sets.push("print_copies=NULL", "print_duplex=NULL", "print_color=NULL");
    else {
      if (body.copies !== undefined) { const n = cleanCopies(body.copies); if (!n) throw bad("Bitte eine Anzahl zwischen 1 und 500 angeben."); args.push(n); sets.push("print_copies=?" + (args.length + 1)); }
      if (gsStudent && body.copies === undefined && f.print_copies == null) throw bad("Bitte zuerst die Anzahl der Ausdrucke angeben.");
      if (body.duplex !== undefined) { args.push(body.duplex ? 1 : 0); sets.push("print_duplex=?" + (args.length + 1)); }
      if (body.color !== undefined) { args.push(body.color ? 1 : 0); sets.push("print_color=?" + (args.length + 1)); }
    }
  }
  if (body.url !== undefined) {
    if (f.kind !== "link") throw bad("Nur bei Links lässt sich die Adresse ändern.");
    const href = cleanWebUrl(body.url); if (!href) throw bad("Bitte eine gültige Internetadresse eingeben (beginnend mit https://).");
    args.push(href); sets.push("text=?" + (args.length + 1));
  }
  if (body.text !== undefined) {
    if (f.kind !== "text") throw bad("Nur Text-Material lässt sich bearbeiten.");
    const t = cleanText(body.text, LIMITS.textMaterial).trim(); if (!t) throw bad("Das Material ist leer.");
    args.push(t); sets.push("text=?" + (args.length + 1)); args.push(new TextEncoder().encode(t).length); sets.push("size=?" + (args.length + 1));
  }
  // Claudes Gestaltung anhängen bzw. ersetzen (z. B. beim Laden einer gesicherten Sitzung: rendered = die hochgeladene PDF ist schon ihr Druck)
  if (body.html !== undefined) {
    if (f.kind !== "file" || f.mime !== "application/pdf" || f.area === "presentation" || f.area === "archive" || (f.cards != null && f.html == null)) throw bad("Eine Gestaltung gibt es nur bei PDF-Material der Sitzung.");
    const hh = designHtml(keepImages(body.html, f.html)), at = Math.max(c.now, (f.pdf_at || 0) + 1, (f.html_at || 0) + 1);
    args.push(hh); sets.push("html=?" + (args.length + 1)); args.push(htmlText(hh)); sets.push("text=?" + (args.length + 1));
    args.push(at); sets.push("html_at=?" + (args.length + 1)); sets.push("render_error=NULL");
    if (body.rendered === true && f.status === "ready") { args.push(at); sets.push("pdf_at=?" + (args.length + 1)); }
  }
  if (!sets.length) return json({ ok: true, file: fileOut(f) });
  args.push(c.now); sets.push("updated_at=?" + (args.length + 1));
  await c.db.prepare("UPDATE files SET " + sets.join(", ") + " WHERE id=?1").bind(fileId, ...args).run();
  return json({ ok: true, file: fileOut(await getFile(c.db, fileId)) });
}
export async function routeFileDelete(c, fileId) {
  await requireTeacher(c);
  const f = await getFile(c.db, fileId);
  await deleteFileObjects(c, f);
  if (f.area === "presentation") await stopLive(c, f.lesson_id);
  return json({ ok: true });
}
async function stopLive(c, lessonId) {
  try { await c.env.LIVE.get(c.env.LIVE.idFromName(lessonId)).fetch("https://live/reset", { method: "POST" }); } catch {}
}

/* ---------- Präsentation (nur PDF; die Folienbilder rendert der Browser der Lehrkraft mit PDF.js) ---------- */
export async function routePresentationUpload(c, lessonId) {
  await requireTeacher(c);
  await materialLesson(c.db, lessonId);
  const u = new URL(c.request.url);
  const name = cleanLine(u.searchParams.get("name"), 200) || "Präsentation.pdf";
  const mime = mimeFor(name, c.request.headers.get("content-type"));
  if (mime !== "application/pdf") throw bad("Bitte die Präsentation als PDF-Datei hochladen (in PowerPoint: Datei → Speichern unter → PDF).");
  const len = uploadLength(c, MAX_FILE);
  await checkStorage(c, len);
  const old = await c.db.prepare("SELECT * FROM files WHERE lesson_id=?1 AND area='presentation'").bind(lessonId).all();
  for (const f of old.results || []) await deleteFileObjects(c, f);
  if ((old.results || []).length) await stopLive(c, lessonId);
  const id = randomId(8);
  await c.env.FILES.put(fileKey(lessonId, id), c.request.body, { httpMetadata: { contentType: "application/pdf" } });
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, created_at, updated_at) VALUES(?1, ?2, 'presentation', 'file', ?3, 'application/pdf', ?4, 'processing', 'upload', ?5, ?5)")
    .bind(id, lessonId, name, len, c.now).run();
  return json({ ok: true, file: fileOut(await getFile(c.db, id)) });
}
export async function routeSlideUpload(c, fileId, nRaw) {
  await requireTeacher(c);
  // nur die nötigen Spalten (gestaltete Bildkarten tragen bis 1,6 MB HTML – je Kartenbild gelesen kostete das CPU)
  if (!isId(fileId)) throw new HttpError(404, "not_found", "Datei nicht gefunden.");
  const f = await c.db.prepare("SELECT id, lesson_id, area, cards, pdf_at, created_at FROM files WHERE id=?1").bind(fileId).first();
  if (!f) throw new HttpError(404, "not_found", "Datei nicht gefunden.");
  const n = Number(nRaw), cards = f.cards != null;   // auch Kartenbilder der Bildkarten (Grundschule)
  if (f.area !== "presentation" && !cards) throw bad("Keine Präsentation.");
  if (cards && (!Number.isInteger(n) || n < 1 || n > MAX_CARDS)) throw bad("Ungültige Kartennummer (höchstens " + MAX_CARDS + " Bildkarten).");
  // Bilder einer älteren Fassung der Bildkarten (anderer Tab, inzwischen neu gestaltet) überschreiben nie die der neueren
  const v = new URL(c.request.url).searchParams.get("v");
  if (cards && v != null && Number(v) !== cardVersion(f)) throw new HttpError(409, "stale", "Die Bildkarten wurden inzwischen neu gestaltet – die Bilder werden neu erstellt.");
  if (!Number.isInteger(n) || n < 1 || n > MAX_SLIDES) throw bad("Ungültige Foliennummer (höchstens " + MAX_SLIDES + " Folien).");
  const len = uploadLength(c, MAX_SLIDE);
  const type = String(c.request.headers.get("content-type") || "").toLowerCase();
  if (!/^image\/(jpeg|webp|png)$/.test(type)) throw bad("Folienbilder müssen JPEG, WebP oder PNG sein.");
  await checkStorage(c, len);
  const u = new URL(c.request.url);
  await c.env.FILES.put(slideKey(f.lesson_id, f.id, n), c.request.body, { httpMetadata: { contentType: type } });
  await c.db.prepare("INSERT INTO slides(file_id, n, size, w, h) VALUES(?1, ?2, ?3, ?4, ?5) ON CONFLICT(file_id, n) DO UPDATE SET size=excluded.size, w=excluded.w, h=excluded.h")
    .bind(f.id, n, len, Number(u.searchParams.get("w")) || null, Number(u.searchParams.get("h")) || null).run();
  return json({ ok: true });
}
export async function routePresentationReady(c, fileId) {
  await requireTeacher(c);
  const f = await getFile(c.db, fileId);
  const body = await readJson(c.request, 64000);   // samt Platzhalterfolien (≤ 60 × 3 Zeilen × 160 Zeichen)
  const pages = Number(body.pages);
  if (f.area !== "presentation" || !Number.isInteger(pages) || pages < 1 || pages > MAX_SLIDES) throw bad("Ungültige Folienzahl.");
  const r = await c.db.prepare("SELECT COUNT(*) AS n FROM slides WHERE file_id=?1 AND n BETWEEN 1 AND ?2").bind(f.id, pages).first();
  if (((r || {}).n || 0) !== pages) throw bad("Es fehlen noch Folienbilder (" + ((r || {}).n || 0) + " von " + pages + "). Bitte erneut hochladen.");
  const cs = cleanCodeSlides(body.codeSlides, pages);   // Platzhalterfolien für die Codefolie (erkannt im Browser)
  await c.db.prepare("UPDATE files SET pages=?2, status='ready', code_slides=?4, updated_at=?3 WHERE id=?1").bind(f.id, pages, c.now, cs.length ? JSON.stringify(cs) : null).run();
  return json({ ok: true, file: fileOut(await getFile(c.db, f.id)) });
}
/* Letzte im Unterricht gezeigte Folie: Schüler:innen bekommen nach der Freigabe nur Folie 1 bis hier. Die gekürzte PDF erzeugt der Browser
   der Lehrkraft (pdf-lib, public/pdfcut.js) und lädt sie hier hoch (?until=N); DELETE hebt die Markierung auf. */
export async function routeShownPut(c, fileId) {
  await requireTeacher(c);
  const f = await getFile(c.db, fileId), n = Number(new URL(c.request.url).searchParams.get("until"));
  if (f.area !== "presentation" || f.status !== "ready") throw bad("Die Präsentation ist noch nicht bereit.");
  if (!Number.isInteger(n) || n < 1 || n >= f.pages) throw bad("Bitte eine Folie zwischen 1 und " + Math.max(1, f.pages - 1) + " wählen (bei der letzten Folie sehen Schüler:innen ohnehin alles).");
  if (String(c.request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() !== "application/pdf") throw bad("Die gekürzte Präsentation muss eine PDF-Datei sein.");
  const len = uploadLength(c, MAX_FILE);
  await checkStorage(c, Math.max(0, len - (f.cut_size || 0)));
  await c.env.FILES.put(cutKey(f.lesson_id, f.id), c.request.body, { httpMetadata: { contentType: "application/pdf" } });
  await c.db.prepare("UPDATE files SET shown_until=?2, cut_size=?3, updated_at=?4 WHERE id=?1").bind(f.id, n, len, c.now).run();
  return json({ ok: true, file: fileOut(await getFile(c.db, f.id)) });
}
export async function routeShownDelete(c, fileId) {
  await requireTeacher(c);
  const f = await getFile(c.db, fileId);
  if (f.area !== "presentation") throw bad("Keine Präsentation.");
  await c.env.FILES.delete(cutKey(f.lesson_id, f.id));
  await c.db.prepare("UPDATE files SET shown_until=NULL, cut_size=NULL, updated_at=?2 WHERE id=?1").bind(f.id, c.now).run();
  return json({ ok: true, file: fileOut(await getFile(c.db, f.id)) });
}
export async function routeTeacherSlides(c, fileId) {
  await requireTeacher(c);
  const f = await getFile(c.db, fileId);
  if (f.area !== "presentation" || f.status !== "ready") throw bad("Die Präsentation ist noch nicht bereit.");
  const secret = requireSecret(c.env), urls = [];
  for (let n = 1; n <= f.pages; n++) urls.push(await slideUrl(secret, f.id, n, 12 * 3600e3, c.now));
  return json({ ok: true, pages: f.pages, urls, codeSlides: codeSlidesOf(f) });
}
export async function slideUrl(secret, fileId, n, ttl, now = Date.now()) {
  const { e, s } = await signLink(secret, ["slide", fileId, n], ttl, now);
  return "/api/slide/" + fileId + "/" + n + "?e=" + e + "&s=" + encodeURIComponent(s);
}
/* Folienfenster der Schüler:innen nach der Sitzung (Nachtrag 19): eigene Signatur (p=st), damit routeSlide beim Ausliefern noch einmal gegen
   die markierte letzte gezeigte Folie prüft – ein gültiger Link jenseits einer inzwischen zurückgesetzten Markierung liefert nichts.
   Ablauf auf Viertelstunden gerundet (15–30 Minuten): wer dieselben Folien erneut anfragt, bekommt dieselben Adressen (Browser-Cache). */
export const STUDENT_SLIDE_WINDOW_MS = 15 * 60e3;
export const studentSlideExp = (now) => (Math.floor(now / STUDENT_SLIDE_WINDOW_MS) + 2) * STUDENT_SLIDE_WINDOW_MS;
export async function studentSlideUrl(secret, fileId, n, exp, now = Date.now()) {
  const { e, s } = await signLink(secret, ["slide", fileId, n, "st"], exp - now, now);
  return "/api/slide/" + fileId + "/" + n + "?p=st&e=" + e + "&s=" + encodeURIComponent(s);
}
// so weit dürfen Schüler:innen nach der Freigabe (bei markierter letzter gezeigter Folie nur bis dorthin – wie die heruntergeladene PDF)
export const studentSlideLimit = (f) => (f.shown_until && f.shown_until < f.pages ? f.shown_until : f.pages);
export async function downloadUrl(secret, f, inline, ttl = 10 * 60e3, now = Date.now(), cut = false) {
  const disp = inline && INLINE_SAFE.test(f.mime) ? "i" : "a";
  const { e, s } = await signLink(secret, cut ? ["dl", f.id, disp, "cut"] : ["dl", f.id, disp], ttl, now);
  return "/api/dl/" + f.id + "?d=" + disp + (cut ? "&p=cut" : "") + "&e=" + e + "&s=" + encodeURIComponent(s);
}
// Name der gekürzten Präsentation: „BVerfG (Folie 1–12).pdf“
export const cutName = (f) => String(f.name || "Präsentation.pdf").replace(/\.pdf$/i, "") + " (" + slidesUpTo(f.shown_until) + ").pdf";
export async function routeTeacherFileLink(c, fileId) {
  await requireTeacher(c);
  const f = await getFile(c.db, fileId);
  if (f.kind !== "file") throw bad(f.kind === "link" ? "Ein Link wird direkt geöffnet." : "Text-Material wird im Browser als PDF erzeugt.");
  const body = await readJson(c.request, 1000);
  return json({ ok: true, url: await downloadUrl(requireSecret(c.env), f, !!body.inline, 10 * 60e3, c.now) });
}

/* ---------- Ausliefern (signierte Links, ohne Anmeldung im Kopf der Anfrage) ---------- */
export async function routeDownload(c, fileId) {
  const u = new URL(c.request.url), d = u.searchParams.get("d") === "i" ? "i" : "a", cut = u.searchParams.get("p") === "cut";
  if (!(await checkLink(requireSecret(c.env), cut ? ["dl", fileId, d, "cut"] : ["dl", fileId, d], u.searchParams.get("e"), u.searchParams.get("s"), c.now)))
    throw new HttpError(403, "link_expired", "Der Link ist abgelaufen. Bitte noch einmal auf „Herunterladen“ tippen.");
  const f = await getFile(c.db, fileId);
  if (cut && !(f.area === "presentation" && f.shown_until && f.cut_size)) throw new HttpError(404, "not_found", "Die gekürzte Präsentation gibt es nicht (mehr).");
  const obj = await c.env.FILES.get(cut ? cutKey(f.lesson_id, f.id) : fileKey(f.lesson_id, f.id));
  if (!obj) throw new HttpError(404, "not_found", "Die Datei fehlt im Speicher.");
  const inline = d === "i" && INLINE_SAFE.test(f.mime);
  return new Response(obj.body, { headers: {
    "Content-Type": f.mime || "application/octet-stream", "Content-Length": String(obj.size),
    "Content-Disposition": contentDisposition(cut ? cutName(f) : f.area === "print" ? printFileName({ name: f.name, ...printProps(f) }) : f.name, !inline),
    "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    "Referrer-Policy": "no-referrer",
  } });
}
export async function routeSlide(c, fileId, nRaw) {
  const u = new URL(c.request.url), n = Number(nRaw), st = u.searchParams.get("p") === "st";
  if (!Number.isInteger(n) || !(await checkLink(requireSecret(c.env), st ? ["slide", fileId, n, "st"] : ["slide", fileId, n], u.searchParams.get("e"), u.searchParams.get("s"), c.now)))
    throw new HttpError(403, "link_expired", "Diese Folie ist nicht (mehr) freigegeben.");
  const f = await getFile(c.db, fileId);
  if (st && !(f.area === "presentation" && f.status === "ready" && n >= 1 && n <= studentSlideLimit(f)))
    throw new HttpError(403, "link_expired", "Diese Folie ist nicht (mehr) freigegeben.");
  const obj = await c.env.FILES.get(slideKey(f.lesson_id, f.id, n));
  if (!obj) throw new HttpError(404, "not_found", "Folie nicht gefunden.");
  return new Response(obj.body, { headers: { "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
