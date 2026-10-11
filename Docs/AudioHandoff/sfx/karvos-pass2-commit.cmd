@echo off
cd /d G:\sfx\karvos
git add src/audio-mixer.js src/audio-reverb.js src/audio-scene.js src/enemy-audio.js public/audio/bank.json public/audio/v2-*.ogg public/audio/licenses/Karvos-original-v2.txt scripts/build-audio-v2.py scripts/test-audio-mixer.mjs scripts/test-audio-v1.mjs scripts/test-audio-v2.mjs
git diff --cached --check
if errorlevel 1 exit /b 1
git commit -m "Add acoustic spaces and richer field audio for pass two"
git log -1 --format=%%H
git status --short -- src public/audio scripts
