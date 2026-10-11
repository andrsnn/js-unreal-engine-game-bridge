// Scene-level cases: materials, transparency, lines, points and sprites, lights and shadows, fog, cameras.
const lights = (THREE, scene, shadows = false) => {
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x202020, 1.0));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(5, 8, 4);
  if (shadows) { sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, {left: -8, right: 8, top: 8, bottom: -8}); }
  scene.add(sun);
  return sun;
};

// The fixture scene: a lit cube, an additive sprite, pixel-sized points, a line loop, a ShaderMaterial and a UV plane.
export function basics({THREE, scene}) {
  lights(THREE, scene);
  const cube = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({color: 0x3080ff, roughness: 0.5}));
  scene.add(cube);
  const glow = document.createElement('canvas');
  glow.width = glow.height = 64;
  const g = glow.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map: new THREE.CanvasTexture(glow), color: 0xff3020, blending: THREE.AdditiveBlending}));
  sprite.position.set(-4, 0, 0); sprite.scale.set(1.5, 1.5, 1);
  scene.add(sprite);
  const grid = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) grid.push(4 + x * 0.6, y * 0.6, 0);
  scene.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(grid, 3)), new THREE.PointsMaterial({color: 0x40ff60, size: 6, sizeAttenuation: false})));
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1, 2.5, 0), new THREE.Vector3(1, 2.5, 0), new THREE.Vector3(1, 4.5, 0), new THREE.Vector3(-1, 4.5, 0)]), new THREE.LineBasicMaterial({color: 0xffe040})));
  const shader = new THREE.ShaderMaterial({
    uniforms: {uTime: {value: 0}, uTint: {value: new THREE.Color(0xff8040)}},
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uTime; uniform vec3 uTint; varying vec2 vUv; void main() { float c = mod(floor(vUv.x * 8.0) + floor(vUv.y * 8.0), 2.0); gl_FragColor = vec4(mix(uTint, vec3(0.1), c) * (0.75 + 0.25 * sin(uTime)), 1.0); }',
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), shader);
  plane.position.set(0, -3, 0);
  scene.add(plane);
  const uvPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; void main() { gl_FragColor = vec4(vUv, 0.0, 1.0); }',
  }));
  uvPlane.position.set(4, -3, 0);
  scene.add(uvPlane);
  return (dt, time) => { cube.rotation.y = time; shader.uniforms.uTime.value = time; };
}

// One sphere per built-in material.
export function materials({THREE, scene, camera}) {
  lights(THREE, scene);
  camera.position.set(0, 0, 12);
  const list = [
    new THREE.MeshBasicMaterial({color: 0xd04040}),
    new THREE.MeshLambertMaterial({color: 0xd04040}),
    new THREE.MeshPhongMaterial({color: 0xd04040, shininess: 60}),
    new THREE.MeshStandardMaterial({color: 0xd04040, roughness: 0.3, metalness: 0.2}),
    new THREE.MeshPhysicalMaterial({color: 0xd04040, roughness: 0.2, clearcoat: 1}),
    new THREE.MeshToonMaterial({color: 0xd04040}),
    new THREE.MeshNormalMaterial(),
    new THREE.MeshMatcapMaterial({color: 0xd04040}),
    new THREE.MeshStandardMaterial({color: 0x40a0d0, emissive: 0x402000, roughness: 0.8}),
    new THREE.MeshStandardMaterial({color: 0x808080, wireframe: true}),
  ];
  list.forEach((m, i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.9, 32, 16), m);
    s.position.set(-8 + (i % 5) * 4, i < 5 ? 2 : -2, 0);
    scene.add(s);
  });
}

// Overlapping transparent planes (sorting), opacity, alpha test and depthWrite off.
export function transparency({THREE, scene}) {
  lights(THREE, scene);
  const colors = [0xff4040, 0x40ff40, 0x4080ff];
  colors.forEach((c, i) => {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({color: c, transparent: true, opacity: 0.5, side: THREE.DoubleSide}));
    p.position.set(-4 + i * 1.2, 1, -i * 0.8);
    scene.add(p);
  });
  const dots = document.createElement('canvas');
  dots.width = dots.height = 64;
  const g = dots.getContext('2d');
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = (x + y) % 2 ? 'rgba(255,220,60,1)' : 'rgba(255,220,60,0)'; g.fillRect(x * 16, y * 16, 16, 16); }
  const cut = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshStandardMaterial({map: new THREE.CanvasTexture(dots), alphaTest: 0.5, side: THREE.DoubleSide}));
  cut.position.set(3.5, 1, 0);
  scene.add(cut);
  const back = new THREE.Mesh(new THREE.BoxGeometry(8, 1, 1), new THREE.MeshStandardMaterial({color: 0xa0a0a0}));
  back.position.set(0, -2.5, -1);
  scene.add(back);
  const glass = new THREE.Mesh(new THREE.SphereGeometry(1.2, 32, 16), new THREE.MeshStandardMaterial({color: 0x80c0ff, transparent: true, opacity: 0.35, depthWrite: false}));
  glass.position.set(0, -2.5, 0.5);
  scene.add(glass);
  return (dt, time) => { glass.position.x = Math.sin(time) * 3; };
}

// Line, LineSegments, LineLoop, dashed lines and Line2 (wide lines from three's examples).
export async function lines({THREE, scene}) {
  const {Line2} = await import('three/examples/jsm/lines/Line2.js');
  const {LineGeometry} = await import('three/examples/jsm/lines/LineGeometry.js');
  const {LineMaterial} = await import('three/examples/jsm/lines/LineMaterial.js');
  const wave = [];
  for (let i = 0; i <= 64; i++) wave.push(new THREE.Vector3(-6 + i * 0.1875, 3 + Math.sin(i * 0.3), 0));
  scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(wave), new THREE.LineBasicMaterial({color: 0x40e0ff})));
  const segs = [];
  for (let i = 0; i < 20; i++) segs.push(new THREE.Vector3(-6 + i * 0.6, 0.5, 0), new THREE.Vector3(-6 + i * 0.6, 1.5, 0));
  scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(segs), new THREE.LineBasicMaterial({color: 0xffc040})));
  const circle = [];
  for (let i = 0; i < 48; i++) circle.push(new THREE.Vector3(4 + Math.cos(i / 48 * Math.PI * 2) * 1.5, -1.5 + Math.sin(i / 48 * Math.PI * 2) * 1.5, 0));
  scene.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(circle), new THREE.LineBasicMaterial({color: 0xff60a0})));
  const dashed = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-6, -0.5, 0), new THREE.Vector3(1, -0.5, 0)]), new THREE.LineDashedMaterial({color: 0xffffff, dashSize: 0.3, gapSize: 0.2}));
  dashed.computeLineDistances();
  scene.add(dashed);
  const positions = [];
  for (let i = 0; i <= 40; i++) positions.push(-6 + i * 0.2, -3 + Math.cos(i * 0.4) * 0.6, 0);
  const geometry = new LineGeometry();
  geometry.setPositions(positions);
  const wide = new Line2(geometry, new LineMaterial({color: 0x80ff60, linewidth: 6, resolution: new THREE.Vector2(innerWidth, innerHeight)}));
  wide.computeLineDistances();
  scene.add(wide);
}

// Points (world and pixel sized, vertex colours) and sprites (textured, rotated, scaled).
export function billboards({THREE, scene}) {
  const n = 400, pos = [], col = [];
  for (let i = 0; i < n; i++) { const a = i * 0.31, r = 0.5 + i / n * 3; pos.push(-3 + Math.cos(a) * r, Math.sin(a) * r * 0.6 + 1, 0); col.push(i / n, 1 - i / n, 0.6); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({size: 0.12, vertexColors: true})));
  const px = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([3, 2, 0, 3.5, 2, 0, 4, 2, 0, 4.5, 2, 0], 3)), new THREE.PointsMaterial({color: 0xffffff, size: 8, sizeAttenuation: false}));
  scene.add(px);
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffd040'; ctx.beginPath(); ctx.moveTo(32, 4); ctx.lineTo(60, 60); ctx.lineTo(4, 60); ctx.closePath(); ctx.fill();
  const map = new THREE.CanvasTexture(c);
  const sprites = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({map, color: new THREE.Color().setHSL(i / 5, 0.8, 0.6), rotation: i * 0.4}));
    s.position.set(-4 + i * 2, -2.5, 0);
    s.scale.setScalar(0.8 + i * 0.2);
    scene.add(s); sprites.push(s);
  }
  return (dt, time) => { sprites.forEach((s, i) => { s.material.rotation = time + i * 0.4; }); };
}

// Directional, point and spot lights casting shadows onto a floor.
export function shadows({THREE, scene, renderer, camera}) {
  renderer.shadowMap.enabled = true;
  scene.add(new THREE.AmbientLight(0xffffff, 0.3));
  lights(THREE, scene, true).intensity = 1.2;
  const point = new THREE.PointLight(0xff8040, 30, 20);
  point.position.set(-3, 3, 2); point.castShadow = true;
  scene.add(point);
  const spot = new THREE.SpotLight(0x40a0ff, 60, 20, 0.5, 0.3);
  spot.position.set(4, 6, 2); spot.target.position.set(3, 0, 0); spot.castShadow = true;
  scene.add(spot, spot.target);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({color: 0xb0b0b0}));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5; floor.receiveShadow = true;
  scene.add(floor);
  const shapes = [new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.SphereGeometry(0.9, 32, 16), new THREE.TorusKnotGeometry(0.6, 0.2, 96, 12)];
  const meshes = shapes.map((geo, i) => { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({color: 0xe0e0e0})); m.position.set(-3.5 + i * 3.5, 0, 0); m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; });
  camera.position.set(0, 5, 10); camera.lookAt(0, -0.5, 0);
  return (dt, time) => { meshes.forEach((m, i) => { m.rotation.y = time * (0.5 + i * 0.2); }); };
}

// Linear fog over a row of objects running into the distance.
export function fog({THREE, scene, camera}) {
  scene.background = new THREE.Color(0x8090a0);
  scene.fog = new THREE.Fog(0x8090a0, 5, 30);
  lights(THREE, scene);
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), new THREE.MeshStandardMaterial({color: 0xd06030}));
    m.position.set(i % 2 ? 2 : -2, 0, -i * 3);
    scene.add(m);
  }
  camera.position.set(0, 1.5, 6); camera.lookAt(0, 0, -10);
}

// Exponential fog.
export function fogExp2({THREE, scene, camera}) {
  scene.background = new THREE.Color(0x203040);
  scene.fog = new THREE.FogExp2(0x203040, 0.08);
  lights(THREE, scene);
  for (let i = 0; i < 12; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.8, 24, 12), new THREE.MeshLambertMaterial({color: 0x60d0a0}));
    m.position.set(i % 2 ? 2 : -2, 0, -i * 3);
    scene.add(m);
  }
  camera.position.set(0, 1.5, 6); camera.lookAt(0, 0, -10);
}

// An orthographic camera looking down on a board.
export function ortho({THREE, scene}) {
  lights(THREE, scene);
  const aspect = innerWidth / innerHeight;
  const cam = new THREE.OrthographicCamera(-6 * aspect, 6 * aspect, 6, -6, 0.1, 100);
  cam.position.set(0, 20, 0); cam.lookAt(0, 0, 0);
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.3 + ((x * 7 + z * 3) & 3) * 0.3, 0.9), new THREE.MeshStandardMaterial({color: new THREE.Color().setHSL(((x + z) & 7) / 8, 0.6, 0.5)}));
    m.position.set(x * 1.1, 0, z * 1.1);
    scene.add(m);
  }
  const update = () => {};
  update.camera = cam;
  return update;
}
