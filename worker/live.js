// live.js – Live-Synchronisation der Präsentation: ein Durable Object je Sitzung (SQLite-Backend, im Free-Plan verfügbar) mit
// WebSocket-Hibernation. Nur die Lehrkraft kann Folien wechseln; Schüler:innen erhalten nur die aktuelle Folie als signierten Link
// (sie können also nicht vorblättern). Fällt der WebSocket aus, fragt der Browser den Stand alle 2 s über HTTP ab.
// Codefolie (11.11.2026): Folie 0 = Sitzungscode mit QR-Code vor Folie 1, Platzhalterfolien (codeSlides) und „Sitzungscode zeigen“
// (codeShown) erscheinen bei allen als Codefolie (view "code" mit code, title, lines) – Code, Titel und Platzhalter schickt die Lehrkraft beim Start.
// Beamergeräte (Nachtrag 15, worker/beamer.js): dritte Rolle „beamer“ – sehen dasselbe wie die Schüler:innen und zusätzlich die nächste Folie
// zum Vorladen (next), zählen nicht als Schüler:innen (die Lehrkraft bekommt ihre Zahl als beamers) und steuern nichts. Ihre Schlüssel tragen
// die Generation bgen; „Beamer trennen“ (/beamer-reset) erhöht sie und schließt alle Beamer-Verbindungen (Code 4001). Eine Beamer-Verbindung merkt
// sich den Ablauf ihres Schlüssels (Anhang exp): ist er vorbei, schließt die nächste Nachricht an alle sie ebenfalls (4001) – die Kopplung gilt
// so auch bei offenem WebSocket höchstens 6 Stunden.
// Timer (Nachtrag 16): {t:"timer", op} der Lehrkraft (livestate.js) – alle bekommen timer {left, total, paused} mit der Restzeit zum Sendezeitpunkt;
// gesendet wird nur bei Änderungen (Start, Pause, Weiter, Verlängern, Ende), nie im Sekundentakt – den Ablauf zeigen die Seiten selbst.
// Material erscheint mit seiner Materialfolie (Nachtrag 44, Teil 1): Zeigt die Lehrkraft eine Codefolie mit Überschrift, vermerkt das Objekt die Überschrift in
// D1 (lessons.reveals, eine Anweisung – die Kennung der Sitzung trägt die Verbindung der Lehrkraft als Anhang) und schickt allen noch einmal den Stand mit
// revealAt (Zeitpunkt, kein Titel): Die Schüler:innen-Seiten laden dann ihr Material neu (zugeordnet wird erst dort, public/reveal.js). Eine Freigabe von Hand
// stößt /reveal an. Ältere, gecachte Seiten überspringen den Stand (dasselbe v) – es gibt keine neue Art von Nachricht.
// Anonyme Umfrage (Nachtrag 46, public/polls.js): Zeigt die Präsentation eine Umfragefolie, bekommen alle poll (Frage, Antworten, offen/beendet; Lehrkraft mit
// Zahlen, Beamer nur mit der Zahl der Antworten bzw. – nach „Ergebnis am Beamer zeigen“ – der Verteilung, Schüler:innen nie mit Zahlen). Gezählt wird hier im
// Objekt (Speicher „polls“ = Einträge je Umfrage, „pv:<Kennung>“ = Prüfwerte der Geräte, die schon abgestimmt haben – getrennt von den Antworten): /poll-vote
// nimmt eine Stimme nur an, solange genau diese Folie gezeigt wird, je Gerät einmal. 2 Minuten nach der ersten Antwort beendet der Wecker (alarm) die Umfrage,
// schreibt das Ergebnis nach D1 (lessons.polls) und schickt allen den Stand mit pollAt – die Schüler:innen-Seiten laden dann ihr Ergebnis.
import { DurableObject } from "cloudflare:workers";
import { HttpError, json, requireSecret, signLink, checkLink, isId, readJson, bad } from "./lib.js";
import { LIVE_IDLE as IDLE, liveReduce, liveView, liveNext, liveTimer, liveVideo, livePoll } from "./livestate.js";
import { cleanPollEntry, newPoll, pollVote, pollMessage, pollClosed, pollClosesAt, pollResultOf, pollResultsPut, pollResultsDrop, pollFileOf, POLL_KEY_RE, POLL_LIMITS } from "../public/polls.js";
import { cleanVideoReport } from "../public/videoslides.js";
import { REVEAL_SEEN_SQL, REVEAL_LIMITS, revealKeyOf } from "../public/reveal.js";
import { requireTeacher } from "./auth.js";
import { getLesson } from "./lessons.js";
import { slideUrl } from "./files.js";

const SLIDE_TTL = 3 * 3600e3;

export class LiveRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch {}
  }
  async state() { return { ...IDLE, ...((await this.ctx.storage.get("state")) || {}) }; }   // ältere Stände ohne die neuen Felder
  async message(role, st, gone = []) {
    st = st || (await this.state());
    const out = { t: "state", active: !!st.active, slide: st.slide, pages: st.pages, v: st.v, updatedAt: st.updatedAt };
    const view = liveView(st);   // Folienbild nur für echte Seiten; Codefolie vor Folie 1, an Platzhalterfolien und bei „Sitzungscode zeigen“
    if (view.slide) out.url = await slideUrl(requireSecret(this.env), st.fileId, view.slide, SLIDE_TTL);
    if (view.code) Object.assign(out, { view: "code", ...view.code });
    // Timer (Nachtrag 16): Restzeit zum Sendezeitpunkt nach der Uhr des Servers – nur, wenn einer läuft (sonst bleibt die Nachricht wie bisher)
    const timer = liveTimer(st, Date.now());
    if (timer) out.timer = timer;
    // Video einer Videofolie (Nachtrag 38): nur Lehrkraft und Beamer – die Schüler:innen sehen live nur die Folie
    const video = role === "student" ? null : liveVideo(st, Date.now());
    if (video) out.video = video;
    // Material freigegeben (Nachtrag 44): nur der Zeitpunkt – für alle Rollen gleich (nie Titel oder Daten des Materials)
    if (st.revealAt > 0) out.revealAt = st.revealAt;
    // Umfrage der aktuellen Folie (Nachtrag 46): je Rolle (pollMessage) – und für alle der Zeitpunkt, zu dem zuletzt eine Umfrage beendet wurde
    const spec = livePoll(st);
    if (spec) out.poll = pollMessage(role, spec, (await this.polls())[spec.k] || null, st.pollShown === spec.n, Date.now(), ((await this.ctx.storage.get("pollr")) || {})[spec.k] || 0);
    if (st.pollAt > 0) out.pollAt = st.pollAt;
    if (role === "teacher") { out.fileId = st.fileId; out.students = this.ctx.getWebSockets("student").length; out.beamers = this.ctx.getWebSockets("beamer").filter((ws) => !gone.includes(ws)).length; }
    if (role === "beamer") { const k = liveNext(st); if (k) out.next = await slideUrl(requireSecret(this.env), st.fileId, k, SLIDE_TTL); }   // vorladen
    return out;
  }
  // students: false = nur Lehrkraft und Beamer (Befehle zum Video – die Nachricht an die Schüler:innen änderte sich nicht); skip = eine gerade geschlossene Verbindung
  async broadcast(st, { students = true, skip = null } = {}) {
    // Beamer mit abgelaufenem Schlüssel: schließen statt weiter Folien schicken (das Gerät zeigt dann einen neuen Beamer-Code)
    const now = Date.now(), expired = this.ctx.getWebSockets("beamer").filter((ws) => beamerExpired(ws, now));
    for (const ws of expired) { try { ws.close(4001, "abgelaufen"); } catch {} }
    const forStudents = JSON.stringify(await this.message("student", st)), forTeachers = JSON.stringify(await this.message("teacher", st, skip ? [...expired, skip] : expired));
    const all = this.ctx.getWebSockets().filter((ws) => !expired.includes(ws) && ws !== skip);
    const role = (ws) => { const t = this.ctx.getTags(ws); return t.includes("teacher") ? "teacher" : t.includes("beamer") ? "beamer" : "student"; };
    const bm = all.some((ws) => role(ws) === "beamer") ? await this.message("beamer", st) : null;
    const forBeamers = bm ? JSON.stringify(bm) : forStudents;
    // mehrere Beamergeräte (Nachtrag 38): nur das erste spielt das Video mit Ton – sonst liefe es doppelt hörbar
    const forMuted = bm && bm.video ? JSON.stringify({ ...bm, video: { ...bm.video, mute: true } }) : forBeamers;
    let lead = true;
    for (const ws of all) {
      const r = role(ws);
      if (r === "student" && !students) continue;
      try { ws.send(r === "teacher" ? forTeachers : r === "beamer" ? (lead ? forBeamers : forMuted) : forStudents); } catch {}
      if (r === "beamer") lead = false;
    }
  }
  // Zahl der Schüler:innen und Beamer an die Lehrkraft; gone = gerade geschlossene Verbindungen (zählen nicht mehr mit)
  countToTeachers(gone = []) {
    const n = (role) => this.ctx.getWebSockets(role).filter((ws) => !gone.includes(ws)).length;
    const msg = JSON.stringify({ t: "count", students: n("student"), beamers: n("beamer") });
    for (const ws of this.ctx.getWebSockets("teacher")) { try { ws.send(msg); } catch {} }
  }
  /* ---------- Anonyme Umfrage (Nachtrag 46) ---------- */
  async polls() {
    const raw = (await this.ctx.storage.get("polls")) || {}, out = {};
    for (const k of Object.keys(raw)) { const e = cleanPollEntry(raw[k]); if (e) out[e.k] = e; }
    return out;
  }
  // Wecker auf das früheste Ende einer laufenden Umfrage (bzw. auf einen neuen Versuch, das Ergebnis zu speichern)
  async armAlarm(polls, now, retryAt = null) {
    // überfällige (beendet, Ergebnis noch nicht gespeichert): gleich bzw. zum neuen Versuch (retryAt) – laufende: zu ihrem Ende
    let at = null;
    for (const p of Object.values(polls)) {
      if (p.saved) continue;
      const c = pollClosesAt(p);
      if (c === null) continue;
      const cand = c > now ? c : retryAt !== null ? retryAt : now + 50;
      if (at === null || cand < at) at = cand;
    }
    if (at === null) return;
    try { await this.ctx.storage.setAlarm(Math.max(at, now + 50)); } catch {}
  }
  /* Beendete Umfragen abschließen: Ergebnis nach D1 (lessons.polls) – danach bekommen alle den Stand mit pollAt (die Schüler:innen-Seiten laden ihr Ergebnis).
     Während der D1-Anfragen können weitere Stimmen (anderer Umfragen) ankommen: der Speicher wird deshalb danach frisch gelesen und nur der Vermerk gesetzt.
     Scheitert D1, bleibt die Umfrage beendet (der Stand geht trotzdem an alle) und der Wecker versucht es erneut. → true = alles gespeichert */
  async settlePolls() {
    const now = Date.now(), all0 = await this.polls(), due = Object.values(all0).filter((p) => !p.saved && pollClosed(p, now));
    // nichts fällig (der Wecker kam zu früh, oder seine Umfrage wurde inzwischen gelöscht): für eine noch laufende Umfrage neu stellen – sonst bliebe ihr Ergebnis aus
    if (!due.length) { await this.armAlarm(all0, now); return true; }
    const saved = [];
    for (const p of due) {
      let ok = !this.env || !this.env.DB || !isId(p.lid);   // ohne Datenbank bzw. Sitzung: nichts zu speichern
      if (!ok) try {
        const row = await this.env.DB.prepare("SELECT polls FROM lessons WHERE id=?1").bind(p.lid).first();
        if (row) await this.env.DB.prepare("UPDATE lessons SET polls=?2 WHERE id=?1").bind(p.lid, pollResultsPut(row.polls, pollResultOf(p, now))).run();
        ok = true;
      } catch {}
      if (ok) saved.push(p.k);
    }
    const fresh = await this.polls();
    for (const k of saved) if (fresh[k]) fresh[k].saved = true;
    const st = await this.state();
    if (saved.length) st.pollAt = Math.max(now, (st.pollAt || 0) + 1);
    await this.ctx.storage.put({ polls: fresh, state: st });
    await this.broadcast(st);
    const all = saved.length === due.length;
    await this.armAlarm(fresh, now, all ? null : now + 20000);
    return all;
  }
  async alarm() { await this.settlePolls(); }
  // Einträge entfernen: eine Umfrage (k), alle einer Präsentation (fileId) bzw. alle (all) – samt den Prüfwerten der Geräte
  async dropPolls({ k = null, fileId = null, all = false }) {
    const raw = (await this.ctx.storage.get("polls")) || {}, gone = Object.keys(raw).filter((x) => all || x === k || (fileId !== null && pollFileOf(x) === fileId));
    if (!gone.length) return false;
    for (const x of gone) delete raw[x];
    await this.ctx.storage.put("polls", raw);
    await this.ctx.storage.delete(gone.map((x) => "pv:" + x));
    return true;
  }
  async beamerGen() { return (await this.ctx.storage.get("bgen")) || 0; }
  // „Beamer trennen“ (und beim Löschen der Sitzung): neue Generation – alle Beamer-Schlüssel dieser Sitzung gelten nicht mehr
  async resetBeamers() {
    await this.ctx.storage.put("bgen", (await this.beamerGen()) + 1);
    const gone = this.ctx.getWebSockets("beamer");
    for (const ws of gone) { try { ws.close(4001, "getrennt"); } catch {} }
    this.countToTeachers(gone);
  }
  async fetch(request) {
    const url = new URL(request.url);
    const r = url.searchParams.get("role"), role = r === "teacher" || r === "beamer" ? r : "student";
    // Beamer: nur mit der aktuellen Generation (ein Schlüssel von vor „Beamer trennen“ gilt nicht mehr)
    if (role === "beamer" && (url.pathname === "/ws" || url.pathname === "/state") && url.searchParams.get("gen") !== String(await this.beamerGen()))
      return new Response("getrennt", { status: 403 });
    if (url.pathname === "/ws") {
      if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return new Response("WebSocket erwartet", { status: 426 });
      const exp = Number(url.searchParams.get("exp"));   // Beamer: Ablauf des Schlüssels (aus dem signierten Ticket)
      if (role === "beamer" && !(Number.isFinite(exp) && exp > Date.now())) return new Response("abgelaufen", { status: 403 });
      const pair = new WebSocketPair(), [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [role]);
      if (role === "beamer") server.serializeAttachment({ exp });
      // Lehrkraft (Nachtrag 44): die Sitzung, zu der dieses Objekt gehört – damit es gezeigte Materialfolien in D1 vermerken kann (markReveal)
      if (role === "teacher" && isId(url.searchParams.get("lid"))) server.serializeAttachment({ lid: url.searchParams.get("lid") });
      const first = await this.message(role);
      // ein weiteres Beamergerät (es gibt schon eins): das Video stumm (Nachtrag 38)
      if (role === "beamer" && first.video && this.ctx.getWebSockets("beamer").length > 1) first.video = { ...first.video, mute: true };
      server.send(JSON.stringify(first));
      if (role !== "teacher") this.countToTeachers();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/state") return Response.json(await this.message(role));
    if (url.pathname === "/beamer-gen") return Response.json({ gen: await this.beamerGen() });
    if (url.pathname === "/beamer-reset" && request.method === "POST") { await this.resetBeamers(); return Response.json({ ok: true }); }
    // Freigabe von Hand (Nachtrag 44, worker/lessons.js routeLessonReveal): revealAt vorrücken und allen den Stand schicken – die Schüler:innen-Seiten laden ihr Material neu
    if (url.pathname === "/reveal" && request.method === "POST") {
      const at = Number(url.searchParams.get("at")), st = await this.state();
      if (Number.isFinite(at) && at > (st.revealAt || 0)) { st.revealAt = at; await this.ctx.storage.put("state", st); await this.broadcast(st); }
      return Response.json({ ok: true });
    }
    /* Anonyme Umfrage (Nachtrag 46): eine Stimme (worker/student.js routeStudentPollVote) – nur für die Umfrage der gerade gezeigten Folie, je Gerät einmal
       (voter = Prüfwert aus Gerät und Umfrage), nicht mehr nach dem Ende. Zwischen Lesen und Schreiben stehen nur Speicherzugriffe – zwei gleichzeitige
       Stimmen überschreiben einander nicht. Danach bekommen Lehrkraft und Beamer die neue Zahl (die Schüler:innen nicht). */
    if (url.pathname === "/poll-vote" && request.method === "POST") {
      let b = null; try { b = await request.json(); } catch {}
      const now = Date.now(), st = await this.state(), spec = livePoll(st), lid = url.searchParams.get("lid");
      const k = b && typeof b.k === "string" ? b.k : "", voter = b && typeof b.voter === "string" && b.voter.length >= 20 && b.voter.length <= 100 ? b.voter : "";
      if (!spec || spec.k !== k || !voter) return Response.json({ ok: false, code: "not_open" });
      // nur während der Live-Präsentation: eine Lehrkraft ist verbunden (bzw. ihre Verbindung ist erst seit höchstens 90 s weg, z. B. WLAN) – eine Präsentation, die
      // nur „geschlossen“ wurde und auf der Umfragefolie stehen blieb, nimmt später (z. B. zu Hause) keine Stimmen mehr an
      if (!this.ctx.getWebSockets("teacher").length && !(now - ((await this.ctx.storage.get("tgone")) || 0) < TEACHER_GRACE_MS)) return Response.json({ ok: false, code: "not_open" });
      const polls = await this.polls(), p = polls[k] || newPoll(k, spec, isId(lid) ? lid : null);
      const voters = (await this.ctx.storage.get("pv:" + k)) || [];
      const r = pollVote(p, voters, voter, b.choice, now);
      if (r.error) return Response.json({ ok: false, code: r.error });
      if (isId(lid)) p.lid = lid;
      polls[k] = p;
      // sehr viele Einträge (alte Präsentationen): die ältesten gespeicherten fallen weg
      const old = Object.values(polls).filter((x) => x.saved && x.k !== k).sort((a, b2) => a.firstAt - b2.firstAt);
      const drop = old.slice(0, Math.max(0, Object.keys(polls).length - POLL_LIMITS.results)).map((x) => x.k);
      for (const x of drop) delete polls[x];
      await this.ctx.storage.put({ polls, ["pv:" + k]: voters });
      if (drop.length) await this.ctx.storage.delete(drop.map((x) => "pv:" + x));
      await this.armAlarm(polls, now);
      await this.broadcast(st, { students: false });
      return Response.json({ ok: true });
    }
    // Stand aller Umfragen dieser Sitzung für die Lehrkraft (Sitzungsseite): Zahlen je Antwort, läuft bzw. beendet; überfällige werden dabei abgeschlossen
    if (url.pathname === "/polls") {
      await this.settlePolls();
      const now = Date.now(), st = await this.state(), cur = livePoll(st);
      const list = Object.values(await this.polls()).sort((a, b) => a.n - b.n || a.firstAt - b.firstAt)
        .map((p) => ({ k: p.k, n: p.n, q: p.q, options: p.options, counts: p.counts, total: p.total, firstAt: p.firstAt || null, open: !pollClosed(p, now), left: pollClosesAt(p) === null ? null : Math.max(0, pollClosesAt(p) - now) }));
      return Response.json({ polls: list, current: cur ? cur.k : null, fileId: st.active ? st.fileId : null });
    }
    // „Ergebnis löschen und Umfrage neu öffnen“ (Lehrkraft): Eintrag und Prüfwerte weg; alle bekommen den Stand (die Schüler:innen-Seiten laden ihr Ergebnis neu)
    if (url.pathname === "/poll-reset" && request.method === "POST") {
      const k = url.searchParams.get("k") || "";
      if (!POLL_KEY_RE.test(k)) return Response.json({ ok: false }, { status: 400 });
      await this.dropPolls({ k });
      const st = await this.state(), now = Date.now();
      // gemerkt, wann diese Umfrage neu geöffnet wurde: die Seiten der Schüler:innen vergessen damit ihr „schon abgestimmt“ (höchstens 50 Einträge)
      const pr = (await this.ctx.storage.get("pollr")) || {};
      pr[k] = now;
      const keys = Object.keys(pr).sort((a, b) => pr[a] - pr[b]);
      for (const x of keys.slice(0, Math.max(0, keys.length - 50))) delete pr[x];
      await this.ctx.storage.put("pollr", pr);
      st.pollAt = Math.max(now, (st.pollAt || 0) + 1);
      if (livePoll(st) && livePoll(st).k === k) st.pollShown = null;
      await this.ctx.storage.put("state", st);
      await this.broadcast(st);
      return Response.json({ ok: true });
    }
    if (url.pathname === "/reset" && request.method === "POST") {
      // pollAt bleibt wie revealAt; Umfragen einer gelöschten bzw. ersetzten Präsentation (pollsFile) und einer gelöschten Sitzung (beamers=1) verschwinden
      const pf = url.searchParams.get("pollsFile"), wipe = url.searchParams.get("beamers") === "1";
      const dropped = wipe ? await this.dropPolls({ all: true }) : isId(pf) ? await this.dropPolls({ fileId: pf }) : false;
      const old = await this.state(), now = Date.now();
      const st = { ...IDLE, v: (old.v || 0) + 1, updatedAt: now, revealAt: old.revealAt || 0, pollAt: dropped ? Math.max(now, (old.pollAt || 0) + 1) : old.pollAt || 0 };   // revealAt bleibt (Nachtrag 44)
      await this.ctx.storage.put("state", st);
      await this.broadcast(st);
      if (url.searchParams.get("beamers") === "1") await this.resetBeamers();   // Sitzung gelöscht: auch die Beamer trennen
      return Response.json({ ok: true });
    }
    return new Response("nicht gefunden", { status: 404 });
  }
  async webSocketMessage(ws, raw) {
    if (raw === "ping") { try { ws.send("pong"); } catch {} return; }
    const tags = this.ctx.getTags(ws);
    if (tags.includes("beamer")) { this.relayVideo(ws, raw); return; }   // ein Beamer meldet nur, wie das Video bei ihm läuft (Nachtrag 38)
    if (!tags.includes("teacher")) return;   // Schüler:innen können nichts steuern
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || typeof m !== "object") return;
    const st = await this.state(), now = Date.now();
    if (m.t === "hello") {
      try { ws.send(JSON.stringify(await this.message("teacher", st))); } catch {}
      return;
    }
    // „Ergebnis am Beamer zeigen“ (Nachtrag 46) erst nach dem Ende der Abstimmung – sonst sähe die Klasse das Ergebnis, während noch abgestimmt wird
    if (m.t === "poll" && m.on === true) { const spec = livePoll(st), p = spec ? (await this.polls())[spec.k] : null; if (!p || !pollClosed(p, now)) return; }
    if (!liveReduce(st, m, now)) return;
    await this.ctx.storage.put("state", st);
    await this.broadcast(st, { students: m.t !== "video" && m.t !== "poll" });   // Video und „Ergebnis am Beamer zeigen“: nur Lehrkraft und Beamer
    if (m.t === "start" || m.t === "goto" || m.t === "code") await this.markReveal(ws, st);   // erst die Folie, dann (falls neu) der Vermerk
  }
  /* Nachtrag 44, Teil 1: Zeigt die aktuelle Folie eine Codefolie mit Überschrift (Materialfolie), ihre Überschrift in D1 vermerken (lessons.reveals.seen) – nur
     mit der Kennung aus dem Anhang der Verbindung der Lehrkraft (routeLiveSocket). War sie neu, bekommen alle den Stand noch einmal mit revealAt (frisch gelesen:
     während der D1-Anfrage können weitere Nachrichten angekommen sein). Ohne Datenbank oder bei einem Fehler still – die Live-Präsentation hängt nie davon ab. */
  async markReveal(ws, st) {
    let a = null; try { a = ws.deserializeAttachment(); } catch {}
    if (!this.env || !this.env.DB || !a || !isId(a.lid) || !(st.slide >= 1) || st.codeShown) return;
    const view = liveView(st), key = view.code ? revealKeyOf(view.code.lines) : "";
    if (!key) return;
    const now = Date.now();
    try {
      const r = await this.env.DB.prepare(REVEAL_SEEN_SQL).bind(a.lid, JSON.stringify({ k: key, at: now }), key, REVEAL_LIMITS.seen).run();
      if (!r || !(r.results || []).length) return;
      const cur = await this.state();
      if ((cur.revealAt || 0) >= now) return;
      cur.revealAt = now;
      await this.ctx.storage.put("state", cur);
      await this.broadcast(cur);
    } catch {}
  }
  // Rückmeldung eines Beamergeräts zum Video (spielt, pausiert, blockiert, Fehler …) – geprüft an die Lehrkraft weitergereicht, nie gespeichert. Nur vom
  // ersten Beamer (er gibt den Ton, siehe broadcast) – sonst widersprächen sich die Meldungen mehrerer Geräte.
  relayVideo(ws, raw) {
    const now = Date.now();
    if (beamerExpired(ws, now) || String(raw).length > 2000) return;
    if (this.ctx.getWebSockets("beamer").find((b) => !beamerExpired(b, now)) !== ws) return;
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || m.t !== "vstate") return;
    const r = cleanVideoReport(m);
    if (!r) return;
    const msg = JSON.stringify({ t: "vstate", ...r });
    for (const t of this.ctx.getWebSockets("teacher")) { try { t.send(msg); } catch {} }
  }
  async webSocketClose(ws, code, reason) {
    const tags = this.ctx.getTags(ws), counted = !tags.includes("teacher");   // Schüler:innen und Beamer
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch {}
    if (counted) this.countToTeachers([ws]);
    // die letzte Verbindung einer Lehrkraft endet: Zeitpunkt merken (Umfrage, /poll-vote)
    else if (!this.ctx.getWebSockets("teacher").some((t) => t !== ws)) { try { await this.ctx.storage.put("tgone", Date.now()); } catch {} }
    // der erste Beamer ist weg, während ein Video läuft (Nachtrag 38): der nächste gibt jetzt den Ton – er erfährt es mit dem Stand
    if (tags.includes("beamer") && this.ctx.getWebSockets("beamer").some((b) => b !== ws)) {
      const st = await this.state();
      if (liveVideo(st, Date.now())) await this.broadcast(st, { students: false, skip: ws });
    }
  }
  async webSocketError(ws) {
    if (this.ctx.getTags(ws).includes("teacher") && !this.ctx.getWebSockets("teacher").some((t) => t !== ws)) { try { await this.ctx.storage.put("tgone", Date.now()); } catch {} }
    try { ws.close(1011, "Fehler"); } catch {}
  }
}

// so lange nach dem Ende der letzten Verbindung einer Lehrkraft nimmt eine Umfrage noch Stimmen an (Nachtrag 46: kurzer Verbindungsabbruch im WLAN)
export const TEACHER_GRACE_MS = 90e3;
function beamerExpired(ws, now) {
  let a = null; try { a = ws.deserializeAttachment(); } catch {}
  return !!a && Number.isFinite(a.exp) && a.exp <= now;
}

export const stub = (env, lessonId) => env.LIVE.get(env.LIVE.idFromName(lessonId));

export async function liveTicket(c, lessonId, role, sub) {
  const { e, s } = await signLink(requireSecret(c.env), ["live", lessonId, role, sub], 2 * 60e3, c.now);
  return { url: "/api/live/" + lessonId + "?r=" + role + "&u=" + encodeURIComponent(sub) + "&e=" + e + "&s=" + encodeURIComponent(s) };
}
export async function liveState(c, lessonId, role) {
  const r = await stub(c.env, lessonId).fetch("https://live/state?role=" + role);
  return r.json();
}
// WebSocket-Aufbau: Browser können keine Kopfzeilen setzen → kurzlebiges, signiertes Ticket in der Adresse
export async function routeLiveSocket(c, lessonId) {
  const u = new URL(c.request.url), r = u.searchParams.get("r"), role = r === "teacher" || r === "beamer" ? r : "student", sub = u.searchParams.get("u") || "";
  if (!isId(lessonId) || !(await checkLink(requireSecret(c.env), ["live", lessonId, role, sub], u.searchParams.get("e"), u.searchParams.get("s"), c.now)))
    throw new HttpError(403, "bad_ticket", "Die Verbindung wurde abgelehnt. Bitte die Seite neu laden.");
  if ((c.request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") throw new HttpError(426, "upgrade_required", "WebSocket erwartet.");
  // Beamer: u = „Generation.Ablauf“ seines Schlüssels – das Durable Object lehnt eine veraltete Generation ab und schließt nach dem Ablauf.
  // Lehrkraft: die Sitzung (geprüft, aus dem signierten Ticket) – das Durable Object vermerkt damit gezeigte Materialfolien (Nachtrag 44)
  let extra = role === "teacher" ? "&lid=" + lessonId : "";
  if (role === "beamer") {
    const m = /^(\d{1,9})\.(\d{10,16})$/.exec(sub);
    if (!m) throw new HttpError(403, "bad_ticket", "Die Verbindung wurde abgelehnt. Bitte die Seite neu laden.");
    extra = "&gen=" + m[1] + "&exp=" + m[2];
  }
  return stub(c.env, lessonId).fetch(new Request("https://live/ws?role=" + role + extra, { headers: c.request.headers }));
}
export async function routeTeacherLiveTicket(c, lessonId) {
  await requireTeacher(c);
  await getLesson(c.db, lessonId);
  return json({ ok: true, ...(await liveTicket(c, lessonId, "teacher", "t")) });
}
export async function routeTeacherLiveState(c, lessonId) {
  await requireTeacher(c);
  return json({ ok: true, live: await liveState(c, lessonId, "teacher") });
}
/* Anonyme Umfrage (Nachtrag 46): Stand aller Umfragen der Sitzung für die Sitzungsseite der Lehrkraft (läuft / beendet, Zahlen je Antwort) */
export async function routeTeacherPolls(c, lessonId) {
  await requireTeacher(c);
  await getLesson(c.db, lessonId);
  const r = await stub(c.env, lessonId).fetch("https://live/polls");
  return json({ ok: true, ...(await r.json()), now: c.now });
}
/* „Ergebnis löschen und Umfrage neu öffnen“: Zählung und Ergebnis dieser Umfrage verschwinden (z. B. nach einem Probelauf zu Hause) – danach kann wieder jedes
   Gerät einmal abstimmen, sobald die Folie live gezeigt wird */
export async function routeTeacherPollReset(c, lessonId) {
  await requireTeacher(c);
  const l = await getLesson(c.db, lessonId);
  const body = await readJson(c.request, 2000);
  if (typeof body.k !== "string" || !POLL_KEY_RE.test(body.k)) throw bad("Diese Umfrage gibt es nicht.");
  await c.db.prepare("UPDATE lessons SET polls=?2 WHERE id=?1").bind(lessonId, pollResultsDrop(l.polls, { k: body.k })).run();
  await stub(c.env, lessonId).fetch("https://live/poll-reset?k=" + encodeURIComponent(body.k), { method: "POST" });
  return json({ ok: true });
}
export async function routeTeacherLiveStop(c, lessonId) {
  await requireTeacher(c);
  await stub(c.env, lessonId).fetch("https://live/reset", { method: "POST" });
  return json({ ok: true });
}
