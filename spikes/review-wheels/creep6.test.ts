// Review: far-pivot creep with soft CCD patched out, and with the hub/guard colliders' groups cleared.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { RAPIER } from '../../src/physics/rapier';
import { ModelBuilder } from '../../src/core/examples';
import { makeCell, setGround, setRim } from '../../src/core/model';
import { LOGDIR, com, logger, make } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('creep6');
it('soft ccd?', async () => {
  const orig = RAPIER.RigidBody.prototype.setSoftCcdPrediction;
  for (const ccd of [true, false]) for (const r of [1, 1.5, 4]) {
    RAPIER.RigidBody.prototype.setSoftCcdPrediction = ccd ? orig : function () {};
    const b = new ModelBuilder();
    const root = b.add([makeCell(-200, 0, 0, 'pinHole', 2)]);
    const w = b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
    const m = setGround(setRim(b.root(root).build(), w, [0, 0, 0], r), true);
    const s = await make(m);
    const bw = s.bodyOf(w)!;
    const c0 = com(s, bw);
    s.stepFixed(480 * 20);
    log(`soft CCD ${ccd} r ${r}: dx 20 s ${(com(s, bw)[0] - c0[0]).toExponential(3)}`);
    s.dispose();
  }
  RAPIER.RigidBody.prototype.setSoftCcdPrediction = orig;
}, 600000);
