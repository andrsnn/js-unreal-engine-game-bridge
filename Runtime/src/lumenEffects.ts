import * as THREE from 'three-real';
import type {EffectFlags} from './overrides';
import {systemRules} from './overrides';
import {host} from './host';

/** Unreal effects in Lumen mode: lights that follow the objects a game already uses for its own effects, so they keep
 *  the game's look and timing. The game's sprites still draw as they are; Unreal adds the light they would cast on the
 *  hulls around them. overrides.json "effects" switches each one (overrides.ts EffectFlags). They read the userData
 *  conventions Hard Burn's effect objects carry:
 *  - engineLight: drive plumes, userData.vfxKey "plume.*", with throttle, nozzleWidth and driveColour.
 *  - gunfire: muzzle flashes (userData.flashLight on an object whose vfxKey is "weapon.*", or weaponMuzzle), and kinetic
 *    rounds in flight (userData.roundDraw: head b, tail a, colour, cores while flying).
 *  - bigMuzzle: the muzzle flashes of large and huge guns, which the game draws 1.6 and 2.4 times bigger. Hard Burn fires
 *    a smoky muzzle blast (blastKind "flak", userData.effectScale.blastRadius) at the muzzle with each of their shots and
 *    with no other gun's, so a weapon flash within that blast's radius belongs to a big gun. Other flashes stay gunfire's.
 *  - trails: missiles and torpedoes under power (userData.plumeKey and motorActive).
 *  - explosions: every other userData.flashLight (hits, blasts), and the glow of each detonation fireball sprite
 *    (the InstancedMesh "sprite-vfx-fireball", whose 'sprite' attribute holds each fireball's flipbook frame and fade).
 *  - debris: the hot blast fragments (the InstancedMesh "ballistic-blast-metal", whose 'debrisState' attribute holds
 *    each fragment's heat and opacity), each light following its fragment and cooling with it.
 *  - Niagara rules (overrides.json rules with "niagara", such as lit vapour at each of the game's vents): the system plays
 *    at the object, pointed along userData.surfaceNormal or incomingDirection, sized from the effect's own size, for as
 *    long as the object is in the scene, so it starts and stops with the game's effect.
 *  A flash light's intensity, reach and colour are the game's own (it lights its own three brightest flashes the same
 *  way, at a quarter of flashLight.intensity, and its first nuclear detonation with a light of its own), so Unreal
 *  lights the flashes the game has no light left for. */

export type EffectLight = {id: object; color: THREE.Color; intensity: number; at: THREE.Vector3; dir: THREE.Vector3; distance: number; length: number; radius: number};

const MAX = {engine: 32, flash: 24, round: 16, motor: 16, fireball: 12, shard: 8};
// An engine light at full throttle, per square nozzle width; 100, then 30, washed a capital's own red hull in its purple drive light.
const ENGINE_CANDELA = 12;
// The light is the drive's colour mixed 60% toward white: a pure purple MRN drive painted magenta strips on the hulls near it.
const ENGINE_WASH = .6, WHITE = new THREE.Color(1, 1, 1);
const MOTOR_CANDELA = 400;
const ROUND_CANDELA = 60;
// A fireball at the peak of its glow, per square world unit of the sprite: a size 1 missile blast's fireball (about 1.2
// across at its peak) gives about half the light of the game's own flash for that blast (60 x .25), for half a second
// instead of a tenth.
const FIREBALL_CANDELA = 6;
// A fragment at full heat, per square world unit of the fragment, lighting about 40 times its own size around it.
const SHARD_CANDELA = 400;
// How much the fireball flipbook (textures/vfx/sprites/detonation-fireball.webp) glows at each of its 16 frames: its hot
// orange pixels times their brightness, 1 at the peak. It peaks at frames 3 and 4, and frame 9 on is dark smoke.
const FIREBALL_GLOW = [.018, .171, .508, .936, 1, .385, .099, .037, .008, 0, 0, 0, 0, 0, 0, 0];
// A fragment's emissive colour in the game's shader: mix(dull red, white-orange, heat^2) x heat^2.
const DULL = [.35, .05, .01], HOT = [1.2, .75, .42];
const luminance = (r: number, g: number, b: number) => .2126 * r + .7152 * g + .0722 * b;
const HOT_LUMINANCE = luminance(HOT[0], HOT[1], HOT[2]);

type Noted = {o: THREE.Object3D; d: number};
const plumes: Noted[] = [], flashes: Noted[] = [], rounds: Noted[] = [], motors: Noted[] = [], topFlashes: Noted[] = [], muzzles: Noted[] = [];
const muzzleBlasts: THREE.Object3D[] = [];
const fireballMeshes: THREE.InstancedMesh[] = [], shardMeshes: THREE.InstancedMesh[] = [];
const playing: {o: THREE.Object3D; key: string}[] = [];
const at = new THREE.Vector3(), scale = new THREE.Vector3(), back = new THREE.Vector3();
let flags: EffectFlags | null = null, eye = new THREE.Vector3(), topScene: THREE.Object3D | null = null;

/** Starts a frame: which effects are on, and where the camera is. */
export function beginEffects(f: EffectFlags | null, cam: THREE.Camera, scene: THREE.Object3D) {
  flags = f; eye = cam.position; topScene = scene;
  plumes.length = flashes.length = rounds.length = motors.length = playing.length = topFlashes.length = muzzles.length = muzzleBlasts.length = 0;
  fireballMeshes.length = shardMeshes.length = 0;
}

/** Notes an object of the game view that one of the switched-on effects follows. */
export function noteEffect(o: THREE.Object3D) {
  const u = o.userData, f = flags;
  if (!f || !u) return;
  const key = typeof u.vfxKey === 'string' ? u.vfxKey : '';
  if (key && !u.done) for (const r of systemRules(host.registry)) if (r.tests.every(t => t(o, undefined))) { playing.push({o, key: r.key}); break; }
  const im = o as THREE.InstancedMesh;
  if (im.isInstancedMesh) {
    if (f.explosions && o.name === 'sprite-vfx-fireball' && im.geometry.getAttribute('sprite')) fireballMeshes.push(im);
    else if (f.debris && im.geometry.getAttribute('debrisState')) shardMeshes.push(im);
  }
  const d = () => o.getWorldPosition(at).distanceToSquared(eye);
  if (f.engineLight && key.startsWith('plume.')) { plumes.push({o, d: d()}); return; }
  if (u.done) return;
  // A big gun's muzzle blast: smoke with no flash of its own (blast-pool.js burst with smoke).
  if (u.blastKind === 'flak' && u.effectScale?.blastRadius > 0) muzzleBlasts.push(o);
  const flash = u.flashLight as {intensity?: number} | undefined;
  const weapon = key.startsWith('weapon.') || !!u.weaponMuzzle;
  if (flash && (flash.intensity ?? 0) > 0) {
    // Every flash the game itself could light, whichever effects are on (main.js lights the top-level ones).
    if (o.parent === topScene) topFlashes.push({o, d: flashImportance(o)});
    // A muzzle flash waits until every blast of the frame is noted: whether it is a big gun's decides its switch.
    if (weapon ? f.gunfire || f.bigMuzzle : f.explosions) (weapon ? muzzles : flashes).push({o, d: flashImportance(o)});
    return;
  }
  if (f.trails && u.plumeKey && u.motorActive) { motors.push({o, d: d()}); return; }
  if (f.gunfire && u.roundDraw?.cores) rounds.push({o, d: (u.roundDraw.b as THREE.Vector3).distanceToSquared(eye)});
}

// A large or huge gun's flash: the game fired a muzzle blast at the same point (entities.js fireWeapon).
const blastAt = new THREE.Vector3();
function bigGunFlash(o: THREE.Object3D) {
  const p = (o.userData.flashLight.position as THREE.Vector3 | undefined) ?? o.getWorldPosition(at);
  return muzzleBlasts.some(b => b.getWorldPosition(blastAt).distanceTo(p) <= b.userData.effectScale.blastRadius);
}

// The game's own order for its flash lights (main.js flashImportance).
function flashImportance(o: THREE.Object3D) {
  const f = o.userData.flashLight;
  return -f.intensity / (1 + ((f.position as THREE.Vector3 | undefined) ?? o.position).distanceToSquared(eye) * .002);
}

/** The lights this frame, nearest (or most important) first within each kind. */
export function effectLights(out: (l: EffectLight) => void) {
  const nearest = (list: Noted[], n: number) => { list.sort((a, b) => a.d - b.d); if (list.length > n) list.length = n; return list; };
  for (const {o} of nearest(plumes, MAX.engine)) {
    const u = o.userData;
    const throttle = Math.min(1.2, Math.max(0, u.throttle ?? 0.65));
    if (throttle < 0.025) continue;
    o.getWorldScale(scale);
    // The nozzle's width in world units; the light sits one nozzle width behind it, inside the flame. Candela that
    // scale with the nozzle's area light a big or small ship's stern the same.
    const width = Math.max(1e-3, (u.nozzleWidth ?? 1) * Math.max(scale.x, scale.y));
    const p = o.getWorldPosition(new THREE.Vector3()).add(back.set(0, 0, -1).transformDirection(o.matrixWorld).multiplyScalar(width));
    out({id: o, color: new THREE.Color(u.driveColour ?? 0xff8a3a).lerp(WHITE, ENGINE_WASH), intensity: ENGINE_CANDELA * throttle * width * width, at: p, dir: new THREE.Vector3(0, 0, -1), distance: width * 10, length: 0, radius: width * .5});
  }
  // The game already lights its three brightest top-level flashes and its brightest nuclear detonation (main.js
  // impactLights and nuclearLight, ranked among all its flashes, muzzle flashes too): skip those.
  const own = new Set<THREE.Object3D>();
  let ordinary = 0, nuke = false;
  for (const {o} of topFlashes.sort((a, b) => a.d - b.d)) {
    if (o.userData.nuclearDetonation) { if (!nuke) { nuke = true; own.add(o); } } else if (ordinary < 3) { ordinary++; own.add(o); }
  }
  for (const m of muzzles) if (bigGunFlash(m.o) ? flags?.bigMuzzle : flags?.gunfire) flashes.push(m);
  for (const {o} of nearest(flashes, MAX.flash + own.size)) {
    if (own.has(o)) continue;
    const f = o.userData.flashLight;
    const p = ((f.position as THREE.Vector3 | undefined)?.clone() ?? o.getWorldPosition(new THREE.Vector3()));
    out({id: o, color: new THREE.Color(f.color ?? 0xffb060), intensity: f.intensity * .25, at: p, dir: new THREE.Vector3(0, 0, -1), distance: Math.min(240, f.distance ?? 60), length: 0, radius: 0});
  }
  for (const {o} of nearest(motors, MAX.motor)) {
    // A torch behind the missile, along its flight, in a hot drive colour.
    o.getWorldScale(scale);
    const size = Math.max(.05, Math.max(scale.x, scale.y, scale.z));
    out({id: o, color: new THREE.Color(0xffc184), intensity: MOTOR_CANDELA * size * size, at: o.getWorldPosition(new THREE.Vector3()), dir: new THREE.Vector3(0, 0, -1), distance: size * 40, length: 0, radius: size * .3});
  }
  for (const {o} of nearest(rounds, MAX.round)) {
    // A line of light along the slug and the start of its wake, so hulls it passes light up along its path.
    const r = o.userData.roundDraw as {a: THREE.Vector3; b: THREE.Vector3; color: THREE.Color; coreColor: THREE.Color; width: number; opacity: number};
    const span = r.b.clone().sub(r.a), len = Math.min(span.length(), 40 * Math.max(.05, r.width));
    if (len <= 0) continue;
    const dir = span.normalize();
    out({id: o, color: r.color.clone(), intensity: ROUND_CANDELA * Math.max(.05, r.width) ** 2 * 25 * (r.opacity || 1), at: r.b.clone().addScaledVector(dir, -len / 2), dir, distance: len * 1.5, length: len, radius: r.width * .5});
  }
  emitPicked(fireballs(), fireballIds, out);
  emitPicked(shards(), shardIds, out);
}

type Pick = {d: number; color: THREE.Color; intensity: number; at: THREE.Vector3; distance: number; radius: number};
const pickOrder = (a: Pick, b: Pick) => a.d - b.d;
// The game's own order for lights: brightest, discounted by distance from the camera (main.js flashImportance).
const importance = (intensity: number, p: THREE.Vector3) => -intensity / (1 + p.distanceToSquared(eye) * .002);
const worldAt = (e: ArrayLike<number>, k: number, world: THREE.Matrix4) => new THREE.Vector3(e[k + 12], e[k + 13], e[k + 14]).applyMatrix4(world);

/** Fireball sprites, lit by how much their flipbook frame glows, times their fade and tint. */
function fireballs(): Pick[] {
  const picks: Pick[] = [];
  for (const mesh of fireballMeshes) {
    const state = mesh.geometry.getAttribute('sprite'), e = mesh.instanceMatrix.array, tint = mesh.instanceColor?.array;
    const world = mesh.matrixWorld.getMaxScaleOnAxis();
    for (let i = 0, n = Math.min(mesh.count, state.count); i < n; i++) {
      const frame = Math.min(15, Math.max(0, state.getX(i))), a = Math.floor(frame), b = Math.min(15, a + 1);
      const glow = (FIREBALL_GLOW[a] + (FIREBALL_GLOW[b] - FIREBALL_GLOW[a]) * (frame - a)) * Math.max(0, state.getY(i)) * (tint ? tint[i * 3] : 1);
      if (glow < .01) continue;
      const size = Math.hypot(e[i * 16], e[i * 16 + 1], e[i * 16 + 2]) * world;
      const p = worldAt(e, i * 16, mesh.matrixWorld), intensity = FIREBALL_CANDELA * size * size * glow;
      picks.push({d: importance(intensity, p), color: new THREE.Color().setRGB(1, .72, .38), intensity, at: p, distance: Math.min(240, Math.max(3, size * 5)), radius: size * .3});
    }
  }
  return picks.sort(pickOrder).slice(0, MAX.fireball);
}

/** Hot blast fragments, lit in their emissive colour, fading as they cool and as they fade out. */
function shards(): Pick[] {
  const picks: Pick[] = [];
  for (const mesh of shardMeshes) {
    const state = mesh.geometry.getAttribute('debrisState'), e = mesh.instanceMatrix.array;
    const world = mesh.matrixWorld.getMaxScaleOnAxis();
    for (let i = 0, n = Math.min(mesh.count, state.count); i < n; i++) {
      const heat = Math.min(1, state.getX(i)), h2 = heat * heat;
      if (h2 < .01) continue;
      const r = DULL[0] + (HOT[0] - DULL[0]) * h2, g = DULL[1] + (HOT[1] - DULL[1]) * h2, b = DULL[2] + (HOT[2] - DULL[2]) * h2;
      const glow = luminance(r, g, b) * h2 / HOT_LUMINANCE * Math.min(1, Math.max(0, state.getY(i)));
      if (glow < .005) continue;
      const k = i * 16, w = Math.max(Math.hypot(e[k], e[k + 1], e[k + 2]), Math.hypot(e[k + 4], e[k + 5], e[k + 6]), Math.hypot(e[k + 8], e[k + 9], e[k + 10])) * world;
      const p = worldAt(e, k, mesh.matrixWorld), intensity = SHARD_CANDELA * w * w * glow, top = Math.max(r, g, b);
      picks.push({d: importance(intensity, p), color: new THREE.Color().setRGB(r / top, g / top, b / top), intensity, at: p, distance: w * 40, radius: w * .5});
    }
  }
  return picks.sort(pickOrder).slice(0, MAX.shard);
}

/** A fixed set of light ids for lights that follow instances: an instance has no object of its own, and its place in
 *  the instance buffer moves as others come and go. A light keeps last frame's id when one of this frame's picks is
 *  near where it was, so Unreal moves the same light along with the fragment instead of jumping between fragments. */
type Track = {id: object; at: THREE.Vector3; live: boolean};
const ids = (n: number): Track[] => Array.from({length: n}, () => ({id: {}, at: new THREE.Vector3(), live: false}));
const fireballIds = ids(MAX.fireball), shardIds = ids(MAX.shard);
function emitPicked(picks: Pick[], pool: Track[], out: (l: EffectLight) => void) {
  const given: (Track | undefined)[] = [], taken = new Set<Track>();
  picks.forEach((p, i) => {
    let best: Track | undefined, bestD = Math.max(p.distance, 1e-3) * 2;
    for (const t of pool) if (t.live && !taken.has(t)) { const d = t.at.distanceTo(p.at); if (d < bestD) { best = t; bestD = d; } }
    if (best) { taken.add(best); given[i] = best; }
  });
  picks.forEach((p, i) => {
    const t = given[i] ?? pool.find(t => !t.live && !taken.has(t)) ?? pool.find(t => !taken.has(t))!;
    taken.add(t); t.at.copy(p.at);
    out({id: t.id, color: p.color, intensity: p.intensity, at: p.at, dir: new THREE.Vector3(0, 0, -1), distance: p.distance, length: 0, radius: p.radius});
  });
  for (const t of pool) t.live = taken.has(t);
}

const up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3(), turn = new THREE.Quaternion(), size3 = new THREE.Vector3();
/** The Niagara systems this frame: the registry key and the world matrix each one plays at. */
export function effectSystems(out: (o: THREE.Object3D, key: string, matrix: THREE.Matrix4) => void) {
  for (const {o, key} of playing) {
    const u = o.userData;
    const dir = (u.surfaceNormal ?? u.incomingDirection) as THREE.Vector3 | undefined;
    axis.copy(dir && dir.lengthSq() > 1e-12 ? dir : up).normalize();
    turn.setFromUnitVectors(up, axis);
    // The effect's size: a flash pool slot keeps it in flashLight.distance (8 x size, at least 3); a sprite in its scale.
    const reach = u.flashLight?.distance as number | undefined;
    const size = reach ? Math.max(.375, reach / 8) : Math.max(1e-3, o.getWorldScale(size3).x);
    out(o, key, new THREE.Matrix4().compose(o.getWorldPosition(new THREE.Vector3()), turn, size3.setScalar(size)));
  }
}
