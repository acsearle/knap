// Review: knap Simulation, lone wheel, ground collider moved to x = hx afterwards; then variants.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import type { World, Collider } from '@dimforge/rapier3d-compat';
import { RAPIER } from '../../src/physics/rapier';
import { ModelBuilder } from '../../src/core/examples';
import { makeCell, setGround, setRim, setFixRoot } from '../../src/core/model';
import { LOGDIR, com, logger, make } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('creep4');
it('move the ground collider', async () => {
  for (const variant of ['plain', 'restitution0', 'onlyRound', 'noCcd'])
    for (const hx of [0, -100, 100]) {
      const b = new ModelBuilder();
      b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
      const m = setFixRoot(setGround(setRim(b.build(), 1, [0, 0, 0], 1.5), true), false);
      const s = await make(m);
      const w = (s as unknown as { world: World }).world;
      const cols: Collider[] = [];
      w.forEachCollider((c) => void cols.push(c));
      for (const c of cols) {
        if (c.shape.type === RAPIER.ShapeType.HalfSpace) {
          const t = c.translation();
          c.setTranslation({ x: t.x + hx, y: t.y, z: t.z });
        } else {
          if (variant === 'restitution0') c.setRestitution(0);
          if (variant === 'onlyRound' && c.shape.type !== RAPIER.ShapeType.Cylinder) c.setCollisionGroups(0);
        }
      }
      if (variant === 'noCcd') w.getRigidBody(cols.find((c) => c.shape.type === RAPIER.ShapeType.Cylinder)!.parent()!.handle).setSoftCcdPrediction(0);
      const c0 = com(s, 0);
      s.stepFixed(480 * 20);
      log(`${variant} ground x +${hx}: dx 20 s ${(com(s, 0)[0] - c0[0]).toExponential(3)} cols ${cols.map((c) => c.shape.type).join(',')}`);
      s.dispose();
    }
}, 600000);
