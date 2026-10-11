JS Game Bridge audio import (Unreal 5.8)

Run on Windows:
  run-audio-import.cmd G:\JsGameBridge\Registry\audio-cues-v4.json import
  run-audio-import.cmd G:\JsGameBridge\Registry\audio-cues-v4.json verify

The launcher uses an isolated content-only project with a content-only plugin
mount named JsGameBridge. Its Content junction targets G:/JsGameBridge/Content.
It does not load the real bridge native module, Puerts or any active game project.
UnrealEditor-Cmd uses -nullrhi -nosound -unattended; no interactive editor window,
GPU rendering, native build, game rebuild or packaging is requested.

Manifest version 1: games.<game>.cues.<eventKey> has sound (package OR full object
path under /JsGameBridge/Audio), variants[{source:absolute Windows path, wave:
package OR full object path, sha256:source byte SHA256}], loop:boolean, spatial:
boolean, bus, maxDistance. maxDistance/minDistance are Unreal centimeters,
minDistance defaults to 10 percent max. Maximum 32 variants per cue, no silent
branch culling. Multiple variants use the official SoundCueFactoryNew Random
node and WavePlayers, without replacement. Single variant uses a direct
WavePlayer. All loop flags match; all wave/cue pitch and volume are unity.
No Modulator is created, keeping phase-aligned score stems at native tempo.
Optional soundClass is an existing class object path, otherwise runtime bridge
registry owns category routing. Licence/sourceManifest/provenance/other fields
are preserved verbatim in cue metadata. Registry keys are unchanged.

OGG sources decode to stereo 48 kHz 16-bit PCM WAV under pcm/<source hash>.wav.
Raw source bytes must match the manifest hash before any content is changed.
Same owned hash skips wave import and cue recreation; every run still verifies
loops, unity gain/pitch, spatial flags, saved wave references, 48000 Hz and package
dependencies required by a cook. Generated assets store owner/source/cue hashes.
Foreign existing assets cause an error, not an overwrite. A changed owned cue
is recreated through the official factory so visual and runtime graphs agree.
No broad directory deletion, stale-asset pruning or automatic game packaging.

Reports are reports/<manifest-name>-<import|verify>.json and corresponding engine
logs. A fresh verify commandlet proves disk reload independently of import.
Import repeat proves no-op idempotency. Launcher returns failure on either
engine error or receipt.ok=false. Do not run two imports of one catalog together.
The ImporterSmoke rail/drive assets are development smoke content only and are
not registered as gameplay events.

Final v4 acceptance (10 October 2026)

The three-game catalog imported 507 actual SoundWave packages and 191 SoundCue
packages in shared Content/Audio. A second Unreal process loaded all 191 cues
and 530 saved variant references, checked 35 loops and 159 positional cues,
verified 48 kHz wave format, unity pitch/gain, attenuation ranges, complete
licence/source metadata and every cue-to-wave package dependency. No errors.
Karvos 92 canonical cues + 13 aliases, Unlit 62 + 23, Hard Burn 37 + 22 yield 249
registered keys. Aliases resolve to the existing canonical package, not extra
SoundCues. Seven ImporterSmoke assets are excluded from the gameplay registry.
See reports/audio-cues-v4-acceptance.json and independent import/verify receipts.

This proves native Unreal asset save/load and SoundCue graph acceptance. It
does not claim playback inside a rebuilt native game; no game build, cook or
package was requested. The importer never edits existing native bridge files.
Cue-to-wave cook dependencies are saved and checked, but a registry JSON alone
is not a cooker root. The integrating project must include /JsGameBridge/Audio
through its Asset Manager or cook-directory configuration. Runtime class/bus
controls, per-event gain and mix metadata remain the native adapter's job;
imported cues retain unity gain and pitch. Global sourceCommit/runtime gain
metadata changes do not alter cue/sample fingerprints or trigger reimports.

Loop-use contract

Spawn a loop once per live emitter, retain its AudioComponent, update its gain
and position, then stop/fade it when the source ends. Do not call Play every
frame. PLAY_WHEN_SILENT keeps virtualized loops advancing. Random variants are
selected without replacement on component starts; score stems have no pitch
randomization. Start phase-aligned score stems on the same audio clock and
retain their components; fade stem levels to change intensity. Use 2D playback
for spatial:false UI/music and attached/location playback for spatial:true.
Distances in the final import catalog are already Unreal centimeters.

The verified smoke repeat skipped all 5 waves and 2 cues without modifying any
package bytes. Final metadata-only runtime gain updates need only registry
updates, not another asset import. Authoritative licence/source documents are
retained in Registry/audio-cues-v4.json and original sourceManifest files;
licence data is also preserved in saved asset editor metadata.

Pass five handoff (10 October 2026)

Registry/audio-cues-v5.json keeps all191 canonical cue keys and58 aliases.
The per-game *-sounds.json maps retain those249 exact keys, now with audioPass5,
sourceCommit, mix and eventControls (plus explicit Karvos mixerParity). The
runtime JavaScript game registries already match all sound object paths and
keep newer owner graphics/VFX fields. No native module build was performed.

The incremental import added six short PDC SoundWaves, updated the PDC cue and
two cutter control metadata records, and skipped503 waves/188 cues. A fresh
UE5.8.2 process loaded all191 cues with532 variant references,509 current waves,
35 loops and159 positional cues. See reports/audio-cues-v5-acceptance.json and
the separate import/verify JSON/logs. Older wave assets and all
v4 evidence/deliverables remain preserved; three existing cue packages were refreshed; obsolete raw intermediates are
removed after acceptance. Loop/cook responsibilities above still apply.

Host parity details: Hard Burn mix.outputGain=.69 with PDC voice/priority
policy; Karvos mix.outputGain=.72 and eventControls.weaponCycle uses existing
reloadLatch with a110ms filtered quiet slice, separate from magazine reloads;
Unlit eventControls['cutter:stop'].perCue preserves rotor deceleration while
contact clears at35ms. Per-event stop/filter/envelope controls are runtime
requirements; cue assets retain unity gain/pitch and source tempo.

Pass six Hard Burn (10 October 2026)

Registry/audio-cues-v6.json keeps every prior event key/object path, adds eight canonical Hard Burn banks and five aliases (hull-breach, vent, explosion-reactor, coilgun, autocannon), and leaves Karvos/Unlit at pass5. Hard Burn has45 canonical cues/27 aliases/218 references. Shared total199 cues/262keys/649 references/618 current waves,36 loops/167 positional cues. Incremental import added160 waves and refreshed21 owned cues; fresh UE5.8.2 verification passed all199 graphs without errors. No game/native module build/cook/package or native gameplay acceptance is claimed. Final sourceCommit and corrected host eventControls are JSON-only metadata; final-metadata receipt bridges the frozen imported/verified manifest to current catalog with all cue definitions unchanged.

Per-event ±4% pitch, gain/filter/offset, size and distance, baked layer choice and no-immediate-repeat bag boundary are explicit eventControls/mix host requirements. SoundCue random bags remain random-without-replacement; hosts retain last choice across bag refill for strict no-repeat, plus all engine/motor lifecycle, pause/map/mute/master/bus and adaptive score controls. Never fire-and-forget the looping motors. PCM cache was removed after verification; final cue/wave assets and all reports remain.

Missile phase pass seven (10 October 2026)

Registry/audio-cues-v7.json preserves priorkeys/paths and adds eight takes each for swarm/standard-missile/torpedo cold and ignition, plus swarm-burn. HardBurn52cues/33aliases/274references; shared206cues/275registeredkeys/705references/674waves/37loops/174positionalcues. Incremental56waves/7newcues saved and independently reloaded in freshUE5.8.2 process, zeroerrors. Current sourceCommit2112f18 and all host phase/bed control metadata are in pergame registry; frozen import/verify SHA and finalmetadata bridge retained. Native host must call phaseCold/phaseIgnition once per actual projectile generation, defer mount launch reports, keep up to2 individualmotors plus ONE density bed and bounded6 phaseattacks/3ignitionvoices, and stop on coast/map/pause/done/remote. Existing .69output/gunmix unchanged. Assets retainunity gain/pitch; runtime applies metadata. No game/native rebuild, native gameplay, cook or packaged acceptance performed.

Dark-missile host timing correction (same v7 assets): source3ff7dec68f14ef9ead6fc249558f86288d90cad7. Consume strict motorActive===true every render/game update, not the100ms score tick. Powered attack12ms; cancel pending gain automation then fade4ms/stop18ms at coast/done/reuse/map/pause/remote. Tie initial ignition voice to projectile+guidedGeneration and stop it on the same actual powered-state gates. Corrections and heavy terminal burn resume bounded motors without replaying cold/initial ignition. Swarm centroid/density counts only genuinely burning bodies; unknown state is silent. Finite hull-conduction response<=0.32s may decay after dry source stops. All cue definitions/aliases/source hashes unchanged; updated final-metadata proof bridges current host JSON to prior independent UE asset verification. No repeated engine import/build/cook. Actual native gameplay acceptance remains host responsibility.
