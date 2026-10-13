// The lights and Niagara systems Lumen mode adds at the game's own effect objects (Runtime/src/lumenEffects.ts).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {THREE, loadRuntime} from './load-runtime.mjs';

const registry = JSON.stringify({effects: {smoke: true}, overrides: [
  {name: 'vent', match: {userData: {vfxKey: 'vent.*'}}, niagara: '/Game/FX/Vent', effect: 'smoke'},
  {name: 'dust', match: {userData: {vfxKey: 'dust.*'}}, niagara: '/Game/FX/Dust', effect: 'debris'},
]});
const fx = await loadRuntime('lumenEffects.ts', {log() {}, registry});
const ALL_OFF = {engineLight: false, gunfire: false, trails: false, smoke: false, explosions: false, debris: false, bigMuzzle: false};
const camera = new THREE.PerspectiveCamera();
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} is not ${b}`);
const nearVector = (v, x, y, z) => { near(v.x, x); near(v.y, y); near(v.z, z); };

/** An object with this userData at (x, y, z), under parent (a group, so the game's own flash lights do not count it). */
function effect(userData, [x, y, z] = [0, 0, 0], parent = new THREE.Group()) {
  const o = new THREE.Object3D();
  o.position.set(x, y, z);
  Object.assign(o.userData, userData);
  parent.add(o);
  return o;
}

/** Runs one frame with these effects switched on and returns the lights and systems it produced. */
function frame(on, objects, scene = new THREE.Scene()) {
  fx.beginEffects({...ALL_OFF, ...on}, camera, scene);
  for (const o of objects) { o.updateWorldMatrix(true, false); fx.noteEffect(o); }
  const lights = [], systems = [];
  fx.effectLights(l => lights.push(l));
  fx.effectSystems((o, key, matrix) => systems.push({o, key, matrix}));
  return {lights, systems};
}

test('a drive plume lights one nozzle width behind itself, scaled by throttle and nozzle size', () => {
  const plume = effect({vfxKey: 'plume.main', throttle: 0.5, nozzleWidth: 2, driveColour: 0x00ff00}, [0, 0, 10]);
  const [light] = frame({engineLight: true}, [plume]).lights;
  nearVector(light.at, 0, 0, 8);
  near(light.intensity, 12 * 0.5 * 2 * 2);
  near(light.distance, 20);
  near(light.radius, 1);
  near(light.color.r, 0.6); near(light.color.g, 1); near(light.color.b, 0.6);
  assert.equal(frame({}, [plume]).lights.length, 0);
  // A plume with its throttle almost closed gives no light.
  assert.equal(frame({engineLight: true}, [effect({vfxKey: 'plume.main', throttle: 0.01})]).lights.length, 0);
});

test('a muzzle flash needs gunfire and any other flash needs explosions, at a quarter of the game intensity', () => {
  const muzzle = effect({vfxKey: 'weapon.cannon', flashLight: {intensity: 8, distance: 500, color: 0xff0000}});
  const blast = effect({vfxKey: 'hit.small', flashLight: {intensity: 4, distance: 50}});
  const gunfire = frame({gunfire: true}, [muzzle, blast]).lights;
  assert.deepEqual(gunfire.map(l => l.id), [muzzle]);
  near(gunfire[0].intensity, 2);
  assert.equal(gunfire[0].distance, 240, 'the reach is capped at 240');
  assert.equal(gunfire[0].color.getHex(), 0xff0000);
  assert.deepEqual(frame({explosions: true}, [muzzle, blast]).lights.map(l => l.id), [blast]);
});

test("a large or huge gun's muzzle flash needs bigMuzzle, and every other muzzle flash needs gunfire", () => {
  // A big gun's shot: the flash, the game's extra mac flash and the smoky muzzle blast, all at the muzzle (entities.js fireWeapon).
  const big = effect({vfxKey: 'weapon.mac', flashLight: {intensity: 900, distance: 80}}, [10, 0, 0]);
  const extra = effect({vfxKey: 'weapon.mac', flashLight: {intensity: 600, distance: 60}}, [10.4, 0, 0]);
  const smoke = effect({vfxKey: 'explosion.flak', blastKind: 'flak', effectScale: {blastRadius: 2}, flashLight: {intensity: 0}}, [10.2, 0, 0]);
  // A small gun 30 units away: no muzzle blast near it.
  const small = effect({vfxKey: 'weapon.pdc', flashLight: {intensity: 20, distance: 10}}, [40, 0, 0]);
  const ids = on => frame(on, [big, extra, smoke, small]).lights.map(l => l.id);
  assert.deepEqual(ids({bigMuzzle: true}), [big, extra]);
  assert.deepEqual(ids({gunfire: true}), [small]);
  assert.deepEqual(ids({gunfire: true, bigMuzzle: true}), [big, extra, small]);
  // The muzzle blast itself gives no light, and a blast that is over no longer marks the flashes near it.
  assert.deepEqual(ids({}), []);
  smoke.userData.done = true;
  assert.deepEqual(ids({gunfire: true}), [big, extra, small]);
  // A big gun's flash is lit at a quarter of the game's intensity, as other flashes are.
  smoke.userData.done = false;
  near(frame({bigMuzzle: true}, [big, smoke]).lights[0].intensity, 225);
});

test('objects marked done give no light', () => {
  const done = [
    effect({vfxKey: 'hit.small', flashLight: {intensity: 4}, done: true}),
    effect({plumeKey: 'missile', motorActive: true, done: true}),
  ];
  assert.equal(frame({explosions: true, trails: true}, done).lights.length, 0);
});

test('a kinetic round lights a line along its slug, ending at its head', () => {
  const round = effect({roundDraw: {a: new THREE.Vector3(0, 0, 0), b: new THREE.Vector3(0, 0, 10), color: new THREE.Color(0x3366ff), width: 0.5, opacity: 1, cores: 1}});
  const [light] = frame({gunfire: true}, [round]).lights;
  nearVector(light.dir, 0, 0, 1);
  nearVector(light.at, 0, 0, 5);
  near(light.length, 10);
  near(light.distance, 15);
  near(light.intensity, 60 * 0.25 * 25);
  assert.equal(light.color.getHex(), 0x3366ff);
});

test('a missile lights its trail only while its motor runs', () => {
  const missile = effect({plumeKey: 'missile', motorActive: true}, [5, 0, 0]);
  const [light] = frame({trails: true}, [missile]).lights;
  nearVector(light.at, 5, 0, 0);
  near(light.intensity, 400);
  near(light.distance, 40);
  missile.userData.motorActive = false;
  assert.equal(frame({trails: true}, [missile]).lights.length, 0);
});

test('only the nearest 16 missiles get a light', () => {
  const missiles = Array.from({length: 20}, (_, i) => effect({plumeKey: 'missile', motorActive: true}, [0, 0, 100 - i]));
  const lights = frame({trails: true}, missiles).lights;
  assert.equal(lights.length, 16);
  assert.deepEqual(lights.map(l => l.id), missiles.slice(4).reverse());
});

test('the game lights its three brightest top-level flashes itself, so those are skipped', () => {
  const scene = new THREE.Scene();
  const flashes = [1, 2, 3, 4, 5].map(intensity => effect({vfxKey: 'hit', flashLight: {intensity}}, [0, 0, 0], scene));
  const nested = effect({vfxKey: 'hit', flashLight: {intensity: 9}});
  const lights = frame({explosions: true}, [...flashes, nested], scene).lights;
  // The brightest is nested in a group, so the game has no light for it and Unreal lights it.
  assert.deepEqual(lights.map(l => l.id), [nested, flashes[1], flashes[0]]);
});

test('a Niagara rule plays at the object, pointed along its surface normal and sized from its flash reach', () => {
  const vent = effect({vfxKey: 'vent.steam', surfaceNormal: new THREE.Vector3(1, 0, 0), flashLight: {distance: 40}}, [1, 2, 3]);
  const {systems} = frame({}, [vent]);
  assert.equal(systems.length, 1);
  assert.equal(systems[0].o, vent);
  assert.equal(systems[0].key, 'override:vent');
  const position = new THREE.Vector3(), turn = new THREE.Quaternion(), scale = new THREE.Vector3();
  systems[0].matrix.decompose(position, turn, scale);
  nearVector(position, 1, 2, 3);
  nearVector(scale, 5, 5, 5);
  nearVector(new THREE.Vector3(0, 1, 0).applyQuaternion(turn), 1, 0, 0);
});

test('a Niagara system falls back to the incoming direction and is at least 0.375 across', () => {
  const vent = effect({vfxKey: 'vent.steam', incomingDirection: new THREE.Vector3(0, 0, -2), flashLight: {distance: 1}});
  const {systems} = frame({}, [vent]);
  const turn = new THREE.Quaternion(), scale = new THREE.Vector3();
  systems[0].matrix.decompose(new THREE.Vector3(), turn, scale);
  nearVector(scale, 0.375, 0.375, 0.375);
  nearVector(new THREE.Vector3(0, 1, 0).applyQuaternion(turn), 0, 0, -1);
});

test('no Niagara system plays for an object marked done, or for a rule whose effect is off', () => {
  const done = effect({vfxKey: 'vent.steam', done: true});
  const dust = effect({vfxKey: 'dust.cloud'});
  assert.equal(frame({}, [done, dust]).systems.length, 0);
});
