// index.js – Einstieg des Unterricks-Workers: Routing, Fehlerbehandlung, Sicherheitskopfzeilen der Seite, Durable Object.
import { HttpError, json, fail, clientIp, corsHeaders, withCors } from "./lib.js";
import { ensureSchema, cleanupStatements } from "./db.js";
import * as A from "./auth.js";
import * as L from "./lessons.js";
import * as F from "./files.js";
import * as S from "./student.js";
import * as LV from "./live.js";
import * as AI from "./ai.js";
import * as M from "./mcp.js";
import * as B from "./bases.js";
import * as U from "./units.js";
import * as SUB from "./substitute.js";

export { LiveRoom } from "./live.js";

const DEFAULT_FB_API = "https://feibeitsblatt.feindt.workers.dev";
const DEFAULT_FB_URL = "https://feibeitsblatt.janrickmer.de/";
const ID = "([a-f0-9]{16})";

const ROUTES = [
  ["GET", "/api/health", async () => json({ ok: true, service: "unterricks" }), { noDb: true }],
  ["GET", "/api/config", async (c) => json({ ok: true, feibeitsblattApi: fbApi(c.env), feibeitsblattUrl: c.env.FEIBEITSBLATT_URL || DEFAULT_FB_URL }), { noDb: true }],
  // Lehrkraft: Zugang
  ["POST", "/api/teacher/status", A.routeTeacherStatus],
  ["POST", "/api/teacher/salt", A.routeTeacherSalt],
  ["POST", "/api/teacher/setup", A.routeTeacherSetup],
  ["POST", "/api/teacher/login", A.routeTeacherLogin],
  ["POST", "/api/teacher/logout", A.routeTeacherLogout],
  ["GET", "/api/teacher/me", A.routeTeacherMe],
  ["POST", "/api/teacher/password", A.routeTeacherPassword],
  ["POST", "/api/teacher/devices/forget", A.routeTeacherForgetDevices],
  ["GET", "/api/teacher/fb-link", A.routeFbLinkGet],
  ["PUT", "/api/teacher/fb-link", A.routeFbLinkPut],
  ["DELETE", "/api/teacher/fb-link", A.routeFbLinkDelete],
  ["GET", "/api/teacher/student-settings", A.routeStudentSettingsGet],
  ["PUT", "/api/teacher/student-settings", A.routeStudentSettingsPut],
  // Lehrkraft: KI und Connector
  ["GET", "/api/teacher/ai", AI.routeAiGet],
  ["PUT", "/api/teacher/ai", AI.routeAiPut],
  ["POST", "/api/teacher/ai/models", AI.routeAiModels],
  ["POST", "/api/teacher/ai/test", AI.routeAiTest],
  ["GET", "/api/teacher/mcp", M.routeMcpGet],
  ["POST", "/api/teacher/mcp", M.routeMcpCreate],
  ["DELETE", "/api/teacher/mcp", M.routeMcpDelete],
  // Fach-Einstellungen und Planungsgrundlagen
  ["GET", "/api/subjects", B.routeSubjectsPublic],
  ["GET", "/api/teacher/subjects", B.routeSubjectsGet],
  ["PUT", "/api/teacher/subjects/(powi|evrel|ethik)", B.routeSubjectPut],
  ["GET", "/api/teacher/bases", B.routeBasesList],
  ["POST", "/api/teacher/bases", B.routeBaseCreate],
  ["PUT", "/api/teacher/bases/" + ID + "/pages", B.routeBasePages],
  ["PATCH", "/api/teacher/bases/" + ID, B.routeBasePatch],
  ["DELETE", "/api/teacher/bases/" + ID, B.routeBaseDelete],
  ["GET", "/api/teacher/bases/" + ID + "/text", B.routeBaseText],
  ["GET", "/api/teacher/basis", B.routeBasisPreview],
  // Unterrichtseinheiten
  ["GET", "/api/teacher/units", U.routeUnitsList],
  ["POST", "/api/teacher/units", U.routeUnitCreate],
  ["GET", "/api/teacher/units/" + ID, U.routeUnitGet],
  ["PATCH", "/api/teacher/units/" + ID, U.routeUnitPatch],
  ["DELETE", "/api/teacher/units/" + ID, U.routeUnitDelete],
  ["POST", "/api/teacher/units/" + ID + "/sessions", U.routeUnitSessions],
  ["PUT", "/api/teacher/units/" + ID + "/rows/([a-f0-9]{8})", U.routeUnitRowPut],
  // Krankheitsvertretung
  ["POST", "/api/teacher/lessons/" + ID + "/substitute/confirm", SUB.routeSubstituteConfirm],
  ["POST", "/api/teacher/lessons/" + ID + "/substitute/discard", SUB.routeSubstituteDiscard],
  ["POST", "/api/teacher/lessons/" + ID + "/substitute/restore", SUB.routeSubstituteRestore],
  ["POST", "/api/teacher/lessons/" + ID + "/substitute/transfer", SUB.routeSubstituteTransfer],
  ["GET", "/api/teacher/lessons/" + ID + "/escape", SUB.routeTeacherEscape],
  ["GET", "/api/student/lessons/" + ID + "/escape", SUB.routeStudentEscape],
  // Lehrkraft: Sitzungen
  ["GET", "/api/teacher/lessons", L.routeLessonsList],
  ["POST", "/api/teacher/lessons", L.routeLessonCreate],
  ["GET", "/api/teacher/lessons/" + ID, L.routeLessonGet],
  ["PATCH", "/api/teacher/lessons/" + ID, L.routeLessonPatch],
  ["DELETE", "/api/teacher/lessons/" + ID, L.routeLessonDelete],
  ["PUT", "/api/teacher/lessons/" + ID + "/portal", L.routePortalPut],
  ["POST", "/api/teacher/lessons/" + ID + "/portal/generate", L.routePortalGenerate],
  ["POST", "/api/teacher/lessons/" + ID + "/chat", L.routeChatPost],
  ["POST", "/api/teacher/lessons/" + ID + "/chat/answer", L.routeChatAnswer],
  ["DELETE", "/api/teacher/lessons/" + ID + "/chat", L.routeChatClear],
  ["DELETE", "/api/teacher/lessons/" + ID + "/chat/(\\d+)", L.routeChatDeleteOne],
  ["POST", "/api/teacher/lessons/" + ID + "/fb-drafts/generate", L.routeDraftGenerate],
  ["PUT", "/api/teacher/fb-drafts/" + ID, L.routeDraftPut],
  ["DELETE", "/api/teacher/fb-drafts/" + ID, L.routeDraftDelete],
  ["POST", "/api/teacher/fb-drafts/" + ID + "/created", L.routeDraftCreated],
  ["POST", "/api/teacher/lessons/" + ID + "/sheets", L.routeSheetLink],
  ["DELETE", "/api/teacher/lessons/" + ID + "/sheets/([A-Za-z0-9%-]{1,20})", L.routeSheetUnlink],
  ["POST", "/api/teacher/lessons/" + ID + "/sheets/([A-Za-z0-9%-]{1,20})/notfall", F.routeNotfallUpload],
  // Lehrkraft: Dateien und Präsentation
  ["POST", "/api/teacher/lessons/" + ID + "/files", F.routeFileUpload],
  ["POST", "/api/teacher/lessons/" + ID + "/texts", F.routeTextCreate],
  ["POST", "/api/teacher/lessons/" + ID + "/links", F.routeLinkCreate],
  ["POST", "/api/teacher/lessons/" + ID + "/print", F.routePrintUpload],
  ["POST", "/api/teacher/lessons/" + ID + "/import", L.routeLessonImport],
  ["PATCH", "/api/teacher/files/" + ID, F.routeFilePatch],
  ["DELETE", "/api/teacher/files/" + ID, F.routeFileDelete],
  ["POST", "/api/teacher/files/" + ID + "/link", F.routeTeacherFileLink],
  ["POST", "/api/teacher/lessons/" + ID + "/presentation", F.routePresentationUpload],
  ["PUT", "/api/teacher/files/" + ID + "/slides/(\\d{1,3})", F.routeSlideUpload],
  ["POST", "/api/teacher/files/" + ID + "/ready", F.routePresentationReady],
  ["GET", "/api/teacher/files/" + ID + "/slides", F.routeTeacherSlides],
  ["PUT", "/api/teacher/files/" + ID + "/shown", F.routeShownPut],
  ["DELETE", "/api/teacher/files/" + ID + "/shown", F.routeShownDelete],
  ["POST", "/api/teacher/lessons/" + ID + "/live-ticket", LV.routeTeacherLiveTicket],
  ["GET", "/api/teacher/lessons/" + ID + "/live", LV.routeTeacherLiveState],
  ["POST", "/api/teacher/lessons/" + ID + "/live/stop", LV.routeTeacherLiveStop],
  // Schüler:innen
  ["POST", "/api/student/login", A.routeStudentLogin],
  ["GET", "/api/student/me", S.routeStudentMe],
  ["PUT", "/api/student/profile", A.routeStudentProfile],
  ["POST", "/api/student/join", S.routeStudentJoin],
  ["GET", "/api/student/lessons/" + ID, S.routeStudentLesson],
  ["POST", "/api/student/files/" + ID + "/link", S.routeStudentFileLink],
  ["POST", "/api/student/lessons/" + ID + "/presentation-link", S.routeStudentPresentationLink],
  ["POST", "/api/student/lessons/" + ID + "/ask", S.routeStudentAsk],
  ["POST", "/api/student/lessons/" + ID + "/live-ticket", S.routeStudentLiveTicket],
  ["GET", "/api/student/lessons/" + ID + "/live", S.routeStudentLiveState],
  // Ausliefern über signierte Links und Live-Verbindung
  ["GET", "/api/dl/" + ID, F.routeDownload],
  ["GET", "/api/slide/" + ID + "/(\\d{1,3})", F.routeSlide],
  ["GET", "/api/live/" + ID, LV.routeLiveSocket],
].map(([method, pat, handler, opts]) => ({ method, re: new RegExp("^" + pat + "$"), handler, opts: opts || {} }));

const fbApi = (env) => String(env.FEIBEITSBLATT_API || DEFAULT_FB_API).replace(/\/+$/, "");

async function handleApi(request, env, ctx, path) {
  let allowed = [];
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    if (r.method !== request.method) { allowed.push(r.method); continue; }
    const c = { request, env, db: env.DB, now: Date.now(), ip: clientIp(request), waitUntil: (p) => ctx && ctx.waitUntil && ctx.waitUntil(p) };
    if (!r.opts.noDb) {
      await ensureSchema(env.DB);
      if (Math.random() < 0.01) c.waitUntil(env.DB.batch(cleanupStatements(env.DB, c.now)).catch(() => {}));
    }
    return r.handler(c, ...m.slice(1));
  }
  if (allowed.length) return fail(405, "method_not_allowed", "Diese Aktion ist hier nicht erlaubt.");
  return fail(404, "not_found", "Nicht gefunden.");
}

function errorResponse(e) {
  if (e instanceof HttpError) return fail(e.status, e.code, e.message, e.extra || {});
  console.error("Fehler", e && e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : String(e));
  if (/D1|SQLITE|too many|limit/i.test(String(e && e.message))) return fail(503, "db_unavailable", "Die Datenbank ist gerade nicht erreichbar oder das Tageskontingent ist erschöpft. Bitte später erneut versuchen.");
  return fail(500, "server_error", "Interner Fehler. Bitte erneut versuchen.");
}

function securityHeaders(res, request, env) {
  const h = new Headers(res.headers);
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  h.set("X-Frame-Options", "DENY");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if ((h.get("content-type") || "").includes("text/html")) {
    const host = new URL(request.url).host;
    h.set("Content-Security-Policy", [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self'",
      "connect-src 'self' wss://" + host + " ws://" + host + " " + fbApi(env), "worker-src 'self' blob:", "frame-src 'none'",
      "object-src 'none'", "base-uri 'none'", "form-action 'self'", "frame-ancestors 'none'",
    ].join("; "));
    h.set("Cache-Control", "no-cache");
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export default {
  async scheduled(controller, env) {
    await ensureSchema(env.DB);
    await env.DB.batch(cleanupStatements(env.DB, Date.now()));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
    try {
      if (path === "/mcp" || path.startsWith("/mcp/")) {
        const tok = path.startsWith("/mcp/") ? decodeURIComponent(path.slice(5)) : "";
        const c = { request, env, db: env.DB, now: Date.now(), ip: clientIp(request), waitUntil: (p) => ctx && ctx.waitUntil && ctx.waitUntil(p) };
        await ensureSchema(env.DB);
        return await M.routeMcp(c, tok);
      }
      if (path === "/api" || path.startsWith("/api/")) {
        const cors = corsHeaders(request, env);
        if (request.method === "OPTIONS") return new Response(null, { status: cors ? 204 : 403, headers: cors || {} });
        try { return withCors(await handleApi(request, env, ctx, path), cors); }
        catch (e) { return withCors(errorResponse(e), cors); }
      }
    } catch (e) { return errorResponse(e); }
    const res = await env.ASSETS.fetch(request);
    return securityHeaders(res, request, env);
  },
};
