import * as THREE from 'three-real';
import {host, assetRegistry, registrySwaps, type SceneSink} from './host';
import {lastFrame, post, captures} from './renderer';
import {frameCount} from './frameCount';
import {translateShaderMaterial, translateHookedMaterial, fillBuiltinUniforms, type HookedShader, type TranslatedShader} from './shaders';
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
let exportCount = 0;
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
// A geometry shared by many meshes is checked once per frame (per primitive kind).
const geometryFrame = new WeakMap<THREE.BufferGeometry, {frame: number; primitive: number; id: number}>();

function syncGeometry(geo: THREE.BufferGeometry, primitive = 0): number {
  const seen = geometryFrame.get(geo);
  if (seen && seen.frame === exportCount && seen.primitive === primitive) return seen.id;
  const id = syncGeometryNow(geo, primitive);
  if (seen) { seen.frame = exportCount; seen.primitive = primitive; seen.id = id; } else geometryFrame.set(geo, {frame: exportCount, primitive, id});
  return id;
}

// Games often set needsUpdate on attributes every frame without changing them. WebGL shrugs that off
// (a small buffer upload), but here a change rebuilds an Unreal mesh. So a version bump only counts
// when the attribute's bytes differ from the last ones sent.
type AttrState = {version: number; effective: number; bytes: Uint32Array | Uint8Array | null};
const attrState = new WeakMap<object, AttrState>();
function contentVersion(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null | undefined): number {
  if (!attr) return -1;
  const owner = ((attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (attr as THREE.InterleavedBufferAttribute).data : attr) as {version: number; array: ArrayLike<number> & {buffer: ArrayBuffer; byteOffset: number; byteLength: number}};
  let st = attrState.get(owner);
  if (!st) { st = {version: owner.version, effective: 0, bytes: null}; attrState.set(owner, st); return 0; }
  if (owner.version === st.version) return st.effective;
  st.version = owner.version;
  const arr = owner.array;
  const view = arr.byteLength % 4 === 0 && arr.byteOffset % 4 === 0 ? new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4) : new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  const old = st.bytes;
  if (old && old.length === view.length && old.constructor === view.constructor) {
    let same = true;
    for (let i = 0; i < view.length; i++) if (old[i] !== view[i]) { same = false; break; }
    if (same) return st.effective;
  }
  st.bytes = view.slice();
  return ++st.effective;
}

const resends = new Map<number, number>();
function syncGeometryNow(geo: THREE.BufferGeometry, primitive: number): number {
  const id = idOf(geo);
  const a = geo.attributes, idx = geo.index;
  const extras = Object.entries(a).filter(([name, attr]) => isExtraAttribute(name) && attr.itemSize <= 4);
  const sig = `${primitive}|${contentVersion(a.position)}|${a.position?.count}|${contentVersion(a.normal)}|${contentVersion(a.uv)}|${contentVersion(a.color)}|${contentVersion(idx)}|${idx?.count}|${geo.drawRange.start},${geo.drawRange.count}|${geo.groups.length}|${extras.map(([n, x]) => n + contentVersion(x)).join(',')}`;
  const previous = geometrySig.get(id);
  if (previous === sig) return id;
  // With tracing on, report geometry whose data keeps changing: each change rebuilds an Unreal mesh.
  if (host.trace && previous !== undefined) {
    const n = (resends.get(id) ?? 0) + 1; resends.set(id, n);
    if (n === 5 || n % 200 === 0) host.log('warn', `geometry ${id} re-sent ${n} times: ${geo.type} "${geo.name}" ${a.position?.count} vertices, ${previous} -> ${sig}`);
  }
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
  if (idx) { indices = new Uint32Array(idx.count); indices.set((idx.array as Uint16Array | Uint32Array).subarray(0, idx.count)); }
  const start = geo.drawRange.start, count = geo.drawRange.count;
  const groups = JSON.stringify({groups: geo.groups.map(gr => [gr.start, gr.count, gr.materialIndex ?? 0]), drawStart: start, drawCount: Number.isFinite(count) ? count : -1, primitive, uvChannels});
  out.geometry(id, pos.buffer, nrm?.buffer ?? null, uv?.buffer ?? null, col?.buffer ?? null, colorSize, indices?.buffer ?? null, groups);
  return id;
}

function rgba8(w: number, h: number, data: ArrayLike<number>, channels: number, tex: THREE.Texture): Uint8Array {
  const px = w * h;
  const isByte = data instanceof Uint8Array || data instanceof Uint8ClampedArray;
  // Bytes need no conversion: RGBA is copied as it is, and other channel counts are spread without per-value checks.
  if (isByte && channels === 4) return new Uint8Array((data as Uint8Array).buffer.slice((data as Uint8Array).byteOffset, (data as Uint8Array).byteOffset + px * 4));
  const out = new Uint8Array(px * 4);
  if (isByte) {
    const d = data as Uint8Array;
    if (channels === 1) for (let i = 0, o = 0; i < px; i++, o += 4) { const v = d[i]; out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = 255; }
    else for (let i = 0, j = 0, o = 0; i < px; i++, j += channels, o += 4) { out[o] = d[j]; out[o + 1] = d[j + 1]; out[o + 2] = channels > 2 ? d[j + 2] : 0; out[o + 3] = 255; }
    return out;
  }
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
  // A render target's texture: Unreal draws the scene the game renders into it. Its first row is the bottom of the
  // view, as with an image three flips on upload.
  if ((tex as THREE.Texture & {isRenderTargetTexture?: boolean}).isRenderTargetTexture) {
    (tex as unknown as Record<string, unknown>).__jsgbMapped = true;
    return {json: {...base, kind: 'capture', width: img?.width ?? 256, height: img?.height ?? 256, flipY: true}, bytes: null};
  }
  const channelsOf = (format: number) => format === THREE.RedFormat ? 1 : format === THREE.RGFormat ? 2 : (format as number) === 1022 /* RGBFormat */ ? 3 : 4;
  // Compressed containers transcoded to plain RGBA (KTX2 with no GPU formats advertised).
  const mip = (tex as THREE.CompressedTexture).mipmaps?.[0] as Record<string, any> | undefined;
  if ((tex as THREE.CompressedTexture).isCompressedTexture) {
    // BC7 and DXT go to Unreal as they are, with every mip level.
    const block = {[THREE.RGBA_BPTC_Format]: 'bc7', [THREE.RGB_S3TC_DXT1_Format]: 'dxt1', [THREE.RGBA_S3TC_DXT1_Format]: 'dxt1', [THREE.RGBA_S3TC_DXT3_Format]: 'dxt3', [THREE.RGBA_S3TC_DXT5_Format]: 'dxt5'}[tex.format as number];
    const levels = ((tex as THREE.CompressedTexture).mipmaps ?? []) as {width: number; height: number; data: Uint8Array}[];
    if (block && levels.length && levels.every(l => l?.data)) {
      const total = levels.reduce((n, l) => n + l.data.byteLength, 0), bytes = new Uint8Array(total);
      let at = 0; for (const l of levels) { bytes.set(new Uint8Array(l.data.buffer, l.data.byteOffset, l.data.byteLength), at); at += l.data.byteLength; }
      return {json: {...base, kind: 'compressed', format: block, width: levels[0].width, height: levels[0].height, mips: levels.map(l => [l.width, l.height, l.data.byteLength])}, bytes: bytes.buffer};
    }
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
// Like vertex data, a texture marked for update is only sent again when its pixels really changed.
const pixelState = new WeakMap<THREE.Texture, {view: Uint32Array | Uint8Array; key: string}>();
function pixelsUnchanged(tex: THREE.Texture): boolean {
  const img = tex.image as Record<string, any> | undefined;
  const mip = (tex as THREE.CompressedTexture).mipmaps?.[0] as Record<string, any> | undefined;
  const raw = img?.__ctx?.bitmap?.()?.data ?? img?.__pixels?.data ?? img?.data ?? mip?.data;
  if (!raw || !ArrayBuffer.isView(raw)) return false;
  const arr = raw as Uint8Array;
  const view = arr.byteLength % 4 === 0 && arr.byteOffset % 4 === 0 ? new Uint32Array(arr.buffer, arr.byteOffset, arr.byteLength / 4) : new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  // The texture's settings count too: they travel with the pixels.
  const key = [tex.wrapS, tex.wrapT, tex.magFilter, tex.minFilter, tex.flipY, tex.colorSpace, tex.format, tex.type, tex.repeat.x, tex.repeat.y, tex.offset.x, tex.offset.y, tex.rotation, img?.width, img?.height].join(',');
  const old = pixelState.get(tex);
  let same = !!old && old.key === key && old.view.length === view.length && old.view.constructor === view.constructor;
  if (same) { const o = old!.view; for (let i = 0; i < view.length; i++) if (o[i] !== view[i]) { same = false; break; } }
  if (!same) pixelState.set(tex, {view: view.slice(), key});
  return same;
}
function textureId(tex: THREE.Texture | null | undefined): number {
  if (!tex) return 0;
  const id = idOf(tex);
  if (textureSig.get(id) !== tex.version) {
    const first = !textureSig.has(id);
    textureSig.set(id, tex.version);
    if (!first && textureOk.get(id) && pixelsUnchanged(tex)) return id;
    if (first) pixelsUnchanged(tex);
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
const hookCache = new WeakMap<THREE.Material, {key: string; shader: HookedShader}>();
const defaultHook = THREE.Material.prototype.onBeforeCompile;
const hookRenderer = {capabilities: {isWebGL2: true, maxTextures: 16, precision: 'highp'}, extensions: {has: () => false, get: () => null}, getRenderTarget: () => null};
function hookShader(mat: THREE.Material): {key: string; shader: HookedShader} | undefined {
  if (mat.onBeforeCompile === defaultHook || (mat as THREE.ShaderMaterial).isShaderMaterial) return undefined;
  let key = '';
  try { key = `${mat.version}|${mat.customProgramCacheKey?.() ?? ''}`; } catch { key = String(mat.version); }
  const cached = hookCache.get(mat);
  if (cached && cached.key === key) return cached;
  const lib = (THREE.ShaderLib as Record<string, {vertexShader: string; fragmentShader: string; uniforms: Record<string, {value: unknown}>}>)[SHADER_LIB[mat.type] ?? 'standard'];
  const shader = {uniforms: lib ? THREE.UniformsUtils.clone(lib.uniforms) : {}, vertexShader: lib?.vertexShader ?? '', fragmentShader: lib?.fragmentShader ?? '', defines: {}, shaderName: mat.type};
  try { mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, hookRenderer as unknown as THREE.WebGLRenderer); } catch { /* hooks that need a real renderer keep their defaults */ }
  const entry = {key, shader: shader as HookedShader};
  hookCache.set(mat, entry);
  return entry;
}
function hookUniforms(mat: THREE.Material): Record<string, {value: unknown}> | undefined {
  const hooked = hookShader(mat);
  if (!hooked) return undefined;
  fillBuiltinUniforms(mat, hooked.shader.uniforms as Record<string, {value: any}>);
  return hooked.shader.uniforms;
}

/** A short stable name for a custom shader, so the registry can map it to an Unreal material. */
function shaderKey(m: THREE.ShaderMaterial): string {
  if (m.name) return m.name;
  let h = 0; const s = (m.fragmentShader ?? '') + (m.vertexShader ?? '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'shader_' + (h >>> 0).toString(16);
}

// A material shared by many meshes is described once per frame.
const materialFrame = new WeakMap<THREE.Material, number>();
// Materials drawn on an InstancedMesh, and whether its instances have colours (for patched built-in shaders).
const instancedUse = new WeakMap<THREE.Material, {color: boolean}>();
const noteInstanced = (mat: THREE.Material | undefined, im: THREE.InstancedMesh) => { if (mat) instancedUse.set(mat, {color: !!im.instanceColor}); return mat; };

// Every value a material sends, as numbers (with its uniforms for shader materials): when they all match the last frame's,
// the material is unchanged and its description is not built again.
const quick = new WeakMap<THREE.Material, {values: Float64Array; name: string; key: unknown}>();
let scratch = new Float64Array(256);
const put = (i: number, v: number) => { if (i >= scratch.length) { const grown = new Float64Array(scratch.length * 2); grown.set(scratch); scratch = grown; } scratch[i] = v; return i + 1; };
// Uniform values as numbers after the material's own, for shader and hooked materials. Returns -1 for a
// value it can't compare, and the material is then described in full every frame as before.
function quickUniforms(u: Record<string, {value: unknown}>, i: number): number {
  for (const k in u) {
    const v = u[k]?.value as any;
    if (typeof v === 'number') i = put(i, v);
    else if (typeof v === 'boolean') i = put(i, +v);
    else if (v === null || v === undefined) i = put(i, -1.2345e-7);
    else if (v.isColor) { i = put(i, v.r); i = put(i, v.g); i = put(i, v.b); }
    else if (v.isVector2) { i = put(i, v.x); i = put(i, v.y); }
    else if (v.isVector3) { i = put(i, v.x); i = put(i, v.y); i = put(i, v.z); }
    else if (v.isVector4 || v.isQuaternion) { i = put(i, v.x); i = put(i, v.y); i = put(i, v.z); i = put(i, v.w); }
    else if (v.isMatrix3 || v.isMatrix4) { for (const e of v.elements) i = put(i, e); }
    else if (v.isTexture) { i = put(i, idOf(v)); i = put(i, v.version); }
    else if (Array.isArray(v) || ArrayBuffer.isView(v)) {
      for (const x of v as ArrayLike<any>) {
        if (typeof x === 'number') i = put(i, x);
        else if (x?.isVector3 || x?.isColor) { i = put(i, x.x ?? x.r); i = put(i, x.y ?? x.g); i = put(i, x.z ?? x.b); }
        else if (x?.isVector2) { i = put(i, x.x); i = put(i, x.y); }
        else if (x?.isVector4) { i = put(i, x.x); i = put(i, x.y); i = put(i, x.z); i = put(i, x.w); }
        else return -1;
      }
    } else return -1;
  }
  return i;
}
function quickValues(m: THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial & THREE.PointsMaterial & THREE.LineBasicMaterial): number {
  if (scratch.length < 64) scratch = new Float64Array(256);
  const s = scratch; let i = 0;
  const c = m.color, e = m.emissive;
  s[i++] = m.version; s[i++] = c ? c.r : -1; s[i++] = c ? c.g : -1; s[i++] = c ? c.b : -1;
  s[i++] = e ? e.r : -1; s[i++] = e ? e.g : -1; s[i++] = e ? e.b : -1; s[i++] = m.emissiveIntensity ?? -1;
  s[i++] = m.roughness ?? -1; s[i++] = m.metalness ?? -1; s[i++] = m.opacity; s[i++] = +m.transparent; s[i++] = m.alphaTest; s[i++] = m.side;
  s[i++] = +!!m.vertexColors; s[i++] = m.blending; s[i++] = +m.depthWrite; s[i++] = +m.depthTest; s[i++] = +m.colorWrite; s[i++] = +!!m.wireframe;
  for (const t of [m.map, m.emissiveMap, m.normalMap, m.roughnessMap, m.metalnessMap, m.aoMap, m.alphaMap]) { s[i++] = t ? idOf(t) : 0; s[i++] = t ? t.version : -1; }
  s[i++] = +!!m.flatShading; s[i++] = +m.toneMapped; s[i++] = +(m.fog !== false); s[i++] = m.envMapIntensity ?? -1; s[i++] = +!!m.alphaHash;
  s[i++] = m.size ?? -1; s[i++] = +!!m.sizeAttenuation; s[i++] = m.linewidth ?? -1; s[i++] = m.clearcoat ?? -1; s[i++] = m.transmission ?? -1; s[i++] = m.ior ?? -1;
  return i;
}

// The same shader drawn into a post-processing target: its own key, as the generated material differs.
const linearShaders = new WeakMap<TranslatedShader, TranslatedShader>();
function linearShader(t: TranslatedShader): TranslatedShader {
  let l = linearShaders.get(t);
  if (!l) linearShaders.set(t, l = {...t, key: t.key + '_l', encoded: false});
  return l;
}

function syncMaterial(mat: THREE.Material): number {
  const id = idOf(mat);
  if (materialFrame.get(mat) === exportCount) return id;
  materialFrame.set(mat, exportCount);
  const m = mat as THREE.MeshStandardMaterial & THREE.MeshPhysicalMaterial & THREE.ShaderMaterial & THREE.MeshBasicMaterial & THREE.PointsMaterial;
  const shader = !!m.isShaderMaterial;
  const extra = shader ? m.uniforms as Record<string, {value: unknown}> : hookUniforms(mat);
  let count = quickValues(m as never);
  if (extra) count = quickUniforms(extra, count);
  if (count >= 0) {
    const last = quick.get(mat), key = mat.userData?.materialKey ?? mat.userData?.assetMaterialKey;
    if (last && last.values.length === count && last.name === mat.name && last.key === key) {
      let same = true;
      for (let i = 0; i < count; i++) if (last.values[i] !== scratch[i] && !(last.values[i] !== last.values[i] && scratch[i] !== scratch[i])) { same = false; break; }
      if (same) return id;
    }
    quick.set(mat, {values: scratch.slice(0, count), name: mat.name, key});
  }
  const registryKey = mat.userData?.materialKey ?? mat.userData?.assetMaterialKey ?? (shader ? shaderKey(m) : undefined);
  const registryMaterial = registryKey ? assetRegistry()[registryKey]?.material : undefined;
  // Custom shaders without a registry material become generated Unreal materials.
  let custom: string | undefined;
  const hooked = shader ? undefined : hookShader(mat);
  if ((shader || hooked) && !registryMaterial) {
    let t = shader ? translateShaderMaterial(m) : translateHookedMaterial(mat, hooked!.shader, hooked!.key, instancedUse.get(mat));
    // A ShaderMaterial's gl_FragColor drawn to the screen is already in display (sRGB) values, and Unreal decodes it
    // to linear light so its own output encoding gives the same pixel. Drawn into a post-processing render target
    // (EffectComposer), it's linear light, and the final pass encodes it with the rest of the scene.
    if (t && shader) {
      if (lastFrame.linear) t = linearShader(t);
      else t.encoded = true;
    }
    // Still compiling (the shader compiler loads in the background): send it again next frame, even
    // though its values haven't changed, so the generated material replaces the generic one.
    if (t === undefined) quick.delete(mat);
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
    // A Line2's width (WebGL draws every other line one pixel wide): in pixels, or in world units.
    fatWidth: mat.userData?.jsgbFatWidth, fatWorld: mat.userData?.jsgbFatWorld,
    clearcoat: m.clearcoat ?? 0, transmission: m.transmission ?? 0, ior: m.ior ?? 1.5,
    tags: Object.keys(mat.userData ?? {}).filter(k => typeof mat.userData[k] !== 'object').slice(0, 8),
  };
  const sig = JSON.stringify(desc);
  if (materialSig.get(id) !== sig) { materialSig.set(id, sig); sink()?.material(id, sig); }
  return id;
}

const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
const visibleTo = (o: THREE.Object3D, cam: THREE.Camera) => o.layers.test(cam.layers);
// 16: userData.jsgbNoInterpolate, the object jumps to each new position instead of gliding between game frames.
const flagsOf = (o: THREE.Object3D) => (o.castShadow ? 1 : 0) | (o.receiveShadow ? 2 : 0) | (o.frustumCulled ? 0 : 4) | ((o as THREE.SkinnedMesh).isSkinnedMesh ? 8 : 0) | (o.userData?.jsgbNoInterpolate ? 16 : 0);
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

/** BatchedMesh: each geometry in the batch goes to Unreal as an instanced mesh of the instances that use it,
 *  through a stand-in InstancedMesh kept per batch and geometry. */
type BatchProxy = {mesh: THREE.InstancedMesh; key: string};
const batchProxies = new WeakMap<object, Map<number, BatchProxy>>();
const batchMatrix = new THREE.Matrix4(), batchColor = new THREE.Color();
function emitBatched(b: THREE.BatchedMesh) {
  const anyB = b as unknown as {_instanceInfo?: {geometryIndex: number; visible: boolean; active: boolean}[]; _colorsTexture?: unknown};
  const infos = anyB._instanceInfo;
  const mat = materialsOf(b)[0];
  if (!infos || !mat?.visible) return;
  const byGeometry = new Map<number, number[]>();
  infos.forEach((info, id) => { if (info.active && info.visible) { const list = byGeometry.get(info.geometryIndex); if (list) list.push(id); else byGeometry.set(info.geometryIndex, [id]); } });
  let proxies = batchProxies.get(b);
  if (!proxies) { proxies = new Map(); batchProxies.set(b, proxies); }
  const source = b.geometry;
  for (const [geometryId, ids] of byGeometry) {
    const range = b.getGeometryRangeAt(geometryId) as {vertexStart: number; vertexCount: number; indexStart: number; indexCount: number};
    const key = `${range.vertexStart}|${range.vertexCount}|${range.indexStart}|${range.indexCount}|${source.attributes.position.version}|${source.index?.version ?? -1}`;
    let p = proxies.get(geometryId);
    if (!p || p.key !== key || p.mesh.instanceMatrix.count < ids.length) {
      const sub = new THREE.BufferGeometry();
      for (const [name, a] of Object.entries(source.attributes) as [string, THREE.BufferAttribute][]) {
        sub.setAttribute(name, new THREE.BufferAttribute((a.array as Float32Array).slice(range.vertexStart * a.itemSize, (range.vertexStart + range.vertexCount) * a.itemSize), a.itemSize, a.normalized));
      }
      if (source.index && range.indexCount > 0) {
        // Batch indices point into the whole buffer; the stand-in's start at its first vertex.
        const idx = Array.from(source.index.array.subarray(range.indexStart, range.indexStart + range.indexCount), v => v - range.vertexStart);
        sub.setIndex(idx);
      }
      p = {mesh: new THREE.InstancedMesh(sub, b.material, Math.max(ids.length, p?.mesh.instanceMatrix.count ?? 0)), key};
      proxies.set(geometryId, p);
    }
    const im = p.mesh;
    im.count = ids.length;
    ids.forEach((id, i) => {
      b.getMatrixAt(id, batchMatrix); im.setMatrixAt(i, batchMatrix);
      if (anyB._colorsTexture) { b.getColorAt(id, batchColor); im.setColorAt(i, batchColor); }
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.matrixWorld.copy(b.matrixWorld);
    im.castShadow = b.castShadow; im.receiveShadow = b.receiveShadow; im.frustumCulled = b.frustumCulled;
    emitMesh(im);
  }
}

/** Skinned and morph-target meshes: the bridge deforms the vertices the way three's shaders do (bones, then
 *  morph targets, through Mesh.getVertexPosition) into a copy of the geometry that Unreal draws. The copy is
 *  rebuilt only when a bone or morph influence moved. */
type Deformed = {geometry: THREE.BufferGeometry; source: THREE.BufferGeometry; signature: Float64Array | null};
const deformedOf = new WeakMap<THREE.Mesh, Deformed>();
const deformVector = new THREE.Vector3(), deformNormal = new THREE.Vector3(), deformTemp = new THREE.Vector3(), deformNormalBase = new THREE.Vector3();
function deformedGeometry(o: THREE.Mesh): THREE.BufferGeometry {
  const skinned = (o as THREE.SkinnedMesh).isSkinnedMesh && !!(o as THREE.SkinnedMesh).skeleton;
  const morphed = !!o.morphTargetInfluences?.length && !!o.geometry.morphAttributes.position?.length;
  if (!skinned && !morphed) return o.geometry;
  const source = o.geometry;
  let d = deformedOf.get(o);
  if (!d || d.source !== source) {
    const geometry = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(source.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'skinIndex' && name !== 'skinWeight') geometry.setAttribute(name, a);
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(source.attributes.position.count * 3), 3));
    if (source.attributes.normal) geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(source.attributes.normal.count * 3), 3));
    if (source.index) geometry.setIndex(source.index);
    for (const g of source.groups) geometry.addGroup(g.start, g.count, g.materialIndex);
    d = {geometry, source, signature: null};
    deformedOf.set(o, d);
  }
  // What moves the vertices this frame: the bone matrices and the morph influences.
  if (skinned) (o as THREE.SkinnedMesh).skeleton.update();
  const bones = skinned ? (o as THREE.SkinnedMesh).skeleton.boneMatrices : null;
  const influences = o.morphTargetInfluences ?? [];
  const size = (bones?.length ?? 0) + influences.length;
  const signature = d.signature?.length === size ? d.signature : new Float64Array(size);
  let same = d.signature === signature;
  let k = 0;
  if (bones) for (let i = 0; i < bones.length; i++, k++) { if (signature[k] !== bones[i]) { same = false; signature[k] = bones[i]; } }
  for (let i = 0; i < influences.length; i++, k++) { if (signature[k] !== influences[i]) { same = false; signature[k] = influences[i]; } }
  d.signature = signature;
  if (same) return d.geometry;
  // As three's shaders do: morph targets first (positions, and normals when the geometry has morph normals),
  // then the bone transform. Skinning is affine, so the skinned normal is skin(p + n) - skin(p).
  const out = d.geometry.attributes.position as THREE.BufferAttribute;
  const outN = d.geometry.attributes.normal as THREE.BufferAttribute | undefined;
  const baseN = source.attributes.normal as THREE.BufferAttribute | undefined;
  const morphN = morphed ? source.morphAttributes.normal : undefined;
  const relative = source.morphTargetsRelative;
  for (let i = 0; i < out.count; i++) {
    THREE.Mesh.prototype.getVertexPosition.call(o, i, deformVector);
    if (outN && baseN) {
      deformNormal.fromBufferAttribute(baseN, i);
      if (morphN) for (let t = 0; t < morphN.length; t++) {
        const w = influences[t]; if (!w) continue;
        deformTemp.fromBufferAttribute(morphN[t], i);
        if (!relative) deformTemp.sub(deformNormalBase.fromBufferAttribute(baseN, i));
        deformNormal.addScaledVector(deformTemp, w);
      }
      if (skinned) {
        deformTemp.copy(deformVector).add(deformNormal);
        (o as THREE.SkinnedMesh).applyBoneTransform(i, deformTemp);
        (o as THREE.SkinnedMesh).applyBoneTransform(i, deformVector);
        deformNormal.copy(deformTemp).sub(deformVector);
      }
      deformNormal.normalize();
      outN.setXYZ(i, deformNormal.x, deformNormal.y, deformNormal.z);
    } else if (skinned) (o as THREE.SkinnedMesh).applyBoneTransform(i, deformVector);
    out.setXYZ(i, deformVector.x, deformVector.y, deformVector.z);
  }
  out.needsUpdate = true;
  if (outN) outN.needsUpdate = true; else d.geometry.computeVertexNormals();
  return d.geometry;
}

function emitMesh(o: THREE.Mesh) {
  if ((o as unknown as THREE.BatchedMesh).isBatchedMesh) { emitBatched(o as unknown as THREE.BatchedMesh); return; }
  const geo = deformedGeometry(o); if (!geo?.attributes?.position) return;
  const mats = materialsOf(o);
  if (!mats.length || mats.every(m => !m || !m.visible || m.colorWrite === false)) return;
  const gid = syncGeometry(geo); if (!gid) return;
  if ((o as THREE.InstancedMesh).isInstancedMesh) { emitInstances(o as THREE.InstancedMesh, gid, syncMaterial(noteInstanced(mats[0], o as THREE.InstancedMesh)!)); return; }
  push(MESH); push(idOf(o)); push(gid); push(flagsOf(o)); push(mats.length);
  for (const m of mats) push(m ? syncMaterial(m) : 0);
  pushMatrix(o.matrixWorld);
}

function emitPrimitive(o: THREE.Points | THREE.Line, kind: number, primitive: number) {
  let geo = o.geometry; const mat = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.Material;
  if (!geo?.attributes?.position || !mat?.visible) return;
  // Dashed lines go to Unreal as one segment per dash.
  const dashed = mat as THREE.LineDashedMaterial;
  if (kind === LINES && dashed.isLineDashedMaterial) {
    const d = dashedGeometry(geo, primitive, geo.attributes.lineDistance as THREE.BufferAttribute | undefined, dashed.dashSize, dashed.gapSize, dashed.scale);
    if (!d) return;
    if (d !== geo) { geo = d; primitive = 2; }
  }
  const gid = syncGeometry(geo, primitive); if (!gid) return;
  push(kind); push(idOf(o)); push(gid); push(syncMaterial(mat)); push(flagsOf(o)); pushMatrix(o.matrixWorld);
}

// Line2 and LineSegments2 (three's fat lines) are meshes of one quad per segment, placed by instanceStart and
// instanceEnd. Unreal draws them as ordinary segments with the LineMaterial's width.
const fatGeometry = new WeakMap<THREE.BufferGeometry, {sig: string; geometry: THREE.BufferGeometry}>();
const fatMaterial = new WeakMap<THREE.Material, THREE.LineBasicMaterial>();
function emitFatLine(o: THREE.Mesh) {
  const src = o.geometry, lm = o.material as THREE.Material & Record<string, any>;
  const a = src?.attributes as unknown as Record<string, THREE.InterleavedBufferAttribute | undefined>;
  const start = a?.instanceStart, end = a?.instanceEnd;
  if (!start || !end || !lm?.visible) return;
  const cs = a.instanceColorStart, ce = a.instanceColorEnd, ds = a.instanceDistanceStart, de = a.instanceDistanceEnd;
  const instanced = (src as THREE.InstancedBufferGeometry).instanceCount;
  const count = Math.min(start.count, Number.isFinite(instanced) ? instanced : start.count);
  const sig = [start.data.version, cs?.data.version ?? -1, count, lm.dashed ? [ds?.data.version, lm.dashSize, lm.gapSize, lm.dashScale].join(',') : ''].join('|');
  let cached = fatGeometry.get(src);
  if (!cached || cached.sig !== sig) {
    const pos: number[] = [], col: number[] = [];
    for (let i = 0; i < count; i++) {
      pos.push(start.getX(i), start.getY(i), start.getZ(i), end.getX(i), end.getY(i), end.getZ(i));
      if (cs && ce) col.push(cs.getX(i), cs.getY(i), cs.getZ(i), ce.getX(i), ce.getY(i), ce.getZ(i));
    }
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    if (lm.dashed && ds && de) {
      const dist: number[] = [];
      for (let i = 0; i < count; i++) dist.push(ds.getX(i), de.getX(i));
      g.setAttribute('lineDistance', new THREE.Float32BufferAttribute(dist, 1));
      g = dashedGeometry(g, 2, g.attributes.lineDistance as THREE.BufferAttribute, lm.dashSize ?? 1, lm.gapSize ?? 1, lm.dashScale ?? 1) ?? g;
    }
    cached = {sig, geometry: g};
    fatGeometry.set(src, cached);
  }
  let m = fatMaterial.get(lm);
  if (!m) { m = new THREE.LineBasicMaterial(); fatMaterial.set(lm, m); }
  if (lm.color) m.color.copy(lm.color);
  m.opacity = lm.opacity; m.transparent = lm.transparent; m.vertexColors = !!lm.vertexColors && !!cs;
  m.depthTest = lm.depthTest; m.depthWrite = lm.depthWrite; m.blending = lm.blending; m.toneMapped = lm.toneMapped;
  m.userData.jsgbFatWidth = lm.linewidth ?? 1; m.userData.jsgbFatWorld = !!lm.worldUnits;
  const gid = syncGeometry(cached.geometry, 2); if (!gid) return;
  push(LINES); push(idOf(o)); push(gid); push(syncMaterial(m)); push(flagsOf(o)); pushMatrix(o.matrixWorld);
}

// A dashed line (LineDashedMaterial, or a dashed LineMaterial) as one segment per dash. three keeps the part of
// each segment where (scale x lineDistance) mod (dash + gap) < dash. Without lineDistance (the game never called
// computeLineDistances) three's shader reads 0, so the line stays solid.
const dashCache = new WeakMap<THREE.BufferGeometry, {sig: string; geometry: THREE.BufferGeometry | null}>();
function dashedGeometry(geo: THREE.BufferGeometry, primitive: number, distance: THREE.BufferAttribute | undefined, dash: number, gap: number, scale: number): THREE.BufferGeometry | null {
  if (!distance || dash <= 0) return geo;
  const p = geo.attributes.position as THREE.BufferAttribute, c = geo.attributes.color as THREE.BufferAttribute | undefined;
  const sig = [p.version, c?.version ?? -1, distance.version, primitive, dash, gap, scale, geo.drawRange.start, geo.drawRange.count].join('|');
  const cached = dashCache.get(geo);
  if (cached && cached.sig === sig) return cached.geometry;
  // Segments as vertex pairs: LineSegments pair them up, Line and LineLoop join each vertex to the next.
  const idx = geo.index, first = geo.drawRange.start;
  const n = Math.min(idx ? idx.count : p.count, first + geo.drawRange.count) - first;
  const at = (k: number) => idx ? idx.getX(first + k) : first + k;
  const pairs: [number, number][] = [];
  if (primitive === 2) for (let k = 0; k + 1 < n; k += 2) pairs.push([at(k), at(k + 1)]);
  else { for (let k = 0; k + 1 < n; k++) pairs.push([at(k), at(k + 1)]); if (primitive === 4 && n > 2) pairs.push([at(n - 1), at(0)]); }
  const period = dash + gap, pos: number[] = [], col: number[] = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3();
  for (const [ia, ib] of pairs) {
    const da = distance.getX(ia) * scale, db = distance.getX(ib) * scale;
    if (!(db > da)) continue;
    va.fromBufferAttribute(p, ia); vb.fromBufferAttribute(p, ib);
    for (let s = Math.floor(da / period) * period; s < db; s += period) {
      const t0 = (Math.max(s, da) - da) / (db - da), t1 = (Math.min(s + dash, db) - da) / (db - da);
      if (t1 <= t0) continue;
      for (const t of [t0, t1]) {
        pos.push(va.x + (vb.x - va.x) * t, va.y + (vb.y - va.y) * t, va.z + (vb.z - va.z) * t);
        if (c) for (let j = 0; j < 3; j++) col.push(c.getComponent(ia, j) + (c.getComponent(ib, j) - c.getComponent(ia, j)) * t);
      }
    }
  }
  let g: THREE.BufferGeometry | null = null;
  if (pos.length) {
    g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    if (col.length) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  }
  dashCache.set(geo, {sig, geometry: g});
  return g;
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
      if ((o as THREE.InstancedMesh).isInstancedMesh) { emitInstances(o as THREE.InstancedMesh, -keyId(swap.key), mats[0] ? syncMaterial(noteInstanced(mats[0], o as THREE.InstancedMesh)!) : 0); return; }
      push(ASSET); push(idOf(o)); push(keyId(swap.key)); push(mats[0] ? syncMaterial(mats[0]) : 0); pushMatrix(o.matrixWorld);
      // Untagged models are replaced whole; tagged ones keep their untagged attachments.
      if (!hasContentTag(o, swap.key)) return;
      childSkip = swap.key;
    } else if ((o as unknown as {isLineSegments2?: boolean}).isLineSegments2) emitFatLine(o as THREE.Mesh);
    else if ((o as THREE.Mesh).isMesh) emitMesh(o as THREE.Mesh);
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
  n = 0; ni = 0; exportCount++;
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
  // A texture background (an equirectangular sky): record 11 with the texture, its mapping, scene.backgroundIntensity,
  // the rotation three.js applies to the view direction (scene.backgroundRotation) and whether the image is flipped.
  if (bg?.isTexture) {
    const tex = bg as THREE.Texture & {isCubeTexture?: boolean};
    const e = (sc as THREE.Scene & {backgroundRotation?: THREE.Euler}).backgroundRotation;
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-(e?.x ?? 0), -(e?.y ?? 0), -(e?.z ?? 0), e?.order ?? 'XYZ')).elements;
    push(11); push(textureId(tex)); push(tex.isCubeTexture ? 2 : tex.mapping === 303 || tex.mapping === 304 ? 1 : 0);
    push((sc as THREE.Scene & {backgroundIntensity?: number}).backgroundIntensity ?? 1);
    for (const i of [0, 4, 8, 1, 5, 9, 2, 6, 10]) push(m[i]);
    push(tex.flipY ? 1 : 0);
  }
  walk(top, cam, null);
  if (cam.parent === null && cam !== top) walk(cam, cam, null);
  // Scenes drawn into render targets that a material shows, each between a capture record and its end.
  for (const [target, c] of captures) {
    const tex = target.texture as THREE.Texture & {__jsgbMapped?: boolean};
    if (!tex?.__jsgbMapped || c.frame < frameCount.animation - 2 || c.scene === top) continue;
    const scene = c.scene as unknown as THREE.Scene, ccam = c.camera as unknown as THREE.PerspectiveCamera;
    scene.updateMatrixWorld(); ccam.updateMatrixWorld();
    push(9); push(idOf(tex)); push(target.width ?? 256); push(target.height ?? 256);
    pushMatrix(ccam.matrixWorld); push(ccam.isPerspectiveCamera ? ccam.fov : 0); push(ccam.near ?? 0.1); push(ccam.far ?? 1000);
    const cbg = scene.background as THREE.Color | null;
    push(cbg?.isColor ? 1 : 0); push(cbg?.isColor ? cbg.r : 0); push(cbg?.isColor ? cbg.g : 0); push(cbg?.isColor ? cbg.b : 0);
    walk(scene, ccam, null);
    push(10);
  }
  if (pendingEvents.length && out.events) { const events = pendingEvents; pendingEvents = []; out.events(JSON.stringify(events)); }
  out.frame(floats.buffer, n, inst.buffer, ni);
  // Release geometry the game has dropped (checked every few seconds).
  if (++sweep % 300 === 0) for (const [id, ref] of geometryRefs) if (!ref.deref()) { geometryRefs.delete(id); geometrySig.delete(id); out.releaseGeometry(id); }
  return n;
}

/** Debug summary of what the exporter sees: material kinds, shader materials, unsupported objects. */
/** Debugging: the scene object the mirror knows by this id (/bridge/describe "hideids:" finds ids on screen). */
export function objectById(id: number): unknown {
  let top = lastFrame.scene as THREE.Object3D | null, found: THREE.Object3D | null = null;
  while (top?.parent) top = top.parent;
  top?.traverse(o => { if (ids.get(o) === id) found = o; });
  return found;
}

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
