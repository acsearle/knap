// Independent minimal loader (does not use ../lib.mjs). SI units: metres, kg, s.
import PhysXInit from 'physx-js-webidl';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const wasm = readFileSync(createRequire(import.meta.url).resolve('physx-js-webidl/physx-js-webidl.wasm'));
const proc = globalThis.process; globalThis.window = globalThis; globalThis.process = undefined;
let X; try { X = await PhysXInit({ wasmBinary: wasm }); } finally { globalThis.process = proc; delete globalThis.window; }
export const PX = X;
export const TL = PX.PxTopLevelFunctions.prototype;
export const S = 0.008; // metres per stud
export const g = 9.81;
const ver = TL.PHYSICS_VERSION;
const fnd = PX.CreateFoundation(ver, new PX.PxDefaultAllocator(), new PX.PxDefaultErrorCallback());
export const tol = new PX.PxTolerancesScale(); tol.length = S; tol.speed = g; // ~1 part, ~speed after 1 s fall
export const phys = PX.CreatePhysics(ver, fnd, tol);
PX.InitExtensions(phys);
export const V = (x = 0, y = 0, z = 0) => new PX.PxVec3(x, y, z);
export const T = (p = [0, 0, 0], q = [0, 0, 0, 1]) => new PX.PxTransform(V(...p), new PX.PxQuat(...q));
export const aa = (ax, a) => { const s = Math.sin(a / 2); return [ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(a / 2)]; };
export function scene({ pgs = false, gravity = -g, flags = [] , clearFlags = [] } = {}) {
  const d = new PX.PxSceneDesc(tol);
  d.gravity = V(0, gravity, 0);
  d.cpuDispatcher = PX.DefaultCpuDispatcherCreate(0);
  d.filterShader = TL.DefaultFilterShader();
  d.solverType = pgs ? PX.PxSolverTypeEnum.ePGS : PX.PxSolverTypeEnum.eTGS;
  const f = d.flags; for (const k of flags) f.raise(PX.PxSceneFlagEnum[k]); for (const k of clearFlags) f.clear(PX.PxSceneFlagEnum[k]); d.flags = f;
  const s = phys.createScene(d);
  s.step = (dt) => { s.simulate(dt); s.fetchResults(true); };
  return s;
}
export const mat = phys.createMaterial(0.5, 0.5, 0);
export function shape(geom, { contactOffset, restOffset, group = 1, mask = 0xffffffff } = {}) {
  const sh = phys.createShape(geom, mat, true, new PX.PxShapeFlags(PX.PxShapeFlagEnum.eSIMULATION_SHAPE));
  sh.setSimulationFilterData(new PX.PxFilterData(group, mask >>> 0, 0, 0));
  if (contactOffset !== undefined) sh.setContactOffset(contactOffset);
  if (restOffset !== undefined) sh.setRestOffset(restOffset);
  return sh;
}
export function dyn(s, shapes, p, q, { density = 0.3e-3 / (S * S * S) / 1e-3 * 1e-3, pos = 4, vel = 1, gyro = false, spec = false } = {}) {
  // density: 0.3 g per stud^3 = 0.3e-3 kg / (0.008 m)^3
  const a = phys.createRigidDynamic(T(p, q));
  for (const [geom, local, o] of shapes) { const sh = shape(geom, o); if (local) sh.setLocalPose(local); a.attachShape(sh); }
  PX.PxRigidBodyExt.prototype.updateMassAndInertia(a, 0.3e-3 / (S * S * S));
  a.setSleepThreshold(0); a.setStabilizationThreshold(0);
  a.setLinearDamping(0); a.setAngularDamping(0);
  a.setMaxAngularVelocity(1e6); a.setMaxLinearVelocity(1e6); a.setMaxDepenetrationVelocity(1e6);
  a.setSolverIterationCounts(pos, vel);
  if (gyro) a.setRigidBodyFlag(PX.PxRigidBodyFlagEnum.eENABLE_GYROSCOPIC_FORCES, true);
  if (spec) a.setRigidBodyFlag(PX.PxRigidBodyFlagEnum.eENABLE_SPECULATIVE_CCD, true);
  s.addActor(a); return a;
}
export function stat(s, geom, p, q, o) { const a = phys.createRigidStatic(T(p, q)); a.attachShape(shape(geom, o)); s.addActor(a); return a; }
export const P3 = (a) => { const p = a.getGlobalPose().p; return [p.x, p.y, p.z]; };
export const LV = (a) => { const v = a.getLinearVelocity(); return [v.x, v.y, v.z]; };
export const AV = (a) => { const v = a.getAngularVelocity(); return [v.x, v.y, v.z]; };
export const ms = () => Number(process.hrtime.bigint()) / 1e6;
