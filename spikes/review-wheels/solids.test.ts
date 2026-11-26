// Review sweep: wheel solids — every crank-hole position the disc overlaps (pin hole and axle hole,
// coaxial and perpendicular), axle-hole hubs, two overlapping coplanar rims, a rim mid-beam.
import { beforeAll, it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { buildPartMesh, clearMeshCache, initGeometry, partSolidStats } from '../../src/geometry';
import { makeCell } from '../../src/core/model';
import { discCells } from '../../src/core/disc';
import type { Axis, Cell, Kind } from '../../src/core/types';
import { edgeProblems, meshShells, part } from '../../tests/geometry/helpers';
import { LOGDIR, logger } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('solids');
beforeAll(async () => { await initGeometry(); });
it('solids', () => {
  let n = 0;
  const bad: string[] = [];
  const check = (name: string, cells: Cell[]) => {
    n++;
    clearMeshCache();
    const st = partSolidStats(part(cells), { fast: false });
    const mesh = buildPartMesh(part(cells));
    const ep = edgeProblems(mesh);
    const sh = meshShells(mesh);
    if (st.status !== 'NoError' || ep.length || sh !== 1) bad.push(`${name}: status ${st.status} edgeProblems ${ep.length} shells ${sh}`);
  };
  for (const r of [1, 1.5, 2, 2.5, 3, 3.5, 4])
    for (const hubKind of ['pinHole', 'axleHole'] as Kind[]) {
      check(`hub ${hubKind} r ${r}`, [makeCell(0, 0, 0, hubKind, 2, r)]);
      for (const q of discCells([0, 0, 0], 2, r)) {
        if (q[0] === 0 && q[1] === 0) continue;
        if (q[0] < 0 || q[1] < q[0]) continue; // one octant (symmetry), the mark lies along +X
        for (const [k, ax] of [['pinHole', 2], ['axleHole', 2], ['pinHole', 0]] as [Kind, Axis][])
          check(`hub ${hubKind} r ${r} crank ${k} axis ${ax} at ${q}`, [makeCell(0, 0, 0, hubKind, 2, r), makeCell(q[0], q[1], 0, k, ax)]);
      }
    }
  for (const [r1, r2, d] of [[2, 2, 1], [2, 2, 3], [4, 1, 2], [3, 3, 5], [2.5, 1.5, 3]]) {
    // two coplanar overlapping rims in one part, joined only through the discs
    check(`two coplanar rims r ${r1} + r ${r2} at distance ${d}`, [makeCell(0, 0, 0, 'pinHole', 2, r1), makeCell(d, 0, 0, 'pinHole', 2, r2)]);
  }
  for (const r of [1, 2, 3.5]) check(`rim mid 9-beam r ${r}`, Array.from({ length: 9 }, (_, i) => makeCell(i - 4, 0, 0, 'pinHole', 2, i === 4 ? r : undefined)));
  for (const r of [2, 3]) check(`rim on a beam end with the beam along the mark`, Array.from({ length: 5 }, (_, i) => makeCell(i, 0, 0, 'pinHole', 2, i === 0 ? r : undefined)));
  log(`${n} solids, ${bad.length} bad`);
  for (const b of bad) log(b);
}, 3600_000);
