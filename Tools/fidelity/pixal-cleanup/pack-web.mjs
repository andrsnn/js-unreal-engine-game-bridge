// node pack-web.mjs <folder> [--modules <node_modules>]: every lodN-plain.glb in the folder written as lodN.glb with its
// geometry quantized and meshopt compressed (the form the games' web loaders read). Textures stay as they are (PNG): the
// game's own asset step turns them into KTX2. Prints each file's triangles and size.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const [folder, ...rest] = process.argv.slice(2);
const modules = rest.includes('--modules') ? rest[rest.indexOf('--modules') + 1] : 'C:/Users/Aidan Anderson/falling-frontier-clone/node_modules';
const load = name => import(pathToFileURL(path.join(modules, name)).href);
const {NodeIO} = await load('@gltf-transform/core/dist/index.js');
const {ALL_EXTENSIONS} = await load('@gltf-transform/extensions/dist/index.js');
const {meshopt, dedup, prune} = await load('@gltf-transform/functions/dist/index.js');
const {MeshoptEncoder} = await load('meshoptimizer/meshopt_encoder.js');
const {MeshoptDecoder} = await load('meshoptimizer/meshopt_decoder.mjs');
await MeshoptEncoder.ready; await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder});
const sizes = {};
for (const file of fs.readdirSync(folder).filter(f => /^lod\d+-plain\.glb$/.test(f)).sort()) {
  const doc = await io.read(path.join(folder, file));
  await doc.transform(dedup(), prune(), meshopt({encoder: MeshoptEncoder, level: 'medium'}));
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) triangles += (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3;
  const out = path.join(folder, file.replace('-plain', ''));
  await io.write(out, doc);
  // Read it back: a file the loader can't open is no use.
  const back = await io.read(out);
  sizes[path.basename(out)] = {triangles, megabytes: +(fs.statSync(out).size / 1048576).toFixed(2), plainMegabytes: +(fs.statSync(path.join(folder, file)).size / 1048576).toFixed(2), meshes: back.getRoot().listMeshes().length};
  console.log(`${path.basename(out)}: ${triangles} triangles, ${sizes[path.basename(out)].megabytes} MB (plain ${sizes[path.basename(out)].plainMegabytes} MB)`);
}
const reportFile = path.join(folder, 'report.json');
if (fs.existsSync(reportFile)) { const r = JSON.parse(fs.readFileSync(reportFile, 'utf8')); r.files = sizes; fs.writeFileSync(reportFile, JSON.stringify(r, null, 1)); }
