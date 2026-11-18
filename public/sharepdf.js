// sharepdf.js – Begleitdokumente für „Unterrichtseinheit mit KollegInnen teilen“ (Nachtrag 39) im Browser als PDF (pdf-lib, Standardschriften):
// Leupold-Schema (Querformat, drei Spalten wie auf der Seite der Einheit) mit einem Absatz je Sitzung, Verlaufsplan, „Erklärung – Das ist ein
// Feibeitsblatt“ und „Fehlende Sitzungen“. Texte kommen als Blöcke aus sharelib.js: {t: "title"|"sub"|"muted"|"h"|"h2"|"p"|"li"|"gap", text?|runs?}.
// Fußzeile jeder Seite: „Copyright Jan-Rickmer Feindt“ und „Seite n von N“. Die Standardschriften kennen nur WinAnsi (sanitizer aus pdfmaker.js).
import { pdfLib } from "./pdfcut.js";
import { sanitizer } from "./pdfmaker.js";
import { SHARE_COPYRIGHT, competenceSource, shareFolder } from "./sharelib.js";

const INK = [0.09, 0.11, 0.16], MUTED = [0.38, 0.42, 0.5], ACCENT = [0.11, 0.3, 0.58], LINE = [0.78, 0.81, 0.87], FILL = [0.95, 0.96, 0.98], GOAL = [0.99, 0.95, 0.88];
const A4 = [595.28, 841.89], A4Q = [841.89, 595.28];

/* Dokument mit Schriften; pages = Liste der Seiten (für die Fußzeile) */
async function newDoc(title, lib0 = null) {
  const lib = lib0 || (await pdfLib()), { PDFDocument, StandardFonts, rgb } = lib;
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setAuthor(SHARE_COPYRIGHT.replace(/^Copyright /, "")); doc.setCreator("Unterricks"); doc.setProducer("Unterricks (pdf-lib)");
  const F = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold), i: await doc.embedFont(StandardFonts.HelveticaOblique),
    bi: await doc.embedFont(StandardFonts.HelveticaBoldOblique) };
  const c = (a) => rgb(a[0], a[1], a[2]);
  return { lib, doc, F, c, clean: sanitizer(F.r), pages: [] };
}
const fontOf = (F, r) => (r.b && r.i ? F.bi : r.b ? F.b : r.i ? F.i : F.r);

/* Läufe in Zeilen der Breite maxW umbrechen → [[{t, f, w, u, s}]] (Leerzeichen als eigene Stücke; überlange Wörter hart) */
function wrapRuns(D, runs, size, maxW) {
  const words = [];
  for (const r0 of runs || []) {
    const r = r0.href && String(r0.text).trim() !== r0.href ? { ...r0, text: r0.text + " (" + r0.href + ")" } : r0;
    const f = fontOf(D.F, r);
    for (const p of D.clean(String(r.text == null ? "" : r.text)).replace(/\n/g, " ").split(/(\s+)/)) {
      if (!p) continue;
      words.push({ t: /^\s+$/.test(p) ? " " : p, f, space: /^\s+$/.test(p), u: !!r.u, s: !!r.s });
    }
  }
  const lines = []; let line = [], w = 0;
  const push = () => { while (line.length && line[line.length - 1].space) { w -= line.pop().w; } lines.push(line); line = []; w = 0; };
  for (const wd of words) {
    const ww = wd.f.widthOfTextAtSize(wd.t, size);
    if (wd.space) { if (line.length) { line.push({ ...wd, w: ww }); w += ww; } continue; }
    if (w + ww > maxW && line.length) push();
    if (ww > maxW) {
      let chunk = "";
      for (const ch of wd.t) {
        if (wd.f.widthOfTextAtSize(chunk + ch, size) > maxW && chunk) { line.push({ ...wd, t: chunk, w: wd.f.widthOfTextAtSize(chunk, size) }); push(); chunk = ch; } else chunk += ch;
      }
      line.push({ ...wd, t: chunk, w: wd.f.widthOfTextAtSize(chunk, size) }); w = line[line.length - 1].w; continue;
    }
    line.push({ ...wd, w: ww }); w += ww;
  }
  if (line.length) push();
  return lines.length ? lines : [[]];
}
function drawLine(D, page, ln, x, y, size, color) {
  for (const seg of ln) {
    if (seg.t && !seg.space) page.drawText(seg.t, { x, y, size, font: seg.f, color });
    if (seg.u) page.drawLine({ start: { x, y: y - size * 0.12 }, end: { x: x + seg.w, y: y - size * 0.12 }, thickness: Math.max(0.4, size * 0.05), color });
    if (seg.s) page.drawLine({ start: { x, y: y + size * 0.3 }, end: { x: x + seg.w, y: y + size * 0.3 }, thickness: Math.max(0.4, size * 0.05), color });
    x += seg.w;
  }
}

/* ---------- Fließtext (Hochformat) ---------- */
const STYLE = {
  title: { size: 19, b: true, color: INK, before: 0, after: 6 }, sub: { size: 12.5, b: true, color: ACCENT, before: 0, after: 4 },
  muted: { size: 9.5, color: MUTED, before: 0, after: 6 }, h: { size: 13, b: true, color: ACCENT, before: 10, after: 4 }, h2: { size: 11.5, b: true, color: INK, before: 8, after: 3 },
  p: { size: 10.5, color: INK, before: 0, after: 5 }, li: { size: 10.5, color: INK, before: 0, after: 3, indent: 14 },
};
/* Blöcke auf Hochformat-Seiten setzen (neue Seiten nach Bedarf) – D = newDoc(), start = bestehende Seite und y oder null */
function flow(D, blocks, { M = 56 } = {}) {
  const [W, H] = A4, CW = W - 2 * M, bottom = M + 24;
  let page = null, y = 0;
  const newPage = () => { page = D.doc.addPage(A4); D.pages.push(page); y = H - M; };
  newPage();
  for (const b of blocks || []) {
    if (b.t === "gap") { y -= 5; continue; }
    const st = STYLE[b.t] || STYLE.p, runs = b.runs || [{ text: b.text || "", b: st.b }];
    const ind = st.indent || 0, lh = st.size * 1.32;
    const lines = wrapRuns(D, runs.map((r) => (st.b ? { ...r, b: true } : r)), st.size, CW - ind);
    // Überschriften nie allein am Seitenende
    const need = (b.t === "h" || b.t === "h2" ? 3 : 1) * lh + st.before;
    if (y - need < bottom) newPage(); else y -= st.before;
    lines.forEach((ln, i) => {
      if (y - lh < bottom) newPage();
      if (b.t === "li" && i === 0) page.drawText("•", { x: M + 3, y: y - st.size, size: st.size, font: D.F.b, color: D.c(ACCENT) });
      drawLine(D, page, ln, M + ind, y - st.size, st.size, D.c(st.color));
      y -= lh;
    });
    y -= st.after;
  }
}
/* Fußzeile aller Seiten: Copyright links, Seite n von N rechts (Hoch- und Querformat) */
function footers(D) {
  const n = D.pages.length;
  D.pages.forEach((p, k) => {
    const { width: W } = p.getSize(), M = W > 700 ? 40 : 56, size = 8;
    p.drawText(D.clean(SHARE_COPYRIGHT), { x: M, y: 24, size, font: D.F.r, color: D.c(MUTED) });
    const t = "Seite " + (k + 1) + " von " + n;
    p.drawText(t, { x: W - M - D.F.r.widthOfTextAtSize(t, size), y: 24, size, font: D.F.r, color: D.c(MUTED) });
  });
}
/* Blöcke → PDF-Bytes (Hochformat) */
export async function blocksPdf(title, blocks, { lib = null } = {}) {
  const D = await newDoc(title, lib);
  flow(D, blocks);
  footers(D);
  return D.doc.save();
}

/* ---------- Leupold-Schema (Querformat) ----------
   plan = unit.plan (ausgangslage, schritte [{titel, beschreibung}], lernaufgabe, planungsgrundlage), header = {title, meta}. → true, wenn es auf eine Seite passt */
function textHeight(D, text, f, size, w) { return wrapRuns(D, [{ text, b: f === D.F.b }], size, w).length * size * 1.3; }
function drawPara(D, page, text, x, y, w, size, f, color) {
  const lines = wrapRuns(D, [{ text, b: f === D.F.b, i: f === D.F.i }], size, w);
  for (const ln of lines) { drawLine(D, page, ln, x, y - size, size, D.c(color)); y -= size * 1.3; }
  return y;
}
function leupoldPage(D, plan, header) {
  const [W, H] = A4Q, M = 40, CW = W - 2 * M, gap = 18;
  const wl = CW * 0.24, wr = CW * 0.24, wm = CW - wl - wr - 2 * gap, pad = 8;
  const steps = (plan.schritte || []).filter((s) => s && (s.titel || s.beschreibung));
  const pg = plan.planungsgrundlage && plan.planungsgrundlage.name ? "Planungsgrundlage: " + plan.planungsgrundlage.name + (plan.planungsgrundlage.begruendung ? " – " + plan.planungsgrundlage.begruendung : "") : "";
  const top = H - M - 22 - 16 - 10, bottom = M + 30;
  for (const size of [10, 9.5, 9, 8.5, 8, 7.5, 7]) {
    const cap = size + 2, capH = cap * 1.5;
    const hl = capH + textHeight(D, plan.ausgangslage || "–", D.F.r, size, wl - 2 * pad) + 2 * pad;
    const hr = capH + textHeight(D, plan.lernaufgabe || "–", D.F.r, size, wr - 2 * pad) + 2 * pad;
    const dw = wm * 0.58 - 2 * pad, tw = wm * 0.42 - 2 * pad;
    const rows = steps.map((s, i) => Math.max(textHeight(D, s.beschreibung || "", D.F.r, size, dw), textHeight(D, (i + 1) + ". " + (s.titel || ""), D.F.b, size, tw)) + 2 * pad);
    const midHead = pad + cap + 8, hm = midHead + rows.reduce((a, b) => a + b + 6, 0);
    const hpg = pg ? textHeight(D, pg, D.F.r, size, CW) + 10 : 0;
    if (Math.max(hl, hr, hm) + hpg > top - bottom) continue;
    // passt: zeichnen
    const page = D.doc.addPage(A4Q); D.pages.push(page);
    page.drawText(D.clean("Leupold-Schema: " + (header.title || "Unterrichtseinheit")), { x: M, y: H - M - 18, size: 18, font: D.F.b, color: D.c(INK) });
    if (header.meta) page.drawText(D.clean(header.meta), { x: M, y: H - M - 36, size: 10, font: D.F.r, color: D.c(MUTED) });
    const y0 = top;
    const box = (x, w, h, fill) => page.drawRectangle({ x, y: y0 - h, width: w, height: h, color: D.c(fill), borderColor: D.c(LINE), borderWidth: 0.8 });
    const caption = (x, t) => page.drawText(D.clean(t), { x: x + pad, y: y0 - pad - cap, size: cap, font: D.F.b, color: D.c(ACCENT) });
    // links Ausgangslage, rechts Lernaufgabe, dazwischen die Lernschritte (Pfeile zeigen die Richtung)
    const xl = M, xm = M + wl + gap, xr = xm + wm + gap, colH = Math.max(hl, hr, hm);
    box(xl, wl, colH, FILL); caption(xl, "Ausgangslage");
    drawPara(D, page, plan.ausgangslage || "–", xl + pad, y0 - pad - capH, wl - 2 * pad, size, D.F.r, INK);
    box(xr, wr, colH, GOAL); caption(xr, "Zentrale Lernaufgabe");
    drawPara(D, page, plan.lernaufgabe || "–", xr + pad, y0 - pad - capH, wr - 2 * pad, size, D.F.r, INK);
    page.drawText(D.clean("Lernschritte"), { x: xm, y: y0 - pad - cap, size: cap, font: D.F.b, color: D.c(ACCENT) });
    let yy = y0 - midHead;
    steps.forEach((s, i) => {
      const h = rows[i];
      page.drawRectangle({ x: xm, y: yy - h, width: wm, height: h, color: D.c([1, 1, 1]), borderColor: D.c(LINE), borderWidth: 0.8 });
      page.drawRectangle({ x: xm + wm * 0.58, y: yy - h, width: wm * 0.42, height: h, color: D.c(FILL) });
      drawPara(D, page, s.beschreibung || "", xm + pad, yy - pad, dw, size, D.F.r, INK);
      drawPara(D, page, (i + 1) + ". " + (s.titel || ""), xm + wm * 0.58 + pad, yy - pad, tw, size, D.F.b, INK);
      yy -= h + 6;
    });
    const arrow = (x) => { const ya = y0 - colH / 2; page.drawSvgPath("M 0 -7 L 10 0 L 0 7 Z", { x: x + gap / 2 - 5, y: ya, color: D.c(ACCENT) }); };
    arrow(xl + wl); arrow(xm + wm);
    if (pg) drawPara(D, page, pg, M, y0 - colH - 10, CW, size, D.F.r, MUTED);
    return true;
  }
  return false;   // zu viel Text für eine Seite: als Fließtext (siehe leupoldPdf)
}
/* Absatz je Sitzung als Blöcke: sessions = shareSessions(…), steps = Lernschritte, unit = {subject, klass} */
export function sessionBlocks(sessions, steps, unit) {
  const src = competenceSource(unit.subject, unit.klass), out = [{ t: "title", text: "Die Sitzungen der Einheit" }];
  const head = (s) => shareFolder(s.n) + ": " + ((s.row && s.row.stundenfrage) || (s.lesson && s.lesson.title) || "ohne Stundenfrage");
  for (const s of sessions) {
    out.push({ t: "h2", text: head(s) });
    const st = s.row && Number.isInteger(s.row.schritt) && steps[s.row.schritt] ? steps[s.row.schritt] : null;
    if (st) out.push({ t: "muted", text: "Lernschritt " + (s.row.schritt + 1) + ": " + (st.titel || "") });
    const t = s.lesson && s.lesson.shareText, ab = s.row && Array.isArray(s.row.ablauf) ? s.row.ablauf.filter(Boolean) : [];
    if (s.planned && t) {
      if (t.passiert) out.push({ t: "p", runs: [{ text: "Was passiert: ", b: true }, { text: t.passiert }] });
      if (t.kompetenz) out.push({ t: "p", runs: [{ text: src.label + ": ", b: true }, { text: t.kompetenz }] });
      if (t.ziel) out.push({ t: "p", runs: [{ text: "Ziel: ", b: true }, { text: t.ziel }] });
    } else {
      if (!s.planned) out.push({ t: "p", runs: [{ text: "Noch nicht geplant – siehe „Fehlende Sitzungen“.", i: true }] });
      if (ab.length) out.push({ t: "p", runs: [{ text: "Grober Ablauf: ", b: true }, { text: ab.join(" · ") }] });
    }
  }
  return out;
}
/* ganze Datei: Leupold-Schema (Querformat; passt es nicht auf eine Seite, als Fließtext) + Absätze je Sitzung */
export async function leupoldPdf(unit, sessions, header, { lib = null } = {}) {
  const plan = unit.plan || {}, steps = plan.schritte || [];
  const D = await newDoc("Leupold-Schema – " + (header.title || "Unterrichtseinheit"), lib);
  const blocks = [];
  if (!(plan.lernaufgabe || steps.length) || !leupoldPage(D, plan, header)) {
    blocks.push({ t: "title", text: "Leupold-Schema: " + (header.title || "Unterrichtseinheit") }, ...(header.meta ? [{ t: "muted", text: header.meta }] : []));
    if (plan.lernaufgabe || steps.length) {
      blocks.push({ t: "h", text: "Ausgangslage" }, { t: "p", runs: [{ text: plan.ausgangslage || "–" }] }, { t: "h", text: "Lernschritte" },
        ...steps.map((s, i) => ({ t: "li", runs: [{ text: (i + 1) + ". " + (s.titel || ""), b: true }, { text: s.beschreibung ? " – " + s.beschreibung : "" }] })),
        { t: "h", text: "Zentrale Lernaufgabe" }, { t: "p", runs: [{ text: plan.lernaufgabe || "–" }] });
      if (plan.planungsgrundlage && plan.planungsgrundlage.name) blocks.push({ t: "muted", text: "Planungsgrundlage: " + plan.planungsgrundlage.name + (plan.planungsgrundlage.begruendung ? " – " + plan.planungsgrundlage.begruendung : "") });
    } else blocks.push({ t: "p", runs: [{ text: "Für diese Einheit gibt es noch kein Leupold-Schema.", i: true }] });
    blocks.push({ t: "gap" });
  }
  if (sessions.length) blocks.push(...sessionBlocks(sessions, steps, unit));
  if (blocks.length) flow(D, blocks);
  footers(D);
  return D.doc.save();
}
