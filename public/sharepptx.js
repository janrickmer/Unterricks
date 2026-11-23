// sharepptx.js – PowerPoint-Fassung der geteilten Präsentation (Nachtrag 39, Ergänzung der Lehrkraft vom 18.11.2026): jede Folie ist ein Bild der
// aufbereiteten PDF-Seite (genau wie in der PDF: ohne reine Codefolien, Unterricks-Zeile überdeckt, mit Copyright), Links der Seite bleiben als unsichtbare
// anklickbare Flächen, die Notizen der Lehrkraft stehen in den Notizen der Folie (Referentenansicht von PowerPoint). Entscheidung der Lehrkraft: Folien als
// Bild – den Folientext kann man in PowerPoint nicht ändern. Ohne Bibliothek: Office Open XML (PresentationML) selbst geschrieben, ZIP wie zip.js.
// Reine Funktionen (kein DOM) – die Bilder liefert sharepres.js.
import { makeZip } from "./zip.js";
import { noteDoSplit } from "./shared.js";

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const EMU_PT = 12700;                       // 1 pt = 12 700 EMU
const SLIDE_MIN = 914400, SLIDE_MAX = 51206400;   // Grenzen der Foliengröße in PowerPoint (1 bis 56 Zoll)
const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
const CT = "application/vnd.openxmlformats-officedocument.";

/* Text für XML: Steuerzeichen (außer Tab und Zeilenwechsel), einzelne Ersatzzeichen und die in XML verbotenen Nichtzeichen U+FFFE/U+FFFF weg,
   & < > " maskiert */
export const xmlText = (s) => String(s == null ? "" : s).replace(/(?![\t\n\r])\p{Cc}|\p{Cs}|[\u{FFFE}\u{FFFF}]/gu, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/* nur Adressen, die PowerPoint gefahrlos öffnet */
export const linkOk = (u) => typeof u === "string" && u.length <= 2000 && /^(https?:\/\/|mailto:)[^\s<>"]+$/i.test(u);

const rels = (list) => HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  list.map((x) => '<Relationship Id="' + x.id + '" Type="' + x.type + '" Target="' + xmlText(x.target) + '"' + (x.external ? ' TargetMode="External"' : "") + "/>").join("") + "</Relationships>";
const grp = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const clrMap = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
const xfrm = (x, y, cx, cy) => '<a:xfrm><a:off x="' + x + '" y="' + y + '"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>';
const defRPr = (sz) => '<a:defRPr sz="' + sz + '" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr>';
const lvl1 = (sz) => '<a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1">' + defRPr(sz) + "</a:lvl1pPr>";

/* Design (theme): vollständig nach Schema – je Liste drei Einträge, sonst repariert PowerPoint die Datei */
function themeXml(name) {
  const c = (n, v) => "<a:" + n + '><a:srgbClr val="' + v + '"/></a:' + n + ">";
  const fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const ln = (w) => '<a:ln w="' + w + '" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>';
  const font = (t) => '<a:latin typeface="' + t + '"/><a:ea typeface=""/><a:cs typeface=""/>';
  return HEAD + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="' + name + '"><a:themeElements>' +
    '<a:clrScheme name="Unterricks"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>' +
    c("dk2", "1F2A44") + c("lt2", "E7EAF0") + c("accent1", "2B4A8F") + c("accent2", "E07A1F") + c("accent3", "2E8B57") + c("accent4", "7A4FBF") + c("accent5", "C0392B") + c("accent6", "1F8A9E") +
    c("hlink", "1F5FBF") + c("folHlink", "6B4FA0") + "</a:clrScheme>" +
    '<a:fontScheme name="Unterricks"><a:majorFont>' + font("Calibri") + "</a:majorFont><a:minorFont>" + font("Calibri") + "</a:minorFont></a:fontScheme>" +
    '<a:fmtScheme name="Unterricks"><a:fillStyleLst>' + fill + fill + fill + "</a:fillStyleLst><a:lnStyleLst>" + ln(6350) + ln(12700) + ln(19050) + "</a:lnStyleLst>" +
    "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>" +
    "<a:bgFillStyleLst>" + fill + fill + fill + "</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>";
}

/* Foliengröße in EMU aus der ersten Seite (pt); außerhalb der Grenzen von PowerPoint gleichmäßig skaliert */
export function slideSize(wPt, hPt) {
  let cx = Math.round((wPt > 0 ? wPt : 960) * EMU_PT), cy = Math.round((hPt > 0 ? hPt : 540) * EMU_PT);
  const up = Math.max(SLIDE_MIN / cx, SLIDE_MIN / cy, 1), down = Math.min(SLIDE_MAX / cx, SLIDE_MAX / cy, 1);
  const k = up > 1 ? up : down;
  cx = Math.min(SLIDE_MAX, Math.max(SLIDE_MIN, Math.round(cx * k))); cy = Math.min(SLIDE_MAX, Math.max(SLIDE_MIN, Math.round(cy * k)));
  return { cx, cy };
}

/* slides = [{image: {data: Uint8Array, mime: "image/png"|"image/jpeg"}, w, h (Seite in pt), links: [{x, y, w, h (pt, von oben links), url}], notes: [Text], alt}]
   title, author (Dokumenteigenschaften), when = Date → Uint8Array (.pptx) */
export function buildPptx({ slides, title = "", author = "", when = new Date() }) {
  if (!Array.isArray(slides) || !slides.length) throw new Error("Keine Folien für die PowerPoint-Datei.");
  const te = new TextEncoder(), files = [], add = (name, text) => files.push({ name, data: typeof text === "string" ? te.encode(text) : text });
  const S = slideSize(slides[0].w, slides[0].h);
  const n = slides.length, withNotes = slides.map((s) => Array.isArray(s.notes) && s.notes.some((t) => String(t || "").trim()));
  const ext = (m) => (m === "image/jpeg" ? "jpeg" : "png");
  // Paket
  add("[Content_Types].xml", HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Override PartName="/ppt/presentation.xml" ContentType="' + CT + 'presentationml.presentation.main+xml"/>' +
    '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="' + CT + 'presentationml.slideMaster+xml"/>' +
    '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="' + CT + 'presentationml.slideLayout+xml"/>' +
    '<Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="' + CT + 'presentationml.notesMaster+xml"/>' +
    '<Override PartName="/ppt/theme/theme1.xml" ContentType="' + CT + 'theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="' + CT + 'theme+xml"/>' +
    '<Override PartName="/ppt/presProps.xml" ContentType="' + CT + 'presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="' + CT + 'presentationml.viewProps+xml"/>' +
    '<Override PartName="/ppt/tableStyles.xml" ContentType="' + CT + 'presentationml.tableStyles+xml"/>' +
    slides.map((_, i) => '<Override PartName="/ppt/slides/slide' + (i + 1) + '.xml" ContentType="' + CT + 'presentationml.slide+xml"/>' +
      (withNotes[i] ? '<Override PartName="/ppt/notesSlides/notesSlide' + (i + 1) + '.xml" ContentType="' + CT + 'presentationml.notesSlide+xml"/>' : "")).join("") +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="' + CT + 'extended-properties+xml"/></Types>');
  add("_rels/.rels", rels([{ id: "rId1", type: R + "officeDocument", target: "ppt/presentation.xml" },
    { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
    { id: "rId3", type: R + "extended-properties", target: "docProps/app.xml" }]));
  const iso = new Date(when.getTime ? when.getTime() : Date.now()).toISOString().replace(/\.\d{3}Z$/, "Z");
  add("docProps/core.xml", HEAD + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" ' +
    'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    "<dc:title>" + xmlText(title) + "</dc:title><dc:creator>" + xmlText(author) + "</dc:creator><cp:lastModifiedBy>" + xmlText(author) + "</cp:lastModifiedBy>" +
    '<dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + "</dcterms:modified></cp:coreProperties>");
  add("docProps/app.xml", HEAD + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
    "<Application>Unterricks</Application><PresentationFormat>Benutzerdefiniert</PresentationFormat><Slides>" + n + "</Slides><Notes>" + withNotes.filter(Boolean).length + "</Notes></Properties>");
  // Präsentation
  add("ppt/presentation.xml", HEAD + "<p:presentation " + NS + ' saveSubsetFonts="1">' +
    '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst>' +
    "<p:sldIdLst>" + slides.map((_, i) => '<p:sldId id="' + (256 + i) + '" r:id="rId' + (10 + i) + '"/>').join("") + "</p:sldIdLst>" +
    '<p:sldSz cx="' + S.cx + '" cy="' + S.cy + '"/><p:notesSz cx="6858000" cy="9144000"/>' +
    "<p:defaultTextStyle>" + lvl1(1800) + "</p:defaultTextStyle></p:presentation>");
  add("ppt/_rels/presentation.xml.rels", rels([{ id: "rId1", type: R + "slideMaster", target: "slideMasters/slideMaster1.xml" },
    { id: "rId2", type: R + "notesMaster", target: "notesMasters/notesMaster1.xml" }, { id: "rId3", type: R + "presProps", target: "presProps.xml" },
    { id: "rId4", type: R + "viewProps", target: "viewProps.xml" }, { id: "rId5", type: R + "theme", target: "theme/theme1.xml" },
    { id: "rId6", type: R + "tableStyles", target: "tableStyles.xml" },
    ...slides.map((_, i) => ({ id: "rId" + (10 + i), type: R + "slide", target: "slides/slide" + (i + 1) + ".xml" }))]));
  add("ppt/presProps.xml", HEAD + "<p:presentationPr " + NS + "/>");
  add("ppt/viewProps.xml", HEAD + "<p:viewPr " + NS + '><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="80000"/></p:normalViewPr><p:gridSpacing cx="72008" cy="72008"/></p:viewPr>');
  add("ppt/tableStyles.xml", HEAD + '<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>');
  add("ppt/theme/theme1.xml", themeXml("Unterricks"));
  add("ppt/theme/theme2.xml", themeXml("Unterricks Notizen"));
  // Master und (leeres) Layout
  add("ppt/slideMasters/slideMaster1.xml", HEAD + "<p:sldMaster " + NS + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + grp + "</p:spTree></p:cSld>" +
    clrMap + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>' +
    "<p:txStyles><p:titleStyle>" + lvl1(4400) + "</p:titleStyle><p:bodyStyle>" + lvl1(2800) + "</p:bodyStyle><p:otherStyle>" + lvl1(1800) + "</p:otherStyle></p:txStyles></p:sldMaster>");
  add("ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([{ id: "rId1", type: R + "slideLayout", target: "../slideLayouts/slideLayout1.xml" }, { id: "rId2", type: R + "theme", target: "../theme/theme1.xml" }]));
  add("ppt/slideLayouts/slideLayout1.xml", HEAD + "<p:sldLayout " + NS + ' type="blank" preserve="1"><p:cSld name="Leer"><p:spTree>' + grp + "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>");
  add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([{ id: "rId1", type: R + "slideMaster", target: "../slideMasters/slideMaster1.xml" }]));
  // Notizenmaster: Folienbild oben (Seitenverhältnis der Folien), Notizen darunter
  const iw0 = 5486400, ih0 = 3429000, ik = Math.min(iw0 / S.cx, ih0 / S.cy), iw = Math.round(S.cx * ik), ih = Math.round(S.cy * ik);
  add("ppt/notesMasters/notesMaster1.xml", HEAD + "<p:notesMaster " + NS + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + grp +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Folienbildplatzhalter 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>' +
    "<p:spPr>" + xfrm(Math.round((6858000 - iw) / 2), 685800, iw, ih) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notizenplatzhalter 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>' +
    "<p:spPr>" + xfrm(685800, 685800 + ih + 457200, 5486400, 9144000 - (685800 + ih + 457200) - 685800) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>' +
    '<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="de-DE"/><a:t>Notizen</a:t></a:r></a:p></p:txBody></p:sp>' +
    "</p:spTree></p:cSld>" + clrMap + "<p:notesStyle>" + lvl1(1200) + "</p:notesStyle></p:notesMaster>");
  add("ppt/notesMasters/_rels/notesMaster1.xml.rels", rels([{ id: "rId1", type: R + "theme", target: "../theme/theme2.xml" }]));
  // Folien
  slides.forEach((s, i) => {
    const k = i + 1, img = s.image || {}, e = ext(img.mime), w = s.w > 0 ? s.w : 960, h = s.h > 0 ? s.h : 540;
    const kk = Math.min(S.cx / (w * EMU_PT), S.cy / (h * EMU_PT)), pw = Math.round(w * EMU_PT * kk), ph = Math.round(h * EMU_PT * kk);
    const ox = Math.round((S.cx - pw) / 2), oy = Math.round((S.cy - ph) / 2), sc = EMU_PT * kk;
    add("ppt/media/image" + k + "." + e, img.data instanceof Uint8Array ? img.data : new Uint8Array(img.data || []));
    const rl = [{ id: "rId1", type: R + "slideLayout", target: "../slideLayouts/slideLayout1.xml" }, { id: "rId2", type: R + "image", target: "../media/image" + k + "." + e }];
    if (withNotes[i]) rl.push({ id: "rId3", type: R + "notesSlide", target: "../notesSlides/notesSlide" + k + ".xml" });
    const links = (s.links || []).filter((l) => l && linkOk(l.url) && l.w > 0 && l.h > 0).slice(0, 40);
    let spId = 3;
    const shapes = links.map((l, j) => {
      const rid = "rId" + (10 + j);
      rl.push({ id: rid, type: R + "hyperlink", target: l.url, external: true });
      // vollständig durchsichtige Füllung (nicht „keine Füllung“): so ist die ganze Fläche in der Bildschirmpräsentation anklickbar
      return '<p:sp><p:nvSpPr><p:cNvPr id="' + spId++ + '" name="Link ' + (j + 1) + '" descr="' + xmlText(l.url) + '"><a:hlinkClick r:id="' + rid + '"/></p:cNvPr><p:cNvSpPr/><p:nvPr/></p:nvSpPr>' +
        "<p:spPr>" + xfrm(ox + Math.round(l.x * sc), oy + Math.round(l.y * sc), Math.max(1, Math.round(l.w * sc)), Math.max(1, Math.round(l.h * sc))) +
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="0"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>';
    }).join("");
    const alt = String(s.alt || "").replace(/\s+/g, " ").trim().slice(0, 1500) || "Folie " + k;
    add("ppt/slides/slide" + k + ".xml", HEAD + "<p:sld " + NS + "><p:cSld><p:spTree>" + grp +
      '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Folie ' + k + '" descr="' + xmlText(alt) + '"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>' +
      '<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>' + xfrm(ox, oy, pw, ph) + '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>' +
      shapes + "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>");
    add("ppt/slides/_rels/slide" + k + ".xml.rels", rels(rl));
    if (withNotes[i]) {
      const items = s.notes.map((t) => String(t || "").trim()).filter(Boolean);
      const run = (text, bold) => '<a:r><a:rPr lang="de-DE"' + (bold ? ' b="1"' : "") + ' dirty="0"/><a:t>' + xmlText(text) + "</a:t></a:r>";
      // die Anweisung an die Lehrkraft (erster Stichpunkt „Lehrkraft: …“, Nachtrag 42): das Wort „Lehrkraft:“ fett
      const lineRuns = (line, first) => { const d = first ? noteDoSplit(line) : null; return d ? run(d.label, true) + run(d.rest, false) : run(line, false); };
      const paras = items.map((t, ti) => '<a:p><a:pPr marL="171450" indent="-171450"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr>' +
        t.split(/\r?\n/).map((line, li) => (li ? '<a:br><a:rPr lang="de-DE"/></a:br>' : "") + lineRuns(line, ti === 0 && li === 0)).join("") + "</a:p>").join("");
      add("ppt/notesSlides/notesSlide" + k + ".xml", HEAD + "<p:notes " + NS + "><p:cSld><p:spTree>" + grp +
        '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Folienbildplatzhalter 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>' +
        '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notizenplatzhalter 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr/>' +
        "<p:txBody><a:bodyPr/><a:lstStyle/>" + paras + "</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>");
      add("ppt/notesSlides/_rels/notesSlide" + k + ".xml.rels", rels([{ id: "rId1", type: R + "notesMaster", target: "../notesMasters/notesMaster1.xml" }, { id: "rId2", type: R + "slide", target: "../slides/slide" + k + ".xml" }]));
    }
  });
  return makeZip(files, when);
}
