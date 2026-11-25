// debug: mean ratio (from angles) and end-of-step ratio of a driven pair with a damping load on the output, with/without the stop row
import { makeWorld, makeGear, pinGear, motor, Mesh, omega, twist, q, DT, PITCH, fmt } from './lib.mjs';
const axis = [0, 1, 0];
for (const [stop, damp, w, dd] of [[false, 2, 5, 0], [true, 2, 5, 0], [true, 0, 5, 0], [true, 2, 5, 0.0], [true, 2, 5, -0.01]]) {
  const W = makeWorld();
  const g1 = makeGear(W, { centre: [0, 0, 0], axis, r: 1 });
  const g2 = makeGear(W, { centre: [2 + dd, 0, 0], axis, r: 1, angDamp: damp });
  const j1 = pinGear(W, g1); pinGear(W, g2);
  motor(W, j1, w);
  const m = new Mesh(W, g1, g2, { lead: true, stop });
  const s1 = {}, s2 = {};
  let a0, b0, inst = 0, n = 0;
  for (let i = 0; i < 480 * 4; i++) {
    m.update(); W.w.step();
    const a = twist(q(g1.body.rotation()), axis, s1), b = twist(q(g2.body.rotation()), axis, s2);
    if (i === 479) [a0, b0] = [a, b];
    if (i > 479) { inst += omega(g2.body, axis) / omega(g1.body, axis); n++; }
  }
  const ratio = (twist(q(g2.body.rotation()), axis, s2) - b0) / (twist(q(g1.body.rotation()), axis, s1) - a0);
  console.log(`stop=${stop} outputDamping=${damp} Δd=${dd}: mean ratio (angles) ${fmt(ratio, 6)}; mean end-of-step ω2/ω1 ${fmt(inst / n, 6)} (ideal −1); phase err ${fmt(m.e / PITCH, 4)} teeth`);
}
process.exit(0);
