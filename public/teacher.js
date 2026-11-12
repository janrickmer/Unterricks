// teacher.js – Lehrkräfteansicht: Anmeldung/Einrichtung, Fach- und Klassenauswahl, Sitzungslisten, Einstellungen.
import { h, clear, store, deviceId, api, apiUrl, toast, errToast, busy, modal, confirmDialog, copyText, fmtDate, fmtTime, topbar, nn, pageHead, setFach, icon, downloadBlob, fmtBytes, stateLine } from "./ui.js";
import { render, go, onLeave } from "./app.js";
import { SUBJECTS, subjectName, gradeInfo, isValidClass, isValidSubject, formatCode, fmtDay, classGroupsFor, classAllowed, classShort, gradeKey, isAnalogClass, ANALOG_RULE,
  COURSE_GRADES, courseKey, isCourseClass, courseMembers } from "./shared.js";
import { missingFor } from "./bases-detect.js";
import { portalPreview } from "./portalview.js";
import { weekCard } from "./weekcal.js";
import { FbClient } from "./fbclient.js";
import { deriveLogin, rememberKey, recallKey, forgetKey, sealLink, openLink, linkData, sameApi } from "./fblink.js";

export const T = {
  get token() { return store.get("u.ttoken"); },
  set token(v) { if (v) store.set("u.ttoken", v); else store.del("u.ttoken"); },
  config: null, fb: null,
  wrapKey: null,              // Schlüssel für die gespeicherte Feibeitsblatt-Verbindung (aus dem Unterricks-Passwort, nur im Browser)
  fbLink: { state: "checking" },   // checking | none | saved | locked | invalid | error – siehe fbAutoConnect
};
export async function tapi(method, path, o = {}) {
  const tok = T.token;
  try { return await api(method, path, { ...o, token: tok }); }
  // 401 meldet nur ab, wenn die Anfrage mit der jetzigen Anmeldung lief – eine späte Antwort aus der Zeit vor dem Ab- und wieder
  // Anmelden (z. B. vom Nachholen der Notfall-Feibeitsblätter im Hintergrund) darf die neue Anmeldung nicht beenden
  catch (e) { if (e.status === 401 && path !== "/api/teacher/login" && T.token === tok) { T.token = null; toLogin(); } throw e; }
}
/* Zur Anmeldeseite – aber nie ein zweites Mal, wenn sie schon da ist: go() baut eine gleiche Adresse neu auf, und das leerte ein Formular,
   in das man schon tippt (z. B. Abmelden mit einem Token, das nach einem Passwortwechsel auf einem anderen Gerät schon ungültig ist). */
const toLogin = () => { if (location.hash !== "#/lehrkraft") go("#/lehrkraft"); };
export async function config() {
  if (!T.config) { try { T.config = await api("GET", "/api/config"); } catch { T.config = { feibeitsblattApi: "https://feibeitsblatt.feindt.workers.dev", feibeitsblattUrl: "https://feibeitsblatt.janrickmer.de/" }; } }
  if (!T.fb) T.fb = new FbClient(T.config.feibeitsblattApi);
  return T.config;
}

/* PBKDF2 im Browser (600 000 Iterationen): der Server sieht nie das Passwort – und nie den zweiten Teil der Ableitung (fblink.js) */
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function useWrapKey(key) { T.wrapKey = key; await rememberKey(key); }

/* ---------- Gespeicherte Feibeitsblatt-Verbindung (Ende-zu-Ende verschlüsselt, fblink.js) ----------
 * T.fbLink.state: checking = wird geprüft; none = nichts gespeichert; saved = gespeichert und auf diesem Gerät nutzbar;
 * locked = gespeichert, aber auf diesem Gerät fehlt der Schlüssel (einmal mit dem Unterricks-Passwort entsperren);
 * invalid = das Feibeitsblatt lehnt sie ab (Passwort dort geändert) bzw. sie gehört zu einem anderen Feibeitsblatt; error = gerade nicht erreichbar */
let fbAuto = null;
export function fbAutoConnect(force = false) {
  if (fbAuto && !force) return fbAuto;
  T.fbLink = { state: "checking" };
  fbAuto = (async () => {
    let r;
    try { r = await tapi("GET", "/api/teacher/fb-link"); } catch (e) { return (T.fbLink = { state: "error", msg: e.message }); }
    if (!r.link) return (T.fbLink = { state: "none" });
    const at = r.link.at || null, key = T.wrapKey || (await recallKey());
    let d = null;
    if (key) { try { d = await openLink(key, r.link); T.wrapKey = key; } catch {} }
    if (!d) return (T.fbLink = { state: "locked", at });
    if (!sameApi(d.api, T.config.feibeitsblattApi)) return (T.fbLink = { state: "invalid", at, other: true });
    if (!T.fb.connected) {
      try { await T.fb.connectMaster(d.master); }
      catch (e) { return (T.fbLink = e.status === 401 ? { state: "invalid", at } : { state: "error", msg: e.message, at }); }
      finally { d.master.fill(0); }
    }
    return (T.fbLink = { state: "saved", at });
  })();
  return fbAuto;
}
/* Mit dem Unterricks-Passwort bestätigen (erneute Anmeldung auf diesem Gerät: prüft das Passwort mit denselben Sperren wie die
   Anmeldung und legt den Schlüssel für die gespeicherte Verbindung ab) */
export async function fbUnlock(password) {
  const me = await tapi("GET", "/api/teacher/me");
  const s = await api("POST", "/api/teacher/salt", { body: { username: me.username } });
  const d = await deriveLogin(password, s.salt, s.iterations);
  const r = await api("POST", "/api/teacher/login", { body: { username: me.username, authKey: d.authKey, deviceId: deviceId() } });
  const old = T.token; T.token = r.token;
  if (old && old !== r.token) api("POST", "/api/teacher/logout", { token: old }).catch(() => {});
  await useWrapKey(d.wrapKey);
  return d.wrapKey;
}
/* Verbindung speichern (nach dem Verbinden): askPassword() fragt das Unterricks-Passwort ab, falls dieses Gerät den Schlüssel noch nicht hat */
export async function fbStore(askPassword) {
  if (!T.fb.connected || !T.fb.master) throw new Error("Bitte zuerst mit Feibeitsblatt verbinden.");
  const key = T.wrapKey || (await recallKey()) || (await askPassword());
  if (!key) return false;
  const r = await tapi("PUT", "/api/teacher/fb-link", { body: { link: await sealLink(key, linkData(T.config.feibeitsblattApi, T.fb.master)) } });
  T.wrapKey = key; T.fbLink = { state: "saved", at: r.at }; fbAuto = Promise.resolve(T.fbLink);
  return true;
}
/* Gespeicherte Verbindung löschen (auf allen Geräten) und hier trennen */
export async function fbForget() {
  await tapi("DELETE", "/api/teacher/fb-link");
  T.fb.disconnect(); T.fbLink = { state: "none" }; fbAuto = Promise.resolve(T.fbLink);
}
/* Dialog: Unterricks-Passwort abfragen → Schlüssel (oder null bei Abbruch) */
export function askTeacherPassword(text) {
  return new Promise((resolve) => {
    let done = false;
    const pw = h("input", { id: "fbu-pw", type: "password", autocomplete: "current-password" }), msg = h("p", { class: "err", role: "alert" });
    modal({ title: "Mit Ihrem Unterricks-Passwort bestätigen", onClose: () => { if (!done) resolve(null); },
      body: (el) => el.append(h("p", { class: "small", text }), h("div", { class: "field" }, h("label", { for: "fbu-pw" }, "Unterricks-Passwort"), pw), msg),
      actions: [{ label: "Abbrechen", onClick: () => { done = true; resolve(null); } },
        { label: "Bestätigen", class: "primary", onClick: async (e) => {
          msg.textContent = "";
          const btn = e.currentTarget; btn.disabled = true;
          try { const key = await fbUnlock(pw.value); done = true; resolve(key); }
          catch (err) { msg.textContent = err.message; btn.disabled = false; return false; }
        } }] });
  });
}

/* ---------- Notfall-Feibeitsblätter für bestehende Sitzungen nachholen ----------
 * Sitzungen, deren Feibeitsblätter verknüpft wurden, bevor es Notfall-Feibeitsblätter gab (oder ohne Verbindung zum Feibeitsblatt),
 * bekommen ihr Notfall-Feibeitsblatt im Hintergrund – einmal je Seitenaufruf, sobald die Verbindung zum Feibeitsblatt besteht. Erzeugt
 * wird es im Browser der Lehrkraft (das Blatt ist nur mit ihrer Feibeitsblatt-Anmeldung lesbar): je Blatt einmal, hochgeladen in jede
 * Sitzung, die es noch nicht hat. „Alle prüfen und aktualisieren“ (Einstellungen) erneuert auch veraltete, z. B. nach dem Bestätigen der
 * Checkliste (dann mit QR-Code). Nie für das Finale eines Escape-Rooms und nie in den analogen Jahrgängen 5 und 6 (Server). */
export const NF = { state: "idle", all: false, count: 0, missing: 0, total: 0, done: 0, made: 0, failed: [], step: "", msg: "" };
const nfListeners = new Set();
export function onNotfallProgress(fn) { nfListeners.add(fn); return () => nfListeners.delete(fn); }
const nfPaint = () => { for (const fn of [...nfListeners]) { try { fn(NF); } catch {} } };
let nfJob = null, nfRun = 0;
const nfWord = (n) => n + (n === 1 ? " Notfall-Feibeitsblatt" : " Notfall-Feibeitsblätter");
const nfVerb = (n, one, many) => (n === 1 ? one : many);
/* „2 Notfall-Feibeitsblätter ließen sich nicht erstellen“ / „1 … ließ sich nicht aktualisieren – das bisherige bleibt im Material“ */
function nfFailText(failed) {
  const miss = failed.filter((x) => !x.had).length, upd = failed.length - miss, parts = [];
  if (miss) parts.push(nfWord(miss) + " " + nfVerb(miss, "ließ", "ließen") + " sich nicht erstellen");
  if (upd) parts.push(nfWord(upd) + " " + nfVerb(upd, "ließ", "ließen") + " sich nicht aktualisieren – " + nfVerb(upd, "das bisherige bleibt", "die bisherigen bleiben") + " im Material");
  return parts.join("; ");
}
export function notfallBackfill(opt = {}) {
  const all = !!opt.all;
  if (nfJob && NF.state === "running") return nfJob;
  // schon gelaufen: nur auf Wunsch erneut (Knopf „Alle prüfen“) oder nach dem Verbinden, wenn es damals keine Verbindung gab bzw. etwas scheiterte
  if (nfJob && !all && (!opt.retry || (NF.state === "done" && !NF.failed.length))) return nfJob;
  const run = ++nfRun, live = () => run === nfRun && !!T.token;
  Object.assign(NF, { state: "running", all, count: 0, missing: 0, total: 0, done: 0, made: 0, failed: [], step: "Verknüpfte Feibeitsblätter werden gesucht …", msg: "" });
  nfPaint();
  const fail = (x, e) => NF.failed.push({ ...x, had: !!x.fileId, msg: (e && e.message) || String(e || "Bitte erneut versuchen.") });
  const stop = (state, msg = "") => { if (live()) { Object.assign(NF, { state, step: "", msg }); nfPaint(); } };
  nfJob = (async () => {
    const listAt = Date.now();
    let list;
    try { list = (await tapi("GET", "/api/teacher/notfall")).items || []; }
    catch (e) { return stop("error", e.message); }
    if (!live()) return;
    Object.assign(NF, { count: list.length, missing: list.filter((x) => !x.fileId).length });
    await config();
    // ausdrücklich gestartet und war Feibeitsblatt vorhin nicht erreichbar: erneut verbinden (sonst bliebe das alte Ergebnis)
    await fbAutoConnect((all || opt.retry) && !T.fb.connected && T.fbLink.state === "error");
    if (!live()) return;
    if (!T.fb.connected) return stop("noconn");
    const byCode = new Map();
    for (const x of list) if (all || !x.fileId) { if (!byCode.has(x.code)) byCode.set(x.code, []); byCode.get(x.code).push(x); }
    NF.total = [...byCode.values()].reduce((n, a) => n + a.length, 0); nfPaint();
    const N = byCode.size ? await import("./notfall.js") : null;
    for (const [code, items] of byCode) {
      if (!live()) return;
      if (!T.fb.connected) return stop("noconn");   // Verbindung unterwegs verloren: später erneut (nach dem Verbinden)
      NF.step = "Feibeitsblatt " + formatCode(code) + " wird geprüft …"; nfPaint();
      let info;
      try { info = await N.notfallInfo(T.fb, code); }
      catch (e) { if (!live()) return; for (const x of items) fail(x, e); NF.done += items.length; nfPaint(); continue; }
      if (!live()) return;
      if (info.escape) { NF.done += items.length; nfPaint(); continue; }   // Finale eines Escape-Rooms: kein Notfall-Feibeitsblatt
      const todo = items.filter((x) => !x.fileId || x.sig !== info.sig);
      NF.done += items.length - todo.length;
      let pdf = null, buildErr = null;   // je Blatt höchstens einmal erzeugen – auch wenn es scheitert (z. B. ein Bild fehlt)
      const make = async (x) => {
        if (buildErr) throw buildErr;
        if (!pdf) { try { pdf = await N.buildNotfallPdf(T.fb, code, info, T.config.feibeitsblattUrl); } catch (e) { buildErr = e; throw e; } }
        if (!live()) return {};
        return { file: (await N.uploadNotfall(x.lessonId, code, info.sig, pdf, T.token)).file };
      };
      for (const x of todo) {
        if (!live()) return;
        const rec = N.notfallRecent(x.lessonId, code, listAt);
        if (rec && rec.fbSig === info.sig) { NF.done++; nfPaint(); continue; }   // inzwischen von der Sitzungsseite erstellt
        NF.step = "„" + (x.title || "Feibeitsblatt") + "“ für „" + (x.lessonTitle || "Sitzung") + "“ …"; nfPaint();
        try {
          let res = await N.notfallOnce(x.lessonId, code, () => make(x));
          // auf die Sitzungsseite gewartet, die aber nichts hochgeladen hat (verlassen, gescheitert): selbst erzeugen
          if (res.joined && !res.file && live()) res = await N.notfallOnce(x.lessonId, code, () => make(x));
          if (!live()) return;
          if (res.file) { if (!res.joined) NF.made++; }
          else if (!res.escape) fail(x, null);
        } catch (e) {
          if (!live()) return;
          if (!(e && e.status === 404 && e.code === "not_found")) fail(x, e);   // inzwischen aus der Sitzung entfernt: nichts zu tun
        }
        NF.done++; nfPaint();
      }
    }
    if (!live()) return;
    Object.assign(NF, { state: "done", step: "" }); nfPaint();
    // Meldungen nur, wenn der Stand nicht ohnehin zu sehen ist (Einstellungen → Feibeitsblatt zeigt ihn selbst an)
    const quiet = nfListeners.size > 0;
    if (NF.made && !quiet) toast(nfWord(NF.made) + " für bestehende Sitzungen " + (all ? "aktualisiert" : "ergänzt") + " (im Material für Schüler:innen).", "ok");
    // Fehlschläge nur einmal je Gerät melden (ein im Feibeitsblatt gelöschtes Blatt schlüge sonst bei jedem Seitenaufruf an) – außer auf
    // ausdrücklichen Wunsch („Alle prüfen“); der Stand mit allen Einzelheiten steht immer unter Einstellungen → Feibeitsblatt
    const fkey = (x) => x.lessonId + "|" + x.code + "|" + x.msg;
    let seen = []; try { seen = JSON.parse(store.get("u.nfFails") || "[]"); } catch {}
    const fresh = NF.failed.filter((x) => !seen.includes(fkey(x)));
    store.set("u.nfFails", JSON.stringify(NF.failed.map(fkey).slice(0, 200)));
    if (fresh.length && !quiet) toast(nfFailText(NF.failed) + " – Einzelheiten unter Einstellungen → Feibeitsblatt.", "err");
  })().catch((e) => stop("error", e && e.message ? e.message : String(e)))
    .finally(() => { if (run === nfRun && NF.state === "running") { Object.assign(NF, { state: "idle", step: "" }); nfJob = null; nfPaint(); } });   // z. B. abgemeldet (401): beim nächsten Mal neu
  return nfJob;
}
/* Abmelden bzw. neu anmelden: ein laufendes Nachholen endet, beim nächsten Seitenaufruf beginnt es neu */
function nfReset() { nfRun++; nfJob = null; Object.assign(NF, { state: "idle", failed: [], step: "", msg: "" }); }

export function teacherBar(active) {
  const link = (href, label, key) => h("a", { href, "aria-current": active === key ? "page" : null, dataset: { nav: key } }, label);
  return topbar({ home: "#/lk" }, [link("#/lk", "Gymnasium", "lessons"), link("#/lk/grundschule", "Grundschule", "primary"), link("#/lk/grundlagen", "Planungsgrundlagen", "bases"),
    link("#/lk/einstellungen", "Einstellungen", "settings"), h("button", { type: "button", onclick: logout }, "Abmelden")]);
}
/* Menüpunkt nachträglich markieren (z. B. Einheiten und Sitzungen der Grundschule: erst nach dem Laden steht fest, wohin sie gehören) */
export function markNav(key) {
  for (const a of document.querySelectorAll(".topbar nav a[data-nav]")) { if (a.dataset.nav === key) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); }
}
/* Die Anmeldung endet zuerst hier, die Abmeldung beim Server läuft ohne tapi (ihre 401 bei einem schon ungültigen Token führt nicht
   vorzeitig zur Anmeldeseite) und am Ende geht es nur einmal dorthin (toLogin). */
async function logout() {
  const tok = T.token;
  T.token = null;
  try { if (tok) await api("POST", "/api/teacher/logout", { token: tok }); } catch {}
  if (T.fb) T.fb.disconnect();
  T.wrapKey = null; T.fbLink = { state: "checking" }; fbAuto = null; await forgetKey();   // dieses Gerät vergisst den Schlüssel
  nfReset();   // ein laufendes Nachholen endet
  import("./designrender.js").then((m) => m.resetPrintQueue()).catch(() => {});   // ebenso das Drucken gestalteter Materialien
  toLogin();
}

/* ---------- Anmeldung / Einrichtung ---------- */
let loginShown = null;   // die gerade angezeigte Anmeldeseite
async function loginPage() {
  // schon zu sehen (ohne Anmeldung): nicht neu aufbauen – sonst wäre Getipptes weg, egal wer den zweiten Aufruf auslöst
  if (!T.token && loginShown && loginShown.isConnected) return;
  if (T.token) { try { await tapi("GET", "/api/teacher/me"); return go("#/lk"); } catch {} }
  const wrap = h("div", { class: "login-wrap" });
  loginShown = wrap;
  render(wrap, h("footer", { class: "footer" }, h("a", { href: "#/" }, "Zur Schüleransicht")));
  let st;
  try { st = await api("POST", "/api/teacher/status"); } catch (e) { loginShown = null; wrap.append(h("p", { class: "err", text: e.message })); return; }   // ohne Formular: ein neuer Aufruf darf es erneut versuchen
  const user = h("input", { id: "tu", autocomplete: "username", autocapitalize: "off", spellcheck: "false", required: true });
  const pw = h("input", { id: "tp", type: "password", autocomplete: st.setup ? "current-password" : "new-password", required: true });
  const pw2 = h("input", { id: "tp2", type: "password", autocomplete: "new-password", required: true });
  const sc = h("input", { id: "tsc", autocomplete: "off" });
  const msg = h("p", { class: "err", role: "alert" });
  const btn = h("button", { class: "btn primary big", type: "submit" }, st.setup ? "Anmelden" : "Zugang einrichten");
  let lockT = null;
  const lock = (sec) => {
    clearInterval(lockT); btn.disabled = true; const end = Date.now() + sec * 1000;
    const tick = () => { const s = Math.ceil((end - Date.now()) / 1000); if (s <= 0) { clearInterval(lockT); btn.disabled = false; msg.textContent = ""; return; } msg.textContent = "Anmeldung auf diesem Gerät gesperrt – noch " + Math.ceil(s / 60) + " Minute(n)."; };
    tick(); lockT = setInterval(tick, 1000);
  };
  onLeave(() => clearInterval(lockT));
  const form = h("form", { class: "card login stack", onsubmit: async (e) => {
    e.preventDefault(); msg.textContent = "";
    await busy(btn, async () => {
      try {
        if (!st.setup) {
          if (pw.value.length < 10) throw new Error("Bitte ein Passwort mit mindestens 10 Zeichen wählen.");
          if (pw.value !== pw2.value) throw new Error("Die beiden Passwörter stimmen nicht überein.");
          const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
          const d = await deriveLogin(pw.value, salt, 600000);
          const r = await api("POST", "/api/teacher/setup", { body: { username: user.value, salt, iterations: 600000, authKey: d.authKey, deviceId: deviceId(), setupCode: sc.value || undefined } });
          T.token = r.token; await useWrapKey(d.wrapKey); fbAuto = null; nfReset(); toast("Ihr Lehrkraft-Zugang ist eingerichtet.", "ok"); go("#/lk");
        } else {
          const s = await api("POST", "/api/teacher/salt", { body: { username: user.value } });
          const d = await deriveLogin(pw.value, s.salt, s.iterations);
          const r = await api("POST", "/api/teacher/login", { body: { username: user.value, authKey: d.authKey, deviceId: deviceId() } });
          T.token = r.token; await useWrapKey(d.wrapKey); fbAuto = null; nfReset(); go("#/lk");
        }
      } catch (err) {
        if (err.status === 429 && err.data && err.data.retryAfter) { lock(err.data.retryAfter); msg.textContent = err.message; }
        else msg.textContent = err.message;
      }
    }, st.setup ? "Anmeldung läuft …" : "Richte ein …");
  } },
  h("div", { class: "logo" }, h("img", { src: "/icon.svg", alt: "" }), h("span", { text: "Lehrkräfte" })),
  st.setup ? null : h("div", { class: "notice" }, "Ersteinrichtung: Legen Sie jetzt einmalig Benutzername und Passwort für die Lehrkräfteansicht fest. Das Passwort wird nur in Ihrem Browser verarbeitet."),
  !st.setup && st.setupCodeRequired ? h("div", { class: "field" }, h("label", { for: "tsc" }, "Einrichtungscode"), sc, h("p", { class: "hint", text: "Der Code, der beim Betreiber als SETUP_CODE hinterlegt ist." })) : null,
  h("div", { class: "field" }, h("label", { for: "tu" }, "Benutzername"), user),
  h("div", { class: "field" }, h("label", { for: "tp" }, "Passwort"), pw),
  st.setup ? null : h("div", { class: "field" }, h("label", { for: "tp2" }, "Passwort wiederholen"), pw2),
  msg, btn,
  st.setup ? h("p", { class: "hint", text: "Nach zwei falschen Versuchen wird die Anmeldung auf diesem Gerät für 30 Minuten gesperrt. Geräte, auf denen Sie schon angemeldet waren, bleiben davon unberührt." }) : null);
  wrap.append(form);
  // nur, solange noch nichts anderes den Fokus hat: sonst landete schon Getipptes (z. B. im Passwortfeld) mitten im Wort im Benutzernamen
  setTimeout(() => { if (!wrap.contains(document.activeElement)) user.focus(); }, 50);
}

/* ---------- Übersicht: Fach → Klasse → Sitzungen ---------- */
async function loadLessons() { return (await tapi("GET", "/api/teacher/lessons")).lessons; }

async function subjectsPage() {
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("lessons"), main);
  // Wochenkalender ganz oben: lädt eigenständig (ein Fehler dort verhindert die Fächer nicht)
  const week = weekCard(() => tapi("GET", "/api/teacher/schedule").then((r) => r.units));
  resumeCleanup();
  printPending();
  cardsPendingRun();
  let all; try { all = await loadLessons(); } catch (e) { clear(main).append(h("p", { class: "err", text: e.message })); return; }
  clear(main).append(...nn(pageHead({ title: "Welches Fach unterrichten Sie?", sub: "Planung in Unterrichtseinheiten – jede Sitzung gehört zu einer Stunde ihrer Einheit." }),
    week, h("h2", { class: "sr-only", text: "Fächer" }),
    h("div", { class: "tiles" }, SUBJECTS.map((s) => {
      const n = all.filter((l) => l.subject === s.id).length;
      return h("a", { class: "tile", href: "#/lk/f/" + s.id, dataset: { fach: s.id } }, h("div", { class: "t", text: s.name }), h("div", { class: "s", text: n ? n + " Sitzung" + (n === 1 ? "" : "en") : "Noch keine Sitzungen" }));
    })),
    h("p", { class: "hint", style: { marginTop: ".8rem" } }, "Die Unterrichtsplanung beginnt mit der Unterrichtseinheit; Grundlage sind die ", h("a", { href: "#/lk/grundlagen" }, "Planungsgrundlagen"), " (Schulcurriculum, KCGO, Abiturerlass) – bitte einmal je Fach hochladen."),
    all.length ? h("div", { class: "card", style: { marginTop: "1.2rem" } }, h("h2", { text: "Zuletzt bearbeitet" }), lessonList(all.slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6), true)) : null));
}

export async function subjectConfigs() { return (await tapi("GET", "/api/teacher/subjects")).subjects; }

async function classesPage(subject) {
  if (!isValidSubject(subject)) return go("#/lk");
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("lessons"), main);
  let all, cfg;
  try { [all, cfg] = await Promise.all([loadLessons().then((x) => x.filter((l) => l.subject === subject)), subjectConfigs().then((c) => c[subject])]); }
  catch (e) { clear(main).append(h("p", { class: "err", text: e.message })); return; }
  const notes = cfg.gradeNotes || {};
  const count = (k) => all.filter((l) => l.klass === k).length;
  const classGrid = (g) => h("div", { class: "class-grid" + (g.key === "Q" ? " q" : "") }, g.classes.map((k) => { const n = count(k); return h("a", { class: "class-btn", href: "#/lk/f/" + subject + "/" + k }, classShort(k), n ? h("span", { class: "n", text: String(n) }) : null); }));
  // Ev. Religion und Ethik (Jg. 5–10, E-Phase): je Jahrgang ein Kurs; die Lehrkraft wählt, welche Klassen darin vertreten sind
  const courseBlock = (g) => {
    const k = courseKey(g.key), members = (cfg.courses || {})[g.key] || [], n = count(k);
    const loose = g.classes.map((c) => [c, count(c)]).filter(([, m]) => m);   // ältere Sitzungen in einzelnen Klassen (nicht im Kurs)
    return [members.length
      ? h("div", { class: "course-row" },
          h("a", { class: "class-btn course", href: "#/lk/f/" + subject + "/" + k }, classShort(k), n ? h("span", { class: "n", text: String(n) }) : null),
          h("span", { class: "course-members", text: "Klassen " + members.map(classShort).join(", ") }),
          h("button", { class: "btn small ghost", type: "button", onclick: () => editCourse(subject, g, members, () => classesPage(subject)) }, icon("edit"), "Klassen ändern"))
      : h("div", { class: "course-row" },
          h("button", { class: "btn", type: "button", onclick: () => editCourse(subject, g, [], () => go("#/lk/f/" + subject + "/" + k)) }, "Kurs anlegen"),
          h("span", { class: "course-members", text: "Sie wählen, welche Klassen im Kurs vertreten sind." })),
      loose.length ? h("p", { class: "small" }, "Ältere Sitzungen in einzelnen Klassen: ", loose.map(([c, m], i) => [i ? ", " : "", h("a", { href: "#/lk/f/" + subject + "/" + c }, classShort(c) + " (" + m + ")")])) : null];
  };
  clear(main).append(pageHead({ fach: subject, crumbs: [["#/lk", "Fächer"], subjectName(subject)], title: "In welcher Klasse bzw. welchem Kurs unterrichten Sie " + subjectName(subject) + "?" }),
    h("div", { class: "card" }, classGroupsFor(cfg).map((g) => h("div", { class: "class-group" }, h("h3", { text: g.label }),
      notes[g.key] ? h("p", { class: "hint", text: notes[g.key] }) : null,
      cfg.courseMode && COURSE_GRADES.includes(g.key) ? courseBlock(g) : classGrid(g)))),
    h("p", { class: "hint" }, "Angezeigt werden die Jahrgänge, in denen " + subjectName(subject) + " laut Fach-Einstellungen unterrichtet wird (", h("a", { href: "#/lk/grundlagen/" + subject }, "ändern"), ")." +
      (cfg.courseMode ? " In den Jahrgängen 5–10 und in der E-Phase gibt es je Jahrgang einen Kurs mit Schüler:innen aus mehreren Klassen." : "")));
}

/* Kurs eines Jahrgangs anlegen bzw. seine Klassen ändern (Ev. Religion, Ethik) */
function editCourse(subject, g, current, after) {
  const sel = new Set(current), k = courseKey(g.key);
  const grid = h("div", { class: "class-grid", role: "group", "aria-label": "Klassen im " + classShort(k) }, g.classes.map((c) => h("button", { class: "class-btn", type: "button", "aria-pressed": String(sel.has(c)),
    onclick: (e) => { if (sel.has(c)) sel.delete(c); else sel.add(c); e.currentTarget.setAttribute("aria-pressed", String(sel.has(c))); err.textContent = ""; } }, classShort(c))));
  const err = h("p", { class: "err", role: "alert" });
  modal({ title: subjectName(subject) + ": " + classShort(k), body: h("div", null,
      h("p", { text: "Welche Klassen sind in Ihrem Kurs vertreten? Schüler:innen wählen weiter ihre eigene Klasse – die Plattform ordnet sie diesem Kurs zu." }),
      grid, err,
      h("p", { class: "hint", text: "Sitzungen und Einheiten, die bisher in einer der gewählten Klassen liegen, ziehen in den Kurs um. Schüler:innen einer später entfernten Klasse behalten die Sitzungen, die sie schon geöffnet haben." })),
    actions: [{ label: "Abbrechen" }, { label: current.length ? "Speichern" : "Kurs anlegen", class: "primary", onClick: async () => {
      if (!sel.size) { err.textContent = "Bitte mindestens eine Klasse wählen."; return false; }
      try {
        const r = await tapi("PUT", "/api/teacher/subjects/" + subject, { body: { courses: { [g.key]: [...sel] } } });
        const m = r.moved || {}, parts = [m.lessons ? m.lessons + " Sitzung" + (m.lessons === 1 ? "" : "en") : null, m.units ? m.units + " Einheit" + (m.units === 1 ? "" : "en") : null].filter(Boolean);
        toast((current.length ? "Klassen des Kurses gespeichert." : classShort(k) + " angelegt.") + (parts.length ? " " + parts.join(" und ") + " in den Kurs übernommen." : ""), "ok", 6000);
        if (after) after();
      } catch (e) { err.textContent = e.message; return false; }
    } }] });
}

function lessonList(lessons, showContext) {
  const list = h("div", { class: "list" });
  if (!lessons.length) list.append(h("p", { class: "muted", text: "Noch keine Sitzungen." }));
  for (const l of lessons) list.append(h("a", { class: "item", href: "#/lk/s/" + l.id },
    showContext ? h("span", { class: "ftag", dataset: { fach: l.subject }, text: (SUBJECTS.find((s) => s.id === l.subject) || {}).short || "" }) : null,
    h("div", { class: "main" }, h("div", { class: "name", text: l.title }),
      h("div", { class: "meta", text: [showContext ? subjectName(l.subject) + " · " + classShort(l.klass) : null, l.date ? fmtDay(l.date) : "ohne Datum", showContext ? l.topic || null : null, l.durationMin ? l.durationMin + " min" : null].filter(Boolean).join(" · ") })),
    h("div", { class: "row" }, l.substitute === "aktiv" ? h("span", { class: "badge ink", text: "Vertretung aktiv" }) : l.substitute === "vorschlag" ? h("span", { class: "badge", text: "Vertretungsvorschlag" }) : null,
      l.hasStop ? h("span", { class: "badge stop" }, icon("pause"), "Zwischenstopp") : null, l.hasHomework ? h("span", { class: "badge", text: "Hausaufgabe" }) : null,
      l.hasPortal ? h("span", { class: "badge ok" }, icon("check"), "Schulportal") : null, h("span", { class: "badge", text: l.studentCount + " SuS" }), h("span", { class: "badge mono", text: formatCode(l.code) }))));
  return list;
}

async function lessonsPage(subject, klass) {
  if (!isValidSubject(subject) || !isValidClass(klass)) return go("#/lk");
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("lessons"), main);
  let list, units, cfg, bases, cs, CC;
  try {
    [list, units, cfg, bases, cs, CC] = await Promise.all([
      tapi("GET", "/api/teacher/lessons?subject=" + subject + "&klass=" + klass).then((r) => r.lessons),
      tapi("GET", "/api/teacher/units?subject=" + subject + "&klass=" + klass).then((r) => r.units),
      subjectConfigs().then((c) => c[subject]),
      tapi("GET", "/api/teacher/bases?subject=" + subject).then((r) => r.bases),
      // Kurseinstellungen (Stundenplan, Schülerzahl) – nur für Klassen, die laut Fach-Einstellungen unterrichtet werden (sonst null)
      tapi("GET", "/api/teacher/course-settings?subject=" + subject + "&klass=" + klass).then((r) => ({ settings: r.settings })).catch(() => null),
      import("./coursecard.js")]);
  } catch (e) { clear(main).append(h("p", { class: "err", text: e.message })); return; }
  const name = subjectName(subject), gk = gradeKey(klass), members = courseMembers(cfg, klass);
  if (!classAllowed(cfg, klass)) {
    clear(main).append(h("div", { class: "card" }, h("p", { text: name + " wird in " + classShort(klass) + " laut Fach-Einstellungen nicht unterrichtet." }),
      h("a", { class: "btn", href: "#/lk/grundlagen/" + subject }, "Fach-Einstellungen öffnen")));
    return;
  }
  const missing = missingFor(bases, subject, name, klass);
  // Neue Einheit
  const title = h("input", { id: "ut", maxlength: "200", placeholder: "z. B. Wirtschaftspolitik in der Sozialen Marktwirtschaft" });
  const btn = h("button", { class: "btn primary", type: "submit" }, "Einheit anlegen");
  const form = h("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault();
    await busy(btn, async () => {
      try { const r = await tapi("POST", "/api/teacher/units", { body: { subject, klass, title: title.value } }); go("#/lk/u/" + r.unit.id); }
      catch (err) { errToast(err); }
    }, "Lege an …");
  } }, h("h2", { text: "Neue Unterrichtseinheit planen" }),
    h("p", { class: "small", text: "Zuerst wird die Einheit geplant: Rahmendaten (Sitzungen pro Woche, Länge, Klausur, Ende), dann mit Claude Planungsgrundlage, zentrale Lernaufgabe, Leupold-Schema und Ablauf. Aus der festgelegten Einheit entstehen die Sitzungen mit Datum – erst dann beginnt die Planung der einzelnen Stunden." }),
    h("div", { class: "field" }, h("label", { for: "ut" }, "Thema / Arbeitstitel (optional, später änderbar)"), title), btn);
  // Einheiten mit ihren Sitzungen (nach Datum)
  const byDateAsc = (a, b) => (a.date === b.date ? a.createdAt - b.createdAt : (a.date || "") < (b.date || "") ? -1 : 1);
  const unitBox = h("div", { class: "stack" });
  if (!units.length) unitBox.append(h("p", { class: "muted", text: "Noch keine Unterrichtseinheit. Legen Sie rechts die erste an." }));
  for (const u of units) {
    const ls = list.filter((l) => l.unitId === u.id).sort(byDateAsc);
    const dates = ls.map((l) => l.date).filter(Boolean);
    unitBox.append(h("section", { class: "card unit-card" },
      h("div", { class: "section-title" }, h("h2", null, h("a", { href: "#/lk/u/" + u.id, text: u.title || "Unterrichtseinheit ohne Titel" })),
        h("span", { class: "badge " + (u.status === "geplant" ? "ok" : ""), text: u.status === "geplant" ? "festgelegt" : "in Planung" })),
      h("p", { class: "small muted", text: [u.plan && u.plan.lernaufgabe ? "Lernaufgabe: " + u.plan.lernaufgabe.slice(0, 160) + (u.plan.lernaufgabe.length > 160 ? " …" : "") : "Lernaufgabe noch offen",
        u.rows.length ? u.rows.length + " Stunden geplant" : null, dates.length ? fmtDay(dates[0]) + " – " + fmtDay(dates[dates.length - 1]) : null].filter(Boolean).join(" · ") }),
      ls.length ? lessonList(ls, false) : h("p", { class: "small" }, u.status === "geplant" ? "Noch keine Sitzungen." : "Sitzungen entstehen, sobald die Einheit festgelegt ist. ", h("a", { href: "#/lk/u/" + u.id }, "Einheit öffnen"))));
  }
  const loose = list.filter((l) => !l.unitId || !units.some((u) => u.id === l.unitId)).sort(byDateAsc);
  if (loose.length) unitBox.append(h("section", { class: "card" }, h("h2", { text: "Sitzungen ohne Einheit" }), lessonList(loose, false)));
  const stopNote = h("div");
  const courseSub = isCourseClass(klass) ? (members.length ? "Klassen " + members.map(classShort).join(", ") : "Noch keine Klassen eingetragen") + " · " + gradeInfo(klass).text.split(",")[0] : null;
  clear(main).append(...nn(pageHead({ fach: subject, crumbs: [["#/lk", "Fächer"], ["#/lk/f/" + subject, name], classShort(klass)], title: name + " · " + classShort(klass), sub: courseSub || gradeInfo(klass).text }),
    isCourseClass(klass) && !members.length ? h("div", { class: "notice warn", style: { marginBottom: ".8rem" } }, "Für diesen Kurs sind noch keine Klassen eingetragen – Schüler:innen können seine Sitzungen erst öffnen, wenn ihre Klasse dazugehört. ",
      h("a", { href: "#/lk/f/" + subject }, "Klassen wählen")) : null,
    (cfg.gradeNotes || {})[gk] ? h("div", { class: "notice", style: { marginBottom: ".8rem" } }, h("strong", { text: "Hinweis: " }), cfg.gradeNotes[gk]) : null,
    isAnalogClass(klass) ? h("div", { class: "notice", style: { marginBottom: ".8rem" } }, h("strong", { text: "Jahrgang " + gk + ": " }), ANALOG_RULE) : null,
    missing.length ? h("div", { class: "notice warn", style: { marginBottom: ".8rem" } }, "Für die Planung fehlt noch: " + missing.join("; ") + ". ", h("a", { href: "#/lk/grundlagen/" + subject }, "Planungsgrundlagen hochladen"))
      : subject !== "powi" && !cfg.complete ? h("div", { class: "notice", style: { marginBottom: ".8rem" } }, "Bitte prüfen Sie, ob alle Vorgaben für " + name + " hochgeladen sind, und bestätigen Sie die Vollständigkeit. ", h("a", { href: "#/lk/grundlagen/" + subject }, "Planungsgrundlagen")) : null,
    h("div", { class: "session-grid" }, unitBox, h("div", { class: "side" }, stopNote, cs ? CC.courseSettingsCard({ subject, klass, settings: cs.settings }) : null, form))));
  // Beginnt die Planung der nächsten Stunde: Hinweis, wenn die letzte Sitzung mit einem Zwischenstopp endete
  // maßgeblich ist die zuletzt gehaltene Sitzung (Datum bis heute); sind alle in der Zukunft, die neueste
  const today = new Date().toLocaleDateString("sv-SE");
  const byDate = list.filter((l) => l.date).sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
  const last = byDate.find((l) => l.date <= today) || byDate[0];
  if (last && last.hasStop) {
    try {
      const d = await tapi("GET", "/api/teacher/lessons/" + last.id);
      stopNote.append(h("section", { class: "card prevstop", role: "note" }, h("h2", { text: "Die letzte Stunde wurde nicht vollständig beendet" }),
        h("p", { class: "small" }, "„", h("strong", { text: last.title }), "“ (" + fmtDay(last.date) + ") endet mit einem Zwischenstopp:"),
        portalPreview(d.lesson.portal), h("a", { class: "btn small", href: "#/lk/s/" + last.id, style: { marginTop: ".6rem" } }, "Sitzung öffnen")));
    } catch {}
  }
}

/* ---------- Einstellungen ---------- */
async function settingsPage() {
  const main = h("main", { class: "narrow" }, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("settings"), main);
  let ai, mcp, me, sp;
  try { [ai, mcp, me, sp] = await Promise.all([tapi("GET", "/api/teacher/ai"), tapi("GET", "/api/teacher/mcp"), tapi("GET", "/api/teacher/me"), tapi("GET", "/api/teacher/student-settings"), config()]); }
  catch (e) { clear(main).append(h("p", { class: "err", text: e.message })); return; }
  clear(main).append(pageHead({ title: "Einstellungen" }));
  main.append(aiSection(ai), connectorSection(mcp), studentSection(sp), accountSection(me), fbSection(), resetSection());
}

/* ---------- Unterricks zurücksetzen (Einstellungen, ganz unten) ----------
 * Erst das Passwort (geprüft vom Server, Sperren wie bei der Anmeldung), dann das Angebot einer Sicherung (ZIP: Fach / Einheit / Sitzungen,
 * backup.js), eine letzte Bestätigung und das Löschen (worker/reset.js: Datenbank in einem Schritt, Dateien in Runden). */
export const RESET_LABEL = "Alle Unterrichtsinhalte löschen und Unterricks zurücksetzen";
const DELETED_TEXT = "Gelöscht werden alle Unterrichtseinheiten und Unterrichtssitzungen mit allem, was dazugehört: Rahmendaten, Leupold-Schema und Ablauf, Planung der Sitzungen, " +
  "Materialien, Präsentationen, Planungsverläufe, Schulportal-Einträge, Hausaufgaben, Drucklisten, Verknüpfungen und Entwürfe von Feibeitsblättern, Vertretungspläne und die Freischaltungen der Schüler:innen.";
const KEPT_TEXT = "Es bleiben: Ihr Zugang und Ihr Passwort, die Planungsgrundlagen, die Fach-Einstellungen mit den Kursen, die KI-Einstellungen, der Claude-Connector, die Feibeitsblatt-Verbindung, " +
  "das Schülerpasswort und die angemeldeten Schülergeräte. Die Feibeitsblätter selbst und die Abgaben darin bleiben im Feibeitsblatt.";
function resetSection() {
  const status = h("p", { class: "small", role: "status" });
  const btn = h("button", { class: "btn danger", type: "button", onclick: () => startReset(btn, status) }, RESET_LABEL);
  // ein unterbrochenes Zurücksetzen (Seite geschlossen): die restlichen Dateien jetzt löschen
  tapi("GET", "/api/teacher/reset").then((r) => { if (r.pending) finishCleanup(status, r.pending); }).catch(() => {});
  return h("section", { class: "card dangerzone", id: "resetcard" }, h("h2", { text: "Unterricks zurücksetzen" }),
    h("p", { class: "small", text: DELETED_TEXT }), h("p", { class: "small", text: KEPT_TEXT }),
    h("p", { class: "small", text: "Vor dem Löschen fragt Unterricks Ihr Passwort ab und bietet eine Sicherung als ZIP-Datei an: je Fach die Unterrichtseinheiten, darin die Einheitsdatei und die Sitzungen (chronologisch nummeriert) als Sitzungsdateien – zum Wiederverwenden über „Einheit aus Datei laden“ bzw. „Sitzung aus Datei laden“." }),
    h("div", { class: "row" }, btn), status);
}
/* Passwort abfragen und prüfen → authKey (oder null) */
function askResetPassword(info) {
  return new Promise((resolve) => {
    let done = false;
    const pw = h("input", { id: "rs-pw", type: "password", autocomplete: "current-password" }), msg = h("p", { class: "err", role: "alert" });
    modal({ title: "Zurücksetzen: Passwort bestätigen", onClose: () => { if (!done) resolve(null); },
      body: (el) => el.append(h("p", { class: "small", text: "Gelöscht werden " + info.units + " Unterrichtseinheit" + (info.units === 1 ? "" : "en") + " und " + info.lessons + " Sitzung" + (info.lessons === 1 ? "" : "en") +
          (info.files ? " mit " + info.files + " Materialien und Dateien" + (info.bytes ? " (" + fmtBytes(info.bytes) + ")" : "") : "") + ". Bitte bestätigen Sie mit Ihrem Unterricks-Passwort – danach können Sie vor dem Löschen noch eine Sicherung herunterladen." }),
        h("div", { class: "field" }, h("label", { for: "rs-pw" }, "Unterricks-Passwort"), pw), msg),
      actions: [{ label: "Abbrechen", onClick: () => { done = true; resolve(null); } },
        { label: "Weiter", class: "primary", onClick: async (e) => {
          msg.textContent = "";
          const b = e.currentTarget; b.disabled = true;
          try {
            const me = await tapi("GET", "/api/teacher/me");
            const s = await api("POST", "/api/teacher/salt", { body: { username: me.username } });
            const d = await deriveLogin(pw.value, s.salt, s.iterations);
            await tapi("POST", "/api/teacher/verify-password", { body: { authKey: d.authKey } });
            done = true; resolve(d.authKey);
          } catch (err) { msg.textContent = err.message; b.disabled = false; return false; }
        } }] });
    pw.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const p = pw.closest(".modal"); const b = p && p.querySelector("footer .btn.primary"); if (b && !b.disabled) b.click(); } });
  });
}
/* Sicherung ja/nein → "backup" | "skip" | null */
function askBackup() {
  return new Promise((resolve) => {
    let done = false;
    const pick = (v) => () => { done = true; resolve(v); };
    modal({ title: "Vorher eine Sicherung herunterladen?", wide: true, onClose: () => { if (!done) resolve(null); },
      body: (el) => el.append(
        h("p", { class: "small", text: "Die Sicherung ist eine ZIP-Datei mit allen Unterrichtsinhalten. Aufbau: 1. Ebene die Fächer, 2. Ebene die Unterrichtseinheiten (mit der Einheitsdatei), 3. Ebene die Sitzungen – chronologisch nummeriert, jede als Sitzungsdatei. So lassen sich Einheiten und Sitzungen später wieder in Unterricks laden." }),
        h("p", { class: "small", text: "Je nach Menge der Präsentationen und Materialien kann die Datei groß werden und das Zusammenstellen einige Minuten dauern. Die Inhalte der Feibeitsblätter kommen als Entwürfe mit, wenn Unterricks mit Feibeitsblatt verbunden ist; sonst nur ihre Codes." })),
      actions: [{ label: "Abbrechen", onClick: pick(null) }, { label: "Ohne Sicherung fortfahren", class: "danger", onClick: pick("skip") }, { label: "Sicherung herunterladen", class: "primary", onClick: pick("backup") }] });
  });
}
/* Sicherung erstellen und herunterladen (Fortschritt im Dialog, abbrechbar) → Zusammenfassung oder null */
async function runBackup() {
  let stop = false, closed = false;
  const status = h("p", { role: "status", text: "Bereite vor …" }), bar = h("i");
  const dlg = modal({ title: "Sicherung wird erstellt", onClose: () => { closed = true; stop = true; },
    body: (el) => el.append(status, h("div", { class: "progress" }, bar), h("p", { class: "hint", text: "Bitte lassen Sie diese Seite geöffnet. Gelöscht wird erst nach Ihrer Bestätigung." })),
    actions: [{ label: "Abbrechen", onClick: () => { stop = true; } }] });
  try {
    const B = await import("./backup.js");
    const r = await B.buildBackup({ onStep: (m) => { status.textContent = m; }, onProgress: (d, n) => { bar.style.width = (n ? Math.round((d / n) * 100) : 100) + "%"; }, cancelled: () => stop });
    if (!closed) dlg.close();
    downloadBlob(r.blob, r.name, 30 * 60e3);
    return { ...r, size: r.blob.size };
  } catch (e) {
    if (!closed) dlg.close();
    if (!(e && e.cancelled)) toast("Die Sicherung ließ sich nicht erstellen: " + (e && e.message ? e.message : e) + " Es wurde nichts gelöscht.", "err", 12000);
    else toast("Sicherung abgebrochen – es wurde nichts gelöscht.", "", 6000);
    return null;
  }
}
/* letzte Bestätigung (mit Ergebnis der Sicherung): löschen erst, wenn das Kästchen bestätigt ist; die Sicherung lässt sich hier (mit einem
   echten Klick – manche Browser fragen bei Downloads ohne Klick nach oder blockieren sie) erneut herunterladen */
function confirmReset(info, backup) {
  return new Promise((resolve) => {
    let done = false;
    const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
    const list = (title, xs) => (xs.length ? [h("h3", { text: title }), h("ul", { class: "small" }, xs.slice(0, 15).map((x) => h("li", { text: x })), xs.length > 15 ? h("li", { text: "… und " + (xs.length - 15) + " weitere" }) : null)] : []);
    const check = h("input", { type: "checkbox", id: "rs-ok" });
    const again = backup ? h("button", { class: "btn small", type: "button", onclick: () => downloadBlob(backup.blob, backup.name, 30 * 60e3) }, icon("download"), "Sicherung erneut herunterladen") : null;
    modal({ title: backup ? "Sicherung heruntergeladen – jetzt löschen?" : "Ohne Sicherung endgültig löschen?", wide: true, onClose: () => { if (!done) resolve(false); },
      body: (el) => el.append(...nn(
        backup ? h("p", null, "Die Sicherung „", h("strong", { text: backup.name }), "“ (" + fmtBytes(backup.size) + ", " + plural(backup.counts.units, "Einheit", "Einheiten") + ", " + plural(backup.counts.lessons, "Sitzung", "Sitzungen") + ") wird heruntergeladen. Bitte prüfen Sie im Download-Ordner, ob sie vollständig gespeichert ist. Kam kein Download an, laden Sie sie hier erneut herunter.") : null,
        again ? h("div", { class: "row" }, again) : null,
        backup ? null : h("p", { class: "err", text: "Ohne Sicherung lassen sich die Unterrichtsinhalte danach nicht wiederherstellen." }),
        ...(backup ? list("Diese Dateien fehlen in der Sicherung – sie gingen beim Löschen verloren", backup.missing) : []),
        ...(backup ? list("Hinweise zur Sicherung", backup.notes) : []),
        h("p", { class: "small", text: DELETED_TEXT }),
        h("p", { class: "small", text: "Endgültig gelöscht werden " + plural(info.units, "Unterrichtseinheit", "Unterrichtseinheiten") + " und " + plural(info.lessons, "Sitzung", "Sitzungen") + ". Das lässt sich nicht rückgängig machen." }),
        h("label", { class: "checkrow", for: "rs-ok" }, check, backup ? " Die Sicherung ist vollständig gespeichert – jetzt alles löschen." : " Ich habe verstanden, dass sich die Unterrichtsinhalte ohne Sicherung nicht wiederherstellen lassen."))),
      actions: [{ label: "Abbrechen – nichts löschen", onClick: () => { done = true; resolve(false); } },
        { label: "Jetzt endgültig löschen", class: "danger", onClick: () => { if (!check.checked) { check.focus(); toast("Bitte zuerst das Kästchen bestätigen.", "err", 5000); return false; } done = true; resolve(true); } }] });
  });
}
async function startReset(btn, status) {
  if (btn.disabled) return;
  let info;
  try { info = await tapi("GET", "/api/teacher/reset"); } catch (e) { errToast(e); return; }
  if (!info.units && !info.lessons) { toast("Es gibt keine Unterrichtseinheiten und Sitzungen – nichts zu löschen.", "", 6000); if (info.pending) finishCleanup(status, info.pending); return; }
  const authKey = await askResetPassword(info);
  if (!authKey) return;
  const choice = await askBackup();
  if (!choice) return;
  let backup = null;
  if (choice === "backup") { backup = await runBackup(); if (!backup) return; }
  if (!(await confirmReset(info, backup))) return;
  await busy(btn, async () => {
    let r;
    try {
      stateLine(status, "Lösche die Unterrichtsinhalte …");
      r = await tapi("POST", "/api/teacher/reset", { body: { authKey, ...(backup && backup.mark ? { mark: backup.mark } : {}) } });
    } catch (e) {
      // ist trotz Fehler schon gelöscht (z. B. Verbindung abgerissen)? Dann den wahren Stand zeigen und aufräumen
      let now = null; try { now = await tapi("GET", "/api/teacher/reset"); } catch {}
      if (now && !now.units && !now.lessons) { r = { deleted: { units: info.units, lessons: info.lessons }, pending: now.pending }; }
      else { stateLine(status, (e.code === "changed" ? "" : "Nicht gelöscht: ") + e.message, "err"); errToast(e); return; }
    }
    store.del("u.nfFails");
    try { const B = await import("./backup.js"); await B.clearAllPending(); } catch {}
    if (r.pending) await finishCleanup(status, r.pending);
    else stateLine(status, "Alle Unterrichtsinhalte sind gelöscht.", "ok");
    toast("Unterricks wurde zurückgesetzt: " + r.deleted.units + " Einheiten und " + r.deleted.lessons + " Sitzungen gelöscht.", "ok", 9000);
  }, "Lösche …");
}
/* nach einem unterbrochenen Zurücksetzen: restliche Dateien leise weiter löschen (einmal je Seitenaufruf, z. B. auf der Startseite) */
let resumeChecked = false;
/* Material von Claude, das noch nicht (neu) gedruckt ist – z. B. Vertretungsmaterial nach dem Bestätigen oder Material, das Claude bei
   ausgelastetem Drucker abgelegt hat – druckt die gemeinsame Warteschlange nach, auch wenn seine Sitzung niemand öffnet */
export function printPending() {
  tapi("GET", "/api/teacher/render").then(async (r) => {
    if (!r.configured || !Array.isArray(r.pending) || !r.pending.length || (r.usage && r.usage.quotaUntil)) return;
    const { printQueue } = await import("./designrender.js");
    const q = printQueue(), before = q.pending;
    for (const f of r.pending) q.add(f);
    const added = q.pending - before;
    if (added > 0) toast("Unterricks druckt " + (added === 1 ? "ein Material" : added + " Materialien") + " von Claude als PDF – Sie können weiterarbeiten.", "ok", 6000);
  }).catch(() => {});
}
/* Bildkarten der Grundschule, deren Bilder fehlen oder nicht mehr zur PDF passen (hochgeladen oder von Claude gestaltet): Der Browser der
   Lehrkraft erstellt sie nach (cards.js lädt erst, wenn es etwas zu tun gibt) – auch, sobald die gemeinsame Warteschlange eine gestaltete
   Bildkarten-PDF gedruckt hat. Eltern sehen Bildkarten erst mit aktuellen Bildern. */
const cardsHooked = new WeakSet();
export function cardsPendingRun() {
  tapi("GET", "/api/teacher/cards/pending").then(async (r) => {
    if (Array.isArray(r.files) && r.files.length) (await import("./cards.js")).rasterizePending(r.files);
  }).catch(() => {});
  import("./designrender.js").then(({ printQueue }) => {
    const q = printQueue();
    if (cardsHooked.has(q)) return;
    cardsHooked.add(q);
    q.on({ done: (f) => { if (f && f.cards && !f.cards.current && f.status === "ready") import("./cards.js").then((m) => m.rasterizePending([{ id: f.id, version: f.cards.version }])).catch(() => {}); } });
  }).catch(() => {});
}
function resumeCleanup() {
  if (resumeChecked) return;
  resumeChecked = true;
  tapi("GET", "/api/teacher/reset").then(async (r) => {
    let pending = r.pending;
    for (let i = 0; i < 400 && pending > 0; i++) pending = (await tapi("POST", "/api/teacher/reset/cleanup")).pending;
  }).catch(() => {});
}
/* restliche Dateien gelöschter Sitzungen löschen (in Runden) */
async function finishCleanup(status, pending) {
  const total = pending;
  for (let i = 0; i < 400 && pending > 0; i++) {
    stateLine(status, "Lösche die Dateien der gelöschten Sitzungen … (" + (total - pending) + " von " + total + ")");
    try { pending = (await tapi("POST", "/api/teacher/reset/cleanup")).pending; }
    catch (e) { stateLine(status, "Die Dateien ließen sich noch nicht alle löschen (" + e.message + ") – beim nächsten Öffnen der Einstellungen geht es weiter.", "err"); return; }
  }
  if (pending > 0) stateLine(status, "Es sind noch Dateien zu löschen – beim nächsten Öffnen der Einstellungen geht es weiter.", "err");
  else stateLine(status, "Alle Unterrichtsinhalte sind gelöscht.", "ok");
}

function providerOptions(providers, selected) {
  return providers.map((p) => h("option", { value: p.id, selected: p.id === selected ? true : null }, p.label + (p.hasKey ? "" : " – kein Schlüssel")));
}
function aiSection(ai) {
  const box = h("section", { class: "card" });
  const paint = (cfg) => {
    clear(box).append(h("h2", { text: "KI-Modelle (kostenlos)" }),
      h("p", { class: "muted small", text: "Der Chatbot und die KI-Funktionen der Plattform nutzen kostenlose Modelle. Claude nutzen Sie über Ihr Pro-Abo in claude.ai (Connector unten) – Anthropic erlaubt nicht, das Abo in fremde Anwendungen einzubinden. Die Wahl des Claude-Modells treffen Sie direkt in claude.ai." }));
    // Reihenfolge beim Planen: Claude (Hauptweg) → kostenlose Dienste in der Reihenfolge des Chats
    const pl = cfg.tasks.find((t) => t.id === "planning"), route = (pl && pl.route) || (pl ? [pl.choice] : []);
    const lab = (pid) => (cfg.providers.find((p) => p.id === pid) || {}).label || pid;
    box.append(h("div", { class: "notice", id: "ai-order" }, h("strong", { text: "Reihenfolge beim Planen" }),
      h("ol", { class: "small", style: { margin: ".3rem 0 .2rem" } },
        h("li", null, h("strong", { text: "Claude" }), " – Ihr Pro-Abo in claude.ai über den Connector (Hauptweg): „Stunde mit Claude planen“ in jeder Sitzung, „Einheit mit Claude planen“ in jeder Einheit, Vertretung bei Krankheit."),
        route.map((x, i) => h("li", null, h("strong", { text: lab(x.provider) }), " (" + (x.model || "Standardmodell") + ") – " +
          (i === 0 ? "Chat der Plattform („Backup“ in jeder Sitzung), wenn Ihr Claude-Kontingent erschöpft ist." : "springt automatisch ein, wenn " + lab(route[i - 1].provider) + " nicht antwortet oder sein Kontingent erschöpft ist.")))),
      h("p", { class: "hint", text: "Ihr Claude-Kontingent kann die Plattform nicht sehen – zum Backup wechseln Sie selbst. Danach wechselt die Plattform von allein: Ist bei Groq nur die Minutengrenze erreicht, wartet sie bis zu 30 Sekunden und verkleinert zu große Anfragen, bevor sie den nächsten Dienst fragt. Die Reihenfolge gilt für den Chat; unten lässt sie sich je Aufgabe ändern." })));
    // Schlüssel je Anbieter
    const keys = h("div", { class: "list" });
    for (const p of cfg.providers) {
      if (p.keyless) { keys.append(h("div", { class: "item" }, h("div", { class: "main" }, h("div", { class: "name", text: p.label }), h("div", { class: "meta", text: p.note })), h("span", { class: "badge ok", text: "ohne Schlüssel" }))); continue; }
      const inp = h("input", { type: "password", autocomplete: "off", placeholder: p.hasKey ? "Schlüssel gespeichert – zum Ersetzen neu eingeben" : "API-Schlüssel", "aria-label": "Schlüssel für " + p.label });
      const base = p.id === "custom" ? h("input", { placeholder: "https://…/v1", value: p.base || "", "aria-label": "Basis-URL" }) : null;
      const save = h("button", { class: "btn small primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try { const r = await tapi("PUT", "/api/teacher/ai", { body: { key: { provider: p.id, apiKey: inp.value || (p.hasKey ? undefined : ""), base: base ? base.value : undefined } } }); toast("Gespeichert.", "ok"); paint(r); } catch (err) { errToast(err); }
      }) }, "Speichern");
      const del = p.hasKey ? h("button", { class: "btn small danger", type: "button", onclick: (e) => busy(e.currentTarget, async () => { try { paint(await tapi("PUT", "/api/teacher/ai", { body: { key: { provider: p.id, apiKey: null } } })); } catch (err) { errToast(err); } }) }, "Löschen") : null;
      keys.append(h("div", { class: "item" }, h("div", { class: "main stack" }, h("div", { class: "row between" }, h("div", { class: "name", text: p.label }), p.hasKey ? h("span", { class: "badge ok", text: "Schlüssel gespeichert" }) : h("span", { class: "badge", text: "kein Schlüssel" })),
        h("div", { class: "meta" }, p.note + " ", p.keyUrl ? h("a", { href: p.keyUrl, target: "_blank", rel: "noopener" }, "Schlüssel holen") : null), base, h("div", { class: "row" }, h("div", { class: "grow" }, inp), save, del))));
    }
    box.append(h("h3", { style: { marginTop: "1rem" }, text: "Zugänge" }), keys);
    // Modell je Aufgabe
    const tasks = h("div", { class: "list" });
    for (const t of cfg.tasks) {
      const sel = h("select", { "aria-label": "Anbieter für " + t.label }, providerOptions(cfg.providers, t.choice.provider));
      const dl = h("datalist", { id: "dl-" + t.id });
      const model = h("input", { value: t.choice.model || "", list: "dl-" + t.id, "aria-label": "Modell für " + t.label, placeholder: "Modell-ID" });
      sel.addEventListener("change", () => { const p = cfg.providers.find((x) => x.id === sel.value); model.value = (p && p.defaultModel) || ""; clear(dl); });
      const load = h("button", { class: "btn small", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try { const r = await tapi("POST", "/api/teacher/ai/models", { body: { provider: sel.value } }); clear(dl).append(...r.models.map((m) => h("option", { value: m }))); toast(r.models.length + " Modelle verfügbar – Feld anklicken zur Auswahl.", "ok"); model.focus(); } catch (err) { errToast(err); }
      }) }, "Modelle laden");
      const test = h("button", { class: "btn small", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try { const r = await tapi("POST", "/api/teacher/ai/test", { body: { provider: sel.value, model: model.value } }); toast("Antwort von " + r.model + " in " + (r.ms / 1000).toFixed(1) + " s: „" + r.reply.trim().slice(0, 60) + "“", "ok", 6000); } catch (err) { errToast(err); }
      }, "Teste …") }, "Testen");
      const save = h("button", { class: "btn small primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
        try { paint(await tapi("PUT", "/api/teacher/ai", { body: { tasks: { [t.id]: { provider: sel.value, model: model.value } } } })); toast("Gespeichert.", "ok"); } catch (err) { errToast(err); }
      }) }, "Speichern");
      tasks.append(h("div", { class: "item" }, h("div", { class: "main stack" }, h("div", { class: "name", text: t.label + (t.saved ? "" : " (Vorgabe)") }),
        h("div", { class: "row" }, h("div", { style: { flex: "0 1 260px" } }, sel), h("div", { class: "grow" }, model, dl)), h("div", { class: "row" }, load, test, save))));
    }
    box.append(h("h3", { style: { marginTop: "1rem" }, text: "Modell je Aufgabe" }), tasks);
    // Ausweichliste
    const fbRows = h("div", { class: "stack" });
    const rows = (cfg.fallbacks.length ? cfg.fallbacks : []).map((f) => ({ ...f }));
    const paintFb = () => {
      clear(fbRows);
      rows.forEach((r, i) => {
        const sel = h("select", null, providerOptions(cfg.providers, r.provider)), m = h("input", { value: r.model || "", placeholder: "Modell" });
        sel.onchange = () => { r.provider = sel.value; const p = cfg.providers.find((x) => x.id === sel.value); m.value = r.model = (p && p.defaultModel) || ""; };
        m.oninput = () => { r.model = m.value; };
        fbRows.append(h("div", { class: "row" }, h("div", { style: { flex: "0 1 260px" } }, sel), h("div", { class: "grow" }, m), h("button", { class: "btn small danger", type: "button", onclick: () => { rows.splice(i, 1); paintFb(); } }, "Entfernen")));
      });
      if (rows.length < 3) fbRows.append(h("button", { class: "btn small", type: "button", onclick: () => { rows.push({ provider: "groq", model: "openai/gpt-oss-120b" }); paintFb(); } }, "+ Ausweichmodell"));
    };
    paintFb();
    box.append(h("h3", { style: { marginTop: "1rem" }, text: "Ausweichmodelle" }), h("p", { class: "hint", text: "Ist ein Kontingent erschöpft oder ein Modell nicht erreichbar, versucht die Plattform diese der Reihe nach; ganz zuletzt Cloudflare Workers AI." }), fbRows,
      h("div", { class: "row end" }, h("button", { class: "btn primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => { try { paint(await tapi("PUT", "/api/teacher/ai", { body: { fallbacks: rows } })); toast("Gespeichert.", "ok"); } catch (err) { errToast(err); } }) }, "Ausweichmodelle speichern")));
  };
  paint(ai);
  return box;
}

function connectorSection(mcp) {
  const box = h("section", { class: "card" });
  const paint = (m) => {
    clear(box).append(h("h2", { text: "Claude-Connector (Pro-Abo)" }),
      h("p", { class: "small", text: "Mit dem Connector arbeitet Claude in claude.ai direkt mit Ihren Sitzungen: Claude liest Fach, Klasse, Planung, Materialien und Schulportal-Eintrag und kann auf Ihren Wunsch Ergebnisse (Schulportal-Eintrag, Material, Feibeitsblatt-Entwurf, Planung) zurückspeichern. Das ist der von Anthropic vorgesehene, erlaubte Weg, Ihr Pro-Abo mit der Plattform zu verbinden – es entstehen keine API-Kosten." }),
      m.active ? h("p", null, h("span", { class: "badge ok", text: "Aktiv" }), " seit " + fmtTime(m.createdAt)) : h("p", { class: "muted", text: "Noch kein Connector eingerichtet." }),
      h("div", { class: "row" },
        h("button", { class: "btn primary", type: "button", onclick: async (e) => {
          const btn = e.currentTarget;   // nach einem await ist currentTarget leer
          if (m.active && !(await confirmDialog("Neue Connector-Adresse", "Die bisherige Adresse funktioniert danach nicht mehr. Sie müssen den Connector in claude.ai neu eintragen.", "Neue Adresse erzeugen"))) return;
          await busy(btn, async () => {
            try {
              const r = await tapi("POST", "/api/teacher/mcp");
              modal({ title: "Connector in claude.ai einrichten", body: (el) => el.append(
                h("div", { class: "notice warn" }, "Diese Adresse enthält Ihren geheimen Schlüssel. Sie wird nur jetzt angezeigt – geben Sie sie niemandem weiter."),
                h("div", { class: "field", style: { marginTop: ".8rem" } }, h("label", null, "Connector-Adresse"), h("input", { value: r.url, readonly: true, onfocus: (ev) => ev.target.select() })),
                h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: async () => toast((await copyText(r.url)) ? "Adresse kopiert." : "Bitte manuell kopieren.", "ok") }, "Adresse kopieren")),
                h("ol", { class: "small", style: { marginTop: ".8rem" } },
                  h("li", null, "claude.ai öffnen → Einstellungen bzw. „Anpassen“ → „Connectors“ → „Benutzerdefinierten Connector hinzufügen“."),
                  h("li", null, "Name: „Unterricks“, URL: die Adresse oben einfügen."),
                  h("li", null, "Authentifizierung: „Ohne Anmeldung“ (der Schlüssel steckt in der Adresse). Alternativ: Adresse " + r.headerUrl + " und als Anfrage-Header „Authorization: Bearer " + r.token.slice(0, 6) + "…“ (vollständiger Schlüssel = Teil nach /mcp/)."),
                  h("li", null, "In einem Chat das Werkzeug „Unterricks“ aktivieren und z. B. schreiben: „Lies meine Sitzung … mit get_lesson und entwickle die Stunde weiter.“")),
                h("p", { class: "hint", text: "Hinweis: Die Bezeichnungen der Menüs in claude.ai können sich ändern; maßgeblich ist die Hilfeseite „Get started with custom connectors using remote MCP“ von Anthropic." })),
                actions: [{ label: "Fertig", class: "primary" }] });
              paint({ active: true, createdAt: Date.now() });
            } catch (err) { errToast(err); }
          });
        } }, m.active ? "Neue Adresse erzeugen" : "Connector-Adresse erzeugen"),
        m.active ? h("button", { class: "btn danger", type: "button", onclick: async (e) => {
          const btn = e.currentTarget;   // nach einem await ist currentTarget leer
          if (!(await confirmDialog("Connector widerrufen", "Claude kann danach nicht mehr auf die Plattform zugreifen.", "Widerrufen", true))) return;
          await busy(btn, async () => { try { await tapi("DELETE", "/api/teacher/mcp"); paint({ active: false }); } catch (err) { errToast(err); } });
        } }, "Widerrufen") : null));
  };
  paint(mcp);
  return box;
}

function studentSection(sp) {
  const pw = h("input", { id: "spwset", value: sp.password, autocomplete: "off" });
  return h("section", { class: "card" }, h("h2", { text: "Schülerzugang" }),
    h("div", { class: "field" }, h("label", { for: "spwset" }, "Gemeinsames Passwort der Schüler:innen"), pw, h("p", { class: "hint", text: "Vorgabe: „Feindt“. Groß-/Kleinschreibung spielt keine Rolle. Nach zehn Fehlversuchen wird ein Gerät für eine Minute gesperrt." })),
    h("button", { class: "btn primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => { try { await tapi("PUT", "/api/teacher/student-settings", { body: { password: pw.value } }); toast("Gespeichert.", "ok"); } catch (err) { errToast(err); } }) }, "Speichern"));
}

function accountSection(me) {
  const u = h("input", { id: "cu", value: me.username, autocomplete: "username" }), o = h("input", { id: "co", type: "password", autocomplete: "current-password" });
  const n1 = h("input", { id: "cn1", type: "password", autocomplete: "new-password" }), n2 = h("input", { id: "cn2", type: "password", autocomplete: "new-password" });
  const devs = h("div", { class: "list" }, me.devices.map((d) => h("div", { class: "item" }, h("div", { class: "main" }, h("div", { class: "name", text: (d.current ? "Dieses Gerät · " : "") + (d.label || "Gerät").slice(0, 90) }), h("div", { class: "meta", text: "Zuletzt angemeldet: " + fmtTime(d.lastLogin) })))));
  return h("section", { class: "card" }, h("h2", { text: "Lehrkraft-Zugang" }),
    h("div", { class: "meta-grid" }, h("div", { class: "field full" }, h("label", { for: "cu" }, "Benutzername"), u), h("div", { class: "field full" }, h("label", { for: "co" }, "Bisheriges Passwort"), o),
      h("div", { class: "field" }, h("label", { for: "cn1" }, "Neues Passwort"), n1), h("div", { class: "field" }, h("label", { for: "cn2" }, "Neues Passwort wiederholen"), n2)),
    h("button", { class: "btn primary", type: "button", onclick: (e) => busy(e.currentTarget, async () => {
      try {
        if (n1.value.length < 10) throw new Error("Bitte ein neues Passwort mit mindestens 10 Zeichen wählen.");
        if (n1.value !== n2.value) throw new Error("Die neuen Passwörter stimmen nicht überein.");
        const s = await api("POST", "/api/teacher/salt", { body: { username: me.username } });
        const old = await deriveLogin(o.value, s.salt, s.iterations);
        const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
        const nw = await deriveLogin(n1.value, salt, 600000);
        // gespeicherte Feibeitsblatt-Verbindung mit dem Schlüssel aus dem neuen Passwort neu verschlüsseln (sonst ließe sie sich nicht mehr öffnen)
        let fbLink = null, hadLink = false;
        try { const l = await tapi("GET", "/api/teacher/fb-link"); if (l.link) { hadLink = true; const dd = await openLink(old.wrapKey, l.link); fbLink = await sealLink(nw.wrapKey, linkData(dd.api, dd.master)); dd.master.fill(0); } } catch {}
        const r = await tapi("POST", "/api/teacher/password", { body: { oldAuthKey: old.authKey, salt, authKey: nw.authKey, username: u.value, fbLink } });
        await useWrapKey(nw.wrapKey); fbAuto = null;
        o.value = n1.value = n2.value = "";
        toast("Zugangsdaten geändert. Andere Geräte wurden abgemeldet." + (r.fbLink ? " Die gespeicherte Feibeitsblatt-Verbindung bleibt erhalten." : hadLink ? " Die gespeicherte Feibeitsblatt-Verbindung ließ sich nicht übernehmen – bitte in einer Sitzung neu verbinden." : ""), "ok", 8000);
      } catch (err) { errToast(err); }
    }, "Speichere …") }, "Zugangsdaten ändern"),
    h("h3", { style: { marginTop: "1.2rem" }, text: "Bekannte Geräte" }), h("p", { class: "hint", text: "Auf diesen Geräten bleibt die Anmeldung möglich, auch wenn von fremden Geräten viele Fehlversuche kommen." }), devs,
    h("div", { class: "row", style: { marginTop: ".7rem" } }, h("button", { class: "btn danger", type: "button", onclick: async (e) => {
      const btn = e.currentTarget;   // nach einem await ist currentTarget leer
      if (!(await confirmDialog("Andere Geräte vergessen", "Alle anderen Geräte werden abgemeldet und gelten wieder als unbekannt.", "Vergessen", true))) return;
      await busy(btn, async () => { try { await tapi("POST", "/api/teacher/devices/forget"); toast("Erledigt.", "ok"); settingsPage(); } catch (err) { errToast(err); } });
    } }, "Alle anderen Geräte abmelden und vergessen")));
}

function fbSection() {
  const state = h("div", { class: "stack" }, h("p", { class: "small muted", text: "Prüfe die gespeicherte Verbindung …" }));
  const paint = () => {
    const lk = T.fbLink, at = lk.at ? " (gespeichert am " + fmtTime(lk.at) + ")" : "";
    const del = h("button", { class: "btn danger small", type: "button", onclick: async (e) => {
      const btn = e.currentTarget;   // nach einem await ist currentTarget leer
      if (!(await confirmDialog("Gespeicherte Verbindung löschen", "Danach müssen Sie Türcode und Feibeitsblatt-Passwort wieder eingeben – auf allen Geräten.", "Löschen", true))) return;
      await busy(btn, async () => { try { await fbForget(); toast("Gespeicherte Feibeitsblatt-Verbindung gelöscht.", "ok"); paint(); } catch (err) { errToast(err); } });
    } }, "Gespeicherte Verbindung löschen");
    const line = {
      saved: ["ok", "Verbindung verschlüsselt in Ihrem Benutzerkonto gespeichert" + at + " – Unterricks verbindet sich automatisch."],
      locked: ["warnc", "Verbindung gespeichert" + at + ", auf diesem Gerät aber noch nicht entsperrt – in einer Sitzung im Abschnitt „Feibeitsblatt“ einmal mit Ihrem Unterricks-Passwort entsperren."],
      invalid: ["warnc", lk.other ? "Die gespeicherte Verbindung gehört zu einem anderen Feibeitsblatt." : "Die gespeicherte Verbindung gilt nicht mehr (Feibeitsblatt-Passwort geändert?) – in einer Sitzung neu verbinden und speichern."],
      error: ["warnc", "Die gespeicherte Verbindung ließ sich gerade nicht prüfen: " + (lk.msg || "")],
      none: ["muted", "Keine Verbindung gespeichert."],
    }[lk.state];
    if (!line) return;
    clear(state).append(...nn(h("p", { class: "small " + line[0], text: line[1] }), lk.state !== "none" && lk.state !== "error" ? h("div", { class: "row" }, del) : null));
  };
  fbAutoConnect().then(paint, () => {});
  return h("section", { class: "card", id: "fbsettings" }, h("h2", { text: "Feibeitsblatt" }),
    h("p", { class: "small" }, "Schnittstelle: ", h("span", { class: "mono", text: T.config.feibeitsblattApi })), h("p", { class: "small" }, "Adresse für Schüler:innen: ", h("a", { href: T.config.feibeitsblattUrl, target: "_blank", rel: "noopener", text: T.config.feibeitsblattUrl })),
    state,
    h("p", { class: "hint", text: "Die Verbindung (Türcode + Feibeitsblatt-Passwort) stellen Sie einmalig in einer Sitzung im Abschnitt „Feibeitsblatt“ her. Gespeichert wird sie Ende-zu-Ende verschlüsselt: mit einem Schlüssel, der in Ihrem Browser aus Ihrem Unterricks-Passwort entsteht und den der Server nie sieht – gespeichert ist nur der daraus abgeleitete Feibeitsblatt-Schlüssel, nie ein Passwort. Auf jedem Gerät, auf dem Sie sich mit Ihrem Passwort anmelden, verbindet sich Unterricks danach automatisch; beim Abmelden vergisst das Gerät den Schlüssel. Der KI-Anbieter für die Rückmeldungen im Feibeitsblatt wird im Feibeitsblatt selbst eingestellt." }), notfallBox());
}

/* Einstellungen → Feibeitsblatt: Stand der Notfall-Feibeitsblätter bestehender Sitzungen (Nachholen im Hintergrund, notfallBackfill) */
function notfallBox() {
  const live = h("p", { class: "small", role: "status" }), prog = h("p", { class: "small muted notfall" }), fails = h("div");
  // aria-disabled statt disabled: der Knopf behält beim Klicken den Fokus (Tastatur, Screenreader)
  const btn = h("button", { class: "btn small", type: "button", onclick: () => { if (NF.state !== "running") notfallBackfill({ all: true }); } }, "Alle prüfen und aktualisieren");
  let shown = "";
  const paint = () => {
    const n = NF, running = n.state === "running", lk = T.fbLink.state;
    btn.setAttribute("aria-disabled", running ? "true" : "false");
    btn.textContent = running ? "Wird geprüft …" : "Alle prüfen und aktualisieren";
    const miss = n.failed.filter((x) => !x.had).length, upd = n.failed.length - miss, open = Math.max(0, n.missing - n.made);
    const text = running ? (n.all ? "Alle Notfall-Feibeitsblätter werden geprüft …" : "Fehlende Notfall-Feibeitsblätter werden ergänzt …")
      : n.state === "noconn" ? (n.made ? nfWord(n.made) + " ergänzt. " : "") + (open ? nfWord(open) + " für bestehende Sitzungen " + nfVerb(open, "fehlt", "fehlen") + " noch. " : "") +
        "Notfall-Feibeitsblätter entstehen automatisch, sobald Unterricks mit Feibeitsblatt verbunden ist" +
        (lk === "locked" ? " – dafür die gespeicherte Verbindung auf diesem Gerät einmal entsperren (in einer Sitzung im Abschnitt „Feibeitsblatt“)."
          : lk === "none" || lk === "invalid" ? " – die Verbindung einmalig in einer Sitzung im Abschnitt „Feibeitsblatt“ herstellen und speichern."
          : lk === "error" ? " – Feibeitsblatt war gerade nicht erreichbar; „Alle prüfen und aktualisieren“ versucht es erneut." : ".")
      : n.state === "error" ? "Die Notfall-Feibeitsblätter ließen sich gerade nicht prüfen: " + n.msg
      : n.state === "done" ? (!n.count ? "Keine Feibeitsblätter, die ein Notfall-Feibeitsblatt bekommen (das Finale eines Escape-Rooms und die Jahrgänge 5 und 6 sind ausgenommen)."
        : (n.made ? nfWord(n.made) + (n.all ? " aktualisiert. " : " ergänzt. ") : "") +
          (miss ? nfWord(miss) + " " + nfVerb(miss, "fehlt", "fehlen") + " noch (siehe unten). " : "") +
          (upd ? nfWord(upd) + " " + nfVerb(upd, "ließ", "ließen") + " sich nicht aktualisieren – " + nfVerb(upd, "das bisherige bleibt", "die bisherigen bleiben") + " im Material (siehe unten). " : "") +
          (n.failed.length ? "" : n.all ? "Alle Notfall-Feibeitsblätter sind aktuell." : "Alle verknüpften Feibeitsblätter haben ein Notfall-Feibeitsblatt."))
      : "Notfall-Feibeitsblätter werden geprüft …";
    if (text.trim() !== shown) { live.textContent = text.trim(); live.className = "small" + (n.state === "error" || (n.state === "done" && n.failed.length) ? " warnc" : n.state === "done" ? " ok" : ""); shown = text.trim(); }
    clear(prog); prog.classList.toggle("hidden", !running);   // .notfall setzt display: flex – das hidden-Attribut wirkte nicht
    if (running) prog.append(h("span", { class: "spin", "aria-hidden": "true" }), (n.total ? Math.min(n.done, n.total) + " von " + n.total + " · " : "") + (n.step || ""));
    clear(fails);
    if (!running && n.failed.length) fails.append(h("ul", { class: "small" }, n.failed.slice(0, 50).map((x) => h("li", null,
      h("a", { href: "#/lk/s/" + x.lessonId, text: x.lessonTitle || "Sitzung" }), " (" + classShort(x.klass) + (x.date ? ", " + fmtDay(x.date) : "") + ") – „" + (x.title || "Feibeitsblatt") + "“ (" + formatCode(x.code) + ")" +
        (x.had ? ", bisheriges bleibt" : "") + ": " + x.msg)).concat(n.failed.length > 50 ? [h("li", { text: "… und " + (n.failed.length - 50) + " weitere" })] : [])),
      h("p", { class: "hint", text: "Wurde ein Feibeitsblatt im Feibeitsblatt gelöscht, entfernen Sie es in der Sitzung (Abschnitt „Feibeitsblatt“) – dann verschwindet auch der Eintrag hier." }));
  };
  onLeave(onNotfallProgress(paint));
  paint();
  return h("div", { class: "stack", style: { marginTop: "1rem" } }, h("h3", { text: "Notfall-Feibeitsblätter bestehender Sitzungen" }), live, prog, fails, h("div", { class: "row" }, btn),
    h("p", { class: "hint", text: "Fehlende Notfall-Feibeitsblätter ergänzt Unterricks automatisch in Ihrem Browser, sobald Sie angemeldet und mit Feibeitsblatt verbunden sind – auch für Sitzungen, deren Feibeitsblätter schon vorher verknüpft waren. Lassen Sie Unterricks dafür geöffnet, bis hier „Alle verknüpften Feibeitsblätter haben ein Notfall-Feibeitsblatt.“ steht; ein unterbrochener Lauf geht beim nächsten Öffnen weiter. Die Schüler:innen finden sie im Kästchen „Notfall-Feibeitsblätter“ ganz unten. „Alle prüfen und aktualisieren“ erneuert zusätzlich veraltete, z. B. nach dem Bestätigen der Checkliste (dann mit QR-Code). Nicht für das Finale eines Escape-Rooms und nicht in den Jahrgängen 5 und 6." }));
}

/* ---------- PDF-Datei in einem neuen Tab öffnen (#/lk/datei/<id>, z. B. aus dem Verlaufsplan der Grundschule) ----------
 * Ein echter Link (target _blank) statt window.open: kein Pop-up-Blocker, langes Drücken am iPad geht, und auf GitHub Pages führt er über den
 * signierten Link zum Worker (apiUrl). */
export async function fileOpenPage(id) {
  const st = h("p", { role: "status", text: "Die PDF wird geöffnet …" });
  const main = h("main", { class: "narrow" }, pageHead({ title: "PDF öffnen" }), st);
  render(teacherBar(null), main);
  try { const r = await tapi("POST", "/api/teacher/files/" + id + "/link", { body: { inline: true } }); location.replace(apiUrl(r.url)); }
  catch (e) { stateLine(st, e.message, "err"); main.append(h("p", { class: "small muted", text: "Sie können diesen Tab schließen." })); }
}
/* Vorschau der Elternansicht – folgt mit der Elternansicht (Platzhalter, damit der Link „Elternansicht ausprobieren“ nicht ins Leere führt) */
function parentsPreviewStub(id) {
  render(teacherBar("primary"), h("main", { class: "narrow" }, pageHead({ fach: "gs", title: "Elternansicht (Vorschau)" }),
    h("p", { class: "notice", text: "Die Vorschau der Elternansicht ist noch nicht freigeschaltet. Sobald es sie gibt, sehen Sie hier, was Eltern zu dieser Sitzung nach dem Unterricht sehen." }),
    h("a", { class: "btn", href: "#/lk/s/" + id }, "Zur Sitzung")));
}

/* ---------- Router der Lehrkräfteansicht ---------- */
export async function route(hash) {
  await config();
  if (hash === "#/lehrkraft") return loginPage();
  if (!T.token) return go("#/lehrkraft");
  notfallBackfill();   // Notfall-Feibeitsblätter bestehender Sitzungen (einmal je Seitenaufruf, im Hintergrund)
  let m;
  if (hash === "#/lk" || hash === "#/lk/") return subjectsPage();
  if (hash === "#/lk/einstellungen") return settingsPage();
  if ((m = /^#\/lk\/f\/([a-z]+)$/.exec(hash))) return classesPage(m[1]);
  if ((m = /^#\/lk\/f\/([a-z]+)\/([A-Z0-9-]{2,5})$/.exec(hash))) return lessonsPage(m[1], m[2]);
  if ((m = /^#\/lk\/s\/([a-f0-9]{16})$/.exec(hash))) return (await import("./session.js")).sessionPage(m[1]);
  if ((m = /^#\/lk\/u\/([a-f0-9]{16})$/.exec(hash))) return (await import("./units.js")).unitPage(m[1]);
  if ((m = /^#\/lk\/escape\/([a-f0-9]{16})$/.exec(hash))) return (await import("./escape.js")).escapePage(m[1], { teacher: true });
  if (hash === "#/lk/grundschule" || hash === "#/lk/grundschule/") return (await import("./grundschule.js")).gsOverviewPage();
  if ((m = /^#\/lk\/grundschule\/k\/(gs[a-f0-9]{8})$/.exec(hash))) return (await import("./grundschule.js")).gsCoursePage(m[1]);
  if ((m = /^#\/lk\/grundlage\/([a-f0-9]{16})$/.exec(hash))) return (await import("./bases.js")).baseDocPage(m[1]);
  if ((m = /^#\/lk\/datei\/([a-f0-9]{16})$/.exec(hash))) return fileOpenPage(m[1]);
  if ((m = /^#\/lk\/eltern\/([a-f0-9]{16})(?:\/([a-f0-9]{16}))?$/.exec(hash))) return parentsPreviewStub(m[1]);
  if (hash === "#/lk/grundlagen") return (await import("./bases.js")).basesOverview();
  if ((m = /^#\/lk\/grundlagen\/([a-z]+)$/.exec(hash))) return (await import("./bases.js")).basesPage(m[1]);
  go("#/lk");
}
