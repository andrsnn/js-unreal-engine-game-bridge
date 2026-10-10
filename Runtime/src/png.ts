import {unzlibSync} from 'fflate';

/** Decodes a PNG (8/16-bit, gray, gray+alpha, RGB, RGBA, palette, non-interlaced or Adam7) into
 *  straight-alpha RGBA8. Used when the game draws loaded images into a canvas. */
export function decodePng(bytes: Uint8Array): {width: number; height: number; data: Uint8ClampedArray} | null {
  if (bytes.length < 33 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 8, width = 0, height = 0, depth = 8, color = 6, interlace = 0;
  let palette: Uint8Array | null = null, trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (o + 8 <= bytes.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
    const body = bytes.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { width = dv.getUint32(o + 8); height = dv.getUint32(o + 12); depth = body[8]; color = body[9]; interlace = body[12]; }
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  if (!width || !height) return null;
  const total = idat.reduce((n, c) => n + c.length, 0), joined = new Uint8Array(total);
  let p = 0; for (const c of idat) { joined.set(c, p); p += c.length; }
  const raw = unzlibSync(joined);
  const channels = color === 0 ? 1 : color === 2 ? 3 : color === 3 ? 1 : color === 4 ? 2 : 4;
  const bpp = Math.max(1, (channels * depth) >> 3);
  const out = new Uint8ClampedArray(width * height * 4);
  let src = 0;
  const pass = (x0: number, y0: number, dx: number, dy: number) => {
    const pw = Math.ceil((width - x0) / dx), ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) return;
    const stride = Math.ceil(pw * channels * depth / 8);
    let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
    for (let y = 0; y < ph; y++) {
      const filter = raw[src++];
      for (let i = 0; i < stride; i++) {
        const x = raw[src++], a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        let v = x;
        if (filter === 1) v = x + a; else if (filter === 2) v = x + b; else if (filter === 3) v = x + ((a + b) >> 1);
        else if (filter === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        cur[i] = v & 255;
      }
      for (let x = 0; x < pw; x++) {
        const sample = (ch: number) => {
          if (depth === 8) return cur[x * channels + ch];
          if (depth === 16) return cur[(x * channels + ch) * 2];
          const bit = (x * channels + ch) * depth, byte = cur[bit >> 3], shift = 8 - depth - (bit & 7);
          const v = (byte >> shift) & ((1 << depth) - 1);
          return color === 3 ? v : Math.round(v * 255 / ((1 << depth) - 1));
        };
        const di = ((y0 + y * dy) * width + (x0 + x * dx)) * 4;
        if (color === 3) { const i = sample(0); out[di] = palette![i * 3]; out[di + 1] = palette![i * 3 + 1]; out[di + 2] = palette![i * 3 + 2]; out[di + 3] = trns && i < trns.length ? trns[i] : 255; }
        else if (color === 0 || color === 4) { const v = sample(0); out[di] = out[di + 1] = out[di + 2] = v; out[di + 3] = color === 4 ? sample(1) : 255; }
        else { out[di] = sample(0); out[di + 1] = sample(1); out[di + 2] = sample(2); out[di + 3] = color === 6 ? sample(3) : 255; }
      }
      const t = prev; prev = cur; cur = t;
    }
  };
  if (interlace) { pass(0, 0, 8, 8); pass(4, 0, 8, 8); pass(0, 4, 4, 8); pass(2, 0, 4, 4); pass(0, 2, 2, 4); pass(1, 0, 2, 2); pass(0, 1, 1, 2); }
  else pass(0, 0, 1, 1);
  return {width, height, data: out};
}
