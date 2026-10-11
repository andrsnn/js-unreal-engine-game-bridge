@echo off
cd /d G:\sfx\karvos
git rev-parse HEAD
git rev-parse main
git merge main --no-edit
if errorlevel 1 exit /b 1
git rev-parse HEAD
git status --short
