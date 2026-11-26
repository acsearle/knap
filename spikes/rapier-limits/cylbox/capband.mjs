// Pure geometry: parry's contact query (GJK + EPA) between a box (top face y=0) and an UPRIGHT
// cylinder whose cap is parallel to that face, at a given penetration depth (0 = exactly touching).
// A correct answer has normal (0,1,0) and distance = -depth.
// usage: node capband.mjs
import RAPIER from '@dimforge/rapier3d-compat';
await RAPIER.init();
const I = { x: 0, y: 0, z: 0, w: 1 };
const f = (x) => (x === 0 ? '0' : Math.abs(x) < 1e-3 || Math.abs(x) >= 1e4 ? x.toExponential(2) : x.toFixed(4));
console.log('box half-extents | r | x0,z0 | depth | dist | normal | tilt deg');
for (const [hx, hy, hz] of [[3.5, 0.46, 0.46], [20, 1, 20], [2000, 1, 2000]])
  for (const r of [0.5, 1, 2.5])
    for (const [x0, z0] of [[0, 0], [0.37, 0.11]])
      for (const depth of [-0.001, 0, 1e-5, 1e-3, 0.01]) {
        const box = new RAPIER.Cuboid(hx, hy, hz), cyl = new RAPIER.Cylinder(0.46, r);
        const c = box.contactShape({ x: 0, y: -hy, z: 0 }, I, cyl, { x: x0, y: 0.46 - depth, z: z0 }, I, 0.02);
        if (!c) { console.log(`${hx}x${hy}x${hz} | ${r} | ${x0},${z0} | ${depth} | none`); continue; }
        const n = c.normal1, tilt = Math.acos(Math.min(1, Math.abs(n.y))) * 180 / Math.PI;
        console.log(`${hx}x${hy}x${hz} | ${r} | ${x0},${z0} | ${depth} | ${f(c.distance)} | (${f(n.x)},${f(n.y)},${f(n.z)}) | ${f(tilt)}`);
      }
process.exit(0);
