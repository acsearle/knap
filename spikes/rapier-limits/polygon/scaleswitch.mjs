// Which knap setting turns "box sinks on a single witness point" (SI) into "box falls through"?
// Box (half 0.08,0.05,0.08) at the centre of the top face of a fixed 32-gon convexHull prism
// (top at y=0, bottom at y=-0.5), switching gravity, dt and solver iterations one at a time.
// Also the control: the same with n=4 (full clipped manifold).
// Usage: node spikes/rapier-limits/polygon/scaleswitch.mjs
import { RAPIER, ngonPrism, tiltDeg } from './common.mjs';

function run({ g, dt, iters, n = 32, T = 2 }) {
  const world = new RAPIER.World({ x: 0, y: -g, z: 0 });
  world.timestep = dt;
  if (iters) world.integrationParameters.numSolverIterations = iters;
  const fb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  world.createCollider(RAPIER.ColliderDesc.convexHull(ngonPrism(n, 0.5, -0.5, 0)).setFriction(0.4), fb);
  const bb = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.0505, 0).setCanSleep(false));
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.08, 0.05, 0.08).setFriction(0.4), bb);
  let minY = Infinity;
  const steps = Math.round(T / dt);
  for (let s = 0; s < steps; s++) { world.step(); minY = Math.min(minY, bb.translation().y); }
  const y = bb.translation().y, tilt = tiltDeg(bb.rotation());
  world.free();
  return `yEnd=${y.toFixed(4)} yMin=${minY.toFixed(4)} tiltEnd=${tilt.toFixed(2)}deg ${y < -0.6 ? 'FELL THROUGH' : y < 0.03 ? 'sunk >0.02 into prism' : 'resting'}`;
}

const SIg = 9.81, Kg = 1226.25;
const cases = [
  ['SI: g 9.81, dt 1/60, default iters', { g: SIg, dt: 1 / 60 }],
  ['dt 1/480 only', { g: SIg, dt: 1 / 480 }],
  ['iters 30 only', { g: SIg, dt: 1 / 60, iters: 30 }],
  ['g 1226.25 only', { g: Kg, dt: 1 / 60 }],
  ['g 1226.25 + dt 1/480', { g: Kg, dt: 1 / 480 }],
  ['knap: g 1226.25, dt 1/480, iters 30', { g: Kg, dt: 1 / 480, iters: 30 }],
  ['SI, 20 s', { g: SIg, dt: 1 / 60, T: 20 }],
  ['control n=4, SI', { g: SIg, dt: 1 / 60, n: 4 }],
  ['control n=4, knap', { g: Kg, dt: 1 / 480, iters: 30, n: 4 }],
];
for (const [name, c] of cases) console.log(`${name.padEnd(38)} ${run(c)}`);
process.exit(0);
