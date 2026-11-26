// Pure-Rapier port of spikes/wheels/diag3.ts (the set-up that reported "tunnels through"):
// world as spikes/wheels/lib.ts makeWorld(30): g 1226.25, dt 1/480, 30 iterations, 1 internal PGS
// iteration, maxCcdSubsteps 0; fixed cuboid half-extents (hx,1,hz) at (10,-1,0), friction 0.4,
// restitution 0.1; native cylinder half-length 0.5 radius r, axis turned onto world Z (rolls along
// X), density 1, friction 0.4, restitution 0.1, sleeping off, soft CCD 400*dt*1.25 (or 0).
// Reports the first time the centre drops 0.5 below rest height, and whether the centre was then
// over the box top (x in [10-hx, 10+hx]) or past an edge; plus contact count at that time.
// usage: node spikes/rapier-limits/cylbox/refute/diag3port.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const DT = 1 / 480;
function run({ r, hx = 30, hz = 50, x0 = 0.3, ccd = true }) {
  const w = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
  w.timestep = DT; w.numSolverIterations = 30; w.numInternalPgsIterations = 1; w.integrationParameters.maxCcdSubsteps = 0;
  const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const gc = w.createCollider(RAPIER.ColliderDesc.cuboid(hx, 1, hz).setTranslation(10, -1, 0).setFriction(0.4).setRestitution(0.1), g);
  const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(x0, r, 0));
  const c = w.createCollider(RAPIER.ColliderDesc.cylinder(0.5, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setDensity(1).setFriction(0.4).setRestitution(0.1), rb);
  if (ccd) rb.setSoftCcdPrediction(400 * DT * 1.25);
  let tMove = null, drop = null, minYover = Infinity, v1 = null, v26 = null;
  for (let i = 1; i <= 2400; i++) {
    w.step();
    const t = rb.translation(), v = rb.linvel();
    const sp = Math.hypot(v.x, v.y, v.z);
    if (tMove == null && sp > 0.1) tMove = i * DT;
    if (i === 480) v1 = v.x; if (i === 1248) v26 = v.x;
    const over = Math.abs(t.x - 10) < hx && Math.abs(t.z) < hz;
    if (over) minYover = Math.min(minYover, t.y - r);
    if (drop == null && t.y - r < -0.5) {
      let nc = 0; w.contactPair(gc, c, (m) => (nc = m.numContacts()));
      drop = { t: i * DT, x: t.x, over, nc, vy: v.y };
    }
  }
  const t = rb.translation();
  w.free();
  return { tMove, v1, v26, drop, minYover, xEnd: t.x };
}
const f = (x, d = 3) => (x == null ? '-' : Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(d));
console.log('r | hx | x0 | ccd | tMove | v_x 1 s | v_x 2.6 s | min (y-r) while over box | first drop >0.5: t, x, over box?, contacts');
for (const r of [0.5, 1, 1.5, 2.5]) for (const [hx, x0] of [[30, 0.3], [200, 0.3], [30, 10]]) for (const ccd of [true, false]) {
  const o = run({ r, hx, x0, ccd });
  const d = o.drop ? `${f(o.drop.t)} x ${f(o.drop.x, 1)} ${o.drop.over ? 'OVER' : 'past edge'} nc ${o.drop.nc}` : 'none';
  console.log(`${r} | ${hx} | ${x0} | ${ccd} | ${f(o.tMove)} | ${f(o.v1)} | ${f(o.v26)} | ${f(o.minYover, 4)} | ${d}`);
}
process.exit(0);
