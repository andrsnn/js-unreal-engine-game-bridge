/** window.jsgb.camera: a game's orbit camera moved by the host, so camera keys move the view on the next drawn frame.
 *
 *  A game (or a bridge adapter for it) declares its rig once:
 *
 *    jsgb.camera.rig({
 *      camera: () => threeCamera,
 *      get: () => ({target: [x, y, z], theta, phi, radius, input: true, limit: {x, z, radius} | null}),
 *      set: state => { ...adopt state.target, state.theta, state.phi, state.radius... },
 *      config: () => ({keys: {forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'], orbitLeft: ['KeyQ'],
 *                      orbitRight: ['KeyE'], zoomIn: ['Equal'], zoomOut: ['Minus']},
 *                      pan: 0.35, orbit: 0.7, zoomKey: 4, minPolar, maxPolar, minRadius, maxRadius}),
 *    });
 *
 *  theta, phi and radius are three.js Spherical angles around the target; pan is a share of the radius per second,
 *  orbit radians per second, and a zoom key changes the radius by pan step times zoomKey. `input` false (a menu or a
 *  text field has the keys) stops the host moving the camera. The game must then leave those keys to the host: it
 *  still gets the key events, but its own update must not move the camera with them.
 *
 *  Each game frame starts with set(the host's camera) and ends with get(): what the game changed itself in that frame
 *  (a glide, following a ship, wheel zoom, a drag) is added to the host's camera. In a browser jsgb.camera does not
 *  exist, so the game behaves as it always has. */
import {host} from './host';
import {lastFrame} from './renderer';

export type CameraState = {target: [number, number, number]; theta: number; phi: number; radius: number; input?: boolean;
  limit?: {x: number; z: number; radius: number} | null};
type Rig = {get(): CameraState; set(state: CameraState & {v: number}): void; config(): Record<string, unknown>;
  /** The three.js camera the rig places. The host drives the view only while the game draws with it. */
  camera?(): unknown};

let rig: Rig | null = null, version = 0, lastConfig = '';
let lastGiven: CameraState | null = null;

export const camera = {
  /** Hands the camera to the host (or back to the game with null). Returns whether the host drives it. */
  rig(next: Rig | null): boolean {
    if (!host.camera) return false;
    rig = next; version = 0; lastConfig = ''; lastGiven = null;
    if (!next) host.camera.off();
    return !!next;
  },
  get available() { return !!host.camera; },
};
const g = globalThis as Record<string, any>;
g.jsgb = Object.assign(g.jsgb ?? {}, {camera});

/** Before the game's frame: the game adopts the host's camera. */
export function cameraFrameStart() {
  if (!rig || !host.camera) return;
  const text = host.camera.take();
  if (!text) return;
  try {
    const state = JSON.parse(text) as CameraState & {v: number}; version = state.v;
    // Events and async callbacks can change the game pose between frames. Adopt only the
    // host's change since Give, preserving those changes (cuts, map rebases, wheel/drag).
    if (lastGiven) {
      const current = rig.get();
      state.target = state.target.map((x, i) => x + current.target[i] - lastGiven!.target[i]) as [number, number, number];
      state.theta += Math.atan2(Math.sin(current.theta - lastGiven.theta), Math.cos(current.theta - lastGiven.theta));
      state.phi += current.phi - lastGiven.phi;
      state.radius += current.radius - lastGiven.radius;
    }
    rig.set(state);
  }
  catch (e) { host.log('error', 'camera rig set: ' + (e instanceof Error ? e.stack : e)); }
}

/** After the game's frame: what the game made of the camera goes back to the host. */
export function cameraFrameEnd() {
  if (!rig || !host.camera) return;
  try {
    const config = JSON.stringify(rig.config());
    if (config !== lastConfig) { lastConfig = config; host.camera.config(config); }
    const state = rig.get();
    // The host draws the camera from the rig only while the game draws with the rig's camera where the rig puts it (not
    // another camera, nor a first-person or close-up view that places this camera itself).
    let drive = !rig.camera || lastFrame.camera === rig.camera();
    const cam = rig.camera?.() as {matrixWorld?: {elements: ArrayLike<number>}} | undefined;
    if (drive && cam?.matrixWorld) {
      const e = cam.matrixWorld.elements, s = Math.sin(state.phi), r = state.radius;
      const dx = e[12] - (state.target[0] + r * s * Math.sin(state.theta)), dy = e[13] - (state.target[1] + r * Math.cos(state.phi)), dz = e[14] - (state.target[2] + r * s * Math.cos(state.theta));
      drive = Math.hypot(dx, dy, dz) <= Math.max(1e-3, r * 0.01);
    }
    // Keep rotation the game adds after placing its orbit camera (for example explosion shake).
    const e = cam?.matrixWorld?.elements;
    const axes = drive && e ? [e[8], e[9], e[10], e[4], e[5], e[6]] : undefined;
    host.camera.give(version, JSON.stringify({...state, drive, axes}));
    lastGiven = {...state, target: [...state.target]};
  } catch (e) { host.log('error', 'camera rig get: ' + (e instanceof Error ? e.stack : e)); }
}
