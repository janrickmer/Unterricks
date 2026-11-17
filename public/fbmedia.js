// fbmedia.js – Bilder und PDF-Dateien eines Feibeitsblatt-Entwurfs (Nachtrag 37) aus der Sitzung ins Feibeitsblatt übertragen.
// Claude verweist mit propose_feibeitsblatt auf Dateien DIESER Sitzung (images {file, mode, alt}, files {file} je Aufgabe; YouTube-Videos gehen mit dem Blatt,
// siehe fbclient.createSheet). Beim Anlegen: erst alles vorbereiten (Bytes holen, Bilder verkleinern wie das Feibeitsblatt, PDF prüfen) – ein Fehler hier legt
// noch kein Blatt an –, dann das Blatt anlegen, dann übertragen, nacheinander (die Reihenfolge je Aufgabe ist die des Entwurfs). Die Kennungen im Feibeitsblatt
// hängen nur an Blatt, Aufgabe, Art und Datei: „Erneut versuchen“ legt nichts doppelt an (das Feibeitsblatt antwortet mit existing).
import { FB_MEDIA } from "./shared.js";

// wie im Feibeitsblatt: IMG_MAX_SIDE, IMG_MAX_BYTES (LIMITS.imageBytes), sheetImageBytes und LIMITS.fileChunk; Eingangsbilder höchstens 40 MB (prepareImage)
export const FB_IMAGE = { maxSide: 1600, maxBytes: 500 * 1024, sheetBytes: 12 * 1024 * 1024, inputMax: 40 * 1024 * 1024 };
export const FB_CHUNK = 512 * 1024;
const AREAS_OK = new Set(["student", "teacher", "print"]);
export const isImageFile = (f) => !!f && f.kind === "file" && !f.design && /^image\//.test(String(f.mime || ""));
export const isPdfFile = (f) => !!f && f.kind === "file" && (!!f.design || f.mime === "application/pdf");
// von Claude gestaltet und (noch) nicht zur aktuellen Gestaltung gedruckt
export const pdfPending = (f) => !!(f && f.design && (f.design.outdated || f.status !== "ready"));

/* Warum eine Datei so nicht ins Feibeitsblatt kann ("" = in Ordnung) – im Entwurf unter der Datei und vor dem Anlegen */
export function problemOf(kind, f) {
  if (!f || f.area === "archive") return "Diese Datei gibt es in der Sitzung nicht mehr.";
  if (f.kind !== "file" || !AREAS_OK.has(f.area) || f.cards || f.notesOf || f.source === "notfall") return "Diese Datei lässt sich nicht ins Feibeitsblatt übernehmen.";
  if (kind === "image") return isImageFile(f) ? "" : "Das ist kein Bild.";
  if (!isPdfFile(f)) return "Das ist keine PDF-Datei.";
  if (pdfPending(f)) return f.design.error ? "Der Druck als PDF ist fehlgeschlagen – bitte beim Material „Erneut drucken“." : "Wird noch als PDF gedruckt – bitte einen Moment warten.";
  if ((f.size || 0) > FB_MEDIA.fileBytes) return "Zu groß für das Feibeitsblatt (höchstens 6 MB je PDF-Datei).";
  return "";
}

/* Bilder und PDF-Dateien des Entwurfs mit den Dateien der Sitzung → [{task (1-basiert), kind: "image"|"file", ref, file, problem}] */
export function mediaItems(tasks, files) {
  const byId = new Map((files || []).map((f) => [f.id, f])), out = [];
  (tasks || []).forEach((t, i) => {
    for (const ref of t.images || []) { const file = byId.get(ref.file) || null; out.push({ task: i + 1, kind: "image", ref, file, problem: problemOf("image", file) }); }
    for (const ref of t.files || []) { const file = byId.get(ref.file) || null; out.push({ task: i + 1, kind: "file", ref, file, problem: problemOf("file", file) }); }
  });
  return out;
}
export const itemName = (x) => (x.file ? x.file.name : x.kind === "image" ? "Bild" : "PDF-Datei");

/* Kennung im Feibeitsblatt (16 Hex) aus Blatt, Aufgabe, Art und Datei – dieselbe Datei steht je Aufgabe nur einmal im Entwurf (fbTaskMedia) */
export async function uploadIdOf(code, task, kind, fileId) {
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("unterricks|" + code + "|" + task + "|" + kind + "|" + fileId));
  return Array.from(new Uint8Array(h).slice(0, 8), (x) => x.toString(16).padStart(2, "0")).join("");
}
export function b64Of(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
export const chunksOf = (bytes) => Math.max(1, Math.ceil(bytes / FB_CHUNK));
// Teil n einer PDF-Datei: alle außer dem letzten genau FB_CHUNK Bytes (so verlangt es das Feibeitsblatt)
export const partOf = (u8, n) => u8.subarray(n * FB_CHUNK, Math.min(u8.length, (n + 1) * FB_CHUNK));
export const isPdfBytes = (u8) => u8.length > 5 && u8[0] === 0x25 && u8[1] === 0x50 && u8[2] === 0x44 && u8[3] === 0x46 && u8[4] === 0x2d;   // „%PDF-“

/* ---------- Bilder verkleinern (wie prepareImage im Feibeitsblatt) ---------- */
async function decodeImage(blob) {
  if (typeof createImageBitmap === "function" && !/svg/i.test(blob.type)) { try { return await createImageBitmap(blob, { imageOrientation: "from-image" }); } catch { /* <img> versuchen */ } }
  const url = URL.createObjectURL(blob), img = new Image();
  try { img.src = url; await img.decode(); img._url = url; return img; } catch (e) { URL.revokeObjectURL(url); throw e; }
}
/* längste Seite 1600 px (notfalls 1200/900), weiß hinterlegt, Grafiken zuerst als PNG, sonst JPEG mit sinkender Qualität bis ≤ 500 KB → {data (Base64), w, h, bytes} */
export async function prepareImage(blob, name) {
  if (blob.size > FB_IMAGE.inputMax) throw new Error("Das Bild „" + name + "“ ist zu groß (höchstens 40 MB).");
  let src;
  try { src = await decodeImage(blob); } catch { throw new Error("Das Bild „" + name + "“ kann dieser Browser nicht lesen (z. B. HEIC) – bitte als JPG oder PNG in die Sitzung laden."); }
  try {
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    if (!(sw > 0 && sh > 0)) throw new Error("Das Bild „" + name + "“ kann dieser Browser nicht lesen.");
    const graphic = /png|gif|bmp|svg/i.test(blob.type) || /\.(png|gif|bmp|svg)$/i.test(name), side = FB_IMAGE.maxSide;
    const tries = (graphic ? [[side, "image/png"]] : []).concat([[side, "image/jpeg", 0.85], [side, "image/jpeg", 0.7], [1200, "image/jpeg", 0.7], [900, "image/jpeg", 0.6]]);
    for (const [maxSide, type, q] of tries) {
      const scale = Math.min(1, maxSide / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * scale)), hh = Math.max(1, Math.round(sh * scale));
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = hh;
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, hh);
      ctx.drawImage(src, 0, 0, w, hh);
      const out = await new Promise((res) => cv.toBlob(res, type, q));
      if (out && out.size <= FB_IMAGE.maxBytes) return { data: b64Of(new Uint8Array(await out.arrayBuffer())), w, h: hh, bytes: out.size };
    }
    throw new Error("Das Bild „" + name + "“ lässt sich nicht klein genug verkleinern (höchstens 500 KB).");
  } finally {
    if (src.close) { try { src.close(); } catch { /* egal */ } }
    if (src._url) URL.revokeObjectURL(src._url);
  }
}

/* ---------- Vorbereiten (vor dem Anlegen) und Übertragen (danach) ---------- */
/* items aus mediaItems; blobOf(file) → Blob der Datei der Sitzung. Wirft mit einer Meldung für die Lehrkraft – dann wird kein Blatt angelegt. */
export async function prepareMedia(items, { blobOf, onStep = () => {} } = {}) {
  const bad = items.filter((x) => x.problem);
  if (bad.length) throw new Error("So lässt sich das Feibeitsblatt noch nicht anlegen: " + bad.map((x) => "„" + itemName(x) + "“ (Aufgabe " + x.task + "): " + x.problem).join(" "));
  const out = [];
  let imgBytes = 0, pdfBytes = 0;
  for (const [k, x] of items.entries()) {
    onStep("Bereite " + (k + 1) + " von " + items.length + " vor: „" + x.file.name + "“ …");
    const blob = await blobOf(x.file);
    if (x.kind === "image") {
      const prep = await prepareImage(blob, x.file.name);
      imgBytes += prep.bytes;
      out.push({ ...x, prep });
    } else {
      const u8 = new Uint8Array(await blob.arrayBuffer());
      if (!isPdfBytes(u8)) throw new Error("„" + x.file.name + "“ ist keine lesbare PDF-Datei.");
      if (u8.length > FB_MEDIA.fileBytes) throw new Error("„" + x.file.name + "“ ist zu groß für das Feibeitsblatt (höchstens 6 MB je PDF-Datei).");
      pdfBytes += u8.length;
      out.push({ ...x, prep: { u8, bytes: u8.length } });
    }
  }
  if (imgBytes > FB_IMAGE.sheetBytes) throw new Error("Die Bilder sind zusammen zu groß für ein Feibeitsblatt (höchstens 12 MB nach dem Verkleinern) – bitte im Entwurf einige entfernen.");
  if (pdfBytes > FB_MEDIA.sheetFileBytes) throw new Error("Die PDF-Dateien sind zusammen zu groß für ein Feibeitsblatt (höchstens 20 MB) – bitte im Entwurf einige entfernen.");
  return out;
}
/* Nacheinander ins Feibeitsblatt (fb: FbClient mit uploadImage/uploadFilePart). Fehler je Datei gesammelt – nie ein Abbruch des Ganzen.
   Eine PDF-Datei macht bei einer Wiederholung mit dem Teil weiter, der fehlte (x.next); kam sie unvollständig an, beginnt sie neu. → {done, failed: [{item, error}]} */
export async function uploadMedia(fb, code, prepared, { onStep = () => {} } = {}) {
  const failed = [];
  let done = 0;
  for (const [k, x] of prepared.entries()) {
    const head = "Übertrage " + (k + 1) + " von " + prepared.length + ": „" + x.file.name + "“";
    try {
      const id = await uploadIdOf(code, x.task, x.kind, x.file.id);
      if (x.kind === "image") {
        onStep(head + " …");
        await fb.uploadImage(code, { id, task: x.task, mode: x.ref.mode === "thumb" ? "thumb" : "inline", alt: x.ref.alt || "", data: x.prep.data });
      } else {
        const chunks = chunksOf(x.prep.bytes);
        for (let n = x.next || 0; n < chunks; n++) {
          onStep(head + (chunks > 1 ? " (Teil " + (n + 1) + " von " + chunks + ")" : "") + " …");
          const r = await fb.uploadFilePart(code, { id, task: x.task, name: x.file.name, bytes: x.prep.bytes, chunks, n, data: b64Of(partOf(x.prep.u8, n)) });
          x.next = n + 1;
          if (n === chunks - 1 && r && r.file && r.file.complete === false) { x.next = 0; throw new Error("Die Datei kam nicht vollständig an."); }
        }
      }
      x.done = true; done++;
    } catch (e) { failed.push({ item: x, error: (e && e.message) || String(e) }); }
  }
  return { done, failed };
}
