@echo off
git -C "C:\Users\Aidan Anderson\saltblade" rev-parse HEAD
git -C "C:\Users\Aidan Anderson\saltblade" diff --name-only -- PLAY.md
git -C "C:\Users\Aidan Anderson\saltblade" diff --cached --name-only -- PLAY.md
git -C G:\sfx\saltblade sparse-checkout list
git -C G:\sfx\saltblade status --short -- src tests PLAY.md AUDIO.md
git -C G:\sfx\saltblade merge --no-edit main
