// Convex-core cylinder r 1 on a fixed floor that is a convex MESH box (8 vertices) instead of a PxBoxGeometry, and on a
// convex-core box. At rest and rolled at 1 stud/s, 3 s. node b5hullfloor.mjs
import * as P from './lib.mjs';
const { PX } = P;
console.log('b5hullfloor', P.settingsLine());
for (const [hx, kind] of [[5, 'mesh'], [20, 'mesh'], [250, 'mesh'], [5, 'corebox'], [20, 'corebox']]) {
  const res = [];
  for (const v0 of [0, 1]) {
    const s = P.makeScene();
    const pts = []; for (const x of [-hx, hx]) for (const y of [-0.5, 0.5]) for (const z of [-20, 20]) pts.push([x, y, z]);
    const geom = kind === 'mesh' ? P.convexGeom(pts) : PX.PxConvexCoreGeometryFactory.prototype.createFromBox(new PX.PxConvexCoreBox(2 * hx * P.L, 1 * P.L, 40 * P.L), 0);
    P.addStatic(s, geom, [0, -0.5, 0]);
    const b = P.addDynamic(s, [{ geom: P.cylCoreGeom(1, 0.46), local: [[0, 0, 0], P.qAxisAngle([0, 1, 0], Math.PI / 2)] }], [0, 1, 0], undefined, P.bodyOpts());
    P.setLv(b, [v0, 0, 0]); P.setAv(b, [0, 0, -v0]);
    let vmax = 0, ymin = 9; P.stepReal(s, 3, () => { vmax = Math.max(vmax, Math.abs(P.lv(b)[0])); ymin = Math.min(ymin, P.pos(b)[1]); });
    res.push(`v0 ${v0}: vx end ${P.f(P.lv(b)[0], 3)} max|vx| ${P.f(vmax, 3)} x ${P.f(P.pos(b)[0], 3)} min y ${P.f(ymin, 4)}`);
  }
  console.log(`${kind} box half x ${hx}: ${res.join(' | ')}`);
}
process.exit(0);
