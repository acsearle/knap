// Step 3: switch ONE thing at a time from a base configuration; each variant runs at several
// placements on the floor. usage: node switches.mjs [knap|si] [filter-substring]
import { init, run, KNAP, SI } from './lib.mjs';
await init();
const scale = process.argv[2] || 'knap', filt = process.argv[3] || '';
const base = scale === 'si'
  ? { g: SI.g, dt: SI.dt, iters: null, r: 0.5, hh: 0.23 }   // SI: 0.5 m radius, all Rapier defaults
  : { g: KNAP.g, dt: KNAP.dt, iters: KNAP.iters, r: 1 };
Object.assign(base, { floor: 'cuboid', fhx: 20, fhy: 1, fhz: 20, pose: 'roll', friction: 0.8, T: 5 });
const places = [[0, 0], [3.3, 0], [7.1, -2.2], [-5.4, 4.7], [11.9, 1.3], [-13.7, -6.1]];
const V = [
  ['base', {}],
  ['g 9.81', { g: 9.81 }], ['g 1226.25', { g: 1226.25 }],
  ['dt 1/60', { dt: 1 / 60 }], ['dt 1/240', { dt: 1 / 240 }], ['dt 1/480', { dt: 1 / 480 }], ['dt 1/960', { dt: 1 / 960 }],
  ['iters 4', { iters: 4 }], ['iters 8', { iters: 8 }], ['iters 30', { iters: 30 }], ['iters 100', { iters: 100 }],
  ['nf 30', { nf: 30 }], ['nf 120', { nf: 120 }], ['nf 300', { nf: 300 }], ['nf 1000', { nf: 1000 }],
  ['dynfloor', { floorDynamic: true }],
  ['dynfloor nf 120', { floorDynamic: true, nf: 120 }], ['dynfloor nf 300', { floorDynamic: true, nf: 300 }], ['dynfloor nf 1000', { floorDynamic: true, nf: 1000 }],
  ['pred 0.002', { pred: 0.002 }], ['pred 0.1', { pred: 0.1 }],
  ['err 0.001', { err: 0.001 }], ['err 0.02', { err: 0.02 }],
  ['lengthUnit 0.1', { lengthUnit: 0.1 }], ['lengthUnit 10', { lengthUnit: 10 }],
  ['softCcd 1.04', { softCcd: 1.04 }], ['hard ccd substeps 1', { ccdSubsteps: 1 }],
  ['canSleep', { canSleep: true }],
  ['noRecycle (hooks)', { noRecycle: true }],
  ['friction 0', { friction: 0 }],
  ['floor hull', { floor: 'hull' }], ['floor halfspace', { floor: 'halfspace' }],
  ['prism32', { shape: 'prism32' }], ['prism64', { shape: 'prism64' }], ['ball', { shape: 'ball' }], ['capsule', { shape: 'capsule' }],
  ['floor 1.5x1x1.5', { fhx: 1.5, fhz: 1.5 }], ['floor 3x1x3', { fhx: 3, fhz: 3 }], ['floor 5x1x5', { fhx: 5, fhz: 5 }],
  ['floor 10x1x10', { fhx: 10, fhz: 10 }], ['floor 20x0.1x20', { fhy: 0.1 }], ['floor 200x1x200', { fhx: 200, fhz: 200 }],
  ['floor 2000x1x2000', { fhx: 2000, fhz: 2000 }],
];
const f = (x, d = 3) => (x == null ? '-' : Math.abs(x) >= 1e3 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(1) : x.toFixed(d));
console.log(`scale ${scale}; base ${JSON.stringify(base)}; ${places.length} placements (pts kept inside floor)`);
console.log('variant | runaway(drift>0.5r) | max|v| med/max | max drift | max |lever1| | max |lever| slow | max normal tilt slow (deg) | min dist | 0-contact steps');
for (const [name, v] of V) {
  if (filt && !name.includes(filt)) continue;
  const cfg = { ...base, ...v };
  const res = [];
  for (const [x, z] of places) {
    const lim = Math.max(0, Math.min(cfg.fhx, cfg.fhz) - 1.2 * cfg.r);
    const k = Math.min(1, lim / Math.max(1e-9, Math.hypot(x, z)));
    res.push(run({ ...cfg, x0: x * k, z0: z * k }).s);
  }
  const vs = res.map((s) => s.maxV).sort((a, b) => a - b);
  const runaway = res.filter((s) => s.maxDrift > 0.5 * cfg.r).length;
  console.log(`${name} | ${runaway}/${res.length} | ${f(vs[vs.length >> 1])}/${f(vs[vs.length - 1])} | ${f(Math.max(...res.map((s) => s.maxDrift)))} | ` +
    `${f(Math.max(...res.map((s) => Math.abs(s.lever1 ?? 0))), 5)} | ${f(Math.max(...res.map((s) => s.maxLeverSlow)), 5)} | ` +
    `${f(Math.max(...res.map((s) => s.maxTiltSlow)), 3)} | ${f(Math.min(...res.map((s) => s.minDist)), 4)} | ${res.map((s) => s.zeroContactSteps).join(',')}`);
}
process.exit(0);
