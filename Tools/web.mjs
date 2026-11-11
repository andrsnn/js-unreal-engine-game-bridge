#!/usr/bin/env node
// The browser side of a conformance check, from the same source commit as the Unreal bundle.
//   node Tools/web.mjs build   <game>                  the game's own Vite build into <out>/web
//   node Tools/web.mjs dev     <game>                  the game's Vite dev server, opened in the browser
//   node Tools/web.mjs capture <game> --script s.txt [--frames dir --fps 10] [--res 1280x720] [--live dir] [--wait 120]
// --live films the page in real time (Chrome's screencast) and records when every animation frame ran.
// capture serves <out>/web plus the public folders, opens it in headless Chrome, and runs the same
// script format as the Unreal host (seconds after load: wait/gone/click/key/eval/seed/shot/quit).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {loadGame} = await import(pathToFileURL(path.join(bridge, 'Tools/jsgb.mjs')).href);
const {installVisibleObjects} = await import(pathToFileURL(path.join(bridge, 'Tools/visible-objects.mjs')).href);
const [command, gameArg, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const game = loadGame(gameArg);
const webOut = path.join(game.out, 'web');
const requireFromGame = createRequire(path.join(game.repo, 'package.json'));
// Tools a game doesn't install itself (Playwright for captures) come from the conformance suite's install.
const requireFromSuite = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Tests', 'suite', 'package.json'));
const resolveTool = name => { try { return requireFromGame.resolve(name); } catch { return requireFromSuite.resolve(name); } };

// The game's own Vite. Older versions resolve to a CommonJS wrapper that puts the API on default.
async function loadVite() {
  const m = await import(pathToFileURL(resolveTool('vite')).href);
  return m.build ? m : m.default;
}

async function build() {
  const started = Date.now();
  const options = {root: game.repo, logLevel: 'warn', cacheDir: path.join(game.out, '.vite-cache'),
    // A game whose page isn't index.html (a three.js example page) builds that page.
    build: {outDir: webOut, emptyOutDir: true, copyPublicDir: false, reportCompressedSize: false, target: game.target ?? 'es2022',
      ...(game.index && game.index !== 'index.html' ? {rollupOptions: {input: path.join(game.repo, game.index)}} : {})}};
  try {
    await (await loadVite()).build(options);
  } catch (error) {
    // A game installed from WSL or Linux has no Windows build of Rollup's native module. The suite's own Vite builds it
    // instead, without the game's vite.config (which imports the game's Vite).
    if (!/Cannot find module @rollup|native\.js|rolldown-binding/.test(String(error?.stack ?? error))) throw error;
    console.log(`${game.id}'s own Vite can't run on this platform (${String(error.message).split('\n')[0]}); building with the bridge's Vite`);
    const m = await import(pathToFileURL(requireFromSuite.resolve('vite')).href);
    await (m.build ? m : m.default).build({...options, configFile: false});
  }
  console.log(`web build of ${game.id} in ${Date.now() - started} ms -> ${webOut}`);
}

const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2'};
function serve(port) {
  const roots = [webOut, ...game.publicRoots.filter(r => r !== game.out)];
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = rel === '/' ? path.join(webOut, game.index ?? 'index.html') : roots.map(r => path.join(r, rel)).find(f => f.startsWith(path.resolve(path.dirname(f))) && fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store'});
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

async function capture() {
  const playwright = await import(pathToFileURL(resolveTool('playwright')).href);
  const chromium = playwright.chromium ?? playwright.default.chromium;
  const port = +flag('--port', 5391);
  const server = await serve(port);
  const [w, h] = flag('--res', '1280x720').split('x').map(Number);
  const args = [...(process.platform === 'win32' ? ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--autoplay-policy=no-user-gesture-required'];
  // --profile dir: a profile on disk. An incognito context keeps blobs in memory only, and a game that unpacks many
  // large models into blob URLs (Hard Burn's fleet view) runs out of blob memory (ERR_BLOB_OUT_OF_MEMORY).
  const profile = flag('--profile');
  if (profile) fs.rmSync(profile, {recursive: true, force: true});
  const browser = profile ? await chromium.launchPersistentContext(profile, {headless: true, args, viewport: {width: w, height: h}}) : await chromium.launch({headless: true, args});
  const page = profile ? browser.pages()[0] ?? await browser.newPage() : await browser.newPage({viewport: {width: w, height: h}});
  const errors = [];
  // The same seeded Math.random as the runtime (entry.ts), so both runs build the same world.
  const seed = +flag('--seed', 0);
  await page.addInitScript(s0 => {
    window.__jsgbSeed = seed => { let a = seed >>> 0; window.__jsgbRandomCount = 0; Math.random = () => { window.__jsgbRandomCount++; a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; return seed; };
    if (s0) window.__jsgbSeed(s0);
  }, seed);
  // Each captured frame records how many objects the game drew, for the conformance check.
  await page.addInitScript(installVisibleObjects);
  // --fixed-fps N: game time advances exactly 1/N s per frame, as the Unreal host does with
  // -JsgbFixedFps, so a slow or busy machine changes how long a run takes, not what the game does.
  // requestAnimationFrame, performance.now and Date.now all follow the virtual clock.
  const fixedFps = +flag('--fixed-fps', 0);
  await page.addInitScript(fps => {
    if (!fps) return;
    const step = 1000 / fps, realRaf = window.requestAnimationFrame.bind(window), realDateNow = Date.now, start = realDateNow();
    let vnow = 0, nextId = 1, stopAt = Infinity;
    const stops = {};
    const callbacks = new Map();
    // The clock stops at the frame a script step is due, so the step acts on that exact frame (as in Unreal).
    const loop = () => {
      if (vnow < stopAt - 1e-6) {
        vnow += step;
        const list = [...callbacks.values()]; callbacks.clear();
        for (const cb of list) { try { cb(vnow); } catch (e) { setTimeout(() => { throw e; }); } }
      }
      realRaf(loop);
    };
    // Each user (the film grabber, the script) holds its own stop; the clock stops at the earliest.
    window.__jsgbStopAt = (who, ms) => { if (ms == null) delete stops[who]; else stops[who] = ms; stopAt = Math.min(Infinity, ...Object.values(stops)); };
    realRaf(loop);
    window.requestAnimationFrame = cb => { const id = nextId++; callbacks.set(id, cb); return id; };
    window.cancelAnimationFrame = id => { callbacks.delete(id); };
    performance.now = () => vnow;
    Date.now = () => start + vnow;
    window.__jsgbVirtualMs = () => vnow;
  }, fixedFps);
  // Seconds on the run's clock: virtual game time with --fixed-fps, else wall time.
  const stopAt = (who, ms) => fixedFps ? page.evaluate(([w, v]) => window.__jsgbStopAt?.(w, v), [who, ms]).catch(() => {}) : null;
  const clock = async () => fixedFps ? (await page.evaluate(() => window.__jsgbVirtualMs?.() ?? 0).catch(() => 0)) / 1000 : Date.now() / 1000;
  page.on('pageerror', e => errors.push(String(e)));
  // A failed load names its URL (Chrome's console message doesn't).
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().startsWith('Failed to load resource') && m.location()?.url ? `${m.text()}: ${m.location().url}` : m.text()); });
  const frames = flag('--frames'), fps = +flag('--fps', 10), shots = flag('--shots', path.join(game.out, 'web-shots'));
  if (frames) fs.mkdirSync(frames, {recursive: true});
  fs.mkdirSync(shots, {recursive: true});
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/${flag('--search', game.search ?? '')}`, {waitUntil: 'load', timeout: 120000});
  const readyWall = Date.now(), ready = await clock();
  console.log(`web ${game.id} loaded in ${readyWall - t0} ms${fixedFps ? ` (game clock ${fixedFps} fps)` : ''}`);
  // Frame grabber: one screenshot per 1/fps seconds after load, for the side-by-side film.
  let grabbing = !!frames, index = 0, next = 0;
  const times = [];
  const grab = async () => {
    while (grabbing) {
      // The clock stops at each film frame's time, so the screenshot shows that frame.
      await stopAt('grab', (ready + next) * 1000);
      const t = (await clock()) - ready;
      if (t >= next - 1e-6) {
        const name = `frame_${String(index++).padStart(5, '0')}.png`;
        await page.screenshot({path: path.join(frames, name)});
        const c = await page.evaluate(() => window.__jsgbCensus?.() ?? {objects: -1, lines: -1, sprites: -1, points: -1}).catch(() => ({objects: -1, lines: -1, sprites: -1, points: -1}));
        times.push(`${name} ${t.toFixed(3)} objects=${c.objects} lines=${c.lines} sprites=${c.sprites} points=${c.points}`);
        next = Math.max(next + 1 / fps, t);
      }
      else await new Promise(r => setTimeout(r, 5));
    }
    await stopAt('grab', null);
  };
  const grabber = grab();
  // --live: the frames Chrome actually shows, stamped with Unix milliseconds, and the time of every
  // requestAnimationFrame, for a real-time film with a measured frame rate.
  const live = flag('--live');
  let cdp = null;
  const liveFrames = [], anchors = [];
  if (live) {
    fs.rmSync(live, {recursive: true, force: true}); fs.mkdirSync(live, {recursive: true});
    await page.evaluate(() => { const t = window.__jsgbRafTimes = []; const tick = () => { t.push(performance.timeOrigin + performance.now()); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    cdp = await page.context().newCDPSession(page);
    cdp.on('Page.screencastFrame', f => {
      cdp.send('Page.screencastFrameAck', {sessionId: f.sessionId}).catch(() => {});
      const name = `frame_${String(liveFrames.length).padStart(5, '0')}.jpg`;
      liveFrames.push(`${name} ${Math.round(f.metadata.timestamp * 1000)}`);
      fs.writeFile(path.join(live, name), Buffer.from(f.data, 'base64'), () => {});
    });
    await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 85, maxWidth: w, maxHeight: h, everyNthFrame: 1});
  }
  // Checked on every frame in the page; the answer carries the game time it saw the element (or saw it go).
  const seen = (what, present) => page.waitForFunction(([w, want]) => {
    const has = (() => {
      try { if (document.querySelector(w)) return true; } catch { /* text */ }
      return [...document.querySelectorAll('button,a,[role=button],li,div,span,label,option,summary')].some(el => el.textContent.trim() === w && el.getClientRects().length > 0)
        || [...document.querySelectorAll('button,a')].some(el => el.textContent.trim().toUpperCase().includes(w.toUpperCase()) && el.getClientRects().length > 0);
    })();
    return has === want ? {t: window.__jsgbVirtualMs ? window.__jsgbVirtualMs() : null} : false;
  }, [what, present], {polling: 'raf', timeout: +flag('--wait', 120) * 1000}).then(h => h.jsonValue()).catch(() => null);

  const steps = fs.readFileSync(flag('--script'), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const [when, verb, ...args] = l.split(' '); return {time: +when, verb, args: args.join(' ')}; }).sort((a, b) => a.time - b.time);
  let offset = 0;
  const unquote = s => s.replace(/^(['"`])(.*)\1$/, '$2');
  for (const s of steps) {
    const due = ready + s.time + offset;
    await stopAt('script', due * 1000);
    while ((await clock()) < due - 1e-6) await new Promise(r => setTimeout(r, 10));
    if (s.verb === 'objects') {
      // objects <n>: until the scene draws at least n objects (a world finished loading).
      await stopAt('script', null);
      const wallStart = Date.now();
      const hit = await page.waitForFunction(n => { const c = window.__jsgbCensus?.(); return c && c.objects >= n ? {t: window.__jsgbVirtualMs ? window.__jsgbVirtualMs() : null} : false; },
        +s.args, {polling: 'raf', timeout: 120000}).then(h => h.jsonValue()).catch(() => null);
      const start = due, end = fixedFps && typeof hit?.t === 'number' ? hit.t / 1000 : await clock();
      offset += end - start;
      times.push(`wait-end ${(end - ready).toFixed(3)}`);
      anchors.push(`objects ${s.args} ${Date.now()}`);
      console.log(`objects ${s.args} ${((Date.now() - wallStart) / 1000).toFixed(1)}s${hit ? '' : ' (timed out)'}`);
    } else if (s.verb === 'wait' || s.verb === 'gone') {
      // wait: until the element exists. gone: until it no longer exists (a loading screen closing).
      const start = await clock(), wallStart = Date.now(), present = s.verb === 'wait';
      await stopAt('script', null);
      const hit = await seen(unquote(s.args), present);
      const end = fixedFps && typeof hit?.t === 'number' ? hit.t / 1000 : await clock();
      offset += end - start;
      times.push(`wait-end ${(end - ready).toFixed(3)}`);
      anchors.push(`${s.verb} ${unquote(s.args)} ${Date.now()}`);
      console.log(`wait ${s.args} ${((Date.now() - wallStart) / 1000).toFixed(1)}s`);
    } else if (s.verb === 'click') {
      // A real mouse click at the element's centre, as a player would.
      const box = await page.evaluate(w => {
        let el = null; try { el = document.querySelector(w); } catch { /* text */ }
        el ??= [...document.querySelectorAll('button,a,[role=button],li,div,span,label,option,summary')].find(e => e.textContent.trim() === w && e.offsetParent !== null)
          ?? [...document.querySelectorAll('button,a')].find(e => e.textContent.trim().toUpperCase().includes(w.toUpperCase()) && e.offsetParent !== null);
        if (!el) return null; const r = el.getBoundingClientRect(); return {x: r.x + r.width / 2, y: r.y + r.height / 2};
      }, unquote(s.args));
      if (box) await page.mouse.click(box.x, box.y); else errors.push('click: nothing matches ' + s.args);
      console.log(`click ${s.args} ${box ? 'ok' : 'missing'}`);
    } else if (s.verb === 'key') {
      // key 'Code' presses it; key 'Code','down' holds it until key 'Code','up'.
      const [code, how] = s.args.split(',').map(a => unquote(a.trim()));
      const key = code.replace(/^Key/, '');
      if (how === 'down') await page.keyboard.down(key); else if (how === 'up') await page.keyboard.up(key); else await page.keyboard.press(key);
    }
    else if (s.verb === 'eval') console.log('eval ->', String(await page.evaluate(s.args)).slice(0, 600));
    // Re-seed when the next click event starts (after pointer/mouse handlers), as the Unreal runtime does.
    else if (s.verb === 'seed') await page.evaluate(n => window.addEventListener('click', () => window.__jsgbSeed(n), {capture: true, once: true}), +s.args);
    else if (s.verb === 'shot') await page.screenshot({path: path.join(shots, s.args + '.png')});
    else if (s.verb === 'quit') break;
    await stopAt('script', null);
  }
  grabbing = false; await grabber;
  if (live) {
    await cdp.send('Page.stopScreencast');
    const raf = await page.evaluate(() => window.__jsgbRafTimes.map(Math.round));
    fs.writeFileSync(path.join(live, 'times.txt'), liveFrames.join('\n'));
    fs.writeFileSync(path.join(live, 'raf.json'), JSON.stringify(raf));
    fs.writeFileSync(path.join(live, 'anchors.txt'), anchors.join('\n'));
  }
  if (frames) fs.writeFileSync(path.join(frames, 'times.txt'), times.join('\n'));
  const jsHeapMB = await page.evaluate(() => performance.memory?.usedJSHeapSize / 1048576).catch(() => null);
  await browser.close(); server.close();
  console.log(JSON.stringify({game: game.id, frames: index, errors: errors.slice(0, 20), jsHeapMB: jsHeapMB ? +jsHeapMB.toFixed(1) : null}));
}

// The dev server shows how long each page load took to its first frame, like the Unreal reload line.
const loadBanner = {
  name: 'jsgb-load-banner',
  transformIndexHtml: () => [{tag: 'script', injectTo: 'head', children: `addEventListener('load', () => requestAnimationFrame(() => requestAnimationFrame(() => {
  const ms = performance.now(), el = document.createElement('div');
  el.textContent = 'Page reload: first frame after ' + (ms / 1000).toFixed(2) + ' s';
  el.style.cssText = 'position:fixed;left:16px;bottom:72px;z-index:2147483647;padding:8px 14px;background:rgba(0,0,0,.72);color:#ffd159;font:700 18px sans-serif;pointer-events:none';
  document.body.append(el); setTimeout(() => el.remove(), 8000);
  console.log('[jsgb] first frame after', Math.round(ms), 'ms');
})));`}, {tag: 'script', attrs: {type: 'module'}, injectTo: 'head', children: `import {createHotContext} from '/@vite/client';
const hot = createHotContext('/@jsgb-banner');
let savedAt = 0;
hot.on('jsgb:saved', d => { savedAt = d.savedAt; });
hot.on('vite:afterUpdate', u => {
  if (!savedAt || !u.updates.some(x => x.type === 'css-update')) return;
  const saved = savedAt; savedAt = 0;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const ms = Math.round(Date.now() - saved), el = document.createElement('div');
    el.textContent = 'Hot update (CSS): shown ' + (ms / 1000).toFixed(2) + ' s after save';
    el.style.cssText = 'position:fixed;left:16px;bottom:72px;z-index:2147483647;padding:8px 14px;background:rgba(0,0,0,.72);color:#ffd159;font:700 18px sans-serif;pointer-events:none';
    document.body.append(el); setTimeout(() => el.remove(), 8000);
    console.log('[jsgb] css update shown after', ms, 'ms');
  }));
});`}],
  // The save time comes from the file itself, so the banner counts from the save, not from when Vite noticed it.
  handleHotUpdate(ctx) { ctx.server.ws.send({type: 'custom', event: 'jsgb:saved', data: {file: ctx.file, savedAt: fs.statSync(ctx.file).mtimeMs}}); },
};

async function dev() {
  const vite = await loadVite();
  const server = await vite.createServer({root: game.repo, cacheDir: path.join(game.out, '.vite-dev-cache'), plugins: [loadBanner],
    server: {port: +flag('--port', 5173), strictPort: false, open: rest.includes('--no-open') ? false : flag('--search', '/')}});
  await server.listen();
  server.printUrls();
  console.log(`serving ${game.id} from ${game.repo}; saving a file reloads the page`);
}

if (command === 'build') await build();
else if (command === 'dev') await dev();
else if (command === 'capture') await capture();
else if (command === 'serve') { await serve(+flag('--port', 5391)); console.log('serving ' + webOut); }
else { console.error('usage: web.mjs build|capture|serve|dev <game>'); process.exit(2); }
