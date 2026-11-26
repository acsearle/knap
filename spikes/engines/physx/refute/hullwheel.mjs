// Is the polygon-wheel speed loss (B5b hull: 9-12 % kept) a PhysX defect or the physics of a rolling n-gon with e = 0?
// Inelastic rolling n-gon (circumradius R, I_cm ~ m R^2 / 2): each vertex strike keeps w'/w = 1 - (1 - cos t)/1.5, t = 2 pi/n,
// strikes per second = w / t  =>  w(t) = w0 / (1 + k w0 t), k = (1 - cos t) / (1.5 t).
// Also: to tip over a vertex needs 0.75 m v^2 > m g R (1 - cos(t/2)).  node hullwheel.mjs
import { PX, phys, S, g, T, V, aa, scene, dyn, stat, P3, LV, AV } from './px.mjs';
function hull(n, R) {
  const pts = new PX.PxArray_PxVec3(2 * n);
  for (let i = 0; i < n; i++) { const a = Math.PI / n + 2 * Math.PI * i / n; pts.set(2 * i, V(R * Math.cos(a) * S, R * Math.sin(a) * S, -0.46 * S)); pts.set(2 * i + 1, V(R * Math.cos(a) * S, R * Math.sin(a) * S, 0.46 * S)); }
  const d = new PX.PxConvexMeshDesc(); d.points.count = 2 * n; d.points.stride = 12; d.points.data = pts.begin();
  d.flags = new PX.PxConvexFlags(PX.PxConvexFlagEnum.eCOMPUTE_CONVEX);
  const cp = new PX.PxCookingParams(phys.getTolerancesScale()); cp.planeTolerance = 0.0007 * S; // default 0.0007 is ABSOLUTE (m here): it merges 0.09-stud facets
  const m = PX.CreateConvexMesh(cp, d);
  if (!m) return null;
  return [new PX.PxConvexMeshGeometry(m), m.getNbVertices(), m.getNbPolygons()];
}
for (const n of [64, 127, 128]) {
  const R = 1 / Math.cos(Math.PI / n); // apothem 1: rests on a flat at centre height 1
  const h = hull(n, R);
  if (!h) { console.log(`n ${n}: cooking failed (2n = ${2 * n} vertices)`); continue; }
  const t = 2 * Math.PI / n, k = (1 - Math.cos(t)) / (1.5 * t);
  for (const v0 of [100, 1]) {
    const s = scene(); stat(s, new PX.PxBoxGeometry(250 * S, 0.5 * S, 20 * S), [240 * S, -0.5 * S, 0]);
    const b = dyn(s, [[h[0]]], [0, 1 * S, 0]);
    b.setLinearVelocity(V(v0 * S, 0, 0)); b.setAngularVelocity(V(0, 0, -v0));
    for (let i = 0; i < 960; i++) s.step(1 / 480);
    const kept = 100 * (-AV(b)[2]) / v0;
    const pred = 100 / (1 + k * v0 * 2);
    const canTip = 0.75 * v0 * v0 > g / S * R * (1 - Math.cos(t / 2));
    console.log(`n ${n} (cooked ${h[1]} verts, ${h[2]} polys) v0 ${v0} studs/s: after 2 s spin kept ${kept.toFixed(1)} %, x ${(P3(b)[0] / S).toFixed(2)} studs; inelastic-n-gon theory ${canTip ? pred.toFixed(1) + ' %' : 'cannot tip over a vertex -> stops'}`);
  }
}
process.exit(0);
