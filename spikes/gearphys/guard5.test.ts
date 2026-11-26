import { it } from 'vitest';
import { gearPair, idlerChain, omega } from '../../tests/physics/gearModels';
import { Simulation } from '../../src/physics/sim';
import { makeCell } from '../../src/core/model';
import type { Model } from '../../src/core/types';
const shift = (m: Model, d: number): Model => ({ ...m, parts: m.parts.map((p) => ({ ...p, cells: p.cells.map((c) => makeCell(c.x + d, c.y + d, c.z, c.kind, c.axis, c.rim, c.teeth)) })) });
it('guard5', async () => {
  for (const off of [0, 30, 300])
    for (const [name, mk] of [['1:1', () => gearPair(1, 1)], ['single', () => idlerChain(1)]] as const) {
      const rig = mk();
      const s = await Simulation.create(shift(rig.model, off), { jointFriction: 0, energyGuard: false, gravity: [0, 0, 0] });
      const A = s.bodyOf((rig.part.A ?? rig.part.G0)!)!;
      s.stepFixed(1);
      s.setBodyVelocity(A, [0, 0, 0], [0, 0, 20]);
      if (rig.part.B) s.setBodyVelocity(s.bodyOf(rig.part.B)!, [0, 0, 0], [0, 0, -20]);
      s.stepFixed(2);
      const K0 = s.energy().kinetic;
      s.stepFixed(960);
      console.log(`O off ${off} ${name}: K gain ${(100 * (s.energy().kinetic / K0 - 1) / 2).toFixed(3)} %/s, wA ${omega(s, A).toFixed(3)}, phase ${s.meshStates()[0]?.phaseErrorTeeth.toExponential(2)}`);
      s.dispose();
    }
}, 600000);
