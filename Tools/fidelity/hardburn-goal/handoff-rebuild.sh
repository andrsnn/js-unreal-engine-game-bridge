#!/bin/bash
# handoff-rebuild.sh [commit]: from Hard Burn's handoff commit to the package the desktop shortcut plays.
#   1. gun rules from the game's gun export, each new or changed gun cut from its original, imported and painted
#   2. the package, built from the commit (capture runs, cook)
#   3. six capital ships judged in the package: every gun against the game's mounts.json
# The commit is the first hex word of HB-HANDOFF.txt unless given. Each step is timed in handoff.log.
G=G:/JsGameBridge-fidelity-order; D=H:/captures/jsgb-fidelity/toggle; O=H:/captures/jsgb-goal; P=H:/builds/HardBurnUnreal-play; W=F:/JsgbFidelity
SHIPS="tdf-capital mrn-capital cartel-capital helion-capital ueg-capital corsair-capital"
C=${1:-$(grep -oE '\b[0-9a-f]{7,40}\b' $G/HB-HANDOFF.txt 2>/dev/null | head -n 1)}
[ -z "$C" ] && { echo "no commit given and none in HB-HANDOFF.txt"; exit 2; }
LOG=$O/handoff.log; T0=$(date +%s); : > $LOG
step() { echo "[$(date +%T), minute $(( ($(date +%s) - T0) / 60 ))] $*" | tee -a $LOG; }
# Waits until this many GB are available (Windows' Available MBytes), checking once a minute. One Unreal at a time.
needram() { for i in $(seq 1 240); do f=$(powershell -NoProfile -Command "[int]((Get-Counter 'MemoryAvailable MBytes').CounterSamples[0].CookedValue/1024)"); tasklist | grep -qiE "UnrealEditor|JsgbHost.exe" && f=0; [ "$f" -ge $1 ] && return 0; [ $((i % 5)) = 1 ] && step "waiting for $1 GB ($f available, or Unreal still open)"; sleep 60; done; return 1; }
step "handoff rebuild from $C"
cd $W

# 1. Guns.
node Overrides/make-hardburn-guns.mjs $G/GUNS-FOR-UNREAL.txt | tail -n 1 | tee -a $LOG
node Tools/fidelity/split-guns.mjs > $O/split-guns-handoff.log 2>&1; tail -n 1 $O/split-guns-handoff.log | tee -a $LOG
# The guns to import: those just cut again, and those with no rule or no paint yet.
GUNS=$(node -e "
const fs = require('fs'), list = JSON.parse(fs.readFileSync('Overrides/hardburn.sources.json', 'utf8')), rules = new Set((JSON.parse(fs.readFileSync('Overrides/hardburn.json', 'utf8')).overrides ?? []).map(r => r.name));
const cut = new Set((fs.readFileSync('$O/split-guns-handoff.log', 'utf8').match(/^gun_[a-z0-9_]+(?=: )/gm) ?? []));
const painted = n => fs.existsSync('$O/livery-guns/' + n + '.png') || fs.existsSync('H:/scratch/jsgb-fidelity/livery-guns2/' + n + '.png');
console.log(list.sources.filter(s => s.kind === 'gun' && (cut.has(s.name) || !rules.has(s.name) || !painted(s.name))).map(s => s.name).join(','));")
step "guns to import: $(echo "$GUNS" | tr ',' '\n' | grep -c .)"
if [ -n "$GUNS" ]; then
  NEED=24 $D/guarded.sh handoff-guns node Tools/fidelity/build-overrides.mjs Overrides/hardburn.sources.json Overrides/hardburn.json --work H:/builds/JsgbFidelity/FidelityWork --only "$GUNS" --clean
  step "gun models: $(tail -n 2 $D/handoff-guns.out | tr '\n' ' ')"
  timeout 3600 node Tools/fidelity/bake-livery.mjs Overrides/hardburn.json --game hardburn --out $O/livery-guns --port 5397 --only "$GUNS" > $O/handoff-bake.txt 2>&1
  step "gun paint baked: $(grep -c 'texels painted' $O/handoff-bake.txt) of $(echo "$GUNS" | tr ',' '\n' | grep -c .)"
  NEED=20 $D/guarded.sh handoff-livery node Tools/fidelity/import-livery.mjs Overrides/hardburn.json $O/livery-guns
  step "gun paint imported: $(tail -n 2 $D/handoff-livery.out | tr '\n' ' ')"
fi

# 2. The package.
taskkill //F //IM JsgbHost.exe > /dev/null 2>&1; sleep 3; needram 30
node Tools/laptop-package.mjs --host --no-smoke --games hardburn --pin hardburn=$C --out $P --project H:/builds/HardBurnUnreal-project > $O/handoff-package.log 2>&1
E=$?; step "package exit $E, game commit $(grep -oE 'sourceCommit\":\"[0-9a-f]{8}' $P/games/hardburn/publication.json | tail -c 9)"
[ $E -ne 0 ] && { tail -n 5 $O/handoff-package.log | cut -c1-300 | tee -a $LOG; exit 1; }

# 3. The gun check, in the package.
python $O/make_judge_multi.py $O/judge-6.txt $SHIPS | tee -a $LOG
rm -rf $O/judge-6; mkdir -p $O/judge-6; needram 24
"$P/host/Windows/JsgbHost.exe" "-JsgbGame=$(cygpath -w $P/games/hardburn)" -RenderOffScreen -ForceRes -ResX=1920 -ResY=1200 -JsgbVolume=0 -JsgbJsThread -JsgbLumen -JsgbScript=$O/judge-6.txt -JsgbCapture=$O/judge-6 -JsgbMaxSeconds=2400 -JsgbSeed=1234 "-JsgbSearch=?view=black" -unattended -log=jsgb-judge.log &
sleep 30; timeout 2400 bash -c "until ! tasklist | grep -qi 'JsgbHost.exe'; do sleep 10; done"; taskkill //F //IM JsgbHost.exe > /dev/null 2>&1
cp $P/host/Windows/JsgbHost/Saved/Logs/jsgb-judge.log $O/judge-6.log
node $O/judge_check.mjs $O/judge-6.log $SHIPS > $O/judge-6.txt.result 2>&1; tail -n 1 $O/judge-6.txt.result | tee -a $LOG
step "judge: $(ls $O/judge-6 | wc -l) shots, $(grep -c 'No cooked material' $O/judge-6.log) uncooked materials"
step "done in $(( ($(date +%s) - T0) / 60 )) minutes"
