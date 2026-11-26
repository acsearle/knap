// Is there energy creation (skeptic's +2.3 mgL) with a heavy arm on a back-driven 1:25? Arm 10 holes
// with an r 2.5 disc at the tip (a weight), released horizontal, μ 0, guard off / on, k 1, 2, 4.
import { Angle, G, Simulation, crane, energyTotal, f, maxGearOmega, out, putRims, train } from './lib';
for (const guard of [false, true])
  for (const k of [1, 2, 4]) {
    const M = crane('1:25', 10);
    const t = train(M.cols);
    const last = t.parts[t.parts.length - 1]!;
    const m = putRims(t.model, [{ part: last, pos: [16, 0, 3], r: 2.5 }]);
    const s = await Simulation.create(m, { jointFriction: 0, substeps: k, energyGuard: guard });
    const ob = s.bodyOf(last)!;
    const mi = s.massInfo(ob)!;
    const mgL = mi.mass * G * (mi.com[0] - 6);
    const E0 = energyTotal(s);
    const ang = new Angle(s, ob);
    const a0 = ang.get();
    let emin = 0, emax = 0, wmax = 0, amin = 0, amax = 0;
    for (let i = 0; i < 480 * 3; i++) {
      s.stepFixed(1);
      const e = (energyTotal(s) - E0) / mgL;
      emin = Math.min(emin, e); emax = Math.max(emax, e);
      wmax = Math.max(wmax, maxGearOmega(s));
      const a = ang.get() - a0; amin = Math.min(amin, a); amax = Math.max(amax, a);
    }
    out(`heavy 1:25 k ${k} guard ${guard}: arm mass ${f(mi.mass, 1)} | (E−E0)/mgL [${f(emin, 3)}, ${f(emax, 3)}] | max ω ${f(wmax, 1)} (${f(wmax * s.h, 3)} rad/step) | arm angle range [${f(amin, 2)}, ${f(amax, 2)}] rad (frictionless: [−π, 0]) | guardRemoved/mgL ${f(s.guardRemoved / mgL, 2)}`);
    s.dispose();
  }
process.exit(0);
