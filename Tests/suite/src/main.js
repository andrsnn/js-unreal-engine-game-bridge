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
// The case clock starts when the case is ready, so both sides show the same moment however long loading took.
let last = null, time = 0;
const clock = document.createElement('div');
clock.id = 'case-clock';
clock.style.cssText = 'position:fixed;right:16px;top:12px;font:14px monospace;color:#9fb0bf';
document.body.append(clock);
renderer.setAnimationLoop(now => {
  const dt = last === null || !update ? 0 : Math.min(0.1, (now - last) / 1000);
  last = now; time += dt;
  update?.(dt, time);
  // The case clock on screen, so a still shows which moment each side drew.
  if (update) clock.textContent = `t ${time.toFixed(2)}`;
  // A case that draws for itself (render targets, an EffectComposer) sets update.skipRender.
  if (!update?.skipRender) renderer.render(scene, update?.camera ?? camera);
});
