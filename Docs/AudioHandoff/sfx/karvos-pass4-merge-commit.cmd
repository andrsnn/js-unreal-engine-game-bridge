@echo off
cd /d G:\sfx\karvos
git add PLAY.md
git -c core.editor=true commit --no-edit
if errorlevel 1 exit /b 1
git rev-parse HEAD
git status --short
