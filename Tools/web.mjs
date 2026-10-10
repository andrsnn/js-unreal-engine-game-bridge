#!/usr/bin/env node
// The browser side of a conformance check, from the same source commit as the Unreal bundle.
//   node Tools/web.mjs build   <game>                  the game's own Vite build into <out>/web
//   node Tools/web.mjs capture <game> --script s.txt [--frames dir --fps 10] [--res 1280x720]
// capture serves <out>/web plus the public folders, opens it in headless Chrome, and runs the same
// script format as the Unreal host (seconds after load: wait/click/key/eval/shot/quit).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {loadGame} = await import(pathToFileURL(path.join(bridge, 'Tools/jsgb.mjs')).href);
const [command, gameArg, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const game = loadGame(gameArg);
const webOut = path.join(game.out, 'web');
const requireFromGame = createRequire(path.join(game.repo, 'package.json'));

async function build() {
  const vite = await import(pathToFileURL(requireFromGame.resolve('vite')).href);
  const started = Date.now();
  await vite.build({root: game.repo, logLevel: 'warn', cacheDir: path.join(game.out, '.vite-cache'),
    build: {outDir: webOut, emptyOutDir: true, copyPublicDir: false, reportCompressedSize: false}});
  console.log(`web build of ${game.id} in ${Date.now() - started} ms -> ${webOut}`);
}

const MIME = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.ktx2': 'image/ktx2'};
function serve(port) {
  const roots = [webOut, ...game.publicRoots.filter(r => r !== game.out)];
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = rel === '/' ? path.join(webOut, 'index.html') : roots.map(r => path.join(r, rel)).find(f => f.startsWith(path.resolve(path.dirname(f))) && fs.existsSync(f) && fs.statSync(f).isFile());
    if (!file) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Cache-Control': 'no-store'});
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}

async function capture() {
  const playwright = await import(pathToFileURL(requireFromGame.resolve('playwright')).href);
  const chromium = playwright.chromium ?? playwright.default.chromium;
  const port = +flag('--port', 5391);
  const server = await serve(port);
  const [w, h] = flag('--res', '1280x720').split('x').map(Number);
  const browser = await chromium.launch({headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage({viewport: {width: w, height: h}});
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const frames = flag('--frames'), fps = +flag('--fps', 10), shots = flag('--shots', path.join(game.out, 'web-shots'));
  if (frames) fs.mkdirSync(frames, {recursive: true});
  fs.mkdirSync(shots, {recursive: true});
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/${game.search ?? ''}`, {waitUntil: 'load', timeout: 120000});
  const ready = Date.now();
  console.log(`web ${game.id} loaded in ${ready - t0} ms`);
  // Frame grabber: one screenshot per 1/fps seconds after load, for the side-by-side film.
  let grabbing = !!frames, index = 0, next = 0;
  const times = [];
  const grab = async () => {
    while (grabbing) {
      const t = (Date.now() - ready) / 1000;
      if (t >= next) { await page.screenshot({path: path.join(frames, `frame_${String(index).padStart(5, '0')}.png`)}); times.push(`frame_${String(index++).padStart(5, '0')}.png ${t.toFixed(3)}`); next = Math.max(next + 1 / fps, t); }
      else await new Promise(r => setTimeout(r, 5));
    }
  };
  const grabber = grab();
  const find = what => page.evaluate(w => {
    try { const el = document.querySelector(w); if (el) return true; } catch { /* text */ }
    return [...document.querySelectorAll('button,a,[role=button],li,div,span,label,option,summary')].some(el => el.textContent.trim() === w && el.offsetParent !== null)
      || [...document.querySelectorAll('button,a')].some(el => el.textContent.trim().toUpperCase().includes(w.toUpperCase()) && el.offsetParent !== null);
  }, what);
  const steps = fs.readFileSync(flag('--script'), 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const [when, verb, ...args] = l.split(' '); return {time: +when, verb, args: args.join(' ')}; }).sort((a, b) => a.time - b.time);
  let offset = 0;
  const unquote = s => s.replace(/^(['"`])(.*)\1$/, '$2');
  for (const s of steps) {
    const due = ready + (s.time + offset) * 1000;
    while (Date.now() < due) await new Promise(r => setTimeout(r, 10));
    if (s.verb === 'wait') {
      const start = Date.now();
      while (!(await find(unquote(s.args))) && Date.now() - start < 120000) await new Promise(r => setTimeout(r, 100));
      offset += (Date.now() - start) / 1000;
      times.push(`wait-end ${((Date.now() - ready) / 1000).toFixed(3)}`);
      console.log(`wait ${s.args} ${((Date.now() - start) / 1000).toFixed(1)}s`);
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
    } else if (s.verb === 'key') await page.keyboard.press(unquote(s.args.split(',')[0]).replace(/^Key/, ''));
    else if (s.verb === 'eval') console.log('eval ->', String(await page.evaluate(s.args)).slice(0, 600));
    else if (s.verb === 'shot') await page.screenshot({path: path.join(shots, s.args + '.png')});
    else if (s.verb === 'quit') break;
  }
  grabbing = false; await grabber;
  if (frames) fs.writeFileSync(path.join(frames, 'times.txt'), times.join('\n'));
  await browser.close(); server.close();
  console.log(JSON.stringify({game: game.id, frames: index, errors: errors.slice(0, 20)}));
}

if (command === 'build') await build();
else if (command === 'capture') await capture();
else if (command === 'serve') { await serve(+flag('--port', 5391)); console.log('serving ' + webOut); }
else { console.error('usage: web.mjs build|capture|serve <game>'); process.exit(2); }
