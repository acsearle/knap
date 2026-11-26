// hull32 (32-gon prism hull, unbevelled caps) lying on its cap on the 9-hole flat arm (and a cuboid):
// one switch at a time. Prints outcome, sink, and the contact point count per step (histogram).
// node spikes/rapier-limits/cylhull/hull32cap.mjs
import { run } from './lib.mjs';
const KNAP = { g: 1226.25, dt: 1 / 480, iters: 30, ccdSub: 0 };
const SI = { g: 9.81, dt: 1 / 60, iters: null };
const V = [
  ['knap', KNAP], ['SI defaults', SI], ['knap g, dt 1/60', { ...KNAP, dt: 1 / 60, iters: null }], ['g 9.81, knap dt+iters', { ...KNAP, g: 9.81 }],
  ['knap, freq 300', { ...KNAP, freq: 300 }], ['knap, recycling off (hook)', { ...KNAP, hooks: true }], ['knap, prediction 0.1', { ...KNAP, pred: 0.1 }],
  ['knap, body hull32b (4-vertex caps)', { ...KNAP, body: 'hull32b' }], ['SI, body hull32b', { ...SI, body: 'hull32b' }],
];
for (const floor of ['armFlat', 'cuboid']) for (const r of [1, 2.5]) for (const [name, s] of V) {
  const res = run({ floor, body: 'hull32', r, pose: 'cap', x: 4, z: 0, T: 3, ...s, trace: 1e9 });
  const hist = {};
  for (const t of res.trace) if (res.fellAt == null || t.s < res.fellAt) hist[t.n] = (hist[t.n] ?? 0) + 1;
  console.log(`${floor} r=${r} ${name.padEnd(36)} ${res.outcome.padEnd(7)} fellAt=${res.fellAt} maxSink=${res.maxSink.toFixed(4)} pointsPerStep=${JSON.stringify(hist)}`);
}
process.exit(0);
