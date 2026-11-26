// The wheels spike's cuboid ground geometry (spikes/wheels/lib.ts addGround 'box': half-extents
// 200 x 1 x 50, the wheel 20.3 units from one end and 379.7 from the other), rebuilt in pure
// Rapier with the travel direction mapped onto z. Does the cylinder tunnel through the TOP face,
// or roll off the near END and free-fall (which also reaches the 400 units/s speed clamp)?
// usage: node projectfloor.mjs
import { init, run } from './lib.mjs';
await init();
const f = (x) => (x == null ? '-' : Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(3));
console.log('r | softCcd | tMove | plateau|v| | max|v| | final z rel. start | tunnel t (over footprint) | off-edge t | 0-contact steps');
for (const r of [0.5, 1, 2.5]) for (const softCcd of [0, 1.04]) for (const z0s of [-179.7, 179.7]) {
  const { s } = run({ r, fhx: 50, fhy: 1, fhz: 200, x0: 0, z0: z0s, softCcd, T: 5 });
  console.log(`${r} | ${softCcd} | z0 ${z0s} | ${f(s.tFirstMove)} | ${f(s.vPlateau)} | ${f(s.maxV)} | ${f(s.final.z - z0s)} | ${f(s.tunnelT)} | ${f(s.offEdgeT)} | ${s.zeroContactSteps}`);
}
process.exit(0);
