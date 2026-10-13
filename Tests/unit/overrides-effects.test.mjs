// The effect switches and rule lists overrides.json gives Lumen mode (Runtime/src/overrides.ts).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {THREE, loadRuntime} from './load-runtime.mjs';

const ALL_OFF = {engineLight: false, gunfire: false, trails: false, smoke: false, explosions: false, debris: false, bigMuzzle: false};
const named = (name, userData = {}, parent = null) => {
  const o = new THREE.Object3D(); o.name = name; Object.assign(o.userData, userData);
  parent?.add(o);
  return o;
};
const matches = (rule, o) => rule.tests.every(t => t(o, undefined));

test('every effect but bigMuzzle is off without a file, with a broken file, and unless the file says true', async () => {
  assert.deepEqual((await loadRuntime('overrides.ts')).effectFlags(undefined), {...ALL_OFF, bigMuzzle: true});
  assert.deepEqual((await loadRuntime('overrides.ts')).effectFlags('{not json'), {...ALL_OFF, bigMuzzle: true});
  const json = JSON.stringify({effects: {gunfire: true, smoke: 'yes', debris: 1, trails: true}});
  assert.deepEqual((await loadRuntime('overrides.ts')).effectFlags(json), {...ALL_OFF, gunfire: true, trails: true, bigMuzzle: true});
  // bigMuzzle is on by default, and off only when the file says false.
  assert.equal((await loadRuntime('overrides.ts')).effectFlags(JSON.stringify({effects: {bigMuzzle: false}})).bigMuzzle, false);
  assert.equal((await loadRuntime('overrides.ts')).effectFlags(JSON.stringify({effects: {bigMuzzle: 0}})).bigMuzzle, true);
});

test('Niagara rules go to the system list, and mesh and hide rules to the override list', async () => {
  const json = JSON.stringify({overrides: [
    {name: 'hull', match: {object: 'Ship*'}, mesh: '/Game/Hull'},
    {name: 'rocks', match: {object: 'Rock'}, hide: true},
    {name: 'vent', match: {userData: {vfxKey: 'vent.*'}}, niagara: '/Game/FX/Vent'},
    {name: 'nothing to draw', match: {object: 'Box'}},
    {name: 'nothing to match', match: {}, mesh: '/Game/Box'},
  ]});
  const m = await loadRuntime('overrides.ts');
  assert.deepEqual(m.overrideRules(json).map(r => r.key), ['override:hull', 'override:rocks']);
  assert.deepEqual(m.systemRules(json).map(r => r.key), ['override:vent']);
});

test('a rule that belongs to an effect is dropped while that effect is off', async () => {
  const rules = effects => JSON.stringify({effects, overrides: [
    {name: 'vent', match: {userData: {vfxKey: 'vent.*'}}, niagara: '/Game/FX/Vent', effect: 'smoke'},
    {name: 'wreck', match: {object: 'Wreck'}, mesh: '/Game/Wreck', effect: 'debris'},
  ]});
  const off = await loadRuntime('overrides.ts');
  assert.equal(off.systemRules(rules({})).length, 0);
  assert.equal(off.overrideRules(rules({})).length, 0);
  const on = await loadRuntime('overrides.ts');
  assert.equal(on.systemRules(rules({smoke: true, debris: true})).length, 1);
  assert.equal(on.overrideRules(rules({smoke: true, debris: true})).length, 1);
});

test('a userData pattern matches the object or one of its parents, ignoring case', async () => {
  const json = JSON.stringify({overrides: [{name: 'vent', match: {userData: {vfxKey: 'vent.*'}}, niagara: '/Game/FX/Vent'}]});
  const [rule] = (await loadRuntime('overrides.ts')).systemRules(json);
  const parent = named('emitter', {vfxKey: 'Vent.Steam'});
  assert.ok(matches(rule, parent));
  assert.ok(matches(rule, named('child', {}, parent)));
  // The dot in the pattern is a plain dot, not "any character".
  assert.ok(!matches(rule, named('other', {vfxKey: 'ventXsteam'})));
  assert.ok(!matches(rule, named('none')));
});

test('an object pattern matches the name of the object or one of its parents, and ? stands for one character', async () => {
  const json = JSON.stringify({overrides: [{name: 'hull', match: {object: 'ship_?'}, mesh: '/Game/Hull'}]});
  const [rule] = (await loadRuntime('overrides.ts')).overrideRules(json);
  const ship = named('Ship_A');
  assert.ok(matches(rule, ship));
  assert.ok(matches(rule, named('turret', {}, ship)));
  assert.ok(!matches(rule, named('ship_AB')));
});

test('a url pattern matches the glTF file a mesh came from, with backslashes read as slashes', async () => {
  const json = JSON.stringify({overrides: [{name: 'hull', match: {url: '*/models/ship_*.glb'}, mesh: '/Game/Hull'}]});
  const m = await loadRuntime('overrides.ts');
  const list = m.overrideRules(json);
  const mesh = from => { const o = new THREE.Mesh(new THREE.BufferGeometry()); o.userData.jsgbSource = from; return o; };
  assert.deepEqual(m.overrideFor(mesh('C:\\game\\models\\ship_frigate.glb'), list), {key: 'override:hull', hide: false, fit: null});
  assert.equal(m.overrideFor(mesh('/game/models/rock.glb'), list), null);
  // A mesh with no source never matches a url rule.
  assert.equal(m.overrideFor(new THREE.Mesh(new THREE.BufferGeometry()), list), null);
});

test("a gun takes its faction's rule on that faction's hulls and its own rule anywhere else", async () => {
  // As Overrides/make-hardburn-guns.mjs writes them: the faction variants first, then the gun's own rule.
  const gun = {url: '*/models/guns/pixal/twin-heavy-turret.glb', mesh: 'geometry_0'};
  const json = JSON.stringify({overrides: [
    {name: 'gun_tdf', match: {...gun, userData: {glbKey: ['concept_tdf_*', 'tdf_*', 'tdf-*']}}, mesh: '/Game/Gun', fit: 'none'},
    {name: 'gun_mrn', match: {...gun, userData: {glbKey: ['concept_mrn_*', 'mrn_*', 'mrn-*']}}, mesh: '/Game/Gun', fit: 'none'},
    {name: 'gun', match: gun, mesh: '/Game/Gun', fit: 'none'},
  ]});
  const m = await loadRuntime('overrides.ts');
  const list = m.overrideRules(json);
  const mounted = key => {
    const hull = named('hull', key ? {glbKey: key} : {}), turret = named('turret-traverse', {}, hull);
    const o = new THREE.Mesh(new THREE.BufferGeometry()); o.name = 'geometry_0'; o.userData.jsgbSource = '/models/guns/pixal/twin-heavy-turret.glb'; turret.add(o);
    return m.overrideFor(o, list)?.key;
  };
  assert.equal(mounted('concept_tdf_frigate'), 'override:gun_tdf');
  assert.equal(mounted('mrn_cruiser'), 'override:gun_mrn');
  assert.equal(mounted('concept_helion_scout'), 'override:gun');
  assert.equal(mounted(null), 'override:gun');
});
