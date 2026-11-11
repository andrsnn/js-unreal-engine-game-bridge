// Pixels of the image files a 2D canvas can draw: PNG (png.ts), JPEG (jpeg-js) and the 32-bit BMP that canvas
// toDataURL / toBlob write here (dom.ts). Games read pixels back from JPEGs too (a Sims 4 Tray portrait's skin colour);
// before JPEG decoding those reads came back black.
import {decodePng} from './png.ts';
import jpeg from 'jpeg-js';

export type Pixels = {width: number; height: number; data: Uint8ClampedArray};

function decodeBmp(b: Uint8Array): Pixels | null {
  if (b.length < 54 || b[0] !== 0x42 || b[1] !== 0x4d) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const off = v.getUint32(10, true), w = v.getInt32(18, true), hRaw = v.getInt32(22, true), bpp = v.getUint16(28, true);
  if (v.getUint32(30, true) !== 0 && v.getUint32(30, true) !== 3) return null; // uncompressed (BI_RGB / BI_BITFIELDS) only
  if (bpp !== 32 && bpp !== 24 || w <= 0 || hRaw === 0) return null;
  const h = Math.abs(hRaw), topDown = hRaw < 0, bytesPP = bpp / 8, stride = (w * bytesPP + 3) & ~3;
  if (off + stride * (h - 1) + w * bytesPP > b.length) return null;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = off + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const i = row + x * bytesPP, o = (y * w + x) * 4;
      data[o] = b[i + 2]; data[o + 1] = b[i + 1]; data[o + 2] = b[i]; data[o + 3] = bpp === 32 ? b[i + 3] : 255;
    }
  }
  return {width: w, height: h, data};
}

function decodeJpeg(b: Uint8Array): Pixels | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  try {
    const img = jpeg.decode(b, {useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 256});
    return {width: img.width, height: img.height, data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength)};
  } catch { return null; }
}

/** Decoded pixels of a PNG, JPEG or BMP file, or null for anything else. */
export function decodeImageFile(bytes: Uint8Array): Pixels | null {
  return decodePng(bytes) ?? decodeJpeg(bytes) ?? decodeBmp(bytes);
}
