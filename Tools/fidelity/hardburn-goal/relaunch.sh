#!/bin/bash
# relaunch.sh <package folder>: starts the package through the shortcut's launcher, prints the seconds to the game's
# menu, and closes it. The player's saves are set aside for the run.
P=$1; W=F:/JsgbFidelity
L=$P/host/Windows/JsgbHost/Saved/Logs/jsgb-hardburn.log; S=$P/host/Windows/JsgbHost/Saved/JsGameBridge
taskkill //F //IM JsgbHost.exe > /dev/null 2>&1; sleep 2; rm -f "$L"
rm -rf "$S.player"; [ -d "$S" ] && mv "$S" "$S.player"
T0=$(date +%s%3N)
powershell -NoProfile -Command "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','$(cygpath -w $W/Tools/play-package.ps1)','-Package','$(cygpath -w $P)','-Game','hardburn','-Title','\"Hard Burn\"','-Extra','\"-JsgbVolume=0\"'"
R=; for i in $(seq 1 600); do grep -aq "js ready game entry evaluated" "$L" 2>/dev/null && { R=$(date +%s%3N); break; }; sleep 0.2; done
sleep 3; taskkill //F //IM JsgbHost.exe > /dev/null 2>&1
rm -rf "$S"; [ -d "$S.player" ] && mv "$S.player" "$S"
[ -n "$R" ] && awk "BEGIN { printf \"%.1f\n\", ($R - $T0) / 1000 }" || echo never
