// The edge-on floor line's fade (src/view/floor.ts, DESIGN §6.1 "Ground": edge-on, the floor is a line).
import { describe, expect, it } from 'vitest';
import { FLOOR_EDGE_Y, floorEdgeAlpha } from '../../src/view/floor';

describe('floorEdgeAlpha', () => {
  it('full strength edge-on, gone beyond FLOOR_EDGE_Y, monotone and symmetric in between', () => {
    expect(floorEdgeAlpha(0)).toBe(1);
    expect(floorEdgeAlpha(FLOOR_EDGE_Y)).toBe(0);
    expect(floorEdgeAlpha(-0.5)).toBe(0);
    let prev = 1;
    for (let y = 0; y <= FLOOR_EDGE_Y; y += FLOOR_EDGE_Y / 50) {
      const a = floorEdgeAlpha(y);
      expect(a).toBeLessThanOrEqual(prev + 1e-12);
      expect(floorEdgeAlpha(-y)).toBeCloseTo(a, 12);
      prev = a;
    }
  });
});
