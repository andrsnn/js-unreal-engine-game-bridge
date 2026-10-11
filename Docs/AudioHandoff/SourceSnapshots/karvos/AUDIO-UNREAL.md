# Physical audio pass four handoff

`public/audio/bank.json` is the browser's authoritative bank. The external import
manifest is `G:/sfx/karvos-unreal-audio-v4.json`; regenerate it with
`scripts/build-unreal-audio-manifest.mjs <output> <sourceCommit>`. The manifest
includes absolute OGG paths, buses, attenuation distances, loop flags and mixed
licenses. Distances use browser metres; the bridge owner converts to centimetres.
No bridge code is changed by this audio pass.

The following case-sensitive cues are the normal gameplay events:

| Event | Bank key | Bus / layers |
| --- | --- | --- |
| Rifle, battle rifle, pistol, shotgun | `rifle`, `heavy`, `pistol`, `shotgun` | weapons; lower-gain punch body and environment tail |
| Energy weapon, rocket | `energy`, `rocket` | weapons; punch body and environment tail |
| Explosion, metal/rock contact | `explosion`, `impactMetal`, `impactRock` | explosions / impacts |
| Gun reflection | `tailOpen`, `tailCanyon`, `tailRoom` | reflections; open versus canyon versus shelter |
| Reload | `reloadStart`, `reloadEnd`, `reloadLatch` | foley; latch follows start by 90 ms / end by 15 ms |
| Bike ignition / shutoff | `bikeStart`, `bikeStop` | engines; 5–65 m |
| Building / paid crafting | `build`, `craft` | foley; existing crafting confirm also plays craft |
| Habitat steps | `stepMetal` | foley; rock/sand/mud/snow retain their recorded surface banks |
| Gust / distant thunder | `thunder` | ambience; stronger lowpass in shelter |
| UI select / accept | `uiSelect`, `uiAccept` | UI; exact aliases `click` / `confirm` resolve these |

Creature keys consist of the family `voiceBrute`, `voiceStalker`, `voiceFlyer`,
`voiceDrone` or `voiceRaider`, followed by the reaction suffix. Idle/chitter has
no suffix; warning and charge use `Threat`, attack uses `Attack`, injury uses
`Pain`, death uses `Fall`. Each family/reaction has three shuffled variants.
Size scales pitch by roughly `1 / sqrt(size)` within 0.6–1.3. Creature attenuation
uses 3–95 m. Death/charge/warning/attack priorities are 90/85/80/75; idle is 15.
Human weapon attacks use gun cues rather than `voiceRaiderAttack`.

Persistent loop instance names are distinct from bank keys:

| Instance | Bank key | Runtime behavior |
| --- | --- | --- |
| `wind` | `wind` | calm wind; lowpass and gain decrease in shelter |
| `front` | `storm` | moving storm-front proximity; zero when absent or paused |
| `biome` | `wind`, `ocean`, `bio`, `volcano` | planet-dependent bed, replaces source on travel |
| `bike` | `engine` | thrust/speed gain, 0.78–1.12 pitch, 650–2550 Hz lowpass |
| `bike-turbine` | `hover` | second rotor/air layer, 0.86–1.24 pitch |
| `ship` | `engine` | dropship position, 12–160 m, pitch 0.58 |
| `cutter` | `cutter` | gain only while cutting |
| `seismic` | `rumble` | predator warning/emergence proximity |
| `score-bed` / `score-pulse` / `score-drums` | `scoreBed` / `scorePulse` / `scoreDrums` | shared phase clock, 48 seconds / 80 BPM |
| `score-motif` / `score-strings` | `scoreMotif` / `scoreStrings` | same phase clock; 96 / 48 second phrases |

Loops start once, update gain/pitch/pan/filter using smoothed parameters, and
replace their source when the bank key changes. The score's five stems join at
the elapsed shared-clock offset rather than restarting their phrase. Travel,
shelter, storms and combat change arrangement; danger holds for nine seconds.
Pausing or dying zeros gameplay buses/loop targets and reflection sends. Master,
Combat, Environment, Foley and Music remain independently persisted; every wet
return passes through master. Browser focus loss also silences master.

Keep the native mix bounded as the browser does: 40 one-shot voices total,
10 primary gun voices, six creature voices, lower-priority voices replaced for
urgent reactions. At the gun limit a new attack replaces the oldest equal-priority
tail. The source bus levels are weapons 0.88, impacts 0.46, explosions 0.66,
engines 0.72, ambience 0.42, foley 0.46, creatures 0.48, UI 0.26, alerts 0.32,
music 0.42, reflections 0.32. Combat ducks music to 40%; alert and category
preferences still apply. A 24 Hz subsonic filter preserves the 30–90 Hz recoil;
4.5:1 compression and a transparent quiet-range soft ceiling provide headroom.

Recorded metal, hammer, air, tank, creak, ring/slide and explosion layers carry
the Sonniss GDC Bundle EULA v2.0. They are not CC0. Original synthesis, creature
vocal folds, score composition and Brian MacIntosh metal contacts are CC0.
Exact component authors, URLs and hashes are in
`public/audio/licenses/Karvos-physical-v4.json` and its concise text credit.

Source calibration after the first genuine v4 capture raises the sustained drive, rotor air and environmental beds relative to weapon attacks. Engine loop source gain follows 0.58–1.0, turbine 0.18–0.52; their engine bus is 0.72. The 24 Hz high-pass precedes a −12 dB threshold, 8 dB knee, 3.5:1 compressor (12 ms attack, 220 ms release), with 1.35 recovery before the unchanged bounded output transfer. This gain belongs to real gameplay and the post-master tap; no capture-only gain is applied.

Final post-ceiling output gain is 0.72 (about −2.1 dB from the previous 0.92), calibrated from the actual sand-field fight. Relative bus/engine/attack levels remain as above. Runtime audioMixStatus.outputGain exposes this value; both audible output and recordingStream pass through it.

Pass five separates the exact `weaponCycle` event from `reloadEnd`. It reuses the licensed `reloadLatch` files as a quiet 110 ms mechanism slice: weapons bus, gain .055 (.075 for shotgun), lowpass1800Hz, priority35,45ms delay (85ms shotgun),25ms fade before cutoff. This layer cannot steal primary gun attacks or shorten their music-duck interval. Native canonical cue and alias sets remain unchanged. `mixerParity.eventControls.weaponCycle` describes the host event using existing `reloadLatch`; browser diagnostic counts call this event `weaponCycle`. The same handoff includes output, compression and bus parity. `reloadStart` and `reloadEnd` remain genuine magazine events on foley, each layering the full physical `reloadLatch`; energy and melee have no cartridge-cycle cue. No new audio files.
