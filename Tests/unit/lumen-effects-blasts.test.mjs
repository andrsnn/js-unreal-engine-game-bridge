// The explosions and debris lights Lumen mode adds (Runtime/src/lumenEffects.ts): the game's fireball sprites and hot
// blast fragments are instances in Hard Burn's pools (scene/sprite-vfx.js, scene/blast-pool.js), not objects of their
// own, so the lights read the pools' instance buffers.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {THREE, loadRuntime} from './load-runtime.mjs';

const fx = await loadRuntime('lumenEffects.ts', {log() {}, registry: ''});
const ALL_OFF = {engineLight: false, gunfire: false, trails: false, smoke: false, explosions: false, debris: false, bigMuzzle: false};
const camera = new THREE.PerspectiveCamera();
const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);
const nearVector = (v, x, y, z) => { near(v.x, x); near(v.y, y); near(v.z, z); };

function frame(on, objects, scene = new THREE.Scene()) {
  fx.beginEffects({...ALL_OFF, ...on}, camera, scene);
  for (const o of objects) { o.updateWorldMatrix(true, false); fx.noteEffect(o); }
  const lights = [];
  fx.effectLights(l => lights.push(l));
  return lights;
}

/** The fireball sheet of sprite-vfx.js: per instance a size, a position, a tint and [frame, fade, rotation, 0]. */
function fireballs(list) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const state = new THREE.InstancedBufferAttribute(new Float32Array(192 * 4), 4);
  geometry.setAttribute('sprite', state);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 192);
  mesh.name = 'sprite-vfx-fireball';
  mesh.setColorAt(0, new THREE.Color());
  list.forEach(({at, size, frame, fade = 1, tint = 1}, i) => {
    mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(size, size, 1).setPosition(...at));
    mesh.setColorAt(i, new THREE.Color().setRGB(tint, tint, tint));
    state.setXYZW(i, frame, fade, 0, 0);
  });
  mesh.count = list.length;
  return mesh;
}

/** The blast fragments of blast-pool.js: per instance a transform and [heat, opacity]. */
function shards(list) {
  const geometry = new THREE.DodecahedronGeometry(1, 0);
  const state = new THREE.InstancedBufferAttribute(new Float32Array(2048 * 2), 2);
  geometry.setAttribute('debrisState', state);
  const mesh = new THREE.InstancedMesh(geometry, new THREE.MeshStandardMaterial(), 2048);
  mesh.name = 'ballistic-blast-metal';
  list.forEach(({at, size, heat, opacity = 1}, i) => {
    mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(size, size * .3, size * .5).setPosition(...at));
    state.setXY(i, heat, opacity);
  });
  mesh.count = list.length;
  return mesh;
}

test('a fireball lights orange at its sprite, following the glow of its flipbook frame, its fade and tint', () => {
  const peak = frame({explosions: true}, [fireballs([{at: [1, 2, 3], size: 2, frame: 4}])]);
  assert.equal(peak.length, 1);
  nearVector(peak[0].at, 1, 2, 3);
  near(peak[0].intensity, 6 * 2 * 2);
  near(peak[0].distance, 10);
  const c = peak[0].color;
  near(c.r, 1); near(c.g, .72); near(c.b, .38);
  // Early in the flipbook the core is still small, and from frame 9 the sprite is dark smoke.
  near(frame({explosions: true}, [fireballs([{at: [0, 0, 0], size: 2, frame: 1}])])[0].intensity, 24 * .171);
  near(frame({explosions: true}, [fireballs([{at: [0, 0, 0], size: 2, frame: 3.5}])])[0].intensity, 24 * (.936 + 1) / 2);
  assert.equal(frame({explosions: true}, [fireballs([{at: [0, 0, 0], size: 2, frame: 10}])]).length, 0);
  near(frame({explosions: true}, [fireballs([{at: [0, 0, 0], size: 2, frame: 4, fade: .5, tint: .95}])])[0].intensity, 24 * .5 * .95);
  // A fireball only lights with explosions on.
  assert.equal(frame({debris: true, gunfire: true}, [fireballs([{at: [0, 0, 0], size: 2, frame: 4}])]).length, 0);
});

test('a torpedo blast lights both of its chained fireballs, each on its own clock', () => {
  // The second fireball starts 0.2 s after the first (blast-pool.js): at this moment the first is at its peak and
  // the second is just starting.
  const lights = frame({explosions: true}, [fireballs([{at: [0, 0, 0], size: 1.05, frame: 4}, {at: [.35, .15, -.25], size: .75, frame: 1}])]);
  assert.equal(lights.length, 2);
  assert.ok(lights[0].intensity > lights[1].intensity * 10);
});

test('only the 12 brightest fireballs get a light', () => {
  // All 50 from the camera, so only their size ranks them.
  const list = Array.from({length: 20}, (_, i) => ({at: [50 * Math.cos(i), 0, 50 * Math.sin(i)], size: 1 + i * .1, frame: 4}));
  const lights = frame({explosions: true}, [fireballs(list)]);
  assert.equal(lights.length, 12);
  const sizes = lights.map(l => Math.sqrt(l.intensity / 6));
  assert.ok(Math.min(...sizes) > 1.75, 'the smallest eight are left out');
});

test('a hot fragment lights in its emissive colour and fades out as it cools', () => {
  const hot = frame({debris: true}, [shards([{at: [4, 0, 0], size: .05, heat: 1}])]);
  assert.equal(hot.length, 1);
  nearVector(hot[0].at, 4, 0, 0);
  near(hot[0].intensity, 400 * .05 * .05);
  near(hot[0].distance, 2);
  near(hot[0].color.r, 1); near(hot[0].color.g, .75 / 1.2); near(hot[0].color.b, .42 / 1.2);
  // Half cooled: a quarter of the heat squared, and redder.
  const cooling = frame({debris: true}, [shards([{at: [4, 0, 0], size: .05, heat: .5}])])[0];
  assert.ok(cooling.intensity < hot[0].intensity * .1 && cooling.intensity > 0);
  assert.ok(cooling.color.g < hot[0].color.g && cooling.color.b < hot[0].color.b);
  // Fading out as the fragment's life ends.
  near(frame({debris: true}, [shards([{at: [4, 0, 0], size: .05, heat: 1, opacity: .5}])])[0].intensity, hot[0].intensity / 2);
  // Cold plating, and anything with debris off, gives no light.
  assert.equal(frame({debris: true}, [shards([{at: [4, 0, 0], size: .2, heat: 0}])]).length, 0);
  assert.equal(frame({explosions: true}, [shards([{at: [4, 0, 0], size: .05, heat: 1}])]).length, 0);
});

test('only the 8 brightest fragments get a light, and each light follows its fragment as the buffer reorders', () => {
  const list = Array.from({length: 30}, (_, i) => ({at: [i * 10, 0, 0], size: .05, heat: i < 8 ? 1 : .6}));
  const first = frame({debris: true}, [shards(list)]);
  assert.equal(first.length, 8);
  const idAt = new Map(first.map(l => [Math.round(l.at.x), l.id]));
  assert.deepEqual([...idAt.keys()].sort((a, b) => a - b), [0, 10, 20, 30, 40, 50, 60, 70]);
  // Next frame the fragments have moved on a little, and two new cold pieces come first in the buffer.
  const moved = [{at: [500, 0, 0], size: .3, heat: 0}, {at: [600, 0, 0], size: .3, heat: 0}, ...list.map(s => ({...s, at: [s.at[0] + .5, 0, 0]})).reverse()];
  const second = frame({debris: true}, [shards(moved)]);
  assert.equal(second.length, 8);
  for (const l of second) assert.equal(l.id, idAt.get(Math.round(l.at.x - .5)), `the fragment at ${l.at.x} kept its light`);
});

test('with only gunfire on, a muzzle flash the game did not light still gets an Unreal light', () => {
  const scene = new THREE.Scene();
  const at = (o, x) => { o.position.set(x, 0, 0); scene.add(o); return o; };
  const blasts = [1, 2, 3].map(i => at(Object.assign(new THREE.Object3D(), {userData: {vfxKey: 'impact.missile', flashLight: {intensity: 100 * i}}}), i));
  const muzzle = at(Object.assign(new THREE.Object3D(), {userData: {vfxKey: 'weapon.pdc', flashLight: {intensity: 10}}}), 5);
  // The game's three lights go to the blasts, so the muzzle flash has none of its own.
  assert.deepEqual(frame({gunfire: true}, [...blasts, muzzle], scene).map(l => l.id), [muzzle]);
});

test('the game lights its first nuclear detonation itself, so Unreal does not light it again', () => {
  const scene = new THREE.Scene();
  const add = userData => { const o = new THREE.Object3D(); Object.assign(o.userData, userData); scene.add(o); return o; };
  const nukes = [add({nuclearDetonation: true, flashLight: {intensity: 3600000, distance: 1200}}), add({nuclearDetonation: true, flashLight: {intensity: 1000, distance: 1200}})];
  const lights = frame({explosions: true}, nukes, scene);
  assert.deepEqual(lights.map(l => l.id), [nukes[1]]);
});
