// Per-step trace of one rest test. node spikes/rapier-limits/cylhull/trace.mjs '<json options for lib.run>' [every=20]
import { run } from './lib.mjs';
const o = JSON.parse(process.argv[2]);
const every = +(process.argv[3] ?? 20);
const S = o.scale === 'si' ? { g: 9.81, dt: 1 / 60, iters: null } : { g: 1226.25, dt: 1 / 480, iters: 30, ccdSub: 0 };
const r = run({ ...S, T: 3, ...o, trace: 1e9 });
console.log(JSON.stringify({ outcome: r.outcome, fellAt: r.fellAt, firstZero: r.firstZero, zeroKind: r.zeroKind, diag: r.diag, maxSink: +r.maxSink.toFixed(4), final: r.final }));
for (const t of r.trace) if (t.s % every === 0 || t.s <= 3 || (r.fellAt && Math.abs(t.s - r.fellAt) < 12)) console.log(JSON.stringify(t));
process.exit(0);
