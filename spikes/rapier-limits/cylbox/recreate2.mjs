// Per-placement detail for the recreate switch: does the drift direction follow the placement
// (fresh pairs start GJK from the floor-centre-to-body direction)?
// usage: node recreate2.mjs
import { init, run } from './lib.mjs';
await init();
const f = (x) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(4));
console.log('x0 | z0 | recreate | final z - z0 | plateau |v| | max drift');
for (const [x0, z0] of [[3.3, 0], [0, 0], [3.3, 2], [3.3, -2], [3.3, 20], [3.3, -20], [7.1, -2.2], [-5.4, 4.7], [11.9, 1.3]])
  for (const recreateFloor of [false, true]) {
    const { s } = run({ r: 1, fhx: 200, fhz: 200, x0, z0, recreateFloor, T: 5 });
    console.log(`${x0} | ${z0} | ${recreateFloor} | ${f(s.final.z - z0)} | ${f(s.vPlateau)} | ${f(s.maxDrift)}`);
  }
process.exit(0);
