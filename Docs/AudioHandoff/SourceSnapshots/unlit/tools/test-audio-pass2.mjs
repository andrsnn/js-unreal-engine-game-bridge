import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
const text=buildSync({stdin:{contents:"export {AcousticSpace} from './src/core/acousticSpace';export {EncounterAudio} from './src/core/encounterAudio';export {MotionAudio} from './src/core/motionAudio';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;
const {AcousticSpace,EncounterAudio,MotionAudio}=await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const nodes=[],p=(value=0)=>({value,setTargetAtTime(v){this.value=v;}});
const n=extra=>{const o={outputs:[],connect(to){this.outputs.push(to);},disconnect(){this.disconnected=true;},...extra};nodes.push(o);return o;};
const ctx={sampleRate:24000,currentTime:0,state:'running',createGain:()=>n({gain:p()}),createBiquadFilter:()=>n({frequency:p(),Q:p()}),createStereoPanner:()=>n({pan:p()}),createConvolver:()=>n({convolver:true}),createBufferSource:()=>n({playbackRate:p(1),start(){},stop(){this.stopped=true;},onended:null}),createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/rate,numberOfChannels:channels,getChannelData:i=>data[i]};}};
const fx=n({}),impact=n({}),ui=n({}),space=new AcousticSpace(ctx,fx);
assert.equal(nodes.filter(x=>x.convolver).length,2);
for(const conv of nodes.filter(x=>x.convolver)){
 const a=conv.buffer.getChannelData(0),b=conv.buffer.getChannelData(1);assert.notDeepEqual(a,b,'stereo reflections decorrelated');
 let first=0,last=0;for(let i=0;i<a.length;i++){assert.ok(Number.isFinite(a[i])&&Math.abs(a[i])<.4);if(i<a.length/3)first+=a[i]**2;if(i>a.length*2/3)last+=a[i]**2;}
 assert.ok(first>last*20,'reflection decays');assert.equal(a.at(-1),0);
}
space.update('dungeon');assert.ok(space.snapshot().cave>.2);assert.equal(space.snapshot().field,0);
space.update('planet');assert.equal(space.snapshot().cave,0);assert.ok(space.snapshot().field>0);
space.update('space');assert.equal(space.snapshot().cave+space.snapshot().field,0,'space is dry');
space.update('dungeon',true);assert.equal(space.filter.frequency.value,1050);
space.update('dungeon',false,false);assert.equal(space.snapshot().cave,0,'muted return quiet');
assert.deepEqual(space.cave.outputs,[fx]);assert.deepEqual(space.field.outputs,[fx]);
const encounter=new EncounterAudio(ctx,impact,ui),hash=data=>data.reduce((s,v,i)=>s+v*(i%719),0);
const hashes=[];
for(const family of ['beast','heavy','insect','sentinel'])for(let take=0;take<4;take++){
 const samples=encounter.voice(family,'combat',take).getChannelData(0);let power=0;
 for(const x of samples){assert.ok(Number.isFinite(x)&&Math.abs(x)<.85);power+=x*x;}
 assert.ok(power/samples.length>.0003);assert.ok(Math.abs(samples.at(-1))<1e-5);hashes.push(hash(samples));
}
assert.equal(new Set(hashes).size,16,'unique family and take waveforms');
let previous;for(let i=0;i<8;i++){encounter.call('beast','attack',{distance:8,pan:.6});const take=encounter.snapshot().lastTakes.beastattack;assert.notEqual(take,previous,'no consecutive take repeats');previous=take;}
for(let i=0;i<20;i++)encounter.call('insect','idle');assert.equal(encounter.snapshot().voices,10,'bounded voices');
for(const source of [...encounter.sources])source.onended();assert.equal(encounter.snapshot().voices,0);assert.ok(nodes.filter(x=>x.buffer&&x.playbackRate).every(x=>x.disconnected),'source cleanup');
encounter.ui('focus');encounter.ui('focus');const clicks=nodes.filter(x=>x.buffer&&x.playbackRate&&!x.disconnected);assert.notEqual(clicks[0].playbackRate.value,clicks[1].playbackRate.value);
const near=nodes.filter(x=>x.gain&&x.gain.value>0).at(-1).gain.value;
for(const source of [...encounter.sources])source.onended();
encounter.call('heavy','attack',{distance:80});assert.ok(nodes.filter(x=>x.gain&&x.gain.value>0).at(-1).gain.value<near,'distant voice attenuates');
const motion=new MotionAudio(ctx,n({}),n({}),n({}),n({}));motion.update(false,0,false,'dungeon',true,true);const quiet=motion.rhythm.gain.gain.value;
motion.combatBeat(1);motion.update(false,0,false,'dungeon',true,true);assert.ok(motion.rhythm.gain.gain.value>quiet*1.7,'heavy events increase combat score pressure');
ctx.currentTime=20;motion.update(false,0,false,'dungeon',true,true);assert.ok(motion.rhythm.gain.gain.value<quiet*1.15,'pressure recovers despite phrase variation');
encounter.silence();assert.equal(encounter.snapshot().voices,0,'hidden-tab encounter voices stop');
motion.fracture(true);motion.silence();assert.equal(motion.snapshot().transients,0,'hidden-tab debris stops');assert.equal(motion.rhythm.gain.gain.value,0);
console.log('PASS stereo impulse decay, scene/underwater/mute acoustics,16 distinct creature voices, anti-repeat calls/UI, distance/cleanup bounds and combat pressure');
