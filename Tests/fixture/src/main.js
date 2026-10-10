// A small Three.js scene that uses each kind of object the mirror handles, at known places:
// lit mesh, sprite, points (pixel and world sized), lines, a custom ShaderMaterial and DOM UI.
import * as THREE from 'three';

const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101820);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 2, 10);
camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x202020, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(5, 8, 4);
scene.add(sun);

// Lit cube at the origin.
const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({color: 0x3080ff, roughness: 0.5}));
scene.add(cube);

// Red sprite to the left: 1.5 units across, with a radial glow drawn on a canvas.
const glow = document.createElement('canvas');
glow.width = glow.height = 64;
const g = glow.getContext('2d');
const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
grad.addColorStop(0, 'rgba(255,255,255,1)');
grad.addColorStop(1, 'rgba(255,255,255,0)');
g.fillStyle = grad;
g.fillRect(0, 0, 64, 64);
const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(glow), color: 0xff3020, blending: THREE.AdditiveBlending}));
sprite.position.set(-4, 0, 0);
sprite.scale.set(1.5, 1.5, 1);
scene.add(sprite);

// Green points to the right: a 3x3 grid of 6-pixel dots.
const grid = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) grid.push(4 + x * 0.6, y * 0.6, 0);
const points = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(grid, 3)),
  new THREE.PointsMaterial({color: 0x40ff60, size: 6, sizeAttenuation: false}));
scene.add(points);

// Yellow square outline above.
const square = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, 2.5, 0), new THREE.Vector3(1, 2.5, 0), new THREE.Vector3(1, 4.5, 0), new THREE.Vector3(-1, 4.5, 0)]),
  new THREE.LineBasicMaterial({color: 0xffe040}));
scene.add(square);

// Custom shader below: a plane with a UV checker and a time-driven tint.
const shader = new THREE.ShaderMaterial({
  uniforms: {uTime: {value: 0}, uTint: {value: new THREE.Color(0xff8040)}},
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform float uTime; uniform vec3 uTint; varying vec2 vUv; void main() { float c = mod(floor(vUv.x * 8.0) + floor(vUv.y * 8.0), 2.0); gl_FragColor = vec4(mix(uTint, vec3(0.1), c) * (0.75 + 0.25 * sin(uTime)), 1.0); }',
});
const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), shader);
plane.position.set(0, -3, 0);
scene.add(plane);

// UV debug plane on the right, below the points: red = u, green = v.
const uvPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'varying vec2 vUv; void main() { gl_FragColor = vec4(vUv, 0.0, 1.0); }',
}));
uvPlane.position.set(4, -3, 0);
scene.add(uvPlane);

let spinning = true;
document.getElementById('spin').addEventListener('click', () => { spinning = !spinning; document.getElementById('label').textContent = spinning ? 'Spinning' : 'Stopped'; });
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (spinning) cube.rotation.y += dt;
  shader.uniforms.uTime.value += dt;
  renderer.render(scene, camera);
});
