// UX reviewer ("ux") tests: pure-logic reproductions of editor usability defects found through
// the real UI (see e2e/review-ux-*.mjs). Each test states the behaviour a user needs; a failing
// test is a finding, not a broken test.
import { describe, expect, it } from 'vitest';
import { addPart, canAddCell, emptyModel, makeCell } from '../../src/core';
import type { Axis, Cell, Kind, Model } from '../../src/core';
import { analyze } from '../../src/core/kinematics';
import { initialToolState, resolveBuild, selectTool } from '../../src/editor';

const c = (x: number, y: number, z: number, kind: Kind, axis: Axis): Cell => makeCell(x, y, z, kind, axis);
function modelOf(...parts: Cell[][]): Model {
  let m = emptyModel();
  for (const cells of parts) m = addPart(m, cells).model;
  return m;
}
const tool = (t: Parameters<typeof selectTool>[1]) => selectTool(initialToolState('#e0b43c'), t);

describe('ux: status-bar wording', () => {
  it('"would not attach" reason uses the right article for axle / axle hole', () => {
    // a pin ∥ Z at the origin; an axle ∥ Y on its side would not attach
    const m = modelOf([c(0, 0, 0, 'pin', 2)]);
    const r = canAddCell(m, 1, c(0, 1, 0, 'axle', 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toMatch(/\ba axle/);
  });
});

describe('ux: build defaults', () => {
  it('hole tool on the free end of a rod: the default is not welding a perpendicular hole onto the rod', () => {
    // pin (0,0,0)-(0,0,1) in a fixed beam; the user points the pin-hole tool at the pin's +Z end.
    const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)], [c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]);
    const p = resolveBuild(m, { partId: 2, cellIndex: 1, dir: 4 }, null, tool('pinHole'));
    // Today: "Extend part 2 · pin hole ∥ X" — a hole fused to the pin's end (pin becomes a liftarm-with-pin).
    expect(p.action === 'extend' && p.cell?.axis !== 2).toBe(false);
  });

  it('pin tool on the mouth of two stacked, unpinned holes inserts a pin that reaches the hole behind', () => {
    // beam A at z=0, beam B at z=1 (separate parts, coaxial holes at x=0)
    const m = modelOf([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2)], [c(0, 0, 1, 'pinHole', 2), c(1, 0, 1, 'pinHole', 2)]);
    const p = resolveBuild(m, { partId: 2, cellIndex: 0, dir: 4 }, null, tool('pin'));
    expect(p.valid).toBe(true);
    const r = p.apply(m);
    const g = analyze(r.model);
    // Today: a 1-cell pin only in beam B; A and B stay unconnected (3 bodies, no joints).
    expect(g.joints.length).toBe(1);
  });

  it('a pendulum built on the grid with every default orientation can swing under gravity', () => {
    // Built through resolveBuild with every default (no [R], no Shift), as in the repro: a beam
    // from the grid extended +X twice, a pin into the last hole's mouth and lengthened, a link
    // sleeved onto the pin's end and extended +X four times. (Fixed: New on grid used to default to
    // ∥ Y, so the joint axis was parallel to gravity and nothing moved; now ∥ Z, DEVIATIONS §7.)
    let m = emptyModel();
    const click = (p: ReturnType<typeof resolveBuild>) => {
      expect(p.valid).toBe(true);
      const r = p.apply(m);
      m = r.model;
      return r.partId;
    };
    const cellIndex = (id: number, x: number, y: number, z: number) =>
      m.parts.find((p) => p.id === id)!.cells.findIndex((q) => q.x === x && q.y === y && q.z === z);
    const holes = tool('pinHole');
    const ground = click(resolveBuild(m, null, { pos: [0, 0, 0] }, holes));
    const a = m.parts[0]!.cells[0]!.axis;
    click(resolveBuild(m, { partId: ground, cellIndex: 0, dir: 0 }, null, holes));
    click(resolveBuild(m, { partId: ground, cellIndex: 1, dir: 0 }, null, holes));
    const pins = tool('pin');
    const mouth = (2 * a) as 0 | 2 | 4; // the + face along the hole axis
    const pinId = click(resolveBuild(m, { partId: ground, cellIndex: 2, dir: mouth }, null, pins));
    click(resolveBuild(m, { partId: pinId, cellIndex: 0, dir: mouth }, null, pins));
    const top = m.parts.find((p) => p.id === pinId)!.cells[1]!;
    const link = click(resolveBuild(m, { partId: pinId, cellIndex: 1, dir: mouth }, null, holes));
    for (let x = 2; x < 6; x++) click(resolveBuild(m, { partId: link, cellIndex: cellIndex(link, x, top.y, top.z), dir: 0 }, null, holes));
    const g = analyze(m);
    expect(g.joints.length).toBe(1);
    expect(g.joints[0]!.axis).not.toBe(1); // joint axis ∥ gravity → zero gravity torque
  });
});
