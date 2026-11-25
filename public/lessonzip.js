// lessonzip.js – „Alle Unterlagen dieser Sitzung“ (Nachtrag 41 vom 23.11.2026): ganz unten auf jeder Sitzungsseite (Gymnasium und Grundschule) ein
// ZIP-Ordner mit allem, was die Lehrkraft für diese eine Sitzung braucht – zum Lesen, Ausdrucken und Mitnehmen, nicht zum Wiederladen in Unterricks
// (dafür bleibt „Sitzung als Datei“, sessionio.js). Inhalt:
//   Verlaufsplan - <Titel>.pdf            Stundenverlauf bzw. Verlaufsplan (ohne „⏸ Zwischenstopp“), Hausaufgabe, Links, Feibeitsblätter mit Code,
//                                         Gegenstände zum Mitbringen, Fachbegriffe dieser Sitzung (Gymnasium, Nachtrag 44/47), Zusammenfassung für die Lehrkraft
//                                         und eine Liste des Ordners
//   Präsentation - <Titel>.pdf / .pptx    die Präsentation, wie sie hochgeladen ist, und als PowerPoint daraus (jede Folie ein Bild, Notizen in der
//                                         Referentenansicht – sharepres.js pdfToPptx)
//   Notizen zu den Folien - <Titel>.pdf   die Anmerkungs-PDF (nur mit Notizen)
//   Zum Ausdrucken/                       die Druckliste wie „Alle herunterladen (ZIP)“: Druck-Name mit Anzahl, Druckart und Kurs (materialbox.js packPrint),
//                                         gleiche Druckangaben als ein Sitzungspaket (Nachtrag 42)
//   Material für Schülerinnen und Schüler/ bzw. Material für die Kinder/, Material für die Lehrkraft/
//   Aus anderen Sitzungen/                Grundschule: Dateien anderer Sitzungen, auf die der Verlaufsplan verweist ([[pdf:…]])
//   Ursprüngliche Planung (archiviert)/   Selbstlern-Phase bzw. Vertretung: archiviertes Material und der ursprüngliche Verlaufsplan
// Textmaterial wird PDF (pdfmaker.js), andere Dateiarten kommen unverändert mit. Was fehlt (noch nicht gedruckt, nicht ladbar …), steht in notes.
import { tapi } from "./teacher.js";
import { ZipBlob } from "./zip.js";
import { fetchFileBytes, retry } from "./sessionio.js";
import { markdownToPdf } from "./pdfmaker.js";
import { blocksPdf } from "./sharepdf.js";
import { pdfToPptx } from "./sharepres.js";
import { annotatedPdfBytes } from "./pdfnotes.js";
import { pdfLib } from "./pdfcut.js";
import { planBlocks, planWithoutStop, unitMeta, namePart } from "./sharelib.js";
import { GS_SUBJECT, subjectShort, subjectName, classShort, formatCode, fmtDay, planRefs, summaryOutdated, PACK_TITLE } from "./shared.js";
import { packNotes } from "./printpack.js";
import { SUMMARY_STALE } from "./tsummary.js";

export const LZ_FOLDERS = {
  print: "Zum Ausdrucken", student: "Material für Schülerinnen und Schüler", kids: "Material für die Kinder", teacher: "Material für die Lehrkraft",
  refs: "Aus anderen Sitzungen", archive: "Ursprüngliche Planung (archiviert)",
};
const T = (title) => namePart(title, 60) || "Sitzung";
export const LZ_DOCS = {
  plan: (t) => "Verlaufsplan - " + T(t) + ".pdf",
  planOrig: (t) => "Verlaufsplan (ursprünglich) - " + T(t) + ".pdf",
  pres: (t, k = "") => "Präsentation - " + T(t) + k + ".pdf",
  pptx: (t, k = "") => "Präsentation - " + T(t) + k + ".pptx",
  notes: (t, k = "") => "Notizen zu den Folien - " + T(t) + k + ".pdf",
};
/* „Unterlagen - PoWi - 8B - 2026-11-23 - Gewaltenteilung.zip“ (Klasse bzw. Kurs wie in der Übersicht) bzw. „Unterlagen - Grundschule - Religion 2ab - … .zip“ */
export function lessonZipName(L, gsShort = null) {
  const who = L.subject === GS_SUBJECT ? ["Grundschule", namePart(gsShort, 40) || "Kurs"] : [subjectShort(L.subject) || subjectName(L.subject) || "Fach", namePart(classShort(L.klass), 40) || "Lerngruppe"];
  return ["Unterlagen", ...who, L.date || null, namePart(L.title, 80) || "Sitzung"].filter(Boolean).join(" - ") + ".zip";
}
const isPdfFile = (f) => f.mime === "application/pdf" || /\.pdf$/i.test(f.name || "");
// Dateiname im Ordner: unverändert (ohne verbotene Zeichen; gekürzt bleibt die Endung), PDF-Dateien enden auf .pdf
const fileName = (f) => {
  const raw = String(f.name || ""), m = /\.[A-Za-z0-9]{1,8}$/.exec(raw), ext = m ? m[0] : "", stem = ext ? raw.slice(0, -ext.length) : raw;
  return (namePart(stem, 110 - ext.length) || "Datei") + (ext || (isPdfFile(f) ? ".pdf" : ""));
};
// Gestaltung nach dem letzten Druck geändert (Dateien dieser Sitzung: design.outdated; Dateien anderer Sitzungen: Zeitpunkte wie im Connector)
const outdatedOf = (f) => (f.design ? !!f.design.outdated : !!(f.designed && f.htmlAt != null && (f.pdfAt == null || f.htmlAt > f.pdfAt)));
const sheetKey = (c) => String(c || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();

/* st = Stand der Sitzungsseite (lesson, files, sheets, sub, refFiles, courseCards), gs = Grundschule, course = Kurs der Grundschule ({label, short, gradeText}),
   portal/homework = Stand der Felder (auch ungespeichert), packPrint = Druckliste der Seite (materialbox.js), cardsNote = ihr Hinweis zu fehlenden
   Bildkarten, waitWhy = warum eine Vorlage noch nicht gedruckt ist, onStep = Fortschritt, libs = nur für Tests ({pdfLib, pdfjs, raster}). → {blob, name, paths, notes} */
export async function buildLessonZip({ st, gs = false, course = null, portal = null, homework = null, packPrint = null, cardsNote = null, waitWhy = null, onStep = () => {}, libs = null }) {
  const L0 = st.lesson, L = { ...L0, portal: portal == null ? L0.portal || "" : portal, homework: homework == null ? L0.homework || "" : homework };
  const zip = new ZipBlob(), notes = [], paths = [], placed = new Map();   // Datei-ID → Pfad im Ordner (für die Verweise im Verlaufsplan)
  const add = (folder, name, data) => { const p = zip.add((folder ? folder + "/" : "") + name, data); paths.push(p); return p; };
  const why = (e) => (e && e.message ? e.message.replace(/[.]$/, "") : "Fehler");
  const PL = async () => (libs && libs.pdfLib ? libs.pdfLib : pdfLib());
  const textPdf = async (f, nameLine) => new Uint8Array(await (await markdownToPdf(f.name, f.text || "", { nameLine })).arrayBuffer());

  // 1. Druckliste – wie „Alle herunterladen (ZIP)“ (Grundschule: liest dabei den Stand vom Server, st.files ist danach aktuell)
  const onPrint = new Set(), inPack = new Set();   // inPack: Dateien, die nur als Teil eines Sitzungspakets im Ordner „Zum Ausdrucken“ liegen (Nachtrag 42)
  if (packPrint) {
    onStep("Lade die Druckliste …");
    let pp = null;
    try { pp = await packPrint({ tolerant: true }); }
    catch (e) { notes.push("Die Druckliste ließ sich nicht laden – " + why(e) + "; die Druckvorlagen fehlen im Ordner „" + LZ_FOLDERS.print + "“."); }
    if (pp) {
      for (const f of pp.all) onPrint.add(f.id);
      for (const e of pp.entries) {
        const path = add(LZ_FOLDERS.print, e.name, e.data);
        // Sitzungspaket (Nachtrag 42): eine PDF für mehrere Dateien – Verweise des Verlaufsplans auf eine von ihnen nennen das Paket und den Teil
        if (e.pack) {
          e.parts.forEach((x, k) => {
            placed.set(x.f.id, path + " (Teil " + (k + 1) + ")"); inPack.add(x.f.id);
            if (outdatedOf(x.f)) notes.push("„" + x.name + "“ (im " + PACK_TITLE + " „" + path + "“) wurde nach dem letzten Druck noch geändert – im Ordner liegt die zuletzt gedruckte Fassung.");
          });
          continue;
        }
        placed.set(e.f.id, path);
        if (outdatedOf(e.f)) notes.push("„" + e.name + "“ (Ordner „" + LZ_FOLDERS.print + "“) wurde nach dem letzten Druck noch geändert – im Ordner liegt die zuletzt gedruckte Fassung.");
      }
      if (pp.packError) notes.push("Die Sitzungspakete ließen sich nicht bilden – die Druckvorlagen liegen einzeln im Ordner „" + LZ_FOLDERS.print + "“.");
      notes.push(...packNotes(pp.packs || [], "im Ordner „" + LZ_FOLDERS.print + "“"));
      for (const x of pp.failed || []) notes.push("„" + x.f.name + "“ von der Druckliste ließ sich nicht laden – " + why(x.error) + ".");
      for (const f of pp.wait) notes.push("Nicht im Ordner „" + LZ_FOLDERS.print + "“: „" + f.name + "“ – " + (waitWhy ? waitWhy(f) : "wird gerade als PDF gedruckt – bitte gleich noch einmal herunterladen") + ".");
      if (pp.cardsWait.length && cardsNote) notes.push(cardsNote(pp.cardsWait));
    }
  }
  const files = st.files || [];

  // 2. Präsentation(en): unverändert als PDF, dazu PowerPoint und die Notizen
  const presAll = files.filter((f) => f.area === "presentation"), pres = presAll.filter((f) => isPdfFile(f) && f.status === "ready");
  for (const f of presAll.filter((x) => !pres.includes(x))) notes.push("Die Präsentation „" + f.name + "“ ist noch nicht fertig hochgeladen und fehlt im Ordner.");
  for (const [k, f] of pres.entries()) {
    const sfx = pres.length > 1 ? " (" + (k + 1) + ")" : "", title = L.title || "Präsentation";
    onStep("Lade die Präsentation …");
    let bytes;
    try { bytes = await fetchFileBytes(f); placed.set(f.id, add("", LZ_DOCS.pres(L.title, sfx), bytes)); }
    catch (e) { notes.push("Die Präsentation „" + f.name + "“ fehlt – " + why(e) + "."); continue; }
    let slideNotes = [], notesFailed = false;
    if (f.notes > 0 || f.notesRev > 0) {
      try { slideNotes = ((await retry(() => tapi("GET", "/api/teacher/files/" + f.id + "/notes"))).notes || []).filter((x) => x && Array.isArray(x.items) && x.items.length); }
      catch { notesFailed = true; notes.push("Die Notizen zu „" + f.name + "“ ließen sich nicht laden – die PowerPoint ist ohne sie" + (files.some((x) => x.notesOf === f.id && x.area !== "archive" && x.status === "ready") ? ", die Notizen-PDF ist die zuletzt gespeicherte." : ".")); }
    }
    onStep("Erstelle die PowerPoint-Fassung …");
    try { add("", LZ_DOCS.pptx(L.title, sfx), await pdfToPptx(bytes, { notes: slideNotes, title, libs })); }
    catch (e) { notes.push("Die PowerPoint-Fassung von „" + f.name + "“ fehlt – " + why(e) + "."); }
    // Notizen: frisch aus den Notizen von eben (wie die PowerPoint); nur wenn das nicht geht, die gespeicherte Anmerkungs-PDF
    const ann = files.find((x) => x.notesOf === f.id && x.area !== "archive" && x.status === "ready");
    let nb = null, nerr = null;
    if (slideNotes.length) { try { nb = await annotatedPdfBytes(bytes, slideNotes, await PL(), { codeSlides: f.codeSlides || [], title }); } catch (e) { nerr = e; } }
    if (!nb && ann && (nerr || notesFailed)) { try { nb = await fetchFileBytes(ann); } catch (e) { nerr = e; } }
    if (nb) add("", LZ_DOCS.notes(L.title, sfx), nb);
    else if (nerr) notes.push("Die Notizen zu den Folien von „" + f.name + "“ fehlen – " + why(nerr) + ".");
  }

  // 3. Material der Sitzung (was auf der Druckliste steht, liegt schon unter „Zum Ausdrucken“; Links stehen im Verlaufsplan)
  // again: die Datei liegt schon als Teil eines Sitzungspakets im Ordner – der Verweis im Verlaufsplan bleibt beim Paket, „nach dem Druck geändert“ steht schon da
  async function put(folder, f, nameLine, again = false) {
    if (f.kind === "link") return;
    const mark = (p) => { if (!again) placed.set(f.id, p); };
    if (f.kind === "text") {
      try { mark(add(folder, (namePart(f.name, 110) || "Text") + ".pdf", await textPdf(f, nameLine))); }
      catch (e) { notes.push("„" + f.name + "“ ließ sich nicht als PDF erzeugen – " + why(e) + "."); }
      return;
    }
    if (f.status !== "ready") { notes.push("„" + f.name + "“ ist noch nicht fertig (z. B. noch nicht als PDF gedruckt) und fehlt im Ordner."); return; }
    onStep("Lade „" + f.name + "“ …");
    try {
      mark(add(folder, fileName(f), await fetchFileBytes(f)));
      if (outdatedOf(f) && !again) notes.push("„" + f.name + "“ wurde nach dem letzten Druck noch geändert – im Ordner liegt die zuletzt gedruckte Fassung.");
    } catch (e) { notes.push("„" + f.name + "“ ließ sich nicht laden – " + why(e) + "."); }
  }
  const area = { student: gs ? LZ_FOLDERS.kids : LZ_FOLDERS.student, teacher: LZ_FOLDERS.teacher };
  for (const f of files) {
    // Nachtrag 42 (Prüfbefund): ein Arbeitsblatt der Kinder mit „Auch ausdrucken“ liegt sonst nur unter „Zum Ausdrucken“ – steckt es dort in einem
    // Sitzungspaket, fehlte es als eigene Datei; dann liegt es zusätzlich in „Material für die Kinder“ (der Verweis im Verlaufsplan nennt weiter das Paket)
    const again = f.area === "student" && inPack.has(f.id);
    if (!area[f.area] || f.notesOf || (onPrint.has(f.id) && !again)) continue;
    await put(area[f.area], f, f.area === "student", again);
  }
  // Grundschule: Verweise des Verlaufsplans auf Dateien anderer Sitzungen (z. B. Vorlesetext der vorigen Stunde, Bildkarten des Kurses)
  if (gs) {
    const others = [...(st.courseCards || []), ...(st.refFiles || [])];   // Bildkarten des Kurses tragen ihre Gestaltung (design) – vor den einfachen Verweisen
    for (const fid of planRefs(L.portal).all) {
      if (placed.has(fid) || onPrint.has(fid) || files.some((x) => x.id === fid)) continue;   // auf der Druckliste: dort (bzw. im Hinweis zu den Bildkarten)
      const f = others.find((x) => x.id === fid);
      if (f) await put(LZ_FOLDERS.refs, f, f.area === "student");
    }
  }
  // Selbstlern-Phase bzw. Vertretung: die ursprüngliche Planung (archiviert) – Material, Verlaufsplan mit ihren Links, Feibeitsblättern und der
  // Zusammenfassung für die Lehrkraft (sie beschreibt die ursprüngliche Planung)
  const arch = st.sub && st.sub.archive ? st.sub.archive : null, archived = files.filter((f) => f.area === "archive"), subSt = st.sub && st.sub.status;
  const away = !!arch && (subSt === "selbstlern" || subSt === "aktiv");
  if (arch || archived.length) {
    const aArea = (arch && arch.fileAreas) || {};
    for (const f of archived) await put(LZ_FOLDERS.archive, f, aArea[f.id] !== "teacher");
    const aLinks = archived.filter((f) => f.kind === "link").map((f) => ({ ...f, area: aArea[f.id] || "student" }));
    const aSheets = ((arch && arch.sheets) || []).filter((x) => x && x.kind !== "escape" && !(st.sheets || []).some((y) => sheetKey(y.code) === sheetKey(x.code)));
    if (arch && (arch.portal || arch.homework || aLinks.length || aSheets.length || (away && L.teacherSummary))) {
      try {
        const LA = { ...L, portal: arch.portal || "", homework: arch.homework || "", teacherSummary: away ? L.teacherSummary || "" : "" };
        const ex = aSheets.length ? [{ t: "h", text: "Feibeitsblätter" }, ...aSheets.map((sh) => {
          const nf = archived.find((f) => f.source === "notfall" && sheetKey(f.fbCode) === sheetKey(sh.code) && placed.has(f.id));
          return { t: "li", runs: [{ text: (sh.title || "Feibeitsblatt") + " – Code " + formatCode(sh.code) }, ...(nf ? [{ text: " (Notfall-Feibeitsblatt: „" + placed.get(nf.id) + "“)", i: true }] : [])] };
        })] : [];
        add(LZ_FOLDERS.archive, LZ_DOCS.planOrig(L.title), await blocksPdf("Verlaufsplan (ursprünglich)", planBlocks({ L: LA, gs, files: aLinks.map((f) => ({ ...f, area: "student" })), names: placed, meta: metaOf(L, gs, course), head: "Verlaufsplan (ursprüngliche Planung)", extra: ex }), { lib: libs && libs.pdfLib, copyright: false }));
      } catch (e) { notes.push("Der ursprüngliche Verlaufsplan fehlt – " + why(e) + "."); }
    }
    const inArch = paths.some((p) => p.startsWith(LZ_FOLDERS.archive + "/"));
    if (away) notes.push("Für diese Sitzung gilt " + (subSt === "selbstlern" ? "eine Selbstlern-Phase" : "eine Vertretung") + (inArch ? " – die ursprüngliche Planung liegt im Ordner „" + LZ_FOLDERS.archive + "“." : " – zur ursprünglichen Planung gab es nichts zum Herunterladen."));
    else if (inArch) notes.push("Archiviertes Material liegt im Ordner „" + LZ_FOLDERS.archive + "“.");
  }

  // Feibeitsblätter (Gymnasium): ohne Notfall-Feibeitsblatt gibt es nichts zum Ausdrucken – sagen, wie es entsteht
  const sheets = (st.sheets || []).filter((x) => x && x.kind !== "escape");
  for (const sh of sheets) {
    if (!files.some((f) => f.source === "notfall" && sheetKey(f.fbCode) === sheetKey(sh.code) && f.area !== "archive" && f.status === "ready"))
      notes.push("Zum Feibeitsblatt „" + (sh.title || formatCode(sh.code)) + "“ fehlt das Notfall-Feibeitsblatt – mit Feibeitsblatt-Verbindung entsteht es beim Öffnen der Sitzung.");
  }

  // 4. Verlaufsplan zuletzt: Verweise nennen den Pfad im Ordner; dazu Feibeitsblätter, Gegenstände und eine Liste des Ordners
  onStep("Erstelle den Verlaufsplan …");
  const names = new Map([...placed].map(([id, p]) => [id, p]));
  for (const f of [...files, ...(st.refFiles || []), ...(st.courseCards || [])]) if (!names.has(f.id) && f.name) names.set(f.id, f.name + " (nicht im Ordner)");
  const extra = [];
  if (sheets.length) {
    extra.push({ t: "h", text: "Feibeitsblätter" });
    for (const sh of sheets) {
      const nf = files.find((f) => f.source === "notfall" && sheetKey(f.fbCode) === sheetKey(sh.code) && placed.has(f.id));
      extra.push({ t: "li", runs: [{ text: (sh.title || "Feibeitsblatt") + " – Code " + formatCode(sh.code) }, ...(nf ? [{ text: " (Notfall-Feibeitsblatt: „" + placed.get(nf.id) + "“)", i: true }] : [])] });
    }
  }
  const bring = (L.bring || []).filter((b) => b && b.item);
  if (bring.length) extra.push({ t: "h", text: "Gegenstände zum Mitbringen" }, ...bring.map((b) => ({ t: "li", runs: [{ text: b.item + (b.note ? " – " + b.note : "") }] })));
  // Fachbegriffe dieser Sitzung (Nachtrag 44/47; Gymnasium ab Jg. 5 – die Liste gibt es nur dort): Begriff fett, dahinter die Definition
  const terms = (Array.isArray(L.terms) ? L.terms : []).filter((x) => x && x.term);
  if (terms.length) extra.push({ t: "h", text: "Fachbegriffe dieser Sitzung (Karteikarten für die Schüler:innen)" }, ...terms.map((x) => ({ t: "li", runs: [{ text: x.term, b: true }, { text: " – " + (x.definition || "") }] })));
  const planName = LZ_DOCS.plan(L.title);
  extra.push({ t: "h", text: "In diesem Ordner" }, ...[planName, ...paths].map((p) => ({ t: "li", runs: [{ text: p }] })));
  const blocks = planBlocks({ L: away ? { ...L, teacherSummary: "" } : L, gs, files, names, meta: metaOf(L, gs, course), when: [L.date ? fmtDay(L.date) : "", L.startTime ? L.startTime + " Uhr" : ""].filter(Boolean).join(", "),
    head: "Verlaufsplan" + (L.date ? " – " + fmtDay(L.date) : ""), extra });
  if (!planWithoutStop(L.portal).trim()) {   // noch nicht geplant: das sagt der Plan selbst
    const i = blocks.findIndex((b) => b.t === "h");
    if (i >= 0) blocks.splice(i + 1, 0, { t: "p", runs: [{ text: "Noch kein " + (gs ? "Verlaufsplan" : "Stundenverlauf") + " eingetragen.", i: true }] });
  }
  // die Zusammenfassung ist älter als die Planung: wie auf der Seite (tsummary.js) darunter der Hinweis
  if (!away && summaryOutdated(L.teacherSummary, L.teacherSummaryPlan, L.portal)) {
    const i = blocks.findIndex((x) => x.t === "h" && x.text === "Zusammenfassung der Sitzung für die Lehrkraft");
    if (i >= 0) blocks.splice(i + 1, 0, { t: "p", runs: [{ text: SUMMARY_STALE, i: true }] });
  }
  try { add("", planName, await blocksPdf("Verlaufsplan – " + (L.title || "Sitzung"), blocks, { lib: libs && libs.pdfLib, copyright: false })); }
  catch (e) { notes.push("Der Verlaufsplan fehlt – " + why(e) + "."); }
  onStep("Packe den Ordner …");
  return { blob: zip.finish("application/zip"), name: lessonZipName(L, course && course.short), paths, notes };
}
const metaOf = (L, gs, course) => unitMeta({ subject: gs ? GS_SUBJECT : L.subject, klass: L.klass }, course ? [course.label, course.gradeText].filter(Boolean).join(" · ") : "");
