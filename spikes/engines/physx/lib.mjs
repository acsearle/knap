// Shared PhysX (physx-js-webidl 2.9.1, PhysX 5.12.0 per its package.json) helpers for the battery.
// Internal units: length = 1 stud (8 mm), time = s, mass = g. Gravity 1226.25 studs/s^2.
// PxTolerancesScale: length 1 (a part is ~1 stud), speed 1226 (PhysX's rule: speed after 1 s fall).
// Set env PXU=m to run the same physical world in SI-metres/kg (length 0.008, speed 9.81) instead.
import PhysXInit from 'physx-js-webidl';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// The npm build is compiled with -sENVIRONMENT=web only (and ASSERTIONS on). To run it in Node we
// hide `process` and pretend to be a window for the duration of the factory call, and hand it the
// .wasm bytes ourselves. Nothing in the package is modified.
const wasmPath = createRequire(import.meta.url).resolve('physx-js-webidl/physx-js-webidl.wasm');
const realProcess = globalThis.process;
globalThis.window = globalThis;
globalThis.process = undefined;
let PXm;
try { PXm = await PhysXInit({ wasmBinary: readFileSync(wasmPath) }); } finally { globalThis.process = realProcess; delete globalThis.window; }
export const PX = PXm;
export const TL = PX.PxTopLevelFunctions.prototype;
export const STUD = 1; // internal units per stud
export const UNITS = process.env.PXU === 'm' ? 'm' : 'stud';
export const L = UNITS === 'm' ? 0.008 : 1; // internal length per stud
export const MASS = UNITS === 'm' ? 1e-3 : 1; // internal mass per gram
export const G = 1226.25 * L; // internal gravity
export const DENS = 0.3 * MASS / (L * L * L); // 0.3 g per stud^3
export const DT = 1 / 480;

const version = TL.PHYSICS_VERSION;
const allocator = new PX.PxDefaultAllocator();
const errorCb = new PX.PxDefaultErrorCallback();
export const foundation = PX.CreateFoundation(version, allocator, errorCb);
export const tol = new PX.PxTolerancesScale();
tol.length = 1 * L;
tol.speed = 1226.25 * L;
export const physics = PX.CreatePhysics(version, foundation, tol);
PX.InitExtensions(physics);
export const cookParams = new PX.PxCookingParams(tol);

export const v3 = (x = 0, y = 0, z = 0) => new PX.PxVec3(x, y, z);
export const qt = (x = 0, y = 0, z = 0, w = 1) => new PX.PxQuat(x, y, z, w);
export const tf = (p = [0, 0, 0], q = [0, 0, 0, 1]) => new PX.PxTransform(v3(...p), qt(...q));
export const qAxisAngle = (ax, a) => { const s = Math.sin(a / 2), n = Math.hypot(...ax); return [ax[0] / n * s, ax[1] / n * s, ax[2] / n * s, Math.cos(a / 2)]; };

// contact counting: only when opts.contacts; pass-through shader written in JS
let contactCounts = null;
export function lastContacts() { return contactCounts; }

export function makeScene(opts = {}) {
  const desc = new PX.PxSceneDesc(tol);
  desc.gravity = v3(0, opts.g ?? -G, 0);
  desc.cpuDispatcher = PX.DefaultCpuDispatcherCreate(0);
  desc.solverType = (opts.pgs ?? (process.env.PGS === "1")) ? PX.PxSolverTypeEnum.ePGS : PX.PxSolverTypeEnum.eTGS;
  if (opts.contacts) {
    const shader = new PX.PassThroughFilterShaderImpl();
    const F = PX.PxPairFlagEnum;
    const flags = F.eSOLVE_CONTACT | F.eDETECT_DISCRETE_CONTACT | F.eNOTIFY_TOUCH_FOUND | F.eNOTIFY_TOUCH_PERSISTS | F.eNOTIFY_CONTACT_POINTS;
    // returns PxFilterFlags (eDEFAULT); the bridge resets outputPairFlags before each call and reads it after
    shader.filterShader = () => { shader.outputPairFlags = flags; return 0; };
    PX.setupPassThroughFilterShader(desc, shader);
    const cb = new PX.PxSimulationEventCallbackImpl();
    const buf = new PX.PxArray_PxContactPairPoint(64);
    cb.onContact = (hdr, pairs, nb) => {
      hdr = PX.wrapPointer(hdr, PX.PxContactPairHeader);
      for (let i = 0; i < nb; i++) {
        const pair = PX.NativeArrayHelpers.prototype.getContactPairAt(hdr.pairs, i);
        const n = pair.extractContacts(buf.begin(), 64);
        const pts = [];
        for (let k = 0; k < n; k++) { const c = buf.get(k); pts.push({ p: [c.position.x, c.position.y, c.position.z], sep: c.separation, imp: [c.impulse.x, c.impulse.y, c.impulse.z] }); }
        contactCounts.push(pts);
      }
    };
    cb.onConstraintBreak = () => {}; cb.onWake = () => {}; cb.onSleep = () => {}; cb.onTrigger = () => {};
    desc.simulationEventCallback = cb;
  } else {
    desc.filterShader = TL.DefaultFilterShader();
  }
  let flags = desc.flags; // default has PCM on
  if (opts.noPCM) flags.clear(PX.PxSceneFlagEnum.eENABLE_PCM);
  if (opts.enhancedDeterminism) flags.raise(PX.PxSceneFlagEnum.eENABLE_ENHANCED_DETERMINISM);
  if (opts.frictionEveryIteration) flags.raise(PX.PxSceneFlagEnum.eENABLE_FRICTION_EVERY_ITERATION);
  desc.flags = flags;
  const scene = physics.createScene(desc);
  if (opts.contacts) scene.setSimulationEventCallback(desc.simulationEventCallback);
  scene.step = (dt = DT) => { if (opts.contacts) contactCounts = []; scene.simulate(dt); scene.fetchResults(true); };
  return scene;
}

export const material = (mu = 0.5, e = 0) => physics.createMaterial(mu, mu, e);
const defMat = material(0.5, 0);

export function shapeOf(geom, mat = defMat, local) {
  const sf = new PX.PxShapeFlags(PX.PxShapeFlagEnum.eSIMULATION_SHAPE | PX.PxShapeFlagEnum.eSCENE_QUERY_SHAPE);
  const s = physics.createShape(geom, mat, true, sf);
  if (local) s.setLocalPose(local);
  // fabmax's DefaultFilterShader is the snippet-style one: pairs collide only if
  // (w0a & w1b) && (w0b & w1a). Zero filter data (the default) means nothing collides.
  s.setSimulationFilterData(new PX.PxFilterData(1, 0xffffffff, 0, 0));
  return s;
}

export function boxGeom(hx, hy, hz) { return new PX.PxBoxGeometry(hx * L, hy * L, hz * L); }

// convex hull from points (studs). Returns geometry.
export function convexGeom(points) {
  const arr = new PX.PxArray_PxVec3(points.length);
  points.forEach((p, i) => arr.set(i, v3(p[0] * L, p[1] * L, p[2] * L)));
  const desc = new PX.PxConvexMeshDesc();
  desc.points.count = points.length;
  desc.points.stride = 12;
  desc.points.data = arr.begin();
  desc.flags = new PX.PxConvexFlags(PX.PxConvexFlagEnum.eCOMPUTE_CONVEX);
  const mesh = PX.CreateConvexMesh(cookParams, desc);
  if (!mesh) throw new Error('convex cooking failed');
  return new PX.PxConvexMeshGeometry(mesh);
}
// regular n-gon prism, axis along `axis` ('x'|'y'|'z'), radius r, half length hl (studs)
export function prismPoints(n, r, hl, axis = 'y', phase = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = phase + 2 * Math.PI * i / n, c = r * Math.cos(a), s = r * Math.sin(a);
    for (const h of [-hl, hl]) {
      if (axis === 'y') pts.push([c, h, s]); else if (axis === 'x') pts.push([h, c, s]); else pts.push([c, s, h]);
    }
  }
  return pts;
}
// native cylinder via PhysX 5 "convex core" geometry. PhysX's convex-core cylinder axis is X (checked in b5).
export function cylCoreGeom(r, hl, margin = 0) {
  return PX.PxConvexCoreGeometryFactory.prototype.createFromCylinder(new PX.PxConvexCoreCylinder(2 * hl * L, r * L), margin * L);
}

export function addStatic(scene, geom, pos = [0, 0, 0], q, mat) {
  const a = physics.createRigidStatic(tf(pos.map((x) => x * L), q));
  a.attachShape(shapeOf(geom, mat));
  scene.addActor(a);
  return a;
}
export function addPlane(scene, y = 0, mat) {
  // PxPlaneGeometry: plane x=0 with normal +X; rotate +X onto +Y
  const a = physics.createRigidStatic(tf([0, y * L, 0], qAxisAngle([0, 0, 1], Math.PI / 2)));
  a.attachShape(shapeOf(new PX.PxPlaneGeometry(), mat));
  scene.addActor(a);
  return a;
}
// shapes: [{geom, local:[p,q]}]
export function addDynamic(scene, shapes, pos = [0, 0, 0], q, opts = {}) {
  const a = physics.createRigidDynamic(tf(pos.map((x) => x * L), q));
  for (const s of shapes) a.attachShape(shapeOf(s.geom, s.mat ?? opts.mat, s.local ? tf(s.local[0].map((x) => x * L), s.local[1]) : undefined));
  PX.PxRigidBodyExt.prototype.updateMassAndInertia(a, opts.density ?? DENS);
  a.setSleepThreshold(0);
  a.setStabilizationThreshold(0);
  a.setSolverIterationCounts(opts.posIters ?? 4, opts.velIters ?? 1);
  if (process.env.SPEC === "1") a.setRigidBodyFlag(PX.PxRigidBodyFlagEnum.eENABLE_SPECULATIVE_CCD, true);
  if (opts.gyro) a.setRigidBodyFlag(PX.PxRigidBodyFlagEnum.eENABLE_GYROSCOPIC_FORCES, true);
  a.setMaxLinearVelocity(1e9); a.setMaxAngularVelocity(1e9); a.setMaxDepenetrationVelocity(1e9);
  if (opts.linDamp !== undefined) a.setLinearDamping(opts.linDamp); else a.setLinearDamping(0);
  a.setAngularDamping(opts.angDamp ?? 0);
  scene.addActor(a);
  return a;
}

// readers in studs / studs/s
export const pos = (a) => { const p = a.getGlobalPose().p; return [p.x / L, p.y / L, p.z / L]; };
export const quat = (a) => { const q = a.getGlobalPose().q; return [q.x, q.y, q.z, q.w]; };
export const lv = (a) => { const v = a.getLinearVelocity(); return [v.x / L, v.y / L, v.z / L]; };
export const av = (a) => { const v = a.getAngularVelocity(); return [v.x, v.y, v.z]; };
export const setLv = (a, v) => a.setLinearVelocity(v3(v[0] * L, v[1] * L, v[2] * L));
export const setAv = (a, v) => a.setAngularVelocity(v3(...v));
export const len = (v) => Math.hypot(...v);
// tilt (rad) of the body's local axis from its initial world direction
export function rotVec(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
export const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (len(a) * len(b)))));
export const f = (x, d = 4) => (Math.abs(x) < 1e-3 && x !== 0 ? x.toExponential(2) : x.toFixed(d));
export const massG = (a) => a.getMass() / MASS;
export function kinetic(a) {
  // KE in g*stud^2/s^2
  const m = a.getMass() / MASS, v = lv(a);
  const I = a.getMassSpaceInertiaTensor(); const q = quat(a);
  const cm = a.getCMassLocalPose().q; // principal frame
  // world ang vel -> principal frame
  const qb = mulQ(q, [cm.x, cm.y, cm.z, cm.w]);
  const w = rotVec(conjQ(qb), av(a));
  const s = 1 / (MASS * L * L);
  return 0.5 * m * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) + 0.5 * s * (I.x * w[0] ** 2 + I.y * w[1] ** 2 + I.z * w[2] ** 2);
}
export function angMom(a) { // world angular momentum about COM, g*stud^2/s
  const I = a.getMassSpaceInertiaTensor(); const q = quat(a); const cm = a.getCMassLocalPose().q;
  const qb = mulQ(q, [cm.x, cm.y, cm.z, cm.w]);
  const w = rotVec(conjQ(qb), av(a)); const s = 1 / (MASS * L * L);
  return rotVec(qb, [s * I.x * w[0], s * I.y * w[1], s * I.z * w[2]]);
}
export const conjQ = (q) => [-q[0], -q[1], -q[2], q[3]];
export function mulQ(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
export const comWorld = (a) => { const p = a.getGlobalPose(); const c = a.getCMassLocalPose().p; const w = rotVec(quat(a), [c.x, c.y, c.z]); return [(p.p.x + w[0]) / L, (p.p.y + w[1]) / L, (p.p.z + w[2]) / L]; };
export function worldPoint(a, local) { const p = pos(a); const w = rotVec(quat(a), local); return [p[0] + w[0], p[1] + w[1], p[2] + w[2]]; }
export const ms = () => Number(process.hrtime.bigint()) / 1e6;

// battery-wide settings, overridable from env: POS (TGS position iterations), VEL, SUB (outer steps per 1/480 s), PGS=1
export const SET = {
  pos: +(process.env.POS ?? 4), vel: +(process.env.VEL ?? 1), sub: +(process.env.SUB ?? 1), pgs: process.env.PGS === '1',
};
export const settingsLine = () => `units ${UNITS}, ${SET.pgs ? 'PGS' : 'TGS'}, pos iters ${SET.pos}, vel iters ${SET.vel}, dt 1/${480 * SET.sub}`;
export const bodyOpts = (o = {}) => ({ posIters: SET.pos, velIters: SET.vel, ...o });
export function stepReal(scene, seconds, each) { // advance real seconds at dt = 1/(480*sub)
  const n = Math.round(seconds * 480 * SET.sub); const dt = 1 / (480 * SET.sub);
  for (let i = 1; i <= n; i++) { scene.step(dt); if (each) each(i * dt, i); }
}
// put every shape of an actor in collision group `bit`, colliding with everything except that group
export function setGroup(actor, bit) {
  for (let i = 0; i < actor.getNbShapes(); i++) PX.SupportFunctions.prototype.PxActor_getShape(actor, i).setSimulationFilterData(new PX.PxFilterData(bit, (0xffffffff & ~bit) >>> 0, 0, 0));
}
