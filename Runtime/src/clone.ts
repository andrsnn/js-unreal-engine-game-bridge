/** A byte encoding for worker messages (the structured-clone subset workers use: plain data, arrays,
 *  maps, sets, dates, ArrayBuffers and their views), so worker results can be cached across a hot
 *  reload. encode returns null for anything else (functions, class instances, bitmaps). */
type Shape = null | boolean | number | string | Shape[] | {[k: string]: Shape};

const VIEWS: Record<string, new (b: ArrayBuffer, o: number, n: number) => ArrayBufferView> = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
  BigInt64Array: BigInt64Array as never, BigUint64Array: BigUint64Array as never, DataView: DataView as never,
};

export function encode(value: unknown): Uint8Array | null {
  const buffers: ArrayBuffer[] = [];
  const bufferIndex = (b: ArrayBuffer) => { let i = buffers.indexOf(b); if (i < 0) { i = buffers.length; buffers.push(b); } return i; };
  let ok = true;
  const walk = (v: unknown, depth: number): Shape => {
    if (!ok || depth > 64) { ok = false; return null; }
    if (v === null) return null;
    if (v === undefined) return {$: 'u'};
    if (typeof v === 'boolean' || typeof v === 'string') return v;
    if (typeof v === 'number') return Number.isFinite(v) ? v : {$: 'n', v: String(v)};
    if (typeof v === 'bigint') return {$: 'b', v: String(v)};
    if (typeof v !== 'object') { ok = false; return null; }
    if (Array.isArray(v)) return v.map(x => walk(x, depth + 1));
    if (v instanceof ArrayBuffer) return {$: 'ab', i: bufferIndex(v)};
    if (ArrayBuffer.isView(v)) {
      const type = v.constructor.name;
      if (!VIEWS[type] || !(v.buffer instanceof ArrayBuffer)) { ok = false; return null; }
      const n = v instanceof DataView ? v.byteLength : (v as unknown as {length: number}).length;
      return {$: 'v', t: type, i: bufferIndex(v.buffer), o: v.byteOffset, n};
    }
    if (v instanceof Map) return {$: 'm', v: [...v].map(([k, x]) => [walk(k, depth + 1), walk(x, depth + 1)])};
    if (v instanceof Set) return {$: 's', v: [...v].map(x => walk(x, depth + 1))};
    if (v instanceof Date) return {$: 'd', v: v.getTime()};
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) { ok = false; return null; }
    const out: {[k: string]: Shape} = {};
    for (const [k, x] of Object.entries(v)) out[k === '$' ? '$$' : k] = walk(x, depth + 1);
    return out;
  };
  const shape = walk(value, 0);
  if (!ok) return null;
  const json = new TextEncoder().encode(JSON.stringify({s: shape, b: buffers.map(b => b.byteLength)}));
  const head = (8 + json.length + 7) & ~7;
  let total = head;
  for (const b of buffers) total += (b.byteLength + 7) & ~7;
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, json.length, true);
  out.set(json, 8);
  let at = head;
  for (const b of buffers) { out.set(new Uint8Array(b), at); at += (b.byteLength + 7) & ~7; }
  return out;
}

export function decode(bytes: ArrayBuffer): unknown {
  const n = new DataView(bytes).getUint32(0, true);
  const {s, b} = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 8, n))) as {s: Shape; b: number[]};
  let at = (8 + n + 7) & ~7;
  const buffers = b.map(len => { const copy = bytes.slice(at, at + len); at += (len + 7) & ~7; return copy; });
  const walk = (v: Shape): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    switch (v.$) {
      case 'u': return undefined;
      case 'n': return Number(v.v);
      case 'b': return BigInt(v.v as string);
      case 'ab': return buffers[v.i as number];
      case 'v': return new VIEWS[v.t as string](buffers[v.i as number], v.o as number, v.n as number);
      case 'm': return new Map((v.v as Shape[][]).map(([k, x]) => [walk(k), walk(x)]));
      case 's': return new Set((v.v as Shape[]).map(walk));
      case 'd': return new Date(v.v as number);
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k === '$$' ? '$' : k] = walk(x);
    return out;
  };
  return walk(s);
}

/** A 64-bit hash (two 32-bit lanes) of bytes, as hex. */
export function hashBytes(bytes: Uint8Array, seed = ''): string {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < seed.length; i++) { a = Math.imul(a ^ seed.charCodeAt(i), 0x01000193); b = Math.imul(b ^ seed.charCodeAt(i), 0x5bd1e995); }
  const words = bytes.length >> 2;
  const w = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteOffset % 4 === 0 ? words : 0);
  let i = 0;
  if (w.length === words) for (; i < words; i++) { const x = w[i]; a = Math.imul(a ^ x, 0x01000193); b = Math.imul(b ^ x, 0x5bd1e995); b ^= b >>> 15; }
  for (i *= 4; i < bytes.length; i++) { a = Math.imul(a ^ bytes[i], 0x01000193); b = Math.imul(b ^ bytes[i], 0x5bd1e995); b ^= b >>> 15; }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0') + bytes.length.toString(16);
}
