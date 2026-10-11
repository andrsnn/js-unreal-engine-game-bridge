@echo off
cd /d "C:\Users\Aidan Anderson\karvos"
git -c core.safecrlf=false diff --name-only -- src public/audio
git ls-files --others --exclude-standard -- src public/audio
