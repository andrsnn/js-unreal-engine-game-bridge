import {creatureReactionKey} from './audio-physical.js';
import {creatureEventPriority} from './audio-voices.js';
import {gameAudio} from './audio-mixer.js';
import * as T from 'three';
import {enemyProfile,isRival} from './enemy-profiles.js';
export function enemySoundPlacement(position,listener,camera){
 const delta=new T.Vector3().subVectors(position,listener),distance=delta.length(),right=new T.Vector3().setFromMatrixColumn(camera.matrixWorld,0);
 return {distance,gain:distance>70?0:1/(1+(distance/12)**2),pan:distance?T.MathUtils.clamp(delta.dot(right)/distance,-1,1):0};
}
export function enemyAudioEvents(actor,time,previous={}){
 const d=actor.userData,profile=enemyProfile(d.archetype),events=[];
 const charging=d.chargeTimer>0&&d.chargeTimer<profile.chargeActive;
 if(d.chargeTimer>0&&!(previous.chargeTimer>0))events.push('warning');
 if(charging&&!previous.charging)events.push('charge');
 if(d.aimRemaining>0&&!(previous.aimRemaining>0))events.push('warning');
 if(Number.isFinite(d.strike)&&d.strike!==previous.strike)events.push('attack');
 if(d.hostile&&!d.dead&&!d.burrowDormant&&time>=(previous.chitterAt??0)){events.push('chitter');previous.chitterAt=time+5+Math.random()*5;}
 previous.chargeTimer=d.chargeTimer;previous.charging=charging;previous.aimRemaining=d.aimRemaining;previous.strike=d.strike;
 return events;
}
export function creatureVoiceKey(profile,archetype=''){
 if(isRival(archetype))return 'voiceRaider';
 if(profile.flightHeight||/fly|wasp|wing/.test(archetype))return 'voiceFlyer';
 if((profile.size||1)>=1.5||profile.rank>=2)return 'voiceBrute';
 if(/stalk|rush|ambush|burrow|charger/.test(archetype)||profile.speed>=6)return 'voiceStalker';
 return 'voiceDrone';
}
export function createEnemyAudio(state,camera){
 const audio=gameAudio(state,camera);let memories=new WeakMap(),calls=new WeakMap(),chitterAt=0;
 function emit(actor,kind){if(state.mode!=='game'||state.dead)return false;
  const rival=isRival(actor.userData.archetype);if(rival&&kind==='attack')return false;
  const now=(globalThis.performance?.now()||Date.now())/1000,last=calls.get(actor)||{};
  if(now-(last[kind]??-Infinity)<(kind==='hit'?.42:.24))return false;
  if(kind==='chitter'){if(now<chitterAt)return false;chitterAt=now+.55;}
  last[kind]=now;calls.set(actor,last);
  const profile=enemyProfile(actor.userData.archetype),size=profile.size||1;
  const key=creatureReactionKey(creatureVoiceKey(profile,actor.userData.archetype),kind);
  const actorPitch=1+Math.sin(actor.userData.phase||0)*.055;
  if(!rival&&['attack','charge','death'].includes(kind))audio.play(size>=1.5?'creatureLarge':'creatureSmall',{bus:'creatures',position:actor.position,volume:kind==='death'?.4:.28,pitch:Math.max(.58,1.15/Math.sqrt(size))*actorPitch,far:90,variation:.10,delay:kind==='death'?.055:0,priority:creatureEventPriority(kind)-10});
  return audio.play(key,{bus:'creatures',position:actor.position,volume:kind==='chitter'?(rival?.3:.46):kind==='warning'?.7:kind==='hit'?.42:.8,pitch:(rival?1:Math.max(.6,Math.min(1.3,1/Math.sqrt(size))))*actorPitch,far:95,variation:.075,priority:creatureEventPriority(kind)});
 }
 function observe(actor,time){
  if(actor.userData.dead||actor.userData.burrowDormant||actor.position.distanceTo(state.pos)>85)return;
  let previous=memories.get(actor);
  if(!previous){previous={strike:actor.userData.strike,chitterAt:time+.5+Math.abs(actor.userData.phase||0)%4};memories.set(actor,previous);}
  for(const event of enemyAudioEvents(actor,time,previous))emit(actor,event);
 }
 return {emit,observe,update(){},reset(){memories=new WeakMap();calls=new WeakMap();chitterAt=0;}};
}
