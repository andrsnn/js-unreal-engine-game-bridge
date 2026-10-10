// Orbit Demo: a small three.js game used to try JS Unreal Engine Game Bridge.
// It uses ordinary three.js features: lit and textured meshes, a custom shader, lines, points,
// an HTML HUD, timers and audio. The same file runs in a browser and, unchanged, in Unreal.
import * as THREE from 'three';

const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05080d);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 2000);

scene.add(new THREE.AmbientLight(0x404a55, 1.2));
const sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
sun.position.set(-60, 40, 30);
scene.add(sun);

// A planet with a texture painted on a canvas, so the example needs no image files.
function planetTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#b8562f'; g.fillRect(0, 0, 512, 256);
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(${60 + rand() * 80 | 0}, ${30 + rand() * 30 | 0}, ${20 + rand() * 20 | 0}, ${0.15 + rand() * 0.35})`;
    g.beginPath(); g.ellipse(rand() * 512, rand() * 256, 10 + rand() * 50, 4 + rand() * 20, rand() * 3, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const planet = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), new THREE.MeshStandardMaterial({map: planetTexture(), roughness: 0.9}));
scene.add(planet);

// An atmosphere rim: a custom shader on a slightly larger sphere, drawn from the inside.
const atmosphere = new THREE.Mesh(new THREE.SphereGeometry(10.6, 64, 32), new THREE.ShaderMaterial({
  uniforms: {tint: {value: new THREE.Color(0x66d9e8)}, strength: {value: 1.2}},
  vertexShader: 'varying vec3 vN; varying vec3 vW; void main() { vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: 'uniform vec3 tint; uniform float strength; varying vec3 vN; varying vec3 vW; void main() { float rim = pow(1.0 - abs(dot(normalize(vN), normalize(cameraPosition - vW))), 3.0); gl_FragColor = vec4(tint * 2.0, rim * 0.5 * strength); }',
  side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
}));
scene.add(atmosphere);

// Gravity-well rings: line loops at growing radii, and one bright outer ring on top of them.
const orbits = [16, 22, 28, 34, 40];
for (const [i, r] of orbits.entries()) {
  const points = Array.from({length: 128}, (_, k) => new THREE.Vector3(Math.cos(k / 128 * Math.PI * 2) * r, -1.5 - i * 0.6, Math.sin(k / 128 * Math.PI * 2) * r));
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({color: 0x3f9aa6, transparent: true, opacity: 0.45, depthWrite: false})));
}
const outer = Array.from({length: 256}, (_, k) => new THREE.Vector3(Math.cos(k / 256 * Math.PI * 2) * 40, -1.5 - 4 * 0.6, Math.sin(k / 256 * Math.PI * 2) * 40));
scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(outer), new THREE.LineBasicMaterial({color: 0x9ff3f0, transparent: true, opacity: 0.9, depthWrite: false})));

// Stars.
const starPositions = new Float32Array(3000);
for (let i = 0; i < starPositions.length; i += 3) {
  const v = new THREE.Vector3().randomDirection().multiplyScalar(600 + Math.random() * 300);
  starPositions.set([v.x, v.y, v.z], i);
}
const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(starPositions, 3)), new THREE.PointsMaterial({color: 0xffffff, size: 1.6, sizeAttenuation: false}));
scene.add(stars);

// Ships: cones that orbit the planet on the rings.
const ships = [];
const shipGeometry = new THREE.ConeGeometry(0.7, 2.4, 8).rotateX(Math.PI / 2);
const shipMaterial = new THREE.MeshStandardMaterial({color: 0xd7dde2, metalness: 0.4, roughness: 0.4, emissive: 0x112233});
function launchShip() {
  const ship = new THREE.Mesh(shipGeometry, shipMaterial);
  const ring = ships.length % orbits.length;
  ship.userData = {radius: orbits[ring], height: -1.5 - ring * 0.6 + 1.2, speed: 0.25 + ring * 0.05, angle: ships.length * 1.3};
  scene.add(ship);
  ships.push(ship);
}
for (let i = 0; i < 6; i++) launchShip();

// HUD.
const $ = id => document.getElementById(id);
$('orbits').textContent = String(orbits.length);
$('launch').addEventListener('click', () => launchShip());
$('ping').addEventListener('click', () => { new Audio('/audio/ping.ogg').play(); });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  camera.position.set(Math.cos(t * 0.05) * 70, 32, Math.sin(t * 0.05) * 70);
  camera.lookAt(0, -2, 0);
  planet.rotation.y = t * 0.08;
  for (const ship of ships) {
    const s = ship.userData, a = s.angle + t * s.speed;
    ship.position.set(Math.cos(a) * s.radius, s.height, Math.sin(a) * s.radius);
    ship.lookAt(Math.cos(a + 0.05) * s.radius, s.height, Math.sin(a + 0.05) * s.radius);
  }
  $('ships').textContent = ships.length.toLocaleString();
  $('clock').textContent = `${t.toFixed(1)} s`;
  renderer.render(scene, camera);
});
