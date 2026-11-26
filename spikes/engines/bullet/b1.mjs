// B1 resting: node b1.mjs <regime> [--margin=studs]
import { ammo, World, RHO, f, tilt, regimeArg, flag, norm } from './lib.mjs';
await ammo();
const reg = regimeArg(), marginStud = flag('margin', null);
const H = 0.46, mC = RHO * 0.92 ** 3, mBeam = RHO * 9 * 0.92 ** 2;
const mk = () => { const w = new World({ regime: reg, marginStud }); w.body(w.boxShape(20, 0.5, 20), 0, [0, -0.5, 0]); return w; };
const steps = (s) => Math.round(s * 480);
{ const w0 = mk(); console.log(`B1 regime=${reg} margin=${marginStud ?? "default"} iters=${w0.iterations} split=${w0.split}`); }
{ // B1a
  const w = mk(); const c = w.body(w.boxShape(H, H, H), mC, [0, H, 0]);
  let minY = 1e9; for (let i = 0; i < steps(2); i++) { w.step(); minY = Math.min(minY, w.pos(c)[1]); }
  console.log(`B1a cube on fixed box: sink end ${f(H - w.pos(c)[1])} max ${f(H - minY)} studs, drift |v| ${f(norm(w.vel(c)))} studs/s, contacts ${w.contacts(c)}`);
}
{ // B1b
  const w = mk(); const b = w.body(w.boxShape(4.5, H, H), mBeam, [0, H, 0]); const c = w.body(w.boxShape(H, H, H), mC, [0, 3 * H, 0]);
  w.step(steps(2));
  const yb = w.pos(b)[1], yc = w.pos(c)[1];
  console.log(`B1b cube on loose beam: cube into beam ${f(yb + H - (yc - H))}, beam into floor ${f(H - yb)} studs, |v| cube ${f(norm(w.vel(c)))}`);
}
for (const heavy of [1, 10]) { // B1c
  const w = mk(); const cs = [];
  for (let i = 0; i < 5; i++) cs.push(w.body(w.boxShape(H, H, H), mC * (i === 4 ? heavy : 1), [0, H + 0.92 * i, 0]));
  w.step(steps(3));
  const top = w.pos(cs[4]);
  const comp = 4.6 - (top[1] + H);
  const maxTilt = Math.max(...cs.map((c) => tilt(w.quat(c))));
  console.log(`B1c stack of 5, top x${heavy}: total compression ${f(comp)} studs, top lateral ${f(Math.hypot(top[0], top[2]))}, max tilt ${f(maxTilt)} rad`);
}
process.exit(0);
