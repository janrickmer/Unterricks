// app.js – Einstieg: Router und Schüleransicht. Die Lehrkräfteansicht wird erst bei Bedarf geladen (teacher.js).
import { h, $, clear, store, deviceId, api, apiUrl, wsUrl, ApiError, toast, errToast, busy, copyText, fmtBytes, fmtDate, fmtClock, fileIcon, downloadUrl, downloadBlob, topbar, icon, setFach, pageHead, modal, openLayer, settleIn, bandShown, logoMark, loginFoils, firstLay } from "./ui.js";
import { SUBJECTS, CLASS_GROUPS, STUDENT_LOGIN_MIN, subjectName, formatCode, normalizeCode, fmtDay, classShort, isAnalogClass, webUrlLabel, fmtClockBerlin, fmtDayBerlin } from "./shared.js";
import { paintPortalPreview } from "./portalview.js";
import { codeSlideDom } from "./codeslide.js";
import { timerBand } from "./timerband.js";
import { renderMarkdown } from "./markdown.js";
import { slideViewer } from "./slideviewer.js";
import { termCards } from "./termcards.js";
import { lazy, isModuleError, pageFailed, navCheckDue, navBlockers, beforeRoute, waitPage, holdReload, beforeReload, installUpdateChecks } from "./update.js";
import { fbAgainItem } from "./fbagain.js";
import { revealWatch, latestOnly } from "./reveal.js";
// Nachtrag 44 (Teil 2): Hinweis „nicht die aktuellste Sitzung“ und Text zur Code-Eingabe
import { newerNote, wantCodeFocus, takeCodeFocus, dropCodeFocus } from "./newernote.js";
import { CODE_WHERE_TEXT, NEWER_RECHECK_MS } from "./shared.js";

// Nie in fremden Seiten eingebettet anzeigen: Auf GitHub Pages fehlen die Schutz-Header (frame-ancestors gilt nicht als <meta>)
if (window.top !== window.self) { document.documentElement.hidden = true; throw new Error("Unterricks lässt sich nicht in andere Seiten einbetten."); }

const app = document.getElementById("app");
let disposers = [];
export const onLeave = (fn) => disposers.push(fn);
function leave() { for (const fn of disposers.splice(0)) { try { fn(); } catch {} } }
export function render(...nodes) { leave(); setFach(null); clear(app).append(...nodes); window.scrollTo(0, 0); bandShown(app); settleIn([...app.children].find((c) => c.tagName === "MAIN")); }
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
// „Jetzt neu laden“ nach einem Update (update.js): dieselben Sicherungen wie vor der Abmeldung – im Escape-Room geht es nach dem Neuladen dort weiter
beforeReload(() => { for (const fn of [...beforeExpire]) { try { fn(); } catch {} } });
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
  const btn = h("button", { class: "btn primary big", type: "submit" }, "Weiter", icon("arrow"));
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
  h("h2", { text: "Anmelden" }),
  note ? h("p", { class: "notice", role: "status", id: "spw-note", text: note }) : null,
  h("div", { class: "field" }, h("label", { for: "spw" }, "Passwort"), pw, h("p", { class: "hint", id: "spw-h", text: "Das Passwort bekommst du von deiner Lehrkraft." })), msg, btn);
  pw.setAttribute("aria-describedby", (note ? "spw-note " : "") + "spw-h");
  // Startseite (Nachtrag 40): Schriftzug, ein Satz und die drei Schritte neben der Anmeldekarte; beim ersten Bild nach dem Laden legen sich die Folien auf,
  // der Folienstift schreibt das Logo, das Abdeckblatt gibt den Schriftzug frei, der Marker unterstreicht, zuletzt legt sich die Karte hin
  const hero = h("div", { class: "start-hero" },
    h("div", { class: "start-text" },
      h("h1", { class: "wordmark" }, logoMark(), h("span", { class: "reveal", text: "Unterricks" })),
      h("p", { class: "start-lead" }, "Präsentation, Material und Hausaufgabe deiner Stunde – ", h("span", { class: "hl", text: "an einem Ort" }), "."),
      h("ol", { class: "start-steps", "aria-label": "So geht es weiter" }, ["Passwort", "Fach und Klasse", "Sitzungscode"].map((t, i) =>
        h("li", { style: "--i:" + i }, h("span", { class: "n", "aria-hidden": "true", text: String(i + 1) }), t)))),
    form);
  render(h("div", { class: "login-wrap start" + (firstLay() ? " play" : "") }, ...loginFoils("a", "b", "c"), hero), footer(true));
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
  const main = h("main", { class: "narrow", "data-settle": "" });
  render(studentBar(), main, footer());
  const show = (profile, forceChoose) => {
    clear(main);
    if (forceChoose || !profile.klass || !profile.subject) {
      main.append(pageHead({ title: "Wähle dein Fach und deine Klasse", sub: "Danach siehst du nur die Sitzungen deines Kurses." }), chooser(profile, (p) => { me.profile = p; show(p); }));
      return;
    }
    // „Aktuellste Sitzung laden“ (Nachtrag 44, Teil 2): die Eingabe des Sitzungscodes bekommt danach den Fokus – auch mit schon freigeschalteten Sitzungen
    // (der Wunsch übersteht ein Neuladen beim Seitenwechsel und gilt bis zum nächsten Zeichnen des Formulars, siehe newernote.js)
    const focusCode = takeCodeFocus();
    const code = h("input", { id: "code", inputmode: "text", autocapitalize: "characters", autocomplete: "off", spellcheck: "false", placeholder: "z. B. K7Q-M4X", maxlength: "9", class: "codein", "aria-describedby": "code-h" });
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
    } }, h("h2", { text: "Neue Sitzung freischalten" }), h("div", { class: "field" }, h("label", { for: "code" }, "Sitzungscode deiner Lehrkraft"), code,
      // immer (Nachtrag 44, Teil 2): wo es den Code gibt – gezeigt zu Beginn der Stunde, im Schulportal im Feld „Hausaufgabe“
      h("p", { class: "hint", id: "code-h", text: CODE_WHERE_TEXT })), msg, btn,
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
    if (!lessons.length || focusCode) setTimeout(() => code.focus(), 50);
  };
  show(me.profile || {});
}

/* ---------- Sitzungsraum der Schüler:innen ---------- */
async function studentRoom(lessonId) {
  dropCodeFocus();   // zurück in eine Sitzung, bevor das Formular für den Code gezeichnet war: der Wunsch „Fokus dorthin“ gilt nicht mehr (Nachtrag 44)
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
  // Selbstlern-Phase mit iPads (Nachtrag 29 Teil B): eigene Ansicht (selbstlernview.js) – Erklärung, Ablaufplan mit den Stationen, Hausaufgabe,
  // weiteres Material und ganz unten die KI-Begriffshilfe; ohne Live-Fenster und ohne die Präsentation der ursprünglichen Planung.
  // Jahrgang 5/6 (analog, auf Papier) behält die bisherige Ansicht.
  const selbst = !!(d.selbstlern && !d.selbstlern.analog && Array.isArray(d.selbstlern.stationen));
  let SV = null;
  if (selbst) {
    try { SV = await lazy(import("./selbstlernview.js")); }
    catch (e) {
      if (isModuleError(e)) { pageFailed(e, render); return; }
      clear(main).append(h("div", { class: "card" }, h("p", { class: "err", text: "Die Selbstlern-Phase konnte nicht geladen werden: " + e.message }), h("a", { class: "btn", href: "#/schueler" }, "Zur Übersicht")));
      return;
    }
  }
  const offset = (d.now || Date.now()) - Date.now();
  clear(main);
  main.append(pageHead({ fach: d.lesson.subject, crumbs: [["#/schueler", "Meine Sitzungen"], d.lesson.title], title: d.lesson.title,
    chips: [{ text: d.lesson.subjectName, strong: true }, classShort(d.lesson.klass), d.lesson.date ? fmtDay(d.lesson.date) : null] }));
  // 0) Nachtrag 44 (Teil 2): ist eine spätere Sitzung des Kurses schon dran (laut Plan oder schon live), ganz oben – vor allem anderen, auch in einer
  // Selbstlern-Phase oder Vertretung – der rote Hinweis mit „Aktuellste Sitzung laden“ (zur Eingabe des Sitzungscodes; die Sitzung wird dabei wie bei
  // jedem Seitenwechsel verlassen: Live-Verbindung und Zeitgeber enden). Ohne spätere Sitzung bleibt der Platz leer.
  const newerBox = newerNote({ onGo: () => wantCodeFocus() });
  newerBox.set(d.newer);
  main.append(newerBox.el);
  const fileRow = (f) => materialRow(f, d);
  const sheetRow = (s) => sheetItem(s, d.feibeitsblattUrl);

  // 0) Vertretung: Hinweis auf die Abwesenheit der Lehrkraft und chronologische Anleitung ganz oben
  if (d.substitute && !selbst) {
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
      h("p", { class: "hint", text: d.selbstlern && d.selbstlern.analog ? "Den Laufzettel und die Arbeitsblätter der Stationen bekommst du ausgedruckt."
        : "Das Material zu den Schritten findest du unten unter „Material“." + (d.sheets.length ? " Die Abgabe machst du im Feibeitsblatt (Knopf „Code kopieren und Feibeitsblatt öffnen“)." : "") })));
  }

  const presRow = h("div", { class: "presrow" });
  // Hausaufgabe aus dieser Sitzung bis zur nächsten Sitzung – der Server liefert sie erst ab 15 Minuten vor dem Ende der Sitzung
  // (in einer Selbstlern-Phase von Anfang an: alle Stationen bis zur nächsten Stunde mit der Lehrkraft)
  const hwBox = h("div");
  let hwKey = null;
  const paintHomework = (hw) => {
    // unverändert (z. B. Neuladen beim Aufwachen, Nachtrag 44 Teil 2): stehen lassen – sonst ginge ein Fokus auf einem Link darin verloren
    const key = JSON.stringify(hw || null);
    if (key === hwKey) return;
    hwKey = key;
    clear(hwBox);
    if (hw) hwBox.append(h("section", { class: "card homework", style: { marginBottom: "1rem" }, "aria-label": "Hausaufgabe" },
      h("h2", { text: "Deine Hausaufgabe" }),
      h("p", { class: "due", text: d.selbstlern ? (hw.dueDate ? "Bis zur nächsten Stunde mit deiner Lehrkraft am " + fmtDay(hw.dueDate) + ":" : "Bis zur nächsten Stunde mit deiner Lehrkraft:")
        : hw.dueDate ? "Bis zur nächsten Sitzung am " + fmtDay(hw.dueDate) + ":" : "Bis zur nächsten Sitzung:" }),
      paintPortalPreview(h("div", { class: "hwtext" }), hw.text)));
  };
  paintHomework(d.homework);
  // Fachbegriffe dieser Sitzung (Nachtrag 44, Teil 3; nur Oberstufe): Karteikarten ganz unten – der Server liefert sie erst ab 2 Minuten vor dem Ende
  const termsView = termCards();
  termsView.update(d.terms);
  // KI-Begriffshilfe unter der Live-Präsentation: nur während der Stunde, nur nach Einwilligung; Fragen und Antworten nur im Arbeitsspeicher.
  // Selbstlern-Phase: ganz unten, ab dem Beginn der Sitzung bis zur nächsten Stunde mit der Lehrkraft; dieselbe Einwilligung gilt für den Erklär-Chatbot
  // Selbstlern-Phase: eigene Einwilligung (ihr Text nennt beide Chatbots) – eine Einwilligung aus der normalen Sitzung (nur Begriffshilfe) gilt dort nicht
  const kiBox = h("div"), KI_KEY = "u.kihelp." + (selbst ? "sl." : "") + lessonId;
  let aiHelp = d.aiHelp, kiChat = [], kiCard = null, slv = null;
  const kiOpen = () => { const n = Date.now() + offset; return !!aiHelp && n >= aiHelp.start && n <= aiHelp.end; };
  const kiConsent = { ok: () => store.get(KI_KEY) === "1", ask: (opener, after) => askKiConsent(opener, after),
    revoke: () => { store.del(KI_KEY); kiChat = []; paintKi(); if (slv) slv.repaint(); } };
  function paintKi() {
    if (!kiOpen()) { clear(kiBox); kiCard = null; return; }
    if (kiCard && kiCard.dataset.consent === String(store.get(KI_KEY) === "1")) return;   // schon passend gezeichnet (Eingabe bleibt erhalten)
    const consented = store.get(KI_KEY) === "1";
    kiCard = h("section", { class: "card kihelp", "aria-labelledby": "ki-h", dataset: { consent: String(consented) } }, h("h2", { id: "ki-h", text: "KI-Begriffshilfe" }));
    if (!consented) {
      kiCard.append(h("p", { class: "small", text: selbst ? "Ein Fachbegriff ist dir unklar oder du hast eine Verständnisfrage zum Thema? Die KI erklärt es dir kurz und einfach – nur, wenn du das möchtest."
        : "Ein Fachbegriff ist dir unklar? Die KI erklärt ihn dir kurz und einfach – nur, wenn du das möchtest." }),
        h("button", { class: selbst ? "btn" : "btn small", type: "button", onclick: (e) => askKiConsent(e.currentTarget) }, "KI-Begriffshilfe nutzen"));
    } else {
      const log = h("div", { class: "kilog", role: "log", "aria-live": "polite", "aria-label": "Fragen und Antworten" });
      const inp = h("input", { id: "ki-q", maxlength: "300", autocomplete: "off", enterkeyhint: "send", placeholder: "z. B. Was bedeutet „Gewaltenteilung“?" });
      const btn = h("button", { class: selbst ? "btn primary" : "btn primary small", type: "submit" }, "Fragen");
      const paintLog = () => clear(log).append(...kiChat.map((x) => h("div", { class: "kiq" }, h("p", { class: "q" }, h("span", { class: "sr-only", text: "Deine Frage: " }), x.q),
        x.a ? h("p", { class: "a" }, h("span", { class: "sr-only", text: "Antwort: " }), x.a) : x.err ? h("p", { class: "a err", text: x.err }) : h("p", { class: "a muted", text: "Die KI denkt nach …" }))));
      paintLog();
      const form = h("form", { class: "row", onsubmit: async (e) => {
        e.preventDefault();
        const q = inp.value.trim(); if (q.length < 2 || btn.disabled) return;
        // Selbstlern-Phase: frühere Antworten nur mit ihrer Unterschrift des Servers (sonst zählen sie dort nicht)
        const history = selbst ? kiChat.filter((x) => x.a && x.sig).slice(-3).map((x) => ({ q: x.q, a: x.a, sig: x.sig })) : kiChat.filter((x) => x.a).slice(-3).map((x) => ({ q: x.q, a: x.a }));
        const item = { q }; kiChat.push(item); inp.value = ""; paintLog();
        btn.disabled = true;
        try {
          const r = await sapi("POST", "/api/student/lessons/" + lessonId + "/ask", { body: { question: q, history, consent: true } });
          item.a = r.answer;
          if (selbst) { if (typeof r.q === "string" && r.q) item.q = r.q; item.sig = r.sig || null; }
        } catch (err) { item.err = err.message; }
        btn.disabled = false; paintLog();
        // Selbstlern-Phase: nur zurück ins Feld, wenn die Person den Fokus nicht inzwischen woandershin gesetzt hat
        if (!selbst) inp.focus(); else { const a = document.activeElement; if (!a || a === document.body || a === btn || a === inp || !a.isConnected) inp.focus(); }
      } }, h("label", { class: "sr-only", for: "ki-q" }, "Deine Frage an die KI-Begriffshilfe"), h("div", { class: "grow" }, inp), btn);
      kiCard.append(log, form, ...(selbst && aiHelp.untilNext ? [h("p", { class: "hint", text: "Die KI-Begriffshilfe gibt es bis zum Beginn der nächsten Stunde mit deiner Lehrkraft (" + fmtDayBerlin(aiHelp.end) + ", " + fmtClockBerlin(aiHelp.end) + " Uhr)." })] : []),
        h("p", { class: "hint" }, "KI-Antworten können falsch sein – frag im Zweifel deine Lehrkraft. Gib keine persönlichen Daten ein. ",
        h("button", { class: "linkbtn", type: "button", onclick: () => kiConsent.revoke() }, "Einwilligung zurücknehmen")));
    }
    clear(kiBox).append(kiCard);
  }
  // opener: Knopf, der den Dialog geöffnet hat; after() → Feld, das danach den Fokus bekommt (Erklär-Chatbot) – sonst das Feld der Begriffshilfe
  function askKiConsent(opener, after) {
    const box = h("input", { type: "checkbox", id: "ki-ok" });
    const providers = (aiHelp && aiHelp.providers && aiHelp.providers.length ? aiHelp.providers : d.explain && d.explain.providers && d.explain.providers.length ? d.explain.providers : ["einen kostenlosen KI-Dienst"]).join(", ");
    // Selbstlern-Phase: eine Einwilligung für beide Chatbots – der Text nennt nur, was es in dieser Sitzung gibt (Begriffshilfe abgeschaltet: nur der Erklär-Chatbot)
    const bot = selbst && !!d.explain, help = !bot || !!aiHelp, both = bot && help;
    const them = both ? "die KI-Chatbots" : bot ? "den Erklär-Chatbot" : "die KI-Begriffshilfe";
    modal({ title: selbst ? (both ? "KI-Chatbots nutzen?" : bot ? "Erklär-Chatbot nutzen?" : "KI-Begriffshilfe nutzen?") : "KI-Begriffshilfe nutzen?", body: (el) => el.append(
      selbst ? h("p", { text: both ? "In dieser Selbstlern-Phase gibt es zwei KI-Chatbots: den Erklär-Chatbot an einer Station – du erklärst ihm, was du erarbeitet hast, und er fragt kritisch nach – " +
          "und ganz unten die KI-Begriffshilfe, die dir Fachbegriffe und Verständnisfragen kurz und einfach erklärt. Diese Einwilligung gilt für beide."
          : bot ? "In dieser Selbstlern-Phase gibt es an einer Station den Erklär-Chatbot: Du erklärst ihm, was du erarbeitet hast, und er fragt kritisch nach."
          : "Die KI-Begriffshilfe beantwortet dir in dieser Selbstlern-Phase kurz und einfach Fragen zu Fachbegriffen und zum Thema der Sitzung." })
        : h("p", { text: "Die KI-Begriffshilfe beantwortet dir während der Stunde kurz und einfach Fragen zu Fachbegriffen und zum Unterrichtsthema." }),
      h("ul", { class: "kiconsent" },
        selbst ? h("li", { text: "Was du eintippst, geht an einen kostenlosen KI-Dienst: " + providers + ". Dazu bekommt er nur das Thema der Sitzung" + (bot ? " und beim Erklär-Chatbot den Auftrag der Station" : "") +
            ". Dein Name wird nicht übertragen – aber alles, was du eintippst. Gib deshalb keine persönlichen Daten ein (z. B. Namen, Adresse, Gesundheit)." })
          : h("li", { text: "Deine Fragen gehen an einen kostenlosen KI-Dienst: " + providers + ". Dein Name wird nicht übertragen – aber alles, was du eintippst. Gib deshalb keine persönlichen Daten ein (z. B. Namen, Adresse, Gesundheit)." }),
        h("li", { text: selbst ? "Unterricks speichert deine Nachrichten und die Antworten nicht; sie verschwinden, wenn du die Seite neu lädst oder verlässt. Was der KI-Dienst damit macht, regeln seine eigenen Bedingungen."
          : "Unterricks speichert deine Fragen und die Antworten nicht; sie verschwinden, wenn du die Seite neu lädst oder verlässt. Was der KI-Dienst damit macht, regeln seine eigenen Bedingungen." }),
        h("li", { text: selbst ? (both ? "Diese KI-Chatbots sind" : bot ? "Dieser KI-Chatbot ist" : "Diese KI-Begriffshilfe ist") + " datenschutzrechtlich nicht für die Schule vorgesehen. Du nutzt " + (both ? "sie" : bot ? "ihn" : "sie") + " freiwillig und nur, wenn du das ausdrücklich möchtest – ohne " + (bot && !both ? "ihn" : "sie") + " entsteht dir kein Nachteil" +
            (bot ? ": Die Station mit dem Erklär-Chatbot schaffst du auch, indem du deine Erklärung in dein Heft schreibst." : ".")
          : "Diese KI-Begriffshilfe ist datenschutzrechtlich nicht für die Schule vorgesehen. Du nutzt sie freiwillig und nur, wenn du das ausdrücklich möchtest – ohne sie entsteht dir kein Nachteil." }),
        h("li", { text: "KI-Antworten können falsch sein. Sie ersetzen nicht deine Lehrkraft." })),
      h("label", { class: "checkrow" }, box, h("span", { text: selbst ? "Ich habe das gelesen und möchte " + them + " freiwillig nutzen." : "Ich habe das gelesen und möchte die KI-Begriffshilfe freiwillig nutzen." }))),
      actions: [{ label: "Abbrechen" }, { label: "Einwilligen und starten", class: "primary", onClick: () => {
        if (!box.checked) { toast("Bitte setze zuerst den Haken, wenn du " + (selbst ? them : "die KI-Begriffshilfe") + " nutzen möchtest.", "err"); return false; }
        store.set(KI_KEY, "1"); paintKi(); if (slv) slv.repaint();
        if (!selbst) setTimeout(() => { const i = document.getElementById("ki-q"); if (i) i.focus(); }, 60);
        // verzögert (der Dialog gibt den Fokus erst zurück): nur, wenn er nicht schon woanders steht
        // (er landet nach dem Schließen auf dem Ersatz des Knopfs in derselben Karte – dann ins Eingabefeld, sonst nie umlenken)
        else setTimeout(() => {
          const i = after ? after() : document.getElementById("ki-q"), a = document.activeElement, zone = i && i.closest(".slv-station, .kihelp");
          if (i && i.isConnected && (!a || a === document.body || a === opener || !a.isConnected || (zone && zone.contains(a)))) i.focus();
        }, 60);
      } }] });
  }
  paintKi();
  // Material erscheint mit seiner Materialfolie (Nachtrag 44): Das Durable Object schickt nach einer gezeigten Materialfolie bzw. einer Freigabe von Hand den
  // Stand mit revealAt (nur ein Zeitpunkt). Ist er neuer als der Stand der Daten, lädt die Seite die Daten neu – ohne Neuladen der Seite (revealWatch in
  // public/reveal.js: zufällig bis zu 2 s später; scheitert das Neuladen, weitere Versuche)
  let gone = false;
  const rw = revealWatch({ seen: d.revealAt, reload: () => refresh() });
  onLeave(() => { gone = true; rw.stop(); });
  if (selbst) {
    // Ablaufplan der Selbstlern-Phase; die Hausaufgabe gleich darunter (von Anfang an sichtbar)
    main.classList.add("slv-room");
    slv = SV.selbstlernView({ lessonId, d, sapi, now: () => Date.now() + offset, onLeave, consent: kiConsent, fileRow, sheetRow });
    main.append(...slv.sections, hwBox);
  } else if (d.selbstlern) main.append(presRow, kiBox, hwBox);   // Selbstlern-Phase in Jg. 5/6 (auf Papier): kein Live-Fenster – die Lehrkraft ist nicht da
  else startLive();

  // 1) Live-Fenster ganz oben (nicht in einer Selbstlern-Phase: die Lehrkraft ist nicht da)
  function startLive() {
    const img = h("img", { alt: "Aktuelle Folie der Lehrkraft", draggable: "false" });
    const ph = h("div", { class: "placeholder" }, h("div", { class: "big", text: "Noch keine Live-Präsentation" }), h("div", { text: "Sobald deine Lehrkraft die Präsentation startet, erscheint sie hier automatisch." }));
    const status = h("div", { class: "status" });
    const fsBtn = h("button", { class: "btn small fs", type: "button", "aria-label": "Live-Fenster vergrößern" }, icon("expand"), "Groß");
    const live = h("section", { class: "live idle", "aria-label": "Live-Präsentation" }, ph, status, fsBtn);
    // Timer der Lehrkraft (Nachtrag 16): oben über der Folie, die Folie darunter eingepasst
    const tband = timerBand({ host: live, onStale: () => poll() });   // nach einem Ruhezustand den Stand neu holen
    live.append(tband.el, tband.say);
    live.addEventListener("contextmenu", (e) => e.preventDefault());
    // Vollbild bzw. Ebene über der Seite (ohne Vollbild-Schnittstelle): Tab bleibt im Live-Fenster, Esc beendet die Ebene (Vollbild: der Browser)
    let liveLayer = null;
    const syncLiveLayer = () => {
      const on = (document.fullscreenElement || document.webkitFullscreenElement) === live || live.classList.contains("max");
      if (on && !liveLayer) liveLayer = openLayer(live, { opener: fsBtn, onEscape: () => { if (live.classList.contains("max")) setMax(false); } });
      else if (!on && liveLayer) { liveLayer.release(false); liveLayer = null; }
    };
    const setMax = (on) => { live.classList.toggle("max", on); syncLiveLayer(); };
    fsBtn.addEventListener("click", () => {
      const fs = live.requestFullscreen || live.webkitRequestFullscreen;
      if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else if (fs) Promise.resolve(fs.call(live)).catch(() => setMax(!live.classList.contains("max")));
      else setMax(!live.classList.contains("max"));
    });
    document.addEventListener("fullscreenchange", syncLiveLayer);
    document.addEventListener("webkitfullscreenchange", syncLiveLayer);
    onLeave(holdReload(() => !live.classList.contains("idle")));   // nach einem Update nie mitten in der Live-Präsentation neu laden (update.js)
    onLeave(() => {
      document.removeEventListener("fullscreenchange", syncLiveLayer); document.removeEventListener("webkitfullscreenchange", syncLiveLayer);
      live.classList.remove("max"); if (liveLayer) { liveLayer.release(false); liveLayer = null; }
    });
    main.append(live, presRow, kiBox, hwBox);
    let lastV = -1, seq = 0, codeEl = null;
    const dropCode = () => { if (codeEl) { codeEl.remove(); codeEl = null; } };
    function showState(st) {
      if (!st || typeof st !== "object") return;
      tband.set(st.active ? st.timer : null);   // vor der Prüfung von v: der Timer ändert v nicht, jede Nachricht gleicht die Restzeit neu ab
      rw.want(st.revealAt);   // ebenso: Material freigegeben (Nachtrag 44) – neuer Stand → die Daten bald neu laden
      if (st.v !== undefined && st.v === lastV && st.active) return;
      lastV = st.v;
      const my = ++seq;   // ein spät geladenes Folienbild überschreibt nie einen neueren Stand
      clear(status);
      // Codefolie (Sitzungscode + QR-Code): beim Start vor Folie 1, an Platzhalterfolien und über „Sitzungscode zeigen“ der Lehrkraft
      const isCode = !!(st.active && st.view === "code" && st.code);
      live.classList.toggle("idle", !(st.active && (st.url || isCode)));
      // ohne Präsentation gibt es im Live-Fenster keinen Knopf mehr: die Ebene über der Seite nicht stehen lassen
      if (live.classList.contains("idle") && live.classList.contains("max")) setMax(false);
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
    let ws = null, closed = false, fails = 0, pollT = null, pingT = null, reT = null, got = 0;
    // brachte der WebSocket während der Abfrage eine Nachricht, ist ihre Antwort überholt (sonst höbe sie z. B. eine eben gesetzte Pause des Timers wieder auf)
    const poll = async () => { const n = got; try { const r = await sapi("GET", "/api/student/lessons/" + lessonId + "/live"); if (n === got) showState(r.live); } catch {} };
    async function connect() {
      if (closed) return;
      try {
        const t = await sapi("POST", "/api/student/lessons/" + lessonId + "/live-ticket");
        ws = new WebSocket(wsUrl(t.url));
        ws.onopen = () => { fails = 0; clearInterval(pollT); pollT = null; clearInterval(pingT); pingT = setInterval(() => { try { ws.send("ping"); } catch {} }, 25000); };
        ws.onmessage = (ev) => { if (ev.data === "pong") return; got++; try { showState(JSON.parse(ev.data)); } catch {} };
        ws.onclose = () => { clearInterval(pingT); if (closed) return; fails++; if (fails >= 2 && !pollT) { poll(); pollT = setInterval(poll, 2000); } reT = setTimeout(connect, Math.min(15000, 1000 * 2 ** Math.min(fails, 4))); };
      } catch { fails++; if (!pollT) { poll(); pollT = setInterval(poll, 2000); } reT = setTimeout(connect, 5000); }
    }
    connect();
    const onVis = () => { if (document.visibilityState === "visible") { poll(); if (!ws || ws.readyState > 1) { clearTimeout(reT); connect(); } } };
    document.addEventListener("visibilitychange", onVis);
    onLeave(() => { closed = true; tband.stop(); clearInterval(pollT); clearInterval(pingT); clearTimeout(reT); document.removeEventListener("visibilitychange", onVis); try { ws && ws.close(); } catch {} });
  }

  // Präsentation nach der Sitzung: erst 5 Minuten nach dem Ende; ist die letzte gezeigte Folie markiert, nur bis dorthin. Statt eines Knopfs
  // ein Folienfenster (Nachtrag 19) mit „Diese Präsentation herunterladen“ darunter; beim Neuladen der Daten bleibt es stehen, solange es
  // dieselbe Präsentation ist (gewählte Folie, Fokus und Vollbild bleiben; eine geänderte Markierung übernimmt es selbst)
  let pres = d.presentation, viewer = null, viewerKey = "", viewerPres = "";
  const dropViewer = () => { if (viewer) { viewer.destroy(); viewer = null; viewerKey = ""; viewerPres = ""; } };
  onLeave(dropViewer);
  const renderPres = () => {
    const unlocked = !!pres && pres.unlockAt !== null && Date.now() + offset >= pres.unlockAt;
    const ident = unlocked ? [pres.name, pres.pages].join("|") : "", key = unlocked ? ident + "|" + (pres.upTo || 0) : "";
    if (viewer && viewer.el.isConnected && key === viewerKey) return;
    if (viewer && viewer.el.isConnected && unlocked && ident === viewerPres) { viewer.update({ total: pres.upTo || pres.pages, cut: !!pres.upTo }); viewerKey = key; return; }
    const hadFocus = !!viewer && viewer.el.contains(document.activeElement);
    dropViewer(); clear(presRow);
    if (!pres) return;
    if (unlocked) {
      viewer = slideViewer({ total: pres.upTo || pres.pages, cut: !!pres.upTo, now: () => Date.now() + offset, onStale: () => refresh(),
        fetchSlides: async (from, to) => {
          const r = await sapi("POST", "/api/student/lessons/" + lessonId + "/presentation-slides", { body: { from, to } });
          return { ...r, slides: (r.slides || []).map((x) => ({ ...x, url: apiUrl(x.url) })) };
        },
        download: async () => { const r = await sapi("POST", "/api/student/lessons/" + lessonId + "/presentation-link", { body: { inline: false } }); downloadUrl(r.url, ""); } });
      viewerKey = key; viewerPres = ident;
      presRow.append(viewer.el);
      // andere Präsentation, während der Fokus im alten Fenster war: nicht auf der Seite verlieren
      if (hadFocus && (!document.activeElement || document.activeElement === document.body)) viewer.focus();
    } else if (pres.unlockAt === null) {
      presRow.append(h("span", { class: "muted small", text: "Die Präsentation kannst du nach dem Unterricht selbst öffnen." }));
    } else {
      const day = fmtDayBerlin(pres.unlockAt) === fmtDayBerlin(Date.now() + offset) ? "" : fmtDayBerlin(pres.unlockAt) + ", ";
      presRow.append(h("span", { class: "muted small", text: "Die Präsentation kannst du ab " + day + fmtClockBerlin(pres.unlockAt) + " Uhr selbst öffnen (5 Minuten nach dem Unterricht)." }));
    }
  };
  // Hausaufgabe erscheint bzw. Präsentation wird frei: zu diesen Zeitpunkten neu laden (auch nach dem Aufwachen des iPads)
  const pending = (d.changesAt || []).slice();
  // Reihenfolge der Antworten (Befund der Gegenprüfung): Die Antwort einer früher gestellten Anfrage, die nach einer späteren ankommt, wird nicht mehr
  // angewendet (latestOnly) – sonst verschwände eben erschienenes Material wieder
  const order = latestOnly();
  let loadedAt = Date.now();   // letzter Stand vom Server (für die Prüfung beim Aufwachen, Nachtrag 44 Teil 2)
  // Nachtrag 44 (Teil 2, Gegenprüfung): beginnt eine spätere Sitzung des Kurses heute in höchstens 30 Minuten (newerSoon), fragt die sichtbare Seite jede
  // Minute, ob sie schon live gezeigt wird – startet die Lehrkraft früher, erscheint der Hinweis auch bei offener Seite (sonst erst zum geplanten Beginn)
  let soon = d.newerSoon === true, gone = false;   // gone: Sitzung verlassen – eine Antwort, die erst danach kommt, plant nichts mehr ein
  const refresh = async () => {
    const my = order.start();
    try {
      const r = await sapi("GET", "/api/student/lessons/" + lessonId);
      if (gone || !order.take(my)) return;
      // Selbstlern-Phase inzwischen eingerichtet bzw. wiederhergestellt: die Seite neu aufbauen
      const kind = (x) => (x.selbstlern ? (x.selbstlern.analog ? "a" : "d") : "n");
      if (kind(r) !== kind(d)) { if (location.hash === "#/schueler/s/" + lessonId) route(); return; }
      loadedAt = Date.now(); newerBox.set(r.newer); soon = r.newerSoon === true;   // Nachtrag 44 (Teil 2)
      termsView.update(r.terms);   // Fachbegriffe (Nachtrag 44): erscheinen 2 Minuten vor dem Ende – dieselben bleiben stehen
      pres = r.presentation; renderPres(); paintHomework(r.homework); aiHelp = r.aiHelp; paintKi(); if (slv) slv.update(r); pending.splice(0, pending.length, ...(r.changesAt || [])); plan();
      // Material (Nachtrag 44): neu Freigegebenes erscheint ohne Neuladen der Seite (unveränderte Zeilen bleiben stehen – samt Fokus und aufgeklapptem Text)
      rw.seen(r.revealAt);
      paintMats(r);
    } catch {
      // gescheitert (z. B. kurz kein Netz), während die spätere Sitzung bald beginnt: in einer Minute noch einmal (sonst wie bisher erst beim Aufwachen)
      if (soon && !gone) { clearTimeout(chT); chT = setTimeout(refresh, NEWER_RECHECK_MS); }
    }
    finally { rw.after(); }   // fehlt noch ein freigegebener Stand: später noch einmal
  };
  let chT = null;
  const plan = () => {
    clearTimeout(chT);
    const poll = soon && document.visibilityState === "visible" ? loadedAt + offset + NEWER_RECHECK_MS : Infinity;   // nur bei sichtbarer Seite
    const next = Math.min(...pending, poll);
    if (Number.isFinite(next)) chT = setTimeout(refresh, Math.max(1000, Math.min(next - (Date.now() + offset) + 1500, 6 * 3600e3)));
  };
  plan();
  // wieder sichtbar: fällige Zeitpunkte, freigegebenes Material, dessen Neuladen bisher nicht geklappt hat (Nachtrag 44, Teil 1), und höchstens einmal je
  // Minute ein neuer Blick, ob eine spätere Sitzung inzwischen live gezeigt wird (Nachtrag 44, Teil 2)
  const onVisCh = () => {
    if (document.visibilityState !== "visible") return;
    if (rw.visible() || pending.some((t) => Date.now() + offset >= t) || Date.now() - loadedAt >= NEWER_RECHECK_MS) refresh(); else if (soon) plan();
  };
  document.addEventListener("visibilitychange", onVisCh);
  onLeave(() => { gone = true; clearTimeout(chT); document.removeEventListener("visibilitychange", onVisCh); });
  renderPres();

  // 2) Materialien und Feibeitsblätter – beim Neuladen der Daten neu gezeichnet (Nachtrag 44: Material mit eigener Materialfolie kommt erst mit seiner Folie;
  // die Seite zeigt nur, was der Server liefert). Zeilen, die gleich bleiben, bleiben stehen (Fokus, aufgeklappter Text); neu Erschienenes wird markiert
  // („neu“) und in einer höflichen Live-Region angesagt – der Fokus bleibt, wo er ist.
  const matList = h("div", { class: "list" }), matLive = h("p", { class: "sr-only", role: "status", "aria-live": "polite", id: "mat-live" });
  const goodHint = h("p", { class: "hint", text: "Tipp fürs iPad: Nach dem Herunterladen über „Teilen“ → „GoodNotes“ öffnen und dort bearbeiten." });
  const matCard = h("section", { class: "card", "aria-labelledby": "mat-h" }, h("h2", { id: "mat-h", text: selbst ? "Weiteres Material" : "Material" }), matList, matLive);
  // 3) Notfall-Feibeitsblätter (das analoge Arbeitsblatt zu jedem Feibeitsblatt): eigenes Kästchen weiter unten, nur für technische Probleme.
  // Zugeklappt (Wunsch der Lehrkraft vom 13.11.2026): beim Laden immer zu, nichts gemerkt – erst aufgeklappt erscheinen der rote Hinweis
  // und die PDF-Dateien, damit die Schüler:innen zuerst das Material öffnen und nicht versehentlich ein Notfall-Feibeitsblatt (beim Neuladen der Daten bleibt es, wie es ist)
  const nfList = h("div", { class: "list" });
  const nfCard = h("section", { class: "card notfallbox", "aria-labelledby": "nf-h" },
    h("details", { class: "nfdetails" },
      h("summary", null, h("h2", { id: "nf-h", text: NOTFALL_TITLE })),
      h("div", { class: "nfbody" },
        h("p", { class: "alarm", role: "note" }, icon("alert"), h("span", null, h("strong", { text: "Achtung! " }), NOTFALL_NOTE)),
        nfList)));
  const matAnchor = document.createComment("material");   // hier stehen die beiden Karten (ein Kommentar zählt nicht als Teil der Seite)
  main.append(matAnchor);
  let rowOf = new Map(), shownKeys = null, freshRows = [];
  // eine Liste neu ordnen: vorhandene Zeilen wiederverwenden; unverändert → nichts anfassen; der Fokus bleibt in einer Zeile, die bleibt
  const fill = (list, entries, fresh) => {
    const next = new Map(), kids = [];
    for (const e of entries) {
      let row = rowOf.get(e.k);
      if (!row) {
        row = e.make();
        if (shownKeys && !shownKeys.has(e.k) && fresh) { row.classList.add("fresh"); const m = row.querySelector(".main"); if (m) m.append(h("span", { class: "badge neu", text: "neu" })); fresh.push({ name: e.name, row }); }
      }
      next.set(e.k, row); kids.push(row);
      const extra = row._after ? row._after() : null;   // aufgeklappter Text eines Textmaterials gehört hinter seine Zeile
      if (extra) kids.push(extra);
    }
    // nur einfügen bzw. entfernen, was sich geändert hat – bleibende Zeilen werden nicht bewegt (sonst verlören sie den Fokus)
    const a = document.activeElement, keep = a && list.contains(a) ? a : null;
    let ref = list.firstChild;
    for (const k of kids) { if (k === ref) { ref = ref.nextSibling; continue; } list.insertBefore(k, ref); }
    while (ref) { const n = ref.nextSibling; ref.remove(); ref = n; }
    if (keep && keep.isConnected && document.activeElement !== keep) keep.focus({ preventScroll: true });
    return next;
  };
  function paintMats(data) {
    const sl = data.selbstlern;
    // Selbstlern-Phase: Material und Feibeitsblätter der Stationen stehen dort – hier nur das übrige („Weiteres Material“, nur wenn es welches gibt)
    const inStation = new Set(selbst && sl && Array.isArray(sl.stationen) ? sl.stationen.flatMap((x) => [x.fileId, x.code]).filter(Boolean) : []);
    const files = data.files || [], sheetsShown = (data.sheets || []).filter((s) => !inStation.has(s.code));
    const notfallFiles = files.filter((f) => f.notfall), matFiles = files.filter((f) => !f.notfall && !inStation.has(f.id));
    const fresh = [], keyOf = (p, x) => p + JSON.stringify(x);
    const rows = fill(matList, [...sheetsShown.map((s) => ({ k: keyOf("s", s), name: s.title, make: () => sheetRow(s) })), ...matFiles.map((f) => ({ k: keyOf("f", f), name: f.name, make: () => fileRow(f) }))], fresh);
    const nfRows = fill(nfList, notfallFiles.map((f) => ({ k: keyOf("n", f), name: f.name, make: () => fileRow(f) })), null);
    rowOf = new Map([...rows, ...nfRows]);
    shownKeys = new Set(rowOf.keys());
    const empty = matCard.querySelector(".mat-empty");
    if (!sheetsShown.length && !matFiles.length && !sl) { if (!empty) matList.after(h("p", { class: "muted mat-empty", text: "Deine Lehrkraft hat für diese Sitzung noch kein Material freigegeben." })); }
    else if (empty) empty.remove();
    const goodNotes = (selbst ? files.filter((f) => !f.notfall) : matFiles).some((f) => f.kind !== "link");
    if (goodNotes && !goodHint.isConnected) matLive.before(goodHint); else if (!goodNotes) goodHint.remove();
    // die Karten an ihrem Platz (hinter dem Kommentar): Material (Selbstlern-Phase nur mit weiterem Material), dann die Notfall-Feibeitsblätter
    const want = [!sl || sheetsShown.length || matFiles.length ? matCard : null, notfallFiles.length ? nfCard : null].filter(Boolean);
    for (const el of [matCard, nfCard]) if (!want.includes(el) && el.isConnected) el.remove();
    let at = matAnchor;
    for (const el of want) { if (at.nextSibling !== el) at.after(el); at = el; }
    if (fresh.length) {
      // „neu“ ist nur das zuletzt Erschienene: frühere Markierungen verschwinden, sobald wieder etwas dazukommt (Befund der Gegenprüfung)
      for (const row of freshRows) if (!fresh.some((x) => x.row === row)) { row.classList.remove("fresh"); const b = row.querySelector(".badge.neu"); if (b) b.remove(); }
      freshRows = fresh.map((x) => x.row);
      matLive.textContent = "Neues Material: " + fresh.map((x) => "„" + x.name + "“").join(", ") + ".";
    }
  }
  paintMats(d);
  // Fachbegriffe dieser Sitzung (Nachtrag 44, Teil 3): ganz unten – in der Selbstlern-Phase über der KI-Begriffshilfe, die dort ganz unten bleibt
  main.append(termsView.el);
  // Selbstlern-Phase: die KI-Begriffshilfe ganz unten (Wortlaut der Lehrkraft)
  if (selbst) main.append(kiBox);
}
/* Zeile einer Datei im Material (auch für die Stationen der Selbstlern-Phase): Link öffnen, Text lesen bzw. als PDF, Datei herunterladen */
function materialRow(f, d) {
  const acts = h("div", { class: "acts" });
  const meta = f.kind === "link" ? "Link · " + webUrlLabel(f.url) : f.kind === "text" ? "Text · als PDF herunterladen" : fmtBytes(f.size);
  const row = h("div", { class: "item" }, fileIcon(f.name, f.mime, f.kind), h("div", { class: "main" }, h("div", { class: "name", text: f.name }), h("div", { class: "meta", text: meta })), acts);
  if (f.kind === "link") {
    if (f.url) acts.append(h("a", { class: "btn primary small", href: f.url, target: "_blank", rel: "noopener noreferrer" }, "Öffnen", h("span", { class: "sr-only", text: " (öffnet in neuem Tab)" })));
  } else if (f.kind === "text") {
    let shown = null;
    row._after = () => shown;   // aufgeklappter Text bleibt beim Neuzeichnen der Liste hinter seiner Zeile (Nachtrag 44)
    acts.append(h("button", { class: "btn small", type: "button", onclick: () => { if (shown) { shown.remove(); shown = null; } else { shown = h("div", { class: "card", style: { marginTop: ".4rem" } }, renderMarkdown(f.text)); row.after(shown); } } }, "Lesen"),
      h("button", { class: "btn primary small", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try { const { markdownToPdf, pdfName } = await lazy(import("./pdfmaker.js")); downloadBlob(await markdownToPdf(f.name, f.text, { subtitle: d.lesson.subjectName + " · " + d.lesson.klass }), pdfName(f.name)); }
        catch (err) { errToast(err); }
      }, "Erzeuge PDF …") }, "Als PDF herunterladen"));
  } else {
    acts.append(h("button", { class: "btn primary small", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
      try { const r = await sapi("POST", "/api/student/files/" + f.id + "/link"); downloadUrl(r.url, f.name); } catch (err) { errToast(err); }
    }, "Lade …") }, "Herunterladen"));
  }
  return row;
}
/* Zeile eines Feibeitsblatts: Code kopieren und Feibeitsblatt öffnen (auch für die Stationen der Selbstlern-Phase). Aus einer früheren Sitzung des Kurses
   wieder gebraucht (again, Nachtrag 45): mit dem Zwischenstand weiterarbeiten – PDF wählen, „Im Feibeitsblatt weiterarbeiten“, klein „Von vorn beginnen“ */
function sheetItem(s, url) {
  if (s.again) return fbAgainItem(s, url, { leave: onLeave });
  return h("div", { class: "item" }, h("div", { class: "ficon fb", "aria-hidden": "true", text: "FB" }),
    h("div", { class: "main" }, h("div", { class: "name", text: s.title }), h("div", { class: "meta" }, "Feibeitsblatt · Code ", h("span", { class: "mono", style: { fontWeight: 800, fontSize: "1.05rem", letterSpacing: ".08em" }, text: formatCode(s.code) }))),
    h("div", { class: "acts" }, h("button", { class: "btn primary small", type: "button", onclick: async () => {
      const ok = await copyText(formatCode(s.code));
      window.open(url, "_blank", "noopener");
      toast(ok ? "Code " + formatCode(s.code) + " kopiert – füge ihn im Feibeitsblatt ein." : "Bitte den Code " + formatCode(s.code) + " im Feibeitsblatt eintippen.", "ok", 6000);
    } }, "Code kopieren und Feibeitsblatt öffnen")));
}
export const NOTFALL_TITLE = "Notfall-Feibeitsblätter (nur bei technischen Problemen)";
// Wortlaut der Lehrkraft (Komma vor „soll“ entfernt)
export const NOTFALL_NOTE = "Eigentlich sollst du mit den digitalen Feibeitsblättern arbeiten, die du in dieser Sitzung aufrufen kannst. Die hier verfügbaren PDF-Dateien sind nur für diejenigen Schülerinnen und Schüler gedacht, " +
  "die technische Probleme beim Aufrufen von Feibeitsblättern haben. Nur in diesen Ausnahmefällen soll mit einem Notfall-Feibeitsblatt gearbeitet werden.";

/* ---------- Router ---------- */
// Ließ sich ein Programmteil nicht laden (z. B. nach einem Update von Unterricks), zeigt die Seite einen ruhigen Hinweis mit „Neu laden“ (update.js);
// andere Fehler wie bisher mit der Meldung
const failed = (what) => (e) => (isModuleError(e) ? pageFailed(e, render) : render(h("main", null, h("p", { class: "err", text: what + " konnte nicht geladen werden: " + e.message }))));
const ROUTES = [
  [/^#?\/?$/, () => studentStart()],
  [/^#\/schueler$/, () => studentHome()],
  [/^#\/schueler\/s\/([a-f0-9]{16})$/, (m) => studentRoom(m[1])],
  [/^#\/schueler\/escape\/([a-f0-9]{16})$/, (m) => lazy(import("./escape.js")).then((x) => x.escapePage(m[1])).catch(failed("Der Escape-Room"))],
  // Elternansicht (Grundschule): geheimer Link der Lehrkraft, ohne Anmeldung; lädt keine Module der Lehrkraft
  [/^#\/eltern\/([A-Za-z0-9_-]{32})(?:\/(s|pdf)\/([a-f0-9]{16})(?:\/([a-f0-9]{16}))?)?$/, (m) => lazy(import("./parents.js")).then((p) => p.parentsPage(m[1], m[2] || null, m[3] || null, m[4] || null)).catch(failed("Die Elternansicht"))],
  [/^#\/eltern(?:\/.*)?$/, () => lazy(import("./parents.js")).then((p) => p.parentsPage("", null, null, null)).catch((e) => (isModuleError(e) ? pageFailed(e, render) : go("#/")))],   // beschädigter Link: Meldung des Servers
  [/^#\/beamer$/, () => lazy(import("./beamer.js")).then((b) => b.beamerPage()).catch(failed("Das Beamerfenster"))],
  [/^#\/(lehrkraft|lk)(\/.*)?$/, () => lazy(import("./teacher.js")).then((t) => t.route(location.hash)).catch(failed("Die Lehrkräfteansicht"))],
];
// Nach einem Update von Unterricks (S24): Beim Seitenwechsel fragt update.js höchstens alle 15 Sekunden nach dem aktuellen Stand. Dafür verlässt die
// Seite die bisherige sofort (sie speichert dabei wie bei jedem Seitenwechsel); gibt es einen neuen Stand und ist der Moment sicher, lädt sie an der
// neuen Adresse neu, statt Programmteile des alten Stands nachzuladen – sonst geht es wie bisher weiter.
let routeSeq = 0, routed = false;
export function route() {
  const seq = ++routeSeq;
  if (routed && navCheckDue()) {
    const pre = navBlockers();   // offener Dialog, laufende Präsentation …: noch auf der bisherigen Seite feststellen
    render(waitPage());
    beforeRoute(pre).then((reloading) => { if (!reloading && seq === routeSeq) dispatch(); }, () => { if (seq === routeSeq) dispatch(); });
    return;
  }
  routed = true;
  dispatch();
}
function dispatch() {
  const hash = location.hash || "#/";
  for (const [re, fn] of ROUTES) { const m = re.exec(hash); if (m) return fn(m); }
  go("#/");
}
window.addEventListener("hashchange", route);
installUpdateChecks();
checkAuth();   // gespeicherte Frist der Anmeldung (auch nach dem Neuladen)
// beim Abmelden gesicherte Escape-Room-Stände (mit Namen) nicht länger als einen Tag auf dem Gerät lassen
try { for (const k of Object.keys(localStorage)) if (k.startsWith("u.esc.")) { let at = 0; try { at = Number(JSON.parse(localStorage.getItem(k)).at); } catch {} if (!(Date.now() - at < 24 * 3600e3)) localStorage.removeItem(k); } } catch {}
// abgehakte Stationen einer Selbstlern-Phase (nur Kennungen der Stationen, nichts Persönliches) nach 60 Tagen entfernen
try { for (const k of Object.keys(localStorage)) if (k.startsWith("u.sl.")) { let at = 0; try { at = Number(JSON.parse(localStorage.getItem(k)).at); } catch {} if (!(Date.now() - at < 60 * 864e5)) localStorage.removeItem(k); } } catch {}
route();
export { ApiError, $ };
