import './browser-safety.cjs';
import {chromium} from 'playwright';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out='reports/stable-audio-3';mkdirSync(out,{recursive:true});
const ledger=JSON.parse(readFileSync(out+'/generated.json','utf8'));
assert.equal(ledger.length,80);assert.ok(ledger.every(s=>s.peak<.99&&s.rms>.002));
const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']}),p=await b.newPage({viewport:{width:1600,height:900}}),errors=[],failed=[];
p.on('pageerror',e=>errors.push(String(e)));p.on('response',r=>{if(r.url().includes('/audio/sa3/')&&!r.ok())failed.push(r.url())});
await p.addInitScript(()=>{const connect=AudioNode.prototype.connect;AudioNode.prototype.connect=function(target,...args){if(target instanceof AudioDestinationNode){window.recordBus??=this.context.createMediaStreamDestination();connect.call(this,recordBus)}return connect.call(this,target,...args)}});
try{
 await p.route('**/__sa3_lab__',route=>route.fulfill({contentType:'text/html',body:'<button id="start">Start</button><script type="module">import {gameAudio} from "/src/core/audio.ts";window.audioLab=gameAudio;audioLab.install();</script>'}));
 await p.goto('http://127.0.0.1:5200/__sa3_lab__');await p.waitForFunction(()=>window.audioLab);await p.click('#start');
 const result=await p.evaluate(async()=>{
  const a=window.audioLab,wait=ms=>new Promise(r=>setTimeout(r,ms));await a.ready();a.setSettings({master:.7,music:0,effects:.75,muted:false});
  const initial=a.snapshot(),checks=[],segments=[];const check=(name,pass)=>checks.push({name,pass});
  check('67 generated one-shots and all engine/beam loops decode',initial.recordedSamples===67&&initial.engineRecordings===4&&initial.beamRecording);
  const chunks=[],recorder=new MediaRecorder(recordBus.stream,{mimeType:'audio/webm;codecs=opus'});recorder.ondataavailable=e=>chunks.push(e.data);recorder.start();const start=performance.now();
  const segment=async(name,action,ms=850)=>{segments.push({name,start:(performance.now()-start)/1000});action();await wait(ms)};
  for(const archetype of ['Repeater','Wasp SMG','Beltfed LMG','Scattergun','Hand Cannon','Longshot','Recurve Bow'])await segment(archetype,()=>a.weapon({archetype},false));
  for(const id of ['wpn_pulse','wpn_rotary','wpn_plasma','wpn_lance'])await segment(id,()=>a.weapon({id},true));
  for(const phase of [0,2,3])await segment('reload '+phase,()=>a.reload({archetype:'Repeater'},phase),450);
  for(const kind of ['armor','shield','body','stone'])await segment('impact '+kind,()=>a.impact(kind),500);
  for(const id of ['missile','chest','read','enemy_hit','enemy_death','boss_death','explosion'])await segment(id,()=>a.cue(id),id==='boss_death'?2300:1100);
  const stopTick=window.setInterval(()=>a.update('space','verdant'),25);
  for(const id of ['eng_rebuilt','eng_azure','eng_vulcan']){
   segments.push({name:id,start:(performance.now()-start)/1000});const engineTick=setInterval(()=>a.setEngine([id],.75,false),50);await wait(1800);clearInterval(engineTick);
  }
  a.setEngine([],0,false);await wait(450);clearInterval(stopTick);
  for(let i=0;i<45;i++){a.weapon({id:'wpn_rotary'},true,{enemy:i%2===0});await wait(14)}
  check('Rapid fire remains bounded',a.snapshot().sampleVoices<=36);await wait(2000);check('One-shot voices clean up',a.snapshot().sampleVoices===0);
  a.setSettings({muted:true});a.weapon({archetype:'Repeater'},false);check('Muted fire creates no voice',a.snapshot().sampleVoices===0);
  recorder.stop();await new Promise(r=>recorder.onstop=r);const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let binary='';for(const v of bytes)binary+=String.fromCharCode(v);
  return {checks,segments,initial,final:a.snapshot(),audio:btoa(binary)};
 });
 writeFileSync(out+'/in-game-sfx-audition.webm',Buffer.from(result.audio,'base64'));delete result.audio;
 writeFileSync(out+'/runtime.json',JSON.stringify({...result,errors,failed},null,2));console.log(JSON.stringify({...result,segments:result.segments.length,errors,failed}));
 assert.ok(result.checks.every(c=>c.pass));assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 await p.goto('http://127.0.0.1:5200/?scene=space&fresh&seed=42&renderer-test=nebula');await p.waitForFunction(()=>window.__game?.ready,null,{timeout:90000});await p.evaluate(()=>__game.pause(true));
 if(await p.locator('[data-flight-close]').isVisible())await p.locator('[data-flight-close]').click();
 await p.evaluate(()=>{__game.cmd('teleport',30000,0,0);__game.cmd('lookAt',30000,0,1000);__game.cmd('throttle',.8);__game.cmd('cam','chase');__game.step(1/60,90)});
 await p.screenshot({path:out+'/nebula-restored.png'});
}finally{await b.close();}
