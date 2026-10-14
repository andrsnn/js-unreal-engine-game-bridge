#!/bin/bash
# overnight.sh: the hull batches one after another. Each goes into the package folder holding the oldest build, so the
# live build and the one before it always stay. One line per batch goes to OVERNIGHT.md.
O=H:/captures/jsgb-goal; M=G:/JsGameBridge-fidelity-order/OVERNIGHT.md
cd $O
node -e "const fs=require('fs');const r=n=>fs.readFileSync('batch-'+n+'.txt','utf8').split(',').filter(Boolean);
fs.writeFileSync('run-tdf.txt', r('tdf').filter(n=>n!=='concept_tdf_capital_titan').join(','));
fs.writeFileSync('run-mrn.txt', r('mrn').join(','));
fs.writeFileSync('run-cartel-corsair.txt', [...r('cartel'), ...r('corsair')].join(','));
fs.writeFileSync('run-helion-ueg.txt', [...r('helion'), ...r('ueg')].join(','));
fs.writeFileSync('run-rest.txt', ['veil','module','asteroid','derelict','hero','pirate'].flatMap(r).join(','));"
# Oldest first: B, C, D. D is live.
[ -f folders.txt ] || printf '%s\n' H:/builds/HardBurnUnreal-fallback H:/builds/HardBurnUnreal-play H:/builds/HardBurnUnreal-third > folders.txt
# overnight.sh [batch ...]: all five when none are named.
for batch in ${@:-tdf mrn cartel-corsair helion-ueg rest}; do
  target=$(head -n 1 folders.txt)
  bash $O/batch2.sh $batch $O/run-$batch.txt $target > $O/batch-$batch.out 2>&1
  L=$O/batch-$batch.log
  n=$(tr ',' '\n' < $O/run-$batch.txt | grep -c .)
  if grep -q "PUBLISHED: the shortcut now plays" $L && ! grep -q "NOT PUBLISHED" $L; then
    { tail -n +2 folders.txt; echo $target; } > folders.new && mv folders.new folders.txt
    echo "- $(date +%H:%M) Batch $batch live ($n hulls, the pick plus recoloured paint) in $target. $(grep -a 'cleaned and imported' $L | sed -E 's/^\[[^]]*\] //') $(grep -a 'own texture recoloured' $L | sed -E 's/^\[[^]]*\] //'). Smoke: $(grep -a 'battle:' $L | head -n 1 | sed -E 's/.*damage ([0-9]+) .* dead ([0-9]+).*/\1 damage, \2 ships destroyed/'), $(grep -a 'warm-up' $L | sed -E 's/^\[[^]]*\] //')." >> $M
  else
    echo "- $(date +%H:%M) Batch $batch NOT published ($n hulls): $(grep -a 'SMOKE FAIL\|package exit [1-9]\|NOT PUBLISHED' $L | head -n 1 | cut -c1-200). The shortcut stays on the build before." >> $M
  fi
done
echo "- $(date +%H:%M) Hull batches finished." >> $M
