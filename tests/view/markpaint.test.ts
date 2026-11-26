// The painted index mark (src/view/markpaint.ts, DESIGN §4.2 / §6.1 "Wheels"): exactly the groove's
// surfaces are tagged — never a face or tread vertex along its edge — on both faces and across the
// tread, in the mark's direction, for every radius and axis; nothing without a rim; the paint
// contrasts with the part colour.
import { beforeAll, describe, expect, it } from 'vitest';
import { makeCell } from '../../src/core';
import type { Axis, Cell, Part } from '../../src/core';
import { H, MARK_D, MARK_W, buildPartMesh, initGeometry, rimMarks } from '../../src/geometry';
import { markColor, markWeights } from '../../src/view/markpaint';

beforeAll(async () => {
  await initGeometry();
});

const part = (cells: Cell[]): Part => ({ id: 1, color: '#5f6468', cells });

/** Area of the triangles whose three vertices are all tagged, and their area-weighted centroid. */
function tagged(p: Part) {
  const md = buildPartMesh(p);
  const w = markWeights(p, md.positions, md.normals);
  let area = 0;
  const cen = [0, 0, 0];
  let partial = 0;
  for (let i = 0; i < md.indices.length; i += 3) {
    const ids = [md.indices[i]!, md.indices[i + 1]!, md.indices[i + 2]!];
    const k = ids.filter((v) => w[v] === 1).length;
    if (k === 0) continue;
    if (k < 3) {
      partial++;
      continue;
    }
    const P = ids.map((v) => [md.positions[3 * v]!, md.positions[3 * v + 1]!, md.positions[3 * v + 2]!]);
    const u = P[1]!.map((x, j) => x - P[0]![j]!);
    const v = P[2]!.map((x, j) => x - P[0]![j]!);
    const cr = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const A = Math.hypot(...cr) / 2;
    area += A;
    for (let j = 0; j < 3; j++) cen[j] = cen[j]! + (A * (P[0]![j]! + P[1]![j]! + P[2]![j]!)) / 3;
  }
  return { area, centroid: cen.map((x) => x / (area || 1)), partial, md, w };
}

describe('markWeights', () => {
  it('a bare hole: nothing tagged', () => {
    const p = part([makeCell(0, 0, 0, 'pinHole', 2)]);
    const md = buildPartMesh(p);
    expect(markWeights(p, md.positions, md.normals).every((x) => x === 0)).toBe(true);
  });

  for (const axis of [0, 1, 2] as Axis[])
    for (const r of [1, 1.5, 2.5, 4]) {
      it(`r ${r} about ${'XYZ'[axis]}: the groove's floors and walls, along the mark, on both faces and the tread`, () => {
        const p = part([makeCell(0, 0, 0, 'axleHole', axis, r)]);
        const mk = rimMarks(p)[0]!;
        const t = tagged(p);
        // No triangle is half painted: the groove's vertices are separate from the face's.
        expect(t.partial).toBe(0);
        // Expected area: 2 face grooves (floor + 2 side walls + end wall) + the tread groove
        // (floor across the full thickness + 2 side walls). Chamfers make it a little smaller.
        const len = mk.r1 - mk.r0;
        const face = len * MARK_W + 2 * len * MARK_D + MARK_W * MARK_D;
        const tread = 2 * H * MARK_W + 2 * 2 * H * MARK_D;
        const want = 2 * face + tread;
        expect(t.area).toBeGreaterThan(0.8 * want);
        expect(t.area).toBeLessThan(1.1 * want);
        // It lies along the mark's direction from the hub (part-local centre).
        const along = [0, 1, 2].reduce((acc, j) => acc + (t.centroid[j]! - mk.center[j]!) * mk.dir[j]!, 0);
        expect(along).toBeGreaterThan(mk.r0);
        // No tagged vertex sits on an outer face or on the tread surface itself.
        for (let i = 0; i < t.w.length; i++) {
          if (t.w[i] !== 1) continue;
          const q = [0, 1, 2].map((j) => t.md.positions[3 * i + j]! - mk.center[j]!);
          const na = t.md.normals[3 * i + axis]!;
          if (Math.abs(na) > 0.9) expect(Math.abs(Math.abs(q[axis]!) - (H - MARK_D))).toBeLessThan(2e-3);
        }
      });
    }

  it('a wheel in a beam: only its own groove, one per rim', () => {
    const p = part([makeCell(0, 0, 0, 'pinHole', 2, 2), makeCell(-1, 0, 0, 'pinHole', 2), makeCell(-2, 0, 0, 'pinHole', 2, 1.5)]);
    expect(rimMarks(p).length).toBe(2);
    const t = tagged(p);
    expect(t.partial).toBe(0);
    expect(t.area).toBeGreaterThan(0.3);
  });
});

describe('markColor', () => {
  it('contrasts: lighter on dark colours, darker on light ones', () => {
    const lum = (h: string) => {
      const v = parseInt(h.slice(1), 16);
      return (0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255)) / 255;
    };
    for (const c of ['#e0b43c', '#e07b2e', '#c8433a', '#4c9a57', '#3b74c4', '#e8e8e4', '#a8adb2', '#5f6468']) {
      const m = markColor(c);
      expect(m).toMatch(/^#[0-9a-f]{6}$/);
      expect(Math.abs(lum(m) - lum(c))).toBeGreaterThan(0.18);
    }
  });
});
