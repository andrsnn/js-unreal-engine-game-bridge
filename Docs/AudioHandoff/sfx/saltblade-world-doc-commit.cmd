@echo off
git -C G:\sfx\saltblade add PLAY.md
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade diff --cached --name-only
git -C G:\sfx\saltblade commit -m "Explain Salt Reach audio controls and stealth feedback"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade rev-parse HEAD
git -C G:\sfx\saltblade diff open-world...HEAD --stat
git -C G:\sfx\saltblade status --short -- PLAY.md src/world/audio.ts src/world/app.ts tests/world-audio.test.ts
