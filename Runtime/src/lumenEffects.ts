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
 *  - trails: missiles and torpedoes under power (userData.plumeKey and motorActive).
 *  - explosions: every other userData.flashLight (hits, blasts).
 *  - Niagara rules (overrides.json rules with "niagara", such as lit vapour at each of the game's vents): the system plays
 *    at the object, pointed along userData.surfaceNormal or incomingDirection, sized from the effect's own size, for as
 *    long as the object is in the scene, so it starts and stops with the game's effect.
 *  A flash light's intensity, reach and colour are the game's own (it lights its own three brightest flashes the same
 *  way, at a quarter of flashLight.intensity), so Unreal lights the flashes the game has no light left for. */

export type EffectLight = {id: object; color: THREE.Color; intensity: number; at: THREE.Vector3; dir: THREE.Vector3; distance: number; length: number; radius: number};

const MAX = {engine: 32, flash: 24, round: 16, motor: 16};
const ENGINE_CANDELA = 100;
const MOTOR_CANDELA = 400;
const ROUND_CANDELA = 60;

type Noted = {o: THREE.Object3D; d: number};
const plumes: Noted[] = [], flashes: Noted[] = [], rounds: Noted[] = [], motors: Noted[] = [];
const playing: {o: THREE.Object3D; key: string}[] = [];
const at = new THREE.Vector3(), scale = new THREE.Vector3(), back = new THREE.Vector3();
let flags: EffectFlags | null = null, eye = new THREE.Vector3(), topScene: THREE.Object3D | null = null;

/** Starts a frame: which effects are on, and where the camera is. */
export function beginEffects(f: EffectFlags | null, cam: THREE.Camera, scene: THREE.Object3D) {
  flags = f; eye = cam.position; topScene = scene;
  plumes.length = flashes.length = rounds.length = motors.length = playing.length = 0;
}

/** Notes an object of the game view that one of the switched-on effects follows. */
export function noteEffect(o: THREE.Object3D) {
  const u = o.userData, f = flags;
  if (!f || !u) return;
  const key = typeof u.vfxKey === 'string' ? u.vfxKey : '';
  if (key && !u.done) for (const r of systemRules(host.registry)) if (r.tests.every(t => t(o, undefined))) { playing.push({o, key: r.key}); break; }
  const d = () => o.getWorldPosition(at).distanceToSquared(eye);
  if (f.engineLight && key.startsWith('plume.')) { plumes.push({o, d: d()}); return; }
  if (u.done) return;
  const flash = u.flashLight as {intensity?: number} | undefined;
  const weapon = key.startsWith('weapon.') || !!u.weaponMuzzle;
  if (flash && (flash.intensity ?? 0) > 0) {
    if (weapon ? f.gunfire : f.explosions) flashes.push({o, d: flashImportance(o)});
    return;
  }
  if (f.trails && u.plumeKey && u.motorActive) { motors.push({o, d: d()}); return; }
  if (f.gunfire && u.roundDraw?.cores) rounds.push({o, d: (u.roundDraw.b as THREE.Vector3).distanceToSquared(eye)});
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
    out({id: o, color: new THREE.Color(u.driveColour ?? 0xff8a3a), intensity: ENGINE_CANDELA * throttle * width * width, at: p, dir: new THREE.Vector3(0, 0, -1), distance: width * 15, length: 0, radius: width * .5});
  }
  // The game's three brightest flashes already have its own lights: skip those among the scene's top-level flashes.
  const own = flashes.filter(n => n.o.parent === topScene && n.o.visible && !n.o.userData.nuclearDetonation).sort((a, b) => a.d - b.d).slice(0, 3).map(n => n.o);
  for (const {o} of nearest(flashes, MAX.flash + 3)) {
    if (own.includes(o)) continue;
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
