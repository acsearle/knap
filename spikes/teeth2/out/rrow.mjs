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
function bevelledPrism(center, axis, u, halfLength, poly, bevel = BEVEL) {
  const v = 3 - axis - u;
  const points = [];
  for (const q of poly)
    for (const s of [-1, 1]) {
      const p = [center[0], center[1], center[2]];
      p[u] += q.u;
      p[v] += q.v;
      p[axis] += s * (q.keep ? halfLength : halfLength - bevel);
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
function prismShape(center, axis, radius, halfLength, segments, u, runLength = 0, bevel = BEVEL) {
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
  return bevelledPrism(center, axis, u, halfLength, poly, bevel);
}

// spikes/teeth2/lib.ts
var G = 1226.25;
var DT = 1 / 480;
var ITER = 240;
var BASE_ITER = 30;
var HC2 = 0.46;
var R_BORE = 0.31;
var ANG_X = 3;
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
function toothPoly(g2, k) {
  const p = MOD * Math.PI;
  const w = (rho) => p / 4 - (rho - g2.r) * Math.tan(PA);
  const rb = g2.root - 0.03;
  const c = (k + 0.5) * g2.D;
  const loc = [
    [rb, -w(rb)],
    [g2.tip, -w(g2.tip)],
    [g2.tip, w(g2.tip)],
    [rb, w(rb)]
  ];
  return loc.map(([x, y]) => [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]);
}
var prismPts = (poly, hz) => {
  const a = new Float32Array(poly.length * 6);
  poly.forEach(([x, y], i) => {
    a.set([x, y, -hz], i * 6);
    a.set([x, y, hz], i * 6 + 3);
  });
  return a;
};
var hullPts = (sh) => new Float32Array(sh.points.flat());
var rootHull = (g2) => hullPts(prismShape([0, 0, 0], 2, g2.root, HC2, g2.T, 0));
var smoothHull = (R) => hullPts(prismShape([0, 0, 0], 2, R, HC2, 32, 0, 0, 0.02 * R));
function outline(g2) {
  const out = [];
  const Rr = g2.root / Math.cos(Math.PI / g2.T);
  for (let k = 0; k < g2.T; k++) {
    const a0 = k * g2.D;
    out.push([g2.root * Math.cos(a0), g2.root * Math.sin(a0)]);
    const t = toothPoly(g2, k);
    const lift = (pt, toward) => {
      for (let s = 0; s <= 1; s += 0.02) {
        const q = [pt[0] + (toward[0] - pt[0]) * s, pt[1] + (toward[1] - pt[1]) * s];
        if (Math.hypot(q[0], q[1]) >= g2.root + 0.01) return q;
      }
      return toward;
    };
    out.push(lift(t[0], t[1]), t[1], t[2], lift(t[3], t[2]));
  }
  void Rr;
  return out;
}
function gearDescs(g2, o) {
  const out = [];
  const tg = o.toothGroup ?? G_TOOTH;
  const fin = (d) => d.setFriction(o.friction ?? 0.4).setRestitution(0.1).setDensity(0).setCollisionGroups(tg);
  const hulls = () => {
    const hs = [rootHull(g2)];
    for (let k = 0; k < g2.T; k += o.rep === "half" ? 2 : 1) hs.push(prismPts(toothPoly(g2, k), HC2));
    return hs;
  };
  switch (o.rep) {
    case "hull":
    case "half":
      for (const h of hulls()) out.push(fin(RAPIER.ColliderDesc.convexHull(h)));
      break;
    case "compound": {
      const shapes = hulls().map((h) => new RAPIER.ConvexPolyhedron(h, null));
      out.push(fin(RAPIER.ColliderDesc.compound(shapes, shapes.map(() => ({ x: 0, y: 0, z: 0 })), shapes.map(() => ({ x: 0, y: 0, z: 0, w: 1 })))));
      break;
    }
    case "box":
    case "capsule": {
      out.push(fin(RAPIER.ColliderDesc.convexHull(rootHull(g2))));
      const p = MOD * Math.PI;
      const rb = g2.root - 0.03;
      for (let k = 0; k < g2.T; k++) {
        const c = (k + 0.5) * g2.D;
        const q = { x: 0, y: 0, z: Math.sin(c / 2), w: Math.cos(c / 2) };
        if (o.rep === "box") {
          const hw = p / 4 - ((g2.tip + rb) / 2 - g2.r) * Math.tan(PA);
          const hr = (g2.tip - rb) / 2;
          const m = (g2.tip + rb) / 2;
          out.push(fin(RAPIER.ColliderDesc.cuboid(hr, hw, HC2).setTranslation(m * Math.cos(c), m * Math.sin(c), 0).setRotation(q)));
        } else {
          const rad = p / 4 - (g2.tip - 0.06 - g2.r) * Math.tan(PA) + 0.01;
          const m = g2.tip - rad;
          const qz2 = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
          out.push(fin(RAPIER.ColliderDesc.capsule(HC2 - rad, rad).setTranslation(m * Math.cos(c), m * Math.sin(c), 0).setRotation(qz2)));
        }
      }
      break;
    }
    case "trimesh": {
      const ol = outline(g2);
      const n = ol.length;
      const v = [];
      for (const [x, y] of ol) v.push(x, y, -HC2);
      for (const [x, y] of ol) v.push(x, y, HC2);
      v.push(0, 0, -HC2, 0, 0, HC2);
      const cb = 2 * n, ct = 2 * n + 1;
      const idx = [];
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        idx.push(i, j, n + j, i, n + j, n + i);
        idx.push(cb, j, i);
        idx.push(ct, n + i, n + j);
      }
      out.push(fin(RAPIER.ColliderDesc.trimesh(new Float32Array(v), new Uint32Array(idx))));
      break;
    }
    case "polyline": {
      const ol = outline(g2);
      const v = [];
      for (const [x, y] of ol) v.push(x, y, 0);
      v.push(ol[0][0], ol[0][1], 0);
      out.push(fin(RAPIER.ColliderDesc.polyline(new Float32Array(v))));
      break;
    }
    case "smooth":
      out.push(fin(RAPIER.ColliderDesc.convexHull(smoothHull(g2.tip))));
      break;
    case "none":
      break;
  }
  if (o.smooth) out.push(RAPIER.ColliderDesc.convexHull(smoothHull(g2.tip - 0.02)).setDensity(0).setFriction(0.4).setRestitution(0.1).setCollisionGroups(o.smoothGroup ?? G_SMOOTH));
  const qz = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
  out.push(RAPIER.ColliderDesc.cylinder(HC2, Math.max(g2.r, 0.47)).setRotation(qz).setDensity(1).setCollisionGroups(G_NONE));
  return out;
}
function makeWorld(o = {}) {
  const w = new RAPIER.World({ x: 0, y: -G, z: 0 });
  w.timestep = o.dt ?? DT;
  w.numSolverIterations = Math.min(BASE_ITER, o.iters ?? ITER);
  w.numInternalPgsIterations = 1;
  w.integrationParameters.maxCcdSubsteps = 0;
  if (process.env.NF) w.integrationParameters.contact_natural_frequency = Number(process.env.NF);
  return w;
}
var fixed = (w) => w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
function body(w, p, alpha, descs, iters = ITER) {
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(p[0], p[1], p[2]).setRotation({ x: 0, y: 0, z: Math.sin(alpha / 2), w: Math.cos(alpha / 2) }).setAdditionalSolverIterations(Math.max(0, iters - BASE_ITER))
  );
  for (const d of descs) w.createCollider(d, rb);
  return rb;
}
function revZ(w, f, b, at) {
  const bt = b.translation();
  const ang = angleZ(b);
  const d = [at[0] - bt.x, at[1] - bt.y, at[2] - bt.z];
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const loc = { x: c * d[0] - s * d[1], y: s * d[0] + c * d[1], z: d[2] };
  const j = w.createImpulseJoint(RAPIER.JointData.revolute({ x: at[0], y: at[1], z: at[2] }, loc, { x: 0, y: 0, z: 1 }), f, b, true);
  j.setContactsEnabled(false);
  return j;
}
function vmotor(w, j, omega, maxTorque) {
  const raw = w.impulseJoints.raw;
  raw.jointConfigureMotorModel(j.handle, ANG_X, 0);
  raw.jointConfigureMotorVelocity(j.handle, ANG_X, omega, 1e9);
  raw.jointSetMotorMaxForce(j.handle, ANG_X, maxTorque);
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
    d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
    this.last = a;
    this.v += d;
    return this.v;
  }
};
function energy(bodies) {
  let e = 0;
  for (const b of bodies) {
    const v = b.linvel(), wv = b.angvel();
    const inv = b.effectiveWorldInvInertia().elements;
    const Izz = inv[5] > 0 ? 1 / inv[5] : 0;
    e += 0.5 * b.mass() * (v.x * v.x + v.y * v.y + v.z * v.z) + 0.5 * Izz * wv.z * wv.z + b.mass() * G * b.worldCom().y;
  }
  return e;
}
var cpu = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1e3;
};
var fmt = (x, d = 3) => x === void 0 || Number.isNaN(x) ? "-" : Number.isFinite(x) ? (+x).toPrecision(d) : x > 0 ? "inf" : "-inf";

// spikes/teeth2/rrow.ts
await RAPIER.init();
var g = gear(1);
var TAU = 2.53 * G;
function build(fly = 1) {
  const w = makeWorld();
  const f = fixed(w);
  const gb = body(w, [0, 0, 0], 0, gearDescs(g, { rep: "none" }));
  if (fly) w.createCollider(RAPIER.ColliderDesc.cylinder(0.46, 2.5).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setDensity(fly).setCollisionGroups(0), gb);
  const jg = revZ(w, f, gb, [0, 0, 0]);
  vmotor(w, jg, 0, 0.2 * gb.mass() * G * R_BORE);
  const jr = w.createImpulseJoint(RAPIER.JointData.revolute({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }), f, gb, true);
  jr.setContactsEnabled(false);
  if (process.env.FLIP) jr.setLimits(-Math.PI, 0);
  else jr.setLimits(0, Math.PI);
  const uw = new Unwrap(angleZ(gb));
  let stop = Math.floor(uw.v / g.D) * g.D;
  const pre = () => {
    const th = uw.push(angleZ(gb));
    stop = Math.max(stop, Math.floor(th / g.D) * g.D);
    const c = Math.cos(stop / 2), sn = Math.sin(stop / 2), h = Math.SQRT1_2;
    const q = { x: sn * h, y: -c * h, z: sn * h, w: c * h };
    jr.setLocalFrame1({ x: 0, y: 0, z: 0 }, q);
    jr.setLocalFrame2({ x: 0, y: 0, z: 0 }, { x: 0, y: -h, z: 0, w: h });
  };
  return { w, gb, jg, jr, pre, th: () => uw.v, stop: () => stop };
}
console.log(`r1 T16 gear (+ flywheel I\u224856), one-way row; free direction +, lock direction \u2212; \u03C40 = ${fmt(TAU)}`);
for (const L of [10, 100, 1e3, 1e4]) {
  const s = build();
  for (let i = 0; i < 2400; i++) {
    s.gb.resetTorques(false);
    s.gb.addTorque({ x: 0, y: 0, z: -L * TAU * Math.min(1, i / 240) }, true);
    s.pre();
    s.w.step();
  }
  console.log(`  hold ${L} \u03C40 for 5 s: gear ${fmt((s.th() - s.stop()) / g.D, 3)} pitch from the stop (negative = past it), stop moved ${fmt(s.stop() / g.D)} pitches`);
  s.w.free();
}
for (const om of [10, 50, 100, 200, 350]) {
  const s = build();
  s.gb.setAngvel({ x: 0, y: 0, z: om }, true);
  let t0 = cpu();
  for (let i = 0; i < 240; i++) {
    s.pre();
    s.w.step();
  }
  const wFwd = s.gb.angvel().z;
  const ms = (cpu() - t0) / 240;
  s.gb.setAngvel({ x: 0, y: 0, z: -om }, true);
  const st = s.stop();
  const th0 = s.th();
  let minTh = th0;
  const E0 = energy([s.gb]);
  let Emax = 0;
  for (let i = 0; i < 240; i++) {
    s.pre();
    s.w.step();
    minTh = Math.min(minTh, s.th());
    Emax = Math.max(Emax, energy([s.gb]) - E0);
  }
  console.log(`  \u03C9 ${om}: forward coast keeps \u03C9 ${fmt(wFwd)} (drag from the row \u2248 ${fmt(om - wFwd)} rad/s over 0.5 s, joint friction included); reversed at \u2212${om}: went ${fmt((st - minTh) / g.D, 3)} pitch past the stop, energy rise ${fmt(Emax)} (KE0 ${fmt(E0)}), end \u03C9 ${fmt(s.gb.angvel().z)}; ${fmt(ms)} cpu ms/step`);
  s.w.free();
}
process.exit(0);
