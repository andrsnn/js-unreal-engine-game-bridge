@echo off
git -C G:\sfx\saltblade add -- src/world/audio.ts tests/world-audio.test.ts
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade -c user.name="Saltblade Builder" -c user.email="builder@saltblade.local" commit -m "Shape desert wind and extend real giant distance tails"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade rev-parse HEAD
