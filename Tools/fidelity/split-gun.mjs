#!/usr/bin/env node
// Splits a gun's Pixal3D original into the parts of the game's copy (base, yaw, pitch), one glb per part, so each part
// can be its own override and turns, elevates and recoils with the game's part.
// Hard Burn makes its copy with tools/blender/gun-runtime.py: the original turned so the muzzle points along +Z with +Y up,
// moved so the origin is the centre of the mounting ring (turrets) or the middle of the barrel line (spinal guns), and
// reduced to 24,000 triangles. This puts the original in the same frame: the turn from the copy's report (<copy>.json,
// measuredForwardSourceAxes), the origin measured the same way. Each original triangle goes to the game part whose surface
// is nearest its centre (three-mesh-bvh), and each part is written in the frame of that part's game mesh, so an override
// with fit "none" lines up with it. The original's uvs, materials and textures stay as they are.
//   node Tools/fidelity/split-gun.mjs <original.glb> <game copy.glb> <out dir> --modules <node_modules with @gltf-transform, three, three-mesh-bvh>
// Writes <out>/<part>.glb and <out>/split.json: per part the game's mesh names, the pivot (the part node's place in the
// gun's frame), the triangles, and the bounds of the original's part and of the game's part (gun frame); and how far the
// game copy's surface lies from the original's, over the copy's diagonal (gap).
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const [original, copy, outDir, ...rest] = process.argv.slice(2);
const modulesAt = rest.indexOf('--modules');
const modules = modulesAt >= 0 ? rest[modulesAt + 1] : process.env.JSGB_GLTF_MODULES;
if (!original || !copy || !outDir || !modules) { console.error('usage: split-gun.mjs <original.glb> <game copy.glb> <out dir> --modules <node_modules>'); process.exit(2); }
const require = createRequire(path.join(modules, 'x.js'));
process.noDeprecation = true;
const {NodeIO} = require('@gltf-transform/core');
const {ALL_EXTENSIONS} = require('@gltf-transform/extensions');
const THREE = require('three');
const {MeshBVH} = require('three-mesh-bvh');

const report = JSON.parse(fs.readFileSync(copy.replace(/\.glb$/, '.json'), 'utf8'));
const kind = report.kind;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [source, game] = [await io.read(original), await io.read(copy)];
const meshNodes = doc => doc.getRoot().listNodes().filter(n => n.getMesh());
const box = () => new THREE.Box3();
const boxOut = b => [b.min.toArray().map(v => +v.toFixed(4)), b.max.toArray().map(v => +v.toFixed(4))];

// The game's parts: a mesh under "pitch" is the barrels' part, under "yaw" the turret's, and anything else the base's.
const partOf = node => { for (let n = node; n; n = n.getParentNode()) { if (n.getName() === 'pitch') return 'pitch'; if (n.getName() === 'yaw') return 'yaw'; } return 'base'; };
const nodeByName = name => game.getRoot().listNodes().find(n => n.getName() === name);
const parts = new Map();
for (const node of meshNodes(game)) {
  const name = partOf(node), world = new THREE.Matrix4().fromArray(node.getWorldMatrix());
  if (!parts.has(name)) parts.set(name, {name, meshes: [], positions: [], bounds: box(), vertices: 0, frame: world});
  const part = parts.get(name);
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), idx = prim.getIndices(), v = new THREE.Vector3(), p = [0, 0, 0];
    const corners = [];
    for (let i = 0; i < pos.getCount(); i++) { pos.getElement(i, p); corners.push(v.fromArray(p).applyMatrix4(world).clone()); part.bounds.expandByPoint(corners[i]); }
    const n = idx ? idx.getCount() : pos.getCount();
    for (let i = 0; i < n; i++) part.positions.push(...corners[idx ? idx.getScalar(i) : i].toArray());
    // The part's frame is its largest mesh's, the one the override draws in place of.
    if (pos.getCount() > part.vertices) { part.vertices = pos.getCount(); part.frame = world; part.mesh = node.getName(); }
  }
  part.meshes.push(node.getName());
}
for (const part of parts.values()) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
  part.bvh = new MeshBVH(g);
  const pivot = nodeByName(part.name);
  part.pivot = pivot ? new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(pivot.getWorldMatrix())).toArray().map(v => +v.toFixed(4)) : [0, 0, 0];
}

// The original in the game's frame. Blender reads glTF (x, y, z) as (x, -z, y), so its forward (fx, fy, fz) is glTF
// (fx, fz, -fy); the copy turns it onto +Z by the shortest arc.
const [fx, fy, fz] = report.measuredForwardSourceAxes;
const turn = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(fx, fz, -fy).normalize(), new THREE.Vector3(0, 0, 1)));
const prims = [];
for (const node of meshNodes(source)) {
  const m = new THREE.Matrix4().multiplyMatrices(turn, new THREE.Matrix4().fromArray(node.getWorldMatrix()));
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(m);
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), nrm = prim.getAttribute('NORMAL');
    const a = Float32Array.from(pos.getArray()), v = new THREE.Vector3();
    for (let i = 0; i < a.length; i += 3) v.fromArray(a, i).applyMatrix4(m).toArray(a, i);
    if (nrm) { const b = Float32Array.from(nrm.getArray()); for (let i = 0; i < b.length; i += 3) v.fromArray(b, i).applyMatrix3(normalMatrix).normalize().toArray(b, i); nrm.setArray(b); }
    pos.setArray(a);
    prims.push(prim);
  }
  node.setMatrix(new THREE.Matrix4().toArray());
}
for (const node of source.getRoot().listNodes()) if (!node.getMesh()) node.setMatrix(new THREE.Matrix4().toArray());
// The origin, as the copy measured it: every n-th vertex (about 200,000 of them); the centre of the lowest tenth's
// footprint at the bottom (turrets), or the centre of the bounds (spinal guns).
const all = prims.map(p => p.getAttribute('POSITION').getArray());
const total = all.reduce((s, a) => s + a.length / 3, 0), stride = Math.max(1, Math.floor(total / 200000));
const sample = [];
let k = 0;
for (const a of all) for (let i = 0; i < a.length; i += 3, k++) if (k % stride === 0) sample.push([a[i], a[i + 1], a[i + 2]]);
const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
for (const p of sample) for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], p[i]); mx[i] = Math.max(mx[i], p[i]); }
let origin;
if (kind === 'spinal') origin = mn.map((v, i) => (v + mx[i]) / 2);
else {
  const low = sample.filter(p => p[1] < mn[1] + (mx[1] - mn[1]) * .1);
  origin = [low.reduce((s, p) => s + p[0], 0) / low.length, mn[1], low.reduce((s, p) => s + p[2], 0) / low.length];
}
for (const a of all) for (let i = 0; i < a.length; i += 3) { a[i] -= origin[0]; a[i + 1] -= origin[1]; a[i + 2] -= origin[2]; }

// Triangles of the original, as corner indices per primitive, and the whole original as one BVH for the fit check.
if (prims.some(prim => !prim.getIndices())) throw Error('the original has a primitive without indices');
const tris = prims.map(prim => Uint32Array.from(prim.getIndices().getArray()));
const whole = new THREE.BufferGeometry(), joined = [];
prims.forEach((prim, j) => { const a = all[j]; for (const i of tris[j]) joined.push(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]); });
whole.setAttribute('position', new THREE.Float32BufferAttribute(joined, 3));
const wholeBvh = new MeshBVH(whole);
const hit = {point: new THREE.Vector3(), distance: 0, faceIndex: 0}, q = new THREE.Vector3();
const gameBounds = box(); for (const part of parts.values()) gameBounds.union(part.bounds);
const diagonal = gameBounds.getSize(new THREE.Vector3()).length();
const gaps = [];
for (const part of parts.values()) for (let i = 0; i < part.positions.length; i += 3 * Math.max(1, Math.floor(part.positions.length / 3 / 20000))) {
  wholeBvh.closestPointToPoint(q.fromArray(part.positions, i), hit); gaps.push(hit.distance / diagonal);
}
gaps.sort((a, b) => a - b);

// Each triangle to the nearest part.
const names = [...parts.keys()];
const owner = tris.map(t => new Uint8Array(t.length / 3));
if (names.length > 1) prims.forEach((prim, j) => {
  const a = all[j], t = tris[j];
  for (let f = 0; f < t.length / 3; f++) {
    q.set(0, 0, 0);
    for (let c = 0; c < 3; c++) { const i = t[f * 3 + c] * 3; q.x += a[i] / 3; q.y += a[i + 1] / 3; q.z += a[i + 2] / 3; }
    let best = 0, bestD = Infinity;
    names.forEach((name, n) => { if (parts.get(name).bvh.closestPointToPoint(q, hit) && hit.distance < bestD) { bestD = hit.distance; best = n; } });
    owner[j][f] = best;
  }
});

// One glb per part: only its triangles and the vertices they use, in the frame of the part's game mesh.
fs.mkdirSync(outDir, {recursive: true});
const kept = prims.map(prim => Object.fromEntries(prim.listSemantics().map(s => [s, prim.getAttribute(s).getArray()])));
const result = {original: path.resolve(original).replaceAll('\\', '/'), copy: path.resolve(copy).replaceAll('\\', '/'), kind, origin: origin.map(v => +v.toFixed(5)),
  gap: {mean: +(gaps.reduce((s, g) => s + g, 0) / gaps.length).toFixed(5), p95: +gaps[Math.floor(gaps.length * .95)].toFixed(5)},
  bounds: {original: boxOut(new THREE.Box3().setFromBufferAttribute(whole.attributes.position)), game: boxOut(gameBounds)}, parts: {}};
for (const [n, name] of names.entries()) {
  const part = parts.get(name), toLocal = part.frame.clone().invert(), toLocalNormal = new THREE.Matrix3().getNormalMatrix(toLocal);
  const bounds = box(), v = new THREE.Vector3();
  let triangles = 0;
  prims.forEach((prim, j) => {
    const t = tris[j], remap = new Int32Array(prim.getAttribute('POSITION').getCount()).fill(-1), order = [], index = [];
    for (let f = 0; f < t.length / 3; f++) if (owner[j][f] === n) for (let c = 0; c < 3; c++) {
      const i = t[f * 3 + c]; if (remap[i] < 0) { remap[i] = order.length; order.push(i); } index.push(remap[i]);
    }
    triangles += index.length / 3;
    for (const [semantic, array] of Object.entries(kept[j])) {
      const size = prim.getAttribute(semantic).getElementSize(), out = new array.constructor(order.length * size);
      order.forEach((i, o) => { for (let e = 0; e < size; e++) out[o * size + e] = array[i * size + e]; });
      if (semantic === 'POSITION') for (let o = 0; o < out.length; o += 3) { v.fromArray(out, o); bounds.expandByPoint(v); v.applyMatrix4(toLocal).toArray(out, o); }
      if (semantic === 'NORMAL') for (let o = 0; o < out.length; o += 3) v.fromArray(out, o).applyMatrix3(toLocalNormal).normalize().toArray(out, o);
      prim.getAttribute(semantic).setArray(out);
    }
    prim.getIndices().setArray(Uint32Array.from(index));
  });
  if (!triangles) continue;
  // Written under a temporary name and renamed when complete, so a stopped run leaves no half-written part.
  const file = path.join(outDir, name + '.glb');
  await io.write(file.replace(/\.glb$/, '.part.glb'), source); fs.renameSync(file.replace(/\.glb$/, '.part.glb'), file);
  result.parts[name] = {file: path.resolve(file).replaceAll('\\', '/'), mesh: part.mesh, meshes: part.meshes, pivot: part.pivot, triangles,
    bounds: boxOut(bounds), gameBounds: boxOut(part.bounds)};
}
fs.writeFileSync(path.join(outDir, 'split.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));
