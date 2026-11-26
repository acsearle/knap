// Review: pure Rapier, the half-space created AFTER the cylinder (as knap does).
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { RAPIER, initPhysics } from '../../src/physics/rapier';
import { LOGDIR, logger } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('bowl7');
it('bowl7', async () => {
  await initPhysics();
  for (const groundFirst of [true, false]) for (const hx of [0, -20, -100, 100, -500]) {
    const w = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
    w.timestep = 1 / 480;
    w.numSolverIterations = 30;
    const mkGround = () => {
      const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      w.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(hx, -1.46, 0).setFriction(0.4), g);
    };
    if (groundFirst) mkGround();
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0).setCanSleep(false));
    const s = Math.SQRT1_2;
    w.createCollider(RAPIER.ColliderDesc.cylinder(0.46, 1.46).setRotation({ x: s, y: 0, z: 0, w: s }).setFriction(0.8), rb);
    if (!groundFirst) mkGround();
    const row: string[] = [];
    for (let t = 1; t <= 20; t++) { for (let i = 0; i < 480; i++) w.step(); if (t % 10 === 0) row.push(`t${t} dx ${rb.translation().x.toExponential(3)} vx ${rb.linvel().x.toExponential(2)}`); }
    log(`groundFirst ${groundFirst} halfspace x ${hx}: ${row.join(' | ')}`);
    w.free();
  }
}, 600000);
