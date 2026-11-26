// Independent B5 check at Bullet's own scale: cylinder r 0.5 m, length 1 m, 1 kg, g 9.81, fixed 1/60 s,
// sleeping off. Floor = static box (100x1x100) or static plane. Variants try documented knobs.
// node r5.mjs <variant indices, comma separated>  (no arg prints the count; run each in its own process:
//   for i in $(seq 0 47); do node r5.mjs $i; done). AMMO=typed for kripken master.
import load from './load.mjs';
const A = await load();
const V = (x, y, z) => new A.btVector3(x, y, z);
function run(name, o = {}) {
  const cfg = new A.btDefaultCollisionConfiguration();
  const w = new A.btDiscreteDynamicsWorld(new A.btCollisionDispatcher(cfg), new A.btDbvtBroadphase(), new A.btSequentialImpulseConstraintSolver(), cfg);
  w.setGravity(V(0, -9.81, 0));
  if (o.iters) w.getSolverInfo().set_m_numIterations(o.iters);
  const mk = (shape, m, y, rot) => {
    const tr = new A.btTransform(); tr.setIdentity(); tr.setOrigin(V(0, y, 0)); if (rot) tr.setRotation(new A.btQuaternion(...rot));
    const I = V(0, 0, 0); if (m) shape.calculateLocalInertia(m, I);
    const b = new A.btRigidBody(new A.btRigidBodyConstructionInfo(m, new A.btDefaultMotionState(tr), shape, I));
    b.setActivationState(4); b.setFriction(o.mu ?? 0.5); w.addRigidBody(b); return b;
  };
  const floor = o.plane ? mk(new A.btStaticPlaneShape(V(0, 1, 0), 0), 0, 0) : mk(new A.btBoxShape(V(50, 0.5, 50)), 0, -0.5);
  let shape;
  if (o.hull) { shape = new A.btConvexHullShape(); const n = o.hull; for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; for (const z of [-0.5, 0.5]) shape.addPoint(V(0.5 * Math.cos(a), 0.5 * Math.sin(a), z), true); } if (o.margin !== undefined) shape.setMargin(o.margin); if (o.poly) shape.initializePolyhedralFeatures(0); }
  else { shape = new A.btCylinderShapeZ(V(0.5, 0.5, 0.5)); if (o.margin !== undefined) shape.setMargin(o.margin); }
  const c = mk(shape, 1, 0.5 + (o.lift ?? 0));
  if (o.cpt !== undefined) { c.setContactProcessingThreshold(o.cpt); floor.setContactProcessingThreshold(o.cpt); }
  if (o.roll) { c.setRollingFriction(o.roll); floor.setRollingFriction(o.roll); }
  if (o.flags !== undefined) c.setFlags(o.flags);
  const v0 = o.v0 ?? 0; c.setLinearVelocity(V(v0, 0, 0)); c.setAngularVelocity(V(0, 0, -v0 / 0.5));
  const dt = o.dt ?? 1 / 60, out = [];
  for (let i = 1; i <= Math.round(20 / dt); i++) { w.stepSimulation(dt, 0); if (i % Math.round(5 / dt) === 0) out.push(c.getLinearVelocity().x().toFixed(4)); }
  const wz = c.getAngularVelocity().z();
  console.log(`${name.padEnd(44)} vx at 5/10/15/20 s: ${out.join(' ')}  slip(vx+wz*r) ${(c.getLinearVelocity().x() + wz * 0.5).toFixed(4)}  y ${c.getWorldTransform().getOrigin().y().toFixed(4)}`);
}
const VARS = [];
for (const fl of [false, true]) {
  const P = fl ? 'plane' : 'box';
  for (const v0 of [0, 0.05, 1]) {
    const B = { plane: fl, v0 };
    VARS.push([`${P} v0=${v0} default`, B], [`${P} v0=${v0} mu=0`, { ...B, mu: 0 }], [`${P} v0=${v0} cyl margin 0.001`, { ...B, margin: 0.001 }],
      [`${P} v0=${v0} contactProcessingThreshold 0`, { ...B, cpt: 0 }], [`${P} v0=${v0} rollingFriction 0.001`, { ...B, roll: 0.001 }],
      [`${P} v0=${v0} gyro flags 0`, { ...B, flags: 0 }], [`${P} v0=${v0} dt 1/480`, { ...B, dt: 1 / 480 }], [`${P} v0=${v0} 64-gon hull`, { ...B, hull: 64 }]);
  }
}
const sel = process.argv[2];
if (sel === undefined) console.log(VARS.length); else for (const k of sel.split(',')) run(...VARS[+k]);
process.exit(0);
