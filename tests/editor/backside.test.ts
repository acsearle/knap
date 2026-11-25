// Back side (DESIGN §7.3): farSidePick, resolveBuild with backSide, withModifiers / setBackSide.
import { describe, expect, it } from 'vitest';
import { AXES, KINDS, addCell, addPart, canAddCell, emptyModel, makeCell, partById, validateModel } from '../../src/core';
import type { Axis, Dir, Kind, Model } from '../../src/core';
import {
  DIR_LABELS,
  cycleOrientation,
  farSidePick,
  initialToolState,
  pickColor,
  resolveBuild,
  selectTool,
  setBackSide,
  setNewPart,
  withModifiers,
  withShift,
} from '../../src/editor';
import type { CellPick, Proposal, ToolState } from '../../src/editor';
import { c, modelOf } from './helpers';

function st(tool: Kind | 'select' | 'erase', opts: { newPart?: boolean; backSide?: boolean; axisPref?: Axis | null } = {}): ToolState {
  let s = setBackSide(setNewPart(selectTool(initialToolState('#3b74c4'), tool), !!opts.newPart), !!opts.backSide);
  if (opts.axisPref !== undefined) s = { ...s, axisPref: opts.axisPref };
  return s;
}

const idx = (m: Model, partId: number, x: number, y: number, z: number): number =>
  partById(m, partId)!.cells.findIndex((q) => q.x === x && q.y === y && q.z === z);

/** Everything but description / shiftHint / backSide / apply must equal the explicit far-side hover's. */
function comparable(p: Proposal): Record<string, unknown> {
  const { description: _d, shiftHint: _h, backSide: _b, apply: _a, ...rest } = p;
  return rest;
}

/** The far-side description: the explicit one with " · back side (dir)" before " — reason". */
function expectedDescription(q: Proposal, dir: Dir): string {
  const tail = q.valid ? '' : ` — ${q.reason}`;
  return `${q.description.slice(0, q.description.length - tail.length)} · back side (${DIR_LABELS[dir]})${tail}`;
}

/** resolveBuild with Back side equals resolveBuild on the explicit far-side pick. */
function checkEquivalent(m: Model, pick: CellPick, s: ToolState): Proposal {
  const back = resolveBuild(m, pick, null, s.backSide ? s : withModifiers(s, { alt: true }));
  const far = farSidePick(m, pick)!;
  // the same state without Back side (a Shift-held New part is kept)
  const { altHeld: _alt, ...rest } = s;
  const plain = resolveBuild(m, far, null, { ...rest, backSide: false });
  expect(comparable(back)).toEqual(comparable(plain));
  if (plain.action === 'none') {
    expect(back.description).toBe(plain.description);
    expect(back.backSide).toBe(false);
  } else {
    expect(back.description).toBe(expectedDescription(plain, far.dir));
    // the Shift hint describes Shift + Back side, so it carries the same suffix
    expect(back.shiftHint).toBe(plain.shiftHint ? `${plain.shiftHint} · back side (${DIR_LABELS[far.dir]})` : '');
    expect(back.backSide).toBe(true);
    expect(back.highlight).toEqual({ pos: (() => { const q = partById(m, far.partId)!.cells[far.cellIndex]!; return [q.x, q.y, q.z]; })(), dir: far.dir });
  }
  if (plain.valid) expect(JSON.stringify(back.apply(m))).toBe(JSON.stringify(plain.apply(m)));
  else expect(() => back.apply(m)).toThrow();
  return back;
}

describe('farSidePick', () => {
  it('a 1-cell part: every face maps to the opposite face of the same cell', () => {
    for (const kind of KINDS) {
      const m = modelOf([c(3, 1, -2, kind, 1)]);
      for (let d = 0; d < 6; d++) {
        expect(farSidePick(m, { partId: 1, cellIndex: 0, dir: d as Dir })).toEqual({ partId: 1, cellIndex: 0, dir: (d ^ 1) as Dir });
      }
    }
  });

  it('a 5-long beam: an end face maps to the far end, 5 cells away; side faces stay in the cell', () => {
    const m = modelOf([0, 1, 2, 3, 4].map((x) => c(x, 0, 0, 'pinHole', 2)));
    expect(farSidePick(m, { partId: 1, cellIndex: 0, dir: 1 })).toEqual({ partId: 1, cellIndex: 4, dir: 0 });
    expect(farSidePick(m, { partId: 1, cellIndex: 4, dir: 0 })).toEqual({ partId: 1, cellIndex: 0, dir: 1 });
    // hovered on a middle cell's top face: through the 1-cell thickness
    expect(farSidePick(m, { partId: 1, cellIndex: 2, dir: 2 })).toEqual({ partId: 1, cellIndex: 2, dir: 3 });
    expect(farSidePick(m, { partId: 1, cellIndex: 2, dir: 4 })).toEqual({ partId: 1, cellIndex: 2, dir: 5 });
    // a build on the far end: Extend at x = 5, "back side (+X)"
    const p = resolveBuild(m, { partId: 1, cellIndex: 0, dir: 1 }, null, st('pinHole', { backSide: true }));
    expect(p.action).toBe('extend');
    expect(p.cell).toMatchObject({ x: 5, y: 0, z: 0 });
    expect(p.highlight).toEqual({ pos: [4, 0, 0], dir: 0 });
    expect(p.description).toBe('Extend part 1 · pin hole ∥ Z · back side (+X)');
    // and its back face (−Z) from the front (+Z)
    const q = resolveBuild(m, { partId: 1, cellIndex: 2, dir: 4 }, null, st('pinHole', { backSide: true }));
    expect(q.cell).toMatchObject({ x: 2, y: 0, z: -1 });
    expect(q.description).toBe('Extend part 1 · pin hole ∥ Z · back side (−Z)');
  });

  it('L-shaped parts: the walk stops where the part ends along the line', () => {
    // (0,0,0) (1,0,0) (2,0,0) and up (2,1,0) (2,2,0)
    const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(2, 0, 0, 'pinHole', 2), c(2, 1, 0, 'pinHole', 2), c(2, 2, 0, 'pinHole', 2)]);
    const at = (x: number, y: number) => idx(m, 1, x, y, 0);
    // top of the upright, from above: down to the corner
    expect(farSidePick(m, { partId: 1, cellIndex: at(2, 2), dir: 2 })).toEqual({ partId: 1, cellIndex: at(2, 0), dir: 3 });
    // the left end, from the left: along the row to the corner
    expect(farSidePick(m, { partId: 1, cellIndex: at(0, 0), dir: 1 })).toEqual({ partId: 1, cellIndex: at(2, 0), dir: 0 });
    // the upright's middle from the left: leaves the part at once (no cell at (1,1,0))
    expect(farSidePick(m, { partId: 1, cellIndex: at(2, 1), dir: 1 })).toEqual({ partId: 1, cellIndex: at(2, 1), dir: 0 });
    // the corner from below: up the upright
    expect(farSidePick(m, { partId: 1, cellIndex: at(2, 0), dir: 3 })).toEqual({ partId: 1, cellIndex: at(2, 2), dir: 2 });
    // the corner from the right: back along the row
    expect(farSidePick(m, { partId: 1, cellIndex: at(2, 0), dir: 0 })).toEqual({ partId: 1, cellIndex: at(0, 0), dir: 1 });
  });

  it('shared cells: the walk stays inside the picked part (pin or hole)', () => {
    // beam (part 1) along X; a 3-long pin (part 2) through its middle hole, sticking out both sides
    const m = modelOf(
      [0, 1, 2].map((x) => c(x, 0, 0, 'pinHole', 2)),
      [c(1, 0, -1, 'pin', 2), c(1, 0, 0, 'pin', 2), c(1, 0, 1, 'pin', 2)],
    );
    expect(validateModel(m)).toEqual([]);
    // the pin's front end → its back end
    expect(farSidePick(m, { partId: 2, cellIndex: idx(m, 2, 1, 0, 1), dir: 4 })).toEqual({ partId: 2, cellIndex: idx(m, 2, 1, 0, -1), dir: 5 });
    // the pin where it is inside the hole: still the pin's run
    expect(farSidePick(m, { partId: 2, cellIndex: idx(m, 2, 1, 0, 0), dir: 4 })).toEqual({ partId: 2, cellIndex: idx(m, 2, 1, 0, -1), dir: 5 });
    // the hole around the pin: the beam is one cell thick, so its own back face
    expect(farSidePick(m, { partId: 1, cellIndex: idx(m, 1, 1, 0, 0), dir: 4 })).toEqual({ partId: 1, cellIndex: idx(m, 1, 1, 0, 0), dir: 5 });
    // and along the beam from its end, through the shared cell
    expect(farSidePick(m, { partId: 1, cellIndex: idx(m, 1, 0, 0, 0), dir: 1 })).toEqual({ partId: 1, cellIndex: idx(m, 1, 2, 0, 0), dir: 0 });
    for (const pick of [
      { partId: 2, cellIndex: idx(m, 2, 1, 0, 1), dir: 4 as Dir },
      { partId: 1, cellIndex: idx(m, 1, 1, 0, 0), dir: 4 as Dir },
    ])
      for (const kind of KINDS) checkEquivalent(m, pick, st(kind));
  });

  it('a stale pick gives null and no proposal', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    expect(farSidePick(m, { partId: 9, cellIndex: 0, dir: 0 })).toBeNull();
    expect(farSidePick(m, { partId: 1, cellIndex: 3, dir: 0 })).toBeNull();
    expect(resolveBuild(m, { partId: 9, cellIndex: 0, dir: 0 }, null, st('pin', { backSide: true })).action).toBe('none');
  });
});

describe('resolveBuild with Back side', () => {
  it('far face blocked by another part: the normal resolver decides (insert / invalid with reason)', () => {
    // two beams stacked along Z: A (part 1) at z = 0, B (part 2) at z = −1, right behind A
    const m = modelOf(
      [0, 1, 2].map((x) => c(x, 0, 0, 'pinHole', 2)),
      [0, 1, 2].map((x) => c(x, 0, -1, 'pinHole', 2)),
    );
    // pin from A's front face with Back side: A's back face. Extend into B's hole is invalid (a pin
    // cannot continue coaxially out of its own part's hole), so the pin is inserted into A's hole
    // from behind (1 cell: in front of A, at (0,0,1), there is no hole to push it on through).
    const p = checkEquivalent(m, { partId: 1, cellIndex: 0, dir: 4 }, st('pin'));
    expect(p.action).toBe('insert');
    expect(p.highlight).toEqual({ pos: [0, 0, 0], dir: 5 });
    expect(p.description).toMatch(/· back side \(−Z\)$/);
    // a hole tool there: Extend part 1 at (0,0,−1) collides with B → invalid, with the reason
    const q = checkEquivalent(m, { partId: 1, cellIndex: 0, dir: 4 }, st('pinHole'));
    expect(q.valid).toBe(false);
    expect(q.description).toMatch(/^Extend part 1 · pin hole ∥ Z · back side \(−Z\) — /);
    expect(q.reason).toBeTruthy();
    // a pin on B's back from B's front face (through B): B is behind A, but its own back is free
    const r = checkEquivalent(m, { partId: 2, cellIndex: 1, dir: 4 }, st('pin'));
    expect(r.valid).toBe(true);
    expect(r.highlight).toEqual({ pos: [1, 0, -1], dir: 5 });
  });

  it('sleeve from behind: a hole tool on a pin hovered through its length', () => {
    const m = modelOf([c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]);
    const p = checkEquivalent(m, { partId: 1, cellIndex: 1, dir: 4 }, st('pinHole'));
    expect(p.highlight).toEqual({ pos: [0, 0, 0], dir: 5 });
    expect(p.action).toBe('sleeve');
    expect(p.cell).toMatchObject({ x: 0, y: 0, z: 0 });
  });

  it('grid hover with Back side on (nothing hovered) is unchanged', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    for (const kind of KINDS) {
      const a = resolveBuild(m, null, { pos: [3, 0, 2] }, st(kind, { backSide: true }));
      const b = resolveBuild(m, null, { pos: [3, 0, 2] }, st(kind));
      expect(comparable(a)).toEqual(comparable(b));
      expect(a.description).toBe(b.description);
      expect(a.backSide).toBe(false);
    }
  });

  it('Shift, New part and [R] combine with Back side', () => {
    const m = modelOf([0, 1, 2, 3, 4].map((x) => c(x, 0, 0, 'pinHole', 2)));
    const pick: CellPick = { partId: 1, cellIndex: 0, dir: 1 };
    // Shift + Alt: new adjacent part beyond the far end
    const sa = withModifiers(st('pinHole'), { shift: true, alt: true });
    expect(sa).toMatchObject({ newPart: true, backSide: true, shiftHeld: true, altHeld: true });
    const p = checkEquivalent(m, pick, sa);
    expect(p.action).toBe('newAdjacent');
    expect(p.cell).toMatchObject({ x: 5 });
    expect(p.description).toBe('New part · pin hole ∥ Z · back side (+X)');
    // [N] on + [B] on
    expect(comparable(resolveBuild(m, pick, null, st('pinHole', { newPart: true, backSide: true })))).toEqual(comparable(p));
    // [R]: cycles within the far-side options and persists
    const s0 = st('pinHole', { backSide: true });
    const q0 = checkEquivalent(m, pick, s0);
    expect(q0.options.length).toBeGreaterThan(1);
    const s1 = cycleOrientation(s0, q0);
    expect(s1.backSide).toBe(true);
    const q1 = checkEquivalent(m, pick, s1);
    expect(q1.cell!.axis).toBe(q0.options[1]);
    // the Shift hint is the far side's, said as a back-side click, and it is what Shift + Back side does
    const r = resolveBuild(m, pick, null, s0);
    const far = farSidePick(m, pick)!;
    expect(r.shiftHint).toBe(`${resolveBuild(m, far, null, st('pinHole')).shiftHint} · back side (${DIR_LABELS[far.dir]})`);
    if (r.shiftHint) expect(r.shiftHint).toBe(`Shift: ${resolveBuild(m, pick, null, withModifiers(s0, { shift: true })).description}`);
  });

  it('Select and Erase ignore Back side', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    expect(resolveBuild(m, { partId: 1, cellIndex: 0, dir: 0 }, null, st('select', { backSide: true })).action).toBe('none');
    expect(resolveBuild(m, { partId: 1, cellIndex: 0, dir: 0 }, null, st('erase', { backSide: true })).action).toBe('none');
  });

  it('fuzz: equals resolveBuild on the explicit far-side hit', () => {
    let seed = 12345;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    let checked = 0;
    for (let trial = 0; trial < 60; trial++) {
      let m = emptyModel();
      for (let k = 0; k < 40; k++) {
        const cell = makeCell(rnd(5) - 2, rnd(3) - 1, rnd(5) - 2, KINDS[rnd(5)]!, AXES[rnd(3)]!);
        const target = m.parts.length && rnd(3) ? m.parts[rnd(m.parts.length)]!.id : null;
        if (!canAddCell(m, target, cell).ok) continue;
        m = target === null ? addPart(m, [cell]).model : addCell(m, target, cell);
      }
      expect(validateModel(m)).toEqual([]);
      for (const part of m.parts)
        for (let i = 0; i < part.cells.length; i++) {
          const dir = rnd(6) as Dir;
          const kind = KINDS[rnd(5)]!;
          const s = st(kind, { newPart: rnd(2) === 1, axisPref: rnd(2) ? null : AXES[rnd(3)]! });
          checkEquivalent(m, { partId: part.id, cellIndex: i, dir }, s);
          checked++;
        }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('Back side state', () => {
  it('Alt never latches backSide; the [B] toggle survives tool changes and modifiers', () => {
    const base = st('pin');
    const alt = withModifiers(base, { alt: true });
    expect(alt.backSide).toBe(true);
    expect(withModifiers(alt, {})).toEqual(base);
    expect(withShift(alt, false)).toEqual(base);
    expect(selectTool(alt, 'axle').backSide).toBe(false);
    expect(pickColor(alt, '#112233').backSide).toBe(false);
    expect(setNewPart(alt, true)).toMatchObject({ newPart: true, backSide: false });
    expect(setBackSide(alt, true).altHeld).toBeUndefined();
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    const p = resolveBuild(m, { partId: 1, cellIndex: 0, dir: 0 }, null, alt);
    expect(cycleOrientation(alt, p).backSide).toBe(false);
    // toggled on: the base state, kept by Alt and by tool changes (like New part)
    const on = st('pin', { backSide: true });
    expect(withModifiers(on, { alt: true })).toBe(on);
    expect(withModifiers(on, { alt: false })).toBe(on);
    expect(selectTool(on, 'erase').backSide).toBe(true);
    expect(selectTool(selectTool(on, 'erase'), 'pin').backSide).toBe(true);
    // Shift + Alt, then Shift released: still Alt's back side, no New part
    const both = withModifiers(base, { shift: true, alt: true });
    expect(withModifiers(both, { alt: true })).toMatchObject({ newPart: false, backSide: true });
    expect(initialToolState().backSide).toBe(false);
  });
});
