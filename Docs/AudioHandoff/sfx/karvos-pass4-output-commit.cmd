@echo off
cd /d G:\sfx\karvos
git add src/audio-physical.js src/audio-mixer.js AUDIO-UNREAL.md
git commit -m "Set final field mix output from measured native combat"
if errorlevel 1 exit /b 1
git rev-parse HEAD
git status --short
