// Part B1 numbers: triangle count, build time, manifold check per profile × size, and 2-D
// interpenetration over one mesh cycle for every size pair at d = r1+r2 and ±0.02.
//   npx vitest run --config spikes/gearlook/vitest.config.ts measure   → out/measure.txt
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Module from 'manifold-3d';
import { it } from 'vitest';
import { buildGear, gearProfile, meshClearance, type GearSpec } from './gear';

const RADII = [0.5, 1, 1.5, 2.5];
const DEG = Math.PI / 180;

const VARIANTS: Record<string, Omit<GearSpec, 'r'>> = {
  'involute':           { kind: 'involute', alpha: 20 * DEG, ha: 3 / 32, hf: 0.15625, backlash: 0.03, flankPts: 5, tipPts: 2, rootPts: 2 },
  'involute-ch':        { kind: 'involute', alpha: 20 * DEG, ha: 3 / 32, hf: 0.15625, backlash: 0.03, flankPts: 5, tipPts: 2, rootPts: 2, chamfer: 0.03 },
  'involute-fullha':    { kind: 'involute', alpha: 20 * DEG, ha: 0.125, hf: 0.15625, backlash: 0.03, flankPts: 5, tipPts: 2, rootPts: 2 },
  'involute-B0':        { kind: 'involute', alpha: 20 * DEG, ha: 3 / 32, hf: 0.15625, backlash: 0, flankPts: 5, tipPts: 2, rootPts: 2 },
  'involute-f3':        { kind: 'involute', alpha: 20 * DEG, ha: 3 / 32, hf: 0.15625, backlash: 0.03, flankPts: 3, tipPts: 1, rootPts: 1 },
  'trapezoid':          { kind: 'trapezoid', alpha: 20 * DEG, ha: 3 / 32, hf: 0.15625, backlash: 0.03, flankPts: 2, tipPts: 1, rootPts: 1 },
  'trapezoid-ch':       { kind: 'trapezoid', alpha: 20 * DEG, ha: 3 / 32, hf: 0.15625, backlash: 0.03, flankPts: 2, tipPts: 1, rootPts: 1, chamfer: 0.03 },
  'trapezoid-B0':       { kind: 'trapezoid', alpha: 20 * DEG, ha: 3 / 32, hf: 0.15625, backlash: 0, flankPts: 2, tipPts: 1, rootPts: 1 },
  'sine':               { kind: 'sine', ha: 3 / 32, hf: 0.15625, flankPts: 3 },
  'sine-ch':            { kind: 'sine', ha: 3 / 32, hf: 0.15625, flankPts: 3, chamfer: 0.03 },
};

it('measure', async () => {
  const w = await Module();
  w.setup();
  const lines: string[] = [];
  const L = (s: string) => { lines.push(s); console.log(s); };
  L('== solids (axle bore, ±H = 0.47 extrusion). tri = triangles after creasedMesh; ms = build incl. meshing (machine loaded, ±50%); closed = every edge used once each way');
  L('variant            r    N  tri    ms    closed genus  tipHalfThk  rb     rf     ra');
  for (const [name, v] of Object.entries(VARIANTS)) {
    for (const r of RADII) {
      const spec = { ...v, r } as GearSpec;
      // warm
      buildGear(w, spec);
      const reps = 3;
      let ms = 0; let g = buildGear(w, spec);
      for (let i = 0; i < reps; i++) { g = buildGear(w, spec); ms += g.ms; }
      const thick = g.info.tipHalf * g.info.ra * 2;
      L(`${name.padEnd(18)} ${r.toFixed(1)} ${String(g.info.N).padStart(3)} ${String(g.triangles).padStart(5)} ${(ms / reps).toFixed(1).padStart(6)} ${String(g.manifoldOK).padStart(6)} ${String(g.genus).padStart(4)}  ${thick.toFixed(4).padStart(9)}  ${g.info.rb.toFixed(3)} ${g.info.rf.toFixed(3)} ${g.info.ra.toFixed(3)}`);
    }
  }
  // with crank holes + mark, the 40-tooth
  for (const extra of [{ mark: true }, { crankHoles: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1], [2, 0], [-2, 0], [0, 2], [0, -2]] as [number, number][] }]) {
    const g = buildGear(w, { ...VARIANTS.involute!, r: 2.5, ...extra } as GearSpec);
    L(`involute r2.5 ${JSON.stringify(extra).slice(0, 40)}: tri ${g.triangles} closed ${g.manifoldOK} genus ${g.genus} ms ${g.ms.toFixed(1)}`);
  }
  const thin = buildGear(w, { ...VARIANTS.involute!, r: 2.5, bandH: 0.3 } as GearSpec);
  L(`involute r2.5 bandH 0.3 (thin teeth on a full hub web): tri ${thin.triangles} closed ${thin.manifoldOK} genus ${thin.genus}`);

  L('');
  L('== 2-D clearance over one mesh cycle (96 steps per pitch), dense profiles (20 pts/flank). value = min signed clearance (units): <0 = deepest penetration');
  L('   canonical world phase (f(0)=¼) on both, gear 2 rolls; d = r1+r2 + {−0.02, 0, +0.02}');
  for (const name of ['involute', 'involute-fullha', 'involute-B0', 'trapezoid', 'trapezoid-B0', 'sine']) {
    const v = VARIANTS[name]!;
    const dense = { ...v, flankPts: v.kind === 'trapezoid' ? 2 : 20, tipPts: 6, rootPts: 6 } as Omit<GearSpec, 'r'>;
    const row: string[] = [];
    let worst = Infinity;
    for (let i = 0; i < RADII.length; i++)
      for (let j = i; j < RADII.length; j++) {
        const a = { ...dense, r: RADII[i]! } as GearSpec;
        const b = { ...dense, r: RADII[j]! } as GearSpec;
        const vals = [-0.02, 0, 0.02].map((dd) => meshClearance(a, b, a.r + b.r + dd).min);
        worst = Math.min(worst, ...vals);
        row.push(`${a.r}+${b.r}: ${vals.map((x) => x.toFixed(3)).join('/')}`);
      }
    L(`  ${name.padEnd(16)} worst ${worst.toFixed(4)} | ${row.join('  ')}`);
  }
  // backlash sweep: smallest backlash with no overlap at −0.02 for every pair (involute and trapezoid)
  L('');
  L('== backlash sweep: worst clearance over all 10 pairs at d−0.02 / d / d+0.02');
  for (const kind of ['involute', 'trapezoid'] as const) {
    for (const B of [0, 0.01, 0.02, 0.03, 0.04, 0.06]) {
      let w0 = Infinity, w1 = Infinity, w2 = Infinity;
      for (let i = 0; i < RADII.length; i++)
        for (let j = i; j < RADII.length; j++) {
          const base = { ...VARIANTS[kind]!, backlash: B, flankPts: kind === 'trapezoid' ? 2 : 20, tipPts: 6, rootPts: 6 } as Omit<GearSpec, 'r'>;
          const a = { ...base, r: RADII[i]! } as GearSpec, b = { ...base, r: RADII[j]! } as GearSpec;
          w0 = Math.min(w0, meshClearance(a, b, a.r + b.r - 0.02, 48).min);
          w1 = Math.min(w1, meshClearance(a, b, a.r + b.r, 48).min);
          w2 = Math.min(w2, meshClearance(a, b, a.r + b.r + 0.02, 48).min);
        }
      L(`  ${kind} B=${B}: ${w0.toFixed(4)} / ${w1.toFixed(4)} / ${w2.toFixed(4)}`);
    }
  }
  // phase error tolerance: how far can gear 2 be off its rolling phase before overlap (involute B 0.03, d)
  L('');
  L('== phase-error tolerance (involute, B=0.03, d = r1+r2): extra rotation of gear 2 (in pitches) that first gives overlap');
  for (const [r1, r2] of [[0.5, 0.5], [0.5, 2.5], [1, 1], [2.5, 2.5]]) {
    const base = { ...VARIANTS.involute!, flankPts: 20, tipPts: 6, rootPts: 6 } as Omit<GearSpec, 'r'>;
    let tol = 0;
    for (let e = 0; e <= 0.2; e += 0.005) {
      const N2 = 16 * r2;
      const b = { ...base, r: r2, phase: (e * 2 * Math.PI) / N2 } as GearSpec;
      // meshClearance resets phase to 0; emulate by shifting via a wrapper profile
      const res = meshClearanceShift({ ...base, r: r1 } as GearSpec, b, r1 + r2, (e * 2 * Math.PI) / N2);
      if (res < 0) break;
      tol = e;
    }
    L(`  ${r1}+${r2}: ${tol.toFixed(3)} pitch (${(tol * Math.PI / 8).toFixed(4)} units)`);
  }
  writeFileSync(join(__dirname, 'out', 'measure.txt'), lines.join('\n') + '\n');
  void gearProfile;
});

// local variant of meshClearance with an extra phase on gear 2
function meshClearanceShift(a: GearSpec, b: GearSpec, d: number, extra: number): number {
  const bb = { ...b };
  // rotate gear 2 by `extra` by baking it into the profile phase *after* meshClearance's reset:
  const orig = gearProfile;
  void orig;
  // simple: sample manually
  let min = Infinity;
  for (const sgn of [1, -1]) {
    const r = meshClearancePhase(a, bb, d, sgn * extra);
    min = Math.min(min, r);
  }
  return min;
}
import { meshClearance as _mc } from './gear';
function meshClearancePhase(a: GearSpec, b: GearSpec, d: number, extra: number): number {
  // meshClearance places tooth centres at −π/(2N); add extra by giving b.phase — patch via drawTeeth-free hack:
  return _mcPhase(a, b, d, extra);
}
import { gearProfile as gp } from './gear';
function _mcPhase(a: GearSpec, b: GearSpec, d: number, extra: number): number {
  void _mc;
  const pa = gp({ ...a, phase: -Math.PI / (2 * 16 * a.r) });
  const pb = gp({ ...b, phase: -Math.PI / (2 * 16 * b.r) + extra });
  let min = Infinity;
  const steps = 48;
  for (let k = 0; k < steps; k++) {
    const th = ((2 * Math.PI) / pa.N) * (k / steps);
    const A = rot(pa.pts, th, 0), B = rot(pb.pts, (-th * a.r) / b.r, d);
    min = Math.min(min, clearance(A, B, (d * a.r) / (a.r + b.r)));
  }
  return min;
}
function rot(pts: [number, number][], ang: number, dx: number): [number, number][] {
  const c = Math.cos(ang), s = Math.sin(ang);
  return pts.map(([x, y]) => [c * x - s * y + dx, s * x + c * y]);
}
function clearance(A: [number, number][], B: [number, number][], cx: number): number {
  const near = (p: [number, number]) => Math.hypot(p[0] - cx, p[1]) < 0.7;
  let best = Infinity, pen = 0;
  const pipf = (px: number, py: number, poly: [number, number][]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const sd = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const ux = bx - ax, uy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * ux + (py - ay) * uy) / (ux * ux + uy * uy || 1)));
    return Math.hypot(px - ax - t * ux, py - ay - t * uy);
  };
  const test = (P: [number, number][], Q: [number, number][]) => {
    for (const [x, y] of P.filter(near)) {
      let dm = Infinity;
      for (let i = 0, j = Q.length - 1; i < Q.length; j = i++) dm = Math.min(dm, sd(x, y, Q[i]![0], Q[i]![1], Q[j]![0], Q[j]![1]));
      if (pipf(x, y, Q)) pen = Math.max(pen, dm); else best = Math.min(best, dm);
    }
  };
  test(A, B); test(B, A);
  return pen > 0 ? -pen : best;
}
