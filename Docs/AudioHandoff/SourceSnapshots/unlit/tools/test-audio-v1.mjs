import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
const bundle=buildSync({stdin:{contents:"export {MotionAudio} from './src/core/motionAudio';export {LocationMusic} from './src/core/locationMusic';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;
const {MotionAudio,LocationMusic}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
const param=(value=0)=>({value,setTargetAtTime(v){this.value=v;},setValueAtTime(v){this.value=v;},linearRampToValueAtTime(v){this.value=v;},cancelScheduledValues(){}});
const nodes=[];
const node=extra=>{const n={outputs:[],connect(to){this.outputs.push(to);},disconnect(){},...extra};nodes.push(n);return n;};
const ctx={sampleRate:24000,currentTime:0,state:'running',
 createGain:()=>node({gain:param()}),createBiquadFilter:()=>node({frequency:param(),Q:param()}),createStereoPanner:()=>node({pan:param()}),
 createBufferSource:()=>node({playbackRate:param(1),start(){},stop(){},onended:null}),
 createBuffer(channels,length,sampleRate){const data=new Float32Array(length);return {duration:length/sampleRate,getChannelData:()=>data};},
 createMediaElementSource:()=>node({}),
};
const buses=Array.from({length:4},()=>node({gain:param(1)}));
const motion=new MotionAudio(ctx,...buses);
assert.equal(motion.snapshot().loops,7);
for(const voice of [motion.wash,motion.cabin,motion.cutter,motion.grit,motion.rhythm,motion.texture,motion.motif]){
 const samples=voice.source.buffer.getChannelData(0);let peak=0,power=0;
 for(const x of samples){assert.ok(Number.isFinite(x));peak=Math.max(peak,Math.abs(x));power+=x*x;}
 assert.ok(peak<.9&&power/samples.length>1e-5,'finite audible headroom');
 assert.ok(Math.abs(samples[0]-samples.at(-1))<.06,'smooth loop splice');
}
assert.deepEqual(motion.rhythm.pan.outputs,[buses[3]],'adaptive rhythm passes through music slider');
assert.deepEqual(motion.cutter.pan.outputs,[buses[0]],'cutter machinery passes through engine slider');
assert.deepEqual(motion.grit.pan.outputs,[buses[2]],'cutting contacts pass through impact slider');
motion.update(true,.8,false,'space',false,true);motion.update(true,.8,true,'space',true,true);
assert.equal(motion.snapshot().starts,1);assert.equal(motion.snapshot().boosts,1);
assert.ok(motion.wash.gain.gain.value>0&&motion.cabin.gain.gain.value>0&&motion.rhythm.gain.gain.value>0);
motion.cut({pan:.7,distance:12});const near=motion.grit.gain.gain.value;
motion.cut({pan:-.7,distance:80});assert.ok(motion.grit.gain.gain.value<near);assert.equal(motion.grit.pan.pan.value,-.7);
ctx.currentTime=.3;motion.update(false,0,false,'planet',false,true);assert.equal(motion.cutter.gain.gain.value,0);assert.equal(motion.grit.gain.gain.value,0);
for(let i=0;i<20;i++)motion.fracture(true);assert.equal(motion.snapshot().transients,8,'debris voices bounded');
motion.update(true,1,true,'space',true,false);
for(const voice of [motion.wash,motion.cabin,motion.cutter,motion.grit,motion.rhythm,motion.texture,motion.motif])assert.equal(voice.gain.gain.value,0,'mute silences all motion loops');
for(const source of [...motion.transients])source.onended();assert.equal(motion.snapshot().transients,0,'transient cleanup');
globalThis.document={baseURI:'http://localhost/'};
const media=()=>({duration:120,currentTime:0,play:()=>Promise.resolve(),pause(){},load(){},removeAttribute(){}});
const score=new LocationMusic(ctx,buses[3],media),tick=async(t,combat)=>{ctx.currentTime=t;score.update('planet','bellweather',{},combat,true);await Promise.resolve();};
await tick(0,false);assert.equal(score.snapshot().track,'forest');
score.skip();await tick(.3,false);assert.equal(score.snapshot().streams,2,'exploration transition has two streams');
await tick(1,true);await tick(1.4,true);assert.equal(score.snapshot().track,'ground-combat','combat enters before 75-second exploration hold');
await tick(4,false);assert.equal(score.snapshot().track,'ground-combat','danger hold prevents music flapping');
await tick(6,false);await tick(14.1,false);assert.equal(score.snapshot().track,'forest','quiet exits combat after hold and hysteresis');
score.update('planet','bellweather',{},false,false);assert.equal(score.snapshot().streams,0,'music mute retires streams');
score.dispose();
console.log('PASS original motion loops, headroom/seams, mixer routes, spatial falloff, bounded cleanup and combat music hysteresis');
