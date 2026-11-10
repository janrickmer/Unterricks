// files.js – Dateiablage in R2: Material für Schüler:innen, Material nur für die Lehrkraft, Präsentation (PDF + Folienbilder).
// Downloads und Folienbilder laufen über kurzlebige signierte Links (funktionieren auch beim direkten Öffnen auf dem iPad).
import { HttpError, bad, json, readJson, randomId, cleanLine, cleanText, isId, requireSecret, signLink, checkLink, contentDisposition, INLINE_SAFE } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { getLesson, fileOut, LIMITS, printProps } from "./lessons.js";
import { normalizeCode, isValidCode, cleanWebUrl, slidesUpTo, printFileName, cleanCopies } from "../public/shared.js";

export const MAX_FILE = 100 * 1024 * 1024;         // Grenze einer Anfrage im Cloudflare-Free-Plan
export const MAX_SLIDE = 4 * 1024 * 1024;
export const MAX_SLIDES = 300;
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
  const r = await c.db.prepare("SELECT (SELECT COALESCE(SUM(size),0) + COALESCE(SUM(cut_size),0) FROM files) + (SELECT COALESCE(SUM(size),0) FROM slides) AS used").first();
  const used = Number((r || {}).used) || 0, lim = storageLimit(c.env);
  if (used + add > lim) throw new HttpError(507, "storage_full", "Der Speicher ist voll (" + Math.round(used / 1024 ** 2) + " MB von " + Math.round(lim / 1024 ** 2) +
    " MB belegt). Bitte alte Dateien oder Sitzungen löschen – so bleibt die Ablage im kostenlosen Kontingent.");
}
function uploadLength(c, max) {
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
  if (f.area === "presentation") {
    keys.push(cutKey(f.lesson_id, f.id));
    const s = await c.db.prepare("SELECT n FROM slides WHERE file_id=?1").bind(f.id).all();
    for (const x of s.results || []) keys.push(slideKey(f.lesson_id, f.id, x.n));
  }
  for (let i = 0; i < keys.length; i += 1000) await c.env.FILES.delete(keys.slice(i, i + 1000));
  await c.db.batch([
    c.db.prepare("DELETE FROM slides WHERE file_id=?1").bind(f.id),
    c.db.prepare("DELETE FROM files WHERE id=?1").bind(f.id),
  ]);
}

/* ---------- Hochladen (Lehrkraft) ---------- */
export async function routeFileUpload(c, lessonId) {
  await requireTeacher(c);
  await getLesson(c.db, lessonId);
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
  const r = await c.db.prepare("SELECT * FROM files WHERE lesson_id=?1 AND fb_code=?2 AND id<>?3 AND area<>'archive'").bind(lessonId, code, exceptId).all();
  for (const f of r.results || []) await deleteFileObjects(c, f);
  return (r.results || []).length;
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
  await c.env.FILES.put(fileKey(lessonId, id), c.request.body, { httpMetadata: { contentType: "application/pdf" } });
  await c.db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, status, source, fb_code, fb_sig, created_at, updated_at) " +
    "VALUES(?1, ?2, 'student', 'file', ?3, 'application/pdf', ?4, 'ready', 'notfall', ?5, ?6, ?7, ?7)").bind(id, lessonId, name, len, code, sig, c.now).run();
  const replaced = await deleteNotfallFiles(c, lessonId, code, id);
  return json({ ok: true, file: fileOut(await getFile(c.db, id)), replaced });
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
 * Name beim Herunterladen „28x - beidseitig - sw - Name.pdf“; ohne Angabe gilt die zuletzt verwendete Anzahl dieser Klasse (sonst 1), beidseitig, schwarz-weiß. */
async function lastCopies(db, lessonId) {
  const r = await db.prepare("SELECT f.print_copies AS n FROM files f JOIN lessons l ON l.id = f.lesson_id WHERE f.area='print' AND f.print_copies IS NOT NULL " +
    "AND l.klass = (SELECT klass FROM lessons WHERE id=?1) ORDER BY f.created_at DESC LIMIT 1").bind(lessonId).first();
  return (r && r.n) || 1;
}
const boolParam = (v, dflt) => (v === "1" || v === "true" ? 1 : v === "0" || v === "false" ? 0 : dflt);
export async function routePrintUpload(c, lessonId) {
  await requireTeacher(c);
  await getLesson(c.db, lessonId);
  const u = new URL(c.request.url), name = cleanLine(u.searchParams.get("name"), 200) || "Druckvorlage.pdf";
  if (mimeFor(name, c.request.headers.get("content-type")) !== "application/pdf") throw bad("Zum Ausdrucken sind nur PDF-Dateien erlaubt.");
  const len = uploadLength(c, MAX_FILE);
  await checkStorage(c, len);
  const id = randomId(8), key = fileKey(lessonId, id);
  await c.env.FILES.put(key, c.request.body, { httpMetadata: { contentType: "application/pdf" } });
  // wirklich eine PDF? (die ersten Bytes) – sonst gleich wieder weg
  const head = await c.env.FILES.get(key, { range: { offset: 0, length: 5 } });
  if (!head || (await head.text()) !== "%PDF-") { await c.env.FILES.delete(key); throw bad("Diese Datei ist keine PDF-Datei. Zum Ausdrucken sind nur PDF-Dateien erlaubt."); }
  const copies = cleanCopies(u.searchParams.get("copies")) || (await lastCopies(c.db, lessonId));
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
  const copies = cleanCopies(p.copies) || (await lastCopies(db, lessonId));
  await db.prepare("INSERT INTO files(id, lesson_id, area, kind, name, mime, size, text, status, source, print_copies, print_duplex, print_color, created_at, updated_at) " +
    "VALUES(?1, ?2, 'print', 'text', ?3, 'text/markdown', ?4, ?5, 'ready', ?6, ?7, ?8, ?9, ?10, ?10)")
    .bind(id, lessonId, name, new TextEncoder().encode(t).length, t, source, copies, p.duplex === false ? 0 : 1, p.color === true ? 1 : 0, now).run();
  return getFile(db, id);
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
  await getLesson(c.db, lessonId);
  const body = await readJson(c.request, 10000);
  return json({ ok: true, file: fileOut(await insertLink(c.db, lessonId, body.area, body.title, body.url, cleanLine(body.source, 40) || "lehrkraft", c.now)) });
}
export async function routeTextCreate(c, lessonId) {
  await requireTeacher(c);
  await getLesson(c.db, lessonId);
  const body = await readJson(c.request, 600000);
  const f = await insertTextMaterial(c.db, lessonId, body.area, body.title, body.text, cleanLine(body.source, 40) || "chat", c.now);
  return json({ ok: true, file: fileOut(f) });
}
export async function routeFilePatch(c, fileId) {
  await requireTeacher(c);
  const f = await getFile(c.db, fileId);
  const body = await readJson(c.request, 600000);
  const sets = [], args = [];
  if (body.area !== undefined) {
    if (f.area === "presentation" || f.area === "print" || !AREAS.has(body.area)) throw bad("Ungültiger Bereich.");
    args.push(body.area); sets.push("area=?" + (args.length + 1));
  }
  if (body.name !== undefined) { const n = cleanLine(body.name, 200); if (!n) throw bad("Der Name darf nicht leer sein."); args.push(n); sets.push("name=?" + (args.length + 1)); }
  if (body.copies !== undefined || body.duplex !== undefined || body.color !== undefined) {
    if (f.area !== "print") throw bad("Anzahl, beidseitig und Farbe gibt es nur bei Dateien zum Ausdrucken.");
    if (body.copies !== undefined) { const n = cleanCopies(body.copies); if (!n) throw bad("Bitte eine Anzahl zwischen 1 und 500 angeben."); args.push(n); sets.push("print_copies=?" + (args.length + 1)); }
    if (body.duplex !== undefined) { args.push(body.duplex ? 1 : 0); sets.push("print_duplex=?" + (args.length + 1)); }
    if (body.color !== undefined) { args.push(body.color ? 1 : 0); sets.push("print_color=?" + (args.length + 1)); }
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
  await getLesson(c.db, lessonId);
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
  const f = await getFile(c.db, fileId), n = Number(nRaw);
  if (f.area !== "presentation") throw bad("Keine Präsentation.");
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
  const body = await readJson(c.request, 10000);
  const pages = Number(body.pages);
  if (f.area !== "presentation" || !Number.isInteger(pages) || pages < 1 || pages > MAX_SLIDES) throw bad("Ungültige Folienzahl.");
  const r = await c.db.prepare("SELECT COUNT(*) AS n FROM slides WHERE file_id=?1 AND n BETWEEN 1 AND ?2").bind(f.id, pages).first();
  if (((r || {}).n || 0) !== pages) throw bad("Es fehlen noch Folienbilder (" + ((r || {}).n || 0) + " von " + pages + "). Bitte erneut hochladen.");
  await c.db.prepare("UPDATE files SET pages=?2, status='ready', updated_at=?3 WHERE id=?1").bind(f.id, pages, c.now).run();
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
  return json({ ok: true, pages: f.pages, urls });
}
export async function slideUrl(secret, fileId, n, ttl, now = Date.now()) {
  const { e, s } = await signLink(secret, ["slide", fileId, n], ttl, now);
  return "/api/slide/" + fileId + "/" + n + "?e=" + e + "&s=" + encodeURIComponent(s);
}
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
  const u = new URL(c.request.url), n = Number(nRaw);
  if (!Number.isInteger(n) || !(await checkLink(requireSecret(c.env), ["slide", fileId, n], u.searchParams.get("e"), u.searchParams.get("s"), c.now)))
    throw new HttpError(403, "link_expired", "Diese Folie ist nicht (mehr) freigegeben.");
  const f = await getFile(c.db, fileId);
  const obj = await c.env.FILES.get(slideKey(f.lesson_id, f.id, n));
  if (!obj) throw new HttpError(404, "not_found", "Folie nicht gefunden.");
  return new Response(obj.body, { headers: { "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "image/jpeg", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
}
