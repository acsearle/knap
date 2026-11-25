import { beforeAll, describe, expect, it } from 'vitest';
import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import {
  EPS,
  E_CONN,
  E_FREE,
  H,
  R_BORE,
  SEGMENTS,
  W_BORE,
  buildPartMesh,
  clearMeshCache,
  initGeometry,
  liveManifoldCount,
  meshCacheStats,
  partOrigin,
  partSolidStats,
  partVolume,
} from '../../src/geometry';
import type { MeshData } from '../../src/geometry';
import { CATALOG } from '../../e2e/geom-catalog';
import { V, bbox, c, crossArea, edgeProblems, liftarm, meshGenus, meshShells, meshVolume, part, weld } from './helpers';

let M: ManifoldToplevel;
beforeAll(async () => {
  await initGeometry();
  M = await Module();
  M.setup();
});

/** Re-import the (welded) output mesh into manifold and check it is a valid closed manifold. */
function manifoldStatus(m: MeshData): { status: string; genus: number; volume: number; shells: number } {
  const { pos, tri } = weld(m);
  const mesh = new M.Mesh({ numProp: 3, vertProperties: new Float32Array(pos.flat()), triVerts: new Uint32Array(tri) });
  const mf = new M.Manifold(mesh);
  const parts = mf.decompose();
  const r = { status: mf.status(), genus: mf.genus(), volume: mf.volume(), shells: parts.length };
  for (const q of parts) q.delete();
  mf.delete();
  return r;
}

/** Material area of the section ⟂ X at x, within the square |y|,|z| ≤ hw around the X axis
 *  (or within [lo, hi]² in (y, z) when given). */
function sectionX(m: MeshData, x: number, hw = 0.5, lo?: [number, number], hi?: [number, number]): number {
  const { pos, tri } = weld(m);
  const mf = new M.Manifold(new M.Mesh({ numProp: 3, vertProperties: new Float32Array(pos.flat()), triVerts: new Uint32Array(tri) }));
  const r = mf.rotate([0, -90, 0]); // x → z; slice coords (u, v) = (−z, y)
  const cs = r.slice(x);
  const [u0, v0] = lo ? [-hi![1], lo[0]] : [-hw, -hw];
  const [u1, v1] = lo ? [-lo[1], hi![0]] : [hw, hw];
  const sq = M.CrossSection.square([u1 - u0, v1 - v0], false).translate([u0, v0]);
  const i = cs.intersect(sq);
  const a = i.area();
  for (const o of [i, sq, cs, r, mf]) o.delete();
  return a;
}

describe('initGeometry', () => {
  it('is idempotent', async () => {
    const a = initGeometry();
    const b = initGeometry();
    expect(a).toBe(b);
    await a;
  });
});

describe('every catalogue part is a clean closed 2-manifold', () => {
  for (const { name, part: p } of CATALOG) {
    it(name, () => {
      clearMeshCache();
      const m = buildPartMesh(p);
      expect(m.indices.length).toBeGreaterThan(0);
      expect(edgeProblems(m)).toEqual([]);
      const st = manifoldStatus(m);
      expect(st.status).toBe('NoError');
      expect(st.shells).toBe(1); // no sealed internal cavity (genus checks assume one shell)
      expect(meshShells(m)).toBe(1);
      const raw = partSolidStats(p);
      expect(raw.status).toBe('NoError');
      expect(st.genus).toBe(raw.genus);
      expect(meshGenus(m)).toBe(raw.genus);
      const vol = meshVolume(m);
      expect(vol).toBeGreaterThan(0);
      expect(vol).toBeCloseTo(raw.volume, 4);
      // normals: finite and unit length
      for (let i = 0; i < m.normals.length; i += 3) {
        const l = Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!);
        expect(Number.isFinite(l)).toBe(true);
        expect(Math.abs(l - 1)).toBeLessThan(1e-5);
      }
      for (const v of m.positions) expect(Number.isFinite(v)).toBe(true);
      expect(m.origin).toEqual(partOrigin(p));
    });
  }
});

describe('2D slab fast path agrees with the general 3D CSG', () => {
  const extra = [
    liftarm(7),
    part([0, 1, 2].flatMap((i) => [c(i, 0, 0, 'pinHole', 2), c(i, 1, 0, 'axleHole', 2)])),
    part([c(0, 0, 0, 'pinHole', 0), c(0, 1, 0, 'pinHole', 2), c(0, 0, 1, 'axleHole', 1), c(1, 0, 0, 'axle', 0)]),
  ];
  for (const p of [...CATALOG.map((e) => e.part), ...extra]) {
    it(`${p.cells.length} cells: ${p.cells.map((q) => q.kind[0]).join('')}`, () => {
      const a = partSolidStats(p, { fast: true });
      const b = partSolidStats(p, { fast: false });
      expect(a.status).toBe('NoError');
      expect(b.status).toBe('NoError');
      expect(a.genus).toBe(b.genus);
      expect(Math.abs(a.volume - b.volume) / b.volume).toBeLessThan(1e-5);
    });
  }
});

describe('volumes match analytic values within 1%', () => {
  const cases: [string, ReturnType<typeof part>, number][] = [
    ['single pinHole', part([c(0, 0, 0, 'pinHole', 2)]), V.pinHole],
    ['single axleHole', part([c(0, 0, 0, 'axleHole', 1)]), V.axleHole],
    ['single pin', part([c(0, 0, 0, 'pin', 0)]), V.pin],
    ['single axle', part([c(0, 0, 0, 'axle', 1)]), V.axle],
    ['2-hole stadium', liftarm(2), V.stadium(2)],
    ['5-hole liftarm', liftarm(5), V.stadium(5)],
    ['tube of 2 coaxial holes', part([c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'pinHole', 0)]), V.tube(2)],
    ['tube of 3 coaxial holes', part([c(0, 0, 0, 'pinHole', 1), c(0, 1, 0, 'pinHole', 1), c(0, 2, 0, 'pinHole', 1)]), V.tube(3)],
  ];
  for (const [name, p, analytic] of cases) {
    it(`${name}: ${analytic.toFixed(5)}`, () => {
      const v = partVolume(p);
      expect(Math.abs(v - analytic) / analytic).toBeLessThan(0.01);
      expect(meshVolume(buildPartMesh(p))).toBeCloseTo(v, 4);
    });
  }
});

describe('topology (genus)', () => {
  const g = (p: ReturnType<typeof part>) => partSolidStats(p).genus;
  it('single holes have genus 1, males genus 0', () => {
    expect(g(part([c(0, 0, 0, 'pinHole', 0)]))).toBe(1);
    expect(g(part([c(0, 0, 0, 'axleHole', 0)]))).toBe(1);
    expect(g(part([c(0, 0, 0, 'pin', 2)]))).toBe(0);
    expect(g(part([c(0, 0, 0, 'axle', 2)]))).toBe(0);
    expect(g(part([c(0, 0, 0, 'frictionPin', 2)]))).toBe(0);
  });
  it('5-hole liftarm has genus 5', () => expect(g(liftarm(5))).toBe(5));
  it('2×2 block of parallel holes has genus 4 (no pin-prick fifth hole)', () => {
    const p = part([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(0, 1, 0, 'pinHole', 2), c(1, 1, 0, 'pinHole', 2)]);
    expect(g(p)).toBe(4);
    // fully filled square: no gap at the centre column
    const m = buildPartMesh(p);
    const bb = bbox(m);
    expect(bb.min).toEqual([-H, -H, -H].map((v) => expect.closeTo(v, 5)));
  });
  it('double-thick beam (one part, 2 layers) has genus 3 (no slit between layers)', () => {
    const p = part([0, 1, 2].flatMap((i) => [c(i, 0, 0, 'pinHole', 2), c(i, 0, 1, 'pinHole', 2)]));
    expect(g(p)).toBe(3);
  });
  it('perpendicular connector ring↔wall: one through hole + one blind bore → genus 1', () => {
    const p = part([c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'pinHole', 1)]);
    expect(g(p)).toBe(1);
    // blind bore volume: material behind the blind end is kept
    expect(partVolume(p)).toBeGreaterThan(0);
  });
  it('perpendicular connector wall↔wall: two through holes → genus 2', () => {
    expect(g(part([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 1)]))).toBe(2);
  });
  it('tube of coaxial pinHole + axleHole is one through passage → genus 1', () => {
    expect(g(part([c(0, 0, 0, 'axleHole', 0), c(1, 0, 0, 'pinHole', 0)]))).toBe(1);
  });
  it('liftarm with a pin out of its side → genus 3', () => {
    expect(g(part([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(2, 0, 0, 'pinHole', 2), c(1, 1, 0, 'pin', 1)]))).toBe(3);
  });
});

describe('bores and bosses (review findings)', () => {
  it('a hole blind at both ends gets no bore (no sealed cavity)', () => {
    // Z, X, Z row: the X hole is closed by the Z holes' walls on both sides.
    const p = part([c(-1, 0, 0, 'pinHole', 2), c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'pinHole', 2)]);
    const m = buildPartMesh(p);
    const st = manifoldStatus(m);
    expect(st.shells).toBe(1);
    expect(meshShells(m)).toBe(1);
    expect(st.genus).toBe(2);
    expect(partSolidStats(p).genus).toBe(2);
    expect(partSolidStats(p, { fast: false }).genus).toBe(2);
    // the X cell (local x = 1: origin is the min cell) is solid at its centre
    expect(m.origin).toEqual([-1, 0, 0]);
    expect(sectionX(m, 1, 0.2)).toBeCloseTo(0.16, 4);
  });
  it('a coaxial run blind at both ends (Z, X, X, Z) gets no bore', () => {
    const p = part([c(-1, 0, 0, 'pinHole', 2), c(0, 0, 0, 'axleHole', 0), c(1, 0, 0, 'pinHole', 0), c(2, 0, 0, 'pinHole', 2)]);
    const m = buildPartMesh(p);
    expect(manifoldStatus(m).shells).toBe(1);
    expect(meshShells(m)).toBe(1);
    expect(partSolidStats(p).genus).toBe(2);
  });
  it('a hole blind at one end keeps its blind bore', () => {
    const p = part([c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'pinHole', 1)]);
    const m = buildPartMesh(p);
    expect(sectionX(m, 0, 0.2)).toBeLessThan(1e-6); // bore at the centre of the X cell
    expect(sectionX(m, 0.6, 0.2)).toBeCloseTo(0.16, 4); // wall between the face and the Y bore
  });
  it('a pin-hole bore does not counterbore a coaxial axle-hole neighbour', () => {
    for (const cells of [
      [c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'axleHole', 0)],
      [c(1, 0, 0, 'pinHole', 0), c(0, 0, 0, 'axleHole', 0)],
    ]) {
      const m = buildPartMesh(part(cells));
      const ax = cells[1]!.x === 1 ? 1 : 0; // centre of the axle-hole cell
      const edge = ax === 1 ? 0.505 : 0.495; // just inside the axle-hole cell, by the shared face
      const mid = sectionX(m, ax);
      expect(Math.abs(mid - (Math.PI * H * H - crossArea(W_BORE, R_BORE))) / mid).toBeLessThan(0.01);
      expect(sectionX(m, edge)).toBeCloseTo(mid, 6);
      // and the pin-hole cell is the round-bore ring right up to the face
      const pin = 1 - ax;
      const ring = sectionX(m, pin);
      expect(sectionX(m, ax === 1 ? 0.495 : 0.505)).toBeCloseTo(ring, 6);
    }
  });
  it('square bosses of males on adjacent walls meet without a corner notch', () => {
    const p = part([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'axle', 0), c(-1, 0, 0, 'axle', 0), c(0, 1, 0, 'pin', 1), c(0, -1, 0, 'frictionPin', 1)]);
    const m = buildPartMesh(p);
    expect(edgeProblems(m)).toEqual([]);
    expect(manifoldStatus(m).shells).toBe(1);
    // the corner prism [H, ½] × [H, ½] (in x, y) is solid, at every corner, through |z| < H
    // (the hole is at local (1, 1, 0): the origin is the min cell)
    expect(m.origin).toEqual([-1, -1, 0]);
    const d = 0.5 - H - 0.01;
    for (const x of [1 + H + 0.005 + d / 2, 1 - (H + 0.005 + d / 2)])
      for (const sy of [1, -1]) {
        const y0 = 1 + (sy > 0 ? H + 0.005 : -(H + 0.005) - d);
        expect(sectionX(m, x, 0, [y0, -0.3], [y0 + d, 0.3])).toBeCloseTo(d * 0.6, 6);
      }
  });
  it('a hole neighbour next to a boss keeps the natural concave corner (no fill)', () => {
    // liftarm cell (0,0,0) with a hole at +X and a pin at +Y: the region x, y ∈ [H, ½] stays empty
    const p = part([c(0, 0, 0, 'pinHole', 2), c(1, 0, 0, 'pinHole', 2), c(0, 1, 0, 'pin', 1)]);
    const m = buildPartMesh(p);
    expect(sectionX(m, 0.49, 0, [H + 0.005, -0.3], [0.5, 0.3])).toBeLessThan(1e-9);
  });
});

describe('bounding boxes', () => {
  const bb = (p: ReturnType<typeof part>) => bbox(buildPartMesh(p));
  const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 5));
  // Barrel polygons of prism-run cells (built in 2D) have vertices on the transverse axes, so they
  // reach exactly ±H. Barrels built by 3D CSG are rotated half a segment, so transversally they
  // reach H·cos(π/SEGMENTS).
  const HB = H;
  const H3 = H * Math.cos(Math.PI / SEGMENTS);
  it('free hole cell spans ±H', () => {
    for (const kind of ['pinHole', 'axleHole'] as const) {
      const b = bb(part([c(3, -2, 7, kind, 0)]));
      close(b.min, [-H, -HB, -HB]);
      close(b.max, [H, HB, HB]);
    }
  });
  it('free male cell spans ±E_FREE along its axis', () => {
    const b = bb(part([c(0, 0, 0, 'pin', 1)]));
    expect(b.min[1]).toBeCloseTo(-E_FREE, 5);
    expect(b.max[1]).toBeCloseTo(E_FREE, 5);
    expect(b.max[0]).toBeLessThan(0.3);
  });
  it('2-hole stadium: connected sides reach the shared face (fused), free sides ±H', () => {
    const b = bb(liftarm(2));
    close(b.min, [-HB, -H, -H]);
    close(b.max, [1 + HB, H, H]);
  });
  it('tube: barrels bridge the shared face', () => {
    const b = bb(part([c(0, 0, 0, 'pinHole', 0), c(1, 0, 0, 'pinHole', 0)]));
    close(b.min, [-H, -HB, -HB]);
    close(b.max, [1 + H, HB, HB]);
    // mixed-kind tube takes the 3D path (barrel polygon rotated half a segment)
    const m = bb(part([c(0, 0, 0, 'axleHole', 0), c(1, 0, 0, 'pinHole', 0)]));
    close(m.min, [-H, -H3, -H3]);
    close(m.max, [1 + H, H3, H3]);
  });
  it('hole + perpendicular pin: boss reaches the shared face, rod free end at E_FREE', () => {
    const p = part([c(0, 0, 0, 'pinHole', 2), c(0, 1, 0, 'pin', 1)]);
    const m = buildPartMesh(p);
    const b = bbox(m);
    expect(b.max[1]).toBeCloseTo(1 + E_FREE, 5);
    // some vertex lies on the boss face y = ½+EPS, outside the barrel radius (the square boss)
    let found = false;
    for (let i = 0; i < m.positions.length; i += 3)
      if (Math.abs(m.positions[i + 1]! - E_CONN) < 1e-5 && Math.abs(m.positions[i]!) > 0.4) found = true;
    expect(found).toBe(true);
  });
  it('2-long pin: one rod from −E_FREE to 1+E_FREE', () => {
    const b = bb(part([c(0, 0, 0, 'pin', 2), c(0, 0, 1, 'pin', 2)]));
    expect(b.min[2]).toBeCloseTo(-E_FREE, 5);
    expect(b.max[2]).toBeCloseTo(1 + E_FREE, 5);
  });
  it('mesh is in the part-local frame (origin = min corner)', () => {
    const p = part([c(5, 6, 7, 'pinHole', 2), c(6, 6, 7, 'pinHole', 2)]);
    const m = buildPartMesh(p);
    expect(m.origin).toEqual([5, 6, 7]);
    expect(bbox(m).min[0]).toBeCloseTo(-HB, 5);
    expect(bbox(m).min[1]).toBeCloseTo(-H, 5);
  });
});

describe('normals', () => {
  it('flat ring faces of a pin hole have exact axial normals; barrel normals are radial', () => {
    const m = buildPartMesh(part([c(0, 0, 0, 'pinHole', 2)]));
    for (let i = 0; i < m.positions.length; i += 3) {
      const [x, y, z] = [m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!];
      const [nx, ny, nz] = [m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!];
      expect(Math.abs(Math.abs(z) - H) < 1e-6).toBe(true); // all verts lie on the two ring faces
      const r = Math.hypot(x, y);
      if (Math.abs(nz) > 0.5) {
        expect(Math.abs(nz)).toBeCloseTo(1, 6); // ring face: crisp crease
      } else {
        // barrel (outward) or bore (inward): radial, smooth
        const sign = r > 0.4 ? 1 : -1;
        expect((nx * x + ny * y) / r * sign).toBeGreaterThan(0.995);
      }
    }
  });
  it('creases split vertices: a single hole has 4 rings × 2 faces of vertices', () => {
    const m = buildPartMesh(part([c(0, 0, 0, 'pinHole', 2)]));
    // 48 verts per circle, 4 circles, each shared by a flat face and a curved face → 2 copies
    expect(m.positions.length / 3).toBe(48 * 4 * 2);
  });
});

describe('cache', () => {
  it('translated copies of a part share the identical mesh (cache hit)', () => {
    clearMeshCache();
    const a = liftarm(5, 'pinHole', [0, 0, 0]);
    const b = { ...liftarm(5, 'pinHole', [10, -3, 4]), id: 7, color: '#123456' };
    b.cells.reverse(); // cell order does not matter
    const ma = buildPartMesh(a);
    const mb = buildPartMesh(b);
    expect(mb.positions).toBe(ma.positions);
    expect(mb.normals).toBe(ma.normals);
    expect(mb.indices).toBe(ma.indices);
    expect(ma.origin).toEqual([0, 0, 0]);
    expect(mb.origin).toEqual([10, -3, 4]);
    expect(meshCacheStats()).toMatchObject({ size: 1, hits: 1, misses: 1 });
  });
  it('different parts do not collide in the cache', () => {
    clearMeshCache();
    const a = buildPartMesh(part([c(0, 0, 0, 'pinHole', 2)]));
    const b = buildPartMesh(part([c(0, 0, 0, 'pinHole', 0)]));
    expect(a.positions).not.toBe(b.positions);
    expect(meshCacheStats().size).toBe(2);
  });
});

describe('resources', () => {
  it('builds 2000 distinct parts with no leaked Manifold objects', { timeout: 120000 }, () => {
    clearMeshCache();
    const kinds = ['pinHole', 'axleHole', 'axle', 'pin', 'frictionPin'] as const;
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) {
      clearMeshCache();
      const n = 1 + (i % 5);
      const kind = kinds[i % 5]!;
      const cells = kind === 'pinHole' || kind === 'axleHole'
        ? Array.from({ length: n }, (_, k) => c(k, 0, 0, kind, ((i >> 2) % 2 ? 2 : 1) as 1 | 2))
        : Array.from({ length: n }, (_, k) => c(k, 0, 0, kind, 0));
      buildPartMesh(part(cells));
      expect(liveManifoldCount()).toBe(0);
    }
    const ms = (performance.now() - t0) / 2000;
    console.log(`geometry: ${ms.toFixed(2)} ms per part (mixed 1–5 cell parts, uncached)`);
    expect(liveManifoldCount()).toBe(0);
  });
  it('frees everything when CSG is used for stats/volume too', () => {
    partVolume(liftarm(3));
    partSolidStats(liftarm(3));
    expect(liveManifoldCount()).toBe(0);
  });
  it('reports triangle counts and build time of a 5-hole liftarm', () => {
    clearMeshCache();
    const t0 = performance.now();
    const m = buildPartMesh(liftarm(5));
    const ms = performance.now() - t0;
    const raw = partSolidStats(liftarm(5));
    console.log(
      `geometry: 5-hole liftarm ${m.indices.length / 3} triangles, ${m.positions.length / 3} vertices ` +
        `(raw ${raw.numTri} tri / ${raw.numVert} vert), ${ms.toFixed(1)} ms`,
    );
    expect(m.indices.length / 3).toBe(raw.numTri);
  });
  it('EPS sanity', () => expect(EPS).toBeLessThan(0.01));
});
