@echo off
cd /d "C:\Users\Aidan Anderson\karvos"
git -c core.safecrlf=false diff -- src/fabricator-ui.js
git show HEAD:src/fabricator-ui.js > G:\sfx\karvos-audit-base-fabricator.js
