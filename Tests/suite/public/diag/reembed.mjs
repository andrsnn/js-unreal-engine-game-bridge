// Puts prepare-glb's PNG textures back on its texture-less glTF, so the browser can show what Unreal imports.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire('C:/Users/Aidan Anderson/falling-frontier-clone/node_modules/x.js');
const {NodeIO} = require('@gltf-transform/core');
const io = new NodeIO();
const doc = await io.read('C:/JsgbFidelityBuild/diag/prep/diag_frigate.glb');
const m = doc.getRoot().listMaterials()[0];
const tex = f => doc.createTexture().setImage(fs.readFileSync(f)).setMimeType('image/png');
m.setBaseColorTexture(tex('C:/JsgbFidelityBuild/diag/prep/T_diag_frigate_baseColor.png'));
m.setMetallicRoughnessTexture(tex('C:/JsgbFidelityBuild/diag/prep/T_diag_frigate_metallicRoughness.png'));
await io.write('C:/JsgbFidelityBuild/diag/png.glb', doc);
console.log('ok');
