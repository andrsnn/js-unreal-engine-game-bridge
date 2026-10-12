// Runs inside Hard Burn's own page (Vite dev server, Tools/fidelity/bake-livery.mjs). For one override hull it loads the
// game's model through the game's own loader (scene/pixal3d.js), takes the material the game paints that hull with
// (faction colours, stripes, panels and tint: scene/hull-livery.js or the fleet paint in pixal3d.js), and draws the
// override's source model flat in its texture space through that material, with the source's own colour texture as
// the map. The result is the source's colour texture with the game's livery painted on, exactly as the browser
// computes it, including the class's registration marks (hull number and service tag).
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

// Each vertex's curvature, from how the normals turn along its edges: above 0 on convex edges and corners, below 0 in
// crevices, scaled so the sharpest 5% of the hull reach 1.
function curvature(g) {
  const p = g.attributes.position, nr = g.attributes.normal, idx = g.index, n = p.count;
  const k = new Float32Array(n), w = new Float32Array(n);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), na = new THREE.Vector3(), nb = new THREE.Vector3(), d = new THREE.Vector3();
  const edge = (i, j) => {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, j); na.fromBufferAttribute(nr, i); nb.fromBufferAttribute(nr, j);
    const l2 = d.subVectors(b, a).lengthSq(); if (l2 < 1e-14) return;
    const v = nb.sub(na).dot(d) / l2; k[i] += v; w[i]++; k[j] += v; w[j]++;
  };
  const triangles = (idx ? idx.count : n) / 3;
  for (let t = 0; t < triangles; t++) {
    const i = idx ? idx.getX(t * 3) : t * 3, j = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, l = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    edge(i, j); edge(j, l); edge(l, i);
  }
  for (let i = 0; i < n; i++) k[i] = w[i] ? k[i] / w[i] : 0;
  const sorted = Float32Array.from(k, Math.abs).sort(), s = sorted[Math.floor(sorted.length * .95)] || 1;
  for (let i = 0; i < n; i++) k[i] = Math.max(-1, Math.min(1, k[i] / s));
  return k;
}

// Each vertex's value averaged with its neighbours', the given number of times.
function smooth(g, values, times) {
  const idx = g.index, n = values.length, triangles = (idx ? idx.count : n) / 3;
  let a = values;
  for (let pass = 0; pass < times; pass++) {
    const sum = Float32Array.from(a), count = new Float32Array(n).fill(1);
    for (let t = 0; t < triangles; t++) {
      const v = [0, 1, 2].map(j => idx ? idx.getX(t * 3 + j) : t * 3 + j);
      for (const [i, j] of [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]]) { sum[i] += a[j]; count[i]++; sum[j] += a[i]; count[j]++; }
    }
    a = sum.map((s, i) => s / count[i]);
  }
  return a;
}

// The brightness of a small linear texture (a render target) at each vertex's uv.
function brightnessAt(texture, uvs, size) {
  const target = softCopies.find(t => t.texture === texture), half = new Uint16Array(size * size * 4);
  F.renderer.readRenderTargetPixels(target, 0, 0, size, size, half);
  const out = new Float32Array(uvs.length / 2), h = THREE.DataUtils.fromHalfFloat;
  for (let v = 0; v < out.length; v++) {
    const x = Math.min(size - 1, Math.max(0, Math.floor(uvs[v * 2] * size))), y = Math.min(size - 1, Math.max(0, Math.floor(uvs[v * 2 + 1] * size)));
    const i = (y * size + x) * 4;
    out[v] = .2126 * h(half[i]) + .7152 * h(half[i + 1]) + .0722 * h(half[i + 2]);
  }
  return out;
}

const paintSource = material => material.map ?? null;
// A small, soft copy of a texture (in linear light): only its large areas of colour survive.
const softCopies = [];
function downsample(texture, size) {
  const target = new THREE.WebGLRenderTarget(size, size, {type: THREE.HalfFloatType, generateMipmaps: false, depthBuffer: false});
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({uniforms: {map: {value: texture}}, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 q; void main() { q = uv; gl_Position = vec4(position.xy, 0., 1.); }',
    fragmentShader: 'uniform sampler2D map; varying vec2 q; void main() { gl_FragColor = vec4(textureLod(map, q, 3.).rgb, 1.); }'}));
  const scene = new THREE.Scene(); scene.add(quad);
  const r = F.renderer, before = r.getRenderTarget();
  r.setRenderTarget(target); r.render(scene, new THREE.Camera()); r.setRenderTarget(before);
  quad.geometry.dispose(); quad.material.dispose();
  target.texture.colorSpace = THREE.NoColorSpace;
  softCopies.push(target);
  return target.texture;
}

// The clean style's hull panelling and wear, in the ship's own frame and game units. The hull is cut into sections a
// tenth of the ship's length, and each section is split at random two or three times, so panels are large, vary in
// size and line up like real plating, not like bricks. Seams are thin; some panels carry an access hatch or a vent;
// grime collects along seams and in crevices, and paint chips off convex edges.
const CLEAN_FUNCTIONS = `
float jsgbHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float jsgbNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(jsgbHash(i), jsgbHash(i + vec2(1., 0.)), f.x), mix(jsgbHash(i + vec2(0., 1.)), jsgbHash(i + vec2(1., 1.)), f.x), f.y); }
// The panel at p: its corners lo and hi, from a section of size S split up to three times along its longer side.
void jsgbPanel(vec2 p, float S, out vec2 lo, out vec2 hi) {
  lo = floor(p / S) * S; hi = lo + S;
  for (int i = 0; i < 3; i++) {
    vec2 size = hi - lo;
    if (i > 0 && jsgbHash(lo * .731 + float(i) * 3.17) < .3) break;
    float t = .28 + .44 * jsgbHash(lo * 1.913 + float(i) * 7.31);
    if (size.x >= size.y) { float m = lo.x + size.x * t; if (p.x < m) hi.x = m; else lo.x = m; }
    else { float m = lo.y + size.y * t; if (p.y < m) hi.y = m; else lo.y = m; }
  }
}`;
const CLEAN_PAINT = `{
  vec3 P = vJsgbPos, N = normalize(vJsgbNormal), A = abs(N);
  vec2 q = A.x > A.y && A.x > A.z ? P.zy : A.y > A.z ? P.xz : P.xy;
  float S = clamp(jsgbShipLength / 10., 1.5, 80.);
  vec2 lo, hi; jsgbPanel(q, S, lo, hi);
  vec2 size = hi - lo, local = (q - lo) / size;
  float px = max(length(fwidth(q)), 1e-5);
  float edge = min(min(q.x - lo.x, hi.x - q.x), min(q.y - lo.y, hi.y - q.y));
  float seamWidth = max(S * .004, px * .7);
  float seam = 1. - smoothstep(seamWidth, seamWidth + px, edge);
  float grain = jsgbNoise(q / S * 40.) * .6 + jsgbNoise(q / S * 9.) * .4;
  vec3 c = diffuseColor.rgb * (1. + (jsgbHash(lo) - .5) * .05);
  c *= 1. - .14 * (1. - smoothstep(seamWidth, seamWidth + S * .06, edge)) * (.5 + .5 * grain);
  c *= 1. - .5 * seam;
  float kind = jsgbHash(lo + 17.3), small = min(size.x, size.y);
  if (kind < .22 && small > S * .25) {
    vec2 centre = lo + size * vec2(.3 + .4 * jsgbHash(lo + 2.1), .3 + .4 * jsgbHash(lo + 4.7));
    vec2 ext = vec2(small * .16, small * .11);
    vec2 d = abs(q - centre) - ext; float box = max(d.x, d.y);
    c *= 1. - .45 * (1. - smoothstep(seamWidth * .8, seamWidth * .8 + px, abs(box)));
    if (box < 0.) c *= .94;
  } else if (kind > .86 && small > S * .25) {
    vec2 centre = lo + size * vec2(.5, .3 + .4 * jsgbHash(lo + 8.9));
    vec2 ext = vec2(small * .2, small * .09);
    vec2 d = abs(q - centre) - ext;
    if (max(d.x, d.y) < 0.) { float slats = smoothstep(.35, .5, abs(fract((q.y - centre.y) / (ext.y * .4)) - .5)); c *= .55 + .3 * slats; }
  }
  float chip = smoothstep(.35, .95, vJsgbCurvature) * smoothstep(.45, .75, grain);
  c = mix(c, vec3(.36, .37, .39) * (.85 + .3 * grain), chip * .65);
  c *= 1. - .35 * smoothstep(.15, .8, -vJsgbCurvature) * (.6 + .4 * grain);
  float o = dot(texture2D(jsgbOriginal, vJsgbUv).rgb, vec3(.2126, .7152, .0722));
  float oa = dot(textureLod(jsgbOriginal, vJsgbUv, 4.).rgb, vec3(.2126, .7152, .0722));
  c *= mix(1., clamp((o + .02) / (oa + .02), .7, 1.2), .08);
  diffuseColor.rgb = c;
}`;

export async function bake(name, key, sourceUrl, style = 'clean') {
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

  // The clean style paints the hull fresh instead of carrying over the source's smeared texture: the game's colours
  // from a small copy of its texture (so only its large areas of colour come through), plating laid out in the hull's
  // own coordinates, and wear where the shape says it belongs (convex edges chip, crevices collect grime).
  const clean = style === 'clean';
  let blurred = null;
  if (clean) {
    // Curvature averaged over each vertex's neighbours twice, so the generator's surface noise doesn't read as edges.
    const bend = smooth(geometry, curvature(geometry), 2);
    geometry.setAttribute('jsgbCurvature', new THREE.BufferAttribute(bend, 1));
    blurred = downsample(paintSource(game.material) ?? map, 256);
    // Paint goes on every broad, smooth, light part of the hull, not only on the game's plates: the game's plate mask
    // comes from its low-detail model and leaves most of the detailed one unpainted. Dark machinery keeps its colour.
    const light = brightnessAt(blurred, gameUv, 256);
    for (let v = 0; v < n; v++) {
      const flat = 1 - Math.min(1, Math.max(0, (Math.abs(bend[v]) - .15) / .35));
      const pale = Math.min(1, Math.max(0, (light[v] - .18) / .17));
      weight[v] = Math.max(weight[v], flat * pale);
    }
    geometry.attributes.hullPaintWeight.needsUpdate = true;
  }
  game.geometry.computeBoundingBox();
  // The plating's frame: the ship's own (the game's model placed in its hull frame, in game units, as the livery uses).
  let root = level; while (root.parent) root = root.parent;
  root.updateMatrixWorld(true);
  const frame = game.matrixWorld.clone();
  const shipLength = Math.max(...game.geometry.boundingBox.clone().applyMatrix4(frame).getSize(new THREE.Vector3()).toArray());

  // The game's material for this hull, with its own texture, drawn at each texel's place in the source's texture. The
  // source's fine detail (each texel's brightness against its neighbourhood's) is multiplied in, so the colours stay
  // the game's and the detail is the original's.
  const paint = game.material.clone();
  for (const slot of ['normalMap', 'aoMap', 'emissiveMap', 'lightMap', 'bumpMap', 'envMap']) paint[slot] = null;
  if (!paint.map) paint.map = map;
  if (clean) paint.map = blurred;
  paint.side = THREE.DoubleSide; paint.depthTest = paint.depthWrite = false; paint.transparent = false;
  const gamePaint = game.material.onBeforeCompile;
  paint.onBeforeCompile = (shader, renderer) => {
    gamePaint.call(game.material, shader, renderer);
    // The registration marks (hull number and service tag) belong to the class, so they go into its texture. Drawn
    // flat in texture space, screen derivatives mean nothing, so a mark faces the way the vertex normal does.
    shader.fragmentShader = shader.fragmentShader.replace('vec3 faceNormal=normalize(cross(dFdx(liveryPosition),dFdy(liveryPosition)));', 'vec3 faceNormal=normalize(liveryNormal);')
      .replace('if(!gl_FrontFacing)faceNormal=-faceNormal;', '');
    shader.uniforms.jsgbOriginal = {value: map};
    shader.uniforms.jsgbFrame = {value: frame};
    shader.uniforms.jsgbShipLength = {value: shipLength};
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 jsgbUv; varying vec2 vJsgbUv;' +
        (clean ? '\nattribute float jsgbCurvature; varying float vJsgbCurvature; varying vec3 vJsgbPos, vJsgbNormal; uniform mat4 jsgbFrame;' : ''))
      .replace('#include <project_vertex>', '#include <project_vertex>\n vJsgbUv = jsgbUv; gl_Position = vec4(jsgbUv * 2. - 1., 0., 1.);' +
        (clean ? '\n vJsgbCurvature = jsgbCurvature; vJsgbPos = (jsgbFrame * vec4(position, 1.)).xyz; vJsgbNormal = mat3(jsgbFrame) * normal;' : ''));
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + oetf + '\nuniform sampler2D jsgbOriginal; varying vec2 vJsgbUv;' +
        (clean ? '\nvarying float vJsgbCurvature; varying vec3 vJsgbPos, vJsgbNormal; uniform float jsgbShipLength;\n' + CLEAN_FUNCTIONS : ''))
      .replace('#include <roughnessmap_fragment>', (clean ? CLEAN_PAINT : `float jsgbLum = dot(texture2D(jsgbOriginal, vJsgbUv).rgb, vec3(.2126, .7152, .0722));
        float jsgbAround = dot(textureLod(jsgbOriginal, vJsgbUv, 4.).rgb, vec3(.2126, .7152, .0722));
        diffuseColor.rgb *= mix(1., clamp((jsgbLum + .02) / (jsgbAround + .02), .55, 1.3), DETAIL);`.replace('DETAIL', String(DETAIL))) + `
        gl_FragColor = vec4(jsgbOetf(diffuseColor.rgb), 1.); return;
#include <roughnessmap_fragment>`);
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
  target.dispose(); paint.dispose(); geometry.dispose(); lookup.dispose(); for (const t of softCopies.splice(0)) t.dispose(); under.material.dispose(); under.geometry.dispose();
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
