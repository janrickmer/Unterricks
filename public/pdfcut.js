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
   Kopieren entfernt würde, stünde als verwaistes Objekt trotzdem in der Datei). Es bleiben nur Link-Anmerkungen; von der Seite selbst nur die
   Einträge in PAGE_KEEP – /AF (zugeordnete Dateien), /Metadata, /PieceInfo, /AA, /Thumb und eigene Schlüssel entfallen (Prüfung der
   Datenschutzgarantie: dort könnten Notizen stehen, und pdf-lib kopiert sonst jeden Eintrag der Seite mit).
   lib = pdf-lib (PDFName, PDFArray, PDFDict) */
export const PAGE_KEEP = new Set(["Type", "Parent", "Resources", "MediaBox", "CropBox", "BleedBox", "TrimBox", "ArtBox", "Rotate", "Contents", "Annots", "Group", "Tabs",
  "UserUnit", "Trans", "Dur", "BoxColorInfo"]);
export function stripPage(page, lib) {
  const { PDFName, PDFArray, PDFDict } = lib, node = page.node, ctx = node.context;
  const N = (k) => PDFName.of(k), safe = (f) => { try { return f(); } catch { return undefined; } };
  for (const k of node.keys()) if (!PAGE_KEEP.has(k.asString().slice(1))) node.delete(k);
  const annots = safe(() => node.lookupMaybe(N("Annots"), PDFArray));
  if (!annots) { node.delete(N("Annots")); return; }
  const keep = [];
  for (let i = 0; i < annots.size(); i++) {
    const ref = annots.get(i), a = safe(() => ctx.lookupMaybe(ref, PDFDict));
    const sub = a && safe(() => a.lookupMaybe(N("Subtype"), PDFName));
    if (sub && sub.asString() === "/Link") {
      for (const k of ["AF", "Popup", "IRT", "P"]) a.delete(N(k));
      keep.push(ref);
    }
  }
  if (keep.length) node.set(PDFName.of("Annots"), ctx.obj(keep)); else node.delete(PDFName.of("Annots"));
}

/* Seiten idx von src nach out kopieren, ohne dass andere Seiten mitkommen: pdf-lib kopiert alles, was eine Seite erreicht – ein Link auf eine
   andere Folie (Inhaltsverzeichnis, „zurück zur Übersicht“) brächte deren Seite samt Inhalt und Anmerkungen als verwaistes Objekt mit (bei
   „Bis hier gezeigt“ also spätere Folien und ihre Notizen). Deshalb zeigen Verweise auf kopierte Seiten auf ihre Kopie, Verweise auf alle
   übrigen Seiten auf ein leeres Objekt (der Link führt dann ins Leere). Ausgeblendete Ebenen (/OCProperties) bleiben ausgeblendet – ohne sie
   zeigte die Kopie verborgenen Inhalt. lib = pdf-lib (PDFObjectCopier, PDFPage, PDFName, PDFNull) → kopierte Seiten in der Reihenfolge von idx */
export function copyPagesSafe(out, src, idx, lib) {
  const { PDFObjectCopier, PDFPage, PDFName, PDFNull } = lib;
  const copier = PDFObjectCopier.for(src.context, out.context), pages = src.getPages(), mapped = new Map(), nowhere = out.context.nextRef();
  out.context.assign(nowhere, PDFNull);
  for (const i of idx) mapped.set(pages[i].ref, out.context.nextRef());
  for (const p of pages) copier.traversedObjects.set(p.ref, mapped.get(p.ref) || nowhere);
  const copied = idx.map((i) => {
    const ref = mapped.get(pages[i].ref), node = copier.copy(pages[i].node);
    out.context.assign(ref, node);
    return PDFPage.of(node, ref, out);
  });
  const oc = src.catalog.get(PDFName.of("OCProperties"));
  if (oc) { try { out.catalog.set(PDFName.of("OCProperties"), copier.copy(oc)); } catch {} }
  return copied;
}

/* Wo außer dem Dateianhang Notizen stecken könnten (Prüfung der Datenschutzgarantie, Nachtrag 20): trifft eines zu, bekommen Schüler:innen nur die
   bereinigte Fassung – auch wenn die KI die Notizen entgegen dem Prompt nicht als unterricks-notizen.json eingebettet hat. Sucht im ganzen Objektbestand
   (auch in Objekt-Streams und in Objekten, die keine Seite mehr erreicht): eingebettete Dateien, Anmerkungen außer Links (Kommentar, Rechteck,
   Freitext, Formularfeld …), ungewöhnliche Seiteneinträge, XMP-Metadaten bzw. Dokumenteigenschaften mit Notiz-Wörtern oder viel Text, eigene
   Schlüssel der Dokumenteigenschaften. Lieber einmal zu oft bereinigt (die Kopie zeigt dieselben Seiten) als Notizen bei Schüler:innen.
   src = von pdf-lib geladenes Dokument, lib = pdf-lib → Liste der Gründe (leer = nichts gefunden) */
const PAGE_USUAL = new Set([...PAGE_KEEP, "StructParents", "Thumb", "LastModified"]);   // gängig (PowerPoint, Keynote, Acrobat), ohne Text
const INFO_KEYS = new Set(["Title", "Author", "Subject", "Keywords", "Creator", "Producer", "CreationDate", "ModDate", "Trapped"]);
const NOTE_WORDS = /notiz|anmerkung|sprecher|speaker|lehrkraft/i;
// viel Text oder Notiz-Wörter (Dokumenteigenschaften höchstens max Zeichen, XMP ohne Tags höchstens 1500)
export const noteLike = (text, max) => { const t = String(text || ""); return t.length > max || NOTE_WORDS.test(t); };
export function pdfCarriers(src, lib) {
  const { PDFName, PDFDict, PDFArray, PDFRawStream, PDFString, PDFHexString, decodePDFRawStream } = lib;
  const N = (k) => PDFName.of(k), why = new Set(), safe = (f) => { try { return f(); } catch { return undefined; } };
  const nm = (v) => (v instanceof PDFName ? v.asString().slice(1) : "");
  const txt = (v) => (v instanceof PDFString || v instanceof PDFHexString ? safe(() => v.decodeText()) || "" : "");
  const cat = src.catalog, names = safe(() => cat.lookupMaybe(N("Names"), PDFDict));
  if (cat.has(N("AF")) || (names && names.has(N("EmbeddedFiles")))) why.add("Dateianhang");
  const annot = (d) => { const sub = nm(safe(() => d.lookup(N("Subtype")))); if (sub !== "Link") why.add("Anmerkung " + (sub || "ohne Typ")); };
  for (const [, obj] of src.context.enumerateIndirectObjects()) {
    const d = obj instanceof PDFDict ? obj : obj && obj.dict instanceof PDFDict ? obj.dict : null;
    if (!d) continue;
    const type = nm(d.get(N("Type")));
    if (type === "EmbeddedFile" || d.has(N("EF")) || d.has(N("RF"))) why.add("Dateianhang");
    if (type === "Annot" || (d.has(N("Subtype")) && d.has(N("Rect")))) annot(d);
    if (type === "Metadata") {
      if (!(obj instanceof PDFRawStream) || obj.contents.length > 4 * 1024 * 1024) { why.add("XMP-Metadaten"); continue; }
      const x = safe(() => new TextDecoder("utf-8").decode(decodePDFRawStream(obj).decode()));
      if (x === undefined || noteLike(x.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(), 1500)) why.add("XMP-Metadaten");
    }
  }
  for (const p of src.getPages()) {
    for (const k of p.node.keys()) if (!PAGE_USUAL.has(nm(k))) why.add("Seiteneintrag /" + nm(k));
    const an = safe(() => p.node.lookupMaybe(N("Annots"), PDFArray));
    for (let i = 0; an && i < an.size(); i++) { const a = safe(() => p.node.context.lookupMaybe(an.get(i), PDFDict)); if (a) annot(a); }
  }
  const info = safe(() => src.context.lookup(src.context.trailerInfo.Info));
  if (info instanceof PDFDict) for (const [k, v] of info.entries()) {
    const key = nm(k);
    if (!INFO_KEYS.has(key)) why.add("Dokumenteigenschaft /" + key);
    else if (/^(Title|Author|Subject|Keywords)$/.test(key) && noteLike(txt(v), 300)) why.add("Dokumenteigenschaft /" + key);
  }
  return [...why];
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
  const out = await PDFDocument.create(), idx = Array.from({ length: n }, (_, i) => i);
  // mit pdf-lib (opt.lib): ohne mitkopierte spätere Seiten (copyPagesSafe); sonst wie bisher
  for (const p of opt.lib ? copyPagesSafe(out, src, idx, opt.lib) : await out.copyPages(src, idx)) out.addPage(p);
  try { const t = src.getTitle(); if (t && !noteLike(t, 200)) out.setTitle(t); } catch {}   // der Titel nur, wenn er keine Notizen tragen kann
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
