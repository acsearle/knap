// Measurements: cost per fixed step of a 3-gear train at k 1/2/4/8 vs the same parts without teeth;
// cost of the collider change on the Cart example (old 2d3372a sources vs now).
import { it } from 'vitest';
import { idlerChain } from '../../tests/physics/gearModels';
import { Simulation } from '../../src/physics/sim';
import { Simulation as OldSim } from './base/src/physics/sim';
import { buildExample } from '../../src/core/examples';
import { buildExample as oldExample } from './base/src/core/examples';
import { makeCell } from '../../src/core/model';
import type { Model } from '../../src/core/types';
const strip = (m: Model, rim: boolean): Model => ({ ...m, parts: m.parts.map((p) => ({ ...p, cells: p.cells.map((c) => (c.teeth ? makeCell(c.x, c.y, c.z, c.kind, c.axis, rim ? c.rim : undefined) : c)) })) });
it('cost', async () => {
  const variants: [string, () => Model][] = [['gears', () => idlerChain(3).model], ['plain rims r 1', () => strip(idlerChain(3).model, true)], ['bare holes', () => strip(idlerChain(3).model, false)]];
  const res = new Map<string, number[]>();
  for (let round = 0; round < 3; round++)
    for (const k of [1, 2, 4, 8])
      for (const [name, mk] of variants) {
        const s = await Simulation.create(mk(), { jointFriction: 0.2, substeps: k });
        s.stepFixed(1);
        for (const b of s.graph.bodies) if (!b.fixed) s.setBodyVelocity(b.id, [0, 0, 0], [0, 0, b.id % 2 ? 20 : -20]);
        s.stepFixed(10);
        const t0 = performance.now();
        s.stepFixed(480);
        const ms = (performance.now() - t0) / 480;
        const key = `${name} k ${k}`;
        res.set(key, [...(res.get(key) ?? []), ms]);
        s.dispose();
      }
  for (const [k, v] of res) console.log(`C ${k}: min ${Math.min(...v).toFixed(4)} ms/fixed step, all ${v.map((x) => x.toFixed(4)).join(' ')}`);
  const cart: Record<string, number[]> = { old: [], new: [] };
  for (let round = 0; round < 4; round++)
    for (const which of round % 2 ? ['old', 'new'] : ['new', 'old']) {
      const s = which === 'old' ? await OldSim.create(oldExample('cart')) : await Simulation.create(buildExample('cart'));
      const t0 = performance.now();
      s.stepFixed(960);
      cart[which]!.push((performance.now() - t0) / 2);
      s.dispose();
    }
  console.log(`C cart ms per simulated second: old ${cart.old!.map((x) => x.toFixed(0)).join(' ')} new ${cart.new!.map((x) => x.toFixed(0)).join(' ')}`);
}, 900000);
