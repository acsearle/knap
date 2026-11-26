// hull32 on its unbevelled cap on the flat arm at SI defaults, 30 s: does the sink keep growing?
// node spikes/rapier-limits/cylhull/hull32si_long.mjs
import { run } from './lib.mjs';
for (const r of [1, 2.5]) for (const T of [3, 10, 30]) {
  const res = run({ floor: 'armFlat', body: 'hull32', r, pose: 'cap', x: 4, z: 0, T, g: 9.81, dt: 1 / 60, iters: null });
  console.log(`r=${r} T=${T}s ${res.outcome} maxSink=${res.maxSink.toFixed(4)} final=${JSON.stringify(res.final)}`);
}
process.exit(0);
