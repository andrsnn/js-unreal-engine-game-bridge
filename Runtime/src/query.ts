/** Fast querySelector and querySelectorAll for simple selectors. Games look up their HUD elements
 *  every frame, and linkedom's general CSS engine costs milliseconds per frame for that. Selectors made
 *  of a tag, #id, .class and [attr] / [attr="value"] parts (and comma lists of those) are matched by a
 *  direct walk of the tree. Anything else (combinators, pseudo-classes) goes to linkedom unchanged. */
const g = globalThis as Record<string, any>;

type Part = {tag: string | null; id: string | null; classes: string[]; attrs: {name: string; value: string | null}[]};
const parsed = new Map<string, Part[] | null>();
const token = /^(?:([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([\w-]+))\s*)?\])/;

function parse(selector: string): Part[] | null {
  let result = parsed.get(selector);
  if (result !== undefined) return result;
  result = [];
  for (const raw of selector.split(',')) {
    let rest = raw.trim();
    if (!rest) { result = null; break; }
    const part: Part = {tag: null, id: null, classes: [], attrs: []};
    while (rest) {
      const m = token.exec(rest);
      if (!m) { result = null; break; }
      if (m[1]) part.tag = m[1] === '*' ? null : m[1].toLowerCase();
      else if (m[2]) part.id = m[2];
      else if (m[3]) part.classes.push(m[3]);
      else part.attrs.push({name: m[4].toLowerCase(), value: m[5] ?? m[6] ?? m[7] ?? null});
      rest = rest.slice(m[0].length);
    }
    if (!result) break;
    result.push(part);
  }
  // Quoted commas would have split a value; leave those to linkedom.
  if (result && /["'][^"']*,/.test(selector)) result = null;
  parsed.set(selector, result);
  return result;
}

function matches(el: any, parts: Part[]): boolean {
  for (const p of parts) {
    if (p.tag && el.localName !== p.tag) continue;
    if (p.id && el.getAttribute('id') !== p.id) continue;
    if (p.classes.length) {
      const cls = el.getAttribute('class');
      if (!cls) continue;
      const list = ' ' + cls.replace(/\s+/g, ' ') + ' ';
      if (!p.classes.every(c => list.includes(' ' + c + ' '))) continue;
    }
    if (p.attrs.length && !p.attrs.every(a => a.value === null ? el.hasAttribute(a.name) : el.getAttribute(a.name) === a.value)) continue;
    return true;
  }
  return false;
}

// Elements under root (not root itself) in document order; stops at the first match when one is enough.
function walk(root: any, parts: Part[], all: any[] | null): any {
  for (let el = root.firstElementChild; el; el = el.nextElementSibling) {
    if (matches(el, parts)) { if (!all) return el; all.push(el); }
    // A <template>'s children are its content, not part of the document tree.
    if (el.localName === 'template') continue;
    const found = walk(el, parts, all);
    if (found && !all) return found;
  }
  return null;
}

export function installFastQueries() {
  for (const name of ['Element', 'Document', 'DocumentFragment']) {
    const proto = g[name]?.prototype;
    if (!proto?.querySelector) continue;
    const one = proto.querySelector, many = proto.querySelectorAll;
    proto.querySelector = function (this: any, selector: string) {
      const parts = typeof selector === 'string' ? parse(selector) : null;
      return parts ? walk(this, parts, null) : one.call(this, selector);
    };
    proto.querySelectorAll = function (this: any, selector: string) {
      const parts = typeof selector === 'string' ? parse(selector) : null;
      if (!parts) return many.call(this, selector);
      const list = [] as any[] & {item?: (i: number) => any};
      walk(this, parts, list);
      list.item = (i: number) => list[i] ?? null;
      return list;
    };
  }
}

/** classList.add of a class an element already has, and setAttribute with the value it already has, change
 *  nothing, but linkedom rewrites the attribute (rebuilding the class string) and reports a DOM change, so
 *  the UI is serialized for the overlay again. Games do both every frame, so these skip when nothing changes. */
export function installNoOpSkips(doc: any) {
  const probe = doc.createElement('div');
  const List = probe.classList?.constructor?.prototype;
  if (List?.add) {
    const add = List.add, remove = List.remove;
    List.add = function (this: Set<string>, ...tokens: string[]) { if (tokens.every(t => this.has(t))) return; return add.apply(this, tokens); };
    List.remove = function (this: Set<string>, ...tokens: string[]) { if (!tokens.some(t => this.has(t))) return; return remove.apply(this, tokens); };
  }
  const El = g.Element?.prototype;
  if (El?.setAttribute) {
    const set = El.setAttribute;
    El.setAttribute = function (this: any, name: string, value: unknown) {
      if (this.getAttribute(name) === String(value) && this.hasAttribute(name)) return;
      return set.call(this, name, value);
    };
  }
}
