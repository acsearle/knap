import { it } from 'vitest';
import { AngleZ, compound25, gearPair, maxOmega } from '../../tests/physics/gearModels';
import { Simulation } from '../../src/physics/sim';
it('friction levels', async () => {
  for (const [name, mk, out] of [['1:1 arm 4', () => gearPair(1, 1, { armB: 4 }), 'B'], ['1:5 arm 6', () => gearPair(0.5, 2.5, { armB: 6 }), 'B'], ['1:25 arm 6', () => compound25(6), 'C']] as const)
    for (const mu of [0, 0.05, 0.2]) {
      const rig = mk();
      const s = await Simulation.create(rig.model, { jointFriction: mu });
      const a = new AngleZ(s, s.bodyOf(rig.part[out]!)!); a.get();
      let tBottom = NaN, rest = NaN, minA = 0, kMax = 1;
      for (let i = 1; i <= 480 * 30; i++) {
        s.stepFixed(1); const th = a.get(); minA = Math.min(minA, th); kMax = Math.max(kMax, s.substeps);
        if (Number.isNaN(tBottom) && th <= -Math.PI / 2) tBottom = s.time;
        if (Number.isNaN(rest) && i % 48 === 0 && maxOmega(s) < 1e-3) rest = s.time;
        if (!Number.isNaN(rest) && i > rest * 480 + 480) break;
      }
      console.log(`F ${name} μ ${mu}: bottom at ${tBottom.toFixed(3)} s, lowest angle ${(minA * 180 / Math.PI).toFixed(1)}°, at rest (|ω| < 1e-3) at ${Number.isNaN(rest) ? '> 30' : rest.toFixed(2)} s, final angle ${(a.get() * 180 / Math.PI).toFixed(2)}°, k max ${kMax}, guard removed ${s.guardRemoved.toFixed(0)}`);
      s.dispose();
    }
}, 900000);
