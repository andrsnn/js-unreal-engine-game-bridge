export const AUDIO_PRIORITIES=Object.freeze({weapons:75,explosions:85,alerts:95,impacts:50,creatures:45,ui:55,foley:25,engines:35,ambience:10,reflections:20});

/** Deterministic arbitration: an urgent attack must be heard over idle chatter.
 * Identical-priority overflow still drops, bounding rapid-fire/UI load. */
export function voiceToReplace(voices,bus,priority,globalLimit=40){
 const list=[...voices],same=list.filter(v=>v.bus===bus),limit=bus==='weapons'?10:bus==='foley'||bus==='creatures'?6:8;
 const candidates=same.length>=limit?same:list.length>=globalLimit?list:[];
 if(!candidates.length)return undefined;
 const lowest=candidates.reduce((a,b)=>b.priority<a.priority?b:a);
 // New weapon attacks replace the oldest equal-priority weapon tail.
 // Long physical reports must not erase rapid-fire attacks at the bus limit.
 return lowest.priority<priority||(bus==='weapons'&&lowest.bus==='weapons'&&lowest.priority===priority)?lowest:null;
}

export function creatureEventPriority(kind){
 return {death:90,charge:85,warning:80,attack:75,hit:60,chitter:15}[kind]||45;
}
