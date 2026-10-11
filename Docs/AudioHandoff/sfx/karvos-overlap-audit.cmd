@echo off
cd /d "C:\Users\Aidan Anderson\karvos"
git diff main..audio/v1 --name-only > G:\sfx\karvos-audio-branch-files.txt
git -c core.safecrlf=false diff --name-only -- src/audio-mixer.js src/audio-scene.js src/enemy-audio.js src/field-audio.js src/hud.js src/main.js src/play-preferences.js src/rock-cutter.js src/session-menu.js src/survival.js public/audio/bank.json scripts/test-audio-mixer.mjs scripts/test-audio-v1.mjs scripts/build-audio-v1.py
git -c core.safecrlf=false diff --cached --name-only
