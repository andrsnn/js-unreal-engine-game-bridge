@echo off
cd /d "C:\Users\Aidan Anderson\karvos"
git rev-parse HEAD
git ls-files -v public/audio/bank.json
git hash-object public/audio/bank.json
git rev-parse HEAD:public/audio/bank.json
git rev-parse :public/audio/bank.json
git show HEAD:public/audio/bank.json > G:\sfx\karvos-primary-bank-head.json
git show :public/audio/bank.json > G:\sfx\karvos-primary-bank-index.json
git diff --numstat -- public/audio/bank.json
