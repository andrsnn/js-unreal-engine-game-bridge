#!/bin/bash
# ramcheck.sh <GB>: waits until that many GB are available (Windows' Available MBytes), no Unreal of mine is open and no
# 'gun-sweep' node process (Hard Burn's sweep browser) is running. Checks once a minute, for up to four hours.
for i in $(seq 1 240); do
  f=$(powershell -NoProfile -Command "[int]((Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue/1024)")
  why=
  [ "$f" -ge "$1" ] || why="$f GB available, $1 needed"
  tasklist | grep -qiE "UnrealEditor|JsgbHost.exe" && why="Unreal is still open"
  powershell -NoProfile -Command "if (@(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -match 'gun-sweep' }).Count) { exit 1 }" || why="Hard Burn's gun sweep is running"
  [ -z "$why" ] && exit 0
  [ $((i % 5)) = 1 ] && echo "[$(date +%T)] waiting: $why"
  sleep 60
done
exit 1
