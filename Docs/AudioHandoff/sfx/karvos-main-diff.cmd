@echo off
cd /d "C:\Users\Aidan Anderson\karvos"
git -c core.safecrlf=false diff -- src/main.js
git -c core.safecrlf=false diff --cached --name-only
