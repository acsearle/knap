// Review: pure Rapier copy of knap's lone r 1.5 wheel, half-space at x = -100; add knap's pieces one at a time.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { RAPIER, initPhysics } from '../../src/physics/rapier';
import { wheelShape, prismShape } from '../../src/physics/shapes';
import { LOGDIR, logger } from './lib';
mkdirSync(LOGDIR, { recursive: true });
const log = logger('bowl6');
it('bowl6', async () => {
  await initPhysics();
  const sh = wheelShape([0, 0, 0], 2, 1.46, 0.46, 0.46, 1.5);
  const hub = prismShape([0, 0, 0], 2, 0.46, 0.46, 16, 0);
  for (const variant of ['bare', 'massprops', 'massprops+hub', 'massprops+hub+rest', 'iters30pgs1']) for (const hx of [0, -100]) {
    const w = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
    w.timestep = 1 / 480;
    w.numSolverIterations = variant === 'iters30pgs1' ? 30 : 4;
    w.numInternalPgsIterations = 1;
    w.integrationParameters.maxCcdSubsteps = 0;
    const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    w.createCollider(new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 })).setTranslation(hx, -1.46, 0).setFriction(0.4).setRestitution(0.1), g);
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0, 0).setCanSleep(false).setAngularDamping(0));
    const s = Math.SQRT1_2;
    const cd = RAPIER.ColliderDesc.cylinder(0.46, 1.46).setRotation({ x: s, y: 0, z: 0, w: s }).setFriction(0.8).setRestitution(variant.includes('rest') || variant === 'iters30pgs1' ? 0.1 : 0);
    if (variant !== 'bare') {
      const m = sh.mass;
      cd.setMassProperties(m.volume, { x: 0, y: 0, z: 0 }, { x: m.inertia[0]!, y: m.inertia[2]!, z: m.inertia[0]! }, { x: 0, y: 0, z: 0, w: 1 });
    }
    w.createCollider(cd, rb);
    if (variant.includes('hub') || variant === 'iters30pgs1') {
      const h = RAPIER.ColliderDesc.convexHull(new Float32Array(hub.points.flat()))!;
      h.setMassProperties(hub.mass.volume, { x: 0, y: 0, z: 0 }, { x: hub.mass.inertia[0]!, y: hub.mass.inertia[1]!, z: hub.mass.inertia[2]! }, { x: 0, y: 0, z: 0, w: 1 });
      w.createCollider(h, rb);
    }
    for (let i = 0; i < 480 * 20; i++) w.step();
    log(`${variant} halfspace x ${hx}: dx 20 s ${rb.translation().x.toExponential(3)}`);
    w.free();
  }
}, 600000);
