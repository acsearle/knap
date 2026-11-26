// Review sweep: does a loose wheel at rest on the ground stay at rest? 60 s, r 1 … 4, axes X and Z.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim } from '../../src/core/model';
import type { Axis } from '../../src/core/types';
import { LOGDIR, com, logger, make } from './lib';

mkdirSync(LOGDIR, { recursive: true });
const log = logger('creep');

it('loose wheel at rest, 60 s', async () => {
  const radii = (process.env.RADII ?? '1,1.5,2,2.5,3,3.5,4').split(',').map(Number);
  const axes = (process.env.AXES ?? '2,0').split(',').map(Number) as Axis[];
  for (const axis of axes)
    for (const r of radii) {
      const b = new ModelBuilder();
      b.add([makeCell(0, 0, 0, 'pinHole', axis)]);
      const m = setFixRoot(setGround(setRim(b.build(), 1, [0, 0, 0], r), true), false);
      const s = await make(m, process.env.ITERS ? { freeSolverIterations: +process.env.ITERS } : {});
      const c0 = com(s, 0);
      const row: string[] = [];
      for (let t = 1; t <= 60; t++) {
        s.stepFixed(480);
        if (t % 10 === 0 || t === 5) {
          const c = com(s, 0);
          const v = s.bodyVelocity(0)!;
          row.push(`t${t}: dx ${(c[0] - c0[0]).toExponential(2)} dz ${(c[2] - c0[2]).toExponential(2)} dy ${(c[1] - c0[1]).toExponential(2)} v ${Math.hypot(...v.v).toExponential(2)} w ${Math.hypot(...v.w).toExponential(2)}`);
        }
      }
      log(`axis ${axis} r ${r}: ${row.join(' | ')}`);
      s.dispose();
    }
}, 3600_000);
