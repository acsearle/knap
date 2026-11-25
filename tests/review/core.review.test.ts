// Adversarial review tests for src/core (DESIGN.md §1–§2). Expectations follow from the spec.
import { describe, expect, it } from 'vitest';
import {
  addCell,
  addPart,
  canAddCell,
  deserialize,
  effectiveRootId,
  emptyModel,
  movePart,
  partById,
  removeCell,
  removePart,
  rotatePart,
  serialize,
  validateModel,
} from '../../src/core/model';
import { DIRS, axisOfDir, connects, mateType } from '../../src/core/rules';
import type { Axis, Cell, Kind, Model, Part } from '../../src/core/types';

const C = (x: number, y: number, z: number, kind: Kind, axis: Axis): Cell => ({ x, y, z, kind, axis });
const P = (id: number, cells: Cell[], color = '#112233'): Part => ({ id, color, cells });
const M = (parts: Part[], rootPartId: number | null = null, nextPartId?: number): Model => ({
  version: 1,
  parts,
  rootPartId,
  nextPartId: nextPartId ?? Math.max(0, ...parts.map((p) => p.id)) + 1,
});

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

const codes = (m: Model) => validateModel(m).map((e) => e.code);
const sortedCells = (p: Part | undefined) =>
  [...(p?.cells ?? [])].map((c) => `${c.x},${c.y},${c.z},${c.kind},${c.axis}`).sort();

// liftarm of 3 pin holes along X, axis Z
const liftarm3 = (y = 0, z = 0) => [0, 1, 2].map((x) => C(x, y, z, 'pinHole', 2));

describe('rules: connects exhaustive against §2.2 table', () => {
  const kinds: Kind[] = ['pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];
  const male = (k: Kind) => k === 'axle' || k === 'pin' || k === 'frictionPin';
  it('matches the "equivalently" formulation for every kind/axis/dir', () => {
    for (let d = 0; d < 6; d++) {
      const n = axisOfDir(d as 0);
      const [dx, dy, dz] = DIRS[d]!;
      for (const ka of kinds)
        for (const kb of kinds)
          for (const aa of [0, 1, 2] as Axis[])
            for (const ab of [0, 1, 2] as Axis[]) {
              const a = C(0, 0, 0, ka, aa);
              const b = C(dx, dy, dz, kb, ab);
              let exp: boolean;
              if (!male(ka) && !male(kb)) exp = true;
              else if (male(ka) && male(kb)) exp = aa === n && ab === n;
              else {
                const [m, h] = male(ka) ? [aa, ab] : [ab, aa];
                exp = m === n && h !== n;
              }
              expect(connects(a, b)).toBe(exp);
              expect(connects(b, a)).toBe(exp);
            }
    }
  });
  it('is false for non-adjacent cells (diagonal, distance 2, same position)', () => {
    const h = C(0, 0, 0, 'pinHole', 0);
    expect(connects(h, C(1, 1, 0, 'pinHole', 0))).toBe(false);
    expect(connects(h, C(2, 0, 0, 'pinHole', 0))).toBe(false);
    expect(connects(h, C(0, 0, 0, 'pinHole', 0))).toBe(false);
  });
  it('is false for cells that are not face-adjacent even with non-integer coordinates', () => {
    // (0.5,0.5,0) is not face-adjacent to (0,0,0); spec: connects is false if not face-adjacent.
    expect(connects(C(0, 0, 0, 'pinHole', 0), C(0.5, 0.5, 0, 'pinHole', 0))).toBe(false);
  });
  it('mate table', () => {
    expect(mateType('axle', 'pinHole')).toBe('cylindrical');
    expect(mateType('axle', 'axleHole')).toBe('weld');
    expect(mateType('pin', 'pinHole')).toBe('revolute');
    expect(mateType('pin', 'axleHole')).toBeNull();
    expect(mateType('frictionPin', 'pinHole')).toBe('weld');
    expect(mateType('frictionPin', 'axleHole')).toBeNull();
    expect(mateType('pinHole', 'axle')).toBeNull();
    expect(mateType('axle', 'pin')).toBeNull();
    expect(mateType('pinHole', 'axleHole')).toBeNull();
  });
});

describe('validateModel holes', () => {
  it('same-part male + hole at one position is invalid', () => {
    expect(codes(M([P(1, [C(0, 0, 0, 'pinHole', 2), C(0, 0, 0, 'pin', 2)])]))).not.toEqual([]);
  });
  it('three parts at one position is invalid even if each pair could look ok', () => {
    const m = M([
      P(1, [C(0, 0, 0, 'pinHole', 2)]),
      P(2, [C(0, 0, 0, 'pin', 2)]),
      P(3, [C(0, 0, 0, 'pinHole', 2)]),
    ]);
    expect(codes(m)).toContain('overlap');
  });
  it('non-coaxial / incompatible / two males / two holes overlaps invalid', () => {
    const pairs: [Cell, Cell][] = [
      [C(0, 0, 0, 'pin', 0), C(0, 0, 0, 'pinHole', 2)],
      [C(0, 0, 0, 'pin', 2), C(0, 0, 0, 'axleHole', 2)],
      [C(0, 0, 0, 'frictionPin', 2), C(0, 0, 0, 'axleHole', 2)],
      [C(0, 0, 0, 'pin', 2), C(0, 0, 0, 'axle', 2)],
      [C(0, 0, 0, 'pinHole', 2), C(0, 0, 0, 'axleHole', 2)],
    ];
    for (const [a, b] of pairs) {
      expect(codes(M([P(1, [a]), P(2, [b])]))).toContain('overlap');
      expect(codes(M([P(1, [b]), P(2, [a])]))).toContain('overlap');
    }
    expect(codes(M([P(1, [C(0, 0, 0, 'axle', 1)]), P(2, [C(0, 0, 0, 'pinHole', 1)])]))).toEqual([]);
  });
  it('disconnected: pin side touching hole, coaxial rod end on ring, perpendicular males', () => {
    expect(codes(M([P(1, [C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pin', 2)])]))).toContain('disconnected');
    expect(codes(M([P(1, [C(0, 0, 0, 'pinHole', 0), C(1, 0, 0, 'axle', 0)])]))).toContain('disconnected');
    expect(codes(M([P(1, [C(0, 0, 0, 'axle', 0), C(1, 0, 0, 'axle', 1)])]))).toContain('disconnected');
    expect(codes(M([P(1, [C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pin', 0)])]))).toEqual([]);
  });
  it('duplicate ids, stale root accepted, structure errors', () => {
    expect(codes(M([P(1, [C(0, 0, 0, 'pinHole', 2)]), P(1, [C(5, 0, 0, 'pinHole', 2)])]))).toContain('duplicatePartId');
    expect(codes(M([P(1, [C(0, 0, 0, 'pinHole', 2)])], 99))).toEqual([]);
    const bad: unknown[] = [
      M([P(1, [C(0.5, 0, 0, 'pinHole', 2)])]),
      M([P(1, [{ x: 0, y: 0, z: 0, kind: 'gear', axis: 0 } as unknown as Cell])]),
      M([P(1, [{ x: 0, y: 0, z: 0, kind: 'pin', axis: 3 } as unknown as Cell])]),
      M([P(1, [{ x: 0, y: 0, z: 0, kind: 'pin', axis: '0' } as unknown as Cell])]),
      M([P(1, [{ x: NaN, y: 0, z: 0, kind: 'pin', axis: 0 } as unknown as Cell])]),
      { ...M([]), nextPartId: 1.5 },
      { ...M([]), version: 2 },
      null,
      [],
    ];
    for (const b of bad) {
      expect(() => validateModel(b as Model)).not.toThrow();
      expect(validateModel(b as Model).length).toBeGreaterThan(0);
    }
  });
  it('nextPartId must exceed every part id', () => {
    expect(codes(M([P(3, [C(0, 0, 0, 'pinHole', 2)])], null, 3))).toContain('nextPartId');
  });
  it('rejects nextPartId < 1 (so addPart can never hand out a negative id)', () => {
    // Revised from the original review test, which asserted the old (buggy) acceptance of -5.
    for (const n of [-5, 0]) {
      const m: Model = { version: 1, parts: [], rootPartId: null, nextPartId: n };
      expect(codes(m)).toContain('structure');
      expect(() => deserialize(JSON.stringify({ version: 1, parts: [], nextPartId: n }))).toThrow();
    }
  });
  it('addPart / removeCell on an unvalidated model still produce valid ids', () => {
    const bad: Model = { version: 1, parts: [], rootPartId: null, nextPartId: -5 };
    const r = addPart(bad, [C(0, 0, 0, 'pinHole', 2)]);
    expect(r.partId).toBe(1);
    expect(validateModel(r.model)).toEqual([]);
    // split with a stale nextPartId: ids must not collide with existing parts
    const stale: Model = { ...M([P(4, [C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2), C(2, 0, 0, 'pinHole', 2)])]), nextPartId: 2 };
    const s2 = removeCell(stale, 4, [1, 0, 0]);
    expect(validateModel(s2)).toEqual([]);
    expect(s2.parts.map((p) => p.id)).toEqual([4, 5]);
  });
  it('addPart throws rather than produce an unsafe id', () => {
    const m: Model = { version: 1, parts: [], rootPartId: null, nextPartId: Number.MAX_SAFE_INTEGER };
    expect(validateModel(m)).toEqual([]);
    expect(() => addPart(m, [C(0, 0, 0, 'pinHole', 2)])).toThrow();
  });
  it('validateModel does not trust the identity cache (in-place mutation is still caught)', () => {
    const m = M([P(1, [C(0, 0, 0, 'pinHole', 2)]), P(2, [C(5, 0, 0, 'pinHole', 2)])]);
    expect(validateModel(m)).toEqual([]);
    canAddCell(m, null, C(9, 9, 9, 'pinHole', 2)); // populates the cache
    m.parts[1]!.cells[0]!.x = 0; // now overlaps part 1 (two holes)
    expect(codes(m)).toContain('overlap');
  });
});

describe('canAddCell / addCell', () => {
  const base = () => M([P(1, liftarm3())]);
  it('rejects a hole extension landing on another part rod with the wrong axis', () => {
    // part 2: axle along X at (3,0,0)…(4,0,0)
    let m = M([P(1, liftarm3()), P(2, [C(3, 0, 0, 'axle', 0), C(4, 0, 0, 'axle', 0)])]);
    expect(validateModel(m)).toEqual([]);
    expect(canAddCell(m, 1, C(3, 0, 0, 'pinHole', 2)).ok).toBe(false);
    expect(canAddCell(m, 1, C(3, 0, 0, 'pinHole', 0)).ok).toBe(true); // coaxial
    expect(canAddCell(m, 1, C(3, 0, 0, 'axleHole', 0)).ok).toBe(true);
    m = addCell(m, 1, C(3, 0, 0, 'axleHole', 0));
    expect(validateModel(m)).toEqual([]);
  });
  it('rejects when the position already holds a mate (third part)', () => {
    const m = M([P(1, liftarm3()), P(2, [C(0, 0, 0, 'pin', 2), C(0, 0, 1, 'pin', 2)]), P(3, [C(5, 5, 5, 'pinHole', 2)])]);
    expect(validateModel(m)).toEqual([]);
    expect(canAddCell(m, 3, C(0, 0, 0, 'pinHole', 2)).ok).toBe(false); // not adjacent anyway
    expect(canAddCell(m, null, C(0, 0, 0, 'pinHole', 2)).ok).toBe(false);
    expect(canAddCell(m, null, C(0, 0, 0, 'pin', 2)).ok).toBe(false);
  });
  it('new part case: compatible mate ok, incompatible rejected', () => {
    const m = base();
    expect(canAddCell(m, null, C(1, 0, 0, 'pin', 2)).ok).toBe(true);
    expect(canAddCell(m, null, C(1, 0, 0, 'pin', 1)).ok).toBe(false);
    expect(canAddCell(m, null, C(1, 0, 0, 'pinHole', 2)).ok).toBe(false);
    expect(canAddCell(m, null, C(9, 9, 9, 'pinHole', 2)).ok).toBe(true);
  });
  it('requires a connection, not mere adjacency; rejects own position', () => {
    const m = base();
    expect(canAddCell(m, 1, C(3, 0, 0, 'pin', 2)).ok).toBe(false); // side of pin on wall
    expect(canAddCell(m, 1, C(0, 0, 1, 'pin', 2)).ok).toBe(false); // end on ring
    expect(canAddCell(m, 1, C(0, 1, 0, 'pin', 1)).ok).toBe(true); // end on wall
    expect(canAddCell(m, 1, C(0, 0, 0, 'pin', 2)).ok).toBe(false); // own position
    expect(canAddCell(m, 1, C(5, 0, 0, 'pinHole', 2)).ok).toBe(false);
  });
  it('rejects malformed cells', () => {
    const m = base();
    expect(canAddCell(m, 1, C(3.5, 0, 0, 'pinHole', 2)).ok).toBe(false);
    expect(canAddCell(m, 1, { ...C(3, 0, 0, 'pinHole', 2), axis: 4 as Axis }).ok).toBe(false);
    expect(() => addCell(m, 1, C(3, 0, 0, 'pin', 2))).toThrow();
  });
  it('does not mutate the input', () => {
    const m = deepFreeze(base());
    const s = serialize(m);
    addCell(m, 1, C(3, 0, 0, 'pinHole', 2));
    addPart(m, [C(1, 0, 0, 'pin', 2)]);
    removeCell(m, 1, [1, 0, 0]);
    movePart(m, 1, [0, 5, 0]);
    rotatePart(m, 1, 1, -1, [0, 0, 0]);
    removePart(m, 1);
    expect(serialize(m)).toBe(s);
  });
});

describe('removeCell splitting', () => {
  it('largest piece keeps id, others get fresh ids, root follows the id', () => {
    // 5-long liftarm 0..4; remove x=1 → pieces {0} and {2,3,4}
    const cells = [0, 1, 2, 3, 4].map((x) => C(x, 0, 0, 'pinHole', 2));
    const m = M([P(7, cells), P(2, [C(0, 5, 0, 'pinHole', 2)])], 7, 10);
    const r = removeCell(m, 7, [1, 0, 0]);
    expect(validateModel(r)).toEqual([]);
    expect(sortedCells(partById(r, 7))).toEqual(sortedCells(P(0, [2, 3, 4].map((x) => C(x, 0, 0, 'pinHole', 2)))));
    expect(sortedCells(partById(r, 10))).toEqual(sortedCells(P(0, [C(0, 0, 0, 'pinHole', 2)])));
    expect(r.nextPartId).toBe(11);
    expect(r.rootPartId).toBe(7);
    expect(effectiveRootId(r)).toBe(7);
    expect(partById(r, 10)!.color).toBe('#112233');
  });
  it('largest piece listed later in cells still keeps the id', () => {
    const cells = [4, 3, 2, 1, 0].map((x) => C(x, 0, 0, 'pinHole', 2)); // reversed order
    const r = removeCell(M([P(1, cells)]), 1, [3, 0, 0]); // {4} and {2,1,0}
    expect(partById(r, 1)!.cells.length).toBe(3);
    expect(partById(r, 2)!.cells.length).toBe(1);
  });
  it('split where the cut makes a male-only rest hang by its sides', () => {
    // hole(0) with pin end on wall at (0,1,0) axis Y, and hole(1,0,0). Removing (0,0,0) leaves pin and hole apart.
    const m = M([P(1, [C(0, 0, 0, 'pinHole', 2), C(0, 1, 0, 'pin', 1), C(1, 0, 0, 'pinHole', 2), C(1, 1, 0, 'pin', 1)])]);
    expect(validateModel(m)).toEqual([]);
    const r = removeCell(m, 1, [0, 0, 0]);
    expect(validateModel(r)).toEqual([]);
    // (0,1,0) pin side touches (1,1,0) pin side -> not connected; (1,0,0)+(1,1,0) connected.
    expect(r.parts.length).toBe(2);
    expect(partById(r, 1)!.cells.length).toBe(2);
  });
  it('removing last cell of root part clears root to effective lowest id', () => {
    const m = M([P(1, [C(0, 0, 0, 'pinHole', 2)]), P(4, [C(3, 0, 0, 'pinHole', 2)])], 4);
    const r = removeCell(m, 4, [3, 0, 0]);
    expect(r.parts.map((p) => p.id)).toEqual([1]);
    expect(effectiveRootId(r)).toBe(1);
  });
});

describe('movePart / rotatePart', () => {
  it('rotation about Y by +1 maps +Z->+X and remaps cell axes; -1 and +3 agree', () => {
    const m = M([P(1, [C(0, 0, 0, 'pinHole', 0), C(0, 0, 1, 'pinHole', 0), C(0, 0, 2, 'pin', 2)])]);
    expect(validateModel(m)).toEqual([]);
    const r = rotatePart(m, 1, 1, 1, [0, 0, 0])!;
    expect(sortedCells(r.parts[0])).toEqual(
      sortedCells(P(1, [C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2), C(2, 0, 0, 'pin', 0)])),
    );
    expect(validateModel(r)).toEqual([]);
    const a = rotatePart(m, 1, 1, -1, [0, 0, 0])!;
    const b = rotatePart(m, 1, 1, 3, [0, 0, 0])!;
    expect(sortedCells(a.parts[0])).toEqual(sortedCells(b.parts[0]));
    expect(sortedCells(a.parts[0])).toEqual(
      sortedCells(P(1, [C(0, 0, 0, 'pinHole', 2), C(-1, 0, 0, 'pinHole', 2), C(-2, 0, 0, 'pin', 0)])),
    );
    const c = rotatePart(m, 1, 1, -4, [3, 3, 3])!;
    expect(sortedCells(c.parts[0])).toEqual(sortedCells(m.parts[0]));
  });
  it('pivot honoured; four quarter turns about X return to start', () => {
    const m = M([P(1, liftarm3(2, 3))]);
    let r: Model = m;
    for (let i = 0; i < 4; i++) r = rotatePart(r, 1, 0, 1, [7, -2, 5])!;
    expect(sortedCells(r.parts[0])).toEqual(sortedCells(m.parts[0]));
    const one = rotatePart(m, 1, 0, 1, [0, 2, 3])!; // pivot on the arm's line: positions unchanged
    expect(sortedCells(one.parts[0])).toEqual(sortedCells(P(1, [0, 1, 2].map((x) => C(x, 2, 3, 'pinHole', 1)))));
  });
  it('rotation that makes a mate non-coaxial returns null', () => {
    // pin along Z through hole at origin; rotating the liftarm about X by 1 turns hole axis to Y.
    const m = M([P(1, liftarm3()), P(2, [C(0, 0, 0, 'pin', 2), C(0, 0, 1, 'pin', 2)])]);
    expect(rotatePart(m, 1, 0, 1, [0, 0, 0])).toBeNull();
    expect(rotatePart(m, 1, 2, 2, [1, 0, 0])).not.toBeNull(); // arm flipped about its centre: still coaxial
  });
  it('movePart into a third-party occupied mate returns null; into free hole ok', () => {
    const m = M([P(1, liftarm3()), P(2, [C(0, 0, 0, 'pin', 2), C(0, 0, 1, 'pin', 2)]), P(3, [C(0, 5, 0, 'pin', 2)])]);
    expect(movePart(m, 3, [0, -5, 0])).toBeNull();
    const ok = movePart(m, 3, [1, -5, 0]);
    expect(ok).not.toBeNull();
    expect(validateModel(ok!)).toEqual([]);
    expect(movePart(m, 1, [0, 0, 1])).not.toBeNull(); // arm slides along the pin onto z=1, still coaxial
    expect(movePart(m, 1, [0, 0, 2])).not.toBeNull(); // off the pin entirely
  });
});

describe('deserialize', () => {
  it('round trip and determinism', () => {
    const m = M([P(1, liftarm3()), P(2, [C(0, 0, 0, 'pin', 2), C(0, 0, 1, 'pin', 2)], '#AABBCC')], 2);
    const s = serialize(deserialize(serialize(m)));
    expect(serialize(deserialize(s))).toBe(s);
    expect(deserialize(s).parts[1]!.color).toBe('#aabbcc');
  });
  it('throws (not crashes) on malformed input', () => {
    const inputs = ['', 'null', '[]', '{}', '{"version":1}', '{"version":1,"parts":[null]}',
      '{"version":1,"parts":[{"id":1,"color":"#000000","cells":[{"x":0,"y":0,"z":0,"kind":"pin"}]}]}',
      '{"version":1,"parts":[{"id":1,"color":"#000000","cells":[]}]}',
      '{"version":1,"parts":[{"id":1,"color":"#000000","cells":[{"x":0,"y":0,"z":0,"kind":"pin","axis":0},{"x":1,"y":0,"z":0,"kind":"pin","axis":1}]}]}',
      '{"version":1,"nextPartId":1,"parts":[{"id":1,"color":"#000000","cells":[{"x":0,"y":0,"z":0,"kind":"pin","axis":0}]}]}'];
    for (const s of inputs) {
      expect(() => deserialize(s)).toThrow();
      try { deserialize(s); } catch (e) { expect((e as Error).name).toBe('ModelFormatError'); }
    }
  });
  it('missing nextPartId is inferred; result validates', () => {
    const m = deserialize('{"version":1,"parts":[{"id":4,"color":"#000000","cells":[{"x":0,"y":0,"z":0,"kind":"pin","axis":0}]}]}');
    expect(m.nextPartId).toBe(5);
    expect(m.rootPartId).toBeNull();
    expect(validateModel(m)).toEqual([]);
  });
});
