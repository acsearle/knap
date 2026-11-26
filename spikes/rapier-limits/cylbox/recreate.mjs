// Switch: remove and re-create the floor collider before every step, so the pair has no persistent
// contact manifold between steps (parry's try_update_contacts_eps cannot reuse old points; the
// warm start is lost too). Compared with the same runs left alone, on a cuboid and on a halfspace.
// usage: node recreate.mjs
import { init, run, KNAP, SI } from './lib.mjs';
await init();
const f = (x) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(4));
const places = [[3.3, 0], [7.1, -2.2], [-5.4, 4.7], [11.9, 1.3]];
console.log('scale | floor | recreate | runaway (drift>0.5r) | median plateau |v| | max |v| | max drift | min dist');
for (const [sn, sc] of [['knap r1', { r: 1 }], ['SI r0.5', { r: 0.5, hh: 0.23, g: SI.g, dt: SI.dt, iters: null }]])
  for (const floor of ['cuboid', 'halfspace'])
    for (const recreateFloor of [false, true]) {
      const res = places.map(([x0, z0]) => run({ fhx: 200, fhz: 200, ...sc, floor, recreateFloor, x0, z0, T: 5 }).s);
      const pl = res.map((s) => s.vPlateau).sort((a, b) => a - b);
      console.log(`${sn} | ${floor} | ${recreateFloor} | ${res.filter((s) => s.maxDrift > 0.5 * sc.r).length}/${res.length} | ${f(pl[pl.length >> 1])} | ${f(Math.max(...res.map((s) => s.maxV)))} | ${f(Math.max(...res.map((s) => s.maxDrift)))} | ${f(Math.min(...res.map((s) => s.minDist)))}`);
    }
process.exit(0);
