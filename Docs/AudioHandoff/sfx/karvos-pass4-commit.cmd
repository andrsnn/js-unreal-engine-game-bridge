@echo off
cd /d G:\sfx\karvos
git add PLAY.md AUDIO-UNREAL.md src/audio-mixer.js src/audio-physical.js src/audio-voices.js src/audio-scene.js src/enemy-audio.js src/field-audio.js public/audio/bank.json public/audio/v4-*.ogg public/audio/licenses/Karvos-physical-v4.json public/audio/licenses/Karvos-physical-v4.txt scripts/build-audio-v4.py scripts/build-unreal-audio-manifest.mjs scripts/test-audio-v4.mjs scripts/test-audio-mixer.mjs scripts/test-audio-v1.mjs scripts/test-audio-v2.mjs scripts/test-audio-v3.mjs
git diff --cached --check
if errorlevel 1 exit /b 1
git commit -m "Give field weapons and vehicles recorded physical weight"
if errorlevel 1 exit /b 1
git rev-parse HEAD
git status --short --untracked-files=no
