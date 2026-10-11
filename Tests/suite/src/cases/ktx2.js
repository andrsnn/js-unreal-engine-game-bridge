// Compressed KTX2 textures through KTX2Loader: Basis ETC1S and UASTC (transcoded in a Web Worker), BC7 and
// uncompressed RGBA8. Samples from the three.js repository (examples/textures/ktx2).
export default async function ktx2({THREE, scene, renderer}) {
  const {KTX2Loader} = await import('three/examples/jsm/loaders/KTX2Loader.js');
  const loader = new KTX2Loader().setTranscoderPath('basis/').detectSupport(renderer);
  const names = ['2d_etc1s', '2d_uastc', '2d_bc7', '2d_rgba8'];
  const textures = await Promise.all(names.map(n => loader.loadAsync(`ktx2/${n}.ktx2`).catch(() => null)));
  textures.forEach((map, i) => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial(map ? {map} : {color: 0xff00ff}));
    plane.position.set(-4.5 + i * 3, 0, 0);
    scene.add(plane);
  });
  loader.dispose();
}
