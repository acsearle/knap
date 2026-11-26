// Step 1 + 2: native cylinder resting on a fixed cuboid / HalfSpace, knap scale and SI scale.
// usage: node repro.mjs [knap|si]
import { init, run, fmt, KNAP, SI } from './lib.mjs';
await init();
const which = process.argv[2] || 'knap';
const base = which === 'si' ? { g: SI.g, dt: SI.dt, iters: null } : { g: KNAP.g, dt: KNAP.dt, iters: KNAP.iters };
const floors = [
  ['cuboid 20x1x20', { floor: 'cuboid', fhx: 20, fhy: 1, fhz: 20 }],
  ['cuboid 200x1x50', { floor: 'cuboid', fhx: 200, fhy: 1, fhz: 50 }],
  ['cuboid 2000x1x2000', { floor: 'cuboid', fhx: 2000, fhy: 1, fhz: 2000 }],
  ['halfspace', { floor: 'halfspace' }],
];
for (const [fname, fl] of floors)
  for (const pose of ['roll', 'up'])
    for (const r of [0.5, 1, 2.5])
      for (const friction of [0.8, 0])
        for (const [oname, off] of [['centre', {}], ['off', { x0: 7.3, z0: -4.1 }], ['far', { x0: 0.9 * (fl.fhx ?? 200) }]]) {
          const { s } = run({ ...base, ...fl, pose, r, friction, ...off });
          console.log(`${which} | ${fname} | ${pose} r${r} mu${friction} ${oname} | ${fmt(s)}`);
        }
process.exit(0);
