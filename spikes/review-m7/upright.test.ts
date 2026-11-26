// Item 6 follow-up: an UPRIGHT wheel resting on a beam (not the documented lying-flat case).
// Run: npx vitest run --config spikes/review-m7/vitest.config.ts upright
import { it } from 'vitest';
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim } from '../../src/core/model';
import type { Model } from '../../src/core/types';
import { Simulation } from '../../src/physics/sim';
import { logger } from './lib';
import { depth } from './depthlib';

const log = logger('upright');

it('loose upright wheel resting on a beam: rim depth below the beam top over 20 s', async () => {
  for (const r of [1, 1.5, 2.5, 4])
    for (const variant of ['fixed beam, no ground', 'fixed beam, ground', 'loose beam on ground']) {
      const b = new ModelBuilder();
      // beam lying flat (holes ∥ Y) in layer y = −1 − ceil(r − 0.5) so its top (y + 0.46) is at or below hub − r
      const by = -Math.ceil(r + 0.5);
      const bm = b.add(beam([-5, by, 0], [5, by, 0], 1));
      const w = b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
      let m: Model = setRim(b.root(bm).build(), w, [0, 0, 0], r);
      if (variant !== 'fixed beam, no ground') m = setGround(m, true);
      if (variant === 'loose beam on ground') m = setFixRoot(m, false);
      const s = await Simulation.create(m);
      const bw = s.bodyOf(w)!;
      const top = by + 0.46;
      const rows: string[] = [];
      let worst = -Infinity;
      for (let k = 1; k <= 20; k++) {
        s.stepFixed(480);
        // the wheel stays upright: its lowest rim point is com.y − (r − 0.04)
        const d = depth(s, m.parts.find((p) => p.id === w)!.cells[0]!, w, { a: [-5, by, 0], b: [5, by, 0], hole: 1, part: bm });
        worst = Math.max(worst, d);
        if (k === 1 || k === 5 || k === 20) rows.push(d.toFixed(4));
      }
      const v = Math.hypot(...s.bodyVelocity(bw)!.v);
      s.dispose();
      log(`r ${r}, ${variant}: start gap ${(-(top - (0 - (r - 0.04)))).toFixed(3)}; depth of the rim below the beam top at 1/5/20 s ${rows.join('/')} (worst ${worst.toFixed(4)}), speed at 20 s ${v.toExponential(1)}`);
    }
}, 1800000);
