// Escáner HTML mínimo (sin dependencias) suficiente para revisar un formulario.

const ATTR_RE = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+)))?/g;

export function parseAttrs(src) {
  const attrs = {};
  for (const m of src.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return attrs;
}

function decode(s) {
  return s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

class Element {
  constructor(tag, attrs) {
    this.tag = tag;
    this.attrs = attrs;
  }
  getAttribute(name) {
    const v = this.attrs[name.toLowerCase()];
    return v === undefined ? null : decode(v);
  }
  hasClass(c) {
    return (this.attrs.class || '').split(/\s+/).includes(c);
  }
}

class FormNode extends Element {
  constructor(attrs, inner) {
    super('form', attrs);
    this.inner = inner;
    this.children = [...inner.matchAll(/<(input|textarea|select|button|div|span)\b([^>]*)>/gi)].map(
      (m) => new Element(m[1].toLowerCase(), parseAttrs(m[2])),
    );
  }
  byName(name) {
    return this.children.find((c) => ['input', 'textarea', 'select', 'button'].includes(c.tag) && c.attrs.name === name) || null;
  }
  find(fn) {
    return this.children.find(fn) || null;
  }
}

export function forms(html) {
  const out = [];
  const re = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  for (const m of html.matchAll(re)) out.push(new FormNode(parseAttrs(m[1]), m[2]));
  return out;
}

export function anyElement(html, fn) {
  for (const m of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const el = new Element(m[1].toLowerCase(), parseAttrs(m[2]));
    if (fn(el)) return el;
  }
  return null;
}
