// app.js – Einstieg: Router und Schüleransicht. Die Lehrkräfteansicht wird erst bei Bedarf geladen (teacher.js).
import { h, $, clear, store, deviceId, api, ApiError, toast, errToast, busy, copyText, fmtBytes, fmtDate, fmtClock, fileIcon, downloadUrl, downloadBlob, topbar } from "./ui.js";
import { SUBJECTS, CLASS_GROUPS, subjectName, formatCode, normalizeCode, fmtDay, classShort, isAnalogClass } from "./shared.js";
import { paintPortalPreview } from "./portalview.js";
import { renderMarkdown } from "./markdown.js";

const app = document.getElementById("app");
let disposers = [];
export const onLeave = (fn) => disposers.push(fn);
function leave() { for (const fn of disposers.splice(0)) { try { fn(); } catch {} } }
export function render(...nodes) { leave(); clear(app).append(...nodes); window.scrollTo(0, 0); }
export const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

const S = { get token() { return store.get("u.stoken"); }, set token(v) { if (v) store.set("u.stoken", v); else store.del("u.stoken"); } };
const sapi = (method, path, o = {}) => api(method, path, { ...o, token: S.token });
const footer = () => h("footer", { class: "footer" }, h("a", { href: "#/lehrkraft" }, "Lehrkräfte"));

/* ---------- Startseite: nur die Passwortabfrage ---------- */
async function studentStart() {
  if (S.token) {
    try { await sapi("GET", "/api/student/me"); return go("#/schueler"); }
    catch (e) { if (e.status === 401) S.token = null; else if (e.status === 0) { /* offline: trotzdem Passwortseite */ } }
  }
  const pw = h("input", { type: "password", id: "spw", autocomplete: "current-password", autocapitalize: "off", spellcheck: "false", required: true });
  const msg = h("p", { class: "err", role: "alert" });
  const btn = h("button", { class: "btn primary big", type: "submit" }, "Weiter");
  let lockTimer = null;
  const lock = (sec) => {
    clearInterval(lockTimer); btn.disabled = true;
    const end = Date.now() + sec * 1000;
    const tick = () => { const s = Math.ceil((end - Date.now()) / 1000); if (s <= 0) { clearInterval(lockTimer); btn.disabled = false; msg.textContent = ""; return; } msg.textContent = "Zu viele falsche Versuche. Bitte warte noch " + s + " Sekunden."; };
    tick(); lockTimer = setInterval(tick, 500);
  };
  onLeave(() => clearInterval(lockTimer));
  const form = h("form", { class: "card login stack", onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = "";
    await busy(btn, async () => {
      try {
        const r = await api("POST", "/api/student/login", { body: { password: pw.value, deviceId: deviceId(), token: S.token || undefined } });
        S.token = r.token; go("#/schueler");
      } catch (err) {
        if (err.status === 429 && err.data.retryAfter) lock(err.data.retryAfter);
        else msg.textContent = err.message;
        pw.select();
      }
    }, "Prüfe …");
  } },
  h("div", { class: "logo" }, h("img", { src: "/icon.svg", alt: "" }), h("span", { text: "Unterricks" })),
  h("div", { class: "field" }, h("label", { for: "spw" }, "Passwort"), pw), msg, btn);
  render(h("div", { class: "login-wrap" }, form), footer());
  setTimeout(() => pw.focus(), 50);
}

/* ---------- Schüler: Klasse/Fach, Sitzungscode, freigeschaltete Sitzungen ---------- */
function studentBar() {
  return topbar({ home: "#/schueler" }, [h("a", { href: "#/schueler" }, "Meine Sitzungen")]);
}
// Fach und Klasse/Kurs: angeboten werden nur die Jahrgänge, in denen das Fach laut Einstellungen der Lehrkraft unterrichtet wird
function chooser(profile, onSave) {
  let subject = profile.subject, klass = profile.klass, grades = null;
  const save = h("button", { class: "btn primary big", type: "button", disabled: !(subject && klass) }, "Speichern und weiter");
  const allowed = (k) => !grades || !subject || !grades[subject] || grades[subject].includes(/^\d+/.test(k) ? String(parseInt(k, 10)) : k[0]);
  const classWrap = h("div");
  const paintClasses = () => {
    if (klass && !allowed(klass)) klass = null;
    save.disabled = !(subject && klass);
    clear(classWrap).append(...(subject ? CLASS_GROUPS.filter((g) => !grades || !grades[subject] || grades[subject].includes(g.key)).map((g) => h("div", { class: "class-group" }, h("h3", { text: g.label }),
      h("div", { class: "class-grid" + (g.key === "Q" ? " q" : "") }, g.classes.map((k) => h("button", { class: "class-btn", type: "button", "aria-pressed": String(k === klass), onclick: (e) => {
        klass = k; classWrap.querySelectorAll(".class-btn").forEach((t) => t.setAttribute("aria-pressed", "false")); e.currentTarget.setAttribute("aria-pressed", "true"); save.disabled = !(subject && klass);
      } }, classShort(k)))))) : [h("p", { class: "muted", text: "Bitte zuerst dein Fach wählen." })]));
  };
  const subjWrap = h("div", { class: "tiles", role: "group", "aria-label": "Fach" }, SUBJECTS.map((s) => h("button", { class: "tile", type: "button", "aria-pressed": String(s.id === subject), onclick: (e) => {
    subject = s.id; subjWrap.querySelectorAll(".tile").forEach((t) => t.setAttribute("aria-pressed", "false")); e.currentTarget.setAttribute("aria-pressed", "true"); paintClasses();
  } }, h("div", { class: "t", text: s.name }))));
  paintClasses();
  api("GET", "/api/subjects").then((r) => { grades = Object.fromEntries(Object.entries(r.subjects || {}).map(([k, v]) => [k, v.grades])); paintClasses(); }).catch(() => {});
  save.addEventListener("click", () => busy(save, async () => {
    try { const r = await sapi("PUT", "/api/student/profile", { body: { klass, subject } }); onSave(r.profile); } catch (e) { errToast(e); }
  }));
  return h("div", { class: "stack" },
    h("div", { class: "card" }, h("h2", { text: "1. Dein Fach" }), subjWrap),
    h("div", { class: "card" }, h("h2", { text: "2. Deine Klasse bzw. dein Kurs" }), classWrap),
    h("div", { class: "row end" }, save));
}

async function studentHome() {
  if (!S.token) return go("#/");
  let me;
  try { me = await sapi("GET", "/api/student/me"); }
  catch (e) { if (e.status === 401) { S.token = null; return go("#/"); } render(studentBar(), h("main", { class: "narrow" }, h("p", { class: "err", text: e.message }))); return; }
  const main = h("main", { class: "narrow" });
  render(studentBar(), main, footer());
  const show = (profile, forceChoose) => {
    clear(main);
    if (forceChoose || !profile.klass || !profile.subject) {
      main.append(h("h1", { text: "Wähle dein Fach und deine Klasse" }), chooser(profile, (p) => { me.profile = p; show(p); }));
      return;
    }
    const code = h("input", { id: "code", inputmode: "text", autocapitalize: "characters", autocomplete: "off", spellcheck: "false", placeholder: "z. B. K7Q-M4X", maxlength: "9", style: { fontFamily: "var(--mono)", fontSize: "1.3rem", letterSpacing: ".12em", textTransform: "uppercase" } });
    const msg = h("p", { class: "err", role: "alert" });
    const btn = h("button", { class: "btn primary", type: "submit" }, "Sitzung öffnen");
    const form = h("form", { class: "card", onsubmit: async (e) => {
      e.preventDefault(); msg.textContent = "";
      const c = normalizeCode(code.value);
      if (c.length !== 6) { msg.textContent = "Ein Sitzungscode hat 6 Zeichen."; return; }
      await busy(btn, async () => {
        try { const r = await sapi("POST", "/api/student/join", { body: { code: c } }); go("#/schueler/s/" + r.lesson.id); }
        catch (err) { msg.textContent = err.message; }
      }, "Prüfe …");
    } }, h("h2", { text: "Neue Sitzung freischalten" }), h("div", { class: "field" }, h("label", { for: "code" }, "Sitzungscode deiner Lehrkraft"), code), msg, btn,
      h("p", { class: "hint", text: "Einmal eingegebene Codes merkt sich dieses Gerät – beim nächsten Mal findest du die Sitzung unten in der Liste." }));
    const list = h("div", { class: "list" });
    const lessons = me.lessons || [];
    if (!lessons.length) list.append(h("p", { class: "muted", text: "Noch keine Sitzung freigeschaltet." }));
    for (const l of lessons) list.append(h("a", { class: "item", href: "#/schueler/s/" + l.id },
      h("div", { class: "main" }, h("div", { class: "name", text: l.title }), h("div", { class: "meta", text: l.subjectName + " · " + classShort(l.klass) + (l.date ? " · " + fmtDay(l.date) : "") })),
      l.hasHomework ? h("span", { class: "badge", style: { color: "var(--warn)" }, text: "Hausaufgabe" }) : null, h("span", { class: "btn small" }, "Öffnen")));
    main.append(
      h("div", { class: "row between", style: { marginBottom: ".8rem" } }, h("h1", { style: { margin: 0 }, text: "Hallo!" }),
        h("div", { class: "row" }, h("span", { class: "badge", text: classShort(profile.klass) + " · " + subjectName(profile.subject) }), h("button", { class: "btn small", type: "button", onclick: () => show(profile, true) }, "Klasse/Fach ändern"))),
      form, h("div", { class: "card" }, h("h2", { text: "Deine Sitzungen" }), list));
    if (!lessons.length) setTimeout(() => code.focus(), 50);
  };
  show(me.profile || {});
}

/* ---------- Sitzungsraum der Schüler:innen ---------- */
async function studentRoom(lessonId) {
  if (!S.token) return go("#/");
  const main = h("main", { class: "narrow" }, h("div", { class: "skeleton", text: "Lade die Sitzung …" }));
  render(studentBar(), main, footer());
  let d;
  try { d = await sapi("GET", "/api/student/lessons/" + lessonId); }
  catch (e) {
    if (e.status === 401) { S.token = null; return go("#/"); }
    clear(main).append(h("div", { class: "card" }, h("p", { class: "err", text: e.message }), h("a", { class: "btn", href: "#/schueler" }, "Zur Übersicht")));
    return;
  }
  const offset = (d.now || Date.now()) - Date.now();
  clear(main);
  main.append(h("div", { class: "crumbs" }, h("a", { href: "#/schueler" }, "Meine Sitzungen"), "›", h("span", { text: d.lesson.title })),
    h("h1", { text: d.lesson.title }), h("p", { class: "muted", text: d.lesson.subjectName + " · " + classShort(d.lesson.klass) + (d.lesson.date ? " · " + fmtDay(d.lesson.date) : "") }));

  // 0) Vertretung: Hinweis auf die Abwesenheit der Lehrkraft und chronologische Anleitung ganz oben
  if (d.substitute) {
    const sub = d.substitute;
    main.append(h("section", { class: "card substitute student", "aria-label": "Vertretungsstunde" },
      h("h2", { text: "Heute ohne deine Lehrkraft" }), h("div", { class: "notice warn" }, sub.hinweis),
      h("h3", { text: "So gehst du vor – Schritt für Schritt" }),
      h("ol", { class: "sub-steps" }, (sub.schritte || []).map((x) => h("li", null,
        h("div", { class: "row between" }, h("strong", { text: x.titel }), h("span", { class: "row" }, x.minuten ? h("span", { class: "badge", text: "ca. " + x.minuten + " Minuten" }) : null, x.abgabe ? h("span", { class: "badge ok", text: "Abgabe" }) : null)),
        renderMarkdown(x.anleitung || "")))),
      sub.abgabe ? h("p", null, h("strong", { text: "Was du abgibst: " }), sub.abgabe) : null,
      sub.escape ? h("div", { class: "escbox" }, h("h3", { text: "Escape-Room: " + sub.escape.name }), sub.escape.untertitel ? h("p", { class: "small", text: sub.escape.untertitel }) : null,
        h("a", { class: "btn primary big", href: "#/schueler/escape/" + lessonId }, "Escape-Room starten"),
        h("p", { class: "hint", text: "Sechs Stationen: erst die Bibliothek lesen (Notizen machen!), dann das Rätsel lösen. Am Ende führt dich ein Tunnel ins Feibeitsblatt, wo du abgibst. Neu laden kostet deinen Fortschritt – speichere zwischendurch deinen Zwischenstand." })) : null,
      h("p", { class: "hint", text: "Das Material zu den Schritten findest du unten unter „Material“." + (d.sheets.length ? " Die Abgabe machst du im Feibeitsblatt (Knopf „Code kopieren und Feibeitsblatt öffnen“)." : "") })));
  }

  // 1) Live-Fenster ganz oben
  const img = h("img", { alt: "Aktuelle Folie der Lehrkraft", draggable: "false" });
  const ph = h("div", { class: "placeholder" }, h("div", { class: "big", text: "Noch keine Live-Präsentation" }), h("div", { text: "Sobald deine Lehrkraft die Präsentation startet, erscheint sie hier automatisch." }));
  const status = h("div", { class: "status" });
  const fsBtn = h("button", { class: "btn small fs", type: "button", "aria-label": "Live-Fenster vergrößern" }, "⛶ Groß");
  const live = h("section", { class: "live", "aria-label": "Live-Präsentation" }, ph, status, fsBtn);
  live.addEventListener("contextmenu", (e) => e.preventDefault());
  fsBtn.addEventListener("click", () => {
    const fs = live.requestFullscreen || live.webkitRequestFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else if (fs) fs.call(live).catch(() => live.classList.toggle("max"));
    else live.classList.toggle("max");
  });
  const presRow = h("div", { class: "row", style: { margin: ".6rem 0 1.2rem" } });
  main.append(live, presRow);
  // Hausaufgabe aus dieser Sitzung bis zur nächsten Sitzung
  if (d.homework) {
    main.append(h("section", { class: "card homework", style: { marginBottom: "1rem" }, "aria-label": "Hausaufgabe" },
      h("h2", { text: "Deine Hausaufgabe" }),
      h("p", { class: "due", text: d.homework.dueDate ? "Bis zur nächsten Sitzung am " + fmtDay(d.homework.dueDate) + ":" : "Bis zur nächsten Sitzung:" }),
      paintPortalPreview(h("div", { class: "hwtext" }), d.homework.text)));
  }
  let lastV = -1;
  function showState(st) {
    if (!st || typeof st !== "object") return;
    if (st.v !== undefined && st.v === lastV && st.active) return;
    lastV = st.v;
    clear(status);
    if (st.active && st.url) {
      status.append(h("span", { class: "badge onair" }, h("span", { class: "dot" }), "LIVE"), h("span", { class: "badge", text: "Folie " + st.slide + " / " + st.pages }));
      const pre = new Image();
      pre.onload = () => { img.src = pre.src; if (!img.isConnected) { ph.remove(); live.prepend(img); } };
      pre.src = st.url;
    } else {
      img.remove(); if (!ph.isConnected) live.prepend(ph);
    }
  }
  // WebSocket mit Wiederverbindung; ersatzweise alle 2 s abfragen
  let ws = null, closed = false, fails = 0, pollT = null, pingT = null, reT = null;
  const poll = async () => { try { const r = await sapi("GET", "/api/student/lessons/" + lessonId + "/live"); showState(r.live); } catch {} };
  async function connect() {
    if (closed) return;
    try {
      const t = await sapi("POST", "/api/student/lessons/" + lessonId + "/live-ticket");
      ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + t.url);
      ws.onopen = () => { fails = 0; clearInterval(pollT); pollT = null; clearInterval(pingT); pingT = setInterval(() => { try { ws.send("ping"); } catch {} }, 25000); };
      ws.onmessage = (ev) => { if (ev.data === "pong") return; try { showState(JSON.parse(ev.data)); } catch {} };
      ws.onclose = () => { clearInterval(pingT); if (closed) return; fails++; if (fails >= 2 && !pollT) { poll(); pollT = setInterval(poll, 2000); } reT = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(fails, 4))); };
    } catch { fails++; if (!pollT) { poll(); pollT = setInterval(poll, 2000); } reT = setTimeout(connect, 5000); }
  }
  connect();
  const onVis = () => { if (document.visibilityState === "visible") { poll(); if (!ws || ws.readyState > 1) { clearTimeout(reT); connect(); } } };
  document.addEventListener("visibilitychange", onVis);
  onLeave(() => { closed = true; clearInterval(pollT); clearInterval(pingT); clearTimeout(reT); document.removeEventListener("visibilitychange", onVis); try { ws && ws.close(); } catch {} });

  // Präsentationsdatei nach 90 Minuten selbst öffnen
  const pres = d.presentation;
  const renderPres = () => {
    clear(presRow);
    if (!pres) return;
    const unlocked = Date.now() + offset >= pres.unlockAt;
    if (unlocked) {
      presRow.append(h("button", { class: "btn primary", type: "button", onclick: (e) => openPresentation(e.currentTarget) }, "Präsentation selbst öffnen und durchklicken"));
    } else {
      presRow.append(h("span", { class: "muted small", text: "Die vollständige Präsentation kannst du ab " + fmtClock(pres.unlockAt - offset) + " Uhr selbst öffnen (90 Minuten nach deinem ersten Betreten dieser Sitzung)." }));
    }
  };
  async function openPresentation(btn) {
    const w = window.open("about:blank", "_blank");
    await busy(btn, async () => {
      try { const r = await sapi("POST", "/api/student/lessons/" + lessonId + "/presentation-link", { body: { inline: true } }); if (w) w.location.href = r.url; else location.href = r.url; }
      catch (e) { if (w) w.close(); errToast(e); }
    }, "Öffne …");
  }
  renderPres();
  if (pres && !pres.unlocked) { const t = setInterval(() => { if (Date.now() + offset >= pres.unlockAt) { clearInterval(t); renderPres(); } }, 20000); onLeave(() => clearInterval(t)); }

  // 2) Materialien und Feibeitsblätter
  const mats = h("div", { class: "list" });
  for (const s of d.sheets) {
    mats.append(h("div", { class: "item" }, h("div", { class: "ficon fb", "aria-hidden": "true", text: "FB" }),
      h("div", { class: "main" }, h("div", { class: "name", text: s.title }), h("div", { class: "meta" }, "Feibeitsblatt · Code ", h("span", { class: "mono", style: { fontWeight: 800, fontSize: "1.05rem", letterSpacing: ".08em" }, text: formatCode(s.code) }))),
      h("div", { class: "acts" }, h("button", { class: "btn primary small", type: "button", onclick: async () => {
        const ok = await copyText(formatCode(s.code));
        window.open(d.feibeitsblattUrl, "_blank", "noopener");
        toast(ok ? "Code " + formatCode(s.code) + " kopiert – füge ihn im Feibeitsblatt ein." : "Bitte den Code " + formatCode(s.code) + " im Feibeitsblatt eintippen.", "ok", 6000);
      } }, "Code kopieren und Feibeitsblatt öffnen"))));
  }
  for (const f of d.files) {
    const acts = h("div", { class: "acts" });
    const row = h("div", { class: "item" }, fileIcon(f.name, f.mime, f.kind), h("div", { class: "main" }, h("div", { class: "name", text: f.name }), h("div", { class: "meta", text: f.kind === "text" ? "Text · als PDF herunterladen" : fmtBytes(f.size) })), acts);
    if (f.kind === "text") {
      let shown = null;
      acts.append(h("button", { class: "btn small", type: "button", onclick: () => { if (shown) { shown.remove(); shown = null; } else { shown = h("div", { class: "card", style: { marginTop: ".4rem" } }, renderMarkdown(f.text)); row.after(shown); } } }, "Lesen"),
        h("button", { class: "btn primary small", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
          try { const { markdownToPdf, pdfName } = await import("./pdfmaker.js"); downloadBlob(await markdownToPdf(f.name, f.text, { subtitle: d.lesson.subjectName + " · " + d.lesson.klass }), pdfName(f.name)); }
          catch (err) { errToast(err); }
        }, "Erzeuge PDF …") }, "Als PDF herunterladen"));
    } else {
      acts.append(h("button", { class: "btn primary small", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try { const r = await sapi("POST", "/api/student/files/" + f.id + "/link"); downloadUrl(r.url, f.name); } catch (err) { errToast(err); }
      }, "Lade …") }, "Herunterladen"));
    }
    mats.append(row);
  }
  if (!d.sheets.length && !d.files.length) mats.append(h("p", { class: "muted", text: "Deine Lehrkraft hat für diese Sitzung noch kein Material freigegeben." }));
  main.append(h("section", { class: "card" }, h("h2", { text: "Material" }), mats,
    d.files.length ? h("p", { class: "hint", text: "Tipp fürs iPad: Nach dem Herunterladen über „Teilen“ → „GoodNotes“ öffnen und dort bearbeiten." }) : null));
}

/* ---------- Router ---------- */
const ROUTES = [
  [/^#?\/?$/, () => studentStart()],
  [/^#\/schueler$/, () => studentHome()],
  [/^#\/schueler\/s\/([a-f0-9]{16})$/, (m) => studentRoom(m[1])],
  [/^#\/schueler\/escape\/([a-f0-9]{16})$/, (m) => import("./escape.js").then((x) => x.escapePage(m[1])).catch((e) => { render(h("main", null, h("p", { class: "err", text: "Der Escape-Room konnte nicht geladen werden: " + e.message }))); })],
  [/^#\/(lehrkraft|lk)(\/.*)?$/, () => import("./teacher.js").then((t) => t.route(location.hash)).catch((e) => { render(h("main", null, h("p", { class: "err", text: "Die Lehrkräfteansicht konnte nicht geladen werden: " + e.message }))); })],
];
export function route() {
  const hash = location.hash || "#/";
  for (const [re, fn] of ROUTES) { const m = re.exec(hash); if (m) return fn(m); }
  go("#/");
}
window.addEventListener("hashchange", route);
route();
export { ApiError, $ };
