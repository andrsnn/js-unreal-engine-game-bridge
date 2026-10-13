#!/bin/bash
# smoke.sh <package folder> [name]: the one check every build passes before the desktop shortcut points at it. It starts
# the package through the shortcut's own launcher (Tools/play-package.ps1), reaches the menu, starts a new campaign,
# lets the game's opening raid arrive, plays the fight at normal speed, and quits. The player's saves are set aside for
# the run and put back. Exit 0 and "SMOKE PASS" when every line below holds; anything else is a fail.
P=${1:-H:/builds/HardBurnUnreal-play}; N=${2:-smoke}; O=H:/captures/jsgb-goal; W=F:/JsgbFidelity
L=$P/host/Windows/JsgbHost/Saved/Logs/jsgb-hardburn.log; S=$P/host/Windows/JsgbHost/Saved/JsGameBridge; M="$TEMP/jsgb-launch-hardburn.txt"
if [ -z "$SMOKE_EVAL" ]; then
bash $O/ramcheck.sh 40 || { echo "SMOKE FAIL: not enough memory to start"; exit 1; }
rm -rf $O/$N; mkdir -p $O/$N; rm -f "$L" "$M"
rm -rf "$S.player"; [ -d "$S" ] && mv "$S" "$S.player"
T0=$(date +%s%3N)
powershell -NoProfile -Command "Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','$(cygpath -w $W/Tools/play-package.ps1)','-Package','$(cygpath -w $P)','-Game','hardburn','-Title','\"Hard Burn\"','-Extra','\"-JsgbScript=$O/smoke.txt -JsgbCapture=$O/$N -JsgbVolume=0 -JsgbMaxSeconds=480 -unattended\"'"
R=; for i in $(seq 1 450); do grep -aq "js ready game entry evaluated" "$L" 2>/dev/null && { R=$(date +%s%3N); break; }; sleep 0.2; done
timeout 520 bash -c "sleep 15; until ! tasklist | grep -qi 'JsgbHost.exe'; do sleep 5; done"; taskkill //F //IM JsgbHost.exe > /dev/null 2>&1 && KILLED=1
rm -rf "$S"; [ -d "$S.player" ] && mv "$S.player" "$S"
cp "$L" $O/$N.log 2>/dev/null
{ echo "T0 $T0"; echo "R $R"; } > $O/$N.times; cp "$M" $O/$N.marks 2>/dev/null
else T0=$(grep "^T0 " $O/$N.times | cut -d" " -f2); R=$(grep "^R " $O/$N.times | cut -d" " -f2); M=$O/$N.marks; fi
s() { [ -n "$1" ] && awk "BEGIN { printf \"%.1f\", ($1 - $T0) / 1000 }" || printf never; }
m() { grep "^$1 " "$M" 2>/dev/null | head -n 1 | cut -d' ' -f2; }
RES=$(grep -a "script .*-> SMOKE RESULT" $O/$N.log | sed -E 's/.*-> SMOKE RESULT //' | tail -n 1)
READY=$(s $R); FAIL=
[ "$READY" = never ] && FAIL="$FAIL; the game never reached its menu"
[ "$READY" != never ] && awk "BEGIN { exit !($READY > 90) }" && FAIL="$FAIL; launch took $READY s (limit 90)"
grep -aq "script .*click 'BEGIN NEW CAMPAIGN'" $O/$N.log || grep -aq "BUTTON#[0-9]* BEGIN NEW CAMPAIGN" $O/$N.log || FAIL="$FAIL; the new campaign button was never clicked"
grep -aq "SMOKE watching, campaign" $O/$N.log || FAIL="$FAIL; no campaign started"
D=$(echo "$RES" | sed -E 's/.* damage ([0-9]+) .*/\1/'); [ -n "$RES" ] && [ "${D:-0}" -gt 0 ] 2>/dev/null || FAIL="$FAIL; no ship took damage (no battle)"
FIRST=$(grep -a "script .*-> SMOKE status" $O/$N.log | grep -v "first hit none" | head -n 1 | sed -E 's/.*script ([0-9]+).*/\1/'); END=$(grep -a "script .*-> SMOKE RESULT" $O/$N.log | sed -E 's/.*script ([0-9]+).*/\1/' | tail -n 1)
[ -n "$FIRST" ] && [ -n "$END" ] && [ $((END - FIRST)) -ge 120 ] || FAIL="$FAIL; the fight ran $(( ${END:-0} - ${FIRST:-0} )) s (120 needed)"
E=$(grep -aE "host frame [0-9]+: js" $O/$N.log | sed -E 's/.*js errors ([0-9]+).*/\1/' | sort -n | tail -n 1); [ "${E:-0}" = 0 ] || FAIL="$FAIL; $E JavaScript errors"
U=$(grep -ac "No cooked material" $O/$N.log); [ "$U" = 0 ] || FAIL="$FAIL; $U materials with no cooked copy"
grep -aq "Fatal error\|Unhandled Exception\|LogWindows: Error: appError" $O/$N.log && FAIL="$FAIL; Unreal reported a fatal error"
grep -aq "LogExit: Exiting" $O/$N.log || FAIL="$FAIL; the game did not quit cleanly"
FPS=$(grep -aE "host frame [0-9]+: js" $O/$N.log | sed -E 's/.*fps ([0-9.]+),.*/\1/' | sort -n | awk '{a[NR]=$1} END {if (NR) printf "%s lowest, %s median", a[1], a[int((NR+1)/2)]}')
{ echo "$N on $P at $(date '+%H:%M'): game commit $(grep -ao 'bundle .*hardburn.mjs ([0-9a-f]*' $O/$N.log | head -n 1 | sed -E 's/.*\(//')"
  echo "  launch window $(s $(m shown)) s, Unreal's loading screen $(s $(m window)) s, menu $READY s"
  echo "  battle: $RES"; echo "  frame rate samples: $FPS; shots: $(ls $O/$N/*.png 2>/dev/null | wc -l)"
  [ -z "$FAIL" ] && echo "SMOKE PASS" || echo "SMOKE FAIL$FAIL"; } | tee $O/$N.txt
[ -z "$FAIL" ]
