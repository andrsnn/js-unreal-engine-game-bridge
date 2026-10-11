// Image textures from files (PNG, JPEG) and from a canvas, on plain materials and on materials patched in
// onBeforeCompile. Each texture has four coloured quadrants: red top left, green top right, blue bottom left,
// yellow bottom right.
export default async function textures({THREE, scene}) {
  scene.add(new THREE.AmbientLight(0xffffff, 1));
  const loader = new THREE.TextureLoader();
  const load = url => new Promise((ok, fail) => loader.load(url, t => { t.colorSpace = THREE.SRGBColorSpace; ok(t); }, undefined, fail));
  const [png, jpg] = await Promise.all([load('quad.png'), load('quad.jpg')]);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const g = canvas.getContext('2d');
  for (const [x, y, c] of [[0, 0, '#e62828'], [32, 0, '#28c83c'], [0, 32, '#2850e6'], [32, 32, '#f0dc28']]) { g.fillStyle = c; g.fillRect(x, y, 32, 32); }
  const cnv = new THREE.CanvasTexture(canvas);
  cnv.colorSpace = THREE.SRGBColorSpace;
  const identity = shader => { shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n\tdiffuseColor.rgb *= 1.0;'); };
  const row = (y, patched) => [png, jpg, cnv].forEach((map, i) => {
    const material = new THREE.MeshBasicMaterial({map});
    if (patched) material.onBeforeCompile = identity;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), material);
    plane.position.set(-3 + i * 3, y, 0);
    scene.add(plane);
  });
  row(1.6, false);
  row(-1.6, true);
}
