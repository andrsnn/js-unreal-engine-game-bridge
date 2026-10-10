import * as THREE from 'three-real';
import {host, assetRegistry, registrySwaps, type SceneSink} from './host';
import {lastFrame, post} from './renderer';
import {translateShaderMaterial} from './shaders';
import {channelFor, isExtraAttribute} from './attributes';

/** Mirrors the game's Three.js scene into Unreal each frame. Geometry, materials and textures are
 *  sent once and again only when their version changes; transforms, instances, lights and the
 *  camera are sent every frame as one float stream. Coordinates stay in Three.js space (Y up,
 *  right-handed); the host converts. Objects whose userData names a registry key are swapped for
 *  the registry's Unreal mesh (userData.assetKey) or Niagara system (userData.vfxKey). */

const sink = (): SceneSink | undefined => host.sink;

// Record kinds in the frame stream. Keep in sync with JsgbSceneMirror.cpp.
export const MESH = 1, INSTANCED = 2, LIGHT = 3, SPRITE = 4, POINTS = 5, LINES = 6, ASSET = 7, EFFECT = 8;
export const HEADER_FLOATS = 88;
const LIGHT_KIND: Record<string, number> = {DirectionalLight: 1, PointLight: 2, SpotLight: 3, AmbientLight: 4, HemisphereLight: 5, RectAreaLight: 6};

let nextId = 1;
const ids = new WeakMap<object, number>();
const traced = new WeakSet<object>();
const idOf = (o: object) => { let id = ids.get(o); if (!id) { id = nextId++; ids.set(o, id); } return id; };

// Registry keys travel as small integers; the host learns each name once through events().
const keyIds = new Map<string, number>();
let pendingEvents: unknown[] = [];
function keyId(key: string) {
  let id = keyIds.get(key);
  if (!id) { id = keyIds.size + 1; keyIds.set(key, id); pendingEvents.push({kind: 'key', id, key}); }
  return id;
}
/** Queues a one-shot event for the host (effect, sound, cameraShake, decal) by registry key. */
export function emitEvent(kind: string, key: string, parameters: Record<string, unknown> = {}, matrix?: ArrayLike<number>) {
  pendingEvents.push({kind, key, parameters, ...(matrix ? {matrix: Array.from(matrix)} : {})});
}

const geometrySig = new Map<number, string>();
const geometryRefs = new Map<number, WeakRef<THREE.BufferGeometry>>();
const materialSig = new Map<number, string>();
const textureSig = new Map<number, number>();
const sentShaders = new Set<string>();
const instanceVersion = new WeakMap<object, string>();

let floats = new Float32Array(1 << 16), n = 0;
let inst = new Float32Array(1 << 16), ni = 0;
function push(v: number) { if (n >= floats.length) { const f = new Float32Array(floats.length * 2); f.set(floats); floats = f; } floats[n++] = v; }
function pushMatrix(m: THREE.Matrix4) { const e = m.elements; for (let i = 0; i < 16; i++) push(e[i]); }
function reserveInst(k: number) { if (ni + k > inst.length) { let size = inst.length * 2; while (size < ni + k) size *= 2; const f = new Float32Array(size); f.set(inst.subarray(0, ni)); inst = f; } }

function attributeArray(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, size: number): Float32Array {
  const count = attr.count, out = new Float32Array(count * size);
  const plain = !(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute && attr.array instanceof Float32Array && attr.itemSize === size && !attr.normalized;
  if (plain) { out.set((attr.array as Float32Array).subarray(0, count * size)); return out; }
  for (let i = 0; i < count; i++) {
    out[i * size] = attr.getX(i); if (size > 1) out[i * size + 1] = attr.getY(i);
    if (size > 2) out[i * size + 2] = attr.getZ(i); if (size > 3) out[i * size + 3] = attr.itemSize > 3 ? attr.getW(i) : 1;
  }
  return out;
}

/** primitive: 0 triangles, 1 points, 2 line segments, 3 line strip, 4 line loop. */
function syncGeometry(geo: THREE.BufferGeometry, primitive = 0): number {
  const id = idOf(geo);
  const a = geo.attributes, idx = geo.index;
  const extras = Object.entries(a).filter(([name, attr]) => isExtraAttribute(name) && attr.itemSize <= 4);
  const sig = `${primitive}|${a.position?.version}|${a.position?.count}|${a.normal?.version}|${a.uv?.version}|${a.color?.version}|${idx?.version}|${idx?.count}|${geo.drawRange.start},${geo.drawRange.count}|${geo.groups.length}|${extras.map(([n, x]) => n + x.version).join(',')}`;
  if (geometrySig.get(id) === sig) return id;
  const out = sink();
  if (!a.position || !out) return 0;
  if (!geometryRefs.has(id)) geo.addEventListener('dispose', () => { geometryRefs.delete(id); geometrySig.delete(id); sink()?.releaseGeometry(id); });
  geometrySig.set(id, sig); geometryRefs.set(id, new WeakRef(geo));
  if (primitive === 0 && !a.normal && a.position.count < 2_000_000) { try { geo.computeVertexNormals(); } catch { /* degenerate */ } }
  const pos = attributeArray(a.position, 3);
  const nrm = a.normal ? attributeArray(a.normal, 3) : null;
  let uv = a.uv ? attributeArray(a.uv, 2) : null;
  // Extra attributes ride in UV channels 1-7, interleaved per vertex after UV 0.
  const placed = extras.map(([name, attr]) => ({attr, slot: channelFor(name, attr.itemSize)})).filter(x => x.slot);
  let uvChannels = 1;
  for (const {slot} of placed) uvChannels = Math.max(uvChannels, slot!.channel + (slot!.size > 2 ? 2 : 1));
  if (uvChannels > 1) {
    const n = a.position.count, packed = new Float32Array(n * 2 * uvChannels);
    if (uv) for (let i = 0; i < n; i++) { packed[i * 2 * uvChannels] = uv[i * 2]; packed[i * 2 * uvChannels + 1] = uv[i * 2 + 1]; }
    for (const {attr, slot} of placed) {
      const values = attributeArray(attr, slot!.size);
      for (let i = 0; i < n; i++) for (let k = 0; k < slot!.size; k++) packed[i * 2 * uvChannels + slot!.channel * 2 + k] = values[i * slot!.size + k];
    }
    uv = packed;
  }
  const colorSize = a.color ? Math.min(4, a.color.itemSize) : 0;
  const col = a.color ? attributeArray(a.color, colorSize) : null;
  let indices: Uint32Array | null = null;
  if (idx) { indices = new Uint32Array(idx.count); for (let i = 0; i < idx.count; i++) indices[i] = idx.getX(i); }
  const start = geo.drawRange.start, count = geo.drawRange.count;
  const groups = JSON.stringify({groups: geo.groups.map(gr => [gr.start, gr.count, gr.materialIndex ?? 0]), drawStart: start, drawCount: Number.isFinite(count) ? count : -1, primitive, uvChannels});
  out.geometry(id, pos.buffer, nrm?.buffer ?? null, uv?.buffer ?? null, col?.buffer ?? null, colorSize, indices?.buffer ?? null, groups);
  return id;
}

function rgba8(w: number, h: number, data: ArrayLike<number>, channels: number, tex: THREE.Texture): Uint8Array {
  const px = w * h, out = new Uint8Array(px * 4);
  const isByte = data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  const isHalf = tex.type === THREE.HalfFloatType && data instanceof Uint16Array;
  for (let i = 0; i < px; i++) for (let c = 0; c < 4; c++) {
    let v = c < channels ? data[i * channels + c] : c === 3 ? (isByte ? 255 : 1) : (channels === 1 ? data[i * channels] : 0);
    if (isHalf && c < channels) v = THREE.DataUtils.fromHalfFloat(v);
    out[i * 4 + c] = isByte ? v : Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return out;
}

function textureSource(tex: THREE.Texture): {json: Record<string, unknown>; bytes: ArrayBuffer | null} | null {
  const img = tex.image as Record<string, any> | undefined;
  const base = {wrapS: tex.wrapS, wrapT: tex.wrapT, repeat: [tex.repeat.x, tex.repeat.y], offset: [tex.offset.x, tex.offset.y], rotation: tex.rotation, flipY: tex.flipY,
    srgb: tex.colorSpace === THREE.SRGBColorSpace, nearest: tex.magFilter === THREE.NearestFilter, name: tex.name, mapping: tex.mapping};
  const channelsOf = (format: number) => format === THREE.RedFormat ? 1 : format === THREE.RGFormat ? 2 : (format as number) === 1022 /* RGBFormat */ ? 3 : 4;
  // Compressed containers transcoded to plain RGBA (KTX2 with no GPU formats advertised).
  const mip = (tex as THREE.CompressedTexture).mipmaps?.[0] as Record<string, any> | undefined;
  if ((tex as THREE.CompressedTexture).isCompressedTexture) {
    if (mip?.data && tex.format === THREE.RGBAFormat) return {json: {...base, kind: 'rgba8', width: mip.width, height: mip.height}, bytes: rgba8(mip.width, mip.height, mip.data, 4, tex).buffer as ArrayBuffer};
    return null;
  }
  if (!img) return null;
  const pixels = img.__ctx?.bitmap?.() ?? img.__pixels;
  if (pixels && pixels.width && pixels.height) return {json: {...base, kind: 'rgba8', width: pixels.width, height: pixels.height}, bytes: (pixels.data as Uint8ClampedArray).slice().buffer};
  if (img.__jsgbAsset) return {json: {...base, kind: 'file', path: img.__jsgbAsset}, bytes: null};
  if (img.__bytes) return {json: {...base, kind: 'encoded'}, bytes: (img.__bytes as Uint8Array).slice().buffer};
  if ((tex as THREE.Data3DTexture).isData3DTexture && img.data && img.width && img.height && img.depth) {
    return {json: {...base, kind: 'rgba8_3d', width: img.width, height: img.height, depth: img.depth},
      bytes: rgba8(img.width * img.height, img.depth, img.data, channelsOf(tex.format), tex).buffer as ArrayBuffer};
  }
  if (img.data && img.width && img.height) {
    return {json: {...base, kind: 'rgba8', width: img.width, height: img.height}, bytes: rgba8(img.width, img.height, img.data, channelsOf(tex.format), tex).buffer as ArrayBuffer};
  }
  return null;
}

const textureOk = new Map<number, boolean>();
function textureId(tex: THREE.Texture | null | undefined): number {
  if (!tex) return 0;
  const id = idOf(tex);
  if (textureSig.get(id) !== tex.version) {
    textureSig.set(id, tex.version);
    let src = null;
    try { src = textureSource(tex); } catch (error) { host.log('warn', `texture ${tex.name || id}: ${error}`); }
    textureOk.set(id, !!src);
    if (src) sink()?.texture(id, JSON.stringify(src.json), src.bytes);
  }
  return textureOk.get(id) ? id : 0;
}

function colorOf(c: THREE.Color | undefined, fallback = [1, 1, 1]) { return c ? [c.r, c.g, c.b] : fallback; }
function uniformColor(m: THREE.ShaderMaterial): number[] | undefined {
  const u = m.uniforms ?? {};
  for (const k of ['diffuse', 'color', 'uColor', 'baseColor', 'tint', 'uTint']) { const v = u[k]?.value; if (v?.isColor) return [v.r, v.g, v.b]; if (v?.isVector3) return [v.x, v.y, v.z]; }
  return undefined;
}
function uniformTexture(m: THREE.ShaderMaterial): number {
  const u = m.uniforms ?? {};
  for (const k of ['map', 'tDiffuse', 'uMap', 'uTexture', 'texture1', 'diffuseMap']) { const v = u[k]?.value; if (v?.isTexture) return textureId(v); }
  return 0;
}

/** Uniform values as plain data: numbers, vectors, colours, and textures as {tex: id}. */
function uniformValues(uniforms: Record<string, {value: unknown}> | undefined, out: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [k, u] of Object.entries(uniforms ?? {})) {
    const v = u?.value as any;
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = +v;
    else if (v?.isColor) out[k] = [v.r, v.g, v.b];
    else if (v?.isVector2) out[k] = [v.x, v.y];
    else if (v?.isVector3) out[k] = [v.x, v.y, v.z];
    else if (v?.isVector4) out[k] = [v.x, v.y, v.z, v.w];
    else if (v?.isTexture) { const id = textureId(v); if (id) out[k] = {tex: id}; }
  }
  return out;
}

/** Materials patched with onBeforeCompile add uniforms inside the hook. Run the hook once against
 *  three's own shader sources (as WebGLRenderer would at compile time) and keep the uniforms it adds,
 *  so Unreal materials can implement those features by name. */
const SHADER_LIB: Record<string, string> = {MeshStandardMaterial: 'standard', MeshPhysicalMaterial: 'physical', MeshLambertMaterial: 'lambert', MeshPhongMaterial: 'phong',
  MeshBasicMaterial: 'basic', MeshToonMaterial: 'toon', MeshMatcapMaterial: 'matcap', MeshNormalMaterial: 'normal', MeshDepthMaterial: 'depth', PointsMaterial: 'points', SpriteMaterial: 'sprite', LineBasicMaterial: 'basic'};
const hookCache = new WeakMap<THREE.Material, {key: string; uniforms: Record<string, {value: unknown}>}>();
const defaultHook = THREE.Material.prototype.onBeforeCompile;
const hookRenderer = {capabilities: {isWebGL2: true, maxTextures: 16, precision: 'highp'}, extensions: {has: () => false, get: () => null}, getRenderTarget: () => null};
function hookUniforms(mat: THREE.Material): Record<string, {value: unknown}> | undefined {
  if (mat.onBeforeCompile === defaultHook || (mat as THREE.ShaderMaterial).isShaderMaterial) return undefined;
  let key = '';
  try { key = `${mat.version}|${mat.customProgramCacheKey?.() ?? ''}`; } catch { key = String(mat.version); }
  const cached = hookCache.get(mat);
  if (cached && cached.key === key) return cached.uniforms;
  const lib = (THREE.ShaderLib as Record<string, {vertexShader: string; fragmentShader: string}>)[SHADER_LIB[mat.type] ?? 'standard'];
  const shader = {uniforms: {} as Record<string, {value: unknown}>, vertexShader: lib?.vertexShader ?? '', fragmentShader: lib?.fragmentShader ?? '', defines: {}, shaderName: mat.type};
  try { mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, hookRenderer as unknown as THREE.WebGLRenderer); } catch { /* hooks that need a real renderer keep their defaults */ }
  hookCache.set(mat, {key, uniforms: shader.uniforms});
  return shader.uniforms;
}

/** A short stable name for a custom shader, so the registry can map it to an Unreal material. */
function shaderKey(m: THREE.ShaderMaterial): string {
  if (m.name) return m.name;
  let h = 0; const s = (m.fragmentShader ?? '') + (m.vertexShader ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'shader_' + (h >>> 0).toString(16);
}

function syncMaterial(mat: THREE.Material): number {
  const id = idOf(mat);
  const m = mat as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial & THREE.ShaderMaterial & THREE.MeshBasicMaterial & THREE.PointsMaterial;
  const shader = !!m.isShaderMaterial;
  const registryKey = mat.userData?.materialKey ?? mat.userData?.assetMaterialKey ?? (shader ? shaderKey(m) : undefined);
  const registryMaterial = registryKey ? assetRegistry()[registryKey]?.material : undefined;
  // Custom shaders without a registry material become generated Unreal materials.
  let custom: string | undefined;
  if (shader && !registryMaterial) {
    const t = translateShaderMaterial(m);
    if (t) { if (!sentShaders.has(t.key)) { sentShaders.add(t.key); sink()?.shader?.(t.key, JSON.stringify(t)); } custom = t.key; }
  }
  const desc = {
    type: mat.type, name: mat.name,
    color: shader ? uniformColor(m) ?? [0.7, 0.7, 0.7] : colorOf(m.color),
    emissive: m.emissive ? colorOf(m.emissive) : [0, 0, 0], emissiveIntensity: m.emissiveIntensity ?? 1,
    roughness: m.roughness ?? (mat.type === 'MeshBasicMaterial' ? 1 : 0.8), metalness: m.metalness ?? 0,
    opacity: mat.opacity, transparent: mat.transparent, alphaTest: mat.alphaTest, side: mat.side,
    vertexColors: !!mat.vertexColors, unlit: shader || ['MeshBasicMaterial', 'SpriteMaterial', 'PointsMaterial', 'LineBasicMaterial', 'LineDashedMaterial'].includes(mat.type),
    blending: mat.blending, depthWrite: mat.depthWrite, depthTest: mat.depthTest, colorWrite: mat.colorWrite, wireframe: !!m.wireframe,
    map: shader ? uniformTexture(m) : textureId(m.map), emissiveMap: textureId(m.emissiveMap), normalMap: textureId(m.normalMap), roughnessMap: textureId(m.roughnessMap),
    metalnessMap: textureId(m.metalnessMap), aoMap: textureId(m.aoMap), alphaMap: textureId(m.alphaMap),
    flat: !!m.flatShading, toneMapped: mat.toneMapped, fog: m.fog !== false,
    shader, shaderKey: shader ? registryKey : undefined, registryMaterial, custom,
    uniforms: shader ? uniformValues(m.uniforms as Record<string, {value: unknown}>) : (hookUniforms(mat) ? uniformValues(hookUniforms(mat)) : undefined),
    specular: mat.type === 'MeshLambertMaterial' || mat.type === 'MeshToonMaterial' ? 0 : mat.type === 'MeshPhongMaterial' ? 0.3 : 0.5,
    envIntensity: m.envMapIntensity ?? 1, alphaHash: !!m.alphaHash,
    size: m.size, sizeAttenuation: m.sizeAttenuation, linewidth: (m as unknown as THREE.LineBasicMaterial).linewidth,
    clearcoat: m.clearcoat ?? 0, transmission: m.transmission ?? 0, ior: m.ior ?? 1.5,
    tags: Object.keys(mat.userData ?? {}).filter(k => typeof mat.userData[k] !== 'object').slice(0, 8),
  };
  const sig = JSON.stringify(desc);
  if (materialSig.get(id) !== sig) { materialSig.set(id, sig); sink()?.material(id, sig); }
  return id;
}

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const visibleTo = (o: THREE.Object3D, cam: THREE.Camera) => o.layers.test(cam.layers);
const flagsOf = (o: THREE.Object3D) => (o.castShadow ? 1 : 0) | (o.receiveShadow ? 2 : 0) | (o.frustumCulled ? 0 : 4) | ((o as THREE.SkinnedMesh).isSkinnedMesh ? 8 : 0);
const materialsOf = (o: THREE.Mesh) => (Array.isArray(o.material) ? o.material : [o.material]) as THREE.Material[];

function emitInstances(im: THREE.InstancedMesh, gid: number, mat: number) {
  const count = im.count; if (count <= 0) return;
  const version = `${im.instanceMatrix.version}|${count}|${im.instanceColor?.version ?? -1}|${gid}`;
  const changed = instanceVersion.get(im) !== version;
  push(INSTANCED); push(idOf(im)); push(gid); push(mat); push(flagsOf(im)); push(count); pushMatrix(im.matrixWorld);
  push(changed ? 1 : 0); push(changed && im.instanceColor ? 1 : 0);
  if (changed) {
    instanceVersion.set(im, version);
    const k = count * 16 + (im.instanceColor ? count * 3 : 0); reserveInst(k);
    push(ni);
    inst.set(im.instanceMatrix.array.subarray(0, count * 16) as Float32Array, ni); ni += count * 16;
    if (im.instanceColor) { inst.set((im.instanceColor.array as Float32Array).subarray(0, count * 3), ni); ni += count * 3; }
  } else push(-1);
}

function emitMesh(o: THREE.Mesh) {
  const geo = o.geometry; if (!geo?.attributes?.position) return;
  const mats = materialsOf(o);
  if (!mats.length || mats.every(m => !m || !m.visible || m.colorWrite === false)) return;
  const gid = syncGeometry(geo); if (!gid) return;
  if ((o as THREE.InstancedMesh).isInstancedMesh) { emitInstances(o as THREE.InstancedMesh, gid, syncMaterial(mats[0])); return; }
  push(MESH); push(idOf(o)); push(gid); push(flagsOf(o)); push(mats.length);
  for (const m of mats) push(m ? syncMaterial(m) : 0);
  pushMatrix(o.matrixWorld);
}

function emitPrimitive(o: THREE.Points | THREE.Line, kind: number, primitive: number) {
  const geo = o.geometry; const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material;
  if (!geo?.attributes?.position || !mat?.visible) return;
  const gid = syncGeometry(geo, primitive); if (!gid) return;
  push(kind); push(idOf(o)); push(gid); push(syncMaterial(mat)); push(flagsOf(o)); pushMatrix(o.matrixWorld);
}

function emitLight(l: THREE.Light) {
  const kind = LIGHT_KIND[l.type]; if (!kind) return;
  push(LIGHT); push(idOf(l)); push(kind); push(l.color.r); push(l.color.g); push(l.color.b); push(l.intensity);
  l.getWorldPosition(tmpV); push(tmpV.x); push(tmpV.y); push(tmpV.z);
  const target = (l as THREE.DirectionalLight).target;
  if (target) { target.updateMatrixWorld(); target.getWorldPosition(tmpV2); tmpV2.sub(tmpV).normalize(); } else tmpV2.set(0, -1, 0);
  push(tmpV2.x); push(tmpV2.y); push(tmpV2.z);
  const p = l as THREE.SpotLight & THREE.PointLight;
  push(p.distance ?? 0); push(p.decay ?? 2); push(p.angle ?? 0); push(p.penumbra ?? 0); push(l.castShadow ? 1 : 0);
  const ground = (l as THREE.HemisphereLight).groundColor; push(ground?.r ?? 0); push(ground?.g ?? 0); push(ground?.b ?? 0);
}

function emitSprite(s: THREE.Sprite) {
  const mat = s.material; if (!mat?.visible) return;
  push(SPRITE); push(idOf(s)); push(syncMaterial(mat));
  s.getWorldPosition(tmpV); push(tmpV.x); push(tmpV.y); push(tmpV.z);
  s.getWorldScale(tmpV2); push(tmpV2.x); push(tmpV2.y); push(mat.rotation ?? 0);
}

/** Registry swap for an object: an Unreal mesh (assetKey) or a Niagara system (vfxKey). */
/** Swaps are opt-in per game (Games/<game>.json "swaps"): the game's own objects are what the
 *  browser shows, and a registry mesh or Niagara system only matches when the game says it does. */
function registrySwap(o: THREE.Object3D): {kind: number; key: string} | null {
  const data = o.userData; if (!data) return null;
  const reg = assetRegistry(), swaps = registrySwaps();
  if (swaps.effects && typeof data.vfxKey === 'string' && reg[data.vfxKey]?.niagara) return {kind: EFFECT, key: data.vfxKey};
  const assetKey = swaps.assets ? (typeof data.assetKey === 'string' ? data.assetKey : typeof data.glbKey === 'string' ? data.glbKey : null) : null;
  if (assetKey && reg[assetKey]?.mesh) return {kind: ASSET, key: assetKey};
  return null;
}
function hasContentTag(o: THREE.Object3D, key: string): boolean {
  if (o.userData?.assetContent === key) return true;
  for (const c of o.children) if (hasContentTag(c, key)) return true;
  return false;
}

function walk(o: THREE.Object3D, cam: THREE.Camera, skipKey: string | null) {
  if (!o.visible) return;
  if ((o as THREE.LOD).isLOD && (o as THREE.LOD).autoUpdate) (o as THREE.LOD).update(cam);
  // Geometry that an imported Unreal asset replaces is tagged with assetContent; runtime
  // attachments under the same root (mounts, plumes) stay ordinary objects.
  const replaced = skipKey !== null && o.userData?.assetContent === skipKey;
  let childSkip = skipKey;
  if (!replaced && visibleTo(o, cam)) {
    if (host.trace && !traced.has(o) && ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints || (o as THREE.Sprite).isSprite || (o as THREE.Line).isLine)) {
      traced.add(o);
      const g = (o as THREE.Mesh).geometry, m = materialsOf(o as THREE.Mesh)[0];
      host.log('log', `TRACE id ${idOf(o)} ${o.type} "${o.name}" uuid ${o.uuid} parent "${o.parent?.name ?? ''}" geometry ${g ? idOf(g) : 0} ${g?.type ?? ''} material ${m ? idOf(m) : 0} ${m?.type ?? ''}`);
    }
    const swap = registrySwap(o);
    if (swap?.kind === EFFECT) { push(EFFECT); push(idOf(o)); push(keyId(swap.key)); pushMatrix(o.matrixWorld); return; }
    if (swap?.kind === ASSET) {
      const mats = (o as THREE.Mesh).material ? materialsOf(o as THREE.Mesh) : [];
      if ((o as THREE.InstancedMesh).isInstancedMesh) { emitInstances(o as THREE.InstancedMesh, -keyId(swap.key), mats[0] ? syncMaterial(mats[0]) : 0); return; }
      push(ASSET); push(idOf(o)); push(keyId(swap.key)); push(mats[0] ? syncMaterial(mats[0]) : 0); pushMatrix(o.matrixWorld);
      // Untagged models are replaced whole; tagged ones keep their untagged attachments.
      if (!hasContentTag(o, swap.key)) return;
      childSkip = swap.key;
    } else if ((o as THREE.Mesh).isMesh) emitMesh(o as THREE.Mesh);
    else if ((o as THREE.Points).isPoints) emitPrimitive(o as THREE.Points, POINTS, 1);
    else if ((o as THREE.Line).isLine) emitPrimitive(o as THREE.Line, LINES, (o as THREE.LineSegments).isLineSegments ? 2 : (o as THREE.LineLoop).isLineLoop ? 4 : 3);
    else if ((o as THREE.Light).isLight) emitLight(o as THREE.Light);
    else if ((o as THREE.Sprite).isSprite) emitSprite(o as THREE.Sprite);
  }
  const ch = o.children; for (let i = 0; i < ch.length; i++) walk(ch[i], cam, childSkip);
}

let sweep = 0;
/** Sends this frame to the host. Returns the number of floats written (0 when nothing to draw). */
export function exportFrame(): number {
  const out = sink(); if (!out) return 0;
  const scene = lastFrame.scene as THREE.Scene | null;
  const cam = lastFrame.camera as THREE.PerspectiveCamera & THREE.OrthographicCamera | null;
  if (!scene || !cam) return 0;
  let top: THREE.Object3D = scene; while (top.parent) top = top.parent;
  top.updateMatrixWorld();
  cam.updateMatrixWorld();
  n = 0; ni = 0;
  // Header (HEADER_FLOATS): camera, background, fog, environment, post-processing.
  pushMatrix(cam.matrixWorld);
  push(cam.isPerspectiveCamera ? cam.fov : 0); push(cam.isPerspectiveCamera ? cam.aspect : (cam.right - cam.left) / Math.max(1e-6, cam.top - cam.bottom));
  push(cam.near); push(cam.far); push(cam.isOrthographicCamera ? 1 : 0); push(cam.isOrthographicCamera ? (cam.top - cam.bottom) / 2 / cam.zoom : 0);
  const sc = top as THREE.Scene;
  const bg = sc.background as (THREE.Color & THREE.Texture) | null;
  push(bg?.isColor ? 1 : 0); push(bg?.isColor ? bg.r : 0); push(bg?.isColor ? bg.g : 0); push(bg?.isColor ? bg.b : 0);
  const fog = sc.fog as (THREE.Fog & THREE.FogExp2) | null;
  push(fog ? (fog.isFogExp2 ? 2 : 1) : 0); push(fog?.color.r ?? 0); push(fog?.color.g ?? 0); push(fog?.color.b ?? 0);
  push(fog?.near ?? 0); push(fog?.far ?? 0); push(fog?.density ?? 0);
  push(bg?.isTexture ? textureId(bg) : 0); push(sc.environment ? textureId(sc.environment) : 0);
  push(post.exposure); push(post.toneMapping);
  const bloomLive = post.bloomFrame >= lastFrame.frame - 2;
  push(bloomLive ? post.bloomStrength : 0); push(post.bloomRadius); push(post.bloomThreshold);
  pushMatrix(cam.matrixWorldInverse); pushMatrix(cam.projectionMatrix); pushMatrix(cam.projectionMatrixInverse);
  if (n !== HEADER_FLOATS) throw Error('scene header layout changed');
  walk(top, cam, null);
  if (cam.parent === null && cam !== top) walk(cam, cam, null);
  if (pendingEvents.length && out.events) { const events = pendingEvents; pendingEvents = []; out.events(JSON.stringify(events)); }
  out.frame(floats.buffer, n, inst.buffer, ni);
  // Release geometry the game has dropped (checked every few seconds).
  if (++sweep % 300 === 0) for (const [id, ref] of geometryRefs) if (!ref.deref()) { geometryRefs.delete(id); geometrySig.delete(id); out.releaseGeometry(id); }
  return n;
}

/** Debug summary of what the exporter sees: material kinds, shader materials, unsupported objects. */
export function describeScene(): unknown {
  const scene = lastFrame.scene as THREE.Object3D | null, cam = lastFrame.camera as THREE.Camera | null;
  if (!scene || !cam) return 'no scene';
  let top: THREE.Object3D = scene; while (top.parent) top = top.parent;
  const kinds: Record<string, number> = {}, shaders: Record<string, number> = {}, objects: Record<string, number> = {};
  top.traverseVisible(o => {
    objects[o.type] = (objects[o.type] ?? 0) + 1;
    const m = o as THREE.Mesh; if (!m.material) return;
    for (const mat of materialsOf(m)) {
      if (!mat) continue;
      const key = `${mat.type}${mat.vertexColors ? '+vc' : ''}${(mat as THREE.MeshStandardMaterial).map ? '+map' : ''}${mat.transparent ? '+t' : ''}`;
      kinds[key] = (kinds[key] ?? 0) + 1;
      if ((mat as THREE.ShaderMaterial).isShaderMaterial) shaders[shaderKey(mat as THREE.ShaderMaterial)] = (shaders[shaderKey(mat as THREE.ShaderMaterial)] ?? 0) + 1;
    }
  });
  return {objects, kinds, shaders, background: (top as THREE.Scene).background ? (top as THREE.Scene).background!.constructor.name : null, fog: (top as THREE.Scene).fog?.type ?? null};
}
