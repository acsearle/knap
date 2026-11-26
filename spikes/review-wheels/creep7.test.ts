// Review: knap lone wheel; move the half-space with setTranslationWrtParent; and soft CCD off per body.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import type { World, Collider } from '@dimforge/rapier3d-compat';
import { RAPIER } from '../../src/physics/rapier';
import { ModelBuilder } from '../../src/core/examples';
import { makeCell, setGround, setRim, setFixRoot } from '../../src/core/model';
import { LOGDIR, com, logger, make } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('creep7');
it('move ground', async () => {
  for (const ccdOff of [false, true]) for (const groupsOff of ['none', 'hub', 'guard', 'hub+guard']) for (const hx of [0, -100]) {
    const b = new ModelBuilder();
    b.add([makeCell(0, 0, 0, 'pinHole', 2)]);
    const m = setFixRoot(setGround(setRim(b.build(), 1, [0, 0, 0], 1.5), true), false);
    const s = await make(m);
    const w = (s as unknown as { world: World }).world;
    const cols: Collider[] = [];
    w.forEachCollider((c) => void cols.push(c));
    for (const c of cols) {
      if (c.shape.type === RAPIER.ShapeType.HalfSpace) {
        const t = c.translationWrtParent()!;
        c.setTranslationWrtParent({ x: t.x + hx, y: t.y, z: t.z });
      }
    }
    // colliders of the wheel body in creation order: hub prism(s)..., round cylinder, hull, guard
    const wheelCols = cols.filter((c) => c.shape.type !== RAPIER.ShapeType.HalfSpace);
    const round = wheelCols.find((c) => c.shape.type === RAPIER.ShapeType.Cylinder)!;
    const iRound = wheelCols.indexOf(round);
    if (groupsOff.includes('hub')) for (const c of wheelCols.slice(0, iRound)) c.setCollisionGroups(0);
    if (groupsOff.includes('guard')) wheelCols[iRound + 2]!.setCollisionGroups(0);
    if (ccdOff) w.getRigidBody(round.parent()!.handle).setSoftCcdPrediction(0);
    const c0 = com(s, 0);
    s.stepFixed(480 * 20);
    const t = cols.find((c) => c.shape.type === RAPIER.ShapeType.HalfSpace)!.translation();
    log(`ccdOff ${ccdOff} groupsOff ${groupsOff} ground moved ${hx} (now at x ${t.x.toFixed(1)}): dx 20 s ${(com(s, 0)[0] - c0[0]).toExponential(3)}`);
    s.dispose();
  }
}, 600000);
