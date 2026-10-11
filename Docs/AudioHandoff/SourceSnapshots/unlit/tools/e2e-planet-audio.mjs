import './browser-safety.cjs';
import {chromium} from 'playwright';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const out='reports/stable-audio-3',ledger=JSON.parse(readFileSync(out+'/generated.json','utf8'));
assert.equal(ledger.length,80);assert.ok(ledger.every(s=>s.peak<.99&&s.rms>.002));
const browser=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']}),errors=[],checks=[];
try{
 const p=await browser.newPage();p.on('pageerror',e=>errors.push(String(e)));
 p.on('response',r=>{if(r.url().includes('/audio/sa3/')&&!r.ok())errors.push('Asset HTTP '+r.status()+': '+r.url())});
 await p.addInitScript(()=>{const original=AudioNode.prototype.connect;AudioNode.prototype.connect=function(target,...args){if(target instanceof AudioDestinationNode){window.recordBus??=this.context.createMediaStreamDestination();original.call(this,recordBus)}return original.call(this,target,...args)}});
 await p.route('**/__planet_audio__',r=>r.fulfill({contentType:'text/html',body:'<button>Start</button><script type="module">import {gameAudio} from "/src/core/audio.ts";window.a=gameAudio;a.install();</script>'}));
 await p.goto('http://127.0.0.1:5200/__planet_audio__');await p.waitForFunction(()=>window.a);await p.click('button');
 const result=await p.evaluate(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),a=window.a,checks=[],segments=[];await a.ready();a.setSettings({music:0,muted:false});
  const initial=a.snapshot();checks.push({name:'67 generated one-shots and eight ambience beds decode',pass:initial.recordedSamples===67&&initial.ambience.recordings===8});
  const chunks=[],rec=new MediaRecorder(recordBus.stream,{mimeType:'audio/webm;codecs=opus'});rec.ondataavailable=e=>chunks.push(e.data);rec.start();const start=performance.now();
  for(const [scene,body,environment,expected] of [
   ['planet','verdant',{},'forest'],['planet','sirocco',{},'dunes'],['planet','pale',{},'ice'],['planet','cindral',{},'volcanic'],
   ['planet','pelagia',{},'ocean'],['planet','pelagia',{underwater:true},'underwater'],['dungeon','verdant',{},'dungeon'],['planet','bellweather',{dark:true},'dark'],
  ]){
   a.setEnvironment(scene,environment);a.update(scene,body);segments.push({name:expected,start:(performance.now()-start)/1000});await wait(2200);
   checks.push({name:expected+' selects one steady ambience voice',pass:a.snapshot().ambience.selected===expected&&a.snapshot().ambience.voices===1});
  }
  a.setEnvironment('planet',{dark:false});a.update('planet','bellweather');await wait(60);
  checks.push({name:'Restored dark world returns to living ambience',pass:a.snapshot().ambience.selected==='forest'});
  for(let i=0;i<12;i++){a.setEnvironment('planet',{underwater:i%2===0});a.update('planet','pelagia');await wait(45);checks.push({name:'Rapid shoreline transition '+i,pass:a.snapshot().ambience.voices<=2});}
  a.setSettings({muted:true});await wait(1950);checks.push({name:'Mute retires ambience sources',pass:a.snapshot().ambience.voices===0});
  a.setSettings({muted:false});await wait(70);checks.push({name:'Unmute resumes selected environment',pass:a.snapshot().ambience.selected==='ocean'});
  a.update('space','pelagia');await wait(1950);checks.push({name:'No planet ambience leaks into space',pass:a.snapshot().ambience.voices===0});
  for(const surface of ['soil','sand','stone','snow','water']){
   segments.push({name:'movement '+surface,start:(performance.now()-start)/1000});
   a.footsteps('planet',0,0,false,false,surface);
   for(let x=1;x<=6;x++){a.footsteps('planet',x,0,true,false,surface);await wait(180)}
  }
  const events=a.snapshot().events;checks.push({name:'All five movement surfaces use generated families',pass:['step','stepSand','stepStone','stepSnow','swim'].every(k=>events['movement:'+k]>0)});
  const before=events.footstep;a.footsteps('planet',1000,0,true,false,'soil');checks.push({name:'Teleport creates no footstep',pass:a.snapshot().events.footstep===before});
  for(const cue of ['swing','dive','worm','spit','refit','chest','read']){segments.push({name:cue,start:(performance.now()-start)/1000});a.cue(cue);await wait(cue==='worm'?1600:900)}
  rec.stop();await new Promise(r=>rec.onstop=r);const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let binary='';for(const v of bytes)binary+=String.fromCharCode(v);
  return {checks,segments,audio:btoa(binary),snapshot:a.snapshot()};
 });
 writeFileSync(out+'/planet-sfx-audition.webm',Buffer.from(result.audio,'base64'));delete result.audio;checks.push(...result.checks);
 for(const scene of ['planet','dungeon']){
  await p.goto('http://127.0.0.1:5200/?scene='+scene+'&body=verdant&fresh&renderer-test=audio');await p.waitForFunction(()=>__game?.ready&&__game.sceneName!=='title',null,{timeout:90000});
  await p.evaluate(async()=>{await (await import('/src/core/audio.ts')).gameAudio.ready();__game.step(1/60,2)});await p.waitForTimeout(150);
  const expected=scene==='planet'?'forest':'dungeon',selected=await p.evaluate(()=>__game.audio().ambience.selected);
  checks.push({name:'Actual '+scene+' scene supplies sound environment',pass:selected===expected});
  if(scene==='planet'){
   await p.evaluate(()=>{__game.cmd('goto','meadow');__game.step(1/60,2)});await p.keyboard.down('w');await p.evaluate(()=>__game.step(1/60,180));await p.keyboard.up('w');
   const steps=await p.evaluate(()=>__game.audio().events['movement:step']??0);checks.push({name:'Native planet walking triggers generated steps',pass:steps>0});
  }
 }
 writeFileSync(out+'/planet-runtime.json',JSON.stringify({...result,checks,errors},null,2));console.log(JSON.stringify({checks,errors}));assert.ok(checks.every(c=>c.pass));assert.deepEqual(errors,[]);
}finally{await browser.close()}
