import type {SoundPosition} from './audio';

type Loop={source:AudioBufferSourceNode;gain:GainNode;filter:BiquadFilterNode;pan:StereoPannerNode};
export const PHYSICAL_V4_BANK={
 loops:['drive-core','drive-pressure','cutter-rotor','cutter-contact'],
 ignite:['drive-ignite-0','drive-ignite-1'],boost:['drive-boost-0','drive-boost-1'],
 chips:['rock-chip-0','rock-chip-1','rock-chip-2','rock-chip-3'],fall:['rock-fall-0','rock-fall-1','rock-fall-2'],
 gun:['gun-body-0','gun-body-1','gun-body-2','gun-body-3'],blast:['blast-body-0','blast-body-1','blast-body-2'],
 metal:['metal-hit-0','metal-hit-1','metal-hit-2'],structure:['drive-boost-0','drive-boost-1'],
} as const;
/** Four resident machine loops and at most twenty finite voices. All routes are pre-slider. */
export class PhysicalAudio {
 private buffers=new Map<string,AudioBuffer>();private loops=new Map<string,Loop>();private voices=new Map<AudioBufferSourceNode,{enemy:boolean}>();
 private turns=new Map<string,number>();private gates=new Map<string,number>();private events:Record<string,number>={};
 private scene='title';private underwater=false;private enabled=true;private cutterUntil=-1;private engaged=false;private boosting=false;
 private resistance=0;private cutterTailUntil=-1;private loadPromise:Promise<void>|null=null;private failed=0;
 constructor(private ctx:AudioContext,private engines:GainNode,private impacts:GainNode,private weapons:GainNode){
  for(const id of PHYSICAL_V4_BANK.loops)this.loops.set(id,this.loop(id,this.fallback(id),id==='cutter-contact'?impacts:engines));
 }
 private fallback(id:string){
  const rate=this.ctx.sampleRate,buffer=this.ctx.createBuffer(1,rate*2,rate),pcm=buffer.getChannelData(0);let seed=1917,low=0;
  for(let i=0;i<pcm.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;low+=.06*(seed/4294967296*2-1-low);const t=i/rate;
   pcm[i]=id==='cutter-contact'?low*.9:(Math.sin(2*Math.PI*(id==='cutter-rotor'?138:52)*t)*.15+low*.25);
  }return buffer;
 }
 private loop(_id:string,buffer:AudioBuffer,bus:GainNode):Loop{
  const c=this.ctx,source=c.createBufferSource(),gain=c.createGain(),filter=c.createBiquadFilter(),pan=c.createStereoPanner();
  source.buffer=buffer;source.loop=true;gain.gain.value=0;filter.type='lowpass';filter.frequency.value=2400;filter.Q.value=.4;
  source.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(bus);source.start();return {source,gain,filter,pan};
 }
 load(){return this.loadPromise??=Promise.all([...new Set(Object.values(PHYSICAL_V4_BANK).flat())].map(async id=>{
  try{const response=await fetch(new URL(`audio/physical-v4/${id}.ogg`,document.baseURI),{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Missing physical asset');
   const buffer=await this.ctx.decodeAudioData(await response.arrayBuffer());this.buffers.set(id,buffer);
   const loop=this.loops.get(id);if(loop){const next=this.ctx.createBufferSource();next.buffer=buffer;next.loop=true;next.connect(loop.filter);next.start();loop.source.stop();loop.source.disconnect();loop.source=next;}
  }catch{this.failed++;}
 })).then(()=>{});}
 private event(id:string){this.events[id]=(this.events[id]??0)+1;}
 /** Preserve the current envelope while cancelling an old scheduled tail or hard stop. */
 private hold(param:AudioParam,t:number){const value=param.value;param.cancelScheduledValues(t);param.setValueAtTime(value,t);}
 private take(key:Exclude<keyof typeof PHYSICAL_V4_BANK,'loops'>){const list=PHYSICAL_V4_BANK[key],old=this.turns.get(key)??-1;
  const take=old<0?Math.floor(Math.random()*list.length):(old+1+Math.floor(Math.random()*(list.length-1)))%list.length;this.turns.set(key,take);return this.buffers.get(list[take]);
 }
 private one(key:Exclude<keyof typeof PHYSICAL_V4_BANK,'loops'>,level:number,p:SoundPosition,bus:GainNode,gate=.04,pitch=1,priority=false){
  const c=this.ctx,t=c.currentTime;if(!this.enabled||c.state!=='running'||this.scene==='pause'||this.scene==='title')return;
  const gateKey=key+(p.enemy?':enemy':':player'),last=this.gates.get(gateKey)??-10;if(t-last<gate)return;this.gates.set(gateKey,t);
  const buffer=this.take(key);if(!buffer)return;
  if(this.voices.size>=20){if(!priority)return;const old=[...this.voices].find(([,v])=>v.enemy)?.[0]??this.voices.keys().next().value!;old.stop();old.onended?.(new Event('ended'));}
  const source=c.createBufferSource(),gain=c.createGain(),filter=c.createBiquadFilter(),pan=c.createStereoPanner();
  const distance=Math.max(0,p.distance??0),space=this.scene==='space',range=space?150:24;
  source.buffer=buffer;source.playbackRate.value=pitch*(p.pitch??1)*(.97+Math.random()*.06);
  gain.gain.value=level*(p.enemy?.72:1)/(1+(distance/range)**1.5);
  filter.type='lowpass';filter.frequency.value=p.underwater||this.underwater?1050:Math.max(650,(key==='gun'?3500:5100)/(1+distance/(space?140:35)));filter.Q.value=.45;
  pan.pan.value=Math.max(-.85,Math.min(.85,p.pan??0));source.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(bus);
  this.voices.set(source,{enemy:p.enemy===true});source.onended=()=>{source.disconnect();gain.disconnect();filter.disconnect();pan.disconnect();this.voices.delete(source);};
  source.start(t+(space?0:Math.min(.18,distance/343)));this.event(key);
 }
 cut(p:SoundPosition={}){
  if(!this.enabled||this.ctx.state!=='running'||this.scene==='pause')return;const t=this.ctx.currentTime,fresh=t>this.cutterUntil;this.cutterUntil=t+.18;
  this.resistance=Math.max(.2,Math.min(1,(p.resistance??1)/2.2));if(fresh){
   const rotor=this.loops.get('cutter-rotor')!,contact=this.loops.get('cutter-contact')!;
   this.hold(rotor.gain.gain,t);this.hold(rotor.source.playbackRate,t);this.hold(contact.gain.gain,t);this.cutterTailUntil=-1;
   this.event('cutter:start');this.one('metal',.25,p,this.engines,.08,1.25);
  }
  const d=Math.max(0,p.distance??0),level=1/(1+(d/20)**1.6),rotor=this.loops.get('cutter-rotor')!,contact=this.loops.get('cutter-contact')!;
  rotor.gain.gain.setTargetAtTime((.34+this.resistance*.25)*level,t,.035);rotor.source.playbackRate.setTargetAtTime(1.1-this.resistance*.24,t,.09);
  contact.gain.gain.setTargetAtTime((.22+this.resistance*.42)*level,t,.025);contact.source.playbackRate.setTargetAtTime(.93+this.resistance*.14,t,.06);
  for(const loop of [rotor,contact]){loop.pan.pan.setTargetAtTime(Math.max(-.85,Math.min(.85,p.pan??0)),t,.04);loop.filter.frequency.setTargetAtTime(p.underwater||this.underwater?1050:loop===rotor?1700+this.resistance*1000:2600+this.resistance*1300,t,.08);}
 }
 fracture(big:boolean,p:SoundPosition={}){this.one(big?'fall':'chips',big?.6:.34,p,this.impacts,big?.24:.11,big?.85:1,!p.enemy);if(big)this.one('structure',.18,p,this.impacts,.35,.66);}
 weapon(kind:string,p:SoundPosition={}){const heavy=['shotgun','sniper','rail','plasma','missile'].includes(kind);if(kind==='bow'||kind==='suppressed')return;
  this.one('gun',heavy?.62:.4,p,this.weapons,kind==='rotary'||kind==='lmg'||kind==='smg'?.065:.035,heavy?.78:1,!p.enemy);
 }
 impact(kind:string,p:SoundPosition={}){this.one(kind==='stone'?'chips':'metal',kind==='body'?.16:kind==='stone'?.24:.36,p,this.impacts,.075,kind==='armor'?.85:1);}
 blast(p:SoundPosition={}){this.one('blast',.7,p,this.impacts,.16,.86,!p.enemy);}
 update(active:boolean,throttle:number,boost:boolean,scene:string,underwater:boolean,enabled:boolean){
  this.scene=scene;this.underwater=underwater;this.enabled=enabled&&scene!=='pause'&&scene!=='title';const c=this.ctx;if(c.state!=='running')return;const t=c.currentTime;
  active=active&&this.enabled;boost=boost&&active;throttle=Math.max(0,Math.min(1,throttle));
  if(active&&!this.engaged)this.one('ignite',.35,{},this.engines,.5);if(boost&&!this.boosting)this.one('boost',.28,{},this.engines,.5);
  this.engaged=active;this.boosting=boost;
  const core=this.loops.get('drive-core')!,pressure=this.loops.get('drive-pressure')!;
  core.gain.gain.setTargetAtTime(active?.18+throttle*.42+(boost?.13:0):0,t,active?.22:.12);
  pressure.gain.gain.setTargetAtTime(active?.06+throttle*.17+(boost?.25:0):0,t,active?.32:.16);
  core.source.playbackRate.setTargetAtTime(.82+throttle*.23+(boost?.06:0),t,.28);pressure.source.playbackRate.setTargetAtTime(.86+throttle*.17,t,.3);
  core.filter.frequency.setTargetAtTime(underwater?700:850+throttle*900,t,.25);pressure.filter.frequency.setTargetAtTime(underwater?700:750+throttle*1400,t,.3);
  if(this.enabled&&this.cutterUntil>=0&&t>this.cutterUntil){
   const rotor=this.loops.get('cutter-rotor')!,contact=this.loops.get('cutter-contact')!;
   // Contact clears quickly; stored rotor momentum decays once, without another voice.
   this.hold(contact.gain.gain,t);contact.gain.gain.setTargetAtTime(0,t,.035);
   this.hold(rotor.gain.gain,t);rotor.gain.gain.setTargetAtTime(0,t,.12);rotor.gain.gain.setValueAtTime(0,t+.5);
   this.hold(rotor.source.playbackRate,t);rotor.source.playbackRate.setTargetAtTime(.5,t,.13);
   this.cutterTailUntil=t+.5;this.event('cutter:stop');this.cutterUntil=-1;
  }
  if(!this.enabled)this.silence();
 }
 silence(){for(const source of [...this.voices.keys()]){source.stop();source.onended?.(new Event('ended'));}for(const loop of this.loops.values()){loop.gain.gain.cancelScheduledValues(this.ctx.currentTime);loop.gain.gain.setValueAtTime(0,this.ctx.currentTime);}this.cutterUntil=-1;this.cutterTailUntil=-1;this.engaged=false;this.boosting=false;}
 snapshot(){return {revision:'physical-v5',loaded:this.buffers.size,expected:new Set(Object.values(PHYSICAL_V4_BANK).flat()).size,failed:this.failed,loops:this.loops.size,voices:this.voices.size,limits:{loops:4,voices:20},resistance:this.resistance,cutterTailActive:this.ctx.currentTime<this.cutterTailUntil,levels:Object.fromEntries([...this.loops].map(([id,loop])=>[id,+loop.gain.gain.value.toFixed(3)])),lastTakes:Object.fromEntries(this.turns),events:{...this.events}};}
}
