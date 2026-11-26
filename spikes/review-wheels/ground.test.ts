// Review sweep: every kind of part on the ground (rest 30 s, drops 2–40 units), a long beam landing
// on one end, a part wedged between a wheel and the floor.
import { it } from 'vitest';
import { mkdirSync } from 'node:fs';
import { ModelBuilder, axle, beam, beamPath, pin, frictionPin, bush } from '../../src/core/examples';
import { makeCell, setGround, validateModel } from '../../src/core/model';
import type { Cell } from '../../src/core/types';
import type { Vec3 } from '../../src/physics/math';
import { LOGDIR, Probe, com, dist, logger, make, removedCount, totalE } from './lib';

mkdirSync(LOGDIR, { recursive: true });
const log = logger('ground');

function lift(cells: Cell[], h: number): Cell[] {
  return cells.map((c) => makeCell(c.x, c.y + h, c.z, c.kind, c.axis, c.rim));
}
const SHAPES: [string, Cell[]][] = [
  ['1 pin hole Z', [makeCell(0, 0, 0, 'pinHole', 2)]],
  ['1 pin hole Y (standing)', [makeCell(0, 0, 0, 'pinHole', 1)]],
  ['bush X', bush([0, 0, 0], 0)],
  ['3-beam flat', beam([0, 0, 0], [2, 0, 0], 1)],
  ['3-beam edge', beam([0, 0, 0], [2, 0, 0], 2)],
  ['15-beam flat', beam([0, 0, 0], [14, 0, 0], 1)],
  ['15-beam edge', beam([0, 0, 0], [14, 0, 0], 2)],
  ['7-beam on end', beam([0, 0, 0], [0, 6, 0], 2)],
  ['2-pin lying', pin([0, 0, 0], [1, 0, 0])],
  ['3-friction pin lying', frictionPin([0, 0, 0], [2, 0, 0])],
  ['2-pin standing', pin([0, 0, 0], [0, 1, 0])],
  ['axle 8 lying', axle([0, 0, 0], [7, 0, 0])],
  ['axle 3 standing', axle([0, 0, 0], [0, 2, 0])],
  ['L beam flat', beamPath([[0, 0, 0], [3, 0, 0], [3, 0, 3]], 1)],
  ['L beam upright', beamPath([[0, 0, 0], [3, 0, 0], [3, 3, 0]], 2)],
  ['wheel r1 upright', [makeCell(0, 0, 0, 'pinHole', 2, 1)]],
  ['wheel r1.5 upright', [makeCell(0, 0, 0, 'pinHole', 2, 1.5)]],
  ['wheel r2.5 upright', [makeCell(0, 0, 0, 'pinHole', 0, 2.5)]],
  ['wheel r4 upright', [makeCell(0, 0, 0, 'pinHole', 2, 4)]],
  ['wheel r4 flat', [makeCell(0, 0, 0, 'pinHole', 1, 4)]],
  ['wheel r1 flat', [makeCell(0, 0, 0, 'axleHole', 1, 1)]],
  ['wheel r2 on 3-beam end (crank arm), upright', [makeCell(0, 0, 0, 'pinHole', 2, 2), makeCell(1, 0, 0, 'pinHole', 2), makeCell(2, 0, 0, 'pinHole', 2), makeCell(3, 0, 0, 'pinHole', 2)]],
];

/** Model: a far fixed root (1 cell) at y=0 sets the floor at −0.5 unless the shape is lower. The shape sits with its lowest cell at y = h. */
function model(cells: Cell[], h: number) {
  const b = new ModelBuilder();
  const root = b.add([makeCell(-40, 0, -40, 'pinHole', 2)]);
  // put the lowest nominal point of the shape at -0.5 + h
  let lo = Infinity;
  for (const c of cells) {
    lo = Math.min(lo, c.y - 0.5);
    if (c.rim !== undefined && c.axis !== 1) lo = Math.min(lo, c.y - c.rim);
  }
  const id = b.add(lift(cells, Math.floor(-0.5 + h - lo)));
  const m = setGround(b.root(root).build(), true);
  if (validateModel(m).length) throw new Error(JSON.stringify(validateModel(m)));
  return { m, id };
}

it('rest 30 s on the floor', async () => {
  for (const [name, cells] of SHAPES.filter(([n]) => !process.env.ONLY || n.includes(process.env.ONLY))) {
    const { m, id } = model(cells, 0);
    const s = await make(m);
    const b = s.bodyOf(id)!;
    const P = new Probe(s, m);
    const gy = s.groundY!;
    const c0 = com(s, b);
    const e0 = totalE(s);
    let maxPen = 0;
    let c5: Vec3 = c0;
    let eMax = -Infinity;
    for (let i = 1; i <= 480 * 30; i++) {
      s.stepFixed(1);
      if (i % 24 === 0) {
        maxPen = Math.max(maxPen, gy - P.low(b));
        eMax = Math.max(eMax, totalE(s));
      }
      if (i === 480 * 5) c5 = com(s, b);
    }
    const c30 = com(s, b);
    const q = s.bodyTransform(b)!.q;
    const tilt = 2 * Math.acos(Math.min(1, Math.abs(q[3] ?? 1)));
    log(`REST ${name}: moved0-5 ${dist(c0, c5).toExponential(2)} moved5-30 ${dist(c5, c30).toExponential(2)} rot ${tilt.toExponential(2)} rad, maxSink ${maxPen.toFixed(4)}, end sink ${(gy - P.low(b)).toFixed(4)}, Emax-E0 ${(eMax - e0).toExponential(2)} removed ${removedCount(s)} q ${JSON.stringify(q)}`);
    s.dispose();
  }
}, 3600_000);

it('drops from 2, 10, 40 units with tumble', async () => {
  const spins: Vec3[] = [[0, 0, 0], [3, 1, -2], [0.3, 6, 0.7]];
  for (const [name, cells] of SHAPES.filter(([n]) => !process.env.ONLY || n.includes(process.env.ONLY))) {
    for (const h of [2, 10, 40]) {
      for (const w of spins) {
        const { m, id } = model(cells, h);
        const s = await make(m);
        const b = s.bodyOf(id)!;
        if (w.some((x) => x)) s.setBodyVelocity(b, [0, 0, 0], w);
        const P = new Probe(s, m);
        const gy = s.groundY!;
        let maxPen = 0;
        let c1: Vec3 = com(s, b);
        const T = h >= 40 ? 6 : 5;
        for (let i = 1; i <= 480 * T; i++) {
          s.stepFixed(1);
          if (!s.hasBody(b)) break;
          maxPen = Math.max(maxPen, gy - P.low(b));
          if (i === 480 * (T - 1)) c1 = com(s, b);
        }
        const ok = s.hasBody(b);
        const end = ok ? gy - P.low(b) : NaN;
        const mv = ok ? dist(c1, com(s, b)) : NaN;
        const flag = !ok || maxPen > 0.3 || end > 0.03 || mv > 0.01 ? ' <<<' : '';
        log(`DROP ${name} h ${h} w ${JSON.stringify(w)}: deepest ${maxPen.toFixed(3)} end sink ${end.toFixed(4)} moved last s ${mv.toExponential(1)} present ${ok}${flag}`);
        s.dispose();
      }
    }
  }
}, 3600_000);

it.skipIf(!!process.env.ONLY)('a part wedged between a resting wheel and the floor; a long beam landing on one end', async () => {
  // r 2.5 wheel (loose, upright, axis Z) dropped onto a 2-pin lying across its path on the floor
  for (const [name, cells] of [
    ['pin under wheel', pin([0, 0, 0], [0, 0, 1])],
    ['axle under wheel', axle([0, 0, -2], [0, 0, 2])],
    ['beam flat under wheel', beam([0, 0, -2], [0, 0, 2], 1)],
  ] as [string, Cell[]][]) {
    const b = new ModelBuilder();
    const root = b.add([makeCell(-40, 0, -40, 'pinHole', 2)]);
    const thing = b.add(cells);
    const wheel = b.add([makeCell(0, 3.5 + 0.5 + 1, 0, 'pinHole', 2, 2.5)]); // lowest point at y = 2 (clear of the thing)
    const m = setGround(b.root(root).build(), true);
    if (validateModel(m).length) throw new Error(JSON.stringify(validateModel(m)));
    const s = await make(m);
    const P = new Probe(s, m);
    const gy = s.groundY!;
    let maxPen = 0;
    let maxPenW = 0;
    const bw = s.bodyOf(wheel)!;
    const bt = s.bodyOf(thing)!;
    for (let i = 1; i <= 480 * 10; i++) {
      s.stepFixed(1);
      maxPen = Math.max(maxPen, gy - P.low(bt));
      maxPenW = Math.max(maxPenW, gy - P.low(bw));
    }
    log(`WEDGE ${name}: thing deepest ${maxPen.toFixed(4)} wheel deepest ${maxPenW.toFixed(4)} wheel com ${JSON.stringify(com(s, bw).map((x) => +x.toFixed(3)))} thing com ${JSON.stringify(com(s, bt).map((x) => +x.toFixed(3)))} removed ${removedCount(s)} wheel v ${JSON.stringify(s.bodyVelocity(bw)!.v.map((x) => +x.toFixed(4)))}`);
    s.dispose();
  }
  // a 15-beam standing on end, slightly tilted, falls over onto the floor / dropped on end from 10
  for (const [h, w] of [[0, [0, 0, 0.3]], [10, [0, 0, 0.5]], [10, [0, 0, 0]], [40, [0.2, 0, 0.1]]] as [number, Vec3][]) {
    const { m, id } = model(beam([0, 0, 0], [0, 14, 0], 2), h);
    const s = await make(m);
    const b = s.bodyOf(id)!;
    s.setBodyVelocity(b, [0, 0, 0], w);
    const P = new Probe(s, m);
    const gy = s.groundY!;
    let maxPen = 0;
    for (let i = 1; i <= 480 * 8; i++) {
      s.stepFixed(1);
      if (!s.hasBody(b)) break;
      maxPen = Math.max(maxPen, gy - P.low(b));
    }
    const v = s.bodyVelocity(b);
    log(`LONG BEAM on end h ${h} w ${JSON.stringify(w)}: deepest ${maxPen.toFixed(4)} end sink ${(gy - P.low(b)).toFixed(4)} v ${v ? Math.hypot(...v.v).toExponential(2) : 'removed'} com ${JSON.stringify(com(s, b).map((x) => +x.toFixed(2)))}`);
    s.dispose();
  }
}, 3600_000);
