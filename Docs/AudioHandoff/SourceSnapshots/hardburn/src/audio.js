// Physical shipboard Foley, adaptive score and properly licensed field recordings.
// Sources and individual licences: /audio/naval-v4/sources.json and /audio/AUDIO-CREDITS.md.
import { navalThreat, takeVariant, hullTailWeight, hullLeakState, observeSensorContacts, observeActiveScan, guidedMotorRange, distantMotorShape, solarAudioState, observeDiscoveryIntel, canonicalReceiverReport, observeEwEvents } from './audio-policy.js';
import { COMBAT_BANKS, GUIDED_BANKS, COMBAT_VARIANTS, combatVariation, blastEvent, guidedBank, guidedType } from './audio-combat.js';
import { HULL_PROFILES, hullImpulse, hullProfile, quietPhrase } from './audio-acoustics.js';
import { BOARDING_ACCENTS, observeBoardingAudio } from './audio-boarding.js';
import { GUARDIAN_ACCENTS, guardianSources, observeGuardianAudio } from './audio-guardian.js';
const variants=(pack,name,start=0,count=3)=>Array.from({length:count},(_,i)=>pack+'-'+name+'_'+String(start+i).padStart(3,'0')+'.ogg');
const banks={metal:variants('impact','impactMetal_heavy'),plate:variants('impact','impactPlate_heavy'),light:variants('impact','impactMetal_light'),impact:variants('impact','impactMetal_medium'),rail:variants('scifi','impactMetal'),beam:variants('scifi','laserLarge'),plasma:variants('scifi','laserRetro'),drive:variants('scifi','thrusterFire'),field:variants('scifi','forceField'),blast:variants('scifi','explosionCrunch'),sub:variants('scifi','lowFrequency_explosion',0,2),large:variants('scifi','spaceEngineLarge'),small:variants('scifi','spaceEngineSmall'),ambient:variants('scifi','spaceEngineLow'),radio:variants('scifi','computerNoise'),click:variants('interface','click',1),select:variants('interface','select',1),confirm:variants('interface','confirmation',1),error:variants('interface','error',1),contact:variants('interface','question',1)};
Object.assign(banks,Object.fromEntries(['incoming','breach','intercept'].map(k=>['radio-'+k,Array.from({length:3},(_,i)=>'hardburn-radio-'+k+'-'+i+'.ogg')])));
for(const name of ['rail','mac','pdc','flak','impact','small-blast','large-blast','launch'])banks['hb-'+name]=Array.from({length:3},(_,i)=>'../generated/'+name+'-'+i+'.ogg');
for(const name of ['drive-small','drive-medium','drive-heavy','tension-bed'])banks['hb-'+name]=['../generated/'+name+'.ogg'];

for(const name of ['rail','mac','pdc','flak','impact','large-blast','launch'])banks['hb-'+name]=Array.from({length:4},(_,i)=>'../naval/'+name+'-'+i+'.ogg');
for(const name of ['bed','motif','pulse','combat'])banks['score-'+name]=['../naval/score-'+name+'.ogg'];
banks.shipboard=['../naval/shipboard.ogg'];
for(const name of ['rail-tail','impact-tail','hostile'])banks[name]=Array.from({length:4},(_,i)=>'../naval-v2/'+name+'-'+i+'.ogg');
for(const name of ['ui-select','ui-cancel','ui-nav','critical'])banks[name]=Array.from({length:3},(_,i)=>'../naval-v2/'+name+'-'+i+'.ogg');
banks['score-danger']=['../naval-v2/score-danger.ogg'];
for(const name of ['energy-laser','energy-plasma','pdc-mechanism','launch-motor'])banks[name]=Array.from({length:4},(_,i)=>'../naval-v3/'+name+'-'+i+'.ogg');
for(const name of ['comms-key','comms-close'])banks[name]=Array.from({length:2},(_,i)=>'../naval-v3/'+name+'-'+i+'.ogg');
banks['score-machinery']=['../naval-v3/score-machinery.ogg'];
// Fourth pass replaces every combat report and every score stem. No bright
// legacy weapon layer remains in a combat recipe.
for(const name of ['rail','mac','pdc','flak','impact','small-blast','large-blast','launch'])banks['hb-'+name]=Array.from({length:4},(_,i)=>'../naval-v4/'+name+'-'+i+'.ogg');
for(const name of ['rail-tail','impact-tail'])banks[name]=Array.from({length:4},(_,i)=>'../naval-v4/'+name+'-'+i+'.ogg');
for(const name of ['laser','plasma'])banks['energy-'+name]=Array.from({length:4},(_,i)=>'../naval-v4/'+name+'-'+i+'.ogg');
for(const name of ['bed','motif','pulse','combat','danger','machinery'])banks['score-'+name]=['../naval-v4/score-'+name+'.ogg'];
for(const name of ['drive-small','drive-medium','drive-heavy'])banks['hb-'+name]=['../naval-v4/'+name+'.ogg'];
banks['torpedo-burn']=['../naval-v4/torpedo-burn.ogg'];
banks.shipboard=['../naval-v4/shipboard.ogg'];
for(const name of ['ui-select','ui-cancel','ui-nav','click','confirm','contact','alert','hostile','critical'])banks[name]=Array.from({length:3},(_,i)=>'../naval-v4/'+name+'-'+i+'.ogg');
// Focused fifth pass: articulated short PDC bursts leave room for heavy ordnance.
banks['hb-pdc']=Array.from({length:6},(_,i)=>'../naval-v5/pdc-'+i+'.ogg');
for(const [bank,family] of Object.entries(COMBAT_BANKS))banks[bank]=Array.from({length:COMBAT_VARIANTS},(_,i)=>'../naval-v6/'+family+'-'+i+'.ogg');
for(const [bank,family] of Object.entries(GUIDED_BANKS))banks[bank]=Array.from({length:COMBAT_VARIANTS},(_,i)=>'../naval-v7/'+family+'-'+i+'.ogg');
const phaseBanks=new Set(Object.keys(GUIDED_BANKS).filter(bank=>bank!=='swarm-burn'));
const variedBank=bank=>Boolean(COMBAT_BANKS[bank]||GUIDED_BANKS[bank]);
const defaults={master:.72,weapons:.52,impacts:.60,engines:.25,ambience:.16,music:.38,interface:.50,alerts:.66,muted:false};
const categories={coilgun:'weapons',autocannon:'weapons',mac:'weapons',armour:'impacts','explosion-small':'impacts','explosion-large':'impacts','explosion-reactor':'impacts','hull-breach':'impacts',vent:'impacts',rail:'weapons',pdc:'weapons',flak:'weapons',missile:'weapons',torpedo:'weapons',nuclear:'weapons',swarm:'weapons','nuclear-impact':'impacts',laser:'weapons',plasma:'weapons',emp:'weapons','veil-arc':'weapons',impact:'impacts',shield:'impacts',explosion:'impacts',intercept:'impacts',click:'interface',confirm:'interface',alert:'alerts',contact:'alerts'};
const recipes={
 'swarm-cold':[['hb-swarm-cold',.42,1,0,.19]],
 'swarm-ignition':[['hb-swarm-ignition',.55,1,0,.52]],
 'missile-cold':[['hb-missile-cold',.72,1,0,.26]],
 'missile-ignition':[['hb-missile-ignition',.86,1,0,.95]],
 'torpedo-cold':[['hb-torpedo-cold',.90,1,0,.38]],
 'torpedo-ignition':[['hb-torpedo-ignition',1.15,1,0,1.5]],
 hostile:[['hostile',.38,1,0,1.5]],
 critical:[['critical',.40,.9,0,1.7]],
 'ui-select':[['ui-select',.40,1,0,.32]],
 'ui-cancel':[['ui-cancel',.38,.94,0,.34]],
 'ui-nav':[['ui-nav',.40,.96,0,.34]],
 'radio-incoming':[['comms-key',.10,1,0,.11],['radio-incoming',.48,1,.035,4]],
 'radio-breach':[['comms-key',.10,1,0,.11],['radio-breach',.48,1,.035,4]],
 'radio-intercept':[['comms-key',.08,1,0,.11],['radio-intercept',.38,1,.035,4]],
 // Physical hull conduction: long low recoil and mechanical stress.
 rail:[['hb-rail',1.45,1,0,2.8]],
 coilgun:[['hb-rail',.85,1.24,0,.70],['pdc-mechanism',.18,.78,.035,.30]],
 autocannon:[['hb-pdc',.75,.68,0,.22],['rail-tail',.18,1.18,.025,.48]],
 mac:[['hb-mac',1.55,.94,0,3.4]],
 pdc:[['hb-pdc',1.35,1,0,.31]],
 flak:[['hb-flak',1.25,.96,0,1.2]],
 missile:[['hb-missile-launch',1.08,1,0,2.2]],
 nuclear:[['hb-launch',1.38,.76,0,3.8]],
 swarm:[['hb-missile-launch',.90,1.05,0,2.2]],
 'nuclear-impact':[['hb-reactor-blast',1.65,.90,0,5.8]],
 torpedo:[['hb-launch',1.40,1,0,3.2]],
 laser:[['energy-laser',1.20,1,0,1.6]],
 plasma:[['energy-plasma',1.35,.94,0,2.3]],
 emp:[['energy-plasma',1.1,.76,0,2.3]],
 'veil-arc':[['energy-plasma',1.2,.84,0,2.3]],
 impact:[['hb-impact',1.25,1,0,2.4]],
 armour:[['hb-armour',1.35,1,0,2.6]],
 shield:[['hb-impact',.80,.78,0,2.4]],
 explosion:[['hb-small-blast',1.05,1,0,2.1]],
 'explosion-small':[['hb-small-blast',.88,1.12,0,2.0]],
 'explosion-large':[['hb-large-blast',1.55,.92,0,5.6]],
 intercept:[['hb-intercept',.42,1,0,.75]],
 'hull-breach':[['hb-breach',.68,1,0,2.8]],
 vent:[['hb-vent',.24,1,0,1.8]],
 'explosion-reactor':[['hb-reactor-blast',1.55,1,0,5.8]],
 click:[['click',.32,1,0,.32]],
 confirm:[['confirm',.32,.92,0,.36]],
 alert:[['alert',.32,.92,0,1.7]],
 contact:[['contact',.30,.94,0,1.6]]
};
export function createAudioMixer(world, rts) {
 const AudioCtor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
 if (!AudioCtor) return { update() {} };
 const ctx = new AudioCtor({ latencyHint: 'interactive' });
 const buffers = new Map(), voices = new Set(), retiringVoices = new Set(), retiringLoops = new Set(), loops = new Map(), lastCue = new Map(), lastVariant = new Map();
 const gains = {}, ducks = {}, hullObserved = new WeakMap(), guidedObserved = new WeakMap(), sensorObserved = {}, guardianObserved = {}, boardingObserved = {};
 const stats = { audioPass: 12, boardingAccents: 0, boardingKinds: {}, boardingVoices: 0, boardingCulled: 0, guardianAccents: 0, guardianKinds: {}, guardianVoices: 0, guardianCulled: 0, discoveryReports: 0, ewReports: 0, recoveryReports: 0, discoveryContacts: 0, ecmStrength: 0, ecmLoops: 0, trafficLoops: 0, trafficKinds: [], sensorPings: 0, sensorEvents: {}, sensorTension: 0, distantGuidedLoops: 0, coldLaunches: 0, ignitions: 0, phaseEvents: {}, phaseCulled: 0, phaseVoices: 0, swarmDensity: 0, swarmLoops: 0, variantCounts: Object.fromEntries(Object.keys({...COMBAT_BANKS,...GUIDED_BANKS}).map(key=>[key,COMBAT_VARIANTS])), variations: {}, layerChoices: {}, hullBreaches: 0, vents: 0, pdcVoices: 0, pdcCulled: 0, loaded: 0, missing: 0, played: 0, dropped: 0, stolen: 0, peak: 0, peakMax: 0, active: 0, cues: {}, musicIntensity: 0, musicDanger: 0, variants: {}, hullTails: 0, acousticProfile: 'tactical', convolverCount: 4, quietPhrase: 0 };
 let prefs = { ...defaults }, disposed = false, unlocked = false, combatUntil = 0, duckUntil = 0, blastDuckUntil = 0, weaponDuckUntil = 0;
 let pendingRadio = null, nextRadio = 0, nextTick = 0, lastUpdate = 0, musicStart = null, scoreNodes = null;
 const clamp = (value, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, Number(value) || 0));
 try {
  const stored = JSON.parse(localStorage.getItem('hard-burn-audio') ?? '{}');
  for (const key of Object.keys(defaults)) prefs[key] = key === 'muted' ? Boolean(stored[key] ?? prefs[key]) : clamp(stored[key] ?? prefs[key]);
 } catch {}
 const master = ctx.createGain(), compressor = ctx.createDynamicsCompressor(), limiter = ctx.createWaveShaper(), outputTrim = ctx.createGain(), meter = ctx.createAnalyser();
 // Calibrated from the actual published battle capture, after limiting so
 // sub-bass/transient balance and existing saved slider settings stay intact.
 outputTrim.gain.value = .69; stats.outputTrim = .69;
 const lowCut = ctx.createBiquadFilter(); lowCut.type = 'highpass'; lowCut.frequency.value = 24; lowCut.Q.value = .6;
 compressor.threshold.value = -10; compressor.knee.value = 7; compressor.ratio.value = 3;
 compressor.attack.value = .008; compressor.release.value = .20;
 // Transparent below -1.4dB; ceiling remains below digital full scale.
 limiter.curve = Float32Array.from({ length: 4096 }, (_, i) => {
  const x = i / 4095 * 2 - 1, a = Math.abs(x);
  return Math.sign(x) * (a <= .85 ? a : .85 + .135 * Math.tanh((a - .85) / .135));
 });
 limiter.oversample = '2x'; meter.fftSize = 512;
 master.connect(lowCut); lowCut.connect(compressor); compressor.connect(limiter); limiter.connect(outputTrim); outputTrim.connect(meter); meter.connect(ctx.destination);
 const meterData = new Float32Array(meter.fftSize);
 for (const category of Object.keys(defaults).filter(key => !['master', 'muted'].includes(key))) {
  gains[category] = ctx.createGain(); ducks[category] = ctx.createGain();
  if (['weapons','impacts','engines'].includes(category)) {
   const tone = ctx.createBiquadFilter(), grit = ctx.createWaveShaper(), weight = ctx.createGain();
   tone.type = 'lowpass'; tone.frequency.value = { weapons: 3000, impacts: 1600, engines: 850 }[category]; tone.Q.value = .55;
   grit.curve = Float32Array.from({ length: 2048 }, (_, i) => .88 * Math.tanh((i / 2047 * 2 - 1) * 1.5)); grit.oversample = '2x';
   weight.gain.value = category === 'engines' ? 1.45 : 1.9;
   gains[category].connect(tone); tone.connect(grit); grit.connect(weight); weight.connect(ducks[category]);
  } else gains[category].connect(ducks[category]);
  ducks[category].connect(master);
 }
 // Prebuilt, fixed-cost responses crossfade with camera inspection and bridge
 // view. Sends begin AFTER category ducking and sliders; every return passes
 // through master mute. No convolution buffers are rebuilt during gameplay.
 const hullNodes = Object.fromEntries(Object.entries(HULL_PROFILES).map(([name, spec]) => {
  const convolver = ctx.createConvolver(), filter = ctx.createBiquadFilter(), wet = ctx.createGain();
  const channels = hullImpulse(name, ctx.sampleRate), impulse = ctx.createBuffer(2, channels[0].length, ctx.sampleRate);
  channels.forEach((samples, channel) => impulse.getChannelData(channel).set(samples));
  convolver.normalize = false; convolver.buffer = impulse;
  filter.type = 'lowpass'; filter.frequency.value = spec.cutoff; wet.gain.value = 0;
  ducks.weapons.connect(convolver); ducks.impacts.connect(convolver);
  convolver.connect(filter); filter.connect(wet); wet.connect(master);
  return [name, { convolver, filter, wet }];
 }));
 const controls = new Map();
 const apply = () => {
  if (disposed) return;
  master.gain.setTargetAtTime(prefs.muted ? 0 : prefs.master, ctx.currentTime, .035);
  for (const [key, gain] of Object.entries(gains)) gain.gain.setTargetAtTime(prefs[key], ctx.currentTime, .035);
  for (const [key, { input, value }] of controls) { input.value = Math.round(prefs[key] * 100); value.textContent = input.value + '%'; }
  if (mute) mute.textContent = prefs.muted ? 'UNMUTE' : 'MUTE';
  try { localStorage.setItem('hard-burn-audio', JSON.stringify(prefs)); } catch {}
 };
 const abort = new AbortController();
 const preload = Promise.all([...new Set(Object.values(banks).flat())].map(async name => {
  try {
   const response = await fetch('/audio/kenney/' + name, { signal: abort.signal });
   if (!response.ok) throw Error('Missing sample');
   const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
   if (!disposed) { buffers.set(name, buffer); stats.loaded++; }
  } catch { if (!disposed) stats.missing++; }
 }));
 function choose(bank) {
  const files = banks[bank]; if (!files) return null;
  const available = files.filter(name => buffers.has(name)); if (!available.length) return null;
  const state = lastVariant.get(bank) ?? {}; lastVariant.set(bank, state);
  const name = takeVariant(available, state); stats.variants[bank] = name;
  return buffers.get(name);
 }
 function spatial(position) {
  if (!position) return { gain: 1, pan: 0, cutoff: 18000, distance: 0 };
  const dx = position.x - rts.cam.position.x, dy = position.y - rts.cam.position.y, dz = position.z - rts.cam.position.z;
  const distance = Math.hypot(dx, dy, dz), right = rts.cam.matrixWorld.elements;
  return { distance, gain: 220 / (220 + Math.max(0, distance - 120)),
   pan: clamp((dx * right[0] + dy * right[1] + dz * right[2]) / Math.max(180, distance * .8), -.88, .88),
   cutoff: Math.max(700, 15000 / (1 + distance / 520)) };
 }
 const audible = systemId => !world.campaign || !world.campaign.mapOpen && (!systemId || systemId === world.campaign.activeSystem);
 function layer(bank, volume, rate, delay, duration, category, space, priority, details = {}) {
  const buffer = choose(bank); if (!buffer) return false;
  const source = ctx.createBufferSource(), gain = ctx.createGain(), filter = ctx.createBiquadFilter(), pan = ctx.createStereoPanner();
  const varied = variedBank(bank), radio = bank.startsWith('radio-');
  const shape = varied ? combatVariation(bank === 'hb-pdc' ? 30 : details.size) : null;
  const offset = shape?.offset ?? 0;
  const start = ctx.currentTime + delay, playback = rate * (shape ? shape.pitch * shape.sizePitch : 1 + (Math.random() - .5) * (radio ? .018 : .055));
  const length = Math.min(Math.max(.01, buffer.duration - offset) / playback, duration);
  if (shape) stats.variations[bank] = { pitch: shape.pitch, gain: shape.gain, filter: shape.filter, offset, sizeGain: shape.sizeGain, sizePitch: shape.sizePitch, sizeFilter: shape.sizeFilter, cutoff: Math.min(space.cutoff, space.cutoff * shape.filter * shape.sizeFilter) };
  source.buffer = buffer; source.playbackRate.value = playback;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(volume * space.gain * (shape ? shape.gain * shape.sizeGain : .90 + Math.random() * .17), start + .0025);
  gain.gain.setTargetAtTime(.0001, start + Math.max(.01, length * (radio ? .94 : .86)), Math.max(.008, length * .10));
  filter.type = 'lowpass'; filter.frequency.value = shape ? Math.min(space.cutoff, space.cutoff * shape.filter * shape.sizeFilter) : space.cutoff; filter.Q.value = .55; pan.pan.value = space.pan;
  source.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(gains[category]);
  const voice = { source, gain, filter, pan, priority, end: start + length + .04, category, bank, systemId: details.systemId, guidedProjectile: bank.endsWith('-ignition') ? details.guidedProjectile : null, guidedGeneration: details.guidedGeneration };
  if (details.boarding) Object.assign(voice,{boarding:true,boardingPartyId:details.boardingPartyId});
  if (details.guardian) Object.assign(voice,{ guardian:true, guardianId:details.guardianId, guardianSourceId:details.guardianSourceId });
  voices.add(voice);
  source.onended = () => { voices.delete(voice); retiringVoices.delete(voice); source.disconnect(); filter.disconnect(); gain.disconnect(); pan.disconnect(); };
  source.start(start, offset); source.stop(voice.end);
  if (radio) layer('comms-close', .08, 1, delay + length, .14, category, space, priority);
  return true;
 }
 function retire(voice, stolen = true) {
  voice.gain.gain.cancelScheduledValues(ctx.currentTime);
  voice.gain.gain.setTargetAtTime(0, ctx.currentTime, .004); retiringVoices.add(voice); voice.source.stop(ctx.currentTime + .018);
  voices.delete(voice); if (stolen) stats.stolen++;
 }
 function reservePdc(priority) {
  const active = [...voices].filter(voice => voice.bank === 'hb-pdc');
  if (active.length < 4) return true;
  stats.pdcCulled++;
  const quietest = active.sort((a,b) => a.priority - b.priority || a.end - b.end)[0];
  // A nearby turret may replace a distant report; equal/less audible bursts
  // leave the current attacks intact instead of continually resetting them.
  if (priority <= quietest.priority + .08) return false;
  retire(quietest); return true;
 }
 function reservePhase(bank, priority) {
  const active = [...voices].filter(voice => phaseBanks.has(voice.bank));
  const fading = [...retiringVoices].filter(voice => phaseBanks.has(voice.bank)).length;
  if (active.length + fading >= 8) { stats.phaseCulled++; return false; }
  const ignition = bank.endsWith('-ignition');
  const attacks = ignition ? active.filter(voice => voice.bank.endsWith('-ignition')) : active;
  if (active.length < 6 && (!ignition || attacks.length < 3)) return true;
  stats.phaseCulled++;
  const candidates = ignition && attacks.length >= 3 ? attacks : active;
  const quietest = candidates.sort((a,b)=>a.priority-b.priority||a.end-b.end)[0];
  if (priority <= quietest.priority + .05) return false;
  retire(quietest); return true;
 }
 function reserve(count, priority) {
  if (voices.size + count <= 64) return true;
  const candidates = [...voices].filter(voice => voice.priority < priority).sort((a, b) => a.priority - b.priority || a.end - b.end);
  for (const voice of candidates) {
   retire(voice);
   if (voices.size + count <= 64) return true;
  }
  return false;
 }
 function cue(kind, position, systemId, details = {}) {
  if (disposed || ctx.state !== 'running' || position && !audible(systemId) && !(kind === 'nuclear-impact' && world.campaign?.factions.player.known.includes(systemId))) return false;
  const category = kind.startsWith('radio-') || ['hostile','critical'].includes(kind) ? 'alerts' : kind.startsWith('ui-') ? 'interface' : categories[kind] ?? 'weapons';
  const recipe = recipes[kind] ?? recipes.rail, now = ctx.currentTime, space = spatial(position);
  const isRadio = kind.startsWith('radio-'), isBlast = ['explosion-large', 'explosion-reactor', 'nuclear-impact'].includes(kind);
  const priority = isRadio || category === 'alerts' ? 4 : category === 'interface' ? 3 : isBlast ? 3 : (['pdc','autocannon'].includes(kind) ? .75 : ['rail','mac'].includes(kind) ? 1.5 : kind.startsWith('torpedo-') ? 1.35 : 1) + space.gain;
  // Throttle emitters independently so one PDC does not silence every ship.
  const cell = position ? [Math.round(position.x / 12), Math.round(position.y / 12), Math.round(position.z / 12)].join(':') : 'ui';
  const key = kind + ':' + cell;
  const interval = { autocannon: .22, coilgun: .13, vent: 1.8, 'hull-breach': .35, 'explosion-reactor': .65, pdc: .34, rail: .085, impact: .06, explosion: .14, intercept: .11, alert: 1.4, contact: 1, 'swarm-cold': .035, 'swarm-ignition': .07, 'missile-cold': .055, 'missile-ignition': .085, 'torpedo-cold': .09, 'torpedo-ignition': .14, click: .045, hostile: 10, critical: 18 }[kind] ?? (isRadio ? 14 : .07);
  const phaseBank = recipe.find(([bank])=>phaseBanks.has(bank))?.[0];
  const tailBank = ['rail','mac'].includes(kind) ? 'rail-tail' : ['impact','armour','hull-breach'].includes(kind) ? 'impact-tail' : null;
  const tailWeight = tailBank ? hullTailWeight(space.distance) : 0;
  const addTail = tailWeight > 0 && Math.random() < .82;
  const chosenTail = tailBank === 'impact-tail' && kind === 'armour' && Math.random() < .25 ? 'rail-tail' : tailBank;
  if (now - (lastCue.get(key) ?? -99) < interval || space.gain < .04 || (phaseBank && !reservePhase(phaseBank,priority)) || (['pdc','autocannon'].includes(kind) && !reservePdc(priority)) || !reserve(recipe.length + Number(addTail) + Number(isRadio), priority)) { stats.dropped++; return false; }
  if (kind === 'nuclear-impact') { space.gain = Math.max(.35, space.gain); space.cutoff = 1600; }
  const cutoff = { 'swarm-cold': 1500, 'swarm-ignition': 1200, 'missile-cold': 1400, 'missile-ignition': 1300, 'torpedo-cold': 1100, 'torpedo-ignition': 1000, pdc: 3000, rail: 3000, mac: 2300, flak: 2400, missile: 1800, torpedo: 1500, impact: 1600, armour: 1500, shield: 1100, explosion: 1400, 'explosion-small': 1500, 'explosion-large': 1200, 'explosion-reactor': 1000, 'hull-breach': 1200, vent: 1300, intercept: 1400, laser: 2400, plasma: 1900, emp: 1500, 'veil-arc': 1500 }[kind] ?? (category === 'alerts' ? 1700 : category === 'interface' ? 1100 : 3000);
  if (cutoff) space.cutoff = Math.min(space.cutoff, cutoff);
  let played = false;
  for (const [bank, volume, rate, delay, duration] of recipe) played = layer(bank, volume, rate * (phaseBank ? details.phaseRate ?? 1 : 1), delay + (phaseBank ? details.phaseDelay ?? 0 : 0), duration, category, space, priority, details) || played;
  if (played && addTail && layer(chosenTail, tailWeight * .38, 1, .014 + Math.random() * .012, 3.1, category, { ...space, cutoff: Math.min(space.cutoff, 1300) }, priority, details)) { stats.hullTails++; stats.layerChoices[kind] = chosenTail; }
  if (!played) return false;
  lastCue.set(key, now); stats.played++; stats.cues[kind] = (stats.cues[kind] ?? 0) + 1;
  if (lastCue.size > 1024) lastCue.delete(lastCue.keys().next().value);
  if (category === 'weapons' || category === 'impacts') { combatUntil = now + 7; if (prefs[category] > 0) weaponDuckUntil = Math.max(weaponDuckUntil, now + (isBlast ? 1.7 : .55)); }
  if (isRadio && prefs.alerts > 0) duckUntil = Math.max(duckUntil, now + 3.4);
  else if (category === 'alerts' && prefs.alerts > 0) duckUntil = Math.max(duckUntil, now + 1.2);
  if (isBlast) blastDuckUntil = Math.max(blastDuckUntil, now + .8);
  return true;
 }
 function loop(key, bank, category, rate, start = ctx.currentTime, details = {}) {
  if (loops.has(key)) return loops.get(key);
  const buffer = choose(bank); if (!buffer) return null;
  const source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner(), filter = ctx.createBiquadFilter();
  const variation = variedBank(bank) ? combatVariation(details.size) : null;
  source.buffer = buffer; source.loop = true; source.playbackRate.value = rate * (variation?.pitch ?? 1);
  filter.type = 'lowpass'; filter.frequency.value = 1800; filter.Q.value = .5; gain.gain.value = 0;
  source.connect(filter); filter.connect(gain); gain.connect(pan); pan.connect(gains[category]);
  const value = { source, gain, pan, filter, variation }; loops.set(key, value);
  source.onended = () => { retiringLoops.delete(value); source.disconnect(); filter.disconnect(); gain.disconnect(); pan.disconnect(); };
  const offset = variation ? Math.random() * Math.max(0, buffer.duration - .05) : 0;
  if (variation) stats.variations[bank] = { ...variation, offset };
  source.start(start, offset); return value;
 }
 function stopLoop(node, fade = .04, stop = .2) {
  if (stop <= .018) node.gain.gain.cancelScheduledValues(ctx.currentTime);
  node.gain.gain.setTargetAtTime(0,ctx.currentTime,fade); retiringLoops.add(node); node.source.stop(ctx.currentTime+stop);
 }
 function updateSolarAudio(frame, now, running) {
  const state = solarAudioState(frame,rts.cam.position,{ running,systemId:world.campaign?.activeSystem });
  const keys = new Set(), sparse = Math.max(.25,1-stats.musicIntensity/.5);
  if (state.ecm > 0) {
   // Disclosed interference is heard at the receiver, not as a precise bearing
   // to an enemy. Reuse the original dark machinery/noise floor, shifted above
   // its hum, with a dedicated highpass so this reads as band-limited hiss.
   const node = loop('solar-ecm','shipboard','ambience',1.9);
   if (node) {
    if (!node.highpass) {
     node.highpass = ctx.createBiquadFilter(); node.highpass.type = 'highpass'; node.highpass.frequency.value = 180; node.highpass.Q.value = .5;
     node.source.disconnect(); node.source.connect(node.highpass); node.highpass.connect(node.filter);
     const ended = node.source.onended; node.source.onended = () => { node.highpass.disconnect(); ended(); };
    }
    keys.add('solar-ecm'); node.gain.gain.setTargetAtTime(.40*state.ecm*sparse,now,.08);
    node.filter.frequency.setTargetAtTime(600+300*state.ecm,now,.12);
   }
  }
  for (const entry of state.traffic) {
   const key = 'solar-traffic-'+frame.systemId+'-'+entry.id;
   const node = loop(key,entry.kind === 'drone' ? 'hb-drive-small' : 'hb-drive-medium','engines',.85);
   if (!node) continue; keys.add(key);
   const space = spatial({x:entry.position[0],y:entry.position[1],z:entry.position[2]});
   node.gain.gain.setTargetAtTime((entry.kind === 'drone' ? .16 : .20)*entry.throttle*entry.confidence*space.gain*sparse/Math.sqrt(state.traffic.length),now,.025);
   node.pan.pan.setTargetAtTime(space.pan,now,.08);
   node.filter.frequency.setTargetAtTime(Math.min(space.cutoff,230+entry.throttle*350),now,.08);
   node.source.playbackRate.setTargetAtTime(.78+entry.throttle*.13,now,.08);
  }
  for (const [key,node] of loops) if (key.startsWith('solar-')&&!keys.has(key)) {
   stopLoop(node,.004,.018); loops.delete(key);
  }
  stats.ecmStrength = state.ecm; stats.ecmLoops = Number(keys.has('solar-ecm'));
  stats.trafficLoops = [...keys].filter(key=>key.startsWith('solar-traffic-')).length;
  stats.trafficKinds = state.traffic.map(entry=>entry.kind);
 }
 function startMusic(now) {
  if (scoreNodes || !['bed', 'motif', 'pulse', 'combat', 'danger', 'machinery'].every(key => banks['score-' + key].every(name => buffers.has(name)))) return;
  musicStart = now + .04;
  scoreNodes = Object.fromEntries(['bed', 'motif', 'pulse', 'combat', 'danger', 'machinery'].map(key => [key, loop('score-' + key, 'score-' + key, 'music', 1, musicStart)]));
  for (const node of Object.values(scoreNodes)) node.filter.frequency.value = 1900;
 }
 function guidedState(projectile, created = false) {
  const data = projectile.userData, generation = data.guidedGeneration ?? 0;
  let state = guidedObserved.get(projectile);
  if (!state || state.generation !== generation) {
   // An already flying object discovered on load/view entry has no new launch.
   const inFlight = !created && !data.launchPending && (data.flightAge > .12 || data.motorActive === true);
   state = { generation, cold: inFlight, ignited: inFlight, coldAt: -99 };
   guidedObserved.set(projectile,state);
  }
  return state;
 }
 function phase(projectile, position, heading, ignition) {
  if (!projectile?.userData || disposed) return false;
  const state = guidedState(projectile,true), flag = ignition ? 'ignited' : 'cold';
  if (state[flag]) return false;
  state[flag] = true;
  const type = guidedType(projectile.userData.weapon), kind = type + (ignition ? '-ignition' : '-cold');
  stats.phaseEvents[kind] = (stats.phaseEvents[kind] ?? 0) + 1;
  if (!ignition) state.coldAt = ctx.currentTime;
  const system = projectile.userData.effectSystemId ?? projectile.userData.owner?.systemId;
  // Consume remote/paused transitions instead of replaying them on view entry.
  if (world.speed <= 0 || world.campaign?.mapOpen || projectile.userData.done || !audible(system)) return false;
  const details = { size:clamp((projectile.userData.effectScale?.body ?? .2)*160,8,160),
   systemId:system, guidedProjectile:projectile, guidedGeneration:state.generation, phaseRate:projectile.userData.weapon === 'nuclear' ? .82 : 1,
   phaseDelay:ignition ? Math.max(0,.025-(ctx.currentTime-state.coldAt)) : 0 };
  const played = cue(kind,position ?? projectile.position,system,details);
  if (played) stats[ignition ? 'ignitions' : 'coldLaunches']++;
  return played;
 }
 function phaseCold(position, heading, projectile) { return phase(projectile,position,heading,false); }
 function phaseIgnition(position, heading, projectile) { return phase(projectile,position,heading,true); }
 function updateGuided(now, running) {
  for (const voice of voices) {
   if (!phaseBanks.has(voice.bank)) continue;
   const data = voice.guidedProjectile?.userData;
   if (!running || !audible(voice.systemId) || data && (data.motorActive !== true || data.done || data.launchPending || (data.guidedGeneration ?? 0) !== voice.guidedGeneration)) retire(voice);
  }
  // Two nearest live guided motors are monitored through the hull. Gain rises
  // as they close on their target; remote/done/paused projectiles are silent.
  for (const missile of world.missiles ?? []) {
   const projectile = missile.obj, data = projectile?.userData;
   if (!data || data.done) continue;
   const state = guidedState(projectile);
   if (!data.launchPending && !state.cold) phaseCold(projectile.position,null,projectile);
   if (!data.launchPending && data.motorActive === true && !state.ignited) phaseIgnition(projectile.position,null,projectile);
  }
  const guidedKeys = new Set();
  const incoming = running ? (world.missiles ?? []).filter(m => !m.obj?.userData?.done && !m.obj?.userData?.launchPending && m.obj?.userData?.motorActive === true && m.obj?.position && audible(m.systemId ?? m.owner?.systemId) && spatial(m.obj.position).distance <= guidedMotorRange(m.obj.userData.weapon))
   .sort((a,b) => a.obj.position.distanceToSquared(rts.cam.position) - b.obj.position.distanceToSquared(rts.cam.position)).slice(0,2) : [];
  for (const missile of incoming) {
   const key = 'guided-' + missile.obj.id + '-' + (missile.obj.userData.guidedGeneration ?? 0), space = spatial(missile.obj.position);
   if (missile.obj.userData.motorActive !== true) continue;
   const bank = guidedBank(missile.obj.userData.weapon);
   const node = loop(key, bank, 'weapons', 1, now, {size:clamp((missile.obj.userData.effectScale?.body ?? .2)*160,8,160)}); if (!node) continue; guidedKeys.add(key);
   const target = missile.obj.userData.targetEntity?.pos;
   const closing = target ? 1 / (1 + missile.obj.position.distanceTo(target) / 240) : .25;
   const distant = space.distance > 1000 ? distantMotorShape(space.distance) : null;
   node.gain.gain.setTargetAtTime((distant?.gain ?? .14 * space.gain) * (.35 + closing) * node.variation.gain * node.variation.sizeGain, now, .012);
   node.source.playbackRate.setTargetAtTime((.72 + closing * .38) * node.variation.pitch * node.variation.sizePitch, now, .2);
   node.filter.frequency.setTargetAtTime(Math.min(space.cutoff,distant?.cutoff ?? Infinity,(bank !== 'torpedo-burn' ? 390 + closing * 460 : 280 + closing * 390) * node.variation.filter * node.variation.sizeFilter), now, .2); node.pan.pan.setTargetAtTime(space.pan, now, .12);
  }
  const swarm = running ? (world.missiles ?? []).filter(m => m.obj?.userData?.weapon === 'swarm' && !m.obj.userData.done && !m.obj.userData.launchPending && m.obj.userData.motorActive === true && m.obj.position && audible(m.systemId ?? m.owner?.systemId) && spatial(m.obj.position).distance <= 1000) : [];
  stats.swarmDensity = swarm.length;
  if (swarm.length >= 3) {
   const center = {x:0,y:0,z:0};
   for (const missile of swarm) for (const axis of ['x','y','z']) center[axis] += missile.obj.position[axis] / swarm.length;
   const space = spatial(center), node = loop('swarm-wall','swarm-burn','weapons',1,now,{size:12});
   if (node) {
    const density = Math.sqrt(Math.min(40,swarm.length) / 40);
    node.gain.gain.setTargetAtTime(.12*density*space.gain*node.variation.gain,now,.012);
    node.filter.frequency.setTargetAtTime(Math.min(space.cutoff,780*node.variation.filter),now,.18);
    node.pan.pan.setTargetAtTime(space.pan,now,.16);
    node.source.playbackRate.setTargetAtTime(node.variation.pitch,now,.2);
    if (prefs.weapons > 0) weaponDuckUntil = Math.max(weaponDuckUntil,now+.2);
   }
  } else if (loops.has('swarm-wall')) { stopLoop(loops.get('swarm-wall'),.004,.018); loops.delete('swarm-wall'); }
  stats.swarmLoops = Number(loops.has('swarm-wall'));
  for (const [key,node] of loops) if (key.startsWith('guided-') && !guidedKeys.has(key)) { stopLoop(node,.004,.018); loops.delete(key); }
  stats.guidedLoops = guidedKeys.size;
  stats.distantGuidedLoops = incoming.filter(m => guidedKeys.has('guided-' + m.obj.id + '-' + (m.obj.userData.guidedGeneration ?? 0)) && spatial(m.obj.position).distance > 1000).length;
  stats.phaseVoices = [...voices].filter(voice=>phaseBanks.has(voice.bank)).length;
 }
 let lastEvent, eventsInitialized = false;
 function updateGuardianAudio(frame,running,observe) {
  const permitted = running && !prefs.muted && prefs.master > 0 && prefs.ambience > 0;
  const bodies = guardianSources(frame,world.campaign?.activeSystem);
  const sources = new Set((frame?.guardianEvents ?? []).slice(0,96).filter(e=>e?.disclosed===true&&e.observed===true&&e.precise===true&&e.systemId===world.campaign?.activeSystem&&Number.isFinite(e.confidence)&&e.confidence>=.72).map(e=>String(e.sourceId)));
  for (const voice of voices) if (voice.guardian && (!permitted || !bodies.has(voice.guardianId) || !sources.has(voice.guardianSourceId))) retire(voice,false);
  if (observe) {
   const event = observeGuardianAudio(frame,guardianObserved,{running,systemId:world.campaign?.activeSystem,
    listener:[rts.cam.position.x,rts.cam.position.y,rts.cam.position.z],allowReport:permitted});
   if (event) {
    const active = [...voices,...retiringVoices].filter(v=>v.guardian).length;
    // Never steal or replace a gun voice for background character.
    if (active >= 2 || voices.size >= 64) stats.guardianCulled++;
    else {
     const shape = GUARDIAN_ACCENTS[event.accent], position = {x:event.position[0],y:event.position[1],z:event.position[2]}, space = spatial(position);
     space.cutoff = Math.min(space.cutoff,shape.cutoff);
     if (layer(shape.bank,shape.gain,shape.rate,0,shape.duration,'ambience',space,0,{guardian:true,guardianId:event.guardianId,guardianSourceId:event.sourceId,systemId:frame.systemId})) {
      stats.guardianAccents++; stats.guardianKinds[event.accent] = (stats.guardianKinds[event.accent] ?? 0)+1; stats.lastGuardianEvent = event;
     }
    }
   }
  }
  stats.guardianVoices = [...voices].filter(v=>v.guardian).length;
 }
 function updateBoardingAudio(frame,running,observe) {
  const enabled=running&&frame?.enabled===true&&frame.systemId===world.campaign?.activeSystem&&!prefs.muted&&prefs.master>0;
  for(const voice of [...voices])if(voice.boarding&&(!enabled||prefs[voice.category]<=0||voice.systemId!==world.campaign?.activeSystem))retire(voice,false);
  if(observe){
   const event=observeBoardingAudio(frame,boardingObserved,{running,systemId:world.campaign?.activeSystem,listener:[rts.cam.position.x,rts.cam.position.y,rts.cam.position.z],allowReport:bus=>enabled&&prefs[bus]>0});
   if(event){
    const shape=BOARDING_ACCENTS[event.kind],active=[...voices,...retiringVoices].filter(v=>v.boarding).length;
    if(active>=2||voices.size>=64)stats.boardingCulled++;
    else {
     const space=event.position?spatial({x:event.position[0],y:event.position[1],z:event.position[2]}):{gain:1,pan:0,cutoff:shape.cutoff};space.cutoff=Math.min(space.cutoff,shape.cutoff);
     if(layer(shape.bank,shape.gain,shape.rate,0,shape.duration,shape.bus,space,0,{boarding:true,boardingPartyId:event.partyId,systemId:event.systemId})){stats.boardingAccents++;stats.boardingKinds[event.kind]=(stats.boardingKinds[event.kind]??0)+1;stats.lastBoardingEvent=event;}
    }
   }
  }
  stats.boardingVoices=[...voices].filter(v=>v.boarding).length;
 }
 function update() {
  if (disposed) return;
  if (ctx.state !== 'running') {
   guardianObserved.initialized=false; boardingObserved.initialized=false;
   for (const voice of [...voices]) if (voice.guardian||voice.boarding) {
    voice.gain.gain.cancelScheduledValues(ctx.currentTime); voice.gain.gain.setValueAtTime(0,ctx.currentTime);
    retiringVoices.add(voice); voice.source.stop(); voices.delete(voice);
   }
   stats.guardianVoices=0; stats.boardingVoices=0; return;
  }
  const now = ctx.currentTime, running = world.speed > 0 && !world.campaign?.mapOpen;
  updateGuided(now,running);
  const solarFrame = world.solarIntel?.();
  updateSolarAudio(solarFrame,now,running);
  updateGuardianAudio(solarFrame,running,now >= nextTick);
  updateBoardingAudio(solarFrame,running,now >= nextTick);
  if (now < nextTick) return; nextTick = now + .10;
  const elapsed = Math.min(.5, now - (lastUpdate || now)); lastUpdate = now;
  const ships = world.galactic ? [...world.galactic.units.values()] : [...world.fleets.values()].flatMap(fleet => fleet.members);
  let scanEvent = observeActiveScan(solarFrame,sensorObserved.scan ??= {},running);
  if (scanEvent && now >= (sensorObserved.nextAt ?? 0)) sensorObserved.nextAt = now + 4; else scanEvent = null;
  const ewEvent = observeEwEvents(solarFrame,sensorObserved.ew ??= {},{running,systemId:world.campaign?.activeSystem,allowReport:!scanEvent && now >= (sensorObserved.nextAt ?? 0)});
  if (ewEvent) sensorObserved.nextAt = now+4;
  const discovery = observeDiscoveryIntel(solarFrame,sensorObserved.discovery ??= {},{running,systemId:world.campaign?.activeSystem,allowReport:!scanEvent && !ewEvent && now >= (sensorObserved.nextAt ?? 0)});
  if (discovery.event) sensorObserved.nextAt = now+4;
  stats.discoveryContacts = discovery.contacts;
  const sensorContacts = [];
  for (const [id, entry] of world.galactic?.radarContacts ?? []) {
   const contact = world.campaign?.contacts?.[id], ship = entry.group?.userData?.sensorEntity;
   if (!contact || !audible(contact.systemId) || ship?.dead || ship?.campaignUnit?.transit) continue;
   // Hidden designer views consume transitions, so returning to tactical
   // cannot masquerade as losing and reacquiring an unchanged radar echo.
   sensorContacts.push({ id, confidence: contact.confidence, uncertainty: contact.uncertainty, identified: contact.identified, suppressed: !entry.group?.visible });
  }
  const receiver = observeSensorContacts(sensorContacts, sensorObserved, now, { enabled: running, scope: world.campaign?.activeSystem });
  if (scanEvent) sensorObserved.pending = null; // Coalesce returns from this emission.
  stats.sensorContacts = receiver.contacts; stats.uncertainContacts = receiver.uncertain;
  const receiverTension = Math.max(receiver.tension,stats.ecmStrength*.22);
  stats.sensorTension += (receiverTension - stats.sensorTension) * (1 - Math.exp(-elapsed / (receiverTension > stats.sensorTension ? 2.5 : 5)));
  const sensorEvent = scanEvent ?? ewEvent ?? discovery.event ?? receiver.event;
  if (sensorEvent) lastCue.set('contact:ui',now); // The campaign log must not repeat this receiver report.
  if (sensorEvent && voices.size < 64 && !prefs.muted && prefs.alerts > 0) {
   const shape = { ping: [.18,.88,.55,950], sweep: [.16,.70,.9,700], detected: [.16,.78,.70,850], acquired: [.22,1,.90,1250], uncertain: [.12,.66,1.1,650], 'discovery-detected': [.16,.62,.9,650], 'discovery-identified': [.22,.82,1.1,1050], 'decoy-diversion': [.19,.70,.75,800], 'recovery-complete': [.18,.90,.8,1100] }[sensorEvent.kind];
   if (layer('contact',shape[0],shape[1],0,shape[2],'alerts',{ gain:1,pan:0,cutoff:shape[3] },0)) {
    stats.sensorPings++; if (sensorEvent.kind === 'recovery-complete') stats.recoveryReports++; if (sensorEvent.kind === 'decoy-diversion') stats.ewReports++; if (sensorEvent.kind.startsWith('discovery-')) stats.discoveryReports++; stats.sensorEvents[sensorEvent.kind] = (stats.sensorEvents[sensorEvent.kind] ?? 0) + 1; stats.lastSensorEvent = sensorEvent;
   }
  }
  const mood = navalThreat(ships, world.missiles ?? [], { running, audible, recentFire: now < combatUntil });
  const target = mood.intensity;
  stats.musicIntensity += (target - stats.musicIntensity) * (1 - Math.exp(-elapsed / (target ? 1.3 : 8)));
  stats.musicDanger += (mood.danger - stats.musicDanger) * (1 - Math.exp(-elapsed / (mood.danger > stats.musicDanger ? 1.6 : 6)));
  stats.localThreats = mood.threats; stats.criticalHulls = mood.critical;
  if (running && mood.critical && mood.intensity > .3 && now - (lastCue.get('critical:ui') ?? -99) >= 24 && now - (lastCue.get('radio-breach:ui') ?? -99) > 7) cue('critical');
  startMusic(now);
  const intensity = stats.musicIntensity;
  const tension = stats.sensorTension * Math.max(0, 1 - intensity / .35);
  const phrase = quietPhrase(now - (musicStart ?? now), intensity); stats.quietPhrase = phrase.phrase;
  if (scoreNodes) {
   scoreNodes.bed.gain.gain.setTargetAtTime(.85 - intensity * .38, now, 1.6);
   scoreNodes.motif.gain.gain.setTargetAtTime(phrase.motif * (.75 - intensity * .48), now, 1.6);
   scoreNodes.pulse.gain.gain.setTargetAtTime(.75 * intensity + .18 * tension, now, .6);
   scoreNodes.combat.gain.gain.setTargetAtTime(.85 * Math.max(0, (intensity - .35) / .65), now, .8);
   scoreNodes.danger.gain.gain.setTargetAtTime(.68 * stats.musicDanger + .10 * tension, now, 1);
   scoreNodes.bed.filter.frequency.setTargetAtTime(1900 - 650 * stats.musicDanger - 350 * tension, now, 2);
   scoreNodes.machinery.gain.gain.setTargetAtTime(.60 * phrase.machinery, now, 1.2);
  }
  const radioActive = now < duckUntil, blastActive = now < blastDuckUntil, weaponActive = now < weaponDuckUntil;
  stats.weaponDucking = weaponActive;
  for (const [category, node] of Object.entries(ducks)) {
   const amount = radioActive ? ({ music: .35, ambience: .45, engines: .55, weapons: .58, impacts: .65 }[category] ?? 1)
    : blastActive ? ({ music: .18, ambience: .42, engines: .55 }[category] ?? 1) : weaponActive ? ({ music: .32, ambience: .68 }[category] ?? 1) : 1;
   node.gain.setTargetAtTime(amount, now, amount < node.gain.value ? .025 : .45);
  }
  stats.acousticProfile = hullProfile(ships, rts.cam.position, { bridge: Boolean(world.bridgeView), audible });
  for (const [name, node] of Object.entries(hullNodes)) node.wet.gain.setTargetAtTime(name === stats.acousticProfile ? HULL_PROFILES[name].wet : 0, now, .35);
  const ambient = loop('ambient', 'shipboard', 'ambience', 1);
  ambient?.gain.gain.setTargetAtTime(world.campaign?.mapOpen ? .17 : .28, now, 1);
  const active = ships.filter(ship => !ship.dead && !ship.dockedAt && !ship.campaignUnit?.transit && audible(ship.systemId)
   && !ship.campaignUnit?.runningCold && !ship.campaignUnit?.disabled && (ship.driveBurn ?? 0) > .035)
   .sort((a, b) => a.pos.distanceToSquared(rts.cam.position) - b.pos.distanceToSquared(rts.cam.position)).slice(0, 4);
  const engineKeys = new Set();
  for (const ship of active) {
   const key = 'engine-' + ship.grp.id;
   const node = loop(key, ['capital', 'carrier', 'cruiser'].includes(ship.type) ? 'hb-drive-heavy' : ship.type === 'fighter' ? 'hb-drive-small' : 'hb-drive-medium', 'engines', .85);
   if (!node) continue; engineKeys.add(key);
   const space = spatial(ship.pos), burn = clamp(ship.driveBurn, 0, 1.2);
   node.gain.gain.setTargetAtTime(running ? .68 * burn * space.gain / Math.sqrt(Math.max(1, active.length * .45)) : 0, now, .22);
   node.pan.pan.setTargetAtTime(space.pan, now, .12);
   node.filter.frequency.setTargetAtTime(Math.min(space.cutoff, 240 + burn * 610), now, .2);
   node.source.playbackRate.setTargetAtTime(.80 + burn * .17, now, .3);
  }
  for (const [key, node] of loops) if (key.startsWith('engine-') && !engineKeys.has(key)) {
   stopLoop(node,.06,.28); loops.delete(key);
  }
  if (pendingRadio && now >= pendingRadio.at) { const event = pendingRadio; pendingRadio = null; cue(event.key); }
  const events = world.campaign?.events;
  if (events?.length) {
   if (!eventsInitialized) { lastEvent = events.at(-1); eventsInitialized = true; }
   else if (lastEvent !== events.at(-1)) {
    const index = events.indexOf(lastEvent), recent = events.slice(index < 0 ? -1 : index + 1); lastEvent = events.at(-1);
    for (const event of recent) {
     // The legacy spoof log is generated for every faction/system, regardless
     // of player sensors. Only the disclosed radar receiver may sound a decoy.
     if (canonicalReceiverReport(event.text ?? event.message) || event.kind === 'sensor' && /^FALSE DRIVE SIGNALS EMITTED\b/i.test(event.text ?? event.message ?? '')) continue;
     if (['crisis', 'sensor', 'match'].includes(event.kind)) cue(event.kind === 'sensor' ? /incoming|hostile|raider|torpedo/i.test(event.text ?? event.message ?? '') ? 'hostile' : 'contact' : 'alert');
    }
   }
  }
  // Prune moving emitter keys instead of growing a map throughout a campaign.
  if (lastCue.size > 512) for (const [key, at] of lastCue) if (now - at > 20) lastCue.delete(key);
  const leaks = new Map(ships.map(ship => [ship, hullLeakState(ship)]));
  const venting = running ? ships.filter(ship => !ship.dead && audible(ship.systemId) && leaks.get(ship).venting)
   .sort((a,b) => a.pos.distanceToSquared(rts.cam.position) - b.pos.distanceToSquared(rts.cam.position)).slice(0,2) : [];
  for (const ship of ships) {
   const count = leaks.get(ship).breaches, previous = hullObserved.get(ship);
   const observed = previous ?? { count, ventAt: now }; hullObserved.set(ship, observed);
   if (running && previous && count > observed.count && !ship.dead && audible(ship.systemId)) {
    if (cue('hull-breach',ship.pos,ship.systemId,{size:ship.model?.userData.length ?? 30})) stats.hullBreaches++;
   }
   observed.count = count;
  }
  for (const ship of venting) {
   const observed = hullObserved.get(ship);
   if (now - observed.ventAt >= 1.8 && cue('vent',ship.pos,ship.systemId,{size:ship.model?.userData.length ?? 30})) { observed.ventAt = now; stats.vents++; }
  }
  stats.engineLoops = engineKeys.size; stats.ambientLoops = Number(loops.has('ambient'));
  stats.pdcVoices = [...voices].filter(voice => voice.bank === 'hb-pdc').length;
  stats.musicLoops = scoreNodes ? 6 : 0; stats.ducking = radioActive; stats.active = voices.size; stats.musicStartedAt = musicStart;
  meter.getFloatTimeDomainData(meterData); let peak = 0;
  for (const sample of meterData) peak = Math.max(peak, Math.abs(sample));
  stats.peak = peak; stats.peakMax = Math.max(stats.peakMax, peak);
  if (!panel.hidden) output.textContent = 'OUTPUT ' + Math.round(peak * 100) + '% · ' + (prefs.muted ? 'MUTED' : stats.missing ? 'SAMPLE LOAD INCOMPLETE' : 'ONLINE');
 }
 const control = document.createElement('button'), panel = document.createElement('section');
 control.className = 'audio-toggle'; control.textContent = 'AUDIO'; control.title = 'Open sound mixer';
 panel.className = 'audio-mixer'; panel.hidden = true;
 panel.innerHTML = '<strong>SHIPBOARD AUDIO</strong><p>Hull vibration, tactical comms and adaptive naval score.</p>';
 for (const key of Object.keys(defaults).filter(key => key !== 'muted')) {
  const label = document.createElement('label'), input = document.createElement('input'), value = document.createElement('span');
  label.textContent = key.toUpperCase(); input.type = 'range'; input.min = 0; input.max = 100;
  input.value = Math.round(prefs[key] * 100); input.dataset.audioBus = key; value.textContent = input.value + '%';
  input.oninput = () => { prefs[key] = Number(input.value) / 100; apply(); };
  controls.set(key, { input, value }); label.append(input, value); panel.append(label);
 }
 const mute = document.createElement('button'); mute.textContent = prefs.muted ? 'UNMUTE' : 'MUTE';
 mute.onclick = () => { prefs.muted = !prefs.muted; apply(); };
 const output = document.createElement('p'); output.className = 'audio-meter'; output.textContent = 'WAITING FOR INPUT';
 panel.append(mute, output); document.body.append(control, panel); control.onclick = () => { panel.hidden = !panel.hidden; };
 apply();
 const unlock = () => {
  if (disposed) return Promise.resolve(); unlocked = true;
  return ctx.state === 'running' ? Promise.resolve() : ctx.resume().catch(() => {});
 };
 const pointer = event => {
  const button = event.target.closest?.('button'), click = button && !button.disabled;
  const label = button?.textContent?.trim() ?? '';
  const kind = /cancel|close|return|back|quit/i.test(label) ? 'ui-cancel' : /nav|plot burn|enter system|bridge/i.test(label) ? 'ui-nav' : /select|loadout|shipyard|fleet/i.test(label) ? 'ui-select' : 'click';
  const ready = unlock(); if (click) void ready.then(() => { if (!document.hidden) cue(kind); });
 };
 const keydown = event => {
  void unlock();
  if (!event.repeat && !event.target.closest?.('input,textarea,select,[contenteditable]')) {
   if (event.key === 'Escape') cue('ui-cancel');
   else if (['f','b','h'].includes(event.key.toLowerCase())) cue('ui-nav');
  }
 };
 const visibility = () => { if (disposed) return; if (document.hidden) void ctx.suspend(); else if (unlocked) void unlock(); };
 document.addEventListener('pointerdown', pointer, { capture: true });
 document.addEventListener('keydown', keydown); document.addEventListener('visibilitychange', visibility);
 function dispose() {
  if (disposed) return; disposed = true; abort.abort(); pendingRadio = null;
  document.removeEventListener('pointerdown', pointer, { capture: true }); document.removeEventListener('keydown', keydown);
  document.removeEventListener('visibilitychange', visibility);
  for (const voice of [...voices, ...retiringVoices]) voice.source.stop();
  for (const node of [...loops.values(), ...retiringLoops]) node.source.stop();
  for (const node of Object.values(hullNodes)) { node.convolver.disconnect(); node.filter.disconnect(); node.wet.disconnect(); }
  outputTrim.disconnect();
  boardingObserved.seen?.clear(); boardingObserved.cooldowns?.clear(); boardingObserved.initialized=false; stats.boardingVoices=0;
  guardianObserved.seen?.clear(); guardianObserved.cooldowns?.clear(); guardianObserved.initialized=false; stats.guardianVoices=0;
  voices.clear(); retiringVoices.clear(); retiringLoops.clear(); loops.clear(); sensorObserved.ew?.seen?.clear(); if (sensorObserved.ew) sensorObserved.ew.pending = null; sensorObserved.discovery?.tracks?.clear(); if (sensorObserved.discovery) sensorObserved.discovery.pending = null; stats.discoveryContacts = 0; stats.ecmStrength = 0; stats.ecmLoops = 0; stats.trafficLoops = 0; stats.trafficKinds = []; stats.disposed = true; stats.active = 0; stats.pdcVoices = 0; stats.phaseVoices = 0; stats.guidedLoops = 0; stats.swarmLoops = 0; stats.swarmDensity = 0; stats.distantGuidedLoops = 0; stats.sensorTension = 0; sensorObserved.tracks?.clear(); sensorObserved.pending = null; control.remove(); panel.remove(); void ctx.close();
 }
 return {
  context: ctx, stats, preload, update, prefs, meter, unlock, dispose, phaseCold, phaseIgnition,
  radio: (kind, rate = 1) => {
   if (!banks['radio-' + kind] || ctx.state !== 'running' || disposed) return;
   const now = ctx.currentTime, key = 'radio-' + kind;
   if (kind === 'incoming' && now - (lastCue.get('hostile:ui') ?? -99) >= 10) cue('hostile');
   if (now < nextRadio || now - (lastCue.get(key + ':ui') ?? -99) < 14) return;
   nextRadio = now + 3.8; pendingRadio = { key, at: now + clamp(1 - rate, 0, .4) * .8 };
  },
  // Guided mount-fire is an order, not a cold release or motor ignition.
  weapon: (kind, position, systemId, details) => ['missile','torpedo','nuclear','swarm'].includes(kind) ? false : cue(kind === 'proj' ? 'rail' : kind === 'light' ? 'plasma' : kind, position, systemId, details),
  impact: (position, systemId, shield, weapon, details) => cue(shield ? 'shield' : weapon === 'hull-breach' ? 'hull-breach' : ['rail', 'mac', 'proj'].includes(weapon) ? 'armour' : 'impact', position, systemId, details),
  effect: object => {
   if (object.userData.guidedMissile) guidedState(object,true);
   if (object.userData.explosion) cue(blastEvent(object.userData.blastKind,object.userData.effectScale?.blastRadius ?? 1), object.position, object.userData.effectSystemId,{size:Math.max(8,(object.userData.effectScale?.blastRadius ?? 1)*6)});
   else if (object.userData.interception) cue('intercept', object.position, object.userData.effectSystemId);
  },
  notify: text => canonicalReceiverReport(text) ? false : cue(/incoming|hostile|torpedo/i.test(text) ? 'hostile' : /breach|disabled|pressure loss/i.test(text) ? 'critical' : /lost|fail|insufficient|warning|defeat/i.test(text) ? 'alert' : 'confirm'),
  setLevel: (key, value) => { if (key in prefs) { prefs[key] = key === 'muted' ? Boolean(value) : clamp(value); apply(); } },
 };
}
