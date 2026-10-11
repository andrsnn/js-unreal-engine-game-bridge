"""Physical sub-heavy hull Foley and dark 72 BPM score.

No film/game recordings, voice model or external samples. Only Ogg ships.
"""
import hashlib, json, subprocess, wave
from pathlib import Path
import numpy as np
import imageio_ffmpeg

RATE = 48000
rng = np.random.default_rng(440071)
ff = imageio_ffmpeg.get_ffmpeg_exe()
out = Path('public/audio/naval-v4'); out.mkdir(parents=True, exist_ok=True)
scratch = Path('/mnt/g/sfx/audio-renders/hardburn-v4'); scratch.mkdir(parents=True, exist_ok=True)
records = {}
raw = Path('/mnt/g/sfx/raw-packs/oga-metal-impact')
recordings = {}
provenance = {}
for name in ['bong1.wav','thud2.wav','thud3.wav','clink2.wav','clink3.wav']:
    path = raw/name
    pcm = subprocess.run([ff,'-hide_banner','-loglevel','error','-i',str(path),'-ar',str(RATE),'-ac','1','-f','f32le','pipe:1'],capture_output=True,check=True,timeout=30)
    recordings[name] = np.frombuffer(pcm.stdout,dtype='<f4').astype(float)
    provenance[name] = {'author':'Brian MacIntosh (BMacZero)','licence':'CC0-1.0','url':'https://opengameart.org/content/metal-impact-sounds','sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
for key,folder,filename in [
    ('groan','freesound-metallic-groan','Metallic-Groan-hinchinbrook-496836-hq.mp3'),
    ('hammer','sonniss-2020-ironwork','Spring_Powered_Hammer_Impacts_Various_Speeds_MKH8060.wav'),
    ('tank','sonniss-2020-junkyard','Metal_Rocking_Diesel_Tank_Pulses_A_DPA4061.wav'),
    ('creak','sonniss-2020-junkyard','Metal_Creak_Van_Door_Back_and_Forth_Various_CO100k.wav'),
    ('explosion','sonniss-2020-explosions','DeepExplosion02.wav'),
]:
    folder=Path('/mnt/g/sfx/raw-packs')/folder; path=folder/filename
    pcm=subprocess.run([ff,'-hide_banner','-loglevel','error','-i',str(path),'-ar',str(RATE),'-ac','1','-f','f32le','pipe:1'],capture_output=True,check=True,timeout=30)
    samples=np.frombuffer(pcm.stdout,dtype='<f4').astype(float)
    # Keep a real active section, not leading silence from a field recording.
    block=RATE//10; padded=samples[:len(samples)//block*block].reshape(-1,block)
    anchor=max(0,int(np.argmax(np.mean(padded*padded,axis=1)))*block-block//2)
    recordings[key]=samples[anchor:anchor+RATE*12]
    if key=='groan':
        provenance[key]={'file':filename,'author':'hinchinbrook','licence':'CC0-1.0','url':'https://freesound.org/people/hinchinbrook/sounds/496836/','sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    else:
        manifest=json.loads((folder/'PROVENANCE.json').read_text())
        provenance[key]={'file':filename,'author':manifest['creator'],'licence':'Sonniss GDC Bundle EULA v2.0 (royalty-free commercial game use; not CC0)','url':manifest['primarySource'],'licenceURL':manifest['license'],'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}

def recorded(name, n, speed=.65, cutoff=1600, at=0):
    original=recordings[name]; m=int(len(original)/speed)
    slowed=np.interp(np.arange(m)*speed,np.arange(len(original)),original)
    f=np.fft.rfftfreq(m,1/RATE)
    slowed=np.fft.irfft(np.fft.rfft(slowed)*np.exp(-(f/cutoff)**4),n=m)
    slowed*=.65/max(.001,np.max(np.abs(slowed)))
    x=np.zeros(n); start=int(at*RATE); length=min(m,n-start)
    if length>0: x[start:start+length]=slowed[:length]
    return x

def noise(n, lo, hi):
    f = np.fft.rfftfreq(n, 1 / RATE)
    shape = np.exp(-(f / hi) ** 4) * (1 - np.exp(-(f / max(1, lo)) ** 4))
    return np.fft.irfft(np.fft.rfft(rng.standard_normal(n)) * shape, n=n)

def sine_drop(t, hi=60, lo=32, speed=10):
    return np.sin(2*np.pi*(lo*t+(hi-lo)*(1-np.exp(-speed*t))/speed))

def write(name, x, description, loop=False, rms=.23, components=()):
    x = np.asarray(x); x -= np.mean(x)
    x *= rms / max(.001, np.sqrt(np.mean(x*x)))
    # Local analogue-style saturation thickens transients before a common
    # peak ceiling; long resonance and the initial kick retain different levels.
    x = np.tanh(x*1.25)/1.25
    x *= min(1, .88/max(.001, np.max(np.abs(x))))
    if not loop:
        fade = min(len(x)//2, 240); x[-fade:] *= np.linspace(1,0,fade)
    stereo = np.column_stack([x, x*.99 + np.roll(x,17)*.01])
    path = scratch/(name+'.wav')
    with wave.open(str(path),'wb') as stream:
        stream.setnchannels(2); stream.setsampwidth(2); stream.setframerate(RATE)
        stream.writeframes((stereo*32767).astype('<i2').tobytes())
    subprocess.run([ff,'-y','-hide_banner','-loglevel','error','-i',str(path),'-c:a','libvorbis','-q:a','6',str(out/(name+'.ogg'))],check=True,timeout=60)
    f=np.fft.rfftfreq(len(x),1/RATE); energy=np.abs(np.fft.rfft(x))**2
    licensed=any(k in ['hammer','tank','creak','explosion'] for k in components)
    records[name+'.ogg']={'source':'Original procedural synthesis plus processed field recordings, tools/generate-audio-v4.py','author':'HARD BURN original audio; see recordingSources for original recording authors','licence':'CC0-1.0 original/CC0 layers; Sonniss GDC Bundle EULA v2.0 recorded layers' if licensed else 'CC0-1.0','recordingComponents':list(components),'description':description,'duration':len(x)/RATE,'loop':loop,'rms':round(float(np.sqrt(np.mean(x*x))),5),'peak':round(float(np.max(np.abs(x))),5),'energyBelow250Hz':round(float(energy[f<250].sum()/energy.sum()),5)}

def metal(t, root, decay):
    return sum(np.sin(2*np.pi*root*r*t+.19*i)*np.exp(-t*(decay+i*.4))/(i+1) for i,r in enumerate([1,1.473,2.191,3.137,4.31]))

for v in range(4):
    shift=.94+v*.04
    for name, seconds, root in [('rail',2.8,47),('mac',3.3,36),('impact',2.4,43),('flak',1.1,52),('laser',1.5,49),('plasma',2.1,39)]:
        t=np.arange(int(seconds*RATE))/RATE
        kick=sine_drop(t,62*shift,31*shift,13)*(1-np.exp(-t*2100))*np.exp(-t*4.2)
        crack=np.tanh(noise(len(t),150,2700)*4)*np.exp(-t*95)*.75
        ring=metal(t,root*shift,1.6)*.15*(1-np.exp(-t*180))
        body=noise(len(t),24,360)*np.exp(-t*3.4)*.80
        if name in ['laser','plasma']:
            # Capacitor discharge and frame stress, not an oscillator chirp.
            crack*=.65; body+=noise(len(t),80,1100)*np.exp(-t*9)*.45
        physical=recorded('bong1.wav',len(t),.48+v*.025,2100)*.58+recorded('thud2.wav' if v%2 else 'thud3.wav',len(t),.55,1400)*.45
        physical+=recorded('hammer',len(t),.55+v*.025,2800)*.70+recorded('creak',len(t),.65,1300,.12)*.35
        write(f'{name}-{v}',kick*.95+crack+ring+body+physical,'Sub-bass sine fall, saturated physical crack and real recorded hammer/metal/hull stress: '+name,components=['bong1.wav','thud2.wav' if v%2 else 'thud3.wav','hammer','creak'])
    t=np.arange(int(.58*RATE))/RATE; x=np.zeros(len(t))
    for shot in range(9):
        age=t-shot*(.040+v*.0012); a=np.maximum(age,0); gate=(age>=0)
        env=gate*(1-np.exp(-a*4500))*np.exp(-a*85)
        x+=env*(np.tanh(noise(len(t),190,3000)*3)*.75+sine_drop(a,120*shift,54*shift,50)*.9)
        # Ejection/casing contacts sit below the brutal barrel impulses.
        casing=(age>=.015)*np.exp(-np.maximum(age-.015,0)*145)
        x+=casing*noise(len(t),380,2200)*.16
        x+=recorded('clink2.wav' if shot%2 else 'clink3.wav',len(t),.65,2300,shot*(.040+v*.0012)+.012)*.20
        x+=recorded('hammer',len(t),.95,2700,shot*(.040+v*.0012))*.28
    x+=np.sin(2*np.pi*132*shift*t)*(1-np.exp(-t*50))*np.exp(-t*7)*.13
    write(f'pdc-{v}',x,'Nine-round brutal mechanical barrel chatter, real powered hammer/ejection contacts, bass recoil and feed servo',rms=.29,components=['hammer','clink2.wav','clink3.wav'])
    t=np.arange(int(3.2*RATE))/RATE
    launch=sine_drop(t,70*shift,34*shift,20)*np.exp(-t*7)*1.1
    launch+=noise(len(t),80,1900)*np.exp(-t*60)*.9+metal(t,64*shift,4)*.12
    env=(1-np.exp(-t*8))*np.exp(-t*.85)
    launch+=noise(len(t),23,220)*env*.8+np.sin(2*np.pi*(33*t+3*t*t))*env*.26
    launch+=recorded('thud2.wav',len(t),.58,1600)*.70+recorded('bong1.wav',len(t),.65,1100,.07)*.25
    launch+=recorded('tank',len(t),.68,1000)*.45
    write(f'launch-{v}',launch,'Recorded heavy tube latch/tank and ejection clunk followed by rising low guided motor rumble',components=['thud2.wav','bong1.wav','tank'])
    for name,seconds in [('small-blast',2.0),('large-blast',5.2)]:
        t=np.arange(int(seconds*RATE))/RATE
        x=sine_drop(t,51*shift,29*shift,8)*np.exp(-t*(2.4 if seconds<3 else 1.5))
        x+=noise(len(t),22,420)*np.exp(-t*1.9)*1.1+metal(t,37*shift,.9)*.14
        for at in [.045,.13,.29,.48,.91,1.4]:
            age=np.maximum(t-at,0)
            x+=(t>=at)*np.exp(-age*23)*(noise(len(t),75,1400)*.35+np.sin(2*np.pi*83*age)*.19)
        x+=noise(len(t),320,1900)*(1-np.exp(-t*6))*np.exp(-t*1.1)*.14
        x+=recorded('thud3.wav',len(t),.35,900)*.65+recorded('bong1.wav',len(t),.40,1300,.19)*.42
        x+=recorded('explosion',len(t),.72+v*.025,1100)*1.10+recorded('groan',len(t),.55,1250,.22)*.42
        write(f'{name}-{v}',x,'Muffled real deep explosion, sub concussion, debris contacts, recorded bunker groan and pressure vent',rms=.25,components=['thud3.wav','bong1.wav','explosion','groan'])
    for name,root in [('rail-tail',57),('impact-tail',41)]:
        t=np.arange(int(3.1*RATE))/RATE
        x=metal(t,root*shift,1.05)*(1-np.exp(-t*120))*.5+noise(len(t),25,420)*np.exp(-t*1.8)*.18
        x+=recorded('bong1.wav',len(t),.45+v*.03,900)*.42
        x+=recorded('creak',len(t),.55,1000)*.48
        write(f'{name}-{v}',x,'Long low transmitted hull resonance and real stressed metal without atmospheric echo',rms=.17,components=['bong1.wav','creak'])

# Seamless low drive beds. Integer frequencies and periodic noise repeat
# exactly; thrust is expressed by runtime gain/filter/rate, no timers.
t=np.arange(12*RATE)/RATE
for name,root in [('drive-small',48),('drive-medium',36),('drive-heavy',30),('torpedo-burn',42)]:
    x=noise(len(t),23,280)*.8+np.sin(2*np.pi*root*t)*.27+np.sin(2*np.pi*root*2*t)*.12
    x*=.87+.13*np.sin(2*np.pi*t/12)
    tank=recorded('tank',len(t),.55,480)*.35
    # Crossfade the field-recorded texture to keep the transport seamless.
    tank*=np.sin(np.pi*np.arange(len(t))/len(t))**2; x+=tank
    write(name,x,'Continuous low structural drive rumble and recorded diesel-tank strain; thrust and closing-distance modulated',True,rms=.26,components=['tank'])
write('shipboard',noise(len(t),27,450)*.22+np.sin(2*np.pi*48*t)*.03,'Quiet low machinery and ventilation floor',True,rms=.09)

# All six replacement stems share the existing 72 BPM, 16-bar clock.
beat=60/72; n=int(round(64*beat*RATE)); t=np.arange(n)/RATE
stems={k:np.zeros(n) for k in ['bed','motif','pulse','combat','danger','machinery']}
for section,root in enumerate([36.7081,29.1352,24.4997,27.5]):
    mask=(t>=section*16*beat)&(t<(section+1)*16*beat); age=t-section*16*beat
    bed=(np.sin(2*np.pi*root*t)+.31*np.sin(2*np.pi*root*1.5*t))*.13
    stems['bed']+=bed*mask*np.sin(np.pi*np.clip(age/(16*beat),0,1))**.5
    for step in range(16):
        offset=int(round((section*16+step)*beat*RATE)); a=np.arange(int(2.8*RATE))/RATE
        kick=sine_drop(a,58,32,18)*np.exp(-a*8)+noise(len(a),30,400)*np.exp(-a*12)*.25
        tone=metal(a,root*2,1.8)*(1-np.exp(-a*220))*.18
        drum=kick*.45+noise(len(a),180,1700)*np.exp(-a*50)*.19+recorded('thud2.wav',len(a),.60,1300)*.21+recorded('hammer',len(a),.6,1500)*.12
        for key,signal in [('pulse',kick*.27),('combat',drum if step%2==0 else drum*.55),('danger',noise(len(a),35,290)*np.exp(-a*3)*.29),('motif',tone if step in [0,7,10] else tone*0),('machinery',tone*.6 if step%4==0 else tone*0)]:
            indices=(np.arange(len(a))+offset)%n; stems[key][indices]+=signal
for name,x in stems.items():
    write('score-'+name,x,'Original dark tension and hull percussion, synchronized 16-bar 72 BPM '+name,True,rms=.11 if name=='bed' else .14,components=['thud2.wav','hammer'] if name=='combat' else [])
for v in range(3):
    for name in ['ui-select','ui-cancel','ui-nav','click','confirm','contact','alert','hostile','critical']:
        seconds=.32 if name in ['click','ui-select','ui-cancel','ui-nav','confirm'] else 1.5
        t=np.arange(int(seconds*RATE))/RATE; x=np.zeros(len(t))
        for at in ([0,.32,.64] if name in ['alert','hostile','critical'] else [0,.25] if name=='contact' else [0]):
            age=np.maximum(t-at,0); gate=t>=at
            x+=recorded('thud2.wav',len(t),.72+v*.06,900,at)*.45
            x+=gate*sine_drop(age,92+v*8,48,30)*np.exp(-age*25)*.26
        write(f'{name}-{v}',x,'Low mechanical panel latch or hull-transmitted warning pulse; no bright chirp',rms=.11,components=['thud2.wav'])
(out/'sources.json').write_text(json.dumps({'licence':'Mixed; individual file and recording licences below. Sonniss derivatives are not CC0.','recordingSources':provenance,'files':records},indent=2)+'\n')
print('Generated',len(records),'original sub-heavy compressed pass-four assets')
