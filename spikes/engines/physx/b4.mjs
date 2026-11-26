// B4a small box on top face of a fixed 32-gon prism; B4b dynamic 16/32-gon prism on its end. node b4.mjs
import * as P from './lib.mjs';
console.log('B4', P.settingsLine());
const top = 0.25; // prism depth 0.5 centred at 0
const geo32 = P.convexGeom(P.prismPoints(32, 0.5, 0.25, 'y'));
console.log('32-gon hull: verts', geo32.convexMesh.getNbVertices(), 'polygons', geo32.convexMesh.getNbPolygons());
const spots = [[0, 0], [0.3, 0], [0, 0.3], [-0.35, 0.1], [0.38, 0.2], [-0.2, -0.38], [0.42, 0]];
for (const [x, z] of spots) {
  const s = P.makeScene({ contacts: true });
  P.addStatic(s, geo32, [0, 0, 0]);
  const b = P.addDynamic(s, [{ geom: P.boxGeom(0.08, 0.05, 0.08) }], [x, top + 0.05, z], undefined, P.bodyOpts());
  let nmin = 99, nmax = 0;
  P.stepReal(s, 2, (t) => { if (t > 0.5) { const n = P.lastContacts().reduce((a, p) => a + p.length, 0); nmin = Math.min(nmin, n); nmax = Math.max(nmax, n); } });
  const p = P.pos(b); const tilt = P.angleBetween(P.rotVec(P.quat(b), [0, 1, 0]), [0, 1, 0]);
  console.log(`B4a spot (${x},${z}) r=${Math.hypot(x, z).toFixed(2)}: tilt ${P.f(tilt * 180 / Math.PI, 3)} deg, sink ${P.f(top + 0.05 - p[1])}, fell ${p[1] < 0 ? 'YES' : 'no'}, moved ${P.f(Math.hypot(p[0] - x, p[2] - z))}, contacts ${nmin}-${nmax}`);
}
for (const n of [16, 32]) for (const floor of ['plane', 'box']) {
  const s = P.makeScene({ contacts: true });
  if (floor === 'box') P.addStatic(s, P.boxGeom(20, 0.5, 20), [0, -0.5, 0]); else P.addPlane(s, 0);
  const b = P.addDynamic(s, [{ geom: P.convexGeom(P.prismPoints(n, 0.5, 0.46, 'y')) }], [0, 0.46, 0], undefined, P.bodyOpts());
  let nmin = 99, nmax = 0;
  P.stepReal(s, 2, (t) => { if (t > 0.5) { const k = P.lastContacts().reduce((a, p) => a + p.length, 0); nmin = Math.min(nmin, k); nmax = Math.max(nmax, k); } });
  const tilt = P.angleBetween(P.rotVec(P.quat(b), [0, 1, 0]), [0, 1, 0]);
  console.log(`B4b ${n}-gon on ${floor}: tilt ${P.f(tilt * 180 / Math.PI, 3)} deg, sink ${P.f(0.46 - P.pos(b)[1])}, contacts ${nmin}-${nmax}`);
}
process.exit(0);
