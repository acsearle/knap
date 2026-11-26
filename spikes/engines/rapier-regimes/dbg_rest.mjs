// A wheel r 1 at rest on its side on a fixed box floor: does it start rolling by itself, and does
// that depend on the floor's size? (B5a "rest"; found while enlarging the floor.)
//   node dbg_rest.mjs R0
import { init, REGIMES, W, steps, Q_Y_TO_X } from './lib.mjs';
await init();
const reg = REGIMES[process.argv[2] ?? 'R0'];
for (const hz of [20, 21, 30, 40, 60, 100]) {
  for (const hx of [20, 60]) {
    const w = new W(reg); w.floorBox(hx, 0.5, hz);
    const b = w.body({ pos: { x: 0, y: 1, z: 0 }, rot: Q_Y_TO_X });
    w.add(b, w.cylinder(0.46, 1));
    const tr = [];
    for (const T of [0.5, 1, 2, 3, 5]) { w.step(steps(reg, T) - steps(reg, w.t)); tr.push(w.vel(b).z.toFixed(3)); }
    console.log(`floor half ${hx} x ${hz}: vz at 0.5/1/2/3/5 s`, tr.join(' '), ' z', w.pos(b).z.toFixed(2));
    w.free();
  }
}
process.exit(0);
