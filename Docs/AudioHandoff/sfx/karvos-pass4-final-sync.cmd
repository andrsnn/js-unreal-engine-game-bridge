@echo off
cd /d G:\sfx\karvos
git merge main
if errorlevel 1 exit /b 1
git rev-parse HEAD
git rev-parse main
git status --short
