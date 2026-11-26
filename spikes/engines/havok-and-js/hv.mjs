// Thin helper over the raw Havok HP_* API (@babylonjs/havok), no Babylon.js.
// All inputs/outputs of the helpers are in STUDS and real seconds; internally the
// world runs in "internal units" = studs * U (U = 0.008 => metres, U = 1 => studs).
import HavokPhysics from "@babylonjs/havok";
import fs from "node:fs";

const wasmBinary = fs.readFileSync(
  new URL("./node_modules/@babylonjs/havok/lib/esm/HavokPhysics.wasm", import.meta.url));
export const H = await HavokPhysics({ wasmBinary });
const OK = H.Result.RESULT_OK;
function chk(r, what) {
  const res = Array.isArray(r) ? r[0] : r;
  if (res !== OK) throw new Error(`${what} failed: ${JSON.stringify(res)}`);
  return Array.isArray(r) ? r.slice(1) : null;
}
export const G = 1226.25; // studs/s^2
export const DT = 1 / 480;

export class World {
  constructor({ U = 0.008, gravity = true, dt = DT, ideal = dt, speed = [1e6, 1e6], density = 752 } = {}) {
    this.U = U; this.dt = dt;
    // density: kg/m^3 in SI; in stud units we keep the same numbers per internal volume (mass is free).
    this.density = density;
    [this.w] = chk(H.HP_World_Create(), "world");
    chk(H.HP_World_SetGravity(this.w, [0, gravity ? -G * U : 0, 0]), "gravity");
    if (ideal !== null) chk(H.HP_World_SetIdealStepTime(this.w, ideal), "ideal");
    this.defaultSpeed = chk(H.HP_World_GetSpeedLimit(this.w), "speed");
    if (speed) chk(H.HP_World_SetSpeedLimit(this.w, speed[0] * U, speed[1]), "setspeed");
    this.bodies = [];
  }
  s(v) { return v.map((x) => x * this.U); }
  // ---- shapes (args in studs) ----
  box(ext, center = [0, 0, 0], q = [0, 0, 0, 1]) { return chk(H.HP_Shape_CreateBox(this.s(center), q, this.s(ext)), "box")[0]; }
  cyl(a, b, r) { return chk(H.HP_Shape_CreateCylinder(this.s(a), this.s(b), r * this.U), "cyl")[0]; }
  hull(pts) {
    const p = H._malloc(pts.length * 12);
    const f = new Float32Array(H.HEAPU8.buffer, p, pts.length * 3);
    pts.forEach((v, i) => { f[3 * i] = v[0] * this.U; f[3 * i + 1] = v[1] * this.U; f[3 * i + 2] = v[2] * this.U; });
    const s = chk(H.HP_Shape_CreateConvexHull(p, pts.length), "hull")[0];
    H._free(p);
    return s;
  }
  // regular n-gon prism, axis Y, from y0 to y1, circumradius r
  prism(n, r, y0, y1) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      pts.push([r * Math.cos(a), y0, r * Math.sin(a)], [r * Math.cos(a), y1, r * Math.sin(a)]);
    }
    return this.hull(pts);
  }
  container(children) { // children: [shape, pos(studs), quat]
    const [c] = chk(H.HP_Shape_CreateContainer(), "container");
    for (const [s, p, q] of children) chk(H.HP_Shape_AddChild(c, s, [this.s(p), q ?? [0, 0, 0, 1], [1, 1, 1]]), "child");
    return c;
  }
  // ---- bodies ----
  body(shape, { pos = [0, 0, 0], q = [0, 0, 0, 1], dynamic = true, mu = 0.5, e = 0, densityScale = 1, filter = null } = {}) {
    const isCont = H.HP_Shape_GetType(shape)[1] === H.ShapeType.CONTAINER;
    const leaves = isCont ? Array.from({ length: H.HP_Shape_GetNumChildren(shape)[1] }, (_, i) => H.HP_Shape_GetChildShape(shape, i)[1]) : [shape];
    for (const sh of leaves) {
      chk(H.HP_Shape_SetMaterial(sh, [mu, mu, e, H.MaterialCombine.MINIMUM, H.MaterialCombine.MAXIMUM]), "mat");
      if (filter) chk(H.HP_Shape_SetFilterInfo(sh, filter), "filter");
      if (isCont) chk(H.HP_Shape_SetDensity(sh, this.density * densityScale), "density");
    }
    const [b] = chk(H.HP_Body_Create(), "body");
    chk(H.HP_Body_SetShape(b, shape), "setshape");
    chk(H.HP_Body_SetMotionType(b, dynamic ? H.MotionType.DYNAMIC : H.MotionType.STATIC), "motion");
    let mp = null;
    if (dynamic) {
      if (!isCont) chk(H.HP_Shape_SetDensity(shape, this.density * densityScale), "density");
      [mp] = chk(H.HP_Shape_BuildMassProperties(shape), "mass");
      chk(H.HP_Body_SetMassProperties(b, mp), "setmass");
      chk(H.HP_Body_SetLinearDamping(b, 0), "ld");
      chk(H.HP_Body_SetAngularDamping(b, 0), "ad");
    }
    chk(H.HP_Body_SetQTransform(b, [this.s(pos), q]), "xf");
    chk(H.HP_World_AddBody(this.w, b, false), "add");
    if (dynamic) chk(H.HP_Body_SetActivationControl(b, H.ActivationControl.ALWAYS_ACTIVE), "active");
    const o = { id: b, mp, shape };
    this.bodies.push(o);
    return o;
  }
  // ---- state (studs) ----
  pose(o) { const [[p, q]] = chk(H.HP_Body_GetQTransform(o.id), "get"); return { p: p.map((x) => x / this.U), q }; }
  vel(o) { return chk(H.HP_Body_GetLinearVelocity(o.id), "v")[0].map((x) => x / this.U); }
  ang(o) { return chk(H.HP_Body_GetAngularVelocity(o.id), "w")[0]; }
  setVel(o, v) { chk(H.HP_Body_SetLinearVelocity(o.id, this.s(v)), "sv"); }
  setAng(o, w) { chk(H.HP_Body_SetAngularVelocity(o.id, w), "sw"); }
  angImpulse(o, J) { chk(H.HP_Body_ApplyAngularImpulse(o.id, J.map((x) => x * this.U * this.U)), "aimp"); } // J in mass*stud^2/s
  mass(o) { return o.mp[1]; }
  comWorld(o) { const { p, q } = this.pose(o); return add(p, rot(q, o.mp[0].map((x) => x / this.U))); }
  // kinetic energy in mass*stud^2/s^2 (mass unit = engine mass unit)
  ke(o) {
    const m = o.mp[1], v = this.vel(o), w = this.ang(o);
    const { q } = this.pose(o);
    const qi = qmul(q, o.mp[3]);
    const wl = rot(qconj(qi), w); // into principal frame
    const I = o.mp[2].map((x) => (x * m) / (this.U * this.U));
    return 0.5 * m * dot(v, v) + 0.5 * (I[0] * wl[0] ** 2 + I[1] * wl[1] ** 2 + I[2] * wl[2] ** 2);
  }
  rotKE(o) { const v = this.vel(o); return this.ke(o) - 0.5 * o.mp[1] * dot(v, v); }
  angMom(o) { // about COM, world frame, mass*stud^2/s
    const m = o.mp[1], w = this.ang(o); const { q } = this.pose(o);
    const qi = qmul(q, o.mp[3]); const wl = rot(qconj(qi), w);
    const I = o.mp[2].map((x) => (x * m) / (this.U * this.U));
    return rot(qi, [I[0] * wl[0], I[1] * wl[1], I[2] * wl[2]]);
  }
  pe(o, g = G) { return o.mp[1] * g * this.comWorld(o)[1]; }
  step(n = 1) { for (let i = 0; i < n; i++) chk(H.HP_World_Step(this.w, this.dt), "step"); }
  // ---- constraints ----
  // generic 6DOF; anchors in body-local studs; axes are unit vectors in body-local frames
  joint(parent, child, pivP, axXP, axYP, pivC, axXC, axYC, modes, { collide = false } = {}) {
    const [c] = chk(H.HP_Constraint_Create(), "con");
    chk(H.HP_Constraint_SetParentBody(c, parent.id), "par");
    chk(H.HP_Constraint_SetChildBody(c, child.id), "chi");
    chk(H.HP_Constraint_SetAnchorInParent(c, this.s(pivP), axXP, axYP), "ap");
    chk(H.HP_Constraint_SetAnchorInChild(c, this.s(pivC), axXC, axYC), "ac");
    chk(H.HP_Constraint_SetCollisionsEnabled(c, collide ? 1 : 0), "cc");
    const A = H.ConstraintAxis, M = H.ConstraintAxisLimitMode;
    const names = ["LINEAR_X", "LINEAR_Y", "LINEAR_Z", "ANGULAR_X", "ANGULAR_Y", "ANGULAR_Z"];
    names.forEach((n, i) => chk(H.HP_Constraint_SetAxisMode(c, A[n], modes[i] ? M.LOCKED : M.FREE), "mode"));
    chk(H.HP_Constraint_SetEnabled(c, 1), "en");
    return c;
  }
  // hinge about local axis X (free ANGULAR_X)
  hinge(parent, child, pivP, axP, perpP, pivC, axC, perpC) {
    return this.joint(parent, child, pivP, axP, perpP, pivC, axC, perpC, [1, 1, 1, 0, 1, 1]);
  }
  worldPoint(o, local) { const { p, q } = this.pose(o); return add(p, rot(q, local)); }
}

// ---- tiny math ----
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export function qmul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}
export const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
export function rot(q, v) { const r = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q)); return [r[0], r[1], r[2]]; }
export function qaxis(ax, ang) { const s = Math.sin(ang / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)]; }
// tilt (rad) of body's local +Y from world +Y
export function tilt(q) { const y = rot(q, [0, 1, 0]); return Math.acos(Math.max(-1, Math.min(1, y[1]))); }
export const fmt = (x, d = 3) => (Math.abs(x) >= 1e4 || (Math.abs(x) < 1e-3 && x !== 0) ? x.toExponential(2) : x.toFixed(d));
export function cpu(fn) { const t = process.cpuUsage(); const t0 = performance.now(); fn(); const u = process.cpuUsage(t); return { cpuMs: (u.user + u.system) / 1000, wallMs: performance.now() - t0 }; }
