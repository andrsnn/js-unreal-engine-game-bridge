// Hard Burn's blast fragments (scene/blast-pool.js "ballistic-blast-metal") and sprite sheets (scene/sprite-vfx.js):
// a MeshStandardMaterial patched in onBeforeCompile that reads a per-instance attribute and adds a hot glow to
// totalEmissiveRadiance, and flipbook textures shipped as WebP, which Unreal cannot decode.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {loadRuntime, moduleThreeUrl} from './load-runtime.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const wasm = fs.readFileSync(path.join(root, 'Runtime/vendor/cross-shader/CrossShader.wasm'));
// The shader compiler's Emscripten loader takes its Node path here and wants these.
globalThis.__dirname ??= path.join(root, 'Runtime/vendor/cross-shader');
globalThis.require ??= createRequire(import.meta.url);
const THREE = await import(moduleThreeUrl);
const logs = [];
const host = {log: (level, text) => logs.push(`${level} ${text}`), registry: '', storage: null,
  readFile: p => p.endsWith('CrossShader.wasm') ? wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) : null};
const shaders = await loadRuntime('shaders.ts', host, moduleThreeUrl);

/** blast-pool.js: dark plating whose per-instance debrisState is [heat, opacity]. */
function shardMaterial() {
  const m = new THREE.MeshStandardMaterial({color: 0x2f2a27, roughness: .82, metalness: .5, transparent: true});
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 debrisState;varying vec2 vDebris;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvDebris=debrisState;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vDebris;').replace('#include <alphatest_fragment>', 'diffuseColor.a*=vDebris.y;\n#include <alphatest_fragment>')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=mix(vec3(.35,.05,.01),vec3(1.2,.75,.42),vDebris.x*vDebris.x)*vDebris.x*vDebris.x;');
  };
  return m;
}
/** The shader sources the hook produces from three's own, as sceneExport.ts hookShader runs it. */
function hooked(m) {
  const lib = THREE.ShaderLib.standard;
  const shader = {uniforms: THREE.UniformsUtils.clone(lib.uniforms), vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, defines: {}};
  m.onBeforeCompile(shader);
  return shader;
}
async function translate(m, shader, instancing) {
  for (let i = 0; i < 400; i++) {
    const t = shaders.translateHookedMaterial(m, shader, 'test', instancing);
    if (t !== undefined) return t;
    await new Promise(r => setTimeout(r, 25));
  }
  throw Error('the shader compiler did not load');
}

test('the emitted-light lines of a patched fragment shader are its emissivemap chunk and the lines the hook added there', () => {
  const lines = shaders.emissiveLines(hooked(shardMaterial()).fragmentShader).split('\n').map(l => l.trim());
  assert.deepEqual(lines, ['#include <emissivemap_fragment>', 'totalEmissiveRadiance+=mix(vec3(.35,.05,.01),vec3(1.2,.75,.42),vDebris.x*vDebris.x)*vDebris.x*vDebris.x;']);
  assert.equal(shaders.emissiveLines(THREE.ShaderLib.standard.fragmentShader), '');
});

test('a patched material on an InstancedMesh reads its per-instance attribute from instance data and sends its glow as JsgbEmissive', async () => {
  const m = shardMaterial();
  const t = await translate(m, hooked(m), {color: false, extras: [{name: 'debrisState', size: 2, offset: 0}]});
  assert.ok(t, logs.join('\n'));
  assert.equal(t.lit, true);
  assert.equal(t.emissiveOutput, true);
  // Its fragment stage takes the instance's model matrix from the vertex shader (Unreal's pixel shaders only have the component's).
  assert.equal(t.instanced, true);
  // Instance colour takes custom data 0-2, so the attribute's two floats are 3 and 4, not a UV channel.
  assert.deepEqual(t.inputs.filter(i => i.name.startsWith('JsgbI_')).map(i => [i.name, i.source, i.index]), [['JsgbI_debrisState0', 'instanceData', 3], ['JsgbI_debrisState1', 'instanceData', 4]]);
  assert.ok(!t.inputs.some(i => i.source === 'uv' && i.index > 0));
  assert.match(t.hlsl, /totalEmissiveRadiance \+= .*vDebris\.x/);
  assert.match(t.hlsl, /jsgb_Emissive = totalEmissiveRadiance;/);
  assert.match(t.hlsl, /JsgbEmissive = fs\.jsgb_Emissive;\s*return fs\.jsgb_FragColor;/);
});

test('a patched material that leaves emitted light alone has no emissive output', async () => {
  const m = new THREE.MeshStandardMaterial({color: 0x808080});
  m.onBeforeCompile = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', 'diffuseColor.rgb*=.5;\n#include <alphatest_fragment>'); };
  const t = await translate(m, hooked(m));
  assert.ok(t, logs.join('\n'));
  assert.equal(t.emissiveOutput, undefined);
  assert.equal(t.instanced, undefined);
  assert.doesNotMatch(t.hlsl, /JsgbEmissive/);
});

test('a WebP texture loads the PNG copy the build wrote, and stays a WebP path with a warning when there is none', async () => {
  const files = new Set(['/jsgb/webp/textures/vfx/sprites/detonation-fireball.png']);
  const warnings = [];
  const exportHost = {log: (level, text) => { if (level === 'warn') warnings.push(text); }, registry: '', readFile: p => files.has(p) ? new ArrayBuffer(8) : null};
  const scene = await loadRuntime('sceneExport.ts', exportHost, moduleThreeUrl);
  assert.equal(scene.unrealImagePath('/textures/vfx/sprites/detonation-fireball.webp'), '/jsgb/webp/textures/vfx/sprites/detonation-fireball.png');
  assert.equal(scene.unrealImagePath('/textures/vfx/tracer.png'), '/textures/vfx/tracer.png');
  assert.equal(warnings.length, 0);
  assert.equal(scene.unrealImagePath('/textures/vfx/sprites/vent-gas.webp'), '/textures/vfx/sprites/vent-gas.webp');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /vent-gas\.webp.*\/jsgb\/webp\/textures\/vfx\/sprites\/vent-gas\.png/);
});

test('a patched material with alphaHash can use vPosition and getAlphaHashThreshold for its own dithered discard', async () => {
  const m = new THREE.MeshStandardMaterial({color: 0x808080, alphaHash: true});
  m.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 hullCoverage;varying vec2 vHullCoverage;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvHullCoverage=hullCoverage;vPosition=position*2.;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vHullCoverage;').replace('#include <alphahash_fragment>', 'if(getAlphaHashThreshold(vPosition)>=vHullCoverage.y)discard;');
  };
  const t = await translate(m, hooked(m), {color: false, extras: [{name: 'hullCoverage', size: 2, offset: 0}]});
  assert.ok(t, logs.join('\n'));
  assert.match(t.hlsl, /getAlphaHashThreshold/);
});

/** A camera-facing quad placed from instanceMatrix, as scene/sprite-vfx.js and the streak and drive pools draw them. */
function billboard() {
  return new THREE.ShaderMaterial({transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute vec4 sprite;varying vec2 q;varying float fade;void main(){q=uv;fade=sprite.y;vec4 centre=modelViewMatrix*instanceMatrix*vec4(0.,0.,0.,1.);float size=length(instanceMatrix[0].xyz);centre.xy+=position.xy*size;centre.z=min(centre.z+size*.45,-.05);gl_Position=projectionMatrix*centre;}',
    fragmentShader: 'varying vec2 q;varying float fade;void main(){if(fade<.003)discard;gl_FragColor=vec4(q,0.,fade);}'});
}
async function translateShader(m, instanced) {
  for (let i = 0; i < 400; i++) {
    const t = shaders.translateShaderMaterial(m, instanced);
    if (t !== undefined) return t;
    await new Promise(r => setTimeout(r, 25));
  }
  throw Error('the shader compiler did not load');
}

test('an instanced camera-facing quad is pulled toward the camera by JsgbDepthPull radii, so a sprite on a hull draws over it', async () => {
  const t = await translateShader(billboard(), {color: false, extras: [{name: 'sprite', size: 4, offset: 0}]});
  assert.ok(t, logs.join('\n'));
  assert.equal(t.depthPull, true);
  assert.ok(t.vertexInputs.some(i => i.name === 'U_JsgbDepthPull' && i.source === 'scalar' && i.param === 'JsgbDepthPull'));
  // Along each vertex's own view ray (its screen position stays), by the scalar times half the instance's X scale.
  assert.match(t.vertexHlsl, /float jsgbPull = U_JsgbDepthPull \* 0\.5 \* length\(JsgbMX\);/);
  assert.match(t.vertexHlsl, /jsgbV \*= max\(1\.0 - jsgbPull \/ max\(length\(jsgbV\), 1e-6\), 0\.05\);/);
  assert.ok(t.vertexHlsl.indexOf('jsgbPull') < t.vertexHlsl.indexOf('float3 jsgbT'));
  // The same quad on a plain Mesh has no instance to measure and is left where it is.
  const plain = await translateShader(billboard());
  assert.ok(plain);
  assert.equal(plain.depthPull, undefined);
  assert.doesNotMatch(plain.vertexHlsl, /jsgbPull/);
});
