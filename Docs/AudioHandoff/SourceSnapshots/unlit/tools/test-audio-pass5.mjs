import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
const code=buildSync({stdin:{contents:"export {PhysicalAudio} from './src/core/physicalAudio';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'}).outputFiles[0].text;
const {PhysicalAudio}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
let clock=1;
// Evaluate exponential AudioParam automation, including cancelled future stops.
const param=(initial=0)=>{
 let events=[];
 const at=t=>{let value=initial,last=0,target=null,tau=1;const evolve=end=>{if(target!==null)value=target+(value-target)*Math.exp(-(end-last)/tau);last=end;};
  for(const e of events){if(e.time>t)break;evolve(e.time);if(e.kind==='value'){value=e.value;target=null;}else{target=e.value;tau=e.tau;}}evolve(t);return value;};
 const add=e=>{events.push(e);events.sort((a,b)=>a.time-b.time);};
 return {get value(){return at(clock);},set value(v){initial=v;events=[];},setValueAtTime(value,time){add({kind:'value',value,time});},setTargetAtTime(value,time,tau){add({kind:'target',value,time,tau});},cancelScheduledValues(time){events=events.filter(e=>e.time<time);},future:()=>events.filter(e=>e.time>clock)};
};
const sources=[],node=extra=>({outputs:[],connect(to){this.outputs.push(to);},disconnect(){this.disconnected=true;},...extra});
const ctx={sampleRate:24000,get currentTime(){return clock;},state:'running',createGain:()=>node({gain:param(1)}),createBiquadFilter:()=>node({frequency:param(),Q:param()}),createStereoPanner:()=>node({pan:param()}),createBufferSource(){const s=node({playbackRate:param(1),start(){},stop(){},onended:null});sources.push(s);return s;},createBuffer(channels,length,rate){const pcm=new Float32Array(length);return {duration:length/rate,getChannelData:()=>pcm};}};
const physical=new PhysicalAudio(ctx,node({}),node({}),node({}));
const rotor=physical.loops.get('cutter-rotor'),contact=physical.loops.get('cutter-contact');
physical.update(false,0,false,'dungeon',false,true);
physical.cut({resistance:2.2});clock=1.15;physical.cut({resistance:2.2});
clock=1.34;const running=rotor.gain.gain.value,pitch=rotor.source.playbackRate.value;
physical.update(false,0,false,'dungeon',false,true);
assert.ok(Math.abs(rotor.gain.gain.value-running)<1e-9,'release preserves current motor amplitude');
assert.ok(physical.snapshot().cutterTailActive);
clock=1.4;assert.ok(contact.gain.gain.value<.13,'grit clears quickly');assert.ok(rotor.gain.gain.value>.3,'motor retains audible momentum');assert.ok(rotor.source.playbackRate.value<pitch,'released motor decelerates');
clock=1.55;physical.cut({resistance:1});assert.equal(physical.snapshot().cutterTailActive,false);assert.equal(rotor.gain.gain.future().length,0,'recut cancels old scheduled zero');
for(let n=0;n<7;n++){clock+=.1;physical.cut({resistance:1});physical.update(false,0,false,'dungeon',false,true);}
assert.ok(rotor.gain.gain.value>.44,'old release cannot truncate new contact');assert.equal(physical.snapshot().events['cutter:stop'],1);
clock+=.2;physical.update(false,0,false,'dungeon',false,true);const released=clock;
clock=released+.51;physical.update(false,0,false,'dungeon',false,true);assert.equal(rotor.gain.gain.value,0,'bounded motor tail reaches exact zero');assert.equal(physical.snapshot().cutterTailActive,false);assert.equal(physical.snapshot().events['cutter:stop'],2,'release is scheduled once');
clock+=.1;physical.cut();clock+=.2;physical.update(false,0,false,'dungeon',false,true);clock+=.04;physical.silence();
assert.ok(Object.values(physical.snapshot().levels).every(v=>v===0));assert.equal(rotor.gain.gain.future().length,0,'hidden cleanup cancels future tail automation');
clock+=.2;physical.cut();clock+=.2;physical.update(false,0,false,'dungeon',false,true);physical.update(false,0,false,'pause',false,true);clock+=.7;
assert.ok(Object.values(physical.snapshot().levels).every(v=>v===0),'pause immediately removes wind-down');
physical.update(false,0,false,'dungeon',false,false);physical.cut();clock+=.7;assert.ok(Object.values(physical.snapshot().levels).every(v=>v===0),'mute blocks motor restart');
assert.equal(sources.length,4,'release and restart reuse four resident sources');assert.equal(physical.snapshot().voices,0);
console.log('PASS cutter momentum/contact separation, continuous release, pitch deceleration, cancellation on recut, finite tail, immediate pause/mute/hidden, four-source bound');
