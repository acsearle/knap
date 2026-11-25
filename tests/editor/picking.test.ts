import { describe, expect, it } from 'vitest';
import { addPart, emptyModel } from '../../src/core';
import type { Cell, Dir, Model } from '../../src/core';
import { R_ROD } from '../../src/geometry/dims';
import { GRID_Y, pickCell, pickGrid } from '../../src/editor';
import type { PartTransform, Ray } from '../../src/editor';
import { c, faceRay, modelOf } from './helpers';

const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));

describe('pickCell basics', () => {
  const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)]);

  it('hits every face of a cell with the right entered face, t and point', () => {
    const single = modelOf([c(5, 5, 5, 'pinHole', 1)]);
    for (let d = 0; d < 6; d++) {
      const r = faceRay([5, 5, 5], d as Dir, 0.1, -0.2, 2);
      const h = pickCell(single, r)!;
      expect(h).not.toBeNull();
      expect(h.dir).toBe(d);
      expect(h.t).toBeCloseTo(2, 9);
      expect(h.inside).toBe(false);
      expect(h.pos).toEqual([5, 5, 5]);
      close(h.point, h.localPoint);
    }
  });

  it('returns the nearest of several cubes along the ray', () => {
    const h = pickCell(m, { origin: [10, 0, 0], dir: [-1, 0, 0] })!;
    expect(h.cellIndex).toBe(1);
    expect(h.dir).toBe(0);
    expect(h.t).toBeCloseTo(8.5, 9);
    const h2 = pickCell(m, { origin: [-10, 0.2, 0.1], dir: [2, 0, 0] })!;
    expect(h2.cellIndex).toBe(0);
    expect(h2.dir).toBe(1);
    expect(h2.t).toBeCloseTo(9.5 / 2, 9); // t in units of |dir|
    close(h2.point, [-0.5, 0.2, 0.1]);
  });

  it('misses: away, parallel offset, zero or non-finite direction, empty model', () => {
    expect(pickCell(m, { origin: [10, 0, 0], dir: [1, 0, 0] })).toBeNull();
    expect(pickCell(m, { origin: [10, 2, 0], dir: [-1, 0, 0] })).toBeNull();
    expect(pickCell(m, { origin: [10, 0, 0], dir: [0, 0, 0] })).toBeNull();
    expect(pickCell(m, { origin: [10, 0, 0], dir: [NaN, 0, 0] })).toBeNull();
    expect(pickCell(emptyModel(), { origin: [10, 0, 0], dir: [-1, 0, 0] })).toBeNull();
  });

  it('oblique ray: entry face is the slab entered last', () => {
    const h = pickCell(m, { origin: [-3, 2, 0.1], dir: [1, -0.5, 0] })!;
    // reaches y = 0.5 at x = 0 (t = 3) inside the x-slab of cell 0 -> enters through +Y
    expect(h.cellIndex).toBe(0);
    expect(h.dir).toBe(2);
    expect(h.t).toBeCloseTo(3, 9);
  });

  it('grazing: touching only an edge or a corner is a miss', () => {
    const single = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    // passes exactly through the edge x = 0.5, y = 0.5
    expect(pickCell(single, { origin: [1.5, -0.5, 0], dir: [-1, 1, 0] })).toBeNull();
    // touches only the corner (0.5, 0.5, 0.5)
    expect(pickCell(single, { origin: [1.5, -0.5, -0.5], dir: [-1, 1, 1] })).toBeNull();
    // the same line shifted slightly inward clips the cube
    expect(pickCell(single, { origin: [1.45, -0.5, -0.5], dir: [-1, 1, 1] })).not.toBeNull();
  });

  it('grazing: a ray lying in a face plane counts as inside, ties go to the lower part id', () => {
    // two parts stacked: y = 0 and y = 1; ray along the shared plane y = 0.5
    const mm = modelOf([c(0, 1, 0, 'pinHole', 2)], [c(0, 0, 0, 'pinHole', 2)]);
    const h = pickCell(mm, { origin: [-5, 0.5, 0], dir: [1, 0, 0] })!;
    expect(h.partId).toBe(1);
    expect(h.dir).toBe(1);
    expect(h.t).toBeCloseTo(4.5, 9);
    // and along the outer top face y = 1.5 of part 1
    expect(pickCell(mm, { origin: [-5, 1.5, 0], dir: [1, 0, 0] })!.partId).toBe(1);
  });

  it('ray starting inside a cube: t = 0, inside, entry face of the line', () => {
    const single = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    const h = pickCell(single, { origin: [0.1, 0.2, 0], dir: [0, 0, -1] })!;
    expect(h.t).toBe(0);
    expect(h.inside).toBe(true);
    expect(h.dir).toBe(4); // moving −Z, the line entered through +Z
    close(h.point, [0.1, 0.2, 0]);
    // a cube behind the origin does not count; the inside cube wins over one further along
    const two = modelOf([c(0, 0, 0, 'pinHole', 2), c(0, 0, -1, 'pinHole', 2)]);
    expect(pickCell(two, { origin: [0, 0, 0], dir: [0, 0, -1] })!.cellIndex).toBe(0);
    expect(pickCell(two, { origin: [0, 0, 0], dir: [0, 0, 1] })!.cellIndex).toBe(0);
    // origin exactly on the exit face going outward: miss
    expect(pickCell(single, { origin: [0, 0, 0.5], dir: [0, 0, 1] })).toBeNull();
  });

  it('filter excludes parts', () => {
    const h = pickCell(m, { origin: [10, 0, 0], dir: [-1, 0, 0] }, { filter: (p) => p.id !== 1 });
    expect(h).toBeNull();
  });
});

describe('pickCell shared cells (male + hole of different parts)', () => {
  // part 1: beam of two Z holes; part 2: 2-long pin through (0,0,0) sticking out to (0,0,1)
  const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]);
  const mBack = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2), c(0, 0, -1, 'pin', 2)]);

  it('axial face within R_ROD of the axis -> the male', () => {
    for (const [u, v] of [[0, 0], [0.2, 0], [0, -0.29], [0.2, 0.2]] as const) {
      const h = pickCell(mBack, faceRay([0, 0, 0], 4, u, v))!;
      expect(h.partId).toBe(2);
      expect(h.cellIndex).toBe(0);
      expect(h.dir).toBe(4);
    }
  });

  it('axial face outside R_ROD (or exactly at it) -> the hole', () => {
    for (const [u, v] of [[0.3, 0], [0, -0.45], [0.25, 0.25], [R_ROD, 0]] as const) {
      const h = pickCell(mBack, faceRay([0, 0, 0], 4, u, v))!;
      expect(h.partId).toBe(1);
      expect(h.cellIndex).toBe(0);
    }
  });

  it('lateral faces -> the hole, even through the axis', () => {
    for (const d of [2, 3] as Dir[]) {
      const h = pickCell(mBack, faceRay([0, 0, 0], d, 0, 0))!;
      expect(h.partId).toBe(1);
    }
    // the -X face is shared with nothing (cell 1 is at +X)
    expect(pickCell(mBack, faceRay([0, 0, 0], 1))!.partId).toBe(1);
  });

  it('the pin sticking out is picked as itself; its cube shadows the hole behind it', () => {
    const h = pickCell(m, faceRay([0, 0, 1], 4, 0.4, 0.4))!;
    expect(h.partId).toBe(2);
    expect(h.cellIndex).toBe(1);
    expect(h.pos).toEqual([0, 0, 1]);
  });

  it('ray from −Z into the shared cell: same rule on the other axial face', () => {
    const h = pickCell(m, faceRay([0, 0, 0], 5, 0.1, 0))!;
    expect(h.partId).toBe(2);
    expect(h.cellIndex).toBe(0);
    expect(h.dir).toBe(5);
    expect(pickCell(m, faceRay([0, 0, 0], 5, 0.4, 0))!.partId).toBe(1);
  });
});

describe('pickCell with transforms (simulation)', () => {
  const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)], [c(5, 0, 0, 'pinHole', 2)]);
  const I: PartTransform = { p: [0, 0, 0], q: [0, 0, 0, 1] };

  it('translation: hits the moved part, not where it was', () => {
    const tf = (id: number): PartTransform => (id === 2 ? { p: [0, 10, 0], q: [0, 0, 0, 1] } : I);
    expect(pickCell(m, { origin: [5, 0, 10], dir: [0, 0, -1] }, { transform: tf })).toBeNull();
    const h = pickCell(m, { origin: [5, 10.2, 10], dir: [0, 0, -1] }, { transform: tf })!;
    expect(h.partId).toBe(2);
    expect(h.dir).toBe(4);
    close(h.point, [5, 10.2, 0.5]);
    close(h.localPoint, [5, 0.2, 0.5]);
    close(h.normal, [0, 0, 1]);
  });

  it('rotation: face and local point in the edit frame, normal and point in world', () => {
    // 90° about +Y: edit +X -> world −Z; edit +Z -> world +X. Part 1 cell 1 (1,0,0) -> world (0,0,−1).
    const s = Math.SQRT1_2;
    const tf = (id: number): PartTransform | null => (id === 1 ? { p: [0, 0, 0], q: [0, s, 0, s] } : null);
    const h = pickCell(m, { origin: [0.1, 0.2, -10], dir: [0, 0, 1] }, { transform: tf })!;
    expect(h.partId).toBe(1);
    expect(h.cellIndex).toBe(1);
    expect(h.dir).toBe(0); // edit-frame +X face
    close(h.normal, [0, 0, -1]);
    close(h.point, [0.1, 0.2, -1.5]);
    close(h.localPoint, [1.5, 0.2, 0.1]);
  });

  it('null transform skips a part (removed body)', () => {
    const tf = (id: number): PartTransform | null => (id === 1 ? null : I);
    expect(pickCell(m, { origin: [0, 0, 10], dir: [0, 0, -1] }, { transform: tf })).toBeNull();
    expect(pickCell(m, { origin: [5, 0, 10], dir: [0, 0, -1] }, { transform: tf })!.partId).toBe(2);
  });

  it('shared cell: same transform keeps the R_ROD rule; different transforms test both cubes', () => {
    const mm = modelOf([c(0, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2), c(0, 0, -1, 'pin', 2)]);
    const same = () => I;
    expect(pickCell(mm, faceRay([0, 0, 0], 4, 0.1, 0), { transform: same })!.partId).toBe(2);
    expect(pickCell(mm, faceRay([0, 0, 0], 4, 0.4, 0), { transform: same })!.partId).toBe(1);
    // the pin slid 0.3 toward +Z: its cube is now the nearer one along a +Z-facing ray
    const slid = (id: number): PartTransform => (id === 2 ? { p: [0, 0, 0.3], q: [0, 0, 0, 1] } : I);
    const h = pickCell(mm, faceRay([0, 0, 0], 4, 0.4, 0), { transform: slid })!;
    expect(h.partId).toBe(2);
    expect(h.t).toBeCloseTo(0.4, 9);
  });
});

describe('pickCell agrees with a brute-force reference and is fast', () => {
  function rnd(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }
  // ~3000 cells: a 3-layer slab of 30×33 one-cell parts plus beams
  let big: Model = emptyModel();
  const cells: Cell[] = [];
  for (let x = 0; x < 30; x++)
    for (let z = 0; z < 33; z++)
      for (let y = 0; y < 3; y++) if ((x + y + z) % 2 === 0 || y === 0) cells.push(c(x, y, z, 'pinHole', 1));
  for (const cl of cells) big = addPart(big, [cl]).model;

  function naive(m: Model, r: Ray): number | null {
    let best: number | null = null;
    for (const p of m.parts)
      for (const cl of p.cells) {
        let tn = -Infinity;
        let tf = Infinity;
        let ok = true;
        for (let a = 0; a < 3; a++) {
          const o = r.origin[a]!;
          const d = r.dir[a]!;
          const cc = a === 0 ? cl.x : a === 1 ? cl.y : cl.z;
          if (d === 0) {
            if (o < cc - 0.5 || o > cc + 0.5) ok = false;
            continue;
          }
          const t1 = (cc - 0.5 - o) / d;
          const t2 = (cc + 0.5 - o) / d;
          tn = Math.max(tn, Math.min(t1, t2));
          tf = Math.min(tf, Math.max(t1, t2));
        }
        if (!ok || tf - tn <= 1e-9 || tf <= 1e-9) continue;
        const t = Math.max(tn, 0);
        if (best === null || t < best) best = t;
      }
    return best;
  }

  it(`matches the reference on random rays (${cells.length} cells)`, () => {
    expect(cells.length).toBeGreaterThan(1500);
    const r = rnd(7);
    for (let i = 0; i < 300; i++) {
      const origin: [number, number, number] = [r() * 50 - 10, r() * 20 - 5, r() * 50 - 10];
      const target: [number, number, number] = [r() * 30, r() * 3, r() * 33];
      const ray: Ray = { origin, dir: [target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]] };
      const h = pickCell(big, ray);
      const t = naive(big, ray);
      if (t === null) expect(h).toBeNull();
      else expect(h!.t).toBeCloseTo(t, 9);
    }
  });

  it('a few thousand cells per pick: < 5 ms per pick on average', () => {
    const r = rnd(3);
    const rays: Ray[] = [];
    for (let i = 0; i < 200; i++) rays.push({ origin: [r() * 30, 40, r() * 33 + 20], dir: [r() - 0.5, -1, -0.7] });
    pickCell(big, rays[0]!); // warm caches
    const t0 = performance.now();
    for (const ray of rays) pickCell(big, ray);
    const per = (performance.now() - t0) / rays.length;
    expect(per).toBeLessThan(5);
  });
});

describe('pickGrid', () => {
  it('cell under the ray on y = −½', () => {
    const g = pickGrid({ origin: [2.3, 10, -1.7], dir: [0, -1, 0] })!;
    expect(g.pos).toEqual([2, 0, -2]);
    expect(g.point[1]).toBe(GRID_Y);
    expect(g.t).toBeCloseTo(10.5, 12);
    expect(g.dir).toBe(2);
  });
  it('oblique ray and from below', () => {
    const g = pickGrid({ origin: [0, 0.5, 0], dir: [1, -1, 2] })!; // t = 1 -> (1, −½, 2)
    expect(g.pos).toEqual([1, 0, 2]);
    const b = pickGrid({ origin: [0.2, -3, 0.2], dir: [0, 1, 0] })!;
    expect(b.dir).toBe(3);
    expect(b.pos).toEqual([0, 0, 0]);
  });
  it('halves round up; no negative zero', () => {
    expect(pickGrid({ origin: [0.5, 1, -0.5], dir: [0, -1, 0] })!.pos).toEqual([1, 0, 0]);
    const p = pickGrid({ origin: [-0.2, 1, -0.4], dir: [0, -1, 0] })!.pos;
    expect(Object.is(p[0], -0)).toBe(false);
    expect(Object.is(p[2], -0)).toBe(false);
  });
  it('parallel or behind -> null', () => {
    expect(pickGrid({ origin: [0, 1, 0], dir: [1, 0, 0] })).toBeNull();
    expect(pickGrid({ origin: [0, 1, 0], dir: [0, 1, 0] })).toBeNull();
    expect(pickGrid({ origin: [0, -1, 0], dir: [0, -1, 0] })).toBeNull();
  });
});

describe('pickCell: filter with shared cells, exact edge/corner entries (review fixes)', () => {
  // beam 1 with Z holes at x = 0, 1; pin 2 along Z through (0,0,0), sticking out to (0,0,-1)
  const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2), c(0, 0, -1, 'pin', 2)]);
  const id: PartTransform = { p: [0, 0, 0], q: [0, 0, 0, 1] };

  for (const transform of [undefined, () => id]) {
    const tag = transform ? 'with identity transforms' : 'edit mode';
    it(`hole part filtered out: the pin is pickable at the shared cell (${tag})`, () => {
      const opts = { filter: (p: { id: number }) => p.id !== 1, ...(transform ? { transform } : {}) };
      const axial = pickCell(m, { origin: [0, 0, 5], dir: [0, 0, -1] }, opts)!;
      expect(axial).toMatchObject({ partId: 2, pos: [0, 0, 0], dir: 4 });
      const side = pickCell(m, { origin: [0, 5, 0], dir: [0, -1, 0] }, opts)!;
      expect(side).toMatchObject({ partId: 2, pos: [0, 0, 0], dir: 2 });
    });
    it(`pin part filtered out: the hole wins even on the axis (${tag})`, () => {
      const opts = { filter: (p: { id: number }) => p.id !== 2, ...(transform ? { transform } : {}) };
      const h = pickCell(m, { origin: [0, 0, 5], dir: [0, 0, -1] }, opts)!;
      expect(h).toMatchObject({ partId: 1, pos: [0, 0, 0], dir: 4 });
      expect(pickCell(m, { origin: [0, 0, -5], dir: [0, 0, 1] }, opts)).toMatchObject({ partId: 1, pos: [0, 0, 0], dir: 5 });
    });
  }

  it('without a filter the shared rule is unchanged', () => {
    expect(pickCell(m, { origin: [0, 0, 5], dir: [0, 0, -1] })).toMatchObject({ partId: 2, pos: [0, 0, 0] });
    expect(pickCell(m, { origin: [0.45, 0, 5], dir: [0, 0, -1] })).toMatchObject({ partId: 1, pos: [0, 0, 0] });
  });

  it('exact edge entry reports a tied face whose neighbour is empty', () => {
    const a = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)]);
    const h = pickCell(a, { origin: [1.5, 1.5, 0.1], dir: [-1, -1, 0] })!;
    expect(h).toMatchObject({ cellIndex: 0, dir: 2 }); // +Y, not +X (occupied)
    // with both neighbours free the usual tie rule (lower axis) stays
    const single = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    expect(pickCell(single, { origin: [1.5, 1.5, 0.1], dir: [-1, -1, 0] })!.dir).toBe(0);
  });

  it('exact corner entry: skips both occupied tied faces', () => {
    const a = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(0, 1, 0, 'pinHole', 2)]);
    const h = pickCell(a, { origin: [1.5, 1.5, 1.5], dir: [-1, -1, -1] })!;
    expect(h).toMatchObject({ pos: [0, 0, 0], dir: 4 });
  });
});
