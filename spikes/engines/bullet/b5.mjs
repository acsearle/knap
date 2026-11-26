// B5 rolling cylinder: node b5.mjs <regime> [--margin=studs]
import { ammo, World, RHO, f, tilt, regimeArg, flag, norm } from './lib.mjs';
await ammo();
const reg = regimeArg(), marginStud = flag('margin', null);
const H = 0.46;
const w0 = new World({ regime: reg, marginStud });
console.log(`B5 regime=${reg} cyl margin ${f(w0.cylShape(1, H).getMargin() / w0.S)} studs iters=${w0.iterations}`);
function floorOf(w, kind) { if (kind === 'plane') w.body(w.planeShape(), 0, [0, 0, 0]); else w.body(w.boxShape(20, 0.5, 20), 0, [0, -0.5, 0]); }
for (const kind of ['box', 'plane']) for (const v0 of [0, 1]) { // B5a
  const w = new World({ regime: reg, marginStud }); floorOf(w, kind);
  const r = 1, m = RHO * Math.PI * r * r * 0.92;
  const c = w.body(w.cylShape(r, H, 'z'), m, [0, r, 0]);
  w.setVel(c, [v0, 0, 0]); w.setAngvel(c, [0, 0, -v0 / r]);
  const out = []; let vmax = 0;
  for (let i = 1; i <= 5 * 480; i++) { w.step(); const v = w.vel(c)[0]; vmax = Math.max(vmax, Math.abs(v)); if (i % 480 === 0) out.push(f(v, 4)); }
  console.log(`B5a r1 on ${kind} v0=${v0}: vx at 1..5 s [${out.join(', ')}] studs/s, max |vx| ${f(vmax)}, sink ${f(r - w.pos(c)[1])}, x ${f(w.pos(c)[0])}`);
}
for (const kind of ['box', 'plane']) { // B5b
  const w = new World({ regime: reg, marginStud }); floorOf(w, kind);
  const r = 1, m = RHO * Math.PI * r * r * 0.92;
  const c = w.body(w.cylShape(r, H, 'z'), m, [-15, r, 0]);
  w.setVel(c, [100, 0, 0]); w.setAngvel(c, [0, 0, -100]);
  let maxSink = 0, sinkSum = 0, n = 0;
  for (let i = 1; i <= 2 * 480; i++) { w.step(); const s = r - w.pos(c)[1]; maxSink = Math.max(maxSink, s); if (i > 48) { sinkSum += s; n++; } if (w.pos(c)[0] > 19) { w.setVel(c, [w.vel(c)[0], w.vel(c)[1], 0]); } }
  // box floor is 40 wide: the run is 200 studs, so for 'box' extend: report only while on the floor
  console.log(`B5b r1 at 100 on ${kind}: v end ${f(w.vel(c)[0])} (${f(w.vel(c)[0])}%) mean sink ${f(sinkSum / n)} max ${f(maxSink)} studs, |vz| ${f(w.vel(c)[2])}, x ${f(w.pos(c)[0])}`);
}
{ // B5c
  const w = new World({ regime: reg, marginStud }); floorOf(w, 'plane');
  const mBeam = RHO * 9 * 0.92 ** 2; const beam = w.body(w.boxShape(4.5, H, H), mBeam, [0, H, 0]);
  const r = 2.5, m = RHO * Math.PI * r * r * 0.92;
  // upright wheel: axis along Z (across the beam, which runs along X)
  const c = w.body(w.cylShape(r, H, 'z'), m, [0, 0.92 + r, 0]);
  let maxSink = 0;
  for (let i = 1; i <= 2 * 480; i++) { w.step(); maxSink = Math.max(maxSink, 0.92 + r - w.pos(c)[1] - (H - w.pos(beam)[1])); }
  const sink = w.pos(beam)[1] + H - (w.pos(c)[1] - r);
  console.log(`B5c r2.5 upright on loose beam: sink into beam ${f(sink)} studs (max ${f(maxSink)}), beam into floor ${f(H - w.pos(beam)[1])}, wheel x ${f(w.pos(c)[0])}, |v| ${f(norm(w.vel(c)))}, tilt ${f(tilt(w.quat(c)) )}`);
}
process.exit(0);
