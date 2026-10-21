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
    if (p.tag && el.localName !== p.tag && el.localName.toLowerCase() !== p.tag) continue;
    if (p.id && el.getAttribute('id') !== p.id) continue;
    if (p.classes.length) {
      // classList is linkedom's Set of the element's classes, kept per element.
      const list = el.classList;
      let all = true;
      for (const c of p.classes) if (!list.has(c)) { all = false; break; }
      if (!all) continue;
    }
    if (p.attrs.length && !p.attrs.every(a => a.value === null ? el.hasAttribute(a.name) : el.getAttribute(a.name) === a.value)) continue;
    return true;
  }
  return false;
}

/** querySelector and querySelectorAll for simple selectors: the same walk as linkedom's (every node from the start of
 *  the element to its end, in linkedom's internal linked list, so the same elements in the same order), with a direct
 *  test of the tag, id, classes and attributes instead of linkedom's general CSS engine. linkedom compiles the selector
 *  again on every call and reads each element's classes as a string it rebuilds; Hard Burn queries its HUD every
 *  frame, and that was a quarter of its JavaScript frame. Other selectors go to linkedom unchanged. */
export function installFastQueries(doc: any) {
  const symbols = Object.getOwnPropertySymbols(doc);
  const NEXT = symbols.find(s => s.description === 'next'), END = symbols.find(s => s.description === 'end');
  const NodeList = g.NodeList;
  if (!NEXT || !END || typeof NodeList !== 'function') return;
  const first = (root: any, parts: Part[]) => {
    for (let n = root[NEXT], end = root[END]; n && n !== end; n = n[NEXT]) if (n.nodeType === 1 && matches(n, parts)) return n;
    return null;
  };
  const every = (root: any, parts: Part[]) => {
    const list = new NodeList();
    for (let n = root[NEXT], end = root[END]; n && n !== end; n = n[NEXT]) if (n.nodeType === 1 && matches(n, parts)) list.push(n);
    return list;
  };
  for (const name of ['Element', 'Document', 'DocumentFragment']) {
    const proto = g[name]?.prototype;
    if (!proto?.querySelector) continue;
    const one = proto.querySelector, many = proto.querySelectorAll;
    proto.querySelector = function (this: any, selector: string) {
      const parts = typeof selector === 'string' && this[END] ? parse(selector) : null;
      return parts ? first(this, parts) : one.call(this, selector);
    };
    proto.querySelectorAll = function (this: any, selector: string) {
      const parts = typeof selector === 'string' && this[END] ? parse(selector) : null;
      return parts ? every(this, parts) : many.call(this, selector);
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
    // linkedom's classList.value joins the token set into a new string on every read, and its CSS engine reads it
    // for every element a class selector tests (Hard Burn: 8% of the JavaScript thread). linkedom writes the same text
    // to the class attribute on every change, so value reads the attribute.
    const owner = Object.getOwnPropertySymbols(probe.classList).find(s => probe.classList[s] === probe);
    const join = Object.getOwnPropertyDescriptor(List, 'value')?.get;
    if (owner && join) {
      Object.defineProperty(List, 'value', {configurable: true, get(this: any) {
        const attr = this[owner]?.getAttributeNode('class');
        return attr ? attr.value : join.call(this);
      }});
    }
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
