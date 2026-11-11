// zip.js – mehrere Dateien als eine ZIP-Datei („Alle herunterladen“ der Druckliste, Sitzung als Datei). Ohne Bibliothek: Verfahren
// „stored“ (PDFs sind schon komprimiert), Dateinamen in UTF-8 (Bit 11), CRC-32 nach ISO 3309. readZip liest solche Dateien wieder
// (auch „deflate“, falls die Datei von einem anderen Programm neu gepackt wurde).
const te = new TextEncoder(), td = new TextDecoder();
let CRC = null;
export function crc32(u8) {
  if (!CRC) { CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
/* Namen eindeutig machen: „Name.pdf“, „Name (2).pdf“ … */
export function uniqueNames(names) {
  const seen = new Map();
  return names.map((n) => {
    let k = n, i = 1;
    while (seen.has(k.toLowerCase())) { i++; k = n.replace(/(\.[^.]+)?$/, (ext) => " (" + i + ")" + (ext || "")); }
    seen.set(k.toLowerCase(), true);
    return k;
  });
}
/* entries = [{ name, data: Uint8Array }] → Uint8Array der ZIP-Datei */
/* Pfad in der ZIP-Datei: „/“ trennt Ordner; nie absolut, nie „..“ (sonst landeten Dateien beim Entpacken außerhalb des Ordners) */
export const zipPath = (n) => String(n).replace(/\\/g, "/").split("/").map((p) => p.trim()).filter((p) => p && p !== "." && p !== "..").join("/") || "Datei";
export function makeZip(entries, when = new Date()) {
  const names = uniqueNames(entries.map((e) => zipPath(e.name)));
  const parts = [], central = [];
  let offset = 0;
  entries.forEach((e, i) => {
    const name = te.encode(names[i]), data = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime(when), true); local.setUint16(12, dosDate(when), true); local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime(when), true); cd.setUint16(14, dosDate(when), true); cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  });
  const cdSize = central.reduce((n, x) => n + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
  let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
  return out;
}
/* Große ZIP-Datei als Blob (Sicherung aller Unterrichtsinhalte, Einheit als Datei): Einträge nacheinander hinzufügen – jeder wird sofort
   zu einem Blob (der Browser darf ihn auslagern), sodass nie alles zugleich im Arbeitsspeicher liegt. Ab 4 GiB bzw. 65 535 Einträgen
   ZIP64 (Verzeichniseintrag und Abschluss); ein einzelner Eintrag bleibt unter 4 GiB. limit64 nur für Tests (kleinere Grenze). */
export class ZipBlob {
  constructor({ when = new Date(), limit64 = 0xffffffff } = {}) { this.when = when; this.limit = limit64; this.parts = []; this.central = []; this.offset = 0; this.count = 0; this.seen = new Map(); }
  /* eindeutiger Pfad: Dateien „Name (2).pdf“, Ordner (folder) „Name (2)“ */
  unique(n, folder = false) {
    let k = zipPath(n), i = 1;
    const base = k;
    while (this.seen.has(k.toLowerCase())) { i++; k = folder ? base + " (" + i + ")" : base.replace(/(\.[^./]+)?$/, (ext) => " (" + i + ")" + (ext || "")); }
    this.seen.set(k.toLowerCase(), true);
    return k;
  }
  /* data: Uint8Array; gibt den tatsächlichen Namen zurück (bei Doppelungen „ (2)“) */
  add(name, data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data), size = u8.length;
    if (size >= 0xffffffff) throw new Error("„" + name + "“ ist zu groß für die ZIP-Datei (über 4 GB).");
    const path = this.unique(name), nm = te.encode(path), crc = crc32(u8), when = this.when;
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true);
    local.setUint16(10, dosTime(when), true); local.setUint16(12, dosDate(when), true); local.setUint32(14, crc, true);
    local.setUint32(18, size, true); local.setUint32(22, size, true); local.setUint16(26, nm.length, true); local.setUint16(28, 0, true);
    this.parts.push(new Uint8Array(local.buffer), nm, new Blob([u8]));
    const big = this.offset >= this.limit, extra = big ? 12 : 0;
    const cd = new DataView(new ArrayBuffer(46 + nm.length + extra));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, big ? 45 : 20, true); cd.setUint16(6, big ? 45 : 20, true); cd.setUint16(8, 0x0800, true); cd.setUint16(10, 0, true);
    cd.setUint16(12, dosTime(when), true); cd.setUint16(14, dosDate(when), true); cd.setUint32(16, crc, true); cd.setUint32(20, size, true); cd.setUint32(24, size, true);
    cd.setUint16(28, nm.length, true); cd.setUint16(30, extra, true); cd.setUint32(42, big ? 0xffffffff : this.offset, true);
    new Uint8Array(cd.buffer).set(nm, 46);
    if (big) { cd.setUint16(46 + nm.length, 0x0001, true); cd.setUint16(48 + nm.length, 8, true); setU64(cd, 50 + nm.length, this.offset); }   // ZIP64: Lage des Eintrags
    this.central.push(new Uint8Array(cd.buffer));
    this.offset += 30 + nm.length + size; this.count++;
    return path;
  }
  get size() { return this.offset; }
  /* fertige ZIP-Datei */
  finish(type = "application/zip") {
    const cdSize = this.central.reduce((n, x) => n + x.length, 0), cdAt = this.offset, tail = [];
    const z64 = this.count >= 0xffff || cdAt >= this.limit || cdSize >= this.limit;
    if (z64) {
      const r = new DataView(new ArrayBuffer(56));   // ZIP64-Abschluss des Verzeichnisses
      r.setUint32(0, 0x06064b50, true); setU64(r, 4, 44); r.setUint16(12, 45, true); r.setUint16(14, 45, true);
      setU64(r, 24, this.count); setU64(r, 32, this.count); setU64(r, 40, cdSize); setU64(r, 48, cdAt);
      const loc = new DataView(new ArrayBuffer(20));   // … und sein Verweis
      loc.setUint32(0, 0x07064b50, true); setU64(loc, 8, cdAt + cdSize); loc.setUint32(16, 1, true);
      tail.push(new Uint8Array(r.buffer), new Uint8Array(loc.buffer));
    }
    const end = new DataView(new ArrayBuffer(22)), n16 = z64 ? 0xffff : this.count;
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, n16, true); end.setUint16(10, n16, true);
    end.setUint32(12, z64 ? 0xffffffff : cdSize, true); end.setUint32(16, z64 ? 0xffffffff : cdAt, true);
    return new Blob([...this.parts, ...this.central, ...tail, new Uint8Array(end.buffer)], { type });
  }
}
function setU64(dv, at, v) { dv.setUint32(at, v % 0x100000000, true); dv.setUint32(at + 4, Math.floor(v / 0x100000000), true); }

/* Name eines Eintrags: UTF-8 (Bit 11 oder gültiges UTF-8), sonst Codepage 437 – so packt z. B. Windows („Senden an → ZIP-komprimierter
   Ordner“) Umlaute; immer in NFC (macOS liefert Namen zerlegt) */
const CP437_HI = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";
const tdStrict = new TextDecoder("utf-8", { fatal: true });
function zipName(b, utf8) {
  let s;
  if (utf8) s = td.decode(b);
  else { try { s = tdStrict.decode(b); } catch { s = Array.from(b, (c) => (c < 128 ? String.fromCharCode(c) : CP437_HI[c - 128])).join(""); } }
  return s.normalize("NFC");
}
/* ZIP lesen → [{ name, data }] (Verzeichnisse übersprungen); prüft die CRC */
export async function readZip(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let e = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error("Das ist keine ZIP-Datei.");
  let n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true);
  const u64 = (at) => dv.getUint32(at, true) + dv.getUint32(at + 4, true) * 0x100000000;
  if ((n === 0xffff || p === 0xffffffff) && e >= 20 && dv.getUint32(e - 20, true) === 0x07064b50) {   // ZIP64 (große Sicherungen)
    const r = u64(e - 12);
    if (r + 56 > u8.length || dv.getUint32(r, true) !== 0x06064b50) throw new Error("Die ZIP-Datei ist beschädigt.");
    n = u64(r + 32); p = u64(r + 48);
  }
  if (p >= u8.length) throw new Error("Die ZIP-Datei ist beschädigt.");
  const out = [];
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error("Die ZIP-Datei ist beschädigt.");
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    let lo = dv.getUint32(p + 42, true);
    const name = zipName(u8.subarray(p + 46, p + 46 + nl), (dv.getUint16(p + 8, true) & 0x0800) !== 0);
    if (lo === 0xffffffff) {   // ZIP64: Lage im Zusatzfeld 0x0001 (Größen hier immer unter 4 GiB)
      for (let x = p + 46 + nl, xe = x + xl; x + 4 <= xe;) {
        const id = dv.getUint16(x, true), len = dv.getUint16(x + 2, true);
        if (id === 0x0001) { let q = x + 4; if (dv.getUint32(p + 24, true) === 0xffffffff) q += 8; if (dv.getUint32(p + 20, true) === 0xffffffff) q += 8; lo = u64(q); break; }
        x += 4 + len;
      }
    }
    if (lo + 30 > u8.length) throw new Error("Die ZIP-Datei ist beschädigt.");
    p += 46 + nl + xl + cl;
    if (name.endsWith("/")) continue;
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else throw new Error("Diese ZIP-Datei nutzt ein unbekanntes Verfahren.");
    if (crc32(data) !== crc) throw new Error("Die ZIP-Datei ist beschädigt (Prüfsumme von „" + name + "“).");
    out.push({ name, data });
  }
  return out;
}
