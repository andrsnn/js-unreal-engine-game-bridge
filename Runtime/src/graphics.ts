// Unreal graphics a game's options menu can offer: window.jsgb.graphics.
//   jsgb.graphics.get()           {lumen, available, models}: Lumen mode is on, this host can turn it on, and the
//                                 override models have loaded (the game's own draw until then)
//   jsgb.graphics.set({lumen})    turns Lumen mode on or off while the game runs
// Lumen mode is Unreal's Lumen lighting, the override models (overrides.json) and the Unreal effects that
// overrides.json turns on. The player can also switch it with F9. A "jsgbgraphicschange" event on window follows
// each change, whichever way it was made.
import {host} from './host';

type Graphics = {lumen: boolean; available: boolean; models: boolean};
const g = globalThis as unknown as Record<string, any>;
let json = '', state: Graphics = {lumen: false, available: false, models: false};

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
g.jsgb = Object.assign(g.jsgb ?? {}, {graphics});
