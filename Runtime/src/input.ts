/** Input from the Unreal host, delivered as the same DOM events a browser would fire: window
 *  capture listeners first, then the target element's capture/bubble path, then window bubble. */
const g = globalThis as Record<string, any>;

type Entry = {fn: EventListenerOrEventListenerObject; capture: boolean; once: boolean};
type Ev = Record<string, any>;

export class WindowTarget {
  private map = new Map<string, Entry[]>();
  addEventListener(type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) {
    if (!fn) return;
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture, once = typeof opts === 'object' && !!opts?.once;
    const list = this.map.get(type) ?? []; if (list.some(e => e.fn === fn && e.capture === capture)) return;
    list.push({fn, capture, once}); this.map.set(type, list);
    const signal = typeof opts === 'object' ? opts?.signal : undefined;
    signal?.addEventListener?.('abort', () => this.removeEventListener(type, fn, opts));
  }
  removeEventListener(type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions) {
    const capture = typeof opts === 'boolean' ? opts : !!opts?.capture;
    const list = this.map.get(type); if (!list) return;
    this.map.set(type, list.filter(e => !(e.fn === fn && e.capture === capture)));
  }
  /** phase: 'capture' runs capture listeners, 'bubble' the rest, 'all' both (window-targeted events). */
  fire(e: Ev, phase: 'capture' | 'bubble' | 'all') {
    for (const entry of [...(this.map.get(e.type) ?? [])]) {
      if (phase === 'capture' && !entry.capture) continue;
      if (phase === 'bubble' && entry.capture) continue;
      if (entry.once) this.removeEventListener(e.type, entry.fn, entry.capture);
      try { Object.defineProperty(e, 'currentTarget', {value: g, configurable: true, writable: true}); } catch { /* frozen */ }
      try { typeof entry.fn === 'function' ? entry.fn.call(g, e as unknown as Event) : entry.fn.handleEvent(e as unknown as Event); }
      catch (error) { g.__jsgbHost?.log('error', `window ${e.type} listener: ${error instanceof Error ? error.stack : error}`); }
      if (e.__jsgbImmediate) break;
    }
  }
  dispatchEvent(e: Ev) {
    track(e);
    try { Object.defineProperty(e, 'target', {value: g, configurable: true, writable: true}); } catch { /* ignore */ }
    this.fire(e, 'all');
    return !e.defaultPrevented;
  }
}

function track(e: Ev) {
  if (e.__jsgbTracked) return; e.__jsgbTracked = true;
  const stop = e.stopPropagation?.bind(e), stopNow = e.stopImmediatePropagation?.bind(e);
  e.stopPropagation = () => { e.__jsgbStopped = true; stop?.(); };
  e.stopImmediatePropagation = () => { e.__jsgbStopped = e.__jsgbImmediate = true; stopNow?.(); };
}

export const windowTarget = new WindowTarget();

/** Delivers a host event to `target` through the full browser path. */
export function deliver(target: Ev | null, e: Ev): boolean {
  track(e);
  // A browser sets the target before any listener runs, window capture listeners included (games read e.target there).
  if (target && e.target == null) { try { Object.defineProperty(e, 'target', {value: target, configurable: true}); } catch { /* read-only */ } }
  windowTarget.fire(e, 'capture');
  if (!e.__jsgbStopped && target) target.dispatchEvent(e);
  // The DOM shim clears target after dispatch. Window bubble is still part of this dispatch.
  if (target) { try { Object.defineProperty(e, 'target', {value: target, configurable: true}); } catch { /* read-only */ } }
  if (!e.__jsgbStopped && e.bubbles !== false) windowTarget.fire(e, 'bubble');
  return !e.defaultPrevented;
}

const pointer = {x: 0, y: 0, buttons: 0};
function gameSurface(): Ev {
  const doc = g.document;
  return g.__jsgbCanvas?.isConnected ? g.__jsgbCanvas : doc.querySelector('canvas') ?? doc.body;
}
function keyTarget(): Ev {
  const doc = g.document, active = doc.activeElement;
  return active && active !== doc.body ? active : doc.body;
}

const KEYS: Record<string, string> = {Space: ' ', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace', ShiftLeft: 'Shift', ShiftRight: 'Shift',
  ControlLeft: 'Control', ControlRight: 'Control', AltLeft: 'Alt', AltRight: 'Alt', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight', Delete: 'Delete'};
function keyFor(code: string, shift: boolean) {
  if (KEYS[code]) return KEYS[code];
  if (/^Key[A-Z]$/.test(code)) return shift ? code[3] : code[3].toLowerCase();
  if (/^Digit\d$/.test(code)) return code[5];
  if (/^F\d+$/.test(code)) return code;
  return code;
}
const held = new Set<string>();

export const input = {
  key(type: 'keydown' | 'keyup', code: string, repeat = false) {
    const shift = held.has('ShiftLeft') || held.has('ShiftRight');
    if (type === 'keydown') held.add(code); else held.delete(code);
    const e = new g.KeyboardEvent(type, {code, key: keyFor(code, shift), repeat, bubbles: true, cancelable: true,
      shiftKey: held.has('ShiftLeft') || held.has('ShiftRight'), ctrlKey: held.has('ControlLeft') || held.has('ControlRight'), altKey: held.has('AltLeft') || held.has('AltRight')});
    const target = keyTarget(), allowed = deliver(target, e);
    // The browser's default action: Enter on a focused button or link clicks it, Space on release.
    const tag = String((target as {tagName?: string}).tagName ?? '').toUpperCase();
    const clickable = tag === 'BUTTON' || tag === 'A' || (tag === 'INPUT' && /^(submit|button|checkbox|radio)$/i.test((target as {type?: string}).type ?? ''));
    if (allowed && clickable && !repeat && ((type === 'keydown' && code === 'Enter' && tag !== 'INPUT') || (type === 'keyup' && code === 'Space')))
      (target as {click?: () => void}).click?.();
    return allowed;
  },
  mouse(type: string, x: number, y: number, button = 0, buttons = 0, dx = 0, dy = 0) {
    pointer.x = x; pointer.y = y; pointer.buttons = buttons;
    const init = {clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y, offsetX: x, offsetY: y, movementX: dx, movementY: dy, button, buttons, bubbles: true, cancelable: true,
      shiftKey: held.has('ShiftLeft'), ctrlKey: held.has('ControlLeft'), altKey: held.has('AltLeft')};
    const target = gameSurface();
    const pointerType = type === 'mousedown' ? 'pointerdown' : type === 'mouseup' ? 'pointerup' : type === 'mousemove' ? 'pointermove' : '';
    if (pointerType) deliver(target, new g.PointerEvent(pointerType, {...init, pointerId: 1, pointerType: 'mouse', isPrimary: true}));
    deliver(target, new g.MouseEvent(type, init));
    if (type === 'mouseup' && button === 0) deliver(target, new g.MouseEvent('click', init));
    if (type === 'mousedown' && button === 2) deliver(target, new g.MouseEvent('contextmenu', init));
  },
  wheel(deltaY: number) {
    deliver(gameSurface(), new g.WheelEvent('wheel', {deltaY, deltaMode: 0, clientX: pointer.x, clientY: pointer.y, bubbles: true, cancelable: true}));
  },
  blur() { held.clear(); windowTarget.dispatchEvent(new g.Event('blur')); },
  /** Gamepads as the Gamepad API reports them: [{id, buttons: [value...], axes: [...]}]. */
  gamepads(json: string) {
    let pads: {id: string; buttons: number[]; axes: number[]}[] = [];
    try { pads = JSON.parse(json); } catch { return; }
    const before = gamepads.length;
    gamepads = pads.map((p, index) => ({id: p.id, index, connected: true, mapping: 'standard', timestamp: Date.now(), axes: p.axes,
      buttons: p.buttons.map(v => ({value: v, pressed: v > 0.5, touched: v > 0}))}));
    if (gamepads.length > before) for (const pad of gamepads.slice(before)) windowTarget.dispatchEvent(Object.assign(new g.Event('gamepadconnected'), {gamepad: pad}));
  },
};
let gamepads: unknown[] = [];
const nav = (g.navigator ??= {});
nav.getGamepads = () => gamepads;
