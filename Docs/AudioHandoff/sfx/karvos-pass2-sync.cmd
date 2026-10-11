@echo off
cd /d G:\sfx\karvos
git status --short -- src public/audio scripts/build-audio-v1.py scripts/test-audio-v1.mjs
git merge main
git log -1 --format=%%H
