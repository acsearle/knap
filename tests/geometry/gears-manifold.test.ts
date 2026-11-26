// Review m8 (simgeo): valid parts with two gears gave render meshes with pinched, non-manifold bore
// edges where a web cell's barrel touched a gear's slab face exactly (DESIGN §4.2: the mesh MUST be
// a closed manifold). Fixed in solid.ts barrelRunGear (the barrel stops EPS short of the face and a
// plug inside the root circle joins it). These pin the reported cases, the ones a 1000-part sweep
// found before the fix, and a seeded random sweep.
import { beforeAll, describe, expect, it } from 'vitest';
import { GEAR_RADII, addCell, addPart, canAddCell, canSetGear, emptyModel, isHole, makeCell, partById, setGear, validateModel } from '../../src/core';
import type { Axis, Cell, Kind, Model, Part } from '../../src/core';
import { buildPartMesh, initGeometry } from '../../src/geometry';
import { edgeProblems, meshShells } from './helpers';

beforeAll(async () => {
  await initGeometry();
});

const C = (x: number, y: number, z: number, kind: Kind, axis: Axis, rim?: number, teeth?: boolean) => makeCell(x, y, z, kind, axis, rim, teeth);

const CASES: [string, Cell[]][] = [
  ['review case 1', [C(0, 0, 0, 'pinHole', 1, 1.5, true), C(1, 0, 0, 'axleHole', 1), C(1, -1, 0, 'axleHole', 1, 1, true), C(1, -2, 0, 'pinHole', 0)]],
  ['review case 2', [C(0, 0, 0, 'pinHole', 0, 1.5, true), C(0, 1, 0, 'pin', 0), C(1, 0, 0, 'pinHole', 0), C(1, 0, -1, 'axleHole', 0, 1.5, true), C(-1, 1, 0, 'pinHole', 2)]],
  ['sweep 183', [C(0, 0, 0, 'pinHole', 0, 1.5, true), C(0, 0, -1, 'axleHole', 0), C(-1, 0, -1, 'pinHole', 0, 1.5, true), C(-1, 0, -2, 'axleHole', 0), C(0, 0, 1, 'pin', 0), C(-2, 0, -2, 'pinHole', 1), C(-2, 0, -1, 'pin', 2), C(-1, -1, -1, 'pin', 0)]],
  ['sweep 195', [C(0, 0, 0, 'pinHole', 0, 1.5, true), C(1, 0, 0, 'pinHole', 0), C(1, -1, 0, 'pinHole', 0, 2.5, true), C(0, 1, 0, 'axle', 0), C(1, 1, 0, 'pin', 0), C(1, -3, 0, 'pin', 0), C(-1, 0, 0, 'pinHole', 1), C(2, 0, 0, 'pinHole', 0)]],
  ['sweep 495', [C(0, 0, 0, 'pinHole', 1, 1.5, true), C(0, 1, 0, 'pinHole', 1, 2.5, true), C(1, 0, 0, 'axleHole', 1), C(0, -1, 0, 'pinHole', 1, 1, true), C(-1, 0, 0, 'pinHole', 1), C(0, -2, 0, 'pinHole', 2), C(-1, 1, 0, 'pinHole', 1)]],
  ['sweep 605', [C(0, 0, 0, 'pinHole', 2, 1.5, true), C(-1, 0, 0, 'pinHole', 2), C(-1, 0, -1, 'pinHole', 2, 1.5, true), C(-1, 0, -2, 'axleHole', 1), C(-1, -1, -1, 'pin', 2), C(-1, 1, -2, 'axleHole', 0), C(-1, -1, -2, 'pinHole', 0), C(1, 0, 0, 'pin', 2), C(0, -1, 0, 'pin', 2)]],
  ['sweep 611', [C(0, 0, 0, 'pinHole', 1, 2.5, true), C(0, 1, 0, 'pinHole', 1), C(0, 1, 1, 'pinHole', 1), C(-1, 1, 0, 'axleHole', 1, 2.5, true), C(0, 0, -1, 'pinHole', 1), C(1, 0, 0, 'pinHole', 1), C(0, 1, -1, 'pin', 1), C(1, -1, 0, 'axleHole', 0)]],
  ['sweep 1127', [C(0, 0, 0, 'pinHole', 1, 2.5, true), C(1, 0, 0, 'pinHole', 1), C(0, 0, 1, 'pinHole', 1), C(0, -1, 1, 'pinHole', 1, 1.5, true), C(0, -2, 1, 'pinHole', 2), C(0, 0, 2, 'pinHole', 1), C(0, 1, 0, 'pinHole', 2), C(-1, 0, 0, 'pinHole', 1)]],
];

describe('gear parts with a web cell next to another gear in its run are closed manifolds', () => {
  for (const [label, cells] of CASES)
    it(label, () => {
      const m: Model = { version: 3, parts: [{ id: 1, color: '#888888', cells }], rootPartId: 1, nextPartId: 2 };
      expect(validateModel(m)).toEqual([]);
      const mesh = buildPartMesh(m.parts[0]!);
      expect(edgeProblems(mesh)).toEqual([]);
      expect(meshShells(mesh)).toBe(1);
    });
});

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random valid one-part model with at least one gear (the review sweep's generator). */
function randomGearPart(seed: number): Part | null {
  const r = rng(seed * 7 + 3);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const kinds: Kind[] = ['pinHole', 'pinHole', 'axleHole', 'pin', 'axle', 'frictionPin'];
  let { model, partId } = addPart(emptyModel(), [makeCell(0, 0, 0, pick(['pinHole', 'axleHole'] as Kind[]), pick([0, 1, 2] as Axis[]))]);
  const D: [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const size = 2 + Math.floor(r() * 8);
  for (let t = 0; t < 200 && partById(model, partId)!.cells.length < size; t++) {
    const p = partById(model, partId)!;
    if (r() < 0.35) {
      const c = pick(p.cells);
      if (isHole(c.kind)) {
        const g = pick(GEAR_RADII);
        if (canSetGear(model, partId, [c.x, c.y, c.z], g).ok) model = setGear(model, partId, [c.x, c.y, c.z], g);
      }
      continue;
    }
    const from = pick(p.cells);
    const d = pick(D);
    const k = r() < 0.15 ? 2 : 1;
    const cell = makeCell(from.x + d[0] * k, from.y + d[1] * k, from.z + d[2] * k, pick(kinds), pick([0, 1, 2] as Axis[]));
    if (canAddCell(model, partId, cell).ok) model = addCell(model, partId, cell);
  }
  const p = partById(model, partId)!;
  return p.cells.some((c) => c.teeth) ? p : null;
}

it('300 random gear parts (seeded): every render mesh is a closed one-shell manifold', { timeout: 120000 }, () => {
  let n = 0;
  let twoGears = 0;
  const bad: string[] = [];
  for (let seed = 1; n < 300; seed++) {
    const p = randomGearPart(seed);
    if (!p) continue;
    n++;
    if (p.cells.filter((c) => c.teeth).length > 1) twoGears++;
    const mesh = buildPartMesh(p);
    const ep = edgeProblems(mesh);
    const shells = meshShells(mesh);
    if (ep.length || shells !== 1) bad.push(`seed ${seed}: ${ep.length} edge problems, ${shells} shells ${JSON.stringify(p.cells)}`);
  }
  expect(bad).toEqual([]);
  expect(twoGears).toBeGreaterThan(30);
});
