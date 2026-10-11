@echo off
git -C "C:\Users\Aidan Anderson\saltblade" rev-parse HEAD
fsutil reparsepoint query G:\sfx\saltblade\public > G:\sfx\saltblade-public-junction-proof.txt
if errorlevel 1 exit /b 1
findstr /C:"C:\Users\Aidan Anderson\saltblade\public" G:\sfx\saltblade-public-junction-proof.txt >nul
if errorlevel 1 exit /b 1
rmdir G:\sfx\saltblade\public
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade sparse-checkout reapply
if errorlevel 1 goto relink_failed
git -C G:\sfx\saltblade merge --quiet --ff-only main
if errorlevel 1 goto relink_failed
mklink /J G:\sfx\saltblade\public "C:\Users\Aidan Anderson\saltblade\public"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade apply --check G:\sfx\salt-sound-play-note.patch
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade apply G:\sfx\salt-sound-play-note.patch
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade add PLAY.md
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade diff --cached --name-only
git -C G:\sfx\saltblade commit -m "Retain sound control instructions in current play notes"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade rev-parse HEAD
git -C "C:\Users\Aidan Anderson\saltblade" rev-parse HEAD
git -C G:\sfx\saltblade diff main...HEAD --stat
git -C G:\sfx\saltblade diff main...HEAD -- PLAY.md
git -C G:\sfx\saltblade status --short -- PLAY.md src/platform/audio.ts src/platform/web.ts
exit /b 0
:relink_failed
mklink /J G:\sfx\saltblade\public "C:\Users\Aidan Anderson\saltblade\public"
exit /b 1
