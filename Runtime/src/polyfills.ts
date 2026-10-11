import '../../JavaScript/LanguageBuiltins.mjs';
import './intl';

/** Standard web APIs that Puerts' V8 (9.4, no Node, no browser) lacks. Each install is guarded,
 *  so a newer host keeps its native version. */
const g = globalThis as Record<string, any>;

g.window ??= g; g.self ??= g;

if (!g.structuredClone) {
  const clone = (v: any, seen: Map<any, any>): any => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return seen.get(v);
    if (v instanceof Date) return new Date(v.getTime());
    if (v instanceof RegExp) return new RegExp(v.source, v.flags);
    if (ArrayBuffer.isView(v)) return (v as any).slice();
    if (v instanceof ArrayBuffer) return v.slice(0);
    if (v instanceof Map) { const m = new Map(); seen.set(v, m); v.forEach((x, k) => m.set(clone(k, seen), clone(x, seen))); return m; }
    if (v instanceof Set) { const s = new Set(); seen.set(v, s); v.forEach(x => s.add(clone(x, seen))); return s; }
    const out: any = Array.isArray(v) ? [] : {}; seen.set(v, out);
    for (const k of Object.keys(v)) out[k] = clone(v[k], seen);
    return out;
  };
  g.structuredClone = (v: unknown) => clone(v, new Map());
}

if (!g.TextEncoder) {
  g.TextEncoder = class { readonly encoding = 'utf-8';
    encode(s = '') { const out: number[] = [];
      for (let i = 0; i < s.length; i++) { let c = s.charCodeAt(i);
        if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d < 0xe000) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; } }
        if (c < 0x80) out.push(c); else if (c < 0x800) out.push(0xc0 | c >> 6, 0x80 | c & 63);
        else if (c < 0x10000) out.push(0xe0 | c >> 12, 0x80 | c >> 6 & 63, 0x80 | c & 63);
        else out.push(0xf0 | c >> 18, 0x80 | c >> 12 & 63, 0x80 | c >> 6 & 63, 0x80 | c & 63); }
      return new Uint8Array(out); } };
}
if (!g.TextDecoder) {
  g.TextDecoder = class { readonly encoding = 'utf-8';
    decode(input?: ArrayBuffer | ArrayBufferView) {
      if (!input) return '';
      const b = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
      let out = '', chunk: number[] = [];
      for (let i = 0; i < b.length;) { const c = b[i++]; let cp = c;
        if (c >= 0xf0) cp = (c & 7) << 18 | (b[i++] & 63) << 12 | (b[i++] & 63) << 6 | b[i++] & 63;
        else if (c >= 0xe0) cp = (c & 15) << 12 | (b[i++] & 63) << 6 | b[i++] & 63;
        else if (c >= 0xc0) cp = (c & 31) << 6 | b[i++] & 63;
        if (cp >= 0x10000) { cp -= 0x10000; chunk.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023)); } else chunk.push(cp);
        if (chunk.length > 8192) { out += String.fromCharCode(...chunk); chunk = []; } }
      return out + String.fromCharCode(...chunk); } };
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
g.atob ??= (s: string) => { s = String(s).replace(/[^A-Za-z0-9+/]/g, ''); let out = '';
  for (let i = 0; i < s.length; i += 4) { const n = B64.indexOf(s[i]) << 18 | B64.indexOf(s[i + 1]) << 12 | (B64.indexOf(s[i + 2]) & 63) << 6 | B64.indexOf(s[i + 3]) & 63;
    out += String.fromCharCode(n >> 16 & 255); if (s[i + 2] !== undefined) out += String.fromCharCode(n >> 8 & 255); if (s[i + 3] !== undefined) out += String.fromCharCode(n & 255); }
  return out; };
g.btoa ??= (s: string) => { let out = '';
  for (let i = 0; i < s.length; i += 3) { const a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2), n = a << 16 | (b || 0) << 8 | (c || 0);
    out += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (isNaN(b) ? '=' : B64[n >> 6 & 63]) + (isNaN(c) ? '=' : B64[n & 63]); }
  return out; };

if (!g.URLSearchParams) {
  g.URLSearchParams = class URLSearchParams {
    private list: [string, string][] = [];
    constructor(init: string | Record<string, string> | [string, string][] = '') {
      const dec = (x: string) => decodeURIComponent(x.replace(/\+/g, ' '));
      if (typeof init === 'string') { for (const part of init.replace(/^\?/, '').split('&')) { if (!part) continue; const i = part.indexOf('='); this.list.push(i < 0 ? [dec(part), ''] : [dec(part.slice(0, i)), dec(part.slice(i + 1))]); } }
      else if (Array.isArray(init)) this.list = init.map(([k, v]) => [String(k), String(v)]);
      else if (init) this.list = Object.entries(init).map(([k, v]) => [k, String(v)]);
    }
    get size() { return this.list.length; }
    get(k: string) { const e = this.list.find(([n]) => n === k); return e ? e[1] : null; }
    getAll(k: string) { return this.list.filter(([n]) => n === k).map(([, v]) => v); }
    has(k: string) { return this.list.some(([n]) => n === k); }
    set(k: string, v: string) { this.delete(k); this.list.push([k, String(v)]); }
    append(k: string, v: string) { this.list.push([k, String(v)]); }
    delete(k: string) { this.list = this.list.filter(([n]) => n !== k); }
    forEach(fn: (v: string, k: string) => void) { for (const [k, v] of this.list) fn(v, k); }
    keys() { return this.list.map(([k]) => k)[Symbol.iterator](); }
    values() { return this.list.map(([, v]) => v)[Symbol.iterator](); }
    entries() { return this.list.map(e => [...e])[Symbol.iterator](); }
    [Symbol.iterator]() { return this.entries(); }
    toString() { return this.list.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); }
  };
}

let blobIds = 0;
/** Blob URLs are shared by the page and its worker threads, as in a browser. Each JavaScript engine keeps
 *  its own blobs, and the host's registry (__jsgbBlobs, when present) holds a copy every engine can read. */
type SharedBlobs = {put(url: string, bytes: ArrayBuffer, type: string): void; get(url: string): {bytes: ArrayBuffer; type: string} | null; revoke(url: string): void};
const sharedBlobs = () => g.__jsgbBlobs as SharedBlobs | undefined;
class BlobStore extends Map<string, unknown> {
  get(url: string) {
    const local = super.get(url);
    if (local !== undefined) return local;
    const s = typeof url === 'string' && url.startsWith('blob:') ? sharedBlobs()?.get(url) : null;
    if (!s) return undefined;
    const blob = new g.Blob([s.bytes], {type: s.type});
    super.set(url, blob);
    return blob;
  }
  set(url: string, blob: unknown) {
    super.set(url, blob);
    const bytes = (blob as {bytes?: Uint8Array})?.bytes, shared = sharedBlobs();
    if (shared && bytes) shared.put(url, bytes.slice().buffer, (blob as {type?: string}).type ?? '');
    return this;
  }
  delete(url: string) { sharedBlobs()?.revoke(url); return super.delete(url); }
}
export const blobStore = new BlobStore();
// Each engine names its blobs with its own prefix, so URLs from a worker and the page never collide.
const blobPrefix = () => (g.__jsgbBlobPrefix as string | undefined) ?? 'blob:jsgb/';

if (!g.URL) {
  class URLImpl {
    protocol = 'http:'; host = 'localhost'; hostname = 'localhost'; port = ''; pathname = '/'; search = ''; hash = ''; username = ''; password = '';
    constructor(url: string | URLImpl, base?: string | URLImpl) {
      const s = String(url);
      const m = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(s);
      if (m) { this.protocol = m[1]; this.host = m[2]; [this.hostname, this.port = ''] = m[2].split(':'); this.pathname = m[3] || '/'; this.search = m[4] ?? ''; this.hash = m[5] ?? ''; }
      else if (/^(data|blob):/i.test(s)) { this.protocol = s.slice(0, s.indexOf(':') + 1); this.pathname = s.slice(this.protocol.length); this.host = this.hostname = ''; }
      else {
        if (base === undefined) throw new TypeError('Invalid URL: ' + s);
        const b = new URLImpl(base);
        this.protocol = b.protocol; this.host = b.host; this.hostname = b.hostname; this.port = b.port;
        const r = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(s)!;
        let path = r[1];
        if (!path) { path = b.pathname; this.search = r[2] ?? b.search; }
        else { this.search = r[2] ?? ''; if (!path.startsWith('/')) path = b.pathname.replace(/[^/]*$/, '') + path; }
        const parts: string[] = [];
        for (const p of path.split('/')) { if (p === '..') parts.pop(); else if (p !== '.') parts.push(p); }
        this.pathname = parts.join('/') || '/'; if (!this.pathname.startsWith('/')) this.pathname = '/' + this.pathname;
        this.hash = r[3] ?? '';
      }
    }
    get origin() { return this.protocol + '//' + this.host; }
    get href() { return /^(data|blob):/.test(this.protocol) ? this.protocol + this.pathname : this.origin + this.pathname + this.search + this.hash; }
    get searchParams() { return new g.URLSearchParams(this.search); }
    toString() { return this.href; }
    toJSON() { return this.href; }
    static createObjectURL(blob: unknown) { const id = blobPrefix() + (++blobIds); blobStore.set(id, blob); return id; }
    static revokeObjectURL(id: string) { blobStore.delete(id); }
  }
  g.URL = URLImpl;
} else {
  const native = g.URL;
  native.createObjectURL = (blob: unknown) => { const id = blobPrefix() + (++blobIds); blobStore.set(id, blob); return id; };
  native.revokeObjectURL = (id: string) => { blobStore.delete(id); };
}

if (!g.Blob) {
  g.Blob = class Blob {
    readonly bytes: Uint8Array; readonly type: string;
    constructor(parts: unknown[] = [], opts: {type?: string} = {}) {
      const chunks = parts.map(p => typeof p === 'string' ? new g.TextEncoder().encode(p) as Uint8Array
        : p instanceof ArrayBuffer ? new Uint8Array(p)
        : ArrayBuffer.isView(p) ? new Uint8Array(p.buffer, p.byteOffset, p.byteLength)
        : (p as {bytes?: Uint8Array}).bytes ?? new Uint8Array());
      const total = chunks.reduce((n, c) => n + c.length, 0); this.bytes = new Uint8Array(total);
      let o = 0; for (const c of chunks) { this.bytes.set(c, o); o += c.length; } this.type = opts.type ?? '';
    }
    get size() { return this.bytes.length; }
    async arrayBuffer() { return this.bytes.slice().buffer; }
    async text() { return new g.TextDecoder().decode(this.bytes); }
    slice(a?: number, b?: number, type?: string) { return new g.Blob([this.bytes.slice(a, b)], {type}); }
  };
}

// FileReader over Blob: reads finish on a later turn and fire load and loadend, as in a browser.
if (!g.FileReader) {
  g.FileReader = class FileReader {
    static EMPTY = 0; static LOADING = 1; static DONE = 2;
    readyState = 0; result: unknown = null; error: unknown = null;
    onload: ((e: unknown) => void) | null = null; onloadend: ((e: unknown) => void) | null = null; onerror: ((e: unknown) => void) | null = null;
    onloadstart: ((e: unknown) => void) | null = null; onprogress: ((e: unknown) => void) | null = null; onabort: ((e: unknown) => void) | null = null;
    private listeners: Record<string, ((e: unknown) => void)[]> = {};
    addEventListener(type: string, fn: (e: unknown) => void) { (this.listeners[type] ??= []).push(fn); }
    removeEventListener(type: string, fn: (e: unknown) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter(f => f !== fn); }
    private fire(type: string) {
      const e = {type, target: this, currentTarget: this};
      (this as unknown as Record<string, ((e: unknown) => void) | null>)['on' + type]?.(e);
      for (const fn of this.listeners[type] ?? []) fn(e);
    }
    private read(blob: {bytes?: Uint8Array; arrayBuffer(): Promise<ArrayBuffer>; type?: string}, convert: (b: ArrayBuffer) => unknown) {
      this.readyState = 1; this.fire('loadstart');
      Promise.resolve(blob.arrayBuffer()).then(b => { this.result = convert(b); this.readyState = 2; this.fire('progress'); this.fire('load'); this.fire('loadend'); },
        e => { this.error = e; this.readyState = 2; this.fire('error'); this.fire('loadend'); });
    }
    readAsArrayBuffer(blob: never) { this.read(blob, b => b); }
    readAsText(blob: never) { this.read(blob, b => new g.TextDecoder().decode(b)); }
    readAsBinaryString(blob: never) { this.read(blob, b => { let s = ''; for (const c of new Uint8Array(b)) s += String.fromCharCode(c); return s; }); }
    readAsDataURL(blob: {type?: string}) { this.read(blob as never, b => { let s = ''; for (const c of new Uint8Array(b)) s += String.fromCharCode(c); return `data:${blob.type || 'application/octet-stream'};base64,${g.btoa(s)}`; }); }
    abort() { this.readyState = 2; this.fire('abort'); this.fire('loadend'); }
  };
}

if (!g.AbortController) {
  g.AbortSignal = class { aborted = false; reason: unknown; onabort: null | (() => void) = null; private l: (() => void)[] = [];
    addEventListener(_: string, f: () => void) { this.l.push(f); } removeEventListener(_: string, f: () => void) { this.l = this.l.filter(x => x !== f); }
    throwIfAborted() { if (this.aborted) throw this.reason; }
    _abort(r: unknown) { if (this.aborted) return; this.aborted = true; this.reason = r; this.onabort?.(); this.l.forEach(f => f()); } };
  g.AbortController = class { signal = new g.AbortSignal(); abort(r?: unknown) { this.signal._abort(r ?? new Error('AbortError')); } };
}

g.crypto ??= {};
// crypto has its own generator, so it never shifts a seeded Math.random sequence.
let cryptoState = (Date.now() ^ 0x9e3779b9) >>> 0;
const cryptoByte = () => { cryptoState ^= cryptoState << 13; cryptoState ^= cryptoState >>> 17; cryptoState ^= cryptoState << 5; return (cryptoState >>> 0) & 255; };
g.crypto.getRandomValues ??= (a: ArrayBufferView) => { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i++) b[i] = cryptoByte(); return a; };
g.crypto.randomUUID ??= () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = cryptoByte() & 15; return (c === 'x' ? r : r & 3 | 8).toString(16); });

const nav = (g.navigator ??= {});
try { Object.assign(nav, {userAgent: 'JsGameBridge-Unreal', language: 'en-US', languages: ['en-US'], hardwareConcurrency: 8, maxTouchPoints: 0, platform: 'Win32'}); } catch { /* read-only host navigator */ }
nav.getGamepads ??= () => [];
nav.storage ??= {estimate: async () => ({usage: 0, quota: 1e10}), persist: async () => true};
nav.clipboard ??= {writeText: async () => {}, readText: async () => ''};
nav.vibrate ??= () => false;
nav.sendBeacon ??= () => true;

// Puerts does not pump V8's platform task queue, so async WebAssembly compilation never settles.
// Compile and instantiate synchronously and hand back settled promises with the same results.
if (g.WebAssembly && !g.WebAssembly.__jsgbSync) {
  const W = g.WebAssembly;
  const bytesOf = async (src: any) => {
    if (src && typeof src.then === 'function') src = await src;
    if (src && typeof src.arrayBuffer === 'function') src = await src.arrayBuffer();
    return src;
  };
  W.compile = async (src: any) => new W.Module(await bytesOf(src));
  W.instantiate = async (src: any, imports?: object) => {
    if (src instanceof W.Module) return new W.Instance(src, imports);
    const module = new W.Module(await bytesOf(src));
    return {module, instance: new W.Instance(module, imports)};
  };
  W.compileStreaming = async (src: any) => W.compile(src);
  W.instantiateStreaming = async (src: any, imports?: object) => W.instantiate(await bytesOf(src), imports);
  W.__jsgbSync = true;
}

// ES2022-2025 built-ins newer than Puerts' V8. Each is installed only when missing.
const define = (target: Record<string, any>, key: string, value: unknown) => {
  if (target && !(key in target)) Object.defineProperty(target, key, {value, writable: true, configurable: true});
};
const AP = Array.prototype as unknown as Record<string, any>;
const typedArrays = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array']
  .map(n => g[n]?.prototype).filter(Boolean) as Record<string, any>[];
const at = function (this: ArrayLike<unknown>, i: number) { const n = Math.trunc(i) || 0, k = n < 0 ? this.length + n : n; return k >= 0 && k < this.length ? this[k] : undefined; };
const findLast = function (this: ArrayLike<unknown>, fn: (v: unknown, i: number, a: unknown) => unknown, self?: unknown) { for (let i = this.length - 1; i >= 0; i--) if (fn.call(self, this[i], i, this)) return this[i]; return undefined; };
const findLastIndex = function (this: ArrayLike<unknown>, fn: (v: unknown, i: number, a: unknown) => unknown, self?: unknown) { for (let i = this.length - 1; i >= 0; i--) if (fn.call(self, this[i], i, this)) return i; return -1; };
for (const proto of [AP, ...typedArrays]) { define(proto, 'at', at); define(proto, 'findLast', findLast); define(proto, 'findLastIndex', findLastIndex); }
define(AP, 'toSorted', function (this: unknown[], compare?: (a: unknown, b: unknown) => number) { return Array.from(this).sort(compare); });
define(AP, 'toReversed', function (this: unknown[]) { return Array.from(this).reverse(); });
define(AP, 'toSpliced', function (this: unknown[], ...args: [number, number, ...unknown[]]) { const copy = Array.from(this); copy.splice(...args); return copy; });
define(AP, 'with', function (this: unknown[], i: number, v: unknown) { const copy = Array.from(this); copy[i < 0 ? copy.length + i : i] = v; return copy; });
for (const proto of typedArrays) {
  define(proto, 'toSorted', function (this: any, compare?: (a: number, b: number) => number) { return this.slice().sort(compare); });
  define(proto, 'toReversed', function (this: any) { return this.slice().reverse(); });
  define(proto, 'with', function (this: any, i: number, v: number) { const copy = this.slice(); copy[i < 0 ? copy.length + i : i] = v; return copy; });
}
const StrP = String.prototype as unknown as Record<string, any>;
define(StrP, 'at', at);
define(StrP, 'replaceAll', function (this: string, search: string | RegExp, replace: any) {
  return search instanceof RegExp ? this.replace(search, replace) : this.split(search).join(typeof replace === 'function' ? replace(search) : replace);
});
const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;
define(StrP, 'isWellFormed', function (this: string) { loneSurrogate.lastIndex = 0; return !loneSurrogate.test(this); });
define(StrP, 'toWellFormed', function (this: string) { return this.replace(loneSurrogate, '�'); });
define(Object as unknown as Record<string, any>, 'hasOwn', (o: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(o, k));
define(Object as unknown as Record<string, any>, 'groupBy', (items: Iterable<unknown>, fn: (v: unknown, i: number) => PropertyKey) => {
  const out: Record<PropertyKey, unknown[]> = Object.create(null); let i = 0; for (const v of items) (out[fn(v, i++)] ??= []).push(v); return out;
});
define(Map as unknown as Record<string, any>, 'groupBy', (items: Iterable<unknown>, fn: (v: unknown, i: number) => unknown) => {
  const out = new Map<unknown, unknown[]>(); let i = 0; for (const v of items) { const k = fn(v, i++); if (!out.has(k)) out.set(k, []); out.get(k)!.push(v); } return out;
});
define(Promise as unknown as Record<string, any>, 'withResolvers', function () { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return {promise, resolve, reject}; });
define(Array as unknown as Record<string, any>, 'fromAsync', async (items: AsyncIterable<unknown> | Iterable<unknown>, map?: (v: unknown, i: number) => unknown) => {
  const out: unknown[] = []; let i = 0; for await (const v of items as AsyncIterable<unknown>) out.push(map ? await map(v, i++) : v); return out;
});
const SP = Set.prototype as unknown as Record<string, any>;
define(SP, 'union', function (this: Set<unknown>, o: Iterable<unknown>) { return new Set([...this, ...o]); });
define(SP, 'intersection', function (this: Set<unknown>, o: {has(v: unknown): boolean}) { return new Set([...this].filter(v => o.has(v))); });
define(SP, 'difference', function (this: Set<unknown>, o: {has(v: unknown): boolean}) { return new Set([...this].filter(v => !o.has(v))); });
define(SP, 'symmetricDifference', function (this: Set<unknown>, o: Iterable<unknown>) { const out = new Set(this); for (const v of o) { if (this.has(v)) out.delete(v); else out.add(v); } return out; });
define(SP, 'isSubsetOf', function (this: Set<unknown>, o: {has(v: unknown): boolean}) { return [...this].every(v => o.has(v)); });
define(SP, 'isSupersetOf', function (this: Set<unknown>, o: Iterable<unknown>) { for (const v of o) if (!this.has(v)) return false; return true; });
define(SP, 'isDisjointFrom', function (this: Set<unknown>, o: {has(v: unknown): boolean}) { return [...this].every(v => !o.has(v)); });
if (g.AbortSignal) {
  define(g.AbortSignal, 'timeout', (ms: number) => { const c = new g.AbortController(); g.setTimeout(() => c.abort(new Error('TimeoutError')), ms); return c.signal; });
  define(g.AbortSignal, 'any', (signals: {aborted: boolean; addEventListener(t: string, f: () => void): void}[]) => { const c = new g.AbortController(); for (const s of signals) { if (s.aborted) c.abort(); else s.addEventListener('abort', () => c.abort()); } return c.signal; });
}
define(g, 'reportError', (e: unknown) => g.__jsgbHost?.log('error', 'reportError: ' + ((e as Error)?.stack ?? e)));
