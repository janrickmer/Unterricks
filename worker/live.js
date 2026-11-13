// live.js – Live-Synchronisation der Präsentation: ein Durable Object je Sitzung (SQLite-Backend, im Free-Plan verfügbar) mit
// WebSocket-Hibernation. Nur die Lehrkraft kann Folien wechseln; Schüler:innen erhalten nur die aktuelle Folie als signierten Link
// (sie können also nicht vorblättern). Fällt der WebSocket aus, fragt der Browser den Stand alle 2 s über HTTP ab.
// Codefolie (11.11.2026): Folie 0 = Sitzungscode mit QR-Code vor Folie 1, Platzhalterfolien (codeSlides) und „Sitzungscode zeigen“
// (codeShown) erscheinen bei allen als Codefolie (view "code" mit code, title, lines) – Code, Titel und Platzhalter schickt die Lehrkraft beim Start.
// Beamergeräte (Nachtrag 15, worker/beamer.js): dritte Rolle „beamer“ – sehen dasselbe wie die Schüler:innen und zusätzlich die nächste Folie
// zum Vorladen (next), zählen nicht als Schüler:innen (die Lehrkraft bekommt ihre Zahl als beamers) und steuern nichts. Ihre Schlüssel tragen
// die Generation bgen; „Beamer trennen“ (/beamer-reset) erhöht sie und schließt alle Beamer-Verbindungen (Code 4001).
import { DurableObject } from "cloudflare:workers";
import { HttpError, json, requireSecret, signLink, checkLink, isId } from "./lib.js";
import { LIVE_IDLE as IDLE, liveReduce, liveView, liveNext } from "./livestate.js";
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
  async message(role, st) {
    st = st || (await this.state());
    const out = { t: "state", active: !!st.active, slide: st.slide, pages: st.pages, v: st.v, updatedAt: st.updatedAt };
    const view = liveView(st);   // Folienbild nur für echte Seiten; Codefolie vor Folie 1, an Platzhalterfolien und bei „Sitzungscode zeigen“
    if (view.slide) out.url = await slideUrl(requireSecret(this.env), st.fileId, view.slide, SLIDE_TTL);
    if (view.code) Object.assign(out, { view: "code", ...view.code });
    if (role === "teacher") { out.fileId = st.fileId; out.students = this.ctx.getWebSockets("student").length; out.beamers = this.ctx.getWebSockets("beamer").length; }
    if (role === "beamer") { const k = liveNext(st); if (k) out.next = await slideUrl(requireSecret(this.env), st.fileId, k, SLIDE_TTL); }   // vorladen
    return out;
  }
  async broadcast(st) {
    const forStudents = JSON.stringify(await this.message("student", st)), forTeachers = JSON.stringify(await this.message("teacher", st));
    const all = this.ctx.getWebSockets(), role = (ws) => { const t = this.ctx.getTags(ws); return t.includes("teacher") ? "teacher" : t.includes("beamer") ? "beamer" : "student"; };
    const forBeamers = all.some((ws) => role(ws) === "beamer") ? JSON.stringify(await this.message("beamer", st)) : forStudents;
    for (const ws of all) {
      const r = role(ws);
      try { ws.send(r === "teacher" ? forTeachers : r === "beamer" ? forBeamers : forStudents); } catch {}
    }
  }
  // Zahl der Schüler:innen und Beamer an die Lehrkraft; gone = gerade geschlossene Verbindungen (zählen nicht mehr mit)
  countToTeachers(gone = []) {
    const n = (role) => this.ctx.getWebSockets(role).filter((ws) => !gone.includes(ws)).length;
    const msg = JSON.stringify({ t: "count", students: n("student"), beamers: n("beamer") });
    for (const ws of this.ctx.getWebSockets("teacher")) { try { ws.send(msg); } catch {} }
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
      const pair = new WebSocketPair(), [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [role]);
      server.send(JSON.stringify(await this.message(role)));
      if (role !== "teacher") this.countToTeachers();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/state") return Response.json(await this.message(role));
    if (url.pathname === "/beamer-gen") return Response.json({ gen: await this.beamerGen() });
    if (url.pathname === "/beamer-reset" && request.method === "POST") { await this.resetBeamers(); return Response.json({ ok: true }); }
    if (url.pathname === "/reset" && request.method === "POST") {
      const st = { ...IDLE, v: ((await this.state()).v || 0) + 1, updatedAt: Date.now() };
      await this.ctx.storage.put("state", st);
      await this.broadcast(st);
      if (url.searchParams.get("beamers") === "1") await this.resetBeamers();   // Sitzung gelöscht: auch die Beamer trennen
      return Response.json({ ok: true });
    }
    return new Response("nicht gefunden", { status: 404 });
  }
  async webSocketMessage(ws, raw) {
    if (raw === "ping") { try { ws.send("pong"); } catch {} return; }
    if (!this.ctx.getTags(ws).includes("teacher")) return;   // Schüler:innen können nichts steuern
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    if (!m || typeof m !== "object") return;
    const st = await this.state(), now = Date.now();
    if (m.t === "hello") {
      try { ws.send(JSON.stringify(await this.message("teacher", st))); } catch {}
      return;
    }
    if (!liveReduce(st, m, now)) return;
    await this.ctx.storage.put("state", st);
    await this.broadcast(st);
  }
  async webSocketClose(ws, code, reason) {
    const counted = !this.ctx.getTags(ws).includes("teacher");   // Schüler:innen und Beamer
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch {}
    if (counted) this.countToTeachers([ws]);
  }
  async webSocketError(ws) {
    try { ws.close(1011, "Fehler"); } catch {}
  }
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
  // Beamer: u = Generation seines Schlüssels – das Durable Object lehnt eine veraltete ab
  return stub(c.env, lessonId).fetch(new Request("https://live/ws?role=" + role + (role === "beamer" ? "&gen=" + encodeURIComponent(sub) : ""), { headers: c.request.headers }));
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
export async function routeTeacherLiveStop(c, lessonId) {
  await requireTeacher(c);
  await stub(c.env, lessonId).fetch("https://live/reset", { method: "POST" });
  return json({ ok: true });
}
