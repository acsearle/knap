// Unbevelled n-gon prism convexHull (radius r, half-length 0.46) lying on its cap on a wide fixed cuboid.
// Points per step (histogram) and sink after T s. If parry's "first 4 face vertices" truncation is the
// cause, the contact count should drop and sink rise as n grows past 4.
// node spikes/rapier-limits/cylhull/refute/hullcap.mjs [g=9.81] [dtInv=60] [T=10] [r=1] [iters=default]
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const a = process.argv.slice(2);
const g = +(a[0] ?? 9.81), dt = 1 / +(a[1] ?? 60), T = +(a[2] ?? 10), r = +(a[3] ?? 1), iters = a[4] ? +a[4] : null;
for (const n of [3, 4, 5, 6, 8, 12, 16, 32, 64]) {
  const w = new RAPIER.World({ x: 0, y: -g, z: 0 }); w.timestep = dt; if (iters) w.numSolverIterations = iters;
  const floor = w.createCollider(RAPIER.ColliderDesc.cuboid(50, 1, 50).setTranslation(0, -1, 0), w.createRigidBody(RAPIER.RigidBodyDesc.fixed()));
  const R = r / Math.cos(Math.PI / n), pts = [];
  for (let i = 0; i < n; i++) { const t = ((i + 0.5) / n) * 2 * Math.PI; for (const s of [-1, 1]) pts.push(R * Math.cos(t), s * 0.46, R * Math.sin(t)); }
  const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(0.3, 0.46, 0));
  const c = w.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(pts)), rb);
  const hist = {}; let fell = null;
  const steps = Math.round(T / dt);
  for (let s = 1; s <= steps; s++) {
    w.step();
    let k = 0; w.contactPair(c, floor, (m) => (k = m.numContacts()));
    if (fell == null) hist[k] = (hist[k] ?? 0) + 1;
    if (fell == null && rb.translation().y < -0.5) fell = +(s * dt).toFixed(3);
  }
  console.log(`n=${String(n).padStart(2)} g=${g} dt=1/${1 / dt} T=${T} r=${r}: pointsPerStep ${JSON.stringify(hist)} sink ${(0.46 - rb.translation().y).toFixed(4)} fellThroughAt ${fell}`);
  w.free();
}
process.exit(0);
