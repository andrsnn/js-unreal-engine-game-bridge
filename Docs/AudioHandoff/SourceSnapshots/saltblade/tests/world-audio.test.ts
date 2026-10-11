import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WorldAudio,WORLD_SOUNDS,WORLD_VOICE_LIMIT,WORLD_LOOP_LIMIT,worldWaveform,spatialMix,combatEmitter,desertAtmosphere,weatherAudio,shieldSource,dungeonAcoustics} from '../src/world/audio';
import {newWorld,WorldSim,NO_INPUT} from '../src/world/sim';
import {makeFoe} from '../src/world/combat';
import {CAMP,STORM,isSoft,area} from '../src/world/terrain';
import {ROOM_ORIGIN} from '../src/world/dungeon';

test('original world cues have four bounded unique variants; giant attacks carry real low-frequency weight',()=>{
 const ids=new Set<string>();
 for(const cue of Object.keys(WORLD_SOUNDS))for(let variant=0;variant<4;variant++){
  const data=worldWaveform(cue,variant,16000);let energy=0,peak=0;
  for(const value of data){assert(Number.isFinite(value));energy+=value*value;peak=Math.max(peak,Math.abs(value));}
  assert(Math.sqrt(energy/data.length)>.008,cue+' is non-silent');assert(peak<=.781,cue+' retains headroom');assert(Math.abs(data[0])<1e-9);assert(Math.abs(data.at(-1)!)<.003,cue+' ends smoothly');
  const id=createHash('sha256').update(Buffer.from(data.buffer)).digest('hex');assert(!ids.has(id),cue+' has a unique waveform');ids.add(id);
 }
 const giant=worldWaveform('breach',2,16000);let low=0,bright=0;
 for(let i=0;i<16000;i++){low+=giant[i]*Math.sin(2*Math.PI*33*1.009*i/16000);bright+=giant[i]*Math.sin(2*Math.PI*3100*i/16000);}
 assert(Math.abs(low)/16000>.04,'breach has substantial 33 Hz body');assert(Math.abs(low)>Math.abs(bright)*10,'body dominates incidental high noise');
 assert.equal(worldWaveform('unknown',0,16000).length,0);
});

const param=()=>({value:0,cancelScheduledValues(){},setTargetAtTime(value:number){this.value=value;}});
const node=()=>({gain:param(),frequency:param(),pan:param(),delayTime:param(),disconnects:0,connect(to:any){return to;},disconnect(){this.disconnects++;}});
let contexts=0;let clock:ContextMock;const sources:any[]=[],gains:any[]=[];
class ContextMock{
 state='running';currentTime=0;sampleRate=12000;destination=node();constructor(){contexts++;clock=this;}
 createGain(){const n=node();gains.push(n);return n;}createBiquadFilter(){return node();}createWaveShaper(){return node();}createStereoPanner(){return node();}createDelay(){return node();}
 createDynamicsCompressor(){return {...node(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param()};}
 createAnalyser(){return {...node(),getFloatTimeDomainData(values:Float32Array){values.fill(.01);}};}
 createBuffer(_channels:number,length:number,rate:number){return {duration:length/rate,copyToChannel(){}};}
 createBufferSource(){const n={...node(),onended:null as (()=>void)|null,start(){},stop(){this.onended?.();}};sources.push(n);return n;}
 createMediaStreamDestination(){return {...node(),stream:{audio:true}};}async resume(){this.state='running';}async close(){this.state='closed';}
}
function withoutWeather(s:ReturnType<typeof newWorld>){for(const key of ['stormLevel','storm','wind'])delete (s as unknown as Record<string,unknown>)[key];return s;}
function install(){const storage=new Map<string,string>();Object.assign(globalThis,{AudioContext:ContextMock,localStorage:{getItem:(key:string)=>storage.get(key),setItem:(key:string,value:string)=>storage.set(key,value)}});}

test('actual world states drive bounded loops, spatial ship/giant events, eaten/death/map/focus/mute lifecycle',()=>{
 install();const s=newWorld(),audio=new WorldAudio();audio.unlock({isTrusted:false});assert.equal(contexts,0);audio.unlock({isTrusted:true});assert.equal(contexts,1);
 audio.update(s);assert.deepEqual(audio.status().loops.map(x=>x.key),['wind']);assert.equal(audio.play('gunshot',s),false);
 s.mode='fly';s.craft.speed=6;s.craft.z=8;audio.update(s);assert(audio.status().loops.some(x=>x.key==='glide'));
 const variants:number[]=[];for(let i=0;i<8;i++){assert(audio.play('flap',s));variants.push(audio.status().variants.flap);sources.at(-1).onended();}
 assert.equal(new Set(variants.slice(0,4)).size,4);assert(variants.every((v,i)=>i===0||v!==variants[i-1]));
 s.gunships.forEach((g,i)=>Object.assign(g,{state:'hunt',x:s.craft.x+3+i,y:s.craft.y,lightX:s.craft.x+2,lightY:s.craft.y,z:7}));
 Object.assign(s.giant,{state:'track',x:s.craft.x+10,y:s.craft.y,attention:70});audio.update(s);assert.equal(audio.status().loops.length,WORLD_LOOP_LIMIT);
 assert(audio.play('gunshot',s));const shot=sources.at(-1);assert(shot);assert(audio.status().loops.find(x=>x.key==='engine:g1')!.pan>0);
 s.gunships[0].state='eaten';audio.update(s);assert(!audio.status().loops.some(x=>x.key.endsWith(':g1')));
 Object.assign(s.giant,{state:'tremor',breachX:s.craft.x+2,breachY:s.craft.y});assert(audio.play('tremor',s));const tremorGain=gains.at(-1),initial=tremorGain.gain.value;s.craft.x-=30;audio.update(s);assert(tremorGain.gain.value<initial,'a live tail recedes as the listener escapes');s.craft.x+=30;s.giant.state='breach';assert(audio.play('breach',s));s.giant.breachX=s.craft.x+210;assert.equal(audio.play('breach',s),false);
 audio.update(s,{mapOpen:true});assert.equal(audio.status().voices,0);assert.equal(audio.play('flap',s),false);assert.equal(gains[1].gain.value,0);
 audio.update(s,{mapOpen:false});assert(audio.status().loops.length>0);audio.focus(false);assert.equal(audio.status().voices,0);audio.focus(true);audio.update(s);assert(audio.status().loops.length>0);
 audio.setEnabled(false);assert.equal(audio.status().voices,0);assert.equal(new WorldAudio().enabled,false);assert.equal(audio.play('discover',s),false);audio.setEnabled(true);audio.update(s);assert(audio.recordingStream());
 s.dead=3;assert(audio.play('death',s));audio.update(s);assert.equal(audio.status().played.death,1);
 assert.equal(audio.status().loops.length,0);assert.equal(audio.play('gunshot',s),false);assert.equal(audio.play('discover',s),false);
 s.dead=0;audio.update(s);assert(audio.status().loops.length>0);audio.dispose();assert.equal(audio.status().voices,0);assert.equal(audio.status().context,'closed');assert.equal(audio.play('level',s),false);assert(sources.every(x=>x.disconnects>0));
});

test('distance/pan bounds, sparse noise transitions and movement-only steps avoid false stealth cues',()=>{
 const near=spatialMix({x:0,y:0},{x:3,y:0},3,80),far=spatialMix({x:0,y:0},{x:80,y:0},3,80);assert.equal(near.gain,1);assert.equal(far.gain,0);assert(far.lowpass<near.lowpass);assert(near.pan>0);assert(spatialMix({x:0,y:0},{x:0,y:3},3,80).pan<0);
 install();const s=withoutWeather(newWorld()),audio=new WorldAudio();audio.unlock({isTrusted:true});s.noise=100;s.noiseSrc={...CAMP};audio.update(s);assert.equal(audio.status().played['noise-risk']||0,0,'rock noise is acoustically safe');
 let sand={x:250,y:250};for(let x=240;x<280&&!isSoft(sand.x,sand.y);x++)sand={x,y:250};assert(isSoft(sand.x,sand.y));s.noiseSrc=sand;s.noise=61;s.t=1;audio.update(s);assert.equal(audio.status().played['noise-risk'],1);
 s.noise=100;for(let t=2;t<10;t++){s.t=t;audio.update(s);}assert.equal(audio.status().played['noise-risk'],1);s.noise=0;s.t=14;audio.update(s);s.noise=90;s.t=15;audio.update(s);assert.equal(audio.status().played['noise-risk'],2);
 s.player.moving=true;audio.update(s);audio.update(s);assert.equal(audio.status().played['step-rock']||0,0,'blocked feet do not step');for(let i=0;i<3;i++){s.player.x+=.45;audio.update(s);}assert.equal(audio.status().played['step-rock'],1);
 s.player.x=STORM.cx;s.player.y=STORM.cy;audio.update(s);assert.equal(audio.status().storm,1);assert(audio.status().loops.find(x=>x.key==='wind')!.gain>.4);
 for(const cue of ['swing','dodge','chip','land','board','alarm','discover','level'])for(let i=0;i<3;i++)audio.play(cue,s);
 assert(audio.status().voices<=WORLD_VOICE_LIMIT);Object.assign(s.giant,{state:'breach',breachX:s.player.x,breachY:s.player.y});assert(audio.play('breach',s),'high-priority breach preempts a quiet voice at capacity');assert(audio.status().voices<=WORLD_VOICE_LIMIT);audio.dispose();
});

test('real combat cue contract differentiates actions/contacts, suppresses the immediate parry clack and localizes foes',()=>{
 install();const s=newWorld(),fixture={fighter:{act:null as {kind:string}|null},foes:[] as Array<{id:string;x:number;y:number;hp:number;state:string;heavy:boolean}>,fx:[] as Array<{kind:string;x:number;y:number;text?:string}>};Object.assign(s,fixture);const audio=new WorldAudio();audio.unlock({isTrusted:true});
 assert(audio.play('swing',s));fixture.fighter.act={kind:'heavy'};assert(audio.play('swing',s));fixture.fighter.act={kind:'riposte'};assert(audio.play('swing',s));assert.equal(audio.status().played.swing,1);assert.equal(audio.status().played['heavy-swing'],1);assert.equal(audio.status().played['riposte-swing'],1);
 const p=s.player;fixture.fx.push({kind:'spark',x:p.x+3,y:p.y-1},{kind:'text',x:p.x+3,y:p.y-1,text:'2'});assert.deepEqual(combatEmitter('heavy-hit',s),{x:p.x+3,y:p.y-1,z:undefined});assert(audio.play('heavy-hit',s));assert(audio.play('hit',s));assert(audio.play('kill',s));assert(audio.play('hurt',s));
 assert(audio.play('parry',s));assert.equal(audio.play('guard',s),false);assert.equal(audio.status().duplicateGuards,1);clock.currentTime+=.05;assert(audio.play('guard',s),'a later legitimate guard remains audible');
 fixture.fx.push({kind:'slash',x:p.x-4,y:p.y+1});assert.deepEqual(combatEmitter('enemy-swing',s),{x:p.x-4,y:p.y+1,z:undefined});assert(audio.play('enemy-swing',s));fixture.fx.push({kind:'text',x:p.x+5,y:p.y,text:'!'});assert(audio.play('alert',s));
 fixture.foes.push({id:'real-foe',x:p.x+2,y:p.y,hp:5,state:'windup',heavy:false});audio.update(s);audio.update(s);assert.equal(audio.status().played['enemy-windup'],1,'one cue per actual windup transition');fixture.foes[0].state='recover';audio.update(s);fixture.foes[0].state='windup';fixture.foes[0].heavy=true;audio.update(s);assert.equal(audio.status().played['enemy-heavy-windup'],1);
 fixture.foes[0].state='recover';audio.update(s);fixture.foes[0].state='windup';fixture.foes[0].x=p.x+90;audio.update(s);assert.equal(audio.status().played['enemy-heavy-windup'],1,'distant enemies stay silent');
 audio.update(s,{mapOpen:true});assert.equal(audio.play('hit',s),false);audio.setEnabled(false);assert.equal(audio.play('parry',s),false);audio.dispose();
});

test('actual dungeon contract replaces outdoor observers, articulates real room choices and restores desert acoustics',()=>{
 install();const s=newWorld(),dungeon={id:'real-vault',depth:0,plan:{w:11,h:11},offer:null as unknown[]|null,cleared:false,done:false};
 const fixture={mode:'dungeon',dungeon,foes:[] as Array<{id:string;kind:string;x:number;y:number;hp:number;state:string;heavy:boolean}>,fx:[] as Array<{kind:string;x:number;y:number;text?:string;life?:number;max?:number}>};Object.assign(s,fixture);
 const p=s.player;Object.assign(p,{x:2005,y:2008});s.noise=100;s.noiseSrc={x:p.x,y:p.y};Object.assign(s.giant,{state:'tremor',breachX:p.x,breachY:p.y});
 Object.assign(s.gunships[0],{state:'hunt',x:p.x+2,y:p.y,z:7,lightX:p.x,lightY:p.y});
 const audio=new WorldAudio();audio.unlock({isTrusted:true});assert(audio.play('descend',s));audio.update(s);
 assert.equal(audio.status().acoustics,'dungeon');assert.deepEqual(audio.status().loops.map(x=>x.key),['room']);assert(audio.status().reflectionSeconds<.095);assert.equal(audio.status().noiseBand,0);assert.equal(audio.play('tremor',s),false);assert.equal(audio.play('gunshot',s),false);
 p.moving=true;for(let i=0;i<3;i++){p.x+=.45;audio.update(s);}assert.equal(audio.status().played['step-stone'],1);
 dungeon.cleared=true;assert(audio.play('discover',s));assert.equal(audio.status().played['room-clear'],1);dungeon.offer=[{id:'real-boon'}];assert(audio.play('alert',s));assert.equal(audio.status().played['boon-offer'],1);assert.equal(audio.status().played.alert,undefined);
 dungeon.offer=null;dungeon.depth=1;audio.update(s);audio.update(s);assert.equal(audio.status().played.descend,2,'one stone transition for an actual room change');
 fixture.foes.push({id:'crawler',kind:'crawler',x:p.x+2,y:p.y,hp:3,state:'chase',heavy:false});fixture.fx.push({kind:'text',x:p.x+2,y:p.y,text:'!',life:.8,max:.8});assert(audio.play('alert',s));assert.equal(audio.status().played['crawler-alert'],1);
 fixture.fx.push({kind:'spark',x:p.x+2,y:p.y,life:.24,max:.24});fixture.foes[0].hp=0;assert(audio.play('kill',s));assert.equal(audio.status().played['crawler-kill'],1);
 fixture.foes.push({id:'boss',kind:'matriarch',x:p.x-3,y:p.y,hp:40,state:'windup',heavy:true});audio.update(s);assert.equal(audio.status().played['matriarch-windup'],1);assert(audio.play('alarm',s));assert.equal(audio.status().played['boss-phase'],1);
 fixture.fx.push({kind:'ring',x:p.x-2,y:p.y+1,life:.6,max:.6});assert.deepEqual(combatEmitter('heavy-hit',s),{x:p.x-2,y:p.y+1,z:undefined},'actual boss slam ring wins over an older contact');
 fixture.fx[0].life=.3;fixture.fx[1].life=.1;fixture.fx[2].life=.3;assert.equal(combatEmitter('guard',s),undefined,'old FX do not misplace a fresh guard');
 audio.update(s,{mapOpen:true});assert.equal(audio.status().voices,0);assert.equal(audio.play('descend',s),false);audio.update(s,{mapOpen:false});assert.equal(audio.status().loops.length,1);audio.setEnabled(false);assert.equal(audio.status().voices,0);audio.setEnabled(true);
 Object.assign(s,{mode:'foot',dungeon:null});audio.update(s);assert.equal(audio.status().acoustics,'desert');assert.equal(audio.status().reflectionSeconds,.135);assert.equal(audio.status().roomKey,null);assert(audio.status().loops.some(x=>x.key==='wind'));assert(!audio.status().loops.some(x=>x.key==='room'));audio.dispose();
});

test('committed pistol contact cues give six real shots and one reload, with silent windup/dry trigger and a separate knife heavy',()=>{
 install();const sim=new WorldSim(),s=sim.s,audio=new WorldAudio(),events:Array<{cue:string;t:number}>=[];audio.unlock({isTrusted:true});s.weapon='pistol';
 sim.cue=cue=>{events.push({cue,t:s.t});audio.play(cue,s);};
 const advance=(seconds:number)=>{for(let i=0;i<Math.ceil(seconds*60);i++){clock.currentTime+=1/60;sim.step(1/60,NO_INPUT);audio.update(s);for(const source of sources)if(!source.loop)source.onended?.();}};
 for(let i=0;i<6;i++){const before=audio.status().played['pistol-shot']||0;sim.combat.light();assert.equal(audio.status().played['pistol-shot']||0,before,'attack start is silent until real contact');advance(1.7);}
 assert.equal(audio.status().played['pistol-shot'],6);assert.equal(audio.status().played['reload-start'],1);assert.equal(audio.status().played['reload-ready'],1);assert.equal(audio.status().played.swing,undefined,'pistol never plays a sabre swish');
 const shots=events.filter(e=>e.cue==='pistol-shot');assert(shots[0].t>=.08);const start=events.find(e=>e.cue==='reload-start')!,ready=events.find(e=>e.cue==='reload-ready')!;assert.equal(start.t,shots[5].t,'sixth shot contact precedes the magazine operation in the same tick');assert(ready.t-start.t>=1.19);
 sim.combat.heavy();advance(1.4);assert.equal(audio.status().played['pistol-stab'],1);assert.equal(audio.status().played['pistol-shot'],6,'knife-heavy is a melee action');
 s.fighter.ammo=0;sim.combat.light();assert.equal(audio.status().played['reload-start'],2);advance(1.3);assert.equal(audio.status().played['pistol-shot'],6,'empty trigger starts reload without a fabricated shot');assert.equal(audio.status().played['reload-ready'],2);audio.dispose();
});

test('actual craft result, material gathering, food/water and weapon actions route distinctly without changing old sabre waves',()=>{
 install();const sim=new WorldSim(),s=sim.s,audio=new WorldAudio();audio.unlock({isTrusted:true});sim.cue=cue=>audio.play(cue,s);
 s.panel='loom';assert.equal(sim.craft('rope'),false);assert.equal(audio.status().played['craft-loom'],undefined,'failed crafting stays silent');s.inventory.reed=3;assert(sim.craft('rope'));assert.equal(audio.status().played['craft-loom'],1);assert.equal(s.inventory.fibre,2);
 s.panel='forge';assert(audio.play('craft',s));s.panel='still';assert(audio.play('craft',s));s.panel='workbench';assert(audio.play('craft',s));for(const cue of ['craft','craft-forge','craft-still'])assert.equal(audio.status().played[cue],1);
 s.gatherKind=1;assert(audio.play('chip',s));s.gatherKind=2;assert(audio.play('chip',s));assert.equal(audio.status().played['gather-stone'],1);assert.equal(audio.status().played['gather-fibre'],1);Object.assign(s.fighter,{act:{kind:'gather'}});assert.equal(audio.play('swing',s),false,'material contact does not get an extra combat swish');
 s.inventory.ration=1;s.player.hp=4;sim.eat();assert.equal(audio.status().played.eat,1);assert.equal(s.player.hp,8);s.banner={text:'You fill your water at the well',life:3.5};assert(audio.play('drink',s));assert.equal(audio.status().played.drink,1);
 for(const weapon of ['daggers','spear','greatblade'] as const){s.weapon=weapon;Object.assign(s.fighter,{act:{kind:'light'}});assert(audio.play('swing',s));Object.assign(s.fighter,{act:{kind:'heavy'}});assert(audio.play('swing',s));}
 for(const cue of ['daggers-swing','daggers-spin','spear-swing','spear-lunge','greatblade-swing','greatblade-smash'])assert.equal(audio.status().played[cue],1);
 s.weapon='sabre';assert.equal(audio.play('pistol-shot',s),false);audio.setEnabled(false);assert.equal(audio.play('craft',s),false);audio.dispose();
});

test('stable real events distinguish directional alerts and contact thresholds, while actual wildlife attacks/deaths retain positions',()=>{
 install();const s=newWorld(),audio=new WorldAudio(),p=s.player;audio.unlock({isTrusted:true});s.foes=[makeFoe('near-guard','soldier','guard',p.x+2,p.y)];
 s.event={id:'real-star',kind:'star',x:p.x+20,y:p.y+4,t:0};assert(audio.play('alert',s));audio.update(s);audio.update(s);assert.equal(audio.status().played['event-star'],1);assert.equal(audio.status().played.alert,undefined,'an event does not grunt from an unrelated live foe');
 s.event.t=2.49;audio.update(s);assert.equal(audio.status().played['star-impact'],undefined);s.event.t=2.5;audio.update(s);audio.update(s);assert.equal(audio.status().played['star-impact'],1);
 s.event={id:'real-crash',kind:'crash',x:p.x-22,y:p.y,t:0};assert(audio.play('alert',s));s.event.t=4;audio.update(s);assert.equal(audio.status().played['crash-impact'],1);
 s.event={id:'real-cache',kind:'cache',x:p.x+18,y:p.y,t:0};assert(audio.play('alert',s));s.event.t=10;audio.update(s);assert.equal(audio.status().played['event-cache'],1);assert.equal(audio.status().played['crash-impact'],1);
 audio.setEnabled(false);s.event={id:'muted-star',kind:'star',x:p.x+20,y:p.y,t:0};audio.update(s);s.event.t=3;audio.update(s);audio.setEnabled(true);audio.update(s);assert.equal(audio.status().played['star-impact'],1,'missed muted contact is not replayed on restore');
 s.event=null;const fox=makeFoe('real-fox','fox','wild',p.x+3,p.y);s.foes=[fox];fox.state='windup';audio.update(s);audio.update(s);assert.equal(audio.status().played['fox-windup'],1);fox.state='strike';s.fx.push({kind:'slash',x:fox.x,y:fox.y,life:.3,max:.3,angle:0});assert(audio.play('enemy-swing',s));assert.equal(audio.status().played['fox-attack'],1);
 fox.hp=0;s.fx.push({kind:'spark',x:fox.x,y:fox.y,life:.24,max:.24,angle:0});assert(audio.play('kill',s));assert.equal(audio.status().played['fox-kill'],1);
 const hare=makeFoe('real-hare','hare','wild',p.x-2,p.y);hare.hp=0;s.foes.push(hare);s.fx.push({kind:'spark',x:hare.x,y:hare.y,life:.24,max:.24,angle:0});assert(audio.play('kill',s));assert.equal(audio.status().played['hare-kill'],1);
 audio.update(s,{mapOpen:true});assert.equal(audio.status().voices,0);assert.equal(audio.play('event-star',s),false);audio.dispose();
});

test('desert mood reuses one wind identity, keeps camp warmth and bounds the drone to ambience or real pressure',()=>{
 install();const s=withoutWeather(newWorld()),audio=new WorldAudio();audio.unlock({isTrusted:true});audio.update(s);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'wind');assert.equal(desertAtmosphere(s).campShelter,1);
 assert.equal(sources.at(-1).buffer.duration,8);Object.assign(s.player,{x:CAMP.x+13,y:CAMP.y});audio.update(s);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'wind','small boundary motion does not chatter');
 s.player.x=CAMP.x+15;audio.update(s);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'desert-wind');assert.equal(sources.at(-1).buffer.duration,12,'same wind identity actually receives the new buffer');s.player.x=CAMP.x+13;audio.update(s);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'desert-wind','exit threshold differs from entry');s.player.x=CAMP.x+12.2;audio.update(s);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'wind');
 Object.assign(s.player,{x:270,y:270});audio.update(s);const calm=audio.status().loops.find(v=>v.key==='wind')!;assert.equal(calm.cue,'desert-wind');assert.equal(audio.status().desertMood.danger,0,'a hidden roaming giant does not create a threat signal');
 Object.assign(s.giant,{state:'track',attention:75,x:280,y:270});audio.update(s);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'desert-danger');assert(audio.status().desertMood.danger>.5);
 s.mode='fly';Object.assign(s.craft,{x:270,y:270,z:8,speed:6});s.gunships.forEach((g,i)=>Object.assign(g,{state:'hunt',x:273+i,y:270,z:7,lightX:272+i,lightY:270}));audio.update(s);assert.equal(audio.status().loops.length,WORLD_LOOP_LIMIT,'drone does not consume another loop or starve engines/giant');
 s.giant.state='roam';audio.update(s);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'desert-wind');assert(!audio.status().loops.some(v=>v.key==='giant'));
 Object.assign(s.craft,{x:STORM.cx,y:STORM.cy});audio.update(s);assert.equal(audio.status().desertMood.stormSource,'fixed');assert.equal(audio.status().storm,1);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'desert-danger');
 s.mode='foot';Object.assign(s.player,{x:CAMP.x,y:CAMP.y});audio.update(s);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'wind');assert.equal(audio.status().desertMood.exposure,0);assert.equal(audio.status().outputGain,.80);
 audio.update(s,{mapOpen:true});assert.equal(audio.status().voices,0);audio.update(s,{mapOpen:false});audio.focus(false);assert.equal(audio.status().voices,0);audio.focus(true);audio.setEnabled(false);assert.equal(audio.status().voices,0);audio.dispose();
 const rate=16000,quiet=worldWaveform('desert-wind',0,rate),danger=worldWaveform('desert-danger',0,rate);let quietBody=0,dangerBody=0;for(let i=0;i<quiet.length;i++){const basis=Math.sin(2*Math.PI*39*i/rate);quietBody+=quiet[i]*basis;dangerBody+=danger[i]*basis;}assert(Math.abs(quietBody)/quiet.length>.008,'ordinary desert has a quiet real39Hz bed');assert(Math.abs(dangerBody)>Math.abs(quietBody)*1.8,'actual pressure raises that bed');
});

test('distant thumps/tails exist only alongside genuine giant events and stop beyond the physical horizon',()=>{
 install();const s=newWorld(),audio=new WorldAudio();audio.unlock({isTrusted:true});Object.assign(s.player,{x:270,y:270});Object.assign(s.giant,{state:'roam',breachX:350,breachY:270});audio.update(s);
 for(let i=0;i<30;i++){s.t+=1;audio.update(s);}assert.equal(audio.status().played['giant-distance-tail'],undefined,'elapsed time and a roaming giant never fabricate impacts');assert.equal(audio.play('tremor',s),false);assert.equal(audio.play('giant-distance-tail',s,s.giant),false);
 s.giant.state='tremor';assert(audio.play('tremor',s));assert.equal(audio.status().played['giant-distance-tail'],1);audio.update(s);audio.update(s);assert.equal(audio.status().played['giant-distance-tail'],1,'observation never repeats an emitted event');
 s.giant.state='breach';assert(audio.play('breach',s));assert.equal(audio.status().played['giant-distance-tail'],2);s.giant.breachX=s.player.x+210;assert.equal(audio.play('breach',s),false);assert.equal(audio.status().played['giant-distance-tail'],2);assert(audio.status().voices<=WORLD_VOICE_LIMIT);
 Object.assign(s,{mode:'dungeon',dungeon:{id:'vault',depth:0,plan:{w:11,h:11},offer:null,cleared:false,done:false}});audio.update(s);assert.equal(audio.status().desertMood.exposure,0);assert.equal(audio.status().desertMood.danger,0);assert.equal(audio.play('giant-distance-tail',s,s.giant),false);assert.deepEqual(audio.status().loops.map(v=>v.cue),['room-air']);audio.setEnabled(false);assert.equal(audio.status().voices,0);audio.dispose();
 const rate=16000,tail=worldWaveform('giant-distance-tail',2,rate);let body=0,bright=0;for(let i=0;i<rate;i++){body+=tail[i]*Math.sin(2*Math.PI*37*1.009*i/rate);bright+=tail[i]*Math.sin(2*Math.PI*3100*i/rate);}assert(Math.abs(body)>Math.abs(bright)*15,'finite distant tail is weighted toward low physical body');
});

test('committed camp build emits warm construction only after payment, with separate denied placement feedback',()=>{
 install();const sim=new WorldSim(),s=sim.s,audio=new WorldAudio();audio.unlock({isTrusted:true});sim.cue=cue=>audio.play(cue,s);sim.toggleBuild();assert(s.build.on);
 const x=CAMP.x+5,y=CAMP.y+3;assert(sim.canPlace(x,y));assert.equal(sim.place(x,y),false);assert.equal(audio.status().played['build-deny'],1);assert.equal(audio.status().played.craft,undefined);assert.equal(s.builds.length,0);
 s.inventory.sandstone=3;assert(sim.place(x,y));assert.equal(s.inventory.sandstone,0);assert.equal(s.builds.length,1);assert.equal(audio.status().played.craft,1);assert.equal(sim.place(x,y),false);assert.equal(audio.status().played['build-deny'],2,'occupied cells do not replay a successful construction');
 sim.remove(x,y);assert.equal(s.builds.length,0);assert.equal(s.inventory.sandstone,1);assert.equal(audio.status().played['gather-stone'],1);audio.setEnabled(false);assert.equal(sim.place(x,y),false);assert.equal(audio.status().played['build-deny'],2,'muted native failures do not leak');audio.dispose();
});

test('moving weather uses the exact local level/strength, explicitly fails closed and warns once per real storm',()=>{
 install();const s=newWorld(),fixture={stormLevel:0,wind:{a:2.6,k:.2},storm:null as {x:number;y:number;vx:number;vy:number;r:number;life:number}|null};Object.assign(s,fixture);Object.assign(s.player,{x:STORM.cx,y:STORM.cy});
 const audio=new WorldAudio();audio.unlock({isTrusted:true});audio.update(s);assert.equal(weatherAudio(s).storm,0,'explicit calm disables the legacy circle at its own center');assert.equal(audio.status().desertMood.stormSource,'moving');assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'desert-wind');
 const calm=audio.status().loops.find(v=>v.key==='wind')!.gain;fixture.wind.k=.9;audio.update(s);assert(audio.status().loops.find(v=>v.key==='wind')!.gain>calm,'actual wind strength changes airflow');
 fixture.stormLevel=.8;Object.assign(s,fixture);audio.update(s);assert.equal(audio.status().storm,.8);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'desert-danger');
 fixture.stormLevel=0;fixture.storm={x:s.player.x-70,y:s.player.y,vx:1.1,vy:0,r:26,life:150};Object.assign(s,fixture);assert(audio.play('storm-warning',s));assert.equal(audio.play('storm-warning',s),false);assert.equal(audio.status().played['storm-warning'],1);assert.equal(audio.status().played.alert,undefined,'weather warning is never an enemy grunt');
 for(const level of [NaN,Infinity,undefined]){Object.assign(s,{stormLevel:level,wind:{a:2.6,k:NaN}});assert.equal(weatherAudio(s).storm,0);assert.equal(weatherAudio(s).windStrength,0);assert.equal(audio.play('storm-warning',s),false);}
 fixture.stormLevel=1;fixture.wind.k=.9;Object.assign(s,fixture);Object.assign(s.player,{x:CAMP.x,y:CAMP.y});audio.update(s);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'desert-danger','a real storm sweeping camp overrides calm shelter');fixture.stormLevel=0;Object.assign(s,fixture);audio.update(s);assert.equal(audio.status().loops.find(v=>v.key==='wind')!.cue,'wind');
 let sand={x:250,y:250};for(let x=240;x<280&&!isSoft(sand.x,sand.y);x++)sand={x,y:250};assert(isSoft(sand.x,sand.y));Object.assign(s.player,sand);s.noise=100;s.noiseSrc={...sand};fixture.stormLevel=1;Object.assign(s,fixture);audio.update(s);assert.equal(audio.status().played['noise-risk'],undefined,'actual storm masking follows the giant producer');fixture.stormLevel=0;Object.assign(s,fixture);audio.update(s);assert.equal(audio.status().played['noise-risk'],1);
 audio.setEnabled(false);fixture.storm={...fixture.storm!,x:200};Object.assign(s,fixture);assert.equal(audio.play('storm-warning',s),false);audio.setEnabled(true);assert.equal(audio.play('storm-warning',s),false,'missed mute warning is not replayed');
 Object.assign(s,{mode:'dungeon',dungeon:{id:'vault',depth:0,plan:{w:11,h:11},offer:null,cleared:false,done:false},stormLevel:1});assert.equal(weatherAudio(s).storm,0);assert.equal(weatherAudio(s).windStrength,0);assert.equal(audio.play('storm-warning',s),false);audio.update(s);assert.deepEqual(audio.status().loops.map(v=>v.cue),['room-air']);audio.dispose();
});


test('committed moving-weather producer advances its actual storm and emits one native advisory',()=>{
 install();const sim=new WorldSim(),s=sim.s,audio=new WorldAudio(),cues:string[]=[];audio.unlock({isTrusted:true});sim.cue=cue=>{cues.push(cue);audio.play(cue,s);};
 // Unit-only countdown fixture; all geometry, motion, intensity and cues come from WorldSim.step.
 s.nextStorm=.025;for(let i=0;i<3;i++){sim.step(1/60,NO_INPUT);audio.update(s);}assert(s.storm);const storm=s.storm,start={x:storm.x,y:storm.y,life:storm.life};assert.equal(cues.filter(c=>c==='storm-warning').length,1);assert.equal(audio.status().played['storm-warning'],1);
 for(let i=0;i<180;i++){sim.step(1/60,NO_INPUT);audio.update(s);}assert.equal(s.storm,storm,'producer retains one moving storm identity');assert(Math.hypot(storm.x-start.x,storm.y-start.y)>3);assert(storm.life<start.life-2.9);assert.equal(cues.filter(c=>c==='storm-warning').length,1);assert.equal(audio.status().played['storm-warning'],1);assert.equal(audio.status().storm,s.stormLevel);assert.equal(audio.status().desertMood.windStrength,Math.max(0,Math.min(1,s.wind.k)));assert.equal(audio.status().desertMood.stormSource,'moving');assert(audio.status().loops.length<=WORLD_LOOP_LIMIT);audio.dispose();
});


test('actual shield combat separates fast deflection, slow penetration, collapse, recovery and energy reaction',()=>{
 install();const sim=new WorldSim(),s=sim.s,audio=new WorldAudio(),events:Array<{cue:string;pos:any;down:number}>=[];audio.unlock({isTrusted:true});sim.descend('audio-unit',CAMP.x,CAMP.y);s.foes=[];Object.assign(s.player,{x:ROOM_ORIGIN.x+6,y:ROOM_ORIGIN.y+7,face:0});
 sim.cue=(cue,pos)=>{events.push({cue,pos,down:s.foes[0]?.shDown??0});audio.play(cue,s,pos)};const tick=(n:number)=>{for(let i=0;i<n;i++){s.t+=1/60;clock.currentTime+=1/60;sim.combat.step(1/60,{x:0,y:0});audio.update(s)}};
 try{const e=makeFoe('actual-guard','soldier','unit',s.player.x+1.1,s.player.y);Object.assign(e,{shDir:Math.PI,cooldown:99});s.foes=[e];audio.update(s);assert.equal(shieldSource(s)?.id,e.id);assert(audio.status().loops.some(v=>v.key==='shield'));
  sim.combat.light();tick(10);assert.equal(e.hp,e.max,'fast contact deflects rather than making a flesh hit');assert.equal(audio.status().played['shield-deflect'],1);assert.equal(audio.status().played.hit,undefined);assert.equal(events.find(v=>v.cue==='shield-deflect')!.pos.x,e.x);
  tick(25);sim.combat.heavy();assert.equal(audio.status().played['slow-blade'],1);tick(41);assert.equal(audio.status().played['shield-pierce'],1);assert.equal(e.hp,e.max-3,'actual slow blade passes through');tick(25);
  Object.assign(s.fighter,{guard:true,sh:10,shDown:0,invuln:0});s.player.face=0;e.x=s.player.x+1;e.y=s.player.y;e.heavy=false;sim.combat.hitPlayer(e);audio.update(s);assert.equal(s.fighter.sh,0);assert(s.fighter.shDown>0);assert.equal(audio.status().played['shield-overload'],1);tick(183);assert.equal(audio.status().played['shield-ready'],1);assert(s.fighter.sh>0);
  const target=makeFoe('reaction-target','soldier','unit',s.player.x+1,s.player.y);Object.assign(target,{shDir:Math.PI,cooldown:99});s.foes=[target];s.weapon='pistol';s.fighter.act=null;s.fighter.breath=6;sim.combat.light();tick(6);assert.equal(audio.status().played['pistol-shot'],1);assert.equal(audio.status().played['shield-reaction'],1);assert.equal(events.find(v=>v.cue==='shield-reaction')!.down,0,'reaction is audible before the host depletes its field');assert.equal(target.sh,0);assert(target.shDown>5.9&&target.shDown<6,'actual recovery clock advances after the reaction');
  tick(25);sim.combat.bash();assert.equal(audio.status().played.bash,1);assert(audio.status().voices<=WORLD_VOICE_LIMIT);assert(audio.status().loops.length<=WORLD_LOOP_LIMIT);
 }finally{audio.dispose();area.solid=null}
});

test('actual drone bolt depletion collapses once and a missed recovery never replays after mute',()=>{
 install();const sim=new WorldSim(),s=sim.s,audio=new WorldAudio();audio.unlock({isTrusted:true});sim.descend('bolt-unit',CAMP.x,CAMP.y);s.foes=[];Object.assign(s.player,{x:ROOM_ORIGIN.x+6,y:ROOM_ORIGIN.y+7,face:0});Object.assign(s.fighter,{guard:true,sh:10,shDown:0});sim.cue=(cue,pos)=>audio.play(cue,s,pos);
 try{s.bolts.push({x:s.player.x+.1,y:s.player.y,vx:-1,vy:0,life:1});sim.combat.step(1/60,{x:0,y:0});assert.equal(s.fighter.sh,0);assert.equal(s.fighter.shDown,3);assert.equal(audio.status().played['shield-deflect'],1);assert.equal(audio.status().played['shield-overload'],1);audio.update(s);assert(!audio.status().loops.some(v=>v.key==='shield'));
  audio.setEnabled(false);for(let i=0;i<183;i++){sim.combat.step(1/60,{x:0,y:0});audio.update(s)}audio.setEnabled(true);audio.update(s);assert.equal(audio.status().played['shield-ready'],undefined);assert(audio.status().loops.some(v=>v.key==='shield'));audio.update(s,{mapOpen:true});assert.equal(audio.status().voices,0);audio.focus(false);audio.dispose();
 }finally{audio.dispose();area.solid=null}
});

test('actual delve themes change one finite room bed and contact-timed traps keep their own emitters',()=>{
 install();const sim=new WorldSim(),s=sim.s,audio=new WorldAudio(),events:Array<{cue:string;pos:any}>=[];audio.unlock({isTrusted:true});sim.cue=(cue,pos)=>{events.push({cue,pos});audio.play(cue,s,pos)};
 try{const profiles=[];for(const [id,theme]of [['platform-2','subway'],['server-garden','data'],['bunker-seven','bunker'],['smugglers-cut','warren']]){sim.delve(id,CAMP.x,CAMP.y);s.foes=[];audio.update(s);assert.equal(audio.status().roomTheme,theme);assert.equal(audio.status().loops.find(v=>v.key==='room')!.cue,'room-'+theme);assert.equal(audio.status().loops.filter(v=>v.key==='room').length,1);profiles.push(dungeonAcoustics(s));}assert.equal(new Set(profiles.map(v=>v.delay)).size,4);assert(profiles.every(v=>v.delay<.13));
  sim.delve('platform-2',CAMP.x,CAMP.y);s.foes=[];let d=s.dungeon!;Object.assign(d,{delay:0,cleared:true});let trap=d.room!.traps![0],pos={x:ROOM_ORIGIN.x+trap.x+.5,y:ROOM_ORIGIN.y+trap.y+.5};Object.assign(s.player,pos);s.fighter.invuln=0;sim.step(1/60,NO_INPUT);audio.update(s);assert.equal(audio.status().played['trap-plate'],1);assert.equal(s.player.hp,9);assert.deepEqual(events.find(v=>v.cue==='trap-plate')!.pos,pos);sim.step(1/60,NO_INPUT);assert.equal(audio.status().played['trap-plate'],1);
  sim.delve('bunker-seven',CAMP.x,CAMP.y);s.foes=[];d=s.dungeon!;Object.assign(d,{delay:0,cleared:true});trap=d.room!.traps![0];pos={x:ROOM_ORIGIN.x+trap.x+.5,y:ROOM_ORIGIN.y+trap.y+.5};const a=(s.t+1/60)*1.1;Object.assign(s.player,{x:pos.x+Math.cos(a),y:pos.y+Math.sin(a)});s.fighter.invuln=0;sim.step(1/60,NO_INPUT);audio.update(s);assert.equal(audio.status().played['trap-laser'],1);assert.deepEqual(events.find(v=>v.cue==='trap-laser')!.pos,pos);assert.equal(audio.status().played['trap-plate'],1);assert.equal(audio.status().outputGain,.80);
 }finally{audio.dispose();area.solid=null}
});

test('actual delve lever power, lore and finite loot stay distinct from cleared rooms and do not replay',()=>{
 install();const sim=new WorldSim(),s=sim.s,audio=new WorldAudio();audio.unlock({isTrusted:true});sim.cue=(cue,pos)=>audio.play(cue,s,pos);const use=(v:{x:number;y:number})=>{Object.assign(s.player,{x:ROOM_ORIGIN.x+v.x+.5,y:ROOM_ORIGIN.y+v.y+.5});s.fighter.act=null;sim.step(1/60,{...NO_INPUT,interact:true});audio.update(s)};
 try{sim.delve('server-garden',CAMP.x,CAMP.y);s.foes=[];let d=s.dungeon!;Object.assign(d,{delay:0,cleared:true});for(const i of d.room!.puzzle!.order)use(d.room!.puzzle!.levers[i]);assert(d.solved);assert.equal(audio.status().played['delve-lever'],3);assert.equal(audio.status().played['delve-power'],1);assert.equal(audio.status().played['room-clear'],undefined);use(d.room!.puzzle!.levers[0]);assert.equal(audio.status().played['delve-power'],1);use(d.room!.lore![1]);assert.equal(audio.status().played['terminal-read'],1);
  sim.delve('platform-2',CAMP.x,CAMP.y);sim.room(1);s.foes=[];d=s.dungeon!;Object.assign(d,{delay:0,cleared:true});const lore=d.room!.lore![0];use(lore);assert.equal(s.inventory.battery,2);assert.equal(audio.status().played['delve-read'],1);assert.equal(audio.status().played['delve-loot'],1);use(lore);assert.equal(s.inventory.battery,2);assert.equal(audio.status().played['delve-loot'],1);
  sim.delve('smugglers-cut',CAMP.x,CAMP.y);s.foes=[];d=s.dungeon!;Object.assign(d,{delay:0,cleared:true});use(d.room!.chest!);assert.equal(s.inventory.coins,40);assert.equal(s.inventory.glimmer,4);assert.equal(audio.status().played['delve-loot'],2);assert.equal(audio.status().played['room-clear'],undefined,'typed chest loot in a cleared room is never another room-clear chime');use(d.room!.chest!);assert.equal(audio.status().played['delve-loot'],2);
  sim.delve('server-garden',CAMP.x,CAMP.y);s.foes=[];d=s.dungeon!;Object.assign(d,{delay:0,cleared:true});use(d.room!.puzzle!.levers[0]);assert.equal(audio.status().played['puzzle-denied'],1);assert(!d.solved);audio.setEnabled(false);use(d.room!.lore![0]);const count=audio.status().played['delve-read'];audio.setEnabled(true);audio.update(s);assert.equal(audio.status().played['delve-read'],count);
 }finally{audio.dispose();area.solid=null}
});

test('silent observers baseline windups, room changes and noise while loops retain their physical caps',()=>{
 install();const s=newWorld(),audio=new WorldAudio();audio.unlock({isTrusted:true});const e=makeFoe('silent-guard','soldier','unit',s.player.x+2,s.player.y);s.foes=[e];audio.update(s);audio.setEnabled(false);e.state='windup';audio.update(s);audio.setEnabled(true);audio.update(s);assert.equal(audio.status().played['enemy-windup'],undefined);e.state='chase';audio.update(s);e.state='windup';audio.update(s);assert.equal(audio.status().played['enemy-windup'],1);
 Object.assign(s,{mode:'dungeon',dungeon:{id:'room',depth:0,plan:{w:11,h:11},offer:null,cleared:false,done:false}});audio.update(s);audio.setEnabled(false);s.dungeon!.depth=1;audio.update(s);audio.setEnabled(true);audio.update(s);assert.equal(audio.status().played.descend,undefined,'missed room transition stays silent');
 Object.assign(s,{mode:'foot',dungeon:null});s.fighter.guard=true;s.gunships.forEach((g,i)=>Object.assign(g,{x:s.player.x+3+i,y:s.player.y,z:7,state:'hunt',lightX:s.player.x+2,lightY:s.player.y}));Object.assign(s.giant,{state:'track',x:s.player.x+4,y:s.player.y,attention:70});audio.update(s);assert.equal(audio.status().loops.length,WORLD_LOOP_LIMIT);assert(audio.status().loops.some(v=>v.key==='shield'));audio.update(s,{mapOpen:true});e.state='chase';audio.update(s,{mapOpen:true});e.state='windup';let sand={x:250,y:250};for(let x=240;x<280&&!isSoft(sand.x,sand.y);x++)sand={x,y:250};assert(isSoft(sand.x,sand.y));s.noiseSrc=sand;s.noise=100;audio.update(s,{mapOpen:true});audio.update(s,{mapOpen:false});assert.equal(audio.status().played['enemy-windup'],1);assert.equal(audio.status().played['noise-risk'],undefined,'missed real effective-noise threshold never replays');s.mode='fly';audio.update(s);assert(!audio.status().loops.some(v=>v.key==='shield'));assert(audio.status().loops.length<=WORLD_LOOP_LIMIT);audio.dispose();
});
