import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ModelFormatError,
  WorldIndex,
  addCell,
  addPart,
  canAddCell,
  cellAt,
  cellsAt,
  components,
  deserialize,
  effectiveRootId,
  emptyModel,
  movePart,
  partById,
  posKey,
  removeCell,
  removePart,
  rotateAxis,
  rotatePart,
  rotateVec,
  serialize,
  setPartColor,
  setRoot,
  validateModel,
  worldIndex,
} from '../../src/core/model';
import { AXES, KINDS, connects, isHole, isMale, mateType } from '../../src/core/rules';
import type { Axis, Cell, Kind, Model, Part, Vec3i } from '../../src/core/types';

// ---------------------------------------------------------------------------------------------
// helpers

const C = (x: number, y: number, z: number, kind: Kind, axis: Axis): Cell => ({ x, y, z, kind, axis });

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

/** n-hole liftarm along +X from (x0,y0,z0), holes ∥ Z. */
const beam = (n: number, x0 = 0, y0 = 0, z0 = 0, kind: Kind = 'pinHole'): Cell[] =>
  Array.from({ length: n }, (_, i) => C(x0 + i, y0, z0, kind, 2));

/** Rod of n cells along `axis` starting at p. */
const rod = (n: number, p: Vec3i, axis: Axis, kind: Kind = 'pin'): Cell[] =>
  Array.from({ length: n }, (_, i) =>
    C(p[0] + (axis === 0 ? i : 0), p[1] + (axis === 1 ? i : 0), p[2] + (axis === 2 ? i : 0), kind, axis),
  );

function build(...parts: Cell[][]): Model {
  let m = emptyModel();
  for (const cells of parts) m = addPart(m, cells).model;
  return m;
}

function frozen(...parts: Cell[][]): Model {
  return deepFreeze(build(...parts));
}

const codes = (m: Model) => validateModel(m).map((e) => e.code);

/** Raw model bypassing addPart's checks. */
function raw(parts: { id: number; cells: Cell[]; color?: string }[], extra: Partial<Model> = {}): Model {
  return {
    version: 1,
    parts: parts.map((p) => ({ id: p.id, color: p.color ?? '#808080', cells: p.cells })),
    rootPartId: null,
    nextPartId: Math.max(0, ...parts.map((p) => p.id)) + 1,
    ...extra,
  };
}

const sortedCells = (cells: readonly Cell[]) =>
  [...cells].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z);

// ---------------------------------------------------------------------------------------------

describe('src/core purity', () => {
  it('imports nothing outside src/core', () => {
    const dir = join(__dirname, '../../src/core');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      const specs = [...src.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
      for (const s of specs) expect(s, `${f} imports ${s}`).toMatch(/^\.\/[\w-]+$/);
      expect(src).not.toMatch(/\bimport\s*\(/);
    }
  });
});

describe('basics', () => {
  it('emptyModel', () => {
    expect(emptyModel()).toEqual({ version: 1, parts: [], rootPartId: null, nextPartId: 1 });
    expect(validateModel(emptyModel())).toEqual([]);
  });
  it('posKey / partById / cellAt / cellsAt', () => {
    const m = frozen(beam(3), rod(2, [1, 0, 0], 2));
    expect(posKey(1, -2, 3)).toBe('1,-2,3');
    expect(partById(m, 2)!.cells).toHaveLength(2);
    expect(partById(m, 99)).toBeUndefined();
    expect(cellAt(partById(m, 1)!, [2, 0, 0])).toEqual(C(2, 0, 0, 'pinHole', 2));
    expect(cellAt(partById(m, 1)!, [3, 0, 0])).toBeUndefined();
    expect(cellsAt(m, [1, 0, 0]).map((e) => e.partId).sort()).toEqual([1, 2]);
    expect(cellsAt(m, [9, 9, 9])).toEqual([]);
  });
  it('WorldIndex records part id, cell and index; worldIndex caches by identity', () => {
    const m = frozen(beam(3), rod(2, [1, 0, 0], 2));
    const w = worldIndex(m);
    expect(worldIndex(m)).toBe(w);
    expect(new WorldIndex(m).at([1, 0, 1])).toEqual([{ partId: 2, cell: C(1, 0, 1, 'pin', 2), index: 1 }]);
    expect(w.atXYZ({ x: 0, y: 0, z: 0 })).toHaveLength(1);
  });
  it('effectiveRootId: explicit, null, stale, empty', () => {
    const m = build(beam(1), beam(1, 5), beam(1, 9));
    expect(effectiveRootId(m)).toBe(1);
    expect(effectiveRootId(setRoot(m, 3))).toBe(3);
    expect(effectiveRootId({ ...m, rootPartId: 42 })).toBe(1);
    expect(effectiveRootId(removePart(m, 1))).toBe(2);
    expect(effectiveRootId(emptyModel())).toBeNull();
  });
});

describe('addPart', () => {
  it('assigns increasing ids, default colours by first kind, copies cells', () => {
    const m0 = deepFreeze(emptyModel());
    const cells = beam(2);
    const { model: m1, partId } = addPart(m0, cells);
    expect(partId).toBe(1);
    expect(m1.nextPartId).toBe(2);
    expect(m1.parts[0]!.cells).toEqual(cells);
    expect(m1.parts[0]!.cells[0]).not.toBe(cells[0]);
    const r2 = addPart(m1, rod(2, [9, 0, 0], 0, 'frictionPin'));
    expect(r2.partId).toBe(2);
    expect(r2.model.parts[1]!.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(r2.model.parts[1]!.color).not.toBe(m1.parts[0]!.color);
    expect(addPart(m1, rod(1, [9, 0, 0], 0), '#ABCDEF').model.parts[1]!.color).toBe('#abcdef');
    expect(m0.parts).toEqual([]);
  });
  it('rejects invalid parts and conflicts', () => {
    const m = frozen(beam(3));
    expect(() => addPart(m, [])).toThrow(/no cells/);
    expect(() => addPart(m, [C(5, 0, 0, 'pin', 0), C(5, 0, 0, 'pin', 0)])).toThrow(/two cells at/);
    expect(() => addPart(m, [C(5, 0, 0, 'pin', 0), C(6, 0, 0, 'pin', 2)])).toThrow(/not connected/);
    expect(() => addPart(m, [C(0, 0, 0, 'pinHole', 2)])).toThrow(/two holes/);
    expect(() => addPart(m, rod(2, [0, 0, 0], 0))).toThrow(/not coaxial/);
    expect(() => addPart(m, [C(5, 0, 0, 'bogus' as Kind, 0)])).toThrow(/kind/);
    expect(() => addPart(m, [C(5.5, 0, 0, 'pin', 0)])).toThrow(/integer/);
    expect(() => addPart(m, beam(1, 9), 'red')).toThrow(/colour/);
  });
  it('allows a pin inserted coaxially through holes', () => {
    const m = build(beam(3), rod(2, [0, 0, 0], 2));
    expect(validateModel(m)).toEqual([]);
  });
});

describe('validateModel: every failure mode', () => {
  it('valid example: liftarms joined by a pin, axle through bush + liftarm', () => {
    const m = build(beam(5), beam(5, 0, 0, 1), rod(2, [0, 0, 0], 2), rod(4, [4, 0, -1], 2, 'axle'), [C(4, 0, -1, 'axleHole', 2)]);
    expect(validateModel(m)).toEqual([]);
  });

  it('structure: model not an object, version, parts not array', () => {
    expect(codes(null as unknown as Model)).toEqual(['structure']);
    expect(validateModel({ ...emptyModel(), version: 4 } as unknown as Model)[0]!.message).toMatch(/version/);
    expect(validateModel({ ...emptyModel(), parts: {} } as unknown as Model)[0]!.message).toMatch(/parts: expected an array/);
  });
  it('structure: rootPartId and nextPartId types', () => {
    expect(validateModel({ ...emptyModel(), rootPartId: 'a' } as unknown as Model)[0]!.message).toMatch(/rootPartId/);
    expect(validateModel({ ...emptyModel(), nextPartId: 1.5 } as unknown as Model)[0]!.message).toMatch(/nextPartId/);
  });
  it('structure: part fields', () => {
    const bad = (p: unknown) => validateModel({ ...emptyModel(), nextPartId: 10, parts: [p] } as unknown as Model);
    expect(bad(5)[0]!.message).toMatch(/parts\[0\]: expected an object/);
    expect(bad({ id: -1, color: '#000000', cells: beam(1) })[0]!.message).toMatch(/parts\[0\]\.id/);
    expect(bad({ id: 1, color: '#00000', cells: beam(1) })[0]!.message).toMatch(/parts\[0\]\.color/);
    expect(bad({ id: 1, color: '#000000', cells: 'x' })[0]!.message).toMatch(/parts\[0\]\.cells: expected an array/);
  });
  it('structure: cell fields', () => {
    const bad = (c: unknown) =>
      validateModel({ ...emptyModel(), nextPartId: 10, parts: [{ id: 1, color: '#000000', cells: [c] }] } as unknown as Model);
    expect(bad(null)[0]!.message).toMatch(/cells\[0\]: expected an object/);
    expect(bad({ x: 0.5, y: 0, z: 0, kind: 'pin', axis: 0 })[0]!.message).toMatch(/cells\[0\]: x must be an integer/);
    expect(bad({ x: 0, y: '1', z: 0, kind: 'pin', axis: 0 })[0]!.message).toMatch(/y must be an integer/);
    expect(bad({ x: 0, y: 0, kind: 'pin', axis: 0 })[0]!.message).toMatch(/z must be an integer/);
    expect(bad({ x: 0, y: 0, z: 0, kind: 'gear', axis: 0 })[0]!.message).toMatch(/kind must be one of/);
    expect(bad({ x: 0, y: 0, z: 0, kind: 'pin', axis: 3 })[0]!.message).toMatch(/axis must be 0, 1 or 2/);
  });
  it('duplicatePartId', () => {
    expect(codes(raw([{ id: 1, cells: beam(1) }, { id: 1, cells: beam(1, 5) }]))).toEqual(['duplicatePartId']);
  });
  it('nextPartId must exceed every id', () => {
    expect(codes(raw([{ id: 3, cells: beam(1) }], { nextPartId: 3 }))).toEqual(['nextPartId']);
    expect(codes(raw([{ id: 3, cells: beam(1) }], { nextPartId: 4 }))).toEqual([]);
  });
  it('emptyPart', () => {
    expect(codes(raw([{ id: 1, cells: [] }]))).toEqual(['emptyPart']);
  });
  it('duplicateCell (incl. male + hole of the same part in one cell)', () => {
    expect(codes(raw([{ id: 1, cells: [C(0, 0, 0, 'pinHole', 2), C(0, 0, 0, 'pinHole', 2)] }]))).toEqual(['duplicateCell']);
    const e = validateModel(raw([{ id: 1, cells: [C(0, 0, 0, 'pinHole', 2), C(0, 0, 0, 'pin', 2)] }]));
    expect(e.map((x) => x.code)).toEqual(['duplicateCell']);
    expect(e[0]!.partId).toBe(1);
    expect(e[0]!.pos).toEqual([0, 0, 0]);
  });
  it('disconnected: gap, rod side, rod end on coaxial hole mouth', () => {
    expect(codes(raw([{ id: 1, cells: [C(0, 0, 0, 'pinHole', 2), C(2, 0, 0, 'pinHole', 2)] }]))).toEqual(['disconnected']);
    expect(codes(raw([{ id: 1, cells: [C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pin', 2)] }]))).toEqual(['disconnected']);
    expect(codes(raw([{ id: 1, cells: [C(0, 0, 0, 'pinHole', 2), C(0, 0, 1, 'pin', 2)] }]))).toEqual(['disconnected']);
    expect(validateModel(raw([{ id: 7, cells: [C(0, 0, 0, 'pin', 0), C(0, 1, 0, 'pin', 0), C(5, 0, 0, 'axle', 0)] }]))[0]!.message).toMatch(
      /part 7 is not connected: it falls into 3 pieces/,
    );
  });
  it('overlap: every invalid pairing; every valid mate accepted', () => {
    for (const km of KINDS)
      for (const kh of KINDS)
        for (const am of AXES)
          for (const ah of AXES) {
            const m = raw([
              { id: 1, cells: [C(0, 0, 0, km, am)] },
              { id: 2, cells: [C(0, 0, 0, kh, ah)] },
            ]);
            const male = isMale(km) ? km : isMale(kh) ? kh : null;
            const hole = isHole(km) ? km : isHole(kh) ? kh : null;
            const ok = !!male && !!hole && am === ah && mateType(male, hole) !== null;
            expect(codes(m), `${km}/${am} + ${kh}/${ah}`).toEqual(ok ? [] : ['overlap']);
          }
  });
  it('overlap: three parts in one cell', () => {
    const e = validateModel(
      raw([
        { id: 1, cells: [C(0, 0, 0, 'pinHole', 2)] },
        { id: 2, cells: [C(0, 0, 0, 'pin', 2)] },
        { id: 3, cells: [C(0, 0, 0, 'pinHole', 2)] },
      ]),
    );
    expect(e.map((x) => x.code)).toEqual(['overlap']);
    expect(e[0]!.message).toMatch(/3 parts/);
    expect(e[0]!.pos).toEqual([0, 0, 0]);
  });
  it('reports multiple independent problems', () => {
    const e = codes(
      raw([
        { id: 1, cells: [] },
        { id: 2, cells: [C(0, 0, 0, 'pin', 0), C(0, 0, 1, 'pin', 0)] },
        { id: 3, cells: [C(5, 0, 0, 'pin', 0)] },
        { id: 4, cells: [C(5, 0, 0, 'axleHole', 0)] },
      ]),
    );
    expect(e.sort()).toEqual(['disconnected', 'emptyPart', 'overlap']);
  });
  it('does not mutate or throw on frozen input', () => {
    const m = deepFreeze(raw([{ id: 1, cells: beam(3) }]));
    expect(validateModel(m)).toEqual([]);
  });
});

describe('canAddCell', () => {
  const m = frozen(beam(3), rod(2, [9, 0, 0], 0)); // part 1 beam, part 2 pin along X at (9..10,0,0)
  const reason = (r: ReturnType<typeof canAddCell>) => (r.ok ? 'OK' : r.reason);

  it('extends a liftarm', () => {
    expect(canAddCell(m, 1, C(3, 0, 0, 'pinHole', 2))).toEqual({ ok: true });
    expect(canAddCell(m, 1, C(3, 0, 0, 'axleHole', 0))).toEqual({ ok: true }); // perpendicular connector
    expect(canAddCell(m, 1, C(0, 0, 1, 'pinHole', 2))).toEqual({ ok: true }); // tube
    expect(canAddCell(m, 1, C(0, 1, 0, 'axle', 1))).toEqual({ ok: true }); // rod out of wall
    expect(canAddCell(m, 2, C(11, 0, 0, 'axle', 0))).toEqual({ ok: true }); // axle-pin
  });
  it('rejects malformed cells', () => {
    expect(reason(canAddCell(m, 1, C(3.5, 0, 0, 'pinHole', 2)))).toMatch(/invalid cell: x must be an integer/);
    expect(reason(canAddCell(m, 1, C(3, 0, 0, 'nope' as Kind, 2)))).toMatch(/invalid cell: kind/);
    expect(reason(canAddCell(m, 1, { ...C(3, 0, 0, 'pin', 0), axis: 5 as Axis }))).toMatch(/invalid cell: axis/);
  });
  it('rejects a missing part', () => {
    expect(reason(canAddCell(m, 42, C(3, 0, 0, 'pinHole', 2)))).toMatch(/no part with id 42/);
  });
  it('rejects a position already used by the part (incl. same-part male in own hole)', () => {
    expect(reason(canAddCell(m, 1, C(1, 0, 0, 'pinHole', 2)))).toMatch(/part 1 already has a cell at \(1, 0, 0\)/);
    expect(reason(canAddCell(m, 1, C(1, 0, 0, 'pin', 2)))).toMatch(/already has a cell/);
  });
  it('rejects non-adjacent and non-connecting placements', () => {
    expect(reason(canAddCell(m, 1, C(5, 0, 0, 'pinHole', 2)))).toMatch(/not adjacent to part 1/);
    expect(reason(canAddCell(m, 1, C(0, 0, 1, 'pin', 2)))).toMatch(/would not attach to part 1/); // end on ring
    expect(reason(canAddCell(m, 1, C(3, 0, 0, 'pin', 2)))).toMatch(/would not attach/); // side on wall
    expect(reason(canAddCell(m, 2, C(9, 1, 0, 'pinHole', 2)))).toMatch(/would not attach/); // hole on rod side
    expect(reason(canAddCell(m, 2, C(11, 0, 0, 'pin', 2)))).toMatch(/would not attach/); // perpendicular rod
    // …and says why
    expect(reason(canAddCell(m, 1, C(0, 0, 1, 'pin', 2)))).toMatch(/\(a rod’s end on the mouth of a coaxial hole does not hold\)$/);
    expect(reason(canAddCell(m, 1, C(3, 0, 0, 'pin', 2)))).toMatch(/\(a rod’s side holds nothing\)$/);
    expect(reason(canAddCell(m, 2, C(9, 1, 0, 'pinHole', 2)))).toMatch(/\(a rod’s side holds nothing\)$/);
    expect(reason(canAddCell(m, 2, C(11, 0, 0, 'pin', 2)))).toMatch(/\(a rod’s side holds nothing\)$/);
  });
  it('world occupancy: compatible mates allowed, others rejected with reason', () => {
    // new part (null): pin inserted into the beam's hole
    expect(canAddCell(m, null, C(0, 0, 0, 'pin', 2))).toEqual({ ok: true });
    expect(canAddCell(m, null, C(0, 0, 0, 'axle', 2))).toEqual({ ok: true });
    expect(canAddCell(m, null, C(5, 5, 5, 'axle', 2))).toEqual({ ok: true });
    expect(reason(canAddCell(m, null, C(0, 0, 0, 'pin', 0)))).toMatch(/not coaxial/);
    expect(reason(canAddCell(m, null, C(0, 0, 0, 'pinHole', 2)))).toMatch(/two holes.*part 1 has a pin hole there/);
    // sleeve: a hole slid onto the pin
    expect(canAddCell(m, null, C(9, 0, 0, 'pinHole', 0))).toEqual({ ok: true });
    expect(reason(canAddCell(m, null, C(9, 0, 0, 'axleHole', 0)))).toMatch(/does not fit/);
    expect(reason(canAddCell(m, null, C(9, 0, 0, 'axle', 0)))).toMatch(/two pins\/axles/);
    // extension of an existing part into another part's cell
    expect(canAddCell(m, 2, C(8, 0, 0, 'pin', 0))).toEqual({ ok: true });
  });
  it('rejects a third part in a mated cell', () => {
    const m2 = frozen(beam(3), rod(2, [0, 0, 0], 2));
    expect(reason(canAddCell(m2, null, C(0, 0, 0, 'pinHole', 2)))).toMatch(/already shared by two parts/);
    expect(reason(canAddCell(m2, null, C(0, 0, 1, 'pinHole', 2)))).toBe('OK');
  });
});

describe('addCell', () => {
  it('adds when allowed, throws the reason otherwise, never mutates', () => {
    const m = frozen(beam(2));
    const m2 = addCell(m, 1, C(2, 0, 0, 'pinHole', 2));
    expect(partById(m2, 1)!.cells).toHaveLength(3);
    expect(partById(m, 1)!.cells).toHaveLength(2);
    expect(validateModel(m2)).toEqual([]);
    expect(() => addCell(m, 1, C(5, 0, 0, 'pinHole', 2))).toThrow(/not adjacent/);
    expect(() => addCell(m, 3, C(2, 0, 0, 'pinHole', 2))).toThrow(/no part/);
  });
  it('keeps other parts by identity (structural sharing)', () => {
    const m = frozen(beam(2), beam(2, 5));
    const m2 = addCell(m, 1, C(2, 0, 0, 'pinHole', 2));
    expect(m2.parts[1]).toBe(m.parts[1]);
  });
});

describe('removeCell', () => {
  it('removes a cell without splitting', () => {
    const m = frozen(beam(3));
    const m2 = removeCell(m, 1, [2, 0, 0]);
    expect(partById(m2, 1)!.cells).toEqual(beam(2));
    expect(m2.nextPartId).toBe(m.nextPartId);
  });
  it('removing the last cell removes the part', () => {
    const m = frozen(beam(1), beam(1, 5));
    const m2 = removeCell(m, 1, [0, 0, 0]);
    expect(m2.parts.map((p) => p.id)).toEqual([2]);
  });
  it('splits: largest piece keeps the id, others get fresh ids after it, same colour', () => {
    const m = deepFreeze(addPart(build(beam(1, 20)), beam(5), '#123456').model); // part 1 elsewhere, part 2 = 5-beam
    const m2 = removeCell(m, 2, [1, 0, 0]); // pieces: [0] and [2,3,4]
    expect(m2.parts.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(sortedCells(partById(m2, 2)!.cells)).toEqual(beam(3, 2));
    expect(partById(m2, 3)!.cells).toEqual(beam(1, 0));
    expect(partById(m2, 3)!.color).toBe('#123456');
    expect(m2.nextPartId).toBe(4);
    expect(validateModel(m2)).toEqual([]);
  });
  it('ties: the piece containing the earliest remaining cell keeps the id', () => {
    const m = frozen(beam(5));
    const m2 = removeCell(m, 1, [2, 0, 0]);
    expect(partById(m2, 1)!.cells).toEqual(beam(2, 0));
    expect(partById(m2, 2)!.cells).toEqual(beam(2, 3));
  });
  it('three-way split of a plus shape; ids ordered by size then earliest cell', () => {
    // centre (0,0,0); arms: +X length 1, -X length 2, +Y length 3 (holes ∥ Z)
    const cells = [
      C(0, 0, 0, 'pinHole', 2),
      C(1, 0, 0, 'pinHole', 2),
      C(-1, 0, 0, 'pinHole', 2),
      C(-2, 0, 0, 'pinHole', 2),
      C(0, 1, 0, 'pinHole', 2),
      C(0, 2, 0, 'pinHole', 2),
      C(0, 3, 0, 'pinHole', 2),
    ];
    const m = frozen(cells);
    const m2 = removeCell(m, 1, [0, 0, 0]);
    expect(m2.parts.map((p) => [p.id, p.cells.length])).toEqual([
      [1, 3],
      [2, 2],
      [3, 1],
    ]);
    expect(sortedCells(partById(m2, 1)!.cells).map((c) => c.y)).toEqual([1, 2, 3]);
    expect(validateModel(m2)).toEqual([]);
  });
  it('splits along connection rules, not mere adjacency', () => {
    // Two pins ∥Y standing on a 2-hole beam are side-by-side (adjacent, not connected).
    // Removing the hole under the first pin leaves it touching the other pin only by its side → split.
    const cells = [C(0, 1, 0, 'pin', 1), C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2), C(1, 1, 0, 'pin', 1)];
    const m = frozen(cells);
    expect(validateModel(m)).toEqual([]);
    const m2 = removeCell(m, 1, [0, 0, 0]);
    expect(m2.parts.map((p) => [p.id, p.cells])).toEqual([
      [1, [C(1, 0, 0, 'pinHole', 2), C(1, 1, 0, 'pin', 1)]],
      [2, [C(0, 1, 0, 'pin', 1)]],
    ]);
    expect(validateModel(m2)).toEqual([]);
  });
  it('root follows the piece that keeps the id', () => {
    const m = deepFreeze(setRoot(build(beam(1, 20), beam(5)), 2));
    const m2 = removeCell(m, 2, [1, 0, 0]);
    expect(m2.rootPartId).toBe(2);
    expect(partById(m2, 2)!.cells).toHaveLength(3);
    // root elsewhere is untouched
    const m3 = removeCell(setRoot(m, 1), 2, [1, 0, 0]);
    expect(m3.rootPartId).toBe(1);
  });
  it('removing the whole root part clears rootPartId', () => {
    const m = deepFreeze(setRoot(build(beam(1), beam(1, 5)), 2));
    const m2 = removeCell(m, 2, [5, 0, 0]);
    expect(m2.rootPartId).toBeNull();
    expect(effectiveRootId(m2)).toBe(1);
  });
  it('throws for a missing part or cell', () => {
    const m = frozen(beam(2));
    expect(() => removeCell(m, 9, [0, 0, 0])).toThrow(/no part/);
    expect(() => removeCell(m, 1, [7, 0, 0])).toThrow(/no cell/);
  });
});

describe('removePart', () => {
  it('removes only that part', () => {
    const m = frozen(beam(2), beam(2, 5));
    const m2 = removePart(m, 1);
    expect(m2.parts).toEqual([m.parts[1]]);
    expect(m2.nextPartId).toBe(3);
    expect(() => removePart(m, 7)).toThrow(/no part/);
  });
});

describe('components', () => {
  it('orders components by lowest index, indices ascending', () => {
    const cells = [C(5, 0, 0, 'pin', 0), C(0, 0, 0, 'pinHole', 2), C(6, 0, 0, 'pin', 0), C(1, 0, 0, 'pinHole', 2)];
    expect(components(cells)).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });
});

describe('movePart', () => {
  it('translates a part', () => {
    const m = frozen(beam(3), beam(1, 9));
    const m2 = movePart(m, 1, [0, 2, -1])!;
    expect(partById(m2, 1)!.cells).toEqual(beam(3, 0, 2, -1));
    expect(m2.parts[1]).toBe(m.parts[1]);
    expect(validateModel(m2)).toEqual([]);
  });
  it('zero delta returns the same model', () => {
    const m = frozen(beam(3));
    expect(movePart(m, 1, [0, 0, 0])).toBe(m);
  });
  it('moving a beam onto a coaxial pin is a valid mate', () => {
    const m = frozen(beam(3), rod(2, [0, 0, 5], 2));
    const m2 = movePart(m, 1, [0, 0, 5]);
    expect(m2).not.toBeNull();
    expect(validateModel(m2!)).toEqual([]);
  });
  it('mate vs conflict', () => {
    const m = frozen(beam(3), rod(2, [0, 0, 5], 2), beam(2, 10));
    // pin moved into the beam's hole: valid
    const m2 = movePart(m, 2, [0, 0, -5])!;
    expect(m2).not.toBeNull();
    expect(validateModel(m2)).toEqual([]);
    // beam moved onto the other beam: two holes
    expect(movePart(m, 3, [-10, 0, 0])).toBeNull();
    // beam moved so a hole overlaps nothing: fine
    expect(movePart(m, 3, [0, 1, 0])).not.toBeNull();
  });
  it('throws on missing part or non-integer delta', () => {
    const m = frozen(beam(3));
    expect(() => movePart(m, 2, [1, 0, 0])).toThrow(/no part/);
    expect(() => movePart(m, 1, [0.5, 0, 0])).toThrow(/integers/);
  });
});

describe('rotation helpers', () => {
  it('rotateVec follows the right-hand rule', () => {
    expect(rotateVec([0, 1, 0], 0, 1)).toEqual([0, 0, 1]); // about X: Y → Z
    expect(rotateVec([0, 0, 1], 1, 1)).toEqual([1, 0, 0]); // about Y: Z → X
    expect(rotateVec([1, 0, 0], 2, 1)).toEqual([0, 1, 0]); // about Z: X → Y
    expect(rotateVec([1, 2, 3], 1, 4)).toEqual([1, 2, 3]);
    expect(rotateVec([1, 2, 3], 2, -1)).toEqual(rotateVec([1, 2, 3], 2, 3));
    expect(rotateVec([1, 2, 3], 0, 2)).toEqual([1, -2, -3]);
    for (const v of rotateVec([0, 0, 0], 0, 1)) expect(Object.is(v, -0)).toBe(false);
  });
  it('rotateAxis swaps the two perpendicular axes on odd turns', () => {
    expect(rotateAxis(0, 1, 1)).toBe(2);
    expect(rotateAxis(2, 1, 1)).toBe(0);
    expect(rotateAxis(1, 1, 1)).toBe(1);
    expect(rotateAxis(0, 2, 2)).toBe(0);
    expect(rotateAxis(1, 0, -1)).toBe(2);
  });
});

describe('rotatePart', () => {
  it('rotates positions and cell axes; pivot cell stays put', () => {
    // beam along +X, holes ∥ Z, plus a pin sticking out along +Y from the first hole
    const m = frozen([...beam(3), C(0, 1, 0, 'pin', 1)]);
    const m2 = rotatePart(m, 1, 1, 1, [0, 0, 0])!; // 90° about Y: X → −Z, Z → X
    expect(sortedCells(partById(m2, 1)!.cells)).toEqual(
      sortedCells([C(0, 0, 0, 'pinHole', 0), C(0, 0, -1, 'pinHole', 0), C(0, 0, -2, 'pinHole', 0), C(0, 1, 0, 'pin', 1)]),
    );
    expect(validateModel(m2)).toEqual([]);
  });
  it('rotation about another pivot; pivot cell stays put', () => {
    const m = frozen(beam(3));
    const m2 = rotatePart(m, 1, 2, 1, [2, 0, 0])!; // 90° about Z through (2,0,0): beam becomes vertical
    expect(sortedCells(partById(m2, 1)!.cells)).toEqual(sortedCells([C(2, 0, 0, 'pinHole', 2), C(2, -1, 0, 'pinHole', 2), C(2, -2, 0, 'pinHole', 2)]));
  });
  it('4 turns and 0 turns are identity; -1 ≡ 3', () => {
    const m = frozen([...beam(3), C(1, 1, 0, 'axle', 1)]);
    expect(rotatePart(m, 1, 0, 0, [0, 0, 0])).toBe(m);
    expect(rotatePart(m, 1, 0, 4, [0, 0, 0])).toBe(m);
    expect(rotatePart(m, 1, 0, -1, [1, 0, 0])).toEqual(rotatePart(m, 1, 0, 3, [1, 0, 0]));
    let r: Model = m;
    for (let i = 0; i < 4; i++) r = rotatePart(r, 1, 2, 1, [1, 0, 0])!;
    expect(r).toEqual(m);
  });
  it('preserves validity for every axis/turn of a mixed part', () => {
    const cells = [...beam(3), C(0, 1, 0, 'axle', 1), C(0, 2, 0, 'pin', 1), C(2, 0, 1, 'axleHole', 2), C(3, 0, 0, 'axleHole', 1)];
    const m = frozen(cells);
    expect(validateModel(m)).toEqual([]);
    for (const ax of AXES)
      for (let k = 1; k < 4; k++) {
        const m2 = rotatePart(m, 1, ax, k, [1, 0, 0])!;
        expect(validateModel(m2)).toEqual([]);
        // connections are preserved one-to-one
        const before = cells.flatMap((a, i) => cells.map((b, j) => (i < j && connects(a, b) ? 1 : 0))).reduce<number>((s, v) => s + v, 0);
        const rc = partById(m2, 1)!.cells;
        const after = rc.flatMap((a, i) => rc.map((b, j) => (i < j && connects(a, b) ? 1 : 0))).reduce<number>((s, v) => s + v, 0);
        expect(after).toBe(before);
        expect(cellAt(partById(m2, 1)!, [1, 0, 0])).toBeDefined(); // pivot cell kept
      }
  });
  it('returns null when the rotated part collides; mates still allowed', () => {
    // beam along X at y=0; another beam at (0,1..2,0) vertical
    const m = frozen(beam(3), [C(0, 1, 0, 'pinHole', 2), C(0, 2, 0, 'pinHole', 2)]);
    expect(rotatePart(m, 1, 2, 1, [0, 0, 0])).toBeNull(); // swings up into part 2
    expect(rotatePart(m, 1, 2, -1, [0, 0, 0])).not.toBeNull(); // swings down, free
    // pin ∥X at (0..1,0,1) rotated about Y through (0,0,1) becomes ∥Z at (0,0,0..1): pushed into the hole
    const m3 = frozen(beam(3), rod(2, [0, 0, 1], 0));
    const m4 = rotatePart(m3, 2, 1, 1, [0, 0, 1])!;
    expect(sortedCells(partById(m4, 2)!.cells)).toEqual([C(0, 0, 0, 'pin', 2), C(0, 0, 1, 'pin', 2)]);
    expect(validateModel(m4)).toEqual([]);
  });
  it('throws on bad arguments', () => {
    const m = frozen(beam(2));
    expect(() => rotatePart(m, 9, 0, 1, [0, 0, 0])).toThrow(/no part/);
    expect(() => rotatePart(m, 1, 3 as Axis, 1, [0, 0, 0])).toThrow(/axis/);
    expect(() => rotatePart(m, 1, 0, 1.5, [0, 0, 0])).toThrow(/quarterTurns/);
    expect(() => rotatePart(m, 1, 0, 1, [0.5, 0, 0])).toThrow(/pivot/);
  });
});

describe('setPartColor / setRoot', () => {
  it('setPartColor normalises and validates', () => {
    const m = frozen(beam(2), beam(1, 9));
    const m2 = setPartColor(m, 1, '#FF0000');
    expect(partById(m2, 1)!.color).toBe('#ff0000');
    expect(m2.parts[1]).toBe(m.parts[1]);
    expect(setPartColor(m2, 1, '#ff0000')).toBe(m2);
    expect(() => setPartColor(m, 1, 'red')).toThrow(/colour/);
    expect(() => setPartColor(m, 5, '#000000')).toThrow(/no part/);
  });
  it('setRoot', () => {
    const m = frozen(beam(2), beam(1, 9));
    expect(setRoot(m, 2).rootPartId).toBe(2);
    expect(setRoot(setRoot(m, 2), null).rootPartId).toBeNull();
    expect(setRoot(m, null)).toBe(m);
    expect(() => setRoot(m, 5)).toThrow(/no part/);
  });
});

describe('serialize / deserialize', () => {
  const sample = (): Model =>
    setRoot(
      build(beam(5), beam(5, 0, 0, 1), rod(2, [0, 0, 0], 2), rod(4, [4, 0, -1], 2, 'axle'), [C(4, 0, -1, 'axleHole', 2)], [C(-3, -2, 7, 'frictionPin', 0)]),
      3,
    );

  it('round-trips exactly and deterministically', () => {
    const m = deepFreeze(sample());
    const s = serialize(m);
    expect(deserialize(s)).toEqual(m);
    expect(serialize(deserialize(s))).toBe(s);
    expect(JSON.parse(s)).toEqual(m);
    expect(deserialize(serialize(emptyModel()))).toEqual(emptyModel());
  });
  it('drops unknown fields; tolerates missing rootPartId/nextPartId', () => {
    const o = JSON.parse(serialize(sample()));
    o.extra = 1;
    o.parts[0].junk = true;
    o.parts[0].cells[0].foo = 'bar';
    delete o.rootPartId;
    delete o.nextPartId;
    const m = deserialize(JSON.stringify(o));
    expect(m.rootPartId).toBeNull();
    expect(m.nextPartId).toBe(7);
    expect(Object.keys(m).sort()).toEqual(['nextPartId', 'parts', 'rootPartId', 'version']);
    expect(Object.keys(m.parts[0]!).sort()).toEqual(['cells', 'color', 'id']);
    expect(Object.keys(m.parts[0]!.cells[0]!).sort()).toEqual(['axis', 'kind', 'x', 'y', 'z']);
  });

  const rejects = (json: string, re: RegExp) => {
    let err: unknown;
    try {
      deserialize(json);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ModelFormatError);
    expect((err as Error).message).toMatch(re);
    expect((err as ModelFormatError).errors.length).toBeGreaterThan(0);
  };
  it('rejects garbage with useful messages', () => {
    rejects('', /invalid JSON/);
    rejects('{"version":1,', /invalid JSON/);
    rejects('[]', /expected a JSON object/);
    rejects('42', /expected a JSON object/);
    rejects('null', /expected a JSON object/);
    rejects('{"parts":[]}', /unsupported version undefined/);
    rejects('{"version":4,"parts":[]}', /unsupported version 4 \(expected 1, 2 or 3\)/);
    rejects('{"version":1}', /parts: expected an array/);
    rejects('{"version":1,"parts":[{"id":1,"color":"#000000","cells":[{"x":0,"y":0,"z":0,"kind":"gear","axis":0}]}]}', /parts\[0\]\.cells\[0\]: kind must be one of/);
    rejects('{"version":1,"parts":[{"id":1,"color":"#000000","cells":[{"x":0,"y":0,"z":0,"kind":"pin","axis":"x"}]}]}', /axis must be 0, 1 or 2/);
    rejects('{"version":1,"parts":[{"id":1,"color":"blue","cells":[]}]}', /parts\[0\]\.color/);
  });
  it('rejects semantically invalid models with the validation messages', () => {
    const disconnected = raw([{ id: 4, cells: [C(0, 0, 0, 'pinHole', 2), C(3, 0, 0, 'pinHole', 2)] }]);
    rejects(JSON.stringify(disconnected), /part 4 is not connected/);
    const clash = raw([
      { id: 1, cells: [C(0, 0, 0, 'pin', 2)] },
      { id: 2, cells: [C(0, 0, 0, 'axleHole', 2)] },
    ]);
    rejects(JSON.stringify(clash), /\(0, 0, 0\): parts 1 and 2 overlap invalidly: pin does not fit/);
    rejects(JSON.stringify({ ...raw([{ id: 5, cells: beam(1) }]), nextPartId: 2 }), /nextPartId 2 must be greater/);
  });
  it('lists at most 10 problems with a count', () => {
    const parts = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, color: '#000000', cells: [] as Cell[] }));
    let msg = '';
    try {
      deserialize(JSON.stringify({ version: 1, parts, rootPartId: null, nextPartId: 99 }));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/15 problems/);
    expect(msg).toMatch(/and 5 more/);
  });
});

describe('immutability across all operations', () => {
  it('no operation mutates a deep-frozen model', () => {
    const m = frozen(beam(5), rod(2, [0, 0, 0], 2), beam(1, 9));
    const snapshot = JSON.stringify(m);
    addCell(m, 1, C(5, 0, 0, 'pinHole', 2));
    addPart(m, beam(1, 20));
    removeCell(m, 1, [2, 0, 0]);
    removePart(m, 2);
    movePart(m, 3, [0, 1, 0]);
    rotatePart(m, 1, 1, 1, [0, 0, 0]);
    setPartColor(m, 1, '#000000');
    setRoot(m, 2);
    serialize(m);
    validateModel(m);
    canAddCell(m, 1, C(5, 0, 0, 'pinHole', 2));
    expect(JSON.stringify(m)).toBe(snapshot);
  });
});

// typecheck-only use of Part to keep the import meaningful
const _p: Part | undefined = undefined;
void _p;
