#!/bin/bash
# watch.sh <log> <pattern> <process regex> [seconds]: waits at most 3 minutes (or the seconds given) for the pattern to
# appear in the log, and stops early when no process matching the regex is alive. Prints what it saw.
L=$1; P=$2; R=$3; S=${4:-180}; T0=$(date +%s)
while [ $(( $(date +%s) - T0 )) -lt $S ]; do
  grep -aqE "$P" "$L" 2>/dev/null && { echo "[$(date +%T)] seen: $(grep -aE "$P" "$L" | tail -n 1 | cut -c1-160)"; exit 0; }
  tasklist | grep -qiE "$R" || { echo "[$(date +%T)] NO PROCESS matching $R is alive; last log line: $(tail -n 1 "$L" | cut -c1-200)"; exit 2; }
  sleep 10
done
echo "[$(date +%T)] still waiting; alive: $(tasklist | grep -iE "$R" | awk '{print $1}' | sort -u | tr '\n' ' '); log last changed $(date -r "$L" +%T); last line: $(tail -n 1 "$L" | cut -c1-160)"; exit 1
