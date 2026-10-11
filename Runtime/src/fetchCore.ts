/** The Fetch API classes without any host: Headers, Response, Request and the compression streams.
 *  The page (fetch.ts) and threaded Web Workers (workerRuntime.ts) share them. */
import {gunzipSync, gzipSync, unzlibSync, zlibSync, inflateSync, deflateSync} from 'fflate';

const g = globalThis as Record<string, any>;

/** Which URL each fetched ArrayBuffer came from, so decoded audio can name its source file. */
export const bufferOrigin = new WeakMap<ArrayBuffer, string>();

export class Headers {
  private m = new Map<string, string>();
  constructor(init?: Record<string, string>) { for (const [k, v] of Object.entries(init ?? {})) this.m.set(k.toLowerCase(), v); }
  get(k: string) { return this.m.get(k.toLowerCase()) ?? null; }
  has(k: string) { return this.m.has(k.toLowerCase()); }
  set(k: string, v: string) { this.m.set(k.toLowerCase(), v); }
  forEach(fn: (v: string, k: string) => void) { this.m.forEach(fn); }
}

export const MIME: Record<string, string> = {json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  glb: 'model/gltf-binary', gltf: 'model/gltf+json', bin: 'application/octet-stream', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', ktx2: 'image/ktx2'};

/** A fully buffered stream: enough of ReadableStream for pipeThrough and new Response(stream). */
class BufferedStream {
  constructor(readonly __bytes: Uint8Array) {}
  pipeThrough(t: {__transform?: (b: Uint8Array) => Uint8Array}) { return new BufferedStream(t.__transform ? t.__transform(this.__bytes) : this.__bytes); }
  getReader() { let sent = false; const b = this.__bytes; return {read: async () => { if (sent) return {done: true, value: undefined}; sent = true; return {done: false, value: b}; }, releaseLock() {}, cancel: async () => {}}; }
  cancel() { return Promise.resolve(); }
  get locked() { return false; }
}
const toBytes = (body: unknown): Uint8Array | null => {
  if (body == null) return null;
  if (body instanceof BufferedStream) return body.__bytes;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (typeof body === 'string') return new g.TextEncoder().encode(body);
  if ((body as {bytes?: Uint8Array}).bytes instanceof Uint8Array) return (body as {bytes: Uint8Array}).bytes;
  return null;
};
const codec = (format: string, decode: boolean) => (b: Uint8Array) => format === 'gzip' ? (decode ? gunzipSync(b) : gzipSync(b))
  : format === 'deflate' ? (decode ? unzlibSync(b) : zlibSync(b)) : (decode ? inflateSync(b) : deflateSync(b));
g.DecompressionStream ??= class { readonly __transform: (b: Uint8Array) => Uint8Array; constructor(format: string) { this.__transform = codec(format, true); } };
g.CompressionStream ??= class { readonly __transform: (b: Uint8Array) => Uint8Array; constructor(format: string) { this.__transform = codec(format, false); } };

export class Response {
  readonly ok: boolean; readonly headers: Headers; readonly bodyUsed = false; readonly redirected = false; readonly type = 'basic';
  readonly status: number; readonly url: string; private bytes: ArrayBuffer | null;
  constructor(body?: unknown, init?: number | {status?: number; headers?: Record<string, string>}, url = '', type = '') {
    const b = toBytes(body);
    this.bytes = b ? (Uint8Array.prototype.slice.call(b) as Uint8Array).buffer as ArrayBuffer : null;
    this.status = typeof init === 'number' ? init : init?.status ?? 200;
    this.url = url;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new Headers({'content-type': type, 'content-length': String(this.bytes?.byteLength ?? 0), ...(typeof init === 'object' ? init?.headers : {})});
  }
  get statusText() { return this.ok ? 'OK' : this.status === 404 ? 'Not Found' : 'Service Unavailable'; }
  async arrayBuffer() { const b = this.bytes ? this.bytes.slice(0) : new ArrayBuffer(0); if (this.url) bufferOrigin.set(b, this.url); return b; }
  async text() { return new g.TextDecoder().decode(this.bytes ?? new ArrayBuffer(0)); }
  async json() { return JSON.parse(await this.text()); }
  async blob() { return new g.Blob([this.bytes ?? new ArrayBuffer(0)], {type: this.headers.get('content-type') ?? ''}); }
  async bytesArray() { return new Uint8Array(this.bytes ?? new ArrayBuffer(0)); }
  clone() { return new Response(this.bytes, this.status, this.url, this.headers.get('content-type') ?? ''); }
  get body() { return new BufferedStream(new Uint8Array(this.bytes ?? new ArrayBuffer(0))); }
}


export class Request {
  readonly url: string; readonly method: string; readonly headers: Headers;
  constructor(input: string | {url: string}, init: {method?: string; headers?: Record<string, string>} = {}) {
    this.url = typeof input === 'string' ? input : input.url; this.method = init.method ?? 'GET'; this.headers = new Headers(init.headers);
  }
  clone() { return new Request(this.url, {method: this.method}); }
}
