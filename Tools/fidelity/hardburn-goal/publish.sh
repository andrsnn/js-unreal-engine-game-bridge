#!/bin/bash
# publish.sh <output folder> <name> [laptop-package options]: cooks the host project's current content into the output
# folder, runs the smoke check on it, and points the desktop shortcut at it only when the check passes. The build the
# shortcut played before stays where it is as the one to roll back to.
O=H:/captures/jsgb-goal; W=F:/JsgbFidelity; C=7bbaeed5; B=$1; N=$2; shift 2
LOG=$O/$N.log; T0=$(date +%s); : > $LOG
step() { echo "[$(date +%T), minute $(( ($(date +%s) - T0) / 60 ))] $*" | tee -a $LOG; }
cd $W; step "build $N into $B"
bash $O/ramcheck.sh 40 | tee -a $LOG
node Tools/laptop-package.mjs --host --no-smoke --no-capture --games hardburn --pin hardburn=$C --out $B --project H:/builds/HardBurnUnreal-project "$@" > $O/$N-package.log 2>&1
E=$?; step "package exit $E"
[ $E -ne 0 ] && { tail -n 5 $O/$N-package.log | cut -c1-300 | tee -a $LOG; exit 1; }
bash $O/smoke.sh $B smoke-$N > $O/smoke-$N.out 2>&1; S=$?
cat $O/smoke-$N.txt | tee -a $LOG
if [ $S -eq 0 ]; then
  powershell -NoProfile -Command "\$s=(New-Object -ComObject WScript.Shell).CreateShortcut('C:\Users\Aidan Anderson\Desktop\Hard Burn (Unreal).lnk'); \$s.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"F:\JsgbFidelity\Tools\play-package.ps1\" -Package \"$(cygpath -w $B)\" -Game hardburn -Title \"Hard Burn\"'; \$s.Save()"
  step "PUBLISHED: the shortcut now plays $B"
  # Warm the new build: the first launch after a build reads it all from the drive; after this one, the player gets
  # the cached launch.
  step "warm-up launches: $(bash $O/relaunch.sh $B) s, then $(bash $O/relaunch.sh $B) s to the menu"
else step "NOT PUBLISHED: the smoke check failed, the shortcut still plays the last good build"; fi
