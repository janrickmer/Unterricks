// printnext.js – Feld „Druckaufträge für den nächsten Arbeitstag“ ganz oben auf beiden Startseiten der Lehrkraft (Gymnasium und Übersicht
// „Grundschule“; Anforderung 14): die Druckaufträge BEIDER Schulformen für den nächsten Tag mit Unterricht (GET /api/teacher/print-next,
// worker/printjobs.js), nach Sitzung gruppiert. Jede Datei heißt und lädt wie in der Druckliste „Von der Lehrkraft auszudrucken“ der Sitzung
// (materialbox.js: printName, Textmaterial als A4-PDF, gestaltetes Material erst nach dem Druck); „Alle Dateien herunterladen“ lädt alle
// fertigen Dateien nacheinander als einzelne Downloads – ausdrücklich keine ZIP-Datei. Das Feld ist eine Übersicht: Anzahl, Druckart und
// Namen ändert die Lehrkraft in der Sitzung („In der Sitzung bearbeiten“ führt zu deren Druckliste).
import { h, clear, icon, fileIcon, fmtBytes, errToast, downloadUrl, downloadBlob, apiUrl } from "./ui.js";
import { onLeave } from "./app.js";
import { tapi } from "./teacher.js";
import { berlinToday, addDays, daysBetween, isIsoDate, isWeekend, printFileName, subjectShort, classShort } from "./shared.js";
import { designState, printQueue } from "./designrender.js";

/* Ein- und Ausgänge, die Unit-Tests ersetzen (Downloads, Abruf der PDF, Pause zwischen zwei Downloads – Browser blockieren schnelle
   Mehrfach-Downloads) */
export const io = { url: downloadUrl, blob: downloadBlob, fetch: (u, o) => fetch(u, o), pauseMs: 1200, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

const DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
/* „Mittwoch, 19.11.2026“ */
export const longDay = (iso) => (isIsoDate(iso) ? DAYS[new Date(iso + "T12:00:00Z").getUTCDay()] + ", " + iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : "");
const upper = (s) => s.charAt(0).toUpperCase() + s.slice(1);
/* Zeile unter der Überschrift: für welchen Tag – und warum der nominelle nächste Arbeitstag übersprungen ist (kein Unterricht laut Stundenplan) */
export function dayText(r) {
  if (!r || !isIsoDate(r.date)) return "In den nächsten Wochen ist kein Unterricht geplant.";
  const day = (r.today && daysBetween(r.today, r.date) === 1 ? "morgen, " : "") + longDay(r.date);
  if (!isIsoDate(r.candidate) || r.date <= r.candidate) return "für " + day;
  let until = addDays(r.date, -1);
  while (until > r.candidate && isWeekend(until)) until = addDays(until, -1);   // „bis Freitag“ statt „bis Sonntag“
  return (until > r.candidate ? "Von " + longDay(r.candidate) + ", bis " + longDay(until) + ", ist" : "Am " + longDay(r.candidate) + ", ist") +
    " laut Stundenplan kein Unterricht – deshalb die Druckaufträge für " + day + ".";
}
/* Name einer Datei wie in der Druckliste der Sitzung */
export const printNameOf = (f) => f.printName || printFileName({ name: f.name, ...(f.print || {}) });
/* „Alle Dateien herunterladen“: wie die ZIP-Datei der Sitzung ohne gestaltete Vorlagen, die noch nicht gedruckt sind (die werden genannt) */
export const readyForAll = (f) => !(f.design && f.status !== "ready");
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

/* Das Feld. load() → Promise mit der Antwort von GET /api/teacher/print-next (Vorgabe: der Server); lädt eigenständig – ein Fehler hier
   verhindert die Startseite nicht. Nach dem Aufbau der Seite (render) anlegen: es meldet sich mit onLeave ab. */
export function printNextCard(load = () => tapi("GET", "/api/teacher/print-next")) {
  let data = null, run = 0, stopped = false, today = berlinToday();
  const rq = printQueue(), rNotes = new Map(), rowEls = new Map();
  const heading = h("h2", { id: "pn-h", tabindex: "-1", text: "Druckaufträge für den nächsten Arbeitstag" });
  const day = h("p", { class: "pn-day", id: "pn-day" });
  const status = h("p", { class: "pn-status", id: "pn-status", role: "status" });
  const body = h("div", { class: "pn-body skeleton", text: "Lade die Druckaufträge …" });
  const allBtn = h("button", { class: "btn primary pn-all hidden", type: "button", "aria-describedby": "pn-all-h", onclick: () => downloadAll() }, icon("download"), "Alle Dateien herunterladen");
  const allHint = h("p", { class: "hint pn-hint hidden", id: "pn-all-h",
    text: "„Alle Dateien herunterladen“ lädt jede Datei einzeln (keine ZIP-Datei), mit kurzer Pause dazwischen. Ihr Browser fragt beim ersten Mal womöglich, ob diese Seite mehrere Dateien herunterladen darf – bitte erlauben." });
  const card = h("section", { class: "card printnext", "aria-labelledby": "pn-h", "aria-describedby": "pn-day" },
    h("div", { class: "pn-head" }, h("div", { class: "pn-title" }, h("span", { class: "pn-ico", "aria-hidden": "true" }, icon("printer")), h("div", { class: "pn-tt" }, heading, day)), allBtn),
    status, body, allHint);

  const filesOf = () => (data ? data.sessions.flatMap((s) => s.files.map((f) => ({ f, s }))) : []);
  // gestaltete Vorlage ohne fertige PDF, die nichts von selbst druckt: Druck gescheitert oder Tageskontingent aufgebraucht (wie designMeta)
  const stuck = (f) => { const d = designState(f); return !!d && (!!d.error || (d.need && (!!rq.failed(f) || !!rq.quota))); };
  const designMeta = (f) => { const d = designState(f), failed = rq.failed(f); return rNotes.get(f.id) || (failed && d.need ? "Druck fehlgeschlagen: " + failed : rq.quota && d.need ? "Noch nicht gedruckt: " + rq.quota : d.text); };
  // Herkunft wie in der Druckliste der Sitzung (gestaltetes Material sagt „von Claude gestaltet“ schon selbst)
  const src = (f, design) => (!design && f.source === "claude" ? " · von Claude" : design && f.source === "vertretung" ? " · Vertretung" : f.source === "uebernommen" ? " · übernommen" : "");
  /* PDF-Bytes einer Datei (wie printBytes in materialbox.js); text = Text des Textmaterials (aus der Sitzung geholt) */
  async function pdfBytes(f, s, texts) {
    if (f.kind === "text") {
      if (!texts.has(s.id)) texts.set(s.id, tapi("GET", "/api/teacher/lessons/" + s.id).then((r) => new Map((r.files || []).map((x) => [x.id, x.text || ""]))));
      const t = (await texts.get(s.id)).get(f.id);
      if (t === undefined) throw new Error("„" + f.name + "“ gibt es in der Sitzung nicht mehr – bitte die Seite neu laden.");
      const { markdownToPdf } = await import("./pdfmaker.js");
      return new Uint8Array(await (await markdownToPdf(f.name, t, { subtitle: s.subtitle })).arrayBuffer());
    }
    const r = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: {} });
    const res = await io.fetch(apiUrl(r.url), { credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error("„" + f.name + "“ ließ sich nicht laden (Fehler " + res.status + ").");
    return new Uint8Array(await res.arrayBuffer());
  }
  /* eine Datei herunterladen wie in der Druckliste der Sitzung. Druckvorlagen über den signierten Link: der Server nennt sie selbst mit dem
     Druck-Namen – das zählt auf GitHub Pages, wo der Browser das download-Attribut einer anderen Herkunft nicht beachtet. Textmaterial und
     Arbeitsblätter der Kinder mit „Auch ausdrucken“ (Grundschule; beim Server heißen sie wie im Material) als Blob unter dem Druck-Namen. */
  async function downloadOne(f, s) {
    if (f.kind === "text" || f.area !== "print") io.blob(new Blob([await pdfBytes(f, s, new Map())], { type: "application/pdf" }), printNameOf(f));
    else { const r = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: {} }); io.url(r.url, printNameOf(f)); }
  }
  function fileRow(f, s) {
    const d = designState(f);
    if (d && d.need) rq.add(f);   // wie in der Sitzung: ausstehende Gestaltungen druckt die gemeinsame Warteschlange des Tabs
    const name = printNameOf(f);
    const meta = h("div", { class: "meta" });
    if (d) meta.append(designMeta(f), (d.ok ? " · " + fmtBytes(f.size) : "") + src(f, true));
    else meta.textContent = (f.kind === "text" ? "Text (als A4-PDF)" : fmtBytes(f.size)) + src(f, false);
    const can = !d || d.ok;
    const btn = can ? h("button", { class: "btn pn-dl", type: "button", "aria-label": "Herunterladen – " + name,
      onclick: (e) => working(e.currentTarget, async () => { try { await downloadOne(f, s); } catch (err) { errToast(err); } }, "Lade …") }, icon("download"), "Herunterladen") : null;
    const err = !!d && (d.error || (!!rq.failed(f) && d.need));
    const row = h("div", { class: "item printrow pn-row" + (err ? " design-err" : ""), dataset: { file: f.id } }, fileIcon(name, "application/pdf", "file"),   // auch Textmaterial kommt als PDF
      h("div", { class: "main" }, h("div", { class: "name", text: name }), meta), btn ? h("div", { class: "acts" }, btn) : null);
    rowEls.set(f.id, { row, meta });
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
  const sessionHead = (s) => {
    const gs = s.school === "gs";
    return h("div", { class: "pn-gh" },
      h("h3", { id: "pn-g-" + s.id }, h("a", { href: "#/lk/s/" + s.id },
        s.startTime ? h("span", { class: "pn-time", text: s.startTime }) : null, s.startTime ? " " : null,
        h("span", { class: "ftag", dataset: { fach: s.subject }, text: gs ? "Grundschule" : subjectShort(s.subject) }), " ",
        h("strong", { text: gs ? (s.course ? s.course.short : "") : classShort(s.klass) }), s.title ? h("span", { class: "pn-t", text: " – " + s.title }) : null)),
      h("a", { class: "btn ghost pn-edit", href: "#/lk/s/" + s.id + "/druckliste", "aria-label": "Druckliste von „" + (s.title || s.label) + "“ (" + (gs ? "Grundschule " : "") + s.label + ") in der Sitzung bearbeiten" },
        icon("edit"), "In der Sitzung bearbeiten"));
  };
  function paintAll() {
    const all = filesOf();
    allBtn.classList.toggle("hidden", !all.length); allHint.classList.toggle("hidden", !all.length);
  }
  function paint() {
    if (!data) return;
    rowEls.clear();
    const withFiles = data.sessions.filter((s) => s.files.length), without = data.sessions.filter((s) => !s.files.length);
    const empty = !withFiles.length;
    // kein Unterricht gefunden bzw. keine Druckaufträge: der Satz steht im Inhalt; die Zeile zum Tag nur, wenn sie mehr sagt
    day.textContent = !data.date ? "" : empty && data.date <= data.candidate ? "" : dayText(data);
    day.classList.toggle("hidden", !day.textContent);
    clear(body); body.classList.remove("skeleton");
    if (!data.date) body.append(h("p", { class: "pn-empty", text: dayText(data) }));
    else if (empty) body.append(h("p", { class: "pn-empty", text: "Für " + longDay(data.date) + ", gibt es keine Druckaufträge." }));
    for (const s of withFiles) body.append(h("section", { class: "pn-group", "aria-labelledby": "pn-g-" + s.id }, sessionHead(s), h("div", { class: "list" }, s.files.map((f) => fileRow(f, s)))));
    if (without.length) body.append(h("p", { class: "small muted pn-none", text: "Ohne Druckaufträge: " + without.map((s) => (s.startTime ? s.startTime + " " : "") + (s.school === "gs" ? "Grundschule " : "") + s.label).join(", ") + "." }));
    paintAll();
  }
  async function reload() {
    const mine = ++run, had = card.contains(document.activeElement);
    try { const r = await load(); if (mine !== run) return; data = { today: r.today || null, candidate: r.candidate || null, date: r.date || null, sessions: Array.isArray(r.sessions) ? r.sessions : [] }; paint(); }
    catch (e) {
      if (mine !== run) return;
      data = null; rowEls.clear(); day.textContent = ""; day.classList.add("hidden"); paintAll();
      clear(body); body.classList.remove("skeleton");
      body.append(h("p", { class: "pn-err", role: "alert", text: "Die Druckaufträge ließen sich nicht laden: " + ((e && e.message) || e) }),
        h("button", { class: "btn", type: "button", onclick: (ev) => working(ev.currentTarget, reload, "Lade …") }, "Erneut versuchen"));
    }
    // war der Fokus im Feld (z. B. auf „Erneut versuchen“) und ist sein Element jetzt weg, geht er an die Überschrift – nie verloren auf body
    if (mine === run && had && card.isConnected && !card.contains(document.activeElement) && (!document.activeElement || document.activeElement === document.body)) heading.focus({ preventScroll: true });
  }

  /* „Alle Dateien herunterladen“: nacheinander, je Datei ein Download, dazwischen eine kurze Pause; Fortschritt in der Statuszeile */
  let running = false;
  async function downloadAll() {
    if (running || !data) return;
    const all = filesOf(), ready = all.filter((x) => readyForAll(x.f)), wait = all.filter((x) => !readyForAll(x.f)).map((x) => x.f);
    if (!ready.length) {
      status.textContent = wait.some((f) => !stuck(f)) ? "Die Vorlagen werden gerade noch als PDF gedruckt – bitte gleich noch einmal."
        : "Keine Datei ist fertig: Der PDF-Druck der Vorlagen hat nicht geklappt – bitte in der Sitzung „Erneut drucken“.";
      return;
    }
    running = true;
    const texts = new Map(), failed = [];
    let n = 0;
    await working(allBtn, async () => {
      for (let i = 0; i < ready.length; i++) {
        if (stopped || !card.isConnected) break;
        const { f, s } = ready[i];
        status.textContent = "Lade " + (i + 1) + " von " + ready.length + ": „" + printNameOf(f) + "“ …";
        try {
          const bytes = await pdfBytes(f, s, texts);
          if (stopped || !card.isConnected) break;
          io.blob(new Blob([bytes], { type: "application/pdf" }), printNameOf(f));
          n++;
        } catch (e) { failed.push({ f, msg: (e && e.message) || String(e) }); }
        if (i < ready.length - 1 && !stopped) await io.sleep(io.pauseMs);
      }
    }, "Lade die Dateien …");
    running = false;
    if (stopped || !card.isConnected) return;
    status.textContent = doneText(n, wait.filter((f) => !stuck(f)), failed, n + failed.length < ready.length, wait.filter(stuck));
  }

  // gestaltete Vorlagen: Stand aus der gemeinsamen Druck-Warteschlange (gedruckt, Zwischenstand, Fehler)
  const off = rq.on({
    done: (nf) => { const hit = filesOf().find((x) => x.f.id === nf.id); if (!hit) return; Object.assign(hit.f, nf); if (!nf.design) delete hit.f.design; delete hit.f.text; repaintFile(nf.id); },
    note: (fid, t) => { if (t) rNotes.set(fid, t); else rNotes.delete(fid); const el = rowEls.get(fid), hit = filesOf().find((x) => x.f.id === fid); if (el && hit && el.meta.isConnected && el.meta.firstChild) el.meta.firstChild.textContent = designMeta(hit.f); },
    // Tageskontingent aufgebraucht: die Warteschlange druckt nichts mehr – alle gestalteten Zeilen sagen jetzt „Noch nicht gedruckt: …“
    fail: (f0, e, quota) => { if (!quota) { repaintFile(f0.id); return; } for (const { f } of filesOf()) if (f.design) repaintFile(f.id); },
  });
  // zurück im Tab an einem anderen Tag (z. B. am nächsten Morgen): neu laden; ohne Feld im Dokument meldet sich der Zuhörer ab
  const onVis = () => {
    if (!card.isConnected) { document.removeEventListener("visibilitychange", onVis); return; }
    if (document.visibilityState === "visible" && berlinToday() !== today && !running) { today = berlinToday(); reload(); }
  };
  document.addEventListener("visibilitychange", onVis);
  onLeave(() => { stopped = true; run++; off(); document.removeEventListener("visibilitychange", onVis); });
  reload();
  return card;
}
