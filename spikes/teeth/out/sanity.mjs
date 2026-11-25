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
var fmt = (x, d = 3) => Number.isFinite(x) ? x.toPrecision(d) : String(x);

// spikes/teeth/sanity.ts
function area(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i];
    const [x1, y1] = p[(i + 1) % p.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}
await RAPIER.init();
console.log("== hulls and mass (density 1, thickness 0.92) ==");
for (const set of ["fine", "coarse"])
  for (const prof of ["trap", "saw"])
    for (const r of [0.5, 1, 1.5, 2.5]) {
      const g = gearSpec(r, set, prof);
      const w = makeWorld();
      const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
      const descs = gearColliderDescs(g, "teeth");
      for (const d of descs) w.createCollider(d, rb);
      const polys = gearPolys2D(g);
      const vol = polys.reduce((s, p) => s + area(p), 0) * 2 * HC2;
      let maxV = 0;
      for (let i = 1; i < rb.numColliders() - 1; i++) maxV = Math.max(maxV, rb.collider(i).shape.vertices.length / 3);
      console.log(`${g.name.padEnd(22)} colliders ${rb.numColliders()} toothHullVerts ${maxV} mass ${fmt(rb.mass(), 5)} analytic ${fmt(vol, 5)} Izz ${fmt(rb.principalInertia().z, 4)}`);
      w.free();
    }
console.log("== motor sign ==");
{
  const g = gearSpec(1, "fine");
  const w = makeWorld();
  const f = fixedBody(w);
  const gb = jointedBody(w, [0, 0, 0], 0, gearColliderDescs(g, "teeth"));
  const j = revoluteZ(w, f, gb, [0, 0, 0]);
  velocityMotor(w, j, 10, 1e9);
  for (let i = 0; i < 48; i++) w.step();
  console.log(`target +10 rad/s \u2192 gear \u03C9z ${fmt(gb.angvel().z)} angle ${fmt(angleZ(gb))} (expect +10, +1.0)`);
  w.free();
}
console.log("== collision groups: two toothed gears overlapping at mesh distance, then closer ==");
for (const dist of [2, 1.98, 1.9]) {
  const g = gearSpec(1, "fine");
  const w = makeWorld();
  w.gravity = { x: 0, y: 0, z: 0 };
  const a = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const b = w.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(dist, 0, 0).setRotation({ x: 0, y: 0, z: Math.sin(Math.PI / 32), w: Math.cos(Math.PI / 32) }));
  const bd = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(dist, 0, 0));
  for (const d of gearColliderDescs(g, "teeth")) w.createCollider(d, a);
  for (const d of gearColliderDescs(g, "teeth")) w.createCollider(d, bd);
  w.step();
  let pairs = 0;
  let touching = 0;
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < a.numColliders(); i++)
    w.contactPairsWith(a.collider(i), (c2) => {
      pairs++;
      w.contactPair(a.collider(i), c2, (m) => {
        if (m.numContacts() > 0) {
          touching++;
          seen.add(`${a.collider(i).collisionGroups() >>> 16}-${c2.collisionGroups() >>> 16}`);
        }
      });
    });
  console.log(`centre distance ${dist}: contact pairs ${pairs}, with contacts ${touching}, member groups ${[...seen].join(",")}  (tip radius 1.125: teeth overlap by ${fmt(2.25 - dist)})`);
  void b;
  w.free();
}
console.log("== a pawl liftarm overlapping a gear: does it collide with teeth? ==");
{
  const g = gearSpec(1, "fine");
  const w = makeWorld();
  w.gravity = { x: 0, y: 0, z: 0 };
  const a = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  for (const d of gearColliderDescs(g, "teeth")) w.createCollider(d, a);
  const p = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(1.5, 0, 0));
  for (const d of pawlColliderDescs("end", 2)) w.createCollider(d, p);
  w.step();
  const kinds = [];
  for (let i = 0; i < a.numColliders(); i++)
    w.contactPairsWith(
      a.collider(i),
      (c2) => w.contactPair(a.collider(i), c2, (m) => {
        if (m.numContacts() > 0) kinds.push(i === 0 ? "root" : i === a.numColliders() - 1 ? "gearcyl" : "tooth");
      })
    );
  console.log(`pawl touches: ${[...new Set(kinds)].join(",")} (${kinds.length} manifolds); pawl group ${(G_PART >>> 16).toString(2)}`);
  w.free();
}
console.log("== flat rest: gear lying flat on a fixed plate, 2 s ==");
for (const kind of ["teeth", "root", "cylinder"])
  for (const r of [0.5, 1, 1.5, 2.5]) {
    const g = gearSpec(r, "fine");
    const w = makeWorld();
    const plate = w.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    w.createCollider(RAPIER.ColliderDesc.cuboid(10, 0.5, 10).setTranslation(0, -0.5, 0).setFriction(0.4), plate);
    const s = Math.SQRT1_2;
    const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(0.13, HC2 + 0.01, 0.07).setRotation({ x: s, y: 0, z: 0, w: s }).setSoftCcdPrediction(1));
    for (const d of gearColliderDescs(g, kind, false)) w.createCollider(d, rb);
    for (let i = 0; i < 960; i++) w.step();
    const q = rb.rotation();
    const zx = 2 * (q.x * q.z + q.w * q.y);
    const zy = 2 * (q.y * q.z - q.w * q.x);
    const zz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const tilt = Math.acos(Math.min(1, Math.abs(zy))) * 180 / Math.PI;
    console.log(`${kind} r${r}: centre y ${fmt(rb.translation().y, 5)} (expect ${HC2}), axis tilt ${fmt(tilt)}\xB0, |v| ${fmt(Math.hypot(rb.linvel().x, rb.linvel().y, rb.linvel().z))}`);
    void zx;
    void zz;
    w.free();
  }
