import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
const bundle=buildSync({stdin:{contents:"export {NarrationAudio} from './src/core/narrationAudio';export {EncounterAudio} from './src/core/encounterAudio';export {MotionAudio} from './src/core/motionAudio';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;
const {NarrationAudio,EncounterAudio,MotionAudio}=await import('data:text/javascript;base64,'+Buffer.from(bundle).toString('base64'));
const nodes=[],param=(value=0)=>({value,setTargetAtTime(v){this.value=v;}});
const node=extra=>{const n={outputs:[],connect(to){this.outputs.push(to);},disconnect(){this.disconnected=true;},...extra};nodes.push(n);return n;};
const ctx={sampleRate:24000,currentTime:0,state:'running',createGain:()=>node({gain:param()}),createBiquadFilter:()=>node({frequency:param(),Q:param()}),createStereoPanner:()=>node({pan:param()}),createBufferSource:()=>node({playbackRate:param(1),start(){},stop(){this.stopped=true;},onended:null}),createMediaElementSource:audio=>node({media:audio}),createBuffer(channels,length,rate){const data=Array.from({length:channels},()=>new Float32Array(length));return {duration:length/rate,getChannelData:i=>data[i]};}};
const master=node({gain:param(.7)}),voice=new NarrationAudio(ctx,master),clip={volume:.4};
const release=voice.attach(clip);assert.equal(clip.volume,1);assert.equal(voice.snapshot().voices,1);
const media=nodes.find(n=>n.media===clip),volume=media.outputs[0];assert.deepEqual(volume.outputs,[master]);assert.equal(volume.gain.value,.85);
master.gain.value=0;assert.equal(volume.outputs[0].gain.value,0,'existing narration sees live master mute');master.gain.value=.35;assert.equal(volume.outputs[0].gain.value,.35,'existing clip sees live master level');
const release2=voice.attach({volume:1});assert.equal(voice.snapshot().voices,1);assert.ok(media.disconnected&&volume.disconnected,'old chapter detached');release();release2();release2();assert.equal(voice.snapshot().voices,0,'skip/repeated cleanup idempotent');
const encounter=new EncounterAudio(ctx,node({}),node({})),hash=pcm=>pcm.reduce((sum,x,i)=>sum+x*(i%173),0),distinct=[];
for(const family of ['human','mech','creature'])for(const state of ['hurt','death','attack'])for(let take=0;take<4;take++){
 const pcm=encounter.reactionBuffer(family,state,take).getChannelData(0);let power=0;
 for(const x of pcm){assert.ok(Number.isFinite(x)&&Math.abs(x)<.9);power+=x*x;}assert.ok(power/pcm.length>.0002);assert.equal(pcm[0],0);assert.equal(pcm.at(-1),0);distinct.push(hash(pcm));
}
assert.equal(new Set(distinct).size,36,'independent family/state/take reaction identities');
let last;for(let i=0;i<8;i++){encounter.reaction('human','hurt');const take=encounter.snapshot().lastTakes['reaction:human:hurt'];assert.notEqual(take,last);last=take;}
while(encounter.snapshot().voices<10)encounter.call('insect','idle');const old=[...encounter.sources][0];encounter.reaction('mech','death');assert.equal(encounter.snapshot().voices,10);assert.ok(old.stopped&&old.disconnected,'death has a reserved replacement slot');
encounter.ui('confirm');assert.equal(encounter.snapshot().voices,10,'UI acknowledgement replaces rather than grows saturated voices');encounter.silence();assert.equal(encounter.snapshot().voices,0);
const music=node({}),motion=new MotionAudio(ctx,node({}),node({}),node({}),music);assert.equal(motion.snapshot().loops,7);
for(const loop of [motion.texture,motion.motif])assert.deepEqual(loop.pan.outputs,[music],'arrangement obeys music slider');
motion.update(false,0,false,'planet',false,true,'pale');const first=motion.texture.source.playbackRate.value;assert.ok(motion.motif.gain.gain.value>0);assert.equal(motion.snapshot().world,'pale');
ctx.currentTime=10;motion.update(false,0,false,'planet',false,true,'sirocco');assert.notEqual(motion.texture.source.playbackRate.value,first);assert.equal(motion.snapshot().phrase,1);
motion.combatBeat(1);motion.update(false,0,false,'dungeon',true,true);assert.equal(motion.motif.gain.gain.value,0,'exploration melody clears during combat');assert.ok(motion.texture.gain.gain.value>.2);
motion.update(false,0,false,'title',false,true);assert.equal(motion.texture.gain.gain.value+motion.motif.gain.gain.value,0,'menu owns its existing score');motion.silence();
console.log('PASS narration master/live mute/chapter cleanup,36 reaction variants/no-repeat/priority bounds and world/phrase/combat score arrangement');
