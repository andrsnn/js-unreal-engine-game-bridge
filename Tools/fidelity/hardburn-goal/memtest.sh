#!/bin/bash
# memtest.sh: the clean 5-minute 4K battle on the live TDF build, run while the MRN batch recolours (no Unreal then).
O=H:/captures/jsgb-goal
timeout 10800 bash -c "until grep -q 'game paint projected' $O/batch-mrn.log 2>/dev/null; do sleep 30; done" || { echo "MRN bake never finished"; exit 1; }
tasklist | grep -qiE "UnrealEditor|JsgbHost.exe" && { echo "Unreal open, skipped"; exit 1; }
SKIP="guns package judge" PKG=H:/builds/HardBurnUnreal-fallback bash $O/handoff-run.sh 7bbaeed5
