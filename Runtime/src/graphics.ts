// Unreal graphics a game's options menu can offer: window.jsgb.graphics.
//   jsgb.graphics.get()           {lumen, available}: Lumen mode is on, and this host can turn it on
//   jsgb.graphics.set({lumen})    turns Lumen mode on or off while the game runs
//   jsgb.graphics.set({preset})   'epic', 'high', 'medium' or 'low': scalability groups, DLSS mode, frame generation and Lumen detail together
// Lumen mode is Unreal's Lumen lighting, the override models (overrides.json) and the Unreal effects that
// overrides.json turns on. The player can also switch it with F9. A "jsgbgraphicschange" event on window follows
// each change, whichever way it was made.
import {host} from './host';

type Graphics = {lumen: boolean; available: boolean; preset?: string};
const g = globalThis as unknown as Record<string, any>;
let json = '', state: Graphics = {lumen: false, available: false};

/** The state as the host last reported it. */
export const graphicsState = (): Graphics => state;

/** Reads the host's state once a frame and tells the page when it changed. */
export function refreshGraphics() {
  const now = host.graphics?.get() ?? '';
  if (now === json) return;
  json = now;
  try { state = {...state, ...JSON.parse(now)}; } catch { return; }
  g.dispatchEvent?.(new g.Event('jsgbgraphicschange'));
}

export const graphics = {
  get supported() { return !!host.graphics; },
  get: (): Graphics => ({...state}),
  set(change: Partial<Graphics>) { host.graphics?.set(JSON.stringify(change)); },
};
// jsgb.cache: the host's disk cache (Saved/JsGameBridge/WorkerCache) for results a game's own code wants to keep between launches.
const cache = {get: (key: string): ArrayBuffer | null => host.cache?.get(key) ?? null, put: (key: string, bytes: ArrayBuffer) => host.cache?.put(key, bytes)};
g.jsgb = Object.assign(g.jsgb ?? {}, {graphics, cache});
