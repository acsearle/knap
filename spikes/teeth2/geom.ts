// 2D geometry: how deep can each pawl feature enter a tooth gap? (exact polygon tests, no physics)
//   sh spikes/teeth2/run.sh geom
import { gear, toothPoly } from './lib';
type P2 = [number, number];
const segDist = (p: P2, a: P2, b: P2) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const inPoly = (p: P2, P: P2[]) => {
  for (let i = 0; i < P.length; i++) {
    const a = P[i]!, b = P[(i + 1) % P.length]!;
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return false;
  }
  return true;
};
const circleHitsPoly = (c: P2, R: number, P: P2[]) => inPoly(c, P) || P.some((a, i) => segDist(c, a, P[(i + 1) % P.length]!) < R);
// convex polygon overlap via SAT
const sat = (A: P2[], B: P2[]) => {
  for (const P of [A, B])
    for (let i = 0; i < P.length; i++) {
      const a = P[i]!, b = P[(i + 1) % P.length]!;
      const n: P2 = [b[1] - a[1], a[0] - b[0]];
      const pa = A.map((p) => p[0] * n[0] + p[1] * n[1]);
      const pb = B.map((p) => p[0] * n[0] + p[1] * n[1]);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  return true;
};
for (const r of [0.5, 1, 1.5, 2.5]) {
  const g = gear(r);
  const teeth = Array.from({ length: g.T }, (_, k) => toothPoly(g, k));
  const gapA = 0; // gap centre is at angle 0 (teeth centred at (k+½)Δ)
  const tipW = Math.hypot(...([0, 1].map((i) => teeth[0]![2]![i]! - teeth[0]![1]![i]!) as P2));
  const gapTip = 2 * g.tip * Math.sin(g.D / 2) - tipW;
  const line = [`r ${r} T ${g.T}: tip ${g.tip.toFixed(3)} root ${g.root.toFixed(3)} tooth height ${(g.tip - g.root).toFixed(3)} tip width ${tipW.toFixed(3)} gap at tip ${gapTip.toFixed(3)} pitch ${(g.r * g.D).toFixed(3)}`];
  // circles approaching radially along the gap centre line
  for (const R of [0.46, 0.469, 0.29, 0.15, 0.1]) {
    let lo = g.root - R, hi = g.tip + R + 0.01;
    for (let it = 0; it < 60; it++) {
      const m = (lo + hi) / 2;
      const c: P2 = [m * Math.cos(gapA), m * Math.sin(gapA)];
      if (teeth.some((P) => circleHitsPoly(c, R, P))) lo = m;
      else hi = m;
    }
    const depth = g.tip - (hi - R);
    line.push(`  circle R ${R}: deepest point reaches ${depth.toFixed(3)} below the tip circle (${((100 * depth) / (g.tip - g.root)).toFixed(0)}% of tooth height)`);
  }
  // 90° corner of a square (side 0.92), best tilt, approaching along the gap centre line
  for (const [name, w] of [['square 0.92', 0.92], ['pin end 0.58', 0.58]] as [string, number][]) {
    let best = 0;
    for (let tilt = -45; tilt <= 45; tilt += 5) {
      const th = (tilt * Math.PI) / 180;
      // square with one corner as leading point at origin, diagonal pointing −x (toward the gear)
      const sq: P2[] = [
        [0, 0],
        [w, 0],
        [w, w],
        [0, w],
      ];
      const rot = (p: P2, a: number): P2 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
      const base = sq.map((p) => rot([p[0], p[1] - 0], -Math.PI / 4 + th)).map((p) => rot(p, 0)); // corner at origin, body toward +x
      let lo = g.root, hi = g.tip + 1;
      for (let it = 0; it < 60; it++) {
        const m = (lo + hi) / 2;
        const S = base.map((p) => [p[0] + m, p[1]] as P2);
        if (teeth.some((P) => sat(S, P))) lo = m;
        else hi = m;
      }
      best = Math.max(best, g.tip - hi);
    }
    line.push(`  ${name} corner (best tilt): reaches ${best.toFixed(3)} below the tip circle (${((100 * best) / (g.tip - g.root)).toFixed(0)}%)`);
  }
  console.log(line.join('\n'));
}
