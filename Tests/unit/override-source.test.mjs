import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three-real';
import {gltfLoaded, overrideFor, overrideRules} from '../../Runtime/src/overrides.ts';

test('composite native imports retain source coordinates and attachment positions through node transforms', () => {
  const source = new THREE.Group();
  source.position.set(.01, .002, -.007);
  source.rotation.y = Math.PI;
  source.scale.set(30.5, 30.1, 30.5);
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, .3, 2, 5, 5, 5));
  body.position.set(.02, -.04, .01); body.scale.setScalar(.45); source.add(body);
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  cargo.position.set(.31, .18, .15); cargo.scale.setScalar(.2); source.add(cargo);
  gltfLoaded({scene: source}, '/models/composite/lod0.glb');
  const sourcePose = body.matrixWorld.clone();
  const mount = new THREE.Vector3(0, .5, 0).applyMatrix4(cargo.matrixWorld);
  const nativeBounds = new THREE.Box3().setFromObject(source);
  const outer = new THREE.Group(); outer.position.set(100, 5000, -80); outer.rotation.y = .7;
  outer.scale.setScalar(1.3); outer.add(source); outer.updateMatrixWorld(true);
  const list = overrideRules(JSON.stringify({overrides:[{name:'composite',match:{url:'*/models/composite/*'},mesh:'/Game/Composite',fit:'source'}]}));
  const hit = overrideFor(body, list);
  assert.ok(hit && !hit.hide);
  const placed = new THREE.Matrix4().multiplyMatrices(body.matrixWorld, hit.fit);
  for (const point of [mount, nativeBounds.min, nativeBounds.max]) {
    assert.ok(point.clone().applyMatrix4(placed).distanceTo(point.clone().applyMatrix4(outer.matrixWorld)) < 1e-8);
  }
  assert.equal(overrideFor(cargo, list).hide, true);
  // A view that excludes this rule must not cache a miss across a mode change.
  const excluded = list.filter(r => r.always);
  assert.equal(overrideFor(body, excluded), null);
  assert.ok(overrideFor(body, list)?.fit);
  const clone = body.clone(); clone.geometry = body.geometry.clone();
  const cloneHit = overrideFor(clone, list);
  assert.ok(cloneHit.fit.clone().multiply(sourcePose).equals(new THREE.Matrix4()) ||
    new THREE.Vector3(1,2,3).applyMatrix4(cloneHit.fit).applyMatrix4(sourcePose).distanceTo(new THREE.Vector3(1,2,3)) < 1e-8);
});
