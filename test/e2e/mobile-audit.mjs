// mobile-audit.mjs – Prüfung „nur senkrecht scrollen“ (Wunsch der Lehrkraft vom 10.11.2026): Auf Handy und iPad darf nichts über den
// rechten oder linken Rand ragen und kein Bereich seitlich scrollen. Liefert je Seite die Fundstellen mit Beschreibung (für die Fehlersuche).
export async function horizontalIssues(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const css = (el) => getComputedStyle(el);
    const name = (el) => {
      let s = el.tagName.toLowerCase();
      if (el.id) s += "#" + el.id;
      const cls = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
      if (cls.length) s += "." + cls.join(".");
      return s;
    };
    const path = (el) => { const out = []; for (let p = el, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) out.unshift(name(p)); return out.join(" > "); };
    const text = (el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 50);
    const hidden = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const c = css(p); if (c.display === "none" || c.visibility === "hidden" || p.classList.contains("sr-only") || p.id === "toasts") return true; } return false; };
    // steckt das Element in einem Bereich, der selbst innerhalb des Bildschirms liegt und Überstand abschneidet bzw. scrollt?
    const clippedBy = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const c = css(p); if (/(hidden|clip|auto|scroll)/.test(c.overflowX)) return p; } return null; };
    const issues = [];
    const docW = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    if (docW > W + 1) issues.push({ kind: "Seite", detail: "Seite ist " + docW + " px breit bei " + W + " px Bildschirm" });
    const over = [];
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right <= W + 1 && r.left >= -1) continue;
      if (hidden(el)) continue;
      const c = clippedBy(el);
      if (c) { const cr = c.getBoundingClientRect(); if (cr.right <= W + 1 && cr.left >= -1 && !/(auto|scroll)/.test(css(c).overflowX)) continue; }   // sauber abgeschnitten (z. B. Dekoration)
      if (c && /(auto|scroll)/.test(css(c).overflowX)) continue;   // steht unten als seitlich scrollender Bereich
      over.push(el);
    }
    // nur die innersten Verursacher (deren Kinder nicht selbst überstehen) und je Kette einmal
    const set = new Set(over);
    for (const el of over) {
      if ([...el.children].some((ch) => set.has(ch))) continue;
      const r = el.getBoundingClientRect(), c = css(el);
      issues.push({ kind: "ragt über den Rand", sel: path(el), text: text(el), left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
        css: [c.display, "white-space:" + c.whiteSpace, c.minWidth !== "0px" && c.minWidth !== "auto" ? "min-width:" + c.minWidth : "", c.width !== "auto" ? "width:" + c.width : "", c.flex !== "0 1 auto" ? "flex:" + c.flex : ""].filter(Boolean).join(" ") });
    }
    for (const el of document.querySelectorAll("body *")) {
      const c = css(el);
      if (!/(auto|scroll)/.test(c.overflowX) || el.clientWidth === 0 || el.scrollWidth <= el.clientWidth + 2 || hidden(el)) continue;
      issues.push({ kind: "scrollt seitlich", sel: path(el), text: text(el), scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    }
    return { W, issues: issues.slice(0, 25) };
  });
}

// Sichtbare Textreste „null“ / „undefined“ (z. B. aus element.append(…, null)) – je Seite die Fundstellen
export async function strayTexts(page) {
  return page.evaluate(() => {
    const out = [], walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const t = n.nodeValue.trim();
      if (t !== "null" && t !== "undefined" && t !== "NaN" && t !== "[object Object]") continue;
      const el = n.parentElement; if (!el || el.closest("textarea, pre, code, script, style")) continue;
      const path = []; for (let p = el, i = 0; p && p !== document.body && i < 5; p = p.parentElement, i++) path.unshift(p.tagName.toLowerCase() + (p.className && typeof p.className === "string" ? "." + p.className.trim().split(/\s+/).slice(0, 2).join(".") : ""));
      out.push({ text: t, sel: path.join(" > ") });
    }
    return out.slice(0, 10);
  });
}
