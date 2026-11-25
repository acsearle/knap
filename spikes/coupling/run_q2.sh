#!/bin/sh
# Q2 matrix: writes out/q2.jsonl. Run from spikes/coupling: sh run_q2.sh
cd "$(dirname "$0")"
: > out/q2.jsonl
ALL="0.5:0.5,0.5:1,0.5:1.5,0.5:2.5,1:0.5,1:1,1:1.5,1:2.5,1.5:0.5,1.5:1,1.5:1.5,1.5:2.5,2.5:0.5,2.5:1,2.5:1.5,2.5:2.5"
{
  for m in fb lead nofb leadnofb; do for w in 1 10 50 200; do echo "Z $m 60 $ALL $w"; done; done
  for a in X Y; do for m in fb lead; do for w in 1 10 50 200; do echo "$a $m 60 0.5:2.5,1:1,1.5:1 $w"; done; done; done
} | xargs -P 6 -L 1 sh -c 'node q2_ratio.mjs $0 $1 $2 $3 $4 >> out/q2.jsonl'
