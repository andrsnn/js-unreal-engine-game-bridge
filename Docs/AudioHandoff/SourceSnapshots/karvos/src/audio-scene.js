import {mesaSurface,mesaRegion} from './mesa-regions.js';

// Reuse the game's terrain and shelter rules so footsteps communicate safe ground.
export function audioEnvironment(state,buildings=[]){
 const sheltered=!!state.environmentHazards?.sheltered;
 if(sheltered){const metal=buildings.some(b=>(b.userData?.moduleKind==='habitat'||b.userData?.structural==='floor')&&Math.hypot(b.position.x-state.pos.x,b.position.z-state.pos.z)<7);return {space:'room',surface:metal?'metal':'rock',sheltered:true,blend:{room:1,open:0,canyon:0},airCutoff:900};}
 if(state.planet==='mesa'){
  const surface=mesaSurface(state.pos.x,state.pos.z),region=mesaRegion(state.pos.x,state.pos.z);
  const reflective=region.id==='canyon'||region.id==='city',distance=Math.hypot(state.pos.x-region.x,state.pos.z-region.z),canyon=reflective?Math.max(0,Math.min(1,(region.radius*1.45-distance)/(region.radius*.65))):0;
  return {space:canyon>.45?'canyon':'open',surface:surface==='sand'?'sand':'rock',sheltered:false,blend:{open:1-canyon,canyon,room:0},airCutoff:15000};
 }
 return {space:state.planet==='korath'?'canyon':'open',surface:['viren','nivar'].includes(state.planet)?'snow':state.planet==='zhal'?'mud':'rock',sheltered:false,blend:state.planet==='korath'?{canyon:.8,open:.2,room:0}:{open:1,canyon:0,room:0},airCutoff:15000};
}

export function musicThreat(state,enemies=[]){
 let threat=state.firing?.75:0;
 for(const actor of enemies){
  const d=actor.userData;
  if(!d||d.dead||d.burrowDormant||!d.hostile)continue;
  const p=actor.position,range=Math.hypot(p.x-state.pos.x,p.z-state.pos.z);
  threat=Math.max(threat,Math.max(0,1-range/75)*(d.rank>=2?1.25:1));
 }
 if(['warning','emerging','hunting'].includes(state.environmentHazards?.predator?.phase))threat=Math.max(threat,.7);
 if((state.health??100)<25)threat=Math.max(threat,.55);
 return Math.min(1,threat);
}

export function createAdaptiveScore(state,audio,{enemies=()=>[]}={}){
 let intensity=0,hold=0,clock=0,lastPlanet=state.planet,arrival=0;
 return {update(dt){
  const active=state.started&&state.mode==='game'&&!state.dead,threat=musicThreat(state,enemies());if(state.planet!==lastPlanet){lastPlanet=state.planet;arrival=12;}if(active){clock+=dt;arrival=Math.max(0,arrival-dt);}const breath=.5+.5*Math.sin(clock*Math.PI/12),phrase=Math.floor(clock/12)%8;
  if(active&&threat>.2)hold=9;
  else hold=Math.max(0,hold-dt);
  const weather=Math.min(1,Math.max(0,state.environmentHazards?.storm?.wind||0)),travel=Math.min(1,Math.abs(state.velocity||0)/43),shelter=!!state.environmentHazards?.sheltered;
  const target=active?(hold>0?Math.max(threat,.42):weather*.24):0;
  intensity+=(target-intensity)*(1-Math.exp(-dt/(target>intensity?1.2:5)));
  audio.loop('score-bed','scoreBed',{bus:'music',volume:active?(.57+breath*.035-intensity*.065)*(shelter?.9:1):0,sync:'score',cutoff:2600-intensity*900,smoothing:1.2});
  audio.loop('score-pulse','scorePulse',{bus:'music',volume:active?.035+travel*.095+intensity*(.26+breath*.025):0,sync:'score',cutoff:1800,smoothing:.8});
  audio.loop('score-drums','scoreDrums',{bus:'music',volume:active?Math.max(0,intensity-.12)*.44:0,sync:'score',cutoff:2200,smoothing:.9});
  audio.loop('score-motif','scoreMotif',{bus:'music',volume:active?(.17+breath*.045+(arrival>0?.06:0))*(1-intensity*.75)*(phrase===3||phrase===7?.6:1):0,sync:'score',cutoff:2900-intensity*1300,smoothing:1.6});
  const strings=(state.planet==='viren'||state.planet==='nivar'?.10:.055)+weather*.11+intensity*.25;
  audio.loop('score-strings','scoreStrings',{bus:'music',volume:active?strings*(.8+breath*.2):0,sync:'score',smoothing:1.4});
  state.audioMusicStatus={intensity,threat,hold,phrase,weather,travel,arrival,arrangement:intensity>.45?'combat':weather>.3?'storm':travel>.35?'travel':shelter?'shelter':'exploration',active:!!active};
 }};
}
