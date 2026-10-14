// node decode-web.mjs <game model.glb> <out.glb> [--modules <node_modules>]: a game's web model (meshopt compressed,
// quantized, KTX2 textures) as a plain GLB Blender can open: same triangles, positions, normals and UVs, no textures.
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [source, out, ...rest] = process.argv.slice(2);
const modules = rest.includes('--modules') ? rest[rest.indexOf('--modules') + 1] : 'C:/Users/Aidan Anderson/falling-frontier-clone/node_modules';
const load = name => import(pathToFileURL(path.join(modules, name)).href);
const {NodeIO} = await load('@gltf-transform/core/dist/index.js');
const {ALL_EXTENSIONS} = await load('@gltf-transform/extensions/dist/index.js');
const {dequantize} = await load('@gltf-transform/functions/dist/index.js');
const {MeshoptDecoder} = await load('meshoptimizer/meshopt_decoder.mjs');
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder': MeshoptDecoder});
const doc = await io.read(source);
await doc.transform(dequantize());
for (const texture of doc.getRoot().listTextures()) texture.dispose();
for (const extension of doc.getRoot().listExtensionsUsed()) if (/meshopt|basisu|quantization/.test(extension.extensionName)) extension.dispose();
let triangles = 0;
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) triangles += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
await io.write(out, doc);
console.log(`${path.basename(source)}: ${triangles} triangles -> ${out}`);
