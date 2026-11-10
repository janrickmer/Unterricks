// pdfmaker.js – Textmaterial (Markdown) im Browser als A4-PDF erzeugen (pdf-lib, Standardschriften; für GoodNotes & Co.).
import { parseBlocks, parseInline } from "./markdown.js";

let libP = null;
const lib = () => (libP = libP || import("/vendor/pdf-lib.esm.min.js"));

// Standardschriften kennen nur WinAnsi: übliche Sonderzeichen ersetzen, Unbekanntes als „?“
const REPL = { "→": "->", "←": "<-", "⇒": "=>", "↔": "<->", "✓": "v", "✔": "v", "✗": "x", "✘": "x", "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "−": "-", " ": " ", " ": " ", " ": " ", "☐": "[ ]", "□": "[ ]", "■": "#", "★": "*", "☆": "*", "⚖": "", "→️": "->" };
function sanitizer(font) {
  const ok = new Map();
  return (s) => {
    let out = "";
    for (const ch of String(s)) {
      if (REPL[ch] !== undefined) { out += REPL[ch]; continue; }
      if (!ok.has(ch)) { try { font.encodeText(ch); ok.set(ch, true); } catch { ok.set(ch, false); } }
      out += ok.get(ch) ? ch : (/\p{Extended_Pictographic}/u.test(ch) ? "" : "?");
    }
    return out;
  };
}

export async function markdownToPdf(title, md, opt = {}) {
  const { PDFDocument, StandardFonts, rgb } = await lib();
  const doc = await PDFDocument.create();
  doc.setTitle(title || "Material"); doc.setCreator("Unterricks"); doc.setProducer("Unterricks (pdf-lib)");
  const F = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold), i: await doc.embedFont(StandardFonts.HelveticaOblique), bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique), m: await doc.embedFont(StandardFonts.Courier) };
  const clean = sanitizer(F.r);
  const W = 595.28, H = 841.89, M = 56, CW = W - 2 * M;
  let page, y;
  const pages = [];
  const newPage = () => { page = doc.addPage([W, H]); pages.push(page); y = H - M; };
  newPage();
  const ensure = (need) => { if (y - need < M + 20) newPage(); };
  const fontOf = (r) => (r.code ? F.m : r.b && r.i ? F.bi : r.b ? F.b : r.i ? F.i : F.r);

  // Läufe in Zeilen umbrechen und schreiben
  function para(runs, size, { indent = 0, gap = 6, lineH = 1.35, color = rgb(0.08, 0.1, 0.15), maxW = CW - indent } = {}) {
    const words = [];
    for (const r of runs) {
      const f = fontOf(r), parts = clean(r.text).split(/(\s+)/);
      for (const p of parts) { if (p === "") continue; if (/\n/.test(p)) { words.push({ br: true }); continue; } words.push({ t: p, f, space: /^\s+$/.test(p) }); }
    }
    const lines = []; let line = [], w = 0;
    for (const wd of words) {
      if (wd.br) { lines.push(line); line = []; w = 0; continue; }
      const ww = wd.f.widthOfTextAtSize(wd.space ? " " : wd.t, size);
      if (wd.space) { if (line.length) { line.push({ t: " ", f: wd.f, w: ww }); w += ww; } continue; }
      if (w + ww > maxW && line.length) { while (line.length && line[line.length - 1].t === " ") line.pop(); lines.push(line); line = []; w = 0; }
      if (ww > maxW) {   // sehr lange Wörter (Links) hart umbrechen
        let chunk = "";
        for (const ch of wd.t) { const cw = wd.f.widthOfTextAtSize(chunk + ch, size); if (cw > maxW) { lines.push([{ t: chunk, f: wd.f, w: wd.f.widthOfTextAtSize(chunk, size) }]); chunk = ch; } else chunk += ch; }
        line = [{ t: chunk, f: wd.f, w: wd.f.widthOfTextAtSize(chunk, size) }]; w = line[0].w; continue;
      }
      line.push({ t: wd.t, f: wd.f, w: ww }); w += ww;
    }
    if (line.length) lines.push(line);
    for (const ln of lines) {
      ensure(size * lineH);
      let x = M + indent;
      for (const seg of ln) { if (seg.t) page.drawText(seg.t, { x, y: y - size, size, font: seg.f, color }); x += seg.w; }
      y -= size * lineH;
    }
    y -= gap;
  }

  // Kopf: Titel + Name/Datum-Zeile (zum Ausfüllen in GoodNotes)
  para([{ text: title || "Material", b: true }], 18, { gap: 4 });
  if (opt.subtitle) para([{ text: opt.subtitle }], 9.5, { color: rgb(0.35, 0.4, 0.48), gap: 2 });
  if (opt.nameLine !== false) {
    ensure(26);
    page.drawText("Name: ______________________________     Datum: ______________", { x: M, y: y - 14, size: 10.5, font: F.r, color: rgb(0.3, 0.33, 0.4) });
    y -= 26;
  }
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: rgb(0.75, 0.78, 0.84) });
  y -= 14;

  for (const b of parseBlocks(md)) {
    if (b.type === "h") { ensure(40); y -= 4; para(parseInline(b.text).map((r) => ({ ...r, b: true })), b.level <= 1 ? 15 : b.level === 2 ? 13 : 11.5, { gap: 4 }); }
    else if (b.type === "p") para(parseInline(b.text), 11, { gap: 7 });
    else if (b.type === "quote") para(parseInline(b.text).map((r) => ({ ...r, i: true })), 11, { indent: 14, gap: 7, color: rgb(0.3, 0.33, 0.4) });
    else if (b.type === "code") para([{ text: b.text, code: true }], 9.5, { gap: 7 });
    else if (b.type === "hr") { ensure(16); page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.6, color: rgb(0.8, 0.82, 0.86) }); y -= 16; }
    else if (b.type === "list") {
      let n = 0;
      for (const it of b.items) {
        const ind = 16 + it.depth * 16;
        n = it.ordered ? (it.num || n + 1) : n;
        ensure(16);
        const mark = it.ordered ? n + "." : "•";
        page.drawText(mark, { x: M + ind - 13, y: y - 11, size: 11, font: it.ordered ? F.r : F.b });
        para(parseInline(it.text), 11, { indent: ind, gap: 3 });
      }
      y -= 4;
    } else if (b.type === "table") {
      const cols = Math.max(b.head.length, ...b.rows.map((r) => r.length));
      const cw = CW / cols, size = cols > 4 ? 9 : 10, pad = 4;
      const drawRow = (cells, bold) => {
        // Höhe bestimmen: Zeilen je Zelle
        const wrap = (txt, f) => {
          const out = []; let line = "";
          for (const word of clean(txt).split(/\s+/)) {
            const t = line ? line + " " + word : word;
            if (f.widthOfTextAtSize(t, size) > cw - 2 * pad && line) { out.push(line); line = word; } else line = t;
          }
          if (line) out.push(line); return out.length ? out : [""];
        };
        const cellLines = Array.from({ length: cols }, (_, k) => wrap(parseInline(cells[k] || "").map((r) => r.text).join(""), bold ? F.b : F.r));
        const hgt = Math.max(...cellLines.map((l) => l.length)) * size * 1.3 + 2 * pad + (bold ? 0 : 10);   // etwas Platz zum Schreiben
        ensure(hgt);
        for (let k = 0; k < cols; k++) {
          const x = M + k * cw;
          page.drawRectangle({ x, y: y - hgt, width: cw, height: hgt, borderColor: rgb(0.6, 0.64, 0.7), borderWidth: 0.6, color: bold ? rgb(0.93, 0.95, 0.98) : undefined });
          cellLines[k].forEach((ln, j) => page.drawText(ln, { x: x + pad, y: y - pad - size - j * size * 1.3, size, font: bold ? F.b : F.r }));
        }
        y -= hgt;
      };
      drawRow(b.head, true);
      for (const r of b.rows) drawRow(r, false);
      y -= 10;
    }
  }
  pages.forEach((p, k) => p.drawText("Seite " + (k + 1) + " von " + pages.length, { x: W - M - 70, y: 28, size: 8.5, font: F.r, color: rgb(0.5, 0.53, 0.6) }));
  const bytes = await doc.save();
  return new Blob([bytes], { type: "application/pdf" });
}
export const pdfName = (title) => (String(title || "Material").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "Material") + ".pdf";
