"""Original HARD BURN sound design. Deterministic PCM, no borrowed samples."""
import math,wave,json
from pathlib import Path
import numpy as np
RATE=24000
OUT=Path('public/audio/generated');OUT.mkdir(parents=True,exist_ok=True)
rng=np.random.default_rng(2545)
records={}
def write(name,x,kind):
 x=np.asarray(x,dtype=np.float64);x-=x.mean();peak=max(.001,float(np.max(np.abs(x))));x=np.tanh(x/peak*1.05)*.77
 stereo=np.column_stack([x,np.roll(x,11)*.97]);stereo[:11,1]=x[:11]
 with wave.open(str(OUT/(name+'.wav')),'wb') as w:w.setnchannels(2);w.setsampwidth(2);w.setframerate(RATE);w.writeframes((stereo*32767).astype('<i2').tobytes())
 records[name+'.wav']={'source':'Original deterministic synthesis in tools/generate-shipboard-audio-25.py','licence':'CC0-1.0','description':kind,'duration':len(x)/RATE}
def noise(n,low,high):
 bins=np.fft.rfftfreq(n,1/RATE);spectrum=np.fft.rfft(rng.standard_normal(n));shape=np.exp(-(bins/high)**4)*(1-np.exp(-(bins/max(1,low))**4));return np.fft.irfft(spectrum*shape,n=n)
for v in range(3):
 for name,duration,freq,cut,kind in [('rail',.35,96,3200,'Coil discharge: fast crack, hull-transmitted resonance'),('mac',.65,46,2100,'Heavy mass-driver concussion and sliding breech'),('flak',.46,75,1700,'Broadside flak mechanical thump'),('impact',.7,84,3400,'Armour puncture with resonant metal tail'),('small-blast',.75,64,1800,'Small ordnance: short muffled pressure impulse'),('large-blast',2.5,31,900,'Reactor/hull breakup: deep layered structural collapse')]:
  t=np.arange(int(RATE*duration))/RATE;f=freq*(.94+v*.055);attack=1-np.exp(-t*1800);env=attack*np.exp(-t/(duration*.18));crack=noise(len(t),180,cut)*np.exp(-t/.028);body=np.sin(2*np.pi*f*t+1.6*np.exp(-t*30))*env;plate=sum(np.sin(2*np.pi*f*r*t+v*.3)*np.exp(-t/(duration*.22)) for r in [2.31,3.74,5.12])*.08;tail=noise(len(t),20,cut*.32)*np.exp(-t/(duration*.32));write(f'{name}-{v}',body*.5+crack*.32+plate+tail*.25,kind)
 t=np.arange(int(RATE*.32))/RATE;burst=np.zeros(len(t));rattle=noise(len(t),130,3700)
 for k in range(5):
  age=t-k*(.045+v*.002);env=np.where(age>=0,(1-np.exp(-np.maximum(age,0)*4000))*np.exp(-np.maximum(age,0)/.011),0);burst+=rattle*env+np.sin(2*np.pi*(135+v*8)*t)*env*.24
 write(f'pdc-{v}',burst,'Five-round mechanical PDC rattle; short softened crack')
 t=np.arange(int(RATE*.7))/RATE;env=(1-np.exp(-t*60))*np.exp(-t*6);write(f'launch-{v}',noise(len(t),160,2100)*env+np.sin(2*np.pi*(55+v*5)*t)*np.exp(-t*15)*.15,'Cold-launch piston, gas hiss and brief motor rumble')
for name,freq in [('drive-small',98),('drive-medium',66),('drive-heavy',41)]:
 t=np.arange(RATE*12)/RATE;harmonics=sum(np.sin(2*np.pi*(freq+k*freq)*t+k*.7)/(k+1)**1.9 for k in range(5));rumble=noise(len(t),20,350);x=harmonics*.10+rumble*.25;fade=np.minimum(1,np.minimum(t/.3,(12-t)/.3));write(name,x*fade,'Class-specific low fusion-drive vibration loop')
t=np.arange(RATE*48)/RATE;x=np.zeros(len(t));
for freq in [55,82.5,110,130.8128,164.8138]:x+=np.sin(2*np.pi*freq*t+.3*np.sin(t*.12))*np.sin(np.pi*t/48)**2*.04
x+=noise(len(t),35,620)*np.sin(np.pi*t/48)**2*.1;write('tension-bed',x,'Original restrained minor/suspended ambient bed, raised during combat')
(OUT/'sources.json').write_text(json.dumps({'licence':'CC0-1.0','author':'HARD BURN original sound design','files':records},indent=2)+'\n')
print('Generated',len(records),'layered sound files')
