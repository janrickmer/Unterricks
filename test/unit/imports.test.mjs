import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

// Grobe Prüfung ohne Bundler: Ruft eine Datei eine Funktion (bzw. nutzt eine Konstante in GROSSBUCHSTABEN), die ein anderes Modul des
// Projekts exportiert, muss sie sie importieren oder selbst deklarieren. Fehlt der Import, scheitert sie erst zur Laufzeit – so war am
// 11.11.2026 nach dem Auslagern der Live-Logik `isId` in worker/live.js nicht mehr importiert und jede Live-Verbindung scheiterte.
const R = fileURLToPath(new URL("../../", import.meta.url));
const files = ["worker", "public"].flatMap((d) => readdirSync(join(R, d)).filter((f) => f.endsWith(".js")).map((f) => d + "/" + f));
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(R, f), "utf8")]));
const names = (list) => list.split(",").map((x) => x.trim().split(/\s+as\s+/).pop().split(":").pop().split("=")[0].trim()).filter(Boolean);
const exportsOf = (s) => [...s.matchAll(/export (?:const|let|function\*?|async function|class) (\w+)/g)].map((m) => m[1]).concat([...s.matchAll(/export \{([^}]*)\}/g)].flatMap((m) => names(m[1])));

test("jede Funktion aus einem anderen Modul des Projekts ist importiert (worker/ und public/)", () => {
  const exp = new Map();
  for (const f of files) for (const n of exportsOf(src[f])) exp.set(n, [...(exp.get(n) || []), f]);
  const missing = [];
  for (const f of files) {
    const s = src[f];
    const body = s.replace(/^\s*import[\s\S]*?from\s+["'][^"']+["'];?/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');
    const known = new Set([...s.matchAll(/import\s*\{([^}]*)\}\s*from/g)].flatMap((m) => names(m[1])).concat([...s.matchAll(/import\s+(\w+)\s+from/g)].map((m) => m[1]))
      .concat([...body.matchAll(/(?:const|let|var|function\*?|class)\s+(\w+)/g)].map((m) => m[1])).concat([...body.matchAll(/\{([^{}]*)\}\s*=(?!=)/g)].flatMap((m) => names(m[1]))));
    for (const [n, from] of exp) {
      if (from.includes(f) || known.has(n)) continue;
      const called = new RegExp("(?<![\\w.$])" + n + "\\s*\\(").test(body), constUse = /^[A-Z][A-Z0-9_]+$/.test(n) && new RegExp("(?<![\\w.$])" + n + "(?![\\w$:])").test(body);
      if (called || constUse) missing.push(f + ": " + n + " (aus " + from.join(", ") + ")");
    }
  }
  assert.deepEqual(missing, []);
});
