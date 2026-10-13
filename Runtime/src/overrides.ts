import * as THREE from 'three-real';

/** Asset overrides (overrides.json next to the game's publication.json): a three.js mesh that a rule
 *  matches draws an Unreal asset instead, such as a Nanite mesh with full PBR materials. The game keeps
 *  placing, turning, scaling and hiding the object; only what is drawn changes. Rules match by the URL
 *  of the glTF file a mesh came from, by object, mesh, geometry or material name, or by a userData value.
 *  With no overrides file, nothing here runs. */

export type OverrideRule = {
  name: string;
  /** Glob patterns (* and ?, case-insensitive). Every field given must match. */
  match: {url?: string | string[]; object?: string | string[]; mesh?: string | string[]; geometry?: string | string[]; material?: string | string[];
    /** The URL of an image any of the object's textures shows (map, or a shader's sampler uniforms). */
    texture?: string | string[]; userData?: Record<string, string>};
  /** Unreal static mesh path. */
  mesh?: string;
  /** How the Unreal mesh lines up with the three.js mesh: "bounds" fits the source bounds onto the
   *  three.js geometry's bounds (centre and largest side), "none" uses the source's own units. */
  fit?: 'bounds' | 'none';
  /** The Unreal mesh's bounds in its source file's units: [[minX, minY, minZ], [maxX, maxY, maxZ]]. */
  bounds?: [number[], number[]];
  /** Other meshes from the same glTF file as the matched one: hidden (default) or drawn as before. */
  others?: 'hide' | 'keep';
  /** Draw nothing for what the rule matches (the game's object stays in the game). */
  hide?: boolean;
  /** The rule belongs to one Unreal effect ("effects" in overrides.json) and applies only while that effect is on. */
  effect?: keyof EffectFlags;
  /** A Niagara system to play at each of the game's effect objects the rule matches (userData patterns), for as long as
   *  the object is in the scene (lumenEffects.ts). */
  niagara?: string;
};

type SourceInfo = {url: string; primary: boolean};
export type OverrideHit = {key: string; hide: boolean; fit: THREE.Matrix4 | null};

// Where each mesh's data came from. Games often build new geometries that share the loaded attributes
// (instanced batches, merged copies), so the position attribute is remembered as well as the geometry.
const byGeometry = new WeakMap<object, SourceInfo>();
const byAttribute = new WeakMap<object, SourceInfo>();

/** Called by the patched GLTFLoader for every model it parses. */
const log = (text: string) => (globalThis as unknown as {__jsgbHost?: {log(level: string, text: string): void}}).__jsgbHost?.log('log', text);
export function gltfLoaded(gltf: {scene?: THREE.Object3D; scenes?: THREE.Object3D[]}, url: string) {
  if (!url) return;
  const meshes: THREE.Mesh[] = [];
  for (const scene of gltf.scenes?.length ? gltf.scenes : gltf.scene ? [gltf.scene] : []) {
    scene.traverse(o => {
      o.userData.jsgbSource = url;
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry) meshes.push(o as THREE.Mesh);
    });
  }
  // The mesh with the most vertices stands for the whole model; the rest are its details.
  let primary: THREE.BufferGeometry | null = null, most = -1;
  for (const m of meshes) { const n = m.geometry.attributes.position?.count ?? 0; if (n > most) { most = n; primary = m.geometry; } }
  for (const m of meshes) {
    const info = {url, primary: m.geometry === primary};
    m.userData.jsgbPrimary = info.primary;
    byGeometry.set(m.geometry, info);
    const p = m.geometry.attributes.position;
    if (p) byAttribute.set((p as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (p as THREE.InterleavedBufferAttribute).data : p, info);
  }
}

type Compiled = OverrideRule & {key: string; tests: ((o: THREE.Object3D, src: SourceInfo | undefined) => boolean)[]};
let rules: Compiled[] | null = null;
const glob = (patterns: string | string[]) => {
  const list = (Array.isArray(patterns) ? patterns : [patterns]).map(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'));
  return (s: string | undefined) => s !== undefined && list.some(r => r.test(s));
};
const materialNames = (o: THREE.Object3D) => { const m = (o as THREE.Mesh).material; return (Array.isArray(m) ? m : m ? [m] : []).map(x => x.name); };
/** Image URLs of an object's textures: the built-in maps and a shader material's sampler uniforms. */
function textureUrls(o: THREE.Object3D): string[] {
  const urls: string[] = [];
  const m = (o as THREE.Mesh).material;
  for (const mat of (Array.isArray(m) ? m : m ? [m] : []) as (THREE.Material & Record<string, any>)[]) {
    const textures = [mat.map, mat.emissiveMap, mat.normalMap, ...Object.values(mat.uniforms ?? {}).map(u => (u as {value: unknown})?.value)];
    for (const t of textures as THREE.Texture[]) {
      const img = t?.isTexture ? t.image as {src?: string; currentSrc?: string} | undefined : undefined;
      const src = img?.currentSrc || img?.src;
      if (typeof src === 'string' && src) urls.push(src.replaceAll('\\', '/'));
    }
  }
  return urls;
}

/** The Unreal effects Lumen mode adds, each switched on or off in overrides.json ("effects"). The game fires the
 *  same events for its own sprite effects: each effect object carries userData.vfxKey. Off unless the file says on,
 *  except bigMuzzle (the muzzle flashes of large and huge guns), which is on unless the file says false. */
export type EffectFlags = {engineLight: boolean; gunfire: boolean; trails: boolean; smoke: boolean; explosions: boolean; debris: boolean; bigMuzzle: boolean};
let effects: EffectFlags | null = null;
export function effectFlags(registryJson: string | undefined): EffectFlags {
  if (effects) return effects;
  let j: Partial<Record<keyof EffectFlags, unknown>> = {};
  try { j = JSON.parse(registryJson || '{}').effects ?? {}; } catch { /* no effects */ }
  return effects = {engineLight: j.engineLight === true, gunfire: j.gunfire === true, trails: j.trails === true, smoke: j.smoke === true,
    explosions: j.explosions === true, debris: j.debris === true, bigMuzzle: j.bigMuzzle !== false};
}

/** The rules from the registry the host loaded ("overrides" array); empty without an overrides file. */
export function overrideRules(registryJson: string | undefined): Compiled[] {
  if (!rules) [rules, systems] = compile(registryJson);
  return rules;
}
/** The Niagara rules (with "niagara"), whose effect is on. */
export function systemRules(registryJson: string | undefined): Compiled[] {
  if (!systems) [rules, systems] = compile(registryJson);
  return systems;
}
let systems: Compiled[] | null = null;
function compile(registryJson: string | undefined): [Compiled[], Compiled[]] {
  const rules: Compiled[] = [], systems: Compiled[] = [];
  const on = effectFlags(registryJson);
  try {
    const list = (JSON.parse(registryJson || '{}').overrides ?? []) as OverrideRule[];
    for (const r of list) {
      if (!r?.name || !r.match || (!r.mesh && !r.hide && !r.niagara)) continue;
      if (r.effect && !on[r.effect]) continue;
      const tests: Compiled['tests'] = [];
      const m = r.match;
      if (m.url) { const t = glob(m.url); tests.push((_o, src) => t(src?.url.replaceAll('\\', '/'))); }
      if (m.mesh) { const t = glob(m.mesh); tests.push(o => t(o.name)); }
      if (m.geometry) { const t = glob(m.geometry); tests.push(o => t((o as THREE.Mesh).geometry?.name)); }
      if (m.material) { const t = glob(m.material); tests.push(o => materialNames(o).some(t)); }
      if (m.texture) { const t = glob(m.texture); tests.push(o => textureUrls(o).some(u => t(u))); }
      if (m.object) { const t = glob(m.object); tests.push(o => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (t(p.name)) return true; return false; }); }
      if (m.userData) for (const [k, v] of Object.entries(m.userData)) {
        const t = glob(v);
        tests.push(o => { for (let p: THREE.Object3D | null = o; p; p = p.parent) { const x = p.userData?.[k]; if (x !== undefined && t(String(x))) return true; } return false; });
      }
      if (tests.length) (r.niagara ? systems : rules).push({...r, key: 'override:' + r.name, tests});
    }
  } catch { return [[], []]; }
  return [rules, systems];
}

function sourceOf(o: THREE.Object3D): SourceInfo | undefined {
  const g = (o as THREE.Mesh).geometry;
  if (g) {
    const direct = byGeometry.get(g); if (direct) return direct;
    const p = g.attributes?.position;
    if (p) { const a = byAttribute.get((p as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? (p as THREE.InterleavedBufferAttribute).data : p); if (a) return a; }
  }
  // A copy of a loaded mesh with copied geometry still carries its own tag. Objects the game added under
  // a loaded model (mounts, plumes) have none, so they never match the model's rule.
  if (typeof o.userData?.jsgbSource === 'string') return {url: o.userData.jsgbSource, primary: o.userData.jsgbPrimary !== false};
  return undefined;
}

// Each object's answer, kept while its geometry stays the same.
const cache = new WeakMap<THREE.Object3D, {geometry: unknown; hit: OverrideHit | null; until: number}>();
let calls = 0;
const loggedRules = new Set<string>();
const fits = new WeakMap<object, Map<string, THREE.Matrix4 | null>>();

/** The override for a mesh this frame, or null to draw it as usual. */
export function overrideFor(o: THREE.Object3D, list: Compiled[]): OverrideHit | null {
  const g = (o as THREE.Mesh).geometry;
  const seen = cache.get(o);
  calls++;
  if (seen && seen.geometry === g && calls < seen.until) return seen.hit;
  let hit: OverrideHit | null = null;
  const src = sourceOf(o);
  for (const r of list) {
    if (!r.tests.every(t => t(o, src))) continue;
    if (r.hide) { hit = {key: r.key, hide: true, fit: null}; break; }
    // A rule that names its mesh draws for that mesh whichever it is; otherwise only the model's largest mesh is replaced.
    if (src && !src.primary && !r.match.mesh) { if (r.others !== 'keep') hit = {key: r.key, hide: true, fit: null}; break; }
    hit = {key: r.key, hide: false, fit: fitFor(r, g)};
    if (!loggedRules.has(r.key)) { loggedRules.add(r.key); log(`overrides: ${r.name} draws ${r.mesh} for ${(o as THREE.InstancedMesh).isInstancedMesh ? 'instanced ' : ''}"${o.name}" from ${src?.url ?? 'its name'}`); }
    break;
  }
  // A miss is checked again now and then while texture rules exist: a texture's image (and its URL) can arrive later.
  cache.set(o, {geometry: g, hit, until: hit || !list.some(r => r.match.texture) ? Infinity : calls + 20000});
  return hit;
}

/** Source units to the three.js geometry's local space: centres meet, the largest sides match. */
function fitFor(r: Compiled, g: THREE.BufferGeometry | undefined): THREE.Matrix4 | null {
  if (r.fit !== 'bounds' || !r.bounds || !g) return null;
  let perRule = fits.get(g);
  if (!perRule) { perRule = new Map(); fits.set(g, perRule); }
  if (perRule.has(r.key)) return perRule.get(r.key)!;
  if (!g.boundingBox) g.computeBoundingBox();
  const box = g.boundingBox!, size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
  const [lo, hi] = r.bounds;
  const sizeSource = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const s = sizeSource > 0 ? Math.max(size.x, size.y, size.z) / sizeSource : 1;
  const m = new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -(lo[2] + hi[2]) / 2));
  perRule.set(r.key, m);
  return m;
}
