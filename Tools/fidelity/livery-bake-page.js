// Runs inside Hard Burn's own page (Vite dev server, Tools/fidelity/bake-livery.mjs). For one override hull it loads the
// game's model through the game's own loader (scene/pixal3d.js), takes the material the game paints that hull with
// (faction colours, stripes, panels and tint: scene/hull-livery.js or the fleet paint in pixal3d.js), and draws the
// override's source model flat in its texture space through that material, with the source's own colour texture as
// the map. The result is the source's colour texture with the game's livery painted on, exactly as the browser
// computes it. The per-ship registration marks are left out: the texture is shared by every ship of the class.
// Vite serves this module, so these resolve to the same module instances the game's page uses.
import * as pixal from '/src/scene/pixal3d.js';
import {hullPlateMask} from '/src/scene/hull-plate-mask.js';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {MeshBVH} from 'three-mesh-bvh';
// How much of the original texture's fine light and dark detail goes on top of the game's colours.
const DETAIL = .8;
const F = window.__FF, THREE = F.THREE;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const largestMesh = root => { let best = null, most = -1; root.updateMatrixWorld(true); root.traverse(o => { const n = o.isMesh ? o.geometry.attributes.position.count : -1; if (n > most) { most = n; best = o; } }); return best; };

// The game's own model and paint for a concept, once its closest level has loaded.
async function gameHull(key) {
  pixal.requestConcept(key).catch(() => {});
  for (let t = 0; t < 600; t++) {
    const ship = pixal.pixalShip(key), level = ship?.children[0]?.levels?.[0]?.object;
    const mesh = level && largestMesh(level);
    if (ship?.userData.hullLoaded && mesh?.material?.onBeforeCompile && mesh.material.map) return {level, mesh};
    await sleep(100);
  }
  throw Error(`${key}: the game didn't load its model`);
}

const oetf = `vec3 jsgbOetf(vec3 c) { c = clamp(c, 0., 1.); return mix(c * 12.92, 1.055 * pow(c, vec3(1. / 2.4)) - .055, step(.0031308, c)); }`;

export async function bake(name, key, sourceUrl) {
  const {level, mesh: game} = await gameHull(key);
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(sourceUrl);
  const source = largestMesh(gltf.scene);
  const map = source.material.map;
  if (!map) throw Error(`${name}: the source has no colour texture`);
  // Source vertices into the game mesh's own (local) coordinates: both glTF scenes share one frame.
  const sceneRoot = level.children[0].children[0];
  const gameNode = new THREE.Matrix4().copy(sceneRoot.matrixWorld).invert().multiply(game.matrixWorld);
  const geometry = source.geometry.clone().applyMatrix4(new THREE.Matrix4().copy(gameNode).invert().multiply(source.matrixWorld));
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  // For each source vertex: the nearest point on the game's model, its place in the game's texture (uv) and its plate
  // weight. The bake then shows the game's own colours and paint at every point of the detailed model.
  const gp = game.geometry.attributes.position, guv = game.geometry.attributes.uv;
  const gamePositions = new Float32Array(gp.count * 3);
  for (let i = 0; i < gp.count; i++) { gamePositions[i * 3] = gp.getX(i); gamePositions[i * 3 + 1] = gp.getY(i); gamePositions[i * 3 + 2] = gp.getZ(i); }
  const mask = hullPlateMask(gamePositions, game.geometry.index?.array, 3, 0);
  const lookup = new THREE.BufferGeometry();
  lookup.setAttribute('position', new THREE.BufferAttribute(gamePositions, 3));
  if (game.geometry.index) lookup.setIndex(game.geometry.index.clone());
  const bvh = new MeshBVH(lookup);
  const sp = geometry.attributes.position, n = sp.count;
  const gameUv = new Float32Array(n * 2), weight = new Float32Array(n);
  const at = new THREE.Vector3(), hit = {point: new THREE.Vector3(), faceIndex: 0, distance: 0}, tri = new THREE.Triangle(), bary = new THREE.Vector3();
  const index = lookup.index;
  for (let v = 0; v < n; v++) {
    at.fromBufferAttribute(sp, v);
    if (!bvh.closestPointToPoint(at, hit)) continue;
    const f = hit.faceIndex * 3, a = index ? index.getX(f) : f, b = index ? index.getX(f + 1) : f + 1, c = index ? index.getX(f + 2) : f + 2;
    tri.a.fromArray(gamePositions, a * 3); tri.b.fromArray(gamePositions, b * 3); tri.c.fromArray(gamePositions, c * 3);
    tri.getBarycoord(hit.point, bary);
    if (guv) { gameUv[v * 2] = guv.getX(a) * bary.x + guv.getX(b) * bary.y + guv.getX(c) * bary.z; gameUv[v * 2 + 1] = guv.getY(a) * bary.x + guv.getY(b) * bary.y + guv.getY(c) * bary.z; }
    weight[v] = mask[a] * bary.x + mask[b] * bary.y + mask[c] * bary.z;
  }
  // uv: where the game's texture is sampled (the game's own uv at the nearest point); jsgbUv: the source's own uv,
  // where the result is written, and where its fine light and dark detail comes from.
  geometry.setAttribute('jsgbUv', geometry.attributes.uv.clone());
  geometry.setAttribute('uv', new THREE.BufferAttribute(gameUv, 2));
  geometry.setAttribute('hullPaintWeight', new THREE.BufferAttribute(weight, 1));

  // The game's material for this hull, with its own texture, drawn at each texel's place in the source's texture. The
  // source's fine detail (each texel's brightness against its neighbourhood's) is multiplied in, so the colours stay
  // the game's and the detail is the original's.
  const paint = game.material.clone();
  for (const slot of ['normalMap', 'aoMap', 'emissiveMap', 'lightMap', 'bumpMap', 'envMap']) paint[slot] = null;
  if (!paint.map) paint.map = map;
  paint.side = THREE.DoubleSide; paint.depthTest = paint.depthWrite = false; paint.transparent = false;
  const blank = new THREE.DataTexture(new Uint8Array(4), 1, 1); blank.needsUpdate = true;
  const gamePaint = game.material.onBeforeCompile;
  paint.onBeforeCompile = (shader, renderer) => {
    gamePaint.call(game.material, shader, renderer);
    if (shader.uniforms.liveryRegistration) shader.uniforms.liveryRegistration.value = blank;
    shader.uniforms.jsgbOriginal = {value: map};
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 jsgbUv; varying vec2 vJsgbUv;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n vJsgbUv = jsgbUv; gl_Position = vec4(jsgbUv * 2. - 1., 0., 1.);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + oetf + '\nuniform sampler2D jsgbOriginal; varying vec2 vJsgbUv;')
      .replace('#include <roughnessmap_fragment>', `float jsgbLum = dot(texture2D(jsgbOriginal, vJsgbUv).rgb, vec3(.2126, .7152, .0722));
        float jsgbAround = dot(textureLod(jsgbOriginal, vJsgbUv, 4.).rgb, vec3(.2126, .7152, .0722));
        diffuseColor.rgb *= mix(1., clamp((jsgbLum + .02) / (jsgbAround + .02), .55, 1.3), DETAIL);
        gl_FragColor = vec4(jsgbOetf(diffuseColor.rgb), 1.); return;
#include <roughnessmap_fragment>`.replace('DETAIL', String(DETAIL)));
  };
  paint.customProgramCacheKey = () => 'jsgb-livery-bake-' + name;

  const W = map.image.width, H = map.image.height;
  const target = new THREE.WebGLRenderTarget(W, H, {depthBuffer: false, generateMipmaps: false});
  const scene = new THREE.Scene(), camera = new THREE.Camera();
  // Underneath: the source texture as it is (alpha 0), so texels no triangle covers keep their colour.
  const under = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({uniforms: {map: {value: map}}, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 q; void main() { q = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: oetf + '\nuniform sampler2D map; varying vec2 q; void main() { gl_FragColor = vec4(jsgbOetf(texture2D(map, q).rgb), 0.); }'}));
  const flat = new THREE.Mesh(geometry, paint);
  under.renderOrder = 0; flat.renderOrder = 1; flat.frustumCulled = false;
  scene.add(under, flat);
  const r = F.renderer, before = {target: r.getRenderTarget(), autoClear: r.autoClear, tone: r.toneMapping};
  r.setRenderTarget(target); r.autoClear = true; r.setClearColor(0x000000, 0); r.toneMapping = THREE.NoToneMapping;
  r.render(scene, camera);
  const px = new Uint8Array(W * H * 4);
  r.readRenderTargetPixels(target, 0, 0, W, H, px);
  r.setRenderTarget(before.target); r.autoClear = before.autoClear; r.toneMapping = before.tone;
  target.dispose(); paint.dispose(); geometry.dispose(); lookup.dispose(); under.material.dispose(); under.geometry.dispose(); blank.dispose();
  // Free the source model: its 4096 textures are hundreds of megabytes each, and the bake goes through every hull.
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const v of Object.values(m)) if (v?.isTexture) { v.dispose(); v.image?.close?.(); }
      m.dispose();
    }
  });
  let painted = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i]) painted++;
  // Grow the painted islands 4 texels into their margins, so filtering at a seam never mixes in unpainted colour.
  for (let pass = 0; pass < 4; pass++) {
    const copy = px.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4; if (copy[i + 3]) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = (yy * W + xx) * 4; if (!copy[j + 3]) continue;
        px[i] = copy[j]; px[i + 1] = copy[j + 1]; px[i + 2] = copy[j + 2]; px[i + 3] = 255; break;
      }
    }
  }
  for (let i = 3; i < px.length; i += 4) px[i] = 255;
  // Rows come back bottom first; the first row of the image is v = 0, as in the source texture (glTF, no flip).
  const canvas = new OffscreenCanvas(W, H);
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer), W, H), 0, 0);
  const blob = await canvas.convertToBlob({type: 'image/png'});
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return {png: btoa(binary), width: W, height: H, coverage: painted / (W * H), mask: mask.reduce((a, b) => a + b, 0) / mask.length, material: game.material.name};
}
