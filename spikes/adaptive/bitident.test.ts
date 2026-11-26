// Is dt/k with iterations/k bit-identical to dt with iterations, for each example? Pose hash after
// 2 s at friction off + guard off, friction realistic + guard on (defaults), per k.
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { EXAMPLES, buildExample } from '../../src/core/examples';
import { poseHash } from '../../tests/physics/wheelModels';
import { Simulation } from './sim';
import type { SimOptions } from './sim';

const OUT = process.env.OUT ?? 'spikes/adaptive/out/bitident.jsonl';
it('bitident', async () => {
  writeFileSync(OUT, '');
  const cfgs: [string, SimOptions][] = [['bare', { jointFriction: 0, energyGuard: false }], ['default', {}]];
  for (const e of EXAMPLES) for (const [cn, co] of cfgs) {
    const row: Record<string, unknown> = { name: e.name, cfg: cn };
    let ref: number[] = [];
    for (const k of [1, 2, 4, 8]) {
      const s = await Simulation.create(buildExample(e.name), { ...co, substeps: k });
      s.stepFixed(960);
      const p: number[] = [];
      for (const b of s.graph.bodies) { const t = s.bodyTransform(b.id); if (t) p.push(...t.p); }
      if (k === 1) ref = p;
      let d = 0;
      for (let i = 0; i < p.length; i++) d = Math.max(d, Math.abs(p[i]! - ref[i]!));
      row[`k${k}`] = poseHash(s);
      row[`dpos${k}`] = +d.toExponential(2);
      s.dispose();
    }
    appendFileSync(OUT, JSON.stringify(row) + '\n');
  }
});
