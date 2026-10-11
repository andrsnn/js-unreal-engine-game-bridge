"""Decode the shipped bank, check bass/headroom/licences, render a bus rehearsal.

The rehearsal is a deterministic audio mix, not evidence of real gameplay.
Root separately records the actual browser fight and measures integrated LUFS.
"""
import json, subprocess, wave
from pathlib import Path
import numpy as np
import imageio_ffmpeg
ff=imageio_ffmpeg.get_ffmpeg_exe(); rate=48000
bank=Path('public/audio/naval-v4'); manifest=json.loads((bank/'sources.json').read_text())
decoded={}; report={}
for name,entry in manifest['files'].items():
    pcm=subprocess.run([ff,'-hide_banner','-loglevel','error','-i',str(bank/name),'-ar',str(rate),'-ac','2','-f','f32le','pipe:1'],capture_output=True,check=True,timeout=30)
    stereo=np.frombuffer(pcm.stdout,dtype='<f4').astype(float).reshape(-1,2); x=stereo.mean(axis=1); decoded[name]=x
    assert np.all(np.isfinite(x)) and np.max(np.abs(stereo))<.97, name+' decoded headroom'
    # Non-loop Vorbis final packets can trim/pad one 1024-frame window.
    assert abs(len(x)/rate-entry['duration'])<.025, name+' duration'
    for component in entry['recordingComponents']: assert component in manifest['recordingSources'], component
    if any(k in ['hammer','tank','creak','explosion'] for k in entry['recordingComponents']): assert 'Sonniss' in entry['licence'],name+' royalty-free recording must not be labelled CC0'
    f=np.fft.rfftfreq(len(x),1/rate); power=np.abs(np.fft.rfft(x))**2
    bass=float(power[f<250].sum()/power.sum()); high=float(power[f>3500].sum()/power.sum())
    if name.startswith(('rail-','mac-','impact-','large-blast-','small-blast-')): assert bass>.55,(name,bass)
    if name.startswith('pdc-'): assert bass>.20,(name,bass)
    if name.startswith('score-'): assert len(x)==2560000,name+' synchronized clock'
    assert high<.055,(name,'excess treble',high)
    report[name]={'decodedPeak':float(np.max(np.abs(stereo))),'bassEnergy':bass,'trebleEnergy':high}

seconds=40; length=seconds*rate
weapons=np.zeros(length); impacts=np.zeros(length); music=np.zeros(length); engines=np.zeros(length)
def event(bus,name,at,volume=1,playback=1):
    x=decoded[name]; x=np.interp(np.arange(int(len(x)/playback))*playback,np.arange(len(x)),x)
    t=np.arange(len(x))/rate; duration=len(x)/rate
    env=np.minimum(1,t/.0025)*np.where(t<duration*.86,1,np.exp(-(t-duration*.86)/(duration*.1)))
    offset=int(at*rate); n=min(len(x),length-offset)
    if n>0: bus[offset:offset+n]+=x[:n]*env[:n]*volume*.65
for i,at in enumerate(np.arange(.3,38,.27)): event(weapons,f'pdc-{i%4}.ogg',at,1.35)
for i,at in enumerate(np.arange(.7,38,1.35)): event(weapons,f'rail-{i%4}.ogg',at,1.45)
for i,at in enumerate(np.arange(1.1,38,1.15)): event(impacts,f'impact-{i%4}.ogg',at,1.25)
for i,at in enumerate([2,9,17,25,32]): event(weapons,f'launch-{i%4}.ogg',at,1.4,.83)
for i,at in enumerate([8,19,30,37]): event(impacts,f'large-blast-{i%4}.ogg',at,1.55,.92)
music=(decoded['score-combat.ogg'][:length]*.85+decoded['score-pulse.ogg'][:length]*.75+decoded['score-bed.ogg'][:length]*.47)*.38*.32
engines=np.resize(decoded['drive-heavy.ogg'],length)*.68*.65*.25
def lowpass(x,cutoff):
    f=np.fft.rfftfreq(len(x),1/rate)
    return np.fft.irfft(np.fft.rfft(x)/np.sqrt(1+(f/cutoff)**4),n=len(x))
def combat(x,pref,cutoff,makeup): return .88*np.tanh(lowpass(x*pref,cutoff)*1.5)*makeup
mix=(combat(weapons,.52,3000,1.9)+combat(impacts,.60,1600,1.9)+combat(engines,1,850,1.45)+lowpass(music,1900))*.72
f=np.fft.rfftfreq(len(mix),1/rate); mix=np.fft.irfft(np.fft.rfft(mix)*(f/np.sqrt(f*f+24**2)),n=len(mix))
scratch=Path('/mnt/g/sfx/audio-renders/hardburn-v4'); scratch.mkdir(parents=True,exist_ok=True)
input_path=scratch/'bus-rehearsal-precompress.wav'
# Float input preserves over-unity sums for the same downstream compression.
subprocess.run([ff,'-y','-hide_banner','-loglevel','error','-f','f32le','-ar',str(rate),'-ac','1','-i','pipe:0','-c:a','pcm_f32le',str(input_path)],input=mix.astype('<f4').tobytes(),check=True,timeout=30)
output=scratch/'bus-rehearsal.wav'
subprocess.run([ff,'-y','-hide_banner','-loglevel','error','-i',str(input_path),'-af','acompressor=threshold=0.316:ratio=3:knee=2.2:attack=8:release=200,alimiter=limit=0.88:level=0','-c:a','pcm_s16le',str(output)],check=True,timeout=30)
measurement=subprocess.run([ff,'-hide_banner','-i',str(output),'-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True,timeout=30)
metrics=json.JSONDecoder().raw_decode(measurement.stderr[measurement.stderr.rfind('{'):])[0]
(scratch/'decoded-audit.json').write_text(json.dumps({'assets':report,'rehearsalOnlyLoudness':metrics},indent=2)+'\n')
print('Pass-four decoded assets:',len(decoded),'headroom, bass balance, treble cap, licence components and six exact transports passed.')
print('Offline bus rehearsal (not gameplay):',metrics,'render:',output)
