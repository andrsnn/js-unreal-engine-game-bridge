@echo off
git -C "C:\Users\Aidan Anderson\saltblade" rev-parse HEAD
git -C G:\sfx\saltblade diff --stat -- src/world/app.ts src/world/audio.ts tests/world-audio.test.ts
git -C G:\sfx\saltblade add src/world/audio.ts src/world/app.ts tests/world-audio.test.ts
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade diff --cached --name-only
git -C G:\sfx\saltblade commit -m "Add physical state-driven sound to the Salt Reach"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade rev-parse HEAD
git -C G:\sfx\saltblade diff open-world...HEAD --stat
git -C G:\sfx\saltblade status --short -- src/world/app.ts src/world/audio.ts tests/world-audio.test.ts
