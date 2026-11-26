// Review sweep: wheels on the floor — rolling loss, incline, spun in place, tipping over, two on an
// axle, wheel–wheel contact.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder, axle } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, setRim, validateModel } from '../../src/core/model';
import type { Axis, Cell } from '../../src/core/types';
import type { Vec3 } from '../../src/physics/math';
import { G } from '../../src/physics/sim';
import { LOGDIR, Probe, com, logger, make, removedCount, totalE } from './lib';
import { looseWheel } from '../../tests/physics/wheelModels';

mkdirSync(LOGDIR, { recursive: true });
const log = logger('floor');

it('rolling at 40 units/s over 160 units, r 1 … 4', async () => {
  for (const r of [1, 1.5, 2, 2.5, 3, 4]) {
    const s = await make(looseWheel(r));
    const R = r - 0.04;
    s.setBodyVelocity(0, [40, 0, 0], [0, 0, -40 / R]);
    const x0 = com(s, 0)[0];
    let vmin = Infinity;
    let vmax = 0;
    let ymax = -Infinity;
    const y0 = com(s, 0)[1];
    while (com(s, 0)[0] - x0 < 160) {
      s.stepFixed(24);
      const v = s.bodyVelocity(0)!.v[0];
      vmin = Math.min(vmin, v);
      vmax = Math.max(vmax, v);
      ymax = Math.max(ymax, com(s, 0)[1] - y0);
      if (s.time > 10) break;
    }
    const w = s.bodyVelocity(0)!;
    log(`ROLL r ${r}: speed ${vmin.toFixed(3)}..${vmax.toFixed(3)} (${(((vmin - 40) / 40) * 100).toFixed(2)} % .. ${(((vmax - 40) / 40) * 100).toFixed(2)} %), hop ${ymax.toExponential(2)}, lateral vz ${w.v[2].toExponential(2)}, slip ${(w.v[0] + w.w[2] * R).toExponential(2)}, t ${s.time.toFixed(2)}`);
    s.dispose();
  }
}, 1800000);

it('incline 5°, 15°, 25°: acceleration vs g sinθ/(1 + I/(m R²))', async () => {
  for (const th of [5, 15, 25]) for (const r of [1, 1.5, 2.5, 4]) {
    const s = await make(looseWheel(r), { groundSlopeDeg: th });
    const mi = s.massInfo(0)!;
    const I = mi.inertia[8]!;
    const R = r - 0.04;
    const a0 = (G * Math.sin((th * Math.PI) / 180)) / (1 + I / (mi.mass * R * R));
    const ts: number[] = [];
    const xs: number[] = [];
    const n = [Math.sin((th * Math.PI) / 180), Math.cos((th * Math.PI) / 180)];
    const along = (c: Vec3) => c[0] * n[1] - c[1] * n[0];
    const c0 = along(com(s, 0));
    for (let i = 0; i < 480; i++) {
      s.stepFixed(1);
      if (i > 48) {
        ts.push(s.time);
        xs.push(along(com(s, 0)) - c0);
      }
    }
    // fit x = x0 + v0 t + ½ a t²
    const N = ts.length;
    let A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const bb = [0, 0, 0];
    for (let i = 0; i < N; i++) {
      const f = [1, ts[i]!, ts[i]! * ts[i]! / 2];
      for (let p = 0; p < 3; p++) {
        bb[p] += f[p]! * xs[i]!;
        for (let q = 0; q < 3; q++) A[p]![q] += f[p]! * f[q]!;
      }
    }
    // solve 3x3
    const M = A.map((row, i) => [...row, bb[i]!]);
    for (let i = 0; i < 3; i++) {
      for (let k = i + 1; k < 3; k++) {
        const f = M[k]![i]! / M[i]![i]!;
        for (let j = i; j < 4; j++) M[k]![j]! -= f * M[i]![j]!;
      }
    }
    const x = [0, 0, 0];
    for (let i = 2; i >= 0; i--) {
      let sum = M[i]![3]!;
      for (let j = i + 1; j < 3; j++) sum -= M[i]![j]! * x[j]!;
      x[i] = sum / M[i]![i]!;
    }
    const w = s.bodyVelocity(0)!;
    const slip = Math.hypot(w.v[0], w.v[1]) + w.w[2] * R;
    log(`INCLINE ${th}° r ${r}: a ${x[2]!.toFixed(2)} vs ${a0.toFixed(2)} (${(((x[2]! - a0) / a0) * 100).toFixed(2)} %) slip at 1 s ${slip.toExponential(2)} I/(mR²) ${(I / (mi.mass * R * R)).toFixed(4)} μ needed ${(Math.tan((th * Math.PI) / 180) / (1 + (mi.mass * R * R) / I)).toFixed(3)}`);
    s.dispose();
  }
}, 1800000);

it('spun in place, tipping over, two on one axle', async () => {
  // spun about its axis at 60 rad/s with no translation: skids, then rolls at v = ω R I/(I + m R²)
  for (const r of [1, 2.5, 4]) {
    const s = await make(looseWheel(r));
    const R = r - 0.04;
    const mi = s.massInfo(0)!;
    const I = mi.inertia[8]!;
    s.setBodyVelocity(0, [0, 0, 0], [0, 0, -60]);
    const P = new Probe(s, looseWheel(r));
    const e0 = totalE(s);
    let ymax = -Infinity;
    let eMax = -Infinity;
    const y0 = com(s, 0)[1];
    for (let i = 0; i < 480 * 3; i++) {
      s.stepFixed(1);
      ymax = Math.max(ymax, com(s, 0)[1] - y0);
      eMax = Math.max(eMax, totalE(s));
    }
    const v = s.bodyVelocity(0)!;
    const want = (60 * R * I) / (I + mi.mass * R * R);
    log(`SPIN r ${r}: final v ${v.v[0].toFixed(3)} want ${want.toFixed(3)} (${(((v.v[0] - want) / want) * 100).toFixed(2)} %), rolling slip ${(v.v[0] + v.w[2] * R).toExponential(2)}, hop ${ymax.toExponential(2)}, E rise ${(eMax - e0).toExponential(2)} (E0 ${e0.toFixed(1)}), low ${P.low(0) - s.groundY!}`);
    s.dispose();
  }
  // upright wheel nudged to tip over (about the x axis for a wheel with axis Z): falls flat, sinks how far?
  for (const r of [1, 1.5, 2.5, 4]) for (const nudge of [0.5, 3]) {
    const m = looseWheel(r);
    const s = await make(m);
    s.setBodyVelocity(0, [0, 0, 0], [nudge, 0, 0]);
    const P = new Probe(s, m);
    const gy = s.groundY!;
    let deep = 0;
    for (let i = 0; i < 480 * 6; i++) {
      s.stepFixed(1);
      deep = Math.max(deep, gy - P.low(0));
    }
    const q = s.bodyTransform(0)!.q;
    const c = com(s, 0);
    const v = s.bodyVelocity(0)!;
    log(`TIP r ${r} nudge ${nudge}: deepest ${deep.toFixed(4)} end sink ${(gy - P.low(0)).toFixed(4)} hub y ${c[1].toFixed(4)} (flat would be ${(gy + 0.46).toFixed(4)}) |v| ${Math.hypot(...v.v).toExponential(2)} |w| ${Math.hypot(...v.w).toExponential(2)} q ${q.map((x) => x.toFixed(3)).join(',')}`);
    s.dispose();
  }
  // two r 2 wheels (axle holes) welded on one 5-axle: one body; rest and roll
  {
    const b = new ModelBuilder();
    const ax = b.add(axle([0, 0, -2], [0, 0, 2]));
    const w1 = b.add([makeCell(0, 0, -2, 'axleHole', 2)]);
    const w2 = b.add([makeCell(0, 0, 2, 'axleHole', 2)]);
    let m = setRim(setRim(b.root(ax).build(), w1, [0, 0, -2], 2), w2, [0, 0, 2], 2);
    m = setFixRoot(setGround(m, true), false);
    const s = await make(m);
    const nb = s.graph.bodies.length;
    s.setBodyVelocity(0, [40, 0, 0], [0, 0, -40 / 1.96]);
    let vmin = Infinity;
    let vzmax = 0;
    for (let i = 0; i < 480 * 4; i++) {
      s.stepFixed(1);
      const v = s.bodyVelocity(0)!.v;
      vmin = Math.min(vmin, v[0]);
      vzmax = Math.max(vzmax, Math.abs(v[2]));
    }
    log(`AXLE PAIR: bodies ${nb} vmin ${vmin.toFixed(3)} max |vz| ${vzmax.toExponential(2)} z ${com(s, 0)[2].toExponential(2)}`);
    s.dispose();
  }
}, 1800000);

it('wheel–wheel contact: coplanar head-on, offset, perpendicular crossing, stacked', async () => {
  const cases: [string, Cell[], Cell[], Vec3, Vec3][] = [
    ['coplanar head-on r2 vs r2', [makeCell(-6, 0, 0, 'pinHole', 2, 2)], [makeCell(6, 0, 0, 'pinHole', 2, 2)], [20, 0, 0], [-20, 0, 0]],
    ['coplanar r1 into resting r4', [makeCell(-8, -3, 0, 'pinHole', 2, 1)], [makeCell(6, 0, 0, 'pinHole', 2, 4)], [40, 0, 0], [0, 0, 0]],
    ['half-overlap layers (z 0 vs z 0) r2.5 vs r1.5 head-on fast', [makeCell(-8, 0, 0, 'pinHole', 2, 2.5)], [makeCell(8, -1, 0, 'pinHole', 2, 1.5)], [60, 0, 0], [-60, 0, 0]],
    ['perpendicular crossing r2 (axis Z, rolling X) vs r2 (axis X, rolling Z)', [makeCell(-8, 0, 0, 'pinHole', 2, 2)], [makeCell(0, 0, -8, 'pinHole', 0, 2)], [20, 0, 0], [0, 0, 20]],
    ['wheel dropped onto a resting wheel (both upright, parallel)', [makeCell(0, 0, 0, 'pinHole', 2, 2)], [makeCell(0, 6, 0, 'pinHole', 2, 2)], [0, 0, 0], [0, 0, 0]],
    ['wheel dropped flat onto an upright wheel', [makeCell(0, 0, 0, 'pinHole', 2, 2)], [makeCell(0, 6, 0, 'pinHole', 1, 3)], [0, 0, 0], [0, 0, 0]],
  ];
  for (const [name, a, bcells, va, vb] of cases) {
    const b = new ModelBuilder();
    const ia = b.add(a);
    const ib = b.add(bcells);
    const m = setFixRoot(setGround(b.build(), true), false);
    if (validateModel(m).length) throw new Error(name + JSON.stringify(validateModel(m)));
    const s = await make(m);
    const P = new Probe(s, m);
    const ba = s.bodyOf(ia)!;
    const bbid = s.bodyOf(ib)!;
    const R = (c: Cell) => c.rim! - 0.04;
    const spin = (c: Cell, v: Vec3): Vec3 => (c.axis === 2 ? [0, 0, -v[0] / R(c)] : c.axis === 0 ? [v[2] / R(c), 0, 0] : [0, 0, 0]);
    s.setBodyVelocity(ba, va, spin(a[0]!, va));
    s.setBodyVelocity(bbid, vb, spin(bcells[0]!, vb));
    const e0 = totalE(s);
    let eMax = e0;
    let deep = 0;
    let minGap = Infinity;
    const t0 = performance.now();
    for (let i = 0; i < 480 * 4; i++) {
      s.stepFixed(1);
      eMax = Math.max(eMax, totalE(s));
      deep = Math.max(deep, s.groundY! - P.lowAll());
      const ca = com(s, ba);
      const cb = com(s, bbid);
      minGap = Math.min(minGap, Math.hypot(ca[0] - cb[0], ca[1] - cb[1], ca[2] - cb[2]));
    }
    const ms = (performance.now() - t0) / 4;
    log(`WW ${name}: E0 ${e0.toFixed(1)} Emax-E0 ${(eMax - e0).toExponential(2)} (${(((eMax - e0) / Math.max(1, Math.abs(e0))) * 100).toFixed(2)} %), min hub distance ${minGap.toFixed(3)}, deepest into floor ${deep.toFixed(3)}, removed ${removedCount(s)}, ${ms.toFixed(0)} ms/sim s, end a ${JSON.stringify(com(s, ba).map((x) => +x.toFixed(2)))} b ${JSON.stringify(com(s, bbid).map((x) => +x.toFixed(2)))}`);
    s.dispose();
  }
}, 1800000);
