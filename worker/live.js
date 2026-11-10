// live.js – Live-Synchronisation der Präsentation: ein Durable Object je Sitzung (SQLite-Backend, im Free-Plan verfügbar) mit
// WebSocket-Hibernation. Nur die Lehrkraft kann Folien wechseln; Schüler:innen erhalten nur die aktuelle Folie als signierten Link
// (sie können also nicht vorblättern). Fällt der WebSocket aus, fragt der Browser den Stand alle 2 s über HTTP ab.
import { DurableObject } from "cloudflare:workers";
import { HttpError, json, requireSecret, signLink, checkLink, isId } from "./lib.js";
import { requireTeacher } from "./auth.js";
import { getLesson } from "./lessons.js";
import { slideUrl } from "./files.js";

const IDLE = { active: false, fileId: null, pages: 0, slide: 1, startedAt: null, updatedAt: null, v: 0 };
const SLIDE_TTL = 3 * 3600e3;

export class LiveRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong")); } catch {}
  }
  async state() { return (await this.ctx.storage.get("state")) || { ...IDLE }; }
  async message(role, st) {
    st = st || (await this.state());
    const out = { t: "state", active: !!st.active, slide: st.slide, pages: st.pages, v: st.v, updatedAt: st.updatedAt };
    if (st.active && st.fileId) out.url = await slideUrl(requireSecret(this.env), st.fileId, st.slide, SLIDE_TTL);
    if (role === "teacher") { out.fileId = st.fileId; out.students = this.ctx.getWebSockets("student").length; }
    return out;
  }
  async broadcast(st) {
    const forStudents = JSON.stringify(await this.message("student", st)), forTeachers = JSON.stringify(await this.message("teacher", st));
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(this.ctx.getTags(ws).includes("teacher") ? forTeachers : forStudents); } catch {}
    }
  }
  countToTeachers(minus = 0) {
    const n = Math.max(0, this.ctx.getWebSockets("student").length - minus), msg = JSON.stringify({ t: "count", students: n });
    for (const ws of this.ctx.getWebSockets("teacher")) { try { ws.send(msg); } catch {} }
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      if ((request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") return new Response("WebSocket erwartet", { status: 426 });
      const role = url.searchParams.get("role") === "teacher" ? "teacher" : "student";
      const pair = new WebSocketPair(), [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, [role]);
      server.send(JSON.stringify(await this.message(role)));
      if (role === "student") this.countToTeachers();
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === "/state") return Response.json(await this.message(url.searchParams.get("role")));
    if (url.pathname === "/reset" && request.method === "POST") {
      const st = { ...IDLE, v: ((await this.state()).v || 0) + 1, updatedAt: Date.now() };
      await this.ctx.storage.put("state", st);
      await this.broadcast(st);
      return Response.json({ ok: true });
    }
    return new Response("nicht gefunden", { status: 404 });
  }
  async webSocketMessage(ws, raw) {
    if (raw === "ping") { try { ws.send("pong"); } catch {} return; }
    if (!this.ctx.getTags(ws).includes("teacher")) return;   // Schüler:innen können nichts steuern
    let m; try { m = JSON.parse(String(raw)); } catch { return; }
    const st = await this.state(), now = Date.now();
    if (m.t === "start" && typeof m.fileId === "string" && isId(m.fileId) && Number.isInteger(m.pages) && m.pages >= 1 && m.pages <= 300) {
      const slide = Number.isInteger(m.slide) ? Math.min(Math.max(1, m.slide), m.pages) : 1;
      Object.assign(st, { active: true, fileId: m.fileId, pages: m.pages, slide, startedAt: now });
    } else if (m.t === "goto" && st.active && Number.isInteger(m.slide)) {
      st.slide = Math.min(Math.max(1, m.slide), st.pages);
    } else if (m.t === "stop") {
      Object.assign(st, { ...IDLE });
    } else if (m.t === "hello") {
      try { ws.send(JSON.stringify(await this.message("teacher", st))); } catch {}
      return;
    } else return;
    st.v = (st.v || 0) + 1; st.updatedAt = now;
    await this.ctx.storage.put("state", st);
    await this.broadcast(st);
  }
  async webSocketClose(ws, code, reason) {
    const student = this.ctx.getTags(ws).includes("student");
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch {}
    if (student) this.countToTeachers(this.ctx.getWebSockets("student").includes(ws) ? 1 : 0);
  }
  async webSocketError(ws) {
    try { ws.close(1011, "Fehler"); } catch {}
  }
}

const stub = (env, lessonId) => env.LIVE.get(env.LIVE.idFromName(lessonId));

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
  const u = new URL(c.request.url), role = u.searchParams.get("r") === "teacher" ? "teacher" : "student", sub = u.searchParams.get("u") || "";
  if (!isId(lessonId) || !(await checkLink(requireSecret(c.env), ["live", lessonId, role, sub], u.searchParams.get("e"), u.searchParams.get("s"), c.now)))
    throw new HttpError(403, "bad_ticket", "Die Verbindung wurde abgelehnt. Bitte die Seite neu laden.");
  if ((c.request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") throw new HttpError(426, "upgrade_required", "WebSocket erwartet.");
  return stub(c.env, lessonId).fetch(new Request("https://live/ws?role=" + role, { headers: c.request.headers }));
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
