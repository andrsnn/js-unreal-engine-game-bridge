#!/bin/bash
# build-b.sh <output folder>: the next build. The last 31 gun models, the TDF capital's full original, paint for every new
# gun at the brightness the faction tints expect, a cook into the output folder, the smoke check, and only then the shortcut.
O=H:/captures/jsgb-goal; D=H:/captures/jsgb-fidelity/toggle; W=F:/JsgbFidelity; C=7bbaeed5; B=${1:-H:/builds/HardBurnUnreal-fallback}
LOG=$O/build-b.log; T0=$(date +%s); : > $LOG
step() { echo "[$(date +%T), minute $(( ($(date +%s) - T0) / 60 ))] $*" | tee -a $LOG; }
cd $W; M=$(cat $O/models-96.txt); H=concept_tdf_capital_titan
step "build into $B: 31 gun models and the TDF capital's original"
bash $O/ramcheck.sh 40 | tee -a $LOG
node Tools/fidelity/build-overrides.mjs Overrides/hardburn.sources.json Overrides/hardburn.json --work H:/builds/JsgbFidelity/FidelityWork --only "$M,$H" --clean > $D/b-models.out 2>&1
step "models imported: exit $? $(tail -n 1 $D/b-models.out | cut -c1-100); $(grep -a "$H" $D/b-models.out | head -n 2 | tr '\n' ' ' | cut -c1-220)"
rm -rf $O/livery-guns-f $O/livery-hull-g
timeout 2400 node Tools/fidelity/bake-livery.mjs Overrides/hardburn.json --game hardburn --out $O/livery-guns-f --port 5397 --only "$M" > $O/b-bake-f.txt 2>&1
python $O/normalise_gun_paint.py $O/livery-guns-f > $O/normalise-f.txt 2>&1
timeout 900 node Tools/fidelity/bake-livery.mjs Overrides/hardburn.json --game hardburn --out $O/livery-hull-g --port 5397 --preview --only "$H" > $O/b-bake-g.txt 2>&1
step "paint baked: $(grep -c 'texels painted' $O/b-bake-f.txt) of 31 guns (brightness set on $(grep -c -- '->' $O/normalise-f.txt)), hull: $(grep -a 'texels painted' $O/b-bake-g.txt | cut -c1-160)"
for k in guns-c guns-d guns-e guns-f hull-g; do
  NEED=40 $D/guarded.sh b-livery-$k node Tools/fidelity/import-livery.mjs Overrides/hardburn.json $O/livery-$k
  step "paint imported ($k): $(tail -n 2 $D/b-livery-$k.out | tr '\n' ' ')"
done
bash $O/ramcheck.sh 40 | tee -a $LOG
node Tools/laptop-package.mjs --host --no-smoke --no-capture --games hardburn --pin hardburn=$C --out $B --project H:/builds/HardBurnUnreal-project > $O/b-package.log 2>&1
E=$?; step "package exit $E"
[ $E -ne 0 ] && { tail -n 5 $O/b-package.log | cut -c1-300 | tee -a $LOG; exit 1; }
bash $O/smoke.sh $B smoke-b > $O/smoke-b.out 2>&1; S=$?
cat $O/smoke-b.txt | tee -a $LOG
if [ $S -eq 0 ]; then
  powershell -NoProfile -Command "\$s=(New-Object -ComObject WScript.Shell).CreateShortcut('C:\Users\Aidan Anderson\Desktop\Hard Burn (Unreal).lnk'); \$s.Arguments='-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File \"F:\JsgbFidelity\Tools\play-package.ps1\" -Package \"$(cygpath -w $B)\" -Game hardburn -Title \"Hard Burn\"'; \$s.Save()"
  step "PUBLISHED: the shortcut now plays $B"
else step "NOT PUBLISHED: the smoke check failed, the shortcut still plays the last good build"; fi
