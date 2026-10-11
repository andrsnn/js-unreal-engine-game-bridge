import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const require = createRequire('C:/Users/Aidan Anderson/karvos/package.json');
const {chromium} = require('playwright');
const [game, url, planFile] = process.argv.slice(2);
const pass = Number(process.argv.find(arg => arg.startsWith('--pass='))?.slice(7) || 4);
if (!Number.isInteger(pass) || pass < 4) throw Error('Invalid physical audio pass');
const plan = JSON.parse(await fs.readFile(planFile, 'utf8'));
const out = process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)||`G:/sfx/evidence/${game}/pass${pass}/fixture`;
await fs.mkdir(out, {recursive: true});
const ffmpeg = 'C:/ProgramData/chocolatey/bin/ffmpeg.exe';
const run = args => {
 const result = spawnSync(ffmpeg, args, {encoding: 'utf8', windowsHide: true, timeout: 180000});
 if (result.error || result.status) throw Error(result.stderr?.slice(-2500) || String(result.error));
};
const report = {game, mode: 'fixture', url, offset: 0, elapsed: 0, segments: [], actions: [], errors: [], missing: []};
const browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']});
let context, page;
const snapshot = () => page.evaluate(game => game === 'karvos' ? {audio: karvos.state.audioMixStatus, mode:karvos.state.mode,fuel:karvos.state.fuel,pos: karvos.state.pos.toArray(), health: karvos.state.health, ammo: karvos.state.ammo, shotSerial: karvos.state.shotSerial, mounted: karvos.state.mounted, velocity: karvos.state.velocity, weather: karvos.state.environmentHazards} : {audio: __game.audio(), snapshot: __game.snapshot()}, game);
async function controls() {
 const outputPeak = () => page.evaluate(async () => {
  const destination = __recordOutputs.find(bus => bus.context.state === 'running');
  const source = destination.context.createMediaStreamSource(destination.stream), meter = destination.context.createAnalyser();
  source.connect(meter); await new Promise(resolve => setTimeout(resolve, 180));
  const samples = new Float32Array(meter.fftSize); meter.getFloatTimeDomainData(samples);
  source.disconnect(); meter.disconnect(); return Math.max(...samples.map(Math.abs));
 });
 if (game === 'karvos') {
  const prefs = await page.evaluate(() => ({master: karvos.state.audioVolume, music: karvos.state.audioMix.music, muted: karvos.state.audioMuted}));
  await page.evaluate(() => karvos.state.audioMuted = true); await page.waitForTimeout(700);
  const peak = await outputPeak(); if (peak > .00003) throw Error('Master mute not silent: ' + peak);
  await page.evaluate(prefs => {karvos.state.audioMuted = prefs.muted; karvos.state.audioMix.music = 0;}, prefs);
  const zero = await page.evaluate(() => karvos.state.audioMix.music); if (zero !== 0) throw Error('Music zero failed');
  await page.evaluate(prefs => {karvos.state.audioVolume = prefs.master; karvos.state.audioMix.music = prefs.music;}, prefs);
  return {prefs, muted: {peak, value: true}, zero: {music: zero}, restored: prefs};
 }
 const prefs = await page.evaluate(() => ({...__game.audio().settings}));
 await page.keyboard.press('Escape'); await page.locator('[data-settings]').click();
 await page.locator('[data-mute]').check(); await page.waitForTimeout(700);
 const peak = await outputPeak(); if (peak > .00003) throw Error('Native master mute not silent: ' + peak);
 await page.locator('[data-mute]').uncheck();
 const music = page.locator('[data-volume="music"]'); await music.press('Home');
 if (await page.evaluate(() => __game.audio().settings.music) !== 0) throw Error('Native Music zero failed');
 for (let i = 0; i < Math.round(prefs.music * 100); i++) await music.press('ArrowRight');
 if (prefs.muted) await page.locator('[data-mute]').check();
 const restored = await page.evaluate(() => ({...__game.audio().settings}));
 for (const key of ['master', 'music', 'effects', 'muted']) if (restored[key] !== prefs[key]) throw Error('Native preference restore failed: ' + key);
 await page.locator('[data-back]').click(); await page.locator('[data-resume]').click();
 return {prefs, muted: {peak, value: true}, zero: {music: 0}, restored};
}
async function action(step) {
 if (step.pitch !== undefined && game === 'unlit') {
  await page.mouse.move(640,150); await page.waitForTimeout(200);
  const current = await page.evaluate(() => __game.snapshot().camera.pitch);
  const delta = (step.pitch-current)/.004;
  await page.mouse.move(640,150); await page.mouse.down({button:'middle'});
  await page.mouse.move(640,150+delta,{steps:12}); await page.mouse.up({button:'middle'});
  await page.waitForTimeout(500);
 }
 if (step.assertDigTarget && !await page.evaluate(() => __game.snapshot().dig?.target != null)) throw Error('Native cutter has no material target');
 if (step.waitHunting) {
  await page.waitForFunction(()=>karvos.state.environmentHazards?.predator?.phase==='hunting',null,{timeout:90000});
 }
 if (step.assertMoving && !await page.evaluate(()=>Math.abs(karvos.state.velocity)>.5)) throw Error('Native bike is still blocked');
 if (step.walkTo) {
  const target = await page.evaluate(name => name === 'bike' ? karvos.vehicle.bike.position.toArray() : name, step.walkTo);
  const started = Date.now();
  while (await page.evaluate(target => Math.hypot(karvos.state.pos.x - target[0], karvos.state.pos.z - target[2]), target) > 3.8) {
   if (Date.now() - started > 16000) throw Error('Native walk did not reach target');
   const previous=await page.evaluate(()=>karvos.state.pos.toArray());
   await action({lookAt: target}); await action({keys: ['w'], ms: 450});
   if (await page.evaluate(previous=>Math.hypot(karvos.state.pos.x-previous[0],karvos.state.pos.z-previous[2]),previous)<.2) await action({keys:['a'],ms:600});
  }
 }
 if (step.press) await page.keyboard.press(step.press);
 if (step.lookAt) {
  const target = step.lookAt === 'creature' ? await page.evaluate(() => {
   const enemy = karvos.combat.enemies.filter(enemy => enemy.visible && !enemy.userData.burrowDormant && !enemy.userData.dead && (enemy.userData.hp ?? 1) > 0).sort((a, b) => a.position.distanceTo(karvos.state.pos) - b.position.distanceTo(karvos.state.pos))[0];
   if (!enemy) throw Error('Native save has no visible hunting creature');enemy.updateWorldMatrix(true,true);
   return enemy.userData.sourceBounds&&enemy.userData.body ? enemy.userData.sourceBounds.clone().applyMatrix4(enemy.userData.body.matrixWorld).getCenter(enemy.position.clone()).toArray() : [enemy.position.x,enemy.position.y+1.05*(enemy.userData.size||1),enemy.position.z];
  }) : step.lookAt;
  const turn = await page.evaluate(target => {const s = karvos.state; return Math.atan2(Math.sin(Math.atan2(-(target[0] - s.pos.x), -(target[2] - s.pos.z)) - s.yaw), Math.cos(Math.atan2(-(target[0] - s.pos.x), -(target[2] - s.pos.z)) - s.yaw)) / -(s.mouseSensitivity || .0025);}, target);
  // Re-center while unlocked, then use trusted mouse input to turn. Only the
  // pointer-lock browser API is stubbed; gameplay positions/progress stay native.
  await page.evaluate(() => document.exitPointerLock());
  const start = turn >= 0 ? 20 : 1260;
  await page.mouse.move(start, 340); await page.mouse.click(start, 340);
  await page.evaluate(()=>{if(!document.pointerLockElement)karvos.renderer.domElement.requestPointerLock();});
  await page.mouse.move(start + turn, 340, {steps: 12});
  if (step.lookAt==='creature') {
   const vertical=await page.evaluate(target=>{const s=karvos.state,pitch=-Math.atan2(target[1]-(s.pos.y+1.45),Math.hypot(target[0]-s.pos.x,target[2]-s.pos.z));return (pitch-s.pitch)/((s.mouseSensitivity||.0025)*.8);},target);
   await page.mouse.move(start+turn,340+vertical,{steps:12});
  }
 }
 if (step.down) await page.mouse.down({button: step.down});
 for (const key of step.keys || []) await page.keyboard.down(key);
 if (step.ms) await page.waitForTimeout(step.ms);
 for (const key of [...(step.keys || [])].reverse()) await page.keyboard.up(key);
 if (step.up) await page.mouse.up({button: step.up});
 if (step.photo) await page.screenshot({path: out + '/' + step.photo + '.png'});
 if (step.assertMounted && !await page.evaluate(() => karvos.state.mounted)) throw Error('Native bike mount failed');
 if (step.label) {report.actions.push({action: step.label, state: await snapshot()});await fs.writeFile(out+'/progress.json',JSON.stringify(report.actions,null,2));}
}
try {
 for (let index = 0; index < plan.length; index++) {
  const scenario = plan[index], segment = `${out}/segment-${index + 1}`;
  await fs.mkdir(segment, {recursive: true});
  const stored = JSON.parse(await fs.readFile(scenario.save, 'utf8'));
  const origin = stored.origins.find(item => item.localStorage.some(value => game !== 'karvos' || value.name === 'karvos.world.v1'));
  if (!origin) throw Error('Native fixture has no saved world');
  const storageState = {cookies: [], origins: [{origin: url.replace(/\/$/, ''), localStorage: game === 'karvos' ? origin.localStorage.filter(item => item.name === 'karvos.world.v1') : origin.localStorage}]};
  context = await browser.newContext({storageState, viewport: {width: 1280, height: 720}, reducedMotion: 'reduce', recordVideo: {dir: segment, size: {width: 1280, height: 720}}});
  await context.addInitScript(game => {
   let pointer;
   if (game === 'karvos') {
   Object.defineProperty(document, 'pointerLockElement', {configurable: true, get: () => pointer || null});
   Element.prototype.requestPointerLock = function () {pointer = this; document.dispatchEvent(new Event('pointerlockchange')); return Promise.resolve();};
   document.exitPointerLock = () => {pointer = null; document.dispatchEvent(new Event('pointerlockchange'));};
   } else {Element.prototype.requestPointerLock=()=>Promise.resolve();document.exitPointerLock=()=>{};}
   Element.prototype.requestFullscreen = () => Promise.resolve();
   window.__recordOutputs = [];
   const buses = new WeakMap(), connect = AudioNode.prototype.connect;
   AudioNode.prototype.connect = function (target, ...args) {
    if (target instanceof AudioDestinationNode) {let bus = buses.get(this.context); if (!bus) {bus = this.context.createMediaStreamDestination(); buses.set(this.context, bus); __recordOutputs.push(bus);} connect.call(this, bus);}
    return connect.call(this, target, ...args);
   };
  },game);
  page = await context.newPage(); page.setDefaultTimeout(180000);
  page.on('pageerror', error => report.errors.push(error.stack));
  page.on('response', response => {if (response.status() >= 400 && !response.url().endsWith('favicon.ico')) report.missing.push({url: response.url(), status: response.status()});});
  const born = Date.now(); console.log('NAVIGATE', game, scenario.name);
  await page.goto(url, {waitUntil: 'domcontentloaded'});
  if (game === 'karvos') {
   await page.waitForFunction(() => window.karvos?.ready, null, {timeout: 240000});
   await page.locator('#continueGame').click();
   await page.waitForFunction(() => karvos.state.started && karvos.state.mode === 'game');
   await page.evaluate(async () => {await karvos.fieldAudio.audio.ready();});
  } else {
   await page.locator('[data-continue]').click();
   await page.waitForFunction(() => window.__game?.ready && __game.sceneName !== 'title', null, {timeout: 240000});
   if (await page.locator('[data-galaxy-war]').isVisible()) await page.keyboard.press('Escape');
   await page.waitForFunction(() => !__game.snapshot().menuPaused);
  }
  await page.mouse.click(640, 360);
  await page.evaluate(async () => {for (const bus of __recordOutputs) await bus.context.resume();});
  await page.waitForTimeout(scenario.settle ?? 2500);
  if (game === 'unlit') await page.waitForFunction(() => {const physical = __game.audio().physical; return physical?.loaded === physical?.expected && physical?.failed === 0;}, null, {timeout: 60000});
  for (const step of scenario.prepare || []) await action(step);
  if (scenario.scene && game==='unlit' && await page.evaluate(()=>__game.snapshot().scene)!==scenario.scene) throw Error('Wrong native scene for '+scenario.name);
  const before = await snapshot(); if (before.audio?.audioPass !== pass) throw Error('Wrong physical audio pass');
  if (!report.before) report.before = before;
  await page.screenshot({path: segment + '/start.png'});
  await page.evaluate(() => {
   const bus = __recordOutputs.find(item => item.context.state === 'running'); if (!bus) throw Error('No post-master gameplay output');
   const chunks = [], recorder = new MediaRecorder(bus.stream, {mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000});
   recorder.ondataavailable = event => {if (event.data.size) chunks.push(event.data);}; window.__recording = {recorder, chunks}; recorder.start(500);
  });
  const offset = (Date.now() - born) / 1000, start = Date.now();
  for (const step of scenario.actions) await action(step);
  const elapsed = (Date.now() - start) / 1000, after = await snapshot(); report.after = after;
  const audio = await page.evaluate(() => new Promise(resolve => {const {recorder, chunks} = __recording; recorder.onstop = () => {const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(new Blob(chunks, {type: 'audio/webm'}));}; recorder.stop();}));
  await fs.writeFile(segment + '/audio.webm', Buffer.from(audio, 'base64'));
  const levels = await controls(); report.actions.push({action: scenario.name + ': real output mute/Music zero/restore', levels});
  const video = page.video(); await context.close(); context = null;
  const videoFile = await video.path();
  run(['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(offset), '-i', videoFile, '-i', segment + '/audio.webm', '-map', '0:v:0', '-map', '1:a:0', '-t', String(elapsed), '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'fast', '-threads', '2', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', segment + '/cut.mkv']);
  report.segments.push({name: scenario.name, save: scenario.save, offset, elapsed, before, after}); report.elapsed += elapsed;
  console.log('RECORDED', scenario.name, elapsed, JSON.stringify(game==='unlit'?{revision:after.audio.revision,audioPass:after.audio.audioPass,physical:after.audio.physical,health:after.snapshot.hero?.health}:after.audio));
 }
 if (report.errors.length || report.missing.length) throw Error('Gameplay capture had errors or missing assets');
 if ((!process.argv.includes('--segment') && report.elapsed < 30) || report.elapsed > 60) throw Error('Combined clip must be 30–60 seconds');
 const list = report.segments.map((_, i) => `file '${out}/segment-${i + 1}/cut.mkv'`).join('\n') + '\n';
 await fs.writeFile(out + '/concat.txt', list);
 run(['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', out + '/concat.txt', '-c', 'copy', out + '/combined.mkv']);
 run(['-hide_banner', '-loglevel', 'error', '-y', '-i', out + '/combined.mkv', '-vn', '-c:a', 'libopus', '-b:a', '192k', out + '/audio.webm']);
 await fs.writeFile(out + '/video-path.txt', out + '/combined.mkv');
} catch (error) {report.errors.push(error.stack); process.exitCode = 1; console.log('FAILED', error.stack); await page?.screenshot({path: out + '/failed.png', timeout: 20000}).catch(() => {});}
finally {await context?.close(); await fs.writeFile(out + '/report.json', JSON.stringify(report, null, 2)); const guard = setTimeout(() => process.exit(process.exitCode || 0), 15000); await browser.close(); clearTimeout(guard);}
