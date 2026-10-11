import {host} from './host';
import {resolveAssetPath} from './dom';
import {blobStore} from './polyfills';
import {Headers, Response, Request, MIME, bufferOrigin} from './fetchCore';

export {bufferOrigin};

/** fetch() for the Unreal target: game assets come from the web build's public folder on disk.
 *  Network requests (frame logs, perf endpoints) answer 503 so callers take their offline path. */
const g = globalThis as Record<string, any>;

async function unrealFetch(input: string | {url: string}, init?: {method?: string}): Promise<Response> {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  if (url.startsWith('blob:')) { const b = blobStore.get(url) as {bytes: Uint8Array; type?: string} | undefined; return new Response(b ? b.bytes.slice().buffer : null, b ? 200 : 404, url, b?.type); }
  if (url.startsWith('data:')) { const comma = url.indexOf(','); const meta = url.slice(5, comma); const body = url.slice(comma + 1);
    const text = meta.endsWith(';base64') ? g.atob(body) : decodeURIComponent(body); const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i); return new Response(out.buffer, 200, url, meta.split(';')[0]); }
  const parsed = new g.URL(url, 'http://localhost/');
  if (parsed.hostname !== 'localhost' || (init?.method && init.method !== 'GET')) return new Response(null, 503, url);
  const path = resolveAssetPath(url);
  const bytes = host.readFile(path);
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return new Response(bytes, bytes ? 200 : 404, url, MIME[ext] ?? '');
}

g.fetch = unrealFetch; g.Response = Response; g.Headers = Headers;
g.Request ??= Request;

// XMLHttpRequest for loaders that still use it (three's FileLoader uses fetch).
g.XMLHttpRequest ??= class {
  readyState = 0; status = 0; response: unknown = null; responseText = ''; responseType = ''; onload: null | ((e: unknown) => void) = null;
  onerror: null | ((e: unknown) => void) = null; onreadystatechange: null | (() => void) = null; private url = '';
  open(_m: string, url: string) { this.url = url; this.readyState = 1; }
  setRequestHeader() {} overrideMimeType() {} abort() {} addEventListener(type: string, fn: (e: unknown) => void) { if (type === 'load') this.onload = fn; if (type === 'error') this.onerror = fn; }
  getResponseHeader() { return null; } getAllResponseHeaders() { return ''; }
  send() { void unrealFetch(this.url).then(async r => { this.status = r.status; this.readyState = 4;
    const buf = await r.arrayBuffer(); this.responseText = new g.TextDecoder().decode(buf);
    this.response = this.responseType === 'arraybuffer' ? buf : this.responseType === 'json' ? JSON.parse(this.responseText || 'null') : this.responseText;
    this.onreadystatechange?.(); if (r.ok) this.onload?.({target: this}); else this.onerror?.({target: this}); }); }
};
