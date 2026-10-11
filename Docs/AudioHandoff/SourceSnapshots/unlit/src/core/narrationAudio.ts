/** Briefing media shares the game's master, limiter and mute path. Disposable per-clip nodes. */
export class NarrationAudio {
 private active=new Set<()=>void>();private attached=0;
 constructor(private ctx:AudioContext,private master:GainNode){}
 attach(audio:HTMLAudioElement){
  // Avoid an old detached briefing continuing behind a fresh chapter.
  for(const release of [...this.active])release();
  const source=this.ctx.createMediaElementSource(audio),gain=this.ctx.createGain();
  audio.volume=1;gain.gain.value=.85;source.connect(gain);gain.connect(this.master);this.attached++;
  let released=false;
  const release=()=>{if(released)return;released=true;source.disconnect();gain.disconnect();this.active.delete(release);};
  this.active.add(release);return release;
 }
 snapshot(){return {voices:this.active.size,attached:this.attached,masterRouted:true};}
}
