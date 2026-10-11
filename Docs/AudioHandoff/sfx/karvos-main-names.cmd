@echo off
cd /d "C:\Users\Aidan Anderson\karvos"
git -c core.safecrlf=false diff --name-only > G:\sfx\karvos-main-dirty-paths.txt
git -c core.safecrlf=false ls-files --others --exclude-standard > G:\sfx\karvos-main-untracked-paths.txt
