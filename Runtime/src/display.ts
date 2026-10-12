// The display, for games that offer resolution and window settings: window.jsgb.display, and the standard Fullscreen
// API (element.requestFullscreen, document.exitFullscreen, document.fullscreenElement) on top of it. A change resizes
// the Unreal window, and the game sees resize events and new innerWidth and innerHeight as in a browser.
//   jsgb.display.modes()   [{width, height, refresh}, ...] the monitor supports
//   jsgb.display.get()     {width, height, mode: 'windowed' | 'borderless' | 'fullscreen', vsync, maxFps}
//   jsgb.display.set({width?, height?, mode?, vsync?, maxFps?})   a promise that resolves once applied (maxFps 0: no cap)
import {host} from './host';

type Settings = {width: number; height: number; mode: 'windowed' | 'borderless' | 'fullscreen'; vsync: boolean; maxFps: number};
const g = globalThis as unknown as Record<string, any>;
const parse = <T>(json: string | undefined, fallback: T): T => { try { return json ? JSON.parse(json) as T : fallback; } catch { return fallback; } };

export const display = {
  supported: !!host.display,
  modes(): {width: number; height: number; refresh: number}[] { return parse(host.display?.modes(), []); },
  get(): Settings { return parse(host.display?.get(), {width: g.innerWidth, height: g.innerHeight, mode: 'windowed', vsync: false, maxFps: 0}); },
  set(change: Partial<Settings>): Promise<Settings> {
    host.display?.set(JSON.stringify(change));
    // The host applies it on its next frame; the window's new size arrives as a resize event.
    return new Promise(resolve => setTimeout(() => resolve(display.get()), 100));
  },
};
g.jsgb = Object.assign(g.jsgb ?? {}, {display});

// Fullscreen API: borderless fullscreen on the monitor, back to a window on exit.
let fullscreenElement: unknown = null;
let windowed: Settings | null = null;
const doc = g.document;
const changed = () => { const e = new g.Event('fullscreenchange', {bubbles: true}); (fullscreenElement as {dispatchEvent?: (e: unknown) => void})?.dispatchEvent?.(e); doc.dispatchEvent(new g.Event('fullscreenchange')); };
try {
  Object.defineProperty(doc, 'fullscreenElement', {get: () => fullscreenElement, configurable: true});
  Object.defineProperty(doc, 'fullscreenEnabled', {get: () => display.supported, configurable: true});
  Object.defineProperty(doc, 'fullscreen', {get: () => !!fullscreenElement, configurable: true});
} catch { /* ignore */ }
g.Element.prototype.requestFullscreen = function (this: unknown) {
  if (!display.supported) return Promise.reject(new TypeError('Fullscreen is not available'));
  if (!fullscreenElement) windowed = display.get();
  fullscreenElement = this;
  return display.set({mode: 'borderless'}).then(() => { changed(); });
};
doc.exitFullscreen = function () {
  if (!fullscreenElement) return Promise.resolve();
  fullscreenElement = null;
  const back = windowed && windowed.mode !== 'borderless' ? {mode: windowed.mode, width: windowed.width, height: windowed.height} : {mode: 'windowed' as const};
  return display.set(back).then(() => { changed(); });
};
