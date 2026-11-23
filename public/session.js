// session.js – Sitzungsansicht der Lehrkraft: Planung im Chat, Schulportal-Eintrag, Claude-Prompts, Material, Präsentation, Feibeitsblatt.
import { lazy } from "./update.js";
import { h, clear, toast, errToast, busy, modal, confirmDialog, copyText, fmtBytes, fmtDate, fmtTime, fileIcon, downloadBlob, upload, api, apiUrl, nn, icon, pageHead, setFach, stateLine } from "./ui.js";
import { render, go, onLeave } from "./app.js";
import { T, tapi, teacherBar, teacherFoot, fbAutoConnect, fbUnlock, fbStore, fbForget, askTeacherPassword, notfallBackfill } from "./teacher.js";
import { subjectName, gradeInfo, formatCode, claudePresentationPrompt, PORTAL_RULES, portalForCopy, insertStop, removeStops, hasStop, isStopLine,
  fmtDay, classShort, gradeKey, isAnalogClass, ANALOG_RULE, isCourseClass, courseMembers, homeworkForPortal, PUBLIC_URL,
  lessonTimes, fmtClockBerlin, fmtDayBerlin, HOMEWORK_BEFORE_END_MIN, PRESENTATION_AFTER_END_MIN, slidesUpTo, subjectShort,
  withAgeExpectation, looksLikeSolution, isGsLesson, portalVerbatim, TEACHER_SUMMARY_TITLE, stopForShown, slidePhasesOf, portalPhases } from "./shared.js";
import { extractUnitChange, stripUnitBlock, unitContext, claudeLessonPrompt, lessonChatName } from "./planning.js";
import { claudeHandoff } from "./claude.js";
import { leupoldView } from "./units.js";
import { substituteCards } from "./substitute.js";
import { SELBSTLERN_HW_WHEN, selbstlernTimesText, SELBSTLERN_AI_LABEL, SELBSTLERN_AI_HINT, SELBSTLERN_BUTTON, youtubeUrl, fmtVideoStart } from "./selbstlern.js";
import { mediaItems, problemOf, prepareMedia, uploadMedia, itemName } from "./fbmedia.js";
import { paintPortalPreview, portalPreview, contextMenu, prevStopCard, stopNextHint, prevStopShown, prevStopAfterSave, keepFocusOn, removeKeepingView } from "./portalview.js";
import { renderMarkdown } from "./markdown.js";
import { materialBox, dropZone } from "./materialbox.js";
import { notesPanel, notesDirty, NOTES_UNREADABLE, NOTES_DELETE_TEXT, NOTES_REPLACE_HINT } from "./notesedit.js";
import { personLabel, personKey, cleanPhoto, PHOTO_TASKS_MAX, materialRuns, taskTextFmt, fbLinksOf } from "./fbclient.js";
import { summaryCard } from "./tsummary.js";
import { bringCard } from "./bringcard.js";
import { freeDateMessage } from "./freedays.js";
import { inClassToggle } from "./inclassbar.js";
import { lessonDocsCard } from "./lessondocs.js";
import { videoSlidesOf, videoAt, videoName, lessonVideos, videoPromptSection } from "./videoslides.js";
import { videosPanel } from "./videopanel.js";

const MODES = [["planning", "Planung"], ["ideas", "Ideen weiterentwickeln"], ["material", "Material erstellen"]];

export async function sessionPage(id) {
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade die Sitzung …" }));
  render(teacherBar("lessons"), main, teacherFoot());
  let d, cfg = null;
  try { [d, cfg] = await Promise.all([tapi("GET", "/api/teacher/lessons/" + id), tapi("GET", "/api/teacher/subjects").then((r) => r.subjects).catch(() => null)]); }
  catch (e) { clear(main).append(h("div", { class: "card" }, h("p", { class: "err", text: e.message }), h("a", { class: "btn", href: "#/lk" }, "Zur Übersicht"))); return; }
  // Grundschule: eigene Sitzungsseite (Verlaufsplan statt Schulportal-Eintrag, keine Präsentation, Elternansicht)
  // (nur, wenn die Seite noch angezeigt wird – sonst würde sie eine inzwischen geöffnete andere Seite überschreiben)
  if (isGsLesson(d.lesson)) { const gs = await lazy(import("./gssession.js")); return main.isConnected ? gs.gsSessionPage(id, d) : undefined; }
  const st = { lesson: d.lesson, messages: d.messages, files: d.files, sheets: d.sheets, drafts: d.drafts, slides: null, unit: d.unit, sub: d.substitute };
  const L = () => st.lesson;
  const analog = isAnalogClass(d.lesson.klass);
  let portalTA = null;
  let packSync = null;   // Nachtrag 42: Sitzungspakete der Druckliste neu ordnen, wenn sich der Schulportal-Eintrag ändert (gesetzt, sobald die Druckliste steht)
  const row = () => (st.unit && L().unitRow ? (st.unit.rows || []).find((r) => r.uid === L().unitRow) || null : null);
  const ctx = () => ({ lessonId: id, code: L().code, subject: L().subject, klass: L().klass,
    lesson: { title: L().title, topic: L().topic, durationMin: L().durationMin, date: L().date, startTime: L().startTime, ideas: L().ideas, homework: L().homework },
    materials: st.files.filter((f) => f.area !== "archive" && !f.notesOf).map((f) => ({ name: f.name, area: f.area, kind: f.kind, text: f.kind === "link" ? f.url || "" : f.design ? f.design.text || "" : f.text || "", pages: f.pages })), sheets: st.sheets,
    portal: portalTA ? portalTA.value : L().portal, unit: st.unit, row: row(), unitText: st.unit ? unitContext(st.unit, L().unitRow) : "",
    gradeNote: cfg && cfg[L().subject] ? (cfg[L().subject].gradeNotes || {})[gradeKey(L().klass)] || "" : "", classSize: d.course ? d.course.classSize : null });

  // Kopfband in der Fachfarbe: Folgennummer der Stunde in der Einheit, Fach, Kurs, Datum, Dauer
  const heading = h("h1", { text: L().title });
  const subline = h("div", { class: "chips" });
  const paintSubline = () => {
    const r = row(), idx = r && st.unit ? (st.unit.rows || []).indexOf(r) : -1;
    clear(subline).append(...nn(idx >= 0 ? h("span", { class: "chip strong", text: "Stunde " + (idx + 1) + " von " + st.unit.rows.length }) : null,
      h("span", { class: "chip", text: subjectName(L().subject) }), h("span", { class: "chip", text: classShort(L().klass), title: gradeInfo(L().klass).text }),
      // ohne Termin nur, wenn eine Stunde beim Verschieben wegen unterrichtsfreier Tage hinter das Ende ihrer Einheit gerutscht ist (Nachtrag 24)
      h("span", { class: "chip", text: L().date ? fmtDay(L().date) : "ohne Termin" }), L().durationMin ? h("span", { class: "chip", text: L().durationMin + " Minuten" }) : null,
      // liegt auf einem unterrichtsfreien Tag der Schule (Einstellungen, Nachtrag 24) – z. B. nach „Nur speichern – Sitzungen bleiben“
      L().freeDay ? h("span", { class: "chip freechip", text: "Liegt auf einem unterrichtsfreien Tag (" + L().freeDay.label + ")" }) : null));
  };
  paintSubline();
  // Zeitpunkte der Sitzung (Beginn + Dauer): Hausaufgabe und Präsentation für Schüler:innen
  const timesNow = () => lessonTimes({ date: L().date, startTime: L().startTime, durationMin: L().durationMin });
  const missingTimes = () => [!L().startTime ? "der Beginn (Uhrzeit)" : null, !L().durationMin ? "die Dauer" : null].filter(Boolean).join(" und ") || "eine Angabe";
  const sameDay = (ms) => fmtDayBerlin(ms) === fmtDayBerlin(timesNow() ? timesNow().start : ms);
  const whenText = (ms) => (sameDay(ms) ? "" : fmtDayBerlin(ms) + ", ") + fmtClockBerlin(ms) + " Uhr";
  const onTimes = [];   // Teile der Seite, die von Beginn/Dauer abhängen (Hausaufgabe, Präsentation, Sitzungsdaten)
  // Selbstlern-Phase (Nachtrag 29): Hausaufgabe von Anfang an, fällig zur nächsten Sitzung MIT der Lehrkraft, keine Präsentation der ursprünglichen Planung,
  // KI-Chatbots bis zur nächsten Sitzung mit ihr – die Hinweise auf dieser Seite sagen dasselbe wie die Karte „Selbstlern-Phase“ (Prüfbefund)
  const selbstNow = () => !!st.sub && st.sub.status === "selbstlern";
  const hwDueDate = () => (selbstNow() ? d.teacherNextDate || null : L().nextDate);
  const paintTimes = () => { for (const f of onTimes) f(); };
  // „Ich bin jetzt im Unterricht“ (Nachtrag 35): die kompakte Ansicht (inclass.js) folgt dem Verlaufsplan („plan“) und dem Material samt Präsentation („files“)
  const icOn = { plan: new Set(), files: new Set() };
  const icEmit = (k) => { for (const f of icOn[k]) { try { f(); } catch (e) { console.warn("Ansicht für den Unterricht:", e && e.message); } } };
  clear(main).append(pageHead({ fach: L().subject, title: heading, sub: subline,
    crumbs: [["#/lk", "Fächer"], ["#/lk/f/" + L().subject, subjectName(L().subject)], ["#/lk/f/" + L().subject + "/" + L().klass, classShort(L().klass)],
      ...(st.unit ? [["#/lk/u/" + st.unit.id, st.unit.title || "Einheit"]] : []), L().title] }));

  /* ======================= Zusammenfassung der Sitzung für die Lehrkraft (Nachtrag 21): ganz oben, vor allem anderen ======================= */
  // Kopfzeile aus den aktuellen Daten (folgt Datum und Beginn), Hinweis bei geänderter Planung (auch ungespeichert im Editor) bzw. bestätigter Vertretung
  const tsum = summaryCard({ id, L, planText: () => (portalTA ? portalTA.value : L().portal || ""), substituteActive: () => !!st.sub && st.sub.status === "aktiv",
    selbstlernActive: () => !!st.sub && st.sub.status === "selbstlern" });
  onTimes.push(tsum.paintHead);

  /* ======================= Unterrichtseinheit ======================= */
  const unitCard = h("section", { class: "card unitbox" });
  function paintUnit() {
    clear(unitCard);
    if (!st.unit) {
      unitCard.append(h("p", { class: "small muted", text: "Diese Sitzung gehört zu keiner Unterrichtseinheit (angelegt vor Einführung der Einheitenplanung)." }));
      return;
    }
    const u = st.unit, r = row(), idx = r ? u.rows.indexOf(r) : -1, step = r && r.schritt != null ? (u.plan.schritte || [])[r.schritt] : null;
    unitCard.append(...nn(h("div", { class: "section-title" }, h("h2", { text: "Unterrichtseinheit: " + (u.title || (u.plan && u.plan.titel) || "ohne Titel") }), h("a", { class: "btn small", href: "#/lk/u/" + u.id }, "Einheit öffnen")),
      r ? h("p", { class: "small" }, h("strong", { text: "Stunde " + (idx + 1) + " von " + u.rows.length }), step ? " · Lernschritt " + (r.schritt + 1) + ": " + step.titel : "") : h("p", { class: "small warnc", text: "Die Zeile dieser Sitzung steht nicht mehr in der Einheit." }),
      r ? h("div", { class: "unit-row" }, h("div", null, h("div", { class: "lp-cap", text: "Stundenfrage" }), h("div", { text: r.stundenfrage || "(noch offen)" })),
        h("div", null, h("div", { class: "lp-cap", text: "Grober Ablauf (Inspiration)" }), r.ablauf.length ? h("ul", null, r.ablauf.map((a) => h("li", { text: a }))) : h("div", { class: "muted", text: "–" }))) : null,
      u.plan && u.plan.lernaufgabe ? h("p", { class: "small", style: { marginTop: ".5rem" } }, h("strong", { text: "Zentrale Lernaufgabe: " }), u.plan.lernaufgabe) : null,
      h("details", { class: "box" }, h("summary", null, "Leupold-Schema der Einheit"), leupoldView(u, r ? r.schritt : null)),
      h("p", { class: "hint", text: "Die Planungsassistenz bezieht sich auf die Einheit; der Ablauf dort ist nur Inspiration. Schlägt sie eine Änderung der Stundenfrage oder des Ablaufs vor, können Sie diese mit einem Klick in die Einheit übernehmen." })));
  }
  function unitChangeBox(ch) {
    const box = h("div", { class: "unit-change" }, h("div", { class: "lp-cap", text: "Vorgeschlagene Änderung der Einheit" }),
      ch.stundenfrage ? h("p", { class: "small" }, h("strong", { text: "Stundenfrage: " }), ch.stundenfrage) : null,
      ch.ablauf.length ? h("ul", { class: "small" }, ch.ablauf.map((a) => h("li", { text: a }))) : null,
      ch.begruendung ? h("p", { class: "small muted" }, h("strong", { text: "Begründung: " }), ch.begruendung) : null);
    if (st.unit && row()) box.append(h("button", { class: "btn small primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
      try {
        const r = await tapi("PUT", "/api/teacher/units/" + st.unit.id + "/rows/" + L().unitRow, { body: { stundenfrage: ch.stundenfrage, ablauf: ch.ablauf } });
        st.unit = r.unit; paintUnit(); toast("In die Einheit übernommen (Stunde " + (st.unit.rows.findIndex((x) => x.uid === L().unitRow) + 1) + ").", "ok");
      } catch (err) { errToast(err); }
    }) }, "In die Einheit übernehmen"));
    else box.append(h("p", { class: "small muted", text: "Diese Sitzung ist mit keiner Zeile einer Einheit verknüpft." }));
    return box;
  }
  paintUnit();

  /* ======================= Chat ======================= */
  const msgsBox = h("div", { class: "msgs", "aria-live": "polite" });
  const input = h("textarea", { id: "chatin", rows: "3", placeholder: "Nachricht an den Planungsassistenten … (Enter = senden, Umschalt+Enter = neue Zeile)" });
  const modeSel = h("select", { "aria-label": "Art der Anfrage", style: { width: "auto" } }, MODES.map(([v, l]) => h("option", { value: v }, l)));
  const sendBtn = h("button", { class: "btn primary", type: "button" }, "Senden");
  const modelInfo = h("span", { class: "small muted" });
  function msgNode(m, pending) {
    const body = h("div", { class: "body" });
    const change = m.role === "assistant" && !pending ? extractUnitChange(m.content) : null;
    if (m.role === "assistant") body.append(renderMarkdown(change ? stripUnitBlock(m.content) : m.content)); else body.textContent = m.content;
    if (change) body.append(unitChangeBox(change));
    const tools = h("div", { class: "tools" });
    if (m.role === "assistant" && !pending && m.model !== "begruessung") {
      tools.append(h("button", { class: "btn small", type: "button", onclick: () => adoptMaterial(m.content) }, "Als Material übernehmen"),
        h("button", { class: "btn small", type: "button", onclick: async () => toast((await copyText(m.content)) ? "Kopiert." : "Kopieren nicht möglich.", "ok") }, "Kopieren"));
    }
    if (!pending && m.id) tools.append(h("button", { class: "btn small ghost", type: "button", "aria-label": "Nachricht löschen", onclick: async () => {
      if (!(await confirmDialog("Nachricht löschen", "Diese Nachricht aus dem Planungsverlauf entfernen?", "Löschen", true))) return;
      try { await tapi("DELETE", "/api/teacher/lessons/" + id + "/chat/" + m.id); st.messages = st.messages.filter((x) => x.id !== m.id); paintMsgs(); } catch (e) { errToast(e); }
    } }, icon("trash")));
    const who = m.role === "user" ? "Sie" : m.model === "begruessung" ? "Planungsassistent" : m.mode === "claude" ? "Claude (über Connector)" : "Planungsassistent" + (m.model ? " · " + m.model : "");
    return h("div", { class: "msg " + m.role + (pending ? " pending" : "") }, h("div", { class: "who" }, h("span", { text: who }), m.createdAt ? h("span", { text: fmtTime(m.createdAt) }) : null), body, tools.childNodes.length ? tools : null);
  }
  function paintMsgs() { clear(msgsBox).append(...st.messages.map((m) => msgNode(m))); msgsBox.scrollTop = msgsBox.scrollHeight; }
  async function send() {
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    await flushPortal();
    const mode = modeSel.value;
    const userMsg = { role: "user", content: text, createdAt: Date.now() };
    st.messages.push(userMsg); input.value = "";
    const pend = { role: "assistant", content: "", createdAt: Date.now() };
    let pendNode = msgNode(pend, true);
    msgsBox.append(msgNode(userMsg), pendNode); msgsBox.scrollTop = msgsBox.scrollHeight;
    sendBtn.disabled = true; modelInfo.textContent = "KI arbeitet …";
    try {
      const res = await api("POST", "/api/teacher/lessons/" + id + "/chat", { token: T.token, body: { message: text, mode }, stream: true });
      if (res instanceof Response) {
        userMsg.id = Number(res.headers.get("X-User-Message")) || undefined;
        const model = decodeURIComponent(res.headers.get("X-Provider") || "") + " · " + decodeURIComponent(res.headers.get("X-Model") || "");
        modelInfo.textContent = model;
        const reader = res.body.getReader(), dec = new TextDecoder();
        let buf = "", last = 0, err = null;
        const repaint = (final) => { const n = msgNode({ ...pend, model }, !final); pendNode.replaceWith(n); pendNode = n; msgsBox.scrollTop = msgsBox.scrollHeight; };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            const p = line.slice(5).trim();
            if (!p || p === "[DONE]") continue;
            try {
              const j = JSON.parse(p);
              if (j.error) { err = j.error.message || String(j.error); continue; }
              const dl = j.choices && j.choices[0] && j.choices[0].delta;
              if (dl && typeof dl.content === "string") pend.content += dl.content;
            } catch {}
          }
          if (Date.now() - last > 150) { repaint(false); last = Date.now(); }
        }
        if (!pend.content.trim()) throw new Error(err || "Die KI hat keine Antwort geliefert. Bitte erneut senden oder in den Einstellungen ein anderes Modell wählen.");
        const saved = await tapi("POST", "/api/teacher/lessons/" + id + "/chat/answer", { body: { content: pend.content + (err ? "\n\n_(Antwort unvollständig: " + err + ")_" : ""), model, mode } });
        st.messages.push(saved.message);
      } else {
        userMsg.id = res.userMessageId; st.messages.push(res.message); modelInfo.textContent = res.message.model || "";
      }
    } catch (e) {
      errToast(e);
      if (!userMsg.id) { st.messages = st.messages.filter((m) => m !== userMsg); input.value = text; }
      modelInfo.textContent = "";
    } finally { sendBtn.disabled = false; paintMsgs(); }
  }
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  const routeHint = h("p", { class: "hint", text: "Fach, Klasse, Sitzungsdaten, Materialien und Schulportal-Eintrag werden automatisch mitgeschickt. Ist das Kontingent eines Dienstes erschöpft, wechselt die Plattform von selbst zum nächsten (zuletzt Cloudflare Workers AI)." });
  const chatCard = h("section", { class: "card", id: "backupchat" },
    h("div", { class: "section-title" }, h("h2", { text: "Backup: Planung mit kostenloser KI" }),
      h("button", { class: "btn small ghost", type: "button", onclick: async () => {
        if (!(await confirmDialog("Planungsverlauf neu beginnen", "Alle Nachrichten dieser Sitzung werden gelöscht. Schulportal-Eintrag und Materialien bleiben erhalten.", "Neu beginnen", true))) return;
        try { st.messages = (await tapi("DELETE", "/api/teacher/lessons/" + id + "/chat")).messages; paintMsgs(); } catch (e) { errToast(e); }
      } }, "Neu beginnen")),
    h("div", { class: "chat" }, msgsBox, h("div", { class: "composer" }, input, h("div", { class: "row between" }, h("div", { class: "row" }, modeSel, modelInfo), sendBtn))),
    h("p", { class: "small muted", text: "Für Zeiten, in denen Ihr Claude-Kontingent erschöpft ist: Planen Sie hier mit kostenlosen Modellen weiter. Ergebnisse (Schulportal-Eintrag, Material, Feibeitsblatt-Entwurf) übernehmen Sie mit den Knöpfen in den Antworten." }),
    routeHint);
  paintMsgs();
  // Reihenfolge der kostenlosen Dienste aus den Einstellungen anzeigen (ohne die Seite aufzuhalten)
  tapi("GET", "/api/teacher/ai").then((r) => {
    const t = (r.tasks || []).find((x) => x.id === "planning"), label = (pid) => ((r.providers || []).find((p) => p.id === pid) || {}).label || pid;
    if (t && Array.isArray(t.route) && t.route.length) routeHint.textContent = "Reihenfolge der kostenlosen KI: " + t.route.map((x) => label(x.provider).replace(" (ohne Schlüssel)", "")).join(" → ") +
      " – ist das Kontingent eines Dienstes erschöpft, wechselt die Plattform von selbst zum nächsten (Einstellungen → KI-Modelle). Fach, Klasse, Sitzungsdaten, Materialien und Schulportal-Eintrag werden automatisch mitgeschickt.";
  }).catch(() => {});

  async function adoptMaterial(content) {
    const firstHeading = (/^\s*#{1,3}\s+(.+)$/m.exec(content) || [])[1];
    const title = h("input", { value: (firstHeading || "Material").replace(/[*_`]/g, "").slice(0, 200) });
    const ta = h("textarea", { rows: "14", value: content, class: "mono", style: { fontSize: ".88rem" } });
    let area = "student";
    const radios = h("div", { class: "row" }, [["student", "Für Schüler:innen"], ["teacher", "Nur für Lehrkräfte"]].map(([v, l]) => h("label", { style: { fontWeight: 400, display: "flex", gap: ".35rem", alignItems: "center" } },
      h("input", { type: "radio", name: "ar", value: v, checked: v === area ? true : null, onchange: () => { area = v; } }), l)));
    modal({ title: "Als Material übernehmen", wide: true, body: (el) => el.append(h("div", { class: "field" }, h("label", null, "Titel"), title), h("div", { class: "field" }, h("label", null, "Bereich"), radios),
      h("div", { class: "field" }, h("label", null, "Inhalt (Markdown – Schüler:innen erhalten daraus eine PDF-Datei)"), ta)),
      actions: [{ label: "Abbrechen" }, { label: "Speichern", class: "primary", onClick: async () => {
        try { const r = await tapi("POST", "/api/teacher/lessons/" + id + "/texts", { body: { area, title: title.value, text: ta.value, source: "chat" } }); st.files.push(r.file); paintFiles(); toast("Material gespeichert.", "ok"); }
        catch (e) { errToast(e); return false; }
      } }] });
  }

  /* ======================= Schulportal-Eintrag ======================= */
  const portal = { version: L().portalVersion, dirty: false, timer: null, chain: Promise.resolve() };
  const portalState = h("span", { class: "save-state" });
  const preview = h("div", { class: "portal-preview", "aria-label": "Vorschau im Schulportal" });
  const portalBody = h("div", { class: "stack" });
  const presPromptBtn = h("button", { class: "btn big", type: "button" }, "Prompt für die Präsentation kopieren");
  const presPromptOut = h("div");
  const genPortalBtn = h("button", { class: "btn primary", type: "button" }, "Schulportal-Eintrag erstellen");
  function paintPreview() { paintPortalPreview(preview, portalTA.value); updateStopBtns(); tsum.paintNote(); if (packSync) packSync(); icEmit("plan"); }
  /* ---- Zwischenstopp: Rechtsklick auf eine Zeile (Textfeld oder Vorschau) → „Zwischenstopp einfügen“ (vor dieser Zeile) ---- */
  const stopBtn = h("button", { class: "btn", type: "button", title: "Vor der Zeile mit der Schreibmarke einfügen" }, icon("pause"), "Zwischenstopp einfügen");
  const unstopBtn = h("button", { class: "btn ghost hidden", type: "button" }, "Zwischenstopp entfernen");
  // nach dem Setzen: Hinweis, dass Claude beim Planen der nächsten Sitzung nach dem offenen Teil fragt (Anforderung 13) – bis der Zwischenstopp wieder weg ist
  const stopNext = h("p", { class: "hint stopnext hidden", id: "stop-next" });
  let stopJustSet = false;
  function updateStopBtns() {
    if (!portalTA) return;
    const has = hasStop(portalTA.value);
    unstopBtn.classList.toggle("hidden", !has);
    if (!has) stopJustSet = false;
    stopNext.classList.toggle("hidden", !stopJustSet);
  }
  const lineAt = (offset) => portalTA.value.slice(0, Math.max(0, offset)).split("\n").length - 1;
  function applyPortalText(t) { portalTA.value = t; paintPreview(); setPresBtn(); schedulePortal(); }
  function insertStopAt(line) {
    stopJustSet = true; clear(stopNext).append(...stopNextHint(d.nextLesson));
    applyPortalText(insertStop(portalTA.value, line).text);
    toast("Zwischenstopp eingefügt – er bleibt intern und wird nicht ins Schulportal kopiert.", "ok");
  }
  const dropStop = () => { applyPortalText(removeStops(portalTA.value)); toast("Zwischenstopp entfernt.", "ok"); };
  function stopMenu(line, x, y) {
    const onStop = isStopLine(portalTA.value.split("\n")[line] || "");
    contextMenu(x, y, onStop ? [{ label: "Zwischenstopp entfernen", danger: true, onClick: dropStop }]
      : [{ label: [icon("pause"), "Zwischenstopp einfügen"], onClick: () => insertStopAt(line) }, ...(hasStop(portalTA.value) ? [{ label: "Zwischenstopp entfernen", danger: true, onClick: dropStop }] : [])]);
  }
  stopBtn.addEventListener("click", () => insertStopAt(lineAt(portalTA.selectionStart || 0)));
  unstopBtn.addEventListener("click", dropStop);
  preview.addEventListener("contextmenu", (e) => { const el = e.target.closest("[data-line]"); if (!el || e.shiftKey) return; e.preventDefault(); stopMenu(Number(el.dataset.line), e.clientX, e.clientY); });
  // iPad: kein Rechtsklick – Tippen auf eine Zeile der Vorschau öffnet das Menü
  preview.addEventListener("click", (e) => {
    if (!window.matchMedia("(pointer: coarse)").matches || e.target.closest("a")) return;
    const el = e.target.closest("[data-line]"); if (el) stopMenu(Number(el.dataset.line), e.clientX, e.clientY);
  });
  const setPresBtn = () => { const has = !!(portalTA && portalTA.value.trim()); presPromptBtn.disabled = !has; presPromptBtn.title = has ? "" : "Erst einen Schulportal-Eintrag erstellen"; };
  function setSaved(text, kind) { stateLine(portalState, text, kind); }
  function schedulePortal() { portal.dirty = true; setSaved("Ungespeicherte Änderungen …"); clearTimeout(portal.timer); portal.timer = setTimeout(() => flushPortal(), 1200); }
  function flushPortal(force) {
    clearTimeout(portal.timer);
    portal.chain = portal.chain.then(async () => {
      if (!portalTA || (!portal.dirty && !force)) return true;
      const text = portalTA.value; portal.dirty = false; setSaved("Speichert …");
      try {
        const r = await tapi("PUT", "/api/teacher/lessons/" + id + "/portal", { body: force ? { text, force: true } : { text, baseVersion: portal.version } });
        portal.version = r.portal.version; L().portal = text; L().portalVersion = r.portal.version;
        setSaved("Gespeichert " + new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) + " (Version " + r.portal.version + ")", "ok");
        planSaved(r.portal.updatedAt);
        if (portalTA.value !== text) schedulePortal();
        return true;
      } catch (e) {
        if (e.status === 409 && e.data && e.data.current) { await portalConflict(e.data.current, text); return false; }
        portal.dirty = true; setSaved("Nicht gespeichert: " + e.message, "err"); return false;
      }
    });
    return portal.chain;
  }
  function portalConflict(cur, mine) {
    return new Promise((resolve) => {
      modal({ title: "Der Eintrag wurde inzwischen geändert", wide: true, onClose: () => resolve(),
        body: (el) => el.append(h("p", { text: "Der Schulportal-Eintrag wurde an anderer Stelle geändert (" + (cur.source === "claude" ? "von Claude über den Connector" : cur.source === "ki" ? "von der KI" : "in einem anderen Fenster") + ", Version " + cur.version + "). Welche Fassung soll gelten?" }),
          h("div", { class: "portal-wrap" }, h("div", null, h("h3", { text: "Ihre Fassung" }), h("pre", { class: "portal-preview mono", style: { whiteSpace: "pre-wrap" }, text: mine })),
            h("div", null, h("h3", { text: "Gespeicherte Fassung" }), h("pre", { class: "portal-preview mono", style: { whiteSpace: "pre-wrap" }, text: cur.text })))),
        actions: [
          { label: "Gespeicherte Fassung übernehmen", onClick: () => { portalTA.value = cur.text; portal.version = cur.version; portal.dirty = false; L().portal = cur.text; paintPreview(); setPresBtn(); setSaved("Gespeicherte Fassung übernommen (Version " + cur.version + ")"); } },
          { label: "Meine Fassung speichern", class: "primary", onClick: () => { portal.dirty = true; flushPortal(true); } },
        ] });
    });
  }
  function showPortalEditor() {
    if (portalTA) return;
    portalTA = h("textarea", { class: "portal-text", id: "portal", spellcheck: "true", "aria-label": "Schulportal-Eintrag (bearbeitbar)", value: L().portal || "" });
    portalTA.addEventListener("input", () => { paintPreview(); setPresBtn(); schedulePortal(); });
    portalTA.addEventListener("blur", () => flushPortal());
    portalTA.addEventListener("contextmenu", (e) => {
      if (e.shiftKey) return;   // Umschalt + Rechtsklick = normales Menü des Browsers
      e.preventDefault();
      // Stelle unter dem Mauszeiger (sonst die Schreibmarke, die der Rechtsklick in Chrome/Safari/Edge setzt)
      let off = portalTA.selectionStart || 0;
      try { const cp = document.caretPositionFromPoint && document.caretPositionFromPoint(e.clientX, e.clientY); if (cp && cp.offsetNode === portalTA) off = cp.offset; } catch {}
      stopMenu(lineAt(off), e.clientX, e.clientY);
    });
    clear(portalBody).append(
      h("div", { class: "portal-wrap" }, h("div", null, h("label", { for: "portal" }, "Eintrag (direkt bearbeitbar, wird automatisch gespeichert)"), portalTA),
        h("div", null, h("label", null, "Vorschau im Schulportal"), preview, h("p", { class: "hint", text: "Rechtsklick auf eine Zeile (Textfeld oder Vorschau; am iPad: Zeile antippen) → „Zwischenstopp einfügen“: markiert intern, wo Sie in der nächsten Stunde weitermachen. Umschalt + Rechtsklick öffnet das normale Menü." }))),
      h("div", { class: "row between" }, portalState, h("div", { class: "row" }, stopBtn, unstopBtn,
        h("button", { class: "btn", type: "button", onclick: async () => {
          const ok = await copyText(portalForCopy(portalTA.value));
          toast(ok ? "Eintrag kopiert" + (hasStop(portalTA.value) ? " (ohne Zwischenstopp)" : "") + " – im Schulportal einfügen." : "Bitte manuell kopieren.", ok ? "ok" : "err");
        } }, "Eintrag kopieren"),
        h("button", { class: "btn", type: "button", onclick: (e) => generatePortal(e.currentTarget) }, "Mit KI neu erstellen"))),
      stopNext,
      h("details", { class: "box small" }, h("summary", null, "Schulportal-Zeichen"), h("ul", null, PORTAL_RULES.map((r) => h("li", { text: r })))));
    paintPreview(); setPresBtn();
    setSaved(L().portalUpdatedAt ? "Gespeichert (Version " + portal.version + ", " + fmtTime(L().portalUpdatedAt) + (L().portalSource === "claude" ? ", von Claude" : "") + ")" : "");
    genPortalBtn.classList.add("hidden");
  }
  async function generatePortal(btn) {
    if (portalTA && portalTA.value.trim() && !(await confirmDialog("Eintrag neu erstellen", "Der vorhandene Eintrag (einschließlich Ihrer Änderungen) wird durch einen neuen Vorschlag der KI ersetzt.", "Ersetzen", true))) return;
    await flushPortal();
    await busy(btn, async () => {
      try {
        const r = await tapi("POST", "/api/teacher/lessons/" + id + "/portal/generate", { body: { baseVersion: portal.version } });
        showPortalEditor();
        portalTA.value = r.portal.text; portal.version = r.portal.version; portal.dirty = false; L().portal = r.portal.text;
        paintPreview(); setPresBtn(); setSaved("Von der KI erstellt und gespeichert (Version " + r.portal.version + ", " + r.model + ")");
        planSaved(r.portal.updatedAt);
      } catch (e) {
        if (e.status === 409 && e.data && e.data.current) { showPortalEditor(); await portalConflict(e.data.current, portalTA.value); }
        else errToast(e);
      }
    }, "Die KI erstellt den Eintrag …");
  }
  genPortalBtn.addEventListener("click", (e) => generatePortal(e.currentTarget));
  // Präsentations-Prompt: immer aus dem aktuellen Inhalt des Textfelds (inkl. ungespeicherter Änderungen), danach sofort speichern
  presPromptBtn.addEventListener("click", async () => {
    if (!portalTA || !portalTA.value.trim()) return;
    const text = portalTA.value;
    // Videofolien (Nachtrag 38): YouTube-Videos aus genau diesem Stand des Schulportal-Eintrags (mit Phase) und den Links der Sitzung
    const c = ctx(), prompt = claudePresentationPrompt({ ...c, videoSection: videoPromptSection(lessonVideos(text, c.materials), { analog: isAnalogClass(c.klass) }) }, text, st.messages);
    const ok = await copyText(prompt);
    flushPortal();
    clear(presPromptOut).append(h("details", { class: "box", open: ok ? null : true }, h("summary", null, ok ? [icon("check"), "Prompt kopiert – in claude.ai einfügen (anzeigen)"] : "Bitte den Prompt manuell kopieren"),
      h("textarea", { rows: "10", readonly: true, value: prompt, class: "mono", style: { fontSize: ".82rem", marginTop: ".5rem" } }),
      h("p", { class: "hint" }, "Grundlage ist genau dieser Stand des Schulportal-Eintrags. ", h("a", { href: "https://claude.ai/new", target: "_blank", rel: "noopener" }, "claude.ai öffnen"))));
    toast(ok ? "Präsentations-Prompt in die Zwischenablage kopiert." : "Kopieren nicht möglich – bitte manuell kopieren.", ok ? "ok" : "err");
  });
  const portalCard = h("section", { class: "card" }, h("div", { class: "section-title" }, h("h2", { text: "Schulportal-Eintrag" }), genPortalBtn), portalBody);
  if (L().portal) showPortalEditor();
  else portalBody.append(h("p", { class: "muted small", text: "Erstellt aus dem Planungsverlauf einen fertig formatierten Eintrag für das Schulportal Hessen, den Sie bearbeiten und kopieren können." }));
  setPresBtn();
  /* ======================= Hausaufgabe ======================= */
  const hwTA = h("textarea", { id: "hw", rows: "3", value: L().homework || "", placeholder: "z. B. Lies M2 und beantworte Aufgabe 3 schriftlich." });
  const hwState = h("span", { class: "save-state" }), hwDue = h("p", { class: "small" }), hwWhen = h("p", { class: "small hwwhen" });
  const hwHead = h("h2"), hwLabel = h("label", { for: "hw" }), hwHint = h("p", { class: "hint" });
  function paintDue() {
    paintHwTexts();
    if (selbstNow()) {
      hwDue.textContent = hwDueDate() ? "Fällig zur nächsten Sitzung mit Ihnen am " + fmtDay(hwDueDate()) + " (die nächste Sitzung dieser Klasse, die keine Selbstlern-Phase ist)." : "Noch keine weitere Sitzung mit Ihnen angelegt – Schüler:innen sehen „bis zur nächsten Stunde mit deiner Lehrkraft“.";
      clear(hwWhen).append(SELBSTLERN_HW_WHEN);
      return;
    }
    hwDue.textContent = L().nextDate ? "Fällig zur nächsten Sitzung am " + fmtDay(L().nextDate) + " (richtet sich nach dem Datum der nächsten Sitzung dieser Klasse)." : "Noch keine spätere Sitzung dieser Klasse angelegt – Schüler:innen sehen „bis zur nächsten Sitzung“.";
    const t = timesNow();
    clear(hwWhen).append(t ? "Schüler:innen sehen die Hausaufgabe ab " + whenText(t.homeworkAt) + " (" + HOMEWORK_BEFORE_END_MIN + " Minuten vor dem Ende der Sitzung)."
      : h("span", { class: "warnc", text: "Schüler:innen sehen die Hausaufgabe erst " + HOMEWORK_BEFORE_END_MIN + " Minuten vor dem Ende der Sitzung – dafür fehlt " + missingTimes() + " (bei den Sitzungsdaten)." }));
  }
  let hwT = null;
  const saveHw = async () => {
    clearTimeout(hwT); hwT = null;
    try { const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { homework: hwTA.value } }); L().homework = r.lesson.homework; L().nextDate = r.lesson.nextDate; paintDue(); stateLine(hwState, "Gespeichert", "ok"); }
    catch (e) { stateLine(hwState, e.message, "err"); }
  };
  hwTA.addEventListener("input", () => { stateLine(hwState, "…"); clearTimeout(hwT); hwT = setTimeout(saveHw, 900); });
  hwTA.addEventListener("blur", () => { if (hwTA.value !== (L().homework || "")) saveHw(); });
  paintDue(); onTimes.push(paintDue);
  // Schülerpasswort für den Satz im Hinweis fürs Schulportal (Nachtrag 23): beim Öffnen der Seite und bei jeder Rückkehr zu ihr (onVis –
  // in einem anderen Tab geändert) geladen. Fehlt es beim Kopieren (Laden gescheitert), wird es einmal nachgeladen; gelingt auch das nicht,
  // wird nichts kopiert – nie ein geratenes oder fehlendes Passwort ins Schulportal. Die Vorgabe „Feindt“ liefert der Server selbst.
  let studentPw = null;
  const loadStudentPw = () => tapi("GET", "/api/teacher/student-settings")
    .then((r) => (studentPw = r && typeof r.password === "string" && r.password.trim() ? r.password : studentPw)).catch(() => studentPw);
  loadStudentPw();
  async function copyHomework() {
    let pw = studentPw;
    const late = !pw;
    if (late) pw = await loadStudentPw();
    if (!pw) return toast("Das Schülerpasswort für den Hinweis ließ sich gerade nicht laden – es wurde nichts kopiert. Bitte versuchen Sie es gleich noch einmal.", "err", 8000);
    const v = portalVerbatim(pw);
    // nach dem Nachladen kann der Browser (v. a. Safari) das Kopieren ablehnen, weil der Klick zu lange her ist – dann genügt ein zweiter Klick
    if (!(await copyText(homeworkForPortal(hwTA.value, L().code, hwDueDate(), pw))))
      return late ? toast("Kopieren nicht möglich – bitte tippen Sie noch einmal auf „Für das Schulportal kopieren“.", "err", 6000) : toast("Bitte manuell kopieren.", "ok", 6000);
    toast((hwTA.value.trim() ? "Hausaufgabe kopiert" : "Keine Hausaufgabe eingetragen – nur der Hinweis auf die Sitzung kopiert") + " – im Schulportal in das Feld „Hausaufgabe“ einfügen." +
      (!v ? " Das Schülerpasswort enthält Zeichen, die das Schulportal als Formatierung liest (z. B. ~~ oder `) – deshalb fehlt der Satz mit dem Passwort. Bitte ergänzen Sie ihn im Schulportal selbst oder ändern Sie das Passwort in den Einstellungen."
        : v.style !== "i" ? " Das Schülerpasswort steht " + (v.style === "code" ? "als Quellcode" : "ohne Formatierung") + " statt kursiv, weil das Schulportal Zeichen darin sonst als Formatierung läse." : ""),
      v ? "ok" : "err", v && v.style === "i" ? 6000 : 12000);
  }
  function paintHwTexts() {
    const sl = selbstNow();
    hwHead.textContent = sl ? "Hausaufgabe bis zur nächsten Sitzung mit Ihnen" : "Hausaufgabe bis zur nächsten Sitzung";
    hwLabel.textContent = sl ? "Hausaufgabe (Selbstlern-Phase: für Schüler:innen von Anfang an sichtbar)" : "Hausaufgabe (für Schüler:innen sichtbar ab " + HOMEWORK_BEFORE_END_MIN + " Minuten vor dem Ende der Sitzung)";
    hwHint.textContent = (sl ? "In der Selbstlern-Phase sehen die Schüler:innen sie von Anfang an unter dem Ablaufplan und in ihrer Sitzungsliste. "
      : "Schüler:innen sehen sie ab " + HOMEWORK_BEFORE_END_MIN + " Minuten vor dem Ende der Sitzung direkt unter der Live-Präsentation und in ihrer Sitzungsliste. ") + "Schulportal-Zeichen (**fett**, ~~kursiv~~) sind erlaubt. " +
      "Beim Kopieren für das Schulportal setzt Unterricks die fette Überschrift „Hausaufgabe zum …:“ (Datum der nächsten Sitzung" + (sl ? " mit Ihnen" : "") + ") davor, macht aus jeder Zeile einen Stichpunkt und ergänzt als letzten Stichpunkt „Unter " + PUBLIC_URL + " kannst du diese Sitzung mit dem Code " + formatCode(L().code) + " aufrufen … Das Passwort, das du am Anfang brauchst, um Unterricks zu öffnen, lautet …“ mit dem Schülerpasswort aus den Einstellungen – in Unterricks sehen die Schüler:innen diesen Hinweis nicht.";
  }
  paintHwTexts();
  const hwCard = h("section", { class: "card homework" }, h("div", { class: "section-title" }, hwHead, hwState),
    hwLabel, hwTA, hwDue, hwWhen,
    h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: copyHomework }, "Für das Schulportal kopieren")),
    hwHint);

  const presPromptCard = h("section", { class: "card" }, h("div", { class: "section-title" }, h("h2", { text: "Präsentation mit Claude erstellen" })),
    h("p", { class: "small", text: "Erzeugt einen ausführlichen Prompt für Claude (claude.ai), der eine vollständige Präsentation für diese Stunde direkt als PDF anfordert – zum Hochladen hier in Unterricks, auf Grundlage des aktuellen Schulportal-Eintrags, der Materialien und Ihrer Planung. Die Präsentation wird zeitlos (ohne Datum, Klasse und Sitzungscode), damit sie in einer späteren Klasse desselben Jahrgangs wieder passt; Folie 1 ist eine Titelfolie. Den Sitzungscode und den QR-Code zu Unterricks zeigt Unterricks beim Start selbst vor Folie 1 – immer den der aktuellen Sitzung. Auf jede Folie schreibt Claude unsichtbar ihre Phase im Schulportal-Eintrag – daraus trägt Unterricks den Zwischenstopp ein, wenn Sie die letzte gezeigte Folie markieren. " + (analog ? "Folien, auf denen die Schüler:innen mit Material arbeiten, zeigen nur die Aufforderung und den Titel des Materials (in Jahrgang 5/6 auf Papier)." : "Folien, auf denen die Schüler:innen mit Material aus Unterricks arbeiten, setzt Claude als Platzhalterfolien („Unterricks-Codefolie“) mit der Aufforderung und dem Titel des Materials – dort zeigt Unterricks live dieselbe Codefolie mit dieser Überschrift (Material auf Papier: nur Aufforderung und Titel).") }),
    presPromptBtn, presPromptOut);

  /* ======================= Materialien (materialbox.js) ======================= */
  // Nachtrag 42: Sitzungspakete ordnen ihre Materialien nach dem Schulportal-Eintrag (auch ungespeichert)
  const mbox = materialBox({ lessonId: id, st, L, onPaint: () => icEmit("files"), plan: () => (portalTA ? portalTA.value : L().portal || "") });
  const { filesCard, printCard, paintFiles, paintPrint, filesKey, openActs } = mbox;
  packSync = () => mbox.syncPacks();

  /* ======================= Präsentation ======================= */
  const presCard = h("section", { class: "card" });
  let pendingPdf = null;
  // Notizen der Lehrkraft zu den Folien (Nachtrag 20): Zustand des Editors übersteht das Neuzeichnen der Karte; je Präsentation neu
  let notesUi = { open: false, base: null, draft: null, fileId: null };
  const notesDirtyNow = () => notesDirty(notesUi);
  const notesUiFor = (p) => { if (notesUi.fileId !== p.id) notesUi = { open: false, base: null, draft: null, fileId: p.id }; return notesUi; };
  // Anmerkungs-PDF in der Liste „Material nur für die Lehrkraft“ ersetzen bzw. entfernen
  const swapAnnotated = (presId, nf, removed = []) => {
    st.files = st.files.filter((f) => !(f.notesOf === presId && (!nf || f.id !== nf.id)) && !removed.includes(f.id));
    if (nf) st.files.push(nf);
    paintFiles();
  };
  async function regenAnnotated(p, notes, rev, say) {
    try {
      const { makeAnnotated } = await lazy(import("./pdfnotes.js"));
      const r = await makeAnnotated(p, { token: T.token, notes, rev, codeSlides: (st.slides && st.slides.codeSlides) || p.codeSlides || [] });
      swapAnnotated(p.id, r.file, r.removed || []);
      say("Gespeichert. Die „Präsentation mit Anmerkungen“ unter „Material nur für die Lehrkraft“ ist erneuert.", "ok");
    } catch (e) {
      if (e && e.status === 409) return;   // inzwischen erneut gespeichert – die neuere Fassung erstellt sie
      say("Gespeichert. Die Anmerkungs-PDF ließ sich gerade nicht erneuern (" + (e && e.message ? e.message : e) + ") – die Präsentation ist trotzdem nutzbar; beim nächsten Speichern wird sie erneut erstellt.", "err");
    }
  }
  // Freigabe für Schüler:innen (5 Minuten nach dem Ende der Sitzung) – bleibt stehen, wenn sich Beginn oder Dauer ändern
  const presRel = h("p", { class: "small presrel" });
  const curPres = () => st.files.find((f) => f.area === "presentation" && f.status === "ready") || null;
  // was die Präsentationskarte zeigt (Datei, Markierung, Phasen, Notizen, Codefolien) – ändert es sich von außen, wird sie neu gezeichnet (doRefresh)
  const presSig = (fs) => { const p = fs.find((f) => f.area === "presentation"); return p ? JSON.stringify([p.id, p.status, p.name, p.pages, p.shownUntil, p.phases, p.cleanNeeded, p.cleanReady, p.notes, p.notesRev, p.codeSlides, p.videos]) : ""; };
  let presPainted = null, lessonStamp = d.stamp || null;
  const shownOf = (p) => (p && p.shownUntil && p.shownUntil < p.pages ? p.shownUntil : null);
  function paintPresRel() {
    const p = curPres(), t = timesNow(), n = shownOf(p);
    clear(presRel).append(t ? h("span", null, "Schüler:innen können " + (n ? (n === 1 ? "die Folie 1" : "die Folien 1–" + n) : "die ganze Präsentation") + " ab ", h("strong", { text: whenText(t.presentationAt) }),
      " selbst öffnen (" + PRESENTATION_AFTER_END_MIN + " Minuten nach dem Ende der Sitzung); vorher sehen sie nur die Folie, die Sie live zeigen.")
      : h("span", { class: "warnc", text: "Ohne " + missingTimes() + " der Sitzung bleibt die Präsentation für Schüler:innen gesperrt – bitte bei den Sitzungsdaten eintragen." }));
  }
  onTimes.push(paintPresRel);
  // letzte im Unterricht gezeigte Folie markieren (n) bzw. aufheben (null): gekürzte PDF im Browser erzeugen und hochladen (pdfcut.js). Einziger Weg für die
  // Auswahl, das Kontextmenü der Folie und „Bis hier gezeigt“ in der Präsentation – danach folgt der Zwischenstopp im Schulportal-Eintrag (Nachtrag 34).
  // → Rückmeldung zum Zwischenstopp {text, short, kind} bzw. null. Nacheinander: eine zweite Markierung, während die erste noch läuft, wartet (sonst kennte
  // sie den eben eingetragenen Zwischenstopp nicht)
  let shownChain = Promise.resolve();
  function setShown(n, onStep) {
    const run = shownChain.then(async () => {
      const p = curPres(); if (!p) return null;
      await freshPlan();
      const { markShown } = await lazy(import("./pdfcut.js"));
      const r = await markShown(p, n, T.token, onStep);
      Object.assign(p, r.file);
      // wo Unterricks zuletzt selbst einen Zwischenstopp eingetragen hat: der Stand des Servers (ein anderes Gerät kann inzwischen markiert haben – Prüfbefund)
      return (stopSync = await syncStop(p, n, (r.file && r.file.phases && r.file.phases.auto) || null));
    });
    shownChain = run.catch(() => {});
    return run;
  }
  // „Phasen der Folien“ gespeichert, die letzte gezeigte Folie ist schon markiert: den Zwischenstopp nach der neuen Zuordnung eintragen (die Auswahl derselben
  // Folie löst kein neues Markieren aus) – einen von Hand gesetzten bzw. verschobenen lässt Unterricks dabei stehen (keine neue Markierung)
  function resyncStop() {
    const run = shownChain.then(async () => {
      const p = curPres(), n = shownOf(p); if (!p || !n) return null;
      await freshPlan();
      return (stopSync = await syncStop(p, n, (p.phases && p.phases.auto) || null, { keepManual: true }));
    });
    shownChain = run.catch(() => {});
    return run;
  }
  // Hat ein anderes Gerät den Schulportal-Eintrag inzwischen geändert (z. B. dort die letzte Folie markiert), erst dessen Stand übernehmen – sonst setzte
  // Unterricks den Zwischenstopp in eine veraltete Fassung (Speichern scheiterte dann an der Version). Eine kleine Abfrage (…/stamp); eigene ungespeicherte
  // Änderungen gelten (das Speichern prüft die Version)
  async function freshPlan() {
    if (portal.dirty) return;
    try { const s = await tapi("GET", "/api/teacher/lessons/" + id + "/stamp"); if (s.portalVersion !== portal.version || s.stamp !== lessonStamp) await refreshLesson(); } catch {}
  }
  /* ---- Zwischenstopp aus der Präsentation (Nachtrag 34): die Phasen der Folien bestimmen, wo er im Schulportal-Eintrag steht (stopForShown) – gespeichert
   * wie beim Einfügen von Hand (applyPortalText, danach sofort gespeichert), mit demselben Hinweis zur nächsten Sitzung. Einen Zwischenstopp, den die
   * Lehrkraft selbst gesetzt oder verschoben hat, entfernt Unterricks nie; wo es selbst einen eingetragen hat, merkt sich der Server (phases.auto). ---- */
  let stopSync = null;   // letzte Rückmeldung – steht unter der Auswahl der letzten gezeigten Folie
  const q = (label) => "„" + label + "“";
  async function syncStop(p, n, prevAuto, opts) {
    const phases = slidePhasesOf(p);
    if (!phases && !prevAuto && n === null) return null;   // ohne Phasen hat Unterricks nie einen Zwischenstopp gesetzt
    const res = stopForShown(portalTA ? portalTA.value : "", phases, n, prevAuto, opts);
    let auto = prevAuto, out = null;
    const put = (text, set) => {
      if (set) { stopJustSet = true; clear(stopNext).append(...stopNextHint(d.nextLesson)); }
      // derselbe Text (der Zwischenstopp stand schon dort): der Hinweis gilt trotzdem – auch in der Ansicht für den Unterricht (Prüfbefund)
      if (text !== portalTA.value) applyPortalText(text); else { updateStopBtns(); icEmit("plan"); }
      flushPortal();
    };
    if (res.error) {
      out = res.error === "nomarks" ? { kind: "ok", short: "Zwischenstopp bitte selbst setzen (Folien ohne Phasen)",
        text: "Den Zwischenstopp im Schulportal-Eintrag setzen Sie bitte selbst: Diese Präsentation trägt keine Phasen. Unter „Phasen der Folien“ können Sie die Folien zuordnen – dann trägt Unterricks ihn ein." }
        : { kind: "err", short: "Zwischenstopp nicht eingetragen", text: "Den Zwischenstopp hat Unterricks nicht eingetragen: " +
          (res.error === "noheads" ? "Im Schulportal-Eintrag stehen keine nummerierten Phasen wie „**3) Partnerarbeit**“."
            : res.error === "missing" ? "Die Phase " + res.phase + " der Präsentation steht nicht im Schulportal-Eintrag."
              : "Die Phase " + res.phase + " steht im Schulportal-Eintrag mehrmals.") + " Bitte setzen Sie ihn selbst" + (res.error === "noheads" ? "." : " oder passen Sie „Phasen der Folien“ an.") };
      return out;   // nichts geändert – auch nicht, wo Unterricks zuletzt einen eingetragen hat
    }
    if (res.text !== undefined && !res.complete && !res.remove) {
      put(res.text, true); auto = { phase: res.phase, until: n };
      out = { kind: "ok", short: "Zwischenstopp vor " + q(res.label), text: "Zwischenstopp im Schulportal-Eintrag vor " + q(res.label) + " eingetragen." };
    } else if (res.complete) {
      auto = null;
      if (res.remove) put(res.text, false);
      out = { kind: "ok", short: res.remove ? "Stunde geschafft – Zwischenstopp entfernt" : "Stunde geschafft",
        text: "Laut Präsentation ist die Stunde geschafft" + (res.remove ? " – den Zwischenstopp vor " + q(res.removed) + ", den Unterricks eingetragen hatte, hat es wieder entfernt."
          : res.manual ? ". Ihren Zwischenstopp im Schulportal-Eintrag lässt Unterricks stehen (Sie haben ihn selbst gesetzt bzw. verschoben)." : " – im Schulportal-Eintrag ist kein Zwischenstopp nötig.") };
    } else if (res.remove) {
      auto = null; put(res.text, false);
      out = { kind: "ok", short: "Zwischenstopp entfernt", text: "Den Zwischenstopp vor " + q(res.label) + ", den Unterricks eingetragen hatte, hat es wieder entfernt." };
    } else {   // Markierung aufgehoben, kein Zwischenstopp von Unterricks (mehr) an seiner Stelle
      auto = null;
      out = res.manual ? { kind: "ok", short: "Zwischenstopp bleibt", text: "Ihr Zwischenstopp im Schulportal-Eintrag bleibt stehen – Sie haben ihn selbst gesetzt bzw. verschoben." } : null;
    }
    const same = (a, b) => (!a && !b) || (!!a && !!b && a.phase === b.phase && a.until === b.until);
    if (!same(auto, prevAuto)) {
      try { const r = await tapi("PUT", "/api/teacher/files/" + p.id + "/phases", { body: { auto } }); Object.assign(p, r.file); }
      catch (e) { console.warn("Zwischenstopp nicht vermerkt:", e && e.message); }   // dann gilt er beim Aufheben als von Hand gesetzt – sicher
    }
    return out;
  }
  /* ---- „Phasen der Folien“ (Nachtrag 34): Rückfall für Präsentationen ohne die unsichtbare Zeile „Unterricks-Phase: n“ (ältere, eigene PowerPoint-Exporte)
   * und zum Korrigieren – je Phase des Schulportal-Eintrags „beginnt bei Folie …“, vorbelegt aus den Phasen der PDF; gespeichert an der Präsentation (hand,
   * gilt vor der PDF). Baut sich nur beim Aufklappen neu (nie unter dem Fokus); Speichern ändert nur Status und Übersicht. ---- */
  const phaseUi = { open: false }, videoUi = { open: false };
  function phasesPanel(p, onSaved) {
    const sum = h("summary"), body = h("div", { class: "stack phasebody" });
    const box = h("details", { class: "box phasebox", id: "phases" }, sum, body);
    box.open = phaseUi.open;
    const paintSum = () => {
      const ph = slidePhasesOf(p), k = ph ? ph.filter((v) => v !== null).length : 0;
      clear(sum).append(h("span", null, "Phasen der Folien", h("span", { class: "muted small", text: " – " + (!ph ? "keine: bitte zuordnen, damit Unterricks den Zwischenstopp einträgt"
        : (p.phases.hand ? "von Ihnen zugeordnet" : "aus der PDF") + ", " + k + " von " + p.pages + " Folien") })));
    };
    const rangeText = (ph) => {
      if (!ph) return "Noch keine Folie ist einer Phase zugeordnet.";
      const parts = [];
      for (let i = 0; i < ph.length;) { let j = i; while (j + 1 < ph.length && ph[j + 1] === ph[i]) j++; parts.push("Folie " + (i === j ? i + 1 : i + 1 + "–" + (j + 1)) + ": " + (ph[i] ? "Phase " + ph[i] : "keine Phase")); i = j + 1; }
      return parts.join(" · ");
    };
    function paint() {
      const heads = portalPhases(portalTA ? portalTA.value : ""), ph = slidePhasesOf(p);
      clear(body).append(h("p", { class: "hint", text: "Zu welcher Phase des Schulportal-Eintrags gehören die Folien? Daraus trägt Unterricks den Zwischenstopp ein, wenn Sie die letzte gezeigte Folie markieren. " +
        "Claude schreibt die Phase laut Präsentations-Prompt unsichtbar auf jede Folie; hier prüfen Sie sie oder legen sie selbst fest – je Phase die Folie, mit der sie beginnt." }));
      if (!heads.length) { body.append(h("p", { class: "small warnc", text: "Im Schulportal-Eintrag stehen noch keine nummerierten Phasen wie „**3) Partnerarbeit**“ – ohne sie gibt es nichts zuzuordnen." })); return; }
      const sels = heads.map((hd) => {
        const first = ph ? ph.indexOf(hd.n) + 1 : 0, id = "phase-" + hd.line;
        const sel = h("select", { id, "data-phase": String(hd.n) }, h("option", { value: "" }, "keine Folie"),
          Array.from({ length: p.pages }, (_, i) => h("option", { value: String(i + 1), selected: first === i + 1 ? true : null }, "Folie " + (i + 1))));
        return { hd, sel, row: h("div", { class: "phaserow" }, h("label", { for: id }, h("span", { class: "ph-n", text: hd.label }), h("span", { class: "muted", text: " – beginnt bei" })), sel) };
      });
      const unknown = ph ? [...new Set(ph.filter((v) => v !== null && !heads.some((hd) => hd.n === v)))] : [];
      const overview = h("p", { class: "small", id: "phase-sum", text: rangeText(ph) });
      const state = h("span", { class: "save-state", role: "status" });
      const err = h("p", { class: "small err hidden", id: "phase-err", role: "alert" });
      const read = () => {
        const starts = sels.map((x) => [x.hd.n, Number(x.sel.value) || 0]).filter((x) => x[1]);
        let last = 0;
        for (const [k, at] of starts) { if (at <= last) return { error: "Die Phase " + k + " beginnt bei Folie " + at + " – das liegt nicht hinter dem Beginn der Phase davor. Bitte wählen Sie die Folien in der Reihenfolge des Schulportal-Eintrags." }; last = at; }
        if (!starts.length) return { list: null };
        return { list: Array.from({ length: p.pages }, (_, i) => { let v = null; for (const [k, at] of starts) if (at <= i + 1) v = k; return v; }) };
      };
      const save = async (btn, hand) => {
        err.classList.add("hidden");
        const had = document.activeElement === btn;
        await busy(btn, async () => {
          try {
            const r = await tapi("PUT", "/api/teacher/files/" + p.id + "/phases", { body: { hand } });
            Object.assign(p, r.file);
            if (st.slides) st.slides.phases = r.file.phases;
            paintSum(); overview.textContent = rangeText(slidePhasesOf(p));
            stateLine(state, hand ? "Gespeichert – Unterricks folgt jetzt Ihrer Zuordnung." : "Gespeichert – es gelten wieder die Phasen aus der PDF.", "ok");
            if (!hand) for (const x of sels) { const f = slidePhasesOf(p); x.sel.value = f && f.indexOf(x.hd.n) >= 0 ? String(f.indexOf(x.hd.n) + 1) : ""; }
            fromPdf.classList.toggle("hidden", !(p.phases && p.phases.hand && p.phases.pdf));
            if (onSaved) onSaved();
          } catch (e) { stateLine(state, "Nicht gespeichert: " + e.message, "err"); }
        }, "Speichert …");
        // der Fokus bleibt beim Knopf; ist er verschwunden („Phasen aus der PDF übernehmen“), geht er zu „Zuordnung speichern“ – nur, wenn er sonst verloren wäre
        if (had && (!document.activeElement || document.activeElement === document.body || document.activeElement === btn)) (btn.classList.contains("hidden") ? saveBtn : btn).focus({ preventScroll: true });
      };
      const saveBtn = h("button", { class: "btn small primary", type: "button" }, "Zuordnung speichern");
      saveBtn.addEventListener("click", () => { const r = read(); if (r.error) { err.textContent = r.error; err.classList.remove("hidden"); return; } save(saveBtn, r.list); });
      const fromPdf = h("button", { class: "btn small ghost" + (p.phases && p.phases.hand && p.phases.pdf ? "" : " hidden"), type: "button" }, "Phasen aus der PDF übernehmen");
      fromPdf.addEventListener("click", () => save(fromPdf, null));
      // nur einmal „Nicht gespeichert“ (die Statuszeile ist live – nicht bei jeder Auswahl erneut ansagen)
      for (const x of sels) x.sel.addEventListener("change", () => { err.classList.add("hidden"); if (state.textContent !== "Nicht gespeichert") stateLine(state, "Nicht gespeichert"); const r = read(); if (!r.error) overview.textContent = rangeText(r.list); });
      body.append(...nn(h("div", { class: "phaserows" }, sels.map((x) => x.row)),
        unknown.length ? h("p", { class: "small warnc", text: "Folien mit " + (unknown.length === 1 ? "der Phase " : "den Phasen ") + unknown.join(", ") + " passen zu keiner Phase des Schulportal-Eintrags." }) : null,
        overview, err, h("div", { class: "row" }, saveBtn, fromPdf, state)));
    }
    paintSum();
    if (box.open) paint();
    // beim Aufklappen neu (der Schulportal-Eintrag kann sich inzwischen geändert haben) – nie, während der Fokus darin steht
    box.addEventListener("toggle", () => { phaseUi.open = box.open; if (box.open && !body.contains(document.activeElement)) paint(); });
    return box;
  }
  // Präsentationsmodus starten – „Ich bin im Unterricht und starte die Präsentation für alle.“ und „Präsentation live starten“ der Ansicht für den Unterricht
  // (Nachtrag 35) sind derselbe Start: neu → Codefolie (0) vor Folie 1; läuft diese Präsentation schon (auch auf einem anderen Gerät), geht es an der laufenden
  // Stelle weiter; „Bis hier gezeigt“ markiert über setShown (samt Zwischenstopp, Nachtrag 34). focusAfter() = wohin der Fokus danach geht, wenn er verloren wäre
  let liveState = null, refreshLive = async () => {};
  async function startLive(focusAfter) {
    const p = curPres(); if (!p) return;
    try {
      const { startPresenter } = await lazy(import("./presenter.js"));
      const running = liveState && liveState.active && liveState.fileId === p.id;
      await startPresenter({ lessonId: id, file: p, token: T.token, slides: st.slides, startSlide: running ? liveState.slide : 0, code: L().code, title: L().title,
        onEnd: () => { const lost = !document.activeElement || document.activeElement === document.body; refreshLive(); paintPres();
          if (lost) { const b = focusAfter ? focusAfter() : presCard.querySelector("button.onair.big"); if (b) b.focus({ preventScroll: true }); } }, shownUntil: shownOf(p), onMark: (n, onStep) => setShown(n >= p.pages ? null : n, onStep) });
    } catch (e) { errToast(e); }
  }
  async function paintPres() { await paintPresCard(); icEmit("files"); }
  async function paintPresCard() {
    const p = st.files.find((f) => f.area === "presentation");
    presPainted = presSig(st.files);
    clear(presCard).append(h("div", { class: "section-title" }, h("h2", { text: "Präsentation für den Unterricht" })));
    const zone = dropZone(p ? "Andere Präsentation hochladen (ersetzt die bisherige)" : "PDF der Präsentation hier ablegen oder auswählen",
      "Nur PDF – Claude liefert die Präsentation laut Prompt direkt als PDF (eigene PowerPoint-Dateien: „Datei → Exportieren → PDF“). Den Sitzungscode zeigt Unterricks live: vor Folie 1 und auf Platzhalterfolien mit der Zeile „Unterricks-Codefolie“. Steht in einer älteren Präsentation noch ein Code auf Folie 1, setzt Unterricks auf den Folien den Code dieser Sitzung ein.", (fs) => uploadPres(fs[0]), "application/pdf,.pdf", false);
    if (!p) { presCard.append(zone); return; }
    if (p.status !== "ready") {
      presCard.append(h("div", { class: "notice warn" }, "Die Folienbilder von „" + p.name + "“ wurden noch nicht vollständig erzeugt. Bitte die PDF erneut hochladen."), zone);
      return;
    }
    if (!st.slides) { try { st.slides = await tapi("GET", "/api/teacher/files/" + p.id + "/slides"); } catch (e) { errToast(e); } }
    // Notizen (nur Lehrkraft) und – trägt die PDF Notizen bzw. Anhänge – die Fassung für Schüler:innen ohne sie (Nachtrag 20)
    const nui = notesUiFor(p);
    const notesBox = notesPanel({ p, slides: st.slides, ui: nui, request: (m, path, o) => tapi(m, path, o), toastErr: errToast,
      onSaved: async (r, say) => {
        Object.assign(p, r.file);
        if (st.slides) { st.slides.notes = r.notes; st.slides.notesRev = r.rev; }
        if (!r.notes.length) { swapAnnotated(p.id, null, r.removed || []); return; }
        await regenAnnotated(p, r.notes, r.rev, say);
      } });
    const cleanBox = p.cleanNeeded && !p.cleanReady ? h("div", { class: "notice warn" },
      h("p", { text: "Diese PDF enthält Notizen bzw. Dateianhänge. Die Fassung ohne sie für Schüler:innen fehlt noch – bis dahin können Schüler:innen die Präsentation nach der Stunde nicht herunterladen (die Folienbilder sind nicht betroffen)." }),
      h("button", { class: "btn small", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try { const { uploadClean } = await lazy(import("./pdfcut.js")); const r = await uploadClean(p, T.token); Object.assign(p, r.file); toast("Die Fassung für Schüler:innen (ohne Notizen) ist gespeichert.", "ok"); paintPres(); }
        catch (err) { errToast(err); }
      }, "Erzeuge …") }, "Fassung für Schüler:innen erzeugen")) : null;
    const shown = shownOf(p), shownState = h("span", { class: "save-state" });
    const applyShown = async (n) => {
      stateLine(shownState, n ? "Kürze die Präsentation …" : "…");
      try {
        const sy = await setShown(n, (m) => stateLine(shownState, m));
        toast((n ? "Schüler:innen sehen nach der Freigabe nur " + slidesUpTo(n) + "." : "Markierung aufgehoben – nach der Freigabe sehen Schüler:innen alle Folien.") + (sy ? " " + sy.text : ""),
          sy && sy.kind === "err" ? "err" : "ok", sy ? 12000 : 6000);
      } catch (e) { errToast(e); }
      paintPres();
    };
    const slideMenu = (x, y, n) => contextMenu(x, y, [
      { label: n === p.pages ? "Letzte Folie: alle Folien freigeben" : "Bis hier gezeigt (Folie " + n + " als letzte gezeigte Folie markieren)", onClick: () => applyShown(n === p.pages ? null : n) },
      ...(shown ? [{ label: "Markierung aufheben (alle Folien)", onClick: () => applyShown(null) }] : [])]);
    const holders = new Set(((st.slides && st.slides.codeSlides) || p.codeSlides || []).map((c) => c.n));   // Platzhalterfolien (live: Codefolie)
    const phases = slidePhasesOf(p);   // Phase je Folie (Nachtrag 34)
    const vidOn = (n) => (holders.has(n) ? null : videoAt(videoSlidesOf(p), n));   // Videofolie (Nachtrag 38) – eine Codefolie zeigt live den Code
    const thumbLabel = (n, ph) => "Folie " + n + (ph && ph[n - 1] ? " (Phase " + ph[n - 1] + ")" : "") + (holders.has(n) ? " – Codefolie: live zeigt Unterricks hier den Sitzungscode" : "") +
      (vidOn(n) ? " – Videofolie: live spielt Unterricks hier das Video „" + videoName(vidOn(n)) + "“ ab" : "") +
      (shown === n ? " – letzte gezeigte Folie" : !!shown && n > shown ? " – für Schüler:innen nicht freigegeben" : "") + ". Kontextmenü: als letzte gezeigte Folie markieren";
    const thumbs = h("div", { class: "thumbs", role: "list", "aria-label": "Folien der Präsentation" }, st.slides ? st.slides.urls.map((u, i) => {
      const n = i + 1, after = !!shown && n > shown;
      return h("figure", { class: "thumb" + (after ? " after" : "") + (shown === n ? " mark" : ""), role: "listitem", tabindex: "0", "data-n": String(n),
        "aria-label": thumbLabel(n, phases),
        oncontextmenu: (e) => { e.preventDefault(); slideMenu(e.clientX, e.clientY, n); },
        onkeydown: (e) => { if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); slideMenu(r.left + 8, r.bottom - 8, n); } } },
        h("img", { src: apiUrl(u), alt: "", loading: "lazy" }), h("figcaption", null, String(n), holders.has(n) ? h("span", { class: "badge", text: "Code" }) : null,
          vidOn(n) ? h("span", { class: "badge video", text: "Video" }) : null, shown === n ? h("span", { class: "badge ink", text: "bis hier" }) : null));
    }) : null);
    const shownSel = h("select", { id: "shown-sel", "aria-describedby": "shown-hint" }, h("option", { value: "" }, "Keine Markierung – nach der Freigabe alle Folien"),
      Array.from({ length: Math.max(0, p.pages - 1) }, (_, i) => h("option", { value: String(i + 1), selected: shown === i + 1 ? true : null }, "Folie " + (i + 1))));
    shownSel.addEventListener("change", () => applyShown(shownSel.value ? Number(shownSel.value) : null));
    const shownHintText = (ph) => "Am Ende der Stunde markieren – hier, per Rechtsklick auf eine Folie oder im Vollbild mit „Bis hier gezeigt“. Schüler:innen bekommen nach der Freigabe nur die Folien bis hier; Folien für die nächste Sitzung oder mit Musterlösungen sehen sie nicht. " +
      (ph ? "Den Zwischenstopp im Schulportal-Eintrag trägt Unterricks dabei selbst ein: vor die erste Phase, die nicht vollständig gezeigt wurde (siehe „Phasen der Folien“)."
        : "Diese Präsentation trägt keine Phasen – den Zwischenstopp im Schulportal-Eintrag setzen Sie deshalb selbst, oder Sie ordnen die Folien unter „Phasen der Folien“ zu.");
    const shownHint = h("p", { class: "hint", id: "shown-hint", text: shownHintText(phases) });
    const syncLine = h("p", { class: "small stopsync", id: "stop-sync" });
    const paintSync = () => { syncLine.classList.toggle("hidden", !stopSync); syncLine.classList.toggle("warnc", !!stopSync && stopSync.kind === "err"); syncLine.textContent = stopSync ? stopSync.text : ""; };
    paintSync();
    const shownBox = h("div", { class: "shownbox" }, h("label", { for: "shown-sel" }, "Letzte im Unterricht gezeigte Folie"), h("div", { class: "row" }, shownSel, shownState),
      shownHint, syncLine);
    // „Phasen der Folien“ gespeichert: Hinweis und Namen der Vorschaubilder an Ort und Stelle angleichen (nichts neu aufbauen – der Fokus bleibt im Feld); ist
    // die letzte gezeigte Folie schon markiert, folgt der Zwischenstopp der neuen Zuordnung (Prüfbefund: die Auswahl derselben Folie löst nichts aus), sonst
    // gilt eine ältere Rückmeldung zum Zwischenstopp nicht mehr
    const phasesBox = phasesPanel(p, () => {
      const ph = slidePhasesOf(p);
      shownHint.textContent = shownHintText(ph);
      for (const fig of thumbs ? thumbs.querySelectorAll("figure.thumb") : []) fig.setAttribute("aria-label", thumbLabel(Number(fig.dataset.n), ph));
      if (!shownOf(p)) { stopSync = null; paintSync(); return; }
      stateLine(shownState, "Zwischenstopp nach der neuen Zuordnung …");
      resyncStop().then((sy) => {
        stateLine(shownState, ""); paintSync();
        if (sy) toast(sy.text, sy.kind === "err" ? "err" : "ok", 12000);
      }, (e) => { stateLine(shownState, ""); errToast(e); });
    });
    // „Videofolien“ (Nachtrag 38): gespeichert → Vorschaubilder (Name und Kennzeichen) an Ort und Stelle angleichen
    const videosBox = videosPanel({ p, ui: videoUi, request: (m, path, o) => tapi(m, path, o), onSaved: (file) => {
      if (st.slides) st.slides.videos = file.videos;
      presPainted = presSig(st.files);
      for (const fig of thumbs ? thumbs.querySelectorAll("figure.thumb") : []) {
        const k = Number(fig.dataset.n), cap = fig.querySelector("figcaption"), had = cap && cap.querySelector(".badge.video");
        fig.setAttribute("aria-label", thumbLabel(k, slidePhasesOf(p)));
        if (vidOn(k) && !had && cap) { const after = cap.querySelector(".badge.ink"); cap.insertBefore(h("span", { class: "badge video", text: "Video" }), after); }
        else if (!vidOn(k) && had) had.remove();
      }
    } });
    paintPresRel();
    const liveLine = h("div", { class: "small" });
    const startBtn = h("button", { class: "btn onair big", type: "button" }, "Ich bin im Unterricht und starte die Präsentation für alle.");
    startBtn.addEventListener("click", () => startLive());
    refreshLive = async () => {
      try {
        const r = await tapi("GET", "/api/teacher/lessons/" + id + "/live"); liveState = r.live;
        clear(liveLine).append(liveState.active ? h("span", null, h("span", { class: "badge onair" }, h("span", { class: "dot" }), "LIVE"), " " + (liveState.view === "code" && (liveState.slide === 0 || liveState.codeShown) ? "Sitzungscode" : "Folie " + liveState.slide + " / " + liveState.pages) + " · " + liveState.students + " verbunden ",
          h("button", { class: "btn small danger", type: "button", onclick: async () => { try { await tapi("POST", "/api/teacher/lessons/" + id + "/live/stop"); refreshLive(); } catch (e) { errToast(e); } } }, "Für alle beenden")) : h("span", { class: "muted", text: "Gerade nicht live." }));
      } catch {}
    };
    refreshLive();
    presCard.append(
      h("div", { class: "item" }, fileIcon(p.name, p.mime), h("div", { class: "main" }, h("div", { class: "name", text: p.name }), h("div", { class: "meta", text: p.pages + " Folien · " + fmtBytes(p.size) })),
        h("div", { class: "acts" }, h("button", { class: "btn small", type: "button", onclick: (e) => viewPdf(e.currentTarget, p) }, "PDF ansehen"),
          h("button", { class: "btn small ghost danger", type: "button", onclick: async () => {
            if (!(await confirmDialog("Präsentation löschen", p.notes ? NOTES_DELETE_TEXT : "Präsentation und Folienbilder löschen? Eine laufende Live-Anzeige endet.", "Löschen", true))) return;
            try { await tapi("DELETE", "/api/teacher/files/" + p.id); st.files = st.files.filter((x) => x !== p); st.slides = null; swapAnnotated(p.id, null); paintPres(); } catch (e) { errToast(e); }
          } }, icon("trash")))),
      ...nn(thumbs, cleanBox, shownBox, phasesBox, videosBox, presRel, notesBox, startBtn, liveLine),
      h("p", { class: "hint", text: "Startet das Vollbild hier und zeigt dieselbe Folie oben in der Schüleransicht aller freigeschalteten Schüler:innen. Beim Start erscheint zuerst die Codefolie mit dem Sitzungscode und dem QR-Code dieser Sitzung; läuft die Präsentation schon, geht es an der laufenden Stelle weiter. „Sitzungscode zeigen“ (Taste C) blendet die Codefolie jederzeit wieder ein. Weiter mit →, Leertaste, Bildtaste (Presenter) oder Tippen; Schüler:innen können nicht selbst blättern. Selbst öffnen können sie die Präsentation erst " + PRESENTATION_AFTER_END_MIN + " Minuten nach dem Ende der Sitzung – bei markierter letzter Folie nur bis dorthin." }),
      h("details", { class: "box" }, h("summary", null, "Andere Präsentation hochladen"), p.notes ? h("p", { class: "hint", text: NOTES_REPLACE_HINT }) : null, zone));
  }
  // „PDF ansehen“: das Fenster direkt im Klick öffnen (sonst blockt Safari es nach der Anfrage) und erst dann zum signierten Link führen –
  // der Link zeigt auf den Worker (apiUrl), nicht auf die Herkunft der Oberfläche (auf GitHub Pages gäbe es sonst 404)
  function viewPdf(btn, p) {
    if (btn.disabled) return;   // läuft schon
    const w = window.open("about:blank", "_blank");
    if (w) { try { w.opener = null; } catch {} }
    busy(btn, async () => {
      try {
        const r = await tapi("POST", "/api/teacher/files/" + p.id + "/link", { body: { inline: true } }), u = apiUrl(r.url);
        if (w && !w.closed) w.location.href = u; else window.open(u, "_blank", "noopener");
      } catch (err) { if (w) w.close(); errToast(err); }
    }, "Öffne …");
  }
  // moreSheetCodes: Feibeitsblätter der Sitzung, aus der eine Sitzungsdatei stammt; notes: Notizen aus der Sitzungsdatei (sonst aus der PDF)
  async function uploadPres(file, moreSheetCodes = [], notes, phases, videos) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { toast("Bitte eine PDF-Datei wählen.", "err"); return; }
    pendingPdf = file;
    clear(presCard).append(h("h2", { text: "Präsentation wird vorbereitet …" }));
    const bar = h("i"), label = h("p", { class: "small", text: "Lade „" + file.name + "“ hoch …" });
    presCard.append(label, h("div", { class: "progress" }, bar));
    try {
      const r = await upload("/api/teacher/lessons/" + id + "/presentation?name=" + encodeURIComponent(file.name), file, T.token, (p) => { bar.style.width = Math.round(p * 30) + "%"; }, "application/pdf");
      const oldPres = st.files.filter((f) => f.area === "presentation").map((f) => f.id);   // samt ihrer Anmerkungs-PDF ersetzt (Server)
      st.files = st.files.filter((f) => f.area !== "presentation" && !oldPres.includes(f.notesOf)); st.files.push(r.file); st.slides = null; stopSync = null; paintFiles();
      const { rasterizeAndUpload } = await lazy(import("./presenter.js"));
      const out = await rasterizeAndUpload(pendingPdf, r.file.id, T.token, (i, n) => { label.textContent = "Erzeuge Folie " + i + " von " + n + " …"; bar.style.width = (30 + Math.round((i / n) * 70)) + "%"; },
        { code: L().code, exclude: [...st.sheets.map((s) => s.code), ...moreSheetCodes], notes, phases, videos });
      Object.assign(r.file, out.file);
      if (out.annotated && out.annotated.file) swapAnnotated(r.file.id, out.annotated.file, out.annotated.removed || []);
      const sw = out.swapped;   // stiller Rückfall: ältere Präsentation mit dem Code einer früheren Sitzung auf den Folien
      const folien = (l) => (l.length === 1 ? "Folie " + l[0] : "den Folien " + l.slice(0, -1).join(", ") + " und " + l[l.length - 1]);
      const holders = (out.codeSlides || []).map((c) => c.n);
      const note = (holders.length ? " Auf " + folien(holders) + " zeigt Unterricks live den Sitzungscode dieser Sitzung (Platzhalterfolie)." : "") +
        (sw ? (sw.slides.length ? " Den Sitzungscode " + formatCode(sw.from) + " einer früheren Sitzung hat Unterricks auf " +
          (sw.slides.length === 1 ? "Folie " + sw.slides[0] : sw.slides.length + " Folien") + " durch den Code dieser Sitzung " + formatCode(sw.to) + " ersetzt." : "") +
          (sw.missed.length ? " Auf " + folien(sw.missed) + " steht noch der alte Sitzungscode " + formatCode(sw.from) + " – dort ließ er sich nicht sicher ersetzen; bitte die Folie ändern oder den Code dieser Sitzung (" + formatCode(sw.to) + ") ansagen." : "") : "");
      // Notizen (Nachtrag 20): „Notizen zu n Folien übernommen“ – bzw. nichts; Probleme ruhig dazu (die Präsentation bleibt nutzbar)
      const nn0 = (out.notes ? " Notizen zu " + out.notes + (out.notes === 1 ? " Folie" : " Folien") + " übernommen." : "") +
        // Phasen der Folien (Nachtrag 34): Claude schreibt sie unsichtbar auf die Folien
        (out.phases ? " Auf " + out.phases + " von " + out.pages + " Folien steht die Phase des Schulportal-Eintrags – den Zwischenstopp trägt Unterricks beim Markieren der letzten gezeigten Folie selbst ein." : "") +
        // Videofolien (Nachtrag 38)
        (out.videos && out.videos.length ? " Auf " + (out.videos.length === 1 ? "Folie " + out.videos[0].n + " spielt Unterricks im Unterricht das Video „" + videoName(out.videos[0]) + "“"
          : "den Folien " + out.videos.map((v) => v.n).join(", ") + " spielt Unterricks im Unterricht die Videos") + " eingebettet ab (siehe „Videofolien“)." : "");
      const extra = (out.notesBad ? " " + NOTES_UNREADABLE : "") + (out.annotated && out.annotated.error ? " Die Anmerkungs-PDF ließ sich nicht erstellen (" + out.annotated.error + ") – speichern Sie die Notizen in der Präsentationskarte erneut." : "") +
        (out.clean && !out.clean.ok ? " Die Fassung ohne Notizen für Schüler:innen ließ sich nicht erzeugen (" + out.clean.error + ") – siehe Hinweis in der Präsentationskarte." : "");
      const bad = (sw && sw.missed.length) || !!extra;
      toast("Präsentation bereit (" + out.pages + " Folien)." + nn0 + note + extra, bad ? "err" : "ok", note || nn0 || extra ? (bad ? 20000 : 12000) : undefined);
    } catch (e) { errToast(e); }
    pendingPdf = null; paintPres();
  }
  paintPres();

  /* ======================= Feibeitsblatt ======================= */
  const fbCard = h("section", { class: "card", id: "fbcard" });
  const fb = T.fb;
  /* ---- Notfall-Feibeitsblätter: je verknüpftem Feibeitsblatt (nicht beim Finale eines Escape-Rooms) das analoge Arbeitsblatt als PDF
   * unter „Material – Für Schüler:innen zugänglich“. Entsteht automatisch, sobald die Verbindung zum Feibeitsblatt besteht (anlegen,
   * verknüpfen, verbinden, Seite öffnen); ändert sich der Stand (Checkliste bestätigt → QR-Code), wird die PDF ersetzt. ---- */
  const notfall = new Map();   // Code → { state: "busy" | "ok" | "err", msg }
  let notfallRun = 0, notfallQueue = Promise.resolve();
  onLeave(() => { notfallRun++; });
  const notfallFile = (code) => st.files.find((f) => f.fbCode === code && f.area !== "archive") || null;
  function ensureNotfall(codes, force = false) {
    if (analog || !fb.connected) return;
    const run = notfallRun;
    for (const code of codes) notfallQueue = notfallQueue.then(() => notfallOne(code, run, force)).catch(() => {});
  }
  async function notfallOne(code, run, force, again = false) {
    const s = st.sheets.find((x) => x.code === code);
    if (!s || s.kind === "escape" || run !== notfallRun || !fb.connected) return;
    const set = (state, msg) => { if (run === notfallRun) { notfall.set(code, { state, msg }); paintFb(); } };
    set("busy", "Notfall-Feibeitsblatt wird geprüft …");
    try {
      const N = await lazy(import("./notfall.js"));
      // dieselbe Sitzung und dasselbe Blatt nur einmal gleichzeitig (das Nachholen für bestehende Sitzungen läuft womöglich gerade)
      const res = await N.notfallOnce(id, code, async () => {
        const info = await N.notfallInfo(fb, code);
        if (info.escape) return { escape: true };
        const have = notfallFile(code);
        if (have && have.fbSig === info.sig && !force) return { file: have };
        if (run !== notfallRun) return {};
        set("busy", "Notfall-Feibeitsblatt wird erstellt …");
        const pdf = await N.buildNotfallPdf(fb, code, info, T.config.feibeitsblattUrl, (m) => set("busy", m));
        if (run !== notfallRun) return {};
        return { file: (await N.uploadNotfall(id, code, info.sig, pdf, T.token)).file };
      });
      if (run !== notfallRun) return;
      if (res.escape) { s.kind = "escape"; notfall.delete(code); paintFb(); return; }
      // auf einen anderen Lauf gewartet (Nachholen im Hintergrund): ohne Ergebnis – oder bei „Erneuern“ mit womöglich älterem Stand – selbst erzeugen
      if (res.joined && (force || !res.file)) { if (!again) return notfallOne(code, run, force, true); if (!res.file) throw new Error("Bitte erneut versuchen."); }
      if (res.file && res.file.id && !st.files.some((f) => f.id === res.file.id)) {
        st.files = st.files.filter((f) => !(f.fbCode === code && f.area !== "archive")).concat(res.file);
        paintFiles();
      }
      set("ok", "");
    } catch (e) { set("err", e && e.message ? e.message : String(e)); }
  }
  function notfallLine(s) {
    if (s.kind === "escape" || analog) return null;
    const st0 = notfall.get(s.code), f = notfallFile(s.code);
    if (st0 && st0.state === "busy") return h("div", { class: "small notfall" }, h("span", { class: "spin", "aria-hidden": "true" }), st0.msg);
    if (st0 && st0.state === "err") return h("div", { class: "small notfall warnc" }, "Notfall-Feibeitsblatt nicht erstellt: " + st0.msg + " ",
      h("button", { class: "btn small", type: "button", onclick: () => ensureNotfall([s.code], true) }, "Erneut versuchen"));
    if (f) return h("div", { class: "small notfall" }, h("span", { class: "ok" }, icon("check"), (f.area === "teacher" ? "Notfall-Feibeitsblatt im Material nur für Lehrkräfte" : "Notfall-Feibeitsblatt im Material für Schüler:innen") + (/-qr/.test(f.fbSig || "") ? " (mit QR-Code zur Checkliste)" : "")),
      fb.connected ? [" ", h("button", { class: "btn small ghost", type: "button", onclick: () => ensureNotfall([s.code], true) }, "Erneuern")] : null);
    return h("div", { class: "small notfall muted", text: fb.connected ? "Notfall-Feibeitsblatt wird gleich erstellt …" : "Das Notfall-Feibeitsblatt entsteht automatisch, sobald Sie mit Feibeitsblatt verbunden sind." });
  }
  const storeLink = () => fbStore(() => askTeacherPassword("Zum Verschlüsseln der Feibeitsblatt-Verbindung braucht dieses Gerät einmal Ihr Unterricks-Passwort. Der Schlüssel entsteht nur in Ihrem Browser; der Server sieht ihn nie."));
  // nach dem Verbinden: die Blätter dieser Sitzung sofort, danach die übrigen Sitzungen im Hintergrund (notfallBackfill, teacher.js)
  const afterConnect = () => { paintFb(); if (fb.connected) { ensureNotfall(st.sheets.map((x) => x.code)); notfallBackfill({ retry: true }); } };
  function fbConnectUi(lk) {
    const door = h("input", { inputmode: "numeric", autocomplete: "off", placeholder: "Türcode", "aria-label": "Türcode des Feibeitsblatts", style: { maxWidth: "9rem" } });
    const pw = h("input", { type: "password", autocomplete: "off", placeholder: "Feibeitsblatt-Passwort", "aria-label": "Feibeitsblatt-Passwort" });
    const btn = h("button", { class: "btn primary", type: "submit" }, "Verbinden");
    const save = h("input", { type: "checkbox", checked: true, "aria-describedby": "fbsave-hint" });
    const form = h("form", { class: "stack", onsubmit: (e) => { e.preventDefault(); busy(btn, async () => {
      try {
        await fb.connect(door.value, pw.value);
        let saved = false;
        if (save.checked) { try { saved = await storeLink(); } catch (err) { errToast(err); } }
        toast(saved ? "Mit Feibeitsblatt verbunden – die Verbindung ist verschlüsselt in Ihrem Benutzerkonto gespeichert." : "Mit Feibeitsblatt verbunden.", "ok", 6000);
        afterConnect();
      } catch (err) { errToast(err); }
    }, "Verbinde …"); } },
      h("div", { class: "row" }, door, h("div", { class: "grow" }, pw), btn),
      h("label", { class: "checkrow small" }, save, h("span", { text: lk.state === "none" ? "Verbindung verschlüsselt in meinem Benutzerkonto speichern – dann muss ich sie nicht erneut eingeben" : "Gespeicherte Verbindung durch diese ersetzen" })),
      h("p", { class: "hint", id: "fbsave-hint", text: "Nötig zum Anlegen von Feibeitsblättern und zum Lesen der verschlüsselten Abgaben. Das Feibeitsblatt-Passwort verlässt Ihren Browser nie. Gespeichert wird – wenn Sie es wünschen – nur der daraus abgeleitete Schlüssel, verschlüsselt mit einem Schlüssel aus Ihrem Unterricks-Passwort, den der Server nie sieht." }));
    if (lk.state === "locked") {
      const upw = h("input", { type: "password", autocomplete: "current-password", placeholder: "Unterricks-Passwort", "aria-label": "Ihr Unterricks-Passwort" });
      const ubtn = h("button", { class: "btn primary", type: "submit" }, "Entsperren"), umsg = h("p", { class: "err", role: "alert" });
      return [h("div", { class: "notice" }, "Ihre Feibeitsblatt-Verbindung ist verschlüsselt in Ihrem Benutzerkonto gespeichert. Entsperren Sie sie auf diesem Gerät einmal mit Ihrem Unterricks-Passwort – danach verbindet sich Unterricks hier automatisch."),
        h("form", { class: "row", onsubmit: (e) => { e.preventDefault(); umsg.textContent = ""; busy(ubtn, async () => {
          try { await fbUnlock(upw.value); } catch (err) { umsg.textContent = err.message; return; }
          await fbAutoConnect(true); if (fb.connected) toast("Mit Feibeitsblatt verbunden.", "ok"); afterConnect();
        }, "Entsperre …"); } }, h("div", { class: "grow" }, upw), ubtn), umsg,
        h("details", { class: "box" }, h("summary", null, "Stattdessen mit Türcode und Feibeitsblatt-Passwort verbinden"), form)];
    }
    const note = lk.state === "invalid" ? h("div", { class: "notice warn" }, lk.other ? "Die gespeicherte Verbindung gehört zu einem anderen Feibeitsblatt. Bitte verbinden Sie sich neu; die gespeicherte Verbindung wird dabei ersetzt."
      : "Die gespeicherte Feibeitsblatt-Verbindung gilt nicht mehr – vermutlich wurde das Feibeitsblatt-Passwort geändert. Bitte verbinden Sie sich neu; die gespeicherte Verbindung wird dabei ersetzt.")
      : lk.state === "error" ? h("div", { class: "notice warn" }, "Die gespeicherte Verbindung ließ sich gerade nicht herstellen: " + (lk.msg || "") + " ",
        h("button", { class: "btn small", type: "button", onclick: () => { fbAutoConnect(true).then(afterConnect); paintFb(); } }, "Erneut versuchen")) : null;
    return [note, form].filter(Boolean);
  }
  async function paintFb() {
    if (analog) {
      clear(fbCard).append(...nn(h("h2", { text: "Feibeitsblatt" }), h("div", { class: "notice" }, "Jahrgang " + gradeKey(L().klass) + ": " + ANALOG_RULE),
        st.sheets.length ? h("p", { class: "small", text: "Verknüpfte Feibeitsblätter: " + st.sheets.map((x) => x.title + " (" + formatCode(x.code) + ")").join(", ") }) : null));
      icEmit("files");
      return;
    }
    const lk = T.fbLink, checking = !fb.connected && lk.state === "checking";
    clear(fbCard).append(h("div", { class: "section-title" }, h("h2", { text: "Feibeitsblatt" }), fb.connected ? h("span", { class: "badge ok", text: "verbunden" }) : h("span", { class: "badge", text: checking ? "verbinde …" : "nicht verbunden" })));
    // Verbindung (einmalig eingeben; auf Wunsch Ende-zu-Ende verschlüsselt im Benutzerkonto gespeichert, siehe fblink.js)
    if (checking) fbCard.append(h("p", { class: "small notfall" }, h("span", { class: "spin", "aria-hidden": "true" }), "Verbinde mit der gespeicherten Feibeitsblatt-Verbindung …"));
    else if (!fb.connected) fbCard.append(...fbConnectUi(lk));
    else {
      const set = h("div", { class: "small muted", text: "Lade Einstellungen …" });
      const linkRow = lk.state === "saved"
        ? h("div", { class: "row small fblink" }, h("span", { class: "ok" }, icon("check"), "Verbindung verschlüsselt in Ihrem Benutzerkonto gespeichert – Unterricks verbindet sich automatisch."),
          h("button", { class: "btn small ghost danger", type: "button", onclick: async (e) => {
            const btn = e.currentTarget;   // nach einem await ist currentTarget leer
            if (!(await confirmDialog("Gespeicherte Verbindung löschen", "Danach müssen Sie Türcode und Feibeitsblatt-Passwort wieder eingeben – auf allen Geräten.", "Löschen", true))) return;
            await busy(btn, async () => { try { await fbForget(); toast("Gespeicherte Feibeitsblatt-Verbindung gelöscht.", "ok"); paintFb(); } catch (err) { errToast(err); } });
          } }, "Gespeicherte Verbindung löschen"))
        : h("div", { class: "row small fblink" }, h("span", { class: "muted", text: "Die Verbindung gilt nur in diesem Fenster." }),
          h("button", { class: "btn small", type: "button", onclick: (e) => busy(e.currentTarget, async () => { try { if (await storeLink()) { toast("Die Verbindung ist verschlüsselt in Ihrem Benutzerkonto gespeichert.", "ok"); paintFb(); } } catch (err) { errToast(err); } }) }, "Verbindung speichern"),
          h("button", { class: "btn small ghost", type: "button", onclick: () => { fb.disconnect(); paintFb(); } }, "Verbindung trennen"));
      fbCard.append(set, linkRow);
      fb.aiStatus().then((ai) => {
        const sel = h("select", { style: { width: "auto" }, "aria-label": "Wartezeit auf die finale KI-Rückmeldung" }, [30, 60, 90].map((s) => h("option", { value: s, selected: ai.finalWaitSec === s ? true : null }, s + " Sekunden")));
        sel.addEventListener("change", async () => { try { await fb.setFinalWait(Number(sel.value)); toast("Wartezeit gespeichert.", "ok"); } catch (e) { errToast(e); } });
        clear(set).append(h("div", null, "KI-Rückmeldungen im Feibeitsblatt: ", h("strong", { text: (ai.label || ai.provider || "–") + (ai.model ? " (" + ai.model + ")" : "") }), " – ", ai.ready ? h("span", { class: "ok", text: "bereit" }) : h("span", { class: "err", text: "nicht eingerichtet" }),
          " · ", h("a", { href: T.config.feibeitsblattUrl, target: "_blank", rel: "noopener" }, "im Feibeitsblatt ändern")), h("div", { class: "row" }, "Wartezeit auf die finale KI-Rückmeldung nach der Abgabe: ", sel));
      }).catch((e) => { set.textContent = e.message; });
    }
    // Blätter der Sitzung
    const sheetList = h("div", { class: "list" });
    if (!st.sheets.length) sheetList.append(h("p", { class: "muted small", text: "Noch kein Feibeitsblatt in dieser Sitzung." }));
    for (const s of st.sheets) sheetList.append(h("div", { class: "item" }, h("div", { class: "ficon fb", "aria-hidden": "true", text: "FB" }),
      h("div", { class: "main" }, h("div", { class: "name", text: s.title }), notfallLine(s), h("div", { class: "meta" }, "Code ", h("strong", { class: "mono", text: formatCode(s.code) }), s.kind === "escape" ? " · Finale des Escape-Rooms (Schüler:innen gelangen über den Tunnel dorthin)" : " · für Schüler:innen sichtbar")),
      h("div", { class: "acts" }, h("button", { class: "btn small primary", type: "button", disabled: fb.connected ? null : true, title: fb.connected ? "" : "Erst verbinden", onclick: () => showSubmissions(s) }, "Abgaben ansehen"),
        h("button", { class: "btn small", type: "button", onclick: async () => toast((await copyText(formatCode(s.code))) ? "Code kopiert." : "Kopieren nicht möglich.", "ok") }, "Code kopieren"),
        h("button", { class: "btn small ghost danger", type: "button", "aria-label": "Aus der Sitzung entfernen", onclick: async () => {
          if (!(await confirmDialog("Feibeitsblatt entfernen", "„" + s.title + "“ aus dieser Sitzung entfernen? Das Blatt selbst bleibt im Feibeitsblatt erhalten; sein Notfall-Feibeitsblatt verschwindet aus dem Material.", "Entfernen", true))) return;
          try { await tapi("DELETE", "/api/teacher/lessons/" + id + "/sheets/" + s.code); st.sheets = st.sheets.filter((x) => x !== s); st.files = st.files.filter((f) => !(f.fbCode === s.code && f.area !== "archive")); notfall.delete(s.code); paintFb(); paintFiles(); } catch (e) { errToast(e); }
        } }, icon("trash")))));
    // vorhandenes Blatt verknüpfen
    const linkBox = h("details", { class: "box" }, h("summary", null, "Vorhandenes Feibeitsblatt verknüpfen"));
    linkBox.addEventListener("toggle", async () => {
      if (!linkBox.open || linkBox.dataset.ready) return; linkBox.dataset.ready = "1";
      const code = h("input", { placeholder: "Code, z. B. AEH-4VY", style: { maxWidth: "12rem" } }), title = h("input", { placeholder: "Titel" });
      const sel = h("select", { style: { display: "none" } });
      if (fb.connected) {
        try {
          const r = await fb.listSheets();
          sel.style.display = ""; sel.append(h("option", { value: "" }, "– aus Ihren Feibeitsblättern wählen –"), ...r.sheets.map((s) => h("option", { value: s.code }, s.title + " (" + formatCode(s.code) + ", " + s.submissionCount + " Abgaben)")));
          sel.addEventListener("change", () => { const s = r.sheets.find((x) => x.code === sel.value); if (s) { code.value = formatCode(s.code); title.value = s.title; } });
        } catch (e) { errToast(e); }
      }
      linkBox.append(h("div", { class: "stack", style: { marginTop: ".6rem" } }, sel, h("div", { class: "row" }, code, h("div", { class: "grow" }, title),
        h("button", { class: "btn primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => { try { const r = await tapi("POST", "/api/teacher/lessons/" + id + "/sheets", { body: { code: code.value, title: title.value } }); st.sheets = st.sheets.filter((x) => x.code !== r.sheet.code).concat(r.sheet); paintFb(); ensureNotfall([r.sheet.code]); } catch (err) { errToast(err); } }) }, "Verknüpfen"))));
    });
    // Entwürfe
    const drafts = st.drafts.filter((x) => x.status === "draft" && x.data && x.source !== "vertretung");
    const draftList = h("div", { class: "list" });
    for (const dr of drafts) draftList.append(h("div", { class: "item" }, h("div", { class: "main" }, h("div", { class: "name", text: dr.data.title }),
      h("div", { class: "meta", text: dr.data.tasks.length + " Aufgabe" + (dr.data.tasks.length === 1 ? "" : "n") + " · Entwurf " + (dr.source === "claude" ? "von Claude" : "aus dem Chat") + " · " + fmtTime(dr.updatedAt) })),
      h("div", { class: "acts" }, h("button", { class: "btn small primary", type: "button", onclick: () => editDraft(dr) }, "Prüfen und anlegen"),
        h("button", { class: "btn small ghost danger", type: "button", "aria-label": "Entwurf verwerfen", onclick: async () => {
          if (!(await confirmDialog("Entwurf verwerfen", "Diesen Entwurf löschen?", "Verwerfen", true))) return;
          try { await tapi("DELETE", "/api/teacher/fb-drafts/" + dr.id); st.drafts = st.drafts.filter((x) => x !== dr); paintFb(); } catch (e) { errToast(e); }
        } }, icon("trash")))));
    const wish = h("input", { placeholder: "Optional: Wunsch, z. B. „3 Aufgaben zur Analyse der Karikatur“" });
    const genBtn = h("button", { class: "btn", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
      await flushPortal();
      try { const r = await tapi("POST", "/api/teacher/lessons/" + id + "/fb-drafts/generate", { body: { wish: wish.value } }); st.drafts.unshift(r.draft); paintFb(); editDraft(r.draft); } catch (err) { errToast(err); }
    }, "Die KI entwirft …") }, "Feibeitsblatt-Entwurf aus dem Chat");
    fbCard.append(...nn(h("h3", { style: { marginTop: "1rem" }, text: "Feibeitsblätter dieser Sitzung" }), sheetList,
      st.sheets.some((x) => x.kind !== "escape") ? h("p", { class: "hint", text: "Zu jedem Feibeitsblatt legt Unterricks automatisch das Notfall-Feibeitsblatt – das analoge Arbeitsblatt als PDF, wie im Feibeitsblatt – unter „Material – Für Schüler:innen zugänglich“ ab (nicht beim Finale eines Escape-Rooms)." }) : null,
      linkBox,
      h("h3", { style: { marginTop: "1rem" }, text: "Entwürfe" }), drafts.length ? draftList : h("p", { class: "muted small", text: "Keine offenen Entwürfe. Die KI schlägt in der Planung bei passender Gelegenheit ein Feibeitsblatt vor; den Entwurf erzeugen Sie hier." }),
      h("div", { class: "row" }, h("div", { class: "grow" }, wish), genBtn)));
    icEmit("files");   // Feibeitsblätter der Sitzung (Ansicht für den Unterricht)
  }

  // Links, die im Feibeitsblatt anklickbar werden (Nr. 17): Vorschau unter dem Feld, zum Prüfen in neuem Tab (wie bei den Schüler:innen)
  function linkPreview(runsOf) {
    const box = h("p", { class: "hint fblinks hidden" });
    const paint = () => {
      const links = fbLinksOf(runsOf());
      clear(box).classList.toggle("hidden", !links.length);
      if (links.length) box.append("Im Feibeitsblatt anklickbar: ", ...links.flatMap((l, k) => [k ? " · " : "",
        h("a", { href: l.h, target: "_blank", rel: "noopener noreferrer", title: l.h }, l.t, h("span", { class: "sr-only", text: " (öffnet in neuem Tab)" }))]));
    };
    paint();
    return { box, paint };
  }

  function editDraft(dr, opt = {}) {
    const data = JSON.parse(JSON.stringify(dr.data));
    // jeder Auftrag an die KI bekommt sichtbar die altersgemäße Erwartung der Lerngruppe (das Feibeitsblatt kennt den Jahrgang nicht)
    for (const t of data.tasks) if (!(t.answer && t.answer.type === "photo")) t.solution = withAgeExpectation(t.solution, L().klass);
    const title = h("input", { value: data.title, maxlength: "200" });
    const tasksBox = h("div");
    // Bilder, PDF-Dateien und YouTube-Videos einer Aufgabe (Nachtrag 37, von Claude über den Connector): prüfen, Anzeige und Beschreibung ändern, entfernen
    const mstat = h("p", { class: "small muted fbm-status", role: "status" });
    const prevUrls = new Map();   // Vorschau der Bilder: signierter Link je Datei, nur solange der Dialog offen ist
    const preview = (f, img) => {
      if (!f || problemOf("image", f)) return;
      const got = prevUrls.get(f.id);
      const p = got || tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: { inline: true } }).then((r) => apiUrl(r.url));
      if (!got) prevUrls.set(f.id, p);
      p.then((u) => { img.src = u; }).catch(() => { prevUrls.delete(f.id); });
    };
    const fileOfId = (fid) => st.files.find((f) => f.id === fid) || null;
    function mediaField(t, i) {
      const n = i + 1, rows = [];
      const drop = (key, k, what) => h("button", { class: "btn small ghost", type: "button", "aria-label": what + " aus Aufgabe " + n + " entfernen", onclick: () => {
        t[key].splice(k, 1);
        if (!t[key].length) delete t[key];
        paintTasks();
        // Fokus: das nächste „Entfernen“ derselben Aufgabe, sonst ihr Materialfeld (nie verloren)
        const ed = tasksBox.querySelectorAll(".task-edit")[i], next = ed && (ed.querySelectorAll(".fbmedia button")[k] || [...ed.querySelectorAll(".fbmedia button")].pop());
        (next || (ed && ed.querySelectorAll("textarea")[1]) || tasksBox).focus({ preventScroll: true });
      } }, "Entfernen");
      // Dateien aus „Nur für die Lehrkraft“ (Entscheidung der Lehrkraft: erlaubt, mit Hinweis) – im Feibeitsblatt sehen sie alle mit dem Code
      const warn = (f) => (f && f.area === "teacher" ? h("p", { class: "small warnc", text: "Liegt bei „Nur für die Lehrkraft“ – im Feibeitsblatt sehen alle Schüler:innen mit dem Code diese Datei. Bitte prüfen, dass sie keine Lösung enthält." }) : null);
      (t.images || []).forEach((m, k) => {
        const f = fileOfId(m.file), prob = problemOf("image", f), name = f ? f.name : "Bild";
        const img = h("img", { class: "fbm-prev", alt: "", width: "64", height: "64" });
        preview(f, img);
        const mode = h("select", { "aria-label": "Anzeige von „" + name + "“", onchange: (e) => { m.mode = e.target.value === "thumb" ? "thumb" : "inline"; } },
          h("option", { value: "inline", selected: m.mode !== "thumb" ? true : null }, "groß unter der Aufgabenstellung"),
          h("option", { value: "thumb", selected: m.mode === "thumb" ? true : null }, "klein rechts daneben (Klick vergrößert)"));
        const alt = h("input", { value: m.alt || "", maxlength: "200", placeholder: "Bildbeschreibung (wird vorgelesen)", "aria-label": "Bildbeschreibung von „" + name + "“", oninput: (e) => { m.alt = e.target.value; } });
        rows.push(h("li", { class: "fbm-item" + (prob ? " bad" : "") }, img, h("div", { class: "main" }, h("div", { class: "name", text: name }),
          h("div", { class: "fbm-row" }, h("span", { class: "small muted", text: "Bild ·" }), mode), alt, warn(f), prob ? h("p", { class: "small err", text: prob }) : null), drop("images", k, "Bild „" + name + "“")));
      });
      (t.files || []).forEach((m, k) => {
        const f = fileOfId(m.file), prob = problemOf("file", f), name = f ? f.name : "PDF-Datei";
        rows.push(h("li", { class: "fbm-item" + (prob ? " bad" : "") }, fileIcon(name, "application/pdf", "file"), h("div", { class: "main" }, h("div", { class: "name", text: name }),
          h("div", { class: "small muted", text: "PDF-Datei zum Herunterladen" + (f && f.size ? " · " + fmtBytes(f.size) : "") }), warn(f), prob ? h("p", { class: "small err", text: prob }) : null), drop("files", k, "PDF-Datei „" + name + "“")));
      });
      (t.videos || []).forEach((v, k) => {
        const name = v.title || "YouTube-Video " + (k + 1);
        rows.push(h("li", { class: "fbm-item" }, h("span", { class: "fbm-yt", "aria-hidden": "true", text: "▶" }), h("div", { class: "main" }, h("div", { class: "name", text: name }),
          h("div", { class: "small muted" }, "YouTube-Video" + (v.start ? " ab " + fmtVideoStart(v.start) : "") + " · ",
            h("a", { href: youtubeUrl(v), target: "_blank", rel: "noopener noreferrer" }, "ansehen", h("span", { class: "sr-only", text: " (öffnet in neuem Tab)" })))), drop("videos", k, "Video „" + name + "“")));
      });
      if (!rows.length) return null;
      return h("fieldset", { class: "field fbmedia" }, h("legend", { text: "Bilder, PDF-Dateien und Videos" }), h("ul", { class: "fbm-list" }, ...rows),
        h("p", { class: "hint", text: "Beim Anlegen überträgt Unterricks die Bilder (verkleinert) und PDF-Dateien ins Feibeitsblatt; dort sehen sie alle Schüler:innen mit dem Code. YouTube-Videos lädt das Feibeitsblatt erst, wenn die Schüler:innen darauf tippen." }));
    }
    const paintTasks = () => {
      clear(tasksBox);
      data.tasks.forEach((t, i) => {
        const textLinks = linkPreview(() => taskTextFmt(t.text) || []), matLinks = linkPreview(() => materialRuns(t.material || ""));
        const text = h("textarea", { rows: "3", value: t.text, oninput: (e) => { t.text = e.target.value; textLinks.paint(); } });
        const mat = h("textarea", { rows: "3", value: t.material || "", "aria-describedby": "fbmat-hint-" + i, oninput: (e) => { t.material = e.target.value; matLinks.paint(); } });
        const solWarn = h("p", { class: "small warnc" + (looksLikeSolution(t.solution) ? "" : " hidden"), role: "status", text: "Das sieht nach einer Musterlösung aus. Formulieren Sie bitte einen Auftrag an die KI, z. B. „Achte darauf, ob die Antwort … enthält.“ – die KI soll beraten, nicht abgleichen." });
        const sol = h("textarea", { rows: "6", value: t.solution || "", oninput: (e) => { t.solution = e.target.value; solWarn.classList.toggle("hidden", !looksLikeSolution(t.solution)); } });
        const typ = h("select", { style: { width: "auto" } }, h("option", { value: "text", selected: t.answer.type === "text" ? true : null }, "Textfeld"), h("option", { value: "table", selected: t.answer.type === "table" ? true : null }, "Tabelle"),
          h("option", { value: "photo", selected: t.answer.type === "photo" ? true : null }, "Foto (z. B. eines Lernprodukts)"));
        const cols = h("input", { value: (t.answer.columns || []).join(", "), placeholder: "Spalten, durch Komma getrennt" });
        const rows = h("input", { type: "number", min: "1", max: "30", value: t.answer.rows || 3, style: { maxWidth: "6rem" } });
        const tableBox = h("div", { class: "row" + (t.answer.type === "table" ? "" : " hidden") }, h("div", { class: "grow" }, cols), h("span", { class: "small", text: "Zeilen:" }), rows);
        const solBox = h("div");
        const syncAns = () => { t.answer = typ.value === "table" ? { type: "table", columns: cols.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8), rows: Math.min(30, Math.max(1, Number(rows.value) || 3)) } : { type: typ.value === "photo" ? "photo" : "text" };
          tableBox.classList.toggle("hidden", typ.value !== "table"); solBox.classList.toggle("hidden", typ.value === "photo");
          if (typ.value === "photo" && data.tasks.filter((x) => x.answer && x.answer.type === "photo").length > PHOTO_TASKS_MAX) toast("Höchstens " + PHOTO_TASKS_MAX + " Foto-Aufgaben je Feibeitsblatt.", "err"); };
        typ.onchange = syncAns; cols.oninput = syncAns; rows.oninput = syncAns;
        tasksBox.append(h("div", { class: "task-edit" },
          h("div", { class: "row between" }, h("strong", { text: "Aufgabe " + (i + 1) }), h("div", { class: "row" },
            h("button", { class: "btn small ghost iconbtn", type: "button", "aria-label": "Aufgabe " + (i + 1) + " nach oben", disabled: i === 0 ? true : null, onclick: () => { data.tasks.splice(i - 1, 0, data.tasks.splice(i, 1)[0]); paintTasks(); } }, icon("up")),
            h("button", { class: "btn small ghost iconbtn", type: "button", "aria-label": "Aufgabe " + (i + 1) + " nach unten", disabled: i === data.tasks.length - 1 ? true : null, onclick: () => { data.tasks.splice(i + 1, 0, data.tasks.splice(i, 1)[0]); paintTasks(); } }, icon("down")),
            h("button", { class: "btn small ghost danger", type: "button", disabled: data.tasks.length === 1 ? true : null, onclick: () => { data.tasks.splice(i, 1); paintTasks(); } }, "Entfernen"))),
          h("div", { class: "field" }, h("label", null, "Aufgabenstellung"), text, textLinks.box),
          h("div", { class: "field" }, h("label", null, "Material (optional, Text)"), mat,
            h("p", { class: "hint", id: "fbmat-hint-" + i, text: "**fett** wird fett. Links zu anderen Internetseiten als [Linktext](https://…) oder vollständige Adresse (https://…) – im Feibeitsblatt werden sie anklickbar und öffnen sich in einem neuen Tab (auch in der Aufgabenstellung)." }),
            matLinks.box),
          mediaField(t, i),
          solBox,
          h("div", { class: "row" }, h("span", { class: "small", text: "Antwort als:" }), typ), tableBox,
          h("p", { class: "hint" + (t.answer.type === "photo" ? "" : " hidden"), text: "Foto: Die Schüler:innen fotografieren z. B. ihr Lernprodukt und laden das Bild hoch (verkleinert, ohne Ortsdaten, verschlüsselt). Fotos gehen nie an die KI – deshalb gibt es hier keinen Auftrag an die KI." })));
        solBox.append(h("div", { class: "field" }, h("label", null, "Auftrag an die KI (Einstellung der KI-Rückmeldung)"), sol, solWarn,
          h("p", { class: "hint", text: "Keine Musterlösung, sondern ein Auftrag an die korrigierende KI: Worauf soll sie achten, wenn sie die Antwort liest? Erwartete Inhalte, Kriterien, typische Fehler, " +
            "worauf es nicht ankommt – ihre Rückmeldung zeigt den Schüler:innen, was schon gut ist und was sie verbessern können (vor der Abgabe verrät sie die Lösung nicht). " +
            "Der letzte Absatz „Altersgemäße Erwartung“ passt das Anspruchsniveau an " + (gradeInfo(L().klass).stufe ? "die Lerngruppe (" + classShort(L().klass) + ")" : "die Lerngruppe") +
            " an, ohne zusätzliche Anforderungen; Sie können ihn ändern – fehlt er beim Anlegen, ergänzt Unterricks ihn. Leer (oder nur dieser Absatz) = kein KI-Feedback zu dieser Aufgabe." })));
        solBox.classList.toggle("hidden", t.answer.type === "photo");
        typ.addEventListener("change", () => { const hint = solBox.parentNode && solBox.parentNode.querySelector(":scope > p.hint:last-child"); if (hint) hint.classList.toggle("hidden", typ.value !== "photo"); });
      });
    };
    paintTasks();
    const save = async () => {
      data.title = title.value;
      const r = await tapi("PUT", "/api/teacher/fb-drafts/" + dr.id, { body: { data } });
      Object.assign(dr, r.draft); return r.draft;
    };
    modal({ title: "Feibeitsblatt prüfen und anlegen", wide: true, onClose: opt.onClose, body: (el) => el.append(...nn(
      fb.connected ? null : h("div", { class: "notice warn" }, "Zum Anlegen bitte zuerst im Abschnitt „Feibeitsblatt“ verbinden (Türcode und Passwort). Speichern geht auch ohne."),
      h("div", { class: "field", style: { marginTop: ".6rem" } }, h("label", null, "Titel"), title), tasksBox, mstat,
      h("button", { class: "btn small", type: "button", style: { marginTop: ".7rem" }, onclick: () => { data.tasks.push({ text: "", material: "", solution: "", answer: { type: "text" } }); paintTasks(); } }, "+ Aufgabe"))),
      actions: [
        { label: "Schließen" },
        { label: "Entwurf speichern", onClick: async () => { try { await save(); paintFb(); if (opt.onSaved) opt.onSaved(); toast("Entwurf gespeichert.", "ok"); } catch (e) { errToast(e); return false; } } },
        { label: "Feibeitsblatt jetzt anlegen", class: "primary", onClick: async (e) => {
          if (!fb.connected) { toast("Bitte zuerst mit Feibeitsblatt verbinden.", "err"); return false; }
          // Bilder und PDF-Dateien (Nachtrag 37): was so nicht geht, verhindert das Anlegen – nie ein Blatt mit stillschweigend fehlendem Material
          const bad = mediaItems(data.tasks, st.files).filter((x) => x.problem);
          if (bad.length) { toast("Vor dem Anlegen bitte prüfen: " + bad.map((x) => "„" + itemName(x) + "“ (Aufgabe " + x.task + "): " + x.problem).join(" "), "err", 12000); return false; }
          if (!(await confirmDialog("Feibeitsblatt anlegen", "Das Blatt wird jetzt im Feibeitsblatt angelegt und erhält einen Code. Feibeitsblätter lassen sich danach nicht mehr ändern (nur neu anlegen).", "Anlegen"))) return false;
          const step = (m) => { mstat.textContent = m; };
          try {
            const d2 = await save();
            // erst alles vorbereiten (Bytes holen, Bilder verkleinern, PDF prüfen): ein Fehler hier legt noch kein Blatt an
            const items = mediaItems(d2.data.tasks, st.files);
            const prepared = items.length ? await prepareMedia(items, { blobOf: fileBlob, onStep: step }) : [];
            if (items.length) step("Lege das Feibeitsblatt an …");
            const r = await fb.createSheet(d2.data, { klass: L().klass });
            await tapi("POST", "/api/teacher/fb-drafts/" + dr.id + "/created", { body: { code: r.code, title: r.title } });
            dr.status = "created"; dr.sheetCode = r.code; st.sheets.push({ code: r.code, title: r.title, createdAt: Date.now() }); paintFb();
            if (opt.onCreated) opt.onCreated(r);
            const up = prepared.length ? await uploadMedia(fb, r.code, prepared, { onStep: step }) : { done: 0, failed: [] };
            step("");
            ensureNotfall([r.code]);   // nach dem Übertragen: das Notfall-Feibeitsblatt zeigt die Bilder und QR-Codes der Videos
            afterCreate(r, { prepared, up, videos: d2.data.tasks.reduce((x, t) => x + (t.videos || []).length, 0) });
          } catch (err) { step(""); errToast(err); return false; }
        } },
      ] });
  }

  // Geführter Abschluss: optional KI-Checkliste vorschlagen lassen und bestätigen
  // Datei der Sitzung als Blob (signierter Link wie beim Herunterladen) – für das Übertragen ins Feibeitsblatt (Nachtrag 37)
  async function fileBlob(f) {
    const l = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: {} });
    const res = await fetch(apiUrl(l.url), { credentials: "omit", cache: "no-store" });
    if (!res.ok) throw new Error("„" + f.name + "“ ließ sich nicht laden (Fehler " + res.status + ").");
    return res.blob();
  }
  // Stand der Bilder, PDF-Dateien und Videos nach dem Anlegen (Nachtrag 37): alles übertragen bzw. was fehlt, mit „Erneut versuchen“
  function mediaResult(r, media) {
    const box = h("div", { role: "status" });
    if (!media || (!media.prepared.length && !media.videos)) return box;
    const count = (n, one, many) => n + " " + (n === 1 ? one : many);
    const paint = () => {
      const failed = media.up.failed, imgs = media.prepared.filter((x) => x.kind === "image").length, pdfs = media.prepared.length - imgs;
      const sent = [imgs && count(imgs, "Bild", "Bilder"), pdfs && count(pdfs, "PDF-Datei", "PDF-Dateien"), media.videos && count(media.videos, "YouTube-Video", "YouTube-Videos")].filter(Boolean).join(", ");
      const noVideos = media.videos && typeof r.videoCount === "number" && r.videoCount < media.videos;
      clear(box).className = "notice" + (failed.length || noVideos ? " warn" : "");
      // „Nicht übertragen: „Bild.png“ (Aufgabe 1): Grund.“ – je Datei ein Satzteil, „Alles andere …“ nur, wenn es noch anderes Material gibt
      const others = media.prepared.length - failed.length + (media.videos || 0);
      box.append(h("p", { text: failed.length ? "Nicht übertragen: " + failed.map((f) => "„" + f.item.file.name + "“ (Aufgabe " + f.item.task + "): " + String(f.error).replace(/[.\s]+$/, "")).join("; ") + "." +
        (others ? " Alles andere ist im Feibeitsblatt." : "") : "Material im Feibeitsblatt: " + sent + "." }));
      if (noVideos) box.append(h("p", { text: "Ihr Feibeitsblatt hat die YouTube-Videos nicht übernommen – vermutlich eine ältere Version des Feibeitsblatts. Die Videos fehlen im Blatt." }));
      if (failed.length) box.append(h("button", { class: "btn small", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        const again = await uploadMedia(fb, r.code, failed.map((f) => f.item));
        media.up = { done: media.up.done + again.done, failed: again.failed };
        paint();
        // der Knopf wird neu gebaut bzw. fällt weg: Fokus auf den neuen Knopf bzw. die Meldung (nie verloren)
        if (again.failed.length) { const b = box.querySelector("button"); if (b) b.focus({ preventScroll: true }); }
        else { ensureNotfall([r.code], true); box.setAttribute("tabindex", "-1"); box.focus({ preventScroll: true }); }
      }) }, "Erneut versuchen"));
    };
    paint();
    return box;
  }
  function afterCreate(r, media = null) {
    modal({ title: "Feibeitsblatt angelegt", wide: true, body: (el) => {
      el.append(h("div", { class: "code-box" }, h("div", { class: "small muted", text: r.title }), h("div", { class: "code-big", text: formatCode(r.code) })), mediaResult(r, media),
        h("p", { class: "small", style: { marginTop: ".8rem" }, text: "Das Blatt erscheint in der Schüleransicht dieser Sitzung mit Titel, Code und dem Knopf „Code kopieren und Feibeitsblatt öffnen“." }),
        h("h3", { text: "Optional: Checkliste bestätigen" }),
        h("p", { class: "small muted", text: "Im Feibeitsblatt schlägt die KI eine Checkliste vor (für die Lösungs-PDF und das analoge Arbeitsblatt). Das ist für die Schüler:innen nicht nötig." }));
      const box = h("div");
      el.append(h("button", { class: "btn", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try {
          const c = await fb.checklistPropose(r.code);
          const draft = c.final || c.draft || { ai: true, tasks: [] };
          const areas = (draft.tasks || []).map((t) => h("div", { class: "field" }, h("label", null, "Aufgabe " + t.n), h("textarea", { rows: "4", dataset: { n: t.n }, value: (t.points || []).join("\n") })));
          clear(box).append(...areas, h("button", { class: "btn primary", type: "button", onclick: (ev) => busy(ev.currentTarget, async () => {
            try {
              const tasks = [...box.querySelectorAll("textarea")].map((ta) => ({ n: Number(ta.dataset.n), points: ta.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 8) }));
              await fb.checklistSave(r.code, draft.ai !== false, tasks); toast("Checkliste bestätigt – das Notfall-Feibeitsblatt bekommt den QR-Code dazu.", "ok");
              ensureNotfall([r.code]);
            } catch (err) { errToast(err); }
          }) }, "Checkliste bestätigen"));
        } catch (err) { errToast(err); }
      }, "Die KI schlägt vor …") }, "Checkliste vorschlagen lassen"), box);
    }, actions: [{ label: "Fertig", class: "primary" }] });
  }

  async function showSubmissions(sheet) {
    let timer = null;
    const content = h("div", { class: "stack" }, h("p", { class: "muted", text: "Lade und entschlüssele die Abgaben …" }));
    const auto = h("input", { type: "checkbox", id: "autoref" });
    const load = async () => {
      try {
        const [info, subs] = await Promise.all([fb.getSheet(sheet.code), fb.submissions(sheet.code)]);
        const tasks = info.sheet.tasks || [];
        const by = new Map();
        for (const s of subs) {
          const k = s.payload ? personKey(s.payload.person) : "x" + s.id;
          const prev = by.get(k);
          if (!prev || (s.stage === "final" && prev.stage !== "final") || (s.stage === prev.stage && s.receivedAt > prev.receivedAt)) by.set(k, s);
        }
        const rows = [...by.values()].sort((a, b) => personLabel(a.payload && a.payload.person).localeCompare(personLabel(b.payload && b.payload.person), "de"));
        const nFinal = rows.filter((r) => r.stage === "final").length;
        clear(content).append(h("p", { class: "small", text: nFinal + " Abgabe" + (nFinal === 1 ? "" : "n") + ", " + (rows.length - nFinal) + " Erstversuch" + (rows.length - nFinal === 1 ? "" : "e") + " ohne Abgabe · Stand " + new Date().toLocaleTimeString("de-DE") }));
        if (!rows.length) content.append(h("p", { class: "muted", text: "Noch keine Abgaben." }));
        for (const s of rows) {
          const p = s.payload;
          const box = h("div", { class: "sub" }, h("div", { class: "row between" }, h("strong", { text: p ? personLabel(p.person) : "Unlesbar" }),
            h("span", { class: "row" }, h("span", { class: "badge " + (s.stage === "final" ? "ok" : ""), text: s.stage === "final" ? "abgegeben" : "Erstversuch" }), h("span", { class: "small muted", text: fmtTime(s.receivedAt) }))));
          if (!p) { box.append(h("p", { class: "err small", text: s.error })); content.append(box); continue; }
          if (p.escape && typeof p.escape === "object") box.append(escapeSummary(p.escape));
          (p.answers || []).forEach((a, i) => {
            const t = tasks[i] || {};
            const fin = (a && (a.final != null ? a.final : a.first)) || "";
            const fbk = (p.feedback || [])[i], fin2 = s.final && s.final.results ? s.final.results[i] : null;
            box.append(h("details", { open: rows.length <= 6 ? true : null }, h("summary", null, "Aufgabe " + (i + 1) + ": " + String(t.text || "").slice(0, 90)),
              photoOf(a) ? photoNode(photoOf(a), "Foto-" + sheet.code + "-" + (p.person && p.person.klasse ? p.person.klasse + "-" : "") + personLabel(p.person).replace(/[^\wÄÖÜäöüß-]+/g, "-").slice(0, 40) + "-Aufgabe-" + (i + 1) + ".jpg")
                : t.answer && t.answer.type === "photo" ? h("div", { class: "answer muted", text: s.stage === "final" ? "(kein Foto abgegeben)" : "(Foto – erst in der Abgabe sichtbar)" })
                : h("div", { class: "answer", text: typeof fin === "string" ? fin || "(leer)" : JSON.stringify(fin) }),
              a && a.first && a.final && a.first !== a.final ? h("details", { class: "small" }, h("summary", null, "Erste Fassung (vor dem KI-Feedback)"), h("div", { class: "answer", text: a.first })) : null,
              fbk ? fbBlock("KI-Feedback vor der Abgabe", fbk, "Gelingt schon", "Tipps") : null,
              fin2 ? fbBlock("Finale KI-Rückmeldung", fin2, "Gelingt schon", "Hat gefehlt") : null));
          });
          if (s.finalMismatch) box.append(h("p", { class: "small warnc", text: "Die finale KI-Rückmeldung passt nicht zu dieser Fassung und wird nicht angezeigt." }));
          content.append(box);
        }
      } catch (e) { clear(content).append(h("p", { class: "err", text: e.message })); }
    };
    auto.addEventListener("change", () => { clearInterval(timer); if (auto.checked) timer = setInterval(load, 30000); });
    modal({ title: "Abgaben: " + sheet.title + " (" + formatCode(sheet.code) + ")", wide: true, onClose: () => clearInterval(timer), body: (el) => el.append(
      h("div", { class: "row between", style: { marginBottom: ".6rem" } }, h("label", { style: { fontWeight: 400, display: "flex", gap: ".4rem", alignItems: "center" } }, auto, "alle 30 Sekunden aktualisieren"),
        h("button", { class: "btn small", type: "button", onclick: (e) => busy(e.currentTarget, load, "Lade …") }, "Aktualisieren")), content,
      h("p", { class: "hint", text: "Entschlüsselt in Ihrem Browser. Tippzeit-Auswertung, PDF-Export und Löschen der Abgaben bleiben im Feibeitsblatt." })) });
    load();
  }
  // Ergebnis aus dem Escape-Room (vom Feibeitsblatt mit der Abgabe verschlüsselt; fremde Daten → nur als Text, gekappt)
  function escapeSummary(e) {
    const t = (v, n) => String(v == null ? "" : v).slice(0, n);
    const st = (Array.isArray(e.stations) ? e.stations : []).slice(0, 20);
    const clean = st.filter((x) => x && x.attempts === 1 && !(Array.isArray(x.errors) && x.errors.length)).length;
    return h("details", { class: "escbox small" }, h("summary", null, "Escape-Room „" + t(e.room && e.room.name, 80) + "“: Lösungswort " + t(e.word, 20) + " · " + clean + " von " + st.length + " Stationen im ersten Versuch fehlerfrei",
      e.check === "mismatch" ? [" · ", h("span", { class: "warnc", text: "Prüfsumme stimmt nicht (Datensatz verändert?)" })] : null),
      h("ul", null, st.map((x) => h("li", null, t(x && x.label, 200) + " – " + (x && Number.isInteger(x.attempts) ? x.attempts : "?") + " Versuch(e)",
        Array.isArray(x && x.errors) && x.errors.length ? h("ul", null, x.errors.slice(0, 30).map((er) => h("li", { text: t(er && er.item, 300) + (er && er.wrong ? " – Antwort: " + t(er.wrong, 200) : "") + (er && er.right ? " – richtig: " + t(er.right, 200) : "") }))) : null))));
  }
  // Foto-Antwort: das Feibeitsblatt legt das Bild nur in der Abgabe (stage "final") als answers[i].photo ab (JPEG, data:-URL);
  // final ist dann „[Foto]“. Fremde Daten → nur nach Prüfung als Bildquelle verwenden.
  const photoOf = (a) => (a && typeof a === "object" ? cleanPhoto(a.photo) : null);
  // eine data:-Adresse öffnen Browser nicht im neuen Tab (Chrome blockiert sie): das Bild in ein leeres Fenster setzen
  function openImage(url, name) {
    const w = window.open("about:blank", "_blank");
    if (!w) { toast("Das Fenster wurde blockiert – bitte Pop-ups für Unterricks erlauben oder „Foto speichern“ nutzen.", "err"); return; }
    try { w.opener = null; } catch {}
    const d = w.document, img = d.createElement("img");
    d.title = name || "Foto"; img.src = url; img.alt = "Foto der Abgabe";
    img.style.cssText = "max-width:100%;max-height:100vh;height:auto;display:block;margin:auto";
    d.body.style.cssText = "margin:0;background:#111;min-height:100vh;display:grid;place-items:center";
    d.body.append(img);
  }
  function photoNode(url, name) {
    const img = h("img", { src: url, alt: "Foto der Abgabe", class: "sub-photo", loading: "lazy" });
    return h("div", { class: "answer" }, img, h("div", { class: "row", style: { marginTop: ".3rem" } },
      h("button", { class: "btn small", type: "button", onclick: () => openImage(url, name) }, "Groß ansehen"),
      h("a", { class: "btn small", href: url, download: name || "Foto.jpg" }, "Foto speichern")));
  }
  function fbBlock(title, f, okLabel, missLabel) {
    const list = (arr) => h("ul", null, (Array.isArray(arr) ? arr : []).slice(0, 12).map((x) => h("li", { text: String(x).slice(0, 300) })));
    return h("div", { class: "fbk" }, h("div", { class: "k", text: title }),
      (f.covered || []).length ? h("div", null, okLabel + ":", list(f.covered)) : null, (f.missing || []).length ? h("div", null, missLabel + ":", list(f.missing)) : null, f.note ? h("div", { class: "muted", text: String(f.note).slice(0, 300) }) : null);
  }
  paintFb();
  ensureNotfall(st.sheets.map((x) => x.code));   // nur, wenn die Verbindung zum Feibeitsblatt schon besteht (z. B. nach einer Vertretung)
  // gespeicherte Feibeitsblatt-Verbindung: automatisch verbinden (einmal je Seitenaufruf; nach einem Netzfehler neu versuchen)
  if (!analog && !fb.connected) { const run = notfallRun; fbAutoConnect(T.fbLink.state === "error" || T.fbLink.state === "saved").then(() => { if (run === notfallRun) afterConnect(); }); }

  /* ======================= Seitenleiste ======================= */
  const codeCard = h("section", { class: "card" }, h("h2", { text: "Sitzungscode" }),
    h("div", { class: "code-box" }, h("div", { class: "code-big", text: formatCode(L().code) }), h("div", { class: "small muted", text: L().studentCount + " Gerät" + (L().studentCount === 1 ? "" : "e") + " freigeschaltet" })),
    h("div", { class: "row", style: { marginTop: ".6rem" } },
      h("button", { class: "btn small", type: "button", onclick: async () => toast((await copyText(formatCode(L().code))) ? "Code kopiert." : "Kopieren nicht möglich.", "ok") }, "Kopieren"),
      h("button", { class: "btn small", type: "button", onclick: async () => (await lazy(import("./presenter.js"))).showCode(formatCode(L().code), L().title) }, "Für den Beamer zeigen")),
    h("p", { class: "hint", text: "Der Code öffnet nur diese Sitzung – und nur für Schüler:innen, die " + (isCourseClass(L().klass)
      ? (courseMembers(cfg && cfg[L().subject], L().klass).length ? "eine der Klassen " + courseMembers(cfg[L().subject], L().klass).map(classShort).join(", ") : "eine Klasse dieses Kurses (noch keine eingetragen)")
      : classShort(L().klass)) + " und " + subjectName(L().subject) + " gewählt haben." }));

  const fTitle = h("input", { value: L().title, maxlength: "200" }), fTopic = h("input", { value: L().topic, maxlength: "500" });
  const fDate = h("input", { type: "date", value: L().date || "", required: true, "aria-label": "Datum der Sitzung" }), fDur = h("input", { type: "number", min: "5", max: "600", step: "5", value: L().durationMin || "" });
  const fStart = h("input", { type: "time", step: "300", value: L().startTime || "", "aria-label": "Beginn der Sitzung (Uhrzeit)" });
  const timesLine = h("div", { class: "small timesline", "aria-live": "polite" });
  const paintTimesLine = () => {
    if (selbstNow()) { clear(timesLine).append(h("span", { text: selbstlernTimesText(analog) })); return; }
    const t = timesNow();
    clear(timesLine).append(t
      ? h("span", null, "Für Schüler:innen: Hausaufgabe ab ", h("strong", { text: whenText(t.homeworkAt) }), " (" + HOMEWORK_BEFORE_END_MIN + " Minuten vor dem Ende), ganze Präsentation zum Selbstöffnen ab ",
        h("strong", { text: whenText(t.presentationAt) }), " (" + PRESENTATION_AFTER_END_MIN + " Minuten nach dem Ende " + fmtClockBerlin(t.end) + " Uhr).")
      : h("span", { class: "warnc", text: "Bitte " + missingTimes() + " eintragen – ohne " + (missingTimes().includes(" und ") ? "diese Angaben" : "diese Angabe") + " sehen Schüler:innen weder die Hausaufgabe noch die ganze Präsentation." }));
  };
  paintTimesLine(); onTimes.push(paintTimesLine);
  // KI-Begriffshilfe für Schüler:innen (während der Stunde, nach ihrer Einwilligung) – je Sitzung abschaltbar
  const fAi = h("input", { type: "checkbox", id: "fai", checked: L().studentAi !== false ? true : null, "aria-describedby": "fai-hint" });
  fAi.addEventListener("change", async () => {
    try { const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { studentAi: fAi.checked } }); L().studentAi = r.lesson.studentAi; stateLine(metaState, "Gespeichert", "ok"); }
    catch (e) { fAi.checked = !fAi.checked; errToast(e); }
  });
  const aiLabel = h("span"), aiHint = h("p", { class: "hint", id: "fai-hint" });
  // Selbstlern-Phase mit iPads: die KI-Begriffshilfe gilt bis zur nächsten Sitzung mit der Lehrkraft (Jg. 5/6 bleibt beim bisherigen Text)
  const paintAiRow = () => {
    const sl = selbstNow() && !analog;
    aiLabel.textContent = sl ? SELBSTLERN_AI_LABEL : "KI-Begriffshilfe für Schüler:innen während der Stunde anbieten";
    aiHint.textContent = sl ? SELBSTLERN_AI_HINT : "Unter der Live-Präsentation erklärt eine kostenlose KI (Einstellungen → KI-Begriffshilfe) Fachbegriffe kurz und einfach – nur zwischen Beginn und Ende der Sitzung, nur nach Einwilligung der Schüler:innen; Unterricks speichert die Fragen nicht.";
  };
  paintAiRow(); onTimes.push(paintAiRow);
  const aiRow = h("div", { class: "field" }, h("label", { class: "checkrow" }, fAi, aiLabel), aiHint);
  fStart.addEventListener("change", async () => {
    const nv = fStart.value || null, ov = L().startTime || null;
    if (nv === ov) return;
    try {
      const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { startTime: nv } });
      L().startTime = r.lesson.startTime; paintTimes();
      if (st.unit) { const x = (st.unit.rows || []).find((y) => y.uid === L().unitRow); if (x) x.time = L().startTime; }
      stateLine(metaState, "Gespeichert", "ok");
    } catch (e) { fStart.value = ov || ""; errToast(e); }
  });
  const fIdeas = h("textarea", { rows: "4", value: L().ideas, placeholder: "Ideen, Wünsche, Materialhinweise …" });
  const metaState = h("span", { class: "save-state" });
  let metaT = null;
  const saveMeta = async () => {
    clearTimeout(metaT);
    try {
      const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { title: fTitle.value, topic: fTopic.value, durationMin: fDur.value ? Number(fDur.value) : null, ideas: fIdeas.value } });
      Object.assign(st.lesson, { title: r.lesson.title, topic: r.lesson.topic, durationMin: r.lesson.durationMin, ideas: r.lesson.ideas });
      heading.textContent = r.lesson.title; paintSubline(); paintTimes(); stateLine(metaState, "Gespeichert", "ok");
    } catch (e) { stateLine(metaState, e.message, "err"); }
  };
  for (const el of [fTitle, fTopic, fDur, fIdeas]) { el.addEventListener("input", () => { stateLine(metaState, "…"); clearTimeout(metaT); metaT = setTimeout(saveMeta, 900); }); el.addEventListener("change", saveMeta); }
  // Datum ändern: nur diese Sitzung (keine Verschiebung folgender Sitzungen); das neue Datum steht auch in der Zeile der Einheit
  fDate.addEventListener("change", async () => {
    const nd = fDate.value, od = L().date;
    if (!nd) { fDate.value = od || ""; toast("Jede Sitzung braucht ein Datum.", "err"); return; }
    if (nd === od) return;
    // nie an einem unterrichtsfreien Tag des Gymnasiums (Einstellungen) – der Server prüft noch einmal
    const free = await freeDateMessage(nd, L().subject);
    if (free) { fDate.value = od || ""; toast(free, "err", 9000); return; }
    try {
      const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { date: nd } });
      L().date = r.lesson.date; L().nextDate = r.lesson.nextDate; L().freeDay = null; paintSubline(); paintTimes();
      if (st.unit) { const x = (st.unit.rows || []).find((y) => y.uid === L().unitRow); if (x) x.date = nd; }
      stateLine(metaState, "Gespeichert", "ok");
      toast("Datum geändert" + (st.unit ? " – auch in der Unterrichtseinheit." : "."), "ok");
    } catch (e) { fDate.value = od || ""; errToast(e); }
  });
  const metaCard = h("section", { class: "card" }, h("div", { class: "section-title" }, h("h2", { text: "Sitzungsdaten" }), metaState),
    h("div", { class: "field" }, h("label", null, "Titel"), fTitle), h("div", { class: "field" }, h("label", null, "Thema"), fTopic),
    h("div", { class: "meta-grid" }, h("div", { class: "field" }, h("label", null, "Datum"), fDate), h("div", { class: "field" }, h("label", null, "Beginn (Uhrzeit)"), fStart),
      h("div", { class: "field" }, h("label", null, "Dauer (Minuten)"), fDur)),
    timesLine, aiRow,
    h("div", { class: "field" }, h("label", null, "Ideen und Wünsche"), fIdeas),
    h("button", { class: "btn small danger", type: "button", onclick: async () => {
      if (!(await confirmDialog("Sitzung löschen", "Die Sitzung mit Planung, Schulportal-Eintrag, allen Dateien und Freischaltungen endgültig löschen?", "Endgültig löschen", true))) return;
      try { await tapi("DELETE", "/api/teacher/lessons/" + id); toast("Sitzung gelöscht.", "ok"); go("#/lk/f/" + L().subject + "/" + L().klass); } catch (e) { errToast(e); }
    } }, "Sitzung löschen"));

  /* ======================= Hauptweg: Stunde mit Claude planen (claude.ai, Connector) ======================= */
  const planWithClaude = () => {
    flushPortal();
    claudeHandoff({ title: "Stunde mit Claude planen",
      intro: "Claude liest über den Connector diese Sitzung (" + (st.unit ? "Einheit und Stundenfrage, " : "") + "Materialien, Schulportal-Eintrag, bei Bedarf die Planungsgrundlagen), fragt nach Dauer und Wünschen und plant mit Ihnen im Dialog. " +
        "Gespeichert wird nur, was Sie freigeben: Schulportal-Eintrag, Hausaufgabe, Materialien" + (analog ? "" : ", Feibeitsblatt-Entwurf") + (st.unit ? " und – nach Ihrer Zustimmung – eine geänderte Stundenfrage in der Einheit." : ".") +
        " Dazu schreibt Claude jedes Mal die „" + TEACHER_SUMMARY_TITLE + "“ (ganz oben auf dieser Seite).",
      after: "Wenn Claude gespeichert hat, kommen Sie hierher zurück: Die Seite übernimmt Schulportal-Eintrag, Hausaufgabe, Materialien, Entwürfe und die Zusammenfassung beim Zurückkehren automatisch.",
      chatName: () => lessonChatName(ctx()),
      prompt: () => claudeLessonPrompt({ ...ctx(), messages: st.messages, previousStop: d.previousStop }) });
  };
  const planCard = h("section", { class: "card claudeplan" },
    h("div", { class: "section-title" }, h("h2", { text: "Stunde mit Claude planen" }), h("span", { class: "badge ok", text: "Hauptweg" })),
    h("p", { class: "small", text: "Claude (Ihr Pro-Abo in claude.ai) plant diese Stunde mit Ihnen im Dialog und speichert die Ergebnisse über den Connector direkt in dieser Sitzung." }),
    h("button", { class: "btn primary big", type: "button", onclick: planWithClaude }, "Stunde mit Claude planen"),
    h("p", { class: "hint" }, "Ist Ihr Claude-Kontingent gerade erschöpft, planen Sie unten im ", h("a", { href: "#backupchat", onclick: (e) => { e.preventDefault(); chatCard.scrollIntoView({ behavior: "smooth", block: "start" }); } }, "Backup mit kostenloser KI"), " weiter."),
    h("details", { class: "box small" }, h("summary", null, "Sitzungs-ID für Claude"),
      h("p", null, "Claude findet die Sitzung auch selbst (list_lessons). Falls Sie die ID in einem bestehenden Chat nennen möchten:"),
      h("div", { class: "row" }, h("code", { class: "mono", text: id }), h("button", { class: "btn small", type: "button", onclick: async () => toast((await copyText(id)) ? "ID kopiert." : "Kopieren nicht möglich.", "ok") }, "Kopieren"))));

  // Hinweis auf den offenen Teil der vorigen Sitzung (Zwischenstopp) samt Stand der Entscheidung mit Claude – beim Zurückkehren neu (onVis)
  // (direkt vor „Stunde mit Claude planen“; ohne Zwischenstopp gibt es die Karte nicht, ebenso nicht mehr, wenn er erledigt ist – Nachtrag 26)
  let prevEl = null, prevHidden = false;
  const prevCardOf = () => { const ps = d.previousStop; return prevStopShown(ps) && !prevHidden ? prevStopCard(ps, { gs: false, preview: portalPreview(ps.portal), unit: !!st.unit, selbstlern: selbstNow() ? SELBSTLERN_BUTTON : null, onHide: () => { prevHidden = true; prevEl = null; },
    focusAfter: () => planCard.querySelector("h2") }) : null; };
  const paintPrev = () => {
    // nie unter dem Fokus neu aufbauen – fällt die Karte ganz weg (erledigt), geht der Fokus wie bei „Ausblenden“ auf „Stunde mit Claude planen“
    if (prevEl && prevStopShown(d.previousStop) && prevEl.contains(document.activeElement)) return;
    const next = prevCardOf();
    if (prevEl) { const had = prevEl.contains(document.activeElement); if (next) prevEl.remove(); else removeKeepingView(prevEl); if (had) keepFocusOn(planCard.querySelector("h2")); }
    prevEl = next;
    if (next && planCard.parentNode) planCard.before(next);
  };
  // die Planung dieser Sitzung ist auf der Seite gespeichert (Eintrag, „Mit KI neu erstellen“): nach einer Entscheidung ist der Hinweis erledigt (Nachtrag 26)
  function planSaved(at) { const ps = prevStopAfterSave(d.previousStop, at); if (ps) { d.previousStop = ps; paintPrev(); } }
  prevEl = prevCardOf();
  // Selbstlern-Phase (Nachtrag 29; ersetzt die Krankheitsvertretung) – Feibeitsblätter ihrer Stationen legt die Lehrkraft im bekannten Editor an
  const sub = substituteCards({ id, st, L, ctx, analog, reload: () => sessionPage(id), openDraft: (dr, o) => editDraft(dr, o), flushPortal, teacherNext: () => d.teacherNextDate || null,
    previousStop: () => d.previousStop || null });   // Zwischenstopp der vorigen Sitzung: auch der Selbstlern-Prompt fragt danach

  /* ======================= Sitzung als Datei (ganz unten): herunterladen und – in einer anderen Sitzung – wieder laden ======================= */
  async function exportSession(onStep) {
    flushPortal();
    const { buildSessionZip } = await lazy(import("./sessionio.js"));
    const r = await buildSessionZip(st, { fb, onStep, homework: hwTA.value || "", portal: portalTA ? portalTA.value : L().portal || "" });
    downloadBlob(new Blob([r.bytes], { type: "application/zip" }), r.name);
    return { name: r.name, files: r.files, notes: r.notes };
  }
  async function importSession(file, onStep) {
    const IO = await lazy(import("./sessionio.js"));
    const { data, byPath } = await IO.readSessionZip(new Uint8Array(await file.arrayBuffer()));
    const src = data.source, plan = IO.planSessionImport(data, L());
    const { texts, links, prints, bins, pres, pairs } = plan;
    const cur = { date: L().date ? fmtDay(L().date) : "ohne Datum", time: L().startTime ? L().startTime + " Uhr" : "ohne Beginn", dur: L().durationMin ? L().durationMin + " Minuten" : "ohne Dauer" };
    const warn = [src.subject && src.subject !== L().subject ? "Die Datei stammt aus " + subjectName(src.subject) + ", diese Sitzung ist " + subjectName(L().subject) + "." : null,
      src.durationMin && L().durationMin && src.durationMin !== L().durationMin ? "Die Datei wurde für " + src.durationMin + " Minuten geplant, diese Sitzung dauert " + L().durationMin + " Minuten." : null].filter(Boolean);
    const ok = await new Promise((resolve) => {
      let done = false;
      modal({ title: "Sitzung aus Datei laden?", wide: true, onClose: () => { if (!done) resolve(false); }, body: (el) => el.append(
        h("p", null, "Aus „", h("strong", { text: file.name }), "“: " + (src.title || "Sitzung") + (src.sessionNo ? " – Sitzung Nr. " + src.sessionNo : "") + (src.unitTitle ? " der Einheit „" + src.unitTitle + "“" : "") +
          (src.klass ? " (" + (subjectShort(src.subject) || "") + " " + classShort(src.klass) + (src.date ? ", " + fmtDay(src.date) : "") + ")" : "") + "."),
        h("ul", { class: "small" },
          h("li", { text: "Titel, Thema, Ideen und Wünsche, Hausaufgabe, Zusammenfassung für die Lehrkraft, Schulportal-Eintrag und Planungsverlauf ersetzen den bisherigen Stand dieser Sitzung." }),
          h("li", { text: "Dazu kommen: " + [texts.length + links.length + bins.filter((f) => f.area === "student" || f.area === "teacher").length + " Materialien", prints.length + bins.filter((f) => f.area === "print").length + " Druckvorlagen",
            pres ? "die Präsentation" + (curPres() ? " (ersetzt die bisherige)" : "") : null, data.drafts.length + " Feibeitsblatt-Entwürfe"].filter(Boolean).join(", ") + "." }),
          h("li", { text: "Datum, Beginn und Dauer bleiben die dieser Sitzung (" + cur.date + ", " + cur.time + ", " + cur.dur + "); die Fälligkeit der Hausaufgabe richtet sich nach der nächsten Sitzung dieser Lerngruppe." +
            (pairs.length ? " Datumsangaben in den Texten werden angepasst: " + pairs.map(([a, b]) => fmtDay(a) + " → " + fmtDay(b)).join(", ") + "." : "") }),
          // Gegenstände zum Mitbringen (Nachtrag 28): nur, wenn die Datei welche hat
          plan.lesson.bring.length ? h("li", { text: "Gegenstände zum Mitbringen (" + plan.lesson.bring.map((x) => x.item).join(", ") + ") ersetzen die Liste dieser Sitzung" +
            (plan.groupReplaced.length ? "; in ihren Hinweisen wird die Lerngruppe angepasst: " + plan.groupReplaced.map(([a, b]) => a + " → " + b).join(", ") + "." : ".") }) : null),
        ...warn.map((w) => h("div", { class: "notice warn", text: w }))),
        actions: [{ label: "Abbrechen", onClick: () => { done = true; resolve(false); } }, { label: "Übernehmen", class: "primary", onClick: () => { done = true; resolve(true); } }] });
    });
    if (!ok) return null;
    const { missing } = await IO.applySessionImport(id, plan, data, byPath, { onStep, uploadPres });
    return { replaced: plan.replaced, unknown: plan.unknown, missing, notes: data.notes, sheets: data.sheets, drafts: data.drafts.length };
  }
  const ioState = h("span", { class: "save-state" });
  const exportBtn = h("button", { class: "btn", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
    try { const r = await exportSession((m) => stateLine(ioState, m)); stateLine(ioState, "Heruntergeladen: " + r.name, "ok"); if (r.notes.length) toast(r.notes.join(" "), "", 9000); }
    catch (err) { stateLine(ioState, ""); errToast(err); }
  }, "Stelle die Datei zusammen …") }, icon("download"), "Sitzung als Datei herunterladen");
  const importInput = h("input", { type: "file", class: "hidden", accept: ".zip,application/zip", "aria-label": "Unterrickssitzung (ZIP-Datei) auswählen" });
  const importBtn = h("button", { class: "btn", type: "button", onclick: () => importInput.click() }, icon("up"), "Sitzung aus Datei laden");
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0]; importInput.value = ""; if (!file) return;
    importBtn.disabled = true;
    try {
      const r = await importSession(file, (m) => stateLine(ioState, m));
      if (!r) { stateLine(ioState, ""); return; }
      const list = (title, xs) => (xs.length ? [h("h3", { text: title }), h("ul", { class: "small" }, xs.slice(0, 20).map((x) => h("li", { text: x })))] : []);
      await sessionPage(id);
      modal({ title: "Sitzung übernommen", wide: true, body: (el) => el.append(
        h("p", { class: "small", text: "Die Inhalte stehen jetzt in dieser Sitzung. " + (r.drafts ? r.drafts + " Feibeitsblatt-Entwurf" + (r.drafts === 1 ? "" : "e") + " – mit „Feibeitsblatt jetzt anlegen“ bekommt jedes Blatt einen neuen Code für diese Lerngruppe." : "") }),
        ...list("Angepasste Datumsangaben", r.replaced.map(([a, b]) => a + " → " + b)),
        ...list("Bitte prüfen: weitere Datumsangaben", r.unknown),
        ...list("Feibeitsblätter der ursprünglichen Sitzung", r.sheets.map((s) => "„" + s.title + "“ (Code " + formatCode(s.code) + ") – alter Code lässt sich unter „Vorhandenes Feibeitsblatt verknüpfen“ wieder verknüpfen")),
        ...list("Hinweise", r.notes), ...list("Nicht übernommen", r.missing)),
        actions: [{ label: "Fertig", class: "primary" }] });
    } catch (err) { stateLine(ioState, ""); errToast(err); }
    importBtn.disabled = false;
  });
  const ioCard = h("section", { class: "card sessionio" }, h("div", { class: "section-title" }, h("h2", { text: "Sitzung als Datei" }), ioState),
    h("p", { class: "small", text: "Eine Datei mit allem, was Unterricks für diese Sitzung braucht: Planung, Schulportal-Eintrag, Hausaufgabe, Planungsverlauf, Materialien, Links, Präsentation, Druckliste und Feibeitsblätter (als Entwürfe). So lässt sich eine schon gehaltene Sitzung in einer anderen Lerngruppe erneut durchführen oder leicht abändern." }),
    h("div", { class: "row" }, exportBtn, importBtn, importInput),
    h("p", { class: "hint", text: "Beim Laden einer Datei bleiben Datum, Beginn und Dauer dieser Sitzung; Datumsangaben in den Texten passt Unterricks an diese Sitzung an. Notfall-Feibeitsblätter entstehen neu, sobald die Feibeitsblätter angelegt sind." }));

  /* ======================= Alle Unterlagen dieser Sitzung (Nachtrag 41): ganz unten – ZIP-Ordner zum Lesen, Ausdrucken und Mitnehmen ======================= */
  // vorher Schulportal-Eintrag sichern (ein Konflikt wird erst geklärt), dann der Stand der Felder; übrige ungespeicherte Teile fragt die Karte ab
  const docsCard = lessonDocsCard({ st, box: mbox, before: async () => { await flushPortal(); return { portal: portalTA ? portalTA.value : L().portal || "", homework: hwTA.value || "" }; },
    dirty: () => [notesDirtyNow() ? "den Notizen zu den Folien" : "", tsum.dirty() ? "der Zusammenfassung für die Lehrkraft" : "", bring.dirty() ? "den Gegenständen zum Mitbringen" : ""] });

  // Gegenstände zum Mitbringen (Nachtrag 28): kompakte Karte unter den Sitzungsdaten
  const bring = bringCard({ id, L, absent: () => (st.sub && (st.sub.status === "selbstlern" || st.sub.status === "aktiv") ? st.sub.status : null) });
  const grid = h("div", { class: "session-grid" },
    h("div", { class: "stack" }, sub.main, prevEl, planCard, unitCard, chatCard, portalCard, hwCard, presPromptCard, filesCard, presCard, fbCard, printCard),
    h("aside", { class: "side" }, codeCard, metaCard, bring.el, sub.side));
  /* ======================= „Ich bin jetzt im Unterricht“ (Nachtrag 35): ganz oben, vor der Zusammenfassung ======================= */
  // kompakte Ansicht (inclass.js, erst bei Bedarf geladen) mit den Wegen dieser Seite; nicht in einer Selbstlern-Phase oder laufenden Vertretung (die
  // Lehrkraft ist dann nicht im Unterricht)
  const icApi = { kind: "gym", id, st, selbstlern: selbstNow, on: (k, fn) => { icOn[k].add(fn); return () => icOn[k].delete(fn); },
    planText: () => (portalTA ? portalTA.value : L().portal || ""), paintPlan: (box) => paintPortalPreview(box, portalTA ? portalTA.value : L().portal || ""), planState: portalState,
    stopMenu: (line, x, y) => { if (!portalTA) showPortalEditor(); stopMenu(line, x, y); }, insertStop: (line) => { if (!portalTA) showPortalEditor(); insertStopAt(line); }, dropStop,
    stopNext: () => stopNext, openActs, packs: () => mbox.packs(), packActs: mbox.packActs, homework: hwCard, annotated: (p) => st.files.find((f) => f.notesOf === p.id && f.area !== "archive") || null,
    // auch eine Präsentation, deren Folienbilder noch fehlen (die kompakte Ansicht sagt es; live starten nur „ready“ – startLive nimmt curPres)
    pres: () => st.files.find((f) => f.area === "presentation") || null,
    startLive: (focusAfter) => startLive(focusAfter),
    // Stand des Servers vergleichen (…/stamp) und bei einer Änderung die Sitzung neu laden (refreshLesson)
    checkStamp: async () => { const s = await tapi("GET", "/api/teacher/lessons/" + id + "/stamp"); if (s.stamp !== lessonStamp) await refreshLesson(); } };
  const inClass = inClassToggle({ id, full: () => [tsum.el, grid, ioCard, docsCard], allowed: () => !(st.sub && (st.sub.status === "selbstlern" || st.sub.status === "aktiv")),
    mount: async () => (await lazy(import("./inclass.js"))).inClassView(icApi) });
  main.append(...inClass.els, tsum.el, grid, ioCard, docsCard);
  inClass.restore();

  // Hinweis zum Überarbeiten der Einheit nach dem Verschieben wegen unterrichtsfreier Tage (Nachtrag 24) – derselbe Kasten wie auf der Einheitsseite
  // und auf den Sitzungsseiten der Grundschule, direkt vor „Stunde mit Claude planen“; ohne offenen Hinweis gibt es ihn nicht (Seite wie bisher)
  let reviseEl = null, reviseRun = 0;
  const paintRevise = async () => {
    const u = st.unit, run = ++reviseRun;
    const next = u && u.revise && u.revise.open ? (await lazy(import("./grundschule.js"))).reviseBox(u, { unitLink: true,
      onChange: (nu) => { if (nu) { st.unit = nu; paintUnit(); paintSubline(); } paintRevise(); } }) : null;
    if (run !== reviseRun || !main.isConnected) return;   // inzwischen neu gezeichnet bzw. Seite verlassen
    if (reviseEl) reviseEl.remove();
    reviseEl = next;
    if (next && planCard.parentNode) planCard.before(next);
  };
  paintRevise();

  // Änderungen von außen (z. B. Claude über den Connector, ein anderes Gerät) übernehmen: beim Zurückkehren in den Tab (onVis) und – solange die Ansicht für
  // den Unterricht offen ist – sobald sich der Stand des Servers ändert (…/stamp, Nachtrag 35: z. B. „Bis hier gezeigt“ auf dem iPad, während der Laptop die
  // kompakte Ansicht zeigt). Nie zwei Abrufe gleichzeitig; kommt währenddessen noch einer dazu, folgt er danach.
  let refreshing = null, refreshAgain = false;
  function refreshLesson() {
    if (refreshing) { refreshAgain = true; return refreshing; }
    refreshing = (async () => { do { refreshAgain = false; await doRefresh(); } while (refreshAgain && main.isConnected); })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function doRefresh() {
    try {
      const r = await tapi("GET", "/api/teacher/lessons/" + id);
      if (!main.isConnected) return;
      lessonStamp = r.stamp || null;
      if (r.messages.length !== st.messages.length && !sendBtn.disabled) { st.messages = r.messages; paintMsgs(); }
      // neue, gelöschte, umbenannte und (von Claude) neu gestaltete oder inzwischen gedruckte Dateien – und Markierung bzw. Phasen der Präsentation (ein anderes
      // Gerät); vorhandene Einträge werden aktualisiert, nicht ersetzt (offene Teile der Seite halten sie)
      if (filesKey(r.files) !== filesKey(st.files) || presSig(r.files) !== presSig(st.files)) {
        st.files = r.files.map((nf) => { const o = st.files.find((x) => x.id === nf.id); return o ? Object.assign(o, nf) : nf; });
        paintFiles(); paintPrint();
      }
      // Präsentationskarte nur neu, wenn sie etwas anderes zeigt – nie unter dem Fokus und nie während des Hochladens
      if (presSig(st.files) !== presPainted && !pendingPdf && !presCard.contains(document.activeElement)) { st.slides = null; paintPres(); }
      if (r.drafts.length !== st.drafts.length || r.sheets.length !== st.sheets.length) { st.drafts = r.drafts; st.sheets = r.sheets; paintFb(); ensureNotfall(st.sheets.filter((x) => !notfallFile(x.code)).map((x) => x.code)); }
      const subKey = (x) => (x ? x.status + ":" + x.updatedAt : "");
      const nextChanged = (r.teacherNextDate || null) !== (d.teacherNextDate || null);
      d.teacherNextDate = r.teacherNextDate || null;
      if (nextChanged && selbstNow()) paintDue();
      if (subKey(r.substitute) !== subKey(st.sub)) {
        const was = st.sub ? st.sub.status : null;
        st.drafts = r.drafts; st.sub = r.substitute; st.sheets = r.sheets; sub.paint(); tsum.paintNote(); paintFb(); paintTimes(); bring.paintAbsent(); paintPrev(); inClass.paint();
        if (r.substitute && r.substitute.status === "selbstlern") toast(was === "selbstlern" ? "Claude hat die Selbstlern-Phase überarbeitet." : "Claude hat die Sitzung in eine Selbstlern-Phase umgebaut – die Karte steht oben.", "ok", 6000);
      } else if (st.sub && st.sub.status === "selbstlern" && JSON.stringify(r.drafts.map((x) => x.id + x.status)) !== JSON.stringify(st.drafts.map((x) => x.id + x.status))) { st.drafts = r.drafts; sub.paint(); }
      if (r.unit && st.unit && r.unit.version !== st.unit.version) { st.unit = r.unit; paintUnit(); if (!reviseEl || !reviseEl.contains(document.activeElement)) paintRevise(); }
      // Zwischenstopp der vorigen Sitzung: inzwischen gesetzt, verschoben oder (mit Claude) entschieden – auch der Prompt nimmt dann den neuen Stand
      if (JSON.stringify(r.previousStop || null) !== JSON.stringify(d.previousStop || null)) { d.previousStop = r.previousStop; paintPrev(); }
      d.nextLesson = r.nextLesson;
      tsum.update(r.lesson);   // Zusammenfassung (z. B. von Claude mit update_lesson) – nie in eine laufende Bearbeitung
      bring.update(r.lesson);  // Gegenstände zum Mitbringen (Nachtrag 28) – nie in ein offenes Formular
      // Hausaufgabe und Sitzungsdaten (z. B. von Claude mit update_lesson) – nie in ein Feld schreiben, das gerade bearbeitet wird
      const busyField = (el) => document.activeElement === el;
      if ((r.lesson.homework || "") !== (L().homework || "") && !busyField(hwTA) && !hwT && hwTA.value === (L().homework || "")) {
        L().homework = r.lesson.homework || ""; L().nextDate = r.lesson.nextDate; hwTA.value = L().homework; paintDue(); stateLine(hwState, "Aktualisiert");
      }
      const metaFields = [[fTitle, "title"], [fTopic, "topic"], [fDur, "durationMin"], [fIdeas, "ideas"]];
      if (metaState.textContent !== "…" && !metaFields.some(([el]) => busyField(el)) && !busyField(fDate)) {
        let changed = false;
        for (const [el, k] of metaFields) {
          const cur = String(L()[k] ?? ""), nv = String(r.lesson[k] ?? "");
          if (nv !== cur && el.value === cur) { L()[k] = r.lesson[k]; el.value = nv; changed = true; }   // nur Felder ohne ungespeicherte eigene Änderung
        }
        if (r.lesson.date && r.lesson.date !== L().date) { L().date = r.lesson.date; L().nextDate = r.lesson.nextDate; fDate.value = r.lesson.date; changed = true; }
        if (JSON.stringify(r.lesson.freeDay || null) !== JSON.stringify(L().freeDay || null)) { L().freeDay = r.lesson.freeDay || null; changed = true; }
        if ((r.lesson.startTime || null) !== (L().startTime || null) && !busyField(fStart)) { L().startTime = r.lesson.startTime; fStart.value = r.lesson.startTime || ""; changed = true; }
        if (changed) paintTimes();
        if (changed) { heading.textContent = L().title; paintSubline(); stateLine(metaState, "Aktualisiert"); }
      }
      if (r.lesson.portalVersion !== portal.version && !portal.dirty) {
        L().portal = r.lesson.portal; L().portalVersion = r.lesson.portalVersion; L().portalUpdatedAt = r.lesson.portalUpdatedAt; L().portalSource = r.lesson.portalSource;
        portal.version = r.lesson.portalVersion;
        if (!portalTA && r.lesson.portal) showPortalEditor();
        else if (portalTA) { portalTA.value = r.lesson.portal; paintPreview(); setPresBtn(); setSaved("Aktualisiert (Version " + portal.version + (r.lesson.portalSource === "claude" ? ", von Claude" : "") + ")"); }
      }
    } catch {}
  }
  const onVis = () => { if (document.visibilityState !== "visible") return; loadStudentPw(); refreshLesson(); };
  document.addEventListener("visibilitychange", onVis);
  const beforeUnload = (e) => { if (portal.dirty) { flushPortal(); e.preventDefault(); e.returnValue = ""; } else if (notesDirtyNow()) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  onLeave(() => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("beforeunload", beforeUnload); if (portal.dirty) flushPortal(); clearTimeout(metaT);
    if (hwT) { clearTimeout(hwT); saveHw(); } document.querySelectorAll(".ctxmenu").forEach((m) => m.remove()); });
}

