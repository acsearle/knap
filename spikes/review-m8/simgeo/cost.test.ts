// Cost: ms per fixed step of the Gear train example and a 6-gear train, against the same models with
// plain wheels (gears → plain rims of the same radius; an 8 → a bare hole).
import { it } from 'vitest';
import { appendFileSync } from 'node:fs';
import { exampleByName } from '../../../src/core/examples';
import { makeCell, validateModel } from '../../../src/core/model';
import type { Model } from '../../../src/core/types';
import { Simulation } from '../../../src/physics/sim';
import { chain } from './lib';

const OUT = 'spikes/review-m8/simgeo/cost.out';
const log = (s: string) => {
  console.log(s);
  appendFileSync(OUT, s + '\n');
};

function plain(m: Model): Model {
  const out: Model = { ...m, parts: m.parts.map((p) => ({ ...p, cells: p.cells.map((c) => (c.teeth ? makeCell(c.x, c.y, c.z, c.kind, c.axis, c.rim! >= 1 ? c.rim : undefined) : c)) })) };
  const errs = validateModel(out);
  if (errs.length) throw new Error(JSON.stringify(errs.slice(0, 2)));
  return out;
}

async function time(label: string, m: Model, seconds: number, spin?: (s: Simulation) => void): Promise<number> {
  // warm up once, then three runs; report the median ms per fixed step
  const runs: number[] = [];
  let kInfo = '';
  for (let r = 0; r < 4; r++) {
    const s = await Simulation.create(m);
    spin?.(s);
    const n = Math.round(seconds * 480);
    const t0 = performance.now();
    s.stepFixed(n);
    const dt = (performance.now() - t0) / n;
    if (r) runs.push(dt);
    kInfo = `world steps ${s.worldSteps}/${n}`;
    s.dispose();
  }
  runs.sort((a, b) => a - b);
  const med = runs[1]!;
  log(`${label}: ${med.toFixed(3)} ms per fixed step (runs ${runs.map((x) => x.toFixed(3)).join(', ')}), ${kInfo}`);
  return med;
}

it('cost', async () => {
  appendFileSync(OUT, `--- ${new Date().toISOString()} load ${(await import('node:os')).loadavg().map((x) => x.toFixed(1)).join(' ')}\n`);
  const gt = exampleByName('gear-train')!.build();
  const a = await time('gear-train example, 10 s', gt, 10);
  const b = await time('gear-train with plain wheels, 10 s', plain(gt), 10);
  log(`  ratio ${(a / b).toFixed(2)}`);
  const c6 = chain(2, [1, 1, 1, 1, 1, 1], { arm: 4 });
  const spin = (s: Simulation) => {
    c6.parts.forEach((p, i) => s.setBodyVelocity(s.bodyOf(p)!, [0, 0, 0], [0, 0, i % 2 ? -10 : 10]));
  };
  const c = await time('6-gear train (16s) with an arm, spun 10 rad/s, 10 s', c6.model, 10, spin);
  const d = await time('same with plain wheels r 1', plain(c6.model), 10, spin);
  log(`  ratio ${(c / d).toFixed(2)}`);
  appendFileSync(OUT, `load after ${(await import('node:os')).loadavg().map((x) => x.toFixed(1)).join(' ')}\n`);
});
