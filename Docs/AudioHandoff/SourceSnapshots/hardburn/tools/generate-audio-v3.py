"""Original CC0 near-field energy/motor Foley, comms keying and quiet score."""
import json,subprocess,wave
from pathlib import Path
import numpy as np
import imageio_ffmpeg
RATE=48000;rng=np.random.default_rng(8316);ff=imageio_ffmpeg.get_ffmpeg_exe()
out=Path('public/audio/naval-v3');out.mkdir(parents=True,exist_ok=True)
scratch=Path('/mnt/g/sfx/audio-renders/hardburn-v3');scratch.mkdir(parents=True,exist_ok=True);records={}
def noise(n,lo,hi):
 f=np.fft.rfftfreq(n,1/RATE);shape=np.exp(-(f/hi)**4)*(1-np.exp(-(f/max(1,lo))**4))
 return np.fft.irfft(np.fft.rfft(rng.standard_normal(n))*shape,n=n)
def write(name,x,description,loop=False,target=.12):
 x=np.asarray(x);x-=np.mean(x);x*=target/max(.001,np.sqrt(np.mean(x*x)));x*=min(1,.73/max(.001,np.max(np.abs(x))))
 stereo=np.column_stack([x,np.roll(x,13)*.98]);stereo[:13,1]=stereo[:13,0];path=scratch/(name+'.wav')
 with wave.open(str(path),'wb')as stream:stream.setnchannels(2);stream.setsampwidth(2);stream.setframerate(RATE);stream.writeframes((stereo*32767).astype('<i2').tobytes())
 subprocess.run([ff,'-y','-hide_banner','-loglevel','error','-i',str(path),'-c:a','libvorbis','-q:a','5',str(out/(name+'.ogg'))],check=True,timeout=60)
 records[name+'.ogg']={'source':'Original deterministic synthesis in tools/generate-audio-v3.py','author':'HARD BURN original audio','licence':'CC0-1.0','description':description,'duration':len(x)/RATE,'loop':loop}
for v in range(4):
 t=np.arange(int(.9*RATE))/RATE;env=(1-np.exp(-t*400))*np.exp(-t*5.5)
 # Electrical ignition/current ripple filtered into the ship's structure.
 phase=2*np.pi*((460+v*17)*t+(120+v*6)*(1-np.exp(-t*12)))
 laser=np.sin(phase+.65*np.sin(2*np.pi*(73+v*4)*t))*env*.36
 laser+=noise(len(t),450,7800)*np.exp(-t*95)*.75+noise(len(t),90,1900)*env*.24
 write(f'energy-laser-{v}',laser,'Laser exciter clamp, falling current arc and damped electrical whine')
 plasma=np.sin(2*np.pi*((78+v*6)*t+2.7*(1-np.exp(-t*15))))*env*.50
 plasma+=noise(len(t),160,4400)*env*.50+np.sin(phase*.48)*env*.14
 write(f'energy-plasma-{v}',plasma,'Heavy capacitive plasma discharge with airy arc and low frame kick')
 t=np.arange(int(.42*RATE))/RATE;env=(1-np.exp(-t*110))*np.exp(-t*12)
 motor=(np.sin(2*np.pi*(142+v*11)*t)+.35*np.sin(2*np.pi*(284+v*22)*t))*env
 motor+=noise(len(t),600,4200)*env*.45
 write(f'pdc-mechanism-{v}',motor,'PDC feed servo spin and barrel-frame vibration under the report',target=.10)
 t=np.arange(int(1.8*RATE))/RATE;env=(1-np.exp(-t*12))*np.exp(-t*2.8)
 launch=noise(len(t),35,900)*env*.7+np.sin(2*np.pi*((46+v*3)*t+5*t*t))*env*.25
 launch+=noise(len(t),300,3800)*np.exp(-t*30)*.3
 write(f'launch-motor-{v}',launch,'Guided motor burn winding upward after cold gas; hull coupled, no space echo')
for v in range(2):
 for name,duration in [('comms-key',.11),('comms-close',.14)]:
  t=np.arange(int(duration*RATE))/RATE;env=(1-np.exp(-t*1800))*np.exp(-t*(55 if name=='comms-key' else 38))
  x=noise(len(t),420,2800)*env*.6+np.sin(2*np.pi*(920+v*60)*t)*env*.15
  write(f'{name}-{v}',x,'Short radio squelch '+name+'; original filtered noise',target=.10)
beat=60/72;n=int(round(64*beat*RATE));x=np.zeros(n)
for section,root in enumerate([146.8324,116.5409,97.99886,110]):
 for index in [0,3.5,8,10.5]:
  age=np.arange(int(2.4*RATE))/RATE;env=(1-np.exp(-age*240))*np.exp(-age*2.7)
  # Tuned machine casing: inharmonic upper partials give it a dry physical
  # character distinct from the existing navigation bell.
  tone=sum(np.sin(2*np.pi*root*ratio*age)*np.exp(-age*(2+i*.7))/(i+1)for i,ratio in enumerate([1,2.013,3.82]))*env*.14
  tone+=noise(len(age),500,2400)*np.exp(-age*80)*.08
  indices=(np.arange(len(age))+int(round((section*16+index)*beat*RATE)))%n;x[indices]+=tone
write('score-machinery',x,'Sparse tuned machinery motif; synchronized 16-bar 72 BPM original score stem',True,target=.11)
(out/'sources.json').write_text(json.dumps({'licence':'CC0-1.0','files':records},indent=2)+'\n');print('Generated',len(records),'original compressed pass-three assets')
