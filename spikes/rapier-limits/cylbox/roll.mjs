// Rolling cylinder given an initial speed v0 (rolling without slip, axis along x, travel along z):
// speed after T seconds, and the mean contact lever measured along the direction of travel
// (negative = the solver's contact points trail behind the centre, which drives the roll forward).
// usage: node roll.mjs [knap|si]
import { init, run, KNAP, SI } from './lib.mjs';
await init();
const scale = process.argv[2] || 'knap';
const base = scale === 'si' ? { g: SI.g, dt: SI.dt, iters: null, r: 0.5, hh: 0.23 } : { g: KNAP.g, dt: KNAP.dt, iters: KNAP.iters, r: 1 };
const T = 1;
const f = (x) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(4));
console.log(`scale ${scale}, T ${T}s, floor 200x1x200 cuboid unless noted, start at x=3.3,z=-150`);
console.log('floor | variant | v0 | v(T) | v(T)/v0 | mean lever along travel | lateral drift');
for (const [fl, flc] of [['cuboid', { floor: 'cuboid' }], ['halfspace', { floor: 'halfspace' }]])
  for (const [vn, vc] of [['default', {}], ['noRecycle', { noRecycle: true }], ['mu 0.8 prism64', { shape: 'prism64' }]])
    for (const v0 of scale === 'si' ? [0.01, 0.1, 1] : [0.1, 1, 10, 50]) {
      const { s } = run({ ...base, ...flc, ...vc, fhx: 200, fhz: 200, x0: 3.3, z0: -150, v0, T });
      const vT = s.finalV.z;
      console.log(`${fl} | ${vn} | ${v0} | ${f(vT)} | ${f(vT / v0)} | ${s.leverAlongN ? f(s.leverAlongSum / s.leverAlongN) : '-'} | ${f(Math.abs(s.final.x - 3.3))}`);
    }
process.exit(0);
