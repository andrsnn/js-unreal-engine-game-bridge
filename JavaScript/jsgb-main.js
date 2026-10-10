// Puerts entry for JsGameBridge (AJsgbHost). Installs __jsgbHost from the native bridge, loads the
// game bundle built by Tools/jsgb.mjs, and binds the host's per-frame and input delegates.
const puerts = require('puerts');
const bridge = puerts.argv.getByName('Bridge');
const EMPTY = new ArrayBuffer(0);
const buf = b => b || EMPTY;

globalThis.__jsgbHost = {
  search: bridge.Search,
  registry: bridge.Registry,
  seed: bridge.Seed,
  trace: bridge.Trace,
  now: () => bridge.NowMs(),
  readFile: path => { const b = bridge.ReadFile(path); return b && b.byteLength > 0 ? b : null; },
  log: (level, text) => bridge.Log(level, String(text)),
  reload: () => bridge.RequestReload(),
  ready: info => bridge.JsReady(String(info ?? '')),
  cache: {get: key => { const b = bridge.CacheGet(key); return b && b.byteLength > 0 ? b : null; }, put: (key, bytes) => bridge.CachePut(key, bytes)},
  text: (font, size, run) => { const b = bridge.Text(font, size, run); return b && b.byteLength > 0 ? b : null; },
  storage: {load: key => bridge.LoadStore(key) || null, save: (key, data) => bridge.SaveStore(key, data)},
  sink: {
    geometry: (id, pos, nrm, uv, col, colorSize, idx, groups) => bridge.Geometry(id, buf(pos), buf(nrm), buf(uv), buf(col), colorSize, buf(idx), groups),
    releaseGeometry: id => bridge.ReleaseGeometry(id),
    material: (id, json) => bridge.Material(id, json),
    texture: (id, json, bytes) => bridge.Texture(id, json, buf(bytes)),
    frame: (floats, count, inst, instCount) => bridge.Frame(floats, count, inst, instCount),
    events: json => bridge.Events(json),
    shader: (key, json) => bridge.Shader(key, json),
  },
  ui: {publish: html => bridge.PublishUI(html)},
  audio: {voices: json => bridge.AudioVoices(json), pcm: (id, samples, rate) => bridge.AudioPcm(id, samples, rate)},
};

const guard = (name, fn) => (...args) => { try { return fn(...args); } catch (e) { bridge.Log('error', `${name}: ${e && e.stack || e}`); } };
// Bound before the bundle loads, so a bundle that fails still answers eval.
bridge.OnEval.Bind(source => { try { const r = (0, eval)(source); return typeof r === 'string' ? r : JSON.stringify(r) ?? String(r); } catch (e) { return 'ERR ' + (e && e.stack || e); } });
const t0 = Date.now();
try {
  require(bridge.BundlePath);
} catch (error) {
  bridge.Log('error', 'bundle failed: ' + (error && error.stack || error));
}
const jsgb = globalThis.__jsgb;
if (jsgb) {
  bridge.OnFrame.Bind(guard('frame', budget => { jsgb.frame(budget).catch(e => bridge.Log('error', 'frame: ' + (e && e.stack || e))); }));
  bridge.OnUIInput.Bind(guard('ui', json => jsgb.ui(json)));
  bridge.OnKey.Bind(guard('key', (type, code, repeat) => jsgb.input.key(type, code, repeat)));
  bridge.OnMouse.Bind(guard('mouse', (type, x, y, button, buttons, dx, dy) => jsgb.input.mouse(type, x, y, button, buttons, dx, dy)));
  bridge.OnWheel.Bind(guard('wheel', dy => jsgb.input.wheel(dy)));
  bridge.OnViewport.Bind(guard('viewport', (w, h) => jsgb.viewport(w, h)));
  bridge.OnGamepads.Bind(guard('gamepads', json => jsgb.input.gamepads(json)));
  bridge.Log('log', `bundle loaded in ${Date.now() - t0} ms`);
}
