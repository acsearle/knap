// Quasi-static 2D analysis of a gravity pawl on a toothed gear (the analytic reference for the
// simulation). Everything in the gear plane; gear centre at the origin, rotated by φ.
//
// Pawl rest angle α*(φ): the pawl (pivot p, arm along angle α) rotated in the sense σ in which its
// own weight turns it, until it first touches the gear outline. As the gear turns, α*(φ) follows.
// Required gear torque, direction s, per position (quasi-static, pawl massless in dynamics, weight
// m·g at its centre of mass, pivot dry friction τ_p, Coulomb friction μ at the contact):
//   contact point k (on the gear), normal n (gear → pawl), pawl rate dα per gear step;
//   sliding direction t̂ = tangential part of (gear point velocity − pawl point velocity);
//   force on pawl F = λ (n + μ t̂); pawl moment balance λ·((k−p)×(n+μt̂)) + M_g + M_pf = 0;
//   if the pawl must rise (dα against its weight) and no λ > 0 satisfies that → JAM (locks);
//   if λ ≤ 0 while the pawl falls → contact lost (0 torque);
//   gear torque needed τ = s·(k × F).
// With μ = 0 this is exactly dU/dφ (virtual work), which is checked.
import type { P2 } from './lib';
import { HC, ROD, G, PIVOT_MU, R_BORE, gearPolys2D, tipR } from './lib';
import type { GearSpec, PawlKind } from './lib';

export interface Prim {
  pts: P2[];
  rad: number;
}

export function pawlPrims(kind: PawlKind, l: number): Prim[] {
  if (kind === 'end' || kind === 'side') return [{ pts: [[0, 0], [l, 0]], rad: HC }];
  if (kind === 'rod') return [{ pts: [[l, 0]], rad: ROD }];
  const out: Prim[] = [];
  out.push({ pts: l - 1 > 0 ? [[0, 0], [l - 1, 0]] : [[0, 0]], rad: HC });
  out.push({ pts: [[l - 1, -HC], [l + HC, -HC], [l + HC, HC], [l - 1, HC]], rad: 0 });
  return out;
}

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
const crs = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];

function ptSeg(p: P2, a: P2, b: P2): P2 {
  const ab = sub(b, a);
  const L = dot(ab, ab);
  const t = L > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L)) : 0;
  return [a[0] + ab[0] * t, a[1] + ab[1] * t];
}
function edges(P: P2[]): [P2, P2][] {
  if (P.length === 1) return [[P[0]!, P[0]!]];
  if (P.length === 2) return [[P[0]!, P[1]!]];
  return P.map((q, i) => [q, P[(i + 1) % P.length]!]);
}
function separated(A: P2[], B: P2[]): boolean {
  const axes: P2[] = [];
  for (const S of [A, B])
    for (const [a, b] of edges(S)) {
      const d = sub(b, a);
      if (d[0] !== 0 || d[1] !== 0) axes.push([-d[1], d[0]]);
    }
  if (axes.length === 0) return A[0]![0] !== B[0]![0] || A[0]![1] !== B[0]![1];
  for (const ax of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of A) { const v = dot(q, ax); a0 = Math.min(a0, v); a1 = Math.max(a1, v); }
    for (const q of B) { const v = dot(q, ax); b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
    if (a1 < b0 || b1 < a0) return true;
  }
  return false;
}
/** Distance between convex point sets (0 if they intersect) and the closest points. */
export function convexDist(A: P2[], B: P2[]): { d: number; pa: P2; pb: P2 } {
  if (!separated(A, B)) return { d: 0, pa: A[0]!, pb: A[0]! };
  let best = { d: Infinity, pa: A[0]!, pb: B[0]! };
  for (const q of A)
    for (const [a, b] of edges(B)) {
      const c = ptSeg(q, a, b);
      const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
      if (d < best.d) best = { d, pa: q, pb: c };
    }
  for (const q of B)
    for (const [a, b] of edges(A)) {
      const c = ptSeg(q, a, b);
      const d = Math.hypot(q[0] - c[0], q[1] - c[1]);
      if (d < best.d) best = { d, pa: c, pb: q };
    }
  return best;
}

export interface Setup {
  g: GearSpec;
  kind: PawlKind;
  l: number;
  p: P2; // pivot (integer grid)
  mass: number;
  comLocal: P2; // pawl centre of mass in the pawl frame (from Rapier)
}

export class Geo {
  polys: P2[][];
  prims: Prim[];
  tr: number;
  primR: number[];
  primC: P2[];
  constructor(public s: Setup) {
    this.polys = gearPolys2D(s.g);
    this.prims = pawlPrims(s.kind, s.l);
    this.tr = tipR(s.g);
    this.primC = this.prims.map((q) => [q.pts.reduce((a, b) => a + b[0], 0) / q.pts.length, q.pts.reduce((a, b) => a + b[1], 0) / q.pts.length]);
    this.primR = this.prims.map((q, i) => Math.max(...q.pts.map((x) => Math.hypot(x[0] - this.primC[i]![0], x[1] - this.primC[i]![1]))) + q.rad);
  }
  pawlPts(alpha: number, q: Prim): P2[] {
    const c = Math.cos(alpha), sn = Math.sin(alpha);
    return q.pts.map(([x, y]) => [this.s.p[0] + c * x - sn * y, this.s.p[1] + sn * x + c * y]);
  }
  gearPoly(i: number, phi: number): P2[] {
    const c = Math.cos(phi), sn = Math.sin(phi);
    return this.polys[i]!.map(([x, y]) => [c * x - sn * y, sn * x + c * y]);
  }
  /** Clearance (≤ 0 = touching/overlap) and the closest pair. */
  clearance(alpha: number, phi: number): { c: number; pa: P2; pb: P2 } {
    let best = { c: Infinity, pa: [0, 0] as P2, pb: [0, 0] as P2 };
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    this.prims.forEach((q, qi) => {
      const lc = this.primC[qi]!;
      const wc: P2 = [this.s.p[0] + ca * lc[0] - sa * lc[1], this.s.p[1] + sa * lc[0] + ca * lc[1]];
      if (Math.hypot(wc[0], wc[1]) - this.primR[qi]! > this.tr + 0.05) return;
      const P = this.pawlPts(alpha, q);
      for (let i = 0; i < this.polys.length; i++) {
        const r = convexDist(P, this.gearPoly(i, phi));
        const c = r.d - q.rad;
        if (c < best.c) best = { c, pa: r.pa, pb: r.pb };
      }
    });
    return best;
  }
  /** Gravity moment about the pivot at α (sign = sense the weight turns the pawl). */
  Mg(alpha: number): number {
    const [x, y] = this.s.comLocal;
    const wx = Math.cos(alpha) * x - Math.sin(alpha) * y;
    return -wx * this.s.mass * G;
  }
  comY(alpha: number): number {
    const [x, y] = this.s.comLocal;
    return this.s.p[1] + Math.sin(alpha) * x + Math.cos(alpha) * y;
  }
  /** Rest angles at φ = 0: boundaries of the free α intervals into which the weight presses. */
  rests(): { alpha: number; sigma: number }[] {
    const N = 720;
    const free: boolean[] = [];
    for (let i = 0; i < N; i++) free.push(this.clearance((i / N) * 2 * Math.PI, 0).c > 0);
    if (free.every((f) => f) || free.every((f) => !f)) return [];
    const out: { alpha: number; sigma: number }[] = [];
    for (let i = 0; i < N; i++) {
      const a = free[i]!, b = free[(i + 1) % N]!;
      if (a === b) continue;
      // boundary between i and i+1
      let lo = (i / N) * 2 * Math.PI, hi = ((i + 1) / N) * 2 * Math.PI;
      for (let k = 0; k < 40; k++) {
        const m = (lo + hi) / 2;
        if ((this.clearance(m, 0).c > 0) === a) lo = m;
        else hi = m;
      }
      // free→blocked going CCW: the obstacle is at larger α; weight must press CCW (Mg > 0)
      const sigma = a ? 1 : -1;
      const alpha = a ? lo : hi;
      if (sigma * this.Mg(alpha) > 0) out.push({ alpha, sigma });
    }
    return out;
  }
  /** Rest angle near `prev` (sense σ) at gear angle φ; NaN if none within 0.6 rad. */
  follow(prev: number, sigma: number, phi: number): number {
    let a = prev - sigma * 0.02;
    let k = 0;
    while (this.clearance(a, phi).c <= 0) {
      a -= sigma * 0.02;
      if (++k > 30) return NaN;
    }
    let b = a;
    k = 0;
    while (this.clearance(b, phi).c > 0) {
      b += sigma * 0.004;
      if (++k > 400) return NaN; // nothing to rest on any more
    }
    let lo = b - sigma * 0.004, hi = b;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (this.clearance(m, phi).c > 0) lo = m;
      else hi = m;
    }
    return lo;
  }
  /** Contact point (on the gear) and normal (gear → pawl) at a rest. */
  contact(alpha: number, phi: number): { k: P2; n: P2; onEnd: boolean } {
    const r = this.clearance(alpha, phi);
    const d = sub(r.pa, r.pb);
    const L = Math.hypot(d[0], d[1]) || 1;
    // where along the arm (pawl frame x of the closest point)
    const rel = sub(r.pa, this.s.p);
    const xArm = Math.cos(alpha) * rel[0] + Math.sin(alpha) * rel[1];
    return { k: r.pb, n: [d[0] / L, d[1] / L], onEnd: xArm > this.s.l - 0.5 };
  }
}

export interface Sweep {
  /** Peak torque the gear needs to turn in direction s through 2 pitches (Infinity = jams). */
  peak: number;
  /** Frictionless peak dU/dφ (virtual work) and the μ=0 formula (should agree). */
  peakU: number;
  peakMu0: number;
  /** Depth the pawl end (centre of its last hole / rod) drops into a gap: range of its distance from the gear centre. */
  dip: number;
}

export function sweep(geo: Geo, rest: { alpha: number; sigma: number }, s: number, mu: number, pitches = 2, perPitch = 40): Sweep {
  const D = (2 * Math.PI) / geo.s.g.T;
  const h = D / perPitch;
  const mPivot = PIVOT_MU * geo.s.mass * G * R_BORE;
  let a = rest.alpha;
  let peak = 0, peakU = 0, peakMu0 = 0;
  let rmin = Infinity, rmax = -Infinity;
  for (let i = 0; i < pitches * perPitch; i++) {
    const phi0 = s * i * h;
    const phi1 = s * (i + 1) * h;
    const a1 = geo.follow(a, rest.sigma, phi1);
    if (!Number.isFinite(a1)) return { peak: 0, peakU: 0, peakMu0: 0, dip: NaN };
    const { k, n } = geo.contact(a, phi0);
    const rk = Math.hypot(geo.s.p[0] + geo.s.l * Math.cos(a), geo.s.p[1] + geo.s.l * Math.sin(a)); // pawl end centre
    rmin = Math.min(rmin, rk);
    rmax = Math.max(rmax, rk);
    const da = a1 - a;
    const dU = (geo.s.mass * G * (geo.comY(a1) - geo.comY(a))) / h;
    if (Math.abs(da) < 0.3) peakU = Math.max(peakU, dU);
    const Mg = geo.Mg(a);
    const lift = da * Mg < 0;
    for (const [m, isMu] of [[mu, true], [0, false]] as [number, boolean][]) {
      const vg: P2 = [-s * k[1], s * k[0]];
      const kp = sub(k, geo.s.p);
      const vp: P2 = [(-da / h) * kp[1], (da / h) * kp[0]];
      const vr = sub(vg, vp);
      const vn = dot(vr, n);
      const t: P2 = [vr[0] - vn * n[0], vr[1] - vn * n[1]];
      const tl = Math.hypot(t[0], t[1]);
      const th: P2 = tl > 1e-9 ? [t[0] / tl, t[1] / tl] : [0, 0];
      const f: P2 = [n[0] + m * th[0], n[1] + m * th[1]];
      const mc = crs(kp, f);
      const Mpf = Math.abs(da) > 1e-12 ? -Math.sign(da) * (isMu ? mPivot : 0) : 0;
      const lam = -(Mg + Mpf) / mc;
      let tau: number;
      if (!(lam > 0) || !Number.isFinite(lam)) tau = lift ? Infinity : 0;
      else tau = s * crs(k, [lam * f[0], lam * f[1]]);
      if (Math.abs(da) > 0.3) tau = lift ? Infinity : 0; // pawl had to jump: a face, not a slope
      if (isMu) peak = Math.max(peak, tau);
      else peakMu0 = Math.max(peakMu0, tau);
    }
    a = a1;
  }
  return { peak, peakU, peakMu0, dip: rmax - rmin };
}
