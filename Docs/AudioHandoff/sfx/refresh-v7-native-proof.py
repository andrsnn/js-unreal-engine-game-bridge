"""Bridge host-only audio metadata updates to the verified native asset graph."""
import hashlib
import json
from pathlib import Path

root = Path('/mnt/g/JsGameBridge')
reports = root / 'Tools/AudioImporter/reports'
current_path = root / 'Registry/audio-cues-v7.json'
baseline_path = reports / 'audio-cues-v7-imported-manifest.json'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
current = json.loads(current_path.read_text())
baseline = json.loads(baseline_path.read_text())
baseline_sha = sha(baseline_path)
for name in ['audio-cues-v7-import.json', 'audio-cues-v7-verify.json']:
    receipt = json.loads((reports / name).read_text())
    assert receipt['ok'] and not receipt['errors'], name
    assert receipt['manifestSha256'] == baseline_sha, name
assert current['games'].keys() == baseline['games'].keys()
for game, entry in current['games'].items():
    original = baseline['games'][game]
    assert entry['cues'] == original['cues'], f'{game}: native cue definitions changed'
    assert entry['aliases'] == original['aliases'], f'{game}: aliases changed'
    assert entry['sourceDocuments'] == original['sourceDocuments'], f'{game}: provenance changed'
    if game not in ['hardburn', 'unlit']:
        assert entry == original, f'{game}: unrelated audio changed'
    runtime = json.loads((root / f'JavaScript/{game}-assets.json').read_text())
    assets = runtime.get('assets', runtime)
    for key, cue in entry['cues'].items():
        assert assets[key]['sound'] == cue['sound'], f'{game}/{key}: runtime key differs'
    for key, canonical in entry['aliases'].items():
        assert assets[key]['sound'] == entry['cues'][canonical]['sound'], f'{game}/{key}: alias differs'
proof = {
    'ok': True,
    'importedManifestSha256': baseline_sha,
    'finalManifestSha256': sha(current_path),
    'cueDefinitionsUnchanged': True,
    'aliasesUnchanged': True,
    'provenanceUnchanged': True,
    'unrelatedGamesUnchanged': True,
    'finalUnlitSourceCommit': current['games']['unlit']['sourceCommit'],
    'runtimeSoundKeysVerified': True,
    'finalSourceCommit': current['games']['hardburn']['sourceCommit'],
    'nativeAssetsRequireReimport': False,
    'note': 'Host-only source/mix/lifetime metadata refreshed. Original frozen import and fresh-process asset verification remain valid; no native gameplay acceptance claimed.'
}
(reports / 'audio-cues-v7-final-metadata.json').write_text(json.dumps(proof, indent=2) + '\n')
print(json.dumps(proof))
