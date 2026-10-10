import {decodePng} from './png';

/** Software CanvasRenderingContext2D for the Unreal target. The game draws many of its textures
 *  (pixel-art surfaces, decals, gradients) at runtime; this rasterizes them into an RGBA buffer
 *  that the scene exporter uploads like any other texture. Covers rects, paths (lines, quadratic
 *  and bezier curves, arcs, ellipses), stroke, linear/radial gradients, transforms, save/restore,
 *  rect clipping, globalAlpha, the common composite modes, drawImage and image data. */

type RGBA = [number, number, number, number];
type Stop = {o: number; c: RGBA};
type Paint = {kind: 'color'; c: RGBA} | {kind: 'linear'; x0: number; y0: number; x1: number; y1: number; stops: Stop[]}
  | {kind: 'radial'; x0: number; y0: number; r0: number; x1: number; y1: number; r1: number; stops: Stop[]};
type Matrix = [number, number, number, number, number, number];

const NAMED: Record<string, string> = {black: '#000', white: '#fff', red: '#f00', green: '#008000', lime: '#0f0', blue: '#00f', yellow: '#ff0', cyan: '#0ff', aqua: '#0ff', magenta: '#f0f', fuchsia: '#f0f',
  gray: '#808080', grey: '#808080', silver: '#c0c0c0', maroon: '#800000', olive: '#808000', navy: '#000080', purple: '#800080', teal: '#008080', orange: '#ffa500', brown: '#a52a2a', pink: '#ffc0cb',
  gold: '#ffd700', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', dimgray: '#696969', whitesmoke: '#f5f5f5', crimson: '#dc143c', coral: '#ff7f50', tan: '#d2b48c'};
const colorCache = new Map<string, RGBA>();

export function parseColor(input: string): RGBA {
  const key = String(input).trim().toLowerCase();
  const cached = colorCache.get(key); if (cached) return cached;
  let c: RGBA = [0, 0, 0, 1];
  const s = NAMED[key] ?? key;
  if (s === 'transparent') c = [0, 0, 0, 0];
  else if (s[0] === '#') {
    const h = s.slice(1);
    const x = (i: number, n: number) => parseInt(h.slice(i, i + n), 16) * (n === 1 ? 17 : 1);
    if (h.length === 3 || h.length === 4) c = [x(0, 1), x(1, 1), x(2, 1), h.length === 4 ? x(3, 1) / 255 : 1];
    else if (h.length === 6 || h.length === 8) c = [x(0, 2), x(2, 2), x(4, 2), h.length === 8 ? x(6, 2) / 255 : 1];
  } else {
    const m = /^(rgba?|hsla?)\(([^)]*)\)/.exec(s);
    if (m) {
      const parts = m[2].replace(/\//g, ' ').split(/[\s,]+/).filter(Boolean);
      const num = (v: string | undefined, scale: number, d: number) => v === undefined ? d : v.endsWith('%') ? parseFloat(v) / 100 * scale : parseFloat(v);
      if (m[1].startsWith('rgb')) c = [num(parts[0], 255, 0), num(parts[1], 255, 0), num(parts[2], 255, 0), num(parts[3], 1, 1)];
      else {
        const hh = ((parseFloat(parts[0]) % 360) + 360) % 360 / 360, ss = num(parts[1], 1, 0), ll = num(parts[2], 1, 0), a = num(parts[3], 1, 1);
        const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss, p = 2 * ll - q;
        const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
        c = [f(hh + 1 / 3) * 255, f(hh) * 255, f(hh - 1 / 3) * 255, a];
      }
    }
  }
  c = [Math.max(0, Math.min(255, c[0])), Math.max(0, Math.min(255, c[1])), Math.max(0, Math.min(255, c[2])), Math.max(0, Math.min(1, isNaN(c[3]) ? 1 : c[3]))];
  if (colorCache.size > 4096) colorCache.clear();
  colorCache.set(key, c);
  return c;
}

class Gradient {
  stops: Stop[] = [];
  constructor(readonly paint: Paint) {}
  addColorStop(o: number, color: string) { this.stops.push({o: Math.max(0, Math.min(1, o)), c: parseColor(color)}); this.stops.sort((a, b) => a.o - b.o); }
}

function sampleStops(stops: Stop[], t: number, out: RGBA) {
  if (!stops.length) { out[0] = out[1] = out[2] = out[3] = 0; return; }
  t = Math.max(0, Math.min(1, t));
  if (t <= stops[0].o) { out[0] = stops[0].c[0]; out[1] = stops[0].c[1]; out[2] = stops[0].c[2]; out[3] = stops[0].c[3]; return; }
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i];
    if (t <= b.o) {
      const a = stops[i - 1], k = b.o > a.o ? (t - a.o) / (b.o - a.o) : 1;
      for (let j = 0; j < 4; j++) out[j] = a.c[j] + (b.c[j] - a.c[j]) * k;
      return;
    }
  }
  const l = stops[stops.length - 1].c; out[0] = l[0]; out[1] = l[1]; out[2] = l[2]; out[3] = l[3];
}

export interface Bitmap { width: number; height: number; data: Uint8ClampedArray }

/** Pixels of anything drawImage accepts. */
function sourcePixels(src: any): Bitmap | null {
  if (!src) return null;
  if (src.__ctx?.bitmap) return src.__ctx.bitmap();
  if (src.__ctx2d?.bitmap) return src.__ctx2d.bitmap();
  if (src.data && src.width && src.height) return src as Bitmap;
  if (src.__pixels) return src.__pixels;
  const bytes: Uint8Array | undefined = src.__bytes ?? (src.__jsgbAsset || src.__src ? readImage(src.__jsgbAsset ?? src.__src) : undefined);
  if (bytes) { const decoded = decodePng(bytes); if (decoded) { try { src.__pixels = decoded; } catch { /* frozen */ } return decoded; } }
  return null;
}
let imageReader: ((path: string) => Uint8Array | undefined) = () => undefined;
export function setImageReader(fn: (path: string) => Uint8Array | undefined) { imageReader = fn; }
/** A run of text as an alpha mask with its metrics, from the host's font rasterizer (text.ts). */
export type TextRun = {width: number; height: number; ascent: number; descent: number; advance: number; alpha: Uint8Array};
let textRasterizer: ((font: string, text: string) => TextRun | null) | null = null;
export function setTextRasterizer(fn: (font: string, text: string) => TextRun | null) { textRasterizer = fn; }
function readImage(path: string) { return imageReader(path); }

interface State {
  fill: Paint; stroke: Paint; fillSrc: unknown; strokeSrc: unknown; alpha: number; lineWidth: number; lineCap: string; lineJoin: string; miterLimit: number;
  m: Matrix; clip: [number, number, number, number] | null; comp: string; smoothing: boolean; font: string; textAlign: string; textBaseline: string;
  shadowBlur: number; shadowColor: string; shadowOffsetX: number; shadowOffsetY: number; filter: string; lineDashOffset: number; dash: number[];
}

export class Context2D {
  private w = 0; private h = 0; private data = new Uint8ClampedArray(0);
  private s: State = Context2D.initial();
  private stack: State[] = [];
  private subpaths: number[][] = [];
  private cur: number[] | null = null;
  private row = new Float32Array(0);
  private covered: Uint8Array | null = null;
  readonly canvas: any;

  constructor(canvas: any) { this.canvas = canvas; this.resize(); }

  static initial(): State {
    const black: Paint = {kind: 'color', c: [0, 0, 0, 1]};
    return {fill: black, stroke: black, fillSrc: '#000000', strokeSrc: '#000000', alpha: 1, lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
      m: [1, 0, 0, 1, 0, 0], clip: null, comp: 'source-over', smoothing: true, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic',
      shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', shadowOffsetX: 0, shadowOffsetY: 0, filter: 'none', lineDashOffset: 0, dash: []};
  }

  /** Matches the canvas element size; called when width or height is assigned (which clears it). */
  resize() {
    const w = Math.max(0, this.canvas?.width | 0), h = Math.max(0, this.canvas?.height | 0);
    this.w = w; this.h = h; this.data = new Uint8ClampedArray(w * h * 4); this.row = new Float32Array(w + 2);
    this.s = Context2D.initial(); this.stack = []; this.subpaths = []; this.cur = null; this.version++;
  }
  version = 0;
  bitmap(): Bitmap { return {width: this.w, height: this.h, data: this.data}; }

  // ---- state
  save() { this.stack.push({...this.s, m: [...this.s.m] as Matrix, dash: [...this.s.dash]}); }
  restore() { const s = this.stack.pop(); if (s) this.s = s; }
  reset() { this.data.fill(0); this.s = Context2D.initial(); this.stack = []; this.beginPath(); this.version++; }
  get fillStyle() { return this.s.fillSrc as string; }
  set fillStyle(v: unknown) { const p = this.paintOf(v); if (p) { this.s.fill = p; this.s.fillSrc = v; } }
  get strokeStyle() { return this.s.strokeSrc as string; }
  set strokeStyle(v: unknown) { const p = this.paintOf(v); if (p) { this.s.stroke = p; this.s.strokeSrc = v; } }
  get globalAlpha() { return this.s.alpha; } set globalAlpha(v: number) { if (Number.isFinite(v) && v >= 0 && v <= 1) this.s.alpha = v; }
  get lineWidth() { return this.s.lineWidth; } set lineWidth(v: number) { if (Number.isFinite(v) && v > 0) this.s.lineWidth = v; }
  get lineCap() { return this.s.lineCap; } set lineCap(v: string) { this.s.lineCap = v; }
  get lineJoin() { return this.s.lineJoin; } set lineJoin(v: string) { this.s.lineJoin = v; }
  get miterLimit() { return this.s.miterLimit; } set miterLimit(v: number) { this.s.miterLimit = v; }
  get globalCompositeOperation() { return this.s.comp; } set globalCompositeOperation(v: string) { this.s.comp = v; }
  get imageSmoothingEnabled() { return this.s.smoothing; } set imageSmoothingEnabled(v: boolean) { this.s.smoothing = !!v; }
  imageSmoothingQuality = 'low';
  get font() { return this.s.font; } set font(v: string) { this.s.font = v; }
  get textAlign() { return this.s.textAlign; } set textAlign(v: string) { this.s.textAlign = v; }
  get textBaseline() { return this.s.textBaseline; } set textBaseline(v: string) { this.s.textBaseline = v; }
  get shadowBlur() { return this.s.shadowBlur; } set shadowBlur(v: number) { this.s.shadowBlur = v; }
  get shadowColor() { return this.s.shadowColor; } set shadowColor(v: string) { this.s.shadowColor = v; }
  get shadowOffsetX() { return this.s.shadowOffsetX; } set shadowOffsetX(v: number) { this.s.shadowOffsetX = v; }
  get shadowOffsetY() { return this.s.shadowOffsetY; } set shadowOffsetY(v: number) { this.s.shadowOffsetY = v; }
  get filter() { return this.s.filter; } set filter(v: string) { this.s.filter = v; }
  get lineDashOffset() { return this.s.lineDashOffset; } set lineDashOffset(v: number) { this.s.lineDashOffset = v; }
  direction = 'ltr'; fontKerning = 'auto'; letterSpacing = '0px'; wordSpacing = '0px'; textRendering = 'auto'; fontStretch = 'normal'; fontVariantCaps = 'normal';
  setLineDash(d: number[]) { this.s.dash = Array.isArray(d) ? d.slice() : []; }
  getLineDash() { return this.s.dash.slice(); }
  getContextAttributes() { return {alpha: true, colorSpace: 'srgb', desynchronized: false, willReadFrequently: false}; }
  isContextLost() { return false; }

  private paintOf(v: unknown): Paint | null {
    if (typeof v === 'string') return {kind: 'color', c: parseColor(v)};
    if (v instanceof Gradient) return {...v.paint, stops: v.stops} as Paint;
    if (v && typeof v === 'object' && (v as {__pattern?: Bitmap}).__pattern) return {kind: 'color', c: averageColor((v as {__pattern: Bitmap}).__pattern)};
    return null;
  }
  createLinearGradient(x0: number, y0: number, x1: number, y1: number) { return new Gradient({kind: 'linear', x0, y0, x1, y1, stops: []}); }
  createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) { return new Gradient({kind: 'radial', x0, y0, r0, x1, y1, r1, stops: []}); }
  createConicGradient() { return new Gradient({kind: 'color', c: [128, 128, 128, 1]} as Paint); }
  createPattern(src: unknown) { const bm = sourcePixels(src); return bm ? {__pattern: bm, setTransform() {}} : null; }

  // ---- transforms
  setTransform(a: number | {a: number; b: number; c: number; d: number; e: number; f: number} = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    if (typeof a === 'object') this.s.m = [a.a, a.b, a.c, a.d, a.e, a.f]; else this.s.m = [a, b, c, d, e, f];
  }
  resetTransform() { this.s.m = [1, 0, 0, 1, 0, 0]; }
  getTransform() { const [a, b, c, d, e, f] = this.s.m; return {a, b, c, d, e, f, m11: a, m12: b, m21: c, m22: d, m41: e, m42: f, is2D: true, isIdentity: a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0, invertSelf() { return this; }, inverse() { return this; }}; }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    const m = this.s.m;
    this.s.m = [m[0] * a + m[2] * b, m[1] * a + m[3] * b, m[0] * c + m[2] * d, m[1] * c + m[3] * d, m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5]];
  }
  translate(x: number, y: number) { this.transform(1, 0, 0, 1, x, y); }
  scale(x: number, y: number) { this.transform(x, 0, 0, y, 0, 0); }
  rotate(r: number) { const c = Math.cos(r), s = Math.sin(r); this.transform(c, s, -s, c, 0, 0); }
  private tx(x: number, y: number): [number, number] { const m = this.s.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; }
  private inverse(): Matrix {
    const [a, b, c, d, e, f] = this.s.m, det = a * d - b * c || 1e-12;
    return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
  }

  // ---- paths (stored in device space)
  beginPath() { this.subpaths = []; this.cur = null; }
  moveTo(x: number, y: number) { const [dx, dy] = this.tx(x, y); this.cur = [dx, dy]; this.subpaths.push(this.cur); }
  lineTo(x: number, y: number) { if (!this.cur) { this.moveTo(x, y); return; } const [dx, dy] = this.tx(x, y); this.cur.push(dx, dy); }
  closePath() { if (this.cur && this.cur.length >= 2) { const x = this.cur[0], y = this.cur[1]; this.cur.push(x, y); (this.cur as number[] & {closed?: boolean}).closed = true; this.cur = [x, y]; this.subpaths.push(this.cur); } }
  private lastUser(): [number, number] {
    if (!this.cur || this.cur.length < 2) return [0, 0];
    const inv = this.inverse(), x = this.cur[this.cur.length - 2], y = this.cur[this.cur.length - 1];
    return [inv[0] * x + inv[2] * y + inv[4], inv[1] * x + inv[3] * y + inv[5]];
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    const [x0, y0] = this.lastUser();
    for (let i = 1; i <= 12; i++) { const t = i / 12, u = 1 - t; this.lineTo(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y); }
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    const [x0, y0] = this.lastUser();
    for (let i = 1; i <= 16; i++) { const t = i / 16, u = 1 - t; this.lineTo(u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y); }
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false) { this.ellipse(x, y, r, r, 0, a0, a1, ccw); }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw = false) {
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep = sweep % (2 * Math.PI) + 2 * Math.PI; else if (ccw && sweep > 0) sweep = sweep % (2 * Math.PI) - 2 * Math.PI;
    if (Math.abs(a1 - a0) >= 2 * Math.PI) sweep = ccw ? -2 * Math.PI : 2 * Math.PI;
    const scale = Math.max(Math.hypot(this.s.m[0], this.s.m[1]), Math.hypot(this.s.m[2], this.s.m[3]));
    const steps = Math.max(8, Math.min(128, Math.ceil(Math.abs(sweep) * Math.max(rx, ry) * scale / 2)));
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let i = 0; i <= steps; i++) {
      const a = a0 + sweep * i / steps, ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
      const px = x + ex * cr - ey * sr, py = y + ex * sr + ey * cr;
      if (i === 0 && this.cur) this.lineTo(px, py); else if (i === 0) this.moveTo(px, py); else this.lineTo(px, py);
    }
  }
  arcTo(x1: number, y1: number, x2: number, y2: number) { this.lineTo(x1, y1); this.lineTo(x2, y2); }
  rect(x: number, y: number, w: number, h: number) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  roundRect(x: number, y: number, w: number, h: number, r: number | number[] = 0) {
    const rr = Math.min(Math.abs(Array.isArray(r) ? r[0] ?? 0 : r), Math.abs(w) / 2, Math.abs(h) / 2);
    if (rr <= 0) { this.rect(x, y, w, h); return; }
    this.moveTo(x + rr, y); this.lineTo(x + w - rr, y); this.arc(x + w - rr, y + rr, rr, -Math.PI / 2, 0); this.lineTo(x + w, y + h - rr);
    this.arc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2); this.lineTo(x + rr, y + h); this.arc(x + rr, y + h - rr, rr, Math.PI / 2, Math.PI);
    this.lineTo(x, y + rr); this.arc(x + rr, y + rr, rr, Math.PI, Math.PI * 1.5); this.closePath();
  }

  // ---- painting
  fill(pathOrRule?: unknown, rule?: string) {
    const evenOdd = (typeof pathOrRule === 'string' ? pathOrRule : rule) === 'evenodd';
    const polys = pathOrRule instanceof Path2DImpl ? pathOrRule.build(this) : this.subpaths;
    this.rasterize(polys.filter(p => p.length >= 6), this.s.fill, evenOdd);
  }
  stroke(path?: unknown) {
    const polys = path instanceof Path2DImpl ? path.build(this) : this.subpaths;
    const scale = Math.sqrt(Math.abs(this.s.m[0] * this.s.m[3] - this.s.m[1] * this.s.m[2])) || 1;
    const hw = Math.max(0.35, this.s.lineWidth * scale / 2);
    const out: number[][] = [];
    for (const p of polys) {
      for (let i = 0; i + 3 < p.length; i += 2) {
        const x0 = p[i], y0 = p[i + 1], x1 = p[i + 2], y1 = p[i + 3];
        const len = Math.hypot(x1 - x0, y1 - y0); if (len < 1e-6) continue;
        const nx = -(y1 - y0) / len * hw, ny = (x1 - x0) / len * hw;
        const ext = this.s.lineCap === 'square' ? hw / len : 0;
        const ex = (x1 - x0) * ext, ey = (y1 - y0) * ext;
        out.push([x0 - ex + nx, y0 - ey + ny, x1 + ex + nx, y1 + ey + ny, x1 + ex - nx, y1 + ey - ny, x0 - ex - nx, y0 - ey - ny]);
        if (i > 0 && this.s.lineJoin !== 'bevel') out.push(circle(x0, y0, hw));
      }
      if (this.s.lineCap === 'round' && p.length >= 4) { out.push(circle(p[0], p[1], hw)); out.push(circle(p[p.length - 2], p[p.length - 1], hw)); }
    }
    // Consistent winding so overlapping pieces union under the nonzero rule.
    for (const q of out) if (signedArea(q) < 0) reversePoly(q);
    this.rasterize(out, this.s.stroke, false);
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const m = this.s.m;
    if (m[1] === 0 && m[2] === 0 && this.s.fill.kind === 'color' && (this.s.comp === 'source-over' || this.s.comp === 'copy')) {
      const [ax, ay] = this.tx(x, y), [bx, by] = this.tx(x + w, y + h);
      this.blendRect(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by), this.s.fill.c);
      return;
    }
    const saved = this.subpaths, cur = this.cur; this.subpaths = []; this.rect(x, y, w, h); this.fill(); this.subpaths = saved; this.cur = cur;
  }
  strokeRect(x: number, y: number, w: number, h: number) { const saved = this.subpaths, cur = this.cur; this.subpaths = []; this.rect(x, y, w, h); this.stroke(); this.subpaths = saved; this.cur = cur; }
  clearRect(x: number, y: number, w: number, h: number) {
    const m = this.s.m;
    if (m[1] === 0 && m[2] === 0) {
      const [ax, ay] = this.tx(x, y), [bx, by] = this.tx(x + w, y + h);
      let x0 = Math.max(0, Math.round(Math.min(ax, bx))), y0 = Math.max(0, Math.round(Math.min(ay, by))), x1 = Math.min(this.w, Math.round(Math.max(ax, bx))), y1 = Math.min(this.h, Math.round(Math.max(ay, by)));
      if (this.s.clip) { x0 = Math.max(x0, Math.ceil(this.s.clip[0])); y0 = Math.max(y0, Math.ceil(this.s.clip[1])); x1 = Math.min(x1, Math.floor(this.s.clip[2])); y1 = Math.min(y1, Math.floor(this.s.clip[3])); }
      if (x0 === 0 && y0 === 0 && x1 === this.w && y1 === this.h) { this.data.fill(0); this.version++; return; }
      for (let yy = y0; yy < y1; yy++) this.data.fill(0, (yy * this.w + x0) * 4, (yy * this.w + x1) * 4);
      this.version++;
      return;
    }
    const comp = this.s.comp; this.s.comp = 'destination-out';
    const fill = this.s.fill; this.s.fill = {kind: 'color', c: [0, 0, 0, 1]};
    const saved = this.subpaths, cur = this.cur; this.subpaths = []; this.rect(x, y, w, h); this.fill(); this.subpaths = saved; this.cur = cur;
    this.s.comp = comp; this.s.fill = fill;
  }
  clip() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.subpaths) for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); y0 = Math.min(y0, p[i + 1]); y1 = Math.max(y1, p[i + 1]); }
    if (!Number.isFinite(x0)) { this.s.clip = [0, 0, 0, 0]; return; }
    const c = this.s.clip;
    this.s.clip = c ? [Math.max(c[0], x0), Math.max(c[1], y0), Math.min(c[2], x1), Math.min(c[3], y1)] : [x0, y0, x1, y1];
  }
  isPointInPath() { return false; }
  isPointInStroke() { return false; }

  // ---- text: glyph coverage from the host's font rasterizer, filled with the current paint.
  measureText(t: string) {
    const run = textRasterizer?.(this.s.font, String(t));
    const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this.s.font)?.[1] ?? '10');
    const width = run ? run.advance : String(t).length * size * 0.56, ascent = run ? run.ascent : size * 0.8, descent = run ? run.descent : size * 0.2;
    return {width, actualBoundingBoxAscent: ascent, actualBoundingBoxDescent: descent, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent,
      emHeightAscent: ascent, emHeightDescent: descent, alphabeticBaseline: 0, hangingBaseline: ascent, ideographicBaseline: -descent};
  }
  fillText(t: string, x: number, y: number, maxWidth?: number) { this.drawText(String(t), x, y, maxWidth, this.s.fill); }
  strokeText(t: string, x: number, y: number, maxWidth?: number) { this.drawText(String(t), x, y, maxWidth, this.s.stroke); }
  private drawText(t: string, x: number, y: number, maxWidth: number | undefined, paint: Paint) {
    const run = textRasterizer?.(this.s.font, t);
    if (!run || !run.width || !this.w || !this.h) return;
    const scaleX = maxWidth !== undefined && maxWidth > 0 && run.advance > maxWidth ? maxWidth / run.advance : 1;
    const align = this.s.textAlign, rtl = this.direction === 'rtl';
    const left = align === 'center' ? x - run.advance * scaleX / 2 : align === 'right' || (align === 'end' && !rtl) || (align === 'start' && rtl) ? x - run.advance * scaleX : x;
    const base = this.s.textBaseline;
    const top = base === 'top' || base === 'hanging' ? y : base === 'middle' ? y - (run.ascent + run.descent) / 2 : base === 'bottom' || base === 'ideographic' ? y - run.ascent - run.descent : y - run.ascent;
    const dw = run.width * scaleX, dh = run.height;
    const corners = [this.tx(left, top), this.tx(left + dw, top), this.tx(left, top + dh), this.tx(left + dw, top + dh)];
    let x0 = Math.floor(Math.min(...corners.map(p => p[0]))), x1 = Math.ceil(Math.max(...corners.map(p => p[0])));
    let y0 = Math.floor(Math.min(...corners.map(p => p[1]))), y1 = Math.ceil(Math.max(...corners.map(p => p[1])));
    [x0, y0, x1, y1] = this.clipBox(x0, y0, x1, y1);
    const inv = this.inverse(), col: RGBA = paint.kind === 'color' ? [...paint.c] as RGBA : [0, 0, 0, 0];
    this.beginCoverage();
    for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) {
      const cx = px + 0.5, cy = py + 0.5;
      const ux = inv[0] * cx + inv[2] * cy + inv[4], uy = inv[1] * cx + inv[3] * cy + inv[5];
      const bx = Math.floor((ux - left) / scaleX), by = Math.floor(uy - top);
      if (bx < 0 || bx >= run.width || by < 0 || by >= run.height) continue;
      const cov = run.alpha[by * run.width + bx] / 255;
      if (cov <= 0) continue;
      if (paint.kind !== 'color') this.paintAt(paint, inv, cx, cy, col);
      this.blendPixel(py * this.w + px, col[0], col[1], col[2], col[3] * cov * this.s.alpha);
    }
    this.endCoverage();
    this.version++;
  }

  // ---- images
  drawImage(src: any, a: number, b: number, c?: number, d?: number, e?: number, f?: number, g?: number, h?: number) {
    const bm = sourcePixels(src); if (!bm || !bm.width || !bm.height) return;
    let sx = 0, sy = 0, sw = bm.width, sh = bm.height, dx: number, dy: number, dw: number, dh: number;
    if (e === undefined) { dx = a; dy = b; dw = c ?? bm.width; dh = d ?? bm.height; } else { sx = a; sy = b; sw = c!; sh = d!; dx = e; dy = f!; dw = g!; dh = h!; }
    if (!dw || !dh || !sw || !sh) return;
    const corners = [this.tx(dx, dy), this.tx(dx + dw, dy), this.tx(dx, dy + dh), this.tx(dx + dw, dy + dh)];
    let x0 = Math.floor(Math.min(...corners.map(p => p[0]))), x1 = Math.ceil(Math.max(...corners.map(p => p[0])));
    let y0 = Math.floor(Math.min(...corners.map(p => p[1]))), y1 = Math.ceil(Math.max(...corners.map(p => p[1])));
    [x0, y0, x1, y1] = this.clipBox(x0, y0, x1, y1);
    const inv = this.inverse(), alpha = this.s.alpha, smooth = this.s.smoothing && (Math.abs(dw) > sw * 1.01 || Math.abs(dh) > sh * 1.01 || this.s.m[1] !== 0);
    const px: RGBA = [0, 0, 0, 0];
    const sd = bm.data, W = bm.width, H = bm.height;
    this.beginCoverage();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const cx = x + 0.5, cy = y + 0.5;
      const ux = inv[0] * cx + inv[2] * cy + inv[4], uy = inv[1] * cx + inv[3] * cy + inv[5];
      const fx = (ux - dx) / dw, fy = (uy - dy) / dh;
      if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) continue;
      const tx = sx + fx * sw, ty = sy + fy * sh;
      if (smooth) {
        const gx = Math.max(0, Math.min(W - 1, tx - 0.5)), gy = Math.max(0, Math.min(H - 1, ty - 0.5)), ix = Math.floor(gx), iy = Math.floor(gy), ax = gx - ix, ay = gy - iy;
        const ix1 = Math.min(W - 1, ix + 1), iy1 = Math.min(H - 1, iy + 1);
        for (let k = 0; k < 4; k++) {
          const v00 = sd[(iy * W + ix) * 4 + k], v10 = sd[(iy * W + ix1) * 4 + k], v01 = sd[(iy1 * W + ix) * 4 + k], v11 = sd[(iy1 * W + ix1) * 4 + k];
          px[k] = (v00 * (1 - ax) + v10 * ax) * (1 - ay) + (v01 * (1 - ax) + v11 * ax) * ay;
        }
      } else {
        const ix = Math.min(W - 1, Math.max(0, Math.floor(tx))), iy = Math.min(H - 1, Math.max(0, Math.floor(ty))), si = (iy * W + ix) * 4;
        px[0] = sd[si]; px[1] = sd[si + 1]; px[2] = sd[si + 2]; px[3] = sd[si + 3];
      }
      this.blendPixel(y * this.w + x, px[0], px[1], px[2], px[3] / 255 * alpha);
    }
    this.endCoverage();
    this.version++;
  }
  createImageData(w: number | {width: number; height: number}, h?: number) {
    const W = typeof w === 'number' ? w : w.width, H = typeof w === 'number' ? h! : w.height;
    return makeImageData(new Uint8ClampedArray(Math.max(0, W * H * 4)), W, H);
  }
  getImageData(x: number, y: number, w: number, h: number) {
    x = Math.floor(x); y = Math.floor(y); w = Math.floor(w); h = Math.floor(h);
    const out = new Uint8ClampedArray(Math.max(0, w * h * 4));
    for (let yy = 0; yy < h; yy++) {
      const sy = y + yy; if (sy < 0 || sy >= this.h) continue;
      const xa = Math.max(0, x), xb = Math.min(this.w, x + w); if (xb <= xa) continue;
      out.set(this.data.subarray((sy * this.w + xa) * 4, (sy * this.w + xb) * 4), (yy * w + (xa - x)) * 4);
    }
    return makeImageData(out, w, h);
  }
  putImageData(img: {data: ArrayLike<number>; width: number; height: number}, dx: number, dy: number, rx = 0, ry = 0, rw = img.width, rh = img.height) {
    dx = Math.floor(dx); dy = Math.floor(dy);
    for (let yy = Math.max(0, ry); yy < Math.min(img.height, ry + rh); yy++) {
      const ty = dy + yy; if (ty < 0 || ty >= this.h) continue;
      for (let xx = Math.max(0, rx); xx < Math.min(img.width, rx + rw); xx++) {
        const txx = dx + xx; if (txx < 0 || txx >= this.w) continue;
        const si = (yy * img.width + xx) * 4, di = (ty * this.w + txx) * 4;
        this.data[di] = img.data[si]; this.data[di + 1] = img.data[si + 1]; this.data[di + 2] = img.data[si + 2]; this.data[di + 3] = img.data[si + 3];
      }
    }
    this.version++;
  }

  // ---- rasterizer
  private clipBox(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
    let a = Math.max(0, x0), b = Math.max(0, y0), c = Math.min(this.w, x1), d = Math.min(this.h, y1);
    const cl = this.s.clip; if (cl) { a = Math.max(a, Math.floor(cl[0])); b = Math.max(b, Math.floor(cl[1])); c = Math.min(c, Math.ceil(cl[2])); d = Math.min(d, Math.ceil(cl[3])); }
    return [a, b, c, d];
  }

  /** destination-in clears everything the source does not cover; track coverage for it. */
  private beginCoverage() { this.covered = this.s.comp === 'destination-in' ? new Uint8Array(this.w * this.h) : null; }
  private endCoverage() {
    if (!this.covered) return;
    for (let i = 0; i < this.covered.length; i++) if (!this.covered[i]) this.data[i * 4 + 3] = 0;
    this.covered = null;
  }

  private blendPixel(i: number, r: number, g: number, b: number, a: number) {
    if (this.covered && a > 0) this.covered[i] = 1;
    const d = this.data, k = i * 4, comp = this.s.comp;
    if (a <= 0 && comp !== 'copy') return;
    const da = d[k + 3] / 255;
    switch (comp) {
      case 'destination-out': d[k + 3] = da * (1 - a) * 255; return;
      case 'destination-in': d[k + 3] = da * a * 255; return;
      case 'copy': d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = a * 255; return;
      case 'lighter': { d[k] = d[k] * da + r * a; d[k + 1] = d[k + 1] * da + g * a; d[k + 2] = d[k + 2] * da + b * a; d[k + 3] = Math.min(1, da + a) * 255; return; }
      case 'destination-over': { const oa = da + a * (1 - da); if (oa <= 0) return; d[k] = (d[k] * da + r * a * (1 - da)) / oa; d[k + 1] = (d[k + 1] * da + g * a * (1 - da)) / oa; d[k + 2] = (d[k + 2] * da + b * a * (1 - da)) / oa; d[k + 3] = oa * 255; return; }
      case 'source-atop': { if (da <= 0) return; d[k] = r * a + d[k] * (1 - a); d[k + 1] = g * a + d[k + 1] * (1 - a); d[k + 2] = b * a + d[k + 2] * (1 - a); return; }
      case 'multiply': { r = r * d[k] / 255; g = g * d[k + 1] / 255; b = b * d[k + 2] / 255; break; }
      case 'screen': { r = 255 - (255 - r) * (255 - d[k]) / 255; g = 255 - (255 - g) * (255 - d[k + 1]) / 255; b = 255 - (255 - b) * (255 - d[k + 2]) / 255; break; }
      default: break;
    }
    if (a >= 1) { d[k] = r; d[k + 1] = g; d[k + 2] = b; d[k + 3] = 255; return; }
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    d[k] = (r * a + d[k] * da * (1 - a)) / oa;
    d[k + 1] = (g * a + d[k + 1] * da * (1 - a)) / oa;
    d[k + 2] = (b * a + d[k + 2] * da * (1 - a)) / oa;
    d[k + 3] = oa * 255;
  }

  private blendRect(x0: number, y0: number, x1: number, y1: number, c: RGBA) {
    let [ix0, iy0, ix1, iy1] = this.clipBox(Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1));
    const a = c[3] * this.s.alpha;
    for (let y = iy0; y < iy1; y++) {
      const cy = Math.min(y + 1, y1) - Math.max(y, y0); if (cy <= 0) continue;
      for (let x = ix0; x < ix1; x++) {
        const cx = Math.min(x + 1, x1) - Math.max(x, x0); if (cx <= 0) continue;
        this.blendPixel(y * this.w + x, c[0], c[1], c[2], a * Math.min(1, cx) * Math.min(1, cy));
      }
    }
    this.version++;
    void ix1; void iy1;
  }

  private rasterize(polys: number[][], paint: Paint, evenOdd: boolean) {
    if (!polys.length || !this.w || !this.h) return;
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity;
    const edges: number[] = []; // x0, y0, x1, y1, dir
    for (const p of polys) {
      const n = p.length;
      for (let i = 0; i < n; i += 2) {
        const x0 = p[i], y0 = p[i + 1], x1 = p[(i + 2) % n], y1 = p[(i + 3) % n];
        minX = Math.min(minX, x0); maxX = Math.max(maxX, x0); minY = Math.min(minY, y0); maxY = Math.max(maxY, y0);
        if (y0 === y1) continue;
        edges.push(x0, y0, x1, y1, y1 > y0 ? 1 : -1);
      }
    }
    let [bx0, by0, bx1, by1] = this.clipBox(Math.floor(minX), Math.floor(minY), Math.ceil(maxX) + 1, Math.ceil(maxY) + 1);
    if (bx1 <= bx0 || by1 <= by0) { if (this.s.comp === 'destination-in') { this.beginCoverage(); this.endCoverage(); } return; }
    const row = this.row, xs: number[] = [], ws: number[] = [];
    const inv = paint.kind === 'color' ? null : this.inverse();
    const col: RGBA = paint.kind === 'color' ? paint.c : [0, 0, 0, 0];
    const SUB = 4;
    this.beginCoverage();
    for (let y = by0; y < by1; y++) {
      row.fill(0, bx0, bx1 + 1);
      let any = false;
      for (let sub = 0; sub < SUB; sub++) {
        const sy = y + (sub + 0.5) / SUB;
        xs.length = 0; ws.length = 0;
        for (let e = 0; e < edges.length; e += 5) {
          const ey0 = edges[e + 1], ey1 = edges[e + 3];
          if ((sy < ey0) === (sy < ey1)) continue;
          const t = (sy - ey0) / (ey1 - ey0);
          xs.push(edges[e] + t * (edges[e + 2] - edges[e])); ws.push(edges[e + 4]);
        }
        if (xs.length < 2) continue;
        const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
        let wind = 0;
        for (let k = 0; k < order.length - 1; k++) {
          wind += evenOdd ? 1 : ws[order[k]];
          const inside = evenOdd ? (wind & 1) === 1 : wind !== 0;
          if (!inside) continue;
          const xa = Math.max(bx0, xs[order[k]]), xb = Math.min(bx1, xs[order[k + 1]]);
          if (xb <= xa) continue;
          any = true;
          const ia = Math.floor(xa), ib = Math.floor(xb);
          if (ia === ib) { row[ia] += (xb - xa) / SUB; continue; }
          row[ia] += (ia + 1 - xa) / SUB;
          for (let x = ia + 1; x < ib; x++) row[x] += 1 / SUB;
          if (ib < bx1) row[ib] += (xb - ib) / SUB;
        }
      }
      if (!any) continue;
      for (let x = bx0; x < bx1; x++) {
        const cov = Math.min(1, row[x]); if (cov <= 0.001) continue;
        if (inv) this.paintAt(paint, inv, x + 0.5, y + 0.5, col);
        this.blendPixel(y * this.w + x, col[0], col[1], col[2], col[3] * cov * this.s.alpha);
      }
    }
    this.endCoverage();
    this.version++;
  }

  private paintAt(p: Paint, inv: Matrix, x: number, y: number, out: RGBA) {
    const ux = inv[0] * x + inv[2] * y + inv[4], uy = inv[1] * x + inv[3] * y + inv[5];
    if (p.kind === 'linear') {
      const dx = p.x1 - p.x0, dy = p.y1 - p.y0, l2 = dx * dx + dy * dy || 1;
      sampleStops(p.stops, ((ux - p.x0) * dx + (uy - p.y0) * dy) / l2, out);
    } else if (p.kind === 'radial') {
      // Concentric approximation (most game gradients share a centre).
      const d = Math.hypot(ux - p.x1, uy - p.y1), span = (p.r1 - p.r0) || 1;
      sampleStops(p.stops, (d - p.r0) / span, out);
    }
  }
}

function circle(x: number, y: number, r: number) { const out: number[] = []; const n = Math.max(8, Math.min(32, Math.ceil(r * 4))); for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push(x + Math.cos(a) * r, y + Math.sin(a) * r); } return out; }
function signedArea(p: number[]) { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a / 2; }
function reversePoly(p: number[]) { const pts: number[][] = []; for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]); pts.reverse(); for (let i = 0; i < pts.length; i++) { p[i * 2] = pts[i][0]; p[i * 2 + 1] = pts[i][1]; } }
function averageColor(b: Bitmap): RGBA { let r = 0, g = 0, bl = 0, a = 0; const n = b.width * b.height || 1; for (let i = 0; i < n; i++) { r += b.data[i * 4]; g += b.data[i * 4 + 1]; bl += b.data[i * 4 + 2]; a += b.data[i * 4 + 3]; } return [r / n, g / n, bl / n, a / n / 255]; }
function makeImageData(data: Uint8ClampedArray, width: number, height: number) {
  const ID = (globalThis as {ImageData?: new (d: Uint8ClampedArray, w: number, h: number) => unknown}).ImageData;
  return ID ? new ID(data, width, height) as {data: Uint8ClampedArray; width: number; height: number} : {data, width, height, colorSpace: 'srgb'};
}

/** Path2D recorded in user space and replayed through the context transform when used. */
export class Path2DImpl {
  __subpaths: number[][] = [];
  private ops: Array<[string, number[]]> = [];
  constructor(src?: Path2DImpl | string) { if (src instanceof Path2DImpl) this.ops = src.ops.slice(); }
  addPath(p: Path2DImpl) { this.ops.push(...p.ops); }
  private rec(name: string, args: number[]) { this.ops.push([name, args]); }
  moveTo(...a: number[]) { this.rec('moveTo', a); } lineTo(...a: number[]) { this.rec('lineTo', a); } closePath() { this.rec('closePath', []); }
  quadraticCurveTo(...a: number[]) { this.rec('quadraticCurveTo', a); } bezierCurveTo(...a: number[]) { this.rec('bezierCurveTo', a); }
  arc(...a: number[]) { this.rec('arc', a); } ellipse(...a: number[]) { this.rec('ellipse', a); } rect(...a: number[]) { this.rec('rect', a); } roundRect(...a: number[]) { this.rec('roundRect', a); } arcTo(...a: number[]) { this.rec('arcTo', a); }
  /** Replays into a context's current transform; returns device-space subpaths. */
  build(ctx: Context2D): number[][] {
    const c = ctx as unknown as Record<string, (...a: number[]) => void> & {subpaths: number[][]};
    const saved = (ctx as unknown as {subpaths: number[][]}).subpaths, savedCur = (ctx as unknown as {cur: unknown}).cur;
    ctx.beginPath(); for (const [n, a] of this.ops) c[n](...a);
    const out = (ctx as unknown as {subpaths: number[][]}).subpaths;
    (ctx as unknown as {subpaths: number[][]}).subpaths = saved; (ctx as unknown as {cur: unknown}).cur = savedCur;
    return out;
  }
}
