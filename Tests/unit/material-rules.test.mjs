// Material rules match the material a glTF file loaded with, after the game swapped in its own, and hand its maps on.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three-real';
import {gltfLoaded} from '../../Runtime/src/overrides.ts';
import {materialRules, compileMaterialRules, materialHits, ruleTextures} from '../../Runtime/src/materialRules.ts';

const registry = JSON.stringify({materials: [
  {name: 'head', match: {map: 'G9Feminine03_Head_D_*'}, material: '/Game/Lifesim/MI_Head'},
  {name: 'hair', match: {material: 'Hair_*'}, material: '/Game/Lifesim/M_Cutout', textures: {Map: 'map', NormalMap: 'normalMap'}, scalars: {Cutoff: 0.3}},
  {name: 'moisture', match: {material: 'EyeMoisture*'}, hide: true},
  {name: 'broken'},
]});

test('rules see the loaded material through a game material swap and a shared-attribute copy', () => {
  const map = new THREE.Texture(); map.name = 'G9Feminine03_Head_D_1001';
  const hairMap = new THREE.Texture(), hairNormal = new THREE.Texture();
  const face = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({name: 'Skin_Face', map}));
  const hair = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({name: 'Hair_toulouse_Strands', map: hairMap, normalMap: hairNormal}));
  const wet = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({name: 'EyeMoisture'}));
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({name: 'Top_Lace'}));
  const scene = new THREE.Group(); scene.add(face, hair, wet, cloth);
  gltfLoaded({scene}, '/characters/daz/amala/lod0.glb');
  // The game replaces every material (a node material keeps no maps) and gives the body its own index buffer.
  for (const m of [face, hair, wet, cloth]) m.material = new THREE.MeshPhysicalMaterial({name: m.material.name});
  const shared = new THREE.BufferGeometry(); shared.setAttribute('position', face.geometry.attributes.position); shared.setIndex([0, 1, 2]);
  face.geometry = shared;
  const rules = materialRules(registry);
  assert.equal(rules.length, 3, 'a rule with neither material nor hide is dropped');
  assert.equal(materialHits(face, rules)[0].rule.name, 'head');
  const h = materialHits(hair, rules)[0];
  assert.equal(h.rule.material, '/Game/Lifesim/M_Cutout');
  assert.deepEqual(ruleTextures(h), {Map: hairMap, NormalMap: hairNormal});
  assert.equal(materialHits(wet, rules)[0].rule.hide, true);
  assert.equal(materialHits(cloth, rules)[0], null);
});

test('alpha matches cut-out and blended loaded materials only', () => {
  const lace = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({name: 'Top_Lace', alphaTest: 0.5}));
  const top = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({name: 'Top_Top'}));
  const scene = new THREE.Group(); scene.add(lace, top);
  gltfLoaded({scene}, '/characters/daz/kat/lod0.glb');
  const rules = compileMaterialRules([
    {name: 'cutout', match: {url: '*/kat/*', alpha: true}, material: '/Game/M_Cutout'},
    {name: 'opaque', match: {url: '*/kat/*', alpha: false}, material: '/Game/M_Pbr'}]);
  assert.equal(materialHits(lace, rules)[0].rule.name, 'cutout');
  assert.equal(materialHits(top, rules)[0].rule.name, 'opaque');
});

test('no rules, no work', () => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  assert.equal(materialHits(m, []), null);
});
