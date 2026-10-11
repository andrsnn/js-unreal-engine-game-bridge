// The conformance suite: one small three.js scene per case, picked with ?case=<name>. Each case module exports
// setup({THREE, scene, camera, renderer}) and may return a function update(dt, time) that runs every frame.
// Time only advances through requestAnimationFrame, so a fixed-step capture shows the same frames in the
// browser and in Unreal.
import * as THREE from 'three';
import {cases} from './cases/index.js';

const name = new URLSearchParams(location.search).get('case') ?? 'hooks';
const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(1);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101820);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 2, 10);
camera.lookAt(0, 0, 0);

const make = cases[name];
if (!make) throw Error(`unknown case "${name}"; cases: ${Object.keys(cases).join(', ')}`);
// A case may load files first (models, textures): it returns its update function or a promise of one.
let update = null;
Promise.resolve(make({THREE, scene, camera, renderer})).then(u => {
  update = u ?? null;
  const label = document.getElementById('case');
  label.textContent = name;
  label.id = 'ready';
});

addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
let last = null, time = 0;
renderer.setAnimationLoop(now => {
  const dt = last === null ? 0 : Math.min(0.1, (now - last) / 1000);
  last = now; time += dt;
  update?.(dt, time);
  renderer.render(scene, update?.camera ?? camera);
});
