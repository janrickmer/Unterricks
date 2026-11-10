// markdown.js – sicherer Markdown-Renderer (nur DOM-Knoten und textContent, keine HTML-Übernahme).
// Unterstützt: Überschriften, Absätze, Listen (auch verschachtelt, nummeriert), Tabellen, Zitate, Code, Trennlinien,
// **fett**, *kursiv*, `Code`, [Text](https://…) und nackte https-Links. parseBlocks wird auch für die PDF-Erzeugung genutzt.

export function parseBlocks(src) {
  const lines = String(src == null ? "" : src).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let i = 0;
  const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const fence = /^\s*```/.exec(l);
    if (fence) {
      const buf = []; i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      i++; blocks.push({ type: "code", text: buf.join("\n") }); continue;
    }
    const hd = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (hd) { blocks.push({ type: "h", level: hd[1].length, text: hd[2] }); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { blocks.push({ type: "hr" }); i++; continue; }
    if (/\|/.test(l) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ type: "table", head, rows }); continue;
    }
    if (/^\s*>/.test(l)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
      blocks.push({ type: "quote", text: buf.join(" ") }); continue;
    }
    const li = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/.exec(l);
    if (li) {
      const items = [];
      while (i < lines.length) {
        const m = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/.exec(lines[i]);
        if (m) { items.push({ depth: Math.min(3, Math.floor(m[1].replace(/\t/g, "    ").length / 2)), ordered: /\d/.test(m[2]), num: parseInt(m[2], 10) || null, text: m[3] }); i++; continue; }
        if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) { items[items.length - 1].text += " " + lines[i].trim(); i++; continue; }
        break;
      }
      blocks.push({ type: "list", items }); continue;
    }
    const buf = [l.trim()]; i++;
    while (i < lines.length && lines[i].trim() && !/^\s*(#{1,6}\s|```|>|([-*+•]|\d{1,3}[.)])\s)/.test(lines[i]) && !(/\|/.test(lines[i]) && i + 1 < lines.length && isTableSep(lines[i + 1]))) buf.push(lines[i++].trim());
    blocks.push({ type: "p", text: buf.join("\n") });
  }
  return blocks;
}

/* Inline-Läufe: [{text, b, i, code, href}] */
export function parseInline(s) {
  const out = [];
  // ohne Lookbehind (ältere iPads/Safari)
  const re = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)([^*_\n]*?[^\s*_])\3(?![A-Za-z0-9])|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'])/g;
  let last = 0, m;
  const push = (text, f = {}) => { if (text) out.push({ text, ...f }); };
  while ((m = re.exec(s))) {
    push(s.slice(last, m.index));
    if (m[2] !== undefined) for (const r of parseInline(m[2])) out.push({ ...r, b: true });
    else if (m[4] !== undefined) for (const r of parseInline(m[4])) out.push({ ...r, i: true });
    else if (m[5] !== undefined) push(m[5], { code: true });
    else if (m[6] !== undefined) push(m[6], { href: m[7] });
    else if (m[8] !== undefined) push(m[8], { href: m[8] });
    last = m.index + m[0].length;
  }
  push(s.slice(last));
  return out;
}
export const plainInline = (s) => parseInline(s).map((r) => r.text).join("");

function inlineNodes(s) {
  const frag = document.createDocumentFragment();
  for (const r of parseInline(s)) {
    let n;
    if (r.href) { n = document.createElement("a"); n.href = r.href; n.target = "_blank"; n.rel = "noopener noreferrer"; n.textContent = r.text; }
    else if (r.code) { n = document.createElement("code"); n.textContent = r.text; }
    else {
      const parts = r.text.split("\n");
      n = document.createDocumentFragment();
      parts.forEach((p, k) => { if (k) n.append(document.createElement("br")); n.append(document.createTextNode(p)); });
    }
    if (r.i && !r.code) { const e = document.createElement("em"); e.append(n); n = e; }
    if (r.b && !r.code) { const e = document.createElement("strong"); e.append(n); n = e; }
    frag.append(n);
  }
  return frag;
}

export function renderMarkdown(src) {
  const root = document.createElement("div");
  root.className = "md";
  for (const b of parseBlocks(src)) {
    if (b.type === "h") { const e = document.createElement("h" + Math.min(4, b.level + 1)); e.append(inlineNodes(b.text)); root.append(e); }
    else if (b.type === "p") { const e = document.createElement("p"); e.append(inlineNodes(b.text)); root.append(e); }
    else if (b.type === "hr") root.append(document.createElement("hr"));
    else if (b.type === "code") { const pre = document.createElement("pre"), c = document.createElement("code"); c.textContent = b.text; pre.append(c); root.append(pre); }
    else if (b.type === "quote") { const q = document.createElement("blockquote"); q.append(inlineNodes(b.text)); root.append(q); }
    else if (b.type === "table") {
      const t = document.createElement("table"), th = document.createElement("thead"), tr = document.createElement("tr");
      for (const c of b.head) { const x = document.createElement("th"); x.append(inlineNodes(c)); tr.append(x); }
      th.append(tr); t.append(th);
      const tb = document.createElement("tbody");
      for (const row of b.rows) { const r = document.createElement("tr"); for (const c of row) { const x = document.createElement("td"); x.append(inlineNodes(c)); r.append(x); } tb.append(r); }
      t.append(tb); root.append(t);
    } else if (b.type === "list") {
      const stack = [];
      for (const it of b.items) {
        while (stack.length > it.depth + 1) stack.pop();
        while (stack.length < it.depth + 1) {
          const l = document.createElement(it.ordered ? "ol" : "ul");
          if (it.ordered && it.num && it.num > 1) l.start = it.num;
          if (stack.length) { const host = stack[stack.length - 1].lastElementChild || stack[stack.length - 1]; host.append(l); } else root.append(l);
          stack.push(l);
        }
        const li = document.createElement("li"); li.append(inlineNodes(it.text)); stack[stack.length - 1].append(li);
      }
    }
  }
  return root;
}
