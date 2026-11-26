// Pure geometry (no stepping): parry's convex-convex contact query (GJK, EPA fallback) between a
// box floor (top face at y=0) and a cylinder lying on its side (axis along x), at a known
// penetration depth. Reports how far the returned witness point on the cylinder sits from the
// true contact line (|z| offset, the "lever") and how far the normal tilts from +Y.
// Also cuboid vs a 32-gon prism and vs a halfspace for comparison.
// usage: node gjkband.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const S45 = Math.SQRT1_2, rot = { x: 0, y: 0, z: S45, w: S45 }, I = { x: 0, y: 0, z: 0, w: 1 };
const f = (x) => (x === 0 ? '0' : Math.abs(x) < 1e-3 || Math.abs(x) >= 1e4 ? x.toExponential(1) : x.toFixed(4));
const eps_rel = Math.sqrt(10 * 1.1920929e-7);
function probe(H, r, depth, x0, z0, other = 'cyl') {
  const floor = other === 'hs' ? new RAPIER.HalfSpace({ x: 0, y: 1, z: 0 }) : new RAPIER.Cuboid(H, 1, H);
  const fpos = other === 'hs' ? { x: 0, y: 0, z: 0 } : { x: 0, y: -1, z: 0 };
  const cyl = new RAPIER.Cylinder(0.46, r);
  const c = floor.contactShape(fpos, I, cyl, { x: x0, y: r - depth, z: z0 }, rot, 0.02);
  if (!c) return null;
  const tilt = Math.acos(Math.min(1, Math.abs(c.normal1.y))) * 180 / Math.PI;
  return { dist: c.distance, lever: c.point2.z - z0, tilt, n: c.normal1 };
}
console.log('eps_rel (sqrt(10*f32 eps)) =', eps_rel.toExponential(3));
console.log('H | r | x0,z0 | depth | band ~ eps_rel*|CSO support| | reported dist | lever (witness z - centre z) | normal tilt deg');
for (const H of [1.5, 5, 20, 200, 2000])
  for (const r of [0.5, 1])
    for (const [x0, z0] of [[0, 0], [0.37, 0.21], [0.6 * H, -0.3 * H]])
      for (const depth of [-0.01, 0, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3]) {
        const p = probe(H, r, depth, x0, z0);
        const band = eps_rel * Math.hypot(H + Math.abs(x0) + 0.46, 1 + 2 * r, H + Math.abs(z0) + r);
        console.log(`${H} | ${r} | ${f(x0)},${f(z0)} | ${depth} | ${f(band)} | ${p ? f(p.dist) : 'none'} | ${p ? f(p.lever) : '-'} | ${p ? f(p.tilt) : '-'}`);
      }
console.log('\nhalfspace (contact_halfspace_support_map, no GJK):');
for (const depth of [0, 0.001, 0.01]) for (const [x0, z0] of [[0, 0], [1200, -600]]) {
  const p = probe(0, 1, depth, x0, z0, 'hs');
  console.log(`hs | 1 | ${x0},${z0} | ${depth} | - | ${f(p.dist)} | ${f(p.lever)} | ${f(p.tilt)}`);
}
process.exit(0);
