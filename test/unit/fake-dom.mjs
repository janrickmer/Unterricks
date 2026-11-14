// fake-dom.mjs – kleine DOM-Nachbildung für Unit-Tests der Oberfläche (ohne Browser und ohne Bibliothek): genug für h() aus public/ui.js,
// Dialoge, Fokus (samt focusin/focusout und relatedTarget), Ereignisse mit Capture und Bubbling, Tastatur (Enter, Leertaste, Tab) und einfache
// CSS-Selektoren (Typ, #id, .klasse, [attr], [attr="wert"], :checked, :disabled; Nachfahre und „>“).
// Ausgeblendet = Klasse „hidden“ oder Attribut hidden an einem Vorfahren (wie display:none in public/styles.css): solche Elemente bekommen keinen
// Fokus, und hält ein ausgeblendetes Element den Fokus, fällt er (wie im Browser) auf body – ebenso ein gesperrtes oder inertes (Attribut inert an
// einem Vorfahren). Dazu getClientRects() (leer, wenn ausgeblendet), compareDocumentPosition() und ein MutationObserver (childList, subtree; die
// Meldungen kommen wie im Browser als Mikrotask).
// installDom() setzt globalThis.document/window/Node/CSS/location/navigator; stubs = loader-Haken für public/app.js und public/teacher.js.

const kebab = (s) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class FEvent {
  constructor(type, init = {}) {
    Object.assign(this, init);
    this.type = type; this.bubbles = !!init.bubbles; this.cancelable = !!init.cancelable;
    this.defaultPrevented = false; this._stop = false; this._stopNow = false; this.target = null; this.currentTarget = null;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._stopNow = true; }
}

class FNode {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this._ls = []; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  get previousSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) - 1] || null : null; }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === this.ownerDocument) return true; return false; }
  contains(n) { for (; n; n = n.parentNode) if (n === this) return true; return false; }
  get textContent() { return this.childNodes.map((c) => (c.nodeType === 8 ? "" : c.textContent)).join(""); }
  set textContent(v) { for (const c of [...this.childNodes]) this._drop(c); if (v !== "" && v != null) this._insertBefore([String(v)], null); }
  _drop(c) {
    const i = this.childNodes.indexOf(c);
    if (i < 0) return;
    this.childNodes.splice(i, 1); c.parentNode = null;
    const d = this.ownerDocument;
    if (d && d._focus && c.contains(d._focus)) d._focus = null;   // entfernt: der Fokus fällt auf body (ohne Ereignisse)
    if (d && d._mutated) d._mutated(this, { removedNodes: [c], addedNodes: [] });
  }
  _insertBefore(nodes, ref) {
    const list = [];
    for (const n of nodes) {
      if (n === null || n === undefined) continue;
      if (typeof n === "string" || typeof n === "number") list.push(this.ownerDocument.createTextNode(String(n)));
      else if (n.nodeType === 11) list.push(...n.childNodes.splice(0).map((c) => { c.parentNode = null; return c; }));
      else list.push(n);
    }
    for (const n of list) {
      if (n === ref) continue;
      if (n.parentNode) n.parentNode._drop(n);
      const i = ref ? this.childNodes.indexOf(ref) : -1;
      n.parentNode = this;
      if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
      const d = this.ownerDocument;
      if (d && d._mutated) d._mutated(this, { removedNodes: [], addedNodes: [n] });
    }
  }
  compareDocumentPosition(o) {   // 2 = davor, 4 = danach, 8 = enthält, 16 = enthalten in, 1 = getrennt
    if (o === this) return 0;
    const path = (n) => { const p = []; for (; n; n = n.parentNode) p.unshift(n); return p; };
    const a = path(this), b = path(o);
    if (a[0] !== b[0]) return 1 | 32;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (i === a.length) return 4 | 16;
    if (i === b.length) return 2 | 8;
    const kids = a[i - 1].childNodes;
    return kids.indexOf(b[i]) > kids.indexOf(a[i]) ? 4 : 2;
  }
  append(...ns) { this._insertBefore(ns, null); }
  prepend(...ns) { this._insertBefore(ns, this.firstChild); }
  appendChild(n) { this._insertBefore([n], null); return n; }
  insertBefore(n, ref) { this._insertBefore([n], ref); return n; }
  removeChild(c) { this._drop(c); return c; }
  remove() { if (this.parentNode) this.parentNode._drop(this); }
  before(...ns) { if (this.parentNode) this.parentNode._insertBefore(ns, this); }
  after(...ns) { if (this.parentNode) this.parentNode._insertBefore(ns, this.nextSibling); }
  replaceWith(...ns) { const p = this.parentNode; if (!p) return; const next = this.nextSibling; p._drop(this); p._insertBefore(ns, next); }
  replaceChildren(...ns) { for (const c of [...this.childNodes]) this._drop(c); this._insertBefore(ns, null); }
  addEventListener(type, fn, opt) {
    if (!fn) return;
    const capture = opt === true || !!(opt && opt.capture);
    if (this._ls.some((l) => l.type === type && l.fn === fn && l.capture === capture)) return;
    this._ls.push({ type, fn, capture, once: !!(opt && opt.once) });
  }
  removeEventListener(type, fn, opt) {
    const capture = opt === true || !!(opt && opt.capture);
    this._ls = this._ls.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
  }
  _invoke(ev, phase) {
    ev.currentTarget = this;
    for (const l of [...this._ls]) {
      if (l.type !== ev.type || (phase === "capture" && !l.capture) || (phase === "bubble" && l.capture)) continue;
      if (l.once) this.removeEventListener(l.type, l.fn, l.capture);
      try { typeof l.fn === "function" ? l.fn.call(this, ev) : l.fn.handleEvent(ev); }
      catch (e) { (globalThis.__domErrors || (globalThis.__domErrors = [])).push(e); }
      if (ev._stopNow) break;
    }
  }
  dispatchEvent(ev) {
    const path = [];
    for (let n = this; n; n = n.parentNode) path.unshift(n);
    if (path[0] === this.ownerDocument && this.ownerDocument.defaultView) path.unshift(this.ownerDocument.defaultView);
    ev.target = this;
    for (const n of path.slice(0, -1)) { n._invoke(ev, "capture"); if (ev._stop) return !ev.defaultPrevented; }
    this._invoke(ev, "target");
    if (ev.bubbles && !ev._stop) for (const n of path.slice(0, -1).reverse()) { n._invoke(ev, "bubble"); if (ev._stop) break; }
    ev.currentTarget = null;
    return !ev.defaultPrevented;
  }
}

class FText extends FNode {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.data = String(data); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  get nodeValue() { return this.data; }
  get nodeName() { return "#text"; }
}
class FFragment extends FNode { constructor(doc) { super(doc); this.nodeType = 11; } }

class FClassList {
  constructor(el) { this.el = el; }
  _get() { return (this.el.getAttribute("class") || "").split(/\s+/).filter(Boolean); }
  _set(list) { this.el.setAttribute("class", list.join(" ")); }
  contains(c) { return this._get().includes(c); }
  add(...cs) { const l = this._get(); for (const c of cs) if (!l.includes(c)) l.push(c); this._set(l); }
  remove(...cs) { this._set(this._get().filter((c) => !cs.includes(c))); }
  toggle(c, force) { const on = force === undefined ? !this.contains(c) : !!force; if (on) this.add(c); else this.remove(c); return on; }
  get length() { return this._get().length; }
  toString() { return this._get().join(" "); }
}

const FOCUSABLE = new Set(["BUTTON", "INPUT", "TEXTAREA", "SELECT"]);
class FElement extends FNode {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1; this.tagName = String(tag).toUpperCase(); this.localName = String(tag).toLowerCase();
    this._attrs = new Map(); this.style = {}; this.classList = new FClassList(this);
    // style.setProperty (CSS-Variablen) nicht aufzählbar, damit Vergleiche der Stile unverändert bleiben
    Object.defineProperty(this.style, "setProperty", { value(k, v) { this[k] = String(v); } });
    this._value = undefined; this._checked = undefined; this._sel = null;
    const el = this;
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === "string" ? el.getAttribute("data-" + kebab(k)) ?? undefined : undefined),
      set: (_, k, v) => { el.setAttribute("data-" + kebab(String(k)), v); return true; },
      deleteProperty: (_, k) => { el.removeAttribute("data-" + kebab(String(k))); return true; },
      has: (_, k) => el.hasAttribute("data-" + kebab(String(k))),
      ownKeys: () => [...el._attrs.keys()].filter((a) => a.startsWith("data-")).map((a) => camel(a.slice(5))),
      getOwnPropertyDescriptor: (_, k) => (el.hasAttribute("data-" + kebab(String(k))) ? { enumerable: true, configurable: true, value: el.getAttribute("data-" + kebab(String(k))) } : undefined),
    });
  }
  get nodeName() { return this.tagName; }
  getAttribute(k) { return this._attrs.has(k) ? this._attrs.get(k) : null; }
  setAttribute(k, v) { const had = this._attrs.get(k); this._attrs.set(k, String(v)); if (had !== String(v)) this._attrChanged(k); }
  removeAttribute(k) { if (this._attrs.delete(k)) this._attrChanged(k); }
  // MutationObserver mit attributes (und attributeFilter): wie im Browser ein Eintrag je Änderung
  _attrChanged(k) { const d = this.ownerDocument; if (d && d._mutated) d._mutated(this, { attributeName: k }, "attributes"); }
  hasAttribute(k) { return this._attrs.has(k); }
  toggleAttribute(k, force) { const on = force === undefined ? !this.hasAttribute(k) : !!force; if (on) this.setAttribute(k, ""); else this.removeAttribute(k); return on; }
  get attributes() { return [...this._attrs].map(([name, value]) => ({ name, value })); }
  get id() { return this.getAttribute("id") || ""; } set id(v) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") || ""; } set className(v) { this.setAttribute("class", v); }
  get name() { return this.getAttribute("name") || ""; } set name(v) { this.setAttribute("name", v); }
  get type() { return this.getAttribute("type") || (this.tagName === "BUTTON" ? "submit" : "text"); } set type(v) { this.setAttribute("type", v); }
  get href() { return this.getAttribute("href") || ""; } set href(v) { this.setAttribute("href", v); }
  get disabled() { return this.hasAttribute("disabled"); } set disabled(v) { this.toggleAttribute("disabled", !!v); }
  get readOnly() { return this.hasAttribute("readonly"); } set readOnly(v) { this.toggleAttribute("readonly", !!v); }
  get hidden() { return this.hasAttribute("hidden"); } set hidden(v) { this.toggleAttribute("hidden", !!v); }
  get checked() { return this._checked !== undefined ? this._checked : this.hasAttribute("checked"); }
  set checked(v) {
    this._checked = !!v;
    if (v && this.type === "radio" && this.name && this.ownerDocument) for (const o of this.ownerDocument.querySelectorAll('input[name="' + this.name + '"]')) if (o !== this) o._checked = false;
  }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === "TEXTAREA") return this.textContent;
    if (this.tagName === "SELECT") { const os = this.querySelectorAll("option"), o = os.find((x) => x.hasAttribute("selected")) || os[0]; return o ? o.value : ""; }
    if (this.tagName === "OPTION") return this.getAttribute("value") ?? this.textContent;
    return this.getAttribute("value") ?? "";
  }
  set value(v) { this._value = String(v ?? ""); this._sel = null; }
  get selectionStart() { return this._sel ? this._sel[0] : this.value.length; } set selectionStart(v) { this._sel = [v, Math.max(v, this.selectionEnd)]; }
  get selectionEnd() { return this._sel ? this._sel[1] : this.value.length; } set selectionEnd(v) { this._sel = [Math.min(this.selectionStart, v), v]; }
  setSelectionRange(a, b) { const n = this.value.length; this._sel = [Math.min(a, n), Math.min(b, n)]; }
  select() { this._sel = [0, this.value.length]; }
  setRangeText(text, a = this.selectionStart, b = this.selectionEnd, mode = "preserve") {
    const v = this.value; this._value = v.slice(0, a) + text + v.slice(b);
    this._sel = mode === "end" ? [a + text.length, a + text.length] : mode === "select" ? [a, a + text.length] : [a, a];
  }
  get files() { return []; }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] || null; }
  get nextElementSibling() { const p = this.parentNode; if (!p) return null; const c = p.childNodes.filter((x) => x.nodeType === 1); return c[c.indexOf(this) + 1] || null; }
  get previousElementSibling() { const p = this.parentNode; if (!p) return null; const c = p.childNodes.filter((x) => x.nodeType === 1); return c[c.indexOf(this) - 1] || null; }
  get rendered() {
    if (!this.isConnected) return false;
    for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (n.hasAttribute("hidden") || n.classList.contains("hidden")) return false;
    return true;
  }
  get inert() { return !!this.closest("[inert]"); } set inert(v) { this.toggleAttribute("inert", !!v); }
  getClientRects() { return this.rendered ? [this.getBoundingClientRect()] : []; }
  get focusable() {
    if (!this.rendered || this.inert) return false;
    if (FOCUSABLE.has(this.tagName)) return !this.disabled;
    if (this.tagName === "A" && this.hasAttribute("href")) return true;
    return this.hasAttribute("tabindex");
  }
  get tabbable() { return this.focusable && this.getAttribute("tabindex") !== "-1" && !(this.tagName === "INPUT" && this.type === "hidden"); }
  focus() { if (this.focusable) this.ownerDocument._setFocus(this); }
  blur() { if (this.ownerDocument._focus === this) this.ownerDocument._setFocus(null); }
  click() {
    if (FOCUSABLE.has(this.tagName) && this.disabled) return;
    const box = this.tagName === "INPUT" && (this.type === "checkbox" || this.type === "radio");
    const was = this.checked;
    if (box) this.checked = this.type === "radio" ? true : !was;
    const ev = new FEvent("click", { bubbles: true, cancelable: true });
    this.dispatchEvent(ev);
    if (box) { if (ev.defaultPrevented) this.checked = was; else if (this.checked !== was) { this.dispatchEvent(new FEvent("input", { bubbles: true })); this.dispatchEvent(new FEvent("change", { bubbles: true })); } return; }
    if (!ev.defaultPrevented && this.tagName === "LABEL") { const c = this.getAttribute("for") ? this.ownerDocument.getElementById(this.getAttribute("for")) : this.querySelector("input, textarea, select"); if (c && c !== this) { c.focus(); if (c.tagName === "INPUT") c.click(); } }
    if (!ev.defaultPrevented && this.tagName === "A") this.ownerDocument._navigations.push(this.getAttribute("href"));
  }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
  scrollIntoView() {}
  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { return queryAll(this, sel, true)[0] || null; }
  matches(sel) { return parseSelector(sel).some((g) => matchGroup(this, g)); }
  closest(sel) { const gs = parseSelector(sel); for (let n = this; n && n.nodeType === 1; n = n.parentNode) if (gs.some((g) => matchGroup(n, g))) return n; return null; }
  get innerHTML() { return ""; }
}

/* ---------- Selektoren ---------- */
function parseSelector(sel) {
  const groups = [];
  for (const part of splitTop(String(sel), ",")) {
    const steps = [];
    let comb = " ";
    const re = new RegExp("\\s*(>)\\s*|\\s+|((?:[a-zA-Z*][\\w-]*)?(?:#" + IDENT + "|\\." + IDENT + "|\\[[^\\]]+\\]|:[\\w-]+)*)", "gy");
    const s = part.trim();
    let i = 0;
    while (i < s.length) {
      re.lastIndex = i;
      const m = re.exec(s);
      if (!m || m[0] === "") throw new Error("Selektor nicht unterstützt: " + sel);
      i = re.lastIndex;
      if (m[1]) comb = ">";
      else if (m[2]) { steps.push({ comb, c: compound(m[2]) }); comb = " "; }
      else if (comb !== ">") comb = " ";
    }
    groups.push(steps);
  }
  return groups;
}
function splitTop(s, ch) {
  const out = []; let depth = 0, q = null, cur = "";
  for (const c of s) {
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === "[" || c === "(") depth++;
    if (c === "]" || c === ")") depth--;
    if (c === ch && !depth) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
const IDENT = "(?:\\\\[0-9a-fA-F]{1,6} ?|\\\\.|[\\w-])+";   // Bezeichner samt CSS-Escapes (\\31 abc, \\:)
const unesc = (s) => s.replace(/\\([0-9a-fA-F]{1,6})\s?/g, (_, hx) => String.fromCodePoint(parseInt(hx, 16))).replace(/\\(.)/g, "$1");
function compound(s) {
  const c = { tag: null, id: null, cls: [], attrs: [], pseudo: [] };
  const re = new RegExp("^([a-zA-Z*][\\w-]*)|#(" + IDENT + ")|\\.(" + IDENT + ")|\\[\\s*([\\w-]+)\\s*(?:([~^$*|]?=)\\s*(\"[^\"]*\"|'[^']*'|[^\\]\\s]+))?\\s*\\]|:([\\w-]+)", "g");
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) c.tag = m[1].toUpperCase();
    else if (m[2]) c.id = unesc(m[2]);
    else if (m[3]) c.cls.push(unesc(m[3]));
    else if (m[4]) c.attrs.push({ name: m[4], op: m[5] || null, value: m[6] ? m[6].replace(/^["']|["']$/g, "") : null });
    else if (m[7]) c.pseudo.push(m[7]);
  }
  return c;
}
function matchCompound(el, c) {
  if (c.tag && c.tag !== "*" && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const k of c.cls) if (!el.classList.contains(k)) return false;
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    const v = el.getAttribute(a.name);
    if (a.op === "=" && v !== a.value) return false;
    if (a.op === "^=" && !v.startsWith(a.value)) return false;
    if (a.op === "$=" && !v.endsWith(a.value)) return false;
    if (a.op === "*=" && !v.includes(a.value)) return false;
    if (a.op === "~=" && !v.split(/\s+/).includes(a.value)) return false;
  }
  for (const p of c.pseudo) {
    if (p === "checked" && !el.checked) return false;
    if (p === "disabled" && !el.disabled) return false;
    if (p === "focus" && el.ownerDocument.activeElement !== el) return false;
    if (!["checked", "disabled", "focus"].includes(p)) throw new Error("Pseudoklasse nicht unterstützt: :" + p);
  }
  return true;
}
function matchGroup(el, steps, k = steps.length - 1) {
  if (!matchCompound(el, steps[k].c)) return false;
  if (k === 0) return true;
  const comb = steps[k].comb;
  for (let p = el.parentNode; p && p.nodeType === 1; p = p.parentNode) {
    if (matchGroup(p, steps, k - 1)) return true;
    if (comb === ">") return false;
  }
  return false;
}
function queryAll(root, sel, first = false) {
  const gs = parseSelector(sel), out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (gs.some((g) => matchGroup(c, g))) { out.push(c); if (first) return true; }
      if (walk(c)) return true;
    }
    return false;
  };
  walk(root);
  return out;
}

/* ---------- Dokument und Fenster ---------- */
class FDocument extends FNode {
  constructor() {
    super(null);
    this.ownerDocument = this; this.nodeType = 9; this._focus = null; this._navigations = []; this.visibilityState = "visible";
    this.documentElement = this.createElement("html");
    this.head = this.createElement("head"); this.body = this.createElement("body");
    this.documentElement.append(this.head, this.body);
    this.childNodes.push(this.documentElement); this.documentElement.parentNode = this;
  }
  get hidden() { return this.visibilityState !== "visible"; }
  createElement(tag) { return new FElement(this, tag); }
  createElementNS(_, tag) { return new FElement(this, tag); }
  createTextNode(t) { return new FText(this, t); }
  createDocumentFragment() { return new FFragment(this); }
  createEvent() { return new FEvent(""); }
  get activeElement() {
    // ausgeblendet, entfernt, gesperrt oder inert: wie im Browser auf body
    if (this._focus && (!this._focus.rendered || this._focus.inert || (FOCUSABLE.has(this._focus.tagName) && this._focus.disabled))) this._focus = null;
    return this._focus || this.body;
  }
  _mutated(target, rec, type = "childList") {
    for (const o of this._observers || []) {
      if (!(o.target === target || (o.opts.subtree && o.target.contains(target)))) continue;
      if (type === "childList" && !o.opts.childList) continue;
      if (type === "attributes" && (!o.opts.attributes || (o.opts.attributeFilter && !o.opts.attributeFilter.includes(rec.attributeName)))) continue;
      o.records.push({ type, target, ...rec });
      if (!o.queued) { o.queued = true; queueMicrotask(() => { o.queued = false; const r = o.records.splice(0); if (r.length && o.active) o.fn(r, o.mo); }); }
    }
  }
  _setFocus(el) {
    const old = this._focus && this._focus.rendered ? this._focus : null;
    if (old === el) return;
    this._focus = null;
    if (old) { old.dispatchEvent(new FEvent("blur", { relatedTarget: el })); old.dispatchEvent(new FEvent("focusout", { bubbles: true, relatedTarget: el })); }
    this._focus = el;
    if (el) { el.dispatchEvent(new FEvent("focus", { relatedTarget: old })); el.dispatchEvent(new FEvent("focusin", { bubbles: true, relatedTarget: old })); }
  }
  getElementById(id) { return queryAll(this.documentElement, "#" + id.replace(/[^\w-]/g, (c) => "\\" + c), true)[0] || (this.documentElement.id === id ? this.documentElement : null); }
  querySelectorAll(sel) { const r = queryAll(this, sel); return r; }
  querySelector(sel) { return queryAll(this, sel, true)[0] || null; }
  execCommand() { return false; }
}

class FWindow extends FNode {
  constructor(doc, hash) {
    super(doc);
    this.document = doc; doc.defaultView = this;
    this.location = { origin: "https://unterricks.test", protocol: "https:", host: "unterricks.test", pathname: "/", search: "", hash, href: "https://unterricks.test/" + hash };
    this.innerWidth = 1280; this.innerHeight = 900; this.top = this; this.self = this;
  }
  matchMedia() { return { matches: false, addEventListener() {}, removeEventListener() {} }; }
  scrollTo() {}
  open() { return null; }
  getComputedStyle() { return {}; }
}

export function installDom({ hash = "#/" } = {}) {
  const document = new FDocument(), window = new FWindow(document, hash);
  const clip = { text: "", writeText: async (t) => { clip.text = String(t); }, readText: async () => clip.text };
  const define = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
  define("document", document); define("window", window); define("location", window.location);
  define("Node", FNode); define("Element", FElement); define("HTMLElement", FElement);
  define("MutationObserver", class {
    constructor(fn) { this.fn = fn; this.entries = []; }
    observe(target, opts = {}) { const o = { target, opts, fn: this.fn, mo: this, records: [], queued: false, active: true }; this.entries.push(o); (document._observers || (document._observers = [])).push(o); }
    disconnect() { for (const o of this.entries) o.active = false; document._observers = (document._observers || []).filter((o) => !this.entries.includes(o)); this.entries = []; }
    takeRecords() { return this.entries.flatMap((o) => o.records.splice(0)); }
  });
  define("navigator", { clipboard: clip, userAgent: "fake-dom" });
  define("CSS", { escape: (s) => String(s).replace(/[^\w-]/g, (c) => "\\" + c).replace(/^(\d)/, (d) => "\\3" + d + " ") });
  for (const id of ["app", "toasts"]) { const d = document.createElement("div"); d.id = id; document.body.append(d); }
  // Zeitgeber der Seite (Meldungen, verzögertes Speichern …) halten den Testprozess nicht am Leben; sleep() des Tests schon
  if (!globalThis.__realSetTimeout) {
    const real = globalThis.__realSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...a) => { const t = real(fn, ms, ...a); if (t && t.unref) t.unref(); return t; };
  }
  globalThis.__domErrors = [];
  const press = (key, opt = {}) => {
    const t = document.activeElement;
    const ev = new FEvent("keydown", { bubbles: true, cancelable: true, key, ...opt });
    t.dispatchEvent(ev);
    if (ev.defaultPrevented) return ev;
    const a = document.activeElement;
    if ((key === "Enter" || key === " ") && a.tagName === "BUTTON") a.click();
    else if (key === "Enter" && a.tagName === "A") a.click();
    else if (key === "Tab") {
      const all = queryAll(document, "*").filter((x) => x.tabbable);
      const i = all.indexOf(a), next = opt.shiftKey ? all[(i < 0 ? all.length : i) - 1] : all[i + 1];
      if (next) next.focus(); else document._setFocus(null);
    }
    return ev;
  };
  // Mausklick wie im Browser (Chrome fokussiert Knöpfe beim Klicken): mousedown (mit Fokus), dann click
  const userClick = (el) => {
    el.dispatchEvent(new FEvent("mousedown", { bubbles: true, cancelable: true }));
    if (el.focusable) el.focus(); else { let n = el; while (n && n.nodeType === 1 && !n.focusable) n = n.parentNode; if (n && n.nodeType === 1) n.focus(); else document._setFocus(null); }
    el.click();
  };
  const fire = (el, type, init = {}) => el.dispatchEvent(new FEvent(type, { bubbles: true, cancelable: true, ...init }));
  const sleep = (ms = 0) => new Promise((r) => globalThis.__realSetTimeout(r, ms));
  return { document, window, clip, press, userClick, fire, sleep, Event: FEvent };
}

/* Loader-Haken: public/app.js und public/teacher.js durch kleine Attrappen ersetzen (kein Router, keine Anmeldung). Die Attrappen lesen
   globalThis.__tapi(method, path, o) für Anfragen an den Server und schreiben go(hash) nach globalThis.__go. */
const APP = `
const disposers = [];
export const onLeave = (fn) => disposers.push(fn);
export const leave = () => { for (const fn of disposers.splice(0)) { try { fn(); } catch {} } };
export function render(...nodes) { leave(); const app = document.getElementById("app"); while (app.firstChild) app.firstChild.remove(); app.append(...nodes); }
export const go = (hash) => { (globalThis.__go || (globalThis.__go = [])).push(hash); };
export const onStudentExpire = () => {}, studentAuthFailed = () => {}, studentAuthLeft = () => 0;
globalThis.__leave = leave;`;
const TEACHER = `
export const T = { token: "lehrkraft", config: null, fb: null, wrapKey: null, fbLink: { state: "none" } };
export async function tapi(method, path, o = {}) { if (!globalThis.__tapi) throw new Error("kein Server: " + method + " " + path); return globalThis.__tapi(method, path, o); }
export const teacherBar = () => document.createElement("header"), markNav = () => {}, printPending = () => {}, cardsPendingRun = () => {};
export const askTeacherPassword = async () => null, fbAutoConnect = async () => {}, fbForget = () => {}, fbStore = async () => {}, fbUnlock = async () => {}, notfallBackfill = async () => {};`;
export const stubs = "data:text/javascript," + encodeURIComponent(`
const APP = ${JSON.stringify("data:text/javascript," + encodeURIComponent(APP))}, TEACHER = ${JSON.stringify("data:text/javascript," + encodeURIComponent(TEACHER))};
export async function resolve(s, c, next) {
  if (s === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject {}", shortCircuit: true };
  const r = await next(s, c);
  if (r.url.endsWith("/public/app.js")) return { url: APP, shortCircuit: true };
  if (r.url.endsWith("/public/teacher.js")) return { url: TEACHER, shortCircuit: true };
  return r;
}`);
