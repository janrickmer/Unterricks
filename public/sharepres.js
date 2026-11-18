// sharepres.js – Präsentation für „Unterrichtseinheit mit KollegInnen teilen“ (Nachtrag 39) im Browser aufbereiten: reine Codefolien fallen weg,
// auf Materialfolien wird die kleine Zeile „Unterricks-Codefolie: …“ mit der Farbe des Hintergrunds überdeckt, jede Folie bekommt unten klein und blass
// „Copyright Jan-Rickmer Feindt“ (an einer freien Stelle: rechts, links oder Mitte). Die Seiten werden wie die Fassung für Schüler:innen bereinigt kopiert
// (pdfcut.js: ohne Dateianhänge – also ohne die Notizen der Lehrkraft –, nur Link-Anmerkungen; Text bleibt Text). Die Notizen kommen auf Wunsch als
// eigene PDF dazu (pdfnotes.js, Folien wie in der geteilten Präsentation).
// Grenze: Überdeckt ist nur das Bild – der Text der Zeile bleibt unsichtbar in der Datei (wie die unsichtbaren Zeilen „Unterricks-Phase“/„Unterricks-Video“).
import { lazy, lazyWorker } from "./update.js";
import { slideTextLines, codeMarkLine } from "./shared.js";
import { pdfLib, stripPage, copyPagesSafe } from "./pdfcut.js";
import { annotatedPdfBytes } from "./pdfnotes.js";
import { SHARE_COPYRIGHT, shareSlidePlan, markBoxes } from "./sharelib.js";
import { buildPptx } from "./sharepptx.js";

let pdfjsP = null;
async function pdfjs() {
  if (!pdfjsP) pdfjsP = lazy(import("/vendor/pdf.min.mjs")).then((m) => { m.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href; return m; });
  return pdfjsP;
}
/* Textstücke einer Seite in Gerätekoordinaten (Maßstab 1, y nach unten) – wie presenter.js (pageItems), ohne Schriftangaben */
async function textItems(lib, page, vp) {
  const tc = await page.getTextContent(), out = [], sx = Math.hypot(vp.transform[0], vp.transform[1]);
  for (const it of tc.items || []) {
    if (typeof it.str !== "string") continue;
    const tx = lib.Util.transform(vp.transform, it.transform), hgt = Math.hypot(tx[2], tx[3]), w = it.width * sx;
    const turned = Math.abs(tx[1]) > hgt * 0.02 || !(tx[0] > 0);
    out.push(turned ? { str: "", eol: true } : { str: it.str, x: tx[4], base: tx[5], w, h: hgt, eol: !!it.hasEOL });
  }
  return out;
}
const lineBox = (l) => { const m = (l.map || []).filter(Boolean); if (!m.length) return null; return { x0: Math.min(...m.map((c) => c.x0)), x1: Math.max(...m.map((c) => c.x1)), top: l.base - l.h, bottom: l.base + l.h * 0.3 }; };
const hits = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.top < b.bottom && b.top < a.bottom;
/* freie Stelle für die Copyright-Zeile (Gerätekoordinaten): rechts unten, sonst links, sonst Mitte; ganz unten am Rand, wenn überall Text steht.
   W, H = Größe der Seite, tw = Breite des Textes, fs = Schriftgröße, lines = Zeilen der Seite → {x, base} */
export function footerSpot(lines, W, H, tw, fs) {
  const m = Math.max(6, H * 0.018), base = H - m, boxes = (lines || []).map(lineBox).filter(Boolean), pad = fs * 0.25;
  for (const x of [W - m - tw, m, (W - tw) / 2]) {
    const b = { x0: x - pad, x1: x + tw + pad, top: base - fs - pad, bottom: base + fs * 0.3 + pad };
    if (!boxes.some((o) => hits(o, b))) return { x, base };
  }
  return { x: W - m - tw, base: H - Math.max(2, fs * 0.3) };
}
/* Hintergrundfarbe rund um einen Kasten: Ring außerhalb der Schrift, Median je Kanal (0…1). ctx = 2D-Kontext der gezeichneten Seite (Maßstab k) */
function ringColor(ctx, k, b) {
  const h = Math.max(2, b.bottom - b.top), W = ctx.canvas.width, Hc = ctx.canvas.height;
  const x0 = Math.max(0, Math.floor((b.x0 - h * 0.6) * k)), x1 = Math.min(W - 1, Math.ceil((b.x1 + h * 0.6) * k));
  const y0 = Math.max(0, Math.floor((b.top - h * 0.6) * k)), y1 = Math.min(Hc - 1, Math.ceil((b.bottom + h * 0.6) * k));
  if (x1 - x0 < 2 || y1 - y0 < 2) return [1, 1, 1];
  const d = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data, w = x1 - x0 + 1, r = [], g = [], bl = [];
  const ix0 = (b.x0 - h * 0.1) * k - x0, ix1 = (b.x1 + h * 0.1) * k - x0, iy0 = (b.top - h * 0.1) * k - y0, iy1 = (b.bottom + h * 0.1) * k - y0;
  for (let y = 0; y <= y1 - y0; y++) for (let x = 0; x < w; x++) {
    if (x >= ix0 && x <= ix1 && y >= iy0 && y <= iy1) continue;   // die Schrift selbst zählt nicht
    const i = (y * w + x) * 4; r.push(d[i]); g.push(d[i + 1]); bl.push(d[i + 2]);
  }
  if (!r.length) return [1, 1, 1];
  const med = (a) => { a.sort((p, q) => p - q); return a[a.length >> 1] / 255; };
  return [med(r), med(g), med(bl)];
}
/* Seite zeichnen (für die Farben) → 2D-Kontext oder null (ohne Canvas, z. B. im Test) */
async function renderPage(page, k) {
  if (typeof document === "undefined") return null;
  const vp = page.getViewport({ scale: k }), canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return ctx;
}

/* Folienbild für die PowerPoint-Fassung: ≈ 1920 px breit (kleine Seiten höchstens 4-fach), PNG – ist es sehr groß (Fotos), JPEG.
   → {data: Uint8Array, mime} oder null (ohne Canvas) */
async function rasterPage(page) {
  if (typeof document === "undefined") return null;
  const vp0 = page.getViewport({ scale: 1 }), k = Math.min(4, Math.max(1, 1920 / Math.max(1, vp0.width))), vp = page.getViewport({ scale: k });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const blob = (type, q) => new Promise((res) => canvas.toBlob(res, type, q));
  let b = await blob("image/png"), mime = "image/png";
  if (!b || b.size > 1.5e6) { const j = await blob("image/jpeg", 0.88); if (j) { b = j; mime = "image/jpeg"; } }
  if (!b) return null;
  const data = new Uint8Array(await b.arrayBuffer());
  canvas.width = canvas.height = 0;   // Speicher gleich frei
  return { data, mime };
}
// sichtbarer Text einer Folie (Bildbeschreibung in PowerPoint): ohne die Unterricks-Zeile und die unsichtbaren Zeilen „Unterricks-Phase/-Video“
const altText = (lines) => (lines || []).map((l) => String(l.text || "").trim()).filter((t) => t && !codeMarkLine(t) && !/^Unterricks-(Phase|Video)\b/i.test(t)).join(" ");

/* bytes = Präsentation (PDF), codeSlides = [{n, lines}], titles = Namen der Materialien und Feibeitsblätter der Sitzung, notes = [{n, items}] (Notizen der
   Lehrkraft) oder null. pptx: auch die PowerPoint-Fassung (Folienbilder + Notizen; libs.raster ersetzt im Test das Zeichnen).
   → {bytes, notesBytes|null, pptxBytes|null, pptxError, kept, dropped, covered, uncovered} (Nummern der ursprünglichen Folien) */
export async function sharePresentation(bytes, { codeSlides = [], titles = [], notes = null, title = "", libs = null, pptx = true } = {}) {
  const PL = libs && libs.pdfLib ? libs.pdfLib : await pdfLib(), PJ = libs && libs.pdfjs ? libs.pdfjs : await pdfjs();
  const { PDFDocument, StandardFonts, rgb, degrees } = PL;
  let src;
  try { src = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { throw new Error("Die Präsentation lässt sich im Browser nicht aufbereiten" + (/encrypt/i.test(String(e && e.message)) ? " (sie ist geschützt)" : "") + "."); }
  const total = src.getPageCount(), plan = shareSlidePlan(codeSlides, total, titles), cover = new Set(plan.cover);
  const doc = await lazyWorker(PJ.getDocument({ data: new Uint8Array(bytes).slice(), isEvalSupported: false, verbosity: 0 }).promise);
  const out = await PDFDocument.create(), font = await out.embedFont(StandardFonts.Helvetica);
  const info = [], uncovered = [], alts = [];
  try {
    for (const n of plan.keep) {
      const page = await doc.getPage(n), vp = page.getViewport({ scale: 1 }), lines = slideTextLines(await textItems(PJ, page, vp));
      alts.push(altText(lines));
      let rects = [];
      if (cover.has(n)) {
        const boxes = markBoxes(lines);
        if (!boxes.length) uncovered.push(n);
        else {
          // Farbe des Hintergrunds aus der gezeichneten Seite; ohne Canvas (bzw. libs.color im Test) bleibt die Zeile lieber stehen als ein heller Kasten
          const k = 2, ctx = libs && libs.color ? null : await renderPage(page, k).catch(() => null);
          const colorOf = (b) => (libs && libs.color ? libs.color(n, b) : ctx ? ringColor(ctx, k, b) : null);
          if (!ctx && !(libs && libs.color)) uncovered.push(n);
          else rects = boxes.map((b) => {
            const h = b.bottom - b.top, pb = { x0: b.x0 - h * 0.25, x1: b.x1 + h * 0.25, top: b.top - h * 0.2, bottom: b.bottom + h * 0.2 };
            const [ax, ay] = vp.convertToPdfPoint(pb.x0, pb.top), [bx, by] = vp.convertToPdfPoint(pb.x1, pb.bottom);
            return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay), color: colorOf(b) };
          });
        }
      }
      // Copyright: Größe nach der Seitenhöhe (7 pt auf einer 540 pt hohen 16:9-Folie), an einer freien Stelle
      const fs = Math.min(11, Math.max(6, vp.height * 0.013)), text = SHARE_COPYRIGHT, tw = font.widthOfTextAtSize(text, fs);
      const spot = footerSpot(lines.filter((l) => !markBoxes([l]).length || !cover.has(n)), vp.width, vp.height, tw, fs);
      const [fx, fy] = vp.convertToPdfPoint(spot.x, spot.base);
      info.push({ rects, foot: { x: fx, y: fy, size: fs, rot: ((vp.rotation || 0) % 360 + 360) % 360 } });
      page.cleanup();
    }
  } finally { try { await doc.destroy(); } catch {} }
  for (const p of src.getPages()) stripPage(p, PL);
  const copied = copyPagesSafe(out, src, plan.keep.map((n) => n - 1), PL);
  copied.forEach((pg, i) => {
    out.addPage(pg);
    const it = info[i];
    for (const r of it.rects) pg.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: rgb(r.color[0], r.color[1], r.color[2]) });
    pg.drawText(SHARE_COPYRIGHT, { x: it.foot.x, y: it.foot.y, size: it.foot.size, font, color: rgb(0.55, 0.55, 0.58), opacity: 0.9, ...(it.foot.rot ? { rotate: degrees(it.foot.rot) } : {}) });
  });
  if (title) out.setTitle(title);
  out.setAuthor(SHARE_COPYRIGHT.replace(/^Copyright /, "")); out.setCreator("Unterricks"); out.setProducer("Unterricks (pdf-lib)");
  const shared = await out.save();
  let notesBytes = null;
  const pos = new Map(plan.keep.map((n, i) => [n, i + 1]));
  const kept = (notes || []).filter((x) => x && pos.has(x.n) && Array.isArray(x.items) && x.items.length).map((x) => ({ n: pos.get(x.n), items: x.items }));
  if (kept.length) notesBytes = await annotatedPdfBytes(shared, kept, PL, { codeSlides: [], title, label: "Präsentation mit Anmerkungen · für die Lehrkraft" });
  // PowerPoint-Fassung (Ergänzung der Lehrkraft vom 18.11.2026): Bilder der fertigen Seiten, ihre Links als anklickbare Flächen, Notizen der Lehrkraft
  // in den Notizen der Folie (Referentenansicht). Scheitert das Zeichnen, fehlt nur sie – die PDF bleibt.
  let pptxBytes = null, pptxError = "";
  if (pptx) {
    const byPos = new Map(kept.map((x) => [x.n, x.items]));
    let sdoc = null;
    try {
      sdoc = await lazyWorker(PJ.getDocument({ data: new Uint8Array(shared).slice(), isEvalSupported: false, verbosity: 0 }).promise);
      const slides = [];
      for (let i = 1; i <= sdoc.numPages; i++) {
        const page = await sdoc.getPage(i), vp = page.getViewport({ scale: 1 });
        const image = libs && libs.raster ? await libs.raster(page, i) : await rasterPage(page);
        if (!image) throw new Error("Die Folien ließen sich in diesem Browser nicht als Bild zeichnen");
        const links = [];
        for (const a of await page.getAnnotations().catch(() => [])) {
          if (!a || a.subtype !== "Link" || typeof a.url !== "string" || !Array.isArray(a.rect)) continue;
          const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
          links.push({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), url: a.url });
        }
        slides.push({ image, w: vp.width, h: vp.height, links, notes: byPos.get(i) || [], alt: alts[i - 1] || "" });
        page.cleanup();
      }
      pptxBytes = buildPptx({ slides, title, author: SHARE_COPYRIGHT.replace(/^Copyright /, "") });
    } catch (e) { pptxError = e && e.message ? e.message : "Fehler"; }
    finally { if (sdoc) try { await sdoc.destroy(); } catch {} }
  }
  return { bytes: shared, notesBytes, pptxBytes, pptxError, kept: plan.keep, dropped: plan.drop, covered: plan.cover.filter((n) => !uncovered.includes(n)), uncovered };
}
