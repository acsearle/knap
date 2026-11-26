// Clean one-switch test of the "stale points via try_update_contacts_eps" cause.
// Standalone pure Rapier (does not use ../lib.mjs).
//
// Switch: every step the fixed floor body is teleported along world X (the cylinder's axis
// direction) by +d / -d alternately. The floor is far wider than the cylinder, so the geometry the
// cylinder touches does not change, and a fixed body has no velocity, so the solver sees nothing.
// But parry's try_update_contacts_eps rejects reuse when a stored point moved more than
// sqrt(1e-6) = 1e-3 in the pair frame, so d = 0.1 forces a full recompute every step, while
// d = 0.0003 (below 1e-3) leaves reuse possible: that is the control arm with the same code path.
// Rapier's own pair recycling is switched off in every arm (ActiveHooks + filterContactPair) so it
// cannot mask the difference. The persistent manifold, GJK warm start (init_dir) and solver warm
// start are kept in every arm (unlike re-creating the collider).
//
// usage: node spikes/rapier-limits/cylbox/refute/shuttle.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const S45 = Math.SQRT1_2;

function run({ g, dt, iters, r, hh, fh, x0 = 0, z0 = 0, v0 = 0, T, d, canSleep, shape = 'cyl', mu = 0.8 }) {
  const world = new RAPIER.World({ x: 0, y: -g, z: 0 });
  world.timestep = dt;
  if (iters) world.numSolverIterations = iters;
  const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -1, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(fh, 1, fh).setFriction(mu), fb);
  const cd = shape === 'capsule' ? RAPIER.ColliderDesc.capsule(hh, r) : RAPIER.ColliderDesc.cylinder(hh, r);
  cd.setFriction(mu).setDensity(1).setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
  const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(x0, r, z0).setRotation({ x: 0, y: 0, z: S45, w: S45 }).setCanSleep(canSleep);
  if (v0) bd.setLinvel(0, 0, v0).setAngvel({ x: v0 / r, y: 0, z: 0 });
  const b = world.createRigidBody(bd);
  world.createCollider(cd, b);
  const hooks = { filterContactPair: () => RAPIER.SolverFlags.COMPUTE_IMPULSE, filterIntersectionPair: () => true };
  const N = Math.round(T / dt);
  let maxV = 0, v1 = null;
  for (let k = 1; k <= N; k++) {
    if (d) fb.setTranslation({ x: k % 2 ? d : -d, y: -1, z: 0 }, true);
    world.step(undefined, hooks);
    const v = b.linvel(); const s = Math.hypot(v.x, v.z);
    maxV = Math.max(maxV, s);
    if (Math.abs(k * dt - 1) < dt / 2) v1 = s;
  }
  const p = b.translation(), v = b.linvel();
  world.free();
  return { vEnd: Math.hypot(v.x, v.z), v1, maxV, dz: p.z - z0, y: p.y };
}

const f = (x) => (x == null ? '-' : Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(4));
const KN = { g: 1226.25, dt: 1 / 480, iters: 30, r: 1, hh: 0.46, canSleep: false };
const SI = { g: 9.81, dt: 1 / 60, iters: 0, r: 0.5, hh: 0.23, canSleep: true };
const cases = [
  ['knap r1, 200 box, (3.3,0), rest, 5 s', { ...KN, fh: 200, x0: 3.3, T: 5 }],
  ['knap r1, 20 box, centre, rest, 5 s', { ...KN, fh: 20, T: 5 }],
  ['knap r1, 200 box, v0 1, 3 s', { ...KN, fh: 200, x0: 3.3, v0: 1, T: 3 }],
  ['knap r2.5, 200 box, rest, 5 s', { ...KN, r: 2.5, fh: 200, x0: 3.3, T: 5 }],
  ['knap capsule r1, 200 box, rest, 5 s', { ...KN, shape: 'capsule', fh: 200, x0: 3.3, T: 5 }],
  ['SI r0.5 m, 200 m box, z0 -100, v0 0.05, sleep on, 20 s', { ...SI, fh: 200, x0: 3.3, z0: -100, v0: 0.05, T: 20 }],
  ['SI r0.5 m, 10 m box, centre, v0 0.05, sleep on, 8 s', { ...SI, fh: 10, v0: 0.05, T: 8 }],
  ['SI r0.5 m, 10 m box, centre, v0 0.2, sleep on, 8 s', { ...SI, fh: 10, v0: 0.2, T: 8 }],
];
console.log('case | shuttle d | |v| at 1 s | |v| end | max |v| | z travel');
for (const [name, c] of cases) for (const d of [0, 0.0003, 0.1]) {
  const o = run({ ...c, d });
  console.log(`${name} | ${d} | ${f(o.v1)} | ${f(o.vEnd)} | ${f(o.maxV)} | ${f(o.dz)}`);
}
process.exit(0);
