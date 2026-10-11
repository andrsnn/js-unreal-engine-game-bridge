import {REACTION_VOICE_COUNTS,GENERATED_VOICE_COUNTS,GENERATED_AUDIO_REVISION,PRODUCTION_AUDIO,REFINED_VOICES,CONTEXT_VOICES,PHYSICAL_AUDIO,PHYSICAL_AUDIO_REVISION,PHYSICAL_VOICE_COUNTS,FIELD_AUDIO,FIELD_AUDIO_REVISION,FIELD_VOICE_COUNTS} from './audioAssets';
import {PlanetAmbience,planetAmbience,type AudioEnvironment,type FootSurface} from './planetAudio';
import {synthVoice,weaponVoice,type AudioWeapon,type VoiceKind} from './soundBank';
import {LocationMusic} from './locationMusic';
import {MUSIC_LIBRARY} from './musicLibrary';
import {gameSettings} from './settings';
import {MotionAudio} from './motionAudio';
import {AcousticSpace} from './acousticSpace';
import {EncounterAudio} from './encounterAudio';
import {NarrationAudio} from './narrationAudio';
import {PhysicalAudio} from './physicalAudio';
export interface SoundPosition {distance?:number;pan?:number;enemy?:boolean;underwater?:boolean;voice?:string;pitch?:number;actorFrame?:string;resistance?:number}
// Runtime presence, before the existing effect duck/compress/master limiter. Sliders still reach zero.
export const PHYSICAL_MIX_GAIN={weapons:2.7,impacts:2.4,engines:2.7,ambience:1,ui:1} as const;
export const MIX_CHANNELS=['weapons','impacts','engines','ambience','ui','alerts'] as const;
type MixChannel=typeof MIX_CHANNELS[number];
export const DEFAULT_AUDIO_SETTINGS={master:.7,music:.32,effects:.75,weapons:.9,impacts:.82,engines:.58,ambience:.72,ui:.8,alerts:.9,muted:false};
const WEAPON_VOICES=new Set<VoiceKind>(['rifle','smg','lmg','shotgun','sniper','bow','suppressed','pulse','arc','plasma','rail','rotary','missile','defense','pistol','gunCrack','gunTail','gunMechanism','kick','eject','insert','bolt','shellRack','cell','nock','spinUp','launchThump']);
const UI_VOICES=new Set<VoiceKind>(['uiTick','uiConfirm','uiPurchase','uiReveal','uiCapture','lampClick','pickup','read','chest','refit','level','dialogue','objectiveDone','dodgeChime']);
type Sustain={osc:OscillatorNode|AudioBufferSourceNode;gain:GainNode;filter:BiquadFilterNode;panner:StereoPannerNode;expires:number};

/** The families a wave can belong to, and the voice each one announces itself with. */
export type ArrivalFamily='nest'|'foundry'|'settlement';
const ARRIVAL_VOICE:Record<ArrivalFamily,VoiceKind>={nest:'warnNest',foundry:'warnFoundry',settlement:'warnSettlement'};
/** Seamless synthesized beds. Not the file-backed `PlanetAmbience` set: these are places, not biomes. */
export type BedKind='hangar'|'town'|'night'|'work'|'flight';
export const BED_KINDS:readonly BedKind[]=['hangar','town','night','work','flight'];

/**
 * Every id `cue()` accepts, and the voice it resolves to. A cue with `alert` set plays on the alert
 * bus (which the combat bus ducks under) so a warning or an objective sting is never buried by gunfire.
 */
/** Level multiplier on the player's own on-foot gun report and crack (see `weapon`). */
export const ON_FOOT_REPORT_GAIN=1.2;
export const CUES:Record<string,{kind:VoiceKind;volume:number;gate:number;alert?:number;pitch?:number}>={
 // pre-existing ids, now declared rather than inferred
 explosion:{kind:'explosion',volume:.8,gate:.055},hit:{kind:'body',volume:.42,gate:.06},
 charge:{kind:'charge',volume:.42,gate:.045},reload:{kind:'bolt',volume:.42,gate:.045},
 worm:{kind:'worm',volume:.55,gate:.045},pickup:{kind:'pickup',volume:.32,gate:.045},
 level:{kind:'level',volume:.42,gate:.045},refit:{kind:'refit',volume:.42,gate:.045},
 dive:{kind:'dive',volume:.42,gate:.045},missile:{kind:'missile',volume:.92,gate:.045},
 defense:{kind:'defense',volume:.42,gate:.045},grenade:{kind:'eject',volume:.42,gate:.045},
 arc_blast:{kind:'arc',volume:.42,gate:.045},swing:{kind:'swing',volume:.42,gate:.045},
 step:{kind:'step',volume:.42,gate:.045},spit:{kind:'spit',volume:.42,gate:.045},
 chest:{kind:'chest',volume:.58,gate:.045},read:{kind:'read',volume:.3,gate:.045},
 enemy_hit:{kind:'enemyHurt',volume:.42,gate:.13},enemy_death:{kind:'enemyDeath',volume:.48,gate:.045},
 boss_death:{kind:'bossDeath',volume:.8,gate:.045},
 // dig kit: recorded voices only, so the first cut or rockfall never waits on synthesis
 rock_crack:{kind:'stone',volume:.55,gate:.12},rock_fall:{kind:'explosion',volume:.72,gate:.25,pitch:.55},
 charge_arm:{kind:'charge',volume:.34,gate:.08,pitch:1.6},charge_beep:{kind:'pickup',volume:.22,gate:.05,pitch:1.9},
 // ids the scenes already called that used to fall through to 'refit'
 chest_open:{kind:'chest',volume:.6,gate:.045},heal:{kind:'pickup',volume:.4,gate:.045,pitch:.86},
 // 1 · arrival warnings
 arrival_nest:{kind:'warnNest',volume:.78,gate:2.4,alert:.42},
 arrival_foundry:{kind:'warnFoundry',volume:.74,gate:2.4,alert:.42},
 arrival_settlement:{kind:'warnSettlement',volume:.76,gate:2.4,alert:.42},
 wave_contact:{kind:'contactHorn',volume:.8,gate:1.6,alert:.4},
 // 2 · missiles
 missile_launch:{kind:'launchThump',volume:.62,gate:.02},
 missile_impact:{kind:'missileCrump',volume:.85,gate:.07},
 missile_near:{kind:'whoosh',volume:.6,gate:.18},
 missile_warning:{kind:'missileAlert',volume:.6,gate:1.1,alert:.5},
 // 3 · combat roll
 roll_whip:{kind:'clothWhip',volume:.4,gate:.1},
 roll_land:{kind:'landThud',volume:.42,gate:.1},
 dodge_chime:{kind:'dodgeChime',volume:.42,gate:.12,alert:.6},
 // 4 · held objectives
 objective_done:{kind:'objectiveDone',volume:.7,gate:.5,alert:.4},
 objective_provoke:{kind:'provokeAlarm',volume:.72,gate:.8,alert:.4},
 // 5 · guardian and captain
 boss_phase:{kind:'bossRoar',volume:.85,gate:.6,alert:.45},
 captain_phase:{kind:'captainShout',volume:.7,gate:.5,alert:.5},
 boss_charge:{kind:'chargeRumble',volume:.62,gate:.5},
 boss_crash:{kind:'deathCrash',volume:.9,gate:.6,alert:.4},
 // 6 · base deck
 base_weld:{kind:'weldCrackle',volume:.34,gate:.55},
 base_radio:{kind:'radioBlip',volume:.3,gate:1.4},
 base_step:{kind:'stepDeck',volume:.26,gate:.16},
 // 8 · interface
 flashlight:{kind:'lampClick',volume:.42,gate:.04},
 ui_focus:{kind:'uiTick',volume:.18,gate:.045},
 ui_confirm:{kind:'uiConfirm',volume:.3,gate:.08},
 ui_purchase:{kind:'uiPurchase',volume:.4,gate:.3,alert:.55},
 ui_reveal:{kind:'uiReveal',volume:.38,gate:.6,alert:.5},
 ui_rebind:{kind:'uiCapture',volume:.26,gate:.06},
};
export const CUE_IDS=Object.keys(CUES);
/** Cues that mean "you are in a fight", which is what the music duck and the combat bed read. */
const DANGER_CUES=new Set(['swing','spit','explosion','missile','missile_launch','missile_impact','missile_warning','boss_charge','boss_phase','captain_phase','wave_contact']);
/** Equipment-aware sound design, bounded voices and a deliberately quiet score. */
export class GameAudio {
 private ctx:AudioContext|null=null;private master!:GainNode;private music!:GainNode;private fx!:GainNode;private musicDuck!:GainNode;
 private engineGain!:GainNode;private engineFilter!:BiquadFilterNode;private engineTone!:OscillatorNode;private engineHarmonic!:OscillatorNode;private engineNoise!:AudioBufferSourceNode;
 private ambientGain!:GainNode;private ambientFilter!:BiquadFilterNode;private lastFoot:{scene:string;x:number;z:number}|null=null;private footDistance=0;
 private samples=new Map<string,AudioBuffer>();private sources=new Set<AudioBufferSourceNode>();private sustains=new Map<string,Sustain>();private last=new Map<string,number>();
 private recordings=new Map<VoiceKind,AudioBuffer[]>();private recordingLoad:Promise<void>|null=null;
 private recordingTurns=new Map<VoiceKind,number>();
 private planetAmbience!:PlanetAmbience;private environment:AudioEnvironment={};private environmentScene='';
 private locationMusic!:LocationMusic;private fallbackMusic!:GainNode;
 private motionAudio!:MotionAudio;private physicalAudio!:PhysicalAudio;
 private acousticSpace!:AcousticSpace;private encounterAudio!:EncounterAudio;
 private narrationAudio!:NarrationAudio;
 private engineLayers=new Map<string,{source:AudioBufferSourceNode;gain:GainNode}>();private engineFallback!:GainNode;private beamBuffer:AudioBuffer|null=null;private chargeBuffer:AudioBuffer|null=null;
 private beat=0;private nextBeat=0;private scene='title';private body='verdant';private dangerUntil=0;private engineId='';private engineThrottle=0;private engineBoost=false;private engineSeen=0;private unlocked=false;private voices=0;private timer=0;private serial=0;private suppressed=0;
 private channels={} as Record<Exclude<MixChannel,'alerts'>,GainNode>;
 private channelReturns={} as Record<Exclude<MixChannel,'alerts'>,GainNode>;
 settings={...DEFAULT_AUDIO_SETTINGS};events:Record<string,number>={};
 private killDuckUntil=0;
 private briefing=false;
 // ---- sound pass ----
 /** Alerts (warnings, stings, objective beats) run their own path; combat ducks under them. */
 private alerts!:GainNode;private alertLevel!:GainNode;private combatDuck!:GainNode;
 private duckUntil=0;private duckDepth=1;
 /** Seamless synthesized place/loop beds, and the loop voices they feed. */
 private bedBuffers=new Map<BedKind,AudioBuffer>();private bedBus!:GainNode;
 private bedLayers=new Map<BedKind,{source:AudioBufferSourceNode;gain:GainNode;filter:BiquadFilterNode;target:number}>();
 private loops=new Map<string,{source:AudioBufferSourceNode;gain:GainNode;filter:BiquadFilterNode;pan:StereoPannerNode;expires:number}>();
 /** Ripple state: consecutive launches inside one salvo drift upward in pitch. */
 private ripple={index:0,at:-9};
 /** Per-missile flight memory, for the Doppler slide and the one-shot near-miss whoosh. */
 private flights=new Map<string,{distance:number;near:boolean;seen:number}>();
 private uiBound=false;private reducedQuery:MediaQueryList|null=null;
 private bedNight=false;private bedTown=0;private bedSeen=-9;
 /** The player's reduced-motion preference, from the OS and from the in-game menu-motion switch. */
 private get calm(){
  if(this.reducedQuery===null&&typeof matchMedia==='function'){try{this.reducedQuery=matchMedia('(prefers-reduced-motion: reduce)');}catch{}}
  return this.reducedQuery?.matches===true||gameSettings.menuMotion===false;
 }
 setBriefing(active:boolean){this.briefing=active;}
 async routeNarration(audio:HTMLAudioElement,stillCurrent=()=>true){await this.unlock();return stillCurrent()?this.narrationAudio.attach(audio):()=>{};}
 constructor(){try{Object.assign(this.settings,JSON.parse(localStorage.getItem('starweave_audio')??'{}'));}catch{}this.clampSettings();}
 private clampSettings(){for(const k of ['master','music','effects',...MIX_CHANNELS] as const)this.settings[k]=Math.max(0,Math.min(1,Number(this.settings[k])||0));delete (this.settings as typeof this.settings & {vibe?:string}).vibe;}
 install(){const activate=()=>void this.unlock();document.addEventListener('pointerdown',activate,{once:true});document.addEventListener('keydown',activate,{once:true});document.addEventListener('visibilitychange',()=>{if(!this.ctx)return;if(document.hidden){for(const s of this.sources)s.stop();this.stopSustains();this.encounterAudio?.silence();this.motionAudio?.silence();this.physicalAudio?.silence();this.engineGain.gain.value=0;void this.ctx.suspend();}else if(this.unlocked)void this.ctx.resume();});
  const button=document.createElement('button');button.textContent='♫ Audio';button.dataset.audioLauncher='';button.className='clickable';button.style.cssText='position:fixed;right:18px;top:157px;z-index:20;padding:7px 12px;background:#263935;color:#e4d5aa;border:1px solid #8a8964;font:15px Pixelify,monospace;cursor:pointer';button.onclick=()=>this.openSettings();document.body.appendChild(button);
 }
 openSettings(){if(document.pointerLockElement)document.exitPointerLock();void this.unlock();this.showSettings();}
 async unlock(){if(!this.ctx){
  const c=this.ctx=new AudioContext();this.master=c.createGain();this.music=c.createGain();this.musicDuck=c.createGain();this.fx=c.createGain();
  const limiter=c.createDynamicsCompressor();limiter.threshold.value=-3;limiter.knee.value=3;limiter.ratio.value=16;limiter.attack.value=.002;limiter.release.value=.16;
  const low=c.createBiquadFilter();low.type='highpass';low.frequency.value=28;const top=c.createBiquadFilter();top.type='lowpass';top.frequency.value=13500;
  const safety=c.createWaveShaper(),curve=new Float32Array(4097);
  // Preserve ordinary transients; a soft knee bounds even overlapping explosions.
  for(let i=0;i<curve.length;i++){const x=i*2/(curve.length-1)-1,a=Math.abs(x);curve[i]=Math.sign(x)*(a<=.65?a:.65+.25*Math.tanh((a-.65)/.25));}
  safety.curve=curve;safety.oversample='2x';
  this.master.connect(low);low.connect(top);top.connect(limiter);limiter.connect(safety);safety.connect(c.destination);
  this.narrationAudio=new NarrationAudio(c,this.master);
  this.music.connect(this.musicDuck);this.musicDuck.connect(this.master);
  this.fallbackMusic=c.createGain();this.fallbackMusic.connect(this.music);this.locationMusic=new LocationMusic(c,this.music);
  // Combat glue, with a duck in front of it so warnings and stings can open a hole in the noise.
  const combatBus=c.createDynamicsCompressor();combatBus.threshold.value=-10;combatBus.knee.value=8;combatBus.ratio.value=2.4;combatBus.attack.value=.016;combatBus.release.value=.12;
  this.combatDuck=c.createGain();this.fx.connect(this.combatDuck);this.combatDuck.connect(combatBus);combatBus.connect(this.master);
  // The alert path: its own effects-level gain and a gentle limiter, never ducked by anything but mute.
  this.alerts=c.createGain();this.alertLevel=c.createGain();
  const alertBus=c.createDynamicsCompressor();alertBus.threshold.value=-6;alertBus.knee.value=6;alertBus.ratio.value=4;alertBus.attack.value=.004;alertBus.release.value=.14;
  this.alerts.connect(this.alertLevel);this.alertLevel.connect(alertBus);alertBus.connect(this.master);
  for(const name of MIX_CHANNELS){if(name==='alerts')continue;const channel=c.createGain(),presence=c.createGain();presence.gain.value=PHYSICAL_MIX_GAIN[name];channel.connect(presence);this.channelReturns[name]=presence;
   if(name==='ambience'){const shelf=c.createBiquadFilter(),air=c.createBiquadFilter();shelf.type='highshelf';shelf.frequency.value=4800;shelf.gain.value=-5;air.type='lowpass';air.frequency.value=7800;air.Q.value=.4;presence.connect(shelf);shelf.connect(air);air.connect(this.fx);}
   else presence.connect(this.fx);this.channels[name]=channel;
  }
  this.bedBus=c.createGain();this.bedBus.gain.value=1;this.bedBus.connect(this.channels.ambience);
  // Post-slider weapon/impact sends. The return never feeds itself or adds echoes to the UI/engine.
  this.acousticSpace=new AcousticSpace(c,this.fx);
  this.channelReturns.weapons.connect(this.acousticSpace.input);this.channelReturns.impacts.connect(this.acousticSpace.input);
  this.encounterAudio=new EncounterAudio(c,this.channels.impacts,this.channels.ui);
  this.engineGain=c.createGain();this.engineGain.gain.value=0;this.engineFilter=c.createBiquadFilter();this.engineFilter.type='lowpass';this.engineFilter.frequency.value=400;this.engineFilter.Q.value=.5;this.engineFilter.connect(this.engineGain);this.engineGain.connect(this.channels.engines);
  this.engineFallback=c.createGain();this.engineFallback.connect(this.engineFilter);this.engineTone=c.createOscillator();this.engineTone.type='triangle';this.engineTone.connect(this.engineFallback);this.engineTone.start();this.engineHarmonic=c.createOscillator();this.engineHarmonic.type='sine';const harmonic=c.createGain();harmonic.gain.value=.36;this.engineHarmonic.connect(harmonic);harmonic.connect(this.engineFallback);this.engineHarmonic.start();
  const noise=c.createBuffer(1,c.sampleRate*2,c.sampleRate),pcm=noise.getChannelData(0);let n=39,l=0;for(let i=0;i<pcm.length;i++){n=(Math.imul(n,1664525)+1013904223)>>>0;l=.97*l+.03*(n/4294967296*2-1);pcm[i]=l*4;}this.engineNoise=c.createBufferSource();this.engineNoise.buffer=noise;this.engineNoise.loop=true;const noiseGain=c.createGain();noiseGain.gain.value=.8;this.engineNoise.connect(noiseGain);noiseGain.connect(this.engineFallback);this.engineNoise.start();
  this.ambientGain=c.createGain();this.ambientGain.gain.value=0;this.ambientFilter=c.createBiquadFilter();this.ambientFilter.type='lowpass';this.ambientFilter.Q.value=.4;this.engineNoise.connect(this.ambientFilter);this.ambientFilter.connect(this.ambientGain);this.ambientGain.connect(this.channels.ambience);
  this.planetAmbience=new PlanetAmbience(c,this.channels.ambience);
  this.motionAudio=new MotionAudio(c,this.channels.engines,this.channels.ambience,this.channels.impacts,this.music);
  this.physicalAudio=new PhysicalAudio(c,this.channels.engines,this.channels.impacts,this.channels.weapons);
  this.buildBeds();this.bindInterface();
  this.nextBeat=c.currentTime+.12;this.timer=window.setInterval(()=>this.schedule(),25);this.applySettings();
 }
 this.unlocked=true;await this.ctx.resume();this.recordingLoad??=this.loadRecordings();}
 private async decodeRecording(name:string):Promise<AudioBuffer|null>{
  // Versioned directory prevents a stale cached generated shot masking the new bank.
  // Extra physical variants fall back to an existing generated take, never a missing -3 file.
  const family=name.replace(/-\d+$/,''),index=Number(name.match(/-(\d+)$/)?.[1]??0),fallback=PHYSICAL_AUDIO.has(name)?`${family}-${index%(GENERATED_VOICE_COUNTS[family as VoiceKind]??1)}`:name;
  for(const path of [...(FIELD_AUDIO.has(name)?[`audio/${FIELD_AUDIO_REVISION}/${name}.ogg`]:[]),...(REACTION_VOICE_COUNTS[family as VoiceKind]?[`audio/reactions-v1/${name}.ogg`]:[]),...(PHYSICAL_AUDIO.has(name)?[`audio/${PHYSICAL_AUDIO_REVISION}/${name}.ogg`]:[]),...(PRODUCTION_AUDIO.has(fallback)?[`audio/production/${fallback}.ogg`]:[]),...(CONTEXT_VOICES.has(family)?[`audio/context/${fallback}.ogg`]:[]),...(REFINED_VOICES.has(family)?[`audio/refined/${fallback}.ogg`]:[]),`audio/sa3/${fallback}.ogg`,`audio/${fallback}.ogg`]){
   try{const response=await fetch(new URL(path,document.baseURI));if(response.ok)return await this.ctx!.decodeAudioData(await response.arrayBuffer());}catch{}
  }
  return null;
 }
 private async loadRecordings(){
  await Promise.all(Object.entries({...GENERATED_VOICE_COUNTS,...PHYSICAL_VOICE_COUNTS,...REACTION_VOICE_COUNTS,...FIELD_VOICE_COUNTS}).map(async ([name,count])=>{
   const kind=name as VoiceKind;
   const loaded=await Promise.all(Array.from({length:count},(_,i)=>this.decodeRecording(`${kind}-${i}`)));
   const buffers=loaded.filter((b):b is AudioBuffer=>b!==null);
   if(buffers.length)this.recordings.set(kind,buffers);
  }));
  await Promise.all([this.loadEngines(),this.planetAmbience.load(name=>this.decodeRecording(name)),this.physicalAudio.load()]);
 }
 async ready(){await this.unlock();await this.recordingLoad;}
 private async loadEngines(){
  const c=this.ctx!;
  await Promise.all(['rebuilt','azure','vulcan','boost'].map(async id=>{
   const buffer=await this.decodeRecording(`engine-${id}`);if(!buffer)return;
   const source=c.createBufferSource(),gain=c.createGain();source.buffer=buffer;source.loop=true;gain.gain.value=0;
   source.connect(gain);gain.connect(this.engineFilter);source.start();this.engineLayers.set(id,{source,gain});
  }));
  this.beamBuffer=await this.decodeRecording('beam-loop');this.chargeBuffer=await this.decodeRecording('charge-loop');
  if(this.engineLayers.has('rebuilt'))this.engineFallback.gain.setTargetAtTime(0,c.currentTime,.3);
 }
 setSettings(patch:Partial<typeof this.settings>){Object.assign(this.settings,patch);this.clampSettings();this.applySettings();}
 private applySettings(){
  localStorage.setItem('starweave_audio',JSON.stringify(this.settings));if(!this.ctx)return;
  const t=this.ctx.currentTime,fade=(param:AudioParam,target:number,seconds=.035)=>{param.cancelAndHoldAtTime(t);param.linearRampToValueAtTime(target,t+seconds);};
  // A fixed end time also silences dormant channels before their next transient.
  fade(this.master.gain,this.settings.muted?0:this.settings.master,.03);
  fade(this.music.gain,this.settings.music,.08);fade(this.fx.gain,this.settings.effects);
  fade(this.alertLevel.gain,this.settings.muted?0:this.settings.effects*this.settings.alerts);
  for(const [name,channel]of Object.entries(this.channels))fade(channel.gain,this.settings[name as Exclude<MixChannel,'alerts'>]);
 }
 private event(id:string){this.events[id]=(this.events[id]??0)+1;}
 private position(p:SoundPosition){const d=Math.max(0,p.distance??0),space=this.scene==='space',range=space?130:18;return {level:(p.enemy?.7:1)/(1+(d/range)**1.65),cutoff:p.underwater?1350:Math.max(900,12500/(1+d/(space?130:25))),pan:Math.max(-.85,Math.min(.85,p.pan??0))};}
 private play(kind:VoiceKind,volume=.5,p:SoundPosition={},bus?:GainNode,at?:number,priority=false){
  const c=this.ctx;if(!c||c.state!=='running'||this.settings.muted)return;
  // Reserve room for player transients even in a fleet firefight.
  if(this.sources.size>=(p.enemy?18:36)){
   if(priority&&!p.enemy){const oldest=this.sources.values().next().value;if(oldest){oldest.stop();this.sources.delete(oldest);}}
   else {this.suppressed++;return;}
  }
  const recorded=this.recordings.get(kind)??(kind==='rotary'?this.recordings.get('lmg'):undefined),variant=this.recordingTurns.get(kind)??0;
  let take=recorded?0:(variant+1)%6;if(recorded&&recorded.length>1){const next=1+Math.floor(Math.random()*(recorded.length-1));take=(variant+next)%recorded.length;}this.recordingTurns.set(kind,take);this.serial++;
  const key=kind+variant;let buffer=recorded?.[take]??this.samples.get(key);if(!buffer){const pcm=synthVoice(kind,variant,c.sampleRate);buffer=c.createBuffer(1,pcm.length,c.sampleRate);buffer.getChannelData(0).set(pcm);this.samples.set(key,buffer);}
  const source=c.createBufferSource(),gain=c.createGain(),filter=c.createBiquadFilter(),pan=c.createStereoPanner(),pos=this.position(p),t=at??c.currentTime;
  source.buffer=buffer;source.playbackRate.value=(p.pitch??1)*(1+(Math.random()*2-1)*(PHYSICAL_VOICE_COUNTS[kind]?.018:.035));gain.gain.value=volume*pos.level*(.94+Math.random()*.12)*(bus===this.alerts&&UI_VOICES.has(kind)?this.settings.ui:1);filter.type='lowpass';filter.frequency.value=pos.cutoff;pan.pan.value=pos.pan;
  source.connect(filter);filter.connect(gain);gain.connect(pan);pan.connect(bus??this.channels[WEAPON_VOICES.has(kind)?'weapons':UI_VOICES.has(kind)?'ui':'impacts']);this.sources.add(source);this.event('played:'+kind);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();pan.disconnect();this.sources.delete(source);};source.start(t);
 }
 private allowed(key:string,seconds:number){const t=this.ctx?.currentTime??0,previous=this.last.get(key)??-Infinity;if(t-previous<seconds){this.suppressed++;return false;}this.last.set(key,t);return true;}
 private sustain(key:string,freq:number,volume:number,p:SoundPosition={},charge=false){const c=this.ctx;if(!c||c.state!=='running'||this.settings.muted)return;let s=this.sustains.get(key);
  if(!s){if(this.sustains.size>=8)return;const recorded=charge?this.chargeBuffer:this.beamBuffer,osc:OscillatorNode|AudioBufferSourceNode=recorded?c.createBufferSource():c.createOscillator(),gain=c.createGain(),filter=c.createBiquadFilter(),panner=c.createStereoPanner();if(osc instanceof AudioBufferSourceNode){osc.buffer=recorded;osc.loop=true;}else osc.type=charge?'sine':'triangle';filter.type='lowpass';filter.Q.value=.7;gain.gain.value=0;osc.connect(filter);filter.connect(gain);gain.connect(panner);panner.connect(this.channels.weapons);osc.start();s={osc,gain,filter,panner,expires:0};this.sustains.set(key,s);}
  const pos=this.position(p),t=c.currentTime;s.expires=t+.14;if(s.osc instanceof OscillatorNode)s.osc.frequency.setTargetAtTime(freq,t,.035);else s.osc.playbackRate.setTargetAtTime(charge?.8+Math.max(0,Math.min(1,(freq-125)/780))*.4:freq/112,t,.035);s.filter.frequency.setTargetAtTime(Math.min(pos.cutoff,charge?2600:3400),t,.04);s.panner.pan.setTargetAtTime(pos.pan,t,.035);s.gain.gain.setTargetAtTime(volume*pos.level,t,.025);
 }
 private stopSustains(){for(const [key,s]of this.sustains){s.osc.stop();s.osc.disconnect();s.gain.disconnect();s.filter.disconnect();s.panner.disconnect();this.sustains.delete(key);}}
 /** Rock cutter hum while the beam is cutting: the beam loop sustain, keyed apart from weapons. */
 cutterHum(p:SoundPosition={}){if(!this.settings.muted){this.motionAudio?.cut(p);this.physicalAudio?.cut(p);}}
 weapon(item:AudioWeapon,space=true,p:SoundPosition={}){
  const id=item.basePartId??item.id??item.archetype??'rifle';this.event('weapon');this.event(id);this.dangerUntil=performance.now()+6500;const kind=weaponVoice(item,space),components=item.tuning?.components;
  const weight=components?.core==='overdrive_core'?1.08:components?.core==='efficient_core'?.94:1;
  if(kind==='beam'){const key='beam:'+(p.voice??id)+(p.enemy?':enemy':':player');if(!this.sustains.has(key))this.play('pulse',.16,p);this.sustain(key,112+(components?.core==='overdrive_core'?15:0),.4*weight,p);return;}
  if(!this.allowed('shot:'+kind+(p.enemy?':enemy':':player'),p.enemy?.045:.012))return;
  // The player's own gun on foot sits a step above everything else in the mix: it is the sound the
  // whole fight is felt through. Ship guns and enemy fire keep their levels.
  const onFoot=!space&&!p.enemy,report=onFoot?ON_FOOT_REPORT_GAIN:1;
  const level=(kind==='suppressed'?.3:kind==='bow'?.45:kind==='rail'?.8:kind==='plasma'?.72:kind==='shotgun'?.68:space?.6:.59)*weight*(kind==='suppressed'||kind==='bow'?1:report);
  this.play(kind,level,p,undefined,undefined,onFoot);
  if(!this.settings.muted)this.physicalAudio?.weapon(kind,p);
  if(!this.settings.muted)this.motionAudio?.combatBeat(kind==='shotgun'||kind==='rail'||kind==='sniper'?.85:.35);
  if(!space&&p.enemy&&p.actorFrame&&!this.settings.muted&&this.allowed('attack-reaction:'+p.actorFrame,.8))
   this.encounterAudio?.reaction(p.actorFrame==='mech'?'mech':p.actorFrame==='void'?'creature':'human','attack',p);
  // Recorded gun reports carry the identity; these quiet layers restore the
  // pressure wave, room/landscape response and action movement that a single
  // mono source cannot describe. Rapid weapons gate tails and mechanisms
  // independently, keeping automatic fire dense without runaway polyphony.
  const ballistic=['rifle','pistol','smg','lmg','rotary','shotgun','sniper'].includes(kind);
  if(ballistic&&kind!=='suppressed'&&this.ctx){
   const heavy=kind==='shotgun'||kind==='sniper',automatic=kind==='smg'||kind==='lmg'||kind==='rotary',t=this.ctx.currentTime;
   this.play('gunCrack',(heavy?.25:automatic?.13:.18)*weight*report,{...p,pitch:(p.pitch??1)*(heavy?.9:automatic?1.08:1)},undefined,t+.001);
   // Sub-bass thump under the player's own report: the chest punch a recording alone lacks.
   if(onFoot&&this.allowed('gun-kick',automatic?.05:.03))
    this.play('kick',(heavy?.62:automatic?.34:.46)*weight,{...p,pitch:(p.pitch??1)*(heavy?.82:automatic?1.1:.95)},undefined,t);
   if(this.allowed('gun-tail:'+(p.enemy?'enemy':'player'),this.scene==='dungeon'?.055:.09))
    this.play('gunTail',(this.scene==='dungeon'?.16:.1)*(heavy?1.25:1)*weight,{...p,pitch:(p.pitch??1)*(this.scene==='dungeon'?.82:1)},undefined,t+.016);
   if(!automatic&&this.allowed('gun-action:'+(p.enemy?'enemy':'player'),.075))
    this.play('gunMechanism',(heavy?.16:.11)*weight,{...p,pitch:(p.pitch??1)*(kind==='shotgun'?.78:1.05)},undefined,t+(kind==='shotgun'?.09:.058));
  }
 }
 charge(item:AudioWeapon,progress:number,p:SoundPosition={}){if(progress<=0||progress>=1)return;this.sustain('charge:'+(p.voice??item.id??item.archetype??'weapon'),125+Math.min(1,progress)**2*780,.045+progress*.035,p,true);}
 reload(item:AudioWeapon,phase:number){if(phase<0)return;const family=weaponVoice(item,false);this.event('reload:'+family+':'+phase);
  if(family==='bow'){if(phase===2)this.play('nock',.34);return;}
  if(family==='arc'||family==='plasma'){if(phase===0||phase===2)this.play('cell',.32);if(phase===3)this.play('bolt',.2);return;}
  // Pump/break shotguns rack shells; the rotary and belt-fed spin up before they seat a fresh belt.
  if(family==='shotgun'){if(phase===0)this.play('eject',.3);if(phase===2)this.play('shellRack',.5);if(phase===3)this.play('shellRack',.42);return;}
  if(family==='rotary'||family==='lmg'){if(phase===0)this.play('spinUp',.4);if(phase===2)this.play('insert',.5);if(phase===3)this.play('bolt',.42);return;}
  if(phase===0)this.play('eject',.36);if(phase===2)this.play('insert',.48);if(phase===3)this.play('bolt',.4);
 }
 impact(kind:'armor'|'shield'|'body'|'stone',p:SoundPosition={}){this.event('impact:'+kind);if(kind!=='stone')this.dangerUntil=performance.now()+6500;if(!this.allowed('impact:'+kind,p.enemy?.07:.038))return;
  if(!this.settings.muted)this.physicalAudio?.impact(kind,p);
  const c=this.ctx;this.play(kind,kind==='body'?.25:kind==='armor'?.34:.4,p);
  if(kind==='body'&&c)this.play('fleshImpact',.18,p,undefined,c.currentTime+.009);
  else if(kind==='armor'&&c)this.play('metalImpact',.16,p,undefined,c.currentTime+.006);
 }
 /** Every named beat in the game routes through here; `CUES` owns the voice, the level and the gate. */
 cue(id:string,p:SoundPosition={}){
  this.event(id);
  if(DANGER_CUES.has(id))this.dangerUntil=performance.now()+6500;
  const spec=CUES[id]??{kind:'refit' as VoiceKind,volume:.42,gate:.045};
  if(!this.allowed('cue:'+id+(id==='missile'?(p.enemy?':external':':player'):''),spec.gate))return;
  if(!this.settings.muted&&(id==='rock_crack'||id==='rock_fall')){this.motionAudio?.fracture(id==='rock_fall',p);this.physicalAudio?.fracture(id==='rock_fall',p);}
  if(!this.settings.muted&&['explosion','missile_impact','boss_crash','arc_blast'].includes(id))this.physicalAudio?.blast(p);
  if(spec.alert!==undefined){
   // Warnings and stings open a hole in the combat bus rather than fighting it for level.
   const calm=this.calm;
   this.duck(calm?Math.min(1,spec.alert+.2):spec.alert,id.startsWith('arrival_')||id==='wave_contact'?2.8:1.1);
   this.play(spec.kind,spec.volume*(calm?.85:1),{...p,pitch:(p.pitch??1)*(spec.pitch??1)},this.alerts,undefined,true);
   return;
  }
  this.play(spec.kind,spec.volume,{...p,pitch:(p.pitch??1)*(spec.pitch??1)},undefined,undefined,(id==='missile'||id==='missile_launch')&&!p.enemy);
 }
 /** Warnings and stings pull the combat bus down for a moment instead of shouting over it. */
 private duck(depth:number,seconds:number){
  const c=this.ctx;if(!c||!this.combatDuck)return;const t=c.currentTime;
  this.duckDepth=Math.min(this.duckDepth,depth);this.duckUntil=Math.max(this.duckUntil,t+seconds);
  this.combatDuck.gain.cancelScheduledValues(t);this.combatDuck.gain.setTargetAtTime(this.duckDepth,t,.045);
 }
 // ---- 1 · arrival warnings ------------------------------------------------
 /** A wave announces itself before it exists: one family-readable swell, panned to its bearing. */
 arrivalWarning(family:ArrivalFamily,bearing=0,p:SoundPosition={}){
  this.event('warning:'+family);
  this.cue('arrival_'+family,{...p,pan:p.pan??Math.max(-.85,Math.min(.85,Math.sin(bearing)))});
 }
 /** The wave actually lands: the town's contact horn, on the same bearing. */
 waveContact(bearing=0,p:SoundPosition={}){this.cue('wave_contact',{...p,pan:p.pan??Math.max(-.85,Math.min(.85,Math.sin(bearing)))});}
 // ---- 2 · missiles --------------------------------------------------------
 /** A ripple is one thump per round, each a touch higher than the last; a gap resets the salvo. */
 missileLaunch(p:SoundPosition={}){
  const t=this.ctx?.currentTime??0;
  this.ripple.index=t-this.ripple.at<.55?Math.min(7,this.ripple.index+1):0;this.ripple.at=t;
  this.cue('missile_launch',{...p,pitch:(p.pitch??1)*(1+this.ripple.index*.045)});
  this.play('missile',.3,{...p,pitch:(p.pitch??1)*(.9+this.ripple.index*.03)});
 }
 /**
  * A missile in flight: its motor loops, pitched by how fast it is closing, and the first time one
  * passes close by it leaves a whoosh. Called every frame per missile; silence retires the voice.
  */
 missileFlight(id:string,distance:number,closing=0,pan=0){
  const c=this.ctx;if(!c)return;
  const seen=this.flights.get(id),previous=seen?.distance??distance;
  this.flights.set(id,{distance,near:seen?.near===true,seen:c.currentTime});
  if(distance>420)return;
  const rate=Math.max(.72,Math.min(1.34,1+Math.max(-150,Math.min(150,closing))/430));
  this.loop('flight:'+id,'flight',(this.calm?.26:.34)/(1+(distance/120)**1.4),rate,pan,Math.max(1200,9000/(1+distance/140)));
  if(!seen?.near&&distance<24&&distance<previous){this.flights.get(id)!.near=true;this.cue('missile_near',{pan,distance});}
 }
 missileImpact(p:SoundPosition={}){this.cue('missile_impact',p);}
 /** The inbound-missile tone: the one sound that has to cut through a firefight. */
 missileWarning(p:SoundPosition={}){this.cue('missile_warning',p);}
 // ---- 3 · combat roll -----------------------------------------------------
 /** The tuck whips cloth; the landing thud is scheduled where the roll actually ends. */
 roll(seconds=.45,p:SoundPosition={}){
  this.cue('roll_whip',p);
  const c=this.ctx;if(!c||c.state!=='running')return;
  this.event('roll_land');this.play('landThud',.4,p,undefined,c.currentTime+Math.max(.15,Math.min(1,seconds)));
 }
 /** The i-frame reward: a hit that was avoided has to be audible, or it reads as a bug. */
 dodgeChime(p:SoundPosition={}){this.cue('dodge_chime',p);}
 // ---- 4 · held objectives -------------------------------------------------
 /** One work loop per device, rising with progress. Contested work grinds instead of singing. */
 objectiveWork(id:string,progress:number,contested=false,p:SoundPosition={}){
  const k=Math.max(0,Math.min(1,progress));this.event('objective_work');
  this.loop('work:'+id,'work',(.15+k*.22)*(contested?.78:1)*(this.calm?.85:1),.82+k*.5,p.pan??0,900+k*2600);
 }
 objectiveComplete(p:SoundPosition={}){this.cue('objective_done',p);}
 objectiveProvoke(p:SoundPosition={}){this.cue('objective_provoke',p);}
 // ---- 5 · guardian and captain -------------------------------------------
 /** The named body in the room. A human captain shouts; anything else roars. */
 bossBeat(beat:'phase'|'charge'|'death',human=false,p:SoundPosition={}){
  this.event('boss:'+beat+(human?':captain':':guardian'));
  this.cue(beat==='charge'?'boss_charge':beat==='death'?'boss_crash':human?'captain_phase':'boss_phase',p);
 }
 // ---- 6/7 · places --------------------------------------------------------
 /** The surface town bed: wind and market by day, crickets at night. Refresh it every frame. */
 surfaceAmbience(level:number,night=false){
  const c=this.ctx;if(!c)return;
  this.bedNight=night;this.bedSeen=c.currentTime;
  this.bedTown=Math.max(0,Math.min(1,level));
 }
 /** The base deck: the welder in the repair berth, and the open radio channel beside it. */
 baseCue(id:'weld'|'radio',p:SoundPosition={}){this.cue('base_'+id,p);}
 // ---- 8 · interface -------------------------------------------------------
 ui(id:'focus'|'confirm'|'purchase'|'reveal'|'rebind'){this.cue('ui_'+id);if(!this.settings.muted&&this.allowed('ui-detail',.065))this.encounterAudio?.ui(id);}
 /**
  * The boards, the debrief and the rebind list are plain DOM the audio module does not own, so the
  * chrome sounds bind once here by data attribute instead of threading a call into every panel.
  */
 private bindInterface(){
  if(this.uiBound||typeof document==='undefined')return;this.uiBound=true;
  const FOCUS='[data-board-job] button,[data-board-refresh],[data-xb-pick],[data-xb-diff],[data-xb-count],[data-xb-focus],[data-xb-slot],[data-xb-gear-tab],[data-xb-preset]';
  const CONFIRM='[data-xb-deploy],[data-xb-prep],[data-board-accept],[data-board-claim],[data-xb-another],[data-xb-defend]';
  document.addEventListener('focusin',e=>{if((e.target as Element|null)?.closest?.(FOCUS))this.ui('focus');});
  document.addEventListener('pointerdown',e=>{
   const el=e.target as Element|null;if(!el?.closest)return;
   if(el.closest('[data-rebind],[data-binding],[data-controls-device],[data-key-context],[data-reset-keys],[data-reset-layout]'))this.ui('rebind');
   else if(el.closest('[data-xb-aspire]'))this.ui('purchase');
   else if(el.closest(CONFIRM))this.ui('confirm');
   else if(el.closest(FOCUS))this.ui('focus');
  },true);
  // The debrief and the expedition report arrive as fresh DOM, so the reveal follows the panel, not a click.
  try{
   new MutationObserver(records=>{
    for(const r of records)for(const node of r.addedNodes)
     if(node instanceof HTMLElement&&(node.matches('.xb-result,[data-rescue-face]')||node.querySelector('.xb-result,[data-rescue-face]'))){this.ui('reveal');return;}
   }).observe(document.body,{childList:true,subtree:true});
  }catch{}
 }
 // ---- beds and loop voices ------------------------------------------------
 /**
  * A seamless bed. The last `fade` samples are crossfaded back over the first, and every modulator
  * period divides the buffer length, so the loop point is not a click and not a pulse.
  */
 private bedPcm(kind:BedKind,rate:number,seconds:number):Float32Array {
  const len=Math.round(seconds*rate),fade=Math.round(Math.min(.15,seconds*.06)*rate),raw=new Float32Array(len+fade);
  let seed=(0x51ed+BED_KINDS.indexOf(kind)*7919)>>>0;
  const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
  const wrap=(hz:number)=>{const f=Math.max(1,Math.round(hz*seconds))/seconds;return (t:number)=>.5+.5*Math.sin(2*Math.PI*f*t);};
  const layer=(gain:number,cutoff:number,highpass:number,mod:(t:number)=>number=()=>1)=>{
   let lp=0,hp=0;const kl=1-Math.exp(-2*Math.PI*cutoff/rate),kh=1-Math.exp(-2*Math.PI*highpass/rate);
   for(let i=0;i<raw.length;i++){const n=rand();lp+=kl*(n-lp);hp+=kh*(lp-hp);raw[i]+=(lp-hp)*gain*mod(i/rate);}
  };
  const tone=(gain:number,hz:number,mod:(t:number)=>number=()=>1)=>{
   const f=Math.max(1,Math.round(hz*seconds))/seconds;
   for(let i=0;i<raw.length;i++){const t=i/rate;raw[i]+=Math.sin(2*Math.PI*f*t)*gain*mod(t);}
  };
  const ping=(at:number,gain:number,hz:number,decay:number)=>{
   const start=Math.round(at*rate);
   for(let i=0;i<decay*5*rate&&start+i<raw.length;i++){const t=i/rate;raw[start+i]+=Math.sin(2*Math.PI*hz*t)*gain*Math.exp(-t/decay);}
  };
  if(kind==='hangar'){
   layer(.6,150,16,t=>.72+.28*wrap(.17)(t));            // extractor fans
   tone(.1,47,wrap(.33));tone(.05,71);                  // the plant, two decks down
   layer(.1,1100,300,wrap(.5));                         // distant machinery
   for(let j=0;j<7;j++)ping(.21+j*.83,.1,1250+((j*5)%4)*130,.055);  // condensate on the plates
  }else if(kind==='town'){
   layer(.5,430,26,t=>.5+.5*wrap(.23)(t));              // wind across the flats
   layer(.16,1700,430,wrap(.7));                        // market, too far off to be words
   for(let j=0;j<5;j++)ping(.4+j*1.13,.07,880+((j*7)%5)*120,.05);   // poultry, rope, shutters
  }else if(kind==='night'){
   layer(.14,300,34);
   for(let j=0;j<9;j++)for(let k=0;k<4;k++)ping(.3+j*.63+k*.028,.055,4200+((j*3)%5)*260,.008); // crickets
  }else if(kind==='work'){
   layer(.5,760,120);tone(.3,140);tone(.13,281);        // a cutting rig under load
  }else{
   layer(.6,1700,190);tone(.28,190);tone(.14,95);       // a solid-fuel motor
  }
  let peak=0,mean=0;for(const x of raw){peak=Math.max(peak,Math.abs(x));mean+=x;}mean/=raw.length;
  const scale=.8/Math.max(1e-4,peak),out=new Float32Array(len);
  for(let i=0;i<len;i++)out[i]=(raw[i]-mean)*scale;
  for(let i=0;i<fade;i++){const k=i/fade;out[i]=((raw[i]-mean)*k+(raw[len+i]-mean)*(1-k))*scale;}
  return out;
 }
 private bedBuffer(kind:BedKind):AudioBuffer {
  const c=this.ctx!,cached=this.bedBuffers.get(kind);if(cached)return cached;
  const pcm=this.bedPcm(kind,c.sampleRate,kind==='flight'?.6:kind==='work'?1.5:6);
  const buffer=c.createBuffer(1,pcm.length,c.sampleRate);buffer.getChannelData(0).set(pcm);
  this.bedBuffers.set(kind,buffer);return buffer;
 }
 /** The three place beds run permanently at zero and are faded in by `schedule`. */
 private buildBeds(){
  const c=this.ctx!;
  for(const kind of ['hangar','town','night'] as const){
   const source=c.createBufferSource(),gain=c.createGain(),filter=c.createBiquadFilter();
   source.buffer=this.bedBuffer(kind);source.loop=true;gain.gain.value=0;
   filter.type='lowpass';filter.frequency.value=kind==='night'?9000:5200;filter.Q.value=.4;
   source.connect(filter);filter.connect(gain);gain.connect(this.bedBus);source.start();
   this.bedLayers.set(kind,{source,gain,filter,target:0});
  }
 }
 /** A short-lived looping voice (work rig, missile motor). Re-call it every frame to hold it open. */
 private loop(key:string,kind:BedKind,volume:number,rate:number,pan:number,cutoff:number){
  const c=this.ctx;if(!c||c.state!=='running'||this.settings.muted)return;
  let voice=this.loops.get(key);
  if(!voice){
   if(this.loops.size>=6)return;
   const source=c.createBufferSource(),gain=c.createGain(),filter=c.createBiquadFilter(),panner=c.createStereoPanner();
   source.buffer=this.bedBuffer(kind);source.loop=true;gain.gain.value=0;filter.type='lowpass';filter.Q.value=.6;
   source.connect(filter);filter.connect(gain);gain.connect(panner);panner.connect(this.channels[kind==='flight'?'engines':'ambience']);source.start();
   voice={source,gain,filter,pan:panner,expires:0};this.loops.set(key,voice);this.event('loop:'+kind);
  }
  const t=c.currentTime;voice.expires=t+.2;
  voice.source.playbackRate.setTargetAtTime(rate,t,.05);
  voice.gain.gain.setTargetAtTime(volume,t,.06);
  voice.filter.frequency.setTargetAtTime(cutoff,t,.07);
  voice.pan.pan.setTargetAtTime(Math.max(-.85,Math.min(.85,pan)),t,.06);
 }
 /** Route by body type; human captains never inherit the creature boss roar. */
 enemyReaction(reaction:'hurt'|'death',actor:{frame?:string}|undefined,boss=false,p:SoundPosition={}){
  const family=actor?.frame==='mech'?'mech':actor&&actor.frame!=='void'?'human':'creature';
  this.event('reaction:'+family+':'+reaction);
  if(!this.allowed('reaction:'+family+':'+reaction,reaction==='death'?.045:.13))return;
  if(!this.settings.muted)this.encounterAudio?.reaction(family,reaction,p,boss);
  if(family==='human'){
   this.play(reaction==='death'?'humanDeath':'humanHurt',reaction==='death'?(boss?.72:.6):.45,{...p,enemy:true});
   if(reaction==='death'&&this.ctx){this.play('fleshDeath',boss?.34:.22,{...p,enemy:true,pitch:boss?.82:1},undefined,this.ctx.currentTime+.06);this.play('armor',.2,{...p,enemy:true},undefined,this.ctx.currentTime+.16);}
  }else if(family==='mech'){
   this.play(reaction==='death'?'metalDeath':'metalImpact',reaction==='death'?(boss?.7:.58):.4,{...p,enemy:true,pitch:boss?.76:.9});
   if(reaction==='death'&&this.ctx)this.play('explosion',boss?.24:.14,{...p,enemy:true,pitch:.66},undefined,this.ctx.currentTime+.08);
  }else if(reaction==='hurt')this.cue('enemy_hit',p);
  else {this.cue(boss?'boss_death':'enemy_death',p);if(this.ctx)this.play('fleshDeath',boss?.42:.3,{...p,enemy:true,pitch:boss?.72:.88},undefined,this.ctx.currentTime+.045);}
 }
 /** Player hit confirmation under the reticle marker: a bright tick per landed round, pitched up on a
  * crit; a kill lands lower with a metal knock behind it. Gated so automatic fire stays a patter. */
 hitConfirm(kind:'hit'|'critical'|'kill'){
  this.event('hit-confirm:'+kind);
  if(!this.allowed(kind==='kill'?'hit-confirm:kill':'hit-confirm',kind==='kill'?.06:.05))return;
  this.play('uiCapture',kind==='kill'?.36:kind==='critical'?.32:.26,{pitch:kind==='kill'?.72:kind==='critical'?1.22:1},undefined,undefined,true);
  if(kind==='kill'&&this.ctx)this.play('metalImpact',.28,{pitch:.8},undefined,this.ctx.currentTime+.03);
 }
 /** Layer existing physical recordings; no repeated gunshot or synthetic victory sting. */
 killImpact(surface:'body'|'armor'|'energy',precision:boolean){
  if(!this.allowed('kill-impact',.5))return;this.event('kill-impact');
  const c=this.ctx;if(!c||c.state!=='running'||this.settings.muted)return;
  this.killDuckUntil=c.currentTime+.42;
  this.motionAudio?.combatBeat(1);
  this.play(surface==='energy'?'shield':surface==='armor'?'armor':'body',precision?.52:.42,{pitch:surface==='energy'?.72:.82});
  this.play('explosion',precision?.13:.09,{pitch:.62});
  if(surface==='armor')this.play('armor',.18,{pitch:.68},undefined,c.currentTime+.055);
 }
 dialogueTick(){if(this.allowed('dialogue',.08)){this.event('dialogue');this.play('uiTick',.075);}}
 enemyVoice(state:'idle'|'cautious'|'combat'|'attack'|'arrival',family:'beast'|'insect'|'heavy'|'sentinel'='beast',p:SoundPosition={}){
  const distance=p.distance??0;if(distance>58||!this.allowed('enemyVoice:'+family+':'+state,state==='idle'?1.2:state==='attack'?.22:.45))return;
  this.event('enemy:'+state);this.event('enemy:'+family+':'+state);
  const kind:VoiceKind=state==='arrival'?'arrival':family==='sentinel'?'sentinelCall':state==='idle'?'creatureIdle':state==='cautious'?'creatureAlert':state==='attack'?'creatureAttack':'creatureCombat';
  const pitch=family==='heavy'?.68:family==='insect'?1.55:family==='sentinel'?1.1:1;
  this.play(kind,(state==='idle'?.3:state==='arrival'?.7:.52)*Math.max(.06,1-distance/65),{...p,enemy:true,pitch});
  if(!this.settings.muted)this.encounterAudio?.call(family,state,p);
 }
 setEngine(ids:string[],throttle:number,boost:boolean){this.engineId=ids.filter(Boolean).join('+');this.engineThrottle=Math.max(0,Math.min(1,Math.abs(throttle)));this.engineBoost=boost;this.engineSeen=performance.now();}
 footsteps(scene:string,x:number,z:number,grounded:boolean,running:boolean,surface:FootSurface=scene==='dungeon'?'stone':'soil'){
  const last=this.lastFoot;this.lastFoot={scene,x,z};
  if(!grounded||!last||last.scene!==scene){this.footDistance=0;return;}
  const distance=Math.hypot(x-last.x,z-last.z);if(distance>3){this.footDistance=0;return;}
  this.footDistance+=distance;
  if(this.footDistance>(surface==='water'?2.4:running?4.5:3.2)){
   this.footDistance=0;if(!this.allowed('footfall',running?.24:.32))return;const kind:VoiceKind=scene==='interior'?'stepDeck':surface==='water'?'swim':surface==='sand'?'stepSand':surface==='snow'?'stepSnow':surface==='stone'?'stepStone':'step';
   this.event('footstep');this.event('movement:'+kind);if(kind==='stepDeck')this.event('base_step');this.play(kind,surface==='water'?.26:scene==='dungeon'?.25:.20,{underwater:surface==='water'&&this.environment.underwater});
  }
 }
 setEnvironment(scene:string,environment:AudioEnvironment){this.environmentScene=scene;this.environment=environment;}
 update(scene:string,body:string){this.scene=scene;this.body=body;}
 private musicTone(freq:number,duration:number,volume:number,at:number,attack=.5){
  const c=this.ctx;if(!c||this.voices>=18||this.settings.music===0)return;this.voices++;
  const o=c.createOscillator(),warm=c.createOscillator(),g=c.createGain(),filter=c.createBiquadFilter(),pan=c.createStereoPanner();
  o.type='triangle';o.frequency.value=freq;o.detune.value=-3;warm.type='sine';warm.frequency.value=freq;warm.detune.value=3;
  filter.type='lowpass';filter.frequency.setValueAtTime(freq*2,at);filter.frequency.linearRampToValueAtTime(freq*5,at+duration*.3);filter.frequency.linearRampToValueAtTime(freq*1.5,at+duration);
  pan.pan.value=Math.sin(freq)*.3;g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(volume*.5,at+Math.min(attack,duration*.25));g.gain.setTargetAtTime(0,at+duration*.55,duration*.13);g.gain.linearRampToValueAtTime(0,at+duration);
  o.connect(filter);warm.connect(filter);filter.connect(g);g.connect(pan);pan.connect(this.fallbackMusic);o.start(at);warm.start(at);o.stop(at+duration+.01);warm.stop(at+duration+.01);o.onended=()=>{o.disconnect();warm.disconnect();filter.disconnect();g.disconnect();pan.disconnect();this.voices--;};
 }
 private schedule(){const c=this.ctx;if(!c||c.state!=='running')return;const t=c.currentTime;
  // The ducking bus recovers on its own once nothing is holding it down.
  if(this.duckDepth<1&&t>this.duckUntil){this.duckDepth=1;this.combatDuck.gain.setTargetAtTime(1,t,.22);}
  // Loop voices (work rigs, missile motors) retire the moment their owner stops asking for them.
  for(const [key,v]of this.loops)if(t>v.expires){
   v.gain.gain.setTargetAtTime(0,t,.06);v.source.stop(t+.3);
   v.source.onended=()=>{v.source.disconnect();v.gain.disconnect();v.filter.disconnect();v.pan.disconnect();};
   this.loops.delete(key);
  }
  for(const [id,f]of this.flights)if(t-f.seen>1.2)this.flights.delete(id);
  // Place beds: the hangar follows the scene, the town is pushed by the surface scene each frame.
  const townLive=t-this.bedSeen<.6?this.bedTown:0,calm=this.calm?.72:1;
  for(const [kind,layer]of this.bedLayers){
   // The claim's hangar and the ship's own decks are the two interiors with a machine bed.
   const target=this.settings.muted?0:kind==='hangar'?(this.scene==='home'||this.scene==='interior'?.5:0)
    :kind==='town'?townLive*(this.bedNight?.28:.46):townLive*(this.bedNight?.42:0);
   layer.target=target*calm;
   layer.gain.gain.setTargetAtTime(layer.target,t,.7);
  }
  for(const [key,s]of this.sustains)if(t>s.expires){s.gain.gain.setTargetAtTime(0,t,.035);s.osc.stop(t+.17);s.osc.onended=()=>{s.osc.disconnect();s.gain.disconnect();s.filter.disconnect();s.panner.disconnect();};this.sustains.delete(key);}
  const active=!!this.engineId&&performance.now()-this.engineSeen<350&&(this.scene==='space'||this.scene==='planet'&&this.engineThrottle>0),throttle=active?this.engineThrottle:0;
  const base=this.engineId.includes('vulcan')?37:this.engineId.includes('azure')?69:this.engineId.includes('rebuilt')?47:42;
  const requested=this.engineId.includes('vulcan')?'vulcan':this.engineId.includes('azure')?'azure':'rebuilt',flavor=this.engineLayers.has(requested)?requested:'rebuilt';
  this.engineFallback.gain.setTargetAtTime(this.engineLayers.has(flavor)?0:1,t,.2);
  for(const [id,layer]of this.engineLayers){layer.gain.gain.setTargetAtTime(id==='boost'?(active&&this.engineBoost?.32:0):id===flavor?1:0,t,.3);layer.source.playbackRate.setTargetAtTime(.94+throttle*.16+(active&&this.engineBoost?.04:0),t,.35);}
  // Steady mechanical bed; avoid the rebuilt shuttle's rapid synthetic warble.
  const flutter=Math.sin(t*.7)*.18;
  this.engineTone.frequency.setTargetAtTime(base+throttle*43+flutter+(active&&this.engineBoost?23:0),t,.22);this.engineHarmonic.frequency.setTargetAtTime(base*2.01+throttle*70,t,.3);this.engineFilter.frequency.setTargetAtTime(380+throttle*780+(active&&this.engineBoost?350:0),t,.22);this.engineGain.gain.setTargetAtTime(active?(this.engineLayers.has(flavor)?.09+throttle*.22+(this.engineBoost?.06:0):.014+throttle*.067):0,t,.15);
  this.acousticSpace.update(this.scene,this.environment.underwater,!this.settings.muted);
  const ambient=planetAmbience(this.scene,this.body,this.environmentScene===this.scene?this.environment:{});
  this.planetAmbience.select(this.settings.muted?null:ambient);
  const breeze=this.planetAmbience.has(ambient)?0:this.scene==='planet'?(this.body==='pelagia'?.12:this.body==='sirocco'?.075:.025):this.scene==='dungeon'?.012:0;
  this.ambientFilter.frequency.setTargetAtTime(this.body==='pelagia'?700:this.body==='sirocco'?1800:1100,t,.8);this.ambientGain.gain.setTargetAtTime(breeze*(.68+.32*Math.sin(t*.32)**2),t,.7);
  const environment=this.environmentScene===this.scene?this.environment:{};
  // A fired weapon remains a danger signal even before the scene's hostile scan catches up.
  const combat=(environment.combat===true||performance.now()<this.dangerUntil)&&this.scene!=='title'&&this.scene!=='pause';this.musicDuck.gain.setTargetAtTime(this.briefing?.12:t<this.killDuckUntil?.42:combat?.75:1,t,t<this.killDuckUntil?.025:combat?.08:.8);
  this.motionAudio.update(active,throttle,this.engineBoost,this.scene,combat,!this.settings.muted,this.body);
  this.physicalAudio.update(active,throttle,this.engineBoost,this.scene,environment.underwater===true,!this.settings.muted);
  this.locationMusic.update(this.scene,this.body,environment,combat,!this.settings.muted&&this.settings.music>0);
  this.fallbackMusic.gain.setTargetAtTime(this.locationMusic.active?0:1,t,.7);
  if(this.locationMusic.active)return;
  if(this.nextBeat<t-.3)this.nextBeat=t+.06;
  // Slow harmonic beds instead of an unbroken repeating arcade arpeggio.
  while(this.nextBeat<t+.13){const at=this.nextBeat,i=this.beat++;this.nextBeat+=.5;const root=(this.body==='pelagia'?65.406:this.body==='sirocco'?55:this.scene==='space'?49:58.27)*2**([0,-2,3,-5][Math.floor(i/32)%4]/12);
   if(i%16===0)for(const [j,semitone]of [12,19,26].entries())this.musicTone(root*2**(semitone/12),8,.18/(1+j*.35),at,.6);
   if(i%8===2)this.musicTone(root*2**([24,26,31,28][Math.floor(i/8)%4]/12),2.7,.1,at,.04);
   if(i%16===10)this.musicTone(root*4,2.8,.045,at,.15);
   if(combat&&i%4===0)this.play('kick',.23,{},this.fallbackMusic,at);
   if(combat&&i%8===4)this.musicTone(root,1.1,.11,at,.015);
  }
 }
 snapshot(){return {revision:14,audioPass:5,physical:this.physicalAudio?.snapshot(),mixPresence:PHYSICAL_MIX_GAIN,narration:this.narrationAudio?.snapshot(),acoustics:this.acousticSpace?.snapshot(),encounters:this.encounterAudio?.snapshot(),motion:this.motionAudio?.snapshot(),
  // The sound-pass surface: every cue id the game can name, and the mix nodes that carry them.
  cues:CUE_IDS,beds:BED_KINDS,
  buses:{master:!!this.master,effects:!!this.fx,music:!!this.music,duck:!!this.combatDuck,alert:!!this.alerts,bed:!!this.bedBus,limiter:true},
  ducking:{depth:+(this.duckDepth??1).toFixed(3),active:this.duckDepth<1,holdsFor:+Math.max(0,this.duckUntil-(this.ctx?.currentTime??0)).toFixed(2)},
  bedLevels:Object.fromEntries([...this.bedLayers].map(([k,v])=>[k,+v.target.toFixed(3)])),
  loopVoices:this.loops.size,missilesTracked:this.flights.size,reducedMotion:this.calm,weaponAssetRevision:PHYSICAL_AUDIO_REVISION,score:this.locationMusic?.snapshot(),ambience:this.planetAmbience?.snapshot(),assetRevision:GENERATED_AUDIO_REVISION,beamRecording:!!this.beamBuffer,fieldAssetRevision:FIELD_AUDIO_REVISION,mixerChannels:MIX_CHANNELS,recordedVariants:Object.fromEntries([...this.recordings].map(([kind,clips])=>[kind,clips.length])),engineRecordings:this.engineLayers.size,recordedFamilies:[...this.recordings.keys()],recordedSamples:[...this.recordings.values()].reduce((n,a)=>n+a.length,0),active:this.ctx?.state==='running',scene:this.scene,body:this.body,engine:this.engineId,throttle:this.engineThrottle,voices:this.voices+this.sources.size+this.sustains.size,sampleVoices:this.sources.size,sustainedVoices:this.sustains.size,cachedSamples:this.samples.size,suppressed:this.suppressed,events:{...this.events},settings:{...this.settings},beat:this.beat};}
 private async previewMix(channel:MixChannel){
  await this.ready();
  if(channel==='alerts'){this.cue('wave_contact');return;}
  if(channel==='engines'){const buffer=this.engineLayers.get('rebuilt')?.source.buffer;if(buffer&&this.ctx){const source=this.ctx.createBufferSource(),gain=this.ctx.createGain();source.buffer=buffer;gain.gain.value=.35;source.connect(gain);gain.connect(this.channels.engines);source.start();source.stop(this.ctx.currentTime+1.5);source.onended=()=>{source.disconnect();gain.disconnect();};}return;}
  if(channel==='ambience'){this.planetAmbience.preview();return;}
  const kind=channel==='weapons'?'rifle':channel==='impacts'?'metalImpact':'uiConfirm';this.play(kind,channel==='weapons'?.7:.45,{},this.channels[channel],undefined,true);
 }
 private showSettings(){
  document.querySelector('[data-audio-settings]')?.remove();const previous=document.activeElement as HTMLElement|null;
  const el=document.createElement('div');el.dataset.audioSettings='1';el.setAttribute('role','dialog');el.setAttribute('aria-label','Sound and music');el.setAttribute('aria-modal','true');el.className='clickable ui-scroll';
  el.style.cssText='position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);box-sizing:border-box;width:min(640px,calc(100vw - 32px));max-height:calc(100dvh - 70px);overflow:auto;padding:18px;z-index:6000;background:#12262b;color:#eddfb9;border:2px solid #a18c60;font:18px Pixelify,monospace;box-shadow:0 8px 35px #000c';
  el.innerHTML=`<style>[data-audio-settings] button{font:inherit;color:inherit;background:#1e343b;border:1px solid #607779;padding:10px;cursor:pointer}[data-audio-settings] button:focus-visible{outline:3px solid #e8c775;outline-offset:2px}[data-audio-settings] button:disabled{opacity:.5;cursor:default}[data-audio-settings] [aria-pressed=true]{border-color:#e8c775;background:#494329}[data-audio-settings] .music-choices{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:12px 0}[data-audio-settings] .music-choices button{text-align:left}[data-audio-settings] small{display:block;font:13px/1.4 sans-serif;margin-top:4px;color:#b2c6c6}[data-audio-settings] .audio-levels{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}[data-audio-settings] input[type=range]{width:100%}@media(max-width:460px){[data-audio-settings] .audio-levels{grid-template-columns:1fr}}</style>
  <header style="display:flex;justify-content:space-between;align-items:center"><b>Sound & music</b><button data-close aria-label="Close sound settings">Back</button></header>
  <p style="font:14px/1.5 sans-serif">${MUSIC_LIBRARY.length} songs. Music changes with your surroundings and combat, and rotates between recordings.</p>
  <div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><small>NOW PLAYING</small><span data-now-playing></span></div><button data-music-next>Next track</button></div>

  <div class="audio-levels">${(['master','music','effects',...MIX_CHANNELS] as const).map(k=>`<label>${k[0].toUpperCase()+k.slice(1)}<input aria-label="${k} volume" data-volume="${k}" type="range" min="0" max="1" step=".01" value="${this.settings[k]}"></label>`).join('')}</div><p style="font:14px/1.5 sans-serif">Try a sound while balancing the mix.</p><div class="music-choices">${MIX_CHANNELS.map(k=>`<button data-preview="${k}">${k[0].toUpperCase()+k.slice(1)}</button>`).join('')}</div><label><input type="checkbox" data-mute ${this.settings.muted?'checked':''}> Mute all</label>`;
  const close=()=>{el.remove();if(previous?.isConnected)previous.focus();};
  el.querySelector('[data-close]')!.addEventListener('click',close);
  el.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}if(e.key==='Tab'){const items=[...el.querySelectorAll<HTMLElement>('button,input')],first=items[0],last=items.at(-1);if(e.shiftKey&&document.activeElement===first){last?.focus();e.preventDefault();}else if(!e.shiftKey&&document.activeElement===last){first?.focus();e.preventDefault();}}});
  el.querySelectorAll<HTMLButtonElement>('[data-preview]').forEach(button=>button.onclick=()=>void this.previewMix(button.dataset.preview as MixChannel));
  el.querySelectorAll<HTMLInputElement>('[data-volume]').forEach(input=>input.oninput=()=>this.setSettings({[input.dataset.volume!]:Number(input.value)}));
  el.querySelector<HTMLInputElement>('[data-mute]')!.onchange=e=>this.setSettings({muted:(e.target as HTMLInputElement).checked});

  el.querySelector<HTMLButtonElement>('[data-music-next]')!.onclick=()=>this.locationMusic?.skip();
  const refresh=()=>{const score=this.locationMusic?.snapshot(),label=el.querySelector<HTMLElement>('[data-now-playing]')!,title=score?.title??'Starting music…';if(label.textContent!==title)label.textContent=title;el.querySelector<HTMLButtonElement>('[data-music-next]')!.disabled=!score?.canSkip;};refresh();
  const timer=window.setInterval(()=>{if(!el.isConnected){clearInterval(timer);return;}refresh();},750);
  document.body.appendChild(el);el.querySelector<HTMLButtonElement>('[data-music-next]')?.focus();
 }
}
export const gameAudio=new GameAudio();
