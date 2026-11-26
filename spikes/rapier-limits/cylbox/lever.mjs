// Where are the contact points relative to the cylinder's centre AT THE POSE THE NARROW PHASE SAW
// (the pose before world.step)? Rolling cylinder (axis x, travel +z) on a cuboid vs a halfspace.
// Prints, per step: pre-step centre z, each manifold point's floor-side and body-side world z minus
// that centre, the normal, and whether the point set changed since the previous step.
// env RECREATE=1 re-creates the floor collider before every step.
// usage: node lever.mjs [cuboid|halfspace|hull] [v0=1] [steps=20] [r=1] [g=1226.25] [dt=1/480]
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const [floorKind = 'cuboid', v0s = '1', ns = '20', rs = '1', gs = '1226.25', dts = String(1 / 480), fhs = '200'] = process.argv.slice(2);
const v0 = +v0s, N = +ns, r = +rs, g = +gs, dt = +dts, FH = +fhs;
const world = new RAPIER.World({ x: 0, y: -g, z: 0 });
world.timestep = dt; world.numSolverIterations = 30;
const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, floorKind === 'halfspace' ? 0 : -1, 0));
let fcd;
if (floorKind === 'halfspace') fcd = new RAPIER.ColliderDesc(new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 }));
else if (floorKind === 'hull') { const p = []; for (const x of [-FH, FH]) for (const y of [-1, 1]) for (const z of [-FH, FH]) p.push(x, y, z); fcd = RAPIER.ColliderDesc.convexHull(new Float32Array(p)); }
else fcd = RAPIER.ColliderDesc.cuboid(FH, 1, FH);
let fc = world.createCollider(fcd.setFriction(0.8), fb);
const RECREATE = process.env.RECREATE === '1'; // re-create the floor collider before each step
const S = Math.SQRT1_2;
const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(3.3, r - 0.004, -0.6 * FH)
  .setRotation({ x: 0, y: 0, z: S, w: S }).setLinvel(0, 0, v0).setAngvel({ x: v0 / r, y: 0, z: 0 }));
const c = world.createCollider(RAPIER.ColliderDesc.cylinder(0.46, r).setFriction(0.8), b);
const e = (x) => x.toExponential(3);
let prev = '';
for (let k = 0; k < N; k++) {
  const p0 = b.translation(), q0 = b.rotation();
  if (RECREATE && k > 0) { world.removeCollider(fc, false); fc = world.createCollider(fcd, fb); }
  world.step();
  const fp = fb.translation();
  world.narrowPhase.contactPair(fc.handle, c.handle, world.bodies, (m, flipped) => {
    const n = m.normal();
    const pts = [];
    for (let i = 0; i < m.numContacts(); i++) {
      const a = flipped ? m.localContactPoint2(i) : m.localContactPoint1(i);
      const bl = flipped ? m.localContactPoint1(i) : m.localContactPoint2(i);
      // body-side point to world with the PRE-step pose
      const bw = rotate(q0, bl);
      pts.push(`[fz ${e(a.z + fp.z - p0.z)} bz ${e(bw.z)} x ${(a.x + fp.x - p0.x).toFixed(3)} d ${e(m.contactDist(i))}]`);
    }
    const key = pts.map((s) => s.replace(/bz [^ ]+ /, '')).join('');
    console.log(`k${k} z0 ${p0.z.toFixed(6)} vz ${b.linvel().z.toFixed(4)} n(${e(n.x)},${n.y.toFixed(6)},${e(n.z)}) ${key === prev ? 'SAME-floor-pts' : 'new'} ${pts.join(' ')}`);
    prev = key;
  });
}
function rotate(q, v) {
  const { x, y, z, w } = q;
  const tx = 2 * (y * v.z - z * v.y), ty = 2 * (z * v.x - x * v.z), tz = 2 * (x * v.y - y * v.x);
  return { x: v.x + w * tx + (y * tz - z * ty), y: v.y + w * ty + (z * tx - x * tz), z: v.z + w * tz + (x * ty - y * tx) };
}
process.exit(0);
