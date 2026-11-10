// teacher.js – Lehrkräfteansicht: Anmeldung/Einrichtung, Fach- und Klassenauswahl, Sitzungslisten, Einstellungen.
import { h, clear, store, deviceId, api, toast, errToast, busy, modal, confirmDialog, copyText, fmtDate, fmtTime, topbar, nn } from "./ui.js";
import { render, go, onLeave } from "./app.js";
import { SUBJECTS, subjectName, gradeInfo, isValidClass, isValidSubject, formatCode, fmtDay, classGroupsFor, classAllowed, classShort, gradeKey, isAnalogClass, ANALOG_RULE } from "./shared.js";
import { missingFor } from "./bases-detect.js";
import { portalPreview } from "./portalview.js";
import { FbClient } from "./fbclient.js";

export const T = {
  get token() { return store.get("u.ttoken"); },
  set token(v) { if (v) store.set("u.ttoken", v); else store.del("u.ttoken"); },
  config: null, fb: null,
};
export async function tapi(method, path, o = {}) {
  try { return await api(method, path, { ...o, token: T.token }); }
  catch (e) { if (e.status === 401 && path !== "/api/teacher/login") { T.token = null; go("#/lehrkraft"); } throw e; }
}
export async function config() {
  if (!T.config) { try { T.config = await api("GET", "/api/config"); } catch { T.config = { feibeitsblattApi: "https://feibeitsblatt.feindt.workers.dev", feibeitsblattUrl: "https://feibeitsblatt.janrickmer.de/" }; } }
  if (!T.fb) T.fb = new FbClient(T.config.feibeitsblattApi);
  return T.config;
}

/* PBKDF2 im Browser (600 000 Iterationen): der Server sieht nie das Passwort */
const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s) => { const t = s.replace(/-/g, "+").replace(/_/g, "/"); const bin = atob(t + "===".slice((t.length + 3) % 4)); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); };
async function deriveAuth(password, saltB64u, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64u(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64u(saltB64u), iterations }, key, 256));
}

export function teacherBar(active) {
  const link = (href, label, key) => h("a", { href, "aria-current": active === key ? "page" : null }, label);
  return topbar({ home: "#/lk" }, [link("#/lk", "Unterricht", "lessons"), link("#/lk/grundlagen", "Planungsgrundlagen", "bases"), link("#/lk/einstellungen", "Einstellungen", "settings"),
    h("button", { type: "button", onclick: logout }, "Abmelden")]);
}
async function logout() {
  try { await tapi("POST", "/api/teacher/logout"); } catch {}
  T.token = null; if (T.fb) T.fb.disconnect(); go("#/lehrkraft");
}

/* ---------- Anmeldung / Einrichtung ---------- */
async function loginPage() {
  if (T.token) { try { await tapi("GET", "/api/teacher/me"); return go("#/lk"); } catch {} }
  const wrap = h("div", { class: "login-wrap" });
  render(wrap, h("footer", { class: "footer" }, h("a", { href: "#/" }, "Zur Schüleransicht")));
  let st;
  try { st = await api("POST", "/api/teacher/status"); } catch (e) { wrap.append(h("p", { class: "err", text: e.message })); return; }
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
          const authKey = await deriveAuth(pw.value, salt, 600000);
          const r = await api("POST", "/api/teacher/setup", { body: { username: user.value, salt, iterations: 600000, authKey, deviceId: deviceId(), setupCode: sc.value || undefined } });
          T.token = r.token; toast("Ihr Lehrkraft-Zugang ist eingerichtet.", "ok"); go("#/lk");
        } else {
          const s = await api("POST", "/api/teacher/salt", { body: { username: user.value } });
          const authKey = await deriveAuth(pw.value, s.salt, s.iterations);
          const r = await api("POST", "/api/teacher/login", { body: { username: user.value, authKey, deviceId: deviceId() } });
          T.token = r.token; go("#/lk");
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
  setTimeout(() => user.focus(), 50);
}

/* ---------- Übersicht: Fach → Klasse → Sitzungen ---------- */
async function loadLessons() { return (await tapi("GET", "/api/teacher/lessons")).lessons; }

async function subjectsPage() {
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("lessons"), main);
  let all; try { all = await loadLessons(); } catch (e) { clear(main).append(h("p", { class: "err", text: e.message })); return; }
  clear(main).append(...nn(h("h1", { text: "Welches Fach unterrichten Sie?" }),
    h("div", { class: "tiles" }, SUBJECTS.map((s) => {
      const n = all.filter((l) => l.subject === s.id).length;
      return h("a", { class: "tile", href: "#/lk/f/" + s.id }, h("div", { class: "t", text: s.name }), h("div", { class: "s", text: n ? n + " Sitzung" + (n === 1 ? "" : "en") : "Noch keine Sitzungen" }));
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
  clear(main).append(h("div", { class: "crumbs" }, h("a", { href: "#/lk" }, "Fächer"), "›", h("span", { text: subjectName(subject) })),
    h("h1", { text: "In welcher Klasse bzw. welchem Kurs unterrichten Sie " + subjectName(subject) + "?" }),
    h("div", { class: "card" }, classGroupsFor(cfg).map((g) => h("div", { class: "class-group" }, h("h3", { text: g.label }),
      notes[g.key] ? h("p", { class: "hint", text: notes[g.key] }) : null,
      h("div", { class: "class-grid" + (g.key === "Q" ? " q" : "") }, g.classes.map((k) => { const n = all.filter((l) => l.klass === k).length; return h("a", { class: "class-btn", href: "#/lk/f/" + subject + "/" + k }, classShort(k), n ? h("span", { class: "n", text: String(n) }) : null); }))))),
    h("p", { class: "hint" }, "Angezeigt werden die Jahrgänge, in denen " + subjectName(subject) + " laut Fach-Einstellungen unterrichtet wird (", h("a", { href: "#/lk/grundlagen/" + subject }, "ändern"), ")."));
}

function lessonList(lessons, showContext) {
  const list = h("div", { class: "list" });
  if (!lessons.length) list.append(h("p", { class: "muted", text: "Noch keine Sitzungen." }));
  for (const l of lessons) list.append(h("a", { class: "item", href: "#/lk/s/" + l.id },
    h("div", { class: "main" }, h("div", { class: "name", text: l.title }),
      h("div", { class: "meta", text: [showContext ? subjectName(l.subject) + " · " + classShort(l.klass) : null, l.date ? fmtDay(l.date) : "ohne Datum", showContext ? l.topic || null : null, l.durationMin ? l.durationMin + " min" : null].filter(Boolean).join(" · ") })),
    h("div", { class: "row" }, l.substitute === "aktiv" ? h("span", { class: "badge", style: { color: "var(--warn)" }, text: "Vertretung aktiv" }) : l.substitute === "vorschlag" ? h("span", { class: "badge", text: "Vertretungsvorschlag" }) : null,
      l.hasStop ? h("span", { class: "badge", style: { color: "var(--warn)" }, text: "⏸ Zwischenstopp" }) : null, l.hasHomework ? h("span", { class: "badge", text: "Hausaufgabe" }) : null,
      l.hasPortal ? h("span", { class: "badge ok", text: "Schulportal ✓" }) : null, h("span", { class: "badge", text: l.studentCount + " SuS" }), h("span", { class: "badge mono", text: formatCode(l.code) }))));
  return list;
}

async function lessonsPage(subject, klass) {
  if (!isValidSubject(subject) || !isValidClass(klass)) return go("#/lk");
  const main = h("main", null, h("div", { class: "skeleton", text: "Lade …" }));
  render(teacherBar("lessons"), main);
  let list, units, cfg, bases;
  try {
    [list, units, cfg, bases] = await Promise.all([
      tapi("GET", "/api/teacher/lessons?subject=" + subject + "&klass=" + klass).then((r) => r.lessons),
      tapi("GET", "/api/teacher/units?subject=" + subject + "&klass=" + klass).then((r) => r.units),
      subjectConfigs().then((c) => c[subject]),
      tapi("GET", "/api/teacher/bases?subject=" + subject).then((r) => r.bases)]);
  } catch (e) { clear(main).append(h("p", { class: "err", text: e.message })); return; }
  const name = subjectName(subject), gk = gradeKey(klass);
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
  clear(main).append(...nn(h("div", { class: "crumbs" }, h("a", { href: "#/lk" }, "Fächer"), "›", h("a", { href: "#/lk/f/" + subject }, name), "›", h("span", { text: classShort(klass) })),
    h("h1", { text: name + " · " + classShort(klass) }), h("p", { class: "muted", text: gradeInfo(klass).text }),
    (cfg.gradeNotes || {})[gk] ? h("div", { class: "notice", style: { marginBottom: ".8rem" } }, h("strong", { text: "Hinweis: " }), cfg.gradeNotes[gk]) : null,
    isAnalogClass(klass) ? h("div", { class: "notice warn", style: { marginBottom: ".8rem" } }, "Jahrgang " + gk + ": " + ANALOG_RULE) : null,
    missing.length ? h("div", { class: "notice warn", style: { marginBottom: ".8rem" } }, "Für die Planung fehlt noch: " + missing.join("; ") + ". ", h("a", { href: "#/lk/grundlagen/" + subject }, "Planungsgrundlagen hochladen"))
      : subject !== "powi" && !cfg.complete ? h("div", { class: "notice", style: { marginBottom: ".8rem" } }, "Bitte prüfen Sie, ob alle Vorgaben für " + name + " hochgeladen sind, und bestätigen Sie die Vollständigkeit. ", h("a", { href: "#/lk/grundlagen/" + subject }, "Planungsgrundlagen")) : null,
    h("div", { class: "session-grid" }, unitBox, h("div", { class: "side" }, stopNote, form))));
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
  clear(main).append(h("h1", { text: "Einstellungen" }));
  main.append(aiSection(ai), connectorSection(mcp), studentSection(sp), accountSection(me), fbSection());
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
          if (m.active && !(await confirmDialog("Neue Connector-Adresse", "Die bisherige Adresse funktioniert danach nicht mehr. Sie müssen den Connector in claude.ai neu eintragen.", "Neue Adresse erzeugen"))) return;
          await busy(e.currentTarget, async () => {
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
          if (!(await confirmDialog("Connector widerrufen", "Claude kann danach nicht mehr auf die Plattform zugreifen.", "Widerrufen", true))) return;
          await busy(e.currentTarget, async () => { try { await tapi("DELETE", "/api/teacher/mcp"); paint({ active: false }); } catch (err) { errToast(err); } });
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
        const oldAuthKey = await deriveAuth(o.value, s.salt, s.iterations);
        const salt = b64u(crypto.getRandomValues(new Uint8Array(16)));
        await tapi("POST", "/api/teacher/password", { body: { oldAuthKey, salt, authKey: await deriveAuth(n1.value, salt, 600000), username: u.value } });
        o.value = n1.value = n2.value = ""; toast("Zugangsdaten geändert. Andere Geräte wurden abgemeldet.", "ok");
      } catch (err) { errToast(err); }
    }, "Speichere …") }, "Zugangsdaten ändern"),
    h("h3", { style: { marginTop: "1.2rem" }, text: "Bekannte Geräte" }), h("p", { class: "hint", text: "Auf diesen Geräten bleibt die Anmeldung möglich, auch wenn von fremden Geräten viele Fehlversuche kommen." }), devs,
    h("div", { class: "row", style: { marginTop: ".7rem" } }, h("button", { class: "btn danger", type: "button", onclick: async (e) => {
      if (!(await confirmDialog("Andere Geräte vergessen", "Alle anderen Geräte werden abgemeldet und gelten wieder als unbekannt.", "Vergessen", true))) return;
      await busy(e.currentTarget, async () => { try { await tapi("POST", "/api/teacher/devices/forget"); toast("Erledigt.", "ok"); settingsPage(); } catch (err) { errToast(err); } });
    } }, "Alle anderen Geräte abmelden und vergessen")));
}

function fbSection() {
  return h("section", { class: "card" }, h("h2", { text: "Feibeitsblatt" }),
    h("p", { class: "small" }, "Schnittstelle: ", h("span", { class: "mono", text: T.config.feibeitsblattApi })), h("p", { class: "small" }, "Adresse für Schüler:innen: ", h("a", { href: T.config.feibeitsblattUrl, target: "_blank", rel: "noopener", text: T.config.feibeitsblattUrl })),
    h("p", { class: "hint", text: "Die Verbindung (Türcode + Feibeitsblatt-Passwort) stellen Sie in einer Sitzung im Abschnitt „Feibeitsblatt“ her; sie gilt bis zum Abmelden bzw. Neuladen der Seite. Der KI-Anbieter für die Rückmeldungen im Feibeitsblatt wird im Feibeitsblatt selbst eingestellt." }));
}

/* ---------- Router der Lehrkräfteansicht ---------- */
export async function route(hash) {
  await config();
  if (hash === "#/lehrkraft") return loginPage();
  if (!T.token) return go("#/lehrkraft");
  let m;
  if (hash === "#/lk" || hash === "#/lk/") return subjectsPage();
  if (hash === "#/lk/einstellungen") return settingsPage();
  if ((m = /^#\/lk\/f\/([a-z]+)$/.exec(hash))) return classesPage(m[1]);
  if ((m = /^#\/lk\/f\/([a-z]+)\/([A-Z0-9-]{2,5})$/.exec(hash))) return lessonsPage(m[1], m[2]);
  if ((m = /^#\/lk\/s\/([a-f0-9]{16})$/.exec(hash))) return (await import("./session.js")).sessionPage(m[1]);
  if ((m = /^#\/lk\/u\/([a-f0-9]{16})$/.exec(hash))) return (await import("./units.js")).unitPage(m[1]);
  if ((m = /^#\/lk\/escape\/([a-f0-9]{16})$/.exec(hash))) return (await import("./escape.js")).escapePage(m[1], { teacher: true });
  if (hash === "#/lk/grundlagen") return (await import("./bases.js")).basesOverview();
  if ((m = /^#\/lk\/grundlagen\/([a-z]+)$/.exec(hash))) return (await import("./bases.js")).basesPage(m[1]);
  go("#/lk");
}
