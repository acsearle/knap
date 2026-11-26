// Wheels, ground and a free root in the core (DESIGN.md §2.4–§2.6, §3.1 step 4).
import { describe, expect, it } from 'vitest';
import {
  ModelFormatError,
  RIM_MAX,
  RIM_MIN,
  RIM_STEP,
  WorldIndex,
  addCell,
  addPart,
  canAddCell,
  canRemoveCell,
  canSetRim,
  cellAt,
  components,
  copyCell,
  deserialize,
  emptyModel,
  groundLevel,
  makeCell,
  movePart,
  partById,
  removeCell,
  removePart,
  rootIsFixed,
  rotatePart,
  serialize,
  setFixRoot,
  setGround,
  setRim,
  setRoot,
  validateModel,
  wheelsAt,
  worldIndex,
} from '../../src/core/model';
import { analyze } from '../../src/core/kinematics';
import { EXAMPLES } from '../../src/core/examples';
import { isHole } from '../../src/core/rules';
import type { Axis, Cell, Kind, Model, Part, Vec3i } from '../../src/core/types';

// ---------------------------------------------------------------------------------------------
// helpers

const C = (x: number, y: number, z: number, kind: Kind, axis: Axis, rim?: number): Cell => makeCell(x, y, z, kind, axis, rim);
/** Hole hub (pin hole, axis Z by default) with a rim. */
const W = (x: number, y: number, z: number, rim: number, axis: Axis = 2, kind: Kind = 'pinHole'): Cell => C(x, y, z, kind, axis, rim);
/** n-hole liftarm along +X from (x0,y0,z0), holes ∥ Z. */
const beam = (n: number, x0 = 0, y0 = 0, z0 = 0): Cell[] => Array.from({ length: n }, (_, i) => C(x0 + i, y0, z0, 'pinHole', 2));
/** Rod of n cells along `axis` starting at p. */
const rod = (n: number, p: Vec3i, axis: Axis, kind: Kind = 'pin'): Cell[] =>
  Array.from({ length: n }, (_, i) => C(p[0] + (axis === 0 ? i : 0), p[1] + (axis === 1 ? i : 0), p[2] + (axis === 2 ? i : 0), kind, axis));

function build(...parts: Cell[][]): Model {
  let m = emptyModel();
  for (const cells of parts) m = addPart(m, cells).model;
  return m;
}
const ok = { ok: true };
const reason = (r: { ok: boolean; reason?: string }) => (r.ok ? 'ok' : r.reason!);
const codes = (m: Model) => validateModel(m).map((e) => e.code);
const ids = (m: Model) => m.parts.map((p) => p.id);
/** Raw v2 model bypassing all checks. */
function raw(parts: { id: number; cells: Cell[] }[], extra: Partial<Model> = {}): Model {
  return {
    version: 2,
    parts: parts.map((p) => ({ id: p.id, color: '#808080', cells: p.cells })),
    rootPartId: null,
    nextPartId: Math.max(0, ...parts.map((p) => p.id)) + 1,
    ...extra,
  };
}

// ---------------------------------------------------------------------------------------------

describe('constants and types', () => {
  it('RIM_MIN / RIM_MAX / RIM_STEP', () => {
    expect([RIM_MIN, RIM_MAX, RIM_STEP]).toEqual([1, 4, 0.5]);
  });
  it('makeCell omits an undefined rim; copyCell keeps a rim', () => {
    expect(Object.keys(makeCell(0, 0, 0, 'pinHole', 2))).toEqual(['x', 'y', 'z', 'kind', 'axis']);
    expect(makeCell(0, 0, 0, 'pinHole', 2, undefined)).toEqual({ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2 });
    expect(copyCell(W(1, 2, 3, 2.5))).toEqual({ x: 1, y: 2, z: 3, kind: 'pinHole', axis: 2, rim: 2.5 });
  });
});

describe('version, serialisation, deserialisation (§2.4)', () => {
  it('a model using none of the v2 features stays version 1 and serialises as before', () => {
    const m = build(beam(3));
    expect(m.version).toBe(1);
    const s = serialize(m);
    expect(s).not.toMatch(/rim|ground|fixRoot/);
    expect(s).toMatch(/"version": 1,/);
    expect(deserialize(s)).toEqual(m);
  });
  it('setRim, setGround, setFixRoot(false), addPart/addCell with a rim make it version 2', () => {
    const m = build(beam(3));
    expect(setRim(m, 1, [0, 0, 0], 1).version).toBe(2);
    expect(setGround(m, true).version).toBe(2);
    expect(setFixRoot(m, false).version).toBe(2);
    expect(addPart(m, [W(9, 0, 0, 1)]).model.version).toBe(2);
    expect(addCell(m, 1, W(3, 0, 0, 1)).version).toBe(2);
    // no-ops leave it alone
    expect(setGround(m, false)).toBe(m);
    expect(setFixRoot(m, true)).toBe(m);
    expect(setRim(m, 1, [0, 0, 0], undefined)).toBe(m);
  });
  it('turning a feature off removes its field but keeps version 2 ("otherwise left alone")', () => {
    let m = setGround(setFixRoot(build(beam(3)), false), true);
    expect(m).toMatchObject({ version: 2, ground: true, fixRoot: false });
    m = setFixRoot(setGround(m, false), true);
    expect('ground' in m).toBe(false);
    expect('fixRoot' in m).toBe(false);
    expect(m.version).toBe(2);
    expect(validateModel(m)).toEqual([]);
    const r = setRim(setRim(build(beam(3)), 1, [0, 0, 0], 2), 1, [0, 0, 0], undefined);
    expect('rim' in r.parts[0]!.cells[0]!).toBe(false);
    expect(r.version).toBe(2);
  });
  it('round-trips rims, ground and fixRoot; writes them only when present', () => {
    let m = build(beam(3), [W(0, 5, 0, 2.5, 0, 'axleHole')]);
    m = setGround(setFixRoot(m, false), true);
    const s = serialize(m);
    expect(s).toMatch(/"version": 2,/);
    expect(s).toMatch(/\n {2}"ground": true,\n {2}"fixRoot": false,\n {2}"parts"/);
    expect(s).toMatch(/\{"x":0,"y":5,"z":0,"kind":"axleHole","axis":0,"rim":2.5\}/);
    expect(s.match(/"rim"/g)).toHaveLength(1);
    const back = deserialize(s);
    expect(back).toEqual(m);
    expect(serialize(back)).toBe(s);
  });
  const rejects = (json: string, re: RegExp) => {
    let err: unknown;
    try {
      deserialize(json);
    } catch (e) {
      err = e;
    }
    expect(err, json).toBeInstanceOf(ModelFormatError);
    expect((err as Error).message).toMatch(re);
  };
  const file = (cell: string, extra = '', version = 2) =>
    `{"version":${version},${extra}"parts":[{"id":1,"color":"#000000","cells":[${cell}]}]}`;
  it('rejects invalid rims, ground and fixRoot with useful messages (never drops them)', () => {
    const hole = (rim: string) => `{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2,"rim":${rim}}`;
    rejects(file(hole('0.75')), /cells\[0\] at \(0, 0, 0\): rim must be a multiple of ½ from 1 to 4 \(got 0.75\)/);
    rejects(file(hole('4.5')), /rim must be a multiple of ½ from 1 to 4 \(got 4.5\)/);
    rejects(file(hole('0.5')), /got 0.5/);
    rejects(file(hole('0')), /got 0/);
    rejects(file(hole('"2"')), /got "2"/);
    rejects(file(hole('null')), /got null/);
    rejects(file(`{"x":0,"y":0,"z":0,"kind":"pin","axis":2,"rim":2}`), /a pin cannot carry a rim: wheels grow from pin holes and axle holes/);
    rejects(file(hole('2'), '', 1), /a model with wheels \(rim\), ground or fixRoot must be version 2/);
    rejects(file(`{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2}`, '"ground":true,', 1), /must be version 2/);
    rejects(file(`{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2}`, '"fixRoot":false,', 1), /must be version 2/);
    rejects(file(`{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2}`, '"ground":"yes",'), /ground: expected true or false \(got "yes"\)/);
    rejects(file(`{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2}`, '"fixRoot":0,'), /fixRoot: expected true or false \(got 0\)/);
    rejects(file(`{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2}`, '"ground":null,'), /ground: expected true or false/);
    rejects('{"version":3,"parts":[]}', /unsupported version 3 \(expected 1 or 2\)/);
  });
  it('rejects a file whose wheel overlaps another part', () => {
    const json = JSON.stringify(raw([{ id: 1, cells: [W(0, 0, 0, 1.5)] }, { id: 2, cells: beam(2, 1) }]));
    rejects(json, /\(1, 0, 0\): the pin hole of part 2 is inside the wheel of part 1 \(hub \(0, 0, 0\), radius 1.5\)/);
  });
  it('accepts a version-2 file without any v2 feature, and ground false / fixRoot true explicitly', () => {
    expect(deserialize(file(`{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2}`)).version).toBe(2);
    const m = deserialize(file(`{"x":0,"y":0,"z":0,"kind":"pinHole","axis":2}`, '"ground":false,"fixRoot":true,'));
    expect(m).toMatchObject({ ground: false, fixRoot: true });
    expect(rootIsFixed(m)).toBe(true);
    expect(groundLevel(m)).toBeNull();
  });
  it('validateModel: rim codes and positions', () => {
    const bad = raw([{ id: 1, cells: [C(0, 0, 0, 'axle', 2, 2)] }]);
    expect(validateModel(bad)).toEqual([
      { code: 'rim', message: 'parts[0].cells[0] at (0, 0, 0): a axle cannot carry a rim: wheels grow from pin holes and axle holes', pos: [0, 0, 0], partId: 1 },
    ]);
    expect(codes(raw([{ id: 1, cells: [W(0, 0, 0, 1.25)] }]))).toEqual(['rim']);
    expect(codes(raw([{ id: 1, cells: [W(0, 0, 0, 2)] }], { version: 1 }))).toEqual(['structure']);
  });
});

describe('rim error message (review nit)', () => {
  it('a non-finite rim is named as such, not "null"', () => {
    const text = JSON.stringify({ version: 2, rootPartId: 1, nextPartId: 2, parts: [{ id: 1, color: '#888888', cells: [{ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2, rim: 1 }] }] }).replace('"rim":1', '"rim":1e400');
    expect(() => deserialize(text)).toThrow(/got Infinity/);
  });
});

describe('rule 1: connection through a disc', () => {
  it('a crank hole at (1,1) of an r 2.5 wheel belongs to the wheel without a bridge', () => {
    const m = build([W(0, 0, 0, 2.5), C(1, 1, 0, 'pinHole', 2)]);
    expect(validateModel(m)).toEqual([]);
    expect(() => build([C(0, 0, 0, 'pinHole', 2), C(1, 1, 0, 'pinHole', 2)])).toThrow(/not connected/);
    expect(components([W(0, 0, 0, 2.5), C(1, 1, 0, 'pinHole', 2)])).toEqual([[0, 1]]);
  });
  it('canAddCell accepts a crank hole anywhere the disc overlaps, and nowhere it only touches', () => {
    const m = build([W(0, 0, 0, 2.5)]);
    expect(canAddCell(m, 1, C(1, 1, 0, 'pinHole', 2))).toEqual(ok);
    expect(canAddCell(m, 1, C(2, 2, 0, 'pinHole', 2))).toEqual(ok);
    expect(canAddCell(m, 1, C(-2, 1, 0, 'axleHole', 2))).toEqual(ok);
    expect(canAddCell(m, 1, C(1, 1, 0, 'pin', 2))).toEqual(ok); // fused into the wheel face (any cell)
    expect(reason(canAddCell(m, 1, C(3, 0, 0, 'pinHole', 2)))).toMatch(/not adjacent to part 1/); // touch only
    expect(reason(canAddCell(m, 1, C(1, 1, 1, 'pinHole', 2)))).toMatch(/not adjacent/); // other layer
  });
  it('a new cell carrying a rim may connect through its own disc', () => {
    const m = build(beam(1));
    expect(canAddCell(m, 1, W(1, 1, 0, 1))).toEqual(ok);
    expect(reason(canAddCell(m, 1, W(2, 2, 0, 1)))).toMatch(/not adjacent/);
    // from (2,2) the cell (0,0) has near² = 2·1.5² = 4.5: r 2 (4) does not reach it, r 2.5 (6.25) does
    expect(reason(canAddCell(m, 1, W(2, 2, 0, 2)))).toMatch(/not adjacent/);
    expect(canAddCell(m, 1, W(2, 2, 0, 2.5))).toEqual(ok);
  });
  it('two rims of one part whose discs overlap connect their hubs (fused)', () => {
    const cells = [W(0, 0, 0, 1.5), W(2, 2, 0, 1.5)]; // distance 2.83 < 3, neither disc reaches the other hub cell
    expect(components(cells)).toEqual([[0, 1]]);
    expect(validateModel(raw([{ id: 1, cells }]))).toEqual([]);
    expect(components([W(0, 0, 0, 1), W(2, 2, 0, 1)])).toEqual([[0], [1]]);
  });
  it('the crank hole at (1,1) stays down to r 1 and splits off when the rim is removed; (2,1) splits at r 1.5', () => {
    let m = build([W(0, 0, 0, 2.5), C(1, 1, 0, 'pinHole', 2), C(2, 1, 0, 'pinHole', 2)]);
    m = setRoot(m, 1);
    const shrunk = setRim(m, 1, [0, 0, 0], 2);
    expect(ids(shrunk)).toEqual([1]);
    // r 1.5: (1,1) still overlapped (near² ½ < 2.25); (2,1) is face-joined to (1,1) so still one part
    expect(ids(setRim(m, 1, [0, 0, 0], 1.5))).toEqual([1]);
    // without the (1,1) bridge, (2,1) splits off at 1.5
    const m2 = build([W(0, 0, 0, 2.5), C(2, 1, 0, 'pinHole', 2)]);
    expect(ids(setRim(m2, 1, [0, 0, 0], 2))).toEqual([1]);
    const s2 = setRim(m2, 1, [0, 0, 0], 1.5);
    expect(s2.parts.map((p) => p.cells.length)).toEqual([1, 1]);
    expect(ids(s2)).toEqual([1, 2]);
    expect(validateModel(s2)).toEqual([]);
    // (1,1) alone: one part at r 1, splits when the rim is removed (bare hub = r ½ does not reach it)
    const m3 = setRoot(build([C(5, 5, 5, 'pinHole', 2)], [W(0, 0, 0, 2.5), C(1, 1, 0, 'pinHole', 2)]), 2);
    expect(ids(setRim(m3, 2, [0, 0, 0], 1))).toEqual([1, 2]);
    const gone = setRim(m3, 2, [0, 0, 0], undefined);
    expect(ids(gone)).toEqual([1, 2, 3]);
    expect(gone.rootPartId).toBe(2);
    expect(validateModel(gone)).toEqual([]);
  });
  it('setRim split: the largest piece keeps the id and the root', () => {
    const wheel = [W(0, 0, 0, 2.5), C(2, 1, 0, 'pinHole', 2), C(-2, 0, 0, 'pinHole', 2), C(-3, 0, 0, 'pinHole', 2), C(-4, 0, 0, 'pinHole', 2)];
    const m = setRoot(build(beam(1, 20), wheel), 2);
    const s = setRim(m, 2, [0, 0, 0], 1);
    // pieces: hub alone (1), (2,1) (1), the 3-beam at x −4…−2 (3): the beam keeps id 2 and the root
    expect(s.parts.map((p) => [p.id, p.cells.length])).toEqual([[1, 1], [2, 3], [3, 1], [4, 1]]);
    expect(s.rootPartId).toBe(2);
    expect(partById(s, 2)!.cells.every((c) => c.x <= -2)).toBe(true);
    expect(s.nextPartId).toBe(5);
    expect(validateModel(s)).toEqual([]);
  });
  it('removeCell of a hub removes its rim with it (and the disc-joined cells split off)', () => {
    const m = build([W(0, 0, 0, 2.5), C(1, 1, 0, 'pinHole', 2), C(-1, -1, 0, 'pinHole', 2)]);
    const r = removeCell(m, 1, [0, 0, 0]);
    expect(r.parts).toHaveLength(2);
    expect(r.parts.flatMap((p) => p.cells).some((c) => c.rim !== undefined)).toBe(false);
    expect(validateModel(r)).toEqual([]);
  });
});

describe('rule 2: blocking', () => {
  it('a wheel two cells from a beam touches it (allowed); one step closer is rejected', () => {
    // hub at (0,0,0), r 1.5; beam of another part from x = 2
    const m = build([C(0, 0, 0, 'pinHole', 2)], beam(3, 2));
    expect(canSetRim(m, 1, [0, 0, 0], 1.5)).toEqual(ok);
    const w = setRim(m, 1, [0, 0, 0], 1.5);
    expect(validateModel(w)).toEqual([]);
    expect(reason(canSetRim(m, 1, [0, 0, 0], 2))).toBe('wheel would hit part 2 at (2, 0, 0)');
    // one step closer: the beam at x = 1
    expect(movePart(w, 2, [-1, 0, 0])).toBeNull();
    expect(movePart(w, 1, [1, 0, 0])).toBeNull();
    expect(reason(canAddCell(w, 2, C(1, 0, 0, 'pinHole', 2)))).toBe('(1, 0, 0) is inside the wheel of part 1');
    expect(reason(canAddCell(w, null, C(1, 1, 0, 'axleHole', 2)))).toBe('(1, 1, 0) is inside the wheel of part 1');
    const m1 = build([C(0, 0, 0, 'pinHole', 2)], beam(3, 1));
    expect(reason(canSetRim(m1, 1, [0, 0, 0], 1))).toBe('wheel would hit part 2 at (1, 0, 0)');
    expect(() => addPart(m1, [W(1, 1, 0, 1)])).toThrow('wheel would hit part 1 at (0, 0, 0)');
    expect(() => addPart(m1, [W(2, 1, 0, 1)])).toThrow('wheel would hit part 2 at (1, 0, 0)');
    expect(codes(raw([{ id: 1, cells: [W(0, 0, 0, 1.5)] }, { id: 2, cells: beam(3, 1) }]))).toEqual(['overlap']);
  });
  it('cells in the next layer never block (the disc is one cell thick)', () => {
    const m = build([C(0, 0, 0, 'pinHole', 2)], beam(5, -2, 0, 1), beam(5, -2, 0, -1));
    expect(canSetRim(m, 1, [0, 0, 0], 4)).toEqual(ok);
    expect(validateModel(setRim(m, 1, [0, 0, 0], 4))).toEqual([]);
  });
  it('mate exception: a male of another part through the hub or a crank hole is allowed; through a covered non-hole position it is not', () => {
    const wheel = [W(0, 0, 0, 2.5), C(1, 1, 0, 'pinHole', 2)];
    const m = build(wheel);
    // axle through the hub
    const a = addPart(m, rod(3, [0, 0, -1], 2, 'axle')).model;
    expect(validateModel(a)).toEqual([]);
    // pin through the crank hole
    const p = addPart(a, rod(2, [1, 1, 0], 2, 'pin')).model;
    expect(validateModel(p)).toEqual([]);
    expect(canAddCell(m, null, C(1, 1, 0, 'pin', 2))).toEqual(ok);
    // a pin at (1,0) — covered by the disc, no hole there
    expect(reason(canAddCell(m, null, C(1, 0, 0, 'pin', 2)))).toBe('(1, 0, 0) is inside the wheel of part 1');
    expect(() => addPart(m, rod(2, [1, 0, 0], 2, 'pin'))).toThrow(/inside the wheel of part 1/);
    // a hole of another part there (where the wheel part has a male) is never the exception
    const mm = build([W(0, 0, 0, 2.5), C(1, 0, 0, 'pin', 0)]);
    expect(reason(canAddCell(mm, null, C(1, 0, 0, 'pinHole', 0)))).toBe('(1, 0, 0) is inside the wheel of part 1');
    // the exception also holds when the wheel is grown or moved onto the pin
    const pinFirst = build([C(0, 0, 0, 'pinHole', 2), C(1, 1, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2)], rod(2, [1, 1, 0], 2, 'pin'));
    expect(canSetRim(pinFirst, 1, [0, 0, 0], 2.5)).toEqual(ok);
    const pinAt10 = build([C(0, 0, 0, 'pinHole', 2), C(0, 1, 0, 'pinHole', 2)], rod(2, [1, 0, 0], 2, 'pin'));
    expect(reason(canSetRim(pinAt10, 1, [0, 0, 0], 1))).toBe('wheel would hit part 2 at (1, 0, 0)');
  });
  it('a crank hole holding another part’s pin cannot be erased while the wheel covers it', () => {
    const m = build([W(0, 0, 0, 2.5), C(1, 1, 0, 'pinHole', 2)], rod(2, [1, 1, 0], 2, 'pin'));
    expect(reason(canRemoveCell(m, 1, [1, 1, 0]))).toBe('the pin of part 2 at (1, 1, 0) would be inside the wheel of part 1');
    expect(() => removeCell(m, 1, [1, 1, 0])).toThrow(/would be inside the wheel/);
    // after shrinking the wheel to bare, it can
    const bare = setRim(m, 1, [0, 0, 0], undefined); // the crank hole splits off (it was joined only by the disc)
    const crank = bare.parts.find((p) => p.id !== 2 && cellAt(p, [1, 1, 0]))!;
    expect(crank.id).toBe(3);
    expect(canRemoveCell(bare, crank.id, [1, 1, 0])).toEqual(ok);
    // erasing the hub (with its rim) is always fine
    expect(canRemoveCell(m, 1, [0, 0, 0])).toEqual(ok);
    expect(validateModel(removeCell(m, 1, [0, 0, 0]))).toEqual([]);
    // without a guest pin, the crank hole can go
    const m2 = build([W(0, 0, 0, 2.5), C(1, 1, 0, 'pinHole', 2)]);
    expect(validateModel(removeCell(m2, 1, [1, 1, 0]))).toEqual([]);
  });
  it('discs of the same part overlap freely; discs of different parts must not', () => {
    const same = build([W(0, 0, 0, 2), C(1, 0, 0, 'pinHole', 2), W(2, 0, 0, 2)]);
    expect(validateModel(same)).toEqual([]);
    // parallel, different parts: r 1 + r 1 at 2 touch (allowed), r 1.5 + r 1 at 2 overlap
    const two = build([W(0, 0, 0, 1)], [W(2, 0, 0, 1)]);
    expect(validateModel(two)).toEqual([]);
    expect(reason(canSetRim(two, 2, [2, 0, 0], 1.5))).toBe('wheels would overlap: the wheel of part 1 (hub (0, 0, 0))');
    expect(reason(canSetRim(two, 1, [0, 0, 0], 1.5))).toMatch(/wheel would hit part 2|wheels would overlap/);
    // r 1.5 next to r 1 at distance 2: the r 1.5 disc only touches the r 1 hub cell, but the discs overlap
    const m = build([W(0, 0, 0, 1.5)], [C(2, 0, 0, 'pinHole', 2)]);
    expect(validateModel(m)).toEqual([]);
    expect(reason(canSetRim(m, 2, [2, 0, 0], 1))).toBe('wheels would overlap: the wheel of part 1 (hub (0, 0, 0))');
    expect(codes(raw([{ id: 1, cells: [W(0, 0, 0, 1.5)] }, { id: 2, cells: [W(2, 0, 0, 1)] }]))).toEqual(['overlap']);
  });
  it('perpendicular wheels: overlapping is rejected, clear is allowed', () => {
    // r 1 about Z at the origin, r 1 about X at (0, 0, 1): overlap (e.g. (0, 0, 0.4) is in both)
    const m = build([W(0, 0, 0, 1)], [C(0, 0, 2, 'pinHole', 0)]);
    expect(canSetRim(m, 2, [0, 0, 2], 1)).toEqual(ok); // (0,0,2): clear
    const ok2 = setRim(m, 2, [0, 0, 2], 1);
    expect(validateModel(ok2)).toEqual([]);
    expect(movePart(ok2, 2, [0, 0, -1])).toBeNull();
    // both wheels overlap, and the X wheel's disc also overlaps the Z wheel's hub cell
    const errs = validateModel(raw([{ id: 1, cells: [W(0, 0, 0, 1)] }, { id: 2, cells: [W(0, 0, 1, 1, 0)] }]));
    expect(errs.map((e) => e.message)).toEqual([
      'wheels would overlap: part 1 (hub (0, 0, 0), radius 1) and part 2 (hub (0, 0, 1), radius 1)',
      '(0, 0, 0): the pin hole of part 1 is inside the wheel of part 2 (hub (0, 0, 1), radius 1)',
    ]);
    // r 1.5 about Z reaching exactly the slab of an X wheel two cells over: touching, allowed
    expect(validateModel(build([W(0, 0, 0, 1.5)], [W(2, 0, 0, 1, 0)]))).toEqual([]);
    expect(validateModel(raw([{ id: 1, cells: [W(0, 0, 0, 2)] }, { id: 2, cells: [W(3, 0, 0, 1, 0)] }]))).toEqual([]);
  });
  it('rotatePart turns rims with their cells and is refused when the turned disc would hit', () => {
    const m = build([W(0, 0, 0, 1.5), C(0, 1, 0, 'pinHole', 2), C(0, 2, 0, 'pinHole', 2)]);
    const r = rotatePart(m, 1, 0, 1, [0, 0, 0])!; // about X: +Y → +Z, hub axis Z → Y
    expect(cellAt(r.parts[0]!, [0, 0, 0])).toEqual({ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 1, rim: 1.5 });
    expect(validateModel(r)).toEqual([]);
    // a beam lying in the XZ plane at y = 0, two over in Z: blocks the turned disc (in the Y-axis layer)
    const blocked = addPart(m, [C(1, 0, -1, 'pinHole', 1)]).model;
    expect(validateModel(blocked)).toEqual([]);
    expect(rotatePart(blocked, 1, 0, 1, [0, 0, 0])).toBeNull();
  });
  it('addPart keeps rims (duplicate) and checks the copy', () => {
    const m = build([W(0, 0, 0, 2), C(1, 0, 0, 'pinHole', 2)]);
    const dup = addPart(m, partById(m, 1)!.cells.map((c) => ({ ...c, z: c.z + 1 }))).model;
    expect(dup.parts[1]!.cells[0]!.rim).toBe(2);
    expect(validateModel(dup)).toEqual([]);
    expect(() => addPart(m, partById(m, 1)!.cells.map((c) => ({ ...c, x: c.x + 3 })))).toThrow(/wheels would overlap|wheel would hit|inside the wheel/);
  });
  it('movePart carries rims', () => {
    const m = build([W(0, 0, 0, 2)]);
    const mv = movePart(m, 1, [5, 6, 7])!;
    expect(mv.parts[0]!.cells[0]).toEqual(W(5, 6, 7, 2));
  });
  it('wheelsAt / WorldIndex.discsOverlapping', () => {
    const m = build([W(0, 0, 0, 2.5)], [W(10, 0, 0, 1, 0)]);
    expect(wheelsAt(m, [1, 1, 0]).map((e) => e.partId)).toEqual([1]);
    expect(wheelsAt(m, [3, 0, 0])).toEqual([]);
    expect(wheelsAt(m, [10, 1, 1]).map((e) => e.partId)).toEqual([2]);
    expect(worldIndex(m).rims.map((e) => [e.partId, e.r])).toEqual([[1, 2.5], [2, 1]]);
  });
});

describe('canSetRim / setRim reasons and rules', () => {
  const m = build([C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pin', 0)]);
  it('reasons', () => {
    expect(reason(canSetRim(m, 1, [1, 0, 0], 1))).toBe('wheels grow from pin holes and axle holes');
    expect(reason(canSetRim(m, 1, [0, 0, 0], 4.5))).toBe('largest wheel is radius 4');
    expect(reason(canSetRim(m, 1, [0, 0, 0], 0.5))).toBe('smallest wheel is radius 1');
    expect(reason(canSetRim(m, 1, [0, 0, 0], 1.25))).toBe('wheel radius goes in steps of 0.5');
    expect(reason(canSetRim(m, 1, [0, 0, 0], NaN))).toMatch(/invalid wheel radius/);
    expect(reason(canSetRim(m, 9, [0, 0, 0], 1))).toBe('no part with id 9');
    expect(reason(canSetRim(m, 1, [5, 0, 0], 1))).toBe('part 1 has no cell at (5, 0, 0)');
    expect(canSetRim(m, 1, [0, 0, 0], undefined)).toEqual(ok);
    expect(canSetRim(m, 1, [1, 0, 0], undefined)).toEqual(ok);
    for (const r of [1, 1.5, 2, 2.5, 3, 3.5, 4]) expect(canSetRim(m, 1, [0, 0, 0], r)).toEqual(ok);
    expect(() => setRim(m, 1, [0, 0, 0], 5)).toThrow('largest wheel is radius 4');
  });
  it('the part’s own male cell under its own disc is fine (fused)', () => {
    expect(validateModel(setRim(m, 1, [0, 0, 0], 3))).toEqual([]);
  });
  it('shrinking is always allowed', () => {
    const w = setRim(build([C(0, 0, 0, 'pinHole', 2)], beam(2, 3)), 1, [0, 0, 0], 2.5);
    expect(canSetRim(w, 1, [0, 0, 0], 2)).toEqual(ok);
    expect(canSetRim(w, 1, [0, 0, 0], 2.5)).toEqual(ok);
    expect(reason(canSetRim(w, 1, [0, 0, 0], 3))).toBe('wheel would hit part 2 at (3, 0, 0)');
  });
});

describe('ground, free root (§2.6)', () => {
  it('rootIsFixed: fixRoot !== false || !ground', () => {
    const m = build(beam(2));
    expect(rootIsFixed(m)).toBe(true);
    expect(rootIsFixed(setFixRoot(m, false))).toBe(true); // no ground: the root stays fixed
    expect(rootIsFixed(setGround(m, true))).toBe(true);
    expect(rootIsFixed(setGround(setFixRoot(m, false), true))).toBe(false);
  });
  it('groundLevel: null when off or empty; lowest cell bottom or horizontal-rim bottom', () => {
    expect(groundLevel(build(beam(2)))).toBeNull();
    expect(groundLevel(setGround(emptyModel(), true))).toBeNull();
    const m = setGround(build(beam(2, 0, 3), [C(5, -2, 0, 'pin', 1)]), true);
    expect(groundLevel(m)).toBe(-2.5);
    const w = setRim(setGround(build([C(0, 4, 0, 'pinHole', 2)]), true), 1, [0, 4, 0], 2.5);
    expect(groundLevel(w)).toBe(1.5); // 4 − 2.5
    const wx = setGround(build([W(0, 4, 0, 3, 0)]), true);
    expect(groundLevel(wx)).toBe(1);
    const wy = setGround(build([W(0, 4, 0, 3, 1)]), true); // lying flat: its layer's bottom
    expect(groundLevel(wy)).toBe(3.5);
  });
  it('setGround / setFixRoot validate their argument', () => {
    expect(() => setGround(emptyModel(), 1 as unknown as boolean)).toThrow();
    expect(() => setFixRoot(emptyModel(), 'no' as unknown as boolean)).toThrow();
  });
  it('removePart / removeCell keep ground and fixRoot', () => {
    const m = setGround(setFixRoot(build(beam(3), beam(1, 9)), false), true);
    expect(removePart(m, 2)).toMatchObject({ ground: true, fixRoot: false, version: 2 });
    expect(removeCell(m, 1, [1, 0, 0])).toMatchObject({ ground: true, fixRoot: false });
  });
});

describe('analyze (§3.1 step 4) and rims in the analysis', () => {
  it('fixed = root body and rootIsFixed', () => {
    const m = build(beam(3), rod(2, [0, 0, 0], 2), beam(3, 0, 0, 1));
    expect(analyze(m).bodies.map((b) => b.fixed)).toEqual([true, false]);
    expect(analyze(setGround(m, true)).bodies.map((b) => b.fixed)).toEqual([true, false]);
    expect(analyze(setFixRoot(m, false)).bodies.map((b) => b.fixed)).toEqual([true, false]);
    const free = setGround(setFixRoot(m, false), true);
    expect(analyze(free).bodies.map((b) => b.fixed)).toEqual([false, false]);
    expect(analyze(free).joints).toEqual(analyze(m).joints);
  });
  it('rims change nothing else: every example with rims grown wherever allowed analyses identically', () => {
    for (const ex of EXAMPLES) {
      const m0 = ex.build();
      let m = m0;
      let grown = 0;
      for (const p of m0.parts)
        for (const c of p.cells) {
          // Bare holes only: the crank-wheel and cart examples (§8) already carry rims, and
          // shrinking the crank wheel's rim would split off its crank hole (§2.6 rule 1).
          if (!isHole(c.kind) || c.rim !== undefined) continue;
          for (const r of [2, 1.5, 1]) {
            if (canSetRim(m, p.id, [c.x, c.y, c.z], r).ok) {
              m = setRim(m, p.id, [c.x, c.y, c.z], r);
              grown++;
              break;
            }
          }
        }
      expect(validateModel(m), ex.name).toEqual([]);
      expect(ids(m), ex.name).toEqual(ids(m0)); // growing never splits or merges parts
      const a = analyze(m0);
      const b = analyze(m);
      expect(b.mates, ex.name).toEqual(a.mates);
      expect(b.bodies, ex.name).toEqual(a.bodies);
      expect(b.joints, ex.name).toEqual(a.joints);
      expect([...b.bodyOfPart], ex.name).toEqual([...a.bodyOfPart]);
      if (!['Collision'].includes(ex.name)) expect(grown, ex.name).toBeGreaterThan(0);
    }
  });
  it('a free pin that is the root: kept as its own fixed body with a fixed root, absorbed like any other with a free root', () => {
    // two 5-hole beams joined by a 2-cell pin at x = 4; the pin (part 2) is the root
    const m = setRoot(build(beam(5), rod(2, [4, 0, 0], 2), beam(5, 0, 0, 1)), 2);
    const fixedA = analyze(setGround(m, true));
    expect(fixedA.bodies.length).toBe(3); // the pin is the fixed body; both beams turn on it
    expect(fixedA.bodies.filter((b) => b.fixed).length).toBe(1);
    expect(fixedA.joints.length).toBe(2);
    const freeA = analyze(setFixRoot(setGround(m, true), false));
    // review finding: was 3 bodies (none fixed) and 2 revolutes, the pin a 0.5-mass body of its own
    expect(freeA.bodies.length).toBe(2);
    expect(freeA.bodies.every((b) => !b.fixed)).toBe(true);
    expect(freeA.joints.map((j) => j.type)).toEqual(['revolute']);
  });
  it('a wheel on a smooth pin: same bodies and revolute joint with and without the rim', () => {
    const base = build(beam(3), rod(2, [0, 0, 0], 2), [C(0, 0, 1, 'pinHole', 2)]);
    const wheel = setRim(base, 3, [0, 0, 1], 2.5);
    const a = analyze(base);
    const b = analyze(wheel);
    expect(b.bodies).toEqual(a.bodies);
    expect(b.joints).toEqual(a.joints);
    expect(b.joints.map((j) => j.type)).toEqual(['revolute']);
  });
});

describe('scale: the wheel rules stay cheap', () => {
  it('validateModel / movePart / canAddCell on ~3000 cells with 60 wheels', () => {
    let m = emptyModel();
    // 30 × 5-hole beams in a block of layers, and 60 wheels in their own region
    for (let i = 0; i < 600; i++) m = addPart(m, beam(5, (i % 20) * 6, Math.floor(i / 20) * 2, 0)).model;
    for (let i = 0; i < 60; i++) m = addPart(m, [W((i % 10) * 9, 100 + Math.floor(i / 10) * 9, 0, 4)]).model;
    expect(m.parts.reduce((n, p) => n + p.cells.length, 0)).toBe(3060);
    let t0 = performance.now();
    expect(validateModel(m)).toEqual([]);
    const tv = performance.now() - t0;
    t0 = performance.now();
    for (let i = 0; i < 100; i++) canAddCell(m, 601 + (i % 60), C(((i % 10) * 9) + 1, 100 + Math.floor((i % 60) / 10) * 9, 1, 'pinHole', 2));
    const tc = (performance.now() - t0) / 100;
    t0 = performance.now();
    for (let i = 0; i < 20; i++) movePart(m, 601 + i, [0, 0, 1]);
    const tm = (performance.now() - t0) / 20;
    console.log(`core: validateModel ${tv.toFixed(1)} ms, canAddCell ${tc.toFixed(3)} ms, movePart(wheel) ${tm.toFixed(2)} ms on 3060 cells / 60 wheels`);
    expect(tv).toBeLessThan(2000);
    expect(tc).toBeLessThan(20);
    expect(tm).toBeLessThan(50);
  });
  it('WorldIndex.rimsNear uses the spatial hash beyond 32 rims and finds the same as a scan', () => {
    let m = emptyModel();
    for (let i = 0; i < 80; i++) m = addPart(m, [W((i % 8) * 9, Math.floor(i / 8) * 9, (i % 3) * 3, 1 + (i % 7) / 2)]).model;
    const w = new WorldIndex(m);
    for (let x = -10; x < 80; x += 7)
      for (let y = -10; y < 100; y += 11) {
        const got = w.rimsNear([x, y, 1]).map((e) => e.partId).sort((a, b) => a - b);
        const want = w.rims.filter((e) => Math.abs(e.hub[0] - x) <= 8 && Math.abs(e.hub[1] - y) <= 8 && Math.abs(e.hub[2] - 1) <= 8).map((e) => e.partId).sort((a, b) => a - b);
        expect(got).toEqual(want);
      }
  });
});

// ---------------------------------------------------------------------------------------------
// Fuzz: random edit sequences never produce an invalid model, and every canX agrees with
// validateModel of the raw result.

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Replace a part's cells without any checks, splitting into components (as the ops do). */
function rawReplace(m: Model, part: Part, cells: Cell[]): Model {
  if (cells.length === 0) return { ...m, version: 2, parts: m.parts.filter((p) => p.id !== part.id) };
  const comps = components(cells).sort((a, b) => b.length - a.length);
  let next = Math.max(m.nextPartId, ...m.parts.map((p) => p.id + 1));
  const pieces = comps.map((comp, k) => ({ ...part, id: k === 0 ? part.id : next++, cells: comp.map((i) => cells[i]!) }));
  const parts: Part[] = [];
  for (const p of m.parts) parts.push(...(p.id === part.id ? pieces : [p]));
  return { ...m, version: 2, parts, nextPartId: next };
}

describe('fuzz: random edits keep the model valid; canX agrees with validateModel', () => {
  const SEEDS = Number(process.env.WHEEL_CORE_FUZZ_SEEDS ?? 40);
  const STEPS = 120;
  it(`${SEEDS} seeds × ${STEPS} random addCell / setRim / movePart / rotatePart / removeCell`, () => {
    const KINDS: Kind[] = ['pinHole', 'pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];
    const RIMS = [undefined, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 0.5];
    const stats = { add: 0, rim: 0, move: 0, rot: 0, remove: 0, rejected: 0, wheelReasons: 0 };
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = rng(seed);
      const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
      const rnd = (n: number) => Math.floor(r() * (2 * n + 1)) - n; // small box: lots of interaction
      let m = emptyModel();
      for (let step = 0; step < STEPS; step++) {
        const op = m.parts.length === 0 ? 0 : Math.floor(r() * 10);
        const part = m.parts.length ? pick(m.parts) : null;
        if (op <= 3) {
          // addCell (to a part, near one of its cells) or a new part
          const kind = pick(KINDS);
          let pos: [number, number, number] = [rnd(4), rnd(2), rnd(3)];
          if (part && r() < 0.7) {
            const from = pick(part.cells);
            pos = [from.x + rnd(2), from.y + rnd(1), from.z + rnd(1)];
          }
          const rim = isHole(kind) && r() < 0.25 ? pick([1, 1.5, 2, 2.5]) : undefined;
          const cell = C(pos[0], pos[1], pos[2], kind, pick([0, 1, 2] as Axis[]), rim);
          const target = part && r() < 0.8 ? part.id : null;
          const can = canAddCell(m, target, cell);
          let rawM: Model;
          if (target === null) rawM = { ...m, version: 2, parts: [...m.parts, { id: m.nextPartId, color: '#808080', cells: [cell] }], nextPartId: m.nextPartId + 1 };
          else rawM = { ...m, version: 2, parts: m.parts.map((p) => (p.id === target ? { ...p, cells: [...p.cells, cell] } : p)) };
          const valid = validateModel(rawM).length === 0;
          expect(can.ok, `seed ${seed} step ${step} addCell ${JSON.stringify(cell)} → ${target}: ${reason(can)} / ${JSON.stringify(validateModel(rawM).slice(0, 2))}`).toBe(valid);
          if (can.ok) {
            m = target === null ? addPart(m, [cell]).model : addCell(m, target, cell);
            stats.add++;
          } else {
            stats.rejected++;
            if (/wheel/.test(reason(can))) stats.wheelReasons++;
          }
        } else if (op <= 5) {
          const c = pick(part!.cells);
          const rim = pick(RIMS);
          const can = canSetRim(m, part!.id, [c.x, c.y, c.z], rim);
          const cells = part!.cells.map((q) => (q === c ? makeCell(q.x, q.y, q.z, q.kind, q.axis, rim) : q));
          const rawM = rawReplace(m, part!, cells);
          const valid = validateModel(rawM).length === 0;
          expect(can.ok, `seed ${seed} step ${step} setRim ${rim} on ${JSON.stringify(c)}: ${reason(can)} / ${JSON.stringify(validateModel(rawM).slice(0, 2))}`).toBe(valid);
          if (can.ok) {
            m = setRim(m, part!.id, [c.x, c.y, c.z], rim);
            stats.rim++;
          } else {
            stats.rejected++;
            if (/wheel would hit|wheels would overlap/.test(reason(can))) stats.wheelReasons++;
          }
        } else if (op === 6) {
          const d = pick<[number, number, number]>([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [2, 0, 0], [0, 0, -2]]);
          const res = movePart(m, part!.id, d);
          const rawM = rawReplace(m, part!, part!.cells.map((q) => makeCell(q.x + d[0], q.y + d[1], q.z + d[2], q.kind, q.axis, q.rim)));
          expect(res !== null, `seed ${seed} step ${step} movePart`).toBe(validateModel(rawM).length === 0);
          if (res) {
            m = res;
            stats.move++;
          } else stats.rejected++;
        } else if (op === 7) {
          const axis = pick([0, 1, 2] as Axis[]);
          const k = pick([1, 2, 3]);
          const c0 = part!.cells[0]!;
          const res = rotatePart(m, part!.id, axis, k, [c0.x, c0.y, c0.z]);
          const tmp = rotatePart({ ...m, parts: [part!] }, part!.id, axis, k, [c0.x, c0.y, c0.z])!; // alone: always valid
          const rawM = rawReplace(m, part!, tmp.parts[0]!.cells);
          expect(res !== null, `seed ${seed} step ${step} rotatePart`).toBe(validateModel(rawM).length === 0);
          if (res) {
            m = res;
            stats.rot++;
          } else stats.rejected++;
        } else {
          const c = pick(part!.cells);
          const can = canRemoveCell(m, part!.id, [c.x, c.y, c.z]);
          const rawM = rawReplace(m, part!, part!.cells.filter((q) => q !== c));
          expect(can.ok, `seed ${seed} step ${step} removeCell`).toBe(validateModel(rawM).length === 0);
          if (can.ok) {
            m = removeCell(m, part!.id, [c.x, c.y, c.z]);
            stats.remove++;
          } else {
            stats.rejected++;
            stats.wheelReasons++;
          }
        }
        const errs = validateModel(m);
        expect(errs, `seed ${seed} step ${step}`).toEqual([]);
        expect(deserialize(serialize(m))).toEqual(m);
      }
    }
    console.log(`core wheel fuzz: ${JSON.stringify(stats)}`);
    expect(stats.rim).toBeGreaterThan(SEEDS * 5);
    expect(stats.remove).toBeGreaterThan(SEEDS * 5);
    expect(stats.wheelReasons).toBeGreaterThan(SEEDS);
  }, 300000);
});
