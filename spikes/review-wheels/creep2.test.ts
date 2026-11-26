// Review sweep: a wheel at rest beside a far fixed root (the floor's pivot moves away from the wheel).
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim } from '../../src/core/model';
import { LOGDIR, com, logger, make } from './lib';

mkdirSync(LOGDIR, { recursive: true });
const log = logger('creep2');

it('wheel at rest with a far root', async () => {
  for (const r of [1, 1.5, 2, 4])
    for (const [rx, rz, fixed] of [[-40, -40, true], [-40, -40, false], [-6, 0, true], [-200, 0, true], [0, -200, true], [-1000, 0, true]] as [number, number, boolean][]) {
      const b = new ModelBuilder();
      const root = b.add([makeCell(rx, 0, rz, 'pinHole', 2)]);
      const w = b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
      let m = setRim(b.root(root).build(), w, [0, 0, 0], r);
      m = setGround(m, true);
      if (!fixed) m = setFixRoot(m, false);
      const s = await make(m);
      const bw = s.bodyOf(w)!;
      const c0 = com(s, bw);
      const row: string[] = [];
      for (let t = 1; t <= 30; t++) {
        s.stepFixed(480);
        if (t % 10 === 0) {
          const c = com(s, bw);
          row.push(`t${t}: dx ${(c[0] - c0[0]).toExponential(2)} dz ${(c[2] - c0[2]).toExponential(2)} v ${Math.hypot(...s.bodyVelocity(bw)!.v).toExponential(2)}`);
        }
      }
      log(`r ${r} root (${rx},${rz}) fixed ${fixed} groundY ${s.groundY}: ${row.join(' | ')}`);
      s.dispose();
    }
}, 3600_000);
