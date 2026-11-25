// Diagnostic: trace a wheel rolling on a liftarm track (where does it fall through?).
// Usage: node spikes/wheels/out/diag.mjs kind r ground [v0] [iters]
import { DT, addGround, addWheel, fmt, init, makeWorld } from './lib';
import type { GroundKind, WheelKind } from './lib';
const [kind, rs, ground, v0s, its] = process.argv.slice(2);
const r = Number(rs);
const v0 = Number(v0s ?? 40);
await init();
const w = makeWorld(Number(its ?? 30));
addGround(w, ground as GroundKind, -20, 220);
const rb = addWheel(w, kind as WheelKind, r, [0, r, 0]);
rb.setLinvel({ x: v0, y: 0, z: 0 }, true);
rb.setAngvel({ x: 0, y: 0, z: -v0 / r }, true);
let prevY = r;
for (let i = 0; i < 1920; i++) {
  w.step();
  const t = rb.translation();
  const v = rb.linvel();
  if (Math.abs(t.y - prevY) > 0.004 || i % 96 === 0) console.log(fmt(i * DT, 4), 'x', fmt(t.x, 3), 'y-r', fmt(t.y - r, 4), 'vx', fmt(v.x, 2), 'vy', fmt(v.y, 2), 'wz*r', fmt(rb.angvel().z * r, 2));
  prevY = t.y;
  if (t.y < -3) break;
}
