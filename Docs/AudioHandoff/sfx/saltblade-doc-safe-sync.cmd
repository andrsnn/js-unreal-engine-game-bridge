@echo off
fsutil reparsepoint query G:\sfx\saltblade\public
if errorlevel 1 exit /b 1
rmdir G:\sfx\saltblade\public
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade sparse-checkout reapply
if errorlevel 1 goto relink
git -C G:\sfx\saltblade merge --no-edit main
:relink
mklink /J G:\sfx\saltblade\public "C:\Users\Aidan Anderson\saltblade\public"
git -C G:\sfx\saltblade rev-parse HEAD
git -C G:\sfx\saltblade status --short -- PLAY.md src/platform/audio.ts src/platform/web.ts
