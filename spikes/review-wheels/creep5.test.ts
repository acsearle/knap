// Review: separate "toward the floor's pivot" from "toward the fixed root".
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder } from '../../src/core/examples';
import { makeCell, setGround, setRim } from '../../src/core/model';
import { LOGDIR, com, logger, make } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('creep5');
it('pivot vs root', async () => {
  for (const [rootX, extraX] of [[-200, null], [-200, 400], [0, -200], [0, 200]] as [number, number | null][]) {
    const b = new ModelBuilder();
    const root = b.add([makeCell(rootX, 0, 0, 'pinHole', 2)]);
    if (extraX !== null) b.add([makeCell(extraX, 0, 0, 'pinHole', 1)]);
    const w = b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
    const m = setGround(setRim(b.root(root).build(), w, [0, 0, 0], 1.5), true);
    const s = await make(m);
    const bw = s.bodyOf(w)!;
    const c0 = com(s, bw);
    s.stepFixed(480 * 20);
    log(`root x ${rootX} extra loose cell x ${extraX}: dx 20 s ${(com(s, bw)[0] - c0[0]).toExponential(3)}`);
    s.dispose();
  }
}, 600000);
