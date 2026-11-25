// Independent review tests of src/view pure helpers (DESIGN.md §6.2).
import { describe, expect, it } from 'vitest';
import {
  ISO_PITCH,
  cameraBasis,
  defaultCamera,
  nearestQuarterYaw,
  orientationForDir,
  parseViewName,
  projectPoint,
  zoomAt,
  ndcOffset,
} from '../../src/view/math';

describe('review: view math', () => {
  it('basis is right-handed and orthonormal for many orientations', () => {
    for (let yaw = -3; yaw <= 3; yaw += 0.37)
      for (const pitch of [-Math.PI / 2, -1, -0.2, 0, 0.3, ISO_PITCH, 1.2, Math.PI / 2]) {
        const { right, up, back } = cameraBasis(yaw, pitch);
        const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
        expect(Math.abs(dot(right, up))).toBeLessThan(1e-12);
        expect(Math.abs(dot(right, back))).toBeLessThan(1e-12);
        expect(Math.abs(dot(up, back))).toBeLessThan(1e-12);
        // right × up = back (right-handed, camera looks along −back)
        const c = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]];
        expect(dot(c, back)).toBeCloseTo(1, 12);
        if (Math.abs(pitch) < Math.PI / 2) expect(up[1]).toBeGreaterThan(0); // turntable: never upside down
      }
  });

  it('zoomAt keeps the point under the cursor fixed', () => {
    const s = { ...defaultCamera(), target: [1, 2, 3] as [number, number, number] };
    for (const [nx, ny, f] of [[0.3, -0.7, 0.5], [-0.9, 0.9, 1.7], [0, 0, 0.1]] as const) {
      const p = ndcOffset(s, 1.6, nx, ny).map((v, i) => v + s.target[i]!) as [number, number, number];
      const z = zoomAt(s, 1.6, nx, ny, f);
      const q = projectPoint(z, 1.6, p);
      expect(q.ndcX).toBeCloseTo(nx, 12);
      expect(q.ndcY).toBeCloseTo(ny, 12);
    }
  });

  // FINDING: the default (home) yaw is exactly π/4, a tie for the quarter-turn rounding used by the
  // view cube's TOP/BOTTOM (keepYaw). Math.round(0.5) = 1, so TOP from the home view comes out
  // rotated a quarter turn (screen up = −X, FRONT on the left) instead of the canonical
  // front-at-the-bottom view.
  it('TOP clicked from the home view is the canonical top view (yaw 0)', () => {
    const home = orientationForDir(parseViewName('iso')!);
    const top = orientationForDir([0, 1, 0], nearestQuarterYaw(home.yaw));
    expect(top.yaw).toBe(0);
  });
});
