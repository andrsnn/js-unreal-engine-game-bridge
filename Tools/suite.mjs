#!/usr/bin/env node
// The conformance and eval suite: every case of Tests/suite and a list of real games, each run in the browser and
// in Unreal from the same commit with the same script (Tools/conformance.mjs), then scored:
//   - picture: SSIM and PSNR between paired browser and Unreal frames (a sample of up to 12 pairs per run)
//   - coverage: every Unreal frame draws at least the objects, line segments, sprites and points the browser drew
//   - errors: JavaScript errors in the browser and in Unreal
//   - cost: the game's JavaScript time per frame and memory in Unreal, and the JavaScript heap in Chrome
// It writes Docs/conformance/README.md, index.html, results.json and thumbnails, and exits with 1 if anything fails.
//   node Tools/suite.mjs [--cases a,b] [--games fixture,orbit-demo] [--only-cases] [--only-games] [--report-only] [--web-only] [--films]
// --web-only runs only the browser half (no Unreal, as on a CI machine without it): a run passes when Chrome captured
// its frames without a JavaScript error. Its report goes to the work folder, not Docs/conformance.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readJson, settings} from './jsgb.mjs';

const bridge = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rest = process.argv.slice(2);
const flag = (name, fallback) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : fallback; };
const has = name => rest.includes(name);
const work = path.join(settings().builds, 'conformance-suite');
const webOnly = has('--web-only');
const docs = webOnly ? path.join(work, 'web-report') : path.join(bridge, 'Docs', 'conformance');
const log = t => console.log(`[suite ${new Date().toISOString().slice(11, 19)}] ${t}`);

// The cases: Tests/suite/src/cases/index.js lists them by name.
const index = fs.readFileSync(path.join(bridge, 'Tests/suite/src/cases/index.js'), 'utf8');
const allCases = (/export const cases = \{([^}]*)\}/.exec(index)?.[1] ?? '').split(',').map(s => s.trim()).filter(Boolean);
const cases = has('--only-games') ? [] : flag('--cases') ? flag('--cases').split(',') : allCases;
// Real games, run unchanged with their own conformance scripts (Tests/scripts/<game>.txt): by default every
// Games/<game>.json with "suite": true.
const suiteGames = () => fs.readdirSync(path.join(bridge, 'Games')).filter(f => f.endsWith('.json'))
  .filter(f => { try { return readJson(path.join(bridge, 'Games', f)).suite === true; } catch { return false; } }).map(f => f.slice(0, -5)).sort();
// A game whose source is not on this machine (a private game on a CI runner) is skipped, and the log says so.
const gameRepo = game => { try { return path.resolve(bridge, readJson(path.join(bridge, 'Games', `${game}.json`)).repo); } catch { return ''; } };
const games = (has('--only-cases') ? [] : (flag('--games')?.split(',') ?? suiteGames()).filter(Boolean))
  .filter(game => fs.existsSync(gameRepo(game)) || (console.log(`[suite] skipping ${game}: its source is not on this machine`), false));
const entries = [
  // A case with its own steps (input) has Tests/scripts/suite-<case>.txt; the rest share Tests/scripts/suite.txt.
  ...cases.map(name => ({id: `case-${name}`, label: name, kind: 'case', game: 'suite', search: `?case=${name}`,
    script: fs.existsSync(path.join(bridge, `Tests/scripts/suite-${name}.txt`)) ? `Tests/scripts/suite-${name}.txt` : 'Tests/scripts/suite.txt', ssimMin: 0.9, changedMax: 2.5})),
  ...games.map(game => ({id: `game-${game}`, label: game, kind: 'game', game, script: `Tests/scripts/${game}.txt`, ssimMin: 0.7, changedMax: 20})),
];

function ffmpegMetric(a, b, filter, rx) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', a, '-i', b, '-lavfi', `[0:v]scale=640:360,format=yuv444p[x];[1:v]scale=640:360,format=yuv444p[y];[x][y]${filter}`, '-f', 'null', '-'], {encoding: 'utf8'});
  const m = rx.exec(r.stderr ?? '');
  return m ? (m[1] === 'inf' ? 99 : +m[1]) : null;
}

function evaluate(entry) {
  const dir = path.join(work, entry.id);
  const report = fs.existsSync(path.join(dir, 'report.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'report.json'), 'utf8')) : null;
  const pairsDir = path.join(dir, 'pairs');
  const pairs = fs.existsSync(pairsDir) ? fs.readdirSync(pairsDir).filter(f => f.startsWith('web_')).sort() : [];
  // Skip the first second: both sides may still be loading at slightly different times.
  const usable = pairs.slice(Math.min(10, Math.floor(pairs.length / 4)));
  const sample = usable.filter((_, i) => i % Math.max(1, Math.floor(usable.length / 12)) === 0).slice(0, 12);
  const ssim = [], psnr = [];
  for (const f of sample) {
    const a = path.join(pairsDir, f), b = path.join(pairsDir, f.replace('web_', 'ue_'));
    if (!fs.existsSync(b)) continue;
    const s = ffmpegMetric(a, b, 'ssim', /All:([\d.]+|inf)/);
    const p = ffmpegMetric(a, b, 'psnr', /average:([\d.]+|inf)/);
    if (s !== null) ssim.push(s);
    if (p !== null) psnr.push(p);
  }
  const mean = l => l.length ? l.reduce((x, y) => x + y, 0) / l.length : null;
  // Share of pixels that clearly differ (Tools/pixel-diff.py): SSIM over a whole frame hardly moves when one
  // object is wrong, this does.
  const pairArgs = sample.flatMap(f => [path.join(pairsDir, f), path.join(pairsDir, f.replace('web_', 'ue_'))]).filter(f => fs.existsSync(f));
  const changed = pairArgs.length ? spawnSync('python', [path.join(bridge, 'Tools/pixel-diff.py'), ...pairArgs], {encoding: 'utf8'}).stdout.trim().split(/\s+/).map(Number).filter(Number.isFinite) : [];
  const webErrors = report?.web?.errors?.length ?? null;
  const unrealErrors = report?.unreal?.status?.jsErrors ?? null;
  const row = {
    id: entry.id, label: entry.label, kind: entry.kind,
    ssim: mean(ssim) === null ? null : +mean(ssim).toFixed(3), ssimLow: ssim.length ? +Math.min(...ssim).toFixed(3) : null, psnr: mean(psnr) === null ? null : +mean(psnr).toFixed(1),
    changedPct: mean(changed) === null ? null : +mean(changed).toFixed(2), changedWorstPct: changed.length ? +Math.max(...changed).toFixed(2) : null,
    pairsScored: ssim.length, coverage: report?.objectCheck?.pass ?? false, coverageFailures: report?.objectCheck?.failures ?? null,
    coverageNote: report?.objectCheck?.first?.[0]?.problems?.[0] ?? '',
    webErrors, unrealErrors, firstWebError: report?.web?.errors?.[0] ?? '',
    jsMs: report?.unreal?.status?.jsMs !== undefined ? +report.unreal.status.jsMs.toFixed(2) : null,
    memoryMB: report?.unreal?.status?.memoryMB !== undefined ? Math.round(report.unreal.status.memoryMB) : null,
    jsHeapMB: report?.web?.jsHeapMB ?? null, seconds: entry.seconds ?? null,
  };
  const reasons = [];
  if (webOnly) {
    if (!report?.web) reasons.push('no browser run');
    else if (!(report.web.frames > 0)) reasons.push('the browser captured no frames');
    if (webErrors) reasons.push(`${webErrors} browser errors: ${row.firstWebError.slice(0, 120)}`);
    row.pass = reasons.length === 0;
    row.reasons = reasons;
    return row;
  }
  if (!report) reasons.push('no run');
  if (row.ssim === null) reasons.push('no frames to compare');
  else if (row.ssim < entry.ssimMin) reasons.push(`picture SSIM ${row.ssim} < ${entry.ssimMin}`);
  if (row.changedPct !== null && row.changedPct > entry.changedMax) reasons.push(`${row.changedPct}% of pixels differ (limit ${entry.changedMax}%)`);
  if (!row.coverage) reasons.push(`coverage: ${row.coverageNote || 'failed'}`);
  if (webErrors) reasons.push(`${webErrors} browser errors`);
  if (unrealErrors) reasons.push(`${unrealErrors} Unreal JavaScript errors`);
  row.pass = reasons.length === 0;
  row.reasons = reasons;
  // Thumbnail: the last named still, side by side.
  const stills = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('-side-by-side.png')).sort() : [];
  if (stills.length) {
    fs.mkdirSync(path.join(docs, 'img'), {recursive: true});
    spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(dir, stills.at(-1)), '-vf', 'scale=960:-2', '-q:v', '5', path.join(docs, 'img', `${entry.id}.jpg`)]);
    row.thumb = `img/${entry.id}.jpg`;
  }
  return row;
}

if (!has('--report-only')) {
  for (const entry of entries) {
    log(`${entry.id}: running`);
    const t0 = Date.now();
    const args = [path.join(bridge, 'Tools/conformance.mjs'), entry.game, '--script', path.join(bridge, entry.script), '--out', path.join(work, entry.id), ...(has('--films') ? [] : ['--no-film']), ...(entry.search ? ['--search', entry.search] : []), ...(webOnly ? ['--skip-unreal'] : [])];
    const r = spawnSync(process.execPath, args, {cwd: bridge, encoding: 'utf8', timeout: 1800000, maxBuffer: 1 << 26});
    entry.seconds = Math.round((Date.now() - t0) / 1000);
    const line = (r.stdout ?? '').split('\n').find(l => /object check|OBJECT CHECK/.test(l)) ?? (r.stderr ?? '').trim().split('\n').slice(-1)[0];
    log(`${entry.id}: ${entry.seconds} s, ${line?.slice(0, 160)}`);
  }
}

const rows = entries.map(evaluate);
const commit = spawnSync('git', ['-C', bridge, 'rev-parse', '--short', 'HEAD'], {encoding: 'utf8'}).stdout.trim();
const passed = rows.filter(r => r.pass).length;
fs.mkdirSync(docs, {recursive: true});
fs.writeFileSync(path.join(docs, 'results.json'), JSON.stringify({commit, date: new Date().toISOString(), passed, total: rows.length, rows}, null, 1));
const cell = v => v === null || v === undefined ? '' : String(v);
// Differences that come from how the two renderers work, not from a bridge bug, with the cases they affect.
const known = [
  ['transparency', 'WebGL blends transparent surfaces using sRGB values, and Unreal blends them in linear light. Over a dark background a transparent colour comes out brighter in Unreal, and over a light one darker. No single change to opacity matches both.'],
];
const md = [
  '# Conformance results', '',
  `Bridge commit ${commit}, ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. ${passed} of ${rows.length} passed.`, '',
  'Each run plays the same script in Chrome and in Unreal from the same commit, with a fixed game clock, and compares',
  'the paired frames. A case passes when the pictures match (SSIM at least 0.9 and at most 2.5% of pixels clearly different for test',
  'cases; SSIM 0.7 and 20% for games), every',
  'Unreal frame after the game finishes loading draws at least what the browser drew, and neither side reports a JavaScript error.', '',
  '| Run | Result | SSIM (mean, lowest) | Pixels differing % (mean, worst) | PSNR dB | Coverage | Errors (browser, Unreal) | JS ms/frame in Unreal | Unreal memory MB | Chrome JS heap MB | Notes |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map(r => `| ${r.label} | ${r.pass ? 'pass' : 'FAIL'} | ${cell(r.ssim)}, ${cell(r.ssimLow)} | ${cell(r.changedPct)}, ${cell(r.changedWorstPct)} | ${cell(r.psnr)} | ${r.coverage ? 'ok' : `${cell(r.coverageFailures)} frames`} | ${cell(r.webErrors)}, ${cell(r.unrealErrors)} | ${cell(r.jsMs)} | ${cell(r.memoryMB)} | ${cell(r.jsHeapMB)} | ${r.reasons.join('; ').replace(/\|/g, '/')} |`),
  '', '## Known differences', '',
  ...known.map(([c, text]) => `- **${c}**: ${text}`),
  '', '## Side by side (browser left, Unreal right)', '',
  ...rows.filter(r => r.thumb).flatMap(r => [`### ${r.label}`, '', `![${r.label}](${r.thumb})`, '']),
].join('\n');
fs.writeFileSync(path.join(docs, 'README.md'), md);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Conformance results</title>
<style>
:root { --bg: #fff; --fg: #1a1d21; --muted: #5d6670; --line: #dde1e6; --pass: #1f7a3a; --fail: #b3261e; }
@media (prefers-color-scheme: dark) { :root { --bg: #111417; --fg: #e8ecef; --muted: #9aa4ae; --line: #2a3036; --pass: #5cc77d; --fail: #ff7a70; } }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { max-width: 1100px; margin: 0 auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
.pass { color: var(--pass); font-weight: 600; } .fail { color: var(--fail); font-weight: 600; }
.wrap { overflow-x: auto; } img { width: 100%; max-width: 960px; display: block; border: 1px solid var(--line); }
p.muted { color: var(--muted); }
</style></head><body><main>
<h1>Conformance results</h1>
<p>Bridge commit ${esc(commit)}, ${esc(new Date().toISOString().slice(0, 16).replace('T', ' '))} UTC. <strong>${passed} of ${rows.length} passed.</strong></p>
<p class="muted">Each run plays the same script in Chrome and in Unreal from the same commit, with a fixed game clock, and compares the paired frames. A case passes when the pictures match (SSIM at least 0.9 and at most 2.5% of pixels clearly different for test cases; SSIM 0.7 and 20% for games), every Unreal frame after the game finishes loading draws at least what the browser drew, and neither side reports a JavaScript error.</p>
<div class="wrap"><table><thead><tr><th>Run</th><th>Result</th><th>SSIM</th><th>Pixels differing %</th><th>PSNR dB</th><th>Coverage</th><th>Errors</th><th>JS ms/frame</th><th>Memory MB</th><th>Notes</th></tr></thead><tbody>
${rows.map(r => `<tr><td>${esc(r.label)}</td><td class="${r.pass ? 'pass' : 'fail'}">${r.pass ? 'pass' : 'fail'}</td><td>${esc(r.ssim)} (low ${esc(r.ssimLow)})</td><td>${esc(r.changedPct)} (worst ${esc(r.changedWorstPct)})</td><td>${esc(r.psnr)}</td><td>${r.coverage ? 'ok' : esc(r.coverageFailures) + ' frames'}</td><td>${esc(r.webErrors)}, ${esc(r.unrealErrors)}</td><td>${esc(r.jsMs)}</td><td>${esc(r.memoryMB)}</td><td>${esc(r.reasons.join('; '))}</td></tr>`).join('\n')}
</tbody></table></div>
<h2>Known differences</h2>
<ul>${known.map(([c, text]) => `<li><strong>${esc(c)}</strong>: ${esc(text)}</li>`).join('')}</ul>
<h2>Side by side (browser left, Unreal right)</h2>
${rows.filter(r => r.thumb).map(r => `<h3>${esc(r.label)}</h3><img src="${esc(r.thumb)}" alt="${esc(r.label)}: browser and Unreal side by side" loading="lazy">`).join('\n')}
</main></body></html>`;
fs.writeFileSync(path.join(docs, 'index.html'), html);
log(`${passed} of ${rows.length} passed; report: ${path.join(docs, 'README.md')}`);
for (const r of rows) console.log(`${r.pass ? 'pass' : 'FAIL'}  ${r.label.padEnd(18)} SSIM ${cell(r.ssim).padEnd(6)} ${r.reasons.join('; ')}`);
process.exitCode = passed === rows.length ? 0 : 1;
