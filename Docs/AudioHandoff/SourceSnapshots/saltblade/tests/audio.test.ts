import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SaltAudio,SOUND_RECIPES,synthesizeSound,renderSoundControls,MAX_SOUND_VOICES} from '../src/platform/audio';
import {Game} from '../src/core/game';
import {view} from '../src/ui/view';
import {EMPTY_INPUT,type GameState,type Platform} from '../src/core/types';

test('every emitted combat cue has distinct non-silent physical variants and clean edges',()=>{
 for(const key of ['slash','heavy','riposte','blade-windup','heavy-windup','enemy-slash','guard','parry','dodge','rune','draw','gun','hit','water','claim','craft','victory','defeat','region'])assert(SOUND_RECIPES[key],key);
 const identities=new Set<string>();
 for(const key of Object.keys(SOUND_RECIPES))for(let variant=0;variant<4;variant++){
  const data=synthesizeSound(key,variant,12000);let energy=0,peak=0;
  for(const sample of data){assert(Number.isFinite(sample));energy+=sample*sample;peak=Math.max(peak,Math.abs(sample));}
  assert(Math.sqrt(energy/data.length)>.008,key+' is audible');assert(peak<=.781,key+' has source headroom');
  assert(Math.abs(data[0])<1e-9);assert(Math.abs(data.at(-1)!)<.003,key+' fades at its edge');
  const hash=createHash('sha256').update(Buffer.from(data.buffer)).digest('hex');assert(!identities.has(hash));identities.add(hash);
 }
 assert.equal(synthesizeSound('unknown',0,12000).length,0);
});

const parameter=()=>({value:0,cancelScheduledValues(){},setTargetAtTime(value:number){this.value=value;}});
let contexts=0;const sources:any[]=[],gains:any[]=[];
const node=()=>({gain:parameter(),frequency:parameter(),pan:parameter(),disconnects:0,connect(to:any){return to;},disconnect(){this.disconnects++;}});
class ContextMock{
 state='running';currentTime=0;sampleRate=12000;destination=node();constructor(){contexts++;}
 createGain(){const n=node();gains.push(n);return n;}createBiquadFilter(){return node();}createWaveShaper(){return node();}createStereoPanner(){return node();}
 createDynamicsCompressor(){return {...node(),threshold:parameter(),knee:parameter(),ratio:parameter(),attack:parameter(),release:parameter()};}
 createAnalyser(){return {...node(),getFloatTimeDomainData(data:Float32Array){data.fill(.01);}};}
 createBuffer(_channels:number,length:number,rate:number){return {duration:length/rate,copyToChannel(){}};}
 createBufferSource(){const n={...node(),onended:null as (()=>void)|null,start(){},stop(){this.onended?.();}};sources.push(n);return n;}
 createMediaStreamDestination(){return {...node(),stream:{audio:true}};}
 async resume(){this.state='running';}async close(){this.state='closed';}
}
const active={mode:'play',panel:'none',paused:false,dialogue:null,run:{phase:'fight'}} as Pick<GameState,'mode'|'panel'|'paused'|'dialogue'|'run'>;
test('trusted unlock, variation, voice bounds, immediate mute/persistence, pause/focus, death and disposal',()=>{
 const storage=new Map<string,string>();Object.assign(globalThis,{AudioContext:ContextMock,localStorage:{getItem:(key:string)=>storage.get(key),setItem:(key:string,value:string)=>storage.set(key,value)}});
 const audio=new SaltAudio();audio.sync(active);audio.unlock({isTrusted:false});assert.equal(contexts,0);audio.unlock({isTrusted:true});assert.equal(contexts,1);
 const variants:number[]=[];for(let i=0;i<8;i++){assert(audio.play('slash'));variants.push(audio.status().variants.slash);sources.at(-1).onended();}
 assert.equal(new Set(variants.slice(0,4)).size,4);assert(variants.every((v,i)=>i===0||v!==variants[i-1]));
 for(const key of ['ui-select','ui-confirm','region','blade-windup','heavy-windup','draw'])for(let i=0;i<3;i++)assert(audio.play(key));
 assert.equal(audio.status().voices,MAX_SOUND_VOICES);assert(audio.play('parry'));assert.equal(audio.status().voices,MAX_SOUND_VOICES);
 assert.equal(audio.play('ui-select'),false);assert.equal(audio.play('missing'),false);assert(audio.recordingStream());
 audio.setEnabled(false);assert.equal(audio.status().voices,0);assert.equal(gains[0].gain.value,0);assert.equal(audio.play('gun'),false);assert.equal(new SaltAudio().enabled,false);
 audio.setEnabled(true);assert(audio.play('gun'));audio.focus(false);assert.equal(audio.status().voices,0);assert.equal(gains[0].gain.value,0);audio.focus(true);assert(audio.play('heavy'));
 audio.sync({...active,panel:'pause',paused:true});assert.equal(audio.status().voices,0);assert.equal(audio.play('slash'),false);assert(audio.play('ui-confirm'));
 audio.sync({...active,paused:true,run:{...active.run,phase:'death'}});audio.sync({...active,paused:true,run:{...active.run,phase:'death'}});assert.equal(audio.status().played.death,1);
 audio.dispose();assert.equal(audio.status().context,'closed');assert.equal(audio.status().voices,0);assert.equal(audio.play('water'),false);assert(sources.every(s=>s.disconnects>0));
});

test('browser title/pause controls reflect mute while shared native markup remains unchanged',()=>{
 const platform:Platform={audio(){},save(){},load:()=>null,render(){},ui(){},readInput:()=>EMPTY_INPUT},game=new Game(platform);
 const native=view(game.state,null);assert(!native.includes('data-action="mute"'));
 const enabled=renderSoundControls(native,true),muted=renderSoundControls(native,false);
 assert.equal((enabled.match(/data-action="mute"/g)||[]).length,1);assert(enabled.includes('aria-pressed="false">Sound on'));assert(muted.includes('aria-pressed="true">Sound off'));
 assert(enabled.startsWith('<button style="position:fixed;'));assert(enabled.includes('top:16px;right:16px;min-width:0;padding:8px 12px;font-size:12px;z-index:20'));
 assert.equal(enabled.slice(enabled.indexOf('<section')),native,'title action layout remains untouched by the corner control');
 game.state.mode='play';game.state.panel='pause';const pause=renderSoundControls(view(game.state,null),false);assert(pause.includes('Sound off'));assert(!pause.includes('position:fixed;'));assert(pause.indexOf('data-action="mute"')>pause.indexOf('class="pause-menu"'));
 game.state.panel='none';assert(!renderSoundControls(view(game.state,null),true).includes('data-action="mute"'));
});
