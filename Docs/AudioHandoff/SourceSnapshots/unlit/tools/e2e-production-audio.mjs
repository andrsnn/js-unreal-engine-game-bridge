import './browser-safety.cjs';
import {buildSync} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('public');
const bundle=buildSync({stdin:{contents:"import {gameAudio} from './src/core/audio';window.audio=gameAudio;",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'}).outputFiles[0].text;
const server=createServer((req,res)=>{
 if(req.url==='/favicon.ico'){res.statusCode=204;res.end();return;}
 if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<button>Start</button><script src="/audio-test.js"></script>');return;}
 if(req.url==='/audio-test.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
 const file=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+sep)||!existsSync(file)){res.statusCode=404;res.end();return;}
 res.setHeader('Content-Type','audio/ogg');res.end(readFileSync(file));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({args:['--disable-gpu','--autoplay-policy=no-user-gesture-required']});
try{
 const page=await browser.newPage(),errors=[],missing=[];page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)missing.push(r.url())});
 await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.click('button');
 const loaded=await page.evaluate(async()=>{await audio.ready();audio.setSettings({master:.7,music:.32,effects:.75,muted:false});return {recordings:[...audio.recordings].map(([id,clips])=>({id,count:clips.length,frames:clips.map(b=>b.length)})),engines:audio.engineLayers.size,beam:!!audio.beamBuffer,charge:!!audio.chargeBuffer};});
 assert.equal(loaded.engines,4);assert.ok(loaded.beam&&loaded.charge);assert.ok(loaded.recordings.every(r=>r.frames.every(n=>n>0)));
 const rows=[];
 for(const [scene,body,env,expected]of [['space','verdant',{},'space'],['dungeon','verdant',{location:'cairn'},'vault'],['dungeon','verdant',{combat:true},'ground-combat'],['space','verdant',{combat:true},'space-combat'],['planet','sirocco',{},'dunes']]){
  await page.evaluate(([scene,body,env])=>{audio.dangerUntil=0;audio.locationMusic.combatUntil=0;audio.setEnvironment(scene,env);audio.update(scene,body);},[scene,body,env]);
  await page.waitForFunction(id=>audio.snapshot().score.track===id,expected,{timeout:20000});
  const row=await page.evaluate(()=>{const a=audio.ctx.createAnalyser();audio.music.connect(a);return new Promise(r=>setTimeout(()=>{const s=new Float32Array(a.fftSize);a.getFloatTimeDomainData(s);audio.music.disconnect(a);r({score:audio.snapshot().score,peak:Math.max(...s.map(Math.abs)),url:audio.locationMusic.current.audio.src,time:audio.locationMusic.current.audio.currentTime})},1600));});
  assert.ok(row.peak>0,expected);assert.ok(row.url.includes('/audio/suno-20260912/'));assert.ok(row.time>0);assert.ok(row.score.streams<=2);rows.push(row);
 }
 const effects=await page.evaluate(async()=>{
  const analyser=audio.ctx.createAnalyser();audio.fx.connect(analyser);let peak=0;
  for(const kind of ['rifle','missile','enemyHurt','bossDeath','chest','level','bolt','step']){audio.play(kind,.4);await new Promise(r=>setTimeout(r,30));const a=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(a);peak=Math.max(peak,...a.map(Math.abs));}
  audio.fx.disconnect(analyser);audio.setSettings({muted:true});await new Promise(r=>setTimeout(r,60));return {peak,muted:audio.snapshot().score.streams};
 });assert.ok(effects.peak>0);assert.equal(effects.muted,0);assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
 writeFileSync('reports/context-audio/production-runtime.json',JSON.stringify({loaded,rows,effects,errors,missing,limits:'Actual browser decoding and WebAudio signals, not subjective listening or physical handheld measurement.'},null,2));
 console.log('PASS actual WebAudio decode, equipment clips, five streamed contexts, crossfades, mute and no missing requests');
}finally{await browser.close();await new Promise(r=>server.close(r));}
