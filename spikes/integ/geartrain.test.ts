// Gear train example (§8 example 10) measured in the real simulation at each friction level.
import { it } from 'vitest';
import { buildExample } from '../../src/core/examples';
import { Simulation } from '../../src/physics/sim';

const twist = (q: readonly number[]) => 2 * Math.atan2(q[2]!, q[3]!);

it('gear train at each friction level', async () => {
  const lines: string[] = [];
  for (const mu of [0, 0.05, 0.2]) {
    const s = await Simulation.create(buildExample('gear-train'), { jointFriction: mu });
    const ids = { A: 3, P: 2, Q: 4 };
    const last: Record<string, number> = {};
    const acc: Record<string, number> = { A: 0, P: 0, Q: 0 };
    for (const k of Object.keys(ids)) last[k] = twist(s.partTransform(ids[k as 'A'])!.q);
    const e0 = s.energy();
    const E0 = e0.kinetic + e0.potential;
    let emax = -Infinity;
    let emin = Infinity;
    let kmax = 1;
    let ratioErrP = 0;
    let ratioErrQ = 0;
    let phaseMax = 0;
    let disengaged = 0;
    let jerr = 0;
    let restAt = -1;
    let wPmax = 0;
    let armLo = Infinity;
    let armHi = -Infinity;
    const steps = 30 * 480;
    const t0 = performance.now();
    let stepMs = 0;
    for (let i = 1; i <= steps; i++) {
      const a = performance.now();
      s.stepFixed(1);
      stepMs += performance.now() - a;
      for (const k of Object.keys(ids)) {
        const th = twist(s.partTransform(ids[k as 'A'])!.q);
        let d = th - last[k]!;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        acc[k]! += d;
        last[k] = th;
      }
      armLo = Math.min(armLo, acc.A!);
      armHi = Math.max(armHi, acc.A!);
      if (Math.abs(acc.A!) > 0.05) {
        ratioErrP = Math.max(ratioErrP, Math.abs(acc.P! / acc.A! + 5));
        ratioErrQ = Math.max(ratioErrQ, Math.abs(acc.Q! / acc.A! - 5 / 3));
      }
      const ms = s.meshStates();
      if (ms.length !== 2) disengaged++;
      for (const m of ms) phaseMax = Math.max(phaseMax, Math.abs(m.phaseErrorTeeth));
      kmax = Math.max(kmax, s.substeps);
      jerr = Math.max(jerr, s.jointError());
      const w = s.bodyVelocity(s.bodyOf(2)!)!.w;
      wPmax = Math.max(wPmax, Math.abs(w[2]));
      const e = s.energy();
      const E = e.kinetic + e.potential;
      emax = Math.max(emax, E);
      emin = Math.min(emin, E);
      if (restAt < 0 && i > 480 && e.kinetic < 1e-6 * Math.abs(E0)) restAt = s.time;
    }
    const wall = performance.now() - t0;
    const e = s.energy();
    lines.push(
      `mu ${mu}: arm range ${((armLo * 180) / Math.PI).toFixed(1)}…${((armHi * 180) / Math.PI).toFixed(1)}° ; final A ${((acc.A! * 180) / Math.PI).toFixed(2)}° P/A ${(acc.P! / acc.A!).toFixed(6)} Q/A ${(acc.Q! / acc.A!).toFixed(6)}; max |P/A+5| ${ratioErrP.toExponential(2)} |Q/A-5/3| ${ratioErrQ.toExponential(2)}; phase ≤ ${phaseMax.toExponential(2)} teeth; steps not both engaged ${disengaged}; joint err ≤ ${jerr.toExponential(2)}; k max ${kmax}; |ωP| max ${wPmax.toFixed(1)} rad/s; E0 ${E0.toFixed(1)} Emax-E0 ${(emax - E0).toExponential(2)} (${(((emax - E0) / Math.abs(E0)) * 100).toFixed(4)}% of |E0|) Emin-E0 ${(emin - E0).toFixed(1)}; E(30s)-E0 ${(e.kinetic + e.potential - E0).toFixed(1)} KE(30s) ${e.kinetic.toExponential(2)}; rest at ${restAt.toFixed(2)} s; ${(stepMs / steps).toFixed(3)} ms per fixed step (wall ${(wall / 1000).toFixed(1)} s)`,
    );
    s.dispose();
  }
  console.log(lines.join('\n'));
  (await import('node:fs')).writeFileSync('spikes/integ/geartrain.txt', lines.join('\n') + '\n');
});
