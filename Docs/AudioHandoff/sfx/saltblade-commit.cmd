@echo off
git -C "C:\Users\Aidan Anderson\saltblade" rev-parse HEAD
git -C G:\sfx\saltblade merge --no-edit main
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade add src/platform/audio.ts src/platform/web.ts tests/audio.test.ts AUDIO.md PLAY.md
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade diff --cached --stat
git -C G:\sfx\saltblade commit -m "Give Salt Blade distinct physical cues and reliable sound controls"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade rev-parse HEAD
git -C G:\sfx\saltblade status --short -- src tests PLAY.md AUDIO.md
