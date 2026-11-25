import { describe, expect, it } from 'vitest';
import { E_CONN, E_FREE, HC, R_COLL_ROD, partColliders } from '../../src/geometry';
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
