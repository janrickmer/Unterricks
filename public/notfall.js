// notfall.js – Notfall-Feibeitsblatt: das analoge Arbeitsblatt eines Feibeitsblatts, genau wie im Feibeitsblatt („Analoges Arbeitsblatt
// als PDF herunterladen“, Code unverändert übernommen in fbanalog.js). Erzeugt im Browser der Lehrkraft (Verbindung zum Feibeitsblatt
// nötig: Blatt und Checkliste über die Lehrkraft-Schnittstelle, Bilder über die öffentliche) und als Material für die Schüler:innen
// abgelegt. Nie Aufträge an die KI, Abgaben oder Checklistenpunkte – nur, was auch auf dem gedruckten Arbeitsblatt steht.
import { makeAnalogPdf, pdfJpeg, cleanImages, cleanAnswer, checkUrlOf, setFeibeitsblattUrl } from "./fbanalog.js";

export const NOTFALL_VERSION = 1;
// Stand der PDF: ändert er sich (Checkliste bestätigt → QR-Code; KI-Dienst eingerichtet → Satz zur KI-Rückmeldung), wird sie erneuert
export const notfallSig = (hasPoints, aiNote) => "v" + NOTFALL_VERSION + (hasPoints ? "-qr" : "") + (aiNote ? "-ki" : "");

/* Blatt und Checkliste lesen (ohne Bilder): {escape: true} beim Finale eines Escape-Rooms, sonst {sheet, hasPoints, aiNote, sig} */
export async function notfallInfo(fb, code) {
  const [s, ck] = await Promise.all([fb.getSheet(code), fb.checklistGet(code)]);
  const sheet = (s && s.sheet) || {};
  if (sheet.escape) return { escape: true };
  const fin = ck && ck.checklist && ck.checklist.final;
  const hasPoints = !!(fin && (fin.tasks || []).some((t) => t && Array.isArray(t.points) && t.points.length));
  const aiNote = !!ck && ck.aiFeedback !== false && ck.aiReady !== false;   // wie im Feibeitsblatt (openAnalog)
  return { sheet, hasPoints, aiNote, sig: notfallSig(hasPoints, aiNote) };
}

const b64ToBlob = (data, mime) => { const bin = atob(String(data || "")); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); };

/* PDF-Bytes des Notfall-Feibeitsblatts; fehlt ein Bild, bricht sie ab (nie ein unvollständiges Arbeitsblatt) */
export async function buildNotfallPdf(fb, code, info, fbUrl, onStep) {
  setFeibeitsblattUrl(fbUrl);
  const shows = new Map(), tasks = Array.isArray(info.sheet.tasks) ? info.sheet.tasks : [];
  for (const [i, t] of tasks.entries()) {
    const spec = cleanAnswer(t.answer, true), used = new Set(spec.type === "map" ? spec.items.map((it) => it.image).filter(Boolean) : []);
    const metas = cleanImages(t.images).concat(cleanImages(t.images, true).filter((m) => used.has(m.id)));
    for (const m of metas) {
      if (onStep) onStep("Bild zu Aufgabe " + (i + 1) + " wird geladen …");
      let r = null;
      try { r = await fb.image(code, m.id); } catch {}
      if (!r || !/^image\/(jpeg|png|webp)$/.test(String(r.mime)) || typeof r.data !== "string") throw new Error("Ein Bild zu Aufgabe " + (i + 1) + " konnte nicht geladen werden.");
      shows.set(m.id, await pdfJpeg(b64ToBlob(r.data, r.mime)));
    }
  }
  return makeAnalogPdf({ code, title: info.sheet.title || "", tasks, shows, aiNote: info.aiNote, checkUrl: info.hasPoints ? checkUrlOf(code) : "" });
}
