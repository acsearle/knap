// Review: is the half-space a bowl? Pure Rapier: a cylinder resting on a half-space at distance d from the half-space's origin.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { RAPIER, initPhysics } from '../../src/physics/rapier';
import { LOGDIR, logger } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('bowl');

it('bowl', async () => {
  await initPhysics();
  for (const shape of ['cylinder', 'ball'] as const)
  for (const d of [0, 20, 100, 500]) for (const sign of [1, -1]) {
    const w = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
    w.timestep = 1 / 480;
    w.numSolverIterations = 30;
    const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    w.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(0, 0, 0).setFriction(0.4), g);
    const x0 = sign * d;
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x0, 1.5, 0).setCanSleep(false));
    const s = Math.SQRT1_2;
    const cd = shape === 'cylinder' ? RAPIER.ColliderDesc.cylinder(0.46, 1.5).setRotation({ x: s, y: 0, z: 0, w: s }) : RAPIER.ColliderDesc.ball(1.5);
    w.createCollider(cd.setFriction(0.8), rb);
    const row: string[] = [];
    for (let t = 1; t <= 30; t++) {
      for (let i = 0; i < 480; i++) w.step();
      if (t % 10 === 0) row.push(`t${t} dx ${(rb.translation().x - x0).toExponential(2)} vx ${rb.linvel().x.toExponential(2)} y ${rb.translation().y.toFixed(5)}`);
    }
    log(`${shape} at x ${x0}: ${row.join(' | ')}`);
    w.free();
  }
}, 600000);
