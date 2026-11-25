// Build the §8 four-bar from an empty model purely through pick → resolveBuild → apply.
import { describe, expect, it } from 'vitest';
import { emptyModel, validateModel } from '../../src/core';
import type { Dir, Kind, Model, Vec3i } from '../../src/core';
import { analyze } from '../../src/core/kinematics';
import { initialToolState, kinematicsSummary, pickCell, pickGrid, resolveBuild, selectTool } from '../../src/editor';
import type { BuildAction, Ray, ToolState } from '../../src/editor';
import { faceRay } from './helpers';

describe('scripted four-bar', () => {
  it('ends with 4 bodies and 4 revolute joints', () => {
    let model: Model = emptyModel();
    let s: ToolState = initialToolState('#5f6468');
    const log: string[] = [];

    const click = (ray: Ray, expectAction: BuildAction, expectPart?: number) => {
      const hit = pickCell(model, ray);
      const grid = hit ? null : pickGrid(ray);
      if (expectPart !== undefined) expect(hit?.partId).toBe(expectPart);
      const p = resolveBuild(model, hit, grid, s);
      log.push(p.description);
      expect(p.reason).toBeUndefined();
      expect(p.action).toBe(expectAction);
      const r = p.apply(model);
      expect(validateModel(r.model)).toEqual([]);
      model = r.model;
      return r.partId;
    };
    const tool = (k: Kind) => {
      s = selectTool(s, k);
    };
    /** Click face `dir` of the cell at `pos` (u: off-axis offset so a shared hole is picked, not its pin). */
    const face = (pos: Vec3i, dir: Dir, u = 0) => faceRay(pos, dir, u, 0);

    // Ground beam (0..6, 0, 0), holes ∥ Z (the New-on-grid default), then extend.
    tool('pinHole');
    const down: Ray = { origin: [0.1, 10, -0.2], dir: [0, -1, 0] };
    const first = resolveBuild(model, pickCell(model, down), pickGrid(down), s);
    expect(first.action).toBe('newOnGrid');
    expect(first.cell!.axis).toBe(2);
    const ground = click(down, 'newOnGrid');
    for (let x = 0; x < 6; x++) click(face([x, 0, 0], 0), 'extend', ground);

    // Pin ground–crank at (0,0,0)–(0,0,1): insert into the ground's hole, extend the pin.
    tool('pin');
    const pin1 = click(face([0, 0, 0], 4, 0.4), 'insert', ground);
    click(face([0, 0, 0], 4), 'extend', pin1); // on-axis: picks the pin inside the hole

    // Crank (0,0..2,1): sleeve onto the pin from its side, extend up.
    tool('pinHole');
    const crank = click(face([0, 0, 1], 2), 'sleeve', pin1);
    click(face([0, 0, 1], 2), 'extend', crank); // lateral face of the shared cell -> the hole
    click(face([0, 1, 1], 2), 'extend', crank);

    // Pin crank–coupler (0,2,1)–(0,2,2); coupler (0..4,2,2).
    tool('pin');
    const pin2 = click(face([0, 2, 1], 4, 0.4), 'insert', crank);
    click(face([0, 2, 1], 4), 'extend', pin2);
    tool('pinHole');
    const coupler = click(face([0, 2, 2], 2), 'sleeve', pin2);
    for (let x = 0; x < 4; x++) click(face([x, 2, 2], 0), 'extend', coupler);

    // Pin ground–rocker (6,0,0)–(6,0,1); rocker (6,0,1) → (4,0,1) → (4,2,1).
    tool('pin');
    const pin3 = click(face([6, 0, 0], 4, 0.4), 'insert', ground);
    click(face([6, 0, 0], 4), 'extend', pin3);
    tool('pinHole');
    const rocker = click(face([6, 0, 1], 2), 'sleeve', pin3);
    click(face([6, 0, 1], 1), 'extend', rocker);
    click(face([5, 0, 1], 1), 'extend', rocker);
    click(face([4, 0, 1], 2), 'extend', rocker);
    click(face([4, 1, 1], 2), 'extend', rocker);

    // Close the loop at (4,2): one click on the coupler's front mouth pushes a 2-long pin through
    // the coupler's hole and on into the rocker's hole stacked behind it (deep insert).
    tool('pin');
    const pin4 = click(face([4, 2, 2], 4, 0.4), 'insert', coupler);
    expect(log.at(-1)).toBe(`New part · insert pin ∥ Z into part ${coupler} · 2 long, through part ${rocker}`);

    expect(model.parts.map((p) => p.cells.length)).toEqual([7, 2, 3, 2, 5, 2, 5, 2]);
    const g = analyze(model);
    expect(g.bodies.length).toBe(4);
    const fixed = g.bodies.filter((b) => b.fixed);
    expect(fixed.length).toBe(1);
    expect(fixed[0]!.partIds).toContain(ground);
    const links = [crank, coupler, rocker].map((p) => g.bodyOfPart.get(p));
    expect(new Set([...links, g.bodyOfPart.get(ground)]).size).toBe(4);
    expect(g.joints.length).toBe(4);
    expect(g.joints.every((j) => j.type === 'revolute')).toBe(true);
    expect(kinematicsSummary(model, g)).toBe('8 parts · 4 bodies (1 fixed) · 4 joints: 4 revolute');
  });
});
