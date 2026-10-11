// Cases about scale and change: 10,000 instances, BatchedMesh, objects added and removed every frame,
// re-parenting, skinned and morph-animated meshes, a glTF round trip, and post-processing and render targets.

// 10,000 coloured cubes in one InstancedMesh, some of them moving.
export function instances({THREE, scene, camera}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.5));
  const n = 10000, side = 100;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshLambertMaterial(), n);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    mesh.setMatrixAt(i, m.makeTranslation(-5 + (i % side) * 0.1, -4 + Math.floor(i / side) * 0.08, 0));
    mesh.setColorAt(i, c.setHSL(i / n, 0.7, 0.55));
  }
  scene.add(mesh);
  camera.position.set(0, 0, 9);
  return (dt, time) => {
    for (let i = 0; i < 200; i++) mesh.setMatrixAt(i * 50, m.makeTranslation(-5 + ((i * 50) % side) * 0.1, -4 + Math.floor(i * 50 / side) * 0.08, Math.sin(time * 2 + i) * 0.5));
    mesh.instanceMatrix.needsUpdate = true;
  };
}

// A BatchedMesh with three geometries and 60 instances.
export function batched({THREE, scene}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 5, 4); scene.add(sun);
  const batch = new THREE.BatchedMesh(60, 20000, 40000, new THREE.MeshStandardMaterial({roughness: 0.5}));
  const ids = [batch.addGeometry(new THREE.BoxGeometry(0.6, 0.6, 0.6)), batch.addGeometry(new THREE.SphereGeometry(0.4, 16, 8)), batch.addGeometry(new THREE.ConeGeometry(0.35, 0.8, 16))];
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const instances = [];
  for (let i = 0; i < 60; i++) {
    const id = batch.addInstance(ids[i % 3]);
    batch.setMatrixAt(id, m.makeTranslation(-6 + (i % 12) * 1.1, 2.5 - Math.floor(i / 12) * 1.2, 0));
    batch.setColorAt(id, c.setHSL(i / 60, 0.7, 0.55));
    instances.push(id);
  }
  scene.add(batch);
  const r = new THREE.Matrix4();
  return (dt, time) => {
    instances.forEach((id, i) => { batch.setMatrixAt(id, m.makeTranslation(-6 + (i % 12) * 1.1, 2.5 - Math.floor(i / 12) * 1.2, 0).multiply(r.makeRotationY(time + i * 0.1))); });
  };
}

// Objects added and removed every frame, and a cube moved between two spinning groups.
export function churn({THREE, scene}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.5));
  const geo = new THREE.IcosahedronGeometry(0.25), mats = [0xff5050, 0x50ff50, 0x5080ff].map(color => new THREE.MeshLambertMaterial({color}));
  const live = [];
  const left = new THREE.Group(), right = new THREE.Group();
  left.position.set(-3, -2, 0); right.position.set(3, -2, 0);
  scene.add(left, right);
  const traveller = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({color: 0xffd040}));
  traveller.position.set(1, 0, 0);
  left.add(traveller);
  let frame = 0;
  return (dt, time) => {
    frame++;
    const m = new THREE.Mesh(geo, mats[frame % 3]);
    m.position.set(-6 + (frame % 48) * 0.25, 2 + Math.sin(frame * 0.3), 0);
    scene.add(m); live.push(m);
    while (live.length > 30) scene.remove(live.shift());
    left.rotation.z = time; right.rotation.z = -time;
    // Re-parent every 60 frames, keeping the local position.
    if (frame % 60 === 0) (traveller.parent === left ? right : left).add(traveller);
  };
}

// A skinned tube bending through four bones, and a morph target blending a sphere into a cube.
export function skinning({THREE, scene}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 5, 4); scene.add(sun);
  const height = 4, segments = 4;
  const geo = new THREE.CylinderGeometry(0.4, 0.4, height, 16, 32, false);
  const pos = geo.attributes.position, idx = [], wts = [];
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) + height / 2, s = y / (height / segments), b = Math.min(segments - 1, Math.floor(s)), w = s - b;
    idx.push(b, Math.min(segments, b + 1), 0, 0); wts.push(1 - w, w, 0, 0);
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
  const bones = [];
  let parent = null;
  for (let i = 0; i <= segments; i++) { const b = new THREE.Bone(); b.position.y = i === 0 ? -height / 2 : height / segments; if (parent) parent.add(b); bones.push(b); parent = b; }
  const tube = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial({color: 0x40c0ff, roughness: 0.5}));
  tube.add(bones[0]);
  tube.bind(new THREE.Skeleton(bones));
  tube.position.x = -3;
  scene.add(tube);
  const sphere = new THREE.SphereGeometry(1.2, 32, 16), target = [];
  for (let i = 0; i < sphere.attributes.position.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(sphere.attributes.position, i);
    const k = 1.2 / Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    target.push(v.x * k, v.y * k, v.z * k);
  }
  sphere.morphAttributes.position = [new THREE.Float32BufferAttribute(target, 3)];
  const blob = new THREE.Mesh(sphere, new THREE.MeshStandardMaterial({color: 0xff8040, roughness: 0.4}));
  blob.position.x = 3;
  scene.add(blob);
  return (dt, time) => {
    bones.slice(1).forEach(b => { b.rotation.z = Math.sin(time * 1.5) * 0.35; });
    blob.morphTargetInfluences[0] = 0.5 + 0.5 * Math.sin(time * 2);
    blob.rotation.y = time * 0.4;
  };
}

// A skinned, animated model exported to glTF in the page and loaded back with GLTFLoader and an AnimationMixer.
export async function gltf({THREE, scene}) {
  const {GLTFExporter} = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const {GLTFLoader} = await import('three/examples/jsm/loaders/GLTFLoader.js');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(3, 5, 4); scene.add(sun);
  const source = new THREE.Group();
  const arm = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 0.5), new THREE.MeshStandardMaterial({color: 0x60d060}));
  arm.name = 'arm';
  source.add(arm);
  const q = a => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), a).toArray();
  const clip = new THREE.AnimationClip('spin', 2, [new THREE.QuaternionKeyframeTrack('arm.quaternion', [0, 1, 2], [...q(0), ...q(Math.PI), ...q(Math.PI * 2)])]);
  const exported = await new GLTFExporter().parseAsync(source, {binary: true, animations: [clip]});
  const loaded = await new GLTFLoader().parseAsync(exported, '');
  scene.add(loaded.scene);
  const mixer = new THREE.AnimationMixer(loaded.scene);
  for (const a of loaded.animations) mixer.clipAction(a).play();
  return dt => { mixer.update(dt); };
}

// The scene drawn into a render target, shown on a spinning plane, with an EffectComposer bloom pass on top.
export async function postprocess({THREE, scene, renderer, camera}) {
  const {EffectComposer} = await import('three/examples/jsm/postprocessing/EffectComposer.js');
  const {RenderPass} = await import('three/examples/jsm/postprocessing/RenderPass.js');
  const {UnrealBloomPass} = await import('three/examples/jsm/postprocessing/UnrealBloomPass.js');
  const {OutputPass} = await import('three/examples/jsm/postprocessing/OutputPass.js');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.2));
  const inner = new THREE.Scene();
  inner.background = new THREE.Color(0x203050);
  inner.add(new THREE.HemisphereLight(0xffffff, 0x303030, 2));
  const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.8, 0.3, 96, 12), new THREE.MeshStandardMaterial({color: 0xff8040}));
  inner.add(knot);
  const innerCam = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
  innerCam.position.z = 4;
  const target = new THREE.WebGLRenderTarget(256, 256);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({map: target.texture}));
  screen.position.x = -2.5;
  scene.add(screen);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.8, 32, 16), new THREE.MeshBasicMaterial({color: 0xffffff}));
  glow.position.x = 2.5;
  scene.add(glow);
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 1.2, 0.4, 0.6));
  composer.addPass(new OutputPass());
  const update = (dt, time) => {
    knot.rotation.y = time;
    screen.rotation.y = Math.sin(time) * 0.4;
    renderer.setRenderTarget(target);
    renderer.render(inner, innerCam);
    renderer.setRenderTarget(null);
    composer.render();
  };
  update.skipRender = true;
  return update;
}

// Fast movers for motion vectors (DLSS, TSR): a box sweeping across the view, a row of instances moving up and
// down, and a sphere that teleports every half second (a teleport must not streak).
export function motion({THREE, scene}) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 1.5));
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.MeshLambertMaterial({color: 0xffd040}));
  scene.add(box);
  const n = 12, row = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 16, 8), new THREE.MeshLambertMaterial({color: 0x50a0ff}), n);
  scene.add(row);
  const jumper = new THREE.Mesh(new THREE.SphereGeometry(0.6, 24, 12), new THREE.MeshLambertMaterial({color: 0xff5050}));
  scene.add(jumper);
  const m = new THREE.Matrix4();
  return (dt, time) => {
    box.position.set(Math.sin(time * 3) * 5, 2, 0);
    box.rotation.set(time * 2, time * 3, 0);
    for (let i = 0; i < n; i++) row.setMatrixAt(i, m.makeTranslation(-5.5 + i, -1 + Math.sin(time * 6 + i * 0.5) * 1.2, 0));
    row.instanceMatrix.needsUpdate = true;
    jumper.position.set(Math.floor(time * 2) % 2 ? 3.5 : -3.5, -3, 0);
  };
}
