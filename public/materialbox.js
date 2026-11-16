// materialbox.js – Materialkasten einer Sitzung: Material für Schüler:innen und Lehrkräfte (Dateien, Links, Texte, von Claude gestaltetes
// Material mit Druckwarteschlange) und die Druckliste „Von der Lehrkraft auszudrucken“. Aus session.js ausgelagert (unverändert), damit
// auch die Sitzungsseite der Grundschule ihn nutzen kann.
import { lazy } from "./update.js";
import { h, clear, toast, errToast, busy, modal, confirmDialog, fmtBytes, fmtTime, fileIcon, downloadUrl, downloadBlob, upload, apiUrl, nn, icon } from "./ui.js";
import { onLeave } from "./app.js";
import { T, tapi } from "./teacher.js";
import { subjectName, formatCode, classShort, cleanWebUrl, webUrlLabel, printFileName, subjectShort, printReady, CARD_PRINT } from "./shared.js";
import { renderMarkdown } from "./markdown.js";
import { designState, printDesignState, printQueue } from "./designrender.js";

/* Ablagefläche für Dateien (Klick, Tastatur, Ziehen) */
export function dropZone(label, hint, onFiles, accept, multiple = true) {
  const inp = h("input", { type: "file", class: "hidden", multiple: multiple ? true : null, accept: accept || null });
  const z = h("div", { class: "drop", tabindex: "0", role: "button", "aria-label": label }, h("strong", { text: label }), h("span", { class: "small muted", text: hint }), inp);
  z.addEventListener("click", (e) => { if (e.target !== inp) inp.click(); });
  z.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inp.click(); } });
  z.addEventListener("dragover", (e) => { e.preventDefault(); z.classList.add("over"); });
  z.addEventListener("dragleave", () => z.classList.remove("over"));
  z.addEventListener("drop", (e) => { e.preventDefault(); z.classList.remove("over"); if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]); });
  inp.addEventListener("change", () => { if (inp.files.length) onFiles([...inp.files]); inp.value = ""; });
  return z;
}

/* Grundschule (gs: true): eigene Überschriften und Hinweise (labels), Dateien ausblenden (exclude, z. B. Bildkarten), ein Abzeichen je Datei
   (fileBadge(f) → Element, z. B. „Eltern sehen sie“), je PDF der Kinder „Auch ausdrucken (n×)“ (printCopies = Anzahl beim Einschalten) –
   solche PDFs stehen zusätzlich auf der Druckliste; subtitle/groupLabel für Text-PDFs und den Namen der ZIP-Datei; onChange() nach jeder Änderung
   an den Dateien, die Name, Stand oder Bereich einer PDF betrifft (gedruckt, gelöscht, umbenannt, verschoben – z. B. für den Verlaufsplan).
   Grundschule (Nachtrag 31): Bildkarten (f.cards) mit Druckangaben stehen auf der Druckliste – Anzahl, ein-/beidseitig und Farbe wie bei den anderen
   Einträgen, „Nicht ausdrucken“ nimmt sie nur herunter (löscht nichts); onPrintChange(f) nach jeder Änderung ihrer Druckangaben (Karte „Bildkarten“). */
export function materialBox({ lessonId: id, st, L, gs = false, labels = {}, exclude = null, fileBadge = null, printCopies = null, subtitle = null, groupLabel = null, onChange = null, onPrintChange = null }) {
  const lb = { student: "Für Schüler:innen zugänglich", teacher: "Nur für Lehrkräfte", toStudent: "Für Schüler:innen", toTeacher: "Nur für Lehrkraft",
    nowStudent: "Jetzt für Schüler:innen sichtbar.", nowTeacher: "Jetzt nur noch für Lehrkräfte.", teacherHint: "Wird Schüler:innen nie angezeigt", hint: null, ...labels };
  const shown = (f) => !exclude || !exclude(f);
  const changed = () => { if (onChange) onChange(); };
  const printChanged = (f) => { if (onPrintChange && f && f.cards) onPrintChange(f); };
  const isCards = (f) => gs && f.cards != null && f.area === "teacher";   // Bildkarten der Grundschule (nur auf der Druckliste, nie im Materialkasten)
  const textSub = () => subtitle || subjectName(L().subject) + " · " + L().klass;
  /* ======================= Materialien ======================= */
  const lists = { student: h("div", { class: "list" }), teacher: h("div", { class: "list" }) };
  /* von Claude gestaltetes Material: ausstehende und geänderte Gestaltungen nacheinander auf dem Server drucken lassen (gemeinsame
     Warteschlange des Tabs – sie druckt weiter, wenn Sie die Seite verlassen) */
  const rNotes = new Map(), rEls = new Map(), rowEls = new Map();   // Zwischenstand je Datei, die Stellen, die ihn zeigen, und die Zeilen
  const rq = printQueue();
  const designMeta = (f) => {
    const d = printDesignState(f), failed = rq.failed(f);
    return rNotes.get(f.id) || (failed && d.need ? "Druck fehlgeschlagen: " + failed : rq.quota && d.need ? "Noch nicht gedruckt: " + rq.quota : d.text);
  };
  // nur die Zeile dieser Datei neu aufbauen (Fokus und Eingaben in den anderen Zeilen bleiben)
  const repaintFile = (fid) => {
    const f = st.files.find((x) => x.id === fid), el = rowEls.get(fid);
    if (!f || !el || !el.isConnected) { paintFiles(); paintPrint(); return; }
    const had = el.contains(document.activeElement);
    const row = f.area === "print" || isCards(f) ? printRow(f) : fileRow(f);
    el.replaceWith(row);
    if (had) (row.querySelector("button, input, select") || row).focus({ preventScroll: true });
  };
  const printNote = h("p", { class: "small muted hidden", role: "status" });
  const showBusy = (n) => {
    printNote.textContent = n ? "Unterricks druckt gerade " + (n === 1 ? "ein Material" : n + " Materialien") + " von Claude als PDF (etwa " + Math.max(1, Math.round(n * 12 / 60)) + " min). Sie können weiterarbeiten." : "";
    printNote.classList.toggle("hidden", !n);
  };
  onLeave(rq.on({
    done: (nf) => { const f = st.files.find((x) => x.id === nf.id); if (!f) return; Object.assign(f, nf); if (!nf.design) delete f.design; repaintFile(f.id); changed(); zipNoteDone(f); },
    note: (fid, t) => { if (t) rNotes.set(fid, t); else rNotes.delete(fid); const f = st.files.find((x) => x.id === fid); for (const el of rEls.get(fid) || []) if (el.isConnected && f) el.textContent = designMeta(f); },
    fail: (f0, e, quota) => { if (quota) { toast(e.message, "err", 9000); paintFiles(); paintPrint(); } else repaintFile(f0.id); },
    busy: showBusy,
  }));
  showBusy(rq.pending);
  // Aktionen und Zeile „Stand“ für gestaltetes Material; null für alle anderen Dateien. Bildkarten (Druckliste): Stand nach cardsPrintState (erst die PDF der
  // aktuellen Gestaltung ist fertig), Download unter dem Namen der Druckliste (Link mit print: auch wo der Browser das download-Attribut nicht beachtet)
  function designBits(f, nameForDl) {
    const d = printDesignState(f);
    if (!d) return null;
    if (d.need) rq.add(f);
    const meta = h("span", { text: designMeta(f) });
    rEls.set(f.id, [...(rEls.get(f.id) || []).filter((x) => x.isConnected), meta]);
    const acts = [];
    if (d.ok) acts.push(h("button", { class: "btn small" + (f.area === "print" || isCards(f) ? " primary" : ""), type: "button", onclick: (e) => busy(e.currentTarget, async () => {
      try { const r = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: isCards(f) ? { print: true } : {} }); downloadUrl(r.url, nameForDl); } catch (err) { errToast(err); } }) }, icon("download"), "Herunterladen"));
    if (d.error || rq.failed(f) || (rq.quota && d.need)) acts.push(h("button", { class: "btn small", type: "button", onclick: () => { if (f.design) f.design = { ...f.design, error: null }; rq.again(f); repaintFile(f.id); } }, "Erneut drucken"));
    return { meta, acts, d, error: d.error || (!!rq.failed(f) && d.need) };
  }
  function fileRow(f) {
    const other = f.area === "student" ? "teacher" : "student";
    const acts = h("div", { class: "acts" });
    const des = designBits(f, f.name);
    if (des) acts.append(...des.acts);
    else if (f.kind === "link") {
      acts.append(h("a", { class: "btn small", href: f.url, target: "_blank", rel: "noopener noreferrer" }, "Öffnen", h("span", { class: "sr-only", text: " (öffnet in neuem Tab)" })),
        h("button", { class: "btn small", type: "button", onclick: () => editLink(f) }, "Bearbeiten"));
    } else if (f.kind === "text") {
      acts.append(h("button", { class: "btn small", type: "button", onclick: () => editText(f) }, "Ansehen/Bearbeiten"),
        h("button", { class: "btn small", type: "button", onclick: (e) => busy(e.currentTarget, async () => { try { const { markdownToPdf, pdfName } = await lazy(import("./pdfmaker.js")); downloadBlob(await markdownToPdf(f.name, f.text, { subtitle: textSub(), nameLine: f.area !== "teacher" }), pdfName(f.name)); } catch (err) { errToast(err); } }) }, "PDF"));
    } else {
      acts.append(h("button", { class: "btn small", type: "button", onclick: (e) => busy(e.currentTarget, async () => { try { const r = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: {} }); downloadUrl(r.url, f.name); } catch (err) { errToast(err); } }) }, "Herunterladen"));
    }
    acts.append(...nn(
      // Anmerkungs-PDF der Präsentation (Nachtrag 20): bleibt nur für die Lehrkraft und heißt fest so (entsteht aus den Notizen neu)
      f.notesOf ? null : h("button", { class: "btn small", type: "button", title: "In den anderen Bereich verschieben", onclick: async () => {
        try { const r = await tapi("PATCH", "/api/teacher/files/" + f.id, { body: { area: other } }); Object.assign(f, r.file); if (!r.file.print) delete f.print; paintFiles(); if (gs) paintPrint(); changed(); toast(other === "student" ? lb.nowStudent : lb.nowTeacher, "ok"); } catch (e) { errToast(e); }
      } }, icon("right"), other === "student" ? lb.toStudent : lb.toTeacher),
      f.kind === "link" || f.notesOf ? null : h("button", { class: "btn small ghost", type: "button", "aria-label": "Umbenennen", onclick: async () => {
        const n = prompt("Neuer Name:", f.name); if (!n) return;
        try { const r = await tapi("PATCH", "/api/teacher/files/" + f.id, { body: { name: n } }); Object.assign(f, r.file); paintFiles(); if (gs) paintPrint(); changed(); } catch (e) { errToast(e); }
      } }, icon("edit")),
      h("button", { class: "btn small ghost danger", type: "button", "aria-label": "Löschen", onclick: async () => {
        if (!(await confirmDialog("Datei löschen", "„" + f.name + "“ endgültig löschen?", "Löschen", true))) return;
        try { await tapi("DELETE", "/api/teacher/files/" + f.id); st.files = st.files.filter((x) => x !== f); paintFiles(); if (gs) paintPrint(); changed(); } catch (e) { errToast(e); }
      } }, icon("trash"))));
    const src = (f.source === "claude" ? " · von Claude" : f.source === "chat" ? " · aus dem Chat" : f.source === "vertretung" ? " · Vertretung" : f.source === "selbstlern" ? " · Selbstlern-Phase" : f.source === "uebernommen" ? " · übernommen" : f.source === "notfall" ? " · Notfall-Feibeitsblatt (automatisch aus dem Feibeitsblatt " + formatCode(f.fbCode || "") + ")" : f.notesOf ? " · automatisch aus den Notizen der Präsentation – jede Folie mit ihrer Anmerkungsfolie, nur für Sie" : "") + " · " + fmtTime(f.createdAt);
    const row = h("div", { class: "item" + (des && des.error ? " design-err" : "") }, fileIcon(f.name, f.mime, f.kind), h("div", { class: "main" }, h("div", { class: "name", text: f.name }),
      des ? h("div", { class: "meta" }, des.meta, (des.d.ok ? " · " + fmtBytes(f.size) : "") + (f.source === "vertretung" ? " · Vertretung" : f.source === "selbstlern" ? " · Selbstlern-Phase" : f.source === "uebernommen" ? " · übernommen" : "") + " · " + fmtTime(f.createdAt))
        : h("div", { class: "meta", text: (f.kind === "link" ? "Link: " + webUrlLabel(f.url) : f.kind === "text" ? "Text (PDF-Download)" : fmtBytes(f.size)) + src }),
      ...nn(fileBadge ? fileBadge(f) : null, gs ? printToggle(f) : null)), acts);
    rowEls.set(f.id, row);
    return row;
  }
  /* Grundschule: ein PDF der Kinder zusätzlich auf die Druckliste setzen („Auch ausdrucken (22×)“) bzw. wieder herunternehmen */
  function printToggle(f) {
    if (f.area !== "student" || f.kind !== "file" || f.mime !== "application/pdf") return null;
    const n = f.print ? f.print.copies : printCopies ? printCopies() || 1 : 1;
    const cb = h("input", { type: "checkbox", checked: f.print ? true : null });
    cb.addEventListener("change", async () => {
      cb.disabled = true;
      try {
        const r = await tapi("PATCH", "/api/teacher/files/" + f.id, { body: { copies: cb.checked ? n : null } });
        Object.assign(f, r.file); if (!r.file.print) delete f.print;
        toast(cb.checked ? "„" + f.name + "“ steht jetzt auch auf der Druckliste (" + f.print.copies + "×)." : "„" + f.name + "“ steht nicht mehr auf der Druckliste.", "ok");
        paintPrint();
      } catch (e) { cb.checked = !cb.checked; errToast(e); }
      cb.disabled = false;
    });
    return h("label", { class: "checkrow small printtoggle" }, cb, h("span", { text: "Auch ausdrucken (" + n + "×)" }));
  }
  function paintFiles() {
    for (const area of ["student", "teacher"]) {
      const fs = st.files.filter((f) => f.area === area && shown(f));
      clear(lists[area]).append(...(fs.length ? fs.map(fileRow) : [h("p", { class: "muted small", text: "Noch nichts hochgeladen." })]));
    }
  }
  /* Link zu einer Internetseite: Titel und Adresse (neu anlegen, wenn f fehlt) */
  function editLink(f, area) {
    const t = h("input", { id: "lk-t", value: f ? f.name : "", maxlength: "200", placeholder: "z. B. Erklärvideo der bpb" });
    const u = h("input", { id: "lk-u", value: f ? f.url : "", inputmode: "url", autocomplete: "off", spellcheck: "false", placeholder: "https://…" });
    const msg = h("p", { class: "err", role: "alert" });
    modal({ title: f ? "Link bearbeiten" : "Link hinzufügen", body: (el) => el.append(
      h("div", { class: "field" }, h("label", { for: "lk-t" }, "Titel"), t),
      h("div", { class: "field" }, h("label", { for: "lk-u" }, "Internetadresse"), u),
      h("p", { class: "hint", text: (f ? f.area : area) === "student" ? "Schüler:innen sehen den Titel und öffnen die Seite in einem neuen Tab." : "Nur für Sie sichtbar." }), msg),
      actions: [{ label: "Abbrechen" }, { label: f ? "Speichern" : "Hinzufügen", class: "primary", onClick: async () => {
        msg.textContent = "";
        const url = cleanWebUrl(u.value);
        if (!url) { msg.textContent = "Bitte eine gültige Internetadresse eingeben (beginnend mit https://)."; u.focus(); return false; }
        try {
          if (f) { const r = await tapi("PATCH", "/api/teacher/files/" + f.id, { body: { name: t.value.trim() || new URL(url).hostname, url } }); Object.assign(f, r.file); }
          else { const r = await tapi("POST", "/api/teacher/lessons/" + id + "/links", { body: { area, title: t.value, url } }); st.files.push(r.file); }
          paintFiles(); toast(f ? "Link gespeichert." : "Link hinzugefügt.", "ok");
        } catch (e) { msg.textContent = e.message; return false; }
      } }] });
  }
  function editText(f) {
    const ta = h("textarea", { rows: "16", value: f.text, class: "mono", style: { fontSize: ".88rem" } });
    const pv = h("div", { class: "card", style: { maxHeight: "50vh", overflow: "auto" } }, renderMarkdown(f.text));
    ta.addEventListener("input", () => { clear(pv).append(renderMarkdown(ta.value)); });
    modal({ title: f.name, wide: true, body: (el) => el.append(h("div", { class: "portal-wrap" }, ta, pv)),
      actions: [{ label: "Schließen" }, { label: "Speichern", class: "primary", onClick: async () => {
        try { const r = await tapi("PATCH", "/api/teacher/files/" + f.id, { body: { text: ta.value } }); Object.assign(f, r.file); paintFiles(); toast("Gespeichert.", "ok"); } catch (e) { errToast(e); return false; }
      } }] });
  }
  function uploadInto(area, progressBox) {
    return async (files) => {
      for (const file of files) {
        const bar = h("i"), row = h("div", { class: "small" }, h("div", { text: file.name + " (" + fmtBytes(file.size) + ")" }), h("div", { class: "progress" }, bar));
        progressBox.append(row);
        try {
          const r = await upload("/api/teacher/lessons/" + id + "/files?area=" + area + "&name=" + encodeURIComponent(file.name), file, T.token, (p) => { bar.style.width = Math.round(p * 100) + "%"; });
          st.files.push(r.file); paintFiles();
        } catch (e) { errToast(e); }
        row.remove();
      }
    };
  }
  const progS = h("div", { class: "stack" }), progT = h("div", { class: "stack" });
  const filesCard = h("section", { class: "card" + (gs ? " gs-material" : ""), id: gs ? "gs-material" : null }, h("div", { class: "section-title" }, h("h2", { text: "Material" })), printNote,
    h("div", { class: "zones" },
      h("div", { class: "stack" }, h("h3", { text: lb.student }), dropZone("Dateien hier ablegen oder auswählen", "PDF, Bilder, Word, PowerPoint, Excel u. a. – bis 100 MB je Datei", uploadInto("student", progS)),
        h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => editLink(null, "student") }, icon("plus"), "Link hinzufügen")), progS, lists.student),
      h("div", { class: "stack" }, h("h3", { text: lb.teacher }), dropZone("Dateien hier ablegen oder auswählen", lb.teacherHint, uploadInto("teacher", progT)),
        h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: () => editLink(null, "teacher") }, icon("plus"), "Link hinzufügen")), progT, lists.teacher)),
    h("p", { class: "hint", text: lb.hint || "Arbeitsblätter und weiteres Material gestaltet Claude über den Connector selbst; Unterricks druckt es unverändert als PDF (A4) und legt es hier ab – Schüler:innen sehen es, sobald die PDF fertig ist. " +
      "Aus dem Backup-Chat mit kostenloser KI übernehmen Sie Material mit „Als Material übernehmen“ unter einer Antwort (einfache PDF ohne eigene Gestaltung)." }));
  paintFiles();

  /* ======================= Von der Lehrkraft auszudrucken (ganz unten) ======================= */
  // nur PDF, gedruckt wird nur A4 (andere Formate rechnet a4.js beim Hochladen um); Dateiname „28x - beidseitig - sw - Name.pdf“
  const printList = h("div", { class: "list" }), printProg = h("div", { class: "stack" });
  const printFiles = () => st.files.filter((f) => f.area === "print" || (gs && f.area === "student" && f.print && shown(f)) || (isCards(f) && f.print));
  const pdfLib = () => lazy(import("/vendor/pdf-lib.esm.min.js"));
  async function printBytes(f) {
    if (f.kind === "text") {
      const { markdownToPdf } = await lazy(import("./pdfmaker.js"));
      return new Uint8Array(await (await markdownToPdf(f.name, f.text, { subtitle: subtitle || subjectName(L().subject) + " · " + classShort(L().klass) })).arrayBuffer());
    }
    const r = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: {} });
    const res = await fetch(apiUrl(r.url), { credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error("„" + f.name + "“ ließ sich nicht laden (Fehler " + res.status + ").");
    return new Uint8Array(await res.arrayBuffer());
  }
  function printRow(f) {
    const p = f.print || { copies: 1, duplex: true, color: false };
    const nameEl = h("div", { class: "name", text: f.printName || f.name });
    const save = async (body) => {
      try { const r = await tapi("PATCH", "/api/teacher/files/" + f.id, { body }); Object.assign(f, r.file); nameEl.textContent = f.printName; printChanged(f); }
      catch (e) { errToast(e); paintPrint(); }
    };
    const copies = h("input", { type: "number", min: "1", max: "500", step: "1", value: String(p.copies), class: "pcopies", "aria-label": "Anzahl der Exemplare – " + f.name });
    copies.addEventListener("change", () => {
      const n = Number(copies.value);
      if (!Number.isInteger(n) || n < 1 || n > 500) { copies.value = String((f.print || p).copies); toast("Bitte eine Anzahl zwischen 1 und 500 eingeben.", "err"); return; }
      save({ copies: n });
    });
    const duplex = h("select", { "aria-label": "Beidseitig oder einseitig – " + f.name },
      h("option", { value: "1", selected: p.duplex ? true : null }, "beidseitig"), h("option", { value: "0", selected: p.duplex ? null : true }, "einseitig (z. B. zum Ausschneiden)"));
    duplex.addEventListener("change", () => save({ duplex: duplex.value === "1" }));
    const color = h("select", { "aria-label": "Schwarz-weiß oder Farbe – " + f.name },
      h("option", { value: "0", selected: p.color ? null : true }, "schwarz-weiß"), h("option", { value: "1", selected: p.color ? true : null }, "Farbe (nur wenn nötig)"));
    color.addEventListener("change", () => save({ color: color.value === "1" }));
    const des = designBits(f, f.printName || f.name);
    const acts = h("div", { class: "acts" },
      ...(des ? des.acts : [h("button", { class: "btn small primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try {
          if (f.kind === "text") downloadBlob(new Blob([await printBytes(f)], { type: "application/pdf" }), f.printName);
          else { const r = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: isCards(f) ? { print: true } : {} }); downloadUrl(r.url, f.printName); }
        } catch (err) { errToast(err); }
      }) }, icon("download"), "Herunterladen")]),
      // Bildkarten: der Name gehört zum Kartensatz (Karte „Bildkarten“) – hier nur die Druckangaben
      isCards(f) ? null : h("button", { class: "btn small ghost", type: "button", "aria-label": "Umbenennen – " + f.name, onclick: async () => {
        const n = prompt("Name der Druckvorlage (ohne Anzahl und Druckart):", f.name.replace(/\.pdf$/i, ""));
        if (!n || !n.trim()) return;
        await save({ name: n.trim() + (f.kind === "file" ? ".pdf" : "") }); paintPrint(); if (gs && f.area === "student") paintFiles(); changed();
      } }, icon("edit")),
      // Bildkarten (Nachtrag 31): nur von der Druckliste nehmen – die Bildkarten, ihre Erzähltexte und die Elternansicht bleiben; Fokus danach auf die Überschrift
      isCards(f) ? h("button", { class: "btn small ghost", type: "button", "aria-label": "Nicht ausdrucken – " + (f.printName || f.name), onclick: async (e) => {
        const had = e.currentTarget;
        try {
          const r = await tapi("PATCH", "/api/teacher/files/" + f.id, { body: { copies: null } }); Object.assign(f, r.file); delete f.print; delete f.printName; paintPrint(); printChanged(f);
          toast("„" + f.name + "“ steht nicht mehr auf der Druckliste – die Bildkarten selbst und die Elternansicht bleiben unverändert.", "ok", 6000);
          if (!had.isConnected && (!document.activeElement || document.activeElement === document.body)) { printHead.setAttribute("tabindex", "-1"); printHead.focus({ preventScroll: true }); }
        } catch (err) { errToast(err); }
      } }, "Nicht ausdrucken") :
      f.area === "student" ? h("button", { class: "btn small ghost", type: "button", onclick: async () => {
        try { const r = await tapi("PATCH", "/api/teacher/files/" + f.id, { body: { copies: null } }); Object.assign(f, r.file); delete f.print; paintPrint(); paintFiles(); toast("„" + f.name + "“ steht nicht mehr auf der Druckliste (das Material für die Kinder bleibt).", "ok"); } catch (e) { errToast(e); }
      } }, "Nicht ausdrucken") :
      h("button", { class: "btn small ghost danger", type: "button", "aria-label": "Löschen – " + f.name, onclick: async () => {
        if (!(await confirmDialog("Druckvorlage löschen", "„" + (f.printName || f.name) + "“ endgültig löschen?", "Löschen", true))) return;
        try { await tapi("DELETE", "/api/teacher/files/" + f.id); st.files = st.files.filter((x) => x !== f); paintPrint(); changed(); } catch (e) { errToast(e); }
      } }, icon("trash")));
    const row = h("div", { class: "item printrow" + (des && des.error ? " design-err" : "") }, fileIcon(f.name, "application/pdf", "file"), h("div", { class: "main" }, nameEl,
      h("div", { class: "pset" }, h("label", { class: "small pcount" }, copies, h("span", { text: "Exemplare" })), duplex, color),
      des ? h("div", { class: "meta" }, des.meta, (isCards(f) ? " · Bildkarten" : "") + (des.d.ok ? " · " + fmtBytes(f.size) : "") + (f.source === "vertretung" ? " · Vertretung" : f.source === "selbstlern" ? " · Selbstlern-Phase" : f.source === "uebernommen" ? " · übernommen" : ""))
        : h("div", { class: "meta", text: (isCards(f) ? "Bildkarten · " : "") + (f.kind === "text" ? "Text (als A4-PDF)" : fmtBytes(f.size)) + (f.source === "claude" ? " · von Claude" : f.source === "uebernommen" ? " · übernommen" : "") })), acts);
    rowEls.set(f.id, row);
    return row;
  }
  async function uploadPrint(files) {
    for (const file of files) {
      const bar = h("i"), row = h("div", { class: "small" }, h("div", { text: file.name + " (" + fmtBytes(file.size) + ")" }), h("div", { class: "progress" }, bar));
      printProg.append(row);
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        if (!(buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46 && buf[4] === 0x2d)) throw new Error("„" + file.name + "“ ist keine PDF-Datei. Zum Ausdrucken sind nur PDF-Dateien erlaubt.");
        const { toA4 } = await lazy(import("./a4.js"));
        const a4 = await toA4(buf, await pdfLib());
        const name = /\.pdf$/i.test(file.name) ? file.name : file.name + ".pdf";
        const r = await upload("/api/teacher/lessons/" + id + "/print?name=" + encodeURIComponent(name), new Blob([a4.bytes], { type: "application/pdf" }), T.token, (q) => { bar.style.width = Math.round(q * 100) + "%"; }, "application/pdf");
        st.files.push(r.file); paintPrint();
        if (a4.changed) toast("„" + file.name + "“: " + (a4.changed === a4.total ? (a4.total === 1 ? "Die Seite war" : "Alle " + a4.total + " Seiten waren") : a4.changed + " von " + a4.total + " Seiten waren") +
          " nicht im Format A4 und " + (a4.changed === 1 ? "wurde" : "wurden") + " auf A4 umgerechnet.", "ok", 9000);
      } catch (e) { errToast(e); }
      row.remove();
    }
  }
  const zipName = () => "Von der Lehrkraft auszudrucken - " + (groupLabel || subjectShort(L().subject) + " - " + classShort(L().klass)) + (L().date ? " - " + L().date : "") + ".zip";
  /* Bildkarten, die (noch) nicht in der ZIP-Datei sind (Nachtrag 31): nie stillschweigend – die Zeile unter dem Knopf nennt sie mit dem Grund und bleibt stehen,
     bis die ZIP-Datei neu gepackt wird; wird eine von ihnen inzwischen gedruckt, sagt sie, dass die ZIP-Datei jetzt vollständig wäre */
  const zipNote = h("p", { class: "small warnc hidden", id: "print-zip-note", role: "status" }), zipMissing = new Set();
  const cardWhy = (f) => { const d = printDesignState(f), failed = rq.failed(f);
    return d && (d.error || (d.need && failed)) ? "der PDF-Druck hat nicht geklappt – bei der Datei „Erneut drucken“" : d && d.need && rq.quota ? "noch nicht gedruckt – " + rq.quota
      : "wird gerade als PDF gedruckt – bitte gleich noch einmal herunterladen"; };
  const cardsMissingText = (list) => "Nicht in der ZIP-Datei – " + (list.length === 1 ? "die Bildkarten " : "diese Bildkarten: ") +
    list.map((f) => "„" + (f.printName || printFileName({ name: f.name, ...(f.print || CARD_PRINT) })) + "“ (" + cardWhy(f) + ")").join("; ") + ".";
  function setZipNote(list) {
    zipMissing.clear(); for (const f of list) zipMissing.add(f.id);
    zipNote.textContent = list.length ? cardsMissingText(list) : ""; zipNote.classList.toggle("hidden", !list.length);
  }
  function zipNoteDone(f) {
    if (!zipMissing.has(f.id) || !printReady(f)) return;
    zipMissing.delete(f.id);
    const rest = printFiles().filter((x) => zipMissing.has(x.id));
    zipNote.textContent = rest.length ? cardsMissingText(rest) : "Die Bildkarten sind jetzt gedruckt – laden Sie die ZIP-Datei bitte noch einmal herunter, dann sind sie dabei.";
  }
  const zipBtn = h("button", { class: "btn", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
    try {
      const all = printFiles(); if (!all.length) return;
      // gestaltete Vorlagen, die noch nicht gedruckt sind, fehlen in der ZIP-Datei (Hinweis); Bildkarten erst mit der PDF ihrer aktuellen Gestaltung (printReady)
      const fs = all.filter(printReady), wait = all.filter((f) => !fs.includes(f) && !f.cards), cardsWait = all.filter((f) => !fs.includes(f) && f.cards);
      for (const f of cardsWait) { const d = printDesignState(f); if (d && d.need) rq.add(f); }   // druckt sie (falls noch nicht unterwegs)
      setZipNote(cardsWait);
      if (!fs.length) { toast(cardsWait.length ? cardsMissingText(cardsWait) : "Die Vorlagen werden gerade noch als PDF gedruckt – bitte gleich noch einmal.", "err", cardsWait.length ? 9000 : 4200); return; }
      const entries = [];
      for (const f of fs) entries.push({ name: f.printName || printFileName({ name: f.name, ...(f.print || {}) }), data: await printBytes(f) });
      const { makeZip } = await lazy(import("./zip.js"));
      downloadBlob(new Blob([makeZip(entries)], { type: "application/zip" }), zipName());
      const late = wait.length || cardsWait.length;
      toast((fs.length === 1 ? "Die Datei ist als ZIP-Datei heruntergeladen." : "Alle " + fs.length + " Dateien sind als eine ZIP-Datei heruntergeladen.") +
        (wait.length ? " Noch nicht dabei (wird gerade als PDF gedruckt): " + wait.map((f) => "„" + f.name + "“").join(", ") + "." : "") + (cardsWait.length ? " " + cardsMissingText(cardsWait) : ""),
        late ? "" : "ok", late ? 9000 : 4200);
    } catch (err) { errToast(err); }
  }, "Packe die Dateien …") }, icon("download"), "Alle herunterladen (ZIP)");
  function paintPrint() {
    const fs = printFiles();
    clear(printList).append(...(fs.length ? fs.map(printRow) : [h("p", { class: "muted small", text: "Noch nichts zum Ausdrucken." })]));
    zipBtn.disabled = !fs.length;
    // Hinweis zur ZIP-Datei: Bildkarten, die inzwischen nicht mehr auf der Liste stehen (heruntergenommen, gelöscht), nennt er nicht mehr
    if (zipMissing.size) {
      const rest = fs.filter((f) => zipMissing.has(f.id));
      if (rest.length < zipMissing.size) { if (rest.length) setZipNote(rest); else { zipMissing.clear(); zipNote.textContent = ""; zipNote.classList.add("hidden"); } }
    }
  }
  const printHead = h("h2", { text: "Von der Lehrkraft auszudrucken" });
  const printCard = h("section", { class: "card printcard", id: "printcard" }, h("div", { class: "section-title" }, printHead),
    h("p", { class: "small", text: "PDF-Dateien, die Sie vor der Stunde ausdrucken – z. B. Arbeitsblätter, Karten oder Schaubilder für die Tafel. Gedruckt wird nur A4: Andere Formate rechnet Unterricks beim Hochladen auf A4 um. Der Dateiname nennt Anzahl, beidseitig/einseitig und schwarz-weiß/Farbe." }),
    lb.printHint ? h("p", { class: "small", id: "print-cards-hint", text: lb.printHint }) : null,
    dropZone("PDF-Dateien zum Ausdrucken hier ablegen oder auswählen", "Nur PDF · Farbe bitte nur, wenn sie unbedingt nötig ist", uploadPrint, "application/pdf,.pdf"),
    printProg, printList, h("div", { class: "row", style: { marginTop: ".6rem" } }, zipBtn), gs ? zipNote : null,
    h("p", { class: "hint", text: "Claude gestaltet über den Connector auch Druckvorlagen selbst (mit Vorschlag für Anzahl, beidseitig und Farbe); Unterricks druckt sie als PDF – Sie prüfen sie hier." }));
  paintPrint();
  // Schlüssel des Dateistands: neue, gelöschte, umbenannte und (von Claude) neu gestaltete oder inzwischen gedruckte Dateien
  const filesKey = (fs) => fs.map((f) => f.id + ":" + f.status + ":" + f.name + ":" + f.area + (f.design ? ":" + f.design.htmlAt + "/" + f.design.pdfAt + "/" + (f.design.error || "") : "") + (gs && f.print ? ":p" + f.print.copies : "")).join("|");
  return { filesCard, printCard, paintFiles, paintPrint, repaintFile, filesKey };
}
