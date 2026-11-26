// Wheels in the editor (DESIGN.md §7.2 Wheel tool / Erase on rims, §7.3 "Wheels in picking"):
// disc picking, virtual cells, the Wheel tool, Erase on rims, building on virtual cells, Back side,
// hover text, counts with a free root, and a random-walk fuzz (every valid proposal applies to a
// model validateModel accepts; one undo restores the previous model exactly).
import { describe, expect, it } from 'vitest';
import {

  addPart,
  axisOfDir,
  discCells,
  emptyModel,
  hasRim,
  isHole,
  makeCell,
  partById,
  serialize,
  setFixRoot,
  setGround,

  validateModel,
} from '../../src/core';
import type { Axis, Cell, Dir, Kind, Model, Vec3i } from '../../src/core';
import {
  History,
  cycleOrientation,
  describeHover,
  duplicateSelection,
  initialToolState,
  kinematicsSummary,
  moveSelection,
  nextRim,
  partInfo,
  pickBack,
  pickCell,
  resolveBuild,
  resolveErase,
  resolveSelect,
  resolveWheel,
  selectTool,
  setBackSide,
  setNewPart,
  wheelSize,
} from '../../src/editor';
import type { CellPick, PickHit, Ray, ToolState } from '../../src/editor';
import { c, modelOf } from './helpers';

const st = (tool: Parameters<typeof selectTool>[1], newPart = false): ToolState => setNewPart(selectTool(initialToolState('#3b74c4'), tool), newPart);

/** A one-hub wheel model: part 1 = a pin hole ∥ `axis` at `hub` with rim r (plus `more` cells). */
function wheel(r: number, axis: Axis = 2, hub: Vec3i = [0, 0, 0], more: Cell[] = []): Model {
  return addPart(emptyModel(), [makeCell(hub[0], hub[1], hub[2], 'pinHole', axis, r), ...more]).model;
}

const down = (x: number, y: number, z = 5): Ray => ({ origin: [x, y, z], dir: [0, 0, -1] });

// ---------------------------------------------------------------------------------------------
// Picking

describe('pickCell: wheel discs (§7.3)', () => {
  const m = wheel(2.5);

  it('a flat face outside the hub gives a virtual cell of the wheel', () => {
    const h = pickCell(m, down(1.2, 0.9))!;
    expect(h).toMatchObject({ partId: 1, cellIndex: 0, pos: [0, 0, 0], dir: 4, virtual: [1, 1, 0] });
    expect(h.t).toBeCloseTo(4.5, 12);
    expect(h.point[2]).toBeCloseTo(0.5, 12);
    expect(h.tread).toBeUndefined();
    expect(pickCell(m, down(2.2, 0))!.virtual).toEqual([2, 0, 0]);
    // from below: the −Z face
    expect(pickCell(m, { origin: [-1.1, 1.9, -4], dir: [0, 0, 1] })).toMatchObject({ dir: 5, virtual: [-1, 2, 0] });
  });

  it('the hub cube itself is a real cell (cube wins the coplanar tie)', () => {
    const h = pickCell(m, down(0.2, -0.3))!;
    expect(h.virtual).toBeUndefined();
    expect(h).toMatchObject({ partId: 1, cellIndex: 0, dir: 4 });
  });

  it('outside the radius: nothing', () => {
    expect(pickCell(m, down(2.6, 0))).toBeNull();
    expect(pickCell(m, down(1.8, 1.8))).toBeNull(); // |(1.8,1.8)| = 2.55 > 2.5
  });

  it('the tread resolves to the hub’s lateral face nearest the hit direction', () => {
    const h = pickCell(m, { origin: [6, 0, 0], dir: [-1, 0, 0] })!;
    expect(h).toMatchObject({ partId: 1, cellIndex: 0, dir: 0, tread: true });
    expect(h.t).toBeCloseTo(3.5, 12);
    expect(h.normal[0]).toBeCloseTo(1, 12);
    // hit at (2, 1.5): radial (2, 1.5) → +X face
    expect(pickCell(m, { origin: [6, 1.5, 0.2], dir: [-1, 0, 0] })).toMatchObject({ dir: 0, tread: true });
    // hit at (1.5, 2): +Y face
    expect(pickCell(m, { origin: [1.5, 6, 0], dir: [0, -1, 0] })).toMatchObject({ dir: 2, tread: true });
    // from −X below the axis: −X face
    expect(pickCell(m, { origin: [-6, -0.4, 0], dir: [1, 0, 0] })).toMatchObject({ dir: 1, tread: true });
  });

  it('grazing rays: in the face plane counts, tangent to the tread misses', () => {
    // in the flat face's plane z = 0.5 (closed slab) → tread
    expect(pickCell(m, { origin: [6, 0, 0.5], dir: [-1, 0, 0] })).toMatchObject({ tread: true, dir: 0 });
    // just outside the slab → miss
    expect(pickCell(m, { origin: [6, 0, 0.5000001], dir: [-1, 0, 0] })).toBeNull();
    // tangent to the cylinder (y = r) → zero-length overlap → miss
    expect(pickCell(m, { origin: [6, 2.5, 0], dir: [-1, 0, 0] })).toBeNull();
    // an oblique ray that grazes the rim edge only
    expect(pickCell(m, { origin: [3.5, 0, -0.5], dir: [-1, 0, 1] })).toBeNull();
    // …while one that enters at the edge and goes on inside hits it
    expect(pickCell(m, { origin: [3.5, 0, 1.5], dir: [-1, 0, -1] })).toMatchObject({ partId: 1 });
  });

  it('a disc in front of another part’s cell wins; a cell in front of a disc wins', () => {
    const behind = addPart(m, [c(1, 1, -2, 'pinHole', 2)]).model;
    expect(pickCell(behind, down(1.2, 1.1))).toMatchObject({ partId: 1, virtual: [1, 1, 0] });
    const front = addPart(m, [c(1, 1, 2, 'pinHole', 2)]).model;
    const h = pickCell(front, down(1.2, 1.1))!;
    expect(h.partId).toBe(2);
    expect(h.virtual).toBeUndefined();
  });

  it('a crank hole inside the disc: the real cell wins inside its cube', () => {
    const mc = wheel(2.5, 2, [0, 0, 0], [c(1, 1, 0, 'pinHole', 2)]);
    expect(validateModel(mc)).toEqual([]);
    for (const [x, y] of [[1.2, 1.1], [0.55, 0.55], [1.49, 1.49]]) {
      const h = pickCell(mc, down(x!, y!))!;
      expect(h).toMatchObject({ partId: 1, cellIndex: 1, dir: 4 });
      expect(h.virtual).toBeUndefined();
    }
    expect(pickCell(mc, down(1.6, 1.1))!.virtual).toEqual([2, 1, 0]);
  });

  it('a pin through the hub: the pin is picked at its own cube, the disc around it as virtual cells', () => {
    const mp = addPart(m, [c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]).model;
    expect(pickCell(mp, down(0, 0))!.partId).toBe(2);
    expect(pickCell(mp, down(1.2, 0))).toMatchObject({ partId: 1, virtual: [1, 0, 0] });
  });

  it('wheels about X and Y', () => {
    const mx = wheel(1.5, 0, [3, 2, 1]);
    expect(pickCell(mx, { origin: [9, 3.2, 1.1], dir: [-1, 0, 0] })).toMatchObject({ dir: 0, virtual: [3, 3, 1] });
    const my = wheel(1, 1, [0, 0, 0]);
    expect(pickCell(my, { origin: [0.9, 5, 0.2], dir: [0, -1, 0] })).toMatchObject({ dir: 2, virtual: [1, 0, 0] });
  });

  it('with transforms (simulate mode): the disc follows its part', () => {
    const q = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const; // 90° about Z
    const h = pickCell(m, down(10 - 1.2, 0.2), { transform: () => ({ p: [10, 0, 0], q }) })!;
    // world (8.8, 0.2) = rotate((0.2, 1.2)) + (10, 0, 0) in the edit-time frame
    expect(h.partId).toBe(1);
    expect(h.virtual).toEqual([0, 1, 0]);
    expect(h.point[0]).toBeCloseTo(8.8, 12);
  });

  it('a ray starting inside the disc reports inside', () => {
    const h = pickCell(m, { origin: [1.5, 0, 0], dir: [0, 0, -1] })!;
    expect(h.inside).toBe(true);
    expect(h.t).toBe(0);
  });

  it('matches a marching reference on random rays (wheels and cells of several parts)', () => {
    let mm = wheel(2.5, 2, [0, 0, 0], [c(1, 1, 0, 'pinHole', 2)]);
    mm = addPart(mm, [makeCell(6, 0, 0, 'axleHole', 0, 1.5)]).model;
    mm = addPart(mm, [c(0, 0, 2, 'pinHole', 1), c(1, 0, 2, 'pinHole', 1)]).model;
    mm = addPart(mm, [makeCell(0, 4, -1, 'pinHole', 1, 1), c(0, 4, 0, 'pinHole', 1)]).model;
    expect(validateModel(mm)).toEqual([]);
    const solids: { part: number; inside: (p: number[]) => boolean }[] = [];
    for (const part of mm.parts)
      for (const cell of part.cells) {
        const ctr = [cell.x, cell.y, cell.z];
        solids.push({ part: part.id, inside: (p) => p.every((v, k) => Math.abs(v - ctr[k]!) <= 0.5) });
        if (hasRim(cell)) {
          const a = cell.axis;
          solids.push({
            part: part.id,
            inside: (p) => Math.abs(p[a]! - ctr[a]!) <= 0.5 && Math.hypot(...[0, 1, 2].filter((k) => k !== a).map((k) => p[k]! - ctr[k]!)) <= cell.rim!,
          });
        }
      }
    let s = 7;
    const R = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      const target = [R() * 12 - 4, R() * 10 - 4, R() * 6 - 3];
      const d = [R() - 0.5, R() - 0.5, R() - 0.5];
      const L = Math.hypot(...d);
      const dir = d.map((v) => v / L) as [number, number, number];
      const origin = target.map((v, k) => v - dir[k]! * 15) as [number, number, number];
      const h = pickCell(mm, { origin, dir });
      // reference: first sample inside any solid
      let tRef: number | null = null;
      for (let t = 0; t < 30; t += 0.002) {
        const p = origin.map((v, k) => v + t * dir[k]!);
        if (solids.some((q) => q.inside(p))) {
          tRef = t;
          break;
        }
      }
      if (tRef === null) {
        // a miss, or a graze thinner than the sampling step
        if (h) expect(h.t).toBeGreaterThan(0);
        continue;
      }
      hits++;
      expect(h).not.toBeNull();
      expect(Math.abs(h!.t - tRef)).toBeLessThan(0.0025);
      if (h!.virtual) {
        const hub = partById(mm, h!.partId)!.cells[h!.cellIndex]!;
        expect(discCells([hub.x, hub.y, hub.z], hub.axis, hub.rim!)).toContainEqual(h!.virtual);
        expect(partById(mm, h!.partId)!.cells.some((q) => q.x === h!.virtual![0] && q.y === h!.virtual![1] && q.z === h!.virtual![2])).toBe(false);
        expect(axisOfDir(h!.dir)).toBe(hub.axis);
      }
    }
    expect(hits).toBeGreaterThan(80);
  });
});

// ---------------------------------------------------------------------------------------------
// Wheel tool

const pk = (h: PickHit | null): CellPick | null => h;
const hubPick = (partId: number, cellIndex: number, dir: Dir = 4): CellPick => ({ partId, cellIndex, dir });

describe('resolveWheel (§7.2 Wheel tool)', () => {
  it('a bare crank hole inside its own wheel: Wheel acts on that wheel, not on a hidden disc of the hole (review finding)', () => {
    // r 2.5 wheel (hub (0,0,1)) with a crank hole at (1,1,1), as in the reviewer's fixture
    const m = wheel(2.5, 2, [0, 0, 1], [c(1, 1, 1, 'pinHole', 2)]);
    const grow = resolveWheel(m, hubPick(1, 1));
    expect(grow).toMatchObject({ valid: true, mode: 'grow', partId: 1, cellIndex: 0, from: 2.5, to: 3 });
    expect(grow.description).toBe('Grow wheel · part 1 · radius 3 (48 mm across)');
    const after = grow.apply(m);
    expect(partById(after, 1)!.cells.map((q) => q.rim)).toEqual([3, undefined]);
    const shrink = resolveWheel(m, hubPick(1, 1), true);
    expect(shrink).toMatchObject({ valid: true, mode: 'shrink', cellIndex: 0, from: 2.5, to: 2 });
    // a hole only partly inside the disc, or in another layer, keeps its own wheel
    const m2 = wheel(1, 2, [0, 0, 0], [c(1, 0, 0, 'pinHole', 2)]);
    expect(resolveWheel(m2, hubPick(1, 1))).toMatchObject({ cellIndex: 1 });
  });

  it('grows a bare hole by half a unit to radius 1, then 1.5 …; each is one setRim', () => {
    let m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    expect(m.version).toBe(1);
    let p = resolveWheel(m, hubPick(1, 0));
    expect(p).toMatchObject({ valid: true, mode: 'grow', partId: 1, cellIndex: 0, to: 1 });
    expect(p.from).toBeUndefined();
    expect(p.description).toBe('Grow wheel · part 1 · radius 1 (16 mm across)');
    expect(p.ghost).toMatchObject({ x: 0, y: 0, z: 0, kind: 'pinHole', axis: 2, rim: 1 });
    expect(p.ring).toBeNull();
    m = p.apply(m);
    expect(m.version).toBe(2);
    expect(partById(m, 1)!.cells[0]!.rim).toBe(1);
    p = resolveWheel(m, hubPick(1, 0));
    expect(p.description).toBe('Grow wheel · part 1 · radius 1.5 (24 mm across)');
    m = p.apply(m);
    expect(validateModel(m)).toEqual([]);
  });

  it('largest wheel is radius 4 (no ghost); radius steps and sizes', () => {
    const m = wheel(4);
    const p = resolveWheel(m, hubPick(1, 0));
    expect(p.valid).toBe(false);
    expect(p.reason).toBe('largest wheel is radius 4');
    expect(p.description).toBe('Grow wheel · part 1 — largest wheel is radius 4');
    expect(p.ghost).toBeNull();
    expect(() => p.apply(m)).toThrow();
    expect(nextRim(undefined, false)).toBe(1);
    expect(nextRim(3.5, false)).toBe(4);
    expect(nextRim(1, true)).toBeUndefined();
    expect(nextRim(undefined, true)).toBeUndefined();
    expect(wheelSize(2.5)).toBe('radius 2.5 (40 mm across)');
  });

  it('growth into a neighbouring beam is invalid with the reason, and the ghost is still shown', () => {
    const m = addPart(wheel(1.5), [c(2, 0, 0, 'pinHole', 2), c(3, 0, 0, 'pinHole', 2)]).model;
    expect(validateModel(m)).toEqual([]); // r 1.5 touches the beam two cells away
    const p = resolveWheel(m, hubPick(1, 0));
    expect(p.valid).toBe(false);
    expect(p.reason).toMatch(/^wheel would hit part 2 at \(2, 0, 0\)/);
    expect(p.description).toMatch(/^Grow wheel · part 1 · radius 2 \(32 mm across\) — wheel would hit part 2/);
    expect(p.ghost).toMatchObject({ rim: 2 });
  });

  it('Shift shrinks by half a unit, 1 → bare; the removed band is the ring', () => {
    let m = wheel(1.5);
    let p = resolveWheel(m, hubPick(1, 0), true);
    expect(p).toMatchObject({ valid: true, mode: 'shrink', from: 1.5, to: 1, ring: { hub: [0, 0, 0], axis: 2, r0: 1, r1: 1.5 } });
    expect(p.description).toBe('Shrink wheel · part 1 · radius 1 (16 mm across)');
    expect(p.ghost).toBeNull();
    m = p.apply(m);
    p = resolveWheel(m, hubPick(1, 0), true);
    expect(p.description).toBe('Shrink wheel · part 1 · back to a bare pin hole');
    expect(p.ring).toEqual({ hub: [0, 0, 0], axis: 2, r0: 0.5, r1: 1 });
    m = p.apply(m);
    expect(partById(m, 1)!.cells[0]!.rim).toBeUndefined();
    const q = resolveWheel(m, hubPick(1, 0), true);
    expect(q.valid).toBe(false);
    expect(q.description).toBe('Shrink wheel · part 1 — this pin hole has no wheel');
  });

  it('acts on the wheel for a virtual-cell or tread hit, and on the hole around a pin', () => {
    const m = addPart(wheel(2), [c(0, 0, 0, 'axle', 2), c(0, 0, 1, 'axle', 2)]).model;
    expect(resolveWheel(m, pk(pickCell(m, down(1.3, 0.2))))).toMatchObject({ valid: true, partId: 1, to: 2.5 });
    expect(resolveWheel(m, pk(pickCell(m, { origin: [5, 0, 0], dir: [-1, 0, 0] })), true)).toMatchObject({ valid: true, partId: 1, to: 1.5 });
    // the axle in the hub, picked through its axial face: the hub grows
    const axle = pickCell(m, { origin: [0, 0, -3], dir: [0, 0, 1] })!;
    expect(axle.partId).toBe(2);
    expect(resolveWheel(m, axle)).toMatchObject({ valid: true, partId: 1, cellIndex: 0, to: 2.5 });
  });

  it('a lone male: wheels grow from pin holes and axle holes', () => {
    const m = modelOf([c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]);
    const p = resolveWheel(m, hubPick(1, 0));
    expect(p.valid).toBe(false);
    expect(p.reason).toBe('wheels grow from pin holes and axle holes');
    expect(p.description).toBe('Grow wheel · part 1 — wheels grow from pin holes and axle holes');
    expect(resolveWheel(m, null).description).toBe('');
  });

  it('shrinking can split off a crank hole held only by the disc', () => {
    const m = wheel(2, 2, [0, 0, 0], [c(2, 1, 0, 'pinHole', 2)]);
    expect(validateModel(m)).toEqual([]);
    const p = resolveWheel(m, hubPick(1, 0), true);
    expect(p.valid).toBe(true);
    expect(p.pieces).toBe(2);
    expect(p.description).toBe('Shrink wheel · part 1 · radius 1.5 (24 mm across) · part 1 splits into 2 parts');
    expect(p.apply(m).parts.length).toBe(2);
  });

  it('stale proposals throw', () => {
    const m = wheel(1);
    const p = resolveWheel(m, hubPick(1, 0));
    expect(() => p.apply(wheel(1))).toThrow(/re-resolve/);
  });
});

// ---------------------------------------------------------------------------------------------
// Erase on rims

describe('resolveErase on wheels (§7.2)', () => {
  it('on the hub, the disc or the tread: removes the outer half-unit (ring highlight)', () => {
    const m = wheel(2.5, 2, [0, 0, 0], [c(1, 1, 0, 'pinHole', 2)]);
    for (const pick of [hubPick(1, 0), pickCell(m, down(2.1, 0.3)), pickCell(m, { origin: [0, -6, 0], dir: [0, 1, 0] })]) {
      const e = resolveErase(m, pick);
      expect(e.valid).toBe(true);
      expect(e.ring).toEqual({ hub: [0, 0, 0], axis: 2, r0: 2, r1: 2.5 });
      expect(e.description).toBe('Erase the wheel’s outer half-unit · part 1 · radius 2.5 → 2');
      expect(partById(e.apply(m), 1)!.cells[0]!.rim).toBe(2);
    }
  });

  it('radius 1 → bare, then the next click erases the cell as usual', () => {
    let m = wheel(1, 2, [0, 0, 0], [c(1, 0, 0, 'pinHole', 2)]);
    let e = resolveErase(m, hubPick(1, 0));
    expect(e.description).toBe('Erase the wheel’s outer half-unit · part 1 · radius 1 → bare pin hole');
    expect(e.ring).toEqual({ hub: [0, 0, 0], axis: 2, r0: 0.5, r1: 1 });
    m = e.apply(m);
    e = resolveErase(m, hubPick(1, 0));
    expect(e.ring).toBeUndefined();
    expect(e.description).toBe('Erase pin hole at (0, 0, 0) from part 1');
  });

  it('a crank hole (a real cell inside the disc) is erased as a cell; one holding a pin is refused', () => {
    const m = wheel(2.5, 2, [0, 0, 0], [c(1, 1, 0, 'pinHole', 2)]);
    const e = resolveErase(m, hubPick(1, 1));
    expect(e.ring).toBeUndefined();
    expect(e.valid).toBe(true);
    expect(partById(e.apply(m), 1)!.cells.length).toBe(1);
    const mp = addPart(m, [c(1, 1, 0, 'pin', 2), c(1, 1, 1, 'pin', 2)]).model;
    const r = resolveErase(mp, hubPick(1, 1));
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/would be inside the wheel of part 1/);
    expect(r.description).toMatch(/^Erase pin hole at \(1, 1, 0\) from part 1 — /);
    expect(() => r.apply(mp)).toThrow();
  });
});

// ---------------------------------------------------------------------------------------------
// Building on virtual cells, tread, Back side

describe('build tools on a wheel (§7.3)', () => {
  const m = wheel(2.5);
  const face = (x: number, y: number) => pickCell(m, down(x, y))!;

  it('hole tool on the flat face: Extend — a crank hole at G, ∥ the hub axis first', () => {
    const p = resolveBuild(m, face(1.2, 1.1), null, st('pinHole'));
    expect(p).toMatchObject({ action: 'extend', valid: true, targetPartId: 1, cell: { x: 1, y: 1, z: 0, kind: 'pinHole', axis: 2 }, highlight: { pos: [1, 1, 0], dir: 4 } });
    expect(p.description).toBe('Extend part 1 · pin hole ∥ Z in the wheel');
    expect(p.options[0]).toBe(2);
    const r = p.apply(m);
    expect(validateModel(r.model)).toEqual([]);
    expect(partById(r.model, 1)!.cells).toContainEqual(makeCell(1, 1, 0, 'pinHole', 2));
    // [R] goes on to the other valid axes
    if (p.options.length > 1) {
      const p2 = resolveBuild(m, face(1.2, 1.1), null, cycleOrientation(st('pinHole'), p));
      expect(p2.cell!.axis).toBe(p.options[1]);
    }
    // an axle hole too
    expect(resolveBuild(m, face(-2.1, 0.2), null, st('axleHole'))).toMatchObject({ valid: true, cell: { x: -2, y: 0, z: 0, kind: 'axleHole', axis: 2 } });
  });

  it('male tools on a virtual cell: invalid, "add a hole here first"', () => {
    for (const k of ['axle', 'pin', 'frictionPin'] as Kind[]) {
      const p = resolveBuild(m, face(1.2, 1.1), null, st(k));
      expect(p.valid).toBe(false);
      expect(p.reason).toBe('add a hole here first');
      expect(p.description).toBe(`Extend part 1 · ${k === 'frictionPin' ? 'friction pin' : k} ∥ Z in the wheel — add a hole here first`);
    }
  });

  it('a pin goes into a crank hole once it is there (Insert through the real cell)', () => {
    const m2 = resolveBuild(m, face(1.2, 1.1), null, st('pinHole')).apply(m).model;
    const h = pickCell(m2, down(1.1, 1.05))!;
    expect(h.virtual).toBeUndefined();
    const p = resolveBuild(m2, h, null, st('pin'));
    expect(p).toMatchObject({ action: 'insert', valid: true, createsPart: true });
    expect(validateModel(p.apply(m2).model)).toEqual([]);
  });

  it('Shift / New part on a virtual cell: a new part on the face (G + n)', () => {
    const p = resolveBuild(m, face(1.2, 1.1), null, st('pinHole', true));
    expect(p).toMatchObject({ action: 'newAdjacent', valid: true, cell: { x: 1, y: 1, z: 1 } });
    const q = resolveBuild(m, face(1.2, 1.1), null, st('pinHole'));
    expect(q.shiftHint).toBe('Shift: New part · pin hole ∥ Z');
  });

  it('the tread: build tools refuse it and say how (fixer’s ruling after review, DEVIATIONS §7)', () => {
    // Was: "the tread resolves as the hub’s lateral face (ordinary rules)", which built a cell buried
    // inside the disc, far from the cursor. The pick itself still reports the hub's lateral face.
    const h = pickCell(m, { origin: [6, 0.3, 0], dir: [-1, 0, 0] })!;
    expect(h).toMatchObject({ partId: 1, cellIndex: 0, dir: 0, tread: true });
    for (const k of ['pinHole', 'axleHole', 'pin', 'axle'] as const)
      for (const shift of [false, true]) {
        const p = resolveBuild(m, h, null, st(k, shift));
        expect(p.action).toBe('none');
        expect(p.cell).toBeNull();
        expect(p.valid).toBe(false);
        expect(p.description).toBe("Part 1 · wheel tread — point at the wheel's flat face or at a hole to build on a wheel");
      }
    // Wheel, Erase and Select still act on the tread
    expect(resolveWheel(m, h).valid).toBe(true);
    expect(resolveErase(m, h).valid).toBe(true);
  });

  it('Back side: the ray leaving through the disc’s far flat face picks the virtual cell under the exit point', () => {
    const h = pickBack(m, down(1.2, 1.1))!;
    expect(h).toMatchObject({ partId: 1, cellIndex: 0, dir: 5, virtual: [1, 1, 0], back: true });
    const p = resolveBuild(m, h, null, setBackSide(st('pinHole'), true));
    expect(p.backSide).toBe(true);
    expect(p.description).toBe('Extend part 1 · pin hole ∥ Z in the wheel · back side (−Z)');
    expect(p.highlight).toEqual({ pos: [1, 1, 0], dir: 5 });
    const s = resolveBuild(m, h, null, setBackSide(st('pinHole', true), true));
    expect(s.cell).toMatchObject({ x: 1, y: 1, z: -1 });
  });

  it('a stale or forged virtual pick resolves to nothing', () => {
    expect(resolveBuild(m, { partId: 1, cellIndex: 0, dir: 4, virtual: [5, 5, 0] }, null, st('pinHole')).action).toBe('none');
    expect(resolveBuild(m, { partId: 1, cellIndex: 0, dir: 4, virtual: [0, 0, 0] }, null, st('pinHole')).action).toBe('none');
    expect(resolveErase(m, { partId: 1, cellIndex: 0, dir: 4, virtual: [5, 5, 0] }).valid).toBe(false);
    expect(resolveWheel(m, { partId: 1, cellIndex: 0, dir: 4, virtual: [5, 5, 0] }).partId).toBeUndefined();
  });

  it('Select treats a virtual cell as the part; hover text names the wheel', () => {
    expect(resolveSelect(m, face(2, 0)).partId).toBe(1);
    expect(describeHover(m, face(1.2, 1.1), null)).toBe('Part 1 · wheel radius 2.5 ∥ Z, hub (0, 0, 0) · at (1, 1, 0)');
    expect(describeHover(m, pickCell(m, { origin: [6, 0, 0], dir: [-1, 0, 0] }), null)).toBe('Part 1 · wheel radius 2.5 ∥ Z, hub (0, 0, 0) · tread');
    expect(describeHover(m, hubPick(1, 0), null)).toBe('Part 1 · pin hole ∥ Z at (0, 0, 0) · wheel radius 2.5');
  });
});

// ---------------------------------------------------------------------------------------------
// Selection operations, inspector, counts

describe('selection operations keep rims; inspector; counts with a free root', () => {
  it('duplicate keeps the rims and clears the discs', () => {
    const m = wheel(2, 2, [0, 0, 0], [c(1, 0, 0, 'pinHole', 2)]);
    const d = duplicateSelection(m, 1);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(validateModel(d.model)).toEqual([]);
    const copy = partById(d.model, d.partId!)!;
    expect(copy.cells.filter(hasRim).map((q) => q.rim)).toEqual([2]);
  });

  it('a blocked move names the wheel', () => {
    const m = addPart(wheel(2), [c(3, 0, 0, 'pinHole', 2)]).model;
    const r = moveSelection(m, 1, [1, 0, 0]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toMatch(/wheel/);
  });

  it('partInfo lists wheel radii (absent without wheels)', () => {
    const m = addPart(wheel(2.5, 2, [0, 0, 0], [makeCell(1, 0, 0, 'pinHole', 2, 1)]), [c(9, 0, 0, 'pinHole', 2)]).model;
    expect(partInfo(m, 1, 1)!.wheels).toEqual([2.5, 1]);
    expect(partInfo(m, 2, 1)!.wheels).toBeUndefined();
  });

  it('"(none fixed)" for a free root on the ground', () => {
    const m = setFixRoot(setGround(wheel(1.5), true), false);
    expect(kinematicsSummary(m)).toBe('1 part · 1 body (none fixed) · no joints');
    expect(kinematicsSummary(setGround(m, false))).toBe('1 part · 1 body (1 fixed) · no joints');
  });
});

// ---------------------------------------------------------------------------------------------
// Fuzz

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

describe('fuzz: wheels through the editor resolvers', () => {
  it('every valid proposal applies to a valid model; one undo restores the previous model exactly', () => {
    const R = rng(2024);
    const KINDS: Kind[] = ['pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];
    let applied = { build: 0, virtual: 0, wheel: 0, shrink: 0, erase: 0, ringErase: 0 };
    for (let walk = 0; walk < 25; walk++) {
      const hist = new History(emptyModel());
      let s = st('pinHole');
      for (let step = 0; step < 120; step++) {
        const m = hist.current;
        const roll = R();
        // a random pick: a ray at a random point near the model (real picking), or a synthetic one
        let pick: CellPick | null = null;
        let ray: Ray | null = null;
        if (m.parts.length) {
          if (R() < 0.6) {
            const part = m.parts[Math.floor(R() * m.parts.length)]!;
            const cell = part.cells[Math.floor(R() * part.cells.length)]!;
            const d = [R() - 0.5, R() - 0.5, R() - 0.5];
            const L = Math.hypot(...d) || 1;
            const dir = d.map((v) => v / L) as [number, number, number];
            const tgt = [cell.x + (R() - 0.5) * 6, cell.y + (R() - 0.5) * 6, cell.z + (R() - 0.5) * 6];
            ray = { origin: tgt.map((v, k) => v - dir[k]! * 20) as [number, number, number], dir };
            pick = pickCell(m, ray);
          } else {
            const part = m.parts[Math.floor(R() * m.parts.length)]!;
            const ci = Math.floor(R() * part.cells.length);
            const hub = part.cells[ci]!;
            if (hasRim(hub) && R() < 0.7) {
              const g = discCells([hub.x, hub.y, hub.z], hub.axis, hub.rim).filter((q) => !part.cells.some((o) => o.x === q[0] && o.y === q[1] && o.z === q[2]));
              if (g.length) pick = { partId: part.id, cellIndex: ci, dir: (2 * hub.axis + (R() < 0.5 ? 0 : 1)) as Dir, virtual: g[Math.floor(R() * g.length)]! };
            }
            pick ??= { partId: part.id, cellIndex: ci, dir: Math.floor(R() * 6) as Dir };
          }
        }
        let next: Model | null = null;
        if (!m.parts.length || roll < 0.45) {
          s = setBackSide(setNewPart(selectTool(s, KINDS[Math.floor(R() * 5)]!), R() < 0.2), R() < 0.15);
          const grid = { pos: [Math.floor(R() * 7) - 3, 0, Math.floor(R() * 7) - 3] as Vec3i };
          // Back side (§7.3): the back-face pick of the same ray (a synthetic pick taken as a back face)
          const bp = s.backSide && pick ? (ray ? pickBack(m, ray) : { ...pick, back: true }) : pick;
          const p = resolveBuild(m, bp, bp ? null : grid, s);
          if (bp?.back && p.action !== 'none') expect(p.backSide).toBe(true);
          if (R() < 0.3 && p.options.length > 1) s = cycleOrientation(s, p);
          if (p.valid) {
            next = p.apply(m).model;
            applied.build++;
            if (pick?.virtual) applied.virtual++;
            expect(p.options).toContain(p.cell!.axis);
          } else if (p.action !== 'none') {
            expect(p.reason).toBeTruthy();
            expect(() => p.apply(m)).toThrow();
          }
        } else if (roll < 0.85) {
          const shrink = R() < 0.3;
          const p = resolveWheel(m, pick, shrink);
          if (p.valid) {
            next = p.apply(m);
            applied[shrink ? 'shrink' : 'wheel']++;
            const hub = partById(next, p.partId!)!.cells.find((q) => q.x === p.hub!.x && q.y === p.hub!.y && q.z === p.hub!.z)!;
            expect(hub.rim).toBe(p.to);
          } else if (p.partId !== undefined) {
            expect(p.reason).toBeTruthy();
            expect(p.description).toContain(p.reason!);
          }
        } else {
          const e = resolveErase(m, pick);
          if (e.valid) {
            next = e.apply(m);
            applied[e.ring ? 'ringErase' : 'erase']++;
          } else if (e.reason) expect(e.description).toContain(e.reason);
        }
        if (!next) continue;
        expect(validateModel(next)).toEqual([]);
        const before = serialize(m);
        hist.push(next);
        hist.undo();
        expect(hist.current).toBe(m);
        expect(serialize(hist.current)).toBe(before);
        hist.redo();
        expect(hist.current).toBe(next);
        // rims only ever on hole cells, radii in range
        for (const part of next.parts) for (const q of part.cells) if (q.rim !== undefined) expect(isHole(q.kind) && q.rim >= 1 && q.rim <= 4).toBe(true);
      }
    }
    applied = { ...applied };
    expect(applied.build).toBeGreaterThan(300);
    // (was > 150: a bare hole inside its own part's wheel now grows that wheel instead of a hidden
    // disc of its own, which more often hits the largest radius or a neighbour: 149 here)
    expect(applied.wheel).toBeGreaterThan(130);
    expect(applied.shrink + applied.ringErase).toBeGreaterThan(50);
    expect(applied.virtual).toBeGreaterThan(10);
    expect(applied.erase).toBeGreaterThan(30);
  });
});

