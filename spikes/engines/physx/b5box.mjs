// Convex-core cylinder (r 1, axis Z) on a fixed box floor of varying size / position, at rest and rolled at 1 stud/s, 3 s.
// node b5box.mjs
import * as P from './lib.mjs';
console.log('b5box', P.settingsLine());
const M = +(process.env.MARGIN ?? 0); console.log('margin', M, '(cylinder core radius r - margin, length - 2 margin)');
for (const [hx, cx, hy] of [[5, 0, 0.5], [20, 0, 0.5], [20, 0, 5], [50, 0, 0.5], [250, 0, 0.5]]) {
  const res = [];
  for (const v0 of [0, 1]) {
    const s = P.makeScene();
    P.addStatic(s, P.boxGeom(hx, hy, 20), [cx, -hy, 0]);
    const b = P.addDynamic(s, [{ geom: P.cylCoreGeom(1 - M, 0.46 - M, M), local: [[0, 0, 0], P.qAxisAngle([0, 1, 0], Math.PI / 2)] }], [0, 1, 0], undefined, P.bodyOpts());
    P.setLv(b, [v0, 0, 0]); P.setAv(b, [0, 0, -v0]);
    let vmax = 0, ymin = 9; P.stepReal(s, 3, () => { vmax = Math.max(vmax, Math.abs(P.lv(b)[0])); ymin = Math.min(ymin, P.pos(b)[1]); });
    res.push(`v0 ${v0}: vx end ${P.f(P.lv(b)[0], 3)} max|vx| ${P.f(vmax, 3)} x ${P.f(P.pos(b)[0], 3)} min y ${P.f(ymin, 4)}`);
  }
  console.log(`box half (${hx}, ${hy}) centre x ${cx}:  ${res.join(' | ')}`);
}
process.exit(0);
