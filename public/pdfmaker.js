// pdfmaker.js – Textmaterial (Markdown) im Browser als A4-PDF erzeugen (pdf-lib, Standardschriften; für GoodNotes & Co.). Rückfall: Material
// gestaltet sonst Claude selbst (HTML, Druck auf dem Server, worker/render.js). Die Standardschriften kennen nur WinAnsi (Westeuropa) –
// Griechisch oder Hebräisch erscheinen hier als „?“.
import { parseBlocks, parseInline, plainInline } from "./markdown.js";

let libP = null;
const lib = () => (libP = libP || import("/vendor/pdf-lib.esm.min.js"));

// Standardschriften kennen nur WinAnsi: übliche Sonderzeichen ersetzen, Unbekanntes als „?“
const REPL = { "→": "->", "←": "<-", "⇒": "=>", "↔": "<->", "✓": "v", "✔": "v", "✗": "x", "✘": "x", "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "−": "-", " ": " ", " ": " ", " ": " ", "☐": "[ ]", "□": "[ ]", "■": "#", "★": "*", "☆": "*", "⚖": "", "→️": "->" };
export function sanitizer(font) {
  const ok = new Map();
  return (s) => {
    let out = "";
    for (const ch of String(s)) {
      if (ch === "\n") { out += ch; continue; }   // Zeilenwechsel bleibt (para() bricht dort um) – sonst stünde ein „?“ da
      if (ch === "\t") { out += " "; continue; }
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
    for (const r0 of runs) {
      // Links: auf Papier zählt die Adresse – „Text (https://…)“, wenn der Linktext sie nicht schon zeigt
      const r = r0.href && r0.text.trim() !== r0.href ? { ...r0, text: r0.text + " (" + r0.href + ")" } : r0;
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

  // Schreiblinien (8 mm Abstand) über die ganze Breite ab Einzug x0
  const LINE_GAP = 22.7;
  function writeLines(n, x0 = M) {
    for (let k = 0; k < n; k++) {
      ensure(LINE_GAP + 2);
      y -= LINE_GAP;
      page.drawLine({ start: { x: x0, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.55, 0.58, 0.64) });
    }
    y -= 8;
  }
  const box = (x, yy, checked) => {
    page.drawRectangle({ x, y: yy, width: 8.5, height: 8.5, borderColor: rgb(0.2, 0.22, 0.28), borderWidth: 0.7 });
    if (checked) { page.drawLine({ start: { x: x + 1.5, y: yy + 4.5 }, end: { x: x + 3.6, y: yy + 2 }, thickness: 1 }); page.drawLine({ start: { x: x + 3.6, y: yy + 2 }, end: { x: x + 7.2, y: yy + 7.2 }, thickness: 1 }); }
  };

  // Kopf: Titel + Name/Klasse/Datum (zum Ausfüllen in GoodNotes; nicht bei Material nur für die Lehrkraft)
  para([{ text: title || "Material", b: true }], 18, { gap: 4 });
  if (opt.subtitle) para([{ text: opt.subtitle }], 9.5, { color: rgb(0.35, 0.4, 0.48), gap: 2 });
  if (opt.nameLine !== false) {
    ensure(30);
    const ly = y - 20, col = rgb(0.3, 0.33, 0.4), seg = [["Name:", 0, 0.5], ["Klasse:", 0.53, 0.72], ["Datum:", 0.75, 1]];
    for (const [lab, a, z] of seg) {
      const x = M + CW * a, wl = F.r.widthOfTextAtSize(lab, 10.5);
      page.drawText(lab, { x, y: ly, size: 10.5, font: F.r, color: col });
      page.drawLine({ start: { x: x + wl + 4, y: ly - 2 }, end: { x: M + CW * z - 6, y: ly - 2 }, thickness: 0.5, color: rgb(0.55, 0.58, 0.64) });
    }
    y -= 30;
  }
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.8, color: rgb(0.75, 0.78, 0.84) });
  y -= 14;

  // eine erste Überschrift, die nur den Titel wiederholt, entfällt (der Kopf zeigt ihn schon)
  const norm = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const blocks = parseBlocks(md);
  if (blocks[0] && blocks[0].type === "h" && norm(plainInline(blocks[0].text)) === norm(title)) blocks.shift();

  for (const b of blocks) {
    if (b.type === "h") { ensure(40); y -= 4; para(parseInline(b.text).map((r) => ({ ...r, b: true })), b.level <= 1 ? 15 : b.level === 2 ? 13 : 11.5, { gap: 4 }); }
    else if (b.type === "p") para(parseInline(b.text), 11, { gap: 7 });
    else if (b.type === "quote") para(parseInline(b.text).map((r) => ({ ...r, i: true })), 11, { indent: 14, gap: 7, color: rgb(0.3, 0.33, 0.4) });
    else if (b.type === "code") para([{ text: b.text, code: true }], 9.5, { gap: 7 });
    else if (b.type === "hr") { ensure(16); page.drawLine({ start: { x: M, y: y - 6 }, end: { x: W - M, y: y - 6 }, thickness: 0.6, color: rgb(0.8, 0.82, 0.86) }); y -= 16; }
    else if (b.type === "write") writeLines(b.n);
    else if (b.type === "list") {
      // Zähler je Ebene; die Nummer der ersten Zeile ist der Start (Markdown zählt „1. 1. 1.“ als 1, 2, 3); Platz für zweistellige Nummern
      const count = [], markW = (it) => (it.ordered ? F.r.widthOfTextAtSize("00.", 11) + 6 : 13);
      for (const it of b.items) {
        count.length = it.depth + 1;
        count[it.depth] = it.ordered ? (count[it.depth] === undefined ? (it.num || 1) : count[it.depth] + 1) : 0;
        const ind = 4 + it.depth * 18 + markW(it);
        ensure(16);
        if (it.box) box(M + ind - 13, y - 10.5, it.box === "x");
        else {
          const mark = it.ordered ? count[it.depth] + "." : "•", font = it.ordered ? F.r : F.b;
          page.drawText(mark, { x: M + ind - 5 - font.widthOfTextAtSize(mark, 11), y: y - 11, size: 11, font });
        }
        para(parseInline(it.text), 11, { indent: ind, gap: 3 });
      }
      y -= 4;
    } else if (b.type === "table") {
      const cols = Math.max(b.head.length, ...b.rows.map((r) => r.length));
      const cw = CW / cols, size = cols > 4 ? 9 : 10, pad = 4;
      const drawRow = (cells, bold) => {
        // Höhe bestimmen: Zeilen je Zelle
        const wrap = (txt, f) => {
          const out = [], max = cw - 2 * pad; let line = "";
          for (let word of clean(txt).replace(/\n/g, " ").split(/\s+/)) {
            // zu lange Wörter (Komposita, Adressen) hart trennen, damit nichts über den Zellenrand läuft
            while (f.widthOfTextAtSize(word, size) > max && word.length > 1) {
              let k = 1; while (k < word.length && f.widthOfTextAtSize(word.slice(0, k + 1) + "-", size) <= max) k++;
              if (line) { out.push(line); line = ""; }
              out.push(word.slice(0, k) + "-"); word = word.slice(k);
            }
            const t = line ? line + " " + word : word;
            if (f.widthOfTextAtSize(t, size) > max && line) { out.push(line); line = word; } else line = t;
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
