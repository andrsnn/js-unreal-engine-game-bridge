@echo off
git -C G:\sfx\saltblade add -- src/world/audio.ts tests/world-audio.test.ts
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade -c user.name="Saltblade Builder" -c user.email="builder@saltblade.local" commit -m "Cover committed camp construction and denied placement cues"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade rev-parse HEAD
git -C G:\sfx\saltblade status --short -- src tests PLAY.md
git -C G:\sfx\saltblade diff --ignore-space-at-eol --name-only open-world HEAD -- src tests PLAY.md
