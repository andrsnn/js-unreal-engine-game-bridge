@echo off
cd /d G:\sfx\karvos
git status --short
git diff --stat
git diff --check
