// Does convex cooking depend on absolute units? Cook the B4/B5 32- and 64-gon prisms through ../lib.mjs (stud or PXU=m).
import * as P from '../lib.mjs';
for (const [n, r] of [[32, 0.5], [64, 1]]) {
  const g = P.convexGeom(P.prismPoints(n, r, 0.46, 'z'));
  console.log(`units ${P.UNITS}: ${n}-gon r ${r}: cooked ${g.convexMesh.getNbVertices()} verts, ${g.convexMesh.getNbPolygons()} polys; cookParams.planeTolerance ${P.cookParams.planeTolerance}`);
}
process.exit(0);
