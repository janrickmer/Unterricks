// pdfcut.js – Präsentation bis zur letzten im Unterricht gezeigten Folie kürzen (Wunsch der Lehrkraft vom 10.11.2026): Schüler:innen
// bekommen nach der Freigabe nur Folie 1 bis zur Markierung – so sehen sie keine Folien, die für die nächste Sitzung gedacht sind oder
// Musterlösungen enthalten. Gekürzt wird im Browser der Lehrkraft mit pdf-lib (Seiten unverändert kopiert, Text bleibt Text).
// Nachtrag 20: Trägt die Präsentation Notizen der Lehrkraft (Dateianhang unterricks-notizen.json) bzw. Notiz-Anmerkungen, bekommen Schüler:innen
// nur eine bereinigte Kopie (cleanPdfBytes): neue PDF mit den Seiten, ohne Dateianhänge (EmbeddedFiles, /AF) und ohne Anmerkungen außer Links.
import { api, apiUrl } from "./ui.js";

let libP = null;
export const pdfLib = () => (libP ||= import("/vendor/pdf-lib.esm.min.js"));

const loadErr = (e, what) => new Error("Diese PDF lässt sich im Browser nicht " + what + (/encrypt/i.test(String(e && e.message)) ? " (sie ist geschützt)" : "") +
  ". Bitte die Präsentation ohne Kennwortschutz als PDF exportieren und erneut hochladen.");

/* Seite für Schüler:innen bereinigen – an der QUELLE vor dem Kopieren: pdf-lib kopiert nur, was die Seite noch erreicht (was erst nach dem
   Kopieren entfernt würde, stünde als verwaistes Objekt trotzdem in der Datei). Es bleiben nur Link-Anmerkungen; /AF (zugeordnete Dateien) entfällt.
   lib = pdf-lib (PDFName, PDFArray, PDFDict) */
export function stripPage(page, lib) {
  const { PDFName, PDFArray, PDFDict } = lib, node = page.node, ctx = node.context;
  const N = (k) => PDFName.of(k), safe = (f) => { try { return f(); } catch { return undefined; } };
  node.delete(N("AF"));
  const annots = safe(() => node.lookupMaybe(N("Annots"), PDFArray));
  if (!annots) { node.delete(N("Annots")); return; }
  const keep = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i), a = safe(() => ctx.lookupMaybe(ref, PDFDict));
    const sub = a && safe(() => a.lookupMaybe(N("Subtype"), PDFName));
    if (sub && sub.asString() === "/Link") {
      for (const k of ["AF", "Popup", "IRT"]) a.delete(N(k));
      keep.push(ref);
    }
  }
  if (keep.length) node.set(PDFName.of("Annots"), ctx.obj(keep)); else node.delete(PDFName.of("Annots"));
}

/* PDF-Bytes → neue PDF mit den Seiten 1..n (PDFDocument von pdf-lib wird übergeben, damit es auch im Test läuft).
   opt.clean (Nachtrag 20): bereinigt (stripPage), opt.lib = übrige Klassen von pdf-lib dafür */
export async function cutPdfBytes(bytes, n, PDFDocument, opt = {}) {
  let src;
  try { src = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { throw loadErr(e, "kürzen"); }
  const total = src.getPageCount();
  if (!Number.isInteger(n) || n < 1 || n >= total) throw new Error("Bitte eine Folie zwischen 1 und " + (total - 1) + " wählen.");
  return copyOut(src, n, PDFDocument, opt);
}
async function copyOut(src, n, PDFDocument, opt) {
  if (opt.clean) for (const p of src.getPages().slice(0, n)) stripPage(p, opt.lib);
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, Array.from({ length: n }, (_, i) => i))) out.addPage(p);
  try { const t = src.getTitle(); if (t) out.setTitle(t); } catch {}
  out.setProducer("Unterricks"); out.setCreator("Unterricks");
  return out.save();
}
/* Fassung für Schüler:innen: alle Seiten, bereinigt (lib = ganzes Modul pdf-lib) */
export async function cleanPdfBytes(bytes, lib) {
  let src;
  try { src = await lib.PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { throw loadErr(e, "für Schüler:innen vorbereiten"); }
  return copyOut(src, src.getPageCount(), lib.PDFDocument, { clean: true, lib });
}

/* Letzte gezeigte Folie setzen (n) oder aufheben (null): lädt die vollständige PDF, kürzt sie und lädt die gekürzte hoch – trägt die Präsentation
   Notizen (file.cleanNeeded), bereinigt */
export async function markShown(file, n, token, onStep) {
  if (!n || n >= file.pages) return api("DELETE", "/api/teacher/files/" + file.id + "/shown", { token });
  if (onStep) onStep("Präsentation wird geladen …");
  const l = await api("POST", "/api/teacher/files/" + file.id + "/link", { token, body: {} });
  const res = await fetch(apiUrl(l.url), { credentials: "omit", cache: "no-store" });
  if (!res.ok) throw new Error("Die Präsentation ließ sich nicht laden (Fehler " + res.status + ").");
  if (onStep) onStep("Folie 1–" + n + " werden zusammengestellt …");
  const lib = await pdfLib(), clean = !!file.cleanNeeded;
  const cut = await cutPdfBytes(new Uint8Array(await res.arrayBuffer()), n, lib.PDFDocument, { clean, lib });
  if (onStep) onStep("Gekürzte Präsentation wird gespeichert …");
  return api("PUT", "/api/teacher/files/" + file.id + "/shown?until=" + n + (clean ? "&clean=1" : ""), { token, raw: new Blob([cut], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } });
}
/* Fassung für Schüler:innen (erneut) erzeugen und hochladen: bytes = hochgeladene PDF (sonst über den Link der Lehrkraft geladen) */
export async function uploadClean(file, token, bytes = null) {
  if (!bytes) {
    const l = await api("POST", "/api/teacher/files/" + file.id + "/link", { token, body: {} });
    const res = await fetch(apiUrl(l.url), { credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error("Die Präsentation ließ sich nicht laden (Fehler " + res.status + ").");
    bytes = new Uint8Array(await res.arrayBuffer());
  }
  const out = await cleanPdfBytes(bytes, await pdfLib());
  const r = await api("PUT", "/api/teacher/files/" + file.id + "/clean", { token, raw: new Blob([out], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } });
  return { file: r.file, bytes: out };
}
