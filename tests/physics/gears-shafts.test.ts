// Review m8 (editor findings, DEVIATIONS "Gears"): §2.7 rule 1 now lets another part's shaft run
// through a meshing gear and a crank hole face the partner. The simulation must run them like any
// pair: the mesh engages and holds the ratio, and the partner's gear collider never touches the
// shaft (gear collider r + 0.085 vs rod collider 0.29: ≥ 0.032 apart at mesh distance).
import { describe, expect, it } from 'vitest';
import { makeCell, validateModel } from '../../src/core/model';
import type { Cell, Model } from '../../src/core/types';
import { Simulation } from '../../src/physics/sim';
import { report } from './helpers';

const hole = (x: number, y: number, z: number, rim?: number, teeth?: boolean, kind: Cell['kind'] = 'pinHole'): Cell => makeCell(x, y, z, kind, 2, rim, teeth);
const model = (parts: Cell[][]): Model =>
  ({ version: 3, rootPartId: 1, nextPartId: parts.length + 1, ground: false, fixRoot: true, parts: parts.map((cells, i) => ({ id: i + 1, color: '#a8adb2', cells })) }) as Model;

function twist(s: Simulation, body: number): () => number {
  let prev = 0;
  let acc = 0;
  let first = true;
  return () => {
    const q = s.bodyTransform(body)!.q;
    const raw = 2 * Math.atan2(q[2], q[3]);
    if (first) acc = raw;
    else acc += raw - prev - 2 * Math.PI * Math.round((raw - prev) / (2 * Math.PI));
    first = false;
    prev = raw;
    return acc;
  };
}

/** Spin gear part a at w, run 2 s: ratio error; min contact distance of B's body with A's and with the bodies of the parts `near`. */
async function run(m: Model, a: number, b: number, ratio: number, w: number, near: number[] = []): Promise<{ err: number; depth: number | null; engaged: number }> {
  expect(validateModel(m)).toEqual([]);
  const s = await Simulation.create(m, { jointFriction: 0 });
  const A = s.bodyOf(a)!;
  const B = s.bodyOf(b)!;
  expect(A).not.toBe(B);
  s.stepFixed(1);
  s.setBodyVelocity(A, [0, 0, 0], [0, 0, w]);
  s.setBodyVelocity(B, [0, 0, 0], [0, 0, -w * ratio]);
  const ta = twist(s, A);
  const tb = twist(s, B);
  const a0 = ta();
  const b0 = tb();
  let depth: number | null = null;
  for (let i = 0; i < 960; i++) {
    s.stepFixed(1);
    ta();
    tb();
    for (const [x, y] of [[A, B], ...near.map((p) => [s.bodyOf(p)!, B] as const)]) {
      if (x === y) continue;
      const c = s.contactDepth(x!, y!);
      if (c !== null) depth = depth === null ? c : Math.min(depth, c);
    }
  }
  const err = Math.abs((tb() - b0) / (ta() - a0) / -ratio - 1);
  const engaged = s.meshStates().length;
  s.dispose();
  return { err, depth, engaged };
}

describe('shafts through meshing gears and crank holes facing the partner (review m8)', () => {
  it('an axle through an 8 driven by a 40 (1:5): engaged, ratio held, no contact with the axle', { timeout: 60000 }, async () => {
    const frame = [0, 1, 2, 3].map((x) => hole(x, 0, 0));
    const axle = [makeCell(3, 0, 0, 'axle', 2), makeCell(3, 0, 1, 'axle', 2), makeCell(3, 0, 2, 'axle', 2)];
    const m = model([frame, axle, [hole(3, 0, 1, 0.5, true, 'axleHole')], [makeCell(0, 0, 0, 'pin', 2), makeCell(0, 0, 1, 'pin', 2)], [hole(0, 0, 1, 2.5, true)]]);
    const r = await run(m, 5, 3, 5, 4, [2]);
    report(`axle through an 8 (40 → 8): ratio error ${r.err.toExponential(2)}, contact ${r.depth === null ? 'none' : r.depth.toFixed(4)}`);
    expect(r.engaged).toBe(1);
    expect(r.err).toBeLessThan(1e-4);
    expect(r.depth === null || r.depth > 0).toBe(true);
  });
  it('24 + 24 with a crank hole facing the partner and a pin of another part in it', { timeout: 60000 }, async () => {
    const frame = [0, 1, 2, 3].map((x) => hole(x, 0, -1));
    const m = model([
      frame,
      [hole(0, 0, 0), hole(0, 0, 1, 1.5, true), hole(1, 0, 1)],
      [makeCell(0, 0, -1, 'frictionPin', 2), makeCell(0, 0, 0, 'pin', 2)],
      [hole(3, 0, 0), hole(3, 0, 1, 1.5, true)],
      [makeCell(3, 0, -1, 'frictionPin', 2), makeCell(3, 0, 0, 'pin', 2)],
      [makeCell(1, 0, 1, 'pin', 2), makeCell(1, 0, 2, 'pin', 2)],
    ]);
    const r = await run(m, 2, 4, 1, 4, [6]);
    report(`24 + 24, crank pin facing the partner: ratio error ${r.err.toExponential(2)}, contact ${r.depth === null ? 'none' : r.depth.toFixed(4)}`);
    expect(r.engaged).toBe(1);
    expect(r.err).toBeLessThan(1e-4);
    expect(r.depth === null || r.depth > 0).toBe(true);
  });
});
