#!/usr/bin/env node
// Checks that each override hull lines up with the model the game draws: the repaired source, placed the way the
// runtime places it (fit: bounds onto the game model's largest mesh), against the game's own lod0, from three axis
// views. Reports silhouette overlap (intersection over union) and the largest bounds difference, and writes an
// overlay image per hull (white both, red game only, green override only).
//   node Tools/fidelity/check-hulls.mjs <sources.json> <overrides.json> --out <dir> [--only a,b] [--min-iou 0.93] [--max-bounds 0.03]
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [listFile, rulesFile, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const out = flag('--out'), only = flag('--only')?.split(','), minIou = +flag('--min-iou', 0.93), maxBounds = +flag('--max-bounds', 0.03);
const list = JSON.parse(fs.readFileSync(listFile, 'utf8'));
const rules = new Map(JSON.parse(fs.readFileSync(rulesFile, 'utf8')).overrides.map(r => [r.name, r]));
const require = createRequire(path.join(list.modules, 'x.js'));
const {NodeIO} = require('@gltf-transform/core');
const {ALL_EXTENSIONS} = require('@gltf-transform/extensions');
const {MeshoptDecoder} = require('meshoptimizer');
const sharp = require('sharp');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
fs.mkdirSync(out, {recursive: true});

// Every primitive's world-space triangles, and the local bounds of the largest mesh (what the runtime fits to).
async function load(file) {
  const doc = await io.read(file), tris = [];
  let largest = null, most = -1;
  const mul = (m, p) => [0, 1, 2].map(i => m[i] * p[0] + m[4 + i] * p[1] + m[8 + i] * p[2] + m[12 + i]);
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh(); if (!mesh) continue;
    const world = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION'), idx = prim.getIndices()?.getArray(), n = pos.getCount(), e = [0, 0, 0];
      const pts = new Float32Array(n * 3), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < n; i++) { pos.getElement(i, e); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], e[k]); hi[k] = Math.max(hi[k], e[k]); } const w = mul(world, e); pts.set(w, i * 3); }
      if (n > most) { most = n; largest = {lo, hi, world}; }
      tris.push({pts, idx: idx ?? Uint32Array.from({length: n}, (_, i) => i)});
    }
  }
  return {tris, largest};
}
function dilate(img, size = 256) {
  const o = new Uint8Array(img.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (img[y * size + x]) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < size && xx >= 0 && xx < size) o[yy * size + xx] = 1; }
  return o;
}
function boundsOf(tris) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const {pts} of tris) for (let i = 0; i < pts.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], pts[i + k]); hi[k] = Math.max(hi[k], pts[i + k]); }
  return [lo, hi];
}
// Filled-triangle silhouette along one axis, in a square window around both models.
function raster(tris, axis, win, size) {
  const [a, b] = [[1, 2], [0, 2], [0, 1]][axis], img = new Uint8Array(size * size);
  const sx = v => (v - win.lo[a]) / win.span * (size - 1), sy = v => (v - win.lo[b]) / win.span * (size - 1);
  for (const {pts, idx} of tris) for (let t = 0; t < idx.length; t += 3) {
    const p = [idx[t], idx[t + 1], idx[t + 2]].map(i => [sx(pts[i * 3 + a]), sy(pts[i * 3 + b])]);
    const minX = Math.max(0, Math.floor(Math.min(p[0][0], p[1][0], p[2][0]))), maxX = Math.min(size - 1, Math.ceil(Math.max(p[0][0], p[1][0], p[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(p[0][1], p[1][1], p[2][1]))), maxY = Math.min(size - 1, Math.ceil(Math.max(p[0][1], p[1][1], p[2][1])));
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    if (maxX - minX <= 1 && maxY - minY <= 1) { for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) img[y * size + x] = 1; continue; }
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = (p[1][0] - x) * (p[2][1] - y) - (p[2][0] - x) * (p[1][1] - y), w1 = (p[2][0] - x) * (p[0][1] - y) - (p[0][0] - x) * (p[2][1] - y), w2 = (p[0][0] - x) * (p[1][1] - y) - (p[1][0] - x) * (p[0][1] - y);
      if ((w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0)) img[y * size + x] = 1;
    }
  }
  return img;
}

const sources = list.sources.filter(s => !s.kind && s.check && (!only || only.includes(s.name)));
const report = [];
for (const s of sources) {
  let input = s.source, temp = null;
  if (s.geometryFrom) input = s.geometryFrom;
  else if (s.receipt) { temp = path.join(out, s.name + '.tmp.glb'); execFileSync(process.execPath, [path.join(bridge, 'Tools/fidelity/symfix.mjs'), s.source, temp, '--receipt', s.receipt, '--modules', list.modules], {stdio: 'ignore'}); input = temp; }
  const game = await load(s.check), ours = await load(input);
  if (temp) fs.rmSync(temp, {force: true});
  // Two placements: the runtime's bounds fit (the rule's source bounds onto the game mesh's local bounds, centres
  // meeting and largest sides matching), and none (the source's own frame, which the game's models keep).
  // The rule's recorded source bounds, or the repaired source's own when the hull has no rule yet.
  const [lo, hi] = rules.get(s.name)?.bounds ?? boundsOf(ours.tris), g = game.largest;
  const sc = Math.max(...g.hi.map((v, i) => v - g.lo[i])) / Math.max(...hi.map((v, i) => v - lo[i]));
  const place = fitted => ours.tris.map(t => {
    const pts = new Float32Array(t.pts.length);
    for (let i = 0; i < t.pts.length; i += 3) {
      const p = [t.pts[i], t.pts[i + 1], t.pts[i + 2]], q = fitted ? p.map((v, k) => (g.lo[k] + g.hi[k]) / 2 + (v - (lo[k] + hi[k]) / 2) * sc) : p;
      pts.set([0, 1, 2].map(k => g.world[k] * q[0] + g.world[4 + k] * q[1] + g.world[8 + k] * q[2] + g.world[12 + k]), i);
    }
    return {pts, idx: t.idx};
  });
  const bg = boundsOf(game.tris), size = Math.max(...bg[1].map((v, i) => v - bg[0][i])), px = 256;
  const measure = tris => {
    const bo = boundsOf(tris), boundsDiff = Math.max(...[0, 1].flatMap(j => [0, 1, 2].map(k => Math.abs(bg[j][k] - bo[j][k])))) / size;
    const lowAll = [0, 1, 2].map(k => Math.min(bg[0][k], bo[0][k])), span = Math.max(...[0, 1, 2].map(k => Math.max(bg[1][k], bo[1][k]) - lowAll[k])) * 1.02;
    const win = {lo: lowAll, span}, ious = [], sheet = Buffer.alloc(px * 3 * px * 3);
    for (let axis = 0; axis < 3; axis++) {
      // One pixel of tolerance: a thin antenna or rail the game trimmed doesn't count as a misplaced hull.
      const A = dilate(raster(game.tris, axis, win, px)), B = raster(tris, axis, win, px), A0 = raster(game.tris, axis, win, px), B1 = dilate(B);
      let inter = 0, union = 0;
      for (let i = 0; i < A.length; i++) {
        const inA = A0[i], inB = B[i], hitA = inA && B1[i], hitB = inB && A[i];
        inter += (hitA || hitB) ? 1 : 0; union += (inA || inB) ? 1 : 0;
        const o = ((px - 1 - Math.floor(i / px)) * px * 3 + axis * px + (i % px)) * 3; sheet[o] = inA ? 255 : 0; sheet[o + 1] = inB ? 255 : 0; sheet[o + 2] = inA && inB ? 255 : 0;
      }
      ious.push(union ? inter / union : 0);
    }
    return {ious, boundsDiff, sheet};
  };
  const fitted = measure(place(true)), own = measure(place(false));
  const best = Math.min(...own.ious) >= Math.min(...fitted.ious) - 0.002 ? {...own, fit: 'none'} : {...fitted, fit: 'bounds'};
  const {ious, boundsDiff, sheet} = best;
  const iou = Math.min(...ious), pass = iou >= minIou && boundsDiff <= maxBounds;
  await sharp(sheet, {raw: {width: px * 3, height: px, channels: 3}}).png().toFile(path.join(out, `${s.name}.png`));
  report.push({name: s.name, pass, fit: best.fit, iou: +iou.toFixed(3), ious: ious.map(v => +v.toFixed(3)), boundsDifference: +boundsDiff.toFixed(4),
    boundsFitIou: +Math.min(...fitted.ious).toFixed(3), ownFrameIou: +Math.min(...own.ious).toFixed(3), repaired: !!s.receipt});
  console.log(`${pass ? 'PASS' : 'FAIL'} ${s.name}: fit ${best.fit}, silhouette overlap ${ious.map(v => v.toFixed(3)).join(' / ')}, bounds ${(boundsDiff * 100).toFixed(2)}% (bounds fit ${Math.min(...fitted.ious).toFixed(3)}, own frame ${Math.min(...own.ious).toFixed(3)})${s.receipt ? ', repaired' : ''}`);
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
console.log(`${report.filter(r => r.pass).length} of ${report.length} pass`);
