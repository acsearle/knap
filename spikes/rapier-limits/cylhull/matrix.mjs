// One-switch-at-a-time matrix. Each variant = knap scale baseline plus one change.
// node spikes/rapier-limits/cylhull/matrix.mjs [group=switches|bodies|si] [T=3]
import { run, floorSpan } from './lib.mjs';
const group = process.argv[2] ?? 'switches';
const T = +(process.argv[3] ?? 3);
const KNAP = { g: 1226.25, dt: 1 / 480, iters: 30, ccdSub: 0 };
const SI = { g: 9.81, dt: 1 / 60, iters: null };
const floors = ['cuboid', 'boxhull', 'armFlat', 'armEdge'];
const variants = {
  switches: [
    ['knap baseline', {}],
    ['SI all defaults', { ...SI, ccdSub: null }],
    ['knap g, dt 1/60, default iters', { dt: 1 / 60, iters: null }],
    ['SI g 9.81, knap dt+iters', { g: 9.81 }],
    ['knap, default iters (4)', { iters: null }],
    ['knap, contact_natural_frequency 300', { freq: 300 }],
    ['knap, contact_natural_frequency 120', { freq: 120 }],
    ['knap, prediction 0.1', { pred: 0.1 }],
    ['knap, prediction 0.002', { pred: 0.002 }],
    ['knap, recycling off (hook)', { hooks: true }],
    ['knap, soft CCD 1.04', { softCcd: (400 / 480) * 1.25 }],
    ['knap, friction-free initial gap 0.01', { gap: 0.01 }],
  ],
  bodies: [
    ['cyl', { body: 'cyl' }],
    ['roundcyl (border 0.02)', { body: 'roundcyl' }],
    ['hull32 (32-gon prism hull)', { body: 'hull32' }],
    ['hull32b (same, caps bevelled to 4-vertex)', { body: 'hull32b' }],
    ['ball', { body: 'ball' }],
    ['cuboid', { body: 'cuboid' }],
  ],
  si: [
    ['SI cyl', { ...SI, ccdSub: null, body: 'cyl' }],
    ['SI hull32 (bodies matrix poses)', { ...SI, ccdSub: null, body: 'hull32' }],
    ['SI hull32b', { ...SI, ccdSub: null, body: 'hull32b' }],
    ['SI recycling off (hook)', { ...SI, ccdSub: null, hooks: true }],
  ],
}[group];
const poses = group === 'switches' ? ['roll'] : ['roll', 'cap'];
for (const [name, v] of variants) {
  const line = [];
  let tot = { THROUGH: 0, OFF: 0, TIPPED: 0, 'SLID/ROLLED': 0, STAYED: 0, n: 0, zeroPen: 0 };
  for (const floor of floors) for (const pose of poses) {
    const c = { THROUGH: 0, OFF: 0, TIPPED: 0, 'SLID/ROLLED': 0, STAYED: 0, n: 0 };
    let maxV = 0;
    for (const r of [1, 2.5]) {
      // interior positions only: centre at least r_contact clear of the ends
      const [x0, x1] = floorSpan(floor);
      for (let i = 1; i <= 7; i++) for (const z of [0, 0.2]) {
        const x = +(x0 + 1 + ((x1 - x0 - 2) * (i - 1)) / 6).toFixed(3);
        const res = run({ floor, body: 'cyl', r, pose, x, z, T, ...KNAP, ...v });
        c[res.outcome]++; c.n++; tot[res.outcome]++; tot.n++;
        if (res.zeroPen) tot.zeroPen++;
      }
    }
    line.push(`${floor}/${pose}: stay ${c.STAYED}/${c.n} off ${c.OFF} roll ${c['SLID/ROLLED']} tip ${c.TIPPED} THROUGH ${c.THROUGH}`);
  }
  console.log(`${name.padEnd(38)} | ${line.join(' | ')} | runs with empty-manifold-while-overlapping: ${tot.zeroPen}`);
}
process.exit(0);
