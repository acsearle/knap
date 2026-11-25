import { beforeAll, describe, expect, it } from 'vitest';
import { buildPartMesh, initGeometry } from '../../src/geometry';
import { analyze } from '../../src/core/kinematics';
import { buildExample } from '../../src/core/examples';
import type { Cell, Part } from '../../src/core';
import { vertexPatches } from '../../src/view/patches';
import { glyphSegments, jointGlyphsFromGraph, rotateByQuat, RING_RADIUS } from '../../src/view/glyphs';
import { cubeRegionAt } from '../../src/view/viewcube';

beforeAll(async () => {
  await initGeometry();
});

const liftarm = (n: number): Part => ({
  id: 1,
  color: '#ff0000',
  cells: Array.from({ length: n }, (_, i): Cell => ({ x: i, y: 0, z: 0, kind: 'pinHole', axis: 2 })),
});

describe('smooth patches', () => {
  it('labels two disjoint triangles as two patches and a quad as one', () => {
    expect(vertexPatches(6, [0, 1, 2, 3, 4, 5]).count).toBe(2);
    const q = vertexPatches(4, [0, 1, 2, 0, 2, 3]);
    expect(q.count).toBe(1);
    expect([...q.patch]).toEqual([0, 0, 0, 0]);
  });

  it('a pin-hole liftarm has top, bottom, outer wall and one bore wall per hole', () => {
    for (const n of [1, 3, 5]) {
      const md = buildPartMesh(liftarm(n));
      const { count } = vertexPatches(md.positions.length / 3, md.indices);
      expect(count).toBe(3 + n);
    }
  });

  it('a single pin cell: side, and two chamfered ends (cone + disc each)', () => {
    const md = buildPartMesh({ id: 1, color: '#000000', cells: [{ x: 0, y: 0, z: 0, kind: 'pin', axis: 0 }] });
    expect(vertexPatches(md.positions.length / 3, md.indices).count).toBe(5);
  });

  it('patches are smooth: every triangle of a patch has the patch of its vertices', () => {
    const md = buildPartMesh(liftarm(4));
    const { patch } = vertexPatches(md.positions.length / 3, md.indices);
    for (let t = 0; t < md.indices.length; t += 3) {
      expect(patch[md.indices[t]!]).toBe(patch[md.indices[t + 1]!]);
      expect(patch[md.indices[t]!]).toBe(patch[md.indices[t + 2]!]);
    }
  });
});

describe('joint glyphs', () => {
  it('one glyph per joint, following the first part of body B', () => {
    const g = analyze(buildExample('four-bar'));
    const glyphs = jointGlyphsFromGraph(g);
    expect(glyphs).toHaveLength(g.joints.length);
    for (let i = 0; i < glyphs.length; i++) {
      expect(glyphs[i]!.type).toBe(g.joints[i]!.type);
      expect(glyphs[i]!.followPartId).toBe(g.bodies[g.joints[i]!.bodyB]!.partIds[0]);
    }
  });

  it('revolute = ring only, prismatic = arrow only, cylindrical = both; transforms apply', () => {
    const back: [number, number, number] = [0, 0, 1];
    const ring = glyphSegments([{ type: 'revolute', origin: [1, 2, 3], axis: 2 }], back, () => null);
    for (const [a] of ring) expect(Math.hypot(a[0] - 1, a[1] - 2)).toBeCloseTo(RING_RADIUS, 9);
    expect(ring.every(([a, b]) => a[2] === 3 && b[2] === 3)).toBe(true);
    const arrow = glyphSegments([{ type: 'prismatic', origin: [0, 0, 0], axis: 1 }], back, () => null);
    expect(arrow).toHaveLength(5); // shaft + 2 heads × 2 strokes
    const cyl = glyphSegments([{ type: 'cylindrical', origin: [0, 0, 0], axis: 1 }], back, () => null);
    expect(cyl.length).toBe(ring.length + 5);
    // follow a transform: rotate 90° about Z around the origin then shift
    const h = Math.SQRT1_2;
    const moved = glyphSegments([{ type: 'prismatic', origin: [1, 0, 0], axis: 0, followPartId: 7 }], back, (id) =>
      id === 7 ? { p: [0, 0, 5], q: [0, 0, h, h] } : null,
    );
    const shaft = moved[0]!;
    // origin (1,0,0) -> (0,1,5); axis X -> Y
    expect((shaft[0][1] + shaft[1][1]) / 2).toBeCloseTo(1, 9);
    expect(shaft[1][1] - shaft[0][1]).toBeGreaterThan(1.9);
    expect(shaft[0][2]).toBeCloseTo(5, 9);
    const r = rotateByQuat([0, 0, h, h], [1, 0, 0]);
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[1]).toBeCloseTo(1, 12);
  });
});

describe('view cube regions', () => {
  it('maps surface points to faces, edges and corners', () => {
    expect(cubeRegionAt([1, 0.1, -0.2])).toEqual([1, 0, 0]);
    expect(cubeRegionAt([0.3, 1, 0.9])).toEqual([0, 1, 1]);
    expect(cubeRegionAt([-0.95, -0.8, -1])).toEqual([-1, -1, -1]);
    expect(cubeRegionAt([0.59, -1, 0])).toEqual([0, -1, 0]);
  });
});
