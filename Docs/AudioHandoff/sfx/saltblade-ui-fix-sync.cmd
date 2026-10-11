@echo off
git -C G:\sfx\saltblade status --short -- src tests PLAY.md AUDIO.md
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
git -C G:\sfx\saltblade rev-parse HEAD
exit /b 0
:relink_failed
mklink /J G:\sfx\saltblade\public "C:\Users\Aidan Anderson\saltblade\public"
exit /b 1
