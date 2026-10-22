import {test} from 'node:test';
import assert from 'node:assert/strict';
const sent = [], saved = new Map();
const worker = {onmessage: null, onerror: null, postMessage: m => sent.push(m), terminate() {}};
globalThis.__jsgbHost = {
  readFile() {throw Error('a live shader must never load the compiler on the game thread');},
  backgroundWorker: () => worker,
  storage: {load: k => saved.get(k), save: (k, v) => saved.set(k, v)}, log() {},
};
const {encode} = await import('../../Runtime/src/clone.ts');
const {translateShaderMaterial, newShaderFrame, modernSamplerParameters} = await import('../../Runtime/src/shaders.ts');

test('texture helper parameters carry the texture, sampler and image orientation through nested calls', () => {
  const text = modernSamplerParameters('float4 lookup(sampler2D image, float2 uv) { return tex2D(image, uv); }\nfloat4 outer(sampler2D inputMap, float2 uv) { return lookup(inputMap, uv); }\nvoid frag_main() { float4 c = outer(map, float2(0, 1)); }');
  assert.match(text, /lookup\(Texture2D image, SamplerState imageSampler, float image_jsgbFlipY, float2 uv\)/);
  assert.match(text, /lookup\(inputMap, inputMapSampler, inputMap_jsgbFlipY, uv\)/);
  assert.match(text, /outer\(map, mapSampler, map_jsgbFlipY, float2\(0, 1\)\)/);
  assert.doesNotMatch(text, /sampler2D/);
});
test('a cache miss uses fallback while one background translation runs, then persists and swaps', () => {
  const material = {name: 'test surface', vertexShader: 'void main(){gl_Position=vec4(position,1.0);}', fragmentShader: 'void main(){gl_FragColor=vec4(1.0);}', defines: {}};
  assert.equal(translateShaderMaterial(material, {color: false, extras: [{name: 'width', size: 1, offset: 0, attr: new (class GeometryAttribute {})()}]}), undefined);
  assert.ok(encode(sent.at(-1)), 'worker requests contain metadata, never geometry class instances');
  newShaderFrame();
  assert.equal(translateShaderMaterial(material), undefined);
  assert.equal(sent.length, 1, 'requests for the same pending shader coalesce');
  const result = {key: sent[0].key, hlsl: 'ready', inputs: [], vertexHlsl: '', vertexInputs: []};
  worker.onmessage({data: {key: sent[0].key, result, ms: 450}});
  assert.equal(translateShaderMaterial(material), result);
  assert.equal(sent.length, 1);
  assert.equal(saved.size, 1);
  assert.equal(JSON.parse([...saved.values()][0]).hlsl, 'ready');
  assert.equal(globalThis.__jsgbShaderStats.completed, 1);
  assert.equal(globalThis.__jsgbShaderStats.pending, 0);
});
test('packaging includes an off-camera material in native coverage as well as the translation store', () => {
  const bodies = [], materials = [];
  globalThis.__jsgbHost.sink = {shader: (key, text) => bodies.push(JSON.parse(text)), material: (id, text) => materials.push(JSON.parse(text))};
  const material = {vertexShader: 'void main(){gl_Position=vec4(position,3.0);}', fragmentShader: 'void main(){gl_FragColor=vec4(0.2);}',
    defines: {}, blending: 2, transparent: true, side: 2};
  assert.equal(translateShaderMaterial(material), undefined);
  const key = sent.at(-1).key;
  worker.onmessage({data: {key, result: {key, hlsl: 'ready', inputs: [], vertexHlsl: '', vertexInputs: []}, ms: 450}});
  globalThis.__jsgbPackagingMaterials = new Set([material]);
  assert.deepEqual(globalThis.__jsgbPrepareMaterials(), {pending: [], failed: []});
  assert.equal(bodies.length, 1);
  assert.equal(materials.length, 1);
  assert.equal(materials[0].custom, bodies[0].key);
  assert.equal(materials[0].blending, 2);
  assert.equal(materials[0].transparent, true);
  assert.equal(materials[0].side, 2);
  globalThis.__jsgbPrepareMaterials();
  assert.equal(materials.length, 1, 'rechecking coverage does not add another native material');
  delete globalThis.__jsgbPackagingMaterials;
});

test('a background compiler error keeps the fallback and never calls a synchronous compiler', () => {
  const material = {vertexShader: 'void main(){gl_Position=vec4(position,2.0);}', fragmentShader: 'void main(){gl_FragColor=vec4(0.0);}', defines: {}};
  assert.equal(translateShaderMaterial(material), undefined);
  worker.onerror({message: 'test worker stopped'});
  assert.equal(translateShaderMaterial(material), null);
  assert.equal(globalThis.__jsgbShaderStats.pending, 0);
});
