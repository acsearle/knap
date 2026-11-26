// Gears in the editor (DESIGN.md §7.2 Gear tool / Wheel tool on gears / Erase on gears, §7.3
// "Gears in picking", §7.4 texts, files): every step up and down, each refusal with its text,
// wheel <-> gear conversion, the crank-hole targeting rule, undo, the mesh texts, picking over the
// tip disc, the tread refusal and Back side on a gear, selection operations and files.
import { describe, expect, it } from 'vitest';
import { GEAR_RADII, addPart, emptyModel, gearMeshes, isHole, makeCell, partById, serialize, setGear, tipRadius, validateModel } from '../../src/core';
import type { Axis, Cell, Dir, Kind, Model, Vec3i } from '../../src/core';
import {
  History,
  TOOL_KEYS,
  autosave,
  countsText,
  describeHover,
  duplicateSelection,
  gearRatio,
  initialToolState,
  isBuildTool,
  meshPartners,
  moveSelection,
  parseModelFile,
  partInfo,
  pickBack,
  pickCell,
  resolveBuild,
  resolveErase,
  resolveGear,
  resolveSelect,
  resolveWheel,
  restoreAutosave,
  rotateSelection,
  selectTool,
  setBackSide,
  setNewPart,
} from '../../src/editor';
import type { CellPick, Ray, StorageLike, ToolState } from '../../src/editor';
import { c } from './helpers';

const st = (tool: Parameters<typeof selectTool>[1], newPart = false): ToolState => setNewPart(selectTool(initialToolState('#3b74c4'), tool), newPart);
const hub = (partId: number, cellIndex = 0, dir: Dir = 4): CellPick => ({ partId, cellIndex, dir });
const down = (x: number, y: number, z = 5): Ray => ({ origin: [x, y, z], dir: [0, 0, -1] });

/** Part 1: one pin hole ∥ `axis` at `at` carrying a gear of pitch radius r (and `more` cells). */
function gear(r: number | undefined, more: Cell[] = [], axis: Axis = 2, at: Vec3i = [0, 0, 0]): Model {
  return addPart(emptyModel(), [makeCell(at[0], at[1], at[2], 'pinHole', axis, r, r !== undefined), ...more]).model;
}

/** Two single-hole parts ∥ Z: part 1 at the origin, part 2 at (dx, dy, 0). */
function pair(dx: number, dy = 0): Model {
  const m = addPart(emptyModel(), [c(0, 0, 0, 'pinHole', 2)]).model;
  return addPart(m, [c(dx, dy, 0, 'pinHole', 2)]).model;
}

const storage = (): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};

describe('the Gear tool: key, toolbar class', () => {
  it('T selects it; it is not a build tool', () => {
    expect(TOOL_KEYS.t).toBe('gear');
    expect(Object.entries(TOOL_KEYS).filter(([, t]) => t === 'gear')).toEqual([['t', 'gear']]);
    expect(isBuildTool('gear')).toBe(false);
    // a build-tool resolution with the gear tool does nothing
    expect(resolveBuild(gear(undefined), hub(1), null, st('gear')).action).toBe('none');
  });
});

describe('resolveGear: steps up and down (§7.2)', () => {
  it('bare → 8 → 16 → 24 → 40 teeth, one setGear per click; the model becomes version 3', () => {
    let m = gear(undefined);
    expect(m.version).toBe(1);
    const want = [
      [0.5, 'Gear · part 1 · 8 teeth (radius 0.5)'],
      [1, 'Gear · part 1 · 16 teeth (radius 1)'],
      [1.5, 'Gear · part 1 · 24 teeth (radius 1.5)'],
      [2.5, 'Gear · part 1 · 40 teeth (radius 2.5)'],
    ] as const;
    for (const [r, text] of want) {
      const p = resolveGear(m, hub(1));
      expect(p).toMatchObject({ valid: true, mode: 'up', partId: 1, cellIndex: 0, to: r, description: text, pieces: 1, ring: null, meshes: [] });
      expect(p.ghost).toEqual(makeCell(0, 0, 0, 'pinHole', 2, r, true));
      const next = p.apply(m);
      expect(validateModel(next)).toEqual([]);
      expect(next.version).toBe(3);
      expect(partById(next, 1)!.cells[0]).toEqual(makeCell(0, 0, 0, 'pinHole', 2, r, true));
      m = next;
    }
    // the top of the range: no ghost, red face (no change)
    const top = resolveGear(m, hub(1));
    expect(top).toMatchObject({ valid: false, reason: 'largest gear has 40 teeth', description: 'Gear · part 1 — largest gear has 40 teeth', ghost: null });
    expect(top.highlight).toEqual({ pos: [0, 0, 0], dir: 4 });
    expect(() => top.apply(m)).toThrow();
  });

  it('Shift: 40 → 24 → 16 → 8 → bare (the removed band is the ring); a bare hole has no gear', () => {
    let m = gear(2.5);
    const want = [
      [1.5, 'Gear · part 1 · 24 teeth (radius 1.5)', 2.5],
      [1, 'Gear · part 1 · 16 teeth (radius 1)', 1.5],
      [0.5, 'Gear · part 1 · 8 teeth (radius 0.5)', 1],
      [undefined, 'Gear · part 1 · back to a bare pin hole', 0.5],
    ] as const;
    for (const [to, text, from] of want) {
      const p = resolveGear(m, hub(1), true);
      expect(p).toMatchObject({ valid: true, mode: 'down', from, description: text, ghost: null });
      expect(p.to).toBe(to);
      // the band from the smaller gear's tips to this one's (review m8 look; was from the pitch radius)
      expect(p.ring).toEqual({ hub: [0, 0, 0], axis: 2, r0: to !== undefined ? tipRadius(to) : 0.5, r1: tipRadius(from) });
      m = p.apply(m);
    }
    expect(partById(m, 1)!.cells[0]).toEqual(c(0, 0, 0, 'pinHole', 2));
    // a gear model that loses its last gear stays version 3 (versions only go up)
    expect(m.version).toBe(3);
    expect(resolveGear(m, hub(1), true)).toMatchObject({ valid: false, reason: 'this pin hole has no gear', description: 'Gear · part 1 — this pin hole has no gear' });
    const ax = addPart(emptyModel(), [c(0, 0, 0, 'axleHole', 0)]).model;
    expect(resolveGear(ax, hub(1), true).reason).toBe('this axle hole has no gear');
  });

  it('on a plain wheel: the largest gear not above the radius (Shift: one size below that)', () => {
    for (const [R, up, dn] of [[1, 1, 0.5], [1.5, 1.5, 1], [2, 1.5, 1], [2.5, 2.5, 1.5], [3, 2.5, 1.5], [4, 2.5, 1.5]] as const) {
      const m = addPart(emptyModel(), [makeCell(0, 0, 0, 'pinHole', 2, R)]).model;
      const p = resolveGear(m, hub(1));
      expect(p, `R ${R}`).toMatchObject({ valid: true, wheel: R, to: up });
      expect(p.from).toBeUndefined();
      expect(p.description).toBe(`Gear · part 1 · ${up * 16} teeth (radius ${up}) · from the wheel of radius ${R}`);
      expect(p.ghost).toEqual(makeCell(0, 0, 0, 'pinHole', 2, up, true));
      expect(partById(p.apply(m), 1)!.cells[0]).toEqual(makeCell(0, 0, 0, 'pinHole', 2, up, true));
      const q = resolveGear(m, hub(1), true);
      expect(q, `R ${R} down`).toMatchObject({ valid: true, to: dn, ghost: makeCell(0, 0, 0, 'pinHole', 2, dn, true) });
      expect(q.ring).toEqual({ hub: [0, 0, 0], axis: 2, r0: tipRadius(dn), r1: R });
    }
  });

  it('refusals carry the core reason: other parts, rule 5, clash, overlap; a later size that fits is named', () => {
    // another part's bare cell beside the hub
    let p = resolveGear(pair(1), hub(1));
    expect(p).toMatchObject({ valid: false, to: 0.5, reason: 'gear teeth would hit part 2 at (1, 0, 0)' });
    expect(p.description).toBe('Gear · part 1 · 8 teeth (radius 0.5) — gear teeth would hit part 2 at (1, 0, 0)');
    expect(p.ghost).toEqual(makeCell(0, 0, 0, 'pinHole', 2, 0.5, true)); // red ghost
    // own beam cell beside the hub: not in the web of an 8 → rule 5; a 24 has (1, 0) in its web
    const beam = addPart(emptyModel(), [c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)]).model;
    // the click goes straight to the first size that fits (review m8 ux: was a red "· 24 teeth would fit")
    p = resolveGear(beam, hub(1));
    expect(p).toMatchObject({ valid: true, to: 1.5 });
    expect(p.description).toBe("Gear · part 1 · 24 teeth (radius 1.5) · skips 8, 16: (1, 0, 0) would cut into the teeth of this part's gear (hub (0, 0, 0))");
    expect(p.ghost).toEqual(makeCell(0, 0, 0, 'pinHole', 2, 1.5, true));
    // with no size that fits: the rule-5 reason says where a gear can go
    const beam3 = addPart(emptyModel(), [c(-1, 0, 0, 'pinHole', 2), c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(0, 1, 0, 'pinHole', 2), c(0, 3, 0, 'pinHole', 2), c(0, 2, 0, 'pinHole', 2), c(-1, 3, 0, 'pinHole', 2)]).model;
    p = resolveGear(beam3, hub(1, 1));
    expect(p.valid).toBe(false);
    expect(p.reason).toMatch(/would cut into the teeth of this part's gear .* · a gear needs a layer to itself: sleeve a hole onto a pin, or extend a hole out of the beam along its axis$/);
    // the teeth would clash: a 16 at (2, 3); 8 and 24 are clear, 40 clashes
    let m = setGear(pair(2, 3), 2, [2, 3, 0], 1);
    m = setGear(m, 1, [0, 0, 0], 1.5);
    p = resolveGear(m, hub(1));
    expect(p).toMatchObject({ valid: false, to: 2.5, reason: 'the teeth would clash with the gear of part 2 (hub (2, 3, 0))' });
    // overlap: an 8 meshing with a 40 cannot grow
    m = setGear(setGear(pair(3), 2, [3, 0, 0], 0.5), 1, [0, 0, 0], 2.5);
    p = resolveGear(m, hub(2));
    expect(p.reason).toBe('gears would overlap: the gear of part 1 (hub (0, 0, 0))');
    // a lone male cell
    const pin = addPart(emptyModel(), [c(0, 0, 0, 'pin', 2)]).model;
    p = resolveGear(pin, hub(1));
    expect(p).toMatchObject({ valid: false, reason: 'gears grow from pin holes and axle holes', description: 'Gear · part 1 — gears grow from pin holes and axle holes', ghost: null });
    expect(p.highlight).toEqual({ pos: [0, 0, 0], dir: 4 });
  });

  it('the mesh it would form is in the status text (gearMeshes on the prospective model), with the reduced ratio', () => {
    // the 8 first (a bare cell 3 away does not stop it), then the other hub up to 40
    let m = pair(3);
    let p = resolveGear(m, hub(2));
    expect(p.description).toBe('Gear · part 2 · 8 teeth (radius 0.5)');
    m = p.apply(m);
    for (const r of [0.5, 1, 1.5]) m = resolveGear(m, hub(1)).apply(m);
    p = resolveGear(m, hub(1));
    expect(p.description).toBe('Gear · part 1 · 40 teeth (radius 2.5) · meshes with part 2 (8 teeth, 5:1)');
    expect(p.meshes).toEqual([{ partId: 2, teeth: 8, ratio: '5:1' }]);
    m = p.apply(m);
    expect(gearMeshes(m)).toHaveLength(1);
    // from the 8's side; 24 + 40
    expect(meshPartners(m, 2, [3, 0, 0])).toEqual([{ partId: 1, teeth: 40, ratio: '1:5' }]);
    expect(gearRatio(24, 40)).toBe('3:5');
    expect(gearRatio(16, 16)).toBe('1:1');
    let k = setGear(pair(4), 2, [4, 0, 0], 1.5);
    k = setGear(k, 1, [0, 0, 0], 1.5);
    expect(resolveGear(k, hub(1)).description).toBe('Gear · part 1 · 40 teeth (radius 2.5) · meshes with part 2 (24 teeth, 5:3)');
    // two partners
    let three = addPart(pair(3), [c(-3, 0, 0, 'pinHole', 2)]).model;
    three = setGear(setGear(three, 2, [3, 0, 0], 0.5), 3, [-3, 0, 0], 0.5);
    for (const _ of [0, 1, 2]) three = resolveGear(three, hub(1)).apply(three);
    expect(resolveGear(three, hub(1)).description).toBe('Gear · part 1 · 40 teeth (radius 2.5) · meshes with part 2 (8 teeth, 5:1), part 3 (8 teeth, 5:1)');
  });

  it('each click is one undo step', () => {
    let m = pair(3);
    const h = new History(m);
    const models = [m];
    for (const [id, down] of [[2, false], [1, false], [1, false], [1, false], [1, false], [1, true]] as const) {
      const p = resolveGear(h.current, hub(id), down);
      expect(p.valid).toBe(true);
      h.push(p.apply(h.current));
      models.push(h.current);
    }
    for (let i = models.length - 2; i >= 0; i--) {
      h.undo();
      expect(h.current).toBe(models[i]);
    }
    for (let i = 1; i < models.length; i++) {
      h.redo();
      expect(h.current).toBe(models[i]);
    }
    m = h.current;
    expect(serialize(m)).toBe(serialize(models[models.length - 1]!));
  });

  it('stale proposals throw', () => {
    const m = gear(undefined);
    const p = resolveGear(m, hub(1));
    expect(() => p.apply(gear(0.5))).toThrow(/re-resolve/);
    expect(resolveGear(m, { partId: 9, cellIndex: 0, dir: 4 }).description).toBe('');
    expect(resolveGear(m, null).description).toBe('');
  });
});

describe('targeting: crank holes act on the wheel or gear whose disc overlaps them (§7.2)', () => {
  it('a web hole of a gear acts on that gear (Gear, Wheel); a hole outside the tip disc keeps its own', () => {
    // 40-tooth gear with web holes (1,0), (1,1), (2,0)
    const m = gear(2.5, [c(1, 0, 0, 'pinHole', 2), c(1, 1, 0, 'pinHole', 2), c(2, 0, 0, 'pinHole', 2)]);
    expect(validateModel(m)).toEqual([]);
    for (const i of [1, 2, 3]) {
      expect(resolveGear(m, hub(1, i), true), `cell ${i}`).toMatchObject({ cellIndex: 0, from: 2.5, to: 1.5 });
      expect(resolveWheel(m, hub(1, i)), `cell ${i}`).toMatchObject({ cellIndex: 0, convert: true, to: 2.5 });
    }
    // 24-tooth gear, web (1, 0)
    const m24 = gear(1.5, [c(1, 0, 0, 'pinHole', 2)]);
    expect(resolveGear(m24, hub(1, 1))).toMatchObject({ cellIndex: 0, from: 1.5, to: 2.5 });
    // a hole in another layer keeps its own
    const m2 = gear(2.5, [c(0, 0, 1, 'pinHole', 2), c(1, 0, 1, 'pinHole', 2)]);
    expect(validateModel(m2)).toEqual([]);
    expect(resolveGear(m2, hub(1, 2))).toMatchObject({ cellIndex: 2 });
    // a plain wheel's crank hole: the Gear tool makes that wheel a gear
    const w = addPart(emptyModel(), [makeCell(0, 0, 0, 'pinHole', 2, 2), c(2, 1, 0, 'pinHole', 2)]).model;
    expect(resolveGear(w, hub(1, 1))).toMatchObject({ cellIndex: 0, wheel: 2, to: 1.5 });
  });

  it('the disc hits (virtual cell, teeth) act on the gear', () => {
    const m = gear(1.5);
    const face = pickCell(m, down(1.2, 0.1))!;
    expect(face).toMatchObject({ partId: 1, cellIndex: 0, virtual: [1, 0, 0] });
    expect(resolveGear(m, face)).toMatchObject({ valid: true, cellIndex: 0, to: 2.5 });
    expect(resolveGear(m, face).highlight).toEqual({ pos: [1, 0, 0], dir: 4 });
    const teeth = pickCell(m, { origin: [6, 0.2, 0], dir: [-1, 0, 0] })!;
    expect(teeth).toMatchObject({ tread: true, dir: 0 });
    expect(resolveGear(m, teeth, true)).toMatchObject({ valid: true, to: 1 });
    expect(resolveSelect(m, teeth).partId).toBe(1);
    expect(resolveErase(m, teeth)).toMatchObject({ valid: true, description: 'Erase gear teeth · part 1 · 24 → 16 teeth' });
  });
});

describe('Wheel tool on a gear: a plain wheel of the same radius (§7.2)', () => {
  it('24 → radius 1.5, 8 → radius 1; Shift does the same; refused when the wheel would hit a meshing gear', () => {
    const m = gear(1.5);
    for (const shrink of [false, true]) {
      const p = resolveWheel(m, hub(1), shrink);
      expect(p).toMatchObject({ valid: true, convert: true, from: 1.5, to: 1.5, ring: null });
      expect(p.description).toBe('Plain wheel · part 1 · radius 1.5 (24 mm across) instead of the 24-tooth gear');
      expect(p.ghost).toEqual(makeCell(0, 0, 0, 'pinHole', 2, 1.5));
      expect(partById(p.apply(m), 1)!.cells[0]).toEqual(makeCell(0, 0, 0, 'pinHole', 2, 1.5));
    }
    const p8 = resolveWheel(gear(0.5), hub(1));
    expect(p8).toMatchObject({ valid: true, to: 1, description: 'Plain wheel · part 1 · radius 1 (16 mm across) instead of the 8-tooth gear' });
    // a 40 meshing with an 8: neither can become a plain wheel there
    const mesh = setGear(setGear(pair(3), 2, [3, 0, 0], 0.5), 1, [0, 0, 0], 2.5);
    expect(resolveWheel(mesh, hub(2))).toMatchObject({ valid: false, reason: '(3, 0, 0) is inside the gear of part 1' });
    expect(resolveWheel(mesh, hub(1)).reason).toBe('the wheel would hit the gear teeth of part 2 (hub (3, 0, 0))');
    // and the plain wheel back to a gear with the Gear tool
    const back = resolveGear(resolveWheel(m, hub(1)).apply(m), hub(1));
    expect(partById(back.apply(back.baseModel), 1)!.cells[0]).toEqual(makeCell(0, 0, 0, 'pinHole', 2, 1.5, true));
  });
});

describe('Erase on a gear: one size down (§7.2)', () => {
  it('40 → 24 → 16 → 8 → bare, then the cell; refused where the bare hub would be inside another gear', () => {
    let m = addPart(gear(2.5), [c(0, 0, 5, 'pinHole', 2)]).model; // a second part so erasing the last cell is visible
    const want = ['40 → 24 teeth', '24 → 16 teeth', '16 → 8 teeth', '8 → bare pin hole'];
    for (const w of want) {
      const e = resolveErase(m, hub(1));
      expect(e).toMatchObject({ valid: true, description: `Erase gear teeth · part 1 · ${w}`, pieces: 1 });
      expect(e.ring?.hub).toEqual([0, 0, 0]);
      m = e.apply(m);
      expect(validateModel(m)).toEqual([]);
    }
    expect(resolveErase(m, hub(1)).description).toBe('Erase part 1 (last cell)');
    // an 8 meshing with an 8 (built by placing two 8-tooth parts directly): cannot become bare
    let mm = addPart(emptyModel(), [makeCell(0, 0, 0, 'pinHole', 2, 0.5, true)]).model;
    mm = addPart(mm, [makeCell(1, 0, 0, 'pinHole', 2, 0.5, true)]).model;
    const e = resolveErase(mm, hub(2));
    expect(e).toMatchObject({ valid: false, reason: '(1, 0, 0) is inside the gear of part 1' });
    expect(e.description).toBe('Erase gear teeth · part 2 · 8 → bare pin hole — (1, 0, 0) is inside the gear of part 1');
    expect(resolveGear(mm, hub(2), true).reason).toBe('(1, 0, 0) is inside the gear of part 1');
  });

  it('erasing a web cell erases that cell; a smaller gear can split off web cells', () => {
    const m = gear(2.5, [c(1, 0, 0, 'pinHole', 2), c(2, 0, 0, 'pinHole', 2)]);
    const e = resolveErase(m, hub(1, 2));
    expect(e).toMatchObject({ valid: true, description: 'Erase pin hole at (2, 0, 0) from part 1' });
    expect(partById(e.apply(m), 1)!.cells).toHaveLength(2);
    // 40 → 24: (2,0) is outside a 24's web → the step is refused by rule 5
    expect(resolveErase(m, hub(1))).toMatchObject({ valid: false, reason: "(2, 0, 0) would cut into the teeth of this part's gear (hub (0, 0, 0))" });
  });
});

describe('Gears in picking (§7.3)', () => {
  it('pickable over the whole tip disc, not beyond', () => {
    const m = gear(1.5); // tip 1.59375
    expect(pickCell(m, down(1.57, 0))).toMatchObject({ partId: 1, virtual: [2, 0, 0] });
    expect(pickCell(m, down(1.62, 0))).toBeNull();
    const t = pickCell(m, { origin: [6, 0, 0], dir: [-1, 0, 0] })!;
    expect(t).toMatchObject({ tread: true, dir: 0 });
    expect(t.t).toBeCloseTo(6 - tipRadius(1.5), 12);
    // an 8: the tip (0.59375) reaches past the hub cube's faces
    const m8 = gear(0.5);
    expect(pickCell(m8, down(0.55, 0))).toMatchObject({ virtual: [1, 0, 0] });
    expect(pickCell(m8, down(0.2, 0.1))!.virtual).toBeUndefined(); // the hub cube
    expect(pickCell(m8, down(0.6, 0))).toBeNull();
  });

  it('build tools on the face: a crank hole or crank pin in the web; refused elsewhere on the face', () => {
    const m = gear(1.5);
    let p = resolveBuild(m, pickCell(m, down(1.2, 0.1)), null, st('pinHole'));
    expect(p).toMatchObject({ valid: true, action: 'extend', description: 'Extend part 1 · pin hole ∥ Z in the gear' });
    expect(p.cell).toEqual(c(1, 0, 0, 'pinHole', 2));
    expect(validateModel(p.apply(m).model)).toEqual([]);
    p = resolveBuild(m, pickCell(m, down(1.2, 0.1)), null, st('pin'));
    expect(p).toMatchObject({ valid: true, description: 'Extend part 1 · pin ∥ Z in the gear' });
    expect(validateModel(p.apply(m).model)).toEqual([]);
    p = resolveBuild(m, pickCell(m, down(1.1, 1.1)), null, st('pinHole'));
    expect(p).toMatchObject({ valid: false, reason: 'too close to the teeth — crank holes go on grid cells centred within 1 of the hub' });
    expect(p.description).toBe('Extend part 1 · pin hole ∥ Z in the gear — too close to the teeth — crank holes go on grid cells centred within 1 of the hub');
    const m40 = gear(2.5);
    expect(resolveBuild(m40, pickCell(m40, down(2.1, 0)), null, st('axleHole')).valid).toBe(true);
    expect(resolveBuild(m40, pickCell(m40, down(2.1, 1)), null, st('axleHole')).reason).toBe('too close to the teeth — crank holes go on grid cells centred within 2 of the hub');
    for (const [r, T] of [[0.5, 'an 8-tooth'], [1, 'a 16-tooth']] as const) {
      const g = gear(r);
      const pick = pickCell(g, down(r + 0.06, 0))!;
      expect(pick.virtual).toEqual([1, 0, 0]);
      expect(resolveBuild(g, pick, null, st('pinHole')).reason).toBe(`${T} gear has no room for crank holes`);
      expect(resolveBuild(g, pick, null, st('pin')).reason).toBe(`${T} gear has no room for crank holes`);
    }
    // Shift / New part on the face: a new part in the next layer, as on a wheel
    p = resolveBuild(m, pickCell(m, down(1.1, 1.1)), null, st('pinHole', true));
    expect(p).toMatchObject({ valid: true, action: 'newAdjacent' });
    expect(p.cell).toMatchObject({ x: 1, y: 1, z: 1 });
  });

  it('the teeth are a tread: build tools refuse with a hint; Select, Gear, Wheel and Erase act on the gear', () => {
    const m = gear(1.5);
    const t = pickCell(m, { origin: [6, 0.3, 0], dir: [-1, 0, 0] })!;
    for (const tool of ['pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'] as const) {
      const p = resolveBuild(m, t, null, st(tool));
      expect(p).toMatchObject({ action: 'none', valid: false, hoverPartId: 1 });
      expect(p.description).toBe("Part 1 · gear teeth — point at the gear's flat face or at a hole to build on a gear");
    }
    expect(resolveSelect(m, t).partId).toBe(1);
    expect(resolveGear(m, t).valid).toBe(true);
    expect(resolveWheel(m, t)).toMatchObject({ valid: true, convert: true });
    expect(resolveErase(m, t).valid).toBe(true);
  });

  it('Back side on a gear: far face in the web builds, outside it refuses; leaving through the teeth refuses', () => {
    const m = gear(1.5);
    let b = pickBack(m, down(1.2, 0.1))!;
    expect(b).toMatchObject({ back: true, dir: 5, virtual: [1, 0, 0] });
    let p = resolveBuild(m, b, null, st('pinHole'));
    expect(p).toMatchObject({ valid: true, backSide: true, description: 'Extend part 1 · pin hole ∥ Z in the gear · back side (−Z)' });
    b = pickBack(m, down(1.1, 1.1))!;
    p = resolveBuild(m, b, null, st('pinHole'));
    expect(p.description).toBe('Extend part 1 · pin hole ∥ Z in the gear · back side (−Z) — too close to the teeth — crank holes go on grid cells centred within 1 of the hub');
    b = pickBack(m, { origin: [6, 0.3, 0], dir: [-1, 0, 0] })!;
    expect(b).toMatchObject({ back: true, tread: true, dir: 1 });
    p = resolveBuild(m, b, null, st('pin'));
    expect(p).toMatchObject({ action: 'none', backSide: true });
    expect(p.description).toBe("Part 1 · gear teeth · back side (−X) — point at the gear's flat face or at a hole to build on a gear");
    expect(pickBack(m, down(1.62, 0))).toBeNull();
  });

  it('a gear about X and with transforms (grab in simulate mode)', () => {
    const mx = gear(2.5, [], 0, [3, 2, 1]);
    expect(pickCell(mx, { origin: [9, 2 + 2.55, 1], dir: [-1, 0, 0] })).toMatchObject({ virtual: [3, 5, 1] });
    const q = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as const;
    const h = pickCell(gear(1.5), down(10 - 1.55, 0), { transform: () => ({ p: [10, 0, 0], q }) });
    expect(h).toMatchObject({ partId: 1, virtual: [0, 2, 0] });
  });
});

describe('texts, inspector data, counts (§7.4)', () => {
  const mesh = (): Model => setGear(setGear(pair(4), 2, [4, 0, 0], 1.5), 1, [0, 0, 0], 2.5);

  it('hover: "Part 3 · gear 24 teeth ∥ Z · meshes with part 5 (40 teeth)"; a plain wheel is unchanged', () => {
    const m = mesh();
    expect(describeHover(m, hub(1), null)).toBe('Part 1 · gear 40 teeth ∥ Z · meshes with part 2 (24 teeth)');
    expect(describeHover(m, pickCell(m, down(4.9, 0.3)), null)).toBe('Part 2 · gear 24 teeth ∥ Z · meshes with part 1 (40 teeth)');
    expect(describeHover(m, pickCell(m, { origin: [0, -6, 0], dir: [0, 1, 0] }), null)).toBe('Part 1 · gear 40 teeth ∥ Z · meshes with part 2 (24 teeth)');
    expect(describeHover(gear(1), hub(1), null)).toBe('Part 1 · gear 16 teeth ∥ Z');
    // a pin through the gear's hub
    const pinned = addPart(gear(1.5), [c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]).model;
    expect(describeHover(pinned, pickCell(pinned, { origin: [0, -6, 0], dir: [0, 1, 0] }), null)).toBe('Part 1 · gear 24 teeth ∥ Z');
    expect(describeHover(pinned, { partId: 1, cellIndex: 0, dir: 0 }, null)).toBe('Part 1 · gear 24 teeth ∥ Z · holds pin (part 2)');
    const w = addPart(emptyModel(), [makeCell(0, 0, 0, 'pinHole', 2, 2.5)]).model;
    expect(describeHover(w, hub(1), null)).toBe('Part 1 · pin hole ∥ Z at (0, 0, 0) · wheel radius 2.5');
  });

  it('partInfo lists gears with their meshes and ratios, apart from plain wheels', () => {
    const m = addPart(mesh(), [makeCell(0, 0, 3, 'pinHole', 2, 2)]).model;
    expect(partInfo(m, 1, 1)!.gears).toEqual([{ teeth: 40, r: 2.5, meshes: [{ partId: 2, teeth: 24, ratio: '5:3' }] }]);
    expect(partInfo(m, 1, 1)!.wheels).toBeUndefined();
    expect(partInfo(m, 2, 1)!.gears).toEqual([{ teeth: 24, r: 1.5, meshes: [{ partId: 1, teeth: 40, ratio: '3:5' }] }]);
    expect(partInfo(m, 3, 1)).toMatchObject({ wheels: [2] });
    expect(partInfo(m, 3, 1)!.gears).toBeUndefined();
  });

  it('counts include meshes only when there are any', () => {
    expect(countsText(pair(4))).not.toMatch(/mesh/);
    expect(countsText(mesh())).toMatch(/ · 1 mesh$/);
    let three = addPart(pair(3), [c(-3, 0, 0, 'pinHole', 2)]).model;
    three = setGear(setGear(three, 2, [3, 0, 0], 0.5), 3, [-3, 0, 0], 0.5);
    three = setGear(three, 1, [0, 0, 0], 2.5);
    expect(countsText(three)).toMatch(/^3 parts · .* · 2 meshes$/);
  });
});

describe('selection operations carry teeth and re-validate', () => {
  it('duplicate, move and rotate keep the gear; a blocked move gives the gear reason', () => {
    const m = setGear(pair(6), 1, [0, 0, 0], 1.5);
    const d = duplicateSelection(m, 1);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const copy = partById(d.model, d.partId!)!;
    expect(copy.cells[0]).toMatchObject({ rim: 1.5, teeth: true });
    expect(validateModel(d.model)).toEqual([]);
    const mv = moveSelection(m, 1, [1, 0, 0]);
    expect(mv.ok && partById(mv.model, 1)!.cells[0]).toEqual(makeCell(1, 0, 0, 'pinHole', 2, 1.5, true));
    // moving toward part 2 (at x 6): the tips (1.59) reach the cell at x 6 from x 4
    let k = m;
    for (let i = 0; i < 3; i++) {
      const r = moveSelection(k, 1, [1, 0, 0]);
      expect(r.ok).toBe(true);
      if (r.ok) k = r.model;
    }
    const blocked = moveSelection(k, 1, [1, 0, 0]);
    expect(blocked).toMatchObject({ ok: false });
    expect(!blocked.ok && blocked.message).toBe("Can't move part 1 +X: (6, 0, 0): the pin hole of part 2 is inside the gear of part 1 (hub (4, 0, 0), 24 teeth)");
    // rotate about Y: the gear turns to ∥ X and keeps its teeth
    const rot = rotateSelection(m, 1, { right: [1, 0, 0], up: [0, 0, -1], forward: [0, -1, 0] }, ']');
    expect(rot.ok).toBe(true);
    if (rot.ok) expect(partById(rot.model, 1)!.cells[0]).toMatchObject({ axis: 0, rim: 1.5, teeth: true });
  });
});

describe('files (§7.4): version 3 opens, saves, autosaves; older versions keep theirs; errors', () => {
  it('a version-3 model round-trips through Save / Open and the autosave', () => {
    const m = setGear(setGear(pair(3), 2, [3, 0, 0], 0.5), 1, [0, 0, 0], 2.5);
    expect(m.version).toBe(3);
    const text = serialize(m);
    expect(text).toMatch(/"version": 3/);
    expect(text).toMatch(/"rim":2\.5,"teeth":true/);
    const r = parseModelFile(text);
    expect(r.ok && serialize(r.model)).toBe(text);
    const s = storage();
    expect(autosave(s, m).ok).toBe(true);
    const back = restoreAutosave(s);
    expect(back.model && serialize(back.model)).toBe(text);
  });

  it('version 1 and 2 files keep their version until a gear is added', () => {
    const v1 = serialize(pair(3));
    const r1 = parseModelFile(v1);
    expect(r1.ok && r1.model.version).toBe(1);
    expect(r1.ok && serialize(r1.model)).toBe(v1);
    const v2m = addPart(emptyModel(), [makeCell(0, 0, 0, 'pinHole', 2, 2)]).model;
    expect(v2m.version).toBe(2);
    const r2 = parseModelFile(serialize(v2m));
    expect(r2.ok && serialize(r2.model)).toBe(serialize(v2m));
    if (!r2.ok) return;
    const g = resolveGear(r2.model, hub(1)).apply(r2.model);
    expect(g.version).toBe(3);
  });

  it('a newer version or invalid gears give the core message', () => {
    const j = JSON.parse(serialize(gear(1.5)));
    const bad = (o: unknown) => {
      const r = parseModelFile(JSON.stringify(o));
      expect(r.ok).toBe(false);
      return r.ok ? '' : r.message;
    };
    expect(bad({ ...j, version: 4 })).toBe('Invalid knap model (1 problem):\n  - unsupported version 4 (expected 1, 2 or 3)');
    expect(bad({ ...j, version: 2 })).toMatch(/^Invalid knap model/);
    const wrongR = JSON.parse(JSON.stringify(j));
    wrongR.parts[0].cells[0].rim = 2;
    expect(bad(wrongR)).toMatch(/^Invalid knap model \(1 problem\):\n {2}- /);
    // an autosave with a bad gear is set aside with the core's first problem
    const s = storage();
    s.setItem('knap.autosave.v1', JSON.stringify(wrongR));
    const r = restoreAutosave(s);
    expect(r.model).toBeNull();
    expect(r.message).toMatch(/^The autosaved model could not be restored and was set aside \(Invalid knap model \(1 problem\): /);
  });
});

describe('fuzz: gears through the editor resolvers', () => {
  it('every valid Gear / Wheel / Erase / build proposal applies to a valid model; undo restores it exactly', () => {
    let seed = 99;
    const R = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const KINDS: Kind[] = ['pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'];
    const applied = { build: 0, gearBuild: 0, up: 0, down: 0, wheel: 0, erase: 0, gearErase: 0, meshes: 0 };
    for (let walk = 0; walk < 20; walk++) {
      const hist = new History(emptyModel());
      let s = st('pinHole');
      for (let step = 0; step < 120; step++) {
        const m = hist.current;
        let ray: Ray | null = null;
        let pick: CellPick | null = null;
        if (m.parts.length) {
          const part = m.parts[Math.floor(R() * m.parts.length)]!;
          const cell = part.cells[Math.floor(R() * part.cells.length)]!;
          const d = [R() - 0.5, R() - 0.5, R() - 0.5];
          const L = Math.hypot(...d) || 1;
          const dir = d.map((v) => v / L) as [number, number, number];
          const tgt = [cell.x + (R() - 0.5) * 5, cell.y + (R() - 0.5) * 5, cell.z + (R() - 0.5) * 5];
          ray = { origin: tgt.map((v, k) => v - dir[k]! * 20) as [number, number, number], dir };
          pick = R() < 0.75 ? pickCell(m, ray) : { partId: part.id, cellIndex: part.cells.indexOf(cell), dir: Math.floor(R() * 6) as Dir };
        }
        expect(() => describeHover(m, pick, null)).not.toThrow();
        const roll = R();
        let next: Model | null = null;
        if (!m.parts.length || roll < 0.4) {
          s = setBackSide(setNewPart(selectTool(s, KINDS[Math.floor(R() * 5)]!), R() < 0.15), R() < 0.15);
          const grid = { pos: [Math.floor(R() * 9) - 4, 0, Math.floor(R() * 9) - 4] as Vec3i };
          const bp = s.backSide && ray ? pickBack(m, ray) : pick;
          const p = resolveBuild(m, bp, bp ? null : grid, s);
          if (p.valid) {
            next = p.apply(m).model;
            applied.build++;
            if (/in the gear/.test(p.description)) applied.gearBuild++;
          } else if (p.action !== 'none') expect(p.reason).toBeTruthy();
        } else if (roll < 0.8) {
          const dn = R() < 0.3;
          const p = resolveGear(m, pick, dn);
          if (p.valid) {
            next = p.apply(m);
            applied[dn ? 'down' : 'up']++;
            if (p.meshes.length) applied.meshes++;
            const hubPart = next.parts.find((q) => q.cells.some((c2) => c2.x === p.hub!.x && c2.y === p.hub!.y && c2.z === p.hub!.z && isHole(c2.kind)))!;
            const h = hubPart.cells.find((c2) => c2.x === p.hub!.x && c2.y === p.hub!.y && c2.z === p.hub!.z && isHole(c2.kind))!;
            expect(h.rim).toBe(p.to);
            expect(h.teeth).toBe(p.to === undefined ? undefined : true);
          } else if (p.partId !== undefined) expect(p.description).toContain(p.reason!);
        } else if (roll < 0.88) {
          const p = resolveWheel(m, pick, R() < 0.3);
          if (p.valid) {
            next = p.apply(m);
            applied.wheel++;
          }
        } else {
          const e = resolveErase(m, pick);
          if (e.valid) {
            next = e.apply(m);
            applied[/gear teeth/.test(e.description) ? 'gearErase' : 'erase']++;
          } else if (e.reason) expect(e.description).toContain(e.reason);
        }
        if (!next) continue;
        expect(validateModel(next)).toEqual([]);
        const before = serialize(m);
        hist.push(next);
        hist.undo();
        expect(serialize(hist.current)).toBe(before);
        hist.redo();
        expect(hist.current).toBe(next);
        for (const part of next.parts) for (const q of part.cells) if (q.teeth) expect(isHole(q.kind) && GEAR_RADII.includes(q.rim!)).toBe(true);
      }
    }
    console.log(`  [gears fuzz] ${JSON.stringify(applied)}`);
    expect(applied.up).toBeGreaterThan(100);
    expect(applied.down).toBeGreaterThan(10);
    expect(applied.gearErase).toBeGreaterThan(5);
    expect(applied.build).toBeGreaterThan(200);
  });
});
