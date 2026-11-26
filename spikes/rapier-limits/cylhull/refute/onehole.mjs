// Native replica of `node spikes/wheels/out/diag2.mjs cyl <r> <n> 2` (5 rows z=-2..2 of n-hole
// stadium hulls on edge, cylinder hl 0.5 axis Z, friction 0.4, restitution 0.1, soft CCD 1.0417 unless
// ccd=0), for any n, printing the body trajectory (x, y-r, z, contacts with row 0) every `every` steps.
// node spikes/rapier-limits/cylhull/refute/onehole.mjs [r=1] [n=1] [ccd=1] [x0=0] [every=24] [T=1] [g=1226.25] [dt=1/480]
import RAPIER from '@dimforge/rapier3d-compat';
import { prismPoints } from '../lib.mjs';
await RAPIER.init();
const a = process.argv.slice(2);
const r = +(a[0] ?? 1), n = +(a[1] ?? 1), ccd = (a[2] ?? '1') !== '0', x0 = +(a[3] ?? 0), every = +(a[4] ?? 24), T = +(a[5] ?? 1);
const g = +(a[6] ?? 1226.25), dt = a[7] ? 1 / +a[7] : 1 / 480;
const w = new RAPIER.World({ x: 0, y: -g, z: 0 });
w.timestep = dt; if (!process.env.DEFAULTS) { w.numSolverIterations = 30; w.numInternalPgsIterations = 1; w.integrationParameters.maxCcdSubsteps = 0; } // DEFAULTS=1: keep Rapier defaults
const fb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
let gc;
for (let zr = -2; zr <= 2; zr++) {
  const c = w.createCollider(RAPIER.ColliderDesc.convexHull(prismPoints([0, -0.46, zr], 2, 0, 0.46, 0.46, 16, n - 1, 0.01)), fb);
  if (zr === 0) gc = c;
}
const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(x0, r, 0));
const cyl = w.createCollider(RAPIER.ColliderDesc.cylinder(0.5, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setDensity(1).setFriction(0.4).setRestitution(0.1), rb);
if (ccd) rb.setSoftCcdPrediction((400 / 480) * 1.25);
const steps = Math.round(T / dt);
for (let s = 1; s <= steps; s++) {
  w.step();
  let nc = 0, found = false, d = null;
  w.contactPair(gc, cyl, (m) => { found = true; nc = m.numContacts(); for (let i = 0; i < nc; i++) d = Math.min(d ?? 9, m.contactDist(i)); });
  const p = rb.translation();
  if (s % every === 0 || s <= 3 || s === steps) console.log(`s ${s} x ${p.x.toFixed(4)} y-r ${(p.y - r).toFixed(4)} z ${p.z.toFixed(4)} wz ${rb.angvel().z.toFixed(3)} pair ${found} n ${nc} minDist ${d?.toFixed(4)}`);
}
process.exit(0);
