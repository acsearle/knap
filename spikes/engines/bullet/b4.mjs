// B4 polygon faces: node b4.mjs <regime> [--margin=studs] [--poly=1]
import { ammo, World, RHO, f, tilt, regimeArg, flag, norm } from './lib.mjs';
await ammo();
const reg = regimeArg(), marginStud = flag('margin', null), poly = !!flag('poly', 0);
const steps = Math.round(2 * 480);
const w0 = new World({ regime: reg, marginStud });
const hullMarginStud = w0.prismShape(32, 0.5, 0.25, 'y', poly).getMargin() / w0.S;
console.log(`B4 regime=${reg} margin=${marginStud ?? 'default'} (hull margin ${f(hullMarginStud)} studs) polyhedralFeatures=${poly} boxAsHull=${!!flag('boxhull', 0)} sat=${!!flag('sat', 0)} iters=${w0.iterations}`);
// B4a
const spots = [[0, 0], [0.2, 0], [0.35, 0], [0, 0.35], [0.25, 0.25], [-0.3, 0.1], [0.1, -0.33]];
for (const [x, z] of spots) {
  const w = new World({ regime: reg, marginStud });
  const p = w.prismShape(32, 0.5, 0.25, 'y', poly);
  const hm = p.getMargin() / w.S;
  w.body(p, 0, [0, 0, 0]);
  const yTouch = 0.25 + 0.05; // geometric
  const bs = flag('boxhull', 0) ? w.boxHull(0.08, 0.05, 0.08, poly) : w.boxShape(0.08, 0.05, 0.08);
  const bm = flag('boxhull', 0) ? bs.getMargin() / w.S : 0;
  const b = w.body(bs, RHO * 0.16 * 0.1 * 0.16, [x, yTouch + hm + bm, z]);
  let maxSink = -1e9, cmin = 99, cmax = 0;
  for (let i = 0; i < steps; i++) { w.step(); const y = w.pos(b)[1]; maxSink = Math.max(maxSink, yTouch - y); if (i > 10) { const c = w.contacts(b); cmin = Math.min(cmin, c); cmax = Math.max(cmax, c); } }
  const y = w.pos(b)[1];
  const fell = y < 0;
  console.log(`B4a box at (${x},${z}): tilt ${f(tilt(w.quat(b)))} rad, sink vs geometric ${f(yTouch - y)} (max ${f(maxSink)}) studs, lateral move ${f(Math.hypot(w.pos(b)[0] - x, w.pos(b)[2] - z))}, fell=${fell}, contacts ${cmin}-${cmax}`);
}
// B4b
for (const n of [16, 32]) for (const floor of ['plane', 'box']) {
  const w = new World({ regime: reg, marginStud });
  if (floor === 'plane') w.body(w.planeShape(), 0, [0, 0, 0]); else w.body(w.boxShape(20, 0.5, 20), 0, [0, -0.5, 0]);
  const p = w.prismShape(n, 0.5, 0.46, 'y', poly);
  const hm = p.getMargin() / w.S;
  const area = 0.5 * n * 0.25 * Math.sin((2 * Math.PI) / n);
  const b = w.body(p, RHO * area * 0.92, [0, 0.46 + hm, 0]);
  let cmin = 99, cmax = 0;
  for (let i = 0; i < steps; i++) { w.step(); if (i > 10) { const c = w.contacts(b); cmin = Math.min(cmin, c); cmax = Math.max(cmax, c); } }
  console.log(`B4b ${n}-gon on ${floor}: tilt ${f(tilt(w.quat(b)))} rad, sink vs geometric ${f(0.46 - w.pos(b)[1])} studs, |v| ${f(norm(w.vel(b)))}, contacts ${cmin}-${cmax}`);
}
process.exit(0);
