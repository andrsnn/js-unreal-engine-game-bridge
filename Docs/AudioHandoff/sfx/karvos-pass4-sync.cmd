@echo off
cd /d G:\sfx\karvos
git status --short --untracked-files=no
git rev-parse main
git merge main --no-edit
if errorlevel 1 exit /b 1
git rev-parse HEAD
