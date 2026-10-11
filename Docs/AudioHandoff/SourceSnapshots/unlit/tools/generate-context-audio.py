"""Original location synthwave and weapon recordings using local Stable Audio 3.
Run with G:/stable-audio-3/venv/Scripts/python.exe. Reuses raw takes on reruns.
"""
import argparse, gc, hashlib, json, time, subprocess
from pathlib import Path
import numpy as np
import soundfile as sf

ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports/context-audio'
RAW=REPORT/'raw'
OUT=ROOT/'public/audio/context'
RATE=44100
MUSIC=[
 ('space','Longwave Horizon','Slow cosmic synthwave exploration, 88 BPM. Warm analog polysynth chords, gently pulsing round bass, shimmering delayed arpeggios and sparse soft electronic drums. Spacious, wistful and quietly adventurous, distant stars and lonely travel. An understated evolving instrumental game underscore, no big drop.'),
 ('haven','Dockside Lights','Warm relaxed synthwave, 82 BPM. Mellow electric piano, lush analog pads, restrained syncopated synth bass, soft drum machine and a memorable gentle synth melody. Safe spaceport after a long journey, hopeful and welcoming. Instrumental background music.'),
 ('forest','Green Signal','Luminous ambient synthwave, 80 BPM. Breathing warm analog pads, delicate plucked synthesizer arpeggios, soft round bass, very light electronic percussion. Wonder and curiosity while exploring an overgrown alien forest, an evolving unhurried melody. Instrumental game exploration underscore.'),
 ('dunes','Glass Caravan','Desert synthwave exploration, 96 BPM. Hypnotic low sequenced analog bass, dry electronic hand percussion, shimmering detuned synth strings and sparse exotic modal synth melody. Heat haze and enormous empty dunes, mysterious and expansive. Restrained instrumental background score.'),
 ('ocean','Tidal Memory','Dreamy aquatic chillwave, 76 BPM. Glassy FM bells, soft chorus analog chords, liquid delay arpeggios and a rounded slow bass pulse, delicate brushed electronic drums. Floating beneath an alien sunset beside a turquoise ocean, serene discovery. Instrumental underscore.'),
 ('underwater','Below the Blue','Submerged ambient synth music. Slow deep filtered analog pads, isolated glassy sonar-like musical notes, soft undulating bass and long diffuse reverb. Mysterious underwater exploration, suspended and beautiful, almost drumless. Quiet instrumental music, no environmental sound effects.'),
 ('ice','Pale Aurora','Glacial ambient synthwave, 72 BPM. Clear crystalline FM plucks, slowly shifting wide analog pads, sparse low sequencer notes and distant restrained electronic percussion. Fragile beauty of auroras above a frozen alien plain. Spacious and contemplative instrumental score.'),
 ('volcanic','Ember Circuit','Brooding industrial synthwave, 100 BPM. Slow gritty analog bass ostinato, muted metallic electronic percussion, warm ominous synth chords and a restrained descending lead. Exploring huge volcanic ridges and abandoned machinery, tense but not combat. Instrumental background score.'),
 ('dark','After the Last Sun','Dark ambient synthwave, 70 BPM. Deep detuned analog drones, lonely fragmentary minor-key synth melody, faint ticking electronic pulse and distant cold shimmering pads. A world whose sun has vanished, haunted and mournful with a fragile sense of hope. Sparse instrumental underscore, no jump scares.'),
 ('vault','Buried Transmission','Ancient science fiction dungeon music, dark ambient electronic score. Very slow minor analog chords, hollow resonant synth plucks, a restrained low pulse and long cavernous reverb. Uncovering an ancient buried signal vault, ominous mystery, patient tension, sparse and almost drumless. Instrumental, no voices or orchestral choir.'),
 ('ground-combat','Redline Contact','Driving cinematic synthwave combat instrumental, 118 BPM. Tight punchy drum machine, aggressive pulsing analog bass, syncopated sequencer arpeggios, dark minor synth chords and a short urgent lead motif. Tactical firefight, momentum and danger. Clear crisp percussion, controlled bass, no vocals, no giant EDM drop.'),
 ('space-combat','Burn Vector','Propulsive space battle synthwave instrumental, 128 BPM. Rapid rolling analog bass sequence, hard gated electronic snare, punchy kick, bright tense arpeggios and soaring urgent synth melody. Pursuit among stars and missile evasion, thrilling and focused. Instrumental action underscore, controlled dynamics, no vocals.'),
]
SHOTS=[
 ('rifle',.42,'One isolated rifle shot, a violent dry supersonic crack over a deep short pressure punch, followed by a small precise steel bolt clack. Close outdoor recording, minimal echo, no automatic burst.'),
 ('smg',.22,'One isolated compact submachine gun shot, a very tight sharp powder crack, short rounded low punch and crisp compact mechanical action. Dry close microphone, no echo, no burst.'),
 ('lmg',.38,'One isolated heavy machine gun round, a forceful chesty cannon-like bang with bright tearing crack and short heavy steel action clatter. Dry close recording, no burst, no long tail.'),
 ('pistol',.34,'One powerful handgun shot, explosive sharp crack, solid low pressure punch, small crisp slide cycling. Close dry recording, outdoors without echo. Single shot.'),
 ('shotgun',.68,'One large shotgun blast, a thunderous chesty boom with a sharp wide crack and short gritty hot gas tail. Forceful close recording, outdoor dry decay, single shot.'),
 ('sniper',.85,'One precision anti-material rifle shot, extremely sharp explosive whip crack above a deep powerful pressure thump, brief distant outdoor decay and a tiny steel action tick. Single shot, no music.'),
 ('pulse',.31,'One futuristic magnetic pulse cannon shot, a hard sharp capacitor snap with a strong short bass pressure thump, fine electrical grit and a mechanical recoil clack. Punchy physical weapon, dry and close, no cartoon laser whistle.'),
 ('rotary',.25,'One isolated ship autocannon shot, a sharp brutal explosive metallic crack with a short heavy low thump, fast recoil mechanism clack and hot gas hiss. Dry close sound, not a burst.'),
 ('plasma',.64,'One heavy plasma weapon discharge, dense explosive pressure punch, sharp electrical crack and a short searing hot hiss, with a weighty mechanical kick. Physical and forceful, dry close recording, no musical laser sweep.'),
 ('rail',.72,'One railgun discharge, sudden violent supersonic whip crack with a deep concussive punch and a tight steel recoil clank. Brief metallic decay, dry physical cinematic weapon, no long charge or cartoon whistle.'),
]
CUES=[
 ('enter-vault',3.6,'A short cinematic discovery stinger: a deep resonant stone door impact blooming into a mysterious dark analog synth chord and three delicate distant metallic notes. Ancient underground vault, ominous but inviting, smooth fading tail, no voices.'),
 ('enter-space',3.2,'A short space travel arrival stinger, a warm low pulse blooming into a wide luminous analog synthesizer chord, delicate sparkling high notes, then a smooth fading tail. Awe and discovery, tasteful and restrained, no voices.'),
 ('enter-planet',2.8,'A short new location discovery stinger, a soft tactile low chime followed by two rising warm glassy synth tones and an airy fading shimmer. Wonder and curiosity, subtle game feedback, no voices.'),
 ('enter-haven',2.6,'A short welcoming safe haven stinger, three mellow rising electric piano notes with a warm analog synth chord and soft fading reverb. Relief and homecoming, gentle and understated, no voices.'),
 ('enter-dark',3.8,'A short ominous location stinger, a restrained deep resonant pulse, cold detuned metallic harmonics and a descending ghostly analog synth chord fading into silence. A dead sun, eerie mystery, no loud jump scare, no voices.'),
]

def encode(name,wav):
    asset=OUT/(name+'.ogg')
    with sf.SoundFile(str(asset),'w',samplerate=RATE,channels=wav.shape[1],format='OGG',subtype='VORBIS') as f:
        for start in range(0,len(wav),8192): f.write(wav[start:start+8192])
    decoded,sr=sf.read(asset,always_2d=True)
    peak=float(np.abs(decoded).max()); rms=float(np.sqrt(np.mean(decoded**2)))
    if peak>.94:return encode(name,wav*(.88/peak))
    assert np.isfinite(decoded).all() and peak<.99 and rms>.005,name
    return dict(duration=len(decoded)/sr,peak=peak,rms=rms,bytes=asset.stat().st_size,sha256=hashlib.sha256(asset.read_bytes()).hexdigest(),boundaryJump=float(np.max(np.abs(decoded[-1]-decoded[0]))))

def edit(wav,seconds,music=False,shot=False):
    wav=np.asarray(wav,dtype=np.float32)
    if wav.ndim==1: wav=wav[:,None]
    assert np.isfinite(wav).all()
    wav=wav-wav.mean(axis=0)
    filtered=subprocess.run(['ffmpeg','-v','error','-f','f32le','-ar',str(RATE),'-ac',str(wav.shape[1]),'-i','pipe:0','-af','highpass=f='+str(35 if music else 55),'-f','f32le','pipe:1'],input=wav.astype('<f4').tobytes(),capture_output=True,check=True)
    wav=np.frombuffer(filtered.stdout,dtype='<f4').reshape(-1,wav.shape[1]).copy()
    if music:
        n=int(seconds*RATE); start=(len(wav)-n)//2; wav=wav[start:start+n].copy()
        k=int(2*RATE); fade=np.linspace(0,1,k)[:,None]
        wav[:k]=wav[-k:]*(1-fade)+wav[:k]*fade; wav=wav[:-k]
    else:
        env=np.max(np.abs(wav),axis=1); peak=env.max()
        # Find the first real event, retaining the full initial crack.
        active=np.flatnonzero(env>peak*(.5 if shot else .12)); onset=max(0,int(active[0])-int(.004*RATE))
        wav=wav[onset:onset+int(seconds*RATE)].copy()
        if len(wav)<int(seconds*RATE):wav=np.pad(wav,((0,int(seconds*RATE)-len(wav)),(0,0)))
        if shot:
            # Keep one pressure event. Some raw weapon takes contain sustained
            # gas/bursts; long dense tails blur together under automatic fire.
            life=min(.25,max(.07,seconds*.34))
            wav*=np.exp(-np.arange(len(wav))[:,None]/(RATE*life))
            wav=np.tanh(wav/max(float(np.abs(wav).max()),1e-6)*1.6)/np.tanh(1.6)
        a=int(.0005*RATE);b=min(len(wav),int(.05*RATE))
        wav[:a]*=np.linspace(0,1,a)[:,None];wav[-b:]*=np.linspace(1,0,b)[:,None]
    peak=float(np.abs(wav).max());rms=float(np.sqrt(np.mean(wav**2)))
    return (wav*min((.14 if music else .19)/max(rms,1e-6),.82/max(peak,1e-6))).astype(np.float32)

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--only',default='');args=ap.parse_args()
    for p in (RAW,OUT):p.mkdir(parents=True,exist_ok=True)
    import torch
    from stable_audio_3 import StableAudioModel
    ledger=[];model=None;loaded=''
    jobs=[(id,80,True,prompt,'small-music',913100+i,title) for i,(id,title,prompt) in enumerate(MUSIC)]
    jobs += [(id+'-'+str(v),seconds,False,prompt,'small-sfx',913500+i*13+v,id) for i,(id,seconds,prompt) in enumerate(SHOTS) for v in range(2)]
    jobs += [(id,seconds,False,prompt,'small-sfx',913900+i,id) for i,(id,seconds,prompt) in enumerate(CUES)]
    try:
        for name,seconds,music,prompt,model_id,seed,title in jobs:
            if args.only and name not in args.only.split(','):continue
            raw=RAW/(name+'.wav');duration=88 if music else max(4,seconds+2)
            if not raw.exists():
                if loaded!=model_id:
                    del model;gc.collect();torch.cuda.empty_cache()
                    print('Loading',model_id,flush=True);model=StableAudioModel.from_pretrained(model_id,device='cuda');loaded=model_id
                start=time.monotonic()
                full=('TrackType: Music, VocalType: Instrumental. ' if music else 'TrackType: SFX. ')+prompt
                a=model.generate(prompt=full,duration=duration,steps=8,seed=seed,batch_size=1)
                a=a[0] if a.dim()==3 else a
                sf.write(raw,a.detach().cpu().float().numpy().T,RATE,subtype='FLOAT')
                del a
                print('Generated',name,round(time.monotonic()-start,1),'s',flush=True)
            wav,sr=sf.read(raw,always_2d=True);assert sr==RATE
            row=dict(name=name,title=title,model=model_id,seed=seed,steps=8,prompt=prompt,loop=music,**encode(name,edit(wav,seconds,music,not music and not name.startswith('enter-'))))
            ledger.append(row);(REPORT/'assets.json').write_text(json.dumps(ledger,indent=2),encoding='utf8')
            print('Prepared',name,round(row['duration'],2),'s',flush=True)
    finally:
        del model;gc.collect();torch.cuda.empty_cache()
    print('Completed',len(ledger),'assets; GPU model released',flush=True)
if __name__=='__main__':main()
