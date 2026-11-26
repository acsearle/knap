// Review: a free 4-bar lying on the floor creeps; is it the ground-collider ordering (far-pivot) effect?
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder, beam, pin } from '../../src/core/examples';
import { setFixRoot, setGround } from '../../src/core/model';
import { LOGDIR, com, dist, logger, make, maxSpeed } from './lib';
import { groundFirst } from './groundfirst';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('fourbar-floor');
it('free 4-bar on the floor', async () => {
  for (const fix of [false, true]) for (const pinsUp of [false, true]) {
    groundFirst(fix);
    const b = new ModelBuilder();
    // pinsUp: the pins sit in layers 1–2 only, so none protrudes below the bottom beam
    const y0 = pinsUp ? 0 : 0;
    const g = b.add(beam([0, y0, 0], [4, y0, 0], 1));
    b.add(beam([0, 1, 0], [0, 1, 3], 1));
    b.add(beam([4, 1, 0], [4, 1, 3], 1));
    b.add(beam([0, 2, 3], [4, 2, 3], 1));
    b.add(pin([0, 0, 0], [0, 1, 0], 1));
    b.add(pin([4, 0, 0], [4, 1, 0], 1));
    b.add(pin([0, 1, 3], [0, 2, 3], 1));
    b.add(pin([4, 1, 3], [4, 2, 3], 1));
    let m = b.root(g).build();
    if (pinsUp) {
      // move the whole model up one layer and add a flat 5-hole plate under it? keep as is but report the protrusion
    }
    m = setFixRoot(setGround(m, true), false);
    const s = await make(m);
    s.stepFixed(480 * 10);
    const c0 = s.graph.bodies.map((x) => com(s, x.id));
    s.stepFixed(480 * 10);
    const d = Math.max(...s.graph.bodies.map((x, i) => dist(com(s, x.id), c0[i]!)));
    log(`ground first ${fix}: drift 10–20 s ${d.toExponential(2)} maxSpeed ${JSON.stringify(maxSpeed(s))} groundY ${s.groundY}`);
    s.dispose();
    if (pinsUp) break;
  }
  groundFirst(false);
}, 1800000);
