// Is the high-speed energy collapse a per-step-rotation effect? Free 0.5:2.5 pair at ω_small = 200,
// with the fixed step divided by s (and solver iterations divided by s, same total substeps).
import { makeWorld, revolute, Mesh, omega, fmt, kinetic, PITCH } from './sk.mjs';
import { gearBody, AXZ } from './sk.mjs';
for (const w0 of [100, 200]) for (const s of [1, 2, 4, 8]) for (const lead of [true, false]) {
  const W = makeWorld({ gravity: [0, 0, 0], iters: Math.max(1, Math.round(240 / s)) });
  const dt = 1 / (480 * s);
  W.w.timestep = dt;
  const a = gearBody(W, [0, 0, 0], 0.5), b = gearBody(W, [3, 0, 0], 2.5);
  revolute(W, W.ground, a.body, [0, 0, 0], [0, 0, 0], AXZ);
  revolute(W, W.ground, b.body, [3, 0, 0], [0, 0, 0], AXZ);
  a.body.setAngvel({ x: 0, y: 0, z: w0 }, true);
  b.body.setAngvel({ x: 0, y: 0, z: -w0 / 5 }, true);
  const M = new Mesh(W, a.g, b.g, { lead, dt });
  const K0 = kinetic(a.body) + kinetic(b.body);
  for (let i = 0; i < 480 * s; i++) { M.update(); W.w.step(); }
  console.log(`ω0=${w0} dt=1/${480 * s} iters=${Math.round(240 / s)} lead=${lead ? 1 : 0}: rotation/step ${fmt(w0 * dt, 3)} rad; K/K0 after 1 s ${fmt((kinetic(a.body) + kinetic(b.body)) / K0, 4)}; ω_small ${fmt(omega(a.body, AXZ), 2)}; max phase err ${fmt(M.maxAbsE / PITCH, 3)} teeth`);
}
process.exit(0);
