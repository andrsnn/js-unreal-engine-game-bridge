// Runs inside the CEF overlay. Shows the game's DOM (sent from Puerts as HTML) and sends back
// every element's laid-out box and the DOM events the player causes. Game rules and handlers stay
// in Puerts; this page only presents and forwards.
(function () {
  const ATTR = 'data-jsgb';
  let patching = false, layoutPending = false;
  const send = packet => { try { if (window.ue && window.ue.jsgb) window.ue.jsgb.sendinput(JSON.stringify(packet)); } catch (e) { console.error(e); } };
  const id = node => node && node.nodeType === 1 ? node.getAttribute(ATTR) : null;
  // The nearest mirrored element: events on overlay-only nodes go to their mirrored ancestor.
  const owner = node => { while (node && node.nodeType === 1 && !id(node)) node = node.parentElement; return node && node.nodeType === 1 ? node : null; };

  function sync(current, next) {
    if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) { current.replaceWith(next.cloneNode(true)); return; }
    if (current.nodeType !== 1) { if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue; return; }
    for (const a of [...current.attributes]) if (!next.hasAttribute(a.name)) current.removeAttribute(a.name);
    for (const a of next.attributes) if (current.getAttribute(a.name) !== a.value) current.setAttribute(a.name, a.value);
    if (current !== document.activeElement && 'value' in current && next.hasAttribute('value') && current.value !== next.getAttribute('value')) current.value = next.getAttribute('value');
    if ('checked' in current) current.checked = next.hasAttribute('checked');
    const old = [...current.childNodes], keyed = new Map(old.filter(n => id(n)).map(n => [id(n), n]));
    let position = 0;
    for (const child of [...next.childNodes]) {
      let found = id(child) ? keyed.get(id(child)) : old[position];
      if (found && found.parentNode !== current) found = null;
      if (found && id(found) !== id(child)) found = null;
      if (!found) { found = child.cloneNode(true); current.insertBefore(found, current.childNodes[position] || null); }
      else { if (current.childNodes[position] !== found) current.insertBefore(found, current.childNodes[position] || null); sync(found, child); }
      position++;
    }
    while (current.childNodes.length > position) current.lastChild.remove();
  }

  let appliedVersion = -1;
  function layout() {
    layoutPending = false;
    const rects = {};
    for (const node of document.querySelectorAll('[' + ATTR + ']')) {
      const r = node.getBoundingClientRect(), c = getComputedStyle(node);
      rects[id(node)] = {x: r.x, y: r.y, width: r.width, height: r.height, display: c.display, visibility: c.visibility, opacity: c.opacity, pointerEvents: c.pointerEvents, fontSize: c.fontSize, color: c.color};
    }
    send({type: 'host-layout', version: appliedVersion, width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio, rects});
  }
  const scheduleLayout = () => { if (!layoutPending) { layoutPending = true; requestAnimationFrame(layout); } };

  window.JsGameUI = {
    apply(html, version) {
      // The host's UI version this page now shows; layout reports carry it back, so scripts know what is on screen.
      if (version !== undefined) appliedVersion = version;
      const parsed = new DOMParser().parseFromString('<!doctype html><html><head></head>' + html + '</html>', 'text/html');
      parsed.querySelectorAll('script').forEach(n => n.remove());
      for (const n of parsed.querySelectorAll('*')) for (const a of [...n.attributes]) if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      patching = true; sync(document.body, parsed.body); patching = false;
      scheduleLayout();
    },
    reset() { document.body.replaceChildren(); },
  };

  const pointer = ['click', 'dblclick', 'auxclick', 'contextmenu', 'pointerdown', 'pointerup', 'pointermove', 'pointercancel', 'pointerover', 'pointerout', 'pointerenter', 'pointerleave',
    'mousedown', 'mouseup', 'mousemove', 'mouseover', 'mouseout', 'mouseenter', 'mouseleave', 'wheel'];
  for (const type of [...pointer, 'input', 'change', 'toggle', 'focusin', 'focusout', 'submit']) document.addEventListener(type, event => {
    if (patching) return;
    const target = owner(event.target);
    if (!target) return;
    const p = {type, id: id(target), button: event.button, buttons: event.buttons, clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY,
      offsetX: event.offsetX, offsetY: event.offsetY, movementX: event.movementX, movementY: event.movementY, deltaX: event.deltaX, deltaY: event.deltaY, deltaMode: event.deltaMode,
      shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, pointerId: event.pointerId, pointerType: event.pointerType, detail: event.detail};
    if ('value' in target) p.value = target.value;
    if ('checked' in target) p.checked = target.checked;
    if (type === 'toggle') p.open = target.open;
    send(p);
    if (type === 'contextmenu' || type === 'submit' || (type === 'wheel' && target.tagName === 'CANVAS')) event.preventDefault();
  }, {capture: true, passive: false});
  for (const type of ['keydown', 'keyup']) window.addEventListener(type, event => {
    const target = owner(event.target);
    send({type, ...(target && target !== document.body ? {id: id(target)} : {}), key: event.key, code: event.code, repeat: event.repeat, location: event.location,
      shiftKey: event.shiftKey, altKey: event.altKey, ctrlKey: event.ctrlKey, metaKey: event.metaKey, keyCode: event.keyCode, which: event.which});
    if (!event.target.matches || !event.target.matches('input,select,textarea')) event.preventDefault();
  }, true);
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('blur', () => send({type: 'blur'}));
  new ResizeObserver(scheduleLayout).observe(document.documentElement);
})();
