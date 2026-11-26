// Trace the 5-cube stack (B1c) in a regime: top cube position over time.
//   node dbg_stack.mjs R0
import { init, REGIMES, W, steps, upTilt } from './lib.mjs';
await init();
const reg = REGIMES[process.argv[2] ?? 'R0'];
const H = 0.46;
const w = new W(reg); w.floorBox();
const bs = [];
for (let i = 0; i < 5; i++) { const b = w.body({ pos: { x: 0, y: H + 2 * H * i, z: 0 } }); w.add(b, w.cuboid(H, H, H)); bs.push(b); }
const N = steps(reg, 3);
for (let i = 1; i <= N; i++) { w.step(); if (i % Math.round(N / 15) === 0) console.log(w.t.toFixed(2), bs.map((b) => { const p = w.pos(b); return `(${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)})`; }).join(' ')); }
process.exit(0);
