// spikes/teeth/lib.ts
import RAPIER from "@dimforge/rapier3d-compat";

// src/geometry/dims.ts
var EPS = 5e-3;
var E_CONN = 0.5 + EPS;

// src/core/model.ts
var EMPTY = Object.freeze([]);

// src/physics/shapes.ts
var BEVEL = 0.01;
var KEEP_DEG = 56.25;
function polyMoments(P) {
  let A = 0;
  let cu = 0;
  let cv = 0;
  let Su2 = 0;
  let Sv2 = 0;
  for (let i = 0; i < P.length; i++) {
    const [x0, y0] = P[i];
    const [x1, y1] = P[(i + 1) % P.length];
    const c2 = x0 * y1 - x1 * y0;
    A += c2 / 2;
    cu += (x0 + x1) * c2 / 6;
    cv += (y0 + y1) * c2 / 6;
    Su2 += (x0 * x0 + x0 * x1 + x1 * x1) * c2 / 12;
    Sv2 += (y0 * y0 + y0 * y1 + y1 * y1) * c2 / 12;
  }
  cu /= A;
  cv /= A;
  return { A, cu, cv, Iuu: Sv2 - A * cv * cv, Ivv: Su2 - A * cu * cu };
}
function bevelledPrism(center, axis, u, halfLength, poly) {
  const v = 3 - axis - u;
  const points = [];
  for (const q of poly)
    for (const s of [-1, 1]) {
      const p = [center[0], center[1], center[2]];
      p[u] += q.u;
      p[v] += q.v;
      p[axis] += s * (q.keep ? halfLength : halfLength - BEVEL);
      points.push(p);
    }
  const m = polyMoments(poly.map((q) => [q.u, q.v]));
  const L = 2 * halfLength;
  const volume = m.A * L;
  const com = [center[0], center[1], center[2]];
  com[u] += m.cu;
  com[v] += m.cv;
  const inertia = [0, 0, 0];
  inertia[axis] = (m.Iuu + m.Ivv) * L;
  inertia[u] = m.Iuu * L + volume * L * L / 12;
  inertia[v] = m.Ivv * L + volume * L * L / 12;
  return { kind: "hull", points, mass: { volume, com, inertia } };
}
function gonVertex(R, segments, i) {
  const a = (i + 0.5) / segments * 2 * Math.PI;
  return { u: R * Math.cos(a), v: R * Math.sin(a), a };
}
function keepIndex(segments) {
  let best = 0;
  for (let i = 0; i < segments / 4; i++)
    if (Math.abs((i + 0.5) / segments * 360 - KEEP_DEG) < Math.abs((best + 0.5) / segments * 360 - KEEP_DEG)) best = i;
  return best;
}
function checkSegments(segments) {
  if (!Number.isInteger(segments) || segments < 4 || segments % 4 !== 0)
    throw new Error(`cylinderSegments must be a multiple of 4 (got ${segments})`);
}
function prismShape(center, axis, radius, halfLength, segments, u, runLength = 0) {
  checkSegments(segments);
  if (u === axis) throw new Error("u must be transverse to the axis");
  const R = radius / Math.cos(Math.PI / segments);
  const n = segments;
  const j = runLength > 0 ? n / 4 - 1 : keepIndex(n);
  const keepSet = /* @__PURE__ */ new Set([j, n / 2 - 1 - j, n / 2 + j, n - 1 - j]);
  const poly = [];
  for (let i = 0; i < n; i++) {
    const g2 = gonVertex(R, n, i);
    const plusU = g2.u > 0;
    poly.push({ u: g2.u + (plusU ? runLength : 0), v: g2.v, keep: keepSet.has(i) });
  }
  return bevelledPrism(center, axis, u, halfLength, poly);
}

// spikes/teeth/lib.ts
var G = 1226.25;
var DT = 1 / 480;
var ITER = 240;
var BASE_ITER = 30;
var FRICTION = 0.4;
var RESTITUTION = 0.1;
var HC2 = 0.46;
var ROD = 0.29;
var R_BORE = 0.31;
var PIVOT_MU = 0.2;
var FRICTION_GAIN = 1e9;
var ANG_X = 3;
var GRP = {
  TOOTH: 1 << 0,
  // gear teeth + root hub: seen by ordinary parts only
  GEARCYL: 1 << 1,
  // gear-vs-gear smooth cylinder just under pitch radius: seen by other gears only
  PART: 1 << 2
  // every ordinary part collider
};
var groups = (member, filter) => (member & 65535) << 16 | filter & 65535;
var G_TOOTH = groups(GRP.TOOTH, GRP.PART);
var G_GEARCYL = groups(GRP.GEARCYL, GRP.GEARCYL);
var G_PART = groups(GRP.PART, GRP.PART | GRP.TOOTH);
function gearSpec(r2, set2, profile = "trap") {
  const m = set2 === "fine" ? 0.125 : 0.25;
  const T = Math.round(2 * r2 / m);
  return { r: r2, T, m, add: m, ded: 1.25 * m, profile, name: `${set2}-${profile} r${r2} T${T}` };
}
var tipR = (g2) => g2.r + g2.add;
var rootR = (g2) => g2.r - g2.ded;
var pitchAngle = (g2) => 2 * Math.PI / g2.T;
var PA = 20 * Math.PI / 180;
function rootPoly(g2) {
  const n = Math.max(g2.T, 4);
  const R = rootR(g2) / Math.cos(Math.PI / n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * 2 * Math.PI;
    out.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return out;
}
function toothPoly(g2, k) {
  const D2 = pitchAngle(g2);
  const rt = tipR(g2);
  const rr = rootR(g2);
  if (g2.profile === "trap") {
    const p = g2.m * Math.PI;
    const w = (rho) => p / 4 - (rho - g2.r) * Math.tan(PA);
    const rb = rr - 0.03;
    const c2 = (k + 0.5) * D2;
    const loc = [
      [rb, -w(rb)],
      [rt, -w(rt)],
      [rt, w(rt)],
      [rb, w(rb)]
    ];
    return loc.map(([x, y]) => [x * Math.cos(c2) - y * Math.sin(c2), x * Math.sin(c2) + y * Math.cos(c2)]);
  }
  const Rv = rr / Math.cos(Math.PI / g2.T) - 0.02;
  const A = (k + 0.5) * D2;
  const B = (k + 1.5) * D2;
  const land = 0.04 / rt;
  const pol = (rho, a) => [rho * Math.cos(a), rho * Math.sin(a)];
  return [pol(Rv, B), pol(Rv, A), pol(rt, B - land), pol(rt, B)];
}
function gearPolys2D(g2) {
  const out = [rootPoly(g2)];
  for (let k = 0; k < g2.T; k++) out.push(toothPoly(g2, k));
  return out;
}
var prism2D = (poly, hz) => {
  const pts = new Float32Array(poly.length * 6);
  poly.forEach(([x, y], i) => {
    pts.set([x, y, -hz], i * 6);
    pts.set([x, y, hz], i * 6 + 3);
  });
  return pts;
};
function rootHull(g2) {
  const n = Math.max(g2.T, 4);
  const sh = prismShape([0, 0, 0], 2, rootR(g2), HC2, n, 0);
  if (sh.kind !== "hull") throw new Error("hull");
  const pts = new Float32Array(sh.points.length * 3);
  sh.points.forEach((q, i) => pts.set(q, i * 3));
  return pts;
}
function gearColliderDescs(g2, kind2, withGearCyl = true) {
  const out = [];
  if (kind2 === "cylinder" || kind2 === "root") {
    const R = kind2 === "cylinder" ? tipR(g2) : rootR(g2);
    const sh = prismShape([0, 0, 0], 2, R, HC2, 16, 0);
    const pts = new Float32Array(sh.points.flat());
    out.push(RAPIER.ColliderDesc.convexHull(pts).setCollisionGroups(G_PART).setDensity(1));
    return out.map(fin);
  }
  const hulls = [rootHull(g2)];
  for (let k = 0; k < g2.T; k++) hulls.push(prism2D(toothPoly(g2, k), HC2));
  if (kind2 === "teeth") {
    for (const h of hulls) {
      const d = RAPIER.ColliderDesc.convexHull(h);
      if (!d) throw new Error("hull failed");
      out.push(d.setCollisionGroups(G_TOOTH).setDensity(1));
    }
  } else {
    const shapes = hulls.map((h) => new RAPIER.ConvexPolyhedron(h, null));
    const id = { x: 0, y: 0, z: 0, w: 1 };
    out.push(RAPIER.ColliderDesc.compound(shapes, shapes.map(() => ({ x: 0, y: 0, z: 0 })), shapes.map(() => id)).setCollisionGroups(G_TOOTH).setDensity(1));
  }
  if (withGearCyl) {
    const sh = prismShape([0, 0, 0], 2, g2.r - 0.02, HC2, 16, 0);
    out.push(RAPIER.ColliderDesc.convexHull(new Float32Array(sh.points.flat())).setCollisionGroups(G_GEARCYL).setDensity(0));
  }
  return out.map(fin);
}
function fin(d) {
  return d.setFriction(FRICTION).setRestitution(RESTITUTION);
}
function pawlColliderDescs(kind2, l2) {
  const out = [];
  const hull = (sh) => RAPIER.ColliderDesc.convexHull(new Float32Array(sh.points.flat()));
  if (kind2 === "end" || kind2 === "side") {
    out.push(hull(prismShape([0, 0, 0], 2, HC2, HC2, 16, 0, l2)));
  } else if (kind2 === "rod") {
    out.push(hull(prismShape([0, 0, 1], 2, HC2, HC2, 16, 0, l2)));
    out.push(hull(prismShape([l2, 0, 0.51], 2, ROD, 0.99, 16, 0)));
  } else {
    if (l2 - 1 > 0) out.push(hull(prismShape([0, 0, 0], 2, HC2, HC2, 16, 0, l2 - 1)));
    else out.push(hull(prismShape([0, 0, 0], 2, HC2, HC2, 16, 0)));
    out.push(RAPIER.ColliderDesc.cuboid(0.25, HC2, HC2).setTranslation(l2 - 1 + 0.25, 0, 0));
    out.push(hull(prismShape([l2 - 0.02, 0, 0], 0, HC2, 0.48, 16, 1)));
  }
  return out.map((d) => d.setCollisionGroups(G_PART).setDensity(1).setFriction(FRICTION).setRestitution(RESTITUTION));
}
function makeWorld(o = {}) {
  const w = new RAPIER.World({ x: 0, y: -G, z: 0 });
  w.timestep = DT;
  w.numSolverIterations = BASE_ITER;
  w.numInternalPgsIterations = 1;
  w.integrationParameters.maxCcdSubsteps = o.ccd === "hard" ? 1 : 0;
  return w;
}
function fixedBody(w) {
  return w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
}
function jointedBody(w, p, alpha, descs) {
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(p[0], p[1], p[2]).setRotation({ x: 0, y: 0, z: Math.sin(alpha / 2), w: Math.cos(alpha / 2) }).setAdditionalSolverIterations(ITER - BASE_ITER)
  );
  for (const d of descs) w.createCollider(d, rb);
  decoupleZ(rb);
  return rb;
}
function revoluteZ(w, f, b, at) {
  const ft = f.translation();
  const bt = b.translation();
  const bq = b.rotation();
  const d = { x: at[0] - bt.x, y: at[1] - bt.y, z: at[2] - bt.z };
  const ang = 2 * Math.atan2(bq.z, bq.w);
  const c2 = Math.cos(-ang);
  const s = Math.sin(-ang);
  const loc = { x: c2 * d.x - s * d.y, y: s * d.x + c2 * d.y, z: d.z };
  const data = RAPIER.JointData.revolute({ x: at[0] - ft.x, y: at[1] - ft.y, z: at[2] - ft.z }, loc, { x: 0, y: 0, z: 1 });
  const j = w.createImpulseJoint(data, f, b, true);
  j.setContactsEnabled(false);
  return j;
}
function frictionMotor(w, j, torque) {
  const raw = w.impulseJoints.raw;
  raw.jointConfigureMotorModel(j.handle, ANG_X, 0);
  raw.jointConfigureMotorVelocity(j.handle, ANG_X, 0, FRICTION_GAIN);
  raw.jointSetMotorMaxForce(j.handle, ANG_X, torque);
}
function decoupleZ(rb) {
  const qf = rb.principalInertiaLocalFrame();
  const d = rb.principalInertia();
  const q = [qf.x, qf.y, qf.z, qf.w];
  const rot = (v) => {
    const [x, y, z, ww] = q;
    const tx = 2 * (y * v[2] - z * v[1]);
    const ty = 2 * (z * v[0] - x * v[2]);
    const tz = 2 * (x * v[1] - y * v[0]);
    return [v[0] + ww * tx + (y * tz - z * ty), v[1] + ww * ty + (z * tx - x * tz), v[2] + ww * tz + (x * ty - y * tx)];
  };
  const cols = [rot([1, 0, 0]), rot([0, 1, 0]), rot([0, 0, 1])];
  const dv = [d.x, d.y, d.z];
  const I = [];
  for (let r2 = 0; r2 < 3; r2++) for (let c2 = 0; c2 < 3; c2++) I.push(cols.reduce((s, e, k) => s + dv[k] * e[r2] * e[c2], 0));
  const tol = 1e-6 * (I[0] + I[4] + I[8]);
  if (Math.abs(I[2]) < tol && Math.abs(I[5]) < tol) return;
  const m = rb.mass();
  const com = rb.localCom();
  const Ibb = I[0];
  const Icc = I[4];
  const Ibc = I[1];
  const th = 0.5 * Math.atan2(2 * Ibc, Ibb - Icc);
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const lu = Ibb * cs * cs + 2 * Ibc * sn * cs + Icc * sn * sn;
  for (let i = 0; i < rb.numColliders(); i++) rb.collider(i).setDensity(0);
  rb.setAdditionalMassProperties(m, com, { x: lu, y: Ibb + Icc - lu, z: I[8] }, { x: 0, y: 0, z: Math.sin(th / 2), w: Math.cos(th / 2) }, true);
  rb.recomputeMassPropertiesFromColliders();
}
var angleZ = (rb) => {
  const q = rb.rotation();
  return 2 * Math.atan2(q.z, q.w);
};
var Unwrap = class {
  v;
  last;
  constructor(a0) {
    this.v = a0;
    this.last = a0;
  }
  push(a) {
    let d = a - this.last;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.last = a;
    this.v += d;
    return this.v;
  }
};
var now = () => performance.now();
var fmt = (x, d = 3) => Number.isFinite(x) ? x.toPrecision(d) : String(x);

// spikes/teeth/analytic.ts
function pawlPrims(kind2, l2) {
  if (kind2 === "end" || kind2 === "side") return [{ pts: [[0, 0], [l2, 0]], rad: HC2 }];
  if (kind2 === "rod") return [{ pts: [[l2, 0]], rad: ROD }];
  const out = [];
  out.push({ pts: l2 - 1 > 0 ? [[0, 0], [l2 - 1, 0]] : [[0, 0]], rad: HC2 });
  out.push({ pts: [[l2 - 1, -HC2], [l2 + HC2, -HC2], [l2 + HC2, HC2], [l2 - 1, HC2]], rad: 0 });
  return out;
}
var sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
var dot = (a, b) => a[0] * b[0] + a[1] * b[1];
var crs = (a, b) => a[0] * b[1] - a[1] * b[0];
function ptSeg(p, a, b) {
  const ab = sub(b, a);
  const L = dot(ab, ab);
  const t = L > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L)) : 0;
  return [a[0] + ab[0] * t, a[1] + ab[1] * t];
}
function edges(P) {
  if (P.length === 1) return [[P[0], P[0]]];
  if (P.length === 2) return [[P[0], P[1]]];
  return P.map((q, i) => [q, P[(i + 1) % P.length]]);
}
function separated(A, B) {
  const axes = [];
  for (const S of [A, B])
    for (const [a, b] of edges(S)) {
      const d = sub(b, a);
      if (d[0] !== 0 || d[1] !== 0) axes.push([-d[1], d[0]]);
    }
  if (axes.length === 0) return A[0][0] !== B[0][0] || A[0][1] !== B[0][1];
  for (const ax of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const q of A) {
      const v = dot(q, ax);
      a0 = Math.min(a0, v);
      a1 = Math.max(a1, v);
    }
    for (const q of B) {
      const v = dot(q, ax);
      b0 = Math.min(b0, v);
      b1 = Math.max(b1, v);
    }
    if (a1 < b0 || b1 < a0) return true;
  }
  return false;
}
function convexDist(A, B) {
  if (!separated(A, B)) return { d: 0, pa: A[0], pb: A[0] };
  let best = { d: Infinity, pa: A[0], pb: B[0] };
  for (const q of A)
    for (const [a, b] of edges(B)) {
      const c2 = ptSeg(q, a, b);
      const d = Math.hypot(q[0] - c2[0], q[1] - c2[1]);
      if (d < best.d) best = { d, pa: q, pb: c2 };
    }
  for (const q of B)
    for (const [a, b] of edges(A)) {
      const c2 = ptSeg(q, a, b);
      const d = Math.hypot(q[0] - c2[0], q[1] - c2[1]);
      if (d < best.d) best = { d, pa: c2, pb: q };
    }
  return best;
}
var Geo = class {
  constructor(s) {
    this.s = s;
    this.polys = gearPolys2D(s.g);
    this.prims = pawlPrims(s.kind, s.l);
    this.tr = tipR(s.g);
    this.primC = this.prims.map((q) => [q.pts.reduce((a, b) => a + b[0], 0) / q.pts.length, q.pts.reduce((a, b) => a + b[1], 0) / q.pts.length]);
    this.primR = this.prims.map((q, i) => Math.max(...q.pts.map((x) => Math.hypot(x[0] - this.primC[i][0], x[1] - this.primC[i][1]))) + q.rad);
  }
  polys;
  prims;
  tr;
  primR;
  primC;
  pawlPts(alpha, q) {
    const c2 = Math.cos(alpha), sn = Math.sin(alpha);
    return q.pts.map(([x, y]) => [this.s.p[0] + c2 * x - sn * y, this.s.p[1] + sn * x + c2 * y]);
  }
  gearPoly(i, phi) {
    const c2 = Math.cos(phi), sn = Math.sin(phi);
    return this.polys[i].map(([x, y]) => [c2 * x - sn * y, sn * x + c2 * y]);
  }
  /** Clearance (≤ 0 = touching/overlap) and the closest pair. */
  clearance(alpha, phi) {
    let best = { c: Infinity, pa: [0, 0], pb: [0, 0] };
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    this.prims.forEach((q, qi) => {
      const lc = this.primC[qi];
      const wc = [this.s.p[0] + ca * lc[0] - sa * lc[1], this.s.p[1] + sa * lc[0] + ca * lc[1]];
      if (Math.hypot(wc[0], wc[1]) - this.primR[qi] > this.tr + 0.05) return;
      const P = this.pawlPts(alpha, q);
      for (let i = 0; i < this.polys.length; i++) {
        const r2 = convexDist(P, this.gearPoly(i, phi));
        const c2 = r2.d - q.rad;
        if (c2 < best.c) best = { c: c2, pa: r2.pa, pb: r2.pb };
      }
    });
    return best;
  }
  /** Gravity moment about the pivot at α (sign = sense the weight turns the pawl). */
  Mg(alpha) {
    const [x, y] = this.s.comLocal;
    const wx = Math.cos(alpha) * x - Math.sin(alpha) * y;
    return -wx * this.s.mass * G;
  }
  comY(alpha) {
    const [x, y] = this.s.comLocal;
    return this.s.p[1] + Math.sin(alpha) * x + Math.cos(alpha) * y;
  }
  /** Rest angles at φ = 0: boundaries of the free α intervals into which the weight presses. */
  rests() {
    const N = 720;
    const free = [];
    for (let i = 0; i < N; i++) free.push(this.clearance(i / N * 2 * Math.PI, 0).c > 0);
    if (free.every((f) => f) || free.every((f) => !f)) return [];
    const out = [];
    for (let i = 0; i < N; i++) {
      const a = free[i], b = free[(i + 1) % N];
      if (a === b) continue;
      let lo = i / N * 2 * Math.PI, hi = (i + 1) / N * 2 * Math.PI;
      for (let k = 0; k < 40; k++) {
        const m = (lo + hi) / 2;
        if (this.clearance(m, 0).c > 0 === a) lo = m;
        else hi = m;
      }
      const sigma = a ? 1 : -1;
      const alpha = a ? lo : hi;
      if (sigma * this.Mg(alpha) > 0) out.push({ alpha, sigma });
    }
    return out;
  }
  /** Rest angle near `prev` (sense σ) at gear angle φ; NaN if none within 0.6 rad. */
  follow(prev, sigma, phi) {
    let a = prev - sigma * 0.02;
    let k = 0;
    while (this.clearance(a, phi).c <= 0) {
      a -= sigma * 0.02;
      if (++k > 30) return NaN;
    }
    let b = a;
    k = 0;
    while (this.clearance(b, phi).c > 0) {
      b += sigma * 4e-3;
      if (++k > 400) return NaN;
    }
    let lo = b - sigma * 4e-3, hi = b;
    for (let i = 0; i < 40; i++) {
      const m = (lo + hi) / 2;
      if (this.clearance(m, phi).c > 0) lo = m;
      else hi = m;
    }
    return lo;
  }
  /** Contact point (on the gear) and normal (gear → pawl) at a rest. */
  contact(alpha, phi) {
    const r2 = this.clearance(alpha, phi);
    const d = sub(r2.pa, r2.pb);
    const L = Math.hypot(d[0], d[1]) || 1;
    const rel = sub(r2.pa, this.s.p);
    const xArm = Math.cos(alpha) * rel[0] + Math.sin(alpha) * rel[1];
    return { k: r2.pb, n: [d[0] / L, d[1] / L], onEnd: xArm > this.s.l - 0.5 };
  }
};
function sweep(geo, rest2, s, mu, pitches = 2, perPitch = 40) {
  const D2 = 2 * Math.PI / geo.s.g.T;
  const h = D2 / perPitch;
  const mPivot = PIVOT_MU * geo.s.mass * G * R_BORE;
  let a = rest2.alpha;
  let peak = 0, peakU = 0, peakMu0 = 0;
  let rmin = Infinity, rmax = -Infinity;
  for (let i = 0; i < pitches * perPitch; i++) {
    const phi0 = s * i * h;
    const phi1 = s * (i + 1) * h;
    const a1 = geo.follow(a, rest2.sigma, phi1);
    if (!Number.isFinite(a1)) return { peak: 0, peakU: 0, peakMu0: 0, dip: NaN };
    const { k, n } = geo.contact(a, phi0);
    const rk = Math.hypot(k[0], k[1]);
    rmin = Math.min(rmin, rk);
    rmax = Math.max(rmax, rk);
    const da = a1 - a;
    const dU = geo.s.mass * G * (geo.comY(a1) - geo.comY(a)) / h;
    if (Math.abs(da) < 0.3) peakU = Math.max(peakU, dU);
    const Mg = geo.Mg(a);
    const lift = da * Mg < 0;
    for (const [m, isMu] of [[mu, true], [0, false]]) {
      const vg = [-s * k[1], s * k[0]];
      const kp = sub(k, geo.s.p);
      const vp = [-da / h * kp[1], da / h * kp[0]];
      const vr = sub(vg, vp);
      const vn = dot(vr, n);
      const t = [vr[0] - vn * n[0], vr[1] - vn * n[1]];
      const tl = Math.hypot(t[0], t[1]);
      const th = tl > 1e-9 ? [t[0] / tl, t[1] / tl] : [0, 0];
      const f = [n[0] + m * th[0], n[1] + m * th[1]];
      const mc = crs(kp, f);
      const Mpf = Math.abs(da) > 1e-12 ? -Math.sign(da) * (isMu ? mPivot : 0) : 0;
      const lam = -(Mg + Mpf) / mc;
      let tau;
      if (!(lam > 0) || !Number.isFinite(lam)) tau = lift ? Infinity : 0;
      else tau = s * crs(k, [lam * f[0], lam * f[1]]);
      if (Math.abs(da) > 0.3) tau = lift ? Infinity : 0;
      if (isMu) peak = Math.max(peak, tau);
      else peakMu0 = Math.max(peakMu0, tau);
    }
    a = a1;
  }
  return { peak, peakU, peakMu0, dip: rmax - rmin };
}

// spikes/teeth/ratchet.ts
import { writeFileSync, mkdirSync } from "node:fs";
var massCache = /* @__PURE__ */ new Map();
function pawlMass(kind2, l2) {
  const key = `${kind2}${l2}`;
  if (!massCache.has(key)) {
    const w = makeWorld();
    const rb = jointedBody(w, [0, 0, 0], 0, pawlColliderDescs(kind2, l2));
    const c2 = rb.localCom();
    massCache.set(key, { mass: rb.mass(), com: [c2.x, c2.y] });
    w.free();
  }
  return massCache.get(key);
}
function candidates(g2, kind2, lmax = 4) {
  const out = [];
  const tr = tipR(g2);
  for (let l2 = 1; l2 <= lmax; l2++) {
    if (kind2 === "corner" && l2 < 1) continue;
    const { mass, com } = pawlMass(kind2, l2);
    const reach = l2 + 0.5 + tr;
    const R = Math.ceil(reach);
    for (let px2 = -R; px2 <= R; px2++)
      for (let py2 = -R; py2 <= R; py2++) {
        const d = Math.hypot(px2, py2);
        if (d > reach) continue;
        if (kind2 !== "rod" && d < tr + 0.47) continue;
        if (kind2 === "rod" && d < 1) continue;
        const geo = new Geo({ g: g2, kind: kind2, l: l2, p: [px2, py2], mass, comLocal: com });
        for (const r2 of geo.rests()) {
          const ct = geo.contact(r2.alpha, 0);
          out.push({ g: g2, kind: kind2, l: l2, p: [px2, py2], alpha: r2.alpha, sigma: r2.sigma, mass, com, onEnd: ct.onEnd });
        }
      }
  }
  return out;
}
function geoOf(c2) {
  return new Geo({ g: c2.g, kind: c2.kind, l: c2.l, p: c2.p, mass: c2.mass, comLocal: c2.com });
}
function buildScene(c2, o = {}) {
  const w = makeWorld({ ccd: o.ccd });
  const f = fixedBody(w);
  const gear = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(c2.g, o.gearColliders ?? "teeth"));
  const jg = revoluteZ(w, f, gear, [0, 0, 0]);
  const a0 = c2.alpha - c2.sigma * 3e-3;
  const pawl = jointedBody(w, [c2.p[0], c2.p[1], 0], a0, pawlColliderDescs(c2.kind, c2.l));
  const jp = revoluteZ(w, f, pawl, [c2.p[0], c2.p[1], 0]);
  const tfp = PIVOT_MU * pawl.mass() * G * R_BORE;
  frictionMotor(w, jp, tfp);
  if (o.ccd === "hard") {
    gear.enableCcd(true);
    if (o.pawlCcd !== false) pawl.enableCcd(true);
  }
  if (o.ccd === "soft") {
    gear.setSoftCcdPrediction(400 * DT * 1.25);
    pawl.setSoftCcdPrediction(400 * DT * 1.25);
  }
  return { w, f, gear, pawl, jg, jp, tfp };
}
function settle(sc, c2, steps = 120) {
  for (let i = 0; i < steps; i++) sc.w.step();
  const a = angleZ(sc.pawl);
  if (!Number.isFinite(a)) return false;
  let d = a - c2.alpha;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) < 0.15;
}
function ramp(sc, c2, s, tauA, dec = 0.5, tMax = 3.5) {
  const D2 = 2 * Math.PI / c2.g.T;
  const ug = new Unwrap(angleZ(sc.gear));
  const g0 = ug.v;
  const up = new Unwrap(angleZ(sc.pawl));
  const p0 = up.v;
  let lift = 0;
  const n = Math.round(tMax / DT);
  for (let i = 0; i < n; i++) {
    const t = i * DT;
    const tau = s * tauA * Math.pow(10, t / dec);
    sc.gear.resetTorques(false);
    sc.gear.addTorque({ x: 0, y: 0, z: tau }, true);
    sc.w.step();
    const th = ug.push(angleZ(sc.gear));
    const pa = up.push(angleZ(sc.pawl));
    if (!Number.isFinite(th)) return { tau: NaN, lift, t };
    lift = Math.max(lift, -c2.sigma * (pa - p0));
    if (s * (th - g0) > D2) return { tau: Math.abs(tau), lift, t };
  }
  sc.gear.resetTorques(false);
  return { tau: Infinity, lift, t: tMax };
}
function simRamp(c2, s, o = {}, dec = 0.5) {
  const sc = buildScene(c2, o);
  const ok = settle(sc, c2);
  if (!ok) {
    sc.w.free();
    return { tau: NaN, lift: 0, t: 0, settled: false };
  }
  const r2 = ramp(sc, c2, s, 1e-3 * c2.mass * G, dec);
  sc.w.free();
  return { ...r2, settled: true };
}
var SETS = [
  ["fine", "trap"],
  ["coarse", "trap"],
  ["fine", "saw"],
  ["coarse", "saw"]
];
var KINDS = ["end", "rod", "corner"];
var RS = [0.5, 1, 1.5, 2.5];
async function search(args) {
  await RAPIER.init();
  const setF = args[0], profF = args[1], rF = args[2] ? Number(args[2]) : void 0, kindF = args[3];
  mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
  const all = [];
  for (const [set2, prof2] of SETS) {
    if (setF && setF !== set2) continue;
    if (profF && profF !== prof2) continue;
    for (const r2 of RS) {
      if (rF !== void 0 && rF !== r2) continue;
      const g2 = gearSpec(r2, set2, prof2);
      for (const kind2 of KINDS) {
        if (kindF && kindF !== kind2) continue;
        const t0 = now();
        const cs = candidates(g2, kind2);
        const rows = [];
        for (const c2 of cs) {
          const geo = geoOf(c2);
          const rest2 = { alpha: c2.alpha, sigma: c2.sigma };
          const sp = sweep(geo, rest2, 1, 0.4);
          const sm = sweep(geo, rest2, -1, 0.4);
          const tau02 = c2.mass * G;
          rows.push({ c: c2, ap: sp.peak / tau02, am: sm.peak / tau02, ap0: sp.peakMu0 / tau02, am0: sm.peakMu0 / tau02, apU: sp.peakU / tau02, amU: sm.peakU / tau02, dip: Math.max(sp.dip, sm.dip) });
        }
        const tA = now() - t0;
        let k = 0;
        for (const row of rows) {
          const lo = Math.min(row.ap, row.am), hi = Math.max(row.ap, row.am);
          row.analyticRatchet = hi >= 10 * Math.max(lo, 1e-3) && lo < 5;
          if (!row.analyticRatchet && k++ % 6 !== 0) continue;
          const tau02 = row.c.mass * G;
          const rp = simRamp(row.c, 1);
          const rm = simRamp(row.c, -1);
          row.sp = rp.tau / tau02;
          row.sm = rm.tau / tau02;
          row.liftP = rp.lift;
          row.liftM = rm.lift;
          row.settled = rp.settled && rm.settled;
        }
        const tS = now() - t0 - tA;
        let nR = 0, nSimR = 0, agree = 0, nSim = 0;
        for (const row of rows) {
          if (row.analyticRatchet) nR++;
          if (row.sp === void 0 || !row.settled) continue;
          nSim++;
          const lo = Math.min(row.sp, row.sm), hi = Math.max(row.sp, row.sm);
          row.simRatchet = hi >= 10 * lo && lo < 5;
          if (row.simRatchet) nSimR++;
          if (row.simRatchet === row.analyticRatchet) agree++;
        }
        console.log(`${g2.name.padEnd(20)} ${kind2.padEnd(6)} cands ${String(rows.length).padStart(4)} analyticRatchets ${String(nR).padStart(3)} simulated ${String(nSim).padStart(3)} simRatchets ${String(nSimR).padStart(3)} agree ${agree}/${nSim}  (${(tA / 1e3).toFixed(1)} s + ${(tS / 1e3).toFixed(1)} s)`);
        for (const row of rows) {
          all.push({
            set: set2,
            prof: prof2,
            r: r2,
            T: g2.T,
            kind: kind2,
            l: row.c.l,
            px: row.c.p[0],
            py: row.c.p[1],
            alpha: row.c.alpha,
            sigma: row.c.sigma,
            onEnd: row.c.onEnd,
            mass: row.c.mass,
            ap: row.ap,
            am: row.am,
            ap0: row.ap0,
            am0: row.am0,
            apU: row.apU,
            amU: row.amU,
            dip: row.dip,
            analyticRatchet: row.analyticRatchet,
            sp: row.sp,
            sm: row.sm,
            liftP: row.liftP,
            liftM: row.liftM,
            settled: row.settled,
            simRatchet: row.simRatchet
          });
        }
      }
    }
  }
  const tag = [setF, profF, rF, kindF].filter((x) => x !== void 0).join("-") || "all";
  writeFileSync(new URL(`./results/search-${tag}.json`, import.meta.url), JSON.stringify(all, (_k, v) => v === Infinity ? "Infinity" : v));
}
async function one(args) {
  await RAPIER.init();
  const [set2, prof2, r2, kind2, l2, px2, py2, ri] = args;
  const g2 = gearSpec(Number(r2), set2, prof2);
  const cs = candidates(g2, kind2).filter((c3) => c3.l === Number(l2) && c3.p[0] === Number(px2) && c3.p[1] === Number(py2));
  const c2 = cs[Number(ri ?? 0)];
  console.log(c2);
  const geo = geoOf(c2);
  for (const s of [1, -1]) {
    const sw = sweep(geo, c2, s, 0.4);
    const sw0 = sweep(geo, c2, s, 0);
    const r1 = simRamp(c2, s);
    console.log(`s=${s}: analytic \u03BC0.4 ${fmt(sw.peak / (c2.mass * G))} \u03C40, \u03BC0 ${fmt(sw0.peakMu0 / (c2.mass * G))} \u03C40 (dU/d\u03C6 ${fmt(sw.peakU / (c2.mass * G))}), dip ${fmt(sw.dip)}; sim ${fmt(r1.tau / (c2.mass * G))} \u03C40 lift ${fmt(r1.lift)} rad`);
  }
}
var [mode, ...rest] = process.argv.slice(2);
if (mode === "search") await search(rest);
else if (mode === "one") await one(rest);

// spikes/teeth/holddiag.ts
await RAPIER.init();
var [set, prof, r, kind, l, px, py, sg, sl, secs, list] = process.argv.slice(2);
var g = gearSpec(Number(r), set, prof);
var c = candidates(g, kind, Number(l)).find((q) => q.l === Number(l) && q.p[0] === Number(px) && q.p[1] === Number(py) && q.sigma === Number(sg));
var sLock = Number(sl);
var seconds = Number(secs ?? 60);
var D = 2 * Math.PI / g.T;
var tau0 = c.mass * G;
for (const k of (list ?? "1,2,3.5,5,10,19").split(",").map(Number)) {
  const sc = buildScene(c);
  if (process.env.NF) sc.w.integrationParameters.contact_natural_frequency = Number(process.env.NF);
  if (process.env.ERR) sc.w.integrationParameters.normalizedAllowedLinearError = Number(process.env.ERR);
  settle(sc, c);
  const marks = [];
  const u = new Unwrap(angleZ(sc.gear));
  const g0 = u.v;
  const up = new Unwrap(angleZ(sc.pawl));
  const p0 = up.v;
  let tFail = NaN, pen = 0, liftAtFail = 0;
  const pawlCol = sc.pawl.collider(0);
  const n = Math.round(seconds / DT);
  let gAt1 = 0;
  for (let i = 0; i < n; i++) {
    sc.gear.resetTorques(false);
    sc.gear.addTorque({ x: 0, y: 0, z: sLock * k * tau0 }, true);
    sc.w.step();
    const th = u.push(angleZ(sc.gear));
    const pa = up.push(angleZ(sc.pawl));
    if (i === 480) gAt1 = th;
    if ([479, 2399, 4799, 9599, 19199, 28799].includes(i)) marks.push(`t${Math.round((i + 1) * DT)}s:${fmt(pen, 2)}/${fmt((th - g0) / D, 2)}p`);
    for (let ci = 0; ci < sc.pawl.numColliders(); ci++)
      sc.w.contactPairsWith(
        sc.pawl.collider(ci),
        (c2) => sc.w.contactPair(sc.pawl.collider(ci), c2, (m) => {
          for (let j = 0; j < m.numContacts(); j++) pen = Math.max(pen, -m.contactDist(j));
        })
      );
    if (sLock * (th - g0) > D) {
      tFail = (i + 1) * DT;
      liftAtFail = -c.sigma * (pa - p0);
      break;
    }
  }
  void pawlCol;
  console.log(`\u03C4 = ${k} \u03C40 (${fmt(k * tau0)}): ${Number.isNaN(tFail) ? `held ${seconds} s, creep after 1 s ${fmt((u.v - gAt1) / D)} pitch` : `failed at ${fmt(tFail)} s, pawl lift then ${fmt(liftAtFail)} rad`}; max penetration ${fmt(pen)} u  [${marks.join(" ")}]`);
  sc.w.free();
}
