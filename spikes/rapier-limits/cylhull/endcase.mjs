// Native-API replica of the project's repro (spikes/wheels/out/diag2.mjs "cyl 1 15 2"): a floor of
// 5 parallel 15-hole stadium hulls (on edge: hole axis Z, run along X; or flat with arg axis=1), a
// native cylinder r (half-length 0.5, axis Z, rolling along X) placed touching at x = 0..14.
// Unlike the original it prints x and the step/position where the cylinder leaves the floor.
// node spikes/rapier-limits/cylhull/endcase.mjs [r=1] [axis=2] [ccd=1] [hooks=0] [T=1] [xs=0,1,13,14]
import { RAPIER, prismPoints } from './lib.mjs';
const r = +(process.argv[2] ?? 1), axis = +(process.argv[3] ?? 2), ccd = (process.argv[4] ?? '1') !== '0';
const hooksOn = (process.argv[5] ?? '0') !== '0', T = +(process.argv[6] ?? 1);
const xs = (process.argv[7] ?? '0,1,2,7,12,13,14').split(',').map(Number);
const Y_TO_Z = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
for (const x of xs) {
  const w = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
  w.timestep = 1 / 480; w.numSolverIterations = 30; w.numInternalPgsIterations = 1; w.integrationParameters.maxCcdSubsteps = 0;
  const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  let gc = null;
  for (let zr = -2; zr <= 2; zr++) {
    // axis 2: hole axis Z (beam on edge); axis 1: hole axis Y (beam flat). Run of 15 cells along X.
    const pts = prismPoints([0, -0.46, zr], axis, 0, 0.46, 0.46, 16, 14, 0.01);
    const d = RAPIER.ColliderDesc.convexHull(pts);
    if (hooksOn) d.setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    const c = w.createCollider(d, g);
    if (zr === 0) gc = c;
  }
  const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(x, r, 0));
  const cyl = w.createCollider(RAPIER.ColliderDesc.cylinder(0.5, r).setRotation(Y_TO_Z).setDensity(1).setFriction(0.4).setRestitution(0.1), rb);
  if (ccd) rb.setSoftCcdPrediction((400 / 480) * 1.25);
  const hooks = hooksOn ? { filterContactPair: () => RAPIER.SolverFlags.COMPUTE_IMPULSE, filterIntersectionPair: () => true } : undefined;
  let left = null, zeroOver = null, maxVx = 0;
  const steps = Math.round(T * 480);
  for (let i = 1; i <= steps; i++) {
    w.step(undefined, hooks);
    const p = rb.translation();
    maxVx = Math.max(maxVx, Math.abs(rb.linvel().x));
    let n = 0, found = false;
    w.contactPair(gc, cyl, (m) => { found = true; n = m.numContacts(); });
    const over = p.x >= -0.46 && p.x <= 14.46;
    if (zeroOver == null && over && n === 0 && p.y > r - 0.5) zeroOver = { step: i, x: +p.x.toFixed(3), y: +p.y.toFixed(3), found };
    if (left == null && p.y < r - 0.1) left = { step: i, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3) };
  }
  const p = rb.translation();
  let nc = 0; w.contactPair(gc, cyl, (m) => (nc = m.numContacts()));
  console.log(`x0 ${x} -> x ${p.x.toFixed(3)} y-r ${(p.y - r).toFixed(4)} z ${p.z.toFixed(3)} contacts(row0) ${nc} max|vx| ${maxVx.toFixed(2)} dropStart ${JSON.stringify(left)} zeroWhileOver ${JSON.stringify(zeroOver)}`);
  w.free();
}
process.exit(0);
