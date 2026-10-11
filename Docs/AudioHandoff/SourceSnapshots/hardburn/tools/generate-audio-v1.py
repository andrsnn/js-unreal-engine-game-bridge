"""Original HARD BURN naval score and shipboard Foley. All output is CC0-1.0.

Run from repository root. Requires numpy and ffmpeg (or imageio_ffmpeg).
Uncompressed intermediates stay outside public/ on G:; only Vorbis ships.
"""
import argparse
import json
import math
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np

RATE = 48000
parser = argparse.ArgumentParser()
parser.add_argument('--scratch', default='/mnt/g/sfx/audio-renders/hardburn')
parser.add_argument('--ffmpeg', default=shutil.which('ffmpeg'))
args = parser.parse_args()
if not args.ffmpeg:
    import imageio_ffmpeg
    args.ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
scratch = Path(args.scratch)
scratch.mkdir(parents=True, exist_ok=True)
out = Path('public/audio/naval')
out.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(190619)
records = {}


def write(name, samples, description, loop=False):
    x = np.asarray(samples, dtype=np.float64)
    if x.ndim == 1:
        x = np.column_stack([x, x])
    x -= x.mean(axis=0)
    # Preserve crest factor: no normalization to full scale, no distortion.
    peak = float(np.max(np.abs(x)))
    if peak > .82:
        x *= .82 / peak
    path = scratch / (name + '.wav')
    with wave.open(str(path), 'wb') as stream:
        stream.setnchannels(2)
        stream.setsampwidth(2)
        stream.setframerate(RATE)
        stream.writeframes((x * 32767).astype('<i2').tobytes())
    subprocess.run([args.ffmpeg, '-y', '-hide_banner', '-loglevel', 'error',
                    '-i', str(path), '-c:a', 'libvorbis', '-q:a', '5',
                    str(out / (name + '.ogg'))], check=True, timeout=60)
    records[name + '.ogg'] = {'source': 'Original deterministic synthesis in tools/generate-audio-v1.py',
                              'author': 'HARD BURN original audio', 'licence': 'CC0-1.0',
                              'description': description, 'duration': len(x) / RATE,
                              'loop': loop, 'peak': round(float(np.max(np.abs(x))), 4)}


def noise(n, lo, hi):
    frequency = np.fft.rfftfreq(n, 1 / RATE)
    spectrum = np.fft.rfft(rng.standard_normal(n))
    shape = np.exp(-(frequency / hi) ** 4) * (1 - np.exp(-(frequency / max(1, lo)) ** 4))
    return np.fft.irfft(spectrum * shape, n=n)


# New reports retain low hull resonance, with a readable short transient at
# close inspection. Mechanical tails belong to the hull, not an outdoor echo.
for variation in range(4):
    for name, duration, root, cutoff, description in [
        ('rail', .75, 88, 8500, 'Rail discharge: sharp current arc, deep recoil, damped hull modes'),
        ('mac', 1.05, 44, 4200, 'Heavy mass driver: breech slam, concussion and resonant frame'),
        ('impact', .95, 76, 6200, 'Armour strike: puncture impulse and damped structure'),
        ('flak', .65, 108, 5200, 'Flak battery: clustered thumps and short barrel report'),
        ('large-blast', 3.4, 34, 2100, 'Hull breakup: pressure release, structural snaps, reactor rumble'),
    ]:
        t = np.arange(int(RATE * duration)) / RATE
        root *= .94 + variation * .035
        envelope = (1 - np.exp(-t * 2800)) * np.exp(-t / (duration * .18))
        body = np.sin(2 * np.pi * root * t + 2 * np.exp(-t * 38)) * envelope * .50
        crack = noise(len(t), 550, cutoff) * np.exp(-t / .016) * 1.1
        tail = noise(len(t), 30, cutoff * .20) * np.exp(-t / (duration * .27)) * .48
        frame = sum(np.sin(2 * np.pi * root * ratio * t + variation * .2)
                    * np.exp(-t / (duration * .22)) / (i + 2)
                    for i, ratio in enumerate([1.73, 2.67, 4.13])) * .13
        if name == 'large-blast':
            for at in [.09, .22, .47, .76, 1.2]:
                age = np.maximum(0, t - at)
                tail += noise(len(t), 220, 3600) * (t >= at) * np.exp(-age * 28) * .38
        write(f'{name}-{variation}', body + crack + tail + frame, description)
    t = np.arange(int(RATE * .42)) / RATE
    rattle = noise(len(t), 350, 7200)
    burst = np.zeros(len(t))
    for index in range(7):
        age = t - index * (.033 + variation * .001)
        env = (age >= 0) * (1 - np.exp(-np.maximum(age, 0) * 4200)) * np.exp(-np.maximum(age, 0) / .007)
        burst += (rattle * 1.1 + np.sin(2 * np.pi * (155 + variation * 7) * t) * .20) * env
    write(f'pdc-{variation}', burst, 'Seven-round rotary PDC buzz with distinct tiny transients')
    t = np.arange(int(RATE * 1.55)) / RATE
    latch = noise(len(t), 350, 4900) * np.exp(-t * 65) * .65
    piston = np.sin(2 * np.pi * (58 + variation * 2) * t + np.exp(-t * 60)) * np.exp(-t * 16) * .40
    motor = noise(len(t), 40, 2100) * (1 - np.exp(-t * 18)) * np.exp(-t * 3.6) * .45
    write(f'launch-{variation}', latch + piston + motor, 'Launch clamp, cold-gas piston, accelerating motor burn')

# Periodic machinery loop. FFT-filtered noise and integer-period modulation
# give an uninterrupted seam; engines are faded by the runtime mixer.
duration = 12
t = np.arange(RATE * duration) / RATE
vent = noise(len(t), 80, 1300) * (.16 + .03 * np.sin(2 * np.pi * t / duration))
vent += noise(len(t), 20, 140) * .18
vent += np.sin(2 * np.pi * 60 * t) * .012 + np.sin(2 * np.pi * 120 * t) * .008
write('shipboard', vent, 'Quiet shipboard air circulation, transformer vibration and distant machinery', True)

# A 16-bar original score at 72 BPM. Four stems have exactly the same loop
# length; the runtime starts them on one sample clock and blends continuously.
# D minor -> B flat -> G suspended -> A, with a restrained three-note motif.
beat = 60 / 72
duration = 64 * beat
n = int(round(RATE * duration))
t = np.arange(n) / RATE
chords = [[146.8324, 174.6141, 220, 293.6648],
          [116.5409, 146.8324, 174.6141, 233.0819],
          [97.99886, 130.8128, 146.8324, 195.9977],
          [110, 146.8324, 164.8138, 220]]
bed = np.zeros((n, 2))
motif = np.zeros((n, 2))
pulse = np.zeros((n, 2))
drums = np.zeros((n, 2))


def add(destination, signal, start, pan=0):
    # Wrap ringing tails across the loop edge so encoded stems remain musical
    # at the bar boundary. Equal-power pan maintains level.
    offset = int(round(start * RATE))
    indices = (np.arange(len(signal)) + offset) % n
    destination[indices, 0] += signal * math.sqrt((1 - pan) / 2)
    destination[indices, 1] += signal * math.sqrt((1 + pan) / 2)


for section, chord in enumerate(chords):
    length = 20 * beat
    age = np.arange(int(length * RATE)) / RATE
    env = np.minimum(age / 2.2, 1) * np.minimum(np.maximum(length - age, 0) / 3.6, 1)
    for voice, frequency in enumerate(chord):
        tone = (np.sin(2 * np.pi * frequency * age + .16 * np.sin(2 * np.pi * .13 * age))
                + .28 * np.sin(2 * np.pi * frequency * 2 * age)
                + .10 * np.sin(2 * np.pi * frequency * 3 * age)) * env * .026
        add(bed, tone, section * 16 * beat, (voice - 1.5) * .3)
    # A sparse sonar-like bell against the strings. The final section changes
    # its resolution rather than repeating a stock suspense ostinato.
    for note, (offset, voice) in enumerate([(2, 3), (7.5, 1), (11, 2)]):
        age = np.arange(int(4.5 * RATE)) / RATE
        frequency = chord[voice] * 2
        pluck = np.sin(2 * np.pi * frequency * age + 1.8 * np.sin(2 * np.pi * frequency * 2 * age) * np.exp(-age * 2))
        pluck *= (1 - np.exp(-age * 110)) * np.exp(-age / 1.15) * .09
        add(motif, pluck, (section * 16 + offset) * beat, [-.35, .4, 0][note])
        add(motif, pluck * .23, (section * 16 + offset) * beat + .625, -[-.35, .4, 0][note])
    for index in range(32):
        age = np.arange(int(beat * 1.2 * RATE)) / RATE
        frequency = chord[[0, 0, 2, 1, 0, 2, 3, 1][index % 8]] / 2
        tone = (np.sin(2 * np.pi * frequency * age)
                + .28 * np.sin(2 * np.pi * frequency * 2 * age)
                + .08 * np.sin(2 * np.pi * frequency * 4 * age))
        tone *= (1 - np.exp(-age * 180)) * np.exp(-age / .19) * (.20 if index % 4 == 0 else .13)
        add(pulse, tone, (section * 16 + index / 2) * beat, .18 * (-1) ** index)
    for index in range(16):
        age = np.arange(int(.75 * RATE)) / RATE
        if index % 4 in [0, 2]:
            kick = np.sin(2 * np.pi * (43 * age + 1.2 * (1 - np.exp(-age * 22))))
            kick *= (1 - np.exp(-age * 1700)) * np.exp(-age * 8) * .30
            kick += noise(len(age), 180, 1600) * np.exp(-age * 60) * .11
            add(drums, kick, (section * 16 + index) * beat)
        if index % 4 == 3:
            hit = noise(len(age), 350, 3600) * np.exp(-age * 20) * .22
            hit += np.sin(2 * np.pi * 182 * age) * np.exp(-age * 16) * .07
            add(drums, hit, (section * 16 + index) * beat, .27)
        tick = noise(len(age), 1800, 6500) * np.exp(-age * 95) * .09
        add(drums, tick, (section * 16 + index + .5) * beat, -.36)

for name, stem, description in [('score-bed', bed, 'D minor naval exploration score: slowly shifting bowed synthesis'),
                                 ('score-motif', motif, 'Sparse original sonar-bell navigation motif'),
                                 ('score-pulse', pulse, 'Adaptive low mechanical ostinato; 72 BPM tension stem'),
                                 ('score-combat', drums, 'Adaptive hull percussion; synchronized 72 BPM combat stem')]:
    target_rms = {'score-bed': .16, 'score-motif': .11, 'score-pulse': .12, 'score-combat': .10}[name]
    stem *= target_rms / max(.001, float(np.sqrt(np.mean(stem * stem))))
    write(name, stem, description, True)

(out / 'sources.json').write_text(json.dumps({'licence': 'CC0-1.0', 'author': 'HARD BURN original audio',
                                             'score': {'bpm': 72, 'bars': 16, 'seconds': duration},
                                             'files': records}, indent=2) + '\n')
print(f'Generated {len(records)} compressed original assets in {out}')

# Migrate the previous CC0 PCM bank without changing its performances. Run
# tools/generate-shipboard-audio-25.py first to reproduce those source WAVs.
legacy = Path('public/audio/generated')
for path in legacy.glob('*.wav'):
    subprocess.run([args.ffmpeg, '-y', '-hide_banner', '-loglevel', 'error', '-i', str(path),
                    '-c:a', 'libvorbis', '-q:a', '5', str(path.with_suffix('.ogg'))],
                   check=True, timeout=60)
    path.unlink()
manifest = legacy / 'sources.json'
if manifest.exists():
    metadata = json.loads(manifest.read_text())
    metadata['files'] = {name.replace('.wav', '.ogg'): record for name, record in metadata['files'].items()}
    metadata['encoding'] = 'Vorbis quality 5; original synthesis is unchanged'
    manifest.write_text(json.dumps(metadata, indent=2) + '\n')
