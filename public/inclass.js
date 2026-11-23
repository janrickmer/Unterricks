// inclass.js – „Ich bin jetzt im Unterricht“ (Nachtrag 35 der Lehrkraft vom 16.11.2026): die Sitzung in kompakter Form für die Stunde selbst. Geladen erst bei
// Bedarf (inclassbar.js → lazy(import("./inclass.js"))); Gymnasium (session.js) und Grundschule (gssession.js) reichen ihre eigenen Wege herein (api) – die
// kompakte Ansicht baut nichts nach, was die Seite schon kann: dieselbe Präsentation (startLive → derselbe Präsentationsmodus, „Bis hier gezeigt“ über
// setShown samt Zwischenstopp aus Nachtrag 34), dasselbe Kontextmenü für den Zwischenstopp, dieselben Wege zum Öffnen und Herunterladen des Materials
// (materialbox.js openActs) und – an seinen Platz geliehen – dasselbe Hausaufgabenfeld (gleiches Speichern, gleicher Zustand, nichts geht beim Umschalten
// verloren). Gymnasium: Ein grüner Pfeil am rechten Rand des Verlaufsplans zeigt die Phase, in der die Live-Präsentation gerade ist (Live-Verbindung wie
// bei den Schüler:innen – WebSocket mit Wiederverbindung, ersatzweise höchstens alle 3 s abfragen; nur solange die Ansicht offen und der Tab sichtbar ist).
// Nachtrag 42 (Teil 2): Der Verlaufsplan steht hier kompakt – je Phase die Überschrift und darunter, was die Lehrkraft tut (Kurzplan von Claude bzw.
// automatisch gekürzt, compactPlan in inclasslib.js); der vollständige Verlaufsplan ist darunter aufklappbar.
import { h, clear, nn, toast, errToast, busy, modal, copyText, fmtBytes, fileIcon, downloadUrl, icon, wsUrl, stateLine, openLayerCount } from "./ui.js";
import { T, tapi } from "./teacher.js";
import { formatCode, hasStop, parsePortalMarkup, webUrlLabel, packMetaText, PACK_TITLE } from "./shared.js";
import { paintPortalPreview, runsNodes, stopField } from "./portalview.js";
import { ARROW_NAME, LIVE_POLL_MS, STAMP_POLL_MS, PRINT_TAG, materialColumns, materialKey, liveArrow, arrowText, liveSlideText, compactPlan, compactLabel, FULL_PLAN_LABEL, COMPACT_CONT,
  COMPACT_PARTIAL, COMPACT_REFS } from "./inclasslib.js";

const SCROLL_QUIET_MS = 12000;   // so lange nach dem letzten Tippen, Klicken oder Scrollen der Lehrkraft rollt die Seite nie von selbst zur Phase

/* Live-Stand für die Lehrkraft: WebSocket (Ticket der Rolle „teacher“ – sendet nichts, hört nur zu) mit Wiederverbindung; scheitert er zweimal, fragt sie
   ersatzweise alle LIVE_POLL_MS. begin()/stop() je nach Sichtbarkeit des Tabs. */
export function liveFeed(lessonId, onState, net = { tapi, WebSocket: typeof WebSocket === "function" ? WebSocket : null, wsUrl }) {
  // gen: jeder Verbindungsversuch (und stop) zählt weiter – ein Versuch, dessen Ticket erst nach stop()/begin() ankommt, öffnet nichts mehr (sonst blieben
  // nach kurzem Wegschalten zwei Verbindungen offen, eine davon nie geschlossen – Prüfbefund)
  let ws = null, closed = true, fails = 0, pollT = null, reT = null, got = 0, lastPoll = 0, gen = 0;
  // nie öfter als alle LIVE_POLL_MS – auch nicht, wenn Start, Rückfall und Rückkehr in den Tab kurz nacheinander fragen wollen
  const poll = async () => {
    if (closed || Date.now() - lastPoll < LIVE_POLL_MS - 100) return;
    lastPoll = Date.now();
    const n = got;
    try { const r = await net.tapi("GET", "/api/teacher/lessons/" + lessonId + "/live"); if (!closed && n === got && r && r.live) onState(r.live); } catch {}
  };
  const startPoll = () => { if (!pollT && !closed) { poll(); pollT = setInterval(poll, LIVE_POLL_MS); } };
  const end = (s) => { if (!s) return; clearInterval(s.uPing); try { s.close(); } catch {} };
  async function connect() {
    if (closed) return;
    const my = ++gen;
    try {
      if (!net.WebSocket) throw new Error("kein WebSocket");
      const t = await net.tapi("POST", "/api/teacher/lessons/" + lessonId + "/live-ticket");
      if (closed || my !== gen) return;
      const s = new net.WebSocket(net.wsUrl(t.url));
      const old = ws; ws = s;
      end(old);
      s.onopen = () => {
        if (ws !== s) { end(s); return; }
        fails = 0; clearInterval(pollT); pollT = null; s.uPing = setInterval(() => { try { s.send("ping"); } catch {} }, 25000);   // je Verbindung
      };
      s.onmessage = (ev) => { if (ws !== s || ev.data === "pong") return; got++; try { const m = JSON.parse(ev.data); if (m && (m.t === "state" || m.t === "count")) onState(m); } catch {} };
      s.onclose = () => { clearInterval(s.uPing); if (closed || ws !== s) return; fails++; if (fails >= 2) startPoll(); reT = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(fails, 4))); };
    } catch { if (closed || my !== gen) return; fails++; startPoll(); reT = setTimeout(connect, 5000); }
  }
  return {
    begin() { if (!closed) return; closed = false; fails = 0; poll(); connect(); },
    stop() { closed = true; gen++; clearInterval(pollT); pollT = null; clearTimeout(reT); const s = ws; ws = null; end(s); },
    running: () => !closed,
  };
}

/* Stand der Sitzung beobachten (Prüfbefund): Was ein anderes Gerät ändert – z. B. „Bis hier gezeigt“ samt Zwischenstopp auf dem iPad, während der Laptop diese
   Ansicht zeigt –, kommt sonst erst beim nächsten Wechsel in den Tab an (und ein Zwischenstopp von Hand scheiterte dann an der Version). check() fragt den
   kleinen Stand (…/stamp) und lädt die Sitzung bei einer Änderung neu; alle STAMP_POLL_MS, sofort beim Zurückkehren ins Fenster und wenn die Live-Präsentation
   beginnt oder endet (poke, höchstens alle 3 s). Nur solange die Ansicht offen und der Tab sichtbar ist. */
export function stampWatch(check, ms = STAMP_POLL_MS) {
  let on = false, t = null, pokeT = null, last = 0, busyNow = false, again = false;
  const tick = async () => {
    if (!on) return;
    if (busyNow) { again = true; return; }   // läuft schon: danach gleich noch einmal (nichts geht verloren)
    busyNow = true; last = Date.now();
    try { await check(); } catch {}
    busyNow = false;
    if (again && on) { again = false; tick(); }
  };
  return {
    begin() { if (on) return; on = true; tick(); t = setInterval(tick, ms); },
    stop() { on = false; again = false; clearInterval(t); t = null; clearTimeout(pokeT); pokeT = null; },
    // sofort – höchstens alle 3 s; ein Anstoß kurz nach der letzten Abfrage wartet bis dahin (nie verworfen)
    poke() { if (!on || pokeT) return; const wait = last + 3000 - Date.now(); if (wait <= 0) tick(); else pokeT = setTimeout(() => { pokeT = null; tick(); }, wait); },
    running: () => on,
  };
}

/* Element vorübergehend in die kompakte Ansicht holen (dasselbe Element – Eingaben, Zustand, Zeitgeber bleiben); → zurückgeben */
function borrow(el, into) {
  if (!el) return () => {};
  const mark = document.createComment("inclass");
  if (el.parentNode) el.parentNode.insertBefore(mark, el);
  into.append(el);
  return () => { if (mark.parentNode) mark.replaceWith(el); else el.remove(); };
}
/* Neu zeichnen, ohne den Fokus zu verlieren: vorher das fokussierte Element (über key) merken, danach dasselbe wieder fokussieren – nur, wenn der Fokus sonst
   verloren wäre (auf body gefallen) */
function keepFocus(box, keyOf, paint) {
  const a = document.activeElement, k = a && a !== box && box.contains(a) ? keyOf(a) : null;
  paint();
  const now = document.activeElement;
  if (k === null || (now && now !== document.body && now.isConnected)) return;
  const n = [...box.querySelectorAll("a, button")].find((x) => keyOf(x) === k);
  if (n) n.focus({ preventScroll: true });
}
const linkKey = (box) => (el) => { const all = [...box.querySelectorAll("a, button")]; return el.dataset && el.dataset.k ? el.dataset.k : String(all.indexOf(el)); };
const labelled = (el, name) => { if (el && (el.tagName === "BUTTON" || el.tagName === "A") && !el.getAttribute("aria-label")) el.setAttribute("aria-label", el.textContent.trim() + " – " + name); return el; };

/* Der grüne Pfeil: Form (Pfeil nach links mit „jetzt“) und Name für Screenreader – nie nur Farbe */
function arrowEl() {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), p = document.createElementNS(ns, "path");
  svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("class", "ico"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("focusable", "false");
  p.setAttribute("d", "M20 12H5M11 5l-7 7 7 7");
  svg.append(p);
  return h("span", { class: "phasearrow", role: "img", "aria-label": ARROW_NAME, title: ARROW_NAME }, svg, h("span", { class: "pa-t", "aria-hidden": "true", text: "jetzt" }));
}

/* Zwischenstopp per Tastatur (Gymnasium; die Grundschule hat ihren eigenen Dialog): vor welcher Zeile? – wie „Zwischenstopp eintragen …“ der Grundschule */
function stopLineDialog(text, preselect, onPick) {
  const lines = parsePortalMarkup(text), opts = [];
  const plain = (ln) => ln.runs.map((r) => r.text).join("").trim();
  lines.forEach((ln, i) => { if (ln.type === "p" || ln.type === "li") opts.push({ i, label: (ln.type === "li" ? "• " : "") + (plain(ln) || "(leer)") }); });
  if (!opts.length) { toast("Der Verlaufsplan ist noch leer – erst danach lässt sich ein Zwischenstopp eintragen.", "err"); return; }
  const stopIdx = lines.findIndex((ln) => ln.type === "stop");
  let pre = opts.findIndex((o) => o.i === preselect);
  if (pre < 0) pre = Math.max(0, stopIdx >= 0 ? opts.findIndex((o) => o.i > stopIdx) : 0);
  let close = null;
  const apply = () => { const sel = list.querySelector("input:checked"); if (!sel) return false; onPick(Number(sel.value)); return true; };
  const list = h("fieldset", { class: "stoplist" }, h("legend", { text: "Vor welcher Zeile soll der Zwischenstopp stehen?" }),
    opts.map((o, k) => h("label", { class: "checkrow" }, h("input", { type: "radio", name: "ic-stop", value: String(o.i), checked: k === pre ? true : null }), h("span", { text: o.label }))));
  list.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); if (apply() && close) close(); } });
  const m = modal({ title: "Wo haben Sie aufgehört?", wide: true, body: (el) => el.append(
    h("p", { class: "small", text: "Der Zwischenstopp steht vor der ersten Zeile, die nicht mehr geschafft wurde. Er bleibt intern und wird nicht ins Schulportal kopiert." }), list),
    actions: [{ label: "Abbrechen" }, { label: "Zwischenstopp eintragen", class: "primary", onClick: () => (apply() ? undefined : false) }] });
  close = m.close;
  const cur = list.querySelector("input:checked"); if (cur) cur.focus();
}

/* api (session.js bzw. gssession.js):
   kind "gym" | "gs", id, st (files, sheets), selbstlern(), on(Art, fn) → abmelden (Art "plan": Verlaufsplan neu gezeichnet, "files": Material/Präsentation),
   planText(), paintPlan(box), planState (Zustandszeile der vollständigen Ansicht), stopMenu(Zeile, x, y), stopDialog?() (Grundschule), insertStop?(Zeile)
   (Gymnasium), dropStop(), stopNext() (Hinweis nach dem Setzen), openActs(f, druck), badge?(f) (Grundschule: „Eltern sehen sie“), homework (Element),
   homeworkWrap (Grundschule: nur das Feld – die Karte baut diese Ansicht), Gymnasium: pres(), annotated(p), startLive(fokusDanach).
   Nachtrag 42: teacherPlan() (Kurzplan der Sitzung, lessonOut.teacherPlan | null), planRuns(runs) (Läufe des Plans → Knoten; Grundschule mit gelben
   PDF-Verweisen). → {el, destroy()} */
export function inClassView(api) {
  const gym = api.kind === "gym";
  const offs = [], gives = [];
  const el = h("div", { class: "inclass-view" + (gym ? "" : " ic-gs") });

  /* ======================= 1. Präsentation (nur Gymnasium) ======================= */
  let live = null, startBtn = null;
  const presCard = gym ? h("section", { class: "card ic-card ic-pres", id: "ic-pres", "aria-labelledby": "ic-pres-h" }) : null;
  const liveLine = h("p", { class: "small ic-live", id: "ic-live" });
  const dl = (f, label, cls) => labelled(h("button", { class: "btn" + (cls ? " " + cls : ""), type: "button", onclick: (e) => busy(e.currentTarget, async () => {
    try { const r = await tapi("POST", "/api/teacher/files/" + f.id + "/link", { body: {} }); downloadUrl(r.url, f.name); } catch (err) { errToast(err); }
  }) }, icon("download"), label), f.name);
  let presKey = null;
  function paintPres() {
    if (!gym) return;
    const p = api.pres(), a = p ? api.annotated(p) : null;
    const key = p ? [p.id, p.status, p.name, p.pages, a ? a.id + a.name : ""].join("|") : "";
    if (key === presKey) return;
    presKey = key;
    const had = presCard.contains(document.activeElement);
    clear(presCard).append(h("h2", { id: "ic-pres-h", text: "Präsentation" }));
    if (!p) { presCard.append(h("p", { class: "muted", text: "Für diese Sitzung ist noch keine Präsentation hochgeladen – das geht in der vollständigen Ansicht unter „Präsentation für den Unterricht“." })); startBtn = null; return; }
    const ready = p.status === "ready";
    startBtn = ready ? h("button", { class: "btn onair big", type: "button", id: "ic-start", onclick: () => api.startLive(() => startBtn) }, icon("play"), "Präsentation live starten") : null;
    presCard.append(...nn(h("div", { class: "row ic-presacts" }, ...nn(startBtn, dl(p, "Präsentation als PDF-Datei herunterladen"),
      a ? dl(a, "Präsentation mit Anmerkungen herunterladen", "ic-notes") : null)),
      ready ? liveLine : h("div", { class: "notice warn", text: "Die Folienbilder von „" + p.name + "“ wurden noch nicht vollständig erzeugt – live starten lässt sie sich erst nach erneutem Hochladen in der vollständigen Ansicht." }),
      // der Satz zum Live-Start nur, wenn es den Knopf gibt (Prüfbefund: sonst verwies er auf einen fehlenden Knopf)
      ready ? h("p", { class: "hint", text: "„Präsentation live starten“ öffnet denselben Präsentationsmodus wie in der vollständigen Ansicht; läuft die Präsentation schon – auch auf einem anderen Gerät –, geht es an der laufenden Stelle weiter. " +
        "Am Ende der Stunde markieren Sie dort mit „Bis hier gezeigt“ die letzte gezeigte Folie – den Zwischenstopp im Verlaufsplan trägt Unterricks dann selbst ein." +
        (a ? " Die Präsentation mit Anmerkungen (jede Folie mit Ihren Notizen) ist nur für Sie." : "") }) : null));
    paintLive();
    // neu aufgebaut, während der Fokus darin war (z. B. andere Präsentation): nie auf der Seite verlieren
    if (had && (!document.activeElement || document.activeElement === document.body)) { const n = startBtn || presCard.querySelector("button"); if (n) n.focus({ preventScroll: true }); }
  }
  function paintLive() {
    if (!gym) return;
    const p = api.pres();
    if (p && p.status !== "ready") clear(liveLine);
    else if (live && live.active && (!live.fileId || !p || live.fileId === p.id)) {
      clear(liveLine).append(h("span", { class: "badge onair" }, h("span", { class: "dot" }), "LIVE"), " " + liveSlideText(live) + (Number.isInteger(live.students) ? " · " + live.students + " verbunden" : ""));
    } else clear(liveLine).append(h("span", { class: "muted", text: live === null ? "Der Stand der Live-Präsentation wird geladen …" : live.active ? "Live läuft gerade eine andere Präsentation." : "Gerade nicht live." }));
  }

  /* ======================= 2. Verlaufsplan ======================= */
  const planBox = h("div", { class: "portal-preview ic-plan" + (gym ? " ic-arrowed" : " gsplan-view"), id: "ic-plan", "aria-label": gym ? "Verlaufsplan (Schulportal-Eintrag)" : "Verlaufsplan" });
  // Nachtrag 42: welche Fassung die kompakte Liste zeigt („Kurzplan von Claude“ bzw. „Automatisch gekürzt – …“) und darunter aufklappbar der vollständige Verlaufsplan
  const srcLine = h("p", { class: "small ic-plansrc hidden", id: "ic-plan-src" });
  const fullBox = h("div", { class: "portal-preview ic-planfull" + (gym ? "" : " gsplan-view"), id: "ic-plan-full", "aria-label": gym ? "Vollständiger Verlaufsplan (Schulportal-Eintrag)" : "Vollständiger Verlaufsplan" });
  const more = h("details", { class: "box ic-planmore hidden", id: "ic-plan-more" }, h("summary", { text: FULL_PLAN_LABEL }), fullBox);
  const emptyPlan = h("p", { class: "muted hidden", text: gym ? "Noch kein Schulportal-Eintrag – er entsteht beim Planen mit Claude oder in der vollständigen Ansicht." : "Noch kein Verlaufsplan – Claude schreibt ihn beim Planen, oder Sie tragen ihn in der vollständigen Ansicht ein." });
  const arrowHint = h("p", { class: "small ic-arrowhint", id: "ic-arrow-hint" });
  const planState = h("span", { class: "save-state", id: "ic-plan-state" });
  const stopBtn = h("button", { class: "btn", type: "button", id: "ic-stop" }, icon("pause"), "Zwischenstopp eintragen …");
  const unstopBtn = h("button", { class: "btn ghost hidden", type: "button", id: "ic-unstop" }, "Zwischenstopp entfernen");
  const stopNext = h("p", { class: "hint stopnext hidden", id: "ic-stop-next" });
  const arrow = gym ? arrowEl() : null;
  // das Öffnen (bzw. Wiederherstellen nach dem Neuladen) zählt als Handlung: die Seite rollt nicht gleich danach von selbst (Prüfbefund)
  let arrowLine = null, lastUser = Date.now();
  const planCard = h("section", { class: "card ic-card ic-plancard", id: "ic-plancard", "aria-labelledby": "ic-plan-h" },
    h("div", { class: "section-title" }, h("h2", { id: "ic-plan-h" }, "Verlaufsplan", gym ? h("span", { class: "small muted ic-sub", text: " · Schulportal-Eintrag" }) : null), planState),
    gym ? arrowHint : null, srcLine, emptyPlan, planBox, more,
    h("div", { class: "row ic-stopacts" }, stopBtn, unstopBtn), stopNext,
    h("p", { class: "hint", text: "Zwischenstopp: Rechtsklick auf eine Phase oder Zeile (am iPad: antippen) → „Zwischenstopp einfügen“ – er steht dann vor ihr – oder „Zwischenstopp eintragen …“." +
      (gym ? " Er bleibt intern und wird nicht ins Schulportal kopiert." : " Eltern sehen nur das Material bis dorthin.") }));
  stopBtn.addEventListener("click", () => {
    if (!gym) { api.stopDialog(); return; }
    stopLineDialog(api.planText(), arrowLine, (line) => api.insertStop(line));
  });
  unstopBtn.addEventListener("click", () => {
    api.dropStop();
    const a = document.activeElement;
    if (unstopBtn.classList.contains("hidden") && (!a || a === document.body || a === unstopBtn)) stopBtn.focus();
  });
  // dasselbe Kontextmenü wie in der vollständigen Ansicht; am iPad (kein Rechtsklick) öffnet Antippen einer Zeile es – in der kompakten Liste trägt jede Phase
  // die Zeile ihrer Überschrift (der Zwischenstopp kommt dann vor die Phase), im aufgeklappten vollständigen Verlaufsplan jede Zeile ihre eigene
  for (const box of [planBox, fullBox]) {
    box.addEventListener("contextmenu", (e) => { const ln = e.target.closest("[data-line]"); if (!ln || e.shiftKey) return; e.preventDefault(); api.stopMenu(Number(ln.dataset.line), e.clientX, e.clientY); });
    box.addEventListener("click", (e) => {
      if (!window.matchMedia("(pointer: coarse)").matches || e.target.closest("a, button")) return;
      const ln = e.target.closest("[data-line]"); if (ln) api.stopMenu(Number(ln.dataset.line), e.clientX, e.clientY);
    });
  }
  /* kompakte Liste (Nachtrag 42): je Phase ein Block mit der Zeile ihrer Überschrift (data-line – Pfeil, Kontextmenü, Zwischenstopp), darin die fette Überschrift
     und die Anweisungen an die Lehrkraft; „--> Nächste Stunde“ und der Zwischenstopp (mit Abdeckblatt wie in der Vorschau) an ihrer Stelle */
  const runsOf = (runs) => (api.planRuns ? api.planRuns(runs) : runsNodes(runs));
  function paintCompact(box, cp) {
    clear(box);
    let target = box;
    for (const it of cp.items) {
      if (it.type === "stop") {
        box.append(h("div", { class: "icp-stop", dataset: { line: String(it.line) } }, stopField()));
        target = h("div", { class: "covered", "aria-label": gym ? "Noch nicht aufgedeckt (nach dem Zwischenstopp)" : "Noch nicht geschafft (nach dem Zwischenstopp)" });
        box.append(target);
      } else if (it.type === "next") target.append(h("p", { class: "pl icp-next", dataset: { line: String(it.line) } }, runsOf(it.runs)));
      else target.append(h("div", { class: "icp-phase" + (it.auto ? " icp-auto" : "") + (it.cont ? " icp-cont" : ""), dataset: { line: String(it.line), phase: String(it.n) } },
        // der Rest einer Phase nach dem Zwischenstopp (unter dem Abdeckblatt): dieselbe Überschrift mit „(Fortsetzung)“
        h("p", { class: "pl icp-head" }, runsOf(it.head), it.cont ? h("span", { class: "icp-contmark", text: " " + COMPACT_CONT }) : null),
        it.steps.length ? h("ul", { class: "icp-steps" }, it.steps.map((x) => h("li", { class: "icp-step" + (x.kind === "gist" ? " icp-gist" : "") }, runsOf(x.runs)))) : null,
        // Grundschule, Kurzplan von Claude: die gelben Verweise der Aufforderungen an die Lehrkraft (Claude schreibt schlichten Text)
        it.refs ? h("p", { class: "small icp-refs" }, COMPACT_REFS + " ", it.refs.map((r, k) => [k ? " · " : null, runsOf([r])])) : null,
        // Anweisungen von Claude für eine Phase, in der der Zwischenstopp liegt
        it.partial ? h("p", { class: "small icp-partial", text: COMPACT_PARTIAL }) : null));
    }
  }
  function paintPlan() {
    const text = api.planText(), has = !!String(text || "").trim();
    // ohne nummerierte Phasen („**1) …**“) gibt es nichts zu kürzen: dann steht hier der vollständige Verlaufsplan wie bisher
    const cp = has ? compactPlan(text, { gs: !gym, teacherPlan: api.teacherPlan ? api.teacherPlan() : null }) : null, compact = !!cp && cp.mode !== "full";
    keepFocus(planBox, linkKey(planBox), () => { if (!has) clear(planBox); else if (compact) paintCompact(planBox, cp); else api.paintPlan(planBox); });
    keepFocus(fullBox, linkKey(fullBox), () => { if (compact) api.paintPlan(fullBox); else clear(fullBox); });
    planBox.classList.toggle("ic-compact", compact); more.classList.toggle("hidden", !compact); srcLine.classList.toggle("hidden", !compact);
    // der Name sagt, dass hier die kompakte Liste steht, der Satz darüber (welche Fassung) beschreibt sie (Befund der Gegenprüfung)
    planBox.setAttribute("aria-label", (compact ? "Verlaufsplan kompakt" : "Verlaufsplan") + (gym ? " (Schulportal-Eintrag)" : ""));
    if (compact) planBox.setAttribute("aria-describedby", "ic-plan-src"); else planBox.removeAttribute("aria-describedby");
    srcLine.textContent = compact ? compactLabel(cp, !gym) : "";
    srcLine.classList.toggle("ic-fromclaude", compact && cp.mode === "claude");
    planBox.classList.toggle("hidden", !has); emptyPlan.classList.toggle("hidden", has);
    unstopBtn.classList.toggle("hidden", !hasStop(text));
    // Hinweis nach dem Setzen („Zwischenstopp gesetzt. …“) – derselbe wie in der vollständigen Ansicht
    const src = api.stopNext(), shown = !!src && !src.classList.contains("hidden");
    stopNext.classList.toggle("hidden", !shown);
    if (shown) clear(stopNext).append(...[...src.childNodes].map((n) => n.cloneNode(true)));
    arrowLine = null;   // neu gezeichnet: der Pfeil sitzt neu an seiner Zeile
    paintArrow(false);
  }
  // Zustand des Speicherns aus der vollständigen Ansicht (dort ausgeblendet) – z. B. „Nicht gespeichert: …“ nach einem Zwischenstopp ohne Netz
  const mirrorState = () => { const s = api.planState; if (!s) return; clear(planState).append(...[...s.childNodes].map((n) => n.cloneNode(true))); if (s.dataset.state) planState.dataset.state = s.dataset.state; else delete planState.dataset.state; };
  let stateObs = null;
  if (api.planState && typeof MutationObserver === "function") { stateObs = new MutationObserver(mirrorState); stateObs.observe(api.planState, { childList: true, subtree: true, characterData: true, attributes: true }); }

  /* ---- grüner Pfeil (Gymnasium): Phase der aktuellen Live-Folie ---- */
  function paintArrow(scroll) {
    if (!gym) return;
    const r = liveArrow({ live, pres: api.pres(), portalText: api.planText() });
    // noch kein Stand vom Server: nicht behaupten, die Präsentation laufe nicht
    const t = live === null && r.why === "idle" ? "Der Stand der Live-Präsentation wird geladen …" : arrowText(r);
    if (arrowHint.textContent !== t) arrowHint.textContent = t;
    const line = r.head ? r.head.line : null;
    const target = line !== null ? planBox.querySelector('[data-line="' + line + '"]') : null;
    if (!target) { for (const x of planBox.querySelectorAll(".ic-now")) x.classList.remove("ic-now"); arrow.remove(); arrowLine = null; return; }
    if (arrow.parentNode !== target) {
      for (const x of planBox.querySelectorAll(".ic-now")) x.classList.remove("ic-now");
      target.classList.add("ic-now"); target.prepend(arrow);
    }
    const moved = line !== arrowLine;
    arrowLine = line;
    if (scroll && moved) scrollToPhase(target);
  }
  // die Phase ins Bild holen – nur, wenn die Lehrkraft gerade nichts tut (nicht tippt, scrollt oder klickt), nie mit dem Fokus und nie in einen offenen Dialog
  // (Scrollen zählt mit, außer dem eigenen: scrollIntoView unten löst selbst Scroll-Ereignisse aus)
  let selfScrollUntil = 0;
  const userActs = ["wheel", "touchstart", "pointerdown", "keydown", "scroll"], mark = (e) => { if (e.type !== "scroll" || Date.now() > selfScrollUntil) lastUser = Date.now(); };
  if (gym) for (const ev of userActs) window.addEventListener(ev, mark, { capture: true, passive: true });
  function scrollToPhase(target) {
    if (Date.now() - lastUser < SCROLL_QUIET_MS || openLayerCount() || document.visibilityState !== "visible") return;
    const a = document.activeElement;
    if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT" || a.tagName === "SELECT" || a.isContentEditable)) return;
    const r = target.getBoundingClientRect(), top = 80;
    if (r.top >= top && r.bottom <= window.innerHeight - 20) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    selfScrollUntil = Date.now() + 1500;
    target.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  }

  /* ======================= 3. Material ======================= */
  const matCard = h("section", { class: "card ic-card ic-matcard", id: "ic-material", "aria-labelledby": "ic-mat-h" }, h("h2", { id: "ic-mat-h", text: "Material" }));
  const matBox = h("div", { class: "ic-mat" });
  matCard.append(matBox);
  let matKey = null;
  function sheetItem(s) {
    const url = (T.config && T.config.feibeitsblattUrl) || "";
    return h("li", { class: "ic-item" }, h("div", { class: "ficon fb", "aria-hidden": "true", text: "FB" }),
      h("div", { class: "ic-main" }, h("div", { class: "ic-name", text: s.title }), h("div", { class: "ic-meta" }, "Feibeitsblatt · Code ", h("strong", { class: "mono", text: formatCode(s.code) })),
        api.sheetBadge ? api.sheetBadge(s) : null),   // Nachtrag 44: wartet auf seine Materialfolie bzw. seit wann sichtbar
      h("div", { class: "ic-acts" }, labelled(h("button", { class: "btn", type: "button", dataset: { k: "s:" + s.code }, onclick: async () => {
        // wie bei den Schüler:innen: Code kopieren und das Feibeitsblatt in einem neuen Tab öffnen
        const ok = await copyText(formatCode(s.code));
        if (url) window.open(url, "_blank", "noopener");
        toast(ok ? "Code " + formatCode(s.code) + " kopiert – im Feibeitsblatt einfügen." : "Bitte den Code " + formatCode(s.code) + " im Feibeitsblatt eintippen.", "ok", 6000);
      } }, icon("link"), "Code kopieren und Feibeitsblatt öffnen"), s.title)));
  }
  function fileItem(e) {
    const f = e.file, name = e.print && f.printName ? f.printName : f.name;
    const { acts, meta } = api.openActs(f, !!e.print);
    acts.forEach((a, i) => { if (a.dataset) a.dataset.k = f.id + (e.print ? ":p" : "") + ":" + i; labelled(a, name); });
    const metaText = f.kind === "link" ? "Link · " + webUrlLabel(f.url) : f.kind === "text" ? "Text (als PDF)" : f.size ? fmtBytes(f.size) : "";
    const badge = api.badge && !e.print && f.area === "student" ? api.badge(f) : null;
    return h("li", { class: "ic-item" + (e.print ? " ic-print" : "") + (e.member ? " ic-member" : "") }, fileIcon(f.name, f.mime, f.kind),
      h("div", { class: "ic-main" }, h("div", { class: "ic-name", text: name }),
        e.tags.length ? h("div", { class: "ic-tags" }, e.tags.map((t) => h("span", { class: "badge" + (t === PRINT_TAG ? " ic-printtag" : "") }, t === PRINT_TAG ? icon("printer") : null, t))) : null,
        h("div", { class: "ic-meta" }, meta || metaText), badge),
      h("div", { class: "ic-acts" }, acts));
  }
  /* Sitzungspaket (Nachtrag 42): eine Zeile mit dem Namen des Pakets und „Herunterladen“ (die Dateien zu einer PDF, wie in der Druckliste), darunter klein
     seine Dateien mit ihren eigenen Knöpfen */
  function packItem(e) {
    const { acts } = api.packActs(e.pack);
    acts.forEach((a, i) => { if (a.dataset) a.dataset.k = "k:" + e.pack.key + ":" + i; labelled(a, e.pack.name); });
    return h("li", { class: "ic-item ic-pack" }, fileIcon(e.pack.name, "application/pdf", "file"),
      h("div", { class: "ic-main" }, h("div", { class: "ic-name", text: e.pack.name }),
        h("div", { class: "ic-tags" }, h("span", { class: "badge ic-printtag" }, icon("printer"), PRINT_TAG), h("span", { class: "badge", text: PACK_TITLE })),
        h("div", { class: "ic-meta", text: packMetaText(e.pack) })),
      h("div", { class: "ic-acts" }, acts),
      h("ul", { class: "ic-list ic-members", "aria-label": "Dateien im " + PACK_TITLE }, e.members.map(fileItem)));
  }
  function paintMaterial() {
    const cols = materialColumns(api.st.files, gym ? api.st.sheets : [], { gs: !gym, selbstlern: api.selbstlern(), refCards: api.refCards ? api.refCards() : [], packs: api.packs ? api.packs() : [] });
    // mit dem Stand „Material erscheint mit seiner Materialfolie“ (Nachtrag 44): wird ein Material freigegeben, ändern sich seine Hinweise
    const key = materialKey(cols) + (api.revealKey ? "\n#" + api.revealKey() : "");
    if (key === matKey) return;
    matKey = key;
    const col = (id, title, list, empty) => h("section", { class: "ic-col", "aria-labelledby": id }, h("h3", { id, text: title }),
      list.length ? h("ul", { class: "ic-list" }, list.map((e) => (e.type === "sheet" ? sheetItem(e.sheet) : e.type === "pack" ? packItem(e) : fileItem(e)))) : h("p", { class: "muted small ic-empty", text: empty }));
    keepFocus(matBox, (x) => (x.dataset && x.dataset.k) || null, () => clear(matBox).append(
      col("ic-col-s", gym ? "Für Schüler:innen sichtbar" : "Für die Kinder sichtbar", cols.student, gym ? "Kein Material für Schüler:innen." : "Kein Material für die Kinder."),
      col("ic-col-t", "Nur für die Lehrkraft", cols.teacher, "Kein Material nur für die Lehrkraft.")));
  }

  /* ======================= 4. Hausaufgabe – dasselbe Feld wie in der vollständigen Ansicht ======================= */
  let hwCard = api.homework;
  if (api.homeworkWrap) { hwCard = h("section", { class: "card ic-card ic-hw", id: "ic-hw", "aria-labelledby": "ic-hw-h" }, h("h2", { id: "ic-hw-h", text: "Hausaufgabe" })); gives.push(borrow(api.homework, hwCard)); }
  const hwSlot = h("div", { class: "ic-hwslot" });
  if (!api.homeworkWrap) gives.push(borrow(hwCard, hwSlot)); else hwSlot.append(hwCard);

  el.append(...nn(presCard, planCard, matCard, hwSlot));
  paintPres(); paintPlan(); mirrorState(); paintMaterial();
  offs.push(api.on("plan", () => { paintPlan(); paintMaterial(); }), api.on("files", () => { paintPres(); paintMaterial(); paintArrow(false); }));

  /* ---- Live-Verbindung und Stand der Sitzung: nur solange diese Ansicht offen und der Tab sichtbar ist ---- */
  let feed = null, onVis = null, onFocus = null;
  const watch = api.checkStamp ? stampWatch(api.checkStamp) : null;
  if (gym) {
    feed = liveFeed(api.id, (m) => {
      if (m.t === "count") { if (live) { live.students = m.students; paintLive(); } return; }
      const flip = !live || !!live.active !== !!m.active || live.fileId !== m.fileId;   // Präsentation beginnt bzw. endet: oft wurde gerade markiert
      // Material freigegeben (Nachtrag 44: Materialfolie live gezeigt bzw. von Hand) – der Stand der Sitzung bringt die neuen Hinweise
      const revealed = !!live && (Number(m.revealAt) || 0) > (Number(live.revealAt) || 0);
      live = m; paintLive(); paintArrow(true);
      if ((flip || revealed) && watch) watch.poke();
    });
  }
  if (feed || watch) {
    onVis = () => { const on = document.visibilityState === "visible"; for (const x of [feed, watch]) if (x) { if (on) x.begin(); else x.stop(); } };
    document.addEventListener("visibilitychange", onVis);
    if (document.visibilityState !== "hidden") { if (feed) feed.begin(); if (watch) watch.begin(); }
  }
  if (watch) { onFocus = () => watch.poke(); window.addEventListener("focus", onFocus); }
  return {
    el,
    destroy() {
      if (feed) feed.stop();
      if (watch) watch.stop();
      if (onFocus) window.removeEventListener("focus", onFocus);
      if (onVis) document.removeEventListener("visibilitychange", onVis);
      for (const ev of userActs) window.removeEventListener(ev, mark, { capture: true });
      for (const off of offs.splice(0)) { try { off(); } catch {} }
      if (stateObs) stateObs.disconnect();
      for (const g of gives.splice(0)) g();
      document.querySelectorAll(".ctxmenu").forEach((m) => m.remove());
    },
  };
}
