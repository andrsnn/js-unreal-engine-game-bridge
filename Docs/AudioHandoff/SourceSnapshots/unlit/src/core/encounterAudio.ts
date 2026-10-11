import type {SoundPosition} from './audio';
type Family='beast'|'insect'|'heavy'|'sentinel';
type State='idle'|'cautious'|'combat'|'attack'|'arrival';
/** Original formant growls, insect stridulation and robot/radio articulation; no speech recordings. */
export class EncounterAudio {
 private cache=new Map<string,AudioBuffer>();private sources=new Set<AudioBufferSourceNode>();private turns=new Map<string,number>();
 private calls=0;private clicks=0;private reactions:Record<string,number>={};
 constructor(private ctx:AudioContext,private impacts:GainNode,private uiBus:GainNode){}
 private voice(family:Family,state:State,take:number){
  const key=`${family}:${state}:${take}`,old=this.cache.get(key);if(old)return old;
  const rate=this.ctx.sampleRate,seconds=state==='arrival'?1.25:state==='idle'?.52:state==='attack'?.44:.78;
  const buffer=this.ctx.createBuffer(1,Math.ceil(seconds*rate),rate),out=buffer.getChannelData(0);
  let seed=9713+take*7193+family.length*7919,phase=0,low=0;
  for(let i=0;i<out.length;i++){
   const t=i/rate,k=t/seconds;seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   const n=seed/4294967296*2-1;low+=.12*(n-low);
   const envelope=Math.sin(Math.PI*k)**1.6,shift=1+(take-1.5)*.037;
   if(family==='insect'){
    const chirp=Math.max(0,Math.sin(2*Math.PI*(state==='attack'?31:17+take)*t));
    out[i]=(Math.sin(2*Math.PI*(1650+take*170+530*k)*t)*.24+(n-low)*.22)*chirp**4*envelope;
   }else if(family==='sentinel'){
    // Broken syllabic bursts convey a filtered command without invented spoken words.
    const syllable=(.58+.42*Math.sin(2*Math.PI*(7+take)*t))**3;
    phase+=2*Math.PI*(140+40*Math.sin(k*7)+take*9)/rate;
    out[i]=(Math.sin(phase)*.17+Math.sin(phase*4.1)*.19+low*.38)*syllable*envelope;
   }else {
    const root=family==='heavy'?48:87;
    phase+=2*Math.PI*(root+(state==='attack'?68:28)*Math.sin(Math.PI*k))*shift/rate;
    const rasp=Math.sin(phase)+Math.sin(phase*2.73)*.36+Math.sin(phase*5.13)*.17;
    out[i]=(rasp*.19+low*.7)*envelope*(.72+.28*Math.sin(2*Math.PI*(19+take)*t));
   }
  }
  this.cache.set(key,buffer);return buffer;
 }
 private play(buffer:AudioBuffer,level:number,p:SoundPosition,bus:GainNode,rate=1,priority=false){
  const c=this.ctx;if(c.state!=='running')return;
  if(this.sources.size>=10){if(!priority)return;const old=this.sources.values().next().value!;old.stop();old.onended?.(new Event('ended'));}
  const source=c.createBufferSource(),gain=c.createGain(),filter=c.createBiquadFilter(),pan=c.createStereoPanner();
  source.buffer=buffer;source.playbackRate.value=rate;gain.gain.value=level/(1+(Math.max(0,p.distance??0)/24)**1.5);
  filter.type='lowpass';filter.frequency.value=p.underwater?1050:Math.max(950,6200/(1+(p.distance??0)/26));
  pan.pan.value=Math.max(-.85,Math.min(.85,p.pan??0));source.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(bus);
  this.sources.add(source);source.onended=()=>{source.disconnect();gain.disconnect();filter.disconnect();pan.disconnect();this.sources.delete(source);};source.start();
 }
 call(family:Family,state:State,p:SoundPosition={}){
  const key=family+state,previous=this.turns.get(key)??0,take=(previous+1+Math.floor(Math.random()*3))%4;this.turns.set(key,take);
  this.calls++;this.play(this.voice(family,state,take),state==='idle'?.20:state==='arrival'?.43:.34,p,this.impacts,.97+Math.random()*.06);
 }
 private reactionBuffer(family:'human'|'mech'|'creature',state:'hurt'|'death'|'attack',take:number){
  const key=`reaction:${family}:${state}:${take}`,old=this.cache.get(key);if(old)return old;
  const rate=this.ctx.sampleRate,seconds=state==='death'?1.1:state==='attack'?.48:.35;
  const buffer=this.ctx.createBuffer(1,Math.ceil(seconds*rate),rate),out=buffer.getChannelData(0);
  let seed=9349+take*9713+family.length*773,low=0,phase=0;
  for(let i=0;i<out.length;i++){
   const t=i/rate,k=t/seconds;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=seed/4294967296*2-1;low+=.14*(noise-low);
   const edge=Math.min(1,t/.012)*Math.min(1,(seconds-t)/.055),decay=Math.exp(-k*(state==='death'?3.5:4.7));
   const root=(family==='human'?117:family==='mech'?64:73)*(1+(take-1.5)*.045),hz=root*(state==='attack'?1+.3*Math.sin(k*6):1.45-.7*k);
   phase+=2*Math.PI*hz/rate;
   if(family==='human'){
    // Breathy chest/formant layer beneath the existing licensed human reactions.
    const glottal=Math.sin(phase)+Math.sin(phase*2)*.25;
    out[i]=(glottal*.12+(Math.sin(phase*5.7)*.08+low*.48)*(.6+.4*Math.sin(phase)))*decay*edge;
   }else if(family==='mech'){
    out[i]=(Math.sin(phase)*.22+Math.sin(phase*6.31)*.12+low*.38)*decay*edge;
    for(let j=0;j<3+(state==='death'?3:0);j++){
     const d=t-(.03+j*(.06+take*.008));if(d>0)out[i]+=Math.sin(2*Math.PI*(740+j*241)*d)*.14*Math.exp(-d/.023)*Math.min(1,d/.003)*edge;
    }
   }else out[i]=(Math.sin(phase)*.23+Math.sin(phase*2.71)*.13+low*.6)*decay*edge*(.72+.28*Math.sin(phase*.43));
  }
  out[0]=0;out[out.length-1]=0;this.cache.set(key,buffer);return buffer;
 }
 reaction(family:'human'|'mech'|'creature',state:'hurt'|'death'|'attack',p:SoundPosition={},boss=false){
  const key=`reaction:${family}:${state}`,old=this.turns.get(key)??0,take=(old+1+Math.floor(Math.random()*3))%4;this.turns.set(key,take);
  this.reactions[key]=(this.reactions[key]??0)+1;
  this.play(this.reactionBuffer(family,state,take),(state==='death'?.46:state==='attack'?.32:.35)*(boss?1.18:1),p,this.impacts,boss?.85:1,state==='death');
 }
 ui(id:string){
  const c=this.ctx,key='ui:'+id;let buffer=this.cache.get(key);
  if(!buffer){
   const seconds=id==='focus'?.05:id==='purchase'?.28:id==='reveal'?.26:.16;buffer=c.createBuffer(1,Math.ceil(seconds*c.sampleRate),c.sampleRate);const pcm=buffer.getChannelData(0);
   const root=id==='confirm'?620:id==='purchase'?740:id==='reveal'?520:940;
   for(let i=0;i<pcm.length;i++){const t=i/c.sampleRate,k=t/seconds;pcm[i]=(Math.sin(2*Math.PI*1830*t)*.13*Math.exp(-k*8)+Math.sin(2*Math.PI*root*t*(1+k*.22))*.11*Math.exp(-k*4))*Math.min(1,t/.002)*Math.min(1,(seconds-t)/.01);}
   this.cache.set(key,buffer);
  }
  const turn=(this.turns.get(key)??0)+1;this.turns.set(key,turn);this.clicks++;
  this.play(buffer,id==='focus'?.13:.25,{pan:turn%2?.04:-.04},this.uiBus,[.97,1.025,.99,1.04][turn%4],id!=='focus');
 }
 silence(){for(const source of [...this.sources]){source.stop();source.onended?.(new Event('ended'));}}
 snapshot(){return {calls:this.calls,reactions:{...this.reactions},uiDetails:this.clicks,voices:this.sources.size,cached:this.cache.size,lastTakes:Object.fromEntries(this.turns)};}
}
