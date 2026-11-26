// Rest sweep: a dynamic body placed touching each floor at many positions; outcome after T s.
// node spikes/rapier-limits/cylhull/sweep.mjs [scale=knap|si] [body=cyl] [floors=a,b] [r=1,2.5] [poses=roll,cap] [extra json]
import { run, floorSpan, RAPIER } from './lib.mjs';
const [scale = 'knap', body = 'cyl', floorsArg, rArg, posesArg, extraArg] = process.argv.slice(2);
const floors = (floorsArg ?? 'cuboid,boxhull,armFlat,armFlat0,armEdge,armEdge0,barrelFlat,barrelFlat0,barrelEdge,barrelEdge0').split(',');
const radii = (rArg ?? '1,2.5').split(',').map(Number);
const poses = (posesArg ?? 'roll,cap').split(',');
const extra = extraArg ? JSON.parse(extraArg) : {};
const S = scale === 'si' ? { g: 9.81, dt: 1 / 60, iters: null } : { g: 1226.25, dt: 1 / 480, iters: 30, ccdSub: 0 };
const T = extra.T ?? 3;
console.log(`rapier ${RAPIER.version()} scale=${scale} body=${body} ${JSON.stringify(extra)}`);
let tot = { n: 0, THROUGH: 0, OFF: 0, TIPPED: 0, 'SLID/ROLLED': 0, STAYED: 0, zero: 0 };
for (const floor of floors) for (const r of radii) for (const pose of poses) {
  const [x0, x1] = floorSpan(floor);
  const xs = [];
  for (let i = 0; i <= 12; i++) xs.push(+(x0 + ((x1 - x0) * i) / 12).toFixed(3));
  const zs = floor.startsWith('barrel') || floor === 'ngon0' ? [-0.3, 0, 0.3] : [0, 0.2];
  const cells = [];
  let counts = { THROUGH: 0, OFF: 0, TIPPED: 0, 'SLID/ROLLED': 0, STAYED: 0 }, zero = 0, kinds = {}, zpen = 0, zover = 0, zpenEx = null, zoverEx = null, sinks = [];
  for (const x of xs) for (const z of zs) {
    const r_ = run({ floor, body, r, pose, x, z, T, ...S, ...extra });
    counts[r_.outcome]++;
    tot[r_.outcome]++; tot.n++;
    if (r_.firstZero != null) { zero++; tot.zero++; kinds[r_.zeroKind.split('(')[0]] = (kinds[r_.zeroKind.split('(')[0]] ?? 0) + 1; }
    if (r_.zeroPen) { zpen++; tot.zeroPen = (tot.zeroPen ?? 0) + 1; zpenEx ??= { x0: x, z0: z, ...r_.firstZeroPen }; }
    if (r_.zeroOver) { zover++; tot.zeroOver = (tot.zeroOver ?? 0) + 1; zoverEx ??= { x0: x, z0: z, ...r_.firstZeroOver }; }
    if (r_.outcome === 'STAYED') sinks.push(r_.maxSink / (extra.k ?? 1));
    cells.push(`${x}/${z}:${r_.outcome[0]}${r_.outcome==='THROUGH'?'!':''}${r_.firstZero != null ? '0@' + r_.firstZero : ''}`);
    if (extra.verbose && (r_.outcome === 'THROUGH' || r_.firstZero != null)) console.log('   ', floor, r, pose, x, z, r_.outcome, 'fellAt', r_.fellAt, 'fellXZ', r_.fellXZ, 'firstZero', r_.firstZero, r_.zeroKind, JSON.stringify(r_.diag), 'maxSink', r_.maxSink.toFixed(4));
  }
  console.log(`${floor.padEnd(12)} r=${r} ${pose.padEnd(4)} n=${xs.length * zs.length} THROUGH=${counts.THROUGH} off=${counts.OFF} tipped=${counts.TIPPED} slid=${counts['SLID/ROLLED']} stayed=${counts.STAYED} runsWithZeroWhilePenetrating=${zpen} runsWithZeroWhileOverFloor=${zover} maxSinkOfStayed=${sinks.length ? Math.max(...sinks).toFixed(4) : '-'}${zpenEx ? ' exPen=' + JSON.stringify(zpenEx) : ''}${zoverEx ? ' exOver=' + JSON.stringify(zoverEx) : ''}`);
  if (extra.cells) console.log('   ', cells.join(' '));
}
console.log('TOTAL', JSON.stringify(tot));
process.exit(0);
