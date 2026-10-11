@echo off
cd /d "C:\Users\Aidan Anderson\karvos"
git diff --name-only
git diff -- src/main.js
git diff --cached --name-only
git status --short
