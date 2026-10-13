#!/usr/bin/env node
// Paints the game's livery (faction colours, stripes, panels, tint) onto each override hull's colour texture, so Lumen
// mode's hulls carry the same paint as the browser's. The game's hull loader runs in its own Vite dev server in headless
// Chrome (Tools/fidelity/livery-bake-boot.js), and
// Tools/fidelity/livery-bake-page.js draws each source model flat in its texture space through the material the game
// paints that hull with. Writes <out>/<name>.png and <out>/bake.json; Tools/fidelity/import-livery.mjs brings them into
// the host project.
//   node Tools/fidelity/bake-livery.mjs <overrides.json> --game hardburn --out <dir> [--only a,b] [--again] [--limit n] [--port 5396] [--profile <dir>] [--preview]
// A rule's "bake": {"darkFloor": 0.09, "wear": 1.8} keeps texture darker than darkFloor unpainted (dark machinery on a
// dark hull) and scales the wear. Hulls already painted in <dir> are skipped unless --again. --preview also writes <name>.preview.png: the game's model
// with the game's texture beside the source model with the bake, unlit, from the same view. bake.json's fit says how
// well the source lines up with the game's model.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const {loadGame} = await import(pathToFileURL(path.join(bridge, 'Tools/jsgb.mjs')).href);
const [rulesFile, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const game = loadGame(flag('--game', 'hardburn'));
const out = path.resolve(flag('--out')), port = +flag('--port', 5396), only = flag('--only')?.split(',');
// --style clean (the default) paints each hull fresh: the game's colours, plating and wear. --style game keeps the
// game's texture and the source's own detail.
const style = flag('--style', 'clean');
const profile = path.resolve(flag('--profile', path.join(out, 'chrome-profile')));
fs.mkdirSync(out, {recursive: true});
const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8')).overrides.filter(r => r.mesh && r.keys?.length && r.source && (!only || only.includes(r.name)));
const fromGame = createRequire(path.join(game.repo, 'package.json'));
const fromSuite = createRequire(path.join(bridge, 'Tests/suite/package.json'));
const tool = name => { try { return fromGame.resolve(name); } catch { return fromSuite.resolve(name); } };
const vite = await import(pathToFileURL(tool('vite')).href).then(m => m.createServer ? m : m.default);
const {chromium} = await import(pathToFileURL(tool('playwright')).href).then(m => m.chromium ? m : m.default);

// The game's dev server, plus the bake page module and each source model.
const pageFile = path.join(bridge, 'Tools/fidelity/livery-bake-page.js'), bootFile = path.join(bridge, 'Tools/fidelity/livery-bake-boot.js');
// "imported": the file the host project's mesh was actually built from, when it isn't "source" (its UVs are the ones the
// texture has to follow).
const sources = new Map(rules.map(r => [r.name, r.imported ?? r.source]));
const server = await vite.createServer({root: game.repo, logLevel: 'warn', server: {port, strictPort: true, host: '127.0.0.1'},
  plugins: [{
    name: 'jsgb-livery-bake',
    resolveId: id => ['/__jsgb_bake/page.js', '/__jsgb_bake/boot.js'].includes(id) ? id : undefined,
    load: id => id === '/__jsgb_bake/page.js' ? fs.readFileSync(pageFile, 'utf8') : id === '/__jsgb_bake/boot.js' ? fs.readFileSync(bootFile, 'utf8') : undefined,
    configureServer(s) {
      s.middlewares.use((req, res, next) => {
        if (req.url === '/__jsgb_bake/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><body><script type="module" src="/__jsgb_bake/boot.js"></script></body>'); return; }
        const m = /^\/__jsgb_bake\/source\/([\w-]+)\.glb$/.exec(req.url ?? '');
        if (!m || !sources.has(m[1])) return next();
        res.setHeader('Content-Type', 'model/gltf-binary');
        fs.createReadStream(sources.get(m[1])).pipe(res);
      });
    },
  }]});
await server.listen();
const browser = await chromium.launchPersistentContext(profile, {headless: true, viewport: {width: 1280, height: 720},
  args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']});
const page = browser.pages()[0] ?? await browser.newPage();
page.on('pageerror', e => console.log('page error:', e.message));
await page.goto(`http://127.0.0.1:${port}/__jsgb_bake/`, {timeout: 300000});
await page.waitForFunction(() => window.__FF?.ready?.() || window.__bakeError, null, {timeout: 600000, polling: 1000});
const bootError = await page.evaluate(() => window.__bakeError);
if (bootError) throw Error('the bake page failed to start: ' + bootError);
console.log('game ready');
const report = fs.existsSync(path.join(out, 'bake.json')) ? JSON.parse(fs.readFileSync(path.join(out, 'bake.json'), 'utf8')) : {};
// --limit n: paint at most n hulls in this browser session; the game keeps every model it loads, so long runs restart.
let left = +flag('--limit', Infinity);
for (const r of rules) {
  if (report[r.name] && !report[r.name].error && fs.existsSync(path.join(out, r.name + '.png')) && !rest.includes('--again')) continue;
  if (left-- <= 0) break;
  const started = Date.now();
  try {
    const result = await page.evaluate(async ([name, key, url, style, options]) => (await import('/__jsgb_bake/page.js')).bake(name, key, url, style, options),
      [r.name, r.keys[0], `/__jsgb_bake/source/${r.name}.glb`, style, {preview: rest.includes('--preview'), previewDistance: +flag('--preview-distance', 2.6), fill: !rest.includes('--no-fill'), ...r.bake}]);
    fs.writeFileSync(path.join(out, r.name + '.png'), Buffer.from(result.png, 'base64'));
    if (result.preview) fs.writeFileSync(path.join(out, r.name + '.preview.png'), Buffer.from(result.preview, 'base64'));
    report[r.name] = {key: r.keys[0], width: result.width, height: result.height, coverage: +result.coverage.toFixed(3), plates: +result.mask.toFixed(3), material: result.material, fit: result.fit, seconds: Math.round((Date.now() - started) / 1000)};
    console.log(`${r.name}: ${result.width}x${result.height}, ${(result.coverage * 100).toFixed(0)}% of texels painted, ${(result.mask * 100).toFixed(0)}% plates, ${result.material}, fit ${JSON.stringify(result.fit)}`);
  } catch (e) {
    report[r.name] = {error: String(e.message ?? e).slice(0, 300)};
    console.log(`${r.name}: failed: ${report[r.name].error}`);
  }
  fs.writeFileSync(path.join(out, 'bake.json'), JSON.stringify(report, null, 1));
}
await browser.close();
await server.close();
