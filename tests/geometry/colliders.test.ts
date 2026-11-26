import { describe, expect, it } from 'vitest';
import { E_CONN, E_FREE, HC, RIM_COLL_INSET, R_COLL_ROD, partColliders } from '../../src/geometry';
import { GEAR_COLL_EXTRA } from '../../src/geometry/colliders';
import { makeCell } from '../../src/core';
import type { ColliderPrim } from '../../src/geometry';
import { CATALOG } from '../../e2e/geom-catalog';
import { c, liftarm, part } from './helpers';

const cyls = (ps: ColliderPrim[]) => ps.filter((p) => p.shape === 'cylinder');
const boxes = (ps: ColliderPrim[]) => ps.filter((p) => p.shape === 'box');

describe('partColliders', () => {
  it('single hole: one solid cylinder r=HC, half-length HC, at the local origin', () => {
    const ps = partColliders(part([c(4, 5, 6, 'pinHole', 1)]));
    expect(ps).toEqual([{ shape: 'cylinder', center: [0, 0, 0], axis: 1, radius: HC, halfLength: HC, cell: 0, male: false }]);
  });
  it('single male: cylinder r=0.29 with the visual rod extent', () => {
    const ps = partColliders(part([c(0, 0, 0, 'axle', 0)]));
    expect(ps).toEqual([{ shape: 'cylinder', center: [0, 0, 0], axis: 0, radius: R_COLL_ROD, halfLength: E_FREE, cell: 0, male: true }]);
  });
  it('2-hole liftarm: two cylinders + one box per connected lateral face', () => {
    const ps = partColliders(liftarm(2));
    expect(cyls(ps)).toHaveLength(2);
    const b = boxes(ps);
    expect(b).toHaveLength(2);
    const b0 = b.find((p) => p.cell === 0)!;
    expect(b0.center).toEqual([0.25, 0, 0]);
    expect(b0.shape === 'box' && b0.halfExtents).toEqual([0.25, HC, HC]);
    const b1 = b.find((p) => p.cell === 1)!;
    expect(b1.center).toEqual([0.75, 0, 0]);
  });
  it('tube: barrels extended to ½ on axially connected sides', () => {
    const ps = partColliders(part([c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'pinHole', 0)]));
    expect(boxes(ps)).toHaveLength(0);
    const [a, b] = cyls(ps);
    expect(a!.center[0]).toBeCloseTo((-HC + 0.5) / 2, 12);
    expect(a!.halfLength).toBeCloseTo((0.5 + HC) / 2, 12);
    expect(b!.center[0]).toBeCloseTo(1 + (-0.5 + HC) / 2, 12);
  });
  it('2-long pin: rods meet at the shared face (visual extents)', () => {
    const ps = partColliders(part([c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]));
    const [a, b] = cyls(ps);
    expect(a!.center[2] + a!.halfLength).toBeCloseTo(E_CONN, 12);
    expect(a!.center[2] - a!.halfLength).toBeCloseTo(-E_FREE, 12);
    expect(b!.center[2] + b!.halfLength).toBeCloseTo(1 + E_FREE, 12);
  });
  it('hole with perpendicular male: box toward the male, rod reaches into the boss', () => {
    const ps = partColliders(part([c(0, 0, 0, 'pinHole', 2), c(0, 1, 0, 'pin', 1)]));
    expect(boxes(ps)).toHaveLength(1);
    expect(boxes(ps)[0]!.center).toEqual([0, 0.25, 0]);
    const rod = cyls(ps).find((p) => p.male)!;
    expect(rod.center[1] - rod.halfLength).toBeCloseTo(1 - E_CONN, 12);
  });
  it('is pure, deterministic and uses part-local coordinates for every catalogue part', () => {
    for (const { part: p } of CATALOG) {
      const a = partColliders(p);
      expect(partColliders(p)).toEqual(a);
      const shifted = { ...p, cells: p.cells.map((q) => ({ ...q, x: q.x + 9, y: q.y - 4, z: q.z + 2 })) };
      expect(partColliders(shifted)).toEqual(a);
      for (const q of a) {
        expect(q.cell).toBeGreaterThanOrEqual(0);
        expect(q.cell).toBeLessThan(p.cells.length);
        for (const v of q.center) expect(Number.isFinite(v)).toBe(true);
      }
      expect(cyls(a)).toHaveLength(p.cells.length);
    }
  });
});

describe('partColliders: gears (§4.3)', () => {
  const gear = (x: number, y: number, z: number, r: number, axis: 0 | 1 | 2 = 2) => makeCell(x, y, z, 'pinHole', axis, r, true);
  it('GEAR_COLL_EXTRA = ⅛ − (½ − HC) = 0.085', () => {
    expect(GEAR_COLL_EXTRA).toBeCloseTo(0.085, 15);
  });
  it('a lone gear is one disc at the tip radius, solid, with gear.pitch; no cylinder of its own', () => {
    for (const r of [0.5, 1, 1.5, 2.5]) {
      const ps = partColliders(part([gear(3, 4, 5, r, 0)]));
      expect(ps).toEqual([{ shape: 'disc', center: [0, 0, 0], axis: 0, radius: r + GEAR_COLL_EXTRA, halfLength: HC, innerRadius: 0, cell: 0, male: false, gear: { pitch: r } }]);
    }
  });
  it('hub and web cells yield nothing in the slab; the axial neighbour keeps its barrel to the face', () => {
    // 24-tooth gear at the origin (axis Z), a web crank hole at (1, 0, 0), a hole behind the hub at (0, 0, 1).
    const ps = partColliders(part([gear(0, 0, 0, 1.5), c(1, 0, 0, 'pinHole', 2), c(0, 0, 1, 'pinHole', 2)]));
    expect(ps.filter((p) => p.cell === 1)).toEqual([]);
    const hub = ps.filter((p) => p.cell === 0);
    expect(hub).toHaveLength(1);
    expect(hub[0]!.shape).toBe('disc');
    const back = ps.filter((p) => p.cell === 2);
    expect(back).toHaveLength(1);
    const b = back[0]!;
    if (b.shape !== 'cylinder') throw new Error('expected a cylinder');
    expect(b.center[2] - b.halfLength).toBeCloseTo(0.5, 12); // reaches the shared face, not into the slab
    expect(b.center[2] + b.halfLength).toBeCloseTo(1 + HC, 12);
  });
  it('a web crank pin keeps only its rod outside the slab', () => {
    // 40-tooth gear, a 2-long pin through the web at (1, 0, 0) and (1, 0, 1)
    const ps = partColliders(part([gear(0, 0, 0, 2.5), c(1, 0, 0, 'pin', 2), c(1, 0, 1, 'pin', 2)]));
    const web = ps.filter((p) => p.cell === 1);
    expect(web).toHaveLength(2); // the free end's sliver below the slab and the piece from HC to the connected face
    const w = web[1]!;
    if (w.shape !== 'cylinder') throw new Error('expected a cylinder');
    expect(w.radius).toBe(R_COLL_ROD);
    expect(w.center[2] - w.halfLength).toBeCloseTo(HC, 12);
    expect(w.center[2] + w.halfLength).toBeCloseTo(E_CONN, 12);
    const free = partColliders(part([gear(0, 0, 0, 2.5), c(1, 0, 0, 'pin', 2)])).filter((p) => p.cell === 1);
    const ends = free.map((p) => (p.shape === 'cylinder' ? [p.center[2] - p.halfLength, p.center[2] + p.halfLength] : []));
    const want = [
      [-E_FREE, -HC],
      [HC, E_FREE],
    ];
    expect(ends).toHaveLength(2);
    ends.forEach((e, i) => e.forEach((x, j) => expect(x).toBeCloseTo(want[i]![j]!, 12)));
  });
  it('plain wheels are unchanged (r − 0.04, annulus, no gear field) and a plain rim of a gear radius has no web', () => {
    const ps = partColliders(part([makeCell(0, 0, 0, 'pinHole', 2, 1.5), c(1, 0, 0, 'pinHole', 2)]));
    const disc = ps.find((p) => p.shape === 'disc')!;
    expect({ ...disc, center: undefined }).toEqual({ shape: 'disc', center: undefined, axis: 2, radius: 1.5 - RIM_COLL_INSET, halfLength: HC, innerRadius: HC, cell: 0, male: false });
    expect(ps.filter((p) => p.cell === 1).length).toBeGreaterThan(0);
  });
});
