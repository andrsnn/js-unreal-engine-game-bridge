import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {buildSync} from 'esbuild';
const code=buildSync({stdin:{contents:"export {PhysicalAudio,PHYSICAL_V4_BANK} from './src/core/physicalAudio';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;
const {PhysicalAudio,PHYSICAL_V4_BANK}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const nodes=[],param=(value=0)=>({value,setTargetAtTime(v){this.value=v;},setValueAtTime(v){this.value=v;},cancelScheduledValues(){}}),node=extra=>{const n={outputs:[],connect(to){this.outputs.push(to);},disconnect(){this.disconnected=true;},...extra};nodes.push(n);return n;};
const ctx={sampleRate:24000,currentTime:1,state:'running',createGain:()=>node({gain:param(1)}),createBiquadFilter:()=>node({frequency:param(),Q:param()}),createStereoPanner:()=>node({pan:param()}),createBufferSource:()=>node({playbackRate:param(1),start(t=0){this.started=t;},stop(){this.stopped=true;},onended:null}),createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/rate,getChannelData:i=>data[i]};},decodeAudioData:async()=>({duration:2,getChannelData:()=>new Float32Array(48000).fill(.2)})};
globalThis.document={baseURI:'http://localhost/'};const requested=[];globalThis.fetch=async url=>{requested.push(String(url));return {ok:true,arrayBuffer:async()=>new ArrayBuffer(4)};};
const buses=[node({gain:param(1)}),node({gain:param(1)}),node({gain:param(1)})],physical=new PhysicalAudio(ctx,...buses),oldSources=[...physical.loops.values()].map(l=>l.source);
await physical.load();await physical.load();assert.equal(requested.length,25,'one bounded recording load');assert.equal(physical.snapshot().loaded,25);assert.equal(physical.snapshot().failed,0);
assert.ok(oldSources.every(s=>s.stopped&&s.disconnected),'fallback loops replaced without resident leaks');assert.equal(physical.snapshot().loops,4);
assert.deepEqual(physical.loops.get('cutter-contact').pan.outputs,[buses[1]]);assert.deepEqual(physical.loops.get('drive-core').pan.outputs,[buses[0]]);
physical.update(true,.2,false,'space',false,true);const idle=physical.snapshot().levels['drive-core'];ctx.currentTime=2;physical.update(true,1,true,'space',false,true);
assert.ok(physical.snapshot().levels['drive-core']>idle);assert.ok(physical.snapshot().levels['drive-pressure']>.45,'boost opens pressure');assert.equal(physical.snapshot().events.ignite,1);assert.equal(physical.snapshot().events.boost,1);
physical.cut({resistance:.55,pan:.6,distance:2});const soft=physical.snapshot().levels['cutter-contact'],fast=physical.loops.get('cutter-rotor').source.playbackRate.value;
physical.cut({resistance:2.2,pan:-.6,distance:2});assert.ok(physical.snapshot().levels['cutter-contact']>soft);assert.ok(physical.loops.get('cutter-rotor').source.playbackRate.value<fast,'hard rock loads down motor');assert.equal(physical.loops.get('cutter-contact').pan.pan.value,-.6);
ctx.currentTime=2.3;physical.update(false,0,false,'dungeon',false,true);assert.equal(physical.snapshot().levels['cutter-contact'],0,'release expires contact');assert.equal(physical.snapshot().events['cutter:stop'],1);
let last;for(let i=0;i<8;i++){ctx.currentTime+=.1;physical.weapon('rifle');const take=physical.snapshot().lastTakes.gun;assert.notEqual(take,last);last=take;}
ctx.currentTime+=1;physical.weapon('rifle',{enemy:true,distance:3,pan:.4});const close=[...physical.voices.keys()].at(-1),near=close.outputs[0].outputs[0].gain.value;
ctx.currentTime+=1;physical.weapon('rifle',{enemy:true,distance:100});const far=[...physical.voices.keys()].at(-1);assert.ok(far.outputs[0].outputs[0].gain.value<near/5);assert.ok(far.started>ctx.currentTime,'ground propagation tail starts later');
for(let i=0;i<35;i++){ctx.currentTime+=.2;physical.fracture(true);}assert.equal(physical.snapshot().voices,20,'hard transient ceiling');
physical.update(false,0,false,'pause',false,true);assert.equal(physical.snapshot().voices,0);assert.ok(Object.values(physical.snapshot().levels).every(v=>v===0),'pause retires physical audio');
physical.update(true,1,true,'space',false,false);physical.cut({resistance:2});physical.blast();assert.equal(physical.snapshot().voices,0);assert.ok(Object.values(physical.snapshot().levels).every(v=>v===0),'mute blocks direct requests too');
physical.update(true,1,true,'space',false,true);physical.silence();assert.equal(physical.snapshot().voices,0,'hidden-tab cleanup');
const edits=JSON.parse(fs.readFileSync('public/audio/physical-v4/edits.json','utf8'));assert.equal(edits.edits.length,25);
for(const entry of edits.edits){assert.ok(entry.peak<.96&&entry.rms>.045,'audible encoded asset headroom');assert.equal(crypto.createHash('sha256').update(fs.readFileSync('public/audio/physical-v4/'+entry.output)).digest('hex'),entry.sha256);}
for(const key of Object.values(PHYSICAL_V4_BANK).flat())assert.ok(edits.edits.some(e=>e.id===key),'all runtime paths are shipped');
console.log('PASS 25 encoded assets/hash/headroom, four resident loops, throttle/boost, hardness/contact release, nonrepeat, distance, priority ceiling, pause/mute/hidden cleanup');
