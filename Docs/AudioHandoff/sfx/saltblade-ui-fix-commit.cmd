@echo off
git -C "C:\Users\Aidan Anderson\saltblade" rev-parse HEAD
git -C G:\sfx\saltblade diff --stat
git -C G:\sfx\saltblade add src/platform/audio.ts tests/audio.test.ts
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade diff --cached --name-only
git -C G:\sfx\saltblade commit -m "Keep title sound control accessible outside styled actions"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade rev-parse HEAD
git -C G:\sfx\saltblade diff main...HEAD --stat
git -C G:\sfx\saltblade status --short -- src/platform/audio.ts tests/audio.test.ts PLAY.md
