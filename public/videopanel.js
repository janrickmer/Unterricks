// videopanel.js – „Videofolien“ in der Präsentationskarte der Sitzungsseite (Nachtrag 38): zeigt, auf welchen Folien Unterricks im Unterricht ein YouTube-Video
// eingebettet abspielt, und lässt die Lehrkraft sie prüfen, ändern oder selbst festlegen (Rückfall für Präsentationen ohne die unsichtbare Zeile
// „Unterricks-Video: …“, z. B. eigene PowerPoint-Exporte). Gespeichert an der Präsentation (hand, gilt vor der PDF; [] = bewusst keine).
// Baut sich nur beim Aufklappen neu (nie unter dem Fokus); Speichern ändert nur Status und Übersicht.
import { h, busy, stateLine, nn } from "./ui.js";
import { parseYouTube } from "./selbstlern.js";
import { videoSlidesOf, parseClock, fmtClock, videoClipText, videoName, VIDEO_WATCH, VIDEO_LIMITS } from "./videoslides.js";

export const VIDEOS_HINT = "Auf einer Videofolie spielt Unterricks im Unterricht das YouTube-Video eingebettet ab – am Beamer bzw. in Ihrer Präsentationsansicht; " +
  "„Weiter“ startet es, ein weiteres „Weiter“ geht zur nächsten Folie. Die Schüler:innen sehen live nur die Folie und nach der Stunde im Folienfenster einen Link zum Video. " +
  "Claude kennzeichnet Videofolien laut Präsentations-Prompt unsichtbar in der PDF; hier prüfen Sie sie oder legen sie selbst fest.";
export const videosSummary = (p) => {
  const list = videoSlidesOf(p), hand = !!(p && p.videos && Array.isArray(p.videos.hand));
  if (!list.length) return hand ? "keine (von Ihnen festgelegt)" : "keine";
  return (hand ? "von Ihnen festgelegt" : "aus der PDF") + ": " + (list.length === 1 ? "Folie " : "Folien ") + list.map((v) => v.n).join(", ");
};
/* eine Zeile des Formulars lesen → {v} | {error} (k = laufende Nummer für die Meldung) */
export function readVideoRow({ slide, link, start, end, title }, k) {
  const pre = "Video " + k + ": ";
  const n = Number(slide);
  if (!Number.isInteger(n) || n < 1) return { error: pre + "Bitte eine Folie wählen.", field: "sel" };
  const r = parseYouTube(link);
  if (r.error) return { error: pre + r.error, field: "link" };
  const s0 = String(start || "").trim(), e0 = String(end || "").trim();
  const s = s0 ? parseClock(s0) : r.start || 0, e = e0 ? parseClock(e0) : null;
  if (s === null) return { error: pre + "Die Startzeit verstehe ich nicht – bitte z. B. „1:30“ eingeben.", field: "start" };
  if (e0 && e === null) return { error: pre + "Das Ende verstehe ich nicht – bitte z. B. „4:05“ eingeben.", field: "end" };
  if (e !== null && e <= s) return { error: pre + "Das Ende muss hinter dem Start liegen.", field: "end" };
  const t = String(title || "").replace(/\s+/g, " ").trim().slice(0, VIDEO_LIMITS.title);
  return { v: { n, id: r.id, ...(s ? { start: s } : {}), ...(e !== null ? { end: e } : {}), ...(t ? { title: t } : {}) } };
}

/* p = Präsentation (fileOut), request(method, path, opt) = tapi, onSaved(file) nach dem Speichern, ui = {open} (bleibt über Neuzeichnen) */
export function videosPanel({ p, request, onSaved, ui = { open: false } }) {
  const sum = h("summary"), body = h("div", { class: "stack videobody" });
  const box = h("details", { class: "box videobox", id: "videos" }, sum, body);
  box.open = ui.open;
  const paintSum = () => { sum.replaceChildren(h("span", null, "Videofolien", h("span", { class: "muted small", text: " – " + videosSummary(p) }))); };
  let seq = 0;
  function paint() {
    const list = videoSlidesOf(p), rows = h("div", { class: "videorows" });
    const err = h("p", { class: "small err hidden", id: "video-err", role: "alert" }), state = h("span", { class: "save-state", role: "status" });
    const overview = h("p", { class: "small", id: "video-sum" });
    const paintOverview = (l) => { overview.textContent = l.length ? l.map((v) => "Folie " + v.n + ": " + videoName(v) + (videoClipText(v) ? " (" + videoClipText(v) + ")" : "")).join(" · ") : "Keine Videofolien."; };
    paintOverview(list);
    const dirty = () => { err.classList.add("hidden"); if (state.textContent !== "Nicht gespeichert") stateLine(state, "Nicht gespeichert"); };
    const addRow = (v) => {
      const k = ++seq, id = (x) => "vid-" + x + "-" + k;
      const sel = h("select", { id: id("n") }, h("option", { value: "" }, "Folie wählen"),
        Array.from({ length: p.pages }, (_, i) => h("option", { value: String(i + 1), selected: v && v.n === i + 1 ? true : null }, "Folie " + (i + 1))));
      const link = h("input", { id: id("url"), type: "text", inputmode: "url", autocapitalize: "off", autocomplete: "off", spellcheck: "false", placeholder: "https://www.youtube.com/watch?v=…", value: v ? VIDEO_WATCH + v.id : "" });
      const start = h("input", { id: id("s"), type: "text", inputmode: "numeric", autocomplete: "off", placeholder: "0:00", value: v && v.start ? fmtClock(v.start) : "", class: "vid-t" });
      const end = h("input", { id: id("e"), type: "text", inputmode: "numeric", autocomplete: "off", placeholder: "Ende", value: v && v.end ? fmtClock(v.end) : "", class: "vid-t" });
      const title = h("input", { id: id("t"), type: "text", autocomplete: "off", maxlength: String(VIDEO_LIMITS.title), value: v && v.title ? v.title : "" });
      const legend = h("legend", { text: "Video" });
      const del = h("button", { class: "btn small ghost danger", type: "button" }, "Entfernen");
      const row = h("fieldset", { class: "videorow" }, legend,
        h("div", { class: "field" }, h("label", { for: id("n") }, "Folie"), sel),
        h("div", { class: "field vid-url" }, h("label", { for: id("url") }, "YouTube-Link"), link),
        h("div", { class: "field" }, h("label", { for: id("s") }, "Start (m:ss)"), start),
        h("div", { class: "field" }, h("label", { for: id("e") }, "Ende (m:ss)"), end),
        h("div", { class: "field vid-title" }, h("label", { for: id("t") }, "Titel (freiwillig)"), title), del);
      row._read = () => ({ slide: sel.value, link: link.value, start: start.value, end: end.value, title: title.value });
      row._fields = { sel, link, start, end };
      for (const el of [sel, link, start, end, title]) el.addEventListener("input", dirty);
      sel.addEventListener("change", dirty);
      del.addEventListener("click", () => {
        const all = [...rows.children], i = all.indexOf(row);
        row.remove(); renumber(); dirty();
        const next = rows.children[i] || rows.children[i - 1];   // Fokus auf die nachgerückte bzw. vorige Zeile, sonst auf „Videofolie hinzufügen“
        (next ? next.querySelector("select") : addBtn).focus({ preventScroll: true });
      });
      rows.append(row); renumber();
      return row;
    };
    const renumber = () => [...rows.children].forEach((r, i) => { r.querySelector("legend").textContent = "Video " + (i + 1); r.querySelector(".btn.danger").setAttribute("aria-label", "Video " + (i + 1) + " entfernen"); });
    for (const v of list) addRow(v);
    const addBtn = h("button", { class: "btn small", type: "button" }, "Videofolie hinzufügen");
    addBtn.addEventListener("click", () => { const r = addRow(null); dirty(); r.querySelector("select").focus({ preventScroll: true }); });
    const read = () => {
      const out = [], seen = new Set();
      for (const [i, r] of [...rows.children].entries()) {
        const x = readVideoRow(r._read(), i + 1);
        if (x.error) return { error: x.error, row: r, field: x.field };
        if (seen.has(x.v.n)) return { error: "Video " + (i + 1) + ": Folie " + x.v.n + " hat schon ein Video – je Folie höchstens eins.", row: r, field: "sel" };
        seen.add(x.v.n); out.push(x.v);
      }
      return { list: out.sort((a, b) => a.n - b.n) };
    };
    const save = async (btn, hand) => {
      err.classList.add("hidden");
      await busy(btn, async () => {
        try {
          const r = await request("PUT", "/api/teacher/files/" + p.id + "/videos", { body: { hand } });
          Object.assign(p, r.file);
          paintSum(); paintOverview(videoSlidesOf(p));
          stateLine(state, hand ? "Gespeichert – Unterricks folgt jetzt Ihren Videofolien." : "Gespeichert – es gelten wieder die Videofolien aus der PDF.", "ok");
          fromPdf.classList.toggle("hidden", !(p.videos && Array.isArray(p.videos.hand) && p.videos.pdf));
          if (!hand) { rows.replaceChildren(); for (const v of videoSlidesOf(p)) addRow(v); }
          if (onSaved) onSaved(r.file);
        } catch (e) { stateLine(state, "Nicht gespeichert: " + e.message, "err"); }
      }, "Speichert …");
      if (!document.activeElement || document.activeElement === document.body) (btn.classList.contains("hidden") ? saveBtn : btn).focus({ preventScroll: true });
    };
    const saveBtn = h("button", { class: "btn small primary", type: "button" }, "Videofolien speichern");
    saveBtn.addEventListener("click", () => {
      const r = read();
      if (r.error) {
        err.textContent = r.error; err.classList.remove("hidden");
        if (r.row) r.row._fields[r.field || "link"].focus({ preventScroll: true });
        return;
      }
      save(saveBtn, r.list);
    });
    const fromPdf = h("button", { class: "btn small ghost" + (p.videos && Array.isArray(p.videos.hand) && p.videos.pdf ? "" : " hidden"), type: "button" }, "Videofolien aus der PDF übernehmen");
    fromPdf.addEventListener("click", () => save(fromPdf, null));
    body.replaceChildren(...nn(h("p", { class: "hint", text: VIDEOS_HINT }), rows, h("div", { class: "row" }, addBtn), overview, err, h("div", { class: "row" }, saveBtn, fromPdf, state)));
  }
  paintSum();
  if (box.open) paint();
  box.addEventListener("toggle", () => { ui.open = box.open; if (box.open && !body.contains(document.activeElement)) paint(); });
  return box;
}
