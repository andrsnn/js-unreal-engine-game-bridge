@echo off
cd /d G:\sfx\karvos
git add src/audio-mixer.js src/audio-weapon-cues.js src/combat.js public/audio/bank.json scripts/build-unreal-audio-manifest.mjs scripts/test-audio-v3.mjs scripts/test-audio-v4.mjs scripts/test-audio-v5.mjs AUDIO-UNREAL.md PLAY.md
git commit -m "Separate short weapon cycling from full magazine reload cues"
if errorlevel 1 exit /b 1
git rev-parse HEAD
git status --short
git show --stat --oneline HEAD
