// Authoritative receiver-side boarding transitions only. Missing producers fail closed.
// No elapsed-flight timer, raw party/faction scan or invented marine combat.
export const BOARDING_ACCENTS = Object.freeze({
 'pod-launch':{bank:'hb-launch',gain:.50,rate:.82,duration:.65,cutoff:850,bus:'weapons',cadence:.6,priority:8},
 'hull-breach':{bank:'hb-breach',gain:.44,rate:.76,duration:.95,cutoff:650,bus:'weapons',cadence:.6,priority:7},
 'marine-exchange':{bank:'hb-pdc',gain:.14,rate:.86,duration:.18,cutoff:750,bus:'ambience',cadence:2.5,priority:1},
 'section-secured':{bank:'comms-key',gain:.16,rate:.84,duration:.22,cutoff:850,bus:'alerts',cadence:1.2,priority:3},
 casualty:{bank:'comms-key',gain:.16,rate:.70,duration:.18,cutoff:650,bus:'alerts',cadence:3,priority:2},
 captured:{bank:'comms-close',gain:.20,rate:.85,duration:.34,cutoff:850,bus:'alerts',cadence:.6,priority:4},
 repelled:{bank:'comms-close',gain:.16,rate:.64,duration:.28,cutoff:650,bus:'alerts',cadence:.6,priority:4},
 withdrawn:{bank:'comms-key',gain:.12,rate:.72,duration:.22,cutoff:650,bus:'alerts',cadence:.6,priority:4},
 lost:{bank:'comms-close',gain:.16,rate:.60,duration:.30,cutoff:600,bus:'alerts',cadence:.6,priority:4},
});
const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
export function observeBoardingAudio(frame,state,{running,systemId,listener,allowReport=()=>true}){
 if(!running||frame?.enabled!==true||frame.systemId!==systemId||!Number.isFinite(frame.time)){state.initialized=false;return null;}
 if(state.scope!==systemId||frame.time<(state.time??-Infinity))state.initialized=false;
 const fresh=!state.initialized,previous=state.time??frame.time;
 if(fresh){state.seen=new Set();state.cooldowns=new Map();state.nextAt=-Infinity;}
 state.initialized=true;state.scope=systemId;state.time=frame.time;
 let chosen=null;
 for(const e of (frame.boardingEvents??[]).slice(-64)){
  const shape=BOARDING_ACCENTS[e?.kind];
  if(!shape||e.id==null||e.partyId==null||e.disclosed!==true||e.observed!==true||e.systemId!==systemId||!Number.isFinite(e.at)||e.at>frame.time)continue;
  const id=String(e.id);if(state.seen.has(id))continue;state.seen.add(id);
  // Own radio reports can remain centred; spatial hull seats require actual precision.
  if(e.precise!==true&&(shape.bus==='weapons'||e.own!==true))continue;
  if(e.precise===true&&(!point(e.position)||!Number.isFinite(e.confidence)||e.confidence<.72))continue;
  const distance=e.precise===true&&point(listener)?Math.hypot(...e.position.map((v,i)=>v-listener[i])):0;
  if(fresh||e.at<previous-.02||frame.time-e.at>.6||distance>1800||!allowReport(shape.bus)||frame.time<state.nextAt)continue;
  const key=String(e.partyId)+':'+e.kind;
  if(frame.time<(state.cooldowns.get(key)??-Infinity))continue;
  if(chosen&&BOARDING_ACCENTS[chosen.kind].priority>=shape.priority)continue;
  chosen={id,partyId:String(e.partyId),kind:e.kind,at:e.at,position:e.precise===true?e.position.slice():null,systemId,key};
 }
 while(state.seen.size>256)state.seen.delete(state.seen.values().next().value);
 if(chosen){state.nextAt=frame.time+.12;state.cooldowns.set(chosen.key,frame.time+BOARDING_ACCENTS[chosen.kind].cadence);}
 while(state.cooldowns.size>96)state.cooldowns.delete(state.cooldowns.keys().next().value);
 return chosen;
}
