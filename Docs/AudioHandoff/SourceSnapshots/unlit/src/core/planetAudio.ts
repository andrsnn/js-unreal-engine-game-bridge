export const AMBIENT_KINDS=['forest','dunes','ice','volcanic','ocean','underwater','dungeon','dark'] as const;
export type AmbientKind=typeof AMBIENT_KINDS[number];
export interface AudioEnvironment {underwater?:boolean;dark?:boolean;safe?:boolean;combat?:boolean;location?:string}
export type FootSurface='soil'|'sand'|'stone'|'snow'|'water';

export function planetAmbience(scene:string,body:string,environment:AudioEnvironment={}):AmbientKind|null {
 if(scene!=='planet'&&scene!=='dungeon')return null;
 if(environment.underwater)return 'underwater';
 if(scene==='dungeon')return 'dungeon';
 if(environment.dark)return 'dark';
 return ({sirocco:'dunes',pelagia:'ocean',pale:'ice',cindral:'volcanic',bellweather:'forest'} as Record<string,AmbientKind>)[body]??'forest';
}

type Layer={source:AudioBufferSourceNode;gain:GainNode};
/** Only the current environment and its fading predecessor consume loop voices. */
export class PlanetAmbience {
 private buffers=new Map<AmbientKind,AudioBuffer>();private current:Layer|null=null;
 private fading:Layer|null=null;private selected:AmbientKind|null=null;
 constructor(private ctx:AudioContext,private bus:GainNode){}
 async load(decode:(name:string)=>Promise<AudioBuffer|null>){
  await Promise.all(AMBIENT_KINDS.map(async kind=>{const b=await decode('ambient-'+kind);if(b)this.buffers.set(kind,b)}));
 }
 has(kind:AmbientKind|null){return !!kind&&this.buffers.has(kind);}
 select(kind:AmbientKind|null){
  const next=this.has(kind)?kind:null;if(this.selected===next)return;
  const t=this.ctx.currentTime;this.selected=next;
  if(this.fading){this.fading.source.stop();this.fading.source.disconnect();this.fading.gain.disconnect();this.fading=null;}
  if(this.current){
   const old=this.current;old.gain.gain.setTargetAtTime(0,t,.28);old.source.stop(t+1.8);this.fading=old;
   old.source.onended=()=>{old.source.disconnect();old.gain.disconnect();if(this.fading===old)this.fading=null;};this.current=null;
  }
  if(!next)return;
  const source=this.ctx.createBufferSource(),gain=this.ctx.createGain();source.buffer=this.buffers.get(next)!;source.loop=true;
  gain.gain.value=0;source.connect(gain);gain.connect(this.bus);source.start();
  gain.gain.setTargetAtTime(next==='dark'?.24:next==='dungeon'?.27:next==='underwater'?.38:.33,t,.45);
  this.current={source,gain};
 }
 preview(){
  const buffer=this.buffers.get(this.selected??'forest');if(!buffer)return;
  const source=this.ctx.createBufferSource(),gain=this.ctx.createGain(),t=this.ctx.currentTime;
  source.buffer=buffer;source.loop=true;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.33,t+.2);gain.gain.setValueAtTime(.33,t+2.4);gain.gain.linearRampToValueAtTime(0,t+2.9);
  source.connect(gain);gain.connect(this.bus);source.start(t,Math.random()*Math.max(0,buffer.duration-3));source.stop(t+3);source.onended=()=>{source.disconnect();gain.disconnect();};
 }
 snapshot(){return {selected:this.selected,recordings:this.buffers.size,voices:Number(!!this.current)+Number(!!this.fading)};}
}
