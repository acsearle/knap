// Review: pure Rapier, cylinder + inset 32-gon guard (ground only), half-space translated; soft CCD on/off.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { RAPIER, initPhysics } from '../../src/physics/rapier';
import { wheelShape } from '../../src/physics/shapes';
import { LOGDIR, logger } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('bowl3');
it('bowl3', async () => {
  await initPhysics();
  const sh = wheelShape([0, 0, 0], 2, 1.46, 0.46, 0.46, 1.5);
  for (const guard of [false, true]) for (const ccd of [0, 1.04]) for (const hx of [0, 100, -100]) {
    const w = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
    w.timestep = 1 / 480;
    w.numSolverIterations = 30;
    w.integrationParameters.maxCcdSubsteps = 0;
    const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    w.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(hx, -1.46, 0).setFriction(0.4), g);
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0).setCanSleep(false));
    if (ccd) rb.setSoftCcdPrediction(ccd);
    const s = Math.SQRT1_2;
    w.createCollider(RAPIER.ColliderDesc.cylinder(0.46, 1.46).setRotation({ x: s, y: 0, z: 0, w: s }).setFriction(0.8), rb);
    if (guard) {
      const gp = new Float32Array(sh.guard.flat());
      w.createCollider(RAPIER.ColliderDesc.convexHull(gp)!.setDensity(0).setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min), rb);
    }
    for (let i = 0; i < 480 * 20; i++) w.step();
    log(`guard ${guard} ccd ${ccd} halfspace x ${hx}: dx 20 s ${rb.translation().x.toExponential(3)}`);
    w.free();
  }
}, 600000);
