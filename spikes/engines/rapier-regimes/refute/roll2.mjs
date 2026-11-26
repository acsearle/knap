// Does lengthUnit L (with normalizedAllowedLinearError and normalizedPredictionDistance divided by
// L, so the absolute tolerances stay as in R0) remove the B5a self-accelerating wheel? Real units,
// R0 otherwise (g 1226.25, dt 1/480, 30 iterations).
//   node roll2.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
function run(L, { hx = 20, hz = 20, v0 = 0, T = 5, z0 = 0, cnf = null, shape = 'cyl' } = {}) {
  const w = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
  w.timestep = 1 / 480; w.numSolverIterations = 30;
  if (cnf) w.integrationParameters.contact_natural_frequency = cnf;
  if (L !== 1) {
    const ip = w.integrationParameters;
    const e = ip.normalizedAllowedLinearError, p = ip.normalizedPredictionDistance;
    w.lengthUnit = L; ip.normalizedAllowedLinearError = e / L; ip.normalizedPredictionDistance = p / L;
  }
  const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  w.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.5, hz).setTranslation(0, -0.5, 0).setFriction(0.5).setRestitution(0), g);
  const h = Math.SQRT1_2;
  const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0, 1, z0)
    .setRotation({ w: h, x: 0, y: 0, z: -h }).setLinvel(0, 0, v0).setAngvel({ x: v0, y: 0, z: 0 }));
  const d = shape === 'cyl' ? RAPIER.ColliderDesc.cylinder(0.46, 1) : RAPIER.ColliderDesc.roundCylinder(0.41, 0.95, 0.05);
  w.createCollider(d.setFriction(0.5).setRestitution(0), b);
  const tr = [];
  let maxSink = 0;
  const n = Math.round(T * 480);
  for (let i = 1; i <= n; i++) { w.step(); maxSink = Math.max(maxSink, 1 - b.translation().y); if (i % Math.round(n / 5) === 0) tr.push(b.linvel().z.toFixed(2)); }
  const v = b.linvel().z, om = b.angvel().x;
  const r = `v ${tr.join(' ')} | end w*r ${om.toFixed(2)} (rolling if = v) y ${b.translation().y.toFixed(4)} maxSink ${maxSink.toFixed(4)}`;
  w.free();
  return r;
}
for (const L of [1, 2, 4, 8, 11.18, 32]) {
  console.log(`L ${L}`);
  console.log('  rest, floor 40x40     ', run(L));
  console.log('  rest, floor 40x120    ', run(L, { hz: 60 }));
  console.log('  rest, floor 120x42    ', run(L, { hx: 60, hz: 21 }));
  console.log('  1 stud/s, floor 40x400', run(L, { hz: 200, v0: 1, z0: -150 }));
  console.log('  100 studs/s, 2 s, 40x400', run(L, { hz: 200, v0: 100, z0: -150, T: 2 }));
}
console.log('roundCylinder, L 11.18, rest 40x120', run(11.18, { hz: 60, shape: 'round' }));
console.log('roundCylinder, L 11.18, 1 stud/s  ', run(11.18, { hz: 200, v0: 1, z0: -150, shape: 'round' }));
process.exit(0);
