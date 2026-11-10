// session.js – Sitzungsansicht der Lehrkraft: Planung im Chat, Schulportal-Eintrag, Claude-Prompts, Material, Präsentation, Feibeitsblatt.
import { h, clear, toast, errToast, busy, modal, confirmDialog, copyText, fmtBytes, fmtDate, fmtTime, fileIcon, downloadUrl, downloadBlob, upload, api, apiUrl, nn, icon, pageHead, setFach, stateLine } from "./ui.js";
import { render, go, onLeave } from "./app.js";
import { T, tapi, teacherBar } from "./teacher.js";
import { subjectName, gradeInfo, formatCode, claudePresentationPrompt, PORTAL_RULES, portalForCopy, insertStop, removeStops, hasStop, isStopLine,
  fmtDay, classShort, gradeKey, isAnalogClass, ANALOG_RULE, isCourseClass, courseMembers, homeworkForPortal, PUBLIC_URL } from "./shared.js";
import { extractUnitChange, stripUnitBlock, unitContext, claudeLessonPrompt, lessonChatName } from "./planning.js";
import { claudeHandoff } from "./claude.js";
import { leupoldView } from "./units.js";
import { substituteCards } from "./substitute.js";
import { paintPortalPreview, portalPreview, contextMenu } from "./portalview.js";
import { renderMarkdown } from "./markdown.js";
import { personLabel, personKey, cleanPhoto, PHOTO_TASKS_MAX } from "./fbclient.js";

const MODES = [["planning", "Planung"], ["ideas", "Ideen weiterentwickeln"], ["material", "Material erstellen"]];

export async function sessionPage(id) {
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade die Sitzung …" }));
  render(teacherBar("lessons"), main);
  let d, cfg = null;
  try { [d, cfg] = await Promise.all([tapi("GET", "/api/teacher/lessons/" + id), tapi("GET", "/api/teacher/subjects").then((r) => r.subjects).catch(() => null)]); }
  catch (e) { clear(main).append(h("div", { class: "card" }, h("p", { class: "err", text: e.message }), h("a", { class: "btn", href: "#/lk" }, "Zur Übersicht"))); return; }
  const st = { lesson: d.lesson, messages: d.messages, files: d.files, sheets: d.sheets, drafts: d.drafts, slides: null, unit: d.unit, sub: d.substitute };
  const L = () => st.lesson;
  const analog = isAnalogClass(d.lesson.klass);
  let portalTA = null;
  const row = () => (st.unit && L().unitRow ? (st.unit.rows || []).find((r) => r.uid === L().unitRow) || null : null);
  const ctx = () => ({ lessonId: id, subject: L().subject, klass: L().klass,
    lesson: { title: L().title, topic: L().topic, durationMin: L().durationMin, date: L().date, ideas: L().ideas, homework: L().homework },
    materials: st.files.filter((f) => f.area !== "archive").map((f) => ({ name: f.name, area: f.area, kind: f.kind, text: f.text || "", pages: f.pages })), sheets: st.sheets,
    portal: portalTA ? portalTA.value : L().portal, unit: st.unit, row: row(), unitText: st.unit ? unitContext(st.unit, L().unitRow) : "",
    gradeNote: cfg && cfg[L().subject] ? (cfg[L().subject].gradeNotes || {})[gradeKey(L().klass)] || "" : "" });

  // Kopfband in der Fachfarbe: Folgennummer der Stunde in der Einheit, Fach, Kurs, Datum, Dauer
  const heading = h("h1", { text: L().title });
  const subline = h("div", { class: "chips" });
  const paintSubline = () => {
    const r = row(), idx = r && st.unit ? (st.unit.rows || []).indexOf(r) : -1;
    clear(subline).append(...nn(idx >= 0 ? h("span", { class: "chip strong", text: "Stunde " + (idx + 1) + " von " + st.unit.rows.length }) : null,
      h("span", { class: "chip", text: subjectName(L().subject) }), h("span", { class: "chip", text: classShort(L().klass), title: gradeInfo(L().klass).text }),
      L().date ? h("span", { class: "chip", text: fmtDay(L().date) }) : null, L().durationMin ? h("span", { class: "chip", text: L().durationMin + " Minuten" }) : null));
  };
  paintSubline();
  clear(main).append(pageHead({ fach: L().subject, title: heading, sub: subline,
    crumbs: [["#/lk", "Fächer"], ["#/lk/f/" + L().subject, subjectName(L().subject)], ["#/lk/f/" + L().subject + "/" + L().klass, classShort(L().klass)],
      ...(st.unit ? [["#/lk/u/" + st.unit.id, st.unit.title || "Einheit"]] : []), L().title] }));

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
  const presPromptBtn = h("button", { class: "btn accent big", type: "button" }, "Prompt für die Präsentation kopieren");
  const presPromptOut = h("div");
  const genPortalBtn = h("button", { class: "btn primary", type: "button" }, "Schulportal-Eintrag erstellen");
  function paintPreview() { paintPortalPreview(preview, portalTA.value); updateStopBtns(); }
  /* ---- Zwischenstopp: Rechtsklick auf eine Zeile (Textfeld oder Vorschau) → „Zwischenstopp einfügen“ (vor dieser Zeile) ---- */
  const stopBtn = h("button", { class: "btn", type: "button", title: "Vor der Zeile mit der Schreibmarke einfügen" }, icon("pause"), "Zwischenstopp einfügen");
  const unstopBtn = h("button", { class: "btn ghost hidden", type: "button" }, "Zwischenstopp entfernen");
  function updateStopBtns() { if (portalTA) unstopBtn.classList.toggle("hidden", !hasStop(portalTA.value)); }
  const lineAt = (offset) => portalTA.value.slice(0, Math.max(0, offset)).split("\n").length - 1;
  function applyPortalText(t) { portalTA.value = t; paintPreview(); setPresBtn(); schedulePortal(); }
  function insertStopAt(line) {
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
    const prompt = claudePresentationPrompt(ctx(), text, st.messages);
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
  const hwState = h("span", { class: "save-state" }), hwDue = h("p", { class: "small" });
  function paintDue() { hwDue.textContent = L().nextDate ? "Fällig zur nächsten Sitzung am " + fmtDay(L().nextDate) + " (richtet sich nach dem Datum der nächsten Sitzung dieser Klasse)." : "Noch keine spätere Sitzung dieser Klasse angelegt – Schüler:innen sehen „bis zur nächsten Sitzung“."; }
  let hwT = null;
  const saveHw = async () => {
    clearTimeout(hwT); hwT = null;
    try { const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { homework: hwTA.value } }); L().homework = r.lesson.homework; L().nextDate = r.lesson.nextDate; paintDue(); stateLine(hwState, "Gespeichert", "ok"); }
    catch (e) { stateLine(hwState, e.message, "err"); }
  };
  hwTA.addEventListener("input", () => { stateLine(hwState, "…"); clearTimeout(hwT); hwT = setTimeout(saveHw, 900); });
  hwTA.addEventListener("blur", () => { if (hwTA.value !== (L().homework || "")) saveHw(); });
  paintDue();
  const hwCard = h("section", { class: "card homework" }, h("div", { class: "section-title" }, h("h2", { text: "Hausaufgabe bis zur nächsten Sitzung" }), hwState),
    h("label", { for: "hw" }, "Hausaufgabe (für Schüler:innen sichtbar)"), hwTA, hwDue,
    h("div", { class: "row" }, h("button", { class: "btn small", type: "button", onclick: async () => toast((await copyText(homeworkForPortal(hwTA.value, L().code, L().nextDate)))
      ? (hwTA.value.trim() ? "Hausaufgabe kopiert" : "Keine Hausaufgabe eingetragen – nur der Hinweis auf die Sitzung kopiert") + " – im Schulportal in das Feld „Hausaufgabe“ einfügen." : "Bitte manuell kopieren.", "ok", 6000) }, "Für das Schulportal kopieren")),
    h("p", { class: "hint", text: "Schüler:innen sehen sie in dieser Sitzung direkt unter der Live-Präsentation und in ihrer Sitzungsliste. Schulportal-Zeichen (**fett**, ~~kursiv~~) sind erlaubt. " +
      "Beim Kopieren für das Schulportal setzt Unterricks die fette Überschrift „Hausaufgabe zum …:“ (Datum der nächsten Sitzung) davor, macht aus jeder Zeile einen Stichpunkt und ergänzt als letzten Stichpunkt „Unter " + PUBLIC_URL + " kannst du diese Sitzung mit dem Code " + formatCode(L().code) + " aufrufen …“ – in Unterricks sehen die Schüler:innen diesen Hinweis nicht." }));

  const presPromptCard = h("section", { class: "card" }, h("div", { class: "section-title" }, h("h2", { text: "Präsentation mit Claude erstellen" })),
    h("p", { class: "small", text: "Erzeugt einen ausführlichen Prompt für Claude (claude.ai), der eine vollständige PowerPoint-Präsentation samt PDF-Fassung für diese Stunde anfordert – auf Grundlage des aktuellen Schulportal-Eintrags, der Materialien und Ihrer Planung." }),
    presPromptBtn, presPromptOut);

  /* ======================= Materialien ======================= */
  const lists = { student: h("div", { class: "list" }), teacher: h("div", { class: "list" }) };
  function fileRow(f) {
    const other = f.area === "student" ? "teacher" : "student";
    const acts = h("div", { class: "acts" });
    if (f.kind === "text") {
      acts.append(h("button", { class: "btn small", type: "button", onclick: () => editText(f) }, "Ansehen/Bearbeiten"),
        h("button", { class: "btn small", type: "button", onclick: (e) => busy(e.currentTarget, async () => { try { const { markdownToPdf, pdfName } = await import("./pdfmaker.js"); downloadBlob(await markdownToPdf(f.name, f.text, { subtitle: subjectName(L().subject) + " · " + L().klass }), pdfName(f.name)); } catch (err) { errToast(err); } }) }, "PDF"));
    } else {
      acts.append(h("button", { class: "btn small", type: "button", onclick: (e) => busy(e.currentTarget, async () => { try { const r = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: {} }); downloadUrl(r.url, f.name); } catch (err) { errToast(err); } }) }, "Herunterladen"));
    }
    acts.append(
      h("button", { class: "btn small", type: "button", title: "In den anderen Bereich verschieben", onclick: async () => {
        try { const r = await tapi("PATCH", "/api/teacher/files/" + f.id, { body: { area: other } }); Object.assign(f, r.file); paintFiles(); toast(other === "student" ? "Jetzt für Schüler:innen sichtbar." : "Jetzt nur noch für Lehrkräfte.", "ok"); } catch (e) { errToast(e); }
      } }, icon("right"), other === "student" ? "Für Schüler:innen" : "Nur für Lehrkraft"),
      h("button", { class: "btn small ghost", type: "button", "aria-label": "Umbenennen", onclick: async () => {
        const n = prompt("Neuer Name:", f.name); if (!n) return;
        try { const r = await tapi("PATCH", "/api/teacher/files/" + f.id, { body: { name: n } }); Object.assign(f, r.file); paintFiles(); } catch (e) { errToast(e); }
      } }, icon("edit")),
      h("button", { class: "btn small ghost danger", type: "button", "aria-label": "Löschen", onclick: async () => {
        if (!(await confirmDialog("Datei löschen", "„" + f.name + "“ endgültig löschen?", "Löschen", true))) return;
        try { await tapi("DELETE", "/api/teacher/files/" + f.id); st.files = st.files.filter((x) => x !== f); paintFiles(); } catch (e) { errToast(e); }
      } }, icon("trash")));
    return h("div", { class: "item" }, fileIcon(f.name, f.mime, f.kind), h("div", { class: "main" }, h("div", { class: "name", text: f.name }),
      h("div", { class: "meta", text: (f.kind === "text" ? "Text (PDF-Download)" : fmtBytes(f.size)) + (f.source === "claude" ? " · von Claude" : f.source === "chat" ? " · aus dem Chat" : f.source === "vertretung" ? " · Vertretung" : f.source === "uebernommen" ? " · übernommen" : "") + " · " + fmtTime(f.createdAt) })), acts);
  }
  function paintFiles() {
    for (const area of ["student", "teacher"]) {
      const fs = st.files.filter((f) => f.area === area);
      clear(lists[area]).append(...(fs.length ? fs.map(fileRow) : [h("p", { class: "muted small", text: "Noch nichts hochgeladen." })]));
    }
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
  function dropZone(label, hint, onFiles, accept, multiple = true) {
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
  const filesCard = h("section", { class: "card" }, h("div", { class: "section-title" }, h("h2", { text: "Material" })),
    h("div", { class: "zones" },
      h("div", { class: "stack" }, h("h3", { text: "Für Schüler:innen zugänglich" }), dropZone("Dateien hier ablegen oder auswählen", "PDF, Bilder, Word, PowerPoint, Excel u. a. – bis 100 MB je Datei", uploadInto("student", progS)), progS, lists.student),
      h("div", { class: "stack" }, h("h3", { text: "Nur für Lehrkräfte" }), dropZone("Dateien hier ablegen oder auswählen", "Wird Schüler:innen nie angezeigt", uploadInto("teacher", progT)), progT, lists.teacher)),
    h("p", { class: "hint", text: "Materialien aus dem Chat übernehmen Sie mit „Als Material übernehmen“ unter einer Antwort; Claude kann über den Connector ebenfalls Material ablegen." }));
  paintFiles();

  /* ======================= Präsentation ======================= */
  const presCard = h("section", { class: "card" });
  let pendingPdf = null;
  async function paintPres() {
    const p = st.files.find((f) => f.area === "presentation");
    clear(presCard).append(h("div", { class: "section-title" }, h("h2", { text: "Präsentation für den Unterricht" })));
    const zone = dropZone(p ? "Andere Präsentation hochladen (ersetzt die bisherige)" : "PDF der Präsentation hier ablegen oder auswählen",
      "Nur PDF: in PowerPoint „Datei → Exportieren/Speichern unter → PDF“ – Claude liefert die PDF laut Prompt gleich mit.", (fs) => uploadPres(fs[0]), "application/pdf,.pdf", false);
    if (!p) { presCard.append(zone); return; }
    if (p.status !== "ready") {
      presCard.append(h("div", { class: "notice warn" }, "Die Folienbilder von „" + p.name + "“ wurden noch nicht vollständig erzeugt. Bitte die PDF erneut hochladen."), zone);
      return;
    }
    if (!st.slides) { try { st.slides = await tapi("GET", "/api/teacher/files/" + p.id + "/slides"); } catch (e) { errToast(e); } }
    const thumbs = h("div", { class: "thumbs" }, st.slides ? st.slides.urls.slice(0, 8).map((u, i) => h("img", { src: apiUrl(u), alt: "Folie " + (i + 1), loading: "lazy" })) : null);
    const liveLine = h("div", { class: "small" });
    const startBtn = h("button", { class: "btn onair big", type: "button" }, "Ich bin im Unterricht und starte die Präsentation für alle.");
    startBtn.addEventListener("click", async () => {
      try {
        const { startPresenter } = await import("./presenter.js");
        await startPresenter({ lessonId: id, file: p, token: T.token, slides: st.slides, startSlide: liveState && liveState.active ? liveState.slide : 1, onEnd: () => refreshLive() });
      } catch (e) { errToast(e); }
    });
    let liveState = null;
    async function refreshLive() {
      try {
        const r = await tapi("GET", "/api/teacher/lessons/" + id + "/live"); liveState = r.live;
        clear(liveLine).append(liveState.active ? h("span", null, h("span", { class: "badge onair" }, h("span", { class: "dot" }), "LIVE"), " Folie " + liveState.slide + " / " + liveState.pages + " · " + liveState.students + " verbunden ",
          h("button", { class: "btn small danger", type: "button", onclick: async () => { try { await tapi("POST", "/api/teacher/lessons/" + id + "/live/stop"); refreshLive(); } catch (e) { errToast(e); } } }, "Für alle beenden")) : h("span", { class: "muted", text: "Gerade nicht live." }));
      } catch {}
    }
    refreshLive();
    presCard.append(
      h("div", { class: "item" }, fileIcon(p.name, p.mime), h("div", { class: "main" }, h("div", { class: "name", text: p.name }), h("div", { class: "meta", text: p.pages + " Folien · " + fmtBytes(p.size) })),
        h("div", { class: "acts" }, h("button", { class: "btn small", type: "button", onclick: (e) => busy(e.currentTarget, async () => { try { const r = await tapi("POST", "/api/teacher/files/" + p.id + "/link", { body: { inline: true } }); window.open(r.url, "_blank", "noopener"); } catch (err) { errToast(err); } }) }, "PDF ansehen"),
          h("button", { class: "btn small ghost danger", type: "button", onclick: async () => {
            if (!(await confirmDialog("Präsentation löschen", "Präsentation und Folienbilder löschen? Eine laufende Live-Anzeige endet.", "Löschen", true))) return;
            try { await tapi("DELETE", "/api/teacher/files/" + p.id); st.files = st.files.filter((x) => x !== p); st.slides = null; paintPres(); } catch (e) { errToast(e); }
          } }, icon("trash")))),
      thumbs, startBtn, liveLine,
      h("p", { class: "hint", text: "Startet das Vollbild hier und zeigt dieselbe Folie oben in der Schüleransicht aller freigeschalteten Schüler:innen. Weiter mit →, Leertaste, Bildtaste (Presenter) oder Tippen; Schüler:innen können nicht selbst blättern. Die ganze PDF können sie erst 90 Minuten nach ihrem ersten Betreten selbst öffnen." }),
      h("details", { class: "box" }, h("summary", null, "Andere Präsentation hochladen"), zone));
  }
  async function uploadPres(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") { toast("Bitte eine PDF-Datei wählen.", "err"); return; }
    pendingPdf = file;
    clear(presCard).append(h("h2", { text: "Präsentation wird vorbereitet …" }));
    const bar = h("i"), label = h("p", { class: "small", text: "Lade „" + file.name + "“ hoch …" });
    presCard.append(label, h("div", { class: "progress" }, bar));
    try {
      const r = await upload("/api/teacher/lessons/" + id + "/presentation?name=" + encodeURIComponent(file.name), file, T.token, (p) => { bar.style.width = Math.round(p * 30) + "%"; }, "application/pdf");
      st.files = st.files.filter((f) => f.area !== "presentation"); st.files.push(r.file); st.slides = null;
      const { rasterizeAndUpload } = await import("./presenter.js");
      const out = await rasterizeAndUpload(pendingPdf, r.file.id, T.token, (i, n) => { label.textContent = "Erzeuge Folie " + i + " von " + n + " …"; bar.style.width = (30 + Math.round((i / n) * 70)) + "%"; });
      Object.assign(r.file, out.file);
      toast("Präsentation bereit (" + out.pages + " Folien).", "ok");
    } catch (e) { errToast(e); }
    pendingPdf = null; paintPres();
  }
  paintPres();

  /* ======================= Feibeitsblatt ======================= */
  const fbCard = h("section", { class: "card", id: "fbcard" });
  const fb = T.fb;
  async function paintFb() {
    if (analog) {
      clear(fbCard).append(...nn(h("h2", { text: "Feibeitsblatt" }), h("div", { class: "notice" }, "Jahrgang " + gradeKey(L().klass) + ": " + ANALOG_RULE),
        st.sheets.length ? h("p", { class: "small", text: "Verknüpfte Feibeitsblätter: " + st.sheets.map((x) => x.title + " (" + formatCode(x.code) + ")").join(", ") }) : null));
      return;
    }
    clear(fbCard).append(h("div", { class: "section-title" }, h("h2", { text: "Feibeitsblatt" }), fb.connected ? h("span", { class: "badge ok", text: "verbunden" }) : h("span", { class: "badge", text: "nicht verbunden" })));
    // Verbindung
    if (!fb.connected) {
      const door = h("input", { inputmode: "numeric", autocomplete: "off", placeholder: "Türcode", "aria-label": "Türcode des Feibeitsblatts", style: { maxWidth: "9rem" } });
      const pw = h("input", { type: "password", autocomplete: "off", placeholder: "Feibeitsblatt-Passwort", "aria-label": "Feibeitsblatt-Passwort" });
      const btn = h("button", { class: "btn primary", type: "submit" }, "Verbinden");
      fbCard.append(h("form", { class: "row", onsubmit: (e) => { e.preventDefault(); busy(btn, async () => { try { await fb.connect(door.value, pw.value); toast("Mit Feibeitsblatt verbunden.", "ok"); paintFb(); } catch (err) { errToast(err); } }, "Verbinde …"); } }, door, h("div", { class: "grow" }, pw), btn),
        h("p", { class: "hint", text: "Nötig zum Anlegen von Feibeitsblättern und zum Lesen der verschlüsselten Abgaben. Passwort und Schlüssel bleiben nur in diesem Browserfenster (bis zum Neuladen/Abmelden)." }));
    } else {
      const set = h("div", { class: "small muted", text: "Lade Einstellungen …" });
      fbCard.append(h("div", { class: "row between" }, set, h("button", { class: "btn small", type: "button", onclick: () => { fb.disconnect(); paintFb(); } }, "Verbindung trennen")));
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
      h("div", { class: "main" }, h("div", { class: "name", text: s.title }), h("div", { class: "meta" }, "Code ", h("strong", { class: "mono", text: formatCode(s.code) }), s.kind === "escape" ? " · Finale des Escape-Rooms (Schüler:innen gelangen über den Tunnel dorthin)" : " · für Schüler:innen sichtbar")),
      h("div", { class: "acts" }, h("button", { class: "btn small primary", type: "button", disabled: fb.connected ? null : true, title: fb.connected ? "" : "Erst verbinden", onclick: () => showSubmissions(s) }, "Abgaben ansehen"),
        h("button", { class: "btn small", type: "button", onclick: async () => toast((await copyText(formatCode(s.code))) ? "Code kopiert." : "Kopieren nicht möglich.", "ok") }, "Code kopieren"),
        h("button", { class: "btn small ghost danger", type: "button", "aria-label": "Aus der Sitzung entfernen", onclick: async () => {
          if (!(await confirmDialog("Feibeitsblatt entfernen", "„" + s.title + "“ aus dieser Sitzung entfernen? Das Blatt selbst bleibt im Feibeitsblatt erhalten.", "Entfernen", true))) return;
          try { await tapi("DELETE", "/api/teacher/lessons/" + id + "/sheets/" + s.code); st.sheets = st.sheets.filter((x) => x !== s); paintFb(); } catch (e) { errToast(e); }
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
        h("button", { class: "btn primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => { try { const r = await tapi("POST", "/api/teacher/lessons/" + id + "/sheets", { body: { code: code.value, title: title.value } }); st.sheets = st.sheets.filter((x) => x.code !== r.sheet.code).concat(r.sheet); paintFb(); } catch (err) { errToast(err); } }) }, "Verknüpfen"))));
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
    fbCard.append(h("h3", { style: { marginTop: "1rem" }, text: "Feibeitsblätter dieser Sitzung" }), sheetList, linkBox,
      h("h3", { style: { marginTop: "1rem" }, text: "Entwürfe" }), drafts.length ? draftList : h("p", { class: "muted small", text: "Keine offenen Entwürfe. Die KI schlägt in der Planung bei passender Gelegenheit ein Feibeitsblatt vor; den Entwurf erzeugen Sie hier." }),
      h("div", { class: "row" }, h("div", { class: "grow" }, wish), genBtn));
  }

  function editDraft(dr, opt = {}) {
    const data = JSON.parse(JSON.stringify(dr.data));
    const title = h("input", { value: data.title, maxlength: "200" });
    const tasksBox = h("div");
    const paintTasks = () => {
      clear(tasksBox);
      data.tasks.forEach((t, i) => {
        const text = h("textarea", { rows: "3", value: t.text, oninput: (e) => { t.text = e.target.value; } });
        const mat = h("textarea", { rows: "3", value: t.material || "", oninput: (e) => { t.material = e.target.value; } });
        const sol = h("textarea", { rows: "4", value: t.solution || "", oninput: (e) => { t.solution = e.target.value; } });
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
          h("div", { class: "field" }, h("label", null, "Aufgabenstellung"), text),
          h("div", { class: "field" }, h("label", null, "Material (optional, Text)"), mat),
          solBox,
          h("div", { class: "row" }, h("span", { class: "small", text: "Antwort als:" }), typ), tableBox,
          h("p", { class: "hint" + (t.answer.type === "photo" ? "" : " hidden"), text: "Foto: Die Schüler:innen fotografieren z. B. ihr Lernprodukt und laden das Bild hoch (verkleinert, ohne Ortsdaten, verschlüsselt). Fotos gehen nie an die KI – deshalb gibt es hier keinen Auftrag an die KI." })));
        solBox.append(h("div", { class: "field" }, h("label", null, "Auftrag an die KI (Einstellung der KI-Rückmeldung)"), sol,
          h("p", { class: "hint", text: "Worauf soll die KI beim Feedback achten? Erwartete Inhalte, Kriterien, typische Fehler – sie verrät den Schüler:innen die Lösung nicht. Leer = kein KI-Feedback zu dieser Aufgabe." })));
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
    modal({ title: opt.substitute ? "Feibeitsblatt der Vertretung prüfen" : "Feibeitsblatt prüfen und anlegen", wide: true, onClose: opt.onClose, body: (el) => el.append(...nn(
      opt.substitute ? h("div", { class: "notice" }, "Dieses Feibeitsblatt wird beim Bestätigen der Vertretung angelegt. Hier können Sie es vorher bearbeiten.")
        : fb.connected ? null : h("div", { class: "notice warn" }, "Zum Anlegen bitte zuerst im Abschnitt „Feibeitsblatt“ verbinden (Türcode und Passwort). Speichern geht auch ohne."),
      h("div", { class: "field", style: { marginTop: ".6rem" } }, h("label", null, "Titel"), title), tasksBox,
      h("button", { class: "btn small", type: "button", style: { marginTop: ".7rem" }, onclick: () => { data.tasks.push({ text: "", material: "", solution: "", answer: { type: "text" } }); paintTasks(); } }, "+ Aufgabe"))),
      actions: [
        { label: "Schließen" },
        { label: "Entwurf speichern", class: opt.substitute ? "primary" : "", onClick: async () => { try { await save(); paintFb(); if (opt.onSaved) opt.onSaved(); toast("Entwurf gespeichert.", "ok"); } catch (e) { errToast(e); return false; } } },
        ...(opt.substitute ? [] : [{ label: "Feibeitsblatt jetzt anlegen", class: "primary", onClick: async (e) => {
          if (!fb.connected) { toast("Bitte zuerst mit Feibeitsblatt verbinden.", "err"); return false; }
          if (!(await confirmDialog("Feibeitsblatt anlegen", "Das Blatt wird jetzt im Feibeitsblatt angelegt und erhält einen Code. Feibeitsblätter lassen sich danach nicht mehr ändern (nur neu anlegen).", "Anlegen"))) return false;
          try {
            const d2 = await save();
            const r = await fb.createSheet(d2.data);
            await tapi("POST", "/api/teacher/fb-drafts/" + dr.id + "/created", { body: { code: r.code, title: r.title } });
            dr.status = "created"; st.sheets.push({ code: r.code, title: r.title, createdAt: Date.now() }); paintFb();
            afterCreate(r);
          } catch (err) { errToast(err); return false; }
        } }]),
      ] });
  }

  // Geführter Abschluss: optional KI-Checkliste vorschlagen lassen und bestätigen
  function afterCreate(r) {
    modal({ title: "Feibeitsblatt angelegt", wide: true, body: (el) => {
      el.append(h("div", { class: "code-box" }, h("div", { class: "small muted", text: r.title }), h("div", { class: "code-big", text: formatCode(r.code) })),
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
              await fb.checklistSave(r.code, draft.ai !== false, tasks); toast("Checkliste bestätigt.", "ok");
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
  function photoNode(url, name) {
    const img = h("img", { src: url, alt: "Foto der Abgabe", class: "sub-photo", loading: "lazy" });
    return h("div", { class: "answer" }, img, h("div", { class: "row", style: { marginTop: ".3rem" } },
      h("button", { class: "btn small", type: "button", onclick: () => window.open(url, "_blank", "noopener") }, "Groß ansehen"),
      h("a", { class: "btn small", href: url, download: name || "Foto.jpg" }, "Foto speichern")));
  }
  function fbBlock(title, f, okLabel, missLabel) {
    const list = (arr) => h("ul", null, (Array.isArray(arr) ? arr : []).slice(0, 12).map((x) => h("li", { text: String(x).slice(0, 300) })));
    return h("div", { class: "fbk" }, h("div", { class: "k", text: title }),
      (f.covered || []).length ? h("div", null, okLabel + ":", list(f.covered)) : null, (f.missing || []).length ? h("div", null, missLabel + ":", list(f.missing)) : null, f.note ? h("div", { class: "muted", text: String(f.note).slice(0, 300) }) : null);
  }
  paintFb();

  /* ======================= Seitenleiste ======================= */
  const codeCard = h("section", { class: "card" }, h("h2", { text: "Sitzungscode" }),
    h("div", { class: "code-box" }, h("div", { class: "code-big", text: formatCode(L().code) }), h("div", { class: "small muted", text: L().studentCount + " Gerät" + (L().studentCount === 1 ? "" : "e") + " freigeschaltet" })),
    h("div", { class: "row", style: { marginTop: ".6rem" } },
      h("button", { class: "btn small", type: "button", onclick: async () => toast((await copyText(formatCode(L().code))) ? "Code kopiert." : "Kopieren nicht möglich.", "ok") }, "Kopieren"),
      h("button", { class: "btn small", type: "button", onclick: async () => (await import("./presenter.js")).showCode(formatCode(L().code), L().title) }, "Für den Beamer zeigen")),
    h("p", { class: "hint", text: "Der Code öffnet nur diese Sitzung – und nur für Schüler:innen, die " + (isCourseClass(L().klass)
      ? (courseMembers(cfg && cfg[L().subject], L().klass).length ? "eine der Klassen " + courseMembers(cfg[L().subject], L().klass).map(classShort).join(", ") : "eine Klasse dieses Kurses (noch keine eingetragen)")
      : classShort(L().klass)) + " und " + subjectName(L().subject) + " gewählt haben." }));

  const fTitle = h("input", { value: L().title, maxlength: "200" }), fTopic = h("input", { value: L().topic, maxlength: "500" });
  const fDate = h("input", { type: "date", value: L().date || "", required: true, "aria-label": "Datum der Sitzung" }), fDur = h("input", { type: "number", min: "5", max: "600", step: "5", value: L().durationMin || "" });
  const fIdeas = h("textarea", { rows: "4", value: L().ideas, placeholder: "Ideen, Wünsche, Materialhinweise …" });
  const metaState = h("span", { class: "save-state" });
  let metaT = null;
  const saveMeta = async () => {
    clearTimeout(metaT);
    try {
      const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { title: fTitle.value, topic: fTopic.value, durationMin: fDur.value ? Number(fDur.value) : null, ideas: fIdeas.value } });
      Object.assign(st.lesson, { title: r.lesson.title, topic: r.lesson.topic, durationMin: r.lesson.durationMin, ideas: r.lesson.ideas });
      heading.textContent = r.lesson.title; paintSubline(); stateLine(metaState, "Gespeichert", "ok");
    } catch (e) { stateLine(metaState, e.message, "err"); }
  };
  for (const el of [fTitle, fTopic, fDur, fIdeas]) { el.addEventListener("input", () => { stateLine(metaState, "…"); clearTimeout(metaT); metaT = setTimeout(saveMeta, 900); }); el.addEventListener("change", saveMeta); }
  // Datum ändern: nur diese Sitzung (keine Verschiebung folgender Sitzungen); das neue Datum steht auch in der Zeile der Einheit
  fDate.addEventListener("change", async () => {
    const nd = fDate.value, od = L().date;
    if (!nd) { fDate.value = od || ""; toast("Jede Sitzung braucht ein Datum.", "err"); return; }
    if (nd === od) return;
    try {
      const r = await tapi("PATCH", "/api/teacher/lessons/" + id, { body: { date: nd } });
      L().date = r.lesson.date; L().nextDate = r.lesson.nextDate; paintSubline(); paintDue();
      if (st.unit) { const x = (st.unit.rows || []).find((y) => y.uid === L().unitRow); if (x) x.date = nd; }
      stateLine(metaState, "Gespeichert", "ok");
      toast("Datum geändert" + (st.unit ? " – auch in der Unterrichtseinheit." : "."), "ok");
    } catch (e) { fDate.value = od || ""; errToast(e); }
  });
  const metaCard = h("section", { class: "card" }, h("div", { class: "section-title" }, h("h2", { text: "Sitzungsdaten" }), metaState),
    h("div", { class: "field" }, h("label", null, "Titel"), fTitle), h("div", { class: "field" }, h("label", null, "Thema"), fTopic),
    h("div", { class: "meta-grid" }, h("div", { class: "field" }, h("label", null, "Datum"), fDate), h("div", { class: "field" }, h("label", null, "Dauer (Minuten)"), fDur)),
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
        "Gespeichert wird nur, was Sie freigeben: Schulportal-Eintrag, Hausaufgabe, Materialien" + (analog ? "" : ", Feibeitsblatt-Entwurf") + (st.unit ? " und – nach Ihrer Zustimmung – eine geänderte Stundenfrage in der Einheit." : "."),
      after: "Wenn Claude gespeichert hat, kommen Sie hierher zurück: Die Seite übernimmt Schulportal-Eintrag, Hausaufgabe, Materialien und Entwürfe beim Zurückkehren automatisch.",
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

  const ps = d.previousStop;
  const prevCard = ps ? h("section", { class: "card prevstop", role: "note" },
    h("h2", { text: "Hinweis: Die letzte Stunde wurde nicht vollständig beendet" }),
    h("p", { class: "small" }, "In der vorigen Sitzung „", h("strong", { text: ps.title }), "“ (" + fmtDay(ps.date) + ") ist ein Zwischenstopp markiert. Ihr Schulportal-Eintrag:"),
    portalPreview(ps.portal),
    h("div", { class: "row", style: { marginTop: ".6rem" } }, h("a", { class: "btn small", href: "#/lk/s/" + ps.id }, "Vorige Sitzung öffnen"),
      h("button", { class: "btn small ghost", type: "button", onclick: (e) => e.currentTarget.closest(".prevstop").remove() }, "Ausblenden"))) : null;
  const sub = substituteCards({ id, st, L, ctx, fb, analog, reload: () => sessionPage(id), openDraft: (dr, o) => editDraft(dr, { substitute: true, ...o }), flushPortal });
  main.append(h("div", { class: "session-grid" },
    h("div", { class: "stack" }, sub.main, prevCard, planCard, unitCard, chatCard, portalCard, hwCard, presPromptCard, filesCard, presCard, fbCard),
    h("aside", { class: "side" }, codeCard, metaCard, sub.side)));

  // Änderungen von außen (z. B. Claude über den Connector) beim Zurückkehren übernehmen
  const onVis = async () => {
    if (document.visibilityState !== "visible") return;
    try {
      const r = await tapi("GET", "/api/teacher/lessons/" + id);
      if (r.messages.length !== st.messages.length && !sendBtn.disabled) { st.messages = r.messages; paintMsgs(); }
      const known = new Set(st.files.map((f) => f.id));
      if (r.files.some((f) => !known.has(f.id)) || r.files.length !== st.files.length) { st.files = r.files; paintFiles(); }
      if (r.drafts.length !== st.drafts.length || r.sheets.length !== st.sheets.length) { st.drafts = r.drafts; st.sheets = r.sheets; paintFb(); }
      const subKey = (x) => (x ? x.status + ":" + x.updatedAt : "");
      if (subKey(r.substitute) !== subKey(st.sub)) { st.drafts = r.drafts; st.sub = r.substitute; sub.paint(); if (r.substitute && r.substitute.status === "vorschlag") toast("Claude hat einen Vertretungsvorschlag gespeichert – bitte prüfen.", "ok", 6000); }
      if (r.unit && st.unit && r.unit.version !== st.unit.version) { st.unit = r.unit; paintUnit(); }
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
        if (r.lesson.date && r.lesson.date !== L().date) { L().date = r.lesson.date; L().nextDate = r.lesson.nextDate; fDate.value = r.lesson.date; paintDue(); changed = true; }
        if (changed) { heading.textContent = L().title; paintSubline(); stateLine(metaState, "Aktualisiert"); }
      }
      if (r.lesson.portalVersion !== portal.version && !portal.dirty) {
        L().portal = r.lesson.portal; L().portalVersion = r.lesson.portalVersion; L().portalUpdatedAt = r.lesson.portalUpdatedAt; L().portalSource = r.lesson.portalSource;
        portal.version = r.lesson.portalVersion;
        if (!portalTA && r.lesson.portal) showPortalEditor();
        else if (portalTA) { portalTA.value = r.lesson.portal; paintPreview(); setPresBtn(); setSaved("Aktualisiert (Version " + portal.version + (r.lesson.portalSource === "claude" ? ", von Claude" : "") + ")"); }
      }
    } catch {}
  };
  document.addEventListener("visibilitychange", onVis);
  const beforeUnload = (e) => { if (portal.dirty) { flushPortal(); e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", beforeUnload);
  onLeave(() => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("beforeunload", beforeUnload); if (portal.dirty) flushPortal(); clearTimeout(metaT);
    if (hwT) { clearTimeout(hwT); saveHw(); } document.querySelectorAll(".ctxmenu").forEach((m) => m.remove()); });
}

