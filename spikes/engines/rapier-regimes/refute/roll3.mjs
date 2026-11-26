// Follow-up to roll2.mjs: the 1 stud/s wheel on the battery's 40x40 box floor, started at z0,
// for lengthUnit L (tolerances compensated). node roll3.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
function run(L, z0, hz = 20) {
  const w = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
  w.timestep = 1 / 480; w.numSolverIterations = 30;
  if (L !== 1) { const ip = w.integrationParameters; const e = ip.normalizedAllowedLinearError, p = ip.normalizedPredictionDistance; w.lengthUnit = L; ip.normalizedAllowedLinearError = e / L; ip.normalizedPredictionDistance = p / L; }
  const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  w.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, hz).setTranslation(0, -0.5, 0).setFriction(0.5).setRestitution(0), g);
  const h = Math.SQRT1_2;
  const b = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0, 1, z0).setRotation({ w: h, x: 0, y: 0, z: -h }).setLinvel(0, 0, 1).setAngvel({ x: 1, y: 0, z: 0 }));
  w.createCollider(RAPIER.ColliderDesc.cylinder(0.46, 1).setFriction(0.5).setRestitution(0), b);
  const tr = []; for (let k = 0; k < 3; k++) { for (let i = 0; i < 480; i++) w.step(); tr.push(b.linvel().z.toFixed(2)); }
  w.free(); return tr.join(' ');
}
for (const L of [1, 2, 8, 11.18, 32]) console.log(`L ${L}: z0 -15 40x40: ${run(L, -15)} | z0 0 40x40: ${run(L, 0)} | z0 -15 40x400: ${run(L, -15, 200)}`);
process.exit(0);
