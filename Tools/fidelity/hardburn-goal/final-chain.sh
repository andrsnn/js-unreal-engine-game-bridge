#!/bin/bash
# final-chain.sh: after the six-ship check, the last 31 gun models and the paint for every new gun go in, the package is
# cooked again from the same game commit, and the final build gets a timed launch and the clean 5 minute battle.
O=H:/captures/jsgb-goal; D=H:/captures/jsgb-fidelity/toggle; P=H:/builds/HardBurnUnreal-play; W=F:/JsgbFidelity; C=7bbaeed5
LOG=$O/final.log; T0=$(date +%s); : > $LOG
step() { echo "[$(date +%T), minute $(( ($(date +%s) - T0) / 60 ))] $*" | tee -a $LOG; }
step "waiting for the six-ship check to end"
until [ -s $O/judge-6-result.txt ] && grep -q "guns on" $O/judge-6-result.txt; do
  tasklist | grep -qi JsgbHost.exe || { sleep 20; [ -s $O/judge-6-result.txt ] || { step "the check's game is gone and there is no result"; break; }; }
  sleep 5
done
sleep 3
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\" | Where-Object { \$_.CommandLine -match 'handoff[-]run' } | % { Stop-Process -Id \$_.ProcessId -Force }" > /dev/null 2>&1
sleep 2; taskkill //F //IM JsgbHost.exe > /dev/null 2>&1
step "six-ship check: $(tail -n 1 $O/judge-6-result.txt)"
cd $W; M=$(cat $O/models-96.txt)
bash $O/ramcheck.sh 40 | tee -a $LOG
node Tools/fidelity/build-overrides.mjs Overrides/hardburn.sources.json Overrides/hardburn.json --work H:/builds/JsgbFidelity/FidelityWork --only "$M" --clean > $D/final-guns.out 2>&1
step "31 gun models: exit $? $(tail -n 1 $D/final-guns.out | cut -c1-120)"
rm -rf $O/livery-guns-f
timeout 2400 node Tools/fidelity/bake-livery.mjs Overrides/hardburn.json --game hardburn --out $O/livery-guns-f --port 5397 --only "$M" > $O/final-bake-f.txt 2>&1
python $O/normalise_gun_paint.py $O/livery-guns-f > $O/normalise-f.txt 2>&1
step "paint baked for the 31: $(grep -c 'texels painted' $O/final-bake-f.txt), brightness set on $(grep -c -- '->' $O/normalise-f.txt)"
for k in c d e f; do
  NEED=40 $D/guarded.sh final-livery-$k node Tools/fidelity/import-livery.mjs Overrides/hardburn.json $O/livery-guns-$k
  step "paint imported ($k): $(tail -n 2 $D/final-livery-$k.out | tr '\n' ' ')"
done
bash $O/ramcheck.sh 40 | tee -a $LOG
node Tools/laptop-package.mjs --host --no-smoke --no-capture --games hardburn --pin hardburn=$C --out $P --project H:/builds/HardBurnUnreal-project > $O/final-package.log 2>&1
E=$?; step "package exit $E"
[ $E -ne 0 ] && { tail -n 5 $O/final-package.log | cut -c1-300 | tee -a $LOG; exit 1; }
SKIP="guns package judge" bash $O/handoff-run.sh $C > $O/final-battle.out 2>&1
cat $O/handoff.log >> $LOG
step "final chain done"
