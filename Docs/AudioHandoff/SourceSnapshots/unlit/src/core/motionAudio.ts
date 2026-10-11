import type {SoundPosition} from './audio';

type Loop={source:AudioBufferSourceNode;gain:GainNode;filter:BiquadFilterNode;pan:StereoPannerNode};
/** Original procedural machinery and score layers. Seven resident loops, at most eight transients. */
export class MotionAudio {
 private wash:Loop;private cabin:Loop;private cutter:Loop;private grit:Loop;private rhythm:Loop;
 private texture:Loop;private motif:Loop;private phrase=0;private world='';
 private cutterUntil=-1;private engaged=false;private boosting=false;private engineLevel=0;
 private transients=new Set<AudioBufferSourceNode>();private cuts=0;private starts=0;private boosts=0;
 private combatWeight=0;private combatAt=-100;
 constructor(private ctx:AudioContext,private engines:GainNode,private ambience:GainNode,private impacts:GainNode,private music:GainNode){
  this.wash=this.loop('wash',engines,4);this.cabin=this.loop('cabin',ambience,8);
  this.cutter=this.loop('cutter',engines,2);this.grit=this.loop('grit',impacts,2);
  this.rhythm=this.loop('rhythm',music,9.6);
  this.texture=this.loop('texture',music,8);this.motif=this.loop('motif',music,32);
 }
 private buffer(kind:string,seconds:number){
  const c=this.ctx,rate=c.sampleRate,len=Math.round(rate*seconds),fade=Math.round(rate*.08),buffer=c.createBuffer(1,len,rate),out=new Float32Array(len+fade);
  let seed=1709+kind.length*971,low=0,slow=0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
  for(let i=0;i<out.length;i++){
   const t=i/rate,n=random();low+=.085*(n-low);slow+=.006*(n-slow);
   if(kind==='wash')out[i]=(low-slow)*(.7+.3*Math.sin(Math.PI*2*t/seconds)**2);
   else if(kind==='cabin')out[i]=slow*.55+Math.sin(Math.PI*2*48*t)*.025+Math.sin(Math.PI*2*96*t)*.011;
   else if(kind==='cutter')out[i]=Math.sin(Math.PI*2*176*t)*.19+Math.sin(Math.PI*2*352*t)*.06+(low-slow)*.3;
   else if(kind==='grit')out[i]=(n-low)*.08*(.6+.4*Math.sin(Math.PI*2*23*t)**8)+slow*.5;
   else if(kind==='texture')out[i]=(Math.sin(2*Math.PI*55*t)*.15+Math.sin(2*Math.PI*82.5*t)*.09+Math.sin(2*Math.PI*110*t)*.055)*(.5+.5*Math.sin(Math.PI*2*t/8)**2);
   else if(kind==='motif'){
    const note=Math.floor(t/4)%8,d=t%4,freq=220*2**([0,7,10,14,12,7,5,2][note]/12);
    const envelope=Math.min(1,d/.12)*Math.exp(-d/1.2)*Math.min(1,(4-d)/.18);
    out[i]=(Math.sin(2*Math.PI*freq*d)*.18+Math.sin(2*Math.PI*freq*2*d)*.028)*envelope;
   }
   else {
    // Four bars at 100 BPM: heartbeat, offbeat brush, sparse metallic accents.
    const beat=t/.6,phase=beat%1,k=Math.floor(beat),pulse=Math.exp(-phase*34)*Math.min(1,phase*250);
    out[i]=Math.sin(Math.PI*2*(46*t+1.8*(1-Math.exp(-phase*35))))*pulse*.42;
    const off=(beat+.5)%1;out[i]+=(n-low)*Math.exp(-off*52)*Math.min(1,off*350)*.10;
    if(k%4===3)out[i]+=(n-low)*Math.exp(-phase*16)*Math.min(1,phase*200)*.10;
   }
  }
  // Overlap the noise splice; tonal periods are integer divisions of loop duration.
  if(kind!=='rhythm'){
   for(let i=0;i<fade;i++){const k=i/fade;out[i]=out[len+i]*(1-k)+out[i]*k;}
  }
  buffer.getChannelData(0).set(out.subarray(0,len));
  return buffer;
 }
 private loop(kind:string,bus:GainNode,seconds:number):Loop {
  const c=this.ctx,source=c.createBufferSource(),gain=c.createGain(),filter=c.createBiquadFilter(),pan=c.createStereoPanner();
  source.buffer=this.buffer(kind,seconds);source.loop=true;gain.gain.value=0;
  filter.type='lowpass';filter.frequency.value=kind==='cabin'?430:kind==='rhythm'?4400:kind==='texture'?900:kind==='wash'?4200:kind==='motif'?1700:4800;filter.Q.value=.4;
  source.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(bus);source.start();
  return {source,gain,filter,pan};
 }
 private transient(kind:'start'|'boost'|'chips'|'fall',p:SoundPosition={}){
  const c=this.ctx;if(c.state!=='running'||this.transients.size>=8)return;
  const seconds=kind==='fall'?1.8:kind==='boost'?.75:kind==='start'?.6:.28,rate=c.sampleRate,b=c.createBuffer(1,Math.ceil(seconds*rate),rate),out=b.getChannelData(0);
  let seed=Math.random()*0xffffffff>>>0,low=0,phase=0;
  for(let i=0;i<out.length;i++){
   const t=i/rate,k=t/seconds;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=seed/4294967296*2-1;low+=.08*(n-low);
   const edge=Math.min(1,t/.008)*Math.min(1,(seconds-t)/.06);
   if(kind==='start'||kind==='boost'){
    phase+=2*Math.PI*(kind==='boost'?64+92*k:42+66*k)/rate;
    out[i]=(low*.8+Math.sin(phase)*.14)*Math.sin(Math.PI*k)**2*edge;
   }else {
    const life=kind==='fall'?.42:.055;
    out[i]=(low*(kind==='fall'?1.3:.35)+(n-low)*.13)*Math.exp(-t/life)*edge;
    for(let j=0;j<(kind==='fall'?7:3);j++){
     const at=.025+j*(kind==='fall'?.17:.04),d=t-at;
     if(d>0)out[i]+=Math.sin(2*Math.PI*(370+j*173)*d)*.09*Math.exp(-d/.026)*Math.min(1,d/.002)*edge;
    }
   }
  }
  const source=c.createBufferSource(),gain=c.createGain(),pan=c.createStereoPanner(),filter=c.createBiquadFilter(),distance=Math.max(0,p.distance??0);
  source.buffer=b;source.playbackRate.value=(p.pitch??1)*(.96+Math.random()*.08);
  gain.gain.value=(kind==='fall'?.38:kind==='chips'?.28:.36)/(1+(distance/22)**1.6);
  pan.pan.value=Math.max(-.85,Math.min(.85,p.pan??0));filter.type='lowpass';filter.frequency.value=p.underwater?1100:Math.max(900,6500/(1+distance/25));
  source.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(kind==='start'||kind==='boost'?this.engines:this.impacts);
  this.transients.add(source);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();pan.disconnect();this.transients.delete(source);};source.start();
 }
 cut(p:SoundPosition={}){
  if(this.ctx.state!=='running')return;
  const t=this.ctx.currentTime,fresh=t>this.cutterUntil;this.cutterUntil=t+.16;
  const d=Math.max(0,p.distance??0),level=1/(1+(d/18)**1.65);
  if(fresh){this.cuts++;this.transient('start',{...p,pitch:1.8});}
  for(const [voice,volume]of [[this.cutter,.28],[this.grit,.19]] as const){
   voice.gain.gain.setTargetAtTime(volume*level,t,.025);voice.pan.pan.setTargetAtTime(Math.max(-.85,Math.min(.85,p.pan??0)),t,.035);
   voice.filter.frequency.setTargetAtTime(p.underwater?1100:voice===this.grit?5200:2800,t,.06);
  }
 }
 fracture(big:boolean,p:SoundPosition={}){this.transient(big?'fall':'chips',p);}
 combatBeat(weight:number){this.combatWeight=Math.min(1,this.combatWeight*.6+weight);this.combatAt=this.ctx.currentTime;}
 silence(){
  for(const source of [...this.transients]){source.stop();source.onended?.(new Event('ended'));}
  for(const voice of [this.wash,this.cabin,this.cutter,this.grit,this.rhythm,this.texture,this.motif])voice.gain.gain.value=0;
  this.cutterUntil=-1;this.engaged=false;this.boosting=false;
 }
 update(active:boolean,throttle:number,boost:boolean,scene:string,combat:boolean,enabled:boolean,body='bellweather'){
  const c=this.ctx;if(c.state!=='running')return;const t=c.currentTime;
  active=active&&enabled;boost=boost&&active;
  if(active&&!this.engaged){this.starts++;this.transient('start');}
  if(boost&&!this.boosting){this.boosts++;this.transient('boost');}
  this.engaged=active;this.boosting=boost;this.engineLevel=active?(.018+throttle*.085+(boost?.055:0)):0;
  this.wash.gain.gain.setTargetAtTime(this.engineLevel,t,active?.18:.32);
  this.wash.filter.frequency.setTargetAtTime(650+throttle*2900+(boost?1300:0),t,.2);
  this.wash.source.playbackRate.setTargetAtTime(.92+throttle*.21,t,.24);
  this.cabin.gain.gain.setTargetAtTime(enabled&&scene==='space'?.14:0,t,1.4);
  const pressure=this.combatWeight*Math.exp(-Math.max(0,t-this.combatAt)/3.2);
  this.phrase=Math.floor(t/9.6)%4;this.world=body;
  const phraseLevel=[.85,1,.92,1.12][this.phrase];
  this.rhythm.gain.gain.setTargetAtTime(enabled&&combat?(.16+pressure*.17)*phraseLevel:0,t,combat?.24:2.4);
  this.rhythm.filter.frequency.setTargetAtTime(combat?2100+pressure*4300:1700,t,.35);
  const musical=enabled&&scene!=='title'&&scene!=='pause',transpose=body==='pale'?1.189:body==='sirocco'?.891:body==='pelagia'?1.122:scene==='space'?.794:1;
  this.texture.source.playbackRate.setTargetAtTime(transpose,t,1.4);this.motif.source.playbackRate.setTargetAtTime(transpose,t,1.4);
  this.texture.gain.gain.setTargetAtTime(musical?(combat?.17+pressure*.08:.11):0,t,combat?.55:2);
  this.motif.gain.gain.setTargetAtTime(musical&&!combat?(.07+this.phrase*.012):0,t,combat?.35:2.2);
  this.motif.pan.pan.setTargetAtTime(Math.sin(t*.065)*.26,t,.4);
  if(!enabled||t>this.cutterUntil){this.cutter.gain.gain.setTargetAtTime(0,t,.045);this.grit.gain.gain.setTargetAtTime(0,t,.06);}
 }
 snapshot(){return {loops:7,phrase:this.phrase,world:this.world,transients:this.transients.size,cutterActive:this.ctx.currentTime<this.cutterUntil,engineLevel:+this.engineLevel.toFixed(3),combatWeight:this.combatWeight,starts:this.starts,boosts:this.boosts,cuts:this.cuts};}
}
