// Audio-only policy: local damaged hulls/threats inform the score, never gameplay.
export function hullLeakState(ship) {
 const sections = ship.campaignUnit?.damageControl?.sections ?? ship.damageControl?.sections;
 if (Array.isArray(sections)) {
  // Visual punctures remain as scars after a patch and cap at six. Actual
  // compartments own leak count and available gas; repairs never change here.
  return {
   breaches: sections.reduce((sum, section) => sum + Math.max(0, Number(section.breaches) || 0), 0),
   venting: sections.some(section => section.breaches > 0 && section.pressure > .025),
  };
 }
 const breaches = ship.breaches?.length ?? 0;
 return { breaches, venting: breaches > 0 && ship.hp / ship.maxHp < .95 };
}
export function navalThreat(ships, missiles, { running, audible, recentFire }) {
 if (!running) return { intensity: 0, danger: 0, threats: 0, critical: 0 };
 const local = ships.filter(ship => !ship.dead && !ship.dockedAt && !ship.campaignUnit?.transit && audible(ship.systemId));
 const friendly = local.filter(ship => ship.faction === 'player');
 const critical = friendly.filter(ship => ship.maxHp > 0 && ship.hp / ship.maxHp < .3).length;
 const damaged = friendly.some(ship => ship.maxHp > 0 && ship.hp / ship.maxHp < .55);
 const activeMissiles = missiles.filter(missile => !missile.obj?.userData?.done && audible(missile.systemId));
 const threats = activeMissiles.filter(missile => {
  const target = missile.obj?.userData?.targetEntity;
  return target?.faction ? target.faction === 'player' : missile.owner?.faction !== 'player';
 }).length;
 const engaged = local.filter(ship => ship.target && !ship.target.dead).length;
 const fighting = recentFire || activeMissiles.length > 0 || engaged > 0;
 return { threats, critical,
  intensity: fighting ? Math.min(1, .48 + Math.min(threats, 8) * .065 + Math.min(engaged, 8) * .035 + (recentFire ? .18 : 0)) : 0,
  danger: fighting ? Math.min(1, Math.min(threats, 8) * .085 + (damaged ? .22 : 0) + (critical ? .48 : 0)) : 0 };
}

// A shuffled bag plays every loaded variant once before reusing any. Avoid the
// last choice across bag boundaries, including a bank that finishes loading.
export function takeVariant(files, state, random = Math.random) {
 if (!files.length) return null;
 const signature = files.join('|');
 if (!state.bag?.length || state.signature !== signature) {
  state.signature = signature; state.bag = [...files];
  for (let i = state.bag.length - 1; i > 0; i--) {
   const j = Math.floor(random() * (i + 1));
   [state.bag[i], state.bag[j]] = [state.bag[j], state.bag[i]];
  }
  if (state.bag.length > 1 && state.bag.at(-1) === state.last) [state.bag[0], state.bag[state.bag.length - 1]] = [state.bag.at(-1), state.bag[0]];
 }
 state.last = state.bag.pop(); return state.last;
}

export function hullTailWeight(distance) {
 return Math.min(.65, Math.max(0, (distance - 200) / 1000));
}

// Receiver reports, not a free scan of hidden enemy positions. The caller
// supplies genuine tactical radar entries in this system; hidden views consume
// their transitions silently instead of inventing an acquisition on return.
export function observeSensorContacts(contacts, state, now, { enabled, scope }) {
 if (!enabled || state.scope !== scope) {
  state.scope = scope; state.tracks = new Map(); state.initialized = false; state.pending = null;
 }
 if (!enabled) return { event: null, tension: 0, contacts: 0, uncertain: 0 };
 state.tracks ??= new Map();
 const fresh = !state.initialized, seen = new Set(), visible = new Set(), candidates = [];
 let tension = 0, uncertain = 0;
 for (const contact of contacts.slice(0, 512)) {
  seen.add(contact.id);
  const confidence = Math.max(0, Math.min(1, contact.confidence || 0));
  const uncertainty = Number.isFinite(contact.uncertainty) ? Math.max(12, Math.min(1e6, contact.uncertainty)) : 152;
  if (!contact.suppressed && confidence >= .10) visible.add(contact.id);
  let track = state.tracks.get(contact.id);
  const previous = track?.stage ?? 0;
  if (!track) { track = { stage: 0, anchor: uncertainty, reports: {}, lostAt: null }; state.tracks.set(contact.id, track); }
  track.seenAt = now;
  track.anchor = Math.min(track.anchor, uncertainty);
  if (confidence < .075) track.lostAt ??= now; else track.lostAt = null;
  if (track.lostAt !== null && now - track.lostAt >= 5) track.stage = 0;
  else if (confidence >= .72 && contact.identified) track.stage = 2;
  else if (confidence >= .10 && (track.stage === 0 || confidence < .60)) track.stage = 1;
  let kind = track.stage > previous ? track.stage === 2 ? 'acquired' : 'detected' : null;
  if (!kind && track.stage === 1 && confidence >= .10 && uncertainty - track.anchor >= Math.max(28, track.anchor * .20)) kind = 'uncertain';
  if (kind || fresh) track.anchor = uncertainty;
  if (kind && !fresh && !contact.suppressed && now - (track.reports[kind] ?? -99) >= 18) candidates.push({ kind, id: contact.id, confidence, uncertainty, track, expires: now + 6 });
  if (!contact.suppressed && confidence >= .10) {
   if (!contact.identified) uncertain++;
   tension = Math.max(tension, contact.identified ? .08 : Math.min(.55, .22 + (.72 - confidence) * .32 + Math.min(1, uncertainty / 152) * .14));
  }
 }
 for (const [id, track] of state.tracks) if (!seen.has(id)) {
  track.lostAt ??= now;
  if (now - track.lostAt >= 5) track.stage = 0;
  if (now - track.seenAt > 60) state.tracks.delete(id);
 }
 while (state.tracks.size > 512) state.tracks.delete(state.tracks.keys().next().value);
 state.initialized = true;
 // Consume simultaneous transitions rather than queueing a fleet's worth of
 // pings. One receiver report per four seconds; eighteen seconds per contact.
 const priority = { acquired: 3, detected: 2, uncertain: 1 };
 candidates.sort((a,b) => priority[b.kind] - priority[a.kind] || b.confidence - a.confidence);
 if (state.pending && (now > state.pending.expires || !visible.has(state.pending.id) || state.pending.track.stage === 0 || state.pending.kind === 'acquired' && state.pending.track.stage !== 2 || state.pending.kind === 'uncertain' && state.pending.track.stage !== 1)) state.pending = null;
 if (candidates.length && (!state.pending || priority[candidates[0].kind] >= priority[state.pending.kind])) state.pending = candidates[0];
 let event = null;
 if (state.pending && now >= (state.nextAt ?? 0)) {
  const chosen = state.pending; chosen.track.reports[chosen.kind] = now; state.nextAt = now + 4; state.pending = null;
  event = { kind: chosen.kind, id: chosen.id, confidence: chosen.confidence, uncertainty: chosen.uncertainty };
 }
 return { event, tension, contacts: visible.size, uncertain };
}

// Keep the existing near-field mix intact. Heavy guided burns can be monitored
// across the actual 3,400–4,200-unit firing envelope, with no coast inference.
export function guidedMotorRange(weapon) { return ['torpedo','nuclear'].includes(weapon) ? 4800 : 1000; }
export function distantMotorShape(distance) {
 const ratio = Math.max(1, distance / 1000);
 return { gain: .028 * ratio ** -.65, cutoff: 360 * ratio ** -.20 };
}

// Optional authoritative solar adapter; never inspect hidden emitters or
// manufacture a passive sweep. Restored/in-progress scans are baseline only.
export function observeActiveScan(frame, state, running) {
 if (!running || !frame || frame.enabled === false || !Number.isFinite(frame.time)) { state.initialized = false; return null; }
 if (state.scope !== frame.systemId) { state.scope = frame.systemId; state.initialized = false; }
 if (frame.time < (state.time ?? -Infinity)) state.initialized = false;
 const fresh = !state.initialized, previousTime = state.time ?? frame.time;
 state.time = frame.time; state.initialized = true;
 if (fresh) state.seen = new Set();
 let event = null;
 for (const scan of (frame.scans ?? []).slice(0,24)) {
  const mode = scan.mode ?? 'ping', position = scan.position ?? [scan.x,scan.y ?? 25,scan.z];
  if (!['ping','sweep'].includes(mode) || !(scan.disclosed === true || scan.disclosed == null && scan.observed === true) || scan.precise !== true || (scan.systemId ?? frame.systemId) !== frame.systemId || !Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite) || !Number.isFinite(scan.startedAt) || !Number.isFinite(scan.duration) || scan.duration <= 0 || frame.time < scan.startedAt || frame.time >= scan.startedAt + scan.duration) continue;
  const id = JSON.stringify([frame.systemId,scan.id ?? scan.unitId ?? position,mode,scan.startedAt]);
  if (state.seen.has(id)) continue;
  state.seen.add(id);
  if (!fresh && scan.startedAt >= previousTime - .02) event ??= {kind:mode,id,confidence:1,uncertainty:0};
 }
 while (state.seen.size > 256) state.seen.delete(state.seen.values().next().value);
 return event;
}

// Receiver-side telemetry, never motion inferred from a hidden ship or from
// an unrelated drive signature. Missing explicit traffic power fails closed.
export function solarAudioState(frame, camera, { running, systemId }) {
 const silent = { ecm: 0, traffic: [] };
 if (!running || frame?.enabled !== true || frame.systemId !== systemId) return silent;
 const local = entry => entry.disclosed === true && entry.systemId === systemId &&
  Array.isArray(entry.position) && entry.position.length === 3 && entry.position.every(Number.isFinite) &&
  Number.isFinite(entry.confidence) && entry.confidence >= .1;
 const distance = entry => Math.hypot(entry.position[0]-camera.x,entry.position[1]-camera.y,entry.position[2]-camera.z);
 const unit = value => Number.isFinite(value) ? Math.max(0,Math.min(1,value)) : 0;
 let ecm = 0;
 for (const entry of (frame.interference ?? []).slice(0,64)) {
  if (!local(entry) || entry.kind !== 'ecm') continue;
  const range = distance(entry); if (range > 4800) continue;
  ecm = Math.max(ecm,unit(entry.strength)*unit(entry.confidence)*1200/(1200+range));
 }
 const identities = new Set(), traffic = [];
 for (const entry of (frame.traffic ?? []).slice(0,64)) {
  if (!local(entry) || entry.precise !== true || !['drone','tanker'].includes(entry.kind) ||
   entry.id == null || entry.motorActive !== true || entry.runningCold === true || entry.done === true ||
   unit(entry.throttle) <= .035 || identities.has(String(entry.id))) continue;
  const range = distance(entry); if (range > 4800) continue;
  identities.add(String(entry.id));
  traffic.push({ id:String(entry.id), kind:entry.kind, position:entry.position, distance:range,
   throttle:unit(entry.throttle), confidence:unit(entry.confidence) });
 }
 traffic.sort((a,b)=>a.distance-b.distance);
 return { ecm, traffic:traffic.slice(0,2) };
}

// A passive receiver report is a change in disclosed saved intel, not an
// outgoing ping or a periodic hint from observedAt/discoveredAt. Never read
// classification, rewards, guardian state or undisclosed recon sites here.
export function observeDiscoveryIntel(frame, state, { running, systemId, allowReport }) {
 if (!running || frame?.enabled !== true || frame.systemId !== systemId || !Number.isFinite(frame.time)) {
  state.initialized = false; state.pending = null; return { event:null, contacts:0 };
 }
 if (state.scope !== systemId || frame.time < (state.time ?? -Infinity)) state.initialized = false;
 const fresh = !state.initialized;
 if (fresh) { state.tracks = new Map(); state.pending = null; }
 state.scope = systemId; state.time = frame.time; state.initialized = true;
 const candidates = [], visible = new Set();
 for (const entry of (frame.discoveries ?? []).slice(0,128)) {
  if (entry.id == null || entry.disclosed !== true || entry.systemId !== systemId ||
   !Array.isArray(entry.position) || entry.position.length !== 3 || !entry.position.every(Number.isFinite) ||
   !Number.isFinite(entry.confidence) || entry.confidence < .12) continue;
  const id = String(entry.id); if (visible.has(id)) continue; visible.add(id);
  const identified = entry.identified === true && entry.confidence >= .8;
  const stage = identified ? 2 : 1, previous = state.tracks.get(id) ?? 0;
  // Keep highest known stage: confidence fading and reacquiring a previously
  // surveyed site cannot repeatedly announce a new discovery.
  state.tracks.set(id,Math.max(stage,previous));
  if (!fresh && stage > previous) candidates.push({ kind:identified?'discovery-identified':'discovery-detected',id,
   confidence:Math.min(1,entry.confidence),uncertainty:Number.isFinite(entry.uncertainty)?Math.max(0,entry.uncertainty):0,
   method:['passive','scan','probe'].includes(entry.method)?entry.method:'passive',expires:frame.time+6 });
 }
 while (state.tracks.size > 512) state.tracks.delete(state.tracks.keys().next().value);
 if (state.pending && (!visible.has(state.pending.id) || frame.time > state.pending.expires)) state.pending = null;
 candidates.sort((a,b)=>(b.kind==='discovery-identified')-(a.kind==='discovery-identified')||b.confidence-a.confidence);
 if (candidates.length && (!state.pending || candidates[0].kind==='discovery-identified')) state.pending=candidates[0];
 const event = allowReport ? state.pending : null;
 if (event) state.pending = null;
 return { event, contacts:visible.size };
}

// These legacy reports may describe remote/all-world outcomes. Canonical
// disclosed receiver transitions own their audio, not text or toast timing.
export function canonicalReceiverReport(text) {
 return /^(?:ACTIVE PING|SIGNAL DETECTED|SURVEY IDENTIFIED|RECOVERY COMPLETE)\b/i.test(text ?? '');
}

// The producer owns the actual retarget/paid recovery and player authorisation.
// Reading an all-world diversion counter or a decoy's existence is forbidden.
export function observeEwEvents(frame, state, { running, systemId, allowReport }) {
 if (!running || frame?.enabled !== true || frame.systemId !== systemId || !Number.isFinite(frame.time)) {
  state.initialized=false; state.pending=null; return null;
 }
 if (state.scope !== systemId || frame.time < (state.time ?? -Infinity)) state.initialized=false;
 const fresh=!state.initialized, previousTime=state.time ?? frame.time;
 if (fresh) { state.seen=new Set(); state.pending=null; }
 state.scope=systemId; state.time=frame.time; state.initialized=true;
 const visible=new Set();
 for (const entry of (frame.ewEvents ?? []).slice(0,24)) {
  if (entry.id == null || !['decoy-diversion','recovery-complete'].includes(entry.kind) || entry.disclosed !== true || entry.observed !== true ||
   entry.systemId !== systemId || !Number.isFinite(entry.at) || entry.at > frame.time || frame.time-entry.at >= 20 ||
   !Array.isArray(entry.position) || entry.position.length !== 3 || !entry.position.every(Number.isFinite)) continue;
  const id=String(entry.id); visible.add(id);
  if (state.seen.has(id)) continue;
  state.seen.add(id);
  // Late disclosure and baseline events confer no new audible outcome.
  if (!fresh && entry.at >= previousTime-.02) state.pending={kind:entry.kind,id,at:entry.at,
   source:['seeker','fleet'].includes(entry.source)?entry.source:null,expires:entry.at+6};
 }
 while (state.seen.size > 256) state.seen.delete(state.seen.values().next().value);
 if (state.pending && (!visible.has(state.pending.id) || frame.time > state.pending.expires)) state.pending=null;
 const event=allowReport ? state.pending : null;
 if (event) state.pending=null;
 return event;
}
