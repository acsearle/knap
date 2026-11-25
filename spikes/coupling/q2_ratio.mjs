// Q2: ratio accuracy and phase error of a driven gear pair on fixed revolutes.
// usage: node q2_ratio.mjs <axis X|Y|Z> <mode fb|nofb|static|swap> <seconds> <pairs "r1:r2,..."> <speeds "1,10,...">
import { makeWorld, makeGear, pinGear, Mesh, motor, omega, gearFrame, twist, AXES, basis, scl, PITCH, DT, fmt, revError, now } from './lib.mjs';

const [axisName = 'Z', mode = 'fb', secs = '60', pairsArg = '0.5:1,1:0.5,0.5:2.5,2.5:0.5,1:1,1.5:2.5', speedsArg = '1,10,50,200'] = process.argv.slice(2);
const axis = AXES[axisName];
const pairs = pairsArg.split(',').map((p) => p.split(':').map(Number));
const speeds = speedsArg.split(',').map(Number);
const steps = Math.round(Number(secs) / DT);

for (const [r1, r2] of pairs) {
  for (const w1 of speeds) {
    const W = makeWorld();
    const [e1] = basis(axis);
    const g1 = makeGear(W, { centre: [0, 0, 0], axis, r: r1 });
    const g2 = makeGear(W, { centre: scl(e1, r1 + r2), axis, r: r2 });
    const j1 = pinGear(W, g1);
    const j2 = pinGear(W, g2);
    motor(W, j1, w1);
    const swap = mode === 'swap';
    const lead = mode.startsWith('lead');
    const leadSign = mode === 'leadneg' ? -1 : 1;
    const m = swap ? new Mesh(W, g2, g1, { feedback: true }) : new Mesh(W, g1, g2, { feedback: mode === 'fb' || mode === 'swap' || lead || mode === 'leadnofb' ? mode !== 'leadnofb' : false, reanchor: mode !== 'static', lead, leadSign });
    const s1 = {}, s2 = {};
    let th10, th20, sumDev2 = 0, nDev = 0, maxDev = 0, maxRev = 0;
    const t0 = now();
    for (let i = 0; i < steps; i++) {
      m.update();
      W.w.step();
      const th1 = twist(gearFrame(g1).q, axis, s1);
      const th2 = twist(gearFrame(g2).q, axis, s2);
      if (i === 0) [th10, th20] = [th1, th2];
      if (i > 480) {
        const o1 = omega(g1.body, axis);
        const o2 = omega(g2.body, axis);
        const dev = o2 / o1 / (-r1 / r2) - 1;
        sumDev2 += dev * dev;
        nDev++;
        maxDev = Math.max(maxDev, Math.abs(dev));
        if (i % 97 === 0) maxRev = Math.max(maxRev, revError(j1).lin, revError(j2).lin);
      }
    }
    const ms = now() - t0;
    m.update();
    const th1 = twist(gearFrame(g1).q, axis, s1);
    const th2 = twist(gearFrame(g2).q, axis, s2);
    const meanRatio = (th2 - th20) / (th1 - th10);
    const o1 = omega(g1.body, axis);
    const ePhase = swap ? m.e : m.e; // units of arc
    console.log(JSON.stringify({
      axis: axisName, mode, r1, r2, w1, w1meas: +o1.toFixed(4), w2expect: -w1 * r1 / r2,
      meanRatioErr: meanRatio / (-r1 / r2) - 1,
      instRatioRmsErr: Math.sqrt(sumDev2 / Math.max(1, nDev)), instRatioMaxErr: maxDev,
      phaseErrTeeth: ePhase / PITCH, maxPhaseErrTeeth: m.maxAbsE / PITCH,
      maxRevolute: maxRev, msPerSimS: ms / (steps * DT),
    }));
  }
}

// Exit explicitly: at exit Node 20 spins on Rapier wasm-bindgen finalizers (measured: minutes of CPU after the last line).
process.exit(0);
