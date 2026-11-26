// Independent check of "native cylinder on its side rolls by itself only at knap scale (gravity)".
// Native cylinder (axis Z, half-length hl, radius r) placed touching a WIDE fixed cuboid (top y=0),
// so it cannot fall off. Reports drift |dx| and |wz| over time, and the first time |dx| > 0.05*r.
// node spikes/rapier-limits/cylhull/refute/selfroll.mjs [config] [r] [T] [x0]
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const CFG = {
  knap: { g: 1226.25, dt: 1 / 480, iters: 30, ccd0: true },
  si: { g: 9.81, dt: 1 / 60 },                                    // all Rapier defaults
  g981_dt480: { g: 9.81, dt: 1 / 480, iters: 30, ccd0: true },   // their "g only" switch
  si_dt480: { g: 9.81, dt: 1 / 480 },                             // SI defaults but dt 1/480
  si_equiv: { g: 9.81, dt: (1 / 480) * Math.sqrt(125), iters: 30, ccd0: true }, // knap seen in SI time units
};
const name = process.argv[2] ?? 'knap', r = +(process.argv[3] ?? 1), T = +(process.argv[4] ?? 3), x0 = +(process.argv[5] ?? 0.3);
const hl = +(process.env.HL ?? 0.46);
const c = CFG[name];
const w = new RAPIER.World({ x: 0, y: -c.g, z: 0 });
w.timestep = c.dt;
if (c.iters) w.numSolverIterations = c.iters;
if (c.ccd0) w.integrationParameters.maxCcdSubsteps = 0;
const fb = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
const floor = w.createCollider(RAPIER.ColliderDesc.cuboid(50, 1, 50).setTranslation(0, -1, 0), fb);
const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(x0, r, 0).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }));
const cyl = w.createCollider(RAPIER.ColliderDesc.cylinder(hl, r), rb);
const steps = Math.round(T / c.dt);
let first = null; const marks = new Set([1, 2, 5, 10, 20, 30, 60, 120, 300].map((s) => Math.round(s / c.dt)));
const out = [];
for (let s = 1; s <= steps; s++) {
  w.step();
  const p = rb.translation();
  if (first == null && Math.abs(p.x - x0) > 0.05 * r) first = +(s * c.dt).toFixed(3);
  if (marks.has(s) || s === steps) out.push(`t${+(s * c.dt).toFixed(1)}:dx=${(p.x - x0).toExponential(2)},wz=${rb.angvel().z.toExponential(2)},y-r=${(p.y - r).toExponential(2)}`);
}
console.log(`${name} r=${r} hl=${hl} x0=${x0} T=${T}s steps=${steps} first|dx|>0.05r at ${first}s | ${out.join(' ')}`);
process.exit(0);
