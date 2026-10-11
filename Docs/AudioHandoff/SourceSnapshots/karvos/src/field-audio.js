import {physicalDriveLevels} from './audio-physical.js';
import {gameAudio} from './audio-mixer.js';
import {audioEnvironment,createAdaptiveScore} from './audio-scene.js';
const clamp=(v,a=0,b=1)=>Math.min(b,Math.max(a,v));
export function fieldAudioTargets(state){
 const h=state.environmentHazards||{},storm=h.storm,p=h.predator;
 const active=!!state.started&&state.mode==='game'&&!state.dead&&!state.audioMuted;
 const speed=Math.abs(Number(state.velocity)||0),engine=!!state.mounted&&!state.engineOff&&(state.fuel??0)>0;
 let front=0,rumble=0;
 if(state.planet==='mesa'&&storm?.active!==false&&storm){
  const dx=Math.max(0,Math.abs(state.pos.x-storm.x)-storm.width),dz=Math.max(0,Math.abs(state.pos.z-storm.z)-storm.length/2);
  front=clamp(storm.wind??(1-Math.hypot(dx,dz)/350));
 }
 if(p?.target&&['warning','emerging','hunting'].includes(p.phase)&&!p.actor?.dead){
  const proximity=clamp(1-Math.hypot(state.pos.x-p.target.x,state.pos.z-p.target.z)/65);
  rumble=proximity*(p.phase==='warning'?.25+.75*clamp(1-p.timer/7):p.phase==='emerging'?1:.3);
 }
 return {active,engine,speed,wind:(.008+front*.065)*(h.sheltered?.35:1),rumble:rumble*(h.sheltered?.35:1),storm:front,surface:state.planet==='mesa'?'sand':['viren','nivar'].includes(state.planet)?'snow':state.planet==='zhal'?'mud':'rock'};
}

export function createFieldAudio(state,{camera,getBike=()=>null,getShip=()=>null,getFootfalls=()=>null,getEnemies=()=>[],getBuildings=()=>[]}={}){
 const audio=gameAudio(state,camera);let last=null,planet=null,bikeStressAt=0,distance=0,side=1,lastHealth=100,alertAt=-Infinity,lastWarning='',lastFootfall=0,engineWasOn=false,nextGust=0,nextDetail=0;const score=createAdaptiveScore(state,audio,{enemies:getEnemies});
 function update(realDt){
  const target=fieldAudioTargets(state),dt=clamp(Number(realDt)||0,.001,.25),pos=state.pos,moved=last&&planet===state.planet?Math.hypot(pos.x-last.x,pos.z-last.z):0;
  last={x:pos.x,z:pos.z};planet=state.planet;const active=target.active,environment=audioEnvironment(state,getBuildings());state.audioEnvironment=environment;target.surface=environment.surface;score.update(dt);
  audio.loop('wind','wind',{volume:active?(environment.sheltered?.085:.30+target.wind*1.6):0,cutoff:environment.airCutoff||15000});
  audio.loop('front','storm',{volume:active?target.storm*(environment.sheltered?.21:.75):0,cutoff:state.environmentHazards?.sheltered?450:3200});
  const ambience={nivar:'ocean',viren:'wind',zhal:'bio',korath:'volcano'}[state.planet];audio.loop('biome',ambience,{volume:active&&ambience?.30:0});
  const bike=getBike(),speed=clamp(target.speed/43),drive=physicalDriveLevels(speed);audio.loop('bike','engine',{bus:'engines',volume:active&&target.engine?drive.engine:0,position:bike?.position,pitch:.78+speed*.34,cutoff:650+speed*1900});
  audio.loop('bike-turbine','hover',{bus:'engines',volume:active&&target.engine?drive.turbine:0,position:bike?.position,pitch:.86+speed*.38,cutoff:1300+speed*2000});
  if(active&&target.engine&&speed>.45&&(globalThis.performance?.now()||Date.now())/1000>bikeStressAt){audio.play('impactMetal',{bus:'engines',volume:.12+speed*.08,position:bike?.position,cutoff:1600,priority:15});bikeStressAt=(globalThis.performance?.now()||Date.now())/1000+2.5+Math.random()*3;}
  if(active&&target.engine!==engineWasOn)audio.play(target.engine?'bikeStart':'bikeStop',{bus:'engines',volume:.65,position:bike?.position,near:5,far:65});engineWasOn=active&&target.engine;
  audio.loop('cutter','cutter',{bus:'foley',volume:active&&state.cutting?.34:0,pitch:1,cutoff:environment.sheltered?4500:6500});
  const ship=getShip();audio.loop('ship','engine',{bus:'engines',volume:active&&ship?.visible?.25:0,position:ship?.position,pitch:.58,near:12,far:160,cutoff:1100});
  audio.loop('seismic','rumble',{volume:active?target.rumble*.58:0,cutoff:600});
  const feet=getFootfalls();if(feet){for(const event of feet.events||[]){if(event.serial<=lastFootfall)continue;lastFootfall=event.serial;if(!active||state.mounted)continue;const volume=state.crouching?.32:clamp(.7+event.speed/12,.7,1.25);audio.play('step'+target.surface[0].toUpperCase()+target.surface.slice(1),{bus:'foley',volume,position:event.position,pan:event.side==='L'?-.12:.12,variation:.075});audio.play('rustle',{bus:'foley',volume:.24*volume,delay:.035,variation:.06});}distance=0;}
  else if(!active||state.mounted||moved>3)distance=0;
  else{distance+=moved;const stride=state.crouching?.65:moved/dt>5?1.65:1.15;if(distance>=stride){distance%=stride;side*=-1;const volume=state.crouching?.32:clamp(.7+moved/dt/12,.7,1.25);
    audio.play('step'+target.surface[0].toUpperCase()+target.surface.slice(1),{bus:'foley',volume,pan:side*.12,variation:.075});audio.play('rustle',{bus:'foley',volume:.24*volume,pan:-side*.12,delay:.035,variation:.06});}}
  const warning=state.environmentHazards?.warnings?.[0]||'',now=(globalThis.performance?.now()||Date.now())/1000;
  if(active&&!environment.sheltered&&now>nextDetail){const detail=state.planet==='mesa'?'biomeSand':['viren','nivar'].includes(state.planet)?'biomeIce':state.planet==='zhal'?'biomeSpore':null;if(detail){const angle=Math.random()*Math.PI*2,radius=8+Math.random()*18;audio.play(detail,{bus:'ambience',volume:target.storm>.5?.16:.38,position:{x:pos.x+Math.cos(angle)*radius,y:pos.y,z:pos.z+Math.sin(angle)*radius},near:8,far:55,variation:.12,priority:10});}nextDetail=now+8+Math.random()*10;}
  if(active&&target.wind>.035&&now>nextGust){audio.play('thunder',{bus:'ambience',volume:environment.sheltered?.13:.33,pitch:.65,variation:.12,pan:Math.random()*.8-.4,cutoff:environment.sheltered?250:850});nextGust=now+12+Math.random()*13;}
  if(active&&warning&&warning!==lastWarning&&now-alertAt>8){audio.play('alert',{bus:'alerts',volume:.65});alertAt=now;}lastWarning=warning;
  if(active&&state.health<lastHealth-1)audio.play('impactFlesh',{bus:'impacts',volume:.45,pitch:.85,variation:.06});lastHealth=state.health;
  audio.update();
 }
 return {update,dispose(){audio.dispose();},audio};
}
