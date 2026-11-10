// pdfcut.js – Präsentation bis zur letzten im Unterricht gezeigten Folie kürzen (Wunsch der Lehrkraft vom 10.11.2026): Schüler:innen
// bekommen nach der Freigabe nur Folie 1 bis zur Markierung – so sehen sie keine Folien, die für die nächste Sitzung gedacht sind oder
// Musterlösungen enthalten. Gekürzt wird im Browser der Lehrkraft mit pdf-lib (Seiten unverändert kopiert, Text bleibt Text).
import { api, apiUrl } from "./ui.js";

let libP = null;
const pdfLib = () => (libP ||= import("/vendor/pdf-lib.esm.min.js"));

/* PDF-Bytes → neue PDF mit den Seiten 1..n (PDFDocument von pdf-lib wird übergeben, damit es auch im Test läuft) */
export async function cutPdfBytes(bytes, n, PDFDocument) {
  let src;
  try { src = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) {
    throw new Error("Diese PDF lässt sich im Browser nicht kürzen" + (/encrypt/i.test(String(e && e.message)) ? " (sie ist geschützt)" : "") +
      ". Bitte die Präsentation ohne Kennwortschutz als PDF exportieren und erneut hochladen.");
  }
  const total = src.getPageCount();
  if (!Number.isInteger(n) || n < 1 || n >= total) throw new Error("Bitte eine Folie zwischen 1 und " + (total - 1) + " wählen.");
  const out = await PDFDocument.create();
  for (const p of await out.copyPages(src, Array.from({ length: n }, (_, i) => i))) out.addPage(p);
  try { const t = src.getTitle(); if (t) out.setTitle(t); } catch {}
  out.setProducer("Unterricks"); out.setCreator("Unterricks");
  return out.save();
}

/* Letzte gezeigte Folie setzen (n) oder aufheben (null): lädt die vollständige PDF, kürzt sie und lädt die gekürzte hoch */
export async function markShown(file, n, token, onStep) {
  if (!n || n >= file.pages) return api("DELETE", "/api/teacher/files/" + file.id + "/shown", { token });
  if (onStep) onStep("Präsentation wird geladen …");
  const l = await api("POST", "/api/teacher/files/" + file.id + "/link", { token, body: {} });
  const res = await fetch(apiUrl(l.url), { credentials: "omit", cache: "no-store" });
  if (!res.ok) throw new Error("Die Präsentation ließ sich nicht laden (Fehler " + res.status + ").");
  if (onStep) onStep("Folie 1–" + n + " werden zusammengestellt …");
  const { PDFDocument } = await pdfLib();
  const cut = await cutPdfBytes(new Uint8Array(await res.arrayBuffer()), n, PDFDocument);
  if (onStep) onStep("Gekürzte Präsentation wird gespeichert …");
  return api("PUT", "/api/teacher/files/" + file.id + "/shown?until=" + n, { token, raw: new Blob([cut], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" } });
}
