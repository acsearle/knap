// Review control: a flat 5×5 plate of pin holes (no rim) resting off-centre on a beam on the floor; and the
// same wheel with its round collider removed from the ground (does the floor contact of the round cylinder matter?).
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import type { World, Collider } from '@dimforge/rapier3d-compat';
import { RAPIER } from '../../src/physics/rapier';
import { ModelBuilder, beam } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim } from '../../src/core/model';
import type { Cell } from '../../src/core/types';
import { LOGDIR, com, logger, make } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('plate-on-beam');
it('controls', async () => {
  for (const variant of ['plate 5x5', 'wheel r2.5', 'wheel r2.5, round collider meets nothing', 'wheel r2.5, hull meets the ground too']) {
    const b = new ModelBuilder();
    const bm = b.add(beam([-7, 0, 1], [7, 0, 1], 1));
    let cells: Cell[] = [makeCell(0, 1, 0, 'pinHole', 1)];
    if (variant.startsWith('plate')) { cells = []; for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) cells.push(makeCell(x, 1, z, 'pinHole', 1)); }
    const wl = b.add(cells);
    let m = b.root(bm).build();
    if (variant.startsWith('wheel')) m = setRim(m, wl, [0, 1, 0], 2.5);
    m = setFixRoot(setGround(m, true), false);
    const s = await make(m);
    const w = (s as unknown as { world: World }).world;
    const cols: Collider[] = [];
    w.forEachCollider((c) => void cols.push(c));
    for (const c of cols) {
      if (variant.endsWith('meets nothing') && c.shape.type === RAPIER.ShapeType.Cylinder) c.setCollisionGroups(0);
      if (variant.endsWith('ground too') && c.collisionGroups() === ((0x4 << 16) | 0x8)) c.setCollisionGroups((0x4 << 16) | 0x9);
    }
    const bw = s.bodyOf(wl)!;
    s.stepFixed(480 * 5);
    log(`${variant}: hub/centre end ${JSON.stringify(com(s, bw).map((x) => +x.toFixed(3)))} (resting on the beam ≈ 0.92 at the centre, less when tilted)`);
    s.dispose();
  }
}, 1800000);
