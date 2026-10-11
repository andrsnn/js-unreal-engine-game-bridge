import assert from 'node:assert/strict';
import { navalThreat, takeVariant, hullTailWeight, observeSensorContacts, observeActiveScan, guidedMotorRange, distantMotorShape, solarAudioState, observeDiscoveryIntel, canonicalReceiverReport, observeEwEvents } from '../src/audio-policy.js';
const ship = (hp, faction = 'player', systemId = 'home') => ({ hp, maxHp: 100, faction, systemId });
const missile = (systemId = 'home', done = false) => ({ systemId, obj: { userData: { done } } });
const options = { running: true, audible: id => id === 'home', recentFire: true };
const normal = navalThreat([ship(100)], [], options);
const danger = navalThreat([ship(20)], [missile(), missile()], options);
assert(danger.danger > normal.danger && danger.intensity > normal.intensity);
assert.equal(danger.critical, 1);
assert.equal(navalThreat([ship(20, 'enemy'), ship(10, 'player', 'remote')], [missile('remote'), missile('home', true)], options).danger, 0);
assert.deepEqual(navalThreat([ship(20)], [missile()], { ...options, running: false }), { intensity: 0, danger: 0, threats: 0, critical: 0 });
assert.equal(navalThreat([ship(20)], [], { ...options, recentFire: false }).danger, 0, 'A damaged idle hull should not hold battle music forever');
assert.equal(navalThreat([ship(100)], [{ ...missile(), owner: { faction: 'player' } }], options).threats, 0, 'Friendly launches should not sound like an inbound threat');
assert.equal(navalThreat([ship(100)], [{ ...missile(), obj: { userData: { targetEntity: ship(100, 'enemy') } } }], options).threats, 0);
const files = ['a', 'b', 'c', 'd'], state = {}; let previous;
for (let bag = 0; bag < 100; bag++) {
 const cycle = [];
 for (let i = 0; i < files.length; i++) { const next = takeVariant(files, state); assert.notEqual(next, previous); cycle.push(next); previous = next; }
 assert.equal(new Set(cycle).size, files.length);
}
assert.equal(takeVariant([], {}), null); assert.equal(takeVariant(['one'], {}), 'one');
assert.equal(hullTailWeight(100), 0); assert(hullTailWeight(600) > hullTailWeight(300)); assert.equal(hullTailWeight(10000), .65);
const receiver = {}, receiverOptions = { enabled: true, scope: 'home' };
const echo = (confidence, uncertainty = 152 - 140 * confidence, id = 'bogey') => ({ id, confidence, uncertainty, identified: confidence >= .72 });
const listen = (contacts, at, options = receiverOptions) => observeSensorContacts(contacts, receiver, at, options);
assert.equal(listen([echo(.8)],0).event,null,'Saved contacts are baseline, not invented acquisitions');
listen([],6);listen([],12);
assert.equal(listen([echo(.11)],13).event.kind,'detected');
assert.equal(listen([echo(.75)],14).event,null,'Global report cadence gates fast acquisition');
assert.equal(listen([echo(.75)],17).event.kind,'acquired','One pending acquisition survives the short report interval');
for(let tick=0;tick<1000;tick++) assert.equal(listen([echo(.7+(tick%2)*.04)],18+tick*.01).event,null,'Confidence jitter must not replay acquisition');
assert.equal(listen([echo(.55)],30).event.kind,'uncertain','Substantial real uncertainty growth reports once');
assert.equal(listen([echo(.25)],31).event,null,'Same uncertainty drift respects its per-contact cooldown');
assert.equal(listen([echo(.25)],40).event,null);
assert(listen([echo(.15)],41).tension>listen([echo(.9)],42).tension);
assert.equal(listen([echo(.9)],43,{...receiverOptions,scope:'away'}).event,null,'View entry consumes preexisting observations');
assert.equal(listen([echo(.9)],44,{...receiverOptions,enabled:false}).tension,0);
assert.equal(listen([echo(.15)],45).event,null,'Resume has no backlog');
listen([],46);const fleet=Array.from({length:40},(_,i)=>echo(.2,120,'fleet'+i));
assert(listen(fleet,50).event);assert.equal(listen(fleet,54).event,null,'Simultaneous fleet detections are not queued');
listen(Array.from({length:2000},(_,i)=>echo(.2,120,'cap'+i)),60);assert(receiver.tracks.size<=512);
listen([],121);assert.equal(receiver.tracks.size,0,'Old contact identities expire');
const deepReceiver={},deepOptions={enabled:true,scope:'solar'};
observeSensorContacts([echo(.5,1000,'deep')],deepReceiver,0,deepOptions);
assert.equal(observeSensorContacts([echo(.5,1050,'deep')],deepReceiver,4,deepOptions).event,null,'Solar-scale uncertainty jitter is not a new report');
assert.equal(observeSensorContacts([echo(.4,1400,'deep')],deepReceiver,5,deepOptions).event.uncertainty,1400,'Actual distant uncertainty is retained beyond legacy152m cap');
assert.equal(guidedMotorRange('torpedo'),4800);assert.equal(guidedMotorRange('nuclear'),4800);assert.equal(guidedMotorRange('swarm'),1000);
assert.equal(distantMotorShape(1000).gain,.028);
assert(distantMotorShape(4000).gain<distantMotorShape(1500).gain);
assert(distantMotorShape(4000).cutoff<distantMotorShape(1500).cutoff);
const scans={},scan={id:'actual-scan',systemId:'home',disclosed:true,precise:true,position:[0,25,0],mode:'ping',startedAt:1,duration:3};
const frame={enabled:true,systemId:'home',time:1,scans:[scan]};const scanBytes=JSON.stringify(frame);
assert.equal(observeActiveScan(frame,scans,true),null,'Existing scans baseline silently');
frame.time=4;frame.scans=[{...scan,startedAt:4}];assert.equal(observeActiveScan(frame,scans,true).kind,'ping');
for(let tick=0;tick<100;tick++)assert.equal(observeActiveScan(frame,scans,true),null,'Frozen simulation time does not replay a scan');
frame.time=8;frame.scans=[{...scan,startedAt:8,mode:'sweep'}];assert.equal(observeActiveScan(frame,scans,true).kind,'sweep');
for(const bad of [{disclosed:false,observed:true},{precise:false},{systemId:'hidden'},{position:[NaN,0,0]},{duration:0},{startedAt:20},{startedAt:1}]) {
 frame.time+=.1;frame.scans=[{...scan,startedAt:frame.time,...bad}];assert.equal(observeActiveScan(frame,scans,true),null,'Invalid/hidden/future/expired scan must fail closed');
}
assert.equal(observeActiveScan(frame,scans,false),null);
frame.scans=[{...scan,startedAt:frame.time}];assert.equal(observeActiveScan(frame,scans,true),null,'Paused emission cannot replay on resume');
assert.equal(scanBytes,JSON.stringify({...frame,time:1,scans:[scan]}),'Audio scan policy does not alter authoritative entries');
console.log('Audio policy passed: local threat/damage, 100 shuffled bags, sensor threshold hysteresis/4s reports/18s per-kind gates/512 tracked identities, saved-view-pause baseline, distant motor range and rolloff.');

const solarCamera={x:0,y:0,z:0},solarOptions={running:true,systemId:'home'};
const solarTraffic={id:'supply-1',kind:'drone',systemId:'home',disclosed:true,precise:true,confidence:1,position:[30,0,0],motorActive:true,throttle:1};
const solarIntel={enabled:true,systemId:'home',traffic:[solarTraffic],interference:[{...solarTraffic,kind:'ecm',strength:1}]};
const telemetryBytes=JSON.stringify(solarIntel);
assert.equal(solarAudioState(solarIntel,solarCamera,solarOptions).traffic.length,1);
assert(solarAudioState(solarIntel,solarCamera,solarOptions).ecm>0);
for(const change of [{motorActive:false},{motorActive:undefined},{throttle:0},{runningCold:true},{done:true},{precise:false},{disclosed:false},{confidence:.09},{systemId:'away'},{id:null},{position:[NaN,0,0]},{position:[4900,0,0]}])
 assert.equal(solarAudioState({...solarIntel,traffic:[{...solarTraffic,...change}]},solarCamera,solarOptions).traffic.length,0,'Traffic power/disclosure must fail closed');
assert.deepEqual(solarAudioState(solarIntel,solarCamera,{...solarOptions,running:false}),{ecm:0,traffic:[]});
assert.deepEqual(solarAudioState({...solarIntel,enabled:false},solarCamera,solarOptions),{ecm:0,traffic:[]});
assert.equal(solarAudioState({...solarIntel,interference:[{...solarIntel.interference[0],kind:'decoy'}]},solarCamera,solarOptions).ecm,0,'Decoy disclosure is not ECM power');
assert.equal(solarAudioState({...solarIntel,interference:[{...solarIntel.interference[0],strength:0}]},solarCamera,solarOptions).ecm,0);
assert.equal(solarAudioState({...solarIntel,traffic:Array.from({length:1000},(_,i)=>({...solarTraffic,id:i,position:[100-i,0,0]}))},solarCamera,solarOptions).traffic.length,2,'Bounded nearest traffic selection');
assert.equal(solarAudioState({...solarIntel,traffic:[solarTraffic,solarTraffic]},solarCamera,solarOptions).traffic.length,1,'Stable identity deduplicates supply emitter');
assert.equal(JSON.stringify(solarIntel),telemetryBytes,'Audio never writes supply/ECM simulation state');
console.log('Solar audio policy passed: strict powered/disclosed traffic, current-system/precise/range validation, nearest-two and bounded input, ECM strength only, no mutation.');

const discoveryFrame={enabled:true,systemId:'home',time:1,discoveries:[]},discoveryState={},discoveryOptions={running:true,systemId:'home',allowReport:true};
const signal={id:'real-signal',systemId:'home',disclosed:true,position:[300,20,0],precise:false,confidence:.12,uncertainty:800,identified:false,kind:'signal',method:'passive',discoveredAt:1};
const discover=()=>observeDiscoveryIntel(discoveryFrame,discoveryState,discoveryOptions);
assert.equal(discover().event,null);discoveryFrame.time=2;discoveryFrame.discoveries=[signal];
assert.equal(discover().event.kind,'discovery-detected');
for(let tick=0;tick<1000;tick++){discoveryFrame.time+=.1;signal.discoveredAt=discoveryFrame.time;signal.confidence=.2+(tick%2)*.1;assert.equal(discover().event,null,'Updated observation timestamps/strength are not timed hints');}
signal.confidence=.79;signal.identified=true;assert.equal(discover().event,null,'Identification requires real .8 threshold and flag');
signal.confidence=.8;assert.equal(discover().event.kind,'discovery-identified');
signal.confidence=.11;assert.equal(discover().event,null);signal.confidence=.9;assert.equal(discover().event,null,'Known surveys do not reacquire on confidence jitter');
signal.kind='guardian';signal.reward={secret:999};signal.truePosition=[20000,0,0];assert.equal(discover().event,null,'Classification/reward/raw position never drive sound');
for(const change of [{disclosed:false},{confidence:.119},{systemId:'away'},{id:null},{position:[NaN,0,0]}]){discoveryFrame.discoveries=[{...signal,id:'bad',...change}];assert.equal(discover().event,null);}
observeDiscoveryIntel(discoveryFrame,discoveryState,{...discoveryOptions,running:false});discoveryFrame.discoveries=[signal];assert.equal(discover().event,null,'Paused/saved view resumes silently');
const restored={};assert.equal(observeDiscoveryIntel(discoveryFrame,restored,discoveryOptions).event,null,'Saved discoveries are baseline');
discoveryFrame.discoveries=[signal,{...signal,id:'pending',confidence:.2,identified:false}];
assert.equal(observeDiscoveryIntel(discoveryFrame,restored,{...discoveryOptions,allowReport:false}).event,null);
assert.equal(observeDiscoveryIntel(discoveryFrame,restored,discoveryOptions).event.kind,'discovery-detected','One real transition may wait for shared receiver cadence');
discoveryFrame.time=0;assert.equal(observeDiscoveryIntel(discoveryFrame,restored,discoveryOptions).event,null,'Restoring older simulation cannot emit backlog');
for(const text of ['SIGNAL DETECTED · REMOTE','SURVEY IDENTIFIED · REMOTE','RECOVERY COMPLETE · REMOTE','ACTIVE PING · EXPOSED'])assert(canonicalReceiverReport(text));
assert(!canonicalReceiverReport('INSUFFICIENT FUEL'));assert(!canonicalReceiverReport('RECOVERY TEAM AWAY · 20s'));
console.log('Discovery policy passed: disclosed-only .12/.8 transitions, 1000 observation ticks silent, baseline/rewind/pause, unknown classification secrecy and canonical report coalescing.');

const ewFrame={enabled:true,systemId:'home',time:1,ewEvents:[]},ewState={},ewOptions={running:true,systemId:'home',allowReport:true};
const divert=()=>observeEwEvents(ewFrame,ewState,ewOptions);
const diversion={id:'actual-diversion',kind:'decoy-diversion',systemId:'home',disclosed:true,observed:true,at:2,position:[40,0,0],source:'seeker'};
assert.equal(divert(),null);ewFrame.time=2;ewFrame.ewEvents=[diversion];assert.equal(divert().kind,'decoy-diversion');
for(let tick=0;tick<1000;tick++)assert.equal(divert(),null,'Same explicit event ID cannot replay at frozen frame time');
const saved={};assert.equal(observeEwEvents(ewFrame,saved,ewOptions),null,'Restored recent diversion is baseline');
for(const bad of [{disclosed:false},{observed:false},{systemId:'away'},{at:99},{at:-50},{position:[NaN,0,0]},{id:null},{kind:'decoy-exists'}]){
 ewFrame.time+=.1;ewFrame.ewEvents=[{...diversion,id:'bad'+ewFrame.time,at:ewFrame.time,...bad}];assert.equal(divert(),null,'No hidden/remote/invalid/expired/counter-only event');
}
ewFrame.time+=1;ewFrame.ewEvents=[{...diversion,id:'late',at:2}];assert.equal(divert(),null,'Previously hidden event disclosed late cannot replay a historic outcome');
ewFrame.time+=1;ewFrame.ewEvents=[{...diversion,id:'cadence',at:ewFrame.time}];assert.equal(observeEwEvents(ewFrame,ewState,{...ewOptions,allowReport:false}),null);
assert.equal(divert().id,'cadence');
ewFrame.time+=1;ewFrame.ewEvents=[{...diversion,id:'paused',at:ewFrame.time}];assert.equal(observeEwEvents(ewFrame,ewState,{...ewOptions,running:false}),null);assert.equal(divert(),null);
ewFrame.time=0;assert.equal(divert(),null,'Time rewind baselines events');
console.log('EW receiver policy passed: real explicit player-observed event only, stable ID/late-event dedup, 1000frozen ticks, cadence/pause/load/rewind/remote validation.');

ewFrame.time=1;ewFrame.ewEvents=[];assert.equal(divert(),null);
ewFrame.time=2;ewFrame.ewEvents=[{...diversion,id:'paid-recovery',kind:'recovery-complete',at:2}];assert.equal(divert().kind,'recovery-complete');assert.equal(divert(),null);
