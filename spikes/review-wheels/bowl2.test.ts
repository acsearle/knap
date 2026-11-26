// Review: pure Rapier, half-space translated to x = d, cylinder at 0; with/without soft CCD.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { RAPIER, initPhysics } from '../../src/physics/rapier';
import { LOGDIR, logger } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('bowl2');
it('bowl2', async () => {
  await initPhysics();
  for (const ccd of [0, 1.04]) for (const hx of [0, 100, -100]) for (const cx of [0, 100]) {
    const w = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
    w.timestep = 1 / 480;
    w.numSolverIterations = 30;
    w.integrationParameters.maxCcdSubsteps = 0;
    const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    w.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(hx, 0, 0).setFriction(0.4), g);
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(cx, 1.5, 0).setCanSleep(false));
    if (ccd) rb.setSoftCcdPrediction(ccd);
    const s = Math.SQRT1_2;
    w.createCollider(RAPIER.ColliderDesc.cylinder(0.46, 1.5).setRotation({ x: s, y: 0, z: 0, w: s }).setFriction(0.8), rb);
    for (let i = 0; i < 480 * 20; i++) w.step();
    log(`ccd ${ccd} halfspace x ${hx} cylinder x ${cx}: dx 20 s ${(rb.translation().x - cx).toExponential(3)}`);
    w.free();
  }
}, 600000);
