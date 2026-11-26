// Drawing gears (DESIGN.md §6.1 "Gears", §7.4 mesh glyph): the soft tooth-band patch the ID pass
// receives (patches.ts meshPatches), the zoom fade of its contours (softContourFade), the painted
// index (markpaint.ts on a gear's face groove, geometry's indexToothWeights) and the mesh glyph
// (glyphs.ts). Meshes without gears must get exactly the attributes they had before.
import { beforeAll, describe, expect, it } from 'vitest';
import { GEAR_RADII, emptyModel, gearMeshes, gearToothAngle, gearTeeth, makeCell } from '../../src/core';
import type { Axis, Cell, Model, Part } from '../../src/core';
import { buildExample, EXAMPLES } from '../../src/core/examples';
import { H, MARK_D, MARK_W, buildPartMesh, gearIndexes, indexToothWeights, initGeometry, rimMarks } from '../../src/geometry';
import { markWeights } from '../../src/view/markpaint';
import { SOFT_FULL_PX, SOFT_GONE_PX, TOOTH_PITCH, meshPatches, softContourFade, vertexPatches } from '../../src/view/patches';
import { MESH_TICK_BACK, MESH_TICK_GAP, MESH_TICK_OVER, meshGlyphFrame, meshGlyphSegments, meshGlyphsFromModel } from '../../src/view/glyphs';

beforeAll(async () => {
  await initGeometry();
});

const part = (cells: Cell[], id = 1): Part => ({ id, color: '#5f6468', cells });
const gear = (axis: Axis, r: number, at: [number, number, number] = [0, 0, 0]) => makeCell(at[0], at[1], at[2], 'axleHole', axis, r, true);

describe('meshPatches', () => {
  it('without a patch hint: exactly vertexPatches (every example part, wheels too)', () => {
    const parts: Part[] = [];
    // Parts without gears only (the Gear train example, §8 10, has gears and so a hint).
    for (const e of EXAMPLES) parts.push(...buildExample(e.name).parts.filter((p) => !p.cells.some((c) => c.teeth)));
    parts.push(part([makeCell(0, 0, 0, 'pinHole', 2, 2.5), makeCell(-1, 0, 0, 'pinHole', 2)]));
    let n = 0;
    for (const p of parts) {
      const md = buildPartMesh(p);
      expect(md.patchHint).toBeUndefined();
      expect(md.softPatches).toBeUndefined();
      const old = new Float32Array(vertexPatches(md.positions.length / 3, md.indices).patch);
      const now = meshPatches(md.positions.length / 3, md.indices, md.patchHint, md.softPatches);
      expect(now).toEqual(old);
      n++;
    }
    expect(n).toBeGreaterThan(10);
  });

  for (const axis of [0, 1, 2] as Axis[])
    for (const r of GEAR_RADII) {
      it(`gear r ${r} about ${'XYZ'[axis]}: the whole tooth band is one soft (negative) patch, nothing else is`, () => {
        const p = part([gear(axis, r)]);
        const md = buildPartMesh(p);
        expect(md.patchHint).toBeDefined();
        expect(md.softPatches).toEqual([1]);
        const nv = md.positions.length / 3;
        const pt = meshPatches(nv, md.indices, md.patchHint, md.softPatches);
        const neg = new Set<number>();
        let band = 0;
        for (let v = 0; v < nv; v++) {
          if (md.patchHint![v]! > 0) {
            expect(pt[v]).toBeLessThan(0);
            neg.add(pt[v]!);
            band++;
          } else expect(pt[v]).toBeGreaterThanOrEqual(0);
        }
        expect(neg.size).toBe(1);
        // its id differs from every other patch's
        const id = -[...neg][0]!;
        for (let v = 0; v < nv; v++) if (pt[v]! >= 0) expect(pt[v]).not.toBe(id);
        // the band holds the teeth: at least 4 vertices per flank × 2 flanks per tooth
        expect(band).toBeGreaterThan(gearTeeth(r) * 8);
        // each triangle lies wholly in or wholly out of the band
        for (let t = 0; t < md.indices.length; t += 3) {
          const s = [0, 1, 2].map((j) => pt[md.indices[t + j]!]! < 0);
          expect(s[0] === s[1] && s[1] === s[2]).toBe(true);
        }
      });
    }

  it('two gears of one part: two distinct soft patches', () => {
    const p = part([gear(2, 1), makeCell(0, 0, 1, 'axleHole', 2), gear(2, 1, [0, 0, 2])]);
    const md = buildPartMesh(p);
    expect(md.softPatches).toEqual([1, 2]);
    const pt = meshPatches(md.positions.length / 3, md.indices, md.patchHint, md.softPatches);
    expect(new Set([...pt].filter((x) => x < 0)).size).toBe(2);
  });
});

describe('softContourFade', () => {
  const ppu = (pxPerPitch: number) => pxPerPitch / TOOTH_PITCH;
  it('full at ≥ 6 device px per tooth pitch, linear below, gone at 3', () => {
    expect(TOOTH_PITCH).toBeCloseTo(Math.PI / 8, 12);
    expect(SOFT_FULL_PX).toBe(6);
    expect(SOFT_GONE_PX).toBe(3);
    expect(softContourFade(ppu(40))).toBe(1);
    expect(softContourFade(ppu(6))).toBeCloseTo(1, 12);
    expect(softContourFade(ppu(4.5))).toBeCloseTo(0.5, 12);
    expect(softContourFade(ppu(3))).toBe(0);
    expect(softContourFade(ppu(1))).toBe(0);
    expect(softContourFade(0)).toBe(0);
    expect(softContourFade(Number.NaN)).toBe(0);
    let prev = -1;
    for (let px = 0; px < 10; px += 0.05) {
      const f = softContourFade(ppu(px));
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

/** Tagged triangles by surface: [face floors, side walls, end walls], plus partially tagged ones. */
function groove(p: Part) {
  const md = buildPartMesh(p);
  const w = markWeights(p, md.positions, md.normals);
  const mk = rimMarks(p)[0]!;
  const a = mk.axis;
  const sAx = mk.dir.findIndex((x) => x !== 0);
  let floor = 0;
  let side = 0;
  let end = 0;
  let partial = 0;
  let area = 0;
  for (let i = 0; i < md.indices.length; i += 3) {
    const ids = [md.indices[i]!, md.indices[i + 1]!, md.indices[i + 2]!];
    const k = ids.filter((v) => w[v] === 1).length;
    if (k === 0) continue;
    if (k < 3) {
      partial++;
      continue;
    }
    const v = ids[0]!;
    const n = [md.normals[3 * v]!, md.normals[3 * v + 1]!, md.normals[3 * v + 2]!];
    if (Math.abs(n[a]!) > 0.9) floor++;
    else if (Math.abs(n[sAx]!) > 0.9) end++;
    else side++;
    const P = ids.map((q) => [md.positions[3 * q]!, md.positions[3 * q + 1]!, md.positions[3 * q + 2]!]);
    const u = P[1]!.map((x, j) => x - P[0]![j]!);
    const t = P[2]!.map((x, j) => x - P[0]![j]!);
    area += Math.hypot(u[1]! * t[2]! - u[2]! * t[1]!, u[2]! * t[0]! - u[0]! * t[2]!, u[0]! * t[1]! - u[1]! * t[0]!) / 2;
  }
  return { floor, side, end, partial, area, mk, md, w };
}

describe('the painted index on gears', () => {
  for (const axis of [0, 1, 2] as Axis[])
    for (const r of [1, 1.5, 2.5]) {
      it(`r ${r} about ${'XYZ'[axis]}: the face groove's floors, side walls and both end walls on both faces; never a tooth`, () => {
        const p = part([gear(axis, r)]);
        const g = groove(p);
        expect(g.mk.gear).toBe(true);
        expect(g.partial).toBe(0);
        expect(g.floor).toBeGreaterThanOrEqual(4);
        expect(g.side).toBeGreaterThanOrEqual(8);
        expect(g.end).toBeGreaterThanOrEqual(8); // inner + outer end wall, 2 triangles each, 2 faces
        const len = g.mk.r1 - g.mk.r0;
        const want = 2 * (len * MARK_W + 2 * len * MARK_D + 2 * MARK_W * MARK_D);
        expect(g.area).toBeGreaterThan(0.9 * want);
        expect(g.area).toBeLessThan(1.05 * want);
        // nothing on the tooth band and nothing past the groove's end
        for (let i = 0; i < g.w.length; i++) {
          if (g.w[i] !== 1) continue;
          const q = [0, 1, 2].map((j) => g.md.positions[3 * i + j]! - g.mk.center[j]!);
          const along = q[0]! * g.mk.dir[0] + q[1]! * g.mk.dir[1] + q[2]! * g.mk.dir[2];
          expect(along).toBeLessThan(g.mk.r1 + 2e-3);
          expect(Math.abs(q[axis]!)).toBeLessThan(H + 1e-3);
        }
      });
    }

  it('the 8-tooth gear has no groove; its index tooth is its only index', () => {
    const p = part([gear(2, 0.5)]);
    const md = buildPartMesh(p);
    expect(rimMarks(p)).toEqual([]);
    expect(markWeights(p, md.positions, md.normals).every((x) => x === 0)).toBe(true);
    expect(indexToothWeights(p, md.positions, md.normals).some((x) => x === 1)).toBe(true);
  });

  for (const r of GEAR_RADII)
    it(`r ${r}: the index tooth is tooth 0, at gearToothAngle(T, 0), wholly painted triangles`, () => {
      const p = part([gear(2, r)]);
      const md = buildPartMesh(p);
      const w = indexToothWeights(p, md.positions, md.normals);
      const g = gearIndexes(p)[0]!;
      const T = gearTeeth(r);
      let sx = 0;
      let sy = 0;
      let partial = 0;
      let full = 0;
      for (let i = 0; i < md.indices.length; i += 3) {
        const k = [0, 1, 2].filter((j) => w[md.indices[i + j]!] === 1).length;
        if (k === 0) continue;
        if (k < 3) partial++;
        else full++;
      }
      for (let v = 0; v < w.length; v++)
        if (w[v] === 1) {
          sx += md.positions[3 * v]! - g.center[0];
          sy += md.positions[3 * v + 1]! - g.center[1];
        }
      expect(partial).toBe(0);
      expect(full).toBeGreaterThan(8);
      const ang = Math.atan2(sy, sx);
      expect(Math.abs(ang - gearToothAngle(T, 0))).toBeLessThan(0.05 / r);
    });
});

/** A 40 + 8 + 24 train along X about Z, each gear its own part. */
function train(): Model {
  const m = emptyModel();
  m.version = 3;
  const cells: Cell[] = [gear(2, 2.5, [0, 0, 0]), gear(2, 0.5, [3, 0, 0]), gear(2, 1.5, [5, 0, 0])];
  m.parts = cells.map((c, i) => ({ id: i + 1, color: '#e0b43c', cells: [c] }));
  m.rootPartId = 1;
  m.nextPartId = 4;
  return m;
}

describe('mesh glyphs', () => {
  it('one per mesh, at the pitch point, in the gears’ plane', () => {
    const m = train();
    expect(gearMeshes(m).length).toBe(2);
    const gl = meshGlyphsFromModel(m);
    expect(gl.length).toBe(2);
    const f0 = meshGlyphFrame(gl[0]!, () => null)!;
    expect(f0.p[0]).toBeCloseTo(2.5, 12); // 40 at x 0 (r 2.5) meets the 8 at x 3
    expect(f0.p[1]).toBe(0);
    expect(f0.p[2]).toBe(0);
    expect(f0.c).toEqual([1, 0, 0]);
    const f1 = meshGlyphFrame(gl[1]!, () => null)!;
    expect(f1.p[0]).toBeCloseTo(3.5, 12); // the 8 at x 3 (r ½) meets the 24 at x 5
    const segs = meshGlyphSegments(gl, () => null);
    expect(segs.length).toBe(4);
    for (const [a, b] of segs) {
      expect(a[2]).toBeCloseTo(0, 12);
      expect(b[2]).toBeCloseTo(0, 12);
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(MESH_TICK_BACK + MESH_TICK_OVER, 12);
    }
    // the two ticks of a glyph are parallel, 2·GAP apart, and overlap past the pitch point
    const [t1, t2] = [segs[0]!, segs[1]!];
    expect(Math.abs(t1[0][1] - t2[0][1])).toBeCloseTo(2 * MESH_TICK_GAP, 12);
    expect(Math.max(t1[0][0], t1[1][0])).toBeGreaterThan(2.5);
    expect(Math.min(t2[0][0], t2[1][0])).toBeLessThan(2.5);
  });

  it('follows both gears’ transforms: the point stays between the moved hubs', () => {
    const m = train();
    const gl = meshGlyphsFromModel(m)[0]!;
    // the whole train shifted up by 2 and turned 90° about Z (hub B at x 3 → (0, 3))
    const s = Math.SQRT1_2;
    const q: [number, number, number, number] = [0, 0, s, s];
    const f = meshGlyphFrame(gl, () => ({ p: [0, 2, 0], q }))!;
    expect(f.p[0]).toBeCloseTo(0, 9);
    expect(f.p[1]).toBeCloseTo(4.5, 9);
    expect(f.c[1]).toBeCloseTo(1, 9);
    // a hub on another axis: ticks lie in that plane
    const gx: Cell[] = [gear(0, 1.5, [0, 0, 0]), gear(0, 1.5, [0, 3, 0])];
    const mx = emptyModel();
    mx.version = 3;
    mx.parts = gx.map((c, i) => ({ id: i + 1, color: '#e0b43c', cells: [c] }));
    mx.rootPartId = 1;
    mx.nextPartId = 3;
    const sx = meshGlyphSegments(meshGlyphsFromModel(mx), () => null);
    expect(sx.length).toBe(2);
    for (const [a, b] of sx) {
      expect(a[0]).toBeCloseTo(0, 12);
      expect(b[0]).toBeCloseTo(0, 12);
    }
  });

  it('no gears: no glyphs', () => {
    expect(meshGlyphsFromModel(buildExample('pendulum'))).toEqual([]);
  });
});
