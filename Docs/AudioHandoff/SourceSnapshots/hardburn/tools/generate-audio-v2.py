"""Original CC0 naval threat/formant alerts, distance tails and UI Foley."""
import json, math, subprocess, wave
from pathlib import Path
import numpy as np
import imageio_ffmpeg
RATE=48000; rng=np.random.default_rng(712); ff=imageio_ffmpeg.get_ffmpeg_exe()
out=Path('public/audio/naval-v2'); out.mkdir(parents=True,exist_ok=True)
scratch=Path('/mnt/g/sfx/audio-renders/hardburn-v2'); scratch.mkdir(parents=True,exist_ok=True)
records={}
def noise(n,lo,hi):
 f=np.fft.rfftfreq(n,1/RATE); shape=np.exp(-(f/hi)**4)*(1-np.exp(-(f/max(1,lo))**4))
 return np.fft.irfft(np.fft.rfft(rng.standard_normal(n))*shape,n=n)
def write(name,x,description,loop=False):
 x=np.asarray(x); x=x-np.mean(x)
 target=.12 if '-tail-' in name else .13 if name.startswith('hostile') else .10 if name.startswith('critical') else .09 if name.startswith('ui-') else .10
 x*=target/max(.001,np.sqrt(np.mean(x*x))); x*=min(1,.76/max(.001,np.max(np.abs(x))))
 stereo=np.column_stack([x,np.roll(x,17)*.98]); stereo[:17,1]=stereo[:17,0]
 path=scratch/(name+'.wav')
 with wave.open(str(path),'wb') as stream:
  stream.setnchannels(2);stream.setsampwidth(2);stream.setframerate(RATE);stream.writeframes((stereo*32767).astype('<i2').tobytes())
 subprocess.run([ff,'-y','-hide_banner','-loglevel','error','-i',str(path),'-c:a','libvorbis','-q:a','5',str(out/(name+'.ogg'))],check=True,timeout=60)
 records[name+'.ogg']={'source':'Original deterministic synthesis in tools/generate-audio-v2.py','author':'HARD BURN original audio','licence':'CC0-1.0','description':description,'duration':len(x)/RATE,'loop':loop}
for v in range(4):
 for name,root in [('rail-tail',52),('impact-tail',68)]:
  t=np.arange(int(1.7*RATE))/RATE; root*=.93+v*.04
  env=(1-np.exp(-t*75))*np.exp(-t*3.8)
  modes=sum(np.sin(2*np.pi*root*ratio*t+v*.3)*np.exp(-t*(3+i)) for i,ratio in enumerate([1,1.81,2.74,4.11]))*.11
  x=noise(len(t),25,650)*env*.8+modes*env
  write(f'{name}-{v}',x,'Low transmitted frame resonance: camera-distance report tail, no atmospheric echo')
 t=np.arange(int(1.35*RATE))/RATE;x=np.zeros(len(t))
 # A voiced synthesis warning character rather than sampled speech: glottal
 # harmonics move through three vowel-like formants under a radio-band filter.
 for index,start in enumerate([0,.38,.76]):
  age=np.maximum(0,t-start); base=110+v*6+index*13
  env=(t>=start)*(1-np.exp(-age*150))*np.exp(-age*9)
  phase=2*np.pi*(base*age+6*np.sin(age*5))
  for harmonic in range(1,30):
   hz=harmonic*base; formant=sum(np.exp(-((hz-centre)/width)**2) for centre,width in [(550+v*40,180),(1250-index*90,300),(2100,350)])
   x+=np.sin(phase*harmonic)*formant/harmonic*env*.45
  x+=noise(len(t),400,2200)*env*.07
 write(f'hostile-{v}',x,'Original vowel-like tactical identification burst; no words, voice model or recordings')
for v in range(3):
 for name,notes in [('ui-select',[660,880]),('ui-cancel',[510,350]),('ui-nav',[440,660,990]),('critical',[420,560,420])]:
  length=.28 if name.startswith('ui') else 1.2;t=np.arange(int(length*RATE))/RATE;x=np.zeros(len(t))
  gap=.055 if name.startswith('ui') else .28
  for index,freq in enumerate(notes):
   age=np.maximum(0,t-index*gap); env=(t>=index*gap)*(1-np.exp(-age*1200))*np.exp(-age*(44 if name.startswith('ui') else 11))
   x+=(np.sin(2*np.pi*freq*(.97+v*.03)*age)+.15*np.sin(2*np.pi*freq*2*age))*env*.24
  write(f'{name}-{v}',x,'Shipboard '+name+' coded tones, original synthesis')
beat=60/72;n=int(round(64*beat*RATE));t=np.arange(n)/RATE;x=np.zeros(n)
for section,root in enumerate([73.4162,58.2705,48.9994,55]):
 for index in range(8):
  age=np.arange(int(2.4*RATE))/RATE; env=(1-np.exp(-age*8))*np.exp(-age*1.6)
  tone=(np.sin(2*np.pi*root*2*age+.3*np.sin(age*8))+np.sin(2*np.pi*root*2*1.05946*age)*.42)*env*.1
  indices=(np.arange(len(age))+int(round((section*16+index*2)*beat*RATE)))%n;x[indices]+=tone
x*=.1/max(.001,np.sqrt(np.mean(x*x)))
write('score-danger',x,'Synchronized 16-bar 72 BPM dissonant low-string danger stem, follows actual local hull condition',True)
(out/'sources.json').write_text(json.dumps({'licence':'CC0-1.0','files':records},indent=2)+'\n')
print('Generated',len(records),'original compressed pass-two assets')
