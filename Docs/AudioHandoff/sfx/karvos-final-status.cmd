@echo off
cd /d G:\sfx\karvos
git diff --name-only
git diff --cached --name-only
git status --short --untracked-files=no
git rev-parse HEAD
