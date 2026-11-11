import * as THREE from 'three-real';
import {sourceOf} from './overrides';

/** Skeletal swaps: a skinned glTF mesh that a registry asset names draws as that Unreal skeletal mesh, posed every
 *  frame from the game's own bones and morph targets, instead of being deformed on the CPU and sent as new geometry
 *  each frame. The asset:
 *    "skel:amala:top": {"skeletal": "/Game/Lifesim/Daz/SK/amala/SK_bardot_top",
 *                       "match": {"url": "*\/characters/daz/amala/lod*.glb", "gltfMesh": "bardot_top.lod*"}}
 *  GLTFLoader makes one three.js mesh per glTF primitive; the group of them (same parent, file and glTF mesh) is drawn
 *  once, by its first visible primitive, with one Unreal material slot per primitive, named after the material the
 *  primitive loaded with. Each frame sends, per joint, the matrix taking a bind-pose vertex to its place in the mesh
 *  (bindMatrixInverse * bone.matrixWorld * boneInverse * bindMatrix, as three's skinning shader computes it) and the
 *  joint's bind-pose position; the host fits the bind pose to the Unreal reference pose once and poses the mesh. */
export type SkeletalAsset = {skeletal?: string; match?: {url?: string | string[]; gltfMesh?: string | string[]}};
type Rule = {key: string; url: (s: string) => boolean; mesh: (s: string | undefined) => boolean};

const glob = (patterns: string | string[] | undefined) => {
  if (!patterns) return () => true;
  const list = (Array.isArray(patterns) ? patterns : [patterns]).map(p => new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i'));
  return (s: string | undefined) => s !== undefined && list.some(r => r.test(s));
};

let compiled: Rule[] | null = null;
export function skeletalRules(assets: Record<string, SkeletalAsset>): Rule[] {
  if (compiled) return compiled;
  compiled = compileSkeletalRules(assets);
  return compiled;
}
export function compileSkeletalRules(assets: Record<string, SkeletalAsset>): Rule[] {
  const out: Rule[] = [];
  for (const [key, a] of Object.entries(assets)) {
    if (!a?.skeletal || !a.match) continue;
    out.push({key, url: glob(a.match.url), mesh: glob(a.match.gltfMesh)});
  }
  return out;
}

export type SkeletalGroup = {key: string; leader: THREE.SkinnedMesh; members: THREE.SkinnedMesh[]};
const groups = new WeakMap<THREE.Object3D, SkeletalGroup | null>();

/** The skeletal group a skinned mesh belongs to, or null to draw it as an ordinary (CPU-deformed) mesh. */
export function skeletalGroup(o: THREE.SkinnedMesh, rules: Rule[]): SkeletalGroup | null {
  if (!rules.length || !o.skeleton) return null;
  const known = groups.get(o);
  if (known !== undefined && (!known || known.members.every(m => m.parent === o.parent))) return known;
  const src = sourceOf(o);
  const rule = src?.gltfMesh !== undefined ? rules.find(r => r.url(src.url.replaceAll('\\', '/')) && r.mesh(src.gltfMesh)) : undefined;
  if (!rule || !src) { groups.set(o, null); return null; }
  const members = ((o.parent?.children ?? [o]) as THREE.SkinnedMesh[]).filter(c => {
    if (!c.isSkinnedMesh) return false;
    const s = sourceOf(c);
    return s?.url === src.url && s.gltfMesh === src.gltfMesh;
  }).sort((a, b) => (sourceOf(a)?.primitive ?? 0) - (sourceOf(b)?.primitive ?? 0));
  const group = {key: rule.key, leader: members[0], members};
  for (const m of members) groups.set(m, group);
  return group;
}

const bindScratch = new THREE.Matrix4(), jointScratch = new THREE.Matrix4();
/** Per joint: its bind-pose position (3 floats), then the bind-to-current matrix (16, column-major). */
export function jointData(o: THREE.SkinnedMesh, out: (v: number) => void) {
  const bones = o.skeleton.bones, inverses = o.skeleton.boneInverses;
  for (let i = 0; i < bones.length; i++) {
    // Bind-pose joint position, in the space of the mesh's bind-pose vertices: (boneInverse * bindMatrix)^-1 * origin.
    bindScratch.multiplyMatrices(inverses[i], o.bindMatrix).invert();
    const e = bindScratch.elements; out(e[12]); out(e[13]); out(e[14]);
  }
  for (let i = 0; i < bones.length; i++) {
    const b = bones[i];
    jointScratch.multiplyMatrices(o.bindMatrixInverse, b ? b.matrixWorld : bindScratch.identity());
    jointScratch.multiply(inverses[i]).multiply(o.bindMatrix);
    const e = jointScratch.elements; for (let k = 0; k < 16; k++) out(e[k]);
  }
}

/** The names the host needs once per asset: joints, morph targets in influence order, material slots by primitive. */
export function skeletonInfo(g: SkeletalGroup): {bones: string[]; morphs: string[]; slots: string[]} {
  const dict = g.leader.morphTargetDictionary ?? {};
  const morphs: string[] = [];
  for (const [name, i] of Object.entries(dict)) morphs[i] = name;
  const slotName = (m: THREE.SkinnedMesh) => { const mat = sourceOf(m)?.material; return (Array.isArray(mat) ? mat[0] : mat)?.name ?? ''; };
  return {bones: g.leader.skeleton.bones.map(b => b?.name ?? ''), morphs: Array.from(morphs, m => m ?? ''), slots: g.members.map(slotName)};
}

/** Hidden triangles of a swapped primitive as a mask texture over its UVs. A game hides part of a skinned mesh by
 *  dropping triangles from its index (lifesim drops the body under worn clothes); the Unreal skeletal mesh keeps all
 *  of them, so the host's material clips where this mask is white ("HideMask", sampled at frac(UV)). Null when the
 *  primitive draws everything. The original index is the geometry's userData.fullIndex when the game keeps one,
 *  else the index the first time it was seen. */
const firstIndex = new WeakMap<THREE.BufferGeometry, ArrayLike<number>>();
const masks = new WeakMap<THREE.BufferGeometry, {key: string; tex: THREE.DataTexture | null}>();
export const HIDE_MASK_SIZE = 512;
export function hideMask(m: THREE.SkinnedMesh): THREE.DataTexture | null {
  const g = m.geometry, ix = g?.index, uv = g?.getAttribute('uv') as THREE.BufferAttribute | undefined;
  if (!ix || !uv) return null;
  const kept = (g.userData?.fullIndex as THREE.BufferAttribute | undefined)?.array ?? firstIndex.get(g);
  if (!kept) { firstIndex.set(g, (ix.array as Uint32Array).slice()); return null; }
  if (ix.count >= kept.length) return null;
  const key = `${ix.version}|${ix.count}`;
  const had = masks.get(g); if (had?.key === key) return had.tex;
  // Kept triangles are the original's in order with some left out: walk both and collect the ones dropped.
  const cur = ix.array, full = kept, hidden: number[] = [];
  let j = 0;
  for (let i = 0; i + 2 < full.length; i += 3) {
    if (j + 2 < cur.length && cur[j] === full[i] && cur[j + 1] === full[i + 1] && cur[j + 2] === full[i + 2]) { j += 3; continue; }
    hidden.push(full[i], full[i + 1], full[i + 2]);
  }
  const N = HIDE_MASK_SIZE, data = new Uint8Array(N * N * 4);
  const U = (v: number) => (uv.getX(v) % 1 + 1) % 1 * N, V = (v: number) => (uv.getY(v) % 1 + 1) % 1 * N;
  const paint = (tris: ArrayLike<number>, value: number) => {
    for (let t = 0; t + 2 < tris.length; t += 3) {
      const ax = U(tris[t]), ay = V(tris[t]), bx = U(tris[t + 1]), by = V(tris[t + 1]), cx = U(tris[t + 2]), cy = V(tris[t + 2]);
      // A triangle across a tile edge (frac wrapped one corner) is skipped rather than drawn across the whole tile.
      if (Math.max(ax, bx, cx) - Math.min(ax, bx, cx) > N / 2 || Math.max(ay, by, cy) - Math.min(ay, by, cy) > N / 2) continue;
      const x0 = Math.max(0, Math.floor(Math.min(ax, bx, cx)) - 1), x1 = Math.min(N - 1, Math.ceil(Math.max(ax, bx, cx)) + 1);
      const y0 = Math.max(0, Math.floor(Math.min(ay, by, cy)) - 1), y1 = Math.min(N - 1, Math.ceil(Math.max(ay, by, cy)) + 1);
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-9) continue;
      // Pixels whose centre is inside, or within about a pixel of an edge (so neighbouring triangles leave no seams).
      const e = 0.75 / Math.sqrt(Math.abs(area));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 >= -e && w1 >= -e && w2 >= -e) { const o = (y * N + x) * 4; data[o] = data[o + 1] = data[o + 2] = data[o + 3] = value; }
      }
    }
  };
  paint(hidden, 255);
  // Kept triangles win every pixel they touch. The hidden pass's one-pixel pad reached into kept triangles at the
  // edge of the covered area and across UV islands packed next to it (a different part of the body), and the host
  // clips wherever the mask is white: thick black slashes over shoulders and collarbones (lifesim unreal-21 s4).
  paint(cur, 0);
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.name = 'jsgb-hide-mask'; tex.colorSpace = THREE.NoColorSpace; tex.flipY = false; tex.needsUpdate = true;
  had?.tex?.dispose();
  masks.set(g, {key, tex});
  return tex;
}
