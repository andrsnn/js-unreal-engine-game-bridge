import {parseHTML} from 'linkedom';
import {installNoOpSkips} from './query';
import {host} from './host';
import {blobStore} from './polyfills';
import {imageSize} from './imageSize';
import {windowTarget} from './input';
import {Context2D, Path2DImpl, setImageReader, OffscreenCanvasImpl, ImageDataImpl, ImageBitmapImpl} from './canvas2d';

/** The page the web build boots in, as a linkedom document. The game's UI code builds its DOM
 *  here exactly as it does in a browser; the Unreal host mirrors it into the CEF overlay. */
const g = globalThis as Record<string, any>;
const VIEW = {w: 1920, h: 1080};

/** The game's own index.html (scripts removed), captured by the build. */
declare const __JSGB_PAGE__: {title: string; lang: string; htmlAttrs: string; bodyAttrs: string; body: string};
const shell = typeof __JSGB_PAGE__ === 'object' ? __JSGB_PAGE__ : {title: '', lang: 'en', htmlAttrs: '', bodyAttrs: '', body: ''};
const page = parseHTML(`<!doctype html><html lang="${shell.lang}" ${shell.htmlAttrs}><head><meta charset="UTF-8"><title>${shell.title}</title></head>
<body ${shell.bodyAttrs}>${shell.body}</body></html>`) as unknown as Record<string, any>;
const doc = page.document;

const CLASSES = ['Event', 'CustomEvent', 'InputEvent', 'EventTarget', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement',
  'HTMLTextAreaElement', 'HTMLButtonElement', 'HTMLCanvasElement', 'HTMLImageElement', 'HTMLSelectElement', 'HTMLOptionElement',
  'HTMLDivElement', 'HTMLSpanElement', 'HTMLAnchorElement', 'HTMLLabelElement', 'HTMLVideoElement', 'HTMLAudioElement',
  'HTMLMediaElement', 'HTMLStyleElement', 'HTMLTemplateElement', 'HTMLUListElement', 'HTMLLIElement', 'HTMLParagraphElement',
  'HTMLHeadingElement', 'HTMLTableElement', 'HTMLFormElement', 'HTMLProgressElement', 'HTMLMeterElement', 'HTMLDetailsElement',
  'SVGElement', 'Text', 'Comment', 'DocumentFragment', 'Document', 'MutationObserver', 'DOMParser', 'Range', 'TreeWalker',
  'NodeFilter', 'Attr', 'CharacterData', 'ShadowRoot', 'HTMLCollection', 'NodeList', 'CSSStyleDeclaration', 'Image'];
for (const name of CLASSES) if (page[name] && !g[name]) g[name] = page[name];
g.document = doc;
// installFastQueries() was slower than linkedom's own engine on a game-sized DOM (its tree walk getters are costly); off.
installNoOpSkips(doc);

// UI events linkedom does not define. They carry the fields the game reads.
const BaseEvent = page.Event as {new (type: string, init?: Record<string, unknown>): Record<string, unknown>};
function eventClass(defaults: Record<string, unknown>) {
  return class extends BaseEvent {
    constructor(type: string, init: Record<string, unknown> = {}) {
      super(type, init);
      for (const [k, v] of Object.entries(defaults)) (this as Record<string, unknown>)[k] = init[k] ?? v;
    }
  };
}
const mouse = {clientX: 0, clientY: 0, screenX: 0, screenY: 0, pageX: 0, pageY: 0, offsetX: 0, offsetY: 0, movementX: 0, movementY: 0,
  button: 0, buttons: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, relatedTarget: null, detail: 0};
g.UIEvent ??= eventClass({detail: 0, view: null});
g.KeyboardEvent ??= eventClass({key: '', code: '', repeat: false, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, location: 0, isComposing: false, keyCode: 0, which: 0});
g.MouseEvent ??= eventClass(mouse);
g.PointerEvent ??= eventClass({...mouse, pointerId: 1, pointerType: 'mouse', isPrimary: true, pressure: 0, width: 1, height: 1});
g.WheelEvent ??= eventClass({...mouse, deltaX: 0, deltaY: 0, deltaZ: 0, deltaMode: 0});
g.FocusEvent ??= eventClass({relatedTarget: null});
g.TouchEvent ??= eventClass({touches: [], changedTouches: [], targetTouches: []});
g.MessageEvent ??= eventClass({data: null, origin: '', source: null});
g.ProgressEvent ??= eventClass({loaded: 0, total: 0, lengthComputable: false});
g.PopStateEvent ??= eventClass({state: null});
g.ErrorEvent ??= eventClass({message: '', error: null});
g.HTMLDialogElement ??= page.HTMLElement;
g.DOMRect ??= class DOMRect { constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
  get left() { return this.x; } get top() { return this.y; } get right() { return this.x + this.width; } get bottom() { return this.y + this.height; }
  toJSON() { return {x: this.x, y: this.y, width: this.width, height: this.height}; } };

// The window is the global object, with its own listener list (see input.ts).
g.addEventListener = windowTarget.addEventListener.bind(windowTarget);
g.removeEventListener = windowTarget.removeEventListener.bind(windowTarget);
g.dispatchEvent = windowTarget.dispatchEvent.bind(windowTarget);

Object.defineProperty(g, 'innerWidth', {get: () => VIEW.w, configurable: true});
Object.defineProperty(g, 'innerHeight', {get: () => VIEW.h, configurable: true});
Object.defineProperty(g, 'outerWidth', {get: () => VIEW.w, configurable: true});
Object.defineProperty(g, 'outerHeight', {get: () => VIEW.h, configurable: true});
g.devicePixelRatio = 1; g.scrollX = g.scrollY = g.pageXOffset = g.pageYOffset = 0;
g.screen = {width: VIEW.w, height: VIEW.h, availWidth: VIEW.w, availHeight: VIEW.h, orientation: {type: 'landscape-primary', addEventListener() {}}};
g.scrollTo = g.scroll = g.scrollBy = () => {};
g.focus = g.blur = () => {};
g.alert = (m: string) => host.log('warn', 'alert: ' + m);
g.confirm = () => true; g.prompt = () => null;
g.open = () => null; g.close = () => {}; g.print = () => {};
g.isSecureContext = true; g.origin = 'http://localhost';
g.parent = g.top = g;
g.frames = []; g.opener = null; g.name = '';

export function setViewport(w: number, h: number) {
  if (w === VIEW.w && h === VIEW.h) return;
  VIEW.w = w; VIEW.h = h; g.screen.width = g.screen.availWidth = w; g.screen.height = g.screen.availHeight = h;
  g.dispatchEvent(new BaseEvent('resize'));
}

const search = host.search ?? '';
g.location = {
  href: 'http://localhost/' + search, origin: 'http://localhost', protocol: 'http:', host: 'localhost', hostname: 'localhost', port: '',
  pathname: '/', search, hash: '',
  assign: () => reloadNow(), replace: () => reloadNow(), reload: () => reloadNow(), toString() { return this.href; },
};
g.history = {length: 1, state: null, pushState() {}, replaceState() {}, back() {}, forward() {}, go() {}, scrollRestoration: 'auto'};
try { Object.defineProperty(doc, 'baseURI', {get: () => 'http://localhost/', configurable: true}); } catch { /* linkedom getter */ }
try { Object.defineProperty(doc, 'location', {get: () => g.location, configurable: true}); } catch { /* ignore */ }
try { Object.defineProperty(doc, 'defaultView', {get: () => g, configurable: true}); } catch { /* ignore */ }
try { Object.defineProperty(doc, 'visibilityState', {get: () => 'visible', configurable: true}); Object.defineProperty(doc, 'hidden', {get: () => false, configurable: true}); } catch { /* ignore */ }
doc.hasFocus = () => true;
doc.fonts = {ready: Promise.resolve(), load: async () => [], check: () => true, add() {}, addEventListener() {}, forEach() {}};
doc.exitPointerLock = () => { pointerLockElement = null; doc.dispatchEvent(new BaseEvent('pointerlockchange')); };
doc.exitFullscreen = async () => {};
let pointerLockElement: unknown = null;
try { Object.defineProperty(doc, 'pointerLockElement', {get: () => pointerLockElement, configurable: true}); } catch { /* ignore */ }
try { Object.defineProperty(doc, 'fullscreenElement', {get: () => null, configurable: true}); } catch { /* ignore */ }
doc.elementFromPoint = () => null; doc.elementsFromPoint = () => [];
doc.getAnimations = () => [];
export const pointerLocked = () => pointerLockElement !== null;

// Layout: linkedom has no layout engine. The CEF overlay lays the mirrored page out and reports
// each element's box back (see ui.ts). Until a box arrives, canvases and the body's direct
// children report the viewport and everything else a zero box.
const EP = page.HTMLElement.prototype as Record<string, any>;
const ElP = page.Element.prototype as Record<string, any>;
export const layoutBoxes = new Map<string, {x: number; y: number; width: number; height: number; display?: string; visibility?: string; opacity?: string}>();
const fullScreen = (el: Record<string, any>) => el.tagName === 'CANVAS' || el.parentNode === doc.body || el === doc.body || el === doc.documentElement;
function box(el: Record<string, any>) { const id = el.getAttribute?.('data-jsgb'); return id ? layoutBoxes.get(id) : undefined; }
ElP.getBoundingClientRect = function (this: Record<string, any>) {
  const b = box(this); if (b) return new g.DOMRect(b.x, b.y, b.width, b.height);
  return fullScreen(this) ? new g.DOMRect(0, 0, VIEW.w, VIEW.h) : new g.DOMRect(0, 0, 0, 0);
};
ElP.getClientRects = function (this: Record<string, any>) { return this.isConnected && this.style?.display !== 'none' && !this.hidden ? [this.getBoundingClientRect()] : []; };
ElP.scrollIntoView ??= () => {}; ElP.scrollTo ??= () => {}; ElP.scrollBy ??= () => {};
ElP.animate ??= () => ({finished: Promise.resolve(), cancel() {}, finish() {}, play() {}, pause() {}, addEventListener() {}, onfinish: null});
ElP.requestPointerLock = function () { pointerLockElement = this; doc.dispatchEvent(new BaseEvent('pointerlockchange')); return Promise.resolve(); };
ElP.requestFullscreen = async () => {};
ElP.setPointerCapture ??= () => {}; ElP.releasePointerCapture ??= () => {}; ElP.hasPointerCapture ??= () => false;
ElP.checkVisibility ??= function (this: Record<string, any>) { return this.isConnected && !this.hidden; };
ElP.attachShadow ??= function (this: Record<string, any>) { const f = doc.createElement('div'); this.appendChild(f); return f; };
let activeElement: unknown = null;
EP.focus = function () { activeElement = this; };
EP.blur = function () { if (activeElement === this) activeElement = null; };
EP.click ??= function (this: Record<string, any>) { this.dispatchEvent(new g.MouseEvent('click', {bubbles: true, cancelable: true})); };
try { Object.defineProperty(doc, 'activeElement', {get: () => activeElement ?? doc.body, configurable: true}); } catch { /* ignore */ }
for (const prop of ['offsetWidth', 'offsetHeight', 'offsetLeft', 'offsetTop', 'clientWidth', 'clientHeight', 'scrollWidth', 'scrollHeight'] as const) {
  if (!(prop in EP) || prop.startsWith('offset') || prop.startsWith('client')) Object.defineProperty(EP, prop, {get() {
    const r = this.getBoundingClientRect();
    return prop.endsWith('Width') ? r.width : prop.endsWith('Height') ? r.height : prop === 'offsetLeft' ? r.x : r.y;
  }, configurable: true});
}
if (!('scrollTop' in EP)) { Object.defineProperty(EP, 'scrollTop', {get() { return this.__st ?? 0; }, set(v) { this.__st = v; }, configurable: true}); }
if (!('scrollLeft' in EP)) { Object.defineProperty(EP, 'scrollLeft', {get() { return this.__sl ?? 0; }, set(v) { this.__sl = v; }, configurable: true}); }
if (!('inert' in EP)) Object.defineProperty(EP, 'inert', {get() { return this.hasAttribute('inert'); }, set(v) { this.toggleAttribute('inert', !!v); }, configurable: true});
const DialogLike = EP as Record<string, any>;
DialogLike.showModal ??= function (this: Record<string, any>) { this.setAttribute('open', ''); };
DialogLike.show ??= function (this: Record<string, any>) { this.setAttribute('open', ''); };
if (!('open' in DialogLike)) Object.defineProperty(DialogLike, 'open', {get() { return this.hasAttribute('open'); }, set(v) { this.toggleAttribute('open', !!v); }, configurable: true});

g.getComputedStyle = (el: Record<string, any>) => new Proxy(el?.style ?? {}, {
  get(t: Record<string, any>, k: string | symbol) {
    if (k === 'getPropertyValue') return (p: string) => t.getPropertyValue?.(p) || (box(el) as Record<string, any> | undefined)?.[p.replace(/-([a-z])/g, (_m, c) => c.toUpperCase())] || '';
    const v = t[k as string];
    if (v !== undefined && v !== '') return typeof v === 'function' ? v.bind(t) : v;
    const measured = (box(el) as Record<string, any> | undefined)?.[k as string];
    if (measured !== undefined) return measured;
    if (k === 'display') return el?.hidden ? 'none' : 'block';
    if (k === 'visibility') return 'visible';
    if (k === 'opacity') return '1';
    return '';
  },
});
g.matchMedia = (q: string) => ({matches: /prefers-reduced-motion: no-preference|min-width|hover: hover|pointer: fine/.test(q), media: q, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => true});
g.ResizeObserver ??= class { constructor(private cb: (e: unknown[]) => void) {} observe(t: unknown) { setTimeout(() => this.cb([{target: t, contentRect: new g.DOMRect(0, 0, VIEW.w, VIEW.h)}]), 0); } unobserve() {} disconnect() {} };
g.IntersectionObserver ??= class { constructor(private cb: (e: unknown[]) => void) {} observe(t: unknown) { setTimeout(() => this.cb([{target: t, isIntersecting: true, intersectionRatio: 1}]), 0); } unobserve() {} disconnect() {} takeRecords() { return []; } };
g.CSS ??= {supports: () => true, escape: (s: string) => s.replace(/[^\w-]/g, c => '\\' + c)};

// Storage. Saves persist through the host when it offers a store; otherwise they live for the session.
// Storage is written to the host a moment after a change. A reload must not lose what the page wrote just before it (a
// game that leaves itself a note in sessionStorage and reloads), so the stores are written out first.
const storageFlushes: (() => void)[] = [];
function reloadNow() { for (const flush of storageFlushes) flush(); host.reload(); }
function makeStorage(kind: string) {
  const store = (g.__jsgbHost as {storage?: {load(k: string): string | null; save(k: string, data: string): void}}).storage;
  const m = new Map<string, string>(Object.entries(JSON.parse(store?.load(kind) ?? '{}') as Record<string, string>));
  let pending = false;
  const flush = () => { pending = false; store?.save(kind, JSON.stringify(Object.fromEntries(m))); };
  const touch = () => { if (store && !pending) { pending = true; setTimeout(() => { if (pending) flush(); }, 250); } };
  storageFlushes.push(() => { if (pending) flush(); });
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.has(k) ? m.get(k)! : null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); touch(); },
    removeItem: (k: string) => { m.delete(k); touch(); },
    clear: () => { m.clear(); touch(); },
  };
}
g.localStorage = makeStorage('localStorage');
g.sessionStorage = makeStorage('sessionStorage');

// Canvas. 2D contexts rasterize in software (canvas2d.ts) so runtime-drawn textures carry over.
// WebGL contexts are absent: Unreal draws the world.
const CanvasP = page.HTMLCanvasElement.prototype as Record<string, any>;
CanvasP.getContext = function (this: Record<string, any>, kind: string) {
  if (kind !== '2d') return null;
  return this.__ctx ??= new Context2D(this);
};
CanvasP.toDataURL = () => 'data:image/png;base64,';
CanvasP.toBlob = (cb: (b: unknown) => void) => setTimeout(() => cb(new g.Blob([], {type: 'image/png'})), 0);
CanvasP.transferControlToOffscreen = function (this: unknown) { return this; };
CanvasP.captureStream = () => ({getTracks: () => []});
for (const dim of ['width', 'height'] as const) {
  Object.defineProperty(CanvasP, dim, {get() { return this.__dims?.[dim] ?? (dim === 'width' ? 300 : 150); },
    set(v) { (this.__dims ??= {})[dim] = Math.max(0, v | 0); this.__ctx?.resize(); }, configurable: true});
}
g.OffscreenCanvas = OffscreenCanvasImpl;
g.CanvasRenderingContext2D = Context2D;
g.OffscreenCanvasRenderingContext2D = Context2D;
g.Path2D = Path2DImpl;
g.ImageData ??= ImageDataImpl;

// Images. The bitmap stays a file reference: Unreal loads the texture itself by its source path.
export function resolveAssetPath(url: string): string {
  const u = new g.URL(url, 'http://localhost/');
  return decodeURIComponent(u.pathname);
}
function bytesFor(src: string): ArrayBuffer | null {
  if (src.startsWith('blob:')) { const b = blobStore.get(src) as {bytes?: Uint8Array} | undefined; return b?.bytes ? b.bytes.slice().buffer : null; }
  if (src.startsWith('data:')) {
    const comma = src.indexOf(','); const meta = src.slice(5, comma); const body = src.slice(comma + 1);
    const text = meta.endsWith(';base64') ? g.atob(body) : decodeURIComponent(body);
    const out = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i); return out.buffer;
  }
  return host.readFile(resolveAssetPath(src));
}
setImageReader(path => { const b = bytesFor(path); return b ? new Uint8Array(b) : undefined; });
const ImgP = page.HTMLImageElement.prototype as Record<string, any>;
Object.defineProperty(ImgP, 'src', {
  get() { return this.__src ?? ''; },
  set(v: string) {
    this.__src = String(v);
    setTimeout(() => {
      const bytes = bytesFor(this.__src);
      if (!bytes) { this.__ok = false; this.dispatchEvent(new BaseEvent('error')); this.onerror?.(new BaseEvent('error')); return; }
      const size = imageSize(new Uint8Array(bytes));
      this.__w = size.width; this.__h = size.height; this.__ok = true; this.__jsgbAsset = this.__src.startsWith('blob:') || this.__src.startsWith('data:') ? undefined : resolveAssetPath(this.__src);
      this.dispatchEvent(new BaseEvent('load')); this.onload?.(new BaseEvent('load'));
    }, 0);
  }, configurable: true,
});
for (const [prop, key] of [['naturalWidth', '__w'], ['naturalHeight', '__h']] as const) Object.defineProperty(ImgP, prop, {get() { return this[key] ?? 0; }, configurable: true});
Object.defineProperty(ImgP, 'width', {get() { return this.__dw ?? this.__w ?? 0; }, set(v) { this.__dw = v; }, configurable: true});
Object.defineProperty(ImgP, 'height', {get() { return this.__dh ?? this.__h ?? 0; }, set(v) { this.__dh = v; }, configurable: true});
Object.defineProperty(ImgP, 'complete', {get() { return this.__ok !== undefined; }, configurable: true});
ImgP.decode = function (this: Record<string, any>) { return new Promise<void>((res, rej) => { if (this.__ok) res(); else { this.addEventListener('load', () => res()); this.addEventListener('error', () => rej(new Error('decode failed'))); } }); };

g.ImageBitmap ??= ImageBitmapImpl;
g.createImageBitmap ??= async (source: Record<string, any>) => {
  if (source?.bytes) { const s = imageSize(source.bytes); return new g.ImageBitmap(s.width, s.height, undefined, source.bytes); }
  if (source?.__ctx) { const b = source.__ctx.bitmap(); return new g.ImageBitmap(b.width, b.height, undefined, undefined, {width: b.width, height: b.height, data: b.data.slice()}); }
  if (source?.data && source?.width) return new g.ImageBitmap(source.width, source.height, undefined, undefined, {width: source.width, height: source.height, data: new Uint8ClampedArray(source.data)});
  if (source?.__jsgbAsset || source?.naturalWidth) return new g.ImageBitmap(source.naturalWidth ?? source.width, source.naturalHeight ?? source.height, source.__jsgbAsset);
  return new g.ImageBitmap(source?.width ?? 1, source?.height ?? 1);
};

// Media elements and speech stay silent until audio routes through Unreal.
const MediaP = (page.HTMLMediaElement ?? page.HTMLElement).prototype as Record<string, any>;
MediaP.play ??= () => Promise.resolve(); MediaP.pause ??= () => {}; MediaP.load ??= () => {};
MediaP.canPlayType ??= () => 'probably';
g.Audio ??= class { src = ''; volume = 1; loop = false; currentTime = 0; paused = true; muted = false; preload = ''; play() { return Promise.resolve(); } pause() {} load() {} addEventListener() {} removeEventListener() {} };

export const domPage = page;

// Form state linkedom keeps only as attributes. The mirrored overlay reads them back as attributes.
const reflect = (proto: Record<string, any> | undefined, prop: string, read: (el: Record<string, any>) => unknown, write: (el: Record<string, any>, v: unknown) => void) => {
  if (proto) Object.defineProperty(proto, prop, {get() { return read(this); }, set(v) { write(this, v); }, configurable: true});
};
reflect(page.HTMLInputElement?.prototype, 'checked', el => el.hasAttribute('checked'), (el, v) => el.toggleAttribute('checked', !!v));
reflect(page.HTMLProgressElement?.prototype, 'max', el => Number(el.getAttribute('max') ?? 1), (el, v) => el.setAttribute('max', String(v)));
reflect(page.HTMLProgressElement?.prototype, 'value', el => Number(el.getAttribute('value') ?? 0), (el, v) => el.setAttribute('value', String(v)));
reflect(page.HTMLMeterElement?.prototype, 'value', el => Number(el.getAttribute('value') ?? 0), (el, v) => el.setAttribute('value', String(v)));
// <select> and <option> as browsers have them (linkedom keeps only the markup). Which option is selected lives in the
// "selected" attribute, so the overlay's copy of the page shows it. A single-choice select with nothing marked shows
// its first option, as in a browser.
const selectProto = Object.getPrototypeOf(doc.createElement('select')) as Record<string, any>;
const optionProto = Object.getPrototypeOf(doc.createElement('option')) as Record<string, any>;
const optionsOf = (el: Record<string, any>): Record<string, any>[] => [...el.querySelectorAll('option')];
const selectedOf = (el: Record<string, any>): Record<string, any>[] => {
  const opts = optionsOf(el), marked = opts.filter(o => o.hasAttribute('selected'));
  return marked.length || el.multiple || Number(el.getAttribute('size') ?? 0) > 1 || !opts.length ? marked : [opts[0]];
};
const selectOf = (o: Record<string, any>): Record<string, any> | null => o.closest?.('select') ?? null;
const choose = (o: Record<string, any>, on: boolean) => {
  const sel = selectOf(o);
  if (on && sel && !sel.multiple) for (const other of optionsOf(sel)) if (other !== o) other.removeAttribute('selected');
  o.toggleAttribute('selected', on);
};
const define = (proto: Record<string, any>, props: Record<string, PropertyDescriptor>) => {
  for (const [k, d] of Object.entries(props)) Object.defineProperty(proto, k, {configurable: true, ...d});
};
// select.options: a live list with add, remove, item and namedItem, as an HTMLOptionsCollection.
const optionsCollection = (el: Record<string, any>) => {
  const list = optionsOf(el) as Record<string, any>[] & Record<string, any>;
  list.item = (i: number) => list[i] ?? null;
  list.namedItem = (name: string) => list.find(o => o.id === name || o.getAttribute('name') === name) ?? null;
  list.add = (o: unknown, before?: unknown) => el.add(o, before);
  list.remove = (i: number) => el.remove(i);
  Object.defineProperty(list, 'selectedIndex', {get: () => el.selectedIndex, set: v => { el.selectedIndex = v; }});
  return list;
};
const removeElement = selectProto.remove;
define(selectProto, {
  options: {get() { return optionsCollection(this); }},
  length: {get() { return optionsOf(this).length; }, set(n: number) { const opts = optionsOf(this); for (let i = opts.length - 1; i >= n; i--) opts[i].remove(); for (let i = opts.length; i < n; i++) this.appendChild(doc.createElement('option')); }},
  selectedOptions: {get() { return selectedOf(this); }},
  selectedIndex: {get() { const first = selectedOf(this)[0]; return first ? optionsOf(this).indexOf(first) : -1; },
    set(i: number) { optionsOf(this).forEach((o, k) => o.toggleAttribute('selected', k === Number(i))); }},
  value: {get() { return selectedOf(this)[0]?.value ?? ''; },
    set(v: unknown) { let found = false; for (const o of optionsOf(this)) { const hit = !found && o.value === String(v); o.toggleAttribute('selected', hit); found ||= hit; } }},
  type: {get() { return this.multiple ? 'select-multiple' : 'select-one'; }},
  multiple: {get() { return this.hasAttribute('multiple'); }, set(v: boolean) { this.toggleAttribute('multiple', !!v); }},
  item: {value(i: number) { return optionsOf(this)[i] ?? null; }, writable: true},
  namedItem: {value(name: string) { return optionsCollection(this).namedItem(name); }, writable: true},
  // add(option or optgroup, before): before is an element or an index; without it the option goes last.
  add: {value(o: Record<string, any>, before?: number | Record<string, any> | null) {
    const ref = typeof before === 'number' ? optionsOf(this)[before] ?? null : before ?? null;
    if (ref && ref.parentNode) ref.parentNode.insertBefore(o, ref); else this.appendChild(o);
    if (o.hasAttribute?.('selected') && !this.multiple) choose(o, true);
  }, writable: true},
  // remove(index) drops that option; remove() with no index removes the select itself, as Element.remove does.
  remove: {value(this: Record<string, any>, ...args: unknown[]) {
    if (!args.length) return removeElement.call(this);
    optionsOf(this)[Number(args[0])]?.remove();
  }, writable: true},
});
define(optionProto, {
  value: {get() { return this.getAttribute('value') ?? (this.textContent ?? '').replace(/\s+/g, ' ').trim(); }, set(v: unknown) { this.setAttribute('value', String(v)); }},
  text: {get() { return (this.textContent ?? '').replace(/\s+/g, ' ').trim(); }, set(v: unknown) { this.textContent = String(v); }},
  label: {get() { return this.getAttribute('label') ?? this.text; }, set(v: unknown) { this.setAttribute('label', String(v)); }},
  selected: {get() { const sel = selectOf(this); return sel ? selectedOf(sel).includes(this) : this.hasAttribute('selected'); }, set(v: boolean) { choose(this, !!v); }},
  defaultSelected: {get() { return this.hasAttribute('selected'); }, set(v: boolean) { this.toggleAttribute('selected', !!v); }},
  index: {get() { const sel = selectOf(this); return sel ? optionsOf(sel).indexOf(this) : 0; }},
  form: {get() { return selectOf(this)?.closest?.('form') ?? null; }},
});
g.Option ??= function (text = '', value?: string, defaultSelected = false, selected = defaultSelected) {
  const o = doc.createElement('option'); o.textContent = text; if (value !== undefined) o.setAttribute('value', value); if (selected) o.setAttribute('selected', ''); return o;
};
g.HTMLSelectElement ??= selectProto.constructor;
g.HTMLOptionElement ??= optionProto.constructor;

// FormData over a form's named controls, as a browser collects them on submit.
class FormDataImpl {
  private list: [string, unknown][] = [];
  constructor(form?: Record<string, any>) {
    if (!form) return;
    for (const el of form.querySelectorAll('input,select,textarea') as Record<string, any>[]) {
      const name = el.getAttribute('name'); if (!name || el.hasAttribute('disabled')) continue;
      const type = (el.getAttribute('type') ?? '').toLowerCase();
      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
      if (type === 'submit' || type === 'button' || type === 'reset' || type === 'file') continue;
      this.list.push([name, type === 'checkbox' || type === 'radio' ? (el.getAttribute('value') ?? 'on') : String(el.value ?? el.getAttribute('value') ?? el.textContent ?? '')]);
    }
  }
  append(k: string, v: unknown) { this.list.push([k, v]); }
  set(k: string, v: unknown) { this.delete(k); this.list.push([k, v]); }
  delete(k: string) { this.list = this.list.filter(([n]) => n !== k); }
  get(k: string) { return this.list.find(([n]) => n === k)?.[1] ?? null; }
  getAll(k: string) { return this.list.filter(([n]) => n === k).map(([, v]) => v); }
  has(k: string) { return this.list.some(([n]) => n === k); }
  forEach(fn: (v: unknown, k: string) => void) { for (const [k, v] of this.list) fn(v, k); }
  keys() { return this.list.map(([k]) => k)[Symbol.iterator](); }
  values() { return this.list.map(([, v]) => v)[Symbol.iterator](); }
  entries() { return this.list.map(e => [...e])[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
}
g.FormData = FormDataImpl;

/** Submits a form the way a browser does: a cancelable submit event, then nothing (no navigation). */
export function submitForm(form: Record<string, any>, submitter: unknown = null) {
  const e = new BaseEvent('submit', {bubbles: true, cancelable: true});
  try { Object.defineProperty(e, 'submitter', {value: submitter}); } catch { /* frozen */ }
  form.dispatchEvent(e);
}
const FormP = page.HTMLFormElement?.prototype as Record<string, any> | undefined;
if (FormP) {
  FormP.requestSubmit = function (this: Record<string, any>, submitter?: unknown) { submitForm(this, submitter ?? null); };
  FormP.submit = function (this: Record<string, any>) { submitForm(this); };
  FormP.reset ??= function () {};
  FormP.checkValidity ??= () => true; FormP.reportValidity ??= () => true;
}
