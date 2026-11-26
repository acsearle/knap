// "Upright" in the project's wording (docs/RAPIER.md: "Upright wheels on a loose beam") means a
// wheel STANDING on its rim (axis horizontal), not lying on its cap as ../upright.mjs tested.
// Here: native cylinder r, half-length 0.5, axis along world Z, standing on a fixed beam that runs
// along X (cuboid or convex hull of the same box, half-extents hx x 0.46 x 0.46, top at y = 0),
// knap settings (g 1226.25, dt 1/480, 30 iterations, sleeping off, friction 0.4). Started at rest.
// Reports v_x at 1 s and 2 s, travel, and whether it left the beam end.
// usage: node spikes/rapier-limits/cylbox/refute/uprightbeam.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const DT = 1 / 480;
function boxPts(hx, hy, hz) { const p = []; for (const x of [-hx, hx]) for (const y of [-hy, hy]) for (const z of [-hz, hz]) p.push(x, y, z); return new Float32Array(p); }
function run({ r, hx, x0, hull }) {
  const w = new RAPIER.World({ x: 0, y: -1226.25, z: 0 });
  w.timestep = DT; w.numSolverIterations = 30;
  const g = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.46, 0));
  const cd = hull ? RAPIER.ColliderDesc.convexHull(boxPts(hx, 0.46, 0.46)) : RAPIER.ColliderDesc.cuboid(hx, 0.46, 0.46);
  w.createCollider(cd.setFriction(0.4), g);
  const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(x0, r, 0));
  w.createCollider(RAPIER.ColliderDesc.cylinder(0.5, r).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setDensity(1).setFriction(0.4), rb);
  let v1, v2, off = null;
  for (let i = 1; i <= 960; i++) {
    w.step();
    const t = rb.translation();
    if (i === 480) v1 = rb.linvel().x; if (i === 960) v2 = rb.linvel().x;
    if (off == null && t.y < r - 0.3) off = { t: i * DT, x: t.x };
  }
  const t = rb.translation();
  w.free();
  return { v1, v2, dx: t.x - x0, off };
}
const f = (x) => (x == null ? '-' : x.toFixed(3));
console.log('floor | r | beam hx | x0 | v_x 1 s | v_x 2 s | travel | dropped 0.3 (t, x)');
for (const hull of [false, true]) for (const r of [0.5, 1, 2.5]) for (const [hx, x0] of [[3.5, 0], [3.5, 1.3], [7.5, 0.3], [30, 0.3]]) {
  const o = run({ r, hx, x0, hull });
  console.log(`${hull ? 'hull' : 'cuboid'} | ${r} | ${hx} | ${x0} | ${f(o.v1)} | ${f(o.v2)} | ${f(o.dx)} | ${o.off ? f(o.off.t) + ' x ' + f(o.off.x) : '-'}`);
}
process.exit(0);
