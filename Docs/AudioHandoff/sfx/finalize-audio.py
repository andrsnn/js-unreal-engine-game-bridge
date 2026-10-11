from pathlib import Path
import hashlib, json, re

root = Path('/mnt/g/sfx')
judge = Path('/mnt/c/UnlitWorldsCaptures/judge')
entries = []
for game in ('hardburn', 'karvos', 'unlit'):
    for version in [2, 3] + [v for v in (4, 5, 6) if (root / f'evidence/{game}/pass{v}/fixture/delivery.json').exists()]:
        mode = 'new' if game == 'karvos' and version < 4 else 'fixture'
        evidence = root / 'evidence' / game / f'pass{version}' / mode
        report = json.loads((evidence / 'report.json').read_text())
        assert not report['errors'] and not report['missing'], (game, version)
        assert report['before']['audio']['audioPass'] == version
        delivered = json.loads((evidence / 'delivery.json').read_text())['probe']['format']
        clip = judge / f'{game}-audio-v{version}.mp4'
        assert clip.stat().st_size == int(delivered['size'])
        assert 30 <= float(delivered['duration']) <= 60
        assert clip.stat().st_size < 30 * 1024**2

        def levels(filename):
            summary = (evidence / filename).read_text().rsplit('Summary:', 1)[1]
            return (float(re.search(r'I:\s*([-\d.]+) LUFS', summary)[1]),
                    float(re.search(r'Peak:\s*([-\d.]+) dBFS', summary)[1]))

        raw_lufs, raw_peak = levels('raw-loudness.txt')
        lufs, peak = levels('delivery-loudness.txt')
        target = -15 if game == 'hardburn' and 4 <= version < 6 else -16
        assert abs(lufs - target) <= 1 and peak < 0 and raw_peak < 0
        for frame in ('frame-start', 'frame-middle', 'frame-end', 'spectrum'):
            assert (evidence / f'{frame}.png').is_file()
        entries.append(dict(game=game, version=version, clip=str(clip),
                            seconds=float(delivered['duration']), bytes=clip.stat().st_size,
                            sha256=hashlib.sha256(clip.read_bytes()).hexdigest(),
                            rawLUFS=raw_lufs, rawTruePeak=raw_peak,
                            deliveredLUFS=lufs, deliveredTruePeak=peak,
                            evidence=str(evidence)))
(root / 'delivery-audit.json').write_text(json.dumps(entries, indent=2) + '\n')
print(json.dumps(entries, indent=2))
