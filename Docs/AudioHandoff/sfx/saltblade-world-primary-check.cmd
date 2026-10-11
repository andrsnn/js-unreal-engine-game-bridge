@echo off
git -C "C:\Users\Aidan Anderson\saltblade" rev-parse HEAD
git -C "C:\Users\Aidan Anderson\saltblade" branch --show-current
git -c core.autocrlf=true -C "C:\Users\Aidan Anderson\saltblade" diff -- src/world/app.ts
git -c core.autocrlf=true -C "C:\Users\Aidan Anderson\saltblade" diff --cached --name-only -- src/world/app.ts src/world/audio.ts tests/world-audio.test.ts
