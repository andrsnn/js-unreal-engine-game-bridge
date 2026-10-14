// One glTF model in a plain studio: a white key light, a soft fill, a little ambient light and a neutral room for
// reflections, with the camera on a three-quarter view. ?model=<url> picks the model. For checking how an imported
// model looks next to the original.
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
export default async function studio({THREE, scene, camera, renderer}) {
  const q = new URLSearchParams(location.search), url = q.get('model') ?? '/diag/raw.glb';
  // ?dir=x,y,z: where the camera sits, as a direction from the model's centre.
  const dir = (q.get('dir') ?? '-0.55,0.62,0.95').split(',').map(Number);
  scene.background = new THREE.Color(0x343b47);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.5;
  const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(-2, 3, 2.5);
  const fill = new THREE.DirectionalLight(0xdce6ff, 0.8); fill.position.set(3, 1, -1);
  scene.add(key, fill, new THREE.AmbientLight(0xffffff, 0.35));
  const gltf = await new GLTFLoader().loadAsync(url);
  scene.add(gltf.scene);
  const box = new THREE.Box3().setFromObject(gltf.scene), centre = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3()).length();
  camera.fov = 30; camera.near = size / 100; camera.far = size * 20; camera.updateProjectionMatrix();
  camera.position.copy(centre).add(new THREE.Vector3(...dir).normalize().multiplyScalar(size * 1.9));
  camera.lookAt(centre);
  return null;
}
