// share.js – „Unterrichtseinheit mit KollegInnen teilen“ (Nachtrag 39 der Lehrkraft vom 18.11.2026): stellt im Browser den ZIP-Ordner zusammen.
//   Leupold-Schema - <Titel>.pdf            Leupold-Schema, darunter je Sitzung ein Absatz (was passiert, zentrale Kompetenz, Ziel – schreibt Claude, siehe sharelib.js)
//   Erklärung - Das ist ein Feibeitsblatt.pdf  nur, wenn die Einheit Feibeitsblätter nutzt (Gymnasium)
//   Fehlende Sitzungen.pdf                  nur, wenn noch nicht alle Stunden geplant sind (Stundenfrage und grober Ablauf aus der Einheit)
//   Sitzung n/                              je geplanter Stunde (n = Nummer der Stunde in der Einheit):
//     Präsentation - Sitzung n.pdf          ohne reine Codefolien, Unterricks-Zeile auf Materialfolien überdeckt, mit „Copyright Jan-Rickmer Feindt“ (sharepres.js)
//     Präsentation - Sitzung n.pptx         dieselben Folien als Bild, Notizen der Lehrkraft in den Notizen der Folie (sharepptx.js)
//     Notizen zu den Folien - Sitzung n.pdf nur mit Notizen der Lehrkraft
//     Verlaufsplan - Sitzung n.pdf          Stundenverlauf (Schulportal-Eintrag bzw. Verlaufsplan der Grundschule), Hausaufgabe, Links, Zusammenfassung für die Lehrkraft
//     … alle PDF-Dateien der Sitzung: für Schüler:innen bzw. Kinder (auch Notfall-Feibeitsblätter), Druckliste, Material nur für die Lehrkraft (auch Bildkarten);
//       Textmaterial als PDF – nicht: andere Dateiarten (Word …), die Anmerkungs-PDF (ersetzt durch die Notizen oben), Archiv einer Vertretung.
import { tapi } from "./teacher.js";
import { ZipBlob } from "./zip.js";
import { GS_SUBJECT } from "./shared.js";
import { unitBaseName } from "./unitfile.js";
import { fetchFileBytes, retry } from "./sessionio.js";
import { markdownToPdf } from "./pdfmaker.js";
import { leupoldPdf, blocksPdf } from "./sharepdf.js";
import { sharePresentation } from "./sharepres.js";
import { shareSessions, shareFolder, SHARE_DOCS, uniquePdfName, unitMeta, fbExplainBlocks, missingBlocks, planBlocks } from "./sharelib.js";

const isPdf = (f) => f.kind === "file" && (f.mime === "application/pdf" || /\.pdf$/i.test(f.name || ""));
export const shareZipName = (unit, gsShort = null) => unitBaseName(unit, 80, gsShort) + " - zum Teilen.zip";
export class Cancelled extends Error { constructor() { super("Abgebrochen."); this.cancelled = true; } }

/* unit = unitFull (GET /api/teacher/units/:id). → {blob, name, sessions (Ordner), missing (Stunden ohne Planung), notes (Hinweise), noText (geplant, ohne Absatz)} */
export async function buildShareZip(unit, { onStep = () => {}, cancelled = () => false, presLibs = null } = {}) {   // presLibs: nur für Tests (sharepres.js)
  const check = () => { if (cancelled()) throw new Cancelled(); };
  const gs = unit.subject === GS_SUBJECT, gsc = unit.course && unit.course.gs ? unit.course.gs : null, gsShort = gsc ? gsc.short : null;
  const meta = unitMeta(unit, gsc ? gsc.label + (gsc.gradeText ? " · " + gsc.gradeText : "") : "");
  onStep("Lese die Sitzungen …");
  const ls = (await retry(() => tapi("GET", "/api/teacher/units/" + unit.id + "/share"))).lessons;
  const sessions = shareSessions(unit.rows || [], ls), planned = sessions.filter((s) => s.planned), open = sessions.filter((s) => !s.planned);
  const zip = new ZipBlob(), notes = [], byLesson = new Map(sessions.filter((s) => s.lesson).map((s) => [s.lesson.id, s]));
  let fbUsed = false;
  for (const s of planned) {
    check();
    const folder = shareFolder(s.n), label = folder + " von " + sessions.length;
    onStep(label + " …");
    const detail = await retry(() => tapi("GET", "/api/teacher/lessons/" + s.lesson.id + "?full=1"));
    const L = detail.lesson, files = detail.files || [], names = new Map();
    const used = new Set([SHARE_DOCS.pres(s.n), SHARE_DOCS.notes(s.n), SHARE_DOCS.plan(s.n)].map((x) => x.toLowerCase()));   // eigene Namen gehen vor
    if ((detail.sheets || []).some((x) => x.kind !== "escape") || files.some((f) => f.source === "notfall")) fbUsed = true;
    const add = (name, bytes) => zip.add(folder + "/" + name, bytes);
    // Präsentation(en): aufbereitet; Notizen der Lehrkraft als eigene PDF
    const pres = files.filter((f) => f.area === "presentation" && isPdf(f) && f.status === "ready");
    for (const [k, f] of pres.entries()) {
      check();
      onStep(label + ": Präsentation wird aufbereitet …");
      try {
        const bytes = await fetchFileBytes(f);
        let slideNotes = null;
        if (f.notes > 0 || f.notesRev > 0) { try { slideNotes = (await retry(() => tapi("GET", "/api/teacher/files/" + f.id + "/notes"))).notes; } catch { notes.push(folder + ": Die Notizen zu „" + f.name + "“ ließen sich nicht laden."); } }
        const titles = [...files.filter((x) => x.area !== "presentation" && x.area !== "archive").map((x) => x.name), ...(detail.sheets || []).map((x) => x.title)];
        const r = await sharePresentation(bytes, { codeSlides: f.codeSlides || [], titles, notes: slideNotes, title: (L.title || "Präsentation"), libs: presLibs });
        const suffix = pres.length > 1 ? " (" + (k + 1) + ")" : "";
        add(SHARE_DOCS.pres(s.n).replace(/\.pdf$/, suffix + ".pdf"), r.bytes);
        if (r.pptxBytes) add(SHARE_DOCS.pptx(s.n).replace(/\.pptx$/, suffix + ".pptx"), r.pptxBytes);
        else notes.push(folder + ": Die PowerPoint-Fassung von „" + f.name + "“ fehlt – " + (r.pptxError || "Fehler") + ".");
        if (r.notesBytes) add(SHARE_DOCS.notes(s.n).replace(/\.pdf$/, suffix + ".pdf"), r.notesBytes);
        if (r.dropped.length) notes.push(folder + ": " + (r.dropped.length === 1 ? "eine Codefolie" : r.dropped.length + " Codefolien") + " ohne Material entfernt (Folie " + r.dropped.join(", ") + ").");
        if (r.uncovered.length) notes.push(folder + ": Auf Folie " + r.uncovered.join(", ") + " ließ sich die Zeile „Unterricks-Codefolie …“ nicht finden bzw. überdecken.");
      } catch (e) { if (e && e.cancelled) throw e; notes.push(folder + ": Die Präsentation „" + f.name + "“ fehlt – " + (e && e.message ? e.message : "Fehler") ); }
    }
    // PDF-Dateien der Sitzung (Schüler:innen bzw. Kinder, Druckliste, nur Lehrkraft); Textmaterial als PDF; Namen für die Verweise im Verlaufsplan
    const mats = files.filter((f) => f.area !== "presentation" && f.area !== "archive" && !f.notesOf);
    for (const f of mats) {
      check();
      if (f.kind === "link") continue;   // Links stehen im Verlaufsplan
      if (f.kind === "text") {
        try { const b = new Uint8Array(await (await markdownToPdf(f.name, f.text || "", { nameLine: f.area === "student" })).arrayBuffer()); const nm = uniquePdfName(f.name, used); names.set(f.id, nm); add(nm, b); }
        catch (e) { notes.push(folder + ": „" + f.name + "“ ließ sich nicht als PDF erzeugen."); }
        continue;
      }
      if (!isPdf(f)) { notes.push(folder + ": „" + f.name + "“ ist keine PDF-Datei und fehlt im Ordner."); continue; }
      if (f.status !== "ready") { notes.push(folder + ": „" + f.name + "“ ist noch nicht fertig (z. B. noch nicht gedruckt) und fehlt im Ordner."); continue; }
      onStep(label + ": Lade „" + f.name + "“ …");
      try {
        const b = await fetchFileBytes(f), nm = uniquePdfName(f.name, used);
        names.set(f.id, nm); add(nm, b);
        if (f.design && f.design.outdated) notes.push(folder + ": „" + f.name + "“ wurde nach dem letzten Druck noch geändert – im Ordner liegt die zuletzt gedruckte Fassung.");
      } catch (e) { if (e && e.cancelled) throw e; notes.push(folder + ": „" + f.name + "“ ließ sich nicht laden – " + (e && e.message ? e.message : "Fehler")); }
    }
    // Verlaufsplan (nach den Dateien: die Verweise der Grundschule nennen deren Namen). Verweise auf Dateien anderer Sitzungen (wiederverwendete Bildkarten,
    // Nachtrag 31b) nennen ihren Namen und den Ordner, in dem sie liegen
    for (const f of [...(detail.refFiles || []), ...(detail.courseCards || [])]) {
      if (!f || !f.id || names.has(f.id)) continue;
      const o = f.lessonId ? byLesson.get(f.lessonId) : null;
      names.set(f.id, String(f.name || "Material").replace(/\.pdf$/i, "") + ".pdf" + (o && o.planned && o.n !== s.n ? " (im Ordner „" + shareFolder(o.n) + "“)" : ""));
    }
    check();
    onStep(label + ": Verlaufsplan …");
    add(SHARE_DOCS.plan(s.n), await blocksPdf("Verlaufsplan – " + folder, planBlocks({ L, n: s.n, gs, files, names, meta })));
  }
  check();
  onStep("Leupold-Schema …");
  zip.add(SHARE_DOCS.leupold(unit.title || (unit.plan && unit.plan.titel) || ""), await leupoldPdf(unit, sessions, { title: unit.title || (unit.plan && unit.plan.titel) || "", meta }));
  if (fbUsed && !gs) zip.add(SHARE_DOCS.feibeitsblatt, await blocksPdf("Das ist ein Feibeitsblatt", fbExplainBlocks()));
  if (open.length) zip.add(SHARE_DOCS.missing, await blocksPdf("Fehlende Sitzungen", missingBlocks(open, (unit.plan && unit.plan.schritte) || [], { unitTitle: unit.title || "", gs })));
  check();
  return { blob: zip.finish(), name: shareZipName(unit, gsShort), sessions: planned.length, missing: open.length, notes,
    noText: planned.filter((s) => !s.lesson.shareText).map((s) => s.n), fb: fbUsed && !gs };
}
