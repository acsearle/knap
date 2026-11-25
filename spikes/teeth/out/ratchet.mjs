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
    const c = x0 * y1 - x1 * y0;
    A += c / 2;
    cu += (x0 + x1) * c / 6;
    cv += (y0 + y1) * c / 6;
    Su2 += (x0 * x0 + x0 * x1 + x1 * x1) * c / 12;
    Sv2 += (y0 * y0 + y0 * y1 + y1 * y1) * c / 12;
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
    const g = gonVertex(R, n, i);
    const plusU = g.u > 0;
    poly.push({ u: g.u + (plusU ? runLength : 0), v: g.v, keep: keepSet.has(i) });
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
function gearSpec(r, set, profile = "trap") {
  const m = set === "fine" ? 0.125 : 0.25;
  const T = Math.round(2 * r / m);
  return { r, T, m, add: m, ded: 1.25 * m, profile, name: `${set}-${profile} r${r} T${T}` };
}
var tipR = (g) => g.r + g.add;
var rootR = (g) => g.r - g.ded;
var pitchAngle = (g) => 2 * Math.PI / g.T;
var PA = 20 * Math.PI / 180;
function rootPoly(g) {
  const n = Math.max(g.T, 4);
  const R = rootR(g) / Math.cos(Math.PI / n);
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * 2 * Math.PI;
    out.push([R * Math.cos(a), R * Math.sin(a)]);
  }
  return out;
}
function toothPoly(g, k) {
  const D = pitchAngle(g);
  const rt = tipR(g);
  const rr = rootR(g);
  if (g.profile === "trap") {
    const p = g.m * Math.PI;
    const w = (rho) => p / 4 - (rho - g.r) * Math.tan(PA);
    const rb = rr - 0.03;
    const c = (k + 0.5) * D;
    const loc = [
      [rb, -w(rb)],
      [rt, -w(rt)],
      [rt, w(rt)],
      [rb, w(rb)]
    ];
    return loc.map(([x, y]) => [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]);
  }
  const Rv = rr / Math.cos(Math.PI / g.T) - 0.02;
  const A = (k + 0.5) * D;
  const B = (k + 1.5) * D;
  const land = 0.04 / rt;
  const pol = (rho, a) => [rho * Math.cos(a), rho * Math.sin(a)];
  return [pol(Rv, B), pol(Rv, A), pol(rt, B - land), pol(rt, B)];
}
function gearPolys2D(g) {
  const out = [rootPoly(g)];
  for (let k = 0; k < g.T; k++) out.push(toothPoly(g, k));
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
function rootHull(g) {
  const n = Math.max(g.T, 4);
  const sh = prismShape([0, 0, 0], 2, rootR(g), HC2, n, 0);
  if (sh.kind !== "hull") throw new Error("hull");
  const pts = new Float32Array(sh.points.length * 3);
  sh.points.forEach((q, i) => pts.set(q, i * 3));
  return pts;
}
function gearColliderDescs(g, kind, withGearCyl = true) {
  const out = [];
  if (kind === "cylinder" || kind === "root") {
    const R = kind === "cylinder" ? tipR(g) : rootR(g);
    const sh = prismShape([0, 0, 0], 2, R, HC2, 16, 0);
    const pts = new Float32Array(sh.points.flat());
    out.push(RAPIER.ColliderDesc.convexHull(pts).setCollisionGroups(G_PART).setDensity(1));
    return out.map(fin);
  }
  const hulls = [rootHull(g)];
  for (let k = 0; k < g.T; k++) hulls.push(prism2D(toothPoly(g, k), HC2));
  if (kind === "teeth") {
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
    const sh = prismShape([0, 0, 0], 2, g.r - 0.02, HC2, 16, 0);
    out.push(RAPIER.ColliderDesc.convexHull(new Float32Array(sh.points.flat())).setCollisionGroups(G_GEARCYL).setDensity(0));
  }
  return out.map(fin);
}
function fin(d) {
  return d.setFriction(FRICTION).setRestitution(RESTITUTION);
}
function pawlColliderDescs(kind, l) {
  const out = [];
  const hull = (sh) => RAPIER.ColliderDesc.convexHull(new Float32Array(sh.points.flat()));
  if (kind === "end" || kind === "side") {
    out.push(hull(prismShape([0, 0, 0], 2, HC2, HC2, 16, 0, l)));
  } else if (kind === "rod") {
    out.push(hull(prismShape([0, 0, 1], 2, HC2, HC2, 16, 0, l)));
    out.push(hull(prismShape([l, 0, 0.51], 2, ROD, 0.99, 16, 0)));
  } else {
    if (l - 1 > 0) out.push(hull(prismShape([0, 0, 0], 2, HC2, HC2, 16, 0, l - 1)));
    else out.push(hull(prismShape([0, 0, 0], 2, HC2, HC2, 16, 0)));
    out.push(RAPIER.ColliderDesc.cuboid(0.25, HC2, HC2).setTranslation(l - 1 + 0.25, 0, 0));
    out.push(hull(prismShape([l - 0.02, 0, 0], 0, HC2, 0.48, 16, 1)));
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
  const c = Math.cos(-ang);
  const s = Math.sin(-ang);
  const loc = { x: c * d.x - s * d.y, y: s * d.x + c * d.y, z: d.z };
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
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) I.push(cols.reduce((s, e, k) => s + dv[k] * e[r] * e[c], 0));
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
function pawlPrims(kind, l) {
  if (kind === "end" || kind === "side") return [{ pts: [[0, 0], [l, 0]], rad: HC2 }];
  if (kind === "rod") return [{ pts: [[l, 0]], rad: ROD }];
  const out = [];
  out.push({ pts: l - 1 > 0 ? [[0, 0], [l - 1, 0]] : [[0, 0]], rad: HC2 });
  out.push({ pts: [[l - 1, -HC2], [l + HC2, -HC2], [l + HC2, HC2], [l - 1, HC2]], rad: 0 });
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
    const c = Math.cos(alpha), sn = Math.sin(alpha);
    return q.pts.map(([x, y]) => [this.s.p[0] + c * x - sn * y, this.s.p[1] + sn * x + c * y]);
  }
  gearPoly(i, phi) {
    const c = Math.cos(phi), sn = Math.sin(phi);
    return this.polys[i].map(([x, y]) => [c * x - sn * y, sn * x + c * y]);
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
        const r = convexDist(P, this.gearPoly(i, phi));
        const c = r.d - q.rad;
        if (c < best.c) best = { c, pa: r.pa, pb: r.pb };
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
    const r = this.clearance(alpha, phi);
    const d = sub(r.pa, r.pb);
    const L = Math.hypot(d[0], d[1]) || 1;
    const rel = sub(r.pa, this.s.p);
    const xArm = Math.cos(alpha) * rel[0] + Math.sin(alpha) * rel[1];
    return { k: r.pb, n: [d[0] / L, d[1] / L], onEnd: xArm > this.s.l - 0.5 };
  }
};
function sweep(geo, rest2, s, mu, pitches = 2, perPitch = 40) {
  const D = 2 * Math.PI / geo.s.g.T;
  const h = D / perPitch;
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
function pawlMass(kind, l) {
  const key = `${kind}${l}`;
  if (!massCache.has(key)) {
    const w = makeWorld();
    const rb = jointedBody(w, [0, 0, 0], 0, pawlColliderDescs(kind, l));
    const c = rb.localCom();
    massCache.set(key, { mass: rb.mass(), com: [c.x, c.y] });
    w.free();
  }
  return massCache.get(key);
}
function candidates(g, kind, lmax = 4) {
  const out = [];
  const tr = tipR(g);
  for (let l = 1; l <= lmax; l++) {
    if (kind === "corner" && l < 1) continue;
    const { mass, com } = pawlMass(kind, l);
    const reach = l + 0.5 + tr;
    const R = Math.ceil(reach);
    for (let px = -R; px <= R; px++)
      for (let py = -R; py <= R; py++) {
        const d = Math.hypot(px, py);
        if (d > reach) continue;
        if (kind !== "rod" && d < tr + 0.47) continue;
        if (kind === "rod" && d < 1) continue;
        const geo = new Geo({ g, kind, l, p: [px, py], mass, comLocal: com });
        for (const r of geo.rests()) {
          const ct = geo.contact(r.alpha, 0);
          out.push({ g, kind, l, p: [px, py], alpha: r.alpha, sigma: r.sigma, mass, com, onEnd: ct.onEnd });
        }
      }
  }
  return out;
}
function geoOf(c) {
  return new Geo({ g: c.g, kind: c.kind, l: c.l, p: c.p, mass: c.mass, comLocal: c.com });
}
function buildScene(c, o = {}) {
  const w = makeWorld({ ccd: o.ccd });
  const f = fixedBody(w);
  const gear = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(c.g, o.gearColliders ?? "teeth"));
  const jg = revoluteZ(w, f, gear, [0, 0, 0]);
  const a0 = c.alpha - c.sigma * 3e-3;
  const pawl = jointedBody(w, [c.p[0], c.p[1], 0], a0, pawlColliderDescs(c.kind, c.l));
  const jp = revoluteZ(w, f, pawl, [c.p[0], c.p[1], 0]);
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
function settle(sc, c, steps = 120) {
  for (let i = 0; i < steps; i++) sc.w.step();
  const a = angleZ(sc.pawl);
  if (!Number.isFinite(a)) return false;
  let d = a - c.alpha;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return Math.abs(d) < 0.15;
}
function ramp(sc, c, s, tauA, dec = 0.5, tMax = 3.5) {
  const D = 2 * Math.PI / c.g.T;
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
    lift = Math.max(lift, -c.sigma * (pa - p0));
    if (s * (th - g0) > D) return { tau: Math.abs(tau), lift, t };
  }
  sc.gear.resetTorques(false);
  return { tau: Infinity, lift, t: tMax };
}
function simRamp(c, s, o = {}, dec = 0.5) {
  const sc = buildScene(c, o);
  const ok = settle(sc, c);
  if (!ok) {
    sc.w.free();
    return { tau: NaN, lift: 0, t: 0, settled: false };
  }
  const r = ramp(sc, c, s, 1e-3 * c.mass * G, dec);
  sc.w.free();
  return { ...r, settled: true };
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
  for (const [set, prof] of SETS) {
    if (setF && setF !== set) continue;
    if (profF && profF !== prof) continue;
    for (const r of RS) {
      if (rF !== void 0 && rF !== r) continue;
      const g = gearSpec(r, set, prof);
      for (const kind of KINDS) {
        if (kindF && kindF !== kind) continue;
        const t0 = now();
        const cs = candidates(g, kind);
        const rows = [];
        for (const c of cs) {
          const geo = geoOf(c);
          const rest2 = { alpha: c.alpha, sigma: c.sigma };
          const sp = sweep(geo, rest2, 1, 0.4);
          const sm = sweep(geo, rest2, -1, 0.4);
          const tau0 = c.mass * G;
          rows.push({ c, ap: sp.peak / tau0, am: sm.peak / tau0, ap0: sp.peakMu0 / tau0, am0: sm.peakMu0 / tau0, apU: sp.peakU / tau0, amU: sm.peakU / tau0, dip: Math.max(sp.dip, sm.dip) });
        }
        const tA = now() - t0;
        let k = 0;
        for (const row of rows) {
          const lo = Math.min(row.ap, row.am), hi = Math.max(row.ap, row.am);
          row.analyticRatchet = hi >= 10 * Math.max(lo, 1e-3) && lo < 5;
          if (!row.analyticRatchet && k++ % 6 !== 0) continue;
          const tau0 = row.c.mass * G;
          const rp = simRamp(row.c, 1);
          const rm = simRamp(row.c, -1);
          row.sp = rp.tau / tau0;
          row.sm = rm.tau / tau0;
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
        console.log(`${g.name.padEnd(20)} ${kind.padEnd(6)} cands ${String(rows.length).padStart(4)} analyticRatchets ${String(nR).padStart(3)} simulated ${String(nSim).padStart(3)} simRatchets ${String(nSimR).padStart(3)} agree ${agree}/${nSim}  (${(tA / 1e3).toFixed(1)} s + ${(tS / 1e3).toFixed(1)} s)`);
        for (const row of rows) {
          all.push({
            set,
            prof,
            r,
            T: g.T,
            kind,
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
  const [set, prof, r, kind, l, px, py, ri] = args;
  const g = gearSpec(Number(r), set, prof);
  const cs = candidates(g, kind).filter((c2) => c2.l === Number(l) && c2.p[0] === Number(px) && c2.p[1] === Number(py));
  const c = cs[Number(ri ?? 0)];
  console.log(c);
  const geo = geoOf(c);
  for (const s of [1, -1]) {
    const sw = sweep(geo, c, s, 0.4);
    const sw0 = sweep(geo, c, s, 0);
    const r1 = simRamp(c, s);
    console.log(`s=${s}: analytic \u03BC0.4 ${fmt(sw.peak / (c.mass * G))} \u03C40, \u03BC0 ${fmt(sw0.peakMu0 / (c.mass * G))} \u03C40 (dU/d\u03C6 ${fmt(sw.peakU / (c.mass * G))}), dip ${fmt(sw.dip)}; sim ${fmt(r1.tau / (c.mass * G))} \u03C40 lift ${fmt(r1.lift)} rad`);
  }
}
var [mode, ...rest] = process.argv.slice(2);
if (mode === "search") await search(rest);
else if (mode === "one") await one(rest);
export {
  buildScene,
  candidates,
  geoOf,
  pawlMass,
  ramp,
  settle,
  simRamp
};
