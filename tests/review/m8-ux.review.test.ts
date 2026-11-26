// Reviewer "ux" (milestone 8, gears): editor behaviours found in the real page, pinned headlessly.
// These are ordinary tests: they pin what the code does today; the ones titled FIXED were updated by
// the m8 ui fixer when the usability gaps they pinned were fixed.
import { describe, expect, it } from 'vitest';
import { canAddCell, canSetGear, gearMeshes, makeCell, setGear, validateModel } from '../../src/core';
import type { Cell, Model } from '../../src/core';
import { initialToolState, resolveBuild, resolveGear, selectTool } from '../../src/editor';

const hole = (x: number, y: number, z: number, rim?: number, teeth?: boolean, kind: Cell['kind'] = 'pinHole'): Cell => makeCell(x, y, z, kind, 2, rim, teeth);
const model = (parts: Cell[][]): Model =>
  ({ version: 3, rootPartId: 1, nextPartId: parts.length + 1, ground: false, fixRoot: true, parts: parts.map((cells, i) => ({ id: i + 1, color: '#a8adb2', cells })) }) as Model;

describe('m8 ux review: Gear tool dead end on a beam', () => {
  it('FIXED (was: the middle hole says "40 teeth would fit" but no Gear click can get there): the click goes to the 40', () => {
    const m = model([[0, 1, 2, 3, 4].map((x) => hole(x, 0, 0))]);
    const p = resolveGear(m, { partId: 1, cellIndex: 2, dir: 4 } as never, false);
    expect(p.valid).toBe(true);
    expect(p.to).toBe(2.5);
    expect(p.description).toBe("Gear · part 1 · 40 teeth (radius 2.5) · skips 8, 16, 24: (1, 0, 0) would cut into the teeth of this part's gear (hub (2, 0, 0))");
    // the 40 itself is valid (the four beam cells are its web), and one click makes it
    expect(canSetGear(m, 1, [2, 0, 0], 2.5).ok).toBe(true);
    const next = p.apply(m);
    expect(validateModel(next)).toEqual([]);
    expect(next.parts[0]!.cells[2]).toEqual(hole(2, 0, 0, 2.5, true));
    // Shift (down) still has nothing to do on a bare hole
    expect(resolveGear(m, { partId: 1, cellIndex: 2, dir: 4 } as never, true).valid).toBe(false);
  });
  it('FIXED: the end hole of a beam (no size fits) says where a gear can go', () => {
    const m = model([[0, 1, 2, 3, 4].map((x) => hole(x, 0, 0))]);
    const p = resolveGear(m, { partId: 1, cellIndex: 0, dir: 4 } as never, false);
    expect(p.valid).toBe(false);
    expect(p.description).toBe(
      "Gear · part 1 · 8 teeth (radius 0.5) — (1, 0, 0) would cut into the teeth of this part's gear (hub (0, 0, 0)) · a gear needs a layer to itself: sleeve a hole onto a pin, or extend a hole out of the beam along its axis",
    );
  });
});

describe('m8 ux review: a shaft through a meshing 8-tooth gear', () => {
  // 40 at (0,0,1) on its own pin; an 8 at (3,0,1). Rule 1 of §2.7 counted a pin / axle of another
  // part inside the 8's hub as a cube the 40's tip disc (2.59) overlaps (cell spans 2.5…3.5). Fixed
  // (sim fixer, DEVIATIONS "Gears"): another part's male counts by its rod (half-width 5/16) against
  // a gear's tip disc, which clears every meshing partner's hub. More in tests/core/gears-shafts.test.ts.
  const frame = [0, 1, 2, 3].map((x) => hole(x, 0, 0));
  const pin40 = [makeCell(0, 0, 0, 'pin', 2), makeCell(0, 0, 1, 'pin', 2)];
  it('FIXED (was: refused with "gear teeth would hit part 2 at (3, 0, 1)"): an axle through the 8 lets the 40 mesh with it', () => {
    const axle = [makeCell(3, 0, 0, 'axle', 2), makeCell(3, 0, 1, 'axle', 2), makeCell(3, 0, 2, 'axle', 2)];
    const m = model([frame, axle, [hole(3, 0, 1, 0.5, true, 'axleHole')], pin40, [hole(0, 0, 1)]]);
    const r = canSetGear(m, 5, [0, 0, 1], 2.5);
    expect(r.ok ? '' : r.reason).toBe('');
    expect(gearMeshes(setGear(m, 5, [0, 0, 1], 2.5))).toHaveLength(1);
  });
  it('FIXED (was refused): the same with an 8 + 24 at distance 2, and with a smooth pin instead of the axle', () => {
    const axle = [makeCell(2, 0, 0, 'axle', 2), makeCell(2, 0, 1, 'axle', 2)];
    const m = model([frame, axle, [hole(2, 0, 1, 0.5, true, 'axleHole')], pin40, [hole(0, 0, 1)]]);
    expect(canSetGear(m, 5, [0, 0, 1], 1.5).ok).toBe(true);
    const pin = [makeCell(3, 0, 0, 'pin', 2), makeCell(3, 0, 1, 'pin', 2)];
    const p = model([frame, pin, [hole(3, 0, 1, 0.5, true)], pin40, [hole(0, 0, 1)]]);
    expect(canSetGear(p, 5, [0, 0, 1], 2.5).ok).toBe(true);
  });
  it('without the shaft in the 8 the pair is valid and meshes', () => {
    const m = model([frame, [hole(3, 0, 1, 0.5, true), hole(3, 0, 2)], pin40, [hole(0, 0, 1, 2.5, true)]]);
    expect(validateModel(m)).toEqual([]);
    expect(gearMeshes(m)).toHaveLength(1);
  });
});

describe('m8 ux review: gears that sit side by side without meshing say nothing', () => {
  it('FIXED (was: valid, no mesh, and the Gear hint did not mention it): 16 beside a 24 at distance 3 says why it does not mesh', () => {
    const m = model([[hole(0, 0, 0, 1, true)], [hole(3, 0, 0, 1, true)]]);
    const p = resolveGear(m, { partId: 2, cellIndex: 0, dir: 4 } as never, false);
    expect(p.valid).toBe(true);
    expect(p.meshes).toEqual([]);
    expect(p.description).toBe('Gear · part 2 · 24 teeth (radius 1.5) · does not mesh with part 1 (16 teeth): a 16 meshes only with another 16, in line at distance 2');
  });
  it('FIXED: an 8 beside a 16 at distance 2, and a 24 with an 8 on the diagonal (2, 1)', () => {
    const a = model([[hole(0, 0, 0, 1, true)], [hole(2, 0, 0)]]);
    expect(resolveGear(a, { partId: 2, cellIndex: 0, dir: 4 } as never, false).description).toBe(
      'Gear · part 2 · 8 teeth (radius 0.5) · does not mesh with part 1 (16 teeth): a 16 meshes only with another 16, in line at distance 2',
    );
    const b = model([[hole(0, 0, 0, 1, true)], [hole(2, 1, 0, 0.5, true)]]);
    expect(resolveGear(b, { partId: 1, cellIndex: 0, dir: 4 } as never, false).description).toBe(
      'Gear · part 1 · 24 teeth (radius 1.5) · does not mesh with part 2 (8 teeth): gears mesh only in a straight line along the grid (a 24 and an 8 at distance 2)',
    );
    // a real mesh says so and adds no "does not mesh"
    const c = model([[hole(0, 0, 0, 1, true)], [hole(2, 0, 0, 0.5, true)]]);
    expect(resolveGear(c, { partId: 2, cellIndex: 0, dir: 4 } as never, false).description).toBe('Gear · part 2 · 16 teeth (radius 1) · meshes with part 1 (16 teeth, 1:1)');
  });
});

describe('m8 ux review: a crank hole in the web facing the partner gear', () => {
  // Fixed (sim fixer, DEVIATIONS "Gears"): like the hub, a web cell is its gear's body, which other
  // discs meet only through §2.7 rules 2–4; the gear cannot then be taken away from under it.
  it('FIXED (was: the mesh-side web hole was refused): 24 + 24 meshing at distance 3 with a web hole on either side', () => {
    const near = model([[hole(0, 0, 0, 1.5, true), hole(1, 0, 0)], [hole(3, 0, 0, 1.5, true)]]);
    const far = model([[hole(0, 0, 0, 1.5, true), hole(-1, 0, 0)], [hole(3, 0, 0, 1.5, true)]]);
    expect(validateModel(far)).toEqual([]);
    expect(validateModel(near)).toEqual([]);
    expect(gearMeshes(near)).toHaveLength(1);
    expect(canSetGear(near, 1, [0, 0, 0], undefined)).toEqual({ ok: false, reason: 'without this gear, (1, 0, 0) is inside the gear of part 2' });
  });
  it('FIXED (was refused): 40 + 8 meshing at distance 3 keeps its (2, 0) web hole toward the 8', () => {
    const m = model([[hole(0, 0, 0, 2.5, true), hole(2, 0, 0)], [hole(3, 0, 0, 0.5, true), hole(3, 0, 1)]]);
    expect(validateModel(m)).toEqual([]);
  });
});

describe('m8 ux review: order matters — the 8 must exist before the 40 that meshes it', () => {
  // A 40 at (0,0,1) on a pin; part 3 has a hole at (3,0,2) (the pinion's own bearing layer).
  const base = model([[0, 1, 2, 3].map((x) => hole(x, 0, 0)), [makeCell(0, 0, 0, 'pin', 2), makeCell(0, 0, 1, 'pin', 2)], [hole(0, 0, 1, 2.5, true)], [hole(3, 0, 2)]]);
  it('a bare hole for the pinion cannot be added where the 40 already reaches (core rule, unchanged)', () => {
    expect(validateModel(base)).toEqual([]);
    const r = canAddCell(base, 4, hole(3, 0, 1));
    expect(r.ok).toBe(false);
    expect(r.ok ? '' : r.reason).toMatch(/inside the gear of part 3/);
  });
  it('FIXED: the build tool refusal says how to get there (build first, or shrink the gear)', () => {
    // extend part 4's hole at (3,0,2) toward −Z, into (3,0,1)
    const p = resolveBuild(base, { partId: 4, cellIndex: 0, dir: 5 } as never, null, selectTool(initialToolState(), 'pinHole'));
    expect(p.valid).toBe(false);
    expect(p.reason).toBe(
      "(3, 0, 1) is inside the gear of part 3 · build this before part 3's gear grows over it, or shrink that gear first (Gear tool, Shift+click) and grow it back after",
    );
  });
  it('the 8 already there: the same mesh is valid', () => {
    const m = model([[0, 1, 2, 3].map((x) => hole(x, 0, 0)), [makeCell(0, 0, 0, 'pin', 2), makeCell(0, 0, 1, 'pin', 2)], [hole(0, 0, 1, 2.5, true)], [hole(3, 0, 2), hole(3, 0, 1, 0.5, true)]]);
    expect(validateModel(m)).toEqual([]);
    expect(gearMeshes(m)).toHaveLength(1);
  });
});
