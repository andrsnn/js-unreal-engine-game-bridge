// Skeletal swaps: skinned glTF primitives group per glTF mesh, and the joint data is three's own skinning transform.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three-real';
import {gltfLoaded} from '../../Runtime/src/overrides.ts';
import {compileSkeletalRules, skeletalGroup, jointData, skeletonInfo, hideMask, HIDE_MASK_SIZE} from '../../Runtime/src/skeletal.ts';

function skinnedPrimitive(name, bones) {
  const g = new THREE.BoxGeometry(0.2, 1, 0.2);
  const n = g.attributes.position.count;
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array.from({length: n * 4}, (_, i) => i % 4 === 0 ? 1 : 0), 4));
  const m = new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial({name}));
  m.morphTargetDictionary = {smile: 0, blink: 1}; m.morphTargetInfluences = [0.25, 0];
  m.bind(new THREE.Skeleton(bones));
  return m;
}

function resident() {
  const root = new THREE.Bone(); root.name = 'hip';
  const arm = new THREE.Bone(); arm.name = 'l_upperarm'; arm.position.set(0.2, 0.5, 0); root.add(arm);
  const scene = new THREE.Group(); scene.add(root);
  const group = new THREE.Group(); scene.add(group);
  const face = skinnedPrimitive('Skin_Face', [root, arm]), body = skinnedPrimitive('Skin_Body', [root, arm]);
  group.add(face, body);
  scene.updateMatrixWorld(true);
  // As GLTFLoader does: inverse bind matrices from the posed bones, then bind at the mesh's place.
  for (const m of [face, body]) { m.skeleton.calculateInverses(); m.bind(m.skeleton, m.matrixWorld); }
  const associations = new Map([[face, {meshes: 0, primitives: 1}], [body, {meshes: 0, primitives: 0}]]);
  gltfLoaded({scene, parser: {json: {meshes: [{name: 'Amala_for_Genesis_9.lod0'}]}, associations}}, '/characters/daz/amala/lod0.glb');
  return {scene, root, arm, face, body};
}

const rules = compileSkeletalRules({
  'skel:amala:body': {skeletal: '/Game/SK_amala_body', match: {url: '*/daz/amala/lod*.glb', gltfMesh: 'Amala_for_Genesis_9.lod*'}},
  'not-skeletal': {mesh: '/Game/Static'},
});

test('primitives of one glTF mesh form one group led by the first primitive', () => {
  const {face, body} = resident();
  assert.equal(rules.length, 1);
  const g = skeletalGroup(face, rules);
  assert.equal(g.key, 'skel:amala:body');
  assert.deepEqual(g.members, [body, face]);
  assert.equal(skeletalGroup(body, rules), g);
  const info = skeletonInfo(g);
  assert.deepEqual(info.bones, ['hip', 'l_upperarm']);
  assert.deepEqual(info.morphs, ['smile', 'blink']);
  assert.deepEqual(info.slots, ['Skin_Body', 'Skin_Face']);
});

test('joint data: bind positions, identity at the bind pose, and the bone motion after it', () => {
  const {scene, arm, body} = resident();
  const read = () => { const out = []; jointData(body, v => out.push(v)); return out; };
  let d = read();
  assert.deepEqual(d.slice(0, 6).map(v => +v.toFixed(6)), [0, 0, 0, 0.2, 0.5, 0]);
  const identity = new THREE.Matrix4().elements;
  for (let j = 0; j < 2; j++) d.slice(6 + 16 * j, 22 + 16 * j).forEach((v, k) => assert.ok(Math.abs(v - identity[k]) < 1e-6));
  arm.position.y += 0.1; scene.updateMatrixWorld(true);
  d = read();
  const armJoint = d.slice(22, 38);
  assert.ok(Math.abs(armJoint[13] - 0.1) < 1e-6, 'the arm joint moved up 0.1');
  assert.ok(Math.abs(d[6 + 13]) < 1e-9, 'the hip joint stayed');
});

test('a skinned mesh no asset names stays an ordinary mesh', () => {
  const {body} = resident();
  assert.equal(skeletalGroup(body, compileSkeletalRules({})), null);
});

test('hide mask: hidden triangles are white, and no pixel a kept triangle touches is (not even next to a hidden one)', () => {
  // Two UV islands side by side: a hidden quad (u 0.3..0.5) and a kept quad right next to it (u 0.5..0.7), as when
  // the covered torso is packed beside the shoulders in the UV layout.
  const g = new THREE.BufferGeometry();
  const P = [0.3, 0.3, 0.5, 0.3, 0.5, 0.6, 0.3, 0.6, 0.5, 0.3, 0.7, 0.3, 0.7, 0.6, 0.5, 0.6];
  g.setAttribute('position', new THREE.Float32BufferAttribute(Array.from({length: 8}, (_, i) => [P[i * 2], P[i * 2 + 1], 0]).flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(P, 2));
  const full = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  g.setIndex(full); g.userData.fullIndex = g.index.clone();
  g.setIndex(full.slice(6));  // the first quad is hidden
  const tex = hideMask(new THREE.SkinnedMesh(g, new THREE.MeshStandardMaterial()));
  assert.ok(tex);
  const N = HIDE_MASK_SIZE, at = (u, v) => tex.image.data[(Math.floor(v * N) * N + Math.floor(u * N)) * 4];
  assert.equal(at(0.4, 0.45), 255, 'inside the hidden quad');
  let bleed = 0;
  for (let y = Math.floor(0.3 * N); y < Math.ceil(0.6 * N); y++) for (let x = Math.floor(0.5 * N); x < Math.ceil(0.7 * N); x++) bleed += tex.image.data[(y * N + x) * 4] ? 1 : 0;
  assert.equal(bleed, 0, 'pixels of the kept quad clipped');
});
