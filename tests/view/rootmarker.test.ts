import { describe, expect, it } from 'vitest';
import { MARK, placeMark, rootAnchorIndex } from '../../src/view/rootmarker';

const P = (x: number, y: number, z: number) => ({ x, y, z });

describe('rootAnchorIndex', () => {
  it('empty → -1; one cell → 0', () => {
    expect(rootAnchorIndex([])).toBe(-1);
    expect(rootAnchorIndex([P(3, 4, 5)])).toBe(0);
  });
  it('lowest row, nearest its centroid', () => {
    const cells = [P(0, 1, 0), P(-2, 0, 0), P(-1, 0, 0), P(0, 0, 0), P(5, 2, 0)];
    expect(cells[rootAnchorIndex(cells)]).toEqual(P(-1, 0, 0));
    // an upright beam: its bottom cell
    expect(rootAnchorIndex([P(0, 2, 0), P(0, 1, 0), P(0, 0, 0)])).toBe(2);
  });
  it('ties: lower x, then lower z; independent of cell order', () => {
    const a = [P(0, 0, 0), P(1, 0, 0)];
    expect(a[rootAnchorIndex(a)]).toEqual(P(0, 0, 0));
    const b = [P(1, 0, 0), P(0, 0, 0)];
    expect(b[rootAnchorIndex(b)]).toEqual(P(0, 0, 0));
    const c = [P(0, 0, 1), P(0, 0, 0)];
    expect(c[rootAnchorIndex(c)]).toEqual(P(0, 0, 0));
    const ring = [P(1, 0, 0), P(-1, 0, 0), P(0, 0, 1), P(0, 0, -1)];
    for (let k = 0; k < 4; k++) {
      const r = [...ring.slice(k), ...ring.slice(0, k)];
      expect(r[rootAnchorIndex(r)]).toEqual(P(-1, 0, 0));
    }
  });
});

describe('placeMark (§6.1 always visible)', () => {
  const W = 800;
  const H = 600;
  const e = MARK.edge;
  it('inside the view: exactly the anchor position', () => {
    expect(placeMark([400, 300], [[400, 280]], 20, W, H)).toEqual({ x: 400, y: 300, clamped: false });
    // just fitting at every edge
    for (const at of [[MARK.halfWidth + e, e], [W - MARK.halfWidth - e, H - MARK.hatch - e]] as [number, number][])
      expect(placeMark(at, [], 20, W, H)).toEqual({ x: at[0], y: at[1], clamped: false });
  });
  it('anchor off-screen, root on screen: clamped into the view', () => {
    // the anchor below the view, a root cell near the bottom
    expect(placeMark([300, 1220], [[300, 590], [300, 1200]], 20, W, H)).toEqual({ x: 300, y: H - MARK.hatch - e, clamped: true });
    // left of the view: only x moves
    expect(placeMark([-50, 200], [[10, 200]], 20, W, H)).toEqual({ x: MARK.halfWidth + e, y: 200, clamped: true });
    // a cell just reaching in from outside counts (its half-size overlaps)
    expect(placeMark([-50, 200], [[-15, 200]], 20, W, H).clamped).toBe(true);
  });
  it('root entirely off-screen: left where the anchor is', () => {
    expect(placeMark([-50, 200], [[-25, 200], [-60, 200]], 20, W, H)).toEqual({ x: -50, y: 200, clamped: false });
    expect(placeMark([300, 1220], [], 20, W, H)).toEqual({ x: 300, y: 1220, clamped: false });
  });
  it("continuous while the root is on screen: a sweep of the anchor across the edge never jumps", () => {
    let prev: { x: number; y: number } | null = null;
    for (let x = 200; x > -80; x -= 0.5) { // the root cell leaves the view at x = −80
      const r = placeMark([x, 300], [[x + 60, 300]], 20, W, H);
      if (prev) expect(Math.abs(r.x - prev.x) + Math.abs(r.y - prev.y)).toBeLessThanOrEqual(0.5 + 1e-9);
      prev = r;
    }
  });
  it('view smaller than the mark: centred, no NaN', () => {
    const r = placeMark([100, 100], [[5, 5]], 20, 10, 6);
    expect(r).toEqual({ x: 5, y: (e + 6 - MARK.hatch - e) / 2, clamped: true });
  });
});
