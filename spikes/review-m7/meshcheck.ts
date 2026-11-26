// Independent checks of a wheel part's render solid (reviewer "verify-sim", item 3).
import { discOverlapsCell } from '../../src/core/disc';
import type { Axis, Cell } from '../../src/core/types';
import { buildPartMesh } from '../../src/geometry';
import type { MeshData } from '../../src/geometry';
import { edgeProblems, meshShells, meshVolume } from '../../tests/geometry/helpers';

const H = 0.47;
const isMaleK = (k: string) => k === 'pin' || k === 'axle' || k === 'frictionPin';
const isHoleK = (k: string) => k === 'pinHole' || k === 'axleHole';

/** Möller–Trumbore ray parity: is world point q inside the closed mesh? */
export function inside(mesh: MeshData, q: number[]): boolean {
  const P = mesh.positions;
  const I = mesh.indices;
  const o = mesh.origin;
  const d = [0.9998, 0.0131, 0.0173];
  const p = [q[0]! - o[0], q[1]! - o[1], q[2]! - o[2]];
  let hits = 0;
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t]!, b = 3 * I[t + 1]!, c = 3 * I[t + 2]!;
    const e1 = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!];
    const e2 = [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!];
    const h = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
    const det = e1[0]! * h[0]! + e1[1]! * h[1]! + e1[2]! * h[2]!;
    if (Math.abs(det) < 1e-12) continue;
    const s = [p[0]! - P[a]!, p[1]! - P[a + 1]!, p[2]! - P[a + 2]!];
    const u = (s[0]! * h[0]! + s[1]! * h[1]! + s[2]! * h[2]!) / det;
    if (u < 0 || u > 1) continue;
    const qq = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
    const v = (d[0]! * qq[0]! + d[1]! * qq[1]! + d[2]! * qq[2]!) / det;
    if (v < 0 || u + v > 1) continue;
    const tt = (e2[0]! * qq[0]! + e2[1]! * qq[1]! + e2[2]! * qq[2]!) / det;
    if (tt > 0) hits++;
  }
  return hits % 2 === 1;
}

const rimOnlyVol = new Map<string, number>();
function rimOnly(c: Cell): number {
  const k = `${c.kind},${c.rim},${c.axis}`;
  let v = rimOnlyVol.get(k);
  if (v === undefined) {
    v = meshVolume(buildPartMesh({ id: 1, color: '#888888', cells: [{ ...c, x: 0, y: 0, z: 0 }] }));
    rimOnlyVol.set(k, v);
  }
  return v;
}
const cellVol = new Map<string, number>();
function lone(c: Cell): number {
  const k = `${c.kind},${c.axis}`;
  let v = cellVol.get(k);
  if (v === undefined) {
    v = meshVolume(buildPartMesh({ id: 1, color: '#888888', cells: [{ x: 0, y: 0, z: 0, kind: c.kind, axis: c.axis }] }));
    cellVol.set(k, v);
  }
  return v;
}

export interface MeshCheck {
  problems: string[];
  shells: number;
  volume: number;
  tris: number;
}

export function checkMesh(cells: Cell[], sample = true): MeshCheck {
  const mesh = buildPartMesh({ id: 1, color: '#888888', cells });
  const problems: string[] = [];
  const shells = meshShells(mesh);
  if (shells !== 1) problems.push(`${shells} shells`);
  const ep = edgeProblems(mesh);
  if (ep.length) problems.push(`not closed manifold (${ep[0]})`);
  const vol = meshVolume(mesh);
  const hubs = cells.filter((c) => c.rim !== undefined);
  const others = cells.filter((c) => c.rim === undefined);
  const lo = Math.max(...hubs.map(rimOnly)) - others.length * Math.PI * 0.31 * 0.31 * 1.01 - 0.02;
  const hi = hubs.reduce((s, c) => s + rimOnly(c), 0) + others.reduce((s, c) => s + lone(c) + 0.6, 0);
  if (!(vol >= lo && vol <= hi)) problems.push(`volume ${vol.toFixed(3)} outside [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
  const own = new Set(cells.map((c) => `${c.x},${c.y},${c.z}`));
  const ownedByDisc = (p: [number, number, number]) => hubs.some((w) => discOverlapsCell([w.x, w.y, w.z], w.axis, w.rim!, p));
  const isRodVertex = (q: number[]) =>
    cells.some((c) => {
      if (!isMaleK(c.kind)) return false;
      const a = c.axis;
      const rel = [q[0]! - c.x, q[1]! - c.y, q[2]! - c.z];
      let r2 = 0;
      for (let j = 0; j < 3; j++) if (j !== a) r2 += rel[j]! ** 2;
      return r2 <= 0.34 * 0.34 && Math.abs(rel[a]!) <= 0.5 + 0.01;
    });
  const P = mesh.positions;
  const o = mesh.origin;
  let outside = 0;
  let worstOut = 0;
  let gap = 0;
  let worstGap = Infinity;
  let gapAt = '';
  for (let i = 0; i < P.length; i += 3) {
    const q = [P[i]! + o[0], P[i + 1]! + o[1], P[i + 2]! + o[2]];
    // allowed: own cell's cube (±0.5 + EPS) or inside a drawn rim
    const inOwn = cells.some((c) => Math.abs(q[0]! - c.x) <= 0.506 && Math.abs(q[1]! - c.y) <= 0.506 && Math.abs(q[2]! - c.z) <= 0.506);
    let inRim = false;
    for (const w of hubs) {
      const a = w.axis;
      const rel = [q[0]! - w.x, q[1]! - w.y, q[2]! - w.z];
      let r2 = 0;
      for (let j = 0; j < 3; j++) if (j !== a) r2 += rel[j]! ** 2;
      if (Math.abs(rel[a]!) <= H + 1e-3 && Math.sqrt(r2) <= w.rim! - 0.03 + 1e-3) inRim = true;
    }
    if (!inOwn && !inRim) {
      outside++;
      let best = Infinity;
      for (const w of hubs) {
        const a = w.axis;
        const rel = [q[0]! - w.x, q[1]! - w.y, q[2]! - w.z];
        let r2 = 0;
        for (let j = 0; j < 3; j++) if (j !== a) r2 += rel[j]! ** 2;
        best = Math.min(best, Math.sqrt(r2) - (w.rim! - 0.03));
      }
      worstOut = Math.max(worstOut, best);
    }
    if (isRodVertex(q)) continue;
    const base = q.map(Math.round);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const p: [number, number, number] = [base[0]! + dx, base[1]! + dy, base[2]! + dz];
          if (own.has(p.join(',')) || ownedByDisc(p)) continue;
          let d2 = 0;
          for (let j = 0; j < 3; j++) d2 += Math.max(0, Math.abs(q[j]! - p[j]!) - H) ** 2;
          const dd = Math.sqrt(d2);
          if (dd < worstGap) {
            worstGap = dd;
            gapAt = `${q.map((x) => x.toFixed(3))} vs free cell ${p}`;
          }
          if (dd < 0.06 - 2e-3) gap++;
        }
  }
  if (outside) problems.push(`${outside} vertices outside own cells and drawn rims (worst ${worstOut.toFixed(3)} beyond a rim)`);
  if (gap) problems.push(`${gap} vertex-cell pairs inside a free neighbour's 0.06 gap (closest ${worstGap.toFixed(4)} at ${gapAt})`);
  // bores open: points on each hole cell's axis
  for (const c of cells) {
    if (!isHoleK(c.kind)) continue;
    const parallel = hubs.some((w) => w.axis === c.axis);
    let blocked = 0;
    for (const t of [-0.4, -0.2, 0, 0.2, 0.4]) {
      const q: [number, number, number] = [c.x, c.y, c.z];
      q[c.axis] += t;
      if (inside(mesh, q)) blocked++;
    }
    if (blocked) problems.push(`${parallel ? '' : 'perp-'}bore of (${c.x},${c.y},${c.z}) blocked at ${blocked}/5 axis points`);
  }
  // Dense mid-plane sampling around every non-hub cell (catches straight web edges with no vertex
  // in between): solid points outside the nominal discs and own cubes, and inside a free cell's gap.
  if (sample) {
    let outN = 0;
    let outWorst = 0;
    let gapN = 0;
    let gapWorst = Infinity;
    const seen = new Set<string>();
    for (const w of hubs) {
      const a = w.axis;
      const u = ((a + 1) % 3) as Axis;
      const v = ((a + 2) % 3) as Axis;
      for (const c of others) {
        if (c[(['x', 'y', 'z'] as const)[a]] !== w[(['x', 'y', 'z'] as const)[a]]) continue;
        const cc = [c.x, c.y, c.z];
        for (let i = -60; i <= 60; i++)
          for (let j = -60; j <= 60; j++) {
            const q = [...cc] as [number, number, number];
            q[u] += i * 0.02;
            q[v] += j * 0.02;
            const key = q.map((x) => x.toFixed(3)).join(',');
            if (seen.has(key)) continue;
            seen.add(key);
            const inOwn = cells.some((k) => Math.abs(q[0]! - k.x) <= 0.506 && Math.abs(q[1]! - k.y) <= 0.506 && Math.abs(q[2]! - k.z) <= 0.506);
            const rad = Math.min(...hubs.map((h) => { const rel = [q[0]! - h.x, q[1]! - h.y, q[2]! - h.z]; let r2 = 0; for (let t = 0; t < 3; t++) if (t !== h.axis) r2 += rel[t]! ** 2; return Math.abs(rel[h.axis]!) <= 0.5 ? Math.sqrt(r2) - h.rim! : Infinity; }));
            let gapHere = Infinity;
            const base = q.map(Math.round);
            for (let dx = -1; dx <= 1; dx++)
              for (let dy = -1; dy <= 1; dy++)
                for (let dz = -1; dz <= 1; dz++) {
                  const p: [number, number, number] = [base[0]! + dx, base[1]! + dy, base[2]! + dz];
                  if (own.has(p.join(',')) || ownedByDisc(p)) continue;
                  let d2 = 0;
                  for (let t = 0; t < 3; t++) d2 += Math.max(0, Math.abs(q[t]! - p[t]!) - H) ** 2;
                  gapHere = Math.min(gapHere, Math.sqrt(d2));
                }
            const nearOut = !inOwn && rad > 0;
            const nearGap = gapHere < 0.06 - 2e-3 && !isRodVertex(q);
            if (!nearOut && !nearGap) continue;
            if (!inside(mesh, q)) continue;
            if (nearOut) { outN++; outWorst = Math.max(outWorst, rad); }
            if (nearGap) { gapN++; gapWorst = Math.min(gapWorst, gapHere); }
          }
      }
    }
    if (outN) problems.push(`web: ${outN} mid-plane samples (0.02 grid) of solid outside the nominal disc and own cubes, up to ${outWorst.toFixed(3)} beyond r`);
    if (gapN) problems.push(`web: ${gapN} mid-plane samples inside a free cell's 0.06 gap (closest ${gapWorst.toFixed(3)})`);
  }
  return { problems, shells, volume: vol, tris: mesh.indices.length / 3 };
}

export type { Axis };
