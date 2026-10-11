@echo off
git -C G:\sfx\saltblade add -- tests/world-audio.test.ts
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade -c user.name=SaltbladeBuilder -c user.email=builder@saltblade.local commit -m "Verify committed weather producer audio timing"
if errorlevel 1 exit /b 1
git -C G:\sfx\saltblade diff --stat open-world HEAD -- src tests
git -C G:\sfx\saltblade status --short -- src tests PLAY.md AUDIO.md
git -C G:\sfx\saltblade rev-parse HEAD
