// app.js – Einstieg: Router und Schüleransicht. Die Lehrkräfteansicht wird erst bei Bedarf geladen (teacher.js).
import { h, $, clear, nn, store, deviceId, api, apiUrl, wsUrl, ApiError, toast, errToast, busy, copyText, fmtBytes, fmtDate, fmtClock, fileIcon, downloadUrl, downloadBlob, topbar, icon, setFach, pageHead, modal } from "./ui.js";
import { SUBJECTS, CLASS_GROUPS, STUDENT_LOGIN_MIN, subjectName, formatCode, normalizeCode, fmtDay, classShort, isAnalogClass, webUrlLabel, fmtClockBerlin, fmtDayBerlin, slidesUpTo } from "./shared.js";
import { paintPortalPreview } from "./portalview.js";
import { codeSlideDom } from "./codeslide.js";
import { renderMarkdown } from "./markdown.js";

// Nie in fremden Seiten eingebettet anzeigen: Auf GitHub Pages fehlen die Schutz-Header (frame-ancestors gilt nicht als <meta>)
if (window.top !== window.self) { document.documentElement.hidden = true; throw new Error("Unterricks lässt sich nicht in andere Seiten einbetten."); }

const app = document.getElementById("app");
let disposers = [];
export const onLeave = (fn) => disposers.push(fn);
function leave() { for (const fn of disposers.splice(0)) { try { fn(); } catch {} } }
export function render(...nodes) { leave(); setFach(null); clear(app).append(...nodes); window.scrollTo(0, 0); }
export const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

const S = { get token() { return store.get("u.stoken"); }, set token(v) { if (v) store.set("u.stoken", v); else store.del("u.stoken"); } };

/* ---------- Anmeldung der Schüler:innen: höchstens STUDENT_LOGIN_MIN (90) Minuten (Wunsch der Lehrkraft vom 10.11.2026) ----------
 * Danach fragt die Seite wieder nach dem Passwort. Das Gerät bleibt dasselbe (der Token bleibt gespeichert): freigeschaltete Sitzungen,
 * Fach und Klasse und alles im Browser Gespeicherte bleiben; nach der Anmeldung geht es auf der vorigen Seite weiter. Der Server prüft
 * die Frist bei jeder Anfrage (401 session_expired); hier zählt zusätzlich ein Zeitgeber mit – auch nach dem Ruhezustand des iPads. */
const AUTH_KEY = "u.sauth", BACK_KEY = "u.sback";
let authTimer = null, expiredNote = "";
const beforeExpire = new Set();
/* Seiten mit ungespeichertem Stand (Escape-Room) sichern ihn, bevor abgemeldet wird */
export function onStudentExpire(fn) { beforeExpire.add(fn); onLeave(() => beforeExpire.delete(fn)); }
const onStudentPage = () => /^#\/schueler(\/|$)/.test(location.hash);
function armAuth(leftMs) {
  if (Number.isFinite(leftMs)) store.set(AUTH_KEY, String(Date.now() + Math.max(0, leftMs)));
  clearTimeout(authTimer);
  const until = Number(store.get(AUTH_KEY)) || 0;
  if (until && S.token) authTimer = setTimeout(checkAuth, Math.min(Math.max(0, until - Date.now()) + 300, 2 ** 31 - 1));
}
function checkAuth() {
  const until = Number(store.get(AUTH_KEY)) || 0;
  if (!S.token || !until) return;
  if (Date.now() >= until) { if (onStudentPage()) expireStudent(); }
  else armAuth();
}
function expireStudent(note) {
  for (const fn of [...beforeExpire]) { try { fn(); } catch {} }
  if (onStudentPage()) store.set(BACK_KEY, location.hash);
  // abgelaufen vermerken (statt löschen): andere offene Tabs melden sich so beim nächsten Prüfen ebenfalls ab
  store.set(AUTH_KEY, "1"); clearTimeout(authTimer);
  expiredNote = note || "Du wurdest nach " + STUDENT_LOGIN_MIN + " Minuten abgemeldet. Gib das Passwort erneut ein – danach geht es dort weiter, wo du warst.";
  if (location.hash !== "#/" && location.hash !== "") go("#/");
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkAuth(); });
window.addEventListener("pageshow", checkAuth);
// anderer Tab: abgemeldet bzw. neu angemeldet → hier sofort prüfen bzw. den Zeitgeber neu stellen
window.addEventListener("storage", (e) => { if (e.key === AUTH_KEY) { armAuth(); checkAuth(); } });
/* Restzeit der Anmeldung aus einer Antwort des Servers übernehmen (z. B. vom Escape-Room, der api() direkt nutzt) */
export const studentAuthLeft = (ms) => { if (Number.isFinite(ms)) armAuth(ms); };
/* abgelehnte Anmeldung: abgelaufen → nur das Passwort erneut (Token bleibt); unbekanntes Gerät → neu anmelden. true = erledigt */
export function studentAuthFailed(e) {
  if (e && e.code === "session_expired") { expireStudent(e.message); return true; }
  if (!e || e.status !== 401) return false;
  S.token = null; store.del(AUTH_KEY); go("#/");
  return true;
}
const sapi = async (method, path, o = {}) => {
  try { const r = await api(method, path, { ...o, token: S.token }); if (r && Number.isFinite(r.authLeftMs)) armAuth(r.authLeftMs); return r; }
  catch (e) { if (e && e.code === "session_expired") expireStudent(e.message); throw e; }
};
const footer = (beamer = false) => h("footer", { class: "footer" }, h("a", { href: "#/lehrkraft" }, "Lehrkräfte"),
  // nur auf der Startseite (Passwort): ein Gerät am Beamer (z. B. Schul-iPad an Apple TV) für die Präsentation (Nachtrag 15)
  beamer ? [h("span", { class: "footsep", "aria-hidden": "true", text: "·" }), h("a", { href: "#/beamer", class: "footbeamer" }, "Dieses Gerät als Beamer verwenden")] : null);

/* ---------- Startseite: nur die Passwortabfrage ---------- */
const backHash = () => { const b = store.get(BACK_KEY) || ""; store.del(BACK_KEY); return onStudentHash(b) ? b : "#/schueler"; };
const onStudentHash = (x) => /^#\/schueler(\/[a-z]+\/[a-f0-9]{16})?$/.test(String(x || ""));
async function studentStart() {
  // gerade nach 90 Minuten abgemeldet (Zeitgeber): immer das Passwort – nicht über /me überspringen (die Uhren von Gerät und Server weichen ab)
  if (S.token && !expiredNote) {
    // noch angemeldet? (ohne sapi: eine abgelaufene Anmeldung führte sonst wieder hierher)
    try { const r = await api("GET", "/api/student/me", { token: S.token }); armAuth(r.authLeftMs); return go(backHash()); }
    catch (e) {
      if (e.code === "session_expired") { if (!expiredNote) expiredNote = e.message; }   // Token bleibt: nach dem Passwort weiter wie bisher
      else if (e.status === 401) S.token = null;
      else if (e.status === 0) { /* offline: trotzdem Passwortseite */ }
    }
  }
  const note = expiredNote;   // bleibt bis zur erfolgreichen Anmeldung (die Startseite kann zweimal gezeichnet werden)
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
        S.token = r.token; expiredNote = ""; armAuth(r.authLeftMs); go(backHash());
      } catch (err) {
        if (err.status === 429 && err.data.retryAfter) lock(err.data.retryAfter);
        else msg.textContent = err.message;
        pw.select();
      }
    }, "Prüfe …");
  } },
  h("div", { class: "logo" }, h("img", { src: "/icon.svg", alt: "" }), h("span", { text: "Unterricks" })),
  note ? h("p", { class: "notice", role: "status", id: "spw-note", text: note }) : null,
  h("div", { class: "field" }, h("label", { for: "spw" }, "Passwort"), pw), msg, btn);
  if (note) pw.setAttribute("aria-describedby", "spw-note");
  render(h("div", { class: "login-wrap" }, form), footer(true));
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
  const subjWrap = h("div", { class: "tiles", role: "group", "aria-label": "Fach" }, SUBJECTS.map((s) => h("button", { class: "tile", type: "button", dataset: { fach: s.id }, "aria-pressed": String(s.id === subject), onclick: (e) => {
    subject = s.id; setFach(subject); subjWrap.querySelectorAll(".tile").forEach((t) => t.setAttribute("aria-pressed", "false")); e.currentTarget.setAttribute("aria-pressed", "true"); paintClasses();
  } }, h("div", { class: "t", text: s.name }))));
  setFach(subject);
  paintClasses();
  api("GET", "/api/subjects").then((r) => { grades = Object.fromEntries(Object.entries(r.subjects || {}).map(([k, v]) => [k, v.grades])); paintClasses(); }).catch(() => {});
  save.addEventListener("click", () => busy(save, async () => {
    try { const r = await sapi("PUT", "/api/student/profile", { body: { klass, subject } }); onSave(r.profile); } catch (e) { errToast(e); }
  }));
  return h("div", { class: "stack" },
    h("section", { class: "choose" }, h("h2", { text: "1. Dein Fach" }), subjWrap),
    h("div", { class: "card" }, h("h2", { text: "2. Deine Klasse bzw. dein Kurs" }), classWrap),
    h("div", { class: "row end" }, save));
}

async function studentHome() {
  if (!S.token) return go("#/");
  let me;
  try { me = await sapi("GET", "/api/student/me"); }
  catch (e) { if (studentAuthFailed(e)) return; render(studentBar(), h("main", { class: "narrow" }, h("p", { class: "err", text: e.message }))); return; }
  const main = h("main", { class: "narrow" });
  render(studentBar(), main, footer());
  const show = (profile, forceChoose) => {
    clear(main);
    if (forceChoose || !profile.klass || !profile.subject) {
      main.append(pageHead({ title: "Wähle dein Fach und deine Klasse", sub: "Danach siehst du nur die Sitzungen deines Kurses." }), chooser(profile, (p) => { me.profile = p; show(p); }));
      return;
    }
    const code = h("input", { id: "code", inputmode: "text", autocapitalize: "characters", autocomplete: "off", spellcheck: "false", placeholder: "z. B. K7Q-M4X", maxlength: "9", class: "codein" });
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
      l.hasHomework ? h("span", { class: "badge hw", text: "Hausaufgabe" }) : null, h("span", { class: "btn small" }, "Öffnen")));
    main.append(
      pageHead({ fach: profile.subject, title: "Hallo!", chips: [{ text: subjectName(profile.subject), strong: true }, classShort(profile.klass)],
        aside: h("button", { class: "btn small", type: "button", onclick: () => show(profile, true) }, "Klasse/Fach ändern") }),
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
    if (studentAuthFailed(e)) return;
    clear(main).append(h("div", { class: "card" }, h("p", { class: "err", text: e.message }), h("a", { class: "btn", href: "#/schueler" }, "Zur Übersicht")));
    return;
  }
  const offset = (d.now || Date.now()) - Date.now();
  clear(main);
  main.append(pageHead({ fach: d.lesson.subject, crumbs: [["#/schueler", "Meine Sitzungen"], d.lesson.title], title: d.lesson.title,
    chips: [{ text: d.lesson.subjectName, strong: true }, classShort(d.lesson.klass), d.lesson.date ? fmtDay(d.lesson.date) : null] }));

  // 0) Vertretung: Hinweis auf die Abwesenheit der Lehrkraft und chronologische Anleitung ganz oben
  if (d.substitute) {
    const sub = d.substitute;
    main.append(h("section", { class: "card substitute student", "aria-label": "Vertretungsstunde" },
      h("h2", { text: "Heute ohne deine Lehrkraft" }), h("div", { class: "notice" }, sub.hinweis),
      h("h3", { text: "So gehst du vor – Schritt für Schritt" }),
      h("ol", { class: "sub-steps" }, (sub.schritte || []).map((x) => h("li", null,
        h("div", { class: "row between" }, h("strong", { text: x.titel }), h("span", { class: "row" }, x.minuten ? h("span", { class: "badge", text: "ca. " + x.minuten + " Minuten" }) : null, x.abgabe ? h("span", { class: "badge ink", text: "Abgabe" }) : null)),
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
  const fsBtn = h("button", { class: "btn small fs", type: "button", "aria-label": "Live-Fenster vergrößern" }, icon("expand"), "Groß");
  const live = h("section", { class: "live idle", "aria-label": "Live-Präsentation" }, ph, status, fsBtn);
  live.addEventListener("contextmenu", (e) => e.preventDefault());
  fsBtn.addEventListener("click", () => {
    const fs = live.requestFullscreen || live.webkitRequestFullscreen;
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else if (fs) fs.call(live).catch(() => live.classList.toggle("max"));
    else live.classList.toggle("max");
  });
  const presRow = h("div", { class: "row", style: { margin: ".6rem 0 1.2rem" } });
  // Hausaufgabe aus dieser Sitzung bis zur nächsten Sitzung – der Server liefert sie erst ab 15 Minuten vor dem Ende der Sitzung
  const hwBox = h("div");
  const paintHomework = (hw) => {
    clear(hwBox);
    if (hw) hwBox.append(h("section", { class: "card homework", style: { marginBottom: "1rem" }, "aria-label": "Hausaufgabe" },
      h("h2", { text: "Deine Hausaufgabe" }),
      h("p", { class: "due", text: hw.dueDate ? "Bis zur nächsten Sitzung am " + fmtDay(hw.dueDate) + ":" : "Bis zur nächsten Sitzung:" }),
      paintPortalPreview(h("div", { class: "hwtext" }), hw.text)));
  };
  paintHomework(d.homework);
  // KI-Begriffshilfe unter der Live-Präsentation: nur während der Stunde, nur nach Einwilligung; Fragen und Antworten nur im Arbeitsspeicher
  const kiBox = h("div"), KI_KEY = "u.kihelp." + lessonId;
  let aiHelp = d.aiHelp, kiChat = [], kiCard = null;
  const kiOpen = () => { const n = Date.now() + offset; return !!aiHelp && n >= aiHelp.start && n <= aiHelp.end; };
  function paintKi() {
    if (!kiOpen()) { clear(kiBox); kiCard = null; return; }
    if (kiCard && kiCard.dataset.consent === String(store.get(KI_KEY) === "1")) return;   // schon passend gezeichnet (Eingabe bleibt erhalten)
    const consented = store.get(KI_KEY) === "1";
    kiCard = h("section", { class: "card kihelp", "aria-labelledby": "ki-h", dataset: { consent: String(consented) } }, h("h2", { id: "ki-h", text: "KI-Begriffshilfe" }));
    if (!consented) {
      kiCard.append(h("p", { class: "small", text: "Ein Fachbegriff ist dir unklar? Die KI erklärt ihn dir kurz und einfach – nur, wenn du das möchtest." }),
        h("button", { class: "btn small", type: "button", onclick: () => askKiConsent() }, "KI-Begriffshilfe nutzen"));
    } else {
      const log = h("div", { class: "kilog", role: "log", "aria-live": "polite", "aria-label": "Fragen und Antworten" });
      const inp = h("input", { id: "ki-q", maxlength: "300", autocomplete: "off", enterkeyhint: "send", placeholder: "z. B. Was bedeutet „Gewaltenteilung“?" });
      const btn = h("button", { class: "btn primary small", type: "submit" }, "Fragen");
      const paintLog = () => clear(log).append(...kiChat.map((x) => h("div", { class: "kiq" }, h("p", { class: "q" }, h("span", { class: "sr-only", text: "Deine Frage: " }), x.q),
        x.a ? h("p", { class: "a" }, h("span", { class: "sr-only", text: "Antwort: " }), x.a) : x.err ? h("p", { class: "a err", text: x.err }) : h("p", { class: "a muted", text: "Die KI denkt nach …" }))));
      paintLog();
      const form = h("form", { class: "row", onsubmit: async (e) => {
        e.preventDefault();
        const q = inp.value.trim(); if (q.length < 2 || btn.disabled) return;
        const history = kiChat.filter((x) => x.a).slice(-3).map((x) => ({ q: x.q, a: x.a }));
        const item = { q }; kiChat.push(item); inp.value = ""; paintLog();
        btn.disabled = true;
        try { item.a = (await sapi("POST", "/api/student/lessons/" + lessonId + "/ask", { body: { question: q, history, consent: true } })).answer; }
        catch (err) { item.err = err.message; }
        btn.disabled = false; paintLog(); inp.focus();
      } }, h("label", { class: "sr-only", for: "ki-q" }, "Deine Frage an die KI-Begriffshilfe"), h("div", { class: "grow" }, inp), btn);
      kiCard.append(log, form, h("p", { class: "hint" }, "KI-Antworten können falsch sein – frag im Zweifel deine Lehrkraft. Gib keine persönlichen Daten ein. ",
        h("button", { class: "linkbtn", type: "button", onclick: () => { store.del(KI_KEY); kiChat = []; paintKi(); } }, "Einwilligung zurücknehmen")));
    }
    clear(kiBox).append(kiCard);
  }
  function askKiConsent() {
    const box = h("input", { type: "checkbox", id: "ki-ok" });
    const providers = (aiHelp && aiHelp.providers && aiHelp.providers.length ? aiHelp.providers : ["einen kostenlosen KI-Dienst"]).join(", ");
    modal({ title: "KI-Begriffshilfe nutzen?", body: (el) => el.append(
      h("p", { text: "Die KI-Begriffshilfe beantwortet dir während der Stunde kurz und einfach Fragen zu Fachbegriffen und zum Unterrichtsthema." }),
      h("ul", { class: "kiconsent" },
        h("li", { text: "Deine Fragen gehen an einen kostenlosen KI-Dienst: " + providers + ". Dein Name wird nicht übertragen – aber alles, was du eintippst. Gib deshalb keine persönlichen Daten ein (z. B. Namen, Adresse, Gesundheit)." }),
        h("li", { text: "Unterricks speichert deine Fragen und die Antworten nicht; sie verschwinden, wenn du die Seite neu lädst oder verlässt. Was der KI-Dienst damit macht, regeln seine eigenen Bedingungen." }),
        h("li", { text: "Diese KI-Begriffshilfe ist datenschutzrechtlich nicht für die Schule vorgesehen. Du nutzt sie freiwillig und nur, wenn du das ausdrücklich möchtest – ohne sie entsteht dir kein Nachteil." }),
        h("li", { text: "KI-Antworten können falsch sein. Sie ersetzen nicht deine Lehrkraft." })),
      h("label", { class: "checkrow" }, box, h("span", { text: "Ich habe das gelesen und möchte die KI-Begriffshilfe freiwillig nutzen." }))),
      actions: [{ label: "Abbrechen" }, { label: "Einwilligen und starten", class: "primary", onClick: () => {
        if (!box.checked) { toast("Bitte setze zuerst den Haken, wenn du die KI-Begriffshilfe nutzen möchtest.", "err"); return false; }
        store.set(KI_KEY, "1"); paintKi(); setTimeout(() => { const i = document.getElementById("ki-q"); if (i) i.focus(); }, 60);
      } }] });
  }
  paintKi();
  main.append(live, presRow, kiBox, hwBox);
  let lastV = -1, seq = 0, codeEl = null;
  const dropCode = () => { if (codeEl) { codeEl.remove(); codeEl = null; } };
  function showState(st) {
    if (!st || typeof st !== "object") return;
    if (st.v !== undefined && st.v === lastV && st.active) return;
    lastV = st.v;
    const my = ++seq;   // ein spät geladenes Folienbild überschreibt nie einen neueren Stand
    clear(status);
    // Codefolie (Sitzungscode + QR-Code): beim Start vor Folie 1, an Platzhalterfolien und über „Sitzungscode zeigen“ der Lehrkraft
    const isCode = !!(st.active && st.view === "code" && st.code);
    live.classList.toggle("idle", !(st.active && (st.url || isCode)));
    const onair = () => h("span", { class: "badge onair" }, h("span", { class: "dot" }), "LIVE");
    if (isCode) {
      status.append(onair(), h("span", { class: "badge", text: st.slide >= 1 && !st.codeShown ? "Folie " + st.slide + " / " + st.pages : "Sitzungscode" }));
      const el = codeSlideDom({ code: st.code, title: st.title, lines: Array.isArray(st.lines) ? st.lines : [] });
      img.remove(); ph.remove();
      if (codeEl) codeEl.replaceWith(el); else live.prepend(el);
      codeEl = el;
    } else if (st.active && st.url) {
      status.append(onair(), h("span", { class: "badge", text: "Folie " + st.slide + " / " + st.pages }));
      const pre = new Image();
      pre.onload = () => { if (my !== seq) return; img.src = pre.src; dropCode(); if (!img.isConnected) { ph.remove(); live.prepend(img); } };
      pre.src = apiUrl(st.url);
    } else {
      img.remove(); dropCode(); if (!ph.isConnected) live.prepend(ph);
    }
  }
  // WebSocket mit Wiederverbindung; ersatzweise alle 2 s abfragen
  let ws = null, closed = false, fails = 0, pollT = null, pingT = null, reT = null;
  const poll = async () => { try { const r = await sapi("GET", "/api/student/lessons/" + lessonId + "/live"); showState(r.live); } catch {} };
  async function connect() {
    if (closed) return;
    try {
      const t = await sapi("POST", "/api/student/lessons/" + lessonId + "/live-ticket");
      ws = new WebSocket(wsUrl(t.url));
      ws.onopen = () => { fails = 0; clearInterval(pollT); pollT = null; clearInterval(pingT); pingT = setInterval(() => { try { ws.send("ping"); } catch {} }, 25000); };
      ws.onmessage = (ev) => { if (ev.data === "pong") return; try { showState(JSON.parse(ev.data)); } catch {} };
      ws.onclose = () => { clearInterval(pingT); if (closed) return; fails++; if (fails >= 2 && !pollT) { poll(); pollT = setInterval(poll, 2000); } reT = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(fails, 4))); };
    } catch { fails++; if (!pollT) { poll(); pollT = setInterval(poll, 2000); } reT = setTimeout(connect, 5000); }
  }
  connect();
  const onVis = () => { if (document.visibilityState === "visible") { poll(); if (!ws || ws.readyState > 1) { clearTimeout(reT); connect(); } } };
  document.addEventListener("visibilitychange", onVis);
  onLeave(() => { closed = true; clearInterval(pollT); clearInterval(pingT); clearTimeout(reT); document.removeEventListener("visibilitychange", onVis); try { ws && ws.close(); } catch {} });

  // Präsentation selbst öffnen: erst 5 Minuten nach dem Ende der Sitzung; ist die letzte gezeigte Folie markiert, nur bis dorthin
  let pres = d.presentation;
  const renderPres = () => {
    clear(presRow);
    if (!pres) return;
    const unlocked = pres.unlockAt !== null && Date.now() + offset >= pres.unlockAt;
    if (unlocked) {
      presRow.append(...nn(h("button", { class: "btn primary", type: "button", onclick: (e) => openPresentation(e.currentTarget) }, pres.upTo ? "Präsentation (" + slidesUpTo(pres.upTo) + ") selbst öffnen" : "Präsentation selbst öffnen und durchklicken"),
        pres.upTo ? h("span", { class: "muted small", text: "So weit, wie ihr im Unterricht gekommen seid." }) : null));
    } else if (pres.unlockAt === null) {
      presRow.append(h("span", { class: "muted small", text: "Die Präsentation kannst du nach dem Unterricht selbst öffnen." }));
    } else {
      const day = fmtDayBerlin(pres.unlockAt) === fmtDayBerlin(Date.now() + offset) ? "" : fmtDayBerlin(pres.unlockAt) + ", ";
      presRow.append(h("span", { class: "muted small", text: "Die Präsentation kannst du ab " + day + fmtClockBerlin(pres.unlockAt) + " Uhr selbst öffnen (5 Minuten nach dem Unterricht)." }));
    }
  };
  // Hausaufgabe erscheint bzw. Präsentation wird frei: zu diesen Zeitpunkten neu laden (auch nach dem Aufwachen des iPads)
  const pending = (d.changesAt || []).slice();
  const refresh = async () => {
    try { const r = await sapi("GET", "/api/student/lessons/" + lessonId); pres = r.presentation; renderPres(); paintHomework(r.homework); aiHelp = r.aiHelp; paintKi(); pending.splice(0, pending.length, ...(r.changesAt || [])); plan(); } catch {}
  };
  let chT = null;
  const plan = () => { clearTimeout(chT); const next = Math.min(...pending); if (Number.isFinite(next)) chT = setTimeout(refresh, Math.max(1000, Math.min(next - (Date.now() + offset) + 1500, 6 * 3600e3))); };
  plan();
  const onVisCh = () => { if (document.visibilityState === "visible" && pending.some((t) => Date.now() + offset >= t)) refresh(); };
  document.addEventListener("visibilitychange", onVisCh);
  onLeave(() => { clearTimeout(chT); document.removeEventListener("visibilitychange", onVisCh); });
  async function openPresentation(btn) {
    const w = window.open("about:blank", "_blank");
    await busy(btn, async () => {
      try { const r = await sapi("POST", "/api/student/lessons/" + lessonId + "/presentation-link", { body: { inline: true } }); if (w) w.location.href = apiUrl(r.url); else location.href = apiUrl(r.url); }
      catch (e) { if (w) w.close(); errToast(e); }
    }, "Öffne …");
  }
  renderPres();

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
  const notfallFiles = d.files.filter((f) => f.notfall), matFiles = d.files.filter((f) => !f.notfall);
  const fileRow = (f) => {
    const acts = h("div", { class: "acts" });
    const meta = f.kind === "link" ? "Link · " + webUrlLabel(f.url) : f.kind === "text" ? "Text · als PDF herunterladen" : fmtBytes(f.size);
    const row = h("div", { class: "item" }, fileIcon(f.name, f.mime, f.kind), h("div", { class: "main" }, h("div", { class: "name", text: f.name }), h("div", { class: "meta", text: meta })), acts);
    if (f.kind === "link") {
      if (f.url) acts.append(h("a", { class: "btn primary small", href: f.url, target: "_blank", rel: "noopener noreferrer" }, "Öffnen", h("span", { class: "sr-only", text: " (öffnet in neuem Tab)" })));
    } else if (f.kind === "text") {
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
    return row;
  };
  mats.append(...matFiles.map(fileRow));
  if (!d.sheets.length && !matFiles.length) mats.append(h("p", { class: "muted", text: "Deine Lehrkraft hat für diese Sitzung noch kein Material freigegeben." }));
  main.append(h("section", { class: "card" }, h("h2", { text: "Material" }), mats,
    matFiles.some((f) => f.kind !== "link") ? h("p", { class: "hint", text: "Tipp fürs iPad: Nach dem Herunterladen über „Teilen“ → „GoodNotes“ öffnen und dort bearbeiten." }) : null));
  // 3) Notfall-Feibeitsblätter (das analoge Arbeitsblatt zu jedem Feibeitsblatt): eigenes Kästchen weiter unten, nur für technische Probleme
  if (notfallFiles.length) main.append(h("section", { class: "card notfallbox", "aria-labelledby": "nf-h" },
    h("p", { class: "alarm", role: "note" }, icon("alert"), h("span", null, h("strong", { text: "Achtung! " }), NOTFALL_NOTE)),
    h("h2", { id: "nf-h", text: "Notfall-Feibeitsblätter" }), h("div", { class: "list" }, notfallFiles.map(fileRow))));
}
// Wortlaut der Lehrkraft (Komma vor „soll“ entfernt)
export const NOTFALL_NOTE = "Eigentlich sollst du mit den digitalen Feibeitsblättern arbeiten, die du in dieser Sitzung aufrufen kannst. Die hier verfügbaren PDF-Dateien sind nur für diejenigen Schülerinnen und Schüler gedacht, " +
  "die technische Probleme beim Aufrufen von Feibeitsblättern haben. Nur in diesen Ausnahmefällen soll mit einem Notfall-Feibeitsblatt gearbeitet werden.";

/* ---------- Router ---------- */
const ROUTES = [
  [/^#?\/?$/, () => studentStart()],
  [/^#\/schueler$/, () => studentHome()],
  [/^#\/schueler\/s\/([a-f0-9]{16})$/, (m) => studentRoom(m[1])],
  [/^#\/schueler\/escape\/([a-f0-9]{16})$/, (m) => import("./escape.js").then((x) => x.escapePage(m[1])).catch((e) => { render(h("main", null, h("p", { class: "err", text: "Der Escape-Room konnte nicht geladen werden: " + e.message }))); })],
  // Elternansicht (Grundschule): geheimer Link der Lehrkraft, ohne Anmeldung; lädt keine Module der Lehrkraft
  [/^#\/eltern\/([A-Za-z0-9_-]{32})(?:\/(s|pdf)\/([a-f0-9]{16})(?:\/([a-f0-9]{16}))?)?$/, (m) => import("./parents.js").then((p) => p.parentsPage(m[1], m[2] || null, m[3] || null, m[4] || null)).catch((e) => { render(h("main", null, h("p", { class: "err", text: "Die Elternansicht konnte nicht geladen werden: " + e.message }))); })],
  [/^#\/eltern(?:\/.*)?$/, () => import("./parents.js").then((p) => p.parentsPage("", null, null, null)).catch(() => go("#/"))],   // beschädigter Link: Meldung des Servers
  [/^#\/beamer$/, () => import("./beamer.js").then((b) => b.beamerPage()).catch((e) => { render(h("main", null, h("p", { class: "err", text: "Das Beamerfenster konnte nicht geladen werden: " + e.message }))); })],
  [/^#\/(lehrkraft|lk)(\/.*)?$/, () => import("./teacher.js").then((t) => t.route(location.hash)).catch((e) => { render(h("main", null, h("p", { class: "err", text: "Die Lehrkräfteansicht konnte nicht geladen werden: " + e.message }))); })],
];
export function route() {
  const hash = location.hash || "#/";
  for (const [re, fn] of ROUTES) { const m = re.exec(hash); if (m) return fn(m); }
  go("#/");
}
window.addEventListener("hashchange", route);
checkAuth();   // gespeicherte Frist der Anmeldung (auch nach dem Neuladen)
// beim Abmelden gesicherte Escape-Room-Stände (mit Namen) nicht länger als einen Tag auf dem Gerät lassen
try { for (const k of Object.keys(localStorage)) if (k.startsWith("u.esc.")) { let at = 0; try { at = Number(JSON.parse(localStorage.getItem(k)).at); } catch {} if (!(Date.now() - at < 24 * 3600e3)) localStorage.removeItem(k); } } catch {}
route();
export { ApiError, $ };
