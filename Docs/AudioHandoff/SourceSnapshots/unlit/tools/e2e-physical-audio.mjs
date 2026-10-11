import './browser-safety.cjs';
import {buildSync} from 'esbuild';
import {chromium} from 'playwright';
import {createServer} from 'node:http';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,sep} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('public'),bundle=buildSync({stdin:{contents:"import {gameAudio} from './src/core/audio';window.audio=gameAudio;",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife'}).outputFiles[0].text;
const server=createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end('<button>Start</button><script src="/test.js"></script>');return;}if(req.url==='/test.js'){res.end(bundle);return;}if(req.url==='/favicon.ico'){res.statusCode=204;res.end();return;}const file=resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+sep)||!existsSync(file)){res.statusCode=404;res.end();return;}res.setHeader('Content-Type','audio/ogg');res.end(readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({args:['--disable-gpu','--autoplay-policy=no-user-gesture-required']});
try{
 const page=await browser.newPage(),errors=[],missing=[],physical=[];
 page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)missing.push(r.url());if(r.url().includes('/physical-v1/'))physical.push(r.url());});
 await page.goto(`http://127.0.0.1:${server.address().port}`);await page.click('button');
 const result=await page.evaluate(async()=>{
  await audio.ready();audio.setSettings({master:.7,music:0,effects:.75,muted:false});
  // No game renderer: isolate audio cost. Capture the actual combat/master mix.
  const c=audio.ctx,processor=c.createScriptProcessor(2048,2,2),silent=c.createGain();silent.gain.value=0;audio.master.connect(processor);processor.connect(silent);silent.connect(c.destination);
  const chunks=[[],[]];let peak=0,maxVoices=0;
  processor.onaudioprocess=e=>{for(let channel=0;channel<2;channel++){const a=e.inputBuffer.getChannelData(channel);chunks[channel].push(Array.from(a));for(const x of a)peak=Math.max(peak,Math.abs(x));}maxVoices=Math.max(maxVoices,audio.sources.size);};
  const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(150);
  // Interleaving impacts used to advance the global counter and repeat one rifle take.
  const turns=[];for(let i=0;i<4;i++){audio.weapon({archetype:'rifle'},false);turns.push(audio.recordingTurns.get('rifle'));audio.impact('armor',{distance:15});await wait(100);}
  // Exercise each material/death family through the public API. These are
  // layered voices, so the event ledger proves routing without depending on a
  // particular encoded clip duration or browser scheduling quantum.
  audio.impact('body',{distance:12});await wait(150);
  audio.enemyReaction('death',{frame:'void'},false,{distance:18});await wait(150);
  audio.enemyReaction('death',{frame:'mech'},false,{distance:18});await wait(150);
  audio.enemyReaction('death',{frame:'human'},false,{distance:18});await wait(900);
  const chapters=[];for(const [archetype,space,shots,interval]of [['rifle',false,4,180],['smg',false,9,80],['shotgun',false,2,900],['pulse',true,4,220],['rotary',true,12,70],['rail',true,2,1200],['plasma',true,2,850]]){
   chapters.push({weapon:archetype,at:c.currentTime});for(let i=0;i<shots;i++){audio.weapon({archetype},space);await wait(interval);}await wait(650);
  }
  audio.reload({archetype:'rifle'},0);await wait(450);audio.reload({archetype:'rifle'},2);await wait(500);audio.reload({archetype:'rifle'},3);await wait(900);
  audio.cue('missile');await wait(1200);audio.cue('explosion',{distance:40});await wait(2400);
  // Same-family enemy fire must not suppress the player shot in the same frame.
  const before=audio.sources.size;audio.weapon({archetype:'rifle'},false,{enemy:true,distance:70,pan:.7});audio.weapon({archetype:'rifle'},false);const simultaneous=audio.sources.size-before;
  for(let i=0;i<45;i++){audio.weapon({archetype:'lmg'},false);audio.weapon({archetype:'rifle'},false,{enemy:true,distance:80,pan:-.7});audio.impact('armor',{enemy:true,distance:50});if(i%6===0)audio.cue('explosion',{distance:150});await wait(45);}
  await wait(2600);const drained=audio.sources.size;
  processor.onaudioprocess=null;audio.master.disconnect(processor);processor.disconnect();silent.disconnect();audio.setSettings({muted:true});
  return {peak,maxVoices,simultaneous,drained,turns,chapters,snapshot:audio.snapshot(),rate:c.sampleRate,pcm:chunks.map(a=>a.flat())};
 });
 assert.equal(new Set(physical).size,67);assert.deepEqual(result.turns,[1,2,3,0]);
 assert.ok(result.simultaneous>=6&&result.simultaneous<=8,'player/enemy pair should produce bounded report layers');
 assert.equal(result.drained,0);assert.ok(result.maxVoices<=36);assert.ok(result.peak>0&&result.peak<1,'pre-limiter combat mix must retain headroom');
 for(const kind of ['gunCrack','gunTail','gunMechanism','fleshImpact','metalImpact','fleshDeath','metalDeath'])assert.ok(result.snapshot.events['played:'+kind]>0,'missing combat layer '+kind);
 for(const family of ['creature','mech','human'])assert.equal(result.snapshot.events['reaction:'+family+':death'],1,'wrong death routing '+family);
 assert.deepEqual(errors,[]);assert.deepEqual(missing,[]);
 const frames=result.pcm[0].length,wav=Buffer.alloc(44+frames*4);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(2,22);wav.writeUInt32LE(result.rate,24);wav.writeUInt32LE(result.rate*4,28);wav.writeUInt16LE(4,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*4,40);
 for(let i=0;i<frames;i++)for(let ch=0;ch<2;ch++)wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,result.pcm[ch][i]))*32767),44+i*4+ch*2);
 writeFileSync('reports/physical-audio/combat-audition.wav',wav);delete result.pcm;
 writeFileSync('reports/physical-audio/runtime.json',JSON.stringify({...result,loadedPhysicalClips:new Set(physical).size,errors,missing,limits:'Actual browser audio routing and rapid-fire mix; no subjective listening claim or physical handheld benchmark.'},null,2));
 console.log('PASS real WebAudio rapid fire, independent variants, player/enemy mixing, voice cleanup and pre-limiter headroom',{peak:result.peak,maxVoices:result.maxVoices});
}finally{await browser.close();await new Promise(r=>server.close(r));}
