import assert from 'node:assert/strict';
import {BOARDING_ACCENTS,observeBoardingAudio} from '../src/audio-boarding.js';
import {beginBoarding,tickBoarding} from '../src/game/boarding.js';
const frame={enabled:true,systemId:'s0',time:10,boardingEvents:[]},state={};
const event=(id,kind,extra={})=>({id,partyId:'b1',kind,systemId:'s0',disclosed:true,observed:true,precise:true,confidence:1,position:[0,20,0],at:frame.time,...extra});
const observe=extra=>observeBoardingAudio(frame,state,{running:true,systemId:'s0',listener:[0,20,0],...extra});
frame.boardingEvents=[event('loaded','pod-launch')];assert.equal(observe(),null);
for(const kind of Object.keys(BOARDING_ACCENTS)){frame.time+=4;frame.boardingEvents=[event(kind,kind)];assert.equal(observe().kind,kind);assert.equal(observe(),null,'stable IDs do not repeat');}
for(const bad of [{disclosed:false},{observed:false},{partyId:null},{systemId:'remote'},{position:[Infinity,0,0]},{confidence:.7},{precise:false},{at:frame.time+1},{position:[2000,20,0]}]){frame.time++;frame.boardingEvents=[event('bad-'+JSON.stringify(bad),'pod-launch',bad)];assert.equal(observe(),null);}
frame.time++;frame.boardingEvents=[event('not-own','captured',{precise:false})];assert.equal(observe(),null,'imprecise reports require explicit own party or own hull authorisation');
frame.time++;frame.boardingEvents=[event('radio-imprecise','captured',{precise:false,own:true,position:[999999,0,999999]})];assert.equal(observe().position,null,'own imprecise radio report cannot reveal a bearing');
frame.time+=4;frame.boardingEvents=[event('muted','marine-exchange')];assert.equal(observe({allowReport:()=>false}),null);assert.equal(observe(),null,'mute consumes missed combat');
frame.time+=4;frame.boardingEvents=[event('casualty-a','casualty')];assert(observe());frame.time+=.2;frame.boardingEvents=[event('casualty-b','casualty')];assert.equal(observe(),null,'actual casualties coalesce');frame.time+=4;assert.equal(observe(),null,'coalesced event never queues');
frame.time+=4;frame.boardingEvents=[event('end-exchange','marine-exchange'),event('end-secured','section-secured'),event('end-capture','captured')];assert.equal(observe().kind,'captured','real result outranks simultaneous casualty/section exchange, never queues suppressed events');assert.equal(observe(),null);
frame.time+=4;frame.boardingEvents=[event('late','hull-breach',{at:frame.time-1})];assert.equal(observe(),null,'no newly disclosed historical breach');
assert.equal(observe({running:false}),null);frame.time++;frame.boardingEvents=[event('paused','pod-launch')];assert.equal(observe(),null);
frame.enabled=false;observe();frame.enabled=true;assert.equal(observe(),null);frame.time=1;assert.equal(observe(),null);assert.equal(observe({systemId:'away'}),null);assert.equal(observe(),null);
for(let n=0;n<400;n++){frame.time++;frame.boardingEvents=[event('bounded-'+n,'marine-exchange',{partyId:'party'+n})];observe();assert(state.seen.size<=256&&state.cooldowns.size<=96);}
for(const shape of Object.values(BOARDING_ACCENTS))assert(shape.gain<=.5&&shape.duration<=.95&&shape.cutoff<=850);
// Actual finite marine contest/rejections: no invented physical touchdown producer.
const source={id:'u1',faction:'player',type:'frigate',systemId:'s0',x:0,z:0,marines:24,hp:100,maxHp:100};
const target={id:'t1',faction:'enemy',type:'frigate',kind:'cargo',systemId:'s0',x:20,z:0,hp:100,maxHp:100,crew:8};
const game={time:10,nextId:1,units:[source],boardings:[],systems:[],factions:{player:{research:{},capturedFactions:[]},enemy:{research:{}}}};
assert.equal(beginBoarding(game,source,{...target,x:1000}).ok,false);assert.equal(source.marines,24);assert.equal(game.boardings.length,0);
assert.equal(beginBoarding(game,source,{...target,faction:'player'}).ok,false);assert.equal(source.marines,24);
assert.equal(beginBoarding(game,source,target).ok,true);assert.equal(source.marines,0);const b=game.boardings[0],before={marines:b.marines,defenders:b.defenders};
tickBoarding(game,0,{target:()=>target,event(){},capture(){}});assert.equal(b.marines,before.marines);assert.equal(b.defenders,before.defenders);
let captured=0;const hooks={target:()=>target,event(){},capture(){captured++;}};tickBoarding(game,1,hooks);assert.equal(b.stage,'transfer');assert.equal(b.marines,before.marines);assert.equal(b.defenders,before.defenders,'physical transfer cannot fake marine exchange');assert.equal(b.pods.length,4);tickBoarding(game,5,hooks);assert.equal(b.stage,'assault');assert(b.marines<before.marines&&b.defenders<before.defenders,'actual docking boundary begins real contest exchange');
for(let i=0;i<40&&b.phase==='fighting';i++)tickBoarding(game,1,{target:()=>target,event(){},capture(){captured++;}});assert.equal(b.phase,'captured');assert.equal(captured,1);assert.equal(beginBoarding(game,{...source,marines:5},target).ok,false);
console.log('PASS boarding audio policy: actual finite marine acceptance/rejections/contest; event-only failclosed boarding observer, baselines/no history/mute/secrecy/cadence/bounds. Actual7d2 transfer/assault producer costs proved; disclosed event bridge still pending author contract.');
