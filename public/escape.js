// escape.js – Escape-Room der Plattform im Aufbau der Escape-Rooms der Lehrkraft: Anmeldung → Einführung → 6 × (Bibliothek →
// Rätselraum, kein Weg zurück) → Buchstaben des Lösungsworts → Finale im Feibeitsblatt (Tunnel mit Datensatz v1). Hilfe in drei
// Stufen, Fehler im ersten Versuch, Zwischenstand-Datei ab Station 2, Überblick-PDF mit eingebettetem Datensatz.
// Fortschritt liegt nur im Browser (wie in den bekannten Räumen): Neuladen kostet ihn – vorher wird gefragt.
import { h, clear, toast, errToast, busy, modal, confirmDialog, api, store, nn } from "./ui.js";
import { render, go, onLeave } from "./app.js";
import { gradePart, missingOf, HELP_HEADS, PART_LETTERS, escapeRecord, tunnelUrl, saveEncode, saveDecode, SAVE_BEGIN, SAVE_END, confirmCode, normKlasse } from "./escape-data.js";
import { classShort, subjectName } from "./shared.js";

const N = 6;
const two = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => { d = new Date(d); return two(d.getDate()) + "." + two(d.getMonth() + 1) + "." + d.getFullYear(); };
const fmtDT = (d) => { d = new Date(d); return Number.isNaN(d.getTime()) ? "–" : fmtDate(d) + " um " + two(d.getHours()) + ":" + two(d.getMinutes()) + " Uhr"; };
const randInt = (n) => { const lim = Math.floor(0x100000000 / n) * n, b = new Uint32Array(1); do crypto.getRandomValues(b); while (b[0] >= lim); return b[0] % n; };
const shuffle = (a0) => { const a = a0.slice(); for (let i = a.length - 1; i > 0; i--) { const j = randInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const paras = (t) => String(t || "").split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => h("p", { text: p }));
const reduced = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const KLASSE_RE = /^[\p{L}\p{N}/-]{1,10}$/u;

export async function escapePage(lessonId, opt = {}) {
  const token = store.get(opt.teacher ? "u.ttoken" : "u.stoken");
  if (!token) return go(opt.teacher ? "#/lehrkraft" : "#/");
  const shell = h("div", { class: "er" }, h("div", { class: "er-wrap" }, h("p", { class: "er-muted", text: "Lade den Escape-Room …" })));
  render(shell);
  let d;
  try { d = await api("GET", "/api/" + (opt.teacher ? "teacher" : "student") + "/lessons/" + lessonId + "/escape", { token }); }
  catch (e) {
    clear(shell).append(h("div", { class: "er-wrap" }, h("div", { class: "er-card" }, h("p", { class: "er-err", text: e.message }),
      h("a", { class: "er-btn", href: opt.teacher ? "#/lk/s/" + lessonId : "#/schueler/s/" + lessonId }, "Zurück zur Sitzung"))));
    return;
  }
  const room = d.room, preview = !!opt.teacher || d.preview;
  const S = { screen: "start", firstName: "", lastName: "", birthDate: "", klasse: classShort(d.klass || ""), solved: Array(N).fill(false), letters: Array(N).fill("_"),
    attempts: Array(N).fill(0), mistakes: Array(N).fill(null), visited: Array(N).fill(false), completedAt: null, resumeLog: [], pdfDownloaded: false };
  let rs = null, leaving = false, currentCheck = null;

  /* ---------- Rahmen: Kopfleiste mit Siegeln, Fußzeile ---------- */
  const seals = h("div", { class: "er-seals", "aria-label": "Fortschritt" });
  const paintSeals = () => clear(seals).append(...room.stationen.map((s, i) => h("div", { class: "er-seal", title: s.label },
    h("span", { class: "er-sq" + (S.visited[i] ? " on" : ""), "aria-hidden": "true" }), h("span", { class: "er-ci" + (S.solved[i] ? " on" : ""), text: S.solved[i] ? S.letters[i] : "" }))));
  const main = h("main", { class: "er-wrap", tabindex: "-1" });
  const saveBar = h("div", { class: "er-savebar hidden" }, h("span", { text: "Pause nötig? Speichere deinen Zwischenstand als Datei – damit geht es später genau hier weiter." }),
    h("button", { class: "er-btn ghost small", type: "button", onclick: () => saveProgress() }, "Zwischenstand als Datei speichern"));
  clear(shell).append(
    h("header", { class: "er-top" }, h("div", { class: "er-brand" }, h("span", { class: "er-brand-name", text: room.name }), preview ? h("span", { class: "er-badge", text: "Vorschau (Lehrkraft)" }) : null), seals),
    main, saveBar,
    h("footer", { class: "er-foot" }, h("span", { text: "Escape-Room · " + [subjectName(d.subject) || room.fach, classShort(d.klass || "")].filter(Boolean).join(" · ") }),
      h("button", { class: "er-link", type: "button", onclick: leaveRoom }, opt.teacher ? "Vorschau schließen" : "Escape-Room verlassen")));
  async function leaveRoom() {
    const started = S.screen !== "start" && S.screen !== "resume" && !!S.firstName;
    if (started && !preview && !(await confirmDialog("Escape-Room verlassen", "Dein Fortschritt geht verloren, wenn du ihn nicht als Zwischenstand-Datei gespeichert hast. Trotzdem verlassen?", "Verlassen", true))) return;
    leaving = true; go(opt.teacher ? "#/lk/s/" + lessonId : "#/schueler/s/" + lessonId);
  }
  const onBeforeUnload = (e) => { if (leaving || preview || /^(start|resume)$/.test(S.screen) || !S.firstName) return; e.preventDefault(); e.returnValue = ""; };
  window.addEventListener("beforeunload", onBeforeUnload);
  onLeave(() => window.removeEventListener("beforeunload", onBeforeUnload));

  // Enter in einem freien Feld prüft den Rätselraum (eine gehaltene Taste zählt nur einmal)
  main.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !currentCheck || !e.target.matches || !e.target.matches(".er-gap, .er-in")) return;
    e.preventDefault(); if (!e.repeat && !e.isComposing) currentCheck(false);
  });
  function show(screen, ...nodes) {
    S.screen = screen; rs = screen.startsWith("room") ? rs : null;
    if (!screen.startsWith("room")) currentCheck = null;
    clear(main).append(...nn(nodes));
    const n = /^(lib|room)(\d)$/.exec(screen);
    saveBar.classList.toggle("hidden", !(n && Number(n[2]) >= 2) || preview);
    paintSeals(); window.scrollTo(0, 0);
    try { main.focus({ preventScroll: true }); } catch {}
  }
  const card = (...k) => h("section", { class: "er-card" }, ...k);
  const brief = (speaker, t) => h("div", { class: "er-brief" }, h("div", { class: "er-kicker", text: speaker }), ...paras(t));
  const field = (id, label, input, hint) => h("div", { class: "er-field" }, h("label", { for: id, text: label }), input, hint ? h("p", { class: "er-hint", text: hint }) : null);

  /* ---------- Start: Angaben ---------- */
  function startScreen() {
    const fn = h("input", { id: "er-fn", maxlength: "40", autocomplete: "given-name", value: S.firstName });
    const ln = h("input", { id: "er-ln", maxlength: "40", autocomplete: "family-name", value: S.lastName });
    const bd = h("input", { id: "er-bd", inputmode: "numeric", maxlength: "10", placeholder: "TT.MM.JJJJ", value: S.birthDate, autocomplete: "bday" });
    const kl = h("input", { id: "er-kl", maxlength: "12", value: S.klasse });
    bd.addEventListener("input", () => {   // Ziffern → TT.MM.JJJJ (Punkte von selbst)
      const dg = bd.value.replace(/\D/g, "").slice(0, 8);
      bd.value = dg.length > 4 ? dg.slice(0, 2) + "." + dg.slice(2, 4) + "." + dg.slice(4) : dg.length > 2 ? dg.slice(0, 2) + "." + dg.slice(2) : dg;
    });
    const msg = h("p", { class: "er-err", role: "alert" });
    const go1 = h("button", { class: "er-btn", type: "submit" }, "Weiter zum Auftrag");
    const form = h("form", { class: "er-card er-login", onsubmit: (e) => {
      e.preventDefault(); msg.textContent = "";
      const clean = (s) => String(s || "").normalize("NFC").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").replace(/\s+/g, " ").trim();
      const f = clean(fn.value), l = clean(ln.value), b = bd.value.trim(), k = normKlasse(kl.value);
      const okName = (s) => s.length >= 2 && /\p{L}/u.test(s);
      if (!okName(f) || !okName(l)) { msg.textContent = "Bitte gib deinen Vornamen und deinen Nachnamen ein."; return; }
      const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(b), dt = m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
      if (!m || dt.getDate() !== Number(m[1]) || dt.getMonth() !== Number(m[2]) - 1 || Number(m[3]) < 1950 || dt > new Date()) { msg.textContent = "Bitte gib dein Geburtsdatum als TT.MM.JJJJ ein (z. B. 04.05.2010)."; return; }
      if (!KLASSE_RE.test(k)) { msg.textContent = "Bitte gib deine Klasse bzw. deinen Kurs ein (z. B. 9B oder Q2GK)."; return; }
      Object.assign(S, { firstName: f, lastName: l, birthDate: b, klasse: k });
      introScreen();
    } },
      h("h2", { text: "Anmeldung" }), h("div", { class: "er-grid" }, field("er-fn", "Vorname", fn), field("er-ln", "Nachname", ln), field("er-bd", "Geburtsdatum", bd), field("er-kl", "Klasse / Kurs", kl)),
      msg, h("div", { class: "er-row" }, go1, h("button", { class: "er-link", type: "button", onclick: resumeScreen }, "Zwischenstand aus Datei laden …")),
      h("p", { class: "er-hint", text: "Deine Angaben bleiben auf diesem Gerät. Sie stehen später in deiner Überblick-PDF und werden im Feibeitsblatt vorausgefüllt." }));
    show("start", h("p", { class: "er-kicker", text: [subjectName(d.subject) || room.fach, "Selbsterarbeitung", preview ? "Vorschau" : null].filter(Boolean).join(" · ") }),
      h("h1", { class: "er-title", text: room.titel }), room.untertitel ? h("p", { class: "er-lede", text: room.untertitel }) : null, form);
    // nur, wenn noch kein Feld gewählt ist – sonst landet schnelles Tippen im falschen Feld
    setTimeout(() => { if (!form.contains(document.activeElement)) fn.focus(); }, 30);
  }

  /* ---------- Zwischenstand laden ---------- */
  function resumeScreen() {
    const inp = h("input", { type: "file", accept: ".txt,text/plain", "aria-label": "Zwischenstand-Datei" }), msg = h("p", { class: "er-err", role: "alert" });
    inp.addEventListener("change", async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        if (f.size > 2e6) throw new Error("Diese Datei ist zu groß für eine Zwischenstand-Datei.");
        const data = saveDecode(room.id, room.name, await f.text());
        Object.assign(S, data.state, { pdfDownloaded: false });
        S.resumeLog = (Array.isArray(S.resumeLog) ? S.resumeLog : []).concat({ place: String(data.place || data.screen), savedAt: String(data.savedAt || ""), loadedAt: new Date().toISOString() });
        toast("Zwischenstand geladen – weiter geht es: " + (data.place || ""), "ok");
        open(data.screen);
      } catch (e) { msg.textContent = e.message; inp.value = ""; }
    });
    show("resume", h("h1", { class: "er-title", text: "Zwischenstand laden" }),
      card(h("p", { text: "Lade hier deine Zwischenstand-Datei hoch. Sie heißt „Zwischenstand zum Escape-Room " + room.name + " vom … von …“ und liegt meistens in deinem Download-Ordner. Danach geht es genau an der Stelle weiter, an der du gespeichert hast." }), inp, msg,
        h("button", { class: "er-link", type: "button", onclick: startScreen }, "Zurück zur Anmeldung")));
  }
  function open(screen) {
    const m = /^(lib|room)(\d)$/.exec(screen || "");
    if (screen === "intro") return introScreen();
    if (screen === "final" || S.solved.every(Boolean)) return finalScreen();
    if (m) return m[1] === "lib" ? libScreen(Number(m[2]) - 1) : roomScreen(Number(m[2]) - 1);
    return introScreen();
  }

  /* ---------- Einführung ---------- */
  function introScreen() {
    show("intro", h("p", { class: "er-kicker", text: "Dein Auftrag" }), h("h1", { class: "er-title" }, "Willkommen, ", h("em", { text: S.firstName }), "!"),
      brief(room.rahmen.sprecher, room.rahmen.auftrag),
      room.rahmen.rolle ? card(...paras(room.rahmen.rolle)) : null,
      card(h("h2", { text: "So läuft es ab" }), h("ol", { class: "er-steps" },
        h("li", null, h("strong", { text: "Sechs Stationen: " }), "Jede beginnt in einer Bibliothek mit Sachtexten. Lies gründlich und ", h("strong", { text: "mach dir Notizen" }), " – danach geht es in den Rätselraum, und es gibt ", h("strong", { text: "kein Zurück" }), " in die Bibliothek."),
        h("li", { text: "Jeder gelöste Rätselraum verrät dir einen Buchstaben des Lösungsworts." }),
        h("li", { text: "Stimmt etwas noch nicht, bekommst du Hilfe in drei Stufen: wo es stand, wie die Antwort beginnt, die Lösung." }),
        h("li", { text: "Am Ende wartet das Finale im Feibeitsblatt: " + room.feibeitsblatt.titel + "." }))),
      h("div", { class: "er-row" }, h("button", { class: "er-btn", type: "button", onclick: () => libScreen(0) }, "Erste Bibliothek betreten")));
  }

  /* ---------- Bibliothek ---------- */
  function libScreen(i) {
    const st = room.stationen[i];
    S.visited[i] = true;
    show("lib" + (i + 1),
      h("div", { class: "er-warnbar", role: "note" }, "⚠ Kein Weg zurück: Mach dir jetzt Notizen – im Rätselraum kannst du diese Bibliothek nicht mehr öffnen."),
      h("p", { class: "er-kicker", text: "Bibliothek " + (i + 1) + (st.ort ? " · " + st.ort : "") }), h("h1", { class: "er-title", text: st.titel }),
      st.bibliothek.einleitung ? h("p", { class: "er-lede", text: st.bibliothek.einleitung }) : null,
      ...st.bibliothek.abschnitte.map((a, k) => h("section", { class: "er-card er-sec" }, h("h2", null, h("span", { class: "er-num", text: String(k + 1) }), a.ueberschrift || "Abschnitt " + (k + 1)),
        ...paras(a.text), a.liste.length ? h("ul", null, a.liste.map((x) => h("li", { text: x }))) : null)),
      h("div", { class: "er-row" }, h("button", { class: "er-btn", type: "button", onclick: () => roomScreen(i) }, "Zum Rätselraum: " + st.titel)));
  }

  /* ---------- Rätselraum ---------- */
  function roomScreen(i) {
    const st = room.stationen[i];
    rs = { idx: i, answers: {}, submitted: false, lastFp: "", lastAt: 0 };
    const status = h("div", { class: "er-status", role: "status", tabindex: "-1" }), help = h("div", { class: "er-help hidden" });
    const parts = st.raetsel.teile.map((p, pi) => partNode(p, pi));
    const checkBtn = h("button", { class: "er-btn", type: "button" }, "Prüfen");
    let ptr = "";
    checkBtn.addEventListener("pointerdown", (e) => { ptr = e.pointerType || ""; });
    checkBtn.addEventListener("click", (e) => { if (e.detail > 1) return; check(ptr === "touch"); ptr = ""; });
    show("room" + (i + 1), h("p", { class: "er-kicker", text: "Rätselraum " + (i + 1) + (st.ort ? " · " + st.ort : "") }), h("h1", { class: "er-title", text: st.titel }),
      brief(room.rahmen.sprecher, st.raetsel.auftrag), ...parts.map((x) => x.el), status, help, h("div", { class: "er-row" }, checkBtn));
    currentCheck = check;

    function check(touch) {
      if (!rs || rs.idx !== i || rs.submitted) return;
      const answers = parts.map((x) => x.value());
      const fp = JSON.stringify(answers);
      if (touch && fp === rs.lastFp && performance.now() - rs.lastAt < 700) return;   // Doppeltipp zählt nicht doppelt
      const missing = []; let missN = 0;
      st.raetsel.teile.forEach((p, pi) => { const m = missingOf(p, answers[pi]); if (m) { missing.push(PART_LETTERS[pi]); missN += m; } });
      if (missing.length) {
        setStatus(false, "Noch unvollständig: In Teil " + (missing.length === 1 ? missing[0] : missing.slice(0, -1).join(", ") + " und " + missing[missing.length - 1]) + " " + (missN === 1 ? "fehlt noch eine Antwort." : "fehlen noch " + missN + " Antworten."));
        return;
      }
      let n = 0; const errors = [], helps = [];
      st.raetsel.teile.forEach((p, pi) => {
        const g = gradePart(st, p, answers[pi], st.raetsel.teile.length > 1 ? PART_LETTERS[pi] : "");
        n += g.n; errors.push(...g.errors); helps.push(...g.helps); parts[pi].mark(g.marks);
      });
      S.attempts[i]++;
      if (S.attempts[i] === 1 && errors.length) S.mistakes[i] = { errors };
      rs.lastFp = fp; rs.lastAt = performance.now();
      if (!errors.length) {
        rs.submitted = true; parts.forEach((x) => x.lock()); checkBtn.disabled = true; help.classList.add("hidden");
        setStatus(true, "Richtig! " + st.raetsel.erfolg);
        setTimeout(() => { if (S.screen === "room" + (i + 1)) reveal(i); }, reduced() ? 50 : 700);
        return;
      }
      setStatus(false, errors.length === 1 ? "Noch nicht ganz: 1 von " + n + " Antworten stimmt noch nicht. Sie ist rot markiert – unten steht Hilfe."
        : "Noch nicht ganz: " + errors.length + " von " + n + " Antworten stimmen noch nicht. Sie sind rot markiert – unten steht Hilfe.");
      const stage = Math.min(S.attempts[i], 3);
      clear(help).append(...nn(h("div", { class: "er-help-head" }, h("span", { "aria-hidden": "true", text: "💡" }), h("h3", { text: HELP_HEADS[stage - 1] })),
        h("ul", null, helps.map((x) => h("li", null, h("strong", { text: x.name + ": " }), stage === 1 ? x.s1 : stage === 2 ? x.s2 : x.s3))),
        stage === 3 ? h("p", { text: "Trage die Lösungen ein und prüfe noch einmal." }) : null));
      help.classList.remove("hidden");
    }
    function setStatus(ok, t) { status.className = "er-status " + (ok ? "ok" : "warn"); status.textContent = (ok ? "✓ " : "⚠ ") + t; }
  }

  // Ein Rätselteil: Element, aktueller Wert, Markierungen, Sperren
  function partNode(p, pi) {
    const L = PART_LETTERS[pi], keyEl = new Map(), locks = [];
    const el = h("fieldset", { class: "er-card er-part" }, h("legend", null, h("span", { class: "er-kicker", text: "Teil " + L }), p.frage ? h("span", { class: "er-q", text: p.frage }) : null));
    const reg = (k, node) => { keyEl.set(k, node); return node; };
    let value = () => null;
    const name = "er-" + pi + "-" + Math.random().toString(36).slice(2, 7);
    if (p.typ === "einfachwahl" || p.typ === "mehrfachwahl") {
      const multi = p.typ === "mehrfachwahl", order = shuffle(p.optionen.map((_, k) => k));
      const inputs = order.map((k) => { const inp = h("input", { type: multi ? "checkbox" : "radio", name, value: String(k) }); locks.push(inp);
        inp.addEventListener("change", () => { if (!multi) keyEl.forEach((n) => n.classList.remove("ok", "bad")); else keyEl.get("o" + k).classList.remove("ok", "bad"); });
        el.append(reg("o" + k, h("label", { class: "er-opt" }, inp, h("span", { text: p.optionen[k].text }), h("span", { class: "er-mark", "aria-hidden": "true" })))); return inp; });
      if (multi) el.append(h("p", { class: "er-hint", text: "Mehrere Antworten können richtig sein." }));
      value = () => (multi ? inputs.filter((x) => x.checked).map((x) => Number(x.value)) : (inputs.find((x) => x.checked) ? Number(inputs.find((x) => x.checked).value) : null));
    } else if (p.typ === "zuordnung") {
      const opts = shuffle(p.optionen), order = shuffle(p.zeilen.map((_, k) => k)), sels = {};
      for (const k of order) {
        const sel = h("select", { class: "er-sel", "aria-label": "Zuordnung für: " + p.zeilen[k].text }, h("option", { value: "" }, "– bitte wählen –"), opts.map((o) => h("option", { value: o }, o)));
        sel.addEventListener("change", () => keyEl.get("r" + k).classList.remove("ok", "bad"));
        sels[k] = sel; locks.push(sel);
        el.append(reg("r" + k, h("div", { class: "er-assign" }, h("span", { text: p.zeilen[k].text }), sel, h("span", { class: "er-mark", "aria-hidden": "true" }))));
      }
      value = () => Object.fromEntries(Object.entries(sels).map(([k, s]) => [k, s.value]));
    } else if (p.typ === "koerbe") {
      const order = shuffle(p.karten.map((_, k) => k)), choice = {};
      el.append(h("div", { class: "er-baskets" }, p.koerbe.map((b, bi) => h("div", { class: "er-basket", text: (bi + 1) + " · " + b.name }))));
      for (const k of order) {
        const btns = p.koerbe.map((b, bi) => { const bt = h("button", { type: "button", class: "er-seg", "aria-pressed": "false" }, b.name); locks.push(bt);
          bt.addEventListener("click", (e) => { if (e.detail > 1 || bt.disabled) return; choice[k] = bi; btns.forEach((x, xi) => x.setAttribute("aria-pressed", String(xi === bi))); keyEl.get("c" + k).classList.remove("ok", "bad"); }); return bt; });
        el.append(reg("c" + k, h("div", { class: "er-bcard" }, h("span", { text: p.karten[k].text }), h("span", { class: "er-segs", role: "group", "aria-label": "Korb für: " + p.karten[k].text }, ...btns), h("span", { class: "er-mark", "aria-hidden": "true" }))));
      }
      value = () => ({ ...choice });
    } else if (p.typ === "luecken") {
      const vals = {}, bank = p.wortbank ? shuffle(p.wortbank) : null, box = h("p", { class: "er-cloze" });
      let k = 0;
      for (const s of p.segmente) {
        if (typeof s === "string") { box.append(s); continue; }
        k++; const nr = s.luecke;
        const inp = bank ? h("select", { class: "er-gap", "aria-label": "Lücke " + k }, h("option", { value: "" }, "–"), bank.map((w) => h("option", { value: w }, w)))
          : h("input", { class: "er-gap", "aria-label": "Lücke " + k, autocomplete: "off", autocapitalize: "off", spellcheck: "false", enterkeyhint: "done" });
        inp.addEventListener(bank ? "change" : "input", () => inp.classList.remove("ok", "bad"));
        vals[nr] = inp; locks.push(inp); reg("g" + nr, inp); box.append(inp);
      }
      el.append(box);
      value = () => Object.fromEntries(Object.entries(vals).map(([nr, x]) => [nr, x.value]));
    } else {   // zahl, schlussstein
      const inp = h("input", { class: "er-in", autocomplete: "off", autocapitalize: "off", spellcheck: "false", inputmode: p.typ === "zahl" ? "decimal" : "text", "aria-label": p.frage || "Antwort", enterkeyhint: "done" });
      inp.addEventListener("input", () => inp.classList.remove("ok", "bad"));
      locks.push(inp); reg("in", inp);
      el.append(h("div", { class: "er-row" }, inp, p.einheit ? h("span", { text: p.einheit }) : null));
      value = () => inp.value;
    }
    return {
      el, value: () => value(),
      mark: (marks) => { for (const [k, ok] of Object.entries(marks)) { const n = keyEl.get(k); if (n) { n.classList.toggle("ok", ok); n.classList.toggle("bad", !ok); if (n.matches("input, select")) n.setAttribute("aria-invalid", ok ? "false" : "true"); } } },
      lock: () => locks.forEach((x) => { if (x.matches("input[type=text], input:not([type])")) x.readOnly = true; else x.disabled = true; }),
    };
  }

  /* ---------- Buchstabe freischalten ---------- */
  function reveal(i) {
    S.solved[i] = true; S.letters[i] = room.wort[i];
    if (S.solved.every(Boolean) && !S.completedAt) S.completedAt = new Date().toISOString();
    paintSeals();
    const last = S.solved.every(Boolean);
    const next = h("button", { class: "er-btn", type: "button" }, last ? "Zum Finale" : "Nächste Bibliothek betreten");
    const ov = h("div", { class: "er-reveal", role: "dialog", "aria-modal": "true", "aria-label": "Buchstabe freigeschaltet" },
      h("div", { class: "er-reveal-box" }, h("div", { class: "er-kicker", text: "Raum " + (i + 1) + " gelöst" }), h("div", { class: "er-letter", text: room.wort[i] }),
        h("p", { text: "Buchstabe " + (i + 1) + " von " + N + " freigeschaltet" }),
        h("div", { class: "er-tiles" }, S.letters.map((l, k) => h("span", { class: "er-tile" + (S.solved[k] ? " on" : ""), text: S.solved[k] ? l : "" }))), next));
    next.addEventListener("click", () => { ov.remove(); if (last) finalScreen(); else libScreen(i + 1); });
    document.body.append(ov); next.focus();
    onLeave(() => ov.remove());
  }

  /* ---------- Finale ---------- */
  function finalScreen() {
    const f = room.finale, locked = !d.sheetCode || preview;
    const msg = h("p", { class: "er-msg", role: "status" });
    const gate = h("button", { class: "er-gate", type: "button", disabled: locked ? true : null, "aria-label": "Durch den Tunnel zum Finale im Feibeitsblatt" },
      tunnelSvg(), h("span", { class: "er-gate-label", text: locked ? (preview ? "Vorschau: Tunnel erst für Schüler:innen" : "Das Finale ist noch nicht freigeschaltet") : "Durch den Tunnel zum Finale" }));
    gate.addEventListener("click", () => enterTunnel(false));
    function enterTunnel(force) {
      if (locked) return;
      if (!S.pdfDownloaded && !force) {
        modal({ title: "Vor dem Tunnel", body: (el) => el.append(h("p", { text: "Lade dir zuerst deinen Überblick als PDF herunter. Damit kannst du das Finale jederzeit im Feibeitsblatt fortsetzen (dort: „Zwischenstand-PDF hochladen“) – und du hast die Lösungserläuterungen für das Finale." }),
          h("p", { class: "er-hint", text: "Warte, bis der Download fertig ist (am iPad: „Laden“ bestätigen), und geh dann durch den Tunnel." })),
          actions: [{ label: "Überblick herunterladen", onClick: async () => { await downloadOverview(); return false; } }, { label: "Durch den Tunnel", class: "primary", onClick: () => { enterTunnel(true); } }] });
        return;
      }
      try { leaving = true; location.assign(tunnelUrl(d.feibeitsblattUrl, escapeRecord(room, S, d.sheetCode, location.origin + "/"))); }
      catch (e) { leaving = false; msg.textContent = "Der Tunnel konnte nicht geöffnet werden. Lade die Seite nicht neu – versuche es noch einmal."; }
    }
    show("final", h("p", { class: "er-kicker", text: "Alle sechs Räume gelöst" }), h("h1", { class: "er-title", text: f.ueberschrift }),
      h("div", { class: "er-tiles big", "aria-label": "Lösungswort " + room.wort }, room.wort.split("").map((l) => h("span", { class: "er-tile on", text: l }))),
      f.text ? card(...paras(f.text)) : null,
      f.warum ? card(h("h2", { text: "Warum " + room.wort + "?" }), ...paras(f.warum)) : null,
      h("section", { class: "er-arena" }, h("p", { class: "er-kicker", text: "Das Finale" }), h("h2", { text: room.feibeitsblatt.titel }),
        h("p", { text: "Im Feibeitsblatt wartet die letzte Aufgabe. Deine Angaben und dein Ergebnis nimmst du durch den Tunnel mit; dort schreibst du deine Antworten, bekommst Rückmeldung der KI und gibst ab." }),
        h("ol", { class: "er-steps" }, h("li", { text: "Lade deinen Überblick als PDF herunter (Lösungserläuterungen für das Finale)." }), h("li", { text: "Nimm deine Notizen mit." })),
        gate, msg,
        locked && !preview ? h("p", { class: "er-hint", text: "Speichere deinen Zwischenstand (unten), damit du später ohne Neustart weitermachen kannst." }) : null),
      card(h("h2", { text: "Erstmal eine Pause machen?" }), h("p", { text: "Lade den Überblick als PDF herunter. Damit kannst du das Finale später im Feibeitsblatt fortsetzen: Feibeitsblatt öffnen → „Zwischenstand-PDF hochladen“." }),
        h("div", { class: "er-row" }, h("button", { class: "er-btn", type: "button", onclick: (e) => busy(e.currentTarget, downloadOverview, "Erzeuge PDF …") }, "Überblick als PDF herunterladen"),
          preview ? null : h("button", { class: "er-btn ghost", type: "button", onclick: () => saveProgress() }, "Zwischenstand als Datei speichern"))),
      f.rueckblick.length ? card(h("h2", { text: "Das hast du herausgefunden" }), h("ul", null, f.rueckblick.map((x) => h("li", { text: x }))), f.schluss ? h("p", { text: f.schluss }) : null) : null);
  }
  function tunnelSvg() {
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 200 120"); svg.setAttribute("aria-hidden", "true"); svg.setAttribute("class", "er-tunnel");
    for (let k = 0; k < 6; k++) {
      const r = document.createElementNS(ns, "path"), w = 190 - k * 28, x = 100 - w / 2, ry = w * 0.42, ya = 6 + k * 14 + ry;   // Bögen ganz im Bild
      r.setAttribute("d", "M" + x + " 118 V" + ya.toFixed(1) + " A" + w / 2 + " " + ry.toFixed(1) + " 0 0 1 " + (x + w) + " " + ya.toFixed(1) + " V118");
      r.setAttribute("fill", "none"); r.setAttribute("stroke", "currentColor"); r.setAttribute("stroke-opacity", String(0.25 + k * 0.13)); r.setAttribute("stroke-width", "3");
      svg.append(r);
    }
    return svg;
  }

  /* ---------- Zwischenstand speichern ---------- */
  function placeOf(screen) {
    const m = /^(lib|room)(\d)$/.exec(screen);
    if (!m) return screen === "final" ? "Finale" : "Einführung";
    const st = room.stationen[Number(m[2]) - 1];
    return (m[1] === "lib" ? "Bibliothek " : "Rätselraum ") + m[2] + " – " + st.titel;
  }
  function saveProgress() {
    try {
      const now = new Date(), screen = S.screen === "resume" || S.screen === "start" ? "intro" : S.screen;
      const data = { v: 1, game: room.name, savedAt: now.toISOString(), screen, place: placeOf(screen), state: JSON.parse(JSON.stringify(S)) };
      const NL = "\r\n";
      const txt = "Zwischenstand zum Escape-Room „" + room.name + "“" + NL + "Gespeichert am " + fmtDT(now) + " · Stelle: " + data.place + NL + NL +
        "So geht es weiter: Öffne den Escape-Room in Unterricks und wähle bei der Anmeldung „Zwischenstand aus Datei laden …“." + NL + "Bitte nichts an dieser Datei ändern – sonst kann sie nicht mehr geladen werden." + NL + NL +
        SAVE_BEGIN + NL + saveEncode(room.id, data) + NL + SAVE_END + NL;
      const clean = (s) => String(s || "").replace(/[\\/:*?"<>|\u0000-\u001F]+/g, " ").replace(/\s+/g, " ").trim();
      download(new Blob([txt], { type: "text/plain;charset=utf-8" }), clean("Zwischenstand zum Escape-Room " + room.name + " vom " + fmtDate(now) + " von " + (S.firstName + " " + S.lastName).trim()) + ".txt");
      toast("Zwischenstand gespeichert – die Datei liegt in deinem Download-Ordner.", "ok", 6000);
    } catch (e) { errToast(e); }
  }
  function download(blob, name) {
    const url = URL.createObjectURL(blob), a = h("a", { href: url, download: name, style: { display: "none" } });
    document.body.append(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60000);   // iOS liest den Blob erst nach dem Bestätigen
  }

  /* ---------- Überblick-PDF (mit eingebettetem Datensatz für das Feibeitsblatt) ---------- */
  async function downloadOverview() {
    try {
      const bytes = await overviewPdf(room, S, d, escapeRecord(room, S, d.sheetCode, location.origin + "/"));
      download(new Blob([bytes], { type: "application/octet-stream" }), "Ueberblick-Escape-Room-" + room.name.replace(/[^\wÄÖÜäöüß-]+/g, "-").slice(0, 40) + "-" + fmtDate(new Date()).replace(/\./g, "-") + ".pdf");
      S.pdfDownloaded = true;
      toast("Überblick gespeichert.", "ok");
    } catch (e) { errToast(e); }
  }

  // Vorschau der Lehrkraft: direkt zu jeder Station springen
  if (preview) {
    const nav = h("div", { class: "er-previewnav" }, h("span", { text: "Vorschau – springen zu:" }),
      ...room.stationen.map((st, i) => h("button", { class: "er-link", type: "button", onclick: () => { if (!S.firstName) Object.assign(S, { firstName: "Vorschau", lastName: "Lehrkraft", birthDate: "01.01.2000", klasse: normKlasse(S.klasse) || "Test" }); libScreen(i); } }, "Bibliothek " + (i + 1))),
      h("button", { class: "er-link", type: "button", onclick: () => { if (!S.firstName) Object.assign(S, { firstName: "Vorschau", lastName: "Lehrkraft", birthDate: "01.01.2000", klasse: "Test" }); S.solved = S.solved.map(() => true); S.letters = room.wort.split(""); finalScreen(); } }, "Finale"));
    shell.insertBefore(nav, main);
  }
  startScreen();
}

/* ======================= Überblick-PDF (pdf-lib, Standardschrift Helvetica) ======================= */
let libP = null;
const pdfLib = () => (libP = libP || import("/vendor/pdf-lib.esm.min.js"));
export async function overviewPdf(room, S, d, hull) {
  const L = await pdfLib(), { PDFDocument, StandardFonts, rgb, PDFName, PDFString, PDFHexString } = L;
  const doc = await PDFDocument.create();
  doc.setTitle("Überblick Escape-Room " + room.name); doc.setProducer("Unterricks – Escape-Room " + room.name); doc.setCreator("Unterricks");
  const R = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
  const okCh = new Map(), clean = (s) => { let o = ""; for (const ch of String(s == null ? "" : s)) { if (!okCh.has(ch)) { try { R.encodeText(ch); okCh.set(ch, true); } catch { okCh.set(ch, false); } } o += okCh.get(ch) ? ch : ch === "→" ? "->" : /\s/.test(ch) ? " " : "?"; } return o; };
  const W = 595.28, H = 841.89, M = 52, CW = W - 2 * M;
  const INK = rgb(0.11, 0.15, 0.2), MUTE = rgb(0.35, 0.38, 0.43), PET = rgb(0.12, 0.31, 0.37), OCH = rgb(0.66, 0.47, 0.16), GREEN = rgb(0.18, 0.49, 0.25), RED = rgb(0.69, 0.27, 0.18);
  let page, y; const pages = [];
  const T1 = "Überblick deiner Antworten & Erläuterungen", T2 = "Lösungserläuterungen";
  const header = (title) => { page = doc.addPage([W, H]); pages.push(page); page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: rgb(0.11, 0.15, 0.2) });
    page.drawText(clean(title), { x: M, y: H - 38, size: 17, font: B, color: rgb(1, 1, 1) }); page.drawText(clean("Escape-Room „" + room.name + "“ · " + (room.fach || "")), { x: M, y: H - 56, size: 9, font: R, color: rgb(0.8, 0.82, 0.85) }); y = H - 92; };
  let cur = T1;
  const ensure = (need) => { if (y - need < 64) header(cur); };
  const wrap = (t, size, font, maxW) => { const out = []; for (const par of clean(t).split("\n")) { let ln = ""; for (const w of par.split(/\s+/)) { const tt = ln ? ln + " " + w : w; if (font.widthOfTextAtSize(tt, size) > maxW && ln) { out.push(ln); ln = w; } else ln = tt; } out.push(ln); } return out; };
  const para = (t, { size = 10.5, font = R, color = INK, x = M, maxW = CW, lh = 1.38, gap = 6 } = {}) => { for (const ln of wrap(t, size, font, maxW)) { ensure(size * lh); page.drawText(ln, { x, y: y - size, size, font, color }); y -= size * lh; } y -= gap; };
  header(T1);
  // Hinweis mit Adresse des Feibeitsblatts (als Link)
  const note = d.sheetCode ? "Mit dieser PDF kannst du das Finale jederzeit im Feibeitsblatt fortsetzen: Öffne die Adresse unten und wähle dort „Zwischenstand-PDF hochladen“." :
    "Als diese PDF entstand, war das Finale im Feibeitsblatt noch nicht freigeschaltet – mit dieser Datei lässt es sich nicht fortsetzen. Lade deinen Zwischenstand im Escape-Room, sobald das Finale freigeschaltet ist.";
  const lines = wrap(note, 10, R, CW - 24), boxH = 26 + lines.length * 13.5 + 16;
  page.drawRectangle({ x: M, y: y - boxH, width: CW, height: boxH, color: rgb(1, 0.93, 0.85) }); page.drawRectangle({ x: M, y: y - boxH, width: 3, height: boxH, color: OCH });
  page.drawText(clean("Bewahre diese PDF gut auf – sie enthält deine Ergebnisse und die Lösungserläuterungen."), { x: M + 12, y: y - 16, size: 10, font: B, color: rgb(0.45, 0.25, 0.05) });
  lines.forEach((ln, k) => page.drawText(ln, { x: M + 12, y: y - 31 - k * 13.5, size: 10, font: R, color: MUTE }));
  const addr = String(d.feibeitsblattUrl || ""), ay = y - 31 - lines.length * 13.5 - 4, aw = B.widthOfTextAtSize(clean(addr), 10);
  page.drawText(clean(addr), { x: M + 12, y: ay, size: 10, font: B, color: PET });
  const annot = doc.context.register(doc.context.obj({ Type: "Annot", Subtype: "Link", Rect: [M + 11, ay - 3, M + 14 + aw, ay + 11], Border: [0, 0, 0], A: { Type: "Action", S: "URI", URI: PDFString.of(addr) } }));
  page.node.set(PDFName.of("Annots"), doc.context.obj([annot]));
  y -= boxH + 14;
  // Angaben
  const idH = 92;
  page.drawRectangle({ x: M, y: y - idH, width: CW, height: idH, color: rgb(0.95, 0.95, 0.94) }); page.drawRectangle({ x: M, y: y - idH, width: 3, height: idH, color: INK });
  const lab = (t, x, yy) => page.drawText(t, { x, y: yy, size: 8, font: B, color: OCH });
  lab("NAME", M + 14, y - 16); page.drawText(clean(S.firstName + " " + S.lastName).slice(0, 60), { x: M + 14, y: y - 31, size: 12.5, font: B, color: INK });
  lab("GEBURTSDATUM", M + 14, y - 50); page.drawText(clean(S.birthDate), { x: M + 14, y: y - 64, size: 11, font: R, color: INK });
  lab("KLASSE", M + 140, y - 50); page.drawText(clean(S.klasse), { x: M + 140, y: y - 64, size: 11, font: R, color: INK });
  lab("BESTÄTIGUNGSCODE", M + 300, y - 16); page.drawText(confirmCode(S.birthDate, room.magic), { x: M + 300, y: y - 31, size: 12.5, font: B, color: INK });
  lab("ABGESCHLOSSEN AM", M + 300, y - 50); page.drawText(clean(S.completedAt ? fmtDT(S.completedAt) : "noch nicht abgeschlossen"), { x: M + 300, y: y - 64, size: 11, font: R, color: INK });
  y -= idH + 18;
  para("Dieses Dokument fasst zusammen, welche Antworten du in jeder Station beim ersten Versuch gegeben hast – und wo es anfangs noch hakte. Danach folgen die Lösungserläuterungen.");
  const perfect = S.attempts.filter((a, i) => a >= 1 && !(S.mistakes[i] && S.mistakes[i].errors && S.mistakes[i].errors.length)).length;
  const errs = S.mistakes.reduce((a, m) => a + (m && m.errors ? m.errors.length : 0), 0);
  para("Stationen im ersten Versuch fehlerfrei: " + perfect + " von " + N + "   ·   Fehler im ersten Versuch insgesamt: " + errs, { font: B, color: GREEN, gap: 12 });
  room.stationen.forEach((st, i) => {
    ensure(60); para(st.label, { size: 12.5, font: B, color: PET, gap: 2 });
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + CW, y: y + 2 }, thickness: 0.7, color: PET }); y -= 8;
    const a = S.attempts[i], m = S.mistakes[i], al = a === 1 ? "1 Versuch" : a + " Versuche";
    if (!S.solved[i]) { para("Noch nicht gelöst.", { color: MUTE }); return; }
    if (!m || !m.errors || !m.errors.length) { para("Fehlerfrei beim ersten Versuch gelöst. (" + al + ")", { font: B, color: GREEN, gap: 8 }); return; }
    para("Benötigt: " + al + ". Beim ersten Versuch war Folgendes nicht korrekt:", { color: MUTE, gap: 3 });
    for (const e of m.errors) {
      para("• " + e.item, { font: B, x: M + 6, maxW: CW - 6, gap: 1 });
      if (e.wrong) para("Deine Antwort: " + e.wrong, { color: RED, x: M + 16, maxW: CW - 16, size: 10, gap: 1 });
      if (e.right) para("Richtig: " + e.right, { color: GREEN, font: B, x: M + 16, maxW: CW - 16, size: 10, gap: 1 });
      if (e.note) para(e.note, { color: MUTE, x: M + 16, maxW: CW - 16, size: 9.5, gap: 1 });
      y -= 4;
    }
    y -= 6;
  });
  cur = T2; header(T2);
  para("Hier werden die richtigen Lösungen der sechs Stationen noch einmal genauer erklärt. Nutze diese Seiten zum Wiederholen – und für das Finale.", { gap: 10 });
  room.stationen.forEach((st) => { ensure(80); para(st.label, { size: 12.5, font: B, color: PET, gap: 4 }); para(st.erlaeuterung || "–", { gap: 12 }); });
  ensure(60); para("Verwendung von Zwischenstand-Dateien", { size: 12.5, font: B, color: INK, gap: 4 });
  if (!(S.resumeLog || []).length) para("Es wurde keine Zwischenstand-Datei geladen.", { color: MUTE });
  for (const r of S.resumeLog || []) para("Gespeichert am " + fmtDT(r.savedAt) + " (" + r.place + "), geladen am " + fmtDT(r.loadedAt) + ".", { color: MUTE, gap: 2 });
  pages.forEach((p, k) => { p.drawText("Escape-Room der Plattform Unterricks", { x: M, y: 30, size: 8.5, font: R, color: MUTE }); const s = "Seite " + (k + 1) + " von " + pages.length; p.drawText(s, { x: W - M - R.widthOfTextAtSize(s, 8.5), y: 30, size: 8.5, font: R, color: MUTE }); });
  // Datensatz für das Feibeitsblatt als eingebettete Datei (Kennzeichen /FbEscape 1 wie in den bekannten Escape-Rooms)
  const ctx = doc.context, json = new TextEncoder().encode(JSON.stringify(hull));
  const ef = ctx.register(ctx.stream(json, { Type: "EmbeddedFile", Subtype: "application/json", FbEscape: 1, Params: { Size: json.length } }));
  const spec = ctx.register(ctx.obj({ Type: "Filespec", F: PDFString.of("feibeitsblatt-escape.json"), UF: PDFHexString.fromText("feibeitsblatt-escape.json"), Desc: PDFHexString.fromText("Escape-Room " + room.name),
    AFRelationship: "Data", EF: { F: ef, UF: ef } }));
  doc.catalog.set(PDFName.of("Names"), ctx.obj({ EmbeddedFiles: { Names: [PDFString.of("feibeitsblatt-escape.json"), spec] } }));
  doc.catalog.set(PDFName.of("AF"), ctx.obj([spec]));
  return doc.save({ useObjectStreams: false });
}
