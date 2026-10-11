// Exercise the actual mixer with a deterministic graph harness. This checks
// signal routes/controls/lifetime; root separately measures real browser PCM.
import assert from 'node:assert/strict';
import { createAudioMixer } from '../src/audio.js';
const listeners = new Map();
class Element {
 constructor() { this.children = []; this.hidden = false; this.value = 0; this.className = ''; this.dataset = {}; }
 append(...items) { this.children.push(...items); }
 remove() { this.removed = true; }
 closest() { return null; }
}
globalThis.document = {
 hidden: false, body: new Element(), createElement: () => new Element(),
 addEventListener(type, handler) { const list = listeners.get(type) ?? new Set(); list.add(handler); listeners.set(type, list); },
 removeEventListener(type, handler) { listeners.get(type)?.delete(handler); },
};
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
globalThis.fetch = async url => ({ ok: true, arrayBuffer: async () => ({ url }) });
class Param {
 constructor(value = 1) { this.value = value; this.history = []; }
 setValueAtTime(value) { this.value = value; }
 linearRampToValueAtTime(value) { this.value = value; this.history.push(value); }
 setTargetAtTime(value) { this.value = value; }
 cancelScheduledValues() {}
}
class Node {
 constructor(context, type) { this.context = context; this.type = type; this.connections = []; this.gain = new Param(); this.frequency = new Param(); this.Q = new Param(); this.pan = new Param(); this.playbackRate = new Param(); context.nodes.push(this); }
 connect(node) { this.connections.push(node); return node; }
 disconnect() { this.connections = []; this.disconnected = true; }
 start(at = this.context.currentTime, offset = 0) { this.started = true; this.startAt = at; this.offset = offset; }
 stop(at = this.context.currentTime) { this.stopAt = at; if (at <= this.context.currentTime) this.end(); }
 end() { if (!this.ended) { this.ended = true; this.onended?.(); } }
 getFloatTimeDomainData(data) { data.fill(0); }
}
class Context {
 constructor() { this.nodes = []; this.state = 'running'; this.currentTime = 1; this.sampleRate = 48000; this.destination = new Node(this, 'destination'); }
 createGain() { return new Node(this, 'gain'); }
 createDynamicsCompressor() { const node = new Node(this, 'compressor'); for (const key of ['threshold','knee','ratio','attack','release']) node[key] = new Param(); return node; }
 createWaveShaper() { return new Node(this, 'limiter'); }
 createAnalyser() { return new Node(this, 'meter'); }
 createBiquadFilter() { return new Node(this, 'filter'); }
 createConvolver() { return new Node(this, 'convolver'); }
 createStereoPanner() { return new Node(this, 'pan'); }
 createBufferSource() { return new Node(this, 'source'); }
 createBuffer(channels, length) { const data = Array.from({ length: channels }, () => new Float32Array(length)); return { getChannelData: index => data[index] }; }
 async decodeAudioData(bytes) { return { duration: 53.333333, url: bytes.url }; }
 async resume() { this.state = 'running'; }
 async suspend() { this.state = 'suspended'; }
 async close() { this.state = 'closed'; }
 advance(seconds) { this.currentTime += seconds; for (const node of [...this.nodes]) if (node.started && node.stopAt <= this.currentTime) node.end(); }
}
globalThis.AudioContext = Context;
const position = { x: 0, y: 0, z: 0, distanceToSquared: camera => camera.x ** 2 + camera.y ** 2 + camera.z ** 2 };
const friendly = { type: 'frigate', faction: 'player', hp: 100, maxHp: 100, pos: position, grp: { id: 1 }, systemId: 'home' };
const world = { speed: 1, fleets: new Map([['fleet', { members: [friendly] }]]), missiles: [] };
const mixer = createAudioMixer(world, { cam: { position: { x: 80, y: 0, z: 0 }, matrixWorld: { elements: [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1] } } });
await mixer.preload; mixer.update(); assert.equal(mixer.stats.audioPass, 12); assert.equal(mixer.stats.musicLoops, 6);
const context = mixer.context; assert.equal(context.nodes.filter(node => node.type === 'convolver').length, 4);
const outputTrim = context.nodes.find(node => node.type === 'gain' && node.gain.value === .69);
assert(outputTrim); assert.equal(mixer.stats.outputTrim, .69);
const limiter = context.nodes.find(node => node.type === 'limiter');
const meter = context.nodes.find(node => node.type === 'meter');
assert.deepEqual(limiter.connections, [outputTrim], 'Fixed calibration must follow limiting');
assert.deepEqual(outputTrim.connections, [meter], 'Meter and recording must observe the actual calibrated output');
const vector = (x = 0) => ({ x, y: 0, z: 0, distanceToSquared: other => (x-other.x)**2+other.y**2+other.z**2, distanceTo: other => Math.hypot(x-other.x,other.y,other.z) });
world.missiles = Array.from({ length: 5 }, (_, i) => ({ systemId: 'home', owner: friendly, obj: { id: 100+i, position: vector(i*40), userData: { motorActive: true, targetEntity: { pos: vector(10) } } } }));
friendly.driveBurn = 1; context.advance(.2); mixer.update();
assert.equal(mixer.stats.guidedLoops, 2, 'Only two nearest closing motor loops may play');
assert.equal(mixer.stats.engineLoops, 1, 'Powered drive should carry the continuous rumble');
const motorSources = context.nodes.filter(node => node.type === 'source' && node.loop).slice(-3);
assert(motorSources.some(source => pathGains(source).some(gain => gain > 0)));
mixer.setLevel('engines', 0); mixer.setLevel('weapons', 0);
for (const source of motorSources) assert(pathGains(source).every(gain => gain === 0), 'Engine/weapon controls must silence all continuous motors');
mixer.setLevel('engines', 1); mixer.setLevel('weapons', 1);
world.speed = 0; context.advance(.2); mixer.update();
assert.equal(mixer.stats.guidedLoops, 0, 'Pause must stop closing motors');
world.speed = 1; world.missiles = []; friendly.driveBurn = 0;
context.advance(.4); mixer.update();
assert.equal(mixer.stats.acousticProfile, 'small');
world.bridgeView = true; context.advance(.2); mixer.update(); assert.equal(mixer.stats.acousticProfile, 'bridge');
function pathGains(node, product = 1) {
 if (node.type === 'gain') product *= node.gain.value;
 if (node === context.destination) return [product];
 return node.connections.flatMap(next => pathGains(next, product));
}
// Actual receiver observation: only rendered local radar contacts qualify.
world.campaign={activeSystem:'home',mapOpen:false,contacts:{},events:[{kind:'economy',text:'Existing campaign history'}]};
world.galactic={units:new Map([['friendly',friendly]]),radarContacts:new Map()};
context.advance(10);mixer.update();const sensorBefore=mixer.stats.sensorPings;
const undisclosedCueStart=mixer.stats.played;
world.campaign.events.push({kind:'sensor',text:'FALSE DRIVE SIGNALS EMITTED · UNOBSERVED REMOTE FACTION'});
context.advance(.11);mixer.update();
assert.equal(mixer.stats.played,undisclosedCueStart,'Global hidden/remote spoof log must not disclose an enemy decoy through audio');
assert.equal(mixer.stats.sensorPings,sensorBefore);
const radarGroup={visible:true,userData:{sensorEntity:{dead:false,campaignUnit:{transit:null}}}};
world.galactic.radarContacts.set('bogey',{group:radarGroup});
world.campaign.contacts.bogey={confidence:.11,uncertainty:137,identified:false,systemId:'home'};
world.campaign.events.push({kind:'sensor',text:'INBOUND DRIVE CONTACT · SOURCE → HOME · CORRIDOR ETA 120s'});
context.advance(.2);let sensorNodes=context.nodes.length;mixer.update();
assert.equal(mixer.stats.sensorPings,sensorBefore+1);assert.equal(mixer.stats.lastSensorEvent.kind,'detected');
assert.equal(mixer.stats.cues.contact??0,0,'Actual same-tick ingress sensor log must not duplicate the receiver sample');
const receiverSource=context.nodes.slice(sensorNodes).find(node=>node.type==='source'&&node.buffer.url.includes('/contact-'));
assert(receiverSource);assert(receiverSource.connections[0].frequency.value<=850);
mixer.setLevel('alerts',0);assert(pathGains(receiverSource).every(gain=>gain===0),'Receiver reports follow Alerts including master route');mixer.setLevel('alerts',1);
world.campaign.contacts.bogey={confidence:.8,uncertainty:40,identified:true,systemId:'home'};
context.advance(.2);mixer.update();assert.equal(mixer.stats.sensorPings,sensorBefore+1);
context.advance(4);mixer.update();assert.equal(mixer.stats.lastSensorEvent.kind,'acquired');
const stablePings=mixer.stats.sensorPings;
for(let tick=0;tick<100;tick++){world.campaign.contacts.bogey.confidence=tick%2?.74:.69;context.advance(.11);mixer.update();}
assert.equal(mixer.stats.sensorPings,stablePings,'Per-frame confidence jitter produces no report spam');
world.campaign.contacts.bogey={confidence:.5,uncertainty:82,identified:false,systemId:'home'};context.advance(5);mixer.update();
world.campaign.contacts.bogey={confidence:.2,uncertainty:130,identified:false,systemId:'home'};context.advance(.2);mixer.update();
assert.equal(mixer.stats.lastSensorEvent.kind,'uncertain');assert(mixer.stats.sensorTension>0&&mixer.stats.sensorTension<=.55);
world.campaign.contacts.ghost={confidence:.8,uncertainty:25,identified:true,systemId:'home'};
world.galactic.radarContacts.set('remote',{group:radarGroup});world.campaign.contacts.remote={confidence:.8,uncertainty:25,identified:true,systemId:'away'};
radarGroup.visible=false;context.advance(.2);mixer.update();assert.equal(mixer.stats.sensorContacts,0,'Hidden/unrendered/remote contacts confer no audio intelligence');
const hiddenPings=mixer.stats.sensorPings;world.campaign.contacts.bogey={confidence:.8,uncertainty:40,identified:true,systemId:'home'};
context.advance(6);mixer.update();radarGroup.visible=true;context.advance(.2);mixer.update();
assert.equal(mixer.stats.sensorPings,hiddenPings,'Designer hides consume observations without fake reacquisition on return');
const pingsBeforeResume=mixer.stats.sensorPings;world.speed=0;context.advance(.2);mixer.update();radarGroup.visible=true;world.speed=1;context.advance(.2);mixer.update();
assert.equal(mixer.stats.sensorPings,pingsBeforeResume,'Paused receiver has no queued acquisition on resume');
world.campaign.activeSystem='away';context.advance(.2);mixer.update();assert.equal(mixer.stats.sensorPings,pingsBeforeResume,'View changes baseline existing contacts');
const solarFrame={enabled:true,systemId:'away',time:50,driveSignatures:[],scans:[]};world.solarIntel=()=>solarFrame;
context.advance(5);mixer.update();const activatedBefore=mixer.stats.sensorPings;
const confirmBefore=mixer.stats.cues.confirm??0;assert.equal(mixer.notify('ACTIVE PING · YOUR DRIVE CONTACT IS EXPOSED'),false);assert.equal(mixer.stats.cues.confirm??0,confirmBefore,'Actual successful PING toast cannot add a generic confirm before the real emission');
solarFrame.time=50.11;solarFrame.scans=[{id:'actual-ping',systemId:'away',disclosed:true,precise:true,position:[0,25,0],mode:'ping',startedAt:50.11,duration:3}];
world.galactic.radarContacts.set('same-ping-return',{group:radarGroup});world.campaign.contacts['same-ping-return']={confidence:.15,uncertainty:132,identified:false,systemId:'away'};
context.advance(.11);mixer.update();assert.equal(mixer.stats.sensorPings,activatedBefore+1);assert.equal(mixer.stats.lastSensorEvent.kind,'ping','Actual authorised activation sounds once and coalesces the contact return');
context.advance(4.2);mixer.update();assert.equal(mixer.stats.sensorPings,activatedBefore+1,'Paused/frozen simulation scan cannot become a timed passive pulse');
solarFrame.time=54.4;solarFrame.scans=[{...solarFrame.scans[0],id:'actual-sweep',mode:'sweep',startedAt:54.4}];
context.advance(.11);mixer.update();assert.equal(mixer.stats.lastSensorEvent.kind,'sweep');assert.equal(mixer.stats.sensorPings,activatedBefore+2);
solarFrame.enabled=false;solarFrame.time=55;solarFrame.scans=[{...solarFrame.scans[0],id:'hidden',startedAt:55}];context.advance(5);mixer.update();assert.equal(mixer.stats.sensorPings,activatedBefore+2);
solarFrame.enabled=true;context.advance(.11);mixer.update();assert.equal(mixer.stats.sensorPings,activatedBefore+2,'Hidden snapshot baseline does not leak activation');
// Actual disclosed discovery graph: passive receiver cue, no sonar/outgoing emitter.
solarFrame.discoveries=[];solarFrame.time=60;context.advance(5);mixer.update();
const discoveryBase=mixer.stats.discoveryReports,legacyDiscoveryPlayed=mixer.stats.played;
for(const text of ['SIGNAL DETECTED · REMOTE SYSTEM','SURVEY IDENTIFIED · REMOTE SITE','RECOVERY COMPLETE · REMOTE']){
 world.campaign.events.push({kind:'sensor',text});assert.equal(mixer.notify(text),false);
}
context.advance(.11);mixer.update();assert.equal(mixer.stats.played,legacyDiscoveryPlayed,'Global remote recon text must never disclose or double-play');
solarFrame.time=60.11;solarFrame.discoveries=[{id:'natural-passive',systemId:'away',disclosed:true,precise:false,position:[50000,20,50000],confidence:.12,uncertainty:1000,identified:false,kind:'signal',method:'passive',discoveredAt:60.11}];
world.campaign.events.push({kind:'sensor',text:'SIGNAL DETECTED · PASSIVE BEARING · natural-passive'});
let discoveryNodes=context.nodes.length;context.advance(.11);mixer.update();
assert.equal(mixer.stats.discoveryReports,discoveryBase+1);assert.equal(mixer.stats.lastSensorEvent.kind,'discovery-detected');
const discoveryVoice=context.nodes.slice(discoveryNodes).find(n=>n.type==='source'&&n.buffer.url.includes('/contact-'));
assert(discoveryVoice&&!discoveryVoice.loop);assert.equal(discoveryVoice.connections[0].frequency.value,650,'Quiet passive report has its own low mechanical articulation');
assert(discoveryVoice.connections[0].connections[0].connections[0].pan.value===0,'Imprecise discovery must not reveal a positional bearing');
for(let tick=0;tick<100;tick++){solarFrame.time+=.11;solarFrame.discoveries[0].discoveredAt=solarFrame.time;context.advance(.11);mixer.update();}
assert.equal(mixer.stats.discoveryReports,discoveryBase+1,'Repeated observedAt ticks cannot become a passive sonar pattern');
solarFrame.discoveries[0].confidence=.8;solarFrame.discoveries[0].identified=true;
world.campaign.events.push({kind:'sensor',text:'SURVEY IDENTIFIED · ACTUAL SURVEY'});context.advance(.11);mixer.update();
assert.equal(mixer.stats.discoveryReports,discoveryBase+2);assert.equal(mixer.stats.lastSensorEvent.kind,'discovery-identified');
solarFrame.enabled=false;solarFrame.discoveries.push({...solarFrame.discoveries[0],id:'hidden-new'});context.advance(.11);mixer.update();
solarFrame.enabled=true;context.advance(.11);mixer.update();assert.equal(mixer.stats.discoveryReports,discoveryBase+2,'View return silently baselines discoveries');
// Only explicit observed diversion, never all-world counter or decoy existence.
solarFrame.ewEvents=[];solarFrame.time+=4.2;context.advance(4.2);mixer.update();const ewBase=mixer.stats.ewReports;
world.decoyLocks=99999;solarFrame.interference=[{kind:'decoy',recognised:true,disclosed:true,position:[80,0,0],systemId:'away',confidence:1}];
solarFrame.ewEvents=[{id:'undisclosed-diversion',kind:'decoy-diversion',systemId:'away',disclosed:false,observed:true,at:solarFrame.time,position:[80,0,0]}];
context.advance(.11);mixer.update();assert.equal(mixer.stats.ewReports,ewBase,'Hidden/other-faction decoys and global counter do not produce outcome feedback');
solarFrame.time+=.11;solarFrame.ewEvents=[{id:'observed-physical-retarget',kind:'decoy-diversion',systemId:'away',disclosed:true,observed:true,at:solarFrame.time,position:[80,0,0],source:'seeker'}];
const ewNodes=context.nodes.length;context.advance(.11);mixer.update();assert.equal(mixer.stats.ewReports,ewBase+1);assert.equal(mixer.stats.lastSensorEvent.kind,'decoy-diversion');
const ewVoice=context.nodes.slice(ewNodes).find(n=>n.type==='source'&&n.buffer.url.includes('/contact-'));assert(ewVoice&&!ewVoice.loop&&ewVoice.connections[0].frequency.value===800);
assert.equal(ewVoice.connections[0].connections[0].connections[0].pan.value,0,'Diversion result is a receiver-side report, not precise enemy sonar');
for(let tick=0;tick<100;tick++){context.advance(.11);mixer.update();}assert.equal(mixer.stats.ewReports,ewBase+1,'Stable diversion event cannot be a repeating alarm');
solarFrame.time+=.11;solarFrame.ewEvents.push({...solarFrame.ewEvents[0],id:'new-real-retarget',at:solarFrame.time});
world.speed=0;context.advance(.11);mixer.update();world.speed=1;context.advance(.11);mixer.update();assert.equal(mixer.stats.ewReports,ewBase+1,'Paused diversion does not replay after resume');
// Actual paid completion has its own finite receiver articulation, once.
solarFrame.time+=4.2;context.advance(4.2);mixer.update();const recoveredBase=mixer.stats.recoveryReports;
solarFrame.time+=.11;solarFrame.ewEvents=[{id:'recovery-paid-site',kind:'recovery-complete',systemId:'away',disclosed:true,observed:true,at:solarFrame.time,position:[80,20,0]}];
world.campaign.events.push({kind:'discovery',text:'RECOVERY COMPLETE · PAID SITE'});assert.equal(mixer.notify('RECOVERY COMPLETE · PAID SITE'),false);
context.advance(.11);mixer.update();assert.equal(mixer.stats.recoveryReports,recoveredBase+1);assert.equal(mixer.stats.lastSensorEvent.kind,'recovery-complete');
for(let tick=0;tick<50;tick++){context.advance(.11);mixer.update();}assert.equal(mixer.stats.recoveryReports,recoveredBase+1);
// Actual new receiver routes: one ECM hiss + two strict powered supply motors.
solarFrame.interference=[{systemId:'away',disclosed:true,kind:'ecm',confidence:1,strength:1,position:[80,0,0]}];
solarFrame.traffic=Array.from({length:40},(_,i)=>({id:'supply-'+i,systemId:'away',disclosed:true,precise:true,kind:i%2?'tanker':'drone',confidence:1,position:[80+i*20,0,0],motorActive:true,throttle:1}));
let solarNodeStart=context.nodes.length;context.advance(.006);mixer.update();
assert.equal(mixer.stats.ecmLoops,1);assert.equal(mixer.stats.trafficLoops,2);
const solarSources=context.nodes.slice(solarNodeStart).filter(n=>n.type==='source'&&n.loop);
assert.equal(solarSources.length,3,'Forty actual supply emitters use only two propulsion voices and one receiver');
const ecmSource=solarSources.find(n=>n.buffer.url.includes('shipboard'));
assert(ecmSource&&ecmSource.connections[0].type==='highpass'&&ecmSource.connections[0].frequency.value===180);
assert(pathGains(ecmSource).some(g=>g>0));mixer.setLevel('ambience',0);assert(pathGains(ecmSource).every(g=>g===0));mixer.setLevel('ambience',1);
const supplySources=solarSources.filter(n=>n!==ecmSource);mixer.setLevel('engines',0);
for(const n of supplySources)assert(pathGains(n).every(g=>g===0));mixer.setLevel('engines',1);
mixer.setLevel('muted',true);for(const n of solarSources)assert(pathGains(n).every(g=>g===0));mixer.setLevel('muted',false);
const noSteal=mixer.stats.stolen;for(let tick=0;tick<100;tick++){context.advance(.006);mixer.update();}
assert.equal(context.nodes.slice(solarNodeStart).filter(n=>n.type==='source'&&n.loop).length,3,'Steady telemetry must not retrigger or stack');assert.equal(mixer.stats.stolen,noSteal);
for(const entry of solarFrame.traffic)entry.motorActive=false;solarFrame.interference[0].strength=0;
context.advance(.006);mixer.update();assert.equal(mixer.stats.trafficLoops,0);assert.equal(mixer.stats.ecmLoops,0);
for(const n of solarSources)assert(n.stopAt<=context.currentTime+.01800001);context.advance(.02);for(const n of solarSources)assert(n.ended);
assert(ecmSource.connections.length===0,'ECM source disconnects after bounded shutdown');
solarFrame.traffic[0].motorActive=true;solarFrame.interference[0].strength=.5;context.advance(.006);mixer.update();assert.equal(mixer.stats.trafficLoops,1);assert.equal(mixer.stats.ecmLoops,1);
world.speed=0;context.advance(.006);mixer.update();assert.equal(mixer.stats.trafficLoops,0);assert.equal(mixer.stats.ecmLoops,0);world.speed=1;
solarFrame.enabled=false;context.advance(.006);mixer.update();assert.equal(mixer.stats.trafficLoops,0,'Designer/hidden/map solar adapter does not expose supply emitters');
solarFrame.enabled=true;delete solarFrame.traffic[0].motorActive;solarFrame.interference[0].disclosed=false;context.advance(.006);mixer.update();assert.equal(mixer.stats.trafficLoops,0);assert.equal(mixer.stats.ecmLoops,0);
world.solarIntel=null;
world.campaign.activeSystem='home';world.campaign.contacts={};world.galactic.radarContacts.clear();context.advance(6);mixer.update();
for(let gun=0;gun<64;gun++) assert(mixer.weapon('rail',{x:80+gun%8*13,y:0,z:Math.floor(gun/8)*13},'home'));
context.advance(.11);mixer.update();assert.equal(mixer.stats.active,64);const protectedGuns=mixer.stats.stolen,fullPoolPings=mixer.stats.sensorPings;
world.galactic.radarContacts.set('full-pool',{group:radarGroup});world.campaign.contacts['full-pool']={confidence:.2,uncertainty:124,identified:false,systemId:'home'};
world.campaign.events.push({kind:'sensor',text:'INBOUND DRIVE CONTACT · SOURCE → HOME · CORRIDOR ETA 120s'});
context.advance(.11);mixer.update();assert.equal(mixer.stats.sensorPings,fullPoolPings);assert.equal(mixer.stats.stolen,protectedGuns,'Quiet receiver reports must never steal praised gun voices');
world.campaign=null;world.galactic=null;context.advance(6);mixer.update();
// Long-range heavy motors preserve the exact near-field mix and powered gate.
const longTorpedo={id:98,position:vector(4080),userData:{weapon:'torpedo',motorActive:true,guidedGeneration:1,flightAge:8}};
world.missiles=[{systemId:'home',obj:longTorpedo}];context.advance(.2);const farNodes=context.nodes.length;mixer.update();
assert.equal(mixer.stats.guidedLoops,1);assert.equal(mixer.stats.distantGuidedLoops,1);
const farMotor=context.nodes.slice(farNodes).find(node=>node.type==='source'&&node.loop&&node.buffer.url.includes('torpedo-burn-'));
assert(farMotor&&farMotor.connections[0].frequency.value<300,'Distant powered torpedo carries low receiver texture');
assert(pathGains(farMotor).some(gain=>gain>0));mixer.setLevel('weapons',0);assert(pathGains(farMotor).every(gain=>gain===0));mixer.setLevel('weapons',1);
longTorpedo.userData.motorActive=false;context.advance(.006);mixer.update();assert.equal(mixer.stats.distantGuidedLoops,0);
assert(farMotor.stopAt<=context.currentTime+.01800001);context.advance(.02);assert(farMotor.ended,'Dark long-range coast has no continuous roar');
longTorpedo.userData.motorActive=true;context.advance(.006);mixer.update();assert.equal(mixer.stats.distantGuidedLoops,1,'Actual correction pulse resumes distant motor');
longTorpedo.position=vector(5080);context.advance(.006);mixer.update();assert.equal(mixer.stats.guidedLoops,0,'Finite maximum receiver range');
longTorpedo.position=vector(2080);longTorpedo.userData.weapon='swarm';context.advance(.006);mixer.update();assert.equal(mixer.stats.guidedLoops,0,'Swarm range/mix unchanged');
longTorpedo.userData.weapon='torpedo';delete longTorpedo.userData.motorActive;context.advance(.006);mixer.update();assert.equal(mixer.stats.guidedLoops,0,'Unknown distant motor marker remains silent');
world.missiles=[];context.advance(.2);mixer.update();
for (const kind of ['laser','plasma','pdc','rail','mac']) { context.advance(.2); mixer.weapon(kind, position, 'home'); }
context.advance(.1); mixer.update(); assert.equal(mixer.stats.weaponDucking, true, 'Combat fire must duck the score');
assert.match(mixer.stats.variants['hb-pdc'], /naval-v6/, 'Actual weapon hook must choose the rebuilt physical bank');
const weapons = context.nodes.filter(node => node.type === 'source' && !node.loop && node.started && !node.ended);
assert(weapons.length >= 4, 'The shortened PDC may finish while the four heavy reports remain');
assert(weapons.some(source => pathGains(source).some(gain => gain > 0)), 'Harness must observe a live audible route before testing silence');
// Every live recipe must use its complete eight-variant family without
// immediate repeats, including across bag boundaries.
for (const [kind,bank] of [['coilgun','hb-rail'],['autocannon','hb-pdc'],['rail','hb-rail'],['mac','hb-mac'],['pdc','hb-pdc'],['flak','hb-flak'],
 ['laser','energy-laser'],['plasma','energy-plasma'],
 ['impact','hb-impact'],['armour','hb-armour'],['hull-breach','hb-breach'],['intercept','hb-intercept'],
 ['explosion-small','hb-small-blast'],['explosion-large','hb-large-blast'],['explosion-reactor','hb-reactor-blast'],['vent','hb-vent']]) {
 let previous; const selected = new Set();
 for(let event=0;event<24;event++) {
  context.advance(1.9); const beforeNodes=context.nodes.length;
  assert.equal(mixer.weapon(kind,position,'home',{size:30}),true);
  const sample=mixer.stats.variants[bank]; assert.notEqual(sample,previous); previous=sample; selected.add(sample);
  assert(context.nodes.slice(beforeNodes).filter(node=>node.type==='source').length<=2,'Combat event layer count must stay bounded');
  const shape=mixer.stats.variations[bank]; assert(shape.pitch>=.96&&shape.pitch<=1.04);
  assert(shape.gain>=.92&&shape.gain<=1.08&&shape.filter>=.88&&shape.filter<=1&&shape.offset>=0&&shape.offset<=.004);
 }
 assert.equal(selected.size,8,kind+' must expose all eight actual variants');
 assert.equal(mixer.stats.variantCounts[bank],8);
}
const randomBeforeSpatial = Math.random; Math.random=()=>.5;
context.advance(2);
let begin=context.nodes.length; mixer.weapon('rail',vector(80),'home',{size:12});
const closeRail=context.nodes.slice(begin).find(node=>node.type==='source'&&node.buffer.url.includes('/rail-'));
const closeGain=closeRail.connections[0].connections[0].gain.history[0], closeFilter=closeRail.connections[0].frequency.value;
context.advance(.2); begin=context.nodes.length; mixer.weapon('rail',vector(4080),'home',{size:300});
const distantRail=context.nodes.slice(begin).find(node=>node.type==='source'&&node.buffer.url.includes('/rail-'));
assert(distantRail.connections[0].frequency.value<closeFilter,'Distance and large hull soften mechanical detail');
assert(distantRail.connections[0].connections[0].gain.history[0]<closeGain*.12,'Far reports must be substantially quieter');
assert(closeRail.offset>0&&closeRail.offset<=.004,'Start offset varies without removing the physical attack');
Math.random=randomBeforeSpatial;
// Observe real damage state instead of altering hull gameplay or producing
// startup breach events from an already-damaged save.
const breachBefore=mixer.stats.hullBreaches; friendly.breaches=[{}]; friendly.hp=70;
context.advance(.2); mixer.update(); assert.equal(mixer.stats.hullBreaches,breachBefore+1);
context.advance(1.9); mixer.update(); assert(mixer.stats.vents>0,'Existing venting hulls must produce finite varied releases');
friendly.breaches=[]; friendly.hp=100;
// Real compartment pressure/patches supersede persistent visual hole scars.
const sections=[{id:'bow',breaches:1,pressure:.8,health:.7},{id:'reactor',breaches:0,pressure:1,health:1}];
friendly.campaignUnit={damageControl:{sections}};friendly.breaches=Array.from({length:6},()=>({}));friendly.hp=75;
context.advance(.2);mixer.update();const sectionBreachStart=mixer.stats.hullBreaches,sectionVentsStart=mixer.stats.vents;
context.advance(1.9);mixer.update();assert(mixer.stats.vents>sectionVentsStart,'A real pressurized compartment leak vents');
sections[0].pressure=.02;const dryVents=mixer.stats.vents;context.advance(2);mixer.update();assert.equal(mixer.stats.vents,dryVents,'Depressurized hull must stop hissing despite six visible scars');
sections[0].pressure=.8;sections[0].breaches=0;context.advance(2);mixer.update();assert.equal(mixer.stats.vents,dryVents,'Tender patch stops leak while hull remains75%');
sections[0].breaches=1;context.advance(.4);mixer.update();assert.equal(mixer.stats.hullBreaches,sectionBreachStart+1,'A new actual section breach reports beyond visual six-hole cap');
const actualDamage=JSON.stringify(friendly.campaignUnit.damageControl);context.advance(2);mixer.update();assert.equal(JSON.stringify(friendly.campaignUnit.damageControl),actualDamage,'Audio must never modify damage/repair state');
friendly.campaignUnit=null;friendly.breaches=[];friendly.hp=100;

world.missiles=[{systemId:'home',obj:{id:250,position:vector(80),userData:{weapon:'missile',motorActive:true,guidedGeneration:1}}}];
context.advance(.2); begin=context.nodes.length; mixer.update();
const firstMotor=context.nodes.slice(begin).find(node=>node.type==='source'&&node.loop);
assert(firstMotor.buffer.url.includes('missile-burn-'));
world.missiles[0].obj.userData.motorActive=false; context.advance(.2);mixer.update();assert.equal(mixer.stats.guidedLoops,0,'Cold/coasting guided bodies must stay silent');
world.missiles[0].obj.userData.motorActive=true;world.missiles[0].obj.userData.weapon='torpedo';world.missiles[0].obj.userData.guidedGeneration=2;
context.advance(.2);begin=context.nodes.length;mixer.update();
const torpedoMotor=context.nodes.slice(begin).find(node=>node.type==='source'&&node.buffer.url.includes('torpedo-burn-'));
assert(torpedoMotor,'Pooled new torpedo generation must select its own burn');
assert(torpedoMotor.offset>0&&torpedoMotor.offset<53.333333,'Motor samples must start on varied sustained texture');
assert(mixer.stats.variations['torpedo-burn'].sizeGain>0,'Motor size modulation must survive update');
world.missiles=[];context.advance(.4);mixer.update();
// Callbacks report real release/first ignition; mount-fire never anticipates it.
context.advance(3);
assert.equal(mixer.weapon('swarm',position,'home'),false);
assert.equal(mixer.weapon('missile',position,'home'),false);
assert.equal(mixer.weapon('torpedo',position,'home'),false);
for (const type of ['swarm','missile','torpedo']) for (const ignition of [false,true]) {
 const bank='hb-'+type+(ignition?'-ignition':'-cold'), selections=new Set(); let previous;
 for(let generation=1;generation<=24;generation++) {
  context.advance(2);
  const projectile={id:400,position:vector(80),userData:{guidedMissile:true,weapon:type,guidedGeneration:generation,motorActive:ignition,effectSystemId:'home',effectScale:{body:.2}}};
  mixer.effect(projectile);
  const method=ignition?'phaseIgnition':'phaseCold';
  assert.equal(mixer[method](projectile.position,vector(1),projectile),true);
  assert.equal(mixer[method](projectile.position,vector(1),projectile),false,'Actual callbacks deduplicate');
  const selected=mixer.stats.variants[bank]; assert.notEqual(selected,previous); selections.add(selected);previous=selected;
  const shape=mixer.stats.variations[bank];assert(shape.pitch>=.96&&shape.pitch<=1.04&&shape.offset<=.004);
 }
 assert.equal(selections.size,8,type+' phase needs eight no-repeat performances');
}
const tracked={id:401,position:vector(80),userData:{guidedMissile:true,weapon:'swarm',guidedGeneration:1,launchPending:true,motorActive:false,effectSystemId:'home',flightAge:-.2}};
mixer.effect(tracked);world.missiles=[{systemId:'home',obj:tracked}];
context.advance(2);mixer.update();
const coldBefore=mixer.stats.coldLaunches,igniteBefore=mixer.stats.ignitions;
tracked.userData.launchPending=false;tracked.userData.flightAge=.02;
context.advance(.2);mixer.update();assert.equal(mixer.stats.coldLaunches,coldBefore+1);assert.equal(mixer.stats.ignitions,igniteBefore);assert.equal(mixer.stats.guidedLoops,0,'Alignment is unpowered');
tracked.userData.motorActive=true;tracked.userData.flightAge=.4;
context.advance(.2);mixer.update();assert.equal(mixer.stats.ignitions,igniteBefore+1);assert.equal(mixer.stats.guidedLoops,1);assert(mixer.stats.variants['swarm-burn'].includes('naval-v7'));
tracked.userData.motorActive=false;context.advance(.2);mixer.update();assert.equal(mixer.stats.guidedLoops,0);
tracked.userData.motorActive=true;context.advance(.2);mixer.update();assert.equal(mixer.stats.ignitions,igniteBefore+1,'Coast correction does not replay ignition');
tracked.userData.guidedGeneration++;tracked.userData.launchPending=true;tracked.userData.motorActive=false;mixer.effect(tracked);
context.advance(.2);mixer.update();tracked.userData.launchPending=false;mixer.phaseCold(tracked.position,null,tracked);tracked.userData.motorActive=true;mixer.phaseIgnition(tracked.position,null,tracked);
assert.equal(mixer.stats.ignitions,igniteBefore+2,'Pooled generation gets exactly one new ignition');
// Already flying objects discovered from a save/view do not invent launch events.
const eventsBefore={...mixer.stats.phaseEvents};
world.missiles=[{systemId:'home',obj:{id:402,position:vector(80),userData:{weapon:'missile',motorActive:true,flightAge:8}}}];
context.advance(.2);mixer.update();assert.deepEqual(mixer.stats.phaseEvents,eventsBefore);
// Forty burning swarm bodies form one bounded bed, not forty motor voices.
context.advance(3);world.missiles=Array.from({length:40},(_,i)=>({systemId:'home',obj:{id:500+i,position:vector(80+i*14),userData:{guidedMissile:true,weapon:'swarm',guidedGeneration:1,motorActive:false,effectSystemId:'home'}}}));
for(const {obj} of world.missiles){mixer.effect(obj);mixer.phaseCold(obj.position,null,obj);obj.userData.motorActive=true;mixer.phaseIgnition(obj.position,null,obj);}
context.advance(.11);mixer.update();assert.equal(mixer.stats.swarmDensity,40);assert.equal(mixer.stats.swarmLoops,1);assert.equal(mixer.stats.guidedLoops,2);assert(mixer.stats.phaseVoices<=6);assert(mixer.stats.phaseCulled>0);
const attacks=context.nodes.filter(node=>node.type==='source'&&!node.loop&&node.started&&!node.ended&&node.stopAt>context.currentTime+.018&&node.buffer.url.includes('naval-v7'));
assert(attacks.filter(node=>node.buffer.url.includes('-ignition-')).length<=3,'At most three simultaneous ignition attacks');
const wall=context.nodes.filter(node=>node.type==='source'&&node.loop&&!node.ended&&node.buffer.url.includes('swarm-burn')).at(-1);
assert(wall.connections[0].connections[0].gain.value<=.13,'Density gain remains capped');
mixer.setLevel('weapons',0);for(const node of [...attacks,wall])assert(pathGains(node).every(gain=>gain===0),'Phase/aggregate routes follow Weapons including wet returns');mixer.setLevel('weapons',1);
// Dark40-swarm regression: per-frame powered gates, including within the
// ordinary100ms music/hull tick. Ignition tails cannot survive actual coasts.
const poweredSources=()=>context.nodes.filter(node=>node.type==='source'&&node.started&&!node.ended&&/(?:-ignition-|\/(?:swarm|missile|torpedo)-burn-)/.test(node.buffer?.url??''));
const launchIgnitions=mixer.stats.ignitions;
for(const {obj} of world.missiles)obj.userData.motorActive=false;
context.advance(.005);mixer.update();assert.equal(mixer.stats.guidedLoops,0);assert.equal(mixer.stats.swarmLoops,0);
for(const source of poweredSources()){
 assert(source.stopAt<=context.currentTime+.01800001,'All powered sources stop within18ms of observed coast');
 assert(pathGains(source).every(gain=>gain===0),'No stale scheduled gain after coast');
}
context.advance(.020);assert.equal(poweredSources().length,0,'Coast contains no sustained dry motor/ignition route after bounded stop');
for(let pulse=0;pulse<20;pulse++){
 for(const {obj} of world.missiles)obj.userData.motorActive=true;
 context.advance(.006);mixer.update();assert.equal(mixer.stats.guidedLoops,2);assert.equal(mixer.stats.swarmLoops,1,'Short correction pulse resumes bounded swarm bed between100ms ticks');
 const activeMotor=poweredSources().filter(node=>node.loop);assert.equal(activeMotor.length,3);assert(activeMotor.some(node=>pathGains(node).some(gain=>gain>0)));
 context.advance(.065);for(const {obj} of world.missiles)obj.userData.motorActive=false;mixer.update();
 context.advance(.020);assert.equal(poweredSources().length,0);
}
assert.equal(mixer.stats.ignitions,launchIgnitions,'Correction pulses do not replay first ignition report');
world.missiles=[{systemId:'home',obj:{id:950,position:vector(80),userData:{weapon:'missile',flightAge:3}}}];
context.advance(.006);mixer.update();assert.equal(mixer.stats.guidedLoops,0,'Unknown powered marker is silent');
const heavy={id:951,position:vector(80),userData:{weapon:'torpedo',guidedMissile:true,guidedGeneration:1,motorActive:true,thrustState:'ignition',effectSystemId:'home'}};
world.missiles=[{systemId:'home',obj:heavy}];mixer.effect(heavy);mixer.phaseCold(heavy.position,null,heavy);mixer.phaseIgnition(heavy.position,null,heavy);context.advance(.006);mixer.update();
const heavyIgnition=mixer.stats.ignitions;assert.equal(mixer.stats.guidedLoops,1);
heavy.userData.motorActive=false;heavy.userData.thrustState='coast';context.advance(.006);mixer.update();context.advance(.02);assert.equal(poweredSources().length,0);
heavy.userData.motorActive=true;heavy.userData.thrustState='terminal';context.advance(.006);mixer.update();assert.equal(mixer.stats.guidedLoops,1);assert.equal(mixer.stats.ignitions,heavyIgnition,'Heavy terminal burn resumes motor without replaying launch');
const oldMotor=poweredSources().find(node=>node.loop);
heavy.userData.guidedGeneration++;heavy.userData.motorActive=false;context.advance(.006);mixer.update();assert(oldMotor.stopAt<=context.currentTime+.01800001,'Pool generation stops previous motor');context.advance(.02);assert.equal(poweredSources().length,0);
context.advance(.15);heavy.userData.motorActive=true;mixer.effect(heavy);mixer.phaseIgnition(heavy.position,null,heavy);context.advance(.006);mixer.update();assert.equal(mixer.stats.ignitions,heavyIgnition+1);
heavy.userData.done=true;context.advance(.006);mixer.update();context.advance(.02);assert.equal(poweredSources().length,0,'Destruction stops motor and linked ignition');
world.speed=0;context.advance(.11);mixer.update();assert.equal(mixer.stats.guidedLoops,0);assert.equal(mixer.stats.swarmLoops,0);assert.equal(mixer.stats.ecmLoops,0);assert.equal(mixer.stats.trafficLoops,0);
assert.equal(mixer.stats.phaseVoices,0);
world.speed=1;world.campaign={activeSystem:'away',mapOpen:false,factions:{player:{known:[]}}};
context.advance(.3);mixer.update();assert.equal(mixer.stats.swarmLoops,0);assert.equal(mixer.stats.guidedLoops,0);
const remote={id:900,position:vector(80),userData:{guidedMissile:true,weapon:'missile',effectSystemId:'home',guidedGeneration:1}};
assert.equal(mixer.phaseCold(remote.position,null,remote),false);assert.equal(mixer.phaseIgnition(remote.position,null,remote),false);
world.campaign.activeSystem='home';context.advance(.2);assert.equal(mixer.phaseIgnition(remote.position,null,remote),false,'Remote transitions cannot replay after view entry');
world.campaign=null;world.missiles=[];context.advance(.4);mixer.update();
mixer.setLevel('weapons', 0);
for (const source of weapons) assert(pathGains(source).every(gain => gain === 0), 'Weapon slider must silence direct and every convolution return');
let before = context.nodes.length; context.advance(.2); mixer.impact(position, 'home', false, 'rail');
const impacts = context.nodes.slice(before).filter(node => node.type === 'source');
assert(impacts.length > 0); mixer.setLevel('impacts', 0);
for (const source of impacts) assert(pathGains(source).every(gain => gain === 0), 'Impact slider must silence direct and reflected hull sound');
mixer.setLevel('music', 0);
// The ambient loop is in its separate bus; the six musical loops precede it.
for (const source of context.nodes.filter(node => node.type === 'source' && node.loop).slice(0, 6)) assert(pathGains(source).every(gain => gain === 0));
before = context.nodes.length; mixer.radio('incoming'); context.advance(.2); mixer.update();
const alerts = context.nodes.slice(before).filter(node => node.type === 'source' && !node.loop);
assert(alerts.length >= 3); mixer.setLevel('alerts', 0);
for (const source of alerts) assert(pathGains(source).every(gain => gain === 0), 'Alerts slider must silence speech, squelch and threat code');
mixer.setLevel('weapons', 1); mixer.setLevel('master', 0);
for (const source of context.nodes.filter(node => node.type === 'source')) assert(pathGains(source).every(gain => gain === 0), 'Master zero must silence all routes');
mixer.setLevel('master', 1); mixer.setLevel('muted', true);
for (const source of context.nodes.filter(node => node.type === 'source')) assert(pathGains(source).every(gain => gain === 0), 'Mute must silence all routes');
mixer.setLevel('muted', false);
context.advance(4);
// Many distinct moving/spatial emitters used to stack sustained PDC reports.
for (let turret = 0; turret < 12; turret++) mixer.weapon('pdc', vector(800 + turret * 24), 'home');
mixer.update(); assert.equal(mixer.stats.pdcVoices, 4);
assert(mixer.stats.pdcCulled >= 8, 'Dense PDC must be audibly bounded independently of the global voice pool');
const culled = mixer.stats.pdcCulled, played = mixer.stats.cues.pdc;
mixer.weapon('pdc', vector(80), 'home'); mixer.update();
assert.equal(mixer.stats.cues.pdc, played + 1, 'A nearby turret must replace a quieter distant burst');
assert.equal(mixer.stats.pdcVoices, 4); assert.equal(mixer.stats.pdcCulled, culled + 1);
const activePdc = context.nodes.filter(node => node.type === 'source' && node.buffer?.url?.includes('/naval-v6/pdc-') && node.started && !node.ended && node.stopAt > context.currentTime + .018);
assert(activePdc.length <= 4, 'Retired distant PDC may only keep its short fade');
mixer.weapon('rail', vector(80), 'home'); mixer.update();
assert.equal(mixer.stats.pdcVoices, 4, 'PDC budget must not reject heavy ordnance');
assert(context.nodes.some(node => node.type === 'source' && !node.loop && !node.ended && node.stopAt > context.currentTime + 1), 'Heavy rail report keeps its complete tail');
for (let tick = 0; tick < 400; tick++) {
 context.advance(.11); mixer.weapon('pdc', { ...position, x: tick % 30 * 20 }, 'home'); mixer.update();
 assert(mixer.stats.active <= 64); assert(mixer.stats.pdcVoices <= 4);
}
assert.equal(context.nodes.filter(node => node.type === 'convolver').length, 4, 'Inspection must not allocate new responses');
// Boarding graph consumes only canonical accepted receiver events; no raw party timers.
world.campaign={activeSystem:'home',mapOpen:false,contacts:{},events:[],factions:{player:{known:[]}}};world.speed=1;
mixer.setLevel('alerts',.66);mixer.setLevel('ambience',.16);
const boardingFrame={enabled:true,systemId:'home',time:100,boardingEvents:[]};world.solarIntel=()=>boardingFrame;context.advance(2);mixer.update();
const boardingEvent=(id,kind,extra={})=>({id,partyId:'actual-party',systemId:'home',kind,disclosed:true,observed:true,precise:true,confidence:1,position:[80,0,0],at:boardingFrame.time,...extra});
const boardingBase=mixer.stats.boardingAccents,boardingSteals=mixer.stats.stolen;
boardingFrame.time++;boardingFrame.boardingEvents=[boardingEvent('paid-pod','pod-launch')];let boardingStart=context.nodes.length;context.advance(.11);mixer.update();assert.equal(mixer.stats.boardingKinds['pod-launch'],1);
const boardingSource=context.nodes.slice(boardingStart).find(n=>n.type==='source'&&!n.loop);assert(boardingSource.buffer.url.includes('/naval-v6/torpedo-launch-'));assert(boardingSource.connections[0].frequency.value<=850);const boardingGunStop=boardingSource.stopAt;
boardingFrame.time++;boardingFrame.boardingEvents.push(boardingEvent('touchdown','hull-breach'));context.advance(.11);mixer.update();assert.equal(mixer.stats.boardingVoices,2);assert.equal(mixer.stats.boardingKinds['hull-breach'],1);
boardingFrame.time++;boardingFrame.boardingEvents.push(boardingEvent('actual-exchange','marine-exchange'));context.advance(.11);mixer.update();assert.equal(mixer.stats.boardingCulled,1);assert.equal(boardingSource.stopAt,boardingGunStop);assert.equal(mixer.stats.stolen,boardingSteals,'Boarding never steals gun/guardian voices');
mixer.setLevel('weapons',0);assert(pathGains(boardingSource).every(g=>g===0));context.advance(.006);mixer.update();assert.equal(mixer.stats.boardingVoices,0);context.advance(.03);assert(boardingSource.ended);mixer.setLevel('weapons',.72);
boardingFrame.time+=5;boardingFrame.boardingEvents=[boardingEvent('interior-exchange','marine-exchange')];boardingStart=context.nodes.length;context.advance(.11);mixer.update();assert.equal(mixer.stats.boardingKinds['marine-exchange'],1);const marineSource=context.nodes.slice(boardingStart).find(n=>n.type==='source'&&!n.loop);assert(marineSource.buffer.url.includes('/naval-v6/pdc-'));assert(marineSource.stopAt-context.currentTime<=.23);mixer.setLevel('ambience',0);assert(pathGains(marineSource).every(g=>g===0));context.advance(.03);mixer.update();context.advance(.03);mixer.setLevel('ambience',.16);
boardingFrame.time+=5;boardingFrame.boardingEvents=[boardingEvent('real-loss','casualty',{precise:false,own:true,position:[99999,0,99999]})];boardingStart=context.nodes.length;context.advance(.11);mixer.update();assert.equal(mixer.stats.boardingKinds.casualty,1);const reportSource=context.nodes.slice(boardingStart).find(n=>n.type==='source'&&!n.loop);assert.equal(reportSource.connections[0].connections[0].connections[0].pan.value,0,'Imprecise marine radio remains centred');mixer.setLevel('alerts',0);assert(pathGains(reportSource).every(g=>g===0));context.advance(.006);mixer.update();context.advance(.03);mixer.setLevel('alerts',.7);
const boardingCount=mixer.stats.boardingAccents;context.advance(.11);mixer.update();assert.equal(mixer.stats.boardingAccents,boardingCount,'No missed-category replay');
boardingFrame.time+=5;boardingFrame.boardingEvents=[boardingEvent('captured','captured')];context.advance(.11);mixer.update();assert.equal(mixer.stats.boardingKinds.captured,1);world.speed=0;context.advance(.006);mixer.update();assert.equal(mixer.stats.boardingVoices,0);world.speed=1;context.advance(.11);mixer.update();assert.equal(mixer.stats.boardingVoices,0,'Paused contest outcome does not replay');
boardingFrame.time+=5;boardingFrame.boardingEvents=[boardingEvent('before-suspend','withdrawn')];context.advance(.11);mixer.update();assert.equal(mixer.stats.boardingVoices,1);context.state='suspended';mixer.update();assert.equal(mixer.stats.boardingVoices,0);context.state='running';context.advance(.11);mixer.update();assert.equal(mixer.stats.boardingVoices,0,'Background audio cannot revive a marine accent');
assert.equal(mixer.stats.boardingAccents,boardingBase+6);
// Guardian character is a disclosed finite Ambience accent, never another gun.
context.advance(3);world.campaign={activeSystem:'home',mapOpen:false,contacts:{},events:[]};world.missiles=[];
const guardianBody=(id,kind)=>({id,kind,systemId:'home',disclosed:true,precise:true,identified:true,confidence:1,position:[80,0,0]});
const guardianFrame={enabled:true,systemId:'home',time:100,guardians:[guardianBody('sentinel','sentinel'),guardianBody('nursery','growth'),guardianBody('miners','mining-swarm')],guardianEvents:[]};
const guardianAttack=(id,index,kind,extra={})=>({id,guardianId:guardianFrame.guardians[index].id,sourceId:guardianFrame.guardians[index].id,systemId:'home',disclosed:true,observed:true,precise:true,confidence:1,position:[80,0,0],direction:[0,1,0],kind,at:guardianFrame.time,...extra});
world.solarIntel=()=>guardianFrame;mixer.update();const guardianBase=mixer.stats.guardianAccents,stealBase=mixer.stats.stolen;
mixer.weapon('rail',vector(80),'home');const heldRail=context.nodes.filter(n=>n.type==='source'&&!n.ended&&n.buffer?.url.includes('/naval-v6/rail-'));const railEnd=heldRail.map(n=>n.stopAt);
guardianFrame.time++;guardianFrame.guardianEvents=[guardianAttack('pulse-now',0,'pulse',{radius:550})];let guardianStart=context.nodes.length;context.advance(.11);mixer.update();
assert.equal(mixer.stats.guardianAccents,guardianBase+1);assert.equal(mixer.stats.guardianKinds.pulse,1);assert.equal(mixer.stats.guardianVoices,1);
let guardianSources=context.nodes.slice(guardianStart).filter(n=>n.type==='source'&&!n.loop);assert.equal(guardianSources.length,1);assert(guardianSources[0].buffer.url.includes('/naval-v6/plasma-'));assert(guardianSources[0].connections[0].frequency.value<=600);
guardianFrame.time++;guardianFrame.guardianEvents.push(guardianAttack('feed-now',1,'growth',{growth:.2}));context.advance(.11);mixer.update();assert.equal(mixer.stats.guardianVoices,2);
guardianFrame.time++;guardianFrame.guardianEvents.push(guardianAttack('mining-over-cap',2,'mining'));context.advance(.11);mixer.update();assert.equal(mixer.stats.guardianVoices,2);assert.equal(mixer.stats.guardianAccents,guardianBase+2);assert(mixer.stats.guardianCulled>0);
assert.deepEqual(heldRail.map(n=>n.stopAt),railEnd,'Background cap must not replace or shorten the praised gun report');assert.equal(mixer.stats.stolen,stealBase);
guardianSources=context.nodes.filter(n=>n.type==='source'&&!n.loop&&!n.ended&&(n.buffer?.url.includes('/naval-v6/plasma-')||n.buffer?.url.includes('/naval-v6/vent-')));
mixer.setLevel('ambience',0);for(const n of guardianSources)assert(pathGains(n).every(g=>g===0),'Ambience zero silences every accent route');
guardianFrame.time+=10;guardianFrame.guardianEvents=[guardianAttack('muted-feed',1,'growth',{growth:.4})];context.advance(.11);mixer.update();assert.equal(mixer.stats.guardianVoices,0);assert.equal(mixer.stats.stolen,stealBase,'Owned background stops are not gun stealing');
context.advance(.03);assert(guardianSources.every(n=>n.ended),'Muted guardian tails stop in at most18ms');mixer.setLevel('ambience',.16);context.advance(.11);mixer.update();assert.equal(mixer.stats.guardianAccents,guardianBase+2,'No missed-mute backlog');
guardianFrame.time++;guardianFrame.guardianEvents=[guardianAttack('new-mining',2,'mining')];context.advance(.11);mixer.update();assert.equal(mixer.stats.guardianKinds.mining,1);
guardianFrame.guardians[2].confidence=.2;context.advance(.006);mixer.update();assert.equal(mixer.stats.guardianVoices,0,'Lost current body/source authority stops before the100ms mixer tick');
guardianFrame.guardians[2].confidence=1;guardianFrame.time+=10;guardianFrame.guardianEvents=[guardianAttack('pulse-before-background',0,'pulse',{radius:550})];context.advance(.11);mixer.update();assert.equal(mixer.stats.guardianVoices,1);
context.state='suspended';mixer.update();assert.equal(mixer.stats.guardianVoices,0);context.state='running';context.advance(.11);mixer.update();assert.equal(mixer.stats.guardianVoices,0,'AudioContext resume cannot revive an old industrial accent');
guardianFrame.time+=10;guardianFrame.guardianEvents=[guardianAttack('pulse-then-pause',0,'pulse',{radius:550})];context.advance(.11);mixer.update();assert.equal(mixer.stats.guardianVoices,1);
world.speed=0;context.advance(.006);mixer.update();assert.equal(mixer.stats.guardianVoices,0);world.speed=1;context.advance(.11);mixer.update();assert.equal(mixer.stats.guardianVoices,0,'Resume baseline is silent');
guardianFrame.enabled=false;context.advance(.11);mixer.update();guardianFrame.enabled=true;guardianFrame.time++;guardianFrame.guardianEvents=[guardianAttack('hidden-return',0,'pulse',{radius:550})];const beforeHidden=mixer.stats.guardianAccents;context.advance(.11);mixer.update();assert.equal(mixer.stats.guardianAccents,beforeHidden);
world.solarIntel=null;world.campaign=null;context.advance(2);mixer.update();
context.advance(1);
for (let turret = 0; turret < 4; turret++) mixer.weapon('pdc', vector(800 + turret * 24), 'home');
mixer.weapon('pdc', vector(80), 'home');
assert(context.nodes.some(node => node.type === 'source' && node.stopAt === context.currentTime + .018 && !node.ended), 'Dispose must cover a PDC retirement still fading');
world.missiles=Array.from({length:3},(_,i)=>({systemId:'home',obj:{id:1000+i,position:vector(80+i*20),userData:{guidedMissile:true,weapon:'swarm',motorActive:true,effectSystemId:'home',guidedGeneration:1}}}));
for(const {obj} of world.missiles){mixer.effect(obj);mixer.phaseCold(obj.position,null,obj);mixer.phaseIgnition(obj.position,null,obj);}
context.advance(.11);mixer.update();assert.equal(mixer.stats.swarmLoops,1);
world.speed=0;context.advance(.11);mixer.update();
assert(context.nodes.some(node=>node.type==='source'&&node.loop&&node.stopAt===context.currentTime+.018&&!node.ended),'Dispose covers retiring swarm wall and individual motors');
// Teardown also owns live solar highpass nodes and supply sources.
world.speed=1;world.campaign={activeSystem:'away',mapOpen:false,contacts:{}};world.solarIntel=()=>solarFrame;
solarFrame.traffic[0].motorActive=true;solarFrame.interference[0].disclosed=true;
context.advance(.006);const cleanupSolarStart=context.nodes.length;mixer.update();
const cleanupSolarSources=context.nodes.slice(cleanupSolarStart).filter(n=>n.type==='source'&&n.loop);
assert.equal(mixer.stats.ecmLoops,1);assert.equal(mixer.stats.trafficLoops,1);
const cleanupHighpass=cleanupSolarSources.find(n=>n.buffer.url.includes('shipboard')).connections[0];
solarFrame.guardians=[{...guardianBody('cleanup','sentinel'),systemId:'away'}];solarFrame.guardianEvents=[];context.advance(.11);mixer.update();
solarFrame.time++;solarFrame.guardianEvents=[{...guardianAttack('cleanup-pulse',0,'pulse',{radius:550}),guardianId:'cleanup',sourceId:'cleanup',systemId:'away',at:solarFrame.time}];context.advance(.11);mixer.update();assert.equal(mixer.stats.guardianVoices,1,'Dispose owns an actually playing guardian accent');
solarFrame.boardingEvents=[];solarFrame.time++;context.advance(.11);mixer.update();solarFrame.time++;solarFrame.boardingEvents=[{...boardingEvent('dispose-boarding','captured'),systemId:'away',at:solarFrame.time}];context.advance(.11);mixer.update();assert.equal(mixer.stats.boardingVoices,1);
mixer.dispose(); mixer.dispose(); assert.equal(context.state, 'closed');assert.equal(mixer.stats.boardingVoices,0); assert.equal(mixer.stats.active, 0); assert.equal(mixer.stats.pdcVoices, 0);
assert.equal(mixer.stats.guardianVoices,0);
assert.equal(mixer.stats.ecmLoops,0);assert.equal(mixer.stats.trafficLoops,0);
assert.equal(mixer.stats.phaseVoices,0);assert.equal(mixer.stats.swarmLoops,0);assert.equal(mixer.stats.guidedLoops,0);
assert([...listeners.values()].every(set => set.size === 0), 'Dispose must remove listeners');
assert(context.nodes.filter(node => node.type === 'convolver').every(node => node.disconnected));
assert(outputTrim.disconnected, 'Dispose must disconnect the calibrated output node');
assert(cleanupHighpass.disconnected,'Dispose disconnects the live ECM highpass');
assert(context.nodes.filter(node => node.type === 'source').every(node => node.ended));
console.log('Actual mixer graph passed: passive disclosed discovery + observed diversion/centred reports/no observation-tick spam/global-text secrecy; bounded disclosed ECM + two powered supply voices, 18ms coast/pause/hidden stops, new route slider/mute/highpass cleanup; genuine visible-local sensor reports/tension, bounded distant powered torpedoes/coast silence, 6 score stems/4 fixed responses and controls on every route; 400 ticks bounded gun voices;40-swarm max6phase/3ignition+2motors+1bed; pause/remote/coast and idempotent cleanup.');
