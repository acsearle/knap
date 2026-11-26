// Bullet at its own defaults (g 9.81, stepSimulation(1/60) with default substepping, default
// iterations, default margins, default friction 0.5*0.5 product, sleeping ON). A 0.5 m cylinder
// (1 m long) or sphere lying on (a) a fixed box, (b) a static plane, given a 0.05 m/s roll, 20 s.
//   node minimal.mjs   (NOSLEEP=1 turns deactivation off)
//            (AMMO=typed node minimal.mjs for the kripken/master build)
import { ammo } from './lib.mjs';
const A = await ammo();
function run(floor, shapeKind, v0 = 0.05) {
  const cfg = new A.btDefaultCollisionConfiguration();
  const w = new A.btDiscreteDynamicsWorld(new A.btCollisionDispatcher(cfg), new A.btDbvtBroadphase(), new A.btSequentialImpulseConstraintSolver(), cfg);
  w.setGravity(new A.btVector3(0, -9.81, 0));
  const tr = new A.btTransform();
  const add = (shape, m, y) => {
    tr.setIdentity(); tr.setOrigin(new A.btVector3(0, y, 0));
    const I = new A.btVector3(0, 0, 0); if (m) shape.calculateLocalInertia(m, I);
    const b = new A.btRigidBody(new A.btRigidBodyConstructionInfo(m, new A.btDefaultMotionState(tr), shape, I));
    if (process.env.NOSLEEP) b.setActivationState(4);
    w.addRigidBody(b); return b;
  };
  if (floor === 'box') add(new A.btBoxShape(new A.btVector3(50, 0.5, 50)), 0, -0.5);
  else add(new A.btStaticPlaneShape(new A.btVector3(0, 1, 0), 0), 0, 0);
  const r = 0.5;
  const shape = shapeKind === 'sphere' ? new A.btSphereShape(r) : new A.btCylinderShapeZ(new A.btVector3(r, r, 0.5));
  const b = add(shape, 1, r);
  b.setLinearVelocity(new A.btVector3(v0, 0, 0)); b.setAngularVelocity(new A.btVector3(0, 0, -v0 / r));
  const out = [];
  for (let i = 1; i <= 60 * 20; i++) { w.stepSimulation(1 / 60); if (i % 300 === 0) out.push(`${(i / 60).toFixed(0)}s vx ${b.getLinearVelocity().x().toFixed(4)} x ${b.getWorldTransform().getOrigin().x().toFixed(2)}`); }
  console.log(`${shapeKind} on ${floor}, v0 ${v0}: ${out.join(' | ')}`);
}
for (const s of ['cylinder', 'sphere']) for (const fl of ['box', 'plane']) run(fl, s);
run('box', 'cylinder', 0); run('plane', 'cylinder', 0);
process.exit(0);
