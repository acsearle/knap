// Review: a loose wheel dropped onto the bare floor with the wheel's soft-CCD prediction set to p.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import type { World } from '@dimforge/rapier3d-compat';
import { makeCell } from '../../src/core/model';
import { ModelBuilder } from '../../src/core/examples';
import { setFixRoot, setGround, setRim } from '../../src/core/model';
import type { Axis } from '../../src/core/types';
import { LOGDIR, Probe, logger, make } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('dropccd');
it('drop onto floor vs prediction', async () => {
  for (const p of [1.04, 0.5, 0.3, 0.1, 0]) {
    const row: string[] = [];
    for (const [r, axis, h, w] of [[1.5, 2, 10, 0], [4, 2, 10, 0], [2.5, 1, 10, 0], [4, 0, 40, 3], [1, 2, 40, 2]] as [number, Axis, number, number][]) {
      const b = new ModelBuilder();
      b.add([makeCell(-30, 0, 0, 'pinHole', 2)]);
      const hubY = Math.round(h + (axis === 1 ? 0.5 : r));
      const id = b.add([makeCell(0, hubY, 0, 'pinHole', axis)]);
      const m = setGround(setRim(b.root(1).build(), id, [0, hubY, 0], r), true);
      const s = await make(m);
      const wr = (s as unknown as { world: World }).world;
      wr.forEachRigidBody((rb) => { if (Math.abs(rb.translation().y - hubY) < 1e-6) rb.setSoftCcdPrediction(p); });
      const bw = s.bodyOf(id)!;
      if (w) s.setBodyVelocity(bw, [0, 0, 0], [w, 0, w]);
      const P = new Probe(s, m);
      let deep = 0;
      for (let i = 0; i < 480 * 2; i++) { s.stepFixed(1); deep = Math.max(deep, s.groundY! - P.low(bw)); }
      const v = s.bodyVelocity(bw)!;
      row.push(`r${r}/ax${axis}/h${h}: deepest ${deep.toFixed(3)} |v| at 2 s ${Math.hypot(...v.v).toFixed(2)}`);
      s.dispose();
    }
    log(`prediction ${p}: ${row.join(', ')}`);
  }
}, 1800000);
