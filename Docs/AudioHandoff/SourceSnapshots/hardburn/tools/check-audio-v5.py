"""Decode final PDC phrases and compare overlap/masking with shipped v4."""
import hashlib
import json
from pathlib import Path
import subprocess

import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
FF = imageio_ffmpeg.get_ffmpeg_exe()
RATE = 48000
BANK = ROOT / 'public/audio/naval-v5'
manifest = json.loads((BANK / 'sources.json').read_text())

def decode(path):
    result = subprocess.run([FF, '-v', 'error', '-i', str(path), '-ar', str(RATE),
                             '-ac', '2', '-f', 'f32le', 'pipe:1'],
                            capture_output=True, check=True, timeout=30)
    return np.frombuffer(result.stdout, dtype='<f4').reshape(-1, 2).astype(float)

report = {}
old_energy = new_energy = 0
for name, spec in manifest['files'].items():
    path = BANK / name
    assert hashlib.sha256(path.read_bytes()).hexdigest() == spec['sha256']
    source = (BANK / spec['derivedFrom']).resolve()
    assert hashlib.sha256(source.read_bytes()).hexdigest() == spec['derivedSourceSha256']
    assert 'Sonniss' in spec['licence']
    for key in spec['recordingComponents']:
        assert key in manifest['recordingSources']
    x = decode(path)
    old = decode(source)
    assert np.all(np.isfinite(x)) and np.max(np.abs(x)) < .85
    assert abs(len(x) / RATE - spec['duration']) < .025
    assert len(x) / RATE / .9725 < .34, 'Slowest runtime variation must finish before another .34s burst'
    mono = x.mean(axis=1)
    power = np.abs(np.fft.rfft(mono)) ** 2
    hz = np.fft.rfftfreq(len(mono), 1 / RATE)
    bass = power[hz < 250].sum() / power.sum()
    treble = power[hz > 3500].sum() / power.sum()
    assert bass > .45 and treble < .03, (name, bass, treble)
    # Equal firing schedule and gain: reduced sustaining energy must leave
    # room for other combat transients, rather than simply louder new samples.
    before = np.sum(old * old)
    after = np.sum(x * x)
    assert after < before * .65, (name, after / before)
    assert np.max(np.abs(x[:2400])) > .15, 'Initial physical attack remains present'
    assert np.sqrt(np.mean(x[-240:] ** 2)) < .012, 'Finite release must not click at cutoff'
    old_energy += before
    new_energy += after
    report[name] = {'duration': len(x) / RATE, 'decodedPeak': float(np.max(np.abs(x))),
                    'bassEnergy': float(bass), 'trebleEnergy': float(treble),
                    'sustainEnergyRatioToV4': float(after / before)}
print(json.dumps({'assets': report, 'combinedEnergyChangeDB': float(10 * np.log10(new_energy / old_energy)),
                  'checks': 'source hashes/licences, deep identity, headroom, finite release, no same-emitter overlap and reduced masking energy'}, indent=2))
