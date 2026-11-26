// Review: the far-from-pivot creep with and without the suggested ground-first fix; and the cart at rest.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder } from '../../src/core/examples';
import { makeCell, setGround, setRim } from '../../src/core/model';
import { buildExample } from '../../src/core/examples';
import { LOGDIR, com, dist, logger, make } from './lib';
import { groundFirst } from './groundfirst';
import { cart } from '../../tests/physics/wheelModels';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('fix-creep');
it('lone wheel 100 from the pivot', async () => {
  for (const fix of [false, true]) {
    groundFirst(fix);
    for (const r of [1, 1.5, 4]) {
      const b = new ModelBuilder();
      const root = b.add([makeCell(-200, 0, 0, 'pinHole', 2)]);
      const w = b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
      const m = setGround(setRim(b.root(root).build(), w, [0, 0, 0], r), true);
      const s = await make(m);
      const bw = s.bodyOf(w)!;
      const c0 = com(s, bw);
      s.stepFixed(480 * 20);
      log(`fix ${fix} r ${r}: dx 20 s ${(com(s, bw)[0] - c0[0]).toExponential(3)}`);
      s.dispose();
    }
  }
  groundFirst(false);
}, 600000);

it('cart and cart example at rest 30 s, friction off and realistic', async () => {
  for (const fix of [false, true]) {
    groundFirst(fix);
    for (const [name, m] of [['5.3 cart', cart().model], ['Cart example', buildExample('cart')]] as const)
      for (const mu of [0, 0.2]) {
        const s = await make(m, { jointFriction: mu });
        s.stepFixed(480 * 5);
        const c0 = s.graph.bodies.map((b) => com(s, b.id));
        const j0 = s.jointStates().map((j) => j.omega);
        let maxW = 0;
        for (let i = 0; i < 25 * 48; i++) {
          s.stepFixed(10);
          for (const j of s.jointStates()) maxW = Math.max(maxW, Math.abs(j.omega));
        }
        const drift = Math.max(...s.graph.bodies.map((b, i) => dist(com(s, b.id), c0[i]!)));
        log(`fix ${fix} ${name} mu ${mu}: drift 5-30 s ${drift.toExponential(2)} max joint |omega| 5-30 s ${maxW.toExponential(2)} rad/s jointErr ${s.jointError().toExponential(2)} ${j0.length}`);
        s.dispose();
      }
  }
  groundFirst(false);
}, 1800000);
