# Crew briefing recordings

Generated locally on 2026-09-12 using the installed Higgs Audio v3 4B TTS model through the existing ltx-director / ComfyUI workflow. The initial voice was generated with cast mode, seed 37; subsequent clips used that generated reference, seeds 38 and 39. No real person's reference recording was supplied.

Scripts/transcripts are the three INTRO_BEATS in src/ui/openingPresentation.ts. Original WAV candidates were normalized to -18 LUFS with a -2 dBTP target and encoded as Vorbis quality 5. The filenames are versioned to avoid stale cached narration. Runtime uses one disposable audio element, obeys master mute/volume, and lowers background music during the briefing. Players can disable voice, continue at any point or skip.

Technical validation covers decoding, duration, asset availability and UI playback failure recovery. It does not certify subjective voice quality.
