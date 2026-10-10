import {host} from './host';
import {layoutBoxes, setViewport, submitForm} from './dom';
import {deliver} from './input';

/** Mirrors the game's DOM into the host's CEF overlay. Every element gets a stable data-jsgb id;
 *  the overlay sends back each element's laid-out box and the DOM events the player causes, which
 *  are replayed here on the same elements so the game's own handlers run. */
const g = globalThis as Record<string, any>;
const ATTR = 'data-jsgb';
let serial = 0, dirty = true, last = '', lastPublish = -1e9;

function stamp(root: Record<string, any>) {
  if (root.nodeType !== 1) return;
  if (!root.hasAttribute(ATTR)) root.setAttribute(ATTR, String(++serial));
  for (const child of root.children ?? []) stamp(child);
}

try {
  const observer = new g.MutationObserver(() => { dirty = true; });
  observer.observe(g.document.documentElement, {subtree: true, childList: true, attributes: true, characterData: true});
} catch { /* no observer: publish compares strings every interval */ }

/** Sends the current DOM to the overlay when it changed, at most every `intervalMs`. */
export function publishUI(intervalMs = 100) {
  const out = host.ui; if (!out) return;
  const now = host.now(); if (now - lastPublish < intervalMs) return;
  lastPublish = now;
  if (!dirty && last) return;
  dirty = false;
  const body = g.document.body; stamp(body);
  const html = body.outerHTML;
  // The game's own origin is http://localhost/; the overlay loads files from the host's origin, so
  // absolute links to the game origin (new URL(path, document.baseURI)) become root-relative.
  if (html !== last) { last = html; out.publish(html.replaceAll('http://localhost/', '/')); }
  dirty = false;
}

const byId = (id: string) => g.document.querySelector(`[${ATTR}="${id}"]`);

/** A packet from the overlay: a layout report or a DOM event aimed at a mirrored element. */
export function uiInput(json: string) {
  let p: Record<string, any>;
  try { p = JSON.parse(json); } catch { return; }
  if (p.type === 'host-layout') {
    for (const [id, b] of Object.entries(p.rects ?? {})) layoutBoxes.set(id, b as never);
    if (p.width > 0 && p.height > 0) setViewport(p.width, p.height);
    return;
  }
  const target = p.id ? byId(p.id) : p.selector ? g.document.querySelector(p.selector) : null;
  const doc = g.document;
  if (p.type === 'keydown' || p.type === 'keyup') {
    const e = new g.KeyboardEvent(p.type, {...p, bubbles: true, cancelable: true});
    deliver(target ?? (doc.activeElement !== doc.body ? doc.activeElement : doc.body), e);
    return;
  }
  if (p.type === 'blur') { g.dispatchEvent(new g.Event('blur')); return; }
  if (!target || target.disabled) return;
  if (p.value !== undefined && 'value' in target) target.value = p.value;
  if (p.checked !== undefined) target.checked = p.checked;
  if (p.open !== undefined) target.toggleAttribute('open', !!p.open);
  if (p.type === 'focusin') target.focus?.();
  const init = {...p, bubbles: !['pointerenter', 'pointerleave', 'mouseenter', 'mouseleave'].includes(p.type), cancelable: true};
  const Ctor = p.type === 'wheel' ? g.WheelEvent : /^pointer/.test(p.type) ? g.PointerEvent : /^(click|dblclick|contextmenu|mouse)/.test(p.type) ? g.MouseEvent
    : p.type === 'focusin' || p.type === 'focusout' ? g.FocusEvent : g.Event;
  deliver(target, new Ctor(p.type, init));
}

/** The element a script means: a CSS selector, or visible text on a button-like element. */
export function findElement(what: string): Record<string, any> | null {
  const doc = g.document;
  try { const el = doc.querySelector(what); if (el) return el; } catch { /* not a selector */ }
  const hidden = (el: Record<string, any>) => !!el.closest('[hidden]') || (layoutBoxes.get(el.getAttribute(ATTR) ?? '')?.display === 'none');
  const all = [...doc.querySelectorAll('button,a,[role=button],li,div,span,label,option,summary')] as Record<string, any>[];
  return all.find(el => el.textContent.trim() === what && !hidden(el))
    ?? all.filter(el => /^(BUTTON|A)$/.test(el.tagName)).find(el => el.textContent.trim().toUpperCase().includes(String(what).toUpperCase()) && !hidden(el)) ?? null;
}

/** Clicks an element the way the overlay would report a player's click. */
export function clickElement(what: string) {
  const el = findElement(what);
  if (!el) throw Error('click: nothing matches ' + what);
  stamp(g.document.body);
  const id = el.getAttribute(ATTR);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) uiInput(JSON.stringify({type, id, button: 0, buttons: type.endsWith('down') ? 1 : 0}));
  // The browser's default action for a submit button: submit its form. (The overlay's real browser
  // does this itself and forwards the submit event, so only scripted clicks need it here.)
  const button = el.closest('button,input[type=submit]');
  const form = button?.closest('form');
  if (form && (button.getAttribute('type') ?? 'submit').toLowerCase() === 'submit' && !button.hasAttribute('disabled')) submitForm(form, button);
  return el.tagName + '#' + id + ' ' + String(el.textContent).trim().slice(0, 40);
}
