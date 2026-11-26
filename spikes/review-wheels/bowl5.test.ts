// Review: pure Rapier, cylinder on a half-space plus a far fixed box (no contact with anything).
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { RAPIER, initPhysics } from '../../src/physics/rapier';
import { LOGDIR, logger } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('bowl5');
it('bowl5', async () => {
  await initPhysics();
  for (const far of [0]) for (const hx of [0, -100, 100, -1000]) for (const farDynamic of [false]) {
    const w = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
    w.timestep = 1 / 480;
    w.numSolverIterations = 30;
    const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    w.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(hx, -1.46, 0).setFriction(0.4).setRestitution(0.1), g);
    if (far) {
      const fb = w.createRigidBody(farDynamic ? RAPIER.RigidBodyDesc.dynamic().setTranslation(far, 5, 0).setGravityScale(0) : RAPIER.RigidBodyDesc.fixed().setTranslation(far, 1, 0));
      w.createCollider(RAPIER.ColliderDesc.cuboid(0.46, 0.46, 0.46), fb);
    }
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0).setCanSleep(false).setLinvel(1e-3, 0, 0).setAngvel({x:0,y:0,z:-1e-3/1.46}));
    const s = Math.SQRT1_2;
    w.createCollider(RAPIER.ColliderDesc.cylinder(0.46, 1.46).setRotation({ x: s, y: 0, z: 0, w: s }).setFriction(0.8).setRestitution(0.1), rb);
    for (let i = 0; i < 480 * 20; i++) w.step();
    log(`far box x ${far} dynamic ${farDynamic} halfspace x ${hx}: dx 20 s ${rb.translation().x.toExponential(3)}`);
    w.free();
  }
}, 600000);
