// boot.js – Startdatei von Unterricks (S24, 14.11.2026). Alle Programmteile liegen je Stand in einem eigenen Ordner /v/<Stand>/ und laden einander
// relativ – so führt eine Seite nie Programmteile zweier Stände zusammen aus (Fehler vom 14.11.2026: ein vor dem Deploy geöffneter Tab lud nach dem
// Deploy die neue session.js zur alten portalview.js – „does not provide an export named 'keepFocusOn'“). index.html lädt /v/<Stand>/app.js direkt
// (die Seite steht wie bisher beim load-Ereignis) und danach diese Datei; sie liegt unversioniert unter /boot.js und bleibt über alle Deploys gleich.
//   0. Läuft die Oberfläche schon (update.js setzt <html data-unterricks>), tut sie nichts – der Normalfall.
//   1. Sonst (ein veraltetes index.html – GitHub Pages hält es bis zu 10 Minuten – verweist auf einen Stand, den es nicht mehr gibt; ein ganz
//      altes lädt noch /app.js, das ist diese Datei) den Stand erfragen: /version.json, nie aus einem Zwischenspeicher (cache: "no-store" für
//      den Browser, ?t=… für das CDN von GitHub Pages, das Abfragen ignoriert). Scheitert das, gilt der Stand aus <meta name="unterricks-build">.
//   2. Stylesheet des Stands sicherstellen und /v/<Stand>/app.js laden.
//   3. Scheitert das, ruhig erklären („Neu laden“, Technische Angabe) – von selbst neu laden nur, wenn inzwischen ein anderer Stand
//      ausgeliefert wird, und höchstens einmal je Stand (Merker in sessionStorage, gemeinsam mit update.js) – nie eine Schleife.
// Diese Datei kann aus einem Zwischenspeicher noch in der vorigen Fassung kommen: Änderungen müssen zu älteren Ständen passen; keine Importe.
export const BUILD_RE = /^[a-f0-9]{12}$/;
export const RELOAD_KEY = "u.reload";   // { to: Stand, at: Zeitpunkt } – wohin dieser Tab zuletzt von selbst neu geladen hat (update.js liest ihn auch)
export const VERSION_TIMEOUT_MS = 4000;
export const STARTED_ATTR = "data-unterricks";   // setzt update.js, sobald die Oberfläche läuft
export const BOOT_TEXT = {
  title: "Unterricks konnte nicht geladen werden",
  sie: "Vermutlich ist die Internetverbindung unterbrochen oder Unterricks wird gerade aktualisiert. Prüfen Sie die Verbindung und laden Sie die Seite " +
    "neu – Sie kommen an dieselbe Stelle zurück.",
  du: "Vermutlich ist die Internetverbindung unterbrochen oder Unterricks wird gerade aktualisiert. Prüfe die Verbindung und lade die Seite neu – " +
    "du kommst an dieselbe Stelle zurück.",
  button: "Neu laden",
  tech: "Technische Angabe: ",
};

/* Lehrkraft, Eltern und Beamer werden gesiezt, Schüler:innen (Startseite, #/schueler…) geduzt */
export const audienceOf = (hash) => (/^#\/(lk|lehrkraft|eltern|beamer)(\/|$)/.test(String(hash || "")) ? "sie" : "du");

/* Schutz vor einer Schleife: je Tab (sessionStorage) höchstens ein automatisches Neuladen je Ziel-Stand. Ohne Speicher nie automatisch. */
export function mayAutoReload(storage, to) {
  if (!storage || !BUILD_RE.test(String(to || ""))) return false;
  let raw;
  try { raw = storage.getItem(RELOAD_KEY); } catch { return false; }
  let r = null;
  try { r = JSON.parse(raw); } catch {}
  return !(r && r.to === to);
}
export function noteAutoReload(storage, to, now) {
  try { storage.setItem(RELOAD_KEY, JSON.stringify({ to, at: now })); return (JSON.parse(storage.getItem(RELOAD_KEY)) || {}).to === to; } catch { return false; }
}

/* Aktueller Stand laut Server – oder null (kein Netz, Zeitüberschreitung, unbrauchbare Antwort) */
export async function fetchBuild(fetchFn, now, timeoutMs = VERSION_TIMEOUT_MS) {
  const ctl = typeof AbortController === "function" ? new AbortController() : null;
  const t = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const r = await fetchFn("/version.json?t=" + now, { cache: "no-store", credentials: "omit", signal: ctl ? ctl.signal : undefined });
    if (!r || !r.ok) return null;
    const d = await r.json();
    return d && typeof d.build === "string" && BUILD_RE.test(d.build) ? d.build : null;
  } catch { return null; } finally { if (t) clearTimeout(t); }
}

/* Stylesheet des Stands: steht es schon in index.html, nichts tun; sonst einfügen und – sobald geladen – die alten Verweise entfernen */
export function ensureStyles(doc, id, waitMs = 3000) {
  const href = "/v/" + id + "/styles.css";
  const links = Array.from(doc.querySelectorAll('link[rel="stylesheet"]'));
  if (links.some((l) => l.getAttribute("href") === href)) return Promise.resolve(false);
  const old = links.filter((l) => /^\/(v\/[a-f0-9]{12}\/)?styles\.css$/.test(l.getAttribute("href") || ""));
  const l = doc.createElement("link");
  l.setAttribute("rel", "stylesheet"); l.setAttribute("href", href);
  return new Promise((resolve) => {
    let done = false;
    const end = (ok) => { if (done) return; done = true; clearTimeout(t); if (ok) for (const x of old) x.remove(); resolve(true); };
    const t = setTimeout(() => end(false), waitMs);
    l.onload = () => end(true); l.onerror = () => end(false);
    doc.head.appendChild(l);
  });
}

/* Ruhige Meldung statt einer leeren Seite (nur DOM-Aufrufe, Text per textContent) */
export function showFailure(win, doc, err) {
  const aud = audienceOf(win.location.hash), el = (tag, cls, text) => { const x = doc.createElement(tag); if (cls) x.className = cls; if (text) x.textContent = text; return x; };
  const btn = el("button", "btn primary", BOOT_TEXT.button);
  btn.setAttribute("type", "button");
  btn.addEventListener("click", () => win.location.reload());
  const card = el("section", "card");
  card.append(el("h1", null, BOOT_TEXT.title), el("p", null, BOOT_TEXT[aud]), el("p", null));
  card.lastChild.append(btn);
  const detail = err ? String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 300) : "";
  if (detail) card.append(el("p", "small muted", BOOT_TEXT.tech + detail));
  const main = el("main", "narrow loadfail");
  main.append(card);
  // ohne geladenes Stylesheet (sein Stand fehlt ebenfalls) das unversionierte /styles.css – der Hinweis soll wie Unterricks aussehen
  const styled = Array.from(doc.styleSheets || []).some((sh) => { try { return sh.cssRules.length > 0; } catch { return false; } });
  if (!styled) { const l = doc.createElement("link"); l.setAttribute("rel", "stylesheet"); l.setAttribute("href", "/styles.css"); doc.head.appendChild(l); }
  const app = doc.getElementById("app") || doc.body;
  while (app.firstChild) app.firstChild.remove();
  app.append(main);
  return main;
}

export async function start(env) {
  const { win, doc } = env;
  if (win.top !== win.self) { doc.documentElement.hidden = true; return "framed"; }   // wie app.js: nie in fremden Seiten
  if (doc.documentElement.hasAttribute(STARTED_ATTR)) return "running";   // index.html hat den Stand gestartet (der Normalfall)
  const meta = doc.querySelector('meta[name="unterricks-build"]');
  const given = meta && BUILD_RE.test(meta.getAttribute("content") || "") ? meta.getAttribute("content") : null;
  const latest = await fetchBuild(env.fetch, env.now());
  const id = latest || given;
  if (!id) { showFailure(win, doc, new Error("Kein Stand gefunden (version.json).")); return "failed"; }
  // der Stand, der jetzt läuft (auch für Rückfragen und Tests) – ein index.html von vor der Umstellung hat das <meta> noch nicht
  if (meta) meta.setAttribute("content", id);
  else { const m = doc.createElement("meta"); m.setAttribute("name", "unterricks-build"); m.setAttribute("content", id); doc.head.appendChild(m); }
  await ensureStyles(doc, id, env.styleWaitMs);
  try { await env.importApp("/v/" + id + "/app.js"); return "ok:" + id; }
  catch (e) {
    // inzwischen ein anderer Stand (Deploy genau jetzt)? Dann einmal neu laden – sonst erklären
    const again = await fetchBuild(env.fetch, env.now());
    if (again && again !== id && mayAutoReload(env.storage, again) && noteAutoReload(env.storage, again, env.now())) { win.location.reload(); return "reload:" + again; }
    showFailure(win, doc, e);
    return "failed";
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined" && !window.__unterricksNoBoot) {
  let storage = null;
  try { storage = window.sessionStorage; } catch {}
  start({ win: window, doc: document, storage, fetch: (u, o) => fetch(u, o), now: () => Date.now(), importApp: (u) => import(u) });
}
