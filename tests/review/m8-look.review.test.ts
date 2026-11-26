// Reviewer "look" (m8): pins what the look review verified in the drawing helpers. The visual
// findings (dashed tooth contours etc.) live in e2e/review-m8-look-*.mjs and their PNGs.
import { beforeAll, describe, expect, it } from 'vitest';
import { GEAR_RADII, gearTeeth, gearToothAngle, makeCell } from '../../src/core';
import type { Axis, Part } from '../../src/core';
import { buildPartMesh, indexToothWeights, initGeometry } from '../../src/geometry';
import { softContourFade } from '../../src/view/patches';

beforeAll(async () => {
  await initGeometry();
});

describe('m8 look: soft contour fade (§6.1: full at >= 6 device px per tooth pitch, gone at 3)', () => {
  const pxPerUnit = (pitchPx: number) => pitchPx / (Math.PI / 8);
  it('is 1 at 6 px, 0 at 3 px, monotone between', () => {
    expect(softContourFade(pxPerUnit(6))).toBeCloseTo(1, 9);
    expect(softContourFade(pxPerUnit(3))).toBe(0);
    expect(softContourFade(pxPerUnit(4.5))).toBeCloseTo(0.5, 9);
    let prev = -1;
    for (let p = 2; p <= 8; p += 0.05) {
      const f = softContourFade(pxPerUnit(p));
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe('m8 look: index tooth paint (§4.2 tooth 0, flanks + tip land)', () => {
  for (const axis of [0, 1, 2] as Axis[])
    for (const r of GEAR_RADII)
      it(`axis ${axis}, ${gearTeeth(r)} teeth: painted vertices lie within half a pitch of tooth 0's angle`, () => {
        const part: Part = { id: 1, color: '#e0b43c', cells: [makeCell(0, 0, 0, 'axleHole', axis, r, true)] };
        const md = buildPartMesh(part);
        const w = indexToothWeights(part, md.positions, md.normals);
        const T = gearTeeth(r);
        const a0 = gearToothAngle(T, 0);
        const ua = (axis + 1) % 3;
        const va = (axis + 2) % 3;
        // part-local coordinates: find the hub centre as the mean of all vertices' (u, v)
        let cu = 0, cv = 0;
        const n = md.positions.length / 3;
        for (let i = 0; i < n; i++) { cu += md.positions[3 * i + ua]!; cv += md.positions[3 * i + va]!; }
        cu /= n; cv /= n;
        let painted = 0, worst = 0;
        for (let i = 0; i < n; i++) {
          if (!w[i]) continue;
          painted++;
          let d = Math.atan2(md.positions[3 * i + va]! - cv, md.positions[3 * i + ua]! - cu) - a0;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          worst = Math.max(worst, Math.abs(d));
        }
        expect(painted).toBeGreaterThan(8);
        expect(worst).toBeLessThan(Math.PI / T);
      });
});
