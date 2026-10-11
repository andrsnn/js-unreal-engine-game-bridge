#!/usr/bin/env node
// Prepares a glTF source for Unreal import: writes its textures as PNG files and a copy of the model
// without textures, and prints the model's bounds in its own units. Unreal's glTF importer can't read
// WebP textures, and the bridge builds its own materials from the PNGs.
//   node Tools/fidelity/prepare-glb.mjs <source.glb> <out-dir> <name> [--modules <node_modules dir>]
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

const [source, outDir, name, ...rest] = process.argv.slice(2);
const modulesAt = rest.indexOf('--modules');
const modules = modulesAt >= 0 ? rest[modulesAt + 1] : process.env.JSGB_GLTF_MODULES;
if (!source || !outDir || !name || !modules) { console.error('usage: prepare-glb.mjs <source.glb> <out-dir> <name> --modules <node_modules with @gltf-transform and sharp>'); process.exit(2); }
const require = createRequire(path.join(modules, 'x.js'));
const {NodeIO} = require('@gltf-transform/core');
const {ALL_EXTENSIONS} = require('@gltf-transform/extensions');
const sharp = require('sharp');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(source);
const root = doc.getRoot();
fs.mkdirSync(outDir, {recursive: true});
const textures = {};
for (const material of root.listMaterials()) {
  const slots = {baseColor: material.getBaseColorTexture(), metallicRoughness: material.getMetallicRoughnessTexture(), normal: material.getNormalTexture(), emissive: material.getEmissiveTexture(), occlusion: material.getOcclusionTexture()};
  for (const [slot, tex] of Object.entries(slots)) {
    if (!tex || textures[slot]) continue;
    const file = path.join(outDir, `T_${name}_${slot}.png`);
    const meta = await sharp(Buffer.from(tex.getImage())).png({compressionLevel: 3}).toFile(file);
    textures[slot] = {file, width: meta.width, height: meta.height};
  }
  for (const set of ['setBaseColorTexture', 'setMetallicRoughnessTexture', 'setNormalTexture', 'setEmissiveTexture', 'setOcclusionTexture']) material[set](null);
}
for (const tex of root.listTextures()) tex.dispose();
for (const ext of root.listExtensionsUsed()) if (/webp|basisu|texture/i.test(ext.extensionName)) ext.dispose();
// Bounds of every mesh primitive in the scene's own units (nodes' transforms applied).
const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
let triangles = 0;
const walk = (node, parent) => {
  const local = node.getMatrix(), world = parent ? mul(parent, local) : local;
  const mesh = node.getMesh();
  if (mesh) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION'); if (!pos) continue;
    const p = [0, 0, 0];
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p);
      for (let a = 0; a < 3; a++) { const v = world[a] * p[0] + world[4 + a] * p[1] + world[8 + a] * p[2] + world[12 + a]; if (v < min[a]) min[a] = v; if (v > max[a]) max[a] = v; }
    }
    triangles += (prim.getIndices()?.getCount() ?? pos.getCount()) / 3;
  }
  for (const child of node.listChildren()) walk(child, world);
};
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; }
for (const scene of root.listScenes()) for (const node of scene.listChildren()) walk(node, null);
const glb = path.join(outDir, `${name}.glb`);
await io.write(glb, doc);
const info = {name, source: path.resolve(source), glb, textures, bounds: [min, max], triangles};
fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(info, null, 1));
console.log(JSON.stringify(info));
