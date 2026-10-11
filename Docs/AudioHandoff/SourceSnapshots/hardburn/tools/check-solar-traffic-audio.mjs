import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as THREE from 'three';
import {emissions} from '../src/game/electronic-warfare.js';
import {repairDroneNozzle} from '../src/scene/repair-drone-view.js';

// Exercise the real campaign adapter with physical nozzle transforms, without
// booting a campaign or editing any saved simulation state.
const source=readFileSync(new URL('../src/game/galactic-campaign.js',import.meta.url),'utf8');
const adapter=source.slice(source.indexOf(' world.solarIntel=()=>{'),source.indexOf(' const solarEffects='));
assert.ok(adapter.startsWith(' world.solarIntel='));
const state={activeSystem:'s0',solarVersion:1,mapOpen:false,time:42,contacts:{},solarScans:[]};
const convoyShips=new Map(),repairView={targets:new Map()},world={};
const mount=new Function('world','state','units','convoyShips','repairView','THREE','emissions','repairDroneNozzle','campaignHostile','designOpen',adapter);
mount(world,state,new Map(),convoyShips,repairView,THREE,emissions,repairDroneNozzle,(a,b)=>a!==b,false);
function tanker(id,faction='player'){
 const grp=new THREE.Group(),model=new THREE.Group();grp.add(model);
 model.userData.driveRig={engines:[{point:[0,0,-2],normal:[0,0,-1]}]};
 return {grp,model,pos:grp.position,systemId:'s0',faction,supplyConvoy:{id},campaignUnit:{runningCold:false},driveBurn:0};
}
const ship=tanker('paid-courier');convoyShips.set('paid-courier',ship);
const root=new THREE.Group(),body=new THREE.Group(),nozzle=new THREE.Group();
nozzle.name='service-drive-nozzle';nozzle.userData.rearAxisLocal=[0,0,-1];nozzle.visible=false;
body.add(nozzle);root.add(body);root.userData.body=body;
const drone={grp:root,pos:root.position,systemId:'s0',faction:'player',repairDrone:{id:'paid-drone'}};
repairView.targets.set('paid-drone',drone);
const traffic=()=>world.solarIntel().traffic;
assert.deepEqual(traffic().map(t=>[t.id,t.motorActive,t.throttle,t.runningCold]),[['paid-courier',false,0,false],['paid-drone',false,0,false]],'stationary/coasting traffic cannot advertise power');
ship.driveBurn=.035;assert.equal(traffic()[0].motorActive,false);
ship.driveBurn=.036;ship.campaignUnit.runningCold=true;nozzle.visible=true;
assert.deepEqual(traffic().map(t=>[t.id,t.motorActive,t.throttle,t.runningCold]),[['paid-courier',true,.036,true],['paid-drone',true,1,false]]);
ship.pos.set(100,0,-50);ship.grp.rotation.y=1.2;root.position.set(-50,2,70);root.rotation.y=.8;
assert.deepEqual(traffic().map(t=>t.id),['paid-courier','paid-drone'],'moving/turning craft retain their ledger identity');
ship.driveBurn=0;nozzle.visible=false;assert.ok(traffic().every(t=>!t.motorActive&&t.throttle===0),'real coast/motor shutdown clears audio power immediately');
const hidden=tanker('hidden','enemy');hidden.driveBurn=1;convoyShips.set('hidden',hidden);
state.contacts.hidden={confidence:.8,identified:false,x:25,z:40};
assert.equal(traffic().length,2,'uncertain enemy track cannot expose precise traffic or its motor');
state.contacts.hidden.identified=true;assert.equal(traffic().length,3);
hidden.systemId='s1';assert.equal(traffic().length,2);
drone.dead=true;assert.equal(traffic().length,1,'destroyed service craft disappear');
state.mapOpen=true;assert.equal(traffic().length,0,'solar audio adapter closes outside local view');
console.log('PASS actual solar traffic identity, burn threshold, physical service motor, immediate coast and disclosure gates');
