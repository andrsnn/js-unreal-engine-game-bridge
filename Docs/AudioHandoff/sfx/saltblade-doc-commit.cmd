@echo off
git -C "C:\Users\Aidan Anderson\saltblade" rev-parse HEAD
git -C "C:\Users\Aidan Anderson\saltblade" diff --name-only -- PLAY.md
git -C "C:\Users\Aidan Anderson\saltblade" diff --cached --name-only -- PLAY.md
git -C G:\sfx\saltblade diff -- PLAY.md
git -C G:\sfx\saltblade add PLAY.md
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade diff --cached --name-only
git -C G:\sfx\saltblade commit -m "Document persistent browser sound controls"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade rev-parse HEAD
git -C G:\sfx\saltblade status --short -- PLAY.md src/platform/audio.ts src/platform/web.ts
