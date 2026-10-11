@echo off
git -C "C:\Users\Aidan Anderson\saltblade" rev-parse HEAD
git -C "C:\Users\Aidan Anderson\saltblade" diff --name-only -- src/platform/web.ts src/ui/view.ts src/core/types.ts
git -C G:\sfx\saltblade diff -- src/platform/web.ts PLAY.md
git -C G:\sfx\saltblade status --short -- src tests PLAY.md AUDIO.md
