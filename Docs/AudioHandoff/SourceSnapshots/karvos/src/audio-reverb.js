const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export const REVERB_SPACES=Object.freeze({
 open:{seconds:.48,decay:.13,cutoff:3600,early:[[.071,.28],[.139,.12]],wet:.12},
 canyon:{seconds:1.85,decay:.51,cutoff:5100,early:[[.065,.42],[.143,.31],[.257,.22],[.419,.14]],wet:.32},
 room:{seconds:.92,decay:.27,cutoff:7200,early:[[.012,.46],[.027,.38],[.045,.29],[.073,.21]],wet:.24}
});

/** Original stereo impulse responses. Early reflections precede a band-limited
 * diffuse decay; no network assets or AudioWorklet dependency. */
export function acousticImpulse(context,space){
 const profile=REVERB_SPACES[space]||REVERB_SPACES.open,rate=context.sampleRate||48000;
 const buffer=context.createBuffer(2,Math.ceil(rate*profile.seconds),rate);
 let seed=space==='room'?31817:space==='canyon'?99183:70231;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1;};
 for(let channel=0;channel<2;channel++){
  const data=buffer.getChannelData(channel);let smooth=0;
  const alpha=1-Math.exp(-2*Math.PI*profile.cutoff/rate);
  for(let i=0;i<data.length;i++){
   const t=i/rate;smooth+=alpha*(random()-smooth);
   const density=Math.min(1,Math.max(0,(t-.017)/.045));
   data[i]=smooth*Math.exp(-t/profile.decay)*density*.025;
  }
  for(const [delay,gain]of profile.early){
   const at=Math.round((delay+channel*.0027)*rate);
   for(let i=0;i<Math.min(38,data.length-at);i++)data[at+i]+=gain*Math.exp(-i/7)*Math.cos(i*.52+channel*.12);
  }
 }
 return buffer;
}

export function reverbSendLevel(bus,distance=0){
 const base={weapons:.24,explosions:.31,impacts:.18,creatures:.19,foley:.055,engines:.065}[bus]||0;
 return base*(1+clamp(distance/90,0,.8));
}

export function createAcousticSpace(context,master){
 const input=context.createGain(),paths=new Map();
 for(const space of Object.keys(REVERB_SPACES)){
  const convolver=context.createConvolver(),filter=context.createBiquadFilter(),gain=context.createGain();
  convolver.normalize=false;convolver.buffer=acousticImpulse(context,space);
  filter.type='highpass';filter.frequency.value=95;gain.gain.value=space==='open'?REVERB_SPACES.open.wet:0;
  input.connect(convolver).connect(filter).connect(gain).connect(master);
  paths.set(space,{convolver,filter,gain});
 }
 let current='open',weights={open:1,canyon:0,room:0};
 return {input,update(space='open',enabled=true,blend){
  current=paths.has(space)?space:'open';const requested=blend||{[current]:1},sum=Object.keys(REVERB_SPACES).reduce((n,key)=>n+clamp(Number(requested[key])||0,0,1),0)||1;
  weights=Object.fromEntries(Object.keys(REVERB_SPACES).map(key=>[key,clamp(Number(requested[key])||0,0,1)/sum]));
  for(const [name,path]of paths)path.gain.gain.setTargetAtTime(enabled?REVERB_SPACES[name].wet*Math.sqrt(weights[name]):0,context.currentTime,.22);
 },get space(){return current;},get weights(){return {...weights};},dispose(){input.disconnect();for(const {convolver,filter,gain}of paths.values()){convolver.disconnect();filter.disconnect();gain.disconnect();convolver.buffer=null;}paths.clear();}};
}
