@echo off
cd /d "C:\Users\Aidan Anderson\saltblade"
git worktree add --no-checkout G:\sfx\saltblade -b audio/v1 main
if errorlevel 1 exit /b 1
cd /d G:\sfx\saltblade
git sparse-checkout init --cone
git sparse-checkout set src scripts tests
git checkout audio/v1
if errorlevel 1 exit /b 1
mklink /J node_modules "C:\Users\Aidan Anderson\saltblade\node_modules"
mklink /J public "C:\Users\Aidan Anderson\saltblade\public"
git rev-parse HEAD
