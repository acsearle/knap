// Which joint creeps at rest at k > 1 (cart and parallelogram examples, realistic friction)?
import { it } from 'vitest';
import { appendFileSync, writeFileSync } from 'node:fs';
import { buildExample } from '../../src/core/examples';
import { Simulation } from './sim';

const OUT = process.env.OUT ?? 'spikes/adaptive/out/creep.jsonl';
it('creep', async () => {
  writeFileSync(OUT, '');
  for (const name of (process.env.NAMES ?? 'cart,parallelogram').split(','))
    for (const k of (process.env.KS ?? '1,4').split(',').map(Number)) for (const eps of (process.env.EPS ?? '0').split(',').map(Number)) {
      const s = await Simulation.create(buildExample(name), { substeps: k, innerIterations: Number(process.env.IT ?? 0), gravity: [1226.25 * eps, -1226.25, 0] });
      const ang = (sj: number) => (s as unknown as { joints: { ang: { x: number; stuck: boolean } }[] }).joints[sj]!.ang;
      s.stepFixed(480 * 8);
      const a0 = s.jointStates().map((_, i) => ang(i).x);
      let maxW = s.jointStates().map(() => 0);
      let unstuck = s.jointStates().map(() => 0);
      for (let i = 0; i < 480 * 10; i++) {
        s.stepFixed(1);
        const js = s.jointStates();
        js.forEach((j, n) => { maxW[n] = Math.max(maxW[n]!, Math.abs(j.omega)); if (!ang(n).stuck) unstuck[n]!++; });
      }
      const d = s.jointStates().map((j, i) => +(ang(i).x - a0[i]!).toExponential(2));
      appendFileSync(OUT, JSON.stringify({ name, k, eps, it: process.env.IT ?? 'def', creep8to18: d, maxOmega: maxW.map((x) => +x.toExponential(1)), stepsUnstuck: unstuck, types: s.jointStates().map((j) => j.type), loads: s.jointStates().map((j) => +j.loadMass.toFixed(2)) }) + '\n');
      s.dispose();
    }
});
