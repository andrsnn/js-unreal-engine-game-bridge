@echo off
cd /d G:\sfx\saltblade
node --import tsx --test tests/audio.test.ts
if errorlevel 1 exit /b 1
node node_modules/typescript/bin/tsc --noEmit
