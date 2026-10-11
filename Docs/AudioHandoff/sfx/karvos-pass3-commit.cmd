@echo off
cd /d G:\sfx\karvos
git add PLAY.md src/audio-mixer.js src/audio-voices.js src/audio-reverb.js src/audio-scene.js src/enemy-audio.js src/field-audio.js src/session-menu.js public/audio/bank.json public/audio/v3-*.ogg public/audio/licenses/Karvos-original-v3.txt scripts/build-audio-v3.py scripts/test-audio-v3.mjs scripts/test-audio-mixer.mjs scripts/test-audio-v1.mjs scripts/test-audio-v2.mjs
git diff --cached --check
if errorlevel 1 exit /b 1
git diff --cached --stat
git commit -m "Complete pass three reactive field soundscape"
if errorlevel 1 exit /b 1
git rev-parse HEAD
git status --short
