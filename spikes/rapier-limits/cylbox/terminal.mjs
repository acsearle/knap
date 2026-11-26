// Prediction test for the "frozen material contact point" mechanism: a cylinder placed at rest on a
// big cuboid should accelerate until it turns more than 1 degree per step (parry's
// try_update_contacts_eps angle threshold), i.e. to v* = r * (pi/180) / dt, then stop accelerating.
// Prints the mean horizontal speed over the last quarter of the run vs that prediction.
// usage: node terminal.mjs
import { init, run } from './lib.mjs';
await init();
const f = (x) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(3));
const rows = [
  // name, cfg, T
  ['knap r1 dt1/480', { r: 1 }, 6],
  ['knap r0.5 dt1/480', { r: 0.5 }, 6],
  ['knap r2.5 dt1/480', { r: 2.5 }, 6],
  ['knap r1 dt1/240', { r: 1, dt: 1 / 240 }, 6],
  ['knap r1 dt1/960', { r: 1, dt: 1 / 960 }, 6],
  ['knap r1 dt1/60', { r: 1, dt: 1 / 60 }, 6],
  ['knap r1 g9.81 dt1/480', { r: 1, g: 9.81 }, 30],
  ['knap r1 mu0', { r: 1, friction: 0 }, 6],
  ['knap r1 halfspace', { r: 1, floor: 'halfspace' }, 6],
  ['knap r1 hull floor', { r: 1, floor: 'hull' }, 6],
  ['knap r1 capsule', { r: 1, shape: 'capsule' }, 6],
  ['SI r0.5 m, all defaults', { r: 0.5, hh: 0.23, g: 9.81, dt: 1 / 60, iters: null }, 30],
  ['SI r1 m, all defaults', { r: 1, hh: 0.46, g: 9.81, dt: 1 / 60, iters: null }, 30],
];
console.log('case | T s | predicted v* = r*(pi/180)/dt | measured plateau |v| (last 25%) | max |v| | travel');
for (const [name, cfg, T] of rows) {
  const c = { fhx: 200, fhz: 200, x0: 3.3, z0: 0, ...cfg, T };
  const { s } = run(c);
  const dt = c.dt ?? 1 / 480;
  const vstar = c.shape === 'capsule' || c.floor === 'halfspace' || c.friction === 0 ? '-' : f(c.r * (Math.PI / 180) / dt);
  console.log(`${name} | ${T} | ${vstar} | ${f(s.vPlateau)} | ${f(s.maxV)} | ${f(s.maxDrift)}`);
}
process.exit(0);
