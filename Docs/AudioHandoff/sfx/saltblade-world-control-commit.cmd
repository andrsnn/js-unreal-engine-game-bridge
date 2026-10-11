@echo off
git -C "C:\Users\Aidan Anderson\saltblade" rev-parse HEAD
git -C G:\sfx\saltblade add src/world/app.ts PLAY.md
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade diff --cached --name-only
git -C G:\sfx\saltblade commit -m "Keep world sound control clear of the biome title"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade rev-parse HEAD
git -C G:\sfx\saltblade diff open-world...HEAD --stat
git -C G:\sfx\saltblade status --short -- PLAY.md src/world/app.ts src/world/audio.ts
