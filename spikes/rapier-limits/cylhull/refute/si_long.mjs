// Re-runs the original agent's interior-position rest test (their lib.run, matrix.mjs positions)
// at SI all-defaults and at g 9.81 + knap dt/iters, but for longer than 3 s.
// Gravity 125x smaller means dynamics ~sqrt(125)=11.2x slower, so 3 s at g 9.81 ~ 0.27 s at knap g.
// node spikes/rapier-limits/cylhull/refute/si_long.mjs [T=34] [variant=si|g981] [floors] [body=cyl]
import { run, floorSpan } from '../lib.mjs';
const T = +(process.argv[2] ?? 34), variant = process.argv[3] ?? 'si', body = process.argv[5] ?? 'cyl';
const V = variant === 'si' ? { g: 9.81, dt: 1 / 60, iters: null } : { g: 9.81, dt: 1 / 480, iters: 30, ccdSub: 0 };
for (const floor of (process.argv[4] ?? 'cuboid,boxhull,armFlat,armEdge').split(',')) {
  const c = { THROUGH: 0, OFF: 0, TIPPED: 0, 'SLID/ROLLED': 0, STAYED: 0, n: 0 };
  for (const r of [1, 2.5]) {
    const [x0, x1] = floorSpan(floor);
    for (let i = 1; i <= 7; i++) for (const z of [0, 0.2]) {
      const x = +(x0 + 1 + ((x1 - x0 - 2) * (i - 1)) / 6).toFixed(3);
      const res = run({ floor, body, r, pose: 'roll', x, z, T, ...V });
      c[res.outcome]++; c.n++;
    }
  }
  console.log(`${body} ${variant} T=${T}s ${floor}/roll: stay ${c.STAYED}/${c.n} off ${c.OFF} roll ${c['SLID/ROLLED']} tip ${c.TIPPED} THROUGH ${c.THROUGH}`);
}
process.exit(0);
