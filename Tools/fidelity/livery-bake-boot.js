// The bake's own page: a renderer and the game's hull loader, without the game. Loading the hulls the way a campaign
// does (a few at start, the rest when asked for) keeps the page small; the full game loads every hull at once.
import * as THREE from 'three';
import * as pixal from '/src/scene/pixal3d.js';
const renderer = new THREE.WebGLRenderer({antialias: false, preserveDrawingBuffer: false});
renderer.setSize(256, 256);
document.body.append(renderer.domElement);
window.__FF = {THREE, renderer, ready: () => !!window.__bakeReady};
try {
  await pixal.preloadPixalAssets(renderer, null, {campaign: true});
  pixal.startConceptStreaming();
  window.__bakeReady = true;
} catch (e) { window.__bakeError = String(e?.stack ?? e); console.error('bake boot failed', e); }
