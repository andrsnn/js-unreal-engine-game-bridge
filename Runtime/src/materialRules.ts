import * as THREE from 'three-real';
import {sourceOf} from './overrides';

/** Material rules (registry "materials", from the registry files a game lists): a mesh whose material, as its glTF
 *  file loaded it, matches a rule draws with an Unreal material instead of the generic mirror material. The rule
 *  sees the loaded material, so it still matches after a game swaps in its own (node materials, TSL graphs) and it
 *  hands Unreal the loaded texture set (base colour with alpha, normal, roughness), which the generic mirror
 *  material never reads. Rules match by glob (* and ?, case-insensitive) on the loaded material's name, the name of
 *  its base colour texture, the mesh name or the glTF URL; every field given must match. Without rules nothing here
 *  runs.
 *    {"name": "g9f03-head", "match": {"map": "G9Feminine03_Head_D_*"}, "material": "/Game/Lifesim/Daz/MI_G9F03_Head"}
 *    {"name": "hair", "match": {"material": "Hair_*"}, "material": "/Game/Lifesim/M_Cutout", "textures": {"Map": "map"},
 *     "scalars": {"Cutoff": 0.35}}
 *    {"name": "eye-moisture", "match": {"material": "EyeMoisture*"}, "hide": true}
 *  "textures" maps Unreal texture parameters to the loaded material's maps (default: none; an Unreal material
 *  instance with its own textures needs none); each one sent also sets the scalar Has<Param> to 1. "scalars" and "vectors" set parameters. "color": true also sends
 *  the loaded base colour as the vector parameter LoadedColor. */
export type MaterialRule = {
  name: string;
  /** alpha: true matches only loaded materials that are cut out or blended (alphaTest, transparent or a non-opaque
   *  glTF alphaMode), false only opaque ones. */
  match: {material?: string | string[]; map?: string | string[]; mesh?: string | string[]; url?: string | string[]; alpha?: boolean};
  material?: string;
  hide?: boolean;
  textures?: Record<string, string>;
  scalars?: Record<string, number>;
  vectors?: Record<string, number[]>;
  color?: boolean;
};
export type MaterialHit = {rule: MaterialRule; loaded: THREE.Material};

type Compiled = MaterialRule & {tests: ((o: THREE.Object3D, m: THREE.Material, url: string) => boolean)[]};
const glob = (patterns: string | string[]) => {
  const list = (Array.isArray(patterns) ? patterns : [patterns]).map(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'));
  return (s: string | undefined) => s !== undefined && list.some(r => r.test(s));
};

let compiled: Compiled[] | null = null;
/** The registry's rules, compiled once (the registry never changes while a game runs). */
export function materialRules(registryJson: string | undefined): Compiled[] {
  if (compiled) return compiled;
  try { compiled = compileMaterialRules(JSON.parse(registryJson || '{}').materials ?? []); } catch { compiled = []; }
  return compiled;
}

export function compileMaterialRules(list: MaterialRule[]): Compiled[] {
  const compiled: Compiled[] = [];
  {
    for (const r of list) {
      if (!r?.name || !r.match || (!r.material && !r.hide)) continue;
      const tests: Compiled['tests'] = [];
      const m = r.match;
      if (m.material) { const t = glob(m.material); tests.push((_o, mat) => t(mat.name)); }
      if (m.map) { const t = glob(m.map); tests.push((_o, mat) => t((mat as THREE.MeshStandardMaterial).map?.name)); }
      if (m.mesh) { const t = glob(m.mesh); tests.push(o => t(o.name)); }
      if (m.alpha !== undefined) tests.push((_o, mat) => (mat.transparent || mat.alphaTest > 0) === m.alpha);
      if (m.url) { const t = glob(m.url); tests.push((_o, _m, url) => t(url.replaceAll('\\', '/'))); }
      if (tests.length) compiled.push({...r, tests});
    }
  }
  return compiled;
}

// Each object's answers (one per material slot), kept while its geometry stays the same.
const cache = new WeakMap<THREE.Object3D, {geometry: unknown; hits: (MaterialHit | null)[]}>();
const logged = new Set<string>();

/** The rule each material slot of a mesh draws with, or null for the generic material. */
export function materialHits(o: THREE.Mesh, rules: Compiled[], log?: (text: string) => void): (MaterialHit | null)[] | null {
  if (!rules.length) return null;
  const seen = cache.get(o);
  if (seen && seen.geometry === o.geometry) return seen.hits;
  const src = sourceOf(o);
  const loaded = src?.material ? (Array.isArray(src.material) ? src.material : [src.material]) : [];
  const slots = Array.isArray(o.material) ? o.material.length : 1;
  const hits: (MaterialHit | null)[] = [];
  for (let i = 0; i < slots; i++) {
    const mat = loaded[i] ?? loaded[0];
    const rule = mat ? rules.find(r => r.tests.every(t => t(o, mat, src!.url))) : undefined;
    hits.push(rule ? {rule, loaded: mat} : null);
    if (rule && !logged.has(rule.name)) { logged.add(rule.name); log?.(`material rules: ${rule.name} ${rule.hide ? 'hides' : 'draws ' + rule.material + ' for'} "${mat.name}" on "${o.name}"`); }
  }
  cache.set(o, {geometry: o.geometry, hits});
  return hits;
}

/** The loaded textures a rule passes to Unreal, by Unreal parameter name. */
export function ruleTextures(hit: MaterialHit): Record<string, THREE.Texture> {
  const out: Record<string, THREE.Texture> = {};
  const m = hit.loaded as unknown as Record<string, THREE.Texture | null | undefined>;
  for (const [param, key] of Object.entries(hit.rule.textures ?? {})) { const t = m[key]; if (t?.isTexture) out[param] = t; }
  return out;
}
