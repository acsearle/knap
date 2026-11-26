// Native cylinder (axis Z, rolling pose) on a single 16-gon barrel lying on edge (axis Z, parallel
// axes), placed within the barrel's top flat (|x| <= 0.09): knap vs SI scale, with/without bevel.
// node spikes/rapier-limits/cylhull/barrel_edge.mjs
import { run } from './lib.mjs';
const KNAP = { g: 1226.25, dt: 1 / 480, iters: 30, ccdSub: 0 }, SI = { g: 9.81, dt: 1 / 60, iters: null };
for (const floor of ['barrelEdge', 'barrelEdge0']) for (const r of [1, 2.5]) for (const [nm, s] of [['knap', KNAP], ['SI', SI]]) {
  const out = [];
  for (const x of [0, 0.03, 0.06, 0.09]) {
    const res = run({ floor, body: 'cyl', r, pose: 'roll', x, z: 0, T: 3, ...s });
    out.push(`x=${x}:${res.outcome}${res.offAt ? '@' + (res.offAt * s.dt).toFixed(2) + 's' : ''}`);
  }
  console.log(`${floor} r=${r} ${nm}: ${out.join(' ')}`);
}
process.exit(0);
