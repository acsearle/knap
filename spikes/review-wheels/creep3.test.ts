// Review: which option makes the far-root wheel creep?
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder } from '../../src/core/examples';
import { makeCell, setGround, setRim } from '../../src/core/model';
import type { SimOptions } from '../../src/physics/sim';
import { LOGDIR, com, logger, make } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('creep3');
it('toggles', async () => {
  const variants: [string, SimOptions][] = [
    ['default', {}],
    ['no energy guard', { energyGuard: false }],
    ['iters 240', { freeSolverIterations: 240 }],
    ['friction 0', { jointFriction: 0 }],
  ];
  for (const [name, o] of variants) for (const rx of [-200, 200]) {
    const b = new ModelBuilder();
    const root = b.add([makeCell(rx, 0, 0, 'pinHole', 2)]);
    const w = b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
    const m = setGround(setRim(b.root(root).build(), w, [0, 0, 0], 1.5), true);
    const s = await make(m, o);
    const bw = s.bodyOf(w)!;
    const c0 = com(s, bw);
    s.stepFixed(480 * 20);
    log(`${name} root x ${rx}: dx after 20 s ${(com(s, bw)[0] - c0[0]).toExponential(3)} guardRemoved ${s.guardRemoved.toExponential(2)}`);
    s.dispose();
  }
}, 600000);
