// escape-data.js – Escape-Room-Vorlage der Plattform (Aufbau wie in den Escape-Rooms der Lehrkraft, z. B. „FastFashion“):
// Start (Angaben) → Einführung → 6 × (Bibliothek → Rätselraum; kein Weg zurück) → je gelöstem Raum ein Buchstabe des Lösungsworts →
// Finale im Feibeitsblatt (Schnittstelle v1: Hülle per Link oder eingebettet in der Überblick-PDF).
// Gemeinsam für Browser und Worker: Prüfen/Normalisieren der Inhalte (von Claude), Bewerten der Rätsel, Hilfe in drei Stufen,
// Zwischenstand-Datei, Datensatz für das Feibeitsblatt. Keine DOM-Zugriffe.

export const STATIONS = 6;
export const PART_TYPES = ["einfachwahl", "mehrfachwahl", "zuordnung", "koerbe", "luecken", "zahl", "schlussstein"];
const LETTERS = ["A", "B", "C"];
const str = (v, max) => { const s = typeof v === "string" ? v : v == null ? "" : String(v); return (max && s.length > max ? s.slice(0, max) : s).normalize("NFC"); };
const line = (v, max) => str(v).replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const text = (v, max) => str(v).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

/* ---------- Antworten vergleichen (wie im Escape-Room „FastFashion“) ---------- */
export const foldUmlauts = (s) => s.replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
export function normalizeAnswer(s) {
  return String(s == null ? "" : s).normalize("NFC").toLocaleLowerCase("de-DE")
    .replace(/[„“”"‚‘’'«»‹›]/g, "").replace(/\s+/g, " ").trim().replace(/[.,;:!?…]+$/u, "").trim();
}
export const wordKey = (s) => foldUmlauts(normalizeAnswer(s)).replace(/[\s\-‐‑‒–—]+/g, "");
export const wordMatches = (raw, accepts) => { const k = wordKey(raw); return k !== "" && accepts.some((a) => wordKey(a) === k); };
const NUM_PREFIX = /^(?:[~≈]\s*|(?:rund|ca\.?|circa|zirka|etwa|ungefähr|ungefaehr|knapp|fast)\s+)/;
export function numberMatches(raw, spec) {
  let s = normalizeAnswer(raw).replace(NUM_PREFIX, "").trim();
  if (!s) return false;
  for (const u of spec.einheiten || []) { const uu = normalizeAnswer(u); if (uu && s.length > uu.length && s.endsWith(uu)) { s = s.slice(0, -uu.length).trim(); break; } }
  if ((spec.woerter || []).some((w) => wordKey(w) === wordKey(s))) return true;
  const m = /^(\d+(?:[.,]\d+)?)$/.exec(s);
  if (!m) return false;
  const v = parseFloat(m[1].replace(",", "."));
  return v >= spec.min && v <= spec.max;
}

/* ---------- Inhalte prüfen und normalisieren ---------- */
// Wirft einen Fehler mit genauer Stelle (für Claude über den Connector), damit die Inhalte korrigiert werden können.
export function normalizeEscapeRoom(raw, opt = {}) {
  const r = obj(raw), errs = [];
  const fail = (msg) => errs.push(msg);
  const wort = foldUmlauts(line(r.loesungswort || r.wort, 20).toLocaleLowerCase("de-DE")).toUpperCase();
  if (!/^[A-Z]{6}$/.test(wort)) fail("loesungswort: genau 6 Buchstaben A–Z (ohne Umlaute), z. B. „GRUNDG“ – erhalten: „" + line(r.loesungswort || r.wort, 20) + "“.");
  const name = line(r.name, 80) || line(r.titel, 80);
  if (!name) fail("name: Name des Escape-Rooms fehlt (höchstens 80 Zeichen).");
  const rahmen = obj(r.rahmen);
  const st = arr(r.stationen);
  if (st.length !== STATIONS) fail("stationen: genau " + STATIONS + " Stationen nötig (erhalten: " + st.length + ").");
  const stationen = st.slice(0, STATIONS).map((s0, i) => {
    const s = obj(s0), where = "Station " + (i + 1);
    const bib = obj(s.bibliothek), abschnitte = arr(bib.abschnitte).slice(0, 6).map((a0) => {
      const a = obj(a0);
      return { ueberschrift: line(a.ueberschrift, 120), text: text(a.text, 2400), liste: arr(a.liste).map((x) => line(x, 400)).filter(Boolean).slice(0, 10) };
    }).filter((a) => a.text || a.liste.length);
    if (abschnitte.length < 2) fail(where + ": die Bibliothek braucht 2–6 Abschnitte (Sachtexte mit Überschrift).");
    const ra = obj(s.raetsel), nSec = abschnitte.length;
    const teile = arr(ra.teile).slice(0, 3).map((p, k) => normPart(p, where + ", Teil " + LETTERS[k], nSec, i === STATIONS - 1, wort, fail));
    if (!teile.length) fail(where + ": der Rätselraum braucht 1–3 Teile.");
    const titel = line(s.titel, 80) || "Station " + (i + 1);
    return {
      nr: i + 1, titel, ort: line(s.ort, 120), label: "Station " + (i + 1) + " · " + titel, buchstabe: wort[i] || "?",
      bibliothek: { einleitung: text(bib.einleitung, 600), abschnitte },
      raetsel: { auftrag: text(ra.auftrag, 600), erfolg: text(ra.erfolg, 400) || "Geschafft – der Raum ist gelöst.", teile: teile.filter(Boolean) },
      erlaeuterung: text(s.erlaeuterung, 3500),
    };
  });
  const fin = obj(r.finale), fb = obj(r.feibeitsblatt);
  const aufgaben = arr(fb.aufgaben).slice(0, 10).map((a0) => { const a = obj(a0); return { text: text(a.text, 4000), ki_auftrag: text(a.ki_auftrag, 4000) }; }).filter((a) => a.text);
  if (!aufgaben.length) fail("feibeitsblatt: das Finale braucht 1–10 Aufgaben (text, ki_auftrag) – z. B. Transfer- oder Urteilsaufgaben zu den Stationen.");
  if (errs.length) throw new Error("Der Escape-Room ist noch nicht vollständig:\n- " + errs.slice(0, 25).join("\n- "));
  const id = opt.id && /^[a-z0-9-]{3,60}$/.test(opt.id) ? opt.id : "unterricks-" + Math.random().toString(16).slice(2, 10);
  const room = {
    v: 1, id, name, titel: line(r.titel, 120) || name, untertitel: text(r.untertitel, 400), wort, magic: magicOf(id),
    fach: line(opt.fach, 80), klasse: line(opt.klasse, 40),
    rahmen: { sprecher: line(rahmen.sprecher, 80) || "Auftrag", auftrag: text(rahmen.auftrag, 1500), rolle: text(rahmen.rolle, 800) },
    stationen,
    finale: { ueberschrift: line(fin.ueberschrift, 120) || "Das Finale", text: text(fin.text, 1500), warum: text(fin.warum, 800),
      rueckblick: arr(fin.rueckblick).map((x) => line(x, 300)).filter(Boolean).slice(0, 8), schluss: text(fin.schluss, 400) },
    feibeitsblatt: { titel: line(fb.titel, 120) || "Finale: " + name, aufgaben },
  };
  if (JSON.stringify(room).length > 150000) throw new Error("Der Escape-Room ist zu umfangreich (höchstens ca. 150 000 Zeichen) – bitte die Bibliothekstexte kürzen.");
  return room;
}
function magicOf(id) { let h = 7; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 9973; return 100 + (h % 900); }
const ref = (v, nSec) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= nSec ? n : null; };

function normPart(p0, where, nSec, last, wort, fail) {
  const p = obj(p0), typ = String(p.typ || "").trim();
  if (!PART_TYPES.includes(typ)) { fail(where + ": unbekannter typ „" + typ + "“ (erlaubt: " + PART_TYPES.join(", ") + ")."); return null; }
  const base = { typ, frage: text(p.frage || p.anweisung, 600) };
  if (typ === "einfachwahl") {
    const optionen = arr(p.optionen).slice(0, 6).map((o0) => { const o = obj(o0); return { text: line(o.text, 300), richtig: o.richtig === true }; }).filter((o) => o.text);
    if (optionen.length < 2) fail(where + " (einfachwahl): 2–6 Optionen nötig.");
    if (optionen.filter((o) => o.richtig).length !== 1) fail(where + " (einfachwahl): genau eine Option muss richtig sein.");
    if (!base.frage) fail(where + " (einfachwahl): frage fehlt.");
    const right = optionen.find((o) => o.richtig);
    return { ...base, optionen, abschnitt: ref(p.abschnitt, nSec), anfang: line(p.anfang, 60), loesung: line(p.loesung, 400) || (right ? right.text : "") };
  }
  if (typ === "mehrfachwahl") {
    const optionen = arr(p.optionen).slice(0, 10).map((o0) => { const o = obj(o0); return { text: line(o.text, 300), richtig: o.richtig === true, erklaerung: line(o.erklaerung, 400) }; }).filter((o) => o.text);
    const nOk = optionen.filter((o) => o.richtig).length;
    if (optionen.length < 3 || nOk < 1 || nOk === optionen.length) fail(where + " (mehrfachwahl): 3–10 Optionen, mindestens eine richtige und eine falsche.");
    if (!base.frage) fail(where + " (mehrfachwahl): frage fehlt.");
    return { ...base, optionen, abschnitt: ref(p.abschnitt, nSec) };
  }
  if (typ === "zuordnung") {
    const optionen = [...new Set(arr(p.optionen).map((x) => line(x, 200)).filter(Boolean))].slice(0, 8);
    const zeilen = arr(p.zeilen).slice(0, 8).map((z0) => { const z = obj(z0); return { text: line(z.text, 300), antwort: line(z.antwort, 200), abschnitt: ref(z.abschnitt, nSec), anfang: line(z.anfang, 60) }; }).filter((z) => z.text);
    if (zeilen.length < 2 || optionen.length < 2) fail(where + " (zuordnung): 2–8 Zeilen und 2–8 Optionen nötig.");
    for (const z of zeilen) if (!optionen.includes(z.antwort)) fail(where + " (zuordnung): die Antwort „" + z.antwort + "“ (Zeile „" + z.text.slice(0, 40) + "“) steht nicht wörtlich in den optionen.");
    return { ...base, optionen, zeilen };
  }
  if (typ === "koerbe") {
    const koerbe = arr(p.koerbe).slice(0, 2).map((k0) => { const k = obj(k0); return { name: line(k.name, 80), anfang: line(k.anfang, 40) }; }).filter((k) => k.name);
    const karten = arr(p.karten).slice(0, 12).map((c0) => { const c = obj(c0); return { text: line(c.text, 240), korb: Number(c.korb) === 2 ? 1 : Number(c.korb) === 1 ? 0 : -1, abschnitt: ref(c.abschnitt, nSec) }; }).filter((c) => c.text);
    if (koerbe.length !== 2) fail(where + " (koerbe): genau 2 Körbe (name) nötig.");
    if (karten.length < 4 || karten.some((c) => c.korb < 0)) fail(where + " (koerbe): 4–12 Karten, jede mit korb 1 oder 2.");
    return { ...base, koerbe, karten };
  }
  if (typ === "luecken") {
    const luecken = arr(p.luecken).slice(0, 8).map((g0) => { const g = obj(g0); return { nr: Number(g.nr), loesungen: arr(g.loesungen).map((x) => line(x, 120)).filter(Boolean).slice(0, 12),
      abschnitt: ref(g.abschnitt, nSec), hinweis: line(g.hinweis, 300), loesung: line(g.loesung, 200) }; }).filter((g) => Number.isInteger(g.nr));
    const src = text(p.text, 3000), segmente = [], used = new Set();
    let last0 = 0;
    for (const m of src.matchAll(/\[\[(\d+)\]\]/g)) {
      const nr = Number(m[1]);
      if (m.index > last0) segmente.push(src.slice(last0, m.index));
      if (used.has(nr)) fail(where + " (luecken): die Lücke [[" + nr + "]] kommt mehrfach vor.");
      used.add(nr); segmente.push({ luecke: nr }); last0 = m.index + m[0].length;
    }
    if (last0 < src.length) segmente.push(src.slice(last0));
    if (!luecken.length || luecken.length !== used.size || luecken.some((g) => !used.has(g.nr))) fail(where + " (luecken): jede Lücke im text als [[nr]] genau einmal, zu jeder eine Angabe in luecken (erhalten: " + used.size + " Platzhalter, " + luecken.length + " Lücken).");
    for (const g of luecken) if (!g.loesungen.length) fail(where + " (luecken): Lücke " + g.nr + " braucht loesungen (Varianten mit/ohne Umlaut, Singular/Plural).");
    const wortbank = arr(p.wortbank).map((x) => line(x, 120)).filter(Boolean).slice(0, 16);
    if (wortbank.length) for (const g of luecken) if (!wortbank.includes(g.loesungen[0])) fail(where + " (luecken): bei einer wortbank muss die erste Lösung jeder Lücke wörtlich in der wortbank stehen (Lücke " + g.nr + ").");
    // Satz je Lücke für die Fehlerliste: der Text um die Lücke herum
    const plain = (k) => segmente.map((s) => (typeof s === "string" ? s : s.luecke === k ? "___" : "…")).join("");
    for (const g of luecken) { const t = plain(g.nr), i = t.indexOf("___"); g.satz = (i > 90 ? "…" : "") + t.slice(Math.max(0, i - 90), i + 93).replace(/\s+/g, " ").trim() + (i + 93 < t.length ? "…" : ""); g.loesung = g.loesung || g.loesungen[0]; }
    return { ...base, segmente, luecken: segmente.filter((s) => typeof s !== "string").map((s) => luecken.find((g) => g.nr === s.luecke)).filter(Boolean), wortbank: wortbank.length ? wortbank : null };
  }
  if (typ === "zahl") {
    const min = Number(p.min), max = Number(p.max);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) fail(where + " (zahl): min und max (Zahlen, min ≤ max) nötig.");
    if (!base.frage) fail(where + " (zahl): frage fehlt.");
    return { ...base, einheit: line(p.einheit, 30), min, max, woerter: arr(p.woerter).map((x) => line(x, 60)).filter(Boolean).slice(0, 6),
      einheiten: [line(p.einheit, 30), ...arr(p.einheiten).map((x) => line(x, 30))].filter(Boolean).slice(0, 6), abschnitt: ref(p.abschnitt, nSec), hinweis: line(p.hinweis, 300), loesung: line(p.loesung, 200) || String(min === max ? min : min + "–" + max) };
  }
  // schlussstein
  if (!last) fail(where + ": einen Schlussstein gibt es nur in der letzten Station.");
  const loesungen = arr(p.loesungen).map((x) => line(x, 120)).filter(Boolean).slice(0, 12);
  if (!loesungen.length) fail(where + " (schlussstein): loesungen fehlen.");
  return { ...base, loesungen, hinweis1: line(p.hinweis1, 300), hinweis2: line(p.hinweis2, 300), loesung: line(p.loesung, 200) || loesungen[0] };
}

/* ---------- Bewerten ---------- */
// ans je Teil: einfachwahl Index | mehrfachwahl [Indizes] | zuordnung {Zeile: Option} | koerbe {Karte: 0|1} | luecken {nr: Text} | zahl/schlussstein Text
export function missingOf(part, ans) {
  const a = ans == null ? {} : ans;
  if (part.typ === "einfachwahl") return Number.isInteger(ans) ? 0 : 1;
  if (part.typ === "mehrfachwahl") return Array.isArray(ans) && ans.length ? 0 : 1;
  if (part.typ === "zuordnung") return part.zeilen.filter((_, i) => !a[i]).length;
  if (part.typ === "koerbe") return part.karten.filter((_, i) => a[i] !== 0 && a[i] !== 1).length;
  if (part.typ === "luecken" && part.wortbank) return part.luecken.filter((g) => !a[g.nr]).length;
  return 0;   // freie Felder: leer zählt als falsch („(leer)“), nicht als unvollständig
}
const q = (s) => "„" + String(s).replace(/„/g, "‚").replace(/[“”]/g, "‘") + "“";
// Ergebnis: { n, errors: [{kind, item, wrong, right}], helps: [{name, s1, s2, s3}], marks: {Schlüssel: true|false} }
export function gradePart(station, part, ans, letter) {
  const secs = station.bibliothek.abschnitte, out = { n: 0, errors: [], helps: [], marks: {} };
  const where = (p) => (p ? "Abschnitt " + p + (secs[p - 1] && secs[p - 1].ueberschrift ? " – " + secs[p - 1].ueberschrift : "") : "Lies die Bibliothek dieser Station noch einmal (deine Notizen helfen).");
  const startHint = (s, fallback) => (s ? "Die richtige Antwort beginnt mit " + q(s + " …") + "." : fallback);
  const a = ans == null ? {} : ans;
  const name = (n) => (letter ? "Teil " + letter + ": " : "") + n;
  if (part.typ === "einfachwahl") {
    out.n++; const k = Number.isInteger(ans) ? ans : -1, ok = !!(part.optionen[k] && part.optionen[k].richtig), right = part.optionen.find((o) => o.richtig);
    out.marks["o" + k] = ok;
    if (!ok) { out.errors.push({ kind: "mc", item: part.frage, wrong: part.optionen[k] ? part.optionen[k].text : "(keine Auswahl)", right: right.text });
      out.helps.push({ name: name("Frage"), s1: where(part.abschnitt), s2: startHint(part.anfang, where(part.abschnitt)), s3: "Lösung: " + part.loesung }); }
  } else if (part.typ === "mehrfachwahl") {
    // markiert werden nur die ausgewählten Aussagen (sonst verriete die Markierung die fehlenden); die Hilfe steigert sich je Versuch
    const chosen = new Set(Array.isArray(ans) ? ans : []), wrongChosen = [], missed = [];
    part.optionen.forEach((o, i) => {
      out.n++; const ok = chosen.has(i) === o.richtig;
      if (chosen.has(i)) out.marks["o" + i] = ok;
      if (!ok) {
        (o.richtig ? missed : wrongChosen).push(o);
        out.errors.push(o.richtig ? { kind: "uebersehen", item: "Übersehen: " + q(o.text), note: o.erklaerung } : { kind: "falsch_gewaehlt", item: "Falsch ausgewählt: " + q(o.text), note: o.erklaerung });
      }
    });
    if (wrongChosen.length || missed.length) {
      const count = [wrongChosen.length ? wrongChosen.length + " ausgewählte Aussage" + (wrongChosen.length === 1 ? " stimmt" : "n stimmen") + " nicht" : "",
        missed.length ? missed.length + " richtige Aussage" + (missed.length === 1 ? " fehlt" : "n fehlen") + " noch" : ""].filter(Boolean).join(", ");
      out.helps.push({ name: name("Auswahl"), s1: where(part.abschnitt) + " (" + count + ")",
        s2: (wrongChosen.length ? "Nicht zutreffend: " + wrongChosen.map((o) => q(o.text)).join(", ") + ". " : "") + (missed.length ? "Es " + (missed.length === 1 ? "fehlt noch eine richtige Aussage." : "fehlen noch " + missed.length + " richtige Aussagen.") : ""),
        s3: "Lösung – richtig sind: " + part.optionen.filter((o) => o.richtig).map((o) => q(o.text)).join(", ") + "." });
    }
  } else if (part.typ === "zuordnung") {
    part.zeilen.forEach((z, i) => {
      out.n++; const val = a[i] || "", ok = val === z.antwort; out.marks["r" + i] = ok;
      if (!ok) { out.errors.push({ kind: "zuordnung", item: z.text, wrong: val || "(leer)", right: z.antwort });
        const words = z.text.split(/\s+/);
        out.helps.push({ name: name("Zeile " + (words.length <= 6 ? q(z.text) : q(words.slice(0, 6).join(" ") + " …"))), s1: where(z.abschnitt), s2: startHint(z.anfang, where(z.abschnitt)), s3: "Lösung: " + z.antwort }); }
    });
  } else if (part.typ === "koerbe") {
    part.karten.forEach((c, i) => {
      out.n++; const ch = a[i], ok = ch === c.korb; out.marks["c" + i] = ok;
      if (!ok) { const right = part.koerbe[c.korb], wrong = part.koerbe[ch];
        out.errors.push({ kind: "korb", item: c.text, wrong: wrong ? wrong.name : "(kein Korb)", right: right.name });
        out.helps.push({ name: name("Karte " + q(c.text)), s1: where(c.abschnitt), s2: right.anfang ? "Der richtige Korb beginnt mit " + q(right.anfang + " …") + "." : where(c.abschnitt), s3: "Lösung: " + right.name }); }
    });
  } else if (part.typ === "luecken") {
    part.luecken.forEach((g, k) => {
      out.n++; const raw = String(a[g.nr] || ""), ok = part.wortbank ? raw === g.loesungen[0] : wordMatches(raw, g.loesungen); out.marks["g" + g.nr] = ok;
      if (!ok) { out.errors.push({ kind: "luecke", item: "Lücke " + (k + 1) + ": " + g.satz, wrong: raw.trim().slice(0, 200) || "(leer)", right: g.loesung });
        out.helps.push({ name: name("Lücke " + (k + 1)), s1: where(g.abschnitt), s2: g.hinweis || startHint(g.loesung.slice(0, Math.max(1, Math.ceil(g.loesung.length / 3))), where(g.abschnitt)), s3: "Lösung: " + g.loesung }); }
    });
  } else if (part.typ === "zahl") {
    out.n++; const raw = String(ans || ""), ok = numberMatches(raw, part); out.marks.in = ok;
    if (!ok) { out.errors.push({ kind: "zahl", item: part.frage, wrong: raw.trim().slice(0, 200) || "(leer)", right: part.loesung });
      out.helps.push({ name: name("Zahl"), s1: where(part.abschnitt), s2: part.hinweis || where(part.abschnitt), s3: "Lösung: " + part.loesung + (part.einheit ? " " + part.einheit : "") }); }
  } else if (part.typ === "schlussstein") {
    out.n++; const raw = String(ans || ""), ok = wordMatches(raw, part.loesungen); out.marks.in = ok;
    if (!ok) { out.errors.push({ kind: "schlussstein", item: "Schlussstein: " + part.frage, wrong: raw.trim().slice(0, 200) || "(leer)", right: part.loesung });
      out.helps.push({ name: "Schlussstein", s1: part.hinweis1 || "Denk an alle Stationen zusammen.", s2: part.hinweis2 || startHint(part.loesung.slice(0, 3), ""), s3: "Lösung: " + part.loesung }); }
  }
  return out;
}
export const HELP_HEADS = ["Hilfe – Stufe 1 von 3: Wo stand es?", "Hilfe – Stufe 2 von 3: Der Anfang", "Hilfe – Stufe 3 von 3: Die Lösung"];
export const PART_LETTERS = LETTERS;

/* ---------- Bestätigungscode, Prüfsumme, Datensatz für das Feibeitsblatt (Schnittstelle v1) ---------- */
export function confirmCode(birthDate, magic) {
  const d = String(birthDate || "").replace(/\D/g, "");
  return d ? String(parseInt(d, 10) * 1104 + (magic || 0)) : "";
}
export function fbEscapeHash(s) {   // cyrb53-Variante, 64 Bit als 16 Hex-Zeichen (identisch mit Feibeitsblatt)
  let h1 = 0xdeadbeef ^ s.length, h2 = 0x41c6ce57 ^ s.length;
  for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
export const normKlasse = (v) => String(v || "").replace(/[\s.]+/g, "");
// st = Spielstand { firstName, lastName, birthDate, klasse, attempts[6], mistakes[6], completedAt, resumeLog[] }
export function escapeRecord(room, st, sheetCode, url) {
  const iso = (d) => { const x = new Date(d); return Number.isNaN(x.getTime()) ? "" : x.toISOString(); };
  const data = {
    code: sheetCode || "",
    room: { id: room.id, name: room.name, url: url || "" },
    person: { vorname: line(st.firstName, 60), nachname: line(st.lastName, 60), geburtsdatum: st.birthDate || "", klasse: normKlasse(st.klasse).slice(0, 10) },
    confirm: confirmCode(st.birthDate, room.magic),
    word: room.wort,
    completedAt: iso(st.completedAt || Date.now()),
    stations: room.stationen.map((s, i) => ({ label: s.label, attempts: Math.min(999, st.attempts[i] || 0),
      errors: ((st.mistakes[i] && st.mistakes[i].errors) || []).slice(0, 30).map((e) => {
        const o = { item: line(e.item, 2000) };
        for (const k of ["wrong", "right", "note"]) if (e[k]) o[k] = line(e[k], 2000);
        return o;
      }) })),
    notes: room.stationen.map((s) => ({ label: s.label, text: text(s.erlaeuterung, 4000) })),
    resumes: (st.resumeLog || []).slice(-20).map((r) => ({ place: line(r.place, 2000), savedAt: iso(r.savedAt), loadedAt: iso(r.loadedAt) })),
  };
  const d = JSON.stringify(data);
  return { kind: "feibeitsblatt-escape", v: 1, d, s: fbEscapeHash("FbEscape|v1|" + d) };
}
export function b64url(s) {
  const bytes = new TextEncoder().encode(s); let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export const tunnelUrl = (fbUrl, hull) => String(fbUrl || "").replace(/#.*$/, "") + "#escape=" + b64url(JSON.stringify(hull));

/* ---------- Zwischenstand-Datei (.txt): wie in den Escape-Rooms der Lehrkraft verschleiert + Prüfsumme, nur für diesen Raum ---------- */
const SAVE_SALT = "Zwischenstand|Escape-Room|v1", SAVE_FORMAT = 1;
export const SAVE_BEGIN = "-----BEGIN ZWISCHENSTAND-----", SAVE_END = "-----END ZWISCHENSTAND-----";
function scramble(bytes) {
  let s = parseInt(fbEscapeHash(SAVE_SALT).slice(0, 8), 16) >>> 0;
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); out[i] = bytes[i] ^ ((t ^ (t >>> 14)) & 0xFF); }
  return out;
}
export function saveEncode(roomId, data) {
  const json = JSON.stringify(data);
  const wrap = JSON.stringify({ f: SAVE_FORMAT, id: roomId, s: fbEscapeHash(SAVE_SALT + "|" + roomId + "|" + json), d: json });
  const bytes = scramble(new TextEncoder().encode(wrap));
  let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/.{1,76}/g, "$&\r\n").trim();
}
export function saveDecode(roomId, roomName, txt) {
  const m = /-----BEGIN ZWISCHENSTAND(?: V(\d+))?-----/.exec(txt), b = m ? txt.indexOf(SAVE_END, m.index) : -1;
  if (!m || b < 0) throw new Error("Das ist keine Zwischenstand-Datei. Bitte wähle die Datei „Zwischenstand zum Escape-Room " + roomName + " vom … von …“ aus.");
  const broken = "Diese Zwischenstand-Datei wurde verändert oder ist beschädigt und kann nicht geladen werden.";
  let wrap;
  try {
    const bin = atob(txt.slice(m.index + m[0].length, b).replace(/[^A-Za-z0-9+/=]/g, ""));
    const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    wrap = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(scramble(bytes)));
  } catch { throw new Error(broken); }
  if (!wrap || typeof wrap.d !== "string" || typeof wrap.id !== "string" || wrap.s !== fbEscapeHash(SAVE_SALT + "|" + wrap.id + "|" + wrap.d)) throw new Error(broken);
  let data; try { data = JSON.parse(wrap.d); } catch { throw new Error(broken); }
  if (wrap.id !== roomId) throw new Error("Diese Zwischenstand-Datei gehört zu einem anderen Escape-Room" + (data && data.game ? " („" + data.game + "“)" : "") + ". Bitte öffne den passenden Escape-Room.");
  if (!data || typeof data !== "object" || !data.state || typeof data.state !== "object" || typeof data.screen !== "string") throw new Error(broken);
  return data;
}

/* ---------- Beschreibung des Formats für Claude (Prompt und Connector) ---------- */
export const ESCAPE_FORMAT_HINT = [
  "Aufbau (wie die bekannten Escape-Rooms der Lehrkraft): Einführung mit Rahmengeschichte → 6 Stationen, jede mit Bibliothek (2–6 Sachtext-Abschnitte mit Überschrift; die Schüler:innen lesen und machen Notizen, es gibt kein Zurück) und Rätselraum (1–3 Teile) → je gelöster Station ein Buchstabe des 6-buchstabigen Lösungsworts → Finale im Feibeitsblatt (Transfer-/Urteilsaufgaben mit KI-Rückmeldung).",
  "Rätseltypen (Feld typ): einfachwahl {frage, optionen:[{text, richtig}] (genau eine richtig), abschnitt, anfang, loesung} · mehrfachwahl {frage, optionen:[{text, richtig, erklaerung}]} · zuordnung {frage, optionen:[…], zeilen:[{text, antwort (wörtlich aus optionen), abschnitt, anfang}]} · koerbe {frage, koerbe:[{name, anfang}, {name, anfang}], karten:[{text, korb: 1|2, abschnitt}]} · luecken {frage, text mit [[1]], [[2]] …, luecken:[{nr, loesungen:[Varianten], abschnitt, hinweis, loesung}], wortbank (optional: Auswahlliste inkl. Ablenker)} · zahl {frage, einheit, min, max, abschnitt, hinweis, loesung} · schlussstein {frage, loesungen, hinweis1, hinweis2, loesung} (nur letzte Station, z. B. das Lösungswort oder der Schlüsselbegriff).",
  "abschnitt = Nummer des Bibliotheksabschnitts (ab 1), in dem die Antwort steht – daraus entsteht die Hilfe (Stufe 1: wo es stand, Stufe 2: Anfang der Antwort, Stufe 3: Lösung). Freie Antworten großzügig mit Varianten (mit/ohne Umlaut, Artikel, Plural), Zahlen ohne Tausenderpunkte.",
  "Jede Station: titel, ort (im Rahmen der Geschichte), bibliothek {einleitung, abschnitte:[{ueberschrift, text, liste?}]}, raetsel {auftrag (ein Satz in der Stimme der Geschichte), teile, erfolg (ein Satz)}, erlaeuterung (Lösungserläuterung, 400–1200 Zeichen). Dazu: name (≤ 80 Zeichen), titel, untertitel, loesungswort (6 Buchstaben A–Z), rahmen {sprecher, auftrag, rolle}, finale {ueberschrift, text, warum (warum dieses Lösungswort), rueckblick (6 Stichpunkte), schluss}, feibeitsblatt {titel, aufgaben:[{text, ki_auftrag}]} – ki_auftrag ist keine Musterlösung, sondern der Auftrag an die korrigierende KI (worauf sie bei der Rückmeldung achten soll, Erwartungen passend zur Jahrgangsstufe).",
  "Sprache: Deutsch, Schüler:innen duzen, echte Umlaute und „…“, fiktiver Rahmen mit erkennbarer Stimme, Sachtexte fachlich korrekt und altersgerecht; reale Fakten mit Stand kennzeichnen.",
].join("\n");
