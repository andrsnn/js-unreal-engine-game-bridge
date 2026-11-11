// Base64 for atob/btoa and data: URLs (polyfills.ts, dom.ts).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
// Base64 through a lookup table straight into bytes. The old atob built its string one character at a time with an
// indexOf per character: a 200 KB data: URL portrait took ~60 ms, and a game that set image sources every few frames
// (the life sim's phone) spent most of each frame there.
const B64_INDEX = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) B64_INDEX[B64.charCodeAt(i)] = i;
B64_INDEX['-'.charCodeAt(0)] = 62; B64_INDEX['_'.charCodeAt(0)] = 63; // base64url
/** Decodes base64 text (whitespace and padding ignored) into bytes. */
export function base64Bytes(s: string): Uint8Array {
  const n = s.length, out = new Uint8Array((n * 3 >> 2) + 3);
  let acc = 0, bits = 0, o = 0;
  for (let i = 0; i < n; i++) {
    const c = s.charCodeAt(i), v = c < 128 ? B64_INDEX[c] : -1;
    if (v < 0) continue;
    acc = (acc << 6 | v) & 0xffffff; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = acc >> bits & 255; }
  }
  return out.subarray(0, o);
}
/** Encodes bytes as base64 text. */
export function bytesBase64(b: Uint8Array): string {
  const parts: string[] = [], chunk: number[] = [];
  const E = B64;
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const v = b[i] << 16 | b[i + 1] << 8 | b[i + 2];
    chunk.push(E.charCodeAt(v >> 18 & 63), E.charCodeAt(v >> 12 & 63), E.charCodeAt(v >> 6 & 63), E.charCodeAt(v & 63));
    if (chunk.length >= 8192) { parts.push(String.fromCharCode.apply(null, chunk)); chunk.length = 0; }
  }
  if (i < b.length) {
    const a = b[i], c = i + 1 < b.length ? b[i + 1] : 0, v = a << 16 | c << 8;
    chunk.push(E.charCodeAt(v >> 18 & 63), E.charCodeAt(v >> 12 & 63), i + 1 < b.length ? E.charCodeAt(v >> 6 & 63) : 61, 61);
  }
  parts.push(String.fromCharCode.apply(null, chunk));
  return parts.join('');
}
