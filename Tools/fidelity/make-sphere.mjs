#!/usr/bin/env node
// Writes a unit sphere as glTF with three.js SphereGeometry's vertex layout and UVs, dense enough for a planet
// filling the screen. v is flipped for glTF (an image's first row at v = 0), so a texture lands where three puts it.
//   node Tools/fidelity/make-sphere.mjs <out.glb> --modules <node_modules with three and @gltf-transform> [--segments 512]
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const [out, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const modules = flag('--modules');
if (!out || !modules) { console.error('usage: make-sphere.mjs <out.glb> --modules <node_modules> [--segments 512]'); process.exit(2); }
const require = createRequire(path.join(modules, 'x.js'));
const THREE = await import(pathToFileURL(path.join(modules, 'three/build/three.module.js')).href);
const {Document, NodeIO} = require('@gltf-transform/core');

const segments = +flag('--segments', 512);
const g = new THREE.SphereGeometry(1, segments, segments / 2);
const uv = g.attributes.uv.array.slice();
for (let i = 1; i < uv.length; i += 2) uv[i] = 1 - uv[i];
const doc = new Document(), buffer = doc.createBuffer();
const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
const prim = doc.createPrimitive()
  .setAttribute('POSITION', accessor('VEC3', new Float32Array(g.attributes.position.array)))
  .setAttribute('NORMAL', accessor('VEC3', new Float32Array(g.attributes.normal.array)))
  .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(uv)))
  .setIndices(accessor('SCALAR', new Uint32Array(g.index.array)))
  .setMaterial(doc.createMaterial('planet'));
doc.createScene().addChild(doc.createNode('sphere').setMesh(doc.createMesh('sphere').addPrimitive(prim)));
await new NodeIO().write(out, doc);
console.log(`wrote ${out}: ${g.attributes.position.count} vertices, ${g.index.count / 3} triangles`);
