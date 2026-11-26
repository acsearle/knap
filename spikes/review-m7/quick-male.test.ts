// Quick probe: male cells at crank positions near a rim edge (rule 1 joins them; rimBridges only bridges holes).
import { it } from 'vitest';
import { addPart, emptyModel, makeCell, validateModel } from '../../src/core/model';
import type { Axis, Kind } from '../../src/core/types';
import { buildPartMesh, initGeometry } from '../../src/geometry';
import { meshShells } from '../../tests/geometry/helpers';
import { logger } from './lib';
const log = logger('quick-male');

it('male crank cells', async () => {
  await initGeometry();
  const cases: [number, [number, number], Kind, Axis][] = [
    [3, [2, 3], 'pin', 2], [3, [2, 3], 'axle', 2], [3, [2, 3], 'pin', 0], [3, [2, 3], 'pinHole', 2], [3, [2, 3], 'pinHole', 0],
    [4, [2, 4], 'pin', 2], [4, [2, 4], 'frictionPin', 1], [2.5, [2, 2], 'pin', 2], [1, [1, 1], 'pin', 2], [1, [1, 1], 'axle', 0],
  ];
  for (const [r, [u, v], k, a] of cases) {
    const cells = [makeCell(0, 0, 0, 'pinHole', 2, r), makeCell(u, v, 0, k, a)];
    let errs: string[] = [];
    try { const m = addPart(emptyModel(), cells).model; errs = validateModel(m).map((e) => e.message); } catch (e) { errs = [(e as Error).message]; }
    const shells = meshShells(buildPartMesh({ id: 1, color: '#888888', cells }));
    log(`r ${r} cell (${u},${v}) ${k} axis ${a}: valid ${errs.length === 0 ? 'yes' : errs.join('; ')}; shells ${shells}`);
  }
});
