// cards.js – Bildkarten der Grundschule (Wunsch der Lehrkraft vom 12.11.2026): Betrachter zum Durchklicken (Lehrkraft und Eltern), die Karte
// „Bildkarten“ der Grundschul-Sitzung (Erzähltexte prüfen und ändern, Freigabe für Eltern, Hochladen einer PDF – eine Seite = eine Karte) und
// das Erstellen der Kartenbilder im Browser der Lehrkraft (PDF.js über presenter.js, opt.cards) – nacheinander, einmal je Stand der PDF.
import { h, clear, nn, api, apiUrl, upload, toast, errToast, confirmDialog, icon, stateLine } from "./ui.js";
import { onLeave } from "./app.js";
import { T, tapi } from "./teacher.js";
import { designState, printQueue } from "./designrender.js";
import { cardViewer } from "./cardview.js";

export { cardViewer };   // Betrachter liegt in cardview.js (auch für die Elternansicht, ohne die Module der Lehrkraft)

const CARD_TEXT_LABEL = (n) => "Erzähltext zu Karte " + n + " (für Eltern sichtbar – gekürzt zum Nacherzählen)";
const PUBLISHER_HINT = "Bildkarten von Verlagen dürfen meist nicht online weitergegeben werden – zeigen Sie Eltern nur selbst erstellte oder ausdrücklich freigegebene Karten. Claude gestaltet Bildkarten beim Planen auch selbst.";
const SHARE_LABEL = "Eltern dürfen diese Bildkarten sehen";
const MAX_CARDS = 40;   // wie der Server (worker/files.js)

/* ---------- Kartenbilder erstellen (Browser der Lehrkraft, PDF.js) – eine Warteschlange für den ganzen Tab ---------- */
const running = new Map();   // "id:version" → Promise (auch bereits erledigte: einmal je Stand)
const failed = new Map();    // "id:version" → Meldung
const listeners = new Set();
let chain = Promise.resolve();
const emit = (ev) => { for (const fn of listeners) { try { fn(ev); } catch {} } };
/* Fortschritt beobachten: fn({id, state: "wait"|"run"|"done"|"fail", i, n, file, error}) → Abmelden */
export function onCardsProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const cardsFailed = (id, version) => failed.get(id + ":" + version) || null;

/* Bilder einer PDF (Blob) für den Kartensatz fileId erzeugen und hochladen; version = Stand der PDF (cards.version) */
export async function rasterizeCards(blob, fileId, version, onProgress) {
  const { rasterizeAndUpload } = await import("./presenter.js");
  return rasterizeAndUpload(blob, fileId, T.token, onProgress, { cards: true, version });
}
async function pdfBlob(fileId) {
  const r = await tapi("POST", "/api/teacher/files/" + fileId + "/link", { body: {} });
  const res = await fetch(apiUrl(r.url), { credentials: "omit" });
  if (!res.ok) throw new Error("Die PDF der Bildkarten ließ sich nicht laden (Fehler " + res.status + ").");
  return res.blob();
}
/* einen Kartensatz (id, version) einreihen; again = nach einem Fehlschlag neu versuchen */
export function queueCards(item, { again = false, blob = null } = {}) {
  const key = item.id + ":" + item.version;
  if (again) { failed.delete(key); running.delete(key); }
  if (running.has(key)) return running.get(key);
  emit({ id: item.id, state: "wait" });
  const p = chain.then(async () => {
    let version = item.version;
    for (let tries = 0; tries < 2; tries++) {
      try {
        emit({ id: item.id, state: "run", i: 0, n: 0 });
        const out = await rasterizeCards(blob && tries === 0 ? blob : await pdfBlob(item.id), item.id, version, (i, n) => emit({ id: item.id, state: "run", i, n }));
        emit({ id: item.id, state: "done", file: out.file });
        return out.file;
      } catch (e) {
        // inzwischen neu gestaltet: einmal mit dem neuen Stand
        if (e && e.code === "stale" && tries === 0) {
          try { const c = await tapi("GET", "/api/teacher/files/" + item.id + "/cards"); if (c.version !== version && (c.status === "ready" || c.status === "processing")) { version = c.version; continue; } } catch {}
        }
        const msg = (e && e.message) || "Die Bilder ließen sich nicht erstellen.";
        failed.set(key, msg);
        emit({ id: item.id, state: "fail", error: msg });
        return null;
      }
    }
    return null;
  });
  chain = p.catch(() => {});
  running.set(key, p);
  return p;
}
/* Startseiten: Kartensätze ohne aktuelle Bilder nacheinander nachholen (still – Fortschritt nur auf der Sitzungsseite) */
export function rasterizePending(list) {
  for (const it of list || []) if (it && it.id && it.version != null && !failed.has(it.id + ":" + it.version)) queueCards(it);
}

/* ---------- Karte „Bildkarten“ der Grundschul-Sitzung ----------
   st.files = Dateien der Sitzung (Bildkarten mit f.cards); insertRef(id) fügt den Verweis in den Verlaufsplan ein; onChange() nach jeder Änderung
   (z. B. für „Eltern sehen von dieser Sitzung …“). → {el, refresh(files)} */
export function cardsCard({ lessonId, st, insertRef, onChange = () => {} }) {
  const el = h("section", { class: "card gs-cards", id: "gs-cards", "aria-labelledby": "gs-cards-h" });
  const sets = h("div", { class: "stack" });
  const data = new Map();   // Datei-ID → Antwort von GET …/cards
  const prog = new Map();   // Datei-ID → {state, i, n, error}
  const editing = new Map(); // Datei-ID → {timer, chain}
  const rq = printQueue();
  const isSet = (f) => f && f.cards != null && f.area !== "archive";
  const setsOf = () => st.files.filter(isSet);
  const fileOfSet = (id) => st.files.find((f) => f.id === id);

  /* Hochladen */
  const share = h("input", { type: "checkbox", id: "gs-cards-share" });
  const pick = h("input", { type: "file", accept: "application/pdf,.pdf", id: "gs-cards-file", class: "sr-only", tabindex: "-1" });
  const pickBtn = h("button", { class: "btn", type: "button" }, icon("up"), "Bildkarten-PDF auswählen (eine Seite = eine Karte)");
  const upState = h("p", { class: "small", role: "status" });
  let upId = null;   // zuletzt hochgeladener Satz: seine Statuszeile meldet, wenn die Bilder fertig sind
  pickBtn.addEventListener("click", () => pick.click());
  pick.addEventListener("change", async () => {
    const file = pick.files && pick.files[0]; pick.value = "";
    if (!file) return;
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { stateLine(upState, "Bitte eine PDF-Datei wählen (eine Seite = eine Karte).", "err"); return; }
    pickBtn.disabled = true;
    try {
      // vorher prüfen: lesbar und höchstens 40 Seiten (sonst ließen sich die Bilder nie erstellen – und jede Startseite versuchte es erneut)
      stateLine(upState, "„" + file.name + "“ wird geprüft …");
      let pages = 0;
      try { pages = await (await import("./presenter.js")).pdfPageCount(file); }
      catch { stateLine(upState, "Diese PDF-Datei lässt sich nicht lesen. Bitte eine andere PDF-Datei wählen (eine Seite = eine Karte).", "err"); return; }
      if (pages > MAX_CARDS) { stateLine(upState, "Die PDF hat " + pages + " Seiten – höchstens " + MAX_CARDS + " Bildkarten je PDF (eine Seite = eine Karte).", "err"); return; }
      stateLine(upState, "„" + file.name + "“ wird hochgeladen …");
      const r = await upload("/api/teacher/lessons/" + lessonId + "/cards?name=" + encodeURIComponent(file.name) + "&share=" + (share.checked ? "1" : "0"), file, T.token,
        (p) => stateLine(upState, "„" + file.name + "“ wird hochgeladen … " + Math.round(p * 100) + " %"), "application/pdf");
      st.files.push(r.file);
      load(r.file.id);   // Stand (rev) gleich holen: Erzähltexte und Freigabe lassen sich schon speichern, während die Bilder entstehen
      upId = r.file.id;
      stateLine(upState, "Hochgeladen – die Bilder der Karten werden erstellt …");
      paint(); onChange();
      queueCards({ id: r.file.id, version: r.file.cards.version }, { blob: file });
    } catch (e) { stateLine(upState, e.message, "err"); }
    finally { pickBtn.disabled = false; }
  });

  /* Daten eines Satzes laden (Bilder, Texte) */
  async function load(id) {
    try { const r = await tapi("GET", "/api/teacher/files/" + id + "/cards"); data.set(id, r); return r; } catch (e) { data.set(id, { error: e.message }); return null; }
  }
  // offene Erzähltexte sofort speichern – aus dem Kasten, der gerade zu sehen ist (nach einem Neuaufbau trägt er die getippten Texte weiter)
  async function saveTexts(id, box0) {
    const ed = editing.get(id); if (!ed) return;
    clearTimeout(ed.timer); ed.timer = null;
    ed.chain = ed.chain.then(async () => {
      let box = el.querySelector("#cs-" + id) || box0;
      // frisch hochgeladen (noch nie geladen) oder das Laden scheiterte: erst den Stand (rev) holen – sonst bliebe der Text ungespeichert
      let d = data.get(id);
      if (!d || d.error) d = await load(id);
      box = el.querySelector("#cs-" + id) || box;
      const sline = box.querySelector(".cs-save");
      if (!d) { stateLine(sline, "Nicht gespeichert: " + ((data.get(id) || {}).error || "Bitte später noch einmal versuchen."), "err"); return; }
      const texts = [...box.querySelectorAll("textarea.cs-text")].map((t) => t.value);
      stateLine(sline, "Speichert …");
      try {
        const r = await tapi("PUT", "/api/teacher/files/" + id + "/cards", { body: { texts, rev: d.rev } });
        Object.assign(d, r.cards); syncFile(id, r.cards); ed.dirty = false;
        stateLine(sline, "Gespeichert", "ok"); paintWarn(id, box); onChange();
      } catch (e) {
        if (e.status === 409) { toast("Die Erzähltexte wurden inzwischen geändert (z. B. von Claude) – neu geladen.", "err", 7000); ed.dirty = false; await load(id); paintSet(id); return; }
        stateLine(sline, "Nicht gespeichert: " + e.message, "err");
      }
    });
    return ed.chain;
  }
  const syncFile = (id, c) => { const f = fileOfSet(id); if (f && f.cards) Object.assign(f.cards, { texts: c.texts, share: c.share, rev: c.rev }); };
  const countOf = (f, d) => (d && d.current ? d.pages : f.cards.current ? f.cards.pages : f.status === "ready" && f.pages ? f.pages : 0);
  function warnings(f, d) {
    const n = countOf(f, d), texts = (d && !d.error ? d.texts : f.cards.texts) || [], out = [];
    if (n && texts.length && texts.length !== n) out.push("Die PDF hat " + n + (n === 1 ? " Seite" : " Seiten") + ", es gibt " + texts.length + " Erzähltext" + (texts.length === 1 ? "" : "e") + ".");
    for (let i = 0; i < n; i++) if (!String(texts[i] || "").trim()) out.push("Zu Karte " + (i + 1) + " fehlt der Erzähltext.");
    return out;
  }
  function paintWarn(id, box) {
    const f = fileOfSet(id), w = box.querySelector(".cs-warn");
    if (!f || !w) return;
    const list = warnings(f, data.get(id));
    clear(w).append(...list.map((t) => h("p", { class: "small warnc", text: t })));
  }
  // gestaltete Bildkarten: Druck fehlgeschlagen bzw. Tageskontingent des Druckers erschöpft (dann gibt es „Erneut drucken“)
  const printFail = (f, des) => (des && des.error ? des.text : des && des.need && rq.failed(f) ? "Druck fehlgeschlagen: " + rq.failed(f) : des && des.need && rq.quota ? "Noch nicht gedruckt: " + rq.quota : null);
  function stateText(f, d) {
    const p = prog.get(f.id), des = designState(f), pf = printFail(f, des);
    if (pf) return pf;
    if (des && des.need && !des.ok) return "PDF wird gedruckt …";
    if (p && p.state === "run") return "Bilder werden erstellt" + (p.n ? " (" + p.i + "/" + p.n + ")" : "") + " …";
    if (p && p.state === "wait") return "Bilder werden gleich erstellt …";
    const fail = (p && p.state === "fail" && p.error) || cardsFailed(f.id, f.cards.version);
    if (fail) return "Die Bilder ließen sich nicht erstellen: " + fail;
    const n = countOf(f, d);
    if (d && d.current) return n + (n === 1 ? " Karte" : " Karten") + " · Bilder bereit";
    return (n ? n + (n === 1 ? " Karte" : " Karten") + " · " : "") + "Bilder werden erstellt …";
  }

  function setBox(f) {
    const d = data.get(f.id), n = Math.max(countOf(f, d), (d && !d.error ? d.texts : f.cards.texts).length, 1);
    const texts = (d && !d.error ? d.texts : f.cards.texts) || [];
    const box = h("article", { class: "cardset", id: "cs-" + f.id, "aria-labelledby": "cs-h-" + f.id });
    if (!editing.has(f.id)) editing.set(f.id, { timer: null, chain: Promise.resolve(), dirty: false });
    const ed = editing.get(f.id);
    const p = prog.get(f.id), failMsg = (p && p.state === "fail") || cardsFailed(f.id, f.cards.version);
    const grid = h("ol", { class: "cs-grid" });
    for (let k = 1; k <= n; k++) {
      const tid = "cs-t-" + f.id + "-" + k;
      const thumb = d && d.current && k <= d.pages
        ? h("img", { class: "cs-thumb", src: apiUrl(d.img.base + k + d.img.q), alt: "Bildkarte " + k + " von " + d.pages, loading: "lazy", ...(d.w && d.h ? { width: String(d.w), height: String(d.h) } : {}) })
        : h("div", { class: "cs-thumb cs-ph", "aria-hidden": "true", text: "Karte " + k });
      const ta = h("textarea", { id: tid, class: "cs-text", rows: "4", maxlength: "1200", value: texts[k - 1] || "" });
      ta.addEventListener("input", () => { ed.dirty = true; stateLine(box.querySelector(".cs-save"), "…"); clearTimeout(ed.timer); ed.timer = setTimeout(() => saveTexts(f.id, box), 900); });
      ta.addEventListener("blur", () => { if (ed.dirty) saveTexts(f.id, box); });
      grid.append(h("li", { class: "cs-item" }, thumb, h("label", { for: tid, class: "small" }, CARD_TEXT_LABEL(k)), ta));
    }
    const shareBox = h("input", { type: "checkbox", id: "cs-share-" + f.id, checked: (d && !d.error ? d.share : f.cards.share) ? true : null });
    shareBox.addEventListener("change", async () => {
      const dd = data.get(f.id); if (!dd || dd.error) { shareBox.checked = !shareBox.checked; return; }
      await saveTexts(f.id, box);
      try {
        const r = await tapi("PUT", "/api/teacher/files/" + f.id + "/cards", { body: { share: shareBox.checked, rev: dd.rev } });
        Object.assign(dd, r.cards); syncFile(f.id, r.cards); onChange();
        toast(r.cards.share ? "Eltern sehen diese Bildkarten nach der Stunde." : "Eltern sehen diese Bildkarten nicht.", "ok");
      } catch (e) {
        if (e.status === 409) { toast("Die Erzähltexte wurden inzwischen geändert (z. B. von Claude) – neu geladen.", "err", 7000); await load(f.id); paintSet(f.id); return; }
        shareBox.checked = !shareBox.checked; errToast(e);
      }
    });
    const acts = h("div", { class: "row cs-acts" },
      h("a", { class: "btn small", id: "cs-pdf-" + f.id, href: "#/lk/datei/" + f.id, target: "_blank", rel: "noopener" }, "Als PDF ansehen", h("span", { class: "sr-only", text: " (öffnet in neuem Tab)" })),
      insertRef ? h("button", { class: "btn small", id: "cs-ins-" + f.id, type: "button", onclick: () => insertRef(f.id) }, icon("plus"), "In den Verlaufsplan einfügen") : null,
      failMsg ? h("button", { class: "btn small", id: "cs-retry-" + f.id, type: "button", onclick: () => { prog.delete(f.id); queueCards({ id: f.id, version: f.cards.version }, { again: true }); paintSet(f.id); } }, "Bilder erneut erstellen") : null,
      printFail(f, designState(f)) ? h("button", { class: "btn small", id: "cs-reprint-" + f.id, type: "button", onclick: () => { if (f.design) f.design = { ...f.design, error: null }; rq.again(f); paintSet(f.id); } }, "Erneut drucken") : null,
      h("button", { class: "btn small danger", id: "cs-del-" + f.id, type: "button", onclick: async () => {
        if (!(await confirmDialog("Bildkarten löschen", "„" + f.name + "“ mit allen Kartenbildern und Erzähltexten endgültig löschen? Ein Verweis im Verlaufsplan zeigt danach „PDF nicht gefunden“.", "Endgültig löschen", true))) return;
        try { await tapi("DELETE", "/api/teacher/files/" + f.id); st.files = st.files.filter((x) => x.id !== f.id); data.delete(f.id); editing.delete(f.id); paint(); onChange(); toast("Bildkarten gelöscht.", "ok"); } catch (e) { errToast(e); }
      } }, "Löschen"));
    // Vorschau mit dem Betrachter der Elternansicht (beim Öffnen jeweils mit den aktuellen Texten)
    let preview = null;
    if (d && d.current) {
      preview = h("details", { class: "cs-preview" }, h("summary", null, "So klicken sich Eltern durch die Bildkarten"));
      preview.addEventListener("toggle", () => {
        if (!preview.open) return;
        const dd = data.get(f.id); if (!dd || dd.error || !dd.current) return;
        const texts = [...box.querySelectorAll("textarea.cs-text")].map((t) => t.value);
        [...preview.querySelectorAll(".cardview")].forEach((x) => x.remove());
        preview.append(cardViewer({ images: dd.img, pages: dd.pages, w: dd.w, h: dd.h, texts, reload: async () => { const r = await load(f.id); return r ? { images: r.img } : null; } }));
      });
    }
    box.append(h("div", { class: "section-title" }, h("h3", { id: "cs-h-" + f.id, text: f.name }), h("span", { class: "save-state cs-save" })),
      h("p", { class: "small cs-state", role: "status", text: stateText(f, d) }), h("div", { class: "cs-warn" }), grid, ...(preview ? [preview] : []),
      h("label", { class: "checkrow" }, shareBox, h("span", { text: SHARE_LABEL })), acts);
    paintWarn(f.id, box);
    return box;
  }
  // offene Eingaben speichern, dann neu aufbauen (nie verwerfen); reloadSet lädt dazwischen den Stand des Servers neu
  const saveOpen = (id) => { const ed = editing.get(id), box = el.querySelector("#cs-" + id); return ed && (ed.dirty || ed.timer) && box ? saveTexts(id, box) : Promise.resolve(); };
  const reloadSet = (id) => saveOpen(id).then(() => load(id)).then(() => paintSet(id));
  const repaintSet = (id) => saveOpen(id).then(() => paintSet(id));
  /* Neuaufbau, ohne den Fokus zu verlieren: dasselbe Element (über die id; bei einem Erzähltext samt Schreibmarke), sonst die Überschrift des
     Satzes, sonst die der Karte „Bildkarten“ – nur, wenn der Fokus vorher in scope lag und inzwischen nicht woanders ist */
  function keepFocus(scope, rebuild) {
    const a = document.activeElement, inside = !!a && a !== scope && scope.contains(a);
    const had = inside ? a.id : "", setEl = inside && a.closest ? a.closest(".cardset") : null, setId = setEl ? setEl.id : "";
    const sel = inside && a.tagName === "TEXTAREA" ? [a.selectionStart, a.selectionEnd] : null;
    rebuild();
    if (!inside) return;
    const now = document.activeElement;
    if (now && now !== document.body && now.isConnected) return;
    const x = (had && el.querySelector("#" + CSS.escape(had))) || (setId && el.querySelector("#" + CSS.escape(setId) + " h3")) || el.querySelector("#gs-cards-h");
    if (!x) return;
    if (!/^(A|BUTTON|INPUT|TEXTAREA|SELECT)$/.test(x.tagName) && !x.hasAttribute("tabindex")) x.setAttribute("tabindex", "-1");
    x.focus({ preventScroll: true });
    if (sel && x.tagName === "TEXTAREA" && x.id === had) { try { x.setSelectionRange(sel[0], sel[1]); } catch {} }
  }
  // noch nicht gespeicherte Erzähltexte (der Zeitgeber läuft noch) über einen Neuaufbau retten – der Zeitgeber speichert sie danach
  const typed = (scope) => {
    const m = new Map();
    for (const t of scope.querySelectorAll("textarea.cs-text")) { const b = t.closest(".cardset"), ed = b && editing.get(b.id.slice(3)); if (ed && (ed.dirty || ed.timer)) m.set(t.id, t.value); }
    return m;
  };
  const retype = (m) => { for (const [tid, v] of m) { const t = el.querySelector("#" + CSS.escape(tid)); if (t) t.value = v; } };
  function paintSet(id) {
    const old = el.querySelector("#cs-" + id), f = fileOfSet(id);
    if (!old || !f) { paint(); return; }
    const keep = typed(old);
    keepFocus(old, () => { old.replaceWith(setBox(f)); retype(keep); });
  }
  function paint() {
    const list = setsOf(), keep = typed(sets);
    keepFocus(sets, () => {
      clear(sets).append(...(list.length ? list.map(setBox) : [h("p", { class: "muted small", text: "Noch keine Bildkarten. Claude gestaltet sie beim Planen („Stunde mit Claude planen“), oder Sie laden eine PDF hoch." })]));
      retype(keep);
    });
  }
  // ein Satz braucht neue Bilder? (gedruckt bzw. hochgeladen, Bilder fehlen oder passen nicht mehr)
  function ensure(f) {
    const des = designState(f);
    if (des && des.need) { rq.add(f); return; }
    if (!f.cards.current && (f.status === "ready" || (!f.design && f.status === "processing"))) queueCards({ id: f.id, version: f.cards.version });
  }
  const unsub = onCardsProgress((ev) => {
    const f = fileOfSet(ev.id); if (!f) return;
    prog.set(ev.id, ev);
    if (ev.id === upId && (ev.state === "done" || ev.state === "fail")) { upId = null; stateLine(upState, ev.state === "done" ? "Hochgeladen – die Bilder der Karten sind erstellt. Bitte zu jeder Karte den Erzähltext eintragen." : "Hochgeladen – die Bilder ließen sich nicht erstellen.", ev.state === "done" ? "ok" : "err"); }
    if (ev.state === "done" && ev.file) {
      Object.assign(f, ev.file); prog.delete(ev.id);
      reloadSet(ev.id).then(() => onChange());
      return;
    }
    const box = el.querySelector("#cs-" + ev.id), s = box && box.querySelector(".cs-state");
    if (ev.state === "fail") { repaintSet(ev.id); return; }
    if (s) { const t = stateText(f, data.get(ev.id)); if (s.textContent !== t) s.textContent = t; }
  });
  // dieselbe Druck-Warteschlange druckt auch die Arbeitsblätter der Sitzung: nur Bildkarten betreffen diese Karte
  const unq = rq.on({ done: (nf) => { const f = fileOfSet(nf.id); if (!isSet(f)) return; Object.assign(f, nf); reloadSet(nf.id).then(() => { ensure(f); onChange(); }); },
    fail: (f0, e, quota) => { if (quota) { for (const f of setsOf()) repaintSet(f.id); } else if (isSet(fileOfSet(f0.id))) repaintSet(f0.id); } });
  onLeave(() => {
    unsub(); unq();
    for (const [id, ed] of editing) if (ed.timer || ed.dirty) { const box = el.querySelector("#cs-" + id); if (box) saveTexts(id, box); }
  });

  el.append(h("div", { class: "section-title" }, h("h2", { id: "gs-cards-h", text: "Bildkarten (Geschichte für die Elternansicht)" })),
    h("p", { class: "small", text: "Erzählen Sie eine Geschichte mit Bildkarten, klicken sich Eltern nach der Stunde in der Elternansicht der Reihe nach durch die Karten; darunter steht jeweils der gekürzte Erzähltext zum Nacherzählen mit den Kindern." }),
    sets,
    h("div", { class: "cs-upload" }, h("h3", { text: "Bildkarten hochladen" }),
      h("p", { class: "notice gelb small", text: PUBLISHER_HINT }),
      h("div", { class: "row" }, pickBtn, pick), h("label", { class: "checkrow" }, share, h("span", { text: SHARE_LABEL })), upState));
  paint();
  Promise.all(setsOf().map((f) => load(f.id))).then(() => { paint(); for (const f of setsOf()) ensure(f); });
  const keyOf = (fs) => fs.filter(isSet).map((f) => f.id + ":" + f.status + ":" + f.cards.rev + ":" + f.cards.version + ":" + f.cards.current + ":" + f.cards.share + ":" + f.name).join("|");
  return {
    el,
    keyOf,
    // neue Dateiliste (Zurückkehren auf die Seite): nur geänderte Sätze neu laden, nie über ein Feld, das gerade bearbeitet wird
    refresh(oldFiles) {
      const before = new Map(oldFiles.filter(isSet).map((f) => [f.id, keyOf([f])]));
      const ids = setsOf().map((f) => f.id);
      if (ids.length !== before.size || ids.some((id) => !before.has(id))) { Promise.all(setsOf().map((f) => (data.has(f.id) && before.get(f.id) === keyOf([f]) ? null : load(f.id)))).then(() => { paint(); for (const f of setsOf()) ensure(f); }); return; }
      for (const f of setsOf()) {
        if (before.get(f.id) === keyOf([f])) continue;
        const ed = editing.get(f.id), box = el.querySelector("#cs-" + f.id);
        if ((ed && (ed.dirty || ed.timer)) || (box && box.contains(document.activeElement))) continue;
        load(f.id).then(() => { paintSet(f.id); ensure(f); });
      }
    },
  };
}
