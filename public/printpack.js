// printpack.js – Sitzungspaket (Nachtrag 42 vom 23.11.2026): die PDF-Dateien eines Pakets (shared.js printPacks – gleiche Anzahl, Farbe und Druckart in
// einer Sitzung) im Browser zu EINER PDF zusammenfügen, in der Reihenfolge des Verlaufsplans. Nur im Browser (pdf-lib, erst bei Bedarf geladen; der Worker hat
// keine PDF-Bibliothek und 10 ms CPU). Beidseitig: Jedes Material beginnt auf einem neuen Blatt (nach einem Material mit ungerader Seitenzahl eine Leerseite,
// die Datei endet mit einer geraden Seitenzahl – auch die nächste Kopie beginnt auf einem neuen Blatt). Was noch nicht fertig gedruckt ist oder sich nicht
// lesen lässt, bleibt draußen und wird genannt; sind es weniger als zwei Materialien, gibt es kein Paket – das eine fertige kommt einzeln.
// Genutzt von der Druckliste der Sitzung (materialbox.js, auch für „Alle Unterlagen dieser Sitzung“ und die kompakte Ansicht) und den „Druckaufträgen …“
// der Startseiten (printnext.js).
import { printReady, PACK_MIN, PACK_TITLE } from "./shared.js";

export const PACK_HINT = "Materialien mit gleicher Anzahl, gleicher Farbe und gleicher Druckart (einseitig/beidseitig) fasst Unterricks zu einem " + PACK_TITLE +
  " zusammen: eine PDF-Datei in der Reihenfolge des Verlaufsplans, also ein Druckauftrag statt vieler – beim beidseitigen Druck beginnt jedes Material auf einem " +
  "neuen Blatt. Die einzelnen Dateien stehen klein darunter: Ändern Sie dort Anzahl oder Druckart, kommt die Datei aus dem Paket bzw. in ein anderes.";

/* Betreff der Paket-PDF (Dokumenteigenschaften): welche Datei auf welchen Seiten steht – „Sitzungspaket: Teil 1 „…“ (Seite 1–3); Teil 2 „…“ (Seite 5)“
   (Leerseiten zählen nicht zu einem Teil). ranges = [{name, from, to}] */
export const packSubject = (ranges) => PACK_TITLE + ": " + ranges.map((r, i) => "Teil " + (i + 1) + " „" + r.name + "“ (Seite " + r.from + (r.to > r.from ? "–" + r.to : "") + ")").join("; ");
/* parts = [{data: Uint8Array, name?, …}] in der Reihenfolge des Pakets; lib = pdf-lib → {bytes (null bei weniger als zwei lesbaren), pages, blanks, used: [part],
   bad: [{part, error}]} */
export async function mergePrintPack(parts, lib, { duplex = false, title = PACK_TITLE } = {}) {
  const { PDFDocument } = lib;
  const docs = [], bad = [];
  for (const part of parts) {
    try {
      const d = await PDFDocument.load(part.data, { updateMetadata: false });
      const n = d.getPageCount();
      if (!n) throw new Error("Die PDF-Datei hat keine Seite.");
      docs.push({ part, d, n });
    } catch (e) { bad.push({ part, error: e }); }
  }
  const used = docs.map((x) => x.part);
  if (docs.length < PACK_MIN) return { bytes: null, pages: 0, blanks: 0, used, bad };
  const out = await PDFDocument.create();
  let blanks = 0;
  const ranges = [];
  for (const { part, d, n } of docs) {
    const pages = await out.copyPages(d, d.getPageIndices()), from = out.getPageCount() + 1;
    for (const p of pages) out.addPage(p);
    ranges.push({ name: String(part.name || "Datei"), from, to: from + n - 1 });
    // beidseitig: das nächste Material (bzw. die nächste Kopie) beginnt auf einem neuen Blatt – Leerseite im Format der letzten Seite
    if (duplex && n % 2) { const { width, height } = pages[pages.length - 1].getSize(); out.addPage([width, height]); blanks++; }
  }
  try { out.setTitle(title); out.setSubject(packSubject(ranges)); out.setProducer("Unterricks"); out.setCreator("Unterricks"); } catch {}
  return { bytes: await out.save(), pages: out.getPageCount(), blanks, used, bad };
}

/* Pakete aus den schon geladenen Dateien bilden („Alle herunterladen (ZIP)“, „Alle Dateien herunterladen“, „Alle Unterlagen dieser Sitzung“): entries =
   [{f, name, data}] (fertige Dateien), packs = printPacks(…).packs, lib = () → pdf-lib (erst geladen, wenn ein Paket mindestens zwei fertige Dateien hat).
   → {entries: [Pakete zuerst {pack, name, data, pages, blanks, parts: [{f, name}]}, dann die übrigen Dateien unverändert], info: [{pack, made, parts, bad,
   missing}]} – missing = Dateien des Pakets ohne fertige PDF (stehen schon in den Hinweisen der Aufrufer), bad = nicht lesbare (liegen einzeln dabei) */
export async function packEntries(entries, packs, lib) {
  const byId = new Map(entries.map((e) => [e.f.id, e]));
  const done = new Set(), made = [], info = [];
  let L = null;
  for (const pack of packs || []) {
    const parts = pack.files.map((f) => byId.get(f.id)).filter(Boolean), missing = pack.files.filter((f) => !byId.has(f.id));
    if (parts.length < PACK_MIN) { info.push({ pack, made: false, parts, bad: [], missing }); continue; }
    if (!L) L = await lib();
    const m = await mergePrintPack(parts, L, { duplex: pack.print.duplex, title: pack.name });
    if (!m.bytes) { info.push({ pack, made: false, parts: m.used, bad: m.bad.map((x) => x.part), missing }); continue; }
    for (const p of m.used) done.add(p.f.id);
    made.push({ pack, name: pack.name, data: m.bytes, pages: m.pages, blanks: m.blanks, parts: m.used.map((p) => ({ f: p.f, name: p.name })) });
    info.push({ pack, made: true, parts: m.used, bad: m.bad.map((x) => x.part), missing });
  }
  return { entries: [...made, ...entries.filter((e) => !done.has(e.f.id))], info };
}

/* Hinweise zu den Paketen (where = „in der ZIP-Datei“ bzw. „im Ordner „Zum Ausdrucken““): nicht lesbare Dateien und Pakete, von denen erst eine Datei fertig
   ist – noch nicht gedruckte nennen die Aufrufer schon selbst */
export function packNotes(info, where) {
  const out = [];
  for (const x of info || []) {
    for (const b of x.bad) out.push("„" + b.name + "“ ließ sich nicht in das " + PACK_TITLE + " „" + x.pack.name + "“ einfügen (die PDF-Datei ist im Browser nicht lesbar) – sie liegt einzeln " + where + ".");
    if (!x.made && x.parts.length === 1 && !x.bad.length && x.missing.some((f) => !printReady(f))) out.push("Vom " + PACK_TITLE + " „" + x.pack.name + "“ ist bisher nur „" + x.parts[0].name + "“ fertig – sie liegt einzeln " + where + ".");
  }
  return out;
}

/* Ein Paket für sich herunterladen (Knopf in der Paketzeile): bytesOf(f) → Bytes der Druck-PDF, nameOf(f) → Druck-Name, wait(f, err) → true, wenn der Fehler
   „noch nicht gedruckt“ heißt (Bildkarten mit neuer Gestaltung), lib = () → pdf-lib. → {bytes (Paket) | null, single: {f, name, data} | null (nur eine Datei
   fertig bzw. lesbar), pages, blanks, used, bad, wait: [f], failed: [{f, error}]} */
export async function buildPack(pack, { bytesOf, nameOf, lib, wait: isWait = () => false }) {
  const wait = [], failed = [], parts = [];
  for (const f of pack.files) {
    if (!printReady(f)) { wait.push(f); continue; }
    try { parts.push({ f, name: nameOf(f), data: await bytesOf(f) }); }
    catch (e) { if (isWait(f, e)) wait.push(f); else failed.push({ f, error: e }); }
  }
  if (parts.length < PACK_MIN) return { bytes: null, single: parts[0] || null, pages: 0, blanks: 0, used: parts, bad: [], wait, failed };
  const m = await mergePrintPack(parts, await lib(), { duplex: pack.print.duplex, title: pack.name });
  if (!m.bytes) return { bytes: null, single: m.used[0] || null, pages: 0, blanks: 0, used: m.used, bad: m.bad.map((x) => x.part), wait, failed };
  return { bytes: m.bytes, single: null, pages: m.pages, blanks: m.blanks, used: m.used, bad: m.bad.map((x) => x.part), wait, failed };
}

const q = (xs) => xs.map((x) => "„" + x + "“").join(", ");
/* Rückmeldung nach dem Herunterladen eines Pakets (buildPack); waitWhy(f) = warum eine Datei noch nicht gedruckt ist (optional) → {text, ok} */
export function packDoneText(pack, r, { nameOf, waitWhy = null } = {}) {
  const parts = [];
  if (r.bytes) parts.push("„" + pack.name + "“ ist heruntergeladen: " + r.used.length + " Materialien, " + r.pages + " Seiten" +
    (r.blanks ? " (davon " + (r.blanks === 1 ? "eine Leerseite" : r.blanks + " Leerseiten") + ", damit beim beidseitigen Druck jedes Material auf einem neuen Blatt beginnt)" : "") + ".");
  else if (r.single) parts.push("Kein " + PACK_TITLE + ": " + (r.bad.length ? "„" + r.single.name + "“ ist als einzige Datei lesbar" : "Nur „" + r.single.name + "“ ist fertig") + " – die Datei ist einzeln heruntergeladen.");
  else parts.push("Kein " + PACK_TITLE + ": " + (r.wait.length && !r.failed.length && !r.bad.length ? "Die Materialien werden gerade noch als PDF gedruckt – bitte gleich noch einmal." : "Keine Datei ließ sich laden."));
  if (r.wait.length) parts.push("Noch nicht dabei" + (waitWhy ? "" : " (wird gerade als PDF gedruckt)") + ": " + r.wait.map((f) => "„" + nameOf(f) + "“" + (waitWhy ? " (" + waitWhy(f) + ")" : "")).join(", ") + ".");
  if (r.bad.length) parts.push("Nicht im Paket, weil die PDF-Datei im Browser nicht lesbar ist – bitte einzeln herunterladen: " + q(r.bad.map((x) => x.name)) + ".");
  if (r.failed.length) parts.push("Nicht dabei, weil sie sich nicht laden ließ: " + r.failed.map((x) => "„" + nameOf(x.f) + "“ (" + ((x.error && x.error.message) || "Fehler").replace(/[.]$/, "") + ")").join(", ") + ".");
  return { text: parts.join(" "), ok: !!r.bytes && !r.wait.length && !r.bad.length && !r.failed.length };
}
