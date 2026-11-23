// Nachtrag 27 (15.11.2026), Aufbau seit Nachtrag 43 (23.11.2026): eine Konzentrationsaufgabe, wie Claude sie laut Prompt gestaltet (frei erfunden,
// „Die Schöpfung“, Jahrgang 2) – zwei A4-Seiten: Seite 1 und die obere Hälfte von Seite 2 Ausmalbilder (nur Konturen), die untere Hälfte von Seite 2
// Lückentext, Ankreuzaufgabe und Suchsel (7 × 7, waagerecht und senkrecht) mit der roten Karte im Seitenrand und dem Satz CONC_RED_NOTE darunter.
// CONC_HTML_LONG ist dieselbe Gestaltung mit einer dritten Seite – für die Warnung „mehr als zwei Seiten“.
import { CONC_RED_NOTE } from "../../public/gsplanning.js";
const STYLE = "@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:'Atkinson Hyperlegible Next','DejaVu Sans',sans-serif;font-size:18pt;color:#000}" +
  ".seite{height:272mm;overflow:hidden;break-after:page;display:flex;flex-direction:column;gap:5mm}.seite:last-child{break-after:auto}" +
  ".kopf{display:flex;gap:10mm;font-size:16pt}.kopf span{flex:1;border-bottom:1.2pt solid #000;padding-bottom:2mm}h1{font-size:22pt;margin:0}" +
  ".bild{flex:1;min-height:0;border:1.5pt solid #000;border-radius:4mm;padding:3mm}.bild svg{display:block;width:100%;height:100%}" +
  ".seite2{height:auto;min-height:272mm;overflow:visible}.oben{flex:1 1 auto;min-height:70mm}.unten{display:grid;grid-template-columns:24mm 1fr 62mm;gap:5mm;font-size:15pt;border-top:1.5pt dashed #000;padding-top:4mm}" +
  ".rand{display:flex;flex-direction:column;align-items:center;gap:3mm;font-size:10pt;line-height:1.25;text-align:center}.rand svg{width:20mm;height:28mm}" +
  ".unten h2{font-size:15pt;margin:0 0 2mm}.unten p{margin:0;line-height:11mm}.unten p.kreuz{line-height:9mm}.luecke{display:inline-block;width:24mm;border-bottom:1.2pt solid #000}" +
  ".woerter{border:1.2pt solid #000;border-radius:2mm;padding:1mm 3mm;margin:0 0 3mm;display:flex;gap:5mm;justify-content:center}" +
  ".kreuz{display:flex;align-items:center;gap:3mm}.box{width:6mm;height:6mm;border:1.5pt solid #000;border-radius:1mm;flex:none}" +
  ".suchsel{border-collapse:collapse;margin:0 0 2mm}.suchsel td{width:8mm;height:8mm;border:1pt solid #000;text-align:center;font-size:14pt;padding:0}" +
  ".such-w{font-size:13pt;line-height:1.5}";
const S = 'fill="#fff" stroke="#000" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"';
// Tag 1: Licht und Dunkel – Sonne und Mond mit Sternen
const PIC1 = '<svg viewBox="0 0 400 220" role="img" aria-label="Ausmalbild 1: Sonne und Mond – Gott trennt das Licht von der Dunkelheit">' +
  '<line x1="200" y1="10" x2="200" y2="210" stroke="#000" stroke-width="3" stroke-dasharray="10 8"/>' +
  '<circle cx="100" cy="110" r="45" ' + S + '/>' + [0, 45, 90, 135, 180, 225, 270, 315].map((a) => { const r = a * Math.PI / 180; return '<line x1="' + (100 + 58 * Math.cos(r)).toFixed(1) + '" y1="' + (110 + 58 * Math.sin(r)).toFixed(1) + '" x2="' + (100 + 85 * Math.cos(r)).toFixed(1) + '" y2="' + (110 + 85 * Math.sin(r)).toFixed(1) + '" stroke="#000" stroke-width="5" stroke-linecap="round"/>'; }).join("") +
  '<path d="M320 50 A60 60 0 1 0 320 170 A45 45 0 1 1 320 50 Z" ' + S + '/>' +
  '<path d="M250 50 l6 14 15 1 -11 10 4 15 -14-8 -14 8 4-15 -11-10 15-1 Z" ' + S + '/><path d="M360 180 l5 11 12 1 -9 8 3 12 -11-6 -11 6 3-12 -9-8 12-1 Z" ' + S + '/></svg>';
// Tag 3: Land, Wasser und Pflanzen – Hügel, Baum, Blume, Wellen
const PIC2 = '<svg viewBox="0 0 400 220" role="img" aria-label="Ausmalbild 2: Land und Meer mit Baum und Blume">' +
  '<path d="M0 150 Q100 60 200 140 Q290 90 400 150 L400 220 L0 220 Z" ' + S + '/>' +
  '<path d="M0 185 q25-15 50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0 t50 0" fill="none" stroke="#000" stroke-width="4"/>' +
  '<rect x="92" y="70" width="18" height="50" ' + S + '/><circle cx="101" cy="58" r="34" ' + S + '/>' +
  '<line x1="290" y1="118" x2="290" y2="80" stroke="#000" stroke-width="5"/>' + [0, 72, 144, 216, 288].map((a) => { const r = a * Math.PI / 180; return '<circle cx="' + (290 + 14 * Math.cos(r)).toFixed(1) + '" cy="' + (66 + 14 * Math.sin(r)).toFixed(1) + '" r="10" ' + S + '/>'; }).join("") + '<circle cx="290" cy="66" r="8" ' + S + '/></svg>';
// Tag 5: Fische und Vögel
const PIC3 = '<svg viewBox="0 0 400 220" role="img" aria-label="Ausmalbild 3: Fische im Wasser und Vögel am Himmel">' +
  '<path d="M60 60 q25-25 50 0 q25-25 50 0" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round"/><path d="M230 40 q20-20 40 0 q20-20 40 0" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round"/>' +
  '<line x1="0" y1="110" x2="400" y2="110" stroke="#000" stroke-width="3"/>' +
  '<path d="M80 165 q50-45 100 0 q-50 45-100 0 Z" ' + S + '/><path d="M180 165 l30-25 v50 Z" ' + S + '/><circle cx="105" cy="158" r="5" fill="#000"/>' +
  '<path d="M240 175 q40-35 80 0 q-40 35-80 0 Z" ' + S + '/><path d="M320 175 l25-20 v40 Z" ' + S + '/><circle cx="262" cy="170" r="4" fill="#000"/></svg>';
const RED_CARD = '<svg viewBox="0 0 60 84" role="img" aria-label="Rote Karte"><rect x="3" y="3" width="54" height="78" rx="8" fill="#d62828" stroke="#000" stroke-width="5"/>' +
  '<rect x="10" y="10" width="40" height="64" rx="4" fill="none" stroke="#fff" stroke-width="3"/></svg>';
// Suchsel 7 × 7 (Jahrgang 2): LICHT, MEER, FISCH waagerecht, SONNE und BAUM senkrecht; die übrigen Felder feste Füllbuchstaben
const GRID = (() => {
  const g = Array.from({ length: 7 }, () => Array(7).fill(""));
  const put = (w, r, c, down) => [...w].forEach((ch, i) => { g[down ? r + i : r][down ? c : c + i] = ch; });
  put("LICHT", 0, 1); put("SONNE", 1, 0, true); put("MEER", 2, 2); put("BAUM", 2, 6, true); put("FISCH", 6, 1);
  const fill = "KDPWLATRGVHOEUZNIBXJFQ"; let k = 0;
  return g.map((row) => row.map((ch) => ch || fill[k++ % fill.length]));
})();
export const CONC_WORDS = ["LICHT", "SONNE", "MEER", "BAUM", "FISCH"];
const head = (title) => '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>' + title + '</title><style>' + STYLE + '</style></head><body>';
const PAGE1 = '<section class="seite"><div class="kopf"><span>Name:</span><span>Datum:</span></div><h1>Konzentrationsaufgabe – Die Schöpfung</h1>' +
  '<div class="bild">' + PIC1 + '</div><div class="bild">' + PIC2 + '</div></section>';
const L = '<span class="luecke"></span>';
const PAGE2 = '<section class="seite seite2"><div class="bild oben">' + PIC3 + '</div>' +
  '<div class="unten"><div class="rand">' + RED_CARD + '<span>' + CONC_RED_NOTE + '</span></div>' +
  '<div><h2>Setze die Wörter ein.</h2><div class="woerter"><span>Licht</span><span>Meer</span><span>Fische</span></div>' +
  '<p>Am ersten Tag macht Gott das ' + L + '.</p><p>Gott trennt das Land vom ' + L + '.</p><p>Im Wasser schwimmen die ' + L + '.</p>' +
  '<h2 style="margin-top:3mm">Kreuze an, was stimmt.</h2>' +
  ['Gott macht zuerst das Licht.', 'Die Fische wohnen im Baum.', 'Gott schafft Land und Meer.'].map((t) => '<p class="kreuz"><span class="box" aria-hidden="true"></span>' + t + '</p>').join('') + '</div>' +
  '<div><h2>Finde die Wörter.</h2><table class="suchsel" aria-label="Suchsel">' + GRID.map((r) => '<tr>' + r.map((ch) => '<td>' + ch + '</td>').join('') + '</tr>').join('') + '</table>' +
  '<div class="such-w">' + CONC_WORDS.join(' · ') + '</div></div></div></section>';
export const CONC_HTML = head("Konzentrationsaufgabe – Die Schöpfung") + PAGE1 + PAGE2 + '</body></html>';
export const CONC_HTML_LONG = head("Konzentrationsaufgabe – Die Schöpfung") + PAGE1 + PAGE2.replace('class="seite seite2"', 'class="seite seite2" style="break-after:page"') +
  '<section class="seite"><div class="bild">' + PIC2 + '</div></section></body></html>';
