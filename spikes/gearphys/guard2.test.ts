import { it } from 'vitest';
import { gearPair, idlerChain, omega } from '../../tests/physics/gearModels';
import { Simulation } from '../../src/physics/sim';
it('guard2', async () => {
  for (const [name, mk, ratio] of [['1:1', () => gearPair(1, 1), -1], ['1:5', () => gearPair(0.5, 2.5), -0.2], ['single', () => idlerChain(1), 0]] as const)
    for (const w of [5, 20, 50]) for (const k of [1, 4] as const) {
      const rig = mk();
      const s = await Simulation.create(rig.model, { jointFriction: 0, energyGuard: false, gravity: [0, 0, 0], substeps: k });
      const A = s.bodyOf((rig.part.A ?? rig.part.G0)!)!;
      s.stepFixed(1);
      s.setBodyVelocity(A, [0, 0, 0], [0, 0, w]);
      if (ratio) s.setBodyVelocity(s.bodyOf(rig.part.B!)!, [0, 0, 0], [0, 0, w * ratio]);
      s.stepFixed(2);
      const K0 = s.energy().kinetic;
      s.stepFixed(960);
      console.log(`H ${name} w ${w} k ${k}: K gain ${(100 * (s.energy().kinetic / K0 - 1) / 2).toFixed(3)} %/s, wA ${omega(s, A).toFixed(3)}`);
      s.dispose();
    }
}, 600000);
