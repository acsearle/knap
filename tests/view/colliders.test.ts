// Show colliders (DESIGN §7.4), view side: the drawn geometry of each collider kind (true
// polyhedron edges, no triangulation diagonals), the per-part data and its cache, the legend rows.
import { describe, expect, it } from 'vitest';
import { buildExample } from '../../src/core/examples';
import { makeCell } from '../../src/core/model';
import type { Part } from '../../src/core/types';
import { colliderSpecs, prismShape, wheelHullPieces, wheelShape } from '../../src/physics/shapes';
import { colliderLegendRows } from '../../src/ui/colliderlegend';
import {
  COLLIDER_ROLES,
  COLLIDER_STYLE,
  boxGeometry,
  colliderDataStats,
  colliderKey,
  colliderMeshData,
  cylinderGeometry,
  cylinderSides,
  hullGeometry,
  modelHasGround,
  partColliderData,
} from '../../src/view/colliders';

const edgeCount = (g: { edges: number[] }) => g.edges.length / 6;

/** Every edge has both ends on hull vertices, and no edge is repeated. */
function edgesWellFormed(g: { edges: number[] }): boolean {
  const seen = new Set<string>();
  for (let i = 0; i < g.edges.length; i += 6) {
    const a = g.edges.slice(i, i + 3).map((x) => x.toFixed(9)).join();
    const b = g.edges.slice(i + 3, i + 6).map((x) => x.toFixed(9)).join();
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(k) || a === b) return false;
    seen.add(k);
  }
  return true;
}

describe('collider geometry: faces and true edges', () => {
  it('a box: 8 vertices, 12 edges, 6 faces (12 triangles, no diagonals)', () => {
    const g = boxGeometry([1, 2, 3], [0.46, 0.04, 0.46]);
    expect(edgeCount(g)).toBe(12);
    expect(g.faces).toBe(6);
    expect(g.vertices).toBe(8);
    expect(g.triangles.length / 9).toBe(12);
    expect(edgesWellFormed(g)).toBe(true);
  });

  it('a wheel wedge (one hull piece): a triangular prism, 6 vertices, 9 edges, 5 faces', () => {
    for (const axis of [0, 1, 2] as const) {
      const piece = wheelHullPieces([0, 0, 0], axis, 2, 0.46)[5]!;
      const g = hullGeometry(piece);
      expect(edgeCount(g)).toBe(9);
      expect(g.faces).toBe(5);
      expect(g.vertices).toBe(6);
    }
  });

  it('a 16-gon bevelled prism (a pin barrel): 32 vertices, 64 edges, 34 faces — the bevel facets stay edges', () => {
    // 16 sides + per cap the kept rectangle and 8 bevel facets (1 + 3 + 1 + 3 between the kept
    // corners): V − E + F = 32 − 64 + 34 = 2.
    const g = hullGeometry(prismShape([0, 0, 0], 2, 0.46, 0.46, 16, 0).points);
    expect(g.vertices).toBe(32);
    expect(edgeCount(g)).toBe(64);
    expect(g.faces).toBe(34);
    expect(edgesWellFormed(g)).toBe(true);
  });

  it('a liftarm run is one stadium prism; Euler holds for runs and wheel guards', () => {
    for (const n of [1, 2, 6]) {
      const g = hullGeometry(prismShape([0, 0, 0], 2, 0.46, 0.46, 16, 0, n).points);
      expect(g.vertices).toBe(32);
      expect(g.vertices! - edgeCount(g) + g.faces!).toBe(2);
    }
    const guard = hullGeometry(wheelShape([0, 0, 0], 0, 1.96, 0.46, 0.5, 2).guard);
    expect(guard.vertices).toBe(64);
    expect(edgeCount(guard)).toBe(144);
    expect(guard.vertices! - edgeCount(guard) + guard.faces!).toBe(2);
  });

  it('a native cylinder: smooth side, two rim circles', () => {
    const g = cylinderGeometry([0, 1, 0], 2, 1.96, 0.46);
    const n = cylinderSides(1.96);
    expect(edgeCount(g)).toBe(2 * n);
    // Every edge lies on a rim circle at ±halfLength.
    for (let i = 0; i < g.edges.length; i += 3) {
      expect(Math.abs(Math.abs(g.edges[i + 2]!) - 0.46)).toBeLessThan(1e-12);
      expect(Math.hypot(g.edges[i]!, g.edges[i + 1]! - 1)).toBeCloseTo(1.96, 12);
    }
    // Side normals are radial (smooth), one per vertex.
    expect(g.vertexNormals.length).toBe(g.triangles.length);
  });
});

describe('per-part collider data', () => {
  const wheelPart: Part = { id: 1, color: '#808080', cells: [makeCell(0, 0, 0, 'pinHole', 2, 2)] };

  it('a wheel: 1 round, 64 hull pieces, a guard only with the ground; shared wedge edges drawn once', () => {
    const off = colliderMeshData(colliderSpecs(wheelPart, 16, false));
    const on = colliderMeshData(colliderSpecs(wheelPart, 16, true));
    expect(off.counts).toEqual({ part: 1, round: 1, hull: 64, guard: 0 });
    expect(on.counts).toEqual({ part: 1, round: 1, hull: 64, guard: 1 });
    // Hull edges, each wedge a triangular prism (9 edges, 576 in all): per slab an axis segment,
    // 32 radial + 32 rim edges on each of its two end planes and 32 tread edges (161); the two slabs
    // share their middle plane's 64: 2 × 161 − 64 = 258.
    const roleOf = (k: number) => [...off.edgeColors.slice(4 * k, 4 * k + 3)].map((x) => x.toFixed(4)).join();
    const hullColor = hexRgb(COLLIDER_STYLE.hull.line).map((x) => x.toFixed(4)).join();
    let hull = 0;
    for (let k = 0; k < off.edgeColors.length / 4; k++) if (roleOf(k) === hullColor) hull++;
    expect(hull).toBe(258);
    // Fill groups are sorted by role.
    expect(off.groups.map((g) => g.role)).toEqual(['part', 'hull', 'round']);
    expect(on.groups.map((g) => g.role)).toEqual(['part', 'hull', 'round', 'guard']);
  });

  it('is cached per part signature and ground flag: a translated copy reuses the data', () => {
    const a = buildExample('cart').parts.find((p) => p.cells.some((c) => c.rim !== undefined))!;
    const moved: Part = { ...a, id: 99, cells: a.cells.map((c) => ({ ...c, x: c.x + 7, z: c.z - 3 })) };
    const before = colliderDataStats().builds;
    const d1 = partColliderData(a, true);
    const d2 = partColliderData(moved, true);
    expect(d2).toBe(d1);
    expect(colliderKey(a, true)).toBe(colliderKey(moved, true));
    const d3 = partColliderData(a, false);
    expect(d3).not.toBe(d1);
    expect(d3.counts.guard).toBe(0);
    expect(colliderDataStats().builds - before).toBeLessThanOrEqual(2);
    expect(partColliderData(a, true)).toBe(d1);
  });

  it('local coordinates: a part and its translated copy draw the same local geometry', () => {
    const p: Part = { id: 1, color: '#808080', cells: [0, 1, 2].map((k) => makeCell(k, 0, 0, 'pinHole', 2)) };
    const q: Part = { ...p, cells: p.cells.map((c) => ({ ...c, x: c.x + 4, y: c.y + 1 })) };
    const a = colliderMeshData(colliderSpecs(p, 16, false), [0, 0, 0]);
    const b = colliderMeshData(colliderSpecs(q, 16, false), [4, 1, 0]);
    // The same edges (the triangulation of a flat face may differ: the hull builder's choice).
    const edges = (d: typeof a) => {
      const out: string[] = [];
      for (let i = 0; i < d.ends.length; i += 6) {
        const v = [0, 1].map((k) => [...d.ends.slice(i + 3 * k, i + 3 * k + 3)].map((x) => x.toFixed(5)).join()).sort();
        out.push(v.join('|'));
      }
      return out.sort();
    };
    expect(edges(b)).toEqual(edges(a));
    expect(b.positions.length).toBe(a.positions.length);
    // A three-hole liftarm is one stadium prism: 32 vertices, 68 edges.
    expect(a.counts).toEqual({ part: 1, round: 0, hull: 0, guard: 0 });
    expect(a.ends.length / 6).toBe(68);
  });
});

describe('look and legend', () => {
  it('role colours differ in lightness (CIE L*) by ≥ 10 between any two roles, edges and fills', () => {
    for (const key of ['line', 'fill'] as const) {
      const L = COLLIDER_ROLES.map((r) => lstar(COLLIDER_STYLE[r][key]));
      for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) expect(Math.abs(L[i]! - L[j]!), `${key} ${COLLIDER_ROLES[i]} / ${COLLIDER_ROLES[j]}`).toBeGreaterThanOrEqual(10);
    }
  });

  it('legend rows: the kinds present with their totals, the floor with the ground on, the joined note', () => {
    const cart = buildExample('cart');
    const parts = cart.parts.map((p) => colliderMeshData(colliderSpecs(p, 16, modelHasGround(cart))));
    const rows = colliderLegendRows(parts, modelHasGround(cart));
    expect(rows.map((r) => [r.role, r.count])).toEqual([
      ['part', 37],
      ['hull', 256],
      ['round', 4],
      ['guard', 4],
      ['floor', null],
      ['joined', null],
    ]);
    expect(rows.map((r) => `${r.label}: ${r.meets}`)).toEqual([
      'Part shapes: hit other parts, wheel pieces and the floor',
      'Wheel pieces: hit part shapes only',
      'Wheel discs: hit the floor and other wheel discs',
      'Ground guards: hit the floor only',
      'Floor: hit by part shapes, discs and guards',
      'Joined parts: never hit each other (welded, or linked by a pin or axle)',
    ]);
    // Hidden parts (a body removed while simulating) are not counted.
    const hiddenWheel = parts.map((p) => ({ ...p, visible: p.counts.round === 0 }));
    expect(colliderLegendRows(hiddenWheel, true).map((r) => r.role)).toEqual(['part', 'floor', 'joined']);
    // Gears: their own disc line; no wheels, no floor without the ground.
    const gt = buildExample('gear-train');
    const gRows = colliderLegendRows(gt.parts.map((p) => colliderMeshData(colliderSpecs(p, 16, false))), false);
    expect(gRows.map((r) => `${r.label} ${r.count}: ${r.meets}`)).toEqual([
      'Part shapes 34: hit other parts and gear pieces',
      'Gear pieces 256: hit part shapes only',
      "Gear discs 4: never hit another gear's disc",
      'Joined parts null: never hit each other (welded, or linked by a pin or axle)',
    ]);
    const pend = buildExample('pendulum');
    expect(colliderLegendRows(pend.parts.map((p) => colliderMeshData(colliderSpecs(p, 16, false))), modelHasGround(pend)).map((r) => r.role)).toEqual(['part', 'joined']);
    // No joint and no welded body: no joined-parts note.
    expect(colliderLegendRows(pend.parts.map((p) => colliderMeshData(colliderSpecs(p, 16, false))), false, false).map((r) => r.role)).toEqual(['part']);
    // Nothing to draw: one 'none' row.
    expect(colliderLegendRows([], true).map((r) => r.role)).toEqual(['none']);
    for (const r of [...rows, ...gRows]) expect(`${r.label} ${r.meets}`).not.toMatch(/group|LEGO|Technic|rim/i);
  });
});

function hexRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function lstar(hex: string): number {
  const f = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = hexRgb(hex).map(f) as [number, number, number];
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y;
}
