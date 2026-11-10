// a4.js – Druckvorlagen auf A4 bringen (Vorgabe der Lehrkraft: „Es kann grundsätzlich nur in A4 gedruckt werden“). Seiten in einem anderen
// Format werden im Browser auf A4 skaliert (Hoch- bzw. Querformat wie die Seite, mittig, ohne Verzerrung); A4-Seiten bleiben unverändert.
export const A4 = { w: 595.28, h: 841.89 };
const near = (a, b) => Math.abs(a - b) <= 3;   // ±3 pt (ca. 1 mm): Rundungen verschiedener Programme
export const isA4Size = (w, h) => (near(w, A4.w) && near(h, A4.h)) || (near(w, A4.h) && near(h, A4.w));

/* PDF-Bytes → { bytes, changed (Zahl der umgerechneten Seiten), total }; lib = pdf-lib ({ PDFDocument, degrees }) */
export async function toA4(bytes, lib) {
  const { PDFDocument, degrees } = lib;
  let src;
  try { src = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) {
    throw new Error("Diese PDF lässt sich im Browser nicht lesen" + (/encrypt/i.test(String(e && e.message)) ? " (sie ist geschützt)" : "") + ". Bitte ohne Kennwortschutz als PDF speichern und erneut hochladen.");
  }
  const pages = src.getPages(), total = pages.length;
  const plan = pages.map((p) => { const { width, height } = p.getSize(); const rot = (((p.getRotation().angle || 0) % 360) + 360) % 360; return { width, height, rot, ok: isA4Size(width, height) }; });
  const changed = plan.filter((x) => !x.ok).length;
  if (!changed) return { bytes, changed: 0, total };
  const out = await PDFDocument.create();
  try { const t = src.getTitle(); if (t) out.setTitle(t); } catch {}
  for (let i = 0; i < total; i++) {
    const x = plan[i];
    if (x.ok) { const [cp] = await out.copyPages(src, [i]); out.addPage(cp); continue; }
    // angezeigte Maße (mit /Rotate) → A4 in derselben Ausrichtung, so groß wie möglich und mittig
    const w = x.rot % 180 ? x.height : x.width, h = x.rot % 180 ? x.width : x.height;
    const land = w > h, W = land ? A4.h : A4.w, H = land ? A4.w : A4.h;
    const s = Math.min(W / w, H / h), ox = (W - w * s) / 2, oy = (H - h * s) / 2;
    const emb = await out.embedPage(pages[i]);
    const page = out.addPage([W, H]);
    // gedreht wie angezeigt: Drehung im Uhrzeigersinn um x.rot, danach in den Rahmen verschoben
    const at = x.rot === 90 ? { x: ox, y: oy + x.width * s } : x.rot === 180 ? { x: ox + x.width * s, y: oy + x.height * s } : x.rot === 270 ? { x: ox + x.height * s, y: oy } : { x: ox, y: oy };
    page.drawPage(emb, { ...at, xScale: s, yScale: s, rotate: degrees(-x.rot) });
  }
  out.setProducer("Unterricks"); out.setCreator("Unterricks");
  return { bytes: await out.save(), changed, total };
}
