import { DIRS, KINDS, addCell, addPart, canAddCell, emptyModel, makeCell, partById } from '../../src/core';
import type { Axis, Cell, Kind, Part } from '../../src/core';
import { CHAMFER, E_FREE, H, R_BORE, R_ROD, W_BORE, W_ROD } from '../../src/geometry';
import type { MeshData } from '../../src/geometry';

export function part(cells: Cell[], id = 1): Part {
  return { id, color: '#888888', cells };
}
export function c(x: number, y: number, z: number, kind: Kind, axis: Axis): Cell {
  return makeCell(x, y, z, kind, axis);
}
/** Row of n holes of `kind` along X, axis Z. */
export function liftarm(n: number, kind: Kind = 'pinHole', at: [number, number, number] = [0, 0, 0]): Part {
  return part(Array.from({ length: n }, (_, i) => c(at[0] + i, at[1], at[2], kind, 2)));
}

// ---- analytic values ----
/** Area of (box ±w × ±r ∪ rotated) ∩ circle r. */
export function crossArea(w: number, r: number): number {
  const a1 = 2 * (w * Math.sqrt(r * r - w * w) + r * r * Math.asin(w / r));
  return 2 * a1 - 4 * w * w;
}
export const V = {
  pinHole: 2 * H * Math.PI * (H * H - R_BORE * R_BORE),
  axleHole: 2 * H * (Math.PI * H * H - crossArea(W_BORE, R_BORE)),
  axle: crossArea(W_ROD, R_ROD) * 2 * E_FREE,
  pin:
    Math.PI * R_ROD * R_ROD * (2 * E_FREE - 2 * CHAMFER) +
    2 * ((Math.PI * CHAMFER) / 3) * (R_ROD ** 2 + R_ROD * (R_ROD - CHAMFER) + (R_ROD - CHAMFER) ** 2),
  stadium: (n: number) => 2 * H * (Math.PI * H * H + 2 * H * (n - 1)) - n * Math.PI * R_BORE ** 2 * 2 * H,
  tube: (n: number) => Math.PI * (H * H - R_BORE ** 2) * (n - 1 + 2 * H),
};

// ---- mesh checks ----
/** Weld vertices by exact position (the creased mesh splits them at creases). */
export function weld(m: MeshData): { pos: number[][]; tri: number[] } {
  const ids = new Map<string, number>();
  const pos: number[][] = [];
  const remap: number[] = [];
  for (let i = 0; i < m.positions.length / 3; i++) {
    const p = [m.positions[3 * i]!, m.positions[3 * i + 1]!, m.positions[3 * i + 2]!];
    const k = p.join(',');
    let id = ids.get(k);
    if (id === undefined) {
      id = pos.length;
      ids.set(k, id);
      pos.push(p);
    }
    remap.push(id);
  }
  return { pos, tri: Array.from(m.indices, (i) => remap[i]!) };
}

/** Every directed edge appears exactly once and its reverse exactly once (closed, oriented 2-manifold). */
export function edgeProblems(m: MeshData): string[] {
  const { tri } = weld(m);
  const count = new Map<string, number>();
  for (let t = 0; t < tri.length / 3; t++)
    for (let k = 0; k < 3; k++) {
      const a = tri[3 * t + k]!, b = tri[3 * t + ((k + 1) % 3)]!;
      if (a === b) return [`degenerate index triangle ${t}`];
      const key = `${a}>${b}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    }
  const bad: string[] = [];
  for (const [key, n] of count) {
    const [a, b] = key.split('>');
    if (n !== 1) bad.push(`edge ${key} used ${n}×`);
    if (count.get(`${b}>${a}`) !== 1) bad.push(`edge ${key} has no unique twin`);
    if (bad.length > 5) break;
  }
  return bad;
}

/**
 * Number of connected shells of the welded mesh (triangles joined through shared vertices). An
 * internal sealed cavity is a second shell; Euler genus (below) and manifold's genus() both assume
 * one shell, so check this alongside them.
 */
export function meshShells(m: MeshData): number {
  const { pos, tri } = weld(m);
  const parent = Array.from({ length: pos.length }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]!]!;
    return i;
  };
  for (let t = 0; t < tri.length; t += 3) {
    const a = find(tri[t]!);
    for (let k = 1; k < 3; k++) {
      const b = find(tri[t + k]!);
      if (a !== b) parent[b] = a;
    }
  }
  const used = new Set<number>();
  for (const i of tri) used.add(find(i));
  return used.size;
}

/** Euler genus from the welded mesh: V − E + F = 2 − 2g (single shell). */
export function meshGenus(m: MeshData): number {
  const { pos, tri } = weld(m);
  const F = tri.length / 3;
  const E = (F * 3) / 2;
  return (2 - (pos.length - E + F)) / 2;
}

export function meshVolume(m: MeshData): number {
  const p = m.positions;
  let v = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = 3 * m.indices[t]!, b = 3 * m.indices[t + 1]!, cc = 3 * m.indices[t + 2]!;
    v +=
      p[a]! * (p[b + 1]! * p[cc + 2]! - p[b + 2]! * p[cc + 1]!) -
      p[a + 1]! * (p[b]! * p[cc + 2]! - p[b + 2]! * p[cc]!) +
      p[a + 2]! * (p[b]! * p[cc + 1]! - p[b + 1]! * p[cc]!);
  }
  return v / 6;
}

/** Is the world point q inside the closed mesh? Ray parity along a skew direction (Möller–Trumbore). */
export function insideMesh(m: MeshData, q: readonly number[]): boolean {
  const P = m.positions;
  const I = m.indices;
  const d = [0.9998, 0.0131, 0.0173];
  const p = [q[0]! - m.origin[0], q[1]! - m.origin[1], q[2]! - m.origin[2]];
  let hits = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t]!, b = 3 * I[t + 1]!, c = 3 * I[t + 2]!;
    const e1x = P[b]! - P[a]!, e1y = P[b + 1]! - P[a + 1]!, e1z = P[b + 2]! - P[a + 2]!;
    const e2x = P[c]! - P[a]!, e2y = P[c + 1]! - P[a + 1]!, e2z = P[c + 2]! - P[a + 2]!;
    const hx = d[1]! * e2z - d[2]! * e2y, hy = d[2]! * e2x - d[0]! * e2z, hz = d[0]! * e2y - d[1]! * e2x;
    const det = e1x * hx + e1y * hy + e1z * hz;
    if (Math.abs(det) < 1e-12) continue;
    const sx = p[0]! - P[a]!, sy = p[1]! - P[a + 1]!, sz = p[2]! - P[a + 2]!;
    const u = (sx * hx + sy * hy + sz * hz) / det;
    if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (d[0]! * qx + d[1]! * qy + d[2]! * qz) / det;
    if (v < 0 || u + v > 1) continue;
    if ((e2x * qx + e2y * qy + e2z * qz) / det > 0) hits++;
  }
  return hits % 2 === 1;
}

export function bbox(m: MeshData): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i++) {
    const k = i % 3;
    min[k] = Math.min(min[k]!, m.positions[i]!);
    max[k] = Math.max(max[k]!, m.positions[i]!);
  }
  return { min, max };
}

// ---- random valid parts ----
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

/** A random valid part grown cell by cell with the core API (holes weighted 3:1). */
export function randomPart(seed: number, size: number): Part {
  const r = rng(seed);
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!;
  const kinds = [...KINDS, 'pinHole', 'pinHole', 'axleHole'] as const;
  let { model, partId } = addPart(emptyModel(), [makeCell(0, 0, 0, pick(kinds), pick([0, 1, 2] as Axis[]))]);
  for (let tries = 0; tries < size * 20 && partById(model, partId)!.cells.length < size; tries++) {
    const from = pick(partById(model, partId)!.cells);
    const d = pick(DIRS);
    const cell = makeCell(from.x + d[0], from.y + d[1], from.z + d[2], pick(kinds), pick([0, 1, 2] as Axis[]));
    if (canAddCell(model, partId, cell).ok) model = addCell(model, partId, cell);
  }
  return partById(model, partId)!;
}
