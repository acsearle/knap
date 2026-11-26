// Gear solids for the gearlook spike: 2-D tooth profiles + manifold-3d extrusion, the way
// src/geometry/solid.ts builds rims (profile → extrude ±H → chamfer by a revolved cutter → bores).
// Pure of DOM/three; takes a manifold toplevel so it runs in vitest (Node) and in the browser.
import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import { creasedMesh } from '../../src/geometry/solid';

export type ToothKind = 'involute' | 'trapezoid' | 'sine';

export interface GearSpec {
  /** pitch radius (units); N = 16·r */
  r: number;
  kind: ToothKind;
  /** pressure angle (radians) for involute / trapezoid flank inclination */
  alpha?: number;
  /** addendum above the pitch circle (drawn) */
  ha?: number;
  /** dedendum below the pitch circle */
  hf?: number;
  /** total backlash per meshed pair at the pitch circle (units); each tooth is thinned by B/2 */
  backlash?: number;
  /** points per involute/trapezoid flank (≥ 2) */
  flankPts?: number;
  /** points across the tip land and root land */
  tipPts?: number;
  rootPts?: number;
  /** 45° chamfer on the tip edges (radial = axial size), 0 = none */
  chamfer?: number;
  /** tooth band half-thickness (default H = 0.47); the hub web keeps ±H */
  bandH?: number;
  /** hub/web radius when bandH < H (default root − 0.06) */
  webR?: number;
  bore?: 'pin' | 'axle' | 'none';
  /** extra pin-hole bores (crank holes) at these in-plane offsets */
  crankHoles?: [number, number][];
  /** index mark: radial groove on both faces from MARK_R0 to markR1 at angle 0 (+u) */
  mark?: boolean;
  /** paint one tooth (the one at the phase angle) in the mark colour, flanks + tip land */
  markTooth?: boolean;
  /** draw only this many teeth (dishonest option); default N */
  drawTeeth?: number;
  /** rotation of the tooth pattern (radians, CCW about +Z) */
  phase?: number;
  /** involute flank below the base circle: 'radial' (constant angle) or 'parallel' (constant linear half-width) */
  underBase?: 'radial' | 'parallel';
  /** sine profile exponent (1 = pure sinusoid; >1 sharpens gaps) */
  sinePow?: number;
}

export const H = 0.47;
export const M = 0.125; // module (units)
export const PITCH = Math.PI * M; // π/8
export const R_BORE = 0.31;
export const W_BORE = 0.125;

export function teethOf(s: GearSpec): number {
  return Math.round(16 * s.r);
}

function inv(a: number): number {
  return Math.tan(a) - a;
}

export interface ProfileInfo {
  pts: [number, number][];
  ra: number;
  rf: number;
  rb: number;
  /** half-angle of the tooth at the tip (radians), ≤ 0 means pointed */
  tipHalf: number;
  N: number;
}

/** Closed CCW outline of the toothed disc (no bore), tooth 0 centred on angle `phase`. */
export function gearProfile(s: GearSpec): ProfileInfo {
  const N = s.drawTeeth ?? teethOf(s);
  const r = s.r * (s.drawTeeth ? s.drawTeeth / teethOf(s) : 1) === s.r ? s.r : s.r; // radius never changes
  const alpha = s.alpha ?? (20 * Math.PI) / 180;
  const ha = s.ha ?? 3 / 32;
  const hf = s.hf ?? 1.25 * M;
  const B = s.backlash ?? 0.03;
  const ra = r + ha;
  const rf = r - hf;
  const rb = r * Math.cos(alpha);
  const pitchAng = (2 * Math.PI) / N;
  // drawn module: if fewer teeth are drawn, scale tooth width with the pitch
  const pitchLen = (2 * Math.PI * r) / N;
  const halfP = (pitchLen / 2 - B / 2) / (2 * r); // half tooth thickness angle at pitch circle
  const fp = s.flankPts ?? 5;
  const tp = s.tipPts ?? 2;
  const rp = s.rootPts ?? 2;
  const phase = s.phase ?? 0;
  const pts: [number, number][] = [];
  const P = (rho: number, ang: number): void => {
    pts.push([rho * Math.cos(ang + phase), rho * Math.sin(ang + phase)]);
  };
  let tipHalf = 0;
  if (s.kind === 'sine') {
    // ρ(θ) = rm + A·w, w = sign(c)|c|^(1/p) shaping; c = cos(Nθ). Thinned so that ρ = r at the
    // tooth half-thickness halfP.
    const pw = s.sinePow ?? 1;
    const A = (ra - rf) / 2;
    const rm = (ra + rf) / 2;
    const n = Math.max(16, (s.flankPts ?? 5) * 4 + 4) * N; // samples
    // shift waveform so the crossing of r sits at halfP: use c = cos(k·θ') with warp so that
    // w(halfP) = (r − rm)/A. Simple approach: pure shape then report the real thickness.
    for (let i = 0; i < n; i++) {
      const th = (i / n) * 2 * Math.PI;
      const c = Math.cos(N * th);
      const w = Math.sign(c) * Math.abs(c) ** (1 / pw);
      P(rm + A * w, th);
    }
    tipHalf = 0;
    return { pts, ra, rf, rb, tipHalf, N };
  }
  // half-angle of the flank at radius rho
  const flankAng = (rho: number): number => {
    if (s.kind === 'trapezoid') {
      const halfLin = halfP * r - (rho - r) * Math.tan(alpha);
      return halfLin / rho;
    }
    const rr = Math.max(rho, rb);
    const a = Math.acos(rb / rr);
    return halfP + inv(alpha) - inv(a);
  };
  tipHalf = flankAng(ra);
  const rStart = s.kind === 'involute' ? Math.max(rf, Math.min(rb, ra)) : rf;
  for (let k = 0; k < N; k++) {
    const c = k * pitchAng;
    // root land from previous tooth's right flank to this tooth's left flank (we go CCW):
    // CCW order per tooth: right flank (angle c − ψ) rising, tip land, left flank (c + ψ) falling,
    // then root land up to the next tooth.
    // right flank, root → tip
    const flank: [number, number][] = []; // (rho, half-angle)
    if (s.kind === 'involute' && rf < rb) {
      if (s.underBase === 'parallel') {
        const hw = flankAng(rb) * rb; // linear half-width at the base circle
        for (const t of [0, 0.5]) { const rho = rf + (rb - rf) * t; flank.push([rho, Math.min(hw / rho, pitchAng / 2 - 0.02)]); }
      } else flank.push([rf, flankAng(rb)]); // radial segment below base circle
    }
    for (let i = 0; i < fp; i++) {
      const rho = rStart + ((ra - rStart) * i) / (fp - 1);
      flank.push([rho, flankAng(rho)]);
    }
    for (const [rho, h] of flank) P(rho, c - h);
    for (let i = 1; i < tp; i++) P(ra, c - tipHalf + (2 * tipHalf * i) / tp);
    for (let i = flank.length - 1; i >= 0; i--) P(flank[i]![0], c + flank[i]![1]);
    // root land to the next tooth's right flank start
    const a0 = c + flank[0]![1];
    const a1 = c + pitchAng - flank[0]![1];
    for (let i = 1; i < rp; i++) P(rf, a0 + ((a1 - a0) * i) / rp);
  }
  return { pts, ra, rf, rb, tipHalf, N };
}

// ------------------------------------------------------------------------------------------
// manifold helpers

type Raw = {
  _Extrude(p: unknown, h: number, n: number, tw: number, sc: { x: number; y: number }): Manifold;
  _Revolve(p: unknown, seg: number, deg: number): Manifold;
};
class Scope {
  items: { delete(): void }[] = [];
  t<T extends { delete(): void }>(m: T): T {
    this.items.push(m);
    return m;
  }
  free(): void {
    for (const m of this.items) m.delete();
  }
}
function polys(cs: CrossSection): { delete(): void } {
  return (cs as unknown as { _ToPolygons(): { delete(): void } })._ToPolygons();
}
function extrude(w: ManifoldToplevel, s: Scope, cs: CrossSection, z0: number, z1: number): Manifold {
  const p = polys(cs);
  try {
    const m = s.t((w as unknown as Raw)._Extrude(p, z1 - z0, 0, 0, { x: 1, y: 1 }));
    return s.t(m.translate([0, 0, z0]));
  } finally {
    p.delete();
  }
}
function revolve(w: ManifoldToplevel, s: Scope, prof: [number, number][], seg: number): Manifold {
  const cs = s.t(new w.CrossSection([prof]));
  const p = polys(cs);
  try {
    return s.t((w as unknown as Raw)._Revolve(p, seg, 360));
  } finally {
    p.delete();
  }
}
function circle(w: ManifoldToplevel, s: Scope, r: number, seg = 48, c: [number, number] = [0, 0]): CrossSection {
  return s.t(s.t(w.CrossSection.circle(r, seg)).translate(c));
}

export interface GearMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** vertex weights for the painted index mark */
  mark: Float32Array;
  triangles: number;
  ms: number;
  manifoldOK: boolean;
  genus: number;
  volume: number;
  status: string;
  info: ProfileInfo;
}

export const MARK_W = 0.12;
export const MARK_D = 0.04;

/** Build the solid (Z axis, centred on the hub) and mesh it with the repo's creasedMesh. */
export function buildGear(w: ManifoldToplevel, spec: GearSpec): GearMesh {
  const t0 = performance.now();
  const s = new Scope();
  try {
    const info = gearProfile(spec);
    const bandH = spec.bandH ?? H;
    let cs = s.t(new w.CrossSection([info.pts], 'Positive'));
    let gear = extrude(w, s, cs, -bandH, bandH);
    if (bandH < H) {
      const webR = spec.webR ?? info.rf - 0.06;
      const web = extrude(w, s, circle(w, s, Math.max(webR, H), Math.max(48, 4 * Math.ceil((40 * webR) / 4))), -H, H);
      gear = s.t(gear.add(web));
    }
    const c = spec.chamfer ?? 0;
    if (c > 0) {
      const R = info.ra;
      const seg = Math.max(48, 4 * Math.ceil((40 * R) / 4)) * 2;
      const cut = revolve(
        w,
        s,
        [
          [0, -bandH - 0.01],
          [R - c - 0.01, -bandH - 0.01],
          [R + 0.01, -bandH + c],
          [R + 0.01, bandH - c],
          [R - c - 0.01, bandH + 0.01],
          [0, bandH + 0.01],
        ],
        seg,
      );
      gear = s.t(gear.intersect(cut));
    }
    // bores
    const cutters: Manifold[] = [];
    const bore = spec.bore ?? 'axle';
    if (bore === 'pin') cutters.push(extrude(w, s, circle(w, s, R_BORE, 48), -H - 0.01, H + 0.01));
    else if (bore === 'axle') {
      const a = s.t(w.CrossSection.square([2 * W_BORE, 2 * R_BORE], true));
      const b = s.t(w.CrossSection.square([2 * R_BORE, 2 * W_BORE], true));
      const cross = s.t(s.t(a.add(b)).intersect(circle(w, s, R_BORE, 48)));
      cutters.push(extrude(w, s, cross, -H - 0.01, H + 0.01));
    }
    for (const [u, v] of spec.crankHoles ?? []) cutters.push(extrude(w, s, circle(w, s, R_BORE, 48, [u, v]), -H - 0.01, H + 0.01));
    if (spec.mark) {
      // radial groove on both faces, from 0.5 to the root circle − 0.06, at angle 0
      const r0 = 0.5;
      const r1 = info.rf - 0.05;
      if (r1 > r0 + 0.1) {
        const sq = s.t(s.t(w.CrossSection.square([r1 - r0, MARK_W], false)).translate([r0, -MARK_W / 2]));
        cutters.push(extrude(w, s, sq, H - MARK_D, H + 0.01));
        cutters.push(extrude(w, s, sq, -H - 0.01, -H + MARK_D));
      }
    }
    if (cutters.length) gear = s.t(gear.subtract(s.t(w.Manifold.union(cutters))));
    const status = String(gear.status());
    const genus = gear.genus();
    const volume = gear.volume();
    const mesh = gear.getMesh();
    const ma = creasedMesh(mesh.vertProperties, mesh.triVerts);
    // manifold check on the welded raw mesh: every edge used exactly twice, opposite directions
    const tv = mesh.triVerts;
    const edges = new Map<string, number>();
    for (let i = 0; i < tv.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const a = tv[i + k]!, b = tv[i + ((k + 1) % 3)]!;
        const key = `${a},${b}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    let ok = true;
    for (const [key, n] of edges) {
      const [a, b] = key.split(',');
      if (n !== 1 || edges.get(`${b},${a}`) !== 1) {
        ok = false;
        break;
      }
    }
    // mark weights: vertices of the groove floor/walls
    const nv = ma.positions.length / 3;
    const mark = new Float32Array(nv);
    if (spec.mark) {
      for (let i = 0; i < nv; i++) {
        const x = ma.positions[3 * i]!, y = ma.positions[3 * i + 1]!, z = ma.positions[3 * i + 2]!;
        if (x >= 0.5 - 1e-3 && x <= info.rf - 0.05 + 1e-3 && Math.abs(y) <= MARK_W / 2 + 1e-3 && Math.abs(z) >= H - MARK_D - 1e-3) {
          const nz = ma.normals[3 * i + 2]!;
          const ny = ma.normals[3 * i + 1]!;
          const nx = ma.normals[3 * i]!;
          const floor = Math.abs(nz) > 0.9 && Math.abs(Math.abs(z) - (H - MARK_D)) < 2e-3;
          const wall = (Math.abs(ny) > 0.9 && Math.abs(Math.abs(y) - MARK_W / 2) < 2e-3) || (nx < -0.9 && Math.abs(x - 0.5) < 2e-3);
          if (floor || wall) mark[i] = 1;
        }
      }
    }
    if (spec.markTooth) {
      const ph = spec.phase ?? 0;
      const half = Math.PI / info.N;
      for (let i = 0; i < nv; i++) {
        const x = ma.positions[3 * i]!, y = ma.positions[3 * i + 1]!;
        const nz = ma.normals[3 * i + 2]!;
        const rho = Math.hypot(x, y);
        let a = Math.atan2(y, x) - ph;
        a = Math.atan2(Math.sin(a), Math.cos(a));
        if (Math.abs(nz) < 0.95 && rho > info.rf + 0.005 && Math.abs(a) < half * 0.8) mark[i] = 1;
      }
    }
    return {
      positions: ma.positions,
      normals: ma.normals,
      indices: ma.indices,
      mark,
      triangles: ma.indices.length / 3,
      ms: performance.now() - t0,
      manifoldOK: ok,
      genus,
      volume,
      status,
      info,
    };
  } finally {
    s.free();
  }
}

/**
 * Patch grouping for the drawing treatments: append zero-area triangles (a, b, b) that make the
 * outline pass's patch labelling (vertexPatches: connected components of shared vertex indices)
 * treat a set of vertices as one smooth patch, without changing normals or shading.
 *   'band'  : every vertex of the tooth band (flanks, tips, roots, chamfers) → one patch
 *   'all'   : band + both flat faces → one patch (only silhouettes and depth jumps remain)
 */
export function groupPatches(g: GearMesh, mode: 'band' | 'all', spec: GearSpec): Uint32Array {
  const nv = g.positions.length / 3;
  const rf = g.info.rf;
  const sel: number[] = [];
  for (let i = 0; i < nv; i++) {
    const x = g.positions[3 * i]!, y = g.positions[3 * i + 1]!;
    const nz = g.normals[3 * i + 2]!;
    const rho = Math.hypot(x, y);
    const isBand = rho > rf - 0.02 && Math.abs(nz) < 0.95;
    const isFace = Math.abs(nz) > 0.95 && rho > 0.33 && !(g.mark[i]! > 0);
    if (isBand || (mode === 'all' && isFace)) sel.push(i);
  }
  void spec;
  if (sel.length < 2) return g.indices;
  const out = new Uint32Array(g.indices.length + (sel.length - 1) * 3);
  out.set(g.indices);
  let o = g.indices.length;
  for (let k = 1; k < sel.length; k++) {
    out[o++] = sel[0]!;
    out[o++] = sel[k]!;
    out[o++] = sel[k]!;
  }
  return out;
}

// ------------------------------------------------------------------------------------------
// 2-D interpenetration over a mesh cycle

/** rotate + translate a profile */
function place(pts: [number, number][], ang: number, dx: number): [number, number][] {
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map(([x, y]) => [c * x - s * y + dx, s * x + c * y]);
}
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ux = bx - ax, uy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * ux + (py - ay) * uy) / (ux * ux + uy * uy || 1)));
  return Math.hypot(px - ax - t * ux, py - ay - t * uy);
}
function pip(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Two gears: 1 at the origin, 2 at (d, 0). Canonical world phase (f(0) = ¼ pitch for both, see
 * placement.mjs), then gear 1 turns by θ and gear 2 by −θ·r1/r2 (rolling). Returns per step the
 * signed clearance near the contact region: > 0 the minimum gap, < 0 the deepest penetration
 * (max over vertices of either outline inside the other of their distance to its boundary).
 */
export function meshClearance(a: GearSpec, b: GearSpec, d: number, steps = 96): { min: number; max: number; overlapSteps: number } {
  const pa = gearProfile({ ...a, phase: 0 });
  const pb = gearProfile({ ...b, phase: 0 });
  const Na = pa.N, Nb = pb.N;
  // tooth centre angle θ0 = −π/(2N) gives f(0) = ¼
  const th0a = -Math.PI / (2 * Na);
  const th0b = -Math.PI / (2 * Nb);
  let min = Infinity, max = -Infinity, overlapSteps = 0;
  const cx = (d * a.r) / (a.r + b.r);
  for (let k = 0; k < steps; k++) {
    const th = ((2 * Math.PI) / Na) * (k / steps);
    const A = place(pa.pts, th0a + th, 0);
    const Bp = place(pb.pts, th0b - (th * a.r) / b.r, d);
    const near = (p: [number, number]) => Math.hypot(p[0] - cx, p[1]) < 0.7;
    const An = A.filter(near), Bn = Bp.filter(near);
    let best = Infinity;
    let pen = 0;
    const test = (P: [number, number][], Q: [number, number][]) => {
      for (const [x, y] of P) {
        let dm = Infinity;
        for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) {
          const [qx, qy] = Q[i]!, [rx, ry] = Q[j]!;
          if (Math.abs(qx - x) > 0.8 && Math.abs(rx - x) > 0.8) continue;
          dm = Math.min(dm, segDist(x, y, qx, qy, rx, ry));
        }
        if (pip(x, y, Q)) pen = Math.max(pen, dm);
        else best = Math.min(best, dm);
      }
    };
    test(An, Bp);
    test(Bn, A);
    const v = pen > 0 ? -pen : best;
    if (pen > 0) overlapSteps++;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { min, max, overlapSteps };
}
