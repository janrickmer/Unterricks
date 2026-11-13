// notesedit.js – Notizen der Lehrkraft zu den Folien in der Sitzung ansehen und bearbeiten (Nachtrag 20, Rückfrage 2: nur die Lehrkraft sieht sie).
// Je Folie das Vorschaubild und ein Textfeld (ein Stichpunkt je Zeile); Speichern mit Versionsschutz (409: nie still überschreiben); „JSON aus dem
// Chat einfügen“, wenn Claude die Notizen nicht in die PDF einbetten konnte. Die PDF selbst bleibt unverändert; nach dem Speichern entsteht die
// Anmerkungs-PDF unter „Material nur für die Lehrkraft“ neu.
import { h, clear, modal, apiUrl, busy, stateLine } from "./ui.js";
import { cleanSlideNotes, notesFor, notesText, parseNotesJson, NOTES_LIMITS } from "./shared.js";

export const NOTES_SUMMARY_NONE = "Noch keine Notizen. Claude bettet sie laut Präsentations-Prompt unsichtbar in die PDF ein; Sie können sie auch hier eintragen oder den JSON-Block aus dem Chat einfügen.";
export const notesSummary = (k, pages) => "Notizen zu " + k + (k === 1 ? " Folie" : " Folien") + (pages ? " von " + pages : "") + ".";
export const NOTES_WHERE = "Nur für Sie: in der Präsentationsansicht unter der aktuellen Folie, sobald ein Beamerfenster oder Beamergerät verbunden ist (ein einzeln gespiegeltes iPad zeigt sie nicht), " +
  "und in der „Präsentation mit Anmerkungen“ unter „Material nur für die Lehrkraft“. Schüler:innen sehen sie nie – auch nicht in der PDF, die sie nach der Stunde bekommen.";
export const NOTES_FIELD_HINT = "Ein Stichpunkt je Zeile – höchstens " + NOTES_LIMITS.items + " je Folie und " + NOTES_LIMITS.chars + " Zeichen je Stichpunkt.";

/* ui = Zustand, der das Neuzeichnen der Präsentationskarte übersteht: {open, base: {notes, rev} | null, draft: Map n → Text | null}
   p = Präsentation (fileOut), slides = Antwort von …/slides (urls, notes, notesRev, codeSlides) oder null
   request(method, path, opt) = Anfrage der Lehrkraft (tapi); onSaved({notes, rev, file}) nach dem Speichern (danach Anmerkungs-PDF); toastErr(e) */
export function notesPanel({ p, slides, ui, request, onSaved, toastErr }) {
  const pages = p.pages || 0, holders = new Set(((slides && slides.codeSlides) || p.codeSlides || []).map((c) => c.n));
  if (!ui.base && slides && Array.isArray(slides.notes)) ui.base = { notes: cleanSlideNotes(slides.notes, pages), rev: Number(slides.notesRev) || 0 };
  const summaryText = () => { const k = ui.base ? ui.base.notes.length : p.notes || 0; return k ? notesSummary(k, pages) + " " + NOTES_WHERE : NOTES_SUMMARY_NONE; };
  const summary = h("p", { class: "small", text: summaryText() });
  const status = h("p", { class: "small notes-status", role: "status" });
  const edId = "notes-ed-" + p.id;
  const toggle = h("button", { class: "btn small", type: "button", "aria-expanded": String(!!ui.open), "aria-controls": edId }, ui.open ? "Notizen schließen" : "Notizen ansehen und bearbeiten");
  const ed = h("div", { class: "notes-ed", id: edId, hidden: !ui.open });
  const box = h("div", { class: "notesbox" },
    h("h3", { text: "Notizen zu den Folien (nur für Sie)" }),
    summary,
    h("div", { class: "row" }, toggle), ed, status);
  const fields = new Map();   // n → textarea
  const baseText = (n) => notesText(ui.base ? notesFor(ui.base.notes, n) : []);
  const valueOf = (n) => (ui.draft && ui.draft.has(n) ? ui.draft.get(n) : baseText(n));
  const collect = () => cleanSlideNotes(Array.from({ length: pages }, (_, i) => ({ n: i + 1, items: valueOf(i + 1) })), pages);
  async function load() {
    if (ui.base) return true;
    try { const r = await request("GET", "/api/teacher/files/" + p.id + "/notes"); ui.base = { notes: cleanSlideNotes(r.notes, pages), rev: Number(r.rev) || 0 }; return true; }
    catch (e) { stateLine(status, "Die Notizen ließen sich nicht laden: " + (e && e.message ? e.message : e), "err"); return false; }
  }
  function build() {
    fields.clear();
    const list = h("ol", { class: "notes-list", "aria-label": "Notizen je Folie" });
    for (let n = 1; n <= pages; n++) {
      const id = "nt-" + p.id + "-" + n, url = slides && slides.urls ? slides.urls[n - 1] : null;
      const v = valueOf(n), ta = h("textarea", { id, rows: String(Math.min(8, Math.max(3, v.split("\n").length + 1))), spellcheck: "true", "aria-describedby": edId + "-hint", value: v });
      ta.addEventListener("input", () => { if (!ui.draft) ui.draft = new Map(); ui.draft.set(n, ta.value); stateLine(status, ""); });
      fields.set(n, ta);
      list.append(h("li", { class: "notes-row" },
        url ? h("img", { class: "notes-thumb", src: apiUrl(url), alt: "", loading: "lazy" }) : h("div", { class: "notes-thumb none", "aria-hidden": "true", text: String(n) }),
        h("div", { class: "notes-field" }, h("label", { for: id, text: "Folie " + n + (holders.has(n) ? " (Codefolie)" : "") }), ta)));
    }
    const save = h("button", { class: "btn primary", type: "button", onclick: (e) => busy(e.currentTarget, () => doSave(), "Speichere …") }, "Notizen speichern");
    const paste = h("button", { class: "btn", type: "button", onclick: () => pasteJson() }, "JSON aus dem Chat einfügen");
    const close = h("button", { class: "btn ghost", type: "button", onclick: () => setOpen(false, true) }, "Schließen");
    clear(ed).append(h("p", { class: "hint", id: edId + "-hint", text: NOTES_FIELD_HINT }), list, h("div", { class: "row notes-acts" }, save, paste, close));
  }
  // Felder neu befüllen, ohne die Liste neu zu bauen (der Fokus bleibt, wo er ist)
  function refill() {
    if (!fields.size || !ed.contains(fields.get(1) || null)) { if (ui.open) build(); return; }
    for (const [n, ta] of fields) { const v = valueOf(n); if (ta.value !== v) ta.value = v; }
  }
  async function setOpen(on, focusToggle = false) {
    if (on && !(await load())) return;
    ui.open = on; ed.hidden = !on;
    toggle.setAttribute("aria-expanded", String(on)); toggle.textContent = on ? "Notizen schließen" : "Notizen ansehen und bearbeiten";
    if (on) build();   // der Fokus bleibt auf dem Knopf (Aufklappen)
    else if (focusToggle && box.isConnected) toggle.focus();
  }
  toggle.addEventListener("click", () => setOpen(!ui.open));
  if (ui.open) { if (ui.base) build(); else load().then((ok) => { if (ok && ui.open && box.isConnected) build(); }); }

  async function doSave(force = null) {
    const notes = collect(), rev = force !== null ? force : ui.base ? ui.base.rev : 0;
    try {
      const r = await request("PUT", "/api/teacher/files/" + p.id + "/notes", { body: { notes, rev } });
      ui.base = { notes: r.notes, rev: r.rev }; ui.draft = null;
      summary.textContent = summaryText();
      if (ui.open) refill();
      stateLine(status, r.notes.length ? "Gespeichert – die Anmerkungs-PDF wird erneuert …" : "Gespeichert – keine Notizen mehr; die Anmerkungs-PDF ist entfernt.", "ok");
      await onSaved(r, (t, kind) => { if (box.isConnected) stateLine(status, t, kind); });
    } catch (e) {
      if (e && e.status === 409 && e.data && e.data.current) return conflict(e.data.current);
      toastErr(e);
    }
  }
  // 409: inzwischen anderswo geändert (zweiter Tab, Sitzungsdatei) – nie still überschreiben
  function conflict(cur) {
    return new Promise((resolve) => {
      modal({ title: "Notizen wurden geändert", body: h("p", { text: "Die Notizen dieser Präsentation wurden inzwischen an anderer Stelle geändert. Möchten Sie den neuen Stand laden (Ihre Änderungen hier gehen verloren) oder Ihre Fassung trotzdem speichern?" }),
        onClose: () => resolve(),
        actions: [
          { label: "Neuen Stand laden", onClick: () => { ui.base = { notes: cleanSlideNotes(cur.notes, pages), rev: Number(cur.rev) || 0 }; ui.draft = null; summary.textContent = summaryText(); if (ui.open) refill(); stateLine(status, "Der neue Stand ist geladen."); } },
          { label: "Meine Fassung speichern", class: "primary", onClick: () => { setTimeout(() => doSave(Number(cur.rev) || 0), 0); } },
        ] });
    });
  }
  // Rückfall: JSON-Block aus dem Chat (Claude konnte die Datei nicht einbetten) – füllt die Felder, gespeichert wird erst mit „Notizen speichern“
  function pasteJson() {
    const ta = h("textarea", { id: "notes-json", rows: "10", class: "mono", spellcheck: "false", "aria-describedby": "notes-json-hint notes-json-err" });
    const err = h("p", { class: "err", id: "notes-json-err", role: "alert" });
    modal({ title: "JSON aus dem Chat einfügen", wide: true,
      body: h("div", { class: "stack" }, h("label", { for: "notes-json", text: "JSON-Block mit den Notizen" }), ta,
        h("p", { class: "hint", id: "notes-json-hint", text: "Kopieren Sie den Block, den Claude am Ende des Chats ausgegeben hat ({\"v\":1,\"folien\":[…]}), und fügen Sie ihn hier ein. Er ersetzt die Notizen in den Feldern – gespeichert wird erst mit „Notizen speichern“." }), err),
      actions: [{ label: "Abbrechen" }, { label: "Übernehmen", class: "primary", onClick: () => {
        let r;
        try { r = parseNotesJson(ta.value, pages); } catch (e) { err.textContent = e.message; ta.setAttribute("aria-invalid", "true"); ta.focus(); return false; }
        ui.draft = new Map(Array.from({ length: pages }, (_, i) => [i + 1, notesText(notesFor(r.notes, i + 1))]));
        refill();
        stateLine(status, "Übernommen: Notizen zu " + r.slides + (r.slides === 1 ? " Folie" : " Folien") + (r.dropped.length ? " (Folie " + r.dropped.join(", ") + " gibt es in der PDF nicht)" : "") + " – bitte prüfen und speichern.");
      } }] });
  }
  return box;
}
/* ungespeicherte Änderungen (beforeunload) */
const norm = (n, t) => notesText(notesFor(cleanSlideNotes([{ n, items: t }], NOTES_LIMITS.slides), n));
export const notesDirty = (ui) => !!(ui && ui.draft && ui.base && [...ui.draft].some(([n, t]) => norm(n, t) !== notesText(notesFor(ui.base.notes, n))));
