// Item 5 (heavier version of the review test): kinematics fuzz.
// Run: npx vitest run --config spikes/review-m7/vitest.config.ts kfuzz
import { expect, it } from 'vitest';
import { analyze } from '../../src/core/kinematics';
import { rootIsFixed } from '../../src/core/model';
import { analyze as analyzeM6 } from './m6/core/kinematics';
import type { Model as ModelM6 } from './m6/core/types';
import { bruteAnalyze } from './kbrute';
import { randomModel, variants } from './kgen';
import { logger } from './lib';

const log = logger('kfuzz');
const json = (g: ReturnType<typeof analyze>) => JSON.stringify({ m: g.mates, b: g.bodies, j: g.joints, p: [...g.bodyOfPart] });

it('fixed-root models analyse bit-identically to milestone 6; brute force agrees on pin/beam models', () => {
  let same = 0;
  let diff = 0;
  let bruteN = 0;
  let bruteBad = 0;
  const ex: string[] = [];
  for (let seed = 1; seed <= 20000; seed++) {
    const beamsOnly = seed % 2 === 0;
    const base = randomModel(seed, beamsOnly);
    for (const v of variants(base)) {
      const g = analyze(v.m);
      if (rootIsFixed(v.m)) {
        if (json(g) === json(analyzeM6(v.m as unknown as ModelM6) as unknown as ReturnType<typeof analyze>)) same++;
        else {
          diff++;
          if (ex.length < 10) ex.push(`m6 differs: seed ${seed} ${v.label}`);
        }
      }
      if (beamsOnly) {
        bruteN++;
        const b = bruteAnalyze(v.m);
        const repOf = (pid: number) => Math.min(...g.bodies[g.bodyOfPart.get(pid)!]!.partIds);
        const problems: string[] = [];
        for (const p of v.m.parts) if (repOf(p.id) !== b.rep.get(p.id)) problems.push(`part ${p.id} in body ${repOf(p.id)} (brute ${b.rep.get(p.id)})`);
        const fixed = g.bodies.filter((x) => x.fixed).map((x) => Math.min(...x.partIds));
        if (JSON.stringify(fixed) !== JSON.stringify(b.fixedRep === null ? [] : [b.fixedRep])) problems.push(`fixed ${fixed} (brute ${b.fixedRep})`);
        const js = new Set(g.joints.map((j) => `${Math.min(...g.bodies[j.bodyA]!.partIds)},${Math.min(...g.bodies[j.bodyB]!.partIds)}|${j.origin[0]},${j.origin[1]}`));
        const types = new Set(g.joints.map((j) => j.type));
        if ([...types].some((t) => t !== 'revolute')) problems.push(`non-revolute joint ${[...types]}`);
        if (js.size !== b.joints.size || [...js].some((k) => !b.joints.has(k))) problems.push(`joints ${[...js].sort()} (brute ${[...b.joints].sort()})`);
        if (problems.length) {
          bruteBad++;
          if (ex.length < 20) ex.push(`brute: seed ${seed} ${v.label}: ${problems.join('; ')}`);
        }
      }
    }
  }
  log(`fixed-root variants identical to m6: ${same}, different: ${diff}; brute-force comparisons ${bruteN}, disagreements ${bruteBad}`);
  for (const e of ex) log('   ', e);
  expect(diff).toBe(0);
  expect(bruteBad).toBe(0);
});
