// pollpanel.js – „Umfragefolien“ in der Präsentationskarte der Sitzungsseite (Nachtrag 46): zeigt, auf welchen Folien Unterricks im Unterricht eine anonyme
// Umfrage durchführt, und lässt die Lehrkraft Frage und Antworten prüfen, ändern oder selbst festlegen (Rückfall für Präsentationen ohne die unsichtbare Zeile
// „Unterricks-Umfrage: …“). Gespeichert an der Präsentation (hand, gilt vor der PDF; [] = bewusst keine). Darunter der Stand der Umfragen dieser Sitzung
// (läuft / beendet, Zahlen je Antwort) mit „Ergebnis löschen und Umfrage neu öffnen“ – z. B. nach einem Probelauf zu Hause.
// Baut sich nur beim Aufklappen neu (nie unter dem Fokus); Speichern ändert nur Status und Übersicht.
import { h, busy, stateLine, nn, confirmDialog } from "./ui.js";
import { pollSlidesOf, strictPollSpec, votesText, fmtLeft, pollFileOf, POLL_LIMITS, POLL_TITLE } from "./polls.js";
import { pollBars } from "./pollview.js";
import { cleanSlideLine } from "./shared.js";

export const POLLS_HINT = "Auf einer Umfragefolie stimmen die Schüler:innen in ihrer Sitzung anonym ab – nur solange Sie genau diese Folie live zeigen, je Gerät einmal. " +
  "Etwa 2 Minuten nach der ersten Antwort endet die Abstimmung; ab dann sehen die Schüler:innen das Ergebnis ganz unten unter „" + POLL_TITLE + "“. " +
  "In Ihrer Präsentationsansicht sehen Sie live, wie viele abgestimmt haben, und können das Ergebnis am Beamer zeigen. " +
  "Claude kennzeichnet Umfragefolien laut Präsentations-Prompt unsichtbar in der PDF; hier prüfen Sie sie oder legen sie selbst fest.";
export const POLL_RESET_TEXT = "Die gezählten Antworten und das Ergebnis dieser Umfrage werden gelöscht – auch bei den Schüler:innen. Danach kann jedes Gerät wieder einmal abstimmen, sobald Sie die Folie live zeigen.";
export const pollsSummary = (p) => {
  const list = pollSlidesOf(p), hand = !!(p && p.polls && Array.isArray(p.polls.hand));
  if (!list.length) return hand ? "keine (von Ihnen festgelegt)" : "keine";
  return (hand ? "von Ihnen festgelegt" : "aus der PDF") + ": " + (list.length === 1 ? "Folie " : "Folien ") + list.map((v) => v.n).join(", ");
};
/* eine Zeile des Formulars lesen → {v} | {error, field} (k = laufende Nummer für die Meldung) */
export function readPollRow({ slide, q, options }, k) {
  const pre = "Umfrage " + k + ": ";
  const n = Number(slide);
  if (!Number.isInteger(n) || n < 1) return { error: pre + "Bitte eine Folie wählen.", field: "sel" };
  // wie der Server bereinigt (zusammengesetzte Umlaute, weiche Trennstriche und Steuerzeichen aus kopiertem Text) – sonst lehnte die strenge Prüfung ohne erkennbaren Grund ab
  const SHY = new RegExp(String.fromCharCode(173), "g");   // weicher Trennstrich: ersatzlos (cleanSlideLine setzte ein Leerzeichen mitten ins Wort)
  const tidy = (x) => cleanSlideLine(String(x || "").replace(SHY, ""), 2000);
  const qq = tidy(q);
  if (!qq) return { error: pre + "Bitte die Frage eingeben.", field: "q" };
  if (qq.length > POLL_LIMITS.question) return { error: pre + "Die Frage ist zu lang (höchstens " + POLL_LIMITS.question + " Zeichen).", field: "q" };
  const opts = String(options || "").split(/\r?\n/).map(tidy).filter(Boolean);
  if (opts.length < POLL_LIMITS.optionsMin) return { error: pre + "Bitte mindestens " + POLL_LIMITS.optionsMin + " Antworten eingeben – jede in einer eigenen Zeile.", field: "opts" };
  if (opts.length > POLL_LIMITS.optionsMax) return { error: pre + "Höchstens " + POLL_LIMITS.optionsMax + " Antworten.", field: "opts" };
  if (opts.some((o) => o.length > POLL_LIMITS.option)) return { error: pre + "Eine Antwort ist zu lang (höchstens " + POLL_LIMITS.option + " Zeichen).", field: "opts" };
  if (/[|｜¦]/.test(qq + opts.join(""))) return { error: pre + "Frage und Antworten dürfen keinen senkrechten Strich enthalten.", field: "opts" };
  if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return { error: pre + "Zwei Antworten sind gleich – jede Antwort darf nur einmal vorkommen.", field: "opts" };
  const v = strictPollSpec({ q: qq, options: opts });
  if (!v) return { error: pre + "Diese Angaben lassen sich nicht übernehmen – bitte Frage und Antworten prüfen.", field: "opts" };
  return { v: { n, ...v } };
}

/* p = Präsentation (fileOut), lessonId, request(method, path, opt) = tapi, onSaved(file) nach dem Speichern, ui = {open} (bleibt über Neuzeichnen) */
export function pollsPanel({ p, lessonId, request, onSaved, ui = { open: false } }) {
  const sum = h("summary"), body = h("div", { class: "stack pollbody" });
  const box = h("details", { class: "box polleditbox", id: "polls" }, sum, body);
  box.open = ui.open;
  const paintSum = () => { sum.replaceChildren(h("span", null, "Umfragefolien", h("span", { class: "muted small", text: " – " + pollsSummary(p) }))); };
  let seq = 0, loadSeq = 0;
  function paint() {
    const list = pollSlidesOf(p), rows = h("div", { class: "pollrows" });
    const err = h("p", { class: "small err hidden", id: "poll-edit-err", role: "alert" }), state = h("span", { class: "save-state", role: "status" });
    const dirty = () => { err.classList.add("hidden"); if (state.textContent !== "Nicht gespeichert") stateLine(state, "Nicht gespeichert"); };
    const addRow = (v) => {
      const k = ++seq, id = (x) => "pol-" + x + "-" + k;
      const sel = h("select", { id: id("n") }, h("option", { value: "" }, "Folie wählen"),
        Array.from({ length: p.pages }, (_, i) => h("option", { value: String(i + 1), selected: v && v.n === i + 1 ? true : null }, "Folie " + (i + 1))));
      const q = h("input", { id: id("q"), type: "text", autocomplete: "off", maxlength: String(POLL_LIMITS.question), value: v ? v.q : "" });
      const opts = h("textarea", { id: id("o"), rows: "4", autocomplete: "off", "aria-describedby": id("oh"), value: v ? v.options.join("\n") : "" });
      const legend = h("legend", { text: "Umfrage" });
      const del = h("button", { class: "btn small ghost danger", type: "button" }, "Entfernen");
      const row = h("fieldset", { class: "pollrow" }, legend,
        h("div", { class: "field" }, h("label", { for: id("n") }, "Folie"), sel),
        h("div", { class: "field pol-q" }, h("label", { for: id("q") }, "Frage"), q),
        h("div", { class: "field pol-o" }, h("label", { for: id("o") }, "Antworten"), opts,
          h("p", { class: "hint", id: id("oh"), text: "Jede Antwort in einer eigenen Zeile (" + POLL_LIMITS.optionsMin + " bis " + POLL_LIMITS.optionsMax + "); genau eine ist wählbar." })), del);
      row._read = () => ({ slide: sel.value, q: q.value, options: opts.value });
      row._fields = { sel, q, opts };
      for (const el of [sel, q, opts]) el.addEventListener("input", dirty);
      sel.addEventListener("change", dirty);
      del.addEventListener("click", () => {
        const all = [...rows.children], i = all.indexOf(row);
        row.remove(); renumber(); dirty();
        const next = rows.children[i] || rows.children[i - 1];   // Fokus auf die nachgerückte bzw. vorige Zeile, sonst auf „Umfragefolie hinzufügen“
        (next ? next.querySelector("select") : addBtn).focus({ preventScroll: true });
      });
      rows.append(row); renumber();
      return row;
    };
    const renumber = () => [...rows.children].forEach((r, i) => { r.querySelector("legend").textContent = "Umfrage " + (i + 1); r.querySelector(".btn.danger").setAttribute("aria-label", "Umfrage " + (i + 1) + " entfernen"); });
    for (const v of list) addRow(v);
    const addBtn = h("button", { class: "btn small", type: "button" }, "Umfragefolie hinzufügen");
    addBtn.addEventListener("click", () => {
      if (rows.children.length >= POLL_LIMITS.slides) { err.textContent = "Höchstens " + POLL_LIMITS.slides + " Umfragen je Präsentation."; err.classList.remove("hidden"); return; }
      const r = addRow(null); dirty(); r.querySelector("select").focus({ preventScroll: true });
    });
    const read = () => {
      const out = [], seen = new Set();
      for (const [i, r] of [...rows.children].entries()) {
        const x = readPollRow(r._read(), i + 1);
        if (x.error) return { error: x.error, row: r, field: x.field };
        if (seen.has(x.v.n)) return { error: "Umfrage " + (i + 1) + ": Folie " + x.v.n + " hat schon eine Umfrage – je Folie höchstens eine.", row: r, field: "sel" };
        seen.add(x.v.n); out.push(x.v);
      }
      return { list: out.sort((a, b) => a.n - b.n) };
    };
    const save = async (btn, hand) => {
      err.classList.add("hidden");
      await busy(btn, async () => {
        try {
          const r = await request("PUT", "/api/teacher/files/" + p.id + "/polls", { body: { hand } });
          Object.assign(p, r.file);
          paintSum();
          stateLine(state, (hand ? "Gespeichert – Unterricks folgt jetzt Ihren Umfragefolien. Eine laufende Präsentation übernimmt sie beim nächsten Start." : "Gespeichert – es gelten wieder die Umfragefolien aus der PDF.") +
            " Hat eine Umfrage schon Antworten, gilt eine Änderung an ihr erst nach „Ergebnis löschen und Umfrage neu öffnen“.", "ok");
          fromPdf.classList.toggle("hidden", !(p.polls && Array.isArray(p.polls.hand) && p.polls.pdf));
          if (!hand) { rows.replaceChildren(); for (const v of pollSlidesOf(p)) addRow(v); }
          if (onSaved) onSaved(r.file);
          loadStatus();
        } catch (e) { stateLine(state, "Nicht gespeichert: " + e.message, "err"); }
      }, "Speichert …");
      if (!document.activeElement || document.activeElement === document.body) (btn.classList.contains("hidden") ? saveBtn : btn).focus({ preventScroll: true });
    };
    const saveBtn = h("button", { class: "btn small primary", type: "button" }, "Umfragefolien speichern");
    saveBtn.addEventListener("click", () => {
      const r = read();
      if (r.error) {
        err.textContent = r.error; err.classList.remove("hidden");
        if (r.row) r.row._fields[r.field || "q"].focus({ preventScroll: true });
        return;
      }
      save(saveBtn, r.list);
    });
    const fromPdf = h("button", { class: "btn small ghost" + (p.polls && Array.isArray(p.polls.hand) && p.polls.pdf ? "" : " hidden"), type: "button" }, "Umfragefolien aus der PDF übernehmen");
    fromPdf.addEventListener("click", () => save(fromPdf, null));

    /* Stand der Umfragen dieser Sitzung (aus dem Durable Object): je Umfrage Zahlen, läuft bzw. beendet, und „Ergebnis löschen und Umfrage neu öffnen“ */
    const statusList = h("div", { class: "pollstatus-list" }), statusState = h("span", { class: "save-state", role: "status" });
    const reload = h("button", { class: "btn small ghost", type: "button" }, "Stand aktualisieren");
    async function loadStatus(focusBack = false) {
      const my = ++loadSeq;
      try {
        const r = await request("GET", "/api/teacher/lessons/" + lessonId + "/polls");
        if (my !== loadSeq || !statusList.isConnected) return;
        const all = Array.isArray(r.polls) ? r.polls : [];
        if (!all.length) { statusList.replaceChildren(h("p", { class: "muted small", text: "Noch keine Antworten in dieser Sitzung." })); return; }
        statusList.replaceChildren(...all.map((x) => {
          const mine = pollFileOf(x.k) === p.id;
          const reset = h("button", { class: "btn small ghost danger", type: "button", "aria-label": "Ergebnis löschen und Umfrage neu öffnen – Folie " + x.n }, "Ergebnis löschen und Umfrage neu öffnen");
          reset.addEventListener("click", async () => {
            if (!(await confirmDialog("Ergebnis löschen", POLL_RESET_TEXT, "Löschen", true))) return;
            await busy(reset, async () => {
              try { await request("POST", "/api/teacher/lessons/" + lessonId + "/polls/reset", { body: { k: x.k } }); stateLine(statusState, "Gelöscht – die Umfrage auf Folie " + x.n + " ist wieder offen.", "ok"); await loadStatus(true); }
              catch (e) { stateLine(statusState, "Nicht gelöscht: " + e.message, "err"); }
            }, "Löscht …");
          });
          return h("div", { class: "pollstatus" },
            h("p", { class: "ps-head" }, h("strong", { text: "Folie " + x.n + (mine ? "" : " (frühere Präsentation)") + ": " }), x.q),
            h("p", { class: "small muted", text: votesText(x.total) + " · " + (x.open ? (Number.isFinite(x.left) ? "läuft noch " + fmtLeft(x.left) : "läuft") : "beendet – die Schüler:innen sehen das Ergebnis") }),
            pollBars(x.options, x.counts), h("div", { class: "row" }, reset));
        }));
        if (focusBack && (!document.activeElement || document.activeElement === document.body)) reload.focus({ preventScroll: true });
      } catch (e) { if (my === loadSeq) statusList.replaceChildren(h("p", { class: "small err", text: "Der Stand der Umfragen konnte nicht geladen werden: " + e.message })); }
    }
    reload.addEventListener("click", () => busy(reload, () => loadStatus(), "Lädt …"));
    body.replaceChildren(...nn(h("p", { class: "hint", text: POLLS_HINT }), rows, h("div", { class: "row" }, addBtn), err, h("div", { class: "row" }, saveBtn, fromPdf, state),
      h("h3", { class: "ps-title", text: "Stand der Umfragen in dieser Sitzung" }), statusList, h("div", { class: "row" }, reload, statusState)));
    statusList.replaceChildren(h("p", { class: "muted small", text: "Lade den Stand …" }));
    loadStatus();
  }
  paintSum();
  if (box.open) paint();
  box.addEventListener("toggle", () => { ui.open = box.open; if (box.open && !body.contains(document.activeElement)) paint(); });
  return box;
}
