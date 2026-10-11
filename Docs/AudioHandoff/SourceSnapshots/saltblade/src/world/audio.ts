import type {WState} from './sim';
import {G,CAMP,STORM,isSoft,tileAt} from './terrain';
import {synthesizeSound} from '../platform/audio';
import {ROOM_ORIGIN} from './dungeon';

// Original procedural waveforms, dedicated to the public domain (CC0-1.0).
// No third-party recordings, downloads or trained audio models are used.
type Position={x:number;y:number;z?:number};
type Recipe={seconds:number;gain:number;priority:number;near:number;far:number;loop?:boolean};
export const WORLD_SOUNDS:Record<string,Recipe>={
 wind:{seconds:8,gain:.22,priority:10,near:0,far:0,loop:true},
 glide:{seconds:6,gain:.21,priority:15,near:0,far:0,loop:true},
 engine:{seconds:6,gain:.46,priority:30,near:5,far:88,loop:true},
 searchlight:{seconds:6,gain:.13,priority:20,near:2,far:28,loop:true},
 'giant-track':{seconds:6,gain:.26,priority:35,near:4,far:65,loop:true},
 flap:{seconds:.36,gain:.74,priority:65,near:0,far:0},
 swing:{seconds:.31,gain:.58,priority:55,near:0,far:0},
 dodge:{seconds:.26,gain:.42,priority:50,near:0,far:0},
 chip:{seconds:.62,gain:.57,priority:60,near:1,far:22},
 land:{seconds:.42,gain:.53,priority:65,near:0,far:0},
 'land-hard':{seconds:.82,gain:.82,priority:75,near:0,far:0},
 tremor:{seconds:2.6,gain:.84,priority:90,near:4,far:145},
 breach:{seconds:2.3,gain:1,priority:95,near:5,far:185},
 gunshot:{seconds:.72,gain:.84,priority:85,near:2,far:65},
 board:{seconds:.30,gain:.50,priority:55,near:0,far:0},
 discover:{seconds:1.05,gain:.54,priority:75,near:0,far:0},
 level:{seconds:1.30,gain:.53,priority:80,near:0,far:0},
 alarm:{seconds:.65,gain:.55,priority:85,near:0,far:0},
 death:{seconds:.90,gain:.60,priority:100,near:0,far:0},
 'step-sand':{seconds:.19,gain:.30,priority:25,near:0,far:0},
 'step-rock':{seconds:.22,gain:.32,priority:25,near:0,far:0},
 'noise-risk':{seconds:.27,gain:.28,priority:45,near:0,far:0},
 'heavy-swing':{seconds:.58,gain:.70,priority:65,near:0,far:0},
 'riposte-swing':{seconds:.42,gain:.65,priority:75,near:0,far:0},
 guard:{seconds:.22,gain:.48,priority:70,near:1,far:24},
 parry:{seconds:.65,gain:.76,priority:90,near:1,far:28},
 hit:{seconds:.28,gain:.61,priority:80,near:1,far:26},
 'heavy-hit':{seconds:.48,gain:.76,priority:85,near:1,far:32},
 hurt:{seconds:.36,gain:.66,priority:85,near:0,far:0},
 kill:{seconds:.55,gain:.38,priority:65,near:1,far:25},
 'enemy-swing':{seconds:.34,gain:.47,priority:60,near:1,far:24},
 alert:{seconds:.31,gain:.31,priority:50,near:1,far:24},
 'enemy-windup':{seconds:.16,gain:.25,priority:40,near:1,far:20},
 'enemy-heavy-windup':{seconds:.32,gain:.30,priority:45,near:1,far:20},
 'room-air':{seconds:8,gain:.11,priority:10,near:0,far:0,loop:true},
 descend:{seconds:1.15,gain:.47,priority:65,near:0,far:0},
 'step-stone':{seconds:.25,gain:.30,priority:25,near:0,far:0},
 'room-clear':{seconds:.9,gain:.43,priority:70,near:0,far:0},
 'boon-offer':{seconds:.65,gain:.37,priority:65,near:0,far:0},
 'crawler-alert':{seconds:.32,gain:.35,priority:55,near:1,far:24},
 'crawler-kill':{seconds:.48,gain:.40,priority:65,near:1,far:25},
 'matriarch-windup':{seconds:.60,gain:.48,priority:70,near:2,far:32},
 'boss-phase':{seconds:1.3,gain:.67,priority:90,near:2,far:40},
 craft:{seconds:.74,gain:.44,priority:60,near:0,far:0},
 'craft-forge':{seconds:.90,gain:.47,priority:60,near:0,far:0},
 'craft-loom':{seconds:.60,gain:.38,priority:60,near:0,far:0},
 'craft-still':{seconds:.75,gain:.38,priority:60,near:0,far:0},
 drink:{seconds:.64,gain:.40,priority:55,near:0,far:0},
 eat:{seconds:.38,gain:.33,priority:55,near:0,far:0},
 'gather-stone':{seconds:.38,gain:.51,priority:60,near:0,far:0},
 'gather-fibre':{seconds:.29,gain:.39,priority:55,near:0,far:0},
 'daggers-swing':{seconds:.22,gain:.45,priority:55,near:0,far:0},
 'daggers-spin':{seconds:.46,gain:.56,priority:65,near:0,far:0},
 'spear-swing':{seconds:.36,gain:.48,priority:55,near:0,far:0},
 'spear-lunge':{seconds:.58,gain:.63,priority:65,near:0,far:0},
 'greatblade-swing':{seconds:.57,gain:.64,priority:60,near:0,far:0},
 'greatblade-smash':{seconds:.88,gain:.74,priority:70,near:0,far:0},
 'pistol-stab':{seconds:.24,gain:.44,priority:55,near:0,far:0},
 'pistol-shot':{seconds:.74,gain:.84,priority:85,near:0,far:0},
 'reload-start':{seconds:.45,gain:.42,priority:60,near:0,far:0},
 'reload-ready':{seconds:.26,gain:.46,priority:65,near:0,far:0},
 'event-star':{seconds:.80,gain:.42,priority:55,near:2,far:70},
 'event-crash':{seconds:1.05,gain:.49,priority:65,near:2,far:85},
 'event-cache':{seconds:.60,gain:.40,priority:50,near:2,far:70},
 'star-impact':{seconds:1.65,gain:.78,priority:85,near:3,far:95},
 'crash-impact':{seconds:2.1,gain:.85,priority:85,near:4,far:110},
 'fox-windup':{seconds:.38,gain:.34,priority:45,near:1,far:20},
 'fox-attack':{seconds:.32,gain:.41,priority:60,near:1,far:24},
 'fox-kill':{seconds:.43,gain:.32,priority:65,near:1,far:25},
 'hare-kill':{seconds:.24,gain:.22,priority:55,near:1,far:20},
 'desert-wind':{seconds:12,gain:.24,priority:10,near:0,far:0,loop:true},
 'desert-danger':{seconds:12,gain:.24,priority:10,near:0,far:0,loop:true},
 'giant-distance-tail':{seconds:3.6,gain:.39,priority:50,near:10,far:185},
 'build-deny':{seconds:.09,gain:.22,priority:35,near:0,far:0},
 'storm-warning':{seconds:.75,gain:.25,priority:50,near:0,far:0},
 'shield-hum':{seconds:4,gain:.14,priority:35,near:1,far:13,loop:true},
 'shield-deflect':{seconds:.42,gain:.65,priority:85,near:1,far:26},
 'shield-pierce':{seconds:.62,gain:.68,priority:90,near:1,far:28},
 'shield-overload':{seconds:1.10,gain:.73,priority:90,near:1,far:32},
 'shield-reaction':{seconds:1.80,gain:.90,priority:95,near:2,far:48},
 'shield-ready':{seconds:.28,gain:.31,priority:55,near:0,far:0},
 'slow-blade':{seconds:.78,gain:.48,priority:65,near:0,far:0},
 bash:{seconds:.30,gain:.56,priority:65,near:0,far:0},
 'room-subway':{seconds:8,gain:.11,priority:10,near:0,far:0,loop:true},
 'room-data':{seconds:8,gain:.10,priority:10,near:0,far:0,loop:true},
 'room-bunker':{seconds:8,gain:.11,priority:10,near:0,far:0,loop:true},
 'room-warren':{seconds:8,gain:.10,priority:10,near:0,far:0,loop:true},
 'trap-plate':{seconds:.48,gain:.62,priority:85,near:1,far:24},
 'trap-laser':{seconds:.46,gain:.59,priority:85,near:1,far:26},
 'delve-lever':{seconds:.48,gain:.41,priority:60,near:1,far:22},
 'delve-power':{seconds:1.35,gain:.48,priority:70,near:0,far:0},
 'delve-loot':{seconds:.86,gain:.41,priority:70,near:0,far:0},
 'delve-read':{seconds:.33,gain:.25,priority:45,near:0,far:0},
 'terminal-read':{seconds:.38,gain:.24,priority:45,near:0,far:0},
 'puzzle-denied':{seconds:.65,gain:.44,priority:75,near:0,far:0},
 'drone-shot':{seconds:.35,gain:.50,priority:70,near:1,far:32},
};
export const WORLD_VOICE_LIMIT=24,WORLD_LOOP_LIMIT=7;

export function worldWaveform(cue:string,variant:number,rate:number):Float32Array<ArrayBuffer>{
 const r=WORLD_SOUNDS[cue];if(!r)return new Float32Array(0);
 const reused:Record<string,string>={swing:'slash',dodge:'dodge',chip:'craft',discover:'claim',level:'victory',death:'death','heavy-swing':'heavy','riposte-swing':'riposte',guard:'guard',parry:'parry','enemy-swing':'enemy-slash','enemy-windup':'blade-windup','enemy-heavy-windup':'heavy-windup','build-deny':'ui-select','storm-warning':'region'};
 if(reused[cue])return synthesizeSound(reused[cue],variant,rate);
 const out=new Float32Array(Math.ceil(rate*r.seconds));let seed=(49157+Object.keys(WORLD_SOUNDS).indexOf(cue)*7919+variant*137)>>>0,low=0,mid=0,sandLow=0,sandMid=0;
 const detune=1+(variant-1.5)*.018;
 for(let i=0;i<out.length;i++){
  const t=i/rate;seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=seed/4294967296*2-1;
  low+=.014*(n-low);mid+=.14*(n-mid);let v=0;
  if(cue==='wind')v=(mid-low)*(.65+.25*Math.sin(2*Math.PI*t/r.seconds))+.32*low;
  else if(cue==='desert-wind'||cue==='desert-danger'){
   sandLow+=(1-Math.exp(-2*Math.PI*110/rate))*(n-sandLow);sandMid+=(1-Math.exp(-2*Math.PI*850/rate))*(n-sandMid);
   const cycle=2*Math.PI*t/r.seconds,gust=.58+.20*Math.sin(cycle)+.13*Math.sin(3*cycle+.4)+.08*Math.cos(5*cycle);
   v=(sandLow*.72+(sandMid-sandLow)*.60+(n-sandMid)*.035)*gust;
   // Quiet desert ambience; only an actual giant/storm raises the stronger bed.
   const danger=cue==='desert-danger';v+=(Math.sin(2*Math.PI*39*t)*(danger?.065:.025)+Math.sin(2*Math.PI*58.5*t)*(danger?.028:.012))*(.72+.16*Math.sin(cycle));
  }else if(cue==='giant-distance-tail'){
   const envelope=Math.min(1,t/.10)*Math.exp(-t/.85);
   v=(Math.sin(2*Math.PI*37*detune*t)*.39+Math.sin(2*Math.PI*62*detune*t)*.16+low*1.65)*envelope;
  }else if(cue==='shield-hum')v=(Math.sin(2*Math.PI*92*t)*.055+Math.sin(2*Math.PI*184*t)*.027+Math.sin(2*Math.PI*276*t)*.014+mid*.11)*(.78+.15*Math.sin(2*Math.PI*t/r.seconds));
  else if(cue.startsWith('shield-')){
   const reaction=cue==='shield-reaction',collapse=cue==='shield-overload',pierce=cue==='shield-pierce',ready=cue==='shield-ready';
   if(reaction)v=(Math.sin(2*Math.PI*(49*detune*t+1.6*(1-Math.exp(-t/.025))))*.61+low*2.1)*Math.exp(-t/.36)+mid*Math.exp(-t/.20)*.9+(n-mid)*Math.exp(-t/.025)*.48;
   else if(collapse)v=(Math.sin(2*Math.PI*(138*detune*t-47*t*t))*.30+low*.9+mid*.38)*Math.exp(-t/.21)+(n-mid)*Math.exp(-t/.023)*.19;
   else if(pierce)v=Math.sin(2*Math.PI*74*detune*t)*Math.exp(-t/.083)*.45+mid*Math.exp(-t/.16)*.73+Math.sin(2*Math.PI*(780*detune*t-290*t*t))*Math.exp(-t/.12)*.21;
   else if(ready)v=(Math.sin(2*Math.PI*(294*detune*t+180*t*t))*.18+Math.sin(2*Math.PI*588*detune*t)*.065)*Math.exp(-t/.070)*Math.min(1,t/.006);
   else v=Math.sin(2*Math.PI*131*detune*t)*Math.exp(-t/.045)*.30+Math.sin(2*Math.PI*690*detune*t)*Math.exp(-t/.068)*.23+Math.sin(2*Math.PI*1430*detune*t)*Math.exp(-t/.033)*.09+(n-mid)*Math.exp(-t/.012)*.23;
  }else if(cue==='slow-blade'||cue==='bash'){
   const slow=cue==='slow-blade',envelope=Math.sin(Math.PI*t/r.seconds)**2;
   v=(mid*(slow?.50:.75)+(n-mid)*(slow?.20:.25))*envelope+Math.sin(2*Math.PI*(slow?167:84)*detune*t)*Math.exp(-t/(slow?.18:.05))*.20;
  }else if(cue==='room-air')v=low*.8+mid*.11+Math.sin(2*Math.PI*47*t)*.018*(.5+.5*Math.sin(2*Math.PI*t/r.seconds)**2);
  else if(cue.startsWith('room-')){
   const cycle=2*Math.PI*t/r.seconds,subway=cue==='room-subway',data=cue==='room-data',bunker=cue==='room-bunker';
   v=low*(subway?.9:data?.42:bunker?.72:1)+(mid-low)*(data?.16:.10);
   v+=Math.sin(2*Math.PI*(subway?61:data?110:bunker?53:39)*t)*(data?.024:.035)*(.72+.2*Math.sin(cycle));
   if(subway||bunker)v+=Math.sin(2*Math.PI*(subway?183:159)*t)*.011*(.5+.5*Math.sin(2*cycle)**2);
  }else if(cue==='trap-plate'||cue==='delve-lever'||cue==='delve-loot'){
   const plate=cue==='trap-plate',loot=cue==='delve-loot';
   for(let k=0;k<(loot?3:2);k++){const age=t-k*(plate?.035:loot?.13:.12);if(age>=0)v+=Math.sin(2*Math.PI*(plate?230:loot?390+k*87:126)*detune*age)*Math.exp(-age/(loot?.14:.045))*.23+mid*Math.exp(-age/.035)*.58+(n-mid)*Math.exp(-age/.009)*.15;}
   if(plate)v+=(n-mid)*Math.exp(-Math.abs(t-.085)/.035)*.34;
  }else if(cue==='trap-laser'||cue==='drone-shot'){
   const trap=cue==='trap-laser';v=(Math.sin(2*Math.PI*(260*detune*t+60*(1-Math.exp(-t/.018))))*.24+mid*.68)*Math.exp(-t/(trap?.10:.055))+(n-mid)*Math.exp(-t/.016)*.20;
  }else if(cue==='delve-power'){
   v=(Math.sin(2*Math.PI*(62*t+8*t*t))*.17+low*.72+mid*.20)*Math.sin(Math.PI*t/r.seconds)**2;
   for(let k=0;k<3;k++){const age=t-.10-k*.18;if(age>=0)v+=Math.sin(2*Math.PI*(196+k*98)*detune*age)*Math.exp(-age/.11)*.17+mid*Math.exp(-age/.018)*.21;}
  }else if(cue==='delve-read'||cue==='terminal-read'||cue==='puzzle-denied'){
   const terminal=cue==='terminal-read',denied=cue==='puzzle-denied';v=mid*Math.sin(Math.PI*t/r.seconds)**2*(terminal?.17:denied?.30:.62)+(n-mid)*Math.exp(-t/.06)*(terminal?.07:.12);
   if(terminal||denied)v+=Math.sin(2*Math.PI*(denied?146:587)*detune*t)*Math.exp(-t/(denied?.16:.045))*.19;
  }
  else if(cue==='glide')v=(n-mid)*.22+mid*.32+Math.sin(2*Math.PI*82*t)*.045;
  else if(cue==='engine'){
   const pulse=.65+.24*Math.sin(2*Math.PI*19*t);
   v=(Math.sin(2*Math.PI*42*t)*.24+Math.sin(2*Math.PI*84*t)*.13+Math.sin(2*Math.PI*168*t)*.08+mid*.72)*pulse;
  }else if(cue==='searchlight')v=Math.sin(2*Math.PI*280*t)*.13+Math.sin(2*Math.PI*560*t)*.045+mid*.12*(.6+.4*Math.sin(2*Math.PI*t/r.seconds));
  else if(cue==='giant-track')v=low*1.7+Math.sin(2*Math.PI*34*t)*.24*(.55+.45*Math.sin(2*Math.PI*1.5*t)**2);
  else if(cue==='flap'){
   const whoosh=Math.sin(Math.PI*Math.min(1,t/.33))**2;
   v=(n-mid)*whoosh*.62+mid*whoosh*.7+Math.sin(2*Math.PI*76*detune*t)*Math.exp(-t/.07)*.28;
   v+=Math.sin(2*Math.PI*520*detune*t)*Math.exp(-Math.abs(t-.035)/.025)*.17;
  }else if(cue==='tremor'||cue==='breach'){
   const breach=cue==='breach',attack=breach?Math.exp(-t/.07):Math.min(1,t/.18);
   const decay=Math.exp(-t/(breach?.60:1.5)),pulses=.6+.4*Math.sin(2*Math.PI*(breach?7:3.5)*t)**2;
   v=(Math.sin(2*Math.PI*33*detune*t)*.48+Math.sin(2*Math.PI*57*detune*t)*.22+low*2.3)*decay*pulses;
   if(breach)v+=(n-mid)*attack*.47+mid*Math.exp(-t/.24)*1.15;
   for(let rock=0;rock<5;rock++){const age=t-.08-rock*.13;if(age>0)v+=Math.sin(2*Math.PI*(137+rock*97)*detune*age)*Math.exp(-age/.07)*Math.min(1,age/.003)*(breach?.17:.07);}
  }else if(cue==='gunshot'){
   v=Math.sin(2*Math.PI*(58*t+1.3*(1-Math.exp(-t/.022))))*Math.exp(-t/.085)*.66;
   v+=(n-mid)*Math.exp(-t/.016)*.48+mid*Math.exp(-t/.18)*.8;
   const age=t-.06;if(age>0)v+=Math.sin(2*Math.PI*730*detune*age)*Math.exp(-age/.014)*.16;
  }else if(cue==='step-stone'){
   v=Math.sin(2*Math.PI*137*detune*t)*Math.exp(-t/.03)*.42+mid*Math.exp(-t/.026)*.8;
   const age=t-.045;if(age>0)v+=Math.sin(2*Math.PI*840*detune*age)*Math.exp(-age/.025)*.10+(n-mid)*Math.exp(-age/.014)*.12;
  }else if(cue==='descend'){
   v=low*2.1*Math.sin(Math.PI*t/r.seconds)**2+mid*Math.exp(-t/.3)*.25;
   for(let i=0;i<3;i++){const age=t-i*.17;if(age>=0)v+=Math.sin(2*Math.PI*(77+i*14)*detune*age)*Math.exp(-age/.065)*.25+mid*Math.exp(-age/.035)*.16;}
  }else if(cue==='room-clear'||cue==='boon-offer'){
   const offer=cue==='boon-offer',notes=offer?[392,587]:[294,392,587];
   for(let i=0;i<notes.length;i++){const age=t-i*.085;if(age>=0)v+=(Math.sin(2*Math.PI*notes[i]*detune*age)*.22+Math.sin(2*Math.PI*notes[i]*2.71*detune*age)*.08)*Math.exp(-age/.17)*Math.min(1,age/.006);}
   v+=mid*Math.exp(-t/.035)*.15;
  }else if(cue==='crawler-alert'||cue==='crawler-kill'||cue==='matriarch-windup'||cue==='boss-phase'){
   const boss=cue==='matriarch-windup'||cue==='boss-phase',dying=cue==='crawler-kill',phase=cue==='boss-phase';
   const envelope=Math.min(1,t/.015)*Math.exp(-t/(phase?.38:boss?.20:dying?.12:.075));
   const hz=(boss?49:188)*detune;
   v=(Math.sin(2*Math.PI*(hz*t+(dying?-.9:.7)*t*t))*.36+Math.sin(2*Math.PI*hz*2.13*t)*.13+mid*(boss?1.5:.8)+(n-mid)*.09)*envelope;
   v+=Math.sin(2*Math.PI*(boss?128:1720)*detune*t)*Math.exp(-t/.032)*.14;
  }else if(cue==='pistol-shot'||cue==='star-impact'||cue==='crash-impact'){
   const gun=cue==='pistol-shot',crash=cue==='crash-impact',body=gun?62:crash?42:57,decay=gun?.08:crash?.38:.23;
   v=Math.sin(2*Math.PI*(body*detune*t+1.1*(1-Math.exp(-t/.02))))*Math.exp(-t/decay)*.64+mid*Math.exp(-t/(gun?.17:.32))*1.15+(n-mid)*Math.exp(-t/(gun?.012:.025))*.5;
   for(let i=0;i<(gun?1:6);i++){const age=t-(gun?.065:.12+i*.12);if(age>0)v+=Math.sin(2*Math.PI*(crash?310+i*143:730+i*79)*detune*age)*Math.exp(-age/(gun?.014:.058))*(gun?.14:.10)+mid*Math.exp(-age/.045)*.09;}
  }else if(cue==='craft'||cue==='craft-forge'||cue==='reload-start'||cue==='reload-ready'||cue==='gather-stone'){
   const reload=cue.startsWith('reload-'),forge=cue==='craft-forge',gather=cue==='gather-stone';
   const count=cue==='reload-ready'||gather?1:forge?3:2,gap=reload?.14:forge?.21:.17;
   for(let i=0;i<count;i++){const age=t-i*gap;if(age>=0)v+=Math.sin(2*Math.PI*(reload?330:forge?196:128)*detune*age)*Math.exp(-age/(reload?.028:.05))*.27+Math.sin(2*Math.PI*(reload?1170:forge?860:510)*detune*age)*Math.exp(-age/(forge?.10:.028))*.13+mid*Math.exp(-age/.032)*.65+(n-mid)*Math.exp(-age/.008)*.15;}
   if(cue==='reload-start')v+=mid*Math.exp(-Math.abs(t-.26)/.045)*.34;
  }else if(cue==='drink'||cue==='craft-still'){
   const envelope=Math.sin(Math.PI*t/r.seconds)**2;v=mid*envelope*.55;
   for(let i=0;i<4;i++){const age=t-.05-i*.115;if(age>=0)v+=Math.sin(2*Math.PI*((340+i*85)*detune*age+110*age*age))*Math.exp(-age/.055)*.25;}
  }else if(cue==='eat'||cue==='gather-fibre'||cue==='craft-loom'){
   const cloth=cue==='craft-loom',envelope=cloth?Math.sin(Math.PI*t/r.seconds)**2:Math.exp(-t/.075);
   v=(mid*.85+(n-mid)*.18)*envelope*(.6+.4*Math.sin(2*Math.PI*(cloth?13:27)*t)**2);
   v+=Math.sin(2*Math.PI*149*detune*t)*Math.exp(-t/.025)*.15;
  }else if(['daggers-swing','daggers-spin','spear-swing','spear-lunge','greatblade-swing','greatblade-smash','pistol-stab'].includes(cue)){
   const great=cue.startsWith('greatblade'),spear=cue.startsWith('spear'),spin=cue==='daggers-spin',envelope=Math.sin(Math.PI*t/r.seconds)**2;
   v=((n-mid)*(great?.25:.46)+mid*(great?.8:.42))*envelope*(spin?.55+.45*Math.sin(2*Math.PI*4*t)**2:1);
   v+=Math.sin(2*Math.PI*(great?76:spear?182:380)*detune*t)*Math.exp(-t/(great?.14:.045))*.16;
   if(spear)v+=Math.sin(2*Math.PI*510*detune*t)*Math.exp(-t/.038)*.1;
  }else if(cue.startsWith('event-')){
   const star=cue==='event-star',crash=cue==='event-crash',envelope=Math.sin(Math.PI*t/r.seconds)**2;
   v=crash?(Math.sin(2*Math.PI*(88*t-10*t*t))*.22+mid*.72)*envelope:(Math.sin(2*Math.PI*(star?440:587)*detune*t)*.18+Math.sin(2*Math.PI*(star?1047:880)*detune*t)*.08)*Math.exp(-t/.20)*Math.min(1,t/.008)+mid*envelope*.12;
  }else if(cue.startsWith('fox-')||cue==='hare-kill'){
   const hare=cue==='hare-kill',dying=cue.endsWith('kill'),hz=hare?770:cue==='fox-windup'?184:310,envelope=Math.min(1,t/.008)*Math.exp(-t/(hare?.05:dying?.12:.075));
   v=(Math.sin(2*Math.PI*(hz*detune*t+(dying?-48:35)*t*t))*.29+Math.sin(2*Math.PI*hz*2.31*t)*.07+mid*.65+(n-mid)*.13)*envelope;
  }else if(cue==='land'||cue==='land-hard'||cue.startsWith('step-')){
   const hard=cue==='land-hard',sand=cue==='step-sand',step=cue.startsWith('step-');
   v=Math.sin(2*Math.PI*(step?118:hard?53:82)*detune*t)*Math.exp(-t/(step?.025:.07))*.58;
   v+=mid*Math.exp(-t/(sand?.07:hard?.22:.055))*(sand?1.25:.75)+(n-mid)*Math.exp(-t/.024)*(sand?.08:.22);
   if(hard)v+=Math.sin(2*Math.PI*460*detune*t)*Math.exp(-t/.13)*.12;
  }else if(cue==='board')v=mid*Math.exp(-t/.035)*.6+Math.sin(2*Math.PI*310*detune*t)*Math.exp(-t/.065)*.3+Math.sin(2*Math.PI*630*detune*t)*Math.exp(-t/.028)*.12;
  else if(cue==='alarm'){
   for(let strike=0;strike<2;strike++){const age=t-strike*.21;if(age>=0)v+=Math.sin(2*Math.PI*(strike?430:570)*detune*age)*Math.exp(-age/.11)*.28+Math.sin(2*Math.PI*1180*detune*age)*Math.exp(-age/.04)*.12;}
  }else if(cue==='noise-risk')v=Math.sin(2*Math.PI*172*detune*t)*Math.exp(-t/.06)*.33+mid*Math.exp(-t/.022)*.5;
  else if(cue==='hit'||cue==='heavy-hit'||cue==='hurt'){
   const heavy=cue==='heavy-hit',hurt=cue==='hurt';
   v=Math.sin(2*Math.PI*(heavy?64:hurt?79:126)*detune*t)*Math.exp(-t/(heavy?.105:.052))*.58;
   v+=mid*Math.exp(-t/(heavy?.09:.04))*(hurt?1.4:.96)+(n-mid)*Math.exp(-t/.016)*(hurt?.07:.22);
   if(!hurt)v+=Math.sin(2*Math.PI*760*detune*t)*Math.exp(-t/.06)*.13+Math.sin(2*Math.PI*2360*detune*t)*Math.exp(-t/.025)*.08;
  }else if(cue==='kill'||cue==='alert'){
   const dying=cue==='kill',envelope=Math.min(1,t/.02)*Math.exp(-t/(dying?.16:.065));
   const voiced=Math.sin(2*Math.PI*(dying?96:126)*detune*t+5*t*t);
   v=(voiced*.26+Math.sin(2*Math.PI*211*detune*t)*.08+mid*.75+(n-mid)*.08)*envelope;
   if(dying)v+=Math.sin(2*Math.PI*410*detune*t)*Math.exp(-Math.abs(t-.24)/.025)*.12;
  }
  const edge=r.loop?.035:.012,ramp=Math.max(0,Math.min(1,t/(r.loop?.035:.003),(r.seconds-t)/edge));
  out[i]=Math.tanh(v*1.65)*.78*ramp;
 }
 return out;
}

export function listenerPosition(s:WState):Position{return s.mode==='fly'?s.craft:{x:s.player.x,y:s.player.y,z:0};}
type StormHost={x:number;y:number;vx:number;vy:number;r:number;life:number};
type WeatherHost={stormLevel?:unknown;storm?:unknown;wind?:unknown};
function actualStorm(s:WState):StormHost|null{const host=s as unknown as WeatherHost,storm=host.storm;
 if(typeof host.stormLevel!=='number'||!Number.isFinite(host.stormLevel))return null;
 if(!storm||typeof storm!=='object')return null;const value=storm as StormHost;
 return ['x','y','vx','vy','r','life'].every(k=>Number.isFinite(value[k as keyof StormHost]))&&value.r>0&&value.life>0?value:null;
}
export function weatherAudio(s:WState){const host=s as unknown as WeatherHost,modern='stormLevel' in host||'storm' in host||'wind' in host,p=listenerPosition(s);
 const level=modern?(typeof host.stormLevel==='number'&&Number.isFinite(host.stormLevel)?Math.max(0,Math.min(1,host.stormLevel)):0):Math.max(0,Math.min(1,(STORM.r+12-Math.hypot(p.x-STORM.cx,p.y-STORM.cy))/24));
 const wind=host.wind as {k?:unknown}|null|undefined,strength=modern?(typeof wind?.k==='number'&&Number.isFinite(wind.k)?Math.max(0,Math.min(1,wind.k)):0):.4;
 return {storm:dungeonState(s)?0:level,windStrength:dungeonState(s)?0:strength,stormSource:modern?'moving' as const:'fixed' as const};
}
export function desertAtmosphere(s:WState){
 const p=listenerPosition(s),inside=!!dungeonState(s),campShelter=inside?0:1-Math.max(0,Math.min(1,(Math.hypot(p.x-CAMP.x,p.y-CAMP.y)-12)/18));
 const weather=weatherAudio(s),storm=weather.storm;
 const giant=s.giant,source=giant.state==='tremor'||giant.state==='breach'?{x:giant.breachX,y:giant.breachY}:giant;
 const active=giant.state==='track'?Math.max(0,Math.min(1,giant.attention/100)):giant.state==='tremor'||giant.state==='breach'?1:0;
 const giantDanger=active*Math.max(0,1-Math.hypot(source.x-p.x,source.y-p.y,(p.z||0))/80);
 const biome=tileAt(Math.floor(p.x),Math.floor(p.y)).biome,exposure=inside?0:Math.max((1-campShelter)*(biome==='oasis'?.45:biome==='canyon'?.8:1),storm*.65);
 return {campShelter,exposure,danger:inside?0:Math.max(storm,giantDanger*(1-campShelter)),...weather};
}
export function spatialMix(listener:Position,source:Position,near:number,far:number){
 const dx=source.x-listener.x,dy=source.y-listener.y,distance=Math.hypot(dx,dy,(source.z||0)-(listener.z||0));
 const k=far<=near?0:Math.max(0,Math.min(1,(distance-near)/(far-near)));
 return {distance,gain:(1-k)**2,pan:Math.max(-.85,Math.min(.85,(dx-dy)/32)),lowpass:12000*(1-k)**2+280};
}
type Voice={source:AudioBufferSourceNode;gain:GainNode;pan:StereoPannerNode;filter:BiquadFilterNode;key:string;cue:string;priority:number;loop:boolean;stopping:boolean;distance:number;target:number;panValue:number;emitter?:Position};
type Control={mapOpen?:boolean};
// Optional structure keeps this adapter compatible with the existing world while
// the lead lands combat. It only reads actual action/contact/foe fields.
type ShieldState={sh?:number;shMax?:number;shDown?:number};
type CombatAudioState={fighter?:ShieldState&{act:{kind:string}|null;guard?:boolean};foes?:Array<Position&ShieldState&{id:string;state:string;hp:number;heavy?:boolean;kind?:string;shOn?:boolean}>;fx?:Array<Position&{kind:string;text?:string;life?:number;max?:number}>;bolts?:Position[]};
type DungeonAudioState={mode:string;dungeon?:{id:string;depth:number;plan:{w:number;h:number};offer:unknown[]|null;cleared:boolean;done:boolean;theme?:string;seq?:number[];solved?:boolean;used?:string[];trapCd?:Record<string,number>;room?:{traps?:Array<Position&{kind:string}>;puzzle?:{levers:Position[]};chest?:Position&{name:string};lore?:Array<Position&{title:string;text:string;sheet?:string;sprite?:number}>}}|null};
type ProgressAudioState={weapon?:string;gatherKind?:number;panel?:string|null;event?:Position&{id:string;kind:'star'|'crash'|'cache';t:number}|null};
function dungeonState(s:WState){const world=s as unknown as DungeonAudioState;return world.mode==='dungeon'?world.dungeon:null;}
export function shieldSource(s:WState){
 if(s.mode==='fly'||s.dead>0)return null;const combat=s as unknown as CombatAudioState,p=listenerPosition(s);
 const active=(v:ShieldState)=>Number.isFinite(v.sh)&&Number.isFinite(v.shMax)&&Number.isFinite(v.shDown)&&v.sh!>0&&v.shMax!>0&&v.shDown!<=0;
 const f=combat.fighter;if(f?.guard&&active(f))return {id:'player',owner:'player',position:p,charge:Math.min(1,f.sh!/f.shMax!)};
 const e=combat.foes?.filter(v=>v.hp>0&&v.shOn&&active(v)&&Math.hypot(v.x-p.x,v.y-p.y)<13).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
 return e?{id:e.id,owner:'foe',position:{x:e.x,y:e.y},charge:Math.min(1,e.sh!/e.shMax!)}:null;
}
export function dungeonAcoustics(s:WState){const d=dungeonState(s),theme=d?.theme||'vault',base=d?Math.min(.095,Math.max(.038,(d.plan.w+d.plan.h)/380)):.135;
 const profile=theme==='subway'?{scale:1.3,send:.23,filter:4100,second:.45}:theme==='data'?{scale:.78,send:.14,filter:2800,second:.32}:theme==='bunker'?{scale:1.12,send:.21,filter:2100,second:.40}:theme==='warren'?{scale:.65,send:.12,filter:1600,second:.22}:{scale:1,send:.19,filter:3400,second:.43};
 return {theme:d?theme:null,cue:d&&['subway','data','bunker','warren'].includes(theme)?'room-'+theme:'room-air',delay:base*(d?profile.scale:1),send:d?profile.send:.11,filter:d?profile.filter:1500,second:d?profile.second:0};
}
function delveSignal(cue:string,s:WState){const d=dungeonState(s),r=d?.room,p=listenerPosition(s);let emitter:Position|undefined;
 const at=(v:Position)=>({x:ROOM_ORIGIN.x+v.x+.5,y:ROOM_ORIGIN.y+v.y+.5});
 if(cue==='trap'&&r){const trap=r.traps?.map((v,i)=>({v,cd:d?.trapCd?.['t'+i]||0})).filter(({v,cd})=>cd>=(v.kind==='plate'?1.99:.79)).sort((a,b)=>Math.hypot(at(a.v).x-p.x,at(a.v).y-p.y)-Math.hypot(at(b.v).x-p.x,at(b.v).y-p.y))[0];if(!trap)return null;cue='trap-'+trap.v.kind;emitter=at(trap.v);}
 if(cue==='lever')cue='delve-lever';if(cue==='read')cue='delve-read';if(cue==='loot-chest')cue='delve-loot';if(cue==='puzzle-open')cue='delve-power';
 if(cue==='delve-lever'&&r){const i=d?.seq?.at(-1),l=i===undefined?undefined:r.puzzle?.levers[i];if(l)emitter=at(l);}
 if(cue==='delve-read'&&r){const reading=(s as unknown as {reading?:{title:string;text:string}|null}).reading,lore=r.lore?.find(l=>l.title===reading?.title&&l.text===reading.text);if(lore){emitter=at(lore);if(lore.sheet==='delve-data'&&lore.sprite===7)cue='terminal-read';}}
 // Compatibility for older hosts only; committed typed loot/power callbacks
 // never pass through generic discovery or inspect lingering contact FX.
 if(cue==='discover'&&d){if(r?.chest&&s.banner?.text.startsWith('FOUND:'))cue='delve-loot';else if(d.solved&&s.banner?.text==='Power returns. The doors unseal.')cue='delve-power';else if(d.cleared&&!d.done)cue='room-clear';}
 if(cue==='alarm'&&r?.puzzle&&s.banner?.text==='Wrong order. The old system wakes.')cue='puzzle-denied';
 return {cue,emitter};
}
export function combatEmitter(cue:string,s:WState):Position|undefined{
 const combat=s as unknown as CombatAudioState,fx=combat.fx;
 if(cue==='shield-ready')return listenerPosition(s);
 if(cue.startsWith('shield-')){const f=fx?.slice().reverse().find(v=>(v.max===undefined||v.life===undefined||v.life>=v.max-.035)&&(v.kind==='shield'||v.kind==='text'&&/SHIELD|DEFLECT|GUARD OPEN|SLOW STRIKE/.test(v.text||'')));if(f)return {x:f.x,y:f.y};return undefined;}
 if(cue==='drone-shot')return combat.bolts?.at(-1);
 // Contact callbacks precede FX ageing. Ignore a previous swing's lingering FX.
 const effect=fx?.slice().reverse().find(f=>(f.max===undefined||f.life===undefined||f.life>=f.max-.035)&&(cue==='enemy-swing'?f.kind==='slash':cue==='alert'?f.kind==='text'&&f.text==='!':cue==='guard'?f.kind==='text'&&f.text==='BLOCKED':cue==='parry'?f.kind==='ring':cue==='heavy-hit'?f.kind==='spark'||f.kind==='ring':f.kind==='spark'));
 if(effect)return {x:effect.x,y:effect.y,z:effect.z};
 if(cue==='enemy-swing'||cue==='alert'){const p=listenerPosition(s),foe=combat.foes?.filter(f=>f.hp>0&&(cue!=='enemy-swing'||f.state==='strike')).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];if(foe)return {x:foe.x,y:foe.y};}
 return undefined;
}
export class WorldAudio{
 enabled=true;private ctx:AudioContext|null=null;private master:GainNode|null=null;private mix:GainNode|null=null;private send:GainNode|null=null;private analyser:AnalyserNode|null=null;private tap:MediaStreamAudioDestinationNode|null=null;
 private reflection:DelayNode|null=null;private reflectionFilter:BiquadFilterNode|null=null;private secondReflection:DelayNode|null=null;private secondGain:GainNode|null=null;private roomKey:string|null=null;private room=false;private reflectionSeconds=.135;
 private eventId:string|null=null;private eventAge=0;private shield:ReturnType<typeof shieldSource>=null;private roomTheme:string|null=null;
 private mood:ReturnType<typeof desertAtmosphere>={campShelter:1,exposure:0,danger:0,storm:0,windStrength:.4,stormSource:'fixed'};private dangerWind=false;private desertWind=false;private warnedStorms=new WeakSet<StormHost>();
 private buffers=new Map<string,AudioBuffer>();private voices=new Set<Voice>();private loops=new Map<string,Voice>();private bags=new Map<string,number[]>();private lastVariant:Record<string,number>={};
 private played:Record<string,number>={};private focused=true;private mapOpen=false;private disposed=false;private dropped=0;private dead=false;private lastRisk=-Infinity;private riskBand=0;private lastStep:Position|null=null;private stepDistance=0;private samples=new Float32Array(256);private storm=0;private lastParry=-Infinity;private duplicateGuards=0;private foeStates=new Map<string,string>();
 constructor(){try{this.enabled=JSON.parse(localStorage.getItem('saltblade:audio:v1')||'null')?.enabled!==false;}catch{}}
 unlock(event:Pick<Event,'isTrusted'>){
  if(!event.isTrusted||this.disposed)return;
  try{if(!this.ctx){const Audio=globalThis.AudioContext??(globalThis as unknown as {webkitAudioContext?:typeof AudioContext}).webkitAudioContext;if(!Audio)return;
   const ctx=this.ctx=new Audio({latencyHint:'interactive'}),mix=this.mix=ctx.createGain(),hp=ctx.createBiquadFilter(),compressor=ctx.createDynamicsCompressor(),ceiling=ctx.createWaveShaper(),master=this.master=ctx.createGain();
   hp.type='highpass';hp.frequency.value=24;compressor.threshold.value=-14;compressor.knee.value=8;compressor.ratio.value=3;compressor.attack.value=.008;compressor.release.value=.22;
   ceiling.curve=Float32Array.from({length:2048},(_,i)=>Math.tanh((i/2047*2-1)*1.2)/1.2);ceiling.oversample='2x';
   mix.connect(hp).connect(compressor).connect(ceiling).connect(master);master.connect(ctx.destination);this.analyser=ctx.createAnalyser();this.analyser.fftSize=256;master.connect(this.analyser);
   // A short outdoor reflection. Mute sits after this return, so no wet leak.
   const send=this.send=ctx.createGain(),delay=this.reflection=ctx.createDelay(.5),filter=this.reflectionFilter=ctx.createBiquadFilter();send.gain.value=.11;delay.delayTime.value=.135;filter.type='lowpass';filter.frequency.value=1500;send.connect(delay).connect(filter).connect(mix);
   // A second, finite wall reflection is only audible in actual dungeon rooms.
   const second=this.secondReflection=ctx.createDelay(.5),secondGain=this.secondGain=ctx.createGain();secondGain.gain.value=0;filter.connect(second).connect(secondGain).connect(mix);
   this.applyMaster();}
   if(this.ctx.state==='suspended')void this.ctx.resume().catch(()=>{});
  }catch{/* WebAudio is optional on unsupported hosts. */}
 }
 private applyMaster(){if(this.ctx&&this.master){this.master.gain.cancelScheduledValues(this.ctx.currentTime);this.master.gain.setTargetAtTime(this.enabled&&this.focused&&!this.mapOpen ? .80 : 0,this.ctx.currentTime,.008);}}
 setEnabled(on:boolean){this.enabled=on;try{localStorage.setItem('saltblade:audio:v1',JSON.stringify({enabled:on}));}catch{}this.applyMaster();if(!on)this.stop();}
 focus(active:boolean){this.focused=active;this.applyMaster();if(!active)this.stop();}
 private canPlay(){return !!this.ctx&&this.ctx.state==='running'&&this.enabled&&this.focused&&!this.mapOpen&&!this.disposed;}
 private environment(s:WState){const dungeon=dungeonState(s),profile=dungeonAcoustics(s);this.room=!!dungeon;this.roomTheme=profile.theme;if(!this.ctx)return;
  const t=this.ctx.currentTime;this.reflectionSeconds=profile.delay;
  this.send?.gain.setTargetAtTime(profile.send,t,.12);this.reflection?.delayTime.setTargetAtTime(this.reflectionSeconds,t,.12);this.reflectionFilter?.frequency.setTargetAtTime(profile.filter,t,.12);
  this.secondReflection?.delayTime.setTargetAtTime(this.reflectionSeconds*.73,t,.12);this.secondGain?.gain.setTargetAtTime(profile.second,t,.12);
 }
 private buffer(cue:string,variant:number){const ctx=this.ctx!,key=cue+':'+variant;let buffer=this.buffers.get(key);if(!buffer){const data=worldWaveform(cue,variant,ctx.sampleRate);buffer=ctx.createBuffer(1,data.length,ctx.sampleRate);buffer.copyToChannel(data,0);this.buffers.set(key,buffer);}return buffer;}
 private variant(cue:string){let bag=this.bags.get(cue);if(!bag?.length){bag=[0,1,2,3];for(let i=3;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}if(bag[3]===this.lastVariant[cue])[bag[0],bag[3]]=[bag[3],bag[0]];this.bags.set(cue,bag);}return this.lastVariant[cue]=bag.pop()!;}
 private make(cue:string,key:string,loop:boolean){
  const ctx=this.ctx!,r=WORLD_SOUNDS[cue],same=[...this.voices].filter(v=>!v.stopping&&v.cue===cue&&!v.loop);
  if(!loop&&same.length>=3){this.dropped++;return null;}
  if(this.voices.size>=WORLD_VOICE_LIMIT){const lower=[...this.voices].filter(v=>v.priority<r.priority).sort((a,b)=>a.priority-b.priority)[0];if(!lower){this.dropped++;return null;}this.end(lower,true);}
  const source=ctx.createBufferSource(),gain=ctx.createGain(),pan=ctx.createStereoPanner(),filter=ctx.createBiquadFilter();source.buffer=this.buffer(cue,loop?0:this.variant(cue));source.loop=loop;filter.type='lowpass';filter.frequency.value=12000;gain.gain.value=loop?0:r.gain;
  source.connect(filter).connect(gain).connect(pan).connect(this.mix!);if(!loop)pan.connect(this.send!);
  const voice:Voice={source,gain,pan,filter,key,cue,priority:r.priority,loop,stopping:false,distance:0,target:0,panValue:0};this.voices.add(voice);
  source.onended=()=>{this.voices.delete(voice);if(this.loops.get(key)===voice)this.loops.delete(key);source.disconnect();filter.disconnect();gain.disconnect();pan.disconnect();};
  source.start();this.played[cue]=(this.played[cue]||0)+1;return voice;
 }
 private end(v:Voice,immediate=false){if((v.stopping&&!immediate)||!this.ctx)return;v.stopping=true;v.gain.gain.cancelScheduledValues(this.ctx.currentTime);v.gain.gain.setTargetAtTime(0,this.ctx.currentTime,.008);try{v.source.stop(this.ctx.currentTime+(immediate?0:.04));}catch{}if(this.loops.get(v.key)===v)this.loops.delete(v.key);if(immediate){v.source.disconnect();v.filter.disconnect();v.gain.disconnect();v.pan.disconnect();this.voices.delete(v);}}
 private stop(keepDeath=false){for(const v of this.voices)if(!keepDeath||v.cue!=='death')this.end(v);}
 private position(v:Voice,s:WState,source?:Position,multiplier=1){const r=WORLD_SOUNDS[v.cue],p=source?spatialMix(listenerPosition(s),source,r.near,r.far):{gain:1,pan:0,lowpass:12000,distance:0};v.target=r.gain*p.gain*multiplier;v.distance=p.distance;v.panValue=p.pan;
  const t=this.ctx!.currentTime;v.gain.gain.setTargetAtTime(v.target,t,v.loop?.09:.005);v.pan.pan.setTargetAtTime(p.pan,t,.07);v.filter.frequency.setTargetAtTime(p.lowpass,t,.09);}
 play(cue:string,s:WState,emitter?:Position){
  const dungeon=dungeonState(s),combat=s as unknown as CombatAudioState,progress=s as unknown as ProgressAudioState;this.environment(s);
  if(cue==='storm-warning'){const storm=actualStorm(s);if(dungeon||!storm||this.warnedStorms.has(storm))return false;this.warnedStorms.add(storm);}
  if(dungeon&&['flap','gunshot','tremor','breach','giant-distance-tail','noise-risk','board'].includes(cue))return false;
  if(cue==='giant-distance-tail'&&(!emitter||!['tremor','breach'].includes(s.giant.state)))return false;
  const signal=delveSignal(cue,s);if(!signal)return false;cue=signal.cue;emitter??=signal.emitter;
  if(cue==='alert'&&dungeon?.offer)cue='boon-offer';
  const action=(s as unknown as CombatAudioState).fighter?.act?.kind;
  if(cue==='swing'){
   // Gathering already emitted its actual material contact; a pistol only sounds
   // at the lead's explicit contact cue, including a genuine missed shot.
   if(action==='gather'||progress.weapon==='pistol'&&action==='light')return false;
   if(action==='riposte')cue='riposte-swing';
   else if(progress.weapon==='daggers')cue=action==='heavy'?'daggers-spin':'daggers-swing';
   else if(progress.weapon==='spear')cue=action==='heavy'?'spear-lunge':'spear-swing';
   else if(progress.weapon==='greatblade')cue=action==='heavy'?'greatblade-smash':'greatblade-swing';
   else if(progress.weapon==='pistol')cue='pistol-stab';
   else if(action==='heavy')cue='heavy-swing';
  }
  if(['pistol-shot','reload-start','reload-ready'].includes(cue)&&progress.weapon!=='pistol')return false;
  if(cue==='pistol-shot'&&action!=='light')return false;
  if(cue==='chip'&&progress.gatherKind!==undefined)cue=progress.gatherKind===2?'gather-fibre':'gather-stone';
  if(cue==='craft'&&['forge','loom','still'].includes(progress.panel||''))cue='craft-'+progress.panel;
  // Committed camp placement keeps the warm workbench articulation; a failed
  // placement receives a quiet UI cue, never a successful construction impact.
  if(cue==='build')cue='craft';else if(cue==='deny')cue='build-deny';
  if(cue==='drink'&&s.banner?.text.includes('health'))cue='eat';
  if(!WORLD_SOUNDS[cue]||WORLD_SOUNDS[cue].loop||!this.canPlay()||(s.dead>0&&cue!=='death'))return false;
  if(cue==='guard'&&this.ctx!.currentTime-this.lastParry<.025){this.duplicateGuards++;return false;}
  let position:Position|undefined=emitter;
  if(cue==='alert'&&!dungeon&&progress.event&&progress.event.t<=.035&&this.eventId!==progress.event.id){cue='event-'+progress.event.kind;position=progress.event;this.eventId=progress.event.id;this.eventAge=progress.event.t;}
  if(!position&&(['enemy-swing','alert','guard','parry','hit','heavy-hit','kill','hurt','drone-shot'].includes(cue)||cue.startsWith('shield-')))position=combatEmitter(cue,s);
  if(!position&&cue.startsWith('shield-'))position=listenerPosition(s);
  if(cue==='guard'&&!position)position=listenerPosition(s);
  if(['alert','kill','enemy-swing'].includes(cue)&&position){const source=combat.foes?.filter(f=>cue==='kill'||f.hp>0).sort((a,b)=>Math.hypot(a.x-position!.x,a.y-position!.y)-Math.hypot(b.x-position!.x,b.y-position!.y))[0];
   if(source&&Math.hypot(source.x-position.x,source.y-position.y)<1){
    if(source.kind==='crawler'&&cue!=='enemy-swing')cue=cue==='kill'?'crawler-kill':'crawler-alert';
    else if(source.kind==='fox')cue=cue==='kill'?'fox-kill':cue==='enemy-swing'?'fox-attack':'fox-windup';
    else if(source.kind==='hare'&&cue==='kill')cue='hare-kill';
   }}
  if(cue==='alarm'&&dungeon){const boss=combat.foes?.find(f=>f.kind==='matriarch'&&f.hp>0);if(boss){cue='boss-phase';position=boss;}}
  if(cue==='tremor'||cue==='breach'){if(s.giant.state!==cue)return false;position={x:s.giant.breachX,y:s.giant.breachY};}
  if(cue==='gunshot'){const p=listenerPosition(s),ship=s.gunships.filter(g=>g.state==='hunt'&&Math.hypot(g.x-p.x,g.y-p.y)<6).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];if(!ship)return false;position=ship;}
  if(cue==='flap'&&s.mode!=='fly')return false;
  if(cue==='death')this.stop();
  const r=WORLD_SOUNDS[cue];if(position&&spatialMix(listenerPosition(s),position,r.near,r.far).gain<=0)return false;
  const voice=this.make(cue,cue+':shot',false);if(!voice)return false;voice.emitter=position?{...position}:undefined;this.position(voice,s,position);if(cue==='parry')this.lastParry=this.ctx!.currentTime;
  if((cue==='tremor'||cue==='breach')&&position&&spatialMix(listenerPosition(s),position,0,185).distance>=22)this.play('giant-distance-tail',s,position);
  return true;
 }
 private observeEvent(s:WState){const event=(s as unknown as ProgressAudioState).event;
  if(!event||dungeonState(s)){this.eventId=null;this.eventAge=0;return;}
  if(this.eventId!==event.id){this.eventId=event.id;this.eventAge=event.t;if(event.t<=.035)this.play('event-'+event.kind,s,event);return;}
  const threshold=event.kind==='star'?2.5:event.kind==='crash'?4:Infinity;
  if(this.eventAge<threshold&&event.t>=threshold)this.play(event.kind==='star'?'star-impact':'crash-impact',s,event);
  this.eventAge=event.t;
 }
 update(s:WState,controls:Control={}){
  const map=!!controls.mapOpen;if(map!==this.mapOpen){this.mapOpen=map;this.applyMaster();if(map)this.stop();}
  if(s.dead>0&&!this.dead)this.stop(true);this.dead=s.dead>0;
  const p=listenerPosition(s),dungeon=dungeonState(s);this.environment(s);this.mood=desertAtmosphere(s);this.storm=this.mood.storm;
  if(this.mood.danger>.16)this.dangerWind=true;else if(this.mood.danger<.075)this.dangerWind=false;
  if(this.mood.exposure>.08)this.desertWind=true;else if(this.mood.exposure<.025)this.desertWind=false;
  this.observeEvent(s);
  this.shield=shieldSource(s);
  const roomKey=dungeon?dungeon.id+':'+dungeon.depth:null;if(this.roomKey&&roomKey&&this.roomKey!==roomKey)this.play('descend',s);this.roomKey=roomKey;
  // Observe actual transitions even when silent. Restoring sound never replays
  // a missed foe wind-up, room change or effective-noise threshold.
  const foes=(s as unknown as CombatAudioState).foes,liveIds=new Set<string>();
  if(foes)for(const foe of foes){liveIds.add(foe.id);if(foe.hp>0&&foe.state==='windup'&&this.foeStates.get(foe.id)!=='windup'&&s.mode!=='fly')this.play(foe.kind==='matriarch'?'matriarch-windup':foe.kind==='fox'?'fox-windup':foe.heavy?'enemy-heavy-windup':'enemy-windup',s,foe);this.foeStates.set(foe.id,foe.state);}
  for(const id of this.foeStates.keys())if(!liveIds.has(id))this.foeStates.delete(id);
  const effective=dungeon?0:s.noise*(isSoft(s.noiseSrc.x,s.noiseSrc.y)?1:.15)*((p.z||0)>12?.3:1)*(this.mood.stormSource==='moving'?1-.6*this.storm:1),band=effective>=85?3:effective>=60?2:effective>18?1:0;
  if(band>this.riskBand&&band>=2&&s.t-this.lastRisk>=12){if(this.play('noise-risk',s))this.lastRisk=s.t;}
  if(band>this.riskBand||effective<[0,10,52,77][this.riskBand])this.riskBand=band;
  if(!this.canPlay()||this.dead){this.lastStep={...p};this.stepDistance=0;return;}
  for(const voice of this.voices)if(!voice.loop&&!voice.stopping&&voice.emitter)this.position(voice,s,voice.emitter);
  // Retire the previous scene before allocating its replacement, so a full
  // seven-loop outdoor scene cannot delay the room or shield on a transition.
  for(const [key,v] of this.loops)if(dungeon&&key!=='room'&&key!=='shield'||!dungeon&&key==='room'||!this.shield&&key==='shield'||s.mode!=='fly'&&key==='glide')this.end(v);
  const wanted=new Set<string>();
  const loop=(key:string,cue:string,multiplier:number,position?:Position)=>{
   const r=WORLD_SOUNDS[cue],distance=position?spatialMix(p,position,r.near,r.far):null;
   if(multiplier<=.001||distance?.gain===0)return;
   wanted.add(key);let v=this.loops.get(key);if(v&&v.cue!==cue){this.end(v);v=undefined;}if(!v){if(this.loops.size>=WORLD_LOOP_LIMIT)return;v=this.make(cue,key,true)||undefined;if(!v)return;this.loops.set(key,v);}this.position(v,s,position,multiplier);
  };
  if(dungeon){loop('room',dungeonAcoustics(s).cue,1);}
  else{this.roomKey=null;const cue=this.desertWind?(this.dangerWind?'desert-danger':'desert-wind'):'wind';
   loop('wind',cue,.42+this.mood.exposure*(.32+(this.mood.windStrength-.4)*.4)+this.storm*1.8+(s.mode==='fly'?Math.min(.3,s.craft.z/50):0));}
  loop('glide','glide',s.mode==='fly'?Math.min(1,s.craft.speed/7)*(s.craft.flapping>0?.45:1):0);
  const ships=dungeon?[]:s.gunships.filter(g=>g.state!=='eaten').sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y)).slice(0,2);
  for(const ship of ships){loop('engine:'+ship.id,'engine',ship.state==='hunt'?1.2:.75,ship);loop('searchlight:'+ship.id,'searchlight',1,{x:ship.lightX,y:ship.lightY,z:0});}
  const giant=s.giant;if(!dungeon)loop('giant','giant-track',giant.state==='track'?.3+giant.attention/140:giant.state==='tremor'?1:0,giant.state==='tremor'?{x:giant.breachX,y:giant.breachY}:giant);
  if(this.shield)loop('shield','shield-hum',.45+.55*this.shield.charge,this.shield.position);
  for(const [key,v] of this.loops)if(!wanted.has(key))this.end(v);
  // Sparse rising danger feedback, never one click per HUD pip or a descent alarm.
  const travelled=this.lastStep?Math.hypot(p.x-this.lastStep.x,p.y-this.lastStep.y):0;this.lastStep={...p};
  if(s.mode!=='fly'&&s.player.moving&&s.player.swing<=0&&s.player.dodge<=0&&travelled<2){this.stepDistance+=travelled;if(this.stepDistance>=(s.player.running?1.25:1)){this.stepDistance=0;this.play(dungeon?'step-stone':tileAt(Math.floor(p.x),Math.floor(p.y)).g===G.SAND?'step-sand':'step-rock',s);}}else this.stepDistance=0;
 }
 status(){let peak=0,rms=0;if(this.analyser){this.analyser.getFloatTimeDomainData(this.samples);for(const n of this.samples){peak=Math.max(peak,Math.abs(n));rms+=n*n;}}
  return {audioPass:6,worldAudioPass:5,context:this.ctx?.state||'locked',muted:!this.enabled,focused:this.focused,mapOpen:this.mapOpen,dead:this.dead,storm:this.storm,desertMood:{...this.mood},acoustics:this.room?'dungeon':'desert',roomTheme:this.roomTheme,shield:this.shield?{...this.shield,position:{...this.shield.position}}:null,reflectionSeconds:this.reflectionSeconds,roomKey:this.roomKey,eventId:this.eventId,eventAge:this.eventAge,voices:this.voices.size,maxVoice:WORLD_VOICE_LIMIT,maxLoops:WORLD_LOOP_LIMIT,loops:[...this.loops.values()].map(v=>({key:v.key,cue:v.cue,gain:v.target,distance:v.distance,pan:v.panValue})),buffers:this.buffers.size,played:{...this.played},variants:{...this.lastVariant},dropped:this.dropped,duplicateGuards:this.duplicateGuards,noiseBand:this.riskBand,peak,rms:Math.sqrt(rms/this.samples.length),outputGain:.80};}
 recordingStream(){if(!this.ctx||!this.analyser)return null;if(!this.tap){this.tap=this.ctx.createMediaStreamDestination();this.analyser.connect(this.tap);}return this.tap.stream;}
 dispose(){if(this.disposed)return;this.disposed=true;this.stop();this.buffers.clear();void this.ctx?.close().catch(()=>{});}
}
