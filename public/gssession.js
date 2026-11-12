// gssession.js – Sitzungsseite der Grundschule (Lehrkraft; Wunsch der Lehrkraft vom 12.11.2026): ganz oben der Verlaufsplan (fest angezeigt,
// „Bearbeiten“, die PDF-Dateien gelb markiert an der Stelle, an der sie benutzt werden, Zwischenstopp per Dialog und Kontextmenü), darunter
// Einordnung in die Einheit, „Stunde mit Claude planen“, der Materialkasten (für die Kinder / nur für Sie) mit dem Hinweis, was Eltern sehen,
// die Druckliste, „Inhalt der Unterrichtsstunde“ und „Hausaufgabe“, ganz unten die Elternansicht (Sitzungslink, Ausprobieren, Hinweis der
// Lehrkraft). Keine Live-Präsentation, kein Schulportal-Eintrag, kein Sitzungscode, keine Feibeitsblätter, kein Planungschat.
import { h, clear, nn, toast, errToast, modal, confirmDialog, copyText, fmtTime, icon, pageHead, stateLine } from "./ui.js";
import { render, go, onLeave } from "./app.js";
import { tapi, teacherBar, markNav } from "./teacher.js";
import { fmtDay, insertStop, removeStops, hasStop, isStopLine, parsePlanMarkup, parentMaterial, parentOpensAt, pdfRef, lessonTimes, fmtClockBerlin } from "./shared.js";
import { unitContext } from "./planning.js";
import { claudeGsLessonPrompt, gsChatName } from "./gsplanning.js";
import { claudeHandoff } from "./claude.js";
import { leupoldView } from "./units.js";
import { paintPlanPreview, contextMenu } from "./portalview.js";
import { renderMarkdown } from "./markdown.js";
import { materialBox } from "./materialbox.js";
import { cardsCard } from "./cards.js";
import { reviseBox } from "./grundschule.js";

const isPdf = (f) => !!f && f.kind === "file" && f.mime === "application/pdf" && f.area !== "archive" && f.area !== "presentation";
const NOT_YET = "„Diese Unterrichtssitzung hat noch nicht stattgefunden.“";
// „Dienstag, 10.11.2026, 08:45 Uhr“ (Schulzeit Europe/Berlin)
const longWhen = (ms) => new Date(ms).toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" }) + ", " + fmtClockBerlin(ms) + " Uhr";
const SOURCE = { claude: "von Claude", lehrkraft: "von Ihnen", ki: "von der KI" };

/* Textfeld mit automatischem Speichern (PATCH key) – nie überschreiben, solange es bearbeitet wird */
function autoSave(id, L, el, key, lessonKey, stateEl, onSaved) {
  let t = null;
  const save = async () => {
    clearTimeout(t); t = null;
    try { const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { [key]: el.value } }); L()[lessonKey] = r.lesson[lessonKey]; if (lessonKey === "homework") L().nextDate = r.lesson.nextDate; stateLine(stateEl, "Gespeichert", "ok"); if (onSaved) onSaved(); }
    catch (e) { stateLine(stateEl, e.message, "err"); }
  };
  el.addEventListener("input", () => { stateLine(stateEl, "…"); clearTimeout(t); t = setTimeout(save, 900); });
  el.addEventListener("blur", () => { if (el.value !== (L()[lessonKey] || "")) save(); });
  return { dirty: () => !!t || el.value !== (L()[lessonKey] || ""), flush: () => { if (t) save(); } };
}
/* Karte „Elternansicht“ (Sitzung und Ausfall-Eintrag): Sitzungslink kopieren, Elternansicht ausprobieren, Hinweis der Lehrkraft, Link erneuern.
   Der Link wird beim Aufbau schon geholt, damit das Kopieren im Klick selbst geschieht (Safari erlaubt die Zwischenablage nur dort). */
function parentsCardDom(id, L, { status, noteState, noteTA }) {
  let linkToken = null;
  const linkUrl = (t) => location.origin + location.pathname + "#/eltern/" + t;
  tapi("GET", "/api/teacher/lessons/" + id + "/parent-link").then((r) => { if (r.token) linkToken = r.token; }).catch(() => {});
  function linkModal(url) {
    modal({ title: "Sitzungslink für Eltern", body: (el) => {
      const inp = h("input", { id: "gs-link-input", readonly: true, value: url, "aria-describedby": "gs-link-h", onfocus: (e) => e.target.select() });
      el.append(h("div", { class: "field" }, h("label", { for: "gs-link-input" }, "Sitzungslink für Eltern"), inp),
        h("p", { class: "hint", id: "gs-link-h", text: "Die Zwischenablage ließ sich nicht verwenden. Der Link ist markiert – kopieren Sie ihn mit Strg+C (Mac: ⌘+C) bzw. lange drücken und „Kopieren“." }));
      setTimeout(() => { if (!el.contains(document.activeElement)) inp.focus(); inp.select(); }, 40);
    }, actions: [{ label: "Schließen", class: "primary" }] });
  }
  async function copyLink() {
    try {
      if (!linkToken) { const r = await tapi("POST", "/api/teacher/lessons/" + id + "/parent-link", { body: {} }); linkToken = r.token; L().hasParentLink = true; }
      const url = linkUrl(linkToken);
      if (await copyText(url)) toast("Sitzungslink für Eltern kopiert.", "ok"); else linkModal(url);
    } catch (e) { errToast(e); }
  }
  const copyBtn = h("button", { class: "btn primary", type: "button", id: "gs-copy", onclick: copyLink }, icon("link"), "Sitzungslink für Eltern kopieren");
  const renewBtn = h("button", { class: "btn small danger", type: "button", id: "gs-renew", onclick: async () => {
    if (!(await confirmDialog("Link erneuern", "Neuen Link erzeugen? Der bisherige Link funktioniert danach nicht mehr.", "Neuen Link erzeugen", true))) return;
    try {
      const r = await tapi("POST", "/api/teacher/lessons/" + id + "/parent-link", { body: { renew: true } });
      linkToken = r.token; L().hasParentLink = true;
      toast("Neuer Sitzungslink erzeugt – der bisherige funktioniert nicht mehr. Kopieren Sie ihn mit „Sitzungslink für Eltern kopieren“.", "ok", 8000);
    } catch (e) { errToast(e); }
  } }, "Neuen Link erzeugen");
  return h("section", { class: "card gs-parents", id: "gs-parents", "aria-labelledby": "gs-parents-h" }, h("h2", { id: "gs-parents-h", text: "Elternansicht" }),
    ...status,
    h("div", { class: "row" }, copyBtn,
      h("a", { class: "btn", id: "gs-try", href: "#/lk/eltern/" + id, target: "_blank", rel: "noopener" }, "Elternansicht ausprobieren", h("span", { class: "sr-only", text: " (öffnet in neuem Tab)" }))),
    h("p", { class: "hint", text: "Wer den Link hat, sieht diese Sitzung und alle vorherigen Sitzungen dieses Kurses im Schuljahr." }),
    h("div", { class: "field" }, h("div", { class: "row between" }, h("label", { for: "gs-note" }, "Hinweis der Lehrkraft (optional)"), noteState), noteTA,
      h("p", { class: "hint", id: "gs-note-h", text: "Erscheint für die Eltern ganz oben in einem roten Feld. Bitte keine Namen von Kindern." })),
    h("details", { class: "gs-renew" }, h("summary", { text: "Link erneuern" }),
      h("p", { class: "small", text: "Ist der Link in falsche Hände geraten? Nach dem Erneuern funktioniert der bisherige Link nicht mehr – die Eltern brauchen dann den neuen." }), renewBtn));
}
const longDay = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("de-DE", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
const shortWhen = (x) => (x && x.date ? fmtDay(x.date).slice(0, 10) + (x.time ? " " + x.time : "") : "ohne Termin");

export async function gsSessionPage(id, d) {
  const main = h("main");
  render(teacherBar("primary"), main);
  markNav("primary");
  const st = { lesson: d.lesson, files: d.files, refFiles: d.refFiles || [], unit: d.unit, messages: d.messages || [], sheets: [], drafts: [] };
  const L = () => st.lesson;
  const course = (d.course && d.course.gs) || null, classSize = d.course ? d.course.classSize : null;
  const coursePage = "#/lk/grundschule/k/" + L().klass;
  const row = () => (st.unit && L().unitRow ? (st.unit.rows || []).find((r) => r.uid === L().unitRow) || null : null);
  const fileOf = (fid) => { const f = st.files.find((x) => x.id === fid) || st.refFiles.find((x) => x.id === fid); return isPdf(f) ? f : null; };
  const ctx = () => ({ lessonId: id, subject: L().subject, klass: L().klass, course, classSize,
    lesson: { title: L().title, topic: L().topic, durationMin: L().durationMin, date: L().date, startTime: L().startTime, ideas: L().ideas, homework: L().homework },
    materials: st.files.filter((f) => f.area !== "archive" && f.area !== "presentation").map((f) => ({ id: f.id, name: f.name, area: f.area, kind: f.kind, mime: f.mime, text: f.kind === "link" ? f.url || "" : "" })),
    unit: st.unit, row: row(), unitText: st.unit ? unitContext(st.unit, L().unitRow) : "", previousStop: d.previousStop });

  if (L().cancelled) return gsPlaceholderPage(id, d, main, course, coursePage);
  const reload = () => go("#/lk/s/" + id);

  /* ======================= Kopf ======================= */
  const heading = h("h1", { text: L().title });
  const subline = h("div", { class: "chips" });
  const paintSubline = () => {
    const r = row(), idx = r && st.unit ? (st.unit.rows || []).indexOf(r) : -1;
    clear(subline).append(...nn(idx >= 0 ? h("span", { class: "chip strong", text: "Stunde " + (idx + 1) + " von " + st.unit.rows.length }) : null,
      course ? h("span", { class: "chip", text: course.subjectName }) : null, course ? h("span", { class: "chip", text: course.grade + course.classes.join(""), title: course.gradeText }) : null,
      h("span", { class: "chip", text: L().date ? fmtDay(L().date) + (L().startTime ? ", " + L().startTime : "") : "ohne Termin" }), L().durationMin ? h("span", { class: "chip", text: L().durationMin + " Minuten" }) : null));
  };
  paintSubline();
  main.append(pageHead({ fach: "gs", title: heading, sub: subline,
    crumbs: [["#/lk/grundschule", "Grundschule"], [coursePage, course ? course.short : "Kurs"], ...(st.unit ? [["#/lk/u/" + st.unit.id, st.unit.title || "Einheit"]] : []), L().title] }));

  /* ======================= Verlaufsplan (ganz oben) ======================= */
  const plan = { version: L().portalVersion, dirty: false, timer: null, chain: Promise.resolve(), editing: false };
  const ta = h("textarea", { id: "gsplan-text", class: "portal-text", spellcheck: "true", value: L().portal || "" });
  const pv = h("div", { class: "portal-preview gsplan-view", "aria-label": "Verlaufsplan" });
  const empty = h("p", { class: "muted gsplan-empty", text: "Noch kein Verlaufsplan – Claude schreibt ihn beim Planen („Stunde mit Claude planen“), oder Sie tragen ihn mit „Bearbeiten“ ein." });
  const planState = h("span", { class: "save-state", role: "status" });
  const planBody = h("div", { class: "stack" });
  const editBtn = h("button", { class: "btn", type: "button", "aria-expanded": "false", "aria-controls": "gsplan-body" }, icon("edit"), h("span", { text: "Bearbeiten" }));
  const stopBtn = h("button", { class: "btn", type: "button" }, icon("pause"), "Zwischenstopp eintragen …");
  const unstopBtn = h("button", { class: "btn ghost hidden", type: "button" }, "Zwischenstopp entfernen");
  const refBtn = h("button", { class: "btn hidden", type: "button" }, icon("plus"), "PDF-Verweis einfügen …");
  const planInfo = () => (plan.version && L().portalUpdatedAt ? "Version " + plan.version + " · zuletzt " + (SOURCE[L().portalSource] || "gespeichert") + ", " + fmtTime(L().portalUpdatedAt) : "");
  const onPending = () => toast("Diese PDF wird gerade gedruckt – bitte gleich noch einmal.");
  function paintPlan() {
    paintPlanPreview(pv, ta.value, { fileOf, onPending });
    empty.classList.toggle("hidden", !!ta.value.trim() || plan.editing);
    pv.classList.toggle("hidden", !ta.value.trim() && !plan.editing);
    unstopBtn.classList.toggle("hidden", !hasStop(ta.value));
    paintParents(); paintSummaryHint();
  }
  function schedulePlan() { plan.dirty = true; if (planState.textContent !== "Ungespeicherte Änderungen …") stateLine(planState, "Ungespeicherte Änderungen …"); clearTimeout(plan.timer); plan.timer = setTimeout(() => flushPlan(), 1200); }
  function setPlanText(t) { ta.value = t; paintPlan(); schedulePlan(); }
  function flushPlan(force) {
    clearTimeout(plan.timer);
    plan.chain = plan.chain.then(async () => {
      if (!plan.dirty && !force) return true;
      const text = ta.value; plan.dirty = false; stateLine(planState, "Speichert …");
      try {
        const r = await tapi("PUT", "/api/teacher/lessons/" + id + "/portal", { body: force ? { text, force: true } : { text, baseVersion: plan.version } });
        plan.version = r.portal.version; Object.assign(L(), { portal: r.portal.text, portalVersion: r.portal.version, portalUpdatedAt: r.portal.updatedAt, portalSource: r.portal.source });
        stateLine(planState, "Gespeichert · " + planInfo(), "ok");
        if (ta.value !== text) schedulePlan();
        return true;
      } catch (e) {
        if (e.status === 409 && e.data && e.data.current) { await planConflict(e.data.current, text); return false; }
        plan.dirty = true; stateLine(planState, "Nicht gespeichert: " + e.message, "err"); return false;
      }
    });
    return plan.chain;
  }
  function planConflict(cur, mine) {
    return new Promise((resolve) => {
      modal({ title: "Der Verlaufsplan wurde inzwischen an anderer Stelle geändert", wide: true, onClose: () => resolve(),
        body: (el) => el.append(h("p", { text: "Der Verlaufsplan wurde " + (cur.source === "claude" ? "von Claude über den Connector" : "in einem anderen Fenster") + " geändert (Version " + cur.version + "). Welche Fassung soll gelten?" }),
          h("div", { class: "portal-wrap" }, h("div", null, h("h3", { text: "Ihre Fassung" }), h("pre", { class: "portal-preview mono", style: { whiteSpace: "pre-wrap" }, text: mine })),
            h("div", null, h("h3", { text: "Gespeicherte Fassung" }), h("pre", { class: "portal-preview mono", style: { whiteSpace: "pre-wrap" }, text: cur.text })))),
        actions: [
          { label: "Gespeicherte Fassung übernehmen", onClick: () => { ta.value = cur.text; plan.version = cur.version; plan.dirty = false; Object.assign(L(), { portal: cur.text, portalVersion: cur.version, portalUpdatedAt: cur.updatedAt, portalSource: cur.source }); paintPlan(); stateLine(planState, planInfo()); } },
          { label: "Meine Fassung speichern", class: "primary", onClick: () => { plan.dirty = true; flushPlan(true); } },
        ] });
    });
  }
  // Zwischenstopp: im Dialog (Tastatur, iPad), per Rechtsklick auf eine Zeile der Vorschau oder – am iPad – durch Antippen einer Zeile
  const stopAt = (line) => { setPlanText(insertStop(ta.value, line).text); flushPlan(); toast("Zwischenstopp eingetragen – Eltern sehen nur das Material bis dorthin.", "ok"); };
  const dropStop = () => { setPlanText(removeStops(ta.value)); flushPlan(); toast("Zwischenstopp entfernt.", "ok"); };
  const linePlain = (ln) => ln.runs.map((r) => (r.file !== undefined ? (fileOf(r.file) || { name: "PDF" }).name : r.text)).join("").trim();
  function stopDialog() {
    const lines = parsePlanMarkup(ta.value), opts = [];
    lines.forEach((ln, i) => { if (ln.type === "p" || ln.type === "li") opts.push({ i, label: (ln.type === "li" ? "• " : "") + (linePlain(ln) || "(Verweis)") }); });
    if (!opts.length) { toast("Der Verlaufsplan ist noch leer – erst danach lässt sich ein Zwischenstopp eintragen.", "err"); return; }
    const stopIdx = lines.findIndex((ln) => ln.type === "stop");
    const pre = Math.max(0, stopIdx >= 0 ? opts.findIndex((o) => o.i > stopIdx) : 0);
    let close = null;
    const apply = () => {
      const sel = list.querySelector("input:checked");
      if (!sel) return false;
      stopAt(Number(sel.value));
      return true;
    };
    const list = h("fieldset", { class: "stoplist" }, h("legend", { text: "Vor welcher Zeile soll der Zwischenstopp stehen?" }),
      opts.map((o, k) => h("label", { class: "checkrow" }, h("input", { type: "radio", name: "gs-stop", value: String(o.i), checked: k === pre ? true : null }), h("span", { text: o.label }))));
    list.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (apply() && close) close(); } });
    const m = modal({ title: "Wo haben Sie aufgehört?", wide: true, body: (el) => el.append(
      h("p", { class: "small", text: "Der Zwischenstopp steht vor der ersten Zeile, die nicht mehr geschafft wurde. Eltern sehen nur das Material bis dorthin." }), list),
      actions: [{ label: "Abbrechen" }, { label: "Zwischenstopp eintragen", class: "primary", onClick: () => (apply() ? undefined : false) }] });
    close = m.close;
    const cur = list.querySelector("input:checked"); if (cur) cur.focus();
  }
  function stopMenu(line, x, y) {
    const onStop = isStopLine(ta.value.replace(/\r\n?/g, "\n").split("\n")[line] || "");
    contextMenu(x, y, onStop ? [{ label: "Zwischenstopp entfernen", danger: true, onClick: dropStop }]
      : [{ label: [icon("pause"), "Zwischenstopp einfügen"], onClick: () => stopAt(line) }, ...(hasStop(ta.value) ? [{ label: "Zwischenstopp entfernen", danger: true, onClick: dropStop }] : [])]);
  }
  stopBtn.addEventListener("click", stopDialog);
  unstopBtn.addEventListener("click", dropStop);
  pv.addEventListener("contextmenu", (e) => { const el = e.target.closest("[data-line]"); if (!el || e.shiftKey) return; e.preventDefault(); stopMenu(Number(el.dataset.line), e.clientX, e.clientY); });
  pv.addEventListener("click", (e) => {
    if (!window.matchMedia("(pointer: coarse)").matches || e.target.closest("a, button")) return;
    const el = e.target.closest("[data-line]"); if (el) stopMenu(Number(el.dataset.line), e.clientX, e.clientY);
  });
  ta.addEventListener("input", () => { paintPlan(); schedulePlan(); });
  ta.addEventListener("blur", () => flushPlan());
  ta.addEventListener("contextmenu", (e) => {
    if (e.shiftKey) return;
    e.preventDefault();
    let off = ta.selectionStart || 0;
    try { const cp = document.caretPositionFromPoint && document.caretPositionFromPoint(e.clientX, e.clientY); if (cp && cp.offsetNode === ta) off = cp.offset; } catch {}
    stopMenu(ta.value.slice(0, off).split("\n").length - 1, e.clientX, e.clientY);
  });
  // „PDF-Verweis einfügen …“: PDFs dieser und der vorigen Sitzung an der Schreibmarke
  refBtn.addEventListener("click", () => {
    const own = st.files.filter(isPdf), prev = st.refFiles.filter((f) => f.previous && isPdf(f));
    if (!own.length && !prev.length) { toast("Diese und die vorige Sitzung haben noch keine PDF-Dateien.", "err"); return; }
    const where = { student: "für die Kinder", teacher: "nur für Sie", print: "zum Ausdrucken" };
    const [s0, e0] = [ta.selectionStart, ta.selectionEnd];
    const r = refBtn.getBoundingClientRect();
    contextMenu(r.left, r.bottom + 4, [...own.map((f) => ({ f, label: f.name + " (" + (where[f.area] || "") + ")" })), ...prev.map((f) => ({ f, label: f.name + " (vorige Sitzung)" }))].map(({ f, label }) => ({ label, onClick: () => {
      ta.focus(); ta.setRangeText(pdfRef(f.id), s0, e0, "end"); paintPlan(); schedulePlan();
    } })));
  });
  function setEditing(on) {
    plan.editing = on;
    editBtn.setAttribute("aria-expanded", on ? "true" : "false");
    editBtn.lastChild.textContent = on ? "Fertig" : "Bearbeiten";
    refBtn.classList.toggle("hidden", !on);
    clear(planBody).append(on
      ? h("div", { class: "portal-wrap" }, h("div", null, h("label", { for: "gsplan-text" }, "Verlaufsplan (wird automatisch gespeichert)"), ta),
        h("div", null, h("div", { class: "lp-cap", text: "Vorschau" }), pv))
      : h("div", null, empty, pv));
    paintPlan();
    if (!on) flushPlan();
  }
  editBtn.addEventListener("click", () => { setEditing(!plan.editing); if (plan.editing) ta.focus(); });
  const planCard = h("section", { class: "card gsplan", id: "gsplan", "aria-labelledby": "gsplan-h" },
    h("div", { class: "section-title" }, h("h2", { id: "gsplan-h", text: "Verlaufsplan" }), planState),
    h("div", { id: "gsplan-body" }, planBody),
    h("div", { class: "row gsplan-acts" }, editBtn, stopBtn, unstopBtn, refBtn),
    h("p", { class: "hint", text: "Gelb markiert: die PDF-Dateien an der Stelle, an der sie benutzt werden – ein Klick öffnet die PDF in einem neuen Tab. Was nach dem Zwischenstopp steht, gilt als nicht geschafft: Eltern sehen nur das Material bis dorthin." }),
    h("details", { class: "box small" }, h("summary", null, "So schreiben Sie den Verlaufsplan"), h("ul", null,
      h("li", { text: "**Text** = fett (z. B. die Phasen: **1) Ankommen im Sitzkreis (5 Min.)**); ~~Text~~ = kursiv, __Text__ = unterstrichen." }),
      h("li", { text: "Zeilen, die mit „- “ beginnen, werden Stichpunkte." }),
      h("li", { text: "[[pdf:…]] ist ein Verweis auf eine PDF-Datei – in der Ansicht steht dort ihr Name (einfügen mit „PDF-Verweis einfügen …“ beim Bearbeiten)." }),
      h("li", { text: "Zwischenstopp: „Zwischenstopp eintragen …“, Rechtsklick auf eine Zeile oder – am iPad – eine Zeile antippen." }))));
  stateLine(planState, planInfo());

  /* ======================= Stundenentwurf, Einheit, Claude ======================= */
  const draftCard = h("div");
  const paintDraft = () => {
    const ms = st.messages.filter((m) => m.role === "assistant" && m.mode === "claude"), m = ms[ms.length - 1];
    clear(draftCard).append(...nn(m ? h("details", { class: "card", id: "gs-entwurf" }, h("summary", null, h("strong", { text: "Ausgearbeiteter Stundenentwurf von Claude" }), h("span", { class: "small muted", text: " · " + fmtTime(m.createdAt) })),
      h("div", { class: "msgbody" }, renderMarkdown(m.content))) : null));
  };
  paintDraft();
  const unitCard = h("section", { class: "card unitbox", id: "gs-unit" });
  function paintUnit() {
    clear(unitCard).append(h("div", { class: "section-title" }, h("h2", { text: "Einordnung in die Einheit" }), st.unit ? h("a", { class: "btn small", href: "#/lk/u/" + st.unit.id }, "Einheit öffnen") : null));
    if (!st.unit) { unitCard.append(h("p", { class: "small muted", text: "Diese Sitzung gehört zu keiner Unterrichtseinheit." })); return; }
    const u = st.unit, r = row(), idx = r ? u.rows.indexOf(r) : -1, step = r && r.schritt != null ? (u.plan.schritte || [])[r.schritt] : null;
    unitCard.append(...nn(
      r ? h("p", { class: "small" }, h("strong", { text: "Stunde " + (idx + 1) + " von " + u.rows.length }), step ? " · Lernschritt " + (r.schritt + 1) + ": " + step.titel : "") : h("p", { class: "small warnc", text: "Die Zeile dieser Sitzung steht nicht mehr in der Einheit." }),
      r ? h("div", { class: "unit-row" }, h("div", null, h("div", { class: "lp-cap", text: "Stundenfrage" }), h("div", { text: r.stundenfrage || "(noch offen)" })),
        h("div", null, h("div", { class: "lp-cap", text: "Grober Ablauf (Inspiration)" }), r.ablauf.length ? h("ul", null, r.ablauf.map((a) => h("li", { text: a }))) : h("div", { class: "muted", text: "–" }))) : null,
      u.plan && u.plan.lernaufgabe ? h("p", { class: "small", style: { marginTop: ".5rem" } }, h("strong", { text: "Zentrale Lernaufgabe: " }), u.plan.lernaufgabe) : null,
      h("details", { class: "box" }, h("summary", null, "Leupold-Schema der Einheit"), leupoldView(u, r ? r.schritt : null))));
  }
  paintUnit();
  const planWithClaude = () => {
    flushPlan();
    claudeHandoff({ title: "Stunde mit Claude planen",
      intro: "Claude plant mit Ihnen die Stunde, gestaltet Arbeitsblätter und Bildkarten und speichert Verlaufsplan, Inhalt für die Eltern und Hausaufgabe direkt hier.",
      after: "Wenn Claude gespeichert hat, kommen Sie hierher zurück: Die Seite übernimmt Verlaufsplan, Inhalt für die Eltern, Hausaufgabe und Materialien beim Zurückkehren automatisch.",
      chatName: () => gsChatName(ctx()), prompt: () => claudeGsLessonPrompt(ctx()) });
  };
  const claudeCard = h("section", { class: "card claudeplan", id: "gs-claude" },
    h("div", { class: "section-title" }, h("h2", { text: "Stunde mit Claude planen" }), h("span", { class: "badge ok", text: "Hauptweg" })),
    h("p", { class: "small", text: "Claude plant mit Ihnen die Stunde, gestaltet Arbeitsblätter und Bildkarten und speichert Verlaufsplan, Inhalt für die Eltern und Hausaufgabe direkt hier." }),
    h("button", { class: "btn primary big", type: "button", onclick: planWithClaude }, "Stunde mit Claude planen"));

  /* ======================= Bildkarten (cards.js) ======================= */
  // „In den Verlaufsplan einfügen“: als eigener Stichpunkt ans Ende, im Bearbeiten-Modus (dort lässt er sich an die richtige Stelle schieben)
  const insertCardRef = (fid) => {
    if (!plan.editing) setEditing(true);
    const v = ta.value.replace(/\s+$/, "");
    ta.value = (v ? v + "\n" : "") + "- " + pdfRef(fid);
    paintPlan(); schedulePlan();
    planCard.scrollIntoView({ block: "start", behavior: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    ta.focus({ preventScroll: true }); ta.setSelectionRange(ta.value.length, ta.value.length);
    toast("Verweis auf die Bildkarten am Ende des Verlaufsplans eingefügt – schieben Sie ihn an die Stelle, an der Sie erzählen.", "ok", 6000);
  };
  const cardsBox = cardsCard({ lessonId: id, st, insertRef: insertCardRef, onChange: () => paintParents() });

  /* ======================= Material und Druckliste (materialbox.js) ======================= */
  const badgeEls = new Map();   // Datei-ID → Abzeichen „Eltern sehen sie“ …
  let parentsQueued = false;
  // wie der Server (worker/parents.js): Verweise nur auf PDFs früherer Sitzungen des Kurses zählen für Eltern
  // (am selben Tag: frühere Startzeit, wenn beide eine haben, sonst früher angelegt)
  const refBefore = (f) => { const l = L();
    if (!f.date || !l.date || f.date !== l.date) return !!(f.date && l.date && f.date < l.date);
    return f.lessonStart && l.startTime && f.lessonStart !== l.startTime ? f.lessonStart < l.startTime : f.lessonCreatedAt == null || f.lessonCreatedAt < l.createdAt; };
  const parentsNow = () => parentMaterial(ta.value, [...st.files.map((f) => ({ ...f, lessonId: id })), ...st.refFiles.filter(refBefore)], id);
  const BADGE = { "nach dem Zwischenstopp": "nach dem Zwischenstopp – Eltern sehen sie nicht",
    "nicht im Verlaufsplan genannt (wegen des Zwischenstopps)": "nicht im Verlaufsplan genannt – Eltern sehen sie nicht (wegen des Zwischenstopps)",
    "PDF wird noch erstellt": "PDF wird noch erstellt – Eltern sehen sie danach", "keine PDF-Datei": "keine PDF-Datei – Eltern sehen sie nicht" };
  const fillBadge = (el, fid, pm) => {
    const seen = pm.files.includes(fid) || pm.cards.includes(fid), why = (pm.hidden.find((x) => x.id === fid) || {}).reason;
    el.className = "badge gs-parents-badge " + (seen ? "ok" : "stop");
    el.textContent = seen ? "Eltern sehen sie" : BADGE[why] || "Eltern sehen sie nicht";
  };
  const fileBadge = (f) => {
    if (f.area !== "student") return null;
    const el = h("span");
    badgeEls.set(f.id, el); fillBadge(el, f.id, parentsNow());
    if (!parentsQueued) { parentsQueued = true; queueMicrotask(() => { parentsQueued = false; paintParents(); }); }
    return h("div", { class: "gs-badge" }, el);
  };
  const box = materialBox({ lessonId: id, st, L, gs: true, fileBadge, printCopies: () => classSize, exclude: (f) => f.cards != null,
    subtitle: course ? course.label : "Grundschule", groupLabel: "Grundschule - " + (course ? course.short : "Kurs"),
    labels: { student: "Material für die Kinder (Eltern sehen die PDF-Dateien nach der Stunde)", teacher: "Nur für Sie", toStudent: "Für die Kinder", toTeacher: "Nur für Sie",
      nowStudent: "Jetzt im Material für die Kinder.", nowTeacher: "Jetzt nur noch für Sie.", teacherHint: "Sehen weder Kinder noch Eltern",
      hint: "Arbeitsblätter gestaltet Claude über den Connector selbst; Unterricks druckt sie als PDF (A4) und legt sie hier ab. Textmaterial und Links erscheinen nicht in der Elternansicht – nur PDF-Dateien. " +
        "Mit „Auch ausdrucken“ steht ein Arbeitsblatt zusätzlich auf der Druckliste." } });

  /* ======================= Inhalt und Hausaufgabe (für die Eltern) ======================= */
  const autoField = (el, key, lessonKey, stateEl) => autoSave(id, L, el, key, lessonKey, stateEl, () => { if (lessonKey === "parentSummary") paintSummaryHint(); });
  const sumTA = h("textarea", { id: "gs-summary", rows: "4", maxlength: "800", value: L().parentSummary || "", "aria-describedby": "gs-summary-h gs-summary-stop" });
  const hwTA = h("textarea", { id: "gs-homework", rows: "3", maxlength: "10000", value: L().homework || "", "aria-describedby": "gs-homework-h" });
  const sumState = h("span", { class: "save-state" }), hwState = h("span", { class: "save-state" });
  const sumStop = h("p", { class: "small warnc hidden", id: "gs-summary-stop", text: "Die Stunde endet mit einem Zwischenstopp – passt der Inhalt noch?" });
  function paintSummaryHint() { sumStop.classList.toggle("hidden", !hasStop(ta.value)); }
  const sumF = autoField(sumTA, "parentSummary", "parentSummary", sumState), hwF = autoField(hwTA, "homework", "homework", hwState);
  const contentCard = h("section", { class: "card", id: "gs-content" }, h("h2", { text: "Inhalt und Hausaufgabe (für die Eltern)" }),
    h("div", { class: "field" }, h("div", { class: "row between" }, h("label", { for: "gs-summary" }, "Inhalt der Unterrichtsstunde"), sumState), sumTA,
      h("p", { class: "hint", id: "gs-summary-h", text: "2–3 Sätze: worum es ging und was die Kinder lernen sollten. Claude formuliert ihn beim Planen; Sie können ihn hier ändern. Für Eltern sichtbar – bitte keine Namen von Kindern." }), sumStop),
    h("div", { class: "field" }, h("div", { class: "row between" }, h("label", { for: "gs-homework" }, "Hausaufgabe (optional)"), hwState), hwTA,
      h("p", { class: "hint", id: "gs-homework-h", text: "Erscheint bei den Eltern nur, wenn hier etwas steht." })));

  /* ======================= Elternansicht (ganz unten) ======================= */
  const parentsWhen = h("p", { class: "small", role: "status" });
  const parentsSee = h("p", { class: "small" });
  function paintParents() {
    const l = L(), times = lessonTimes({ date: l.date, startTime: l.startTime, durationMin: l.durationMin });
    // Live-Region nur bei einer echten Änderung neu füllen (paintParents läuft bei jeder Eingabe im Verlaufsplan)
    const when = !l.date ? "Diese Sitzung hat noch keinen Termin – Eltern sehen sie erst, wenn ein Datum eingetragen ist."
      : times ? "Eltern sehen diese Sitzung ab " + longWhen(parentOpensAt({ date: l.date, startTime: l.startTime, durationMin: l.durationMin })) + " – vorher steht dort " + NOT_YET
        : "Eltern sehen diese Sitzung ab dem Folgetag (Beginn oder Dauer fehlen) – vorher steht dort " + NOT_YET;
    if (parentsWhen.textContent !== when) parentsWhen.textContent = when;
    const pm = parentsNow(), names = [...pm.cards, ...pm.files].map((fid) => "„" + ((fileOf(fid) || {}).name || "PDF") + "“");
    const see = "Eltern sehen von dieser Sitzung: " + (names.join(", ") || "noch kein Material");
    if (parentsSee.textContent !== see) parentsSee.textContent = see;
    for (const [fid, el] of badgeEls) { if (el.isConnected) fillBadge(el, fid, pm); else badgeEls.delete(fid); }
  }
  const noteTA = h("textarea", { id: "gs-note", rows: "3", maxlength: "2000", value: L().parentNote || "", "aria-describedby": "gs-note-h" });
  const noteState = h("span", { class: "save-state" });
  const noteF = autoField(noteTA, "parentNote", "parentNote", noteState);
  const parentsCard = parentsCardDom(id, L, { status: [parentsWhen, parentsSee], noteState, noteTA });

  /* ======================= Roter Kasten (Ausfälle) und Krankmeldung ======================= */
  // roter Kasten direkt vor dem Verlaufsplan – nur, wenn es ihn gibt (sonst bleibt der Verlaufsplan die erste Karte)
  let reviseEl = null;
  const paintRevise = () => {
    const next = st.unit ? reviseBox(st.unit, { unitLink: true, onChange: reload }) : null;
    if (reviseEl) reviseEl.remove();
    reviseEl = next;
    if (next && planCard.parentNode) planCard.before(next);
  };
  const sickWhy = !L().unitId || !st.unit ? "Diese Sitzung gehört zu keiner Einheit – bitte das Datum von Hand ändern." : !L().date ? "Diese Sitzung hat keinen Termin." : "";
  const sickBtn = h("button", { class: "btn danger sickbtn", type: "button", id: "gs-sick-btn", disabled: sickWhy ? true : null, "aria-describedby": sickWhy ? "gs-sick-why" : null,
    onclick: () => cancelDialog(id, reload) }, icon("alert"), "Krankmeldung: Diese Stunde fällt aus");
  const sickCard = h("section", { class: "card gs-sick", id: "gs-sick", "aria-labelledby": "gs-sick-h" }, h("h2", { id: "gs-sick-h", text: "Krankheit" }),
    h("p", { class: "small", text: "In der Grundschule entsteht kein Vertretungsmaterial: Fällt diese Stunde aus, rücken sie und alle folgenden Stunden der Einheit um einen Termin nach hinten. Eltern sehen für den ausgefallenen Termin, dass der Unterricht leider nicht stattfinden konnte." }),
    sickBtn, sickWhy ? h("p", { class: "hint", id: "gs-sick-why", text: sickWhy }) : null);

  /* ======================= Sitzungsdaten (Seitenleiste) ======================= */
  const fTitle = h("input", { value: L().title, maxlength: "200" }), fTopic = h("input", { value: L().topic, maxlength: "500" });
  const fDate = h("input", { type: "date", value: L().date || "", "aria-label": "Datum der Sitzung" }), fDur = h("input", { type: "number", min: "5", max: "600", step: "5", value: L().durationMin || "" });
  const fStart = h("input", { type: "time", step: "300", value: L().startTime || "", "aria-label": "Beginn der Sitzung (Uhrzeit)" });
  const fIdeas = h("textarea", { rows: "4", value: L().ideas, placeholder: "Ideen, Wünsche, Materialhinweise …" });
  const metaState = h("span", { class: "save-state" });
  const syncRow = (patch) => { if (st.unit) { const x = (st.unit.rows || []).find((y) => y.uid === L().unitRow); if (x) Object.assign(x, patch); } };
  let metaT = null;
  const saveMeta = async () => {
    clearTimeout(metaT); metaT = null;
    try {
      const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { title: fTitle.value, topic: fTopic.value, durationMin: fDur.value ? Number(fDur.value) : null, ideas: fIdeas.value } });
      Object.assign(st.lesson, { title: r.lesson.title, topic: r.lesson.topic, durationMin: r.lesson.durationMin, ideas: r.lesson.ideas });
      syncRow({ minutes: r.lesson.durationMin || undefined });
      heading.textContent = r.lesson.title; paintSubline(); paintParents(); stateLine(metaState, "Gespeichert", "ok");
    } catch (e) { stateLine(metaState, e.message, "err"); }
  };
  for (const el of [fTitle, fTopic, fDur, fIdeas]) { el.addEventListener("input", () => { stateLine(metaState, "…"); clearTimeout(metaT); metaT = setTimeout(saveMeta, 900); }); el.addEventListener("change", saveMeta); }
  fStart.addEventListener("change", async () => {
    const nv = fStart.value || null, ov = L().startTime || null;
    if (nv === ov) return;
    try { const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { startTime: nv } }); L().startTime = r.lesson.startTime; syncRow({ time: L().startTime }); paintSubline(); paintParents(); stateLine(metaState, "Gespeichert", "ok"); }
    catch (e) { fStart.value = ov || ""; errToast(e); }
  });
  fDate.addEventListener("change", async () => {
    const nd = fDate.value, od = L().date;
    if (!nd) { fDate.value = od || ""; toast("Bitte ein Datum wählen.", "err"); return; }
    if (nd === od) return;
    try {
      const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { date: nd } });
      L().date = r.lesson.date; L().nextDate = r.lesson.nextDate; syncRow({ date: nd }); paintSubline(); paintParents(); stateLine(metaState, "Gespeichert", "ok");
      toast("Datum geändert" + (st.unit ? " – auch in der Unterrichtseinheit." : "."), "ok");
    } catch (e) { fDate.value = od || ""; errToast(e); }
  });
  const metaCard = h("section", { class: "card", id: "gs-meta" }, h("div", { class: "section-title" }, h("h2", { text: "Sitzungsdaten" }), metaState),
    h("div", { class: "field" }, h("label", null, "Titel"), fTitle), h("div", { class: "field" }, h("label", null, "Thema"), fTopic),
    h("div", { class: "meta-grid" }, h("div", { class: "field" }, h("label", null, "Datum"), fDate), h("div", { class: "field" }, h("label", null, "Beginn (Uhrzeit)"), fStart),
      h("div", { class: "field" }, h("label", null, "Dauer (Minuten)"), fDur)),
    h("div", { class: "field" }, h("label", null, "Ideen und Wünsche"), fIdeas),
    h("button", { class: "btn small danger", type: "button", onclick: async () => {
      if (!(await confirmDialog("Sitzung löschen", "Die Sitzung mit Verlaufsplan, Inhalt für die Eltern und allen Dateien endgültig löschen?", "Endgültig löschen", true))) return;
      try { await tapi("DELETE", "/api/teacher/lessons/" + id); plan.dirty = false; toast("Sitzung gelöscht.", "ok"); go(coursePage); } catch (e) { errToast(e); }
    } }, "Sitzung löschen"));

  main.append(h("div", { class: "session-grid gs-session" },
    h("div", { class: "stack" }, planCard, draftCard, unitCard, claudeCard, cardsBox.el, box.filesCard, box.printCard, contentCard, parentsCard),
    h("aside", { class: "side" }, metaCard, sickCard)));
  setEditing(false);
  paintRevise();

  // Änderungen von außen (Claude über den Connector, anderes Fenster) beim Zurückkehren übernehmen – nie in ein Feld, das gerade bearbeitet wird
  const onVis = async () => {
    if (document.visibilityState !== "visible") return;
    let r;
    try { r = await tapi("GET", "/api/teacher/lessons/" + id); } catch { return; }
    const busyField = (el) => document.activeElement === el;
    const refKey = (fs) => fs.map((f) => f.id + ":" + f.status + ":" + f.name).join("|");
    const filesChanged = box.filesKey(r.files) !== box.filesKey(st.files) || refKey(r.refFiles || []) !== refKey(st.refFiles), cardsChanged = cardsBox.keyOf(r.files) !== cardsBox.keyOf(st.files);
    if (filesChanged || cardsChanged) {
      const old = st.files;
      st.files = r.files; st.refFiles = r.refFiles || [];
      if (filesChanged) { box.paintFiles(); box.paintPrint(); }
      paintPlan();
      if (cardsChanged) cardsBox.refresh(old);
    }
    if ((r.messages || []).length !== st.messages.length) { st.messages = r.messages; paintDraft(); }
    if (r.unit && (!st.unit || r.unit.version !== st.unit.version)) { st.unit = r.unit; paintUnit(); paintSubline(); if (!reviseEl || !reviseEl.contains(document.activeElement)) paintRevise(); }
    if (r.lesson.portalVersion !== plan.version && !plan.dirty && !busyField(ta)) {
      plan.version = r.lesson.portalVersion; ta.value = r.lesson.portal || "";
      Object.assign(L(), { portal: r.lesson.portal, portalVersion: r.lesson.portalVersion, portalUpdatedAt: r.lesson.portalUpdatedAt, portalSource: r.lesson.portalSource });
      paintPlan(); stateLine(planState, "Aktualisiert · " + planInfo());
    }
    for (const [el, k, f, s] of [[sumTA, "parentSummary", sumF, sumState], [hwTA, "homework", hwF, hwState], [noteTA, "parentNote", noteF, noteState]]) {
      const nv = r.lesson[k] || "";
      if (nv !== (L()[k] || "") && !busyField(el) && !f.dirty()) { L()[k] = nv; el.value = nv; stateLine(s, "Aktualisiert"); }
    }
    if (!metaT && ![fTitle, fTopic, fDur, fIdeas, fDate, fStart].some(busyField)) {
      let changed = false;
      for (const [el, k] of [[fTitle, "title"], [fTopic, "topic"], [fDur, "durationMin"], [fIdeas, "ideas"]]) {
        const cur = String(L()[k] ?? ""), nv = String(r.lesson[k] ?? "");
        if (nv !== cur && el.value === cur) { L()[k] = r.lesson[k]; el.value = nv; changed = true; }
      }
      if ((r.lesson.date || null) !== (L().date || null)) { L().date = r.lesson.date; fDate.value = r.lesson.date || ""; changed = true; }
      if ((r.lesson.startTime || null) !== (L().startTime || null)) { L().startTime = r.lesson.startTime; fStart.value = r.lesson.startTime || ""; changed = true; }
      if (changed) { heading.textContent = L().title; paintSubline(); paintParents(); stateLine(metaState, "Aktualisiert"); }
    }
  };
  document.addEventListener("visibilitychange", onVis);
  const beforeUnload = (e) => { if (plan.dirty) { flushPlan(); e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  onLeave(() => {
    document.removeEventListener("visibilitychange", onVis); window.removeEventListener("beforeunload", beforeUnload);
    if (plan.dirty) flushPlan();
    sumF.flush(); hwF.flush(); noteF.flush(); if (metaT) saveMeta();
    document.querySelectorAll(".ctxmenu").forEach((m) => m.remove());
  });
}

/* ---------- Krankmeldung: Vorschau, dann ausführen (POST /api/teacher/lessons/<id>/cancel) ---------- */
function cancelDialog(id, done) {
  const body = h("div", { class: "stack" });
  const err = h("p", { class: "err", role: "alert" });
  let version = null, ready = false, running = false;
  const paint = (plan) => {
    const c = plan.cancelled, moves = plan.moves || [], und = plan.undatedRows || [];
    clear(body).append(...nn(
      h("p", { text: "Am " + longDay(c.date) + ", fällt der Unterricht aus. Diese und alle folgenden Stunden der Einheit rücken um einen Termin nach hinten:" }),
      moves.length ? h("table", { class: "cancel-table" }, h("thead", null, h("tr", null, ["Stunde", "bisher", "neu"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", null, moves.map((m) => h("tr", null, h("td", { text: "Stunde " + m.n + ": „" + (m.title || "") + "“" }), h("td", { text: shortWhen(m.from) }), h("td", { class: m.to ? null : "none", text: shortWhen(m.to) }))))) : null,
      und.length ? h("p", { text: und.map((x) => "„" + x.title + "“").join(" und ") + (und.length === 1 ? " hat danach keinen Termin – sie bleibt ohne Datum in der Einheit, bis Sie (oder Claude) die Einheit überarbeiten."
        : " haben danach keinen Termin – sie bleiben ohne Datum in der Einheit, bis Sie (oder Claude) die Einheit überarbeiten.") }) : null,
      ...(plan.lengthChanges || []).map((g) => h("p", { class: "warnc", text: "Achtung: Stunde " + g.n + " dauert am neuen Termin " + g.to + " statt " + g.from + " Minuten." })),
      h("p", { text: "Eltern sehen für diesen Termin: „Der Unterricht konnte leider nicht stattfinden.“" }), err));
  };
  const preview = async () => {
    ready = false;
    try { const r = await tapi("POST", "/api/teacher/lessons/" + id + "/cancel", { body: { dryRun: true } }); version = r.version; paint(r.plan); ready = true; }
    catch (e) { clear(body).append(err); err.textContent = e.message; }
  };
  modal({ title: "Stunde ausfallen lassen?", wide: true, body: (el) => el.append(body), actions: [
    { label: "Abbrechen" },
    { label: "Ausfallen lassen und verschieben", class: "danger", onClick: async () => {
      if (!ready || running) return false;
      running = true; err.textContent = "";
      try {
        await tapi("POST", "/api/teacher/lessons/" + id + "/cancel", { body: { version } });
        toast("Die Stunden sind verschoben.", "ok");
        done();
        return true;
      } catch (e) {
        running = false;
        if (e.status === 409 && e.data && e.data.code === "unit_conflict") { await preview(); err.textContent = "Die Einheit wurde inzwischen geändert – die Vorschau wird neu geladen."; return false; }
        err.textContent = e.message; return false;
      }
    } }] });
  body.append(h("p", { class: "muted", text: "Lade die Vorschau …" }));
  preview();
}

/* ---------- Ausfall-Eintrag (Krankmeldung): schlanke Seite – was passiert ist, roter Kasten, Elternansicht, löschen ---------- */
async function gsPlaceholderPage(id, d, main, course, coursePage) {
  const L = () => d.lesson, l = d.lesson, unit = d.unit;
  const item = unit && unit.revise ? unit.revise.items.find((x) => x.placeholderId === id) : null;
  main.classList.add("gs-placeholder");
  const heading = h("h1", { text: "Ausgefallen: " + (l.date ? longDay(l.date) : "ohne Termin") });
  main.append(pageHead({ fach: "gs", title: heading, sub: h("div", { class: "chips" }, ...nn(course ? h("span", { class: "chip", text: course.short }) : null, l.startTime ? h("span", { class: "chip", text: l.startTime + " Uhr" }) : null,
      l.durationMin ? h("span", { class: "chip", text: l.durationMin + " Minuten" }) : null)),
    crumbs: [["#/lk/grundschule", "Grundschule"], [coursePage, course ? course.short : "Kurs"], ...(unit ? [["#/lk/u/" + unit.id, unit.title || "Einheit"]] : []), "Ausgefallen"] }));
  const lead = h("p", { class: "lead", text: "An diesem Termin konnte der Unterricht nicht stattfinden." });
  const info = h("section", { class: "card", id: "gs-cancelled" }, h("h2", { text: "Unterricht ausgefallen" }), lead);
  if (item && item.lessonId && unit) {
    tapi("GET", "/api/teacher/units/" + unit.id).then((r) => {
      const m = (r.unit.lessons || []).find((x) => x.id === item.lessonId);
      if (!m) return;
      lead.append(" Die geplante Sitzung „" + (item.title || m.title) + "“ " + (m.date ? "findet jetzt am " + fmtDay(m.date) + (m.time ? " um " + m.time + " Uhr" : "") + " statt." : "hat noch keinen neuen Termin."), " ",
        h("a", { href: "#/lk/s/" + m.id }, "Zur verschobenen Sitzung"));
    }).catch(() => {});
  }
  const opens = parentOpensAt({ date: l.date, startTime: l.startTime, durationMin: l.durationMin });
  const when = h("p", { class: "small", role: "status", text: opens ? "Eltern sehen für diesen Termin ab " + longWhen(opens) + ": „Der Unterricht konnte an diesem Termin leider nicht stattfinden.“" : "Eltern sehen für diesen Termin, dass der Unterricht nicht stattfinden konnte." });
  const noteTA = h("textarea", { id: "gs-note", rows: "3", maxlength: "2000", value: l.parentNote || "", "aria-describedby": "gs-note-h" });
  const noteState = h("span", { class: "save-state" });
  const noteF = autoSave(id, L, noteTA, "parentNote", "parentNote", noteState);
  const parents = parentsCardDom(id, L, { status: [when], noteState, noteTA });
  const del = h("section", { class: "card" }, h("h2", { text: "Ausfall-Eintrag" }),
    h("p", { class: "small", text: "Der Ausfall-Eintrag hält den ausgefallenen Termin für die Eltern fest. Die Termine der Einheit bleiben, auch wenn Sie ihn löschen." }),
    h("button", { class: "btn small danger", type: "button", onclick: async () => {
      if (!(await confirmDialog("Ausfall-Eintrag löschen", "Ausfall-Eintrag löschen? Der Elternlink dieses Termins funktioniert danach nicht mehr; die Termine der Einheit bleiben, wie sie sind.", "Löschen", true))) return;
      try { await tapi("DELETE", "/api/teacher/lessons/" + id); toast("Ausfall-Eintrag gelöscht.", "ok"); go(unit ? "#/lk/u/" + unit.id : coursePage); } catch (e) { errToast(e); }
    } }, icon("trash"), "Ausfall-Eintrag löschen"));
  main.append(h("div", { class: "stack" }, ...nn(unit ? reviseBox(unit, { unitLink: true, onChange: () => go("#/lk/s/" + id) }) : null, info, parents, del)));
  onLeave(() => noteF.flush());
}
