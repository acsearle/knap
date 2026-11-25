// Adversarial review tests for src/editor (DESIGN.md §7, §2). Expectations are re-derived from the
// spec (and docs/DEVIATIONS.md §7 where it already made a decision), not from the implementation.
import { describe, expect, it } from 'vitest';
import {
  DIRS,
  addPart,
  axisOfDir,
  canAddCell,
  cellsAt,
  emptyModel,
  isHole,
  isMale,
  makeCell,
  mateType,
  partById,
  serialize,
  validateModel,
} from '../../src/core';
import type { Axis, Cell, Dir, Kind, Model, Vec3i } from '../../src/core';
import { R_ROD } from '../../src/geometry/dims';
import {
  History,
  cycleOrientation,
  deleteSelection,
  duplicateSelection,
  initialToolState,
  moveDelta,
  pickCell,
  pickGrid,
  resolveBuild,
  resolveErase,
  rotateSelection,
  screenAxes,
  selectTool,
  setNewPart,
  viewRotation,
} from '../../src/editor';
import type { CameraBasis, PartTransform, Proposal, Ray, Tool, ToolState, Vec3 } from '../../src/editor';

// ---------------------------------------------------------------------------------------------
// helpers

const C = (x: number, y: number, z: number, kind: Kind, axis: Axis): Cell => makeCell(x, y, z, kind, axis);
function modelOf(...parts: Cell[][]): Model {
  let m = emptyModel();
  for (const cells of parts) m = addPart(m, cells).model;
  return m;
}
const st = (tool: Tool, newPart = false): ToolState => setNewPart(selectTool(initialToolState('#3b74c4'), tool), newPart);
function cellIndexAt(m: Model, partId: number, p: Vec3i): number {
  return partById(m, partId)!.cells.findIndex((c) => c.x === p[0] && c.y === p[1] && c.z === p[2]);
}
function hover(m: Model, partId: number, p: Vec3i, dir: Dir, s: ToolState): Proposal {
  const i = cellIndexAt(m, partId, p);
  if (i < 0) throw new Error('no such cell');
  return resolveBuild(m, { partId, cellIndex: i, dir }, null, s);
}
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
const KINDS: Kind[] = ['pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];
const dirOf = (axis: Axis, positive: boolean): Dir => (2 * axis + (positive ? 0 : 1)) as Dir;

// ---------------------------------------------------------------------------------------------
// User scenarios, §7.3 by hand

describe('build scenarios (§7.3)', () => {
  it('first cell on the grid: New on grid at y = 0, valid, creates part 1', () => {
    const m = emptyModel();
    const g = pickGrid({ origin: [3.2, 10, -1.7], dir: [0, -1, 0] })!;
    expect(g.pos).toEqual([3, 0, -2]);
    const p = resolveBuild(m, null, g, st('pinHole'));
    expect(p.action).toBe('newOnGrid');
    expect(p.valid).toBe(true);
    expect(p.cell).toMatchObject({ x: 3, y: 0, z: -2 });
    const r = p.apply(p.baseModel);
    expect(r.partId).toBe(1);
    expect(validateModel(r.model)).toEqual([]);
  });

  it('grow a liftarm in a row and around a corner; holes keep the clicked axis', () => {
    let m = modelOf([C(0, 0, 0, 'pinHole', 1)]);
    const s = st('pinHole');
    let p = hover(m, 1, [0, 0, 0], 0, s);
    expect(p.action).toBe('extend');
    expect(p.cell).toMatchObject({ x: 1, y: 0, z: 0, axis: 1 });
    m = p.apply(p.baseModel).model;
    p = hover(m, 1, [1, 0, 0], 4, s); // corner: +Z
    expect(p.action).toBe('extend');
    expect(p.cell).toMatchObject({ x: 1, y: 0, z: 1, axis: 1 });
    expect(p.description).toBe('Extend part 1 · pin hole ∥ Y');
    m = p.apply(p.baseModel).model;
    expect(partById(m, 1)!.cells.length).toBe(3);
  });

  it('push a pin into a hole from either mouth; lengthen it through a second beam (join)', () => {
    // beam A (part 1) at z=0, beam B (part 2) at z=1, both Z holes, coaxial at (0,0,*)
    let m = modelOf([C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2)], [C(0, 0, 1, 'pinHole', 2), C(-1, 0, 1, 'pinHole', 2)]);
    for (const dir of [5 as Dir]) {
      // −Z mouth of A (B is on the +Z side, so −Z is the only visible mouth)
      const p = hover(m, 1, [0, 0, 0], dir, st('pin'));
      expect(p.action).toBe('insert');
      expect(p.valid).toBe(true);
      expect(p.createsPart).toBe(true);
      expect(p.cell).toMatchObject({ x: 0, y: 0, z: 0, kind: 'pin', axis: 2 });
    }
    // +Z mouth of A's other hole (nothing in front)
    const p2 = hover(m, 1, [1, 0, 0], 4, st('pin'));
    expect(p2.action).toBe('insert');
    expect(p2.valid).toBe(true);
    // Without Shift the pin would go on through B's hole behind (deep insert, DEVIATIONS §7);
    // Shift inserts a 1-cell pin into A only, so B's mouth can then join it.
    const deep = hover(m, 1, [0, 0, 0], 5, st('pin'));
    expect(deep.extraCells).toMatchObject([{ x: 0, y: 0, z: 1 }]);
    const r = hover(m, 1, [0, 0, 0], 5, st('pin', true)).apply(m);
    m = r.model;
    const pinId = r.partId;
    // now B's hole from +Z: behind it (z=0) is the pin -> the pin is lengthened
    const p3 = hover(m, 2, [0, 0, 1], 4, st('pin'));
    expect(p3.action).toBe('insert');
    expect(p3.valid).toBe(true);
    expect(p3.joins).toBe(true);
    expect(p3.targetPartId).toBe(pinId);
    expect(p3.description).toBe(`Extend part ${pinId} · insert pin ∥ Z into part 2`);
    const m3 = p3.apply(p3.baseModel).model;
    expect(validateModel(m3)).toEqual([]);
    expect(partById(m3, pinId)!.cells.length).toBe(2);
  });

  it('slide a new beam onto a protruding pin: side → Sleeve; end → Sleeve (DEVIATIONS §7), [R] → Extend, Shift+end → Sleeve', () => {
    const m = modelOf([C(0, 0, 0, 'pinHole', 2)], [C(0, 0, 0, 'pin', 2), C(0, 0, 1, 'pin', 2)]);
    const side = hover(m, 2, [0, 0, 1], 0, st('pinHole'));
    expect(side.action).toBe('sleeve');
    expect(side.valid).toBe(true);
    expect(side.cell).toMatchObject({ x: 0, y: 0, z: 1, kind: 'pinHole', axis: 2 });
    expect(side.description).toBe('New part · sleeve pin hole ∥ Z onto part 2');
    expect(validateModel(side.apply(side.baseModel).model)).toEqual([]);
    const end0 = hover(m, 2, [0, 0, 1], 4, st('pinHole'));
    expect(end0.action).toBe('sleeve');
    expect(end0.cell).toMatchObject({ z: 1, axis: 2 });
    const end = hover(m, 2, [0, 0, 1], 4, cycleOrientation(st('pinHole'), end0));
    expect(end.action).toBe('extend');
    expect(end.cell).toMatchObject({ z: 2 });
    expect(end.cell!.axis).not.toBe(2);
    const shiftEnd = hover(m, 2, [0, 0, 1], 4, st('pinHole', true));
    expect(shiftEnd.action).toBe('sleeve');
    expect(shiftEnd.cell).toMatchObject({ z: 1, axis: 2 });
  });

  it('bush on an axle (side): Sleeve with an axle hole, weld; pin into axle hole is refused with a reason', () => {
    const m = modelOf([C(0, 0, 0, 'axle', 2), C(0, 0, 1, 'axle', 2), C(0, 0, 2, 'axle', 2)]);
    const p = hover(m, 1, [0, 0, 1], 2, st('axleHole'));
    expect(p.action).toBe('sleeve');
    expect(p.valid).toBe(true);
    const bush = modelOf([C(0, 0, 0, 'axleHole', 1)]);
    const q = hover(bush, 1, [0, 0, 0], 2, st('pin'));
    expect(q.valid).toBe(false);
    expect(q.action).toBe('insert');
    expect(q.reason).toMatch(/does not fit/);
    expect(q.description).toContain(q.reason!);
  });

  it('perpendicular connector: hole tool on a Z hole offers Z first, then the other axes via [R]', () => {
    const m = modelOf([C(0, 0, 0, 'pinHole', 2)]);
    let s = st('pinHole');
    const p = hover(m, 1, [0, 0, 0], 0, s);
    expect(p.options[0]).toBe(2);
    expect([...p.options].sort()).toEqual([0, 1, 2]);
    s = cycleOrientation(s, p);
    const p2 = hover(m, 1, [0, 0, 0], 0, s);
    expect(p2.cell!.axis).not.toBe(2);
    expect(validateModel(p2.apply(p2.baseModel).model)).toEqual([]);
  });

  it('extending a beam onto another part’s rod picks the coaxial orientation (resolver level)', () => {
    // a Y rod at (1,0,0); beam hole at origin axis Z. Extend +X must propose a Y hole (coaxial).
    const m = modelOf([C(0, 0, 0, 'pinHole', 2)], [C(1, 0, 0, 'pin', 1), C(1, 1, 0, 'pin', 1)]);
    const p = hover(m, 1, [0, 0, 0], 0, st('pinHole'));
    expect(p.action).toBe('extend');
    expect(p.valid).toBe(true);
    expect(p.cell!.axis).toBe(1);
    expect(p.options).toEqual([1]);
  });

  it('illegal: rod on the mouth of a hole of the same part already holding a pin → reason names it', () => {
    const m = modelOf([C(0, 0, 0, 'pinHole', 2)], [C(0, 0, 0, 'pin', 2), C(0, 0, 1, 'pin', 2)]);
    // hover the hole's −Z face outside R_ROD (hole is picked)
    const p = hover(m, 1, [0, 0, 0], 5, st('axle'));
    expect(p.valid).toBe(false);
    expect(p.reason).toMatch(/already holds a pin \(part 2\)/);
    // Shift: Insert fails, New adjacent at (0,0,-1) along Z is fine
    const q = hover(m, 1, [0, 0, 0], 5, st('axle', true));
    expect(q.action).toBe('newAdjacent');
    expect(q.valid).toBe(true);
  });

  it('[R] persistence as the hover moves: the chosen world axis is kept where valid', () => {
    const m = modelOf([C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2), C(2, 0, 0, 'pinHole', 2)]);
    let s = st('pinHole');
    const p = hover(m, 1, [2, 0, 0], 0, s);
    s = cycleOrientation(s, p);
    const chosen = hover(m, 1, [2, 0, 0], 0, s).cell!.axis;
    for (const [pos, dir] of [[[0, 0, 0], 1], [[1, 0, 0], 2], [[2, 0, 0], 3]] as [Vec3i, Dir][]) {
      expect(hover(m, 1, pos, dir, s).cell!.axis).toBe(chosen);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Reference resolver from §7.3 (+ DEVIATIONS §7 insert-join, sleeve-first on a rod end) and a random-walk fuzz

function refValid(m: Model, partId: number | null, pos: Vec3i, kind: Kind): Axis[] {
  return ([0, 1, 2] as Axis[]).filter((a) => canAddCell(m, partId, makeCell(pos[0], pos[1], pos[2], kind, a)).ok);
}

function refAction(m: Model, P: number, Cc: Cell, dir: Dir, kind: Kind, newPart: boolean, axisPref: Axis | null = null): { action: string; valid: Axis[]; target: number | null } | null {
  const n = DIRS[dir]!;
  const T: Vec3i = [Cc.x + n[0], Cc.y + n[1], Cc.z + n[2]];
  const cp: Vec3i = [Cc.x, Cc.y, Cc.z];
  const others = cellsAt(m, cp).filter((e) => e.partId !== P);
  const insert = () => {
    if (!(isMale(kind) && isHole(Cc.kind) && axisOfDir(dir) === Cc.axis)) return null;
    if (others.some((e) => isMale(e.cell.kind))) return null;
    if (!mateType(kind, Cc.kind)) return null;
    if (!newPart) {
      const b: Vec3i = [Cc.x - n[0], Cc.y - n[1], Cc.z - n[2]];
      const q = cellsAt(m, b).find((e) => e.partId !== P && isMale(e.cell.kind) && e.cell.axis === Cc.axis);
      if (q && canAddCell(m, q.partId, makeCell(cp[0], cp[1], cp[2], kind, Cc.axis)).ok) return { action: 'insert', valid: [Cc.axis], target: q.partId };
    }
    return canAddCell(m, null, makeCell(cp[0], cp[1], cp[2], kind, Cc.axis)).ok ? { action: 'insert', valid: [Cc.axis], target: null } : null;
  };
  const sleeve = () => {
    if (!(isHole(kind) && isMale(Cc.kind))) return null;
    if (others.some((e) => isHole(e.cell.kind))) return null;
    if (!mateType(Cc.kind, kind)) return null;
    return canAddCell(m, null, makeCell(cp[0], cp[1], cp[2], kind, Cc.axis)).ok ? { action: 'sleeve', valid: [Cc.axis], target: null } : null;
  };
  if (!newPart) {
    const v = refValid(m, P, T, kind);
    // DEVIATIONS §7: a hole tool on a rod's axial end sleeves first; Extend's perpendicular
    // orientations follow in the same [R] options.
    if (isHole(kind) && isMale(Cc.kind) && axisOfDir(dir) === Cc.axis) {
      const sl = sleeve();
      const ex = v.filter((a) => a !== Cc.axis);
      // the axis chosen with [R] tells which: a perpendicular one shows Extend
      if (sl) return axisPref !== null && ex.includes(axisPref) ? { action: 'extend', valid: [Cc.axis, ...ex], target: P } : { action: 'sleeve', valid: [Cc.axis, ...ex], target: null };
    }
    if (v.length) return { action: 'extend', valid: v, target: P };
    return insert() ?? sleeve();
  }
  const i = insert() ?? sleeve();
  if (i) return i;
  const v = refValid(m, null, T, kind);
  return v.length ? { action: 'newAdjacent', valid: v, target: null } : null;
}

describe('fuzz: random walks through resolveBuild / resolveErase', () => {
  it('every applied proposal validates; action and valid set match a §7.3 reference; apply is pure', () => {
    const R = rng(12345);
    let checked = 0;
    for (let walk = 0; walk < 30; walk++) {
      let m = emptyModel();
      let s = st('pinHole');
      for (let step = 0; step < 150; step++) {
        const tool: Tool = R() < 0.12 ? 'erase' : KINDS[Math.floor(R() * 5)]!;
        s = selectTool(s, tool);
        s = setNewPart(s, R() < 0.25);
        if (tool === 'erase') {
          if (!m.parts.length) continue;
          const part = m.parts[Math.floor(R() * m.parts.length)]!;
          const ci = Math.floor(R() * part.cells.length);
          const e = resolveErase(m, { partId: part.id, cellIndex: ci, dir: 0 });
          expect(e.valid).toBe(true);
          const m2 = e.apply(e.baseModel);
          expect(validateModel(m2)).toEqual([]);
          m = m2;
          continue;
        }
        let p: Proposal;
        if (!m.parts.length || R() < 0.08) {
          const g = { pos: [Math.floor(R() * 7) - 3, 0, Math.floor(R() * 7) - 3] as Vec3i };
          p = resolveBuild(m, null, g, s);
          expect(p.action).toBe('newOnGrid');
        } else {
          const part = m.parts[Math.floor(R() * m.parts.length)]!;
          const ci = Math.floor(R() * part.cells.length);
          const cell = part.cells[ci]!;
          const dir = Math.floor(R() * 6) as Dir;
          p = resolveBuild(m, { partId: part.id, cellIndex: ci, dir }, null, s);
          const ref = refAction(m, part.id, cell, dir, tool as Kind, s.newPart, s.axisPref);
          const sleeveOrExtend = !s.newPart && isHole(tool as Kind) && isMale(cell.kind) && axisOfDir(dir) === cell.axis && p.options[0] === cell.axis && p.options.length > 1;
          if (ref) {
            expect(p.valid).toBe(true);
            expect(p.action).toBe(ref.action);
            expect([...p.options].sort()).toEqual([...ref.valid].sort());
            expect(p.targetPartId ?? null).toBe(ref.target);
            // natural default (§7.3) for extend / newAdjacent
            if ((p.action === 'extend' && !sleeveOrExtend) || p.action === 'newAdjacent') {
              const n = DIRS[dir]!;
              const T: Vec3i = [cell.x + n[0], cell.y + n[1], cell.z + n[2]];
              const occ = cellsAt(m, T).filter((e) => p.action === 'newAdjacent' || e.partId !== part.id);
              const occAxis = occ.length === 1 && isMale(occ[0]!.cell.kind) !== isMale(tool as Kind) ? occ[0]!.cell.axis : null;
              let want: Axis;
              if (occAxis !== null && ref.valid.includes(occAxis)) want = occAxis;
              else if (isMale(tool as Kind)) want = ref.valid.includes(axisOfDir(dir)) ? axisOfDir(dir) : p.options[0]!;
              else if (isHole(cell.kind)) want = ref.valid.includes(cell.axis) ? cell.axis : p.options[0]!;
              else want = ([0, 1, 2] as Axis[]).find((a) => ref.valid.includes(a))!;
              expect(p.options[0]).toBe(want);
            }
            // [R] shows the next option on re-resolve
            if (p.options.length > 1) {
              const shown = p.cell!.axis;
              const s2 = cycleOrientation(s, p);
              const p2 = resolveBuild(m, { partId: part.id, cellIndex: ci, dir }, null, s2);
              const i = p.options.indexOf(shown);
              expect(p2.cell!.axis).toBe(p.options[(i + 1) % p.options.length]);
              if (sleeveOrExtend) expect(p2.action).toBe(p2.cell!.axis === cell.axis ? 'sleeve' : 'extend');
              else expect(p2.action).toBe(p.action);
            }
          } else {
            expect(p.valid).toBe(false);
            expect(p.reason).toBeTruthy();
            expect(p.options).toEqual([]);
            expect(() => p.apply(p.baseModel)).toThrow();
          }
          checked++;
        }
        if (R() < 0.3 && p.options.length > 1) s = cycleOrientation(s, p); // persists to later hovers
        if (!p.valid) continue;
        expect(p.options).toContain(p.cell!.axis);
        const before = serialize(m);
        const r1 = p.apply(p.baseModel);
        const r2 = p.apply(p.baseModel);
        expect(serialize(m)).toBe(before);
        expect(serialize(r1.model)).toBe(serialize(r2.model));
        expect(validateModel(r1.model)).toEqual([]);
        const part = partById(r1.model, r1.partId)!;
        expect(part.cells).toContainEqual(p.cell);
        expect(p.createsPart).toBe(!partById(m, r1.partId));
        if (p.createsPart) expect(part.color).toBe(p.color);
        m = r1.model;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });
});

// ---------------------------------------------------------------------------------------------
// Picking

/** Independent slab test: entry t (>= 0) and entered face, or null (grazes miss). */
function bruteBox(r: Ray, c: Vec3i): { t: number; dir: Dir } | null {
  let tn = -Infinity;
  let tf = Infinity;
  let ax = -1;
  for (let a = 0; a < 3; a++) {
    const o = r.origin[a]!;
    const d = r.dir[a]!;
    const lo = c[a]! - 0.5;
    const hi = c[a]! + 0.5;
    if (d === 0) {
      if (o < lo || o > hi) return null;
      continue;
    }
    const t1 = Math.min((lo - o) / d, (hi - o) / d);
    const t2 = Math.max((lo - o) / d, (hi - o) / d);
    if (t1 > tn) {
      tn = t1;
      ax = a;
    }
    tf = Math.min(tf, t2);
  }
  if (tf - tn <= 1e-9 || tf <= 1e-9) return null;
  return { t: Math.max(tn, 0), dir: (2 * ax + (r.dir[ax]! > 0 ? 1 : 0)) as Dir };
}

function randomModel(R: () => number, nParts: number): Model {
  let m = emptyModel();
  for (let i = 0; i < nParts * 4 && m.parts.length < nParts; i++) {
    const k = KINDS[Math.floor(R() * 5)]!;
    const a = Math.floor(R() * 3) as Axis;
    const x = Math.floor(R() * 9) - 4, y = Math.floor(R() * 9) - 4, z = Math.floor(R() * 9) - 4;
    const cells = [C(x, y, z, k, a)];
    // grow a few cells along axis or sideways for holes
    const len = 1 + Math.floor(R() * 3);
    for (let j = 1; j < len; j++) {
      const d: number[] = [0, 0, 0];
      d[isHole(k) ? (a + 1) % 3 : a] = j;
      cells.push(C(x + d[0]!, y + d[1]!, z + d[2]!, k, a));
    }
    try {
      m = addPart(m, cells).model;
    } catch {
      /* conflict, skip */
    }
  }
  return m;
}

describe('pickCell vs brute force', () => {
  it('nearest t and face agree with an independent slab test (no shared cells)', () => {
    const R = rng(777);
    let hits = 0;
    for (let k = 0; k < 300; k++) {
      const m = randomModel(R, 12);
      const shared = m.parts.some((p) => p.cells.some((c) => cellsAt(m, [c.x, c.y, c.z]).length > 1));
      for (let j = 0; j < 20; j++) {
        const o: Vec3 = [R() * 20 - 10, R() * 20 - 10, R() * 20 - 10];
        const tgt: Vec3 = [R() * 8 - 4, R() * 8 - 4, R() * 8 - 4];
        const ray: Ray = { origin: o, dir: [tgt[0] - o[0], tgt[1] - o[1], tgt[2] - o[2]] };
        let best: { t: number; dir: Dir; partId: number; idx: number } | null = null;
        for (const p of m.parts)
          p.cells.forEach((c, idx) => {
            const h = bruteBox(ray, [c.x, c.y, c.z]);
            if (h && (!best || h.t < best.t - 1e-9)) best = { ...h, partId: p.id, idx };
          });
        const h = pickCell(m, ray);
        if (!best) {
          expect(h).toBeNull();
          continue;
        }
        expect(h).not.toBeNull();
        const b = best as { t: number; dir: Dir; partId: number; idx: number };
        expect(h!.t).toBeCloseTo(b.t, 7);
        expect(h!.dir).toBe(b.dir);
        if (!shared) {
          expect(h!.partId).toBe(b.partId);
          expect(h!.cellIndex).toBe(b.idx);
        }
        hits++;
      }
    }
    expect(hits).toBeGreaterThan(500);
  });

  it('shared cell disambiguation from each of the six faces', () => {
    for (const a of [0, 1, 2] as Axis[]) {
      const m = modelOf([C(0, 0, 0, 'pinHole', a)], [C(0, 0, 0, 'pin', a)]);
      for (let d = 0; d < 6; d++) {
        const n = DIRS[d]!;
        const axial = axisOfDir(d as Dir) === a;
        for (const off of [0, R_ROD - 0.01, R_ROD + 0.01]) {
          const t = ([0, 1, 2] as Axis[]).filter((x) => x !== axisOfDir(d as Dir))[0]!;
          const o: number[] = [n[0] * 3, n[1] * 3, n[2] * 3];
          o[t] = off;
          const h = pickCell(m, { origin: o as unknown as Vec3, dir: [-n[0], -n[1], -n[2]] })!;
          expect(h.dir).toBe(d);
          const wantMale = axial && off < R_ROD;
          expect(h.partId).toBe(wantMale ? 2 : 1);
        }
      }
    }
  });

  it('identical transform on every part = picking with the inverse-transformed ray', () => {
    const R = rng(99);
    const ang = 0.7;
    const axis = [0.3, -0.5, 0.81];
    const L = Math.hypot(...axis);
    const q = [...axis.map((v) => (v / L) * Math.sin(ang / 2)), Math.cos(ang / 2)] as unknown as PartTransform['q'];
    const tf: PartTransform = { p: [1.5, -2, 0.25], q };
    const rot = (v: Vec3): Vec3 => {
      const [x, y, z, w] = q;
      const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
      return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
    };
    for (let k = 0; k < 50; k++) {
      const m = randomModel(R, 8);
      for (let j = 0; j < 20; j++) {
        const o: Vec3 = [R() * 20 - 10, R() * 20 - 10, R() * 20 - 10];
        const d: Vec3 = [R() - 0.5, R() - 0.5, R() - 0.5];
        const h0 = pickCell(m, { origin: o, dir: d });
        const ow = rot(o);
        const world: Ray = { origin: [ow[0] + tf.p[0], ow[1] + tf.p[1], ow[2] + tf.p[2]], dir: rot(d) };
        const h1 = pickCell(m, world, { transform: () => tf });
        expect(h1 === null).toBe(h0 === null);
        if (h0 && h1) {
          expect(h1.partId).toBe(h0.partId);
          expect(h1.cellIndex).toBe(h0.cellIndex);
          expect(h1.dir).toBe(h0.dir);
          expect(h1.t).toBeCloseTo(h0.t, 7);
        }
      }
    }
  });

  it('filter excluding the hole part must not make the pin inside it unpickable', () => {
    // Beam 1 (hole), pin 2 sticking through it. Grab-only-dynamic style filter: skip part 1.
    const m = modelOf([C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2)], [C(0, 0, 0, 'pin', 2), C(0, 0, -1, 'pin', 2)]);
    // ray along −Z through the pin's axis, hitting the shared cell (0,0,0) first from +Z
    const h = pickCell(m, { origin: [0, 0, 5], dir: [0, 0, -1] }, { filter: (p) => p.id !== 1 });
    expect(h).not.toBeNull();
    expect(h!.partId).toBe(2);
    expect(h!.pos).toEqual([0, 0, 0]); // the shared cell is the nearest cube of part 2
  });

  it('filter excluding the pin part must not return the pin', () => {
    const m = modelOf([C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2)], [C(0, 0, 0, 'pin', 2), C(0, 0, -1, 'pin', 2)]);
    const h = pickCell(m, { origin: [0, 0, 5], dir: [0, 0, -1] }, { filter: (p) => p.id !== 2 });
    expect(h).not.toBeNull();
    expect(h!.partId).toBe(1);
  });

  it('edge entry (exact 45° view): the reported face must not point into an occupied neighbour', () => {
    // A at origin, B at +X. A ray along (−1,−1,0) grazes B's edge and enters A exactly through
    // its (+X,+Y) edge. Reporting +X makes Extend target B's cell (always invalid); +Y is free.
    const m = modelOf([C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2)]);
    const h = pickCell(m, { origin: [1.5, 1.5, 0.1], dir: [-1, -1, 0] })!;
    expect(h.cellIndex).toBe(0);
    const n = DIRS[h.dir]!;
    expect(cellsAt(m, [n[0], n[1], n[2]]).length).toBe(0);
  });

  it('pickGrid: parallel, behind, from below, halves', () => {
    expect(pickGrid({ origin: [0, 5, 0], dir: [1, 0, 0] })).toBeNull();
    expect(pickGrid({ origin: [0, 5, 0], dir: [0, 1, 0] })).toBeNull();
    const b = pickGrid({ origin: [0.5, -3, -0.5], dir: [0, 1, 0] })!;
    expect(b.dir).toBe(3);
    expect(b.pos).toEqual([1, 0, 0]);
    expect(Object.is(b.pos[2], -0)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Selection ops

function cam(yaw: number, pitch: number): CameraBasis {
  const back: Vec3 = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
  const right: Vec3 = [Math.cos(yaw), 0, -Math.sin(yaw)];
  const up: Vec3 = [back[1] * right[2] - back[2] * right[1], back[2] * right[0] - back[0] * right[2], back[0] * right[1] - back[1] * right[0]];
  return { right, up, forward: [-back[0], -back[1], -back[2]] };
}

describe('selection ops', () => {
  const cams: CameraBasis[] = [];
  const R = rng(4242);
  for (let i = 0; i < 400; i++) cams.push(cam((R() * 2 - 1) * Math.PI, (R() - 0.5) * Math.PI));
  for (let y = -4; y < 4; y++) for (const p of [-2, -1, 0, 1, 2]) cams.push(cam((y * Math.PI) / 4, (p * Math.PI) / 4));
  // exact top / bottom views built by hand (screen up = −Z / +Z)
  cams.push({ right: [1, 0, 0], up: [0, 0, -1], forward: [0, -1, 0] });
  cams.push({ right: [1, 0, 0], up: [0, 0, 1], forward: [0, 1, 0] });
  cams.push({ right: [0, 0, 1], up: [1, 0, 0], forward: [0, -1, 0] });

  it('three distinct axes; → moves right on screen, ↑ up, PageUp toward the viewer', () => {
    for (const c of cams) {
      const s = screenAxes(c);
      expect(new Set([s.right.axis, s.up.axis, s.depth.axis]).size).toBe(3);
      const r = moveDelta(c, 'right');
      const u = moveDelta(c, 'up');
      const pu = moveDelta(c, 'pageUp');
      const dot = (a: Vec3i, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(dot(r, c.right)).toBeGreaterThanOrEqual(0);
      expect(dot(u, c.up)).toBeGreaterThanOrEqual(0);
      expect(dot(pu, c.forward)).toBeLessThanOrEqual(1e-12);
    }
  });

  it("']' turns a part clockwise on screen from every side", () => {
    for (const c of cams) {
      const { axis, quarterTurns } = viewRotation(c, ']');
      if (Math.abs(c.forward[axis]) < 0.2) continue;
      // a probe offset perpendicular to the axis, rotated by quarterTurns about +axis (right-hand)
      const u: number[] = [0, 0, 0];
      u[(axis + 1) % 3] = 1;
      const v: number[] = [0, 0, 0];
      v[(axis + 2) % 3] = 1; // u × v = +axis
      const after = quarterTurns > 0 ? v : v.map((x) => -x);
      const sx = (w: number[]) => [w[0]! * c.right[0] + w[1]! * c.right[1] + w[2]! * c.right[2], w[0]! * c.up[0] + w[1]! * c.up[1] + w[2]! * c.up[2]];
      const a = sx(u);
      const b = sx(after);
      // clockwise on screen: cross(a, b) z-component < 0
      expect(a[0]! * b[1]! - a[1]! * b[0]!).toBeLessThan(0);
    }
  });

  it('rotateSelection really rotates the cells clockwise in the top view', () => {
    const m = modelOf([C(0, 0, 0, 'pinHole', 1), C(1, 0, 0, 'pinHole', 1)]);
    const top: CameraBasis = { right: [1, 0, 0], up: [0, 0, -1], forward: [0, -1, 0] };
    const r = rotateSelection(m, 1, top, ']');
    expect(r.ok).toBe(true);
    if (r.ok) {
      // +X (screen right) should go to screen down = +Z
      expect(partById(r.model, 1)!.cells.map((c) => [c.x, c.y, c.z])).toContainEqual([0, 0, 1]);
    }
  });

  it('a refused rotation states the real reason (not always "collide")', () => {
    // beam with a pin of another part through it: rotating the beam about Y turns the Z hole into
    // an X hole around the Z pin -> not coaxial. Nothing "collides".
    const m = modelOf([C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2)], [C(0, 0, 0, 'pin', 2), C(0, 0, 1, 'pin', 2)]);
    const top: CameraBasis = { right: [1, 0, 0], up: [0, 0, -1], forward: [0, -1, 0] };
    const r = rotateSelection(m, 1, top, ']');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/coaxial/);
  });

  it('duplicate never overlaps or mates; delete of the root resets the root', () => {
    const m = modelOf([C(0, 0, 0, 'pinHole', 2), C(1, 0, 0, 'pinHole', 2)], [C(0, 0, 0, 'pin', 2), C(0, 0, 1, 'pin', 2)]);
    for (const id of [1, 2]) {
      const r = duplicateSelection(m, id);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(validateModel(r.model)).toEqual([]);
      const copy = partById(r.model, r.partId!)!;
      for (const c of copy.cells) expect(cellsAt(r.model, [c.x, c.y, c.z]).length).toBe(1);
    }
    const root = { ...m, rootPartId: 1 };
    const d = deleteSelection(root, 1);
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.model.rootPartId).toBeNull();
      expect(d.partId).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// History

describe('History', () => {
  it('redo tail dropped on push; identity no-op keeps tail and does not notify; listeners', () => {
    const a = emptyModel();
    const b = addPart(a, [C(0, 0, 0, 'pin', 1)]).model;
    const c2 = addPart(b, [C(5, 0, 0, 'pin', 1)]).model;
    const h = new History(a);
    let calls = 0;
    const off = h.onChange(() => calls++);
    h.push(b);
    h.push(c2);
    expect(calls).toBe(2);
    h.undo();
    expect(h.canRedo).toBe(true);
    expect(h.push(b)).toBe(false);
    expect(h.canRedo).toBe(true);
    expect(calls).toBe(3);
    h.push(c2); // a different push after undo drops the tail (same object as tail but new entry)
    expect(h.canRedo).toBe(false);
    expect(h.size).toBe(3);
    expect(h.undo()).toBe(b);
    expect(h.undo()).toBe(a);
    expect(h.undo()).toBeNull();
    off();
    h.redo();
    expect(calls).toBe(6);
  });
});
