// Print a regime-by-metric comparison table (markdown) from results/*.json.
//   node table.mjs [R0 R1 ...]
import fs from 'node:fs';
const regs = process.argv.slice(2).length ? process.argv.slice(2) : ['R0', 'R1', 'R2', 'R2d', 'R2d240', 'R3', 'R3n', 'Rm3', 'Rp3'];
const D = {};
for (const r of regs) { try { D[r] = JSON.parse(fs.readFileSync(new URL(`./results/${r}.json`, import.meta.url))); } catch { /* missing */ } }
const f = (x, d = 3) => (typeof x === 'boolean' ? (x ? 'yes' : 'no') : typeof x === 'string' ? x : x == null || Number.isNaN(x) ? 'n/a' : Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(1) : x.toFixed(d));
const plateau = (t) => { const v = t.trace.slice(2, 7); return Math.max(...v); };
const rows = [
  ['B1a sink (studs)', (d) => f(d.B1a.sink, 4)],
  ['B1a drift (studs/s)', (d) => f(d.B1a.drift)],
  ['B1b cube into beam', (d) => f(d.B1b.cubeIntoBeam, 4)],
  ['B1b beam into floor', (d) => f(d.B1b.beamIntoFloor, 4)],
  ['B1c 5-stack compression / stands', (d) => `${f(d.B1c.uniform.compression)} / ${f(d.B1c.uniform.stands)}`],
  ['B1c top 10x: compression / stands', (d) => `${f(d.B1c.top10x.compression)} / ${f(d.B1c.top10x.stands)}`],
  ['B2 150: deepest / rebound / side / spin', (d) => [d.B2.v150.deepest, d.B2.v150.rebound, d.B2.v150.side, d.B2.v150.spin].map((x) => f(x, 2)).join(' / ')],
  ['B2 300: deepest / rebound / side / spin', (d) => [d.B2.v300.deepest, d.B2.v300.rebound, d.B2.v300.side, d.B2.v300.spin].map((x) => f(x, 2)).join(' / ')],
  ['B3 v at 0.5/1/1.5 s (613/1226/1839)', (d) => [d.B3['v0.5'], d.B3.v1, d.B3['v1.5']].map((x) => f(x, 0)).join(' / ')],
  ['linear clamp (studs/s)', (d) => f(d.B3.linClamp, 0)],
  ['angular clamp (rad/s)', (d) => f(d.B3.angClamp, 0)],
  ['B4a centre: fell / tilt deg / contacts', (d) => `${f(d.B4a.centre.fell)} / ${f(d.B4a.centre.tilt, 1)} / ${d.B4a.centre.contacts}`],
  ['B4a 6 off-centre: fell / max tilt held', (d) => `${d.B4a.off.fell} / ${f(d.B4a.off.maxTiltDeg, 1)}`],
  ['B4a sink centre / worst held off-centre', (d) => `${f(d.B4a.centre.fell ? NaN : d.B4a.centre.sink, 4)} / ${f(d.B4a.off.fell === 6 ? NaN : d.B4a.off.maxSinkHeld, 4)}`],
  ['B4b 16-gon tilt deg / contacts', (d) => `${f(d.B4b.n16.tiltDeg, 1)} / ${d.B4b.n16.contacts}`],
  ['B4b 32-gon tilt deg / contacts', (d) => `${f(d.B4b.n32.tiltDeg, 1)} / ${d.B4b.n32.contacts}`],
  ['B5a box, rest: v end', (d) => f(d.B5a.boxRest.vEnd)],
  ['B5a box, 1 studs/s: plateau (studs/s)', (d) => f(plateau(d.B5a.boxRoll1), 2)],
  ['B5a predicted r*1deg/dt_real', (d) => f(d.B5a.predictedPlateau, 2)],
  ['B5a plane, 1 studs/s: v end', (d) => f(d.B5a.planeRoll1.vEnd, 4)],
  ['B5b box: kept % / max sink', (d) => `${f(d.B5b.box.kept, 1)} / ${f(d.B5b.box.maxSink)}`],
  ['B5b plane: kept % / max sink', (d) => `${f(d.B5b.plane.kept, 1)} / ${f(d.B5b.plane.maxSink)}`],
  ['B5c r2.5 on loose beam: sink at 0.25 s / max on beam', (d) => `${f(d.B5c.sink025, 4)} / ${f(d.B5c.maxSinkOnBeam, 4)}`],
  ['B5c rolled off the beam at (s)', (d) => (d.B5c.leftAt == null ? 'stayed' : f(d.B5c.leftAt, 2))],
  ['B6a pendulum dE % mgL (10 s) / sep', (d) => `${f(d.B6a.dE_pct, 2)} / ${f(d.B6a.worstSep)}`],
  ['B6b triple dE % (10 s) / worst sep', (d) => `${f(d.B6b.dE_pct, 2)} / ${f(d.B6b.worstSep)}`],
  ['B6b ms CPU per real s', (d) => f(d.B6b.msPerRealS, 0)],
  ['B7 dE %/s / d|L| %/s', (d) => `${f(d.B7.dE_pct_per_s)} / ${f(d.B7.dL_pct_per_s)}`],
  ['B8 (emulated) w1 at 1 s / ratio at 2 s', (d) => `${f(d.B8.phases.t1.w1, 1)} / ${f(d.B8.phases.t2.ratio)}`],
  ['B8 phase err teeth at 2 s / 5 s', (d) => `${f(d.B8.phases.t2.errTeeth, 1)} / ${f(d.B8.phases.t5.errTeeth, 1)}`],
  ['B8 KE/work at 1 s / 4 s', (d) => `${f(d.B8.phases.t1.KE_over_work)} / ${f(d.B8.phases.t4.KE_over_work)}`],
  ['B10 ms CPU per real s', (d) => f(d.B10.msPerRealS, 0)],
  ['world steps per real s', (d) => f(d.B10.stepsPerRealS, 0)],
];
const ks = Object.keys(D);
console.log('| metric (real units) | ' + ks.join(' | ') + ' |');
console.log('|---|' + ks.map(() => '---').join('|') + '|');
for (const [name, fn] of rows) console.log(`| ${name} | ` + ks.map((k) => { try { return fn(D[k]); } catch { return '-'; } }).join(' | ') + ' |');
process.exit(0);
