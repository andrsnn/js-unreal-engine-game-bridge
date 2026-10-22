import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PerspectiveCamera, Vector3} from 'three';

const messages = [];
globalThis.__jsgbHost = {camera: {
  take: () => JSON.stringify({v: 7, target: [1, 2, 3], theta: 0.4, phi: 1, radius: 50}),
  give: (v, json) => messages.push({v, ...JSON.parse(json)}), config() {}, off() {},
}, log() {}};
const {camera, cameraFrameStart, cameraFrameEnd} = await import('../../Runtime/src/cameraRig.ts');
const {lastFrame} = await import('../../Runtime/src/renderer.ts');

test('host camera keeps game rotation shake, and yields to views that place the camera elsewhere', () => {
  const cam = new PerspectiveCamera();
  let state = {target: [1, 2, 3], theta: 0.4, phi: 1, radius: 50};
  camera.rig({camera: () => cam, get: () => state, set: s => {state = s;}, config: () => ({})});
  cameraFrameStart();
  assert.equal(state.v, 7);
  cam.position.setFromSphericalCoords(state.radius, state.phi, state.theta).add(new Vector3(...state.target));
  cam.lookAt(new Vector3(...state.target));
  cam.rotateX(0.006); cam.rotateZ(-0.004); cam.updateMatrixWorld();
  lastFrame.camera = cam;
  cameraFrameEnd();
  assert.equal(messages.at(-1).drive, true);
  assert.equal(messages.at(-1).v, 7);
  const e = cam.matrixWorld.elements;
  assert.deepEqual(messages.at(-1).axes, [e[8], e[9], e[10], e[4], e[5], e[6]]);
  cam.position.x += 1000; cam.updateMatrixWorld();
  cameraFrameEnd();
  assert.equal(messages.at(-1).drive, false);
  assert.equal(messages.at(-1).axes, undefined);
  lastFrame.camera = new PerspectiveCamera();
  cameraFrameEnd();
  assert.equal(messages.at(-1).drive, false);
  // A view-return callback runs between frames. Taking the host camera must retain its cut.
  state = {...state, target: [400, 50, -200], theta: 1.2, phi: .6, radius: 900};
  cameraFrameStart();
  assert.deepEqual(state.target, [400, 50, -200]);
  assert.ok(Math.abs(state.theta - 1.2) < 1e-10);
  assert.ok(Math.abs(state.phi - .6) < 1e-10);
  assert.equal(state.radius, 900);
  camera.rig(null);
});
