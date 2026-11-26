// Exact disc overlap predicates (DESIGN.md §2.6), moved from spikes/wheels/disc.test.ts and
// extended: dense-sampling property tests, the coverage table of spikes/wheels/REPORT.md §5,
// symmetry and exactness at the touching distance.
import { describe, expect, it } from 'vitest';
import {
  discCellContact,
  discCells,
  discCoversCell,
  discDiscContact,
  discOverlapsCell,
  discReach,
  discsOverlap,
  planeAxes,
} from '../../src/core/disc';
import type { Axis, Vec3i } from '../../src/core/types';

const RADII = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
const O: Vec3i = [0, 0, 0];

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Is q strictly inside the (open) disc? */
function inDisc(hub: Vec3i, axis: Axis, r: number, q: number[]): boolean {
  const [u, v] = planeAxes(axis);
  return Math.abs(q[axis]! - hub[axis]) < 0.5 && (q[u]! - hub[u]) ** 2 + (q[v]! - hub[v]) ** 2 < r * r;
}

/** In-layer offset (du, dv) about axis → position. */
function at(axis: Axis, du: number, dv: number, hub: Vec3i = O): Vec3i {
  const [u, v] = planeAxes(axis);
  const p: [number, number, number] = [hub[0], hub[1], hub[2]];
  p[u] += du;
  p[v] += dv;
  return p;
}

describe('discCellContact / discOverlapsCell / discCoversCell', () => {
  it('match dense sampling of the cube for every radius, offset and axis', () => {
    const S = 60;
    for (const axis of [0, 1, 2] as Axis[])
      for (const r of RADII)
        for (let du = -5; du <= 5; du++)
          for (let dv = -5; dv <= 5; dv++) {
            const p = at(axis, du, dv);
            const [u, v] = planeAxes(axis);
            let inside = 0;
            let outside = 0;
            for (let i = 0; i <= S; i++)
              for (let j = 0; j <= S; j++) {
                const q = [0, 0, 0];
                q[u] = du - 0.5 + (i + 0.5) / (S + 1);
                q[v] = dv - 0.5 + (j + 0.5) / (S + 1);
                if (inDisc(O, axis, r, q)) inside++;
                else outside++;
              }
            const k = discCellContact(O, axis, r, p);
            const msg = `axis ${axis} r ${r} (${du},${dv}) ${k} ${inside}/${outside}`;
            if (k === 'full') expect(outside, msg).toBe(0);
            else if (k === 'partial') expect(inside > 0 && outside > 0, msg).toBe(true);
            else expect(inside, msg).toBe(0);
            expect(discOverlapsCell(O, axis, r, p)).toBe(k === 'partial' || k === 'full');
            expect(discCoversCell(O, axis, r, p)).toBe(k === 'full');
          }
  });

  it('other layers never overlap, at any radius', () => {
    for (const axis of [0, 1, 2] as Axis[])
      for (const r of RADII) {
        const p: [number, number, number] = [0, 0, 0];
        p[axis] = 1;
        expect(discCellContact(O, axis, r, p)).toBe('none');
        p[axis] = -1;
        expect(discCellContact(O, axis, r, p)).toBe('none');
      }
  });

  it('is translation invariant and exact far from the origin', () => {
    const hub: Vec3i = [1_000_003, -7_000_001, 42];
    for (const r of RADII)
      for (let du = -5; du <= 5; du++)
        for (let dv = -5; dv <= 5; dv++)
          expect(discCellContact(hub, 2, r, at(2, du, dv, hub))).toBe(discCellContact(O, 2, r, at(2, du, dv)));
  });

  // spikes/wheels/REPORT.md §5: cells of the wheel's own layer (hub excluded).
  const TABLE: Record<number, { full: number; partial: number; touch: number }> = {
    0.5: { full: 0, partial: 0, touch: 4 },
    1: { full: 0, partial: 8, touch: 0 },
    1.5: { full: 0, partial: 8, touch: 4 },
    2: { full: 4, partial: 16, touch: 0 },
    2.5: { full: 8, partial: 16, touch: 4 },
    3: { full: 20, partial: 24, touch: 0 },
    3.5: { full: 20, partial: 24, touch: 4 },
    4: { full: 36, partial: 32, touch: 0 },
  };
  for (const r of RADII) {
    it(`coverage table r ${r}: ${JSON.stringify(TABLE[r])}`, () => {
      const n = { full: 0, partial: 0, touch: 0 };
      for (let du = -6; du <= 6; du++)
        for (let dv = -6; dv <= 6; dv++) {
          if (du === 0 && dv === 0) continue;
          const k = discCellContact(O, 2, r, [du, dv, 0]);
          if (k !== 'none') n[k]++;
        }
      expect(n).toEqual(TABLE[r]);
    });
  }
  it('coverage table, named cells (one octant u ≥ v ≥ 0)', () => {
    const k = (r: number, du: number, dv: number) => discCellContact(O, 2, r, [du, dv, 0]);
    expect(k(0.5, 1, 0)).toBe('touch');
    expect([k(1, 1, 0), k(1, 1, 1)]).toEqual(['partial', 'partial']);
    expect([k(1.5, 1, 0), k(1.5, 1, 1), k(1.5, 2, 0)]).toEqual(['partial', 'partial', 'touch']);
    expect([k(2, 1, 0), k(2, 1, 1), k(2, 2, 0), k(2, 2, 1)]).toEqual(['full', 'partial', 'partial', 'partial']);
    expect([k(2.5, 1, 0), k(2.5, 1, 1), k(2.5, 2, 0), k(2.5, 2, 1), k(2.5, 2, 2), k(2.5, 3, 0)]).toEqual(['full', 'full', 'partial', 'partial', 'partial', 'touch']);
    expect([k(3, 3, 2), k(3, 3, 3), k(3, 4, 0)]).toEqual(['partial', 'none', 'none']);
    expect(k(3.5, 4, 0)).toBe('touch');
    expect([k(4, 4, 2), k(4, 4, 3)]).toEqual(['partial', 'none']);
    // the hub itself
    expect(k(0.5, 0, 0)).toBe('partial');
    for (const r of RADII.slice(1)) expect(k(r, 0, 0)).toBe('full');
  });

  it('discCells lists exactly the overlapped cells, hub included, within discReach', () => {
    for (const axis of [0, 1, 2] as Axis[])
      for (const r of RADII) {
        const hub: Vec3i = [3, -2, 5];
        const cells = discCells(hub, axis, r);
        const n = discReach(r);
        const want: string[] = [];
        for (let du = -6; du <= 6; du++)
          for (let dv = -6; dv <= 6; dv++) {
            const p = at(axis, du, dv, hub);
            if (discOverlapsCell(hub, axis, r, p)) {
              want.push(p.join(','));
              expect(Math.max(Math.abs(du), Math.abs(dv))).toBeLessThanOrEqual(n);
            }
          }
        expect(cells.map((p) => p.join(',')).sort()).toEqual(want.sort());
      }
    expect([1, 1.5, 2, 2.5, 3, 3.5, 4].map(discReach)).toEqual([1, 1, 2, 2, 3, 3, 4]);
  });

  it('rejects off-grid input', () => {
    expect(() => discCellContact(O, 2, 0.75, [1, 0, 0])).toThrow(/multiple of ½/);
    expect(() => discCellContact(O, 2, 0, [1, 0, 0])).toThrow();
    expect(() => discCellContact([0.5, 0, 0], 2, 1, [1, 0, 0])).toThrow(/integer/);
    expect(() => discCellContact(O, 2, 1, [0.5, 0, 0])).toThrow(/integers/);
    expect(() => discCellContact(O, 3 as Axis, 1, [1, 0, 0])).toThrow(/axis/);
  });
});

describe('discDiscContact / discsOverlap', () => {
  it('parallel: mesh distance is touch, closer overlaps, other layers never', () => {
    const P = (a: Vec3i, ra: number, b: Vec3i, rb: number) => discDiscContact(a, 2, ra, b, 2, rb);
    expect(P(O, 1, [2, 0, 0], 1)).toBe('touch'); // 16T–16T at 2
    expect(P(O, 1.5, [2, 0, 0], 0.5)).toBe('touch'); // 24T–8T at 2
    expect(P(O, 2.5, [3, 0, 0], 0.5)).toBe('touch'); // 40T–8T at 3
    expect(P(O, 2.5, [3, 4, 0], 2.5)).toBe('touch'); // at 5 = hypot(3, 4)
    expect(P(O, 1.5, [1, 1, 0], 0.5)).toBe('overlap');
    expect(P(O, 1.5, [2, 1, 0], 0.5)).toBe('none'); // √5 = 2.236 > 2
    expect(P(O, 1.5, [2, 0, 0], 1)).toBe('overlap');
    expect(P(O, 4, [0, 0, 1], 4)).toBe('none');
    expect(discsOverlap(O, 2, 1, [2, 0, 0], 2, 1)).toBe(false);
    expect(discsOverlap(O, 2, 1.5, [2, 0, 0], 2, 1)).toBe(true);
  });

  it('perpendicular known cases', () => {
    // r 1 about Z at the origin and r 1 about X at (0, 0, 1): (0, 0, 0.4) is in both
    expect(discDiscContact(O, 2, 1, [0, 0, 1], 0, 1)).toBe('overlap');
    expect(discDiscContact(O, 2, 1, [0, 0, 2], 0, 1)).toBe('none');
    // bare holes (r ½) at adjacent cells with different axes only touch
    expect(discDiscContact(O, 2, 0.5, [1, 0, 0], 0, 0.5)).toBe('touch');
    expect(discDiscContact(O, 2, 0.5, [1, 1, 0], 0, 0.5)).toBe('none');
    expect(discDiscContact(O, 2, 0.5, [0, 0, 1], 0, 0.5)).toBe('touch');
    // r 1 about Z and r 1 about X side by side two apart along X: Z-disc reaches x < 1, X-disc slab is |x − 2| < ½
    expect(discDiscContact(O, 2, 1, [2, 0, 0], 0, 1)).toBe('none');
    expect(discDiscContact(O, 2, 1.5, [2, 0, 0], 0, 1)).toBe('touch'); // reaches x = 1.5 exactly
    expect(discDiscContact(O, 2, 2, [2, 0, 0], 0, 1)).toBe('overlap');
  });

  it('perpendicular: agrees with dense 3D sampling on random configurations; symmetric', () => {
    const rand = rng(12345);
    let agree = 0;
    const N = 600;
    for (let n = 0; n < N; n++) {
      const a = Math.floor(rand() * 3) as Axis;
      const b = ((a + 1 + Math.floor(rand() * 2)) % 3) as Axis;
      const r1 = RADII[Math.floor(rand() * RADII.length)]!;
      const r2 = RADII[Math.floor(rand() * RADII.length)]!;
      const c2: Vec3i = [Math.floor(rand() * 11) - 5, Math.floor(rand() * 11) - 5, Math.floor(rand() * 11) - 5];
      const ex = discDiscContact(O, a, r1, c2, b, r2);
      expect(discDiscContact(c2, b, r2, O, a, r1)).toBe(ex);
      const lo = [0, 1, 2].map((i) => Math.max(i === a ? -0.5 : -r1, c2[i]! + (i === b ? -0.5 : -r2)));
      const hi = [0, 1, 2].map((i) => Math.min(i === a ? 0.5 : r1, c2[i]! + (i === b ? 0.5 : r2)));
      let hit = false;
      if (lo.every((l, i) => l < hi[i]!)) {
        const S = 40;
        for (let i = 0; i < S && !hit; i++)
          for (let j = 0; j < S && !hit; j++)
            for (let k = 0; k < S && !hit; k++) {
              const q = [lo[0]! + ((i + 0.5) / S) * (hi[0]! - lo[0]!), lo[1]! + ((j + 0.5) / S) * (hi[1]! - lo[1]!), lo[2]! + ((k + 0.5) / S) * (hi[2]! - lo[2]!)];
              if (inDisc(O, a, r1, q) && inDisc(c2, b, r2, q)) hit = true;
            }
      }
      // sampling never finds a point the exact test calls disjoint/touching
      if (hit) expect(ex, JSON.stringify([a, r1, c2, b, r2])).toBe('overlap');
      if ((ex === 'overlap') === hit) agree++;
    }
    // sampling can miss only very thin overlaps
    expect(agree / N).toBeGreaterThan(0.99);
  });

  it('parallel: agrees with sampling (random), symmetric', () => {
    const rand = rng(777);
    for (let n = 0; n < 400; n++) {
      const a = Math.floor(rand() * 3) as Axis;
      const r1 = RADII[Math.floor(rand() * RADII.length)]!;
      const r2 = RADII[Math.floor(rand() * RADII.length)]!;
      const c2 = at(a, Math.floor(rand() * 17) - 8, Math.floor(rand() * 17) - 8);
      const ex = discDiscContact(O, a, r1, c2, a, r2);
      expect(discDiscContact(c2, a, r2, O, a, r1)).toBe(ex);
      const [u, v] = planeAxes(a);
      const d = Math.hypot(c2[u], c2[v]);
      expect(ex).toBe(d < r1 + r2 ? 'overlap' : d === r1 + r2 ? 'touch' : 'none');
    }
  });

  it('far apart is none without overflow', () => {
    expect(discDiscContact(O, 2, 4, [90_000_000, 0, 0], 0, 4)).toBe('none');
    expect(discDiscContact(O, 2, 4, [0, 0, 90_000_000], 0, 4)).toBe('none');
    expect(discDiscContact(O, 2, 4, [90_000_000, 0, 0], 2, 4)).toBe('none');
  });
});
