import { describe, expect, it } from 'vitest';
import { DEFAULT_COLORS, KINDS, isHole, isMale, mateType, partById, validateModel } from '../../src/core';
import type { Axis, Dir, Kind, Model } from '../../src/core';
import {
  STALE_PROPOSAL,
  cycleOrientation,
  describeHover,
  initialToolState,
  newPartColor,
  pickColor,
  resolveBuild,
  resolveErase,
  resolveSelect,
  selectTool,
  setNewPart,
  withShift,
} from '../../src/editor';
import type { BuildAction, Proposal, ToolState } from '../../src/editor';
import { c, modelOf } from './helpers';

function st(tool: Kind | 'select' | 'erase', newPart = false): ToolState {
  return setNewPart(selectTool(initialToolState('#3b74c4'), tool), newPart);
}

function hover(m: Model, partId: number, cellIndex: number, dir: Dir, s: ToolState): Proposal {
  return resolveBuild(m, { partId, cellIndex, dir }, null, s);
}

/** apply() must produce a valid model containing the ghost cell in the stated part. */
function checkApply(m: Model, p: Proposal) {
  const r = p.apply(m);
  expect(validateModel(r.model)).toEqual([]);
  const part = partById(r.model, r.partId)!;
  expect(part.cells).toContainEqual(p.cell);
  if (p.createsPart) {
    expect(r.partId).toBe(m.nextPartId);
    expect(part.cells.length).toBe(1);
    expect(part.color).toBe(p.color);
  } else {
    expect(r.partId).toBe(p.targetPartId);
    expect(part.cells.length).toBe(partById(m, r.partId)!.cells.length + 1);
  }
  return r;
}

// ---------------------------------------------------------------------------------------------
// §7.3 table: every tool kind × every kind of clicked cell × face class × newPart.
// Clicked cell: a single-cell part 1 at the origin with axis Z. Axial face = +Z (T = (0,0,1)),
// lateral face = +X (T = (1,0,0)). Expectations are restated from §7.3 directly:

type Row = {
  tool: Kind;
  clicked: Kind;
  face: 'axial' | 'lateral';
  newPart: boolean;
  action: BuildAction;
  valid: boolean;
  /** valid orientations in [R] order (natural default first) */
  options: Axis[];
  /** ghost cell position */
  at: [number, number, number];
  reason?: RegExp;
};

const fits = (male: Kind, hole: Kind) => mateType(male, hole) !== null;

function expected(tool: Kind, clicked: Kind, face: 'axial' | 'lateral', newPart: boolean): Omit<Row, 'tool' | 'clicked' | 'face' | 'newPart'> {
  const T: [number, number, number] = face === 'axial' ? [0, 0, 1] : [1, 0, 0];
  const C: [number, number, number] = [0, 0, 0];
  const nAxis: Axis = face === 'axial' ? 2 : 0;
  const cyc = (a: Axis): Axis[] => [a, ((a + 1) % 3) as Axis, ((a + 2) % 3) as Axis];
  // natural default order for a new cell at T
  const adjOrder: Axis[] = isMale(tool) ? cyc(nAxis) : isHole(clicked) ? cyc(2) : [0, 1, 2];
  if (!newPart) {
    // 1. Extend: hole–hole always; male tool needs male ∥ n and (clicked male ∥ n or clicked hole ⟂ n);
    //    hole tool next to a male needs male ∥ n and the hole ⟂ n.
    if (isHole(tool) && isHole(clicked)) return { action: 'extend', valid: true, options: adjOrder, at: T };
    if (isHole(tool) && isMale(clicked) && face === 'axial') return { action: 'extend', valid: true, options: [0, 1], at: T };
    if (isMale(tool) && isHole(clicked) && face === 'lateral') return { action: 'extend', valid: true, options: [0], at: T };
    if (isMale(tool) && isMale(clicked) && face === 'axial') return { action: 'extend', valid: true, options: [2], at: T };
    // 2. Insert: male tool, compatible hole, axial face.
    if (isMale(tool) && isHole(clicked) && face === 'axial') {
      return fits(tool, clicked)
        ? { action: 'insert', valid: true, options: [2], at: C }
        : { action: 'insert', valid: false, options: [], at: C, reason: /does not fit/ };
    }
    // 3. Sleeve: hole tool, compatible male.
    if (isHole(tool) && isMale(clicked)) {
      return fits(clicked, tool)
        ? { action: 'sleeve', valid: true, options: [2], at: C }
        : { action: 'sleeve', valid: false, options: [], at: C, reason: /does not fit/ };
    }
    // male tool on a male's side: nothing applies
    return { action: 'extend', valid: false, options: [], at: T, reason: /would not attach/ };
  }
  if (isMale(tool) && isHole(clicked) && face === 'axial' && fits(tool, clicked)) return { action: 'insert', valid: true, options: [2], at: C };
  if (isHole(tool) && isMale(clicked) && fits(clicked, tool)) return { action: 'sleeve', valid: true, options: [2], at: C };
  return { action: 'newAdjacent', valid: true, options: adjOrder, at: T };
}

const rows: Row[] = [];
for (const tool of KINDS)
  for (const clicked of KINDS)
    for (const face of ['axial', 'lateral'] as const)
      for (const newPart of [false, true]) rows.push({ tool, clicked, face, newPart, ...expected(tool, clicked, face, newPart) });

describe('resolveBuild §7.3 table (5 tools × 5 clicked kinds × 2 face classes × newPart)', () => {
  it('has 100 rows covering every action', () => {
    expect(rows.length).toBe(100);
    const actions = new Set(rows.map((r) => r.action));
    expect([...actions].sort()).toEqual(['extend', 'insert', 'newAdjacent', 'sleeve']);
    expect(rows.filter((r) => !r.valid).length).toBeGreaterThan(5);
  });

  it.each(rows.map((r) => [`${r.tool} on ${r.clicked} ${r.face}${r.newPart ? ' +new' : ''} → ${r.action}${r.valid ? '' : ' (invalid)'}`, r] as const))(
    '%s',
    (_name, r) => {
      const m = modelOf([c(0, 0, 0, r.clicked, 2)]);
      const p = hover(m, 1, 0, r.face === 'axial' ? 4 : 0, st(r.tool, r.newPart));
      expect(p.action).toBe(r.action);
      expect(p.valid).toBe(r.valid);
      expect(p.options).toEqual(r.options);
      expect(p.cell).not.toBeNull();
      expect([p.cell!.x, p.cell!.y, p.cell!.z]).toEqual(r.at);
      expect(p.cell!.kind).toBe(r.tool);
      expect(p.highlight).toEqual({ pos: [0, 0, 0], dir: r.face === 'axial' ? 4 : 0 });
      expect(p.hoverPartId).toBe(1);
      if (r.valid) {
        expect(p.cell!.axis).toBe(r.options[0]); // natural default
        expect(p.reason).toBeUndefined();
        expect(p.createsPart).toBe(r.action !== 'extend');
        expect(p.targetPartId).toBe(r.action === 'extend' ? 1 : undefined);
        checkApply(m, p);
      } else {
        expect(p.reason).toMatch(r.reason!);
        expect(p.description).toContain(p.reason!);
        expect(() => p.apply(p.baseModel)).toThrow();
      }
    },
  );

  it('the same rules hold for other clicked axes and every face (sampled exhaustively)', () => {
    // Rotate the scenario: clicked axis a, every face direction; compare to the table by face class.
    for (const tool of KINDS)
      for (const clicked of KINDS)
        for (const a of [0, 1, 2] as Axis[])
          for (let d = 0; d < 6; d++)
            for (const newPart of [false, true]) {
              const m = modelOf([c(0, 0, 0, clicked, a)]);
              const p = hover(m, 1, 0, d as Dir, st(tool, newPart));
              const axial = d >> 1 === a;
              const e = expected(tool, clicked, axial ? 'axial' : 'lateral', newPart);
              expect(p.action).toBe(e.action);
              expect(p.valid).toBe(e.valid);
              expect(p.options.length).toBe(e.options.length);
              if (p.valid) {
                // defaults: male tools ∥ n (or the hole axis when inserting); hole tools the clicked hole's axis
                if (p.action === 'insert' || p.action === 'sleeve') expect(p.cell!.axis).toBe(a);
                else if (isMale(tool)) expect(p.cell!.axis).toBe(d >> 1);
                else if (isHole(clicked)) expect(p.cell!.axis).toBe(a);
                else expect(p.cell!.axis).toBe(Math.min(...p.options));
                expect(validateModel(p.apply(p.baseModel).model)).toEqual([]);
              }
            }
  });
});

describe('resolveBuild: occupied targets, preconditions and reasons', () => {
  it('extend into a cell holding an incompatible cell of another part is invalid with the overlap reason', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)], [c(1, 0, 0, 'pinHole', 2)]);
    const p = hover(m, 1, 0, 0, st('pinHole'));
    expect(p.action).toBe('extend');
    expect(p.valid).toBe(false);
    expect(p.reason).toMatch(/two holes cannot share a cell/);
    const pn = hover(m, 1, 0, 0, st('pinHole', true));
    expect(pn.action).toBe('newAdjacent');
    expect(pn.valid).toBe(false);
    expect(pn.reason).toMatch(/two holes cannot share a cell/);
  });

  it('target already holding a compatible cell of another part: the coaxial orientation is preferred (and the only valid one)', () => {
    // part 2: a pin along Y at (1,0,0). Hole tool extending part 1 (+X face): only a Y hole fits.
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)], [c(1, 0, 0, 'pin', 1)]);
    const p = hover(m, 1, 0, 0, st('pinHole'));
    expect(p.action).toBe('extend');
    expect(p.options).toEqual([1]);
    expect(p.cell!.axis).toBe(1);
    const r = checkApply(m, p);
    expect(r.partId).toBe(1);
    // male tool extending into another part's hole: male must be coaxial with it
    const m2 = modelOf([c(0, 0, 0, 'pinHole', 2)], [c(1, 0, 0, 'pinHole', 0)]);
    const q = hover(m2, 1, 0, 0, st('axle'));
    expect(q.valid).toBe(true);
    expect(q.options).toEqual([0]);
    const m3 = modelOf([c(0, 0, 0, 'pinHole', 2)], [c(1, 0, 0, 'pinHole', 1)]);
    const q3 = hover(m3, 1, 0, 0, st('axle'));
    expect(q3.valid).toBe(false);
    // the ghost takes the occupant's (coaxial) axis, which cannot attach; the natural ∥ n axis
    // would not be coaxial — either way invalid
    expect(q3.cell!.axis).toBe(1);
    expect(q3.reason).toMatch(/would not attach/);
    // new-part placement next to the occupant also prefers the occupant's axis first
    const m4 = modelOf([c(0, 0, 0, 'pinHole', 2)], [c(1, 0, 0, 'pin', 1)]);
    const q4 = hover(m4, 1, 0, 0, st('pinHole', true));
    expect(q4.action).toBe('newAdjacent');
    expect(q4.options).toEqual([1]);
  });

  it('grid cell already occupied: coaxial preference, and the occupant axis drives the invalid ghost', () => {
    const bad = resolveBuild(modelOf([c(3, 0, 3, 'axleHole', 0)]), null, { pos: [3, 0, 3] }, st('pin'));
    expect(bad.valid).toBe(false);
    expect(bad.cell!.axis).toBe(0); // the occupant's axis is the ghost default
    expect(bad.reason).toMatch(/pin does not fit an axle hole/);
    const m = modelOf([c(3, 0, 3, 'pinHole', 0)]);
    const g = resolveBuild(m, null, { pos: [3, 0, 3] }, st('pin'));
    expect(g.action).toBe('newOnGrid');
    expect(g.options).toEqual([0]); // only coaxial with the hole there
    const g2 = resolveBuild(m, null, { pos: [3, 0, 3] }, st('pinHole'));
    expect(g2.valid).toBe(false);
    expect(g2.reason).toMatch(/two holes/);
  });

  it('insert into a hole that already holds a male: precise reason', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2)]);
    const p = hover(m, 1, 0, 4, st('pin'));
    expect(p.action).toBe('insert');
    expect(p.valid).toBe(false);
    expect(p.reason).toBe('the pin hole at (0, 0, 0) already holds a pin (part 2)');
    expect(p.description).toBe('New part · insert pin ∥ Z into part 1 — the pin hole at (0, 0, 0) already holds a pin (part 2)');
    // with newPart the specialised (insert) reason is still the one reported if newAdjacent also fails
    const m2 = modelOf([c(0, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2)], [c(0, 0, 1, 'pin', 2), c(0, 0, 2, 'pin', 2)]);
    const p2 = hover(m2, 1, 0, 4, st('axle', true));
    expect(p2.valid).toBe(false);
    expect(p2.action).toBe('insert');
  });

  it('sleeve onto a male that is already in a hole: precise reason', () => {
    const m = modelOf([c(0, 0, 0, 'axleHole', 2)], [c(0, 0, 0, 'axle', 2)]);
    const p = hover(m, 2, 0, 0, st('pinHole'));
    expect(p.action).toBe('sleeve');
    expect(p.valid).toBe(false);
    expect(p.reason).toBe('the axle at (0, 0, 0) is already in an axle hole (part 1)');
  });

  it('incompatible insert / sleeve report the mate-table reason', () => {
    const m = modelOf([c(0, 0, 0, 'axleHole', 2)]);
    expect(hover(m, 1, 0, 4, st('pin')).reason).toBe('pin does not fit an axle hole');
    expect(hover(m, 1, 0, 4, st('frictionPin')).reason).toBe('friction pin does not fit an axle hole');
    const m2 = modelOf([c(0, 0, 0, 'pin', 2)]);
    expect(hover(m2, 1, 0, 0, st('axleHole')).reason).toBe('pin does not fit an axle hole');
  });

  it('insert joins a coaxial male of another part behind the hole (not with newPart)', () => {
    // part 1: Z hole at (0,0,1); part 2: Z hole at (0,0,0); part 3: pin in part 2's hole.
    const m = modelOf([c(0, 0, 1, 'pinHole', 2)], [c(0, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2)]);
    const p = hover(m, 1, 0, 4, st('pin'));
    expect(p.action).toBe('insert');
    expect(p.joins).toBe(true);
    expect(p.createsPart).toBe(false);
    expect(p.targetPartId).toBe(3);
    expect(p.description).toBe('Extend part 3 · insert pin ∥ Z into part 1');
    const r = checkApply(m, p);
    expect(partById(r.model, 3)!.cells.length).toBe(2);
    // seen from the other side (−Z face of part 1): the male is not behind -> plain insert
    const back = hover(m, 1, 0, 5, st('pin'));
    expect(back.action).toBe('insert');
    expect(back.joins).toBe(false);
    // with newPart: always a new part
    const np = hover(m, 1, 0, 4, st('pin', true));
    expect(np.action).toBe('insert');
    expect(np.joins).toBe(false);
    expect(np.createsPart).toBe(true);
    // a perpendicular male behind does not join
    const m2 = modelOf([c(0, 0, 1, 'pinHole', 2)], [c(0, 0, 0, 'pinHole', 0)], [c(0, 0, 0, 'pin', 0)]);
    expect(hover(m2, 1, 0, 4, st('pin')).joins).toBe(false);
  });

  it('grid: New on grid at y = 0, default ∥ Y for every kind, cycling Y → Z → X', () => {
    for (const kind of KINDS) {
      let s = st(kind);
      const g = resolveBuild(modelOfEmpty(), null, { pos: [2, 0, -3] }, s);
      expect(g.action).toBe('newOnGrid');
      expect(g.valid).toBe(true);
      expect(g.cell).toEqual(c(2, 0, -3, kind, 1));
      expect(g.options).toEqual([1, 2, 0]);
      expect(g.highlight).toEqual({ pos: [2, 0, -3], dir: 3 });
      expect(g.description).toBe(`New part on grid · ${kindName(kind)} ∥ Y`);
      expect(g.orientationHint).toBe('[R] 1/3');
      const seen: Axis[] = [];
      for (let i = 0; i < 4; i++) {
        const p = resolveBuild(modelOfEmpty(), null, { pos: [2, 0, -3] }, s);
        seen.push(p.cell!.axis);
        s = cycleOrientation(s, p);
      }
      expect(seen).toEqual([1, 2, 0, 1]);
    }
  });

  it('pick wins over grid; nothing / non-build tool / stale pick -> none', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    expect(resolveBuild(m, { partId: 1, cellIndex: 0, dir: 0 }, { pos: [5, 0, 5] }, st('pinHole')).action).toBe('extend');
    const none = resolveBuild(m, null, null, st('pinHole'));
    expect(none.action).toBe('none');
    expect(none.valid).toBe(false);
    expect(none.cell).toBeNull();
    expect(none.description).toBe('');
    expect(resolveBuild(m, { partId: 1, cellIndex: 0, dir: 0 }, null, st('select')).action).toBe('none');
    expect(resolveBuild(m, { partId: 1, cellIndex: 0, dir: 0 }, null, st('erase')).action).toBe('none');
    expect(resolveBuild(m, { partId: 9, cellIndex: 0, dir: 0 }, null, st('pin')).action).toBe('none');
    expect(resolveBuild(m, { partId: 1, cellIndex: 3, dir: 0 }, null, st('pin')).action).toBe('none');
  });

  it('extend reaches other cells of the part (not only the clicked one)', () => {
    // L of holes: (0,0,0) Z, (1,0,0) Z, (1,1,0) Z. Male tool on the +Y face of (0,0,0):
    // T = (0,1,0) is beside (1,1,0) too; a Y pin connects to (0,0,0)'s wall; an X pin would
    // attach to the wall of (1,1,0) -> both valid.
    const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(1, 1, 0, 'pinHole', 2)]);
    const p = hover(m, 1, 0, 2, st('pin'));
    expect(p.action).toBe('extend');
    expect(p.options).toEqual([1, 0]);
  });
});

function modelOfEmpty(): Model {
  return modelOf();
}
function kindName(k: Kind): string {
  return { pinHole: 'pin hole', axleHole: 'axle hole', axle: 'axle', pin: 'pin', frictionPin: 'friction pin' }[k];
}

describe('descriptions', () => {
  const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(2, 0, 0, 'pinHole', 2)]);
  it('status-bar sentences', () => {
    expect(hover(m, 1, 2, 0, st('pinHole')).description).toBe('Extend part 1 · pin hole ∥ Z');
    expect(hover(m, 1, 0, 4, st('pin')).description).toBe('New part · insert pin ∥ Z into part 1');
    expect(hover(m, 1, 0, 2, st('axle')).description).toBe('Extend part 1 · axle ∥ Y');
    expect(hover(m, 1, 0, 2, st('axleHole', true)).description).toBe('New part · axle hole ∥ Z');
    const pm = modelOf([c(0, 0, 0, 'axle', 0)]);
    expect(hover(pm, 1, 0, 2, st('axleHole')).description).toBe('New part · sleeve axle hole ∥ X onto part 1');
    const bad = hover(modelOf([c(0, 0, 0, 'pin', 2)]), 1, 0, 0, st('pin'));
    expect(bad.description).toBe('Extend part 1 · pin ∥ X — a pin along X at (1, 0, 0) would not attach to part 1');
  });
});

describe('orientation cycling', () => {
  const m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
  const mm = modelOf([c(0, 0, 0, 'pin', 2)]);

  it('[R] steps through the valid options in order and wraps', () => {
    let s = st('pinHole');
    const axes: Axis[] = [];
    for (let i = 0; i < 4; i++) {
      const p = hover(m, 1, 0, 0, s);
      axes.push(p.cell!.axis);
      expect(p.orientationHint).toBe(`[R] ${(i % 3) + 1}/3`);
      s = cycleOrientation(s, p);
    }
    expect(axes).toEqual([2, 0, 1, 2]);
  });

  it('the preference is an axis: kept where valid, default where not, and not forgotten', () => {
    let s = st('pinHole');
    s = cycleOrientation(s, hover(m, 1, 0, 0, s)); // pref X
    s = cycleOrientation(s, hover(m, 1, 0, 0, s)); // pref Y
    expect(s.axisPref).toBe(1);
    // another hover where Y is valid: Y
    expect(hover(m, 1, 0, 2, s).cell!.axis).toBe(1);
    // hole tool on the end of a Z pin: options [X, Y] -> Y kept
    expect(hover(mm, 1, 0, 4, s).cell!.axis).toBe(1);
    // sleeve (only Z valid): Z, preference not used
    const sl = hover(mm, 1, 0, 0, s);
    expect(sl.action).toBe('sleeve');
    expect(sl.cell!.axis).toBe(2);
    expect(cycleOrientation(s, sl)).toBe(s); // < 2 options: no-op
    // back on a hover with Y valid: still Y
    expect(hover(m, 1, 0, 0, s).cell!.axis).toBe(1);
  });

  it('cycling from the default when the preference is not valid here', () => {
    let s = st('pinHole');
    s = { ...s, axisPref: 2 };
    const p = hover(mm, 1, 0, 4, s); // options [0, 1]; Z invalid -> default X
    expect(p.cell!.axis).toBe(0);
    s = cycleOrientation(s, p);
    expect(s.axisPref).toBe(1);
  });

  it('persists while the same tool is active; reset by a tool change', () => {
    let s = st('pinHole');
    s = cycleOrientation(s, hover(m, 1, 0, 0, s));
    expect(selectTool(s, 'pinHole')).toBe(s);
    expect(selectTool(s, 'pinHole').axisPref).toBe(0);
    const s2 = selectTool(selectTool(s, 'pin'), 'pinHole');
    expect(s2.axisPref).toBeNull();
    // newPart toggling / shift keep it
    expect(setNewPart(s, true).axisPref).toBe(0);
    expect(withShift(s, true).axisPref).toBe(0);
  });

  it('invalid proposals have no options and cycling is a no-op', () => {
    const s = st('pin');
    const p = hover(mm, 1, 0, 0, s);
    expect(p.valid).toBe(false);
    expect(p.options).toEqual([]);
    expect(cycleOrientation(s, p)).toBe(s);
  });
});

describe('colours and tool state', () => {
  it('holes take the palette colour, males the kind default unless picked for the current tool', () => {
    const s = st('pin');
    expect(newPartColor(s, 'pinHole')).toBe('#3b74c4');
    expect(newPartColor(s, 'pin')).toBe(DEFAULT_COLORS.pin);
    expect(newPartColor(s, 'axle')).toBe(DEFAULT_COLORS.axle);
    expect(newPartColor(s, 'frictionPin')).toBe(DEFAULT_COLORS.frictionPin);
    const picked = pickColor(s, '#C8433A');
    expect(newPartColor(picked, 'pin')).toBe('#c8433a');
    expect(newPartColor(selectTool(picked, 'axle'), 'axle')).toBe(DEFAULT_COLORS.axle);
    expect(newPartColor(selectTool(picked, 'pinHole'), 'pinHole')).toBe('#c8433a');
    // the proposal carries it, and apply uses it
    const m = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    const p = resolveBuild(m, null, { pos: [4, 0, 4] }, picked);
    expect(p.color).toBe('#c8433a');
    expect(partById(p.apply(p.baseModel).model, 2)!.color).toBe('#c8433a');
    const ext = hover(m, 1, 0, 0, st('pinHole'));
    expect(ext.color).toBeNull();
  });

  it('withShift only ever turns newPart on', () => {
    const s = st('pin');
    expect(withShift(s, false)).toBe(s);
    expect(withShift(s, true).newPart).toBe(true);
    const on = setNewPart(s, true);
    expect(withShift(on, false)).toBe(on);
  });
});

describe('resolveErase / resolveSelect', () => {
  const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(2, 0, 0, 'pinHole', 2)], [c(5, 0, 0, 'pin', 2)]);
  it('shrink, split and remove', () => {
    const end = resolveErase(m, { partId: 1, cellIndex: 2, dir: 0 });
    expect(end.valid).toBe(true);
    expect(end.pieces).toBe(1);
    expect(end.description).toBe('Erase pin hole at (2, 0, 0) from part 1');
    expect(end.highlight).toEqual({ pos: [2, 0, 0], dir: 0 });
    expect(partById(end.apply(end.baseModel), 1)!.cells.length).toBe(2);
    const mid = resolveErase(m, { partId: 1, cellIndex: 1, dir: 2 });
    expect(mid.pieces).toBe(2);
    expect(mid.description).toBe('Erase pin hole at (1, 0, 0) from part 1 · part 1 splits into 2 parts');
    expect(mid.apply(mid.baseModel).parts.length).toBe(3);
    const last = resolveErase(m, { partId: 2, cellIndex: 0, dir: 2 });
    expect(last.pieces).toBe(0);
    expect(last.description).toBe('Erase part 2 (last cell)');
    expect(partById(last.apply(last.baseModel), 2)).toBeUndefined();
    const none = resolveErase(m, null);
    expect(none.valid).toBe(false);
    expect(() => none.apply(none.baseModel)).toThrow();
    expect(resolveErase(m, { partId: 7, cellIndex: 0, dir: 0 }).valid).toBe(false);
  });
  it('select', () => {
    expect(resolveSelect(m, { partId: 1, cellIndex: 0, dir: 0 })).toEqual({ partId: 1, description: 'Select part 1 · 3 cells' });
    expect(resolveSelect(m, { partId: 2, cellIndex: 0, dir: 0 }).description).toBe('Select part 2 · 1 cell');
    expect(resolveSelect(m, null)).toEqual({ partId: null, description: '' });
  });
});

describe('integration safety and presentation (review fixes)', () => {
  const pinPart = () => modelOf([c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]);

  it('apply() refuses a model other than the one the proposal was resolved against', () => {
    const m = pinPart();
    const p = hover(m, 1, 1, 4, st('pinHole'));
    expect(p.valid).toBe(true);
    expect(p.baseModel).toBe(m);
    const after = p.apply(m).model;
    expect(() => p.apply(after)).toThrow(STALE_PROPOSAL);
    // an equal-looking copy is still another model (e.g. after undo + redo of a different edit)
    expect(() => p.apply(JSON.parse(JSON.stringify(m)) as Model)).toThrow(STALE_PROPOSAL);
    const e = resolveErase(m, { partId: 1, cellIndex: 0, dir: 0 });
    expect(e.baseModel).toBe(m);
    expect(() => e.apply(after)).toThrow(STALE_PROPOSAL);
    expect(e.apply(m).parts[0]!.cells.length).toBe(1);
    expect(resolveBuild(m, null, null, st('pin')).baseModel).toBe(m);
  });

  it('Shift never latches newPart on through cycleOrientation / selectTool / pickColor / setNewPart', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 1)]);
    const base = st('pin');
    const shifted = withShift(base, true);
    expect(shifted.newPart).toBe(true);
    expect(withShift(shifted, false)).toEqual(base);
    const p = resolveBuild(m, { partId: 1, cellIndex: 0, dir: 0 }, null, shifted); // New adjacent, 3 axes
    expect(p.options.length).toBe(3);
    const r = cycleOrientation(shifted, p);
    expect(r.newPart).toBe(false);
    expect(r.shiftHeld).toBeUndefined();
    expect(r.axisPref).toBe(p.options[1]);
    expect(pickColor(shifted, '#112233').newPart).toBe(false);
    expect(selectTool(shifted, 'axle').newPart).toBe(false);
    expect(setNewPart(shifted, true)).toMatchObject({ newPart: true });
    expect(setNewPart(shifted, true).shiftHeld).toBeUndefined();
    // a toggled-on newPart is the base state and survives Shift
    const on = st('pin', true);
    expect(withShift(on, true)).toBe(on);
    expect(cycleOrientation(withShift(on, true), p).newPart).toBe(true);
  });

  it('ghostColor: receiving part colour for extend / join, new part colour otherwise', () => {
    const m = pinPart();
    const ext = hover(m, 1, 1, 4, st('pinHole'));
    expect(ext.action).toBe('extend');
    expect(ext.color).toBeNull();
    expect(ext.ghostColor).toBe(partById(m, 1)!.color);
    const grid = resolveBuild(m, null, { pos: [5, 0, 5] }, st('pinHole'));
    expect(grid.ghostColor).toBe('#3b74c4');
    expect(grid.ghostColor).toBe(grid.color);
    const occupied = hover(modelOf([c(0, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2)]), 1, 0, 4, st('pin'));
    expect(occupied.valid).toBe(false);
    expect(occupied.ghostColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('shiftHint names what Shift would do instead', () => {
    const m = pinPart();
    const p = hover(m, 1, 1, 4, st('pinHole'));
    expect(p.action).toBe('extend');
    expect(p.shiftHint).toBe('Shift: New part · sleeve pin hole ∥ Z onto part 1');
    expect(hover(m, 1, 1, 4, st('pinHole', true)).shiftHint).toBe('');
    // single beam: Extend vs New adjacent
    const b = modelOf([c(0, 0, 0, 'pinHole', 2)]);
    expect(hover(b, 1, 0, 0, st('pinHole')).shiftHint).toBe('Shift: New part · pin hole ∥ Z');
  });

  it('describeHover: part, kind, axis, position and mate', () => {
    const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]);
    expect(describeHover(m, { partId: 1, cellIndex: 1, dir: 0 }, null)).toBe('Part 1 · pin hole ∥ Z at (1, 0, 0)');
    expect(describeHover(m, { partId: 1, cellIndex: 0, dir: 0 }, null)).toBe('Part 1 · pin hole ∥ Z at (0, 0, 0) · holds pin (part 2)');
    expect(describeHover(m, { partId: 2, cellIndex: 0, dir: 4 }, null)).toBe('Part 2 · pin ∥ Z at (0, 0, 0) · in pin hole (part 1)');
    expect(describeHover(m, null, { pos: [2, 0, -1] })).toBe('Grid (2, 0, -1)');
    expect(describeHover(m, null, null)).toBe('');
    expect(describeHover(m, { partId: 9, cellIndex: 0, dir: 0 }, null)).toBe('');
  });
});
