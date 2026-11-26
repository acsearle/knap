// Stand-in for src/geometry as imported by src/view (aliased in vite.gearlook.config.mjs): everything
// is the real module except buildPartMesh / partSignature, which return a gearlook gear mesh for
// parts registered in globalThis.__gearSpecs (partId → spec). src/ is not modified.
import type { Part } from '../../src/core';
import * as real from '../../src/geometry/index';
import type { MeshData } from '../../src/geometry/index';
import type { ManifoldToplevel } from 'manifold-3d';
import { buildGear, groupPatches, type GearSpec } from './gear';

export * from '../../src/geometry/index';

export interface GearEntry extends GearSpec {
  /** drawing treatment: 'all' = repo creases (ink every tooth edge), 'band' = tooth band one patch, 'flat' = band+faces one patch */
  treat?: 'all' | 'band' | 'flat';
}
type G = { __gearSpecs?: Map<number, GearEntry>; __gearW?: ManifoldToplevel; __gearMarks?: Map<string, Float32Array>; __gearStats?: Record<string, unknown>[] };
const g = globalThis as unknown as G;
const cache = new Map<string, MeshData & { mark: Float32Array }>();

function hub(part: Part) {
  return part.cells[0]!;
}

export function partSignature(part: Part): string {
  const s = g.__gearSpecs?.get(part.id);
  if (!s) return real.partSignature(part);
  return 'gear:' + JSON.stringify(s) + '|' + real.partSignature(part);
}

export function buildPartMesh(part: Part): MeshData {
  const s = g.__gearSpecs?.get(part.id);
  if (!s) return real.buildPartMesh(part);
  const key = partSignature(part);
  const origin = real.partOrigin(part);
  let m = cache.get(key);
  if (!m) {
    const gm = buildGear(g.__gearW!, s);
    const idx = s.treat && s.treat !== 'all' ? groupPatches(gm, s.treat === 'band' ? 'band' : 'all', s) : gm.indices;
    const c = hub(part);
    const o = [c.x - origin[0], c.y - origin[1], c.z - origin[2]];
    const n = gm.positions.length / 3;
    const P = new Float32Array(n * 3), Nn = new Float32Array(n * 3);
    // gear frame (x, y, z=axis) → world axis frame: X: (z,x,y)  Y: (y,z,x)  Z: (x,y,z)
    const map = (x: number, y: number, z: number): [number, number, number] => (c.axis === 0 ? [z, x, y] : c.axis === 1 ? [y, z, x] : [x, y, z]);
    for (let i = 0; i < n; i++) {
      const p = map(gm.positions[3 * i]!, gm.positions[3 * i + 1]!, gm.positions[3 * i + 2]!);
      const q = map(gm.normals[3 * i]!, gm.normals[3 * i + 1]!, gm.normals[3 * i + 2]!);
      P[3 * i] = p[0] + o[0]!; P[3 * i + 1] = p[1] + o[1]!; P[3 * i + 2] = p[2] + o[2]!;
      Nn[3 * i] = q[0]; Nn[3 * i + 1] = q[1]; Nn[3 * i + 2] = q[2];
    }
    m = { positions: P, normals: Nn, indices: idx, origin, mark: gm.mark };
    cache.set(key, m);
    (g.__gearMarks ??= new Map()).set(key, gm.mark);
    (g.__gearStats ??= []).push({ part: part.id, N: gm.info.N, tri: gm.triangles, ms: Math.round(gm.ms * 10) / 10, closed: gm.manifoldOK });
  }
  return { positions: m.positions, normals: m.normals, indices: m.indices, origin };
}
