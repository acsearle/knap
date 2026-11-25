import { describe, expect, it } from 'vitest';
import { coveredOffsets, discCell, discDisc, planeAxes, wheelBlockers } from './disc';
import type { Axis, Disc, P3 } from './disc';

const RADII = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];

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

function inDisc(d: Disc, q: number[]): boolean {
  const [u, v] = planeAxes(d.axis);
  return Math.abs(q[d.axis]! - d.c[d.axis]) < 0.5 && (q[u]! - d.c[u]) ** 2 + (q[v]! - d.c[v]) ** 2 < d.r * d.r;
}

describe('discCell', () => {
  it('matches dense sampling of the cube for every radius and offset', () => {
    const S = 80;
    for (const r of RADII)
      for (let du = -5; du <= 5; du++)
        for (let dv = -5; dv <= 5; dv++) {
          const d: Disc = { c: [0, 0, 0], axis: 2, r };
          let inside = 0;
          let outside = 0;
          for (let i = 0; i <= S; i++)
            for (let j = 0; j <= S; j++) {
              // open square: sample strictly inside
              const q = [du - 0.5 + (i + 0.5) / (S + 1), dv - 0.5 + (j + 0.5) / (S + 1), 0];
              if (inDisc(d, q)) inside++;
              else outside++;
            }
          const k = discCell(d, [du, dv, 0]);
          if (k === 'full') expect(outside, `r ${r} (${du},${dv})`).toBe(0);
          else if (k === 'partial') expect(inside > 0 && outside > 0, `r ${r} (${du},${dv}) ${inside}/${outside}`).toBe(true);
          else expect(inside, `r ${r} (${du},${dv}) ${k}`).toBe(0);
        }
  });

  it('other layers never overlap; axes X and Y use the right plane', () => {
    expect(discCell({ c: [0, 0, 0], axis: 2, r: 4 }, [0, 0, 1])).toBe('none');
    expect(discCell({ c: [0, 0, 0], axis: 0, r: 1 }, [0, 1, 0])).toBe('partial');
    expect(discCell({ c: [0, 0, 0], axis: 0, r: 1 }, [1, 0, 0])).toBe('none');
    expect(discCell({ c: [0, 0, 0], axis: 1, r: 1 }, [0, 0, 1])).toBe('partial');
    expect(discCell({ c: [0, 0, 0], axis: 1, r: 1 }, [0, 1, 0])).toBe('none');
  });

  it('known coverage of the same layer', () => {
    const t = (r: number) => {
      const c = coveredOffsets(r);
      return [c.full.length, c.partial.length];
    };
    expect(t(0.5)).toEqual([0, 0]); // bare hole: touches its 4 neighbours only
    expect(t(1)).toEqual([0, 8]);
    expect(t(1.5)).toEqual([0, 8]); // (±2,0) only touch
    expect(t(2)).toEqual([4, 16]);
    expect(t(2.5)).toEqual([8, 16]); // (±2,0),(±2,±1),(±1,±2),(±2,±2) partial
    expect(discCell({ c: [0, 0, 0], axis: 2, r: 1.5 }, [2, 0, 0])).toBe('touch');
    expect(discCell({ c: [0, 0, 0], axis: 2, r: 0.5 }, [1, 0, 0])).toBe('touch');
    expect(discCell({ c: [0, 0, 0], axis: 2, r: 0.5 }, [0, 0, 0])).toBe('partial');
    expect(discCell({ c: [0, 0, 0], axis: 2, r: 1 }, [0, 0, 0])).toBe('full');
  });

  it('rejects off-grid input', () => {
    expect(() => discCell({ c: [0, 0, 0], axis: 2, r: 0.75 }, [1, 0, 0])).toThrow();
    expect(() => discCell({ c: [0.5, 0, 0], axis: 2, r: 1 }, [1, 0, 0])).toThrow();
  });
});

describe('discDisc', () => {
  it('parallel: mesh distance is touch, closer overlaps, other layers never', () => {
    const D = (c: P3, r: number): Disc => ({ c, axis: 2, r });
    expect(discDisc(D([0, 0, 0], 1), D([2, 0, 0], 1))).toBe('touch'); // 16T–16T at 2
    expect(discDisc(D([0, 0, 0], 1.5), D([2, 0, 0], 0.5))).toBe('touch'); // 24T–8T at 2
    expect(discDisc(D([0, 0, 0], 2.5), D([3, 0, 0], 0.5))).toBe('touch'); // 40T–8T at 3
    expect(discDisc(D([0, 0, 0], 2.5), D([3, 4, 0], 2.5))).toBe('touch'); // at 5 = hypot(3, 4)
    expect(discDisc(D([0, 0, 0], 1.5), D([1, 1, 0], 0.5))).toBe('overlap');
    expect(discDisc(D([0, 0, 0], 1.5), D([2, 1, 0], 0.5))).toBe('none'); // √5 = 2.236 > 2
    expect(discDisc(D([0, 0, 0], 4), D([0, 0, 1], 4))).toBe('none');
  });

  it('perpendicular: agrees with dense 3D sampling on random configurations; symmetric', () => {
    const rand = rng(12345);
    let agree = 0;
    const N = 600;
    for (let n = 0; n < N; n++) {
      const a = Math.floor(rand() * 3) as Axis;
      const b = ((a + 1 + Math.floor(rand() * 2)) % 3) as Axis;
      const r1 = RADII[Math.floor(rand() * 5)]!;
      const r2 = RADII[Math.floor(rand() * 5)]!;
      const c2: P3 = [Math.floor(rand() * 9) - 4, Math.floor(rand() * 9) - 4, Math.floor(rand() * 9) - 4];
      const d1: Disc = { c: [0, 0, 0], axis: a, r: r1 };
      const d2: Disc = { c: c2, axis: b, r: r2 };
      const ex = discDisc(d1, d2);
      expect(discDisc(d2, d1)).toBe(ex);
      // sample the intersection of the two bounding boxes
      const lo = [0, 1, 2].map((i) => Math.max(i === a ? -0.5 : -r1, c2[i]! + (i === b ? -0.5 : -r2)));
      const hi = [0, 1, 2].map((i) => Math.min(i === a ? 0.5 : r1, c2[i]! + (i === b ? 0.5 : r2)));
      let hit = false;
      if (lo.every((l, i) => l < hi[i]!)) {
        const S = 48;
        for (let i = 0; i < S && !hit; i++)
          for (let j = 0; j < S && !hit; j++)
            for (let k = 0; k < S && !hit; k++) {
              const q = [lo[0]! + ((i + 0.5) / S) * (hi[0]! - lo[0]!), lo[1]! + ((j + 0.5) / S) * (hi[1]! - lo[1]!), lo[2]! + ((k + 0.5) / S) * (hi[2]! - lo[2]!)];
              if (inDisc(d1, q) && inDisc(d2, q)) hit = true;
            }
      }
      if (hit) expect(ex, JSON.stringify([d1, d2])).toBe('overlap');
      if (ex !== 'overlap') expect(hit).toBe(false);
      if ((ex === 'overlap') === hit) agree++;
    }
    // sampling can miss only very thin overlaps
    expect(agree / N).toBeGreaterThan(0.99);
  });

  it('perpendicular known cases', () => {
    // a disc r 1 about Z at the origin and a disc r 1 about X at (0, 0, 1): slabs |z| < ½ and |x| < ½;
    // disc 1 needs x² + y² < 1, disc 2 needs y² + (z − 1)² < 1 → e.g. (0, 0, 0.4) is in both.
    expect(discDisc({ c: [0, 0, 0], axis: 2, r: 1 }, { c: [0, 0, 1], axis: 0, r: 1 })).toBe('overlap');
    // bare holes (r ½) at adjacent cells with different axes only touch
    expect(discDisc({ c: [0, 0, 0], axis: 2, r: 0.5 }, { c: [1, 0, 0], axis: 0, r: 0.5 })).toBe('touch');
    expect(discDisc({ c: [0, 0, 0], axis: 2, r: 0.5 }, { c: [1, 1, 0], axis: 0, r: 0.5 })).toBe('none');
    expect(discDisc({ c: [0, 0, 0], axis: 2, r: 0.5 }, { c: [0, 0, 1], axis: 0, r: 0.5 })).toBe('touch');
  });
});

describe('wheelBlockers', () => {
  it('a 16T-size wheel (r 1) on a hub next to a beam is refused; its axle mate is fine', () => {
    const d: Disc = { c: [0, 0, 0], axis: 2, r: 1 };
    const beam = [1, 2, 3].map((x) => ({ x, y: 0, z: 0, male: false }));
    const axle = [-1, 0, 1].map((z) => ({ x: 0, y: 0, z, male: true }));
    expect(wheelBlockers(d, [...beam, ...axle])).toEqual([[1, 0, 0]]);
    // the same beam one layer behind is fine
    expect(wheelBlockers(d, beam.map((c) => ({ ...c, z: 1 })))).toEqual([]);
  });
});
