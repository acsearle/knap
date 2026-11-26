// Prints the per-step trace (pose, velocities, energy change, manifold) for one configuration.
// usage: node trace.mjs '<json cfg>' [every=1] [maxSteps]
import { init, run } from './lib.mjs';
await init();
const cfg = JSON.parse(process.argv[2] || '{}');
const every = +(process.argv[3] || 1), maxK = +(process.argv[4] || 1e9);
const { s, trace } = run({ ...cfg, trace: true });
const f = (x) => (Math.abs(x) < 1e-12 ? '0' : x.toPrecision(4));
const v3 = (v) => `(${f(v.x)},${f(v.y)},${f(v.z)})`;
trace.forEach((r, i) => {
  if (i % every || i >= maxK) return;
  let ms = '-';
  if (r.man) ms = `lever ${r.man.lever != null ? f(r.man.lever) : '-'} n${v3(r.man.n)} pts ` + r.man.pts.map((q) => `[d ${f(q.d)} p1${v3(q.p1)} p2${v3(q.p2)} f${q.fid2}]`).join(' ');
  console.log(`k${i + 1} t${r.t.toFixed(4)} p${v3(r.p)} v${v3(r.v)} w${v3(r.w)} dE ${f(r.dE)} | ${ms}`);
});
console.log('mass', s.mass, 'y0', s.y0);
process.exit(0);
