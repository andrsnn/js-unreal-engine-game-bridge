// Receiver-authorised industrial character, never a second weapon report.
// Every recipe uses an already shipped bank; all accents are finite Ambience.
export const GUARDIAN_ACCENTS = Object.freeze({
 pulse: { bank:'energy-plasma', gain:.32, rate:.60, duration:1.15, cutoff:600, cadence:4, priority:5 },
 feeding: { bank:'hb-vent', gain:.20, rate:.70, duration:1.30, cutoff:700, cadence:8, priority:4 },
 mining: { bank:'impact-tail', gain:.09, rate:.72, duration:.70, cutoff:750, cadence:6, priority:3 },
 warlord: { bank:'rail-tail', gain:.07, rate:.68, duration:.65, cutoff:650, cadence:6, priority:2 },
 derelict: { bank:'impact-tail', gain:.08, rate:.62, duration:.80, cutoff:700, cadence:6, priority:1 },
});
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
const identified=e=>e?.disclosed===true&&e.precise===true&&e.identified===true&&Number.isFinite(e.confidence)&&e.confidence>=.72;
const kinds=new Set(['sentinel','growth','mining-swarm','warlord','derelict']);
export function guardianSources(frame,systemId){
 const result=new Map();
 if(frame?.enabled!==true||frame.systemId!==systemId)return result;
 for(const g of (frame.guardians??[]).slice(0,24))if(g.id!=null&&g.systemId===systemId&&identified(g)&&point(g.position)&&kinds.has(g.kind))result.set(String(g.id),g);
 return result;
}
export function observeGuardianAudio(frame,state,{running,systemId,listener,allowReport=true}){
 if(!running||frame?.enabled!==true||frame.systemId!==systemId||!Number.isFinite(frame.time)){
  state.initialized=false;return null;
 }
 if(state.scope!==systemId||frame.time<(state.time??-Infinity))state.initialized=false;
 const fresh=!state.initialized,previous=state.time??frame.time;
 if(fresh){state.seen=new Set();state.cooldowns=new Map();state.nextAt=-Infinity;}
 state.initialized=true;state.scope=systemId;state.time=frame.time;
 const sources=guardianSources(frame,systemId),candidates=[];
 for(const e of (frame.guardianEvents??[]).slice(0,96)){
  if(e.id==null||e.sourceId==null||e.disclosed!==true||e.observed!==true||e.precise!==true||e.systemId!==systemId||
   !Number.isFinite(e.confidence)||e.confidence<.72||!Number.isFinite(e.at)||e.at>frame.time||!point(e.position)||!point(e.direction))continue;
  const id=String(e.id);if(state.seen.has(id))continue;state.seen.add(id);
  const guardian=sources.get(String(e.guardianId));
  // Newly disclosed old fire, load/view/pause baselines and mute are consumed,
  // never queued for a later misleading attack. Observation churn is irrelevant.
  if(!guardian||fresh||e.at<previous-.02||frame.time-e.at>.75||!allowReport||!point(listener))continue;
  const distance=Math.hypot(...e.position.map((v,i)=>v-listener[i]));if(distance>1800)continue;
  const accent=guardian.kind==='sentinel'&&e.kind==='pulse'&&Number.isFinite(e.radius)&&e.radius>0&&e.radius<=2000?'pulse':
   guardian.kind==='growth'&&e.kind==='growth'&&Number.isFinite(e.growth)&&e.growth>0&&e.growth<=1?'feeding':
   guardian.kind==='mining-swarm'&&e.kind==='mining'?'mining':
   ['warlord','derelict'].includes(guardian.kind)&&['turret','flak'].includes(e.kind)?guardian.kind:null;
  if(!accent)continue;
  const key=String(e.guardianId)+':'+accent;
  if(frame.time<(state.cooldowns.get(key)??-Infinity)||frame.time<state.nextAt)continue;
  candidates.push({id,guardianId:String(e.guardianId),sourceId:String(e.sourceId),accent,kind:e.kind,at:e.at,position:e.position.slice(),distance,key});
 }
 while(state.seen.size>256)state.seen.delete(state.seen.values().next().value);
 while(state.cooldowns.size>96)state.cooldowns.delete(state.cooldowns.keys().next().value);
 candidates.sort((a,b)=>GUARDIAN_ACCENTS[b.accent].priority-GUARDIAN_ACCENTS[a.accent].priority||a.distance-b.distance);
 const event=candidates[0];if(!event)return null;
 state.cooldowns.set(event.key,frame.time+GUARDIAN_ACCENTS[event.accent].cadence);state.nextAt=frame.time+.75;
 while(state.cooldowns.size>96)state.cooldowns.delete(state.cooldowns.keys().next().value);
 return event;
}
