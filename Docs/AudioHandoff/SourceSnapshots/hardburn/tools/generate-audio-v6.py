"""Eight varied performances per combat family, from committed licensed cues.

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
OUT = ROOT / 'public/audio/naval-v6'
OUT.mkdir(exist_ok=True)
rng = np.random.default_rng(660077)
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
    ceiling = .72 if family == 'pdc' else .76
    x *= min(1, ceiling / max(.001, np.max(np.abs(x))))
    path = OUT / f'{family}-{variant}.ogg'
    subprocess.run([FF, '-y', '-v', 'error', '-f', 'f32le', '-ar', str(RATE), '-ac', '2',
                    '-i', 'pipe:0', '-c:a', 'libvorbis', '-q:a', '6', str(path)],
                   input=x.astype('<f4').tobytes(), check=True, timeout=30)
    licensed = any('Sonniss' in recording_sources[k]['licence'] for k in components)
    records[path.name] = {'source': 'Committed physical game cues; tools/generate-audio-v6.py',
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
    secondary = .075 + (v % 3) * .025
    for family, seconds, cutoff in [('rail', 2.8, 2800), ('mac', 3.3, 2200),
                                     ('flak', 1.1, 2300), ('laser', 1.5, 2300), ('plasma', 2.1, 1900),
                                     ('impact', 2.4, 1550), ('armour', 2.6, 1350)]:
        source = 'impact' if family == 'armour' else family
        tail = 'rail-tail' if family in ['rail', 'mac'] else 'impact-tail'
        emit(family, v, seconds, [(f'{source}-{a}.ogg', 4, .96, speed, 0, 0),
             (f'{tail}-{b}.ogg', 4, secondary, 1.02 - v * .007, .024 + (v % 3) * .018, .05 * (v % 2))],
             cutoff=cutoff * (.92 + v * .018))
    emit('pdc', v, .270 + (v % 4) * .006, [(f'pdc-{v % 6}.ogg', 5, 1, speed, 0, v % 3 * .0005),
         (f"{'flak' if v % 2 else 'impact-tail'}-{b}.ogg", 4, .035, 1.15, .015 + v % 4 * .006, .07)], cutoff=2800)
    emit('missile-launch', v, 2.2, [(f'launch-{a}.ogg', 4, .90, 1.12 * speed, 0, 0),
         (f'flak-{b}.ogg', 4, .12, 1.05, .025 + v % 3 * .018, .05)], cutoff=1800 + v * 24)
    emit('torpedo-launch', v, 3.2, [(f'launch-{a}.ogg', 4, .98, .94 * speed, 0, 0),
         (f'rail-tail-{b}.ogg', 4, .16, .91, .11 + v % 3 * .035, .04)], cutoff=1450 + v * 18)
    emit('breach', v, 2.8, [(f'impact-{a}.ogg', 4, .86, .91 * speed, 0, .004),
         (f'impact-tail-{b}.ogg', 4, .28, .82, .06 + v % 3 * .04, .1)], cutoff=1200 + v * 17)
    emit('intercept', v, .75, [(f'flak-{a}.ogg', 4, .66, 1.04 * speed, 0, 0),
         (f'small-blast-{b}.ogg', 4, .22, 1.09, .035 + v % 3 * .012, .07)], cutoff=1700 + v * 22)
    for family, source, seconds, level, cut in [('small-blast', 'small-blast', 2.0, .97, 1400),
                                               ('ship-blast', 'large-blast', 5.2, .98, 1250),
                                               ('reactor-blast', 'large-blast', 5.8, .90, 1050)]:
        emit(family, v, seconds, [(f'{source}-{a}.ogg', 4, level, speed * (.9 if family == 'reactor-blast' else 1), 0, 0),
             (f'impact-tail-{b}.ogg', 4, .13 if family != 'reactor-blast' else .26, .94, .10 + v % 4 * .055, .05)], cutoff=cut * (.93 + v * .018))
    emit('vent', v, 1.8, [(f'small-blast-{a}.ogg', 4, .38, .78 * speed, 0, .22 + v % 3 * .045),
         (f'impact-tail-{b}.ogg', 4, .16, .9, .025, .24)], cutoff=1150 + v * 24, highpass=110)
    for family in ['rail-tail', 'impact-tail']:
        emit(family, v, 3.1, [(f'{family}-{a}.ogg', 4, .94, speed, 0, .005 * (v % 3)),
             (f'impact-tail-{b}.ogg', 4, .08, .96, .026 + v % 4 * .014, .06)], cutoff=1150)
    for family, drive, level, cutoff in [('torpedo-burn', 'drive-heavy', .22, 650), ('missile-burn', 'drive-small', .35, 850)]:
        emit(family, v, 12, [('torpedo-burn.ogg', 4, .78 if family == 'torpedo-burn' else .60, 1, 0, v * .917),
             ((drive if v % 2 else 'drive-medium') + '.ogg', 4, level, 1, 0, .4 + v * 1.17)], loop=True, cutoff=cutoff * (.94 + v * .016))

(OUT / 'sources.json').write_text(json.dumps({'licence': 'Mixed CC0 and Sonniss; see individual files and recording sources.',
    'recordingSources': recording_sources, 'files': records}, indent=2) + '\n')
print('Generated', len(records), 'compressed licensed v6 performances; no intermediate media.')
