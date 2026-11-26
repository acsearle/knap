// Upright cylinder (axis vertical, resting on its cap) on a narrow beam: a fixed cuboid / convex
// hull of half-extents 3.5 x 0.46 x 0.46 (a 7-long, 0.92-wide bar), cap overhanging the sides.
// usage: node upright.mjs [knap|si]
import { init, run, KNAP, SI } from './lib.mjs';
await init();
const scale = process.argv[2] || 'knap';
const base = scale === 'si' ? { g: SI.g, dt: SI.dt, iters: null } : {};
const f = (x) => (x == null ? '-' : Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(4));
console.log('floor | r | x0 | z0 | mu | max|v| | max drift | max tilt slow | min dist | pts hist | 0-contact steps | fell (centre below top)');
for (const floor of ['cuboid', 'hull', 'halfspace'])
  for (const r of [0.5, 1, 2.5])
    for (const [x0, z0] of [[0, 0], [1.3, 0.1], [2.9, -0.2], [3.3, 0]])
      for (const friction of [0.8]) {
        const { s } = run({ ...base, floor, fhx: 3.5, fhy: 0.46, fhz: 0.46, pose: 'up', r, x0, z0, friction, T: 5 });
        const hist = Object.entries(s.nPts).map(([k, v]) => `${k}:${v}`).join(' ');
        console.log(`${floor} | ${r} | ${x0} | ${z0} | ${friction} | ${f(s.maxV)} | ${f(s.maxDrift)} | ${f(s.maxTiltSlow)} | ${f(s.minDist)} | ${hist} | ${s.zeroContactSteps} | ${s.tunnelT ?? s.offEdgeT ?? '-'}`);
      }
process.exit(0);
