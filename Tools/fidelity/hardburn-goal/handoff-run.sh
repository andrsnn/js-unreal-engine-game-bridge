#!/bin/bash
# handoff-run.sh [commit]: from Hard Burn's handoff commit to the package the desktop shortcut plays.
#   1. gun rules for every gun copy in the game; guns whose copy is newer than their cut, or that have no rule or paint
#      yet, are cut, imported and painted. Hulls are reimported only when named: HULLS=<source name>,<source name>.
#   2. the package, built from the commit (capture runs, cook)
#   3. six ships judged in the package (SHIPS="faction-hull ..."): every gun against the game's mounts.json
#   4. a 5 minute battle at 3840x2160 with Lumen on and nothing else scripted: frame rate, stalls, memory
# The commit is the first hex word of HB-HANDOFF.txt unless given. Each step is timed in handoff.log.
# SKIP="guns package judge battle" leaves steps out.
G=G:/JsGameBridge-fidelity-order; D=H:/captures/jsgb-fidelity/toggle; O=H:/captures/jsgb-goal; P=H:/builds/HardBurnUnreal-play; W=F:/JsgbFidelity
SHIPS=${SHIPS:-"tdf-capital mrn-capital cartel-capital helion-capital ueg-capital corsair-capital"}
C=${1:-$(grep -oE '\b[0-9a-f]{7,40}\b' $G/HB-HANDOFF.txt 2>/dev/null | head -n 1)}
[ -z "$C" ] && { echo "no commit given and none in HB-HANDOFF.txt"; exit 2; }
LOG=$O/handoff.log; T0=$(date +%s); : > $LOG
step() { echo "[$(date +%T), minute $(( ($(date +%s) - T0) / 60 ))] $*" | tee -a $LOG; }
needram() { bash $O/ramcheck.sh $1 | tee -a $LOG; }
skip() { case " $SKIP " in *" $1 "*) return 0;; esac; return 1; }
host() { # host <log name> <script> <capture dir> <width> <height> <max seconds>
  needram 40; rm -rf $3; mkdir -p $3
  "$P/host/Windows/JsgbHost.exe" "-JsgbGame=$(cygpath -w $P/games/hardburn)" -RenderOffScreen -ForceRes -ResX=$4 -ResY=$5 -JsgbDlssKeys -JsgbJitter -JsgbJsThread -JsgbLumen -JsgbVolume=0 -JsgbScript=$2 -JsgbCapture=$3 -JsgbMaxSeconds=$6 -JsgbSeed=1234 "-JsgbSearch=?view=black" -unattended -log=$1.log > /dev/null 2>&1 &
  sleep 30
  ( while tasklist | grep -qi 'JsgbHost.exe'; do echo "$(date +%T) available $(powershell -NoProfile -Command "[int]((Get-Counter '\Memory\Available MBytes').CounterSamples[0].CookedValue/1024)") GB, host $(tasklist | grep -i JsgbHost | awk '{print $5}' | tr -d ',' | sort -n | tail -n 1) KB"; sleep 30; done > $O/$1-ram.txt ) &
  timeout $(( $6 + 60 )) bash -c "until ! tasklist | grep -qi 'JsgbHost.exe'; do sleep 10; done"; taskkill //F //IM JsgbHost.exe > /dev/null 2>&1
  cp $P/host/Windows/JsgbHost/Saved/Logs/$1.log $O/$1.log
}
step "handoff run from $C"
cd $W

if ! skip guns; then
  node Overrides/make-hardburn-guns.mjs $G/GUNS-FOR-UNREAL.txt | tail -n 1 | tee -a $LOG
  node Tools/fidelity/split-guns.mjs > $O/split-guns-handoff.log 2>&1; tail -n 1 $O/split-guns-handoff.log | tee -a $LOG
  # The guns to import: those just cut again, and those with no rule or no paint yet. Then the hulls named in HULLS.
  NAMES=$(node -e "
const fs = require('fs'), list = JSON.parse(fs.readFileSync('Overrides/hardburn.sources.json', 'utf8')), rules = new Set((JSON.parse(fs.readFileSync('Overrides/hardburn.json', 'utf8')).overrides ?? []).map(r => r.name));
const cut = new Set((fs.readFileSync('$O/split-guns-handoff.log', 'utf8').match(/^gun_[a-z0-9_]+(?=: )/gm) ?? []));
const painted = n => fs.existsSync('$O/livery-guns/' + n + '.png') || fs.existsSync('H:/scratch/jsgb-fidelity/livery-guns2/' + n + '.png');
const hulls = '$HULLS'.split(',').filter(Boolean);
console.log([...list.sources.filter(s => s.kind === 'gun' && (cut.has(s.name) || !rules.has(s.name) || !painted(s.name))).map(s => s.name), ...hulls].join(','));")
  step "to import: $(echo "$NAMES" | tr ',' '\n' | grep -c .) models ($(echo "$NAMES" | tr ',' '\n' | grep -c '^gun_') guns)"
  if [ -n "$NAMES" ]; then
    NEED=40 $D/guarded.sh handoff-guns node Tools/fidelity/build-overrides.mjs Overrides/hardburn.sources.json Overrides/hardburn.json --work H:/builds/JsgbFidelity/FidelityWork --only "$NAMES" --clean
    step "models imported: $(tail -n 2 $D/handoff-guns.out | tr '\n' ' ')"
    timeout 5400 node Tools/fidelity/bake-livery.mjs Overrides/hardburn.json --game hardburn --out $O/livery-guns --port 5397 --only "$NAMES" > $O/handoff-bake.txt 2>&1
    step "paint baked: $(grep -c 'texels painted' $O/handoff-bake.txt) of $(echo "$NAMES" | tr ',' '\n' | grep -c .)"
    NEED=40 $D/guarded.sh handoff-livery node Tools/fidelity/import-livery.mjs Overrides/hardburn.json $O/livery-guns
    step "paint imported: $(tail -n 2 $D/handoff-livery.out | tr '\n' ' ')"
  fi
fi

if ! skip package; then
  taskkill //F //IM JsgbHost.exe > /dev/null 2>&1; sleep 3; needram 40
  node Tools/laptop-package.mjs --host --no-smoke --games hardburn --pin hardburn=$C --out $P --project H:/builds/HardBurnUnreal-project > $O/handoff-package.log 2>&1
  E=$?; step "package exit $E, game commit $(grep -oE 'sourceCommit\":\"[0-9a-f]{8}' $P/games/hardburn/publication.json | tail -c 9)"
  [ $E -ne 0 ] && { tail -n 5 $O/handoff-package.log | cut -c1-300 | tee -a $LOG; exit 1; }
fi

if ! skip judge; then
  python $O/make_judge_multi.py $O/judge-6.txt $SHIPS | tee -a $LOG
  host jsgb-judge $O/judge-6.txt $O/judge-6 1920 1200 3000
  node $O/judge_check.mjs $O/jsgb-judge.log $SHIPS > $O/judge-6-result.txt 2>&1; tail -n 1 $O/judge-6-result.txt | tee -a $LOG
  step "judge: $(ls $O/judge-6 | wc -l) shots, $(grep -ac 'No cooked material' $O/jsgb-judge.log) materials with no cooked copy"
fi

if ! skip battle; then
  host jsgb-battle $O/goal-battle-clean.txt $O/battle-clean 3840 2160 1200
  node $O/battle-report.mjs $O/jsgb-battle.log > $O/battle-clean-report.txt 2>&1; cat $O/battle-clean-report.txt | head -n 7 | tee -a $LOG
  step "battle memory: $(awk '{print $6}' $O/jsgb-battle-ram.txt | sort -n | sed -n '1p;$p' | awk '{printf "%.1f GB ", $1 / 1048576}') (lowest and highest the game used)"
fi
step "done in $(( ($(date +%s) - T0) / 60 )) minutes"
