// Item 4: cost of the raised rim segment count (≈ 40 per unit of radius) vs the previous 48 / 64.
// Interleaved A/B (new, old, new, old …), caches cleared before every build; medians reported.
// Run: npx vitest run --config spikes/review-m7/vitest.config.ts segcost
import { it } from 'vitest';
import { buildExample } from '../../src/core/examples';
import { makeCell } from '../../src/core/model';
import type { Part } from '../../src/core/types';
import * as NEW from '../../src/geometry';
import * as OLD from './oldseg/geometry';
import { logger } from './lib';

const log = logger('segcost');
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]!;

function cost(lib: typeof NEW, parts: Part[]): { ms: number; tris: number } {
  lib.clearMeshCache();
  const t = performance.now();
  let tris = 0;
  for (const p of parts) tris += lib.buildPartMesh(p).indices.length / 3;
  return { ms: performance.now() - t, tris };
}

it('per wheel and for the Cart / Crank-wheel examples', async () => {
  await NEW.initGeometry();
  await OLD.initGeometry();
  const rows: [string, Part[]][] = [];
  for (let r = 1; r <= 4; r += 0.5) rows.push([`wheel r ${r}`, [{ id: 1, color: '#888888', cells: [makeCell(0, 0, 0, 'pinHole', 2, r)] }]]);
  rows.push(['wheel r 2.5 + crank (2,2)', [{ id: 1, color: '#888888', cells: [makeCell(0, 0, 0, 'pinHole', 2, 2.5), makeCell(2, 2, 0, 'pinHole', 2)] }]]);
  rows.push(['Cart example (all parts)', buildExample('cart').parts]);
  rows.push(['Crank-wheel example (all parts)', buildExample('crank-wheel').parts]);
  for (const [label, parts] of rows) {
    const a: number[] = [];
    const b: number[] = [];
    let ta = 0;
    let tb = 0;
    for (let k = 0; k < 9; k++) {
      const x = cost(NEW, parts);
      const y = cost(OLD, parts);
      a.push(x.ms);
      b.push(y.ms);
      ta = x.tris;
      tb = y.tris;
    }
    log(`${label}: triangles ${tb} → ${ta} (×${(ta / tb).toFixed(2)}); build median ${median(b).toFixed(1)} → ${median(a).toFixed(1)} ms (×${(median(a) / median(b)).toFixed(2)}) [9 interleaved pairs, shared machine]`);
  }
});
