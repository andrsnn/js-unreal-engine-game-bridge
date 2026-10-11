#!/usr/bin/env node
// For a hull whose symmetry repair can't be replayed from its receipt (hand edits described only in words): the
// game's own repaired geometry (its lod0, which keeps the source's UVs) with the original Pixal3D textures.
//   node Tools/fidelity/retexture.mjs <game lod0.glb> <original.glb> <out.glb> --modules <node_modules>
import path from 'node:path';
import {createRequire} from 'node:module';
const [lod0, original, out, , modules] = process.argv.slice(2);
const require = createRequire(path.join(modules, 'x.js'));
const {NodeIO} = require('@gltf-transform/core');
const {ALL_EXTENSIONS} = require('@gltf-transform/extensions');
const {MeshoptDecoder} = require('meshoptimizer');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
const game = await io.read(lod0), src = await io.read(original);
const sm = src.getRoot().listMaterials()[0];
const copy = t => t && game.createTexture().setImage(t.getImage()).setMimeType(t.getMimeType());
const base = copy(sm.getBaseColorTexture()), mr = copy(sm.getMetallicRoughnessTexture());
for (const m of game.getRoot().listMaterials()) { m.setBaseColorTexture(base); m.setMetallicRoughnessTexture(mr); m.setNormalTexture(null); }
for (const t of game.getRoot().listTextures()) if (t !== base && t !== mr) t.dispose();
for (const e of game.getRoot().listExtensionsUsed()) if (/basisu|meshopt/i.test(e.extensionName)) e.dispose();
await io.write(out, game);
let tris = 0; for (const m of game.getRoot().listMeshes()) for (const p of m.listPrimitives()) tris += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
console.log(JSON.stringify({out, triangles: tris}));
