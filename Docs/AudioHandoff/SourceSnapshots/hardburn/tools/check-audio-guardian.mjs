// Pure policy + actual committed producers. CPU fixtures, not a filmed encounter.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {GUARDIAN_ACCENTS,observeGuardianAudio} from '../src/audio-guardian.js';
import {createCampaign} from '../src/game/campaign-state.js';
import {ensureReconGuardians} from '../src/game/solar-recon.js';
import {tickSolarGuardians,disclosedGuardianEvents,recordGuardianEvent} from '../src/game/solar-guardians.js';
import {provisionUnit} from '../src/game/logistics.js';
const body=(id,kind)=>({id,kind,systemId:'s0',disclosed:true,precise:true,identified:true,confidence:.9,position:[0,20,0]});
const attack=(id,g,kind,at,extra={})=>({id,guardianId:g.id,sourceId:g.id,systemId:'s0',disclosed:true,observed:true,precise:true,confidence:.9,position:[40,20,0],direction:[0,1,0],kind,at,...extra});
const frame={enabled:true,systemId:'s0',time:100,guardians:[body('s','sentinel'),body('g','growth'),body('m','mining-swarm'),body('w','warlord'),body('d','derelict')],guardianEvents:[]},state={};
const observe=(extra={})=>observeGuardianAudio(frame,state,{running:true,systemId:'s0',listener:[40,20,0],...extra});
frame.guardianEvents=[attack('loaded',frame.guardians[0],'pulse',100,{radius:550})];assert.equal(observe(),null);
for(const [i,accent,kind,extra] of [[0,'pulse','pulse',{radius:550}],[1,'feeding','growth',{growth:.2}],[2,'mining','mining',{}],[3,'warlord','flak',{}],[4,'derelict','turret',{}]]){
 frame.time+=10;frame.guardianEvents=[attack('live-'+accent,frame.guardians[i],kind,frame.time,extra)];const e=observe();assert.equal(e.accent,accent);assert.deepEqual(e.position,[40,20,0]);assert.equal(observe(),null,'stable ID never repeats');
}
const g=frame.guardians[1];frame.time+=10;frame.guardianEvents=[attack('feeding-a',g,'growth',frame.time,{growth:.3})];assert.equal(observe().accent,'feeding');
frame.time+=2;frame.guardianEvents=[attack('feeding-b',g,'growth',frame.time,{growth:.4})];assert.equal(observe(),null,'real two-second feed records coalesce to an eight-second accent');
frame.time+=10;assert.equal(observe(),null,'suppressed feeding cannot become a queued historical cue');
frame.guardianEvents=[attack('muted',g,'growth',frame.time,{growth:.4})];assert.equal(observe({allowReport:false}),null);assert.equal(observe(),null,'unmute never replays missed attacks');
for(const bad of [{disclosed:false},{observed:false},{precise:false},{confidence:.71},{sourceId:null},{systemId:'remote'},{position:[NaN,0,0]},{direction:[0,0,Infinity]},{position:[1900,20,0]},{at:frame.time+1}]){
 frame.guardianEvents=[attack('bad-'+JSON.stringify(bad),frame.guardians[0],'pulse',frame.time,{radius:550,...bad})];assert.equal(observe(),null);
}
frame.time+=10;frame.guardians[0].confidence=.2;frame.guardianEvents=[attack('hidden-body',frame.guardians[0],'pulse',frame.time,{radius:550})];assert.equal(observe(),null);frame.guardians[0].confidence=.9;assert.equal(observe(),null,'later body disclosure does not replay an old pulse');
frame.time+=10;frame.guardianEvents=[attack('late-source',frame.guardians[0],'pulse',frame.time-1,{radius:550})];assert.equal(observe(),null,'old newly disclosed source cannot hint at earlier fire');
assert.equal(observe({running:false}),null);frame.time+=1;frame.guardianEvents=[attack('during-pause',g,'growth',frame.time,{growth:.5})];assert.equal(observe(),null,'resume establishes silent baseline');
frame.enabled=false;assert.equal(observe(),null);frame.enabled=true;assert.equal(observe(),null,'map/design return establishes silent baseline');
frame.time=1;assert.equal(observe(),null,'save/rewind baseline silent');
assert.equal(observe({systemId:'remote'}),null);assert.equal(observe(),null,'system-return baseline silent');
for(let n=0;n<400;n++){frame.time++;frame.guardianEvents=[attack('bounded-'+n,g,'growth',frame.time,{growth:.6})];observe();assert(state.seen.size<=256);assert(state.cooldowns.size<=96);}
for(const spec of Object.values(GUARDIAN_ACCENTS)){assert(spec.duration<=1.3&&spec.cutoff<=750&&spec.gain<=.32);}

// Exercise real paid simulation kernels and their actual disclosure filter.
const game=createCampaign(808202,7);ensureReconGuardians(game);
const sites=game.recon.sites.filter(s=>s.kind==='guardian'),sentinel=sites.find(s=>s.guardianKind==='sentinel');
const actor=u=>({campaignUnit:u,faction:u.faction,systemId:u.systemId,pos:{x:u.x,y:20,z:u.z},hp:1000,maxHp:1000,systems:{reactor:1}});
const core=actor(game.units.find(u=>u.id===sentinel.guardianId)),victim=game.units.find(u=>u.faction==='player');victim.systemId=sentinel.systemId;
const target=actor(victim);target.pos={x:core.pos.x,y:20,z:core.pos.z+400};sentinel.intel.player={identified:true,confidence:1};
const fuel=provisionUnit(core.campaignUnit).fuel;game.time=100;tickSolarGuardians(game,1,[core,target]);assert.equal(game.guardianEvents?.length??0,0);
game.time=104;tickSolarGuardians(game,1,[core,target]);assert.equal(provisionUnit(core.campaignUnit).fuel,fuel-20);assert.equal(victim.empUntil,109);
const contacts={[sentinel.guardianId]:{identified:true,confidence:.9}};const events=disclosedGuardianEvents(game,sentinel.systemId,contacts);assert.equal(events.at(-1).kind,'pulse');assert.equal(events.at(-1).sourceId,sentinel.guardianId);
contacts[sentinel.guardianId].confidence=.71;assert.equal(disclosedGuardianEvents(game,sentinel.systemId,contacts).length,0);contacts[sentinel.guardianId].confidence=.9;
game.time=129;core.systems.reactor=.1;tickSolarGuardians(game,1,[core,target]);assert(!game.guardianEvents.some(e=>e.kind==='pulse'),'Offline reactor cannot invent an EMP pulse');
core.systems.reactor=1;provisionUnit(core.campaignUnit).fuel=19;game.time=130;tickSolarGuardians(game,1,[core,target]);assert(!game.guardianEvents.some(e=>e.kind==='pulse'),'Fewer than20carriedfuel cannot produce EMP');
recordGuardianEvent(game,sentinel,{sourceId:'hidden-wing',kind:'mining',position:[1,20,3],direction:[0,1,0]});contacts['hidden-wing']={identified:false,confidence:.3};assert(!disclosedGuardianEvents(game,sentinel.systemId,contacts).some(e=>e.sourceId==='hidden-wing'));
contacts['hidden-wing']={identified:true,confidence:.8};assert(disclosedGuardianEvents(game,sentinel.systemId,contacts).some(e=>e.sourceId==='hidden-wing'));assert.equal(disclosedGuardianEvents(game,'other',contacts).length,0);
const nursery=sites.find(s=>s.guardianKind==='growth'),feedingCore=actor(game.units.find(u=>u.id===nursery.guardianId));victim.systemId=target.systemId=nursery.systemId;target.pos={x:feedingCore.pos.x+100,y:20,z:feedingCore.pos.z};
const stocks=provisionUnit(victim),before=stocks.fuel;game.time=140;let damage=0;tickSolarGuardians(game,1,[feedingCore,target],{damage:(s,n)=>{assert.equal(s,target);damage+=n;}});
assert(stocks.fuel<before&&damage>0);assert.equal(game.guardianEvents.at(-1).kind,'growth');
stocks.fuel=0;game.time=143;const beforeRecords=game.guardianEvents.filter(e=>e.kind==='growth').length;tickSolarGuardians(game,1,[feedingCore,target]);assert.equal(game.guardianEvents.filter(e=>e.kind==='growth').length,beforeRecords,'empty victim fuel cannot invent feeding');
const frozen=JSON.stringify(game);tickSolarGuardians(game,0,[core,target]);assert.equal(JSON.stringify(game),frozen);

// Call the actual onLaunch closure: rejected/dead/invalid-victim guns emit nothing.
const source=readFileSync(new URL('../src/game/entities.js',import.meta.url),'utf8'),start=source.indexOf('const aimRound=state=>{'),end=source.indexOf('\n\n    if(kit===',start),code=source.slice(start,end);
assert(start>=0&&end>start);const ship={dead:false,campaignUnit:null},mount={disabled:false};let accepted=0,valid=true;
const launch=new Function('validVictim','mount','from','world','kit',code+';return aimRound;').call(ship,()=>valid,mount,new THREE.Vector3(),{recordGuardianWeapon:()=>accepted++},'rail');
const round={destination:new THREE.Vector3(1,0,0)};assert(launch(round));assert.equal(accepted,1);mount.disabled=true;assert.equal(launch(round),false);mount.disabled=false;ship.dead=true;assert.equal(launch(round),false);ship.dead=false;valid=false;assert.equal(launch(round),false);assert.equal(accepted,1);
const flak=readFileSync(new URL('../src/game/flak-screen.js',import.meta.url),'utf8'),flakCode=flak.slice(flak.indexOf('onLaunch:()=>{')+'onLaunch:'.length,flak.indexOf(',onHit:()=>{'));
let flakAccepted=0;const flakShip={dead:false,forward:new THREE.Vector3(0,0,1)},flakMount={disabled:false};
const flakLaunch=new Function('ship','mount','from','aim','world','fx','muzzleFlash','barrel','barrelSpacing','gunWorldMatrix','return '+flakCode)(flakShip,flakMount,new THREE.Vector3(),new THREE.Vector3(0,0,10),{add(){},recordGuardianWeapon(){flakAccepted++;}},{muzzle:1},()=>({}),0,1,()=>new THREE.Matrix4());
assert(flakLaunch());flakMount.canFire=false;assert.equal(flakLaunch(),false);delete flakMount.canFire;flakMount.surfaceAttached=false;assert.equal(flakLaunch(),false);delete flakMount.surfaceAttached;flakMount.disabled=true;assert.equal(flakLaunch(),false);flakMount.disabled=false;flakShip.dead=true;assert.equal(flakLaunch(),false);assert.equal(flakAccepted,1,'Actual flak onLaunch cannot report rejected/unseated/dead barrels');
console.log('PASS guardian audio: five sparse physical accents; precise current source/body gates, baselines/no history/mute/range/caps; actual paid EMP/fuel feeding/source disclosure and accepted onLaunch only. CPU fixture scope, no live/movie claim.');
