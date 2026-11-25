// Rigid-body simulation of a model (DESIGN.md §5): a thin mapping of the kinematic graph
// (src/core/kinematics.ts) onto a Rapier world.
//
// Frames. Every Rapier body is created with identity rotation and its translation at a
// reference point `ref` (the mean of its cell centres, close to its centre of mass, which keeps
// f32 lever arms short). So at t=0 body-local = world − ref, and the displacement of a body
// since t=0 is  x ↦ R(t)·(x − ref) + p(t),  i.e. { q: R(t), p: p(t) − R(t)·ref }. That
// displacement is what bodyTransform / partTransform return: it is exactly
// T_body(t) · T_body(0)⁻¹, the transform to apply to a part's edit-time world geometry.
//
// Joints (all impulse joints, contacts between the two bodies disabled):
//   revolute    → JointData.revolute(anchorA, anchorB, axis)
//   prismatic   → JointData.prismatic(anchorA, anchorB, axis), limits enabled = Joint.limits
//   cylindrical → JointData.generic(anchorA, anchorB, axis, LinY|LinZ|AngY|AngZ locked), then
//                 limits on the free LinX axis via RawImpulseJointSet.jointSetLimits (the JS
//                 JointData has no limits for generic joints). Rapier's joint coordinate is the
//                 displacement of body 2 relative to body 1 along the axis of body 1's frame,
//                 and body 1 = Joint.bodyA, so Joint.limits map over unchanged (verified for
//                 every axis and both body orders in tests/physics/joints.test.ts).
import type { ImpulseJoint, RigidBody, World } from '@dimforge/rapier3d-compat';
import { analyze } from '../core/kinematics';
import type { Joint, KinematicGraph } from '../core/kinematics';
import type { Model } from '../core/types';
import { partShapes } from './shapes';
import {
  add,
  axisAngle,
  conj,
  cross,
  dot,
  len,
  qmul,
  qnormalize,
  quat,
  rotate,
  scale,
  sub,
  unitAxis,
  vec,
  xyz,
} from './math';
import type { Quat, Vec3 } from './math';
import { RAPIER, initPhysics } from './rapier';

export { initPhysics } from './rapier';
export type { Quat, Vec3 } from './math';

/** Standard gravity in units/s² (1 unit = 8 mm): 9.81 / 0.008. */
export const G = 1226.25;

/** Rapier's linear speed clamp at lengthUnit 1, units/s (measured; see DEVIATIONS §5). */
const SPEED_CAP = 400;

/** Rigid transform: x ↦ q·x + p. */
export interface Transform {
  p: Vec3;
  q: Quat;
}

export interface SimOptions {
  /** Simulated seconds per real second for step(). Default 0.25 (§5.1). */
  speed?: number;
  /** Default [0, −G, 0]. */
  gravity?: Vec3;
  /** Fixed step in simulated seconds. Default 1/480. */
  fixedDt?: number;
  /**
   * Rapier solver iterations (= TGS substeps) per fixed step for every body that has a joint, and
   * for everything in contact with such a body. Default 240 (see DEVIATIONS §5).
   */
  solverIterations?: number;
  /**
   * Substeps per fixed step for dynamic bodies without joints that touch only other such bodies or
   * fixed bodies (loose parts lying around or falling). Default 30; clamped to solverIterations.
   */
  freeSolverIterations?: number;
  /** Rapier internal PGS iterations per substep. Default 1. */
  pgsIterations?: number;
  /** step() runs at most this many fixed steps per call; the rest is dropped (see droppedTime). Default 16. */
  maxStepsPerCall?: number;
  /** step() stops after this much wall-clock time (ms) and drops the rest. Default 8; Infinity = off. */
  stepBudgetMs?: number;
  /** Angular damping of every dynamic body. Default 0. */
  angularDamping?: number;
  friction?: number; // default 0.4
  restitution?: number; // default 0.1
  /** Collider density (mass per cubic unit). Default 1. */
  density?: number;
  /**
   * Removal depth (DESIGN §5.1 "falls below y = −400"). A dynamic body is removed once its centre
   * of mass is below min(removeBelowY, lowest edit-time cell centre y + removeBelowY) — so a model
   * built below −400 is not deleted on the first step. Default −400.
   */
  removeBelowY?: number;
  /** Natural frequency of the grab spring, Hz. Default 10. */
  grabFrequency?: number;
  /** Angular damping (1/s) of the grabbed body while it is held, so it stops swinging about the cursor. Default 5. */
  grabAngularDamping?: number;
  /** Drop products of inertia with the joint axis for planar mechanisms (see decoupleInertia). Default true. */
  decoupleInertia?: boolean;
  /** Sides of the convex prisms that stand in for collider cylinders (see shapes.ts); a multiple of 4. Default 16. */
  cylinderSegments?: number;
}

const DEFAULTS = {
  speed: 0.25,
  fixedDt: 1 / 480,
  solverIterations: 240,
  freeSolverIterations: 30,
  pgsIterations: 1,
  maxStepsPerCall: 16,
  stepBudgetMs: 8,
  angularDamping: 0,
  friction: 0.4,
  restitution: 0.1,
  density: 1,
  removeBelowY: -400,
  grabFrequency: 10,
  grabAngularDamping: 5,
  cylinderSegments: 16,
  decoupleInertia: true,
};

/** Per-joint diagnostics (current pose). */
export interface JointState {
  index: number;
  bodyA: number;
  bodyB: number;
  type: Joint['type'];
  /** False once either body was removed. */
  alive: boolean;
  /** revolute: anchor separation; sliding joints: distance of B's anchor from A's axis line. Units. */
  error: number;
  /** Displacement of B's anchor relative to A's along A's (current) joint axis. Units. */
  slide: number;
  /** Angle between the joint axis as carried by A and by B, radians. */
  tilt: number;
}

export interface MassInfo {
  mass: number;
  /** Current world centre of mass. */
  com: Vec3;
  /** Current world inertia tensor about the centre of mass, row-major 3×3. */
  inertia: number[];
}

interface SimBody {
  id: number;
  fixed: boolean;
  ref: Vec3;
  rb: RigidBody | null;
}

interface SimJoint {
  index: number;
  joint: Joint;
  sliding: boolean;
  /** Anchor in body A's / B's local frame. */
  anchorA: Vec3;
  anchorB: Vec3;
  /** Joint axis in either body's local frame (same at t=0, identity rotations). */
  axis: Vec3;
  handle: ImpulseJoint | null;
}

interface Grab {
  body: SimBody;
  local: Vec3;
  target: Vec3;
  /** Mass the spring strength is scaled by (see applyGrab). */
  mass: number;
}

/** JointAxis.LinX as the raw enum (same value) for RawImpulseJointSet.jointSetLimits. */
type RawAxis = Parameters<World['impulseJoints']['raw']['jointSetLimits']>[1];
const LIN_X = 0 as RawAxis; // RAPIER.JointAxis.LinX (asserted in tests/physics/joints.test.ts)

export class Simulation {
  readonly graph: KinematicGraph;
  readonly fixedDt: number;
  /** Fixed steps taken so far. */
  stepCount = 0;
  /** Fixed steps step() dropped because of maxStepsPerCall or stepBudgetMs (readable counter). */
  droppedSteps = 0;
  private speedValue: number;
  private readonly world: World;
  private readonly bodies: SimBody[] = [];
  private readonly joints: SimJoint[] = [];
  private readonly bodyOfPart: Map<number, number>;
  private readonly opts: typeof DEFAULTS;
  private readonly gravity: Vec3;
  private acc = 0;
  /** y below which a dynamic body's centre of mass is removed (see SimOptions.removeBelowY). */
  readonly removalY: number;
  private grabState: Grab | null = null;
  private disposed = false;
  /** World substep count (= free-body substeps); jointed bodies add solverIterations − this. */
  private readonly baseIterations: number;

  /** Analyse `model` (which must be valid) and build its Rapier world. */
  static async create(model: Model, opts: SimOptions = {}): Promise<Simulation> {
    await initPhysics();
    return new Simulation(model, opts);
  }

  private constructor(model: Model, options: SimOptions) {
    const o: typeof DEFAULTS = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      const v = options[k];
      if (v !== undefined) (o as Record<string, unknown>)[k] = v;
    }
    if (!(o.fixedDt > 0) || !Number.isFinite(o.fixedDt)) throw new Error(`fixedDt must be > 0 (got ${o.fixedDt})`);
    if (!(o.speed >= 0) || !Number.isFinite(o.speed)) throw new Error(`speed must be >= 0 (got ${o.speed})`);
    this.opts = o;
    this.fixedDt = o.fixedDt;
    this.speedValue = o.speed;
    this.gravity = options.gravity ? [...options.gravity] : [0, -G, 0];
    this.graph = analyze(model);
    let minY = Infinity;
    for (const p of model.parts) for (const c of p.cells) minY = Math.min(minY, c.y);
    this.removalY = Number.isFinite(minY) ? Math.min(o.removeBelowY, minY + o.removeBelowY) : o.removeBelowY;
    this.bodyOfPart = this.graph.bodyOfPart;

    const world = new RAPIER.World(xyz(this.gravity));
    this.world = world;
    world.timestep = o.fixedDt;
    // Substeps are set per connected component (Rapier runs every component of dynamic bodies
    // linked by joints or touching contacts at the world count plus the largest
    // additionalSolverIterations among its bodies). The world count is the free-body count, and
    // every jointed body adds the difference (buildBodies), so mechanisms — and anything touching
    // them — run exactly solverIterations substeps, while loose parts that only touch each other
    // or fixed bodies run freeSolverIterations. See DEVIATIONS §5 "Integration settings".
    this.baseIterations = Math.max(1, Math.min(o.freeSolverIterations, o.solverIterations));
    world.numSolverIterations = this.baseIterations;
    world.numInternalPgsIterations = o.pgsIterations;
    world.integrationParameters.maxCcdSubsteps = 0; // hard CCD off; free bodies use soft CCD
    // lengthUnit stays 1 (a cell is ~1 unit, the size Rapier's default tolerances are made
    // for: allowed penetration 0.005, prediction distance 0.02). Side effect, measured: Rapier
    // then clamps every body's linear speed to 400 units/s (3.2 m/s; it scales with
    // lengthUnit) and its angular speed to π/4 per step (377 rad/s at 1/480 s). Raising
    // lengthUnit to lift the speed cap made contacts visibly worse (deeper impacts, slower
    // linkages through speculative contacts) — see DEVIATIONS §5.

    try {
      this.buildBodies(model);
      this.buildJoints();
    } catch (e) {
      world.free();
      throw e;
    }
  }

  private buildBodies(model: Model): void {
    const partById = new Map(model.parts.map((p) => [p.id, p]));
    const o = this.opts;
    const jointed = new Set<number>();
    for (const j of this.graph.joints) {
      jointed.add(j.bodyA);
      jointed.add(j.bodyB);
    }
    const extra = Math.max(0, o.solverIterations - this.baseIterations);
    for (const b of this.graph.bodies) {
      const parts = b.partIds.map((id) => partById.get(id)!).filter((p) => p && p.cells.length > 0);
      let ref: Vec3 = [0, 0, 0];
      let n = 0;
      for (const p of parts) for (const c of p.cells) {
        ref = add(ref, [c.x, c.y, c.z]);
        n++;
      }
      // Rounded to f32 (what Rapier stores) so the displacement is exactly the identity at t=0.
      if (n > 0) ref = scale(ref, 1 / n).map(Math.fround) as Vec3;
      const desc = b.fixed
        ? RAPIER.RigidBodyDesc.fixed()
        : RAPIER.RigidBodyDesc.dynamic().setCanSleep(false).setAngularDamping(o.angularDamping);
      if (!b.fixed && jointed.has(b.id)) desc.setAdditionalSolverIterations(extra);
      desc.setTranslation(ref[0], ref[1], ref[2]);
      const rb = this.world.createRigidBody(desc);
      for (const p of parts) {
        for (const sh of partShapes(p, o.cylinderSegments)) {
          let cd;
          if (sh.kind === 'hull') {
            const pts = new Float32Array(sh.points.length * 3);
            sh.points.forEach((q, i) => pts.set(sub(q, ref), i * 3));
            cd = RAPIER.ColliderDesc.convexHull(pts);
            if (!cd) throw new Error(`convex hull failed for part ${p.id}`);
            // Mass of the un-bevelled prism (shapes.ts), not of the bevelled hull.
            const mp = sh.mass;
            cd.setMassProperties(mp.volume * o.density, xyz(sub(mp.com, ref)), xyz(scale(mp.inertia, o.density)), { x: 0, y: 0, z: 0, w: 1 });
          } else {
            const c = sub(sh.center, ref);
            cd = RAPIER.ColliderDesc.cuboid(sh.halfExtents[0], sh.halfExtents[1], sh.halfExtents[2]).setTranslation(c[0], c[1], c[2]);
            cd.setDensity(o.density);
          }
          cd.setFriction(o.friction).setRestitution(o.restitution);
          this.world.createCollider(cd, rb);
        }
      }
      this.bodies.push({ id: b.id, fixed: b.fixed, ref, rb });
    }
    // Free bodies (no joints) can fall fast onto other parts: give them soft CCD (predictive
    // contacts reaching one step ahead at the speed cap). Rapier's hard CCD solver is switched off
    // in the constructor (maxCcdSubsteps = 0): it ran its time-of-impact clamp on jointed pairs
    // even though their contacts are disabled, stalling a sliding axle in its hole for a step
    // whenever it moved faster than its thinnest collider piece (see DEVIATIONS §5).
    for (const sb of this.bodies)
      if (!sb.fixed && !jointed.has(sb.id)) sb.rb!.setSoftCcdPrediction(SPEED_CAP * o.fixedDt * 1.25);
    this.decoupleInertia();
  }

  /**
   * Rapier blows up a body that rotates about a joint axis which is not one of its principal
   * axes (measured: a tilted bar on a revolute joint spins up from 20 rad/s to the 377 rad/s
   * cap within 2 s; any part whose cells are not mirror-symmetric about the plane through its
   * centre of mass normal to the axis has such products of inertia, e.g. an arm on an axle or a
   * link carrying a pin). For a mechanism attached to a fixed body whose joints all share one
   * axis a, every body can only rotate about a, and then only I_aa (and mass / centre of mass)
   * enter the motion: the products I_ab, I_ac only produce torques normal to a, which the joints
   * absorb. So with opts.decoupleInertia (default) the products with a are dropped for exactly
   * those bodies (mass, centre of mass, I_aa and the other 2×2 block unchanged), which makes a
   * principal and removes the blow-up without changing the exact motion. Other bodies keep their
   * true inertia.
   */
  private decoupleInertia(): void {
    if (!this.opts.decoupleInertia) return;
    const decoupled = new Map<number, 0 | 1 | 2>();
    this.findPlanarMechanisms(decoupled);
    for (const [id, a] of decoupled) setDecoupledInertia(this.bodies[id]!.rb!, a);
  }

  /** Bodies of mechanisms attached to a fixed body whose joints all share one axis → that axis. */
  private findPlanarMechanisms(decoupled: Map<number, 0 | 1 | 2>): void {
    const fixed = (id: number) => this.bodies[id]!.fixed;
    const seen = new Set<number>();
    for (const start of this.bodies) {
      if (start.fixed || seen.has(start.id)) continue;
      const comp: number[] = [];
      const axes = new Set<number>();
      let attached = false;
      const stack = [start.id];
      seen.add(start.id);
      while (stack.length) {
        const u = stack.pop()!;
        comp.push(u);
        for (const j of this.graph.joints) {
          if (j.bodyA !== u && j.bodyB !== u) continue;
          axes.add(j.axis);
          const o = j.bodyA === u ? j.bodyB : j.bodyA;
          if (fixed(o)) attached = true;
          else if (!seen.has(o)) {
            seen.add(o);
            stack.push(o);
          }
        }
      }
      if (!attached || axes.size !== 1) continue;
      const a = [...axes][0] as 0 | 1 | 2;
      for (const id of comp) decoupled.set(id, a);
    }
  }

  private buildJoints(): void {
    this.graph.joints.forEach((j, index) => {
      const A = this.bodies[j.bodyA]!;
      const B = this.bodies[j.bodyB]!;
      const anchorA = sub(j.origin, A.ref);
      const anchorB = sub(j.origin, B.ref);
      const axis = unitAxis(j.axis);
      const handle = this.createImpulse(j, A.rb!, B.rb!, anchorA, anchorB, axis);
      this.joints.push({ index, joint: j, sliding: j.type !== 'revolute', anchorA, anchorB, axis, handle });
    });
  }

  private createImpulse(j: Joint, A: RigidBody, B: RigidBody, anchorA: Vec3, anchorB: Vec3, axis: Vec3): ImpulseJoint {
    const LOCK_CYL =
      RAPIER.JointAxesMask.LinY | RAPIER.JointAxesMask.LinZ | RAPIER.JointAxesMask.AngY | RAPIER.JointAxesMask.AngZ;
    let data;
    if (j.type === 'revolute') {
      data = RAPIER.JointData.revolute(xyz(anchorA), xyz(anchorB), xyz(axis));
    } else if (j.type === 'prismatic') {
      data = RAPIER.JointData.prismatic(xyz(anchorA), xyz(anchorB), xyz(axis));
      const [lo, hi] = j.limits ?? [0, 0];
      data.limitsEnabled = true;
      data.limits = [lo, hi];
    } else {
      data = RAPIER.JointData.generic(xyz(anchorA), xyz(anchorB), xyz(axis), LOCK_CYL);
    }
    const handle = this.world.createImpulseJoint(data, A, B, true);
    if (j.type === 'cylindrical') {
      const [lo, hi] = j.limits ?? [0, 0];
      this.world.impulseJoints.raw.jointSetLimits(handle.handle, LIN_X, lo, hi);
    }
    handle.setContactsEnabled(false);
    return handle;
  }

  // ------------------------------------------------------------------------------------------
  // Stepping

  /** Simulated seconds elapsed (stepCount × fixedDt). */
  get time(): number {
    return this.stepCount * this.fixedDt;
  }

  get speed(): number {
    return this.speedValue;
  }

  /** Simulated seconds that step() dropped (droppedSteps × fixedDt). */
  get droppedTime(): number {
    return this.droppedSteps * this.fixedDt;
  }

  setSpeed(speed: number): void {
    if (!(speed >= 0) || !Number.isFinite(speed)) throw new Error(`speed must be >= 0 (got ${speed})`);
    this.speedValue = speed;
  }

  /**
   * Advance by dtReal × speed simulated seconds in fixed steps, carrying the remainder in an
   * accumulator. At most maxStepsPerCall steps run per call, and stepping stops once a call has
   * used stepBudgetMs of wall-clock time; the whole steps not run are dropped (not carried over)
   * and counted in droppedSteps, so a slow machine runs slower than real time instead of
   * spiralling. Non-positive or non-finite dtReal is ignored. Returns the steps run.
   */
  step(dtReal: number): number {
    this.alive();
    if (!(dtReal > 0) || !Number.isFinite(dtReal)) return 0;
    this.acc += dtReal * this.speedValue;
    const want = Math.floor(this.acc / this.fixedDt + 1e-9);
    this.acc = Math.max(0, this.acc - want * this.fixedDt);
    const n = Math.min(want, this.opts.maxStepsPerCall);
    const budget = this.opts.stepBudgetMs;
    const t0 = budget === Infinity ? 0 : now();
    let done = 0;
    while (done < n) {
      this.stepFixed(1);
      done++;
      if (budget !== Infinity && now() - t0 >= budget) break;
    }
    this.droppedSteps += want - done;
    return done;
  }

  /** Exactly n fixed steps (ignores speed and the accumulator). */
  stepFixed(n = 1): void {
    this.alive();
    for (let i = 0; i < n; i++) {
      this.applyGrab();
      this.world.step();
      this.stepCount++;
      this.removeFallen();
    }
  }

  private removeFallen(): void {
    const yMin = this.removalY;
    for (const b of this.bodies) {
      if (b.fixed || !b.rb) continue;
      const y = b.rb.worldCom().y;
      if (y < yMin) this.removeBody(b);
    }
  }

  private removeBody(b: SimBody): void {
    if (!b.rb) return;
    if (this.grabState?.body === b) this.grabState = null;
    this.world.removeRigidBody(b.rb); // also removes its colliders and joints
    b.rb = null;
    for (const j of this.joints) if (j.joint.bodyA === b.id || j.joint.bodyB === b.id) j.handle = null;
  }

  // ------------------------------------------------------------------------------------------
  // Poses

  /** Is the body still in the world? (false once it fell below removalY, or unknown id) */
  hasBody(bodyId: number): boolean {
    return !!this.bodies[bodyId]?.rb;
  }

  /**
   * Displacement of the body since t=0: the transform T(t)·T(0)⁻¹ that maps its edit-time world
   * geometry to its current pose (identity at t=0 and for the fixed body). null once removed or
   * for an unknown id.
   */
  bodyTransform(bodyId: number): Transform | null {
    this.alive();
    const b = this.bodies[bodyId];
    if (!b?.rb) return null;
    const q = qnormalize(quat(b.rb.rotation())); // f32 → exactly unit in f64
    const t = vec(b.rb.translation());
    return { q, p: sub(t, rotate(q, b.ref)) };
  }

  /** The transform to apply to the part's edit-time world placement (its body's displacement). */
  partTransform(partId: number): Transform | null {
    const bodyId = this.bodyOfPart.get(partId);
    return bodyId === undefined ? null : this.bodyTransform(bodyId);
  }

  /** Body id of a part (undefined for an unknown part). */
  bodyOf(partId: number): number | undefined {
    return this.bodyOfPart.get(partId);
  }

  /** Current velocity of the body's centre of mass and its angular velocity (world). */
  bodyVelocity(bodyId: number): { v: Vec3; w: Vec3 } | null {
    this.alive();
    const rb = this.bodies[bodyId]?.rb;
    if (!rb) return null;
    return { v: vec(rb.linvel()), w: vec(rb.angvel()) };
  }

  /** Mass properties as computed by the engine from the colliders. */
  massInfo(bodyId: number): MassInfo | null {
    this.alive();
    const rb = this.bodies[bodyId]?.rb;
    if (!rb) return null;
    const qf = qmul(quat(rb.rotation()), quat(rb.principalInertiaLocalFrame()));
    const d = vec(rb.principalInertia());
    const cols = [rotate(qf, [1, 0, 0]), rotate(qf, [0, 1, 0]), rotate(qf, [0, 0, 1])];
    const inertia: number[] = [];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) inertia.push(cols.reduce((s, e, k) => s + d[k]! * e[r]! * e[c]!, 0));
    return { mass: rb.mass(), com: vec(rb.worldCom()), inertia };
  }

  // ------------------------------------------------------------------------------------------
  // Interaction

  /**
   * Start pulling dynamic body `bodyId` at `worldPoint` (a point on it, current pose) toward the
   * drag target. Returns false (and grabs nothing) for a fixed, removed or unknown body.
   */
  grab(bodyId: number, worldPoint: Vec3): boolean {
    this.alive();
    this.release();
    const b = this.bodies[bodyId];
    if (!b?.rb || b.fixed) return false;
    const q = quat(b.rb.rotation());
    const t = vec(b.rb.translation());
    const local = rotate(conj(q), sub(worldPoint, t));
    const own = b.rb.mass();
    const mass = Math.min(this.mechanismMass(b.id), 10 * own);
    this.grabState = { body: b, local, target: [...worldPoint], mass };
    b.rb.setAngularDamping(this.opts.angularDamping + this.opts.grabAngularDamping);
    return true;
  }

  /** Total mass of the live dynamic bodies joint-connected to `bodyId` (not through fixed bodies). */
  private mechanismMass(bodyId: number): number {
    const seen = new Set([bodyId]);
    const stack = [bodyId];
    let m = 0;
    while (stack.length) {
      const u = stack.pop()!;
      m += this.bodies[u]!.rb!.mass();
      for (const j of this.joints) {
        if (!j.handle) continue;
        const o = j.joint.bodyA === u ? j.joint.bodyB : j.joint.bodyB === u ? j.joint.bodyA : -1;
        if (o < 0 || seen.has(o) || this.bodies[o]!.fixed || !this.bodies[o]!.rb) continue;
        seen.add(o);
        stack.push(o);
      }
    }
    return m;
  }

  /** Move the drag target (world). No-op when nothing is grabbed. */
  dragTo(worldPoint: Vec3): void {
    if (this.grabState) this.grabState.target = [...worldPoint];
  }

  release(): void {
    const g = this.grabState;
    this.grabState = null;
    if (g?.body.rb) {
      g.body.rb.resetForces(true);
      g.body.rb.resetTorques(true);
      g.body.rb.setAngularDamping(this.opts.angularDamping);
    }
  }

  /** The grabbed body id, or null. */
  get grabbed(): number | null {
    return this.grabState ? this.grabState.body.id : null;
  }

  /** The grabbed point's current world position, or null. */
  grabPoint(): Vec3 | null {
    const g = this.grabState;
    if (!g?.body.rb) return null;
    return add(rotate(quat(g.body.rb.rotation()), g.local), vec(g.body.rb.translation()));
  }

  /**
   * Spring-damper at the grabbed point: F = M·(ω²·(target − x) − 2ω·v) − m·g, ω = 2π·grabFrequency,
   * m = the grabbed body's mass, M = the mass of the mechanism it is joint-connected to (capped at
   * 10·m for explicit-integration stability). Critically damped for a free point mass M; the −m·g
   * term cancels the body's own weight so a free body settles exactly on the cursor (a linkage
   * sags by less than g/ω² ≈ 0.31 units at 10 Hz). |F| is capped at M·100·G.
   */
  private applyGrab(): void {
    const g = this.grabState;
    const rb = g?.body.rb;
    if (!g || !rb) return;
    const x = add(rotate(quat(rb.rotation()), g.local), vec(rb.translation()));
    const v = vec(rb.velocityAtPoint(xyz(x)));
    const m = rb.mass();
    const M = g.mass;
    const w = 2 * Math.PI * this.opts.grabFrequency;
    let f = sub(scale(sub(scale(sub(g.target, x), w * w), scale(v, 2 * w)), M), scale(this.gravity, m));
    const fmax = M * 100 * G;
    const fl = len(f);
    if (fl > fmax) f = scale(f, fmax / fl);
    rb.resetForces(false);
    rb.resetTorques(false);
    rb.addForceAtPoint(xyz(f), xyz(x), true);
  }

  // ------------------------------------------------------------------------------------------
  // Diagnostics

  /**
   * Total energy of the live dynamic bodies, from the engine's mass properties:
   * kinetic = Σ ½·m·|v_com|² + ½·ωᵀ·I·ω, potential = Σ −m·(gravity · com) (= Σ m·g·y_com for
   * the default gravity).
   */
  energy(): { kinetic: number; potential: number } {
    this.alive();
    let kinetic = 0;
    let potential = 0;
    for (const b of this.bodies) {
      const rb = b.rb;
      if (b.fixed || !rb) continue;
      const m = rb.mass();
      const v = vec(rb.linvel());
      const qf = qmul(quat(rb.rotation()), quat(rb.principalInertiaLocalFrame()));
      const wl = rotate(conj(qf), vec(rb.angvel()));
      const I = vec(rb.principalInertia());
      kinetic += 0.5 * m * dot(v, v) + 0.5 * (I[0] * wl[0] ** 2 + I[1] * wl[1] ** 2 + I[2] * wl[2] ** 2);
      potential -= m * dot(this.gravity, vec(rb.worldCom()));
    }
    return { kinetic, potential };
  }

  /** Per-joint diagnostics in graph.joints order. */
  jointStates(): JointState[] {
    this.alive();
    return this.joints.map((sj) => {
      const j = sj.joint;
      const base = { index: sj.index, bodyA: j.bodyA, bodyB: j.bodyB, type: j.type };
      const A = this.bodies[j.bodyA]!.rb;
      const B = this.bodies[j.bodyB]!.rb;
      if (!sj.handle || !A || !B) return { ...base, alive: false, error: 0, slide: 0, tilt: 0 };
      const qa = quat(A.rotation());
      const qb = quat(B.rotation());
      const pa = add(rotate(qa, sj.anchorA), vec(A.translation()));
      const pb = add(rotate(qb, sj.anchorB), vec(B.translation()));
      const axA = rotate(qa, sj.axis);
      const axB = rotate(qb, sj.axis);
      const d = sub(pb, pa);
      const slide = dot(d, axA);
      const error = sj.sliding ? len(sub(d, scale(axA, slide))) : len(d);
      const tilt = Math.atan2(len(cross(axA, axB)), dot(axA, axB));
      return { ...base, alive: true, error, slide, tilt };
    });
  }

  /** Max over live joints of the anchor separation (sliding joints: distance from A's axis line), units. */
  jointError(): number {
    let e = 0;
    for (const s of this.jointStates()) {
      if (!s.alive) continue;
      if (Number.isNaN(s.error)) return NaN;
      if (s.error > e) e = s.error;
    }
    return e;
  }

  /** Free the Rapier world. Idempotent; any other call afterwards throws. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.grabState = null;
    this.world.free();
    for (const b of this.bodies) b.rb = null;
    for (const j of this.joints) j.handle = null;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private alive(): void {
    if (this.disposed) throw new Error('Simulation has been disposed');
  }
}


function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Local inertia tensor (row-major 3×3) of a body from its principal inertia and frame. */
function localInertia(rb: RigidBody): number[] {
  const qf = quat(rb.principalInertiaLocalFrame());
  const d = vec(rb.principalInertia());
  const cols = [rotate(qf, [1, 0, 0]), rotate(qf, [0, 1, 0]), rotate(qf, [0, 0, 1])];
  const I: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) I.push(cols.reduce((s, e, k) => s + d[k]! * e[r]! * e[c]!, 0));
  return I;
}

/**
 * Replace the body's mass properties by the same ones with the products of inertia with axis a
 * dropped. A body whose products with a are already negligible (< 1e-6 of the trace: f32 noise of
 * a mirror-symmetric body) is left exactly as the engine built it.
 */
function setDecoupledInertia(rb: RigidBody, a: 0 | 1 | 2): void {
  const m = rb.mass();
  const com = rb.localCom();
  const I = localInertia(rb);
  const b = (a + 1) % 3;
  const c = (a + 2) % 3;
  const tol = 1e-6 * (I[0]! + I[4]! + I[8]!);
  if (Math.abs(I[a * 3 + b]!) < tol && Math.abs(I[a * 3 + c]!) < tol) return;
  const Ibb = I[b * 3 + b]!;
  const Icc = I[c * 3 + c]!;
  const Ibc = I[b * 3 + c]!;
  // Eigen-decomposition of the (b, c) block: rotation by θ about axis a (from e_b toward e_c).
  const th = 0.5 * Math.atan2(2 * Ibc, Ibb - Icc);
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const lu = Ibb * cs * cs + 2 * Ibc * sn * cs + Icc * sn * sn;
  const principal: Vec3 = [0, 0, 0];
  principal[a] = I[a * 3 + a]!;
  principal[b] = lu;
  principal[c] = Ibb + Icc - lu;
  const frame = axisAngle(unitAxis(a), th);
  for (let i = 0; i < rb.numColliders(); i++) rb.collider(i).setDensity(0);
  rb.setAdditionalMassProperties(m, com, xyz(principal), { x: frame[0], y: frame[1], z: frame[2], w: frame[3] }, true);
  rb.recomputeMassPropertiesFromColliders();
}
