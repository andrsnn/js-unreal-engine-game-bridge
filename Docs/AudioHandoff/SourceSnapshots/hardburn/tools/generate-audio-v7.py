"""Eight physical cold-release / ignition / swarm-motor performances, from committed licensed cues.

No downloads, raw-pack dependency, PCM scratch files or learned models. Only
compressed game cues and their provenance ship. Run from any working folder.
"""
import hashlib
import json
from pathlib import Path
import subprocess

import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RATE = 48000
FF = imageio_ffmpeg.get_ffmpeg_exe()
OUT = ROOT / 'public/audio/naval-v7'
OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(770044)
manifests = {v: json.loads((ROOT / f'public/audio/naval-v{v}/sources.json').read_text()) for v in [4, 5]}
cache = {}
records = {}
recording_sources = {}

def read(name, version=4):
    key = (version, name)
    if key not in cache:
        path = ROOT / f'public/audio/naval-v{version}' / name
        result = subprocess.run([FF, '-v', 'error', '-i', str(path), '-ar', str(RATE),
                                 '-ac', '2', '-f', 'f32le', 'pipe:1'],
                                capture_output=True, check=True, timeout=30)
        cache[key] = np.frombuffer(result.stdout, dtype='<f4').reshape(-1, 2).astype(float)
    return cache[key]

def fit(x, frames, speed=1, offset=0, cyclic=False):
    indices = np.arange(frames) * speed + offset * RATE
    if cyclic:
        indices %= len(x)
    return np.column_stack([np.interp(indices, np.arange(len(x)), x[:, c], left=0, right=0) for c in [0, 1]])

def tone(x, cutoff, highpass=0):
    hz = np.fft.rfftfreq(len(x), 1 / RATE)
    shape = np.exp(-(hz / cutoff) ** 4)
    if highpass:
        shape *= 1 - np.exp(-(hz / highpass) ** 4)
    return np.fft.irfft(np.fft.rfft(x, axis=0) * shape[:, None], n=len(x), axis=0)

def emit(family, variant, seconds, sources, loop=False, cutoff=2200, highpass=0):
    n = round(seconds * RATE)
    x = np.zeros((n, 2))
    refs = []
    components = set()
    for name, version, level, speed, at, offset in sources:
        data = fit(read(name, version), n, speed, offset, loop)
        if at:
            delay = round(at * RATE)
            data = np.concatenate([np.zeros((delay, 2)), data], axis=0)[:n]
        x += data * level
        source_path = ROOT / f'public/audio/naval-v{version}' / name
        source_spec = manifests[version]['files'][name]
        components.update(source_spec['recordingComponents'])
        refs.append({'file': f'../naval-v{version}/{name}',
                     'sha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
                     'gain': level, 'speed': speed, 'layerDelay': at, 'sourceOffset': offset})
        for component in source_spec['recordingComponents']:
            recording_sources[component] = manifests[version]['recordingSources'][component]
    x = tone(x, cutoff, highpass)
    x -= x.mean(axis=0)
    if family.endswith('ignition'):
        attack = .020 if family.startswith('swarm') else .035
        x *= (1 - np.exp(-np.arange(n) / RATE / attack))[:, None]
    if loop:
        # Equal-power circular texture blend leaves a finite smooth loop seam.
        seam = min(2400, len(x) // 8)
        blend = np.linspace(0, 1, seam)[:, None]
        join = x[:seam] * blend + x[-seam:] * (1 - blend)
        x[:seam] = join
        x[-seam:] = join
        # Both endpoints approach the same sample without a discontinuity.
        endpoint = (x[0] + x[-1]) * .5
        x[:128] += (endpoint - x[0]) * np.linspace(1, 0, 128)[:, None]
        x[-128:] += (endpoint - x[-1]) * np.linspace(0, 1, 128)[:, None]
    else:
        release = .033 if family == 'pdc' else min(.16, seconds * .16)
        fade = np.clip((seconds - .012 - np.arange(n) / RATE) / release, 0, 1)
        x *= (fade * fade * (3 - 2 * fade))[:, None]
        if family == 'vent':
            x *= (1 - np.exp(-np.arange(n) / RATE * 12))[:, None]
    # Keep comparable attack gain; avoid making expanded banks louder merely
    # to disguise repetition. Encoding headroom also contains Vorbis overshoot.
    ceiling = .68
    x *= min(1, ceiling / max(.001, np.max(np.abs(x))))
    path = OUT / f'{family}-{variant}.ogg'
    subprocess.run([FF, '-y', '-v', 'error', '-f', 'f32le', '-ar', str(RATE), '-ac', '2',
                    '-i', 'pipe:0', '-c:a', 'libvorbis', '-q:a', '6', str(path)],
                   input=x.astype('<f4').tobytes(), check=True, timeout=30)
    licensed = any('Sonniss' in recording_sources[k]['licence'] for k in components)
    records[path.name] = {'source': 'Committed physical game cues; tools/generate-audio-v7.py',
        'author': 'HARD BURN original processing; recorded authors listed below',
        'licence': 'CC0-1.0 original/CC0 layers; Sonniss GDC Bundle EULA v2.0 recorded layers' if licensed else 'CC0-1.0',
        'description': f'{family}: separately timed, layered and filtered physical performance {variant + 1}/8',
        'layerChoice': [ref['file'] for ref in refs],
        'recordingComponents': sorted(components), 'derivedSources': refs,
        'duration': seconds, 'sampleRate': RATE, 'loop': loop,
        'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}

for v in range(8):
    a = v % 4
    b = (v * 3 + 1) % 4
    speed = [.976, 1.018, .991, 1.027, 1.005, .984, 1.022, .996][v]
    # Separate tube/casing attack from ignition; no fake powered launch during alignment.
    emit('swarm-cold', v, .175 + v % 3 * .005,
         [(f'pdc-{v % 6}.ogg',5,.57,1.12*speed,0,0),
          (f'launch-{b}.ogg',4,.30,1.18,.009+v%3*.003,0)], cutoff=1450+v*18)
    emit('missile-cold', v, .24,
         [(f'launch-{a}.ogg',4,.80,1.12*speed,0,0),
          (f'impact-tail-{b}.ogg',4,.09,1.10,.013+v%3*.004,.02)], cutoff=1350+v*16)
    emit('torpedo-cold', v, .34,
         [(f'launch-{a}.ogg',4,.94,.87*speed,0,0),
          (f'impact-{b}.ogg',4,.11,.86,.026+v%3*.008,.016)], cutoff=1050+v*14)
    for family, duration, launch_gain, launch_speed, motor, motor_gain, cutoff in [
        ('swarm-ignition',.48,.68,1.19,'drive-small',.35,1150),
        ('missile-ignition',.88,.90,1.05,'drive-medium',.28,1250),
        ('torpedo-ignition',1.4,.98,.84,'drive-heavy',.40,1000)]:
        emit(family,v,duration,
             [(f'launch-{a}.ogg',4,launch_gain,launch_speed*speed,0,.22+v%3*.016),
              ((motor if v%2 else 'drive-medium')+'.ogg',4,motor_gain,1,.015+v%3*.011,.5+v*.57)], cutoff=cutoff*(.94+v*.014))
    emit('swarm-burn',v,12,
         [('torpedo-burn.ogg',4,.46,1.08,0,v*.791),
          (('drive-small' if v%2 else 'drive-medium')+'.ogg',4,.45,1.04,0,.4+v*1.071)], loop=True,cutoff=850*(.94+v*.013))

(OUT/'sources.json').write_text(json.dumps({
    'licence':'Mixed CC0 and Sonniss; see individual files and recording sources.',
    'phaseContract':'Cold releases are unpowered tube/metal reports; ignition occurs only at the real first motor activation. Loop survives only active local burn; no atmospheric sound propagation.',
    'recordingSources':recording_sources,'files':records},indent=2)+'\n')
print('Generated',len(records),'compressed licensed phase performances; no intermediate media.')
