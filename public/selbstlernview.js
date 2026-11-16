// selbstlernview.js – Schüleransicht einer Selbstlern-Phase (Nachtrag 29 der Lehrkraft vom 15.11.2026, Teil B; nur Gymnasium ab Jahrgang 7 mit iPads).
// Ganz oben die Erklärung, dass die Lehrkraft nicht da sein kann und es deshalb einen Selbstlern-Unterricht gibt (samt dem Satz von Claude), darunter der
// Ablaufplan: die Stationen in ihrer Reihenfolge mit Arbeitsauftrag, Minuten und ihrem Element – Präsentation zum Durchklicken (Folienfenster, die Folien
// entstehen im Browser aus der PDF), Feibeitsblatt (Code kopieren und öffnen), Erklär-Chatbot (die Schülerin bzw. der Schüler erklärt, der Chatbot fragt
// kritisch nach), YouTube-Video (erst nach einem Klick eingebettet, wie im Feibeitsblatt), Escape-Room, Material oder ein Arbeitsauftrag. Abhaken nur auf
// diesem Gerät (localStorage, nichts Persönliches). Hausaufgabe, weiteres Material und die KI-Begriffshilfe ganz unten hängt app.js an.
// Nie innerHTML mit fremden Daten: alles per h() bzw. textContent; Videos nur aus der geprüften Kennung (cleanVideo) auf festen Adressen.
import { h, clear, store, icon, busy, apiUrl, downloadUrl } from "./ui.js";
import { fmtDayBerlin, fmtClockBerlin } from "./shared.js";
import { renderMarkdown } from "./markdown.js";
import { slideViewer } from "./slideviewer.js";
import { lazy, lazyWorker } from "./update.js";
import { YT_CONSENT, youtubeUrl, youtubeEmbedUrl, fmtVideoStart, cleanVideo, EXPLAIN_BOT_LIMITS } from "./selbstlern.js";

export const SLV_TEXT = {
  introH: "Heute: Selbstlern-Unterricht",
  planH: "Ablaufplan",
  planHint: "Bearbeite die Stationen der Reihe nach. Hast du eine Station geschafft, hake sie ab – das merkt sich nur dieses Gerät.",
  ytLoad: "Video von YouTube laden",
  ytOpen: "Video in neuem Tab öffnen",
  botIntro: "Du erklärst, der Chatbot hört zu und fragt kritisch nach – er erklärt nichts selbst. So merkst du, ob du es wirklich verstanden hast.",
  botUse: "Erklär-Chatbot nutzen",
  botNoAi: "Möchtest du keine KI nutzen? Dann schreib deine Erklärung in dein Heft – so schaffst du die Station auch ohne Chatbot.",
  botLabel: "Deine Erklärung",
  botPlaceholder: "Erkläre in eigenen Worten …",
  botSend: "Senden",
  botFinish: "Gespräch beenden und Rückmeldung bekommen",
  botAgain: "Neues Gespräch beginnen",
  botDone: "Das Gespräch ist beendet. Du kannst die Station jetzt abhaken – oder ein neues Gespräch beginnen.",
  botThinking: "Der Chatbot denkt nach …",
  botHint: "KI-Antworten können falsch sein. Gib keine persönlichen Daten ein (z. B. Namen, Adresse, Gesundheit). ",
  revoke: "Einwilligung zurücknehmen",
  presLoading: (name) => "Die Präsentation „" + name + "“ wird geladen …",
  presFail: "Die Präsentation ließ sich hier nicht anzeigen.",
  presRetry: "Erneut versuchen",
  presDownload: "Präsentation herunterladen",
  missing: "Das Material zu dieser Station ist gerade nicht verfügbar. Mach mit der nächsten Station weiter und schau später noch einmal nach.",
  printed: "Das Material zu dieser Station bekommst du ausgedruckt.",
  fbPending: "Dieses Feibeitsblatt legt deine Lehrkraft noch an. Mach mit der nächsten Station weiter und schau später noch einmal nach.",
  escPending: "Das Finale des Escape-Rooms (Feibeitsblatt) richtet deine Lehrkraft noch ein – die Stationen kannst du schon spielen.",
  escHint: "Sechs Stationen: erst die Bibliothek lesen (Notizen machen!), dann das Rätsel lösen. Am Ende führt dich ein Tunnel ins Feibeitsblatt, wo du abgibst. Neu laden kostet deinen Fortschritt – speichere zwischendurch deinen Zwischenstand.",
};
const DONE_KEY = (id) => "u.sl." + id;
export const SLV_KEEP_DAYS = 60;   // Häkchen bleiben so lange auf dem Gerät (app.js räumt ältere weg)
const MAX_PDF_BYTES = 40 * 1024 * 1024, SLIDE_WIDTH = 1600;

/* Häkchen der Stationen: nur auf diesem Gerät, je Sitzung; die Kennungen der Stationen ändern sich mit jedem Speichern der Selbstlern-Phase */
export function readDone(lessonId, ids) {
  let raw = null;
  try { raw = JSON.parse(store.get(DONE_KEY(lessonId)) || "null"); } catch {}
  const list = raw && Array.isArray(raw.done) ? raw.done : [];
  return new Set(list.filter((x) => typeof x === "string" && ids.includes(x)));
}
function writeDone(lessonId, set) { store.set(DONE_KEY(lessonId), JSON.stringify({ at: Date.now(), done: [...set] })); }

/* Fokus erst nach einer Antwort setzen – aber nie, wenn die Person ihn inzwischen woandershin bewegt hat */
const focusIfIdle = (el, ...also) => { const a = document.activeElement; if (el && el.isConnected && (!a || a === document.body || !a.isConnected || also.includes(a))) el.focus(); };
const whenText = (ms) => fmtDayBerlin(ms) + ", " + fmtClockBerlin(ms) + " Uhr";

/* ---------- PDF.js: Folien der Präsentation im Browser (wie die Folienbilder der Lehrkraft, presenter.js) ---------- */
let pdfjsP = null;
function pdfjs() {
  // der Worker der Bibliothek kommt aus demselben Stand wie dieses Modul (/v/<Stand>/vendor/, S24)
  if (!pdfjsP) pdfjsP = lazy(import("/vendor/pdf.min.mjs")).then((m) => { m.GlobalWorkerOptions.workerSrc = new URL("./vendor/pdf.worker.min.mjs", import.meta.url).href; return m; });
  return pdfjsP;
}
async function pdfSlides(bytes) {
  const lib = await pdfjs();
  const doc = await lazyWorker(lib.getDocument({ data: bytes, isEvalSupported: false }).promise);
  const done = new Map(), urls = [];
  return {
    total: doc.numPages,
    async page(n) {
      if (done.has(n)) return done.get(n);
      const p = (async () => {
        const page = await doc.getPage(n);
        const v1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(SLIDE_WIDTH / v1.width, SLIDE_WIDTH / v1.height, 3) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        page.cleanup();
        const blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Folie " + n + " ließ sich nicht anzeigen."))), "image/jpeg", 0.88));
        const url = URL.createObjectURL(blob); urls.push(url);
        canvas.width = canvas.height = 0;
        return { n, url, w: Math.round(vp.width), h: Math.round(vp.height) };
      })();
      done.set(n, p);
      p.catch(() => done.delete(n));
      return p;
    },
    destroy() { for (const u of urls) URL.revokeObjectURL(u); urls.length = 0; done.clear(); try { doc.destroy(); } catch {} },
  };
}

/* o = { lessonId, d (Antwort von GET /api/student/lessons/:id), sapi(method, path, opts), now() (Uhr des Servers), onLeave(fn),
         consent: { ok(), ask(opener, after), revoke() } (gemeinsame Einwilligung für Erklär-Chatbot und KI-Begriffshilfe),
         fileRow(file) → Zeile mit „Herunterladen“ (wie im Material), sheetRow(sheet) → Zeile „Code kopieren und Feibeitsblatt öffnen“ }
   → { sections: [Erklärung, Ablaufplan], repaint() (Einwilligung bzw. Zeit geändert), update(d) (neu geladene Daten) } */
export function selbstlernView(o) {
  let d = o.d;
  const sl = d.selbstlern, stations = sl.stationen || [], ids = stations.map((s) => s.id).filter(Boolean);
  const done = readDone(o.lessonId, ids), bots = [], cleanup = [];
  o.onLeave(() => { for (const fn of cleanup.splice(0)) { try { fn(); } catch {} } });

  // 1) Erklärung ganz oben
  const intro = h("section", { class: "card slv-intro", "aria-labelledby": "slv-intro-h" },
    h("h2", { id: "slv-intro-h", text: SLV_TEXT.introH }),
    h("p", { class: "slv-lead", text: sl.intro }),
    sl.einleitung ? h("p", { class: "slv-einl", text: sl.einleitung }) : null);

  // 2) Ablaufplan: Stationen in der richtigen Reihenfolge
  const minutes = stations.reduce((a, s) => a + (s.minuten || 0), 0);
  const progress = h("p", { class: "slv-progress", role: "status" });
  const paintProgress = () => {
    const n = stations.filter((s) => s.id && done.has(s.id)).length;
    progress.textContent = n === stations.length && n ? "Alle " + n + " Stationen erledigt – stark! Denk an die Hausaufgabe, falls noch etwas fehlt." : n + " von " + stations.length + " Stationen erledigt";
  };
  const list = h("ol", { class: "slv-stations" }, stations.map((s) => stationItem(s)));
  const plan = h("section", { class: "card slv-plan", "aria-labelledby": "slv-plan-h" },
    h("div", { class: "slv-planhead" }, h("h2", { id: "slv-plan-h", text: SLV_TEXT.planH }),
      h("span", { class: "badge", text: stations.length + (stations.length === 1 ? " Station" : " Stationen") + (minutes ? " · ca. " + minutes + " Minuten" : "") })),
    h("p", { class: "hint slv-planhint", text: SLV_TEXT.planHint }), progress, list);
  paintProgress();

  function stationItem(s) {
    const key = "slv-st-" + s.nr, hid = key + "-h";
    const box = h("input", { type: "checkbox", id: key + "-done", checked: s.id && done.has(s.id) ? true : null, disabled: s.id ? null : true });
    const li = h("li", { class: "slv-station" + (s.id && done.has(s.id) ? " done" : ""), id: key, "aria-labelledby": hid },
      h("div", { class: "slv-head" },
        h("span", { class: "slv-num", "aria-hidden": "true", text: String(s.nr) }),
        h("div", { class: "slv-titles" },
          h("h3", { id: hid }, h("span", { class: "sr-only", text: "Station " + s.nr + ": " }), s.titel),
          h("div", { class: "slv-meta" }, h("span", { class: "badge slv-typ", text: s.label }), s.minuten ? h("span", { class: "badge", text: "ca. " + s.minuten + " Minuten" }) : null))),
      s.anleitung ? h("div", { class: "slv-task" }, renderMarkdown(s.anleitung)) : null,
      element(s),
      h("label", { class: "checkrow slv-done", for: key + "-done" }, box, h("span", { text: "Station " + s.nr + " erledigt" })));
    box.addEventListener("change", () => {
      if (!s.id) return;
      if (box.checked) done.add(s.id); else done.delete(s.id);
      writeDone(o.lessonId, done);
      li.classList.toggle("done", box.checked);
      paintProgress();
    });
    return li;
  }

  function element(s) {
    if (s.typ === "praesentation") return presentation(s);
    if (s.typ === "video") return video(s);
    if (s.typ === "erklaer_chatbot") return explainBot(s);
    if (s.typ === "feibeitsblatt") {
      if (!s.code) return h("p", { class: "slv-note", text: SLV_TEXT.fbPending });
      const sheet = (d.sheets || []).find((x) => x.code === s.code) || { code: s.code, title: s.titel };
      return h("div", { class: "list slv-el" }, o.sheetRow(sheet));
    }
    if (s.typ === "escape_room") {
      return h("div", { class: "escbox slv-el" },
        sl.escape ? h("p", { class: "slv-esc-name" }, h("strong", { text: "Escape-Room: " + sl.escape.name })) : null,
        sl.escape && sl.escape.untertitel ? h("p", { class: "small", text: sl.escape.untertitel }) : null,
        h("a", { class: "btn primary big", href: "#/schueler/escape/" + o.lessonId }, "Escape-Room starten"),
        h("p", { class: "hint", text: SLV_TEXT.escHint }),
        s.pending ? h("p", { class: "slv-note", text: SLV_TEXT.escPending }) : null);
    }
    if (s.typ === "material") {
      const f = s.fileId ? (d.files || []).find((x) => x.id === s.fileId) : null;
      return f ? h("div", { class: "list slv-el" }, o.fileRow(f)) : h("p", { class: "slv-note", text: s.fileId ? SLV_TEXT.printed : SLV_TEXT.missing });
    }
    return null;   // Arbeitsauftrag ohne eigenes Element
  }

  /* ---------- Präsentation zum Durchklicken: das Folienfenster der Schüleransicht, die Folien aus der PDF (PDF.js) ---------- */
  function presentation(s) {
    const f = s.fileId ? (d.files || []).find((x) => x.id === s.fileId && x.kind === "file") : null;
    if (!f) return h("p", { class: "slv-note", text: SLV_TEXT.missing });
    const wrap = h("div", { class: "slv-el slv-pres" });
    const name = String(f.name || "Präsentation").replace(/\.pdf$/i, "");
    const download = async () => { const r = await o.sapi("POST", "/api/student/files/" + f.id + "/link"); downloadUrl(r.url, f.name); };
    let viewer = null, slides = null, alive = true;
    cleanup.push(() => { alive = false; if (viewer) viewer.destroy(); if (slides) slides.destroy(); });
    const load = async (focus) => {
      clear(wrap).append(h("p", { class: "slv-loading", role: "status" }, h("span", { class: "spin", "aria-hidden": "true" }), SLV_TEXT.presLoading(name)));
      try {
        if (f.size > MAX_PDF_BYTES || f.mime !== "application/pdf") throw new Error("too_big");
        const r = await o.sapi("POST", "/api/student/files/" + f.id + "/link");
        const res = await fetch(apiUrl(r.url), { credentials: "omit" });
        if (!res.ok) throw new Error("fetch");
        const bytes = new Uint8Array(await res.arrayBuffer());
        const sd = await pdfSlides(bytes);
        if (!alive) { sd.destroy(); return; }
        slides = sd;
        viewer = slideViewer({ total: sd.total, block: 1, title: name, headTag: "h4", headId: "slv-sv-h-" + s.nr, cls: "slideview slv-slides",
          downloadText: SLV_TEXT.presDownload,
          fetchSlides: async (from, to) => { const out = []; for (let n = from; n <= to; n++) out.push(await sd.page(n)); return { total: sd.total, slides: out }; },
          download });
        clear(wrap).append(viewer.el);
        if (focus) focusIfIdle(viewer.el.querySelector(".sv-frame"), focus);
      } catch (e) {
        if (!alive) return;
        const retry = h("button", { class: "btn", type: "button" }, SLV_TEXT.presRetry);
        const dl = h("button", { class: "btn primary", type: "button" }, icon("download"), SLV_TEXT.presDownload);
        const msg = h("p", { class: "slv-dlmsg small", role: "status" });
        retry.addEventListener("click", () => load(retry));
        dl.addEventListener("click", () => busy(dl, async () => { msg.textContent = ""; try { await download(); } catch (err) { msg.textContent = err.message || "Das Herunterladen hat nicht geklappt."; } }, "Lade …"));
        clear(wrap).append(h("p", { class: "slv-note", text: "„" + name + "“: " + SLV_TEXT.presFail + (e && e.message === "too_big" ? " Lade sie dir herunter, um sie durchzusehen." : "") }), h("div", { class: "row" }, retry, dl), msg);
        if (focus) focusIfIdle(retry, focus);
      }
    };
    load(null);
    return wrap;
  }

  /* ---------- YouTube-Video: erst nach dem Klick eingebettet (Muster des Feibeitsblatts); die Zustimmung merkt sich nichts ---------- */
  function video(s) {
    const v = cleanVideo(s.video);
    if (!v) return h("p", { class: "slv-note", text: SLV_TEXT.missing });
    const name = s.titel, noteId = "slv-vn-" + s.nr, titleText = name + (v.start ? " (ab " + fmtVideoStart(v.start) + ")" : "");
    // Name mit dem Video (sonst stünden bei mehreren Videos gleichlautende Links in der Linkliste von Screenreadern; WCAG 2.4.4)
    const open = h("a", { class: "yt-open", href: youtubeUrl(v), target: "_blank", rel: "noopener noreferrer", "aria-label": SLV_TEXT.ytOpen + " – " + name },
      SLV_TEXT.ytOpen, h("span", { class: "sr-only", text: " (öffnet in neuem Tab)" }));
    const load = h("button", { type: "button", class: "btn yt-load", "aria-describedby": noteId, "aria-label": SLV_TEXT.ytLoad + " – " + name }, icon("play"), SLV_TEXT.ytLoad);
    const acts = h("div", { class: "yt-acts" }, load, open);
    const ph = h("div", { class: "yt-ph" }, h("p", { class: "yt-title", text: titleText }), h("p", { class: "yt-note", id: noteId, text: YT_CONSENT }), acts);
    const fig = h("figure", { class: "slv-el slv-video", id: "slv-v-" + s.nr }, ph);
    let shown = null;
    load.addEventListener("click", () => {
      if (shown || !fig.isConnected) return;
      // die Adresse erst hier und nur aus der geprüften Kennung – das Laden beginnt mit dem Einhängen
      const frame = h("iframe", { title: "YouTube-Video: " + name, referrerpolicy: "strict-origin-when-cross-origin", allow: "autoplay; encrypted-media; picture-in-picture; fullscreen",
        allowfullscreen: true, sandbox: "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox", src: youtubeEmbedUrl(v) });
      shown = { box: h("div", { class: "yt-frame" }, frame), after: h("div", { class: "yt-after" }, h("p", { class: "yt-title", text: titleText }), open) };
      ph.replaceWith(shown.box, shown.after);
      fig.classList.add("loaded");
      try { frame.focus(); } catch { open.focus(); }   // der Knopf ist weg – sonst landete der Fokus am Seitenanfang
    });
    cleanup.push(() => { if (shown) { shown.box.remove(); shown = null; } });   // Seite verlassen: Wiedergabe beenden
    return fig;
  }

  /* ---------- Erklär-Chatbot: die Schülerin bzw. der Schüler erklärt, der Chatbot fragt nach (System-Prompt nur auf dem Worker) ---------- */
  function explainBot(s) {
    const box = h("div", { class: "slv-el slv-bot" });
    const st = { items: [], done: false, busy: false, mode: "" };
    const taId = "slv-bot-" + s.nr;
    const paint = () => {
      const ex = d.explain, t = o.now();
      const mode = !s.id ? "gone" : !ex || ex.start === null ? "nodate" : t < ex.start ? "before" : t > ex.end ? "after" : o.consent.ok() ? "chat" : "consent";
      if (mode === st.mode) return;   // unverändert: Gespräch und Eingabe bleiben stehen
      const hadFocus = box.contains(document.activeElement);
      st.mode = mode; clear(box);
      if (s.erklaeren) box.append(h("p", { class: "slv-explain" }, h("strong", { text: "Das erklärst du dem Chatbot: " }), s.erklaeren));
      if (mode === "gone") box.append(h("p", { class: "slv-note", text: SLV_TEXT.missing }));
      else if (mode === "nodate") box.append(h("p", { class: "slv-note", text: "Den Erklär-Chatbot gibt es, sobald deine Lehrkraft das Datum der Sitzung eingetragen hat. " + SLV_TEXT.botNoAi }));
      else if (mode === "before") box.append(h("p", { class: "slv-note", text: "Den Erklär-Chatbot kannst du ab dem Beginn der Sitzung nutzen (" + whenText(ex.start) + ")." }));
      else if (mode === "after") box.append(h("p", { class: "slv-note", text: "Den Erklär-Chatbot gibt es nicht mehr" + (ex.untilNext ? " – die nächste Stunde mit deiner Lehrkraft hat begonnen." : " – die Selbstlern-Phase ist vorbei.") + " Schreib deine Erklärung stattdessen in dein Heft." }));
      else if (mode === "consent") {
        const use = h("button", { class: "btn primary", type: "button" }, SLV_TEXT.botUse);
        use.addEventListener("click", () => o.consent.ask(use, () => box.querySelector("textarea")));
        box.append(h("p", { text: SLV_TEXT.botIntro }), use, h("p", { class: "hint", text: SLV_TEXT.botNoAi }));
      } else chat();
      if (hadFocus && !box.contains(document.activeElement)) { const f = box.querySelector("textarea, button"); if (f) f.focus(); }
    };
    const chat = () => {
      const log = h("div", { class: "kilog slv-chat", role: "log", "aria-live": "polite", "aria-label": "Gespräch mit dem Erklär-Chatbot" });
      const ta = h("textarea", { id: taId, rows: "3", maxlength: String(EXPLAIN_BOT_LIMITS.message), placeholder: SLV_TEXT.botPlaceholder, autocomplete: "off" });
      const send = h("button", { class: "btn primary", type: "submit" }, SLV_TEXT.botSend);
      const fin = h("button", { class: "btn", type: "button" }, SLV_TEXT.botFinish);
      const again = h("button", { class: "btn", type: "button" }, SLV_TEXT.botAgain);
      const doneNote = h("p", { class: "slv-botdone", role: "status" });
      const paintLog = () => clear(log).append(...st.items.map((x) => h("div", { class: "kiq" },
        x.q ? h("p", { class: "q" }, h("span", { class: "who", text: "Du: " }), x.q) : null,
        x.a ? h("p", { class: "a" }, h("span", { class: "who", text: "Chatbot: " }), x.a) : x.err ? h("p", { class: "a err", text: x.err }) : h("p", { class: "a muted", text: SLV_TEXT.botThinking }))));
      const paintState = () => {
        ta.disabled = !!st.done; send.disabled = st.busy || st.done; fin.disabled = st.busy || st.done || !st.items.some((x) => x.a);
        again.hidden = !st.done; fin.hidden = st.done; send.hidden = st.done;
        doneNote.textContent = st.done ? SLV_TEXT.botDone : "";
      };
      const ask = async (finish) => {
        const msg = ta.value.trim();
        if (st.busy || st.done || (!finish && msg.length < 2)) return;
        const opener = document.activeElement;
        const history = st.items.filter((x) => x.a && x.sig).slice(-EXPLAIN_BOT_LIMITS.history).map((x) => ({ q: x.q, a: x.a, sig: x.sig }));
        const item = { q: msg || "" }; st.items.push(item); ta.value = ""; st.busy = true; paintLog(); paintState();
        try {
          const r = await o.sapi("POST", "/api/student/lessons/" + o.lessonId + "/explain", { body: { station: s.id, message: msg, history, consent: true, ...(finish ? { finish: true } : {}) } });
          item.q = msg ? r.q : ""; item.a = r.answer; item.sig = r.sig || null;
          if (r.done) st.done = true;
        } catch (err) { item.err = err.message; if (msg && !ta.value) ta.value = msg; }
        st.busy = false; paintLog(); paintState();
        focusIfIdle(st.done ? again : ta, opener, send, fin, ta);
      };
      const form = h("form", { class: "slv-botform", onsubmit: (e) => { e.preventDefault(); ask(false); } },
        h("label", { for: taId, text: SLV_TEXT.botLabel }), ta, h("div", { class: "row slv-botacts" }, send, fin, again), doneNote);
      fin.addEventListener("click", () => ask(true));
      again.addEventListener("click", () => { st.items = []; st.done = false; paintLog(); paintState(); ta.focus(); });
      const rev = h("button", { class: "linkbtn", type: "button" }, SLV_TEXT.revoke);
      rev.addEventListener("click", () => o.consent.revoke());
      box.append(h("p", { class: "slv-botintro", text: SLV_TEXT.botIntro }), log, form, h("p", { class: "hint" }, SLV_TEXT.botHint, rev));
      paintLog(); paintState();
    };
    bots.push({ paint, reset: () => { st.items = []; st.done = false; st.mode = ""; } });
    paint();
    return box;
  }

  return {
    sections: [intro, plan],
    // Einwilligung zurückgenommen bzw. gegeben oder Zeitfenster geändert: Chatbots neu zeichnen (ohne Einwilligung verschwindet das Gespräch)
    repaint() { for (const b of bots) { if (!o.consent.ok()) b.reset(); b.paint(); } },
    update(nd) { d = { ...d, explain: nd.explain, aiHelp: nd.aiHelp }; for (const b of bots) b.paint(); },
  };
}
