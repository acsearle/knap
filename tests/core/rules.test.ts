import { describe, expect, it } from 'vitest';
import {
  AXES,
  DIRS,
  FRICTION_PIN_IN_PIN_HOLE,
  KINDS,
  MATE_TABLE,
  axisOfDir,
  connects,
  dirBetween,
  isHole,
  isMale,
  mateType,
  oppositeDir,
  shareResult,
} from '../../src/core/rules';
import type { Axis, Cell, Dir, Kind } from '../../src/core/types';

const cell = (x: number, y: number, z: number, kind: Kind, axis: Axis): Cell => ({ x, y, z, kind, axis });

describe('kinds', () => {
  it('classifies male and hole kinds', () => {
    expect(KINDS.filter(isMale)).toEqual(['axle', 'pin', 'frictionPin']);
    expect(KINDS.filter(isHole)).toEqual(['pinHole', 'axleHole']);
  });
});

describe('directions', () => {
  it('DIRS are the six unit vectors in +X,-X,+Y,-Y,+Z,-Z order', () => {
    expect(DIRS).toEqual([
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ]);
  });
  it('axisOfDir / oppositeDir', () => {
    expect([0, 1, 2, 3, 4, 5].map((d) => axisOfDir(d as Dir))).toEqual([0, 0, 1, 1, 2, 2]);
    expect([0, 1, 2, 3, 4, 5].map((d) => oppositeDir(d as Dir))).toEqual([1, 0, 3, 2, 5, 4]);
  });
  it('dirBetween', () => {
    const o = { x: 0, y: 0, z: 0 };
    DIRS.forEach((d, i) => expect(dirBetween(o, { x: d[0], y: d[1], z: d[2] })).toBe(i));
    expect(dirBetween(o, o)).toBeNull();
    expect(dirBetween(o, { x: 1, y: 1, z: 0 })).toBeNull();
    expect(dirBetween(o, { x: 2, y: 0, z: 0 })).toBeNull();
  });
});

/**
 * Independent model of §2.2's first formulation: what material each cell presents on a face,
 * and which pairings connect.
 */
function presents(c: Cell, n: Axis): 'ring' | 'wall' | 'end' | 'side' {
  if (isHole(c.kind)) return c.axis === n ? 'ring' : 'wall';
  return c.axis === n ? 'end' : 'side';
}
const CONNECTING = new Set(['ring|ring', 'ring|wall', 'wall|ring', 'wall|wall', 'end|end', 'end|wall', 'wall|end']);

describe('connects: full truth table', () => {
  let count = 0;
  for (const ka of KINDS)
    for (const kb of KINDS)
      for (const aa of AXES)
        for (const ab of AXES)
          for (let d = 0; d < 6; d++) {
            const v = DIRS[d]!;
            const a = cell(0, 0, 0, ka, aa);
            const b = cell(v[0], v[1], v[2], kb, ab);
            const n = axisOfDir(d as Dir);
            const expected = CONNECTING.has(`${presents(a, n)}|${presents(b, n)}`);
            count++;
            it(`${ka}∥${'XYZ'[aa]} → ${'+-'[d % 2]}${'XYZ'[n]} → ${kb}∥${'XYZ'[ab]}: ${expected}`, () => {
              expect(connects(a, b)).toBe(expected);
              expect(connects(b, a)).toBe(expected); // symmetric
            });
          }
  it('covers 5×5 kinds × 3×3 axes × 6 directions', () => expect(count).toBe(1350));
});

describe('connects: named cases and non-adjacency', () => {
  it('liftarm: side-by-side parallel holes connect', () => {
    expect(connects(cell(0, 0, 0, 'pinHole', 2), cell(1, 0, 0, 'pinHole', 2))).toBe(true);
  });
  it('tube: coaxial holes connect (ring–ring)', () => {
    expect(connects(cell(0, 0, 0, 'pinHole', 2), cell(0, 0, 1, 'axleHole', 2))).toBe(true);
  });
  it('axle: collinear axle segments connect; side-by-side do not', () => {
    expect(connects(cell(0, 0, 0, 'axle', 0), cell(1, 0, 0, 'axle', 0))).toBe(true);
    expect(connects(cell(0, 0, 0, 'axle', 2), cell(1, 0, 0, 'axle', 2))).toBe(false);
  });
  it('axle-pin: axle end to pin end connects', () => {
    expect(connects(cell(0, 0, 0, 'axle', 1), cell(0, 1, 0, 'pin', 1))).toBe(true);
  });
  it('rod ending on a coaxial hole mouth does not connect', () => {
    expect(connects(cell(0, 0, 0, 'pin', 2), cell(0, 0, 1, 'pinHole', 2))).toBe(false);
  });
  it('rod growing out of a hole wall connects', () => {
    expect(connects(cell(0, 0, 0, 'pinHole', 2), cell(1, 0, 0, 'frictionPin', 0))).toBe(true);
  });
  it('rod side against anything does not connect', () => {
    expect(connects(cell(0, 0, 0, 'pin', 0), cell(0, 1, 0, 'pinHole', 2))).toBe(false);
    expect(connects(cell(0, 0, 0, 'pin', 0), cell(0, 1, 0, 'pin', 1))).toBe(false);
  });
  it('non-adjacent cells never connect', () => {
    const a = cell(0, 0, 0, 'pinHole', 2);
    expect(connects(a, cell(0, 0, 0, 'pinHole', 2))).toBe(false);
    expect(connects(a, cell(1, 1, 0, 'pinHole', 2))).toBe(false);
    expect(connects(a, cell(2, 0, 0, 'pinHole', 2))).toBe(false);
    expect(connects(cell(0, 0, 0, 'axle', 0), cell(2, 0, 0, 'axle', 0))).toBe(false);
  });
});

describe('mate table', () => {
  it('matches §2.3 exactly', () => {
    expect(mateType('axle', 'pinHole')).toBe('cylindrical');
    expect(mateType('axle', 'axleHole')).toBe('weld');
    expect(mateType('pin', 'pinHole')).toBe('revolute');
    expect(mateType('pin', 'axleHole')).toBeNull();
    expect(mateType('frictionPin', 'pinHole')).toBe('weld');
    expect(mateType('frictionPin', 'axleHole')).toBeNull();
  });
  it('friction pin entry comes from the named constant', () => {
    expect(FRICTION_PIN_IN_PIN_HOLE).toBe('weld');
    expect(MATE_TABLE.frictionPin.pinHole).toBe(FRICTION_PIN_IN_PIN_HOLE);
  });
  it('non male/hole argument orders give null', () => {
    for (const a of KINDS)
      for (const b of KINDS) if (!(isMale(a) && isHole(b))) expect(mateType(a, b)).toBeNull();
  });
});

describe('shareResult (two cells of different parts at one position)', () => {
  const at = (kind: Kind, axis: Axis) => cell(0, 0, 0, kind, axis);
  it('every kind pair × axis pair', () => {
    for (const ka of KINDS)
      for (const kb of KINDS)
        for (const aa of AXES)
          for (const ab of AXES) {
            const r = shareResult(at(ka, aa), at(kb, ab));
            const r2 = shareResult(at(kb, ab), at(ka, aa));
            expect(r).toEqual(r2);
            const male = isMale(ka) ? ka : isMale(kb) ? kb : null;
            const hole = isHole(ka) ? ka : isHole(kb) ? kb : null;
            const ok = male !== null && hole !== null && aa === ab && mateType(male, hole) !== null;
            expect(r.ok).toBe(ok);
            if (r.ok) expect(r.mate).toBe(mateType(male!, hole!));
          }
  });
  it('gives specific reasons', () => {
    const reason = (a: Cell, b: Cell) => {
      const r = shareResult(a, b);
      return r.ok ? '' : r.reason;
    };
    expect(reason(at('pin', 0), at('axle', 0))).toMatch(/two pins\/axles/);
    expect(reason(at('pinHole', 0), at('axleHole', 0))).toMatch(/two holes/);
    expect(reason(at('pin', 0), at('pinHole', 1))).toMatch(/not coaxial/);
    expect(reason(at('pin', 2), at('axleHole', 2))).toMatch(/does not fit/);
  });
});
