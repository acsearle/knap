// spikes/wheels/lib.ts
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

// spikes/wheels/lib.ts
var G = 1226.25;
var DT = 1 / 480;
var SPEED_CAP = 400;
var FRICTION = 0.4;
var RESTITUTION = 0.1;
async function init() {
  await RAPIER.init();
}
function makeWorld(iterations, thetaDeg = 0) {
  const th = thetaDeg * Math.PI / 180;
  const w = new RAPIER.World({ x: G * Math.sin(th), y: -G * Math.cos(th), z: 0 });
  w.timestep = DT;
  w.numSolverIterations = iterations;
  w.numInternalPgsIterations = 1;
  w.integrationParameters.maxCcdSubsteps = 0;
  return w;
}
var Y_TO_Z = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 };
var GRP = {
  GROUND: 1 << 16 | (2 | 8),
  ROUND: 2 << 16 | (1 | 2),
  HULL: 4 << 16 | 8,
  PARTS: 8 << 16 | (1 | 4 | 8)
};
var HULL_ORIGIN = process.env.HULL_ORIGIN ?? "centre";
var WHEEL_BEVEL = Number(process.env.WHEEL_BEVEL ?? 0.05);
function bevelPrism(r, h, n, bevel) {
  const R = r / Math.cos(Math.PI / n);
  let best = 0;
  for (let i = 0; i < n / 4; i++) if (Math.abs((i + 0.5) / n * 360 - 56.25) < Math.abs((best + 0.5) / n * 360 - 56.25)) best = i;
  const keep = /* @__PURE__ */ new Set([best, n / 2 - 1 - best, n / 2 + best, n - 1 - best]);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i + 0.5) / n * 2 * Math.PI;
    for (const s of [-1, 1]) pts.push(R * Math.cos(a), R * Math.sin(a), s * (keep.has(i) ? h : h - bevel));
  }
  const A = 0.5 * n * R * R * Math.sin(2 * Math.PI / n);
  const L = 2 * h;
  const J = A * R * R * (2 + Math.cos(2 * Math.PI / n)) / 6;
  const volume = A * L;
  const Ixx = J / 2 * L + volume * L * L / 12;
  return { pts: new Float32Array(pts), volume, inertia: [Ixx, Ixx, J * L] };
}
var ROUND_BORDER = 0.05;
function wheelColliders(kind, r, at = [0, 0, 0]) {
  let cd;
  if (kind === "hyb") {
    const c = RAPIER.ColliderDesc.cylinder(0.5, r).setRotation(Y_TO_Z).setDensity(1).setCollisionGroups(GRP.ROUND);
    const p = bevelPrism(r, 0.5, 32, WHEEL_BEVEL);
    const h = RAPIER.ColliderDesc.convexHull(p.pts).setDensity(0).setCollisionGroups(GRP.HULL);
    for (const d of [c, h]) d.setTranslation(at[0], at[1], at[2]).setFriction(FRICTION).setRestitution(RESTITUTION);
    return [c, h];
  }
  if (kind.startsWith("b")) {
    const p = bevelPrism(r, 0.5, Number(kind.slice(1)), WHEEL_BEVEL);
    cd = RAPIER.ColliderDesc.convexHull(p.pts);
    cd.setMassProperties(p.volume, { x: 0, y: 0, z: 0 }, { x: p.inertia[0], y: p.inertia[1], z: p.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 });
  } else if (kind === "cyl") cd = RAPIER.ColliderDesc.cylinder(0.5, r).setRotation(Y_TO_Z);
  else if (kind === "rcyl") cd = RAPIER.ColliderDesc.roundCylinder(0.5 - ROUND_BORDER, r - ROUND_BORDER, ROUND_BORDER).setRotation(Y_TO_Z);
  else {
    const round = kind.startsWith("r");
    const n = Number(kind.slice(round ? 2 : 1));
    const b = round ? ROUND_BORDER : 0;
    const sh = prismShape([0, 0, 0], 2, r - b, 0.5 - b, n, 0);
    const full = prismShape([0, 0, 0], 2, r, 0.5, n, 0);
    if (full.kind !== "hull") throw new Error("hull expected");
    if (sh.kind !== "hull") throw new Error("hull expected");
    const pts = new Float32Array(sh.points.length * 3);
    sh.points.forEach((q, i) => pts.set(q, i * 3));
    const d = round ? RAPIER.ColliderDesc.roundConvexHull(pts, b) : RAPIER.ColliderDesc.convexHull(pts);
    if (!d) throw new Error("hull failed");
    const mp = full.mass;
    d.setMassProperties(mp.volume, { x: mp.com[0], y: mp.com[1], z: mp.com[2] }, { x: mp.inertia[0], y: mp.inertia[1], z: mp.inertia[2] }, { x: 0, y: 0, z: 0, w: 1 });
    cd = d;
  }
  cd.setTranslation(at[0], at[1], at[2]);
  cd.setFriction(FRICTION).setRestitution(RESTITUTION);
  if (kind === "cyl" || kind === "rcyl") cd.setDensity(1);
  return [cd];
}
function addWheel(w, kind, r, pos, opts = {}) {
  const desc = RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setTranslation(pos[0], pos[1], pos[2]);
  if (opts.rot) desc.setRotation(opts.rot);
  if (opts.extraIters) desc.setAdditionalSolverIterations(opts.extraIters);
  const rb = w.createRigidBody(desc);
  for (const cd of wheelColliders(kind, r)) w.createCollider(cd, rb);
  if (opts.softCcd ?? process.env.CCD !== "0") rb.setSoftCcdPrediction(SPEED_CAP * DT * 1.25);
  return rb;
}
function fmt(x, d = 3) {
  if (!Number.isFinite(x)) return String(x);
  if (x !== 0 && (Math.abs(x) < 1e-3 || Math.abs(x) >= 1e5)) return x.toExponential(2);
  return x.toFixed(d);
}
function now() {
  return performance.now();
}

// spikes/wheels/drive.ts
function run(kind, rA, rB, mu, fnRel) {
  const w = makeWorld(240);
  w.gravity = { x: 0, y: 0, z: 0 };
  const omA = 20;
  const A = w.createRigidBody(RAPIER.RigidBodyDesc.kinematicVelocityBased());
  for (const cd of wheelColliders(kind, rA)) w.createCollider(cd.setFriction(mu), A);
  const B = addWheel(w, kind, rB, [rA + rB, 0, 0], { softCcd: false });
  B.collider(0).setFriction(mu);
  A.setAngvel({ x: 0, y: 0, z: omA }, true);
  const fixed = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const M = RAPIER.JointAxesMask;
  w.createImpulseJoint(RAPIER.JointData.generic({ x: rA + rB, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, M.LinY | M.LinZ | M.AngX | M.AngY), fixed, B, true);
  const mB = B.mass();
  const FN = fnRel * mB * 1226.25;
  B.addForce({ x: -FN, y: 0, z: 0 }, true);
  B.setAngvel({ x: 0, y: 0, z: -omA * rA / rB }, true);
  const tauMax = 2 * mu * FN * rB;
  const T = 2;
  const N = Math.round(T / DT);
  let tauCrit = NaN;
  let creep = 0;
  let fnSum = 0;
  let fnN = 0;
  const t0 = now();
  for (let i = 0; i < N; i++) {
    const tau = tauMax * i / N;
    B.resetTorques(false);
    B.addTorque({ x: 0, y: 0, z: tau }, true);
    w.step();
    const vs = omA * rA;
    const slip = 1 - -B.angvel().z * rB / vs;
    if (tau < 0.5 * mu * FN * rB) {
      creep = Math.max(creep, Math.abs(slip));
      w.contactPair(B.collider(0), A.collider(0), (m) => {
        let s = 0;
        for (let k = 0; k < m.numContacts(); k++) s += m.contactImpulse(k);
        fnSum += s / DT;
        fnN++;
      });
    }
    if (Number.isNaN(tauCrit) && slip > 0.02) tauCrit = tau;
  }
  const ms = now() - t0;
  w.free();
  return { muEff: tauCrit / (FN * rB), creep, fnMeas: fnN ? fnSum / fnN / FN : NaN, ms: ms / T };
}
async function main() {
  await init();
  console.log("## friction drive: \u03BC_eff = \u03C4_crit/(F_N r_B) (slip > 2 %), creep = max slip at \u03C4 < \xBD \u03BC F_N r_B, F_N measured / applied");
  console.log("kind	rA	rB	\u03BC	F_N/(m_B g)	\u03BC_eff	creep	F_N meas/appl	ms/sim-s");
  for (const kind of (process.argv[2] ?? "cyl,b32").split(","))
    for (const [rA, rB] of [[1.5, 1.5], [2.5, 1], [1, 2.5], [0.5, 0.5]])
      for (const mu of [0.4, 0.8, 1.2])
        for (const fn of [0.1, 1, 10]) {
          const r = run(kind, rA, rB, mu, fn);
          console.log([kind, rA, rB, mu, fn, fmt(r.muEff, 3), fmt(r.creep, 4), fmt(r.fnMeas, 3), fmt(r.ms, 1)].join("	"));
        }
}
void main();
