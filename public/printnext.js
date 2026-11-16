// printnext.js – Feld „Druckaufträge“ ganz oben auf beiden Startseiten der Lehrkraft (Gymnasium und Übersicht „Grundschule“; Anforderung 14): die
// Druckaufträge BEIDER Schulformen für den nächsten Tag mit Unterricht (GET /api/teacher/print-next, worker/printjobs.js), nach Sitzung gruppiert –
// seit Nachtrag 33 daneben die Sitzungen von heute, bis die jeweilige Sitzung vorbei ist (geplantes Ende = Beginn + Dauer; ohne Uhrzeit bis zum Ende
// des Tages): dann zwei Tagesabschnitte („Heute, Montag, 16.11.2026“ / „Morgen, Dienstag, 17.11.2026“), jeder mit eigenem „Alle Dateien
// herunterladen“; endet eine Sitzung, während die Seite offen ist, verschwinden ihre Einträge ohne Neuladen der Seite (Zeitgeber bis zum nächsten
// Ende, den der Server nennt; nach Ruhezustand, Tab-Wechsel und Fokus wird nachgesehen) – ohne Zeilen neu aufzubauen, in denen die Lehrkraft
// gerade arbeitet, und ohne ihr den Fokus zu nehmen. Jede Datei heißt und lädt wie in der Druckliste „Von der Lehrkraft auszudrucken“ der Sitzung
// (materialbox.js: printName, Textmaterial als A4-PDF, gestaltetes Material erst nach dem Druck); „Alle Dateien herunterladen“ lädt alle
// fertigen Dateien (eines Tages) nacheinander als einzelne Downloads – ausdrücklich keine ZIP-Datei. Das Feld ist eine Übersicht: Anzahl, Druckart und
// Namen ändert die Lehrkraft in der Sitzung („In der Sitzung bearbeiten“ führt zu deren Druckliste).
// Direkt darunter (Nachtrag 28) der rote Kasten „Für den nächsten Arbeitstag einpacken“: die Gegenstände, die die Lehrkraft für die Sitzungen desselben
// Tages mitbringen muss (aus derselben Antwort des Servers, bring.js), als Stichpunkte; ein Klick auf einen Gegenstand klappt in kleinerer Schrift auf,
// wo und in welcher Lerngruppe er gebraucht wird (je Sitzung ein Eintrag mit höchstens zwei Sätzen). Ohne Gegenstände gibt es den Kasten nicht. Er folgt
// derselben Regel (Nachtrag 33): Gegenstände für die heute noch anstehenden Sitzungen und den nächsten Arbeitstag, je Tag beschriftet.
import { lazy } from "./update.js";
import { h, clear, icon, fileIcon, fmtBytes, errToast, downloadUrl, downloadBlob, apiUrl } from "./ui.js";
import { onLeave } from "./app.js";
import { tapi } from "./teacher.js";
import { berlinToday, berlinTime, addDays, daysBetween, isIsoDate, isWeekend, printFileName, subjectShort, classShort, printReady, fmtClockBerlin } from "./shared.js";
import { printDesignState as designState, printQueue } from "./designrender.js";   // Bildkarten (Nachtrag 31): erst die PDF ihrer aktuellen Gestaltung zählt
import { freeScopeText } from "./planning.js";
import { packList, placeLabel, placeText, BRING_BOX_TITLE } from "./bring.js";
import { uniqueNames } from "./zip.js";

/* Ein- und Ausgänge, die Unit-Tests ersetzen (Downloads, Abruf der PDF, Pause zwischen zwei Downloads – Browser blockieren schnelle
   Mehrfach-Downloads) */
export const io = { url: downloadUrl, blob: downloadBlob, fetch: (u, o) => fetch(u, o), pauseMs: 1200, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  // Uhr und Zeitgeber für das Ende der Sitzungen von heute (Nachtrag 33)
  now: () => Date.now(), timer: (fn, ms) => setTimeout(fn, ms), untimer: (t) => clearTimeout(t) };

const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
/* „Mittwoch, 19.11.2026“ */
export const longDay = (iso) => (isIsoDate(iso) ? DAYS[new Date(iso + "T12:00:00Z").getUTCDay()] + ", " + iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : "");
const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/* Unterrichtsfreie Einträge der Einstellungen (Nachtrag 24) zwischen from und to → {text: „Herbstferien, beide Schulen; Brückentag, Gymnasium“ (höchstens
   drei), all: liegt jeder Wochentag des Zeitraums in einem Eintrag?} bzw. null */
function freeWhy(list, from, to) {
  const xs = (Array.isArray(list) ? list : []).filter((f) => f && isIsoDate(f.from) && isIsoDate(f.to) && f.to >= from && f.from <= to
    && typeof f.label === "string" && f.label.trim() && freeScopeText(f.scope));
  if (!xs.length) return null;
  let all = true;
  for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) if (!isWeekend(d) && !xs.some((f) => d >= f.from && d <= f.to)) { all = false; break; }
  return { text: xs.slice(0, 3).map((f) => f.label.trim() + ", " + freeScopeText(f.scope)).join("; ") + (xs.length > 3 ? "; …" : ""), all };
}
/* Zeile unter der Überschrift: für welchen Tag – und warum der nominelle nächste Arbeitstag übersprungen ist: laut Stundenplan kein Unterricht bzw.
   unterrichtsfrei laut den Einstellungen (r.freeDays vom Server, nur die Einträge im übersprungenen Zeitraum; ohne sie der Satz wie bisher) */
export function dayText(r) {
  if (!r || !isIsoDate(r.date)) return "In den nächsten Wochen ist kein Unterricht geplant.";
  const day = (r.today && daysBetween(r.today, r.date) === 1 ? "morgen, " : "") + longDay(r.date);
  if (!isIsoDate(r.candidate) || r.date <= r.candidate) return "für " + day;
  let until = addDays(r.date, -1);
  while (until > r.candidate && isWeekend(until)) until = addDays(until, -1);   // „bis Freitag“ statt „bis Sonntag“
  const why = freeWhy(r.freeDays, r.candidate, until);
  return (until > r.candidate ? "Von " + longDay(r.candidate) + ", bis " + longDay(until) + ", ist" : "Am " + longDay(r.candidate) + ", ist") +
    (!why ? " laut Stundenplan kein Unterricht" : why.all ? " unterrichtsfrei (" + why.text + ")" : " laut Stundenplan kein Unterricht (darin unterrichtsfrei: " + why.text + ")") +
    " – deshalb die Druckaufträge für " + day + ".";
}
/* ---------- Nachtrag 33: heute bis zum Ende der jeweiligen Sitzung, daneben der nächste Arbeitstag ----------
   Titel des Feldes und des roten Kastens: zeigt das Feld auch heute, sagt der Titel das (nie nur „für den nächsten Arbeitstag“) */
export const PN_TITLE = "Druckaufträge für den nächsten Arbeitstag", PN_TITLE_TODAY = "Druckaufträge für heute und den nächsten Arbeitstag";
export const PACK_TITLE_TODAY = "Für heute und den nächsten Arbeitstag einpacken", PACK_TITLE_ONLY_TODAY = "Für heute einpacken";
export const TODAY_LEAD = "Heute bis zum Ende der jeweiligen Sitzung";
/* Überschrift eines Tagesabschnitts: „Heute, Montag, 16.11.2026“, „Morgen, Dienstag, 17.11.2026“, „Montag, 23.11.2026“ */
export const dayHead = (iso, today) => (iso === today ? "Heute, " : isIsoDate(today) && isIsoDate(iso) && daysBetween(today, iso) === 1 ? "Morgen, " : "") + longDay(iso);
/* Zeile unter der Überschrift, wenn das Feld auch heute zeigt: vorn heute, dahinter unverändert der Satz zum nächsten Arbeitstag (dayText – samt
   übersprungenen bzw. unterrichtsfreien Tagen) */
export function dayTextToday(r) {
  if (!r || !isIsoDate(r.date)) return TODAY_LEAD + "; danach ist in den nächsten Wochen kein Unterricht geplant.";
  return TODAY_LEAD + (!isIsoDate(r.candidate) || r.date <= r.candidate ? ", dazu " : ". ") + dayText(r);
}
/* Was das Feld zeigt: der Abschnitt „heute“ nur, wenn eine der heute noch laufenden Sitzungen Druckaufträge hat (sonst wie bisher nur der nächste
   Arbeitstag) → {two, days: [{key "today"|"next", date, sessions}]} */
export function printDays(d) {
  const todays = d && Array.isArray(d.todaySessions) ? d.todaySessions : [];
  const two = todays.some((s) => s && Array.isArray(s.files) && s.files.length > 0);
  return { two, days: [...(two ? [{ key: "today", date: d.today, sessions: todays }] : []), { key: "next", date: d ? d.date : null, sessions: d && Array.isArray(d.sessions) ? d.sessions : [] }] };
}
/* Der rote Kasten: Gegenstände der heute noch laufenden Sitzungen und des nächsten Arbeitstags, je Tag (nur Tage mit Gegenständen) → [{key, date, items}] */
export function packDays(d) {
  if (!d) return [];
  const out = [];
  if (isIsoDate(d.today)) { const items = packList(Array.isArray(d.todaySessions) ? d.todaySessions : []); if (items.length) out.push({ key: "today", date: d.today, items }); }
  if (isIsoDate(d.date)) { const items = packList(Array.isArray(d.sessions) ? d.sessions : []); if (items.length) out.push({ key: "next", date: d.date, items }); }
  return out;
}
/* Titel und Zeile des roten Kastens zu packDays */
export function packHead(days, d) {
  const today = days.find((x) => x.key === "today"), next = days.find((x) => x.key === "next");
  const nextText = next ? (d.today && daysBetween(d.today, next.date) === 1 ? "morgen, " : "") + longDay(next.date) : "";
  if (today && next) return { title: PACK_TITLE_TODAY, day: TODAY_LEAD + ", dazu für " + nextText };
  if (today) return { title: PACK_TITLE_ONLY_TODAY, day: "für heute, " + longDay(today.date) + " – bis zum Ende der jeweiligen Sitzung" };
  return { title: BRING_BOX_TITLE, day: next ? "für " + nextText : "" };
}
/* Wartezeit bis zum Neuladen (ms): bis refreshAt laut Uhr des Servers (relativ – eine falsch gehende Uhr des Geräts stört nicht), höchstens 25 Stunden; ohne
   Angabe (älterer Server) bis Mitternacht in Berlin; nie eine Schleife (refreshAt schon vorbei → 30 s) */
export const REFRESH_MARGIN_MS = 1500;
/* Scheitert ein Neuladen im Hintergrund (Ende einer Sitzung, Ruhezustand, neuer Tag) – z. B. direkt nach dem Aufwachen des iPads, bevor das Netz wieder
   da ist –, bleiben die Druckaufträge stehen, wie sie waren (nie eine Fehlermeldung statt der Liste); neuer Versuch beim nächsten Tab-Wechsel, Fokus oder
   „online“ und sonst nach 30 s, 60 s, 2 min, 4 min, dann alle 5 Minuten (Prüfung von Nachtrag 33) */
export const RETRY_MS = 30e3, RETRY_MAX_MS = 5 * 60e3;
export const retryWait = (n) => Math.min(RETRY_MS * 2 ** Math.min(Math.max(n, 0), 8), RETRY_MAX_MS);
export function refreshWait(r, now = Date.now()) {
  const rel = r && Number.isFinite(r.refreshAt) && Number.isFinite(r.now) ? r.refreshAt - r.now : null;
  const wait = rel !== null ? (rel > 0 ? rel : 30e3) : (berlinTime(addDays(berlinToday(now), 1), "00:00") || now + 864e5) - now;
  return Math.min(Math.max(wait, 1000), 25 * 3600e3) + REFRESH_MARGIN_MS;
}
/* Name einer Datei wie in der Druckliste der Sitzung (den liefert der Server als printName; course = Kurs der Sitzung, nur wenn er fehlt – Nachtrag 32) */
export const printNameOf = (f, course = "") => f.printName || printFileName({ name: f.name, ...(f.print || {}), course });
/* „Alle Dateien herunterladen“: wie die ZIP-Datei der Sitzung ohne gestaltete Vorlagen, die noch nicht gedruckt sind (die werden genannt); Bildkarten erst mit der
   PDF ihrer aktuellen Gestaltung (shared.js printReady) */
export const readyForAll = printReady;
/* Text der Abschlussmeldung von „Alle Dateien herunterladen“; wait = gestaltete Vorlagen, die gerade gedruckt werden, stuck = solche, deren
   PDF-Druck gescheitert bzw. heute nicht mehr möglich ist (sie druckt nichts von selbst – in der Sitzung „Erneut drucken“) */
export function doneText(n, wait, failed, stopped = false, stuck = []) {
  const q = (xs) => xs.map((f) => "„" + printNameOf(f) + "“").join(", ");
  return (stopped ? "Abgebrochen nach " + n + (n === 1 ? " Datei." : " Dateien.") : n === 0 ? "Keine Datei heruntergeladen." : n === 1 ? "Fertig: Eine Datei ist heruntergeladen." : "Fertig: Alle " + n + " Dateien sind einzeln heruntergeladen.") +
    (wait.length ? " Noch nicht dabei (wird gerade als PDF gedruckt): " + q(wait) + "." : "") +
    (stuck.length ? " Nicht dabei, weil der PDF-Druck nicht geklappt hat (in der Sitzung „Erneut drucken“): " + q(stuck) + "." : "") +
    (failed.length ? " Nicht heruntergeladen: " + failed.map((x) => "„" + printNameOf(x.f) + "“ (" + x.msg + ")").join(", ") + "." : "");
}

/* Knopf während einer Aktion sperren, ohne ihm den Fokus zu nehmen (aria-disabled statt disabled) */
async function working(btn, fn, label) {
  if (btn.getAttribute("aria-disabled") === "true") return;
  const old = Array.from(btn.childNodes);
  btn.setAttribute("aria-disabled", "true"); btn.setAttribute("aria-busy", "true");
  clear(btn).append(h("span", { class: "spin", "aria-hidden": "true" }), label);
  try { return await fn(); }
  finally { btn.removeAttribute("aria-disabled"); btn.removeAttribute("aria-busy"); clear(btn).append(...old); }
}

/* Kinder eines Elements auf die Liste bringen, ohne Knoten unnötig zu verschieben (ein verschobener Knoten verlöre den Fokus): Überzähliges entfernen,
   dann nur, was nicht schon an seiner Stelle steht, davor einfügen */
function syncChildren(parent, list) {
  const want = new Set(list);
  for (const c of Array.from(parent.childNodes)) if (!want.has(c)) c.remove();
  list.forEach((el, i) => { if (parent.childNodes[i] !== el) parent.insertBefore(el, parent.childNodes[i] || null); });
}

/* Das Feld. load() → Promise mit der Antwort von GET /api/teacher/print-next (Vorgabe: der Server); lädt eigenständig – ein Fehler hier
   verhindert die Startseite nicht. Nach dem Aufbau der Seite (render) anlegen: es meldet sich mit onLeave ab.
   printNextCards → {card, pack}: pack = der rote Kasten „Für den nächsten Arbeitstag einpacken“ (Nachtrag 28), direkt unter card einzufügen; ohne
   Gegenstände verborgen. printNextCard → nur das Feld (wie bisher).
   Aufbau (Nachtrag 33): Zeigt das Feld nur den nächsten Arbeitstag, steht „Alle Dateien herunterladen“ im Kopf und die Sitzungen (h3) direkt im Feld –
   wie bisher. Hat eine heute noch laufende Sitzung Druckaufträge, gibt es zwei Tagesabschnitte (h3 je Tag, Sitzungen h4), jeder mit eigenem Knopf und
   eigener Statuszeile (data-day = Datum). Neu geladen wird zum nächsten Ende (refreshAt des Servers), nach Ruhezustand/Tab-Wechsel/Fokus, wenn es so
   weit ist, und an einem neuen Tag – nie während „Alle Dateien herunterladen“ oder ein Download läuft (dann gleich danach); scheitert es (z. B. ohne Netz
   direkt nach dem Aufwachen), bleibt der bisherige Stand stehen und es wird später erneut versucht (retryWait, auch bei „online“). Beim Neuladen bleiben
   Abschnitte, Gruppen und Zeilen, die sich nicht geändert haben, dieselben Elemente; der Fokus bleibt, wo er war – verschwindet sein Eintrag, geht er an
   die Überschrift des Feldes (bzw. des Kastens). */
export const printNextCard = (load) => printNextCards(load).card;
export function printNextCards(load = () => tapi("GET", "/api/teacher/print-next")) {
  let data = null, run = 0, stopped = false, today = berlinToday(io.now()), busy = 0, due = false, timer = null, dueAt = null;
  const rq = printQueue(), rNotes = new Map(), rowEls = new Map(), groupEls = new Map(), dayEls = new Map();
  const heading = h("h2", { id: "pn-h", tabindex: "-1", text: PN_TITLE });
  const day = h("p", { class: "pn-day", id: "pn-day" });
  const status = h("p", { class: "pn-status", id: "pn-status", role: "status" });
  const body = h("div", { class: "pn-body skeleton", text: "Lade die Druckaufträge …" });
  const allBtn = h("button", { class: "btn primary pn-all hidden", type: "button", "aria-describedby": "pn-all-h", dataset: { fk: "all:next" }, onclick: () => downloadAll("next") }, icon("download"), "Alle Dateien herunterladen");
  const HINT_ONE = "„Alle Dateien herunterladen“ lädt jede Datei einzeln (keine ZIP-Datei), mit kurzer Pause dazwischen. Ihr Browser fragt beim ersten Mal womöglich, ob diese Seite mehrere Dateien herunterladen darf – bitte erlauben.";
  const HINT_TWO = "„Alle Dateien herunterladen“ lädt jede Datei des jeweiligen Tages einzeln (keine ZIP-Datei), mit kurzer Pause dazwischen. Ihr Browser fragt beim ersten Mal womöglich, ob diese Seite mehrere Dateien herunterladen darf – bitte erlauben.";
  const allHint = h("p", { class: "hint pn-hint hidden", id: "pn-all-h", text: HINT_ONE });
  const card = h("section", { class: "card printnext", "aria-labelledby": "pn-h", "aria-describedby": "pn-day" },
    h("div", { class: "pn-head" }, h("div", { class: "pn-title" }, h("span", { class: "pn-ico", "aria-hidden": "true" }, icon("printer")), h("div", { class: "pn-tt" }, heading, day)), allBtn),
    status, body, allHint);
  // Nachtrag 28: roter Kasten mit den Gegenständen zum Einpacken (aus denselben Daten)
  const packH = h("h2", { id: "pk-h", tabindex: "-1", text: BRING_BOX_TITLE });
  const packDay = h("p", { class: "pk-day", id: "pk-day" });
  const packUl = h("ul", { class: "pk-list", id: "pk-list" });
  const packBody = h("div", { class: "pk-body" }, packUl);
  const pack = h("section", { class: "card packnext hidden", id: "packnext", "aria-labelledby": "pk-h", "aria-describedby": "pk-day" },
    h("div", { class: "pk-head" }, h("span", { class: "pk-ico", "aria-hidden": "true" }, icon("bag")), h("div", { class: "pk-tt" }, packH, packDay)), packBody);
  const opened = new Set();   // aufgeklappte Gegenstände (Tag + Schlüssel) – bleiben beim Neuladen aufgeklappt
  const packEls = new Map(), packDayEls = new Map();
  let seq = 0;   // Kennungen der aufklappbaren Hinweise (je Element fest, auch wenn sich die Reihenfolge ändert)

  const allSessions = () => (data ? [...data.todaySessions, ...data.sessions] : []);
  const filesOf = () => allSessions().flatMap((s) => s.files.map((f) => ({ f, s })));
  // gestaltete Vorlage ohne fertige PDF, die nichts von selbst druckt: Druck gescheitert oder Tageskontingent aufgebraucht (wie designMeta)
  const stuck = (f) => { const d = designState(f); return !!d && (!!d.error || (d.need && (!!rq.failed(f) || !!rq.quota))); };
  const designMeta = (f) => { const d = designState(f), failed = rq.failed(f); return rNotes.get(f.id) || (failed && d.need ? "Druck fehlgeschlagen: " + failed : rq.quota && d.need ? "Noch nicht gedruckt: " + rq.quota : d.text); };
  // Herkunft wie in der Druckliste der Sitzung (gestaltetes Material sagt „von Claude gestaltet“ schon selbst)
  const src = (f, design) => (!design && f.source === "claude" ? " · von Claude" : design && f.source === "vertretung" ? " · Vertretung" : f.source === "uebernommen" ? " · übernommen" : "");
  /* Knopf sperren wie working(), dabei mitzählen: solange ein Download läuft, wartet ein fälliges Neuladen (es baute sonst unter ihm um) */
  const work = async (btn, fn, label) => { busy++; try { return await working(btn, fn, label); } finally { busy--; if (!busy && due) refresh(); } };
  /* PDF-Bytes einer Datei (wie printBytes in materialbox.js); text = Text des Textmaterials (aus der Sitzung geholt) */
  async function pdfBytes(f, s, texts) {
    if (f.kind === "text") {
      if (!texts.has(s.id)) texts.set(s.id, tapi("GET", "/api/teacher/lessons/" + s.id).then((r) => new Map((r.files || []).map((x) => [x.id, x.text || ""]))));
      const t = (await texts.get(s.id)).get(f.id);
      if (t === undefined) throw new Error("„" + f.name + "“ gibt es in der Sitzung nicht mehr – bitte die Seite neu laden.");
      const { markdownToPdf } = await lazy(import("./pdfmaker.js"));
      return new Uint8Array(await (await markdownToPdf(f.name, t, { subtitle: s.subtitle })).arrayBuffer());
    }
    // Bildkarten (Nachtrag 31): mit print – der Server gibt nur die PDF ihrer aktuellen Gestaltung heraus (eine ältere Liste auf dieser Seite bekommt sonst die alten Karten)
    const r = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: f.cards ? { print: true } : {} });
    const res = await io.fetch(apiUrl(r.url), { credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error("„" + f.name + "“ ließ sich nicht laden (Fehler " + res.status + ").");
    const buf = new Uint8Array(await res.arrayBuffer());
    if (!f.cards || f.design) return buf;
    // hochgeladene Bildkarten: Seiten in einem anderen Format auf A4 (wie in der Druckliste der Sitzung, a4.js cardsA4)
    const { cardsA4 } = await lazy(import("./a4.js"));
    return cardsA4(buf, await lazy(import("/vendor/pdf-lib.esm.min.js")));
  }
  /* eine Datei herunterladen wie in der Druckliste der Sitzung. Druckvorlagen über den signierten Link: der Server nennt sie selbst mit dem
     Druck-Namen – das zählt auf GitHub Pages, wo der Browser das download-Attribut einer anderen Herkunft nicht beachtet. Textmaterial und
     Arbeitsblätter der Kinder mit „Auch ausdrucken“ (Grundschule; beim Server heißen sie wie im Material) als Blob unter dem Druck-Namen. */
  async function downloadOne(f, s) {
    if (f.kind === "text" || f.area !== "print") io.blob(new Blob([await pdfBytes(f, s, new Map())], { type: "application/pdf" }), printNameOf(f, s.printCourse));
    else { const r = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: {} }); io.url(r.url, printNameOf(f, s.printCourse)); }
  }
  // Stand einer Zeile (ändert er sich beim Neuladen nicht, bleibt die Zeile dasselbe Element)
  const rowSig = (f, s) => JSON.stringify([f, s.id, s.printCourse, s.subtitle]);
  function fileRow(f, s) {
    const d = designState(f);
    if (d && d.need) rq.add(f);   // wie in der Sitzung: ausstehende Gestaltungen druckt die gemeinsame Warteschlange des Tabs
    const name = printNameOf(f, s.printCourse);
    const meta = h("div", { class: "meta" });
    if (d) meta.append(designMeta(f), (f.cards ? " · Bildkarten" : "") + (d.ok ? " · " + fmtBytes(f.size) : "") + src(f, true));
    else meta.textContent = (f.cards ? "Bildkarten · " : "") + (f.kind === "text" ? "Text (als A4-PDF)" : fmtBytes(f.size)) + src(f, false);
    const can = !d || d.ok;
    const btn = can ? h("button", { class: "btn pn-dl", type: "button", "aria-label": "Herunterladen – " + name, dataset: { fk: "dl:" + f.id },
      onclick: (e) => work(e.currentTarget, async () => { try { await downloadOne(f, s); } catch (err) { errToast(err); } }, "Lade …") }, icon("download"), "Herunterladen") : null;
    const err = !!d && (d.error || (!!rq.failed(f) && d.need));
    const row = h("div", { class: "item printrow pn-row" + (err ? " design-err" : ""), dataset: { file: f.id } }, fileIcon(name, "application/pdf", "file"),   // auch Textmaterial kommt als PDF
      h("div", { class: "main" }, h("div", { class: "name", text: name }), meta), btn ? h("div", { class: "acts" }, btn) : null);
    rowEls.set(f.id, { row, meta, sig: rowSig(f, s) });
    return row;
  }
  // nur die Zeile einer Datei neu aufbauen (Fokus in den anderen Zeilen bleibt; war er in dieser Zeile, geht er an ihren neuen Knopf)
  function repaintFile(fid) {
    const hit = filesOf().find((x) => x.f.id === fid), el = rowEls.get(fid);
    if (!hit || !el || !el.row.isConnected) return;
    const had = el.row.contains(document.activeElement);
    const row = fileRow(hit.f, hit.s);
    el.row.replaceWith(row);
    if (had) (row.querySelector("button") || heading).focus({ preventScroll: true });
    paintAll();
  }
  /* Zeile einer Datei beim Neuladen: dieselbe, wenn sich nichts geändert hat oder gerade ein Download in ihr läuft; sonst neu (der Fokus folgt danach
     über data-fk an denselben Knopf) */
  function rowFor(f, s) {
    const el = rowEls.get(f.id);
    if (el && (el.sig === rowSig(f, s) || el.row.querySelector('[aria-busy="true"]'))) return el.row;
    return fileRow(f, s);
  }
  // Beginn einer Sitzung; heute mit ihrem geplanten Ende („09:00–09:45“ – dann verschwindet sie aus dem Feld)
  const timeText = (s) => (s.startTime ? s.startTime + (s.endsAt ? "–" + fmtClockBerlin(s.endsAt) : "") : "");
  const sessionHead = (s, level) => {
    const gs = s.school === "gs", tt = timeText(s);
    return h("div", { class: "pn-gh" },
      h(level, { id: "pn-g-" + s.id }, h("a", { href: "#/lk/s/" + s.id, dataset: { fk: "s:" + s.id } },
        tt ? h("span", { class: "pn-time", text: tt }) : null, tt ? " " : null,
        h("span", { class: "ftag", dataset: { fach: s.subject }, text: gs ? "Grundschule" : subjectShort(s.subject) }), " ",
        h("strong", { text: gs ? (s.course ? s.course.short : "") : classShort(s.klass) }), s.title ? h("span", { class: "pn-t", text: " – " + s.title }) : null),
        // Selbstlern-Phase (Nachtrag 29): Sie sind nicht da – die Ausdrucke gehen an die Aufsicht
        s.selbstlern ? h("span", { class: "badge pn-sl", text: "Selbstlern-Phase – Ausdrucke für die Aufsicht" }) : null),
      h("a", { class: "btn ghost pn-edit", href: "#/lk/s/" + s.id + "/druckliste", dataset: { fk: "e:" + s.id }, "aria-label": "Druckliste von „" + (s.title || s.label) + "“ (" + (gs ? "Grundschule " : "") + s.label + ") in der Sitzung bearbeiten" },
        icon("edit"), "In der Sitzung bearbeiten"));
  };
  /* Gruppe einer Sitzung: Abschnitt, Kopf und Liste bleiben dieselben Elemente; der Kopf wird nur neu gebaut, wenn sich Sitzung oder Ebene ändern */
  function groupFor(s, level) {
    const sig = JSON.stringify([level, s.title, s.startTime, s.endsAt || null, s.subject, s.klass, s.label, s.school, s.course || null, !!s.selbstlern]);
    let g = groupEls.get(s.id);
    if (!g) {
      const list = h("div", { class: "list" });
      g = { list, head: null, sig: null, sec: h("section", { class: "pn-group", "aria-labelledby": "pn-g-" + s.id }, list) };
      groupEls.set(s.id, g);
    }
    if (g.sig !== sig) { const head = sessionHead(s, level); if (g.head) g.head.replaceWith(head); else g.sec.prepend(head); g.head = head; g.sig = sig; }
    syncChildren(g.list, s.files.map((f) => rowFor(f, s)));
    return g.sec;
  }
  /* Inhalt eines Tages: Gruppen der Sitzungen mit Druckaufträgen, sonst ein Satz; darunter „Ohne Druckaufträge: …“ (Elemente je Tag gemerkt) */
  const textEl = (box, key, cls, text) => { let el = box.get(key); if (!el) { el = h("p", { class: cls }); box.set(key, el); } if (el.textContent !== text) el.textContent = text; return el; };
  const textEls = new Map();
  function dayContent(dd, level) {
    const withFiles = dd.sessions.filter((s) => s.files.length), without = dd.sessions.filter((s) => !s.files.length);
    const out = [];
    if (dd.key === "next" && !dd.date) out.push(textEl(textEls, "empty:" + dd.key, "pn-empty", dayText(data)));
    else if (!withFiles.length) out.push(textEl(textEls, "empty:" + dd.key, "pn-empty", dd.key === "today" ? "Für die heute noch anstehenden Sitzungen gibt es keine Druckaufträge." : "Für " + longDay(dd.date) + ", gibt es keine Druckaufträge."));
    for (const s of withFiles) out.push(groupFor(s, level));
    if (without.length) out.push(textEl(textEls, "none:" + dd.key, "small muted pn-none", "Ohne Druckaufträge: " + without.map((s) => (s.startTime ? s.startTime + " " : "") + (s.school === "gs" ? "Grundschule " : "") + s.label).join(", ") + "."));
    return out;
  }
  /* Tagesabschnitt (zwei Tage): Überschrift, „Alle Dateien herunterladen“ und Statuszeile des Tages; dasselbe Element, solange Tag und Datum gleich sind */
  function daySection(dd) {
    const label = dd.date ? dayHead(dd.date, data.today) : "Nächster Arbeitstag", k = dd.key + "|" + (dd.date || "") + "|" + label;
    let x = dayEls.get(k);
    if (!x) {
      const hid = "pn-d-" + dd.key, day = dd.date ? { day: dd.date } : {};
      const btn = h("button", { class: "btn primary pn-all", type: "button", "aria-describedby": "pn-all-h", "aria-label": "Alle Dateien herunterladen – " + label,
        dataset: { ...day, fk: "all:" + dd.key }, onclick: () => downloadAll(dd.key) }, icon("download"), "Alle Dateien herunterladen");
      const st = h("p", { class: "pn-status", role: "status", dataset: day });
      const head = h("div", { class: "pn-dhead" }, h("h3", { class: "pn-dh", id: hid, text: label }), btn);
      x = { sec: h("section", { class: "pn-dayg", id: "pn-dg-" + dd.key, "aria-labelledby": hid, dataset: day }, head, st), head, btn, st };
      for (const kk of Array.from(dayEls.keys())) if (kk.startsWith(dd.key + "|")) dayEls.delete(kk);
      dayEls.set(k, x);
    }
    x.btn.classList.toggle("hidden", !dd.sessions.some((s) => s.files.length));
    syncChildren(x.sec, [x.head, x.st, ...dayContent(dd, "h4")]);
    return x.sec;
  }
  /* Knopf und Statuszeile eines Tages im jetzigen Aufbau (ein Tag: im Kopf des Feldes) */
  const uiFor = (key) => {
    const { two, days } = printDays(data || {}), dd = days.find((x) => x.key === key);
    if (!dd || !data) return null;
    if (!two) return { dd, btn: allBtn, st: status };
    const x = Array.from(dayEls.entries()).find(([k]) => k.startsWith(dd.key + "|" + (dd.date || "") + "|"));
    return x ? { dd, btn: x[1].btn, st: x[1].st } : null;
  };
  // Fokus nach dem Umbau: wo er war; ist sein Element weg, an dasselbe Ziel im neuen Aufbau (data-fk), sonst an die Überschrift – nur, wenn er sonst verloren wäre
  function keepFocus(had, box, head) {
    if (!had || document.activeElement === had) return;
    if (document.activeElement && document.activeElement !== document.body) return;   // die Lehrkraft hat ihn schon woandershin gesetzt
    if (had.isConnected && box.contains(had)) { had.focus({ preventScroll: true }); return; }
    const fk = had.dataset ? had.dataset.fk : null;
    const same = fk ? Array.from(box.querySelectorAll("[data-fk]")).find((el) => el.dataset.fk === fk && !el.classList.contains("hidden")) : null;
    (same || head).focus({ preventScroll: true });
  }
  /* Kasten „Für den nächsten Arbeitstag einpacken“: je Gegenstand ein Stichpunkt (Knopf mit aria-expanded); derselbe Gegenstand in mehreren Sitzungen ist
     EIN Stichpunkt, aufgeklappt mit je einem Eintrag pro Sitzung (Lerngruppe und Beginn als Link zur Sitzung, dann der Hinweis). Zwei Tage (Nachtrag 33):
     je Tag eine Überschrift (h3) und eine Liste; ein Stichpunkt bleibt dasselbe Element, solange er sich nicht ändert */
  function packItem(dk, it) {
    const key = dk + ":" + it.key, sig = JSON.stringify(it);
    const old = packEls.get(key);
    if (old && old.sig === sig) return old.li;
    const nid = "pk-n-" + (++seq), on = opened.has(key);
    const note = h("div", { class: "pk-note" + (on ? "" : " hidden"), id: nid }, it.places.map((p) => h("p", { class: "pk-place" },
      h("a", { class: "pk-where", href: "#/lk/s/" + p.id, text: placeLabel(p) }), ": " + placeText(p))));
    const btn = h("button", { class: "pk-item", type: "button", "aria-expanded": on ? "true" : "false", "aria-controls": nid, dataset: { key: it.key, fk: "pk:" + key } },
      h("span", { class: "pk-name", text: it.item }), it.places.length > 1 ? h("span", { class: "pk-n", text: " · " + it.places.length + " Stunden" }) : null, icon("chev"));
    btn.addEventListener("click", () => {
      const now = btn.getAttribute("aria-expanded") !== "true";
      btn.setAttribute("aria-expanded", now ? "true" : "false"); note.classList.toggle("hidden", !now);
      if (now) opened.add(key); else opened.delete(key);
    });
    const li = h("li", { class: "pk-li" }, btn, note);
    packEls.set(key, { li, sig });
    return li;
  }
  function paintPack() {
    const pdays = data ? packDays(data) : [];
    const had = pack.contains(document.activeElement) ? document.activeElement : null;
    pack.classList.toggle("hidden", !pdays.length);
    const ph = packHead(pdays, data || {});
    if (packH.textContent !== ph.title) packH.textContent = ph.title;
    if (packDay.textContent !== ph.day) packDay.textContent = ph.day;
    const used = new Set();
    const lis = (pd) => pd.items.map((it) => { used.add(pd.key + ":" + it.key); return packItem(pd.key, it); });
    if (pdays.length < 2) { syncChildren(packUl, pdays.length ? lis(pdays[0]) : []); syncChildren(packBody, [packUl]); }
    else {
      syncChildren(packBody, pdays.map((pd) => {
        let x = packDayEls.get(pd.key);
        if (!x || x.date !== pd.date) {
          const hid = "pk-d-" + pd.key, ul = h("ul", { class: "pk-list" });
          x = { date: pd.date, ul, sec: h("div", { class: "pk-dayg", role: "group", "aria-labelledby": hid, dataset: { day: pd.date } }, h("h3", { class: "pk-dh", id: hid, text: dayHead(pd.date, data.today) }), ul) };
          packDayEls.set(pd.key, x);
        }
        syncChildren(x.ul, lis(pd));
        return x.sec;
      }));
    }
    for (const k of Array.from(packEls.keys())) if (!used.has(k)) { packEls.delete(k); opened.delete(k); }
    // lag der Fokus auf einem Gegenstand, bleibt er dort bzw. geht an denselben (sonst an die Überschrift bzw. das Feld darüber) – nur, wenn er sonst verloren wäre
    keepFocus(had, pack, pdays.length ? packH : heading);
  }
  function paintAll() {
    const { two, days } = printDays(data || {});
    const nNext = (days.find((x) => x.key === "next") || { sessions: [] }).sessions.reduce((a, s) => a + s.files.length, 0), any = filesOf().length > 0;
    allBtn.classList.toggle("hidden", two || !nNext);
    // data-day nur am Knopf und an der Statuszeile, die gerade für diesen Tag stehen (zwei Tage: die im Abschnitt)
    if (data && data.date && !two) { allBtn.dataset.day = data.date; status.dataset.day = data.date; } else { delete allBtn.dataset.day; delete status.dataset.day; }
    allHint.classList.toggle("hidden", !(two ? any : nNext));
    allHint.textContent = two ? HINT_TWO : HINT_ONE;
  }
  function paint() {
    if (!data) return;
    const had = card.contains(document.activeElement) ? document.activeElement : null;
    const { two, days } = printDays(data);
    const next = days.find((x) => x.key === "next");
    const empty = !next.sessions.some((s) => s.files.length);
    if (heading.textContent !== (two ? PN_TITLE_TODAY : PN_TITLE)) heading.textContent = two ? PN_TITLE_TODAY : PN_TITLE;
    // ein Tag: kein Unterricht gefunden bzw. keine Druckaufträge – der Satz steht im Inhalt; die Zeile zum Tag nur, wenn sie mehr sagt
    day.textContent = two ? dayTextToday(data) : !data.date ? "" : empty && data.date <= data.candidate ? "" : dayText(data);
    day.classList.toggle("hidden", !day.textContent);
    body.classList.remove("skeleton");
    const kids = two ? days.map(daySection) : dayContent(next, "h3");
    syncChildren(body, kids);
    // was nicht mehr gezeigt wird, vergessen (Gruppen, Zeilen, Tagesabschnitte)
    const shown = new Set(days.flatMap((dd) => dd.sessions.map((s) => s.id))), fids = new Set(filesOf().map((x) => x.f.id));
    // (nach Lage im Feld, nicht nach isConnected: beim ersten Laden hängt das Feld womöglich noch nicht im Dokument)
    for (const k of Array.from(groupEls.keys())) if (!shown.has(k) || !card.contains(groupEls.get(k).sec)) groupEls.delete(k);
    for (const k of Array.from(rowEls.keys())) if (!fids.has(k) || !card.contains(rowEls.get(k).row)) rowEls.delete(k);
    for (const [k, x] of Array.from(dayEls)) if (!card.contains(x.sec)) dayEls.delete(k);
    paintAll();
    keepFocus(had, card, heading);
    paintPack();
  }
  function showError(e) {
    data = null; rowEls.clear(); groupEls.clear(); dayEls.clear(); day.textContent = ""; day.classList.add("hidden"); heading.textContent = PN_TITLE; paintAll(); paintPack();
    clear(body); body.classList.remove("skeleton");
    body.append(h("p", { class: "pn-err", role: "alert", text: "Die Druckaufträge ließen sich nicht laden: " + ((e && e.message) || e) }),
      h("button", { class: "btn", type: "button", onclick: (ev) => working(ev.currentTarget, reload, "Lade …") }, "Erneut versuchen"));
  }
  /* Zeitgeber bis zum nächsten Ende einer Sitzung von heute bzw. bis Mitternacht (refreshWait); dueAt nach der Uhr des Geräts für die Prüfung nach dem
     Ruhezustand – ein Zeitgeber zählt die Schlafzeit nicht immer mit */
  function plan(r) {
    if (timer !== null) io.untimer(timer);
    const wait = refreshWait(r, io.now());
    dueAt = io.now() + wait;
    timer = io.timer(() => { timer = null; refresh(); }, wait);
  }
  function refresh() {
    if (stopped || !card.isConnected) return;
    if (running || busy) { due = true; return; }
    due = false; reload(true);
  }
  // Neuladen im Hintergrund gescheitert (RETRY_MS): später noch einmal – und schon fällig, damit Tab-Wechsel, Fokus oder „online“ es sofort versuchen
  let retries = 0;
  function retryLater() {
    if (timer !== null) io.untimer(timer);
    const wait = retryWait(retries++);
    dueAt = io.now();
    timer = io.timer(() => { timer = null; refresh(); }, wait);
  }
  /* auto: Neuladen im Hintergrund (refresh) – scheitert es, bleibt der bisherige Stand stehen; sonst (erstes Laden, „Erneut versuchen“, vor „Alle Dateien
     herunterladen“ in der Grundschule) die Fehlermeldung mit „Erneut versuchen“ */
  async function reload(auto = false) {
    const mine = ++run, had = card.contains(document.activeElement) || pack.contains(document.activeElement);
    try {
      const r = await load(); if (mine !== run) return;
      retries = 0;
      today = r.today || berlinToday(io.now());
      data = { today: r.today || null, candidate: r.candidate || null, date: r.date || null, sessions: Array.isArray(r.sessions) ? r.sessions : [], freeDays: Array.isArray(r.freeDays) ? r.freeDays : [],
        todaySessions: Array.isArray(r.todaySessions) ? r.todaySessions : [] };
      plan(r);
      paint();
    }
    catch (e) {
      if (mine !== run) return;
      if (auto === true && data) { retryLater(); return; }
      showError(e);
    }
    // war der Fokus im Feld (z. B. auf „Erneut versuchen“) und ist sein Element jetzt weg, geht er an die Überschrift – nie verloren auf body
    if (mine === run && had && card.isConnected && !card.contains(document.activeElement) && !pack.contains(document.activeElement) && (!document.activeElement || document.activeElement === document.body)) heading.focus({ preventScroll: true });
  }

  /* „Alle Dateien herunterladen“ (eines Tages – key „today“ bzw. „next“): nacheinander, je Datei ein Download, dazwischen eine kurze Pause; Fortschritt
     in der Statuszeile des Tages */
  let running = false;
  async function downloadAll(key) {
    if (running || !data) return;
    let ui = uiFor(key);
    if (!ui) return;
    // Grundschule (Prüfung von Nachtrag 31): vorher neu laden – Bildkarten, die Claude seit dem Öffnen der Startseite angelegt oder neu gestaltet hat, fehlten
    // sonst ohne Hinweis (am Gymnasium bleibt es beim geladenen Stand)
    if (ui.dd.sessions.some((s) => s.school === "gs")) {
      running = true; ui.st.textContent = "";
      try { await work(ui.btn, reload, "Lade die Druckaufträge …"); } finally { running = false; }
      if (!data || stopped || !card.isConnected) return;
      ui = uiFor(key);
      // inzwischen vorbei (Sitzungen von heute): nichts mehr herunterzuladen
      if (!ui) { status.textContent = key === "today" ? "Die Sitzungen von heute sind inzwischen vorbei – es gibt für heute keine Druckaufträge mehr." : ""; if (due) refresh(); return; }
    }
    const { btn, st } = ui, date0 = ui.dd.date;
    const all = ui.dd.sessions.flatMap((s) => s.files.map((f) => ({ f, s }))), ready = all.filter((x) => readyForAll(x.f)), wait = all.filter((x) => !readyForAll(x.f)).map((x) => x.f);
    if (!ready.length) {
      st.textContent = wait.some((f) => !stuck(f)) ? "Die Vorlagen werden gerade noch als PDF gedruckt – bitte gleich noch einmal."
        : "Keine Datei ist fertig: Der PDF-Druck der Vorlagen hat nicht geklappt – bitte in der Sitzung „Erneut drucken“.";
      if (due) refresh();
      return;
    }
    running = true;
    const texts = new Map(), failed = [];
    let n = 0;
    // gleiche Namen (Nachtrag 32: z. B. dasselbe Arbeitsblatt für 8A und 8B → beide „28x - sw - beidseitig - PoWi8 - …“) eindeutig wie in der ZIP-Datei: „… (2).pdf“
    const names = uniqueNames(ready.map(({ f, s }) => printNameOf(f, s.printCourse)));
    await work(btn, async () => {
      for (let i = 0; i < ready.length; i++) {
        if (stopped || !card.isConnected) break;
        const { f, s } = ready[i];
        st.textContent = "Lade " + (i + 1) + " von " + ready.length + ": „" + names[i] + "“ …";
        try {
          const bytes = await pdfBytes(f, s, texts);
          if (stopped || !card.isConnected) break;
          io.blob(new Blob([bytes], { type: "application/pdf" }), names[i]);
          n++;
        } catch (e) { failed.push({ f, msg: (e && e.message) || String(e) }); }
        if (i < ready.length - 1 && !stopped) await io.sleep(io.pauseMs);
      }
    }, "Lade die Dateien …");
    running = false;
    if (stopped || !card.isConnected) return;
    // die Statuszeile des Tages (steht der Tag nach einem Neuladen anders da, die jetzige)
    const now = uiFor(key), out = now && now.dd.date === date0 ? now.st : st;
    out.textContent = doneText(n, wait.filter((f) => !stuck(f)), failed, n + failed.length < ready.length, wait.filter(stuck));
    if (due) refresh();
  }

  // gestaltete Vorlagen: Stand aus der gemeinsamen Druck-Warteschlange (gedruckt, Zwischenstand, Fehler)
  const off = rq.on({
    done: (nf) => { const hit = filesOf().find((x) => x.f.id === nf.id); if (!hit) return; Object.assign(hit.f, nf); if (!nf.design) delete hit.f.design; delete hit.f.text; repaintFile(nf.id); },
    note: (fid, t) => { if (t) rNotes.set(fid, t); else rNotes.delete(fid); const el = rowEls.get(fid), hit = filesOf().find((x) => x.f.id === fid); if (el && hit && el.meta.isConnected && el.meta.firstChild) el.meta.firstChild.textContent = designMeta(hit.f); },
    // Tageskontingent aufgebraucht: die Warteschlange druckt nichts mehr – alle gestalteten Zeilen sagen jetzt „Noch nicht gedruckt: …“
    fail: (f0, e, quota) => { if (!quota) { repaintFile(f0.id); return; } for (const { f } of filesOf()) if (f.design) repaintFile(f.id); },
  });
  /* zurück im Tab, nach dem Ruhezustand, beim Fokus des Fensters: ist das nächste Ende (bzw. ein neuer Tag – z. B. am nächsten Morgen) erreicht, neu laden */
  const check = () => {
    // noch nicht (oder nicht mehr) im Dokument: nichts tun – abgemeldet wird nur beim Verlassen der Seite (onLeave); „pageshow“ kommt beim ersten Laden womöglich,
    // bevor die Startseite das Feld einhängt, und darf dann weder Zeitgeber noch Zuhörer abräumen
    if (!card.isConnected || document.visibilityState !== "visible") return;
    if ((dueAt !== null && io.now() >= dueAt) || berlinToday(io.now()) !== today) refresh();
  };
  const win = typeof window !== "undefined" && window && typeof window.addEventListener === "function" ? window : null;
  const unlisten = () => {
    document.removeEventListener("visibilitychange", check);
    if (win) { win.removeEventListener("focus", check); win.removeEventListener("pageshow", check); win.removeEventListener("online", check); }
    if (timer !== null) { io.untimer(timer); timer = null; }
  };
  document.addEventListener("visibilitychange", check);
  // „online“: das Netz ist wieder da (z. B. nach dem Aufwachen) – ein fälliges Neuladen bzw. ein gescheitertes versucht es dann sofort
  if (win) { win.addEventListener("focus", check); win.addEventListener("pageshow", check); win.addEventListener("online", check); }
  onLeave(() => { stopped = true; run++; off(); unlisten(); });
  reload();
  return { card, pack };
}
