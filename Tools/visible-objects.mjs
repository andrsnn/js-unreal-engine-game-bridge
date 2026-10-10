// Counts the objects a browser frame draws, by the same rules the runtime's exporter uses to send
// objects to Unreal (visible, on the camera's layers, a mesh, instanced mesh, points, line or
// sprite with something to draw). Runs in the page; three.js announces each WebGLRenderer to
// window.__THREE_DEVTOOLS__, which is how this finds the game's renderer without changing the game.
export function installVisibleObjects() {
  const renderers = [];
  let last = null, sawPerspective = false;
  const main = () => {
    let best = null, area = -1;
    for (const r of renderers) { const c = r.domElement; const a = (c?.isConnected ? 1e9 : 0) + (c?.width ?? 0) * (c?.height ?? 0); if (a > area) { area = a; best = r; } }
    return best;
  };
  const hook = new EventTarget();
  hook.addEventListener('observe', e => {
    const r = e.detail;
    if (!r?.isWebGLRenderer || typeof r.render !== 'function') return;
    renderers.push(r);
    const render = r.render;
    r.render = function (scene, camera) {
      if (this === main() && scene?.isScene) {
        const perspective = !!camera?.isPerspectiveCamera;
        if (perspective || !sawPerspective) last = {scene, camera};
        if (perspective) sawPerspective = true;
      }
      return render.apply(this, arguments);
    };
  });
  window.__THREE_DEVTOOLS__ = hook;
  const drawable = o => {
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (!mats.some(m => m && m.visible !== false)) return false;
    if (o.isSprite) return true;
    if (o.isInstancedMesh && o.count <= 0) return false;
    const n = o.geometry?.attributes?.position?.count ?? 0;
    return n > 0 && o.geometry.drawRange.count !== 0;
  };
  window.__jsgbVisibleObjects = () => {
    if (!last) return 0;
    let n = 0;
    const walk = o => {
      if (!o.visible) return;
      if ((!last.camera || o.layers.test(last.camera.layers)) && (o.isMesh || o.isPoints || o.isLine || o.isSprite) && drawable(o)) n++;
      for (const c of o.children) walk(c);
    };
    walk(last.scene);
    return n;
  };
}
