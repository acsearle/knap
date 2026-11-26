import { it } from 'vitest';
import { gearPair, idlerChain, omega } from '../../tests/physics/gearModels';
import { Simulation } from '../../src/physics/sim';
it('guard4', async () => {
  for (const [label, opts] of [['it240', {}], ['it120', { solverIterations: 120 }], ['it480', { solverIterations: 480 }], ['pgs2', { pgsIterations: 2 }], ['dt960', { fixedDt: 1 / 960 }], ['nodecouple', { decoupleInertia: false }]] as const)
    for (const [name, mk] of [['1:1', () => gearPair(1, 1)], ['single', () => idlerChain(1)]] as const) {
      const rig = mk();
      const s = await Simulation.create(rig.model, { jointFriction: 0, energyGuard: false, gravity: [0, 0, 0], ...opts });
      const A = s.bodyOf((rig.part.A ?? rig.part.G0)!)!;
      s.stepFixed(1);
      s.setBodyVelocity(A, [0, 0, 0], [0, 0, 20]);
      if (rig.part.B) s.setBodyVelocity(s.bodyOf(rig.part.B)!, [0, 0, 0], [0, 0, -20]);
      s.stepFixed(2);
      const K0 = s.energy().kinetic;
      const n = Math.round(2 / s.fixedDt);
      s.stepFixed(n);
      console.log(`S ${label} ${name}: K gain ${(100 * (s.energy().kinetic / K0 - 1) / 2).toFixed(3)} %/s, wA ${omega(s, A).toFixed(3)}`);
      s.dispose();
    }
}, 600000);
