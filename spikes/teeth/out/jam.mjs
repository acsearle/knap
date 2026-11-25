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
  const out2 = [];
  if (kind === "cylinder" || kind === "root") {
    const R = kind === "cylinder" ? tipR(g) : rootR(g);
    const sh = prismShape([0, 0, 0], 2, R, HC2, 16, 0);
    const pts = new Float32Array(sh.points.flat());
    out2.push(RAPIER.ColliderDesc.convexHull(pts).setCollisionGroups(G_PART).setDensity(1));
    return out2.map(fin);
  }
  const hulls = [rootHull(g)];
  for (let k = 0; k < g.T; k++) hulls.push(prism2D(toothPoly(g, k), HC2));
  if (kind === "teeth") {
    for (const h of hulls) {
      const d = RAPIER.ColliderDesc.convexHull(h);
      if (!d) throw new Error("hull failed");
      out2.push(d.setCollisionGroups(G_TOOTH).setDensity(1));
    }
  } else {
    const shapes = hulls.map((h) => new RAPIER.ConvexPolyhedron(h, null));
    const id = { x: 0, y: 0, z: 0, w: 1 };
    out2.push(RAPIER.ColliderDesc.compound(shapes, shapes.map(() => ({ x: 0, y: 0, z: 0 })), shapes.map(() => id)).setCollisionGroups(G_TOOTH).setDensity(1));
  }
  if (withGearCyl) {
    const sh = prismShape([0, 0, 0], 2, g.r - 0.02, HC2, 16, 0);
    out2.push(RAPIER.ColliderDesc.convexHull(new Float32Array(sh.points.flat())).setCollisionGroups(G_GEARCYL).setDensity(0));
  }
  return out2.map(fin);
}
function fin(d) {
  return d.setFriction(FRICTION).setRestitution(RESTITUTION);
}
function pawlColliderDescs(kind, l) {
  const out2 = [];
  const hull = (sh) => RAPIER.ColliderDesc.convexHull(new Float32Array(sh.points.flat()));
  if (kind === "end" || kind === "side") {
    out2.push(hull(prismShape([0, 0, 0], 2, HC2, HC2, 16, 0, l)));
  } else if (kind === "rod") {
    out2.push(hull(prismShape([0, 0, 1], 2, HC2, HC2, 16, 0, l)));
    out2.push(hull(prismShape([l, 0, 0.51], 2, ROD, 0.99, 16, 0)));
  } else {
    if (l - 1 > 0) out2.push(hull(prismShape([0, 0, 0], 2, HC2, HC2, 16, 0, l - 1)));
    else out2.push(hull(prismShape([0, 0, 0], 2, HC2, HC2, 16, 0)));
    out2.push(RAPIER.ColliderDesc.cuboid(0.25, HC2, HC2).setTranslation(l - 1 + 0.25, 0, 0));
    out2.push(hull(prismShape([l - 0.02, 0, 0], 0, HC2, 0.48, 16, 1)));
  }
  return out2.map((d) => d.setCollisionGroups(G_PART).setDensity(1).setFriction(FRICTION).setRestitution(RESTITUTION));
}
function makeWorld(o = {}) {
  const w = new RAPIER.World({ x: 0, y: -G, z: 0 });
  w.timestep = DT;
  w.numSolverIterations = BASE_ITER;
  w.numInternalPgsIterations = 1;
  w.integrationParameters.maxCcdSubsteps = o.ccd === "hard" ? 1 : 0;
  if (process.env.NF) w.integrationParameters.contact_natural_frequency = Number(process.env.NF);
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
function velocityMotor(w, j, omega, maxTorque) {
  const raw = w.impulseJoints.raw;
  raw.jointConfigureMotorModel(j.handle, ANG_X, 0);
  raw.jointConfigureMotorVelocity(j.handle, ANG_X, omega, FRICTION_GAIN);
  raw.jointSetMotorMaxForce(j.handle, ANG_X, maxTorque);
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
function energy(bodies) {
  let K = 0;
  let U = 0;
  for (const rb of bodies) {
    const m = rb.mass();
    const v = rb.linvel();
    const wv = rb.angvel();
    const inv = rb.effectiveWorldInvInertia();
    const e = inv.elements;
    const a = [
      [e[0], e[1], e[2]],
      [e[1], e[3], e[4]],
      [e[2], e[4], e[5]]
    ];
    const Iw = inv3(a);
    const w = [wv.x, wv.y, wv.z];
    let rot = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) rot += w[i] * Iw[i][j] * w[j];
    K += 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z) + 0.5 * rot;
    U += m * G * rb.worldCom().y;
  }
  return { K, U };
}
function inv3(a) {
  const [[a0, a1, a2], [b0, b1, b2], [c0, c1, c2]] = a;
  const det = a0 * (b1 * c2 - b2 * c1) - a1 * (b0 * c2 - b2 * c0) + a2 * (b0 * c1 - b1 * c0);
  if (Math.abs(det) < 1e-30) return [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const id = 1 / det;
  return [
    [(b1 * c2 - b2 * c1) * id, (a2 * c1 - a1 * c2) * id, (a1 * b2 - a2 * b1) * id],
    [(b2 * c0 - b0 * c2) * id, (a0 * c2 - a2 * c0) * id, (a2 * b0 - a0 * b2) * id],
    [(b0 * c1 - b1 * c0) * id, (a1 * c0 - a0 * c1) * id, (a0 * b1 - a1 * b0) * id]
  ];
}
var fmt = (x, d = 3) => Number.isFinite(x) ? x.toPrecision(d) : String(x);

// spikes/teeth/jam.ts
await RAPIER.init();
function freeArm(w, at, alpha, holes) {
  const rb = w.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(...at).setRotation({ x: 0, y: 0, z: Math.sin(alpha / 2), w: Math.cos(alpha / 2) }).setSoftCcdPrediction(400 * DT * 1.25)
  );
  const sh = prismShape([0, 0, 0], 2, HC2, HC2, 16, 0, holes - 1);
  w.createCollider(RAPIER.ColliderDesc.convexHull(new Float32Array(sh.points.flat())).setCollisionGroups(G_PART).setDensity(1).setFriction(0.4).setRestitution(0.1), rb);
  return rb;
}
function run(name, setup, seconds) {
  const w = makeWorld();
  const s = setup(w);
  const E = () => {
    const e = energy(s.bodies);
    return e.K + e.U;
  };
  const e0 = E();
  const k0 = energy(s.bodies).K;
  let emin = e0;
  let maxRise = 0, riseAbs = 0, tRise = 0, tStop = NaN;
  let maxOmega = 0, maxV = 0;
  let nan = false;
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    w.step();
    const e = E();
    if (!Number.isFinite(e)) {
      nan = true;
      break;
    }
    emin = Math.min(emin, e);
    if (e - emin > riseAbs) {
      riseAbs = e - emin;
      tRise = (i + 1) * DT;
    }
    maxRise = riseAbs / Math.max(k0, 1e-9);
    if (Number.isNaN(tStop) && Math.abs(s.bodies[0].angvel().z) < 0.5) tStop = (i + 1) * DT;
    for (const b of s.bodies) {
      const av = b.angvel();
      const lv = b.linvel();
      maxOmega = Math.max(maxOmega, Math.hypot(av.x, av.y, av.z));
      maxV = Math.max(maxV, Math.hypot(lv.x, lv.y, lv.z));
    }
  }
  const r = { name, maxRise, riseAbs, tRise, tStop, e0: k0, eEnd: E() - e0 + k0, maxOmega, maxV, nan, note: s.check ? s.check() : "" };
  w.free();
  return r;
}
var out = [];
for (const kind of ["teeth", "cylinder"])
  for (const [set, r] of [["fine", 1.5], ["coarse", 1.5], ["fine", 0.5]]) {
    const g = gearSpec(r, set);
    if (kind === "cylinder" && set === "coarse") continue;
    const tag = `${kind === "teeth" ? g.name : `cylinder r${r}`}`;
    const tr = kind === "teeth" ? tipR(g) : tipR(g);
    out.push(
      run(`${tag}: free 5-hole arm dropped onto gear spinning 60 rad/s`, (w) => {
        const f = fixedBody(w);
        const gb = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(g, kind));
        revoluteZ(w, f, gb, [0, 0, 0]);
        gb.setAngvel({ x: 0, y: 0, z: 60 }, true);
        const arm = freeArm(w, [-0.3, tr + HC2 + 0.6, 0], -1.2, 5);
        return {
          bodies: [gb, arm],
          check: () => {
            const t = arm.translation();
            return `arm ends at (${fmt(t.x)}, ${fmt(t.y)}); fell clear: ${t.y < -5}`;
          }
        };
      }, 0.6)
    );
    out.push(
      run(`${tag}: pivoted arm swings into gear spinning 60 rad/s`, (w) => {
        const f = fixedBody(w);
        const gb = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(g, kind));
        revoluteZ(w, f, gb, [0, 0, 0]);
        gb.setAngvel({ x: 0, y: 0, z: 60 }, true);
        const py = Math.ceil(tr + HC2 + 0.6);
        const arm = jointedBody(w, [-3, py, 0], 0, pawlColliderDescs("end", 3));
        const ja = revoluteZ(w, f, arm, [-3, py, 0]);
        frictionMotor(w, ja, PIVOT_MU * arm.mass() * G * R_BORE);
        return {
          bodies: [gb, arm],
          check: () => {
            const a = angleZ(arm);
            const e = { x: -3 + 3 * Math.cos(a), y: py + 3 * Math.sin(a) };
            const d = Math.hypot(e.x, e.y);
            return `arm end at r=${fmt(d)} from gear centre (root ${fmt(rootR(g))}, tip ${fmt(tr)}; \u2265 ${fmt(tr + HC2)} = resting outside)`;
          }
        };
      }, 3)
    );
    out.push(
      run(`${tag}: driven gear 30 rad/s grinding a pivoted arm (motor adds energy)`, (w) => {
        const f = fixedBody(w);
        const gb = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(g, kind));
        const jg = revoluteZ(w, f, gb, [0, 0, 0]);
        const py = Math.ceil(tr + HC2 + 0.6);
        const arm = jointedBody(w, [-3, py, 0], 0, pawlColliderDescs("end", 3));
        const ja = revoluteZ(w, f, arm, [-3, py, 0]);
        frictionMotor(w, ja, PIVOT_MU * arm.mass() * G * R_BORE);
        velocityMotor(w, jg, 30, 50 * arm.mass() * G);
        return {
          bodies: [gb, arm],
          check: () => {
            const a = angleZ(arm);
            const e = { x: -3 + 3 * Math.cos(a), y: py + 3 * Math.sin(a) };
            return `gear \u03C9 ${fmt(gb.angvel().z)} rad/s, arm end r=${fmt(Math.hypot(e.x, e.y))} (\u2265 ${fmt(tr + HC2 - 0.05)} ok)`;
          }
        };
      }, 3)
    );
    out.push(
      run(`${tag}: gear spinning 60 rad/s under an arm's flat side`, (w) => {
        const f = fixedBody(w);
        const gb = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(g, kind));
        revoluteZ(w, f, gb, [0, 0, 0]);
        gb.setAngvel({ x: 0, y: 0, z: 60 }, true);
        const py = Math.ceil(tr + HC2);
        let lo = -1.5, hi = 0;
        for (let k = 0; k < 60; k++) {
          const m = (lo + hi) / 2;
          if (2 * Math.sin(m) + py * Math.cos(m) > tr + HC2 + 3e-3) hi = m;
          else lo = m;
        }
        const a0 = hi;
        const arm = jointedBody(w, [-2, py, 0], a0, pawlColliderDescs("end", 4));
        const ja = revoluteZ(w, f, arm, [-2, py, 0]);
        frictionMotor(w, ja, PIVOT_MU * arm.mass() * G * R_BORE);
        return { bodies: [gb, arm], check: () => `gear \u03C9 end ${fmt(gb.angvel().z)} rad/s, arm angle ${fmt(angleZ(arm))} (start ${fmt(a0)})` };
      }, 3)
    );
  }
for (const r of out)
  console.log(`${r.name.padEnd(78)} K0 ${fmt(r.e0)}  max rise ${fmt(r.riseAbs)} (${fmt(100 * r.maxRise)} % K0) at ${fmt(r.tRise)} s  gear<0.5rad/s at ${fmt(r.tStop)} s  max \u03C9 ${fmt(r.maxOmega)}  max v ${fmt(r.maxV)}  ${r.nan ? "NaN!" : ""} ${r.note}`);
