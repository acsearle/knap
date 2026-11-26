// Review: two loose wheels' round colliders (native cylinders) against each other — perpendicular and
// parallel. Overlap depth = deepest sample point of wheel A's round solid inside wheel B's (radial
// and axial depth, min of the two).
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder } from '../../src/core/examples';
import { makeCell, setFixRoot, setGround, validateModel } from '../../src/core/model';
import type { Axis, Cell } from '../../src/core/types';
import type { Simulation } from '../../src/physics/sim';
import { applyTransform, conj, rotate, sub } from '../../src/physics/math';
import type { Vec3 } from '../../src/physics/math';
import { LOGDIR, com, logger, make, removedCount, totalE } from './lib';

mkdirSync(LOGDIR, { recursive: true });
const log = logger('ww');
const HC = 0.46;

function samples(c: Cell): Vec3[] {
  const R = c.rim! - 0.04;
  const a = c.axis;
  const u = ((a + 1) % 3) as Axis;
  const v = ((a + 2) % 3) as Axis;
  const out: Vec3[] = [];
  for (const k of [0, 0.25, 0.5, 0.75, 0.9, 1])
    for (let i = 0; i < 48; i++)
      for (const s of [-HC, -HC / 2, 0, HC / 2, HC]) {
        const p: Vec3 = [c.x, c.y, c.z];
        p[u] += k * R * Math.cos((i / 48) * 2 * Math.PI);
        p[v] += k * R * Math.sin((i / 48) * 2 * Math.PI);
        p[a] += s;
        out.push(p);
      }
  return out;
}
function overlap(s: Simulation, ba: number, A: Vec3[], bb: number, cb: Cell): number {
  const ta = s.bodyTransform(ba)!;
  const tb = s.bodyTransform(bb)!;
  const R = cb.rim! - 0.04;
  let d = -Infinity;
  for (const q of A) {
    const w = applyTransform(ta, q);
    const e = rotate(conj(tb.q), sub(w, tb.p)); // in B's edit frame
    const rel: Vec3 = [e[0] - cb.x, e[1] - cb.y, e[2] - cb.z];
    const ax = Math.abs(rel[cb.axis]);
    let rad2 = 0;
    for (let k = 0; k < 3; k++) if (k !== cb.axis) rad2 += rel[k] ** 2;
    d = Math.max(d, Math.min(HC - ax, R - Math.sqrt(rad2)));
  }
  return d;
}

it('perpendicular and parallel wheel pairs', async () => {
  const R = (c: Cell) => c.rim! - 0.04;
  const spin = (c: Cell, v: Vec3): Vec3 => (c.axis === 2 ? [0, 0, -v[0] / R(c)] : c.axis === 0 ? [v[2] / R(c), 0, 0] : [0, 0, 0]);
  const cases: [string, Cell, Cell, Vec3, Vec3][] = [];
  for (const r of [1.5, 2, 3])
    for (const v of [5, 20, 60]) {
      cases.push([`perp crossing r ${r} v ${v} (both rolling)`, makeCell(-8, 0, 0, 'pinHole', 2, r), makeCell(0, 0, -8, 'pinHole', 0, r), [v, 0, 0], [0, 0, v]]);
      cases.push([`perp: r ${r} rolling into a resting perpendicular wheel v ${v}`, makeCell(-8, 0, 0, 'pinHole', 2, r), makeCell(0, 0, 0, 'pinHole', 0, r), [v, 0, 0], [0, 0, 0]]);
      cases.push([`perp: r ${r} rolling into the face of a resting perpendicular wheel v ${v}`, makeCell(0, 0, -8, 'pinHole', 0, r), makeCell(0, 0, 0, 'pinHole', 2, r), [0, 0, v], [0, 0, 0]]);
      cases.push([`parallel offset half a layer? same layer head-on r ${r} v ${v}`, makeCell(-8, 0, 0, 'pinHole', 2, r), makeCell(8, 0, 0, 'pinHole', 2, r), [v, 0, 0], [-v, 0, 0]]);
      cases.push([`parallel adjacent layers (z 0 / z 1) r ${r} v ${v}`, makeCell(-8, 0, 0, 'pinHole', 2, r), makeCell(8, 0, 1, 'pinHole', 2, r), [v, 0, 0], [-v, 0, 0]]);
    }
  for (const [name, a, b, va, vb] of cases) {
    const mb = new ModelBuilder();
    const ia = mb.add([a]);
    const ib = mb.add([b]);
    const m = setFixRoot(setGround(mb.build(), true), false);
    if (validateModel(m).length) { log('INVALID', name); continue; }
    const s = await make(m);
    const ba = s.bodyOf(ia)!;
    const bb = s.bodyOf(ib)!;
    s.setBodyVelocity(ba, va, spin(a, va));
    s.setBodyVelocity(bb, vb, spin(b, vb));
    const A = samples(a);
    const B = samples(b);
    const e0 = totalE(s);
    let eMax = e0;
    let worst = -Infinity;
    let worstT = 0;
    let endOv = 0;
    const t0 = performance.now();
    for (let i = 0; i < 480 * 3; i++) {
      s.stepFixed(1);
      eMax = Math.max(eMax, totalE(s));
      if (i % 4 === 0 || i > 480 * 3 - 2) {
        const o = Math.max(overlap(s, ba, A, bb, b), overlap(s, bb, B, ba, a));
        if (o > worst) { worst = o; worstT = s.time; }
        endOv = o;
      }
    }
    const ms = (performance.now() - t0) / 3;
    const flag = worst > 0.1 ? ' <<<' : '';
    log(`${name}: worst overlap ${worst.toFixed(3)} at t ${worstT.toFixed(3)}, overlap at 3 s ${endOv.toFixed(3)}, E rise ${(eMax - e0).toExponential(2)}, removed ${removedCount(s)}, ${ms.toFixed(0)} ms/sim s, ends a ${JSON.stringify(com(s, ba).map((x) => +x.toFixed(2)))} b ${JSON.stringify(com(s, bb).map((x) => +x.toFixed(2)))}${flag}`);
    s.dispose();
  }
}, 3600_000);
