@echo off
cd /d G:\sfx\karvos
git add public/audio/bank.json public/audio/v1-*.ogg public/audio/licenses/Karvos-original-v1.txt scripts/build-audio-v1.py scripts/test-audio-v1.mjs scripts/test-audio-mixer.mjs src/audio-mixer.js src/audio-scene.js src/enemy-audio.js src/fabricator-ui.js src/field-audio.js src/hud.js src/main.js src/play-preferences.js src/rock-cutter.js src/session-menu.js src/survival.js
git diff --cached --check
if errorlevel 1 exit /b 1
git commit -m "Add adaptive frontier score and layered field soundscape"
git log -1 --format=%%H
