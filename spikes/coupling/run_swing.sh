#!/bin/sh
# Swing-arm selector sweep: writes out/swing_*.txt. Run from anywhere: sh spikes/coupling/run_swing.sh
cd "$(dirname "$0")"
i=0
for V in \
 '{"name":"A snap rate.002 eps.02 band.03 hyst.10","snap":true,"maxCorr":0.002,"eps":0.02,"band":0.03,"hyst":0.10}' \
 '{"name":"B snap rate.002 eps.05 band.03 hyst.10","snap":true,"maxCorr":0.002,"eps":0.05,"band":0.03,"hyst":0.10}' \
 '{"name":"C snap rate.001 eps.05 band.06 hyst.10","snap":true,"maxCorr":0.001,"eps":0.05,"band":0.06,"hyst":0.10}' \
 '{"name":"D snap rate.005 eps.05 band.03 hyst.10","snap":true,"maxCorr":0.005,"eps":0.05,"band":0.03,"hyst":0.10}' \
 '{"name":"E snap rate.002 eps.05 band.03 hyst.10 sep20","snap":true,"maxCorr":0.002,"eps":0.05,"band":0.03,"hyst":0.10,"sep":true}' \
 '{"name":"F snap rate.002 eps.05 band.03 hyst.10 planet mu.2 arm mu0","snap":true,"maxCorr":0.002,"eps":0.05,"band":0.03,"hyst":0.10,"mu":0.2,"armMu":0}' \
 '{"name":"G snap rate.002 eps.05 band.03 hyst.10 planet mu.2 arm mu.05","snap":true,"maxCorr":0.002,"eps":0.05,"band":0.03,"hyst":0.10,"mu":0.2,"armMu":0.05}' \
 '{"name":"H nosnap eps.05 band.03 hyst.10","snap":false,"maxCorr":1e9,"eps":0.05,"band":0.03,"hyst":0.10}' \
 ; do i=$((i+1)); VARIANTS="[$V]" node q4_planet.mjs swing > out/swing_$i.txt 2>&1 & done
wait
