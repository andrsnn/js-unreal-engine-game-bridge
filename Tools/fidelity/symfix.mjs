#!/usr/bin/env node
// Applies a hull's symmetry repair (the receipt the game adopted for its runtime LODs) to the full-resolution
// original: the retained half is kept and mirrored across the receipt's plane, preserved details stay original
// (moved by the recorded offset), and the other half is dropped. Triangles, UVs and textures are kept at full
// source quality. Repairs follow the game's tools/owner-symfix-adopt-41.mjs conventions.
//   node Tools/fidelity/symfix.mjs <source.glb> <out.glb> --receipt <receipt.json> --modules <node_modules> [--check <game lod0.glb>]
// A receipt is a sol-xhigh symfix-sol-xhigh.json (frame, selected_side, preserved_regions) or a receipts-high
// <key>.json (axisFrame, retainedHalf).
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const [source, out, ...rest] = process.argv.slice(2);
const flag = name => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : undefined; };
const modules = flag('--modules'), receiptPath = flag('--receipt');
if (!source || !out || !modules || !receiptPath) { console.error('usage: symfix.mjs <source.glb> <out.glb> --receipt <json> --modules <node_modules> [--check lod0.glb]'); process.exit(2); }
const require = createRequire(path.join(modules, 'x.js'));
const {NodeIO} = require('@gltf-transform/core');
const {ALL_EXTENSIONS} = require('@gltf-transform/extensions');
const {MeshoptDecoder} = require('meshoptimizer');

const r = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
// The frame: canonical q = B (R p - center) / scale - origin; canonical x is the distance across the mirror plane.
const frame = r.axisFrame ?? {R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], center: r.frame.origin, scale: 1, B: r.frame.basis, origin: [0, 0, 0]};
const retainedPositive = r.axisFrame ? /positive X/.test(r.retainedHalf) : r.selected_side > 0;
const regions = r.preserved_regions ?? r.preservedRegions ?? [];
const offset = r.preserved_detail_offset ?? r.detailOffset ?? [0, 0, 0];
const length = r.frame?.length ?? r.length ?? 1;
const {R, center, scale, B, origin} = frame;
// A recorded spine curve (sol-xhigh axis_curve_normalized: [lateral, along] points in length-normalized canonical
// coordinates): the hull's centre line bends sideways, so it is straightened before the reflection.
const curve = (r.axis_curve_normalized ?? []).slice().sort((a, b) => a[1] - b[1]);
const alongAxis = +(process.env.JSGB_CURVE_AXIS ?? 1);  // the second value runs along canonical Y (checked against the game's repaired hulls)
const spine = along => {
  if (!curve.length) return 0;
  if (along <= curve[0][1]) return curve[0][0];
  for (let i = 1; i < curve.length; i++) if (along <= curve[i][1]) { const [x0, z0] = curve[i - 1], [x1, z1] = curve[i]; return x0 + (x1 - x0) * (along - z0) / (z1 - z0); }
  return curve[curve.length - 1][0];
};
const mv = (M, x, y, z) => [M[0][0] * x + M[0][1] * y + M[0][2] * z, M[1][0] * x + M[1][1] * y + M[1][2] * z, M[2][0] * x + M[2][1] * y + M[2][2] * z];
const mtv = (M, x, y, z) => [M[0][0] * x + M[1][0] * y + M[2][0] * z, M[0][1] * x + M[1][1] * y + M[2][1] * z, M[0][2] * x + M[1][2] * y + M[2][2] * z];
const toRaw = (x, y, z) => { const a = mv(R, x, y, z); return mv(B, (a[0] - center[0]) / scale - origin[0], (a[1] - center[1]) / scale - origin[1], (a[2] - center[2]) / scale - origin[2]); };
const to = (x, y, z) => { const q = toRaw(x, y, z); if (curve.length) q[0] -= spine(q[alongAxis] / length) * length; return q; };
const from = q => { const b = mtv(B, q[0], q[1], q[2]); return mtv(R, (b[0] + origin[0]) * scale + center[0], (b[1] + origin[1]) * scale + center[1], (b[2] + origin[2]) * scale + center[2]); };
const mirrorDir = (x, y, z) => { const q = mv(B, ...mv(R, x, y, z)); q[0] = -q[0]; return mtv(R, ...mtv(B, q[0], q[1], q[2])); };
const preserved = q => regions.some(g => ['x', 'y', 'z'].every((axis, i) => (g[axis + '_min'] == null || q[i] / length >= g[axis + '_min']) && (g[axis + '_max'] == null || q[i] / length <= g[axis + '_max'])));
const retained = qx => retainedPositive ? qx >= -1e-6 : qx <= 1e-6;

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
const doc = await io.read(source);
const stats = {before: 0, after: 0, preserved: 0, mirrored: 0, dropped: 0};
for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
  const P = prim.getAttribute('POSITION'), N = prim.getAttribute('NORMAL'), I = prim.getIndices();
  const pos = P.getArray(), nrm = N?.getArray(), count = P.getCount();
  const idx = I ? I.getArray() : Uint32Array.from({length: count}, (_, i) => i);
  // Three copies of the vertices: as they are (retained body), moved (preserved details) and mirrored.
  const used = new Uint8Array(count * 3);
  const tris = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const q = to((pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3, (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3, (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3);
    stats.before++;
    if (preserved(q)) { tris.push(count + a, count + b, count + c); stats.preserved++; continue; }
    if (!retained(q[0])) { stats.dropped++; continue; }
    tris.push(a, b, c, 2 * count + a, 2 * count + c, 2 * count + b);  // the mirror copy winds the other way
    stats.mirrored++;
  }
  for (const v of tris) used[v] = 1;
  const remap = new Int32Array(count * 3).fill(-1);
  let n = 0;
  for (let v = 0; v < count * 3; v++) if (used[v]) remap[v] = n++;
  const outIdx = new Uint32Array(tris.length);
  for (let i = 0; i < tris.length; i++) outIdx[i] = remap[tris[i]];
  const vertexOf = (v, k) => v < count ? 0 : v < 2 * count ? 1 : 2;
  for (const semantic of prim.listSemantics()) {
    const attr = prim.getAttribute(semantic), arr = attr.getArray(), size = attr.getElementSize();
    const res = new (arr.constructor)(n * size);
    for (let v = 0; v < count * 3; v++) {
      const o = remap[v]; if (o < 0) continue;
      const src = v % count, copy = vertexOf(v);
      for (let k = 0; k < size; k++) res[o * size + k] = arr[src * size + k];
      if (semantic === 'POSITION' && copy) {
        const q = to(arr[src * 3], arr[src * 3 + 1], arr[src * 3 + 2]);
        if (copy === 1) for (let k = 0; k < 3; k++) q[k] += offset[k] * length; else q[0] = -q[0];
        const p = from(q); res[o * 3] = p[0]; res[o * 3 + 1] = p[1]; res[o * 3 + 2] = p[2];
      } else if ((semantic === 'NORMAL' || semantic === 'TANGENT') && copy === 2) {
        const d = mirrorDir(arr[src * size], arr[src * size + 1], arr[src * size + 2]);
        const l = Math.hypot(...d) || 1;
        res[o * size] = d[0] / l; res[o * size + 1] = d[1] / l; res[o * size + 2] = d[2] / l;
        if (semantic === 'TANGENT') res[o * size + 3] = -arr[src * size + 3];
      }
    }
    attr.setArray(res);
  }
  if (I) I.setArray(outIdx); else prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(outIdx).setBuffer(P.getBuffer()));
  stats.after += outIdx.length / 3;
}
fs.mkdirSync(path.dirname(out), {recursive: true});
await io.write(out, doc);
// Against the game's repaired runtime LOD: both come from the same plane, so their bounds should agree.
let check = '';
const lod = flag('--check');
if (lod && fs.existsSync(lod)) {
  const bounds = d => { const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (const m of d.getRoot().listMeshes()) for (const p of m.listPrimitives()) { const a = p.getAttribute('POSITION'), e = [0, 0, 0]; for (let i = 0; i < a.getCount(); i++) { a.getElement(i, e); for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], e[k]); mx[k] = Math.max(mx[k], e[k]); } } } return [mn, mx]; };
  const [a, b] = [bounds(doc), bounds(await io.read(lod))];
  const size = Math.max(...b[1].map((v, i) => v - b[0][i]));
  check = Math.max(...[0, 1].flatMap(j => [0, 1, 2].map(k => Math.abs(a[j][k] - b[j][k])))) / size;
}
console.log(JSON.stringify({source, out, receipt: receiptPath, retained: retainedPositive ? 'positive X' : 'negative X', preservedRegions: regions.length, ...stats, boundsDifferenceVsGameLod: check === '' ? null : +check.toFixed(4)}));
