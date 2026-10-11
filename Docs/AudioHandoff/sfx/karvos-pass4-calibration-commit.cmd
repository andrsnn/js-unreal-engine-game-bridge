@echo off
cd /d G:\sfx\karvos
git diff --stat
git add src/audio-physical.js src/audio-mixer.js src/field-audio.js scripts/test-audio-v4.mjs AUDIO-UNREAL.md PLAY.md
git commit -m "Calibrate sustained field sound against real ride capture"
if errorlevel 1 exit /b 1
git rev-parse HEAD
git status --short
