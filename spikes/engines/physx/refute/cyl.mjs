// Independent check of B5a: native convex-core cylinder (r 1, length 0.92 studs) on its side on a fixed box floor
// 40 x 1 x 40 studs (and other floors), at rest and at 1 stud/s, 5 s. SI units.
// node cyl.mjs [nopcm] [co=<contact offset studs>] [floor=box|plane|trimesh|box500|box10] [margin=<studs>] [pos=<n>]
import { PX, phys, S, g, T, V, aa, scene, shape, dyn, stat, P3, LV, AV } from './px.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.includes('=') ? a.split('=') : [a, true]));
const co = args.co !== undefined ? +args.co * S : undefined;
const margin = +(args.margin ?? 0) * S;
const floor = args.floor ?? 'box';
const pos = +(args.pos ?? 4);
function mkFloor(s) {
  const o = { contactOffset: co };
  if (floor === 'plane') return stat(s, new PX.PxPlaneGeometry(), [0, 0, 0], aa([0, 0, 1], Math.PI / 2), o);
  if (floor === 'trimesh') { // 40 x 40 stud square of 2 triangles at y = 0 (one-sided upward)
    const h = 20 * S; const pts = new PX.PxArray_PxVec3(4); [[-h, 0, -h], [h, 0, -h], [h, 0, h], [-h, 0, h]].forEach((p, i) => pts.set(i, V(...p)));
    const idx = new PX.PxArray_PxU32(6); [0, 2, 1, 0, 3, 2].forEach((v, i) => idx.set(i, v));
    const d = new PX.PxTriangleMeshDesc(); d.points.count = 4; d.points.stride = 12; d.points.data = pts.begin();
    d.triangles.count = 2; d.triangles.stride = 12; d.triangles.data = idx.begin();
    const cp = new PX.PxCookingParams(phys.getTolerancesScale());
    const mesh = PX.CreateTriangleMesh(cp, d);
    return stat(s, new PX.PxTriangleMeshGeometry(mesh), [0, 0, 0], undefined, o);
  }
  const hx = floor === 'box500' ? 250 : floor === 'box10' ? 5 : 20;
  return stat(s, new PX.PxBoxGeometry(hx * S, 0.5 * S, 20 * S), [0, -0.5 * S, 0], undefined, o);
}
const geomOf = () => PX.PxConvexCoreGeometryFactory.prototype.createFromCylinder(new PX.PxConvexCoreCylinder(0.92 * S - 2 * margin, 1 * S - margin), margin);
const lines = [];
for (const v0 of [0, 1]) {
  const s = scene({ clearFlags: args.nopcm ? ['eENABLE_PCM'] : [] });
  mkFloor(s);
  const sh = [geomOf(), T([0, 0, 0], aa([0, 1, 0], Math.PI / 2)), { contactOffset: co }]; // core cylinder axis X -> world Z
  const b = dyn(s, [sh], [0, 1 * S, 0], undefined, { pos });
  b.setLinearVelocity(V(v0 * S, 0, 0)); b.setAngularVelocity(V(0, 0, -v0));
  const rec = []; let ymin = 9;
  for (let i = 1; i <= 2400; i++) {
    s.step(1 / 480);
    ymin = Math.min(ymin, P3(b)[1] / S);
    if ([48, 240, 480, 960, 2400].includes(i)) rec.push((LV(b)[0] / S).toFixed(4));
  }
  lines.push(`v0 ${v0}: vx (studs/s) at 0.1 0.5 1 2 5 s = ${rec.join(' ')}; min centre y ${ymin.toFixed(4)} (1 = touching); spin ${AV(b)[2].toFixed(3)} rad/s`);
}
console.log(`cylinder floor=${floor} pcm=${!args.nopcm} contactOffset=${args.co ?? 'default'} margin=${args.margin ?? 0} pos=${pos}\n  ${lines.join('\n  ')}`);
process.exit(0);
