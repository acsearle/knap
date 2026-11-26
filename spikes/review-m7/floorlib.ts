// Floor-plane checks shared by spikes/review-m7/floor.test.ts and tests/review/m7-sim.review.test.ts.
import { ModelBuilder, axle, beam, buildExample, pin } from '../../src/core/examples';
import { groundLevel, makeCell, setFixRoot, setGround, setRim } from '../../src/core/model';
import type { Model } from '../../src/core/types';
import { Simulation } from '../../src/physics/sim';
import { partShapes } from '../../src/physics/shapes';

const G = 1226.25;

export function floorCases(): { label: string; m: Model }[] {
  const free = (b: ModelBuilder) => setFixRoot(setGround(b.build(), true), false);
  const out: { label: string; m: Model }[] = [];
  const add = (label: string, f: (b: ModelBuilder) => Model | void) => {
    const b = new ModelBuilder();
    const r = f(b);
    out.push({ label, m: r ?? free(b) });
  };
  add('2-pin standing (Y)', (b) => void b.add(pin([0, 0, 0], [0, 1, 0])));
  add('3-axle standing (Y)', (b) => void b.add(axle([0, 0, 0], [0, 2, 0])));
  add('5-beam lying flat (holes Y)', (b) => void b.add(beam([0, 0, 0], [4, 0, 0], 1)));
  add('5-beam on edge (holes Z)', (b) => void b.add(beam([0, 0, 0], [4, 0, 0], 2)));
  add('5-beam on end (along Y, holes Z)', (b) => void b.add(beam([0, 0, 0], [0, 4, 0], 2)));
  add('flat beam + pin poking 1 below', (b) => {
    b.add(beam([0, 0, 0], [4, 0, 0], 1));
    b.add(pin([2, -1, 0], [2, 0, 0], 1));
  });
  add('2-pin lying (X)', (b) => void b.add(pin([0, 0, 0], [1, 0, 0])));
  add('4-axle lying (X) under a beam, not mated', (b) => {
    b.add(axle([0, 0, 0], [3, 0, 0]));
    b.add(beam([0, 1, 0], [4, 1, 0], 2));
  });
  add('wheel r 1.5 axis Z', (b) => void b.add([makeCell(0, 0, 0, 'pinHole', 2, 1.5)]));
  add('wheel r 1.5 axis X', (b) => void b.add([makeCell(0, 0, 0, 'pinHole', 0, 1.5)]));
  add('wheel r 2.5 axis Y (lying)', (b) => void b.add([makeCell(0, 0, 0, 'pinHole', 1, 2.5)]));
  add('wheel r 1.5 (hub y 1) + standing pin (end 0.02 lower than the rim)', (b) => {
    b.add([makeCell(0, 1, 0, 'pinHole', 2, 1.5)]);
    b.add(pin([5, 0, 0], [5, 1, 0]));
  });
  add('wheel r 2.5 + crank hole (2,2), axis Z', (b) => void b.add([makeCell(0, 0, 0, 'pinHole', 2, 2.5), makeCell(2, 2, 0, 'pinHole', 2)]));
  add('flat beam + standing pin beside it (pin end 0.02 lower)', (b) => {
    b.add(beam([0, 0, 0], [4, 0, 0], 1));
    b.add(pin([6, 0, 0], [6, 1, 0]));
  });
  out.push({ label: 'Cart example', m: buildExample('cart') });
  out.push({ label: 'Cart example, root fixed', m: setFixRoot(buildExample('cart'), true) });
  return out.map((c) => ({ ...c, m: c.m.ground ? c.m : setGround(c.m, true) }));
}

/** Lowest ground-touching collider point relative to the physics plane (+ = floating, − = penetrating). */
export async function initialGap(m: Model, slope: number): Promise<{ gap: number; which: string; viewMinusSim: number | null }> {
  const s = await Simulation.create(m, { groundSlopeDeg: slope });
  const th = (slope * Math.PI) / 180;
  const n = [Math.sin(th), Math.cos(th), 0];
  let cx = 0;
  let cz = 0;
  let k = 0;
  for (const p of m.parts)
    for (const c of p.cells) {
      cx += c.x;
      cz += c.z;
      k++;
    }
  const p0 = [cx / k, s.groundY!, cz / k];
  const d = n[0]! * p0[0]! + n[1]! * p0[1]! + n[2]! * p0[2]!;
  const view = slope === 0 ? groundLevel(m)! + 0.04 - s.groundY! : null;
  s.dispose();
  let low = Infinity;
  let which = '';
  const dot = (q: number[]) => q[0]! * n[0]! + q[1]! * n[1]! + q[2]! * n[2]!;
  const see = (h: number, w: string) => {
    if (h < low) {
      low = h;
      which = w;
    }
  };
  for (const p of m.parts)
    for (const sh of partShapes(p, 16)) {
      if (sh.kind === 'hull') for (const q of sh.points) see(dot(q), 'part hull');
      else if (sh.kind === 'box') {
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) see(dot([sh.center[0] + sx * sh.halfExtents[0], sh.center[1] + sy * sh.halfExtents[1], sh.center[2] + sz * sh.halfExtents[2]]), 'box');
      } else {
        const na = Math.abs(n[sh.axis]!);
        see(dot(sh.center) - sh.radius * Math.sqrt(Math.max(0, 1 - na * na)) - sh.halfLength * na, 'wheel round');
        for (const q of sh.guard) see(dot(q), 'wheel guard');
      }
    }
  return { gap: low - d, which, viewMinusSim: view };
}

/** Max kinetic energy over the first 0.05 s, total weight × 0.01, and the largest COM displacement. */
export async function popEnergy(m: Model, slope: number): Promise<{ ke: number; scale: number; drop: number }> {
  const s = await Simulation.create(m, { groundSlopeDeg: slope });
  const ids = s.graph.bodies.map((b) => b.id).filter((id) => !s.graph.bodies[id]!.fixed);
  const c0 = ids.map((id) => s.massInfo(id)!.com);
  const M = ids.reduce((a, id) => a + s.massInfo(id)!.mass, 0);
  let ke = 0;
  for (let i = 0; i < 24; i++) {
    s.stepFixed(1);
    ke = Math.max(ke, s.energy().kinetic);
  }
  let drop = 0;
  ids.forEach((id, i) => {
    const c = s.massInfo(id)!.com;
    drop = Math.max(drop, Math.hypot(c[0] - c0[i]![0], c[1] - c0[i]![1], c[2] - c0[i]![2]));
  });
  s.dispose();
  return { ke, scale: M * G * 0.01, drop };
}
