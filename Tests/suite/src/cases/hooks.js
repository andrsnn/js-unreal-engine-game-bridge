// Built-in materials patched in onBeforeCompile: a texture tint, a custom attribute, a discard, vertex
// displacement driven by a uniform, and an unpatched control.
const checker = THREE => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { g.fillStyle = (x + y) % 2 ? '#f0f0f0' : '#3070d0'; g.fillRect(x * 8, y * 8, 8, 8); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

export default function hooks({THREE, scene}) {
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x202020, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(5, 8, 4);
  scene.add(sun);

  // 1. Textured standard material, tinted orange after the colour chunk.
  const tinted = new THREE.MeshStandardMaterial({map: checker(THREE), roughness: 0.6});
  tinted.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb *= vec3(1.0, 0.6, 0.3);');
  };
  const a = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), tinted);
  a.position.set(-4, 1.5, 0);
  scene.add(a);

  // 2. Basic material with vertex colours and a custom attribute mixed in through a varying.
  const plane = new THREE.PlaneGeometry(2.5, 2.5, 8, 8);
  const count = plane.attributes.position.count;
  const colors = [], bands = [];
  for (let i = 0; i < count; i++) {
    const x = plane.attributes.position.getX(i), y = plane.attributes.position.getY(i);
    colors.push(0.5 + x / 5, 0.3, 0.5 - y / 5);
    bands.push(Math.abs(Math.sin(x * 2)) > 0.7 ? 1 : 0);
  }
  plane.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  plane.setAttribute('aBand', new THREE.Float32BufferAttribute(bands, 1));
  const banded = new THREE.MeshBasicMaterial({vertexColors: true});
  banded.onBeforeCompile = shader => {
    shader.vertexShader = 'attribute float aBand;\nvarying float vBand;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvBand = aBand;');
    shader.fragmentShader = 'varying float vBand;\n' + shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n\tdiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.9, 0.2), vBand);');
  };
  const b = new THREE.Mesh(plane, banded);
  b.position.set(0, 1.5, 0);
  scene.add(b);

  // 3. Lambert material that discards vertical stripes.
  const striped = new THREE.MeshLambertMaterial({color: 0xd04040, side: THREE.DoubleSide});
  striped.onBeforeCompile = shader => {
    shader.vertexShader = 'varying vec2 vStripeUv;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvStripeUv = uv;');
    shader.fragmentShader = 'varying vec2 vStripeUv;\n' + shader.fragmentShader.replace('#include <alphatest_fragment>', '#include <alphatest_fragment>\n\tif (fract(vStripeUv.x * 6.0) < 0.5) discard;');
  };
  const c = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 2.5), striped);
  c.position.set(4, 1.5, 0);
  scene.add(c);

  // 4. Standard material whose vertices wave with a time uniform.
  const uniforms = {uWave: {value: 0}};
  const waving = new THREE.MeshStandardMaterial({color: 0x40c0a0, roughness: 0.4, side: THREE.DoubleSide});
  waving.onBeforeCompile = shader => {
    shader.uniforms.uWave = uniforms.uWave;
    shader.vertexShader = 'uniform float uWave;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed.z += sin(position.x * 2.0 + uWave) * 0.4;');
  };
  const d = new THREE.Mesh(new THREE.PlaneGeometry(4, 1.5, 32, 4), waving);
  d.position.set(-2.5, -2, 0);
  scene.add(d);

  // 5. Control: the same standard material without a patch.
  const e = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.MeshStandardMaterial({color: 0x40c0a0, roughness: 0.4}));
  e.position.set(3, -2, 0);
  scene.add(e);

  // 6. Instanced grass blades: an alpha-tested texture, double sided, swaying in begin_vertex.
  const blade = document.createElement('canvas');
  blade.width = 32; blade.height = 64;
  const bg = blade.getContext('2d');
  bg.fillStyle = '#5fbf3a';
  bg.beginPath(); bg.moveTo(4, 64); bg.lineTo(16, 0); bg.lineTo(28, 64); bg.closePath(); bg.fill();
  const bladeMap = new THREE.CanvasTexture(blade);
  bladeMap.colorSpace = THREE.SRGBColorSpace;
  const sway = {value: 0};
  const grassMat = new THREE.MeshLambertMaterial({map: bladeMap, alphaTest: 0.5, side: THREE.DoubleSide});
  grassMat.onBeforeCompile = shader => {
    shader.uniforms.uSway = sway;
    shader.vertexShader = 'uniform float uSway;\n' + shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed.x += sin(uSway + position.y * 2.0) * 0.15 * (position.y + 0.5);');
  };
  const grass = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.4, 1), grassMat, 24);
  const m4 = new THREE.Matrix4();
  const tint = new THREE.Color();
  for (let i = 0; i < 24; i++) {
    grass.setMatrixAt(i, m4.makeTranslation(-5.5 + i * 0.48, -3.6, 1));
    grass.setColorAt(i, tint.setHSL(i / 24, 0.7, 0.6));
  }
  scene.add(grass);

  return (dt, time) => {
    a.rotation.y = time * 0.5;
    uniforms.uWave.value = time * 2;
    sway.value = time * 3;
  };
}
