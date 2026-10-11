@echo off
git -C G:\sfx\saltblade rev-parse HEAD
git -C G:\sfx\saltblade status --short -- src/world src/platform/audio.ts tests/world-audio.test.ts tests/audio.test.ts PLAY.md
git -C "C:\Users\Aidan Anderson\saltblade" rev-parse HEAD
git -c core.autocrlf=true -C "C:\Users\Aidan Anderson\saltblade" diff --name-only -- src/world
