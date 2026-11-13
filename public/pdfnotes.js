// pdfnotes.js – Notizen der Lehrkraft zu den Folien (Nachtrag 20, nur für die Lehrkraft): aus der hochgeladenen PDF lesen (PDF.js: Dateianhang
// unterricks-notizen.json, tolerant) und die Anmerkungs-PDF erzeugen (pdf-lib): jede Folie unverändert, dahinter eine Anmerkungsfolie im selben
// Format mit „Anmerkungen zu Folie n“ und den Stichpunkten. Sie liegt unter „Material nur für die Lehrkraft“ und nie bei Schüler:innen.
import { api, apiUrl } from "./ui.js";
import { isNotesFileName, cleanSlideNotes, NOTES_LIMITS } from "./shared.js";
import { sanitizer } from "./pdfmaker.js";
import { stripPage, pdfLib } from "./pdfcut.js";

// Anmerkungen, die Notizen tragen können: Schüler:innen bekommen dann nur die bereinigte Fassung (pdfcut.js, cleanPdfBytes)
export const NOTE_ANNOTS = new Set(["Text", "Popup", "FileAttachment"]);
const MAX_JSON = 3 * 1024 * 1024;
const decodeJson = (u8) => { try { return JSON.parse(new TextDecoder("utf-8").decode(u8).replace(/^﻿/, "")); } catch { return null; } };
/* Anhänge [{name, content: Uint8Array}] → Rohdaten der Notizen: zuerst unterricks-notizen.json (ohne Groß-/Kleinschreibung), sonst eine JSON-Datei
   mit „folien“ */
export function pickNotes(files) {
  const ok = (f) => f && f.content && f.content.length > 0 && f.content.length <= MAX_JSON;
  for (const f of files.filter((x) => ok(x) && isNotesFileName(x.name))) { const j = decodeJson(f.content); if (j) return j; }
  for (const f of files.filter((x) => ok(x) && /\.json$/i.test(String(x.name || "")))) { const j = decodeJson(f.content); if (j && typeof j === "object" && Array.isArray(j.folien)) return j; }
  return null;
}
/* PDF.js-Dokument durchsehen: Dateianhänge (EmbeddedFiles) und Anmerkungen je Seite. needsClean = Schüler:innen bekommen nur eine bereinigte Fassung
   (Anhänge oder Notiz-Anmerkungen vorhanden); raw = Notizen aus dem Anhang (ungeprüft) */
export async function scanPdfNotes(doc) {
  const files = [];
  let atts = null;
  try { atts = await doc.getAttachments(); } catch {}
  for (const k of Object.keys(atts || {})) { const a = atts[k]; if (a && a.content) files.push({ name: a.filename || k, content: a.content }); }
  let noteAnnots = false;
  for (let i = 1; i <= doc.numPages; i++) {
    let an = [];
    try { an = await (await doc.getPage(i)).getAnnotations(); } catch {}
    for (const a of an || []) {
      if (NOTE_ANNOTS.has(a.subtype)) noteAnnots = true;
      if (a.subtype === "FileAttachment" && a.file && a.file.content) files.push({ name: a.file.filename || "", content: a.file.content });
    }
  }
  return { attachments: files.length, needsClean: files.length > 0 || noteAnnots, raw: pickNotes(files) };
}

/* ---------- Anmerkungs-PDF ---------- */
const INK = [0.07, 0.13, 0.23], MUTED = [0.4, 0.44, 0.52], RULE = [0.85, 0.47, 0.13];
// Text in Zeilen der Breite maxW umbrechen (überlange Wörter hart)
function wrap(text, font, size, maxW) {
  const lines = [];
  let line = "";
  for (const w0 of String(text).split(/\s+/).filter(Boolean)) {
    let w = w0;
    const cand = line ? line + " " + w : w;
    if (font.widthOfTextAtSize(cand, size) <= maxW) { line = cand; continue; }
    if (line) { lines.push(line); line = ""; }
    while (font.widthOfTextAtSize(w, size) > maxW) {
      let k = 1;
      while (k < w.length && font.widthOfTextAtSize(w.slice(0, k + 1), size) <= maxW) k++;
      lines.push(w.slice(0, k)); w = w.slice(k);
    }
    line = w;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}
/* Anmerkungsfolie(n) hinter Folie n zeichnen; → Zahl der Seiten (1 + Fortsetzungen). Schrift wird bis 14 pt (bezogen auf 960 × 540) kleiner, bevor
   eine Fortsetzung folgt. */
function addNotePages(out, F, clean, rgb, W, H, n, isCode, items) {
  const u = Math.max(0.4, Math.min(W / 960, H / 540)), M = 48 * u, c = (a) => rgb(a[0], a[1], a[2]);
  const head = "Anmerkungen zu Folie " + n + (isCode ? " (Codefolie)" : ""), label = "Unterricks · Präsentation mit Anmerkungen · nur für die Lehrkraft";
  const top = H - M - 13 * u - 10 * u - 30 * u - 18 * u, bottom = M, maxW = W - 2 * M;
  const texts = items.map((t) => clean(t));
  const layout = (s) => texts.map((t) => wrap(t, F.r, s, maxW - s * 1.1));
  let size = 14 * u, blocks = layout(size);
  for (const k of [22, 20, 18, 16, 14]) {
    const s = k * u, b = layout(s), need = b.reduce((h, ls) => h + ls.length * s * 1.3 + s * 0.45, 0);
    if (need <= top - bottom) { size = s; blocks = b; break; }
  }
  let pages = 0, y = 0, page = null;
  const newPage = (cont) => {
    page = out.addPage([W, H]); pages++;
    page.drawText(clean(label), { x: M, y: H - M - 13 * u, size: 13 * u, font: F.r, color: c(MUTED) });
    const hy = H - M - 13 * u - 10 * u - 30 * u;
    page.drawText(clean(head + (cont ? " (Fortsetzung)" : "")), { x: M, y: hy, size: 30 * u, font: F.b, color: c(INK) });
    page.drawRectangle({ x: M, y: hy - 12 * u, width: Math.min(maxW, 220 * u), height: 3 * u, color: c(RULE) });
    y = top;
  };
  newPage(false);
  if (!texts.length) {
    page.drawText(clean("Keine Anmerkungen zu dieser Folie."), { x: M, y: y - 20 * u, size: 20 * u, font: F.r, color: c(MUTED) });
    return pages;
  }
  const lh = size * 1.3, ind = size * 1.1;
  for (const lines of blocks) {
    for (let i = 0; i < lines.length; i++) {
      if (y - lh < bottom) newPage(true);
      if (i === 0) page.drawText("•", { x: M, y: y - size, size, font: F.b, color: c(RULE) });
      page.drawText(lines[i], { x: M + ind, y: y - size, size, font: F.r, color: c(INK) });
      y -= lh;
    }
    y -= size * 0.45;
  }
  return pages;
}
/* bytes = Präsentation (PDF), notes = [{n, items}], lib = pdf-lib; codeSlides = [{n}] (Unterricks-Codefolien), title für die Dokumenteigenschaften.
   → PDF-Bytes: Folie 1, Anmerkungen zu Folie 1, Folie 2, … (Seiten der Präsentation bereinigt kopiert: ohne Anhänge, nur Link-Anmerkungen) */
export async function annotatedPdfBytes(bytes, notes, lib, { codeSlides = [], title = "" } = {}) {
  const { PDFDocument, StandardFonts, rgb } = lib;
  let src;
  try { src = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { throw new Error("Die Präsentation lässt sich im Browser nicht lesen" + (/encrypt/i.test(String(e && e.message)) ? " (sie ist geschützt)" : "") + "."); }
  const total = src.getPageCount();
  for (const p of src.getPages()) stripPage(p, lib);
  const out = await PDFDocument.create();
  const F = { r: await out.embedFont(StandardFonts.Helvetica), b: await out.embedFont(StandardFonts.HelveticaBold) };
  const clean = sanitizer(F.r), holders = new Set((codeSlides || []).map((x) => x && x.n));
  const byN = new Map(cleanSlideNotes(notes, total).map((x) => [x.n, x.items]));
  const copied = await out.copyPages(src, Array.from({ length: total }, (_, i) => i));
  for (let i = 0; i < total; i++) {
    const pg = out.addPage(copied[i]);
    let box = { width: 960, height: 540 };
    try { box = pg.getCropBox(); } catch {}
    const rot = (((pg.getRotation().angle || 0) % 360) + 360) % 360, sw = rot === 90 || rot === 270;
    addNotePages(out, F, clean, rgb, sw ? box.height : box.width, sw ? box.width : box.height, i + 1, holders.has(i + 1), byN.get(i + 1) || []);
  }
  out.setTitle("Präsentation mit Anmerkungen" + (title ? " – " + title : "")); out.setSubject("Nur für die Lehrkraft");
  out.setCreator("Unterricks"); out.setProducer("Unterricks (pdf-lib)");
  return out.save();
}
/* Anmerkungs-PDF erzeugen und unter „Material nur für die Lehrkraft“ ablegen (ersetzt die vorige). file = Präsentation; rev = Stand der Notizen;
   bytes = hochgeladene PDF (sonst über den Link der Lehrkraft geladen). → {file (neue Anmerkungs-PDF), removed (ersetzte Kennungen)} */
export async function makeAnnotated(file, { token, notes, rev, codeSlides = [], bytes = null }) {
  if (!bytes) {
    const l = await api("POST", "/api/teacher/files/" + file.id + "/link", { token, body: {} });
    const res = await fetch(apiUrl(l.url), { credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error("Die Präsentation ließ sich nicht laden (Fehler " + res.status + ").");
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  const pdf = await annotatedPdfBytes(bytes, notes, await pdfLib(), { codeSlides, title: String(file.name || "").replace(/\.pdf$/i, "") });
  return api("PUT", "/api/teacher/files/" + file.id + "/annotated?rev=" + rev, { token, raw: new Blob([pdf], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } });
}
export { NOTES_LIMITS };
