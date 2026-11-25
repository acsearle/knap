// Experiment 1: a single loose wheel (no joints → the simulator would run it at 30 substeps).
// Usage: node spikes/wheels/out/roll.mjs [test] [kinds] [radii] [grounds] [iters]
//   test ∈ flat | incline | rest | lie | drop | spin   (default all)
import { G, DT, addGround, addWheel, axisOf, fmt, init, makeWorld, poseHash, slope, stats, worldInertia, now } from './lib';
import type { GroundKind, WheelKind } from './lib';

const argv = process.argv.slice(2);
const TEST = argv[0] ?? 'all';
const KINDS = (argv[1] ?? 'cyl,rcyl,p16,p32,p64').split(',') as WheelKind[];
const RADII = (argv[2] ?? '0.5,1,1.5,2,2.5,3,3.5,4').split(',').map(Number);
const GROUNDS = (argv[3] ?? 'half,box,armFlat,armEdge').split(',') as GroundKind[];
const ITERS = Number(argv[4] ?? 30);

/** Engine mass m and moment of inertia I about the wheel axis (world Z at t=0). */
function massProps(rb: ReturnType<typeof addWheel>): { m: number; I: number } {
  return { m: rb.mass(), I: worldInertia(rb)[8]! };
}

function flat(kind: WheelKind, r: number, ground: GroundKind): string {
  // Roll at v0 = 40 units/s (0.32 m/s) for 4 s = 160 units (≥ 20 diameters for every r ≤ 4).
  const w = makeWorld(ITERS);
  addGround(w, ground, -20, 220);
  const v0 = 40;
  const rb = addWheel(w, kind, r, [0, r, 0]);
  rb.setLinvel({ x: v0, y: 0, z: 0 }, true);
  rb.setAngvel({ x: 0, y: 0, z: -v0 / r }, true);
  const ys: number[] = [];
  const vs: number[] = [];
  const slips: number[] = [];
  const t0 = now();
  const N = Math.round(4 / DT);
  for (let i = 0; i < N; i++) {
    w.step();
    if (i * DT < 0.25) continue;
    const t = rb.translation();
    const v = rb.linvel();
    const a = rb.angvel();
    ys.push(t.y);
    vs.push(v.x);
    slips.push(v.x + a.z * r);
  }
  const ms = now() - t0;
  const t = rb.translation();
  const ax = axisOf(rb);
  const sy = stats(ys);
  const sv = stats(vs);
  const ss = stats(slips.map(Math.abs));
  // yaw = rotation of the axis about Y (away from Z in the XZ plane); camber = axis tilt out of the horizontal plane
  const yaw = Math.atan2(ax[0], ax[2]);
  const camber = Math.asin(Math.max(-1, Math.min(1, ax[1])));
  w.free();
  return [kind, r, ground, fmt(sy.mean - r, 4), fmt(sy.max - sy.min, 4), fmt(sv.mean, 2), fmt(sv.std / sv.mean, 4), fmt(vs[vs.length - 1]! / v0, 4), fmt(ss.mean, 4), fmt(t.x, 1), fmt(t.z, 4), fmt(yaw, 5), fmt(camber, 5), fmt((ms / 4) , 1)].join('\t');
}

function incline(kind: WheelKind, r: number, ground: GroundKind, deg: number): string {
  // From rest on a slope of `deg`. Fit a over 0.1 … T s; T such that the wheel stays under ~300 units/s.
  const w = makeWorld(ITERS, deg);
  addGround(w, ground, -20, 420);
  const rb = addWheel(w, kind, r, [0, r, 0]);
  const { m, I } = massProps(rb);
  const th = (deg * Math.PI) / 180;
  const aTh = (G * Math.sin(th)) / (1 + I / (m * r * r));
  const T = Math.min(1, Math.sqrt((2 * 300) / Math.max(aTh, 1)), 300 / Math.max(aTh, 1));
  const ts: number[] = [];
  const vs: number[] = [];
  let maxSlip = 0;
  const N = Math.round(T / DT);
  for (let i = 1; i <= N; i++) {
    w.step();
    const t = i * DT;
    const v = rb.linvel();
    const a = rb.angvel();
    if (t > 0.1) {
      ts.push(t);
      vs.push(v.x);
    }
    maxSlip = Math.max(maxSlip, Math.abs(v.x + a.z * r) / Math.max(1e-9, Math.abs(v.x)));
  }
  const a = slope(ts, vs);
  const ax = axisOf(rb);
  const z = rb.translation().z;
  w.free();
  return [kind, r, ground, deg, fmt(I / (m * r * r), 4), fmt(aTh, 2), fmt(a, 2), fmt(a / aTh - 1, 4), fmt(maxSlip, 4), fmt(Math.atan2(ax[0], ax[2]), 5), fmt(z, 4), fmt(T, 3)].join('\t');
}

function rest(kind: WheelKind, r: number, ground: GroundKind): string {
  // Placed at rest (exactly touching) on flat ground: 5 s. Creep = |Δx|, sink = y − r.
  const w = makeWorld(ITERS);
  addGround(w, ground, -20, 60);
  const rb = addWheel(w, kind, r, [0.3, r, 0]);
  let maxV = 0;
  for (let i = 0; i < Math.round(5 / DT); i++) {
    w.step();
    if (i * DT > 0.5) maxV = Math.max(maxV, Math.hypot(rb.linvel().x, rb.linvel().y, rb.linvel().z));
  }
  const t = rb.translation();
  const ax = axisOf(rb);
  w.free();
  return [kind, r, ground, fmt(t.x - 0.3, 6), fmt(t.y - r, 5), fmt(t.z, 6), fmt(maxV, 5), fmt(Math.acos(Math.min(1, Math.abs(ax[2]))), 6)].join('\t');
}

function lie(kind: WheelKind, r: number, ground: GroundKind): string {
  // Lying flat on its face (axis vertical), placed touching, 3 s. Expected centre y = 0.5, tilt 0.
  const w = makeWorld(ITERS);
  addGround(w, ground, -20, 60);
  const rb = addWheel(w, kind, r, [0.25, 0.5, 0], { rot: { x: -Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 } });
  let maxV = 0;
  for (let i = 0; i < Math.round(3 / DT); i++) {
    w.step();
    if (i * DT > 0.5) maxV = Math.max(maxV, Math.hypot(rb.linvel().x, rb.linvel().y, rb.linvel().z));
  }
  const t = rb.translation();
  const ax = axisOf(rb);
  w.free();
  return [kind, r, ground, fmt(t.y - 0.5, 5), fmt(Math.acos(Math.min(1, Math.abs(ax[1]))), 6), fmt(Math.hypot(t.x - 0.25, t.z), 5), fmt(maxV, 5)].join('\t');
}

function drop(kind: WheelKind, r: number, ground: GroundKind, tiltDeg: number): string {
  // Dropped from 10 units (lowest point 10 above the ground) with its axis tilted tiltDeg from Z
  // toward Y (0 = on edge, 90 = flat). Report: deepest penetration (lowest point below the ground,
  // from the exact cylinder geometry), rebound height, final pose after 3 s.
  const w = makeWorld(ITERS);
  addGround(w, ground, -40, 80);
  const th = (tiltDeg * Math.PI) / 180;
  // rotate about X by −th: local Z → (0, sin th, cos th)
  const rotq = { x: -Math.sin(th / 2), y: 0, z: 0, w: Math.cos(th / 2) };
  const low = (ay: number) => r * Math.sqrt(Math.max(0, 1 - ay * ay)) + 0.5 * Math.abs(ay);
  const rb = addWheel(w, kind, r, [0.2, 10 + low(Math.sin(th)), 0], { rot: rotq });
  let pen = 0;
  let hit = false;
  let rebound = 0;
  let vMaxAfter = 0;
  for (let i = 0; i < Math.round(3 / DT); i++) {
    w.step();
    const t = rb.translation();
    const ax = axisOf(rb);
    const bottom = t.y - low(ax[1]);
    if (bottom < 0.05) hit = true;
    pen = Math.min(pen, bottom);
    if (hit) rebound = Math.max(rebound, bottom);
    if (i * DT > 2.5) vMaxAfter = Math.max(vMaxAfter, Math.hypot(rb.linvel().x, rb.linvel().y, rb.linvel().z));
  }
  const t = rb.translation();
  const ax = axisOf(rb);
  const ay = Math.abs(ax[1]);
  w.free();
  return [kind, r, ground, tiltDeg, fmt(pen, 4), fmt(rebound, 3), fmt(t.y - low(ay), 4), ay > 0.99 ? 'flat' : ay < 0.01 ? 'edge' : `ax_y=${fmt(ay, 3)}`, fmt(vMaxAfter, 3), fmt(Math.hypot(t.x, t.z), 2)].join('\t');
}

function spin(kind: WheelKind, r: number): string {
  // Speed / angular-speed caps: roll on a half-space at v0 = 380 units/s; Rapier clamps |ω| to
  // π/4 per step = 377 rad/s, i.e. v = 377·r. Report final v, ω·r and slip after 1 s.
  const w = makeWorld(ITERS);
  addGround(w, 'half');
  const v0 = 380;
  const rb = addWheel(w, kind, r, [0, r, 0]);
  rb.setLinvel({ x: v0, y: 0, z: 0 }, true);
  rb.setAngvel({ x: 0, y: 0, z: -v0 / r }, true);
  for (let i = 0; i < 480; i++) w.step();
  const v = rb.linvel().x;
  const om = -rb.angvel().z;
  w.free();
  return [kind, r, fmt(v, 1), fmt(om, 1), fmt(om * r, 1), fmt((v - om * r) / v, 4)].join('\t');
}

async function main(): Promise<void> {
  await init();
  const want = (t: string) => TEST === 'all' || TEST === t;
  console.log(`# iterations ${ITERS}`);
  if (want('flat')) {
    console.log('## flat: roll at v0 = 40 u/s for 4 s (stats after 0.25 s)');
    console.log('kind\tr\tground\tmean(y-r)\ty p-p\tmean vx\tstd(vx)/mean\tv_end/v0\tmean|slip|\tx_end\tz_end\tyaw\tcamber\tms/sim-s');
    for (const k of KINDS) for (const r of RADII) for (const g of GROUNDS) console.log(flat(k, r, g));
  }
  if (want('incline')) {
    console.log('## incline: from rest; analytic a = g sinθ / (1 + I/(m r²)) with the engine m, I');
    console.log('kind\tr\tground\tdeg\tI/mr²\ta_analytic\ta_meas\trel.err\tmax slip/v\tyaw\tz_end\tT');
    for (const k of KINDS) for (const r of RADII) for (const g of GROUNDS) for (const d of [5, 15, 30]) console.log(incline(k, r, g, d));
  }
  if (want('rest')) {
    console.log('## rest: placed at rest, 5 s');
    console.log('kind\tr\tground\tdx\ty-r\tdz\tmax|v| after 0.5s\taxis tilt');
    for (const k of KINDS) for (const r of RADII) for (const g of GROUNDS) console.log(rest(k, r, g));
  }
  if (want('lie')) {
    console.log('## lie flat on its face, 3 s');
    console.log('kind\tr\tground\ty-0.5\ttilt\tdrift\tmax|v| after 0.5s');
    for (const k of KINDS) for (const r of RADII) for (const g of GROUNDS) console.log(lie(k, r, g));
  }
  if (want('drop')) {
    console.log('## drop from 10 units (impact speed √(2g·10) = 156.6 u/s)');
    console.log('kind\tr\tground\ttilt°\tmin bottom\trebound\tfinal bottom\tfinal\tmax|v| 2.5-3s\tdrift');
    for (const k of KINDS) for (const r of RADII) for (const g of GROUNDS) for (const tl of [0, 30, 90]) console.log(drop(k, r, g, tl));
  }
  if (want('spin')) {
    console.log('## caps: v0 = 380 u/s on half-space, after 1 s');
    console.log('kind\tr\tv\tω\tω·r\tslip');
    for (const k of KINDS) for (const r of RADII) console.log(spin(k, r));
  }
  if (want('det')) {
    const run = () => {
      const w = makeWorld(ITERS, 15);
      addGround(w, 'armFlat', -20, 220);
      const rb = addWheel(w, 'cyl', 1.5, [0, 1.5, 0]);
      for (let i = 0; i < 960; i++) w.step();
      const h = poseHash([rb]);
      w.free();
      return h;
    };
    console.log('## determinism (cyl r 1.5 on armFlat 15°, 2 s): hashes', run(), run());
  }
}

void main();
