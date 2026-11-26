// spikes/teeth2/lib.ts
import RAPIER from "@dimforge/rapier3d-compat";

// src/geometry/dims.ts
var H = 0.47;
var EPS = 5e-3;
var E_CONN = 0.5 + EPS;
var HC = 0.46;
var RIM_INSET = 0.5 - H;
var RIM_COLL_INSET = 0.5 - HC;

// src/core/model.ts
var RIM_MAX = 4;
var EMPTY = Object.freeze([]);
var RIM_BUCKET = 2 * RIM_MAX;

// spikes/teeth2/lib.ts
var DT = 1 / 480;
var BIT = { GROUND: 1, TOOTH: 2, SMOOTH: 4, PART: 8, PAWL: 16, NONE: 0 };
var grp = (m, f) => (m & 65535) << 16 | f & 65535;
var G_TOOTH = grp(BIT.TOOTH, BIT.PAWL);
var G_SMOOTH = grp(BIT.SMOOTH, BIT.GROUND | BIT.PART);
var G_PART = grp(BIT.PART, BIT.GROUND | BIT.PART | BIT.SMOOTH | BIT.PAWL);
var G_PAWL = grp(BIT.PAWL, BIT.GROUND | BIT.PART | BIT.TOOTH | BIT.PAWL);
var G_GROUND = grp(BIT.GROUND, BIT.PART | BIT.SMOOTH | BIT.PAWL);
var G_NONE = grp(0, 0);
var MOD = 0.125;
function gear(r, T = Math.round(16 * r)) {
  return { r, T, tip: r + MOD, root: r - 1.25 * MOD, D: 2 * Math.PI / T };
}
var PA = 20 * Math.PI / 180;
function toothPoly(g, k) {
  const p = MOD * Math.PI;
  const w = (rho) => p / 4 - (rho - g.r) * Math.tan(PA);
  const rb = g.root - 0.03;
  const c = (k + 0.5) * g.D;
  const loc = [
    [rb, -w(rb)],
    [g.tip, -w(g.tip)],
    [g.tip, w(g.tip)],
    [rb, w(rb)]
  ];
  return loc.map(([x, y]) => [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]);
}

// spikes/teeth2/geom.ts
var segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
var inPoly = (p, P) => {
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < 0) return false;
  }
  return true;
};
var circleHitsPoly = (c, R, P) => inPoly(c, P) || P.some((a, i) => segDist(c, a, P[(i + 1) % P.length]) < R);
var sat = (A, B) => {
  for (const P of [A, B])
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      const n = [b[1] - a[1], a[0] - b[0]];
      const pa = A.map((p) => p[0] * n[0] + p[1] * n[1]);
      const pb = B.map((p) => p[0] * n[0] + p[1] * n[1]);
      if (Math.max(...pa) <= Math.min(...pb) || Math.max(...pb) <= Math.min(...pa)) return false;
    }
  return true;
};
for (const r of [0.5, 1, 1.5, 2.5]) {
  const g = gear(r);
  const teeth = Array.from({ length: g.T }, (_, k) => toothPoly(g, k));
  const gapA = 0;
  const tipW = Math.hypot(...[0, 1].map((i) => teeth[0][2][i] - teeth[0][1][i]));
  const gapTip = 2 * g.tip * Math.sin(g.D / 2) - tipW;
  const line = [`r ${r} T ${g.T}: tip ${g.tip.toFixed(3)} root ${g.root.toFixed(3)} tooth height ${(g.tip - g.root).toFixed(3)} tip width ${tipW.toFixed(3)} gap at tip ${gapTip.toFixed(3)} pitch ${(g.r * g.D).toFixed(3)}`];
  for (const R of [0.46, 0.469, 0.29, 0.15, 0.1]) {
    let lo = g.root - R, hi = g.tip + R + 0.01;
    for (let it = 0; it < 60; it++) {
      const m = (lo + hi) / 2;
      const c = [m * Math.cos(gapA), m * Math.sin(gapA)];
      if (teeth.some((P) => circleHitsPoly(c, R, P))) lo = m;
      else hi = m;
    }
    const depth = g.tip - (hi - R);
    line.push(`  circle R ${R}: deepest point reaches ${depth.toFixed(3)} below the tip circle (${(100 * depth / (g.tip - g.root)).toFixed(0)}% of tooth height)`);
  }
  for (const [name, w] of [["square 0.92", 0.92], ["pin end 0.58", 0.58]]) {
    let best = 0;
    for (let tilt = -45; tilt <= 45; tilt += 5) {
      const th = tilt * Math.PI / 180;
      const sq = [
        [0, 0],
        [w, 0],
        [w, w],
        [0, w]
      ];
      const rot = (p, a) => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a)];
      const base = sq.map((p) => rot([p[0], p[1] - 0], -Math.PI / 4 + th)).map((p) => rot(p, 0));
      let lo = g.root, hi = g.tip + 1;
      for (let it = 0; it < 60; it++) {
        const m = (lo + hi) / 2;
        const S = base.map((p) => [p[0] + m, p[1]]);
        if (teeth.some((P) => sat(S, P))) lo = m;
        else hi = m;
      }
      best = Math.max(best, g.tip - hi);
    }
    line.push(`  ${name} corner (best tilt): reaches ${best.toFixed(3)} below the tip circle (${(100 * best / (g.tip - g.root)).toFixed(0)}%)`);
  }
  console.log(line.join("\n"));
}
