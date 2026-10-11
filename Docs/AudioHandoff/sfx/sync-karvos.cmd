@echo off
git -C "G:/sfx/karvos" merge --no-edit main
if errorlevel 1 exit /b 1
git -C "C:/Users/Aidan Anderson/karvos" diff --name-only -- src/main.js src/audio-mixer.js src/field-audio.js src/audio-scene.js src/play-preferences.js src/session-menu.js
