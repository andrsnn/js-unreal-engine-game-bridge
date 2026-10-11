"""Rearticulate shipped licensed PDC reports; no raw pack or PCM scratch needed."""
import hashlib
import json
from pathlib import Path
import subprocess

import imageio_ffmpeg
import numpy as np

RATE = 48000
FF = imageio_ffmpeg.get_ffmpeg_exe()
ROOT = Path(__file__).resolve().parents[1]
OLD = ROOT / 'public/audio/naval-v4'
OUT = ROOT / 'public/audio/naval-v5'
OUT.mkdir(exist_ok=True)
provenance = json.loads((OLD / 'sources.json').read_text())
records = {}
durations = [.280, .292, .300, .272, .286, .296]
for variant, duration in enumerate(durations):
    source = OLD / f'pdc-{variant % 4}.ogg'
    pcm = subprocess.run([FF, '-v', 'error', '-i', str(source), '-ar', str(RATE),
                          '-ac', '2', '-f', 'f32le', 'pipe:1'],
                         capture_output=True, check=True, timeout=30)
    original = np.frombuffer(pcm.stdout, dtype='<f4').reshape(-1, 2).astype(float)
    # Keep the physical bass recoil, but articulate the accumulated hammer /
    # casing texture between barrel impulses instead of sustaining a drone.
    speed = [.98, 1.00, 1.02, .99, 1.015, .985][variant]
    t = np.arange(round(duration * RATE)) / RATE
    x = np.column_stack([np.interp(t * RATE * speed, np.arange(len(original)),
                                 original[:, channel]) for channel in range(2)])
    frequencies = np.fft.rfftfreq(len(x), 1 / RATE)
    body = np.fft.irfft(np.fft.rfft(x, axis=0) *
                       np.exp(-(frequencies[:, None] / 180) ** 4), n=len(x), axis=0)
    spacing = (.040 + (variant % 4) * .0012) / speed
    age = np.mod(t, spacing)
    articulation = .34 + .66 * np.exp(-age * 105)
    x = body * .90 + (x - body) * articulation[:, None]
    # The final feed/casing release finishes before the .34-second retrigger.
    fade = np.clip((duration - .012 - t) / .036, 0, 1)
    fade = fade * fade * (3 - 2 * fade)
    x -= x.mean(axis=0)
    x *= fade[:, None]
    x *= min(1, .72 / max(.001, np.max(np.abs(x))))
    target = OUT / f'pdc-{variant}.ogg'
    subprocess.run([FF, '-y', '-v', 'error', '-f', 'f32le', '-ar', str(RATE),
                    '-ac', '2', '-i', 'pipe:0', '-c:a', 'libvorbis', '-q:a', '6',
                    str(target)], input=x.astype('<f4').tobytes(), check=True, timeout=30)
    records[target.name] = {
        'source': 'Processed existing shipped naval-v4 PDC; tools/generate-audio-v5.py',
        'description': 'Short physical barrel phrase; preserved bass recoil, articulated recorded hammer/casing contacts and finite feed release',
        'author': provenance['files'][source.name]['author'],
        'licence': provenance['files'][source.name]['licence'],
        'recordingComponents': ['hammer', 'clink2.wav', 'clink3.wav'],
        'derivedFrom': '../naval-v4/' + source.name,
        'derivedSourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
        'sha256': hashlib.sha256(target.read_bytes()).hexdigest(),
        'duration': duration, 'sampleRate': RATE, 'loop': False,
    }
(OUT / 'sources.json').write_text(json.dumps({
    'licence': 'Mixed CC0 original/metal layers and Sonniss licensed recorded hammer; derivatives are not wholly CC0.',
    'recordingSources': {key: provenance['recordingSources'][key] for key in ['hammer', 'clink2.wav', 'clink3.wav']},
    'files': records,
}, indent=2) + '\n')
print('Generated six compressed PDC phrases without raw downloads or scratch media.')
