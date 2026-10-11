September11 feedback revision: `refined/` contains39 edited surface contacts and layered space-weapon variants. Footfalls are short filtered transients from our generated SA3 recordings. Space layers use the existing CC0 firearm/reload library and Kenney Sci-fi Sounds credited below. See tools/refine-feedback-audio.mjs and reports/readability-repair/audio-assets.json for cuts, sources and bounded levels. These are edited recordings, not newly generated AI takes.

# Audio sources

## Audio pass five: cutter release

Runtime envelope/pitch changes separate the cutter rotor wind-down from contact
release; the same physical-v4 recordings and their licences below remain in use.
No new recorded assets were added.

## Audio pass four: physical-v4

The shipped `physical-v4/*.ogg` are edited/layered recordings, with exact cuts,
source hashes, filters and output hashes in `physical-v4/edits.json`. Raw packs
remain outside the game at G:/sfx/raw-packs. `tools/prepare-physical-pass4.mjs`
reproduces these edits. Source licences continue to apply to the edited audio:

- Sonniss GDC 2020 free bundle: Pole Position, The Junkyard Metal Library and
  The Ironwork Machinery Library; Coll Anderson, Metal Movement; Stefano Cremona,
  Explosions. Royalty-free commercial game use/modification, no attribution required;
  this is **not CC0**. Downloaded 2026-10-10 under the current GDC bundle licence v2:
  https://sonniss.com/gdc-bundle-license/ . Primary collection:
  https://sonniss.com/gameaudiogdc/ . Every selected file matches the official GDC
  2020 tracklist linked there. No standalone sample-pack redistribution or AI
  training/development. Recordings provide boost/hull stress, drive pressure,
  metallic mechanisms, gun body and rockfall/blast tails.
- Michael Brigida and students: 12 Ambient Machine Sounds, selected/prepared for
  OLPC by Dr. Richard Boulanger, recorded in Berklee Studios and around Boston by
  Music Synthesis students; original editing/trimming by Diane Douglas and Colman
  O'Reilly. CC-BY 3.0, https://creativecommons.org/licenses/by/3.0/ . Source:
  https://opengameart.org/content/12-ambient-machine-sounds . `Engine noise.wav`,
  `dryer1.wav`, `debris_1.wav` are cropped, filtered, levelled, loop-spliced and
  layered with authored drive/rotor/sub-pressure sound design here. These provide
  drive-core, cutter-rotor/contact and rock-chip variations.
- BMacZero: Metal Impact Sounds, `thud3.wav`, CC0 1.0. Source:
  https://opengameart.org/content/metal-impact-sounds . Cropped/filtered/levelled
  for metal-hit-2. https://creativecommons.org/publicdomain/zero/1.0/ .

Original authored harmonic/body layers and runtime synthesis are dedicated under
CC0-1.0. That dedication covers our authored work only; all modified recordings
above retain their own source licences. Native gun identities, human/creature
voices, score, narration and their existing provenance remain credited below.

## Audio pass three

Original human breath/formant, mechanical failure and creature hurt/attack/death
layers in `encounterAudio.ts` have four independently authored procedural takes
per family and reaction. Licensed recorded human voices remain the primary layer.
The new warm harmonic texture and sparse exploration motif in `motionAudio.ts`
are original compositions with world transposition and four-phrase variation.
These new authored layers are dedicated to the public domain under CC0-1.0:
https://creativecommons.org/publicdomain/zero/1.0/ . No external recordings or
model-generated assets were added. Existing briefing Ogg provenance is unchanged;
its media now plays through the game master, mute and limiter graph.

## Audio pass two

Original runtime synthesis in `src/core/encounterAudio.ts` adds four independent
takes per creature family and state (growls, insect stridulation, filtered robot
commands without speech), plus small alternating UI contacts. Original stereo
reflection/noise impulse responses in `src/core/acousticSpace.ts` provide cave
and outdoor reverberation; neither uses recordings or downloaded impulse files.
These new authored sounds are dedicated to the public domain under CC0-1.0:
https://creativecommons.org/publicdomain/zero/1.0/ .
Source buffers are bounded and generated locally in WebAudio; existing asset
licenses remain intact. No external AI generation or copyrighted game/film audio.

## October 9 audio/v1 motion and adaptive score

`src/core/motionAudio.ts` contains original procedural sound design created for
Unlit Worlds: engine ignition and boost pressure, throttle air/machinery wash,
quiet ship cabin ventilation, cutter spindle/contact grit, varied rock chips
and collapse debris, and a four-bar combat percussion layer. These are generated
directly into bounded WebAudio buffers; no external recordings, samples, model
outputs, copyrighted game or film audio, or additional downloaded assets are used.
The implementation is dedicated to the public domain under CC0-1.0:
https://creativecommons.org/publicdomain/zero/1.0/ .

Existing compressed Ogg recordings and streamed music retain the credits and
licenses below. The recorded ship and weapon identities remain in the mix. The
new percussion follows the music volume and ducking path; machinery, ambience
and rock contacts follow their respective mixer channels. Runtime source:
`src/core/motionAudio.ts`; validation: `tools/test-audio-v1.mjs`.

The primary gun, ship-weapon, missile, explosion, armor-hit and ballistic-reload
bank is now `physical-v1/`: 67 edited CC0 recording-based effects. Firearm reports
come from the Free Firearm Sound Library; reload actions from SpringySpringo;
launch motors, blast debris and metal contacts from Kenney, credited below.
Four recorded variations per weapon cycle independently of footsteps and impacts.
Low-mid pressure and quiet mechanical layers are baked into each mono file.
There are no Expanse recordings or extracted show assets. The tonal reference is
physical machinery and ballistic reports, not synthesized pitched laser chirps.
Edits and source cut positions: `tools/prepare-physical-weapons.mjs` and
`reports/physical-audio/assets.json`. `combat-preview.ogg` is a captured game-audio
test sequence. Music and environmental ambience are unchanged in this revision.

Other effects still use `production/`; older `sa3/`, `context/`, `refined/` and
root recordings remain fallbacks. Their original credits and licenses apply.

Additional space weapons, metal impact, interaction sounds and engine recordings:
Sci-fi Sounds 1.0 by Kenney, CC0. https://kenney.nl/assets/sci-fi-sounds
Files are normalized/faded; engine loops use a 150ms overlap at the seam.
Selections: tools/prepare-scifi-audio.mjs and reports/scifi-audio-assets.json.

Ballistic recordings (rifle, SMG, LMG, pistol, shotgun, sniper): The Free Firearm
Sound Library by Ben Jaszczak, Brian Nelson, Kevin Heras and Matthew Nanney.
Source and CC0 license declaration: https://opengameart.org/content/the-free-firearm-sound-library

Reload eject, insert and bolt recordings: Gun Reload Sounds by SpringySpringo.
Source and CC0 license declaration: https://opengameart.org/content/gun-reload-sounds

Modified for Unlit Worlds: individual shots selected, converted to mono, trimmed,
normalized, faded and encoded as Ogg Vorbis. Source selections and cuts are recorded
in tools/prepare-audio-assets.mjs and reports/audio-overhaul/recorded-assets.json.

Procedural weapon and engine voices remain a final fallback if recordings cannot
load. The later generated music/effect revisions and their provenance follow.
# Contextual synthwave and new gun recordings — September 11, 2026

`context/*.ogg`: generated locally with Stability AI Stable Audio 3 `small-music` (12 instrumental location/combat themes) and `small-sfx` (five arrival cues, 20 weapon takes). Generation uses reproducible seeds and eight inference steps. Production edits trim reports, control tails, normalize levels with codec headroom and crossfade music loop boundaries. Prompts, seeds and file hashes: `reports/context-audio/assets.json`; generator: `tools/generate-context-audio.py`.

## ACE B production bank — September 11, 2026

`production/*.ogg`: twelve ACE-Step 1.5 XL SFT location/combat scores and 99 Stable Audio 3 Medium effects/arrival cues. Space exploration is conditioned on the approved original ACE B audition. Music receives broad low-mid EQ, level adjustment and a loop-boundary crossfade. Effects are edited into bounded mono one-shots and smooth machinery loops. Existing environmental ambience is preserved.

Exact model settings, prompts, seeds, batch indices, processing and SHA-256 hashes: `reports/context-audio/production-music.json` and `production-sfx.json`. Sources: https://huggingface.co/ACE-Step/acestep-v15-xl-sft and https://huggingface.co/stabilityai/stable-audio-3-medium. The model licenses apply to their weights; original fallback recording credits above remain intact.

## September 12 revisions

Dungeon exploration: The Stone Remembers, original instrumental generated locally with ACE-Step v1.5 XL SFT. Three-second loop overlap and exploration loudness normalization. Brief and provenance: reports/combat-introduction/dungeon-music.json.

New-game briefing: original game text, synthesized locally with Microsoft Windows Speech (David). Recorded narration with matching on-screen transcript, replay, mute support and skip.

## Human reactions

`reactions-v1/humanHurt-*.ogg` and `reactions-v1/humanDeath-*.ogg`: HaelDB, Male grunt/yelling sounds, offered under CC0. Source: https://opengameart.org/content/male-gruntyelling-sounds . Edited with silence trimming, band limiting, mono conversion and loudness normalization. Source take names and output hashes are recorded in reports/piracy/combat-audio/assets.json.

## October 4 field Foley and mixer

`field-v2/`: four layered variations per frequent UI, mechanical, footstep, impact, debris and warning sound, plus four engine loops. Every output's source filenames, edit and licence are listed in [field-v2/sources.json](field-v2/sources.json). All source recordings are CC0-1.0:

- Kenney Interface Sounds: https://kenney.nl/assets/interface-sounds
- Kenney Impact Sounds: https://kenney.nl/assets/impact-sounds
- Kenney Sci-fi Sounds: https://kenney.nl/assets/sci-fi-sounds
- Free Firearm Sound Library and SpringySpringo Gun Reload Sounds, credited above.

Baked with `tools/assets/prepare-field-audio.mjs`: mono 48 kHz, short tactile attacks, filtered pressure/debris/mechanism layers, fades and codec headroom; engine loops crossfade. No new model-generated material. Existing ambient recordings and music retain their original credits. Runtime varies takes, pitch and level, applies distance filtering, and exposes independent weapon, impact, engine, ambience, UI and alert levels.
