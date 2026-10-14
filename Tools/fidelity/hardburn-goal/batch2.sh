#!/bin/bash
# batch2.sh <name> <file with hull names> <output folder>: a batch of hulls through the owner's pick and the recoloured
# paint, cooked into the output folder; the shortcut moves to it only when the smoke check passes.
#   1. each hull cleaned (cleanup.py, its "cleanup" setting) and imported
#   2. the game's paint projected onto it (bake-livery --style game): only the colour source
#   3. the hull's own texture recoloured from that paint (recolour.py): the paint that ships
#   4. the paint imported, the build cooked and smoke checked
O=H:/captures/jsgb-goal; D=H:/captures/jsgb-fidelity/toggle; W=F:/JsgbFidelity; N=$1; NAMES=$(cat $2); B=$3
BLENDER="C:/Program Files/Blender Foundation/Blender 5.2/blender.exe"; T=H:/tools/pixal-cleanup
LOG=$O/batch-$N.log; T0=$(date +%s); : > $LOG
step() { echo "[$(date +%T), minute $(( ($(date +%s) - T0) / 60 ))] $*" | tee -a $LOG; }
cd $W
COUNT=$(echo $NAMES | tr ',' '\n' | grep -c .)
step "batch $N: $COUNT hulls into $B"
bash $O/ramcheck.sh 40 | tee -a $LOG
node Tools/fidelity/build-overrides.mjs Overrides/hardburn.sources.json Overrides/hardburn.json --work H:/builds/JsgbFidelity/FidelityWork --only "$NAMES" --clean > $D/batch-$N-models.out 2>&1
step "cleaned and imported: exit $?, $(grep -ac ': cleaned' $D/batch-$N-models.out) cleaned, $(grep -ac 'not imported' $D/batch-$N-models.out) not imported"
rm -rf $O/livery-projected-$N $O/livery-recoloured-$N; mkdir -p $O/livery-recoloured-$N
timeout 7200 node Tools/fidelity/bake-livery.mjs Overrides/hardburn.json --game hardburn --out $O/livery-projected-$N --port 5398 --style game --only "$NAMES" > $O/batch-$N-bake.txt 2>&1
step "game paint projected: $(grep -ac 'texels painted' $O/batch-$N-bake.txt) of $COUNT"
done=0
for name in $(echo $NAMES | tr ',' ' '); do
  mesh=H:/builds/JsgbFidelity/hulls-clean/$name.glb; paint=$O/livery-projected-$N/$name.png
  [ -f "$mesh" ] && [ -f "$paint" ] || { echo "  $name: no cleaned mesh or no projected paint, keeps its old paint" >> $LOG; continue; }
  "$BLENDER" --background --python $T/recolour.py -- $mesh $paint $O/livery-recoloured-$N/$name.png > $O/livery-recoloured-$N/$name.log 2>&1 && done=$((done + 1))
done
node -e "
const fs = require('fs'), from = JSON.parse(fs.readFileSync('$O/livery-projected-$N/bake.json', 'utf8')), out = {};
for (const [k, v] of Object.entries(from)) if (fs.existsSync('$O/livery-recoloured-$N/' + k + '.png')) out[k] = {...v, recoloured: true};
fs.writeFileSync('$O/livery-recoloured-$N/bake.json', JSON.stringify(out, null, 1));"
step "own texture recoloured: $done of $COUNT"
NEED=40 $D/guarded.sh batch-$N-livery node Tools/fidelity/import-livery.mjs Overrides/hardburn.json $O/livery-recoloured-$N
step "paint imported: $(tail -n 2 $D/batch-$N-livery.out | tr '\n' ' ')"
bash $O/publish.sh $B batch-$N-build > $O/batch-$N-publish.out 2>&1
tail -n 8 $O/batch-$N-build.log | tee -a $LOG
