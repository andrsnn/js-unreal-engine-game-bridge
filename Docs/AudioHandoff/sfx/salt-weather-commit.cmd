@echo off
git -C G:\sfx\saltblade -c user.name=SaltbladeBuilder -c user.email=builder@saltblade.local commit -m "Follow actual moving storms and wind in world audio"
if errorlevel 1 exit /b 1
call G:\sfx\saltblade-world-sync-normalize.cmd
