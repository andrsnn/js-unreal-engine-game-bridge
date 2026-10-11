import type {GameState} from '../core/types';

// Original procedural sound recipes; dedicated to the public domain under CC0-1.0.
// No downloaded recordings, models or third-party samples are used.
type Recipe={seconds:number;gain:number;priority:number;menu?:boolean};
export const SOUND_RECIPES:Record<string,Recipe>={
 slash:{seconds:.31,gain:.60,priority:60},heavy:{seconds:.58,gain:.80,priority:75},riposte:{seconds:.42,gain:.70,priority:80},
 'blade-windup':{seconds:.16,gain:.32,priority:35},'heavy-windup':{seconds:.32,gain:.43,priority:40},
 'enemy-slash':{seconds:.34,gain:.48,priority:55},guard:{seconds:.22,gain:.58,priority:70},parry:{seconds:.65,gain:.76,priority:90},
 dodge:{seconds:.26,gain:.40,priority:40},rune:{seconds:.70,gain:.56,priority:65},draw:{seconds:.24,gain:.40,priority:45},
 gun:{seconds:.43,gain:.84,priority:85},hit:{seconds:.35,gain:.70,priority:85},water:{seconds:.90,gain:.50,priority:45,menu:true},
 claim:{seconds:1.05,gain:.48,priority:65,menu:true},craft:{seconds:.62,gain:.58,priority:55,menu:true},
 victory:{seconds:1.30,gain:.52,priority:90,menu:true},defeat:{seconds:.46,gain:.45,priority:65},region:{seconds:.75,gain:.35,priority:35,menu:true},
 death:{seconds:.90,gain:.54,priority:95,menu:true},upgrade:{seconds:.75,gain:.46,priority:60,menu:true},
 'ui-select':{seconds:.09,gain:.22,priority:20,menu:true},'ui-confirm':{seconds:.23,gain:.30,priority:30,menu:true},
};
export const MAX_SOUND_VOICES=18;
const STORAGE_KEY='saltblade:audio:v1';

/** Deterministic layered attacks: glass modes, metal, breath/swish and low body. */
export function synthesizeSound(cue:string,variant:number,rate:number):Float32Array<ArrayBuffer>{
 const recipe=SOUND_RECIPES[cue];if(!recipe)return new Float32Array(0);
 const data=new Float32Array(Math.ceil(rate*recipe.seconds)),id=Object.keys(SOUND_RECIPES).indexOf(cue);
 let seed=(0x62a9+id*7919+variant*131)>>>0,low=0,phase=0;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
 const detune=1+(variant-1.5)*.025;
 const blade=['slash','heavy','riposte','enemy-slash','blade-windup','heavy-windup','dodge'].includes(cue);
 const contact=['parry','guard','craft','draw'].includes(cue);
 const water=cue==='water',signal=['rune','claim','victory','region','upgrade','ui-select','ui-confirm'].includes(cue);
 for(let i=0;i<data.length;i++){
  const t=i/rate,n=random();low+=.11*(n-low);let value=0;
  if(blade){
   const windup=cue.includes('windup'),heavy=cue.includes('heavy'),duration=recipe.seconds;
   const envelope=Math.sin(Math.PI*Math.min(1,t/(duration*(windup?1:.65))))**2*Math.exp(-t/(heavy?.30:.16));
   value=(n-low)*envelope*(windup?.48:.90)+low*envelope*.48;
   if(!windup&&cue!=='dodge')value+=Math.sin(2*Math.PI*(heavy?72:125)*detune*t)*Math.exp(-t/.055)*.50;
   if(cue==='riposte')value+=Math.sin(2*Math.PI*2370*detune*t)*Math.exp(-t/.09)*.25;
  }
  if(contact||cue==='slash'||cue==='heavy'||cue==='riposte'){
   const impact=contact?1:.24,decay=cue==='parry'?.24:cue==='guard'?.055:.09;
   for(const [frequency,level] of [[1230,.24],[2710,.28],[4190,.18],[6330,.11]])value+=Math.sin(2*Math.PI*frequency*detune*t)*Math.exp(-t/decay)*level*impact;
   value+=low*Math.exp(-t/.025)*impact*.65;
  }
  if(cue==='gun'||cue==='hit'||cue==='defeat'||cue==='death'){
   const gun=cue==='gun',death=cue==='death';phase+=2*Math.PI*(gun?52+70*Math.exp(-t/.025):death?52:78)*detune/rate;
   value+=Math.sin(phase)*Math.exp(-t/(death?.30:.085))*.72+low*Math.exp(-t/(death?.16:.04))*.8;
   if(gun)value+=(n-low)*Math.exp(-t/.022)*.45+Math.sin(2*Math.PI*740*detune*t)*Math.exp(-Math.abs(t-.055)/.012)*.17;
  }
  if(water){
   for(let drop=0;drop<6;drop++){const age=t-drop*.115;if(age>=0)value+=Math.sin(2*Math.PI*(900+drop*143)*detune*age+7*Math.exp(-age/.025))*Math.exp(-age/.052)*Math.min(1,age/.003)*.20;}
   value+=low*Math.sin(Math.PI*t/recipe.seconds)**2*.50;
  }
  if(signal){
   const notes=cue==='victory'||cue==='upgrade'?[1,1.25,1.5,2]:cue==='rune'?[1,1.498,2]:[1,1.25];
   for(let note=0;note<notes.length;note++){const age=t-note*.16;if(age<0)continue;const frequency=(cue==='region'?174:cue.startsWith('ui')?620:348)*notes[note]*detune;
    value+=Math.sin(2*Math.PI*frequency*age)*Math.exp(-age/.13)*.33+Math.sin(2*Math.PI*frequency*2.01*age)*Math.exp(-age/.06)*.10;
   }
  }
  // Shared tiny ramps avoid clicks at both ends; modest saturation retains texture.
  const ramp=Math.min(1,t/.003,(recipe.seconds-t)/.025);data[i]=Math.tanh(value*1.7)*.78*Math.max(0,ramp);
 }
 return data;
}

export function renderSoundControls(html:string,enabled:boolean){
 const button=`<button class="secondary sound-toggle" data-action="mute" aria-label="Game sound" aria-pressed="${!enabled}">${enabled?'Sound on':'Sound off'}</button>`;
 const result=html.replace(/(<div class="pause-menu">[\s\S]*?)(<\/div>)/g,(_,content:string,close:string)=>content+button+close);
 // Keep the title control outside the owner's action group and its hiding rule.
 const corner=button.replace('class="', 'style="position:fixed;top:16px;right:16px;min-width:0;padding:8px 12px;font-size:12px;z-index:20" class="');
 return html.includes('<div class="title-actions">')?corner+result:result;
}

type Voice={source:AudioBufferSourceNode;gain:GainNode;pan:StereoPannerNode;cue:string;priority:number};
export class SaltAudio{
 enabled=true;private context:AudioContext|null=null;private master:GainNode|null=null;private analyser:AnalyserNode|null=null;private tap:MediaStreamAudioDestinationNode|null=null;
 private voices=new Set<Voice>();private buffers=new Map<string,AudioBuffer>();private bags=new Map<string,number[]>();private lastVariant=new Map<string,number>();
 private played:Record<string,number>={};private focused=true;private worldActive=false;private disposed=false;private previousPhase='';private dropped=0;private samples=new Float32Array(256);
 constructor(){try{this.enabled=JSON.parse(localStorage.getItem(STORAGE_KEY)||'null')?.enabled!==false;}catch{}}
 unlock(event?:Pick<Event,'isTrusted'>){
  if(this.disposed||event?.isTrusted===false)return;
  try{
   if(!this.context){const Audio=globalThis.AudioContext??(globalThis as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!Audio)return;
    const ctx=this.context=new Audio({latencyHint:'interactive'}),master=this.master=ctx.createGain(),filter=ctx.createBiquadFilter(),limiter=ctx.createDynamicsCompressor(),ceiling=ctx.createWaveShaper(),output=ctx.createGain();
    filter.type='highpass';filter.frequency.value=32;limiter.threshold.value=-12;limiter.knee.value=6;limiter.ratio.value=4;limiter.attack.value=.003;limiter.release.value=.16;
    ceiling.curve=Float32Array.from({length:2048},(_,i)=>Math.tanh((i/2047*2-1)*1.12)/1.12);ceiling.oversample='2x';output.gain.value=.78;
    master.connect(filter).connect(limiter).connect(ceiling).connect(output);output.connect(ctx.destination);this.analyser=ctx.createAnalyser();this.analyser.fftSize=256;output.connect(this.analyser);this.applyMaster();
   }
   if(this.context.state==='suspended')void this.context.resume().catch(()=>{});
  }catch{/* Hosts without WebAudio retain the original saltblade:audio event. */}
 }
 private applyMaster(){if(this.context&&this.master){this.master.gain.cancelScheduledValues(this.context.currentTime);this.master.gain.setTargetAtTime(this.enabled&&this.focused?1:0,this.context.currentTime,.008);}}
 setEnabled(enabled:boolean){this.enabled=enabled;try{localStorage.setItem(STORAGE_KEY,JSON.stringify({enabled}));}catch{}this.applyMaster();if(!enabled)this.stop();}
 focus(active:boolean){this.focused=active;this.applyMaster();if(!active)this.stop();}
 sync(state:Pick<GameState,'mode'|'panel'|'paused'|'dialogue'|'run'>){
  const active=state.mode==='play'&&!state.paused&&state.panel==='none'&&!state.dialogue&&state.run.phase!=='death';
  if(this.worldActive&&!active)this.stop(false);this.worldActive=active;
  if(state.run.phase==='death'&&this.previousPhase!=='death')this.play('death');this.previousPhase=state.run.phase;
 }
 play(cue:string){
  const recipe=SOUND_RECIPES[cue],ctx=this.context;if(!recipe||!ctx||ctx.state!=='running'||!this.enabled||!this.focused||this.disposed||(!this.worldActive&&!recipe.menu))return false;
  const same=[...this.voices].filter(v=>v.cue===cue);
  if(same.length>=3||this.voices.size>=MAX_SOUND_VOICES){const pool=same.length>=3?same:[...this.voices],lowest=pool.reduce((a,b)=>a.priority<b.priority?a:b);if(lowest.priority>=recipe.priority){this.dropped++;return false;}this.end(lowest);}
  let bag=this.bags.get(cue);if(!bag?.length){bag=[0,1,2,3];for(let i=3;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}if(bag[3]===this.lastVariant.get(cue))[bag[0],bag[3]]=[bag[3],bag[0]];this.bags.set(cue,bag);}
  const variant=bag.pop()!,key=cue+':'+variant;this.lastVariant.set(cue,variant);let buffer=this.buffers.get(key);
  if(!buffer){const data=synthesizeSound(cue,variant,ctx.sampleRate);buffer=ctx.createBuffer(1,data.length,ctx.sampleRate);buffer.copyToChannel(data,0);this.buffers.set(key,buffer);}
  const source=ctx.createBufferSource(),gain=ctx.createGain(),pan=ctx.createStereoPanner();source.buffer=buffer;gain.gain.value=recipe.gain;pan.pan.value=(variant-1.5)*.055;
  source.connect(gain).connect(pan).connect(this.master!);const voice={source,gain,pan,cue,priority:recipe.priority};this.voices.add(voice);
  source.onended=()=>{this.voices.delete(voice);source.disconnect();gain.disconnect();pan.disconnect();};source.start();this.played[cue]=(this.played[cue]||0)+1;return true;
 }
 private end(voice:Voice){if(!this.context)return;voice.gain.gain.cancelScheduledValues(this.context.currentTime);voice.gain.gain.setTargetAtTime(0,this.context.currentTime,.004);try{voice.source.stop(this.context.currentTime+.02);}catch{}this.voices.delete(voice);}
 private stop(all=true){for(const voice of this.voices)if(all||!SOUND_RECIPES[voice.cue].menu)this.end(voice);}
 status(){let peak=0,rms=0;if(this.analyser){this.analyser.getFloatTimeDomainData(this.samples);for(const value of this.samples){peak=Math.max(peak,Math.abs(value));rms+=value*value;}}
  return {audioPass:1,context:this.context?.state||'locked',muted:!this.enabled,focused:this.focused,worldActive:this.worldActive,voices:this.voices.size,maxVoice:MAX_SOUND_VOICES,buffers:this.buffers.size,played:{...this.played},dropped:this.dropped,peak,rms:Math.sqrt(rms/this.samples.length),outputGain:.78,variants:Object.fromEntries(this.lastVariant)};}
 recordingStream(){if(!this.context||!this.analyser)return null;if(!this.tap){this.tap=this.context.createMediaStreamDestination();this.analyser.connect(this.tap);}return this.tap.stream;}
 dispose(){if(this.disposed)return;this.disposed=true;this.stop();this.buffers.clear();void this.context?.close().catch(()=>{});}
}
