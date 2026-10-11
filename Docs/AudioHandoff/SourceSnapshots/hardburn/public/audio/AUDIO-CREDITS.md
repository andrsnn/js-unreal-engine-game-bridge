# HARD BURN audio credits

The naval score, shipboard machinery and four variants of rail, MAC, PDC, flak,
armour, heavy breakup and launch sounds in `naval/` are original deterministic
synthesis by HARD BURN original audio. They are dedicated to the public domain
under **CC0-1.0**: https://creativecommons.org/publicdomain/zero/1.0/.
`naval/sources.json` records each asset, its duration and provenance.
`tools/generate-audio-v1.py` reproduces these performances without models,
recordings or borrowed compositions. The four score stems form an original
16-bar composition in D minor at 72 BPM. They share one sample-clock transport.

The prior original shipboard synthesis in `generated/` remains **CC0-1.0**.
It is now compressed as Ogg Vorbis without changing the source performances.
Reproduce it with `tools/generate-shipboard-audio-25.py`, then run
`tools/generate-audio-v1.py` to encode its PCM and update its manifest.
Uncompressed intermediates for the new material stay outside the shipped
`public/` directory, on G: by default.

Kenney Sci-Fi Sounds, Impact Sounds and Interface Sounds are **CC0 1.0**.
Their original licence files are `KENNEY-scifi-LICENSE.txt`,
`KENNEY-impact-LICENSE.txt` and `KENNEY-interface-LICENSE.txt`; original URLs
and filenames remain in `sources.json`.

The nine pre-existing `kenney/hardburn-radio-*.ogg` files are original game
dialogue synthesized locally with the installed Windows System.Speech voice
by `tools/radio-calls.ps1`, then filtered and encoded as Vorbis. They are
separate from the Kenney library and are **not identified as CC0 recordings**.
Their existing provenance is documented in `ASSETS.md` under shipboard radio.
This update preserves those files and does not add any third-party dialogue.

All shipped audio is Ogg Vorbis. No game/film soundtrack or recording is used.

Second pass: `naval-v2/` adds original transmitted rail/armour tails, vowel-like
tactical threat bursts, coded critical alarms, three UI cue families and a
fifth synchronized 72 BPM danger score stem. All are **CC0-1.0** deterministic
synthesis from `tools/generate-audio-v2.py`; per-file provenance is in that
folder's `sources.json`. Threat bursts are formant synthesis without words,
voice models or recordings. Tails represent shipboard frame conduction and
filtered tactical monitoring, with no literal atmospheric propagation.

Third pass: `naval-v3/` provides four variants of original energy-weapon
excitation, plasma kick, PDC feed mechanism and guided motor burn, two radio
keying/squelch variants, and a synchronized 72 BPM sparse machinery score.
These **CC0-1.0** assets are reproduced by `tools/generate-audio-v3.py`;
`naval-v3/sources.json` records provenance. `src/audio-acoustics.js` generates
four deterministic, finite shipboard impulse responses at runtime without
recorded spaces or external assets. No voice model or GPU task is used.

Fourth pass: `naval-v4/` replaces combat reports, structural tails, thrust beds,
panel latches/warnings and all six score stems. Original procedural components
are **CC0-1.0**. Brian MacIntosh / BMacZero's real metal impacts are **CC0-1.0**:
https://opengameart.org/content/metal-impact-sounds. Hinchinbrook's Metallic
Groan (official public HQ preview, processed) is **CC0-1.0**:
https://freesound.org/people/hinchinbrook/sounds/496836/.

Real powered hammer, diesel tank, vehicle metal stress and deep explosions
come from the **Sonniss GDC 2020 GameAudio Bundle**. Their original authors
are recorded per source in `naval-v4/sources.json`; these recordings and their
processed derivatives are **not CC0**. The applicable **Sonniss GDC Bundle
EULA v2.0**, downloaded 10 October 2026, permits modification and commercial
finished-game use without attribution: https://sonniss.com/gdc-bundle-license/.
They remain licensed material: no standalone sample-pack redistribution or
AI training/development. Only processed game cues ship; raw packs stay on G:.
The per-file manifest records component provenance and SHA-256 hashes.
`tools/generate-audio-v4.py` reproduces the processing from those raw files.
No television, film or game recording/composition was sampled or copied.

Fifth pass: `naval-v5/` contains six shorter PDC phrases derived only from the
shipped `naval-v4/pdc-*.ogg` performances. It preserves the licensed powered
hammer and CC0 casing layers, reshapes their articulation and finite release,
and introduces no new recordings. These derivatives retain the mixed CC0 /
Sonniss licences above; they are not wholly CC0. `naval-v5/sources.json` records
source-file hashes, recording authors/licences and resulting asset hashes.
`tools/generate-audio-v5.py` reproduces them directly from the committed v4
assets without raw packs, intermediate renders or external downloads.

Sixth pass: `naval-v6/` adds eight performances for each of twenty combat
families, including separate missile/torpedo launch and burn, armour, breach,
interception, ship/reactor explosions and venting. All derive from committed
v4/v5 cues and retain their original mixed CC0/Sonniss licence. No new raw
recordings or downloads are used. Each family varies its actual recorded
layer choices; short PDC accents are baked into one source to avoid stacking.
`naval-v6/sources.json` lists per-performance layer selection, timing, source
hashes, recording authors/licences and resulting hashes. The generator writes
only compressed Ogg game cues, with no intermediate media.

Seventh pass: `naval-v7/` adds eight cold-ejection and eight ignition reports
for each of light swarm, standard missile and heavy torpedo, plus eight swarm
drive-loop textures. These56 compressed performances derive only from the
committed licensed v4/v5 cues above. No new recording, download or raw render
is needed. `naval-v7/sources.json` retains original recording authors/licences
and complete derivation parameters/hashes; mixed Sonniss layers remain
licensed derivatives, not CC0. `tools/generate-audio-v7.py` reproduces them.
