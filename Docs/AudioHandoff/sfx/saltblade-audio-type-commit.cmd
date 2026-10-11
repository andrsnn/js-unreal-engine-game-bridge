@echo off
git -C G:\sfx\saltblade add -- src/world/audio.ts
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade -c user.name="Saltblade Builder" -c user.email="builder@saltblade.local" commit -m "Keep combat audio position adapter independent of gameplay FX types"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade rev-parse HEAD
git -C G:\sfx\saltblade diff --name-only open-world HEAD -- src tests PLAY.md
git -C G:\sfx\saltblade status --short -- src tests PLAY.md
