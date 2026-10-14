#!/bin/bash
# time-launch.sh <name> [seconds]: starts the desktop shortcut, records the screen, and times each stage.
O=H:/captures/jsgb-goal; N=${1:-launch}; S=${2:-100}
L=${PKG:-H:/builds/HardBurnUnreal-play}/host/Windows/JsgbHost/Saved/Logs/jsgb-hardburn.log; M="$TEMP/jsgb-launch-hardburn.txt"
taskkill //F //IM JsgbHost.exe > /dev/null 2>&1; sleep 2; rm -f "$L" "$M"
timeout $((S + 30)) ffmpeg -y -loglevel error -f lavfi -i ddagrab=framerate=30 -t $S -c:v h264_nvenc -cq 24 $O/$N.mkv > $O/$N.ffmpeg.txt 2>&1 &
sleep 3
T0=$(date +%s%3N); echo "$N: started the shortcut at $(date +%T)" | tee $O/$N.txt
powershell -NoProfile -Command "Start-Process -FilePath 'C:\Users\Aidan Anderson\Desktop\Hard Burn (Unreal).lnk'"
R=
for i in $(seq 1 900); do grep -aq "js ready game entry evaluated" "$L" 2>/dev/null && { R=$(date +%s%3N); break; }; sleep 0.2; done
s() { [ -n "$1" ] && awk "BEGIN { printf \"%.1f s\", ($1 - $T0) / 1000 }" || printf never; }
m() { grep "^$1 " "$M" 2>/dev/null | head -n 1 | cut -d' ' -f2; }
{ echo "  launch window on screen: $(s $(m shown))"; echo "  Unreal started: $(s $(m unreal))"; echo "  Unreal's own window with its loading screen: $(s $(m window))"; echo "  game ready: $(s $R)"; } | tee -a $O/$N.txt
wait
