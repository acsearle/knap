// SI scale with ALL Rapier defaults including sleeping (canSleep true is Rapier's default):
// r 0.5 m cylinder on a 200x1x200 m fixed cuboid, at rest and given a slow initial roll.
// Prediction from the frozen-point mechanism: v* = r*(pi/180)/dt = 0.524 m/s.
// usage: node sisleep.mjs
import { init, run, SI } from './lib.mjs';
await init();
const f = (x) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(4));
console.log('floor | canSleep | v0 m/s | T s | |v| at end | plateau |v| | max |v| | travel m');
for (const floor of ['cuboid', 'halfspace']) for (const canSleep of [true, false]) for (const v0 of [0, 0.05, 0.2, 1.0]) {
  const { s } = run({ g: SI.g, dt: SI.dt, iters: null, r: 0.5, hh: 0.23, floor, fhx: 200, fhz: 200, x0: 3.3, z0: -100, canSleep, v0, T: 20 });
  console.log(`${floor} | ${canSleep} | ${v0} | 20 | ${f(Math.hypot(s.finalV.x, s.finalV.z))} | ${f(s.vPlateau)} | ${f(s.maxV)} | ${f(s.maxDrift)}`);
}
process.exit(0);
