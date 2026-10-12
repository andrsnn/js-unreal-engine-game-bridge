#!/usr/bin/env node
// JsGameBridge command line. Builds an unchanged browser game into one script for the Puerts host,
// reloads it into a running Unreal, and boots it headlessly in Node for quick checks.
//   node Tools/jsgb.mjs build  <game>            write <out>/<game>.mjs, .css, page.json, publication.json
//   node Tools/jsgb.mjs smoke  <game> [--frames 600] [--script steps.txt] [--search ?x] [--no-build]
//   node Tools/jsgb.mjs unreal <game>            build, start Unreal (or hot-reload it), then reload on every save
//   node Tools/jsgb.mjs reload <game>            hot-reload the last build
//   node Tools/jsgb.mjs watch  <game>            build and hot-reload on every save in the game's folder
// <game> names Games/<game>.json, or is a path to such a file.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = path.join(bridge, 'Runtime');
const [command, gameArg, ...rest] = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const has = name => rest.includes(name);

// Notepad and Windows PowerShell save UTF-8 with a byte order mark, which JSON.parse rejects.
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

/** Machine settings: jsgb.local.json (not in git), overridden by JSGB_ENGINE, JSGB_PROJECT, JSGB_BUILDS.
 *  Optional: "captures" (where conformance frames and reports go; otherwise inside builds), "package" and
 *  "packageProject" (where a packaged build and its packaging project go), and "ddc" (Unreal's local derived data cache for the runs these
 *  tools start). */
export function settings() {
  const file = path.join(bridge, 'jsgb.local.json');
  const local = fs.existsSync(file) ? readJson(file) : {};
  return {engine: process.env.JSGB_ENGINE ?? local.engine, project: process.env.JSGB_PROJECT ?? local.project,
    builds: path.resolve(bridge, process.env.JSGB_BUILDS ?? local.builds ?? 'Builds'),
    captures: local.captures ? path.resolve(bridge, local.captures) : undefined,
    package: local.package, packageProject: local.packageProject, ddc: local.ddc, fidelityContent: local.fidelityContent};
}
// Unreal reads its local derived data cache folder from this variable; the editors and cooks these tools start inherit it.
if (settings().ddc) process.env['UE-LocalDataCachePath'] ??= settings().ddc;

export function loadGame(name) {
  const file = fs.existsSync(name) ? path.resolve(name) : path.join(bridge, 'Games', name + '.json');
  const game = readJson(file);
  game.id ??= path.basename(file, '.json');
  game.file = file;
  game.repo = path.resolve(bridge, game.repo);
  game.out = path.resolve(game.out ?? path.join(settings().builds, game.id));
  game.publicRoots = [...(game.public ?? ['public']).map(p => path.resolve(game.repo, p)), game.out, game.repo];
  if (game.publicCommit) game.publicRoots.unshift(pinnedPublic(game));
  game.registry = (game.registry ?? []).map(p => path.resolve(bridge, p));
  return game;
}

// "publicCommit": a game copied at an older commit whose public folder links to the live repository (Tools/demo.mjs)
// loads its files as they were at that commit. The files changed or deleted since then are taken from git into
// <out>/public-pinned, which comes first among the public roots; the rest come from the live folder.
function pinnedPublic(game) {
  const live = fs.realpathSync(path.resolve(game.repo, (game.public ?? ['public'])[0]));
  const top = execFileSync('git', ['--no-optional-locks', '-C', live, 'rev-parse', '--show-toplevel'], {encoding: 'utf8'}).trim();
  const rel = path.relative(top, live).replaceAll('\\', '/');
  const changed = execFileSync('git', ['--no-optional-locks', '-C', top, 'diff', '--name-only', '--no-renames', '--diff-filter=DM', game.publicCommit, '--', rel],
    {encoding: 'utf8', maxBuffer: 64 << 20}).split('\n').filter(Boolean).sort();
  const dir = path.join(game.out, 'public-pinned');
  const stamp = path.join(dir, '.pinned');
  const key = `${game.publicCommit}\n${changed.join('\n')}`;
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8') !== key) {
    fs.rmSync(dir, {recursive: true, force: true});
    fs.mkdirSync(dir, {recursive: true});
    for (let i = 0; i < changed.length; i += 100) {
      const tar = path.join(dir, '.part.tar');
      execFileSync('git', ['--no-optional-locks', '-C', top, 'archive', '--format=tar', '-o', tar, game.publicCommit, '--', ...changed.slice(i, i + 100)]);
      // Relative names, because GNU tar reads a drive letter as a remote host.
      execFileSync('tar', ['-xf', '.part.tar'], {cwd: dir});
      fs.rmSync(tar);
    }
    fs.writeFileSync(stamp, key);
    if (changed.length) console.log(`${game.id}: ${changed.length} public files changed since ${game.publicCommit}; serving them as they were from ${dir}`);
  }
  return path.join(dir, rel);
}

/** The game's index.html: shell markup, inline classic scripts, module entry and stylesheets. */
function readPage(game) {
  const html = fs.readFileSync(path.join(game.repo, game.index ?? 'index.html'), 'utf8');
  const attrs = tag => (new RegExp(`<${tag}\\b([^>]*)>`, 'i').exec(html)?.[1] ?? '').trim();
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1].trim() ?? game.id;
  const lang = /lang="([^"]*)"/i.exec(attrs('html'))?.[1] ?? 'en';
  let body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? '';
  const inline = [], css = [];
  let entry = null;
  // Module code written inline in the page (three.js's own examples and many small games) is the entry when
  // the page has no module file.
  const inlineModules = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const src = /\bsrc="([^"]+)"/.exec(m[1])?.[1];
    if (/type="module"/.test(m[1]) && src) entry ??= src;
    else if (/type="module"/.test(m[1])) inlineModules.push(m[2]);
    else if (!src && !/type="(?!text\/javascript)/.test(m[1])) inline.push(m[2]);
  }
  body = body.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  for (const m of html.matchAll(/<link\b([^>]*)>/gi)) {
    if (!/rel="stylesheet"/.test(m[1])) continue;
    const href = /href="([^"]+)"/.exec(m[1])?.[1]; if (!href || /^https?:/.test(href)) continue;
    const file = [path.join(game.repo, href), ...game.publicRoots.map(r => path.join(r, href))].find(f => fs.existsSync(f));
    if (file) css.push({file, text: fs.readFileSync(file, 'utf8')});
  }
  for (const m of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) css.push({file: null, text: m[1]});
  if (!entry && !game.entryOverride && !inlineModules.length) throw Error('the page has no <script type="module">');
  const fromFile = !!(entry || game.entryOverride);
  return {title, lang, htmlAttrs: attrs('html').replace(/lang="[^"]*"/, ''), bodyAttrs: attrs('body'), body, inline, css,
    entry: fromFile ? path.join(game.repo, game.entryOverride ?? entry) : path.join(game.repo, '__page_module__.js'),
    inlineModule: fromFile ? null : inlineModules.join('\n;\n')};
}

function threeFiles(game) {
  // The game's own three, or the runtime's copy for games without node_modules (test fixtures).
  let dir = path.join(game.repo, 'node_modules/three/build');
  if (!fs.existsSync(dir)) dir = path.join(runtime, 'node_modules/three/build');
  return {core: path.join(dir, 'three.module.js'), webgpu: path.join(dir, 'three.webgpu.js')};
}

/** esbuild plugin: the browser-build conventions (Vite's) that games rely on, plus the three alias. */
function bridgePlugin(game, page) {
  const three = threeFiles(game);
  const src = path.join(runtime, 'src');
  return {
    name: 'jsgamebridge',
    setup(b) {
      b.onResolve({filter: /^jsgb:game$/}, () => page.inlineModule === null ? {path: page.entry} : {path: page.entry, namespace: 'jsgb-page-module'});
      b.onLoad({filter: /.*/, namespace: 'jsgb-page-module'}, () => ({contents: page.inlineModule, resolveDir: game.repo, loader: 'js'}));
      // Adapters (Games/<game>.json "adapters"): the bridge's own modules for one game, run once the game's entry has
      // evaluated, such as a row in the game's options menu for a host feature. The game's files stay as they are.
      b.onResolve({filter: /^jsgb:adapters$/}, () => ({path: 'adapters', namespace: 'jsgb-adapters'}));
      b.onLoad({filter: /.*/, namespace: 'jsgb-adapters'}, () => ({resolveDir: bridge, loader: 'js',
        contents: (game.adapters ?? []).map(f => `import ${JSON.stringify(path.resolve(bridge, f))};`).join('\n') || 'export {};'}));
      // 'three' is the real library with WebGLRenderer replaced; the runtime reaches the real one as 'three-real'.
      b.onResolve({filter: /^three$/}, a => a.importer === path.join(src, 'three.ts') ? {path: three.core} : {path: path.join(src, 'three.ts')});
      b.onResolve({filter: /^three-real$/}, () => ({path: three.core}));
      b.onResolve({filter: /^three\/webgpu$/}, () => ({path: 'three/webgpu', namespace: 'jsgb-three-webgpu'}));
      b.onLoad({filter: /.*/, namespace: 'jsgb-three-webgpu'}, () => ({resolveDir: src, loader: 'js',
        contents: `export * from ${JSON.stringify(three.webgpu)};\nexport {UnrealRenderer as WebGPURenderer, UnrealRenderer as WebGLRenderer} from './renderer.ts';\n`}));
      for (const [from, to] of Object.entries(game.alias ?? {})) b.onResolve({filter: new RegExp(from)}, () => ({path: path.resolve(game.repo, to)}));
      for (const [from, contents] of Object.entries(game.stub ?? {})) {
        b.onResolve({filter: new RegExp(from)}, a => ({path: a.path, namespace: 'jsgb-stub', pluginData: contents}));
      }
      b.onLoad({filter: /.*/, namespace: 'jsgb-stub'}, a => ({contents: a.pluginData, loader: 'js'}));
      // Site-root URLs in CSS (/fonts/x.woff2) are served from the public folders at run time.
      // Root-relative imports (/src/x.js) resolve against the repo, as the Vite dev server does.
      b.onResolve({filter: /^\//}, a => {
        if (a.kind === 'url-token' || a.kind === 'import-rule') return {path: a.path, external: true};
        const file = path.join(game.repo, a.path.split('?')[0]);
        return fs.existsSync(file) && !a.path.includes('?') ? {path: file} : undefined;
      });
      // Vite query suffixes.
      b.onResolve({filter: /\?(raw|url|inline|worker|sharedworker)$/}, a => {
        const [file, query] = a.path.split('?');
        return {path: path.resolve(a.resolveDir, file), namespace: 'jsgb-' + (query === 'sharedworker' ? 'worker' : query), pluginData: a.resolveDir};
      });
      b.onLoad({filter: /.*/, namespace: 'jsgb-raw'}, a => ({contents: fs.readFileSync(a.path, 'utf8'), loader: 'text'}));
      b.onLoad({filter: /.*/, namespace: 'jsgb-inline'}, a => ({contents: fs.readFileSync(a.path, 'utf8'), loader: 'text'}));
      b.onLoad({filter: /.*/, namespace: 'jsgb-url'}, a => ({contents: fs.readFileSync(a.path), loader: 'file'}));
      b.onLoad({filter: /.*/, namespace: 'jsgb-worker'}, a => ({resolveDir: path.dirname(a.path), loader: 'js',
        contents: `import main from ${JSON.stringify('jsgb-worker-main:' + a.path)};\nexport default class extends Worker { constructor(options) { super(main, options); } };\n`}));
      // three's GLTFLoader tells the overrides which file each model came from (Runtime/src/overrides.ts).
      b.onLoad({filter: /[\\/]GLTFLoader\.js$/}, async a => ({resolveDir: path.dirname(a.path), loader: 'js', contents: (await fs.promises.readFile(a.path, 'utf8')) + `
import {gltfLoaded as __jsgbGltfLoaded} from ${JSON.stringify(path.join(src, 'overrides.ts'))};
{
  const parse = GLTFLoader.prototype.parse;
  GLTFLoader.prototype.parse = function (data, path, onLoad, onError) {
    return parse.call(this, data, path, gltf => { try { __jsgbGltfLoaded(gltf, path); } catch {} onLoad(gltf); }, onError);
  };
  const load = GLTFLoader.prototype.load;
  GLTFLoader.prototype.load = function (url, onLoad, onProgress, onError) {
    return load.call(this, url, gltf => { try { __jsgbGltfLoaded(gltf, url); } catch {} onLoad(gltf); }, onProgress, onError);
  };
}
`}));
      // Workers: each worker module becomes a function of its own `self`, sharing the main bundle's modules.
      b.onLoad({filter: /\.(m?[jt]sx?)$/}, async a => {
        if (a.path.includes('node_modules') || a.namespace !== 'file') return undefined;
        let code = await fs.promises.readFile(a.path, 'utf8');
        let changed = false;
        if (code.includes('new Worker(')) {
          const imports = [];
          code = code.replace(/new Worker\(\s*new URL\(\s*(['"`])(.+?)\1\s*,\s*import\.meta\.url\s*\)/g, (_m, _q, rel) => {
            const name = `__jsgbWorker${imports.length}`;
            imports.push(`import ${name} from ${JSON.stringify('jsgb-worker-main:' + path.resolve(path.dirname(a.path), rel))};`);
            return `new Worker(${name}`;
          });
          if (imports.length) { code = imports.join('\n') + '\n' + code; changed = true; }
        }
        if (code.includes('import.meta.glob')) { code = expandGlobs(code, path.dirname(a.path)); changed = true; }
        if (code.includes('import.meta.url')) { code = code.replaceAll('import.meta.url', JSON.stringify('http://localhost/' + path.relative(game.repo, a.path).replaceAll('\\', '/'))); changed = true; }
        return changed ? {contents: code, loader: path.extname(a.path).slice(1).replace('mjs', 'js').replace('cjs', 'js')} : undefined;
      });
      b.onResolve({filter: /^jsgb-worker-main:/}, a => ({path: a.path.slice('jsgb-worker-main:'.length), namespace: 'jsgb-worker-main'}));
      b.onLoad({filter: /.*/, namespace: 'jsgb-worker-main'}, async a => {
        const code = await fs.promises.readFile(a.path, 'utf8');
        const top = [], body = [];
        for (const line of code.split(/\r?\n/)) {
          if (/^\s*import\s/.test(line) || /^export\s+(interface|type)\s/.test(line)) top.push(line);
          else if (/^export\s*\{\s*\};?\s*$/.test(line) || /^\/\/\/\s*<reference/.test(line)) continue;
          else body.push(line.replace(/\bself\b/g, '__jsgbSelf').replace(/\bglobalThis\b/g, '__jsgbSelf').replace(/^(\s*)onmessage\s*=/, '$1__jsgbSelf.onmessage ='));
        }
        // The same module is also bundled on its own (workerBundles), so it can run on a worker thread.
        const url = workerUrl(game, a.path);
        workerEntries.set(a.path, url);
        return {contents: `${top.join('\n')}\nexport default function __jsgbWorkerMain(__jsgbSelf) {\nconst postMessage = (d, t) => __jsgbSelf.postMessage(d, t);\n${body.join('\n')}\n}\n__jsgbWorkerMain.url = ${JSON.stringify(url)};\n`,
          loader: path.extname(a.path) === '.ts' ? 'ts' : 'js', resolveDir: path.dirname(a.path), watchFiles: [a.path]};
      });
    },
  };
}

/** Worker modules the main build met, and the URL of each one's standalone bundle. */
const workerEntries = new Map();
const workerUrl = (game, file) => '/jsgb/workers/' + path.relative(game.repo, file).replace(/[\\/:]+/g, '_').replace(/\.(m?[jt]sx?)$/, '') + '.js';

/** Bundles each worker module as a classic script for a worker thread. */
async function workerBundles(esbuild, game, page, options) {
  for (const [file, url] of workerEntries) {
    const outfile = path.join(game.out, url.slice(1));
    await esbuild.build({...options, entryPoints: [file], format: 'iife', splitting: false, metafile: false, outfile, plugins: [bridgePlugin(game, page)]});
    // A worker thread has no __jsgbHost: a runtime module that imports host.ts throws there before the worker starts.
    if (fs.readFileSync(outfile, 'utf8').includes('__jsgbHost is missing')) throw Error(`worker bundle ${url} includes Runtime/src/host.ts; a module the worker imports (three.ts, renderer.ts) must not import the host`);
  }
}

/** import.meta.glob('./dir/*.json', {eager, import, query}) as Vite expands it. */
function expandGlobs(code, dir) {
  let n = 0;
  const hoisted = [];
  const out = code.replace(/import\.meta\.glob(?:<[^>]*>)?\(\s*(\[[^\]]*\]|(['"`])[^'"`]+\2)\s*(?:,\s*(\{[^}]*\}))?\s*\)/g, (_m, pat, _q, optText) => {
    const patterns = pat.startsWith('[') ? [...pat.matchAll(/(['"`])([^'"`]+)\1/g)].map(x => x[2]) : [pat.slice(1, -1)];
    const opts = optText ? Function(`return (${optText})`)() : {};
    const files = new Set();
    for (const p of patterns.filter(p => !p.startsWith('!'))) {
      const rx = new RegExp('^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(?:.*/)?').replace(/\*/g, '[^/]*') + '$');
      const base = path.resolve(dir, p.split('*')[0].replace(/[^/]*$/, ''));
      const walk = d => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, {withFileTypes: true}) : []) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else { const rel = './' + path.relative(dir, f).replaceAll('\\', '/'); if (rx.test(rel) || rx.test(rel.slice(2))) files.add(rel); } } };
      walk(base);
    }
    const suffix = opts.query ? (typeof opts.query === 'string' ? opts.query : '?' + new URLSearchParams(opts.query)) : '';
    const entries = [...files].sort().map(f => {
      if (opts.eager) { const name = `__jsgbGlob${n++}`; hoisted.push(opts.import && opts.import !== 'default' ? `import {${opts.import} as ${name}} from ${JSON.stringify(f + suffix)};` : opts.import === 'default' ? `import ${name} from ${JSON.stringify(f + suffix)};` : `import * as ${name} from ${JSON.stringify(f + suffix)};`); return `${JSON.stringify(f)}: ${name}`; }
      return `${JSON.stringify(f)}: () => import(${JSON.stringify(f + suffix)})${opts.import ? `.then(m => m[${JSON.stringify(opts.import)}])` : ''}`;
    });
    return `({${entries.join(', ')}})`;
  });
  return hoisted.join('\n') + '\n' + out;
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (repo, ...args) => { try { return execFileSync('git', ['--no-optional-locks', '-C', repo, ...args], {encoding: 'utf8'}).trim(); } catch { return ''; } };

// three gives every object a random id from Math.random. A browser bundle keeps WebGLRenderer, whose module-level
// objects draw ids before the game's own code runs; the Unreal bundle replaces WebGLRenderer, so it draws as many
// on purpose (Runtime/src/three.ts) and a seeded game builds the same world on both sides. Counted per three build.
const webglDrawCache = new Map();
async function webglModuleDraws(esbuild, threeModule) {
  if (webglDrawCache.has(threeModule)) return webglDrawCache.get(threeModule);
  const count = async names => {
    const r = await esbuild.build({stdin: {contents: `import {${names}} from ${JSON.stringify(threeModule)}; globalThis.__jsgbKeep = [${names}];`, resolveDir: runtime, loader: 'js'},
      bundle: true, write: false, format: 'iife', platform: 'neutral', logLevel: 'silent'});
    const real = Math.random, hadSelf = 'self' in globalThis;
    let n = 0;
    Math.random = () => { n++; return real(); };
    try { if (!hadSelf) globalThis.self = globalThis; (0, eval)(r.outputFiles[0].text); } finally { Math.random = real; if (!hadSelf) delete globalThis.self; delete globalThis.__jsgbKeep; }
    return n;
  };
  let draws = 0;
  try { draws = (await count('WebGLRenderer, Object3D')) - (await count('Object3D')); } catch (e) { console.warn(`three: could not count WebGLRenderer's module-level ids (${e.message}); seeded worlds may differ`); }
  webglDrawCache.set(threeModule, draws);
  return draws;
}

export async function build(game) {
  if (game.page) return buildPage(game);
  const esbuild = await import(pathToFileURL(path.join(runtime, 'node_modules/esbuild/lib/main.js')).href);
  const started = performance.now();
  const page = readPage(game);
  const commit = git(game.repo, 'rev-parse', 'HEAD');
  fs.mkdirSync(game.out, {recursive: true});
  const pageInfo = {title: page.title, lang: page.lang, htmlAttrs: page.htmlAttrs, bodyAttrs: page.bodyAttrs, body: page.body};
  // Settings shared by the game bundle and the standalone worker bundles.
  const common = {
    bundle: true, target: game.target ?? 'es2022', platform: 'neutral',
    mainFields: ['browser', 'module', 'main'], conditions: ['browser', 'import', 'module', 'default'],
    absWorkingDir: game.repo, nodePaths: [path.join(game.repo, 'node_modules'), path.join(runtime, 'node_modules')],
    define: {
      'import.meta.env': JSON.stringify({DEV: false, PROD: true, SSR: false, MODE: 'production', BASE_URL: '/', UNREAL: true, ...(game.env ?? {})}),
      __JSGB_WEBGL_MODULE_DRAWS__: String(await webglModuleDraws(esbuild, threeFiles(game).core)),
      __JSGB_SHADER_VERSION__: JSON.stringify(sha256(Buffer.concat([fs.readFileSync(path.join(runtime, 'src/shaders.ts')), fs.readFileSync(path.join(runtime, 'vendor/cross-shader/CrossShader.wasm'))])).slice(0, 12)),
      'process.env.NODE_ENV': '"production"', 'import.meta.hot': 'undefined', 'import.meta.url': '"http://localhost/index.js"', __JSGB_PAGE__: JSON.stringify(pageInfo), __JSGB_INLINE__: JSON.stringify(page.inline), ...(game.define ?? {}),
    },
    loader: {'.json': 'json', '.css': 'css', '.glsl': 'text', '.vert': 'text', '.frag': 'text', '.wgsl': 'text', '.txt': 'text',
      '.png': 'file', '.jpg': 'file', '.jpeg': 'file', '.webp': 'file', '.svg': 'file', '.gif': 'file', '.woff': 'file', '.woff2': 'file', '.ttf': 'file', '.otf': 'file',
      '.wasm': 'file', '.glb': 'file', '.gltf': 'file', '.ktx2': 'file', '.bin': 'file', '.ogg': 'file', '.mp3': 'file', '.wav': 'file', '.hdr': 'file', '.exr': 'file'},
    assetNames: 'assets/[name]-[hash]', publicPath: '/', logLevel: 'warning', legalComments: 'none', keepNames: false, minify: false, sourcemap: false,
    external: ['fs', 'path', 'crypto', 'url', 'module', 'worker_threads'],
    logOverride: {'direct-eval': 'silent', 'empty-import-meta': 'silent', 'import-is-undefined': 'silent', 'unsupported-dynamic-import': 'silent'},
  };
  workerEntries.clear();
  const result = await esbuild.build({...common, entryPoints: {[game.id]: path.join(runtime, 'src/entry.ts')}, outdir: game.out, outExtension: {'.js': '.mjs'},
    format: 'esm', splitting: false, metafile: true, plugins: [bridgePlugin(game, page)]});
  await workerBundles(esbuild, game, page, common);
  // Runtime files the bundle reads at run time (the shader compiler, and the runtime inside threaded Web Workers).
  fs.mkdirSync(path.join(game.out, 'jsgb'), {recursive: true});
  await esbuild.build({entryPoints: [path.join(runtime, 'src/workerRuntime.ts')], bundle: true, format: 'iife', target: 'es2020', platform: 'neutral',
    mainFields: ['browser', 'module', 'main'], nodePaths: [path.join(runtime, 'node_modules')], outfile: path.join(game.out, 'jsgb/worker-runtime.js'), logLevel: 'warning'});
  const wasm = path.join(runtime, 'vendor/cross-shader/CrossShader.wasm'), wasmOut = path.join(game.out, 'jsgb/CrossShader.wasm');
  if (!fs.existsSync(wasmOut) || fs.statSync(wasmOut).size !== fs.statSync(wasm).size) fs.copyFileSync(wasm, wasmOut);
  // index.html stylesheets come after the CSS the modules import, as in the page.
  const cssFile = path.join(game.out, game.id + '.css');
  const moduleCss = fs.existsSync(cssFile) ? fs.readFileSync(cssFile, 'utf8') : '';
  const allCss = page.css.map(c => c.text).join('\n') + '\n' + moduleCss;
  fs.writeFileSync(cssFile, allCss);
  // Font faces the canvas text rasterizer can load (FreeType reads TTF and OTF, not WOFF2).
  const faces = [];
  for (const m of allCss.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const family = /font-family\s*:\s*['"]?([^;'"]+)/.exec(m[1])?.[1]?.trim();
    const url = [...m[1].matchAll(/url\(\s*['"]?([^'")]+\.(?:ttf|otf))['"]?\s*\)/gi)].map(u => u[1])[0];
    if (!family || !url) continue;
    const weight = /font-weight\s*:\s*(\w+)/.exec(m[1])?.[1] ?? '400';
    faces.push({family, url: url.startsWith('/') ? url : '/' + url.replace(/^\.\//, ''), weight: weight === 'bold' ? 700 : weight === 'normal' ? 400 : +weight || 400,
      style: /font-style\s*:\s*italic/.test(m[1]) ? 'italic' : 'normal'});
  }
  fs.writeFileSync(path.join(game.out, 'jsgb/fonts.json'), JSON.stringify(faces));
  fs.writeFileSync(path.join(game.out, 'page.json'), JSON.stringify({...pageInfo, css: game.id + '.css'}, null, 1));
  const bundlePath = path.join(game.out, game.id + '.mjs');
  const bundle = fs.readFileSync(bundlePath);
  // The registry the host loads: every map the game lists, merged key by key.
  const assets = {};
  for (const file of game.registry) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')).assets ?? {})) assets[k] = {...assets[k], ...v};
  // Web audio files that the audio pipeline imported as Unreal sound waves play those assets.
  const files = {};
  if (game.audioCues) {
    const cues = JSON.parse(fs.readFileSync(path.resolve(bridge, game.audioCues.file), 'utf8')).games?.[game.audioCues.game]?.cues ?? {};
    for (const cue of Object.values(cues)) for (const v of cue.variants ?? []) if (v.source && v.wave) files[v.source.replaceAll('\\', '/').replace(/^.*?\/public(?=\/)/, '')] = v.wave;
  }
  // Asset overrides (Games/<game>.json "overrides"): the host reads overrides.json from beside publication.json.
  const overridesOut = path.join(game.out, 'overrides.json');
  if (game.overrides) fs.copyFileSync(path.resolve(bridge, game.overrides), overridesOut);
  else if (fs.existsSync(overridesOut)) fs.rmSync(overridesOut);
  fs.writeFileSync(path.join(game.out, 'registry.json'), JSON.stringify({version: 1, assets, files, swaps: {assets: !!game.swaps?.assets, effects: !!game.swaps?.effects}}));
  const publication = {version: 1, game: game.id, sourceCommit: commit || '0'.repeat(40), sourceDirty: !!git(game.repo, 'status', '--porcelain', '--untracked-files=no'),
    bridgeCommit: git(bridge, 'rev-parse', 'HEAD'), bundle: bundlePath, bundleSHA256: sha256(bundle), modules: Object.keys(result.metafile.inputs).length,
    bytes: bundle.length, buildMilliseconds: Math.round(performance.now() - started), publicRoots: game.publicRoots, search: game.search ?? '', title: page.title};
  fs.writeFileSync(path.join(game.out, 'publication.json'), JSON.stringify(publication, null, 1));
  console.log(`built ${game.id}: ${publication.modules} modules, ${(bundle.length / 1e6).toFixed(1)} MB, ${publication.buildMilliseconds} ms -> ${bundlePath}`);
  return publication;
}

// A page game ("page": true in Games/<game>.json, for 2D WebGL games such as pixi.js ones) runs its own Vite build in
// Unreal's built-in browser: the host serves <out>/web, then the game's public folders.
async function buildPage(game) {
  const started = performance.now();
  const web = spawnSync(process.execPath, [path.join(bridge, 'Tools/web.mjs'), 'build', game.file ?? game.id], {stdio: 'inherit'});
  if (web.status !== 0) throw Error(`the web build of ${game.id} failed`);
  const page = readPage(game);
  const publication = {version: 1, game: game.id, sourceCommit: git(game.repo, 'rev-parse', 'HEAD') || '0'.repeat(40),
    sourceDirty: !!git(game.repo, 'status', '--porcelain', '--untracked-files=no'), bridgeCommit: git(bridge, 'rev-parse', 'HEAD'),
    page: game.index ?? 'index.html', buildMilliseconds: Math.round(performance.now() - started),
    publicRoots: [path.join(game.out, 'web'), ...(game.public ?? ['public']).map(p => path.resolve(game.repo, p))], search: game.search ?? '', title: page.title};
  fs.writeFileSync(path.join(game.out, 'publication.json'), JSON.stringify(publication, null, 1));
  console.log(`built ${game.id} as a page game in ${publication.buildMilliseconds} ms -> ${path.join(game.out, 'web')}`);
  return publication;
}

export async function reload(game) {
  const publication = JSON.parse(fs.readFileSync(path.join(game.out, 'publication.json'), 'utf8'));
  const endpoint = process.env.JSGB_RELOAD_URL ?? `http://127.0.0.1:${game.reloadPort ?? 5292}/bridge/reload`;
  let response;
  try {
    response = await fetch(endpoint, {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.timeout(5000),
      body: JSON.stringify({version: 1, sourceCommit: publication.sourceCommit, bundlePath: publication.bundle, bundleSHA256: publication.bundleSHA256, buildMs: publication.buildMilliseconds})});
  } catch (error) { throw Error(`Built, but no JsGameBridge host answers at ${endpoint}. Start Unreal with Tools/run-unreal.mjs ${game.id}. (${error.message})`); }
  if (!response.ok) throw Error(`Host rejected the reload: ${response.status} ${await response.text()}`);
  const deadline = performance.now() + 120000;
  for (;;) {
    const status = await (await fetch(new URL('/bridge/status', endpoint), {signal: AbortSignal.timeout(30000)})).json();
    if (status.bundleSHA256 !== publication.bundleSHA256) throw Error('Host is running a different bundle: ' + JSON.stringify(status));
    if (status.ready && status.lastReloadMs >= 0) {
      console.log(`hot reload of ${game.id}: build ${(publication.buildMilliseconds / 1000).toFixed(2)} s + Unreal ${(status.lastReloadMs / 1000).toFixed(2)} s = ${((publication.buildMilliseconds + status.lastReloadMs) / 1000).toFixed(2)} s (${status.jsErrors} JS errors)`);
      return status;
    }
    if (performance.now() > deadline) throw Error('Host accepted the bundle but the game did not boot within 120 s');
    await new Promise(r => setTimeout(r, 250));
  }
}

/** Sends a stylesheet-only change: the Unreal overlay swaps the page CSS while the game keeps running. */
export async function swapCss(game) {
  const publication = JSON.parse(fs.readFileSync(path.join(game.out, 'publication.json'), 'utf8'));
  const host = `http://127.0.0.1:${game.reloadPort ?? 5292}/bridge`;
  const status = async () => (await fetch(`${host}/status`, {signal: AbortSignal.timeout(30000)})).json();
  const response = await fetch(`${host}/css`, {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.timeout(5000),
    body: JSON.stringify({buildMs: publication.buildMilliseconds})}).catch(error => { throw Error(`Built, but no JsGameBridge host answers at ${host}. (${error.message})`); });
  const {cssVersion} = await response.json();
  const deadline = performance.now() + 30000;
  for (;;) {
    const s = await status();
    if (s.cssAppliedVersion >= cssVersion && s.lastCssMs >= 0) {
      console.log(`hot reload (CSS) of ${game.id}: build ${(publication.buildMilliseconds / 1000).toFixed(2)} s + Unreal ${(s.lastCssMs / 1000).toFixed(2)} s = ${((publication.buildMilliseconds + s.lastCssMs) / 1000).toFixed(2)} s`);
      return s;
    }
    if (performance.now() > deadline) throw Error('the overlay did not apply the new stylesheet within 30 s');
    await new Promise(r => setTimeout(r, 50));
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (!isMain) { /* imported as a library */ }
else if (command === 'build') await build(loadGame(gameArg));
else if (command === 'reload') await reload(loadGame(gameArg));
else if (command === 'unreal' || command === 'watch') {
  const game = loadGame(gameArg);
  if (command === 'unreal') {
    // One command: build, then reload the game into a running host or start one in a window.
    await build(game);
    const port = game.reloadPort ?? 5292;
    const running = await fetch(`http://127.0.0.1:${port}/bridge/status`, {signal: AbortSignal.timeout(2000)}).then(r => r.json()).catch(() => null);
    if (running && path.dirname(path.resolve(running.bundle ?? '')) === game.out) await reload(game);
    else if (running) throw Error(`Unreal is running another game (${running.game}); close it first`);
    else {
      const started = spawnSync(process.execPath, [path.join(bridge, 'Tools/run-unreal.mjs'), gameArg, '--res', flag('--res', '1600x900'), '--timeout', flag('--timeout', '14400'), '--detach', ...(flag('--search') ? ['--search', flag('--search')] : []), ...['--offscreen', '--mute', '--frame-gen', '--hud'].filter(has), ...['--dlss', '--tsr', '--vibrance'].flatMap(f => flag(f) ? [f, flag(f)] : [])], {stdio: 'inherit'});
      if (started.status !== 0) throw Error('Unreal did not start; see the log above');
    }
  }
  // Every save in the game's folder (outside node_modules, builds and dot folders) rebuilds the
  // bundle and reloads it into the running Unreal host.
  const skip = /(^|[\\/])(node_modules|dist[^\\/]*|output|\.[^\\/]+)([\\/]|$)/;
  let timer = null, busy = false, again = false, changed = new Set();
  const run = async () => {
    if (busy) { again = true; return; }
    busy = true;
    const files = [...changed]; changed = new Set();
    console.log(`\nchanged ${files.join(', ')}`);
    try { await build(game); files.every(f => /\.css$/.test(f)) ? await swapCss(game) : await reload(game); } catch (error) { console.log('reload failed: ' + error.message); }
    busy = false;
    if (again) { again = false; run(); }
  };
  fs.watch(game.repo, {recursive: true}, (event, file) => {
    if (!file || skip.test(file) || !/\.(m?[jt]sx?|css|html|json|glsl|vert|frag|wgsl)$/.test(file)) return;
    changed.add(file);
    clearTimeout(timer); timer = setTimeout(run, 120);
  });
  console.log(`watching ${game.repo} for ${game.id}; save a file to reload it into Unreal`);
}
else if (command === 'smoke') {
  const game = loadGame(gameArg);
  if (!has('--no-build')) await build(game);
  const {smoke} = await import(pathToFileURL(path.join(bridge, 'Tools/smoke.mjs')).href);
  const report = await smoke(game, {frames: +flag('--frames', 600), script: flag('--script'), search: flag('--search', game.search ?? ''), verbose: has('--verbose')});
  process.exit(report.errors || !report.booted ? 1 : 0);
} else if (command) { console.error('unknown command: ' + command); process.exit(2); }
