// CPU-only contract test: exercise the actual committed player-intel adapter,
// not a live campaign or a fabricated gameplay/capture outcome.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {reconIntel,reconObservers,reconAction,tickSolarRecon} from '../src/game/solar-recon.js';
import {emissions} from '../src/game/electronic-warfare.js';
import {repairDroneNozzle} from '../src/scene/repair-drone-view.js';
import {observeDiscoveryIntel,observeEwEvents} from '../src/audio-policy.js';
import {recordGuardianEvent,disclosedGuardianEvents} from '../src/game/solar-guardians.js';
import {observeGuardianAudio} from '../src/audio-guardian.js';

const source=readFileSync(new URL('../src/game/galactic-campaign.js',import.meta.url),'utf8');
const adapter=source.slice(source.indexOf(' world.solarIntel=()=>{'),source.indexOf(' const solarEffects='));
const callback=source.slice(source.indexOf(' world.recordEwDiversion='),source.indexOf(' world.findTarget='));
assert(adapter.startsWith(' world.solarIntel='));assert(callback.startsWith(' world.recordEwDiversion='));
const site={id:'actual-signal',systemId:'home',kind:'guardian',x:90000,z:90000,reward:{secret:999},intel:{player:{confidence:0,identified:false,x:320,z:440,uncertainty:500,method:'passive',observedAt:1}}};
const remote={...site,id:'remote',systemId:'away',intel:{player:{confidence:1,identified:true,x:1,z:1}}};
const state={solarVersion:1,activeSystem:'home',mapOpen:false,time:1,nextId:1,contacts:{},recon:{sites:[site,remote]},ewEvents:[]};
const world={},units=new Map(),convoyShips=new Map(),repairView={targets:new Map()};
new Function('world','state','units','convoyShips','repairView','THREE','emissions','repairDroneNozzle','campaignHostile','designOpen','reconIntel','reconObservers','disclosedGuardianEvents',adapter)
 (world,state,units,convoyShips,repairView,THREE,emissions,repairDroneNozzle,(a,b)=>a!==b,false,reconIntel,reconObservers,disclosedGuardianEvents);
new Function('world','state',callback)(world,state);
const options={running:true,systemId:'home',allowReport:true},discovery={},ew={};
assert.equal(world.solarIntel().discoveries.length,0,'Unknown and remote sites are absent from real player snapshot');
assert.equal(observeDiscoveryIntel(world.solarIntel(),discovery,options).event,null);
site.intel.player.confidence=.12;state.time=2;
let frame=world.solarIntel();assert.equal(frame.discoveries[0].kind,'signal');
assert.deepEqual(frame.discoveries[0].position,[320,20,440],'Use reported bearing, never hidden actual site coordinates');
assert.equal(observeDiscoveryIntel(frame,discovery,options).event.kind,'discovery-detected');
for(let i=0;i<100;i++){state.time+=.1;site.intel.player.observedAt=state.time;assert.equal(observeDiscoveryIntel(world.solarIntel(),discovery,options).event,null);}
site.intel.player.confidence=.8;site.intel.player.identified=true;state.time+=.1;
assert.equal(observeDiscoveryIntel(world.solarIntel(),discovery,options).event.kind,'discovery-identified');
// Actual committed snapshot must authorize the current body AND exact emitter.
site.guardianId='test-guard';site.guardianKind='sentinel';
units.set('test-guard',{faction:'guardian',systemId:'home',campaignUnit:{id:'test-guard'},pos:new THREE.Vector3(30,20,40)});
state.contacts['test-guard']={identified:true,confidence:.9};
const guardianState={},guardianOptions={running:true,systemId:'home',listener:[30,20,40]};
assert.equal(world.solarIntel().guardians.length,1);assert.equal(observeGuardianAudio(world.solarIntel(),guardianState,guardianOptions),null);
state.time+=.1;recordGuardianEvent(state,site,{kind:'pulse',position:[30,20,40],direction:[0,1,0],radius:550});
assert.equal(observeGuardianAudio(world.solarIntel(),guardianState,guardianOptions).accent,'pulse');
state.contacts['test-guard'].confidence=.2;assert.equal(world.solarIntel().guardians.length,0);assert.equal(world.solarIntel().guardianEvents.length,0);
state.contacts['test-guard'].confidence=.9;recordGuardianEvent(state,site,{kind:'mining',sourceId:'hidden-wing',position:[9000,20,9000],direction:[0,1,0]});
assert(!world.solarIntel().guardianEvents.some(e=>e.sourceId==='hidden-wing'),'Actual core disclosure cannot export a hidden wing position');
units.delete('test-guard');delete site.guardianId;delete site.guardianKind;
// Real authoritative action debits launch fuel, then the real tick pays reward
// and records completion. This is a CPU unit fixture, not gameplay evidence.
state.systems=[{id:'home',planets:[]},{id:'away',planets:[]}];
state.factions={player:{metal:0,fuel:100,research:{},findResearch:{}}};
state.units=[{id:'recovery-ship',systemId:'home',faction:'player',x:site.x,z:site.z,blueprint:{slots:[]}}];
site.reward={metal:50};const recoveryState={};observeEwEvents(world.solarIntel(),recoveryState,options);
assert.equal(reconAction(state,'recover',['recovery-ship'],site.id).ok,true);assert.equal(state.factions.player.fuel,90);
state.time+=20;tickSolarRecon(state,20,[],{report:()=>{}});assert.equal(state.factions.player.metal,50);
assert.equal(observeEwEvents(world.solarIntel(),recoveryState,options).kind,'recovery-complete');
site.claimedBy='player';assert.equal(world.solarIntel().discoveries.length,0,'Claim disappearance cannot fabricate recovery audio');
assert.equal(observeDiscoveryIntel(world.solarIntel(),discovery,options).event,null);
assert.equal(observeEwEvents(world.solarIntel(),ew,options),null);
const decoy={faction:'player',systemId:'home',pos:new THREE.Vector3(20,0,40)},attacker={radarConfidence:0};
world.recordEwDiversion(attacker,decoy);assert.equal(state.ewEvents.filter(e=>e.kind==='decoy-diversion').length,0,'Undisclosed attackers cannot disclose diversion');
attacker.radarConfidence=.1;
world.recordEwDiversion(attacker,{...decoy,faction:'enemy'});world.recordEwDiversion(attacker,{...decoy,systemId:'away'});
assert.equal(state.ewEvents.filter(e=>e.kind==='decoy-diversion').length,0,'Other factions and other systems remain inaudible');
state.time+=.1;world.recordEwDiversion(attacker,decoy,'seeker');
assert.equal(observeEwEvents(world.solarIntel(),ew,options).kind,'decoy-diversion');
assert.equal(observeEwEvents(world.solarIntel(),ew,options),null);
state.mapOpen=true;assert.equal(world.solarIntel().enabled,false);
assert.equal(observeEwEvents(world.solarIntel(),ew,options),null);
console.log('PASS actual committed solarIntel reported discovery/secrecy/threshold/observation fields and actual EW callback player/sensor/system authorisation. Retarget assignment/movie proof remains gameplay-owner scope.');
