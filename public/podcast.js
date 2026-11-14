// podcast.js – „Podcast für den kommenden Unterricht“ (Nachtrag 22) auf beiden Startseiten der Lehrkraft (Gymnasium und Übersicht „Grundschule“),
// direkt unter dem Wochenkalender. Ein Podcast deckt alle Sitzungen eines Tages beider Schulformen ab und ist auf beiden Seiten derselbe.
//   Knopf „Podcast für den kommenden Unterricht entwickeln“ → Prüfung (GET /api/teacher/podcast/plan): steht heute noch Unterricht bevor, fragt ein
//   Dialog „heute oder nächster Schultag?“, sonst gilt der nächste Schultag → Karte mit den Sitzungen, „Auftrag für Claude in Chrome kopieren“ (der Auftrag
//   steht nur in der Zwischenablage – eine Webseite gibt Claude nie selbst einen Auftrag), drei Schritten und dem Ablagefeld für die Datei aus Gemini
//   Notebook; „Ohne Claude (z. B. am iPad)“ mit Quelltext und Steueranweisung zum einzelnen Kopieren.
//   Liegt ein Podcast für heute oder später, steht dort der Player („Abspielen“, „Pause“, Spulen, Zeitangabe) statt des Knopfes.
import { h, clear, icon, apiUrl, copyText, confirmDialog, modal, ApiError, fmtBytes } from "./ui.js";
import { onLeave } from "./app.js";
import { tapi, T } from "./teacher.js";
import { berlinToday, addDays } from "./shared.js";
import * as P from "./podcastlib.js";

export const GO_LABEL = "Podcast für den kommenden Unterricht entwickeln";
export const COPY_LABEL = "Auftrag für Claude in Chrome kopieren";
export const DROP_LABEL = "Podcast-Datei hier ablegen oder auswählen";
const ACCEPT = "audio/*,.m4a,.mp4,.wav,.mp3,.aac,.ogg,.oga,.opus,.webm";

/* Hochladen mit Fortschritt (XMLHttpRequest – fetch meldet keinen Upload-Fortschritt), abbrechbar */
function xhrUpload(path, file, type, onProgress) {
  let x = null;
  const promise = new Promise((resolve, reject) => {
    x = new XMLHttpRequest();
    x.open("POST", apiUrl(path));
    if (T.token) x.setRequestHeader("Authorization", "Bearer " + T.token);
    x.setRequestHeader("Content-Type", type);
    x.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
    x.onload = () => {
      let d = null; try { d = JSON.parse(x.responseText); } catch {}
      if (x.status >= 200 && x.status < 300 && d && d.ok) resolve(d);
      else reject(new ApiError((d && d.error) || (x.status === 413 ? "Die Datei ist zu groß." : "Hochladen fehlgeschlagen (Fehler " + x.status + ")."), x.status, d));
    };
    x.onerror = () => reject(new ApiError("Keine Verbindung zum Server. Bitte Internetverbindung prüfen.", 0));
    x.onabort = () => { const e = new Error("abgebrochen"); e.name = "AbortError"; reject(e); };
    x.send(file);
  });
  return { promise, abort: () => { try { if (x) x.abort(); } catch {} } };
}
/* Ein- und Ausgänge, die Unit-Tests ersetzen */
export const io = {
  now: () => Date.now(),
  copy: (t) => copyText(t),
  audio: () => new Audio(),
  head: async (file) => new Uint8Array(await file.slice(0, 64).arrayBuffer()),
  upload: xhrUpload,
};

/* Knopf während einer Aktion sperren, ohne ihm den Fokus zu nehmen (aria-disabled statt disabled) */
async function working(btn, fn, label) {
  if (btn.getAttribute("aria-disabled") === "true") return undefined;
  const old = Array.from(btn.childNodes);
  btn.setAttribute("aria-disabled", "true"); btn.setAttribute("aria-busy", "true");
  clear(btn).append(h("span", { class: "spin", "aria-hidden": "true" }), label);
  try { return await fn(); }
  finally { btn.removeAttribute("aria-disabled"); btn.removeAttribute("aria-busy"); clear(btn).append(...old); }
}
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);
const liveSessions = (plan) => (plan && Array.isArray(plan.sessions) ? plan.sessions.filter((s) => !s.substitute) : []);
const when = (s) => (s.startTime ? Number(s.startTime.slice(0, 2)) + ":" + s.startTime.slice(3) + " " : "") + (s.school === "gs" ? "Grundschule " : "") + s.label;

/* Dialog „Für welchen Unterricht ist der Podcast gedacht?“ → der gewählte Plan oder null */
export function askDay(todayPlan, nextPlan, now = io.now()) {
  return new Promise((resolve) => {
    let done = false;
    const coming = liveSessions(todayPlan).filter((s) => P.upcomingToday([s], todayPlan.date, now)).length, nextN = liveSessions(nextPlan).length;
    const choice = (cls, label, sub, plan, close) => h("button", { class: "btn big pc-choice" + cls, type: "button", onclick: () => { done = true; resolve(plan); close(); } },
      h("span", { class: "pc-cl", text: label }), h("span", { class: "pc-cs", text: sub }));
    modal({ title: "Für welchen Unterricht ist der Podcast gedacht?", onClose: () => { if (!done) resolve(null); },
      body: (el, close) => el.append(
        h("p", { class: "small", text: "Heute steht noch Unterricht bevor. Wählen Sie den Tag, dessen Ablauf der Podcast erklären soll." }),
        h("div", { class: "pc-choices" },
          choice(" primary", "Heute, " + P.podcastDayShort(todayPlan.date), "noch " + plural(coming, "Stunde", "Stunden"), todayPlan, close),
          choice("", "Nächster Schultag, " + P.podcastDayShort(nextPlan.date), nextN ? plural(nextN, "Stunde", "Stunden") : "noch keine Sitzung angelegt", nextPlan, close))),
      actions: [{ label: "Abbrechen" }] });
  });
}

/* Das Feld unter dem Wochenkalender. load() → Promise mit der Antwort von GET /api/teacher/podcast. Nach dem Aufbau der Seite anlegen (meldet sich
   mit onLeave ab). */
export function podcastCard(load = () => tapi("GET", "/api/teacher/podcast")) {
  const root = h("section", { class: "podcast loading", "aria-label": "Podcast für den kommenden Unterricht", "aria-busy": "true" });
  let run = 0, stopped = false, today = berlinToday(io.now()), podcasts = [], mode = "loading", cleanups = [], listErr = "";
  // Zustandswechsel: was in dieser Form lief (Audio, Hochladen, Zuhörer an der Seite), endet; war der Fokus im Feld, geht er an focusEl des neuen Zustands
  function swap(cls, build) {
    const had = root.contains(document.activeElement);
    for (const fn of cleanups.splice(0)) { try { fn(); } catch {} }
    clear(root); root.className = cls; root.removeAttribute("aria-busy");
    const focusEl = build();
    if (had && focusEl && root.isConnected && (!document.activeElement || document.activeElement === document.body)) focusEl.focus();
  }
  const paintIdle = () => (podcasts.length ? showPlayers() : showButton());
  // Statuszeile erst einblenden, dann füllen – sonst sagt ein Screenreader die Meldung nicht an
  const announce = (el, text) => { if (text) setTimeout(() => { if (el.isConnected && !el.textContent) el.textContent = text; }, 60); };

  /* ---------- Knopf ---------- */
  function showButton(note = "") {
    mode = "button";
    swap("podcast", () => {
      const btn = h("button", { class: "btn big pc-go", type: "button", onclick: () => start(btn, status) }, icon("headphones"), GO_LABEL);
      const status = h("p", { class: "pc-status", role: "status" });
      root.append(btn, status);
      announce(status, note || listErr);
      return btn;
    });
  }
  /* Klick: Grundlage holen, Tag wählen (Dialog nur, wenn heute noch Unterricht bevorsteht), Karte zeigen */
  async function start(btn, status) {
    status.textContent = "";
    let r;
    try { r = await working(btn, () => tapi("GET", "/api/teacher/podcast/plan"), "Prüfe den Unterricht …"); }
    catch (e) { if (btn.isConnected) status.textContent = "Der Unterricht ließ sich nicht prüfen: " + ((e && e.message) || e); return; }
    if (!r || stopped || !btn.isConnected) return;
    const ch = P.podcastChoice(r, io.now());
    let plan = ch.plan;
    if (ch.ask) { plan = await askDay(ch.today, ch.next); if (!plan || stopped || !btn.isConnected) return; }
    if (!plan) { status.textContent = "In den nächsten Wochen ist kein Unterricht geplant – für einen Podcast braucht Unterricks einen Tag mit Unterricht."; return; }
    showPrep(plan);
  }

  /* ---------- Karte: Grundlage, Auftrag, Ablagefeld ---------- */
  function showPrep(plan) {
    mode = "prep";
    swap("card podcast pc-prep", () => {
      const src = P.podcastSource(plan), task = P.podcastTask(plan.date, src.text);
      const isToday = plan.date === today, isNext = !isToday && plan.date === addDays(today, 1);
      const head = h("h2", { id: "pc-h", tabindex: "-1", text: "Podcast für den Unterricht am " + P.podcastDayLong(plan.date) });
      const top = h("div", { class: "pc-head" }, h("span", { class: "pc-ico", "aria-hidden": "true" }, icon("headphones")),
        h("div", { class: "pc-tt" }, head, h("p", { class: "pc-day", text: (isToday ? "Für heute: alle" : isNext ? "Für morgen: alle" : "Alle") +
          " Stunden des Tages beider Schulformen, in der Reihenfolge, in der Sie unterrichten." })));
      root.setAttribute("aria-labelledby", "pc-h"); root.removeAttribute("aria-label");
      cleanups.push(() => { root.removeAttribute("aria-labelledby"); root.setAttribute("aria-label", "Podcast für den kommenden Unterricht"); });
      const cancel = h("button", { class: "btn ghost pc-cancel", type: "button", onclick: () => paintIdle() }, "Abbrechen");
      root.append(top);
      const used = src.used, all = Array.isArray(plan.sessions) ? plan.sessions : [];
      if (!all.length) {
        root.append(h("p", { class: "pc-empty", text: "Am " + P.podcastDayNum(plan.date) + ", ist laut Stundenplan Unterricht, aber noch keine Sitzung angelegt. Der Podcast entsteht aus den Sitzungen – legen Sie sie zuerst in der Unterrichtseinheit an und planen Sie sie." }),
          h("div", { class: "row pc-foot" }, cancel));
        return head;
      }
      // Sitzungen in Unterrichtsreihenfolge: Kopfzeile wie in der Zusammenfassung (Link zur Sitzung) und woraus der Podcast ihren Ablauf nimmt
      const kindOf = new Map(used.map((u) => [u.s.id, u]));
      root.append(h("h3", { class: "pc-sub", text: "Sitzungen dieses Tages" }), h("ol", { class: "pc-sessions" }, all.map((s) => {
        const u = kindOf.get(s.id), kind = u ? u.kind : "substitute";
        const badge = kind === "summary" ? h("span", { class: "badge ok", text: "Zusammenfassung" }) : kind === "fallback" ? h("span", { class: "badge", text: "Ersatz aus der Planung" })
          : kind === "empty" ? h("span", { class: "badge", text: "noch nicht geplant" }) : h("span", { class: "badge ink", text: "Vertretung – nicht im Podcast" });
        const notes = [s.summaryOutdated && kind === "summary" ? "Die Zusammenfassung beschreibt eine frühere Planung – bei Bedarf in der Sitzung anpassen." : null,
          u && u.cut ? "Für den Podcast gekürzt." : null].filter(Boolean);
        return h("li", null, h("a", { href: "#/lk/s/" + s.id, class: "pc-sl" }, s.head, s.title ? h("span", { class: "pc-st", text: " – " + s.title }) : null), " ", badge,
          notes.length ? h("span", { class: "pc-sn", text: notes.join(" ") }) : null);
      })));
      const fb = used.filter((u) => u.kind === "fallback"), empty = used.filter((u) => u.kind === "empty");
      if (fb.length) {
        const gym = fb.some((u) => u.s.school !== "gs"), gs = fb.some((u) => u.s.school === "gs");
        root.append(h("p", { class: "pc-note", text: "Für " + plural(fb.length, "Sitzung", "Sitzungen") + " gibt es noch keine Zusammenfassung – Unterricks nimmt dafür Thema und " +
          (gym && gs ? "Schulportal-Eintrag bzw. Verlaufsplan" : gs ? "Verlaufsplan" : "Schulportal-Eintrag") + ": " + fb.map((u) => when(u.s)).join(", ") + "." }));
      }
      if (empty.length) root.append(h("p", { class: "pc-note", text: "Noch nichts geplant: " + empty.map((u) => when(u.s)).join(", ") + " – der Podcast nennt für " + (empty.length === 1 ? "diese Stunde" : "diese Stunden") + " nur das Thema." }));
      if (!used.length || used.every((u) => u.kind === "empty")) {
        root.append(h("p", { class: "pc-empty", text: used.length ? "Für diesen Tag ist noch nichts geplant. Der Podcast entsteht aus den Zusammenfassungen der Sitzungen – planen Sie die Stunden zuerst." : "An diesem Tag gilt für alle Sitzungen eine bestätigte Vertretung – es gibt nichts für einen Podcast." }),
          h("div", { class: "row pc-foot" }, cancel));
        return head;
      }
      if (podcasts.some((p) => p.day === plan.date)) root.append(h("p", { class: "pc-note", text: "Für diesen Tag gibt es schon einen Podcast – eine neue Datei ersetzt ihn." }));
      // 1) Auftrag kopieren
      const copied = h("p", { class: "pc-status", role: "status" });
      const copyBtn = h("button", { class: "btn primary pc-copy", type: "button", onclick: async () => {
        const okk = await io.copy(task);
        copied.textContent = okk ? "Der Auftrag ist kopiert. Öffnen Sie jetzt Claude in Chrome, fügen Sie ihn ein und drücken Sie Enter."
          : "Kopieren hat nicht geklappt – bitte erlauben Sie den Zugriff auf die Zwischenablage oder nutzen Sie „Ohne Claude“ unten.";
      } }, icon("copy"), COPY_LABEL);
      const kbd = (t) => h("kbd", { text: t });
      const steps = h("ol", { class: "pc-steps" },
        h("li", null, "Öffnen Sie Claude in Chrome – die Seitenleiste mit ", kbd("Strg"), "+", kbd("E"), " (Mac: ", kbd("Cmd"), "+", kbd("E"), ") oder über das Claude-Symbol in der Symbolleiste. Claude in Chrome gibt es nur in Chrome am Computer."),
        h("li", null, "Fügen Sie den Auftrag ein (", kbd("Strg"), "+", kbd("V"), " bzw. ", kbd("Cmd"), "+", kbd("V"), ") und drücken Sie ", kbd("Enter"), ". Claude erstellt die Folge in Gemini Notebook und lädt sie herunter – das dauert einige Minuten."),
        h("li", null, "Ziehen Sie die heruntergeladene Datei aus den Downloads von Chrome (Download-Symbol oben rechts) auf das Feld „Podcast-Datei hier ablegen“ – oder klicken Sie auf das Feld und wählen Sie sie aus. Danach löscht Claude das Notizbuch in Gemini Notebook wieder – vorher fragt Claude Sie."));
      // 2) Ablagefeld (Ziehen und Ablegen, Klick, Tastatur; am iPad „Datei auswählen“ aus der Dateien-App)
      const zone = dropArea(plan);
      // 3) ohne Claude: Quelltext und Steueranweisung einzeln
      const manual = manualPart(plan, src.text);
      root.append(h("div", { class: "pc-copyrow" }, copyBtn), copied, steps, zone, manual, h("div", { class: "row pc-foot" }, cancel));
      return head;
    });
  }

  /* Ablagefeld; nimmt eine Datei auch an, wenn sie daneben auf der Seite abgelegt wird (sonst öffnete Chrome sie und die Seite wäre weg) */
  function dropArea(plan) {
    const inp = h("input", { type: "file", class: "hidden", accept: ACCEPT, id: "pc-file", tabindex: "-1", "aria-hidden": "true" });
    const err = h("p", { class: "err pc-err", role: "alert" });
    const bar = h("progress", { class: "pc-bar hidden", max: "100", value: "0", "aria-label": "Fortschritt beim Hochladen" });
    const prog = h("p", { class: "pc-prog hidden", "aria-hidden": "true" });
    const state = h("p", { class: "pc-status", role: "status" });
    const z = h("div", { class: "drop pc-drop", id: "pc-drop", tabindex: "0", role: "button", "aria-label": DROP_LABEL, "aria-describedby": "pc-drop-h" },
      icon("upload"), h("strong", { text: DROP_LABEL }),
      h("span", { class: "small muted", id: "pc-drop-h", text: "Die Audiodatei aus Gemini Notebook (" + P.AUDIO_KINDS_TEXT + "), höchstens " + P.PODCAST_MAX_BYTES / 1e6 + " MB. Klicken, antippen oder Enter: Datei auswählen." }), inp);
    let up = null;
    const busyNow = () => !!up;
    async function take(file) {
      if (!file || busyNow()) return;
      err.textContent = "";
      let head = null;
      try { head = await io.head(file); } catch {}
      const issue = P.podcastFileIssue(file.size, head);
      if (issue) { err.textContent = issue; return; }
      const kind = P.audioKind(head);
      z.setAttribute("aria-disabled", "true"); z.classList.add("busy");
      bar.classList.remove("hidden"); prog.classList.remove("hidden"); bar.value = 0;
      prog.textContent = "Lade hoch … 0 %";
      state.textContent = "Die Datei „" + file.name + "“ wird hochgeladen …";
      up = io.upload("/api/teacher/podcast?day=" + plan.date, file, kind.mime, (a, b) => {
        const pct = Math.max(0, Math.min(100, Math.round((a / b) * 100)));
        bar.value = pct; prog.textContent = "Lade hoch … " + pct + " % (" + fmtBytes(a) + " von " + fmtBytes(b) + ")";
      });
      try {
        const r = await up.promise;
        up = null;
        if (stopped) return;
        podcasts = [...podcasts.filter((p) => p.day !== r.podcast.day), r.podcast].sort((a, b) => a.day.localeCompare(b.day));
        showPlayers("Gespeichert: „" + P.podcastTitle(r.podcast.day) + "“ – Sie können ihn jetzt abspielen.", r.podcast.id);
      } catch (e) {
        up = null;
        if (!z.isConnected || (e && e.name === "AbortError")) return;
        z.removeAttribute("aria-disabled"); z.classList.remove("busy");
        bar.classList.add("hidden"); prog.classList.add("hidden"); state.textContent = "";
        err.textContent = "Hochladen fehlgeschlagen: " + ((e && e.message) || e);
      }
    }
    z.addEventListener("click", (e) => { if (e.target !== inp && !busyNow()) inp.click(); });
    z.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && !busyNow()) { e.preventDefault(); inp.click(); } });
    inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; inp.value = ""; take(f); });
    const isFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    const onOver = (e) => { if (!isFiles(e)) return; e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = busyNow() ? "none" : "copy"; z.classList.add("over"); };
    const onLeaveDrag = (e) => { if (!e.relatedTarget || !document.documentElement.contains(e.relatedTarget)) z.classList.remove("over"); };
    const onDrop = (e) => { if (!isFiles(e)) return; e.preventDefault(); z.classList.remove("over"); take(e.dataTransfer.files && e.dataTransfer.files[0]); };
    window.addEventListener("dragover", onOver); window.addEventListener("dragleave", onLeaveDrag); window.addEventListener("drop", onDrop);
    cleanups.push(() => { window.removeEventListener("dragover", onOver); window.removeEventListener("dragleave", onLeaveDrag); window.removeEventListener("drop", onDrop); if (up) { up.abort(); up = null; } });
    return h("div", { class: "pc-zone" }, z, bar, prog, state, err);
  }

  function manualPart(plan, source) {
    const box = (id, label, text, rows, copyLabel) => {
      const ta = h("textarea", { id, readonly: true, rows: String(rows), class: "pc-text", spellcheck: "false" }); ta.value = text;
      const st = h("span", { class: "small pc-copied", role: "status" });
      return h("div", { class: "field pc-field" }, h("div", { class: "pc-fh" }, h("label", { for: id, text: label }),
        h("button", { class: "btn", type: "button", onclick: async () => { st.textContent = (await io.copy(text)) ? "Kopiert." : "Kopieren hat nicht geklappt – bitte den Text markieren und kopieren."; } }, icon("copy"), copyLabel), st), ta);
    };
    return h("details", { class: "pc-manual" }, h("summary", null, "Ohne Claude (z. B. am iPad)"),
      h("p", { class: "small", text: "So erstellen Sie den Podcast von Hand in Gemini Notebook – im Browser oder in der App:" }),
      h("ol", { class: "small pc-msteps" },
        h("li", null, "Öffnen Sie ", h("a", { href: P.NOTEBOOK_URL, target: "_blank", rel: "noopener noreferrer", text: "notebook.google.com" }), " und legen Sie ein neues Notizbuch an (z. B. „" + P.notebookName(plan.date) + "“)."),
        h("li", null, "Fügen Sie als Quelle „Kopierter Text“ den Quelltext unten ein."),
        h("li", null, "Im Bereich „Studio“ die „Audio-Zusammenfassung“ über „Anpassen“ (Stift-Symbol) einstellen – ein Tipp auf die Kachel selbst startet womöglich sofort ohne Einstellungen: Format „Detaillierte Analyse“, Sprache Deutsch, Länge „Kürzer“ (falls angeboten) – und die Steueranweisung unten einfügen."),
        h("li", null, "Erzeugen, einige Minuten warten und die Audio-Zusammenfassung herunterladen."),
        h("li", null, "Die Datei oben ablegen bzw. mit einem Tipp auf das Feld auswählen (am iPad aus der Dateien-App)."),
        h("li", null, "Das Notizbuch in Gemini Notebook wieder löschen.")),
      box("pc-src", "Quelltext (" + source.length.toLocaleString("de-DE") + " Zeichen)", source, 9, "Quelltext kopieren"),
      box("pc-steer", "Steueranweisung (" + P.PODCAST_STEER.length + " Zeichen)", P.PODCAST_STEER, 5, "Steueranweisung kopieren"));
  }

  /* ---------- Player ---------- */
  /* focusId: nach dem Hochladen der Podcast, dessen „Abspielen“ den Fokus bekommt (sonst der erste) – nur, wenn der Fokus vorher im Feld lag (swap) */
  function showPlayers(note = "", focusId = "") {
    mode = "players";
    swap("card podcast pc-player", () => {
      const status = h("p", { class: "pc-status", role: "status" });
      const other = h("button", { class: "btn ghost pc-aux pc-other", type: "button", onclick: () => start(other, status) }, icon("headphones"), "Podcast für einen anderen Tag entwickeln");
      const items = podcasts.map((p) => ({ id: p.id, ...playerBlock(p, status) }));
      root.append(...items.map((x) => x.el), h("div", { class: "row pc-foot" }, other), status);
      announce(status, note);
      const mine = items.find((x) => x.id === focusId) || items[0];
      return mine ? mine.play : other;
    });
  }
  function playerBlock(p, status) {
    const title = P.podcastTitle(p.day), hid = "pc-p-" + p.id;
    const audio = io.audio();
    audio.preload = "metadata";
    let url = p.url, exp = p.urlExpires || 0, retried = false, dragging = false, renewT = null, gone = false;
    const set = (u) => { url = u; audio.src = apiUrl(u); };
    const play = h("button", { class: "btn primary pc-play", type: "button", "aria-describedby": hid }, icon("play"), "Abspielen");
    const pause = h("button", { class: "btn pc-pause", type: "button", "aria-describedby": hid, "aria-disabled": "true" }, icon("pause"), "Pause");
    const range = h("input", { type: "range", class: "pc-range", min: "0", max: "1", step: "1", value: "0", disabled: true, "aria-label": "Position im Podcast", "aria-describedby": hid, "aria-valuetext": "0:00" });
    const time = h("span", { class: "pc-time", "aria-hidden": "true", text: "0:00 / –:––" });
    const msg = h("p", { class: "pc-msg", role: "status" });
    const del = h("button", { class: "btn ghost danger pc-aux pc-del", type: "button", "aria-describedby": hid }, icon("trash"), "Podcast löschen");
    const dur = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0);
    const paint = (pos = audio.currentTime) => {
      const d = dur();
      time.textContent = P.fmtPlayTime(pos) + " / " + (d ? P.fmtPlayTime(d) : "–:––");
      range.setAttribute("aria-valuetext", P.fmtPlayTime(pos) + " von " + (d ? P.fmtPlayTime(d) : "unbekannt"));
      if (!dragging) range.value = String(Math.floor(pos || 0));
    };
    // Der gerade gesperrte Knopf behält den Fokus nicht: Lag er dort (z. B. Enter auf „Abspielen“), geht er zum anderen – sonst bliebe er auf einem
    // Knopf, der nichts mehr tut. Hat die Lehrkraft den Fokus inzwischen woanders hingesetzt, bleibt er dort.
    const playing = (on) => {
      play.setAttribute("aria-disabled", String(!!on)); pause.setAttribute("aria-disabled", String(!on)); play.classList.toggle("primary", !on); pause.classList.toggle("primary", !!on);
      const from = on ? play : pause, to = on ? pause : play;
      if (document.activeElement === from && to.isConnected) to.focus();
    };
    const seek = (to) => { const d = dur(); if (!d) return; const t = Math.max(0, Math.min(d, to)); audio.currentTime = t; paint(t); };
    // Link erneuern (gilt 12 Stunden): rechtzeitig im Hintergrund, beim Zurückkehren in den Tab und nach einem Ladefehler; Position und Wiedergabe bleiben
    async function renew(resume) {
      try {
        const r = await tapi("POST", "/api/teacher/podcast/" + p.id + "/link", { body: {} });
        if (gone) return;
        const t = audio.currentTime || 0, was = resume !== undefined ? resume : !audio.paused;
        exp = r.podcast.urlExpires || 0;
        set(r.podcast.url);
        const back = () => {
          audio.removeEventListener("loadedmetadata", back);
          if (t) audio.currentTime = t;
          if (was) audio.play().catch((e) => { if (!gone && e && e.name === "NotAllowedError") msg.textContent = "Bitte noch einmal auf „Abspielen“ tippen."; });
        };
        audio.addEventListener("loadedmetadata", back);
        schedule();
      } catch (e) { if (!gone) msg.textContent = e && e.status === 404 ? "Diesen Podcast gibt es nicht mehr – bitte die Seite neu laden." : "Der Podcast lässt sich gerade nicht laden: " + ((e && e.message) || e); }
    }
    const schedule = () => { clearTimeout(renewT); const left = exp - io.now() - 10 * 60e3; if (exp && left > 0 && left < 2 ** 31 - 1) renewT = setTimeout(() => { if (audio.paused) renew(false); else schedule(); }, left); };
    play.addEventListener("click", () => {
      if (play.getAttribute("aria-disabled") === "true") return;
      msg.textContent = "";
      if (exp && io.now() > exp - 60e3) { renew(true); return; }
      const pr = audio.play();
      if (pr && pr.catch) pr.catch((e) => { if (!gone && e && e.name !== "AbortError") msg.textContent = e.name === "NotAllowedError" ? "Bitte noch einmal auf „Abspielen“ tippen." : "Abspielen nicht möglich: " + (e.message || e); });
    });
    pause.addEventListener("click", () => { if (pause.getAttribute("aria-disabled") !== "true") audio.pause(); });
    audio.addEventListener("play", () => playing(true));
    audio.addEventListener("playing", () => { playing(true); msg.textContent = ""; });
    audio.addEventListener("pause", () => playing(false));
    audio.addEventListener("ended", () => playing(false));
    for (const ev of ["loadedmetadata", "durationchange"]) audio.addEventListener(ev, () => { const d = dur(); range.max = String(Math.max(1, Math.floor(d))); range.disabled = !d; paint(); });
    audio.addEventListener("timeupdate", () => paint());
    audio.addEventListener("error", () => {
      if (gone || !audio.getAttribute("src")) return;
      if (!retried) { retried = true; renew(); return; }
      playing(false);
      msg.textContent = "Der Podcast lässt sich gerade nicht abspielen. Bitte die Seite neu laden.";
    });
    range.addEventListener("input", () => { dragging = true; const v = Number(range.value); time.textContent = P.fmtPlayTime(v) + " / " + (dur() ? P.fmtPlayTime(dur()) : "–:––"); });
    range.addEventListener("change", () => { dragging = false; seek(Number(range.value)); });
    range.addEventListener("keydown", (e) => {
      const st = P.seekStep(e.key, e.shiftKey);
      if (st === null) return;
      e.preventDefault();
      seek(st === -Infinity ? 0 : st === Infinity ? dur() : (audio.currentTime || 0) + st);
    });
    del.addEventListener("click", async () => {
      if (!(await confirmDialog("Podcast löschen?", "„" + title + "“ wird gelöscht – auf allen Ihren Geräten. Das lässt sich nicht rückgängig machen.", "Löschen", true))) return;
      try {
        await working(del, () => tapi("DELETE", "/api/teacher/podcast/" + p.id), "Lösche …");
        podcasts = podcasts.filter((x) => x.id !== p.id);
        if (podcasts.length) showPlayers("Der Podcast ist gelöscht."); else showButton("Der Podcast ist gelöscht.");
      } catch (e) { if (del.isConnected) msg.textContent = "Löschen fehlgeschlagen: " + ((e && e.message) || e); }
    });
    set(url);
    schedule();
    const onVis = () => { if (document.visibilityState === "visible" && exp && io.now() > exp - 15 * 60e3 && audio.paused) renew(false); };
    document.addEventListener("visibilitychange", onVis);
    cleanups.push(() => { gone = true; clearTimeout(renewT); document.removeEventListener("visibilitychange", onVis); try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch {} });
    const el = h("div", { class: "pc-item", dataset: { podcast: p.id, day: p.day } },
      h("div", { class: "pc-head" }, h("span", { class: "pc-ico", "aria-hidden": "true" }, icon("headphones")),
        h("div", { class: "pc-tt" }, h("h2", { id: hid, text: title }), h("p", { class: "pc-ai", text: "KI-erzeugt mit Gemini Notebook" }))),
      h("div", { class: "pc-ctrl" }, play, pause, h("div", { class: "pc-track" }, range, time)),
      msg,
      h("div", { class: "pc-metarow" }, h("p", { class: "small muted pc-meta", text: fmtBytes(p.size) + " · wird am " + P.podcastDayNum(addDays(p.day, 2)) + " automatisch gelöscht" }), del));
    return { el, play };
  }

  /* ---------- Laden ---------- */
  async function reload() {
    const mine = ++run;
    try {
      const r = await load();
      if (mine !== run || stopped) return;
      today = r.today || berlinToday(io.now()); podcasts = Array.isArray(r.podcasts) ? r.podcasts : []; listErr = "";
    } catch (e) {
      if (mine !== run || stopped) return;
      podcasts = []; listErr = "Gespeicherte Podcasts ließen sich nicht laden: " + ((e && e.message) || e);
    }
    if (mode !== "prep") paintIdle();
  }
  // zurück im Tab bzw. Fenster an einem anderen Tag (z. B. am nächsten Morgen): neu laden – ein vergangener Tag wird nicht mehr angeboten, dann steht
  // wieder der Knopf da; nie mitten in die Karte oder ein laufendes Abspielen. Auch beim Zurückkehren ins Fenster (focus): ein Fenster, das die
  // Nacht über offen und nur von anderen verdeckt war, meldet keinen Wechsel der Sichtbarkeit.
  // Verglichen wird mit dem Tag, an dem diese Seite zuletzt geladen hat (seen) – nicht mit dem Tag des Servers: geht die Uhr des Geräts anders, lädt
  // sonst jedes Zurückkehren neu.
  let seen = berlinToday(io.now());
  const off = () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); };
  const onVis = () => {
    if (!root.isConnected) { off(); return; }
    const d = berlinToday(io.now());
    if (document.visibilityState !== "visible" || d === seen || mode === "prep") return;
    if (root.querySelector(".pc-pause[aria-disabled='false']")) return;
    seen = d; today = d; reload();
  };
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("focus", onVis);
  onLeave(() => { stopped = true; run++; off(); for (const fn of cleanups.splice(0)) { try { fn(); } catch {} } });
  reload();
  return root;
}
