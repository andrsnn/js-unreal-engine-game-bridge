@echo off
cd /d G:\sfx\karvos
git add src/fabricator-ui.js src/audio-mixer.js scripts/test-audio-v1.mjs
git diff --cached --check
if errorlevel 1 exit /b 1
git commit -m "Route fabrication sound through existing success cue"
git log -1 --format=%%H
