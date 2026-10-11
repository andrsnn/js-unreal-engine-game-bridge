"""Audit every shipped combat variant and its licensed derivation, no render."""
import hashlib
import json
from pathlib import Path
import subprocess

import imageio_ffmpeg
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
BANK = ROOT / 'public/audio/naval-v7'
FF = imageio_ffmpeg.get_ffmpeg_exe()
RATE = 48000
manifest = json.loads((BANK / 'sources.json').read_text())
families = {}
layer_choices = {}
maximum_peak = maximum_treble = maximum_seam = 0
minimum_bass = 1
decoded = {}
for name, spec in manifest['files'].items():
    family = name.rsplit('-', 1)[0]
    families.setdefault(family, []).append(spec['sha256'])
    layer_choices.setdefault(family,set()).add(tuple(spec['layerChoice']))
    path = BANK / name
    assert hashlib.sha256(path.read_bytes()).hexdigest() == spec['sha256']
    for source in spec['derivedSources']:
        assert hashlib.sha256((BANK / source['file']).read_bytes()).hexdigest() == source['sha256']
    components = [manifest['recordingSources'][key] for key in spec['recordingComponents']]
    assert all('author' in component and 'url' in component for component in components)
    if any('Sonniss' in component['licence'] for component in components):
        assert 'Sonniss' in spec['licence'], name
    result = subprocess.run([FF, '-v', 'error', '-i', str(path), '-ar', str(RATE),
                             '-ac', '2', '-f', 'f32le', 'pipe:1'],
                            capture_output=True, check=True, timeout=30)
    x = np.frombuffer(result.stdout, dtype='<f4').reshape(-1, 2).astype(float)
    decoded[name] = x
    peak = float(np.max(np.abs(x)))
    assert np.all(np.isfinite(x)) and peak < .93, (name, peak)
    assert abs(len(x) / RATE - spec['duration']) < .025, name
    mono = x.mean(axis=1)
    hz = np.fft.rfftfreq(len(x), 1 / RATE)
    energy = np.abs(np.fft.rfft(mono)) ** 2
    bass = float(energy[hz < 250].sum() / energy.sum())
    treble = float(energy[hz > 3500].sum() / energy.sum())
    assert treble < .025, (name, treble)
    if family != 'vent':
        assert bass > .40, (name, bass)
        minimum_bass = min(minimum_bass, bass)
    if family == 'pdc':
        assert len(x) / RATE / .96 < .34, 'Slowest PDC cannot overlap next .34s phrase'
    if spec['loop']:
        assert len(x) == RATE * 12, 'Native loops keep complete twelve-second transport'
        seam = float(np.max(np.abs(x[-1] - x[0])))
        assert seam < .045, (name, 'loop seam', seam)
        maximum_seam = max(maximum_seam, seam)
    else:
        assert np.sqrt(np.mean(x[-128:] ** 2)) < .025, (name, 'finite release')
    maximum_peak = max(maximum_peak, peak)
    maximum_treble = max(maximum_treble, treble)
assert len(families) == 7
assert all(len(choices)>=2 for choices in layer_choices.values()), 'Every combat family needs actual baked source-layer choices'
assert all(len(hashes) == 8 and len(set(hashes)) == 8 for hashes in families.values())
missile = decoded['missile-cold-0.ogg'][:8000].mean(axis=1)
torpedo = decoded['torpedo-cold-0.ogg'][:8000].mean(axis=1)
swarm = decoded['swarm-cold-0.ogg'][:8000].mean(axis=1)
correlations = {a+'-'+b: float(np.corrcoef(x,y)[0,1]) for a,x,b,y in [
    ('missile',missile,'torpedo',torpedo),('swarm',swarm,'missile',missile),('swarm',swarm,'torpedo',torpedo)]}
assert all(abs(value)<.90 for value in correlations.values()), 'Distinct unpowered tube reports per type'
for family in ['swarm','missile','torpedo']:
    for v in range(8):
        cold=manifest['files'][f'{family}-cold-{v}.ogg']
        ignition=manifest['files'][f'{family}-ignition-{v}.ogg']
        assert cold['duration'] < .4 and ignition['duration'] > cold['duration']
        assert all(source['sourceOffset']>=.2 for source in ignition['derivedSources']), 'Ignition uses powered body, excluding cold attack'
print(json.dumps({'families':len(families),'variantsPerFamily':8,'assets':len(manifest['files']),
    'maximumDecodedPeak':maximum_peak,'minimumBassEnergy':minimum_bass,'maximumTrebleEnergy':maximum_treble,
    'maximumLoopSeam':maximum_seam,'coldTypeCorrelations':correlations,
    'compressedBytes':sum(p.stat().st_size for p in BANK.glob('*.ogg')),
    'checks':'source/recording licences and hashes, complete unique bags, distinct cold reports, powered-only ignition, bass/headroom/finite release and loop seam'},indent=2))
