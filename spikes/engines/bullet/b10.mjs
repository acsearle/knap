// B10 cost: triple pendulum (rigid btHingeConstraint) + 20-cube pile on a box floor, 5 real s.
//   node b10.mjs <regime> [--dtdiv=k] [--iters=N]
import { ammo, World, RHO, G_REAL, f, regimeArg, flag, cpuTimer } from './lib.mjs';
const A = await ammo();
const reg = regimeArg(), dtdiv = flag('dtdiv', 1);
const w = new World({ regime: reg, dt: 1 / 480 / dtdiv });
w.body(w.boxShape(20, 0.5, 20), 0, [0, -0.5, 0]);
const m = RHO * 7 * 0.92 * 0.92; const links = [];
for (let i = 0; i < 3; i++) links.push(w.body(w.boxShape(3.5, 0.46, 0.46), m, [3 + 6 * i, 30, -10], [0, 0, 0, 1], { group: 4, mask: 0 }));
w.w.addConstraint(new A.btHingeConstraint(links[0], w.transform([-3, 0, 0]), false), true);
for (let i = 1; i < 3; i++) w.w.addConstraint(new A.btHingeConstraint(links[i - 1], links[i], w.transform([3, 0, 0]), w.transform([-3, 0, 0]), false), true);
const cubes = [];
for (let i = 0; i < 20; i++) cubes.push(w.body(w.boxShape(0.46, 0.46, 0.46), RHO * 0.92 ** 3, [(i % 3) * 1.1 - 1.1 + 0.05 * Math.sin(i), 0.46 + 1.0 * Math.floor(i / 3) + 0.1, ((i * 7) % 3) * 0.3], [0, 0, 0, 1]));
const E0 = w.energy(links);
const t = cpuTimer(); const SEC = 5;
w.step(SEC * 480 * dtdiv);
const ms = t();
console.log(`B10 regime=${reg} dt=1/${480 * dtdiv} iters=${w.iterations}: ${f(ms / SEC, 1)} ms CPU per real second (${f(ms / SEC / 480, 3)} ms per 1/480 s frame); pendulum dE ${f((100 * (w.energy(links) - E0)) / (m * G_REAL * 27), 1)} % after ${SEC} s; cubes resting: max |v| ${f(Math.max(...cubes.map((c) => Math.hypot(...w.vel(c)))))}`);
process.exit(0);
