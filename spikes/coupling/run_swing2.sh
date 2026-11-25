#!/bin/sh
# Swing-arm selector sweep with the pitch-distance stop row: writes out/swing2_*.txt
cd "$(dirname "$0")"
i=0
for V in \
 '{"name":"I stop snap rate.002 eps.16 band.03 hyst.10","stop":true,"snap":true,"maxCorr":0.002,"eps":0.16,"band":0.03,"hyst":0.10}' \
 '{"name":"J stop nosnap eps.16 band.03 hyst.10","stop":true,"snap":false,"maxCorr":1e9,"eps":0.16,"band":0.03,"hyst":0.10}' \
 '{"name":"K stop snap rate.002 eps.16 planet mu.2 arm mu.05","stop":true,"snap":true,"maxCorr":0.002,"eps":0.16,"band":0.03,"hyst":0.10,"mu":0.2,"armMu":0.05}' \
 '{"name":"L stop snap rate.002 eps.16 sep20","stop":true,"snap":true,"maxCorr":0.002,"eps":0.16,"band":0.03,"hyst":0.10,"sep":true}' \
 '{"name":"M stop snap full eps.16","stop":true,"snap":true,"maxCorr":1e9,"eps":0.16,"band":0.03,"hyst":0.10}' \
 '{"name":"N stop snap rate.002 eps.02 band.03 hyst.10","stop":true,"snap":true,"maxCorr":0.002,"eps":0.02,"band":0.03,"hyst":0.10}' \
 ; do i=$((i+1)); VARIANTS="[$V]" node q4_planet.mjs swing > out/swing2_$i.txt 2>&1 & done
wait
